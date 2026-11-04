import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error a plain browser module (no types); its pure helpers are exported so they can be tested here
import { readSongs, WAIT_STAGES as KIP_STAGES, waitStage as kipStage, waitProgress as kipProgress, cleanLines as kipClean, karaokeLine as kipKaraoke } from "../parts/kip/viewer/kip-theme-song.js";
import { WAIT_STAGES, waitProgress, waitStage } from "../src/features/game/world/songWait";
import { cleanLines, karaokeAt, lyricsForCut, parseLyricSections } from "../shared/songKaraoke";

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

describe("the card's animated wait and its karaoke match the game's song card (one behaviour, two plain files)", () => {
  it("says the same words at the same seconds, and fills the bar the same way", () => {
    expect(KIP_STAGES).toEqual(WAIT_STAGES);
    for (const sec of [-3, 0, 0.5, 7.9, 8, 17.99, 18, 30, 43, 44, 58, 90, Number.NaN]) {
      expect(kipStage(sec)).toBe(waitStage(sec));
      expect(kipProgress(sec)).toBeCloseTo(waitProgress(sec), 10);
    }
    expect(kipProgress(1e9)).toBeLessThan(1); // never full until the song is ready
    expect(kipProgress(5, true)).toBe(1);
  });
  const SECTIONS = [{ lines: [
    { start: 22600, end: 25280, text: "Little cat naps on warm hay", words: [{ start: 22600 }, { start: 23280 }, { start: 23640 }, { start: 23960 }, { start: 24320 }, { start: 24880 }] },
    { start: 27480, end: 30240, text: "Purring low till end of day" },
    { start: 40000, end: 42000, text: "Sing it again", words: [{ start: 40000 }, { start: 40700 }] }, // word marks that do not match the words
  ] }];
  it("reads the route's compact lines exactly as the game does, and drops the same junk", () => {
    const lines = parseLyricSections(SECTIONS);
    expect(kipClean(JSON.parse(JSON.stringify(lines)))).toEqual(lines);
    const junk = [{ s: 1, e: 2, t: "ok" }, { s: 5, e: 1, t: "backwards" }, { s: "x", e: 2, t: "str" }, { s: 0, e: 1, t: "   " }, { s: 3, e: 4, t: "a\u0000b  c", w: [3, 3.5] }, 7, null, "x", { s: 9, e: 9, t: "x".repeat(300) }];
    expect(kipClean(junk)).toEqual(cleanLines(junk));
    expect(kipClean("nope")).toEqual([]);
    expect(kipClean(Array.from({ length: 200 }, (_, i) => ({ s: i, e: i + 1, t: `l${i}` })))).toHaveLength(80);
  });
  it("lights the same line and the same number of words at every moment of the song", () => {
    const lines = parseLyricSections(SECTIONS);
    const whole = lyricsForCut(lines, 0, 600); // the whole song, no loop: seconds on the song's own timeline
    for (let ms = 0; ms <= 43000; ms += 137) {
      const k = kipKaraoke(lines, ms);
      const g = karaokeAt(whole, ms / 1000, 0);
      expect(k?.index ?? -1, `line at ${ms} ms`).toBe(g.index);
      if (g.index >= 0) { expect(k!.lit, `lit at ${ms} ms`).toBe(g.lit); expect(k!.words.join(" ")).toBe(g.line!.text); }
    }
  });
  it("has no karaoke for a song with no times, and shows the next line only when it is close", () => {
    expect(kipKaraoke([], 5000)).toBeNull();
    expect(kipKaraoke(undefined, 5000)).toBeNull();
    expect(kipKaraoke(parseLyricSections(SECTIONS), Number.NaN)).toBeNull();
    const lines = parseLyricSections(SECTIONS);
    expect(kipKaraoke(lines, 1000)!.next).toBe(""); // the first line is 21 s away
    expect(kipKaraoke(lines, 17000)!.next).toBe("Little cat naps on warm hay"); // 5.6 s away
  });
  it("is wired: the card keeps the times with the kept song, shows the waiting display, stops both when it is cancelled, and respects reduced motion", () => {
    const card = read("parts/kip/viewer/kip-theme-song.js");
    expect(card).toMatch(/ready\(answer\.url, answer\.durationMs, cleanLines\(answer\.lines\)\)/);
    expect(card).toMatch(/\.\.\.\(timed\.length \? \{ lines: timed \} : \{\}\)/);
    expect(card).toMatch(/cancel\(\) \{ run\+\+; clearTimer\(\); stopAudio\(\); stopWait\(\);/);
    expect(card).toMatch(/dispose\(\) \{ run\+\+; clearTimer\(\); stopAudio\(\); stopWait\(\);/);
    expect(card).toMatch(/prefers-reduced-motion: reduce\) \{ \.kts-eq i \{ animation: none;/);
    expect(card).toContain("if (kind === 'song') startKara();");
  });
});
