// `profile2d` outlines on the real optimizer daemon: the point limit (256 builds, 257 is refused before anything is built), and that the
// daemon's own symmetry step leaves a photo outline that is already exactly symmetric alone.
// Spawns scripts/forge_optimizer_daemon.py on an ephemeral loopback port, so it needs the partspec venv and is skipped without it,
// the same as tests/forge/forge-ops.test.ts.
import { type ChildProcessByStdio, execFileSync, spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FORGE_MAX_PROFILE_POINTS } from "../../shared/forgeOptimizer";
import { symmetrizeOutline } from "../../shared/outlineSymmetry";
import { legalizeOutline, withFlipped, withScaled } from "../../shared/photoOutline";
import { SHAPES } from "../fixtures/outlineMasks";

const ROOT = resolve(__dirname, "../..");

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

/** A rounded blob, counter-clockwise, `n` points, two decimals: 40 mm across, bottom at z = 0. */
function ring(n: number): [number, number][] {
  return Array.from({ length: n }, (_, i): [number, number] => {
    const a = (i / n) * 2 * Math.PI;
    return [Math.round(18 * Math.cos(a) * 100) / 100, Math.round((20 + 20 * Math.sin(a)) * 100) / 100];
  });
}

describe.skipIf(!PYTHON)("profile2d outlines on the real daemon", () => {
  let proc: ChildProcessByStdio<null, Readable, Readable>;
  let out: string;
  let base = "";

  beforeAll(async () => {
    out = mkdtempSync(join(tmpdir(), "forge-points-"));
    proc = spawn(PYTHON!, [join(ROOT, "scripts/forge_optimizer_daemon.py"), "--port", "0", "--out-dir", out], {
      cwd: ROOT,
      env: { ...process.env, PYTHONPATH: ["scripts", "parts/kip/sdk", "parts/kip", "parts/partspec"].map((p) => join(ROOT, p)).join(":") },
      stdio: ["ignore", "pipe", "pipe"],
    }) as ChildProcessByStdio<null, Readable, Readable>;
    base = await new Promise<string>((resolveUrl, reject) => {
      const timer = setTimeout(() => reject(new Error("daemon did not start")), 60_000);
      let buf = "";
      proc.stdout.on("data", (d: Buffer) => {
        buf += d.toString();
        const m = /"url":\s*"(http:\/\/[^"]+)"/.exec(buf);
        if (m) {
          clearTimeout(timer);
          resolveUrl(m[1]!);
        }
      });
      proc.on("exit", () => reject(new Error("daemon exited")));
    });
  }, 90_000);

  afterAll(() => {
    proc?.kill();
    if (out) rmSync(out, { recursive: true, force: true });
  });

  const preview = async (points: [number, number][], fillet = 1.6) => {
    const res = await fetch(`${base}/v1/fast-preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recipe: { name: "points probe", slot: "hand", shape: { kind: "profile2d", points, fillet_r_mm: fillet, grip_tu: 2 } }, enqueue_background: false, include_glb_base64: false }),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  /** The real gate job for an outline, polled to its end, the way the Worker's forge routes run it. The daemon's notes about what its own
   * legalizer changed (`legalizer.symmetry`, ...) are on the job record and nowhere in the fast-preview reply. */
  const gateJob = async (points: [number, number][], fillet = 1.6) => {
    const res = await fetch(`${base}/v1/fast-preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recipe: { name: "symmetry probe", slot: "hand", shape: { kind: "profile2d", points, fillet_r_mm: fillet, grip_tu: 2 } }, enqueue_background: true, include_glb_base64: false }),
    });
    expect(res.status).toBe(200);
    const jobId = ((await res.json()) as { job_id?: string }).job_id;
    expect(typeof jobId).toBe("string");
    for (let i = 0; i < 180; i++) {
      const job = (await (await fetch(`${base}/v1/jobs/${jobId}`)).json()) as Record<string, unknown>;
      if (typeof job.status === "string" && !["queued", "validating", "optimizing"].includes(job.status)) return job;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error("the job did not finish");
  };
  const symmetryNote = (job: Record<string, unknown>) => ((job.legalizer ?? {}) as { symmetry?: { action?: string } }).symmetry;

  it("builds an outline of 256 points, the limit the Worker and the legalizer share", async () => {
    expect(FORGE_MAX_PROFILE_POINTS).toBe(256);
    const r = await preview(ring(256));
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("preview_ready");
  }, 60_000);

  it("builds an outline of 65 points: the old limit of 64 is gone", async () => {
    expect((await preview(ring(65))).status).toBe(200);
  }, 60_000);

  it("refuses 257 points before building anything, and 2", async () => {
    expect((await preview(ring(257))).status).toBe(422);
    expect((await preview(ring(2))).status).toBe(422);
  }, 60_000);

  it("leaves a photo outline that is already exactly symmetric as it is: no rewrite note, at full size, scaled and flipped", async () => {
    const raw = legalizeOutline(SHAPES.paddle(), { targetHeightMm: 54 });
    if (!raw.ok) throw new Error("no outline");
    const sym = symmetrizeOutline(raw).outline;
    expect(sym.changes.map((c) => c.code)).toContain("made_symmetric"); // guard: it was made symmetric here
    expect(sym.points.length).toBeGreaterThan(64); // guard: more points than a rewrite to 64 would keep
    for (const [name, o] of [["as made", sym], ["scaled", withScaled(sym, 1.037).outline], ["flipped", withFlipped(sym)]] as const) {
      const job = await gateJob(o.points as [number, number][], o.fillet_r_mm);
      expect(["print_ready", "digital_only"], name).toContain(job.status); // the gate ran: a failed job would have no note either way
      expect(symmetryNote(job), name).toBeUndefined();
    }
  }, 180_000);

  it("rewrites a near-symmetric photo outline without squeezing it: all its points stay, and the result is exactly symmetric", async () => {
    // The daemon's symmetry step once capped its rebuild at 64 points, the old profile2d limit; a 112-point outline came back with 63.
    const raw = legalizeOutline(SHAPES.paddle(), { targetHeightMm: 54 });
    if (!raw.ok) throw new Error("no outline");
    expect(raw.points.length).toBeGreaterThan(100); // guard: well over 64
    const job = await gateJob(raw.points as [number, number][], raw.fillet_r_mm);
    const note = symmetryNote(job) as { action?: string; points?: number; iou_before?: number; iou_after?: number } | undefined;
    expect(note?.action).toMatch(/^mirrored_/); // guard: it is near enough symmetric for the daemon to rebuild it
    expect(note?.points).toBeGreaterThan(100);
    expect(note?.points).toBeLessThanOrEqual(FORGE_MAX_PROFILE_POINTS);
    expect(note?.iou_after).toBeGreaterThanOrEqual(0.999);
  }, 120_000);

  it("canary for the check above: an outline a little off symmetric does get a rewrite note, so the note is visible on the job", async () => {
    // If the daemon stops rewriting near-symmetric outlines (it keeps the larger half about the bounding-box centre and mirrors it), this is
    // the line to change: the check above then no longer needs the canary, but it still has to see the note when there is one.
    const nudged = ring(40);
    nudged[3] = [nudged[3]![0] + 1.5, nudged[3]![1]];
    const job = await gateJob(nudged);
    expect(["print_ready", "digital_only"]).toContain(job.status);
    expect(symmetryNote(job)?.action).toMatch(/^mirrored_/);
  }, 120_000);
});
