// The toy block tower (docs/specs/playful-interactions-spec.md section 6): the Toy Room's pile of lettered blocks that a child builds up one tap at a time.
//
// Each tap drops a new block on top (it falls, thuds, bounces a little, and the whole tower wobbles; the taller it is, the more). The notes climb a scale as it grows. Past five layers
// the tower sways nervously by itself. The tap at the top (MAX_LAYERS) brings it down: the blocks tumble off one after another, bounce, come to rest flat on the floor, and after a
// moment fly back into the starting pile.
//
// Everything here is pure numbers (`createTower`, the helpers, no three.js) so the tests can run the whole thing without a GPU. `buildBlockTower` is the thin mesh wrapper that
// propReactions.ts talks to through `holder.userData.stack()` (a tap) and `holder.userData.tick(t, dt)` (every frame), the way the xylophone and the dog do.
import { T, M } from "./worldScene";
import type * as THREE from "three";

export const BLOCK = 0.9;
const H = BLOCK / 2;
/** The tallest tower: layer 0 is two blocks side by side, every layer above is one. */
export const MAX_LAYERS = 7;
/** What stands when the room loads (and after a crash): the pair and one on top, the old pile. */
export const START_LAYERS = 2;
export const BLOCK_COUNT = MAX_LAYERS + 1;
export const BLOCK_LETTERS = "ABCDEFGH";
export const BLOCK_COLORS: readonly string[] = ["#ff5a4d", "#52b7ff", "#ffd24d", "#5af0b0", "#c07aff", "#ff9d5c", "#ff7ac0", "#7a7cff"];
/** A C major scale: the note a block makes as it lands is `TOWER_NOTES[layers - 1]`. */
export const TOWER_NOTES: readonly number[] = [262, 294, 330, 349, 392, 440, 494, 523];

export interface Pose { x: number; y: number; z: number; rx: number; ry: number; rz: number }
export interface BlockPose extends Pose { visible: boolean; scale: number }

/** How many blocks stand in a tower of `layers`. */
export const blocksIn = (layers: number) => layers + 1;

const JIT_X = [0, 0.06, -0.07, 0.08, -0.06, 0.07];
const JIT_YAW = [0.2, -0.12, 0.15, -0.2, 0.1, -0.15];
/** Where block `i` sits in the tower: the pair on the floor, then one per layer, each a touch off true (a toy tower is never quite straight). */
export function slotOf(i: number): Pose {
  if (i === 0) return { x: -0.5, y: H, z: 0, rx: 0, ry: 0.1, rz: 0 };
  if (i === 1) return { x: 0.5, y: H, z: 0.1, rx: 0, ry: -0.15, rz: 0 };
  const layer = i - 1;
  return { x: JIT_X[layer - 1] ?? 0, y: H + BLOCK * layer, z: 0, rx: 0, ry: JIT_YAW[layer - 1] ?? 0, rz: 0 };
}

// ---- stacking: the drop and the wobble ------------------------------------------------------------------------------------

export const DROP_HEIGHT = 2.6;
const G_DROP = 32;
/** Seconds from a tap to the block landing. */
export const DROP_LAND_S = Math.sqrt((2 * DROP_HEIGHT) / G_DROP);
const BOUNCE_S = 0.2;
/** How far above its slot a block is `age` seconds after the tap: it falls, lands, and hops a little. */
export function dropOffset(age: number): number {
  if (!(age >= 0)) return DROP_HEIGHT;
  if (age < DROP_LAND_S) return DROP_HEIGHT - 0.5 * G_DROP * age * age;
  const b = (age - DROP_LAND_S) / BOUNCE_S;
  return b < 1 ? 0.09 * Math.sin(Math.PI * b) : 0;
}

/** How much of the tower's sway the block with its centre at height `y` takes: nothing for the pair lying on the floor, all of it for the top block, more and more the higher up. */
const reach = (layers: number, y: number) => Math.pow(Math.max(0, (y - H) / (BLOCK * Math.max(1, layers - 1))), 1.5);

export const SWAY_S = 1.6;
/** How far the block with its centre at height `y` is pushed along x (and tipped) `age` seconds after a block landed on a tower of `layers`: more the higher it is and the taller the tower. */
export function sway(layers: number, y: number, age: number): { dx: number; rz: number } {
  if (!(age >= 0) || age >= SWAY_S) return { dx: 0, rz: 0 };
  const dx = 0.05 * (layers - 1) * reach(layers, y) * Math.exp(-age * 2.6) * Math.sin(age * 15);
  return { dx, rz: -dx * 0.35 };
}

/** A tall tower is never still: from five layers up it creaks slowly from side to side, more the taller it is. */
export function nervous(layers: number, y: number, t: number): { dx: number; rz: number } {
  const k = layers - 4;
  if (k <= 0) return { dx: 0, rz: 0 };
  const dx = 0.035 * k * reach(layers, y) * Math.sin(t * 2.1);
  return { dx, rz: -dx * 0.25 };
}

// ---- the crash -------------------------------------------------------------------------------------------------------------

const GRAVITY = 26;
const X_BOUND = 3.2, Z_MIN = -1.1, Z_MAX = 1.7;
const HALF_PI = Math.PI / 2;
const snapHalfPi = (a: number) => Math.round(a / HALF_PI) * HALF_PI;

/** The height of a cube's centre above the floor when it touches it, turned by `rx` and `rz` (order YXZ: the yaw does not matter): half a block when it lies flat. */
export function restY(rx: number, rz: number): number {
  const cx = Math.cos(rx), sx = Math.sin(rx), cz = Math.cos(rz), sz = Math.sin(rz);
  return H * (Math.abs(cx * sz) + Math.abs(cx * cz) + Math.abs(sx));
}

export interface Body extends Pose {
  vx: number; vy: number; vz: number; wx: number; wy: number; wz: number;
  /** Seconds before this block lets go (the top ones go first). */
  delay: number;
  landed: boolean; rest: boolean;
}

function mulberry32(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The tower falls towards `dir` (+1 or -1). The blocks fly off from where they stand: the higher, the farther, the top ones first. They land within about two units of the tower (the
 * camera shows about that much room beside it: a crash must stay on screen) and spread in depth too, the layers taking turns to go towards and away from the camera.
 */
export function crashBodies(layers: number, dir: 1 | -1, seed: number): Body[] {
  const rand = mulberry32(seed);
  const bodies: Body[] = [];
  for (let i = 0; i < blocksIn(layers); i++) {
    const s = slotOf(i);
    const layer = i < 2 ? 0 : i - 1;
    bodies.push({
      ...s,
      vx: dir * (0.3 + 0.12 * layer + 0.2 * rand()), vy: 1.2 + 1.5 * rand(), vz: (layer % 2 ? 0.45 : -0.45) + (rand() - 0.5) * 1.8,
      wx: (rand() - 0.5) * 9, wy: (rand() - 0.5) * 6, wz: (rand() - 0.5) * 9,
      delay: (layers - layer) * 0.06, landed: false, rest: false,
    });
  }
  return bodies;
}

/** Move one falling block on by `dt`: gravity, the floor (it bounces, loses speed, turns flat), the room's edges. */
export function stepBody(b: Body, dt: number): void {
  if (b.rest) return;
  if (b.delay > 0) { b.delay -= dt; return; }
  b.vy -= GRAVITY * dt;
  b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
  b.rx += b.wx * dt; b.ry += b.wy * dt; b.rz += b.wz * dt;
  if (b.x < -X_BOUND) { b.x = -X_BOUND; b.vx = Math.abs(b.vx) * 0.4; }
  if (b.x > X_BOUND) { b.x = X_BOUND; b.vx = -Math.abs(b.vx) * 0.4; }
  if (b.z < Z_MIN) { b.z = Z_MIN; b.vz = Math.abs(b.vz) * 0.4; }
  if (b.z > Z_MAX) { b.z = Z_MAX; b.vz = -Math.abs(b.vz) * 0.4; }
  const floor = restY(b.rx, b.rz);
  if (b.y <= floor) {
    if (b.vy < -0.8) b.vy = -b.vy * 0.35; else b.vy = 0;
    b.landed = true;
  }
  if (b.landed && b.y <= restY(b.rx, b.rz) + 1e-6) {
    const damp = Math.exp(-5 * dt), slide = Math.exp(-4 * dt), flat = Math.min(1, 12 * dt);
    b.wx *= damp; b.wy *= damp; b.wz *= damp;
    b.vx *= slide; b.vz *= slide;
    b.rx += (snapHalfPi(b.rx) - b.rx) * flat;
    b.rz += (snapHalfPi(b.rz) - b.rz) * flat;
    b.y = restY(b.rx, b.rz);
    if (Math.abs(b.vx) + Math.abs(b.vz) < 0.15 && Math.abs(b.vy) < 0.1 && Math.abs(b.rx - snapHalfPi(b.rx)) < 0.01 && Math.abs(b.rz - snapHalfPi(b.rz)) < 0.01) {
      b.rx = snapHalfPi(b.rx); b.rz = snapHalfPi(b.rz); b.y = H;
      b.vx = b.vy = b.vz = b.wx = b.wy = b.wz = 0; b.rest = true;
    }
  }
}

/** Keep two blocks from sitting inside each other: push them apart along the shorter way out (a block already at rest does not move, the other takes it all). */
export function separate(bodies: Body[]): void {
  for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
    const a = bodies[i]!, b = bodies[j]!;
    if (a.delay > 0 || b.delay > 0 || (a.rest && b.rest)) continue;
    if (Math.abs(a.y - b.y) > BLOCK * 0.9) continue;
    const ox = BLOCK - Math.abs(a.x - b.x), oz = BLOCK - Math.abs(a.z - b.z);
    if (ox <= 0 || oz <= 0) continue;
    const share = a.rest || b.rest ? 1 : 0.5;
    const axis = ox < oz ? "x" : "z";
    const over = axis === "x" ? ox : oz;
    const away = a[axis] <= b[axis] ? -1 : 1;                 // the way block a moves
    if (!a.rest) a[axis] += away * over * share;
    if (!b.rest) b[axis] -= away * over * share;
  }
}

// ---- the rebuild -----------------------------------------------------------------------------------------------------------

/** After the last block has stopped, the mess stays this long before the blocks fly home. */
export const REST_HOLD_S = 1.4;
/** A crash that has not settled by now is settled for it. */
export const CRASH_MAX_S = 8;
const REBUILD_STAGGER_S = 0.1, REBUILD_S = 0.75;
const easeInOut = (k: number) => k * k * (3 - 2 * k);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export type TowerPhase = "standing" | "crashing" | "rebuilding";
export type StackResult =
  | { kind: "added"; layers: number; note: number; landsIn: number }
  | { kind: "crash" }
  | { kind: "busy" };

export function createTower(opts: { crashMaxS?: number } = {}) {
  const crashMaxS = opts.crashMaxS ?? CRASH_MAX_S;
  let layers = START_LAYERS;
  let phase: TowerPhase = "standing";
  let clock = 0;
  const dropAge: number[] = Array(BLOCK_COUNT).fill(Infinity);
  let swayAge = Infinity;
  let swayLayers = START_LAYERS;
  let crashes = 0;
  let bodies: Body[] = [];
  let restedFor = 0;
  let crashAge = 0;
  let rebuildAge = 0;
  let from: Pose[] = [];
  const out: BlockPose[] = Array.from({ length: BLOCK_COUNT }, () => ({ visible: false, scale: 1, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 }));

  function write(i: number, p: Pose, visible = true, scale = 1) {
    const o = out[i]!;
    o.visible = visible; o.scale = scale;
    o.x = p.x; o.y = p.y; o.z = p.z; o.rx = p.rx; o.ry = p.ry; o.rz = p.rz;
  }

  function compose() {
    if (phase === "standing") {
      for (let i = 0; i < BLOCK_COUNT; i++) {
        if (i > layers) { write(i, slotOf(START_LAYERS), false); continue; }
        const s = slotOf(i);
        const w = sway(swayLayers, s.y, swayAge), n = nervous(layers, s.y, clock);
        write(i, { x: s.x + w.dx + n.dx, y: s.y + dropOffset(dropAge[i]!), z: s.z, rx: 0, ry: s.ry, rz: w.rz + n.rz });
      }
    } else if (phase === "crashing") {
      for (let i = 0; i < BLOCK_COUNT; i++) {
        const b = bodies[i];
        if (!b) write(i, slotOf(START_LAYERS), false); else write(i, b);
      }
    } else {
      for (let i = 0; i < BLOCK_COUNT; i++) {
        const f = from[i];
        if (!f) { write(i, slotOf(START_LAYERS), false); continue; }
        const k = Math.max(0, Math.min(1, (rebuildAge - i * REBUILD_STAGGER_S) / REBUILD_S));
        const e = easeInOut(k);
        const to = slotOf(i <= START_LAYERS ? i : START_LAYERS);
        const arc = 0.9 * Math.sin(Math.PI * e);
        const visible = i <= START_LAYERS ? true : k < 1;
        write(i, { x: lerp(f.x, to.x, e), y: lerp(f.y, to.y, e) + arc, z: lerp(f.z, to.z, e), rx: lerp(f.rx, to.rx, e), ry: lerp(f.ry, to.ry, e), rz: lerp(f.rz, to.rz, e) }, visible, i <= START_LAYERS ? 1 : 1 - e);
      }
    }
  }
  compose();

  return {
    get phase(): TowerPhase { return phase; },
    get layers(): number { return layers; },
    get poses(): readonly BlockPose[] { return out; },
    /** A tap: add a block on top, or (on a full tower) bring it all down. Nothing while it is already falling or being rebuilt. */
    stack(): StackResult {
      if (phase !== "standing") return { kind: "busy" };
      if (layers >= MAX_LAYERS) {
        crashes++;
        bodies = crashBodies(layers, crashes % 2 === 1 ? 1 : -1, 1000 + crashes);
        restedFor = 0; crashAge = 0;
        phase = "crashing";
        compose();
        return { kind: "crash" };
      }
      layers++;
      dropAge[layers] = 0;
      swayLayers = layers;
      compose();
      return { kind: "added", layers, note: TOWER_NOTES[layers - 1]!, landsIn: DROP_LAND_S };
    },
    update(dt: number): void {
      const step = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0;          // a tab left in the background, or a clock gone wrong, never skips or breaks the animation
      clock += step;
      if (phase === "standing") {
        for (let i = 0; i <= layers; i++) {
          const prev = dropAge[i]!;
          if (!Number.isFinite(prev)) continue;
          const next = prev + step;
          dropAge[i] = next;
          if (prev < DROP_LAND_S && next >= DROP_LAND_S) swayAge = next - DROP_LAND_S;     // it landed: the tower wobbles
          if (next > DROP_LAND_S + BOUNCE_S + 0.01) dropAge[i] = Infinity;
        }
        if (Number.isFinite(swayAge)) { swayAge += step; if (swayAge > SWAY_S) swayAge = Infinity; }
      } else if (phase === "crashing") {
        let left = step;
        while (left > 1e-9) {
          const s = Math.min(left, 1 / 120);
          for (const b of bodies) stepBody(b, s);
          separate(bodies);
          left -= s;
        }
        crashAge += step;
        if (crashAge > crashMaxS) for (const b of bodies) { b.delay = 0; b.rx = snapHalfPi(b.rx); b.rz = snapHalfPi(b.rz); b.y = H; b.vx = b.vy = b.vz = b.wx = b.wy = b.wz = 0; b.rest = true; }   // never stuck: after this long everything lies where it is
        if (bodies.every((b) => b.rest)) {
          restedFor += step;
          if (restedFor >= REST_HOLD_S) { from = bodies.map((b) => ({ x: b.x, y: b.y, z: b.z, rx: b.rx, ry: b.ry, rz: b.rz })); rebuildAge = 0; phase = "rebuilding"; }
        } else restedFor = 0;
      } else {
        rebuildAge += step;
        if (rebuildAge >= (from.length - 1) * REBUILD_STAGGER_S + REBUILD_S) {
          layers = START_LAYERS; swayAge = Infinity; swayLayers = START_LAYERS;
          dropAge.fill(Infinity);
          phase = "standing";
        }
      }
      compose();
    },
  };
}
export type Tower = ReturnType<typeof createTower>;

// ---- the meshes ------------------------------------------------------------------------------------------------------------

/**
 * The tower as the world's `blocks` prop: eight lettered blocks (`mat(letter, colour)` makes each one's material), of which the starting pile shows. `userData.stack()` is a tap
 * (returns what happened), `userData.tick(t, dt)` runs every frame, `userData.tower` and `userData.blocks` are there for the tests and the e2e. The blocks nobody has stacked yet are
 * parked, hidden, on top of the pile, so the prop's footprint (what a tap can hit) is the pile.
 */
export function buildBlockTower(x: number, z: number, mat: (letter: string, colour: string) => THREE.Material): THREE.Group {
  const g = new T.Group();
  g.position.set(x, 0, z);
  const tower = createTower();
  const blocks: THREE.Mesh[] = [];
  for (let i = 0; i < BLOCK_COUNT; i++) {
    const m = M(new T.BoxGeometry(BLOCK, BLOCK, BLOCK), mat(BLOCK_LETTERS[i]!, BLOCK_COLORS[i]!), 0, 0, 0);
    m.rotation.order = "YXZ";
    g.add(m);
    blocks.push(m);
  }
  const apply = () => {
    tower.poses.forEach((p, i) => {
      const m = blocks[i]!;
      m.visible = p.visible;
      m.position.set(p.x, p.y, p.z);
      m.rotation.set(p.rx, p.ry, p.rz);
      m.scale.setScalar(Math.max(0.001, p.scale));
    });
  };
  apply();
  g.userData.tower = tower;
  g.userData.blocks = blocks;
  g.userData.stack = (): StackResult => { const r = tower.stack(); apply(); return r; };
  g.userData.tick = (_t: number, dt: number) => { tower.update(dt); apply(); };
  return g;
}
