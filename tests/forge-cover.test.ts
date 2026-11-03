import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COVER_DOME_MAX_MM,
  COVER_DOME_MIN_MM,
  COVER_MAX_MM,
  COVER_MIN_MM,
  UNIVERSAL_COVER,
  coverRecipe,
  coverRecipeForHead,
} from "../shared/forgeCover";
import type { ForgeRecipeV1 } from "../shared/forgeOptimizer";

function slicesOf(r: ForgeRecipeV1) {
  if (r.shape.kind === "star2d" || r.shape.kind === "profile2d") throw new Error("not a loft");
  return r.shape.slices;
}

const KID_HEAD: ForgeRecipeV1 = {
  v: 1,
  id: "kid_head",
  name: "Kid Head",
  slot: "head",
  shape: {
    kind: "loft",
    slices: [
      { z: 0, w: 26, d: 12.7, r: 5 },
      { z: 15, w: 38.1, d: 25.7, r: 9 },
      { z: 30.5, w: 30.7, d: 17.8, r: 6 },
    ],
  },
};

describe("smooth cover recipes", () => {
  it("is a flush crown whose first slice is on the head's top face", () => {
    for (const r of [UNIVERSAL_COVER, coverRecipe(30, 17), coverRecipeForHead(KID_HEAD)!]) {
      expect(r.slot).toBe("crown");
      expect(r.shape).toMatchObject({ kind: "loft", base: "flush" });
      const s = slicesOf(r);
      expect(s[0]!.z).toBe(0);
      expect(s.length).toBeGreaterThanOrEqual(2);
      expect(s.length).toBeLessThanOrEqual(16);
    }
  });

  it("keeps every footprint between the pad and the largest cover that seats", () => {
    for (const [w, d] of [[10, 5], [30, 17], [60, 40], [24.4, 11.9]] as const) {
      const first = slicesOf(coverRecipe(w, d))[0]!;
      expect(first.w).toBeGreaterThanOrEqual(COVER_MIN_MM.w);
      expect(first.w).toBeLessThanOrEqual(COVER_MAX_MM.w);
      expect(first.d).toBeGreaterThanOrEqual(COVER_MIN_MM.d);
      expect(first.d).toBeLessThanOrEqual(COVER_MAX_MM.d);
    }
  });

  it("is a dome tall enough to roof the stud sockets, narrowing at every slice (nothing overhangs)", () => {
    for (const r of [UNIVERSAL_COVER, coverRecipe(30, 17.6)]) {
      const s = slicesOf(r);
      const height = s[s.length - 1]!.z;
      expect(height).toBeGreaterThanOrEqual(COVER_DOME_MIN_MM * 0.9);
      expect(height).toBeLessThanOrEqual(COVER_DOME_MAX_MM);
      for (let i = 1; i < s.length; i++) {
        expect(s[i]!.w).toBeLessThan(s[i - 1]!.w);
        expect(s[i]!.d).toBeLessThan(s[i - 1]!.d);
        expect(s[i]!.z - s[i - 1]!.z).toBeGreaterThan(0.5); // the daemon moves slices closer than 0.5 mm apart
      }
    }
  });

  it("sizes a cover to the head's top face less an inset, and gives a small top the universal footprint", () => {
    const first = slicesOf(coverRecipeForHead(KID_HEAD)!)[0]!;
    expect(first.w).toBe(COVER_MAX_MM.w); // 30.7 - 0.6 = 30.1, held to the largest cover that seats
    expect(first.d).toBeCloseTo(17.2, 1);
    const mid: ForgeRecipeV1 = { ...KID_HEAD, shape: { kind: "loft", slices: [{ z: 0, w: 26, d: 12.7, r: 5 }, { z: 30.5, w: 28, d: 16, r: 6 }] } };
    const m = slicesOf(coverRecipeForHead(mid)!)[0]!;
    expect(m.w).toBeCloseTo(27.4, 1);
    expect(m.d).toBeCloseTo(15.4, 1);
    const tiny: ForgeRecipeV1 = { ...KID_HEAD, shape: { kind: "loft", slices: [{ z: 0, w: 24, d: 12, r: 3 }, { z: 30.5, w: 18, d: 12, r: 5 }] } };
    expect(slicesOf(coverRecipeForHead(tiny)!)[0]).toMatchObject({ w: COVER_MIN_MM.w, d: COVER_MIN_MM.d });
  });

  it("is only for heads with a loft shape", () => {
    expect(coverRecipeForHead({ ...KID_HEAD, slot: "crown" })).toBeNull();
    expect(coverRecipeForHead({ v: 1, name: "Star", slot: "hand", shape: { kind: "star2d" } })).toBeNull();
  });

  it("uses the same footprint limits as the daemon (a change there must change here)", () => {
    const daemon = readFileSync(join(__dirname, "..", "scripts", "forge_optimizer_daemon.py"), "utf8");
    const py = (v: number) => v.toFixed(1); // Python writes 30.0, JS 30
    expect(daemon).toContain(`COVER_MIN_MM = (${py(COVER_MIN_MM.w)}, ${py(COVER_MIN_MM.d)})`);
    expect(daemon).toContain(`COVER_MAX_MM = (${py(COVER_MAX_MM.w)}, ${py(COVER_MAX_MM.d)})`);
    expect(daemon).toContain('CROWN_BASES = ("pad", "flush")');
  });

  it("stays pure: no DOM, network, clock or randomness, and only a type import", () => {
    const src = readFileSync(join(__dirname, "..", "shared", "forgeCover.ts"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\b(document|window|fetch|localStorage|Date\.now|Math\.random|performance\.now)\b/);
    expect(code.match(/^[ \t]*import\s.*$/gm)?.map((l) => l.trim())).toEqual(['import type { ForgeLoftSlice, ForgeRecipeV1 } from "./forgeOptimizer";']);
  });
});
