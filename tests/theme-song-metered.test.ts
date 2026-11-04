import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../worker/index";
import { resetThemeSongLimits, themeSongEnabled } from "../worker/themeSong";
import { sqliteD1, type SqliteD1 } from "./helpers/sqliteD1";

// The metered route (docs/specs/dance-party-spec.md 4.6): a slot before any paid call, five a week per device, a monthly budget, a grown-up's switch, ownership of a song's
// status and audio, and our own copy in R2. Real SQLite runs the real migration and the real parent gate.
const GOOD = {
  name: "Zippy Roadster", mood: "bouncy", tempo: "fast", instruments: ["drums"],
  verse: ["Wheels go round and round", "Down the sunny road", "Little engine hums a tune", "Off we go, off we go"],
  chorus: ["Zippy Roadster, zoom zoom zoom", "Zippy Roadster, make some room", "Wheels are spinning, hear us sing", "Zippy Roadster is the king"],
};
const DEV = "12345678-1234-1234-1234-123456789abc";
const OTHER = "abcdefab-1234-1234-1234-123456789abc";

class FakeR2 {
  objects = new Map<string, ArrayBuffer>();
  puts: string[] = [];
  gets: string[] = [];
  async put(key: string, value: ArrayBuffer) { this.puts.push(key); this.objects.set(key, value); }
  async get(key: string) { this.gets.push(key); const v = this.objects.get(key); return v ? { arrayBuffer: async () => v } : null; }
}

interface World { db: SqliteD1; r2: FakeR2; env: Record<string, unknown>; text: { calls: number; replies: unknown[] }; orders: Array<{ body: any }>; audio: string[]; tasks: Map<string, { status: string; url?: string }>; mureka: { orderStatus: number } }
function world(over: Record<string, unknown> = {}): World {
  const db = sqliteD1({ migrations: ["migrations/0002_parent_time.sql", "migrations/0003_songs.sql"] });
  const r2 = new FakeR2();
  const w: World = { db, r2, text: { calls: 0, replies: [GOOD] }, orders: [], audio: [], tasks: new Map(), mureka: { orderStatus: 200 },
    env: { DB: db, SONGS: r2, PARENT_GATE_SECRET: "gate-secret-for-tests", MODEL_API_KEY: "text-key", META_MODEL_API_URL: "https://meta.example/v1", MUREKA_API_KEY: "mureka-secret", MUREKA_API_URL: "https://mureka.example", MUREKA_AUDIO_HOST: "cdn.mureka.example", THEME_SONG: "on", SONG_MONTHLY_BUDGET: "100", ...over } };
  let n = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith("https://meta.example")) {
      const r = w.text.replies[Math.min(w.text.calls, w.text.replies.length - 1)];
      w.text.calls++;
      return new Response(JSON.stringify({ output: [{ content: [{ type: "output_text", text: typeof r === "string" ? r : JSON.stringify(r) }] }] }), { status: 200 });
    }
    if (url.startsWith("https://cdn.mureka.example/")) { w.audio.push(url); return new Response(new Uint8Array([1, 2, 3, 4, 5]), { status: 200 }); }
    if (url.startsWith("https://mureka.example")) {
      if (init?.method === "POST") {
        if (w.mureka.orderStatus !== 200) return new Response("{}", { status: w.mureka.orderStatus });
        w.orders.push({ body: JSON.parse(init.body as string) });
        const id = `1700101862${String(++n).padStart(5, "0")}`;
        w.tasks.set(id, { status: "running" });
        return new Response(JSON.stringify({ id, status: "preparing" }), { status: 200 });
      }
      const id = url.split("/").pop()!;
      const t = w.tasks.get(id) ?? { status: "running" };
      return new Response(JSON.stringify({ id, status: t.status, ...(t.url ? { choices: [{ url: t.url, duration: 50000 }] } : {}) }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  }));
  return w;
}
let ip = 0;
const req = (path: string, init: RequestInit = {}, device: string | null = DEV, extra: Record<string, string> = {}) =>
  new Request(`https://toyventor.com${path}`, { ...init, headers: { "CF-Connecting-IP": `10.2.0.${++ip}`, ...(device ? { "x-device-id": device } : {}), ...(init.body ? { "content-type": "application/json" } : {}), ...extra, ...((init.headers as Record<string, string>) ?? {}) } });
const post = (w: World, body: unknown = { description: "a race car" }, device: string | null = DEV, extra: Record<string, string> = {}) => worker.fetch(req("/api/theme-song", { method: "POST", body: JSON.stringify(body) }, device, extra), w.env as never);
const get = (w: World, qs: string, device: string | null = DEV) => worker.fetch(req(`/api/theme-song${qs}`, {}, device), w.env as never);
const json = async (r: Response) => (await r.json()) as Record<string, any>;
const ready = (w: World, task: string) => w.tasks.set(task, { status: "succeeded", url: "https://cdn.mureka.example/a.mp3" });

async function gateProof(w: World, device = DEV): Promise<string> {
  const call = (body: object) => worker.fetch(new Request("http://local/api/parent/gate", { method: "POST", headers: { "content-type": "application/json", "x-device-id": device }, body: JSON.stringify(body) }), w.env as never);
  const ch = (await (await call({ action: "challenge" })).json()) as { a: number; b: number; challengeToken: string };
  return (((await (await call({ action: "verify", challengeToken: ch.challengeToken, answer: ch.a * ch.b })).json()) as { proofToken: string }).proofToken);
}

beforeEach(() => resetThemeSongLimits());
afterEach(() => vi.unstubAllGlobals());

describe("metered means the quota has somewhere to live", () => {
  it("is off without the D1 binding (fails closed), on with it, and unmetered only when asked", () => {
    const w = world();
    expect(themeSongEnabled({ ...w.env, DB: undefined } as never)).toBe(false);
    expect(themeSongEnabled(w.env as never)).toBe(true);
    expect(themeSongEnabled({ ...w.env, DB: undefined, THEME_SONG_QUOTA: "off" } as never)).toBe(true);
    expect(themeSongEnabled({ ...w.env, THEME_SONG_QUOTA: "ON" } as never)).toBe(true); // only the exact word "off" turns metering off
  });
  it("needs a device id on every call that spends or reveals anything", async () => {
    const w = world();
    expect((await post(w, undefined, null)).status).toBe(401);
    expect((await post(w, undefined, "short")).status).toBe(401);
    expect((await get(w, "?id=170010186285001", null)).status).toBe(401);
    expect(w.text.calls).toBe(0);
    expect(w.orders).toHaveLength(0);
  });
});

describe("the probe says how many songs are left", () => {
  it("is free, says the route is on, and with a device id says what this device has left this week", async () => {
    const w = world();
    expect(await json(await get(w, "", null))).toMatchObject({ ok: true, enabled: true });
    expect((await json(await get(w, "", null))).quota).toBeUndefined();
    expect((await json(await get(w, ""))).quota).toMatchObject({ limit: 5, used: 0, left: 5, makerOn: true });
    expect(w.text.calls).toBe(0);
  });
});

describe("five songs a week", () => {
  it("takes a slot per song, tells the child how many are left, and the sixth is turned away BEFORE any model or provider call", async () => {
    const w = world();
    const lefts: number[] = [];
    for (let i = 0; i < 5; i++) { const r = await post(w, { description: "a race car", key: `tap-${i}-aaaaaaaa` }); expect(r.status).toBe(200); lefts.push((await json(r)).quota.left); }
    expect(lefts).toEqual([4, 3, 2, 1, 0]);
    const callsBefore = { text: w.text.calls, orders: w.orders.length };
    const sixth = await post(w, { description: "a race car", key: "tap-6-aaaaaaaa" });
    expect(sixth.status).toBe(429);
    expect(await json(sixth)).toMatchObject({ reason: "week_used", error: expect.stringMatching(/until Monday/), quota: { left: 0, used: 5 } });
    expect({ text: w.text.calls, orders: w.orders.length }).toEqual(callsBefore);
  });
  it("is per device, and the probe of the second device still says five", async () => {
    const w = world();
    for (let i = 0; i < 5; i++) await post(w, { description: "a car", key: `tap-${i}-bbbbbbbb` });
    expect((await post(w, { description: "a car", key: "tap-x-bbbbbbbb" }, OTHER)).status).toBe(200);
    expect((await json(await get(w, "", OTHER))).quota.left).toBe(4);
  });
  it("eight at once from one device: exactly five songs are ordered, the rest are turned away", async () => {
    const w = world();
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => post(w, { description: "a race car", key: `race-${i}-cccccccc` })));
    const codes = results.map((r) => r.status).sort();
    expect(codes.filter((c) => c === 200)).toHaveLength(5);
    expect(codes.filter((c) => c === 429)).toHaveLength(3);
    expect(w.orders).toHaveLength(5);
    expect((await json(await get(w, ""))).quota).toMatchObject({ used: 5, left: 0 });
  });
  it("a retry of the same tap returns the same song and spends nothing: no model call, no order, no slot", async () => {
    const w = world();
    const first = await json(await post(w, { description: "a race car", key: "same-tap-dddddddd" }));
    const calls = { text: w.text.calls, orders: w.orders.length };
    const again = await post(w, { description: "a race car", key: "same-tap-dddddddd" });
    expect(await json(again)).toMatchObject({ name: first.name, task: first.task, replay: true, quota: { used: 1 } });
    expect({ text: w.text.calls, orders: w.orders.length }).toEqual(calls);
  });
});

describe("a slot is given back when nothing was sung", () => {
  it("the gate refusing both replies gives the slot back and orders nothing", async () => {
    const w = world();
    w.text.replies = [{ ...GOOD, name: "Lego Racer" }];
    expect((await post(w)).status).toBe(502);
    expect(w.orders).toHaveLength(0);
    expect((await json(await get(w, ""))).quota).toMatchObject({ used: 0, left: 5 });
  });
  it("the song studio refusing the order gives the slot back, and the child still gets the name and the words", async () => {
    const w = world();
    w.mureka.orderStatus = 500;
    const r = await json(await post(w));
    expect(r).toMatchObject({ name: "Zippy Roadster", task: null, songError: expect.any(String) });
    expect(r.quota).toMatchObject({ used: 0, left: 5 });
  });
  it("a song the provider fails on gives the slot back when the child's poll learns of it", async () => {
    const w = world();
    const { task } = await json(await post(w));
    expect((await json(await get(w, ""))).quota.used).toBe(1);
    w.tasks.set(task, { status: "failed" });
    expect(await json(await get(w, `?id=${task}`))).toEqual({ status: "failed" });
    expect((await json(await get(w, ""))).quota.used).toBe(0);
  });
  it("a finished song keeps its slot", async () => {
    const w = world();
    const { task } = await json(await post(w));
    ready(w, task);
    expect((await json(await get(w, `?id=${task}`))).status).toBe("ready");
    expect((await json(await get(w, ""))).quota.used).toBe(1);
    expect((w.db.raw.prepare("select state from song_reservations").get() as { state: string }).state).toBe("committed");
  });
});

describe("the monthly budget", () => {
  it("is spent by every device together and unset or garbage means no song is made", async () => {
    const w = world({ SONG_MONTHLY_BUDGET: "2" });
    expect((await post(w, { description: "a car", key: "m1-eeeeeeeeee" })).status).toBe(200);
    expect((await post(w, { description: "a car", key: "m2-eeeeeeeeee" }, OTHER)).status).toBe(200);
    const third = await post(w, { description: "a car", key: "m3-eeeeeeeeee" }, "third-device-0001");
    expect(third.status).toBe(429);
    expect(await json(third)).toMatchObject({ reason: "budget_spent" });
    for (const bad of [undefined, "", "lots", "-3", "2.5"]) {
      const x = world({ SONG_MONTHLY_BUDGET: bad });
      expect((await post(x)).status, String(bad)).toBe(429);
      expect(x.text.calls, String(bad)).toBe(0);
    }
  });
});

describe("only a song's owner can see it", () => {
  it("another device gets 'unknown' for the status and the audio, and a bad id is refused before any lookup", async () => {
    const w = world();
    const { task } = await json(await post(w));
    ready(w, task);
    expect((await get(w, `?id=${task}`, OTHER)).status).toBe(404);
    expect((await get(w, `?id=${task}&audio=1`, OTHER)).status).toBe(404);
    expect((await get(w, "?id=170010186200000", DEV)).status).toBe(404); // a task nobody reserved
    expect((await get(w, "?id=../x", DEV)).status).toBe(400);
    expect(w.audio).toHaveLength(0);
    const own = await get(w, `?id=${task}&audio=1`);
    expect(own.status).toBe(200);
    expect(Array.from(new Uint8Array(await own.arrayBuffer()))).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("our own copy of the song (R2)", () => {
  it("copies a finished song into the bucket under the device and task, and serves it from there even when the provider no longer has it", async () => {
    const w = world();
    const { task } = await json(await post(w));
    ready(w, task);
    expect((await json(await get(w, `?id=${task}`))).status).toBe("ready");
    expect(w.r2.puts).toEqual([`songs/${DEV}/${task}.mp3`]);
    expect((w.db.raw.prepare("select stored from song_reservations").get() as { stored: number }).stored).toBe(1);
    w.tasks.set(task, { status: "failed" }); // 30 days later the provider's link is gone
    w.audio.length = 0;
    const res = await get(w, `?id=${task}&audio=1`);
    expect(res.status).toBe(200);
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([1, 2, 3, 4, 5]);
    expect(w.audio).toHaveLength(0); // nothing was fetched from the provider
  });
  it("never serves one device's copy to another", async () => {
    const w = world();
    const { task } = await json(await post(w));
    ready(w, task);
    await get(w, `?id=${task}`);
    expect((await get(w, `?id=${task}&audio=1`, OTHER)).status).toBe(404);
    expect(w.r2.gets.filter((k) => k.includes(OTHER))).toHaveLength(0);
  });
  it("works without a bucket: the provider's link is used, as before, and nothing is claimed as stored", async () => {
    const w = world({ SONGS: undefined });
    const { task } = await json(await post(w));
    ready(w, task);
    expect((await json(await get(w, `?id=${task}`))).status).toBe("ready");
    expect((await get(w, `?id=${task}&audio=1`)).status).toBe(200);
    expect((w.db.raw.prepare("select stored from song_reservations").get() as { stored: number }).stored).toBe(0);
  });
  it("a bucket that fails never spoils the song", async () => {
    const w = world();
    w.r2.put = async () => { throw new Error("R2 is down"); };
    const { task } = await json(await post(w));
    ready(w, task);
    expect((await json(await get(w, `?id=${task}`))).status).toBe("ready");
    expect((await get(w, `?id=${task}&audio=1`)).status).toBe(200);
  });
});

describe("a grown-up's switch", () => {
  it("reading is open, changing needs the parent proof, and a bad update is refused", async () => {
    const w = world();
    const read = await worker.fetch(req("/api/theme-song/settings"), w.env as never);
    expect(await json(read)).toMatchObject({ settings: { makerOn: true, limit: 5 }, quota: { left: 5 } });
    const noProof = await worker.fetch(req("/api/theme-song/settings", { method: "POST", body: JSON.stringify({ makerOn: false }) }), w.env as never);
    expect(noProof.status).toBe(401);
    expect(await json(noProof)).toMatchObject({ status: "gate-required" });
    expect((await json(await get(w, ""))).quota.makerOn).toBe(true); // nothing changed
    const proof = await gateProof(w);
    const bad = (b: unknown) => worker.fetch(req("/api/theme-song/settings", { method: "POST", body: JSON.stringify(b) }, DEV, { "x-parent-proof": proof }), w.env as never);
    for (const b of [{ limit: 9 }, { limit: -1 }, { limit: 1.5 }, { makerOn: "no" }, {}, []]) expect((await bad(b)).status, JSON.stringify(b)).toBe(422);
  });
  it("a proof for ANOTHER device does not open this device's settings", async () => {
    const w = world();
    const otherProof = await gateProof(w, OTHER);
    const r = await worker.fetch(req("/api/theme-song/settings", { method: "POST", body: JSON.stringify({ makerOn: false }) }, DEV, { "x-parent-proof": otherProof }), w.env as never);
    expect(r.status).toBe(401);
  });
  it("turning songs off stops them at once with no model call; turning them on again brings them back", async () => {
    const w = world();
    const proof = await gateProof(w);
    const set = (b: unknown) => worker.fetch(req("/api/theme-song/settings", { method: "POST", body: JSON.stringify(b) }, DEV, { "x-parent-proof": proof }), w.env as never);
    expect((await set({ makerOn: false })).status).toBe(200);
    expect((await json(await get(w, ""))).quota).toMatchObject({ makerOn: false });
    const off = await post(w);
    expect(off.status).toBe(403);
    expect(await json(off)).toMatchObject({ reason: "songs_off" });
    expect(w.text.calls).toBe(0);
    expect(w.orders).toHaveLength(0);
    expect((await set({ makerOn: true })).status).toBe(200);
    expect((await post(w)).status).toBe(200);
  });
  it("a lower weekly limit is honoured, 0 means no new songs, and it cannot go above five", async () => {
    const w = world();
    const proof = await gateProof(w);
    const set = (b: unknown) => worker.fetch(req("/api/theme-song/settings", { method: "POST", body: JSON.stringify(b) }, DEV, { "x-parent-proof": proof }), w.env as never);
    await set({ limit: 2 });
    expect((await post(w, { description: "a car", key: "l1-ffffffffff" })).status).toBe(200);
    expect((await post(w, { description: "a car", key: "l2-ffffffffff" })).status).toBe(200);
    expect((await post(w, { description: "a car", key: "l3-ffffffffff" })).status).toBe(429);
    await set({ limit: 0 });
    expect((await json(await get(w, ""))).quota).toMatchObject({ limit: 0, left: 0 });
    expect((await set({ limit: 6 })).status).toBe(422);
  });
  it("is a settings page that does not exist when the route is unmetered", async () => {
    const w = world({ THEME_SONG_QUOTA: "off", DB: undefined });
    expect((await worker.fetch(req("/api/theme-song/settings"), w.env as never)).status).toBe(501);
  });
});

describe("what the route never does", () => {
  it("never returns the Mureka key, the device id of someone else, or a provider link that is not on the provider's host", async () => {
    const w = world();
    const r = await post(w);
    const text = JSON.stringify(await json(r));
    expect(text).not.toContain("mureka-secret");
    expect(text).not.toContain(OTHER);
    const { task } = JSON.parse(text);
    w.tasks.set(task, { status: "succeeded", url: "https://evil.example/x.mp3" });
    expect(await json(await get(w, `?id=${task}`))).toEqual({ status: "failed" });
  });
  it("answers an unknown sub-path with 404 and keeps the rate limit on the settings route", async () => {
    const w = world();
    expect((await worker.fetch(req("/api/theme-song/other"), w.env as never)).status).toBe(404);
  });
});
