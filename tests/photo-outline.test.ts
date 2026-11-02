import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ForgeRecipeV1 } from "../shared/forgeOptimizer";
import {
  type Affine,
  applyAffine,
  composeAffine,
  DEFAULT_FILLET_MM,
  DEFAULT_TARGET_MM,
  FILLET_LADDER,
  flipOutline,
  HAND_BOX,
  invertAffine,
  legalizeOutline,
  type OutlineOptions,
  type OutlineSuccess,
  outlineToRecipeShape,
  RETRY_LADDER,
  retryOptions,
  scaleOutline,
  withFlipped,
  withScaled,
} from "../shared/photoOutline";
import {
  axisFromVerticalDeg,
  bbox,
  countOn,
  countPieces,
  disc,
  isSimplePolygon,
  jaggedDisc,
  polygon,
  polygonIoU,
  randomBlob,
  type Raster,
  rasterize,
  rect,
  rotated,
  SHAPES,
  signedArea,
  union,
  widthNear,
} from "./fixtures/outlineMasks";

function ok(mask: Raster, options?: OutlineOptions): OutlineSuccess {
  const r = legalizeOutline(mask, options);
  if (!r.ok) throw new Error(`legalizeOutline failed: ${r.reason}: ${r.detail}`);
  return r;
}
const codes = (r: OutlineSuccess) => r.changes.map((c) => c.code);

/** A lollipop: round head, 30 px stick (4.5 mm at 54 mm: the default rounding needs 3.2), drawn upright on a 400 px canvas, 360 px long. */
const lollipopUp = () => union(disc(200, 100, 80), rect(185, 170, 215, 380));

describe("legalizeOutline: the output contract, on every standard shape", () => {
  for (const name of ["disc", "paddle", "blade", "star"] as const) {
    it(`${name}: 3 to 64 finite two-decimal points, counter-clockwise, simple, inside the box, bottom at 0, centred, about 54 mm tall`, () => {
      const r = ok(SHAPES[name]());
      expect(r.points.length).toBeGreaterThanOrEqual(3);
      expect(r.points.length).toBeLessThanOrEqual(64);
      for (const [x, z] of r.points) {
        expect(Number.isFinite(x) && Number.isFinite(z)).toBe(true);
        expect(Math.abs(x * 100 - Math.round(x * 100))).toBeLessThan(1e-6);
        expect(Math.abs(z * 100 - Math.round(z * 100))).toBeLessThan(1e-6);
      }
      expect(signedArea(r.points)).toBeGreaterThan(0);
      expect(isSimplePolygon(r.points)).toBe(true); // an independent checker, not the module's own
      const b = bbox(r.points);
      expect(b.z0).toBeCloseTo(0, 1);
      expect(Math.abs(b.x0 + b.x1)).toBeLessThanOrEqual(0.03);
      expect(b.x1).toBeLessThanOrEqual(HAND_BOX.halfWidthMm);
      expect(b.z1).toBeLessThanOrEqual(HAND_BOX.maxHeightMm);
      // 54 mm is the object as photographed. Rounding blunts sharp tips (a 36 degree star tip loses about 2.7 mm of reach), never adds height.
      expect(r.heightMm).toBeLessThanOrEqual(DEFAULT_TARGET_MM + 0.5);
      expect(r.heightMm).toBeGreaterThan(DEFAULT_TARGET_MM * 0.9);
      expect(r.fidelity).toBeGreaterThanOrEqual(0.96);
      expect(r.warnings).toEqual([]);
    });
  }

  it("is deterministic, and number[] / 0-255 / Uint8Array masks give the same answer", () => {
    const m = SHAPES.paddle();
    const a = ok(m);
    expect(ok(m)).toEqual(a);
    expect(ok({ ...m, data: Array.from(m.data) as unknown as Uint8Array })).toEqual(a);
    expect(ok({ ...m, data: m.data.map((v) => (v ? 255 : 0)) })).toEqual(a);
  });

  it("does not depend on mask resolution: the same paddle at 100 px and 400 px lands on the same outline", () => {
    const small = rasterize(100, 100, union(disc(50, 30, 22.5), rect(46.25, 50, 53.75, 95)));
    const a = ok(SHAPES.paddle());
    const b = ok(small);
    expect(polygonIoU(a.points, b.points)).toBeGreaterThan(0.95);
    expect(Math.abs(a.heightMm - b.heightMm)).toBeLessThan(1);
  });

  it("rejects what it cannot use, and says why", () => {
    expect(legalizeOutline({ data: new Uint8Array(0), width: 0, height: 0 })).toMatchObject({ ok: false, reason: "bad_mask" });
    expect(legalizeOutline({ data: new Uint8Array(10), width: 4, height: 4 })).toMatchObject({ ok: false, reason: "bad_mask" });
    expect(legalizeOutline({ data: new Uint8Array(16), width: 4, height: 4 })).toMatchObject({ ok: false, reason: "empty_mask" });
    expect(legalizeOutline({ data: new Uint8Array(16).fill(1), width: 1.5, height: 4 })).toMatchObject({ ok: false, reason: "bad_mask" });
  });

  it("reports a mask too thin to print instead of returning an empty shape", () => {
    const line = rasterize(400, 400, rect(199, 20, 201, 380)); // 2 px: a fraction of a millimetre at 54 mm
    expect(legalizeOutline(line)).toMatchObject({ ok: false, reason: "too_thin" });
  });
});

describe("C1: one body", () => {
  it("keeps the larger of two pieces (canary: the mask really has two)", () => {
    const m = SHAPES.twoBlobs();
    expect(countPieces(m)).toBe(2);
    const r = ok(m);
    expect(codes(r)).toContain("dropped_pieces");
    expect(r.changes.find((c) => c.code === "dropped_pieces")?.value).toBe(1);
    // Had the small blob stayed, the outline would be 355 px wide against 200 tall and the 54 mm height would shrink.
    expect(r.widthMm).toBeGreaterThan(52);
    expect(r.heightMm).toBeGreaterThan(52);
    expect(r.warnings).not.toContain("SPLIT_OBJECT"); // the kept piece holds 86% of the mask
  });

  it("warns SPLIT_OBJECT when two pieces are close in size, since which one the kid meant is a guess", () => {
    const m = rasterize(400, 400, union(disc(105, 200, 100), disc(305, 200, 90)));
    expect(countPieces(m)).toBe(2);
    expect(ok(m).warnings).toContain("SPLIT_OBJECT");
  });

  it("fills a hole (canary: the ring really has one) and warns when it was a big share of the object", () => {
    const ring = SHAPES.ring();
    const solid = rasterize(400, 400, disc(200, 200, 150));
    expect(countOn(ring)).toBeLessThan(countOn(solid) * 0.9);
    const r = ok(ring);
    expect(r.changes.find((c) => c.code === "filled_holes")?.value).toBe(1);
    expect(r.warnings).toContain("LARGE_HOLES_FILLED");
    const area = Math.abs(signedArea(r.points));
    expect(area).toBeGreaterThan(Math.PI * 27 * 27 * 0.97); // the full 54 mm disc, hole included
    expect(area).toBeLessThan(Math.PI * 27 * 27 * 1.03);
  });

  it("fills holes before judging which end is the handle (a hole near one end must not make that end look narrow)", () => {
    // A 360 x 100 px bar lying down with a 70 px hole 60 px in from its left end: both ends are 100 px wide once filled.
    const bar = rasterize(400, 400, (x, y) => rect(20, 150, 380, 250)(x, y) && !disc(80, 200, 35)(x, y));
    const solid = rasterize(400, 400, rect(20, 150, 380, 250));
    expect(countOn(bar)).toBeLessThan(countOn(solid) - 3000); // canary: the hole is real
    const r = ok(bar);
    expect(codes(r)).toContain("filled_holes");
    expect(r.orientation.reason).toBe("tie"); // with the hole left in, the left end reads as narrow and "narrow-end-down" wins
  });

  it("fills a pinhole and drops a speck without raising either warning", () => {
    const pin = rasterize(400, 400, (x, y) => disc(200, 200, 150)(x, y) && !disc(210, 190, 2)(x, y));
    const speck = rasterize(400, 400, union(disc(200, 200, 150), disc(5, 5, 1.5)));
    expect(countPieces(speck)).toBe(2);
    const a = ok(pin);
    const b = ok(speck);
    expect(codes(a)).toContain("filled_holes");
    expect(a.warnings).toEqual([]);
    expect(codes(b)).toContain("dropped_pieces");
    expect(b.warnings).toEqual([]);
  });
});

describe("C2: minimum feature", () => {
  // The antenna is part of a 340 px tall mask scaled to 54 mm, so 0.16 mm per px.
  const withAntenna = (px: number) => rasterize(400, 400, union(disc(200, 260, 100), rect(200 - px / 2, 20, 200 + px / 2, 160)));

  it("removes a 0.6 mm antenna, says so, and keeps the requested size (the object as a whole is 54 mm tall, antenna included)", () => {
    const r = ok(withAntenna(4));
    expect(codes(r)).toContain("thin_parts_removed");
    expect(r.warnings).toContain("THIN_PARTS_REMOVED");
    // The 200 px disc at 340 px = 54 mm is 31.8 mm. Refitting it to 54 would make the antenna 1 mm wide: still thin, and bigger than asked.
    expect(r.widthMm).toBeGreaterThan(30);
    expect(r.widthMm).toBeLessThan(34);
    expect(r.heightMm).toBeLessThan(36);
  });

  it("keepThinParts cannot save a 0.6 mm antenna even at the 90 mm limit, so it asks for nothing bigger and still reports the loss", () => {
    const plain = ok(withAntenna(4));
    const keep = ok(withAntenna(4), { keepThinParts: true });
    expect(keep.heightMm).toBeCloseTo(plain.heightMm, 1);
    expect(codes(keep)).not.toContain("grew_to_keep_thin_parts");
    expect(keep.warnings).toContain("THIN_PARTS_REMOVED");
  });

  it("keeps a 4.8 mm one (canary: the same call with a wide antenna stays tall and narrow)", () => {
    const r = ok(withAntenna(30));
    expect(codes(r)).not.toContain("thin_parts_removed");
    expect(r.widthMm).toBeLessThan(36);
    expect(r.heightMm).toBeGreaterThan(52);
    expect(widthNear(r.points, 45, 52)).toBeGreaterThan(4); // the antenna is still there, near its 4.8 mm
  });

  it("follows the fillet: at 3 mm a 4.6 mm paddle stick is thinner than 6 mm, so it goes and the head is all that is left", () => {
    const wide = ok(SHAPES.paddle(), { fillet_r_mm: 1.2 });
    const tight = ok(SHAPES.paddle(), { fillet_r_mm: 3 });
    expect(codes(wide)).not.toContain("thin_parts_removed");
    expect(codes(tight)).toContain("thin_parts_removed");
    expect(tight.fillet_r_mm).toBe(3);
    expect(tight.heightMm).toBeGreaterThan(26); // the 180 px head at 0.154 mm per px
    expect(tight.heightMm).toBeLessThan(30);
  });

  it("keepThinParts grows the paddle just enough for a 3 mm rounding to keep its stick (30 px must reach 6 mm: about 70 mm tall)", () => {
    const r = ok(SHAPES.paddle(), { fillet_r_mm: 3, keepThinParts: true });
    expect(codes(r)).toContain("grew_to_keep_thin_parts");
    expect(codes(r)).not.toContain("thin_parts_removed");
    expect(r.warnings).not.toContain("THIN_PARTS_REMOVED");
    expect(r.heightMm).toBeGreaterThan(68);
    expect(r.heightMm).toBeLessThan(76);
    expect(widthNear(r.points, 6, 14)).toBeGreaterThan(5.8); // the stick, now wide enough to survive
    expect(ok(SHAPES.paddle(), { fillet_r_mm: 3, keepThinParts: true })).toEqual(r);
  });

  it("keepThinParts changes nothing when nothing was thin (canary: the default paddle comes out the same)", () => {
    expect(ok(SHAPES.paddle(), { keepThinParts: true })).toEqual(ok(SHAPES.paddle()));
  });

  it("clamps a fillet outside 0.4 to 4 and says so", () => {
    const r = ok(SHAPES.disc(), { fillet_r_mm: 10 });
    expect(r.fillet_r_mm).toBe(4);
    expect(codes(r)).toContain("fillet_clamped");
    expect(ok(SHAPES.disc(), { fillet_r_mm: 0 }).fillet_r_mm).toBe(0.4);
  });

  it("the paddle stick comes out near its true 4.6 mm (scale and shape both right)", () => {
    const r = ok(SHAPES.paddle());
    const w = widthNear(r.points, 4, 12);
    expect(w).toBeGreaterThan(4.2);
    expect(w).toBeLessThan(5.0);
  });
});

describe("C3: fit", () => {
  it("honours a target height and caps it at the 90 mm box", () => {
    expect(ok(SHAPES.paddle(), { targetHeightMm: 70 }).heightMm).toBeCloseTo(70, 0);
    const big = ok(SHAPES.paddle(), { targetHeightMm: 500 });
    expect(big.heightMm).toBeLessThanOrEqual(HAND_BOX.maxHeightMm);
    expect(big.heightMm).toBeGreaterThan(HAND_BOX.maxHeightMm - 1);
  });

  it("limits a wide object by the 90 mm width, not the height, when it is kept as photographed", () => {
    const bar = rasterize(400, 400, rect(20, 180, 380, 220)); // 360 x 40 px
    const r = ok(bar, { orient: "as-photographed" });
    expect(r.widthMm).toBeGreaterThan(89);
    expect(r.widthMm).toBeLessThanOrEqual(90);
    expect(r.heightMm).toBeLessThan(15);
    expect(r.changes.find((c) => c.code === "fitted")?.detail).toContain("limited by width");
  });

  it("stays inside the box at the largest size on a shape as wide as it is tall", () => {
    const r = ok(SHAPES.disc(), { targetHeightMm: 90 });
    const b = bbox(r.points);
    expect(b.x1).toBeLessThanOrEqual(45);
    expect(b.x0).toBeGreaterThanOrEqual(-45);
    expect(b.z1).toBeLessThanOrEqual(90);
  });
});

describe("C4: orientation", () => {
  const heavyTopOf = (r: OutlineSuccess) => widthNear(r.points, r.heightMm - 10, r.heightMm - 1) > widthNear(r.points, 1, 10);

  it("turns a lollipop lying on its side so the stick points down, whichever side the head is on", () => {
    const right = rasterize(400, 400, union(disc(300, 200, 80), rect(20, 185, 230, 215)));
    const left = rasterize(400, 400, union(disc(100, 200, 80), rect(170, 185, 380, 215)));
    for (const m of [right, left]) {
      const r = ok(m);
      expect(r.orientation.reason).toBe("narrow-end-down");
      expect(axisFromVerticalDeg(r.points)).toBeLessThan(2);
      expect(heavyTopOf(r)).toBe(true); // the head is up
    }
  });

  it("flip turns it end for end", () => {
    const m = rasterize(400, 400, union(disc(300, 200, 80), rect(20, 185, 230, 215)));
    const a = ok(m);
    const b = ok(m, { flip: true });
    expect(heavyTopOf(a)).toBe(true);
    expect(heavyTopOf(b)).toBe(false);
    expect(b.orientation.flipped).toBe(true);
  });

  it("straightens a lollipop photographed 20 degrees off upright and keeps the photo's up (head stays on top)", () => {
    const m = rasterize(400, 400, rotated(lollipopUp(), 200, 200, 20));
    const r = ok(m);
    expect(r.orientation.reason).toBe("near-upright");
    expect(Math.abs(r.orientation.rotationDeg - 20)).toBeLessThan(2);
    expect(axisFromVerticalDeg(r.points)).toBeLessThan(2);
    expect(heavyTopOf(r)).toBe(true);
  });

  it("keeps an upside-down lollipop upside down until the kid flips it (the photo's up wins when near upright)", () => {
    const m = rasterize(400, 400, rotated(lollipopUp(), 200, 200, 180));
    const a = ok(m);
    expect(a.orientation.reason).toBe("near-upright");
    expect(heavyTopOf(a)).toBe(false);
    expect(heavyTopOf(ok(m, { flip: true }))).toBe(true);
  });

  it("does not rotate a round object, and leaves everything alone when asked to keep the photo's orientation", () => {
    const d = ok(SHAPES.disc());
    expect(d.orientation).toMatchObject({ reason: "too-round", rotationDeg: 0 });
    expect(codes(d)).toContain("kept_orientation");
    const m = rasterize(400, 400, rotated(lollipopUp(), 200, 200, 90));
    expect(ok(m, { orient: "as-photographed" }).orientation).toMatchObject({ reason: "as-photographed", rotationDeg: 0 });
  });

  it("stands a bar with equal ends upright (a tie, so no end is preferred)", () => {
    const m = rasterize(400, 400, rect(20, 180, 380, 220));
    const r = ok(m);
    expect(r.orientation.reason).toBe("tie");
    expect(axisFromVerticalDeg(r.points)).toBeLessThan(2);
    expect(r.heightMm).toBeGreaterThan(52);
  });
});

describe("polygon-space flip and scale (the photo is gone by then)", () => {
  it("flip twice gives back the outline; one flip swaps the ends and keeps area, winding and the box", () => {
    const r = ok(SHAPES.paddle());
    const f = flipOutline(r.points);
    expect(flipOutline(f)).toEqual(r.points);
    expect(Math.abs(signedArea(f) - signedArea(r.points))).toBeLessThan(0.5);
    expect(signedArea(f)).toBeGreaterThan(0);
    expect(isSimplePolygon(f)).toBe(true);
    const b = bbox(f);
    expect(b.z0).toBeCloseTo(0, 1);
    expect(Math.abs(b.x0 + b.x1)).toBeLessThan(0.03);
    expect(widthNear(r.points, 1, 10)).toBeLessThan(widthNear(r.points, r.heightMm - 10, r.heightMm - 1)); // canary: paddle is narrow at the bottom
    expect(widthNear(f, 1, 10)).toBeGreaterThan(widthNear(f, r.heightMm - 10, r.heightMm - 1));
  });

  it("flipOutline of a result is the same outline legalizeOutline gives with flip:true, up to a point or two", () => {
    const m = rasterize(400, 400, union(disc(300, 200, 80), rect(20, 185, 230, 215)));
    expect(polygonIoU(flipOutline(ok(m).points), ok(m, { flip: true }).points)).toBeGreaterThan(0.97);
  });

  it("scales about the bottom centre and never leaves the box", () => {
    const r = ok(SHAPES.paddle());
    const half = scaleOutline(r.points, 0.5);
    expect(half.factor).toBe(0.5);
    expect(bbox(half.points).z1).toBeCloseTo(r.heightMm / 2, 1);
    expect(bbox(half.points).z0).toBeCloseTo(0, 1);
    const huge = scaleOutline(r.points, 10);
    expect(huge.factor).toBeLessThan(10);
    expect(bbox(huge.points).z1).toBeLessThanOrEqual(HAND_BOX.maxHeightMm + 0.01);
    expect(bbox(huge.points).x1).toBeLessThanOrEqual(HAND_BOX.halfWidthMm + 0.01);
    expect(scaleOutline(r.points, Number.NaN).factor).toBe(1);
    expect(scaleOutline(r.points, -2).factor).toBe(1);
  });
});

describe("property: whatever SAM hands back, the outline is usable", () => {
  const blobs = Array.from({ length: 40 }, (_, i) => ({ name: `blob ${i + 1}`, mask: randomBlob(i + 1) }));
  const jagged = Array.from({ length: 10 }, (_, i) => ({ name: `jagged ${i + 1}`, mask: jaggedDisc(i + 1) }));

  it("40 random blobs and 10 rough-edged discs all give a simple, in-budget, in-box, faithful outline", { timeout: 120_000 }, () => {
    let mostPoints = 0;
    for (const { name, mask } of [...blobs, ...jagged]) {
      expect(countOn(mask), `${name} is not empty`).toBeGreaterThan(1000);
      const r = legalizeOutline(mask);
      expect(r.ok, `${name}: ${r.ok ? "" : `${r.reason} ${r.detail}`}`).toBe(true);
      if (!r.ok) continue;
      mostPoints = Math.max(mostPoints, r.points.length);
      expect(r.points.length, name).toBeGreaterThanOrEqual(3);
      expect(r.points.length, name).toBeLessThanOrEqual(64);
      expect(isSimplePolygon(r.points), `${name} is simple`).toBe(true);
      expect(signedArea(r.points), `${name} winding`).toBeGreaterThan(0);
      const b = bbox(r.points);
      expect(b.x1, name).toBeLessThanOrEqual(45);
      expect(b.x0, name).toBeGreaterThanOrEqual(-45);
      expect(b.z0, name).toBeGreaterThanOrEqual(0);
      expect(b.z1, name).toBeLessThanOrEqual(90);
      expect(r.fidelity, `${name} fidelity`).toBeGreaterThanOrEqual(0.9);
      expect(r.warnings, name).not.toContain("POINT_BUDGET_NOT_MET");
    }
    expect(mostPoints, "canary: the outlines are real shapes, not four-point boxes").toBeGreaterThan(20);
  });
});

/** Overlap of the outline, carried back through a photo map into mask pixels, with the mask it came from. Independent of the module: it only uses the map. */
function maskIoU(o: OutlineSuccess, mask: Raster, map: Affine = o.photoToPlate): number {
  const inv = invertAffine(map);
  if (!inv) throw new Error("photoToPlate cannot be inverted");
  const back = o.points.map(([x, z]) => applyAffine(inv, x, z));
  const inside = polygon(back as [number, number][]);
  let inter = 0;
  let uni = 0;
  for (let y = 0; y < mask.height; y += 2)
    for (let x = 0; x < mask.width; x += 2) {
      const m = mask.data[y * mask.width + x] === 1;
      const p = inside(x, y); // pixel index space: the centre of pixel (x, y) is (x, y); every second pixel is plenty for an overlap
      if (m && p) inter++;
      if (m || p) uni++;
    }
  return uni ? inter / uni : 0;
}

const tiltedLollipop = (deg: number) => rasterize(400, 400, rotated(union(disc(200, 100, 80), rect(185, 170, 215, 380)), 200, 200, deg));
const MAPPED: [string, () => Raster, OutlineOptions?][] = [
  ["disc", SHAPES.disc],
  ["paddle", SHAPES.paddle],
  ["blade", SHAPES.blade],
  ["star", SHAPES.star],
  ["lollipop tilted 20 degrees", () => tiltedLollipop(20)],
  ["lollipop upside down", () => tiltedLollipop(180)],
  ["lollipop on its side", () => tiltedLollipop(90)],
  ["paddle asked for 33 mm with keepThinParts (grown to keep its stick)", SHAPES.paddle, { targetHeightMm: 33, keepThinParts: true }],
  ["disc at 30 mm", SHAPES.disc, { targetHeightMm: 30 }],
];

describe("photoToPlate: where the photo sits on the plate (the sticker is drawn from the local photo with it)", () => {
  for (const [name, make, opts] of MAPPED) {
    it(`${name}: the polygon, carried back to the mask, overlaps it`, () => {
      const mask = make();
      const o = ok(mask, opts);
      expect(maskIoU(o, mask)).toBeGreaterThan(0.95);
    });
  }

  it("a wrong map is caught by the same check (the check can fail)", () => {
    const mask = SHAPES.paddle();
    const o = ok(mask);
    expect(maskIoU(o, mask, [1, 0, 0, 1, 0, 0])).toBeLessThan(0.05);
    expect(maskIoU(o, mask, [o.photoToPlate[0], o.photoToPlate[1], o.photoToPlate[2], o.photoToPlate[3], o.photoToPlate[4] + 10, o.photoToPlate[5]])).toBeLessThan(0.8);
  });

  it("its scale is the printed size: area in mm2 over area in pixels is the determinant", () => {
    const mask = SHAPES.paddle();
    const o = ok(mask);
    const [a, b, c, d] = o.photoToPlate;
    const det = Math.abs(a * d - b * c);
    const areaMm2 = Math.abs(signedArea(o.points));
    const px = countOn(mask);
    expect(Math.abs(areaMm2 / px - det) / det).toBeLessThan(0.08);
  });

  it("is a rotation and a uniform scale plus a shift (no shear, no mirror of the photo itself)", () => {
    const [a, b, c, d] = ok(SHAPES.paddle()).photoToPlate;
    expect(Math.hypot(a, b)).toBeCloseTo(Math.hypot(c, d), 9);
    expect(a * c + b * d).toBeCloseTo(0, 9);
    // x right and y down in the photo to x right and z up on the plate is a reflection: the determinant is negative.
    expect(a * d - b * c).toBeLessThan(0);
  });

  it("withFlipped: the polygon and the map turn together, so the overlap holds; twice is the original", { timeout: 120_000 }, () => {
    for (const [name, make, opts] of MAPPED) {
      const mask = make();
      const o = ok(mask, opts);
      const f = withFlipped(o);
      expect(f.points, name).toEqual(flipOutline(o.points));
      expect(f.orientation.flipped).toBe(!o.orientation.flipped);
      expect(f.changes.at(-1)?.code).toBe("flipped");
      expect(maskIoU(f, mask), `${name} flipped`).toBeGreaterThan(0.95);
      const back = withFlipped(f);
      expect(back.points).toEqual(o.points);
      back.photoToPlate.forEach((v, i) => expect(v).toBeCloseTo(o.photoToPlate[i]!, 9));
    }
  });

  it("withScaled: the polygon and the map scale together, and the box limit is honoured", () => {
    const mask = SHAPES.paddle();
    const o = ok(mask, { targetHeightMm: 40 });
    const { outline: big, factor } = withScaled(o, 1.3);
    expect(factor).toBeCloseTo(1.3, 9);
    expect(big.heightMm).toBeCloseTo(o.heightMm * 1.3, 1);
    expect(maskIoU(big, mask)).toBeGreaterThan(0.95);
    const capped = withScaled(ok(mask, { targetHeightMm: 80 }), 2);
    expect(capped.factor).toBeLessThan(2);
    expect(capped.outline.heightMm).toBeLessThanOrEqual(HAND_BOX.maxHeightMm + 1e-9);
    expect(maskIoU(capped.outline, mask)).toBeGreaterThan(0.95);
    const unchanged = withScaled(o, Number.NaN);
    expect(unchanged.factor).toBe(1);
  });

  it("composeAffine applies the inner map first, and invertAffine undoes a map", () => {
    const rot: Affine = [0, 1, -1, 0, 0, 0]; // 90 degrees
    const shift: Affine = [1, 0, 0, 1, 5, 7];
    expect(applyAffine(composeAffine(shift, rot), 1, 0)).toEqual([5, 8]); // rotate first: (1,0) -> (0,1), then shift
    expect(applyAffine(composeAffine(rot, shift), 1, 0)).toEqual([-7, 6]); // shift first: (6,7), then rotate
    const t: Affine = [2, 1, -1, 3, 4, -5];
    const inv = invertAffine(t)!;
    const [x, y] = applyAffine(inv, ...applyAffine(t, 3.5, -2));
    expect(x).toBeCloseTo(3.5, 9);
    expect(y).toBeCloseTo(-2, 9);
    expect(invertAffine([1, 2, 2, 4, 0, 0])).toBeUndefined();
  });
});

describe("recipe shape and wiring", () => {
  it("fits Recipe v1's profile2d, with the grip length and fillet the compiler reads", () => {
    const r = ok(SHAPES.paddle());
    const shape = outlineToRecipeShape(r);
    const recipe: ForgeRecipeV1 = { name: "Paddle", slot: "hand", shape };
    expect(recipe.shape.kind).toBe("profile2d");
    expect(shape.points).toEqual(r.points);
    expect(shape.fillet_r_mm).toBeGreaterThanOrEqual(0.4);
    expect(shape.fillet_r_mm).toBeLessThanOrEqual(4);
    expect(shape.grip_tu).toBe(2);
    expect(outlineToRecipeShape(r, 3).grip_tu).toBe(3);
  });

  it("defaults to the first rung of the fillet ladder, every rung is a legal fillet, and the rungs give different outlines", () => {
    expect(DEFAULT_FILLET_MM).toBe(FILLET_LADDER[0]);
    for (const f of FILLET_LADDER) {
      expect(f).toBeGreaterThanOrEqual(0.4);
      expect(f).toBeLessThanOrEqual(4);
    }
    expect(ok(SHAPES.star()).fillet_r_mm).toBe(FILLET_LADDER[0]);
    // A retry that returned the same polygon would be no retry: the star's tips are blunted more at each rung.
    const rungs = FILLET_LADDER.map((f) => ok(SHAPES.star(), { fillet_r_mm: f }).points);
    expect(new Set(rungs.map((p) => JSON.stringify(p))).size).toBe(FILLET_LADDER.length);
  });

  it("retry ladder: starts at the default, ends, never repeats an attempt, and keeps shape-preserving nudges ahead of shape-changing fillets", () => {
    const base = {};
    const first = retryOptions(base, 0)!;
    expect(first.fillet_r_mm).toBe(DEFAULT_FILLET_MM);
    expect(first.targetHeightMm).toBe(DEFAULT_TARGET_MM);
    expect(retryOptions(base, RETRY_LADDER.length)).toBeUndefined();
    expect(retryOptions(base, -1)).toBeUndefined();
    const seen = new Set<string>();
    let sawFilletChange = false;
    for (let i = 0; i < RETRY_LADDER.length; i++) {
      const o = retryOptions(base, i)!;
      const key = `${o.fillet_r_mm}@${o.targetHeightMm}`;
      expect(seen.has(key), `attempt ${i} repeats ${key}`).toBe(false);
      seen.add(key);
      if (o.fillet_r_mm !== DEFAULT_FILLET_MM) sawFilletChange = true;
      else expect(sawFilletChange, "a same-shape nudge must not come after a fillet change").toBe(false);
    }
    expect(retryOptions({ targetHeightMm: 60, flip: true }, 2)).toMatchObject({ targetHeightMm: 60 * 1.04, flip: true });
  });

  it("mirrors the clamp box the daemon uses (a change there must change here)", () => {
    const daemon = readFileSync(join(__dirname, "..", "scripts", "forge_optimizer_daemon.py"), "utf8");
    expect(daemon).toContain("min(45.0, _finite_float(p[0]");
    expect(daemon).toContain("min(90.0, _finite_float(p[1]");
    expect(daemon).toContain("3 <= len(pts_raw) <= 64");
    expect(HAND_BOX).toEqual({ halfWidthMm: 45, maxHeightMm: 90 });
  });

  it("stays pure: no DOM, no network, no clock, no randomness, no imports beyond a type", () => {
    const src = readFileSync(join(__dirname, "..", "shared", "photoOutline.ts"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\b(document|window|fetch|localStorage|sessionStorage|XMLHttpRequest|Date\.now|Math\.random|performance\.now)\b/);
    const imports = code.match(/^[ \t]*import\s.*$/gm)?.map((l) => l.trim()) ?? [];
    expect(imports).toEqual(['import type { ForgeRecipeV1 } from "./forgeOptimizer";']);
  });
});
