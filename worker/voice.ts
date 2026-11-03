// GET /api/voice?lang=es&n=tree&c=green        ->  audio/wav of "árbol verde"        (a scene prop)
// GET /api/voice?lang=es&p=veh_wheel_sport&hex=262d40  ->  audio/wav of "rueda deportiva negra"  (a Describe & Build part, in the
//                                                       colour the exploded view drew it; the hex is reduced to one of 12 words)
// GET /api/voice?lang=es&w=cuchara&g=f&c=red&sig=...   ->  audio/wav of "cuchara roja"        (a Forge object: a SIGNED name, see below)
// GET /api/voice?lang=es&h=wooden_spoon                ->  audio/wav of "cuchara de madera"  (a household library item, the BARE noun, no colour)
// All reply with the spoken text in the x-voice-text header (URL-encoded) so a caption can show it.
//
// Spoken by Gemini 3.8 Flash-Lite TTS, spoken by Gemini 3.8 Flash-Lite TTS through the
// Workers AI binding (Unified Billing via AI Gateway: no provider key lives in this repo).
//
// Safety and cost: the request carries VOCABULARY KEYS, never text. The phrase is built here from src/lib/propNames.ts, so
// the endpoint can only ever speak "<colour> <object>" in one of six languages (25 nouns x 12 colours x 6 languages = at most
// 1,800 distinct clips), nothing a child typed or said. Each clip is generated once and then served from the edge cache with a
// one-year immutable lifetime, so cost is bounded by the vocabulary, not by taps. No personal data is sent anywhere.
//
// Forge objects are free text, so the vocabulary cannot name them. Their names come from worker/forgeNames.ts: the model returns a name per language, the
// Worker filters it and signs the noun entry (HMAC, secret VOICE_SIGNING_KEY), and this route speaks a `w=` request ONLY when the signature checks out, before
// any cache read or model call. So it still never speaks text this Worker did not produce and filter. The colour (c or hex) is not signed: it is one of the 12
// colour words and is attached here by nounPhrase(), so a signed name costs at most 13 clips per language. Without the secret a signed request is refused.
//
// Probed 2026-11-03 against the live binding: input is exactly { text, voice } (style/prompt are rejected with 7003), output is
// { audio: "data:audio/wav;base64,..." } (24 kHz, mono, 16-bit PCM), the language is auto-detected from the text, an unknown
// voice name is rejected with 7003. Also probed: there is NO language hint (language, language_code, languageCode, lang, locale and speech_language are all
// rejected with 7003), and an instruction in the text ("Say in Brazilian Portuguese: casa verde") is spoken aloud, not obeyed (4.0 s against 1.2 s).
import { COLOR_KEYS, LANGUAGES, NOUN_KEYS, colorKeyFromHex, nounPhrase, propNoun, propPhrase, type ColorKey, type LangCode, type Noun, type NounKey } from "../src/lib/propNames";
import { isPartId, partPhrase } from "../src/lib/partNames";
import { householdName, householdTextHash, isHouseholdId } from "../src/lib/householdNames";
import { isSpeakableWord, verifySpeech, type SigningEnv } from "./forgeNames";

export const VOICE_MODEL = "google/gemini-3.8-flash-lite-tts";
export const DEFAULT_VOICE = "Leda"; // Gemini's "youthful" voice; swap here (or set VOICE_NAME) to change it everywhere
/** Gemini TTS prebuilt voices (Google's list). VOICE_NAME is ignored unless it is one of these. */
export const GEMINI_VOICES = [
  "Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede", "Callirrhoe", "Autonoe", "Enceladus", "Iapetus", "Umbriel", "Algieba",
  "Despina", "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar", "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi",
  "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat",
] as const;

const GATEWAY_ID = "default";
const CACHE_VERSION = "v2"; // v2: language lead-in (clips from v1 had an English accent on every foreign word)
const ONE_YEAR = 31_536_000;

export interface AiBinding {
  run(model: string, input: unknown, options?: unknown): Promise<unknown>;
}
export interface VoiceEnv extends SigningEnv {
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

export type VoiceKey =
  | { lang: LangCode; noun: NounKey; color: ColorKey | null }
  | { lang: LangCode; part: string; color: ColorKey | null }
  | { lang: LangCode; name: Noun; sig: string; color: ColorKey | null }
  | { lang: LangCode; household: string; color: null };

/**
 * Validate the query. Anything outside the controlled vocabulary is rejected, which is what bounds the cost: a language, then
 * exactly one of a prop noun (n), a Describe & Build part id (p), a household library item id (h, the bare noun: no colour allowed, so it is at
 * most one clip per item and language) or a signed Forge name (w, with g, optional pl=1, and sig; the signature is
 * checked by handleVoice before anything else), and an optional colour word (c) or hex (hex) that is reduced to one of 12 colour words,
 * so a hex can never multiply the clip set.
 */
export function parseVoiceKey(url: URL): VoiceKey | null {
  const q = url.searchParams;
  const lang = q.get("lang");
  const noun = q.get("n");
  const part = q.get("p");
  const word = q.get("w");
  const house = q.get("h");
  const c = q.get("c");
  const hex = q.get("hex");
  if (!LANGUAGES.some((l) => l.code === lang)) return null;
  if ([noun, part, word, house].filter((v) => v !== null).length !== 1) return null; // exactly one of n / p / w / h
  if (house !== null) return isHouseholdId(house) && c === null && hex === null ? { lang: lang as LangCode, household: house, color: null } : null;
  let color: ColorKey | null = null;
  if (c !== null) {
    if (!(COLOR_KEYS as readonly string[]).includes(c)) return null;
    color = c as ColorKey;
  } else if (hex !== null) {
    if (!/^#?[0-9a-fA-F]{6}$/.test(hex)) return null;
    color = colorKeyFromHex(hex.startsWith("#") ? hex : `#${hex}`);
  }
  if (word !== null) {
    const g = q.get("g");
    const pl = q.get("pl");
    const sig = q.get("sig");
    if (!isSpeakableWord(word) || (g !== "m" && g !== "f" && g !== "n") || (pl !== null && pl !== "1") || sig === null || !/^[A-Za-z0-9_-]{43}$/.test(sig)) return null;
    return { lang: lang as LangCode, name: pl ? { w: word, g, pl: true } : { w: word, g }, sig, color };
  }
  if (noun !== null) {
    if (!(NOUN_KEYS as readonly string[]).includes(noun)) return null;
    return { lang: lang as LangCode, noun: noun as NounKey, color };
  }
  if (!isPartId(part)) return null;
  return { lang: lang as LangCode, part, color };
}

export function voiceText(key: VoiceKey): string {
  if ("household" in key) return householdName(key.household, key.lang) ?? "";
  if ("part" in key) return partPhrase(key.part, key.color, key.lang) ?? key.part;
  if ("name" in key) return nounPhrase(key.name, key.color, key.lang);
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

/**
 * Telling the model the language (Dan, 2026-11-03: "we need to indicate the language, not just the spelling"). The model has no language setting and detects the
 * language from the words, and a single foreign word gives it nothing, so it came out in an English accent. A short word in the SAME language said first
 * ("Mira. <short pause> cuchara.") makes it recognise the language and use a native accent, and the lead-in is then cut out of the audio (`cutLeadIn`), so the
 * clip is still only the name. English needs none (it is the default) and Turkish sounded best without (Dan listened to both). One word per language, a setting
 * to change by ear: add or remove an entry here.
 */
export const LEAD_IN: Partial<Record<LangCode, string>> = { es: "Mira.", fr: "Regarde.", de: "Schau.", it: "Guarda.", pt: "Olha." };
/** The shortest quiet gap taken for the end of the lead-in. The model leaves 0.5 to 1.1 s after it; a pause inside a word is under 0.2 s. */
const LEAD_IN_MIN_GAP_S = 0.3;

/** What is sent to the model: the name, behind its language's lead-in and a pause when the language has one. */
export function modelText(lang: LangCode, text: string): string {
  const lead = LEAD_IN[lang];
  if (!lead) return text;
  return `${lead} <short pause> ${text}${/[.!?]$/.test(text) ? "" : "."}`;
}

/**
 * Cut the lead-in off a clip made from `modelText`: find the longest quiet gap (at least 0.3 s) between stretches of speech and keep what follows it (with
 * 60 ms in front). A clip with no such gap (one stretch of speech, or only short pauses) comes back untouched, the same array, so a model that skipped the pause
 * still gives a clip that says the name, with the lead-in. Does not understand anything but 16-bit PCM WAV: returns the input.
 */
export function cutLeadIn(wav: Uint8Array): Uint8Array {
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
      dataLen = Math.min(size, wav.length - dataAt);
      break;
    }
    pos += 8 + size + (size % 2);
  }
  if (fmt !== 1 || bits !== 16 || channels < 1 || rate < 1 || dataAt < 0) return wav;
  const frame = 2 * channels;
  const frames = Math.floor(dataLen / frame);
  const win = Math.max(1, Math.round(rate * 0.01)); // 10 ms windows
  const wins = Math.floor(frames / win);
  if (wins < 4) return wav;
  const rms: number[] = [];
  let peak = 0;
  for (let w = 0; w < wins; w++) {
    let sum = 0;
    for (let i = 0; i < win; i++) {
      let m = 0;
      for (let c = 0; c < channels; c++) m = Math.max(m, Math.abs(dv.getInt16(dataAt + (w * win + i) * frame + c * 2, true)));
      sum += m * m;
    }
    const r = Math.sqrt(sum / win);
    rms.push(r);
    peak = Math.max(peak, r);
  }
  if (peak === 0) return wav;
  const thr = Math.max(150, peak * 0.06);
  // stretches of speech, joining pauses shorter than 60 ms
  const segs: Array<[number, number]> = [];
  let cur: [number, number] | null = null;
  for (let w = 0; w < wins; w++) {
    const t = w * 0.01;
    if (rms[w]! > thr) {
      if (!cur) cur = [t, t];
      else cur[1] = t;
    } else if (cur && t - cur[1] > 0.06) {
      segs.push(cur);
      cur = null;
    }
  }
  if (cur) segs.push(cur);
  if (segs.length < 2) return wav;
  let best = -1, bestGap = 0;
  for (let i = 0; i < segs.length - 1; i++) {
    const gap = segs[i + 1]![0] - segs[i]![1];
    if (gap > bestGap) { bestGap = gap; best = i; }
  }
  if (best < 0 || bestGap < LEAD_IN_MIN_GAP_S) return wav;
  const startFrame = Math.max(0, Math.round((segs[best + 1]![0] - 0.06) * rate));
  const outFrames = frames - startFrame;
  if (outFrames <= 0) return wav;
  const outBytes = outFrames * frame;
  const out = new Uint8Array(44 + outBytes);
  const od = new DataView(out.buffer);
  out.set([0x52, 0x49, 0x46, 0x46], 0); od.setUint32(4, 36 + outBytes, true); out.set([0x57, 0x41, 0x56, 0x45], 8);
  out.set([0x66, 0x6d, 0x74, 0x20], 12); od.setUint32(16, 16, true); od.setUint16(20, 1, true); od.setUint16(22, channels, true);
  od.setUint32(24, rate, true); od.setUint32(28, rate * frame, true); od.setUint16(32, frame, true); od.setUint16(34, 16, true);
  out.set([0x64, 0x61, 0x74, 0x61], 36); od.setUint32(40, outBytes, true);
  out.set(wav.subarray(dataAt + startFrame * frame, dataAt + frames * frame), 44);
  return out;
}

/** The loudness every clip is levelled to: root-mean-square of the 16-bit samples (about -16 dBFS). The model's clips differ five-fold in loudness. */
export const TARGET_RMS = 5000;
const MIN_GAIN = 0.5;
const MAX_GAIN = 4;

/**
 * Level a 16-bit PCM WAV to TARGET_RMS so no word in the game is much quieter or louder than the next (probed 2026-11-03: the same voice's clips
 * ranged from an RMS of 1,700 to 9,000, a fifth-fold gap a child hears as one word mumbled). The gain is clamped to 0.5 to 4 and never lets the peak
 * past 95 percent of full scale, so nothing clips. A WAV already within 5 percent of the target, a silent one, and anything this does not understand
 * come back untouched (the same array).
 */
export function levelWav(wav: Uint8Array, targetRms = TARGET_RMS): Uint8Array {
  if (wav.length < 44 || ascii(wav, 0, 4) !== "RIFF" || ascii(wav, 8, 4) !== "WAVE") return wav;
  const dv = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  let pos = 12;
  let channels = 0, bits = 0, fmt = 0, dataAt = -1, dataLen = 0;
  while (pos + 8 <= wav.length) {
    const id = ascii(wav, pos, 4);
    const size = dv.getUint32(pos + 4, true);
    if (id === "fmt ") {
      fmt = dv.getUint16(pos + 8, true);
      channels = dv.getUint16(pos + 10, true);
      bits = dv.getUint16(pos + 22, true);
    } else if (id === "data") {
      dataAt = pos + 8;
      dataLen = Math.min(size, wav.length - dataAt);
      break;
    }
    pos += 8 + size + (size % 2);
  }
  if (fmt !== 1 || bits !== 16 || channels < 1 || dataAt < 0) return wav;
  const samples = Math.floor(dataLen / 2);
  if (samples < 2) return wav;
  let sumSq = 0, peak = 0;
  for (let i = 0; i < samples; i++) {
    const v = dv.getInt16(dataAt + i * 2, true);
    sumSq += v * v;
    peak = Math.max(peak, Math.abs(v));
  }
  if (peak === 0) return wav;
  const rms = Math.sqrt(sumSq / samples);
  const gain = Math.min(Math.min(MAX_GAIN, Math.max(MIN_GAIN, targetRms / rms)), (0.95 * 32767) / peak);
  if (Math.abs(gain - 1) < 0.05) return wav;
  const out = new Uint8Array(wav);
  const od = new DataView(out.buffer);
  for (let i = 0; i < samples; i++) {
    const v = Math.round(dv.getInt16(dataAt + i * 2, true) * gain);
    od.setInt16(dataAt + i * 2, Math.max(-32768, Math.min(32767, v)), true);
  }
  return out;
}

// TS 5.9 types a Uint8Array<ArrayBufferLike> as not-a-BodyInit; ours always own a whole ArrayBuffer, so this cast is safe.
const asBody = (b: Uint8Array): BodyInit => b as unknown as BodyInit;

const inflight = new Map<string, Promise<Uint8Array>>();

async function synthesize(env: VoiceEnv, text: string, voice: string, lang: LangCode): Promise<Uint8Array> {
  const out = (await env.AI!.run(VOICE_MODEL, { text: modelText(lang, text), voice }, { gateway: { id: GATEWAY_ID } })) as { audio?: unknown } | null;
  const audio = typeof out?.audio === "string" ? out.audio : "";
  const m = /^data:audio\/(?:wav|x-wav|wave);base64,(.+)$/s.exec(audio);
  if (!m) throw new Error("voice model returned no WAV audio");
  const raw = b64ToBytes(m[1]!);
  return levelWav(trimWav(LEAD_IN[lang] ? cutLeadIn(raw) : raw));
}

export async function handleVoice(request: Request, env: VoiceEnv, ctx?: Ctx): Promise<Response> {
  if (request.method !== "GET") return json({ error: "method not allowed" }, 405, { allow: "GET" });
  const key = parseVoiceKey(new URL(request.url));
  if (!key) return json({ error: "bad request" }, 400);
  // A Forge name is spoken only if this Worker signed exactly this language and noun. Checked first: an unsigned request costs nothing and reads nothing.
  if ("name" in key && !(await verifySpeech(env, key.lang, key.name, key.sig))) return json({ error: "not signed" }, 403, { "cache-control": "no-store" });
  // A household item with no name in this language yet (the Muse run has not filled it): nothing to speak, so no cache read and no model call; the client says
  // the English name instead.
  if ("household" in key && !householdName(key.household, key.lang)) return json({ error: "no name yet" }, 404, { "cache-control": "no-store" });
  const voice = voiceName(env);
  const text = voiceText(key);

  const edge = (globalThis as unknown as { caches?: { default?: CacheLike } }).caches?.default;
  // A household clip's key carries a fingerprint of its text, so a noun a native reviewer corrects is a NEW clip, not the old one served for a year.
  const what = "household" in key ? `h-${key.household}.${householdTextHash(text)}` : "part" in key ? `p-${key.part}` : "name" in key ? `w-${encodeURIComponent(key.name.w)}.${key.name.g}${key.name.pl ? "p" : ""}` : key.noun;
  const cacheReq = new Request(`https://voice.toyventor.internal/${CACHE_VERSION}/${voice}/${key.lang}/${what}/${key.color ?? "-"}`);
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
    job = synthesize(env, text, voice, key.lang).finally(() => inflight.delete(id));
    inflight.set(id, job);
  }
  let bytes: Uint8Array;
  try {
    bytes = await job;
  } catch (e) {
    console.error("voice synth failed:", e instanceof Error ? e.message.slice(0, 200) : "error");
    return json({ error: "voice failed" }, 502, { "cache-control": "no-store" });
  }
  const headers = { "content-type": "audio/wav", "cache-control": `public, max-age=${ONE_YEAR}, immutable`, "x-voice-text": encodeURIComponent(text), "x-voice-voice": voice };
  if (edge) {
    const put = edge.put(cacheReq, new Response(asBody(bytes), { headers }));
    if (ctx) ctx.waitUntil(put);
    else await put;
  }
  return new Response(asBody(bytes), { headers: { ...headers, "x-voice-cache": "miss" } });
}
