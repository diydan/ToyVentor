// The smooth cover the game draws on a bare head (runtime/kipCover.ts). It is the forge's `smooth_cover` (shared/forgeCover.ts) sampled finer, so it must keep the forge's numbers.
import { describe, expect, it } from "vitest";
import { COVER_MIN_MM, coverRecipe } from "../shared/forgeCover";
import { COVER_T, coverMesh, coverProfile, roundedRing } from "../src/features/game/world/runtime/kipCover";

describe("kipCover", () => {
  const m = coverMesh();
  const at = (i: number) => [m.positions[i * 3]!, m.positions[i * 3 + 1]!, m.positions[i * 3 + 2]!] as const;

  it("has the universal footprint and the forge's height", () => {
    expect(m.width).toBe(COVER_MIN_MM.w);
    expect(m.depth).toBe(COVER_MIN_MM.d);
    expect(m.height).toBeGreaterThanOrEqual(8);
    expect(m.height).toBeLessThanOrEqual(10);
    const xs: number[] = [], ys: number[] = [], zs: number[] = [];
    for (let i = 0; i < m.positions.length / 3; i++) { const [x, y, z] = at(i); xs.push(x); ys.push(y); zs.push(z); }
    expect(Math.max(...xs)).toBeCloseTo(m.width / 2, 2);
    expect(Math.min(...xs)).toBeCloseTo(-m.width / 2, 2);
    expect(Math.max(...ys)).toBeCloseTo(m.depth / 2, 2);
    expect(Math.min(...zs)).toBe(0);
    expect(Math.max(...zs)).toBeCloseTo(m.height, 3);
  });

  it("covers both studs of the head (they span +-9.58 x +-3.33 mm and rise 2.84 mm)", () => {
    // the dome is at least as wide as the studs at the studs' height
    const f = coverProfile(2.84 / m.height);
    expect((m.width * f) / 2).toBeGreaterThan(9.58);
    expect((m.depth * f) / 2).toBeGreaterThan(3.33);
  });

  it("samples every slice of the forge's own recipe", () => {
    const slices = (coverRecipe(COVER_MIN_MM.w, COVER_MIN_MM.d).shape as { slices: { z: number; w: number; d: number }[] }).slices;
    for (const s of slices) {
      const t = s.z / m.height;
      expect(COVER_T.some((x) => Math.abs(x - t) < 0.006), `slice at z=${s.z}`).toBe(true);
      expect(m.width * coverProfile(t)).toBeCloseTo(s.w, 1);
      expect(m.depth * coverProfile(t)).toBeCloseTo(s.d, 1);
    }
  });

  it("is a closed-on-top convex dome: every triangle faces away from its middle, no index is out of range", () => {
    const n = m.positions.length / 3;
    const mid = [0, 0, m.height * 0.3];
    for (let t = 0; t < m.indices.length; t += 3) {
      const [a, b, c] = [m.indices[t]!, m.indices[t + 1]!, m.indices[t + 2]!];
      expect(Math.max(a, b, c)).toBeLessThan(n);
      const A = at(a), B = at(b), C = at(c);
      const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
      const nrm = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
      const cen = [(A[0] + B[0] + C[0]) / 3 - mid[0]!, (A[1] + B[1] + C[1]) / 3 - mid[1]!, (A[2] + B[2] + C[2]) / 3 - mid[2]!];
      expect(nrm[0]! * cen[0]! + nrm[1]! * cen[1]! + nrm[2]! * cen[2]!).toBeGreaterThanOrEqual(0);
    }
  });

  it("rounded rings are closed, symmetric and inside their box", () => {
    const ring = roundedRing(24.4, 11.9, 4.9);
    expect(ring.length).toBe(4 * 7);
    for (const [x, y] of ring) { expect(Math.abs(x)).toBeLessThanOrEqual(12.2 + 1e-9); expect(Math.abs(y)).toBeLessThanOrEqual(5.95 + 1e-9); }
    const sx = ring.reduce((s, p) => s + p[0], 0), sy = ring.reduce((s, p) => s + p[1], 0);
    expect(Math.abs(sx)).toBeLessThan(1e-9);
    expect(Math.abs(sy)).toBeLessThan(1e-9);
  });
});
