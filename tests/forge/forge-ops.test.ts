// Recipe v1 feature ops (ears, horns, spikes, snout, brim) through the real optimizer daemon and its gates.
// Spawns scripts/forge_optimizer_daemon.py on an ephemeral loopback port, so it needs the partspec venv
// and is skipped without it, the same as tests/parts-asset-optimization.test.ts.
import { type ChildProcessByStdio, execFileSync, spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
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

interface Job {
  status: string;
  gate_report?: { small_part?: { status?: string }; design_status?: string };
  legalizer?: {
    support_policy_promoted?: string;
    features_ignored?: string[];
    features_dropped?: { op: string; why: string }[];
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

  it("reports a snout it cannot build instead of dropping it silently", async () => {
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
    expect(job.legalizer?.features_dropped?.map((f) => f.op)).toEqual(["snout"]);
  }, 180_000);

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
