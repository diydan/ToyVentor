// The Worker side of generated worlds (worker/worldLook.ts): POST /api/world/look turns a wish into a validated look with SIGNED art tickets, POST /api/world/art paints one layer from a ticket's own
// sentence, and D1 counts the daily budgets that bound the cost. No network and no paid call: a fake `fetch` stands in for the model and the image service, and D1 is a real SQLite (node:sqlite, the
// engine D1 runs) so the budget and replay SQL is tested for real, including the "no such table" bootstrap and two requests racing for the last unit.
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../worker/index";
import { METERED_PATHS, isMetered } from "../worker/spendLimit";
import type { D1Like } from "../worker/ownership";
import {
  DEFAULT_DAILY_GLOBAL, DEFAULT_DAILY_PER_IP, INDOOR_FACTOR, REDEEM_MAX, giveUnitBack, handleWorldArt, handleWorldLook, parseLimit, secondsToReset, sniffImage, takeUnit, takeUnits, utcDay, type WorldLookEnv,
} from "../worker/worldLook";
import { IMAGE_SIZE, TICKET_TTL_MS, farPrompt, midPrompt, signTicket, verifyTicket } from "../shared/worldBrief";

const SECRET = "world-test-signing-key-0123456789";
const KEY = "meta-test-key-do-not-leak";

// ---- the fakes ----------------------------------------------------------------------------------------------------------------

function sqlite(): D1Like & { sql: DatabaseSync; rows: (table: string) => Record<string, unknown>[] } {
  const sql = new DatabaseSync(":memory:");
  return {
    sql,
    rows: (table) => sql.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[],
    prepare: (q: string) => ({
      bind: (...v: unknown[]) => ({
        run: async () => ({ meta: { changes: Number(sql.prepare(q).run(...(v as never[])).changes) } }),
        all: async () => ({ results: sql.prepare(q).all(...(v as never[])) as Record<string, unknown>[] }),
      }),
    }),
  };
}

const DAY = { sky: ["#8a7bee", "#ff9ecd", "#ffd59e"], fog: "#ffd5e5", ground: "#a8e6a3" };
const NIGHT = { sky: ["#0a0820", "#241a52", "#4a2f7a"], fog: "#2a1f4a", ground: "#2d5a47" };
const OUTDOOR = { name: "Sweet Sunset", day: DAY, night: NIGHT, far: "A low round sun glows over a level line of soft purple hills in a peachy sky.", mid: "Rounded gumdrop hills with swirly lollipop trees, a candy cottage, a striped lamp post and a jelly bean rock.", say: "Let's explore this sweet place together!" };
const INDOOR = { name: "Pirate Room", day: DAY, night: NIGHT, room: { wall: "stars", floor: "carpet", accent: "#ff77aa" }, say: "Ahoy, explorer, welcome aboard!" };

/** A small valid WebP header plus filler, as bytes and as base64. */
const IMG = (() => { const b = new Uint8Array(300).fill(7); b.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]); return b; })();
const IMG_B64 = btoa(String.fromCharCode(...IMG));

interface Call { url: string; body: Record<string, unknown> | null; auth: string | null }
let calls: Call[];
let sparkAnswer: (body: Record<string, unknown>) => Response | Promise<Response>;
let imageAnswer: (body: Record<string, unknown>) => Response | Promise<Response>;
const sparkJson = (obj: unknown) => new Response(JSON.stringify({ output_text: JSON.stringify(obj) }), { status: 200 });
const imageOk = () => new Response(JSON.stringify({ data: [{ b64_json: IMG_B64 }], output_format: "webp" }), { status: 200 });
const sparkCalls = () => calls.filter((c) => c.url.endsWith("/responses"));
const imageCalls = () => calls.filter((c) => c.url.endsWith("/images/generations"));

beforeEach(() => {
  calls = [];
  sparkAnswer = () => sparkJson(OUTDOOR);
  imageAnswer = () => imageOk();
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const headers = new Headers(init?.headers);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ url, body, auth: headers.get("authorization") });
    if (url.endsWith("/responses")) return sparkAnswer(body ?? {});
    if (url.endsWith("/images/generations")) return imageAnswer(body ?? {});
    throw new Error(`unexpected fetch ${url}`);
  });
});
afterEach(() => vi.unstubAllGlobals());

let ipN = 0;
const freshIp = () => `203.0.113.${(++ipN % 250) + 1}`;
/** `db` null means NO database (undefined would be swallowed by the default parameter and give a fresh one). */
const env = (over: Partial<WorldLookEnv> = {}, db: D1Like | null = sqlite()): WorldLookEnv => ({ MODEL_API_KEY: KEY, VOICE_SIGNING_KEY: SECRET, DB: db ?? undefined, ...over });
const look = (e: WorldLookEnv, wish = "a candy forest at sunset", theme: string = "garden", ip: string = freshIp(), ctx?: { waitUntil(p: Promise<unknown>): void }) =>
  handleWorldLook(new Request("http://local/api/world/look", { method: "POST", headers: { "content-type": "application/json", "CF-Connecting-IP": ip }, body: JSON.stringify({ wish, theme }) }), e, ctx);
const art = (e: WorldLookEnv, ticket: unknown, extra: Record<string, unknown> = {}) =>
  handleWorldArt(new Request("http://local/api/world/art", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticket, ...extra }) }), e);
const asJson = async (r: Response) => (await r.json()) as Record<string, any>;
const budget = (db: ReturnType<typeof sqlite>) => Object.fromEntries(db.rows("world_budget").map((r) => [String(r.scope).startsWith("ip") ? String(r.scope).split(":")[0] : r.scope, r.count]));

describe("the route is wired and metered", () => {
  it("both paths are model routes for the spend limiter, and the Worker entry routes them (a non-JSON body gets the handler's own 415)", async () => {
    for (const p of ["/api/world/look", "/api/world/art"]) {
      expect(METERED_PATHS.has(p), p).toBe(true);
      expect(isMetered("POST", p)).toBe(true);
      expect(isMetered("GET", p)).toBe(false);
      const res = await worker.fetch(new Request(`http://local${p}`, { method: "POST", headers: { "content-type": "text/plain" }, body: "x" }), env() as never, { waitUntil() {}, passThroughOnException() {} } as never);
      expect(res.status, p).toBe(415);
    }
  });
});

describe("POST /api/world/look: the request", () => {
  it("answers GET with whether it is configured, and any other method with 405", async () => {
    const get = await handleWorldLook(new Request("http://local/api/world/look"), env());
    expect(await asJson(get)).toEqual({ ok: true, route: "world-look", configured: true });
    expect((await asJson(await handleWorldLook(new Request("http://local/api/world/look"), { DB: sqlite() }))).configured).toBe(false);
    expect((await handleWorldLook(new Request("http://local/api/world/look", { method: "PUT" }), env())).status).toBe(405);
  });
  it("refuses a body that is not JSON (415), too big (413), unreadable (400), or has no wish (422), a long wish (413) or an unknown theme (422)", async () => {
    const e = env();
    const post = (body: BodyInit, type = "application/json") => handleWorldLook(new Request("http://local/api/world/look", { method: "POST", headers: { "content-type": type, "CF-Connecting-IP": freshIp() }, body }), e);
    expect((await post("{}", "text/plain")).status).toBe(415);
    expect((await post(JSON.stringify({ wish: "x".repeat(5000), theme: "garden" }))).status).toBe(413);
    expect((await post("{not json")).status).toBe(400);
    expect((await post(JSON.stringify({ theme: "garden" }))).status).toBe(422);
    expect((await post(JSON.stringify({ wish: "   ", theme: "garden" }))).status).toBe(422);
    expect((await post(JSON.stringify({ wish: "x".repeat(201), theme: "garden" }))).status).toBe(413);
    for (const theme of ["moon", "", 5, null, undefined, "GARDEN", "__proto__"]) expect((await post(JSON.stringify({ wish: "a candy forest", theme }))).status, String(theme)).toBe(422);
    expect(calls).toEqual([]);                                                                                    // (nothing was asked of any model)
  });
  it("a wish with an unsafe term, a link or contact details is not sent to any model and costs no budget", async () => {
    const e = env();
    for (const wish of ["a scary monster with a gun", "visit www.example.com for a world", "call me on 555 123 4567 please"]) {
      const res = await look(e, wish);
      expect(res.status).toBe(200);
      expect(await asJson(res)).toEqual({ ok: false, status: "gentle" });
    }
    expect(calls).toEqual([]);
    expect(((e.DB as ReturnType<typeof sqlite>).sql.prepare("SELECT name FROM sqlite_master WHERE name = 'world_budget'").all()).length).toBe(0);       // (the table was never even needed)
  });
});

describe("POST /api/world/look: a good outdoor look", () => {
  it("returns the validated brief and three signed tickets that carry the brief's own sentences, valid for ten minutes", async () => {
    const e = env();
    const before = Date.now();
    const res = await look(e);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const out = await asJson(res);
    expect(out.ok).toBe(true);
    expect(out.brief.kind).toBe("outdoor");
    expect(out.brief.name).toBe("Sweet Sunset");
    expect(Object.keys(out.art).sort()).toEqual(["farDay", "farNight", "mid"]);
    const day = (await verifyTicket(SECRET, out.art.farDay, Date.now()))!, night = (await verifyTicket(SECRET, out.art.farNight, Date.now()))!, mid = (await verifyTicket(SECRET, out.art.mid, Date.now()))!;
    expect([day.k, day.look, day.s]).toEqual(["far", "day", OUTDOOR.far]);
    expect([night.k, night.look, night.s]).toEqual(["far", "night", OUTDOOR.far]);
    expect([mid.k, mid.look, mid.s]).toEqual(["mid", undefined, OUTDOOR.mid]);
    expect(mid.exp).toBeGreaterThanOrEqual(before + TICKET_TTL_MS);
    expect(mid.exp).toBeLessThanOrEqual(Date.now() + TICKET_TTL_MS);
    expect(await verifyTicket(SECRET, out.art.mid, Date.now() + TICKET_TTL_MS + 5)).toBeNull();                  // (and no longer)
  });
  it("asks the text model ONCE, with the safety prefix, the child's quoted words and the base theme, and never calls the image service", async () => {
    await look(env(), "a candy forest at sunset", "snow");
    expect(sparkCalls()).toHaveLength(1);
    expect(imageCalls()).toHaveLength(0);
    const sent = String(sparkCalls()[0]!.body!.input);
    expect(sent).toMatch(/^You help a young child/);
    expect(sent).toContain('The child said: "a candy forest at sunset"');
    expect(sent).toContain('"snow" theme');
    expect(sparkCalls()[0]!.auth).toBe(`Bearer ${KEY}`);
  });
  it("redacts contact details from the prompt the model sees, like Create does (a wish with an address-like string never gets this far, but the prefix scrub is the second wall)", async () => {
    await look(env(), "a candy forest for ann.smith@example.test");
    // the child-safe check refuses the wish outright, so the model is not asked at all
    expect(sparkCalls()).toHaveLength(0);
  });
  it("takes one unit of the address's scope and of the global scope, and keeps neither the address nor the wish in the database", async () => {
    const db = sqlite();
    const ip = "198.51.100.77";
    await look(env({}, db), "a candy forest at sunset", "garden", ip);
    const rows = db.rows("world_budget");
    const scopes = rows.map((r) => String(r.scope)).sort();
    expect(scopes).toHaveLength(2);
    expect(scopes[0]).toBe("global");
    expect(scopes[1]).toMatch(/^ip:[0-9a-f]{16}$/);
    expect(rows.every((r) => r.count === 1 && r.day === utcDay(Date.now()))).toBe(true);
    const dump = JSON.stringify(rows) + JSON.stringify(db.sql.prepare("SELECT sql FROM sqlite_master").all());
    expect(dump).not.toContain(ip);
    expect(dump).not.toContain("candy");
  });
  it("never puts the signing key, the model key or the prompt in what it returns", async () => {
    const res = await look(env());
    const text = await res.text();
    for (const secret of [SECRET, KEY, "You help a young child", "The child said"]) expect(text).not.toContain(secret);
  });
});

describe("POST /api/world/look: an indoor look", () => {
  it("has no art tickets and needs neither the signing key nor the image service, and counts in the indoor scopes", async () => {
    sparkAnswer = () => sparkJson(INDOOR);
    const db = sqlite();
    const res = await look(env({ VOICE_SIGNING_KEY: undefined, IMAGE_BACKEND: "off" }, db), "my pirate bedroom", "room");
    const out = await asJson(res);
    expect(out.ok).toBe(true);
    expect(out.art).toBeNull();
    expect(out.brief.kind).toBe("indoor");
    expect(out.brief.room).toEqual({ wall: "stars", floor: "carpet", accent: "#ff77aa" });
    const scopes = db.rows("world_budget").map((r) => String(r.scope)).sort();
    expect(scopes).toHaveLength(2);
    expect(scopes[0]).toBe("indoor");
    expect(scopes[1]).toMatch(/^ipi:[0-9a-f]{16}$/);
    expect(imageCalls()).toHaveLength(0);
  });
  it("an indoor request whose answer is an outdoor brief (no room block) is refused, not passed through", async () => {
    sparkAnswer = () => sparkJson(OUTDOOR);
    expect(await asJson(await look(env(), "my pirate bedroom", "room"))).toEqual({ ok: false, status: "gentle" });
  });
});

describe("POST /api/world/look: when the model does not give a good look (always 200 gentle, never a 5xx, and the unit is given back)", () => {
  const gentleCases: [string, () => Response | Promise<Response> | never][] = [
    ["a model that repeats the child's words (the echo rule)", () => sparkJson({ ...OUTDOOR, far: "A candy forest at sunset stretches over soft purple hills far away." })],
    ["a sentence with an unsafe term", () => sparkJson({ ...OUTDOOR, mid: "A scary monster with a gun stands among the soft round hills of the meadow." })],
    ["text that is not JSON", () => new Response(JSON.stringify({ output_text: "Sure! Here is a lovely world for you." }), { status: 200 })],
    ["a JSON array of nothing", () => sparkJson([1, 2, 3])],
    ["a brief with no palette", () => sparkJson({ ...OUTDOOR, day: undefined, night: undefined })],
    ["a brief with a bad colour", () => sparkJson({ ...OUTDOOR, day: { ...DAY, fog: "pink" } })],
    ["a model that declines", () => sparkJson({ ok: false })],
    ["a model HTTP 500", () => new Response("boom", { status: 500 })],
    ["a model HTTP 429", () => new Response("slow", { status: 429 })],
    ["an unreadable body", () => new Response("<html>", { status: 200 })],
    ["a network failure", () => { throw new TypeError("fetch failed"); }],
  ];
  for (const [name, answer] of gentleCases) {
    it(name, async () => {
      sparkAnswer = answer;
      const db = sqlite();
      const res = await look(env({}, db), "a candy forest at sunset");
      expect(res.status).toBe(200);
      expect(await asJson(res)).toEqual({ ok: false, status: "gentle" });
      expect(db.rows("world_budget").every((r) => r.count === 0), "the unit comes back").toBe(true);
    });
  }
});

describe("POST /api/world/look: not configured", () => {
  it("no model key, the text backend off, no signing key (outdoor) or no hosted image service (outdoor) answer 503 not-configured and spend nothing", async () => {
    for (const over of [{ MODEL_API_KEY: undefined }, { TEXT_BACKEND: "off" }, { VOICE_SIGNING_KEY: undefined }, { VOICE_SIGNING_KEY: "short" }, { IMAGE_BACKEND: "off" }, { IMAGE_BACKEND: "self" }] as Partial<WorldLookEnv>[]) {
      const db = sqlite();
      const res = await look(env(over, db));
      expect(res.status, JSON.stringify(over)).toBe(503);
      expect(await asJson(res)).toEqual({ ok: false, status: "not-configured" });
      expect(db.sql.prepare("SELECT name FROM sqlite_master WHERE name = 'world_budget'").all().length).toBe(0);
    }
    expect(calls).toEqual([]);
  });
});

describe("the daily budgets", () => {
  it("the numbers: 30 worlds a day for the whole app and 5 per address unless the variables say otherwise, and a bad variable means the default", () => {
    expect([DEFAULT_DAILY_GLOBAL, DEFAULT_DAILY_PER_IP, INDOOR_FACTOR]).toEqual([30, 5, 5]);
    expect(parseLimit("12", 30)).toBe(12);
    expect(parseLimit(" 7 ", 30)).toBe(7);
    expect(parseLimit("0", 30)).toBe(0);
    for (const bad of ["", "abc", "-3", "1.5", "1e3", "9999999", undefined, 12 as unknown]) expect(parseLimit(bad, 30), String(bad)).toBe(30);
  });
  it("the global budget: the world after the last one is refused with 429 daily-limit and a retry-after that is the seconds to the next UTC midnight", async () => {
    const e = env({ WORLD_DAILY_GLOBAL: "2" });
    expect((await look(e)).status).toBe(200);
    expect((await look(e)).status).toBe(200);
    const res = await look(e);
    expect(res.status).toBe(429);
    expect(await asJson(res)).toEqual({ ok: false, status: "daily-limit" });
    const wait = Number(res.headers.get("retry-after"));
    expect(wait).toBeGreaterThanOrEqual(60);
    expect(wait).toBeLessThanOrEqual(86_400);
    expect(sparkCalls()).toHaveLength(2);                                                                         // (the refused one never reached the model)
  });
  it("the per-address budget: one address is stopped at its own limit while another address still gets in", async () => {
    const e = env({ WORLD_DAILY_PER_IP: "2" });
    const mine = "198.51.100.10";
    expect((await look(e, "a candy forest", "garden", mine)).status).toBe(200);
    expect((await look(e, "a jelly ocean", "beach", mine)).status).toBe(200);
    expect((await look(e, "a cloud castle", "sky", mine)).status).toBe(429);
    expect((await look(e, "a cloud castle", "sky", "198.51.100.11")).status).toBe(200);
  });
  it("when a later scope is full the unit already taken from the earlier one is given back (a full app does not eat the address's day)", async () => {
    const db = sqlite();
    const ip = "198.51.100.20";
    await look(env({ WORLD_DAILY_GLOBAL: "1" }, db), "a candy forest", "garden", "198.51.100.21");              // takes the only global unit
    const res = await look(env({ WORLD_DAILY_GLOBAL: "1" }, db), "a jelly ocean", "beach", ip);
    expect(res.status).toBe(429);
    const mine = db.rows("world_budget").filter((r) => String(r.scope).startsWith("ip:"));
    expect(mine.map((r) => r.count).sort()).toEqual([0, 1]);                                                      // (the other address used its unit, this one's went back to 0)
  });
  it("two requests racing for the LAST unit cannot both get it", async () => {
    const db = sqlite();
    const e = env({ WORLD_DAILY_GLOBAL: "1" }, db);
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    sparkAnswer = async () => { await gate; return sparkJson(OUTDOOR); };                                         // (the model is slow, so both requests are inside at once)
    const a = look(e, "a candy forest", "garden", "198.51.100.30"), b = look(e, "a jelly ocean", "beach", "198.51.100.31");
    await new Promise((r) => setTimeout(r, 30));
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect([ra.status, rb.status].sort()).toEqual([200, 429]);
    expect(budget(db).global).toBe(1);
  });
  it("many requests at once never spend more than the limit", async () => {
    const db = sqlite();
    const e = env({ WORLD_DAILY_GLOBAL: "3", WORLD_DAILY_PER_IP: "99" }, db);
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => look(e, `a world number ${i} of candy`, "garden", `198.51.101.${i + 1}`)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(3);
    expect(results.filter((r) => r.status === 429)).toHaveLength(9);
    expect(budget(db).global).toBe(3);
  });
  it("a limit of 0 closes the door, and the budget is per UTC day (yesterday's rows do not count)", async () => {
    expect((await look(env({ WORLD_DAILY_GLOBAL: "0" }))).status).toBe(429);
    const db = sqlite();
    const e = env({ WORLD_DAILY_GLOBAL: "1" }, db);
    expect((await look(e)).status).toBe(200);
    db.sql.prepare("UPDATE world_budget SET day = '2000-01-01'").run();                                           // (the same rows, a day long gone)
    expect((await look(e)).status).toBe(200);
  });
  it("indoor looks have their own, five times bigger scopes and do not use up the outdoor budget", async () => {
    sparkAnswer = () => sparkJson(INDOOR);
    const db = sqlite();
    const e = env({ WORLD_DAILY_GLOBAL: "1", WORLD_DAILY_PER_IP: "1" }, db);
    const ip = "198.51.100.40";
    for (let i = 0; i < 5; i++) expect((await look(e, `a pirate room ${i}`, "room", ip)).status, `indoor ${i}`).toBe(200);
    expect((await look(e, "a pirate room 6", "room", ip)).status).toBe(429);
    sparkAnswer = () => sparkJson(OUTDOOR);
    expect((await look(e, "a candy forest", "garden", ip)).status).toBe(200);                                     // (the outdoor unit is still there)
  });
  it("no database: an outdoor look is refused (nothing can be counted, so no image money is ever spent) but an indoor look still works", async () => {
    const res = await look(env({}, null));
    expect(res.status).toBe(429);
    expect(await asJson(res)).toEqual({ ok: false, status: "daily-limit" });
    sparkAnswer = () => sparkJson(INDOOR);
    expect((await asJson(await look(env({}, null), "my pirate bedroom", "room"))).ok).toBe(true);
  });
  it("a database that errors closes the door (it never opens it)", async () => {
    const broken: D1Like = { prepare: () => ({ bind: () => ({ run: async () => { throw new Error("D1 is down"); }, all: async () => ({ results: [] }) }) }) };
    expect((await look(env({}, broken))).status).toBe(429);
    expect(sparkCalls()).toHaveLength(0);
  });
  it("housekeeping: with a ctx, budget rows older than two days and redemption counts older than one day are deleted, today's stay", async () => {
    const db = sqlite();
    const e = env({}, db);
    await look(e);                                                                                                // (creates the tables)
    db.sql.prepare("INSERT INTO world_budget (day, scope, count) VALUES ('2000-01-01', 'old', 4), (?, 'recent', 4)").run(utcDay(Date.now() - 86_400_000));
    db.sql.prepare("INSERT INTO world_art_redeem (h, day, n) VALUES ('old', '2000-01-01', 2), ('today', ?, 1)").run(utcDay(Date.now()));
    const waits: Promise<unknown>[] = [];
    await look(e, "a candy forest", "garden", freshIp(), { waitUntil: (p) => void waits.push(p) });
    await Promise.all(waits);
    expect(db.rows("world_budget").map((r) => r.scope)).not.toContain("old");
    expect(db.rows("world_budget").map((r) => r.scope)).toContain("recent");
    expect(db.rows("world_art_redeem").map((r) => r.h)).toEqual(["today"]);
  });
  it("giving a unit back never takes a scope below zero (a double give-back cannot hand out free worlds), and takeUnits is all or nothing", async () => {
    const db = sqlite();
    const day = "2026-11-04";
    expect(await takeUnit(db, day, "s", 2)).toBe(true);
    await giveUnitBack(db, day, "s");
    await giveUnitBack(db, day, "s");
    await giveUnitBack(db, day, "never-taken");
    expect(db.rows("world_budget").filter((r) => r.scope === "s").map((r) => r.count)).toEqual([0]);
    expect(await takeUnit(db, day, "s", 2)).toBe(true);
    expect(await takeUnit(db, day, "s", 2)).toBe(true);
    expect(await takeUnit(db, day, "s", 2)).toBe(false);                                                          // (two units, not three: the double give-back did not add a free one)
    expect(await takeUnits(db, day, [{ scope: "a", limit: 5 }, { scope: "full", limit: 0 }, { scope: "b", limit: 5 }])).toBe(false);
    expect(Object.fromEntries(db.rows("world_budget").map((r) => [r.scope, r.count]))).toMatchObject({ a: 0 });    // (a was taken, then given back; b was never reached)
    expect(db.rows("world_budget").map((r) => r.scope)).not.toContain("b");
  });
  it("secondsToReset is the time to the next UTC midnight, never under a minute", () => {
    expect(secondsToReset(Date.parse("2026-11-04T12:00:00Z"))).toBe(12 * 3600);
    expect(secondsToReset(Date.parse("2026-11-04T23:59:59Z"))).toBe(60);
    expect(utcDay(Date.parse("2026-11-04T23:59:59Z"))).toBe("2026-11-04");
  });
});

describe("POST /api/world/art", () => {
  // (A ticket is its sentence and its expiry in milliseconds, so two tickets for the same constant test sentence issued in the SAME millisecond are the identical string and share one redemption counter, which made the
  // "each case needs its own ticket" tests flaky (a 409 on the third). Real tickets carry the model's own words and cannot collide; here each issue waits until the clock has moved on.)
  let lastIssueMs = 0;
  const issue = async (e: WorldLookEnv) => {
    while (Date.now() <= lastIssueMs) await new Promise((r) => setTimeout(r, 1));
    lastIssueMs = Date.now();
    return (await asJson(await look(e))).art as { farDay: string; farNight: string; mid: string };
  };

  it("refuses anything that is not a POST with a JSON ticket string", async () => {
    const e = env();
    expect((await handleWorldArt(new Request("http://local/api/world/art"), e)).status).toBe(405);
    expect((await handleWorldArt(new Request("http://local/api/world/art", { method: "POST", headers: { "content-type": "text/plain" }, body: "x" }), e)).status).toBe(415);
    expect((await handleWorldArt(new Request("http://local/api/world/art", { method: "POST", headers: { "content-type": "application/json" }, body: "{nope" }), e)).status).toBe(400);
    expect((await handleWorldArt(new Request("http://local/api/world/art", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticket: "x".repeat(9000) }) }), e)).status).toBe(413);
    for (const t of [undefined, "", 5, null, {}, []]) expect((await art(e, t)).status, JSON.stringify(t)).toBe(422);
    expect(imageCalls()).toHaveLength(0);
  });
  it("a forged, tampered, expired or other-secret ticket is 403 'not signed' and the image service is never called", async () => {
    const e = env();
    const t = await issue(e);
    const [body, sig] = t.farDay.split(".") as [string, string];
    const flip = (s: string) => s.slice(0, -1) + (s.endsWith("A") ? "B" : "A");
    const forged = btoa(JSON.stringify({ k: "far", look: "day", s: "A tall dark tower in a scary valley far away", exp: Date.now() + 60_000 })).replace(/=+$/, "");
    const expired = await signTicket(SECRET, { k: "mid", s: OUTDOOR.mid, exp: Date.now() - 1 });
    const other = await signTicket("another-secret-another-secret-0000", { k: "mid", s: OUTDOOR.mid, exp: Date.now() + 60_000 });
    for (const bad of ["garbage", `${body}.${flip(sig)}`, `${flip(body)}.${sig}`, `${forged}.${sig}`, expired, other, `${body}.`, `.${sig}`]) {
      const res = await art(e, bad);
      expect(res.status, bad.slice(0, 30)).toBe(403);
      expect(await asJson(res)).toEqual({ error: "not signed" });
    }
    expect(imageCalls()).toHaveLength(0);
  });
  it("a good far ticket and a good mid ticket paint EXACTLY farPrompt / midPrompt of the ticket's own sentence, 8:1, one image, and return the raw image", async () => {
    const e = env();
    const t = await issue(e);
    for (const [ticket, kind, prompt] of [[t.farDay, "far-day", farPrompt(OUTDOOR.far, "day")], [t.farNight, "far-night", farPrompt(OUTDOOR.far, "night")], [t.mid, "mid", midPrompt(OUTDOOR.mid)]] as const) {
      const res = await art(e, ticket);
      expect(res.status, kind).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/webp");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("x-art-kind")).toBe(kind);
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(IMG);
      const sent = imageCalls().at(-1)!;
      expect(sent.body).toEqual({ model: "muse-image-1.0", prompt, n: 1, size: IMAGE_SIZE, response_format: "b64_json" });
      expect(sent.auth).toBe(`Bearer ${KEY}`);
    }
    expect(imageCalls()).toHaveLength(3);
  });
  it("NO client-supplied text reaches the image model: extra fields in the body are ignored, only the ticket's sentence is painted", async () => {
    const e = env();
    const t = await issue(e);
    await art(e, t.mid, { prompt: "INJECTED-PROMPT", s: "INJECTED-SENTENCE", look: "night", k: "far", text: "INJECTED-TEXT", sentence: "INJECTED-SENTENCE-2" });
    const sent = JSON.stringify(imageCalls()[0]!.body);
    expect(sent).not.toMatch(/INJECTED/);
    expect(imageCalls()[0]!.body!.prompt).toBe(midPrompt(OUTDOOR.mid));
  });
  it("a ticket paints at most twice (the first call and one retry): the third is refused 409 and never reaches the service, and only a hash of the ticket is stored", async () => {
    const db = sqlite();
    const e = env({}, db);
    const t = await issue(e);
    expect(REDEEM_MAX).toBe(2);
    expect((await art(e, t.mid)).status).toBe(200);
    expect((await art(e, t.mid)).status).toBe(200);
    const third = await art(e, t.mid);
    expect(third.status).toBe(409);
    expect(await asJson(third)).toEqual({ ok: false, status: "ticket-used" });
    expect(imageCalls()).toHaveLength(2);
    expect((await art(e, t.farDay)).status).toBe(200);                                                            // (another ticket is its own count)
    const rows = db.rows("world_art_redeem");
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => /^[0-9a-f]{64}$/.test(String(r.h)))).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(t.mid.slice(0, 20));
  });
  it("two redemptions racing for the second use of a ticket cannot both get a third", async () => {
    const e = env();
    const t = await issue(e);
    const results = await Promise.all(Array.from({ length: 6 }, () => art(e, t.mid)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(2);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);
    expect(imageCalls()).toHaveLength(2);
  });
  it("a failing image service is 502 art-failed: an HTTP error, a network error, no image in the answer, an unreadable answer, bytes that are not an image", async () => {
    const e = env();
    const t = await issue(e);
    const cases: [string, () => Response | never][] = [
      ["HTTP 500", () => new Response("boom", { status: 500 })],
      ["HTTP 429", () => new Response("slow", { status: 429 })],
      ["a network error", () => { throw new TypeError("fetch failed"); }],
      ["no image", () => new Response(JSON.stringify({ data: [] }), { status: 200 })],
      ["not JSON", () => new Response("<html>", { status: 200 })],
      ["not an image", () => new Response(JSON.stringify({ data: [{ b64_json: btoa("x".repeat(400)) }] }), { status: 200 })],
      ["not base64", () => new Response(JSON.stringify({ data: [{ b64_json: "!".repeat(400) }] }), { status: 200 })],
    ];
    // each case needs its own ticket (a ticket paints twice at most)
    for (const [name, answer] of cases) {
      const fresh = await issue(e);
      imageAnswer = answer;
      const res = await art(e, fresh.mid);
      expect(res.status, name).toBe(502);
      expect(await asJson(res)).toEqual({ ok: false, status: "art-failed" });
    }
    expect(t.mid).toBeTruthy();
  });
  it("is 503 not-configured with no signing key, no hosted image service or no database, and a service that answers PNG is passed through with its own type", async () => {
    const e = env();
    const t = await issue(e);
    expect((await art(env({ VOICE_SIGNING_KEY: undefined }), t.mid)).status).toBe(503);
    expect((await art(env({ IMAGE_BACKEND: "off" }), t.mid)).status).toBe(503);
    expect((await art(env({}, null), t.mid)).status).toBe(503);
    expect(imageCalls()).toHaveLength(0);
    const png = new Uint8Array(300).fill(1); png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    imageAnswer = () => new Response(JSON.stringify({ data: [{ b64_json: btoa(String.fromCharCode(...png)) }] }), { status: 200 });
    expect((await art(e, t.mid)).headers.get("content-type")).toBe("image/png");
  });
  it("never returns the prompt, the sentence, the keys or the ticket in an error", async () => {
    const e = env();
    const t = await issue(e);
    imageAnswer = () => new Response("upstream says: " + KEY, { status: 500 });
    for (const res of [await art(e, t.mid), await art(e, "garbage"), await art(env({ IMAGE_BACKEND: "off" }), t.farDay)]) {
      const text = await res.text();
      for (const leak of [SECRET, KEY, OUTDOOR.mid, OUTDOOR.far, t.mid, "PURE SOLID BLACK"]) expect(text).not.toContain(leak);
    }
  });
  it("sniffImage knows WebP, PNG and JPEG by their first bytes and nothing else", () => {
    expect(sniffImage(IMG)).toBe("image/webp");
    expect(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe("image/jpeg");
    expect(sniffImage(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 0]))).toBeNull();     // (a WAV is not an image)
    expect(sniffImage(new Uint8Array(0))).toBeNull();
    expect(sniffImage(new TextEncoder().encode("<html><body>"))).toBeNull();
  });
});

describe("a whole world, end to end", () => {
  it("a wish becomes a look, its three layers are painted, and the budget shows one world", async () => {
    const db = sqlite();
    const e = env({}, db);
    const out = await asJson(await look(e, "a candy forest at sunset"));
    const kinds: string[] = [];
    for (const ticket of [out.art.farDay, out.art.farNight, out.art.mid]) {
      const res = await art(e, ticket);
      expect(res.status).toBe(200);
      kinds.push(res.headers.get("x-art-kind")!);
    }
    expect(kinds).toEqual(["far-day", "far-night", "mid"]);
    expect(sparkCalls()).toHaveLength(1);
    expect(imageCalls()).toHaveLength(3);
    expect(budget(db)).toEqual({ ip: 1, global: 1 });
  });
});
