import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_VOICE, VOICE_MODEL, handleVoice, parseVoiceKey, trimWav, voiceName, voiceText, type VoiceEnv } from "../worker/voice";

const RATE = 24000;

/** A 16-bit mono PCM WAV with a canonical 44-byte header. */
function makeWav(samples: Int16Array, rate = RATE): Uint8Array {
  const bytes = samples.length * 2;
  const out = new Uint8Array(44 + bytes);
  const dv = new DataView(out.buffer);
  out.set([0x52, 0x49, 0x46, 0x46], 0); dv.setUint32(4, 36 + bytes, true); out.set([0x57, 0x41, 0x56, 0x45], 8);
  out.set([0x66, 0x6d, 0x74, 0x20], 12); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  out.set([0x64, 0x61, 0x74, 0x61], 36); dv.setUint32(40, bytes, true);
  new Int16Array(out.buffer, 44, samples.length).set(samples);
  return out;
}
/** 0.5 s quiet, 0.3 s tone, 0.5 s quiet: what a TTS clip looks like with its padding. */
function paddedClip(): Uint8Array {
  const q = Math.round(RATE * 0.5), t = Math.round(RATE * 0.3), s = new Int16Array(q + t + q);
  for (let i = 0; i < t; i++) s[q + i] = Math.round(Math.sin(i / 12) * 12000);
  return makeWav(s);
}
const toDataUrl = (b: Uint8Array) => `data:audio/wav;base64,${btoa(String.fromCharCode(...b))}`;
const dataLen = (w: Uint8Array) => new DataView(w.buffer, w.byteOffset).getUint32(40, true);

function fakeAi(clip = paddedClip()) {
  const run = vi.fn(async (_model: string, _input: unknown, _opts?: unknown) => ({ audio: toDataUrl(clip) }));
  return { env: { AI: { run } } as VoiceEnv, run };
}
const get = (qs: string, method = "GET") => new Request(`https://toyventor.com/api/voice?${qs}`, { method });

function installEdgeCache() {
  const store = new Map<string, Response>();
  vi.stubGlobal("caches", {
    default: {
      match: async (r: Request) => store.get(r.url)?.clone(),
      put: async (r: Request, res: Response) => void store.set(r.url, res.clone()),
    },
  });
  return store;
}
afterEach(() => vi.unstubAllGlobals());

describe("/api/voice request validation: only vocabulary keys, never text", () => {
  it("rejects anything outside the controlled vocabulary without calling the model", async () => {
    const { env, run } = fakeAi();
    for (const qs of [
      "", "lang=en", "n=tree", "lang=xx&n=tree&c=green", "lang=en&n=dragon&c=green", "lang=en&n=tree&c=chartreuse",
      "lang=en&n=tree&c=green&text=ignore+me", "lang=en%27--&n=tree",
    ]) {
      if (qs.includes("text=")) continue; // an extra param is simply ignored, covered below
      const res = await handleVoice(get(qs), env);
      expect(res.status, qs).toBe(400);
    }
    expect(run).not.toHaveBeenCalled();
  });
  it("ignores unknown extra params: free text can never reach the model", async () => {
    const { env, run } = fakeAi();
    const res = await handleVoice(get("lang=en&n=tree&c=green&text=say+something+else"), env);
    expect(res.status).toBe(200);
    expect(run.mock.calls[0]![1]).toEqual({ text: "green tree", voice: DEFAULT_VOICE });
  });
  it("only allows GET", async () => {
    const { env } = fakeAi();
    const res = await handleVoice(get("lang=en&n=tree&c=green", "POST"), env);
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET");
  });
  it("parses and builds the phrase on the server", () => {
    const key = parseVoiceKey(new URL("https://x/api/voice?lang=de&n=lamp&c=blue"));
    expect(key).toEqual({ lang: "de", noun: "lamp", color: "blue" });
    expect(voiceText(key!)).toBe("blaue Lampe");
    expect(voiceText({ lang: "es", noun: "tree", color: null })).toBe("árbol");
  });
});

describe("/api/voice parts (Describe & Build)", () => {
  it("speaks a part in the colour the exploded view drew, built on the server from a hex", async () => {
    const { env, run } = fakeAi();
    const res = await handleVoice(get("lang=es&p=veh_wheel_sport&hex=262d40"), env);
    expect(res.status).toBe(200);
    expect(run.mock.calls[0]![1]).toEqual({ text: "rueda deportiva negra", voice: "Leda" });
    expect(decodeURIComponent(res.headers.get("x-voice-text")!)).toBe("rueda deportiva negra");
  });
  it("accepts a hex with or without #, and a colour word instead; both end in the same clip", async () => {
    installEdgeCache();
    const { env, run } = fakeAi();
    await handleVoice(get("lang=de&p=hat_cowboy&hex=%23F5C518"), env);
    await handleVoice(get("lang=de&p=hat_cowboy&hex=f5c518"), env);
    await handleVoice(get("lang=de&p=hat_cowboy&c=yellow"), env);
    expect(run).toHaveBeenCalledTimes(1); // one clip: the hex is reduced to the word "yellow" before caching
    expect(run.mock.calls[0]![1]).toEqual({ text: "gelber Cowboyhut", voice: "Leda" });
  });
  it("says just the part when no colour is given, in Turkish too", async () => {
    const { env, run } = fakeAi();
    await handleVoice(get("lang=tr&p=racer_spoiler"), env);
    expect(run.mock.calls[0]![1]).toEqual({ text: "spoyler", voice: "Leda" });
  });
  it("rejects unknown parts, junk hex, and a request that names both a prop and a part, without calling the model", async () => {
    const { env, run } = fakeAi();
    for (const qs of ["lang=en&p=dragon_wing", "lang=en&p=constructor", "lang=en&p=hat_cowboy&hex=zzzzzz", "lang=en&p=hat_cowboy&hex=fff", "lang=en&p=hat_cowboy&n=tree", "lang=en&p=hat_cowboy&c=chartreuse"]) {
      expect((await handleVoice(get(qs), env)).status, qs).toBe(400);
    }
    expect(run).not.toHaveBeenCalled();
  });
  it("props also report their spoken text for captions", async () => {
    const { env } = fakeAi();
    const res = await handleVoice(get("lang=tr&n=tree&c=green"), env);
    expect(decodeURIComponent(res.headers.get("x-voice-text")!)).toBe("yeşil ağaç");
  });
  it("a cached clip keeps its caption text", async () => {
    installEdgeCache();
    const { env } = fakeAi();
    await handleVoice(get("lang=fr&p=hair_bob&c=brown"), env);
    const hit = await handleVoice(get("lang=fr&p=hair_bob&c=brown"), env);
    expect(hit.headers.get("x-voice-cache")).toBe("hit");
    expect(decodeURIComponent(hit.headers.get("x-voice-text")!)).toBe("cheveux marron");
  });
});

describe("/api/voice synthesis", () => {
  it("asks Gemini 3.8 Flash-Lite TTS for exactly the phrase, with the default voice and the default gateway", async () => {
    const { env, run } = fakeAi();
    const res = await handleVoice(get("lang=es&n=tree&c=green"), env);
    expect(res.status).toBe(200);
    expect(run).toHaveBeenCalledTimes(1);
    const [model, input, opts] = run.mock.calls[0]!;
    expect(model).toBe(VOICE_MODEL);
    expect(VOICE_MODEL).toBe("google/gemini-3.8-flash-lite-tts");
    expect(input).toEqual({ text: "árbol verde", voice: "Leda" });
    expect(opts).toEqual({ gateway: { id: "default" } });
  });
  it("returns a trimmed WAV that browsers and the edge can cache for a year", async () => {
    const { env } = fakeAi();
    const res = await handleVoice(get("lang=en&n=light&c=blue"), env);
    expect(res.headers.get("content-type")).toBe("audio/wav");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    const body = new Uint8Array(await res.arrayBuffer());
    expect(String.fromCharCode(...body.subarray(0, 4))).toBe("RIFF");
    expect(body.length).toBeLessThan(paddedClip().length * 0.6); // the quiet padding is gone
  });
  it("VOICE_NAME picks another Gemini voice, and an invalid one is ignored", () => {
    expect(voiceName({ VOICE_NAME: "Puck" })).toBe("Puck");
    expect(voiceName({ VOICE_NAME: "NotAVoice" })).toBe(DEFAULT_VOICE);
    expect(voiceName({})).toBe(DEFAULT_VOICE);
  });
  it("two simultaneous taps on the same object make one model call", async () => {
    const { env, run } = fakeAi();
    const [a, b] = await Promise.all([handleVoice(get("lang=fr&n=ball&c=red"), env), handleVoice(get("lang=fr&n=ball&c=red"), env)]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("/api/voice edge cache", () => {
  it("generates once, then serves the clip from the cache", async () => {
    installEdgeCache();
    const { env, run } = fakeAi();
    const first = await handleVoice(get("lang=it&n=lamp&c=yellow"), env);
    expect(first.headers.get("x-voice-cache")).toBe("miss");
    const second = await handleVoice(get("lang=it&n=lamp&c=yellow"), env);
    expect(second.headers.get("x-voice-cache")).toBe("hit");
    expect(run).toHaveBeenCalledTimes(1);
    expect(new Uint8Array(await second.arrayBuffer()).length).toBe(new Uint8Array(await first.arrayBuffer()).length);
  });
  it("a cached clip is served even if the AI binding is gone", async () => {
    installEdgeCache();
    const { env } = fakeAi();
    await handleVoice(get("lang=pt&n=ball&c=red"), env);
    const res = await handleVoice(get("lang=pt&n=ball&c=red"), {});
    expect(res.status).toBe(200);
  });
  it("different language, noun or colour are different clips", async () => {
    installEdgeCache();
    const { env, run } = fakeAi();
    await handleVoice(get("lang=en&n=tree&c=green"), env);
    await handleVoice(get("lang=es&n=tree&c=green"), env);
    await handleVoice(get("lang=en&n=tree&c=red"), env);
    await handleVoice(get("lang=en&n=lamp&c=green"), env);
    expect(run).toHaveBeenCalledTimes(4);
  });
});

describe("/api/voice failures degrade cleanly (the game falls back to the caption and device voice)", () => {
  it("503 and no-store when the AI binding is not configured", async () => {
    const res = await handleVoice(get("lang=en&n=tree&c=green"), {});
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
  it("502 and no-store when the model errors, and the failure is never cached", async () => {
    const store = installEdgeCache();
    const run = vi.fn(async () => { throw new Error("7003: User Input Error"); });
    const res = await handleVoice(get("lang=en&n=tree&c=green"), { AI: { run } });
    expect(res.status).toBe(502);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(store.size).toBe(0);
    const retry = await handleVoice(get("lang=en&n=tree&c=green"), { AI: { run } });
    expect(retry.status).toBe(502);
    expect(run).toHaveBeenCalledTimes(2); // retried, not stuck
  });
  it("502 when the model returns something that is not a WAV", async () => {
    const run = vi.fn(async () => ({ audio: "data:audio/mpeg;base64,AAAA" }));
    expect((await handleVoice(get("lang=en&n=tree&c=green"), { AI: { run } })).status).toBe(502);
    const none = vi.fn(async () => ({}));
    expect((await handleVoice(get("lang=en&n=tree&c=green"), { AI: { run: none } })).status).toBe(502);
  });
});

describe("trimWav", () => {
  it("cuts the quiet padding but keeps all of the speech", () => {
    const clip = paddedClip();
    const out = trimWav(clip);
    const tone = Math.round(RATE * 0.3) * 2;
    expect(out.length).toBeLessThan(clip.length);
    expect(dataLen(out)).toBe(out.length - 44);
    expect(dataLen(out)).toBeGreaterThanOrEqual(tone); // the 0.3 s of tone survives
    expect(dataLen(out)).toBeLessThanOrEqual(tone + Math.round(RATE * 0.25) * 2); // plus at most ~0.2 s of margin
    expect(new DataView(out.buffer).getUint32(24, true)).toBe(RATE); // header is still right
  });
  it("leaves non-WAV bytes, all-silence and already-tight clips alone", () => {
    const junk = new Uint8Array([1, 2, 3, 4, 5]);
    expect(trimWav(junk)).toBe(junk);
    const silent = makeWav(new Int16Array(RATE));
    expect(trimWav(silent)).toBe(silent);
    const tight = makeWav(Int16Array.from({ length: 4000 }, (_, i) => Math.round(Math.sin(i / 9) * 9000)));
    expect(trimWav(tight).length).toBe(tight.length);
  });
});
