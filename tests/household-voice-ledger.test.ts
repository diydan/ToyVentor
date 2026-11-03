// The household voice clips and their ledger (scripts/lib/household-voice-ledger.ts, src/lib/householdVoice.ledger.json, used by scripts/prewarm-voice.ts):
// which clips exist, what text each speaks, what a run should ask for. No network: a stub fetch plays the live /api/voice route.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  LEDGER_PATH, clipKey, emptyLedger, householdClips, isMade, missingClips, planClips, readLedger, serializeLedger, validateLedger, warmHousehold,
  type Ledger, type LedgerClip,
} from "../scripts/lib/household-voice-ledger";
import { HOUSEHOLD_IDS, HOUSEHOLD_NAMES, NAME_LANGS, householdTextHash, type NamesFile } from "../src/lib/householdNames";
import { DEFAULT_VOICE, VOICE_MODEL } from "../worker/voice";

const e = (w: string) => ({ w, source: "test", review: "unreviewed" as const });
const names = (): NamesFile => ({
  version: 1,
  pending: ["fr", "de", "it", "pt", "tr"],
  names: { spoon: { en: e("spoon"), es: e("cuchara") }, tool: { en: e("toy tool") }, banana: { en: e("banana"), es: e("plátano"), pt: e("banana") } },
});
const IDS = ["spoon", "tool", "banana"];
const NOW = () => new Date("2026-11-03T10:00:00Z");
const made = (text: string, over: Partial<LedgerClip> = {}): LedgerClip => ({ text, textHash: householdTextHash(text), status: "made", bytes: 100, audioSha256: "a".repeat(64), model: VOICE_MODEL, voice: DEFAULT_VOICE, date: "2026-11-01", ...over });
const audio = (n = 64) => new Uint8Array(Array.from({ length: n }, (_, i) => (i * 7) % 251));
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
function stubRoute(over: Partial<{ status: number; hit: boolean; voice: string | null; body: Uint8Array; throws: boolean }> = {}) {
  const urls: string[] = [];
  const fn = vi.fn(async (u: unknown) => {
    urls.push(String(u));
    if (over.throws) throw new Error("network down");
    const headers: Record<string, string> = { "x-voice-cache": over.hit ? "hit" : "miss" };
    if (over.voice !== null) headers["x-voice-voice"] = over.voice ?? "Puck";
    const body = over.status && over.status !== 200 ? JSON.stringify({ error: "SECRET-BODY-TEXT" }) : (over.body ?? audio());
    return new Response(body as unknown as BodyInit, { status: over.status ?? 200, headers }); // TS 5.9 does not count a Uint8Array<ArrayBufferLike> as a BodyInit
  });
  return { fn: fn as unknown as typeof fetch, urls, calls: fn };
}

describe("the clip list", () => {
  it("is one clip per (item, language) that has a name, with the route path a client would ask for, and counts the pairs that have none yet", () => {
    const { clips, withoutName } = householdClips(names(), IDS);
    // the fixture's English and Portuguese "banana" are spelled alike and are clips like any other: the language's lead-in tells the voice which is which
    expect(clips.map((c) => c.key).sort()).toEqual(["en/banana", "en/spoon", "en/tool", "es/banana", "es/spoon", "pt/banana"]);
    expect(withoutName).toBe(IDS.length * NAME_LANGS.length - clips.length);
    const spoon = clips.find((c) => c.key === "es/spoon")!;
    expect(spoon).toMatchObject({ id: "spoon", lang: "es", text: "cuchara", textHash: householdTextHash("cuchara") });
    expect(spoon.path).toBe(`/api/voice?lang=es&h=spoon&v=${householdTextHash("cuchara")}`);
  });
  it("covers the real file: every name in the file is a clip, and every clip path is the route's own key", () => {
    const { clips, withoutName } = householdClips();
    expect(clips.length + withoutName).toBe(HOUSEHOLD_IDS.length * NAME_LANGS.length);
    expect(clips.length, "every name in the file is a clip: 61 items x 7 languages, none left to the phone's voice").toBe(427);
    for (const c of clips) expect(HOUSEHOLD_NAMES.names[c.id]![c.lang]!.w, c.key).toBe(c.text);
    expect(new Set(clips.map((c) => c.path)).size).toBe(clips.length);
  });
});

describe("what a run asks for", () => {
  const { clips } = householdClips(names(), IDS);
  it("asks for everything when the ledger is empty", () => {
    const p = planClips(clips, emptyLedger());
    expect(p.todo).toHaveLength(clips.length);
    expect(p.skipped).toEqual([]);
  });
  it("skips a clip the ledger lists as made for the same text", () => {
    const ledger: Ledger = { version: 1, clips: { "es/spoon": made("cuchara"), "en/banana": made("banana") } };
    const p = planClips(clips, ledger);
    expect(p.skipped.map((c) => c.key).sort()).toEqual(["en/banana", "es/spoon"]);
    expect(p.todo).toHaveLength(clips.length - 2);
    expect(isMade(clips.find((c) => c.key === "es/spoon")!, ledger)).toBe(true);
  });
  it("asks again for a changed noun (the hash differs), a failure, and a new item", () => {
    const ledger: Ledger = { version: 1, clips: { "es/spoon": made("cucharón"), "en/spoon": made("spoon", { status: "failed", error: "HTTP 502" }), "en/banana": made("banana") } };
    const keys = planClips(clips, ledger).todo.map((c) => c.key);
    expect(keys).toContain("es/spoon"); // its text is "cuchara" now
    expect(keys).toContain("en/spoon"); // it failed
    expect(keys).toContain("en/tool"); // new
    expect(keys).not.toContain("en/banana");
  });
  it("asks for everything again with --force", () => {
    const ledger: Ledger = { version: 1, clips: Object.fromEntries(clips.map((c) => [c.key, made(c.text)])) };
    expect(planClips(clips, ledger).todo).toEqual([]);
    expect(planClips(clips, ledger, { force: true }).todo).toHaveLength(clips.length);
  });
  it("--missing lists what a run would ask for, nothing else", () => {
    const ledger: Ledger = { version: 1, clips: { "es/spoon": made("cuchara") } };
    expect(missingClips(clips, ledger).map((c) => c.key)).toEqual(planClips(clips, ledger).todo.map((c) => c.key));
    expect(missingClips(clips, ledger).map((c) => c.key)).not.toContain("es/spoon");
  });
});

describe("warming the route and recording the ledger", () => {
  const { clips } = householdClips(names(), IDS);
  it("asks the route for each clip and records text, hash, size, the SHA-256 of the audio, model, voice and the day", async () => {
    const route = stubRoute();
    const r = await warmHousehold({ base: "https://toyventor.com", clips, ledger: emptyLedger(), fetchImpl: route.fn, now: NOW });
    expect(route.urls).toHaveLength(clips.length);
    expect(route.urls[0]!.startsWith("https://toyventor.com/api/voice?lang=")).toBe(true);
    expect(r.stats).toMatchObject({ made: clips.length, failed: 0, skipped: 0, alreadyCached: 0 });
    const c = r.ledger.clips["es/spoon"]!;
    expect(c).toEqual({ text: "cuchara", textHash: householdTextHash("cuchara"), status: "made", bytes: 64, audioSha256: sha(audio()), model: VOICE_MODEL, voice: "Puck", date: "2026-11-03" });
    expect(validateLedger(r.ledger, IDS)).toEqual([]);
  });
  it("records the default voice when the route does not say, and counts a cached clip as already cached", async () => {
    const r = await warmHousehold({ base: "https://x", clips: clips.slice(0, 1), ledger: emptyLedger(), fetchImpl: stubRoute({ voice: null, hit: true }).fn, now: NOW });
    expect(r.ledger.clips[clips[0]!.key]!.voice).toBe(DEFAULT_VOICE);
    expect(r.stats).toMatchObject({ alreadyCached: 1, made: 0 });
  });
  it("does not ask again for what the ledger says is made: a second run with the first run's ledger makes no request", async () => {
    const first = await warmHousehold({ base: "https://x", clips, ledger: emptyLedger(), fetchImpl: stubRoute().fn, now: NOW });
    const route = stubRoute();
    const second = await warmHousehold({ base: "https://x", clips, ledger: first.ledger, fetchImpl: route.fn, now: NOW });
    expect(route.calls).not.toHaveBeenCalled();
    expect(second.stats.skipped).toBe(clips.length);
    expect(second.ledger).toEqual(first.ledger);
  });
  it("asks for only the clip whose noun changed, and for a new item, and leaves the rest untouched", async () => {
    const first = await warmHousehold({ base: "https://x", clips, ledger: emptyLedger(), fetchImpl: stubRoute().fn, now: NOW });
    const file = names();
    file.names.spoon!.es = e("cucharón"); // a reviewer corrected it
    file.names.mug = { en: e("mug") }; // and a new item arrived
    const next = householdClips(file, [...IDS, "mug"]).clips;
    const route = stubRoute({ body: audio(10) });
    const r = await warmHousehold({ base: "https://x", clips: next, ledger: first.ledger, fetchImpl: route.fn, now: () => new Date("2026-12-01T00:00:00Z") });
    expect(route.urls.map((u) => new URL(u).searchParams.get("h") + "/" + new URL(u).searchParams.get("lang")).sort()).toEqual(["mug/en", "spoon/es"]);
    expect(r.ledger.clips["es/spoon"]!.text).toBe("cucharón");
    expect(r.ledger.clips["es/spoon"]!.date).toBe("2026-12-01");
    expect(r.ledger.clips["en/banana"]).toEqual(first.ledger.clips["en/banana"]); // untouched, even the date
  });
  it("--force asks for every clip again", async () => {
    const first = await warmHousehold({ base: "https://x", clips, ledger: emptyLedger(), fetchImpl: stubRoute().fn, now: NOW });
    const route = stubRoute();
    await warmHousehold({ base: "https://x", clips, ledger: first.ledger, fetchImpl: route.fn, force: true, now: NOW });
    expect(route.urls).toHaveLength(clips.length);
  });
  it("records a failure with its status only (never a response body), asks for it again next time, and keeps going", async () => {
    const r = await warmHousehold({ base: "https://x", clips, ledger: emptyLedger(), fetchImpl: stubRoute({ status: 502 }).fn, now: NOW });
    expect(r.stats.failed).toBe(clips.length);
    const c = r.ledger.clips["es/spoon"]!;
    expect(c).toMatchObject({ status: "failed", error: "HTTP 502" });
    expect(c.bytes).toBeUndefined();
    expect(serializeLedger(r.ledger)).not.toContain("SECRET-BODY-TEXT");
    expect(validateLedger(r.ledger, IDS)).toEqual([]);
    expect(planClips(clips, r.ledger).todo).toHaveLength(clips.length);
    expect(r.failures[0]).toMatch(/^502 \/api\/voice/);
  });
  it("records a network error and an empty answer as failures, not as made", async () => {
    const down = await warmHousehold({ base: "https://x", clips: clips.slice(0, 2), ledger: emptyLedger(), fetchImpl: stubRoute({ throws: true }).fn, now: NOW });
    expect(Object.values(down.ledger.clips).every((c) => c.status === "failed" && c.error === "network down")).toBe(true);
    const empty = await warmHousehold({ base: "https://x", clips: clips.slice(0, 1), ledger: emptyLedger(), fetchImpl: stubRoute({ body: new Uint8Array() }).fn, now: NOW });
    expect(empty.ledger.clips[clips[0]!.key]).toMatchObject({ status: "failed", error: "empty audio" });
  });
  it("a changed noun that then fails replaces the old made entry (the old clip is no longer the right one)", async () => {
    const first = await warmHousehold({ base: "https://x", clips, ledger: emptyLedger(), fetchImpl: stubRoute().fn, now: NOW });
    const file = names();
    file.names.spoon!.es = e("cucharón");
    const r = await warmHousehold({ base: "https://x", clips: householdClips(file, IDS).clips, ledger: first.ledger, fetchImpl: stubRoute({ status: 503 }).fn, now: NOW });
    expect(r.ledger.clips["es/spoon"]).toMatchObject({ status: "failed", text: "cucharón" });
  });
  it("gives the same ledger at any concurrency", async () => {
    const a = await warmHousehold({ base: "https://x", clips, ledger: emptyLedger(), fetchImpl: stubRoute().fn, concurrency: 1, now: NOW });
    const b = await warmHousehold({ base: "https://x", clips, ledger: emptyLedger(), fetchImpl: stubRoute().fn, concurrency: 6, now: NOW });
    expect(serializeLedger(a.ledger)).toBe(serializeLedger(b.ledger));
  });
});

describe("the ledger file", () => {
  it("is written sorted, one clip per line, reads back identically and is deterministic", () => {
    const l: Ledger = { version: 1, clips: { "pt/banana": made("banana"), "en/spoon": made("spoon"), "es/spoon": made("cuchara", { status: "failed", error: "HTTP 502", bytes: undefined, audioSha256: undefined }) } };
    const text = serializeLedger(l);
    expect(Object.keys(JSON.parse(text).clips)).toEqual(["en/spoon", "es/spoon", "pt/banana"]);
    expect(text.trim().split("\n")).toHaveLength(8); // five of structure and one line per clip
    expect(serializeLedger(JSON.parse(text) as Ledger)).toBe(text);
    expect(text.endsWith("}\n")).toBe(true);
  });
  it("the committed ledger is valid and exactly what the writer produces for it", () => {
    const l = readLedger();
    expect(validateLedger(l)).toEqual([]);
    expect(serializeLedger(l)).toBe(readFileSync(LEDGER_PATH, "utf8"));
    expect(l.version).toBe(1);
  });
  it("catches an unknown language or item, a hash that does not match its text, a made clip without its audio hash, a failure without a reason, a bad date", () => {
    const bad = (key: string, c: Partial<LedgerClip>) => validateLedger({ version: 1, clips: { [key]: { ...made("spoon"), ...c } } }, IDS).join("; ");
    expect(bad("xx/spoon", {})).toMatch(/not a known language and household item/);
    expect(bad("en/dragon", {})).toMatch(/not a known language/);
    expect(bad("en/spoon", { textHash: "00000000" })).toMatch(/textHash does not match/);
    expect(bad("en/spoon", { audioSha256: "nope" })).toMatch(/needs its bytes and the sha256/);
    expect(bad("en/spoon", { bytes: 0 })).toMatch(/needs its bytes/);
    expect(bad("en/spoon", { status: "failed", bytes: undefined, audioSha256: undefined })).toMatch(/failed clip needs a reason/);
    expect(bad("en/spoon", { date: "yesterday" })).toMatch(/YYYY-MM-DD/);
    expect(bad("en/spoon", { status: "broken" as never })).toMatch(/status broken/);
    expect(validateLedger({ version: 2 as never, clips: {} })).toEqual(["version 2 is not 1"]);
    expect(clipKey("pt", "banana")).toBe("pt/banana");
  });
});

describe("scripts/prewarm-voice.ts", () => {
  const run = (...args: string[]) => execFileSync("npx", ["tsx", "scripts/prewarm-voice.ts", ...args], { cwd: new URL("..", import.meta.url).pathname, encoding: "utf8", timeout: 120_000 });
  it("--list prints every household clip with the others, and --missing prints only what the ledger lacks (offline, no request)", () => {
    const { clips } = householdClips();
    const list = run("--list").split("\n");
    for (const c of clips) expect(list, c.key).toContain(c.path);
    const missing = run("--missing").split("\n");
    const lacking = missingClips(clips, readLedger());
    for (const c of lacking) expect(missing, c.key).toContain(c.path);
    expect(missing.filter((l) => l.startsWith("/api/voice?")).length).toBe(lacking.length);
    expect(missing.join("\n")).toMatch(new RegExp(`${lacking.length} household clip\\(s\\) the ledger lacks`));
  }, 120_000);
  it("--only limits it to the named household items (a sample to listen to) and refuses an id that is not one", () => {
    const out = run("--list", "--only", "banana,wooden_spoon");
    const lines = out.split("\n").filter((l) => l.startsWith("/api/voice?"));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(new URL(l, "https://x").searchParams.get("h")).toMatch(/^(banana|wooden_spoon)$/); // no props, no parts, no other items
    const miss = run("--missing", "--only", "banana").split("\n").filter((l) => l.startsWith("/api/voice?"));
    expect(miss.every((l) => new URL(l, "https://x").searchParams.get("h") === "banana")).toBe(true);
    expect(() => run("--list", "--only", "dragon")).toThrow(/unknown: dragon/);
  }, 120_000);
});
