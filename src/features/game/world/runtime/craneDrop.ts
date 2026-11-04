// The junkyard crane drops a crate (docs/specs/playful-interactions-spec.md section 6, Junkyard: "crane drop"). A tap on the big crane lets a wooden crate go from its jib: it falls, hits the ground with a
// clank, bounces twice and tips a little, lies there for a few seconds and shrinks away. A few can lie about at once; the oldest goes when a fourth drops. Pure numbers (`startCrate`, `stepCrate`) so a test
// can run the whole fall without a GPU, and a thin wrapper (`attachCraneDrop`) that gives the crane's group the `userData.stack()` / `userData.tick()` hooks propReactions.ts calls for a "stack" prop.
import * as THREE from "three";
import { CRATE, buildCrateMesh } from "./outdoorProps";

export const CRATE_G = 22;
const HALF = CRATE / 2;
export const RESTITUTION = 0.32;
/** How long a crate lies on the ground before it shrinks away, and how long that takes. */
export const CRATE_REST_S = 3.2;
export const CRATE_SHRINK_S = 0.45;
export const MAX_CRATES = 3;
/** The jib of the crane in world.ts (`cranebg`): where the crate lets go (relative to the crane's x) and how high. */
export const JIB_DX = -3.4;
export const JIB_Y = 8.6;
/** Where it lands in depth: in the lane, so it is seen next to where the toy walks. */
export const LAND_Z = -1.0;

export interface CrateState { y: number; vy: number; tilt: number; vtilt: number; bounces: number; resting: boolean; restFor: number; scale: number; done: boolean }

export const startCrate = (y = JIB_Y): CrateState => ({ y, vy: 0, tilt: 0.25, vtilt: -0.3, bounces: 0, resting: false, restFor: 0, scale: 1, done: false });

/** Seconds a crate takes to fall from `y` to the ground (for the sound to land with it). */
export const fallTime = (y = JIB_Y) => Math.sqrt((2 * Math.max(0, y - HALF)) / CRATE_G);

/** Move one crate on by `dt`: gravity, a bounce (it keeps a third of its speed, and settles its tilt), rest, shrink. Returns a NEW state. */
export function stepCrate(c: CrateState, dt: number): CrateState {
  const n = { ...c };
  let left = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0;
  while (left > 1e-9 && !n.done) {
    const d = Math.min(1 / 120, left);
    left -= d;
    if (!n.resting) {
      n.vy -= CRATE_G * d;
      n.y += n.vy * d;
      n.tilt += n.vtilt * d;
      if (n.y <= HALF) {
        n.y = HALF;
        if (n.vy < -1.5) { n.vy = -n.vy * RESTITUTION; n.bounces++; n.vtilt = -n.vtilt * 0.6; n.tilt *= 0.5; } else { n.vy = 0; n.resting = true; n.tilt = 0; n.vtilt = 0; }
      }
    } else if (n.restFor < CRATE_REST_S) {
      n.restFor += d;
    } else {
      n.scale = Math.max(0, n.scale - d / CRATE_SHRINK_S);
      if (n.scale <= 0) n.done = true;
    }
  }
  return n;
}

interface Live { mesh: THREE.Group; st: CrateState }

/** Give the crane's group the hooks: `stack()` drops a crate, `tick(t, dt)` moves the crates. Crates live in the world root (the crane's parent), so a world change takes them away. */
export function attachCraneDrop(crane: THREE.Group, build: () => THREE.Group = buildCrateMesh): THREE.Group {
  const live: Live[] = [];
  const drop = () => {
    const root = crane.parent;
    if (!root) return { kind: "busy" as const };
    if (live.length >= MAX_CRATES) { const old = live.shift()!; old.mesh.parent?.remove(old.mesh); }
    const mesh = build();
    mesh.position.set(crane.position.x + JIB_DX, JIB_Y, LAND_Z + (live.length % 2) * 0.5);
    mesh.userData.noPick = true;
    root.add(mesh);
    live.push({ mesh, st: startCrate() });
    return { kind: "added" as const, layers: live.length, note: 196 + live.length * 40, landsIn: fallTime(), sfx: "clank" as const };
  };
  crane.userData.stack = drop;
  crane.userData.crates = live;
  crane.userData.tick = (_t: number, dt: number) => {
    for (let i = live.length - 1; i >= 0; i--) {
      const l = live[i]!;
      l.st = stepCrate(l.st, dt);
      l.mesh.position.y = l.st.y;
      l.mesh.rotation.z = l.st.tilt;
      l.mesh.scale.setScalar(Math.max(0.001, l.st.scale));
      if (l.st.done) { l.mesh.parent?.remove(l.mesh); live.splice(i, 1); }
    }
  };
  return crane;
}
