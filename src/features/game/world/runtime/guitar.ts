// The toy guitar (docs/specs/playful-interactions-spec.md section 6): a chunky orange guitar in the same rounded-plastic language as the other room props. `buildGuitarMesh` is the guitar itself, upright with
// its body at the bottom (its origin is the centre of the body); `buildGuitarProp` stands it on a little tripod on the floor for the Toy Room; and Kip holds a smaller copy across its body while it plays
// (toyRoomActs.ts), so one function makes both.
import { T, M, rbox, plastic } from "./worldScene";
import type * as THREE from "three";

/** The guitar's length from the bottom of its body to the tip of its head, and how wide the body is, at scale 1. */
export const GUITAR_LENGTH = 2.55;
export const GUITAR_BODY_W = 0.95;
/** The scale of the guitar Kip holds. */
export const HELD_GUITAR_SCALE = 0.72;

export function buildGuitarMesh(): THREE.Group {
  const g = new T.Group();
  const body = plastic("#ff9d5c", { roughness: 0.45 });
  const top = plastic("#ffb98a", { roughness: 0.5 });
  const wood = plastic("#8a5a3a", { roughness: 0.6 });
  const dark = plastic("#2a1a3a", { roughness: 0.5, clearcoat: 0.2 });
  const metal = plastic("#e9eef9", { roughness: 0.3 });
  // The body: a fat figure of eight made of two flattened spheres, with a lighter face plate over the front.
  const lower = M(new T.SphereGeometry(0.5, 24, 16), body, 0, -0.35, 0); lower.scale.set(0.95, 1, 0.38);
  const upper = M(new T.SphereGeometry(0.38, 24, 16), body, 0, 0.18, 0); upper.scale.set(0.95, 1, 0.38);
  g.add(lower, upper);
  const face = M(new T.SphereGeometry(0.5, 24, 16), top, 0, -0.35, 0.07); face.scale.set(0.9, 0.94, 0.2);
  g.add(face);
  const hole = M(new T.CylinderGeometry(0.13, 0.13, 0.03, 20), dark, 0, -0.18, 0.2); hole.rotation.x = Math.PI / 2;
  g.add(hole);
  g.add(M(rbox(0.3, 0.07, 0.07, 0.025), wood, 0, -0.62, 0.2));                 // the bridge
  // The neck, the fingerboard and the head with three tuning pegs each side.
  g.add(M(rbox(0.17, 1.05, 0.12, 0.04), wood, 0, 0.78, 0));
  g.add(M(rbox(0.13, 1.0, 0.04, 0.02), dark, 0, 0.78, 0.075));
  for (let i = 0; i < 4; i++) g.add(M(rbox(0.14, 0.018, 0.045, 0.006), metal, 0, 0.42 + i * 0.22, 0.09));   // frets
  g.add(M(rbox(0.3, 0.34, 0.1, 0.05), wood, 0, 1.46, -0.01));
  for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) g.add(M(new T.SphereGeometry(0.035, 8, 6), metal, sx * 0.175, 1.36 + i * 0.1, -0.01));
  // Strings: six thin lines down the front from the head to the bridge.
  for (let i = 0; i < 6; i++) {
    const s = M(new T.CylinderGeometry(0.004, 0.004, 2.0, 4), metal, -0.05 + i * 0.02, 0.38, 0.1);
    g.add(s);
  }
  // The origin is the middle of the figure of eight; the bottom of the body is at y = -0.85 and the tip of the head at about 1.63.
  return g;
}

export function buildGuitarProp(x: number, z: number): THREE.Group {
  const g = new T.Group();
  g.position.set(x, 0, z);
  const stand = plastic("#52b7ff", { roughness: 0.5 });
  // A small tripod: three legs and a ring that holds the body.
  for (const [lx, lz] of [[-0.42, 0.1], [0.42, 0.1], [0, -0.38]] as const) {
    const leg = M(new T.CylinderGeometry(0.035, 0.035, 0.75, 8), stand, lx * 0.55, 0.37, lz * 0.55);
    leg.rotation.z = -lx * 0.5; leg.rotation.x = lz * 0.5;
    g.add(leg);
  }
  const ring = M(new T.TorusGeometry(0.2, 0.04, 8, 18), stand, 0, 0.72, 0);
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  const guitar = buildGuitarMesh();
  guitar.position.set(0, 0.72 + 0.85, 0);                                        // the bottom of the body sits in the ring
  guitar.rotation.z = -0.12;                                                     // leaning a little
  g.add(guitar);
  return g;
}
