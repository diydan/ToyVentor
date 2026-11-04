"""
Turn a trained Glimmer adapter into something llama.cpp can serve. CPU only: no GPU is rented for conversion.

STATUS (2026-11-04): route A (lora) has converted a smoke adapter and llama-server loaded and applied it; route B (merged) has NEVER RUN. Two routes, tried in this order, because the first is cheap and the second is the robust one:

  A. lora   convert the adapter alone (a few hundred MB) with llama.cpp's convert_lora_to_gguf.py and serve it over Meta's existing 17 GB GGUF with `llama-server --lora`.
            Unverified risks (measured 2026-11-04 on a smoke adapter): Glimmer's converter un-permutes Q/K and ADDS two norm tensors per layer whenever it sees a q_proj, and the LoRA converter
            passes an adapter through that code. As shipped it CRASHED (a LoraTorchTensor has no ndim) and would have written the base-only norm tensors into the adapter; patch_lora_script() below
            fixes both on a copy, and the result loaded and answered in llama-server. Still unchecked: whether the un-permute of the adapter's B rows is numerically right (the smoke answers
            were valid JSON, which is evidence but not proof; the tuned-vs-base evaluation is the real test). The adapter was trained on Unsloth's 4-bit weights and is applied to a different
            quantisation (Meta's Q4_K_M): usually fine, and consistent with the smoke answers.
  B. merged convert the merged 16-bit weights (glimmer_train.py::export, about 56 GB) with convert_hf_to_gguf.py, then quantise to Q4_K_M with llama-quantize. Heavier and the surer route.

llama.cpp is pinned to release b12078 (2026-11-03): Glimmer's architecture is registered in conversion/muse_glimmer.py there, Glimmer needs build b10353 or newer, and the converters were split into a
`conversion/` package in between, so older checkouts will not do. Nothing is downloaded from anywhere but Hugging Face (the base model's config files) and GitHub (llama.cpp at that tag).

    export PATH="$HOME/Library/Python/3.9/bin:$PATH"; export MODAL_IMAGE_BUILDER_VERSION=2025.06
    modal run scripts/modal/glimmer_convert.py::inspect --run pilot-1      # list the adapter's tensor names and shapes (reads the header only)
    modal run scripts/modal/glimmer_convert.py::lora    --run pilot-1      # route A
    modal run scripts/modal/glimmer_convert.py::merged  --run pilot-1      # route B (after glimmer_train.py::export)
"""

import json
import os
import struct
import subprocess

import modal

APP_NAME = "toyventor-glimmer-convert"
LLAMA_CPP_TAG = "b12078"
BASE_REPO = "meta-models/Muse-Glimmer-30B"  # only its config and tokenizer files are fetched, never its weights
MINUTES = 60

app = modal.App(APP_NAME)
out_vol = modal.Volume.from_name("toyventor-tune-out", create_if_missing=True)
hf_cache = modal.Volume.from_name("toyventor-tune-hf", create_if_missing=True)
VOLUMES = {"/out": out_vol, "/root/.cache/huggingface": hf_cache}

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git", "build-essential", "cmake", "curl")
    .run_commands(
        f"git clone --depth 1 --branch {LLAMA_CPP_TAG} https://github.com/ggml-org/llama.cpp /opt/llama.cpp",
        "cd /opt/llama.cpp && cmake -B build -DGGML_CUDA=OFF -DLLAMA_CURL=OFF -DBUILD_SHARED_LIBS=OFF && cmake --build build --config Release -j 8 --target llama-quantize",
        "pip install -r /opt/llama.cpp/requirements/requirements-convert_hf_to_gguf.txt",
        "pip install /opt/llama.cpp/gguf-py",
    )
    .pip_install("huggingface_hub", "safetensors", "transformers==5.15.0")
)


def run(cmd, **kw):
    print("+", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True, **kw)


LORA_SCRIPT = "/opt/llama.cpp/convert_lora_to_gguf.py"
LORA_SCRIPT_PATCHED = "/opt/llama.cpp/convert_lora_to_gguf_glimmer.py"
# Two anchors in llama.cpp b12078's LoRA converter. Each must occur exactly once or the patch refuses to run (a different build needs its patch looked at again).
LORA_PATCHES = [
    (
        "    def get_lora_A_B(self) -> tuple[Tensor, Tensor]:\n        return (self._lora_A, self._lora_B)\n",
        "    def get_lora_A_B(self) -> tuple[Tensor, Tensor]:\n        return (self._lora_A, self._lora_B)\n\n"
        "    @property\n    def ndim(self) -> int:  # Glimmer's Q/K un-permute (conversion/muse_glimmer.py) asks for it; the class has dim() only\n        return len(self.shape)\n",
    ),
    (
        '                    # mergekit-extract-lora add these layernorm to the adapter\n                    if "_norm" in dest_name:\n',
        '                    if dest_name.endswith(("attn_q_norm.weight", "attn_k_norm.weight")) and not isinstance(dest_data, LoraTorchTensor):\n'
        "                        continue  # Glimmer's converter makes these from the config for the BASE model; an adapter file must not carry tensors without a .lora_a / .lora_b suffix\n"
        '                    # mergekit-extract-lora add these layernorm to the adapter\n                    if "_norm" in dest_name:\n',
    ),
]


def patch_lora_script(source: str) -> str:
    """The LoRA converter of llama.cpp b12078 cannot convert a Glimmer adapter as shipped: the architecture's Q/K un-permute reads `.ndim` (a LoraTorchTensor has none), and the
    architecture also yields q_norm / k_norm tensors that exist only in the base model. Both are fixed here, in a copy, with every anchor checked."""
    for old, new in LORA_PATCHES:
        if source.count(old) != 1:
            raise SystemExit(f"llama.cpp LoRA converter: patch anchor found {source.count(old)} times (expected 1): {old[:70]!r}")
        source = source.replace(old, new)
    return source

def base_config_dir():
    from huggingface_hub import snapshot_download

    return snapshot_download(BASE_REPO, allow_patterns=["*.json", "*.jinja", "tokenizer*", "*.txt"])


def safetensors_header(path):
    """Tensor names, dtypes and shapes from a .safetensors header (the first 8 bytes give the header's length). No torch needed."""
    with open(path, "rb") as f:
        (n,) = struct.unpack("<Q", f.read(8))
        header = json.loads(f.read(n))
    header.pop("__metadata__", None)
    return {k: (v["dtype"], v["shape"]) for k, v in header.items()}


@app.function(image=image, volumes=VOLUMES, timeout=10 * MINUTES)
def inspect_remote(run_name: str) -> str:
    """What the adapter holds: how many tensors, their naming, a sample, and its config. The first thing to read when a conversion complains about a name."""
    d = f"/out/{run_name}/adapter"
    tensors = safetensors_header(f"{d}/adapter_model.safetensors")
    names = sorted(tensors)
    cfg = json.load(open(f"{d}/adapter_config.json"))
    summary = {
        "tensors": len(names),
        "first": [(n, *tensors[n]) for n in names[:6]],
        "prefixes": sorted({n.split(".layers.")[0] for n in names if ".layers." in n}),
        "target_modules": cfg.get("target_modules"),
        "r": cfg.get("r"),
        "lora_alpha": cfg.get("lora_alpha"),
        "base_model": cfg.get("base_model_name_or_path"),
        "non_lora_tensors": [n for n in names if "lora_A" not in n and "lora_B" not in n][:10],
    }
    print(json.dumps(summary, indent=1))
    return json.dumps(summary)


@app.function(image=image, volumes=VOLUMES, timeout=60 * MINUTES, cpu=4, memory=32 * 1024)
def lora_remote(run_name: str) -> str:
    """Route A: the adapter as a GGUF LoRA. Output: /out/<run>/lora-f16.gguf. The converter reads the base model's tensor shapes from the Hub itself (--base-model-id); a local --base directory needs the full weights on disk (the first try failed on the missing shard file)."""
    src, dst = f"/out/{run_name}/adapter", f"/out/{run_name}/lora-f16.gguf"
    with open(LORA_SCRIPT) as f:
        patched = patch_lora_script(f.read())
    with open(LORA_SCRIPT_PATCHED, "w") as f:
        f.write(patched)
    run(["python", LORA_SCRIPT_PATCHED, "--base-model-id", BASE_REPO, "--outfile", dst, "--outtype", "f16", src])
    out_vol.commit()
    return f"{dst}: {os.path.getsize(dst) / 1e6:.0f} MB"


@app.function(image=image, volumes=VOLUMES, timeout=3 * 60 * MINUTES, cpu=8, memory=128 * 1024, ephemeral_disk=512 * 1024)  # Modal's minimum request is 512 GiB
def merged_remote(run_name: str, quant: str = "Q4_K_M") -> str:
    """Route B: merged 16-bit weights to GGUF, then quantised. Output: /out/<run>/merged-<quant>.gguf (the bf16 file in between is about 56 GB and is deleted)."""
    merged = f"/out/{run_name}/merged-16bit"
    if not os.path.isdir(merged):
        raise SystemExit(f"{merged} is missing: run glimmer_train.py::export first")
    bf16, final = f"/tmp/merged-bf16.gguf", f"/out/{run_name}/merged-{quant}.gguf"
    run(["python", "/opt/llama.cpp/convert_hf_to_gguf.py", merged, "--outfile", bf16, "--outtype", "bf16"])
    run(["/opt/llama.cpp/build/bin/llama-quantize", bf16, final, quant])
    os.remove(bf16)
    out_vol.commit()
    return f"{final}: {os.path.getsize(final) / 1e9:.1f} GB"


@app.local_entrypoint()
def inspect(run: str = "pilot-1"):
    print(inspect_remote.remote(run))


@app.local_entrypoint()
def lora(run: str = "pilot-1"):
    print(lora_remote.remote(run))


@app.local_entrypoint()
def merged(run: str = "pilot-1", quant: str = "Q4_K_M"):
    print(merged_remote.remote(run, quant))
