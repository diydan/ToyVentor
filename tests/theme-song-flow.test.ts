import { describe, expect, it } from "vitest";
import { createThemeSongFlow, keepSong, levelDescription, readKeptSongs, type FlowState } from "../src/features/game/world/themeSongFlow";
import { analyseTheme } from "../shared/themeParty";

// A synthetic song the beat analyzer can read: a kick on every beat (louder on the 1) and a loud unsteady burst in its last 5 s, like the provider's watermark.
function song(bpm = 106, seconds = 50, sr = 22050): Float32Array[] {
  const n = Math.round(seconds * sr), x = new Float32Array(n), iv = 60 / bpm;
  let seed = 7;
  for (let k = 0; 0.54 + k * iv < seconds - 5; k++) {
    const t0 = Math.round((0.54 + k * iv) * sr), amp = k % 4 === 0 ? 0.9 : 0.5;
    for (let i = 0; i < 0.12 * sr && t0 + i < n; i++) x[t0 + i]! += amp * Math.sin((2 * Math.PI * (70 + 40 * Math.exp(-i / (0.02 * sr))) * i) / sr) * Math.exp(-i / (0.04 * sr));
    const h0 = Math.round((0.54 + k * iv + iv / 2) * sr);
    for (let i = 0; i < 0.02 * sr && h0 + i < n; i++) x[h0 + i]! += 0.15 * Math.sin(i * 1.9) * Math.exp(-i / (0.005 * sr));
  }
  for (let i = Math.round((seconds - 5) * sr); i < n; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; x[i]! += 0.5 * ((seed / 0x7fffffff) * 2 - 1); }
  return [x];
}

const TASK = "170010186285057";
const NAMED = { contract: 1, name: "Brave Bridge Builder", mood: "bouncy", tempo: "medium", instruments: ["drums"], ai: true, task: TASK,
  verse: ["Planks go down one by one", "Over the river we run", "Hammer tap and bolt turn", "Look at the bridge we built"], chorus: ["Brave Bridge Builder, hooray", "We built it all today", "Brave Bridge Builder, hooray", "Cross it and play"] };

interface Setup { calls: Array<{ url: string; method: string; body?: string }>; states: FlowState[]; parties: Array<{ entry: any; wav: ArrayBuffer; title: string }>; stored: Map<string, string>; flow: ReturnType<typeof createThemeSongFlow> }
function setup(opts: { enabled?: boolean; post?: { status: number; body: unknown }; polls?: unknown[]; audioStatus?: number; decode?: () => Promise<{ channels: ArrayLike<number>[]; sampleRate: number }>; party?: { ok: boolean; dancing?: boolean; reason?: string }; probeThrows?: boolean; pauseParty?: () => boolean; resumeParty?: () => boolean } = {}): Setup {
  const calls: Setup["calls"] = [], states: FlowState[] = [], parties: Setup["parties"] = [], stored = new Map<string, string>();
  const polls = [...(opts.polls ?? [{ status: "making" }, { status: "ready", url: "https://cdn.mureka.ai/a.mp3", durationMs: 49000 }])];
  const fetchImpl = (async (input: string, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", ...(init?.body ? { body: String(init.body) } : {}) });
    const j = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url === "/api/theme-song" && !init?.method) { if (opts.probeThrows) throw new Error("offline"); return opts.enabled === false ? j(503, { error: "off" }) : j(200, { ok: true, enabled: true }); }
    if (url === "/api/theme-song" && init?.method === "POST") { const p = opts.post ?? { status: 200, body: NAMED }; return j(p.status, p.body); }
    if (url.includes("&audio=1")) return opts.audioStatus && opts.audioStatus !== 200 ? new Response("no", { status: opts.audioStatus }) : new Response(new ArrayBuffer(1000), { status: 200 });
    return j(200, polls.length > 1 ? polls.shift() : polls[0]);
  }) as unknown as typeof fetch;
  const flow = createThemeSongFlow({
    fetchImpl, pollMs: 0, setTimeout: (fn) => { queueMicrotask(fn); return 1; }, clearTimeout: () => {}, now: () => 1_000,
    decode: opts.decode ?? (async () => ({ channels: song(), sampleRate: 22050 })),
    startParty: async (s) => { parties.push(s as never); return opts.party ?? { ok: true, dancing: true }; },
    pauseParty: opts.pauseParty, resumeParty: opts.resumeParty,
    onState: (s) => states.push({ ...s }),
    storage: { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => { stored.set(k, v); } },
  });
  return { calls, states, parties, stored, flow };
}
const until = async (f: () => boolean, ms = 3000) => { const end = Date.now() + ms; while (!f()) { if (Date.now() > end) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 2)); } };

describe("what a child did, in words for the song writer", () => {
  it("names the mission by its kind and sends nothing else, never longer than the route allows", () => {
    expect(levelDescription("clean")).toBe("I finished cleaning up a messy table with my toy.");
    expect(levelDescription("bridge")).toMatch(/bridge/);
    expect(levelDescription("something-new")).toBe("I finished a game level with my toy.");
    expect(levelDescription("x".repeat(500)).length).toBeLessThanOrEqual(300);
  });
});

describe("the end-of-level song flow", () => {
  it("is quiet when the route is off: no card, nothing spent, and it asks only once", async () => {
    const s = setup({ enabled: false });
    expect(await s.flow.isOn()).toBe(false);
    expect(await s.flow.start("I finished a bridge")).toBe(false);
    expect(await s.flow.start("I finished a bridge")).toBe(false);
    expect(s.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    expect(s.calls.filter((c) => c.method === "GET")).toHaveLength(1);
    expect(s.flow.state().phase).toBe("idle");
    await expect(setup({ probeThrows: true }).flow.isOn()).resolves.toBe(false);
  });
  it("sends the description and the level kind and nothing else", async () => {
    const s = setup();
    await s.flow.start("I finished building a bridge with my toy.", "level");
    const post = s.calls.find((c) => c.method === "POST")!;
    expect(JSON.parse(post.body!)).toEqual({ description: "I finished building a bridge with my toy.", kind: "level", key: expect.stringMatching(/^[A-Za-z0-9_-]{8,64}$/) });
  });
  it("goes writing, then making with the name and the words on screen, then ready, then dancing", async () => {
    const s = setup();
    expect(await s.flow.start("I finished building a bridge with my toy.")).toBe(true);
    await until(() => s.flow.state().phase === "dancing");
    const phases = s.states.map((x) => x.phase);
    expect(phases.indexOf("writing")).toBeLessThan(phases.indexOf("making"));
    expect(phases.indexOf("making")).toBeLessThan(phases.indexOf("ready"));
    expect(phases.indexOf("ready")).toBeLessThan(phases.indexOf("dancing"));
    const making = s.states.find((x) => x.phase === "making")!;
    expect(making).toMatchObject({ name: "Brave Bridge Builder" });
    expect(making.verse).toEqual(NAMED.verse);
    expect(making.note).toMatch(/about a minute/);
  });
  it("hands the party a checked library-shaped entry and a WAV cut, with the watermark's five seconds left off", async () => {
    const s = setup();
    await s.flow.start("I finished a bridge");
    await until(() => s.parties.length === 1);
    const p = s.parties[0]!;
    expect(p.title).toBe("Brave Bridge Builder");
    expect(p.entry).toMatchObject({ id: `my_${TASK}`, title: "Brave Bridge Builder", mood: "bouncy", ai: true });
    expect(p.entry.dur).toBeLessThanOrEqual(50 - 5 + 0.2);
    expect(Math.abs(p.entry.bpm - 106)).toBeLessThan(1);
    expect(new TextDecoder().decode(new Uint8Array(p.wav.slice(0, 4)))).toBe("RIFF");
  });
  it("polls only until the song is ready, then stops", async () => {
    const s = setup();
    await s.flow.start("I finished a bridge");
    await until(() => s.flow.state().phase === "dancing");
    const n = s.calls.filter((c) => c.url.includes("?id=") && !c.url.includes("audio")).length;
    await new Promise((r) => setTimeout(r, 30));
    expect(s.calls.filter((c) => c.url.includes("?id=") && !c.url.includes("audio")).length).toBe(n);
    expect(n).toBe(2);
  });
  it("keeps the song in this browser's list, with its words, in the shape the Kip bench reads", async () => {
    const s = setup();
    await s.flow.start("I finished a bridge");
    await until(() => s.flow.state().phase === "dancing");
    const kept = JSON.parse(s.stored.get("tv.themeSongs.v1")!);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ name: "Brave Bridge Builder", task: TASK, url: "https://cdn.mureka.ai/a.mp3" });
    expect(kept[0].verse).toEqual(NAMED.verse);
  });
  it("a song with no steady beat is not a dead end: the card gets a link to play it plainly", async () => {
    const s = setup({ decode: async () => ({ channels: [new Float32Array(22050 * 5)], sampleRate: 22050 }) });
    await s.flow.start("I finished a bridge");
    await until(() => s.flow.state().fallbackUrl !== "");
    expect(s.flow.state()).toMatchObject({ phase: "ready", fallbackUrl: "https://cdn.mureka.ai/a.mp3" });
    expect(s.parties).toHaveLength(0);
  });
  it("an audio file that cannot be fetched or decoded also leaves a link, and the party never starts", async () => {
    const a = setup({ audioStatus: 404 });
    await a.flow.start("I finished a bridge");
    await until(() => a.flow.state().fallbackUrl !== "");
    expect(a.parties).toHaveLength(0);
    const b = setup({ decode: async () => { throw new Error("EncodingError"); } });
    await b.flow.start("I finished a bridge");
    await until(() => b.flow.state().fallbackUrl !== "");
    expect(b.parties).toHaveLength(0);
  });
  it("says so kindly when the party could not start, and keeps the link out of it", async () => {
    const s = setup({ party: { ok: false, reason: "no audio yet" } });
    await s.flow.start("I finished a bridge");
    await until(() => s.parties.length === 1);
    await until(() => /could not start/.test(s.flow.state().note));
    expect(s.flow.state().phase).toBe("ready");
  });
  it("a failed song keeps the name and the words and says so kindly", async () => {
    const s = setup({ polls: [{ status: "failed" }] });
    await s.flow.start("I finished a bridge");
    await until(() => s.flow.state().phase === "failed");
    expect(s.flow.state()).toMatchObject({ name: "Brave Bridge Builder", note: expect.stringMatching(/still yours/) });
    expect(s.parties).toHaveLength(0);
  });
  it("a song that could not be ordered, or a refused request, never polls", async () => {
    const a = setup({ post: { status: 200, body: { ...NAMED, task: null, songError: "The song studio could not start this one." } } });
    expect(await a.flow.start("I finished a bridge")).toBe(true);
    expect(a.flow.state()).toMatchObject({ phase: "failed", name: "Brave Bridge Builder" });
    expect(a.calls.filter((c) => c.url.includes("?id="))).toHaveLength(0);
    const b = setup({ post: { status: 502, body: { error: "no song this time" } } });
    expect(await b.flow.start("I finished a bridge")).toBe(false);
    expect(b.flow.state().phase).toBe("failed");
    expect(b.flow.state().name).toBe("");
  });
  it("shows only the route's own kind sentence for a refused idea, never another error text it sends", async () => {
    const s = setup({ post: { status: 502, body: { error: "SECRET internal detail", reason: "verse_unsafe" } } });
    await s.flow.start("a cat", "prompt");
    expect(s.flow.state().note).toBe("No song this time. Try again later!");
  });
  it("gives up kindly when the song takes too long", async () => {
    let t = 0;
    const s = setup({ polls: [{ status: "making" }] });
    const flow = createThemeSongFlow({
      fetchImpl: (async (u: string, i?: RequestInit) => (String(u) === "/api/theme-song" && !i?.method ? new Response(JSON.stringify({ enabled: true })) : String(u) === "/api/theme-song" ? new Response(JSON.stringify(NAMED)) : new Response(JSON.stringify({ status: "making" })))) as unknown as typeof fetch,
      pollMs: 0, maxWaitMs: 1000, setTimeout: (fn) => { queueMicrotask(fn); return 1; }, clearTimeout: () => {}, now: () => (t += 400),
      decode: async () => ({ channels: [], sampleRate: 1 }), startParty: async () => ({ ok: true }), onState: () => {},
    });
    await flow.start("I finished a bridge");
    await until(() => flow.state().phase === "failed");
    expect(flow.state().note).toMatch(/too long/);
    void s;
  });
  it("tells the card when the party ends, and can dance again to the same cut without asking for anything", async () => {
    const s = setup();
    await s.flow.start("I finished a bridge");
    await until(() => s.flow.state().phase === "dancing");
    s.flow.partyEnded("stopped");
    expect(s.flow.state()).toMatchObject({ phase: "over", note: "Party's over!" });
    const callsBefore = s.calls.length;
    expect(await s.flow.again()).toBe(true);
    expect(s.flow.state().phase).toBe("dancing");
    expect(s.calls.length).toBe(callsBefore);
    expect(s.parties).toHaveLength(2);
    expect(s.parties[1]!.wav).toBe(s.parties[0]!.wav);
    s.flow.partyEnded("time");
    expect(s.flow.state().note).toMatch(/great party/);
  });
  it("a new level replaces the old song: an answer from the old one cannot land on the new card", async () => {
    const s = setup({ polls: [{ status: "making" }] });
    await s.flow.start("I finished a bridge");
    const second = s.flow.start("I finished cleaning");
    await second;
    expect(s.flow.state().phase).toBe("making");
    s.flow.cancel();
    expect(s.flow.state().phase).toBe("idle");
    expect(s.parties).toHaveLength(0);
  });
});

describe("an idea from the Songs sheet", () => {
  it("is sent as kind 'prompt' with the idea and nothing else, then follows the same steps", async () => {
    const s = setup();
    await s.flow.start("a sleepy cat", "prompt");
    expect(JSON.parse(s.calls.find((c) => c.method === "POST")!.body!)).toEqual({ description: "a sleepy cat", kind: "prompt", key: expect.stringMatching(/^[A-Za-z0-9_-]{8,64}$/) });
    await until(() => s.flow.state().phase === "dancing");
    expect(s.parties[0]!.title).toBe("Brave Bridge Builder");
  });
  it("a refused idea (the route said no) is a kind failure with no name and no polling", async () => {
    const s = setup({ post: { status: 422, body: { error: "Let's pick a different idea!", reason: "idea_not_allowed" } } });
    expect(await s.flow.start("a gun", "prompt")).toBe(false);
    expect(s.flow.state().phase).toBe("failed");
    expect(s.flow.state().note).toBe("Let's pick a different idea!");
    expect(s.calls.filter((c) => c.url.includes("?id="))).toHaveLength(0);
  });
});

describe("dancing to a kept song", () => {
  const KEPT = { name: "Old Favourite", verse: ["a b c", "d e f", "g h i"], chorus: ["Old Favourite, hey", "j k l", "m n o"], mood: "bouncy", url: "https://cdn.mureka.ai/old.mp3", task: "170010186285999", madeAt: "2026-11-03T00:00:00Z" };
  it("fetches the audio again through the relay, cuts it and starts the party, with no new song ordered and the list left as it was", async () => {
    const s = setup();
    keepSong({ getItem: (k) => s.stored.get(k) ?? null, setItem: (k, v) => { s.stored.set(k, v); } }, KEPT);
    const before = s.stored.get("tv.themeSongs.v1");
    expect(await s.flow.playKept(KEPT)).toBe(true);
    expect(s.flow.state()).toMatchObject({ phase: "dancing", name: "Old Favourite" });
    expect(s.calls.some((c) => c.method === "POST")).toBe(false);
    expect(s.calls.some((c) => c.url === `/api/theme-song?id=${KEPT.task}&audio=1`)).toBe(true);
    expect(s.parties[0]!.entry).toMatchObject({ id: `my_${KEPT.task}`, title: "Old Favourite", mood: "bouncy" });
    expect(s.stored.get("tv.themeSongs.v1")).toBe(before);
  });
  it("when the audio cannot be had the card still gets the song's own link to play", async () => {
    const s = setup({ audioStatus: 404 });
    expect(await s.flow.playKept(KEPT)).toBe(false);
    expect(s.flow.state()).toMatchObject({ phase: "ready", fallbackUrl: KEPT.url });
    expect(s.parties).toHaveLength(0);
  });
  it("refuses a task that is not a number, so a path cannot be built from it", async () => {
    const s = setup();
    expect(await s.flow.playKept({ ...KEPT, task: "../x" })).toBe(false);
    expect(s.calls).toHaveLength(0);
  });
  it("a new song replaces it: an answer from the old one cannot land on the new card", async () => {
    const s = setup();
    const first = s.flow.playKept(KEPT);
    await s.flow.start("a sleepy cat", "prompt");
    await first;
    await until(() => s.flow.state().phase === "dancing");
    expect(s.flow.state().name).toBe("Brave Bridge Builder");
  });
});

describe("readKeptSongs", () => {
  const store = (v: string | null) => ({ getItem: () => v, setItem: () => {} });
  it("reads the list the Kip bench also writes, newest first, and drops anything that is not a song with a numeric task", () => {
    const good = { name: "A", url: "https://x", task: "123456", verse: ["a"], chorus: ["b"], mood: "bouncy", madeAt: "" };
    const list = readKeptSongs(store(JSON.stringify([good, { ...good, task: "../x" }, { name: 3, url: "u", task: "123456" }, null, "x", { ...good, task: "654321", verse: "nope" }])));
    expect(list.map((x) => x.task)).toEqual(["123456", "654321"]);
    expect(list[1]!.verse).toEqual([]);
  });
  it("is empty for empty, damaged or blocked storage", () => {
    expect(readKeptSongs(store(null))).toEqual([]);
    expect(readKeptSongs(store("{not json"))).toEqual([]);
    expect(readKeptSongs(store('{"a":1}'))).toEqual([]);
    expect(readKeptSongs({ getItem: () => { throw new Error("blocked"); }, setItem: () => {} })).toEqual([]);
    expect(readKeptSongs(undefined)).toEqual([]);
  });
});

describe("keepSong", () => {
  it("keeps the newest twenty, newest first, one per task, and survives blocked or damaged storage", () => {
    const m = new Map<string, string>();
    const storage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
    for (let i = 0; i < 25; i++) keepSong(storage, { name: `S${i}`, verse: [], chorus: [], mood: "", url: "https://x", task: String(i), madeAt: "" });
    keepSong(storage, { name: "again", verse: [], chorus: [], mood: "", url: "https://x", task: "24", madeAt: "" });
    const list = JSON.parse(m.get("tv.themeSongs.v1")!);
    expect(list).toHaveLength(20);
    expect(list[0].name).toBe("again");
    expect(list.filter((x: { task: string }) => x.task === "24")).toHaveLength(1);
    expect(() => keepSong({ getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } }, { name: "x", verse: [], chorus: [], mood: "", url: "u", task: "1", madeAt: "" })).not.toThrow();
    m.set("tv.themeSongs.v1", "{not json");
    keepSong(storage, { name: "fresh", verse: [], chorus: [], mood: "", url: "u", task: "9", madeAt: "" });
    expect(JSON.parse(m.get("tv.themeSongs.v1")!)).toHaveLength(1);
  });
});

// ---- the device, the weekly quota and the route's kind sentences ----------------------------------------------------------------------------------
describe("songs left this week", () => {
  const QUOTA = { limit: 5, used: 2, left: 3, resetsOn: "2026-11-09", makerOn: true };
  function quotaSetup(over: { probe?: unknown; post?: { status: number; body: unknown } } = {}) {
    const seen: Array<{ url: string; method: string; headers: Record<string, string>; body?: string }> = [];
    const fetchImpl = (async (input: string, init?: RequestInit) => {
      const url = String(input);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      seen.push({ url, method: init?.method ?? "GET", headers, ...(init?.body ? { body: String(init.body) } : {}) });
      const j = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
      if (url === "/api/theme-song" && init?.method === "POST") { const p = over.post ?? { status: 200, body: { ...NAMED, quota: { ...QUOTA, used: 3, left: 2 } } }; return j(p.status, p.body); }
      if (url === "/api/theme-song") return j(200, over.probe ?? { ok: true, enabled: true, quota: QUOTA });
      return j(200, { status: "making" });
    }) as unknown as typeof fetch;
    const states: FlowState[] = [];
    const flow = createThemeSongFlow({ fetchImpl, pollMs: 60_000, setTimeout: () => 1, clearTimeout: () => {}, now: () => 1000, headers: () => ({ "x-device-id": "dev-1234567890", "x-client-timezone": "Europe/London" }), newKey: () => "tap-key-0001-aaaa",
      decode: async () => ({ channels: [], sampleRate: 1 }), startParty: async () => ({ ok: true }), onState: (s) => states.push({ ...s }) });
    return { flow, seen, states };
  }
  it("reads the quota from the free probe, and sends the device and the time zone on it", async () => {
    const s = quotaSetup();
    expect(await s.flow.probe()).toEqual({ enabled: true, quota: QUOTA });
    expect(s.seen[0]).toMatchObject({ url: "/api/theme-song", method: "GET", headers: { "x-device-id": "dev-1234567890", "x-client-timezone": "Europe/London" } });
  });
  it("remembers the probe, and asks again only when told to", async () => {
    const s = quotaSetup();
    await s.flow.probe(); await s.flow.probe(); await s.flow.isOn();
    expect(s.seen).toHaveLength(1);
    await s.flow.probe(true);
    expect(s.seen).toHaveLength(2);
  });
  it("is worth offering only when the route is on, a grown-up has not switched songs off, and a song is left (it asks fresh each time)", async () => {
    expect(await quotaSetup().flow.canMake()).toBe(true);
    expect(await quotaSetup({ probe: { ok: true, enabled: true, quota: { ...QUOTA, left: 0, used: 5 } } }).flow.canMake()).toBe(false);
    expect(await quotaSetup({ probe: { ok: true, enabled: true, quota: { ...QUOTA, makerOn: false } } }).flow.canMake()).toBe(false);
    expect(await quotaSetup({ probe: { ok: true, enabled: false } }).flow.canMake()).toBe(false);
    expect(await quotaSetup({ probe: { ok: true, enabled: true } }).flow.canMake()).toBe(true); // an unmetered route says nothing about a quota: offer
    const s = quotaSetup(); await s.flow.canMake(); await s.flow.canMake();
    expect(s.seen).toHaveLength(2);
  });
  it("a malformed quota is ignored rather than trusted", async () => {
    for (const bad of [{ limit: "5", used: 0, left: 5, resetsOn: "x", makerOn: true }, { limit: 5, used: 0, left: 5, makerOn: true }, null, "x", [1]]) {
      expect((await quotaSetup({ probe: { ok: true, enabled: true, quota: bad } }).flow.probe()).quota, JSON.stringify(bad)).toBeNull();
    }
  });
  it("makes a song with the device, one key per tap, and keeps the quota the route answered with", async () => {
    const s = quotaSetup();
    await s.flow.start("a sleepy cat", "prompt");
    const post = s.seen.find((x) => x.method === "POST")!;
    expect(post.headers).toMatchObject({ "x-device-id": "dev-1234567890", "content-type": "application/json" });
    expect(JSON.parse(post.body!)).toEqual({ description: "a sleepy cat", kind: "prompt", key: "tap-key-0001-aaaa" });
    expect(s.flow.state().quota).toMatchObject({ left: 2, used: 3 });
  });
  it("shows the route's own sentence when the week is used up, and the quota it sent", async () => {
    const s = quotaSetup({ post: { status: 429, body: { error: "No new songs until Monday. Dance to the ones you made!", reason: "week_used", quota: { ...QUOTA, used: 5, left: 0 } } } });
    expect(await s.flow.start("a sleepy cat", "prompt")).toBe(false);
    expect(s.flow.state()).toMatchObject({ phase: "failed", note: "No new songs until Monday. Dance to the ones you made!", quota: { left: 0 } });
    expect((await s.flow.probe()).quota?.left).toBe(0);
  });
  it("shows kind sentences for songs-switched-off and the resting studio, but never any other error text", async () => {
    for (const [reason, error] of [["songs_off", "Songs are switched off by a grown-up."], ["budget_spent", "The song studio is resting this month."]]) {
      const s = quotaSetup({ post: { status: 403, body: { error, reason } } });
      await s.flow.start("a cat", "prompt");
      expect(s.flow.state().note).toBe(error);
    }
    const leak = quotaSetup({ post: { status: 500, body: { error: "SQLITE_ERROR: no such table", reason: "quota_unavailable" } } });
    await leak.flow.start("a cat", "prompt");
    expect(leak.flow.state().note).toBe("No song this time. Try again later!");
    const leak2 = quotaSetup({ post: { status: 429, body: { error: "x".repeat(500), reason: "week_used" } } });
    await leak2.flow.start("a cat", "prompt");
    expect(leak2.flow.state().note.length).toBeLessThanOrEqual(80);
  });
  it("polling and the audio relay carry the device too, so the route can tell whose song it is", async () => {
    const s = quotaSetup();
    await s.flow.start("a cat", "prompt");
    await until(() => s.seen.some((x) => x.url.includes("?id=")), 1000).catch(() => {});
    for (const x of s.seen.filter((y) => y.url.includes("?id="))) expect(x.headers["x-device-id"]).toBe("dev-1234567890");
  });
});

describe("waking our own model", () => {
  function warmSetup(over: { enabled?: boolean; warmThrows?: boolean } = {}) {
    const seen: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
    let t = 1000;
    const fetchImpl = (async (input: string, init?: RequestInit) => {
      const url = String(input);
      seen.push({ url, method: init?.method ?? "GET", headers: (init?.headers ?? {}) as Record<string, string> });
      if (url.endsWith("/warm")) { if (over.warmThrows) throw new Error("offline"); return new Response(JSON.stringify({ ok: true }), { status: 202 }); }
      return new Response(JSON.stringify({ ok: true, enabled: over.enabled !== false }), { status: over.enabled === false ? 503 : 200 });
    }) as unknown as typeof fetch;
    const flow = createThemeSongFlow({ fetchImpl, pollMs: 60_000, setTimeout: () => 1, clearTimeout: () => {}, now: () => t, headers: () => ({ "x-device-id": "dev-1234567890" }),
      decode: async () => ({ channels: [], sampleRate: 1 }), startParty: async () => ({ ok: true }), onState: () => {} });
    return { flow, seen, advance: (ms: number) => { t += ms; }, warms: () => seen.filter((x) => x.url.endsWith("/warm")) };
  }
  it("posts to /warm with the device, once the route is known to be on", async () => {
    const s = warmSetup();
    await s.flow.warm();
    expect(s.warms()).toHaveLength(1);
    expect(s.warms()[0]).toMatchObject({ url: "/api/theme-song/warm", method: "POST", headers: { "x-device-id": "dev-1234567890" } });
  });
  it("asks at most once every three minutes, and again after that", async () => {
    const s = warmSetup();
    await s.flow.warm(); await s.flow.warm(); await s.flow.warm();
    expect(s.warms()).toHaveLength(1);
    s.advance(2 * 60_000); await s.flow.warm();
    expect(s.warms()).toHaveLength(1);
    s.advance(61_000); await s.flow.warm();
    expect(s.warms()).toHaveLength(2);
  });
  it("does nothing at all when the route is off, and never throws when the warm-up itself fails", async () => {
    const off = warmSetup({ enabled: false });
    await off.flow.warm();
    expect(off.warms()).toHaveLength(0);
    const bad = warmSetup({ warmThrows: true });
    await expect(bad.flow.warm()).resolves.toBeUndefined();
  });
});

describe("the mini karaoke's times", () => {
  const plan = analyseTheme(song(), 22050);
  if (!plan.ok) throw new Error("the synthetic song must be cuttable");
  const at = (cutSeconds: number) => Math.round((plan.cut.startSec + cutSeconds) * 1000);
  const LINES = [
    { s: at(3), e: at(5), t: "hello little cat", w: [at(3), at(3.6), at(4.2)] },
    { s: at(plan.cut.lengthSec + 5), e: at(plan.cut.lengthSec + 7), t: "after the end" }, // never heard: the cut is over
  ];
  it("moves the provider's lines onto the cut the party loops, leaves out what is not in it, and tells the card the loop's length", async () => {
    const s = setup({ polls: [{ status: "ready", url: "https://cdn.mureka.ai/a.mp3", lines: LINES }] });
    await s.flow.start("I finished a bridge");
    await until(() => s.flow.state().phase === "dancing");
    const st = s.flow.state();
    expect(st.loop).toBeCloseTo(plan.cut.lengthSec, 6);
    expect(st.karaoke).toHaveLength(1);
    expect(st.karaoke[0]!.text).toBe("hello little cat");
    expect(st.karaoke[0]!.at).toBeCloseTo(3, 2);
    expect(st.karaoke[0]!.words.map((w) => w.at.toFixed(1))).toEqual(["3.0", "3.6", "4.2"]);
  });
  it("is honest when there are no times: no karaoke at all, never a guess, and the party still goes ahead", async () => {
    const s = setup();
    await s.flow.start("I finished a bridge");
    await until(() => s.flow.state().phase === "dancing");
    expect(s.flow.state().karaoke).toEqual([]);
  });
  it("junk in the times is dropped, not trusted", async () => {
    const s = setup({ polls: [{ status: "ready", url: "https://cdn.mureka.ai/a.mp3", lines: [{ s: "x", e: 5, t: "bad" }, null, 4, { s: at(3), e: at(4), t: "ok" }] }] });
    await s.flow.start("I finished a bridge");
    await until(() => s.flow.state().phase === "dancing");
    expect(s.flow.state().karaoke.map((l) => l.text)).toEqual(["ok"]);
  });
  it("keeps the times with the song, so a song danced to again later still has its karaoke without asking", async () => {
    const s = setup({ polls: [{ status: "ready", url: "https://cdn.mureka.ai/a.mp3", lines: LINES }] });
    await s.flow.start("I finished a bridge");
    await until(() => s.flow.state().phase === "dancing");
    const kept = readKeptSongs({ getItem: (k) => s.stored.get(k) ?? null, setItem: () => {} });
    expect(kept[0]!.lines).toHaveLength(2);
    const again = setup();
    const before = again.calls.length;
    await again.flow.playKept(kept[0]!);
    expect(again.flow.state().karaoke.map((l) => l.text)).toEqual(["hello little cat"]);
    expect(again.calls.slice(before).some((c) => c.url === `/api/theme-song?id=${TASK}` )).toBe(false); // no status call: it had them
  });
  it("asks the route once for the times of a song kept before they were saved, and goes ahead without them if it cannot", async () => {
    const OLD = { name: "Old", verse: ["a"], chorus: ["b"], mood: "bouncy", url: "https://cdn.mureka.ai/old.mp3", task: "170010186285999", madeAt: "" };
    const s = setup({ polls: [{ status: "ready", url: OLD.url, lines: LINES }] });
    await s.flow.playKept(OLD);
    expect(s.calls.filter((c) => c.url === `/api/theme-song?id=${OLD.task}`)).toHaveLength(1);
    expect(s.flow.state().karaoke).toHaveLength(1);
    const none = setup({ polls: [{ status: "making" }] });
    expect(await none.flow.playKept(OLD)).toBe(true);
    expect(none.flow.state().karaoke).toEqual([]);
  });
  it("a kept song's times are read back cleaned: junk is dropped and a song without any has no field", () => {
    const store = (v: unknown) => ({ getItem: () => JSON.stringify(v), setItem: () => {} });
    const good = { name: "A", url: "https://x", task: "123456", verse: [], chorus: [], mood: "", madeAt: "" };
    const [a, b] = readKeptSongs(store([{ ...good, lines: [{ s: 1, e: 2, t: "ok" }, { s: 9, e: 1, t: "bad" }] }, { ...good, task: "654321", lines: "nope" }]));
    expect(a!.lines).toEqual([{ s: 1, e: 2, t: "ok" }]);
    expect(b!.lines).toBeUndefined();
  });
});

describe("pause, play and new words", () => {
  it("pauses and plays the party, only while it is on, and the card's line goes back", async () => {
    const calls: string[] = [];
    const s = setup({ pauseParty: () => { calls.push("pause"); return true; }, resumeParty: () => { calls.push("resume"); return true; } });
    expect(s.flow.pause()).toBe(false); // nothing is dancing yet
    await s.flow.start("I finished a bridge");
    await until(() => s.flow.state().phase === "dancing");
    const note = s.flow.state().note;
    expect(s.flow.resume()).toBe(false); // not paused
    expect(s.flow.pause()).toBe(true);
    expect(s.flow.pause()).toBe(false); // already paused
    expect(s.flow.state()).toMatchObject({ phase: "dancing", paused: true });
    expect(s.flow.resume()).toBe(true);
    expect(s.flow.state()).toMatchObject({ paused: false, note });
    expect(calls).toEqual(["pause", "resume"]);
  });
  it("stays as it was when the party cannot be held, and a party that ends while paused is simply over", async () => {
    const stuck = setup({ pauseParty: () => false });
    await stuck.flow.start("I finished a bridge");
    await until(() => stuck.flow.state().phase === "dancing");
    expect(stuck.flow.pause()).toBe(false);
    expect(stuck.flow.state().paused).toBe(false);
    const s = setup({ pauseParty: () => true, resumeParty: () => true });
    await s.flow.start("I finished a bridge");
    await until(() => s.flow.state().phase === "dancing");
    s.flow.pause();
    s.flow.partyEnded("stopped");
    expect(s.flow.state()).toMatchObject({ phase: "over", paused: false });
    expect(s.flow.resume()).toBe(false);
  });
  it("dancing again after a party starts it playing, not paused", async () => {
    const s = setup({ pauseParty: () => true, resumeParty: () => true });
    await s.flow.start("I finished a bridge");
    await until(() => s.flow.state().phase === "dancing");
    s.flow.pause();
    s.flow.partyEnded("stopped");
    expect(await s.flow.again()).toBe(true);
    expect(s.flow.state()).toMatchObject({ phase: "dancing", paused: false });
  });
  it("new words asks for a fresh song about the same thing: a new key, the same description and kind, the old song let go", async () => {
    const s = setup();
    expect(await s.flow.redo()).toBe(false); // nothing was asked yet
    await s.flow.start("a sleepy cat", "prompt");
    await until(() => s.flow.state().phase === "dancing");
    expect(await s.flow.redo()).toBe(true);
    const posts = s.calls.filter((c) => c.method === "POST").map((c) => JSON.parse(c.body!));
    expect(posts).toHaveLength(2);
    expect(posts[1]).toMatchObject({ description: "a sleepy cat", kind: "prompt" });
    expect(posts[1].key).not.toBe(posts[0].key);
    await until(() => s.states.filter((x) => x.phase === "dancing").length >= 2);
    expect(s.flow.state().karaoke).toEqual([]); // the new song starts clean
  });
});
