import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { HELD, buildBookMesh, createHeld } from "../src/features/game/world/runtime/heldItems";

const size = (o: THREE.Object3D) => { o.updateMatrixWorld(true); return new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3()); };

describe("the book", () => {
  it("is a small hardback: flat, about 0.7 by 0.5, with real parts", () => {
    const b = buildBookMesh();
    const s = size(b);
    expect(s.x).toBeGreaterThan(0.65); expect(s.x).toBeLessThan(0.8);
    expect(s.z).toBeGreaterThan(0.45); expect(s.z).toBeLessThan(0.6);
    expect(s.y).toBeLessThan(0.25);
    let n = 0; b.traverse((o) => { if ((o as THREE.Mesh).isMesh) n++; });
    expect(n).toBeGreaterThanOrEqual(4);
  });
});

describe("HELD", () => {
  it("describes every item: where it goes, how it sits and how big, and each builds a real mesh", () => {
    expect(Object.keys(HELD).sort()).toEqual(["book", "guitar", "wand"]);
    for (const [name, spec] of Object.entries(HELD)) {
      expect(["model", "armR"], name).toContain(spec.parent);
      for (const v of [...spec.position, ...spec.rotation, spec.scale]) expect(Number.isFinite(v), name).toBe(true);
      expect(spec.scale, name).toBeGreaterThan(0);
      expect(spec.build().children.length, name).toBeGreaterThan(1);
    }
  });
  it("each item builds the right thing: a flat book, a tall guitar, a wand about a unit long", () => {
    const book = size(HELD.book.build()), guitar = size(HELD.guitar.build()), wand = size(HELD.wand.build());
    expect(book.y).toBeLessThan(0.25);
    expect(guitar.y).toBeGreaterThan(2.2);
    expect(wand.y).toBeGreaterThan(0.8);
    expect(wand.y).toBeLessThan(1.1);
    expect(wand.x).toBeLessThan(0.5);
  });
  it("the book and the guitar ride on the body, the wand on the right arm", () => {
    expect([HELD.book.parent, HELD.guitar.parent, HELD.wand.parent]).toEqual(["model", "model", "armR"]);
  });
  it("the guitar is held smaller than the one on its stand", () => {
    expect(HELD.guitar.scale).toBeLessThan(1);
    expect(HELD.guitar.scale).toBeGreaterThan(0.5);
  });
});

describe("createHeld", () => {
  const rig = () => ({ model: new THREE.Group(), armR: new THREE.Group() });
  it("attaches the item where its spec says, at the spec's place, and reports what is held", () => {
    const { model, armR } = rig();
    const h = createHeld();
    expect(h.item).toBeNull();
    expect(h.hold("book", model, armR)).toBe(true);
    expect(h.item).toBe("book");
    expect(h.mesh!.parent).toBe(model);
    expect(h.mesh!.position.toArray()).toEqual([...HELD.book.position]);
    expect(h.mesh!.rotation.z).toBeCloseTo(HELD.book.rotation[2], 9);
    expect(h.hold("wand", model, armR)).toBe(true);
    expect(h.mesh!.parent).toBe(armR);
    expect(h.mesh!.rotation.z).toBeCloseTo(Math.PI, 9);
  });

  it("scales the guitar down", () => {
    const { model, armR } = rig();
    const h = createHeld();
    h.hold("guitar", model, armR);
    expect(h.mesh!.scale.x).toBeCloseTo(HELD.guitar.scale, 9);
  });

  it("picking up something lets go of what was held: only one thing is ever attached", () => {
    const { model, armR } = rig();
    const h = createHeld();
    h.hold("book", model, armR);
    const book = h.mesh!;
    h.hold("guitar", model, armR);
    expect(book.parent).toBeNull();
    expect(model.children).toHaveLength(1);
    expect(h.item).toBe("guitar");
  });

  it("release takes it off the rig, and is safe to call again or when nothing is held", () => {
    const { model, armR } = rig();
    const h = createHeld();
    h.release();
    h.hold("wand", model, armR);
    expect(armR.children).toHaveLength(1);
    h.release();
    expect(armR.children).toHaveLength(0);
    expect(h.item).toBeNull();
    expect(h.mesh).toBeNull();
    h.release();
  });

  it("cannot hold what needs a part the rig does not have: nothing is attached and nothing is held", () => {
    const { model } = rig();
    const h = createHeld();
    expect(h.hold("wand", model, null)).toBe(false);
    expect(h.item).toBeNull();
    expect(h.hold("wand", model, undefined)).toBe(false);
    expect(h.hold("book", null, null)).toBe(false);
    expect(h.item).toBeNull();
  });

  it("a failed pick-up still lets go of what was held", () => {
    const { model, armR } = rig();
    const h = createHeld();
    h.hold("book", model, armR);
    h.hold("wand", model, null);
    expect(h.item).toBeNull();
    expect(model.children).toHaveLength(0);
  });
});
