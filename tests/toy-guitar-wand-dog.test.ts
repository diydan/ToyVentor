// The new Toy Room toys' geometry (guitar, bubble set) and the dog: real three.js meshes and the pure dog pose.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { BARK_S, PET_REACTION_S, SIT_RATE, WOOFS, applyDogPose, buildDog, dogPose, fidget, withSit } from "../src/features/game/world/runtime/dog";
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
    expect(p.headPitch).toBeGreaterThan(0.1);                            // nose up, into the hand (positive pitch is nose up)
    expect(p.earFlop).toBeGreaterThan(0.09);
    expect(dogPose(3, "pet", PET_REACTION_S + 0.01)).toEqual(dogPose(3, null, Infinity));
  });
});

describe("buildDog", () => {
  it("stands on the floor facing -x: the head is at the -x end, the tail at the +x end", () => {
    const d = buildDog(42, -2);
    expect(d.position.toArray()).toEqual([42, 0, -2]);
    d.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(d, true);                     // (precise: the legs are bent, a loose box round a tilted paw dips below the floor)
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

import { HAPPY_S } from "../src/features/game/world/runtime/dog";

describe("dogPose: running and being delighted (the fetch)", () => {
  it("running: bounding along with its tail up and flying and its ears flapping, for as long as it is cued so", () => {
    let wag = 0, bobSum = 0, bobMin = 9, ear = 0;
    for (let t = 0; t < 4; t += 0.01) {
      const p = dogPose(t, "run", 100);                                 // however long ago it was cued
      wag = Math.max(wag, Math.abs(p.tailYaw));
      bobSum += p.bob; bobMin = Math.min(bobMin, p.bob);
      ear = Math.max(ear, Math.abs(p.earFlop));
      expect(p.tailLift).toBe(0.6);
      expect(p.bodyPitch).toBeLessThan(0);
    }
    expect(wag).toBeGreaterThan(0.45);
    expect(bobMin).toBeGreaterThanOrEqual(0);                            // it bounds: never dips below the floor
    expect(bobSum).toBe(0);                                               // (the bounce comes with the stride now: withGait, the legs and the body move together)
    expect(ear).toBeGreaterThan(0.2);
  });

  it("delighted: hops on the spot with a fast wag for HAPPY_S, then it is just a dog again", () => {
    let bob = 0, wag = 0;
    for (let t = 0; t < HAPPY_S; t += 0.01) { const p = dogPose(2 + t, "happy", t); bob = Math.max(bob, p.bob); wag = Math.max(wag, Math.abs(p.tailYaw)); }
    expect(bob).toBeGreaterThan(0.04);
    expect(wag).toBeGreaterThan(0.6);
    expect(dogPose(5, "happy", HAPPY_S + 0.01)).toEqual(dogPose(5, null, Infinity));
    expect(dogPose(5, "happy", -1)).toEqual(dogPose(5, null, Infinity));
  });

  it("the `idle` cue is the plain dog", () => {
    expect(dogPose(5, "idle", 0.2)).toEqual(dogPose(5, null, Infinity));
  });
});

describe("the dog sitting (it waits for Kip)", () => {
  it("sitting weight 0 is the standing pose exactly, and any pose can be seated", () => {
    const p = dogPose(3, null, Infinity);
    expect(withSit(p, 0)).toBe(p);
    expect(withSit(p, -5)).toBe(p);
    expect(withSit(p, Number.NaN)).toEqual(withSit(p, Number.NaN));
  });
  it("seated: the rump is down, the chest and head up, the tail low and dropped", () => {
    const p = dogPose(3, null, Infinity), q = withSit(p, 1);
    expect(q.bob).toBeLessThan(p.bob - 0.1);
    expect(q.bodyPitch).toBeGreaterThan(p.bodyPitch + 0.2);
    expect(q.headPitch).toBeGreaterThan(p.headPitch + 0.1);
    expect(q.tailLift).toBeLessThan(p.tailLift);
    expect(q.tailDrop).toBeGreaterThan(0.1);
    expect(q.headDrop).toBeGreaterThan(0);
    expect(q.tailYaw).toBe(p.tailYaw);                                    // the wag itself is the cue's business
  });
  it("is a smooth, one-way blend: every step towards seated lowers it a little more", () => {
    const p = dogPose(3, null, Infinity);
    let prev = withSit(p, 0);
    for (let k = 0.1; k <= 1.0001; k += 0.1) {
      const q = withSit(p, k);
      expect(q.bob).toBeLessThan(prev.bob);
      expect(q.bodyPitch).toBeGreaterThan(prev.bodyPitch);
      prev = q;
    }
    expect(withSit(p, 7)).toEqual(withSit(p, 1));
  });
  it("the sit cue is a lazy wag and lasts for as long as the dog is cued", () => {
    let wag = 0;
    for (let t = 0; t < 4; t += 0.01) wag = Math.max(wag, Math.abs(dogPose(t, "sit", 100).tailYaw));
    expect(wag).toBeGreaterThan(0.2);
    expect(wag).toBeLessThanOrEqual(0.3 + 1e-9);
    expect(dogPose(5, "sit", 0)).toEqual(dogPose(5, "sit", 1000));
    expect(dogPose(5, "sit", 1000)).not.toEqual(dogPose(5, null, Infinity));
  });

  const sitCue = (d: ReturnType<typeof buildDog>, t: number) => { d.userData.cue = { name: "sit", at: t }; };
  const frames = (d: ReturnType<typeof buildDog>, from: number, seconds: number) => { let t = from; for (let k = 0; k < seconds * 60; k++) { t += 1 / 60; d.userData.tick(t, 1 / 60); } return t; };

  it("the built dog eases down into a seat over a moment, and the body, tail and head really are lower", () => {
    const d = buildDog(0, 0);
    const parts = d.userData.dogParts;
    let t = frames(d, 0, 1);
    const standing = { body: parts.body.position.y, tail: parts.tail.position.y, head: parts.head.position.y };
    sitCue(d, t);
    t = frames(d, t, 0.1);
    expect(d.userData.sitK).toBeGreaterThan(0.2);
    expect(d.userData.sitK).toBeLessThan(0.9);                            // on its way, not there yet
    t = frames(d, t, 1.5);
    expect(d.userData.sitK).toBe(1);
    expect(parts.body.position.y).toBeLessThan(standing.body - 0.1);
    expect(parts.tail.position.y).toBeLessThan(standing.tail - 0.2);
    expect(parts.head.position.y).toBeLessThan(standing.head - 0.05);
    expect(parts.body.rotation.z).toBeGreaterThan(0.3);
  });
  it("it sits down within about a third of a second (SIT_RATE) and never overshoots", () => {
    const d = buildDog(0, 0);
    sitCue(d, 0);
    let prev = 0, t = 0;
    for (let k = 0; k < 120; k++) { t += 1 / 60; d.userData.tick(t, 1 / 60); expect(d.userData.sitK).toBeGreaterThanOrEqual(prev); expect(d.userData.sitK).toBeLessThanOrEqual(1); prev = d.userData.sitK; if (k === 20) expect(prev).toBeGreaterThan(0.7); }
    expect(1 - Math.exp(-SIT_RATE * 0.35)).toBeGreaterThan(0.85);
  });
  it("it gets up smoothly when cued to do something else (not a pop), and a bark on the way makes it stand and woof", () => {
    const d = buildDog(0, 0);
    const parts = d.userData.dogParts;
    sitCue(d, 0);
    let t = frames(d, 0, 2);
    const seated = parts.body.position.y;
    d.userData.cue = { name: "run", at: t };
    t = frames(d, t, 1 / 60);
    expect(d.userData.sitK).toBeLessThan(1);
    expect(d.userData.sitK).toBeGreaterThan(0.8);                         // one frame later it is still mostly seated
    t = frames(d, t, 1.5);
    expect(d.userData.sitK).toBe(0);
    expect(parts.body.position.y).toBeGreaterThan(seated + 0.1);
    sitCue(d, t);
    t = frames(d, t, 1);
    d.userData.cue = { name: "bark", at: t };
    t = frames(d, t, 1.2);
    expect(d.userData.sitK).toBe(0);
  });
  it("a bad frame time changes nothing, and the tick still works with no frame time at all", () => {
    const d = buildDog(0, 0);
    sitCue(d, 0);
    d.userData.tick(0.5, Number.NaN);
    d.userData.tick(0.6, -1);
    expect(d.userData.sitK).toBe(0);
    d.userData.tick(0.7);
    expect(d.userData.sitK).toBeGreaterThan(0);
  });
  it("applyDogPose with no sit fields (a standing pose) puts the tail and head back where they were built", () => {
    const d = buildDog(0, 0);
    const parts = d.userData.dogParts;
    applyDogPose(parts, withSit(dogPose(1, null, Infinity), 1));
    applyDogPose(parts, dogPose(1, null, Infinity));
    expect(parts.tail.position.y).toBe(0.95);
    expect(parts.head.position.y).toBe(1.18);
  });
});
