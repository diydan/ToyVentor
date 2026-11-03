import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FORGE_MAX_PROFILE_POINTS, type ForgeRecipeV1 } from "../shared/forgeOptimizer";
import {
  type Affine,
  applyAffine,
  composeAffine,
  DEFAULT_FILLET_MM,
  DEFAULT_TARGET_MM,
  FILLET_LADDER,
  flipOutline,
  gaussBlur,
  HAND_BOX,
  invertAffine,
  isoLoops,
  legalizeOutline,
  MAX_RECIPE_POINTS,
  type OutlineOptions,
  type OutlineSuccess,
  outlineToRecipeShape,
  RETRY_LADDER,
  retryOptions,
  roundingRemovesParts,
  scaleOutline,
  smoothContour,
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
  stairCorners,
  totalTurning,
  turns,
  zigzags,
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
import { realCup, realSpoon } from "./fixtures/realCupMask";

// The legalizer takes 0.1 to 0.9 s a call, some tests make a dozen, and the machine is often at load 30 or more (one test failed once at 5.4 s, just past
// the 5 s default, and passed on every rerun).
vi.setConfig({ testTimeout: 60_000 });

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
    it(`${name}: 3 to 256 finite two-decimal points, counter-clockwise, simple, inside the box, bottom at 0, centred, about 54 mm tall`, () => {
      const r = ok(SHAPES[name]());
      expect(r.points.length).toBeGreaterThanOrEqual(3);
      expect(r.points.length).toBeLessThanOrEqual(MAX_RECIPE_POINTS);
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
      expect(r.points.length, name).toBeLessThanOrEqual(240); // the default budget, inside the compiler's 256
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
    expect(daemon).toContain("3 <= len(pts_raw) <= 256"); // the daemon's point limit...
    const worker = readFileSync(join(__dirname, "..", "worker", "forgeOptimizer.ts"), "utf8");
    expect(worker).toContain("shapeObj.points.length > FORGE_MAX_PROFILE_POINTS"); // ...the Worker's allowlist uses the shared constant...
    expect(FORGE_MAX_PROFILE_POINTS).toBe(256);
    expect(MAX_RECIPE_POINTS).toBe(FORGE_MAX_PROFILE_POINTS); // ...and this module's limit is the same number
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

// ---- would the builder's rounding take a part off this polygon? ------------------------------------------------------------

/** A counter-clockwise lollipop in plate mm: a stick `stickWidth` wide and `stickLength` long, bottom at z = 0, and a round head on top. */
function lollipop(stickWidth: number, stickLength = 50, headR = 9): [number, number][] {
  const half = stickWidth / 2;
  const headZ = stickLength + headR;
  const join = headZ - Math.sqrt(headR * headR - half * half);
  const a0 = Math.atan2(join - headZ, half);
  const pts: [number, number][] = [[-half, 0], [half, 0], [half, join]];
  const steps = 40;
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((Math.PI - 2 * a0) * i) / steps;
    pts.push([headR * Math.cos(a), headZ + headR * Math.sin(a)]);
  }
  pts.push([-half, join]);
  return pts;
}

describe("roundingRemovesParts: would a recipe fillet take a real part off a finished polygon?", () => {
  it("finds a thin stick the rounding would take, and not before the rounding is wide enough", () => {
    const stick = lollipop(2.4); // 2.4 mm wide: survives a 1.0 fillet (nothing under 2.0 mm), not 1.6 (nothing under 3.2 mm)
    expect(roundingRemovesParts(stick, 0.8).count).toBe(0);
    expect(roundingRemovesParts(stick, 1.0).count).toBe(0);
    const at16 = roundingRemovesParts(stick, 1.6);
    expect(at16.count).toBe(1);
    expect(at16.areaMm2).toBeGreaterThan(80); // about the stick: 2.4 mm by 50 mm is 120 mm2
    expect(at16.areaMm2).toBeLessThan(135);
    expect(roundingRemovesParts(stick, 3).count).toBe(1);
  });

  it("puts the edge where the rule says: a 4.4 mm stick survives 2.0 (nothing under 4.0 mm) and not 3.0 (nothing under 6.0 mm)", () => {
    const stick = lollipop(4.4);
    expect(roundingRemovesParts(stick, 1.6).count).toBe(0);
    expect(roundingRemovesParts(stick, 2.0).count).toBe(0);
    expect(roundingRemovesParts(stick, 3.0).count).toBe(1);
  });

  it("rounds by at least the builder's own 0.8 mm, whatever the recipe fillet: a 1.4 mm stick goes at fillet 0.4, a 1.9 mm stick does not go at 0.8", () => {
    expect(roundingRemovesParts(lollipop(1.4), 0.4).count).toBe(1);
    expect(roundingRemovesParts(lollipop(1.4), 0.8).count).toBe(1);
    expect(roundingRemovesParts(lollipop(1.9), 0.4).count).toBe(0);
    expect(roundingRemovesParts(lollipop(1.9), 0.8).count).toBe(0);
  });

  it("never takes less as the fillet grows", () => {
    const stick = lollipop(3.0);
    let last = 0;
    for (const f of [0.4, 0.8, 1.0, 1.2, 1.6, 2.0, 3.0, 4.0]) {
      const a = roundingRemovesParts(stick, f).areaMm2;
      expect(a, `fillet ${f}`).toBeGreaterThanOrEqual(last - 0.5);
      last = a;
    }
    expect(last).toBeGreaterThan(50); // guard: the loop reached a fillet that removes something
  });

  it("does not count rounded corners or the tips of a star as parts, as the legalizer does not", () => {
    const circle = Array.from({ length: 60 }, (_, i): [number, number] => [20 * Math.cos((i / 60) * 2 * Math.PI), 20 + 20 * Math.sin((i / 60) * 2 * Math.PI)]);
    const square: [number, number][] = [[-15, 0], [15, 0], [15, 30], [-15, 30]];
    const starPts = Array.from({ length: 10 }, (_, i): [number, number] => {
      const r = i % 2 === 0 ? 28 : 12;
      const a = Math.PI / 2 + (i / 10) * 2 * Math.PI;
      return [r * Math.cos(a), 28 + r * Math.sin(a)];
    });
    for (const [name, poly] of [["circle", circle], ["square", square], ["star", starPts]] as const) {
      expect(roundingRemovesParts(poly, 3.0).count, name).toBe(0);
    }
  });

  it("gives the same answer for either winding, and wherever the polygon sits", () => {
    const stick = lollipop(2.4);
    const base = roundingRemovesParts(stick, 1.6);
    const reversed = roundingRemovesParts([...stick].reverse(), 1.6);
    const moved = roundingRemovesParts(stick.map(([x, z]): [number, number] => [x + 12.5, z - 31]), 1.6);
    for (const other of [reversed, moved]) {
      expect(other.count).toBe(base.count);
      expect(Math.abs(other.areaMm2 - base.areaMm2)).toBeLessThan(4);
    }
  });

  it("fills a polygon whose rows cross it four times: two thin prongs on a bar are two parts, in either winding", () => {
    // A bar 16 mm wide and 8 mm tall with two prongs 2.4 mm wide and 32 mm long, 11.2 mm apart. Counter-clockwise.
    const fork: [number, number][] = [[-8, 0], [8, 0], [8, 40], [5.6, 40], [5.6, 8], [-5.6, 8], [-5.6, 40], [-8, 40]];
    for (const [name, poly] of [["counter-clockwise", fork], ["clockwise", [...fork].reverse()]] as const) {
      expect(roundingRemovesParts(poly, 1.6).count, name).toBe(2); // each prong is under 3.2 mm: both go, as two pieces
      expect(roundingRemovesParts(poly, 1.0).count, name).toBe(0); // and neither is under 2.0 mm
    }
    const area = roundingRemovesParts(fork, 1.6).areaMm2;
    expect(area).toBeGreaterThan(110); // two prongs of 2.4 x 32 mm is 154 mm2, less where they meet the bar
    expect(area).toBeLessThan(160);
  });

  it("says nothing for a polygon that is not one", () => {
    expect(roundingRemovesParts([], 1.6)).toEqual({ count: 0, areaMm2: 0 });
    expect(roundingRemovesParts([[0, 0], [5, 5]], 1.6)).toEqual({ count: 0, areaMm2: 0 });
    expect(roundingRemovesParts([[0, 0], [5, 0], [10, 0]], 1.6)).toEqual({ count: 0, areaMm2: 0 }); // no height
    expect(roundingRemovesParts([[3, 0], [3, 5], [3, 9]], 1.6)).toEqual({ count: 0, areaMm2: 0 }); // no width
    expect(roundingRemovesParts([[1, 1], [1, 1], [1, 1]], 1.6)).toEqual({ count: 0, areaMm2: 0 }); // no size at all: nothing to divide by
  });

  it("agrees with the legalizer: an outline it made with the stick kept is not harmed by its own fillet, and is by a bigger one", () => {
    const mask = rasterize(400, 400, union(disc(200, 90, 80), rect(195, 160, 205, 390)));
    const kept = legalizeOutline(mask, { targetHeightMm: 90, fillet_r_mm: 1.0, keepThinParts: true });
    if (!kept.ok) throw new Error("legalize failed");
    expect(kept.warnings).not.toContain("THIN_PARTS_REMOVED");
    expect(roundingRemovesParts(kept.points, kept.fillet_r_mm).count).toBe(0);
    expect(roundingRemovesParts(kept.points, 1.6).count).toBe(1);
    const lost = legalizeOutline(mask, { targetHeightMm: 90, fillet_r_mm: 1.6, keepThinParts: true });
    if (!lost.ok) throw new Error("legalize failed");
    expect(lost.warnings).toContain("THIN_PARTS_REMOVED"); // the same mask loses the stick at the default
    expect(roundingRemovesParts(lost.points, 3.0).count).toBe(0); // and what is left has nothing more to lose
  });
});

// ---- smoothing the traced outline ------------------------------------------------------------------------------------------

describe("legalizeOutline: the outline is smoothed before it is simplified", () => {
  const made = (mask: Raster, options: OutlineOptions = {}): OutlineSuccess => {
    const o = legalizeOutline(mask, { targetHeightMm: 54, ...options });
    if (!o.ok) throw new Error(`legalize failed: ${o.reason}`);
    return o;
  };

  it("the real spoon and the real cup have no staircase: the pixel-corner trace left notches, the smoothed one has none", async () => {
    const spoon = (await realSpoon()).raster;
    const cup = (await realCup()).raster;
    for (const [name, mask, opts] of [["spoon", spoon, { fillet_r_mm: 1.0, keepThinParts: true }], ["cup", cup, { keepThinParts: true }]] as const) {
      const old = made(mask, { ...opts, smoothMm: 0 });
      const now = made(mask, opts);
      expect(stairCorners(old.points), `${name} before`).toBeGreaterThanOrEqual(4); // guard: the notches are really there without smoothing
      expect(stairCorners(now.points), `${name} after`).toBe(0);
      expect(zigzags(now.points), `${name} zig-zag`).toBeLessThan(zigzags(old.points) / 2);
      expect(totalTurning(now.points), `${name} turning`).toBeLessThan(totalTurning(old.points) * 0.6);
    }
  });

  it("a disc is nearly as smooth as a circle: about 360 degrees of turning in all and no zig-zag, where the pixel-corner trace had twice that", () => {
    const disc_ = SHAPES.disc();
    const old = made(disc_, { smoothMm: 0 });
    const now = made(disc_, { sagMm: 0.03 }); // the tolerance at which a polygon is as near a circle as it gets (386 measured)
    expect(totalTurning(old.points)).toBeGreaterThan(600); // guard
    expect(totalTurning(now.points)).toBeGreaterThan(355);
    expect(totalTurning(now.points)).toBeLessThan(400);
    expect(zigzags(now.points)).toBe(0);
  });

  it("at the default tolerance a disc has no zig-zag and no corner over 12 degrees, with more points and a little more turning than a plain circle", () => {
    const now = made(SHAPES.disc());
    expect(zigzags(now.points)).toBe(0);
    expect(Math.max(...turns(now.points).map(Math.abs))).toBeLessThan(12); // 8 measured
    expect(now.points.length).toBeGreaterThan(110);
    expect(totalTurning(now.points)).toBeLessThan(560); // 487 measured: a gentle ripple, never a reversal
  });

  it("has less zig-zag per vertex and no more stair corners on random blobs and rough discs, which are rough on purpose", () => {
    // Counts are not compared, only rates: the pixel trace was held to 60 points and so skipped detail that the smoothed outline, with up to
    // 240, follows, and a rough edge followed closely has more reversals in absolute terms (rough disc 2: 36 in 60 points, then 47 in 240).
    for (const [name, mask] of [["blob 1", randomBlob(1)], ["blob 2", randomBlob(2)], ["blob 3", randomBlob(3)], ["rough disc 1", jaggedDisc(1)], ["rough disc 2", jaggedDisc(2)]] as const) {
      const old = made(mask, { smoothMm: 0 });
      const now = made(mask);
      expect(zigzags(now.points) / now.points.length, name).toBeLessThanOrEqual(zigzags(old.points) / old.points.length);
      expect(stairCorners(now.points), name).toBeLessThanOrEqual(stairCorners(old.points));
    }
  });

  it("costs the outline no accuracy: the overlap with the mask is within 0.01 of the unsmoothed one, and the size within 0.5 mm", async () => {
    const spoon = (await realSpoon()).raster;
    const cases: [string, Raster, OutlineOptions][] = [
      ["spoon", spoon, { fillet_r_mm: 1.0, keepThinParts: true }],
      ["disc", SHAPES.disc(), {}],
      ["star", SHAPES.star(), {}],
      ["paddle", SHAPES.paddle(), {}],
      ["blob 1", randomBlob(1), {}],
      ["blob 2", randomBlob(2), {}],
    ];
    for (const [name, mask, opts] of cases) {
      const old = made(mask, { ...opts, smoothMm: 0 });
      const now = made(mask, opts);
      expect(maskIoU(now, mask), name).toBeGreaterThan(maskIoU(old, mask) - 0.01);
      expect(maskIoU(now, mask), name).toBeGreaterThan(0.93);
      expect(Math.abs(now.heightMm - old.heightMm), `${name} height`).toBeLessThan(0.5);
      expect(Math.abs(now.widthMm - old.widthMm), `${name} width`).toBeLessThan(0.5);
    }
  });

  it("keeps the thin handle: the spoon at 1.0 still has no parts removed, and its neck is no narrower", async () => {
    const spoon = (await realSpoon()).raster;
    const old = made(spoon, { fillet_r_mm: 1.0, keepThinParts: true, smoothMm: 0 });
    const now = made(spoon, { fillet_r_mm: 1.0, keepThinParts: true });
    expect(now.warnings).not.toContain("THIN_PARTS_REMOVED");
    expect(Math.abs(now.heightMm - old.heightMm)).toBeLessThan(0.5);
    // The narrowest width of the polygon over its middle half: the blur must not thin the neck.
    const narrowest = (o: OutlineSuccess) => {
      let best = Infinity;
      for (let z = o.heightMm * 0.3; z < o.heightMm * 0.9; z += 0.5) {
        const xs: number[] = [];
        for (let i = 0; i < o.points.length; i++) {
          const a = o.points[i]!;
          const b = o.points[(i + 1) % o.points.length]!;
          if (a[1] > z !== b[1] > z) xs.push(a[0] + ((z - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
        }
        xs.sort((p, q) => p - q);
        if (xs.length >= 2) best = Math.min(best, xs[xs.length - 1]! - xs[0]!);
      }
      return best;
    };
    expect(narrowest(now)).toBeGreaterThan(narrowest(old) - 0.15);
  });

  it("spends its point budget on the curves: more points than the 60 the pixel trace was held to, and a gentler worst corner", async () => {
    const spoon = (await realSpoon()).raster;
    const old = made(spoon, { fillet_r_mm: 1.0, keepThinParts: true, smoothMm: 0 });
    const now = made(spoon, { fillet_r_mm: 1.0, keepThinParts: true });
    expect(old.points.length).toBeLessThanOrEqual(60); // the unsmoothed trace keeps its old budget
    expect(now.points.length).toBeGreaterThan(old.points.length);
    expect(now.points.length).toBeLessThanOrEqual(240);
    const worst = (p: readonly (readonly [number, number])[]) => Math.max(...turns(p).map(Math.abs));
    expect(worst(now.points)).toBeLessThan(worst(old.points) * 0.7);
  });

  it("takes the option as written: 0 is the old trace, a negative number is 0, NaN is the default, a huge number is the 0.8 mm cap", () => {
    const mask = randomBlob(2);
    const off = made(mask, { smoothMm: 0 });
    expect(made(mask, { smoothMm: -3 }).points).toEqual(off.points);
    expect(made(mask, { smoothMm: Number.NaN }).points).toEqual(made(mask).points);
    expect(made(mask, { smoothMm: Number.POSITIVE_INFINITY }).points).toEqual(made(mask).points);
    expect(made(mask, { smoothMm: 1000 }).points).toEqual(made(mask, { smoothMm: 0.8 }).points);
    expect(made(mask, { smoothMm: 0.8 }).points).not.toEqual(off.points); // guard: smoothing does change the outline
    expect(made(mask, { smoothMm: 0.4 }).points).not.toEqual(made(mask, { smoothMm: 0.8 }).points); // and its strength is used
  });

  it("chooses its own strength from the mask's pixel size: 2 source pixels, no less than 0.3 mm and no more than 0.8 mm", () => {
    // An object 380 px tall drawn at 54 mm has 0.142 mm pixels: 2 of them is 0.28 mm, so the 0.3 mm floor applies.
    const fine = rasterize(400, 400, disc(200, 200, 190));
    expect(made(fine).points).toEqual(made(fine, { smoothMm: 0.3 }).points);
    expect(made(fine).points).not.toEqual(made(fine, { smoothMm: 0.8 }).points);
    // An object 76 px tall drawn at 54 mm has 0.71 mm pixels: 2 of them is 1.4 mm, so the 0.8 mm cap applies.
    const coarse = rasterize(100, 100, disc(50, 50, 38));
    expect(made(coarse).points).toEqual(made(coarse, { smoothMm: 0.8 }).points);
    expect(made(coarse).points).not.toEqual(made(coarse, { smoothMm: 0.3 }).points);
  });

  it("has no negative zero, so an outline survives JSON unchanged (a rounded -0.00 would not)", () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      for (const h of [54, 90]) {
        const o = made(randomBlob(seed), { targetHeightMm: h });
        for (const [x, z] of o.points) {
          expect(Object.is(x, -0), `blob ${seed}@${h} x`).toBe(false);
          expect(Object.is(z, -0), `blob ${seed}@${h} z`).toBe(false);
        }
        expect(JSON.parse(JSON.stringify(o.points)), `blob ${seed}@${h}`).toEqual(o.points);
      }
    }
  });

  it("stays a simple polygon on every shape, smoothed", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const o = made(randomBlob(seed));
      expect(isSimplePolygon(o.points), `blob ${seed}`).toBe(true);
    }
    for (const [name, make] of Object.entries(SHAPES)) {
      const r = legalizeOutline(make(), { targetHeightMm: 54 });
      if (r.ok) expect(isSimplePolygon(r.points), name).toBe(true);
    }
  });
});

describe("a bigger point budget, and a filter that lets it pay off", () => {
  const made = (mask: Raster, options: OutlineOptions = {}): OutlineSuccess => {
    const o = legalizeOutline(mask, { targetHeightMm: 54, ...options });
    if (!o.ok) throw new Error(`legalize failed: ${o.reason}`);
    return o;
  };
  const narrowest = (o: OutlineSuccess) => {
    let best = Infinity;
    for (let z = o.heightMm * 0.3; z < o.heightMm * 0.9; z += 0.5) {
      const xs: number[] = [];
      for (let i = 0; i < o.points.length; i++) {
        const a = o.points[i]!;
        const b = o.points[(i + 1) % o.points.length]!;
        if (a[1] > z !== b[1] > z) xs.push(a[0] + ((z - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
      xs.sort((p, q) => p - q);
      if (xs.length >= 2) best = Math.min(best, xs[xs.length - 1]! - xs[0]!);
    }
    return best;
  };

  it("a disc gets well over 64 points and every one is on the circle: against the exact circle the error is 4 times smaller than the pixel trace's", () => {
    // The disc is analytic: canvas centre (200, 200) is pixel index (199.5, 199.5), radius 150 px. Through the outline's own photo map that is a known
    // centre and radius in millimetres, so the vertices can be measured against the true circle and not against a fit made from themselves.
    const circleError = (o: OutlineSuccess) => {
      const [cx, cz] = applyAffine(o.photoToPlate, 199.5, 199.5);
      const R = 150 * Math.hypot(o.photoToPlate[0], o.photoToPlate[1]);
      const e = o.points.map(([x, z]) => Math.hypot(x - cx, z - cz) - R);
      return { R, max: Math.max(...e.map(Math.abs)), rms: Math.sqrt(e.reduce((a, v) => a + v * v, 0) / e.length) };
    };
    const disc_ = SHAPES.disc();
    const now = made(disc_);
    const old = made(disc_, { smoothMm: 0 });
    expect(now.points.length).toBeGreaterThan(64);
    expect(now.points.length).toBeLessThanOrEqual(240);
    expect(circleError(now).R).toBeGreaterThan(26); // guard: the 54 mm disc is 27 mm in radius
    expect(circleError(now).max).toBeLessThan(0.1); // 0.069 measured
    expect(circleError(now).rms).toBeLessThan(0.04); // 0.026 measured, 0.109 for the pixel trace
    expect(circleError(now).rms).toBeLessThan(circleError(old).rms / 3);
    expect(circleError(now).rms).toBeLessThan(circleError(made(disc_, { curveMm: 0 })).rms); // the edge filter earns its place
  });

  it("the point budget is kept: 64 gives at most 64 points and still fits the mask, and a budget past 256 is cut to 256", () => {
    const disc_ = SHAPES.disc();
    const small = made(disc_, { maxPoints: 64 });
    expect(small.points.length).toBeLessThanOrEqual(64);
    expect(maskIoU(small, disc_)).toBeGreaterThan(0.97);
    const rough = made(jaggedDisc(1), { maxPoints: 1000 });
    expect(rough.points.length).toBeLessThanOrEqual(MAX_RECIPE_POINTS);
    expect(rough.points.length).toBeGreaterThan(150); // guard: a rough edge used the budget
  });

  it("a smaller sag tolerance gives more points and a larger one fewer, monotonically, on a smooth shape", () => {
    const disc_ = SHAPES.disc();
    const counts = [0.2, 0.08, 0.05, 0.03].map((sagMm) => made(disc_, { sagMm }).points.length);
    for (let i = 1; i < counts.length; i++) expect(counts[i]!, `sag step ${i}`).toBeGreaterThanOrEqual(counts[i - 1]!);
    expect(counts[3]!).toBeGreaterThan(counts[0]! * 1.4);
  });

  it("the filter along the edge is what makes the extra points smooth: at the same tolerance, without it the disc follows ripple and turns a third more", () => {
    const disc_ = SHAPES.disc();
    const without = totalTurning(made(disc_, { curveMm: 0 }).points);
    const withIt = totalTurning(made(disc_).points);
    expect(without).toBeGreaterThan(600); // 718 measured: far more than the 360 degrees of a circle
    expect(withIt).toBeLessThan(without * 0.75); // 487 measured
  });

  it("is stable at every cut-off: the real spoon never explodes into zig-zag and keeps its size and its neck", async () => {
    const spoon = (await realSpoon()).raster;
    const base = { fillet_r_mm: 1.0, keepThinParts: true } as const;
    const plain = made(spoon, { ...base, curveMm: 0 });
    for (const curveMm of [1, 1.5, 2.5, 4, 6, 8, 20]) {
      const o = made(spoon, { ...base, curveMm });
      expect(zigzags(o.points), `curve ${curveMm}`).toBeLessThanOrEqual(12); // an unstable filter gave 63
      expect(maskIoU(o, spoon), `curve ${curveMm}`).toBeGreaterThan(0.98);
      expect(Math.abs(o.heightMm - plain.heightMm), `curve ${curveMm} height`).toBeLessThan(0.6);
      expect(narrowest(o), `curve ${curveMm} neck`).toBeGreaterThan(narrowest(plain) - 0.1); // the filter does not shrink a thin neck
    }
  });

  it("chooses the edge filter's cut-off from the size: a tenth of the longer side, no less than 3 mm and no more than 8 mm", () => {
    const disc_ = SHAPES.disc();
    // 54 mm: a tenth is 5.4 mm. 90 mm: a tenth is 9, so the 8 mm cap applies. 20 mm: a tenth is 2, so the 3 mm floor applies.
    for (const [height, expected, notExpected] of [[54, 5.4, [3, 8]], [90, 8, [9]], [20, 3, [2]]] as const) {
      const byDefault = made(disc_, { targetHeightMm: height }).points;
      expect(byDefault, `${height} mm`).toEqual(made(disc_, { targetHeightMm: height, curveMm: expected }).points);
      for (const other of notExpected) expect(byDefault, `${height} mm is not ${other}`).not.toEqual(made(disc_, { targetHeightMm: height, curveMm: other }).points);
    }
  });

  it("takes both options as written: NaN is the default, a negative number is zero, a huge sag is capped", () => {
    const mask = randomBlob(2);
    expect(made(mask, { curveMm: Number.NaN }).points).toEqual(made(mask).points);
    expect(made(mask, { curveMm: -5 }).points).toEqual(made(mask, { curveMm: 0 }).points);
    expect(made(mask, { sagMm: Number.NaN }).points).toEqual(made(mask).points);
    expect(made(mask, { sagMm: 1000 }).points).toEqual(made(mask, { sagMm: 1 }).points);
    expect(made(mask, { sagMm: -1 }).points).toEqual(made(mask, { sagMm: 0 }).points);
    expect(made(mask, { sagMm: 0.5 }).points).not.toEqual(made(mask, { sagMm: 0.03 }).points); // and the value is used
  });

  it("an outline that could not be smoothed keeps the old budget of 60, whatever the caller allows", () => {
    expect(made(SHAPES.disc(), { smoothMm: 0, maxPoints: 240 }).points.length).toBeLessThanOrEqual(60);
    expect(made(randomBlob(1), { smoothMm: 0, maxPoints: 240 }).points.length).toBeLessThanOrEqual(60);
  });
});

describe("the smoothing parts, one at a time", () => {
  const area = (p: readonly (readonly [number, number])[]) => Math.abs(p.reduce((a, q, i) => a + (q[0] * p[(i + 1) % p.length]![1] - p[(i + 1) % p.length]![0] * q[1]), 0)) / 2;

  it("gaussBlur keeps a flat field flat, keeps the mass of a spike, and has the width it was asked for", () => {
    const w = 61, h = 61;
    const flat = gaussBlur(new Uint8Array(w * h).fill(1), w, h, 2);
    expect(Math.min(...flat)).toBeGreaterThan(0.9999);
    expect(Math.max(...flat)).toBeLessThan(1.0001);
    const spike = new Uint8Array(w * h);
    spike[30 * w + 30] = 1;
    const out = gaussBlur(spike, w, h, 3);
    let mass = 0, m2 = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { mass += out[y * w + x]!; m2 += out[y * w + x]! * (x - 30) ** 2; }
    expect(mass).toBeCloseTo(1, 4);
    expect(m2).toBeGreaterThan(0.85 * 9); // the variance along x is sigma squared
    expect(m2).toBeLessThan(1.15 * 9);
    expect(out[30 * w + 33]).toBeCloseTo(out[30 * w + 27]!, 6); // symmetric
    expect(out[33 * w + 30]).toBeCloseTo(out[27 * w + 30]!, 6);
    expect(out[30 * w + 30]).toBeGreaterThan(out[30 * w + 32]!);
  });

  it("isoLoops puts a contour where the field crosses the level, to a hundredth of a pixel, with pixel centres at half-integers", () => {
    // A cone centred on pixel (30, 24): 1 - distance / 20, so the 0.5 contour is a circle of radius 10 around that pixel's centre.
    const w = 60, h = 50;
    const f = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) f[y * w + x] = Math.max(0, 1 - Math.hypot(x - 30, y - 24) / 20);
    const loops = isoLoops(f, w, h, 0.5);
    expect(loops).toHaveLength(1);
    for (const [x, y] of loops[0]!) {
      expect(Math.abs(Math.hypot(x - 30.5, y - 24.5) - 10)).toBeLessThan(0.05);
    }
    expect(loops[0]!.length).toBeGreaterThan(40);
    expect(area(loops[0]!)).toBeGreaterThan(Math.PI * 99 * 0.99);
    expect(area(loops[0]!)).toBeLessThan(Math.PI * 101);
  });

  it("isoLoops joins two diagonal pixels when the cell's mean is high enough and splits them when it is not", () => {
    const w = 6, h = 6;
    const make = (v: number) => {
      const f = new Float32Array(w * h);
      f[2 * w + 2] = v; // (2, 2) and (3, 3) are on, (3, 2) and (2, 3) are off: a saddle
      f[3 * w + 3] = v;
      return f;
    };
    expect(isoLoops(make(1), w, h, 0.5)).toHaveLength(1); // mean 0.5: the centre is in, so they are one shape
    expect(isoLoops(make(0.8), w, h, 0.5)).toHaveLength(2); // mean 0.4: the centre is out, so they are two
  });

  it("smoothContour is the biggest piece's outline, not the first or the last", () => {
    const w = 80, h = 60;
    // The scan meets loops top row first, so the small blob is placed higher than the big one: it is the first loop found, and the big one must still win.
    const bin = rasterize(w, h, union(disc(15, 9, 4), disc(50, 38, 18))).data;
    const c = smoothContour(bin, w, h, 1);
    expect(area(c)).toBeGreaterThan(Math.PI * 18 * 18 * 0.9);
    const small = rasterize(w, h, union(disc(25, 30, 18), disc(65, 30, 4))).data; // and the other way round (the big one clear of the edge, so its contour closes)
    expect(area(smoothContour(small, w, h, 1))).toBeGreaterThan(Math.PI * 18 * 18 * 0.9);
  });

  it("smoothContour of a raster with nothing in it is empty, so the caller can fall back", () => {
    expect(smoothContour(new Uint8Array(40 * 40), 40, 40, 1)).toEqual([]);
  });

  it("the smoothed outline sits where the unsmoothed one does: the centroid has not moved by half a working pixel", () => {
    const centroid = (p: readonly (readonly [number, number])[]) => {
      let a = 0, cx = 0, cz = 0;
      for (let i = 0; i < p.length; i++) {
        const q = p[(i + 1) % p.length]!;
        const c = p[i]![0] * q[1] - q[0] * p[i]![1];
        a += c; cx += (p[i]![0] + q[0]) * c; cz += (p[i]![1] + q[1]) * c;
      }
      return [cx / (3 * a), cz / (3 * a)] as const;
    };
    // Shapes with a centre of symmetry only. Blurring rounds the tips of an asymmetric one (the paddle's centroid moves 0.04 mm for that
    // reason) and the two traces choose different vertices within the simplifier's 0.08 mm (a star moves 0.04 mm that way), but a disc and a
    // square have centroids that cannot move, so any shift there is an offset. A missed half pixel is 0.07 mm at this size.
    for (const [name, mask] of [["disc", SHAPES.disc()], ["square", rasterize(400, 400, rect(100, 100, 300, 300))]] as const) {
      const old = legalizeOutline(mask, { targetHeightMm: 54, smoothMm: 0 });
      const now = legalizeOutline(mask, { targetHeightMm: 54 });
      if (!old.ok || !now.ok) throw new Error("legalize failed");
      const [ox, oz] = centroid(old.points);
      const [nx, nz] = centroid(now.points);
      expect(Math.abs(ox - nx), `${name} x`).toBeLessThan(0.03);
      expect(Math.abs(oz - nz), `${name} z`).toBeLessThan(0.03);
    }
  });
});
