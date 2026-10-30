import { describe, expect, it } from "vitest";
import scanTargets from "./fixtures/scan-targets.json";
import { sizeClassForLength, type ToyKind } from "../shared/toy";

/** The worker's accepted scan range for a toy length (worker/index.ts). */
const MIN_LENGTH_MM = 10;
const MAX_LENGTH_MM = 1000;
/** The worker's prompt length cap (worker/index.ts). */
const MAX_PROMPT_LENGTH = 60;
const KINDS: ToyKind[] = ["car", "figure", "other"];
const SURFACES = ["flat", "rounded", "studded", "cylindrical", "boxy", "soft", "organic", "unstable"];
const FITS = ["high", "medium", "low"];

const items = scanTargets.items;

describe("household scan targets", () => {
  it("holds a ranked set of 100 household items", () => {
    expect(items).toHaveLength(100);
    expect(items.map((i) => i.rank)).toEqual(Array.from({ length: 100 }, (_, n) => n + 1));
  });

  it("gives every item a distinct one-noun SAM prompt", () => {
    const prompts = items.map((i) => i.prompt);
    expect(new Set(prompts).size).toBe(items.length);
    for (const prompt of prompts) {
      expect(prompt.length).toBeGreaterThan(0);
      expect(prompt.length).toBeLessThanOrEqual(MAX_PROMPT_LENGTH);
      // One short noun per request: "cup" hit where "coffee cup" missed.
      expect(prompt.split(/\s+/).length).toBeLessThanOrEqual(3);
    }
  });

  it("keeps every item inside what the scan endpoint accepts", () => {
    for (const item of items) {
      expect(KINDS).toContain(item.kind);
      expect(item.lengthMm).toBeGreaterThanOrEqual(MIN_LENGTH_MM);
      expect(item.lengthMm).toBeLessThanOrEqual(MAX_LENGTH_MM);
      expect(item.widthMm).toBeGreaterThan(0);
      expect(SURFACES).toContain(item.surface);
      expect(FITS).toContain(item.productFit);
    }
  });

  it("derives size class from the shared rule, not by hand", () => {
    for (const item of items) {
      expect(item.sizeClass).toBe(sizeClassForLength(item.lengthMm));
    }
  });

  it("covers both size classes and both vehicle and figure kinds", () => {
    expect(items.some((i) => i.sizeClass === "small")).toBe(true);
    expect(items.some((i) => i.sizeClass === "large")).toBe(true);
    expect(items.some((i) => i.kind === "car")).toBe(true);
    expect(items.some((i) => i.kind === "figure")).toBe(true);
    expect(items.some((i) => i.kind === "other")).toBe(true);
  });

  it("keeps the prompts proven against the real pipeline", () => {
    const prompts = items.map((i) => i.prompt);
    expect(prompts).toContain("cup");
    expect(prompts).toContain("bottle");
  });

  it("ranks the demo hero first", () => {
    // The demo script scans a car; the set must keep it at rank 1.
    expect(items[0]?.prompt).toBe("car");
    expect(items[0]?.kind).toBe("car");
  });
});
