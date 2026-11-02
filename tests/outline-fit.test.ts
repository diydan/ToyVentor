import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MAX_GATE_CALLS,
  fitFlipped,
  fitOutline,
  fitPolygon,
  type FitResult,
  type OutlineGate,
  type OutlineShape,
  type OutlineVerdict,
  RESCALE_AIM_MM,
  SMALL_PARTS,
  verdictFromGateReport,
} from "../shared/outlineFit";
import {
  applyAffine,
  flipOutline,
  invertAffine,
  legalizeOutline,
  type OutlineOptions,
  type OutlineSuccess,
  RETRY_LADDER,
  retryOptions,
} from "../shared/photoOutline";
import { disc, polygon, type Raster, rasterize, SHAPES } from "./fixtures/outlineMasks";

// Each rung re-runs the legalizers on a 400 x 400 mask; the machine is often at load 50 or more, so the 5 s default is too tight.
vi.setConfig({ testTimeout: 60_000 });

// ---- a stand-in gate: every number it reports is computed here, from the polygon it is handed ----------------------

const heightOf = (s: OutlineShape) => Math.max(...s.points.map((p) => p[1])) - Math.min(...s.points.map((p) => p[1]));
const BAND_TOP = SMALL_PARTS.cylinderMm * (1 + SMALL_PARTS.marginalPct / 100);

const pass = (cylinderMm?: number): OutlineVerdict => ({ status: "pass", failures: [], ...(cylinderMm === undefined ? {} : { cylinderMm }) });
const sliver = (): OutlineVerdict => ({ status: "fail", failures: ["G1_watertight", "G3_single_body"] });
const marginal = (cylinderMm?: number): OutlineVerdict => ({ status: "marginal", failures: [], ...(cylinderMm === undefined ? {} : { cylinderMm }) });

/** A cylinder that follows the height, as the real one roughly does, and the real band rule on it. */
function bandVerdict(cyl: number): OutlineVerdict {
  if (cyl <= SMALL_PARTS.cylinderMm) return pass(cyl); // a small part passes (with warnings)
  if (cyl <= BAND_TOP) return marginal(cyl);
  return pass(cyl);
}

function recorder(rule: (shape: OutlineShape, call: number) => OutlineVerdict): { gate: OutlineGate; shapes: OutlineShape[] } {
  const shapes: OutlineShape[] = [];
  return {
    shapes,
    gate: async (shape) => {
      shapes.push(shape);
      return rule(shape, shapes.length);
    },
  };
}

const discAt = (heightMm: number): [Raster, OutlineOptions] => [SHAPES.disc(), { targetHeightMm: heightMm }];
const attemptKinds = (r: FitResult) => r.attempts.map((a) => a.kind);

describe("fitOutline: the common path", () => {
  it("passes on the first try with one gate call and hands the compiler the legalized outline, untouched", async () => {
    const [mask, opts] = discAt(54);
    const { gate, shapes } = recorder(() => pass());
    const r = await fitOutline(mask, opts, gate);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const direct = legalizeOutline(mask, opts);
    if (!direct.ok) throw new Error("legalize failed");
    expect(r.outline.points).toEqual(direct.points);
    expect(r.outline.changes).toEqual(direct.changes); // no retry noted when none happened
    expect(shapes).toHaveLength(1);
    expect(shapes[0]).toEqual({ kind: "profile2d", points: direct.points, fillet_r_mm: 1.6, grip_tu: 2 });
    expect(r.attempts).toEqual([{ n: 1, kind: "first", fillet_r_mm: 1.6, heightMm: direct.heightMm, widthMm: direct.widthMm, status: "pass", failures: [] }]);
  });

  it("passes gripTu through to the shape", async () => {
    const { gate, shapes } = recorder(() => pass());
    await fitOutline(SHAPES.disc(), { gripTu: 3 }, gate);
    expect(shapes[0]!.grip_tu).toBe(3);
  });
});

describe("fitOutline: slivers go down the retry ladder", () => {
  it("a sliver at the first rung is fixed by the 2% nudge: the same shape, a little bigger", async () => {
    const [mask, opts] = discAt(54);
    const { gate } = recorder((_s, call) => (call === 1 ? sliver() : pass()));
    const r = await fitOutline(mask, opts, gate);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(attemptKinds(r)).toEqual(["first", "size_nudge"]);
    expect(r.attempts[0]!.failures).toEqual(["G1_watertight", "G3_single_body"]);
    const expected = legalizeOutline(mask, retryOptions(opts, 1)!);
    if (!expected.ok) throw new Error("legalize failed");
    expect(r.outline.points).toEqual(expected.points);
    const first = legalizeOutline(mask, opts);
    if (!first.ok) throw new Error("legalize failed");
    expect(r.outline.heightMm / first.heightMm).toBeCloseTo(1.02, 2);
    expect(r.outline.changes.at(-1)).toMatchObject({ step: "C3", code: "retry_size_nudge", value: 1.02 });
    expect(r.outline.widthMm / r.outline.heightMm).toBeCloseTo(1, 1); // still a disc
  });

  it("walks the whole ladder in order, then says gate_failed and keeps the first outline for a fallback", async () => {
    const [mask, opts] = discAt(54);
    const { gate } = recorder(() => sliver());
    const r = await fitOutline(mask, opts, gate);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("gate_failed");
    expect(attemptKinds(r)).toEqual(["first", "size_nudge", "size_nudge", "fillet", "fillet"]);
    expect(r.attempts.map((a) => a.fillet_r_mm)).toEqual(RETRY_LADDER.map((s) => s.fillet_r_mm));
    expect(r.attempts.map((a) => a.n)).toEqual([1, 2, 3, 4, 5]);
    expect(r.detail).toContain("G1_watertight");
    const first = legalizeOutline(mask, opts);
    if (!first.ok) throw new Error("legalize failed");
    expect(r.outline?.points).toEqual(first.points);
  });

  it("a fillet rung is noted in the change log", async () => {
    const [mask, opts] = discAt(54);
    const { gate } = recorder((_s, call) => (call < 4 ? sliver() : pass()));
    const r = await fitOutline(mask, opts, gate);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.outline.fillet_r_mm).toBe(2);
    expect(r.outline.changes.at(-1)).toMatchObject({ step: "C2", code: "retry_fillet", value: 2 });
  });

  it("does not gate the same shape twice: at the 90 mm box a nudge changes nothing, so it is skipped", async () => {
    const mask = SHAPES.paddle();
    const opts: OutlineOptions = { targetHeightMm: 90 };
    // Guard: the premise. Rungs 0, 1 and 2 give the same polygon here, rung 3 differs.
    const pts = [0, 1, 2, 3].map((i) => {
      const o = legalizeOutline(mask, retryOptions(opts, i)!);
      if (!o.ok) throw new Error("legalize failed");
      return JSON.stringify(o.points);
    });
    expect(pts[1]).toBe(pts[0]);
    expect(pts[2]).toBe(pts[0]);
    expect(pts[3]).not.toBe(pts[0]);
    const { gate, shapes } = recorder(() => sliver());
    const r = await fitOutline(mask, opts, gate);
    expect(shapes).toHaveLength(3);
    expect(r.attempts.map((a) => a.fillet_r_mm)).toEqual([1.6, 2, 3]);
    expect(attemptKinds(r)).toEqual(["first", "fillet", "fillet"]);
  });

  it("stops at the call budget and says so", async () => {
    const { gate, shapes } = recorder(() => sliver());
    const r = await fitOutline(SHAPES.disc(), { maxGateCalls: 2 }, gate);
    expect(shapes).toHaveLength(2);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("out_of_budget");
    expect(DEFAULT_MAX_GATE_CALLS).toBeGreaterThanOrEqual(RETRY_LADDER.length);
  });
});

describe("fitOutline: a marginal small-parts result is rescaled by the measured cylinder", () => {
  /** cylinder = slope * height + fixed. The real one has a fixed part (grip shaft and neck), so it is not proportional. */
  const linear = (slope: number, fixed: number) => (s: OutlineShape) => bandVerdict(slope * heightOf(s) + fixed);

  it("grows the outline out of the band, keeping the shape, and notes it", async () => {
    const [mask, opts] = discAt(33);
    const cyl = (s: OutlineShape) => 0.97 * heightOf(s) + 1;
    const { gate, shapes } = recorder((s) => bandVerdict(cyl(s)));
    const r = await fitOutline(mask, opts, gate);
    expect(shapes[0] && cyl(shapes[0])).toBeGreaterThan(SMALL_PARTS.cylinderMm); // guard: it starts marginal
    expect(shapes[0] && cyl(shapes[0])).toBeLessThanOrEqual(BAND_TOP);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const final = shapes.at(-1)!;
    expect(cyl(final)).toBeGreaterThan(BAND_TOP);
    expect(heightOf(final)).toBeGreaterThan(heightOf(shapes[0]!));
    expect(attemptKinds(r)).toEqual(["first", "rescale"]);
    expect(r.attempts[0]).toMatchObject({ status: "marginal", failures: [] });
    expect(r.outline.points).toEqual(final.points); // what passed is what is returned
    const change = r.outline.changes.at(-1)!;
    expect(change).toMatchObject({ step: "C3", code: "rescaled_out_of_marginal" });
    expect(change.value).toBeGreaterThan(1);
    // The shape is the same one, uniformly bigger: every coordinate scaled by one factor.
    const f = heightOf(final) / heightOf(shapes[0]!);
    expect(change.value).toBeCloseTo(f, 1);
    const ratios = final.points.map((p, i) => [p[0] / (shapes[0]!.points[i]![0] || 1), p[1] / (shapes[0]!.points[i]![1] || 1)]).flat().filter((v) => Number.isFinite(v) && Math.abs(v) > 0);
    for (const v of ratios.slice(0, 20)) expect(v).toBeCloseTo(f, 1);
    expect(r.outline.heightMm).toBeCloseTo(heightOf(final), 2);
  });

  it("aims past the band edge by the margin, not at it", async () => {
    const [mask, opts] = discAt(33);
    const cyl = (s: OutlineShape) => 0.97 * heightOf(s) + 1;
    const { gate, shapes } = recorder((s) => bandVerdict(cyl(s)));
    await fitOutline(mask, opts, gate);
    const aimed = cyl(shapes[1]!);
    expect(aimed).toBeGreaterThan(BAND_TOP + RESCALE_AIM_MM - 0.4);
    expect(aimed).toBeLessThan(BAND_TOP + RESCALE_AIM_MM + 0.6);
  });

  it("re-aims when the cylinder is not proportional to the size, within the call budget", async () => {
    const [mask, opts] = discAt(31);
    const rule = linear(0.5, 17); // marginal for heights of about 29.5 to 35.9 mm: one proportional step falls short
    const { gate, shapes } = recorder(rule);
    const r = await fitOutline(mask, opts, gate);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const rescales = r.attempts.filter((a) => a.kind === "rescale");
    expect(rescales.length).toBeGreaterThanOrEqual(2); // it needed the re-aim
    expect(r.attempts.length).toBeLessThanOrEqual(DEFAULT_MAX_GATE_CALLS);
    const heights = r.attempts.map((a) => a.heightMm);
    expect([...heights].sort((a, b) => a - b)).toEqual(heights); // each step went further the same way
    expect(rule(shapes.at(-1)!).status).toBe("pass");
    // The change log says the total factor from the first outline, not the last step's.
    const f = heightOf(shapes.at(-1)!) / heightOf(shapes[0]!);
    expect(r.outline.changes.at(-1)!.value).toBeCloseTo(f, 1);
    expect(r.outline.changes.filter((c) => c.code === "rescaled_out_of_marginal")).toHaveLength(1);
  });

  it("shrinks when the 90 mm box blocks growth", async () => {
    const mask = SHAPES.blade();
    const opts: OutlineOptions = { targetHeightMm: 90 };
    const rule = (s: OutlineShape): OutlineVerdict => (heightOf(s) >= 82 ? marginal(33) : pass(30));
    const { gate, shapes } = recorder(rule);
    const r = await fitOutline(mask, opts, gate);
    expect(heightOf(shapes[0]!)).toBeGreaterThan(89.9); // guard: growth has nowhere to go
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.attempts[1]).toMatchObject({ kind: "rescale" });
    expect(r.attempts[1]!.heightMm).toBeLessThan(r.attempts[0]!.heightMm);
    expect(r.outline.changes.at(-1)).toMatchObject({ code: "rescaled_out_of_marginal" });
    expect(r.outline.changes.at(-1)!.value).toBeLessThan(1);
    expect(r.outline.changes.at(-1)!.detail).toContain("shrunk");
  });

  it("a sliver on the rescaled outline gets one nudge further the same way", async () => {
    const [mask, opts] = discAt(33);
    const cyl = (s: OutlineShape) => 0.97 * heightOf(s) + 1;
    const { gate, shapes } = recorder((s, call) => (call === 2 ? sliver() : bandVerdict(cyl(s))));
    const r = await fitOutline(mask, opts, gate);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(attemptKinds(r)).toEqual(["first", "rescale", "rescale"]);
    expect(heightOf(shapes[2]!)).toBeGreaterThan(heightOf(shapes[1]!) * 1.015);
    expect(heightOf(shapes[2]!)).toBeLessThan(heightOf(shapes[1]!) * 1.03);
  });

  it("gives up with marginal_unresolved when nothing clears the band, inside the budget", async () => {
    const { gate, shapes } = recorder(() => marginal(33));
    const r = await fitOutline(SHAPES.disc(), { targetHeightMm: 33 }, gate);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("marginal_unresolved");
    expect(shapes.length).toBeLessThanOrEqual(DEFAULT_MAX_GATE_CALLS);
    expect(r.outline).toBeDefined();
  });

  it("a marginal verdict with no measurement cannot be rescaled: one call, then marginal_unresolved", async () => {
    const { gate, shapes } = recorder(() => marginal());
    const r = await fitOutline(SHAPES.disc(), {}, gate);
    expect(shapes).toHaveLength(1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("marginal_unresolved");
  });

  it("a sliver first, then a marginal on the nudge, then a rescale: the three rungs in order", async () => {
    const [mask, opts] = discAt(33); // the nudged 33.7 mm is still marginal under this cylinder; 31 mm would already be a small part
    const cyl = (s: OutlineShape) => 0.97 * heightOf(s) + 1;
    const { gate } = recorder((s, call) => (call === 1 ? sliver() : bandVerdict(cyl(s))));
    const r = await fitOutline(mask, opts, gate);
    expect(r.ok).toBe(true);
    expect(attemptKinds(r).slice(0, 3)).toEqual(["first", "size_nudge", "rescale"]);
  });
});

describe("fitOutline: what it does not do", () => {
  it("does not call the gate when the mask gives no outline", async () => {
    const { gate, shapes } = recorder(() => pass());
    const empty: Raster = { data: new Uint8Array(100 * 100), width: 100, height: 100 };
    const r = await fitOutline(empty, {}, gate);
    expect(shapes).toHaveLength(0);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("no_outline");
    expect(r.outlineFailure?.reason).toBe("empty_mask");
    expect(r.attempts).toEqual([]);
  });

  it("a gate that cannot run rejects; it is not read as a failed shape", async () => {
    const gate: OutlineGate = async () => {
      throw new Error("daemon down");
    };
    await expect(fitOutline(SHAPES.disc(), {}, gate)).rejects.toThrow("daemon down");
  });

  it("a hard failure that is not a sliver or marginal is reported as it is, with its ids", async () => {
    const { gate } = recorder(() => ({ status: "fail", failures: ["P1_overhang"] }));
    const r = await fitOutline(SHAPES.disc(), {}, gate);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toContain("P1_overhang");
  });
});

describe("fitPolygon and fitFlipped: after the mask is gone", () => {
  const lollipop = (): OutlineSuccess => {
    const o = legalizeOutline(SHAPES.paddle(), { targetHeightMm: 54 });
    if (!o.ok) throw new Error("legalize failed");
    return o;
  };

  it("fitFlipped gates the half-turned polygon and records the flip", async () => {
    const o = lollipop();
    const { gate, shapes } = recorder(() => pass());
    const r = await fitFlipped(o, gate);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(shapes[0]!.points).toEqual(flipOutline(o.points));
    expect(r.outline.orientation.flipped).toBe(!o.orientation.flipped);
    expect(r.outline.changes.at(-1)).toMatchObject({ code: "flipped" });
  });

  it("a sliver on a polygon is nudged by scaling it, and the photo map scales with it", async () => {
    const o = lollipop();
    const { gate } = recorder((_s, call) => (call === 1 ? sliver() : pass()));
    const r = await fitPolygon(o, gate);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(attemptKinds(r)).toEqual(["first", "size_nudge"]);
    expect(r.outline.heightMm / o.heightMm).toBeCloseTo(1.02, 2);
    expect(r.outline.photoToPlate[0] / o.photoToPlate[0]).toBeCloseTo(1.02, 6);
  });

  it("the fillet rungs change the recipe fillet only: the polygon is the same", async () => {
    const o = lollipop();
    const { gate, shapes } = recorder((_s, call) => (call < 4 ? sliver() : pass()));
    const r = await fitPolygon(o, gate);
    expect(r.ok).toBe(true);
    expect(shapes[3]!.fillet_r_mm).toBe(2);
    expect(shapes[3]!.points).toEqual(o.points);
  });

  it("a flipped then nudged outline still maps back onto the photo it came from", async () => {
    const mask = SHAPES.paddle();
    const o = legalizeOutline(mask, { targetHeightMm: 54 });
    if (!o.ok) throw new Error("legalize failed");
    const { gate } = recorder((_s, call) => (call === 1 ? sliver() : pass()));
    const r = await fitFlipped(o, gate);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const inv = invertAffine(r.outline.photoToPlate)!;
    const inside = polygon(r.outline.points.map(([x, z]) => applyAffine(inv, x, z)) as [number, number][]);
    let inter = 0;
    let uni = 0;
    for (let y = 0; y < mask.height; y += 2)
      for (let x = 0; x < mask.width; x += 2) {
        const m = mask.data[y * mask.width + x] === 1;
        const p = inside(x, y);
        if (m && p) inter++;
        if (m || p) uni++;
      }
    expect(inter / uni).toBeGreaterThan(0.95);
  });

  it("a rescaled outline also maps back onto the photo (the rescale carries the map)", async () => {
    const mask = rasterize(400, 400, disc(200, 200, 150));
    const cyl = (s: OutlineShape) => 0.97 * heightOf(s) + 1;
    const { gate } = recorder((s) => bandVerdict(cyl(s)));
    const r = await fitOutline(mask, { targetHeightMm: 33 }, gate);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const inv = invertAffine(r.outline.photoToPlate)!;
    const inside = polygon(r.outline.points.map(([x, z]) => applyAffine(inv, x, z)) as [number, number][]);
    let inter = 0;
    let uni = 0;
    for (let y = 0; y < mask.height; y += 2)
      for (let x = 0; x < mask.width; x += 2) {
        const m = mask.data[y * mask.width + x] === 1;
        const p = inside(x, y);
        if (m && p) inter++;
        if (m || p) uni++;
      }
    expect(inter / uni).toBeGreaterThan(0.95);
  });
});

describe("verdictFromGateReport: reading what the daemon returns", () => {
  const small = (status: string, cyl = 33.1) => ({ status, min_enclosing_diameter_mm: cyl, margin_pct: 4.3 });

  it("ok with a clean list is a pass, and the cylinder is kept", () => {
    expect(verdictFromGateReport({ ok: true, small_part: small("small_part", 30), blocking_failures: [] })).toEqual({ status: "pass", failures: [], cylinderMm: 30 });
  });

  it("a marginal part is ok: false with NO failures; the signal is small_part", () => {
    expect(verdictFromGateReport({ ok: false, design_status: "needs_reproportion", small_part: small("marginal"), blocking_failures: [] })).toEqual({
      status: "marginal",
      failures: [],
      cylinderMm: 33.1,
    });
  });

  it("failure ids come from objects or bare strings, and from pre-print failures", () => {
    const v = verdictFromGateReport({ ok: false, small_part: small("above_cylinder", 40), blocking_failures: [{ id: "G1_watertight", detail: "x" }, "G3_single_body"], preprint_failures: ["P4"] });
    expect(v).toEqual({ status: "fail", failures: ["G1_watertight", "G3_single_body", "P4"], cylinderMm: 40 });
  });

  it("marginal together with a failure is a failure (the failure is fixed first)", () => {
    expect(verdictFromGateReport({ ok: false, small_part: small("marginal"), blocking_failures: [{ id: "G1_watertight" }] }).status).toBe("fail");
  });

  it("ok: false with nothing to explain it is still a failure, never a pass", () => {
    expect(verdictFromGateReport({ ok: false, blocking_failures: [] })).toEqual({ status: "fail", failures: ["gate_not_ok"] });
    expect(verdictFromGateReport({ ok: false, small_part: small("above_cylinder", 40), blocking_failures: [] }).status).toBe("fail");
  });

  it("an ok report that still lists a failure is not a pass", () => {
    expect(verdictFromGateReport({ ok: true, blocking_failures: [{ id: "G2" }] }).status).toBe("fail");
  });

  it("anything that is not a report is a failure with a reason", () => {
    for (const bad of [null, undefined, "ok", 7, [], [{ ok: true }]]) expect(verdictFromGateReport(bad)).toEqual({ status: "fail", failures: ["no_report"] });
  });

  it("ignores a cylinder that is not a finite number", () => {
    expect(verdictFromGateReport({ ok: true, small_part: { status: "small_part", min_enclosing_diameter_mm: "30" } })).toEqual({ status: "pass", failures: [] });
    expect(verdictFromGateReport({ ok: true, small_part: { status: "small_part", min_enclosing_diameter_mm: Number.NaN } })).toEqual({ status: "pass", failures: [] });
  });
});

describe("wiring", () => {
  it("mirrors the small-parts screen and the rescale margin (a change there must change here)", () => {
    const iface = JSON.parse(readFileSync(join(__dirname, "..", "parts", "partspec", "interfaces.json"), "utf8"));
    expect(SMALL_PARTS.cylinderMm).toBe(iface.safety.small_parts_cylinder.diameter_mm);
    expect(SMALL_PARTS.marginalPct).toBe(iface.safety.marginal_pct);
    const daemon = readFileSync(join(__dirname, "..", "scripts", "forge_optimizer_daemon.py"), "utf8");
    expect(daemon).toMatch(new RegExp(`L2_MARGIN_MM = ${RESCALE_AIM_MM}\\b`));
  });

  it("stays pure: no DOM, no network, no clock, no randomness, imports only the two sibling modules", () => {
    const src = readFileSync(join(__dirname, "..", "shared", "outlineFit.ts"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\b(document|window|fetch|localStorage|sessionStorage|XMLHttpRequest|Date\.now|Math\.random|performance\.now|setTimeout)\b/);
    const from = [...code.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(from)).toEqual(new Set(["./forgeOptimizer", "./photoOutline"]));
  });
});
