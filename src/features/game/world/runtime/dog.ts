// The toy dog (docs/specs/playful-interactions-spec.md section 6): a chunky clay-toy dog that is alive all the time (it breathes, wags its tail, now and then tilts its head and flaps an ear), woofs and hops when it
// is tapped, and goes wild when it is petted. `dogPose` is the pure part: given the time, which cue it was given (if any) and how long ago, it says how every moving part sits; `buildDog` makes the meshes and a
// `tick` that applies the pose (propReactions.ts calls `holder.userData.tick(t, dt)` each frame and `fx.cue(inst, name)` sets `holder.userData.cue`). The dog faces -x (towards a Kip standing on its left).
// Its four legs are two-bone legs (hip, knee, paw) solved by `solveLeg` so a paw that is on the floor stays where it landed: the tick watches how fast the holder is really moving (the world places the dog, it does
// not tell the dog how fast) and steps the legs in a trot at exactly that pace (`footStep`: a planted paw travels back at the dog's own speed), so it neither skates nor moonwalks, and a dog that is crossing
// the floor sideways to Kip's lane turns its nose the way it is going (`steer`). Everything but the meshes is pure and tested.
import { T, M, plastic } from "./worldScene";
import type * as THREE from "three";

export type DogCue = "bark" | "pet" | "run" | "happy" | "sit" | "lie" | "idle";
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

// ---- lying down, looking at Kip, and the small things a dog does when nothing is happening --------------------------------------------------------------
/** How quickly it settles onto its belly and gets up again (the share of the way it covers per second, roughly): slower than sitting, a settle is lazy. */
export const LIE_RATE = 4.5;
/** How far the body comes down when it lies (units): its belly is then on the floor. */
export const LIE_DROP = 0.28;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth01 = (x: number) => { const k = clamp01(x); return k * k * (3 - 2 * k); };

/** The posture of a dog lying on its belly, `k` of the way there: the body down, the chin down (on its paws), the tail low, the ears loose and the eyes half shut. Add it to a pose (it stacks on a sit it is easing out of). */
export function withLie(p: DogPose, k: number): DogPose {
  const s = clamp01(k);
  if (s === 0) return p;
  return {
    ...p, bob: p.bob - LIE_DROP * s, bodyPitch: p.bodyPitch - 0.03 * s, headDrop: (p.headDrop ?? 0) + 0.6 * s, headPitch: p.headPitch - 0.12 * s, headFwd: (p.headFwd ?? 0) + 0.14 * s,
    tailLift: p.tailLift * (1 - s), tailDrop: (p.tailDrop ?? 0) + 0.3 * s, earFlop: p.earFlop + 0.22 * s, squint: Math.max(p.squint ?? 0, 0.4 * s), lieK: s,
  };
}

/** Is the dog's own reaction to a cue over (or was there none), so that it is free to look about, wag at Kip and do its small things? A bark, a pet and a happy hop count until they finish; running never does. */
export function cueIsCalm(name: string | null, age: number): boolean {
  if (name === null || name === "idle" || name === "sit" || name === "lie") return true;
  if (name === "bark") return age >= BARK_S;
  if (name === "pet") return age >= PET_REACTION_S;
  if (name === "happy") return age >= HAPPY_S;
  if (name === "run") return false;
  return true;
}

/** Looking at Kip: within LOOK_RANGE (along the floor) the head turns to him, fully within LOOK_NEAR. Clamped to what a neck does. */
export const LOOK_RANGE = 7, LOOK_NEAR = 2.8, LOOK_YAW_MAX = 0.9, LOOK_PITCH_MAX = 0.45, LOOK_RATE = 5;
/** Where Kip's eyes are (world units off the floor) and where the dog's head is (its own frame), for the upward look. */
export const KIP_EYE_Y = 1.9, DOG_HEAD_Y = 1.18;
/**
 * Where to look and how much the dog cares: `lx` is how far ahead of the dog's nose Kip is, `lz` how far to the side (its own frame, the dog faces +x), `dy` how far above its head his eyes are. `near` is 1
 * when he is close and 0 beyond the range (smooth in between): it drives the look, the ears and the wag. A Kip right behind it is not looked at over the shoulder (the turn tapers to nothing past a bit over
 * a quarter turn, so the head never flips from one side to the other).
 */
export function lookFor(lx: number, lz: number, dy: number): { yaw: number; pitch: number; near: number } {
  const h = Math.hypot(lx, lz);
  const near = 1 - smooth01((h - LOOK_NEAR) / (LOOK_RANGE - LOOK_NEAR));
  const raw = Math.atan2(-lz, lx);
  const taper = 1 - smooth01((Math.abs(raw) - 1.6) / 1.0);
  const yaw = Math.max(-LOOK_YAW_MAX, Math.min(LOOK_YAW_MAX, raw)) * taper;
  const pitch = Math.max(-LOOK_PITCH_MAX, Math.min(LOOK_PITCH_MAX, Math.atan2(dy, Math.max(h, 0.3))));
  return { yaw: yaw + 0, pitch, near };
}
/** How fast the tail goes (radians per second), how wide, how high and how far the ears flare, for a dog that is `near` (0 to 1) Kip: a lazy wag when he is far, a flat-out one when he is close. `base` is its resting wag. */
export const wagFreq = (base: number, near: number): number => base + 6.3 * clamp01(near);
export const wagAmp = (base: number, near: number): number => base + 0.3 * clamp01(near);
export const wagLift = (near: number): number => 0.25 * clamp01(near);
export const wagEar = (near: number): number => 0.14 * clamp01(near);

export type IdleKind = "sniff" | "scratch" | "yawn" | "tilt" | "twitch";
export type Posture = "stand" | "sit" | "lie";
/** How long each small thing takes (seconds), which of them a standing, sitting or lying dog does, and how long it waits between them. */
export const IDLE_LEN: Readonly<Record<IdleKind, number>> = { sniff: 2.4, scratch: 1.9, yawn: 2.1, tilt: 1.6, twitch: 1.0 };
export const IDLE_KINDS: Readonly<Record<Posture, readonly IdleKind[]>> = { stand: ["sniff", "yawn", "tilt"], sit: ["scratch", "yawn", "tilt"], lie: ["yawn", "twitch", "tilt"] };
export const IDLE_GAP_S: readonly [number, number] = [5, 12];
/** A random wait (`r` is 0 to 1) until the next small thing, and which one (`r` again, 0 to 1). */
export const nextIdleDelay = (r: number): number => IDLE_GAP_S[0] + (IDLE_GAP_S[1] - IDLE_GAP_S[0]) * clamp01(r);
export function pickIdle(posture: Posture, r: number): IdleKind {
  const list = IDLE_KINDS[posture];
  return list[Math.min(list.length - 1, Math.floor(clamp01(r) * list.length))]!;
}
/** What a small thing adds to the pose, `age` seconds into it. `env` is how much of it there is (0 to 1): it eases in and out so nothing pops. All zero outside its time. */
export interface IdleBits {
  env: number; headPitch: number; headDrop: number; headYaw: number; headRoll: number; headFwd: number; bodyPitch: number; jaw: number; squint: number; earFlop: number; stretch: number;
  /** The hind leg that scratches: how far it is raised (0 to 1) and where its shake is. */
  scratch: number; scratchPhase: number;
}
export const NO_IDLE: IdleBits = { env: 0, headPitch: 0, headDrop: 0, headYaw: 0, headRoll: 0, headFwd: 0, bodyPitch: 0, jaw: 0, squint: 0, earFlop: 0, stretch: 0, scratch: 0, scratchPhase: 0 };
export function idleBits(kind: IdleKind, age: number): IdleBits {
  const len = IDLE_LEN[kind];
  if (age < 0 || age > len) return NO_IDLE;
  const e = smooth01(age / 0.4) * smooth01((len - age) / 0.4);
  const b: IdleBits = { ...NO_IDLE, env: e };
  switch (kind) {
    case "sniff":                                    // the nose goes down to the floor, forward, and searches about with little pulses
      b.headDrop = 0.52 * e; b.headPitch = -0.55 * e + 0.06 * e * Math.sin(age * 22); b.headFwd = 0.2 * e; b.headYaw = 0.24 * e * Math.sin(age * 8); b.bodyPitch = -0.05 * e; break;
    case "scratch":                                  // sitting: a hind leg comes up and scratches, the head tips, the eyes screw up
      b.scratch = e; b.scratchPhase = age * 17; b.headRoll = 0.24 * e; b.headDrop = 0.05 * e; b.squint = 0.7 * e; break;
    case "yawn":                                     // the head goes back, the jaw drops wide, the eyes shut, the body stretches
      b.headPitch = 0.42 * e; b.jaw = Math.min(1, e * 1.5); b.squint = e; b.stretch = 0.05 * e; b.earFlop = -0.08 * e; b.headDrop = -0.03 * e; break;
    case "tilt":                                     // a curious head tilt, the ears up
      b.headRoll = 0.4 * e; b.headPitch = 0.08 * e; b.earFlop = 0.16 * e; break;
    case "twitch":                                   // a lying dog's ears flick
      b.earFlop = 0.36 * e * Math.sin(age * 30); break;
  }
  return b;
}
export function scaleIdle(b: IdleBits, k: number): IdleBits {
  const o = { ...b };
  for (const key of Object.keys(o) as Array<keyof IdleBits>) if (key !== "scratchPhase") o[key] = b[key] * k;
  return o;
}
/** Lay a small thing over a pose. `side` is the side of the dog (its own z, +1 or -1) the camera sees: the scratching leg is that one, and the head dips towards it. */
export function withIdle(p: DogPose, b: IdleBits, side = 1): DogPose {
  if (b.env === 0) return p;
  return {
    ...p, headPitch: p.headPitch + b.headPitch, headDrop: (p.headDrop ?? 0) + b.headDrop, headYaw: p.headYaw + b.headYaw, headRoll: p.headRoll + b.headRoll * (b.scratch > 0 ? -side : 1), headFwd: (p.headFwd ?? 0) + b.headFwd,
    bodyPitch: p.bodyPitch + b.bodyPitch, jaw: Math.max(p.jaw ?? 0, b.jaw), squint: Math.max(p.squint ?? 0, b.squint), earFlop: p.earFlop + b.earFlop, stretch: (p.stretch ?? 0) + b.stretch,
    scratch: b.scratch, scratchPhase: b.scratchPhase, scratchSide: side,
  };
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
  /** How far it lies on its belly (0 to 1). */
  lieK?: number;
  airborne?: number;
  /** The head forward of where it sits (a sniff, a chin on the paws), how wide the jaw is open (0 to 1), how far the body is stretched along its length, and the scratching hind leg (raised 0 to 1, shake). */
  headFwd?: number;
  jaw?: number;
  stretch?: number;
  scratch?: number;
  scratchPhase?: number;
  /** Which side the scratching leg is on (its own z: +1 left, -1 right): the side the camera sees, so the leg is not hidden behind the body. */
  scratchSide?: number;
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
    pose.jaw = 0.9 * e;                                                                         // the mouth opens on each woof
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
    pose.jaw = (0.14 + 0.1 * Math.sin(t * 9)) * settle;                                         // a happy pant
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
    pose.jaw = 0.25 + 0.12 * Math.sin(t * 16);                                  // panting as it runs
  } else if (cue === "happy" && age >= 0 && age < HAPPY_S) {   // delighted: hopping on the spot, tail going round
    pose.bob = 0.06 * Math.abs(Math.sin(t * 11));
    pose.tailYaw = 0.7 * Math.sin(t * 18);
    pose.tailLift = 0.55;
    pose.headPitch = -0.1;
    pose.earFlop = 0.2;
    pose.jaw = 0.3;
  }
  return pose;
}

export interface DogLeg { hip: THREE.Group; upper: THREE.Group; lower: THREE.Group; front: boolean; left: boolean; lx: number; lz: number }
export interface DogParts {
  tail: THREE.Group; head: THREE.Group; body: THREE.Group; earL: THREE.Mesh; earR: THREE.Mesh; baseY: number; tailY: number; headY: number;
  /** The head's and the body's place along the dog's nose when it is standing at ease (a lean moves them from there), the two eyes (they squint) and the four legs. */
  headX?: number; eyes?: THREE.Mesh[]; legs?: DogLeg[];
  /** The body's own length scale as built (1.5: the group is stretched along the dog, a yawn stretches it a little more). */
  bodyX?: number;
  /** The lower jaw (it hinges down) and the dark of the mouth (it shows as the jaw opens). */
  jaw?: THREE.Group; mouth?: THREE.Mesh;
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
  const sit = p.sitK ?? 0, lie = p.lieK ?? 0;
  const blend = (p.gaitBlend ?? 0) * Math.max(0, 1 - sit - lie);
  const st = footStep((p.gaitPhase ?? 0) + legPhase(leg.front, leg.left));
  // sitting: the hind paws come forward under the haunch; lying: the front paws stretch out ahead and the hind ones tuck in under the belly
  const x = leg.lx + st.dx * blend + (leg.front ? 0.42 * lie : 0.3 * sit + 0.35 * lie);
  const y = PAW_R + st.lift * blend + 0.7 * (p.airborne ?? 0);
  return { x, y };
}

/** Write the legs of the pose: each hip follows the body (it bobs, tilts and leans), the paw goes where `footTarget` says, and the two bones are solved to join them. */
/** How far out to the side the scratching hind leg swings (radians) so the paw is clear of the body. */
export const SCRATCH_SPLAY = 0.6;
export function applyLegs(parts: DogParts, p: DogPose): void {
  if (!parts.legs) return;
  const bodyY = parts.baseY + p.bob, lean = p.leanX ?? 0, sc = p.scratch ?? 0, side = p.scratchSide ?? 1;
  for (const leg of parts.legs) {
    const h = hipPlace(leg.lx, bodyY, p.bodyPitch), f = footTarget(leg, p);
    const hx = h.x + lean;
    let fx = f.x - hx, fy = h.y - f.y;
    const scratching = sc > 0 && !leg.front && leg.left === side > 0;
    if (scratching) {                                // the foot comes up to the neck, in front of and above the hip, and shakes
      const ph = p.scratchPhase ?? 0;
      fx += (0.3 + 0.05 * Math.sin(ph) - fx) * sc;
      fy += (-0.42 + 0.06 * Math.cos(ph * 0.5) - fy) * sc;
    }
    const sol = solveLeg(fx, fy, !leg.front);
    leg.hip.position.set(hx, h.y, leg.lz);
    leg.hip.rotation.x = scratching ? side * SCRATCH_SPLAY * sc : 0;
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
  parts.head.position.x = (parts.headX ?? 0.78) + (p.leanX ?? 0) * 1.4 + (p.headFwd ?? 0);
  parts.head.position.z = p.leanZ ?? 0;
  parts.body.scale.y = p.bodyScaleY;
  parts.body.scale.x = (parts.bodyX ?? 1) * (1 + (p.stretch ?? 0));
  parts.body.rotation.z = p.bodyPitch;
  parts.earL.rotation.x = p.earFlop;
  parts.earR.rotation.x = -p.earFlop;
  if (parts.eyes) for (const e of parts.eyes) e.scale.y = 1 - 0.85 * (p.squint ?? 0);
  if (parts.jaw) parts.jaw.rotation.z = -0.8 * (p.jaw ?? 0);
  if (parts.mouth) { parts.mouth.visible = (p.jaw ?? 0) > 0.02; parts.mouth.scale.y = Math.max(0.001, p.jaw ?? 0); }       // (a flat dark disc under a muzzle that is shut would show from below)
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
  const mouthMat = plastic("#6a2a2a", { roughness: 0.6 });
  const mouth = M(new T.SphereGeometry(0.15, 12, 8), mouthMat, 0.32, -0.28, 0); mouth.scale.set(1.45, 0.001, 0.8);           // the dark of the mouth: flat (hidden) until the jaw opens
  mouth.castShadow = false;
  head.add(mouth);
  const jaw = new T.Group();                                           // the lower jaw hinges at the back of the snout; shut, it sits inside the snout's underside
  jaw.position.set(0.12, -0.2, 0);
  jaw.add(M(new T.SphereGeometry(0.14, 12, 8), cream, 0.19, -0.015, 0)).scale.set(1.5, 0.45, 0.9);
  head.add(jaw);
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
  const parts: DogParts = { tail, head, body, earL, earR, baseY: 0.78, tailY: 0.95, headY: 1.18, headX: 0.78, eyes, legs, jaw, mouth, bodyX: body.scale.x };
  g.userData.dogParts = parts;
  g.userData.rig = rig;
  g.userData.easeTurn = true;                                          // propReactions swings it round to a new facing (placeProp `ry`) instead of flipping it
  applyDogPose(parts, dogPose(0, null, Infinity));                     // the legs are posed at once: paws on the floor from the first frame
  let sit = 0, lie = 0;                                                // how far seated / lying it is now (0 to 1), eased towards what the cue asks for
  // What it is doing in the world, as seen from its own holder: where it was and which way it faced at the last tick, how fast it is really going, and where in its stride it is.
  let lastX = Number.NaN, lastZ = Number.NaN, lastRy = Number.NaN;
  let speed = 0, phase = 0, steer = 0;
  // Its mood: the wag (a phase, so a faster wag never jumps), how much it cares about Kip (0 to 1, eased), and where its head is turned to look at him (eased: it never snaps).
  let wagPhase = 0, nearS = 0, lookYaw = 0, lookPitch = 0;
  // Its small things: which is under way (and when it began), when the next is due, and the one that was cut short fading out. `userData.rng` replaces the randomness (tests).
  let idleKind: IdleKind | null = null, idleAt = 0, idleNext = Number.NaN, idlePosture: Posture = "stand";
  let fadeKind: IdleKind | null = null, fadeAge = 0, fadeW = 0, fadePosture: Posture = "stand";
  const rng = (): number => { const r = g.userData.rng as (() => number) | undefined; return r ? r() : Math.random(); };
  g.userData.tick = (t: number, dt = 1 / 60) => {
    const cue = g.userData.cue as { name: string; at: number } | undefined;
    const d = Math.max(0, Number.isFinite(dt) ? dt : 0);
    const wantSit = cue && cue.name === "sit" ? 1 : 0, wantLie = cue && cue.name === "lie" ? 1 : 0;
    sit += (wantSit - sit) * (1 - Math.exp(-SIT_RATE * d));
    if (Math.abs(wantSit - sit) < 0.003) sit = wantSit;
    lie += (wantLie - lie) * (1 - Math.exp(-LIE_RATE * d));
    if (Math.abs(wantLie - lie) < 0.003) lie = wantLie;
    g.userData.sitK = sit;
    g.userData.lieK = lie;
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
    const cueName = cue ? cue.name : null, age = cue ? t - cue.at : Infinity;
    let pose = dogPose(t, cueName, age);
    const calm = cueIsCalm(cueName, age);

    // Where Kip is (the world writes `userData.kip` every frame): how much it cares and where to look.
    const kip = g.userData.kip as { x: number; z: number } | undefined;
    let nearT = 0, yawT = 0, pitchT = 0;
    if (kip && Number.isFinite(kip.x) && Number.isFinite(kip.z)) {
      const dxw = kip.x - g.position.x, dzw = kip.z - g.position.z;
      const c = Math.cos(g.rotation.y), s = Math.sin(g.rotation.y);
      const L = lookFor(dxw * c - dzw * s, dxw * s + dzw * c, KIP_EYE_Y - (DOG_HEAD_Y + g.position.y));
      nearT = L.near; yawT = L.yaw - steer; pitchT = L.pitch;
    }
    const lookOn = calm && speed < 1.2;
    const kk = 1 - Math.exp(-LOOK_RATE * d);
    nearS += ((calm ? nearT : 0) - nearS) * kk;
    lookYaw += ((lookOn ? yawT * nearT : 0) - lookYaw) * kk;
    lookPitch += ((lookOn ? pitchT * nearT * (1 - 0.4 * lie) : 0) - lookPitch) * kk;
    if (calm) {                                                      // a calm dog wags at Kip the faster the closer he is, with its ears out and its tail up
      const restFreq = sit > 0.5 ? 2.4 : lie > 0.5 ? 1.6 : 3.2, restAmp = sit > 0.5 ? 0.3 : lie > 0.5 ? 0.2 : 0.35;
      wagPhase = (wagPhase + wagFreq(restFreq, nearS) * d) % (Math.PI * 2);
      pose = { ...pose, tailYaw: wagAmp(restAmp, nearS) * Math.sin(wagPhase), tailLift: pose.tailLift + wagLift(nearS), earFlop: pose.earFlop + wagEar(nearS) };
    }

    // Its small things, on a slow random timer: only when it is calm and settled (standing, sitting or lying, not moving, not mid-posture-change). A reaction (pet, bark, run) cuts one short and it fades out.
    const settled = speed < 0.2 && g.position.y < 0.05 && Math.abs(sit - wantSit) < 0.05 && Math.abs(lie - wantLie) < 0.05;
    const idleOk = calm && settled;
    if (Number.isNaN(idleNext)) idleNext = t + nextIdleDelay(rng());
    const forced = g.userData.forceIdle as IdleKind | undefined;     // (a test or a look-at-it script asks for a particular small thing now)
    if (idleKind === null && idleOk && (forced || t >= idleNext)) {
      idlePosture = lie > 0.6 ? "lie" : sit > 0.6 ? "sit" : "stand";
      idleKind = forced && IDLE_LEN[forced] !== undefined ? forced : pickIdle(idlePosture, rng());
      idleAt = t;
      delete g.userData.forceIdle;
    }
    if (idleKind !== null) {
      const a = t - idleAt;
      if (!idleOk || a >= IDLE_LEN[idleKind]) {
        if (!idleOk && a < IDLE_LEN[idleKind]) { fadeKind = idleKind; fadeAge = a; fadeW = 1; fadePosture = idlePosture; }
        idleKind = null;
        idleNext = t + nextIdleDelay(rng());
      }
    }
    if (fadeKind !== null) { fadeW = Math.max(0, fadeW - 5 * d); if (fadeW === 0) fadeKind = null; }
    let bits = NO_IDLE;
    if (idleKind !== null) bits = idleBits(idleKind, t - idleAt);
    else if (fadeKind !== null) bits = scaleIdle(idleBits(fadeKind, fadeAge), fadeW);
    g.userData.idle = idleKind;
    void fadePosture;

    pose = { ...pose, headYaw: pose.headYaw + lookYaw * (1 - bits.env), headPitch: pose.headPitch + lookPitch * (1 - bits.env) };
    pose = withIdle(withLie(withSit(pose, sit), lie), bits, Math.cos(g.rotation.y) < 0 ? -1 : 1);       // (the camera is on the world's +z side: facing -x it sees the dog's right, facing +x its left)
    pose = withGait(pose, phase, blend);
    pose.airborne = Math.max(0, Math.min(0.3, g.position.y * 0.6));
    g.userData.speed = speed;
    g.userData.phase = phase;
    applyDogPose(parts, pose);
  };
  return g;
}
