import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../worker/index";
import {
  MAX_AUDIO_BYTES, MAX_TEXT_CHARS, META_ASR_MODEL, audioKindOf, handleTranscribe, looksLike, metaWavOk, resetTranscribeLimits, safeWords, transcribeEnabled, transcribeMode, transcriptionsUrl, wavSeconds,
} from "../worker/transcribe";

// A child's voice is sent to a speech model we host (docs/decisions/0008), or, as a deliberate demo exception chosen with TRANSCRIBE_BACKEND=hosted (Dan, 2026-11-04), to Meta's.
// Everything below stands in for either with a stubbed fetch: no real model, no network, no cost.
const SELF = { MODEL_BACKEND: "self", SELF_TRANSCRIBE_URL: "https://whisper.example", SELF_TRANSCRIBE_KEY: "whisper-secret-key" };

const pad = (head: number[], n = 400) => { const b = new Uint8Array(n); b.set(head); return b; };
const WEBM = pad([0x1a, 0x45, 0xdf, 0xa3]);
const OGG = pad([0x4f, 0x67, 0x67, 0x53]);
const MP4 = (() => { const b = pad([0, 0, 0, 0x18]); b.set([0x66, 0x74, 0x79, 0x70], 4); return b; })();
/** A 16 kHz mono 16-bit PCM WAV of `seconds` of silence; `list` puts a LIST chunk before the data, as some encoders do. */
function wav(seconds: number, { list = false } = {}): Uint8Array {
  const rate = 16000, dataBytes = Math.round(seconds * rate * 2), extra = list ? 12 : 0;
  const b = new Uint8Array(44 + extra + dataBytes);
  const v = new DataView(b.buffer);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + extra + dataBytes, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  if (list) { w(36, "LIST"); v.setUint32(40, 4, true); w(44, "INFO"); }
  w(36 + extra, "data"); v.setUint32(40 + extra, dataBytes, true);
  return b;
}

interface Seen { url: string; auth: string | null; form: FormData | null }
/** Stand in for the speech model: records what it was sent and answers `reply`. */
function whisper(reply: unknown = { text: "a red race car" }, status = 200) {
  const seen: Seen[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    seen.push({ url: String(url), auth: (init?.headers as Record<string, string> | undefined)?.authorization ?? null, form: (init?.body as FormData | undefined) ?? null });
    if (status === -1) throw new Error("network down");
    return new Response(typeof reply === "string" ? reply : JSON.stringify(reply), { status, headers: { "content-type": "application/json" } });
  }));
  return seen;
}
let ip = 0;
const fresh = () => ({ "CF-Connecting-IP": `10.2.0.${++ip}` });
const post = (body: BodyInit | Uint8Array | null, type: string | null = "audio/webm", headers: Record<string, string> = fresh()) =>
  new Request("https://toyventor.com/api/transcribe", { method: "POST", headers: { ...(type ? { "content-type": type } : {}), ...headers }, body: body as BodyInit });
const get = () => new Request("https://toyventor.com/api/transcribe");
const say = async (res: Response) => (await res.json()) as Record<string, any>;

beforeEach(() => resetTranscribeLimits());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("it is off unless a speech model is configured ON PURPOSE: a child's voice goes to Meta only when someone chose it", () => {
  it("is off with nothing set, and an unset switch or the master switch alone never turns Meta on for a child's voice", async () => {
    const seen = whisper();
    for (const env of [{}, { MODEL_API_KEY: "meta-key" }, { MODEL_BACKEND: "hosted", MODEL_API_KEY: "meta-key" }, { TRANSCRIBE_BACKEND: "hosted" }, { TRANSCRIBE_BACKEND: "hosted", MODEL_API_KEY: "  " }, { TRANSCRIBE_BACKEND: "hosted", MODEL_API_KEY: "meta-key", META_MODEL_API_URL: "ftp://x" }]) {
      expect(transcribeEnabled(env), JSON.stringify(env)).toBe(false);
      expect((await say(await handleTranscribe(get(), env))).enabled).toBe(false);
      expect((await handleTranscribe(post(WEBM), env)).status).toBe(503);
    }
    expect(seen).toHaveLength(0); // nothing was sent anywhere, Meta included
  });
  it("is off when switched off, when self has no address, and when the address is not https (or this machine)", async () => {
    const seen = whisper();
    for (const env of [
      { ...SELF, TRANSCRIBE_BACKEND: "off" }, { MODEL_BACKEND: "off", SELF_TRANSCRIBE_URL: "https://whisper.example" }, { MODEL_BACKEND: "self" },
      { ...SELF, SELF_TRANSCRIBE_URL: "http://whisper.example" }, { ...SELF, SELF_TRANSCRIBE_URL: "https://user:pass@whisper.example" }, { ...SELF, MODEL_BACKEND: "selff" },
    ]) {
      expect(transcribeEnabled(env), JSON.stringify(env)).toBe(false);
      expect((await handleTranscribe(post(WEBM), env)).status).toBe(503);
    }
    expect(seen).toHaveLength(0);
  });
  it("a per-capability variable wins over the master switch, so text can stay hosted while voice is ours", () => {
    expect(transcribeEnabled({ MODEL_BACKEND: "hosted", MODEL_API_KEY: "k", TRANSCRIBE_BACKEND: "self", SELF_TRANSCRIBE_URL: "https://whisper.example" })).toBe(true);
    // the per-capability variable is the choice: an explicit "hosted" for voice is Meta's even under a self master switch (the demo exception, see the block at the end)
    expect(transcribeMode({ MODEL_BACKEND: "self", TRANSCRIBE_BACKEND: "hosted", MODEL_API_KEY: "k", SELF_TRANSCRIBE_URL: "https://whisper.example" })).toBe("hosted");
    expect(transcribeMode({ MODEL_BACKEND: "hosted", TRANSCRIBE_BACKEND: "off", MODEL_API_KEY: "k" })).toBe("off");
  });
  it("is on with self and an https address (or a local one for development)", () => {
    expect(transcribeEnabled(SELF)).toBe(true);
    expect(transcribeEnabled({ ...SELF, SELF_TRANSCRIBE_URL: "http://localhost:8000" })).toBe(true);
  });
  it("answers a plain GET with the free probe and never the address or the key", async () => {
    const res = await handleTranscribe(get(), SELF);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, route: "transcribe", contract: 1, enabled: true });
    expect(JSON.stringify(await say(await handleTranscribe(get(), SELF)))).not.toMatch(/whisper|secret/);
  });
  it("is reached at /api/transcribe through the Worker's own router", async () => {
    const res = await worker.fetch(new Request("https://toyventor.com/api/transcribe"), SELF as never, {} as never);
    expect(res.status).toBe(200);
    expect((await res.json()) as { route: string }).toMatchObject({ route: "transcribe", enabled: true });
    const off = await worker.fetch(new Request("https://toyventor.com/api/transcribe"), {} as never, {} as never);
    expect(((await off.json()) as { enabled: boolean }).enabled).toBe(false);
  });
  it("only GET and POST", async () => {
    expect((await handleTranscribe(new Request("https://toyventor.com/api/transcribe", { method: "PUT" }), SELF)).status).toBe(405);
  });
});

describe("a recording goes to our speech model and the words come back", () => {
  it("forwards the audio in memory to <address>/v1/audio/transcriptions as multipart, with the model name, and returns only the words", async () => {
    const seen = whisper({ text: "  a red   race car " });
    const res = await handleTranscribe(post(WEBM, "audio/webm;codecs=opus"), SELF);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "a red race car" });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("https://whisper.example/v1/audio/transcriptions");
    const form = seen[0]!.form!;
    expect(form.get("model")).toBe("whisper-large-v3-turbo");
    expect(form.get("response_format")).toBe("json");
    expect(form.get("language")).toBeNull(); // left to the model
    const file = form.get("file") as File;
    expect(file.type).toBe("audio/webm");
    expect(file.size).toBe(WEBM.length);
  });
  it("takes the address with or without a /v1 on the end (the way the text model's is written), and sends the key as a bearer token only when there is one", async () => {
    let seen = whisper();
    await handleTranscribe(post(WEBM), { ...SELF, SELF_TRANSCRIBE_URL: "https://whisper.example/v1/" });
    expect(seen[0]!.url).toBe("https://whisper.example/v1/audio/transcriptions");
    expect(seen[0]!.auth).toBe("Bearer whisper-secret-key");
    seen = whisper();
    await handleTranscribe(post(WEBM), { MODEL_BACKEND: "self", SELF_TRANSCRIBE_URL: "https://whisper.example" });
    expect(seen[0]!.auth).toBeNull();
    expect(transcriptionsUrl("https://h.example///")).toBe("https://h.example/v1/audio/transcriptions");
  });
  it("never returns the address or the key, in a success, an unsafe answer or a failure", async () => {
    for (const [reply, status] of [[{ text: "hello" }, 200], [{ text: "a gun that kills" }, 200], [{ error: "boom https://whisper.example whisper-secret-key" }, 500]] as const) {
      whisper(reply, status);
      const body = JSON.stringify(await say(await handleTranscribe(post(WEBM), SELF)));
      expect(body).not.toMatch(/whisper\.example|whisper-secret-key|Bearer/);
    }
  });
  it("accepts all four kinds of recording, with any case and codec parameters", async () => {
    const seen = whisper();
    for (const [bytes, type] of [[WEBM, "audio/webm"], [WEBM, "AUDIO/WEBM; codecs=opus"], [MP4, "audio/mp4"], [OGG, "audio/ogg"], [wav(2), "audio/wav"], [wav(2), "audio/x-wav"]] as const) {
      expect((await handleTranscribe(post(bytes, type), SELF)).status, type).toBe(200);
    }
    expect(seen).toHaveLength(6);
  });
  it("stores nothing and logs neither the audio nor the words: the log line is an event, a status and a mode", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    whisper({ text: "my secret plan about a purple dragon" });
    await handleTranscribe(post(WEBM), SELF);
    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0]![0]);
    expect(JSON.parse(line)).toEqual({ event: "transcribe", status: "ok", backend: "self" });
    expect(line).not.toMatch(/purple|dragon|secret/);
  });
});

describe("what it will take: type, shape and size", () => {
  it("refuses a type that is not on the list, or no type, before any audio is read or forwarded", async () => {
    const seen = whisper();
    for (const type of ["text/plain", "application/json", "audio/mpeg", "video/webm", "multipart/form-data", null]) {
      expect((await handleTranscribe(post(WEBM, type), SELF)).status, String(type)).toBe(415);
    }
    expect(seen).toHaveLength(0);
  });
  it("refuses a body that only claims to be audio: the first bytes must really be that kind of file", async () => {
    const seen = whisper();
    expect((await handleTranscribe(post(new TextEncoder().encode(JSON.stringify({ pretend: "x".repeat(300) })), "audio/webm"), SELF)).status).toBe(415);
    expect((await handleTranscribe(post(WEBM, "audio/wav"), SELF)).status).toBe(415);
    expect((await handleTranscribe(post(wav(1), "audio/ogg"), SELF)).status).toBe(415);
    expect((await handleTranscribe(post(OGG, "audio/mp4"), SELF)).status).toBe(415);
    expect(seen).toHaveLength(0);
  });
  it("refuses an empty recording (a header with no sound)", async () => {
    const seen = whisper();
    expect((await handleTranscribe(post(new Uint8Array(0), "audio/webm"), SELF)).status).toBe(422);
    expect((await handleTranscribe(post(WEBM.slice(0, 20), "audio/webm"), SELF)).status).toBe(422);
    expect(seen).toHaveLength(0);
  });
  it("refuses a body over the cap, by its declared size or, when none is declared, on the bytes actually read", async () => {
    const seen = whisper();
    const big = new Uint8Array(MAX_AUDIO_BYTES + 1);
    big.set([0x1a, 0x45, 0xdf, 0xa3]);
    expect((await handleTranscribe(post(big), SELF)).status).toBe(413);
    // chunked, with no content-length: two chunks that together pass the cap
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(c) { if (sent >= 2) return c.close(); const chunk = new Uint8Array(MAX_AUDIO_BYTES / 2 + 10); if (sent === 0) chunk.set([0x1a, 0x45, 0xdf, 0xa3]); c.enqueue(chunk); sent++; } });
    const chunked = new Request("https://toyventor.com/api/transcribe", { method: "POST", headers: { "content-type": "audio/webm", ...fresh() }, body: stream, duplex: "half" } as RequestInit);
    expect(chunked.headers.get("content-length")).toBeNull();
    expect((await handleTranscribe(chunked, SELF)).status).toBe(413);
    expect(seen).toHaveLength(0);
  });
  it("takes a body exactly at the cap", async () => {
    whisper();
    const edge = new Uint8Array(MAX_AUDIO_BYTES);
    edge.set([0x1a, 0x45, 0xdf, 0xa3]);
    expect((await handleTranscribe(post(edge), SELF)).status).toBe(200);
  });
  it("reads a WAV's own length: 10 seconds or less goes through, more is refused", async () => {
    const seen = whisper();
    expect((await handleTranscribe(post(wav(9.9), "audio/wav"), SELF)).status).toBe(200);
    expect((await handleTranscribe(post(wav(10.5), "audio/wav"), SELF)).status).toBe(413);
    expect((await handleTranscribe(post(wav(5, { list: true }), "audio/wav"), SELF)).status).toBe(200);
    expect(seen).toHaveLength(2);
  });
  it("limits one address to 8 recordings a minute, and another address is not held up by it", async () => {
    whisper();
    const same = { "CF-Connecting-IP": "10.9.8.7" };
    for (let i = 0; i < 8; i++) expect((await handleTranscribe(post(WEBM, "audio/webm", same), SELF)).status).toBe(200);
    expect((await handleTranscribe(post(WEBM, "audio/webm", same), SELF)).status).toBe(429);
    expect((await handleTranscribe(post(WEBM), SELF)).status).toBe(200);
  });
});

describe("what comes back is safe to show a child", () => {
  it("withholds words that fail the kid-safe check: an empty text and a kind note, never the unsafe words", async () => {
    whisper({ text: "a gun that kills people" });
    const body = await say(await handleTranscribe(post(WEBM), SELF));
    expect(body.text).toBe("");
    expect(body.note).toMatch(/different way/);
    expect(JSON.stringify(body)).not.toMatch(/gun|kill/i);
  });
  it("takes out phone numbers and email addresses before showing the words", async () => {
    whisper({ text: "a car, call 07700 900123 or mail me@example.com" });
    const body = await say(await handleTranscribe(post(WEBM), SELF));
    expect(body.text).not.toMatch(/07700|example\.com/);
  });
  it("cuts the words at 300 characters", async () => {
    whisper({ text: "race car ".repeat(100) });
    expect((await say(await handleTranscribe(post(WEBM), SELF))).text.length).toBeLessThanOrEqual(MAX_TEXT_CHARS);
  });
  it("answers silence (nothing heard) with an empty text and a kind note, not an error", async () => {
    for (const reply of [{ text: "" }, { text: "   " }]) {
      whisper(reply);
      const res = await handleTranscribe(post(WEBM), SELF);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ text: "", note: "I did not hear anything. Try again!" });
    }
  });
  it("answers a speech model that is down, errors, or returns nonsense with a plain 502 that says nothing about it", async () => {
    for (const [reply, status] of [[{ error: "x" }, 500], [{ error: "x" }, 401], ["not json", 200], [{ nope: 1 }, 200], [null, -1]] as const) {
      whisper(reply as unknown, status);
      const res = await handleTranscribe(post(WEBM), SELF);
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: "the voice helper is not answering" });
    }
  });
});

describe("the small pieces", () => {
  it("audioKindOf: the allow-list, ignoring case and parameters", () => {
    expect(audioKindOf("audio/webm;codecs=opus")).toBe("webm");
    expect(audioKindOf(" Audio/MP4 ")).toBe("mp4");
    expect(audioKindOf("audio/wave")).toBe("wav");
    expect(audioKindOf("audio/mpeg")).toBeNull();
    expect(audioKindOf(null)).toBeNull();
  });
  it("looksLike: each kind's first bytes", () => {
    expect(looksLike("webm", WEBM)).toBe(true);
    expect(looksLike("ogg", OGG)).toBe(true);
    expect(looksLike("mp4", MP4)).toBe(true);
    expect(looksLike("wav", wav(1))).toBe(true);
    expect(looksLike("webm", OGG)).toBe(false);
    expect(looksLike("wav", new Uint8Array(3))).toBe(false);
  });
  it("wavSeconds: from the header, through a LIST chunk, and null when it cannot be read", () => {
    expect(wavSeconds(wav(3))).toBeCloseTo(3, 6);
    expect(wavSeconds(wav(3, { list: true }))).toBeCloseTo(3, 6);
    expect(wavSeconds(new Uint8Array(10))).toBeNull();
    const noData = wav(1);
    noData.set([0x78, 0x78, 0x78, 0x78], 36); // "xxxx" where "data" was
    expect(wavSeconds(noData)).toBeNull();
  });
  it("safeWords: trims, scrubs, caps, and withholds", () => {
    expect(safeWords("  hello   there ")).toEqual({ text: "hello there" });
    expect(safeWords(undefined)).toEqual({ text: "", note: "I did not hear anything. Try again!" });
    expect(safeWords("kill them all").text).toBe("");
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Meta's speech model for the Nov 4 demo (Dan, 2026-11-04). The request is exactly what dev.meta.ai/docs/api-reference/voice/transcribe says: POST <base>/asr/transcribe, multipart,
// a `request` JSON part and an `audio` WAV part (mono integer PCM, 16 or 24 kHz), Bearer key, Accept JSON, the words in `transcript`.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const HOSTED = { TRANSCRIBE_BACKEND: "hosted", MODEL_API_KEY: "meta-secret-key" };

/** A WAV with the given format fields (silence). */
function wavFmt({ rate = 16000, channels = 1, bits = 16, format = 1, seconds = 1 } = {}): Uint8Array {
  const bytesPerSample = (bits / 8) * channels, dataBytes = Math.round(seconds * rate) * bytesPerSample;
  const b = new Uint8Array(44 + dataBytes);
  const v = new DataView(b.buffer);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + dataBytes, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, format, true); v.setUint16(22, channels, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * bytesPerSample, true); v.setUint16(32, bytesPerSample, true); v.setUint16(34, bits, true);
  w(36, "data"); v.setUint32(40, dataBytes, true);
  return b;
}

interface MetaSeen { url: string; headers: Record<string, string>; form: FormData | null }
function meta(reply: unknown = { sessionId: "s1", transcript: "a red race car", audioDurationMs: 1000, turns: [] }, status = 200) {
  const seen: MetaSeen[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    seen.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string>, form: (init?.body as FormData | undefined) ?? null });
    if (status === -1) throw new Error("network down");
    return new Response(typeof reply === "string" ? reply : JSON.stringify(reply), { status, headers: { "content-type": "application/json" } });
  }));
  return seen;
}

describe("hosted (Meta) is on only when chosen with TRANSCRIBE_BACKEND=hosted, and needs the key", () => {
  it("is on with the explicit switch and a key, in any case and with spaces, and the probe says so", async () => {
    expect(transcribeMode(HOSTED)).toBe("hosted");
    expect(transcribeMode({ ...HOSTED, TRANSCRIBE_BACKEND: " Hosted " })).toBe("hosted");
    expect(transcribeEnabled(HOSTED)).toBe(true);
    expect(await say(await handleTranscribe(get(), HOSTED))).toEqual({ ok: true, route: "transcribe", contract: 1, enabled: true });
  });
  it("the Meta key can be the older META_MODEL_API_KEY name", () => {
    expect(transcribeMode({ TRANSCRIBE_BACKEND: "hosted", META_MODEL_API_KEY: "k" })).toBe("hosted");
  });
  it("our own model wins when it is the chosen one, and a later change to self or off ends the exception", () => {
    expect(transcribeMode({ ...HOSTED, TRANSCRIBE_BACKEND: "self", SELF_TRANSCRIBE_URL: "https://whisper.example" })).toBe("self");
    expect(transcribeMode({ ...HOSTED, TRANSCRIBE_BACKEND: "self" })).toBe("off"); // self with no address: off, never a fall back to Meta
    expect(transcribeMode({ ...HOSTED, TRANSCRIBE_BACKEND: "off" })).toBe("off");
    expect(transcribeMode({ ...HOSTED, TRANSCRIBE_BACKEND: "hostd" })).toBe("off"); // a typo is off
  });
});

describe("hosted: what is sent to Meta is exactly what its reference says", () => {
  it("POSTs multipart to <base>/asr/transcribe with a Bearer key and Accept JSON: a `request` JSON part and an `audio` WAV part", async () => {
    const seen = meta();
    const audio = wavFmt({ seconds: 1 });
    const res = await handleTranscribe(post(audio, "audio/wav"), HOSTED);
    expect(res.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("https://api.meta.ai/v1/asr/transcribe");
    expect(seen[0]!.headers.authorization).toBe("Bearer meta-secret-key");
    expect(seen[0]!.headers.accept).toBe("application/json");
    const form = seen[0]!.form!;
    const request = form.get("request") as File;
    expect(request.type).toBe("application/json");
    expect(JSON.parse(await request.text())).toEqual({ model: META_ASR_MODEL, audioEncoding: "WAV", mode: "PUSH_TO_TALK" });
    expect(META_ASR_MODEL).toBe("muse-voice-transcribe-1.0");
    const part = form.get("audio") as File;
    expect(part.type).toBe("audio/wav");
    expect(part.name).toBe("voice.wav");
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(audio); // the bytes are forwarded unchanged, in memory
    expect([...form.keys()].sort()).toEqual(["audio", "request"]); // nothing else is sent: no language, no keywords, no ids
    expect(await say(res)).toEqual({ text: "a red race car" });
  });
  it("takes a 24 kHz WAV too, and uses META_MODEL_API_URL when one is set (with or without /responses on the end, as for the other routes)", async () => {
    const seen = meta();
    await handleTranscribe(post(wavFmt({ rate: 24000 }), "audio/wav"), { ...HOSTED, META_MODEL_API_URL: "https://meta.example/v1/" });
    expect(seen[0]!.url).toBe("https://meta.example/v1/asr/transcribe");
  });
  it("refuses anything but WAV before reading it or sending it anywhere (a Worker cannot decode webm, mp4 or ogg)", async () => {
    const seen = meta();
    for (const [body, type] of [[WEBM, "audio/webm"], [MP4, "audio/mp4"], [OGG, "audio/ogg;codecs=opus"]] as const) {
      const res = await handleTranscribe(post(body, type), HOSTED);
      expect(res.status, type).toBe(415);
      expect((await say(res)).error).toMatch(/WAV/);
    }
    expect(seen).toHaveLength(0);
  });
  it("refuses a WAV that is not mono 16-bit integer PCM at 16 or 24 kHz, and sends nothing", async () => {
    const seen = meta();
    for (const fmt of [{ channels: 2 }, { bits: 8 }, { bits: 24 }, { rate: 44100 }, { rate: 8000 }, { format: 3, bits: 32 }]) {
      expect((await handleTranscribe(post(wavFmt(fmt), "audio/wav"), HOSTED)).status, JSON.stringify(fmt)).toBe(415);
    }
    expect(seen).toHaveLength(0);
  });
  it("still refuses a WAV over 10 seconds, and a body that only claims to be a WAV", async () => {
    const seen = meta();
    expect((await handleTranscribe(post(wavFmt({ seconds: 11 }), "audio/wav"), HOSTED)).status).toBe(413);
    expect((await handleTranscribe(post(pad([1, 2, 3, 4]), "audio/wav"), HOSTED)).status).toBe(415);
    expect(seen).toHaveLength(0);
  });
  it("is still limited to 8 recordings a minute per address", async () => {
    meta();
    const same = { "CF-Connecting-IP": "10.9.9.9" };
    for (let i = 0; i < 8; i++) expect((await handleTranscribe(post(wavFmt(), "audio/wav", same), HOSTED)).status).toBe(200);
    expect((await handleTranscribe(post(wavFmt(), "audio/wav", same), HOSTED)).status).toBe(429);
  });
});

describe("hosted: what comes back is made safe the same way, and nothing leaks", () => {
  it("scrubs contact details, caps the words, withholds unsafe words and answers silence kindly", async () => {
    meta({ transcript: "call me on 555 123 4567 or mail kid@example.com about a truck" });
    const scrubbed = await say(await handleTranscribe(post(wavFmt(), "audio/wav"), HOSTED));
    expect(scrubbed.text).not.toMatch(/555|@/);
    meta({ transcript: "word ".repeat(200) });
    expect((await say(await handleTranscribe(post(wavFmt(), "audio/wav"), HOSTED))).text.length).toBeLessThanOrEqual(MAX_TEXT_CHARS);
    meta({ transcript: "" });
    const quiet = await say(await handleTranscribe(post(wavFmt(), "audio/wav"), HOSTED));
    expect(quiet.text).toBe("");
    expect(quiet.note).toMatch(/did not hear/);
  });
  it("answers Meta being down, erroring or returning nonsense with a plain 502 that says nothing about it, and a 429 from Meta with a 429", async () => {
    for (const [reply, status] of [[{ error: { type: "server_error", message: "secret upstream detail" } }, 500], ["not json", 200], [{ nope: 1 }, 200], [{}, -1]] as const) {
      meta(reply as unknown, status);
      const res = await handleTranscribe(post(wavFmt(), "audio/wav"), HOSTED);
      expect(res.status).toBe(502);
      const text = await res.text();
      expect(text).not.toMatch(/secret|meta-secret-key|api\.meta/);
    }
    meta({ error: { type: "rate_limited" } }, 429);
    expect((await handleTranscribe(post(wavFmt(), "audio/wav"), HOSTED)).status).toBe(429);
  });
  it("never returns the key or the address, and logs only an event, a status and the mode (never the audio or the words)", async () => {
    meta({ transcript: "a very private sentence about my school" });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const res = await handleTranscribe(post(wavFmt(), "audio/wav"), HOSTED);
    const body = JSON.stringify(await res.clone().json());
    expect(body).not.toMatch(/meta-secret-key|api\.meta\.ai/);
    const lines = log.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes("private sentence"))).toBe(false);
    expect(lines.map((l) => JSON.parse(l))).toContainEqual({ event: "transcribe", status: "ok", backend: "hosted" });
  });
});

describe("metaWavOk", () => {
  it("accepts mono 16-bit PCM at 16 kHz and 24 kHz, wherever the fmt chunk is, and nothing else", () => {
    expect(metaWavOk(wavFmt())).toBe(true);
    expect(metaWavOk(wavFmt({ rate: 24000 }))).toBe(true);
    expect(metaWavOk(wav(1, { list: true }))).toBe(true); // a LIST chunk after fmt does not matter
    expect(metaWavOk(wavFmt({ channels: 2 }))).toBe(false);
    expect(metaWavOk(wavFmt({ rate: 22050 }))).toBe(false);
    expect(metaWavOk(WEBM)).toBe(false);
    expect(metaWavOk(new Uint8Array(10))).toBe(false);
  });
});
