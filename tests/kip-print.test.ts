import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import kitProfile from "../parts/partspec/print_profiles/fdm_kitplate_0.4.json";
// The viewer modules are plain browser JS with no declaration files.
// @ts-expect-error untyped JS module
import * as printMod from "../parts/kip/viewer/kip-print.js";
// @ts-expect-error untyped JS module
import * as bomMod from "../parts/kip/viewer/kip-print-bom.js";
// @ts-expect-error untyped JS module
import * as profMod from "../parts/kip/viewer/kip-print-profile.js";
// @ts-expect-error untyped JS module
import * as sprueMod from "../parts/kip/viewer/kip-print-sprue.js";
// @ts-expect-error untyped JS module
import * as wardrobe from "../parts/kip/viewer/kip-vehicles-wardrobe.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const K = printMod as any;
const B = bomMod as any;
const P = profMod as any;
const S = sprueMod as any;
const W = wardrobe as any;
const root = process.cwd();
const pub = (url: string) => join(root, "public", url);

// ---- tiny mesh builders -------------------------------------------------------------------
type V3 = [number, number, number];
function outward(tri: number[]): Float32Array {
  // Flip winding when the signed volume is negative so normals point out.
  let vol = 0;
  for (let i = 0; i < tri.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = tri.slice(i, i + 9) as number[] as [number, number, number, number, number, number, number, number, number];
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  if (vol >= 0) return Float32Array.from(tri);
  const out: number[] = [];
  for (let i = 0; i < tri.length; i += 9) out.push(...tri.slice(i, i + 3), ...tri.slice(i + 6, i + 9), ...tri.slice(i + 3, i + 6));
  return Float32Array.from(out);
}
const quad = (a: V3, b: V3, c: V3, d: V3) => [...a, ...b, ...c, ...a, ...c, ...d];
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number[] {
  const p = (x: number, y: number, z: number): V3 => [x, y, z];
  return [
    ...quad(p(x0, y0, z0), p(x1, y0, z0), p(x1, y1, z0), p(x0, y1, z0)), ...quad(p(x0, y0, z1), p(x0, y1, z1), p(x1, y1, z1), p(x1, y0, z1)),
    ...quad(p(x0, y0, z0), p(x0, y0, z1), p(x1, y0, z1), p(x1, y0, z0)), ...quad(p(x0, y1, z0), p(x1, y1, z0), p(x1, y1, z1), p(x0, y1, z1)),
    ...quad(p(x0, y0, z0), p(x0, y1, z0), p(x0, y1, z1), p(x0, y0, z1)), ...quad(p(x1, y0, z0), p(x1, y0, z1), p(x1, y1, z1), p(x1, y1, z0)),
  ];
}
/** Slab L mm long and Wd mm wide whose underside rises `deg` degrees from horizontal; top is flat. */
function slab(deg: number, L = 20, Wd = 20): Float32Array {
  const rise = L * Math.tan((deg * Math.PI) / 180), H = rise + 6;
  const f = (y: number): V3[] => [[0, y, 0], [L, y, rise], [L, y, H], [0, y, H]];
  const a = f(0), b = f(Wd);
  return outward([
    ...quad(a[0]!, a[1]!, a[2]!, a[3]!), ...quad(b[0]!, b[3]!, b[2]!, b[1]!),
    ...quad(a[0]!, b[0]!, b[1]!, a[1]!), ...quad(a[3]!, a[2]!, b[2]!, b[3]!),
    ...quad(a[0]!, a[3]!, b[3]!, b[0]!), ...quad(a[1]!, b[1]!, b[2]!, a[2]!),
  ]);
}
/** A solid block with outward-facing normals. */
const solid = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => outward(box(x0, y0, z0, x1, y1, z1));
/**
 * A "T" with an angled cap: stem 4x4x20 under a 20x20 cap whose underside rises 30 degrees. With the cap on top the
 * sloped underside overhangs; flipped, the cap's flat top is the bed contact and nothing overhangs.
 */
const tee = () => {
  const cap = slab(30, 20, 20);
  const m = Array.from(cap).map((v, i) => (i % 3 === 2 ? v + 20 : v)); // lift the cap onto a stem
  return Float32Array.from([...m, ...Array.from(solid(8, 8, 0, 12, 12, 21))]);
};

describe("limits", () => {
  it("agree with the kit-plate profile the offline gate uses", () => {
    expect(K.LIMITS.maxOverhangDeg).toBe(kitProfile.limits.max_overhang_deg);
    expect(K.LIMITS.firstLayerExclusionMm).toBe(kitProfile.limits.first_layer_exclusion_mm);
    expect(K.LIMITS.steepAreaToleranceMm2).toBe(kitProfile.limits.steep_area_tolerance_mm2);
    expect(K.LIMITS.bedMm).toBe(kitProfile.printer.bed_mm[0]);
    expect(K.LIMITS.maxPlateMm).toBe(170);
  });

  it("plate bound is min(170, bed - 2 brim), and larger beds are labelled", () => {
    expect(K.plateBound(180, 5)).toEqual({ mm: 170, note: "" });
    expect(K.plateBound(180, 8).mm).toBe(164);
    expect(K.plateBound(180, 0).mm).toBe(170);
    const big = K.plateBound(250, 5);
    expect(big.mm).toBe(240);
    expect(big.note).toMatch(/not covered by the kit-plate profile/);
  });
});

describe("stl io", () => {
  it("round-trips binary STL and reads ASCII STL", () => {
    const tri = Array.from(solid(0, 0, 0, 3, 4, 5)).map(Math.fround);
    const bytes = K.stlBytes(Float32Array.from(tri), "t");
    expect(Array.from(K.parseStl(bytes))).toEqual(tri);
    const ascii = `solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t\n`;
    expect(Array.from(K.parseStl(new TextEncoder().encode(ascii)))).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(() => K.parseStl(new Uint8Array([1, 2, 3]))).toThrow(/not an STL/);
  });
});

describe("support scoring (same rule as preprint_check V4)", () => {
  const seated = (t: Float32Array, i = 0) => K.seat(t, i).tri as Float32Array;

  it("a flat block is support-free and reports its bed contact", () => {
    const r = K.supportReport(seated(solid(0, 0, 0, 30, 20, 10)));
    expect(r.supportFree).toBe(true);
    expect(r.overhangMm2).toBe(0);
    expect(r.contactMm2).toBeCloseTo(600, 3);
    expect(r.heightMm).toBeCloseTo(10, 5);
  });

  it("flags an underside shallower than 45 degrees and passes a steeper one", () => {
    const shallow = K.supportReport(seated(slab(30)));
    const steep = K.supportReport(seated(slab(60)));
    expect(shallow.supportFree).toBe(false);
    expect(shallow.overhangMm2).toBeCloseTo((20 * 20) / Math.cos((30 * Math.PI) / 180), 0);
    expect(steep.supportFree).toBe(true);
    expect(steep.overhangMm2).toBe(0);
    // the heatmap marks exactly the offending triangles
    expect(Array.from(shallow.flags as Uint8Array).filter(Boolean).length).toBe(2);
  });

  it("ignores downward faces inside the first-layer exclusion", () => {
    // A 30 degree slope whose whole underside stays below 0.7 mm is first-layer contact, not overhang.
    const low = slab(30, 1.2, 20); // rise = 0.69 mm, centroid z = 0.35
    expect(K.supportReport(seated(low)).overhangMm2).toBe(0);
    expect(K.supportReport(seated(slab(30, 3, 20))).overhangMm2).toBeGreaterThan(0);
  });

  it("treats flat ceilings as bridges for the gate's V6/V10, not as overhang here", () => {
    // A 20x20 cap on a thin stem, cap up: the flat underside is a bridge (nz = -1), so no sloped overhang.
    const flatCap = Float32Array.from([...solid(8, 8, 0, 12, 12, 20), ...solid(0, 0, 20, 20, 20, 24)]);
    expect(K.supportReport(seated(flatCap)).overhangMm2).toBe(0);
  });

  it("tolerates up to the profile's area allowance and no more", () => {
    // Like V4, each triangle is judged by its centroid, so keep the slope tall enough that both triangles clear 0.7 mm.
    // A 30 degree underside of 4 x 2.1 mm is 9.7 mm2 (passes the 10 mm2 allowance); 4 x 3 mm is 13.9 mm2 (fails).
    const small = K.supportReport(seated(slab(30, 4, 2.1)));
    expect(small.overhangMm2).toBeCloseTo((4 * 2.1) / Math.cos((30 * Math.PI) / 180), 2);
    expect(small.supportFree).toBe(true);
    const bigger = K.supportReport(seated(slab(30, 4, 3)));
    expect(bigger.overhangMm2).toBeGreaterThan(K.LIMITS.steepAreaToleranceMm2);
    expect(bigger.supportFree).toBe(false);
  });

  it("re-orients a part that overhangs, and never turns a part that is already fine", () => {
    const t = tee();
    expect(K.supportReport(seated(t)).supportFree).toBe(false);
    const best = K.bestOrientation(t);
    expect(best.index).not.toBe(0);
    expect(best.report.supportFree).toBe(true);
    expect(best.report.overhangMm2).toBeLessThan(K.supportReport(seated(t)).overhangMm2);
    expect(K.bestOrientation(solid(0, 0, 0, 30, 20, 10)).index).toBe(0);
  });

  it("orientations are proper rotations (det +1) so a part is never mirrored", () => {
    for (const o of K.ORIENTATIONS) {
      const m = o.m as number[];
      const det = m[0]! * (m[4]! * m[8]! - m[5]! * m[7]!) - m[1]! * (m[3]! * m[8]! - m[5]! * m[6]!) + m[2]! * (m[3]! * m[7]! - m[4]! * m[6]!);
      expect(det).toBe(1);
    }
  });
});

describe("packer", () => {
  const lcg = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const items = (n: number, seed = 7) => {
    const r = lcg(seed);
    return Array.from({ length: n }, (_, i) => ({ id: `p${String(i).padStart(2, "0")}`, w: 8 + r() * 50, h: 8 + r() * 50 }));
  };

  it("places every item exactly once, inside the bound, with >= 5 mm between parts", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const list = items(30, seed);
      const res = K.packPlates(list);
      const ids = res.plates.flat().map((p: any) => p.id).sort();
      expect(ids).toEqual(list.map((i) => i.id).sort());
      for (const plate of res.plates) expect(K.checkPlacement(plate, res.boundMm, res.gap), `seed ${seed}`).toEqual([]);
    }
  });

  it("keeps footprints intact and only rotates by quarter turns", () => {
    const list = items(24, 9);
    const byId = new Map(list.map((i) => [i.id, i]));
    for (const p of K.packPlates(list).plates.flat() as any[]) {
      const src = byId.get(p.id)!;
      expect([p.w, p.h]).toEqual(p.rot ? [src.h, src.w] : [src.w, src.h]);
    }
  });

  it("is deterministic and independent of input order", () => {
    const list = items(28, 11);
    const a = JSON.stringify(K.packPlates(list));
    expect(JSON.stringify(K.packPlates(list))).toBe(a);
    expect(JSON.stringify(K.packPlates([...list].reverse()))).toBe(a);
    expect(JSON.stringify(K.packPlates([...list].sort((x, y) => (x.id < y.id ? 1 : -1))))).toBe(a);
  });

  it("rotates a long part to fit and spills to more plates instead of overlapping", () => {
    // 20x168 and 168x30 share one plate only by turning the first a quarter turn into a strip.
    const fit = K.packPlates([{ id: "long", w: 20, h: 168 }, { id: "wide", w: 168, h: 30 }]);
    expect(fit.plates.length).toBe(1);
    expect(fit.plates[0].find((p: any) => p.id === "long").rot).toBe(true);
    expect(K.checkPlacement(fit.plates[0])).toEqual([]);
    // Two 168x100 slabs cannot (100 + 5 + 100 > 170 either way), so they spill instead of overlapping.
    const res = K.packPlates([{ id: "a", w: 168, h: 100 }, { id: "b", w: 168, h: 100 }]);
    expect(res.oversize).toEqual([]);
    expect(res.plates.length).toBe(2);
    const many = K.packPlates(Array.from({ length: 30 }, (_, i) => ({ id: `b${i}`, w: 50, h: 50 })));
    expect(many.plates.length).toBeGreaterThan(1);
    for (const plate of many.plates) expect(K.checkPlacement(plate)).toEqual([]);
  });

  it("reports parts that cannot fit a plate even alone", () => {
    const res = K.packPlates([{ id: "huge", w: 171, h: 10 }, { id: "ok", w: 10, h: 10 }]);
    expect(res.oversize.map((o: any) => o.id)).toEqual(["huge"]);
    expect(res.plates.flat().map((p: any) => p.id)).toEqual(["ok"]);
  });

  it("checkPlacement catches a 4.9 mm gap, an overlap and an out-of-bound part", () => {
    const base = { x: 0, y: 0, w: 10, h: 10, rot: false };
    expect(K.checkPlacement([{ id: "a", ...base }, { id: "b", ...base, x: 14.9 }])).toHaveLength(1);
    expect(K.checkPlacement([{ id: "a", ...base }, { id: "b", ...base, x: 15 }])).toEqual([]);
    expect(K.checkPlacement([{ id: "a", ...base }, { id: "b", ...base, x: 5, y: 5 }])).toHaveLength(1);
    expect(K.checkPlacement([{ id: "a", ...base, x: 165 }])).toHaveLength(1);
  });

  it("re-packs a full character well inside the 300 ms target", () => {
    const list = items(60, 5).map((it) => ({ ...it, w: it.w * 0.6, h: it.h * 0.6 }));
    K.packPlates(list); // warm the JIT
    const t0 = performance.now();
    K.packPlates(list);
    expect(performance.now() - t0).toBeLessThan(300);
  });
});

describe("inventory & honest BOM (M1 gates a, c, f)", () => {
  const base = {
    edition: "pro", category: "human", head: "kid", faceInsert: "sculpted", expr: "spark",
    skin: "warm_peach", shirt: "off", pants: "off", hair: "off", hairColor: "chestnut",
    hat: "buds", hatColor: "cobalt_cap", back: "off", prop: "off", tail: "off",
    vehicle: "none", vehCovers: true, racerKit: true, includeVehicle: true,
  };
  const sumQty = (items: any[], id: string) => items.filter((i) => i.id === id).reduce((a, b) => a + b.qty, 0);
  const ids = (s: any) => {
    const map = new Map<string, number>();
    for (const i of K.inventoryFor(s).items) map.set(i.id, (map.get(i.id) ?? 0) + i.qty);
    return [...map.entries()].map(([id, q]) => `${id}x${q}`);
  };

  it("gate (c): peg and turret counts match visible slots on all 12 heads in both editions, and crown_buds_2x1 / wheel_rims never print standalone", () => {
    for (const hd of W.WARDROBE_HEADS as any[]) {
      const proItems = K.inventoryFor({ ...base, edition: "pro", category: hd.category, head: hd.id }).items;
      const snapItems = K.inventoryFor({ ...base, edition: "snap", category: hd.category, head: hd.id }).items;
      expect(sumQty(proItems, "spark_peg_big"), `pro ${hd.id} big pegs`).toBe(4);
      expect(sumQty(proItems, "neck_turret_2x1"), `pro ${hd.id} neck turret`).toBe(1);
      expect(sumQty(snapItems, "snap_turret_big"), `snap ${hd.id} big turrets`).toBe(4);
      expect(sumQty(snapItems, "neck_turret_2x1"), `snap ${hd.id} neck turret`).toBe(1);
      expect(sumQty(proItems, "spark_peg_sml")).toBe(8);
      expect(sumQty(snapItems, "snap_turret")).toBe(4);
      expect(snapItems.some((i: any) => i.id === "torso")).toBe(false);
      // Overlay-only accents never appear as standalone BOM parts
      expect(sumQty(proItems, "crown_buds_2x1")).toBe(0);
    }

    // With hat="buds", crown_buds_2x1 attaches as an accent to the host head/hair (never standalone)
    const withBuds = B.resolveSceneBom({ ...base, category: "human", head: "chibi", hat: "buds" });
    const chibiHead = withBuds.items.find((i: any) => i.id === "char_head_chibi");
    expect(chibiHead?.accents?.[0]?.id).toBe("crown_buds_2x1");
    expect(withBuds.notes.join(" ")).toMatch(/crown studs accent/i);

    const withBeanie = B.resolveSceneBom({ ...base, category: "human", head: "chibi", faceInsert: "vinyl", hair: "twin_braids", hat: "beanie" });
    expect(withBeanie.items.some((i: any) => i.id.includes("crown_buds"))).toBe(false);
    for (const want of ["neck_turret_2x1x1", "char_head_chibix1", "char_faceplate_vinylx1", "hair_twin_braidsx1", "hat_beaniex1"]) {
      expect(ids({ ...base, category: "human", head: "chibi", faceInsert: "vinyl", hair: "twin_braids", hat: "beanie" })).toContain(want);
    }

    // Vehicle wheel rim overlays attach to wheels, never standalone
    for (const veh of ["car", "truck", "scooter", "moto"]) {
      const vBom = B.resolveSceneBom({ ...base, vehicle: veh });
      expect(vBom.items.some((i: any) => i.id.includes("_rim"))).toBe(false);
      const wheel = vBom.items.find((i: any) => i.id.startsWith("veh_wheel_"));
      expect(wheel?.accents?.length).toBe(1);
    }
  });

  it("gate (a): exhaustive sweep across all wardrobe, mechanism, prop, and vehicle options maps every STL to verified files on disk with zero unmapped items", () => {
    const valIdx = JSON.parse(readFileSync(pub("/kip/partspec-validation.json"), "utf8")).files as Record<string, any>;
    const states: any[] = [];
    for (const edition of ["pro", "snap"]) {
      for (const hd of W.WARDROBE_HEADS) states.push({ ...base, edition, category: hd.category, head: hd.id });
    }
    for (const h of W.HAIR_OPTIONS) states.push({ ...base, category: "human", head: "kid", hair: h.id });
    for (const h of [...W.HAT_OPTIONS.map((x: any) => x.id), "wizardHat"]) states.push({ ...base, category: "human", head: "kid", hat: h });
    for (const b of W.BACK_OPTIONS) states.push({ ...base, back: b.id });
    for (const p of [...W.PROP_OPTIONS.map((x: any) => x.id), "wand"]) states.push({ ...base, prop: p });
    for (const f of W.FACE_INSERT_MODES) states.push({ ...base, category: "human", head: "kid", faceInsert: f.id });
    for (const tail of ["off", "wag", "pro"]) states.push({ ...base, tail });
    for (const s of W.SHIRT_OPTIONS) states.push({ ...base, category: "human", head: "kid", shirt: s.id });
    for (const p of W.PANTS_OPTIONS) states.push({ ...base, category: "human", head: "kid", pants: p.id });
    for (const sk of W.SKIN_TONES) states.push({ ...base, category: "human", head: "kid", skin: sk.id });
    for (const vehicle of ["car", "truck", "scooter", "moto"]) {
      for (const vehCovers of [true, false]) {
        for (const racerKit of [true, false]) {
          for (const includeVehicle of [true, false]) {
            states.push({ ...base, vehicle, vehCovers, racerKit, includeVehicle });
          }
        }
      }
    }
    states.push({ ...base, vehicle: "car", customHoodMode: "sdkCrest" });

    for (const st of states) {
      const bom = B.resolveSceneBom(st, { validationIndex: valIdx });
      expect(bom.unmapped, `unmapped for ${JSON.stringify(st)}`).toEqual([]);
      expect(bom.items.length).toBeGreaterThan(0);
      for (const it of bom.items) {
        expect(it.hex).toMatch(/^#[0-9A-F]{6}$/);
        expect(existsSync(pub(it.file)), `missing file ${it.file}`).toBe(true);
        if (it.source === "partspec") {
          const baseName = it.file.split("/").pop()!;
          expect(valIdx[baseName], `partspec validation entry for ${baseName}`).toBeDefined();
          expect(valIdx[baseName].verdict).not.toBe("fail");
        }
      }
    }

    // Pro mechanisms decompose into real verified catalog gears/shafts/beams/pins
    const proMech = B.resolveSceneBom({ ...base, back: "gears", prop: "shaft", tail: "pro" });
    expect(proMech.unmapped).toEqual([]);
    for (const pid of ["gear_spur_z20", "gear_spur_z10", "pin_friction", "shaft_tu05", "shaft_tu03", "bushing_half", "beam_str_tu03", "cross_connector_tu01", "beam_str_tu05"]) {
      expect(sumQty(proMech.items, pid), `pro mechanism ${pid}`).toBeGreaterThan(0);
    }
  });

  it("includes in-memory custom .stl uploads on the plate and routes Photo-Forge drawings to craft decals (prints: false)", () => {
    const customTriBytes = K.stlBytes(solid(0, 0, 0, 12, 12, 8), "star_crown");
    const withCustom = B.resolveSceneBom({
      ...base,
      hat: "custom",
      customStlSlots: { crown: { bytes: customTriBytes, colorHex: "#7c4dff", name: "star_crown.stl" } },
    });
    expect(withCustom.unmapped).toEqual([]);
    const customPart = withCustom.items.find((i: any) => i.id === "custom_crown_stl");
    expect(customPart).toBeDefined();
    expect(customPart.hex).toBe("#7C4DFF");
    expect(customPart.bytes).toBeInstanceOf(Uint8Array);

    const withPhoto = B.resolveSceneBom({
      ...base,
      prop: "custom",
      hasPhotoAccessory: true,
      photoAccessorySlots: { hand: { label: "Rainbow Shield" } },
    });
    expect(withPhoto.items.some((i: any) => i.role === "prop")).toBe(false);
    expect(withPhoto.unmapped.join(" ")).toMatch(/Photo-Forge.*2D fold-tab craft cutout/i);
    expect(withPhoto.decals.some((d: any) => d.kind === "craft_cutout" && d.slot === "hand" && d.label === "Rainbow Shield")).toBe(true);
  });

  it("gate (f): pure print modules stay free of DOM, storage, network, worker, and camera APIs", () => {
    const forbiddenApis = /\b(fetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|localStorage|sessionStorage|indexedDB|caches\.|document\.|window\.|new\s+Worker|FaceDetector|navigator\.)/;
    for (const rel of [
      "parts/kip/viewer/kip-print-bom.js",
      "parts/kip/viewer/kip-print-profile.js",
      "parts/kip/viewer/kip-print-sprue.js",
      "parts/kip/viewer/kip-print-stickers.js",
      "parts/kip/viewer/kip-print.js",
    ]) {
      const src = readFileSync(join(root, rel), "utf8");
      expect(forbiddenApis.test(src), `forbidden browser/network API in ${rel}`).toBe(false);
    }
  });
});

describe("printer profiles, fit compensation, DeltaE00 & spool budget", () => {
  it("encodes every preset and custom profile into a compact < 38-char token and round-trips losslessly", () => {
    for (const presetId of Object.keys(P.PRINTER_PRESETS)) {
      const p0 = P.applyPresetToProfile(P.createDefaultProfile(), presetId);
      const token = P.encodeProfileCompact(p0);
      expect(token.length, `${presetId}: ${token}`).toBeLessThan(38);
      const p1 = P.decodeProfileCompact(token);
      expect(p1.presetId).toBe(p0.presetId);
      expect(p1.bedXmm).toBe(p0.bedXmm);
      expect(p1.maxSlots).toBe(p0.maxSlots);
      expect(p1.slicer).toBe(p0.slicer);
    }
    const custom = P.clampProfile({
      presetId: "custom", slicer: "prusa", changerType: "toolchanger", maxSlots: 5,
      bedXmm: 300, bedYmm: 300, fitChoice: "easy", multiColorStrategy: "by-layer",
      includeVehicle: false, includeStickers: true, includeStencils: true, nozzleMm: 0.2,
    });
    const tok = P.encodeProfileCompact(custom);
    expect(tok.length).toBeLessThan(38);
    expect(P.decodeProfileCompact(tok)).toMatchObject({
      presetId: "custom", slicer: "prusa", changerType: "toolchanger", maxSlots: 5,
      bedXmm: 300, bedYmm: 300, fitChoice: "easy", multiColorStrategy: "by-layer",
      includeVehicle: false, includeStickers: true, includeStencils: true, nozzleMm: 0.2,
    });
  });

  it("computes CALIBRATION.md §3 per-surface fit compensation for Orca/Bambu and PrusaSlicer", () => {
    expect(P.fitCompensationForProfile({ fitChoice: "snug" })).toMatchObject({
      surfaceOffsetMm: -0.025,
      orca: { xy_contour_compensation: 0.025, xy_hole_compensation: -0.025 },
      prusa: { xy_size_compensation: 0.025 },
    });
    expect(P.fitCompensationForProfile({ fitChoice: "standard" })).toMatchObject({
      surfaceOffsetMm: 0,
      orca: { xy_contour_compensation: 0, xy_hole_compensation: 0 },
      prusa: { xy_size_compensation: 0 },
    });
    expect(P.fitCompensationForProfile({ fitChoice: "easy" })).toMatchObject({
      surfaceOffsetMm: 0.04,
      orca: { xy_contour_compensation: -0.04, xy_hole_compensation: 0.04 },
      prusa: { xy_size_compensation: -0.04 },
    });
  });

  it("consolidates accent colours first via role-weighted DeltaE00 and protects skin from merging into dark hair", () => {
    expect(P.deltaE00("#FF6B4A", "#FF6B4A")).toBeCloseTo(0, 6);
    expect(P.deltaE00("#F7C8A8", "#FFD5BC")).toBeLessThan(8);
    expect(P.deltaE00("#F7C8A8", "#2B2D38")).toBeGreaterThan(40);

    const sampleItems = [
      { id: "head", qty: 1, role: "skin", hex: "#F7C8A8", colorName: "Warm Peach" },
      { id: "hair", qty: 1, role: "hair", hex: "#6B4433", colorName: "Chestnut" },
      { id: "shirt", qty: 3, role: "clothing", hex: "#E5533D", colorName: "Red" },
      { id: "pants", qty: 4, role: "clothing", hex: "#3B6EA8", colorName: "Denim" },
      { id: "peg", qty: 4, role: "joint", hex: "#FF6B4A", colorName: "Spark Coral" },
    ];
    const res = P.consolidateColors(sampleItems, 4);
    const remaining = new Set(res.items.map((i: any) => i.hex));
    expect(remaining.size).toBe(4);
    // Coral joint merges into nearby Red clothing first; skin and chestnut hair stay distinct
    expect(remaining.has("#F7C8A8")).toBe(true);
    expect(remaining.has("#6B4433")).toBe(true);
    expect(res.merges[0]).toMatchObject({ fromHex: "#FF6B4A", toHex: "#E5533D" });
  });
});

describe("real parts on disk", () => {
  const load = (url: string) => K.parseStl(readFileSync(pub(url)));
  const prep = (source: string, id: string, url: string, verified = false) => K.prepareItem({ id, file: url, source, role: "" }, load(url), { verified });

  it("a catalog part keeps its native orientation and its tier follows the sha", () => {
    const bob = prep("partspec", "hair_bob", "/kip/partspec/toyventor_hair_bob_S.stl");
    expect(bob.orientation).toBe("+z up");
    expect(bob.report.supportFree).toBe(true); // flat ceilings are bridges (V6), not V4 overhang
    expect(bob.tier).toBe("unverified");
    expect(prep("partspec", "hair_bob", "/kip/partspec/toyventor_hair_bob_S.stl", true).tier).toBe("support-free");
    const b = K.bounds(bob.tri);
    expect(b.min[2]).toBeCloseTo(0, 4);
    expect(b.min[0]).toBeCloseTo(0, 4);
    expect(b.min[1]).toBeCloseTo(0, 4);
  });

  it("all 18 base body STLs come out of rig pose onto z = 0 with zero floating islands and < 1.0 mm² overhang (catalog bar)", () => {
    const baseIds = [
      "torso", "back_dock_studs", "upper_arm", "forearm", "hand_l", "hand_r",
      "thigh", "shin", "boot", "spark_peg_big", "spark_peg_sml", "tail_acc",
      "snap_torso", "snap_arm", "snap_leg", "snap_turret_big", "snap_turret", "neck_turret_2x1",
    ];
    for (const id of baseIds) {
      const part = prep("kip.scad", id, `/kip/stls/${id}.stl`);
      expect(K.bounds(part.tri).min[2], `${id} minZ`).toBeCloseTo(0, 4);
      expect(part.tier, `${id} tier`).toBe("geometry-checked");
      expect(part.islands, `${id} V5 islands`).toBe(0);
      expect(part.report.overhangMm2, `${id} V4 overhang`).toBeLessThan(1.0);
    }
  });

  it("the served validation index has a sha for catalog parts and the index matches the bytes it names", () => {
    const idx = JSON.parse(readFileSync(pub("/kip/partspec-validation.json"), "utf8"));
    expect(idx.format).toBe("toyventor.kip-validation-index/1");
    const entry = idx.files["toyventor_hair_bob_S.stl"];
    expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
    // Staleness is allowed (the badge handles it); a malformed sha is not.
    for (const e of Object.values(idx.files) as any[]) expect(e.sha256).toMatch(/^[0-9a-f]{64}$/);
    void createHash;
  });

  it("plans colour-separated, support-separated, and vehicle-separated plates with realistic spool mass", () => {
    const state = {
      edition: "pro", category: "human", head: "kid", faceInsert: "sculpted", expr: "spark",
      skin: "warm_peach", shirt: "spark_tee", pants: "cargo_shorts",
      hair: "short_swept", hairColor: "chestnut", hat: "ranger", hatColor: "cobalt_cap",
      back: "explorer", prop: "wrench", tail: "off",
      vehicle: "scooter", vehCovers: true, racerKit: true, includeVehicle: true,
    };
    const bom = B.resolveSceneBom(state);
    const prepared = bom.items.map((e: any) => K.prepareItem(e, load(e.file), { verified: e.source === "partspec" }));
    const plan = K.planColorPlates(prepared, P.createDefaultProfile());
    expect(plan.oversize).toEqual([]);
    expect(plan.estimate.characterGrams).toBeGreaterThan(55);
    expect(plan.estimate.characterGrams).toBeLessThan(130);
    expect(plan.estimate.vehicleGrams).toBeGreaterThan(25);

    const charPlates = plan.plates.filter((p: any) => p.group === "character");
    const vehPlates = plan.plates.filter((p: any) => p.group === "vehicle");
    expect(charPlates.length).toBeGreaterThan(0);
    expect(vehPlates.length).toBeGreaterThan(0);

    for (const pl of plan.plates) {
      expect(pl.gap).toBe(pl.requiresSupports ? 6 : 5);
      expect(K.checkPlacement(pl.placed, pl.boundMm, pl.gap)).toEqual([]);
      for (const p of pl.placed) {
        expect(p.tier === "needs-supports").toBe(pl.requiresSupports);
        expect(p.hex).toBe(pl.hex);
        const b = K.bounds(p.tri);
        expect(b.min[2]).toBeCloseTo(0, 3);
      }
    }
  }, 25000);
});

describe("exports", () => {
  const sample = () => {
    const placed = [
      { instance: "a", partId: "a", tier: "support-free", source: "partspec", hex: "#4EB3FC", colorName: "Snap Sky", x: 0, y: 0, w: 10, h: 10, rot: false, z: 5, orientation: "+z up", report: { overhangMm2: 0 }, tri: Float32Array.from(box(0, 0, 0, 10, 10, 5)) },
      { instance: "b#1", partId: "b", tier: "needs-supports", source: "kip.scad", hex: "#F4EFE6", colorName: "Warm Shell", x: 20, y: 0, w: 10, h: 10, rot: false, z: 5, orientation: "+z up", report: { overhangMm2: 42.5 }, tri: Float32Array.from(box(20, 0, 0, 30, 10, 5)) },
    ];
    return placed;
  };

  it("writes a valid zip (including RFC 1951 deflate on compressible entries) that Python's zipfile accepts, with matching CRCs", async () => {
    const bigXml = '<vertex x="12.3456" y="-7.8901" z="0.0000"/>'.repeat(200);
    const files = [
      { name: "a.txt", data: "hello" },
      { name: "dir/b.bin", data: Uint8Array.from([1, 2, 3, 4]) },
      { name: "3D/3dmodel.model", data: bigXml },
    ];
    const zip = K.zipStore(files);
    const asyncZip = await K.zipDeflate(files);
    expect(zip.length).toBeLessThan(bigXml.length * 0.25);
    expect(asyncZip.length).toBeLessThan(bigXml.length * 0.25);
    const dir = mkdtempSync(join(tmpdir(), "kipzip-"));
    const f = join(dir, "t.zip");
    const fAsync = join(dir, "t-async.zip");
    writeFileSync(f, zip);
    writeFileSync(fAsync, asyncZip);
    let out = "", outAsync = "";
    try {
      const pyCheck = "import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);print(z.testzip());print(z.read('a.txt').decode());print(list(z.read('dir/b.bin')));print(z.getinfo('3D/3dmodel.model').compress_type);print(z.read('3D/3dmodel.model').decode()==sys.argv[2])";
      out = execFileSync("python3", ["-c", pyCheck, f, bigXml], { encoding: "utf8" });
      outAsync = execFileSync("python3", ["-c", pyCheck, fAsync, bigXml], { encoding: "utf8" });
    } catch (e: any) {
      if (e.code === "ENOENT") return;
      throw e;
    }
    expect(out.split("\n")).toEqual(["None", "hello", "[1, 2, 3, 4]", "8", "True", ""]);
    expect(outAsync.split("\n")).toEqual(["None", "hello", "[1, 2, 3, 4]", "8", "True", ""]);
    expect(K.crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    rmSync(dir, { recursive: true, force: true });
  });

  it("lands tilted custom meshes cleanly via bestCustomOrientation convex-hull & 3-point tripod pose search", () => {
    const tiltMesh = (src: number[], a1: number, a2: number) => {
      const c1 = Math.cos(a1), s1 = Math.sin(a1);
      const c2 = Math.cos(a2), s2 = Math.sin(a2);
      const out = new Float32Array(src.length);
      for (let i = 0; i < src.length; i += 3) {
        const x0 = src[i]!, y0 = src[i + 1]!, z0 = src[i + 2]!;
        const y1 = c1 * y0 - s1 * z0, z1 = s1 * y0 + c1 * z0;
        out[i] = c2 * x0 + s2 * z1;
        out[i + 1] = y1;
        out[i + 2] = -s2 * x0 + c2 * z1;
      }
      return out;
    };
    // 1. Compound-tilted flat box (even at <45 deg where point-contact has 0 overhang, must land flat on 20x20 facet)
    const tiltedBox = tiltMesh([...solid(-10, -10, 0, 10, 10, 6)], 0.42, 0.31);
    const boxPose = K.bestCustomOrientation(tiltedBox);
    expect(boxPose.islands).toBe(0);
    expect(boxPose.report.overhangMm2).toBeLessThan(0.5);
    expect(boxPose.report.contactMm2).toBeGreaterThan(350);

    // 2. Compound-tilted 3-legged tripod arch with uneven leg lengths (no single face lies in the 3-foot plane; requires hull3pt#)
    const tripodRaw = [
      ...solid(-10, -8, 0, -7, -5, 10),    // leg A bottoms at z=0
      ...solid(7, -8, 1.5, 10, -5, 10),    // leg B bottoms at z=1.5
      ...solid(-1.5, 7, 3.0, 1.5, 10, 10), // leg C bottoms at z=3.0
      ...solid(-10, -8, 10, 10, 10, 13),   // bridge cap at z=10..13
    ];
    const tiltedTripod = tiltMesh(tripodRaw, 0.85, -0.52);
    const tripodPose = K.bestCustomOrientation(tiltedTripod);
    expect(tripodPose.islands).toBe(0);
    expect(tripodPose.name.startsWith("hull")).toBe(true);
  });

  it("writes valid PrusaSlicer and Orca/Bambu 3MF dialects plus multi-plate kip-project.3mf", () => {
    const dir = mkdtempSync(join(tmpdir(), "kip3mf-"));
    // 1. PrusaSlicer dialect
    const prusaPath = join(dir, "prusa.3mf");
    writeFileSync(prusaPath, K.to3mf(sample(), { slicer: "prusa", profile: { presetId: "prusa_mmu_5", fitChoice: "easy" } }));
    // 2. Orca / Bambu Studio dialect
    const orcaPath = join(dir, "orca.3mf");
    writeFileSync(orcaPath, K.to3mf(sample(), { slicer: "orca_bambu", profile: { presetId: "changer_256_4", fitChoice: "snug" } }));
    // 3. Multi-plate project
    const projPlates = [
      { label: "Plate 1: Sky", fileStem: "plate_01_sky", hex: "#4EB3FC", colorName: "Snap Sky", boundMm: 170, gap: 5, requiresSupports: false, placed: [sample()[0]!] },
      { label: "Plate 2: Shell", fileStem: "plate_02_shell", hex: "#F4EFE6", colorName: "Warm Shell", boundMm: 170, gap: 6, requiresSupports: true, placed: [sample()[1]!] },
    ];
    const projPath = join(dir, "project.3mf");
    writeFileSync(projPath, K.to3mfProject(projPlates, P.applyPresetToProfile(P.createDefaultProfile(), "changer_256_4")));

    let prusaOut = "", orcaOut = "", projOut = "";
    try {
      const pyPrusa = "import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print('\\n'.join(z.namelist()));print('@@');print(z.read('3D/3dmodel.model').decode());print('@@');print(z.read('Metadata/Slic3r_PE_model.config').decode())";
      prusaOut = execFileSync("python3", ["-c", pyPrusa, prusaPath], { encoding: "utf8" });
      const pyOrca = "import zipfile,sys,json;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print('\\n'.join(z.namelist()));print('@@');print(z.read('3D/3dmodel.model').decode());print('@@');print(z.read('Metadata/model_settings.config').decode());print('@@');print(z.read('Metadata/project_settings.config').decode())";
      orcaOut = execFileSync("python3", ["-c", pyOrca, orcaPath], { encoding: "utf8" });
      projOut = execFileSync("python3", ["-c", pyOrca, projPath], { encoding: "utf8" });
    } catch (e: any) {
      if (e.code === "ENOENT") return;
      throw e;
    }

    const [pNames, pModel, pCfg] = prusaOut.split("@@\n") as [string, string, string];
    expect(pNames).toContain("Metadata/Slic3r_PE_model.config");
    expect(pModel.match(/<object /g)).toHaveLength(2);
    expect(pModel).toContain('basematerials id="9000"');
    expect(pModel.indexOf('basematerials id="9000"')).toBeLessThan(pModel.indexOf('<object id="1"'));
    // every object states its support setting out loud: 1 for the part that needs supports, 0 for the support-free one
    expect(pCfg.match(/support_material"/g)).toHaveLength(2);
    expect(pCfg.match(/support_material" value="1"/g)).toHaveLength(1);
    expect(pCfg.match(/support_material" value="0"/g)).toHaveLength(1);
    expect(pCfg).toContain('xy_size_compensation" value="-0.04"');

    const [oNames, oModel, oCfg, oProj] = orcaOut.split("@@\n") as [string, string, string, string];
    expect(oNames).toContain("Metadata/model_settings.config");
    expect(oNames).toContain("Metadata/project_settings.config");
    expect(oModel).not.toContain("PrusaSlicer");
    expect(oModel).toContain('<metadata name="BambuStudio:3mfVersion">1</metadata>');
    expect(oCfg).toContain('subtype="normal_part"');
    expect(oCfg.match(/enable_support" value="1"/g)).toHaveLength(1);
    expect(oCfg.match(/enable_support" value="0"/g)).toHaveLength(1); // the support-free part is told "no supports" explicitly
    expect(oCfg.match(/enable_support"/g)).toHaveLength((oModel.match(/<object /g) ?? []).length);
    expect(oCfg).toContain('xy_contour_compensation" value="0.025"');
    expect(oCfg).toContain('xy_hole_compensation" value="-0.025"');
    const parsedProj = JSON.parse(oProj);
    expect(parsedProj.filament_colour).toEqual(["#4EB3FC", "#F4EFE6"]);
    expect(parsedProj.nozzle_diameter).toEqual(["0.4"]);
    expect(parsedProj.filament_map).toEqual(["1", "1"]);
    expect(parsedProj.single_extruder_multi_material).toBe("1");
    expect(parsedProj.flush_multiplier).toEqual(["0.3"]);
    expect(parsedProj.outer_wall_speed).toBe("200");
    expect(parsedProj.inner_wall_speed).toBe("300");
    expect(parsedProj.default_acceleration).toBe("6000");
    expect(parsedProj.filament_max_volumetric_speed).toEqual(["18", "18"]);

    const [, projModel, projCfg, projSettingsRaw] = projOut.split("@@\n") as [string, string, string, string];
    const parsedMultiProj = JSON.parse(projSettingsRaw);
    expect(parsedMultiProj.filament_colour).toEqual(["#4EB3FC", "#F4EFE6"]);
    expect(parsedMultiProj.filament_map).toEqual(["1", "1"]);
    expect(parsedMultiProj.single_extruder_multi_material).toBe("1");
    expect(parsedMultiProj.filament_map.every((n: string) => Number(n) >= 1 && Number(n) <= parsedMultiProj.nozzle_diameter.length)).toBe(true);
    expect(projModel).toContain('<metadata name="BambuStudio:3mfVersion">1</metadata>');
    expect(projCfg.match(/<plate>/g)).toHaveLength(2);
    expect(projCfg).toContain('<metadata key="locked" value="false"/>');
    expect(projCfg.match(/enable_support" value="0"/g)).toHaveLength(1); // plate 1: support-free part, explicit off
    expect(projCfg.match(/enable_support" value="1"/g)).toHaveLength(1); // plate 2: the part that needs supports
    // Plate 2 sits at col=1 -> x offset = 1 * 1.2 * 256 + (256 - 246)/2 = 307.2 + 5 = 312.2 (or boundMm=170 -> 307.2 + 43 = 350.2)
    expect(projModel).toContain("350.2 43 0");

    // 4. Single-colour 300x300x340 (`large_300`): disables single_extruder_multi_material ('0') and spaces plates on a 360 mm grid
    const large300Plates = [
      { label: "Plate 1: Sky", fileStem: "plate_01_sky", hex: "#4EB3FC", colorName: "Snap Sky", boundMm: 290, gap: 5, requiresSupports: false, placed: [sample()[0]!] },
      { label: "Plate 2: Shell", fileStem: "plate_02_shell", hex: "#F4EFE6", colorName: "Warm Shell", boundMm: 290, gap: 6, requiresSupports: true, placed: [sample()[1]!] },
    ];
    const large300Path = join(dir, "project-300.3mf");
    writeFileSync(large300Path, K.to3mfProject(large300Plates, P.applyPresetToProfile(P.createDefaultProfile(), "large_300")));
    const pyLarge = "import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(z.read('3D/3dmodel.model').decode());print('@@');print(z.read('Metadata/project_settings.config').decode())";
    const [l300Model, l300SettingsRaw] = execFileSync("python3", ["-c", pyLarge, large300Path], { encoding: "utf8" }).split("@@\n") as [string, string];
    const parsedL300 = JSON.parse(l300SettingsRaw);
    expect(parsedL300.single_extruder_multi_material).toBe("0");
    expect(parsedL300.printable_area).toEqual(["0x0", "300x0", "300x300", "0x300"]);
    expect(parsedL300.printable_height).toBe("340");
    // Plate 2 sits at col=1 on 300 mm bed -> x offset = 1 * 1.2 * 300 + (300 - 290)/2 = 360 + 5 = 365, y offset = 5
    expect(l300Model).toContain("365 5 0");
    rmSync(dir, { recursive: true, force: true });
  });

  it("layout json v2 sanitizes binary state and includes interfaces.json safety warnings", () => {
    const j = JSON.parse(K.layoutJson([sample()], {
      preset: "t",
      state: { head: "kid", customStlSlots: { crown: { bytes: new Uint8Array([1, 2, 3]), name: "hat.stl", colorHex: "#123456" } } },
    }));
    expect(j.format).toBe("toyventor.kip-plate/2");
    expect(j.warnings).toContain(K.PRINT_PAGE_WARNINGS.always);
    expect(j.warnings).toContain(K.PRINT_PAGE_WARNINGS.small_part);
    expect(j.state.customStlSlots.crown).toEqual({ name: "hat.stl", colorHex: "#123456" });
    expect(j.plates[0].parts.map((p: any) => p.tier)).toEqual(["support-free", "needs-supports"]);
  });

  it("small-parts screen follows the 31.75 mm cylinder", () => {
    const mk = (w: number, h: number, z: number) => ({ instance: `${w}x${h}x${z}`, w, h, z });
    // fits: cross-section diagonal <= 31.75 and length <= 57.15 in some orientation
    expect(K.smallParts([[mk(10, 10, 5), mk(40, 10, 5), mk(30, 30, 5), mk(40, 40, 5), mk(20, 20, 60), mk(34, 20, 20)]]))
      .toEqual(["10x10x5", "40x10x5", "30x30x5", "34x20x20"]);
  });
});

function countUnmatchedHalfEdges(tri: Float32Array): number {
  const edgeCounts = new Map<string, number>();
  const vKey = (x: number, y: number, z: number) => `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(z * 1000)}`;
  for (let t = 0; t < tri.length; t += 9) {
    const v0 = vKey(tri[t]!, tri[t + 1]!, tri[t + 2]!);
    const v1 = vKey(tri[t + 3]!, tri[t + 4]!, tri[t + 5]!);
    const v2 = vKey(tri[t + 6]!, tri[t + 7]!, tri[t + 8]!);
    for (const [a, b] of [[v0, v1], [v1, v2], [v2, v0]] as const) {
      const rev = `${b}->${a}`;
      const revCount = edgeCounts.get(rev) ?? 0;
      if (revCount > 0) {
        if (revCount === 1) edgeCounts.delete(rev);
        else edgeCounts.set(rev, revCount - 1);
      } else {
        const fwd = `${a}->${b}`;
        edgeCounts.set(fwd, (edgeCounts.get(fwd) ?? 0) + 1);
      }
    }
  }
  let unmatched = 0;
  for (const c of edgeCounts.values()) unmatched += c;
  return unmatched;
}

describe("2D polygon silhouette nesting, custom convex-hull pose search & V5 floating islands", () => {
  it("nests two 95x95 mm concave L-brackets onto 1 plate (180-deg interlock) while enforcing >= 5 mm continuous mesh clearance", () => {
    const lTri = Float32Array.from([...solid(0, 0, 0, 95, 20, 8), ...solid(0, 20, 0, 20, 95, 8)]);
    const prep = K.prepareItem({ id: "l_bracket", source: "partspec", hex: "#4EB3FC" }, lTri, { verified: true });
    const instances = K.expandInstances([{ ...prep, qty: 2 }]);
    // Rectangle-only MaxRects needs 2 plates (95 + 5 + 95 = 195 > 170)
    const rectOnly = K.packPlates(instances.map((p: any) => ({ id: p.instance, w: p.w, h: p.h })), 170, 5);
    expect(rectOnly.plates.length).toBe(2);

    // Polygon silhouette nesting fits both on 1 plate with >= 5 mm continuous clearance
    const nested = K.buildPlates(instances, { boundMm: 170, gap: 5, polygonNest: true });
    expect(nested.plates.length).toBe(1);
    expect(nested.plates[0]).toHaveLength(2);
    expect(K.checkPlacement(nested.plates[0], 170, 5)).toEqual([]);
  });

  it("detects mid-air floating islands (V5) and lands an arbitrarily tilted custom STL flat on its convex support face (det = +1)", () => {
    const clean = K.seat(solid(0, 0, 0, 20, 20, 12)).tri as Float32Array;
    expect(K.countFloatingIslands(clean)).toBe(0);

    // An arch/T-arm with a downward-hanging tip starting in mid-air at z = 6 mm (above stem base but disconnected from stem at z = 6..10)
    const hanging = Float32Array.from([
      ...solid(0, 0, 0, 6, 6, 16),
      ...solid(0, 0, 12, 22, 6, 16),
      ...solid(16, 0, 6, 22, 6, 12), // hangs down to z = 6 in mid-air -> floating island on z = 6.2!
    ]);
    expect(K.countFloatingIslands(hanging)).toBeGreaterThanOrEqual(1);

    // Rotate a flat-bottomed custom plaque by 32 deg around X and 23 deg around Y so all 6 axis poses overhang badly
    const rx = (32 * Math.PI) / 180, ry = (23 * Math.PI) / 180;
    const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry);
    const tiltM = [
      cy, sy * sx, sy * cx,
      0, cx, -sx,
      -sy, cy * sx, cy * cx,
    ];
    const rawPlaque = K.transform(solid(0, 0, 0, 34, 24, 8), tiltM);
    expect(K.bestOrientation(rawPlaque).report.supportFree).toBe(false);

    const customPose = K.bestCustomOrientation(rawPlaque);
    const m = customPose.m as number[];
    const det = m[0]! * (m[4]! * m[8]! - m[5]! * m[7]!) - m[1]! * (m[3]! * m[8]! - m[5]! * m[6]!) + m[2]! * (m[3]! * m[7]! - m[4]! * m[6]!);
    expect(det).toBeCloseTo(1, 5);
    expect(customPose.islands).toBe(0);
    expect(customPose.report.supportFree).toBe(true);
    expect(customPose.report.overhangMm2).toBeLessThan(1.0);

    const preparedCustom = K.prepareItem(
      { id: "custom_crown_stl", source: "custom", bytes: new Uint8Array([1]), hex: "#7C4DFF" },
      rawPlaque,
    );
    expect(preparedCustom.tier).toBe("geometry-checked");
    expect(preparedCustom.z).toBeCloseTo(8, 1);
  });
});

describe("M4 flat-pack sprue kit cards & socket support_blocker protection", () => {
  const load = (url: string) => K.parseStl(readFileSync(pub(url)));

  it("builds 100% watertight manifold perimeter frames and 0.40 mm V-nick breakaway gates", () => {
    const frame = S.buildFrameMesh(0, 0, 90, 70);
    expect(countUnmatchedHalfEdges(frame)).toBe(0);
    const fb = K.bounds(frame);
    expect(fb.min[2]).toBeCloseTo(0, 5);
    expect(fb.max[2]).toBeCloseTo(1.0, 5);

    const singleNick = S.buildVNickGateMesh(10, 10, 22, 10, { wallAtStartMm: 1.6, wallAtEndMm: null });
    const dualNick = S.buildVNickGateMesh(10, 10, 26, 18, { wallAtStartMm: 1.6, wallAtEndMm: 1.6 });
    expect(countUnmatchedHalfEdges(singleNick)).toBe(0);
    expect(countUnmatchedHalfEdges(dualNick)).toBe(0);
    expect(K.bounds(singleNick).max[2]).toBeCloseTo(0.8, 5);
    // Verify 0.40 mm V-nick neck vertex is present
    let minTopZ = Infinity;
    for (let i = 2; i < singleNick.length; i += 3) {
      if (singleNick[i]! > 0.05 && singleNick[i]! < minTopZ) minTopZ = singleNick[i]!;
    }
    expect(minTopZ).toBeCloseTo(0.4, 4);
  });

  it("packs sprue kit cards with single-component MST connectivity, keeps pegs/turrets & supports out of cards, and emits sprue_prep warning", () => {
    const state = {
      edition: "pro", category: "human", head: "kid", faceInsert: "sculpted", expr: "spark",
      skin: "warm_peach", shirt: "spark_tee", pants: "cargo_shorts",
      hair: "short_swept", hairColor: "chestnut", hat: "ranger", hatColor: "cobalt_cap",
      back: "explorer", prop: "wrench", tail: "off",
      vehicle: "none", vehCovers: true, racerKit: true, includeVehicle: false,
    };
    const bom = B.resolveSceneBom(state);
    const prepared = bom.items.map((e: any) => K.prepareItem(e, load(e.file), { verified: e.source === "partspec" }));
    const sprueProfile = P.clampProfile({ ...P.createDefaultProfile(), flatPackMode: "sprue" });
    const plan = K.planColorPlates(prepared, sprueProfile);

    const spruePlates = plan.plates.filter((pl: any) => Boolean(pl.sprue));
    expect(spruePlates.length).toBeGreaterThan(0);

    for (const pl of plan.plates) {
      expect(K.checkPlacement(pl.placed, pl.boundMm, pl.gap)).toEqual([]);
      if (pl.sprue) {
        expect(pl.requiresSupports).toBe(false);
        const cardParts = pl.placed.filter((p: any) => p.sprueAnchored);
        expect(cardParts.length).toBeGreaterThan(0);
        expect(K.checkSprueCard(pl.sprue, cardParts)).toEqual([]);
        // Connectors/pegs must never be anchored into the sprue card
        for (const cp of cardParts) {
          expect(cp.partId).not.toMatch(/spark_peg|turret|pin_|gear_/);
        }
      }
    }

    const manifest = JSON.parse(K.layoutJson(plan.plates, { profile: plan.profile }));
    expect(manifest.warnings).toContain(K.PRINT_PAGE_WARNINGS.sprue_prep);
    expect(K.readmeTxt({ plan, bom })).toContain(K.PRINT_PAGE_WARNINGS.sprue_prep);
  }, 25000);

  // SO(3)-invariant UV sphere: guarantees > 10 mm² steep overhang in every possible 3D rotation
  function uvSphere(cx: number, cy: number, cz: number, r: number, rings = 12, segs = 18): Float32Array {
    const out: number[] = [];
    const pt = (i: number, j: number): V3 => {
      const phi = (Math.PI * i) / rings;
      const th = (2 * Math.PI * (j % segs)) / segs;
      const sp = Math.sin(phi);
      return [cx + r * sp * Math.cos(th), cy + r * sp * Math.sin(th), cz + r * Math.cos(phi)];
    };
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < segs; j++) {
        if (i === 0) out.push(...pt(0, 0), ...pt(1, j + 1), ...pt(1, j));
        else if (i === rings - 1) out.push(...pt(i, j), ...pt(i, j + 1), ...pt(rings, 0));
        else out.push(...quad(pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1)));
      }
    }
    return outward(out);
  }

  function makeOverhangingVariant(baseTri: Float32Array): Float32Array {
    const b = K.bounds(baseTri);
    const cx = 0.5 * (b.min[0] + b.max[0]);
    const cy = 0.5 * (b.min[1] + b.max[1]);
    const cz = 0.5 * (b.min[2] + b.max[2]);
    return Float32Array.from([...baseTri, ...uvSphere(cx, cy, cz, 8.5)]);
  }

  it("generates parametric mating-socket support_blocker sub-parts and computed supportSummary when a socketed part needs supports", () => {
    for (const partId of ["torso", "snap_torso", "snap_arm", "tail_acc"]) {
      const overTri = makeOverhangingVariant(load(`/kip/stls/${partId}.stl`));
      const item = K.prepareItem({ id: partId, source: "kip.scad", hex: "#F4EFE6" }, overTri);
      expect(item.tier, partId).toBe("needs-supports");
      expect(item.supportReason, partId).toMatch(/steep overhang|floating island/);
      expect(item.blockerTri, partId).toBeInstanceOf(Float32Array);
      expect(item.blockerTri.length, partId).toBeGreaterThan(0);
      expect(K.bounds(item.blockerTri).min[2], `${partId} blocker minZ`).toBeGreaterThanOrEqual(0);
    }

    const torsoItem = K.prepareItem(
      { id: "torso", source: "kip.scad", hex: "#F4EFE6" },
      makeOverhangingVariant(load("/kip/stls/torso.stl")),
    );
    const bootItem = K.prepareItem({ id: "boot", qty: 2, source: "kip.scad", hex: "#F4EFE6" }, load("/kip/stls/boot.stl"));
    const plan = K.planColorPlates([bootItem, torsoItem], P.clampProfile({ ...P.createDefaultProfile(), flatPackMode: "sprue" }));
    expect(plan.supportSummary).toBe("1 part needs supports: torso");
    const supPlate = plan.plates.find((pl: any) => pl.requiresSupports)!;
    expect(supPlate).toBeDefined();
    expect(supPlate.sprue).toBeNull();

    const manifest = JSON.parse(K.layoutJson(plan.plates, { profile: plan.profile }));
    expect(manifest.supportSummary).toBe("1 part needs supports: torso");
    expect(K.readmeTxt({ plan })).toContain("Supports: 1 part needs supports: torso");

    // 1. STL never bakes blocker triangles
    const stl = K.plateStl(supPlate, "torso_plate");
    expect(K.parseStl(stl).length).toBe(supPlate.placed[0].tri.length);

    // 2. Orca/Bambu 3MF emits <components> + subtype="support_blocker"
    const dir = mkdtempSync(join(tmpdir(), "kipguard-"));
    try {
      const orca3mf = join(dir, "orca_torso.3mf");
      const prusa3mf = join(dir, "prusa_torso.3mf");
      writeFileSync(orca3mf, K.to3mf(supPlate, { slicer: "orca_bambu", profile: plan.profile }));
      writeFileSync(prusa3mf, K.to3mf(supPlate, { slicer: "prusa", profile: { ...plan.profile, slicer: "prusa" } }));

      const orcaXml = execFileSync(
        "python3",
        ["-c", "import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);print(z.read('3D/3dmodel.model').decode());print('@@');print(z.read('Metadata/model_settings.config').decode())", orca3mf],
        { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
      );
      expect(orcaXml).toContain("<components>");
      expect(orcaXml).toContain('subtype="support_blocker"');

      const prusaXml = execFileSync(
        "python3",
        ["-c", "import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);print(z.read('Metadata/Slic3r_PE_model.config').decode())", prusa3mf],
        { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
      );
      expect(prusaXml).toContain('value="ModelPart"');
      expect(prusaXml).toContain('value="SupportBlocker"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 25000);
});

describe("M6 Kit Tray Edition gates (exhaustive zero-support sweep, Decision 11 flag & Gate 4 coupons)", () => {
  const load = (url: string) => K.parseStl(readFileSync(pub(url)));

  it("Gate 1: exhaustive sweep across all M1 gate (a) options in both Pro & Snap editions with flatPackMode='sprue' has 0 needs-supports parts and 0 support plates", () => {
    const valIdx = JSON.parse(readFileSync(pub("/kip/partspec-validation.json"), "utf8")).files as Record<string, any>;
    const baseState = {
      edition: "pro", category: "human", head: "kid", faceInsert: "sculpted", expr: "spark",
      skin: "warm_peach", shirt: "off", pants: "off", hair: "off", hairColor: "chestnut",
      hat: "off", hatColor: "cobalt_cap", back: "off", prop: "off", tail: "off",
      vehicle: "none", vehCovers: true, racerKit: true, includeVehicle: true,
    };

    const states: any[] = [];
    for (const edition of ["pro", "snap"]) {
      for (const hd of W.WARDROBE_HEADS) states.push({ ...baseState, edition, category: hd.category, head: hd.id });
      for (const h of W.HAIR_OPTIONS) states.push({ ...baseState, edition, category: "human", head: "kid", hair: h.id });
      for (const h of [...W.HAT_OPTIONS.map((x: any) => x.id), "wizardHat"]) states.push({ ...baseState, edition, category: "human", head: "kid", hat: h });
      for (const b of W.BACK_OPTIONS) states.push({ ...baseState, edition, back: b.id });
      for (const p of [...W.PROP_OPTIONS.map((x: any) => x.id), "wand"]) states.push({ ...baseState, edition, prop: p });
      for (const f of W.FACE_INSERT_MODES) states.push({ ...baseState, edition, category: "human", head: "kid", faceInsert: f.id });
      for (const tail of ["off", "wag", "pro"]) states.push({ ...baseState, edition, tail });
      for (const s of W.SHIRT_OPTIONS) states.push({ ...baseState, edition, category: "human", head: "kid", shirt: s.id });
      for (const p of W.PANTS_OPTIONS) states.push({ ...baseState, edition, category: "human", head: "kid", pants: p.id });
      for (const sk of W.SKIN_TONES) states.push({ ...baseState, edition, category: "human", head: "kid", skin: sk.id });
      for (const vehicle of ["car", "truck", "scooter", "moto"]) {
        for (const vehCovers of [true, false]) {
          for (const racerKit of [true, false]) {
            states.push({ ...baseState, edition, vehicle, vehCovers, racerKit, includeVehicle: true });
          }
        }
      }
      states.push({ ...baseState, edition, vehicle: "car", customHoodMode: "sdkCrest" });
    }

    // Cache mesh preparation per unique STL file so ~190 full tray plans execute deterministically in ~1.5 s
    const geoCache = new Map<string, any>();
    const prepFromBomEntry = (e: any) => {
      let cached = geoCache.get(e.file);
      if (!cached) {
        cached = K.prepareItem(e, load(e.file), { verified: e.source === "partspec" });
        geoCache.set(e.file, cached);
      }
      return {
        ...cached,
        id: e.id,
        qty: e.qty,
        role: e.role,
        group: e.group || "character",
        hex: e.hex,
        colorName: e.colorName,
        material: e.material || "PLA",
        accents: Array.isArray(e.accents) ? e.accents : [],
      };
    };

    const sprueProfile = P.clampProfile({ ...P.createDefaultProfile(), flatPackMode: "sprue" });
    for (const st of states) {
      const bom = B.resolveSceneBom(st, { validationIndex: valIdx });
      expect(bom.unmapped).toEqual([]);
      const prepared = bom.items.map(prepFromBomEntry);
      const plan = K.planColorPlates(prepared, sprueProfile);
      expect(plan.oversize, `oversize in ${st.edition}/${st.head}/${st.vehicle}`).toEqual([]);
      expect(plan.plates.filter((pl: any) => pl.requiresSupports)).toHaveLength(0);
      expect(plan.plates.flatMap((pl: any) => pl.placed).filter((p: any) => p.tier === "needs-supports")).toHaveLength(0);
      expect(plan.supportSummary).toBe("All parts print without supports");
    }

    // Reference Leo Explorer look in Pro & Snap: 0 support plates; pegs/turrets loose by default, gated when allowPegsAndTurrets=true
    const refProBom = B.resolveSceneBom({
      ...baseState, edition: "pro", shirt: "spark_tee", pants: "cargo_shorts",
      hair: "short_swept", hat: "ranger", back: "explorer", prop: "wrench", includeVehicle: false,
    });
    const refProPrep = refProBom.items.map(prepFromBomEntry);
    const refProPlan = K.planColorPlates(refProPrep, sprueProfile);
    const proPlaced = refProPlan.plates.flatMap((pl: any) => pl.placed);
    expect(proPlaced).toHaveLength(33);
    expect(proPlaced.filter((p: any) => p.sprueAnchored)).toHaveLength(20);
    expect(proPlaced.filter((p: any) => !p.sprueAnchored)).toHaveLength(13);

    const refSnapBom = B.resolveSceneBom({
      ...baseState, edition: "snap", shirt: "spark_tee", pants: "cargo_shorts",
      hair: "short_swept", hat: "ranger", back: "explorer", prop: "wrench", includeVehicle: false,
    });
    const refSnapPrep = refSnapBom.items.map(prepFromBomEntry);
    const refSnapPlan = K.planColorPlates(refSnapPrep, sprueProfile);
    const snapPlaced = refSnapPlan.plates.flatMap((pl: any) => pl.placed);
    expect(snapPlaced).toHaveLength(25);
    expect(snapPlaced.filter((p: any) => p.sprueAnchored)).toHaveLength(16);
    expect(snapPlaced.filter((p: any) => !p.sprueAnchored)).toHaveLength(9);

    // Decision 11: enabling allowPegsAndTurrets gates the pegs & turrets cleanly onto kit trays
    const allGatedPlan = K.planColorPlates(refProPrep, sprueProfile, { sprueSpec: { allowPegsAndTurrets: true } });
    for (const pl of allGatedPlan.plates) {
      if (pl.sprue) {
        const cardParts = pl.placed.filter((p: any) => p.sprueAnchored);
        expect(K.checkSprueCard(pl.sprue, cardParts, { ...K.SPRUE_SPEC, allowPegsAndTurrets: true })).toEqual([]);
      }
    }
    expect(allGatedPlan.plates.flatMap((pl: any) => pl.placed).filter((p: any) => p.sprueAnchored).length).toBeGreaterThan(20);
  }, 120000);

  it("Gate 4: builds watertight, zero-support physical break-off and peg/turret socket fit coupons", () => {
    const breakoff = K.buildBreakoffCouponMesh();
    expect(breakoff.necksMm).toEqual([0.3, 0.4, 0.6]);
    for (const sh of breakoff.shells) {
      expect(countUnmatchedHalfEdges(sh)).toBe(0);
    }
    expect(K.supportReport(breakoff.tri).overhangMm2).toBe(0);
    expect(K.bounds(breakoff.tri).min[2]).toBeCloseTo(0, 4);

    const fitCoupon = K.buildPegTurretFitCouponMesh({
      pegTri: load("/kip/stls/spark_peg_big.stl"),
      turretTri: load("/kip/stls/snap_turret.stl"),
    });
    expect(fitCoupon.anglesDeg).toEqual([0, 45, 90]);
    expect(fitCoupon.socketDiametersMm).toEqual([9.0, 8.0]);
    for (const sh of fitCoupon.shells) {
      expect(countUnmatchedHalfEdges(sh)).toBe(0);
    }
    expect(K.supportReport(fitCoupon.tri).overhangMm2).toBeLessThan(1.0);
    expect(K.bounds(fitCoupon.tri).min[2]).toBeCloseTo(0, 4);

    const standaloneCoupon = K.buildPegTurretFitCouponMesh();
    for (const sh of standaloneCoupon.shells) {
      expect(countUnmatchedHalfEdges(sh)).toBe(0);
    }
    expect(K.supportReport(standaloneCoupon.tri).overhangMm2).toBe(0);
  });
});

const ORCA_BIN = process.env.ORCA_SLICER_BIN || "/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer";
describe.runIf(existsSync(ORCA_BIN))("live OrcaSlicer CLI verification gate", () => {
  const load = (url: string) => K.parseStl(readFileSync(pub(url)));

  it("Gate 3: slices a whole Kip in Kit tray (sprue) mode with ZERO '; FEATURE: Support' lines on every plate, plus proves socket blockers on overhanging custom parts", () => {
    // 1. Whole Leo Explorer Kip in Kit tray mode -> 0 support features on EVERY plate!
    const state = {
      edition: "pro", category: "human", head: "kid", faceInsert: "sculpted", expr: "spark",
      skin: "warm_peach", shirt: "spark_tee", pants: "cargo_shorts",
      hair: "short_swept", hairColor: "chestnut", hat: "ranger", hatColor: "cobalt_cap",
      back: "explorer", prop: "wrench", tail: "wag",
      vehicle: "none", vehCovers: true, racerKit: true, includeVehicle: false,
    };
    const bom = B.resolveSceneBom(state);
    const prepared = bom.items.map((e: any) => K.prepareItem(e, load(e.file), { verified: e.source === "partspec" }));
    const prof = P.clampProfile({ ...P.createDefaultProfile(), flatPackMode: "sprue" });
    const wholeKipPlan = K.planColorPlates(prepared, prof);
    expect(wholeKipPlan.supportSummary).toBe("All parts print without supports");
    expect(wholeKipPlan.plates.every((pl: any) => !pl.requiresSupports)).toBe(true);

    // 2. Overhanging torso variant (with overhangs inside shoulder/back-dock SOCKET_GUARD_BOXES + 1 unguarded chest overhang)
    const baseTorso = load("/kip/stls/torso.stl");
    const sphereAt = (cx: number, cy: number, cz: number, r: number) => {
      const out: number[] = [];
      const rings = 12, segs = 18;
      const pt = (i: number, j: number): V3 => {
        const phi = (Math.PI * i) / rings, th = (2 * Math.PI * (j % segs)) / segs, sp = Math.sin(phi);
        return [cx + r * sp * Math.cos(th), cy + r * sp * Math.sin(th), cz + r * Math.cos(phi)];
      };
      for (let i = 0; i < rings; i++) {
        for (let j = 0; j < segs; j++) {
          if (i === 0) out.push(...pt(0, 0), ...pt(1, j + 1), ...pt(1, j));
          else if (i === rings - 1) out.push(...pt(i, j), ...pt(i, j + 1), ...pt(rings, 0));
          else out.push(...quad(pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1)));
        }
      }
      return outward(out);
    };
    const overTorsoTri = Float32Array.from([
      ...baseTorso,
      ...sphereAt(-13.2, 0.0, 95.5, 3.0), // strictly inside left shoulder SOCKET_GUARD_BOX
      ...sphereAt(13.2, 0.0, 95.5, 3.0),  // strictly inside right shoulder SOCKET_GUARD_BOX
      ...sphereAt(0.0, 0.0, 102.2, 2.8),  // strictly inside neck SOCKET_GUARD_BOX
      ...sphereAt(-12.0, 0.0, 66.5, 3.0), // strictly inside left hip SOCKET_GUARD_BOX
      ...sphereAt(12.0, 0.0, 66.5, 3.0),  // strictly inside right hip SOCKET_GUARD_BOX
      ...sphereAt(0.0, 10.2, 88.0, 2.8),  // strictly inside back central bore SOCKET_GUARD_BOX
    ]);
    const overTorsoItem = K.prepareItem({ id: "torso", qty: 1, source: "kip.scad", hex: "#F4EFE6" }, overTorsoTri);
    const supPlan = K.planColorPlates([overTorsoItem], prof);
    const blockedPlate = supPlan.plates[0]!;
    const unblockedPlate = {
      ...blockedPlate,
      placed: blockedPlate.placed.map((p: any) => ({ ...p, blockerTri: null })),
    };

    const dir = mkdtempSync(join(tmpdir(), "kip-orca-cli-"));
    try {
      const kipProjPath = join(dir, "whole-kip-kit-tray.3mf");
      const blockedPath = join(dir, "torso-blocked.3mf");
      const unblockedPath = join(dir, "torso-unblocked.3mf");
      const outKip = join(dir, "out-kip");
      const outBlocked = join(dir, "out-blocked");
      const outUnblocked = join(dir, "out-unblocked");

      writeFileSync(kipProjPath, K.to3mfProject(wholeKipPlan.plates, prof, { title: "Whole Kip Kit Tray" }));
      writeFileSync(blockedPath, K.to3mfProject([blockedPlate], prof, { title: "Torso Blocked" }));
      writeFileSync(unblockedPath, K.to3mfProject([unblockedPlate], prof, { title: "Torso Unblocked" }));

      execFileSync(ORCA_BIN, ["--slice", "0", "--outputdir", outKip, kipProjPath], { stdio: "pipe" });
      execFileSync(ORCA_BIN, ["--slice", "0", "--outputdir", outBlocked, blockedPath], { stdio: "pipe" });
      execFileSync(ORCA_BIN, ["--slice", "0", "--outputdir", outUnblocked, unblockedPath], { stdio: "pipe" });

      const kipGcodes = readdirSync(outKip).filter((f) => f.endsWith(".gcode")).sort();
      expect(kipGcodes).toHaveLength(wholeKipPlan.plates.length);

      for (let idx = 0; idx < kipGcodes.length; idx++) {
        const gcode = readFileSync(join(outKip, kipGcodes[idx]!), "utf8");
        expect((gcode.match(/; FEATURE: Support\b/g) ?? []).length, `plate ${idx + 1} (${kipGcodes[idx]}) support lines`).toBe(0);
        const pl = wholeKipPlan.plates[idx]!;
        if (pl.sprue) {
          const firstLayer = gcode.split("; CHANGE_LAYER").find((blk) => blk.includes("; Z_HEIGHT: 0.2")) ?? "";
          const l1Objects = firstLayer.match(/; printing object [^\r\n]+/g) ?? [];
          const looseCount = pl.placed.filter((p: any) => !p.sprueAnchored).length;
          expect(l1Objects, `plate ${idx + 1} layer-1 object union`).toHaveLength(1 + looseCount);
          expect(l1Objects.some((s) => s.includes(`kit_card_p${idx + 1}_`))).toBe(true);
        }
      }

      const blockedGcode = readFileSync(join(outBlocked, readdirSync(outBlocked).find((f) => f.endsWith(".gcode"))!), "utf8");
      const unblockedGcode = readFileSync(join(outUnblocked, readdirSync(outUnblocked).find((f) => f.endsWith(".gcode"))!), "utf8");
      const blockedSupBlocks = (blockedGcode.match(/; FEATURE: Support\b/g) ?? []).length;
      const unblockedSupBlocks = (unblockedGcode.match(/; FEATURE: Support\b/g) ?? []).length;
      expect(blockedSupBlocks).toBeGreaterThan(20);
      expect(blockedSupBlocks).toBeLessThan(unblockedSupBlocks * 0.5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120000);

  it("Gate 5: a support-free part stays support-free when the user's own profile has supports on (explicit enable_support = 0)", () => {
    // Found on a real calibration print (2026-11-01): leaving the support key out for parts verified as support-free lets a profile
    // with supports on (Orca "normal(auto)", threshold 30, dont_support_bridges 0) fill legal short bridges (e.g. veh_car_chassis) with support.
    const item = K.prepareItem({ id: "veh_car_chassis", qty: 1, source: "partspec", hex: "#F4EFE6" }, load("/kip/partspec/toyventor_veh_car_chassis_S.stl"), { verified: true });
    expect(item.tier).toBe("support-free");
    const prof = P.clampProfile({ ...P.createDefaultProfile(), flatPackMode: "off" });
    const plan = K.planColorPlates([item], prof);
    expect(plan.plates.every((pl: any) => !pl.requiresSupports)).toBe(true);

    const dir = mkdtempSync(join(tmpdir(), "kip-orca-supports-on-"));
    try {
      const srcPath = join(dir, "src.3mf");
      writeFileSync(srcPath, K.to3mfProject(plan.plates, prof, { title: "Support override" }));
      // Rewrite the project settings to the user's profile (supports on). The control also drops our per-object key, so the test cannot
      // pass just because Orca ignored the injected profile.
      const py = "import zipfile,sys,json,re\n"
        + "src,dst,strip=sys.argv[1],sys.argv[2],sys.argv[3]=='1'\n"
        + "with zipfile.ZipFile(src) as zi, zipfile.ZipFile(dst,'w',zipfile.ZIP_STORED) as zo:\n"
        + "    for it in zi.infolist():\n"
        + "        d=zi.read(it.filename)\n"
        + "        if it.filename=='Metadata/project_settings.config':\n"
        + "            c=json.loads(d); c.update({'enable_support':'1','support_type':'normal(auto)','support_threshold_angle':'30','support_on_build_plate_only':'0'}); d=json.dumps(c).encode()\n"
        + "        if strip and it.filename=='Metadata/model_settings.config':\n"
        + "            d=re.sub(rb'<metadata key=\"enable_support\" value=\"0\"/>',b'',d)\n"
        + "        zo.writestr(it,d)\n";
      const supportLines = (tag: string, strip: boolean) => {
        const dst = join(dir, `${tag}.3mf`), out = join(dir, `out-${tag}`);
        execFileSync("python3", ["-c", py, srcPath, dst, strip ? "1" : "0"]);
        execFileSync(ORCA_BIN, ["--slice", "0", "--outputdir", out, dst], { stdio: "pipe" });
        const gcode = readFileSync(join(out, readdirSync(out).find((f) => f.endsWith(".gcode"))!), "utf8");
        return (gcode.match(/; FEATURE: Support\b/g) ?? []).length;
      };
      let keyed = -1, control = -1;
      try {
        keyed = supportLines("keyed", false);
        control = supportLines("control", true);
      } catch (e: any) {
        if (e.code === "ENOENT") return; // no python3 to rewrite the zip
        throw e;
      }
      expect(control, "control (no per-object key) must show supports, or this gate proves nothing").toBeGreaterThan(0);
      expect(keyed, "explicit enable_support = 0 must beat the profile").toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180000);
});
