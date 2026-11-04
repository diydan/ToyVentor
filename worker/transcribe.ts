// POST /api/transcribe: a few seconds of a child's voice in, the words out, for the microphone button in Describe & build (docs/specs/describe-and-build-viewer-spec.md).
//
// WHO HEARS A CHILD'S VOICE. docs/decisions/0008-meta-models-and-under-18-users.md: the route for children is a speech model we host ourselves (Whisper large-v3-turbo, MIT, on Modal:
// scripts/modal/whisper_server.py), because Meta's Model API terms (10.1) are for adult end users. Two modes, both fail closed and neither falls back to the other:
//   - "self": `transcribe` is in mode "self" with an https address set (worker/modelBackend.ts). The intended mode for children.
//   - "hosted" (Meta's `muse-voice-transcribe-1.0`): a TEMPORARY exception for the Nov 4 demo (Dan, 2026-11-04: "use meta for demo and we will self host in the future"; review after
//     the hackathon). It is on ONLY when TRANSCRIBE_BACKEND is set to exactly "hosted" and the Meta key is set. An unset switch, MODEL_BACKEND=hosted and DEFAULT_MODE do NOT turn it
//     on, so deploying the code never switches a child's voice to Meta by itself: someone has to choose it. To end the exception, unset TRANSCRIBE_BACKEND (or set it to self or off).
// "off", a missing key, a missing or non-https self address, or a misspelt mode are off.
//
//   GET  /api/transcribe       {ok, route, contract, enabled}  a free probe: the page shows its microphone button only when this says enabled
//   POST /api/transcribe       the audio bytes as the body, Content-Type audio/webm | audio/mp4 | audio/ogg | audio/wav  ->  {text, note?}
//
// What it does to the audio: reads at most MAX_AUDIO_BYTES (enforced on the bytes actually read), checks the type is on the allow-list and that the first bytes really are that
// kind of file, checks a WAV's own length (a compressed file's length is bounded by the size cap and the page's 8 s timer), and forwards it, in memory, to the speech model's
// OpenAI-compatible endpoint (POST <SELF_TRANSCRIBE_URL>/v1/audio/transcriptions, multipart, model whisper-large-v3-turbo, language left to the model).
// What it does to the words: trims them, takes out phone numbers and email addresses (scrubContactDetails), caps them at 300 characters, and withholds them (an empty `text` and a
// kind `note`) when they fail the same kid-safe text check every kid-facing route uses: the unsafe words themselves are never sent back.
// What it never does: store the audio or the words, log either (the log line carries a status and a mode, nothing else), return the speech model's address or key, or build anything:
// the words land in a text box for the child to see and change, and only the child's own press of "Build it" sends them anywhere else.
import { type HostedGateEnv, requireHostedGate } from "./hostedGate";
import { kidSafeText, scrubContactDetails } from "./muse";
import { parseSelfUrl, resolveBackend, type BackendEnv } from "./modelBackend";

export const TRANSCRIBE_CONTRACT = 1;
/** The page records 8 s at most; a compressed 8 s clip is well under 200 KB, so this leaves room and still stops anything that is not a short voice clip. */
export const MAX_AUDIO_BYTES = 1_500_000;
export const MAX_WAV_SECONDS = 10;
export const MAX_TEXT_CHARS = 300;
const MIN_AUDIO_BYTES = 200; // anything smaller is a header with no sound in it
const WHISPER_MODEL = "whisper-large-v3-turbo";
const WHISPER_TIMEOUT_MS = 25_000;
/** Meta's speech model and the one audio format its file endpoint takes (dev.meta.ai/docs/api-reference/voice/transcribe, read 2026-11-04): a RIFF/WAVE of mono integer PCM at 16 or 24 kHz. */
export const META_ASR_MODEL = "muse-voice-transcribe-1.0";
const META_WAV_RATES: ReadonlySet<number> = new Set([16000, 24000]);
/** In-isolate per-IP budget. Best effort only (requests can land on different isolates); the Cloudflare dashboard rule is the durable limit, like the other metered routes. */
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_WINDOW = 8;
const recentHits = new Map<string, number[]>();

export interface TranscribeEnv extends BackendEnv, HostedGateEnv {}

export function transcribeRateLimited(ip: string | null | undefined, now = Date.now()): boolean {
  if (!ip) return false;
  const hits = (recentHits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  hits.push(now);
  recentHits.set(ip, hits);
  return hits.length > RATE_MAX_PER_WINDOW;
}
/** Test hook: forget every counter. */
export function resetTranscribeLimits(): void {
  recentHits.clear();
}

type Kind = "webm" | "mp4" | "ogg" | "wav";
const KIND_OF_TYPE: Readonly<Record<string, Kind>> = {
  "audio/webm": "webm",
  "audio/mp4": "mp4",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
};
const FILE_TYPE: Readonly<Record<Kind, { mime: string; name: string }>> = {
  webm: { mime: "audio/webm", name: "voice.webm" },
  mp4: { mime: "audio/mp4", name: "voice.mp4" },
  ogg: { mime: "audio/ogg", name: "voice.ogg" },
  wav: { mime: "audio/wav", name: "voice.wav" },
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

/** The allow-listed kind of a Content-Type (parameters such as `;codecs=opus` ignored, case ignored), or null. */
export function audioKindOf(contentType: string | null): Kind | null {
  const base = (contentType ?? "").split(";")[0]!.trim().toLowerCase();
  return KIND_OF_TYPE[base] ?? null;
}

const ascii = (b: Uint8Array, at: number, s: string) => s.length + at <= b.length && [...s].every((c, i) => b[at + i] === c.charCodeAt(0));

/** True when the first bytes are really that kind of file: a payload that is not audio is never forwarded to the speech model. */
export function looksLike(kind: Kind, b: Uint8Array): boolean {
  if (kind === "webm") return b.length > 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3; // EBML header (Matroska/WebM)
  if (kind === "ogg") return ascii(b, 0, "OggS");
  if (kind === "mp4") return ascii(b, 4, "ftyp");
  return ascii(b, 0, "RIFF") && ascii(b, 8, "WAVE");
}

/** Seconds of sound in a PCM WAV from its own header (byte rate and data size), or null when it cannot be read: the length of any other kind is bounded by the size cap. */
export function wavSeconds(b: Uint8Array): number | null {
  if (b.length < 44) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const byteRate = v.getUint32(28, true);
  if (!byteRate) return null;
  // the data chunk is usually the first after "fmt ", but search so a LIST chunk in between does not hide it
  let at = 12;
  while (at + 8 <= b.length) {
    const size = v.getUint32(at + 4, true);
    if (ascii(b, at, "data")) return Math.min(size, b.length - at - 8) / byteRate;
    at += 8 + size + (size % 2);
  }
  return null;
}

/** Is this the WAV Meta's file endpoint takes: integer PCM (format 1), ONE channel, 16 bits, 16 kHz or 24 kHz? Read from the "fmt " chunk wherever it sits. */
export function metaWavOk(b: Uint8Array): boolean {
  if (!looksLike("wav", b)) return false;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let at = 12;
  while (at + 8 <= b.length) {
    const size = v.getUint32(at + 4, true);
    if (ascii(b, at, "fmt ")) {
      if (size < 16 || at + 8 + 16 > b.length) return false;
      const format = v.getUint16(at + 8, true), channels = v.getUint16(at + 10, true), rate = v.getUint32(at + 12, true), bits = v.getUint16(at + 22, true);
      return format === 1 && channels === 1 && bits === 16 && META_WAV_RATES.has(rate);
    }
    at += 8 + size + (size % 2);
  }
  return false;
}

/** Read the request body, giving up as soon as more than `maxBytes` arrive (a missing content-length cannot get round the cap). */
async function readCappedBytes(request: Request, maxBytes: number): Promise<{ ok: true; bytes: Uint8Array<ArrayBuffer> } | { ok: false; over: boolean }> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) return { ok: false, over: true };
  if (!request.body) return { ok: true, bytes: new Uint8Array(await request.arrayBuffer()) };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, over: true };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { bytes.set(c, at); at += c.length; }
  return { ok: true, bytes };
}

/**
 * Which speech model this Worker will use for a child's voice, or "off". "self" needs an https address. "hosted" (Meta) needs the Meta key AND TRANSCRIBE_BACKEND set to exactly
 * "hosted": the per-capability variable only, never the master switch or the unset default, so it is always a deliberate choice (see the header).
 */
export function transcribeMode(env: TranscribeEnv): "self" | "hosted" | "off" {
  const backend = resolveBackend(env, "transcribe");
  if (backend.mode === "self" && backend.baseUrl) return "self";
  // a key of only spaces is no key, and Meta's address must be https (or this machine, for a test): a child's voice never goes over plain http or to an address with credentials in it
  if (backend.mode === "hosted" && backend.key?.trim() && parseSelfUrl(backend.baseUrl) && (env.TRANSCRIBE_BACKEND ?? "").trim().toLowerCase() === "hosted") return "hosted";
  return "off";
}

/** Whether this Worker will transcribe at all. */
export function transcribeEnabled(env: TranscribeEnv): boolean {
  return transcribeMode(env) !== "off";
}

/** Where the speech model's endpoint is: the configured address with a trailing /v1 (the way our text model's address is written) or none, then /v1/audio/transcriptions. */
export function transcriptionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "")}/v1/audio/transcriptions`;
}

/** The words the model heard, made safe to show a child; `text` is "" and `note` says why when there is nothing to show. */
export function safeWords(raw: unknown): { text: string; note?: string } {
  const heard = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (!heard) return { text: "", note: "I did not hear anything. Try again!" };
  const text = scrubContactDetails(heard).slice(0, MAX_TEXT_CHARS).trim();
  if (!kidSafeText(text)) return { text: "", note: "I could not use that. Try saying it a different way!" };
  return { text };
}

/**
 * Meta's file endpoint (POST <base>/asr/transcribe): multipart with a `request` part (JSON) and an `audio` part (the WAV); Bearer key; Accept JSON; the words are `transcript`.
 * Same safety after as for our own model: the words are scrubbed, capped and kid-checked before the page sees them. Never logs the audio or the words, never returns the key.
 */
async function transcribeWithMeta(wavBytes: Uint8Array<ArrayBuffer>, baseUrl: string, key: string): Promise<Response> {
  if (!metaWavOk(wavBytes)) return json({ error: "voice input needs a WAV recording: mono, 16 kHz or 24 kHz" }, 415);
  const form = new FormData();
  form.append("request", new Blob([JSON.stringify({ model: META_ASR_MODEL, audioEncoding: "WAV", mode: "PUSH_TO_TALK" })], { type: "application/json" }));
  form.append("audio", new Blob([wavBytes], { type: "audio/wav" }), "voice.wav");
  let transcript: unknown;
  let status: number | "fetch-failed" = "fetch-failed";
  try {
    const res = await fetch(`${baseUrl}/asr/transcribe`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, accept: "application/json" },
      body: form,
      signal: AbortSignal.timeout(WHISPER_TIMEOUT_MS),
    });
    status = res.status;
    if (res.ok) transcript = ((await res.json().catch(() => null)) as { transcript?: unknown } | null)?.transcript;
  } catch {
    status = "fetch-failed";
  }
  console.log(JSON.stringify({ event: "transcribe", status: typeof transcript === "string" ? "ok" : status, backend: "hosted" })); // never the audio, never the words
  if (status === 429) return json({ error: "Slow down, one at a time. Try again in a minute." }, 429);
  if (typeof transcript !== "string") return json({ error: "the voice helper is not answering" }, 502);
  return json(safeWords(transcript));
}

export async function handleTranscribe(request: Request, env: TranscribeEnv): Promise<Response> {
  if (request.method === "GET") return json({ ok: true, route: "transcribe", contract: TRANSCRIBE_CONTRACT, enabled: transcribeEnabled(env) });
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);

  const mode = transcribeMode(env);
  const backend = resolveBackend(env, "transcribe");
  if (mode === "off" || !backend.baseUrl) return json({ error: "voice input is off" }, 503); // hosted is off unless TRANSCRIBE_BACKEND=hosted was chosen, by policy
  if (transcribeRateLimited(request.headers.get("CF-Connecting-IP"))) return json({ error: "Slow down, one at a time. Try again in a minute." }, 429);

  const blocked = await requireHostedGate(request, env, "transcribe"); // a recording leaves for another model: a grown-up proof at most 3 minutes old (off until PARENT_GATE_TRANSCRIBE is "on")
  if (blocked) return blocked;

  const kind = audioKindOf(request.headers.get("content-type"));
  if (!kind) return json({ error: "expected audio/webm, audio/mp4, audio/ogg or audio/wav" }, 415);
  // Meta's endpoint takes WAV only and a Worker cannot decode anything else, so the page converts before it sends (kip-describe-voice.js recordingToWav): refuse early, before reading.
  if (mode === "hosted" && kind !== "wav") return json({ error: "voice input needs a WAV recording: mono, 16 kHz or 24 kHz" }, 415);
  const read = await readCappedBytes(request, MAX_AUDIO_BYTES);
  if (!read.ok) return json({ error: "that recording is too long" }, 413);
  const bytes = read.bytes;
  if (bytes.length < MIN_AUDIO_BYTES) return json({ error: "that recording is empty" }, 422);
  if (!looksLike(kind, bytes)) return json({ error: "that is not an audio recording" }, 415);
  if (kind === "wav") {
    const seconds = wavSeconds(bytes);
    if (seconds === null || seconds > MAX_WAV_SECONDS) return json({ error: "that recording is too long" }, 413);
  }
  if (mode === "hosted") return transcribeWithMeta(bytes, parseSelfUrl(backend.baseUrl)!, backend.key!.trim());

  const form = new FormData();
  form.append("file", new Blob([bytes], { type: FILE_TYPE[kind].mime }), FILE_TYPE[kind].name);
  form.append("model", WHISPER_MODEL);
  form.append("response_format", "json");
  form.append("temperature", "0");
  let reply: unknown = null;
  let status: number | "fetch-failed" = "fetch-failed";
  try {
    const res = await fetch(transcriptionsUrl(backend.baseUrl), {
      method: "POST",
      headers: backend.key ? { authorization: `Bearer ${backend.key}` } : {},
      body: form,
      signal: AbortSignal.timeout(WHISPER_TIMEOUT_MS),
    });
    status = res.status;
    if (res.ok) reply = await res.json().catch(() => null);
  } catch {
    status = "fetch-failed";
  }
  const text = reply && typeof reply === "object" ? (reply as { text?: unknown }).text : undefined;
  console.log(JSON.stringify({ event: "transcribe", status: typeof text === "string" ? "ok" : status, backend: backend.mode })); // never the audio, never the words
  if (typeof text !== "string") return json({ error: "the voice helper is not answering" }, 502);
  return json(safeWords(text));
}
