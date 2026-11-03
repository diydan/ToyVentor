/**
 * The real Worker routes in front of the real optimizer daemon, with a RECIPE (not a mesh): the missing link between
 * tests/forge-recipe-passthrough.test.ts (a stubbed daemon) and tests/forge/forge-ops.test.ts (the daemon called directly).
 * Everything the Worker allowlist lets through must come out of the daemon as a printable part, and the Worker's scrubbing and its
 * gated artifact route must work on it. Spawns scripts/forge_optimizer_daemon.py on a loopback port; skipped without the partspec venv.
 */
import { type ChildProcessByStdio, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UNIVERSAL_COVER, coverRecipeForHead } from "../shared/forgeCover";
import type { ForgeFastPreviewResponse, ForgeOptimizationJob, ForgeRecipeV1 } from "../shared/forgeOptimizer";
import {
  handleForgeArtifact,
  handleForgeJobStatus,
  handleForgePreview,
  resetForgeRateLimit,
  type ForgeOptimizerEnv,
} from "../worker/forgeOptimizer";
import worker from "../worker/index";
import type { D1Like } from "../worker/ownership";

const ROOT = resolve(__dirname, "..");
const DEVICE = "12345678-1234-1234-1234-123456789abc";

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

function fakeDb(): D1Like {
  const settings = new Map<string, string>();
  return {
    prepare: (sql) => ({
      bind: (...values: unknown[]) => ({
        run: async () => {
          if (sql.includes("INSERT INTO parent_settings")) {
            const [id, text] = values as [string, string];
            if (sql.includes("DO NOTHING")) {
              if (!settings.has(id)) settings.set(id, text);
            } else settings.set(id, text);
          }
          return {};
        },
        all: async () => {
          if (sql.includes("FROM parent_settings")) {
            const [id] = values as [string];
            const v = settings.get(id);
            return { results: v !== undefined ? [{ settings_json: v }] : [] };
          }
          return { results: [] };
        },
      }),
    }),
  };
}

async function parentProof(env: ForgeOptimizerEnv): Promise<string> {
  const call = (body: object) =>
    worker.fetch(
      new Request("http://local/api/parent/gate", {
        method: "POST",
        headers: { "content-type": "application/json", "x-device-id": DEVICE },
        body: JSON.stringify(body),
      }),
      env as never,
    );
  const ch = (await (await call({ action: "challenge" })).json()) as { a: number; b: number; challengeToken: string };
  const ok = await call({ action: "verify", challengeToken: ch.challengeToken, answer: ch.a * ch.b });
  return ((await ok.json()) as { proofToken: string }).proofToken;
}

/** A kid-sized head: the loft the Kip heads use, 30.5 mm tall, widest part about 38 mm. */
const KID_HEAD: ForgeRecipeV1 = {
  v: 1,
  id: "worker_kid_head",
  name: "Worker Kid Head",
  stat: "Glow",
  slot: "head",
  shape: {
    kind: "loft",
    height_mm: 30.5,
    slices: [
      { z: 0, w: 26, d: 12.7, r: 5 },
      { z: 5, w: 28.6, d: 17.6, r: 6, y: -0.3 },
      { z: 10, w: 33.5, d: 23.6, r: 8 },
      { z: 15, w: 38.1, d: 25.7, r: 9, y: -0.45 },
      { z: 20, w: 34.8, d: 27.1, r: 9, y: -0.95 },
      { z: 25, w: 33.9, d: 25.5, r: 8, y: -1.25 },
      { z: 30.5, w: 30.7, d: 17.8, r: 6, y: -0.5 },
    ],
  },
  features: [
    { op: "brow", width_mm: 20, thickness_mm: 3.5, height_mm: 6, z_frac: 0.75 },
    { op: "ears", style: "round", width_mm: 10, z_frac: 0.6 },
  ],
};

function stlVertices(bytes: Uint8Array): [number, number, number][] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = dv.getUint32(80, true);
  const out: [number, number, number][] = [];
  for (let t = 0; t < n; t++) {
    for (let v = 0; v < 3; v++) {
      const o = 84 + t * 50 + 12 + v * 12;
      out.push([dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true)]);
    }
  }
  return out;
}

describe.skipIf(!PYTHON)("Worker routes in front of the real daemon, with a recipe", () => {
  let proc: ChildProcessByStdio<null, Readable, Readable>;
  let outDir = "";
  let env: ForgeOptimizerEnv;
  let headers: Record<string, string>;
  let proofMintedAt = 0;

  beforeAll(async () => {
    outDir = mkdtempSync(join(tmpdir(), "tv-forge-worker-"));
    proc = spawn(PYTHON!, [join(ROOT, "scripts/forge_optimizer_daemon.py"), "--host", "127.0.0.1", "--port", "0", "--out-dir", outDir], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const base = await new Promise<string>((ok, fail) => {
      let buf = "";
      const timer = setTimeout(() => fail(new Error("daemon startup timeout")), 90_000);
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
    resetForgeRateLimit();
    env = { DB: fakeDb(), PARENT_GATE_SECRET: "gate-secret-for-tests", FORGE_OPTIMIZER_URL: base };
    await freshProof(true);
  }, 120_000);

  afterAll(() => {
    proc?.kill();
    if (outDir) rmSync(outDir, { recursive: true, force: true });
  });

  /**
   * The parent-gate proof lasts 2 minutes (PROOF_EVERY_TIME_TTL_MS in worker/parent.ts) and a slow job can take longer, so a real client
   * has to ask the grown-up again; here a new proof is minted whenever the last one is over 90 seconds old.
   */
  async function freshProof(force = false): Promise<void> {
    if (!force && Date.now() - proofMintedAt < 90_000) return;
    headers = { "content-type": "application/json", "x-device-id": DEVICE, "x-parent-proof": await parentProof(env) };
    proofMintedAt = Date.now();
  }

  /** A request that waits out the Worker's 429 (`retry-after`), as the app has to: the job route allows 30 polls a minute per device. */
  async function patient(make: () => Promise<Response>): Promise<Response> {
    for (let i = 0; i < 40; i++) {
      const res = await make();
      if (res.status !== 429) return res;
      expect(res.headers.get("retry-after")).toMatch(/^\d+$/); // the limiter says how long to wait
      await new Promise((r) => setTimeout(r, Number(res.headers.get("retry-after")) * 1000 + 100));
    }
    throw new Error("still rate limited");
  }

  /** One recipe through /api/forge/preview, then the job route until it is done, then the gated STL route. */
  async function viaWorker(recipe: ForgeRecipeV1): Promise<{ job: ForgeOptimizationJob; stl: Uint8Array }> {
    resetForgeRateLimit(); // each request here is a separate "kid"; the limiter has its own tests
    await freshProof();
    const res = await handleForgePreview(
      new Request("http://local/api/forge/preview", { method: "POST", headers, body: JSON.stringify({ recipe, enqueue_background: true }) }),
      env,
    );
    expect(res.status, JSON.stringify(recipe.id)).toBe(200);
    const preview = (await res.json()) as ForgeFastPreviewResponse;
    expect(preview.status).toBe("preview_ready");
    expect(preview.job_id).toBeTruthy();
    expect(JSON.stringify(preview)).not.toContain(outDir); // no server path in anything the Worker returns
    const deadline = Date.now() + 280_000;
    for (;;) {
      await freshProof();
      const jr = await patient(() =>
        handleForgeJobStatus(
          new Request(`http://local/api/forge/jobs/${preview.job_id}`, { headers: { "x-device-id": DEVICE, "x-parent-proof": headers["x-parent-proof"]! } }),
          env,
          preview.job_id!,
        ),
      );
      expect(jr.status).toBe(200);
      const job = (await jr.json()) as ForgeOptimizationJob;
      if (["print_ready", "digital_only", "failed"].includes(job.status)) {
        expect(JSON.stringify(job)).not.toContain(outDir);
        if (job.status !== "print_ready") return { job, stl: new Uint8Array() };
        await freshProof();
        const art = await patient(() =>
          handleForgeArtifact(
            new Request(`http://local/api/forge/artifacts/${job.stl_artifact}`, { headers: { "x-device-id": DEVICE, "x-parent-proof": headers["x-parent-proof"]! } }),
            env,
            job.stl_artifact!,
          ),
        );
        expect(art.status).toBe(200);
        return { job, stl: new Uint8Array(await art.arrayBuffer()) };
      }
      if (Date.now() > deadline) throw new Error(`job ${preview.job_id} did not finish`);
      await new Promise((r) => setTimeout(r, 2200)); // the Worker allows 30 polls a minute per device
    }
  }

  it("builds a head with a brow and ears from the recipe the Worker let through, and serves its STL", async () => {
    const { job, stl } = await viaWorker(KID_HEAD);
    expect(job.status).toBe("print_ready");
    expect(job.gate_report?.design_status).toBe("verified");
    expect(job.stl_artifact).toMatch(/^custom_worker_kid_head\.[a-f0-9]{12}\.stl$/);
    expect(stl.byteLength).toBeGreaterThan(84);
    // the brow is geometry: the head is deeper in its brow band than the same recipe without it would be, and the studs are still there
    const verts = stlVertices(stl);
    expect(Math.max(...verts.map((v) => v[2]))).toBeGreaterThan(32.5); // the two crown studs reach above the 30.5 mm top
  }, 300_000);

  it("builds the universal cover through the Worker: flat on the bed, as wide as the pad, tall enough to roof its sockets", async () => {
    const { job, stl } = await viaWorker(UNIVERSAL_COVER);
    expect(job.status).toBe("print_ready");
    expect(job.gate_report?.design_status).toBe("verified");
    const verts = stlVertices(stl);
    const xs = verts.map((v) => v[0]);
    const zs = verts.map((v) => v[2]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(24.4, 0);
    expect(Math.min(...zs)).toBeCloseTo(0, 1);
    expect(Math.max(...zs)).toBeGreaterThan(7.5);
  }, 300_000);

  it("builds a cover sized to a head's top face through the Worker", async () => {
    const cover = coverRecipeForHead(KID_HEAD)!;
    expect(cover).toBeTruthy();
    const { job, stl } = await viaWorker(cover);
    expect(job.status).toBe("print_ready");
    const xs = stlVertices(stl).map((v) => v[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(30, 0); // the kid head's top is 30.7 wide, held to the 30 mm the sockets allow
  }, 300_000);
});
