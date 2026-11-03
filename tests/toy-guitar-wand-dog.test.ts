// The new Toy Room toys' geometry (guitar, bubble set) and the dog: real three.js meshes and the pure dog pose.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { BARK_S, PET_REACTION_S, WOOFS, applyDogPose, buildDog, dogPose, fidget } from "../src/features/game/world/runtime/dog";
import { GUITAR_BODY_W, GUITAR_LENGTH, HELD_GUITAR_SCALE, buildGuitarMesh, buildGuitarProp } from "../src/features/game/world/runtime/guitar";
import { WAND_LENGTH, WAND_RING_R, buildBubbleBottle, buildWandMesh } from "../src/features/game/world/runtime/bubbleWand";

const box = (o: THREE.Object3D) => { o.updateMatrixWorld(true); return new THREE.Box3().setFromObject(o); };
const meshes = (o: THREE.Object3D) => { const out: THREE.Mesh[] = []; o.traverse((c) => { if ((c as THREE.Mesh).isMesh) out.push(c as THREE.Mesh); }); return out; };

describe("the guitar", () => {
  it("is guitar-shaped: tall and narrow, a fat body at the bottom and a neck and head above it", () => {
    const b = box(buildGuitarMesh()), size = b.getSize(new THREE.Vector3());
    expect(size.y).toBeGreaterThan(GUITAR_LENGTH - 0.15);
    expect(size.y).toBeLessThan(GUITAR_LENGTH + 0.15);
    expect(size.x).toBeGreaterThan(GUITAR_BODY_W - 0.1);                // as wide as its body
    expect(size.x).toBeLessThan(GUITAR_BODY_W + 0.15);
    expect(size.z).toBeLessThan(0.6);                                   // and flat
    expect(b.min.y).toBeCloseTo(-0.85, 1);
    expect(meshes(buildGuitarMesh()).length).toBeGreaterThanOrEqual(15);
  });

  it("the neck is much narrower than the body, so it reads as a neck", () => {
    const g = buildGuitarMesh();
    const slice = (y0: number, y1: number) => { const b = new THREE.Box3(); for (const m of meshes(g)) { const mb = new THREE.Box3().setFromObject(m); if (mb.min.y >= y0 && mb.max.y <= y1) b.union(mb); } return b.getSize(new THREE.Vector3()).x; };
    expect(slice(1.1, 1.7)).toBeLessThan(0.5);
    expect(box(g).getSize(new THREE.Vector3()).x).toBeGreaterThan(0.85);
  });

  it("the prop stands on the floor at its place, on a tripod, a little taller than Kip's waist and clear of the ground", () => {
    const p = buildGuitarProp(18.4, -2.4);
    expect(p.position.toArray()).toEqual([18.4, 0, -2.4]);
    const b = box(p);
    expect(b.min.y).toBeGreaterThanOrEqual(-0.01);
    expect(b.min.y).toBeLessThan(0.05);                                 // the legs touch the floor
    expect(b.max.y).toBeGreaterThan(2.8);
    expect(b.max.y).toBeLessThan(3.6);
    expect(Math.abs((b.min.x + b.max.x) / 2 - 18.4)).toBeLessThan(0.4);
  });

  it("the guitar Kip holds is the same guitar, smaller", () => {
    expect(HELD_GUITAR_SCALE).toBeLessThan(1);
    const g = buildGuitarMesh();
    g.scale.setScalar(HELD_GUITAR_SCALE);
    expect(box(g).getSize(new THREE.Vector3()).y).toBeCloseTo(box(buildGuitarMesh()).getSize(new THREE.Vector3()).y * HELD_GUITAR_SCALE, 2);
  });
});

describe("the bubble set", () => {
  it("the wand is a handle with a ring at the top, standing from y = 0", () => {
    const b = box(buildWandMesh());
    expect(b.min.y).toBeGreaterThanOrEqual(-0.05);
    expect(b.max.y).toBeGreaterThan(WAND_LENGTH - 0.06);
    expect(b.max.y).toBeLessThan(WAND_LENGTH + 0.1);
    expect(b.getSize(new THREE.Vector3()).x).toBeGreaterThan(WAND_RING_R * 2);          // the ring is the widest part
    expect(b.getSize(new THREE.Vector3()).x).toBeLessThan(WAND_RING_R * 2 + 0.15);
  });

  it("the bottle stands on the floor at its place with the wand sticking out of the top", () => {
    const p = buildBubbleBottle(37.8, -2.2);
    expect(p.position.toArray()).toEqual([37.8, 0, -2.2]);
    const b = box(p);
    expect(b.min.y).toBeGreaterThanOrEqual(-0.01);
    expect(b.min.y).toBeLessThan(0.05);
    expect(b.max.y).toBeGreaterThan(1.8);                                // the wand sticks well out
    expect(b.max.y).toBeLessThan(2.4);
    expect(meshes(p).length).toBeGreaterThanOrEqual(7);
  });
});

describe("dogPose: alive all the time", () => {
  it("breathes, wags its tail slowly and sways its head, always within sane limits", () => {
    let wag = 0, breathMin = 9, breathMax = 0;
    for (let t = 0; t < 20; t += 0.05) {
      const p = dogPose(t, null, Infinity);
      wag = Math.max(wag, Math.abs(p.tailYaw));
      breathMin = Math.min(breathMin, p.bodyScaleY); breathMax = Math.max(breathMax, p.bodyScaleY);
      expect(Math.abs(p.headPitch)).toBeLessThan(0.1);
      expect(Math.abs(p.headYaw)).toBeLessThan(0.15);
      expect(p.bob).toBe(0);
      expect(Number.isFinite(p.tailYaw + p.headRoll + p.earFlop)).toBe(true);
    }
    expect(wag).toBeGreaterThan(0.3);
    expect(wag).toBeLessThan(0.4);
    expect(breathMax - breathMin).toBeGreaterThan(0.02);
    expect(breathMax - breathMin).toBeLessThan(0.05);
  });

  it("tilts its head now and then (every seven seconds), and otherwise holds it level", () => {
    expect(fidget(0)).toBe(0);
    expect(fidget(7 * 0.62)).toBeGreaterThan(0.3);
    expect(fidget(7 * 0.62 + 7)).toBeCloseTo(fidget(7 * 0.62), 9);
    expect(fidget(3)).toBe(0);
    expect(fidget(-1)).toBeGreaterThanOrEqual(0);
  });
});

describe("dogPose: a bark", () => {
  it("is two woofs: the head goes up and the dog hops at each, with nothing between and a fast wag throughout", () => {
    for (const w of WOOFS) {
      const p = dogPose(1, "bark", w.at + w.len / 2);
      expect(p.bob, `woof at ${w.at}`).toBeGreaterThan(0.08);
      expect(p.headPitch).toBeLessThan(-0.2);
      expect(p.bodyPitch).toBeLessThan(-0.04);
    }
    const gap = dogPose(1, "bark", 0.17);
    expect(gap.bob).toBeLessThan(0.02);
    let wag = 0;
    for (let t = 0; t < 1; t += 0.01) wag = Math.max(wag, Math.abs(dogPose(t, "bark", 0.4).tailYaw));
    expect(wag).toBeGreaterThan(0.5);
  });

  it("hops exactly twice: two peaks in the bob", () => {
    const bobs = Array.from({ length: 91 }, (_, i) => dogPose(1, "bark", i * 0.01).bob);
    let peaks = 0;
    for (let i = 1; i < bobs.length - 1; i++) if (bobs[i]! > 0.05 && bobs[i]! >= bobs[i - 1]! && bobs[i]! > bobs[i + 1]!) peaks++;
    expect(peaks).toBe(2);
  });

  it("is over after BARK_S, and a cue that has not happened yet does nothing", () => {
    expect(dogPose(5, "bark", BARK_S + 0.01)).toEqual(dogPose(5, null, Infinity));
    expect(dogPose(5, "bark", -1)).toEqual(dogPose(5, null, Infinity));
  });
});

describe("dogPose: being petted", () => {
  it("wags its whole back end, lifts its head into the hand and flaps its ears, until PET_REACTION_S is over", () => {
    let wag = 0;
    for (let t = 0; t < 2; t += 0.01) wag = Math.max(wag, Math.abs(dogPose(t, "pet", 0.5).tailYaw));
    expect(wag).toBeGreaterThan(0.6);
    const p = dogPose(3, "pet", 1);
    expect(p.headPitch).toBeLessThan(-0.1);
    expect(p.earFlop).toBeGreaterThan(0.09);
    expect(dogPose(3, "pet", PET_REACTION_S + 0.01)).toEqual(dogPose(3, null, Infinity));
  });
});

describe("buildDog", () => {
  it("stands on the floor facing -x: the head is at the -x end, the tail at the +x end", () => {
    const d = buildDog(42, -2);
    expect(d.position.toArray()).toEqual([42, 0, -2]);
    const b = box(d);
    expect(b.min.y).toBeGreaterThanOrEqual(-0.01);
    expect(b.min.y).toBeLessThan(0.03);
    expect(b.max.y).toBeGreaterThan(1.3);
    expect(b.max.y).toBeLessThan(1.9);
    const parts = d.userData.dogParts;
    const headX = parts.head.getWorldPosition(new THREE.Vector3()).x, tailX = parts.tail.getWorldPosition(new THREE.Vector3()).x;
    expect(headX).toBeLessThan(42);
    expect(tailX).toBeGreaterThan(42);
    expect(meshes(d).length).toBeGreaterThanOrEqual(18);
  });

  it("its tick moves the tail, head and body over time, and a bark cue makes it hop", () => {
    const d = buildDog(0, 0);
    const parts = d.userData.dogParts;
    d.userData.tick(0.5);
    const yaw0 = parts.tail.rotation.y;
    d.userData.tick(1.1);
    expect(parts.tail.rotation.y).not.toBe(yaw0);
    d.userData.tick(2);
    expect(parts.body.position.y).toBeCloseTo(0.78, 6);                   // on the ground when idle
    d.userData.cue = { name: "bark", at: 10 };
    d.userData.tick(10.07);
    expect(parts.body.position.y).toBeGreaterThan(0.78 + 0.05);           // hopping at the first woof
    d.userData.tick(10 + BARK_S + 0.5);
    expect(parts.body.position.y).toBeCloseTo(0.78, 6);                   // and down again
  });

  it("applyDogPose writes every part of the pose onto the dog", () => {
    const d = buildDog(0, 0);
    const parts = d.userData.dogParts;
    applyDogPose(parts, { tailYaw: 0.3, tailLift: 0.4, headPitch: -0.2, headYaw: 0.1, headRoll: 0.2, bob: 0.1, earFlop: 0.15, bodyScaleY: 1.02, bodyPitch: -0.05 });
    expect(parts.tail.rotation.y).toBe(0.3);
    expect(parts.tail.rotation.z).toBe(0.4);
    expect([parts.head.rotation.x, parts.head.rotation.y, parts.head.rotation.z]).toEqual([0.2, 0.1, -0.2]);
    expect(parts.body.position.y).toBeCloseTo(0.88, 6);
    expect(parts.body.scale.y).toBe(1.02);
    expect(parts.body.rotation.z).toBe(-0.05);
    expect(parts.earL.rotation.x).toBe(0.15);
    expect(parts.earR.rotation.x).toBe(-0.15);
  });
});
