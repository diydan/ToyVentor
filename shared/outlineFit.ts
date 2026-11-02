/**
 * Outline fitting loop (docs/specs/forge-ai-spec.md, "F2b", Route A, step 2).
 *
 * `legalizeOutline` (photoOutline.ts) makes a polygon the compiler accepts. This file is the outer loop that makes
 * the polygon pass the gates, because three things only show up when the real gate has run:
 *
 *   - a sliver failure (`G1_watertight` plus `G3_single_body`), erratic in the fillet and the size: go down
 *     RETRY_LADDER (the same shape 2% and 4% bigger first, then a bigger fillet);
 *   - a `marginal` small-parts result (cylinder between the small-parts diameter and 10% over it), which fails with an
 *     empty `blocking_failures` list. The daemon's L2 only handles loft slots, so hand plates are rescaled here, by the
 *     measured cylinder, and gated again;
 *   - nothing else: any other failure is reported as it is. No model call, no repair prose.
 *
 * Pure: the gate is injected (`OutlineGate`), so the Worker passes the daemon and tests pass a stand-in. A gate that
 * throws (daemon down) rejects the whole call; it is not a verdict on the shape.
 *
 * Why growing comes before shrinking in the rescale: the builder rounds away any part thinner than 2 x the larger of
 * the fillet and 0.8 mm, and a legalized outline already sits at that limit, so a shrunk outline can lose its thinnest
 * part where a grown one cannot. Shrinking is the fallback when the 90 mm box blocks growth.
 */

import type { ForgeRecipeV1 } from "./forgeOptimizer";
import {
  legalizeOutline,
  outlineToRecipeShape,
  retryOptions,
  RETRY_LADDER,
  withFlipped,
  withScaled,
  type OutlineChange,
  type OutlineFailure,
  type OutlineMask,
  type OutlineOptions,
  type OutlineSuccess,
} from "./photoOutline";

export type OutlineShape = Extract<ForgeRecipeV1["shape"], { kind: "profile2d" }>;

/**
 * The small-parts screen the gate applies. Mirrors `safety.small_parts_cylinder.diameter_mm` and `safety.marginal_pct`
 * in parts/partspec/interfaces.json; tests/outline-fit.test.ts reads that file and fails if they drift.
 */
export const SMALL_PARTS = { cylinderMm: 31.75, marginalPct: 10 } as const;
/** How far past the band edge a rescale aims. Mirrors `L2_MARGIN_MM` in scripts/forge_optimizer_daemon.py (a test checks). */
export const RESCALE_AIM_MM = 0.75;
/** Gate calls one fit may use. Each is 3 to 30 s on the daemon, so the ladder (5 rungs) plus a rescale must not run on. */
export const DEFAULT_MAX_GATE_CALLS = 8;

/** What the loop needs to know about one gate run. */
export interface OutlineVerdict {
  status: "pass" | "marginal" | "fail";
  /** `small_part.min_enclosing_diameter_mm`, when the gate reported it. */
  cylinderMm?: number;
  /** Ids of the blocking and pre-print failures; `[]` for a pass or a marginal result. */
  failures: string[];
}

/** Runs the compile and gates for this shape and says what happened. Rejects only when the gate itself could not run. */
export type OutlineGate = (shape: OutlineShape) => Promise<OutlineVerdict>;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Reads the daemon's `gate_report` (or the full `validate_and_export` result) into a verdict. Defensive on purpose:
 * `blocking_failures` holds objects or bare ids, and a marginal part is `ok: false` with an empty failure list, so
 * the only signal is `small_part`.
 */
export function verdictFromGateReport(report: unknown): OutlineVerdict {
  if (!isRecord(report)) return { status: "fail", failures: ["no_report"] };
  const ids: string[] = [];
  for (const key of ["blocking_failures", "preprint_failures", "brand_errors"] as const) {
    const list = report[key];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (typeof item === "string") ids.push(item);
      else if (isRecord(item) && typeof item.id === "string") ids.push(item.id);
      else ids.push(key);
    }
  }
  const small = isRecord(report.small_part) ? report.small_part : undefined;
  const cyl = small && typeof small.min_enclosing_diameter_mm === "number" && Number.isFinite(small.min_enclosing_diameter_mm) ? small.min_enclosing_diameter_mm : undefined;
  const withCyl = cyl === undefined ? {} : { cylinderMm: cyl };
  if (report.ok === true && ids.length === 0) return { status: "pass", failures: [], ...withCyl };
  if (ids.length === 0 && small?.status === "marginal") return { status: "marginal", failures: [], ...withCyl };
  return { status: "fail", failures: ids.length ? ids : ["gate_not_ok"], ...withCyl };
}

export interface FitOptions {
  /** Gate calls this fit may use, counting every rung and rescale. Default 8. */
  maxGateCalls?: number;
  /** `shape.grip_tu`, 2 to 4. Default 2. */
  gripTu?: number;
  /** The small-parts screen; default SMALL_PARTS. */
  band?: { cylinderMm: number; marginalPct: number };
}

export interface FitAttempt {
  /** 1 for the first gate call. */
  n: number;
  kind: "first" | "size_nudge" | "fillet" | "rescale";
  fillet_r_mm: number;
  heightMm: number;
  widthMm: number;
  status: OutlineVerdict["status"];
  cylinderMm?: number;
  failures: string[];
}

export interface FitSuccess {
  ok: true;
  /** The outline that passed: points, size and change log are those of the final shape, not of the first try. */
  outline: OutlineSuccess;
  verdict: OutlineVerdict;
  attempts: FitAttempt[];
}

export interface FitFailure {
  ok: false;
  reason: "no_outline" | "gate_failed" | "marginal_unresolved" | "out_of_budget";
  detail: string;
  /** Set when the mask could not be turned into an outline at all (`reason` is `no_outline`). */
  outlineFailure?: OutlineFailure;
  /** The first legalized outline, so a caller can still preview it or fall back to the digital-only path. */
  outline?: OutlineSuccess;
  attempts: FitAttempt[];
}

export type FitResult = FitSuccess | FitFailure;

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Yields the outline for ladder rung `i`, or undefined once the ladder is out. A failure ends the fit at the first rung only. */
type RungSource = (i: number) => OutlineSuccess | OutlineFailure | undefined;

async function runFit(source: RungSource, gate: OutlineGate, options: FitOptions): Promise<FitResult> {
  const maxCalls = Math.max(1, Math.floor(options.maxGateCalls ?? DEFAULT_MAX_GATE_CALLS));
  const gripTu = options.gripTu ?? 2;
  const band = options.band ?? SMALL_PARTS;
  const attempts: FitAttempt[] = [];
  const seen = new Set<string>();
  let first: OutlineSuccess | undefined;

  /** One gate call, or undefined when this exact shape was already tried or the budget is spent. */
  const run = async (outline: OutlineSuccess, kind: FitAttempt["kind"]): Promise<OutlineVerdict | undefined> => {
    if (attempts.length >= maxCalls) return undefined;
    const key = `${outline.fillet_r_mm}|${JSON.stringify(outline.points)}`;
    if (seen.has(key)) return undefined;
    seen.add(key);
    const verdict = await gate(outlineToRecipeShape(outline, gripTu));
    attempts.push({
      n: attempts.length + 1,
      kind,
      fillet_r_mm: outline.fillet_r_mm,
      heightMm: outline.heightMm,
      widthMm: outline.widthMm,
      status: verdict.status,
      ...(verdict.cylinderMm === undefined ? {} : { cylinderMm: verdict.cylinderMm }),
      failures: verdict.failures,
    });
    return verdict;
  };

  const success = (outline: OutlineSuccess, verdict: OutlineVerdict): FitSuccess => ({ ok: true, outline, verdict, attempts });
  const failure = (reason: FitFailure["reason"], detail: string): FitFailure => ({ ok: false, reason, detail, ...(first ? { outline: first } : {}), attempts });

  /**
   * Take a marginal outline out of the band by the measured cylinder: grow first, then shrink. Each direction aims
   * RESCALE_AIM_MM past the band edge, re-aims once from the new measurement (the cylinder is not proportional to the
   * outline: the grip shaft and neck are fixed size), and allows one sliver nudge.
   */
  const rescale = async (start: OutlineSuccess, startVerdict: OutlineVerdict): Promise<FitSuccess | undefined> => {
    if (startVerdict.cylinderMm === undefined) return undefined;
    const top = band.cylinderMm * (1 + band.marginalPct / 100);
    for (const direction of ["grow", "shrink"] as const) {
      const aim = direction === "grow" ? top + RESCALE_AIM_MM : band.cylinderMm - RESCALE_AIM_MM;
      let current = start;
      let cylinder = startVerdict.cylinderMm;
      let nudge = 1;
      let nudged = false;
      let total = 1;
      for (let step = 0; step < 3; step++) {
        const scaled = withScaled(current, (aim / cylinder) * nudge);
        if (Math.abs(scaled.factor - 1) < 0.005) break; // the box stops it (or the aim is already met): nothing to try
        total *= scaled.factor;
        const candidate: OutlineSuccess = {
          ...scaled.outline,
          changes: [
            ...start.changes,
            {
              step: "C3",
              code: "rescaled_out_of_marginal",
              detail: `the small-parts check was marginal (cylinder ${round2(startVerdict.cylinderMm)} mm), so the outline was ${direction === "grow" ? "grown" : "shrunk"} to ${round2(total * 100)}% of its size`,
              value: round2(total),
            } satisfies OutlineChange,
          ],
        };
        const verdict = await run(candidate, "rescale");
        if (!verdict) break;
        if (verdict.status === "pass") return success(candidate, verdict);
        if (verdict.status === "marginal" && verdict.cylinderMm !== undefined) {
          current = candidate;
          cylinder = verdict.cylinderMm;
          nudge = 1;
          continue;
        }
        // A sliver: the same shape a little further along passes (see RETRY_LADDER). One nudge per direction.
        if (nudged) break;
        nudged = true;
        total /= scaled.factor;
        nudge = direction === "grow" ? 1.02 : 0.98;
      }
    }
    return undefined;
  };

  let previousFillet: number | undefined;
  for (let i = 0; i < RETRY_LADDER.length; i++) {
    const made = source(i);
    if (!made) break;
    if (!made.ok) {
      if (i === 0) return { ok: false, reason: "no_outline", detail: made.detail, outlineFailure: made, attempts };
      continue;
    }
    first ??= made;
    const kind: FitAttempt["kind"] = i === 0 ? "first" : made.fillet_r_mm === previousFillet ? "size_nudge" : "fillet";
    previousFillet = made.fillet_r_mm;
    const verdict = await run(made, kind);
    if (!verdict) {
      if (attempts.length >= maxCalls) break;
      continue; // the same shape as an earlier rung (the box capped the nudge): not gated twice
    }
    if (verdict.status === "pass") return success(made, verdict);
    if (verdict.status === "marginal") {
      const fixed = await rescale(made, verdict);
      return fixed ?? failure("marginal_unresolved", `marginal at ${verdict.cylinderMm ?? "an unreported"} mm and no rescale of the outline cleared the band`);
    }
  }
  if (attempts.length >= maxCalls) return failure("out_of_budget", `${attempts.length} gate calls used and the outline still fails: ${[...new Set(attempts.flatMap((a) => a.failures))].join(", ")}`);
  return failure("gate_failed", `every retry failed the gates: ${[...new Set(attempts.flatMap((a) => a.failures))].join(", ")}`);
}

/**
 * Photo mask in, gated outline out. The rungs re-run the legalizers from the mask (thin parts are decided at each
 * rung's own size), so the change log is true to what was gated. The mask has to still be in memory, which it is for
 * the length of the scan request; afterwards use `fitPolygon`.
 */
export async function fitOutline(mask: OutlineMask, options: OutlineOptions & FitOptions, gate: OutlineGate): Promise<FitResult> {
  const { maxGateCalls, gripTu, band, ...outline } = options;
  const fit: FitOptions = { ...(maxGateCalls === undefined ? {} : { maxGateCalls }), ...(gripTu === undefined ? {} : { gripTu }), ...(band === undefined ? {} : { band }) };
  return runFit(
    (i) => {
      const opts = retryOptions(outline, i);
      if (!opts) return undefined;
      const out = legalizeOutline(mask, opts);
      if (!out.ok || i === 0) return out;
      const step = RETRY_LADDER[i]!;
      const code = step.sizeFactor === 1 ? "retry_fillet" : "retry_size_nudge";
      return {
        ...out,
        changes: [
          ...out.changes,
          {
            step: step.sizeFactor === 1 ? "C2" : "C3",
            code,
            detail: step.sizeFactor === 1 ? `a sliver failure at the first fillet, so the fillet went to ${step.fillet_r_mm} mm` : `a sliver failure, so the same shape was gated again at ${round2(step.sizeFactor * 100)}% of the size`,
            value: step.sizeFactor === 1 ? step.fillet_r_mm : step.sizeFactor,
          } satisfies OutlineChange,
        ],
      };
    },
    gate,
    fit,
  );
}

/**
 * A finished outline in, gated outline out, for after the mask is gone (the kid pressed flip or resize).
 * The rungs scale the polygon (`scaleOutline`) and change `fillet_r_mm` in the recipe only, so a larger fillet
 * rounds a little more in the builder than the change log can say.
 */
export async function fitPolygon(outline: OutlineSuccess, gate: OutlineGate, options: FitOptions = {}): Promise<FitResult> {
  return runFit(
    (i) => {
      const step = RETRY_LADDER[i];
      if (!step) return undefined;
      if (i === 0) return outline;
      const scaled = step.sizeFactor === 1 ? { outline, factor: 1 } : withScaled(outline, step.sizeFactor);
      return {
        ...scaled.outline,
        fillet_r_mm: step.fillet_r_mm,
        changes: [
          ...outline.changes,
          {
            step: step.sizeFactor === 1 ? "C2" : "C3",
            code: step.sizeFactor === 1 ? "retry_fillet" : "retry_size_nudge",
            detail: step.sizeFactor === 1 ? `a sliver failure, so the recipe fillet went to ${step.fillet_r_mm} mm` : `a sliver failure, so the same shape was gated again at ${round2(scaled.factor * 100)}% of the size`,
            value: step.sizeFactor === 1 ? step.fillet_r_mm : round2(scaled.factor),
          } satisfies OutlineChange,
        ],
      };
    },
    gate,
    options,
  );
}

/** The kid's flip button on a finished outline: a half turn of the polygon (and of its photo map), then gated again. */
export async function fitFlipped(outline: OutlineSuccess, gate: OutlineGate, options: FitOptions = {}): Promise<FitResult> {
  return fitPolygon(withFlipped(outline), gate, options);
}
