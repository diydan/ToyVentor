import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { BAR_COUNT, BAR_RING_S, BAR_SPACING, XYLO_COLORS, XYLO_NOTES, barIndexOf, barLength, barPose, barX, buildMalletMesh, buildXylophone, MALLET_LENGTH, PLANK } from "../src/features/game/world/runtime/xylophone";

const box = (o: THREE.Object3D) => { o.updateMatrixWorld(true); return new THREE.Box3().setFromObject(o); };

describe("the notes and colours", () => {
  it("are a rising C major scale, eight bars, eight different colours", () => {
    expect(XYLO_NOTES).toHaveLength(BAR_COUNT);
    expect(XYLO_COLORS).toHaveLength(BAR_COUNT);
    for (let i = 1; i < BAR_COUNT; i++) expect(XYLO_NOTES[i]!).toBeGreaterThan(XYLO_NOTES[i - 1]!);
    expect(XYLO_NOTES[0]).toBe(262);
    expect(XYLO_NOTES.at(-1)!).toBeCloseTo(XYLO_NOTES[0]! * 2, -1);                     // the last bar is the octave
    expect(new Set(XYLO_COLORS).size).toBe(BAR_COUNT);
    for (const c of XYLO_COLORS) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
  });
  it("the low notes are the long bars, and the bars are laid out evenly, centred on the xylophone", () => {
    for (let i = 1; i < BAR_COUNT; i++) { expect(barLength(i)).toBeLessThan(barLength(i - 1)); expect(barX(i) - barX(i - 1)).toBeCloseTo(BAR_SPACING, 9); }
    expect(barX(0) + barX(BAR_COUNT - 1)).toBeCloseTo(0, 9);
  });
});

describe("barPose", () => {
  it("is at rest before it is struck and once it has settled", () => {
    expect(barPose(-1)).toEqual({ dy: 0, rx: 0 });
    expect(barPose(Number.NaN)).toEqual({ dy: 0, rx: 0 });
    expect(barPose(BAR_RING_S)).toEqual({ dy: 0, rx: 0 });
    expect(barPose(9)).toEqual({ dy: 0, rx: 0 });
  });
  it("dips straight after a strike, rises back past rest and wobbles away, never far from rest", () => {
    let dip = 0, over = 0, wob = 0;
    for (let a = 0; a < BAR_RING_S; a += 0.005) { const p = barPose(a); dip = Math.min(dip, p.dy); over = Math.max(over, p.dy); wob = Math.max(wob, Math.abs(p.rx)); }
    expect(dip).toBeLessThan(-0.03);
    expect(dip).toBeGreaterThan(-0.1);
    expect(over).toBeGreaterThan(0.005);
    expect(wob).toBeGreaterThan(0.02);
    expect(Math.abs(barPose(BAR_RING_S - 0.01).dy)).toBeLessThan(0.01);                 // the motion has died down by the end
    expect(Math.abs(barPose(0).dy)).toBe(0);                                          // it starts from rest, no jump
  });
});

describe("buildXylophone", () => {
  it("stands on the floor at its place with eight coloured bars on a rack, on a base plank a little over four units wide", () => {
    const g = buildXylophone(3.6, -2.6);
    expect(g.position.toArray()).toEqual([3.6, 0, -2.6]);
    const b = box(g), size = b.getSize(new THREE.Vector3());
    expect(b.min.y).toBeGreaterThanOrEqual(-0.01);
    expect(b.min.y).toBeLessThan(0.05);
    expect(size.x).toBeGreaterThan(PLANK.w - 0.05);
    expect(size.x).toBeLessThan(PLANK.w + 0.2);
    expect(size.y).toBeGreaterThan(1.3);
    expect(size.y).toBeLessThan(2.4);
    expect(g.userData.bars).toHaveLength(BAR_COUNT);
  });

  it("every mesh of a bar belongs to that bar, and the frame belongs to none", () => {
    const g = buildXylophone(0, 0);
    g.userData.bars.forEach((bar: THREE.Group, i: number) => {
      expect(bar.children, `bar ${i} has its slab and two pegs`).toHaveLength(3);
      const slab = bar.children[0] as THREE.Mesh;
      expect(((slab.material as THREE.MeshPhysicalMaterial).color.getHexString()), `bar ${i} colour`).toBe(XYLO_COLORS[i]!.slice(1).toLowerCase());
      bar.traverse((o) => { if ((o as THREE.Mesh).isMesh) expect(barIndexOf(o), `bar ${i}`).toBe(i); });
    });
    let frameMeshes = 0;
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh && barIndexOf(o) === null) frameMeshes++; });
    expect(frameMeshes).toBeGreaterThanOrEqual(8);
    expect(barIndexOf(g)).toBeNull();
    expect(barIndexOf(null)).toBeNull();
  });

  it("the bars face the camera: their top faces point up and towards +z, the top end tipped away", () => {
    const g = buildXylophone(0, 0);
    g.updateMatrixWorld(true);
    const bar = g.userData.bars[2] as THREE.Group;
    const normal = new THREE.Vector3(0, 1, 0).transformDirection(bar.matrixWorld);
    expect(normal.z).toBeGreaterThan(0.5);
    expect(normal.y).toBeGreaterThan(0.4);
    const length = new THREE.Vector3(0, 0, 1).transformDirection(bar.matrixWorld);
    expect(length.y).toBeLessThan(-0.4);                                      // its +z end is the LOW end, so the bar leans back at the top
  });

  it("the bars rise in pitch from left to right across the screen, as a xylophone's do", () => {
    const g = buildXylophone(0, 0);
    g.updateMatrixWorld(true);
    const xs = g.userData.bars.map((b: THREE.Object3D) => b.getWorldPosition(new THREE.Vector3()).x);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
  });

  it("strikeBar rings the bar: it returns that bar's pitch, and the bar dips on the next tick and settles", () => {
    const g = buildXylophone(0, 0);
    const bar = g.userData.bars[3] as THREE.Group;
    g.userData.tick(10);
    const y0 = bar.position.y;
    expect(g.userData.strikeBar(3)).toBe(XYLO_NOTES[3]);
    g.userData.tick(10.05);                                                  // (the strike is stamped with the time of the next tick)
    g.userData.tick(10.09);
    expect(bar.position.y).not.toBe(y0);
    let min = y0;
    for (let t = 10.09; t < 10.05 + BAR_RING_S + 0.1; t += 0.01) { g.userData.tick(t); min = Math.min(min, bar.position.y); }
    expect(min).toBeLessThan(y0 - 0.03);
    expect(bar.position.y).toBeCloseTo(y0, 9);                               // settled
    expect((g.userData.bars[2] as THREE.Group).position.y).toBeCloseTo(y0, 9);  // the others never moved
  });

  it("strikeBar refuses a bar that is not there", () => {
    const g = buildXylophone(0, 0);
    for (const i of [-1, 8, 1.5, Number.NaN]) expect(g.userData.strikeBar(i)).toBeNull();
  });

  it("tapPart on a bar's mesh rings that bar and returns its pitch; on the frame it returns null and rings nothing", () => {
    const g = buildXylophone(0, 0);
    const bar = g.userData.bars[5] as THREE.Group;
    const mesh = bar.children[0]!;
    expect(g.userData.tapPart(mesh)).toBe(XYLO_NOTES[5]);
    g.userData.tick(1);
    g.userData.tick(1.04);
    expect(bar.rotation.x !== 0 || bar.position.y !== 0.04).toBe(true);
    let frame: THREE.Object3D | null = null;
    g.traverse((o) => { if (!frame && (o as THREE.Mesh).isMesh && barIndexOf(o) === null) frame = o; });
    expect(g.userData.tapPart(frame!)).toBeNull();
  });
});

describe("the mallets", () => {
  const size = (o: THREE.Object3D) => { o.updateMatrixWorld(true); return new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3()); };
  it("a mallet is a thin stick with a head, standing along +y from its handle end", () => {
    const m = buildMalletMesh();
    const s = size(m);
    expect(s.y).toBeGreaterThan(MALLET_LENGTH);
    expect(s.y).toBeLessThan(MALLET_LENGTH + 0.2);
    expect(s.x).toBeLessThan(0.2);
    const box = new THREE.Box3().setFromObject(m);
    expect(box.min.y).toBeGreaterThanOrEqual(-1e-6);                          // the handle end is the origin
    let n = 0; m.traverse((o) => { if ((o as THREE.Mesh).isMesh) n++; });
    expect(n).toBe(2);
  });
  it("two lie on the front ledge in one group the act can hide: sticks along x, side by side, in front of the bars", () => {
    const g = buildXylophone(3.6, -2.6);
    const mallets = g.userData.mallets as THREE.Group;
    expect(mallets).toBeInstanceOf(THREE.Group);
    expect(g.children).toContain(mallets);
    expect(mallets.children).toHaveLength(2);
    expect(mallets.visible).toBe(true);
    for (const m of mallets.children) {
      const box = new THREE.Box3().setFromObject(m);
      const s = box.getSize(new THREE.Vector3());
      expect(s.x).toBeGreaterThan(MALLET_LENGTH);                              // lying along x
      expect(s.y).toBeLessThan(0.2);
      expect(box.min.z).toBeGreaterThan(0.4);                                  // out in front of the rack
    }
    const [a, b] = mallets.children.map((m) => new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3()).x);
    expect(Math.abs(a! - b!)).toBeGreaterThan(0.5);
  });
});

describe("the base plank", () => {
  const g = buildXylophone(3.6, -2.6);
  const plank = g.getObjectByName("plank") as THREE.Mesh;
  const box = (o: THREE.Object3D) => { o.updateMatrixWorld(true); return new THREE.Box3().setFromObject(o); };
  it("is one wide, flat plank on the floor, and part of the frame (no bar)", () => {
    expect(plank).toBeDefined();
    expect(plank.isMesh).toBe(true);
    expect(barIndexOf(plank)).toBeNull();
    const b = box(plank), s = b.getSize(new THREE.Vector3());
    expect(s.x).toBeCloseTo(PLANK.w, 2);
    expect(s.z).toBeCloseTo(PLANK.d, 2);
    expect(s.y).toBeCloseTo(PLANK.h, 2);
    expect(b.min.y).toBeCloseTo(0, 2);
  });
  it("is wider than the rack and the legs, and reaches out in front of them where a finger can land", () => {
    const rackWidth = 3.7 + 0.24;
    expect(PLANK.w).toBeGreaterThan(rackWidth + 0.3);
    const b = box(plank);
    expect(b.max.z - g.position.z).toBeGreaterThan(0.6);                   // out beyond the front legs (z = 0.35)
  });
  it("the legs stand on it, the bars are above it and the mallets lie on it", () => {
    const top = PLANK.h;
    g.updateMatrixWorld(true);
    const legs: THREE.Mesh[] = [];
    g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.geometry.type === "CylinderGeometry" && barIndexOf(o) === null && !(o.parent === g.userData.mallets) && o.parent === g) legs.push(m); });
    expect(legs).toHaveLength(4);
    for (const l of legs) expect(box(l).min.y).toBeCloseTo(top, 2);
    for (const bar of g.userData.bars as THREE.Group[]) expect(box(bar).min.y).toBeGreaterThan(top + 0.5);
    for (const m of (g.userData.mallets as THREE.Group).children) expect(box(m).min.y).toBeGreaterThanOrEqual(top - 1e-6);
  });
});
