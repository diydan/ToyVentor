import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error a plain browser module (no types); its pure helper is exported so it can be tested here
import { readSongs } from "../parts/kip/viewer/kip-theme-song.js";

// The theme song card. Its behaviour in a real browser is covered by scripts/e2e-kip-theme-song.mjs (35 checks); this file holds the storage rules and the wiring.
const root = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const storeOf = (value: string | null | (() => never)) => ({ getItem: () => (typeof value === "function" ? value() : value) });
const song = (over: Record<string, unknown> = {}) => ({ name: "Stompy Big Buddy", url: "https://cdn.example/a.mp3", task: "1", ...over });

describe("My songs, kept in this browser", () => {
  it("reads a list, newest first, and drops anything that is not a song", () => {
    expect(readSongs(storeOf(JSON.stringify([song(), { name: 3, url: "x" }, null, "str", { name: "no url" }, song({ task: "2" })])))).toHaveLength(2);
  });
  it("is an empty list when storage is empty, blocked or damaged", () => {
    expect(readSongs(storeOf(null))).toEqual([]);
    expect(readSongs(storeOf("{not json"))).toEqual([]);
    expect(readSongs(storeOf('{"a":1}'))).toEqual([]);
    expect(readSongs(storeOf(() => { throw new Error("blocked"); }))).toEqual([]);
    expect(readSongs(undefined)).toEqual([]);
  });
  it("keeps at most twenty", () => {
    expect(readSongs(storeOf(JSON.stringify(Array.from({ length: 30 }, (_, i) => song({ task: String(i) })))))).toHaveLength(20);
  });
});

describe("the card is wired into the Describe & build tab", () => {
  const tab = read("parts/kip/viewer/kip-describe-tab.js");
  it("imports the card, starts it WITH the build (before the model is asked), never lets it stop a build, and quiets it when the panel closes", () => {
    expect(tab).toMatch(/import \{ createThemeSong \} from '\.\/kip-theme-song\.js'/);
    const build = tab.slice(tab.indexOf("async function build()"));
    expect(build.indexOf("theme?.start(q)")).toBeGreaterThan(0);
    expect(build.indexOf("theme?.start(q)")).toBeLessThan(build.indexOf("await ready()"));
    expect(build).toMatch(/theme\?\.start\(q\)\.catch\(/);
    expect(tab).toMatch(/stopVoice\(\); theme\?\.silence\(\);/);
    expect(tab).toMatch(/theme\?\.dispose\(\)/);
  });
  it("is off when themeUrl is empty, and on by default at the app's own route", () => {
    expect(tab).toContain("themeUrl = '/api/theme-song'");
    expect(tab).toMatch(/const theme = themeUrl \? createThemeSong/);
  });
  it("tells the grown-up in the settings text what the song route sends", () => {
    expect(tab).toMatch(/theme songs are switched on, the same description also goes to the app\\'s server to write a name and a song/);
  });
  it("is shipped: the Kip build copies it, the sync list names it, and the public copy is identical", () => {
    expect(read("scripts/build-kip.ts")).toContain('"viewer/kip-theme-song.js"');
    expect(read("parts/kip/viewer/tools/sync_public.mjs")).toContain("'kip-theme-song.js'");
    expect(readFileSync(join(root, "public/kip/kip-theme-song.js"))).toEqual(readFileSync(join(root, "parts/kip/viewer/kip-theme-song.js")));
    expect(readFileSync(join(root, "public/kip/kip-describe-tab.js"))).toEqual(readFileSync(join(root, "parts/kip/viewer/kip-describe-tab.js")));
  });
  it("the card sends nothing to a provider itself: only the app's own route", () => {
    const card = read("parts/kip/viewer/kip-theme-song.js");
    expect(card).not.toMatch(/mureka|api\.meta|authorization|MODEL_API_KEY/i);
    expect(card).toContain("url = '/api/theme-song'");
  });
});
