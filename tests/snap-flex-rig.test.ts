// The Mixamo driver's joint mode on a Snap rig (runtime/mixamo.ts `applyJoints`, runtime/snapFlex.ts): the structure is the game's own (stlRigLoader.ts), built here from the real flex
// geometry and plain groups, so the driver can be run without a browser. What this proves: nothing changes without joint data (the Xbot clips drive the rigid limbs exactly as before),
// a bent elbow or knee reaches the hand and the foot, a planted clip's lowest sole lands on the floor, and everything goes back to rest exactly. The real figure against the bench's
// figure is scripts/e2e-game-dance-rig.mjs.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CLIP_JOINT_KEYS, KIP_HIP_REST_MM, MixamoDriver, newPose, sampleClip, mixPose, type BakedClip, type ClipJoints } from "../src/features/game/world/runtime/mixamo";
import { SNAP_ARM_FLEX, SNAP_CUFF_Q, SNAP_LEG_FLEX, followHand, makeFlexLimb, makeHandFollow, newSnapArmSolution, solveSnapArm, type SnapArmHandles, type SnapRigHandles } from "../src/features/game/world/runtime/snapFlex";
import { KIP_HIP_MM } from "../src/features/game/world/runtime/stlRigLoader";

const S = 0.0185;
const Q = (x: number, y: number, z: number, deg: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(x, y, z).normalize(), THREE.MathUtils.degToRad(deg));

function limbBox(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(10, 10, 38, 1, 1, 38);
  g.translate(0, 0, 19);
  return g;
}

/** The game's Snap rig, structure for structure (stlRigLoader.ts), with boxes for meshes. */
function makeRig(opts: { follow?: boolean } = {}) {
  const world = new THREE.Group(); // the model the rig hangs in; its origin is the floor
  const g = new THREE.Group();
  world.add(g);
  const base = new THREE.Group();
  g.add(base);
  const head = new THREE.Group();
  head.position.set(0, 108 * S, 0);
  g.add(head);
  const arms: THREE.Object3D[] = [], feet: THREE.Object3D[] = [];
  const snapArms: SnapRigHandles["arms"] = [] as never, snapLegs: SnapRigHandles["legs"] = [] as never;
  for (const side of [1, -1] as const) {
    const holder = new THREE.Group();
    holder.position.set(0, 95 * S, -side * 18.2 * S);
    base.add(holder);
    const cad = new THREE.Group();
    cad.rotation.y = Math.PI / 2;
    cad.scale.setScalar(S);
    const counter = new THREE.Group(); // between the holder and the sleeve (stlRigLoader.ts `handCounter`)
    counter.add(cad);
    holder.add(counter);
    const flex = makeFlexLimb(limbBox(), SNAP_ARM_FLEX.offsetY, SNAP_ARM_FLEX.midY, SNAP_ARM_FLEX.midZ, SNAP_ARM_FLEX.band);
    cad.add(new THREE.Mesh(flex.geometry));
    const fore = new THREE.Group(); fore.position.set(0, -35, 3.8); fore.quaternion.copy(SNAP_CUFF_Q); cad.add(fore);
    const hand = new THREE.Group(); hand.position.set(0, -0.5, 0); fore.add(hand);
    arms.push(holder);
    (snapArms as unknown as unknown[]).push({ flex, fore, hand, ...(opts.follow === false ? {} : { follow: makeHandFollow(holder, counter, hand) }) });
  }
  for (const side of [1, -1] as const) {
    const foot = new THREE.Group();
    foot.position.set(0, 0, -side * 10.8 * S);
    base.add(foot);
    const hip = new THREE.Group();
    hip.position.y = KIP_HIP_MM * S;
    foot.add(hip);
    foot.userData.hip = hip;
    const legCad = new THREE.Group();
    legCad.rotation.y = Math.PI / 2;
    legCad.scale.setScalar(S);
    legCad.position.y = -KIP_HIP_MM * S;
    hip.add(legCad);
    const hipCad = new THREE.Group(); hipCad.position.y = KIP_HIP_MM; legCad.add(hipCad);
    const flex = makeFlexLimb(limbBox(), SNAP_LEG_FLEX.offsetY, SNAP_LEG_FLEX.midY, SNAP_LEG_FLEX.midZ, SNAP_LEG_FLEX.band);
    hipCad.add(new THREE.Mesh(flex.geometry));
    const lower = new THREE.Group(); lower.position.set(0, -39.2, 0); hipCad.add(lower);
    const fj = new THREE.Group(); fj.position.set(0, -0.4, -1.5); lower.add(fj);
    const boot = new THREE.Group(); boot.position.set(0, -KIP_HIP_MM + 39.6, 3.5); fj.add(boot);
    feet.push(foot);
    (snapLegs as unknown as unknown[]).push({ flex, lower, foot: fj, boot });
  }
  const rig = { g, slots: {}, wheels: [], legs: [], arms, feet, eyes: [], wings: [], type: "character", head, mixHipY: KIP_HIP_MM * S, snap: { arms: snapArms, legs: snapLegs } } as never;
  world.updateMatrixWorld(true);
  return { rig, world, g, snap: { arms: snapArms, legs: snapLegs }, head };
}

const ID4 = [0, 0, 0, 1];
function track(n: number, q: number[] | ((i: number) => number[])): Float32Array {
  const a = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) a.set(typeof q === "function" ? q(i) : q, i * 4);
  return a;
}
function neutral(name: string, frames = 4, dur = 1): BakedClip {
  return { name, duration: dur, loop: true, pose: false, frames, hips: new Float32Array(frames * 3), body: track(frames, ID4), head: track(frames, ID4), armL: new Float32Array(frames * 3).map((_, i) => (i % 3 === 1 ? -1 : 0)), armR: new Float32Array(frames * 3).map((_, i) => (i % 3 === 1 ? -1 : 0)), legL: new Float32Array(frames * 3).map((_, i) => (i % 3 === 1 ? -1 : 0)), legR: new Float32Array(frames * 3).map((_, i) => (i % 3 === 1 ? -1 : 0)) };
}
/** A clip with the bench's joint tracks: a bent left elbow and knee, a turned wrist, the hips dropped 6 mm. */
function jointClip(name: string, opts: { planted?: boolean; hipsY?: number } = {}): BakedClip {
  const n = 4;
  const c = neutral(name, n);
  const q = (x: number, y: number, z: number, d: number) => { const r = Q(x, y, z, d); return [r.x, r.y, r.z, r.w]; };
  const hipsMm = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) hipsMm.set([0, opts.hipsY ?? KIP_HIP_REST_MM, 0], i * 3);
  const J = {} as ClipJoints;
  for (const k of CLIP_JOINT_KEYS) J[k] = track(n, ID4);
  J.elbowL = track(n, q(1, 0, 0, -90));
  J.wristL = track(n, q(0, 1, 0, 30));
  J.kneeL = track(n, q(1, 0, 0, 60));
  J.hipL = track(n, q(1, 0, 0, -30));
  J.hipsMm = hipsMm;
  return { ...c, joints: J, planted: opts.planted ?? true };
}
function driver(extra: Record<string, BakedClip> = {}) {
  return new MixamoDriver({ idle: neutral("idle"), walk: neutral("walk"), ...extra });
}
const settle = (d: MixamoDriver, rig: never, seconds: number, speed = 0) => { for (let t = 0; t < seconds; t += 1 / 60) d.update(rig, 1 / 60, speed); };

describe("the driver on a Snap rig", () => {
  it("does nothing to the Snap limbs for a clip without joint data: no bend, the hands and boots where the rigid limbs held them", () => {
    const { rig, snap } = makeRig();
    const d = driver();
    settle(d, rig, 1);
    for (const a of snap.arms) {
      expect(a.fore.position.distanceTo(new THREE.Vector3(0, -35, 3.8))).toBeLessThan(1e-6);
      expect(1 - Math.abs(a.fore.quaternion.dot(SNAP_CUFF_Q))).toBeLessThan(1e-9);
    }
    for (const l of snap.legs) expect(l.lower.position.distanceTo(new THREE.Vector3(0, -39.2, 0))).toBeLessThan(1e-6);
  });

  it("bends the left elbow and knee for a clip with joint data, and moves the hand and the foot to where the bent limbs end", () => {
    const { rig, snap, world } = makeRig();
    const d = driver({ wave: jointClip("wave") });
    expect(d.trigger("wave" as never)).toBe(true);
    for (let t = 0; t < 0.6; t += 1 / 60) d.update(rig, 1 / 60, 0); // inside the clip, past the fade in
    const L = snap.arms[0], R = snap.arms[1];
    expect(L.fore.position.distanceTo(new THREE.Vector3(0, -35, 3.8))).toBeGreaterThan(5); // the cuff has swung away from the straight arm
    expect(R.fore.position.distanceTo(new THREE.Vector3(0, -35, 3.8)) < L.fore.position.distanceTo(new THREE.Vector3(0, -35, 3.8))).toBe(true); // the right arm did not bend
    expect(snap.legs[0].lower.position.distanceTo(new THREE.Vector3(0, -39.2, 0))).toBeGreaterThan(3);
    world.updateMatrixWorld(true);
    const handWorld = new THREE.Vector3(); L.hand.getWorldPosition(handWorld);
    const restHand = new THREE.Vector3();
    // the left hand is higher than the rest hand: the elbow came up
    const fresh = makeRig(); fresh.world.updateMatrixWorld(true); fresh.snap.arms[0].hand.getWorldPosition(restHand);
    expect(handWorld.distanceTo(restHand)).toBeGreaterThan(0.2);
  });

  it("lands the lowest sole on the floor when the clip is planted, and leaves a clip that is not planted where it is", () => {
    // the points of the sole the driver stands on the floor: across the boot and along it, from the boot's origin, in the foot's frame
    const lowestSole = (r: ReturnType<typeof makeRig>) => {
      r.world.updateMatrixWorld(true);
      let lo = Infinity;
      for (const l of r.snap.legs) for (const [dx, dz] of [[-7, -9], [7, -9], [-7, 15], [7, 15]] as const) lo = Math.min(lo, l.foot.localToWorld(new THREE.Vector3(l.boot.position.x + dx, l.boot.position.y, l.boot.position.z + dz)).y);
      return lo;
    };
    const planted = makeRig();
    const d1 = driver({ dip: jointClip("dip", { planted: true, hipsY: 54 }) });
    d1.trigger("dip" as never);
    for (let t = 0; t < 0.6; t += 1 / 60) d1.update(planted.rig, 1 / 60, 0);
    expect(Math.abs(lowestSole(planted))).toBeLessThan(1e-4); // on the floor (a tenth of a millimetre is 0.0000185 stage units)
    const loose = makeRig();
    const d2 = driver({ dip: jointClip("dip", { planted: false, hipsY: 54 }) });
    d2.trigger("dip" as never);
    for (let t = 0; t < 0.6; t += 1 / 60) d2.update(loose.rig, 1 / 60, 0);
    expect(lowestSole(loose)).not.toBeCloseTo(0, 3); // not grounded: the hips dropped and the feet went with them
  });

  it("goes back to the rigid rest exactly when the clip is over", () => {
    const { rig, snap, g } = makeRig();
    const d = driver({ wave: jointClip("wave") });
    d.trigger("wave" as never);
    for (let t = 0; t < 0.6; t += 1 / 60) d.update(rig, 1 / 60, 0);
    expect(snap.arms[0].fore.position.distanceTo(new THREE.Vector3(0, -35, 3.8))).toBeGreaterThan(1);
    settle(d, rig, 2); // the clip is 1 s long; two seconds on, it has gone
    expect(d.busyAction).toBeNull();
    for (const a of snap.arms) {
      expect(a.fore.position.distanceTo(new THREE.Vector3(0, -35, 3.8))).toBeLessThan(1e-6);
      expect(a.hand.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-6);
    }
    for (const l of snap.legs) expect(l.lower.position.distanceTo(new THREE.Vector3(0, -39.2, 0))).toBeLessThan(1e-6);
    expect(g.position.length()).toBeLessThan(1e-6);
    // and the sleeves' shape is the rest shape again
    const restPos = makeFlexLimb(limbBox(), SNAP_ARM_FLEX.offsetY, SNAP_ARM_FLEX.midY, SNAP_ARM_FLEX.midZ, SNAP_ARM_FLEX.band).geometry.attributes.position!.array;
    expect(Array.from(snap.arms[0].flex.geometry.attributes.position!.array as Float32Array)).toEqual(Array.from(restPos as Float32Array));
  });

  it("turns the body about the HIPS: the hip joints stay where they are while the body leans (not about the feet)", () => {
    const { rig, world } = makeRig();
    const lean = jointClip("lean", { planted: false }); // not planted: the grounder would move the hips to put the soles on the floor, and this is about the pivot alone
    lean.body = track(4, (() => { const q = Q(1, 0, 0, 25); return [q.x, q.y, q.z, q.w]; })()); // the whole body leans 25 degrees
    const d = driver({ lean });
    const hipAt = (r: ReturnType<typeof makeRig>) => { r.world.updateMatrixWorld(true); return (r.rig as unknown as { feet: THREE.Object3D[] }).feet.map((f) => f.userData.hip.getWorldPosition(new THREE.Vector3())); };
    const rest = hipAt({ rig, world } as never);
    d.trigger("lean" as never);
    for (let t = 0; t < 0.6; t += 1 / 60) d.update(rig, 1 / 60, 0);
    const now = hipAt({ rig, world } as never);
    for (let i = 0; i < 2; i++) expect(now[i]!.distanceTo(rest[i]!)).toBeLessThan(2e-3 * 0.0185); // within 0.002 mm: the hips did not move
    // and the head did (it is above the hips, so a lean carries it)
    const headRest = new THREE.Vector3(), headNow = new THREE.Vector3();
    const fresh = makeRig(); fresh.world.updateMatrixWorld(true); fresh.head.getWorldPosition(headRest);
    world.updateMatrixWorld(true); (rig as unknown as { head: THREE.Object3D }).head.getWorldPosition(headNow);
    expect(headNow.distanceTo(headRest)).toBeGreaterThan(0.1);
  });

  it("on the very frame a pose has all but faded out, the limbs are put back at exactly rest, not at a thousandth of the bend", () => {
    const { rig, snap } = makeRig();
    const d = driver({ wave: jointClip("wave") });
    d.trigger("wave" as never);
    d.update(rig, 0.5, 0);                      // well into the clip, at full weight
    expect(snap.arms[0].fore.position.distanceTo(new THREE.Vector3(0, -35, 3.8))).toBeGreaterThan(1);
    d.update(rig, 0.49985, 0);                  // 0.15 ms before the end: the fade-out has left about 0.05 % of the pose
    expect(snap.arms[0].fore.position.distanceTo(new THREE.Vector3(0, -35, 3.8))).toBeLessThan(1e-9);
    expect(snap.legs[0].lower.position.distanceTo(new THREE.Vector3(0, -39.2, 0))).toBeLessThan(1e-9);
  });

  it("release() puts the limbs back too (the driver can be swapped out mid-gesture)", () => {
    const { rig, snap } = makeRig();
    const d = driver({ wave: jointClip("wave") });
    d.trigger("wave" as never);
    for (let t = 0; t < 0.6; t += 1 / 60) d.update(rig, 1 / 60, 0);
    d.release();
    expect(snap.arms[0].fore.position.distanceTo(new THREE.Vector3(0, -35, 3.8))).toBeLessThan(1e-6);
    expect(snap.legs[0].lower.position.distanceTo(new THREE.Vector3(0, -39.2, 0))).toBeLessThan(1e-6);
  });

  it("walking away cancels a gesture, and the limbs follow it back to rest", () => {
    const { rig, snap } = makeRig();
    const d = driver({ wave: jointClip("wave") });
    d.trigger("wave" as never);
    for (let t = 0; t < 0.5; t += 1 / 60) d.update(rig, 1 / 60, 0);
    for (let t = 0; t < 1.5; t += 1 / 60) d.update(rig, 1 / 60, 2.4); // walking
    expect(snap.arms[0].fore.position.distanceTo(new THREE.Vector3(0, -35, 3.8))).toBeLessThan(1e-3);
  });
});

/** A thing in Kip's hand the way the game attaches it (heldItems.ts, pickupHeld.ts): a child of the arm's holder, placed where the straight hand is. */
function putInHand(r: ReturnType<typeof makeRig>, i: number): THREE.Object3D {
  r.world.updateMatrixWorld(true);
  const holder = (r.rig as unknown as { arms: THREE.Object3D[] }).arms[i]!;
  const item = new THREE.Group();
  const local = new THREE.Matrix4().copy(holder.matrixWorld).invert().multiply(r.snap.arms[i]!.hand.matrixWorld);
  local.decompose(item.position, item.quaternion, new THREE.Vector3());
  holder.add(item);
  return item;
}
/** Where the hand is in the item's own frame: constant if, and only if, the item is held rigidly in the hand. */
function handInItem(r: ReturnType<typeof makeRig>, item: THREE.Object3D, i: number): number[] {
  r.world.updateMatrixWorld(true);
  return new THREE.Matrix4().copy(item.matrixWorld).invert().multiply(r.snap.arms[i]!.hand.matrixWorld).toArray();
}
const maxDiff = (a: number[], b: number[]) => Math.max(...a.map((v, k) => Math.abs(v - b[k]!)));

describe("what Kip holds goes with his hand", () => {
  it("stays in the hand, in the same place and at the same angle, through a bent elbow and a turned wrist (both hands)", () => {
    const r = makeRig();
    const items = [putInHand(r, 0), putInHand(r, 1)];
    const rest = items.map((it, i) => handInItem(r, it, i));
    const itemRest = items.map((it) => it.getWorldPosition(new THREE.Vector3()));
    const d = driver({ wave: jointClip("wave") });
    d.trigger("wave" as never);
    const moved = [0, 0];
    for (let t = 0; t < 0.9; t += 1 / 60) {
      d.update(r.rig, 1 / 60, 0);
      items.forEach((it, i) => {
        expect(maxDiff(handInItem(r, it, i), rest[i]!)).toBeLessThan(1e-6);
        moved[i] = Math.max(moved[i]!, it.getWorldPosition(new THREE.Vector3()).distanceTo(itemRest[i]!));
      });
    }
    expect(moved[0]).toBeGreaterThan(0.2); // and the left hand really did go somewhere (otherwise this proves nothing)
  });

  it("is left behind where the straight hand was when the arm does not follow (what this is for)", () => {
    const r = makeRig({ follow: false });
    const item = putInHand(r, 0);
    const rest = handInItem(r, item, 0);
    const d = driver({ wave: jointClip("wave") });
    d.trigger("wave" as never);
    for (let t = 0; t < 0.6; t += 1 / 60) d.update(r.rig, 1 / 60, 0);
    expect(maxDiff(handInItem(r, item, 0), rest)).toBeGreaterThan(0.1);
  });

  it("does not move the sleeve or the hand: they are where the clip put them with or without the holder following", () => {
    const a = makeRig(), b = makeRig({ follow: false });
    const da = driver({ wave: jointClip("wave") }), db = driver({ wave: jointClip("wave") });
    da.trigger("wave" as never); db.trigger("wave" as never);
    for (let t = 0; t < 0.7; t += 1 / 60) { da.update(a.rig, 1 / 60, 0); db.update(b.rig, 1 / 60, 0); }
    a.world.updateMatrixWorld(true); b.world.updateMatrixWorld(true);
    for (let i = 0; i < 2; i++) {
      for (const k of ["fore", "hand"] as const) expect(maxDiff(a.snap.arms[i]![k].matrixWorld.toArray(), b.snap.arms[i]![k].matrixWorld.toArray())).toBeLessThan(1e-6);
      const pa = a.snap.arms[i]!.flex.geometry.attributes.position!.array as Float32Array, pb = b.snap.arms[i]!.flex.geometry.attributes.position!.array as Float32Array;
      expect(Array.from(pa)).toEqual(Array.from(pb)); // the sleeve's own shape is the same too
    }
  });

  it("nothing moves for a clip without joint data: the holder stays at the shoulder and the counter does nothing", () => {
    const r = makeRig();
    const arms = (r.rig as unknown as { arms: THREE.Object3D[] }).arms;
    const home = arms.map((h) => h.position.clone());
    const d = driver({ plain: neutral("plain") });
    d.trigger("plain" as never);
    for (let t = 0; t < 0.6; t += 1 / 60) d.update(r.rig, 1 / 60, 0);
    arms.forEach((h, i) => expect(h.position.distanceTo(home[i]!)).toBe(0));
    for (const a of r.snap.arms) { expect(a.follow!.counter.position.length()).toBe(0); expect(a.follow!.counter.quaternion.angleTo(new THREE.Quaternion())).toBe(0); }
  });

  it("is exactly home when the clip is over, on the frame a pose has all but faded out, and after release()", () => {
    const r = makeRig();
    const arms = (r.rig as unknown as { arms: THREE.Object3D[] }).arms;
    const home = arms.map((h) => h.position.clone());
    const item = putInHand(r, 0);
    const rest = handInItem(r, item, 0);
    const exact = () => arms.forEach((h, i) => { expect(h.position.distanceTo(home[i]!)).toBe(0); expect(r.snap.arms[i]!.follow!.counter.position.length()).toBe(0); });
    const d = driver({ wave: jointClip("wave") });
    d.trigger("wave" as never);
    d.update(r.rig, 0.5, 0);
    expect(arms[0]!.position.distanceTo(home[0]!)).toBeGreaterThan(0.1); // the holder went with the hand
    d.update(r.rig, 0.49985, 0);                                          // the frame the pose has all but faded out
    exact();
    expect(maxDiff(handInItem(r, item, 0), rest)).toBeLessThan(1e-9);
    const d2 = driver({ wave: jointClip("wave") });
    d2.trigger("wave" as never);
    for (let t = 0; t < 0.6; t += 1 / 60) d2.update(r.rig, 1 / 60, 0);
    d2.release();
    exact();
  });
});

describe("the hand-follow rule, run on the real thing and on broken versions of it", () => {
  // Pose the left arm by hand (the clip's shoulder, elbow and wrist through the bench's solver), then let `follow` move the holder. The rule: a thing held in the straight hand stays rigid
  // in the hand, and the sleeve and hand end up exactly where they would have without any following.
  const handDelta = (a: SnapArmHandles) => {
    const f = a.follow!;
    const m = new THREE.Matrix4();
    for (let o: THREE.Object3D | null = a.hand; o && o !== f.counter; o = o.parent) { o.updateMatrix(); m.premultiply(o.matrix); }
    return m.multiply(f.restInv);
  };
  type Follow = (a: SnapArmHandles, shoulder: THREE.Quaternion) => void;
  const withParts = (a: SnapArmHandles, shoulder: THREE.Quaternion, mutate: (p: { pos: THREE.Vector3; q: THREE.Quaternion; holder: THREE.Object3D; counter: THREE.Object3D; restPos: THREE.Vector3; shoulder: THREE.Quaternion }) => void) => {
    const f = a.follow!;
    const pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    handDelta(a).decompose(pos, q, sc);
    mutate({ pos, q, holder: f.holder, counter: f.counter, restPos: f.restPos, shoulder });
  };
  const undo = (p: { pos: THREE.Vector3; q: THREE.Quaternion; counter: THREE.Object3D }) => { p.counter.quaternion.copy(p.q).invert(); p.counter.position.copy(p.pos).applyQuaternion(p.counter.quaternion).negate(); };
  const variants: Record<string, Follow> = {
    real: followHand,
    "the sleeve is not held back": (a, S) => withParts(a, S, (p) => { const s = p.shoulder.clone(); p.holder.position.copy(p.pos).applyQuaternion(s).add(p.restPos); p.holder.quaternion.copy(s).multiply(p.q); }),
    "the move is not turned by the shoulder": (a, S) => withParts(a, S, (p) => { const s = p.shoulder.clone(); p.holder.position.copy(p.pos).add(p.restPos); p.holder.quaternion.copy(s).multiply(p.q); undo(p); }),
    "the rotations are multiplied the wrong way round": (a, S) => withParts(a, S, (p) => { const s = p.shoulder.clone(); p.holder.position.copy(p.pos).applyQuaternion(s).add(p.restPos); p.holder.quaternion.copy(p.q).multiply(s); undo(p); }),
    "the shoulder is read after the holder was turned": (a, S) => withParts(a, S, (p) => { p.holder.quaternion.copy(S).multiply(p.q); p.holder.position.copy(p.pos).applyQuaternion(S).add(p.restPos); undo(p); }),
    "the holder's own place is forgotten": (a, S) => withParts(a, S, (p) => { const s = p.shoulder.clone(); p.holder.position.copy(p.pos).applyQuaternion(s); p.holder.quaternion.copy(s).multiply(p.q); undo(p); }),
  };
  const holds = (follow: Follow): { rigid: number; sleeve: number } => {
    const shoulder = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.5, -0.3, 0.7));
    const poseArm = (r: ReturnType<typeof makeRig>) => {
      const a = r.snap.arms[0], holder = (r.rig as unknown as { arms: THREE.Object3D[] }).arms[0]!;
      const sol = solveSnapArm(shoulder, Q(1, 0, 0, -80), Q(0, 1, 0, 35), 0.94, newSnapArmSolution());
      holder.quaternion.copy(sol.shoulder);
      a.flex.deform(sol.flex);
      a.fore.position.copy(sol.cuffPos); a.fore.quaternion.copy(sol.cuffQ);
      a.hand.position.copy(sol.handPos); a.hand.quaternion.copy(sol.handQ);
      return { a, holder };
    };
    const r = makeRig();
    const item = putInHand(r, 0);
    const rest = handInItem(r, item, 0);
    const { a, holder } = poseArm(r);
    follow(a, holder.quaternion); // the way the driver calls it: with the holder's own quaternion, which the rule is about to change
    r.world.updateMatrixWorld(true);
    const rigid = maxDiff(handInItem(r, item, 0), rest);
    // the reference: the same pose, the holder left at the shoulder
    const ref = makeRig({ follow: false });
    const rp = poseArm(ref);
    ref.world.updateMatrixWorld(true);
    const sleeve = Math.max(maxDiff(a.fore.matrixWorld.toArray(), rp.a.fore.matrixWorld.toArray()), maxDiff(a.hand.matrixWorld.toArray(), rp.a.hand.matrixWorld.toArray()));
    return { rigid, sleeve };
  };
  it("the real rule keeps what is held rigid in the hand, and the sleeve and hand where the pose put them", () => {
    const { rigid, sleeve } = holds(variants.real!);
    expect(rigid).toBeLessThan(1e-6);
    expect(sleeve).toBeLessThan(1e-6);
  });
  for (const [name, follow] of Object.entries(variants)) {
    if (name === "real") continue;
    it(`is caught when ${name}`, () => {
      const { rigid, sleeve } = holds(follow);
      expect(Math.max(rigid, sleeve)).toBeGreaterThan(1e-4);
    });
  }
});

describe("mixing poses that carry joint data", () => {
  it("a pose without joint data mixed with one that has it gets the exact rotations in proportion, and none when the weight is 0", () => {
    const a = newPose(), b = newPose();
    sampleClip(neutral("idle"), 0, a);
    sampleClip(jointClip("x"), 0, b);
    expect(a.jw).toBe(0); expect(b.jw).toBe(1);
    const half = newPose(); sampleClip(neutral("idle"), 0, half);
    mixPose(half, b, 0.5);
    expect(half.jw).toBeCloseTo(0.5, 6);
    const zero = newPose(); sampleClip(neutral("idle"), 0, zero);
    mixPose(zero, b, 0);
    expect(zero.jw).toBe(0);
    const full = newPose(); sampleClip(neutral("idle"), 0, full);
    mixPose(full, b, 1);
    expect(full.jw).toBe(1);
    expect(full.j.elbowL.angleTo(b.j.elbowL)).toBeLessThan(1e-6);
  });
  it("two exact poses mixed halfway are halfway between their rotations", () => {
    const a = newPose(), b = newPose();
    sampleClip(jointClip("x"), 0, a);
    const c2 = jointClip("y"); c2.joints!.elbowL = track(4, [0, 0, 0, 1]);
    sampleClip(c2, 0, b);
    mixPose(a, b, 0.5);
    expect(a.jw).toBe(1);
    expect(THREE.MathUtils.radToDeg(a.j.elbowL.angleTo(new THREE.Quaternion()))).toBeCloseTo(45, 3); // half of 90 degrees
  });
  it("Kip's hip height is the same number in the loader and in the driver", () => {
    expect(KIP_HIP_REST_MM).toBe(KIP_HIP_MM);
  });
});
