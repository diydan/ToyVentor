import { inflateSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
// @ts-expect-error untyped browser JS module
import * as ST from "../parts/kip/viewer/kip-print-stickers.js";
import { photoStickerItem, type PhotoStickerItem } from "../shared/outlineSticker";
import { preparePhotoAccessory } from "../shared/photoAccessory";
import { scanOutline, type ScanOutlineSuccess } from "../shared/outlineScan";
import { composeAffine, legalizeOutline, type Affine } from "../shared/photoOutline";
import { cropToObject, disc, fillHoles, rasterize, rect, randomBlob, rotated, stairCorners, star, totalTurning, union, zigzags, type Inside, type Raster } from "./fixtures/outlineMasks";
import { realCup, realSpoon, SPOON_PHOTO } from "./fixtures/realCupMask";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Rendering is per-pixel JS and the legalizer takes up to 0.9 s a call; the machine is often at load 50 or more.
vi.setConfig({ testTimeout: 60_000 });

// ---- an independent reference: a photo where the object is one colour and everything else another -----------------------

type Rgb = readonly [number, number, number];
const RED: Rgb = [230, 30, 30];
const BLUE: Rgb = [30, 60, 230];

interface Source {
  w: number;
  h: number;
  data: Uint8ClampedArray;
}

/** The mask as a picture at `scale` times its size: object pixels red, the rest blue. Nearest-neighbour. */
function maskPicture(mask: Raster, scale = 1): Source {
  const w = Math.max(2, Math.round(mask.width * scale));
  const h = Math.max(2, Math.round(mask.height * scale));
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = Math.min(mask.width - 1, Math.floor(((x + 0.5) / w) * mask.width));
      const sy = Math.min(mask.height - 1, Math.floor(((y + 0.5) / h) * mask.height));
      const c = mask.data[sy * mask.width + sx] ? RED : BLUE;
      const o = (y * w + x) * 4;
      data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255;
    }
  return { w, h, data };
}

/** Red grows with x, green with y, both read at pixel centres: the value at a point does not depend on the resolution. */
function gradientPicture(w: number, h: number): Source {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      data[o] = Math.round(((x + 0.5) / w) * 255);
      data[o + 1] = Math.round(((y + 0.5) / h) * 255);
      data[o + 3] = 255;
    }
  return { w, h, data };
}

/** Independent of the code under test: ray casting. */
function inside(poly: readonly (readonly [number, number])[], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function planOf(item: PhotoStickerItem, extra: Record<string, unknown> = {}) {
  return ST.planStickerSheet([{ kind: "photo_accessory", item, ...extra }], { edition: "pro" });
}

/** Render the planned sticker and visit every output pixel whose centre is inside the cut path. */
function render(item: PhotoStickerItem, source: Source | null, dpi = 70) {
  const plan = planOf(item, { spare: false });
  const it = plan.items[0];
  const r = ST.renderStickerItemRgba(it, source ? { [it.sampler.sourceKey]: source } : {}, dpi, 1.0);
  const pixels: { o: number; x: number; y: number }[] = [];
  for (let py = 0; py < r.h; py++)
    for (let px = 0; px < r.w; px++) {
      const x = ((px + 0.5) / r.w) * r.totalWMm - 1.0;
      const y = ((py + 0.5) / r.h) * r.totalHMm - 1.0;
      if (inside(it.outerPolyMm, x, y)) pixels.push({ o: (py * r.w + px) * 4, x, y });
    }
  return { plan, item: it, r, pixels };
}

const near = (d: Uint8ClampedArray, o: number, c: Rgb, tol = 40) => Math.abs(d[o]! - c[0]) < tol && Math.abs(d[o + 1]! - c[1]) < tol && Math.abs(d[o + 2]! - c[2]) < tol;
const share = (d: Uint8ClampedArray, pixels: { o: number }[], c: Rgb, tol = 40) => pixels.filter((p) => near(d, p.o, c, tol)).length / pixels.length;

const PHOTO_W = 640;
const PHOTO_H = 480;
const PHOTO = { width: PHOTO_W, height: PHOTO_H };

/** A photo with `shape` somewhere in it, the outline a scan returns for it, and the sticker item for that outline. */
function chain(shape: Inside | Raster, request: { targetHeightMm?: number; flip?: boolean; orient?: "as-photographed" } = { targetHeightMm: 54 }, photo = PHOTO) {
  const raster = typeof shape === "function" ? rasterize(photo.width, photo.height, shape) : shape;
  const c = cropToObject(raster);
  const outline = scanOutline(c.raster, c.bounds, { width: raster.width, height: raster.height }, request);
  if (!outline.ok) throw new Error(`no outline: ${outline.reason} ${outline.detail}`);
  return { photo: raster, outline, item: photoStickerItem(outline) };
}

// ---- the plan ---------------------------------------------------------------------------------------------------

describe("planStickerSheet: photo accessories", () => {
  const { item } = chain(disc(400, 200, 90));

  it("plans one sticker and one spare, on the sheet, with the cut path unchanged", () => {
    const plan = planOf(item);
    expect(plan.items).toHaveLength(2);
    const [a, b] = plan.items;
    expect([a.id, b.id]).toEqual(["photo_accessory", "photo_accessory_spare"]);
    expect(b.label).toBe("Photo accessory (spare)");
    for (const it of plan.items) {
      expect(it.kind).toBe("photo_accessory");
      expect(it.w).toBe(item.w);
      expect(it.h).toBe(item.h);
      expect(it.holePolysMm).toEqual([]);
      expect(it.outerPolyMm).toHaveLength(item.outerPolyMm.length);
      expect(it.scissorPolyMm.flat().every(Number.isFinite)).toBe(true);
      expect(it.sampler.mode).toBe("photo_outline");
      expect(it.sampler.sourceKey).toBe("photo:" + it.id.replace(/_spare$/, ""));
    }
    expect(a.outerPolyMm).toEqual(item.outerPolyMm); // already clockwise: the winding step must not change it
    // The two do not overlap and both sit inside the active box.
    expect(a.x + a.w + 1 <= b.x - 1 || b.x + b.w + 1 <= a.x - 1 || a.y + a.h + 1 <= b.y - 1 || b.y + b.h + 1 <= a.y - 1).toBe(true);
    expect(plan.activeBoxMm.w).toBeLessThanOrEqual(ST.CRICUT_MAX_MM.w);
    expect(plan.activeBoxMm.h).toBeLessThanOrEqual(ST.CRICUT_MAX_MM.h);
    for (const it of plan.items) {
      expect(it.x + it.w).toBeLessThanOrEqual(plan.activeBoxMm.w);
      expect(it.y + it.h).toBeLessThanOrEqual(plan.activeBoxMm.h);
    }
  });

  it("turns a counter-clockwise cut path clockwise, as the writers want", () => {
    const area = (p: readonly (readonly [number, number])[]) => p.reduce((a, q, i) => a + (q[0] * p[(i + 1) % p.length]![1] - p[(i + 1) % p.length]![0] * q[1]), 0) / 2;
    const reversed = JSON.parse(JSON.stringify(item));
    reversed.outerPolyMm = [...reversed.outerPolyMm].reverse();
    expect(Math.sign(area(reversed.outerPolyMm))).toBe(-Math.sign(area(item.outerPolyMm))); // guard: it really is the other way round
    const [a] = planOf(reversed).items;
    expect(Math.sign(area(a.outerPolyMm))).toBe(Math.sign(area(item.outerPolyMm)));
  });

  it("plans only one with spare: false, and nothing for a decal with no item", () => {
    expect(planOf(item, { spare: false }).items).toHaveLength(1);
    expect(ST.planStickerSheet([{ kind: "photo_accessory" }], {}).items).toHaveLength(0);
  });

  it("sits beside the other decals on a sheet", () => {
    const plan = ST.planStickerSheet([{ kind: "craft_cutout", slot: "hand" }, { kind: "photo_accessory", item }], {});
    expect(plan.items.map((i: any) => i.kind)).toEqual(["craft_cutout", "photo_accessory", "photo_accessory"]);
  });

  // Each row breaks one thing in a good item. The base is checked first so a row cannot pass for the wrong reason.
  const breaks: [string, (i: any) => void][] = [
    ["no sampler", (i) => delete i.sampler],
    ["another sampler mode", (i) => (i.sampler.mode = "unroll_crop")],
    ["a cut path of 2 points", (i) => (i.outerPolyMm = i.outerPolyMm.slice(0, 2))],
    ["a cut path of 1201 points", (i) => (i.outerPolyMm = Array.from({ length: 1201 }, (_, k) => [k % 50, Math.floor(k / 50)]))],
    ["a NaN in the cut path", (i) => (i.outerPolyMm[3] = [Number.NaN, 4])],
    ["a string in the cut path", (i) => (i.outerPolyMm[3] = ["1", 4])],
    ["a cut path that is not an array", (i) => (i.outerPolyMm = "square")],
    ["a zero width", (i) => (i.w = 0)],
    ["a width past the sheet", (i) => (i.w = 121)],
    ["a height past the sheet", (i) => (i.h = 121)],
    ["a photo map that is null", (i) => (i.sampler.stickerToPhoto = null)],
    ["a photo map of 5 numbers", (i) => (i.sampler.stickerToPhoto = i.sampler.stickerToPhoto.slice(0, 5))],
    ["a NaN in the photo map", (i) => (i.sampler.stickerToPhoto[4] = Number.NaN)],
  ];
  it("takes a cut path of exactly 1200 points, the module's limit for a dense outline, and not 1201", () => {
    const ring = (n: number) => Array.from({ length: n }, (_, k) => [20 + 20 * Math.cos((k / n) * 2 * Math.PI), 20 + 20 * Math.sin((k / n) * 2 * Math.PI)]);
    const dense = JSON.parse(JSON.stringify(item));
    dense.outerPolyMm = ring(1200);
    dense.w = 40;
    dense.h = 40;
    expect(planOf(dense).items).toHaveLength(2);
    dense.outerPolyMm = ring(1201);
    expect(planOf(dense).items).toHaveLength(0);
  });

  it("takes the base item", () => {
    expect(planOf(JSON.parse(JSON.stringify(item))).items).toHaveLength(2);
  });
  it.each(breaks)("skips an item with %s, and does not throw", (_name, mutate) => {
    const bad = JSON.parse(JSON.stringify(item));
    mutate(bad);
    expect(planOf(bad).items).toHaveLength(0);
  });

  it("rebuilds the item: nothing it does not know survives, holes are dropped, the id and label are made safe", () => {
    const dirty = JSON.parse(JSON.stringify(item));
    dirty.evil = 1;
    dirty.sampler.evil = 1;
    dirty.holePolysMm = [[[1, 1], [2, 1], [2, 2]]];
    dirty.foldLinesMm = [[[0, 0], [1, 1]]];
    dirty.id = "../A b/C.png";
    dirty.label = "Sam's cup \u{1F375} (v2)";
    const [a] = planOf(dirty).items;
    expect(JSON.stringify(a)).not.toContain("evil");
    expect(a.holePolysMm).toEqual([]);
    expect(a.foldLinesMm).toEqual([]);
    expect(a.id).toMatch(/^[a-z0-9_]+$/);
    expect(a.label).toMatch(/^[\x20-\x7e]+$/);
    expect(a.label.length).toBeLessThanOrEqual(60);
    expect(a.sampler.sourceKey).toBe(`photo:${a.id}`);
  });

  it("caps a long id at 40 characters and a long label at 60", () => {
    const long = JSON.parse(JSON.stringify(item));
    long.id = "a".repeat(200);
    long.label = "word ".repeat(100);
    const [a] = planOf(long).items;
    expect(a.id).toHaveLength(40);
    expect(a.label).toHaveLength(60);
    expect(a.sampler.sourceKey).toBe(`photo:${"a".repeat(40)}`);
  });

  it("carries geometry and no pixels", () => {
    const text = JSON.stringify(planOf(item));
    expect(text).not.toMatch(/"data"|rgba|base64/i);
  });
});

// ---- the artwork: the whole chain, drawn -----------------------------------------------------------------------

describe("renderStickerItemRgba: photo_outline", () => {
  const cases: [string, () => ReturnType<typeof chain>][] = [
    ["a disc", () => chain(disc(400, 200, 90))],
    ["a lollipop on its side", () => chain(rotated(union(disc(300, 240, 80), rect(380, 225, 560, 255)), 400, 240, 25), { targetHeightMm: 60 })],
    ["a star, flipped", () => chain(star(320, 240, 160, 70), { targetHeightMm: 54, flip: true })],
    ["a lollipop, as photographed", () => chain(union(disc(500, 120, 70), rect(485, 180, 515, 400)), { targetHeightMm: 40, orient: "as-photographed" })],
    ["a random blob", () => chain(randomBlob(2, 320), { targetHeightMm: 50 }, { width: 320, height: 320 })],
    ["another random blob", () => chain(randomBlob(5, 320), { targetHeightMm: 70 }, { width: 320, height: 320 })],
  ];

  it.each(cases)("%s: the sticker shows the object, and only the object", (_name, make) => {
    const { photo, item } = make();
    const { pixels, r } = render(item, maskPicture(photo));
    expect(pixels.length).toBeGreaterThan(2000); // guard: a real area was checked
    expect(share(r.data, pixels, RED)).toBeGreaterThan(0.98);
    expect(share(r.data, pixels, BLUE)).toBeLessThan(0.02);
  });

  it("a mirrored or turned photo map is caught by that check (canary): an L is not symmetric either way", () => {
    const { photo, item } = chain(union(rect(200, 80, 270, 400), rect(200, 330, 460, 400)), { targetHeightMm: 54 });
    const source = maskPicture(photo);
    const good = render(item, source);
    expect(share(good.r.data, good.pixels, RED)).toBeGreaterThan(0.98);
    const m = item.sampler.stickerToPhoto as Affine;
    const broken = (reflect: Affine): PhotoStickerItem => ({ ...item, sampler: { ...item.sampler, stickerToPhoto: composeAffine(m, reflect) } });
    const mirrored = render(broken([-1, 0, 0, 1, item.w, 0]), source);
    const upside = render(broken([1, 0, 0, -1, 0, item.h]), source);
    const turned = render(broken([-1, 0, 0, -1, item.w, item.h]), source);
    for (const bad of [mirrored, upside, turned]) expect(share(bad.r.data, bad.pixels, RED)).toBeLessThan(0.8);
  });

  it("reads the photo at any resolution: half size, double size and an odd size draw the same sticker", () => {
    const { photo, item } = chain(star(320, 240, 160, 70), { targetHeightMm: 54 });
    for (const scale of [0.5, 1, 2, 0.37]) {
      const { pixels, r } = render(item, maskPicture(photo, scale));
      expect(share(r.data, pixels, RED), `scale ${scale}`).toBeGreaterThan(0.97);
    }
  });

  it("puts each point of the photo where the map says, at every resolution: pixel centres line up", () => {
    // A small photo, so one pixel is several grey levels and a half-pixel slip in the sampler cannot hide in rounding.
    const small = { width: 48, height: 36 };
    const { item } = chain(disc(24, 18, 14), { targetHeightMm: 54 }, small);
    const m = item.sampler.stickerToPhoto as Affine;
    for (const [w, h] of [[48, 36], [24, 18], [96, 72], [37, 29]] as const) {
      const src = gradientPicture(w, h);
      const { pixels, r } = render(item, src, 40);
      let checked = 0;
      for (const p of pixels) {
        const ix = m[0] * p.x + m[2] * p.y + m[4];
        const iy = m[1] * p.x + m[3] * p.y + m[5];
        if (ix < 0.5 || ix > small.width - 1.5 || iy < 0.5 || iy > small.height - 1.5) continue; // away from the edge: no clamping
        // The photo's pixel i has its centre at (i + 0.5) / 48 of the way across: that is what the gradient holds, at any size.
        const wantR = ((ix + 0.5) / small.width) * 255;
        const wantG = ((iy + 0.5) / small.height) * 255;
        expect(Math.abs(r.data[p.o]! - wantR), `${w}x${h} R at ${ix.toFixed(2)}`).toBeLessThan(2.6);
        expect(Math.abs(r.data[p.o + 1]! - wantG), `${w}x${h} G at ${iy.toFixed(2)}`).toBeLessThan(2.6);
        checked++;
      }
      expect(checked, `${w}x${h}`).toBeGreaterThan(200);
    }
  });

  it("an outline made straight from a mask, with no photo size, reads a source the size of the mask", () => {
    const raster = rasterize(300, 300, union(disc(150, 80, 60), rect(135, 130, 165, 280)));
    const out = legalizeOutline(raster, { targetHeightMm: 54, keepThinParts: true });
    if (!out.ok) throw new Error("legalize failed");
    const item = photoStickerItem(out);
    expect(item.sampler.photoSize).toBeNull();
    const { pixels, r } = render(item, maskPicture(raster));
    // A 300 px mask is coarse at this size (a source pixel is 0.18 mm), so edge pixels blend red into blue and count as neither:
    // the object share is a little lower than on a full-size photo, and a wrong map would still drop it far below this.
    expect(share(r.data, pixels, RED)).toBeGreaterThan(0.97);
    expect(share(r.data, pixels, BLUE)).toBeLessThan(0.01);
  });

  it("repeats the edge colour where the cut path touches the photo's edge, never printing the background colour", () => {
    // Objects pressed against the right and bottom edge, and the left and top edge: the path reaches half a pixel past the photo.
    const corners: [string, Inside][] = [
      ["bottom right", disc(PHOTO_W - 31, PHOTO_H - 31, 30)],
      ["top left", disc(30, 30, 30)],
      ["a bar across the whole photo", rect(0, 100, PHOTO_W, 200)],
    ];
    for (const [name, shape] of corners) {
      const { item } = chain(shape, { targetHeightMm: 40 });
      const allRed: Source = { w: PHOTO_W, h: PHOTO_H, data: new Uint8ClampedArray(PHOTO_W * PHOTO_H * 4).map((_, i) => (i % 4 === 0 ? 230 : i % 4 === 3 ? 255 : 30)) };
      const { pixels, r } = render(item, allRed);
      expect(pixels.length, name).toBeGreaterThan(500);
      expect(share(r.data, pixels, RED, 6), name).toBe(1); // every pixel inside the cut: none went white
    }
  });

  it("a source that is missing prints the item's colour, white by default, and does not throw", () => {
    const { item } = chain(disc(400, 200, 90));
    const { pixels, r } = render(item, null);
    expect(pixels.length).toBeGreaterThan(1000);
    expect(pixels.every((p) => r.data[p.o] === 255 && r.data[p.o + 1] === 255 && r.data[p.o + 2] === 255 && r.data[p.o + 3] === 255)).toBe(true);
  });

  it("draws the real cup: the sticker lies on the cup in the photo, holes filled", async () => {
    const cup = await realCup();
    const out = scanOutline(cup.raster, cup.bounds, { width: 1920, height: 1280 }, { targetHeightMm: 54 });
    if (!out.ok) throw new Error("no outline for the cup");
    const item = photoStickerItem(out);
    // The photo, as a picture at a quarter size: the cup (with its holes filled, as a photo of a cup would show) red, the rest blue.
    const full: Raster = { width: 1920, height: 1280, data: new Uint8Array(1920 * 1280) };
    const filled = fillHoles(cup.raster);
    for (let y = 0; y < filled.height; y++) for (let x = 0; x < filled.width; x++) if (filled.data[y * filled.width + x]) full.data[(y + cup.bounds.top) * 1920 + x + cup.bounds.left] = 1;
    const { pixels, r } = render(item, maskPicture(full, 0.25));
    expect(pixels.length).toBeGreaterThan(2000);
    expect(share(r.data, pixels, RED)).toBeGreaterThan(0.98);
  });
});

// ---- the cut line is smooth -----------------------------------------------------------------------------------------------

// ---- the per-row slide: no fringe of background on a symmetric sticker --------------------------------------------------------

describe("the per-row slide in the sticker artwork", () => {
  /** The real spoon's mask placed in a photo of the size the model saw, as a Raster. */
  async function spoonPhoto(): Promise<Raster> {
    const s = await realSpoon();
    const data = new Uint8Array(SPOON_PHOTO.width * SPOON_PHOTO.height);
    for (let y = 0; y < s.raster.height; y++) for (let x = 0; x < s.raster.width; x++) if (s.raster.data[y * s.raster.width + x]) data[(y + s.bounds.top) * SPOON_PHOTO.width + x + s.bounds.left] = 1;
    return { data, width: SPOON_PHOTO.width, height: SPOON_PHOTO.height };
  }
  const without = (item: PhotoStickerItem): PhotoStickerItem => {
    const copy = JSON.parse(JSON.stringify(item));
    delete copy.sampler.rowShiftMm;
    return copy;
  };
  const blueShare = (item: PhotoStickerItem, photo: Raster, dpi = 110) => {
    const { pixels, r } = render(item, maskPicture(photo), dpi);
    expect(pixels.length).toBeGreaterThan(2500); // guard: a real area was checked
    return share(r.data, pixels, BLUE);
  };
  const TILTED_BUMPY = union(disc(200, 90, 70), rect(185, 150, 215, 380), disc(128, 92, 12), disc(188, 250, 7), disc(174, 330, 5));

  it("the real spoon fills its symmetric cut path with the spoon: the fringe of background is under 1% with the slide and over 2% without it", async () => {
    const photo = await spoonPhoto();
    const { item, outline } = chain(photo, { targetHeightMm: 54 }, SPOON_PHOTO);
    expect(outline.changes.map((c) => c.code)).toContain("made_symmetric"); // guard
    expect(item.sampler.rowShiftMm).toBeDefined();
    const withSlide = blueShare(item, photo);
    const noSlide = blueShare(without(item), photo);
    expect(noSlide).toBeGreaterThan(0.02);
    expect(withSlide).toBeLessThan(0.01);
    expect(withSlide).toBeLessThan(noSlide / 4);
  });

  it("a shape that leans 8 degrees, made upright and symmetric, fills its cut path too", () => {
    const shape = rotated(TILTED_BUMPY, 200, 200, 8);
    const { photo, item, outline } = chain(shape, { targetHeightMm: 54, orient: "as-photographed" });
    expect(outline.changes.map((c) => c.code)).toContain("made_symmetric"); // guard
    const withSlide = blueShare(item, photo);
    const noSlide = blueShare(without(item), photo);
    expect(noSlide).toBeGreaterThan(0.005); // the bumps are mild, so the fringe is smaller than the spoon's
    expect(withSlide).toBeLessThan(0.004);
    expect(withSlide).toBeLessThan(noSlide / 3);
  });

  it("an object that was symmetric already needs no slide, and has none worth the name: a disc's sticker is the object", () => {
    const { photo, item } = chain(disc(400, 200, 90));
    expect(blueShare(item, photo)).toBeLessThan(0.01);
    expect(item.sampler.rowShiftMm === undefined || Math.max(...item.sampler.rowShiftMm.map((p) => Math.abs(p[1]))) < 0.1).toBe(true);
  });

  it("the sign and the size are right: a constant slide of +3 mm shows the photo 3 mm along the row, so a lens of background is left on the far side", () => {
    // A disc cut from a disc photo, the artwork slid by d. Two equal discs offset by d overlap in a lens, so the share of the cut path
    // that is background is 1 - (2/pi)(acos(d/2R) - (d/2R) sqrt(1 - (d/2R)^2)): worked out here, not taken from the module.
    const { photo, item } = chain(disc(400, 200, 90));
    const R = item.w / 2;
    const slid = (d: number): PhotoStickerItem => ({ ...item, sampler: { ...item.sampler, rowShiftMm: [[0, d], [item.h, d]] } });
    for (const d of [3, -3, 1.5]) {
      const { pixels, r } = render(slid(d), maskPicture(photo), 110);
      const k = Math.abs(d) / (2 * R);
      const expected = 1 - (2 / Math.PI) * (Math.acos(k) - k * Math.sqrt(1 - k * k));
      const blue = pixels.filter((p) => near(r.data, p.o, BLUE));
      expect(Math.abs(blue.length / pixels.length - expected), `d ${d}`).toBeLessThan(0.015);
      // Which side: the artwork at X comes from X + d, so for d > 0 the object has moved left and the background shows on the right.
      const meanX = blue.reduce((s, p) => s + p.x, 0) / blue.length;
      if (d > 0) expect(meanX, `d ${d}`).toBeGreaterThan(item.w / 2 + R * 0.4);
      else expect(meanX, `d ${d}`).toBeLessThan(item.w / 2 - R * 0.4);
    }
  });

  it("holds through the print step's own flip and resize, and through a marginal result that makes the fit loop rescale", async () => {
    const photo = await spoonPhoto();
    const { outline } = chain(photo, { targetHeightMm: 54 }, SPOON_PHOTO);
    const marginalFirst = (() => {
      let n = 0;
      return async () => (++n === 1 ? { status: "marginal" as const, failures: [] as string[], cylinderMm: 33.5 } : { status: "pass" as const, failures: [] as string[] });
    })();
    for (const [name, options, gate] of [
      ["flipped", { flip: true }, async () => ({ status: "pass" as const, failures: [] as string[] })],
      ["resized to 70%", { scale: 0.7 }, async () => ({ status: "pass" as const, failures: [] as string[] })],
      ["flipped, resized and rescaled by the loop", { flip: true, scale: 1.2 }, marginalFirst],
    ] as const) {
      const r = await preparePhotoAccessory(outline, gate, options);
      expect(r.ok, name).toBe(true);
      if (!r.ok) continue;
      expect(r.sticker.sampler.rowShiftMm, name).toBeDefined();
      const noSlide = blueShare(without(r.sticker), photo);
      const withSlide = blueShare(r.sticker, photo);
      expect(noSlide, `${name}: guard, a fringe without the slide`).toBeGreaterThan(0.02);
      expect(withSlide, name).toBeLessThan(0.012);
    }
  });

  it("the sheet module keeps the table: a planned item carries a copy of it, rebuilt pair by pair", async () => {
    const { item } = chain(await spoonPhoto(), { targetHeightMm: 54 }, SPOON_PHOTO);
    const plan = planOf(item, { spare: false });
    expect(plan.items[0].sampler.rowShiftMm).toEqual(item.sampler.rowShiftMm);
    expect(plan.items[0].sampler.rowShiftMm).not.toBe(item.sampler.rowShiftMm);
    const before = JSON.stringify(plan.items[0].sampler.rowShiftMm);
    item.sampler.rowShiftMm![0]![1] += 5; // changing the caller's table afterwards does not change the plan
    expect(JSON.stringify(plan.items[0].sampler.rowShiftMm)).toBe(before);
  });

  it.each([
    ["not an array", "slide"],
    ["one pair", [[0, 0.1]]],
    ["a pair of three", [[0, 0.1, 9], [5, 0.2, 9]]],
    ["a string for a number", [["0", 0.1], [5, 0.2]]],
    ["a number that is not finite", [[0, Number.NaN], [5, 0.2]]],
    ["rows not rising", [[5, 0.1], [0, 0.2]]],
    ["a row repeated", [[0, 0.1], [0, 0.2]]],
    ["a slide wider than the plate", [[0, 50], [5, 0.2]]],
    ["257 pairs", Array.from({ length: 257 }, (_, i) => [i, 0.1])],
  ])("a table the module cannot trust (%s) is left out and the sticker is still drawn, with no slide", async (_name, bad) => {
    const { item } = chain(await spoonPhoto(), { targetHeightMm: 54 }, SPOON_PHOTO);
    const broken = JSON.parse(JSON.stringify(item));
    broken.sampler.rowShiftMm = bad;
    const plan = planOf(broken, { spare: false });
    expect(plan.items).toHaveLength(1);
    expect("rowShiftMm" in plan.items[0].sampler).toBe(false);
    expect(plan.items[0].outerPolyMm.length).toBe(item.outerPolyMm.length);
  });

  it("rowShiftAt: exact at the pairs, linear between them, the end value beyond them, and fine with two pairs", () => {
    const t: [number, number][] = [[0, 1], [10, -1], [20, 3]];
    expect(ST.rowShiftAt(t, 0)).toBe(1);
    expect(ST.rowShiftAt(t, 10)).toBe(-1);
    expect(ST.rowShiftAt(t, 20)).toBe(3);
    expect(ST.rowShiftAt(t, 5)).toBeCloseTo(0, 12);
    expect(ST.rowShiftAt(t, 15)).toBeCloseTo(1, 12);
    expect(ST.rowShiftAt(t, -50)).toBe(1);
    expect(ST.rowShiftAt(t, 50)).toBe(3);
    expect(ST.rowShiftAt([[2, 4], [6, 8]], 4)).toBeCloseTo(6, 12);
    let seed = 3;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const big: [number, number][] = Array.from({ length: 200 }, (_, i): [number, number] => [i * 0.5, rnd() * 2 - 1]);
    for (let y = 0; y < 99.5; y += 0.173) { // the last row is at 99.5: beyond it the module holds the end value, which is its own test above
      const i = Math.min(198, Math.floor(y / 0.5));
      const f = (y - big[i]![0]) / (big[i + 1]![0] - big[i]![0]);
      expect(ST.rowShiftAt(big, y)).toBeCloseTo(big[i]![1] + f * (big[i + 1]![1] - big[i]![1]), 9);
    }
  });
});

describe("the sticker's cut line", () => {
  it("has no notches on the real spoon: no step corners and far less zig-zag than the unsmoothed outline gave", async () => {
    const { raster, bounds } = await realSpoon();
    const before = legalizeOutline(raster, { targetHeightMm: 54, fillet_r_mm: 1.0, keepThinParts: true, smoothMm: 0 });
    const after = scanOutline(raster, bounds, SPOON_PHOTO, { targetHeightMm: 54 });
    if (!before.ok || !after.ok) throw new Error("no outline");
    const oldCut = photoStickerItem(before).outerPolyMm;
    const newCut = photoStickerItem(after).outerPolyMm;
    expect(stairCorners(oldCut)).toBeGreaterThanOrEqual(4); // guard: the notches were on the cut line before
    expect(stairCorners(newCut)).toBe(0);
    expect(zigzags(newCut)).toBeLessThan(zigzags(oldCut) / 2);
    expect(totalTurning(newCut)).toBeLessThan(totalTurning(oldCut) * 0.7);
  });
});

// ---- the writers ------------------------------------------------------------------------------------------------

describe("the sheet writers with a photo accessory", () => {
  const { photo, item } = chain(star(320, 240, 160, 70), { targetHeightMm: 54 });
  const source = maskPicture(photo, 0.5);
  const plan = planOf(item);
  const sources = { "photo:photo_accessory": source };

  it("writes a PNG of the sheet with the artwork on it", () => {
    const png: Uint8Array = ST.stickersToPng(plan, sources, { dpi: 40 });
    expect(Array.from(png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    // Decode the IDAT back to pixels and look for the artwork's red.
    const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
    let pos = 8, w = 0, h = 0;
    const idat: Uint8Array[] = [];
    while (pos < png.length) {
      const len = dv.getUint32(pos);
      const type = String.fromCharCode(...png.slice(pos + 4, pos + 8));
      if (type === "IHDR") { w = dv.getUint32(pos + 8); h = dv.getUint32(pos + 12); }
      if (type === "IDAT") idat.push(png.slice(pos + 8, pos + 8 + len));
      pos += 12 + len;
    }
    const raw = inflateSync(Buffer.concat(idat));
    const stride = 1 + w * 4;
    let red = 0, blue = 0;
    for (let y = 0; y < h; y++) {
      expect(raw[y * stride]).toBe(0); // filter 0, so the bytes are the pixels
      for (let x = 0; x < w; x++) {
        const o = y * stride + 1 + x * 4;
        if (raw[o]! > 200 && raw[o + 1]! < 80 && raw[o + 2]! < 80) red++;
        if (raw[o + 2]! > 200 && raw[o]! < 80 && raw[o + 1]! < 100) blue++;
      }
    }
    expect(red).toBeGreaterThan(500);
    expect(blue / (red + blue)).toBeLessThan(0.05); // the sticker is the object: a trace of background only at the edge
  });

  it("writes a PDF, a cut SVG with a path for each sticker, and a DXF", () => {
    const pdf: Uint8Array = ST.stickersToPdf(plan, sources, { dpi: 40 });
    expect(String.fromCharCode(...pdf.slice(0, 5))).toBe("%PDF-");
    const svg: string = ST.stickersCutSvg(plan);
    expect(svg).toContain('id="cut-line"');
    expect(svg).toContain('id="cut-2"');
    expect(svg).not.toContain("NaN");
    const dxf: string = ST.stickersCutDxf(plan);
    expect(dxf).not.toContain("NaN");
    expect(dxf.length).toBeGreaterThan(200);
  });

  it("packs the four sticker files for a photo accessory alone", () => {
    const files = ST.buildStickerPackFiles([{ kind: "photo_accessory", item }], {}, sources, { dpi: 40 });
    expect(files.map((f: any) => f.name)).toEqual(["stickers/sticker-sheet.pdf", "stickers/stickers.png", "stickers/stickers-cut.svg", "stickers/stickers-cut.dxf"]);
  });
});

// ---- the shared type of the scan reply feeds the item ------------------------------------------------------------------

describe("photoStickerItem from a scan reply", () => {
  it("carries the photo size, so artwork drawn from any resolution lines up", () => {
    const { item, outline } = chain(disc(400, 200, 90));
    expect(item.sampler.photoSize).toEqual((outline as ScanOutlineSuccess).photoSize);
  });
});
