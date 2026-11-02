/**
 * Pure helpers for scripts/forge-eval.ts (see docs/specs/forge-ai-spec.md, "Eval harness").
 *
 * `legalizeLoft` is a REPORT-ONLY mirror of `legalize_loft_slices` in
 * scripts/forge_optimizer_daemon.py. The daemon always applies its own clamp; this copy only
 * tells the eval what the clamp would change, because the daemon does not report it.
 * tests/forge/forge-eval-core.test.ts checks it against the Python outputs. If the daemon's
 * clamp changes, update both.
 */

export type SliceRow = [z: number, w: number, d: number, r: number, x: number, y: number];

export interface LoftChange {
  kind: "slope" | "bounds" | "spacing";
  index: number;
  field: "z" | "w" | "d" | "r" | "x" | "y";
  from: number;
  to: number;
}

export type LoftResult =
  | { ok: true; slices: SliceRow[]; changes: LoftChange[] }
  | { ok: false; error: string };

const EPS = 1e-9;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown, fallback: number): number | null {
  const x = v === undefined ? fallback : v;
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Mirror of the daemon's L1 slope clamp plus its L3 bounds, with a change log. */
export function legalizeLoft(rawSlices: unknown): LoftResult {
  if (!Array.isArray(rawSlices) || rawSlices.length < 2 || rawSlices.length > 16) {
    return { ok: false, error: "slices must contain between 2 and 16 slices" };
  }
  const changes: LoftChange[] = [];
  const rows: SliceRow[] = [];
  for (let i = 0; i < rawSlices.length; i++) {
    const s: unknown = rawSlices[i];
    if (!isRecord(s)) return { ok: false, error: "invalid loft slice" };
    const rz = num(s.z, 0);
    const rw = num(s.w, 16);
    const rd = num(s.d, 12);
    const rr = num(s.r, 3);
    const rx = num(s.x, 0);
    const ry = num(s.y, 0);
    if (rz === null || rw === null || rd === null || rr === null || rx === null || ry === null) {
      return { ok: false, error: "loft slice values must be finite numbers" };
    }
    const z = clamp(rz, -20, 140);
    const w = clamp(rw, 3.6, 90);
    const d = clamp(rd, 3.6, 90);
    const r = clamp(rr, 0.8, 0.48 * Math.min(w, d));
    const x = clamp(rx, -35, 35);
    const y = clamp(ry, -35, 35);
    const log = (field: LoftChange["field"], from: number, to: number) => {
      if (Math.abs(from - to) > EPS) changes.push({ kind: "bounds", index: i, field, from, to });
    };
    log("z", rz, z);
    log("w", rw, w);
    log("d", rd, d);
    log("r", rr, r);
    log("x", rx, x);
    log("y", ry, y);
    rows.push([z, w, d, r, x, y]);
  }

  // The daemon sorts by z before the slope pass, so indexes below refer to sorted order.
  rows.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const cur = rows[i];
    if (!prev || !cur) continue;
    if (cur[0] <= prev[0] + 0.4) {
      changes.push({ kind: "spacing", index: i, field: "z", from: cur[0], to: prev[0] + 0.5 });
      cur[0] = prev[0] + 0.5;
    }
    const dz = cur[0] - prev[0];
    const maxOutward = 0.78 * dz;
    const maxW = Math.min(90, prev[1] + 2 * maxOutward);
    const maxD = Math.min(90, prev[2] + 2 * maxOutward);
    if (cur[1] > maxW) {
      changes.push({ kind: "slope", index: i, field: "w", from: cur[1], to: maxW });
      cur[1] = maxW;
    }
    if (cur[2] > maxD) {
      changes.push({ kind: "slope", index: i, field: "d", from: cur[2], to: maxD });
      cur[2] = maxD;
    }
    const r = Math.max(0.8, Math.min(0.48 * Math.min(cur[1], cur[2]), cur[3]));
    if (Math.abs(r - cur[3]) > EPS) {
      changes.push({ kind: "bounds", index: i, field: "r", from: cur[3], to: r });
    }
    cur[3] = r;
  }
  return { ok: true, slices: rows, changes };
}

/** First balanced JSON object in model text (tolerates prose and code fences around it). */
export function extractJsonObject(text: string): unknown | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1)) as unknown;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// ---- daemon job shape (subset of shared/forgeOptimizer.ts ForgeOptimizationJob) ----

/** L2 note the daemon adds to a job when the gate said `marginal` and it tried a rescale. */
export interface L2Note {
  applied: boolean;
  path?: string;
  scale?: number;
  from_mm?: number | null;
  to_mm?: number;
  evals?: number;
  elapsed_ms?: number;
  reason?: string;
}

export interface DaemonJob {
  job_id?: string;
  status: string;
  elapsed_ms: number | null;
  error: string | null;
  glb_artifact?: string | null;
  stl_artifact?: string | null;
  content_hash?: string | null;
  legalizer?: { l1_l3_changed?: number; l2?: L2Note } | null;
  gate_report: {
    ok: boolean;
    design_status?: string;
    small_part?: { status: string; min_enclosing_diameter_mm: number; margin_pct: number };
    blocking_failures?: Array<{ id: string; detail?: string }>;
    brand_errors?: string[];
    assembly?: { ok: boolean; errors?: unknown[] };
  } | null;
}

export interface FeedbackItem {
  gate: string;
  measured?: number | string;
  limit?: string;
  hint: string;
}

const HINTS: Record<string, string> = {
  P1_no_supports:
    "Each slice may be at most 0.78 times its height step wider than the slice below, per side. Add slices or widen more slowly.",
  P4_no_ledges:
    "Avoid a flat shelf that sticks out. Grow outward gradually, or shrink back in before the next slice.",
  V_post_simplify_preprint:
    "The optimized mesh failed the print check. Simplify overhangs and thin parts.",
};

/** Failure labels for the per-gate counts; empty array means the attempt passed. */
export function gateKeysOf(status: string, job: DaemonJob | null, compileError: boolean): string[] {
  if (compileError) return ["compile_error"];
  if (status === "daemon_error") return ["daemon_error"];
  if (status === "print_ready") return [];
  const keys: string[] = [];
  const gr = job?.gate_report ?? null;
  for (const f of gr?.blocking_failures ?? []) keys.push(f.id);
  if (gr?.small_part?.status === "marginal") keys.push("small_part_marginal");
  if (gr?.assembly && gr.assembly.ok === false) keys.push("assembly");
  if ((gr?.brand_errors ?? []).length > 0) keys.push("brand");
  if (status === "failed") keys.push("job_failed");
  if (keys.length === 0) keys.push(`unexplained_${status}`);
  return keys;
}

/** What the repair call tells the model. No raw logs, one entry per failure. */
export function buildFeedback(status: string, job: DaemonJob | null, compileError: boolean): FeedbackItem[] {
  if (compileError) {
    return [
      {
        gate: "compile",
        hint: "The recipe was rejected before any check. Use a listed slot, 2 to 16 slices for loft, 3 to 64 points for profile2d, and numbers inside the stated bounds.",
      },
    ];
  }
  const out: FeedbackItem[] = [];
  const gr = job?.gate_report ?? null;
  for (const f of gr?.blocking_failures ?? []) {
    out.push({
      gate: f.id,
      measured: f.detail,
      hint: HINTS[f.id] ?? "Change the shape so this check passes.",
    });
  }
  const sp = gr?.small_part;
  if (sp && sp.status === "marginal") {
    out.push({
      gate: "small_part_marginal",
      measured: sp.min_enclosing_diameter_mm,
      limit: "at most 31.75 mm, or more than 34.925 mm",
      hint: "Make the part clearly smaller (under 29.5 mm across) or clearly larger (over 36 mm across).",
    });
  }
  if (gr?.assembly && gr.assembly.ok === false) {
    out.push({
      gate: "assembly",
      measured: JSON.stringify(gr.assembly.errors ?? []).slice(0, 200),
      hint: "The part does not attach to its reference parent. Keep the base footprint close to the slot's usual size.",
    });
  }
  if ((gr?.brand_errors ?? []).length > 0) {
    out.push({ gate: "brand", measured: (gr?.brand_errors ?? []).join("; "), hint: "Remove any brand or trademark words." });
  }
  if (status === "failed") out.push({ gate: "job_failed", hint: "The checker failed. Simplify the shape." });
  if (out.length === 0) out.push({ gate: `unexplained_${status}`, hint: "The part was not accepted. Change the proportions." });
  return out;
}

// ---- results and summary ----

export interface AttemptRecord {
  recipe: unknown | null;
  parseOk: boolean;
  compileError: boolean;
  status: string;
  gates: string[];
  validationMs: number | null;
  wallMs: number;
  legalizerChanges: LoftChange[];
  tokensIn?: number;
  tokensOut?: number;
  /** From the daemon job: lets a later step find the preview and STL for this attempt. */
  jobId?: string;
  glbArtifact?: string | null;
  stlArtifact?: string | null;
  /** L2 note, when the daemon tried a small-parts rescale on this attempt. */
  l2?: L2Note | null;
}

export interface PromptResult {
  id: string;
  slot: string;
  text: string;
  attempts: AttemptRecord[];
  passedFirst: boolean;
  passedFinal: boolean;
  calls: number;
  totalMs: number;
  /** Manual 1 to 5 "cute and on-brand" rating, filled in by a person later. */
  rating: number | null;
}

// ---- taste ratings (the manual 1 to 5 "cute and on-brand" score) ----

export interface RatingEntry {
  rating: number | null;
  note?: string;
}

export interface RatingSummary {
  rated: number;
  total: number;
  mean: number | null;
  histogram: Record<string, number>;
  bySlot: Record<string, { rated: number; mean: number | null }>;
  /** Prompt ids rated 1 or 2, the ones to look at first. */
  low: string[];
}

/** Put ratings onto results (ids not in `ratings` keep their rating) and summarize them. */
export function applyRatings(
  results: PromptResult[],
  ratings: Record<string, RatingEntry>,
): { results: PromptResult[]; summary: RatingSummary } {
  const merged = results.map((r) => {
    const e = ratings[r.id];
    const v = e && typeof e.rating === "number" && e.rating >= 1 && e.rating <= 5 ? Math.round(e.rating) : null;
    return v === null ? r : { ...r, rating: v };
  });
  const histogram: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  const bySlotSums: Record<string, { n: number; sum: number }> = {};
  const low: string[] = [];
  let n = 0;
  let sum = 0;
  for (const r of merged) {
    if (r.rating === null) continue;
    n++;
    sum += r.rating;
    histogram[String(r.rating)] = (histogram[String(r.rating)] ?? 0) + 1;
    const s = (bySlotSums[r.slot] ??= { n: 0, sum: 0 });
    s.n++;
    s.sum += r.rating;
    if (r.rating <= 2) low.push(r.id);
  }
  const bySlot: RatingSummary["bySlot"] = {};
  for (const [slot, s] of Object.entries(bySlotSums)) bySlot[slot] = { rated: s.n, mean: s.n ? s.sum / s.n : null };
  return { results: merged, summary: { rated: n, total: merged.length, mean: n ? sum / n : null, histogram, bySlot, low } };
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank] ?? null;
}

export interface Summary {
  prompts: number;
  firstAttemptPass: number;
  firstAttemptPassRate: number;
  finalPass: number;
  finalPassRate: number;
  meanCalls: number;
  jobMsP50: number | null;
  jobMsP95: number | null;
  validationMsP50: number | null;
  validationMsP95: number | null;
  failuresByGate: Record<string, number>;
  firstAttemptFailuresByGate: Record<string, number>;
  recipesTouchedByLegalizer: number;
  legalizerChangesByKind: Record<string, number>;
  /** Attempts where the daemon tried L2, how many it rescaled, and how long it took (ms). */
  l2Tried: number;
  l2Applied: number;
  l2MsP50: number | null;
  l2MsP95: number | null;
  tokensIn: number;
  tokensOut: number;
  bySlot: Record<string, { prompts: number; firstPass: number; finalPass: number }>;
}

export function summarize(results: PromptResult[]): Summary {
  const n = results.length;
  const failuresByGate: Record<string, number> = {};
  const firstFailures: Record<string, number> = {};
  const changesByKind: Record<string, number> = {};
  const bySlot: Summary["bySlot"] = {};
  let touched = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  const jobMs: number[] = [];
  const valMs: number[] = [];
  const l2Ms: number[] = [];
  let l2Tried = 0;
  let l2Applied = 0;
  for (const r of results) {
    const slot = (bySlot[r.slot] ??= { prompts: 0, firstPass: 0, finalPass: 0 });
    slot.prompts++;
    if (r.passedFirst) slot.firstPass++;
    if (r.passedFinal) slot.finalPass++;
    r.attempts.forEach((a, i) => {
      for (const g of a.gates) {
        failuresByGate[g] = (failuresByGate[g] ?? 0) + 1;
        if (i === 0) firstFailures[g] = (firstFailures[g] ?? 0) + 1;
      }
      jobMs.push(a.wallMs);
      if (a.validationMs !== null) valMs.push(a.validationMs);
      tokensIn += a.tokensIn ?? 0;
      tokensOut += a.tokensOut ?? 0;
      if (a.l2) {
        l2Tried++;
        if (a.l2.applied) l2Applied++;
        if (typeof a.l2.elapsed_ms === "number") l2Ms.push(a.l2.elapsed_ms);
      }
    });
    const first = r.attempts[0];
    if (first && first.legalizerChanges.length > 0) {
      touched++;
      for (const c of first.legalizerChanges) changesByKind[c.kind] = (changesByKind[c.kind] ?? 0) + 1;
    }
  }
  const firstPass = results.filter((r) => r.passedFirst).length;
  const finalPass = results.filter((r) => r.passedFinal).length;
  return {
    prompts: n,
    firstAttemptPass: firstPass,
    firstAttemptPassRate: n ? firstPass / n : 0,
    finalPass,
    finalPassRate: n ? finalPass / n : 0,
    meanCalls: n ? results.reduce((s, r) => s + r.calls, 0) / n : 0,
    jobMsP50: percentile(jobMs, 50),
    jobMsP95: percentile(jobMs, 95),
    validationMsP50: percentile(valMs, 50),
    validationMsP95: percentile(valMs, 95),
    failuresByGate,
    firstAttemptFailuresByGate: firstFailures,
    recipesTouchedByLegalizer: touched,
    legalizerChangesByKind: changesByKind,
    l2Tried,
    l2Applied,
    l2MsP50: percentile(l2Ms, 50),
    l2MsP95: percentile(l2Ms, 95),
    tokensIn,
    tokensOut,
    bySlot,
  };
}
