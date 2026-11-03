import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// "My songs": a child's own theme songs in the dance party. The behaviour is covered in a real browser by scripts/e2e-kip-my-songs.mjs (26 checks: measured, offered,
// danced to, remembered, refused, missing audio) and the pure parts by tests/theme-party.test.ts; this file holds the wiring.
const root = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

describe("My songs is wired into the bench", () => {
  const bench = read("parts/kip/viewer/kip-bench.js");
  it("imports the glue, adds the child's songs to the starter index, and maps my_ names to the page's own cut", () => {
    expect(bench).toMatch(/import \{ createMySongs \} from '\/kip\/kip-my-songs\.js\?v=10\.0'/);
    expect(bench).toMatch(/const mySongs = createMySongs\(\{ onChange: \(\) => \{ partyApi\?\.refreshSongs\?\.\(\); \} \}\)/);
    expect(bench).toMatch(/const mine = mySongs\.entries\(\)/);
    expect(bench).toMatch(/if \(String\(file\)\.startsWith\('my_'\)\) return mySongs\.data\(file\)/);
  });
  it("measures a song the moment the Describe card keeps it, and catches up on older ones in the background", () => {
    expect(bench).toMatch(/themeOptions: \{ onSong: song => mySongs\.add\(song\) \}/);
    expect(bench).toMatch(/mySongs\.catchUp\(\)\.catch\(/);
  });
  it("still serves the starter library from its own folder for every other name", () => {
    expect(bench).toMatch(/fetch\(`\/kip\/songs\/\$\{encodeURIComponent\(file\)\}`\)/);
    expect(bench).toMatch(/fetch\('\/kip\/songs\/index\.json'\)/);
  });
});

describe("the party can re-read its songs and labels the child's own", () => {
  const party = read("parts/kip/viewer/kip-party.js");
  it("refreshSongs asks the host again and checks the index with the same checker; a failure keeps the list", () => {
    expect(party).toMatch(/async refreshSongs\(\) \{\s*try \{ const raw = host\.loadSongIndex \? await host\.loadSongIndex\(\) : null; if \(raw\) st\.songs = parseSongIndex\(raw\)\.songs; \} catch/);
  });
  it("calls a my_ song 'My song' in the picker", () => {
    expect(party).toContain("x.id.startsWith('my_') ? 'My song' : cap(x.mood)");
  });
});

describe("the glue sends nothing to a provider and reads only the app's own route", () => {
  const mine = read("parts/kip/viewer/kip-my-songs.js");
  it("fetches audio only from /api/theme-song, and only for a numeric task", () => {
    expect(mine).toContain("/api/theme-song?id=${encodeURIComponent(task)}&audio=1");
    expect(mine).toMatch(/\^\\d\{6,24\}\$/);
    expect(mine).not.toMatch(/mureka\.ai|api\.meta|authorization|MODEL_API_KEY/i);
  });
  it("accepts only my_<digits>.mp3 as a name to cut, never a path", () => {
    expect(mine).toContain("/^my_(\\d{6,24})\\.mp3$/");
  });
});

describe("it is shipped", () => {
  it("the Kip build bundles the theme core and copies the glue; the sync list names the glue", () => {
    const build = read("scripts/build-kip.ts");
    expect(build).toContain('join(root, "shared/themeParty.ts")');
    expect(build).toContain('"kip-theme-core.js"');
    expect(build).toContain('"viewer/kip-my-songs.js"');
    expect(read("parts/kip/viewer/tools/sync_public.mjs")).toContain("'kip-my-songs.js'");
  });
  it("the public copies of the viewer files are identical to their sources", () => {
    for (const f of ["kip-my-songs.js", "kip-theme-song.js", "kip-party.js", "kip-describe-tab.js", "kip-bench.js"]) {
      expect(readFileSync(join(root, "public/kip", f)), f).toEqual(readFileSync(join(root, "parts/kip/viewer", f)));
    }
  });
  it("the bundled theme core exports what the glue imports", () => {
    const core = read("public/kip/kip-theme-core.js");
    for (const name of ["analyseTheme", "cutToWav", "themeIndexEntry", "themeSongId"]) expect(core, name).toContain(name);
  });
  it("the viewer files are scanned for brand terms with the others", () => {
    expect(read("tests/kip.test.ts")).toContain('"parts/kip/viewer/kip-theme-song.js"');
  });
});
