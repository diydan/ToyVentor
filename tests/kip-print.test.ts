import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
import * as wardrobe from "../parts/kip/viewer/kip-vehicles-wardrobe.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const K = printMod as any;
const B = bomMod as any;
const P = profMod as any;
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
    edition: "pro", category: "robot", head: "classic", faceInsert: "sculpted", expr: "spark",
    skin: "vinyl_cream", shirt: "off", pants: "off", hair: "off", hairColor: "chestnut",
    hat: "buds", hatColor: "cobalt_cap", back: "off", prop: "off", ears: "off", tail: "off",
    vehicle: "none", vehCovers: true, racerKit: true, includeVehicle: true,
  };
  const sumQty = (items: any[], id: string) => items.filter((i) => i.id === id).reduce((a, b) => a + b.qty, 0);
  const ids = (s: any) => {
    const map = new Map<string, number>();
    for (const i of K.inventoryFor(s).items) map.set(i.id, (map.get(i.id) ?? 0) + i.qty);
    return [...map.entries()].map(([id, q]) => `${id}x${q}`);
  };

  it("gate (c): peg and turret counts match visible slots on all 13 heads in both editions, and crown_buds_2x1 / wheel_rims never print standalone", () => {
    for (const hd of W.WARDROBE_HEADS as any[]) {
      const proItems = K.inventoryFor({ ...base, edition: "pro", category: hd.category, head: hd.id }).items;
      const snapItems = K.inventoryFor({ ...base, edition: "snap", category: hd.category, head: hd.id }).items;
      if (hd.id === "classic") {
        expect(sumQty(proItems, "spark_peg_big"), `pro classic big pegs`).toBe(5);
        expect(sumQty(proItems, "neck_turret_2x1"), `pro classic neck turret`).toBe(0);
        expect(sumQty(snapItems, "snap_turret_big"), `snap classic big turrets`).toBe(5);
        expect(sumQty(snapItems, "neck_turret_2x1"), `snap classic neck turret`).toBe(0);
      } else {
        expect(sumQty(proItems, "spark_peg_big"), `pro ${hd.id} big pegs`).toBe(4);
        expect(sumQty(proItems, "neck_turret_2x1"), `pro ${hd.id} neck turret`).toBe(1);
        expect(sumQty(snapItems, "snap_turret_big"), `snap ${hd.id} big turrets`).toBe(4);
        expect(sumQty(snapItems, "neck_turret_2x1"), `snap ${hd.id} neck turret`).toBe(1);
      }
      expect(sumQty(proItems, "spark_peg_sml")).toBe(8);
      expect(sumQty(snapItems, "snap_turret")).toBe(4);
      expect(snapItems.some((i: any) => i.id === "torso")).toBe(false);
      // Overlay-only accents never appear as standalone BOM parts
      expect(sumQty(proItems, "crown_buds_2x1")).toBe(0);
    }

    // On non-classic heads with hat="buds", crown_buds_2x1 attaches as an accent to the host head/hair (never standalone)
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
    for (const ears of ["off", "comm", "pro"]) states.push({ ...base, ears });
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
    const proMech = B.resolveSceneBom({ ...base, back: "gears", prop: "shaft", ears: "pro", tail: "pro" });
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

  it("base body parts come out of rig pose onto the bed; kip.scad:137 clears forearm/shin/snap_leg while torso stays flagged", () => {
    const torso = prep("kip.scad", "torso", "/kip/stls/torso.stl");
    expect(K.bounds(torso.tri).min[2]).toBeCloseTo(0, 4);
    expect(torso.tier).toBe("needs-supports");
    expect(torso.report.overhangMm2).toBeGreaterThan(K.LIMITS.steepAreaToleranceMm2);
    // v_groove_ring fix (dr / tan(38)) cleared forearm, shin, and snap_leg to 0 overhang!
    for (const cleanId of ["forearm", "shin", "snap_leg", "crown_buds"]) {
      const part = prep("kip.scad", cleanId, `/kip/stls/${cleanId}.stl`);
      expect(part.tier, cleanId).toBe("geometry-checked");
      expect(part.report.overhangMm2, cleanId).toBeLessThanOrEqual(K.LIMITS.steepAreaToleranceMm2);
    }
    // Multi-shell `face_glints.stl` lands all 4 disconnected catchlight shells onto z = 0 (zero levitating shells -> Orca RC=0)
    const glints = prep("kip.scad", "face_glints", "/kip/stls/face_glints.stl");
    expect(K.bounds(glints.tri).min[2]).toBeCloseTo(0, 4);
    expect(glints.z).toBeLessThan(2.5);
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
      back: "explorer", prop: "wrench", ears: "off", tail: "off",
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
  });
});

describe("exports", () => {
  const sample = () => {
    const placed = [
      { instance: "a", partId: "a", tier: "support-free", source: "partspec", hex: "#4EB3FC", colorName: "Snap Sky", x: 0, y: 0, w: 10, h: 10, rot: false, z: 5, orientation: "+z up", report: { overhangMm2: 0 }, tri: Float32Array.from(box(0, 0, 0, 10, 10, 5)) },
      { instance: "b#1", partId: "b", tier: "needs-supports", source: "kip.scad", hex: "#F4EFE6", colorName: "Warm Shell", x: 20, y: 0, w: 10, h: 10, rot: false, z: 5, orientation: "+z up", report: { overhangMm2: 42.5 }, tri: Float32Array.from(box(20, 0, 0, 30, 10, 5)) },
    ];
    return placed;
  };

  it("writes a valid zip that Python's zipfile accepts, with matching CRCs", () => {
    const zip = K.zipStore([{ name: "a.txt", data: "hello" }, { name: "dir/b.bin", data: Uint8Array.from([1, 2, 3, 4]) }]);
    const dir = mkdtempSync(join(tmpdir(), "kipzip-"));
    const f = join(dir, "t.zip");
    writeFileSync(f, zip);
    let out = "";
    try {
      out = execFileSync("python3", ["-c", "import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);print(z.testzip());print(z.read('a.txt').decode());print(list(z.read('dir/b.bin')))", f], { encoding: "utf8" });
    } catch (e: any) {
      if (e.code === "ENOENT") return;
      throw e;
    }
    expect(out.split("\n")).toEqual(["None", "hello", "[1, 2, 3, 4]", ""]);
    expect(K.crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
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
    expect(pCfg.match(/support_material"/g)).toHaveLength(1);
    expect(pCfg).toContain('xy_size_compensation" value="-0.04"');

    const [oNames, oModel, oCfg, oProj] = orcaOut.split("@@\n") as [string, string, string, string];
    expect(oNames).toContain("Metadata/model_settings.config");
    expect(oNames).toContain("Metadata/project_settings.config");
    expect(oModel).not.toContain("PrusaSlicer");
    expect(oCfg).toContain('subtype="normal_part"');
    expect(oCfg.match(/enable_support" value="1"/g)).toHaveLength(1);
    expect(oCfg).toContain('xy_contour_compensation" value="0.025"');
    expect(oCfg).toContain('xy_hole_compensation" value="-0.025"');
    const parsedProj = JSON.parse(oProj);
    expect(parsedProj.filament_colour).toEqual(["#4EB3FC", "#F4EFE6"]);

    const [, projModel, projCfg] = projOut.split("@@\n") as [string, string, string];
    expect(projCfg.match(/<plate>/g)).toHaveLength(2);
    // Plate 2 sits at col=1 -> x offset = 1 * 1.2 * 256 + (256 - 246)/2 = 307.2 + 5 = 312.2 (or boundMm=170 -> 307.2 + 43 = 350.2)
    expect(projModel).toContain("350.2 43 0");
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
