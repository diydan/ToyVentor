import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// The viewer modules are plain browser JS with no declaration files.
// @ts-expect-error untyped JS module
import * as yard from "../parts/kip/viewer/yard-vehicles.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const { AXLE_Y, AXLE_Z, DRUM_INNER_X, DRUM, WIDE_AXLE, KEEL_HALF_WIDTH, AXLE_FLOAT_MM, rollerParts, bom, partIds, spinAfter, clampFloat } = yard as any;

const root = process.cwd();
type V3 = [number, number, number];
const stlBounds = (rel: string) => {
  const buf = readFileSync(join(root, rel));
  const n = buf.readUInt32LE(80);
  const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < n; t++) {
    for (let v = 0; v < 3; v++) {
      const o = 84 + t * 50 + 12 + v * 12;
      for (let k = 0; k < 3; k++) {
        const x = buf.readFloatLE(o + k * 4);
        if (x < lo[k]!) lo[k] = x;
        if (x > hi[k]!) hi[k] = x;
      }
    }
  }
  return { lo, hi };
};
// A part's world x extent after the bench's rotation about Y (three.js: x' = x cos + z sin) and position.
const xRange = (p: any, zLo: number, zHi: number) => {
  const s = Math.round(Math.sin(p.rotY)), c = Math.round(Math.cos(p.rotY)); // only 0, +-90 degrees occur
  const xs = [zLo, zHi].map((z) => z * s + 0 * c + p.pos[0]);
  return [Math.min(...xs), Math.max(...xs)] as [number, number];
};

describe("yard vehicles: the road roller's placements are the ones Gate G1 proves", () => {
  it("keeps the 100 mm wheelbase and the row-0 / row-8 axle positions the Truck uses", () => {
    expect(AXLE_Y.rear - AXLE_Y.front).toBe(100);
    expect(AXLE_Y).toEqual({ front: -56.25, rear: 43.75 });
    expect(AXLE_Z).toBe(6.25);
  });

  it("a wide axle ends flush with its drums' outer faces: 103.0 = 2 x (26.7 + 24.8)", () => {
    expect(WIDE_AXLE.length).toBeCloseTo(2 * (DRUM_INNER_X + DRUM.width), 9);
    const parts = rollerParts();
    for (const axle of ["front", "rear"]) {
      const shaft = parts.find((p: any) => p.role === "axle" && p.axle === axle);
      const [sLo, sHi] = xRange(shaft, 0, WIDE_AXLE.length);
      const left = parts.find((p: any) => p.role === "drum-left" && p.axle === axle);
      const right = parts.find((p: any) => p.role === "drum-right" && p.axle === axle);
      const [lLo] = xRange(left, 0, DRUM.width), [, rHi] = xRange(right, 0, DRUM.width);
      expect(sLo, axle).toBeCloseTo(lLo, 9);
      expect(sHi, axle).toBeCloseTo(rHi, 9);
    }
  });

  it("the drums are a mirrored pair: each closed floor (part z = 0) faces the keel", () => {
    const parts = rollerParts();
    const left = parts.find((p: any) => p.role === "drum-left");
    const right = parts.find((p: any) => p.role === "drum-right");
    expect(left.rotY).toBe(-Math.PI / 2);
    expect(right.rotY).toBe(Math.PI / 2);
    // the floor is at part z = 0: its world x is the part's position, which is the inner face
    expect(xRange(left, 0, 0)[0]).toBe(-DRUM_INNER_X);
    expect(xRange(right, 0, 0)[0]).toBe(DRUM_INNER_X);
    // and the open face is outboard
    expect(xRange(left, DRUM.width, DRUM.width)[0]).toBeCloseTo(-DRUM_INNER_X - DRUM.width, 9);
    expect(xRange(right, DRUM.width, DRUM.width)[0]).toBeCloseTo(DRUM_INNER_X + DRUM.width, 9);
  });

  it("clearance to the keel is 1.8 mm at the full-width rear and 14.3 mm at the narrow front nose", () => {
    expect(KEEL_HALF_WIDTH).toEqual({ rear: 24.9, front: 12.4 });
    expect(AXLE_FLOAT_MM.rear).toBeCloseTo(1.8, 9);
    expect(AXLE_FLOAT_MM.front).toBeCloseTo(14.3, 9);
    expect(clampFloat(99, "front")).toBeCloseTo(14.3, 9);
    expect(clampFloat(-99, "rear")).toBeCloseTo(-1.8, 9);
    expect(clampFloat(3, "front")).toBe(3);
  });

  it("the parts list is one road roller: 1 keel, 1 windscreen, 2 wide axles, 4 drums", () => {
    const parts = rollerParts();
    expect(parts).toHaveLength(2 + 2 * 3);
    const rows = Object.fromEntries(bom(parts).map((r: any) => [r.id, r.count]));
    expect(rows).toEqual({ kit_keel_base: 1, kit_windscreen: 1, kit_barbell_shaft_wide: 2, kit_drum_roller: 4 });
    expect(partIds(parts).sort()).toEqual(["kit_barbell_shaft_wide", "kit_drum_roller", "kit_keel_base", "kit_windscreen"]);
  });

  it("rolling without slip: one drum circumference of travel is one full turn", () => {
    expect(spinAfter(2 * Math.PI * DRUM.radius)).toBeCloseTo(2 * Math.PI, 9);
    expect(spinAfter(0)).toBe(0);
    expect(spinAfter(-50)).toBeCloseTo(-2, 9);
  });
});

describe("yard vehicles: the numbers match the CAD, not just each other", () => {
  it("the served mockup STLs have the dimensions the placements assume", () => {
    const drum = stlBounds("public/kip/partspec/mockup/kit_drum_roller.stl");
    expect(drum.hi[0] - drum.lo[0]).toBeCloseTo(2 * DRUM.radius, 2);
    expect(drum.hi[1] - drum.lo[1]).toBeCloseTo(2 * DRUM.radius, 2);
    expect(drum.lo[2]).toBeCloseTo(0, 2);
    expect(drum.hi[2]).toBeCloseTo(DRUM.width, 2);
    const shaft = stlBounds("public/kip/partspec/mockup/kit_barbell_shaft_wide.stl");
    expect(shaft.lo[2]).toBeCloseTo(0, 2);
    expect(shaft.hi[2]).toBeCloseTo(WIDE_AXLE.length, 2);
  });

  it("the drum's closed floor is at part z = 0, so its mass sits on the low-z side (what 'floor faces the keel' relies on)", () => {
    const buf = readFileSync(join(root, "public/kip/partspec/mockup/kit_drum_roller.stl"));
    const n = buf.readUInt32LE(80);
    let vol = 0, cz = 0;
    for (let t = 0; t < n; t++) {
      const v: V3[] = [];
      for (let k = 0; k < 3; k++) { const o = 84 + t * 50 + 12 + k * 12; v.push([buf.readFloatLE(o), buf.readFloatLE(o + 4), buf.readFloatLE(o + 8)]); }
      const [a, b, c] = v as [V3, V3, V3];
      const dv = (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6; // signed tetra volume to the origin
      vol += dv;
      cz += dv * ((a[2] + b[2] + c[2]) / 4);
    }
    expect(vol / 1000).toBeCloseTo(26.24, 0); // cm3, the part gate's figure
    expect(cz / vol).toBeLessThan(DRUM.width / 2 - 2); // centroid well below mid-width
  });

  it("the STLs the Yard page loads are in git, in the copy the app serves", () => {
    // The Yard page loads /kip/partspec/mockup/<id>.stl, so those files have to be tracked: the app serves public/ with no build step.
    for (const id of ["kit_drum_roller", "kit_barbell_shaft_wide", "kit_keel_base", "kit_windscreen"]) {
      expect(existsSync(join(root, "public/kip/partspec/mockup", `${id}.stl`)), id).toBe(true);
    }
  });

  // The viewer's own copy under parts/kip/viewer/partspec/ is a local-only mirror (.gitignore), so this guard runs only where that mirror exists: it
  // catches a stale mirror before a deploy ships the served copy beside it.
  it.skipIf(!existsSync(join(root, "parts/kip/viewer/partspec/mockup")))("the viewer's own copy of those STLs is identical to the served one", () => {
    for (const f of ["kit_drum_roller.stl", "kit_barbell_shaft_wide.stl"]) {
      const a = readFileSync(join(root, "public/kip/partspec/mockup", f));
      const b = readFileSync(join(root, "parts/kip/viewer/partspec/mockup", f));
      expect(a.equals(b), f).toBe(true);
    }
  });

  it("Gate G1 craft 10 places the drums at the same x, axle rows and clearances", () => {
    const src = readFileSync(join(root, "parts/partspec/toyventor_kitcard.py"), "utf8");
    const block = src.slice(src.indexOf("# 10. Road roller"), src.indexOf('results["10_road_roller"]'));
    expect(block).toContain(`for role, y_c, float_mm in (("rear", ${AXLE_Y.rear}, 1.8), ("front", ${AXLE_Y.front}, 14.3))`);
    expect(block).toContain(`translate((-${DRUM_INNER_X}, y_c, ${AXLE_Z}))`);
    expect(block).toContain(`translate((${DRUM_INNER_X}, y_c, ${AXLE_Z}))`);
    expect(block).toContain("rotate((0, -90, 0))");
    expect(block).toContain("rotate((0, 90, 0))");
    expect(block).toContain(`translate((-${WIDE_AXLE.length / 2}, y_c, ${AXLE_Z}))`);
    // and the windscreen sits where the bench puts it
    expect(block).toContain("wind.translate((0.0, -6.25, 12.5))");
  });
});

describe("yard vehicles: stays pure", () => {
  it("has no DOM, no three.js and no timers, so it runs in Node and is deterministic", () => {
    const src = readFileSync(join(root, "parts/kip/viewer/yard-vehicles.js"), "utf8");
    const code = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/\b(document|window|THREE|requestAnimationFrame|setTimeout|setInterval|Math\.random|Date\.now|performance)\b/);
    expect(code).not.toMatch(/^\s*import\s/m);
  });
});
