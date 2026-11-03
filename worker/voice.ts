// GET /api/voice?lang=es&n=tree&c=green  ->  audio/wav of "árbol verde", spoken by Gemini 3.8 Flash-Lite TTS through the
// Workers AI binding (Unified Billing via AI Gateway: no provider key lives in this repo).
//
// Safety and cost: the request carries VOCABULARY KEYS, never text. The phrase is built here from src/lib/propNames.ts, so
// the endpoint can only ever speak "<colour> <object>" in one of six languages (25 nouns x 12 colours x 6 languages = at most
// 1,800 distinct clips), nothing a child typed or said. Each clip is generated once and then served from the edge cache with a
// one-year immutable lifetime, so cost is bounded by the vocabulary, not by taps. No personal data is sent anywhere.
//
// Probed 2026-11-03 against the live binding: input is exactly { text, voice } (style/prompt are rejected with 7003), output is
// { audio: "data:audio/wav;base64,..." } (24 kHz, mono, 16-bit PCM), the language is auto-detected from the text, an unknown
// voice name is rejected with 7003.
import { COLOR_KEYS, LANGUAGES, NOUN_KEYS, propNoun, propPhrase, type ColorKey, type LangCode, type NounKey } from "../src/lib/propNames";

export const VOICE_MODEL = "google/gemini-3.8-flash-lite-tts";
export const DEFAULT_VOICE = "Leda"; // Gemini's "youthful" voice; swap here (or set VOICE_NAME) to change it everywhere
/** Gemini TTS prebuilt voices (Google's list). VOICE_NAME is ignored unless it is one of these. */
export const GEMINI_VOICES = [
  "Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede", "Callirrhoe", "Autonoe", "Enceladus", "Iapetus", "Umbriel", "Algieba",
  "Despina", "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar", "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi",
  "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat",
] as const;

const GATEWAY_ID = "default";
const CACHE_VERSION = "v1";
const ONE_YEAR = 31_536_000;

export interface AiBinding {
  run(model: string, input: unknown, options?: unknown): Promise<unknown>;
}
export interface VoiceEnv {
  AI?: AiBinding;
  /** Optional: one of GEMINI_VOICES. */
  VOICE_NAME?: string;
}
interface CacheLike {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}
interface Ctx {
  waitUntil(p: Promise<unknown>): void;
}

export function voiceConfigured(env: VoiceEnv): boolean {
  return Boolean(env.AI);
}

export function voiceName(env: VoiceEnv): string {
  return (GEMINI_VOICES as readonly string[]).includes(env.VOICE_NAME ?? "") ? (env.VOICE_NAME as string) : DEFAULT_VOICE;
}

function json(data: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...extra } });
}

export interface VoiceKey {
  lang: LangCode;
  noun: NounKey;
  color: ColorKey | null;
}

/** Validate the query. Anything outside the controlled vocabulary is rejected, which is what bounds the cost. */
export function parseVoiceKey(url: URL): VoiceKey | null {
  const lang = url.searchParams.get("lang");
  const noun = url.searchParams.get("n");
  const color = url.searchParams.get("c");
  if (!LANGUAGES.some((l) => l.code === lang)) return null;
  if (!(NOUN_KEYS as readonly string[]).includes(noun ?? "")) return null;
  if (color !== null && !(COLOR_KEYS as readonly string[]).includes(color)) return null;
  return { lang: lang as LangCode, noun: noun as NounKey, color: color as ColorKey | null };
}

export function voiceText(key: VoiceKey): string {
  return key.color ? propPhrase(key.noun, key.color, key.lang) : propNoun(key.noun, key.lang);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));

/**
 * Trim leading and trailing near-silence from a 16-bit PCM WAV (the model pads each clip with a beat of quiet, which would make
 * a tap feel laggy and every clip bigger). Keeps ~60 ms in front and ~140 ms behind so nothing is clipped. Returns the input
 * untouched when it is not a WAV this function understands.
 */
export function trimWav(wav: Uint8Array): Uint8Array {
  if (wav.length < 44 || ascii(wav, 0, 4) !== "RIFF" || ascii(wav, 8, 4) !== "WAVE") return wav;
  const dv = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  let pos = 12;
  let channels = 0, rate = 0, bits = 0, fmt = 0, dataAt = -1, dataLen = 0;
  while (pos + 8 <= wav.length) {
    const id = ascii(wav, pos, 4);
    const size = dv.getUint32(pos + 4, true);
    if (id === "fmt ") {
      fmt = dv.getUint16(pos + 8, true);
      channels = dv.getUint16(pos + 10, true);
      rate = dv.getUint32(pos + 12, true);
      bits = dv.getUint16(pos + 22, true);
    } else if (id === "data") {
      dataAt = pos + 8;
      dataLen = Math.min(size, wav.length - dataAt); // a streamed WAV can claim 0xFFFFFFFF
      break;
    }
    pos += 8 + size + (size % 2);
  }
  if (fmt !== 1 || bits !== 16 || channels < 1 || rate < 1 || dataAt < 0) return wav;
  const frame = 2 * channels;
  const frames = Math.floor(dataLen / frame);
  if (frames < 2) return wav;
  let peak = 0;
  for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) peak = Math.max(peak, Math.abs(dv.getInt16(dataAt + i * frame + c * 2, true)));
  if (peak === 0) return wav;
  const thr = Math.max(200, peak * 0.02);
  const loud = (i: number) => {
    for (let c = 0; c < channels; c++) if (Math.abs(dv.getInt16(dataAt + i * frame + c * 2, true)) > thr) return true;
    return false;
  };
  let first = 0;
  while (first < frames && !loud(first)) first++;
  let last = frames - 1;
  while (last > first && !loud(last)) last--;
  const start = Math.max(0, first - Math.round(rate * 0.06));
  const end = Math.min(frames, last + 1 + Math.round(rate * 0.14));
  const outFrames = end - start;
  if (outFrames <= 0 || outFrames === frames) return wav;
  const outBytes = outFrames * frame;
  const out = new Uint8Array(44 + outBytes);
  const od = new DataView(out.buffer);
  out.set([0x52, 0x49, 0x46, 0x46], 0); od.setUint32(4, 36 + outBytes, true); out.set([0x57, 0x41, 0x56, 0x45], 8);
  out.set([0x66, 0x6d, 0x74, 0x20], 12); od.setUint32(16, 16, true); od.setUint16(20, 1, true); od.setUint16(22, channels, true);
  od.setUint32(24, rate, true); od.setUint32(28, rate * frame, true); od.setUint16(32, frame, true); od.setUint16(34, 16, true);
  out.set([0x64, 0x61, 0x74, 0x61], 36); od.setUint32(40, outBytes, true);
  out.set(wav.subarray(dataAt + start * frame, dataAt + end * frame), 44);
  return out;
}

// TS 5.9 types a Uint8Array<ArrayBufferLike> as not-a-BodyInit; ours always own a whole ArrayBuffer, so this cast is safe.
const asBody = (b: Uint8Array): BodyInit => b as unknown as BodyInit;

const inflight = new Map<string, Promise<Uint8Array>>();

async function synthesize(env: VoiceEnv, text: string, voice: string): Promise<Uint8Array> {
  const out = (await env.AI!.run(VOICE_MODEL, { text, voice }, { gateway: { id: GATEWAY_ID } })) as { audio?: unknown } | null;
  const audio = typeof out?.audio === "string" ? out.audio : "";
  const m = /^data:audio\/(?:wav|x-wav|wave);base64,(.+)$/s.exec(audio);
  if (!m) throw new Error("voice model returned no WAV audio");
  return trimWav(b64ToBytes(m[1]!));
}

export async function handleVoice(request: Request, env: VoiceEnv, ctx?: Ctx): Promise<Response> {
  if (request.method !== "GET") return json({ error: "method not allowed" }, 405, { allow: "GET" });
  const key = parseVoiceKey(new URL(request.url));
  if (!key) return json({ error: "bad request" }, 400);
  const voice = voiceName(env);
  const text = voiceText(key);

  const edge = (globalThis as unknown as { caches?: { default?: CacheLike } }).caches?.default;
  const cacheReq = new Request(`https://voice.toyventor.internal/${CACHE_VERSION}/${voice}/${key.lang}/${key.noun}/${key.color ?? "-"}`);
  if (edge) {
    const hit = await edge.match(cacheReq);
    if (hit) {
      const res = new Response(hit.body, hit);
      res.headers.set("x-voice-cache", "hit");
      return res;
    }
  }
  if (!voiceConfigured(env)) return json({ error: "voice unavailable" }, 503, { "cache-control": "no-store" });

  const id = `${voice}|${key.lang}|${text}`;
  let job = inflight.get(id);
  if (!job) {
    job = synthesize(env, text, voice).finally(() => inflight.delete(id));
    inflight.set(id, job);
  }
  let bytes: Uint8Array;
  try {
    bytes = await job;
  } catch (e) {
    console.error("voice synth failed:", e instanceof Error ? e.message.slice(0, 200) : "error");
    return json({ error: "voice failed" }, 502, { "cache-control": "no-store" });
  }
  const headers = { "content-type": "audio/wav", "cache-control": `public, max-age=${ONE_YEAR}, immutable` };
  if (edge) {
    const put = edge.put(cacheReq, new Response(asBody(bytes), { headers }));
    if (ctx) ctx.waitUntil(put);
    else await put;
  }
  return new Response(asBody(bytes), { headers: { ...headers, "x-voice-cache": "miss" } });
}
