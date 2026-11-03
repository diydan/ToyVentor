// The Toy Room bed (docs/specs/playful-interactions-spec.md, "tap the bed and Kip goes to sleep").
//
// A chunky toy-style bed in the same language as the other room props (rounded plastic boxes, `rbox` + `plastic`): a frame on four short feet, a mattress,
// a headboard at the -x end and a low footboard at the +x end, a fat pillow at the head and a folded star blanket at the foot. The middle of the mattress is
// left clear on purpose: that is where the sleeping figure lies (the `sleep` clip in proceduralClips.ts lies it on its back, head toward -x, with the middle
// of the body over the rig origin), so nothing may poke through it.
//
// This file only builds geometry and says where to lie down. It is NOT wired in yet: the world's `propBuilders` table, the `bed` noun and the sleep
// behaviour are added when the files they live in are free (see the spec). `buildBed` returns an unparented group, like the world's own builders after `add`.
import { T, M, rbox, plastic, starGeo, glowMat } from "./worldScene";
import type * as THREE from "three";

// All in world units, measured from the bed's own origin on the floor (x along the bed, head at -x; z across it).
export const BED_LENGTH = 3.9;        // frame, head to foot (headboard and footboard included)
export const BED_WIDTH = 2.1;         // frame, side to side
export const MATTRESS_TOP = 0.8;      // height of the mattress surface above the floor: where the sleeper lies
export const MATTRESS_LENGTH = 3.4;
export const MATTRESS_WIDTH = 1.84;
export const PILLOW_X = -1.28;        // pillow centre along the bed: negative, so the head end is -x
export const HEADBOARD_HEIGHT = 1.55;

/** Where the sleeper's rig origin goes when it lies on this bed at (x, z): the middle of the mattress, on its surface. */
export function sleepSpot(bed: { x: number; z: number }): { x: number; y: number; z: number } {
  return { x: bed.x, y: MATTRESS_TOP, z: bed.z };
}

/** Is the ground point (px, pz) over this bed's frame? A generous tap target for "the bed" on the floor plan. */
export function overBed(bed: { x: number; z: number }, px: number, pz: number): boolean {
  return Math.abs(px - bed.x) <= BED_LENGTH / 2 && Math.abs(pz - bed.z) <= BED_WIDTH / 2;
}

export function buildBed(x: number, z: number): THREE.Group {
  const g = new T.Group();
  g.position.set(x, 0, z);
  const wood = plastic("#ff9d5c", { roughness: 0.6 });
  const sheet = plastic("#9ad7ff", { roughness: 0.9, clearcoat: 0.1 });
  const pillowMat = plastic("#fff6ea", { roughness: 0.95, clearcoat: 0.05 });
  const blanketMat = plastic("#6a5cff", { roughness: 0.95, clearcoat: 0.05 });

  // Four short feet, then the frame resting on them.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(M(new T.CylinderGeometry(0.11, 0.09, 0.16, 12), wood, sx * (BED_LENGTH / 2 - 0.3), 0.08, sz * (BED_WIDTH / 2 - 0.16)));
  }
  g.add(M(rbox(BED_LENGTH - 0.3, 0.3, BED_WIDTH, 0.08), wood, 0.0, 0.31, 0));
  // Mattress: sits on the frame (whose top is at 0.46) and its top face is exactly MATTRESS_TOP, the height the sleeping figure lies at.
  const mattressH = 0.34;
  g.add(M(rbox(MATTRESS_LENGTH, mattressH, MATTRESS_WIDTH, 0.14), sheet, 0.0, MATTRESS_TOP - mattressH / 2, 0));
  // Headboard (tall, at -x) and footboard (low, at +x).
  g.add(M(rbox(0.2, HEADBOARD_HEIGHT, BED_WIDTH, 0.07), wood, -BED_LENGTH / 2 + 0.1, HEADBOARD_HEIGHT / 2, 0));
  g.add(M(rbox(0.2, 0.7, BED_WIDTH, 0.07), wood, BED_LENGTH / 2 - 0.1, 0.35, 0));
  // Pillow at the head end.
  g.add(M(rbox(0.85, 0.22, 1.05, 0.1), pillowMat, PILLOW_X, MATTRESS_TOP + 0.11 - 0.02, 0));
  // A folded blanket at the foot, a few stars on it. It stays well clear of the middle of the mattress.
  const blanketH = 0.16, blanketX = 1.35;
  g.add(M(rbox(0.6, blanketH, MATTRESS_WIDTH - 0.1, 0.06), blanketMat, blanketX, MATTRESS_TOP + blanketH / 2 - 0.02, 0));
  const starMat = glowMat("#ffd24d", 0.5);
  [[1.2, -0.45], [1.45, 0.1], [1.25, 0.5]].forEach(([sx, sz], i) => {
    const s = M(starGeo(), starMat, sx!, MATTRESS_TOP + blanketH - 0.005, sz!);
    s.rotation.x = -Math.PI / 2;
    s.rotation.z = i * 0.6;
    s.scale.setScalar(0.5);
    s.castShadow = false;
    g.add(s);
  });
  return g;
}
