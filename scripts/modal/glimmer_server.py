"""
Muse Glimmer 30B (official 4-bit GGUF) served on Modal with llama.cpp's llama-server: Glimmer v1, the model behind child-facing text to part.

Why this exists: the Meta Model API terms (section 10.1) bar End Users under 18 and products targeted at them, so the child-facing product runs on a model
we host ourselves (docs/decisions/0008-meta-models-and-under-18-users.md). v1 is base Glimmer, prompted; the tuned model is v2, after the hackathon.

STATUS: written 2026-11-03 against the official GGUF README and the Modal 1.2.6 client that is installed on this Mac (the last release that runs on Python 3.9; its
`@app.cls` + `@modal.web_server` + `@modal.concurrent` signatures were read from the installed source). DEPLOYED AND MEASURED 2026-11-04: the server cold-started in
26 s, refused a request with no key (401), and answered the model card's own check with 391. The 40-wish run through the real Worker code gave 33 of 37 wishes
printable (89%), all 33 printable, median 25.7 s to a finished part - and 4 wishes got no answer at all (three HTTP 500s inside 1.5 s and one 55 s timeout), whose
cause is still unknown: the Modal logs were not readable. Modal 1.6 added a newer `@app.server` decorator that needs Python 3.10 or newer; this file does not use it.

What it serves: an OpenAI-compatible API (/v1/chat/completions, /health) from llama-server, protected by an API key. Glimmer's thinking comes back in
`reasoning_content`, the answer in `content`; the Worker reads `content` only. Reasoning strength is set by the Worker in the system prompt
("Reasoning strength: low"), not here.

Setup (once, by you; nothing below prints a secret):
  1. modal is installed under Python 3.9 and is not on PATH, so first (in each new terminal, or add it to ~/.zshrc):
       export PATH="$HOME/Library/Python/3.9/bin:$PATH"
     (`modal setup` is already done: the token is in ~/.modal.toml, workspace diydan82.)
     With the 1.2.6 client the workspace's newest image builder is refused, so also: export MODAL_IMAGE_BUILDER_VERSION=2025.06
     (not needed with modal 1.6 or newer, which needs Python 3.10+: `uv tool install modal`).
  2. The server's API key, written to Modal and to .dev.vars in one step so you never see it:
       K=$(openssl rand -hex 24) && modal secret create glimmer-api-key LLAMA_API_KEY=$K && printf 'SELF_TEXT_KEY=%s\\n' "$K" >> .dev.vars
  3. Download the weights into a Modal Volume (18.4 GB, once):
       modal run scripts/modal/glimmer_server.py::download
  4. Deploy:
       modal deploy scripts/modal/glimmer_server.py
     then the Worker settings (.dev.vars locally; wrangler secrets / vars when deployed). The address is fixed by the label below, and `modal deploy` prints it:
       MODEL_BACKEND=self      (or TEXT_BACKEND=self to switch only the text capability)
       SELF_TEXT_URL=https://diydan82--toyventor-glimmer.us-east.modal.run/v1
       SELF_TEXT_MODEL=muse-glimmer-30B
       SELF_TEXT_API=chat
     (SELF_TEXT_KEY was written in step 2.)
  5. Check it: curl <url>/health, then the 40-wish run (scripts kept in the session scratchpad: acceptance.mts) against Spark's 97% first-call printable
     and its 27 to 31 s median (recomputed from the saved results).

Cost (Modal list prices read 2026-11-01, check live): L40S about $1.95 an hour while a container is up. With MIN_CONTAINERS = 0 it scales to zero after
SCALEDOWN_MINUTES idle, so a cold first request waits for the container and for the 17 GB model to load (allow a few minutes).

COST DEFAULT (Dan, 2026-11-04: "we want to keep cheaper for now"): MIN_CONTAINERS defaults to 0, so the container scales to zero when idle and the first request after a quiet spell
waits for a cold start (26 to 150+ seconds measured). For a live demo of Glimmer, keep one container up (about $47 a day for as long as that version is deployed):
    GLIMMER_MIN_CONTAINERS=1 modal deploy scripts/modal/glimmer_server.py
and go back afterwards with a plain `modal deploy scripts/modal/glimmer_server.py`. The variable is read when you deploy, on your machine. Nothing changes until the next deploy.
"""

import os
import subprocess
import time
import urllib.error
import urllib.request

import modal

MINUTES = 60

# ---- settings you may change -------------------------------------------------------------------------------------------------------------------------
GPU = "L40S"  # 48 GB. The 17 GB build plus the drafter and a 16k context is about 20 GB, so "A10" (24 GB) is the tight, cheaper option.
MIN_CONTAINERS = int(os.environ.get("GLIMMER_MIN_CONTAINERS", "0"))  # 0 = scale to zero (cheap); GLIMMER_MIN_CONTAINERS=1 at deploy time keeps one container warm (about $47 a day)
SCALEDOWN_MINUTES = 10
CONTEXT_TOKENS = 16384  # shared by the slots below: 8192 each. The make prompt is about 3k tokens and the reply under 2k.
SLOTS = 2

# ---- fixed ---------------------------------------------------------------------------------------------------------------------------------------------
APP_NAME = "toyventor-glimmer"
PORT = 8080
SERVED_NAME = "muse-glimmer-30B"  # what the Worker sends as SELF_TEXT_MODEL
MODEL_REPO = "meta-models/Muse-Glimmer-30B-GGUF"  # official, Apache 2.0, not gated
# The exact commit of that repository the files were taken from (read from the Hugging Face API 2026-11-04, last modified 2026-10-20). Without it a download would follow the
# repository's newest files, and community copies of Glimmer ("abliterated", "uncensored") exist: only this official repository and this revision may be served.
MODEL_REVISION = "b44f1072cf75e918a1b82a3a17b45c4389b076e7"
MODEL_FILE = "Muse-Glimmer-30B-KQuant-17GB-Q4_K_M.gguf"  # 16.8 GB, "start here", fits 24 GB
DRAFT_FILE = "dflash-Muse-Glimmer-30B-Q4_K_M.gguf"  # 1.6 GB DFlash drafter: speculative decoding, same outputs, faster
MODELS_DIR = "/models"
# llama.cpp's official CUDA server image, pinned by digest (an immutable reference, checked 2026-11-03: build b12063, CUDA 12.8.1, entrypoint
# /app/llama-server). Glimmer needs llama.cpp build b10353 or newer. If Modal will not take a digest, use ghcr.io/ggml-org/llama.cpp:server-cuda
# (floating) and record the build you got.
LLAMA_IMAGE = "ghcr.io/ggml-org/llama.cpp@sha256:d5ffba7d096ab0236c65dc147d797b4b7658a7e5425634593373635d661bccda"
LLAMA_SERVER = "/app/llama-server"

app = modal.App(APP_NAME)
models_vol = modal.Volume.from_name("toyventor-glimmer-models", create_if_missing=True)

download_image = modal.Image.debian_slim(python_version="3.12").pip_install("huggingface_hub")
server_image = modal.Image.from_registry(LLAMA_IMAGE, add_python="3.12").entrypoint([])


@app.function(image=download_image, volumes={MODELS_DIR: models_vol}, timeout=60 * MINUTES)
def download() -> None:
    """One-off: copy the model and the drafter from Hugging Face into the Volume. Safe to run again (files already there are skipped)."""
    from huggingface_hub import hf_hub_download

    for name in (MODEL_FILE, DRAFT_FILE):
        path = hf_hub_download(repo_id=MODEL_REPO, filename=name, revision=MODEL_REVISION, local_dir=MODELS_DIR)
        print(f"{name}: {os.path.getsize(path) / 1e9:.2f} GB at {path}")
    models_vol.commit()


@app.cls(
    image=server_image,
    gpu=GPU,
    volumes={MODELS_DIR: models_vol},
    secrets=[modal.Secret.from_name("glimmer-api-key")],  # one key, LLAMA_API_KEY; llama-server reads it from the environment
    min_containers=MIN_CONTAINERS,
    scaledown_window=SCALEDOWN_MINUTES * MINUTES,
    startup_timeout=10 * MINUTES,  # the container starting and the 17 GB model loading
    timeout=10 * MINUTES,
)
@modal.concurrent(max_inputs=SLOTS * 2, target_inputs=SLOTS)  # llama-server queues beyond its slots; Modal scales out when the target is passed
class GlimmerServer:
    @modal.enter()
    def start(self) -> None:
        for name in (MODEL_FILE, DRAFT_FILE):
            if not os.path.exists(f"{MODELS_DIR}/{name}"):
                raise RuntimeError(f"{name} is not in the Volume: run `modal run scripts/modal/glimmer_server.py::download` first")
        if not os.environ.get("LLAMA_API_KEY"):
            raise RuntimeError("the Modal secret glimmer-api-key must carry LLAMA_API_KEY (an open model server would answer anyone)")
        cmd = [
            LLAMA_SERVER,
            "-m", f"{MODELS_DIR}/{MODEL_FILE}",
            "-md", f"{MODELS_DIR}/{DRAFT_FILE}", "-ngld", "99",  # speculative decoding with the drafter (a harmless "[spec] failed to measure draft model memory" is expected)
            "-a", SERVED_NAME,
            "-ngl", "99",
            "-c", str(CONTEXT_TOKENS), "-np", str(SLOTS),
            "--host", "0.0.0.0", "--port", str(PORT),
            "--jinja",
            "--temp", "1.0", "--top-p", "0.95", "--top-k", "64",  # the model card's recommended sampling
        ]
        self.proc = subprocess.Popen(cmd)
        deadline = time.time() + 9 * MINUTES
        while time.time() < deadline:
            if self.proc.poll() is not None:
                raise RuntimeError(f"llama-server exited with code {self.proc.returncode} while loading the model")
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/health", timeout=5) as r:
                    if r.status == 200:
                        return
            except (urllib.error.URLError, OSError):
                pass
            time.sleep(2)
        raise RuntimeError("llama-server did not become healthy in time")

    @modal.web_server(PORT, startup_timeout=10 * MINUTES, label=APP_NAME)
    def serve(self) -> None:
        """Exposes the port llama-server is already listening on (started in start). The address is https://<workspace>--toyventor-glimmer.us-east.modal.run (the region is part of it; `modal deploy` prints it).
        The URL is public; every API call still needs the bearer key (llama-server's own check, /health excepted). Modal's proxy auth (requires_proxy_auth) would
        need Modal-Key headers our Worker does not send."""

    @modal.exit()
    def stop(self) -> None:
        self.proc.terminate()
