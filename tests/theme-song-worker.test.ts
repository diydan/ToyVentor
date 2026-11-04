import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleThemeSong, resetThemeSongLimits, themePrompt, themeSongEnabled } from "../worker/themeSong";

const ENV = { MODEL_API_KEY: "text-key", META_MODEL_API_URL: "https://meta.example/v1", MUREKA_API_KEY: "mureka-secret", MUREKA_API_URL: "https://mureka.example", MUREKA_AUDIO_HOST: "cdn.mureka.example", THEME_SONG: "on", THEME_SONG_QUOTA: "off" }; // unmetered: the metered path is in tests/theme-song-metered.test.ts
const GOOD = {
  name: "Zippy Roadster", mood: "bouncy", tempo: "fast", instruments: ["drums"],
  verse: ["Wheels go round and round", "Down the sunny road", "Little engine hums a tune", "Off we go, off we go"],
  chorus: ["Zippy Roadster, zoom zoom zoom", "Zippy Roadster, make some room", "Wheels are spinning, hear us sing", "Zippy Roadster is the king"],
};

interface Calls { text: number; order: Array<{ url: string; body: any; auth: string | null }>; query: string[]; audio: string[] }
/** The text model answers each call from `replies` (the last one repeats); Mureka orders task 123456789 and answers queries from `queryAs`. */
function stub(replies: unknown[], opts: { orderStatus?: number; queryAs?: unknown; audioAs?: () => Response } = {}) {
  const calls: Calls = { text: 0, order: [], query: [], audio: [] };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith("https://meta.example")) {
      const r = replies[Math.min(calls.text, replies.length - 1)];
      calls.text++;
      const text = typeof r === "string" ? r : JSON.stringify(r);
      return new Response(JSON.stringify({ output: [{ content: [{ type: "output_text", text }] }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.startsWith("https://cdn.mureka.example/")) {
      calls.audio.push(url);
      return opts.audioAs ? opts.audioAs() : new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { "content-type": "audio/mpeg" } });
    }
    if (url.startsWith("https://mureka.example")) {
      const auth = (init?.headers as Record<string, string>)?.authorization ?? null;
      if (init?.method === "POST") {
        calls.order.push({ url, body: JSON.parse(init.body as string), auth });
        if (opts.orderStatus && opts.orderStatus !== 200) return new Response("{}", { status: opts.orderStatus });
        return new Response(JSON.stringify({ id: "123456789", status: "preparing" }), { status: 200 });
      }
      calls.query.push(url);
      return new Response(JSON.stringify(opts.queryAs ?? { id: "123456789", status: "running" }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  }));
  return calls;
}
let ip = 0;
const fresh = () => ({ "CF-Connecting-IP": `10.1.0.${++ip}` });
const post = (body: unknown, headers: Record<string, string> = fresh()) =>
  new Request("https://toyventor.com/api/theme-song", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const get = (qs = "", headers: Record<string, string> = fresh()) => new Request(`https://toyventor.com/api/theme-song${qs}`, { headers });

beforeEach(() => resetThemeSongLimits());
afterEach(() => vi.unstubAllGlobals());

describe("off unless switched on", () => {
  it("says so on a plain GET and answers 503 to everything else, spending nothing", async () => {
    const calls = stub([GOOD]);
    for (const env of [{ ...ENV, THEME_SONG: undefined }, { ...ENV, THEME_SONG: "off" }, { ...ENV, MUREKA_API_KEY: "" }, { ...ENV, MODEL_BACKEND: "off" }]) {
      expect(themeSongEnabled(env)).toBe(false);
      expect(((await (await handleThemeSong(get(), env)).json()) as { enabled: boolean }).enabled).toBe(false);
      expect((await handleThemeSong(post({ description: "a race car" }), env)).status).toBe(503);
      expect((await handleThemeSong(get("?id=123456789"), env)).status).toBe(503);
    }
    expect(calls.text).toBe(0);
    expect(calls.order).toHaveLength(0);
  });
  it("is enabled with the switch, the key and a text model", () => {
    expect(themeSongEnabled(ENV)).toBe(true);
  });
});

describe("POST: a name, the words, and one ordered song", () => {
  it("returns the name and the checked words and orders ONE song with the lyrics we built and the fixed style text", async () => {
    const calls = stub([GOOD]);
    const res = await handleThemeSong(post({ description: "a race car" }), ENV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body).toMatchObject({ name: "Zippy Roadster", mood: "bouncy", tempo: "fast", ai: true, task: "123456789" });
    expect(body.verse).toEqual(GOOD.verse);
    expect(calls.order).toHaveLength(1);
    const sent = calls.order[0]!;
    expect(sent.url).toBe("https://mureka.example/v1/song/generate");
    expect(sent.auth).toBe("Bearer mureka-secret");
    expect(sent.body.n).toBe(1);
    expect(sent.body.model).toBe("mureka-9");
    expect(sent.body.lyrics.startsWith("[Verse]\nWheels go round and round")).toBe(true);
    expect(sent.body.prompt).toMatch(/children's theme song/);
    expect(Object.keys(sent.body).sort()).toEqual(["lyrics", "model", "n", "prompt"]);
  });
  it("never returns the key, and the child's own words never reach the provider", async () => {
    const calls = stub([GOOD]);
    const res = await handleThemeSong(post({ description: "my secret phrase about a purple dragon car" }), ENV);
    expect(JSON.stringify(await res.json())).not.toContain("mureka-secret");
    expect(JSON.stringify(calls.order)).not.toMatch(/purple dragon/);
  });
  it("scrubs contact details out of the prompt as a second layer: even on the one kind that is not screened, the model never sees them", async () => {
    stub([GOOD]);
    const f = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>);
    await handleThemeSong(post({ description: "a car, call 07700 900123 or mail me@x.com", kind: "level" }, fresh()), ENV);
    const sent = JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string).input as string;
    expect(sent).not.toContain("07700");
    expect(sent).not.toContain("me@x.com");
  });
  it("asks again once when the first reply fails the gate, then orders", async () => {
    const calls = stub([{ ...GOOD, name: "Lego Racer" }, GOOD]);
    const body = (await (await handleThemeSong(post({ description: "a race car" }), ENV)).json()) as Record<string, any>;
    expect(calls.text).toBe(2);
    expect(body.name).toBe("Zippy Roadster");
    expect(calls.order).toHaveLength(1);
  });
  it("orders NOTHING when both replies fail the gate, and says why", async () => {
    const calls = stub([{ ...GOOD, verse: ["We will kill the engine", ...GOOD.verse.slice(1)] }]);
    const res = await handleThemeSong(post({ description: "a race car" }), ENV);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ reason: "verse_unsafe" });
    expect(calls.order).toHaveLength(0);
  });
  it("orders nothing when the model does not return JSON", async () => {
    const calls = stub(["I am not JSON"]);
    expect((await handleThemeSong(post({ description: "a race car" }), ENV)).status).toBe(502);
    expect(calls.order).toHaveLength(0);
  });
  it("still returns the name and the words when the song could not be ordered, and does not count the spend", async () => {
    stub([GOOD], { orderStatus: 500 });
    const body = (await (await handleThemeSong(post({ description: "a race car" }), ENV)).json()) as Record<string, any>;
    expect(body.name).toBe("Zippy Roadster");
    expect(body.task).toBeNull();
    expect(body.songError).toBeTruthy();
  });
  it("validates the request: JSON content type, a description, and a size", async () => {
    stub([GOOD]);
    expect((await handleThemeSong(new Request("https://t/api/theme-song", { method: "POST", headers: { ...fresh(), "content-type": "text/plain" }, body: "x" }), ENV)).status).toBe(415);
    expect((await handleThemeSong(post({}), ENV)).status).toBe(422);
    expect((await handleThemeSong(post({ description: "x".repeat(301) }), ENV)).status).toBe(413);
  });
  it("limits one address to three songs in ten minutes, and the instance to its own cap", async () => {
    stub([GOOD]);
    const same = { "CF-Connecting-IP": "10.9.9.9" };
    for (let i = 0; i < 3; i++) expect((await handleThemeSong(post({ description: "a car" }, same), ENV)).status).toBe(200);
    expect((await handleThemeSong(post({ description: "a car" }, same), ENV)).status).toBe(429);
    resetThemeSongLimits();
    const capped = { ...ENV, THEME_SONG_MAX_STARTS: "2" };
    expect((await handleThemeSong(post({ description: "a car" }), capped)).status).toBe(200);
    expect((await handleThemeSong(post({ description: "a car" }), capped)).status).toBe(200);
    expect((await handleThemeSong(post({ description: "a car" }), capped)).status).toBe(429);
  });
  it("a level win is written about the ADVENTURE: the prompt says a level was finished, and anything but 'level' is a build", async () => {
    const level = themePrompt("fixed the bridge", "level");
    expect(level).toMatch(/finished a level in a toy game/);
    expect(level).toMatch(/The child finished: "fixed the bridge"/);
    expect(level).toMatch(/ABOUT the adventure/);
    expect(themePrompt("fixed the bridge")).toMatch(/just made something/);
    stub([GOOD]);
    const f = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>);
    await handleThemeSong(post({ description: "fixed the bridge", kind: "level" }), ENV);
    expect(JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string).input).toMatch(/finished a level/);
    resetThemeSongLimits();
    stub([GOOD]);
    await handleThemeSong(post({ description: "a robot", kind: "<script>" }), ENV);
    expect(JSON.parse(((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit).body as string).input).toMatch(/just made something/);
  });
  it("an idea from the Songs sheet ('prompt') is written ABOUT the idea, and its words are screened before any model sees them", async () => {
    const p = themePrompt("a sleepy cat", "prompt");
    expect(p).toMatch(/asked for a song about an idea/);
    expect(p).toMatch(/The child asked for a song about: "a sleepy cat"/);
    expect(p).toMatch(/ABOUT the idea/);
    const calls = stub([GOOD]);
    const ok = await handleThemeSong(post({ description: "a sleepy cat", kind: "prompt" }), ENV);
    expect(ok.status).toBe(200);
    expect(calls.text).toBe(1);
    resetThemeSongLimits();
    for (const bad of ["a gun that kills people", "call me on 07700 900123", "see www.example.com", "mail me@x.com"]) {
      const c = stub([GOOD]);
      const res = await handleThemeSong(post({ description: bad, kind: "prompt" }, fresh()), ENV);
      expect(res.status, bad).toBe(422);
      expect(await res.json()).toMatchObject({ reason: "idea_not_allowed" });
      expect(c.text, bad).toBe(0);      // no model was asked
      expect(c.order, bad).toHaveLength(0); // and nothing was spent
    }
  });
  it("what a child typed in Describe & build (kind 'build', the default) is screened the same way, before any model sees it", async () => {
    for (const body of [{ description: "a gun that kills people" }, { description: "a car, mail me@x.com", kind: "build" }, { description: "see www.example.com", kind: "build" }]) {
      const c = stub([GOOD]);
      const res = await handleThemeSong(post(body, fresh()), ENV);
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect(await res.json()).toMatchObject({ reason: "idea_not_allowed" });
      expect(c.text).toBe(0);
      expect(c.order).toHaveLength(0);
    }
    stub([GOOD]);
    expect((await handleThemeSong(post({ description: "a race car", kind: "build" }, fresh()), ENV)).status).toBe(200);
  });
  it("the level sentence is not screened (it is ours, not the child's)", async () => {
    stub([GOOD]);
    expect((await handleThemeSong(post({ description: "I finished a game level with my toy.", kind: "level" }), ENV)).status).toBe(200);
  });
  it("the prompt carries the safety rules, the closed card lists and the scrubbed words", () => {
    const p = themePrompt('a "car" mail me@x.com');
    expect(p).toMatch(/Keep it kind and safe/);
    expect(p).toMatch(/bouncy, sleepy, silly, space, kitchen, cleanup/);
    expect(p).toMatch(/\[email removed\]/);
    expect(p).not.toContain('"car"');
  });
});

describe("GET ?id: where is the song", () => {
  it("says making while it runs, ready with the link, and failed when it fails", async () => {
    stub([GOOD], { queryAs: { status: "running" } });
    expect(await (await handleThemeSong(get("?id=123456789"), ENV)).json()).toEqual({ status: "making" });
    stub([GOOD], { queryAs: { status: "succeeded", choices: [{ url: "https://cdn.mureka.example/a.mp3", duration: 61000 }] } });
    expect(await (await handleThemeSong(get("?id=123456789"), ENV)).json()).toEqual({ status: "ready", url: "https://cdn.mureka.example/a.mp3", durationMs: 61000 });
    stub([GOOD], { queryAs: { status: "failed" } });
    expect(await (await handleThemeSong(get("?id=123456789"), ENV)).json()).toEqual({ status: "failed" });
  });
  it("never passes on a link that is not https, or not on the provider's own file host", async () => {
    stub([GOOD], { queryAs: { status: "succeeded", choices: [{ url: "https://evil.example/a.mp3" }] } });
    expect(await (await handleThemeSong(get("?id=123456789"), ENV)).json()).toEqual({ status: "failed" });
    stub([GOOD], { queryAs: { status: "succeeded", choices: [{ url: "https://cdn.mureka.ai.evil.example/a.mp3" }] } });
    expect(await (await handleThemeSong(get("?id=123456789"), ENV)).json()).toEqual({ status: "failed" });
    stub([GOOD], { queryAs: { status: "succeeded", choices: [{ url: "https://cdn.mureka.ai/a.mp3" }] } });
    expect((await (await handleThemeSong(get("?id=123456789"), ENV)).json() as { status: string }).status).toBe("ready");
    stub([GOOD], { queryAs: { status: "succeeded", choices: [{ url: "javascript:alert(1)" }] } });
    expect(await (await handleThemeSong(get("?id=123456789"), ENV)).json()).toEqual({ status: "failed" });
    stub([GOOD], { queryAs: { status: "succeeded", choices: [{ url: "http://insecure.example/a.mp3" }] } });
    expect(await (await handleThemeSong(get("?id=123456789"), ENV)).json()).toEqual({ status: "failed" });
  });
  it("accepts only a numeric song id, so a path cannot be built from it", async () => {
    const calls = stub([GOOD]);
    for (const id of ["abc", "../account/billing", "123", "123456789/../x"]) expect((await handleThemeSong(get(`?id=${encodeURIComponent(id)}`), ENV)).status).toBe(400);
    expect(calls.query).toHaveLength(0);
  });
});

describe("GET ?id&audio=1: the song's bytes, relayed because the provider's file host sends no CORS headers", () => {
  const READY = { status: "succeeded", choices: [{ url: "https://cdn.mureka.example/a.mp3", duration: 49000 }] };
  it("returns the bytes as audio, same-origin, once the song is ready", async () => {
    const calls = stub([GOOD], { queryAs: READY });
    const res = await handleThemeSong(get("?id=123456789&audio=1"), ENV);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([1, 2, 3, 4]);
    expect(calls.audio).toEqual(["https://cdn.mureka.example/a.mp3"]);
  });
  it("is 404 while the song is still being made and fetches nothing", async () => {
    const calls = stub([GOOD], { queryAs: { status: "running" } });
    const res = await handleThemeSong(get("?id=123456789&audio=1"), ENV);
    expect(res.status).toBe(404);
    expect(calls.audio).toHaveLength(0);
  });
  it("relays only the provider's own host: a link anywhere else is refused before any fetch", async () => {
    const calls = stub([GOOD], { queryAs: { status: "succeeded", choices: [{ url: "https://internal.example/secret" }] } });
    expect((await handleThemeSong(get("?id=123456789&audio=1"), ENV)).status).toBe(404);
    expect(calls.audio).toHaveLength(0);
  });
  it("refuses a non-numeric id, a file that is the wrong size, and a file host that fails", async () => {
    const calls = stub([GOOD], { queryAs: READY });
    expect((await handleThemeSong(get("?id=../x&audio=1"), ENV)).status).toBe(400);
    expect(calls.query).toHaveLength(0);
    stub([GOOD], { queryAs: READY, audioAs: () => new Response(new Uint8Array(8_000_001), { status: 200 }) });
    expect((await handleThemeSong(get("?id=123456789&audio=1"), ENV)).status).toBe(502);
    stub([GOOD], { queryAs: READY, audioAs: () => new Response(new Uint8Array(0), { status: 200 }) });
    expect((await handleThemeSong(get("?id=123456789&audio=1"), ENV)).status).toBe(502);
    stub([GOOD], { queryAs: READY, audioAs: () => new Response("nope", { status: 403 }) });
    expect((await handleThemeSong(get("?id=123456789&audio=1"), ENV)).status).toBe(502);
  });
  it("is off with everything else when theme songs are off", async () => {
    stub([GOOD], { queryAs: READY });
    expect((await handleThemeSong(get("?id=123456789&audio=1"), { ...ENV, THEME_SONG: "off" })).status).toBe(503);
  });
});
