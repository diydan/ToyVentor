import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fitOutline, type OutlineShape } from "../shared/outlineFit";
import { daemonSymmetryOf, fetchPlateStl, forgeRouteGate, OutlineGateError, type OutlineGateErrorKind, PLATE_STL_MAX_BYTES, pollDelayMs, type RouteGateOptions } from "../shared/outlineGate";
import { legalizeOutline, outlineToRecipeShape } from "../shared/photoOutline";
import { forgeRateLimited, forgeRateLimitWait, resetForgeRateLimit, type ForgeOptimizerEnv } from "../worker/forgeOptimizer";
import { DEVICE, fakeDaemon, forgeEnv, mintParentProof, viaWorker } from "./fixtures/forgeWorkerHarness";
import { randomBlob, SHAPES } from "./fixtures/outlineMasks";

// The real compile runs once per rung on a 400 x 400 mask, and the machine is often at load 50 or more.
vi.setConfig({ testTimeout: 60_000 });

const SHAPE: OutlineShape = { kind: "profile2d", points: [[0, 0], [10, 0], [10, 10]], fillet_r_mm: 1.6, grip_tu: 2 };
const JOB = "fjob_0123456789ab";

// ---- a scripted fetch and a clock that only moves when the gate sleeps --------------------------------------------

interface Step {
  status?: number;
  json?: unknown;
  raw?: string;
  bytes?: Uint8Array;
  headers?: Record<string, string>;
  throws?: Error;
}

function scripted(steps: Step[]) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    const step = steps[calls.length - 1];
    if (!step) throw new Error(`unscripted call ${calls.length}: ${init?.method} ${url}`);
    if (step.throws) throw step.throws;
    return new Response((step.bytes as BodyInit | undefined) ?? step.raw ?? JSON.stringify(step.json ?? {}), {
      status: step.status ?? 200,
      headers: { "content-type": "application/json", ...(step.headers ?? {}) },
    });
  };
  return { fetch, calls };
}

function fakeClock() {
  const slept: number[] = [];
  let t = 1_000_000;
  return {
    slept,
    now: () => t,
    sleep: async (ms: number) => {
      slept.push(ms);
      t += ms;
    },
  };
}

const started = (id = JOB) => ({ status: 200, json: { ok: true, status: "preview_ready", job_id: id } });
const running = (status = "validating") => ({ json: { ok: true, job_id: JOB, status } });
const REPORT_PASS = { ok: true, design_status: "ok", small_part: { status: "above_cylinder", min_enclosing_diameter_mm: 61 }, blocking_failures: [], brand_errors: [] };
const REPORT_MARGINAL = { ok: false, design_status: "marginal", small_part: { status: "marginal", min_enclosing_diameter_mm: 33.5 }, blocking_failures: [], brand_errors: [] };
const REPORT_SLIVER = { ok: false, design_status: "fail", small_part: { status: "above_cylinder", min_enclosing_diameter_mm: 45 }, blocking_failures: [{ id: "G1_watertight" }, { id: "G3_single_body" }], brand_errors: [] };
const done = (report: unknown, status = "print_ready") => ({ json: { ok: true, job_id: JOB, status, gate_report: report } });

function gateWith(steps: Step[], extra: Partial<RouteGateOptions> = {}) {
  const s = scripted(steps);
  const clock = fakeClock();
  const gate = forgeRouteGate({ fetch: s.fetch, sleep: clock.sleep, now: clock.now, ...extra });
  return { gate, calls: s.calls, clock };
}

async function errorOf(p: Promise<unknown>): Promise<OutlineGateError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof OutlineGateError) return e;
    throw e;
  }
  throw new Error("expected the gate to reject");
}

// ---- what is sent ------------------------------------------------------------------------------------------------

describe("forgeRouteGate: the requests", () => {
  it("starts a gate job with the hand recipe and no model bytes, then asks the job route for it", async () => {
    const { gate, calls } = gateWith([started(), done(REPORT_PASS)]);
    await gate(SHAPE);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe("/api/forge/preview");
    expect(calls[0]!.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      recipe: { name: "Photo outline", slot: "hand", shape: SHAPE },
      enqueue_background: true,
      include_glb_base64: false,
    });
    expect(calls[1]!.url).toBe(`/api/forge/jobs/${JOB}`);
    expect(calls[1]!.init?.method).toBe("GET");
    expect(calls[1]!.init?.body).toBeUndefined();
  });

  it("asks for the job route's base and recipe name the caller chose", async () => {
    const { gate, calls } = gateWith([started(), done(REPORT_PASS)], { base: "https://example.test/api/forge/", name: "Wand" });
    await gate(SHAPE);
    expect(calls[0]!.url).toBe("https://example.test/api/forge/preview");
    expect(JSON.parse(String(calls[0]!.init?.body)).recipe.name).toBe("Wand");
  });

  it("asks the caller for headers on every request, so a refreshed parent proof is picked up", async () => {
    let n = 0;
    const { gate, calls } = gateWith([started(), running(), done(REPORT_PASS)], { headers: () => ({ "x-parent-proof": `proof-${++n}` }) });
    await gate(SHAPE);
    expect(calls.map((c) => (c.init?.headers as Record<string, string>)["x-parent-proof"])).toEqual(["proof-1", "proof-2", "proof-3"]);
    expect((calls[0]!.init?.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect((calls[1]!.init?.headers as Record<string, string>)["content-type"]).toBeUndefined();
  });
});

// ---- polling and verdicts ----------------------------------------------------------------------------------------

describe("forgeRouteGate: polling", () => {
  it("waits 1 s, 1.5 s, 2 s, 2.5 s between polls while the job runs", async () => {
    const { gate, clock } = gateWith([started(), running("queued"), running("validating"), running("optimizing"), done(REPORT_PASS)]);
    await gate(SHAPE);
    expect(clock.slept).toEqual([1000, 1500, 2000, 2500]);
  });

  it("keeps the poll rate under the Worker's 30 a minute: never faster than one every 1 s, 20 a minute once settled", () => {
    for (let i = 0; i < 40; i++) expect(pollDelayMs(i)).toBeGreaterThanOrEqual(1000);
    expect(pollDelayMs(4)).toBe(3000);
    expect(pollDelayMs(40)).toBe(3000);
    expect(60_000 / pollDelayMs(40)).toBeLessThanOrEqual(20);
  });

  it("gives up with a timeout when the job never finishes, and stops polling", async () => {
    const steps: Step[] = [started(), ...Array.from({ length: 50 }, () => running("optimizing"))];
    const { gate, calls, clock } = gateWith(steps, { deadlineMs: 10_000 });
    const err = await errorOf(gate(SHAPE));
    expect(err.kind).toBe("timeout");
    expect(clock.slept.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(10_000);
    expect(calls.length).toBeLessThan(10);
  });
});

describe("forgeRouteGate: what the verdict is", () => {
  it("a print_ready job with a passing report is a pass, with the cylinder", async () => {
    const { gate } = gateWith([started(), done(REPORT_PASS)]);
    expect(await gate(SHAPE)).toEqual({ status: "pass", cylinderMm: 61, failures: [] });
  });

  it("a digital_only job with blocking failures is a fail that names them: the gate ran and said no, which is not an error", async () => {
    const { gate } = gateWith([started(), done(REPORT_SLIVER, "digital_only")]);
    expect(await gate(SHAPE)).toEqual({ status: "fail", cylinderMm: 45, failures: ["G1_watertight", "G3_single_body"] });
  });

  it("a digital_only job whose only signal is the small-parts band is marginal", async () => {
    const { gate } = gateWith([started(), done(REPORT_MARGINAL, "digital_only")]);
    expect(await gate(SHAPE)).toEqual({ status: "marginal", cylinderMm: 33.5, failures: [] });
  });

  it("a finished job with no report is a fail, never a pass", async () => {
    const { gate } = gateWith([started(), done(null, "digital_only")]);
    const v = await gate(SHAPE);
    expect(v.status).toBe("fail");
  });
});

// ---- the daemon's own symmetry note --------------------------------------------------------------------------------

describe("forgeRouteGate: the daemon's symmetry note", () => {
  const NOTE = { kind: "profile2d", axis_mm: 0.4, iou_before: 0.971, action: "mirrored_right_half", iou_after: 1, points: 112 };
  const withNote = (report: unknown, status: string, legalizer: unknown) => ({ json: { ok: true, job_id: JOB, status, gate_report: report, legalizer } });

  it("is carried into the verdict, whatever the verdict is: a pass, a fail and a marginal", async () => {
    for (const [report, status, want] of [[REPORT_PASS, "print_ready", "pass"], [REPORT_SLIVER, "digital_only", "fail"], [REPORT_MARGINAL, "digital_only", "marginal"]] as const) {
      const { gate } = gateWith([started(), withNote(report, status, { symmetry: NOTE })]);
      const v = await gate(SHAPE);
      expect(v.status).toBe(want);
      expect(v.daemonSymmetry).toEqual({ action: "mirrored_right_half", iouBefore: 0.971, iouAfter: 1, points: 112 });
    }
  });

  it("is absent when the job has none: the verdict has no such key at all", async () => {
    const { gate } = gateWith([started(), done(REPORT_PASS)]);
    expect("daemonSymmetry" in (await gate(SHAPE))).toBe(false);
    const { gate: g2 } = gateWith([started(), withNote(REPORT_PASS, "print_ready", null)]);
    expect("daemonSymmetry" in (await g2(SHAPE))).toBe(false);
  });

  it("reads a note that leaves the outline alone as what it is: kept_asymmetric is a note, not a rewrite", () => {
    expect(daemonSymmetryOf({ symmetry: { action: "kept_asymmetric", iou_before: 0.52 } })).toEqual({ action: "kept_asymmetric", iouBefore: 0.52, iouAfter: null, points: null });
  });

  it.each([
    ["no legalizer", undefined],
    ["a string", "mirrored_right_half"],
    ["an array", [{ symmetry: NOTE }]],
    ["no symmetry in it", { l2: { action: "rescaled" } }],
    ["symmetry as an array", { symmetry: [NOTE] }],
    ["an action that is not a string", { symmetry: { ...NOTE, action: 7 } }],
    ["an empty action", { symmetry: { ...NOTE, action: "" } }],
    ["an action with odd characters", { symmetry: { ...NOTE, action: "Mirrored right <b>" } }],
    ["an action 41 characters long", { symmetry: { ...NOTE, action: "a".repeat(41) } }],
  ] as const)("a note that cannot be read is no note: %s", (_name, legalizer) => {
    expect(daemonSymmetryOf(legalizer)).toBeUndefined();
  });

  it("takes only numbers it can use: a number that is not finite, or a string, is null, and the action is kept", () => {
    expect(daemonSymmetryOf({ symmetry: { action: "mirrored_left_half", iou_before: "0.97", iou_after: Number.POSITIVE_INFINITY, points: null } })).toEqual({
      action: "mirrored_left_half",
      iouBefore: null,
      iouAfter: null,
      points: null,
    });
  });
});

// ---- what is never a verdict -------------------------------------------------------------------------------------

describe("forgeRouteGate: when the gate could not run it throws, with a kind", () => {
  const cases: [number, OutlineGateErrorKind][] = [
    [401, "gate_required"],
    [429, "slow_down"],
    [503, "disabled"],
    [400, "rejected"],
    [413, "rejected"],
    [422, "rejected"],
    [504, "timeout"],
    [502, "unavailable"],
    [500, "unavailable"],
  ];

  it.each(cases)("preview answers %i: %s", async (status, kind) => {
    const { gate, calls } = gateWith([{ status, json: { ok: false, status: "x" } }]);
    const err = await errorOf(gate(SHAPE));
    expect(err).toBeInstanceOf(Error);
    expect(err.kind).toBe(kind);
    expect(err.httpStatus).toBe(status);
    expect(calls).toHaveLength(1); // and no retry
  });

  it.each(cases)("job route answers %i: %s", async (status, kind) => {
    const { gate, calls } = gateWith([started(), { status, json: { ok: false } }]);
    const err = await errorOf(gate(SHAPE));
    expect(err.kind).toBe(kind);
    expect(calls).toHaveLength(2);
  });

  it("a job the daemon lost (404) is unavailable", async () => {
    const { gate } = gateWith([started(), { status: 404, json: { ok: false, status: "not-found" } }]);
    expect((await errorOf(gate(SHAPE))).kind).toBe("unavailable");
  });

  it("reads retry-after on a 429, and ignores one that is not a number", async () => {
    const a = await errorOf(gateWith([{ status: 429, json: {}, headers: { "retry-after": "5" } }]).gate(SHAPE));
    expect(a.retryAfterS).toBe(5);
    const b = await errorOf(gateWith([{ status: 429, json: {}, headers: { "retry-after": "soon" } }]).gate(SHAPE));
    expect(b.retryAfterS).toBeUndefined();
    const c = await errorOf(gateWith([{ status: 429, json: {} }]).gate(SHAPE));
    expect(c.retryAfterS).toBeUndefined();
  });

  it("does not retry a refused call: it is one request and one error", async () => {
    const { gate, calls, clock } = gateWith([{ status: 429, json: {} }, started(), done(REPORT_PASS)]);
    await errorOf(gate(SHAPE));
    expect(calls).toHaveLength(1);
    expect(clock.slept).toEqual([]);
  });

  it("a dropped connection is unavailable, on the preview and on a poll", async () => {
    const a = gateWith([{ throws: new Error("socket hang up") }]);
    const ea = await errorOf(a.gate(SHAPE));
    expect(ea.kind).toBe("unavailable");
    expect(ea.message).toContain("socket hang up");
    const b = gateWith([started(), { throws: new Error("reset") }]);
    expect((await errorOf(b.gate(SHAPE))).kind).toBe("unavailable");
  });

  it("a job that ended failed is job_failed, not a fail verdict", async () => {
    const { gate } = gateWith([started(), running(), { json: { ok: false, job_id: JOB, status: "failed", error: "optimization failed" } }]);
    expect((await errorOf(gate(SHAPE))).kind).toBe("job_failed");
  });

  const badReplies: [string, Step[]][] = [
    ["a preview with no job id", [{ json: { ok: true, status: "preview_ready", job_id: null } }]],
    ["a job id that is not one the route would take", [{ json: { ok: true, job_id: "../../etc/passwd" } }]],
    ["a job id of the wrong length", [{ json: { ok: true, job_id: "fjob_abc" } }]],
    ["a preview body that is not JSON", [{ raw: "<html>", status: 200 }]],
    ["a preview body that is an array", [{ raw: "[1]" }]],
    ["a job with no status", [started(), { json: { ok: true } }]],
    ["a job status the gate has never heard of", [started(), { json: { ok: true, status: "optimised", gate_report: REPORT_PASS } }]],
  ];
  it.each(badReplies)("%s is bad_reply", async (_name, steps) => {
    const { gate } = gateWith(steps);
    expect((await errorOf(gate(SHAPE))).kind).toBe("bad_reply");
  });

  it("makes fitOutline reject, not return a made-up verdict", async () => {
    let call = 0;
    const gate = async (): Promise<never> => {
      call++;
      throw new OutlineGateError("slow_down", "busy");
    };
    await expect(fitOutline(SHAPES.disc(), { targetHeightMm: 54 }, gate)).rejects.toMatchObject({ kind: "slow_down" });
    expect(call).toBe(1);
  });
});

// ---- the plate of a passing job ------------------------------------------------------------------------------------

const PLATE = "custom_photo_outline.0123456789ab.stl";
const stlBytes = (n: number) => new Uint8Array(n).fill(7);
const jobWithPlate = (extra: Record<string, unknown> = {}, status = "print_ready", report: unknown = REPORT_PASS) => ({
  json: { ok: true, job_id: JOB, status, gate_report: report, stl_artifact: PLATE, glb_artifact: "custom_photo_outline.0123456789ab.glb", content_hash: "0123456789ab", ...extra },
});

describe("forgeRouteGate: the artifacts of a pass", () => {
  it("hands back the plate, the model file and the hash of the job that passed", async () => {
    const { gate } = gateWith([started(), jobWithPlate()]);
    expect(await gate(SHAPE)).toEqual({
      status: "pass",
      cylinderMm: 61,
      failures: [],
      artifacts: { jobId: JOB, stl: PLATE, glb: "custom_photo_outline.0123456789ab.glb", contentHash: "0123456789ab" },
    });
  });

  it("leaves the model file and hash null when the job does not name them", async () => {
    const { gate } = gateWith([started(), jobWithPlate({ glb_artifact: null, content_hash: 5 })]);
    expect((await gate(SHAPE)).artifacts).toEqual({ jobId: JOB, stl: PLATE, glb: null, contentHash: null });
  });

  it("reports none when the job names no plate, as a stand-in gate's job does not", async () => {
    const { gate } = gateWith([started(), done(REPORT_PASS)]);
    const v = await gate(SHAPE);
    expect(v.status).toBe("pass");
    expect("artifacts" in v).toBe(false);
  });

  it.each([
    ["a path", "../../etc/passwd.stl"],
    ["a draft", "custom_photo_outline.01234567.draft.stl"],
    ["a model file", "custom_photo_outline.0123456789ab.glb"],
    ["capitals", "Custom_Photo.0123456789ab.stl"],
    ["a short hash", "custom_photo_outline.0123456789a.stl"],
    ["a trailing path", `${PLATE}/..`],
    ["a number", 7],
    ["null", null],
  ])("reports none for a plate name that is %s", async (_name, stl) => {
    const { gate } = gateWith([started(), jobWithPlate({ stl_artifact: stl })]);
    const v = await gate(SHAPE);
    expect(v.status).toBe("pass");
    expect("artifacts" in v).toBe(false);
  });

  it("reports none unless the job is print_ready AND the report is a pass: a file beside a failing report, or a passing report on a part that is not print ready, is not a plate to print", async () => {
    const notReady = gateWith([started(), jobWithPlate({}, "digital_only", REPORT_PASS)]);
    expect((await notReady.gate(SHAPE)).status).toBe("pass");
    expect("artifacts" in (await gateWith([started(), jobWithPlate({}, "digital_only", REPORT_PASS)]).gate(SHAPE))).toBe(false);
    const failing = gateWith([started(), jobWithPlate({}, "print_ready", REPORT_SLIVER)]);
    const v = await failing.gate(SHAPE);
    expect(v.status).toBe("fail");
    expect("artifacts" in v).toBe(false);
  });

  it("reports none for a part the gates refused or called marginal, even if the job left a file", async () => {
    const refused = gateWith([started(), jobWithPlate({}, "digital_only", REPORT_SLIVER)]);
    expect("artifacts" in (await refused.gate(SHAPE))).toBe(false);
    const marginal = gateWith([started(), jobWithPlate({}, "digital_only", REPORT_MARGINAL)]);
    expect("artifacts" in (await marginal.gate(SHAPE))).toBe(false);
  });
});

describe("fetchPlateStl", () => {
  const fetcher = (steps: Step[]) => {
    const s = scripted(steps);
    return { ...s, run: (name = PLATE, extra: Parameters<typeof fetchPlateStl>[1] = {}) => fetchPlateStl(name, { fetch: s.fetch, ...extra }) };
  };

  it("asks the artifacts route for the plate, with the caller's headers, and returns the bytes", async () => {
    const { run, calls } = fetcher([{ bytes: stlBytes(500) }]);
    let n = 0;
    const bytes = await run(PLATE, { headers: () => ({ "x-parent-proof": `proof-${++n}` }) });
    expect(bytes).toEqual(stlBytes(500));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`/api/forge/artifacts/${PLATE}`);
    expect(calls[0]!.init?.method).toBe("GET");
    expect((calls[0]!.init?.headers as Record<string, string>)["x-parent-proof"]).toBe("proof-1");
  });

  it("takes the base the caller chose", async () => {
    const { run, calls } = fetcher([{ bytes: stlBytes(100) }]);
    await run(PLATE, { base: "https://example.test/api/forge/" });
    expect(calls[0]!.url).toBe(`https://example.test/api/forge/artifacts/${PLATE}`);
  });

  it.each([
    ["a path", "../../etc/passwd"],
    ["a draft", "custom_photo_outline.01234567.draft.stl"],
    ["a model file", "custom_photo_outline.0123456789ab.glb"],
    ["capitals", "Custom.0123456789ab.stl"],
    ["empty", ""],
    ["a query", `${PLATE}?x=1`],
  ])("refuses %s as a name, without asking the route", async (_name, bad) => {
    const { run, calls } = fetcher([{ bytes: stlBytes(100) }]);
    const err = await errorOf(run(bad));
    expect(err.kind).toBe("rejected");
    expect(calls).toHaveLength(0);
  });

  it.each([
    [401, "gate_required"],
    [429, "slow_down"],
    [503, "disabled"],
    [404, "unavailable"],
    [422, "rejected"],
    [500, "unavailable"],
    [504, "timeout"],
  ] as [number, OutlineGateErrorKind][])("answers %i: %s", async (status, kind) => {
    const { run } = fetcher([{ status, json: { ok: false } }]);
    const err = await errorOf(run());
    expect(err.kind).toBe(kind);
    expect(err.httpStatus).toBe(status);
  });

  it("reads retry-after on a 429", async () => {
    const { run } = fetcher([{ status: 429, json: {}, headers: { "retry-after": "5" } }]);
    expect((await errorOf(run())).retryAfterS).toBe(5);
  });

  it("gives no retry-after when a 429 sent none", async () => {
    const { run } = fetcher([{ status: 429, json: {} }]);
    const err = await errorOf(run());
    expect(err.kind).toBe("slow_down");
    expect(err.retryAfterS).toBeUndefined();
  });

  it("is unavailable when the connection drops, before or during the body", async () => {
    expect((await errorOf(fetcher([{ throws: new Error("socket hang up") }]).run())).kind).toBe("unavailable");
    const broken = async () => new Response(new ReadableStream({ start: (c) => c.error(new Error("cut")) }), { status: 200 });
    expect((await errorOf(fetchPlateStl(PLATE, { fetch: broken }))).kind).toBe("unavailable");
  });

  it("takes a file from the smallest binary STL (84 bytes) to the Worker's cap, and nothing outside it", async () => {
    expect((await fetcher([{ bytes: stlBytes(84) }]).run()).length).toBe(84);
    expect((await fetcher([{ bytes: stlBytes(PLATE_STL_MAX_BYTES) }]).run()).length).toBe(PLATE_STL_MAX_BYTES);
    for (const n of [0, 10, 83, PLATE_STL_MAX_BYTES + 1]) {
      const err = await errorOf(fetcher([{ bytes: stlBytes(n) }]).run());
      expect(err.kind, `${n} bytes`).toBe("bad_reply");
    }
  });

  it("refuses by the declared length before reading a body that is over the cap", async () => {
    const { run } = fetcher([{ bytes: stlBytes(200), headers: { "content-length": String(PLATE_STL_MAX_BYTES + 1) } }]);
    expect((await errorOf(run())).kind).toBe("bad_reply");
  });
});

// ---- through the real Worker routes ------------------------------------------------------------------------------

describe("forgeRouteGate through the real Worker routes", () => {
  let env: ForgeOptimizerEnv;
  let proof: string;

  beforeEach(async () => {
    resetForgeRateLimit();
    env = forgeEnv();
    proof = await mintParentProof(env);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    resetForgeRateLimit();
  });

  const gate = (extra: Partial<RouteGateOptions> = {}, e: ForgeOptimizerEnv = env) =>
    forgeRouteGate({ fetch: viaWorker(e), headers: () => ({ "x-device-id": DEVICE, "x-parent-proof": proof }), sleep: async () => {}, ...extra });

  it("takes a marginal result, rescales, and passes: the daemon sees both outlines, byte for byte", async () => {
    const daemon = fakeDaemon([REPORT_MARGINAL, REPORT_PASS]);
    const seen: OutlineShape[] = [];
    const inner = gate();
    const result = await fitOutline(SHAPES.disc(), { targetHeightMm: 33 }, async (shape) => {
      seen.push(shape);
      return inner(shape);
    });
    expect(result.ok).toBe(true);
    expect(result.attempts.map((a) => `${a.kind}:${a.status}`)).toEqual(["first:marginal", "rescale:pass"]);
    expect(daemon.recipes).toHaveLength(2);
    expect(seen).toHaveLength(2);
    for (let i = 0; i < 2; i++) {
      const sent = daemon.recipes[i].recipe;
      expect(sent.slot).toBe("hand");
      expect(sent.name).toBe("Photo outline");
      expect(sent.shape).toEqual(seen[i]); // the allowlist rebuilds the recipe and must not change a point
      expect(daemon.recipes[i]).toMatchObject({ enqueue_background: true, include_glb_base64: false });
    }
    const height = (s: OutlineShape) => Math.max(...s.points.map((p) => p[1])) - Math.min(...s.points.map((p) => p[1]));
    expect(height(seen[1]!)).toBeGreaterThan(height(seen[0]!) * 1.03);
  });

  it("takes a sliver, nudges 2%, and passes", async () => {
    fakeDaemon([REPORT_SLIVER, REPORT_PASS]);
    const result = await fitOutline(SHAPES.paddle(), { targetHeightMm: 40 }, gate());
    expect(result.ok).toBe(true);
    expect(result.attempts.map((a) => `${a.kind}:${a.status}`)).toEqual(["first:fail", "size_nudge:pass"]);
    expect(result.attempts[0]!.failures).toEqual(["G1_watertight", "G3_single_body"]);
  });

  it("passes the daemon's symmetry note through the allowlist, those four fields and nothing else of its legalizer notes", async () => {
    fakeDaemon([REPORT_PASS], {
      legalizers: [{
        symmetry: { kind: "profile2d", axis_mm: 0.4, iou_before: 0.971, action: "mirrored_right_half", iou_after: 1, points: 112, why: "internal wording", secret: "S3CRET" },
        l2: { action: "rescaled", factor: 1.04 },
        features_dropped: [{ kind: "ears", why: "internal" }],
      }],
    });
    const v = await gate()({ kind: "profile2d", points: [[-5, 0], [5, 0], [5, 10], [-5, 10]], fillet_r_mm: 1.6, grip_tu: 2 });
    expect(v.daemonSymmetry).toEqual({ action: "mirrored_right_half", iouBefore: 0.971, iouAfter: 1, points: 112 });
    const res = await viaWorker(env)("/api/forge/jobs/fjob_000000000001", { method: "GET", headers: { "x-device-id": DEVICE, "x-parent-proof": proof } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.legalizer).toEqual({ symmetry: { action: "mirrored_right_half", iou_before: 0.971, iou_after: 1, points: 112 } });
    expect(JSON.stringify(body)).not.toMatch(/S3CRET|internal|features_dropped|rescaled/);
  });

  it.each([
    ["an action with odd characters", { symmetry: { action: "Mirrored <b>", iou_before: 0.9 } }],
    ["an action that is not a string", { symmetry: { action: 7, iou_before: 0.9 } }],
    ["an action 41 characters long", { symmetry: { action: "a".repeat(41) } }],
    ["symmetry that is not an object", { symmetry: "mirrored_right_half" }],
    ["no symmetry note, only other notes", { l2: { action: "rescaled" } }],
    ["a legalizer that is not an object", "mirrored_right_half"],
  ] as const)("a note the Worker cannot trust does not go out: %s", async (_name, legalizer) => {
    fakeDaemon([REPORT_PASS], { legalizers: [legalizer] });
    await gate()({ kind: "profile2d", points: [[-5, 0], [5, 0], [5, 10], [-5, 10]], fillet_r_mm: 1.6, grip_tu: 2 });
    const res = await viaWorker(env)("/api/forge/jobs/fjob_000000000001", { method: "GET", headers: { "x-device-id": DEVICE, "x-parent-proof": proof } });
    expect(((await res.json()) as Record<string, unknown>).legalizer).toBeNull();
  });

  it("sends a number only as a number: a string where a number belongs goes out as null, the action stays", async () => {
    fakeDaemon([REPORT_PASS], { legalizers: [{ symmetry: { action: "mirrored_left_half", iou_before: "0.97", iou_after: [1], points: { n: 100 } } }] });
    await gate()({ kind: "profile2d", points: [[-5, 0], [5, 0], [5, 10], [-5, 10]], fillet_r_mm: 1.6, grip_tu: 2 });
    const res = await viaWorker(env)("/api/forge/jobs/fjob_000000000001", { method: "GET", headers: { "x-device-id": DEVICE, "x-parent-proof": proof } });
    expect(((await res.json()) as Record<string, unknown>).legalizer).toEqual({ symmetry: { action: "mirrored_left_half", iou_before: null, iou_after: null, points: null } });
  });

  it("says legalizer: null when the daemon had no note, so the field is always there", async () => {
    fakeDaemon([REPORT_PASS]);
    await gate()({ kind: "profile2d", points: [[-5, 0], [5, 0], [5, 10], [-5, 10]], fillet_r_mm: 1.6, grip_tu: 2 });
    const res = await viaWorker(env)("/api/forge/jobs/fjob_000000000001", { method: "GET", headers: { "x-device-id": DEVICE, "x-parent-proof": proof } });
    expect(((await res.json()) as Record<string, unknown>).legalizer).toBeNull();
  });

  it("lets through every outline the legalizer makes: the Worker's allowlist never refuses one", async () => {
    const daemon = fakeDaemon([REPORT_PASS]);
    const g = gate();
    const masks = [
      ...Object.entries(SHAPES).map(([name, make]) => [name, make()] as const),
      ...[1, 2, 3, 4].map((i) => [`blob${i}`, randomBlob(i)] as const),
    ];
    let sent = 0;
    for (const [name, mask] of masks) {
      for (const h of [24, 54, 90]) {
        const out = legalizeOutline(mask, { targetHeightMm: h });
        if (!out.ok) continue; // a thin or split shape the legalizer refuses never reaches the gate
        const shape = outlineToRecipeShape(out);
        const before = daemon.recipes.length;
        const v = await g(shape);
        expect(v.status, `${name}@${h}`).toBe("pass");
        expect(daemon.recipes, `${name}@${h}`).toHaveLength(before + 1);
        expect(daemon.recipes[before].recipe.shape, `${name}@${h}`).toEqual(shape);
        sent++;
        resetForgeRateLimit(); // this test is about the allowlist, not the budget
      }
    }
    expect(sent).toBeGreaterThanOrEqual(15); // guard: the loop above must have exercised the route
  });

  it("the Worker's allowlist takes an outline of exactly 256 points and refuses 257: the limit is the daemon's, and it is the same number", async () => {
    const daemon = fakeDaemon([REPORT_PASS]);
    const ring = (n: number): OutlineShape => ({
      kind: "profile2d",
      points: Array.from({ length: n }, (_, i): [number, number] => [Math.round(20 * Math.cos((i / n) * 2 * Math.PI) * 100) / 100, Math.round((25 + 20 * Math.sin((i / n) * 2 * Math.PI)) * 100) / 100]),
      fillet_r_mm: 1.6,
      grip_tu: 2,
    });
    const g = gate();
    expect((await g(ring(256))).status).toBe("pass");
    expect(daemon.recipes).toHaveLength(1);
    expect(daemon.recipes[0].recipe.shape.points).toHaveLength(256); // forwarded whole
    const err = await errorOf(g(ring(257)));
    expect(err.kind).toBe("rejected");
    expect(daemon.recipes).toHaveLength(1); // the 257 point outline never reached the daemon
    expect((await g(ring(65))).status).toBe("pass"); // and the old limit of 64 is gone
  });

  it("a fourth gate call inside a minute is slow_down, and it never reaches the daemon", async () => {
    const daemon = fakeDaemon([REPORT_PASS]);
    const g = gate();
    for (let i = 0; i < 3; i++) expect((await g(SHAPE)).status).toBe("pass");
    const err = await errorOf(g(SHAPE));
    expect(err.kind).toBe("slow_down");
    expect(err.httpStatus).toBe(429);
    expect(daemon.recipes).toHaveLength(3);
  });

  it("a refused call counts against the window, so retrying inside it keeps the caller locked out (why the gate never retries)", () => {
    const t0 = 5_000_000;
    const at = (s: number) => t0 + s * 1000;
    expect([0, 1, 2].map((s) => forgeRateLimited("preview", DEVICE, null, at(s)))).toEqual([false, false, false]);
    // A caller that retries every 15 s: each try is refused, and a minute after the first three it is still refused.
    expect([15, 30, 45, 61].map((s) => forgeRateLimited("preview", DEVICE, null, at(s)))).toEqual([true, true, true, true]);
    // A caller that waited the whole minute would have been let in.
    resetForgeRateLimit();
    [0, 1, 2].forEach((s) => forgeRateLimited("preview", DEVICE, null, at(s)));
    expect(forgeRateLimited("preview", DEVICE, null, at(61))).toBe(false);
  });

  describe("the retry time the limiter names", () => {
    const t0 = 9_000_000;
    const at = (s: number) => t0 + s * 1000;
    const DEV = (n: number) => `1234567${n}-1234-1234-1234-123456789abc`;

    /** Replays calls at these times (seconds, may be fractional) on one device and returns the last answer, in seconds to wait (0 = let in). */
    const replay = (secs: number[], device = DEVICE, ip: string | null = null) => {
      let last = 0;
      for (const s of secs) last = forgeRateLimitWait("preview", device, ip, at(s));
      return last;
    };

    it("is 0 for a call that is let in, and for the first three of a minute", () => {
      expect([0, 1, 2].map((s) => forgeRateLimitWait("preview", DEVICE, null, at(s)))).toEqual([0, 0, 0]);
    });

    it("names the time the oldest hit that still counts leaves the window: a fourth call at 5 s waits until 61 s", () => {
      replay([0, 1, 2]);
      expect(forgeRateLimitWait("preview", DEVICE, null, at(5))).toBe(56); // 1 s + 60 s - 5 s
    });

    it("grows with each refused call, because a refused call counts: a fifth call at 10 s waits until 62 s", () => {
      replay([0, 1, 2, 5]);
      expect(forgeRateLimitWait("preview", DEVICE, null, at(10))).toBe(52); // 2 s + 60 s - 10 s
    });

    it("is never over a window and never under a second", () => {
      for (const gap of [0, 0.001, 0.5, 30, 59.9]) {
        resetForgeRateLimit();
        const w = replay([0, 0, 0, gap]);
        expect(w).toBeGreaterThanOrEqual(1);
        expect(w).toBeLessThanOrEqual(60);
      }
    });

    it("is the smallest whole number of seconds that works: a call at the named time is let in and a call a second sooner is not (500 random call patterns)", () => {
      let seed = 20261103;
      const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
      let refusals = 0;
      for (let k = 0; k < 500; k++) {
        const n = 4 + Math.floor(rnd() * 9);
        const secs: number[] = [];
        let now = 0;
        for (let i = 0; i < n; i++) {
          now += rnd() < 0.3 ? 0 : Math.round(rnd() * 25_000) / 1000;
          secs.push(now);
        }
        resetForgeRateLimit();
        const w = replay(secs);
        if (w === 0) continue;
        refusals++;
        const last = secs[secs.length - 1]!;
        resetForgeRateLimit();
        replay(secs);
        expect(forgeRateLimitWait("preview", DEVICE, null, at(last + w)), `pattern ${k}: at the named ${w} s`).toBe(0);
        resetForgeRateLimit();
        replay(secs);
        expect(forgeRateLimitWait("preview", DEVICE, null, at(last + w - 1)), `pattern ${k}: a second before the named ${w} s`).toBeGreaterThan(0);
      }
      expect(refusals).toBeGreaterThan(200); // guard: the patterns really did cause refusals
    });

    it("counts the address's budget too: seven different devices from one address, the seventh is refused for the address's sake", () => {
      const waits = [0, 1, 2, 3, 4, 5, 6].map((s, i) => forgeRateLimitWait("preview", DEV(i), "203.0.113.7", at(s)));
      expect(waits.slice(0, 6)).toEqual([0, 0, 0, 0, 0, 0]);
      expect(waits[6]).toBe(55); // the second hit (1 s) + 60 s - 6 s
    });

    it("when the device and the address both refuse, the longer wait is named", () => {
      const waits = [0, 1, 2, 3, 4, 5, 6].map((s) => forgeRateLimitWait("preview", DEVICE, "203.0.113.8", at(s)));
      // The device budget is 3, so its seventh call waits until the fifth hit (4 s) is a window old: 58 s. The address budget is 6: 55 s.
      expect(waits[6]).toBe(58);
    });

    it("the boolean form says the same as the wait", () => {
      expect([0, 1, 2, 5].map((s) => forgeRateLimited("preview", DEVICE, null, at(s)))).toEqual([false, false, false, true]);
    });

    it("the Worker's refusal carries it as a retry-after header, a whole number of seconds from 1 to 60, and the gate reads it", async () => {
      fakeDaemon([REPORT_PASS]);
      const g = gate();
      for (let i = 0; i < 3; i++) await g(SHAPE);
      const err = await errorOf(g(SHAPE));
      expect(err.kind).toBe("slow_down");
      expect(Number.isInteger(err.retryAfterS)).toBe(true);
      expect(err.retryAfterS).toBeGreaterThanOrEqual(1);
      expect(err.retryAfterS).toBeLessThanOrEqual(60);
      const raw = await viaWorker(env)("/api/forge/preview", { method: "POST", headers: { "content-type": "application/json", "x-device-id": DEVICE, "x-parent-proof": proof }, body: JSON.stringify({ recipe: { name: "x", slot: "hand", shape: SHAPE }, enqueue_background: true, include_glb_base64: false }) });
      expect(raw.status).toBe(429);
      expect(raw.headers.get("retry-after")).toMatch(/^\d{1,2}$/);
      expect(await raw.json()).toEqual({ ok: false, status: "slow-down" });
    });

    it("the header is exactly the limiter's wait: three calls in two seconds and a fourth five seconds in is told 56 s", async () => {
      fakeDaemon([REPORT_PASS]);
      const t = Date.now();
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        const g = gate();
        for (const s of [0, 1, 2]) {
          vi.setSystemTime(t + s * 1000);
          expect((await g(SHAPE)).status).toBe("pass");
        }
        vi.setSystemTime(t + 5000);
        const err = await errorOf(g(SHAPE));
        expect(err.retryAfterS).toBe(56); // the second call (1 s) leaves the window at 61 s
        vi.setSystemTime(t + 5000 + 56_000); // asking at the named time is let in
        expect((await g(SHAPE)).status).toBe("pass");
      } finally {
        vi.useRealTimers();
      }
    });

    it("a call that is let in has no retry-after", async () => {
      fakeDaemon([REPORT_PASS]);
      const raw = await viaWorker(env)("/api/forge/preview", { method: "POST", headers: { "content-type": "application/json", "x-device-id": DEVICE, "x-parent-proof": proof }, body: JSON.stringify({ recipe: { name: "x", slot: "hand", shape: SHAPE }, enqueue_background: true, include_glb_base64: false }) });
      expect(raw.status).toBe(200);
      expect(raw.headers.get("retry-after")).toBeNull();
    });
  });

  it("no parent proof is gate_required", async () => {
    fakeDaemon([REPORT_PASS]);
    const err = await errorOf(gate({ headers: () => ({ "x-device-id": DEVICE }) })(SHAPE));
    expect(err.kind).toBe("gate_required");
  });

  it("an optimizer that is not configured is disabled", async () => {
    fakeDaemon([REPORT_PASS]);
    const off: ForgeOptimizerEnv = { DB: env.DB, PARENT_GATE_SECRET: env.PARENT_GATE_SECRET };
    const err = await errorOf(gate({}, off)(SHAPE));
    expect(err.kind).toBe("disabled");
  });

  it("a daemon with a full queue is slow_down with its retry-after passed through", async () => {
    fakeDaemon([REPORT_PASS], { previewStatus: 429, previewHeaders: { "retry-after": "5" } });
    const err = await errorOf(gate()(SHAPE));
    expect(err.kind).toBe("slow_down");
    expect(err.retryAfterS).toBe(5);
  });

  it("a recipe the daemon refuses is rejected, not a verdict", async () => {
    fakeDaemon([REPORT_PASS], { previewStatus: 422 });
    expect((await errorOf(gate()(SHAPE))).kind).toBe("rejected");
  });

  it("a job the daemon ends failed is job_failed", async () => {
    fakeDaemon([REPORT_PASS], { jobStatus: "failed" });
    expect((await errorOf(gate()(SHAPE))).kind).toBe("job_failed");
  });

  it("carries the plate through the Worker: the verdict names it and fetchPlateStl gets the daemon's bytes, unchanged", async () => {
    const bytes = Uint8Array.from({ length: 1234 }, (_, i) => (i * 31) % 251);
    const daemon = fakeDaemon([REPORT_PASS], { plate: { name: PLATE, bytes } });
    const v = await gate()(SHAPE);
    expect(v.artifacts).toEqual({ jobId: "fjob_000000000001", stl: PLATE, glb: "custom_photo_outline.0123456789ab.glb", contentHash: "0123456789ab" });
    const got = await fetchPlateStl(PLATE, { fetch: viaWorker(env), headers: () => ({ "x-device-id": DEVICE, "x-parent-proof": proof }) });
    expect(got).toEqual(bytes);
    expect(daemon.artifactRequests).toEqual([PLATE]);
  });

  it("the Worker's artifacts route wants the grown-up proof, and 404s a plate the daemon does not have", async () => {
    const daemon = fakeDaemon([REPORT_PASS], { plate: { name: PLATE, bytes: stlBytes(300) } });
    const noProof = await errorOf(fetchPlateStl(PLATE, { fetch: viaWorker(env), headers: () => ({ "x-device-id": DEVICE }) }));
    expect(noProof.kind).toBe("gate_required");
    expect(daemon.artifactRequests).toHaveLength(0);
    const missing = await errorOf(fetchPlateStl("other_part.0123456789ab.stl", { fetch: viaWorker(env), headers: () => ({ "x-device-id": DEVICE, "x-parent-proof": proof }) }));
    expect(missing.kind).toBe("unavailable");
    expect(missing.httpStatus).toBe(404);
  });

  it("never asks the Worker for a name it would not serve: nothing reaches the daemon", async () => {
    const daemon = fakeDaemon([REPORT_PASS], { plate: { name: PLATE, bytes: stlBytes(300) } });
    for (const bad of ["custom_photo_outline.01234567.draft.stl", "../x.stl"]) {
      await errorOf(fetchPlateStl(bad, { fetch: viaWorker(env), headers: () => ({ "x-device-id": DEVICE, "x-parent-proof": proof }) }));
    }
    expect(daemon.artifactRequests).toHaveLength(0);
  });

  it("passes the small-parts facts through the Worker's scrub: small_part reaches the verdict", async () => {
    fakeDaemon([REPORT_MARGINAL]);
    expect(await gate()(SHAPE)).toEqual({ status: "marginal", cylinderMm: 33.5, failures: [] });
  });
});

// ---- the module stays free of the browser and the Worker ---------------------------------------------------------

describe("outlineGate.ts", () => {
  it("imports only the loop", () => {
    const src = readFileSync(join(__dirname, "..", "shared", "outlineGate.ts"), "utf8");
    const imports = [...src.matchAll(/^import .* from "(.*)";$/gm)].map((m) => m[1]);
    expect(imports).toEqual(["./outlineFit"]);
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""); // the comments talk about "the window"
    expect(code.length).toBeGreaterThan(1000); // guard: stripping comments did not strip the module
    expect(code).not.toMatch(/\bwindow\b|\bdocument\b|localStorage|\bprocess\./);
  });
});
