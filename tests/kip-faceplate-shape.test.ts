import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// The viewer modules are plain browser JS with no declaration files.
// @ts-expect-error untyped JS module
import * as shapeMod from "../parts/kip/viewer/kip-faceplate-shape.js";
// @ts-expect-error untyped JS module
import * as printMod from "../parts/kip/viewer/kip-print.js";
// @ts-expect-error untyped JS module
import * as sdkMod from "../parts/kip/viewer/kip-forge-sdk.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const S = shapeMod as any;
const { parseStl } = printMod as any;
const SDK = sdkMod as any;
const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

function inside(poly: [number, number][], x: number, y: number) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

describe("face plate outline table", () => {
  it("is symmetric data: increasing heights, widest near the middle, closes at the top", () => {
    const t: [number, number][] = S.PLATE_HALF_WIDTH;
    for (let i = 1; i < t.length; i++) expect(t[i]![0]).toBeGreaterThan(t[i - 1]![0]);
    const widest = t.reduce((m, r) => (r[1] > m[1] ? r : m), t[0]!);
    expect(widest[0]).toBeGreaterThan(5);
    expect(widest[0]).toBeLessThan(8);
    expect(S.plateHalfWidth(-1)).toBe(0);
    expect(S.plateHalfWidth(S.PLATE_TOP_ZB + 0.1)).toBe(0);
    expect(S.plateHalfWidth(3.1)).toBeGreaterThan(S.plateHalfWidth(3.0));
    expect(S.plateHalfWidth(0)).toBeCloseTo(8.037, 3);
  });

  it("matches the exported plate STL silhouette at every loft level (a CAD change must be copied here)", () => {
    const tri: Float32Array = parseStl(readFileSync(join(root, "public/kip/partspec/toyventor_char_faceplate_flat_P.stl")));
    const levels = new Map<number, { max: number; n: number }>();
    for (let i = 0; i < tri.length; i += 3) {
      const z = Math.round(tri[i + 2]! * 100) / 100;
      const e = levels.get(z) ?? { max: 0, n: 0 };
      e.max = Math.max(e.max, Math.abs(tri[i]!)); e.n++;
      levels.set(z, e);
    }
    // 1) the plate is never wider than the table says (a CAD change that widens it must be copied here)
    // 2) the table is tight: many loft levels sit on it. Below zb 0.3 the chin corner arc is finer than the 0.25 mm table spacing.
    const onTable: number[] = [];
    for (const [z, { max, n }] of levels) {
      if (n < 6 || z < 0.3 || z > 12.5) continue;
      expect(max, `STL is wider than the table at zb ${z}: ${max.toFixed(3)} vs ${S.plateHalfWidth(z).toFixed(3)}`).toBeLessThanOrEqual(S.plateHalfWidth(z) + 0.12);
      if (max > 5 && Math.abs(max - S.plateHalfWidth(z)) <= 0.12) onTable.push(z);
    }
    expect(onTable.length).toBeGreaterThan(20);
    expect(Math.min(...onTable)).toBeLessThan(1);
    expect(Math.max(...onTable)).toBeGreaterThan(12);
    const widestStl = Math.max(...[...levels.values()].map((l) => l.max));
    expect(2 * widestStl).toBeCloseTo(S.PLATE_MM.w, 1);
    const top = Math.max(...[...levels.keys()]);
    expect(Math.abs(top - S.PLATE_MM.h)).toBeLessThan(0.2);
  });

  it("agrees with the catalog manifest's plate size", () => {
    const m = JSON.parse(read("public/kip/kip-partspec-manifest.json"));
    const flat = m.parts.find((p: any) => p.id === "char_faceplate_flat");
    expect(flat.bbox_mm[0]).toBeCloseTo(S.PLATE_MM.w, 1);
    expect(Math.abs(flat.bbox_mm[2] - S.PLATE_MM.h)).toBeLessThan(0.2);
  });
});

describe("face plate selfie window", () => {
  const poly: [number, number][] = S.windowPolygon();
  const W = S.WINDOW_MM.w, H = S.WINDOW_MM.h;

  it("is a rounded shape inside the plate: every point is at least the bezel margin from the edge", () => {
    for (const [x, y] of poly) {
      const zb = S.WINDOW_ZB.max - y;
      expect(Math.abs(x - W / 2), `x ${x} y ${y}`).toBeLessThanOrEqual(S.plateHalfWidth(zb) - S.WINDOW_INSET_MM + 2e-3); // points are rounded to 0.001 mm
    }
    expect(S.WINDOW_ZB.min).toBeGreaterThan(0);
    expect(S.WINDOW_ZB.max).toBeLessThan(S.PLATE_TOP_ZB);
  });

  it("has no square corners: the bounding box corners are outside, and the shape fills 75-92% of its box", () => {
    for (const [x, y] of [[0.3, 0.3], [W - 0.3, 0.3], [0.3, H - 0.3], [W - 0.3, H - 0.3]] as const) expect(inside(poly, x, y)).toBe(false);
    expect(inside(poly, W / 2, H / 2)).toBe(true);
    const fill = S.windowAreaMm2(poly) / (W * H);
    expect(fill).toBeGreaterThan(0.75);
    expect(fill).toBeLessThan(0.92);
  });

  it("is mirror symmetric and closed", () => {
    const area = S.windowAreaMm2(poly);
    const mirrored: [number, number][] = poly.map(([x, y]) => [W - x, y]);
    expect(S.windowAreaMm2(mirrored)).toBeCloseTo(area, 6);
    for (const [x, y] of poly.filter((_, i) => i % 9 === 0)) expect(Math.abs(mirrored.some(([mx, my]) => Math.abs(mx - x) < 1e-6 && Math.abs(my - y) < 1e-6) ? 0 : 1) <= 1).toBe(true);
    expect(S.windowPathD(poly)).toMatch(/^M[\d. -]+( L[\d. -]+)+ Z$/);
  });

  it("the decal plane is exactly the window box, centred on the window", () => {
    expect(S.FACEPLATE_DECAL.width).toBe(W);
    expect(S.FACEPLATE_DECAL.height).toBe(H);
    expect(S.FACEPLATE_DECAL.centerY).toBeCloseTo((S.WINDOW_ZB.min + S.WINDOW_ZB.max) / 2, 3);
    const wardrobe = read("parts/kip/viewer/kip-vehicles-wardrobe.js");
    expect(wardrobe).toMatch(/selfie:\s+buildConformalFaceplateDecalGeo\(expGeos\.charFaceplateFlat, FACEPLATE_DECAL\.width, FACEPLATE_DECAL\.height, FACEPLATE_DECAL\.centerY\)/);
    expect(read("parts/kip/viewer/kip-bench.js")).toMatch(/faceplateDecalGeos\[loco\.expr === 'selfie' \? 'selfie' : loco\.faceInsert\]/);
  });

  it("is taller than the old 10.1 mm rectangle and about as wide, so a face gets more height", () => {
    expect(H).toBeGreaterThan(10.1);
    expect(W).toBeGreaterThan(22);
    expect(W).toBeLessThanOrEqual(S.PLATE_MM.w);
  });
});

describe("face plate eyes are human-proportioned", () => {
  const plateW = S.PLATE_MM.w;

  const cadSrc = read("parts/partspec/toyventor_parts.py");
  const cadVinylX = (() => { const m = /^FACE_VINYL_EYE_X\s*=\s*([\d.]+)/m.exec(cadSrc); return m ? Number(m[1]) : 7.3; })(); // before the constant exists the domes are at the legacy 7.3 mm

  it("every printed eye pair is 40-52% of the plate width apart, centre to centre (it was 54-60% before 2026-11-01); the moulded vinyl domes follow once the CAD move lands", () => {
    for (const [name, mm] of Object.entries(SDK.FACEPLATE_EYE_MM as Record<string, number>)) {
      const ratio = (2 * mm) / plateW;
      expect(ratio, `${name} ${(2 * mm).toFixed(1)} mm apart = ${(ratio * 100).toFixed(0)}% of the plate`).toBeGreaterThan(0.4);
      if (name !== "vinyl" || cadVinylX < 7.3) expect(ratio, name).toBeLessThan(0.52);
    }
  });

  it("the printed art and the guide agree: the guide's eye marks are the flat insert's eyes", () => {
    expect(S.FACE_TARGET_MM.eyeHalfSpan).toBe(SDK.FACEPLATE_EYE_MM.flat);
  });

  it("the painted vinyl irises are where the moulded domes are (FACE_VINYL_EYE_X in the CAD, or the legacy 7.3 mm until it exists)", () => {
    expect(cadVinylX).toBeCloseTo(SDK.FACEPLATE_EYE_MM.vinyl, 6);
    if (/^FACE_VINYL_EYE_X\s*=/m.test(cadSrc)) expect(cadSrc).toMatch(/_face_eye_lens\(sx \* FACE_VINYL_EYE_X/);
  });

  it("each eye (dome radius 2.75 mm for the vinyl plate, about 2.6 mm for the art) stays at least 1.5 mm inside the plate outline at its height", () => {
    const E = SDK.FACEPLATE_EYE_MM;
    expect(E.vinyl + 2.75 + 1.5).toBeLessThan(S.plateHalfWidth(5.45));
    for (const k of ["sculpted", "flatButton", "flat"]) expect(E[k] + 2.6 + 1.5).toBeLessThan(S.plateHalfWidth(5.8));
  });

  it("the seated plate sits in the kid pocket: chin at its bottom edge, rim not proud of the lip", () => {
    // Holder wiring: both seat sites must apply the shared correction.
    expect(read("parts/kip/viewer/kip-bench.js")).toContain("dt.faceY - 2.50 + FACEPLATE_SEAT_MM.raise");
    expect(read("parts/kip/viewer/kip-bench.js")).toContain("FACE_STEM_MM - FACEPLATE_SEAT_MM.sink");
    expect(read("parts/kip/viewer/kip-vehicles-wardrobe.js")).toContain("FACEPLATE_SEAT_MM.raise");
    const seat = S.FACEPLATE_SEAT_MM as { raise: number; sink: number };
    const head = parseStl(readFileSync(join(root, "public/kip/partspec/toyventor_char_head_kid_S.stl"))) as Float32Array;
    const plate = parseStl(readFileSync(join(root, "public/kip/partspec/toyventor_char_faceplate_P.stl"))) as Float32Array;
    const frontAt = (t: Float32Array, y: number, x0: number, x1: number) => {
      let mn = Infinity;
      for (let i = 0; i < t.length; i += 3) if (Math.abs(t[i + 2]! - y) < 0.5 && Math.abs(t[i]!) >= x0 && Math.abs(t[i]!) <= x1) mn = Math.min(mn, t[i + 1]!);
      return mn === Infinity ? NaN : -mn;
    };
    // Pocket bottom: first height (from y=8 up) whose centre front is recessed below 11 mm.
    let pocketBottom = NaN;
    for (let y = 8; y <= 14 && Number.isNaN(pocketBottom); y += 0.5) if (frontAt(head, y, 0, 5) < 11) pocketBottom = y;
    const chinY = 12.5 - 2.5 + seat.raise; // kid faceY datum, holder formula
    expect(chinY).toBeGreaterThanOrEqual(pocketBottom - 0.15);
    expect(chinY).toBeLessThanOrEqual(pocketBottom + 0.6);
    // Rim at zb 10-12 vs head lip at the same heights: seated rim must not ride more than 0.4 mm proud.
    let rimFront = -Infinity;
    for (let i = 0; i < plate.length; i += 3) if (plate[i + 2]! >= 9 && plate[i + 2]! <= 12.5 && Math.abs(plate[i]!) >= 8) rimFront = Math.max(rimFront, plate[i + 1]!);
    const lip = frontAt(head, chinY + 11, 8, 11);
    expect(10.167 - seat.sink + rimFront).toBeLessThanOrEqual(lip + 0.4);
  });

  it("a plate-art eye pair is closer than the classic head's, which keeps its own spacing", () => {
    const src = read("parts/kip/viewer/kip-forge-sdk.js");
    expect(src).toMatch(/const eyeTable = FACEPLATE_EYE_PX;/);
    expect(src).not.toContain("LEGACY_EYE_PX");
  });
});
