"""
Whisper large-v3-turbo served on Modal: the speech model behind the microphone button in Describe & build. The home for a child's voice (Meta's hosted speech model is a demo-only exception, chosen with TRANSCRIBE_BACKEND=hosted: worker/transcribe.ts)
(docs/decisions/0008-meta-models-and-under-18-users.md; the Worker route is worker/transcribe.ts: it runs on a self-hosted address, or on Meta's only when TRANSCRIBE_BACKEND=hosted was written out on purpose).

STATUS: WRITTEN 2026-11-04. NOT DEPLOYED, NOT RUN: it has been syntax-checked and nothing more. The Modal API it uses (@app.cls, @modal.enter, @modal.concurrent,
@modal.asgi_app, Volume, Secret) is the same set the Glimmer file (scripts/modal/glimmer_server.py) uses, which was deployed on the Modal 1.2.6 client and worked; the
transformers calls follow the model card of openai/whisper-large-v3-turbo. What nobody has measured yet: the cold start (container plus model load), the latency of an
8 second clip, and how it does on children's speech (the model card says accuracy is uneven across accents and dialects, and children's speech is not discussed).
Deploying is Dan's call: it creates a Modal app and bills GPU time while a container is up.

What it is: the OpenAI-compatible transcription call, POST /v1/audio/transcriptions (multipart: file, model, response_format "json", optional language, optional
temperature), answering {"text": "..."}; GET /health. Every call except /health needs the bearer key. The model is the official openai/whisper-large-v3-turbo
(MIT licence, not gated), pinned to one revision below: only that repository at that revision is ever loaded (community copies of speech models exist, and a child's
voice is not sent to one). Audio is decoded in memory (ffmpeg), handled in memory and never written to disk, and neither the audio nor the words are logged here.
Limits, enforced here as well as in the Worker: 2 MB of upload, 15 seconds of sound; sound that is silent is answered with an empty text without running the model
(Whisper invents words such as "Thank you for watching" for silence).

Setup (once, by you; nothing below prints a secret). It is the Glimmer setup with different names; the notes there about modal living under Python 3.9 apply:
  1. export PATH="$HOME/Library/Python/3.9/bin:$PATH"      (and export MODAL_IMAGE_BUILDER_VERSION=2025.06 with the 1.2.6 client; not needed with modal 1.6+ on Python 3.10+)
  2. The server's API key, written to Modal and to .dev.vars in one step so you never see it:
       K=$(openssl rand -hex 24) && modal secret create whisper-api-key WHISPER_API_KEY=$K && printf 'SELF_TRANSCRIBE_KEY=%s\\n' "$K" >> .dev.vars
  3. Download the weights into a Modal Volume (about 1.6 GB, once):
       modal run scripts/modal/whisper_server.py::download
  4. Deploy:
       modal deploy scripts/modal/whisper_server.py
     then the Worker settings (.dev.vars locally; wrangler secrets / vars when deployed). `modal deploy` prints the address (it is fixed by the label below):
       TRANSCRIBE_BACKEND=self
       SELF_TRANSCRIBE_URL=<the address modal deploy printed, with or without a trailing /v1>
     (SELF_TRANSCRIBE_KEY was written in step 2. Meta's hosted model answers only when TRANSCRIBE_BACKEND is exactly `hosted`: with it unset the route stays off.)
  5. Check it: curl <address>/health (no key needed), then a real clip through the Worker:  curl -s -X POST localhost:5173/api/transcribe -H 'content-type: audio/wav'
     --data-binary @clip.wav  (the Describe tab shows its microphone only once GET /api/transcribe says enabled).

Cost: a T4 GPU is billed while a container is up (Modal's list price, check it live). With MIN_CONTAINERS = 0 the app scales to zero after SCALEDOWN_MINUTES idle, so the first
press of the microphone after a quiet spell waits for the container and the model to load (allow a minute or more, the page says it is "listening" and then "thinking").
Set MIN_CONTAINERS = 1 for a demo day, and back to 0 afterwards.
"""

import hmac
import os

import modal

MINUTES = 60

# ---- settings you may change -------------------------------------------------------------------------------------------------------------------------
GPU = "T4"  # 16 GB. The model is about 1.6 GB in half precision, so a small card is plenty; "L4" or "A10" if the cold start or the speed is not good enough.
MIN_CONTAINERS = 0
SCALEDOWN_MINUTES = 5
SLOTS = 4  # clips handled at once in one container

# ---- fixed ---------------------------------------------------------------------------------------------------------------------------------------------
APP_NAME = "toyventor-whisper"
MODEL_REPO = "openai/whisper-large-v3-turbo"  # official, MIT, not gated
# The exact commit of that repository the files were taken from (read from the Hugging Face API 2026-11-04, last modified 2024-10-04). Without it a download would follow the
# repository's newest files; only this official repository and this revision may be served.
MODEL_REVISION = "41f01f3fe87f28c78e2fbf8b568835947dd65ed9"
MODELS_DIR = "/models"
MODEL_SUBDIR = "whisper-large-v3-turbo"
MAX_UPLOAD_BYTES = 2_000_000
MAX_SECONDS = 15
SAMPLE_RATE = 16000
SILENCE_RMS = 1e-4  # quieter than this is silence

app = modal.App(APP_NAME)
models_vol = modal.Volume.from_name("toyventor-whisper-models", create_if_missing=True)

download_image = modal.Image.debian_slim(python_version="3.12").pip_install("huggingface_hub")
server_image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg")  # transformers decodes webm / mp4 / ogg / wav bytes with it
    .pip_install("torch", "transformers", "accelerate", "numpy", "fastapi", "python-multipart")
)


@app.function(image=download_image, volumes={MODELS_DIR: models_vol}, timeout=30 * MINUTES)
def download() -> None:
    """One-off: copy the model from Hugging Face into the Volume, at the pinned revision. Safe to run again (files already there are skipped)."""
    from huggingface_hub import snapshot_download

    path = snapshot_download(
        repo_id=MODEL_REPO,
        revision=MODEL_REVISION,
        local_dir=f"{MODELS_DIR}/{MODEL_SUBDIR}",
        allow_patterns=["*.json", "*.txt", "*.safetensors"],
    )
    size = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(path) for f in fs)
    print(f"{MODEL_REPO}@{MODEL_REVISION}: {size / 1e9:.2f} GB at {path}")
    models_vol.commit()


@app.cls(
    image=server_image,
    gpu=GPU,
    volumes={MODELS_DIR: models_vol},
    secrets=[modal.Secret.from_name("whisper-api-key")],  # one key, WHISPER_API_KEY
    min_containers=MIN_CONTAINERS,
    scaledown_window=SCALEDOWN_MINUTES * MINUTES,
    startup_timeout=10 * MINUTES,  # the container starting and the model loading
    timeout=5 * MINUTES,
)
@modal.concurrent(max_inputs=SLOTS * 2, target_inputs=SLOTS)
class WhisperServer:
    @modal.enter()
    def load(self) -> None:
        import torch
        from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor, pipeline

        path = f"{MODELS_DIR}/{MODEL_SUBDIR}"
        if not os.path.exists(f"{path}/model.safetensors"):
            raise RuntimeError("the model is not in the Volume: run `modal run scripts/modal/whisper_server.py::download` first")
        self.key = os.environ.get("WHISPER_API_KEY", "")
        if not self.key:
            raise RuntimeError("the Modal secret whisper-api-key must carry WHISPER_API_KEY (an open speech server would answer anyone)")
        model = AutoModelForSpeechSeq2Seq.from_pretrained(path, torch_dtype=torch.float16, low_cpu_mem_usage=True, use_safetensors=True, local_files_only=True).to("cuda:0")
        processor = AutoProcessor.from_pretrained(path, local_files_only=True)
        self.pipe = pipeline(
            "automatic-speech-recognition",
            model=model,
            tokenizer=processor.tokenizer,
            feature_extractor=processor.feature_extractor,
            torch_dtype=torch.float16,
            device="cuda:0",
        )

    @modal.asgi_app(label=APP_NAME)
    def web(self):
        import numpy as np
        from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
        from transformers.pipelines.audio_utils import ffmpeg_read

        api = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)  # no public schema page

        @api.get("/health")
        def health():
            return {"ok": True}

        @api.post("/v1/audio/transcriptions")
        async def transcriptions(
            request: Request,
            file: UploadFile = File(...),
            model: str = Form(""),
            response_format: str = Form("json"),
            language: str = Form(""),
            temperature: float = Form(0.0),
        ):
            # the key first, in constant time, before anything is read
            sent = request.headers.get("authorization", "")
            if not hmac.compare_digest(sent.encode(), f"Bearer {self.key}".encode()):
                raise HTTPException(status_code=401, detail="unauthorized")
            data = await file.read(MAX_UPLOAD_BYTES + 1)
            if len(data) > MAX_UPLOAD_BYTES:
                raise HTTPException(status_code=413, detail="too large")
            if not data:
                raise HTTPException(status_code=422, detail="empty")
            try:
                samples = ffmpeg_read(data, SAMPLE_RATE)  # float32 mono at 16 kHz, decoded in memory
            except Exception:
                raise HTTPException(status_code=415, detail="not audio")
            if len(samples) / SAMPLE_RATE > MAX_SECONDS:
                raise HTTPException(status_code=413, detail="too long")
            if len(samples) == 0 or float(np.sqrt(np.mean(np.square(samples)))) < SILENCE_RMS:
                return {"text": ""}  # silence: Whisper would invent words for it
            kwargs = {"task": "transcribe"}
            if language.strip():
                kwargs["language"] = language.strip()
            out = self.pipe({"raw": samples, "sampling_rate": SAMPLE_RATE}, generate_kwargs=kwargs, return_timestamps=False)
            return {"text": str(out.get("text", "")).strip()}

        return api

    @modal.exit()
    def stop(self) -> None:
        self.pipe = None
