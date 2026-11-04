// The mop Kip holds to clean up a spill (docs/specs/playful-interactions-spec.md, "Spill and clean up"): a string mop, soft and cream, on an orange handle. One function makes it for the held item
// (heldItems.ts attaches it to Kip's body, slanted, the head on the floor in front of Kip).
import { T, M, rbox, plastic } from "./worldScene";
import type * as THREE from "three";

/** The handle's length (above the head) and the mop's overall height, at scale 1. */
export const MOP_HANDLE = 1.55;
export const MOP_HEIGHT = 1.85;

/** A mop standing upright with the middle of the head on the floor at the origin and the handle going up (+y). */
export function buildMopMesh(): THREE.Group {
  const g = new T.Group();
  const handle = plastic("#ff9d5c", { roughness: 0.5 });
  const cream = plastic("#fff6ea", { roughness: 0.95 });
  g.add(M(new T.CylinderGeometry(0.035, 0.04, MOP_HANDLE, 10), handle, 0, 0.3 + MOP_HANDLE / 2, 0));
  g.add(M(rbox(0.46, 0.1, 0.2, 0.03), plastic("#52b7ff", { roughness: 0.4 }), 0, 0.26, 0));                   // the clamp
  const strands = M(new T.SphereGeometry(0.3, 16, 10), cream, 0, 0.12, 0);                                    // the soft head
  strands.scale.set(1.05, 0.45, 0.7);
  g.add(strands);
  for (const dx of [-0.26, 0, 0.26]) g.add(M(new T.CylinderGeometry(0.03, 0.045, 0.14, 8), cream, dx, 0.07, 0.12));  // a few strands hanging at the front
  return g;
}
