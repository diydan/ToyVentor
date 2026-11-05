// The blueprint fills in as Kip is built (kid bench slice 2, 2026-11-05): a brick belongs to a region of the drawing, a region lights up as its bricks land, the Dress step shows the outline only, and the finished
// blueprint says BUILT. The classifier and the counting are pure; the drawing is checked on a canvas that records what is painted.
import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import {
  BLUEPRINT_BASE_REGIONS, BLUEPRINT_REGIONS, REGION_SHAPES, blueprintComplete, blueprintRegion, buildWorkshop, drawBlueprint, regionFractions, setBlueprintState,
  type BlueprintFill, type BlueprintRegion, type BlueprintState, type BrickPart,
} from "../src/features/game/world/runtime/workshopScene";

const g0 = globalThis as unknown as { document?: unknown };
afterEach(() => { delete g0.document; });

/** A canvas context that records every call and, for `fill` and `stroke`, the style current at that moment. */
function recorder() {
  const style = { fillStyle: "", strokeStyle: "", lineWidth: 0 };
  const log: Array<{ n: string; a: unknown[]; fill: string; stroke: string; lw: number }> = [];
  const ctx = new Proxy({}, {
    get: (_t, p) => (p === "measureText" ? (s: string) => ({ width: s.length * 12 }) : (...a: unknown[]) => { log.push({ n: String(p), a, fill: style.fillStyle, stroke: style.strokeStyle, lw: style.lineWidth }); }),
    set: (_t, p, v) => { (style as Record<string, unknown>)[String(p)] = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, log, texts: () => log.filter((l) => l.n === "fillText").map((l) => String(l.a[0])) };
}
const draw = (state?: BlueprintState) => { const r = recorder(); drawBlueprint(r.ctx, 1024, 768, "#ffd24d", state); return r; };
const regionFills = (log: ReturnType<typeof recorder>["log"]) => log.filter((l) => l.n === "fill");

describe("which region a brick belongs to", () => {
  it("is read from the part and its side", () => {
    const cases: Array<[BrickPart, number, BlueprintRegion]> = [["head", 0, "head"], ["hat", 0, "hat"], ["tail", 0, "tail"], ["torso", 0, "torso"], ["arm", 0, "armL"], ["arm", 1, "armR"], ["leg", 0, "legL"], ["leg", 1, "legR"], ["shoe", 0, "shoeL"], ["shoe", 1, "shoeR"]];
    for (const [part, side, want] of cases) expect(blueprintRegion(part, side), `${part}/${side}`).toBe(want);
  });
  it("treats any side that is not 1 as the first, so a stray number never makes a region that is not drawn", () => {
    for (const side of [-1, 2, 7, Number.NaN]) { expect(blueprintRegion("arm", side)).toBe("armL"); expect(blueprintRegion("shoe", side)).toBe("shoeL"); }
    for (const part of ["head", "hat", "tail", "arm", "leg", "shoe", "torso", "other"] as const) expect(BLUEPRINT_REGIONS).toContain(blueprintRegion(part, 1));
  });
  it("places an unknown brick by its seat: height says head, body, legs or shoes, and the side says which", () => {
    expect(blueprintRegion("other", 0, { dx: 0, y: 2.4 })).toBe("head");
    expect(blueprintRegion("other", 0, { dx: 0.1, y: 1.4 })).toBe("torso");
    expect(blueprintRegion("other", 0, { dx: -0.6, y: 1.4 })).toBe("armL");
    expect(blueprintRegion("other", 0, { dx: 0.6, y: 1.4 })).toBe("armR");
    expect(blueprintRegion("other", 0, { dx: -0.3, y: 0.7 })).toBe("legL");
    expect(blueprintRegion("other", 0, { dx: 0.3, y: 0.7 })).toBe("legR");
    expect(blueprintRegion("other", 0, { dx: -0.3, y: 0.1 })).toBe("shoeL");
    expect(blueprintRegion("other", 0, { dx: 0.3, y: 0.1 })).toBe("shoeR");
  });
  it("an unknown brick with no usable seat is the torso, never a throw", () => {
    expect(blueprintRegion("other")).toBe("torso");
    expect(blueprintRegion("other", 0, { dx: Number.NaN, y: 1 })).toBe("torso");
    expect(blueprintRegion("other", 0, { dx: 0, y: Infinity })).toBe("torso");
  });
});

describe("how much of each region is built", () => {
  const b = (region: BlueprintRegion, lit: boolean) => ({ region, lit });
  it("is the share of its bricks that have landed, and a region with no bricks is left out", () => {
    const f = regionFractions([b("armL", true), b("armL", false), b("armL", false), b("armL", false), b("torso", true), b("legR", false)]);
    expect(f.armL).toBeCloseTo(0.25, 9);
    expect(f.torso).toBe(1);
    expect(f.legR).toBe(0);
    expect(f.hat).toBeUndefined();
    expect(Object.keys(f).sort()).toEqual(["armL", "legR", "torso"]);
    expect(regionFractions([])).toEqual({});
  });
  it("is complete only with a head and a torso and every region that has bricks full", () => {
    const all: BlueprintFill = Object.fromEntries(BLUEPRINT_BASE_REGIONS.map((r) => [r, 1]));
    expect(blueprintComplete(all)).toBe(true);
    expect(blueprintComplete({ ...all, hat: 1, tail: 1 })).toBe(true);
    expect(blueprintComplete({ ...all, hat: 0.5 })).toBe(false);
    expect(blueprintComplete({ ...all, armR: 0.99 })).toBe(false);
    expect(blueprintComplete({ ...all, head: undefined })).toBe(false);
    expect(blueprintComplete({ torso: 1 })).toBe(false);
    expect(blueprintComplete(undefined)).toBe(false);
    expect(blueprintComplete({})).toBe(false);
  });
});

describe("the drawing", () => {
  it("with no state is the outline only: every shape of the eight regions outlined, nothing filled, no hat and no tail", () => {
    const { log, texts } = draw();
    expect(regionFills(log)).toHaveLength(0);
    const strokes = log.filter((l) => l.n === "stroke" && l.lw === 3 && l.stroke === "#ffffff").length;
    const base = BLUEPRINT_BASE_REGIONS.reduce((n, r) => n + REGION_SHAPES[r].length, 0);
    expect(strokes).toBe(base + 2);                                                  // the eight regions' shapes and the two eyes: no hat outline, no tail outline
    expect(texts()).not.toContain("HAT");
    expect(texts()).not.toContain("TAIL");
    expect(texts()).toContain("BLUEPRINT  1:1");
    expect(texts()).not.toContain("BUILT!  100%");
  });
  it("a half-built region is filled in the light colour, a whole one in gold with a gold outline", () => {
    const half = regionFills(draw({ fill: { torso: 0.5 } }).log);
    expect(half).toHaveLength(1);
    expect(half[0]!.fill).toMatch(/^rgba\(155,231,255,0\.\d\d\)$/);
    const more = regionFills(draw({ fill: { torso: 1 } }).log);
    expect(more[0]!.fill).toBe("rgba(255,210,77,0.55)");
    expect(draw({ fill: { torso: 1 } }).log.some((l) => l.n === "stroke" && l.stroke === "#ffd24d" && l.lw === 4)).toBe(true);
    const lo = Number(/,(0\.\d\d)\)/.exec(regionFills(draw({ fill: { torso: 0.1 } }).log)[0]!.fill)![1]);
    const hi = Number(/,(0\.\d\d)\)/.exec(regionFills(draw({ fill: { torso: 0.9 } }).log)[0]!.fill)![1]);
    expect(hi).toBeGreaterThan(lo);                                                   // more built, more lit
  });
  it("a region with several shapes fills every one of them", () => {
    expect(regionFills(draw({ fill: { head: 0.4 } }).log)).toHaveLength(REGION_SHAPES.head.length);
  });
  it("the hat and the tail are drawn and labelled only when Kip has them (even at 0)", () => {
    const none = draw({ fill: { hat: 0 } });
    expect(none.texts()).toContain("HAT");
    expect(none.texts()).not.toContain("TAIL");
    const both = draw({ fill: { hat: 0, tail: 0.5 } });
    expect(both.texts()).toContain("TAIL");
    const whites = (r: ReturnType<typeof recorder>) => r.log.filter((l) => l.n === "stroke" && l.lw === 3 && l.stroke === "#ffffff").length;
    expect(whites(none)).toBe(whites(draw()) + REGION_SHAPES.hat.length);              // a hat outline and nothing else
    expect(whites(both)).toBe(whites(draw()) + REGION_SHAPES.hat.length + REGION_SHAPES.tail.length);
  });
  it("says BUILT only when the whole blueprint is built", () => {
    const all: BlueprintFill = { ...Object.fromEntries(BLUEPRINT_BASE_REGIONS.map((r) => [r, 1])), hat: 1 };
    expect(draw({ fill: all }).texts()).toContain("BUILT!  100%");
    expect(draw({ fill: { ...all, hat: 0.5 } }).texts()).toContain("BLUEPRINT  1:1");
    expect(draw({ fill: { ...all, hat: 0.5 } }).texts()).not.toContain("BUILT!  100%");
  });
  it("the region of the brick in the child's hand is dashed in orange, and the dash is switched off again", () => {
    const { log } = draw({ focus: "armR" });
    const dash = log.filter((l) => l.n === "setLineDash");
    expect(dash.map((l) => JSON.stringify(l.a[0]))).toEqual(["[10,7]", "[]"]);
    expect(log.some((l) => l.n === "stroke" && l.stroke === "#ff6b4a" && l.lw === 5)).toBe(true);
    expect(draw({ focus: null }).log.filter((l) => l.n === "setLineDash")).toHaveLength(0);
    expect(draw({ focus: "nonsense" as BlueprintRegion }).log.filter((l) => l.n === "setLineDash")).toHaveLength(0);
  });
  it("a bad fill value (negative, above 1, not a number) is clamped, never drawn as a style with NaN in it", () => {
    for (const v of [-3, 7, Number.NaN, Infinity]) {
      const { log } = draw({ fill: { torso: v } });
      for (const f of regionFills(log)) expect(f.fill).not.toMatch(/NaN|Infinity|-/);
    }
  });
});

describe("the poster on the wall", () => {
  function fakeDocument() {
    const r = recorder();
    g0.document = { createElement: () => ({ width: 0, height: 0, getContext: () => r.ctx }) };
    return r;
  }
  it("is redrawn with the new state and flagged for upload", () => {
    const r = fakeDocument();
    const g = buildWorkshop({ x: 0, z: 0 });
    const tex = g.userData.poster.tex as THREE.Texture;
    const before = r.log.length, v0 = tex.version;
    expect(setBlueprintState(g, { fill: { torso: 1 } })).toBe(true);
    expect(r.log.length).toBeGreaterThan(before);
    expect(tex.version).toBeGreaterThan(v0);
    expect(regionFills(r.log).some((f) => f.fill === "rgba(255,210,77,0.55)")).toBe(true);
  });
  it("does nothing, and says so, for the flat fallback, no group, or a canvas that throws", () => {
    delete g0.document;
    const flat = buildWorkshop({ x: 0, z: 0 });
    expect(setBlueprintState(flat, { fill: { torso: 1 } })).toBe(false);
    expect(setBlueprintState(null, {})).toBe(false);
    expect(setBlueprintState(undefined, {})).toBe(false);
    fakeDocument();
    const g = buildWorkshop({ x: 0, z: 0 });
    g.userData.poster.ctx = new Proxy({}, { get: () => () => { throw new Error("lost context"); }, set: () => true });
    expect(() => setBlueprintState(g, {})).not.toThrow();
    expect(setBlueprintState(g, {})).toBe(false);
  });
});
