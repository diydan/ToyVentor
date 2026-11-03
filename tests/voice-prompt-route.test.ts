import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_VOICE, VOICE_MODEL, handleVoice, parseVoiceKey, voiceText, type VoiceEnv } from "../worker/voice";
import { SCENE_PROMPTS, promptIdForText, scenePromptUrl } from "../src/lib/scenePrompts";

// /api/voice?s=<id>: the Carousel scene prompts, English, by the id of a line in the closed list (src/lib/scenePrompts.json). Never text.

const RATE = 24000;
function makeWav(samples: Int16Array): Uint8Array {
  const bytes = samples.length * 2;
  const out = new Uint8Array(44 + bytes);
  const dv = new DataView(out.buffer);
  out.set([0x52, 0x49, 0x46, 0x46], 0); dv.setUint32(4, 36 + bytes, true); out.set([0x57, 0x41, 0x56, 0x45], 8);
  out.set([0x66, 0x6d, 0x74, 0x20], 12); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, RATE, true); dv.setUint32(28, RATE * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  out.set([0x64, 0x61, 0x74, 0x61], 36); dv.setUint32(40, bytes, true);
  new Int16Array(out.buffer, 44, samples.length).set(samples);
  return out;
}
/** 0.5 s quiet, 0.3 s tone, 0.5 s quiet: what a TTS clip looks like with its padding (the route trims it). */
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
  const matched: string[] = [];
  const store = new Map<string, Response>();
  vi.stubGlobal("caches", {
    default: {
      match: async (r: Request) => (matched.push(r.url), store.get(r.url)?.clone()),
      put: async (r: Request, res: Response) => void store.set(r.url, res.clone()),
    },
  });
  return { store, matched };
}
afterEach(() => vi.unstubAllGlobals());

const BALL = SCENE_PROMPTS.find((p) => p.text === "Go get the ball.")!;

describe("/api/voice?s=<id>: a Carousel scene prompt", () => {
  it("parses an id from the list as English, with no colour, and turns it back into its line", () => {
    const key = parseVoiceKey(new URL(get(`s=${BALL.id}`).url));
    expect(key).toEqual({ lang: "en", prompt: BALL.id, color: null });
    expect(voiceText(key!)).toBe("Go get the ball.");
    // English may be said out loud, nothing else; unknown extra params (a cache-buster) are ignored like everywhere else on the route
    expect(parseVoiceKey(new URL(get(`lang=en&s=${BALL.id}&v=1`).url))).toEqual(key);
  });

  it("speaks the line bare (English needs no lead-in) with the game's voice, once, and answers with the audio and the text", async () => {
    installEdgeCache();
    const { env, run } = fakeAi();
    const res = await handleVoice(get(`s=${BALL.id}`), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/wav");
    expect(res.headers.get("x-voice-cache")).toBe("miss");
    expect(res.headers.get("x-voice-voice")).toBe(DEFAULT_VOICE);
    expect(decodeURIComponent(res.headers.get("x-voice-text")!)).toBe("Go get the ball.");
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(VOICE_MODEL, { text: "Go get the ball.", voice: DEFAULT_VOICE }, { gateway: { id: "default" } });
    // the same trim as every clip: the model's beat of quiet at both ends is gone
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe("RIFF");
    expect(dataLen(bytes)).toBeLessThan(dataLen(paddedClip()));
  });

  it("serves the second ask from the edge cache without calling the model again", async () => {
    installEdgeCache();
    const { env, run } = fakeAi();
    await handleVoice(get(`s=${BALL.id}`), env);
    const again = await handleVoice(get(`s=${BALL.id}`), env);
    expect(again.status).toBe(200);
    expect(again.headers.get("x-voice-cache")).toBe("hit");
    expect(run).toHaveBeenCalledTimes(1);
    // another line is another clip
    const other = SCENE_PROMPTS.find((p) => p.text === "All done!")!;
    await handleVoice(get(`s=${other.id}`), env);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("levels the clip like every other (the model's loudness varies five-fold): a quiet clip comes out louder, by the same capped gain", async () => {
    const samples = Int16Array.from({ length: 4800 }, (_, i) => Math.round(Math.sin(i / 12) * 600));
    const rmsOf = (a: Int16Array) => Math.sqrt(a.reduce((sum, v) => sum + v * v, 0) / a.length);
    const { env } = fakeAi(makeWav(samples));
    const res = await handleVoice(get(`s=${BALL.id}`), env);
    const out = new Int16Array((await res.arrayBuffer()).slice(44));
    expect(rmsOf(out) / rmsOf(samples)).toBeGreaterThan(3.8); // a 600-peak tone is far below the 5000 target, so the gain is its cap, 4
    expect(rmsOf(out) / rmsOf(samples)).toBeLessThan(4.2);
  });

  it("refuses anything that is not an id from the list BEFORE any cache read or model call: free text, near misses, other keys mixed in", async () => {
    const cache = installEdgeCache();
    const { env, run } = fakeAi();
    const bad = [
      "s=", "s=00000000", "s=constructor", "s=__proto__", `s=${BALL.id.toUpperCase()}`, `s=${BALL.id}x`, `s=${BALL.id}%20`,
      "s=Go+get+the+ball.", `s=${encodeURIComponent("Say something a child typed")}`, "s=a3a3bb5", "s=a3a3bb511",
      `s=${BALL.id}&lang=es`, `s=${BALL.id}&lang=xx`, `s=${BALL.id}&lang=`, `s=${BALL.id}&n=tree`, `s=${BALL.id}&p=veh_wheel_sport`, `s=${BALL.id}&h=wooden_spoon`,
      `s=${BALL.id}&c=green`, `s=${BALL.id}&hex=262d40`, `s=${BALL.id}&w=cuchara&g=f&sig=${"A".repeat(43)}`,
    ];
    for (const qs of bad) expect((await handleVoice(get(qs), env)).status, qs).toBe(400);
    expect(run).not.toHaveBeenCalled();
    expect(cache.matched).toEqual([]);
    expect(cache.store.size).toBe(0);
  });

  it("does not let a prompt id stand in for another kind of key, nor another key for a prompt", async () => {
    const { env, run } = fakeAi();
    expect((await handleVoice(get(`lang=en&n=${BALL.id}`), env)).status).toBe(400);
    expect((await handleVoice(get(`lang=en&h=${BALL.id}`), env)).status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });

  it("503 without the AI binding and 502 when the model fails, neither cached; only GET", async () => {
    const { store } = installEdgeCache();
    expect((await handleVoice(get(`s=${BALL.id}`), {})).status).toBe(503);
    const run = vi.fn(async () => { throw new Error("7003"); });
    expect((await handleVoice(get(`s=${BALL.id}`), { AI: { run } })).status).toBe(502);
    expect(store.size).toBe(0);
    const { env } = fakeAi();
    expect((await handleVoice(get(`s=${BALL.id}`, "POST"), env)).status).toBe(405);
  });

  it("makes ONE clip for each line in the list, no matter how many times or how fast they are asked for", async () => {
    installEdgeCache();
    const { env, run } = fakeAi();
    await Promise.all([...SCENE_PROMPTS, ...SCENE_PROMPTS].map((p) => handleVoice(get(`s=${p.id}`), env)));
    // the in-flight map shares a generation between concurrent asks for the same line
    expect(run).toHaveBeenCalledTimes(SCENE_PROMPTS.length);
    const texts = run.mock.calls.map((c) => (c[1] as { text: string }).text).sort();
    expect(texts).toEqual(SCENE_PROMPTS.map((p) => p.text).sort());
  });

  it("is the URL the client builds", () => {
    expect(scenePromptUrl(BALL.id)).toBe(`/api/voice?s=${BALL.id}`);
    expect(promptIdForText("Go get the ball.")).toBe(BALL.id);
  });
});
