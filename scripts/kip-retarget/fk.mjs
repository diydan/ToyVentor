import * as THREE from "three";
import fs from "node:fs";
export { THREE };
const D2R = Math.PI / 180;
export const SH = { right: [-18.2, 33.5, 0], upper: 23.8, lower: 22.6 };
const MC = JSON.parse(fs.readFileSync(new URL("./measureC.json", import.meta.url), "utf8"));
export const REL = new THREE.Matrix4().fromArray(MC.rel);       // hand world -> mesh (STL local) world, constant for every workshop prop
export const BB = MC.bb;
const eq = (a) => new THREE.Quaternion().setFromEuler(new THREE.Euler(a[0] * D2R, a[1] * D2R, a[2] * D2R, "ZYX"));
/** Right arm + prop forward kinematics. spec: { arm, fore, hand, hips }, hipsPos: Hips world position. Returns the world matrices. */
export function armFK(spec, hipsPos, flip = null) {
  const qh = eq(spec.hips || [0, 0, 0]);
  const sh = new THREE.Vector3(...SH.right).applyQuaternion(qh).add(new THREE.Vector3(...hipsPos));
  const qa = qh.clone().multiply(eq(spec.arm));
  const el = new THREE.Vector3(0, -SH.upper, 0).applyQuaternion(qa).add(sh);
  const qf = qa.clone().multiply(eq(spec.fore));
  const wr = new THREE.Vector3(0, -SH.lower, 0).applyQuaternion(qf).add(el);
  const qhand = qf.clone().multiply(eq(spec.hand));
  const hand = new THREE.Matrix4().compose(wr, qhand, new THREE.Vector3(1, 1, 1));
  const mesh = hand.clone().multiply(flip ? flip.clone().multiply(REL) : REL);
  return { sh, el, wr, qf, qhand, hand, mesh };
}
export const pt = (m, x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(m);
export const dir = (m, x, y, z) => new THREE.Vector3(x, y, z).transformDirection(m);
