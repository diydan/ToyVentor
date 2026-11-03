import { describe, expect, it } from "vitest";
// The viewer modules are plain browser JS with no declaration files.
// @ts-expect-error untyped JS module
import * as printMod from "../parts/kip/viewer/kip-print.js";
// @ts-expect-error untyped JS module
import * as profMod from "../parts/kip/viewer/kip-print-profile.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const K = printMod as any;
const P = profMod as any;

// A watertight axis-aligned box as a flat triangle list (outward normals), `w x d x h` mm sitting on z = 0.
function box(w: number, d: number, h: number): Float32Array {
  const v = (x: number, y: number, z: number): [number, number, number] => [x * w, y * d, z * h];
  const quad = (a: number[], b: number[], c: number[], e: number[]) => [...a, ...b, ...c, ...a, ...c, ...e];
  const p = [v(0, 0, 0), v(1, 0, 0), v(1, 1, 0), v(0, 1, 0), v(0, 0, 1), v(1, 0, 1), v(1, 1, 1), v(0, 1, 1)];
  return new Float32Array([
    ...quad(p[0]!, p[3]!, p[2]!, p[1]!), // bottom (-z)
    ...quad(p[4]!, p[5]!, p[6]!, p[7]!), // top (+z)
    ...quad(p[0]!, p[1]!, p[5]!, p[4]!), // front (-y)
    ...quad(p[2]!, p[3]!, p[7]!, p[6]!), // back (+y)
    ...quad(p[1]!, p[2]!, p[6]!, p[5]!), // right (+x)
    ...quad(p[3]!, p[0]!, p[4]!, p[7]!), // left (-x)
  ]);
}
const COLOURS = ["#2E6FDB", "#F5C518", "#1FA97C", "#FF6B4A", "#8E5BD6", "#0096D6", "#B9C2D0", "#36405C", "#F4EFE6", "#D2C7B5"];
const parts = (n: number, w = 30, d = 20) =>
  Array.from({ length: n }, (_, i) =>
    K.prepareItem({ id: `part_${i}`, qty: 1, source: "partspec", hex: COLOURS[i % COLOURS.length] }, box(w, d, 10), { verified: true }));
const ids = (plan: any) => plan.plates.flatMap((pl: any) => pl.placed.map((p: any) => p.partId)).sort();

describe("print plates: colour split is a choice, not a given", () => {
  const profile = P.createDefaultProfile();

  it("by default (split by colour) every colour gets its own plates: ten colours, ten plates", () => {
    const plan = K.planColorPlates(parts(10), profile);
    expect(plan.plates).toHaveLength(10);
    expect(plan.plates.every((pl: any) => pl.placed.length === 1)).toBe(true);
    // and `splitByColour: true` says the same as leaving it out
    expect(K.planColorPlates(parts(10), profile, { splitByColour: true }).plates).toHaveLength(10);
  });

  it("with splitByColour false the same ten parts pack onto one plate, none lost or doubled", () => {
    const items = parts(10);
    const plan = K.planColorPlates(items, profile, { splitByColour: false });
    expect(plan.plates).toHaveLength(1);
    expect(ids(plan)).toEqual(ids(K.planColorPlates(items, profile)));
    expect(ids(plan)).toEqual(Array.from({ length: 10 }, (_, i) => `part_${i}`).sort());
  });

  it("packing together fills the bed and then moves on: parts that do not fit one plate spill to the next, in as few plates as it takes", () => {
    const items = parts(40, 60, 40); // 40 parts of 60 x 40 mm: far more than one 170 mm plate holds
    const together = K.planColorPlates(items, profile, { splitByColour: false });
    const split = K.planColorPlates(items, profile);
    expect(together.plates.length).toBeGreaterThan(1);
    expect(together.plates.length).toBeLessThan(split.plates.length);
    expect(ids(together)).toEqual(ids(split));
    // every plate but the last is genuinely full: it could not have taken one more part's footprint
    const area = (pl: any) => pl.placed.reduce((a: number, p: any) => a + p.w * p.h, 0);
    const full = together.plates.slice(0, -1).map(area);
    expect(Math.min(...full)).toBeGreaterThan(0.3 * 170 * 170);
  });

  it("every part in a together plan sits inside the plate bound and clear of its neighbours by the plan's own gap", () => {
    const plan = K.planColorPlates(parts(24, 40, 30), profile, { splitByColour: false });
    for (const pl of plan.plates) {
      const b = pl.boundMm;
      for (const p of pl.placed) {
        expect(p.x).toBeGreaterThanOrEqual(-1e-6);
        expect(p.y).toBeGreaterThanOrEqual(-1e-6);
        expect(p.x + p.w).toBeLessThanOrEqual(b + 1e-6);
        expect(p.y + p.h).toBeLessThanOrEqual(b + 1e-6);
      }
      for (let i = 0; i < pl.placed.length; i++) {
        for (let j = i + 1; j < pl.placed.length; j++) {
          const a = pl.placed[i], c = pl.placed[j];
          const gapX = Math.max(c.x - (a.x + a.w), a.x - (c.x + c.w));
          const gapY = Math.max(c.y - (a.y + a.h), a.y - (c.y + c.h));
          expect(Math.max(gapX, gapY), `${a.partId} vs ${c.partId} on plate ${pl.index}`).toBeGreaterThanOrEqual(pl.gap - 1e-6);
        }
      }
    }
  });

  it("names the plates \"All parts\" with no placeholder colour when packed together, and keeps the colour name and hex when split", () => {
    const together = K.planColorPlates(parts(3), profile, { splitByColour: false });
    expect(together.plates[0].label).toBe("Plate 1 of 1: All parts");
    const split = K.planColorPlates(parts(3), profile);
    expect(split.plates[0].label).toMatch(/^Plate 1 of 3: .+ \(#[0-9A-F]{6}\)$/i);
  });

  it("does not change the parts' own colours, only the plan's grouping (the input items are untouched)", () => {
    const items = parts(4);
    const before = items.map((i: any) => i.hex);
    K.planColorPlates(items, profile, { splitByColour: false });
    expect(items.map((i: any) => i.hex)).toEqual(before);
  });
});
