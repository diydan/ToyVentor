// What Kip does with the outdoor things (docs/specs/playful-interactions-spec.md section 6): push the TIRE and watch it roll, lie down in the snow and make a SNOW ANGEL, water the FLOWER BED until the
// flowers open (and next time pick them and smell the bouquet), feed the BUNNY a carrot, sit on the PICNIC blanket and eat a sandwich, ride the SWING. Each is a `Visit` (visitRoutine.ts) built here from the
// prop that was tapped; toyRoomActs.ts hands the tap over (`createActs` makes this with its own hearts) and the props themselves are in outdoorProps.ts. The only pure numbers here are the paths and timings
// (exported so a test can pin them); the three.js part is the water drops.
import * as THREE from "three";
import { BALL_BOUNDS, SMALL_BALL_R } from "./ballKick";
import { SHOVE_PLAY_S } from "./gameMoves";
import { ANGEL_START_S, ANGEL_SWEEPS, ANGEL_SWEEP_S, ANGEL_S, BITES_S, OFFER_S, OFFER_TAKE_S, PICK_GRAB_S, PICK_S, POUR_END_S, POUR_START_S, POUR_S, SIT_EAT_S, SMELL_S, SMELL_SNIFF_S, SWING_HOP_S, SWING_S } from "./playClips";
import { SANDWICH_COUNT, seatPoint, swingAngle, FLOWER_X } from "./outdoorProps";
import type { ActsWorld } from "./toyRoomActs";
import type { PropInst } from "./propReactions";
import type { Visit } from "./visitRoutine";

export type ThingKind = "roll" | "angel" | "water" | "feed" | "picnic" | "ride" | "throw";

export interface ThingHelpers {
  heart(at: THREE.Vector3, size?: number): void;
  note(at: THREE.Vector3, size?: number): void;
  flake(at: THREE.Vector3, size?: number): void;
  /** After a push, trot after the thing that is rolling and stop behind it. */
  follow(inst: PropInst, dir: 1 | -1): void;
}

/** Where Kip stands, in x, relative to the prop's centre (negative: to the left of it). */
export const TIRE_STAND = 1.6;
export const WATER_STAND = 2.1;
export const PICK_STAND = 1.5;
export const FEED_STAND = 1.45;
export const SWING_STAND = 1.3;
/**
 * The throw (Dan, 2026-11-04: the Mixamo "pickup and Throw Object" clip): Kip walks to the small ball, bends and picks it up (the fist is at the floor at THROW_PICK_S: he stands THROW_STAND from it so
 * his hand is on it there), straightens, winds up and throws it overarm at THROW_RELEASE_S, and the dog fetches it. The clip is `throw` (3.8 s of the 4.9 s: the recovery is trimmed).
 */
export const THROW_STAND = 1.0;
export const THROW_PICK_S = 1.2;
export const THROW_RELEASE_S = 2.45;
export const THROW_S = 3.8;
export const THROW_VX = 3.0;
export const THROW_VY = 1.4;
/** How much room a throw needs in front of the ball (a little more than it travels: it flies, bounces and rolls about this far). */
export const THROW_ROOM = 8;
/** The tire is pushed at this moment of the shove (the Mixamo push as authored: the arms are out at about 0.6 s) and rolls off at this speed (it stops about 4 units on). */
export const TIRE_PUSH_S = 0.65;
export const TIRE_VX = 4.4;
export const TIRE_S = SHOVE_PLAY_S;
/** The swing's seat: how far Kip's origin sits below the seat's top when sitting (tuned against screenshots), the hop up and the hop down. */
export const SIT_DROP = 0.45;
export const HOP_S = SWING_HOP_S;
export const RIDE_S = SWING_S;
/** How long the flowers take to open once the water is falling, and when (seconds into the visit). */
export const GROW_FROM_S = 1.0;
export const GROW_TO_S = 2.7;
export const WATER_S = POUR_S;
export const BOUQUET_S = PICK_S + SMELL_S;

/** The toy can only walk within this far of the middle of the lane in depth (world.ts `clampPathZ`): a visit that asks it to stand further out would never "arrive". */
export const PATH_Z = 1.2;
export const lane = (z: number) => Math.max(-PATH_Z, Math.min(PATH_Z, z));
/** Props stand behind Kip's walking lane (world.ts CLEAR_Z), so Kip walks to the lane's edge and then steps back into the scene to the prop's depth, does it, and steps out again: how long each step takes. */
export const STEP_S = 0.45;
/** How far in front of a prop's own depth Kip stands for a hand job (the can, the carrot, the push) and what it never goes behind. */
export const FRONT_OF_PROP = 0.9;
export const DEEPEST_Z = -3.4;
/** Where Kip is in depth `t` seconds into a visit of `seconds`: where it began, eased into `z`, held there, and eased back out for the last STEP_S. */
export function stepZ(t: number, seconds: number, z0: number, z: number): number {
  const e = (u: number) => { const k = u < 0 ? 0 : u > 1 ? 1 : u; return k * k * (3 - 2 * k); };
  if (!(t > 0)) return z0;
  const out = t - (seconds - STEP_S);
  if (out > 0) return z + (z0 - z) * e(out / STEP_S);
  return z0 + (z - z0) * e(t / STEP_S);
}
const ease = (u: number) => { const k = u < 0 ? 0 : u > 1 ? 1 : u; return k * k * (3 - 2 * k); };
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

/** How open the flowers are `t` seconds into the watering: closed until the water falls, then opening, then fully open. */
export function growthAt(t: number): number { return ease((t - GROW_FROM_S) / (GROW_TO_S - GROW_FROM_S)); }
/** Where Kip is on the swing ride `t` seconds in: it hops up onto the seat, rides along the arc, and hops down again. `seat(a)` gives the seat's top for a swing angle. */
export function ridePath(t: number, stand: { x: number; z: number }, swing: { x: number; z: number }, angleAt: (t: number) => number): { x: number; y: number; z: number; angle: number } {
  // Kip's origin hangs SIT_DROP below the seat's top along the seat's own "down", which tilts with the swing: (sin a, -cos a)
  const seatAt = (a: number) => { const s = seatPoint(a); return { x: swing.x + s.dx + SIT_DROP * Math.sin(a), y: s.y - SIT_DROP * Math.cos(a) }; };
  if (!(t > 0)) return { x: stand.x, y: 0, z: stand.z, angle: 0 };
  if (t < HOP_S) {
    const u = t / HOP_S, e = ease(u), s = seatAt(0);
    return { x: lerp(stand.x, s.x, e), y: lerp(0, s.y, e) + 0.7 * Math.sin(Math.PI * u), z: lerp(stand.z, swing.z, e), angle: 0 };
  }
  if (t >= RIDE_S - HOP_S) {
    const u = (t - (RIDE_S - HOP_S)) / HOP_S;
    if (u >= 1) return { x: stand.x, y: 0, z: stand.z, angle: 0 };
    const e = ease(u), s = seatAt(0);
    return { x: lerp(s.x, stand.x, e), y: lerp(s.y, 0, e) + 0.7 * Math.sin(Math.PI * u), z: lerp(swing.z, stand.z, e), angle: 0 };
  }
  const a = angleAt(t - HOP_S), s = seatAt(a);
  return { x: s.x, y: s.y, z: swing.z, angle: a };
}

interface Drop { mesh: THREE.Mesh; vy: number; age: number }

export function createPlaythings(w: ActsWorld, h: ThingHelpers) {
  /** A visit done at the prop's depth rather than the lane's: Kip steps into `zOf()` (clamped to DEEPEST_Z) for it and back to where it began, even when it is cut short. */
  function atDepth(v: Visit, zOf: () => number): Visit {
    let z0 = 0;
    if (w.walkDeep) {
      // Foot slide (Dan, 2026-11-04): the glide below moved the toy 0.7 to 3.4 units in 0.45 s with its feet frozen. When the world can walk out past the lane the toy WALKS there (diagonally, facing where
      // it goes, its feet going back at the pace of the ground) and walks back to where it began when the act is over. A cut-short visit still puts it back at once.
      const home = v.standZ ?? w.position().z;
      return {
        ...v,
        deep: true,
        standZ: Math.max(DEEPEST_Z, zOf()),
        end: (completed) => {
          const p = w.position();
          if (completed) w.walkTo(p.x, home);
          else w.setPosition(p.x, p.y, home);
          v.end(completed);
        },
      };
    }
    return {
      ...v,
      begin: () => { z0 = w.position().z; v.begin(); },
      tick: (t) => { const p = w.position(); w.setPosition(p.x, p.y, stepZ(t, v.seconds, z0, Math.max(DEEPEST_Z, zOf()))); v.tick?.(t); },
      end: (completed) => { const p = w.position(); w.setPosition(p.x, p.y, z0); v.end(completed); },
    };
  }
  const drops: Drop[] = [];
  const dropGeo = new THREE.SphereGeometry(0.055, 8, 6);
  const dropMat = new THREE.MeshBasicMaterial({ color: 0x6ec6ff, transparent: true, opacity: 0.9, fog: false });
  const addDrop = (x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(dropGeo, dropMat);
    mesh.position.set(x, y, z);
    mesh.userData.noPick = true;
    w.root().add(mesh);
    drops.push({ mesh, vy: -1.2, age: 0 });
  };
  const clearDrops = () => { for (const d of drops) d.mesh.parent?.remove(d.mesh); drops.length = 0; };

  const at = (inst: PropInst, dx: number, y: number, dz = 0.3) => new THREE.Vector3(inst.base.px + dx, y, inst.base.pz + dz);
  const call = (inst: PropInst, name: string, ...args: unknown[]) => { const f = inst.holder.userData[name] as ((...a: unknown[]) => unknown) | undefined; return f ? f(...args) : undefined; };

  // ---- the tire: push it and it rolls ---------------------------------------------------------------------------------------
  function rollVisit(inst: PropInst): Visit {
    const x = inst.base.px;
    let dir: 1 | -1 = x + 5 > BALL_BOUNDS[1] ? -1 : 1;                               // roll it to the right (where the camera shows most room), unless the wall is too close
    if (x - dir * TIRE_STAND < BALL_BOUNDS[0] || x - dir * TIRE_STAND > BALL_BOUNDS[1]) dir = (-dir) as 1 | -1;
    let pushed = false;
    return {
      standX: x - dir * TIRE_STAND, face: dir, seconds: TIRE_S,
      begin: () => { pushed = false; w.clip("shove"); },
      cues: [{ at: TIRE_PUSH_S, fn: () => { pushed = w.fx.kickBall(inst, dir * TIRE_VX, 0); w.tone(110, 0, 0.18, "sine", 0.12, 70); w.tone(220, 0.02, 0.1, "square", 0.04, 120); } }],
      end: () => { if (pushed) h.follow(inst, dir); },
    };
  }

  // ---- the snow angel -------------------------------------------------------------------------------------------------------
  function angelVisit(inst: PropInst): Visit {
    const x = inst.base.px, z = inst.base.pz;
    const cues = Array.from({ length: ANGEL_SWEEPS }, (_, i) => ({
      at: ANGEL_START_S + i * ANGEL_SWEEP_S + 0.1,
      fn: () => { for (let k = 0; k < 3; k++) h.flake(new THREE.Vector3(x - 0.9 + k * 0.9, 0.45 + (k % 2) * 0.2, z + 0.5), 0.34); w.tone(900 + i * 150, 0, 0.12, "triangle", 0.04, 1300 + i * 150); },
    }));
    return {
      standX: x, standZ: lane(z), face: 1, seconds: ANGEL_S,
      begin: () => { call(inst, "setImprint", 0); w.clip("angel"); },
      tick: (t) => { call(inst, "setImprint", ease((t - (ANGEL_START_S + ANGEL_SWEEPS * ANGEL_SWEEP_S - 0.4)) / 0.7)); },
      cues,
      end: (completed) => { call(inst, "setImprint", completed ? 1 : 0); },       // the angel stays in the snow; a cut-short one leaves clean snow
    };
  }

  // ---- the flower bed: water it, then pick the bouquet ----------------------------------------------------------------------
  function waterVisit(inst: PropInst): Visit {
    const x = inst.base.px, z = inst.base.pz;
    const canMesh = inst.holder.userData.can as THREE.Object3D | undefined;
    let sprinkle = 0;
    return {
      standX: x - WATER_STAND, standZ: lane(z), face: 1, seconds: WATER_S,
      begin: () => { if (canMesh) canMesh.visible = false; w.clip("pour"); sprinkle = 0; },
      tick: (t) => {
        call(inst, "setGrowth", growthAt(t));
        if (t >= POUR_START_S + 0.25 && t < POUR_END_S) {                          // a sprinkle of drops from the can's rose, falling over the flowers
          while (sprinkle * 0.045 < t - POUR_START_S - 0.25) { sprinkle++; const fx = FLOWER_X[sprinkle % FLOWER_X.length]!; addDrop(x - 0.95 + (sprinkle % 5) * 0.34 + fx * 0.05, 2.0 - (sprinkle % 3) * 0.05, z + ((sprinkle * 7) % 5) * 0.06 - 0.12); }
        }
      },
      cues: [
        { at: POUR_START_S, fn: () => { w.hold("can"); w.tone(500, 0, 0.1, "sine", 0.05, 700); } },
        { at: 1.2, fn: () => w.tone(700, 0, 0.5, "triangle", 0.03, 1000) },
        { at: GROW_TO_S, fn: () => { FLOWER_X.forEach((fx, i) => h.heart(at(inst, fx, 1.5, 0.4), 0.3 + (i % 2) * 0.06)); [523, 659, 784].forEach((f, i) => w.tone(f, i * 0.09, 0.3, "triangle", 0.08)); } },
        { at: POUR_END_S, fn: () => { w.release(); if (canMesh) canMesh.visible = true; } },
      ],
      end: (completed) => { w.release(); if (canMesh) canMesh.visible = true; call(inst, "setGrowth", completed ? 1 : 0); },
    };
  }
  function bouquetVisit(inst: PropInst): Visit {
    const x = inst.base.px, z = inst.base.pz;
    return {
      standX: x - PICK_STAND, standZ: lane(z), face: 1, seconds: BOUQUET_S,
      begin: () => { w.clip("pick"); },
      cues: [
        { at: PICK_GRAB_S, fn: () => { call(inst, "setGrowth", 0); w.hold("bouquet"); w.tone(660, 0, 0.1, "triangle", 0.06, 880); } },
        { at: PICK_S, fn: () => { w.clip("smell"); } },
        { at: PICK_S + SMELL_SNIFF_S, fn: () => { w.tone(300, 0, 0.35, "sine", 0.05, 520); h.heart(at(inst, -1.0, 2.4, 0.4), 0.4); h.heart(at(inst, -0.6, 2.7, 0.4), 0.3); } },
      ],
      end: () => { w.release(); call(inst, "setGrowth", 0); },
    };
  }

  // ---- the bunny: feed it a carrot ------------------------------------------------------------------------------------------
  function feedVisit(inst: PropInst): Visit {
    const x = inst.base.px, z = inst.base.pz;
    return {
      standX: x - FEED_STAND, standZ: lane(z), face: 1, seconds: OFFER_S,
      begin: () => { w.clip("offer"); },
      cues: [
        { at: 0.55, fn: () => { w.hold("carrot"); w.fx.cue(inst, "hop"); w.tone(600, 0, 0.08, "triangle", 0.05, 800); } },
        { at: OFFER_TAKE_S, fn: () => { w.release(); w.fx.cue(inst, "nibble"); } },
        ...[0.1, 0.3, 0.5, 0.7].map((d) => ({ at: OFFER_TAKE_S + d, fn: () => w.tone(420, 0, 0.05, "square", 0.04, 300) })),
        { at: 1.9, fn: () => { h.heart(at(inst, -0.6, 1.5, 0.3), 0.38); h.heart(at(inst, -0.2, 1.8, 0.3), 0.3); w.tone(784, 0, 0.12, "triangle", 0.06, 1000); w.fx.cue(inst, "hop"); } },
      ],
      end: () => { w.release(); },
    };
  }

  // ---- the picnic: sit and eat a sandwich -----------------------------------------------------------------------------------
  function picnicVisit(inst: PropInst): Visit {
    const x = inst.base.px, z = inst.base.pz;
    return {
      standX: x - 0.1, standZ: lane(z + 0.1), face: 1, seconds: SIT_EAT_S,
      begin: () => { w.clip("sit_eat"); },
      cues: [
        { at: 0.45, fn: () => { call(inst, "setFood", SANDWICH_COUNT - 1); w.hold("sandwich"); } },
        ...BITES_S.flatMap((t, i) => [{ at: t, fn: () => { w.tone(330 + i * 40, 0, 0.06, "square", 0.04, 220); w.tone(300 + i * 40, 0.14, 0.06, "square", 0.04, 200); } }]),
        { at: BITES_S[BITES_S.length - 1]! + 0.5, fn: () => { w.release(); h.heart(new THREE.Vector3(x, 1.7, z + 0.4), 0.4); w.tone(784, 0, 0.14, "triangle", 0.06, 1000); } },
      ],
      end: () => { w.release(); call(inst, "setFood", SANDWICH_COUNT); },
    };
  }

  // ---- the small ball: picked up and thrown for the dog -------------------------------------------------------------------------
  function throwVisit(inst: PropInst): Visit {
    const x = inst.base.px;
    let dir: 1 | -1 = x + THROW_ROOM > BALL_BOUNDS[1] ? -1 : 1;           // throw it to the right (where the camera shows most room), unless the wall is too close
    if (x - dir * THROW_STAND < BALL_BOUNDS[0] || x - dir * THROW_STAND > BALL_BOUNDS[1]) dir = (-dir) as 1 | -1;
    let fetched = false, inHand = false, thrown = false;
    const standX = x - dir * THROW_STAND;
    return {
      standX, face: dir, seconds: THROW_S,
      begin: () => { inHand = false; thrown = false; fetched = false; w.clip("throw"); },
      cues: [
        { at: THROW_PICK_S, fn: () => { w.fx.setVisible(inst, false); w.hold("smallball"); inHand = true; w.tone(520, 0, 0.08, "triangle", 0.05, 700); } },
        { at: THROW_RELEASE_S, fn: () => {
          const fist = w.heldAt?.();                                       // where the hand is right now: the ball leaves from there, and from that high
          const from = fist ? { x: fist.x, h: Math.max(0, fist.y - SMALL_BALL_R) } : { x: standX + dir * 0.9, h: 1.9 };
          w.release(); inHand = false;
          w.fx.setVisible(inst, true);
          thrown = w.fx.kickBall(inst, dir * THROW_VX, THROW_VY, from);
          w.tone(300, 0, 0.1, "square", 0.06, 160);
          fetched = w.fetch ? w.fetch(inst) : false;
        } },
      ],
      end: () => {
        if (inHand) { w.release(); inHand = false; }                      // cut short with it in his hand: it goes back where it was
        w.fx.setVisible(inst, true);
        if (thrown && !fetched) h.follow(inst, dir);                       // no dog: Kip trots after it, as he does after a kick
      },
    };
  }

  // ---- the swing ------------------------------------------------------------------------------------------------------------
  function rideVisit(inst: PropInst): Visit {
    const x = inst.base.px, z = inst.base.pz;
    const stand = { x: x - SWING_STAND, z: lane(z) };
    const angleAt = (t: number) => swingAngle(t, RIDE_S - 2 * HOP_S);
    let lastSide = 0;
    return {
      standX: stand.x, standZ: stand.z, face: 1, seconds: RIDE_S,
      begin: () => { inst.holder.userData.riding = true; lastSide = 0; w.clip("swing"); w.tone(440, 0, 0.1, "triangle", 0.05, 660); },
      tick: (t) => {
        const p = ridePath(t, stand, { x, z }, angleAt);
        w.setPosition(p.x, p.y, p.z);
        w.setRoll?.(p.angle);                                          // he rolls with the ropes, about the seat
        call(inst, "setAngle", p.angle);
        const side = Math.sign(p.angle);
        if (side !== 0 && side !== lastSide) { lastSide = side; if (Math.abs(p.angle) > 0.12) w.tone(380 + Math.abs(p.angle) * 400, 0, 0.18, "sine", 0.04, 250); }
      },
      cues: [{ at: 3.1, fn: () => { h.note(at(inst, 0.2, 3.1, 0.5), 0.42); h.note(at(inst, -0.4, 3.4, 0.5), 0.36); } }],
      end: () => { inst.holder.userData.riding = false; call(inst, "setAngle", 0); w.setRoll?.(0); w.setPosition(stand.x, 0, stand.z); },
    };
  }

  return {
    /** The visit a tap on this prop starts, or null when the prop is not in a state for it. */
    visitFor(kind: ThingKind, inst: PropInst): Visit | null {
      switch (kind) {
        case "roll": return inst.kick ? null : atDepth(rollVisit(inst), () => inst.base.pz + 0.2);       // a tire still rolling is not pushed again
        case "angel": return atDepth(angelVisit(inst), () => inst.base.pz);                              // lies ON the pad
        case "water": { const g = inst.holder.userData.growth as (() => number) | undefined; return atDepth(g && g() > 0.5 ? bouquetVisit(inst) : waterVisit(inst), () => inst.base.pz + FRONT_OF_PROP); }
        case "feed": return atDepth(feedVisit(inst), () => inst.base.pz + FRONT_OF_PROP);
        case "picnic": return atDepth(picnicVisit(inst), () => inst.base.pz);                            // sits ON the blanket
        case "ride": return rideVisit(inst);
        case "throw": return atDepth(throwVisit(inst), () => inst.base.pz);                              // picks it up at the ball's own depth
      }
    },
    update(dt: number): void {
      for (let i = drops.length - 1; i >= 0; i--) {
        const d = drops[i]!;
        d.age += dt;
        d.vy -= 9 * dt;
        d.mesh.position.y += d.vy * dt;
        if (d.mesh.position.y <= 0.45 || d.age > 2) { d.mesh.parent?.remove(d.mesh); drops.splice(i, 1); }
      }
    },
    reset(): void { clearDrops(); },
    get dropCount(): number { return drops.length; },
  };
}
export type Playthings = ReturnType<typeof createPlaythings>;
