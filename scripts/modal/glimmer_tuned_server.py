"""
Serve the TUNED Glimmer on Modal, next to (never instead of) the base one: a separate app, a separate address, the same API key. The base app (scripts/modal/glimmer_server.py) is not touched.

STATUS (2026-11-04): mode lora has run with a smoke adapter (valid answers, 88 s cold start); mode merged has NEVER RUN. It serves whatever scripts/modal/glimmer_convert.py produced, in one of two ways, chosen when you deploy:

    export PATH="$HOME/Library/Python/3.9/bin:$PATH"; export MODAL_IMAGE_BUILDER_VERSION=2025.06
    TUNED_RUN=pilot-1 TUNED_MODE=lora   modal deploy scripts/modal/glimmer_tuned_server.py    # Meta's Q4_K_M plus the converted LoRA (--lora)
    TUNED_RUN=pilot-1 TUNED_MODE=merged modal deploy scripts/modal/glimmer_tuned_server.py    # the merged and requantised GGUF
    TUNED_SUFFIX=skip TUNED_RUN=pilot-2 TUNED_MODE=lora modal deploy scripts/modal/glimmer_tuned_server.py   # a second app, toyventor-glimmer-tuned-skip, beside the first

The address is https://<workspace>--toyventor-glimmer-tuned.us-east.modal.run (the label below). Point an evaluation at it with
    npm run tune:eval -- run --label tuned --prompt tuned --url https://<workspace>--toyventor-glimmer-tuned.us-east.modal.run/v1 --model forge-glimmer
It scales to zero when idle (never `min_containers`), so it costs nothing between evaluations. Stop it for good with `modal app stop toyventor-glimmer-tuned`.

The speed booster (the drafter that ships with Glimmer) is OFF by default: it was trained for the BASE model and a tuned model may not agree with it. TUNED_DRAFTER=1 turns it on, to measure.
"""

import os
import subprocess
import time
import urllib.error
import urllib.request

import modal

MINUTES = 60
APP_NAME = "toyventor-glimmer-tuned" + (f"-{os.environ['TUNED_SUFFIX']}" if os.environ.get("TUNED_SUFFIX") else "")  # TUNED_SUFFIX=skip deploys a second, separate app so two variants can be evaluated side by side
PORT = 8080
SERVED_NAME = "forge-glimmer"  # what the Worker sends as SELF_TEXT_MODEL for this server
GPU = "L40S"
SCALEDOWN_MINUTES = 10
CONTEXT_TOKENS = 16384
SLOTS = 2

# chosen when YOU deploy, on your machine, and baked into the image so the container sees them
TUNED_RUN = os.environ.get("TUNED_RUN", "pilot-1")
TUNED_MODE = os.environ.get("TUNED_MODE", "lora")
TUNED_DRAFTER = os.environ.get("TUNED_DRAFTER", "0")
if TUNED_MODE not in ("lora", "merged"):
    raise SystemExit("TUNED_MODE must be lora or merged")

BASE_GGUF = "/models/Muse-Glimmer-30B-KQuant-17GB-Q4_K_M.gguf"  # Meta's official build, already in the Volume from glimmer_server.py::download
DRAFT_GGUF = "/models/dflash-Muse-Glimmer-30B-Q4_K_M.gguf"
# the same pinned llama.cpp server image as the base app (build b12063, CUDA 12.8.1, entrypoint /app/llama-server); Glimmer needs b10353 or newer
LLAMA_IMAGE = "ghcr.io/ggml-org/llama.cpp@sha256:d5ffba7d096ab0236c65dc147d797b4b7658a7e5425634593373635d661bccda"
LLAMA_SERVER = "/app/llama-server"

app = modal.App(APP_NAME)
models_vol = modal.Volume.from_name("toyventor-glimmer-models")  # must already exist (glimmer_server.py created it)
out_vol = modal.Volume.from_name("toyventor-tune-out")
server_image = modal.Image.from_registry(LLAMA_IMAGE, add_python="3.12").entrypoint([]).env({"TUNED_RUN": TUNED_RUN, "TUNED_MODE": TUNED_MODE, "TUNED_DRAFTER": TUNED_DRAFTER})


def launch_command():
    """The llama-server command line for the chosen route; raises if a file it needs is not in the Volume."""
    run, mode = os.environ["TUNED_RUN"], os.environ["TUNED_MODE"]
    cmd = [LLAMA_SERVER]
    if mode == "lora":
        lora = f"/out/{run}/lora-f16.gguf"
        needed = [BASE_GGUF, lora]
        cmd += ["-m", BASE_GGUF, "--lora", lora]
    else:
        merged = f"/out/{run}/merged-Q4_K_M.gguf"
        needed = [merged]
        cmd += ["-m", merged]
    if os.environ.get("TUNED_DRAFTER") == "1":
        needed.append(DRAFT_GGUF)
        cmd += ["-md", DRAFT_GGUF, "-ngld", "99"]
    for f in needed:
        if not os.path.exists(f):
            raise RuntimeError(f"{f} is missing: run glimmer_convert.py ({'lora' if mode == 'lora' else 'merged'}) for the run {run!r} first")
    cmd += ["-a", SERVED_NAME, "-ngl", "99", "-c", str(CONTEXT_TOKENS), "-np", str(SLOTS), "--host", "0.0.0.0", "--port", str(PORT), "--jinja", "--temp", "1.0", "--top-p", "0.95", "--top-k", "64"]
    return cmd


@app.cls(
    image=server_image,
    gpu=GPU,
    volumes={"/models": models_vol, "/out": out_vol},
    secrets=[modal.Secret.from_name("glimmer-api-key")],  # the same key as the base server: LLAMA_API_KEY
    min_containers=0,  # never above 0: a tuned server that is not being evaluated must cost nothing
    scaledown_window=SCALEDOWN_MINUTES * MINUTES,
    startup_timeout=10 * MINUTES,
    timeout=10 * MINUTES,
)
@modal.concurrent(max_inputs=SLOTS * 2, target_inputs=SLOTS)
class TunedGlimmerServer:
    @modal.enter()
    def start(self) -> None:
        if not os.environ.get("LLAMA_API_KEY"):
            raise RuntimeError("the Modal secret glimmer-api-key must carry LLAMA_API_KEY (an open model server would answer anyone)")
        self.proc = subprocess.Popen(launch_command())
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
        """Exposes the port llama-server listens on. Public address, bearer-key protected by llama-server itself (/health excepted)."""

    @modal.exit()
    def stop(self) -> None:
        self.proc.terminate()
