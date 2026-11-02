import { inflateSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
// @ts-expect-error untyped browser JS module
import * as ST from "../parts/kip/viewer/kip-print-stickers.js";
import { photoStickerItem, type PhotoStickerItem } from "../shared/outlineSticker";
import { scanOutline, type ScanOutlineSuccess } from "../shared/outlineScan";
import { composeAffine, legalizeOutline, type Affine } from "../shared/photoOutline";
import { cropToObject, disc, fillHoles, rasterize, rect, randomBlob, rotated, star, union, type Inside, type Raster } from "./fixtures/outlineMasks";
import { realCup } from "./fixtures/realCupMask";

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
    ["a cut path of 401 points", (i) => (i.outerPolyMm = Array.from({ length: 401 }, (_, k) => [k % 50, Math.floor(k / 50)]))],
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
