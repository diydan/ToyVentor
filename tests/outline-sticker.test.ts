import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { photoPixelToSticker, photoStickerItem, roundedPlateOutline, type PhotoStickerItem } from "../shared/outlineSticker";
import { applyAffine, legalizeOutline, type OutlineSuccess, withFlipped, withScaled } from "../shared/photoOutline";
import { disc, isSimplePolygon, jaggedDisc, polygon, randomBlob, type Raster, rasterize, rect, rotated, SHAPES, signedArea, union } from "./fixtures/outlineMasks";
// @ts-expect-error untyped browser JS module (the sticker sheet module the cut file comes from)
import * as ST from "../parts/kip/viewer/kip-print-stickers.js";

vi.setConfig({ testTimeout: 60_000 });

type Pt = [number, number];
const ok = (mask: Raster, opts?: Parameters<typeof legalizeOutline>[1]): OutlineSuccess => {
  const r = legalizeOutline(mask, opts);
  if (!r.ok) throw new Error(`legalizeOutline failed: ${r.reason}`);
  return r;
};

/** Distance from a point to the closest edge of a polygon. */
function boundaryDistance(p: readonly Pt[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < p.length; i++) {
    const [ax, az] = p[i]!;
    const [bx, bz] = p[(i + 1) % p.length]!;
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
  }
  return best;
}
const insideOrOn = (p: readonly Pt[], x: number, z: number, tol = 0.003) => polygon(p)(x, z) || boundaryDistance(p, x, z) <= tol;
const area = (p: readonly Pt[]) => Math.abs(signedArea(p));

describe("roundedPlateOutline: the builder's rounding of convex corners", () => {
  const square: Pt[] = [[-10, 0], [10, 0], [10, 20], [-10, 20]];

  it("turns each corner of a square into an arc: the area of a square with corners of radius r", () => {
    const out = roundedPlateOutline(square, 1.6);
    expect(out.length).toBeGreaterThan(4 * 4);
    const exact = 400 - (4 - Math.PI) * 1.6 ** 2; // a square with quarter-circle corners
    expect(area(out)).toBeLessThan(exact);
    expect(area(out)).toBeGreaterThan(exact - 0.3); // the chords sit a hair inside the arcs
    for (const [x, z] of out) expect(insideOrOn(square, x, z)).toBe(true);
    expect(isSimplePolygon(out)).toBe(true);
  });

  it("keeps the tangent points where the circle meets the edges: 1.6 mm along each edge from the corner", () => {
    const out = roundedPlateOutline(square, 1.6);
    const has = (x: number, z: number) => out.some((p) => Math.hypot(p[0] - x, p[1] - z) < 0.002);
    expect(has(-8.4, 0)).toBe(true);
    expect(has(-10, 1.6)).toBe(true);
    expect(has(8.4, 0)).toBe(true);
    expect(has(10, 18.4)).toBe(true);
  });

  it("leaves a concave corner and a straight run exactly where they are", () => {
    const L: Pt[] = [[0, 0], [10, 0], [20, 0], [20, 10], [10, 10], [10, 20], [0, 20]]; // (10, 0) is a straight run, (10, 10) is reflex
    const out = roundedPlateOutline(L, 1.6);
    const has = (x: number, z: number) => out.some((p) => p[0] === x && p[1] === z);
    expect(has(10, 10)).toBe(true);
    expect(has(10, 0)).toBe(true);
    for (const [x, z] of [[0, 0], [20, 0], [20, 10], [10, 20], [0, 20]] as Pt[]) expect(has(x, z), `corner ${x},${z} was rounded off`).toBe(false);
  });

  it("a short edge limits the radius at its corner (the arc uses at most half of each neighbouring edge)", () => {
    const thin: Pt[] = [[-20, 0], [20, 0], [20, 2], [-20, 2]];
    const out = roundedPlateOutline(thin, 1.6);
    expect(isSimplePolygon(out)).toBe(true);
    for (const [x, z] of out) expect(insideOrOn(thin, x, z)).toBe(true);
    expect(area(out)).toBeLessThan(80);
    expect(area(out)).toBeGreaterThan(78); // only the corners came off: radius 1 mm at most
  });

  it("returns counter-clockwise whatever it was given, and does not change its input", () => {
    const cw = [...square].reverse();
    const copy = JSON.stringify(cw);
    expect(signedArea(roundedPlateOutline(cw, 1.6))).toBeGreaterThan(0);
    expect(JSON.stringify(cw)).toBe(copy);
  });

  it("is close to a no-op on an outline that was already rounded at the same radius", () => {
    const o = ok(SHAPES.disc());
    const once = roundedPlateOutline(o.points, 1.6);
    const twice = roundedPlateOutline(once, 1.6);
    for (const [x, z] of twice) expect(boundaryDistance(once, x, z)).toBeLessThan(0.03);
    expect(area(once) - area(twice)).toBeLessThan(0.01 * area(once));
  });

  it("degenerate input is returned as it is: fewer than 3 points, radius 0, NaN", () => {
    expect(roundedPlateOutline([[0, 0], [1, 1]], 1.6)).toEqual([[0, 0], [1, 1]]);
    expect(roundedPlateOutline(square, 0)).toEqual(square);
    expect(roundedPlateOutline(square, Number.NaN)).toEqual(square);
  });

  it("on real outlines: never past the polygon, still simple, loses little area, and does take tips off rough ones", () => {
    let tipsTaken = 0;
    const cases = [
      ...Array.from({ length: 8 }, (_, i) => ({ name: `blob ${i + 1}`, mask: randomBlob(i + 1) })),
      ...Array.from({ length: 5 }, (_, i) => ({ name: `jagged ${i + 1}`, mask: jaggedDisc(i + 1) })),
      { name: "star", mask: SHAPES.star() },
      { name: "paddle", mask: SHAPES.paddle() },
    ];
    for (const { name, mask } of cases) {
      const o = ok(mask);
      const r = roundedPlateOutline(o.points, Math.max(o.fillet_r_mm, 0.8));
      expect(isSimplePolygon(r), `${name} is simple`).toBe(true);
      expect(signedArea(r), `${name} winding`).toBeGreaterThan(0);
      for (const [x, z] of r) expect(insideOrOn(o.points, x, z), `${name}: ${x},${z} is outside the polygon`).toBe(true);
      const lost = area(o.points) - area(r);
      expect(lost, name).toBeGreaterThanOrEqual(-0.01);
      expect(lost / area(o.points), name).toBeLessThan(0.03);
      if (name.startsWith("jagged") && lost > 0.2) tipsTaken++;
    }
    expect(tipsTaken, "rounding changed nothing on any rough outline: it is not doing its job").toBeGreaterThan(0);
  });
});

describe("roundedPlateOutline on a dense polygon: gentle corners are left alone", () => {
  const ring = (n: number, r = 27): Pt[] => Array.from({ length: n }, (_, i): Pt => [r * Math.cos((i / n) * 2 * Math.PI), 30 + r * Math.sin((i / n) * 2 * Math.PI)]);

  it("a 120 point circle keeps its 120 points: each corner turns 3 degrees, so its arc would start 0.04 mm from the vertex and move the path by a thousandth of a millimetre", () => {
    const out = roundedPlateOutline(ring(120), 1.6);
    expect(out).toHaveLength(120);
    for (const [x, z] of ring(120)) expect(out.some(([ox, oz]) => Math.abs(ox - x) < 0.002 && Math.abs(oz - z) < 0.002)).toBe(true); // every vertex is still there, unmoved
  });

  it("a sharp corner still gets its arc, and the gentle ones around it still do not", () => {
    // A 40 mm square with a 120 point arc cut into one side: the four sharp corners are rounded, the arc's own vertices are not.
    const base: Pt[] = [[-20, 0], [20, 0], [20, 40], [-20, 40]];
    const withArc: Pt[] = [...base.slice(0, 2), ...Array.from({ length: 40 }, (_, i): Pt => [20 - 0.5 * i, 40 + 0.03 * Math.sin((i / 40) * Math.PI)]), ...base.slice(3)];
    const out = roundedPlateOutline(withArc, 1.6);
    expect(out.length).toBeGreaterThan(withArc.length); // arcs were added at the right-angle corners
    expect(out.length).toBe(withArc.length + 4 * 5); // exactly the four right-angle corners, each cut into 5 pieces (90 degrees in steps of 20): not two points on each of the 40 gentle vertices
  });

  it("a dense outline from the legalizer gives a cut path about as long as the outline, not twice as long", () => {
    const o = ok(SHAPES.disc(), { targetHeightMm: 54 });
    expect(o.points.length).toBeGreaterThan(64); // guard: this is a dense outline
    const cut = photoStickerItem(o).outerPolyMm;
    expect(cut.length).toBeLessThan(o.points.length * 1.15);
    expect(cut.length).toBeLessThanOrEqual(1200); // inside the sheet module's own limit
  });
});

describe("photoStickerItem: the cut path and where the photo sits on it", () => {
  const paddle = () => ok(SHAPES.paddle());

  it("is the sheet module's item shape, with the path in sticker millimetres: top-left at 0, 0, clockwise on screen", () => {
    const item = photoStickerItem(paddle());
    expect(item).toMatchObject({ kind: "photo_accessory", holePolysMm: [], foldLinesMm: [], bgHex: "#FFFFFF" });
    const xs = item.outerPolyMm.map((p) => p[0]);
    const ys = item.outerPolyMm.map((p) => p[1]);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...xs)).toBeCloseTo(item.w, 3);
    expect(Math.max(...ys)).toBeCloseTo(item.h, 3);
    expect(signedArea(item.outerPolyMm)).toBeGreaterThan(0); // y down: positive shoelace is clockwise, which is what ensureWinding(poly, true) makes
    expect(isSimplePolygon(item.outerPolyMm)).toBe(true);
  });

  it("is the rounded plate outline and nothing else: the frame alone separates it from the recipe polygon", () => {
    const o = paddle();
    const item = photoStickerItem(o);
    const { x, z } = item.sampler.plateOriginMm;
    const back = item.outerPolyMm.map(([X, Y]): Pt => [X + x, z - Y]);
    const want = roundedPlateOutline(o.points, Math.max(o.fillet_r_mm, 0.8));
    const key = (p: Pt) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
    expect(back.map(key).sort()).toEqual(want.map(key).sort());
    expect(item.sampler.roundedByMm).toBe(1.6);
  });

  it("keeps every concave vertex of the recipe polygon exactly (the builder does not move them)", () => {
    for (const [name, mask] of [["paddle", SHAPES.paddle()], ["star", SHAPES.star()], ["blob", randomBlob(3)]] as [string, Raster][]) {
      const o = ok(mask);
      const item = photoStickerItem(o);
      const { x, z } = item.sampler.plateOriginMm;
      const back = item.outerPolyMm.map(([X, Y]): Pt => [X + x, z - Y]);
      const n = o.points.length;
      let concave = 0;
      for (let i = 0; i < n; i++) {
        const p = o.points[(i + n - 1) % n]!;
        const v = o.points[i]!;
        const q = o.points[(i + 1) % n]!;
        const cross = (v[0] - p[0]) * (q[1] - v[1]) - (v[1] - p[1]) * (q[0] - v[0]);
        if (cross < -1e-6) {
          concave++;
          expect(back.some((b) => Math.hypot(b[0] - v[0], b[1] - v[1]) < 0.002), `concave vertex ${v} moved`).toBe(true);
        }
      }
      if (name === "star") expect(concave, "the star must have concave vertices or this test proves nothing").toBeGreaterThan(0);
    }
  });

  it("the photo map ends where the path is: photoPixelToSticker agrees with the affine", () => {
    const item = photoStickerItem(paddle());
    const [X, Y] = photoPixelToSticker(item, 200, 100);
    const [X2, Y2] = applyAffine(item.sampler.photoToSticker, 200, 100);
    expect([X, Y]).toEqual([X2, Y2]);
    const inv = item.sampler.stickerToPhoto!;
    const [px, py] = applyAffine(inv, X, Y);
    expect(px).toBeCloseTo(200, 6);
    expect(py).toBeCloseTo(100, 6);
  });
});

/** Fraction of the sticker's area that has object behind it, and fraction of the object that the sticker covers. */
function registration(item: PhotoStickerItem, mask: Raster, map = item.sampler): { onObject: number; covered: number } {
  const inv = map.stickerToPhoto!;
  const inside = polygon(item.outerPolyMm);
  let n = 0;
  let on = 0;
  for (let Y = 0.1; Y < item.h; Y += 0.25)
    for (let X = 0.1; X < item.w; X += 0.25) {
      if (!inside(X, Y)) continue;
      n++;
      const [px, py] = applyAffine(inv, X, Y);
      const ix = Math.round(px);
      const iy = Math.round(py);
      if (ix >= 0 && iy >= 0 && ix < mask.width && iy < mask.height && mask.data[iy * mask.width + ix] === 1) on++;
    }
  let m = 0;
  let hit = 0;
  for (let y = 0; y < mask.height; y += 3)
    for (let x = 0; x < mask.width; x += 3) {
      if (mask.data[y * mask.width + x] !== 1) continue;
      m++;
      const [X, Y] = applyAffine(map.photoToSticker, x, y);
      if (inside(X, Y)) hit++;
    }
  return { onObject: n ? on / n : 0, covered: m ? hit / m : 0 };
}

const tilted = (deg: number) => rasterize(400, 400, rotated(union(disc(200, 100, 80), rect(185, 170, 215, 380)), 200, 200, deg));
const CASES: [string, () => Raster][] = [
  ["paddle", SHAPES.paddle],
  ["star", SHAPES.star],
  ["lollipop tilted 20 degrees", () => tilted(20)],
  ["lollipop upside down", () => tilted(180)],
  ["blob", () => randomBlob(5)],
];

describe("the sticker sits on the object in the photo (checked against the mask, not against the module)", () => {
  for (const [name, make] of CASES) {
    it(`${name}: the cut path lies on the object and covers it`, () => {
      const mask = make();
      const r = registration(photoStickerItem(ok(mask)), mask);
      expect(r.onObject).toBeGreaterThan(0.97);
      expect(r.covered).toBeGreaterThan(0.93); // the rounding takes the sharpest corners off the object
    });

    it(`${name}: still true after the kid flips it`, () => {
      const mask = make();
      const r = registration(photoStickerItem(withFlipped(ok(mask))), mask);
      expect(r.onObject).toBeGreaterThan(0.97);
      expect(r.covered).toBeGreaterThan(0.93);
    });
  }

  it("and after a resize", () => {
    const mask = SHAPES.paddle();
    const { outline } = withScaled(ok(mask, { targetHeightMm: 40 }), 1.25);
    const r = registration(photoStickerItem(outline), mask);
    expect(r.onObject).toBeGreaterThan(0.97);
    expect(r.covered).toBeGreaterThan(0.93);
  });

  it("the check can fail: a map that was not updated by the flip puts the sticker off the object", () => {
    const mask = SHAPES.paddle();
    const o = ok(mask);
    const stale = photoStickerItem(o).sampler; // the unflipped map ...
    const flipped = photoStickerItem(withFlipped(o)); // ... with the flipped path
    expect(registration(flipped, mask, stale).onObject).toBeLessThan(0.7);
    const wrong = { ...flipped.sampler, photoToSticker: [1, 0, 0, 1, 0, 0] as const, stickerToPhoto: [1, 0, 0, 1, 0, 0] as const };
    expect(registration(flipped, mask, wrong as unknown as typeof flipped.sampler).onObject).toBeLessThan(0.2);
  });
});

describe("photoStickerItem: the per-row slide in sticker coordinates", () => {
  const TABLE: [number, number][] = [[0, 0.2], [10, -0.4], [30, 0.1], [45, 0.3]];
  const slideAt = (t: readonly Pt[], z: number) => {
    if (z <= t[0]![0]) return t[0]![1];
    if (z >= t[t.length - 1]![0]) return t[t.length - 1]![1];
    for (let i = 1; i < t.length; i++) if (z <= t[i]![0]) return t[i - 1]![1] + ((z - t[i - 1]![0]) / (t[i]![0] - t[i - 1]![0])) * (t[i]![1] - t[i - 1]![1]);
    return 0;
  };

  it("turns plate heights into sticker rows: the table runs down the sticker, rising in Y, and a plate point reads the same slide either way", () => {
    const outline = { ...ok(SHAPES.paddle()), rowShift: TABLE };
    const item = photoStickerItem(outline);
    const t = item.sampler.rowShiftMm!;
    expect(t).toHaveLength(TABLE.length);
    for (let i = 1; i < t.length; i++) expect(t[i]![0]).toBeGreaterThan(t[i - 1]![0]);
    const { x: x0, z: z1 } = item.sampler.plateOriginMm;
    void x0;
    for (let z = -2; z <= 47; z += 0.37) {
      const Y = z1 - z; // a plate height as a sticker row
      expect(Math.abs(slideAt(t, Y) - slideAt(TABLE, z)), `at plate z ${z.toFixed(2)}`).toBeLessThan(0.002);
    }
  });

  it("changes nothing else: the cut path, the size and the photo map are the same as for the outline without it", () => {
    const plain = ok(SHAPES.paddle());
    const a = photoStickerItem(plain);
    const b = photoStickerItem({ ...plain, rowShift: TABLE });
    expect(b.outerPolyMm).toEqual(a.outerPolyMm);
    expect([b.w, b.h]).toEqual([a.w, a.h]);
    expect(b.sampler.stickerToPhoto).toEqual(a.sampler.stickerToPhoto);
    expect(b.sampler.photoToSticker).toEqual(a.sampler.photoToSticker);
    expect(b.sampler.plateOriginMm).toEqual(a.sampler.plateOriginMm);
  });

  it("has no table when the outline has none, and the key is not there at all", () => {
    expect("rowShiftMm" in photoStickerItem(ok(SHAPES.paddle())).sampler).toBe(false);
  });

  it("a slide along x is the same number of millimetres on the sticker: the sign and size are kept, and no zero is negative", () => {
    const item = photoStickerItem({ ...ok(SHAPES.paddle()), rowShift: [[0, 0.5], [20, -0.5], [40, 0]] });
    const ds = item.sampler.rowShiftMm!.map((p) => p[1]).sort((p, q) => p - q);
    expect(ds).toEqual([-0.5, 0, 0.5]);
    expect(item.sampler.rowShiftMm!.some(([y, d]) => Object.is(y, -0) || Object.is(d, -0))).toBe(false);
  });

  it("a flipped and resized outline's table gives the same slide at the same sticker row as the original did at the same photo point", () => {
    const base = { ...ok(SHAPES.paddle()), rowShift: TABLE };
    const flipped = withFlipped(base);
    const scaled = withScaled(base, 0.8).outline;
    for (const [name, o] of [["flipped", flipped], ["scaled", scaled]] as const) {
      const item = photoStickerItem(o);
      const t = item.sampler.rowShiftMm!;
      expect(t.length, name).toBe(TABLE.length);
      for (let i = 1; i < t.length; i++) expect(t[i]![0], `${name}: rising`).toBeGreaterThan(t[i - 1]![0]);
      const { z: z1 } = item.sampler.plateOriginMm;
      for (const [z, d] of o.rowShift!) expect(Math.abs(slideAt(t, z1 - z) - d), `${name} at ${z}`).toBeLessThan(0.002);
    }
  });
});

describe("the cut path reaches the cutter files unchanged (through the sticker sheet module's own writers)", () => {
  const sheetFor = (item: PhotoStickerItem) => ({
    activeBoxMm: { w: +(item.w + 8).toFixed(3), h: +(item.h + 8).toFixed(3) },
    items: [{ ...item, x: 4, y: 4, svgId: "cut-line" }],
  });
  const pairs = (nums: string[]): Pt[] => {
    const out: Pt[] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) out.push([Number(nums[i]), Number(nums[i + 1])]);
    return out;
  };

  for (const [name, make] of CASES.slice(0, 3)) {
    it(`${name}: the SVG path and the DXF polyline are the sticker polygon`, () => {
      const item = photoStickerItem(ok(make()));
      const plan = sheetFor(item);
      const svg: string = ST.stickersCutSvg(plan);
      const d = /<path id="cut-line" d="([^"]+)"/.exec(svg)?.[1];
      expect(d, "no cut-line path in the SVG").toBeDefined();
      const svgPts = pairs(d!.match(/-?\d+(?:\.\d+)?/g)!);
      expect(svgPts).toHaveLength(item.outerPolyMm.length);
      svgPts.forEach((p, i) => {
        expect(p[0]).toBeCloseTo(item.outerPolyMm[i]![0] + 4, 3);
        expect(p[1]).toBeCloseTo(item.outerPolyMm[i]![1] + 4, 3);
      });
      expect(svg).not.toMatch(/<image|<clipPath|<text|<pattern/); // Cricut rejects these

      const dxf: string = ST.stickersCutDxf(plan);
      const lines = dxf.split("\n");
      const dxfPts: Pt[] = [];
      for (let i = 0; i < lines.length; i++) {
        if (lines[i] !== "VERTEX") continue;
        const at = (code: string) => Number(lines[lines.indexOf(code, i + 1) + 1]);
        dxfPts.push([at("10"), at("20")]);
      }
      expect(dxfPts).toHaveLength(item.outerPolyMm.length);
      dxfPts.forEach((p, i) => {
        expect(p[0]).toBeCloseTo(item.outerPolyMm[i]![0] + 4, 3);
        expect(plan.activeBoxMm.h - p[1] - 4).toBeCloseTo(item.outerPolyMm[i]![1], 3); // DXF y runs up
      });
    });
  }
});

describe("wiring", () => {
  it("stays pure: no DOM, no network, no clock, no randomness; one import, from photoOutline", () => {
    const src = readFileSync(join(__dirname, "..", "shared", "outlineSticker.ts"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\b(document|window|fetch|localStorage|sessionStorage|XMLHttpRequest|Date\.now|Math\.random|performance\.now|setTimeout)\b/);
    const from = [...code.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(from).toEqual(["./photoOutline"]);
  });
});
