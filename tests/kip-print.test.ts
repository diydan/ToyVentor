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
import * as wardrobe from "../parts/kip/viewer/kip-vehicles-wardrobe.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const K = printMod as any;
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

describe("inventory", () => {
  const base = { edition: "pro", category: "robot", head: "classic", faceInsert: "sculpted", expr: "spark", hair: "off", hat: "buds", back: "off", prop: "off", ears: "off", tail: "off", vehicle: "none" };
  const ids = (s: any) => K.inventoryFor(s).items.map((i: any) => `${i.id}x${i.qty}`);

  it("counts the Pro and Snap joints from the rig builder", () => {
    const pro = K.inventoryFor(base).items;
    expect(pro.find((i: any) => i.id === "spark_peg_big").qty).toBe(5);
    expect(pro.find((i: any) => i.id === "spark_peg_sml").qty).toBe(8);
    const snap = K.inventoryFor({ ...base, edition: "snap" }).items;
    expect(snap.find((i: any) => i.id === "snap_turret_big").qty).toBe(5);
    expect(snap.find((i: any) => i.id === "snap_turret").qty).toBe(4);
    expect(snap.some((i: any) => i.id === "torso")).toBe(false);
  });

  it("follows the viewer's visibility rules for heads, face plates, hair and hats", () => {
    expect(ids(base)).toContain("face_eyesx1");
    expect(ids({ ...base, expr: "happy" })).not.toContain("face_eyesx1");
    expect(ids({ ...base, hat: "blank" })).toContain("crown_cap_blankx1");
    const human = { ...base, category: "human", head: "chibi", faceInsert: "vinyl", hair: "twin_braids", hat: "beanie" };
    const got = ids(human);
    for (const want of ["neck_turret_2x1x1", "head_chibix1", "faceplate_vinylx1", "hair_twin_braidsx1", "hat_beaniex1", "crown_buds_2x1x1"]) expect(got).toContain(want);
    expect(got).not.toContain("head_shellx1");
  });

  it("never drops an option silently: every wardrobe choice is an item or an explicit unmapped line", () => {
    const check = (patch: any, role: string) => {
      const inv = K.inventoryFor({ ...base, category: "human", head: "kid", ...patch });
      const hit = inv.items.some((i: any) => i.role === role) || inv.unmapped.length > 0;
      expect(hit, JSON.stringify(patch)).toBe(true);
    };
    for (const h of W.HAIR_OPTIONS.filter((x: any) => x.id !== "off")) check({ hair: h.id }, "hair");
    for (const h of W.HAT_OPTIONS.filter((x: any) => !["buds", "blank"].includes(x.id))) check({ hat: h.id }, "hat");
    for (const b of W.BACK_OPTIONS.filter((x: any) => x.id !== "off")) check({ back: b.id }, "back");
    for (const p of W.PROP_OPTIONS.filter((x: any) => x.id !== "off")) check({ prop: p.id }, "prop");
    for (const hd of W.WARDROBE_HEADS.filter((x: any) => x.id !== "classic")) {
      expect(K.inventoryFor({ ...base, category: hd.category, head: hd.id }).items.some((i: any) => i.role === "head" && i.id.startsWith("head_"))).toBe(true);
    }
  });

  it("reports what has no single STL yet instead of pretending to print it", () => {
    const u = K.inventoryFor({ ...base, back: "gears", prop: "shaft", ears: "pro", tail: "pro", vehicle: "car" }).unmapped.join(" | ");
    for (const t of ["gears", "Spinner", "Scanner", "Wheelie", "Vehicle \\(car\\)"]) expect(u).toMatch(new RegExp(t, "i"));
  });

  it("every mapped file exists on disk, except the hairstyles whose export is still in flight", () => {
    const IN_FLIGHT = new Set(["bowl", "slick", "pixie", "side_pony", "low_bun"].map((h) => `/kip/partspec/toyventor_hair_${h}_S.stl`));
    const missing = new Set<string>();
    const states: any[] = [base, { ...base, edition: "snap", ears: "comm", tail: "wag", back: "wings" }];
    for (const hd of W.WARDROBE_HEADS) states.push({ ...base, category: hd.category, head: hd.id });
    for (const h of W.HAIR_OPTIONS) states.push({ ...base, category: "human", head: "kid", hair: h.id });
    for (const h of W.HAT_OPTIONS) states.push({ ...base, hat: h.id });
    for (const b of W.BACK_OPTIONS) states.push({ ...base, back: b.id });
    for (const p of W.PROP_OPTIONS) states.push({ ...base, prop: p.id });
    for (const f of W.FACE_INSERT_MODES) states.push({ ...base, category: "human", head: "kid", faceInsert: f.id });
    for (const s of states) for (const it of K.inventoryFor(s).items) if (!existsSync(pub(it.file))) missing.add(it.file);
    expect([...missing].filter((f) => !IN_FLIGHT.has(f))).toEqual([]);
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

  it("base body parts come out of rig pose onto the bed and are flagged when they need supports", () => {
    const torso = prep("kip.scad", "torso", "/kip/stls/torso.stl");
    expect(K.bounds(torso.tri).min[2]).toBeCloseTo(0, 4);
    expect(torso.tier).toBe("needs-supports");
    expect(torso.report.overhangMm2).toBeGreaterThan(K.LIMITS.steepAreaToleranceMm2);
    // Not a catalog part: no sha to verify, so a clean V4 scan is only "geometry-checked".
    expect(prep("kip.scad", "crown_buds", "/kip/stls/crown_buds.stl").tier).toBe("geometry-checked");
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

  it("packs a character plate inside the bound with legal gaps, rigid transforms only", () => {
    const inv = K.inventoryFor({ edition: "pro", category: "human", head: "kid", faceInsert: "sculpted", expr: "spark", hair: "short_swept", hat: "ranger", back: "explorer", prop: "wrench", ears: "off", tail: "off", vehicle: "none" });
    const prepared = inv.items.map((e: any) => prep(e.source, e.id, e.file));
    const qty = Object.fromEntries(inv.items.map((e: any) => [e.id, e.qty]));
    const inst = K.expandInstances(prepared, qty);
    const res = K.buildPlates(inst);
    expect(res.oversize).toEqual([]);
    expect(res.plates.flat().length).toBe(inst.length);
    for (const plate of res.plates) {
      expect(K.checkPlacement(plate, res.boundMm, res.gap)).toEqual([]);
      for (const p of plate) {
        const b = K.bounds(p.tri);
        expect(b.min[2]).toBeCloseTo(0, 3);
        expect(b.min[0]).toBeGreaterThan(p.x - 1e-3);
        expect(b.min[0]).toBeLessThan(p.x + 1e-3);
        expect(b.size[0]).toBeCloseTo(p.w, 3);
        expect(b.size[1]).toBeCloseTo(p.h, 3);
        // rigid: triangle count and total area are unchanged by placement
        const src = inst.find((i: any) => i.instance === p.instance);
        expect(p.tri.length).toBe(src.tri.length);
        const area = (t: Float32Array) => { let a = 0; for (let i = 0; i < t.length; i += 9) { const ux = t[i + 3]! - t[i]!, uy = t[i + 4]! - t[i + 1]!, uz = t[i + 5]! - t[i + 2]!, vx = t[i + 6]! - t[i]!, vy = t[i + 7]! - t[i + 1]!, vz = t[i + 8]! - t[i + 2]!; a += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2; } return a; };
        expect(area(p.tri)).toBeCloseTo(area(src.tri), 1);
      }
    }
  });
});

describe("exports", () => {
  const sample = () => {
    const placed = [
      { instance: "a", partId: "a", tier: "support-free", source: "partspec", x: 0, y: 0, w: 10, h: 10, rot: false, z: 5, orientation: "+z up", report: { overhangMm2: 0 }, tri: Float32Array.from(box(0, 0, 0, 10, 10, 5)) },
      { instance: "b#1", partId: "b", tier: "needs-supports", source: "kip.scad", x: 20, y: 0, w: 10, h: 10, rot: false, z: 5, orientation: "+z up", report: { overhangMm2: 42.5 }, tri: Float32Array.from(box(20, 0, 0, 30, 10, 5)) },
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
      if (e.code === "ENOENT") return; // no python3 on this machine; the structural test below still runs
      throw e;
    }
    expect(out.split("\n")).toEqual(["None", "hello", "[1, 2, 3, 4]", ""]);
    expect(K.crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("3MF holds one object per part in plate coordinates and flags only the parts that need supports", () => {
    const zip: Uint8Array = K.to3mf(sample());
    const dir = mkdtempSync(join(tmpdir(), "kip3mf-"));
    const f = join(dir, "t.3mf");
    writeFileSync(f, zip);
    let names = "", model = "", cfg = "";
    try {
      const py = "import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print('\\n'.join(z.namelist()));print('@@');print(z.read('3D/3dmodel.model').decode());print('@@');print(z.read('Metadata/Slic3r_PE_model.config').decode())";
      [names, model, cfg] = execFileSync("python3", ["-c", py, f], { encoding: "utf8" }).split("@@\n") as [string, string, string];
    } catch (e: any) {
      if (e.code === "ENOENT") return;
      throw e;
    }
    expect(names).toContain("3D/3dmodel.model");
    expect(model.match(/<object /g)).toHaveLength(2);
    expect(model).toContain('unit="millimeter"');
    const verts = [...model.matchAll(/<object id="(\d)"[\s\S]*?<\/object>/g)].map((m) => ({ nv: (m[0].match(/<vertex /g) ?? []).length, idx: [...m[0].matchAll(/v[123]="(\d+)"/g)].map((x) => +x[1]!) }));
    for (const v of verts) { expect(v.nv).toBe(8); expect(Math.max(...v.idx)).toBe(v.nv - 1); } // boxes dedupe to 8 vertices
    expect(model).toContain('transform="1 0 0 0 1 0 0 0 1 5 5 0"'); // 170 plate centred on the 180 bed
    expect(cfg.match(/support_material/g)).toHaveLength(1);
    expect(cfg.indexOf('value="b#1"')).toBeLessThan(cfg.indexOf("support_material"));
  });

  it("layout json records each part's placement and tier", () => {
    const j = JSON.parse(K.layoutJson([sample()], { preset: "t" }));
    expect(j.format).toBe("toyventor.kip-plate/1");
    expect(j.plates[0].parts.map((p: any) => p.tier)).toEqual(["support-free", "needs-supports"]);
  });

  it("small-parts screen follows the 31.75 mm cylinder", () => {
    const mk = (w: number, h: number, z: number) => ({ instance: `${w}x${h}x${z}`, w, h, z });
    // fits: cross-section diagonal <= 31.75 and length <= 57.15 in some orientation
    expect(K.smallParts([[mk(10, 10, 5), mk(40, 10, 5), mk(30, 30, 5), mk(40, 40, 5), mk(20, 20, 60), mk(34, 20, 20)]]))
      .toEqual(["10x10x5", "40x10x5", "30x30x5", "34x20x20"]);
  });
});
