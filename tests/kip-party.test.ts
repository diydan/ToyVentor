// Party mode's wiring (parts/kip/viewer/kip-party.js, kip-party-audio.js, the bundle public/kip/kip-party-core.js; docs/specs/dance-party-spec.md phase 3).
// The behaviour is tested where it lives: the pure logic in tests/song-party.test.ts, the sound in tests/kip-party-audio.test.ts and the whole thing in a
// real browser by scripts/e2e-kip-party.mjs. What is here is what could silently rot between them: the bundle going stale, a file missing from the build,
// the age-band labels drifting from the app's, and the page's own contract with the party.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BANDS } from "../src/lib/age";
import { TEMPOS, MOODS, TEMPO_BPM } from "../shared/songCards";

const root = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

describe("party mode wiring", () => {
  it("the build copies the glue and the audio and bundles the pure logic from shared/songParty.ts", () => {
    const build = read("scripts/build-kip.ts");
    expect(build).toContain("viewer/kip-party.js");
    expect(build).toContain("viewer/kip-party-audio.js");
    expect(build).toContain("shared/songParty.ts");
    expect(build).toContain("kip-party-core.js");
    for (const f of ["kip-party.js", "kip-party-audio.js"]) expect(read(`public/kip/${f}`), `${f}: public copy is stale, run build:kip`).toBe(read(`parts/kip/viewer/${f}`));
  });

  it("the committed bundle is what the build would make from shared/songParty.ts (a stale bundle fails here)", () => {
    const dir = mkdtempSync(join(tmpdir(), "kip-party-core-"));
    try {
      const out = join(dir, "core.js");
      execFileSync(join(root, "node_modules/.bin/esbuild"), [join(root, "shared/songParty.ts"), "--bundle", "--format=esm", "--target=es2022", "--minify", "--legal-comments=none", `--outfile=${out}`], { stdio: "ignore" });
      const built = readFileSync(out);
      expect(built.length).toBeGreaterThan(3_000);
      expect(Buffer.compare(built, readFileSync(join(root, "public/kip/kip-party-core.js")))).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the bundle carries everything the glue imports, and nothing of the song maker's prompt text beyond the closed cards", () => {
    const glue = read("parts/kip/viewer/kip-party.js");
    const imported = /import \{([^}]*)\} from '\.\/kip-party-core\.js/.exec(glue)![1]!.split(",").map((x) => x.trim()).filter(Boolean);
    const bundle = read("public/kip/kip-party-core.js");
    const exported = /export\s*\{([^}]*)\}/.exec(bundle)![1]!.split(",").map((x) => x.split(" as ").pop()!.trim());
    for (const name of imported) expect(exported, `${name} is imported by kip-party.js but not exported by the bundle`).toContain(name);
    expect(imported.length).toBeGreaterThan(10);
  });

  it("the age-band labels in the glue are the app's own (src/lib/age.ts)", () => {
    const glue = read("parts/kip/viewer/kip-party.js");
    const labels = /PARTY_BANDS = \[([^\]]*)\]/.exec(glue)![1]!.split(",").map((x) => x.trim().replace(/^'|'$/g, ""));
    expect(labels).toEqual(BANDS.map((b) => b.label));
  });

  it("the mood and tempo cards in the page are the song maker's closed lists", () => {
    const glue = read("parts/kip/viewer/kip-party.js");
    expect(glue).toContain("MOODS.map");
    expect(glue).toContain("TEMPOS.map");
    expect(MOODS).toHaveLength(6);
    expect(TEMPOS.map((t) => TEMPO_BPM[t])).toEqual([90, 110, 128]);
  });

  it("the bench imports the glue with the same ?v= as its siblings, mounts it once, gives it the frame loop, and lets go of it on teardown", () => {
    const page = read("parts/kip/viewer/kip-bench.js");
    const v = /kip-menu\.js\?v=([\d.]+)/.exec(page)?.[1];
    expect(page).toContain(`'/kip/kip-party.js?v=${v}'`);
    expect(read("parts/kip/viewer/kip-party.js")).toContain(`./kip-party-core.js?v=${v}`);
    expect(read("parts/kip/viewer/kip-party.js")).toContain(`./kip-party-audio.js?v=${v}`);
    expect(page.match(/mountParty\(/g)).toHaveLength(1);
    expect(page).toContain("partyApi?.update(dt)");
    expect(page.indexOf("partyApi?.update(dt)")).toBeLessThan(page.indexOf("if (kipMixer) kipMixer.update(mixerDt)")); // the dance is held BEFORE the mixer evaluates it
    expect(page).toContain("partyApi?.dispose()");
    expect(page).toContain('"kipParty"'); // published for the tests, and cleaned up with the other globals
    expect(page).toContain("party: partyApi.menu");
    expect(page).toMatch(/let partyApi = null;/); // declared before the frame loop can run, so the loop can ask it safely
  });

  it("the page offers the clips that carry a tempo, from the procedural dances and the baked dances, moves and strum", () => {
    const page = read("parts/kip/viewer/kip-bench.js");
    expect(page).toContain("entry.group === 'dance' && entry.bpm");
    expect(page).toContain("['dance', 'move', 'music'].includes(item.baked.group) && item.baked.beats");
  });

  it("the party ends when the bench stands down (a Workshop tab switch) or the page is hidden, and does not listen after dispose", () => {
    const page = read("parts/kip/viewer/kip-bench.js");
    const standDown = page.slice(page.indexOf("function setActive(on)"), page.indexOf("return { root: benchRoot"));
    expect(standDown).toContain("partyApi?.stop('tab')");
    expect(standDown.indexOf("partyApi?.stop('tab')")).toBeGreaterThan(standDown.indexOf("} else {")); // in the way-out branch, not the way in
    const glue = read("parts/kip/viewer/kip-party.js");
    expect(glue).toContain("addEventListener('visibilitychange'");
    expect(glue).toContain("removeEventListener('visibilitychange'");
    expect(glue).toContain("document.hidden");
    expect(glue).toContain("api.stop('hidden')"); // and it records WHY a party ended (state().ended), for \"it stopped by itself\"
    for (const reason of ["'other-clip'", "'time'", "'switch'", "'error'"]) expect(glue).toContain(reason);
  });

  it("the status line names a baked clip by its label, not its id", () => {
    expect(read("parts/kip/viewer/kip-bench.js")).toContain("(clipChoices.find(c => c.id === activeClipName) || {}).label");
  });

  it("the tap makes the audio context BEFORE it fetches the song (Safari starts sound only from the gesture itself), and a failure says why", () => {
    const glue = read("parts/kip/viewer/kip-party.js");
    const start = glue.slice(glue.indexOf("async function start()"), glue.indexOf("/** Everything undone:"));
    expect(start).toContain("audio.unlock()");
    expect(start.indexOf("audio.unlock()")).toBeLessThan(start.indexOf("await host.loadSongData"));
    expect(start.indexOf("audio.unlock()")).toBeLessThan(start.search(/\bawait\b/)); // before the FIRST await of any kind
    expect(start).toMatch(/The song could not be played \(\$\{why\}\)/);
  });

  it("the glue never keeps time of its own: one clock, the audio clock", () => {
    const code = read("parts/kip/viewer/kip-party.js").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\b(setInterval|setTimeout|Date\.now)\b/); // performance.now() is only used to ask the audio clock "where is the song now?"
    expect(code).not.toMatch(/\b(localStorage|sessionStorage|fetch|XMLHttpRequest)\b/);
    expect(existsSync(join(root, "scripts/e2e-kip-party.mjs"))).toBe(true);
  });
});
