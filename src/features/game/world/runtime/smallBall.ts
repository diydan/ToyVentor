// The small ball (Dan, 2026-11-04: Throw.fbx and "pickup and Throw Object.fbx"): a hand-sized copy of the Toy Room's big red-and-white ball. The big one is 1.1 across, nearly as wide as Kip's chest, so it
// is kicked (toyRoomActs.ts `kickVisit`); this one is picked up from the floor and thrown for the dog (`throwVisit`). Same colours and stripes, so it reads as the same toy at a smaller size.
import { T, M, plastic } from "./worldScene";
import { SMALL_BALL_R } from "./ballKick";
import type * as THREE from "three";

/** The ball itself, centred on the origin (what Kip holds). */
export function buildSmallBallMesh(): THREE.Group {
  const g = new T.Group();
  const r = SMALL_BALL_R;
  g.add(M(new T.SphereGeometry(r, 18, 14), plastic("#ff5a4d", { roughness: 0.35, clearcoat: 0.6 }), 0, 0, 0));
  const stripe = M(new T.TorusGeometry(r, r * 0.17, 8, 22), plastic("#fff6ea", { roughness: 0.4 }), 0, 0, 0);
  stripe.rotation.x = Math.PI / 2.4;
  g.add(stripe);
  const stripe2 = M(new T.TorusGeometry(r, r * 0.13, 8, 22), plastic("#52b7ff", { roughness: 0.4 }), 0, 0, 0);
  stripe2.rotation.x = -Math.PI / 3;
  g.add(stripe2);
  return g;
}

/** The ball as a prop lying on the floor at (x, z): the mesh `r` up, in a group on the floor like the big ball's. */
export function buildSmallBall(x: number, z: number): THREE.Group {
  const g = new T.Group();
  g.position.set(x, 0, z);
  const m = buildSmallBallMesh();
  m.position.y = SMALL_BALL_R;
  g.add(m);
  return g;
}
