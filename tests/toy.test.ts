import { describe, expect, it } from "vitest";
import seedCar from "../seed/toys/seed-car.json";
import seedFigure from "../seed/toys/seed-figure.json";
import {
  mergeToyboxToys,
  sizeClassForLength,
  toyboxUploads,
  toyFromScanInput,
  validateToy,
  type Toy,
} from "../shared/toy";

describe("seed toys", () => {
  it("car and figure both validate (Day 2: car + figure saved)", () => {
    expect(validateToy(seedCar)).toEqual([]);
    expect(validateToy(seedFigure)).toEqual([]);
    expect(seedCar.kind).toBe("car");
    expect(seedFigure.kind).toBe("figure");
  });
});

describe("toyFromScanInput", () => {
  it("derives size class and attach points from kind and length", () => {
    const toy = toyFromScanInput({
      id: "t1",
      name: "Blue Car",
      kind: "car",
      lengthMm: 110,
      widthMm: 55,
      source: "manual",
    });
    expect(toy.sizeClass).toBe("small");
    expect(toy.attachPoints.map((a) => a.id)).toEqual(["roof", "rear"]);
    expect(toy.source).toBe("manual");
    expect(validateToy(toy)).toEqual([]);
  });

  it("crosses to large past the threshold", () => {
    expect(sizeClassForLength(120)).toBe("small");
    expect(sizeClassForLength(121)).toBe("large");
  });

  it("keeps SAM mask facts and puts the mask top anchor on the first attach point", () => {
    const toy = toyFromScanInput({
      id: "masked-car",
      name: "Masked Car",
      kind: "car",
      lengthMm: 110,
      widthMm: 55,
      source: "scan",
      outline: { x1: 0.2, y1: 0.3, x2: 0.7, y2: 0.8 },
      mask: {
        coverage: 0.72,
        outline: { x1: 0.2, y1: 0.3, x2: 0.7, y2: 0.8 },
        pixelWidth: 500,
        pixelHeight: 250,
        centroid: { x: 0.45, y: 0.55 },
        topAnchor: { x: 0.46, y: 0.31 },
        widestAnchor: { x: 0.44, y: 0.6 },
        silhouette: { path: "M0 0h2v1h-2Z", width: 2, height: 1 },
      },
    });
    expect(toy.mask?.coverage).toBe(0.72);
    expect(toy.attachPoints[0]).toMatchObject({ id: "roof", x: 0.46, y: 0.31 });
    expect(toy.attachPoints[1]).toEqual({ id: "rear", label: "Rear deck" });
    expect(validateToy(toy)).toEqual([]);
  });

  it("keeps manual toys manual — never silently becomes a scan", () => {
    const toy = toyFromScanInput({
      id: "t2",
      name: "Figure",
      kind: "figure",
      lengthMm: 90,
      widthMm: 40,
      source: "manual",
    });
    expect(toy.source).toBe("manual");
  });
});

describe("toybox home catalog", () => {
  const seedCarToy = seedCar as unknown as Toy;
  const seedFigureToy = seedFigure as unknown as Toy;
  const uploadedToy = toyFromScanInput({
    id: "uploaded-car",
    name: "Uploaded Car",
    kind: "car",
    lengthMm: 110,
    widthMm: 55,
    source: "scan",
  });

  it("shows built-in toys even before anything has been uploaded", () => {
    expect(mergeToyboxToys([], [seedCarToy, seedFigureToy])).toEqual([
      seedCarToy,
      seedFigureToy,
    ]);
  });

  it("keeps previous uploads first and does not duplicate built-ins", () => {
    const savedSeedCar = { ...seedCarToy, name: "Saved Seed Car" };
    const merged = mergeToyboxToys(
      [uploadedToy, savedSeedCar],
      [seedCarToy, seedFigureToy],
    );

    expect(merged.map((toy) => toy.id)).toEqual([
      "uploaded-car",
      "seed-car",
      "seed-figure",
    ]);
    expect(merged[1]?.name).toBe("Saved Seed Car");
    expect(toyboxUploads(merged)).toEqual([uploadedToy]);
  });
});

describe("validateToy", () => {
  it("rejects malformed mask summaries and partial attach-point hints", () => {
    const errors = validateToy({
      ...seedCar,
      attachPoints: [{ id: "roof", label: "Roof", x: 0.5 }],
      mask: { coverage: 2 },
    }).join(" ");
    expect(errors).toMatch(/attachPoint/);
    expect(errors).toMatch(/mask/);
  });

  it("rejects bad kind, source, and dimensions", () => {
    const errors = validateToy({
      ...seedCar,
      kind: "rocket",
      source: "imported",
      lengthMm: -1,
    }).join(" ");
    expect(errors).toMatch(/kind/);
    expect(errors).toMatch(/source/);
    expect(errors).toMatch(/lengthMm/);
  });
});
