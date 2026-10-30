import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import seedCar from "../seed/toys/seed-car.json";
import seedFigure from "../seed/toys/seed-figure.json";
import baseSetJson from "../sets/base.json";
import { allPass, runChecks } from "../shared/checks";
import { validateSet, type Part, type ToySet } from "../shared/part";
import type { Toy } from "../shared/toy";

// First Snap sample parts (docs/snap-samples.md). These tests hold the
// samples to the same contract as everything else: valid set data,
// builder checks passing in BOTH sizes (docs/snap.md "Done when"), and
// a real OpenSCAD file behind every printable Snap part — no stubs.

const baseSet = baseSetJson as unknown as ToySet;
const car = seedCar as unknown as Toy;
const figure = seedFigure as unknown as Toy;

/** No large seed toy exists yet; stand-in sized like a big toddler truck. */
const largeToy: Toy = {
  id: "test-large-truck",
  name: "Test Large Truck",
  kind: "car",
  sizeClass: "large",
  lengthMm: 170,
  widthMm: 100,
  attachPoints: [{ id: "roof", label: "Roof" }],
  source: "seed",
};

const snapParts = baseSet.parts.filter((p) => p.line === "snap");
const part = (id: string): Part => {
  const found = baseSet.parts.find((p) => p.id === id);
  if (!found) throw new Error(`part not in base set: ${id}`);
  return found;
};

/** Grid pitch per profile, mirroring parts/scad/profiles/*.scad. */
const PITCH_MM: Record<string, number> = {
  stud_profile_small: 16,
  stud_profile_large: 32,
};

/** Printable Snap part -> the SCAD file that must generate its STL. */
const SCAD_BY_PART: Record<string, string> = {
  "snap-spoiler-01": "parts/scad/snap/spoiler.scad",
  "snap-brick-2x2-small": "parts/scad/snap/brick-2x2-small.scad",
  "snap-brick-2x2-large": "parts/scad/snap/brick-2x2-large.scad",
  "forge-mount-small": "parts/scad/mount/forge-mount.scad",
  "snap-wing-01": "parts/scad/snap/dragon-wing.scad",
  "snap-glow-capsule-01": "parts/scad/snap/glow-capsule.scad",
};

describe("snap samples in the base set", () => {
  it("keeps the whole base set valid", () => {
    expect(validateSet(baseSetJson)).toEqual([]);
  });

  it("includes the four designed samples across both sizes", () => {
    for (const id of [
      "snap-brick-2x2-small",
      "snap-brick-2x2-large",
      "snap-wing-01",
      "snap-glow-capsule-01",
    ]) {
      expect(part(id).line).toBe("snap");
    }
    expect(part("snap-brick-2x2-large").sizeClass).toBe("large");
  });

  it("gives every snap part footprint = grid units x profile pitch", () => {
    for (const p of snapParts) {
      const pitch = PITCH_MM[p.grid.profile];
      if (pitch === undefined) continue; // non-stud profiles checked elsewhere
      expect(p.footprintMm, p.id).toEqual([
        p.grid.units[0] * pitch,
        p.grid.units[1] * pitch,
      ]);
    }
  });

  it("passes every builder check for small parts on both seed toys", () => {
    for (const p of snapParts.filter((p) => p.sizeClass === "small")) {
      for (const toy of [car, figure]) {
        const failed = runChecks(p, toy)
          .filter((r) => !r.pass)
          .map((r) => r.id);
        expect(allPass(runChecks(p, toy)), `${p.id} on ${toy.id} (${failed})`).toBe(true);
      }
    }
  });

  it("gates the large brick by size: fails the seed car, passes a large toy", () => {
    const brick = part("snap-brick-2x2-large");
    const onCar = runChecks(brick, car).find((r) => r.id === "fits-toy");
    expect(onCar?.pass).toBe(false);
    expect(allPass(runChecks(brick, largeToy))).toBe(true);
  });

  it("has an OpenSCAD source file for every printable snap part", () => {
    for (const p of snapParts.filter((p) => p.printable)) {
      const scad = SCAD_BY_PART[p.id];
      expect(scad, `${p.id} needs a SCAD entry in this test`).toBeTruthy();
      expect(existsSync(join(process.cwd(), scad as string)), scad).toBe(true);
    }
  });
});
