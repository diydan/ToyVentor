// The dog's legs and its lane (Dan, 2026-11-04: "dog animation needs improvement and patting dog is not aligned, dog is not on same path or aligned with Kip"):
// the two-bone legs and the trot that keeps a planted paw where it landed, the nose turning the way the dog goes, the depth a dog walks to (Kip's lane), the pet that
// leans into the hand, and the follow / fetch / pet logic that keeps the dog beside Kip, not a room behind him.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DUTY, GAIT_DIP, HIP_LX, HIP_Y, MAX_SPEED, PAW_R, PET_PUSH_AGES, SEG, STEP_FROM_SPEED, STEP_LEN, STEP_LIFT, STRIDE, TURN_STEP,
  IDLE_GAP_S, IDLE_KINDS, IDLE_LEN, KIP_EYE_Y, LIE_DROP, LOOK_NEAR, LOOK_PITCH_MAX, LOOK_RANGE, LOOK_YAW_MAX, NO_IDLE, SCRATCH_SPLAY,
  applyDogPose, buildDog, cueIsCalm, dogPose, footStep, footTarget, gaitBlend, gaitBody, hipPlace, idleBits, legPhase, lookFor, nextIdleDelay, pickIdle, scaleIdle, solveLeg, steerFor, stepSpeed,
  wagAmp, wagEar, wagFreq, wagLift, withGait, withIdle, withLie, withSit,
} from "../src/features/game/world/runtime/dog";
import type { IdleKind, Posture } from "../src/features/game/world/runtime/dog";
import type { DogLeg } from "../src/features/game/world/runtime/dog";
import { LIE_AFTER_S, SIT_AFTER_S, createFollow } from "../src/features/game/world/runtime/dogFollow";
import { createFetch, LANE_ARRIVE, MOUTH } from "../src/features/game/world/runtime/dogFetch";
import { PET_CUE_S, PET_S, PET_STAND, PET_STEP_IN } from "../src/features/game/world/runtime/toyRoomActs";
import { PET_STROKES_S } from "../src/features/game/world/runtime/proceduralClips";
import { TURN_SPEED, WALK_SPEED, Z_EASE_SPEED, createPropFx, turnDelta } from "../src/features/game/world/runtime/propReactions";
import { PROP_LANG_KEY } from "../src/lib/propSpeech";
import { resetVoiceBackoff } from "../src/lib/propVoice";

beforeEach(() => {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, String(v)), removeItem: (k: string) => void map.delete(k), clear: () => map.clear(), key: () => null, length: 0 });
  localStorage.setItem(PROP_LANG_KEY, "en");
  resetVoiceBackoff();
});

const near = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThanOrEqual(eps);

describe("footStep: a planted paw goes back at the pace of the ground", () => {
  it("is continuous round the whole cycle (the stance and swing meet, the paw never jumps)", () => {
    near(footStep(0).dx, STEP_LEN / 2);
    near(footStep(DUTY - 1e-9).dx, -STEP_LEN / 2, 1e-6);
    near(footStep(DUTY).dx, -STEP_LEN / 2);
    near(footStep(1 - 1e-9).dx, STEP_LEN / 2, 1e-6);
    near(footStep(0.3 + 1).dx, footStep(0.3).dx);
    for (const p of [0, DUTY - 1e-9, DUTY, 1 - 1e-9]) near(footStep(p).lift, 0, 1e-6);
  });
  it("in the stance it slides back STRIDE per unit of phase: with the phase advancing at speed / STRIDE the paw stays where it landed (no skating)", () => {
    const v = 3.7;
    let worldAtStart = Number.NaN;
    for (let t = 0; t < (DUTY * STRIDE) / v - 1e-9; t += 1 / 240) {
      const phase = (v * t) / STRIDE;
      const planted = v * t + footStep(phase).dx;                            // the dog moves forward at v (the hip is at v t) and the paw is dx ahead of the hip
      if (Number.isNaN(worldAtStart)) worldAtStart = planted;
      near(planted, worldAtStart, 1e-9);
      expect(footStep(phase).lift).toBe(0);
    }
  });
  it("in the swing it lifts the paw to STEP_LIFT at the middle and carries it forward the whole step", () => {
    const mid = footStep(DUTY + (1 - DUTY) / 2);
    near(mid.lift, STEP_LIFT, 1e-9);
    near(mid.dx, 0, 1e-9);
    let prev = -Infinity;
    for (let f = DUTY; f <= 1; f += 0.01) { const x = footStep(f).dx; expect(x).toBeGreaterThanOrEqual(prev - 1e-9); prev = x; }
  });
  it("the legs trot: a front leg and the hind leg across from it go together, the other pair half a cycle later", () => {
    expect(legPhase(true, true)).toBe(legPhase(false, false));
    expect(legPhase(true, false)).toBe(legPhase(false, true));
    near(Math.abs(legPhase(true, true) - legPhase(true, false)), 0.5);
  });
});

describe("solveLeg: two bones from a hip to a paw", () => {
  const foot = (fx: number, fy: number, fwd: boolean) => {
    const s = solveLeg(fx, fy, fwd);
    const ua = s.upper, la = s.upper + s.lower;                                        // absolute angles from straight down, forward positive
    const kx = SEG * Math.sin(ua), ky = SEG * Math.cos(ua);
    return { x: kx + SEG * Math.sin(la), y: ky + SEG * Math.cos(la), kneeX: kx, s };
  };
  it("puts the paw exactly where it was asked, anywhere in reach, for both knee directions", () => {
    for (const fwd of [true, false]) for (let fx = -0.3; fx <= 0.3; fx += 0.1) for (let fy = 0.3; fy <= 0.5; fy += 0.05) {
      if (Math.hypot(fx, fy) > 2 * SEG) continue;                                       // (out of reach is the next test)
      const r = foot(fx, fy, fwd);
      near(r.x, fx, 1e-9); near(r.y, fy, 1e-9);
    }
  });
  it("a hind leg's knee goes forward of the hip-to-paw line and a front leg's elbow goes back", () => {
    expect(foot(0, 0.45, true).kneeX).toBeGreaterThan(0.01);
    expect(foot(0, 0.45, false).kneeX).toBeLessThan(-0.01);
  });
  it("out of reach the leg is straight and points at the paw (it hangs short: a hop)", () => {
    const s = solveLeg(0.1, 0.9, true);
    near(s.lower, 0, 1e-6);
    near(s.upper, Math.atan2(0.1, 0.9), 1e-6);
    expect(s.reach).toBeLessThanOrEqual(2 * SEG);
  });
  it("standing, the paw's centre is PAW_R off the floor and the leg is nearly straight (reach is close to the full leg)", () => {
    const d = HIP_Y - PAW_R;
    expect(d).toBeLessThanOrEqual(2 * SEG);
    expect(d / (2 * SEG)).toBeGreaterThan(0.9);
  });
});

describe("the gait", () => {
  it("shows none of the stride when the dog is still and all of it from STEP_FROM_SPEED up, smoothly between", () => {
    expect(gaitBlend(0)).toBe(0);
    expect(gaitBlend(STEP_FROM_SPEED)).toBe(1);
    expect(gaitBlend(9)).toBe(1);
    let prev = 0;
    for (let v = 0; v <= STEP_FROM_SPEED; v += 0.01) { const b = gaitBlend(v); expect(b).toBeGreaterThanOrEqual(prev - 1e-12); prev = b; }
  });
  it("a dog turning on the spot shuffles its paws; one going somewhere steps to its real speed", () => {
    near(stepSpeed(0, 9), 9 * TURN_STEP);
    expect(stepSpeed(0, 9)).toBeGreaterThan(STEP_FROM_SPEED);
    near(stepSpeed(4, 1), 4);
    near(stepSpeed(4, -20), 20 * TURN_STEP);
  });
  it("the body is at its highest (legs straight) at the middle of a stance and dips between: it never rises above standing", () => {
    near(gaitBody(DUTY / 2, 1).bob, 0, 1e-9);
    near(gaitBody(0.5 + DUTY / 2, 1).bob, 0, 1e-9);
    for (let f = 0; f < 1; f += 0.01) { const b = gaitBody(f, 1).bob; expect(b).toBeLessThanOrEqual(1e-12); expect(b).toBeGreaterThanOrEqual(-GAIT_DIP - 1e-9); }
    expect(gaitBody(0.3, 0).bob).toBeCloseTo(0, 12);
  });
  it("withGait leaves a still dog's pose alone and adds the body's motion to a stepping one", () => {
    const p = dogPose(2, null, Infinity);
    expect(withGait(p, 0.7, 0).bob).toBe(p.bob);
    expect(withGait(p, 0.7, 0).gaitBlend).toBe(0);
    const q = withGait(p, 0.0, 1);
    expect(q.bob).toBeLessThan(p.bob);
    expect(q.gaitBlend).toBe(1);
  });
  it("the nose turns the way the dog goes: straight when it goes ahead, a quarter turn at most, none when it is slow", () => {
    expect(steerFor(3, 0, 3)).toBe(0);
    near(steerFor(3, -3, 4.2), Math.PI / 4, 1e-9);
    near(steerFor(0, -3, 3), Math.PI / 2, 1e-9);
    near(steerFor(0, 3, 3), -Math.PI / 2, 1e-9);
    near(steerFor(-3, -3, 4), Math.PI / 2, 1e-9);                                       // backwards is clamped, never more than a quarter turn
    expect(steerFor(3, -3, STEP_FROM_SPEED / 2)).toBe(0);
  });
});

describe("footTarget and the hips on a built dog", () => {
  const stand = dogPose(0, null, Infinity);
  const leg = { front: true, left: true, lx: HIP_LX };
  it("standing: every paw is under its hip with its centre PAW_R off the floor", () => {
    for (const l of [leg, { front: false, left: false, lx: -HIP_LX }]) {
      const t = footTarget(l, stand);
      near(t.x, l.lx); near(t.y, PAW_R);
    }
  });
  it("sitting: the hind paws come forward under the haunch and the front paws stay put", () => {
    const sat = withSit(stand, 1);
    near(footTarget({ front: false, left: true, lx: -HIP_LX }, sat).x, -HIP_LX + 0.3);
    near(footTarget(leg, sat).x, HIP_LX);
  });
  it("a hop tucks the paws up", () => {
    const up = footTarget(leg, { ...stand, airborne: 0.3 });
    near(up.y, PAW_R + 0.21);
  });
  it("the hips follow the body: the body tilting up at the front lifts the front hips and drops the rear ones", () => {
    const flat = hipPlace(HIP_LX, 0.78, 0), tilt = hipPlace(HIP_LX, 0.78, 0.4), rear = hipPlace(-HIP_LX, 0.78, 0.4);
    near(flat.y, HIP_Y);
    expect(tilt.y).toBeGreaterThan(flat.y);
    expect(rear.y).toBeLessThan(flat.y);
  });

  const pawsOf = (d: THREE.Group): THREE.Vector3[] => (d.userData.dogParts.legs as DogLeg[]).map((l) => { l.lower.updateWorldMatrix(true, false); return l.lower.localToWorld(new THREE.Vector3(0, -SEG, 0)); });

  it("a standing dog has all four paws on the floor from the first frame", () => {
    const d = buildDog(10, 0);
    d.updateMatrixWorld(true);
    for (const p of pawsOf(d)) near(p.y, PAW_R, 1e-6);
    near(new THREE.Box3().setFromObject(d, true).min.y, 0, 0.01);
  });

  /**
   * Run a dog along its nose (-x in the world: it faces -x) at `v` for `seconds` at 60 fps. Every frame of every paw's stance counts (not only the ones where the paw happens to be down): the paw must reach the
   * floor (centre PAW_R up, within 2 mm) and must not move along it more than a few mm from where it landed. Also: the most the body dips and how many stance frames there were.
   */
  function slide(v: number, seconds: number, opts: { dz?: number } = {}) {
    const d = buildDog(40, 0);
    const legs = d.userData.dogParts.legs as DogLeg[];
    let t = 0;
    const heights: number[][] = legs.map(() => []);
    const worst = legs.map(() => 0), floatMax = legs.map(() => 0);
    const landed = legs.map(() => Number.NaN);
    let stanceFrames = 0;
    const dt = 1 / 60;
    for (let k = 0; k < seconds * 60; k++) {
      t += dt;
      d.userData.tick(t, dt);
      const ph = d.userData.phase as number;
      d.position.x -= v * dt;                                                         // the world moves the holder after the tick, as propReactions does
      if (opts.dz) d.position.z += opts.dz * dt;
      d.updateMatrixWorld(true);
      if (t < 0.7) continue;                                                           // the speed the legs follow has caught up with the real one
      pawsOf(d).forEach((p, i) => {
        const leg = legs[i]!;
        const f = (((ph + legPhase(leg.front, leg.left)) % 1) + 1) % 1;
        heights[i]!.push(p.y);
        if (f < DUTY - 0.02) {                                                         // the paw is meant to be on the floor (a hair inside its stance, the frame it lifts is the swing's)
          stanceFrames++;
          floatMax[i] = Math.max(floatMax[i]!, Math.abs(p.y - PAW_R));
          if (Number.isNaN(landed[i]!) || f < 0.03) landed[i] = p.x;
          worst[i] = Math.max(worst[i]!, Math.abs(p.x - landed[i]!));
        } else landed[i] = Number.NaN;
      });
    }
    return { worst, floatMax, runs: heights, stanceFrames, d };
  }

  it("trotting at the follow pace every paw reaches the floor for the whole of its stance and does not skate: a few millimetres at most", () => {
    const { worst, floatMax, runs, stanceFrames } = slide(4.2, 3);
    expect(stanceFrames).toBeGreaterThan(200);
    for (const w of worst) expect(w).toBeLessThan(0.005);
    for (const f of floatMax) expect(f).toBeLessThan(0.002);
    for (const r of runs) expect(Math.max(...r)).toBeGreaterThan(PAW_R + STEP_LIFT * 0.6);          // and the paws really do lift
  });
  it("the same at a slow walk, at a jog and at the fetch run", () => {
    for (const v of [1.3, 2.5, 3.4, 4.4]) { const r = slide(v, 3); for (const w of r.worst) expect(w, `slide v=${v}`).toBeLessThan(0.005); for (const f of r.floatMax) expect(f, `float v=${v}`).toBeLessThan(0.002); }
  });
  it("a dog standing still does not step at all", () => {
    const { runs } = slide(0, 2);
    for (const r of runs) expect(Math.max(...r) - Math.min(...r)).toBeLessThan(1e-6);
  });
  it("it measures its own speed from where the world puts it, and turns its nose when it crosses the floor sideways", () => {
    const { d } = slide(0, 1.5, { dz: 3.2 });                                          // Z_EASE_SPEED: onto Kip's lane
    expect(d.userData.speed).toBeGreaterThan(2.8);
    expect(Math.abs((d.userData.rig as THREE.Group).rotation.y)).toBeGreaterThan(1);
  });
  it("one frame of a teleport (a new world) cannot spin the legs: the speed is capped", () => {
    const d = buildDog(0, 0);
    d.userData.tick(0, 1 / 60);
    d.position.x = 5000;
    d.userData.tick(1 / 60, 1 / 60);
    expect(d.userData.speed).toBeLessThanOrEqual(MAX_SPEED);
  });
  it("a hop (the holder lifted) tucks the paws and sitting folds the hind legs, with the paws still on the floor", () => {
    const d = buildDog(0, 0);
    d.userData.cue = { name: "sit", at: 0 };
    let t = 0;
    for (let k = 0; k < 120; k++) { t += 1 / 60; d.userData.tick(t, 1 / 60); }
    d.updateMatrixWorld(true);
    for (const p of pawsOf(d)) near(p.y, PAW_R, 0.005);
    const parts = d.userData.dogParts;
    const hind = (parts.legs as DogLeg[]).filter((l) => !l.front);
    for (const l of hind) expect(Math.abs(l.lower.rotation.z)).toBeGreaterThan(0.8);   // folded
    d.userData.cue = { name: "idle", at: t };
    for (let k = 0; k < 120; k++) { t += 1 / 60; d.userData.tick(t, 1 / 60); }
    d.position.y = 0.45;
    d.userData.tick(t + 1 / 60, 1 / 60);
    d.updateMatrixWorld(true);
    for (const p of pawsOf(d)) expect(p.y - d.position.y).toBeGreaterThan(PAW_R + 0.15);        // relative to the holder, the paws are drawn up
  });
});

describe("being petted: the dog leans into the hand", () => {
  it("pushes up into the hand on each of Kip's strokes (the stroke times are the pet clip's, less the moment before the dog is told)", () => {
    expect(PET_PUSH_AGES.length).toBe(PET_STROKES_S.length);
    PET_PUSH_AGES.forEach((a, i) => near(a, PET_STROKES_S[i]! - PET_CUE_S, 1e-9));
  });
  it("the head is highest (nose up) at a stroke and lower between two", () => {
    const at = (age: number) => dogPose(3, "pet", age).headPitch;
    const stroke = at(PET_PUSH_AGES[1]!), between = at((PET_PUSH_AGES[1]! + PET_PUSH_AGES[2]!) / 2 + 0.04);
    expect(stroke).toBeGreaterThan(between);
    expect(stroke).toBeGreaterThan(0.2);
  });
  it("it leans towards Kip (forward and across to the hand's side), tilts its cheek into the hand and screws its eyes shut; none of it pops in at the first instant", () => {
    const p0 = dogPose(3, "pet", 0), p1 = dogPose(3, "pet", 1);
    expect(p0.leanX).toBe(0);
    expect(p1.leanX!).toBeGreaterThan(0.05);
    expect(p1.leanZ!).toBeLessThan(-0.05);
    expect(p1.headRoll).toBeLessThan(-0.05);
    expect(p0.squint).toBe(0);
    expect(p1.squint).toBe(1);
  });
  it("on the built dog the head goes forward and across and the eyes narrow; a plain dog's do not", () => {
    const d = buildDog(0, 0), parts = d.userData.dogParts;
    applyDogPose(parts, dogPose(3, null, Infinity));
    expect(parts.head.position.z).toBe(0);
    expect(parts.eyes[0].scale.y).toBe(1);
    applyDogPose(parts, dogPose(3, "pet", 1));
    expect(parts.head.position.x).toBeGreaterThan(0.78);
    expect(parts.head.position.z).toBeLessThan(-0.05);
    expect(parts.eyes[0].scale.y).toBeLessThan(0.2);
  });
  it("sitting while petted keeps the pet's lowered head (the sit adds to it, it does not replace it)", () => {
    const p = dogPose(3, "pet", 1);
    expect(withSit(p, 1).headDrop).toBeCloseTo((p.headDrop ?? 0) + 0.08, 9);
  });
});

describe("a prop that walks in depth and turns on the spot", () => {
  function room() {
    const root = new THREE.Group();
    const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 400 }) } as unknown as HTMLElement;
    const fx = createPropFx({ root: () => root, camera: () => new THREE.PerspectiveCamera(), canvas, toast: () => {}, boostWindmill: () => {}, reduced: () => false, canSpeak: () => false });
    const dog = buildDog(20, -2.8);
    root.add(dog);
    const inst = fx.register("dog", [dog])!;
    return { fx, inst, dog };
  }
  const run = (fx: { update(dt: number, t: number): void }, seconds: number, t0 = 0) => { let t = t0; for (let k = 0; k < seconds * 60; k++) { t += 1 / 60; fx.update(1 / 60, t); } return t; };

  it("`z` walks it to that depth at Z_EASE_SPEED, in a straight steady line, and stops exactly there", () => {
    const { fx, inst, dog } = room();
    fx.placeProp(inst, 20, { z: 0.4 });
    run(fx, 0.5);
    near(dog.position.z, -2.8 + Z_EASE_SPEED * 0.5, 0.06);
    run(fx, 1, 0.5);
    near(dog.position.z, 0.4, 1e-9);
    near(inst.base.pz, 0.4, 1e-9);
  });
  it("`zSnap` puts it there at once (the ball in its mouth keeps exactly its depth)", () => {
    const { fx, inst, dog } = room();
    fx.placeProp(inst, 20, { z: 0.4, zSnap: true });
    run(fx, 1 / 30);
    near(dog.position.z, 0.4, 1e-9);
  });
  it("a dog swings round the short way at TURN_SPEED instead of flipping, and ends facing exactly the way it was told", () => {
    const { fx, inst, dog } = room();
    const t = run(fx, 0.1);
    fx.placeProp(inst, 20, { ry: 0 });
    run(fx, 0.1, t);
    expect(dog.rotation.y).toBeLessThan(Math.PI - 0.5);
    expect(dog.rotation.y).toBeGreaterThan(0.5);                                       // part of the way round, not there yet
    run(fx, 0.5, t + 0.1);
    near(dog.rotation.y, 0, 1e-9);
    expect(Math.PI / TURN_SPEED).toBeLessThan(0.4);                                    // a half turn takes about a third of a second
  });
  it("turnDelta takes the short way round", () => {
    near(Math.abs(turnDelta(0, Math.PI)), Math.PI);                                    // a half turn: either way is the short way
    near(Math.abs(turnDelta(0.1, Math.PI * 2 - 0.1)), 0.2, 1e-9);
    near(turnDelta(-0.2, 0.2), -0.4, 1e-9);
  });
});

describe("the follow keeps the dog on Kip's lane once they have met", () => {
  function follow(withLane = true) {
    const s = { dog: 20, toy: 2, z: 0.6, still: true };
    const lanes: number[] = [];
    const f = createFollow({
      dogX: () => s.dog, toyX: () => s.toy, toyStill: () => s.still, clearance: () => Infinity, moveDog: (x) => { s.dog = x; }, cue: () => {}, allowed: () => true,
      ...(withLane ? { toyZ: () => s.z, laneTo: (z: number) => { lanes.push(z); } } : {}),
    });
    return { s, f, lanes };
  }
  it("before they meet it stays where it is; after, every frame it is told Kip's depth", () => {
    const w = follow();
    for (let k = 0; k < 60; k++) w.f.update(1 / 60);
    expect(w.lanes).toEqual([]);
    w.s.toy = 19;                                                                      // Kip comes up to it
    w.f.update(1 / 60);
    w.f.update(1 / 60);
    expect(w.lanes.length).toBeGreaterThan(0);
    expect(new Set(w.lanes)).toEqual(new Set([0.6]));
    w.s.z = -0.9;
    w.f.update(1 / 60);
    expect(w.lanes.at(-1)).toBe(-0.9);
  });
  it("a world with no depth (the old adapter) works as before", () => {
    const w = follow(false);
    w.s.toy = 19;
    for (let k = 0; k < 600; k++) w.f.update(1 / 60);
    expect(w.f.phase).toBe("sitting");
  });
});

describe("the fetch picks the ball up where it lies and brings it to Kip's lane", () => {
  function fetch() {
    const s = { dog: 38, dogZ: 0.3, ball: 30, ballZ: -2.8, toy: 20, toyZ: 0.3, resting: true, lane: 0.3 };
    const log: string[] = [];
    const carried: Array<{ x: number; z: number | undefined }> = [];
    const f = createFetch({
      dogX: () => s.dog, ballX: () => s.ball, ballResting: () => s.resting, toyX: () => s.toy,
      moveDog: (x) => { s.dog = x; },
      moveBall: (x, l, z) => { s.ball = x; if (l > 0) carried.push({ x, z }); else log.push("ballDown"); },
      dropBall: () => { log.push("drop"); }, cue: () => {}, woof: () => { log.push("woof"); },
      dogZ: () => s.dogZ, ballZ: () => s.ballZ, toyZ: () => s.toyZ,
      laneTo: (z) => { s.lane = z; },
    });
    /** One frame: the dog walks its depth at 3.2 u/s towards the lane it was last told. */
    const step = (dt = 1 / 60) => { f.update(dt); const d = s.lane - s.dogZ; s.dogZ += Math.sign(d) * Math.min(Math.abs(d), 3.2 * dt); };
    return { s, f, step, carried, log };
  }
  it("runs to the ball's depth first, only picks it up once it is there, then walks to Kip's depth and only drops it there", () => {
    const w = fetch();
    w.f.start();
    let chasingFrames = 0, returningFrames = 0;
    for (let k = 0; k < 6 * 60 && w.f.phase !== "idle"; k++) {
      const zBefore = w.s.dogZ;
      w.step();
      if (w.f.phase === "chasing" && ++chasingFrames > 1) expect(w.s.lane).toBe(-2.8);          // (the frame it sets off it has not yet been told)
      if (w.f.phase === "returning" && ++returningFrames > 1) { expect(w.s.lane).toBe(0.3); expect(w.carried.at(-1)!.z).toBeCloseTo(zBefore, 9); }                      // the ball in its mouth is at exactly the dog's depth
    }
    expect(chasingFrames).toBeGreaterThan(10);
    expect(returningFrames).toBeGreaterThan(10);
    expect(w.carried.length).toBeGreaterThan(5);
    const firstCarry = w.carried[0]!;
    expect(Math.abs(firstCarry.z! - w.s.ballZ)).toBeLessThanOrEqual(LANE_ARRIVE + 1e-9);        // picked up in the ball's lane
    expect(w.log).toContain("drop");
    expect(Math.abs(w.s.dogZ - w.s.toyZ)).toBeLessThanOrEqual(LANE_ARRIVE + 1e-9);            // dropped in Kip's
    expect(Math.abs(w.s.dog - w.s.toy)).toBeLessThan(2.1);
    void MOUTH;
  });
});

describe("petting: the dog steps onto Kip's lane while he walks over", () => {
  it("the stand is beside the dog's head, in profile (Kip faces +x at x - PET_STAND, the dog faces -x), and the pet needs the dog on Kip's depth, which `tap` arranges", async () => {
    const { createActs } = await import("../src/features/game/world/runtime/toyRoomActs");
    const placed: Array<{ x: number; z: number | undefined }> = [];
    const root = new THREE.Group();
    const s = { pos: { x: 38, y: 0, z: 0.7 }, target: null as number | null };
    const dog = { type: "dog", base: { px: 42.2, pz: -2.8 }, size: new THREE.Vector3(2.5, 1.6, 0.8) } as never;
    const w = {
      position: () => ({ ...s.pos }), targetX: () => s.target, walkTo: (x: number) => { s.target = x; }, stopWalk: () => { s.target = null; }, face: () => {},
      root: () => root, eater: () => "character", allowed: () => true, clip: () => true, setPosition: () => {}, tone: () => {}, phase: () => {}, hold: () => {}, release: () => {},
      mouth: () => ({ x: 0, y: 0, z: 0 }), bubbles: { blow: () => {} },
      fx: { squish: () => {}, strike: () => null, kickBall: () => true, flutter: () => {}, say: () => {}, setVisible: () => {}, cue: () => {}, nearby: () => [], placeProp: (_i: unknown, x: number, o?: { z?: number }) => { placed.push({ x, z: o?.z }); } },
    };
    const acts = createActs(w as never);
    expect(acts.tap(dog)).toBe(true);
    expect(placed).toEqual([{ x: 42.2, z: 0.7 }]);                                        // the dog walks to Kip's depth, where it already is along the floor
    expect(PET_STAND).toBeGreaterThan(1.2);
    expect(PET_STAND).toBeLessThan(2.3);
  });
  it("another act does not move the dog", async () => {
    const { createActs } = await import("../src/features/game/world/runtime/toyRoomActs");
    const placed: unknown[] = [];
    const root = new THREE.Group();
    const w = {
      position: () => ({ x: 10, y: 0, z: 0.2 }), targetX: () => null, walkTo: () => {}, stopWalk: () => {}, face: () => {}, root: () => root, eater: () => "character", allowed: () => true,
      clip: () => true, setPosition: () => {}, tone: () => {}, phase: () => {}, hold: () => {}, release: () => {}, mouth: () => ({ x: 0, y: 0, z: 0 }), bubbles: { blow: () => {} },
      fx: { squish: () => {}, strike: () => null, kickBall: () => true, flutter: () => {}, say: () => {}, setVisible: () => {}, cue: () => {}, nearby: () => [], placeProp: () => { placed.push(1); } },
    };
    const acts = createActs(w as never);
    acts.tap({ type: "teddy", base: { px: 14, pz: -2.8 }, size: new THREE.Vector3(1, 1, 1) } as never);
    expect(placed).toEqual([]);
  });
});

describe("the world wires the dog's depth", () => {
  const world = readFileSync(join(__dirname, "../src/features/game/world/runtime/world.ts"), "utf8");
  it("the follow and the fetch both tell the dog to walk to a depth (Kip's, or the ball's), and the carried ball keeps the dog's depth exactly", () => {
    expect(world).toContain("function dogLaneTo(z: number){var d=theDog();if(d)PFX.placeProp(d,null,{z:z})}");                  // (null: only the depth, it must not cancel a shuffle in x)
    expect(world).toMatch(/var FOLLOW=createFollow\(\{[\s\S]*?toyZ:function\(\)\{return P\.pos\.z\},laneTo:dogLaneTo\}\);/);
    expect(world).toMatch(/var DOGF=createFetch\(\{[\s\S]*?dogZ:function\(\)\{var d=theDog\(\);return d\?d\.base\.pz:0\},ballZ:[\s\S]*?toyZ:function\(\)\{return P\.pos\.z\},laneTo:dogLaneTo\}\);/);
    expect(world).toContain("moveBall:function(x: number,l: number,z?: number){if(fetchBall)PFX.placeProp(fetchBall,x,z===undefined?{lift:l}:{lift:l,z:z,zSnap:true})}");
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 2026-11-04, round two: lying down, looking at Kip, small things on a timer, the step in after a pet.

const pawsWorld = (d: THREE.Group): THREE.Vector3[] => (d.userData.dogParts.legs as DogLeg[]).map((l) => { l.lower.updateWorldMatrix(true, false); return l.lower.localToWorld(new THREE.Vector3(0, -SEG, 0)); });
/** Tick a built dog for `seconds` at 60 fps from clock `t0`, keeping it still; returns the clock. */
const frames = (d: THREE.Group, t0: number, seconds: number, each?: (t: number) => void): number => { let t = t0; for (let k = 0; k < Math.round(seconds * 60); k++) { t += 1 / 60; d.userData.tick(t, 1 / 60); each?.(t); } return t; };

describe("lying down", () => {
  const stand = dogPose(0, null, Infinity);
  it("withLie leaves a standing pose alone at 0 and lowers the body, drops the chin and the tail and loosens the ears at 1", () => {
    expect(withLie(stand, 0)).toBe(stand);
    const l = withLie(stand, 1);
    near(l.bob, stand.bob - LIE_DROP);
    expect(l.headDrop!).toBeGreaterThan(0.5);
    expect(l.tailDrop!).toBeGreaterThan(0.25);
    expect(l.earFlop).toBeGreaterThan(stand.earFlop + 0.2);
    expect(l.lieK).toBe(1);
    expect(withLie(stand, 7).lieK).toBe(1);
  });
  it("the front paws stretch out ahead, the hind paws tuck in under the belly and the stride is switched off", () => {
    const lie = withGait(withLie(stand, 1), 0.3, 1);
    near(footTarget({ front: true, left: true, lx: HIP_LX }, lie).x, HIP_LX + 0.42);
    near(footTarget({ front: false, left: true, lx: -HIP_LX }, lie).x, -HIP_LX + 0.35);
    near(footTarget({ front: true, left: false, lx: HIP_LX }, lie).y, PAW_R);
  });
  it("the built dog eases down onto its belly (never past it, never a pop) with every paw on the floor and its body on the floor, then gets up the same way", () => {
    const d = buildDog(10, 0);
    let t = frames(d, 0, 0.5);
    d.userData.cue = { name: "lie", at: t };
    let prev = 0;
    t = frames(d, t, 2, () => { expect(d.userData.lieK).toBeGreaterThanOrEqual(prev); expect(d.userData.lieK).toBeLessThanOrEqual(1); prev = d.userData.lieK; });
    expect(d.userData.lieK).toBe(1);
    d.updateMatrixWorld(true);
    for (const p of pawsWorld(d)) near(p.y, PAW_R, 0.01);
    near(d.userData.dogParts.body.position.y, 0.78 - LIE_DROP, 0.01);
    const box = new THREE.Box3().setFromObject(d.userData.dogParts.body, true);
    expect(box.min.y).toBeLessThan(0.06);                                              // its belly is on the floor
    expect(box.min.y).toBeGreaterThanOrEqual(-0.02);                                   // and not through it
    const front = (d.userData.dogParts.legs as DogLeg[]).filter((l) => l.front);
    for (const l of front) { const p = l.lower.localToWorld(new THREE.Vector3(0, -SEG, 0)); d.worldToLocal(p); expect(p.x).toBeGreaterThan(HIP_LX + 0.3); }          // paws out in front
    d.userData.cue = { name: "idle", at: t };
    let lowest = 9;
    t = frames(d, t, 0.25, () => { lowest = Math.min(lowest, d.userData.lieK); });
    expect(d.userData.lieK).toBeLessThan(1);
    expect(d.userData.lieK).toBeGreaterThan(0);                                        // on its way up, not up
    frames(d, t, 2);
    expect(d.userData.lieK).toBe(0);
    near(d.userData.dogParts.body.position.y, 0.78, 1e-6);
  });
  it("the follow settles it onto its belly only after Kip has stood still LIE_AFTER_S more than it takes to sit, and it gets up when Kip walks or goes far", () => {
    const s = { dog: 20, toy: 18, still: true, allowed: true };
    const log: string[] = [];
    const f = createFollow({ dogX: () => s.dog, toyX: () => s.toy, toyStill: () => s.still, clearance: () => Infinity, moveDog: (x) => { s.dog = x; }, cue: (n) => { log.push(n); }, allowed: () => s.allowed });
    const run = (sec: number) => { for (let k = 0; k < Math.round(sec * 60); k++) f.update(1 / 60); };
    run(0.1);
    run(SIT_AFTER_S + 0.2);
    expect(f.phase).toBe("sitting");
    expect(f.lying).toBe(false);
    run(LIE_AFTER_S - 1);
    expect(log).not.toContain("lie");
    run(1.5);
    expect(f.lying).toBe(true);
    expect(f.phase).toBe("sitting");
    expect(log.filter((c) => c === "lie")).toHaveLength(1);                            // once
    run(10);
    expect(log.filter((c) => c === "lie")).toHaveLength(1);
    s.still = false; f.update(1 / 60);                                                 // Kip walks: it gets up
    expect(f.lying).toBe(false);
    expect(f.phase).toBe("standing");
    expect(log.at(-1)).toBe("idle");
    s.still = true;
    run(SIT_AFTER_S + LIE_AFTER_S + 2);                                                // and the clock starts again
    expect(f.lying).toBe(true);
    s.toy = 40; f.update(1 / 60);                                                      // far away: it trots after him
    expect(f.lying).toBe(false);
    expect(f.phase).toBe("trotting");
    expect(log.at(-1)).toBe("run");
  });
  it("something else taking the dog (a pet, a fetch) stops its lying", () => {
    const s = { dog: 20, toy: 18, allowed: true };
    const f = createFollow({ dogX: () => s.dog, toyX: () => s.toy, toyStill: () => true, clearance: () => Infinity, moveDog: (x) => { s.dog = x; }, cue: () => {}, allowed: () => s.allowed });
    for (let k = 0; k < Math.round((SIT_AFTER_S + LIE_AFTER_S + 3) * 60); k++) f.update(1 / 60);
    expect(f.lying).toBe(true);
    s.allowed = false; f.update(1 / 60);
    expect(f.lying).toBe(false);
  });
});

describe("a dog that is busy is not calm", () => {
  it("a bark, a pet and a happy hop are over only after their time, running never is, no cue and the settled ones always are", () => {
    for (const n of [null, "idle", "sit", "lie"]) expect(cueIsCalm(n, 0), String(n)).toBe(true);
    expect(cueIsCalm("bark", 0.2)).toBe(false);
    expect(cueIsCalm("bark", 5)).toBe(true);
    expect(cueIsCalm("pet", 1)).toBe(false);
    expect(cueIsCalm("pet", 3)).toBe(true);
    expect(cueIsCalm("happy", 0.5)).toBe(false);
    expect(cueIsCalm("happy", 2)).toBe(true);
    expect(cueIsCalm("run", 100)).toBe(false);
  });
});

describe("looking at Kip", () => {
  it("cares fully when he is close, not at all beyond the range, and smoothly in between", () => {
    near(lookFor(LOOK_NEAR - 0.5, 0, 0.7).near, 1);
    near(lookFor(LOOK_RANGE + 1, 0, 0.7).near, 0);
    let prev = 1;
    for (let h = LOOK_NEAR; h <= LOOK_RANGE; h += 0.1) { const n = lookFor(h, 0, 0.7).near; expect(n).toBeLessThanOrEqual(prev + 1e-12); prev = n; }
  });
  it("turns the head towards him (positive yaw when he is on the dog's -z side, as the nose turns), clamped, and up at his eyes", () => {
    near(lookFor(3, 0, 0).yaw, 0);
    expect(lookFor(3, -1, 0).yaw).toBeGreaterThan(0.2);
    expect(lookFor(3, 1, 0).yaw).toBeLessThan(-0.2);
    expect(lookFor(0.2, -5, 0).yaw).toBeLessThanOrEqual(LOOK_YAW_MAX + 1e-9);
    expect(lookFor(3, 0, 0.7).pitch).toBeGreaterThan(0.1);
    expect(lookFor(1, 0, 9).pitch).toBeLessThanOrEqual(LOOK_PITCH_MAX + 1e-9);
    expect(lookFor(3, 0, -0.5).pitch).toBeLessThan(0);
  });
  it("never flips from one side to the other: a Kip right behind it is not looked at over the shoulder, and the turn is continuous round the back", () => {
    near(Math.abs(lookFor(-4, 0.01, 0).yaw), 0, 0.05);
    near(Math.abs(lookFor(-4, -0.01, 0).yaw), 0, 0.05);
    let prev = lookFor(4, 0, 0).yaw;
    for (let a = 0; a <= Math.PI; a += 0.02) { const y = lookFor(4 * Math.cos(a), -4 * Math.sin(a), 0).yaw; expect(Math.abs(y - prev)).toBeLessThan(0.08); prev = y; }
    prev = lookFor(4, 0, 0).yaw;
    for (let a = 0; a <= Math.PI; a += 0.02) { const y = lookFor(4 * Math.cos(a), 4 * Math.sin(a), 0).yaw; expect(Math.abs(y - prev)).toBeLessThan(0.08); prev = y; }
  });
  it("the tail goes faster, wider and higher and the ears flare more the closer he is", () => {
    for (const base of [1.6, 2.4, 3.2]) { expect(wagFreq(base, 1)).toBeGreaterThan(wagFreq(base, 0.5)); expect(wagFreq(base, 0.5)).toBeGreaterThan(wagFreq(base, 0)); }
    expect(wagAmp(0.35, 1)).toBeGreaterThan(wagAmp(0.35, 0));
    expect(wagLift(1)).toBeGreaterThan(wagLift(0));
    expect(wagEar(1)).toBeGreaterThan(wagEar(0));
    near(wagFreq(3.2, 0), 3.2);
    near(wagFreq(3.2, 5), wagFreq(3.2, 1));                                            // clamped
  });

  const quiet = (d: THREE.Group) => { d.userData.rng = () => 1; return d; };                // (the longest wait to its next small thing: nothing but the look is going on)
  const settle = (d: THREE.Group, kip: { x: number; z: number } | undefined, seconds = 2) => { d.userData.kip = kip; return frames(d, 0, seconds); };
  it("the built dog's head ends up turned to Kip and tipped up at him, eased: it never moves more than a few hundredths of a radian in a frame, even when he jumps to the other side", () => {
    const d = quiet(buildDog(40, 0));                                                  // faces -x: Kip is ahead of it at x < 40
    const head = d.userData.dogParts.head as THREE.Group;
    settle(d, { x: 36.5, z: -1.2 });                                                   // ahead and to the world -z side = the dog's local +z... 
    const yawA = head.rotation.y;
    expect(Math.abs(yawA)).toBeGreaterThan(0.1);
    expect(head.rotation.z).toBeGreaterThan(0.05);                                     // nose up at his eyes
    let t = 2, worst = 0, last = head.rotation.y;
    d.userData.kip = { x: 36.5, z: 1.2 };                                              // he jumps to the other side
    t = frames(d, t, 2, () => { worst = Math.max(worst, Math.abs(head.rotation.y - last)); last = head.rotation.y; });
    expect(worst).toBeLessThan(0.06);
    expect(Math.sign(head.rotation.y)).toBe(-Math.sign(yawA));
    d.userData.kip = { x: 10, z: 0 };                                                  // far away: it looks ahead again
    frames(d, t, 3);
    near(head.rotation.y, 0, 0.12);                                                    // (what is left is its idle head sway)
  });
  it("a Kip within range makes the tail wag at least half as fast again as a Kip far away", () => {
    const rate = (kip: { x: number; z: number }) => {
      const d = quiet(buildDog(40, 0));
      d.userData.kip = kip;
      frames(d, 0, 1.5);
      let crossings = 0, prev = d.userData.dogParts.tail.rotation.y;
      frames(d, 1.5, 3, () => { const y = d.userData.dogParts.tail.rotation.y; if (Math.sign(y) !== Math.sign(prev) && y !== 0) crossings++; prev = y; });
      return crossings / 3;
    };
    expect(rate({ x: 38, z: 0 })).toBeGreaterThan(rate({ x: 20, z: 0 }) * 1.5);
  });
  it("it does not look at Kip while it is running, or being petted", () => {
    const yawWith = (name: string, kip: { x: number; z: number } | undefined) => {
      const d = quiet(buildDog(40, 0));
      d.userData.kip = kip;
      d.userData.cue = { name, at: 0 };
      frames(d, 0, 2);
      return d.userData.dogParts.head.rotation.y as number;
    };
    for (const name of ["run", "pet"]) near(yawWith(name, { x: 37, z: -1.5 }), yawWith(name, undefined), 0.01);
    expect(Math.abs(yawWith("idle", { x: 37, z: -1.5 }) - yawWith("idle", undefined))).toBeGreaterThan(0.2);          // (while calm it does)
  });
  it("Kip's eyes are above the dog's head", () => { expect(KIP_EYE_Y).toBeGreaterThan(1.18); });
});

describe("small things on a slow timer", () => {
  it("each one eases in and out: nothing at its first instant or its last, most in the middle, nothing outside its time", () => {
    for (const kind of Object.keys(IDLE_LEN) as IdleKind[]) {
      const len = IDLE_LEN[kind];
      expect(idleBits(kind, 0).env, kind).toBe(0);
      expect(idleBits(kind, len).env, kind).toBe(0);
      expect(idleBits(kind, len / 2).env, kind).toBe(1);
      expect(idleBits(kind, -1)).toBe(NO_IDLE);
      expect(idleBits(kind, len + 1)).toBe(NO_IDLE);
      let prevE = 0, rose = true;
      for (let a = 0; a <= len; a += 0.02) { const e = idleBits(kind, a).env; if (a < len / 2) { if (e < prevE - 1e-9) rose = false; prevE = e; } }
      expect(rose, kind).toBe(true);
    }
  });
  it("a sniff puts the nose to the floor, a yawn opens the jaw with the head back, a scratch lifts a hind leg, a tilt tips the head", () => {
    const sn = idleBits("sniff", IDLE_LEN.sniff / 2), yw = idleBits("yawn", IDLE_LEN.yawn / 2), sc = idleBits("scratch", IDLE_LEN.scratch / 2), tl = idleBits("tilt", IDLE_LEN.tilt / 2);
    expect(sn.headDrop).toBeGreaterThan(0.4); expect(sn.headPitch).toBeLessThan(-0.4);
    expect(yw.jaw).toBe(1); expect(yw.headPitch).toBeGreaterThan(0.3); expect(yw.squint).toBe(1);
    expect(sc.scratch).toBe(1);
    expect(tl.headRoll).toBeGreaterThan(0.3);
  });
  it("which ones a dog does depends on how it is: scratching is for a sitting dog, sniffing for a standing one, a lying dog yawns, flicks an ear or tilts", () => {
    expect(IDLE_KINDS.sit).toContain("scratch");
    expect(IDLE_KINDS.stand).not.toContain("scratch");
    expect(IDLE_KINDS.lie).not.toContain("scratch");
    expect(IDLE_KINDS.stand).toContain("sniff");
    expect(IDLE_KINDS.sit).not.toContain("sniff");
    expect(IDLE_KINDS.lie).not.toContain("sniff");
    for (const post of ["stand", "sit", "lie"] as Posture[]) for (let r = 0; r <= 1; r += 0.05) expect(IDLE_KINDS[post]).toContain(pickIdle(post, r));
    expect(new Set([0, 0.4, 0.99].map((r) => pickIdle("stand", r))).size).toBe(3);
  });
  it("the wait between them is a slow random one", () => {
    near(nextIdleDelay(0), IDLE_GAP_S[0]); near(nextIdleDelay(1), IDLE_GAP_S[1]);
    expect(nextIdleDelay(-3)).toBe(IDLE_GAP_S[0]); expect(nextIdleDelay(9)).toBe(IDLE_GAP_S[1]);
    expect(IDLE_GAP_S[0]).toBeGreaterThanOrEqual(4);
  });
  it("scaleIdle fades a small thing out and withIdle lays it over a pose (and does nothing when there is none)", () => {
    const b = idleBits("yawn", 1);
    expect(scaleIdle(b, 0.5).jaw).toBeCloseTo(b.jaw * 0.5, 9);
    const stand = dogPose(2, null, Infinity);
    expect(withIdle(stand, NO_IDLE)).toBe(stand);
    expect(withIdle(stand, b).jaw).toBeCloseTo(b.jaw, 9);
    expect(withIdle(stand, idleBits("scratch", 1), -1).scratchSide).toBe(-1);
  });

  const seq = (vals: number[]) => { let i = 0; return () => vals[i++ % vals.length]!; };
  it("a dog that is standing and calm does its first small thing when the timer says so, and not before", () => {
    const d = buildDog(40, 0);
    d.userData.rng = seq([0, 0]);                                                      // delay 5 s, then the first kind for a standing dog (a sniff)
    let t = frames(d, 0, 4.8);
    expect(d.userData.idle).toBeNull();
    t = frames(d, t, 0.6);
    expect(d.userData.idle).toBe("sniff");
    frames(d, t, IDLE_LEN.sniff + 0.2);
    expect(d.userData.idle).toBeNull();
  });
  it("it never does one during a pet, a bark, a hop or a run, or while it is moving, and a pet that comes in the middle cuts it short and it fades away", () => {
    for (const name of ["pet", "bark", "happy", "run"]) {
      const d = buildDog(40, 0);
      d.userData.rng = seq([0]);
      d.userData.cue = { name, at: 0 };
      d.userData.forceIdle = "sniff";
      frames(d, 0, name === "run" ? 20 : 0.7, () => { expect(d.userData.idle, name).toBeNull(); });
    }
    const m = buildDog(40, 0);                                                         // moving (it takes a frame or two to see it is)
    let t = 0;
    for (let k = 0; k < 20; k++) { t += 1 / 60; m.userData.tick(t, 1 / 60); m.position.x -= 3 / 60; }
    m.userData.forceIdle = "yawn";
    for (let k = 0; k < 120; k++) { t += 1 / 60; m.userData.tick(t, 1 / 60); m.position.x -= 3 / 60; expect(m.userData.idle).toBeNull(); }
    const d = buildDog(40, 0);
    frames(d, 0, 0.5);
    d.userData.forceIdle = "sniff";
    let t2 = frames(d, 0.5, 1.0);
    expect(d.userData.idle).toBe("sniff");
    const drop = d.userData.dogParts.head.position.y;
    expect(drop).toBeLessThan(1.18 - 0.3);                                             // nose well down
    d.userData.cue = { name: "pet", at: t2 };
    let last = drop;
    t2 = frames(d, t2, 0.05, () => { last = d.userData.dogParts.head.position.y; });
    expect(d.userData.idle).toBeNull();
    expect(last).toBeLessThan(1.18);                                                   // it has not popped straight back
    t2 = frames(d, t2, 0.6);
    expect(d.userData.dogParts.head.position.y).toBeGreaterThan(1.18 - 0.12);          // and the sniff is gone (what is left is the pet's own lean)
  });
  it("a yawn opens the jaw and shows the mouth, then shuts them", () => {
    const d = buildDog(40, 0), parts = d.userData.dogParts;
    let t = frames(d, 0, 0.5);
    expect(parts.mouth.visible).toBe(false);
    d.userData.forceIdle = "yawn";
    t = frames(d, t, IDLE_LEN.yawn / 2);
    expect(parts.jaw.rotation.z).toBeLessThan(-0.6);
    expect(parts.mouth.visible).toBe(true);
    expect(parts.body.scale.x).toBeGreaterThan(parts.bodyX * 1.02);                    // stretched a little longer than it is built
    frames(d, t, IDLE_LEN.yawn / 2 + 0.3);
    near(parts.jaw.rotation.z, 0, 1e-9);
    expect(parts.mouth.visible).toBe(false);
    expect(parts.body.scale.x).toBe(parts.bodyX);
    expect(parts.bodyX).toBeCloseTo(1.5, 9);                                           // (the body's length as it has always been built)
  });
  it("a sitting dog scratches with the hind leg on the side the camera sees, the other three paws stay down, and its head dips towards the leg", () => {
    const d = buildDog(40, 0);                                                         // faces -x: the camera (world +z) sees its right side (local -z)
    d.userData.cue = { name: "sit", at: 0 };
    let t = frames(d, 0, 1.5);
    d.userData.forceIdle = "scratch";
    t = frames(d, t, IDLE_LEN.scratch / 2);
    expect(d.userData.idle).toBe("scratch");
    d.updateMatrixWorld(true);
    const legs = d.userData.dogParts.legs as DogLeg[], paws = pawsWorld(d);
    legs.forEach((l, i) => {
      const scratching = !l.front && !l.left;
      if (scratching) { expect(paws[i]!.y).toBeGreaterThan(0.4); expect(Math.abs(l.hip.rotation.x)).toBeGreaterThan(SCRATCH_SPLAY * 0.9); }
      else { near(paws[i]!.y, PAW_R, 0.03); expect(l.hip.rotation.x).toBe(0); }
    });
    expect(d.userData.dogParts.head.rotation.x).toBeGreaterThan(0.1);                  // the head tips so the cheek on the leg's side (-z, the camera's) goes down towards it
    const shaken: number[] = [];
    frames(d, t, 0.4, () => { d.updateMatrixWorld(true); shaken.push(pawsWorld(d)[(legs.findIndex((l) => !l.front && !l.left))]!.x); });
    expect(Math.max(...shaken) - Math.min(...shaken)).toBeGreaterThan(0.03);           // it shakes
    frames(d, t + 0.4, IDLE_LEN.scratch);
    d.updateMatrixWorld(true);
    for (const p of pawsWorld(d)) near(p.y, PAW_R, 0.03);                              // and it puts the leg back
  });
  it("facing the other way it scratches with the other leg (the camera sees its left)", () => {
    const d = buildDog(40, 0);
    d.rotation.y = 0;
    d.userData.cue = { name: "sit", at: 0 };
    let t = frames(d, 0, 1.5);
    d.userData.forceIdle = "scratch";
    frames(d, t, IDLE_LEN.scratch / 2);
    const legs = d.userData.dogParts.legs as DogLeg[];
    expect(Math.abs(legs.find((l) => !l.front && l.left)!.hip.rotation.x)).toBeGreaterThan(0.5);
    expect(legs.find((l) => !l.front && !l.left)!.hip.rotation.x).toBe(0);
  });
  it("it does one at random when nothing is forced, lying down as well (a lying dog yawns, flicks an ear or tilts, never sniffs or scratches)", () => {
    const d = buildDog(40, 0);
    d.userData.cue = { name: "lie", at: 0 };
    const seen = new Set<string>();
    let i = 0;
    d.userData.rng = () => [0.01, 0.1, 0.5, 0.2, 0.9, 0.3][i++ % 6]!;
    frames(d, 0, 90, () => { if (d.userData.idle) seen.add(d.userData.idle); });
    expect(seen.size).toBeGreaterThan(0);
    for (const k of seen) expect(IDLE_KINDS.lie).toContain(k as IdleKind);
  });
});

describe("a prop that shuffles along the floor", () => {
  function room() {
    const root = new THREE.Group();
    const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 400 }) } as unknown as HTMLElement;
    const fx = createPropFx({ root: () => root, camera: () => new THREE.PerspectiveCamera(), canvas, toast: () => {}, boostWindmill: () => {}, reduced: () => false, canSpeak: () => false });
    const dog = buildDog(20, 0);
    root.add(dog);
    return { fx, inst: fx.register("dog", [dog])!, dog };
  }
  const run = (fx: { update(dt: number, t: number): void }, seconds: number, t0 = 0) => { let t = t0; for (let k = 0; k < Math.round(seconds * 60); k++) { t += 1 / 60; fx.update(1 / 60, t); } return t; };
  it("`walk` steps it to x at WALK_SPEED and stops exactly there; the dog's legs step at that pace", () => {
    const { fx, inst, dog } = room();
    fx.placeProp(inst, 19.65, { walk: true });
    expect(inst.base.px).toBe(20);                                                    // not at once
    run(fx, 0.1);
    near(dog.position.x, 20 - WALK_SPEED * 0.1, 0.03);
    run(fx, 0.5, 0.1);
    near(dog.position.x, 19.65, 1e-9);
    expect(0.35 / WALK_SPEED).toBeLessThan(0.4);                                      // a quick shuffle
  });
  it("a move in depth only (x null) or a turn on the spot (the same x) leaves a shuffle in progress alone, a move somewhere else cancels it", () => {
    const { fx, inst, dog } = room();
    fx.placeProp(inst, 19, { walk: true });
    run(fx, 0.1);
    fx.placeProp(inst, null, { z: 0.5 });
    fx.placeProp(inst, inst.base.px, { ry: 0 });
    run(fx, 1, 0.1);
    near(dog.position.x, 19, 1e-9);
    near(dog.position.z, 0.5, 1e-9);
    fx.placeProp(inst, 19.5, { walk: true });
    run(fx, 0.05, 1.1);
    fx.placeProp(inst, 25);
    run(fx, 1, 1.15);
    near(dog.position.x, 25, 1e-9);
  });
  it("the dog's paws really step while it shuffles (a walking pace, so the paws do not skate)", () => {
    const { fx, inst, dog } = room();
    let t = run(fx, 0.5);
    fx.placeProp(inst, 19.65, { walk: true });
    let maxSpeed = 0;
    t = run(fx, 0.4, t);
    maxSpeed = dog.userData.speed;
    expect(maxSpeed).toBeGreaterThan(0.1);
  });
});

describe("the end of a pet: the dog shuffles a little closer to Kip", () => {
  it("when the pet completes the dog is walked PET_STEP_IN towards Kip (x smaller), not teleported and not frozen; a pet cut short does not", async () => {
    const { createActs } = await import("../src/features/game/world/runtime/toyRoomActs");
    const placed: Array<{ x: number | null; walk?: boolean; z?: number }> = [];
    const root = new THREE.Group();
    const s = { pos: { x: 38, y: 0, z: 0.7 }, target: null as number | null };
    const dog = { type: "dog", base: { px: 42.2, pz: 0.7 }, size: new THREE.Vector3(2.5, 1.6, 0.8) } as never;
    const w = {
      position: () => ({ ...s.pos }), targetX: () => s.target, walkTo: (x: number) => { s.target = x; }, stopWalk: () => { s.target = null; }, face: () => {},
      root: () => root, eater: () => "character", allowed: () => true, clip: () => true, setPosition: () => {}, tone: () => {}, phase: () => {}, hold: () => {}, release: () => {},
      mouth: () => ({ x: 0, y: 0, z: 0 }), bubbles: { blow: () => {} },
      fx: { squish: () => {}, strike: () => null, kickBall: () => true, flutter: () => {}, say: () => {}, setVisible: () => {}, cue: () => {}, nearby: () => [], placeProp: (_i: unknown, x: number | null, o?: { walk?: boolean; z?: number }) => { placed.push({ x, walk: o?.walk, z: o?.z }); } },
    };
    const acts = createActs(w as never);
    acts.tap(dog);
    placed.length = 0;
    s.pos.x = 42.2 - PET_STAND; s.target = null;
    for (let k = 0; k < Math.round((PET_S + 0.5) * 30); k++) acts.update(1 / 30);
    expect(placed).toEqual([{ x: 42.2 - PET_STEP_IN, walk: true, z: undefined }]);
    expect(acts.busy).toBe(false);
    expect(PET_STEP_IN).toBeGreaterThan(0.2);
    expect(PET_STEP_IN).toBeLessThan(0.6);
    placed.length = 0;
    acts.tap(dog);
    placed.length = 0;
    s.pos.x = 42.2 - PET_STAND; s.target = null;
    for (let k = 0; k < 10; k++) acts.update(1 / 30);
    acts.reset();
    expect(placed).toEqual([]);                                                        // cut short: it stays where it is
  });
});

describe("the world tells the dog where Kip is", () => {
  const world = readFileSync(join(__dirname, "../src/features/game/world/runtime/world.ts"), "utf8");
  it("every frame, before the props are updated, the dog is given Kip's place", () => {
    expect(world).toContain("function dogLook(){var d=theDog();if(d)d.holder.userData.kip={x:P.pos.x,z:P.pos.z}}");
    expect(world).toContain(" dogLook();PFX.update(dt,t);");
  });
});
