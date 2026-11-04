// The toy dog (docs/specs/playful-interactions-spec.md section 6): a chunky clay-toy dog that is alive all the time (it breathes, wags its tail, now and then tilts its head and flaps an ear), woofs and hops when it
// is tapped, and goes wild when it is petted. `dogPose` is the pure part: given the time, which cue it was given (if any) and how long ago, it says how every moving part sits; `buildDog` makes the meshes and a
// `tick` that applies the pose (propReactions.ts calls `holder.userData.tick(t, dt)` each frame and `fx.cue(inst, name)` sets `holder.userData.cue`). The dog faces -x (towards a Kip standing on its left).
// Its four legs are two-bone legs (hip, knee, paw) solved by `solveLeg` so a paw that is on the floor stays where it landed: the tick watches how fast the holder is really moving (the world places the dog, it does
// not tell the dog how fast) and steps the legs in a trot at exactly that pace (`footStep`: a planted paw travels back at the dog's own speed), so it neither skates nor moonwalks, and a dog that is crossing
// the floor sideways to Kip's lane turns its nose the way it is going (`steer`). Everything but the meshes is pure and tested.
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
/**
 * When the hand lands in a pet, in seconds after the dog is told it is being petted: Kip's `pet` clip strokes at 0.7, 1.1, 1.5 and 1.9 s (PET_STROKES_S) and the dog is told at 0.6 s (PET_CUE_S in toyRoomActs.ts).
 * The dog pushes its head up into the hand on each (a test pins these to the two constants).
 */
export const PET_PUSH_AGES: readonly number[] = [0.1, 0.5, 0.9, 1.3];
/** How the head goes to the hand: tilted (radians) and moved (units, towards the side the hand is on) and lowered (units) so the cheek meets it. Measured against where Kip's right hand is (see the pet test). */
export const PET_HEAD_ROLL = 0.18, PET_HEAD_SHIFT = 0.1, PET_HEAD_DROP = 0.1;

// ---- the legs --------------------------------------------------------------------------------------------------------------------------
/** Where the hips are (the body's frame, the dog facing +x), how long each of the two leg bones is, and the paw's radius (its centre is the foot). Standing, a paw's centre is PAW_R off the floor. */
export const HIP_Y = 0.66, HIP_LX = 0.42, HIP_LZ = 0.22, SEG = 0.27, PAW_R = 0.15;
/** How far the dog goes in one full stride (one cycle of all four legs, units), the share of the cycle a paw is on the floor, and how high a paw comes up. A planted paw travels back STEP_LEN (= STRIDE x DUTY) in its stance. */
export const STRIDE = 1.0, DUTY = 0.5, STEP_LIFT = 0.15;
export const STEP_LEN = STRIDE * DUTY;
/**
 * How far the body dips (units) at the ends of a stance, where the planted paw is furthest from under the hip and the leg has to reach: the body is highest at the middle of a stance. With a paw travelling
 * STEP_LEN / 2 either side of the hip, a hip PAW-to-hip height h and leg bones of SEG each, the paw is reachable when sqrt((h - dip)^2 + (STEP_LEN / 2)^2) <= 2 SEG (a test pins it for every frame of a stance).
 */
export const GAIT_DIP = 0.04;
/** Below this speed (units per second) the legs ease back to standing; at and above it they step in full. */
export const STEP_FROM_SPEED = 0.35;
/** How fast the speed the legs follow catches up with the real speed (per second): about a tenth of a second. */
export const SPEED_RATE = 12;
/** When the dog swings round in place its paws shuffle: this many units per second of walking pace for each radian per second it turns. */
export const TURN_STEP = 0.25;
/** A dog cannot be seen running faster than this: one frame of a teleport (a new world) must not spin the legs. */
export const MAX_SPEED = 7;

/** Where a paw is in its stride (`phase` 0 to 1): how far from under its hip (forward is positive) and how far off the floor. Stance first (it goes back at the pace of the ground), then a lifted swing forward. */
export function footStep(phase: number): { dx: number; lift: number } {
  const f = phase - Math.floor(phase);
  if (f < DUTY) return { dx: STEP_LEN / 2 - STEP_LEN * (f / DUTY), lift: 0 };
  const u = (f - DUTY) / (1 - DUTY), e = u * u * (3 - 2 * u);
  return { dx: -STEP_LEN / 2 + STEP_LEN * e, lift: STEP_LIFT * Math.sin(Math.PI * u) };
}
/** The trot: a front leg and the hind leg across from it go together. `front`: a front leg; `left`: the +z side. */
export const legPhase = (front: boolean, left: boolean): number => (front === left ? 0 : 0.5);

/**
 * Two equal bones from a hip to a foot `fx` ahead (forward positive) and `fy` below it: the angle of the upper bone and of the lower one relative to it, both from straight down with forward positive (the
 * `rotation.z` of the two groups). The knee goes `kneeForward` (a hind leg) or back (a front leg's elbow). Out of reach the leg is straight and points at the foot (the paw hangs short: a hop).
 */
export function solveLeg(fx: number, fy: number, kneeForward: boolean, seg = SEG): { upper: number; lower: number; reach: number } {
  const maxR = 2 * seg;
  const d = Math.hypot(fx, fy);
  const dd = Math.max(1e-3, Math.min(d, maxR));
  const base = Math.atan2(fx, fy);
  const alpha = Math.acos(Math.min(1, dd / (2 * seg)));
  const sgn = kneeForward ? 1 : -1;
  const upper = base + sgn * alpha, shin = base - sgn * alpha;
  return { upper, lower: shin - upper, reach: dd };
}

/** The speed the legs step to: the real speed, and a shuffle when it is turning on the spot. */
export const stepSpeed = (speed: number, turnRate: number): number => Math.max(speed, TURN_STEP * Math.abs(turnRate));
/** How much of the stride the legs show: none below the threshold speed, all of it at and above (smooth between: they never snap). */
export function gaitBlend(speed: number): number {
  const k = Math.max(0, Math.min(1, speed / STEP_FROM_SPEED));
  return k * k * (3 - 2 * k);
}

/**
 * What the stride does to the rest of the dog: the body rises over each planted pair (two bounces a stride), rocks a little, the head stays steadier than the body, the ears and tail stream.
 * Inverted pendulum: the body is highest at the middle of a stance (phase 0.25 and 0.75) and dips by up to GAIT_DIP between, where the leg has to reach furthest; it never rises above standing.
 */
export function gaitBody(phase: number, blend: number): { bob: number; pitch: number; head: number; ear: number } {
  const c = Math.cos(4 * Math.PI * (phase - DUTY / 2));
  return { bob: -GAIT_DIP * blend * (0.5 - 0.5 * c), pitch: 0.03 * blend * Math.sin(2 * Math.PI * phase), head: -0.04 * blend * c, ear: 0.18 * blend * Math.sin(4 * Math.PI * phase) };
}

/**
 * Which way the nose points while the dog crosses the floor: `vx` and `vz` are its velocity in the holder's frame (the holder faces +x). Straight ahead is 0; a dog going sideways to a lane (or round
 * a corner) angles towards where it is going, never more than a quarter turn either way, and straightens as it slows.
 */
export function steerFor(vx: number, vz: number, speed: number): number {
  if (speed < STEP_FROM_SPEED) return 0;
  const ang = Math.atan2(-vz, vx);
  return Math.max(-Math.PI / 2, Math.min(Math.PI / 2, ang)) + 0;                   // (+ 0: never -0)
}

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
  /** How far the body and head lean forward towards whoever is stroking it (units along the dog's nose), and how far the eyes are screwed shut (0 open, 1 closed). */
  leanX?: number;
  /** How far the head moves across the dog (its own z, towards a hand on that side). */
  leanZ?: number;
  squint?: number;
  /** The legs: where the stride is (0 to 1), how much of it shows (0 standing, 1 stepping), how seated it is (0 to 1) and how far the whole dog is off the floor (a hop: the paws tuck). Absent: standing. */
  gaitPhase?: number;
  gaitBlend?: number;
  sitK?: number;
  airborne?: number;
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
    const push = Math.max(0, ...PET_PUSH_AGES.map((at) => bump(age, at - 0.18, 0.5)));          // the head rises into the hand on each stroke
    const settle = Math.min(1, age / 0.25);                                                     // and the lean eases in rather than popping
    pose.tailYaw = 0.7 * Math.sin(t * 16);
    pose.tailLift = 0.45;
    pose.headPitch = 0.08 * settle + 0.22 * push;                                               // nose up, into the hand
    pose.headRoll = 0.05 * Math.sin(t * 3) - PET_HEAD_ROLL * (0.5 + 0.5 * push) * settle;        // the cheek goes to the hand
    pose.headYaw = 0.04 * Math.sin(t * 1.7);
    pose.bob = 0.03 * Math.max(0, Math.sin(t * 9));
    pose.earFlop = 0.2 + 0.1 * Math.sin(t * 5);
    pose.leanX = (0.05 + 0.04 * push) * settle;
    pose.leanZ = -PET_HEAD_SHIFT * (0.6 + 0.4 * push) * settle;
    pose.headDrop = (PET_HEAD_DROP - 0.04 * push) * settle;                                    // lowered to meet a hand that is held low, then up into it on each stroke
    pose.bodyPitch = 0.04 * settle + 0.03 * push;                                               // the chest comes up with it
    pose.squint = Math.min(1, settle * 1.2);                                                    // eyes screwed shut with joy
  }
  else if (cue === "sit") {                          // sitting waiting for Kip: a slow, lazy wag (the posture itself is `withSit`, eased in and out by the tick)
    pose.tailYaw = 0.3 * Math.sin(t * 2.4);
    pose.headYaw = 0.18 * Math.sin(t * 0.7);
  }
  else if (cue === "run") {                          // running with the ball (or after it): bouncing along, tail up and flying, ears flapping
    pose.bob = 0;                                    // (the bounce comes with the stride: `withGait`, the legs and the body move together)
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

export interface DogLeg { hip: THREE.Group; upper: THREE.Group; lower: THREE.Group; front: boolean; left: boolean; lx: number; lz: number }
export interface DogParts {
  tail: THREE.Group; head: THREE.Group; body: THREE.Group; earL: THREE.Mesh; earR: THREE.Mesh; baseY: number; tailY: number; headY: number;
  /** The head's and the body's place along the dog's nose when it is standing at ease (a lean moves them from there), the two eyes (they squint) and the four legs. */
  headX?: number; eyes?: THREE.Mesh[]; legs?: DogLeg[];
}

/** The posture of a sitting dog, `k` of the way there (0 standing, 1 seated): the rump down, the chest and head up, the tail low and trailing. */
export function withSit(p: DogPose, k: number): DogPose {
  const s = Math.max(0, Math.min(1, k));
  if (s === 0) return p;
  return { ...p, bob: p.bob - 0.2 * s, bodyPitch: p.bodyPitch + 0.4 * s, headPitch: p.headPitch + 0.3 * s, tailLift: p.tailLift * (1 - s) + 0.02 * s, tailDrop: 0.28 * s, headDrop: (p.headDrop ?? 0) + 0.08 * s, sitK: s };
}

/** The stride laid over a pose: `phase` is where the legs are, `blend` how much of it shows (see `gaitBlend`). A dog that is not stepping (blend 0) is the pose it was given, with the legs standing. */
export function withGait(p: DogPose, phase: number, blend: number): DogPose {
  const b = Math.max(0, Math.min(1, blend));
  if (b === 0) return { ...p, gaitPhase: phase, gaitBlend: 0 };
  const g = gaitBody(phase, b);
  return { ...p, bob: p.bob + g.bob, bodyPitch: p.bodyPitch + g.pitch, headPitch: p.headPitch + g.head, earFlop: p.earFlop + g.ear, gaitPhase: phase, gaitBlend: b };
}

/** Where a hip is in the dog's frame for a body of this height and tilt (the body turns about its own centre, the hips are in it a little below that). */
export function hipPlace(lx: number, bodyY: number, pitch: number): { x: number; y: number } {
  const ox = lx, oy = HIP_Y - 0.78, c = Math.cos(pitch), s = Math.sin(pitch);
  return { x: ox * c - oy * s, y: bodyY + ox * s + oy * c };
}

/**
 * Where a paw's centre goes, in the dog's frame, for one leg: under its own hip when it is standing, stepping along the stride (`footStep`, blended in), the hind paws drawn forward under the haunch when it
 * sits, and lifted when the whole dog is off the floor (a hop tucks its paws). The floor is y = PAW_R for the centre of a paw.
 */
export function footTarget(leg: { front: boolean; left: boolean; lx: number }, p: DogPose): { x: number; y: number } {
  const blend = (p.gaitBlend ?? 0) * (1 - (p.sitK ?? 0));
  const st = footStep((p.gaitPhase ?? 0) + legPhase(leg.front, leg.left));
  const sit = p.sitK ?? 0;
  const x = leg.lx + st.dx * blend + (leg.front ? 0 : 0.3 * sit);
  const y = PAW_R + st.lift * blend + 0.7 * (p.airborne ?? 0);
  return { x, y };
}

/** Write the legs of the pose: each hip follows the body (it bobs, tilts and leans), the paw goes where `footTarget` says, and the two bones are solved to join them. */
export function applyLegs(parts: DogParts, p: DogPose): void {
  if (!parts.legs) return;
  const bodyY = parts.baseY + p.bob, lean = p.leanX ?? 0;
  for (const leg of parts.legs) {
    const h = hipPlace(leg.lx, bodyY, p.bodyPitch), f = footTarget(leg, p);
    const hx = h.x + lean;
    const sol = solveLeg(f.x - hx, h.y - f.y, !leg.front);
    leg.hip.position.set(hx, h.y, leg.lz);
    leg.upper.rotation.z = sol.upper;
    leg.lower.rotation.z = sol.lower;
  }
}

export function applyDogPose(parts: DogParts, p: DogPose): void {
  parts.tail.rotation.y = p.tailYaw;
  parts.tail.rotation.z = p.tailLift;
  parts.head.rotation.set(p.headRoll, p.headYaw, p.headPitch);
  parts.body.position.y = parts.baseY + p.bob;
  parts.body.position.x = p.leanX ?? 0;
  parts.tail.position.y = parts.tailY - (p.tailDrop ?? 0);
  parts.head.position.y = parts.headY - (p.headDrop ?? 0);
  parts.head.position.x = (parts.headX ?? 0.78) + (p.leanX ?? 0) * 1.4;
  parts.head.position.z = p.leanZ ?? 0;
  parts.body.scale.y = p.bodyScaleY;
  parts.body.rotation.z = p.bodyPitch;
  parts.earL.rotation.x = p.earFlop;
  parts.earR.rotation.x = -p.earFlop;
  if (parts.eyes) for (const e of parts.eyes) e.scale.y = 1 - 0.85 * (p.squint ?? 0);
  applyLegs(parts, p);
}

function buildLeg(parent: THREE.Group, front: boolean, left: boolean, fur: THREE.Material, cream: THREE.Material): DogLeg {
  const lx = front ? HIP_LX : -HIP_LX, lz = left ? HIP_LZ : -HIP_LZ;
  const hip = new T.Group();
  hip.position.set(lx, HIP_Y, lz);
  const upper = new T.Group();
  upper.add(M(new T.CylinderGeometry(0.125, 0.11, SEG, 10), fur, 0, -SEG / 2, 0));
  upper.add(M(new T.SphereGeometry(0.115, 10, 8), fur, 0, -SEG, 0));                      // the knee: it hides the joint whatever the bones do
  const lower = new T.Group();
  lower.position.y = -SEG;
  lower.add(M(new T.CylinderGeometry(0.11, 0.1, SEG, 10), fur, 0, -SEG / 2, 0));
  lower.add(M(new T.SphereGeometry(PAW_R, 12, 8), cream, 0, -SEG, 0));                    // the paw: its centre is the foot, its bottom is the floor
  upper.add(lower);
  hip.add(upper);
  parent.add(hip);
  return { hip, upper, lower, front, left, lx, lz };
}

export function buildDog(x: number, z: number): THREE.Group {
  const g = new T.Group();
  g.position.set(x, 0, z);
  g.rotation.y = Math.PI;                                              // faces -x
  const rig = new T.Group();                                           // everything the dog is made of: it turns about the vertical when the dog angles across the floor (`steerFor`)
  g.add(rig);
  const fur = plastic("#b07a4a", { roughness: 0.8, clearcoat: 0.05 });
  const dark = plastic("#7a4a2a", { roughness: 0.8, clearcoat: 0.05 });
  const cream = plastic("#f2d8b8", { roughness: 0.8, clearcoat: 0.05 });
  const ink = plastic("#2a1a14", { roughness: 0.4 });
  const legs: DogLeg[] = [];
  for (const front of [false, true]) for (const left of [false, true]) legs.push(buildLeg(rig, front, left, fur, cream));
  const body = new T.Group();
  body.position.y = 0.78;
  const torso = M(new T.SphereGeometry(0.5, 20, 16), fur, 0, 0, 0); torso.scale.set(1.35, 0.85, 0.75);
  body.add(torso);
  body.add(M(new T.SphereGeometry(0.4, 16, 12), cream, 0.1, -0.1, 0)).scale.set(1.5, 0.7, 0.8);
  rig.add(body);
  // The head sits at the front (+x), a little up; ears hang from its sides.
  const head = new T.Group();
  head.position.set(0.78, 1.18, 0);
  head.add(M(new T.SphereGeometry(0.38, 20, 16), fur, 0, 0, 0));
  const snout = M(new T.SphereGeometry(0.22, 14, 10), cream, 0.3, -0.1, 0); snout.scale.set(1.25, 0.85, 0.9);
  head.add(snout);
  head.add(M(new T.SphereGeometry(0.075, 10, 8), ink, 0.54, -0.04, 0));
  const eyes: THREE.Mesh[] = [];
  for (const ez of [-0.17, 0.17]) { const e = M(new T.SphereGeometry(0.055, 10, 8), ink, 0.28, 0.1, ez); eyes.push(e); head.add(e); }
  const earL = M(new T.SphereGeometry(0.2, 12, 10), dark, -0.02, 0.2, 0.3); earL.scale.set(0.5, 1.1, 0.5);
  const earR = M(new T.SphereGeometry(0.2, 12, 10), dark, -0.02, 0.2, -0.3); earR.scale.set(0.5, 1.1, 0.5);
  head.add(earL, earR);
  rig.add(head);
  // The tail: a short capsule on a pivot at the back, wagging about the vertical.
  const tail = new T.Group();
  tail.position.set(-0.68, 0.95, 0);
  const tailMesh = M(new T.CapsuleGeometry(0.06, 0.4, 6, 10), fur, -0.22, 0.12, 0);
  tailMesh.rotation.z = 1.1;
  tail.add(tailMesh);
  rig.add(tail);
  const parts: DogParts = { tail, head, body, earL, earR, baseY: 0.78, tailY: 0.95, headY: 1.18, headX: 0.78, eyes, legs };
  g.userData.dogParts = parts;
  g.userData.rig = rig;
  g.userData.easeTurn = true;                                          // propReactions swings it round to a new facing (placeProp `ry`) instead of flipping it
  applyDogPose(parts, dogPose(0, null, Infinity));                     // the legs are posed at once: paws on the floor from the first frame
  let sit = 0;                                                         // how far seated it is now (0 to 1), eased towards what the cue asks for
  // What it is doing in the world, as seen from its own holder: where it was and which way it faced at the last tick, how fast it is really going, and where in its stride it is.
  let lastX = Number.NaN, lastZ = Number.NaN, lastRy = Number.NaN;
  let speed = 0, phase = 0, steer = 0;
  g.userData.tick = (t: number, dt = 1 / 60) => {
    const cue = g.userData.cue as { name: string; at: number } | undefined;
    const d = Math.max(0, Number.isFinite(dt) ? dt : 0);
    const want = cue && cue.name === "sit" ? 1 : 0;
    sit += (want - sit) * (1 - Math.exp(-SIT_RATE * d));
    if (Math.abs(want - sit) < 0.003) sit = want;
    g.userData.sitK = sit;
    // How fast it is really going (the world places it, nothing tells it), and how fast it is turning.
    let vx = 0, vz = 0, turn = 0;
    if (d > 0 && Number.isFinite(lastX) && Number.isFinite(lastZ)) {
      const wx = (g.position.x - lastX) / d, wz = (g.position.z - lastZ) / d;
      const c = Math.cos(g.rotation.y), s = Math.sin(g.rotation.y);                                // into the holder's own frame (it faces +x there)
      vx = wx * c - wz * s; vz = wx * s + wz * c;
      const raw = Math.hypot(wx, wz);
      if (raw > MAX_SPEED) { vx *= MAX_SPEED / raw; vz *= MAX_SPEED / raw; }
      if (Number.isFinite(lastRy)) { let dr = (g.rotation.y - lastRy) % (Math.PI * 2); if (dr > Math.PI) dr -= Math.PI * 2; else if (dr < -Math.PI) dr += Math.PI * 2; turn = dr / d; }
    }
    lastX = g.position.x; lastZ = g.position.z; lastRy = g.rotation.y;
    if (d > 0) {
      const raw = Math.min(MAX_SPEED, Math.hypot(vx, vz));
      speed += (raw - speed) * (1 - Math.exp(-SPEED_RATE * d));
      const aim = steerFor(vx, vz, speed);
      steer += (aim - steer) * (1 - Math.exp(-10 * d));
      rig.rotation.y = steer;
    }
    const pace = stepSpeed(speed, turn);
    phase = (phase + (pace / STRIDE) * d) % 1;
    const blend = gaitBlend(pace);
    const base = withSit(dogPose(t, cue ? cue.name : null, cue ? t - cue.at : Infinity), sit);
    const pose = withGait(base, phase, blend);
    pose.airborne = Math.max(0, Math.min(0.3, g.position.y * 0.6));
    g.userData.speed = speed;
    g.userData.phase = phase;
    applyDogPose(parts, pose);
  };
  return g;
}
