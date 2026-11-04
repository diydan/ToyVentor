// The toy dog (docs/specs/playful-interactions-spec.md section 6): a chunky clay-toy dog that is alive all the time (it breathes, wags its tail, now and then tilts its head and flaps an ear), woofs and hops when it
// is tapped, and goes wild when it is petted. `dogPose` is the pure part: given the time, which cue it was given (if any) and how long ago, it says how every moving part sits; `buildDog` makes the meshes and a
// `tick` that applies the pose (propReactions.ts calls `holder.userData.tick(t, dt)` each frame and `fx.cue(inst, name)` sets `holder.userData.cue`). The dog faces -x (towards a Kip standing on its left).
import { T, M, plastic } from "./worldScene";
import type * as THREE from "three";

export type DogCue = "bark" | "pet" | "run" | "happy" | "sit" | "idle";
/** How long a cue's reaction lasts, in seconds. */
export const BARK_S = 0.9;
export const PET_REACTION_S = 2.8;
/** How long the delighted `happy` reaction lasts (after a kick, and after dropping the ball it fetched). `run` lasts until the dog is cued again. */
export const HAPPY_S = 1.4;
/** How quickly it sits down and gets up again: the share of the way it covers per second, roughly (the posture eases with the frame time, so it never pops). */
export const SIT_RATE = 7;
/** The two woofs of a bark: when each starts after the cue (seconds) and how long each lasts. */
export const WOOFS: ReadonlyArray<{ at: number; len: number }> = [{ at: 0, len: 0.14 }, { at: 0.2, len: 0.14 }];

export interface DogPose {
  /** The tail's sweep about the vertical (radians) and how far it is lifted. */
  tailYaw: number;
  tailLift: number;
  headPitch: number;
  headYaw: number;
  headRoll: number;
  /** How far the whole dog is up off the ground (a hop). */
  bob: number;
  /** How far the ears flap (radians, mirrored). */
  earFlop: number;
  /** Breathing: the body's vertical scale. */
  bodyScaleY: number;
  bodyPitch: number;
  /** How far the tail and the head are lowered when it sits (the body is lowered with `bob`); `withSit` sets them, a pose without them is a standing one. */
  tailDrop?: number;
  headDrop?: number;
}

const bump = (age: number, at: number, len: number) => (age >= at && age <= at + len ? Math.sin((Math.PI * (age - at)) / len) : 0);

/** The slow, odd head tilt every seven seconds. */
export function fidget(t: number): number {
  const p = (((t % 7) + 7) % 7) / 7;
  return p >= 0.55 && p <= 0.7 ? Math.sin(((p - 0.55) / 0.15) * Math.PI) * 0.35 : 0;
}

export function dogPose(t: number, cue: string | null, age: number): DogPose {
  const pose: DogPose = {
    tailYaw: 0.35 * Math.sin(t * 3.2), tailLift: 0.2, headPitch: 0.05 * Math.sin(t * 1.3), headYaw: 0.1 * Math.sin(t * 0.8), headRoll: fidget(t),
    bob: 0, earFlop: 0.1 * Math.sin(t * 2.1), bodyScaleY: 1 + 0.015 * Math.sin(t * 2.2), bodyPitch: 0,
  };
  if (cue === "bark" && age >= 0 && age < BARK_S) {
    const e = Math.max(...WOOFS.map((w) => bump(age, w.at, w.len)));
    pose.headPitch += -0.3 * e;
    pose.bob = 0.1 * e;
    pose.bodyPitch = -0.06 * e;
    pose.tailYaw = 0.6 * Math.sin(t * 20);
    pose.tailLift = 0.5;
    pose.earFlop += 0.15 * e;
  } else if (cue === "pet" && age >= 0 && age < PET_REACTION_S) {
    pose.tailYaw = 0.7 * Math.sin(t * 16);
    pose.tailLift = 0.45;
    pose.headPitch = -0.15;
    pose.headRoll = 0.12 * Math.sin(t * 3);
    pose.bob = 0.03 * Math.max(0, Math.sin(t * 9));
    pose.earFlop = 0.2 + 0.1 * Math.sin(t * 5);
  }
  else if (cue === "sit") {                          // sitting waiting for Kip: a slow, lazy wag (the posture itself is `withSit`, eased in and out by the tick)
    pose.tailYaw = 0.3 * Math.sin(t * 2.4);
    pose.headYaw = 0.18 * Math.sin(t * 0.7);
  }
  else if (cue === "run") {                          // running with the ball (or after it): bouncing along, tail up and flying, ears flapping
    pose.bob = 0.05 * Math.abs(Math.sin(t * 13));
    pose.tailYaw = 0.5 * Math.sin(t * 14);
    pose.tailLift = 0.6;
    pose.headPitch = -0.05;
    pose.earFlop = 0.25 * Math.sin(t * 13);
    pose.bodyPitch = -0.04;
  } else if (cue === "happy" && age >= 0 && age < HAPPY_S) {   // delighted: hopping on the spot, tail going round
    pose.bob = 0.06 * Math.abs(Math.sin(t * 11));
    pose.tailYaw = 0.7 * Math.sin(t * 18);
    pose.tailLift = 0.55;
    pose.headPitch = -0.1;
    pose.earFlop = 0.2;
  }
  return pose;
}

interface DogParts { tail: THREE.Group; head: THREE.Group; body: THREE.Group; earL: THREE.Mesh; earR: THREE.Mesh; baseY: number; tailY: number; headY: number }

/** The posture of a sitting dog, `k` of the way there (0 standing, 1 seated): the rump down, the chest and head up, the tail low and trailing. */
export function withSit(p: DogPose, k: number): DogPose {
  const s = Math.max(0, Math.min(1, k));
  if (s === 0) return p;
  return { ...p, bob: p.bob - 0.2 * s, bodyPitch: p.bodyPitch + 0.4 * s, headPitch: p.headPitch + 0.3 * s, tailLift: p.tailLift * (1 - s) + 0.02 * s, tailDrop: 0.28 * s, headDrop: 0.08 * s };
}

export function applyDogPose(parts: DogParts, p: DogPose): void {
  parts.tail.rotation.y = p.tailYaw;
  parts.tail.rotation.z = p.tailLift;
  parts.head.rotation.set(p.headRoll, p.headYaw, p.headPitch);
  parts.body.position.y = parts.baseY + p.bob;
  parts.tail.position.y = parts.tailY - (p.tailDrop ?? 0);
  parts.head.position.y = parts.headY - (p.headDrop ?? 0);
  parts.body.scale.y = p.bodyScaleY;
  parts.body.rotation.z = p.bodyPitch;
  parts.earL.rotation.x = p.earFlop;
  parts.earR.rotation.x = -p.earFlop;
}

export function buildDog(x: number, z: number): THREE.Group {
  const g = new T.Group();
  g.position.set(x, 0, z);
  g.rotation.y = Math.PI;                                              // faces -x
  const fur = plastic("#b07a4a", { roughness: 0.8, clearcoat: 0.05 });
  const dark = plastic("#7a4a2a", { roughness: 0.8, clearcoat: 0.05 });
  const cream = plastic("#f2d8b8", { roughness: 0.8, clearcoat: 0.05 });
  const ink = plastic("#2a1a14", { roughness: 0.4 });
  for (const lx of [-0.42, 0.42]) for (const lz of [-0.22, 0.22]) {
    g.add(M(new T.CylinderGeometry(0.12, 0.13, 0.55, 12), fur, lx, 0.35, lz));
    g.add(M(new T.SphereGeometry(0.15, 12, 8), cream, lx + 0.03, 0.15, lz));          // the paw: its bottom is the floor
  }
  const body = new T.Group();
  body.position.y = 0.78;
  const torso = M(new T.SphereGeometry(0.5, 20, 16), fur, 0, 0, 0); torso.scale.set(1.35, 0.85, 0.75);
  body.add(torso);
  body.add(M(new T.SphereGeometry(0.4, 16, 12), cream, 0.1, -0.1, 0)).scale.set(1.5, 0.7, 0.8);
  g.add(body);
  // The head sits at the front (+x), a little up; ears hang from its sides.
  const head = new T.Group();
  head.position.set(0.78, 1.18, 0);
  head.add(M(new T.SphereGeometry(0.38, 20, 16), fur, 0, 0, 0));
  const snout = M(new T.SphereGeometry(0.22, 14, 10), cream, 0.3, -0.1, 0); snout.scale.set(1.25, 0.85, 0.9);
  head.add(snout);
  head.add(M(new T.SphereGeometry(0.075, 10, 8), ink, 0.54, -0.04, 0));
  for (const ez of [-0.17, 0.17]) head.add(M(new T.SphereGeometry(0.055, 10, 8), ink, 0.28, 0.1, ez));
  const earL = M(new T.SphereGeometry(0.2, 12, 10), dark, -0.02, 0.2, 0.3); earL.scale.set(0.5, 1.1, 0.5);
  const earR = M(new T.SphereGeometry(0.2, 12, 10), dark, -0.02, 0.2, -0.3); earR.scale.set(0.5, 1.1, 0.5);
  head.add(earL, earR);
  g.add(head);
  // The tail: a short capsule on a pivot at the back, wagging about the vertical.
  const tail = new T.Group();
  tail.position.set(-0.68, 0.95, 0);
  const tailMesh = M(new T.CapsuleGeometry(0.06, 0.4, 6, 10), fur, -0.22, 0.12, 0);
  tailMesh.rotation.z = 1.1;
  tail.add(tailMesh);
  g.add(tail);
  const parts: DogParts = { tail, head, body, earL, earR, baseY: 0.78, tailY: 0.95, headY: 1.18 };
  g.userData.dogParts = parts;
  let sit = 0;                                                         // how far seated it is now (0 to 1), eased towards what the cue asks for
  g.userData.tick = (t: number, dt = 1 / 60) => {
    const cue = g.userData.cue as { name: string; at: number } | undefined;
    const want = cue && cue.name === "sit" ? 1 : 0;
    sit += (want - sit) * (1 - Math.exp(-SIT_RATE * Math.max(0, Number.isFinite(dt) ? dt : 0)));
    if (Math.abs(want - sit) < 0.003) sit = want;
    g.userData.sitK = sit;
    applyDogPose(parts, withSit(dogPose(t, cue ? cue.name : null, cue ? t - cue.at : Infinity), sit));
  };
  return g;
}
