import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  parseScanOutline,
  parseScanOutlineRequest,
  KEEP_PARTS_FILLETS,
  SCAN_OUTLINE_MAX_PIXELS,
  scanOutline,
  type ScanOutline,
  type ScanOutlineSuccess,
} from "../shared/outlineScan";
import { applyAffine, legalizeOutline } from "../shared/photoOutline";
import { cropToObject, type Cropped, disc, rect, type Raster, rasterize, rotated, star, union } from "./fixtures/outlineMasks";
import { realCup, realSpoon, SPOON_PHOTO } from "./fixtures/realCupMask";

// The legalizer takes 0.1 to 0.9 s a call and the machine is often at load 50 or more.
vi.setConfig({ testTimeout: 60_000 });

// ---- helpers: a photo with the object somewhere in it, cropped the way the model sends it --------------------------

/** Independent of the code under test: ray casting. */
function inside(poly: readonly (readonly [number, number])[], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]!;
    const [xj, zj] = poly[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

/** Overlap of the outline with the object in PHOTO pixels: every pixel of the uploaded image goes through `photoToPlate`. */
function photoIoU(o: ScanOutlineSuccess, photo: Raster, step = 2): number {
  let inter = 0, union_ = 0;
  for (let y = 0; y < photo.height; y += step)
    for (let x = 0; x < photo.width; x += step) {
      const [px, pz] = applyAffine(o.photoToPlate, x, y);
      const a = inside(o.points, px, pz);
      const b = photo.data[y * photo.width + x] !== 0;
      if (a && b) inter++;
      if (a || b) union_++;
    }
  return union_ === 0 ? 0 : inter / union_;
}

function ok(r: ScanOutline): ScanOutlineSuccess {
  if (!r.ok) throw new Error(`expected an outline, got ${r.reason}: ${r.detail}`);
  return r;
}

const PHOTO_W = 640;
const PHOTO_H = 480;
const inPhoto = (shape: Parameters<typeof rasterize>[2]): Cropped => cropToObject(rasterize(PHOTO_W, PHOTO_H, shape));
const PHOTO = { width: PHOTO_W, height: PHOTO_H };

// ---- the request --------------------------------------------------------------------------------------------------

describe("parseScanOutlineRequest", () => {
  it("takes an empty request, and every field on its own", () => {
    expect(parseScanOutlineRequest({})).toEqual({ ok: true, request: {} });
    expect(parseScanOutlineRequest({ targetHeightMm: 33 })).toEqual({ ok: true, request: { targetHeightMm: 33 } });
    expect(parseScanOutlineRequest({ orient: "as-photographed" })).toEqual({ ok: true, request: { orient: "as-photographed" } });
    expect(parseScanOutlineRequest({ flip: true })).toEqual({ ok: true, request: { flip: true } });
  });

  it("takes the ends of the height range and nothing past them", () => {
    expect(parseScanOutlineRequest({ targetHeightMm: 8 }).ok).toBe(true);
    expect(parseScanOutlineRequest({ targetHeightMm: 90 }).ok).toBe(true);
    expect(parseScanOutlineRequest({ targetHeightMm: 7.99 }).ok).toBe(false);
    expect(parseScanOutlineRequest({ targetHeightMm: 90.01 }).ok).toBe(false);
  });

  it.each([
    ["not an object", "yes"],
    ["null", null],
    ["an array", [1]],
    ["a string height", { targetHeightMm: "54" }],
    ["NaN height", { targetHeightMm: Number.NaN }],
    ["Infinity height", { targetHeightMm: Number.POSITIVE_INFINITY }],
    ["an unknown orient", { orient: "sideways" }],
    ["a numeric flip", { flip: 1 }],
  ])("refuses %s", (_name, raw) => {
    expect(parseScanOutlineRequest(raw).ok).toBe(false);
  });

  it("drops keys it does not know instead of passing them on", () => {
    const r = parseScanOutlineRequest({ targetHeightMm: 40, fillet_r_mm: 4, keepThinParts: false, maxPoints: 3 });
    expect(r).toEqual({ ok: true, request: { targetHeightMm: 40 } });
  });
});

// ---- scanOutline: the photo map is in photo pixels ----------------------------------------------------------------

describe("scanOutline", () => {
  it("is what the legalizer makes, with the photo map moved from mask pixels to photo pixels", () => {
    const c = inPhoto(disc(400, 200, 90));
    expect(c.bounds.left).toBeGreaterThan(100); // guard: the object is not at the corner, so the shift matters
    expect(c.bounds.top).toBeGreaterThan(50);
    const o = ok(scanOutline(c.raster, c.bounds, PHOTO, { targetHeightMm: 54 }));
    const direct = legalizeOutline(c.raster, { targetHeightMm: 54, keepThinParts: true });
    if (!direct.ok) throw new Error("legalize failed");
    expect(o.points).toEqual(direct.points);
    expect(o.heightMm).toBe(direct.heightMm);
    expect(o.photoSize).toEqual(PHOTO);
    // The pixel at the mask's top-left corner is the photo pixel at the bounds.
    const same = (a: [number, number], b: [number, number]) => {
      expect(a[0]).toBeCloseTo(b[0], 9);
      expect(a[1]).toBeCloseTo(b[1], 9);
    };
    same(applyAffine(o.photoToPlate, c.bounds.left, c.bounds.top), applyAffine(direct.photoToPlate, 0, 0));
    same(applyAffine(o.photoToPlate, c.bounds.left + 7, c.bounds.top + 3), applyAffine(direct.photoToPlate, 7, 3));
  });

  const cases: [string, () => Cropped, { targetHeightMm?: number; flip?: boolean; orient?: "as-photographed" }][] = [
    ["a disc", () => inPhoto(disc(400, 200, 90)), { targetHeightMm: 54 }],
    ["a lollipop on its side", () => inPhoto(rotated(union(disc(300, 240, 80), rect(380, 225, 560, 255)), 400, 240, 25)), { targetHeightMm: 60 }],
    ["a star, flipped", () => inPhoto(star(320, 240, 160, 70)), { targetHeightMm: 54, flip: true }],
    ["a lollipop, as photographed", () => inPhoto(union(disc(500, 120, 70), rect(485, 180, 515, 400))), { targetHeightMm: 40, orient: "as-photographed" }],
    ["a small object in a corner", () => inPhoto(disc(40, 40, 30)), { targetHeightMm: 33 }],
  ];
  it.each(cases)("%s: the outline carried back through the photo map lies on the object (IoU above 0.95)", (_name, make, req) => {
    const c = make();
    const o = ok(scanOutline(c.raster, c.bounds, PHOTO, req));
    expect(photoIoU(o, c.photo)).toBeGreaterThan(0.95);
  });

  it("a map that forgot the bounds would fail that check (canary)", () => {
    const c = inPhoto(disc(400, 200, 90));
    const o = ok(scanOutline(c.raster, c.bounds, PHOTO, { targetHeightMm: 54 }));
    const direct = legalizeOutline(c.raster, { targetHeightMm: 54, keepThinParts: true });
    if (!direct.ok) throw new Error("legalize failed");
    expect(photoIoU(o, c.photo)).toBeGreaterThan(0.95);
    expect(photoIoU({ ...o, photoToPlate: direct.photoToPlate }, c.photo)).toBeLessThan(0.5);
  });

  it("applies the height, the orientation and the flip it is asked for", () => {
    const c = inPhoto(union(disc(320, 120, 80), rect(305, 190, 335, 420)));
    const tall = ok(scanOutline(c.raster, c.bounds, PHOTO, { targetHeightMm: 80 }));
    const short = ok(scanOutline(c.raster, c.bounds, PHOTO, { targetHeightMm: 40 }));
    expect(tall.heightMm).toBeGreaterThan(short.heightMm * 1.5);
    const plain = ok(scanOutline(c.raster, c.bounds, PHOTO, { targetHeightMm: 54 }));
    const flipped = ok(scanOutline(c.raster, c.bounds, PHOTO, { targetHeightMm: 54, flip: true }));
    expect(plain.orientation.flipped).toBe(false);
    expect(flipped.orientation.flipped).toBe(true);
    expect(flipped.points).not.toEqual(plain.points);
    const as = ok(scanOutline(c.raster, c.bounds, PHOTO, { targetHeightMm: 54, orient: "as-photographed" }));
    expect(as.orientation.reason).toBe("as-photographed");
  });

  it("keeps a thin part by growing: a paddle asked for 24 mm keeps its stick, where the plain legalizer removes it", () => {
    const c = cropToObject(rasterize(PHOTO_W, PHOTO_H, union(disc(320, 120, 90), rect(305, 200, 335, 400))));
    const plain = legalizeOutline(c.raster, { targetHeightMm: 24 });
    if (!plain.ok) throw new Error("legalize failed");
    expect(plain.warnings).toContain("THIN_PARTS_REMOVED"); // guard: this is the case keepThinParts exists for
    const o = ok(scanOutline(c.raster, c.bounds, PHOTO, { targetHeightMm: 24 }));
    expect(o.warnings).not.toContain("THIN_PARTS_REMOVED");
    expect(o.heightMm).toBeGreaterThan(24);
  });

  it("passes a legalizer refusal through as it is: a blade too thin even at the full 90 mm", () => {
    const c = inPhoto(rect(318, 40, 321, 440)); // 4 px wide, 401 tall: 0.9 mm wide at 90 mm, under the 3.2 mm minimum
    const r = scanOutline(c.raster, c.bounds, PHOTO, { targetHeightMm: 90 });
    expect(r).toMatchObject({ ok: false, reason: "too_thin" });
    const empty = scanOutline({ data: new Uint8Array(100), width: 10, height: 10 }, { left: 0, top: 0 }, PHOTO);
    expect(empty).toMatchObject({ ok: false, reason: "empty_mask" });
  });

  it("grows a blade that is thin at the asked size instead of refusing it", () => {
    const c = inPhoto(rect(310, 40, 330, 440)); // 21 px wide, 401 tall: 1.3 mm wide at 24 mm
    const o = ok(scanOutline(c.raster, c.bounds, PHOTO, { targetHeightMm: 24 }));
    expect(o.heightMm).toBeGreaterThan(24 * 1.5);
    expect(o.widthMm).toBeGreaterThanOrEqual(3.2);
  });

  it("refuses a mask over the pixel limit without running the legalizer", () => {
    const big = { data: new Uint8Array(0), width: 2100, height: 2000 };
    expect(big.width * big.height).toBeGreaterThan(SCAN_OUTLINE_MAX_PIXELS);
    const r = scanOutline(big, { left: 0, top: 0 }, PHOTO);
    expect(r).toMatchObject({ ok: false, reason: "bad_mask" });
    // One just under the limit, and one exactly at it, are let in to the legalizer (it reports its own verdict on the empty data).
    const under = { data: new Uint8Array(2000 * 1999), width: 2000, height: 1999 };
    expect(scanOutline(under, { left: 0, top: 0 }, PHOTO)).toMatchObject({ ok: false, reason: "empty_mask" });
    const exactly = { data: new Uint8Array(2000 * 2000), width: 2000, height: 2000 };
    expect(exactly.width * exactly.height).toBe(SCAN_OUTLINE_MAX_PIXELS);
    expect(scanOutline(exactly, { left: 0, top: 0 }, PHOTO)).toMatchObject({ ok: false, reason: "empty_mask" });
  });
});

// ---- the reply, as the device reads it ----------------------------------------------------------------------------

function sample(): ScanOutlineSuccess {
  const c = inPhoto(union(disc(320, 130, 80), rect(305, 200, 335, 420)));
  return ok(scanOutline(c.raster, c.bounds, PHOTO, { targetHeightMm: 54 }));
}

describe("parseScanOutline", () => {
  it("reads back what scanOutline made, through JSON, unchanged", () => {
    const o = sample();
    expect(o.changes.length).toBeGreaterThan(0); // guard: there is a change log to carry
    expect(parseScanOutline(JSON.parse(JSON.stringify(o)))).toEqual(o);
  });

  it("reads a failure back", () => {
    const f = scanOutline({ data: new Uint8Array(100), width: 10, height: 10 }, { left: 0, top: 0 }, PHOTO);
    expect(parseScanOutline(JSON.parse(JSON.stringify(f)))).toEqual(f);
  });

  it("stays small enough to ride along with a scan reply", () => {
    expect(JSON.stringify(sample()).length).toBeLessThan(6_000);
  });

  it("returns a rebuilt object: nothing it does not know survives, at any depth", () => {
    const o = JSON.parse(JSON.stringify(sample()));
    o.evil = 1;
    o.orientation.evil = 1;
    o.changes[0].evil = 1;
    o.photoSize.evil = 1;
    const back = parseScanOutline(o) as ScanOutlineSuccess;
    expect(back).toBeDefined();
    expect(JSON.stringify(back)).not.toContain("evil");
  });

  // Each row breaks one field of a good reply. The base is checked first so a row cannot pass for the wrong reason.
  const breaks: [string, (o: any) => void][] = [
    ["too few points", (o) => (o.points = o.points.slice(0, 2))],
    ["too many points", (o) => (o.points = Array.from({ length: 65 }, (_, i) => [i * 0.5, i * 0.5]))],
    ["a point that is not a pair", (o) => (o.points[1] = [1, 2, 3])],
    ["a NaN coordinate", (o) => (o.points[0] = [Number.NaN, 5])],
    ["a string coordinate", (o) => (o.points[0] = ["1", 5])],
    ["x past the clamp box", (o) => (o.points[0] = [45.5, 10])],
    ["z above the clamp box", (o) => (o.points[0] = [0, 91])],
    ["z below the clamp box", (o) => (o.points[0] = [0, -46])],
    ["a fillet under the floor", (o) => (o.fillet_r_mm = 0.3)],
    ["a fillet over the ceiling", (o) => (o.fillet_r_mm = 4.5)],
    ["a zero width", (o) => (o.widthMm = 0)],
    ["a height past the box", (o) => (o.heightMm = 95)],
    ["a fidelity over 1", (o) => (o.fidelity = 1.2)],
    ["a negative fidelity", (o) => (o.fidelity = -0.1)],
    ["an unknown orientation reason", (o) => (o.orientation.reason = "sideways")],
    ["a flipped that is not a boolean", (o) => (o.orientation.flipped = "no")],
    ["an unknown change step", (o) => (o.changes[0].step = "C9")],
    ["a change with no code", (o) => delete o.changes[0].code],
    ["a change value that is not a number", (o) => (o.changes[0].value = "x")],
    ["a change log of 41", (o) => (o.changes = Array.from({ length: 41 }, () => ({ step: "C1", code: "a", detail: "b" })))],
    ["a warning that is not a string", (o) => (o.warnings = [7])],
    ["a 300 character limit on text", (o) => (o.warnings = ["x".repeat(301)])],
    ["21 warnings", (o) => (o.warnings = Array.from({ length: 21 }, () => "LOW_FIDELITY"))],
    ["an affine of 5 numbers", (o) => (o.photoToPlate = o.photoToPlate.slice(0, 5))],
    ["an affine with a NaN", (o) => (o.photoToPlate[2] = Number.NaN)],
    ["a zero photo width", (o) => (o.photoSize.width = 0)],
    ["a fractional photo height", (o) => (o.photoSize.height = 480.5)],
    ["no photo size", (o) => delete o.photoSize],
    ["ok that is not a boolean", (o) => (o.ok = "yes")],
  ];
  it("accepts the base reply", () => {
    expect(parseScanOutline(JSON.parse(JSON.stringify(sample())))).toBeDefined();
  });
  it.each(breaks)("refuses %s", (_name, mutate) => {
    const o = JSON.parse(JSON.stringify(sample()));
    mutate(o);
    expect(parseScanOutline(o)).toBeUndefined();
  });

  it.each([
    ["null", null],
    ["a string", "outline"],
    ["an array", []],
    ["a failure with an unknown reason", { ok: false, reason: "exploded", detail: "x" }],
    ["a failure with no detail", { ok: false, reason: "too_thin" }],
    ["a failure with a huge detail", { ok: false, reason: "too_thin", detail: "x".repeat(301) }],
  ])("refuses %s", (_name, raw) => {
    expect(parseScanOutline(raw)).toBeUndefined();
  });

  it("takes exactly 64 points, the compiler's limit", () => {
    const o = JSON.parse(JSON.stringify(sample()));
    o.points = Array.from({ length: 64 }, (_, i) => [30 * Math.cos((i / 64) * 2 * Math.PI), 40 + 30 * Math.sin((i / 64) * 2 * Math.PI)]);
    expect(parseScanOutline(o)).toBeDefined();
    o.points.push([0, 0]);
    expect(parseScanOutline(o)).toBeUndefined();
  });

  it("takes the ends of the clamp box", () => {
    const o = JSON.parse(JSON.stringify(sample()));
    o.points[0] = [45, 90];
    o.points[1] = [-45, -45];
    o.fillet_r_mm = 0.4;
    expect(parseScanOutline(o)).toBeDefined();
    o.fillet_r_mm = 4;
    expect(parseScanOutline(o)).toBeDefined();
  });
});

// ---- a real mask -------------------------------------------------------------------------------------------------

describe("a real SAM mask (the captured cup, 1920 x 1280 photo)", () => {
  it("becomes an outline that lies on the cup in photo pixels, and survives the wire", async () => {
    const { raster, bounds } = await realCup();
    expect(raster.width * raster.height).toBeGreaterThan(100_000); // guard: this is a real mask, not a stub
    expect(bounds.left).toBeGreaterThan(300);
    const o = ok(scanOutline(raster, bounds, { width: 1920, height: 1280 }, { targetHeightMm: 54 }));
    expect(o.points.length).toBeGreaterThan(8);
    expect(o.fidelity).toBeGreaterThan(0.95);
    expect(o.changes.map((c) => c.code)).toContain("filled_holes"); // the real mask has holes; the stand-ins never did

    // The legalizer fills enclosed holes on purpose, so the object it outlines is the mask with its holes filled.
    // Fill them here with a flood from the crop's border, independently of the code under test.
    const { width: w, height: h, data } = raster;
    const reached = new Uint8Array(w * h);
    const stack: number[] = [];
    const visit = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const i = y * w + x;
      if (reached[i] || data[i]) return;
      reached[i] = 1;
      stack.push(i);
    };
    for (let x = 0; x < w; x++) { visit(x, 0); visit(x, h - 1); }
    for (let y = 0; y < h; y++) { visit(0, y); visit(w - 1, y); }
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w, y = (i / w) | 0;
      visit(x + 1, y); visit(x - 1, y); visit(x, y + 1); visit(x, y - 1);
    }
    let on = 0, holes = 0;
    for (let i = 0; i < w * h; i++) { if (data[i]) on++; else if (!reached[i]) holes++; }
    expect(holes / (on + holes)).toBeGreaterThan(0.03); // guard: the holes are a real share of this mask, which is why it is the case to test

    // Overlap in photo pixels over a window around the cup (the rest of the photo is empty for both), every 3rd pixel.
    const overlap = (fillHoles: boolean) => {
      let inter = 0, uni = 0;
      for (let y = -20; y < h + 20; y += 3)
        for (let x = -20; x < w + 20; x += 3) {
          const inCrop = x >= 0 && y >= 0 && x < w && y < h;
          const b = inCrop && (data[y * w + x] !== 0 || (fillHoles && !reached[y * w + x]));
          const [px, pz] = applyAffine(o.photoToPlate, x + bounds.left, y + bounds.top);
          const a = inside(o.points, px, pz);
          if (a && b) inter++;
          if (a || b) uni++;
        }
      return inter / uni;
    };
    const filled = overlap(true);
    const raw = overlap(false);
    expect(filled).toBeGreaterThan(0.98); // 0.995 measured 2026-11-02
    expect(raw).toBeGreaterThan(0.9); // 0.933 measured: the gap to `filled` is the holes
    expect(raw).toBeLessThan(filled - 0.03);

    expect(parseScanOutline(JSON.parse(JSON.stringify(o)))).toEqual(o);
  });
});

// ---- the module stays pure ---------------------------------------------------------------------------------------

describe("outlineScan.ts", () => {
  it("imports only the legalizer's module, and nothing of the browser or the Worker", () => {
    const src = readFileSync(join(__dirname, "..", "shared", "outlineScan.ts"), "utf8");
    expect([...src.matchAll(/^import[\s\S]*?from "(.*)";$/gm)].map((m) => m[1])).toEqual(["./photoOutline"]);
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code.length).toBeGreaterThan(2000);
    expect(code).not.toMatch(/\bwindow\b|\bdocument\b|localStorage|\bprocess\.|\bfetch\b/);
  });
});

// ---- keeping a thin part by rounding more gently ------------------------------------------------------------------------

describe("scanOutline: a part narrower than the rounding is kept by rounding more gently", () => {
  /** A head on a stick `stickPx` wide and 410 px tall overall: at the 90 mm maximum the stick is stickPx / 410 * 90 mm wide. */
  const lollipopPhoto = (stickPx: number) => inPhoto(union(disc(320, 110, 80), rect(320 - stickPx / 2, 180, 320 + stickPx / 2, 440)));

  /** Share of the stick's own photo pixels that land inside the outline. */
  function stickCovered(o: ScanOutlineSuccess, stickPx: number): number {
    let n = 0, hit = 0;
    for (let y = 220; y < 430; y += 2)
      for (let x = Math.ceil(320 - stickPx / 2) + 1; x < 320 + stickPx / 2 - 1; x += 1) {
        const [px, pz] = applyAffine(o.photoToPlate, x, y);
        n++;
        if (inside(o.points, px, pz)) hit++;
      }
    return hit / n;
  }

  // Each stick is between two rounding limits (a fillet f keeps nothing narrower than 2f, at least 1.6 mm), so one fillet is the first that keeps it.
  const cases: [string, number, number][] = [
    ["2.9 mm at full size (under 3.2, over 2.4)", 13, 1.2],
    ["2.2 mm at full size (under 2.4, over 2.0)", 10, 1.0],
    ["1.8 mm at full size (under 2.0, over 1.6)", 8, 0.8],
  ];
  it.each(cases)("a stick %s keeps its stick at fillet %f, the largest that does", (_name, stickPx, expectedFillet) => {
    const c = lollipopPhoto(stickPx);
    const plain = legalizeOutline(c.raster, { targetHeightMm: 54, keepThinParts: true });
    if (!plain.ok) throw new Error("legalize failed");
    expect(plain.warnings).toContain("THIN_PARTS_REMOVED"); // guard: at the default the stick is taken off
    const o = ok(scanOutline(c.raster, c.bounds, PHOTO, { targetHeightMm: 54 }));
    expect(o.fillet_r_mm).toBe(expectedFillet);
    expect(o.warnings).not.toContain("THIN_PARTS_REMOVED");
    expect(o.changes.at(-1)).toMatchObject({ step: "C2", code: "lowered_fillet_to_keep_parts", value: expectedFillet });
    expect(o.heightMm).toBeGreaterThan(plain.heightMm * 1.5); // the whole object, not the head alone
    expect(stickCovered(o, stickPx)).toBeGreaterThan(0.95);
    expect(photoIoU(o, c.photo)).toBeGreaterThan(0.9);
    expect(parseScanOutline(JSON.parse(JSON.stringify(o)))).toEqual(o); // and the reply survives the wire
  });

  it("leaves the default and its warning when no gentler rounding keeps the part: a stick under 1.6 mm", () => {
    const c = lollipopPhoto(5);
    const o = ok(scanOutline(c.raster, c.bounds, PHOTO, { targetHeightMm: 54 }));
    expect(o.fillet_r_mm).toBe(1.6);
    expect(o.warnings).toContain("THIN_PARTS_REMOVED");
    expect(o.changes.map((x) => x.code)).not.toContain("lowered_fillet_to_keep_parts");
  });

  it("does not touch an outline that lost nothing: a disc, a star, and a stick wide enough for the default", () => {
    for (const make of [() => inPhoto(disc(400, 200, 90)), () => inPhoto(star(320, 240, 160, 70)), () => lollipopPhoto(20)]) {
      const c = make();
      const o = ok(scanOutline(c.raster, c.bounds, PHOTO, { targetHeightMm: 54 }));
      expect(o.fillet_r_mm).toBe(1.6);
      expect(o.changes.map((x) => x.code)).not.toContain("lowered_fillet_to_keep_parts");
    }
  });

  it("exports the fillets it tries, gentlest last, none under the builder's own 0.8 rounding", () => {
    expect([...KEEP_PARTS_FILLETS]).toEqual([1.2, 1.0, 0.8]);
  });
});

describe("a real SAM mask with a thin handle (the steel spoon, 288 x 512 upload)", () => {
  it("keeps the whole spoon: the default rounding takes the handle off, the gentler one keeps it", async () => {
    const { raster, bounds } = await realSpoon();
    expect([raster.width, raster.height]).toEqual([91, 447]); // guard: this is the real mask
    const plain = legalizeOutline(raster, { targetHeightMm: 54, keepThinParts: true });
    if (!plain.ok) throw new Error("legalize failed");
    expect(plain.warnings).toContain("THIN_PARTS_REMOVED"); // what the pipeline used to ship: a bowl with no handle
    expect(plain.heightMm).toBeLessThan(25);

    const o = ok(scanOutline(raster, bounds, SPOON_PHOTO, { targetHeightMm: 54 }));
    expect(o.warnings).toEqual([]);
    expect(o.fillet_r_mm).toBeLessThan(1.6);
    expect(o.heightMm).toBeGreaterThan(75);
    expect(o.heightMm).toBeLessThanOrEqual(90);
    expect(o.widthMm).toBeGreaterThan(14);
    expect(o.changes.map((c) => c.code)).toContain("lowered_fillet_to_keep_parts");
    expect(o.fidelity).toBeGreaterThan(0.95);

    // In photo pixels: the outline covers the handle (the lower half of the spoon) and the whole object overlaps well.
    const photo = { width: SPOON_PHOTO.width, height: SPOON_PHOTO.height, data: new Uint8Array(SPOON_PHOTO.width * SPOON_PHOTO.height) };
    for (let y = 0; y < raster.height; y++) for (let x = 0; x < raster.width; x++) if (raster.data[y * raster.width + x]) photo.data[(y + bounds.top) * photo.width + x + bounds.left] = 1;
    let handle = 0, covered = 0;
    for (let y = bounds.top + Math.round(raster.height * 0.55); y < bounds.top + raster.height; y++)
      for (let x = bounds.left; x < bounds.left + raster.width; x++) {
        if (!photo.data[y * photo.width + x]) continue;
        handle++;
        const [px, pz] = applyAffine(o.photoToPlate, x, y);
        if (inside(o.points, px, pz)) covered++;
      }
    expect(handle).toBeGreaterThan(2000); // guard: there is a handle to cover
    expect(covered / handle).toBeGreaterThan(0.95);
    expect(photoIoU(o, photo)).toBeGreaterThan(0.95);
  });
});
