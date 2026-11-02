import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fitOutline, type OutlineShape } from "../shared/outlineFit";
import { forgeRouteGate, OutlineGateError, type OutlineGateErrorKind, pollDelayMs, type RouteGateOptions } from "../shared/outlineGate";
import { legalizeOutline, outlineToRecipeShape } from "../shared/photoOutline";
import { forgeRateLimited, resetForgeRateLimit, type ForgeOptimizerEnv } from "../worker/forgeOptimizer";
import worker from "../worker/index";
import type { D1Like } from "../worker/ownership";
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
    return new Response(step.raw ?? JSON.stringify(step.json ?? {}), {
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

// ---- through the real Worker routes ------------------------------------------------------------------------------

const DEVICE = "12345678-1234-1234-1234-123456789abc";

function fakeDb(): D1Like {
  const settings = new Map<string, string>();
  return {
    prepare: (sql) => ({
      bind: (...values: unknown[]) => ({
        run: async () => {
          if (sql.includes("INSERT INTO parent_settings")) {
            const [id, text] = values as [string, string];
            if (!(sql.includes("DO NOTHING") && settings.has(id))) settings.set(id, text);
          }
          return {};
        },
        all: async () => {
          if (sql.includes("FROM parent_settings")) {
            const v = settings.get(values[0] as string);
            return { results: v !== undefined ? [{ settings_json: v }] : [] };
          }
          return { results: [] };
        },
      }),
    }),
  };
}

async function mintParentProof(env: ForgeOptimizerEnv): Promise<string> {
  const callGate = (body: object) =>
    worker.fetch(
      new Request("http://local/api/parent/gate", { method: "POST", headers: { "content-type": "application/json", "x-device-id": DEVICE }, body: JSON.stringify(body) }),
      env as never,
    );
  const ch = (await (await callGate({ action: "challenge" })).json()) as { a: number; b: number; challengeToken: string };
  const verified = await callGate({ action: "verify", challengeToken: ch.challengeToken, answer: ch.a * ch.b });
  return ((await verified.json()) as { proofToken: string }).proofToken;
}

/** The optimizer daemon, as the Worker sees it: records what it is sent, answers from a script. */
function fakeDaemon(reports: unknown[], overrides: { previewStatus?: number; previewHeaders?: Record<string, string>; jobStatus?: string } = {}) {
  const recipes: any[] = [];
  const jobs = new Map<string, unknown>();
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const path = new URL(url).pathname;
    if (path === "/v1/fast-preview") {
      if (overrides.previewStatus) return json({ ok: false, status: "x" }, overrides.previewStatus, overrides.previewHeaders ?? {});
      const body = JSON.parse(String(init?.body));
      recipes.push(body);
      const id = `fjob_${String(recipes.length).padStart(12, "0")}`;
      jobs.set(id, reports[recipes.length - 1] ?? reports.at(-1));
      return json({ ok: true, status: "preview_ready", part_id: "custom_photo_outline", job_id: id, draft_artifact: "", glb_size: 1, orig_tris: 1, web_verts: 1, web_tris: 1, finish_class: "show_curved", elapsed_ms: 1 });
    }
    const m = /^\/v1\/jobs\/(fjob_[a-f0-9]{12})$/.exec(path);
    if (m) {
      const report: any = jobs.get(m[1]!);
      if (report === undefined) return json({ ok: false, status: "not-found" }, 404);
      return json({ ok: true, job_id: m[1], part_id: "custom_photo_outline", status: overrides.jobStatus ?? (report.ok ? "print_ready" : "digital_only"), gate_report: report });
    }
    return json({ ok: false }, 404);
  });
  return { recipes, spy };
}

describe("forgeRouteGate through the real Worker routes", () => {
  let env: ForgeOptimizerEnv;
  let proof: string;

  beforeEach(async () => {
    resetForgeRateLimit();
    env = { DB: fakeDb(), PARENT_GATE_SECRET: "gate-secret-for-tests", FORGE_OPTIMIZER_URL: "http://127.0.0.1:8791" };
    proof = await mintParentProof(env);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    resetForgeRateLimit();
  });

  const viaWorker = (e: ForgeOptimizerEnv = env) => async (url: string, init?: RequestInit) => worker.fetch(new Request(`http://local${url}`, init), e as never);
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
