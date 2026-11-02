import { describe, expect, it } from "vitest";
import prompts from "./prompts.json";
import {
  buildFeedback,
  extractJsonObject,
  gateKeysOf,
  legalizeLoft,
  percentile,
  summarize,
  type DaemonJob,
  type PromptResult,
} from "../../scripts/lib/forgeEvalCore";

// Expected rows come from scripts/forge_optimizer_daemon.py `legalize_loft_slices`
// (run 2026-11-02 with the partspec venv), so this is a parity check on the TypeScript mirror.
const FLARE = [
  { z: 0, w: 24, d: 12, r: 4 },
  { z: 2, w: 40, d: 22, r: 6 },
  { z: 8, w: 40, d: 22, r: 6 },
  { z: 12, w: 16, d: 12, r: 4 },
];
const WIZARD = [
  { z: 0.0, w: 23.4, d: 11.4, r: 4.6, x: 0.0, y: 0.0 },
  { z: 7.5, w: 27.5, d: 17.0, r: 6.2, x: 0.0, y: -1.8 },
  { z: 17.0, w: 11.0, d: 11.0, r: 4.5, x: 0.0, y: -0.5 },
  { z: 23.5, w: 5.6, d: 5.6, r: 2.4, x: 0.0, y: 1.2 },
];
const EDGE = [
  { z: 5, w: 100, d: 2, r: 50 },
  { z: 5.1, w: 10, d: 10, r: 0.1 },
  { z: -30, w: 20, d: 20, r: 3 },
];

function expectRows(actual: number[][], expected: number[][]) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((row, i) => row.forEach((v, j) => expect(v).toBeCloseTo(expected[i]![j]!, 6)));
}

describe("legalizeLoft (mirror of the daemon's L1 and L3)", () => {
  it("clamps an over-flared hat exactly like the daemon", () => {
    const res = legalizeLoft(FLARE);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expectRows(res.slices, [
      [0, 24, 12, 4, 0, 0],
      [2, 27.12, 15.12, 6, 0, 0],
      [8, 36.48, 22, 6, 0, 0],
      [12, 16, 12, 4, 0, 0],
    ]);
    expect(res.changes.filter((c) => c.kind === "slope").map((c) => `${c.index}:${c.field}`)).toEqual([
      "1:w",
      "1:d",
      "2:w",
    ]);
  });

  it("leaves a legal recipe alone", () => {
    const res = legalizeLoft(WIZARD);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.changes).toEqual([]);
  });

  it("matches the daemon on unsorted, out-of-bounds and too-close slices", () => {
    const res = legalizeLoft(EDGE);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expectRows(res.slices, [
      [-20, 20, 20, 3, 0, 0],
      [5, 59, 3.6, 1.728, 0, 0],
      [5.5, 10, 4.38, 0.8, 0, 0],
    ]);
    expect(res.changes.some((c) => c.kind === "spacing")).toBe(true);
  });

  it("rejects the same shapes the daemon rejects", () => {
    expect(legalizeLoft([{ z: 0, w: 10, d: 10, r: 2 }]).ok).toBe(false);
    expect(legalizeLoft("nope").ok).toBe(false);
    expect(legalizeLoft([{ z: 0, w: "x" }, { z: 1 }]).ok).toBe(false);
    expect(legalizeLoft(Array.from({ length: 17 }, (_, i) => ({ z: i * 2, w: 10, d: 10, r: 2 }))).ok).toBe(false);
  });
});

describe("extractJsonObject", () => {
  it("finds an object inside prose and code fences", () => {
    const text = 'Here you go:\n```json\n{"a": {"b": "}"}, "c": 1}\n```\nEnjoy';
    expect(extractJsonObject(text)).toEqual({ a: { b: "}" }, c: 1 });
  });
  it("returns null for no object or broken JSON", () => {
    expect(extractJsonObject("no json here")).toBeNull();
    expect(extractJsonObject('{"a": ')).toBeNull();
  });
});

describe("gate keys and repair feedback", () => {
  const marginal: DaemonJob = {
    status: "digital_only",
    elapsed_ms: 11500,
    error: null,
    gate_report: {
      ok: false,
      design_status: "needs_reproportion",
      small_part: { status: "marginal", min_enclosing_diameter_mm: 31.86, margin_pct: 0.3 },
      blocking_failures: [],
      brand_errors: [],
      assembly: { ok: true, errors: [] },
    },
  };

  it("reports a marginal part even though blocking_failures is empty", () => {
    expect(gateKeysOf("digital_only", marginal, false)).toEqual(["small_part_marginal"]);
    const fb = buildFeedback("digital_only", marginal, false);
    expect(fb).toHaveLength(1);
    expect(fb[0]).toMatchObject({ gate: "small_part_marginal", measured: 31.86 });
  });

  it("labels compile errors, passes and unexplained failures", () => {
    expect(gateKeysOf("print_ready", null, false)).toEqual([]);
    expect(gateKeysOf("invalid", null, true)).toEqual(["compile_error"]);
    expect(gateKeysOf("daemon_error", null, false)).toEqual(["daemon_error"]);
    expect(gateKeysOf("digital_only", { ...marginal, gate_report: null }, false)).toEqual(["unexplained_digital_only"]);
    expect(buildFeedback("invalid", null, true)[0]?.gate).toBe("compile");
  });

  it("includes blocking gate ids with a hint", () => {
    const job: DaemonJob = {
      status: "digital_only",
      elapsed_ms: 1,
      error: null,
      gate_report: { ok: false, blocking_failures: [{ id: "P1_no_supports", detail: "overhang 3.2 mm2" }] },
    };
    expect(gateKeysOf("digital_only", job, false)).toEqual(["P1_no_supports"]);
    expect(buildFeedback("digital_only", job, false)[0]?.hint).toContain("0.78");
  });
});

describe("percentile and summarize", () => {
  it("uses nearest-rank percentiles", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 95)).toBe(5);
  });

  it("summarizes pass rates, per-gate counts and legalizer touches", () => {
    const attempt = (status: string, gates: string[], changes: number) => ({
      recipe: null,
      parseOk: true,
      compileError: false,
      status,
      gates,
      validationMs: 1000,
      wallMs: 1500,
      legalizerChanges: Array.from({ length: changes }, () => ({
        kind: "slope" as const,
        index: 1,
        field: "w" as const,
        from: 2,
        to: 1,
      })),
    });
    const results: PromptResult[] = [
      { id: "a", slot: "crown", text: "", attempts: [attempt("print_ready", [], 1)], passedFirst: true, passedFinal: true, calls: 1, totalMs: 1500, rating: null },
      {
        id: "b",
        slot: "crown",
        text: "",
        attempts: [attempt("digital_only", ["small_part_marginal"], 0), attempt("print_ready", [], 0)],
        passedFirst: false,
        passedFinal: true,
        calls: 2,
        totalMs: 3000,
        rating: null,
      },
      { id: "c", slot: "hand", text: "", attempts: [attempt("digital_only", ["P1_no_supports"], 0)], passedFirst: false, passedFinal: false, calls: 1, totalMs: 1500, rating: null },
    ];
    const s = summarize(results);
    expect(s.firstAttemptPass).toBe(1);
    expect(s.finalPass).toBe(2);
    expect(s.meanCalls).toBeCloseTo(4 / 3, 6);
    expect(s.failuresByGate).toEqual({ small_part_marginal: 1, P1_no_supports: 1 });
    expect(s.recipesTouchedByLegalizer).toBe(1);
    expect(s.bySlot.crown).toEqual({ prompts: 2, firstPass: 1, finalPass: 2 });
  });
});

describe("tests/forge/prompts.json", () => {
  const list = (prompts as { prompts: Array<{ id: string; slot: string; text: string }> }).prompts;
  const SLOTS = ["crown", "head", "back", "hand", "front", "rollbar", "spoiler", "hood", "roof", "exhaust"];

  it("has 60 unique prompts over the ten slots", () => {
    expect(list).toHaveLength(60);
    expect(new Set(list.map((p) => p.id)).size).toBe(60);
    for (const p of list) expect(SLOTS).toContain(p.slot);
    for (const slot of SLOTS) expect(list.some((p) => p.slot === slot)).toBe(true);
  });

  it("is brand-free and fits the kid-safety rules the intake filter enforces", () => {
    const brand = /\b(lego|duplo|technic|bionicle|meccano|playmobil|knex|k'nex|megabloks|mega\s*bloks)\b/i;
    const unsafe = /\b(scary|haunt\w*|horror|nightmare\w*|kill\w*|dead|death|blood\w*|gun|guns|knife|knives|weapon\w*|hate\w*|naked|nude|sexy|drug\w*|beer|wine|vodka|cigarette\w*)\b|\bwar\b/i;
    for (const p of list) {
      expect(brand.test(p.text), p.id).toBe(false);
      expect(unsafe.test(p.text), p.id).toBe(false);
      expect(p.text.length).toBeLessThanOrEqual(80);
    }
  });
});
