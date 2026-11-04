import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { quotaLine, sheetMode } from "../src/features/game/world/SongStudioSheet";

// src/lib/songSettings.ts reads the device id from localStorage; give it one.
beforeEach(() => {
  const store = new Map<string, string>([["toyforge:device:v1", "dev-1234567890"]]);
  vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } });
});
const lib = async () => import("../src/lib/songSettings");

interface Call { url: string; method: string; headers: Record<string, string>; body?: string }
function fakeFetch(answers: Record<string, { status: number; body: unknown } | "throw">) {
  const calls: Call[] = [];
  const fn = (async (input: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const key = `${method} ${input}`;
    calls.push({ url: String(input), method, headers: (init?.headers ?? {}) as Record<string, string>, ...(init?.body ? { body: String(init.body) } : {}) });
    const a = answers[key];
    if (!a) throw new Error(`unexpected ${key}`);
    if (a === "throw") throw new Error("offline");
    return new Response(JSON.stringify(a.body), { status: a.status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const WEEK = { limit: 5, used: 1, left: 4, resetsOn: "2026-11-09", makerOn: true };

describe("the headers every song request carries", () => {
  it("are the device and the family's clock, plus the parent proof only when there is a real one", async () => {
    const { songHeaders } = await lib();
    expect(songHeaders()).toMatchObject({ "x-device-id": "dev-1234567890", "content-type": "application/json" });
    expect(songHeaders()["x-client-timezone"]).toBeTruthy();
    expect(songHeaders()["x-parent-proof"]).toBeUndefined();
    expect(songHeaders("local-proof")["x-parent-proof"]).toBeUndefined();
    expect(songHeaders("real.proof.token")["x-parent-proof"]).toBe("real.proof.token");
  });
});

describe("loading the settings", () => {
  it("probes first and reads the settings only when the route is on", async () => {
    const { loadSongSettings } = await lib();
    const f = fakeFetch({ "GET /api/theme-song": { status: 200, body: { enabled: true } }, "GET /api/theme-song/settings": { status: 200, body: { settings: { makerOn: false, limit: 3 }, quota: { ...WEEK, makerOn: false } } } });
    expect(await loadSongSettings(f.fn)).toEqual({ ok: true, settings: { makerOn: false, limit: 3 }, week: { ...WEEK, makerOn: false } });
    expect(f.calls.map((c) => c.url)).toEqual(["/api/theme-song", "/api/theme-song/settings"]);
    expect(f.calls[0]!.headers["x-device-id"]).toBe("dev-1234567890");
  });
  it("is 'absent' (the panel hides) when the route is off or unmetered, and 'offline' when it cannot be reached or answers nonsense", async () => {
    const { loadSongSettings } = await lib();
    expect(await loadSongSettings(fakeFetch({ "GET /api/theme-song": { status: 200, body: { enabled: false } } }).fn)).toEqual({ ok: false, reason: "absent" });
    expect(await loadSongSettings(fakeFetch({ "GET /api/theme-song": { status: 200, body: { enabled: true } }, "GET /api/theme-song/settings": { status: 501, body: {} } }).fn)).toEqual({ ok: false, reason: "absent" });
    expect(await loadSongSettings(fakeFetch({ "GET /api/theme-song": "throw" }).fn)).toEqual({ ok: false, reason: "offline" });
    expect(await loadSongSettings(fakeFetch({ "GET /api/theme-song": { status: 200, body: { enabled: true } }, "GET /api/theme-song/settings": { status: 200, body: { settings: { makerOn: "yes", limit: 99 } } } }).fn)).toEqual({ ok: false, reason: "offline" });
  });
});

describe("saving a change", () => {
  it("sends only what changed, with the proof, and returns what the Worker stored", async () => {
    const { saveSongSettings } = await lib();
    const f = fakeFetch({ "POST /api/theme-song/settings": { status: 200, body: { settings: { makerOn: true, limit: 2 }, quota: { ...WEEK, limit: 2, left: 1 } } } });
    expect(await saveSongSettings({ limit: 2 }, "real.proof.token", f.fn)).toEqual({ ok: true, settings: { makerOn: true, limit: 2 }, week: { ...WEEK, limit: 2, left: 1 } });
    expect(JSON.parse(f.calls[0]!.body!)).toEqual({ limit: 2 });
    expect(f.calls[0]!.headers["x-parent-proof"]).toBe("real.proof.token");
  });
  it("never sends a bad value, nothing to change, or the local-only unlock (it would only be refused)", async () => {
    const { saveSongSettings } = await lib();
    const f = fakeFetch({});
    for (const bad of [{ limit: 6 }, { limit: -1 }, { limit: 1.5 }, { makerOn: "no" as never }, {}]) expect(await saveSongSettings(bad, "p", f.fn), JSON.stringify(bad)).toEqual({ ok: false, reason: "invalid" });
    expect(await saveSongSettings({ limit: 1 }, "local-proof", f.fn)).toEqual({ ok: false, reason: "gate" });
    expect(await saveSongSettings({ limit: 1 }, "", f.fn)).toEqual({ ok: false, reason: "gate" });
    expect(f.calls).toHaveLength(0);
  });
  it("maps the Worker's answers: 401 gate, 422 invalid, 501 absent, anything else offline", async () => {
    const { saveSongSettings } = await lib();
    for (const [status, reason] of [[401, "gate"], [422, "invalid"], [501, "absent"], [500, "offline"], [503, "offline"]] as const) {
      expect(await saveSongSettings({ makerOn: false }, "p", fakeFetch({ "POST /api/theme-song/settings": { status, body: {} } }).fn), String(status)).toEqual({ ok: false, reason });
    }
    expect(await saveSongSettings({ makerOn: false }, "p", fakeFetch({ "POST /api/theme-song/settings": "throw" }).fn)).toEqual({ ok: false, reason: "offline" });
  });
});

describe("what the Songs sheet says about the week", () => {
  const Q = { limit: 5, used: 2, left: 3, resetsOn: "2026-11-09", makerOn: true };
  it("counts the songs left with notes, in the singular and plural", () => {
    expect(quotaLine(Q)).toMatchObject({ blocked: false, text: expect.stringContaining("3 new songs left this week") });
    expect(quotaLine({ ...Q, left: 1 }).text).toContain("1 new song left this week");
    expect(quotaLine({ ...Q, left: 1 }).text).not.toContain("songs left");
  });
  it("blocks making when the week is used up or a grown-up switched songs off, and says so kindly", () => {
    expect(quotaLine({ ...Q, used: 5, left: 0 })).toEqual({ blocked: true, text: "No new songs until Monday. Dance to the ones you made!" });
    expect(quotaLine({ ...Q, makerOn: false })).toMatchObject({ blocked: true, text: expect.stringContaining("switched off by a grown-up") });
  });
  it("says nothing about a quota it does not know", () => {
    expect(quotaLine(null).blocked).toBe(false);
    expect(quotaLine(undefined).text).toMatch(/made by AI/);
  });
});

describe("what the Songs sheet says while it waits, and when songs are really off", () => {
  const Q = { limit: 5, used: 0, left: 5, resetsOn: "2026-11-09", makerOn: true };
  it("says 'checking' until the route has answered: it never claims songs are resting before anyone has said so", () => {
    expect(sheetMode(null, null)).toMatchObject({ mode: "checking", text: expect.stringMatching(/Checking/) });
    expect(sheetMode(null, Q).text).not.toMatch(/resting/);
  });
  it("says 'resting' only when the route says songs are off or cannot be reached", () => {
    expect(sheetMode(false, null)).toMatchObject({ mode: "resting", text: expect.stringMatching(/resting/) });
    expect(sheetMode(false, Q).mode).toBe("resting");
  });
  it("is open when songs are on with a song left (or no quota to speak of), and blocked, with its own words, when the week is used or a grown-up switched songs off", () => {
    expect(sheetMode(true, Q).mode).toBe("open");
    expect(sheetMode(true, null).mode).toBe("open");
    expect(sheetMode(true, { ...Q, used: 5, left: 0 })).toMatchObject({ mode: "blocked", text: expect.stringMatching(/until Monday/) });
    expect(sheetMode(true, { ...Q, makerOn: false })).toMatchObject({ mode: "blocked", text: expect.stringMatching(/switched off by a grown-up/) });
  });
});

describe("the Grown-ups sheet carries the Songs section", () => {
  const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8");
  it("renders the panel with the sheet's own parent proof, and the panel hides itself when there is nothing to set", () => {
    expect(read("src/features/game/world/GrownUpsSheet.tsx")).toContain("<SongSettingsPanel proof={activeProof} />");
    const panel = read("src/features/game/world/SongSettingsPanel.tsx");
    expect(panel).toContain("if (absent) return null;");
    expect(panel).toContain('aria-label="Fewer songs a week"');
    expect(panel).toContain('aria-label="More songs a week"');
    expect(panel).not.toMatch(/mureka|api\.meta/i);
  });
  it("is a closed group like the sheet's others: the summary says where it stands, one tap opens the controls", () => {
    const panel = read("src/features/game/world/SongSettingsPanel.tsx");
    expect(panel).toContain('<details className="tv-disclosure" data-testid="song-settings">');
    expect(panel).not.toMatch(/<details[^>]*\sopen[\s={>]/);
    expect(panel).toMatch(/<summary>[\s\S]{0,120}<span>Songs<\/span>[\s\S]{0,120}tv-disclosure-meta[\s\S]{0,200}makerOn \? "Maker on" : "Maker off"[\s\S]{0,60}settings\.limit\} a week/);
    // the controls are inside the group
    const inside = panel.slice(panel.indexOf('<div className="tv-parent-adv">'), panel.indexOf("</details>"));
    for (const needle of ["Song maker: On", 'aria-label="Fewer songs a week"', 'aria-label="More songs a week"', 'data-testid="song-limit"']) expect(inside).toContain(needle);
  });
});
