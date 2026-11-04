// Every JavaScript module the site serves from public/kip, and its source in parts/kip/viewer, must PARSE.
// Why: on 2026-11-04 a commit put two object members outside their literal in kip-bench.js (`loadSongIndex: ...` after a closing `});`). The file is a plain browser
// module with no build step, so nothing failed at commit time: the unit tests import other files, and the type checker does not read public/. The Kip bench simply
// never loaded ("Could not load Kip"), for every commit until the next one fixed it. `node --check` parses a file as a module without running it.
import { execFile } from "node:child_process";
import { mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);
const root = resolve(__dirname, "..");
const flatJs = (dir: string) => readdirSync(dir).filter((n) => n.endsWith(".js") && statSync(join(dir, n)).isFile()).map((n) => join(dir, n));

/** The files that do not parse, with the first line of node's complaint. Eight at a time. */
async function syntaxErrors(files: string[]): Promise<string[]> {
  const bad: string[] = [];
  const queue = files.slice();
  const worker = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      try {
        await run(process.execPath, ["--check", f]);
      } catch (e: any) {
        const lines = String(e.stderr ?? e.message).split("\n").filter(Boolean);
        const shown = f.startsWith(root + sep) ? f.slice(root.length + 1) : f; // a file outside the repo (the control one, in the temp folder) keeps its whole path
        bad.push(`${shown}: ${lines.find((l) => /Error/.test(l)) ?? lines[0]}`);
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  return bad.sort();
}

describe("the modules the site serves parse", () => {
  it("control: a file with the mistake that broke the Kip bench is reported", async () => {
    const dir = mkdtempSync(join(tmpdir(), "syntax-control-"));
    const bad = join(dir, "bad.js");
    // as in the real mistake: two members after the closing `});`. One alone parses (it reads as a label), the second one's `:` is what fails.
    writeFileSync(bad, "const selfie = mount({\n  a: 1,\n});\n  loadSongIndex: async () => { return null; },\n  loadSongData: async (file) => {\n    return 1;\n  },\nglobals.x = selfie;\n");
    const good = join(dir, "good.js");
    writeFileSync(good, "export const ok = { loadSongData: async (file) => file };\n");
    const found = await syntaxErrors([bad, good]);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("bad.js");
  }, 30000);

  it("every .js file in public/kip (what is deployed) parses", async () => {
    const files = flatJs(join(root, "public/kip"));
    expect(files.length).toBeGreaterThan(30); // the folder is where it should be
    expect(await syntaxErrors(files)).toEqual([]);
  }, 120000);

  it("every .js file in parts/kip/viewer (their sources) parses", async () => {
    const files = flatJs(join(root, "parts/kip/viewer"));
    expect(files.length).toBeGreaterThan(30);
    expect(await syntaxErrors(files)).toEqual([]);
  }, 120000);
});
