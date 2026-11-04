"""
Fine-tune Muse Glimmer 30B (QLoRA, Unsloth) on the dataset built by scripts/tuning/build-dataset.ts: the training half of the Forge v2 candidate.

STATUS: RUN AS A SMOKE ONLY (2026-11-04): 60 steps on a 172-example set, twice (smoke-1, smoke-2). It trains, saves an adapter, resumes from a checkpoint and the adapter converts and serves; no real
run has been made yet and nothing here says a model is trained. It was written on 2026-11-04 from Unsloth's Glimmer guide (unsloth.ai/docs/models/muse-glimmer/train) and its text
fine-tuning notebook (github.com/unslothai/notebooks, python_scripts/Muse_Glimmer_(30B)-Conversational.py). The notebook is LGPL-3.0: this file is NOT a copy of it; it uses the
same library calls and the same documented settings and credits the source. Expect to fix small things on the first run, and read scripts/tuning/README.md before spending anything.

What the guards are for (each is tested in tests/tuning-train.test.ts, which reads this file, because it cannot be run):
  - a dataset whose manifest says "stub", has leaks, or whose files do not match their recorded hashes is REFUSED: a trained model must be traceable to exactly the data it saw;
  - a dataset built with a different prompt version than this script expects is refused: training and serving must use the same prompt (shared/forgeTunePrompt.ts);
  - `--variant keep` (the default) trains only the ANSWER and leaves Glimmer's thinking alone, which is what Unsloth advises and what keeps Meta's safety training least disturbed;
    `--variant skip` also teaches the model to answer without thinking: faster, and the riskier of the two for safety. Judge it with scripts/tuning/eval.ts before any use.

Glimmer's chat format ("ATEM"): every assistant turn goes to a named recipient. The model thinks on `<|start|>assistant to=self<|message|>`, closes with `<|eom|>`, then answers on
`<|start|>assistant to=user<|message|>` and ends with `<|eot|>`. The loss mask below is chosen from those markers (they are the exact strings Unsloth's notebook documents).

Setup, once (the Modal workspace is already logged in; Modal client 1.2.6 needs MODAL_IMAGE_BUILDER_VERSION=2025.06, see scripts/modal/glimmer_server.py):
    export PATH="$HOME/Library/Python/3.9/bin:$PATH"; export MODAL_IMAGE_BUILDER_VERSION=2025.06
    modal volume create toyventor-tune-data
    modal volume put toyventor-tune-data scripts/tuning/data/dataset /dataset
Then, in this order, stopping at the first thing that does not work:
    modal run scripts/modal/glimmer_train.py::smoke   --dataset dataset --run smoke-1     # 60 steps, saves an adapter: does it train at all? (about 1 GPU hour, a few dollars)
    modal run scripts/modal/glimmer_train.py::train   --dataset dataset --run pilot-1     # a full run on the dataset
    modal run scripts/modal/glimmer_train.py::generate --run pilot-1 --n 20               # the adapter writes answers for heldout wishes: is the JSON valid? did it skip thinking?
    modal run scripts/modal/glimmer_train.py::export  --run pilot-1                       # merged 16-bit weights (about 56 GB): the input to GGUF conversion, see the README
"""

import hashlib
import json
import os
import time

import modal

APP_NAME = "toyventor-glimmer-train"
BASE_MODEL = "unsloth/Muse-Glimmer-30B-unsloth-bnb-4bit"  # 4-bit, about 21 GB; Meta's bf16 weights are meta-models/Muse-Glimmer-30B
# The chat template llama-server serves is Meta's (it is inside Meta's GGUF). The Unsloth copy of the model ships an OLDER template that appends a second "Reasoning strength: high." line after ours;
# template-parity.ts caught it on the smoke run (5 of 5 prompts differed). So training renders with Meta's template, pinned to this revision of Meta's repo, and parity is re-checked after every run.
TEMPLATE_REPO = "meta-models/Muse-Glimmer-30B"
TEMPLATE_REVISION = "cec94fcfd6512f2cfe708138c32533b346ea4f69"
TEMPLATE_FILE = "chat_template.jinja"
TRANSFORMERS_PIN = "5.15.0"  # the first release that knows the Glimmer architecture (Unsloth's notebook pins it and asserts it)
EXPECT_PROMPT_VERSION = "t1"  # shared/forgeTunePrompt.ts TUNE_PROMPT_VERSION: the short prompt
# The prompt versions a dataset may carry and the training window each needs: t1 = the short prompt (about 450 tokens an example), p1 = the full production prompt (about 3,600 tokens of prompt plus the
# answer; scripts/tuning/lib/dataset.ts caps an example at 5,000 estimated tokens). Any other version is refused: training and serving must use the same prompt.
PROMPT_WINDOWS = {EXPECT_PROMPT_VERSION: 1024, "p1": 4608}
GPU = os.environ.get("TUNE_GPU", "L40S")  # TUNE_GPU=A100-80GB for the long production prompt if the L40S runs out of memory. L40S: 48 GB (44 usable). Unsloth measured a 21 GB peak at 1024 tokens, r=8, batch 1: a 24 GB card is the realistic minimum, this one has room
MINUTES = 60

# Glimmer's ATEM markers, from Unsloth's notebook. KEEP trains the answer only; SKIP also trains the choice to answer without thinking.
INSTRUCTION_PART = "<|start|>user<|message|>"
RESPONSE_PART = {"keep": "<|start|>assistant to=user<|message|>", "skip": "<|start|>assistant"}

DEFAULTS = {
    "variant": "keep",
    "max_seq_length": 1024,  # Unsloth: start with shorter contexts; our examples are about 450 tokens, the dataset builder caps them at 900
    "r": 16,  # Unsloth's guide: r = 16, lora_alpha = 16 (32 for harder tasks)
    "lora_alpha": 16,
    "learning_rate": 2e-4,  # the guide's LoRA value; its notebook says to reduce to 2e-5 for long runs
    "epochs": 2,
    "max_steps": -1,
    "batch_size": 1,
    "grad_accum": 4,
    "warmup_steps": 5,
    "weight_decay": 0.001,
    "seed": 3407,
    "save_steps": 50,
    "eval_steps": 50,
}

app = modal.App(APP_NAME)
hf_cache = modal.Volume.from_name("toyventor-tune-hf", create_if_missing=True)
data_vol = modal.Volume.from_name("toyventor-tune-data", create_if_missing=True)
out_vol = modal.Volume.from_name("toyventor-tune-out", create_if_missing=True)

# Unsloth and the transformers release that knows Glimmer, resolved together (a second install of transformers after Unsloth worked in Unsloth's notebook, but here the two fit inside Unsloth's own bounds).
image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git")
    # One install with the bounds Unsloth 2026.11.1 itself declares (torch<2.15, datasets<5, trl<=1.15, transformers<=5.17): unpinned, pip picks the newest of each and backtracks for many minutes
    .pip_install("unsloth", "trl<=1.15.0", "datasets<5.0.0", "torch<2.15.0", "accelerate", "bitsandbytes", "huggingface_hub", f"transformers=={TRANSFORMERS_PIN}")
    .env({"HF_HOME": "/root/.cache/huggingface", "TOKENIZERS_PARALLELISM": "false"})
)
VOLUMES = {"/root/.cache/huggingface": hf_cache, "/data": data_vol, "/out": out_vol}


# ---- guards: pure Python, no GPU libraries, so they can run anywhere ---------------------------------------------------------------------------------------------------------------


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def check_dataset(root):
    """Refuse a dataset that is not exactly what its manifest says, or that must not be trained on. Returns the manifest."""
    mpath = os.path.join(root, "manifest.json")
    if not os.path.exists(mpath):
        raise SystemExit(f"{mpath} is missing: build the dataset with scripts/tuning/build-dataset.ts and upload the whole folder")
    with open(mpath) as f:
        m = json.load(f)
    if m.get("source") != "self":
        raise SystemExit(f"REFUSED: the manifest says source={m.get('source')!r}. Only a dataset written by our own model (source 'self') may be trained on; a stub set is canned data for showing the format.")
    if m.get("leaks"):
        raise SystemExit(f"REFUSED: the manifest lists {len(m['leaks'])} leaked wish(es) (evaluation data or heldout wishes in the training files).")
    if m.get("tunePromptVersion") not in PROMPT_WINDOWS:
        raise SystemExit(f"REFUSED: the dataset was built with prompt version {m.get('tunePromptVersion')!r}, this script knows {sorted(PROMPT_WINDOWS)}. Training and serving must use the same prompt (shared/forgeTunePrompt.ts, or the production prompt for p1).")
    for name, rec in m.get("files", {}).items():
        path = os.path.join(root, name)
        if not os.path.exists(path):
            raise SystemExit(f"REFUSED: {name} is listed in the manifest and is not there")
        if sha256_of(path) != rec["sha256"]:
            raise SystemExit(f"REFUSED: {name} does not match the hash in the manifest: the data changed after it was built")
    if m.get("counts", {}).get("perSplit", {}).get("train", 0) < 1:
        raise SystemExit("REFUSED: no training examples")
    return m


def read_jsonl(path):
    with open(path) as f:
        return [json.loads(line) for line in f if line.strip()]


def split_answer(text):
    """The user-channel answer of a raw Glimmer generation, and whether it thought first. `text` is decoded with special tokens kept."""
    thought = "<|start|>assistant to=self" in text or " to=self<|message|>" in text
    marker = "to=user<|message|>"
    i = text.rfind(marker)
    body = text[i + len(marker):] if i >= 0 else text
    for stop in ("<|eot|>", "<|eom|>", "<|end|>"):
        body = body.split(stop)[0]
    return body.strip(), thought


# ---- training ----------------------------------------------------------------------------------------------------------------------------------------------------------------


def make_embedding_callback():
    """Keep Glimmer's 2.5 GB input embedding in CPU memory during training. Unsloth's loader offloads it, and the trainer moves the whole model to the GPU when training starts;
    this puts it back once (Unsloth measured the peak falling from 24.1 to 21.3 GB). The idea and the `_unsloth_embedding_offloaded` flag are from Unsloth's Glimmer notebook;
    this is our own short implementation of it."""
    import torch
    from transformers import TrainerCallback

    class KeepEmbeddingOnCpu(TrainerCallback):
        def on_train_begin(self, args, state, control, **kwargs):
            model = kwargs["model"]
            base = model.get_base_model() if hasattr(model, "get_base_model") else model
            if not getattr(base, "_unsloth_embedding_offloaded", False):
                return control
            emb = model.get_input_embeddings()
            if getattr(getattr(emb, "_hf_hook", None), "execution_device", None) is not None:
                return control  # accelerate owns the placement
            if emb.weight.device.type != "cpu":
                emb.to("cpu")
                torch.cuda.empty_cache()
            return control

    return KeepEmbeddingOnCpu()


def use_serving_template(tokenizer):
    """Give the tokenizer (and the tokenizer inside a processor) Meta's chat template, the one the server renders prompts with. Returns the template's text."""
    from huggingface_hub import hf_hub_download

    with open(hf_hub_download(TEMPLATE_REPO, TEMPLATE_FILE, revision=TEMPLATE_REVISION)) as f:
        text = f.read()
    tokenizer.chat_template = text
    inner = getattr(tokenizer, "tokenizer", None)
    if inner is not None:
        inner.chat_template = text
    return text


def render(tokenizer, messages):
    """The training text of one example: the model's own chat template, minus the leading begin-of-text (the tokenizer adds exactly one)."""
    text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=False)
    bos = getattr(tokenizer, "bos_token", None) or getattr(getattr(tokenizer, "tokenizer", None), "bos_token", None)
    return text.removeprefix(bos) if bos else text


@app.function(image=image, gpu=GPU, timeout=4 * 60 * MINUTES, volumes=VOLUMES)  # no retries=: Modal re-runs a preempted container itself, and a retry on a code error just pays for the model load again (the first smoke run paid four times)
def train_remote(dataset: str, run: str, overrides_json: str = "{}") -> str:
    """Train an adapter. Run again after a preemption or a stop, it resumes from the newest checkpoint in the run folder."""
    overrides = json.loads(overrides_json)
    cfg = {**DEFAULTS, **overrides}
    if cfg["variant"] not in RESPONSE_PART:
        raise SystemExit(f"--variant must be one of {sorted(RESPONSE_PART)}")
    root = f"/data/{dataset}"
    manifest = check_dataset(root)
    if "max_seq_length" not in overrides:
        cfg["max_seq_length"] = PROMPT_WINDOWS[manifest["tunePromptVersion"]]  # the window the dataset's prompt needs, unless you chose one
    out = f"/out/{run}"
    os.makedirs(out, exist_ok=True)

    import unsloth  # noqa: F401 - first, before trl / transformers / peft, or its speed patches are skipped (its own warning on the first smoke run)
    import torch
    import transformers

    assert transformers.__version__ == TRANSFORMERS_PIN, f"transformers {transformers.__version__} is installed, Glimmer needs {TRANSFORMERS_PIN}"
    from datasets import Dataset
    from trl import SFTConfig, SFTTrainer
    from unsloth import FastModel
    from unsloth.chat_templates import train_on_responses_only

    versions = {"torch": torch.__version__, "transformers": transformers.__version__, "cuda": torch.version.cuda, "gpu": torch.cuda.get_device_name(0)}
    for mod in ("unsloth", "trl", "datasets", "accelerate", "bitsandbytes"):
        try:
            versions[mod] = __import__(mod).__version__
        except Exception:  # noqa: BLE001 - a missing __version__ must not stop a run
            versions[mod] = "unknown"
    with open(f"{out}/run.json", "w") as f:
        json.dump({"run": run, "dataset": dataset, "config": cfg, "versions": versions, "manifest": manifest, "started": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}, f, indent=2)

    model, tokenizer = FastModel.from_pretrained(model_name=BASE_MODEL, max_seq_length=cfg["max_seq_length"])
    use_serving_template(tokenizer)
    # The exact prompt text this tokenizer builds for the first heldout wishes, written NOW (the generate check takes 40 minutes) so scripts/tuning/template-parity.ts can compare it with the server's.
    if os.path.exists(f"{root}/heldout.jsonl"):
        with open(f"{out}/prompt_check.json", "w") as f:
            json.dump({"results": [{"id": r["id"], "rendered_prompt": tokenizer.apply_chat_template(r["messages"], add_generation_prompt=True, tokenize=False)} for r in read_jsonl(f"{root}/heldout.jsonl")[:5]]}, f)
    model = FastModel.get_peft_model(
        model,
        finetune_vision_layers=False,  # text only
        finetune_language_layers=True,
        finetune_attention_modules=True,
        finetune_mlp_modules=True,
        r=cfg["r"],
        lora_alpha=cfg["lora_alpha"],
        lora_dropout=0,
        bias="none",
        use_gradient_checkpointing="unsloth",
        random_state=cfg["seed"],
    )

    def load(name):
        return Dataset.from_list([{"text": render(tokenizer, r["messages"])} for r in read_jsonl(f"{root}/{name}")])

    train_ds, val_ds = load("train.jsonl"), load("val.jsonl")
    ckpts = f"{out}/checkpoints"
    trainer = SFTTrainer(
        model=model,
        processing_class=tokenizer,  # trl 1.x renamed `tokenizer` (a TypeError on the first smoke run, 2026-11-04)
        train_dataset=train_ds,
        eval_dataset=val_ds if len(val_ds) else None,
        args=SFTConfig(
            dataset_text_field="text",
            max_length=cfg["max_seq_length"],
            loss_type="nll",  # not TRL's default chunked loss: with gradient accumulation it silently divides the loss twice on this model class (Unsloth's notebook explains)
            per_device_train_batch_size=cfg["batch_size"],
            gradient_accumulation_steps=cfg["grad_accum"],
            warmup_steps=cfg["warmup_steps"],
            num_train_epochs=cfg["epochs"],
            max_steps=cfg["max_steps"],
            learning_rate=cfg["learning_rate"],
            logging_steps=1,
            optim="adamw_8bit",
            weight_decay=cfg["weight_decay"],
            lr_scheduler_type="linear",
            seed=cfg["seed"],
            output_dir=ckpts,
            save_steps=cfg["save_steps"],
            eval_strategy="steps" if len(val_ds) else "no",
            eval_steps=cfg["eval_steps"],
            report_to="none",
        ),
    )
    trainer = train_on_responses_only(trainer, instruction_part=INSTRUCTION_PART, response_part=RESPONSE_PART[cfg["variant"]])
    trainer.add_callback(make_embedding_callback())

    # What the loss sees: print one example's unmasked text so a human can check that only the answer (variant keep) or the channel choice and answer (skip) is trained.
    text_tok = getattr(tokenizer, "tokenizer", tokenizer)
    probe = trainer.train_dataset[0]
    shown = [text_tok(" ", add_special_tokens=False).input_ids[0] if x == -100 else x for x in probe["labels"]]
    with open(f"{out}/mask_check.txt", "w") as f:
        f.write(f"variant={cfg['variant']}\n--- full text ---\n{render(tokenizer, read_jsonl(f'{root}/train.jsonl')[0]['messages'])}\n--- what the loss sees ---\n{tokenizer.decode(shown)}\n")

    resume = None
    if os.path.isdir(ckpts):
        found = sorted((d for d in os.listdir(ckpts) if d.startswith("checkpoint-")), key=lambda d: int(d.split("-")[1]))
        resume = f"{ckpts}/{found[-1]}" if found else None
    stats = trainer.train(resume_from_checkpoint=resume)

    model.save_pretrained(f"{out}/adapter")
    tokenizer.save_pretrained(f"{out}/adapter")
    with open(f"{out}/metrics.json", "w") as f:
        json.dump({"train": stats.metrics, "log": trainer.state.log_history, "peak_reserved_gb": round(torch.cuda.max_memory_reserved() / 2**30, 2), "resumed_from": resume}, f, indent=2)
    out_vol.commit()
    return f"{out}/adapter"


# ---- generation check and export ---------------------------------------------------------------------------------------------------------------------------------------------


@app.function(image=image, gpu=GPU, timeout=60 * MINUTES, volumes=VOLUMES)
def generate_remote(run: str, dataset: str = "dataset", n: int = 20) -> str:
    """Write answers for the first n heldout wishes with the trained adapter, and report how many are valid JSON and how many thought first. Not the evaluation: that goes through the
    real pipeline (scripts/tuning/eval.ts) once the model is served. This is the quick check that the adapter learned the format and what it did to the thinking."""
    from unsloth import FastModel

    model, tokenizer = FastModel.from_pretrained(model_name=f"/out/{run}/adapter", max_seq_length=max(PROMPT_WINDOWS.values()))
    use_serving_template(tokenizer)
    rows = read_jsonl(f"/data/{dataset}/heldout.jsonl")[:n]
    results = []
    for r in rows:
        inputs = tokenizer.apply_chat_template(r["messages"], add_generation_prompt=True, return_tensors="pt", tokenize=True, return_dict=True).to("cuda")
        t0 = time.time()
        gen = model.generate(**inputs, max_new_tokens=1536, temperature=1.0, top_p=0.95, top_k=64)
        raw = tokenizer.decode(gen[0][inputs["input_ids"].shape[1]:], skip_special_tokens=False)
        answer, thought = split_answer(raw)
        try:
            parsed = json.loads(answer)
            valid = isinstance(parsed, dict) and "recipe" in parsed and isinstance(parsed.get("names"), dict) and len(parsed["names"]) == 7
        except ValueError:
            valid = False
        # the exact prompt text this tokenizer built, so scripts/tuning/template-parity.ts can compare it with what llama-server builds from the same messages
        rendered = tokenizer.apply_chat_template(r["messages"], add_generation_prompt=True, tokenize=False) if len(results) < 5 else None
        results.append({"id": r["id"], "wish": r["wish"], "rendered_prompt": rendered, "valid": valid, "thought_first": thought, "new_tokens": int(gen.shape[1] - inputs["input_ids"].shape[1]), "seconds": round(time.time() - t0, 1), "answer": answer[:1500]})
    summary = {"run": run, "n": len(results), "valid_json": sum(x["valid"] for x in results), "thought_first": sum(x["thought_first"] for x in results), "mean_new_tokens": round(sum(x["new_tokens"] for x in results) / max(1, len(results)), 1)}
    with open(f"/out/{run}/generate_check.json", "w") as f:
        json.dump({"summary": summary, "results": results}, f, indent=2)
    out_vol.commit()
    return json.dumps(summary)


@app.function(image=image, gpu=GPU, timeout=2 * 60 * MINUTES, memory=96 * 1024, volumes=VOLUMES)
def export_remote(run: str) -> str:
    """Merge the adapter into 16-bit weights (about 56 GB on disk; the merge needs about 64 GB of RAM, hence the memory request). GGUF is NOT made here: Unsloth's own notebook says its
    GGUF export drives an upstream llama.cpp that had no Glimmer architecture when it was written, while Meta's GGUF page says llama.cpp supports it from build b10353. Converting the merged
    folder with llama.cpp's convert_hf_to_gguf.py is the thing to try next, and it is untested: see scripts/tuning/README.md."""
    from unsloth import FastModel

    model, tokenizer = FastModel.from_pretrained(model_name=f"/out/{run}/adapter", max_seq_length=max(PROMPT_WINDOWS.values()))
    use_serving_template(tokenizer)
    dest = f"/out/{run}/merged-16bit"
    model.save_pretrained_merged(dest, tokenizer)
    out_vol.commit()
    return dest


@app.local_entrypoint()
def smoke(dataset: str = "dataset", run: str = "smoke-1", variant: str = "keep"):
    """60 steps: does it train and save an adapter at all?"""
    print(train_remote.remote(dataset, run, json.dumps({"variant": variant, "max_steps": 60, "epochs": 1, "save_steps": 30, "eval_steps": 30})))


@app.local_entrypoint()
def train(dataset: str = "dataset", run: str = "pilot-1", variant: str = "keep", epochs: int = 2, learning_rate: float = 2e-4, r: int = 16):
    """A full run on the dataset."""
    print(train_remote.remote(dataset, run, json.dumps({"variant": variant, "epochs": epochs, "learning_rate": learning_rate, "r": r, "lora_alpha": r})))


@app.local_entrypoint()
def generate(run: str = "pilot-1", dataset: str = "dataset", n: int = 20):
    """The adapter writes answers for heldout wishes: valid JSON? thought first?"""
    print(generate_remote.remote(run, dataset, n))


@app.local_entrypoint()
def export(run: str = "pilot-1"):
    """Merged 16-bit weights, the input to GGUF conversion."""
    print(export_remote.remote(run))
