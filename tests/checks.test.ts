import { describe, expect, it } from "vitest";
import { allPass, runChecks } from "../shared/checks";
import { validatePart, validateSet, type Part } from "../shared/part";
import type { Toy } from "../shared/toy";

const toy: Toy = {
  id: "seed-car",
  name: "Seed Car",
  kind: "car",
  sizeClass: "small",
  lengthMm: 110,
  widthMm: 55,
  attachPoints: [{ id: "roof", label: "Roof" }],
  source: "seed",
};

const goodPart: Part = {
  id: "snap-spoiler-01",
  name: "Spoiler",
  line: "snap",
  mount: "stud",
  sizeClass: "small",
  grid: { units: [2, 1], profile: "stud_profile_small" },
  footprintMm: [32, 16],
  stat: { name: "speed", value: 2 },
  printable: true,
  orientation: "flat",
  supportFree: true,
};

const byId = (part: Part, id: string) =>
  runChecks(part, toy).find((r) => r.id === id);

describe("runChecks", () => {
  it("passes a well-formed part on a matching toy", () => {
    expect(allPass(runChecks(goodPart, toy))).toBe(true);
  });

  it("fails on-grid for fractional units", () => {
    const part = { ...goodPart, grid: { ...goodPart.grid, units: [1.5, 1] as [number, number] } };
    expect(byId(part, "on-grid")?.pass).toBe(false);
  });

  it("fails fits-toy on size-class mismatch", () => {
    const part = { ...goodPart, sizeClass: "large" as const };
    expect(byId(part, "fits-toy")?.pass).toBe(false);
  });

  it("fails fits-toy when the footprint exceeds the toy", () => {
    const part = { ...goodPart, footprintMm: [200, 16] as [number, number] };
    expect(byId(part, "fits-toy")?.pass).toBe(false);
  });

  it("fails support-free when no orientation is listed", () => {
    const { orientation: _drop, ...part } = goodPart;
    expect(byId(part as Part, "support-free")?.pass).toBe(false);
  });

  it("fails fits-bed past the default bed, passes for digital-only parts", () => {
    const huge = { ...goodPart, footprintMm: [300, 16] as [number, number] };
    expect(byId(huge, "fits-bed")?.pass).toBe(false);
    const skin: Part = { ...goodPart, id: "skin-01", printable: false, footprintMm: [300, 300] };
    expect(byId(skin, "fits-bed")?.pass).toBe(true);
    expect(byId(skin, "support-free")?.pass).toBe(true);
  });
});

describe("validatePart / validateSet", () => {
  it("accepts the good part and a one-part set", () => {
    expect(validatePart(goodPart)).toEqual([]);
    expect(validateSet({ id: "base", name: "Base", parts: [goodPart] })).toEqual([]);
  });

  it("rejects a stat list: a part gets exactly one stat", () => {
    const bad = { ...goodPart, stat: [{ name: "speed", value: 1 }, { name: "glow", value: 1 }] };
    expect(validatePart(bad).join(" ")).toMatch(/single object/);
  });

  it("rejects printable parts without orientation/support claim", () => {
    const bad = { ...goodPart, orientation: undefined, supportFree: undefined };
    const errors = validatePart(bad).join(" ");
    expect(errors).toMatch(/orientation/);
    expect(errors).toMatch(/supportFree/);
  });

  it("rejects duplicate part ids in a set", () => {
    const errors = validateSet({ id: "base", name: "Base", parts: [goodPart, goodPart] });
    expect(errors.join(" ")).toMatch(/duplicate/);
  });

  it("rejects unknown line, mount, and stat names", () => {
    const bad = { ...goodPart, line: "mega", mount: "glue", stat: { name: "luck", value: 9 } };
    const errors = validatePart(bad).join(" ");
    expect(errors).toMatch(/line/);
    expect(errors).toMatch(/mount/);
    expect(errors).toMatch(/stat\.name/);
  });
});
