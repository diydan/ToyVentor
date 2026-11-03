// The household library build (parts/kip/household/build_household.py): the committed GLBs and catalog are exactly what a fresh build produces
// (so nobody edited a builder or the data and forgot to rebuild), the build is deterministic, and its checks catch deliberately broken items
// (tests/fixtures/household_canaries.py). Needs the partspec venv (manifold3d, numpy); skipped without it, like tests/forge/forge-ops.test.ts.
// The committed files themselves are read back as geometry in tests/household-catalog.test.ts.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
const DIR = join(ROOT, "public/kip/household");
const BUILD = join(ROOT, "parts/kip/household/build_household.py");
const CANARIES = join(ROOT, "tests/fixtures/household_canaries.py");

function resolvePython(): string | null {
  const local = resolve(ROOT, "parts/partspec/.venv/bin/python3");
  if (existsSync(local)) return local;
  try {
    const common = execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const shared = resolve(ROOT, common, "..", "parts/partspec/.venv/bin/python3");
    if (existsSync(shared)) return shared;
  } catch {
    // no shared checkout
  }
  return null;
}
const PYTHON = resolvePython();

const run = (script: string, args: string[]) => {
  const r = spawnSync(PYTHON!, [script, ...args], { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
};

describe.skipIf(!PYTHON)("household build", () => {
  const tmp = mkdtempSync(join(tmpdir(), "household-build-"));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it("is up to date: the committed GLBs and catalog are what a fresh build produces", () => {
    const r = run(BUILD, ["--check"]);
    expect(r.err).toBe("");
    expect(r.out).toContain("up to date");
    expect(r.code).toBe(0);
  }, 120_000);

  it("builds a chosen few items, byte for byte as the committed ones, and writes no catalog for a partial build", () => {
    const out = join(tmp, "few");
    const r = run(BUILD, ["--only", "ball,pencil", "--out", out]);
    expect(r.code).toBe(0);
    expect(readdirSync(out).sort()).toEqual(["ball.glb", "pencil.glb"]);
    for (const f of ["ball.glb", "pencil.glb"]) expect(readFileSync(join(out, f)).equals(readFileSync(join(DIR, f))), f).toBe(true);
  }, 120_000);

  it("refuses an item that does not exist, and writes nothing", () => {
    const out = join(tmp, "nosuch");
    const r = run(BUILD, ["--only", "ball,not_an_item", "--out", out]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("unknown item 'not_an_item'");
    expect(existsSync(out)).toBe(false);
  }, 120_000);

  describe("--check reports drift", () => {
    const copy = join(tmp, "copy");
    beforeAll(() => cpSync(DIR, copy, { recursive: true }));
    const fresh = () => {
      rmSync(copy, { recursive: true, force: true });
      cpSync(DIR, copy, { recursive: true });
    };

    it("passes an untouched copy", () => {
      fresh();
      expect(run(BUILD, ["--check", "--out", copy]).code).toBe(0);
    }, 120_000);

    it("catches a changed byte in a GLB", () => {
      fresh();
      const f = join(copy, "ball.glb");
      const b = readFileSync(f);
      b[b.length - 8] = (b[b.length - 8]! + 1) & 0xff;
      writeFileSync(f, b);
      const r = run(BUILD, ["--check", "--out", copy]);
      expect(r.code).toBe(1);
      expect(r.err).toContain("ball.glb differs from a fresh build");
    }, 120_000);

    it("catches a missing GLB", () => {
      fresh();
      rmSync(join(copy, "mug.glb"));
      const r = run(BUILD, ["--check", "--out", copy]);
      expect(r.code).toBe(1);
      expect(r.err).toContain("mug.glb is missing");
    }, 120_000);

    it("catches a GLB that is not in the catalog", () => {
      fresh();
      writeFileSync(join(copy, "stray.glb"), "x");
      const r = run(BUILD, ["--check", "--out", copy]);
      expect(r.code).toBe(1);
      expect(r.err).toContain("stray.glb is not in the catalog");
    }, 120_000);

    it("catches an edited catalog", () => {
      fresh();
      const f = join(copy, "catalog.json");
      writeFileSync(f, readFileSync(f, "utf8").replace('"label": "Ball"', '"label": "Big ball"'));
      const r = run(BUILD, ["--check", "--out", copy]);
      expect(r.code).toBe(1);
      expect(r.err).toContain("catalog.json differs from a fresh build");
    }, 120_000);
  });

  describe("its checks catch broken items", () => {
    let c: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    beforeAll(() => {
      const r = run(CANARIES, []);
      expect(r.code, r.err).toBe(0);
      c = JSON.parse(r.out);
    }, 120_000);

    it("passes a sound item", () => expect(c.good).toEqual([]));
    it("holds the spinning top by a blunt peg: nearly all of the shaft's footprint meets it, where a sharp point met under half", () => {
      expect(c.grip_spinning_top_mm3).toBeGreaterThan(60);
    });
    it("catches a part that floats free of the rest", () => expect(c.floating_piece).toEqual([expect.stringMatching(/2 separate pieces/)]));
    it("catches an item that is not on the floor", () => expect(c.off_the_floor.join("\n")).toMatch(/lowest point is z = 3/));
    it("catches an item of the wrong size", () => expect(c.wrong_size).toEqual([expect.stringMatching(/longest side is 20\.000 mm, not the prop size 40 mm/)]));
    it("catches a grip point that misses the item", () => expect(c.grip_miss).toEqual([expect.stringMatching(/shaft's footprint/)]));
    it("catches a grip point that only grazes the item", () => expect(c.grip_graze).toEqual([expect.stringMatching(/shaft's footprint/)]));
    it("catches an empty solid", () => expect(c.empty).toEqual([expect.stringMatching(/empty/)]));
    it("catches too many triangles", () => expect(c.over_triangle_budget).toEqual([expect.stringMatching(/ball: \d+ triangles, at most 100$/)]));
    it("catches too many bytes", () => expect(c.over_byte_budget).toEqual([expect.stringMatching(/ball: \d+ bytes, at most 1000$/)]));
    it("catches too many colour zones", () => expect(c.over_zone_budget).toEqual([expect.stringMatching(/2 colour zones, at most 1$/)]));
    it("catches a zone with no colour", () => expect(c.zone_not_coloured).toEqual([expect.stringMatching(/zones built \['body', 'stripe'\] but coloured \['body'\]/)]));
    it("catches a colour that is not #RRGGBB, including one with the right length and wrong digits", () => {
      expect(c.colour_not_hex).toEqual([expect.stringMatching(/'red' is not #RRGGBB/)]);
      expect(c.colour_bad_digits).toEqual([expect.stringMatching(/'#ZZZZZZ' is not #RRGGBB/)]);
    });
    it("catches a brand word", () => expect(c.brand_in_note).toEqual([expect.stringMatching(/brand term/)]));
    it("does not treat an item without a builder as an error", () => expect(c.unbuilt_item_is_not_an_error).toEqual([false, []]));
    it("counts a triangle that has no area in the file (a sliver the 16-bit grid collapses), and none in a sound mesh", () => {
      expect(c.glb_sound_mesh).toBe(0);
      expect(c.sliver_is_real_in_floats).toBeGreaterThan(1e-5); // it is not degenerate before quantising: only the file's own grid shows it
      expect(c.glb_sliver).toBeGreaterThanOrEqual(1);
    });
    it("refuses the first carrot (leaves touching edge on left two slivers) and accepts the one in the library", () => {
      expect(c.sliver_carrot.join("\n")).toMatch(/carrot: 2 triangle\(s\) with no area in the file/); // its open edges are reported too: both come from the same touching leaves
      expect(c.real_carrot).toEqual([]);
    });
    it("counts the edges that are open or pinched in the file: none in a cube or two properly overlapping cubes, some where cubes touch along a line or a triangle is missing", () => {
      expect(c.open_edges_one_cube).toBe(0);
      expect(c.open_edges_overlapping_cubes).toBe(0);
      expect(c.open_edges_touching_along_a_line).toBeGreaterThan(0);
      expect(c.open_edges_hole).toBeGreaterThan(0);
    });
    it("refuses the first board game (squares meeting at their corners pinch the surface) and accepts the one in the library", () => {
      expect(c.pinched_checkerboard).toEqual([expect.stringMatching(/board_game: \d+ edge\(s\) that are open or pinched in the file/)]);
      expect(c.real_board_game).toEqual([]);
    });
    it("catches triangles from a piece that was never tagged", () => {
      expect(c.untagged_pieces.length).toBeGreaterThan(0);
      for (const p of c.untagged_pieces) expect(p).toMatch(/untagged piece/);
    });
    it("makes the GLB writer refuse an empty zone, an unlisted zone, a repeated zone and a bad colour, and accept a good one", () => {
      expect(c.glb_empty_zone.raised).toMatch(/zone 'b' has no triangles/);
      expect(c.glb_unlisted_zone.raised).toMatch(/unlisted zones: \['c'\]/);
      expect(c.glb_duplicate_zone.raised).toMatch(/duplicate zone name/);
      expect(c.glb_bad_colour.raised).toMatch(/must be #RRGGBB/);
      expect(c.glb_ok.raised).toBeNull();
    });
  });
});
