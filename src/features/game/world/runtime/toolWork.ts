// A belt tool at work on a screw, a bolt or a nail (Dan, 2026-11-04 night: the tool is in Kip's hand now, so it should be the one that does the job). The tool in his hand flies to the fit,
// works on it (the screwdriver and the spanner turn, the hammer bonks twice, the drill whirrs) and comes back to his hand. Pure: one function from the moment (0 to 1) to where the tool is and
// how it is turned; the world moves a mesh with it (world.ts `toolAnim`). The tool is seen from the camera at three quarters: its working end points into the scene, down and a little to
// the left, so the handle comes up towards the child and its shape reads.
import * as THREE from "three";
import { TOOL_TIP, type ToolKind } from "./toolMeshes";

/** How long the whole thing takes (seconds): it was 0.62 s for the old floating copy; the flight out and back make it a little longer. */
export const TOOL_WORK_S = 1.0;
/** The shares of the time: flying out, then working, then flying back. */
export const OUT_END = 0.3;
export const BACK_START = 0.72;
/** How far the hammer is drawn back from the fit and how far it tilts at the top of a swing. */
export const HAMMER_BACK = 0.5;
export const HAMMER_TILT = 0.5;
/** The tool is drawn a little bigger than the one in the hand so it reads at the bolt. */
export const TOOL_WORK_SCALE = 1.15;
/** Where the working end points (unit): into the scene (-z), down and to the left. */
export const AIM = new THREE.Vector3(-0.3, -0.3, -0.9).normalize();
/** The tool as it is in the hand, in world axes (Kip facing +x): forward and a little up (heldItems.ts TOOL_TURN). */
const IN_HAND = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -Math.PI / 2 + 0.35));
const WORK_Q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), AIM);
const Y = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);

const ease = (t: number): number => t * t * (3 - 2 * t);

export interface ToolPose { position: THREE.Vector3; quaternion: THREE.Quaternion }
export const newToolPose = (): ToolPose => ({ position: new THREE.Vector3(), quaternion: new THREE.Quaternion() });

/** Where the tool's origin is when its working end is on the fit (`bolt`), pulled back along its own axis by `pull` units. */
function atFit(kind: ToolKind, bolt: THREE.Vector3, pull: number, out: THREE.Vector3): THREE.Vector3 {
  const reach = TOOL_TIP[kind] * TOOL_WORK_SCALE + pull;
  return out.copy(bolt).addScaledVector(AIM, -reach);                                  // the working end on the fit, the handle back along the aim
}

const _spin = new THREE.Quaternion();
const _tilt = new THREE.Quaternion();
const _p = new THREE.Vector3();

/**
 * The pose of `kind` at moment `k` (0 to 1) while it goes from `hand` (where Kip's fist is now) to the fit at `bolt` and back. `out` is written and returned.
 *   0 to OUT_END     flies out in an arc, turning from how it sits in the hand to how it works
 *   OUT_END to BACK  works: screwdriver one and a half turns, spanner one, hammer two bonks, drill a fast whirr with a shake
 *   BACK to 1        flies back to the fist
 */
export function toolPose(kind: ToolKind, k: number, hand: THREE.Vector3, bolt: THREE.Vector3, out: ToolPose = newToolPose()): ToolPose {
  const t = Math.max(0, Math.min(1, Number.isFinite(k) ? k : 0));
  const rest = atFit(kind, bolt, 0, _p.set(0, 0, 0));
  const spinOf = (w: number): number => (kind === "screwdriver" ? w * Math.PI * 3 : kind === "spanner" ? ease(w) * Math.PI * 2 : kind === "drill" ? w * Math.PI * 18 : 0);
  if (t < OUT_END) {
    const u = t / OUT_END;
    out.position.lerpVectors(hand, rest, ease(u));
    out.position.y += Math.sin(Math.PI * u) * 0.55;                                    // an arc, not a straight line
    out.quaternion.slerpQuaternions(IN_HAND, WORK_Q, ease(u));
    return out;
  }
  if (t > BACK_START) {
    const u = (t - BACK_START) / (1 - BACK_START);
    // where it finished working (the spin carries on to its end value, so it does not unwind on the way back)
    const endQ = _spin.setFromAxisAngle(Y, spinOf(1));
    const q = new THREE.Quaternion().copy(WORK_Q).multiply(endQ);
    out.position.lerpVectors(rest, hand, ease(u));
    out.position.y += Math.sin(Math.PI * u) * 0.4;
    out.quaternion.slerpQuaternions(q, IN_HAND, ease(u));
    return out;
  }
  const w = (t - OUT_END) / (BACK_START - OUT_END);
  const cock = kind === "hammer" ? 0.5 * (1 - Math.cos(4 * Math.PI * w)) : 0;       // 0 with the face on the fit at w = 0, 0.5 and 1; 1 at the top of each swing
  atFit(kind, bolt, cock * HAMMER_BACK, out.position);
  if (kind === "drill") out.position.x += 0.02 * Math.sin(w * 160);                // the shake of a drill that is biting
  out.quaternion.copy(WORK_Q).multiply(_spin.setFromAxisAngle(Y, spinOf(w)));
  if (kind === "hammer") out.quaternion.premultiply(_tilt.setFromAxisAngle(X, cock * HAMMER_TILT));   // it cocks back at the top of the swing
  return out;
}
