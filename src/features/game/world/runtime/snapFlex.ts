// The Snap (3+) Kip's "fake rigging", ported from the Kip bench so the game's character moves exactly like the demo's (parts/kip/viewer/kip-rig.js `makeFlexSnapLimb`, and
// parts/kip/viewer/kip-bench.js `applySnapJointOverrides`). Dan, 2026-11-04: "if snap, remember in the game we can use fake rigging like in the kip demo so animations are mapped properly".
//
// The Snap figure's arms and legs are each ONE printed piece (snap_arm.stl, snap_leg.stl). A baked Mixamo clip bends a limb at the elbow and the knee. So the one-piece mesh is bent
// in software: every vertex near mid-limb is rotated about the elbow (or knee) by a smooth fraction of the joint's rotation (a Rodrigues rotation, normals too), and the hand
// (or boot) is moved to where the bent sleeve now ends. The printable part is never cut up; only its picture bends.
//
//   makeFlexLimb   the one-piece geometry, cloned, with a `deform(q)` that bends it about its mid-point.
//   solveSnapArm   from the clip's shoulder / elbow / wrist rotations: the shoulder to use, how far to bend the sleeve, and where the hand goes.
//   solveSnapLeg   the same for hip / knee / ankle.
//
// Pure: three.js maths only, no DOM, no scene. All numbers are the bench's own (rig millimetres, the CAD frame: +Y up, +Z forward, +X the figure's left).
import * as THREE from "three";

/** How much of a joint's rotation bends the sleeve when the figure is assembled (the bench's `flexFactor`: 1 minus explode amount, times 0.94). */
export const FLEX_ASSEMBLED = 0.94;

const deg = THREE.MathUtils.degToRad;
/** The wrist cuff's own tilt at rest (the bench's `snapCuffQuat`): hands sit 11 degrees forward of the sleeve. */
export const SNAP_CUFF_Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(deg(-11), 0, 0));
/** `snap_arm.stl` has about 15 degrees of forward elbow bend sculpted in; flexing subtracts it so Snap hands line up with Pro hands (the bench's `snapArmRestInvQuat`). */
export const SNAP_ARM_REST_INV_Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(deg(15), 0, 0));

/** Where the bend happens, per limb (bench numbers): the offset the mesh is placed at, the mid-limb point it bends about, and half the width of the smooth zone. */
export const SNAP_ARM_FLEX = { offsetY: -34.6, midY: -17.5, midZ: 1.2, band: 8.0 } as const;
export const SNAP_LEG_FLEX = { offsetY: -38.6, midY: -19.6, midZ: 0.0, band: 8.5 } as const;

export interface FlexLimb {
  /** A private copy of the source geometry, already turned upright and placed: add it to a Mesh with NO rotation of its own. Dispose it with the rig. */
  geometry: THREE.BufferGeometry;
  /** Bend the limb about its mid-point by the rotation `q` of its distal half (identity restores the rest shape). */
  deform(q: THREE.Quaternion): void;
}

/**
 * The bench's `makeFlexSnapLimb`: clone `src` (an STL in print orientation), stand it up (rotate -90 degrees about X), place it `offsetY` down, and precompute how much each vertex
 * follows the distal rotation (0 above the bend zone, 1 below it, a smoothstep between, `band` mm either side of `midY`).
 */
export function makeFlexLimb(src: THREE.BufferGeometry, offsetY: number, midY: number, midZ: number, band: number): FlexLimb {
  const g = src.index ? src.toNonIndexed() : src.clone();
  g.rotateX(-Math.PI / 2);
  g.translate(0, offsetY, 0);
  // The bend runs every frame a clip with joints plays (the walk, the idle, every dance), over a triangle soup of 29,000 to 30,000 vertices a limb, and uploads what it changed. So the triangles
  // are put in THREE runs, once: the ones that never move (every vertex above the bend zone: about a third of the sleeve), the ones in or touching the zone (each vertex turns by its own share),
  // and the ones wholly below it (every vertex turns by the whole rotation: one sine and one cosine for all of them). The first run is never touched again and never uploaded; the second uses a
  // table of the rotation's sines and cosines at 64 steps of its share instead of a pair of trigonometric calls a vertex; the third needs no table at all. Triangle order does not matter to
  // drawing; the vertex order inside each triangle is kept. (Equal to the plain loop over every vertex to within 0.001 mm: tests/snap-flex.test.ts runs both.)
  const nTri = Math.floor((g.attributes.position as THREE.BufferAttribute).count / 3);
  const p0 = g.attributes.position as THREE.BufferAttribute;
  const weight = (y: number) => THREE.MathUtils.smoothstep(midY - y, -band, band);
  const kind = new Uint8Array(nTri);        // 0 never moves, 1 in the zone, 2 wholly below it
  const counts = [0, 0, 0];
  for (let t = 0; t < nTri; t++) {
    let still = true, whole = true;
    for (let k = 0; k < 3; k++) { const w = weight(p0.getY(t * 3 + k)); if (w > 1e-4) still = false; if (w < 1) whole = false; }
    const c = still ? 0 : whole ? 2 : 1;
    kind[t] = c; counts[c]!++;
  }
  const start = [0, counts[0]!, counts[0]! + counts[1]!];
  const order = new Uint32Array(nTri);      // the new place of each old triangle
  const fill = [start[0]!, start[1]!, start[2]!];
  for (let t = 0; t < nTri; t++) order[fill[kind[t]!]!++] = t;
  const source = new Uint32Array(nTri * 3);  // new vertex -> the vertex it was (so a test can hold the new bend to the old loop)
  for (let n = 0; n < nTri; n++) for (let k = 0; k < 3; k++) source[n * 3 + k] = order[n]! * 3 + k;
  for (const name of Object.keys(g.attributes)) {
    const a = g.attributes[name] as THREE.BufferAttribute;
    const out = new (a.array.constructor as new (n: number) => Float32Array)(a.array.length);
    const size = a.itemSize;
    for (let v = 0; v < nTri * 3; v++) for (let c = 0; c < size; c++) out[v * size + c] = (a.array as Float32Array)[source[v]! * size + c]!;
    g.setAttribute(name, new THREE.BufferAttribute(out, size, a.normalized));
  }
  g.userData.flexSource = source;
  const posAttr = g.attributes.position as THREE.BufferAttribute;
  const normAttr = g.attributes.normal as THREE.BufferAttribute | undefined;
  const restPos = new Float32Array(posAttr.array as ArrayLike<number>);
  const restNorm = normAttr ? new Float32Array(normAttr.array as ArrayLike<number>) : null;
  const count = posAttr.count;
  const weights = new Float32Array(count);
  for (let i = 0; i < count; i++) weights[i] = weight(restPos[i * 3 + 1]!);
  const zoneStart = counts[0]! * 3, wholeStart = (counts[0]! + counts[1]!) * 3;   // vertex indices where the second and the third run begin
  let dirty = false;
  let lx = 0, ly = 0, lz = 0, lw = 1;       // the rotation of the last bend, so a pose held still does no work
  const STEPS = 64;
  const tabC = new Float64Array(STEPS + 2), tabS = new Float64Array(STEPS + 2);

  /** Tell the renderer only the moving runs changed. */
  function upload(): void {
    for (const a of [posAttr, normAttr]) {
      if (!a) continue;
      a.clearUpdateRanges();
      if (zoneStart > 0) a.addUpdateRange(zoneStart * 3, (count - zoneStart) * 3);
      a.needsUpdate = true;
    }
  }

  function deform(qDistal: THREE.Quaternion): void {
    let qx = qDistal.x, qy = qDistal.y, qz = qDistal.z, qw = qDistal.w;
    if (qw < 0) { qx = -qx; qy = -qy; qz = -qz; qw = -qw; }
    const sinHalf = Math.hypot(qx, qy, qz);
    if (sinHalf < 1e-4) {
      if (dirty) {
        const pa = posAttr.array as Float32Array;
        pa.set(restPos.subarray(zoneStart * 3), zoneStart * 3);
        if (normAttr && restNorm) (normAttr.array as Float32Array).set(restNorm.subarray(zoneStart * 3), zoneStart * 3);
        upload();
        dirty = false;
      }
      lx = 0; ly = 0; lz = 0; lw = 1;
      return;
    }
    if (dirty && qx === lx && qy === ly && qz === lz && qw === lw) return;   // the same bend as last time: the buffers already hold it
    lx = qx; ly = qy; lz = qz; lw = qw;
    const ux = qx / sinHalf, uy = qy / sinHalf, uz = qz / sinHalf;
    const theta = 2.0 * Math.acos(Math.min(1.0, qw));
    const pArr = posAttr.array as Float32Array;
    const nArr = normAttr ? (normAttr.array as Float32Array) : null;
    for (let k = 0; k <= STEPS + 1; k++) { const a = (k / STEPS) * theta; tabC[k] = Math.cos(a); tabS[k] = Math.sin(a); }
    // run two: in or touching the zone (a vertex above it stays at rest, the others turn by their share of the rotation)
    for (let i = zoneStart; i < wholeStart; i++) {
      const w = weights[i]!;
      const i3 = i * 3;
      if (w <= 1e-4) {
        pArr[i3] = restPos[i3]!; pArr[i3 + 1] = restPos[i3 + 1]!; pArr[i3 + 2] = restPos[i3 + 2]!;
        if (nArr && restNorm) { nArr[i3] = restNorm[i3]!; nArr[i3 + 1] = restNorm[i3 + 1]!; nArr[i3 + 2] = restNorm[i3 + 2]!; }
        continue;
      }
      const f = w * STEPS, k0 = f | 0, fr = f - k0;
      const c = tabC[k0]! + (tabC[k0 + 1]! - tabC[k0]!) * fr, s = tabS[k0]! + (tabS[k0 + 1]! - tabS[k0]!) * fr, omc = 1.0 - c;
      const vx = restPos[i3]!, vy = restPos[i3 + 1]! - midY, vz = restPos[i3 + 2]! - midZ;
      const vDot = ux * vx + uy * vy + uz * vz;
      pArr[i3] = vx * c + (uy * vz - uz * vy) * s + ux * vDot * omc;
      pArr[i3 + 1] = midY + vy * c + (uz * vx - ux * vz) * s + uy * vDot * omc;
      pArr[i3 + 2] = midZ + vz * c + (ux * vy - uy * vx) * s + uz * vDot * omc;
      if (nArr && restNorm) {
        const nx = restNorm[i3]!, ny = restNorm[i3 + 1]!, nz = restNorm[i3 + 2]!;
        const nDot = ux * nx + uy * ny + uz * nz;
        nArr[i3] = nx * c + (uy * nz - uz * ny) * s + ux * nDot * omc;
        nArr[i3 + 1] = ny * c + (uz * nx - ux * nz) * s + uy * nDot * omc;
        nArr[i3 + 2] = nz * c + (ux * ny - uy * nx) * s + uz * nDot * omc;
      }
    }
    // run three: wholly below the zone, every vertex turns by the whole rotation
    const c = Math.cos(theta), s = Math.sin(theta), omc = 1.0 - c;
    for (let i = wholeStart; i < count; i++) {
      const i3 = i * 3;
      const vx = restPos[i3]!, vy = restPos[i3 + 1]! - midY, vz = restPos[i3 + 2]! - midZ;
      const vDot = ux * vx + uy * vy + uz * vz;
      pArr[i3] = vx * c + (uy * vz - uz * vy) * s + ux * vDot * omc;
      pArr[i3 + 1] = midY + vy * c + (uz * vx - ux * vz) * s + uy * vDot * omc;
      pArr[i3 + 2] = midZ + vz * c + (ux * vy - uy * vx) * s + uz * vDot * omc;
      if (nArr && restNorm) {
        const nx = restNorm[i3]!, ny = restNorm[i3 + 1]!, nz = restNorm[i3 + 2]!;
        const nDot = ux * nx + uy * ny + uz * nz;
        nArr[i3] = nx * c + (uy * nz - uz * ny) * s + ux * nDot * omc;
        nArr[i3 + 1] = ny * c + (uz * nx - ux * nz) * s + uy * nDot * omc;
        nArr[i3 + 2] = nz * c + (ux * ny - uy * nx) * s + uz * nDot * omc;
      }
    }
    upload();
    dirty = true;
  }
  return { geometry: g, deform };
}

/** The joints the rig builder hands over so the driver can pose the Snap limbs (the game's `rig.snap`; left first, then right, as `rig.arms` and `rig.feet`). */
export interface SnapArmHandles {
  flex: FlexLimb;
  /** The bent sleeve's end: it carries the hand. */
  fore: THREE.Object3D;
  hand: THREE.Object3D;
  /** What a thing in Kip's hand needs (see `makeHandFollow`). Absent on a rig that holds nothing. */
  follow?: HandFollow;
}
/**
 * Things Kip holds are attached to the arm's holder (`rig.arms[i]`, the shoulder), tuned for an arm that hangs straight. Once the elbow bends the hand is somewhere else, and a thing stuck to
 * the holder would hang where the straight hand was. So while a joint clip plays the HOLDER goes with the hand (it is moved by how far the hand has moved from its rest frame) and a
 * `counter` group between the holder and the sleeve undoes that for the sleeve, which stays exactly where the clip put it. The held thing is still a child of the holder, so nothing that
 * attaches, checks or removes it has to know. At rest the holder is at its own place and the counter is the identity, which is the rigid arm.
 */
export interface HandFollow {
  holder: THREE.Object3D;
  counter: THREE.Object3D;
  /** The holder's place at rest. */
  restPos: THREE.Vector3;
  /** The inverse of the hand's frame at rest, in the counter's space. */
  restInv: THREE.Matrix4;
}
export interface SnapLegHandles { flex: FlexLimb; /** The bent sleeve's end: it carries the foot. */ lower: THREE.Object3D; foot: THREE.Object3D; /** The boot's mesh, for finding the sole. */ boot: THREE.Object3D }
export interface SnapRigHandles { arms: [SnapArmHandles, SnapArmHandles]; legs: [SnapLegHandles, SnapLegHandles] }

/** What to set on the rig's arm joints (all in the arm's own CAD frame). */
export interface SnapArmSolution {
  /** The shoulder's local rotation to use (the clip's, plus the small share of the elbow the sleeve does not bend). */
  shoulder: THREE.Quaternion;
  /** The rotation to pass to the sleeve's `deform`. */
  flex: THREE.Quaternion;
  /** Where the bent sleeve ends: the position and rotation of the forearm group that carries the hand. */
  cuffPos: THREE.Vector3;
  cuffQ: THREE.Quaternion;
  /** The hand inside that group: its rotation (the clip's wrist, plus the elbow's other small share) and its fixed offset. */
  handQ: THREE.Quaternion;
  handPos: THREE.Vector3;
}
export const newSnapArmSolution = (): SnapArmSolution => ({ shoulder: new THREE.Quaternion(), flex: new THREE.Quaternion(), cuffPos: new THREE.Vector3(), cuffQ: new THREE.Quaternion(), handQ: new THREE.Quaternion(), handPos: new THREE.Vector3(0, -0.5, 0) });

const _res = new THREE.Quaternion();
const _rel = new THREE.Quaternion();
const _id = new THREE.Quaternion();

/**
 * The bench's arm half of `applySnapJointOverrides`. `shoulder`, `elbow`, `wrist` are the clip's local rotations; `flexFactor` is 0 (a rigid sleeve) to 1 (all of the elbow bends it).
 * The part of the elbow the sleeve does not bend, `(1 - flexFactor) * 0.55` of it, goes to the shoulder and the wrist instead, so a rigid sleeve still points the hand about right.
 */
export function solveSnapArm(shoulder: THREE.Quaternion, elbow: THREE.Quaternion, wrist: THREE.Quaternion, flexFactor: number, out: SnapArmSolution): SnapArmSolution {
  const ff = Math.max(0, Math.min(1, flexFactor));
  _res.copy(_id.identity()).slerp(elbow, (1.0 - ff) * 0.55);
  out.shoulder.copy(shoulder).multiply(_res);
  out.handQ.copy(wrist).premultiply(_res);
  _rel.multiplyQuaternions(SNAP_ARM_REST_INV_Q, elbow);
  out.flex.copy(_id.identity()).slerp(_rel, ff);
  // the wrist cuff's centre: the pivot (0, -17.5, 1.2) plus the rest offset (0, -17.5, 2.6) turned by the bend (rest = (0, -35, 3.8))
  out.cuffPos.set(0, -17.5, 2.6).applyQuaternion(out.flex);
  out.cuffPos.y += -17.5;
  out.cuffPos.z += 1.2;
  out.cuffQ.multiplyQuaternions(out.flex, SNAP_CUFF_Q);
  out.handPos.set(0, -0.5, 0);
  return out;
}

/** What to set on the rig's leg joints (all in the leg's own CAD frame). */
export interface SnapLegSolution {
  hip: THREE.Quaternion;
  flex: THREE.Quaternion;
  /** Where the bent sleeve ends: the position and rotation of the lower-leg group that carries the boot's foot joint. */
  anklePos: THREE.Vector3;
  ankleQ: THREE.Quaternion;
  /** The foot inside that group: its rotation (the clip's ankle, plus the knee's other small share) and its fixed offset. */
  footQ: THREE.Quaternion;
  footPos: THREE.Vector3;
}
export const newSnapLegSolution = (): SnapLegSolution => ({ hip: new THREE.Quaternion(), flex: new THREE.Quaternion(), anklePos: new THREE.Vector3(), ankleQ: new THREE.Quaternion(), footQ: new THREE.Quaternion(), footPos: new THREE.Vector3(0, -0.4, -1.5) });

/** The bench's leg half: the knee bends the sleeve about (0, -19.6, 0); a rigid sleeve passes `(1 - flexFactor) * 0.35` of the knee to the hip and the ankle. */
export function solveSnapLeg(hip: THREE.Quaternion, knee: THREE.Quaternion, ankle: THREE.Quaternion, flexFactor: number, out: SnapLegSolution): SnapLegSolution {
  const ff = Math.max(0, Math.min(1, flexFactor));
  _res.copy(_id.identity()).slerp(knee, (1.0 - ff) * 0.35);
  out.hip.copy(hip).multiply(_res);
  out.footQ.copy(ankle).premultiply(_res);
  out.flex.copy(_id.identity()).slerp(knee, ff);
  out.anklePos.set(0, -19.6, 0.0).applyQuaternion(out.flex);
  out.anklePos.y += -19.6;
  out.ankleQ.copy(out.flex);
  out.footPos.set(0, -0.4, -1.5);
  return out;
}

const _m = new THREE.Matrix4();
const _d = new THREE.Matrix4();
const _dp = new THREE.Vector3();
const _dq = new THREE.Quaternion();
const _ds = new THREE.Vector3();
const _sq = new THREE.Quaternion();

/** The hand's frame in the counter's space: the chain from the counter's children down to the hand, multiplied out. */
function handFrame(hand: THREE.Object3D, counter: THREE.Object3D, out: THREE.Matrix4): THREE.Matrix4 {
  out.identity();
  for (let o: THREE.Object3D | null = hand; o && o !== counter; o = o.parent) {
    o.updateMatrix();
    out.premultiply(o.matrix);
  }
  return out;
}

/**
 * Set up the hand-follow for an arm whose joints are at REST: `counter` is a child of `holder`, the sleeve and `hand` hang below `counter`. Remembers the holder's place and the hand's rest frame.
 * Returns what to keep in the arm's handles.
 */
export function makeHandFollow(holder: THREE.Object3D, counter: THREE.Object3D, hand: THREE.Object3D): HandFollow {
  return { holder, counter, restPos: holder.position.clone(), restInv: handFrame(hand, counter, new THREE.Matrix4()).invert() };
}

/**
 * Move the holder with the hand, and the counter against it. Call after the arm's joints are set. `shoulder` is the holder's orientation from the clip (what its quaternion is now); the
 * holder ends up at the shoulder's pose then moved by how far the hand has moved from rest, in the holder's own frame.
 */
export function followHand(a: SnapArmHandles, shoulder: THREE.Quaternion): void {
  const f = a.follow;
  if (!f) return;
  _d.multiplyMatrices(handFrame(a.hand, f.counter, _m), f.restInv).decompose(_dp, _dq, _ds); // how far the hand has moved from rest (a rigid move)
  _sq.copy(shoulder); // `shoulder` is usually the holder's own quaternion, which is about to change
  f.holder.position.copy(_dp).applyQuaternion(_sq).add(f.restPos);
  f.holder.quaternion.copy(_sq).multiply(_dq);
  f.counter.quaternion.copy(_dq).invert();
  f.counter.position.copy(_dp).applyQuaternion(f.counter.quaternion).negate();
}

/** The holder back at its place and the counter doing nothing: exactly the rigid arm. (The holder's orientation is the caller's.) */
export function releaseHand(a: SnapArmHandles): void {
  const f = a.follow;
  if (!f) return;
  f.holder.position.copy(f.restPos);
  f.counter.position.set(0, 0, 0);
  f.counter.quaternion.identity();
}

/** Put every Snap limb joint back to its rest: nothing bent, the hands and boots where the rigid limbs held them. */
// ---- the neck ----------------------------------------------------------------------------------------------------------------------------------

/**
 * How far below the head's own base the neck turret's foot is, mm (the head's `neck_turret_2x1` hangs from -7.4 up to the head's base; the foot is where it meets the torso's collar).
 * Dan, 2026-11-04: "we also need to add angles wrists and neck to kip". The head used to turn about its own base with the turret riding on it, so a tilt swung the turret's foot off the collar
 * and left a gap (the head looked to float over the shoulders). A head that carries `userData.hinge` (this point, in its own frame) and `userData.rest` (its origin at rest) now turns ABOUT the
 * hinge: the foot of the neck stays on the collar and the head swings on it as one stick, the way a neck does.
 */
export const NECK_FOOT_MM = 7.4;
const _hinge = new THREE.Vector3();
/** Put a head that has a neck hinge where its current rotation says it should be, so the hinge point does not move. Call it right after setting the head's quaternion. A head without hinge data is left alone. */
export function hingeHead(head: THREE.Object3D): void {
  const u = head.userData as { hinge?: THREE.Vector3; rest?: THREE.Vector3 };
  if (!u.hinge || !u.rest) return;
  _hinge.copy(u.hinge).applyQuaternion(head.quaternion);        // where the hinge point goes if the head only turned
  head.position.copy(u.rest).add(u.hinge).sub(_hinge);          // slide the head back by that, so the hinge itself stays put
}

export function resetSnapRig(sn: SnapRigHandles): void {
  const id = new THREE.Quaternion();
  for (const a of sn.arms) {
    a.flex.deform(id);
    a.fore.position.set(0, -35.0, 3.8);
    a.fore.quaternion.copy(SNAP_CUFF_Q);
    a.hand.position.set(0, -0.5, 0);
    a.hand.quaternion.identity();
    releaseHand(a);
  }
  for (const l of sn.legs) {
    l.flex.deform(id);
    l.lower.position.set(0, -39.2, 0);
    l.lower.quaternion.identity();
    l.foot.position.set(0, -0.4, -1.5);
    l.foot.quaternion.identity();
  }
}
