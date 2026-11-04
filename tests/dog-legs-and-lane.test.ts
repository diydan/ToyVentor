// The dog's legs and its lane (Dan, 2026-11-04: "dog animation needs improvement and patting dog is not aligned, dog is not on same path or aligned with Kip"):
// the two-bone legs and the trot that keeps a planted paw where it landed, the nose turning the way the dog goes, the depth a dog walks to (Kip's lane), the pet that
// leans into the hand, and the follow / fetch / pet logic that keeps the dog beside Kip, not a room behind him.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DUTY, GAIT_DIP, HIP_LX, HIP_Y, MAX_SPEED, PAW_R, PET_PUSH_AGES, SEG, STEP_FROM_SPEED, STEP_LEN, STEP_LIFT, STRIDE, TURN_STEP,
  applyDogPose, buildDog, dogPose, footStep, footTarget, gaitBlend, gaitBody, hipPlace, legPhase, solveLeg, steerFor, stepSpeed, withGait, withSit,
} from "../src/features/game/world/runtime/dog";
import type { DogLeg } from "../src/features/game/world/runtime/dog";
import { createFollow } from "../src/features/game/world/runtime/dogFollow";
import { createFetch, LANE_ARRIVE, MOUTH } from "../src/features/game/world/runtime/dogFetch";
import { PET_CUE_S, PET_STAND } from "../src/features/game/world/runtime/toyRoomActs";
import { PET_STROKES_S } from "../src/features/game/world/runtime/proceduralClips";
import { TURN_SPEED, Z_EASE_SPEED, createPropFx, turnDelta } from "../src/features/game/world/runtime/propReactions";
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
    expect(world).toContain("function dogLaneTo(z: number){var d=theDog();if(d)PFX.placeProp(d,d.base.px,{z:z})}");
    expect(world).toMatch(/var FOLLOW=createFollow\(\{[\s\S]*?toyZ:function\(\)\{return P\.pos\.z\},laneTo:dogLaneTo\}\);/);
    expect(world).toMatch(/var DOGF=createFetch\(\{[\s\S]*?dogZ:function\(\)\{var d=theDog\(\);return d\?d\.base\.pz:0\},ballZ:[\s\S]*?toyZ:function\(\)\{return P\.pos\.z\},laneTo:dogLaneTo\}\);/);
    expect(world).toContain("moveBall:function(x: number,l: number,z?: number){if(fetchBall)PFX.placeProp(fetchBall,x,z===undefined?{lift:l}:{lift:l,z:z,zSnap:true})}");
  });
});
