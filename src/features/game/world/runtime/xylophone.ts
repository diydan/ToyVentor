// The toy xylophone (docs/specs/playful-interactions-spec.md section 6): a rainbow of eight bars on a tilted rack, in the same chunky-plastic language as the other Toy Room props. Tap a BAR and it rings its note (it dips
// and wobbles); tap the FRAME and Kip plays a tune on it (toyRoomActs.ts). The bars are the pure part here (`barPose`, `barIndexOf`, the notes and colours); `buildXylophone` makes the meshes and gives the holder what
// propReactions.ts looks for: `userData.strikeBar(i)` (ring bar i: returns its pitch), `userData.tapPart(object)` (a tap on a mesh: ring its bar and return the pitch, or null for the frame) and `userData.tick(t)`.
import { T, M, rbox, plastic } from "./worldScene";
import type * as THREE from "three";

export const BAR_COUNT = 8;
/** A C major scale, low C to high C. */
export const XYLO_NOTES: readonly number[] = [262, 294, 330, 349, 392, 440, 494, 523];
export const XYLO_COLORS: readonly string[] = ["#ff5a4d", "#ff9d5c", "#ffd24d", "#5af0b0", "#52b7ff", "#7a7cff", "#c07aff", "#ff7ac0"];
export const BAR_SPACING = 0.42;
/** How long a struck bar rings (dips and wobbles), in seconds. */
export const BAR_RING_S = 0.6;
/** The bars are laid on a rack tilted so their top faces point up and towards the camera (+z), which sees them face on. */
export const RACK_TILT = 0.85;
/** The base plank the legs stand on: wide and deep, so there is a big, plain, visible target for "play me" that is not a bar. Its size, and how far it lifts everything above it. */
export const PLANK = { w: 4.4, h: 0.14, d: 1.9, z: 0.2 } as const;

/** A mallet: a thin wooden stick with a pink head, standing along +y from its handle end (y = 0) to the head. */
export const MALLET_LENGTH = 0.7;
export function buildMalletMesh(): THREE.Group {
  const g = new T.Group();
  g.add(M(new T.CylinderGeometry(0.02, 0.02, MALLET_LENGTH, 6), plastic("#b9854f", { roughness: 0.7 }), 0, MALLET_LENGTH / 2, 0));
  g.add(M(new T.SphereGeometry(0.06, 10, 8), plastic("#ff5aa8"), 0, MALLET_LENGTH, 0));
  return g;
}

/** Where bar i is along x, relative to the middle of the xylophone. */
export const barX = (i: number) => (i - (BAR_COUNT - 1) / 2) * BAR_SPACING;
/** How long bar i is: the low notes are the long bars. */
export const barLength = (i: number) => 1.3 - i * 0.085;

export interface BarPose { dy: number; rx: number }
/** How a bar sits `age` seconds after it was struck: it is pushed down at once, springs back and wobbles away. Before it was struck (age < 0) or once it has settled it is at rest. */
export function barPose(age: number): BarPose {
  if (!(age >= 0) || age >= BAR_RING_S) return { dy: 0, rx: 0 };
  const k = age / BAR_RING_S;
  return { dy: -0.07 * Math.exp(-k * 4) * Math.sin(age * 45), rx: 0.07 * Math.exp(-k * 6) * Math.sin(age * 55) };
}

/** Which bar a mesh belongs to (the nearest parent carrying `userData.bar`), or null for the frame and anything else. */
export function barIndexOf(obj: THREE.Object3D | null): number | null {
  for (let o: THREE.Object3D | null = obj; o; o = o.parent) if (typeof o.userData.bar === "number") return o.userData.bar as number;
  return null;
}

export function buildXylophone(x: number, z: number): THREE.Group {
  const g = new T.Group();
  g.position.set(x, 0, z);
  const wood = plastic("#8a5a3a", { roughness: 0.6 });
  const trim = plastic("#fff6ea", { roughness: 0.5 });
  // The base plank (a tap on it, like on the legs or the rails, is a tap on the frame: Kip plays), then four short legs standing on it and the rack: two rails the bars rest across, tilted back.
  const plank = M(rbox(PLANK.w, PLANK.h, PLANK.d, 0.05), plastic("#fff0d2", { roughness: 0.55 }), 0, PLANK.h / 2, PLANK.z);
  plank.name = "plank";
  g.add(plank);
  for (const lx of [-1.55, 1.55]) for (const lz of [-0.35, 0.35]) g.add(M(new T.CylinderGeometry(0.07, 0.08, 0.7, 10), wood, lx, PLANK.h + 0.35, lz));
  const rack = new T.Group();
  rack.position.set(0, PLANK.h + 1.05, 0);
  rack.rotation.x = RACK_TILT;
  g.add(rack);
  for (const rz of [-0.36, 0.36]) rack.add(M(rbox(3.7, 0.1, 0.12, 0.04), wood, 0, -0.04, rz));
  rack.add(M(rbox(0.12, 0.1, 0.95, 0.04), wood, -1.82, -0.04, 0));
  rack.add(M(rbox(0.12, 0.1, 0.95, 0.04), wood, 1.82, -0.04, 0));
  const bars: THREE.Group[] = [];
  for (let i = 0; i < BAR_COUNT; i++) {
    const bar = new T.Group();
    bar.position.set(barX(i), 0.04, 0);
    bar.userData.bar = i;
    bar.add(M(rbox(BAR_SPACING - 0.06, 0.09, barLength(i), 0.03), plastic(XYLO_COLORS[i]!, { roughness: 0.35 }), 0, 0, 0));
    for (const sz of [-1, 1]) bar.add(M(new T.SphereGeometry(0.025, 8, 6), trim, 0, 0.05, sz * (barLength(i) / 2 - 0.12)));      // the two pegs
    rack.add(bar);
    bars.push(bar);
  }
  // Two mallets lying on the front ledge (one group: Kip takes them in its hands while it plays, and `userData.mallets` lets the act hide these).
  const mallets = new T.Group();
  for (const mx of [-0.5, 0.5]) {
    const m = buildMalletMesh();
    m.rotation.z = -Math.PI / 2; m.position.set(mx * 1.2 - MALLET_LENGTH / 2, PLANK.h + 0.12, 0.62);
    mallets.add(m);
  }
  g.add(mallets);
  g.userData.mallets = mallets;
  const hits: number[] = Array(BAR_COUNT).fill(-Infinity);
  const pending: boolean[] = Array(BAR_COUNT).fill(false);
  g.userData.strikeBar = (i: number): number | null => {
    if (!Number.isInteger(i) || i < 0 || i >= BAR_COUNT) return null;
    pending[i] = true;
    return XYLO_NOTES[i]!;
  };
  g.userData.tapPart = (obj: THREE.Object3D): number | null => {
    const i = barIndexOf(obj);
    return i === null ? null : (g.userData.strikeBar as (i: number) => number | null)(i);
  };
  g.userData.tick = (t: number) => {
    for (let i = 0; i < BAR_COUNT; i++) {
      if (pending[i]) { hits[i] = t; pending[i] = false; }
      const p = barPose(t - hits[i]!);
      bars[i]!.position.y = 0.04 + p.dy;
      bars[i]!.rotation.x = p.rx;
    }
  };
  g.userData.bars = bars;
  return g;
}
