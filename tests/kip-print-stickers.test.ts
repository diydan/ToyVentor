import { readFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
// @ts-expect-error untyped browser JS module
import * as K from "../parts/kip/viewer/kip-print.js";
// @ts-expect-error untyped browser JS module
import * as B from "../parts/kip/viewer/kip-print-bom.js";
// @ts-expect-error untyped browser JS module
import * as P from "../parts/kip/viewer/kip-print-profile.js";
// @ts-expect-error untyped browser JS module
import * as ST from "../parts/kip/viewer/kip-print-stickers.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const root = process.cwd();
const pub = (rel: string) => join(root, "public", rel.replace(/^\//, ""));

function makeTestRgba(w: number, h: number, fn: (x: number, y: number) => [number, number, number, number]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = fn(x, y);
      const o = (y * w + x) * 4;
      data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = a;
    }
  }
  return { w, h, data };
}

function parsePngChunks(u8: Uint8Array) {
  const buf = Buffer.from(u8);
  expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  const out: { type: string; data: Buffer; crc: number }[] = [];
  for (let o = 8; o < buf.length;) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString("latin1", o + 4, o + 8);
    const data = buf.subarray(o + 8, o + 8 + len);
    const crc = buf.readUInt32BE(o + 8 + len);
    expect(crc, `CRC for ${type}`).toBe(crc32(Buffer.concat([Buffer.from(type, "latin1"), data])));
    out.push({ type, data, crc });
    o += 12 + len;
  }
  return out;
}

describe("Milestone M2: conformal surface unrolling against shipped STLs (§8.1 B)", () => {
  it("matches live STL ray-cast arc-length ratios within 0.3% across flat faceplate, sculpted faceplate, and Pro/Snap torsos", () => {
    const cases = [
      { key: "selfie_face", file: "/kip/partspec/toyventor_char_faceplate_flat_P.stl" },
      { key: "human_face_flat", file: "/kip/partspec/toyventor_char_faceplate_flat_P.stl" },
      { key: "human_face_sculpted", file: "/kip/partspec/toyventor_char_faceplate_P.stl" },
      { key: "shirt_pro", file: "/kip/stls/torso.stl" },
      { key: "shirt_snap", file: "/kip/stls/snap_torso.stl" },
    ] as const;

    for (const c of cases) {
      const prof = ST.UNROLL_PROFILES[c.key];
      const tri = K.parseStl(readFileSync(pub(c.file)));
      const live = ST.measureDecalSurfaceGrid(tri, {
        planeW: prof.planeW,
        planeH: prof.planeH,
        centerY: prof.centerY,
        mode: prof.mode,
        cols: prof.colScales.length,
        rows: prof.rowScales.length,
      });
      const dimsStored = ST.unrollDimensionsMm(prof);
      const dimsLive = ST.unrollDimensionsMm(live);
      const errW = Math.abs(dimsStored.w - dimsLive.w) / dimsLive.w;
      const errH = Math.abs(dimsStored.h - dimsLive.h) / dimsLive.h;
      expect(errW, `${c.key} width unroll error`).toBeLessThan(0.003);
      expect(errH, `${c.key} height unroll error`).toBeLessThan(0.003);
    }

    // Spec §8.1 B sanity: selfie unrolled is ~23.5..24.2 x 12.9..13.4 mm (wider & taller than 23.2 x 12.4 planar chord),
    // and Pro chest unrolled mid-row is +3.6% (~19.5 mm) x +0.5% (~21.7 mm).
    const selfieDims = ST.unrollDimensionsMm("selfie_face");
    expect(selfieDims.midW).toBeCloseTo(23.56, 1);
    expect(selfieDims.midH).toBeCloseTo(12.90, 1);

    const chestDims = ST.unrollDimensionsMm("shirt_pro");
    expect(chestDims.midW).toBeCloseTo(19.48, 1);
    expect(chestDims.midH).toBeCloseTo(21.71, 1);
  });

  it("inverts separable conformal unroll to < 1e-5 UV residual across the full grid", () => {
    for (const key of ["selfie_face", "human_face_sculpted", "shirt_pro", "creature_dragon"]) {
      const dims = ST.unrollDimensionsMm(key);
      for (const u of [0.05, 0.25, 0.5, 0.75, 0.95]) {
        for (const v of [0.05, 0.3, 0.5, 0.8, 0.95]) {
          const [x, y] = ST.unrollPointMm(key, u, v, dims);
          const [uBack, vBack] = ST.inverseUnrollUv(key, x, y, dims);
          expect(Math.abs(uBack - u), `${key} u`).toBeLessThan(1e-5);
          expect(Math.abs(vBack - v), `${key} v`).toBeLessThan(1e-5);
        }
      }
    }
  });
});

describe("Milestone M2: die-cut layouts per face insert, shirt, and craft cutout (§8.1 C)", () => {
  it("emits squircle + curved mouth-ridge relief slot + 1 spare + 3 bonus faces for flat/selfie, and 5-piece split set only for sculpted", () => {
    // 1. Flat / Selfie: primary + spare + 3 bonus (`happy`, `wink`, `surprised`) = 5 squircles, each with 1 curved mouth-ridge hole
    const flatPlan = ST.planStickerSheet([{ kind: "selfie_face", expr: "selfie", faceInsert: "flat" }], { edition: "pro" });
    expect(flatPlan.items).toHaveLength(5);
    expect(flatPlan.items[0].svgId).toBe("cut-line");
    for (const it of flatPlan.items) {
      expect(it.holePolysMm).toHaveLength(1);
      expect(it.outerPolyMm.length).toBeGreaterThan(40);
    }
    expect(flatPlan.activeBoxMm.w).toBeLessThanOrEqual(ST.CRICUT_MAX_MM.w);
    expect(flatPlan.activeBoxMm.h).toBeLessThanOrEqual(ST.CRICUT_MAX_MM.h);

    // 2. Sculpted (`char_faceplate`): strictly 5-piece split kiss-cut set + 1 spare set = 10 pieces, zero nose keyhole holes
    const sculptedPlan = ST.planStickerSheet([{ kind: "human_face", expr: "spark", faceInsert: "sculpted" }], { edition: "pro" });
    expect(sculptedPlan.items).toHaveLength(10);
    expect(sculptedPlan.items.slice(0, 5).map((i: any) => i.id)).toEqual([
      "sculpted_eye_l",
      "sculpted_eye_r",
      "sculpted_cheek_l",
      "sculpted_cheek_r",
      "sculpted_mouth",
    ]);
    for (const it of sculptedPlan.items) {
      expect(it.holePolysMm).toEqual([]);
    }

    // 3. Vinyl (`char_faceplate_vinyl`): Ø5.00 mm circular irises + brows, cheeks, smile (+ 1 spare set = 14 pieces)
    const vinylPlan = ST.planStickerSheet([{ kind: "human_face", expr: "spark", faceInsert: "vinyl" }], { edition: "pro" });
    expect(vinylPlan.items).toHaveLength(14);
    const irisL = vinylPlan.items.find((i: any) => i.id === "vinyl_iris_l");
    expect(irisL.w).toBe(5.0);
    expect(irisL.h).toBe(5.0);
  });

  it("mirrors Photo-Forge craft cutouts across the fold line and adds a 6.0 mm glue tab", () => {
    const craftPlan = ST.planStickerSheet([{ kind: "craft_cutout", slot: "hand", label: "Star Shield" }], { edition: "pro" });
    expect(craftPlan.items).toHaveLength(1);
    const item = craftPlan.items[0];
    expect(item.w).toBe(66.0); // 30 + 30 + 6 mm tab
    expect(item.h).toBe(34.0);
    expect(item.foldLinesMm).toHaveLength(2);

    // Left half of source is bright red, right half is bright blue -> mirrored back panel puts blue next to fold, red near tab
    const src = makeTestRgba(40, 20, (x) => (x < 20 ? [220, 30, 30, 255] : [30, 80, 230, 255]));
    const rendered = ST.renderStickerItemRgba(item, { "craft:hand": src }, 100, 1.0);
    const pxAtMm = (xMm: number, yMm: number) => {
      const px = Math.floor(((xMm + 1.0) / rendered.totalWMm) * rendered.w);
      const py = Math.floor(((yMm + 1.0) / rendered.totalHMm) * rendered.h);
      const o = (py * rendered.w + px) * 4;
      return [rendered.data[o], rendered.data[o + 1], rendered.data[o + 2]];
    };
    // Front panel left (`x = 5 mm`) is red; front panel near fold (`x = 25 mm`) is blue
    expect(pxAtMm(5, 17)[0]).toBeGreaterThan(180);
    expect(pxAtMm(25, 17)[2]).toBeGreaterThan(180);
    // Back panel is mirrored across `x = 30 mm`: `x = 35 mm` (5 mm past fold) is blue, `x = 55 mm` is red!
    expect(pxAtMm(35, 17)[2]).toBeGreaterThan(180);
    expect(pxAtMm(55, 17)[0]).toBeGreaterThan(180);
  });
});

describe("Milestone M2: PDF 1:1 scale bar, Cutter SVG, Silhouette DXF, and Bleed PNG (§8.1 D)", () => {
  const sampleDecals = [
    { kind: "selfie_face", expr: "selfie", faceInsert: "flat" },
    { kind: "shirt", shirtId: "spark_tee" },
    { kind: "craft_cutout", slot: "hand", label: "Sword" },
  ];
  const sampleSources = {
    "face:selfie": makeTestRgba(64, 34, (x) => [x * 3, 120, 200, 255]),
    "face:happy:flat": makeTestRgba(64, 32, () => [40, 30, 25, 255]),
    "face:wink:flat": makeTestRgba(64, 32, () => [40, 30, 25, 255]),
    "face:surprised:flat": makeTestRgba(64, 32, () => [40, 30, 25, 255]),
    "shirt:spark_tee": makeTestRgba(64, 64, () => [255, 107, 74, 255]),
    "craft:hand": makeTestRgba(48, 48, () => [80, 190, 120, 255]),
  };

  it("writes a PDF 1.6 with /PrintScaling /None, a 50.00 +/- 0.02 mm scale bar, valid Flate streams, and 1500.19(d) warnings", () => {
    const sheetPlan = ST.planStickerSheet(sampleDecals, { edition: "pro" });
    const pdfBytes: Uint8Array = ST.stickersToPdf(sheetPlan, sampleSources, { dpi: 150 });
    const pdfTxt = Buffer.from(pdfBytes).toString("latin1");

    expect(pdfTxt.startsWith("%PDF-1.6\n")).toBe(true);
    expect(pdfTxt).toContain("/ViewerPreferences << /PrintScaling /None /Enforce [/PrintScaling] >>");
    expect(pdfTxt).toContain("(WARNING) Tj");
    expect(pdfTxt).toContain("CHOKING HAZARD - Small parts.");
    expect(pdfTxt).toContain("Printed at home or by a print service.");
    expect(pdfTxt).toContain("(50.00 mm) Tj");

    // Extract the content stream (last stream before xref) and measure the exact 50.00 mm bar vector command
    const streamMatches = [...pdfTxt.matchAll(/<< [^\n]*\/Filter \/FlateDecode \/Length (\d+) >>\nstream\n/g)];
    expect(streamMatches.length).toBe(sheetPlan.items.length * 2); // SMask + RGB Image per sticker
    for (const m of streamMatches) {
      const start = (m.index ?? 0) + m[0].length;
      const len = Number(m[1]);
      const rawZ = pdfBytes.subarray(start, start + len);
      const inflated = inflateSync(rawZ);
      expect(inflated.length).toBeGreaterThan(0);
    }

    // Measure the 50.00 mm bar line segment (`bx0 by0 m bx1 by0 l S` right before the tick marks)
    const barMatch = pdfTxt.match(/1\.2 w\n\[\] 0 d\n([\d.]+) ([\d.]+) m ([\d.]+) \2 l S/);
    expect(barMatch, "50.00 mm scale bar vector line").toBeTruthy();
    const x0Pt = Number(barMatch![1]);
    const x1Pt = Number(barMatch![3]);
    const measuredMm = ((x1Pt - x0Pt) * 25.4) / 72;
    expect(Math.abs(measuredMm - 50.0)).toBeLessThanOrEqual(0.02);
  });

  it("writes a Cricut-clean vector cut SVG in mm with <g id='cut'>, flat-filled closed paths, and zero forbidden elements", () => {
    const sheetPlan = ST.planStickerSheet(sampleDecals, { edition: "pro" });
    const svg: string = ST.stickersCutSvg(sheetPlan);

    expect(svg).toContain(`width="${sheetPlan.activeBoxMm.w}mm"`);
    expect(svg).toContain(`height="${sheetPlan.activeBoxMm.h}mm"`);
    expect(svg).toContain('<g id="cut">');
    expect(svg).toContain('id="cut-line"');
    expect(svg).toContain('fill="#1b2238"');
    expect(svg).toContain('fill-rule="evenodd"');

    // M2 Gate: SVG must have NO image, clipPath, text, or pattern elements (nor fold lines inside cut group)
    expect(svg).not.toMatch(/<(image|clipPath|text|pattern|style|defs)\b/i);
    const pathMatches = [...svg.matchAll(/<path\b[^>]*d="([^"]+)"[^>]*\/>/g)];
    expect(pathMatches).toHaveLength(sheetPlan.items.length);
    for (const pm of pathMatches) {
      expect(pm[1].trim().endsWith("Z")).toBe(true);
    }
  });

  it("writes a Silhouette Basic compatible ASCII DXF in millimetres ($INSUNITS = 4) with closed POLYLINEs on layer CUT", () => {
    const sheetPlan = ST.planStickerSheet(sampleDecals, { edition: "pro" });
    const dxf: string = ST.stickersCutDxf(sheetPlan);
    expect(dxf).toContain("$ACADVER\n1\nAC1009");
    expect(dxf).toContain("$INSUNITS\n70\n4");
    const polyCount = (dxf.match(/\nPOLYLINE\n8\nCUT\n66\n1\n70\n1\n/g) ?? []).length;
    // 5 flat faces (each 1 outer + 1 mouth-ridge hole = 10) + 2 shirts (2) + 1 craft cutout (1) = 13 closed polylines
    expect(polyCount).toBe(13);
    expect(dxf.trim().endsWith("EOF")).toBe(true);
  });

  it("writes a transparent print-then-cut RGBA PNG with valid zlib IDAT, truthful pHYs DPI, and 1.0 mm colour bleed", () => {
    const singlePlan = ST.planStickerSheet([{ kind: "shirt", shirtId: "spark_tee" }], { edition: "pro" }, { shirtHex: "#FF6B4A" });
    const pngBytes: Uint8Array = ST.stickersToPng(singlePlan, sampleSources, { dpi: 300 });
    const chunks = parsePngChunks(pngBytes);
    expect(chunks.map((c) => c.type)).toEqual(["IHDR", "pHYs", "IDAT", "IEND"]);

    const ihdr = chunks[0]!.data;
    const w = ihdr.readUInt32BE(0);
    const h = ihdr.readUInt32BE(4);
    expect(ihdr[9]).toBe(6); // RGBA

    const phys = chunks[1]!.data;
    expect(phys.readUInt32BE(0)).toBe(Math.round(300 / 0.0254));
    expect(phys[8]).toBe(1);

    const rawScanlines = inflateSync(chunks[2]!.data);
    expect(rawScanlines.length).toBe((w * 4 + 1) * h);
    // Corner pixel `(0, 0)` in sheet margin is completely transparent (`alpha == 0`)
    expect(rawScanlines[4]).toBe(0);

    // Check 1.0 mm bleed right outside the shirt's top edge (`x = it.x + it.w/2`, `y = it.y - 0.5 mm`): must be opaque!
    const it = singlePlan.items[0];
    const pxPerMm = 300 / 25.4;
    const bx = Math.round((it.x + it.w * 0.5) * pxPerMm);
    const by = Math.round((it.y - 0.5) * pxPerMm);
    const bleedAlpha = rawScanlines[by * (w * 4 + 1) + 1 + bx * 4 + 3];
    expect(bleedAlpha).toBe(255);
  });

  it("bundles stickers/* into buildPrintPackFiles without leaking any pixel data into layout.json or README.txt", () => {
    const state = {
      edition: "pro", category: "human", head: "kid", faceInsert: "flat", expr: "selfie", selfie: true,
      skin: "warm_peach", shirt: "spark_tee", pants: "off", hair: "off", hat: "buds",
      back: "off", prop: "off", ears: "off", tail: "off", vehicle: "none",
    };
    const bom = B.resolveSceneBom(state);
    const tri = K.parseStl(readFileSync(pub("/kip/stls/hand_l.stl")));
    const prepared = [K.prepareItem({ id: "hand_l", file: "/kip/stls/hand_l.stl", qty: 1, hex: "#F3BA95" }, tri)];
    const plan = K.planColorPlates(prepared, P.createDefaultProfile());
    const stickerFiles = ST.buildStickerPackFiles(bom.decals, state, sampleSources, { dpi: 120 });
    expect(stickerFiles.map((f: any) => f.name)).toEqual([
      "stickers/sticker-sheet.pdf",
      "stickers/stickers.png",
      "stickers/stickers-cut.svg",
      "stickers/stickers-cut.dxf",
    ]);

    const pack = K.buildPrintPackFiles({ plan, bom, state, stickerFiles });
    const readme = pack.find((f: any) => f.name === "README.txt")!.data as string;
    const layout = pack.find((f: any) => f.name === "layout.json")!.data as string;
    expect(readme).toContain("stickers/sticker-sheet.pdf");
    expect(layout).not.toContain("data:image");
    expect(JSON.parse(layout).decals).toEqual([
      { kind: "shirt", shirtId: "spark_tee", planeMm: [18.8, 21.6] },
      { kind: "selfie_face", expr: "selfie", faceInsert: "flat" },
    ]);
  });
});
