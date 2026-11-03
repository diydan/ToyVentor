// Recipe v1 feature ops (ears, horns, spikes, snout, brim) through the real optimizer daemon and its gates.
// Spawns scripts/forge_optimizer_daemon.py on an ephemeral loopback port, so it needs the partspec venv
// and is skipped without it, the same as tests/parts-asset-optimization.test.ts.
import { type ChildProcessByStdio, execFileSync, spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");

function resolvePython(): string | null {
  const local = resolve(ROOT, "parts/partspec/.venv/bin/python3");
  if (existsSync(local)) return local;
  try {
    const common = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const shared = resolve(ROOT, common, "..", "parts/partspec/.venv/bin/python3");
    if (existsSync(shared)) return shared;
  } catch {
    // no shared checkout
  }
  return null;
}
const PYTHON = resolvePython();

const HELMET = [
  { z: 0, w: 23.8, d: 11.6, r: 4 },
  { z: 6, w: 24, d: 12, r: 4 },
  { z: 14, w: 20, d: 11, r: 4 },
  { z: 18, w: 14, d: 9, r: 3 },
];
const HAT = [
  { z: 0, w: 23.8, d: 11.6, r: 4 },
  { z: 5, w: 22, d: 11, r: 4 },
  { z: 14, w: 18, d: 10, r: 4 },
  { z: 20, w: 16, d: 9, r: 3 },
];
const HEAD = [
  { z: 0, w: 24.6, d: 12.1, r: 4 },
  { z: 8, w: 26, d: 12, r: 5 },
  { z: 22, w: 26, d: 12, r: 5 },
  { z: 30.5, w: 24, d: 11.5, r: 4.5 },
];
// A round head that flares well out from the collar: the wall leans and the corners are far back,
// which is where a snout's root spheres used to hang off the head.
const WIDE_HEAD = [
  { z: 0, w: 24.6, d: 12.1, r: 4 },
  { z: 10, w: 34, d: 22, r: 8 },
  { z: 22, w: 34, d: 22, r: 8 },
  { z: 30.5, w: 26, d: 14, r: 5 },
];

function recipe(id: string, slot: string, slices: object[], features: object[]) {
  return {
    v: 1,
    id,
    name: id.replace(/_/g, " "),
    stat: "Glow",
    behavior: "feature op probe",
    slot,
    shape: { kind: "loft", slices },
    features,
  };
}

// Vertices of a binary STL (80-byte header, u32 count, then 50 bytes per triangle: normal, 3 vertices, attribute).
function stlVertices(path: string): [number, number, number][] {
  const b = readFileSync(path);
  const n = b.readUInt32LE(80);
  const out: [number, number, number][] = [];
  for (let t = 0; t < n; t++) {
    for (let v = 0; v < 3; v++) {
      const o = 84 + t * 50 + 12 + v * 12;
      out.push([b.readFloatLE(o), b.readFloatLE(o + 4), b.readFloatLE(o + 8)]);
    }
  }
  return out;
}

// A hat seats on the head's whole 2x1 crown pad (24.4 x 11.9 mm, two studs inside it), so an ear or horn must not add
// geometry within 1 mm of that footprint above the crown plane (z 30.5). Dan, round 8: "ears will block studs".
// Returns the distinct mesh vertices (to 0.01 mm) strictly inside that column: a head with ears must have exactly the
// vertices a plain head has.
function studZoneVertices(path: string): Set<string> {
  const keep = stlVertices(path).filter(([x, y, z]) => Math.abs(x) < 13.1 && Math.abs(y) < 6.8 && z > 30.7);
  return new Set(keep.map((v) => v.map((c) => c.toFixed(2)).join(",")));
}

// Left and right x extent of a binary STL.
function stlXRange(path: string): [number, number] {
  const xs = stlVertices(path).map((v) => v[0]);
  return [Math.min(...xs), Math.max(...xs)];
}

// A heart outline (x, z) whose right half is `narrower` (a fraction) narrower than its left: a hand-drawn wobble.
function heartPoints(narrower: number): number[][] {
  const pts: number[][] = [];
  for (let i = 0; i < 24; i++) {
    const t = (2 * Math.PI * i) / 24;
    const x = 16 * Math.sin(t) ** 3;
    const z = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    pts.push([Math.round(x * 0.8 * (x > 0 ? 1 - narrower : 1) * 100) / 100, Math.round((z * 0.8 + 14) * 100) / 100]);
  }
  return pts;
}

function handRecipe(id: string, points: number[][]) {
  return {
    v: 1,
    id,
    name: id.replace(/_/g, " "),
    stat: "Glow",
    behavior: "symmetry probe",
    slot: "hand",
    shape: { kind: "profile2d", points, fillet_r_mm: 1.2 },
  };
}

interface Job {
  status: string;
  stl_artifact?: string;
  gate_report?: { small_part?: { status?: string; min_enclosing_diameter_mm?: number }; design_status?: string };
  legalizer?: {
    support_policy_promoted?: string;
    features_ignored?: string[];
    features_dropped?: { op: string; why: string }[];
    features_adjusted?: { op: string; why: string }[];
    symmetry?: { kind: string; action: string; iou_before: number; iou_after?: number };
    l2?: { applied: boolean; direction?: string; scale?: number } | null;
    profile2d_reversed?: boolean;
    l1_l3_changed?: number;
  } | null;
}

describe.skipIf(!PYTHON)("Recipe v1 feature ops through the optimizer daemon", () => {
  let proc: ChildProcessByStdio<null, Readable, Readable>;
  let base = "";
  let outDir = "";

  beforeAll(async () => {
    outDir = mkdtempSync(join(tmpdir(), "tv-forge-ops-"));
    proc = spawn(
      PYTHON!,
      [join(ROOT, "scripts/forge_optimizer_daemon.py"), "--host", "127.0.0.1", "--port", "0", "--out-dir", outDir],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    base = await new Promise<string>((ok, fail) => {
      let buf = "";
      const timer = setTimeout(() => fail(new Error("daemon startup timeout")), 60_000);
      proc.stdout.on("data", (chunk: Buffer) => {
        buf += chunk.toString("utf8");
        const nl = buf.indexOf("\n");
        if (nl !== -1) {
          clearTimeout(timer);
          ok((JSON.parse(buf.slice(0, nl)) as { url: string }).url);
        }
      });
      proc.on("exit", (code) => {
        clearTimeout(timer);
        fail(new Error(`daemon exited early with code ${code}`));
      });
    });
  }, 90_000);

  afterAll(() => {
    proc?.kill();
    if (outDir) rmSync(outDir, { recursive: true, force: true });
  });

  async function run(body: object): Promise<Job> {
    const res = await fetch(`${base}/v1/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recipe: body }),
    });
    expect(res.status).toBe(202);
    const { job_id: id } = (await res.json()) as { job_id: string };
    const deadline = Date.now() + 150_000;
    for (;;) {
      const job = (await (await fetch(`${base}/v1/jobs/${id}`)).json()) as Job;
      if (["print_ready", "digital_only", "failed"].includes(job.status)) return job;
      if (Date.now() > deadline) throw new Error(`job ${id} did not finish`);
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  it("builds a row of crown points without a support change", async () => {
    const job = await run(
      recipe("ops_test_spikes", "crown", HELMET, [{ op: "spikes", count: 5, height_mm: 8, base_mm: 4, center_boost_mm: 3 }]),
    );
    expect(job.status).toBe("print_ready");
    expect(job.legalizer?.support_policy_promoted).toBeUndefined();
  }, 180_000);

  it("keeps a wide brim and says it promoted the support policy to minimal", async () => {
    const job = await run(
      recipe("ops_test_brim", "crown", HAT, [{ op: "brim", width_mm: 38, depth_mm: 26, thickness_mm: 2.4 }]),
    );
    expect(job.status).toBe("print_ready");
    expect(job.legalizer?.support_policy_promoted).toBe("none->minimal");
  }, 180_000);

  it("prints a horned helmet and a cat head with pointy ears", async () => {
    const horns = await run(
      recipe("ops_test_horns", "crown", HELMET, [{ op: "horns", length_mm: 18, base_mm: 6, curl: 0.7 }]),
    );
    expect(horns.status).toBe("print_ready");
    const ears = await run(
      recipe("ops_test_cat", "head", HEAD, [{ op: "ears", style: "pointy" }]),
    );
    expect(ears.status).toBe("print_ready");
  }, 360_000);

  it("prints heads with a muzzle, a beak and a bill, and a beak on a flared round head", async () => {
    for (const [id, slices, feats] of [
      ["ops_test_muzzle", HEAD, [{ op: "snout" }]],
      ["ops_test_beak", HEAD, [{ op: "snout", style: "beak" }]],
      ["ops_test_bill", HEAD, [{ op: "snout", style: "bill", z_frac: 0.3, length_mm: 12, height_mm: 4, width_mm: 22 }]],
      ["ops_test_wide_beak", WIDE_HEAD, [{ op: "snout", style: "beak" }, { op: "ears", style: "pointy" }]],
    ] as const) {
      const job = await run({ ...recipe(id, "head", [...slices], [...feats]), shape: { kind: "loft", slices, height_mm: 30.5 } });
      expect(job.status, id).toBe("print_ready");
    }
  }, 540_000);

  it("reports what it did with a snout that cannot be built as asked, instead of doing it silently", async () => {
    // The front of this head leans forward about 29 degrees, so no support-free underside can reach back to the wall.
    const leaning = [
      { z: 0, w: 24.6, d: 12.1, r: 3 },
      { z: 7, w: 26.5, d: 17.5, r: 4, y: -1.5 },
      { z: 14, w: 28, d: 22.5, r: 5, y: -2.5 },
      { z: 22, w: 28, d: 23, r: 5, y: -2.5 },
      { z: 30.5, w: 22, d: 18, r: 4, y: -2 },
    ];
    const job = await run(recipe("ops_test_leaning_snout", "head", leaning, [{ op: "snout", length_mm: 14, width_mm: 14, height_mm: 8 }]));
    expect(job.status).toBe("print_ready");
    // Since 2026-11-03 a snout that cannot land where it was asked is first moved up the face and shortened, which the job
    // reports in `features_adjusted`; it is listed in `features_dropped` only when nowhere on the face works. Either way it
    // is never silent.
    const reported = [...(job.legalizer?.features_dropped ?? []), ...(job.legalizer?.features_adjusted ?? [])].map((f) => f.op);
    expect(reported).toContain("snout");
  }, 180_000);

  it("keeps head ears and horns off the crown studs and says what it moved", async () => {
    // The top of a head is 18 to 20 mm wide and the studs fill most of it, so ears rooted at the upper corners used to
    // grow into them (88 mm3 on this bunny). They are now moved down, leaned out or moved further apart (a cut only as a last resort), and the job says which.
    const slices = [
      { z: 0, w: 24.6, d: 12.1, r: 3 },
      { z: 10, w: 25, d: 14, r: 5 },
      { z: 20, w: 22, d: 14.5, r: 6 },
      { z: 30.5, w: 18, d: 13, r: 5 },
    ];
    const withHeight = (r: object) => ({ ...r, shape: { kind: "loft", slices, height_mm: 30.5 } });
    const plain = await run(withHeight(recipe("ops_test_plain_head", "head", slices, [])));
    expect(plain.status).toBe("print_ready");
    const studVertices = studZoneVertices(join(outDir, plain.stl_artifact!));
    expect(studVertices.size).toBeGreaterThan(0);
    for (const [id, feats] of [
      ["ops_test_stud_bunny", [{ op: "ears", style: "tall", width_mm: 7, height_mm: 22, tilt_deg: 10 }]],
      ["ops_test_stud_bear", [{ op: "ears", style: "round", width_mm: 12, height_mm: 12, tilt_deg: 0 }]],
      ["ops_test_stud_horns", [{ op: "horns", length_mm: 14, base_mm: 6, curl: 0.5 }]],
    ] as const) {
      const job = await run(withHeight(recipe(id, "head", slices, [...feats])));
      expect(job.status, id).toBe("print_ready");
      expect(job.legalizer?.features_adjusted?.map((f) => f.op), id).toEqual([feats[0].op]);
      // Dan, round 5: "no cuts to the ears, just make the ears further apart". The bunny and bear clear the studs by
      // moving, not by trimming.
      if (id !== "ops_test_stud_horns") expect(job.legalizer?.features_adjusted?.[0]?.why, id).not.toContain("trimmed");
      const extra = [...studZoneVertices(join(outDir, job.stl_artifact!))].filter((v) => !studVertices.has(v));
      expect(extra, id).toEqual([]);
      if (id === "ops_test_stud_bear") {
        // Round ears sit on the side of the head, not above its top face (Dan, round 4).
        const above = stlVertices(join(outDir, job.stl_artifact!)).filter(([x, , z]) => Math.abs(x) > 13.3 && z > 30.7);
        expect(above, id).toEqual([]);
      }
    }
  }, 540_000);

  it("moves a snout up the face before shortening it, and cuts ribs round a head's sides", async () => {
    // Dan, round 10: the dinosaur had "no snout" (a 14 mm snout was shortened to about 3 mm), and the pumpkin was "blank".
    const kid = [
      { z: 0, w: 26, d: 12.7, r: 5 },
      { z: 5, w: 28.6, d: 17.6, r: 6, y: -0.3 },
      { z: 10, w: 33.5, d: 23.6, r: 8 },
      { z: 15, w: 38.1, d: 25.7, r: 9, y: -0.45 },
      { z: 20, w: 34.8, d: 27.1, r: 9, y: -0.95 },
      { z: 25, w: 33.9, d: 25.5, r: 8, y: -1.25 },
      { z: 30.5, w: 30.7, d: 17.8, r: 6, y: -0.5 },
    ];
    const withHeight = (r: object) => ({ ...r, shape: { kind: "loft", slices: kid, height_mm: 30.5 } });
    const plain = await run(withHeight(recipe("ops_test_head_plain_kid", "head", kid, [])));
    const frontOf = (j: Job) => Math.min(...stlVertices(join(outDir, j.stl_artifact!)).map((v) => v[1]));
    const snout = await run(withHeight(recipe("ops_test_head_dino", "head", kid, [{ op: "snout", style: "muzzle", length_mm: 14, width_mm: 16, height_mm: 10 }])));
    expect(snout.status).toBe("print_ready");
    expect(frontOf(plain) - frontOf(snout)).toBeGreaterThan(8); // it sticks out, where it used to be about 3 mm
    expect(snout.legalizer?.features_adjusted?.[0]?.why ?? "").toContain("moved up");

    const ribbed = await run(withHeight(recipe("ops_test_head_ribs", "head", kid, [{ op: "ribs", count: 8, width_mm: 5, depth_mm: 3 }])));
    expect(ribbed.status).toBe("print_ready");
    expect(ribbed.legalizer?.features_dropped).toBeUndefined();
    // The grooves add faces and leave the front smooth: nothing is cut within 20 degrees of the front centre line.
    expect(stlVertices(join(outDir, ribbed.stl_artifact!)).length).toBeGreaterThan(stlVertices(join(outDir, plain.stl_artifact!)).length);
  }, 540_000);

  it("builds floppy ears and ears on the sides of a head, and prints them without supports", async () => {
    // Dan's Sketchfab picks (2026-11-03): a beagle's floppy ears, a monkey's round side ears, an elephant's flaps.
    const slices = [
      { z: 0, w: 26, d: 12.7, r: 5 },
      { z: 5, w: 33.7, d: 20, r: 7 },
      { z: 10, w: 40.6, d: 27.8, r: 10 },
      { z: 15, w: 44.2, d: 34.5, r: 12 },
      { z: 20, w: 45.7, d: 36.8, r: 12 },
      { z: 25, w: 42, d: 33, r: 10 },
      { z: 30.5, w: 36, d: 24, r: 8 },
    ];
    const withHeight = (r: object) => ({ ...r, shape: { kind: "loft", slices, height_mm: 30.5 } });
    const plain = await run(withHeight(recipe("ops_test_variety_plain", "head", slices, [])));
    expect(plain.status).toBe("print_ready");
    const [px0, px1] = stlXRange(join(outDir, plain.stl_artifact!));
    const floppy = await run(withHeight(recipe("ops_test_floppy", "head", slices, [{ op: "ears", style: "floppy", width_mm: 10, height_mm: 18, z_frac: 0.8 }])));
    expect(floppy.status).toBe("print_ready");
    expect(floppy.legalizer?.features_dropped).toBeUndefined();
    const fv = stlVertices(join(outDir, floppy.stl_artifact!));
    expect(Math.max(...fv.map((v) => Math.abs(v[0])))).toBeGreaterThan(Math.max(Math.abs(px0), px1) - 0.5); // it hangs on the side
    const side = await run(withHeight(recipe("ops_test_side_ears", "head", slices, [{ op: "ears", style: "round", width_mm: 14, z_frac: 0.55 }])));
    expect(side.status).toBe("print_ready");
    expect(side.legalizer?.features_dropped).toBeUndefined();
    const [sx0, sx1] = stlXRange(join(outDir, side.stl_artifact!));
    expect(sx1 - sx0).toBeGreaterThan(px1 - px0 + 4); // the ears stand out beyond the head's own width
  }, 540_000);

  it("keeps a head's round ears when the head is widest part way up, instead of dropping them", async () => {
    // Dan, round 11: a bear head rated 1, with no ears at all. The fitter rejected every lowered placement as "wider than
    // asked" (lowering an ear on a head that widens downward moves it outward) and dropped the pair without a word.
    const bear = [
      { z: 0, w: 24.6, d: 12.1, r: 4 },
      { z: 5, w: 30, d: 18, r: 6, y: -0.3 },
      { z: 10, w: 37, d: 24, r: 8 },
      { z: 15, w: 44.5, d: 30, r: 9, y: -1.5 },
      { z: 20, w: 46, d: 31, r: 9, y: -1 },
      { z: 25, w: 42, d: 29, r: 8, y: -1.2 },
      { z: 30.5, w: 36, d: 20, r: 6, y: -0.5 },
    ];
    const job = await run({
      ...recipe("ops_test_wide_bear", "head", bear, [{ op: "ears", style: "round", width_mm: 12, height_mm: 12, tilt_deg: 10 }]),
      shape: { kind: "loft", slices: bear, height_mm: 30.5 },
    });
    expect(job.status).toBe("print_ready");
    expect(job.legalizer?.features_dropped).toBeUndefined();
    const [x0, x1] = stlXRange(join(outDir, job.stl_artifact!));
    expect(x1 - x0).toBeGreaterThan(48); // the head is 46 wide: the ears stand outside it
  }, 360_000);

  it("stands a five-point star on the tip of a hat and prints it without supports", async () => {
    // Dan, round 2 and again on 2026-11-03: "a tall wizard hat with little stars still has no star on top".
    const wizard = [
      { z: 0, w: 23.4, d: 11.4, r: 4.6 },
      { z: 7.5, w: 27.5, d: 17, r: 6.2, y: -1.8 },
      { z: 17, w: 11, d: 11, r: 4.5, y: -0.5 },
      { z: 23.5, w: 5.6, d: 5.6, r: 2.4, y: 1.2 },
    ];
    const plain = await run(recipe("ops_test_wizard_plain", "crown", wizard, []));
    const starred = await run(recipe("ops_test_wizard_star", "crown", wizard, [{ op: "star", size_mm: 10 }]));
    expect(plain.status).toBe("print_ready");
    expect(starred.status).toBe("print_ready");
    const topOf = (j: Job) => Math.max(...stlVertices(join(outDir, j.stl_artifact!)).map((v) => v[2]));
    expect(topOf(starred) - topOf(plain)).toBeGreaterThan(8); // the star stands clear above the tip
    const star = stlVertices(join(outDir, starred.stl_artifact!)).filter((v) => v[2] > topOf(plain) + 1);
    expect(Math.max(...star.map((v) => v[0])) - Math.min(...star.map((v) => v[0]))).toBeGreaterThan(8); // as wide as a 10 mm star
  }, 360_000);

  it("builds a round crown as a ring with points round its rim, and hollows a cup hat", async () => {
    // Dan, round 2 on the five-point crown: "does not look like a crown at all, crowns should be round".
    const round = [
      { z: 0, w: 23.8, d: 11.6, r: 4 },
      { z: 9.5, w: 26, d: 26, r: 12.4 },
      { z: 14, w: 26, d: 26, r: 12.4 },
    ];
    const crown = await run(recipe("ops_test_ring_crown", "crown", round, [{ op: "spikes", layout: "ring", count: 5, height_mm: 7, base_mm: 5 }]));
    expect(crown.status).toBe("print_ready");
    const verts = stlVertices(join(outDir, crown.stl_artifact!));
    const xs = verts.map((v) => v[0]);
    const ys = verts.map((v) => v[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(25); // round: as wide as it is deep
    expect(Math.abs(Math.max(...xs) - Math.min(...xs) - (Math.max(...ys) - Math.min(...ys)))).toBeLessThan(1);
    // The top is hollow: nothing but the ring's wall and its points reaches the top 6 mm, so the middle is empty.
    const high = verts.filter((v) => v[2] > Math.max(...verts.map((q) => q[2])) - 6);
    expect(high.every((v) => Math.hypot(v[0], v[1]) > 9)).toBe(true);
    // A ring of points on a top too small to hollow is reported, not silently dropped.
    const cone = await run(
      recipe(
        "ops_test_ring_cone",
        "crown",
        [
          { z: 0, w: 23.8, d: 11.6, r: 4 },
          { z: 10, w: 14, d: 11, r: 5 },
          { z: 18, w: 5, d: 5, r: 2 },
        ],
        [{ op: "spikes", layout: "ring", count: 5 }],
      ),
    );
    expect(cone.legalizer?.features_dropped?.map((f) => f.op)).toContain("hollow");
  }, 360_000);

  it("lets a head reach behind the neck like the catalog heads, and grows it out of the marginal band", async () => {
    // Dan, round 7: the heads "are very narrow" next to the Kip heads. character_head used to clip the back flat at
    // y = +6.15 over the whole height (13 mm deep slabs) and L2 only shrank. These are the Kip kid head's own slices.
    const kid = [
      { z: 0, w: 26, d: 12.7, r: 5 },
      { z: 5, w: 28.6, d: 17.6, r: 6, y: -0.3 },
      { z: 10, w: 33.5, d: 23.6, r: 8 },
      { z: 15, w: 38.1, d: 25.7, r: 9, y: -0.45 },
      { z: 20, w: 34.8, d: 27.1, r: 9, y: -0.95 },
      { z: 25, w: 33.9, d: 25.5, r: 8, y: -1.25 },
      { z: 30.5, w: 30.7, d: 17.8, r: 6, y: -0.5 },
    ];
    const job = await run({ ...recipe("ops_test_kip_sized_head", "head", kid, []), shape: { kind: "loft", slices: kid, height_mm: 30.5 } });
    expect(job.status).toBe("print_ready");
    const verts = stlVertices(join(outDir, job.stl_artifact!));
    expect(Math.max(...verts.map((v) => v[1]))).toBeGreaterThan(11); // the back is no longer cut flat at +6.15
    expect(Math.max(...verts.filter((v) => v[2] < 1.5).map((v) => v[1]))).toBeLessThan(6.4); // still clear at the collar
    // 34.8 mm sits in the 31.75 to 34.9 band: the 0.1 mm to the band's top is not worth an 11-20% shrink, so it grows.
    expect(job.legalizer?.l2?.direction).toBe("grow");
    expect(job.gate_report?.small_part?.status).toBe("above_cylinder");

    // A head only a little over the cylinder is shrunk, not grown.
    const small = kid.map((s, i) => (i === 0 ? s : { ...s, w: s.w * 0.84, d: s.d * 0.84, y: (s.y ?? 0) * 0.84 }));
    const shrunk = await run({ ...recipe("ops_test_kip_small_head", "head", small, []), shape: { kind: "loft", slices: small, height_mm: 30.5 } });
    expect(shrunk.status).toBe("print_ready");
    expect(shrunk.legalizer?.l2?.direction).toBe("shrink");
  }, 360_000);

  it("keeps tall thin head ears sturdy and leaves stout ones exactly as asked", async () => {
    // Dan, round 6, on the bunny: "looks fragile, not sure we need the bend, can we make shorter".
    const slices = [
      { z: 0, w: 24.6, d: 12.1, r: 3 },
      { z: 10, w: 25, d: 14, r: 5 },
      { z: 20, w: 22, d: 14.5, r: 6 },
      { z: 30.5, w: 18, d: 13, r: 5 },
    ];
    const withHeight = (r: object) => ({ ...r, shape: { kind: "loft", slices, height_mm: 30.5 } });
    const bunny = await run(
      withHeight(recipe("ops_test_sturdy_bunny", "head", slices, [{ op: "ears", style: "tall", width_mm: 7, height_mm: 22, tilt_deg: 10 }])),
    );
    expect(bunny.status).toBe("print_ready");
    expect(bunny.legalizer?.features_adjusted?.[0]?.why).toContain("kept sturdy: cut from 22 to 15 mm tall");
    // The cat's ears (pointy, 8 wide, 12 tall) are stout: the sturdiness step must not touch them.
    const cat = await run(
      withHeight(recipe("ops_test_stout_cat", "head", slices, [{ op: "ears", style: "pointy", width_mm: 8, height_mm: 12, tilt_deg: 10 }])),
    );
    expect(cat.status).toBe("print_ready");
    expect(cat.legalizer?.features_adjusted?.[0]?.why ?? "").not.toContain("kept sturdy");
  }, 360_000);

  it("builds a head without studs and with a domed top", async () => {
    // Dan, round 6: "a version with and without studs; the one without should have a curved top rather than flat".
    const slices = [
      { z: 0, w: 24.6, d: 12.1, r: 4 },
      { z: 10, w: 25.5, d: 13.5, r: 5 },
      { z: 20, w: 24.5, d: 13.8, r: 5 },
      { z: 30.5, w: 20, d: 12.5, r: 5 },
    ];
    const mk = (id: string, top: string | undefined, feats: object[]) => ({
      ...recipe(id, "head", slices, feats),
      shape: { kind: "loft", slices, height_mm: 30.5, ...(top ? { top } : {}) },
    });
    const withStuds = await run(mk("ops_test_top_studs", undefined, []));
    expect(withStuds.status).toBe("print_ready");
    const topOf = (path: string) => Math.max(...stlVertices(path).map((v) => v[2]));
    expect(topOf(join(outDir, withStuds.stl_artifact!))).toBeGreaterThan(33); // the studs stand 2.8 mm above the seat

    const dome = await run(mk("ops_test_top_dome", "dome", []));
    expect(dome.status).toBe("print_ready");
    const domePath = join(outDir, dome.stl_artifact!);
    expect(topOf(domePath)).toBeLessThan(30.7); // same height as the flat seat, no studs
    // Domed: the top is not flat. A flat seat would still be about 18 mm wide at z 30.2; under a dome it has shrunk.
    const nearApex = stlVertices(domePath).filter((v) => v[2] > 30.2).map((v) => v[0]);
    expect(nearApex.length).toBeGreaterThan(0);
    expect(Math.max(...nearApex) - Math.min(...nearApex)).toBeLessThan(10);

    // Round ears on the domed head still stay below its top, and nothing needs to dodge studs.
    const bear = await run(mk("ops_test_top_dome_bear", "dome", [{ op: "ears", style: "round", width_mm: 12, height_mm: 12, tilt_deg: 0 }]));
    expect(bear.status).toBe("print_ready");
    expect(topOf(join(outDir, bear.stl_artifact!))).toBeLessThan(30.7);
  }, 540_000);

  it("makes a nearly symmetric outline exactly symmetric and leaves a lopsided one alone", async () => {
    // Dan, 2026-11-02: check for symmetry and, if there is some, split on the centre and mirror one half.
    const lopsided = await run(handRecipe("ops_test_heart_lopsided", heartPoints(0.04)));
    expect(lopsided.status).toBe("print_ready");
    expect(lopsided.legalizer?.symmetry?.action).toMatch(/^mirrored_(left|right)_half$/);
    expect(lopsided.legalizer?.symmetry?.iou_after).toBeGreaterThan(0.999);
    const [x0, x1] = stlXRange(join(outDir, lopsided.stl_artifact!));
    expect(Math.abs(x0 + x1)).toBeLessThan(0.05); // the part is centred, left edge = right edge

    const exact = await run(handRecipe("ops_test_heart_exact", heartPoints(0)));
    expect(exact.legalizer?.symmetry).toBeUndefined(); // already symmetric: nothing to say

    // A lightning bolt overlaps its mirror image by about half: that is the design, so it stays as drawn.
    const bolt = await run(handRecipe("ops_test_bolt", [[0, 40], [10, 40], [3, 24], [14, 24], [-6, 0], [-1, 18], [-10, 18]]));
    expect(bolt.legalizer?.symmetry?.action).toBe("kept_asymmetric");
    expect(bolt.legalizer?.symmetry?.iou_before).toBeLessThan(0.7);
  }, 360_000);

  it("turns a clockwise outline round instead of building an empty part", async () => {
    // sdk.polygon_2d fills counter-clockwise outlines only; a clockwise one used to build nothing, with no error.
    const job = await run(handRecipe("ops_test_square_cw", [[-10, 0], [-10, 20], [10, 20], [10, 0]]));
    expect(job.status).toBe("print_ready");
    expect(job.legalizer?.profile2d_reversed).toBe(true);
  }, 180_000);

  it("snaps tiny slice x offsets to the centre line and keeps a deliberate lean", async () => {
    const noisy = HEAD.map((s, i) => ({ ...s, x: [0.2, -0.3, 0.6, 0.4][i] }));
    const snapped = await run({ ...recipe("ops_test_head_x_noise", "head", noisy, []), shape: { kind: "loft", slices: noisy, height_mm: 30.5 } });
    expect(snapped.status).toBe("print_ready");
    expect(snapped.legalizer?.symmetry?.action).toBe("snapped_x_to_centre");
    expect(snapped.legalizer?.l1_l3_changed).toBe(0); // reported under `symmetry`, not as a clamp
    const [x0, x1] = stlXRange(join(outDir, snapped.stl_artifact!));
    expect(Math.abs(x0 + x1)).toBeLessThan(0.05);

    const leaning = HEAD.map((s, i) => ({ ...s, x: [0, 1, 3, 6][i] }));
    const kept = await run({ ...recipe("ops_test_head_lean", "head", leaning, []), shape: { kind: "loft", slices: leaning, height_mm: 30.5 } });
    expect(kept.legalizer?.symmetry?.action).toBe("kept_asymmetric");
  }, 360_000);

  it("ignores an op the slot cannot use and an unknown op, and reports both", async () => {
    const job = await run(
      recipe("ops_test_ignored", "crown", HELMET, [
        { op: "spikes", count: 3 },
        { op: "laser_beam", power: 9000 },
      ]),
    );
    expect(job.status).toBe("print_ready");
    expect(job.legalizer?.features_ignored).toEqual(["laser_beam"]);
    // spikes are allowed on a crown; the head top is the crown seat, so a head ignores them.
    const head = await run(recipe("ops_test_head_spikes", "head", HEAD, [{ op: "spikes", count: 3 }]));
    expect(head.legalizer?.features_ignored).toEqual(["spikes"]);
    // a snout is a head op; a knob and a brim do nothing on a head (the builder clips them away).
    const crownSnout = await run(recipe("ops_test_crown_snout", "crown", HELMET, [{ op: "snout" }]));
    expect(crownSnout.legalizer?.features_ignored).toEqual(["snout"]);
    const headHatOps = await run(recipe("ops_test_head_hat_ops", "head", HEAD, [{ op: "knob" }, { op: "brim" }]));
    expect(headHatOps.legalizer?.features_ignored).toEqual(["knob", "brim"]);
  }, 360_000);
});
