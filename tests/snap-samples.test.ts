import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import seedCar from "../seed/toys/seed-car.json";
import seedFigure from "../seed/toys/seed-figure.json";
import baseSetJson from "../sets/base.json";
import { allPass, runChecks } from "../shared/checks";
import { validateSet, type Part, type ToySet } from "../shared/part";
import type { Toy } from "../shared/toy";
import { allParts, allSets, catalogErrors, glbFileFor, stlFileFor } from "../src/lib/catalog";

// Canonical 12.5 mm / 25 mm TU PartSpec catalog contract tests:
// - Every sets/*.json file auto-loads via src/lib/catalog.ts with zero errors.
// - Both Small (12.5 mm) and Large (25 mm) Snap size classes work in checks.
// - Every printable part in every set points to a real binary STL in
//   public/parts-stl/ and a real GLB in public/parts-glb/ (zero stubs).

const baseSet = baseSetJson as unknown as ToySet;
const car = seedCar as unknown as Toy;
const figure = seedFigure as unknown as Toy;

/** Stand-in sized like a big toddler truck for Large (25 mm TU) Snap parts. */
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

/** Wider scanned RC car where the 5×5 (62.5×62.5 mm) Forge Mount fits. */
const wideSmallToy: Toy = {
  id: "test-wide-rc",
  name: "Wide RC Buggy",
  kind: "car",
  sizeClass: "small",
  lengthMm: 140,
  widthMm: 75,
  attachPoints: [{ id: "roof", label: "Roof" }],
  source: "scan",
};

const snapParts = baseSet.parts.filter((p) => p.line === "snap");
const part = (id: string): Part => {
  const found = baseSet.parts.find((p) => p.id === id);
  if (!found) throw new Error(`part not in base set: ${id}`);
  return found;
};

const PITCH_MM: Record<string, number> = {
  tu_stud_small: 12.5,
  tu_stud_large: 25,
  "tu_12.5": 12.5,
};

describe("TU PartSpec sets and zero-code expansion loader", () => {
  it("loads base + Forge Club expansion sets with zero validation errors", () => {
    expect(validateSet(baseSetJson)).toEqual([]);
    expect(catalogErrors).toEqual([]);
    expect(allSets.length).toBeGreaterThanOrEqual(3);
    expect(allSets.map((s) => s.id)).toEqual(
      expect.arrayContaining(["base", "racer-garage", "kip-wardrobe"]),
    );
  });

  it("includes hero Snap & Pro parts across both 12.5 mm and 25 mm TU sizes", () => {
    for (const id of [
      "racer-spoiler",
      "brick-s-2x2",
      "big-blue-brick",
      "cloud-wings",
      "glow-capsule",
    ]) {
      expect(part(id).line).toBe("snap");
    }
    expect(part("big-blue-brick").sizeClass).toBe("large");
    for (const id of ["adapter-snap-pro", "beam-str-tu05", "pin-friction", "gear-spur-z10", "gear-spur-z20"]) {
      expect(part(id).line).toBe("pro");
    }
  });

  it("gives every part footprint = grid units × TU profile pitch", () => {
    for (const p of allParts) {
      const pitch = PITCH_MM[p.grid.profile];
      expect(pitch, `missing pitch for profile ${p.grid.profile} on ${p.id}`).toBeDefined();
      expect(p.footprintMm, p.id).toEqual([
        p.grid.units[0] * pitch!,
        p.grid.units[1] * pitch!,
      ]);
    }
  });

  it("passes every builder check for stud-mounted small Snap parts on both seed toys", () => {
    const smallStudParts = snapParts.filter(
      (p) => p.sizeClass === "small" && p.mount === "stud",
    );
    expect(smallStudParts.length).toBeGreaterThanOrEqual(5);
    for (const p of smallStudParts) {
      for (const toy of [car, figure]) {
        const failed = runChecks(p, toy)
          .filter((r) => !r.pass)
          .map((r) => r.id);
        expect(allPass(runChecks(p, toy)), `${p.id} on ${toy.id} (${failed})`).toBe(true);
      }
    }
    // 2x2 Snap-to-Pro bridge adapter fits both narrow seed toys; 5x5 Forge Mount fits wider toys.
    expect(allPass(runChecks(part("adapter-snap-pro"), car))).toBe(true);
    expect(allPass(runChecks(part("adapter-snap-pro"), figure))).toBe(true);
    expect(allPass(runChecks(part("forge-mount-ring-s"), wideSmallToy))).toBe(true);
  });

  it("gates Large 25 mm TU parts by size: fails the seed car, passes a large toy", () => {
    const brick = part("big-blue-brick");
    const onCar = runChecks(brick, car).find((r) => r.id === "fits-toy");
    expect(onCar?.pass).toBe(false);
    expect(allPass(runChecks(brick, largeToy))).toBe(true);
  });

  it("ships real STL and GLB files for every printable part across all loaded sets", () => {
    const printables = allParts.filter((p) => p.printable);
    expect(printables.length).toBeGreaterThanOrEqual(25);
    for (const p of printables) {
      const stl = stlFileFor(p);
      const glb = glbFileFor(p);
      expect(stl, `${p.id} missing stlFile`).toBeTruthy();
      expect(glb, `${p.id} missing glbFile`).toBeTruthy();
      expect(existsSync(join(process.cwd(), "public/parts-stl", stl!)), `missing STL ${stl}`).toBe(
        true,
      );
      expect(existsSync(join(process.cwd(), "public/parts-glb", glb!)), `missing GLB ${glb}`).toBe(
        true,
      );
    }
  });
});
