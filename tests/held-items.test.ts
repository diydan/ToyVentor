import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { ARM_FIST, HELD, buildBookMesh, createHeld } from "../src/features/game/world/runtime/heldItems";

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
    expect(Object.keys(HELD).sort()).toEqual(["book", "bouquet", "can", "carrot", "guitar", "mallets", "mop", "sandwich", "spatula", "sponge", "vacuum", "wand"]);
    for (const [name, spec] of Object.entries(HELD)) {
      expect(["model", "armR", "arms"], name).toContain(spec.parent);
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
  it("the mallets are a pair, one for each hand, each a stick about 0.7 long", () => {
    expect(HELD.mallets.parent).toBe("arms");
    const m = size(HELD.mallets.build());
    expect(m.y).toBeGreaterThan(0.7);
    expect(m.y).toBeLessThan(0.9);
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

  it("the mallets go one in each hand: the right arm and the left arm each carry one, nothing on the body", () => {
    const { model, armR } = rig();
    const armL = new THREE.Group();
    const h = createHeld();
    expect(h.hold("mallets", model, armR, armL)).toBe(true);
    expect(h.item).toBe("mallets");
    expect(armR.children).toHaveLength(1);
    expect(armL.children).toHaveLength(1);
    expect(model.children).toHaveLength(0);
    expect(armR.children[0]).not.toBe(armL.children[0]);
    expect(h.meshes).toHaveLength(2);
    expect(h.mesh).toBe(armR.children[0]);
    for (const a of [armR, armL]) {
      // these arms are plain holders, not grips, so the fist is where the arm holder says it is (ARM_FIST); a real rig's grip has `userData.grip` and the item sits at its origin (below)
      expect(a.children[0]!.position.toArray()).toEqual([HELD.mallets.position[0] + ARM_FIST[0], HELD.mallets.position[1] + ARM_FIST[1], HELD.mallets.position[2] + ARM_FIST[2]]);
      expect(a.children[0]!.rotation.z).toBeCloseTo(Math.PI, 9);
    }
    h.release();
    expect(armR.children).toHaveLength(0);
    expect(armL.children).toHaveLength(0);
    expect(h.meshes).toHaveLength(0);
    expect(h.item).toBeNull();
  });

  it("a pair needs both hands: with no left arm (or no right) nothing is attached and nothing is held", () => {
    const { model, armR } = rig();
    const armL = new THREE.Group();
    const h = createHeld();
    expect(h.hold("mallets", model, armR)).toBe(false);
    expect(armR.children).toHaveLength(0);
    expect(h.item).toBeNull();
    expect(h.hold("mallets", model, null, armL)).toBe(false);
    expect(armL.children).toHaveLength(0);
    expect(h.item).toBeNull();
  });

  it("picking up a pair lets go of a single item, and a single item lets go of a pair", () => {
    const { model, armR } = rig();
    const armL = new THREE.Group();
    const h = createHeld();
    h.hold("wand", model, armR, armL);
    const wand = h.mesh!;
    h.hold("mallets", model, armR, armL);
    expect(wand.parent).toBeNull();
    expect(armR.children).toHaveLength(1);
    const pair = [...h.meshes];
    h.hold("book", model, armR, armL);
    expect(pair.every((p) => p.parent === null)).toBe(true);
    expect(armL.children).toHaveLength(0);
    expect(h.meshes).toHaveLength(1);
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

describe("what Kip holds is in his fist (Dan, 2026-11-04: \"holding props is often in the wrong orientation\")", () => {
  const rnd = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  /** A body group at a random pose with two grip anchors (children of arm groups) at random places, as the rig has. */
  function scene(r: () => number) {
    const root = new THREE.Group();
    root.position.set(r() * 20 - 10, r() * 2, r() * 6 - 3);
    root.rotation.set(0, r() * 6.28, 0);
    const model = new THREE.Group();
    model.position.set(r() - 0.5, 0, 0);
    model.rotation.set(0, 0, r() * 0.4 - 0.2);
    root.add(model);
    const arms = [new THREE.Group(), new THREE.Group()];
    const grips = arms.map((a) => { root.add(a); const g = new THREE.Group(); g.userData.grip = true; a.add(g); return g; });
    for (const a of arms) { a.position.set(r() * 2 - 1, 1 + r(), r() * 2 - 1); a.rotation.set(r() * 3 - 1.5, r() * 3 - 1.5, r() * 3 - 1.5); }
    grips.forEach((g) => g.position.set(0.125, -0.85, 0.03));
    root.updateMatrixWorld(true);
    return { root, model, arms, grips };
  }
  const worldPos = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());

  it("a tool's handle point is in the hands (midway between the fists) at every frame, whatever the body and the arms do, and its tilt never changes", () => {
    for (const item of ["mop", "vacuum", "sponge", "spatula"] as const) {
      const spec = HELD[item];
      const r = rnd(7);
      for (let k = 0; k < 20; k++) {
        const { model, grips } = scene(r);
        const h = createHeld();
        expect(h.hold(item, model, grips[1], grips[0])).toBe(true);
        const mesh = h.mesh!;
        const tilt = mesh.rotation.clone();
        h.follow(model, grips);
        mesh.updateMatrixWorld(true);
        const handle = mesh.localToWorld(new THREE.Vector3(...spec.hands!.grip));        // the item's grip point, in the world, scale and all
        const mid = worldPos(grips[0]!).add(worldPos(grips[1]!)).multiplyScalar(0.5);
        expect(handle.distanceTo(mid), `${item} ${k}`).toBeLessThan(1e-9);
        expect(mesh.rotation.equals(tilt)).toBe(true);
      }
    }
  });
  it("the book is between the two hands the same way, and the guitar (no `hands`) is not moved by following", () => {
    const { model, grips } = scene(rnd(3));
    const h = createHeld();
    h.hold("book", model, grips[1], grips[0]);
    h.follow(model, grips);
    h.mesh!.updateMatrixWorld(true);
    expect(h.mesh!.localToWorld(new THREE.Vector3(...HELD.book.hands!.grip)).distanceTo(worldPos(grips[0]!).add(worldPos(grips[1]!)).multiplyScalar(0.5))).toBeLessThan(1e-9);
    const g = createHeld();
    g.hold("guitar", model, grips[1], grips[0]);
    const before = g.mesh!.position.clone();
    g.follow(model, grips);
    expect(g.mesh!.position.equals(before)).toBe(true);
  });
  it("follows nothing when nothing is held, when the rig has no grips, or when the item is not on this body", () => {
    const { model, grips } = scene(rnd(5));
    const h = createHeld();
    expect(() => h.follow(model, grips)).not.toThrow();                                   // nothing held
    h.hold("mop", model, grips[1], grips[0]);
    const before = h.mesh!.position.clone();
    h.follow(model, null); h.follow(null, grips); h.follow(model, [null, null]);
    expect(h.mesh!.position.equals(before)).toBe(true);
    const other = new THREE.Group();
    h.follow(other, grips);                                                               // not this body's: left alone
    expect(h.mesh!.position.equals(before)).toBe(true);
  });
  it("an item held in a fist has its own grip point in the fist: the can by its handle, the rest by their origin, and a rig with no grips holds from the arm holder's fist", () => {
    const { model, grips, arms } = scene(rnd(11));
    for (const item of ["can", "carrot", "bouquet", "sandwich", "wand"] as const) {
      const spec = HELD[item];
      const h = createHeld();
      expect(h.hold(item, model, grips[1], grips[0])).toBe(true);
      h.mesh!.updateMatrixWorld(true);
      const at = new THREE.Vector3(...(spec.at ?? [0, 0, 0]));
      expect(h.mesh!.localToWorld(at).distanceTo(worldPos(grips[1]!)), item).toBeLessThan(1e-9);
    }
    expect(HELD.can.at).toBeDefined();
    const plain = createHeld();
    plain.hold("sandwich", model, arms[1], arms[0]);                                       // arm holders: the fist is ARM_FIST down the arm
    expect(plain.mesh!.position.toArray()).toEqual([HELD.sandwich.position[0] + ARM_FIST[0], HELD.sandwich.position[1] + ARM_FIST[1], HELD.sandwich.position[2] + ARM_FIST[2]]);
  });
  it("nothing is held 0.4 to 0.5 down the arm any more (the old middle-of-the-sleeve numbers)", () => {
    for (const item of ["wand", "mallets", "can", "carrot", "bouquet", "sandwich"] as const) expect(Math.abs(HELD[item].position[1]), item).toBeLessThan(0.2);
  });
});
