import { describe, expect, it } from "vitest";
import {
  clearanceForFit,
  DEFAULT_FIT,
  fitForDots,
  FIT_VARIANTS,
} from "../shared/calibration";

describe("fit variants", () => {
  it("orders snug < standard < easy with matching dot counts", () => {
    expect(FIT_VARIANTS.map((v) => v.id)).toEqual(["snug", "standard", "easy"]);
    expect(clearanceForFit("snug")).toBeLessThan(clearanceForFit("standard"));
    expect(clearanceForFit("standard")).toBeLessThan(clearanceForFit("easy"));
    expect(FIT_VARIANTS.map((v) => v.dots)).toEqual([1, 2, 3]);
  });

  it("defaults to standard, matching the profile's starting clearance", () => {
    expect(DEFAULT_FIT).toBe("standard");
    expect(clearanceForFit(DEFAULT_FIT)).toBe(0.2);
  });

  it("maps embossed dots back to the variant", () => {
    expect(fitForDots(1)?.id).toBe("snug");
    expect(fitForDots(3)?.id).toBe("easy");
    expect(fitForDots(4)).toBeUndefined();
  });
});
