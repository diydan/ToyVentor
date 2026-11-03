// The bubble set (docs/specs/playful-interactions-spec.md section 6): a chunky bottle of bubble mix with its wand sticking out, for the Toy Room floor, and the wand on its own, which Kip holds in its
// right hand while it blows (toyRoomActs.ts). One function makes the wand for both.
import { T, M, rbox, plastic, glowMat } from "./worldScene";
import type * as THREE from "three";

/** The wand's length (handle plus ring) and the ring's radius, at scale 1. The ring's centre is at y = WAND_LENGTH - WAND_RING_R from the bottom of the handle. */
export const WAND_LENGTH = 0.95;
export const WAND_RING_R = 0.17;

/** A wand: a thin handle with a ring at the top, standing upright with the bottom of the handle at y = 0. */
export function buildWandMesh(): THREE.Group {
  const g = new T.Group();
  const handle = plastic("#ff5aa8", { roughness: 0.4 });
  const ring = M(new T.TorusGeometry(WAND_RING_R, 0.032, 8, 24), handle, 0, WAND_LENGTH - WAND_RING_R, 0);
  g.add(ring);
  g.add(M(new T.CylinderGeometry(0.04, 0.045, WAND_LENGTH - 2 * WAND_RING_R, 10), handle, 0, (WAND_LENGTH - 2 * WAND_RING_R) / 2, 0));
  // A soap film in the ring: a faint glowing disc.
  const film = M(new T.CircleGeometry(WAND_RING_R * 0.92, 20), glowMat("#bfe4ff", 0.4), 0, WAND_LENGTH - WAND_RING_R, 0);
  (film.material as THREE.Material).transparent = true;
  (film.material as THREE.Material).opacity = 0.35;
  film.castShadow = false;
  g.add(film);
  return g;
}

/** The bottle of bubble mix with its wand in it, standing on the floor at (x, 0, z). */
export function buildBubbleBottle(x: number, z: number): THREE.Group {
  const g = new T.Group();
  g.position.set(x, 0, z);
  const glass = plastic("#7fd0ff", { roughness: 0.2, transparent: true, opacity: 0.85 });
  const cap = plastic("#ff5aa8", { roughness: 0.4 });
  g.add(M(new T.CylinderGeometry(0.42, 0.46, 0.85, 20), glass, 0, 0.425, 0));
  g.add(M(new T.CylinderGeometry(0.2, 0.3, 0.2, 16), glass, 0, 0.95, 0));
  g.add(M(rbox(0.46, 0.16, 0.46, 0.06), cap, 0, 1.12, 0));
  g.add(M(new T.CylinderGeometry(0.4, 0.44, 0.5, 20), plastic("#fff6ea", { roughness: 0.6 }), 0, 0.3, 0));         // the label band
  const wand = buildWandMesh();
  wand.position.set(0.12, 1.15, 0);
  wand.rotation.z = -0.18;
  g.add(wand);
  return g;
}
