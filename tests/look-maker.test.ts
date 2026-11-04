// runtime/lookMaker.ts and lookStore.ts: making a world's look live, with everything injected. The fake Worker answers the two routes (`/look`, `/art`) with the shapes worker/worldLook.ts really returns; the fake
// decoder turns a picture's tag into synthetic pixels, so the REAL gates and the REAL key-and-crop run on them; the store is the in-memory one. No network, no canvas.
import { afterEach, describe, expect, it } from "vitest";
import { backdropFor, BACKDROPS, isBackdropRegistered, unregisterBackdrop } from "../src/features/game/world/runtime/backdrop";
import type { Rgba } from "../src/features/game/world/runtime/lookArt";
import { DEVICE_DAILY_MAX, DEVICE_GAP_MS, deviceCap, ensureLookArt, failureSay, forgetGeneratedLook, makeLook, recordLook, registerGeneratedLook, stageSay, type MakeLookDeps } from "../src/features/game/world/runtime/lookMaker";
import { createMemoryStore, MAX_STORED_LOOKS, putWithLimit, safeStore, type LookStore } from "../src/features/game/world/runtime/lookStore";
import { WISH_DATA } from "../src/features/game/world/runtime/wishWorlds.data";
import { buildLook, parseBrief, type WorldBrief, type WorldLook } from "../shared/worldBrief";

const DAY = { sky: ["#8a7bee", "#ff9ecd", "#ffd59e"], fog: "#ffd5e5", ground: "#a8e6a3" }, NIGHT = { sky: ["#0a0820", "#241a52", "#4a2f7a"], fog: "#2a1f4a", ground: "#2d5a47" };
const OUT_BRIEF = { name: "Sweet Sunset", day: DAY, night: NIGHT, far: "A low round sun glows over a level line of soft purple hills in a peachy sky.", mid: "Rounded gumdrop hills with swirly lollipop trees, a candy cottage, a striped lamp post and a jelly bean rock.", say: "Let's explore this sweet place together!" };
const IN_BRIEF = { name: "Pirate Room", day: DAY, room: { wall: "stars", floor: "wood", accent: "#ff7744" }, say: "Ahoy, explorer, welcome aboard!" };
const brief = (raw: unknown, base: "garden" | "room"): WorldBrief => { const r = parseBrief(raw, { base, safe: () => true }); if (!r.ok) throw new Error("brief"); return r.brief; };

// ---- synthetic pictures, by tag ----
function img(w: number, h: number, f: (x: number, y: number) => [number, number, number]): Rgba {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = f(x, y); const p = (y * w + x) * 4; data[p] = r; data[p + 1] = g; data[p + 2] = b; data[p + 3] = 255; }
  return { data, width: w, height: h };
}
const PICS: Record<string, Rgba> = {
  "far-day-good": img(300, 40, (x, y) => [140 + (x % 50), 180 + (y % 30), 225 + (x % 20)]),
  "far-night-good": img(300, 40, (x, y) => [8 + (x % 30) + y * 2, 12 + (y % 20) + y * 2, 50 + (x % 40) + y * 3]),       // (dark at the top, a lighter horizon: a real night sky has variety, a flat one fails the gate)
  "far-day-dark": img(300, 40, (x, y) => [6 + (x % 20), 8 + (y % 15), 30 + (x % 25)]),
  "mid-good": img(400, 50, (x, y) => (y >= 12 && y <= 39 && x % 40 < 26 ? [200, 120, 60] : [0, 0, 0])),
  "mid-bad": img(400, 50, (x) => [30 + (x % 200), 90, 120]),                                      // (not painted on black)
};
const blobOf = (tag: string) => new Blob([tag.padEnd(700, " ")], { type: "image/webp" });

function setup(over: Partial<Record<"look" | "farDay" | "farNight" | "mid", (n: number) => Response | Promise<Response>>> = {}, deps: Partial<MakeLookDeps> = {}) {
  const calls: Array<{ path: string; ticket?: string; n: number }> = [];
  const counts = new Map<string, number>();
  const store = createMemoryStore();
  const stages: string[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const path = String(url).replace(/^.*\/api\/world/, "");
    const body = JSON.parse(String(init?.body ?? "{}")) as { ticket?: string; wish?: string; theme?: string };
    const key = path === "/look" ? "look" : body.ticket === "t-far-day" ? "farDay" : body.ticket === "t-far-night" ? "farNight" : "mid";
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    calls.push({ path, ticket: body.ticket, n });
    const h = over[key];
    if (h) return h(n);
    if (key === "look") return json({ ok: true, brief: brief(OUT_BRIEF, "garden"), art: { farDay: "t-far-day", farNight: "t-far-night", mid: "t-mid" } });
    return new Response(blobOf(key === "farDay" ? "far-day-good" : key === "farNight" ? "far-night-good" : "mid-good"), { status: 200 });
  }) as unknown as typeof fetch;
  const d: MakeLookDeps = {
    fetchImpl, store, retryPauseMs: 0, newId: () => "gen-0123456789", now: () => 1000, onStage: (s) => stages.push(s),
    decode: async (blob) => { const tag = (await blob.text()).trim(); const p = PICS[tag]; if (!p) throw new Error(`bad picture ${tag}`); return p; },
    encode: async (image) => new Blob([`enc:${image.width}x${image.height}`.padEnd(600, " ")], { type: "image/webp" }),
    ...deps,
  };
  return { d, calls, store, stages, calls_for: (ticket: string) => calls.filter((c) => c.ticket === ticket).length };
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

describe("makeLook: the live path", () => {
  it("an outdoor wish: asks for the look, fetches the three pictures, checks them, stores them and says which exist", async () => {
    const s = setup();
    const r = await makeLook("a candy forest at sunset", "garden", s.d);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.look.id).toBe("gen-0123456789");
    expect(r.look.base).toBe("garden");
    expect(r.look.kind).toBe("outdoor");
    expect(r.look.art).toEqual({ farDay: true, farNight: true, mid: true });
    expect(Object.keys(r.art).sort()).toEqual(["farDay", "farNight", "mid"]);
    expect(s.calls.map((c) => c.path)).toEqual(["/look", "/art", "/art", "/art"]);
    expect(s.stages).toEqual(["thinking", "painting", "checking"]);
    const rec = await s.store.get("gen-0123456789");
    expect(rec && !!rec.farDay && !!rec.farNight && !!rec.mid && rec.at === 1000).toBe(true);
  });
  it("the wish and the base theme are what go to the Worker, and nothing else", async () => {
    let sent: unknown;
    const s = setup({ look: () => json({ ok: false, status: "gentle" }) }, { fetchImpl: (async (u: string, init?: RequestInit) => { sent = JSON.parse(String(init?.body)); return json({ ok: false, status: "gentle" }); }) as unknown as typeof fetch });
    await makeLook("  a candy forest  ", "snow", s.d);
    expect(sent).toEqual({ wish: "a candy forest", theme: "snow" });
  });
  it("the mid strip kept is the KEYED one (cropped to the art), and the far bands are re-encoded from the checked pixels", async () => {
    const s = setup();
    const r = await makeLook("x", "garden", s.d);
    if (!r.ok) throw new Error("not ok");
    expect(await r.art.mid!.text()).toMatch(/^enc:(\d+)x(\d+)/);
    const [, w, h] = /^enc:(\d+)x(\d+)/.exec((await r.art.mid!.text()))!;
    expect([Number(w), Number(h)]).toEqual([400 - 14, 28]);                                       // (the 400x50 picture cropped to its art: columns 0..385, rows 12..39)
    expect(await r.art.farDay!.text()).toMatch(/^enc:300x40/);
  });
  it("an indoor wish makes a look with no art: no picture is asked for and nothing is stored", async () => {
    const s = setup({ look: () => json({ ok: true, brief: brief(IN_BRIEF, "room"), art: null }) });
    const r = await makeLook("my pirate bedroom", "room", s.d);
    expect(r.ok && r.look.kind === "indoor" && r.look.art.mid === false && r.look.room?.wall === "stars").toBe(true);
    expect(s.calls.map((c) => c.path)).toEqual(["/look"]);
    expect(await s.store.list()).toEqual([]);
  });
  it("refuses to ask for a theme that is not a base theme or an empty wish, without asking", async () => {
    const s = setup();
    expect(await makeLook("x", "moon" as never, s.d)).toEqual({ ok: false, status: "failed" });
    expect(await makeLook("   ", "garden", s.d)).toEqual({ ok: false, status: "failed" });
    expect(s.calls).toEqual([]);
  });
});

describe("makeLook: what the Worker can say", () => {
  const status = async (look: (n: number) => Response | Promise<Response>) => (await makeLook("x", "garden", setup({ look }).d));
  it("maps every answer to a status the game can speak about, and never throws", async () => {
    expect(await status(() => json({ ok: false, status: "gentle" }))).toEqual({ ok: false, status: "gentle" });
    expect(await status(() => json({ ok: false, status: "daily-limit" }, 429))).toEqual({ ok: false, status: "daily-limit" });
    expect(await status(() => json({ ok: false, status: "slow-down" }, 429))).toEqual({ ok: false, status: "slow-down" });
    expect(await status(() => json({ ok: false, status: "not-configured" }, 503))).toEqual({ ok: false, status: "not-configured" });
    expect(await status(() => json({ error: "nope" }, 404))).toEqual({ ok: false, status: "not-configured" });
    expect(await status(() => json({ ok: false, status: "not-configured" }, 200))).toEqual({ ok: false, status: "not-configured" });
    expect(await status(() => json({}, 500))).toEqual({ ok: false, status: "failed" });
    expect(await status(() => new Response("<html>", { status: 200 }))).toEqual({ ok: false, status: "failed" });
    expect(await status(() => json({ ok: true }))).toEqual({ ok: false, status: "failed" });                                       // (no brief)
    expect(await status(() => json({ ok: true, brief: brief(OUT_BRIEF, "garden"), art: null }))).toEqual({ ok: false, status: "failed" });   // (an outdoor look with no tickets)
    expect(await status(() => json({ ok: true, brief: brief(OUT_BRIEF, "garden"), art: { farDay: "a", farNight: 5, mid: "c" } }))).toEqual({ ok: false, status: "failed" });
  });
  it("a network error is 'offline'; an aborted request is 'failed'", async () => {
    const off = setup({}, { fetchImpl: (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch });
    expect(await makeLook("x", "garden", off.d)).toEqual({ ok: false, status: "offline" });
    const ctl = new AbortController(); ctl.abort();
    const ab = setup({}, { signal: ctl.signal, fetchImpl: (async () => { throw new DOMException("aborted", "AbortError"); }) as unknown as typeof fetch });
    expect(await makeLook("x", "garden", ab.d)).toEqual({ ok: false, status: "failed" });
  });
});

describe("makeLook: a picture that does not come, or does not pass", () => {
  it("a failed picture (a 502, a network error) is tried once more, and the second try is the one that is kept", async () => {
    const s = setup({ farDay: (n) => (n === 1 ? new Response("x", { status: 502 }) : new Response(blobOf("far-day-good"), { status: 200 })), mid: (n) => { if (n === 1) throw new TypeError("fetch failed"); return new Response(blobOf("mid-good"), { status: 200 }); } });
    const r = await makeLook("x", "garden", s.d);
    expect(r.ok && r.look.art).toEqual({ farDay: true, farNight: true, mid: true });
    expect(s.calls_for("t-far-day")).toBe(2);
    expect(s.calls_for("t-mid")).toBe(2);
  });
  it("a picture that fails twice is LEFT OUT (the world falls back to its base theme's art for that look) and the others are still kept", async () => {
    const s = setup({ farNight: () => new Response("x", { status: 502 }) });
    const r = await makeLook("x", "garden", s.d);
    expect(r.ok && r.look.art).toEqual({ farDay: true, farNight: false, mid: true });
    expect(s.calls_for("t-far-night")).toBe(2);                                                  // (a ticket paints twice at most: never a third try)
    const rec = (await s.store.get("gen-0123456789"))!;
    expect(!!rec.farDay && !rec.farNight && !!rec.mid).toBe(true);
  });
  it("a ticket that is used up, forged or not configured is not asked again", async () => {
    for (const code of [409, 403, 503, 422, 429]) {
      const s = setup({ mid: () => json({ ok: false }, code) });
      const r = await makeLook("x", "garden", s.d);
      expect(r.ok && r.look.art.mid, String(code)).toBe(false);
      expect(s.calls_for("t-mid"), String(code)).toBe(1);
    }
  });
  it("a mid strip that fails its gate (not painted on black) is retried, and a good second picture is kept; two bad ones leave it out", async () => {
    const fix = setup({ mid: (n) => new Response(blobOf(n === 1 ? "mid-bad" : "mid-good"), { status: 200 }) });
    expect((await makeLook("x", "garden", fix.d) as { look: WorldLook }).look.art.mid).toBe(true);
    expect(fix.calls_for("t-mid")).toBe(2);
    const bad = setup({ mid: () => new Response(blobOf("mid-bad"), { status: 200 }) });
    expect((await makeLook("x", "garden", bad.d) as { look: WorldLook }).look.art.mid).toBe(false);
    expect(bad.calls_for("t-mid")).toBe(2);
  });
  it("a far band that is too dark for its look fails its gate too (a day band that came back black)", async () => {
    const s = setup({ farDay: () => new Response(blobOf("far-day-dark"), { status: 200 }) });
    const r = await makeLook("x", "garden", s.d);
    expect(r.ok && r.look.art).toEqual({ farDay: false, farNight: true, mid: true });
  });
  it("an answer that is not an image (too small, wrong type, undecodable) counts as a failed try", async () => {
    const tiny = setup({ mid: () => new Response("tiny", { status: 200 }) });
    expect((await makeLook("x", "garden", tiny.d) as { look: WorldLook }).look.art.mid).toBe(false);
    const html = setup({ mid: () => new Response(new Blob(["x".repeat(900)], { type: "text/html" }), { status: 200 }) });
    expect((await makeLook("x", "garden", html.d) as { look: WorldLook }).look.art.mid).toBe(false);
    const junk = setup({ mid: () => new Response(blobOf("not-a-picture"), { status: 200 }) });
    expect((await makeLook("x", "garden", junk.d) as { look: WorldLook }).look.art.mid).toBe(false);
  });
  it("when no picture comes at all the look still comes back (palette only) and nothing is stored", async () => {
    const s = setup({ farDay: () => new Response("x", { status: 502 }), farNight: () => new Response("x", { status: 502 }), mid: () => new Response("x", { status: 502 }) });
    const r = await makeLook("x", "garden", s.d);
    expect(r.ok && r.look.art).toEqual({ farDay: false, farNight: false, mid: false });
    expect(await s.store.list()).toEqual([]);
  });
});

describe("registering a look's art", () => {
  const look = (): WorldLook => buildLook(brief(OUT_BRIEF, "garden"), "garden", "gen-0123456789");
  const blobs = { farDay: new Blob(["a"]), farNight: new Blob(["b"]), mid: new Blob(["c"]) };
  afterEach(() => forgetGeneratedLook("gen-0123456789", () => {}));
  it("makes object URLs for each piece, registers them under the look's id, and the backdrops answer for it in both looks", () => {
    let n = 0;
    const made: string[] = [];
    expect(registerGeneratedLook(look(), blobs, () => { const u = `blob:${++n}`; made.push(u); return u; }, () => {})).toBe(true);
    expect(isBackdropRegistered("gen-0123456789")).toBe(true);
    expect(backdropFor("garden", "day", "gen-0123456789")!.layers.map((l) => l.url)).toEqual(["blob:1", "blob:3"]);
    expect(backdropFor("garden", "night", "gen-0123456789")!.layers.map((l) => l.url)).toEqual(["blob:2", "blob:3"]);
    expect(made).toHaveLength(3);
  });
  it("registering the same look again revokes the earlier URLs; forgetting revokes and unregisters", () => {
    const revoked: string[] = [];
    let n = 0;
    registerGeneratedLook(look(), blobs, () => `blob:${++n}`, (u) => revoked.push(u));
    registerGeneratedLook(look(), blobs, () => `blob:${++n}`, (u) => revoked.push(u));
    expect(revoked).toEqual(["blob:1", "blob:2", "blob:3"]);
    forgetGeneratedLook("gen-0123456789", (u) => revoked.push(u));
    expect(revoked.slice(3)).toEqual(["blob:4", "blob:5", "blob:6"]);
    expect(isBackdropRegistered("gen-0123456789")).toBe(false);
    expect(backdropFor("garden", "day", "gen-0123456789")).toBe(BACKDROPS.garden!.day);
  });
  it("a look with no pieces registers nothing useful (false), so the world wears its base theme's art", () => {
    expect(registerGeneratedLook(look(), {}, () => "blob:x", () => {})).toBe(false);
    expect(backdropFor("garden", "day", "gen-0123456789")).toBe(BACKDROPS.garden!.day);
  });
  it("ensureLookArt: already registered, a showcase look, one stored on the device, or nothing; never throws", async () => {
    const store = createMemoryStore();
    expect(await ensureLookArt(look(), store, () => "blob:z")).toBe(false);                      // (outdoor look, flags all false: nothing to load)
    const made = { ...look(), art: { farDay: true, farNight: true, mid: true } };
    expect(await ensureLookArt(made, store, () => "blob:z")).toBe(false);                        // (flags say yes but the device has nothing)
    await store.put({ id: made.id, at: 1, ...blobs });
    expect(await ensureLookArt(made, store, () => "blob:z")).toBe(true);
    expect(isBackdropRegistered(made.id)).toBe(true);
    expect(await ensureLookArt(made, { ...store, get: async () => { throw new Error("db"); } }, () => "blob:z")).toBe(true);   // (already registered: the store is not even asked)
    forgetGeneratedLook(made.id, () => {});
    expect(await ensureLookArt(made, { ...store, get: async () => { throw new Error("db"); } }, () => "blob:z")).toBe(false);
    const showcase = WISH_DATA.find((w) => w.look.kind === "outdoor")!;
    expect(await ensureLookArt(showcase.look, store)).toBe(true);
    unregisterBackdrop(showcase.look.id);
    const indoor = { ...look(), kind: "indoor" as const };
    expect(await ensureLookArt(indoor, store)).toBe(false);
  });
});

describe("the friendly limit on the device", () => {
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
  const T0 = new Date(2026, 10, 4, 12, 0, 0).getTime();
  it("allows the first world, makes the next wait a few minutes, and stops at the daily limit", () => {
    const kv = mem();
    expect(deviceCap(kv, T0)).toEqual({ ok: true });
    recordLook(kv, T0);
    expect(deviceCap(kv, T0 + 60_000)).toEqual({ ok: false, why: "wait", waitMs: DEVICE_GAP_MS - 60_000 });
    expect(deviceCap(kv, T0 + DEVICE_GAP_MS)).toEqual({ ok: true });
    for (let i = 1; i < DEVICE_DAILY_MAX; i++) recordLook(kv, T0 + i * DEVICE_GAP_MS);
    expect(deviceCap(kv, T0 + 10 * DEVICE_GAP_MS)).toEqual({ ok: false, why: "daily", waitMs: 0 });
  });
  it("starts again the next day, and treats unreadable or blocked storage as no limit rather than an error", () => {
    const kv = mem();
    for (let i = 0; i < DEVICE_DAILY_MAX; i++) recordLook(kv, T0 + i * DEVICE_GAP_MS);
    expect(deviceCap(kv, T0 + 24 * 3600_000).ok).toBe(true);
    kv.setItem("tvLookMade:v1", "{not json");
    expect(deviceCap(kv, T0)).toEqual({ ok: true });
    expect(() => recordLook({ getItem: () => null, setItem: () => { throw new Error("blocked"); } }, T0)).not.toThrow();
    expect(deviceCap({ getItem: () => { throw new Error("blocked"); }, setItem: () => {} }, T0)).toEqual({ ok: true });
  });
  it("says something kind for the failures a child can do something about, and nothing for the rest", () => {
    expect(failureSay("gentle")).toMatch(/Try other words/);
    expect(failureSay("daily-limit")).toMatch(/wish world/);
    expect(failureSay("slow-down")).toMatch(/moment/);
    for (const s of ["offline", "not-configured", "failed"] as const) expect(failureSay(s)).toBeNull();
    for (const s of ["thinking", "painting", "checking"] as const) expect(stageSay(s).length).toBeGreaterThan(5);
  });
});

describe("the device store", () => {
  const rec = (n: number) => ({ id: `gen-${String(n).padStart(10, "0")}`, at: n });
  it("keeps what is put, forgets what is removed, lists oldest first", async () => {
    const s = createMemoryStore();
    await s.put(rec(2)); await s.put(rec(1));
    expect((await s.list()).map((x) => x.at)).toEqual([1, 2]);
    expect((await s.get(rec(1).id))!.at).toBe(1);
    await s.remove(rec(1).id);
    expect(await s.get(rec(1).id)).toBeNull();
  });
  it("putWithLimit drops the OLDEST worlds beyond the limit and never the one just stored; a bad id is not stored", async () => {
    const s = createMemoryStore();
    for (let i = 1; i <= MAX_STORED_LOOKS; i++) await putWithLimit(s, rec(i));
    expect(await s.list()).toHaveLength(MAX_STORED_LOOKS);
    const dropped = await putWithLimit(s, rec(100));
    expect(dropped).toEqual([rec(1).id]);
    expect((await s.list()).map((x) => x.at)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 100]);
    const old = await putWithLimit(s, rec(0), 3);                                                // (an old record put into a tight store: it is kept, the rest go)
    expect(old).not.toContain(rec(0).id);
    expect((await s.list()).some((x) => x.id === rec(0).id)).toBe(true);
    expect(await putWithLimit(s, { id: "kid-world", at: 5 })).toEqual([]);
    expect(await s.get("kid-world")).toBeNull();
  });
  it("safeStore turns a database that throws into 'nothing stored' and reports that it does not work", async () => {
    const boom: LookStore = { put: async () => { throw new Error("quota"); }, get: async () => { throw new Error("x"); }, remove: async () => { throw new Error("x"); }, list: async () => { throw new Error("x"); } };
    const s = safeStore(boom);
    expect(s.works()).toBe(true);
    await expect(s.put(rec(1))).resolves.toBeUndefined();
    expect(await s.get("gen-0123456789")).toBeNull();
    expect(await s.list()).toEqual([]);
    expect(s.works()).toBe(false);
  });
});
