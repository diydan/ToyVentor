import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  clearanceForFit,
  DEFAULT_FIT,
  fitForDots,
  FIT_VARIANTS,
} from "../shared/calibration";

describe("fit variants (12.5 mm TU PartSpec hidden calibration)", () => {
  it("orders snug < standard < easy with matching 1/2/3 embossed dot counts", () => {
    expect(FIT_VARIANTS.map((v) => v.id)).toEqual(["snug", "standard", "easy"]);
    expect(clearanceForFit("snug")).toBeLessThan(clearanceForFit("standard"));
    expect(clearanceForFit("standard")).toBeLessThan(clearanceForFit("easy"));
    expect(FIT_VARIANTS.map((v) => v.dots)).toEqual([1, 2, 3]);
  });

  it("defaults to standard, matching PartSpec interfaces.json stud_small.fit (0.1 mm)", () => {
    const interfaces = JSON.parse(
      readFileSync(join(process.cwd(), "parts/partspec/interfaces.json"), "utf8"),
    ) as { interfaces: { stud_small: { fit: number } } };
    expect(DEFAULT_FIT).toBe("standard");
    expect(clearanceForFit(DEFAULT_FIT)).toBe(interfaces.interfaces.stud_small.fit);
  });

  it("continuously spans PartSpec's -0.07 to +0.08 mm printer surface-offset window with overlap", () => {
    const [snug, standard, easy] = FIT_VARIANTS;
    expect(snug.surfaceOffsetWindowMm[0]).toBeLessThanOrEqual(-0.075);
    expect(easy.surfaceOffsetWindowMm[1]).toBeGreaterThanOrEqual(0.08);
    // Adjacent socket windows must overlap so no printer offset falls into a gap.
    expect(snug.surfaceOffsetWindowMm[1]).toBeGreaterThan(standard.surfaceOffsetWindowMm[0]);
    expect(standard.surfaceOffsetWindowMm[1]).toBeGreaterThan(easy.surfaceOffsetWindowMm[0]);
  });

  it("maps embossed dots back to the variant", () => {
    expect(fitForDots(1)?.id).toBe("snug");
    expect(fitForDots(2)?.id).toBe("standard");
    expect(fitForDots(3)?.id).toBe("easy");
    expect(fitForDots(4)).toBeUndefined();
  });
});
