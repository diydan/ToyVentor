// A two-bone leg IK for the Snap figure's legs (the step-turn, runtime/stepTurn.ts): from where an ankle must be (relative to its hip pivot) and which way the foot faces, the hip,
// knee and ankle rotations that `solveSnapLeg` (runtime/snapFlex.ts) turns into exactly that. Pure maths (three.js vectors and quaternions), no scene.
//
// The leg, in the rig's own frame (CAD: +X the figure's left, +Y up, +Z forward, millimetres): a thigh LEG_BONE_MM long hanging from the hip pivot, then a shin of the same length rotated by
// the knee's `flex`, so the ankle sits at (0, -L, 0) + flex * (0, -L, 0) before the hip turns the whole leg. A positive knee angle about +X folds the shin BACK, so the knee points forward.
// The foot hangs from the ankle with the orientation hip x flex x footQ (what rig.feet's chain multiplies out to; see `stlRigLoader.ts` and `solveSnapLeg`).
import * as THREE from "three";
import { solveSnapLeg, newSnapLegSolution } from "./snapFlex";

/** Thigh and shin length in rig mm: SNAP_LEG_FLEX's `midY` (the knee) and the same again to the ankle. */
export const LEG_BONE_MM = 19.6;
/** The longest hip-to-ankle distance, mm (the leg straight). */
export const LEG_REACH_MM = LEG_BONE_MM * 2;

/** The rig frame to the stage frame is a quarter turn about Y (stlRigLoader's `legCad.rotation.y`); the leg's children live in the rig frame, the hip holder in the stage frame. */
const C2S = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
const S2C = C2S.clone().invert();
const AX = new THREE.Vector3(1, 0, 0);

export interface LegIkResult {
  hip: THREE.Quaternion;
  knee: THREE.Quaternion;
  ankle: THREE.Quaternion;
  /** The knee's bend, radians (0 straight). */
  bend: number;
  /** How far the ankle is from the hip as a share of the straight leg, before it was clamped (more than 1: out of reach). */
  reach: number;
}
export const newLegIkResult = (): LegIkResult => ({ hip: new THREE.Quaternion(), knee: new THREE.Quaternion(), ankle: new THREE.Quaternion(), bend: 0, reach: 0 });

const _dc = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _e1l = new THREE.Vector3();
const _e2l = new THREE.Vector3();
const _e3l = new THREE.Vector3();
const _e1t = new THREE.Vector3();
const _e2t = new THREE.Vector3();
const _e3t = new THREE.Vector3();
const _a = new THREE.Vector3();
const _k = new THREE.Vector3();
const _mt = new THREE.Matrix4();
const _ml = new THREE.Matrix4();
const _mr = new THREE.Matrix4();
const _qflex = new THREE.Quaternion();
const _qflexInv = new THREE.Quaternion();
const _qres = new THREE.Quaternion();
const _qres2 = new THREE.Quaternion();
const _qout = new THREE.Quaternion();
const _qid = new THREE.Quaternion();

/**
 * Solve one leg.
 * `d`: the ankle's place minus the hip pivot's, in the stage frame of the hip holder (stage units); `S`: stage units per rig mm; `pole`: which way the knee points (stage frame, horizontal is
 * best; it is projected off the leg); `foot`: the foot orientation wanted, as the product hip x knee x ankle would be (rig frame); `ff`: the flex factor the rig will use (FLEX_ASSEMBLED x the
 * joint weight; solveSnapLeg passes (1 - ff) x 0.35 of the knee on to the hip and the foot, and that is accounted for here, so the result is exact for any ff above 0.05).
 * An ankle out of reach is pulled in to the straight leg's length (the direction is kept).
 */
export function solveLegIk(d: THREE.Vector3, S: number, pole: THREE.Vector3, foot: THREE.Quaternion, ff: number, out: LegIkResult): LegIkResult {
  const f = Math.max(0.05, Math.min(1, ff));
  _dc.copy(d).applyQuaternion(S2C).multiplyScalar(1 / S);                              // the ankle's place in the rig frame, mm
  const rawD = _dc.length();
  out.reach = rawD / LEG_REACH_MM;
  const D = Math.max(1e-3, Math.min(rawD, LEG_REACH_MM * 0.9995));
  _e1t.copy(_dc).multiplyScalar(1 / Math.max(rawD, 1e-6));
  // the knee: the shin folds back by phi so that the thigh and shin make the chord D
  const cosPhi = Math.max(-1, Math.min(1, (D * D) / (2 * LEG_BONE_MM * LEG_BONE_MM) - 1));
  const phi = Math.acos(cosPhi);
  out.bend = phi;
  _qflex.setFromAxisAngle(AX, phi);                                                     // the flex the sleeve will have: the knee's angle, whatever the factor
  out.knee.setFromAxisAngle(AX, phi / f);                                               // a knee rotation whose `ff`-th power is that flex
  // where the ankle is with the hip at rest, and the leg's own knee side
  _a.set(0, -LEG_BONE_MM, 0).applyQuaternion(_qflex).add(_k.set(0, -LEG_BONE_MM, 0));
  _e1l.copy(_a).normalize();
  _k.set(0, -LEG_BONE_MM, 0);
  _e2l.copy(_k).addScaledVector(_e1l, -_k.dot(_e1l));
  if (_e2l.lengthSq() < 1e-8) _e2l.set(0, 0, 1).addScaledVector(_e1l, -_e1l.z);       // a straight leg has no knee side: forward
  _e2l.normalize();
  _e3l.crossVectors(_e1l, _e2l);
  // the same two directions on the target side: along the leg, and towards the pole
  _pole.copy(pole).applyQuaternion(S2C);
  _e2t.copy(_pole).addScaledVector(_e1t, -_pole.dot(_e1t));
  if (_e2t.lengthSq() < 1e-8) _e2t.set(0, 0, 1).addScaledVector(_e1t, -_e1t.z);
  if (_e2t.lengthSq() < 1e-8) _e2t.set(1, 0, 0).addScaledVector(_e1t, -_e1t.x);
  _e2t.normalize();
  _e3t.crossVectors(_e1t, _e2t);
  _ml.makeBasis(_e1l, _e2l, _e3l);
  _mt.makeBasis(_e1t, _e2t, _e3t);
  _mr.copy(_mt).multiply(_ml.transpose());
  _qout.setFromRotationMatrix(_mr);                                                     // the hip as solveSnapLeg will leave it (out.hip = hip x res)
  // solveSnapLeg: res = knee^((1 - ff) x 0.35); out.hip = hip x res; footQ = res x ankle
  _qres.copy(_qid.identity()).slerp(out.knee, (1 - f) * 0.35);
  _qres2.copy(_qres).invert();
  out.hip.copy(_qout).multiply(_qres2);
  // the foot: hip_total x flex x footQ = foot  =>  ankle = res^-1 x flex^-1 x hip_total^-1 x foot
  _qflexInv.copy(_qflex).invert();
  out.ankle.copy(_qout).invert().premultiply(_qflexInv).premultiply(_qres2).multiply(foot);       // res^-1 x flex^-1 x hipTotal^-1 x foot
  return out;
}

const _sol = newSnapLegSolution();
const _fk = new THREE.Vector3();
/**
 * Forward kinematics, for the tests and the checks: where the ankle ends up (relative to the hip pivot, stage frame, stage units) and the foot's orientation (rig frame) for these joint
 * rotations, through the real `solveSnapLeg`.
 */
export function legForward(hip: THREE.Quaternion, knee: THREE.Quaternion, ankle: THREE.Quaternion, ff: number, S: number, outFoot?: THREE.Quaternion): THREE.Vector3 {
  solveSnapLeg(hip, knee, ankle, ff, _sol);
  _fk.copy(_sol.anklePos).applyQuaternion(_sol.hip).applyQuaternion(C2S).multiplyScalar(S);
  if (outFoot) outFoot.copy(_sol.hip).multiply(_sol.flex).multiply(_sol.footQ);
  return _fk.clone();
}
