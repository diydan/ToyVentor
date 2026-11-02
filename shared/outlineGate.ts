/**
 * The fit loop's gate, run through the Worker's forge routes (docs/specs/forge-ai-spec.md, "F2b", step 4).
 *
 * `fitOutline` takes an `OutlineGate`: a function from an outline to "pass", "marginal" or "fail". This file builds one
 * out of the two routes the Worker already has, so the real compile and gates run in the optimizer daemon behind the
 * parent gate and the rate limits:
 *
 *   POST /api/forge/preview     a hand recipe, `enqueue_background: true`      -> `job_id`
 *   GET  /api/forge/jobs/:id    until the job is `print_ready` or `digital_only` -> `gate_report`
 *
 * What this module does not do, on purpose:
 *   - It never turns "the gate could not run" into a verdict. A refused call, a gate that is off, a slow daemon or a
 *     job that failed all throw an `OutlineGateError` with a `kind`, and `fitOutline` rejects the whole call. A part is
 *     never called passing because the gate went quiet, and never called failing because a limit was hit.
 *   - It never retries a refused call. The Worker's limiter counts a refused call as a hit, so retrying inside the
 *     window keeps the caller locked out (measured 2026-11-02: six retries 15 s apart, all refused). The caller reads
 *     `kind` and `retryAfterS` and decides when to ask again.
 *   - It holds no secrets. The caller's `headers` supplies `x-device-id` and `x-parent-proof`.
 *
 * Pure apart from the injected `fetch` and `sleep`; imports only the loop.
 */

import { type OutlineGate, type OutlineShape, verdictFromGateReport } from "./outlineFit";

export type OutlineGateErrorKind =
  /** 429: the Worker's per-device or per-IP budget (preview 3 a minute, poll 30 a minute) or the daemon's queue is full. */
  | "slow_down"
  /** 401: no live parent proof. Needs the grown-up gate again. */
  | "gate_required"
  /** 503: the optimizer is not configured on this Worker. */
  | "disabled"
  /** 422, 400 or 413: the recipe was refused before any gate ran (a degenerate outline, say). Retrying the same outline will not help. */
  | "rejected"
  /** 502, a dropped connection, or a daemon that is down. */
  | "unavailable"
  /** 504, or the job did not finish inside the deadline. */
  | "timeout"
  /** The job ended `failed`: the daemon threw before it had a gate report. */
  | "job_failed"
  /** A reply that does not have the shape the routes promise (no job id, an unknown job status). */
  | "bad_reply";

export class OutlineGateError extends Error {
  readonly kind: OutlineGateErrorKind;
  readonly httpStatus?: number;
  /** Seconds the server asked us to wait (the `retry-after` header), when it sent one. */
  readonly retryAfterS?: number;
  constructor(kind: OutlineGateErrorKind, message: string, extra: { httpStatus?: number; retryAfterS?: number } = {}) {
    super(message);
    this.name = "OutlineGateError";
    this.kind = kind;
    if (extra.httpStatus !== undefined) this.httpStatus = extra.httpStatus;
    if (extra.retryAfterS !== undefined) this.retryAfterS = extra.retryAfterS;
  }
}

/** Job states the daemon reports while it is still working (scripts/forge_optimizer_daemon.py). */
const JOB_RUNNING = new Set(["queued", "validating", "optimizing"]);
/** Job states that carry a gate report. `digital_only` is a part the gates refused, not an error. */
const JOB_DONE = new Set(["print_ready", "digital_only"]);
const JOB_ID_RE = /^fjob_[a-f0-9]{12}$/;

/** The poll budget is 30 a minute a device, so the wait grows: 1 s, 1.5 s, 2 s, then 3 s and up (20 a minute). */
export function pollDelayMs(poll: number): number {
  return Math.min(3000, 1000 + 500 * poll);
}

export interface RouteGateOptions {
  /** `fetch`, or a wrapper around it; the default is the global one. Paths are relative to `base`. */
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  /** Added to every request: `x-device-id`, `x-parent-proof`. Called per request so a refreshed proof is picked up. */
  headers?: () => Record<string, string> | Promise<Record<string, string>>;
  /** Where the forge routes live. Default `/api/forge`. */
  base?: string;
  /** The recipe name. Default "Photo outline". */
  name?: string;
  /** Give up on one job after this long. Default 90 s (the daemon takes 1.5 to 15 s; 3 to 31 s was seen at load average 55). */
  deadlineMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

function kindForStatus(status: number): OutlineGateErrorKind {
  if (status === 401) return "gate_required";
  if (status === 429) return "slow_down";
  if (status === 503) return "disabled";
  if (status === 400 || status === 413 || status === 422) return "rejected";
  if (status === 504) return "timeout";
  return "unavailable";
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** An `OutlineGate` that runs each outline through the Worker's forge preview and job routes. */
export function forgeRouteGate(options: RouteGateOptions = {}): OutlineGate {
  const doFetch = options.fetch ?? ((url: string, init?: RequestInit) => fetch(url, init));
  const base = (options.base ?? "/api/forge").replace(/\/+$/, "");
  const name = options.name ?? "Photo outline";
  const deadlineMs = options.deadlineMs ?? 90_000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.now ?? Date.now;

  async function call(path: string, init: { method: "GET" | "POST"; body?: string }): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      const extra = options.headers ? await options.headers() : {};
      res = await doFetch(`${base}${path}`, {
        method: init.method,
        headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...extra },
        ...(init.body ? { body: init.body } : {}),
      });
    } catch (err) {
      throw new OutlineGateError("unavailable", `could not reach the forge route: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (res.status < 200 || res.status >= 300) {
      const retry = Number(res.headers.get("retry-after"));
      throw new OutlineGateError(kindForStatus(res.status), `forge route answered ${res.status}`, {
        httpStatus: res.status,
        ...(Number.isFinite(retry) && retry > 0 ? { retryAfterS: retry } : {}),
      });
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new OutlineGateError("bad_reply", "forge route sent a body that is not JSON", { httpStatus: res.status });
    }
    if (!isRecord(json)) throw new OutlineGateError("bad_reply", "forge route sent something other than an object", { httpStatus: res.status });
    return json;
  }

  return async (shape: OutlineShape) => {
    const started = await call("/preview", {
      method: "POST",
      body: JSON.stringify({ recipe: { name, slot: "hand", shape }, enqueue_background: true, include_glb_base64: false }),
    });
    const jobId = started.job_id;
    if (typeof jobId !== "string" || !JOB_ID_RE.test(jobId)) {
      throw new OutlineGateError("bad_reply", "the preview did not start a gate job");
    }
    const t0 = now();
    for (let poll = 0; ; poll++) {
      if (now() - t0 >= deadlineMs) throw new OutlineGateError("timeout", `the gate job did not finish in ${Math.round(deadlineMs / 1000)} s`);
      await sleep(pollDelayMs(poll));
      const job = await call(`/jobs/${jobId}`, { method: "GET" });
      const status = job.status;
      if (typeof status !== "string") throw new OutlineGateError("bad_reply", "the job has no status");
      if (JOB_RUNNING.has(status)) continue;
      if (status === "failed") throw new OutlineGateError("job_failed", "the gate job failed before it produced a report");
      if (!JOB_DONE.has(status)) throw new OutlineGateError("bad_reply", `unknown job status "${status}"`);
      return verdictFromGateReport(job.gate_report);
    }
  };
}
