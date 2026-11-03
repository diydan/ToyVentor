// The Toy Room bed: real geometry, real rays. The point of the bed is that a figure can lie on its middle, so the tests shoot rays at the built meshes and
// check the surface where the sleeper lies, the pillow at the head end, and that nothing sticks through the floor or the mattress.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { BED_LENGTH, BED_WIDTH, HEADBOARD_HEIGHT, MATTRESS_TOP, PILLOW_X, buildBed, overBed, sleepSpot } from "../src/features/game/world/runtime/bed";

/** Y of the first thing a ray fired straight down at (x, z) meets, in bed-local coordinates (bed built at the origin); null if it misses. */
function topAt(bed: THREE.Group, x: number, z: number): number | null {
  bed.updateMatrixWorld(true);
  const hits = new THREE.Raycaster(new THREE.Vector3(x, 6, z), new THREE.Vector3(0, -1, 0)).intersectObject(bed, true);
  return hits.length ? hits[0]!.point.y : null;
}

describe("buildBed", () => {
  const bed = buildBed(0, 0);

  it("is placed where it is asked and has real meshes with materials", () => {
    const placed = buildBed(7.5, -2);
    expect(placed.position.toArray()).toEqual([7.5, 0, -2]);
    const meshes: THREE.Mesh[] = [];
    bed.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    expect(meshes.length).toBeGreaterThanOrEqual(10);
    meshes.forEach((m) => expect(m.material).toBeTruthy());
  });

  it("stands on the floor, inside its stated footprint, and the headboard is the tallest part", () => {
    bed.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(bed);
    expect(Math.abs(box.min.y)).toBeLessThan(0.01);                       // feet touch the floor, nothing below it
    expect(box.max.y).toBeCloseTo(HEADBOARD_HEIGHT, 1);
    expect(box.min.x).toBeGreaterThanOrEqual(-BED_LENGTH / 2 - 0.01);
    expect(box.max.x).toBeLessThanOrEqual(BED_LENGTH / 2 + 0.01);
    expect(box.min.z).toBeGreaterThanOrEqual(-BED_WIDTH / 2 - 0.01);
    expect(box.max.z).toBeLessThanOrEqual(BED_WIDTH / 2 + 0.01);
  });

  it("stands on four feet that touch the floor (the boards alone must not be what grounds it)", () => {
    bed.updateMatrixWorld(true);
    const feet: THREE.Mesh[] = [];
    bed.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.geometry instanceof THREE.CylinderGeometry) feet.push(m); });
    expect(feet).toHaveLength(4);
    feet.forEach((f) => expect(Math.abs(new THREE.Box3().setFromObject(f).min.y)).toBeLessThan(0.01));
  });

  it("has a flat, clear mattress surface at MATTRESS_TOP across the whole lying zone", () => {
    // The body lies centred on the bed, so the middle (x within 0.8, z within 0.6) must be bare mattress: no pillow, blanket or frame poking up.
    for (let x = -0.8; x <= 0.8001; x += 0.2) for (let z = -0.6; z <= 0.6001; z += 0.2) {
      expect(topAt(bed, x, z)!, `at ${x.toFixed(1)}, ${z.toFixed(1)}`).toBeCloseTo(MATTRESS_TOP, 2);
    }
  });

  it("puts the pillow at the head end (-x) only", () => {
    expect(PILLOW_X).toBeLessThan(0);
    expect(topAt(bed, PILLOW_X, 0)!).toBeGreaterThan(MATTRESS_TOP + 0.15);       // the pillow is fat
    expect(topAt(bed, -PILLOW_X, 0)!).toBeLessThan(MATTRESS_TOP + 0.2);          // nothing as tall at the foot end (the blanket is folded flat)
  });

  it("has a tall headboard at -x and a low footboard at +x", () => {
    expect(topAt(bed, -BED_LENGTH / 2 + 0.1, 0)!).toBeCloseTo(HEADBOARD_HEIGHT, 1);
    const foot = topAt(bed, BED_LENGTH / 2 - 0.1, 0)!;
    expect(foot).toBeGreaterThan(MATTRESS_TOP - 0.2);
    expect(foot).toBeLessThan(MATTRESS_TOP + 0.1);
  });

  it("misses outside the frame", () => {
    expect(topAt(bed, BED_LENGTH / 2 + 0.5, 0)).toBeNull();
    expect(topAt(bed, 0, BED_WIDTH / 2 + 0.5)).toBeNull();
  });
});

describe("sleepSpot", () => {
  it("is the middle of the mattress, on its surface, and a ray there confirms the surface", () => {
    const bed = buildBed(0, 0);
    const spot = sleepSpot({ x: 0, z: 0 });
    expect(spot.y).toBe(MATTRESS_TOP);
    expect(topAt(bed, spot.x, spot.z)!).toBeCloseTo(spot.y, 2);
  });

  it("follows the bed", () => {
    expect(sleepSpot({ x: 12.5, z: -3 })).toEqual({ x: 12.5, y: MATTRESS_TOP, z: -3 });
  });
});

describe("overBed", () => {
  const at = { x: 10, z: -1 };
  it("is true over the frame and false just outside it", () => {
    expect(overBed(at, 10, -1)).toBe(true);
    expect(overBed(at, 10 + BED_LENGTH / 2 - 0.01, -1)).toBe(true);
    expect(overBed(at, 10 + BED_LENGTH / 2 + 0.05, -1)).toBe(false);
    expect(overBed(at, 10, -1 + BED_WIDTH / 2 + 0.05)).toBe(false);
    expect(overBed(at, 10 - BED_LENGTH / 2 - 0.05, -1)).toBe(false);
    expect(overBed(at, 10, -1 - BED_WIDTH / 2 - 0.05)).toBe(false);
  });
});
