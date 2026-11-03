// The household items' voice: the `h=` key of /api/voice and the client function the Garage calls. The names file is REPLACED by a small fixture
// (vi.mock of the JSON), so these tests do not depend on how many languages the Muse run has filled in; tests/household-names.test.ts checks the real file.
// Nothing here reaches the live model: the AI binding is a stub.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => {
  const e = (w: string) => ({ w, source: "test", review: "unreviewed" });
  return {
    version: 1,
    pending: ["fr", "de", "it", "pt", "tr"],
    names: {
      wooden_spoon: { en: e("wooden spoon"), es: e("cuchara de madera") },
      support_tool: { en: e("toy tool") },
      banana: { en: e("banana"), es: e("plátano"), pt: e("banana") },
    },
  };
});
vi.mock("../src/lib/householdNames.json", () => ({ default: fixture }));

import { DEFAULT_VOICE, handleVoice, parseVoiceKey, voiceText, type VoiceEnv } from "../worker/voice";
import { householdVoiceUrl, speakHouseholdName } from "../src/lib/householdVoice";
import { householdTextHash } from "../src/lib/householdNames";
import { resetVoiceBackoff } from "../src/lib/propVoice";

const RATE = 24000;
function wav(): Uint8Array {
  const n = Math.round(RATE * 0.3);
  const out = new Uint8Array(44 + n * 2);
  const dv = new DataView(out.buffer);
  out.set([0x52, 0x49, 0x46, 0x46], 0); dv.setUint32(4, 36 + n * 2, true); out.set([0x57, 0x41, 0x56, 0x45], 8);
  out.set([0x66, 0x6d, 0x74, 0x20], 12); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, RATE, true); dv.setUint32(28, RATE * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  out.set([0x64, 0x61, 0x74, 0x61], 36); dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.round(Math.sin(i / 12) * 12000), true);
  return out;
}
const dataUrl = (b: Uint8Array) => `data:audio/wav;base64,${btoa(String.fromCharCode(...b))}`;
function fakeAi() {
  const run = vi.fn(async (_m: string, _i: unknown, _o?: unknown) => ({ audio: dataUrl(wav()) }));
  return { env: { AI: { run } } as VoiceEnv, run };
}
const get = (qs: string, method = "GET") => new Request(`https://toyventor.com/api/voice?${qs}`, { method });
function edgeCache() {
  const store = new Map<string, Response>();
  vi.stubGlobal("caches", { default: { match: async (r: Request) => store.get(r.url)?.clone(), put: async (r: Request, res: Response) => void store.set(r.url, res.clone()) } });
  return store;
}
beforeEach(() => resetVoiceBackoff());
afterEach(() => vi.unstubAllGlobals());

describe("/api/voice?h= : a household item's bare noun, from a closed vocabulary", () => {
  it("parses the key and builds the text on the server from the names file", () => {
    const key = parseVoiceKey(new URL("https://x/api/voice?lang=es&h=wooden_spoon"));
    expect(key).toEqual({ lang: "es", household: "wooden_spoon", color: null });
    expect(voiceText(key!)).toBe("cuchara de madera");
    expect(voiceText(parseVoiceKey(new URL("https://x/api/voice?lang=en&h=support_tool"))!)).toBe("toy tool");
  });
  it("speaks exactly the noun, with the default voice and gateway, and reports the text and the voice", async () => {
    const { env, run } = fakeAi();
    const res = await handleVoice(get("lang=es&h=wooden_spoon"), env);
    expect(res.status).toBe(200);
    expect(run.mock.calls[0]![1]).toEqual({ text: "cuchara de madera", voice: DEFAULT_VOICE });
    expect(run.mock.calls[0]![2]).toEqual({ gateway: { id: "default" } });
    expect(decodeURIComponent(res.headers.get("x-voice-text")!)).toBe("cuchara de madera");
    expect(res.headers.get("x-voice-voice")).toBe(DEFAULT_VOICE);
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });
  it("rejects anything outside the vocabulary before any cache read or model call: unknown ids, prototype names, a colour, another key beside it, a bad language", async () => {
    const store = edgeCache();
    const { env, run } = fakeAi();
    for (const qs of [
      "lang=es&h=dragon", "lang=es&h=", "lang=es&h=constructor", "lang=es&h=__proto__", "lang=es&h=toString", "lang=es&h=WOODEN_SPOON", "lang=es&h=wooden_spoon%20",
      "lang=es&h=wooden_spoon&c=red", "lang=es&h=wooden_spoon&hex=ff0000", "lang=es&h=wooden_spoon&n=tree", "lang=es&h=wooden_spoon&p=hat_cowboy",
      "lang=es&h=wooden_spoon&w=cuchara&g=f&sig=x", "lang=xx&h=wooden_spoon", "h=wooden_spoon",
    ]) expect((await handleVoice(get(qs), env)).status, qs).toBe(400);
    expect(run).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });
  it("ignores free text in extra params: only the file's words can be spoken", async () => {
    const { env, run } = fakeAi();
    const res = await handleVoice(get("lang=es&h=wooden_spoon&text=say+something+else&v=whatever"), env);
    expect(res.status).toBe(200);
    expect(run.mock.calls[0]![1]).toEqual({ text: "cuchara de madera", voice: DEFAULT_VOICE });
  });
  it("answers 404 and no-store for an item with no name in that language yet, without touching the cache or the model", async () => {
    const store = edgeCache();
    const { env, run } = fakeAi();
    const res = await handleVoice(get("lang=es&h=support_tool"), env);
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(run).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
    expect((await handleVoice(get("lang=tr&h=wooden_spoon"), env)).status).toBe(404);
  });
  it("only allows GET", async () => {
    const { env } = fakeAi();
    expect((await handleVoice(get("lang=es&h=wooden_spoon", "POST"), env)).status).toBe(405);
  });
  it("generates once and serves the clip from the cache afterwards, even with the AI binding gone", async () => {
    edgeCache();
    const { env, run } = fakeAi();
    expect((await handleVoice(get("lang=es&h=wooden_spoon"), env)).headers.get("x-voice-cache")).toBe("miss");
    const hit = await handleVoice(get("lang=es&h=wooden_spoon"), {});
    expect(hit.status).toBe(200);
    expect(hit.headers.get("x-voice-cache")).toBe("hit");
    expect(decodeURIComponent(hit.headers.get("x-voice-text")!)).toBe("cuchara de madera");
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("a noun a reviewer changes is a NEW clip (the cache key carries a fingerprint of the text), and putting it back finds the old clip", async () => {
    edgeCache();
    const { env, run } = fakeAi();
    await handleVoice(get("lang=es&h=banana"), env);
    expect(run).toHaveBeenCalledTimes(1);
    const es = (fixture.names.banana as Record<string, { w: string }>).es!;
    es.w = "banana";
    try {
      await handleVoice(get("lang=es&h=banana"), env);
      expect(run).toHaveBeenCalledTimes(2);
      expect(run.mock.calls[1]![1]).toEqual({ text: "banana", voice: DEFAULT_VOICE });
      await handleVoice(get("lang=es&h=banana"), env);
      expect(run).toHaveBeenCalledTimes(2); // the new clip is cached
    } finally {
      es.w = "plátano";
    }
    await handleVoice(get("lang=es&h=banana"), env);
    expect(run).toHaveBeenCalledTimes(2); // the first clip was still there
  });
  it("different items and different languages are different clips; one item twice at once is one call", async () => {
    edgeCache();
    const { env, run } = fakeAi();
    await handleVoice(get("lang=es&h=banana"), env);
    await handleVoice(get("lang=pt&h=banana"), env);
    await handleVoice(get("lang=en&h=banana"), env);
    await handleVoice(get("lang=es&h=wooden_spoon"), env);
    expect(run).toHaveBeenCalledTimes(4);
    const fresh = fakeAi();
    await Promise.all([handleVoice(get("lang=en&h=support_tool"), fresh.env), handleVoice(get("lang=en&h=support_tool"), fresh.env)]);
    expect(fresh.run).toHaveBeenCalledTimes(1);
  });
  it("503 without the AI binding and 502 when the model fails, neither cached", async () => {
    const store = edgeCache();
    expect((await handleVoice(get("lang=es&h=wooden_spoon"), {})).status).toBe(503);
    const run = vi.fn(async () => { throw new Error("7003"); });
    expect((await handleVoice(get("lang=es&h=wooden_spoon"), { AI: { run } })).status).toBe(502);
    expect(store.size).toBe(0);
  });
});

describe("householdVoiceUrl and speakHouseholdName (the client)", () => {
  const audios: Array<{ url: string; listeners: Record<string, () => void>; played: boolean }> = [];
  const spoken: Array<{ text: string; lang: string }> = [];
  beforeEach(() => {
    audios.length = 0;
    spoken.length = 0;
    vi.stubGlobal("Audio", class {
      url: string; listeners: Record<string, () => void> = {}; played = false;
      constructor(url: string) { this.url = url; audios.push(this as never); }
      addEventListener(ev: string, fn: () => void) { this.listeners[ev] = fn; }
      play() { this.played = true; return Promise.resolve(); }
      pause() {}
    });
    vi.stubGlobal("SpeechSynthesisUtterance", class { text: string; lang = ""; rate = 1; pitch = 1; constructor(t: string) { this.text = t; } });
    vi.stubGlobal("window", { speechSynthesis: { cancel() {}, speak(u: { text: string; lang: string }) { spoken.push({ text: u.text, lang: u.lang }); } } });
  });

  it("builds the clip URL from the language, the item and a fingerprint of the text, and gives null where the language has no name yet", () => {
    const url = householdVoiceUrl("wooden_spoon", "es")!;
    const q = new URL(url, "https://x").searchParams;
    expect(url.startsWith("/api/voice?")).toBe(true);
    expect([q.get("lang"), q.get("h"), q.get("v")]).toEqual(["es", "wooden_spoon", householdTextHash("cuchara de madera")]);
    expect(householdVoiceUrl("support_tool", "es")).toBeNull();
    expect(householdVoiceUrl("dragon", "en")).toBeNull();
  });
  it("plays the clip in the chosen language when the item has a name there", () => {
    const r = speakHouseholdName("wooden_spoon", { lang: "es" });
    expect(r).toEqual({ via: "clip", text: "cuchara de madera", lang: "es" });
    expect(audios).toHaveLength(1);
    expect(audios[0]!.url).toContain("lang=es");
    expect(audios[0]!.url).toContain("h=wooden_spoon");
    expect(audios[0]!.played).toBe(true);
  });
  it("says the English name, in English, when the chosen language has none yet (never a guessed translation)", () => {
    const r = speakHouseholdName("support_tool", { lang: "tr" });
    expect(r).toEqual({ via: "clip", text: "toy tool", lang: "en" });
    expect(audios[0]!.url).toContain("lang=en");
    expect(audios[0]!.url).toContain("h=support_tool");
  });
  it("uses the player's language setting when none is given, and English when nothing is stored", () => {
    const r = speakHouseholdName("banana");
    expect(r).toEqual({ via: "clip", text: "banana", lang: "en" }); // no localStorage here: the default is English
  });
  it("says nothing when the player chose Off, or for an id that is not a household item", () => {
    expect(speakHouseholdName("wooden_spoon", { lang: "off" })).toBeNull();
    expect(speakHouseholdName("dragon", { lang: "es" })).toBeNull();
    expect(speakHouseholdName("constructor", { lang: "es" })).toBeNull();
    expect(audios).toHaveLength(0);
    expect(spoken).toHaveLength(0);
  });
  it("falls back to the device voice with an EXPLICIT language tag when the clip fails, so a word spelled alike in two languages cannot be mis-detected", () => {
    speakHouseholdName("banana", { lang: "pt" });
    expect(spoken).toHaveLength(0); // the clip is trying
    audios[0]!.listeners.error!(); // the server answered 404/502/offline
    expect(spoken).toEqual([{ text: "banana", lang: "pt-BR" }]);
  });
  it("goes straight to the device voice, tagged, while the server is backed off after a failure", () => {
    speakHouseholdName("wooden_spoon", { lang: "es", now: 1_000 });
    audios[0]!.listeners.error!();
    spoken.length = 0;
    const second = speakHouseholdName("wooden_spoon", { lang: "es", now: Date.now() + 1 });
    expect(second!.via).toBe("device");
    expect(spoken).toEqual([{ text: "cuchara de madera", lang: "es-ES" }]);
    expect(audios).toHaveLength(1); // no second request
  });
  it("reports 'none' when there is neither a clip nor a device voice, and the caption text is still returned", () => {
    vi.stubGlobal("Audio", undefined);
    vi.stubGlobal("window", {});
    expect(speakHouseholdName("wooden_spoon", { lang: "es" })).toEqual({ via: "none", text: "cuchara de madera", lang: "es" });
  });
});
