// The photo's colours on a household item: the game asset only, a print stays single-colour (docs/specs/household-library-spec.md).
//
// Pure parts, each with the cases that can break it:
//   shared/photoPrintFlow.ts   uprightOutline, skinOutline, skinStickerItem, skinDpi, householdSkin (the skin picture)
//   viewer SDK                 householdFrontWeight, householdPhotoUv, householdSkinMode, patchSkinShader, applyHouseholdSkin (UVs, weights, the toggle)
// The real page (scripts/e2e-kip-household.mjs, part C) looks at the pictures.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";
import { skinDpi, skinOutline, skinStickerItem, SKIN_ERODE_PX, SKIN_LONGEST_PX, SKIN_MIN_COVERAGE, SKIN_REACH_PX, householdSkin, uprightOutline } from "../shared/photoPrintFlow";
import { scanOutline } from "../shared/outlineScan";
import { applyAffine, invertAffine } from "../shared/photoOutline";
import { parseHouseholdCatalog } from "../shared/householdMatch";
// @ts-expect-error the viewer is plain JavaScript
import { applyHouseholdSkin, buildHouseholdHandMesh, householdFrontWeight, householdPhotoUv, householdSkinMode, HOUSEHOLD_FIT_MAX_MISMATCH, HOUSEHOLD_FRONT_FADE, patchSkinShader } from "../parts/kip/viewer/kip-forge-sdk.js";
// @ts-expect-error the viewer is plain JavaScript
import * as ST from "../parts/kip/viewer/kip-print-stickers.js";
import { realCup, realSpoon } from "./fixtures/realCupMask";

const ROOT = join(__dirname, "..");
const raw = JSON.parse(readFileSync(join(ROOT, "public/kip/household/catalog.json"), "utf8"));
const parsed = parseHouseholdCatalog(raw);
if (!parsed.ok) throw new Error(parsed.message);
const built = parsed.catalog.items.filter((i) => i.built);
/** The same rows as the build wrote them, with their colour zones (the matcher's own rows carry only what matching reads). */
const rawBuilt = (raw.items as { id: string; built: boolean; glb: string; zones: { name: string; hex: string }[] }[]).filter((i) => i.built);

// ---- the skin picture --------------------------------------------------------------------------------------------------------------

type Art = { w: number; h: number; data: Uint8ClampedArray };
/** A picture w x h: `paint(x, y)` gives [r, g, b] inside the outline or null outside it. */
function art(w: number, h: number, paint: (x: number, y: number) => [number, number, number] | null): Art {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = paint(x, y);
    if (c) data.set([c[0], c[1], c[2], 255], (y * w + x) * 4);
  }
  return { w, h, data };
}
const px = (s: { w: number; data: Uint8ClampedArray }, x: number, y: number) => Array.from(s.data.subarray((y * s.w + x) * 4, (y * s.w + x) * 4 + 4));
const RED: [number, number, number] = [200, 30, 40];
const BLUE: [number, number, number] = [30, 60, 210];
const TAN: [number, number, number] = [196, 152, 104];

describe("householdSkin: the photo cut to the object's outline, made whole", () => {
  it("keeps the object's own pixels, and every pixel of the picture is opaque", () => {
    const a = art(120, 160, (x, y) => (x >= 30 && x < 90 && y >= 40 && y < 120 ? [x, y, 77] : null));
    const s = householdSkin(a, 20, 30)!;
    expect(s).not.toBeNull();
    expect(s.w).toBe(120);
    expect(s.h).toBe(160);
    for (let i = 0; i < s.w * s.h; i++) expect(s.data[i * 4 + 3]).toBe(255);
    // well inside the outline (past the ring that is not trusted) the pixel is the photo's
    expect(px(s, 60, 80)).toEqual([60, 80, 77, 255]);
    expect(px(s, 45, 60)).toEqual([45, 60, 77, 255]);
    expect(s.widthMm).toBe(20);
    expect(s.heightMm).toBe(30);
    expect(s.coverage).toBeCloseTo((60 * 80) / (120 * 160), 5);
  });

  it("outside the outline it carries the object's edge colours a little way, then the object's mean colour: the photo's background is never used", () => {
    const a = art(200, 100, (x, y) => (x >= 60 && x < 140 && y >= 20 && y < 80 ? (x < 100 ? RED : BLUE) : null));
    const s = householdSkin(a, 40, 30)!;
    // just left of the object: red carried out; just right: blue carried out
    expect(px(s, 58, 50).slice(0, 3)).toEqual(RED);
    expect(px(s, 141, 50).slice(0, 3)).toEqual(BLUE);
    // far corners: the mean of what was kept (half red, half blue)
    const far = px(s, 2, 2);
    expect(far.slice(0, 3)).toEqual(s.mean);
    expect(Math.abs(s.mean[0] - (RED[0] + BLUE[0]) / 2)).toBeLessThanOrEqual(2);
    expect(px(s, 197, 97).slice(0, 3)).toEqual(s.mean);
    // the carried colour stops at the reach: a pixel past it, level with the object's edge, is the mean not the edge colour
    const at = (d: number) => px(s, 60 - SKIN_ERODE_PX - d, 50).slice(0, 3);
    expect(at(1)).toEqual(RED);
    expect(at(SKIN_REACH_PX + 3)).toEqual(s.mean);
  });

  it("the outermost ring of the outline is not trusted: a background leak at the edge never reaches the item", () => {
    const a = art(100, 100, (x, y) => {
      if (x < 20 || x >= 80 || y < 20 || y >= 80) return null;
      const ring = x < 23 || x >= 77 || y < 23 || y >= 77; // 3 px of table inside the cut path
      return ring ? TAN : RED;
    });
    const s = householdSkin(a, 30, 30)!;
    expect(SKIN_ERODE_PX).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < s.w * s.h; i++) expect(Array.from(s.data.subarray(i * 4, i * 4 + 3))).toEqual(RED);
    expect(s.mean).toEqual(RED);
  });

  it("an object too thin to survive the erosion keeps its whole outline", () => {
    const a = art(100, 100, (x, y) => (x >= 47 && x < 53 && y >= 10 && y < 90 ? RED : null)); // 6 px wide
    const s = householdSkin(a, 5, 60)!;
    expect(s).not.toBeNull();
    expect(px(s, 50, 50).slice(0, 3)).toEqual(RED);
    expect(s.mean).toEqual(RED);
  });

  it("a pixel under half opaque is outside the outline", () => {
    const a = art(60, 60, (x, y) => (x >= 10 && x < 50 && y >= 10 && y < 50 ? RED : null));
    for (let i = 0; i < 60 * 60; i++) if (a.data[i * 4 + 3] === 255 && (i % 60) > 30) a.data[i * 4 + 3] = 127; // the right half is not the object
    const s = householdSkin(a, 20, 20)!;
    expect(s.coverage).toBeCloseTo((21 * 40) / 3600, 4); // columns 10 to 30
    for (let i = 0; i < 60 * 60; i++) expect(s.data[i * 4 + 3]).toBe(255);
  });

  it("a big enough object for the item, and nothing else, is a skin", () => {
    const tiny = art(100, 100, (x, y) => (x < 10 && y < 14 ? RED : null)); // 1.4% of the picture
    expect(SKIN_MIN_COVERAGE).toBe(0.02);
    expect(householdSkin(tiny, 10, 10)).toBeNull();
    const ok = art(100, 100, (x, y) => (x < 10 && y < 21 ? RED : null)); // 2.1%
    expect(householdSkin(ok, 10, 10)).not.toBeNull();
    expect(householdSkin(art(50, 50, () => null), 10, 10)).toBeNull();
  });

  it("refuses what is not a picture, or has no size", () => {
    const good = art(20, 20, () => RED);
    expect(householdSkin({ w: 0, h: 20, data: new Uint8ClampedArray(0) }, 10, 10)).toBeNull();
    expect(householdSkin({ w: 20, h: 20, data: new Uint8ClampedArray(20 * 20 * 4 - 4) }, 10, 10)).toBeNull();
    expect(householdSkin({ w: 2.5, h: 8, data: new Uint8ClampedArray(80) }, 10, 10)).toBeNull();
    expect(householdSkin(good, 0, 10)).toBeNull();
    expect(householdSkin(good, 10, -1)).toBeNull();
    expect(householdSkin(good, Number.NaN, 10)).toBeNull();
  });

  it("does not change the picture it was given", () => {
    const a = art(80, 80, (x, y) => (x >= 20 && x < 60 && y >= 20 && y < 60 ? RED : null));
    const before = Array.from(a.data);
    householdSkin(a, 10, 10);
    expect(Array.from(a.data)).toEqual(before);
  });

  it("skinDpi renders the longest side at SKIN_LONGEST_PX pixels", () => {
    expect(SKIN_LONGEST_PX).toBe(384);
    for (const [w, h] of [[16, 81], [81, 16], [52, 38], [90, 90]] as const) expect((Math.max(w, h) / 25.4) * skinDpi(w, h)).toBeCloseTo(SKIN_LONGEST_PX, 6);
    expect(skinDpi(0, 0)).toBe(100);
    expect(skinDpi(Number.NaN, 5)).toBe(100);
  });
});

// ---- the outline, as photographed ----------------------------------------------------------------------------------------------------

async function cupScan() {
  const c = await realCup();
  const k = 512 / 1920;
  const w = Math.round(c.raster.width * k);
  const h = Math.round(c.raster.height * k);
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = c.raster.data[Math.min(c.raster.height - 1, Math.floor((y + 0.5) / k)) * c.raster.width + Math.min(c.raster.width - 1, Math.floor((x + 0.5) / k))] ? 1 : 0;
  const out = scanOutline({ data, width: w, height: h } as never, { left: Math.round(c.bounds.left * k), top: Math.round(c.bounds.top * k) }, { width: 512, height: Math.round(1280 * k) }, { targetHeightMm: 54 });
  if (!out.ok) throw new Error("no outline");
  return out;
}
async function spoonScan() {
  const sp = await realSpoon();
  const out = scanOutline(sp.raster, sp.bounds, { width: 288, height: 512 }, { targetHeightMm: 54 });
  if (!out.ok) throw new Error("no outline");
  return out;
}
const area = (pts: readonly (readonly [number, number])[]) => Math.abs(pts.reduce((s, [x, z], i) => { const [nx, nz] = pts[(i + 1) % pts.length]!; return s + (x * nz - nx * z); }, 0)) / 2;
const bbox = (pts: readonly (readonly [number, number])[]) => ({ w: Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0])), h: Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1])) });

describe("uprightOutline and skinOutline", () => {
  it("the cup scan is turned (long axis up, so the mug lies on its side); the upright outline is the same object, as photographed", async () => {
    const scan = await cupScan();
    const up = uprightOutline(scan)!;
    expect(up).not.toBeNull();
    expect(scan.widthMm / scan.heightMm).toBeLessThan(1); // the scan: tall
    expect(up.widthMm / up.heightMm).toBeGreaterThan(1); // as photographed: a mug is wider than it is tall
    // the same photo pixels, point for point
    const a = invertAffine(scan.photoToPlate)!;
    const b = invertAffine(up.photoToPlate)!;
    scan.points.forEach(([x, z], i) => {
      const [p1x, p1y] = applyAffine(a, x, z);
      const [p2x, p2y] = applyAffine(b, up.points[i]![0], up.points[i]![1]);
      expect(p2x).toBeCloseTo(p1x, 6);
      expect(p2y).toBeCloseTo(p1y, 6);
    });
    // the same size in millimetres
    expect(area(up.points)).toBeCloseTo(area(scan.points), 4);
    expect(Math.hypot(up.photoToPlate[0], up.photoToPlate[1])).toBeCloseTo(Math.hypot(scan.photoToPlate[0], scan.photoToPlate[1]), 9);
    expect(up.photoToPlate[1]).toBe(0);
    expect(up.photoToPlate[2]).toBe(0);
    expect(up.photoToPlate[3]).toBe(-up.photoToPlate[0]);
    expect(bbox(up.points).w).toBeCloseTo(up.widthMm, 9);
    expect(bbox(up.points).h).toBeCloseTo(up.heightMm, 9);
    expect(up.rowShift).toBeUndefined();
    expect(up.fidelity).toBe(scan.fidelity);
    expect(up.photoSize).toEqual(scan.photoSize);
  });

  it("the symmetric row slide, which belongs to the scan's turned frame, is dropped", async () => {
    const scan = await cupScan();
    const withSlide = { ...scan, rowShift: [[0, 0.5], [10, 1.5], [20, 0.5]] as [number, number][] };
    expect(uprightOutline(withSlide)!.rowShift).toBeUndefined();
    expect(skinOutline(withSlide, 1.3).rowShift).toBeUndefined();
  });

  it("an object photographed upright (a spoon) is the same either way", async () => {
    const scan = await spoonScan();
    const up = uprightOutline(scan)!;
    expect(up.widthMm).toBeCloseTo(scan.widthMm, 0);
    expect(up.heightMm).toBeCloseTo(scan.heightMm, 0);
  });

  it("an unusable photo map gives null, and the scan's own outline is used", async () => {
    const scan = await spoonScan();
    const bad = { ...scan, photoToPlate: [0, 0, 0, 0, 0, 0] as never };
    expect(uprightOutline(bad)).toBeNull();
    expect(skinOutline(bad, 1.4)).toBe(bad);
  });

  it("skinOutline: upright unless the turned frame fits the item's front clearly better", async () => {
    const scan = await cupScan();
    const up = uprightOutline(scan)!;
    const upAspect = up.widthMm / up.heightMm; // about 1.3: a mug
    const turnedAspect = scan.widthMm / scan.heightMm; // about 0.76
    expect(skinOutline(scan, upAspect)).toStrictEqual(up); // a mug item: as photographed
    expect(skinOutline(scan, turnedAspect)).toBe(scan); // an item that is as tall as the turned cup is: turned
    expect(skinOutline(scan, 1)).toStrictEqual(up); // a ball: a tie (within 5%) goes to upright
    expect(skinOutline(scan)).toStrictEqual(up);
    for (const bad of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) expect(skinOutline(scan, bad), String(bad)).toStrictEqual(up);
  });

  it("skinStickerItem is the cut path of that outline, as big as the object", async () => {
    const scan = await cupScan();
    const item = skinStickerItem(uprightOutline(scan)!);
    expect(item.kind).toBe("photo_accessory");
    expect(item.id).toBe("library_skin");
    expect(item.w).toBeGreaterThan(0);
    expect(Math.abs(item.w - uprightOutline(scan)!.widthMm)).toBeLessThan(1.5);
    expect(Math.abs(item.h - uprightOutline(scan)!.heightMm)).toBeLessThan(1.5);
    expect(item.w).toBeGreaterThan(item.h);
  });

  it("the whole pure chain: the photo's red object comes out as a red skin with the object's proportions", async () => {
    const scan = await cupScan();
    const photo = { w: 512, h: 341, data: new Uint8ClampedArray(512 * 341 * 4) };
    for (let i = 0; i < 512 * 341; i++) photo.data.set([196, 152, 104, 255], i * 4); // a table
    // paint every pixel inside the outline red, using the same polygon test the sticker module uses on its own item
    const upItem = skinStickerItem(uprightOutline(scan)!);
    const back = invertAffine(upItem.sampler.photoToSticker)!;
    const poly = upItem.outerPolyMm;
    const inside = (x: number, y: number) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i]!; const [xj, yj] = poly[j]!; if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
    const toPhoto = (X: number, Y: number) => applyAffine(back, X, Y);
    void toPhoto;
    for (let y = 0; y < 341; y++) for (let x = 0; x < 512; x++) {
      const [X, Y] = applyAffine(upItem.sampler.photoToSticker, x + 0.5, y + 0.5);
      if (inside(X, Y)) photo.data.set([205, 34, 46, 255], (y * 512 + x) * 4);
    }
    const plan = ST.planStickerSheet([{ kind: "photo_accessory", item: upItem, spare: false }], {});
    const it = plan.items[0];
    const rendered = ST.renderStickerItemRgba(it, { [it.sampler.sourceKey]: photo }, skinDpi(it.w, it.h), 0);
    const skin = householdSkin({ w: rendered.w, h: rendered.h, data: rendered.data }, it.w, it.h)!;
    expect(skin).not.toBeNull();
    expect(Math.max(skin.w, skin.h)).toBeGreaterThanOrEqual(SKIN_LONGEST_PX - 1);
    expect(Math.max(skin.w, skin.h)).toBeLessThanOrEqual(SKIN_LONGEST_PX + 1);
    expect(skin.w / skin.h).toBeCloseTo(it.w / it.h, 1);
    expect(skin.coverage).toBeGreaterThan(0.5);
    // every pixel of the skin is the object's red, none is the table's tan
    const tan = Array.from({ length: skin.w * skin.h }, (_, i) => skin.data[i * 4]! === 196 && skin.data[i * 4 + 1]! === 152).filter(Boolean).length;
    expect(tan).toBe(0);
    expect(Math.abs(skin.mean[0] - 205)).toBeLessThanOrEqual(2);
    expect(Math.abs(skin.mean[1] - 34)).toBeLessThanOrEqual(2);
  });
});

// ---- on the item ---------------------------------------------------------------------------------------------------------------

describe("householdFrontWeight", () => {
  const [a, b] = HOUSEHOLD_FRONT_FADE as [number, number];
  it("none at or past the first end, all of it at or beyond the second, smooth between", () => {
    expect(a).toBeCloseTo(0.25);
    expect(b).toBeCloseTo(0.8);
    for (const c of [-1, -0.5, 0, 0.1, 0.25]) expect(householdFrontWeight(c), String(c)).toBe(0);
    for (const c of [0.8, 0.9, 1]) expect(householdFrontWeight(c), String(c)).toBe(1);
    expect(householdFrontWeight((a + b) / 2)).toBeCloseTo(0.5, 9);
    let last = -1;
    for (let c = -1; c <= 1; c += 0.01) {
      const w = householdFrontWeight(c);
      expect(w).toBeGreaterThanOrEqual(last - 1e-12);
      last = w;
    }
    // smoothstep: flat at both ends (no kink where it starts or stops)
    expect(householdFrontWeight(a + 1e-3)).toBeLessThan(1e-4);
    expect(1 - householdFrontWeight(b - 1e-3)).toBeLessThan(1e-4);
  });
  it("is 75 degrees to 37 degrees, as written", () => {
    expect((Math.acos(a) * 180) / Math.PI).toBeCloseTo(75.5, 0);
    expect((Math.acos(b) * 180) / Math.PI).toBeCloseTo(36.9, 0);
  });
  it("something that is not a cosine shows none of the photo", () => {
    for (const bad of [Number.NaN, undefined, null, "0.9", Number.POSITIVE_INFINITY, {}]) expect(householdFrontWeight(bad as never), String(bad)).toBe(0);
  });
  it("takes its own fade", () => {
    expect(householdFrontWeight(0.5, [0, 1])).toBeCloseTo(0.5);
    expect(householdFrontWeight(0.5, [0.5, 0.6])).toBe(0);
  });
});

describe("householdPhotoUv", () => {
  const box = { minX: -10, maxX: 30, minY: 0, maxY: 80 };
  it("lays the object's box over the item's front box: top left of the picture at the top, and the picture not mirrored seen from the front", () => {
    // seen from the front glTF -x is on the viewer's RIGHT, so the picture's left (u = 0) is at the largest x
    expect(householdPhotoUv(30, 80, box)).toEqual([0, 0]);
    expect(householdPhotoUv(-10, 0, box)).toEqual([1, 1]);
    expect(householdPhotoUv(10, 40, box)).toEqual([0.5, 0.5]);
    expect(householdPhotoUv(-10, 80, box)).toEqual([1, 0]);
    expect(householdPhotoUv(30, 0, box)).toEqual([0, 1]);
  });
  it("goes into the part of the picture the object occupies", () => {
    const rect = { u0: 0.1, v0: 0.2, u1: 0.9, v1: 0.6 };
    const [u0, v0] = householdPhotoUv(30, 80, box, 1, "fit", rect);
    const [u1, v1] = householdPhotoUv(-10, 0, box, 1, "fit", rect);
    expect([u0, v0, u1, v1].map((v) => +v.toFixed(9))).toEqual([0.1, 0.2, 0.9, 0.6]);
  });
  it("contain keeps the object's proportions: a narrow object takes a middle strip of a wide box, a wide one a middle band of a tall box", () => {
    // box 40 wide x 80 tall (0.5); object 0.25 wide-over-tall: narrower, so it takes half the width
    expect(householdPhotoUv(30, 40, box, 0.25, "contain")[0]).toBeCloseTo(0.5 + (0 - 0.5) * 2, 9); // the box's left edge is past the picture's edge
    expect(householdPhotoUv(10, 40, box, 0.25, "contain")).toEqual([0.5, 0.5]);
    const wide = { minX: 0, maxX: 80, minY: 0, maxY: 40 }; // 2.0
    const v = householdPhotoUv(40, 40, wide, 1, "contain"); // object 1.0: the box is twice as wide as the object, the object fills the height
    expect(v[1]).toBe(0);
    expect(householdPhotoUv(0, 20, wide, 1, "contain")[0]).toBeCloseTo(0.5 + 0.5 * 2, 9);
    // with the same proportions contain is fit
    expect(householdPhotoUv(5, 70, box, 0.5, "contain")).toEqual(householdPhotoUv(5, 70, box, 0.5, "fit"));
  });
  it("a flat box (no width or no height) gives the middle, not NaN", () => {
    for (const flat of [{ minX: 3, maxX: 3, minY: 0, maxY: 1 }, { minX: 0, maxX: 1, minY: 5, maxY: 5 }]) {
      const uv = householdPhotoUv(3, 5, flat, 1, "contain");
      expect(uv.every(Number.isFinite)).toBe(true);
    }
    expect(householdPhotoUv(3, 5, { minX: 3, maxX: 3, minY: 0, maxY: 1 })[0]).toBe(0.5);
  });
});

describe("householdSkinMode", () => {
  it("fit while the shapes are alike, contain when stretching would distort the photo more than 1.6 times", () => {
    expect(HOUSEHOLD_FIT_MAX_MISMATCH).toBe(1.6);
    expect(householdSkinMode(1.4, 1.3)).toBe("fit");
    expect(householdSkinMode(1.0, 1.6)).toBe("fit");
    expect(householdSkinMode(1.0, 1.61)).toBe("contain");
    expect(householdSkinMode(1.61, 1.0)).toBe("contain");
    expect(householdSkinMode(1.4, 0.2)).toBe("contain"); // a spoon photo on a mug
    expect(householdSkinMode(0, 1)).toBe("fit");
    expect(householdSkinMode(1, Number.NaN)).toBe("fit");
  });
});

describe("patchSkinShader", () => {
  const shader = () => ({
    uniforms: {} as Record<string, unknown>,
    vertexShader: "#include <common>\nvoid main(){\n#include <begin_vertex>\n}",
    fragmentShader: "#include <common>\nvoid main(){ vec4 diffuseColor = vec4(1.0);\n#include <color_fragment>\n}",
  });
  it("adds the skin's attributes, varyings and uniforms, and mixes the skin over the zone colour by weight and by the switch", () => {
    const sh = shader();
    const map = { map: true };
    const mix = { value: 1 };
    patchSkinShader(sh, map, mix);
    expect(sh.uniforms.skinMap).toEqual({ value: map });
    expect(sh.uniforms.skinMix).toBe(mix); // the same object: changing its value changes every material at once
    expect(sh.vertexShader).toMatch(/attribute vec2 skinUv;/);
    expect(sh.vertexShader).toMatch(/attribute float skinW;/);
    expect(sh.vertexShader).toMatch(/vSkinUv = skinUv;/);
    expect(sh.fragmentShader).toMatch(/uniform sampler2D skinMap;/);
    expect(sh.fragmentShader).toMatch(/uniform float skinMix;/);
    expect(sh.fragmentShader).toMatch(/diffuseColor\.rgb = mix\(diffuseColor\.rgb, texture2D\(skinMap, vSkinUv\)\.rgb, clamp\(vSkinW, 0\.0, 1\.0\) \* skinMix\);/);
    // the original chunks are still there, once each
    expect(sh.vertexShader.match(/#include <begin_vertex>/g)).toHaveLength(1);
    expect(sh.fragmentShader.match(/#include <color_fragment>/g)).toHaveLength(1);
    // the mix comes after the material's own colour, never before it
    expect(sh.fragmentShader.indexOf("#include <color_fragment>")).toBeLessThan(sh.fragmentShader.indexOf("diffuseColor.rgb = mix("));
  });
});

async function loadScene(file: string): Promise<THREE.Group> {
  const buf = readFileSync(join(ROOT, "public/kip/household", file));
  return (await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, "")).scene;
}
const SKIN = (): { w: number; h: number; widthMm: number; heightMm: number; data: Uint8ClampedArray } => {
  const data = new Uint8ClampedArray(4 * 4 * 4);
  for (let i = 0; i < 16; i++) data.set([i * 15, 255 - i * 15, 90, 255], i * 4);
  return { w: 4, h: 4, widthMm: 40, heightMm: 40, data };
};

describe("applyHouseholdSkin on the real library items", () => {
  it.each(built.map((i) => [i.id, i] as const))("%s: UVs inside the picture, weights from the normals, the back and sides untouched, the front shown", async (_id, item) => {
    const scene = await loadScene(item.glb!);
    const hand = buildHouseholdHandMesh(THREE, scene, { id: item.id, label: item.label });
    const ctl = applyHouseholdSkin(THREE, hand, SKIN(), { mode: "fit" });
    expect(ctl).not.toBeNull();
    let n = 0;
    let front = 0;
    let bad = 0;
    const itemRoot = hand.userData.itemRoot as THREE.Object3D;
    itemRoot.updateMatrixWorld(true);
    itemRoot.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const g = m.geometry;
      const W = g.attributes.skinW!;
      const UV = g.attributes.skinUv!;
      const N = g.attributes.normal!;
      expect(W.count).toBe(g.attributes.position!.count);
      expect(UV.count).toBe(W.count);
      // item-local normal (the GLB's frame): the node transform of a mesh is a pure scale or none, so its z sign is the front's
      const toItem = new THREE.Matrix4().multiplyMatrices(new THREE.Matrix4().copy(itemRoot.matrixWorld).invert(), m.matrixWorld);
      const rot = new THREE.Matrix3().setFromMatrix4(toItem);
      for (let i = 0; i < W.count; i++) {
        const nz = new THREE.Vector3().fromBufferAttribute(N, i).applyMatrix3(rot).normalize().z;
        const cosFront = -nz;
        const w = W.getX(i);
        n++;
        if (cosFront <= 0.25 && w !== 0) bad++;
        if (cosFront >= 0.8 && Math.abs(w - 1) > 1e-6) bad++;
        if (cosFront > 0.25 && cosFront < 0.8 && !(w > 0 && w < 1)) bad++;
        if (UV.getX(i) < -1e-6 || UV.getX(i) > 1 + 1e-6 || UV.getY(i) < -1e-6 || UV.getY(i) > 1 + 1e-6) bad++;
        if (w > 0) front++;
      }
    });
    expect(n).toBeGreaterThan(0);
    expect(bad).toBe(0);
    expect(front).toBeGreaterThan(0); // something faces the front
    expect(front).toBeLessThan(n); // and something does not
    expect(ctl.mode).toBe("fit");
  });

  it("is applied to a copy: the loaded scene's geometry and materials are left alone", async () => {
    const item = rawBuilt.find((i) => i.zones.length > 1) ?? rawBuilt[0]!;
    const scene = await loadScene(item.glb);
    const meshes = (o: THREE.Object3D) => { const out: THREE.Mesh[] = []; o.traverse((x) => { if ((x as THREE.Mesh).isMesh) out.push(x as THREE.Mesh); }); return out; };
    const before = meshes(scene).map((m) => ({ g: m.geometry, mat: m.material, hadW: Boolean(m.geometry.attributes.skinW) }));
    const hand = buildHouseholdHandMesh(THREE, scene, {});
    applyHouseholdSkin(THREE, hand, SKIN());
    meshes(scene).forEach((m, i) => {
      expect(m.geometry).toBe(before[i]!.g);
      expect(m.material).toBe(before[i]!.mat);
      expect(m.geometry.attributes.skinW).toBeUndefined();
      expect(m.geometry.attributes.skinUv).toBeUndefined();
      expect((Array.isArray(m.material) ? m.material : [m.material]).every((x) => !(x as THREE.Material).onBeforeCompile.toString().includes("patchSkinShader"))).toBe(true);
    });
    const originals = new Set(before.flatMap((b) => (Array.isArray(b.mat) ? b.mat : [b.mat])));
    meshes(hand.userData.itemRoot).forEach((m) => {
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) expect(originals.has(mat), "the hand's material is a copy").toBe(false);
    });
    // and the copy's materials are the patched ones, one per zone, each keeping its own colour
    const handMeshes = meshes(hand.userData.itemRoot);
    const zoneHex = new Set(item.zones.map((z) => z.hex.toUpperCase()));
    const seen = new Set<string>();
    for (const m of handMeshes) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      expect(mat.onBeforeCompile.toString()).toContain("patchSkinShader");
      seen.add(`#${(mat as THREE.MeshStandardMaterial).color.getHexString(THREE.SRGBColorSpace).toUpperCase()}`);
    }
    for (const hex of zoneHex) expect(seen.has(hex), hex).toBe(true);
  });

  it("the way back: setLook('standard') switches the photo off for every material at once, and 'photo' back on", async () => {
    const item = rawBuilt.find((i) => i.zones.length > 1) ?? rawBuilt[0]!;
    const hand = buildHouseholdHandMesh(THREE, await loadScene(item.glb), {});
    const ctl = applyHouseholdSkin(THREE, hand, SKIN());
    expect(ctl.look()).toBe("photo");
    const uniforms: { value: number }[] = [];
    hand.userData.itemRoot.traverse((o: THREE.Object3D) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        const sh = { uniforms: {} as Record<string, { value: number }>, vertexShader: "#include <common>#include <begin_vertex>", fragmentShader: "#include <common>#include <color_fragment>" };
        (mat as THREE.Material).onBeforeCompile(sh as never, null as never);
        uniforms.push(sh.uniforms.skinMix!);
      }
    });
    expect(uniforms.length).toBeGreaterThan(0);
    expect(new Set(uniforms).size).toBe(1); // one switch for all of them
    expect(uniforms[0]!.value).toBe(1);
    ctl.setLook("standard");
    expect(ctl.look()).toBe("standard");
    expect(uniforms.every((u) => u.value === 0)).toBe(true);
    ctl.setLook("photo");
    expect(ctl.look()).toBe("photo");
    expect(uniforms.every((u) => u.value === 1)).toBe(true);
    ctl.setLook("anything else"); // not 'standard': the photo
    expect(ctl.look()).toBe("photo");
  });

  it("the texture is the skin: size, colours in sRGB, rows top down, edge clamped, mipmapped", async () => {
    const hand = buildHouseholdHandMesh(THREE, await loadScene(built[0]!.glb!), {});
    const skin = SKIN();
    applyHouseholdSkin(THREE, hand, skin);
    const mat = (() => { let found: THREE.Material | null = null; hand.userData.itemRoot.traverse((o: THREE.Object3D) => { const m = o as THREE.Mesh; if (m.isMesh && !found) found = Array.isArray(m.material) ? m.material[0]! : m.material; }); return found!; })();
    const sh = { uniforms: {} as Record<string, { value: THREE.DataTexture }>, vertexShader: "#include <common>#include <begin_vertex>", fragmentShader: "#include <common>#include <color_fragment>" };
    mat.onBeforeCompile(sh as never, null as never);
    const tex = sh.uniforms.skinMap!.value;
    expect(tex.image.width).toBe(4);
    expect(tex.image.height).toBe(4);
    expect(Array.from(tex.image.data as Uint8Array)).toEqual(Array.from(skin.data));
    expect(tex.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(tex.flipY).toBe(false);
    expect(tex.wrapS).toBe(THREE.ClampToEdgeWrapping);
    expect(tex.wrapT).toBe(THREE.ClampToEdgeWrapping);
    expect(tex.generateMipmaps).toBe(true);
  });

  it("refuses a skin that is not a picture, or has no size, or an item that is not a hand mesh", async () => {
    const hand = buildHouseholdHandMesh(THREE, await loadScene(built[0]!.glb!), {});
    const good = SKIN();
    for (const bad of [null, undefined, { ...good, w: 0 }, { ...good, data: new Uint8ClampedArray(60) }, { ...good, widthMm: 0 }, { ...good, heightMm: -1 }, { ...good, w: 1.5 }]) expect(applyHouseholdSkin(THREE, hand, bad as never), JSON.stringify(bad)?.slice(0, 40)).toBeNull();
    expect(applyHouseholdSkin(THREE, new THREE.Group(), good)).toBeNull();
    expect(applyHouseholdSkin(THREE, null as never, good)).toBeNull();
    // and nothing was touched by the refusals
    let touched = false;
    hand.userData.itemRoot.traverse((o: THREE.Object3D) => { const m = o as THREE.Mesh; if (m.isMesh && m.geometry.attributes.skinW) touched = true; });
    expect(touched).toBe(false);
  });

  it("mode is fit for alike shapes, contain for a narrow photo on a wide item, and can be forced", async () => {
    const mug = built.find((i) => i.id === "mug") ?? built[0]!;
    const mk = async () => buildHouseholdHandMesh(THREE, await loadScene(mug.glb!), {});
    const narrow = { ...SKIN(), widthMm: 10, heightMm: 80 };
    expect(applyHouseholdSkin(THREE, await mk(), narrow).mode).toBe("contain");
    expect(applyHouseholdSkin(THREE, await mk(), { ...SKIN(), widthMm: 52, heightMm: 38 }).mode).toBe("fit");
    expect(applyHouseholdSkin(THREE, await mk(), narrow, { mode: "fit" }).mode).toBe("fit");
    expect(applyHouseholdSkin(THREE, await mk(), SKIN(), { mode: "contain" }).mode).toBe("contain");
    expect(applyHouseholdSkin(THREE, await mk(), narrow, { mode: "sideways" }).mode).toBe("contain"); // not a mode: decided from the shapes
  });
});

describe("applyHouseholdSkin on a hand-made scene (what the real assets cannot show)", () => {
  /** Two meshes at different places, the first turned half a turn about y by its own node: its raw normals are not the item's. */
  function scene() {
    const g = new THREE.Group();
    const a = new THREE.Mesh(new THREE.SphereGeometry(0.01, 16, 12), new THREE.MeshStandardMaterial({ color: 0xff0000 }));
    a.position.set(-0.03, 0.02, 0);
    a.rotation.y = Math.PI;
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.02), new THREE.MeshStandardMaterial({ color: 0x00ff00 }));
    b.position.set(0.03, 0.05, 0);
    g.add(a, b);
    return { g, a, b };
  }
  it("the weights follow the item's frame, not each mesh's own: a mesh turned by its node has its front where it really is", () => {
    const { g, a } = scene();
    const hand = buildHouseholdHandMesh(THREE, g, {});
    applyHouseholdSkin(THREE, hand, SKIN(), { mode: "fit" });
    const mesh = hand.userData.itemRoot.children.find((c: THREE.Object3D) => (c as THREE.Mesh).isMesh && c.position.x < 0) as THREE.Mesh;
    expect(mesh).toBeDefined();
    const N = mesh.geometry.attributes.normal!;
    const W = mesh.geometry.attributes.skinW!;
    let frontOfItem = 0;
    let frontOfMesh = 0;
    for (let i = 0; i < W.count; i++) {
      const rawZ = N.getZ(i); // the sphere's own normal: the item's -z face is the mesh's +z face, because the node turned it
      if (rawZ > 0.95) { expect(W.getX(i), "raw +z is the item's front").toBe(1); frontOfItem++; }
      if (rawZ < -0.95) { expect(W.getX(i), "raw -z is the item's back").toBe(0); frontOfMesh++; }
    }
    expect(frontOfItem).toBeGreaterThan(0);
    expect(frontOfMesh).toBeGreaterThan(0);
    void a;
  });
  it("the box that holds the photo is that of all the meshes together: every UV of every mesh is inside the picture", () => {
    const { g } = scene();
    const hand = buildHouseholdHandMesh(THREE, g, {});
    const ctl = applyHouseholdSkin(THREE, hand, SKIN(), { mode: "fit" });
    expect(ctl.vertices.uvs).toHaveLength(2);
    for (const uv of ctl.vertices.uvs as Float32Array[]) for (const v of uv) { expect(v).toBeGreaterThanOrEqual(-1e-6); expect(v).toBeLessThanOrEqual(1 + 1e-6); }
    // the left mesh reaches the right edge of the picture (u = 1: glTF -x is the viewer's right) and the other mesh reaches the left edge
    const us = (ctl.vertices.uvs as Float32Array[]).map((uv) => Array.from({ length: uv.length / 2 }, (_, i) => uv[i * 2]!));
    expect(Math.max(...us[0]!)).toBeCloseTo(1, 5);
    expect(Math.min(...us[1]!)).toBeCloseTo(0, 5);
  });
  it("every material has the one switch: the way back reaches all of them", () => {
    const { g } = scene();
    const hand = buildHouseholdHandMesh(THREE, g, {});
    const ctl = applyHouseholdSkin(THREE, hand, SKIN());
    const mixes: { value: number }[] = [];
    hand.userData.itemRoot.traverse((o: THREE.Object3D) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const sh = { uniforms: {} as Record<string, { value: number }>, vertexShader: "#include <common>#include <begin_vertex>", fragmentShader: "#include <common>#include <color_fragment>" };
      (m.material as THREE.Material).onBeforeCompile(sh as never, null as never);
      mixes.push(sh.uniforms.skinMix!);
    });
    expect(mixes).toHaveLength(2);
    ctl.setLook("standard");
    expect(mixes.map((x) => x.value)).toEqual([0, 0]);
  });
});

describe("a print stays single-colour", () => {
  it("nothing in the print pack, the print view or the sticker sheet reads a skin or a household item", () => {
    for (const f of ["kip-print-bom.js", "kip-print-view.js", "kip-print.js", "kip-print-sprue.js", "kip-print-profile.js"]) {
      const src = readFileSync(join(ROOT, "parts/kip/viewer", f), "utf8");
      expect(src, f).not.toMatch(/householdSkin|skinUv|skinW|applyHouseholdSkin|householdSlots|householdView/);
    }
  });
});
