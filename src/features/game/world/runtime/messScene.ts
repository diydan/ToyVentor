// What the Toy Room's mess mini-interactions are made of (docs/specs/playful-interactions-spec.md, "Spill and clean up" and "Make a mess, clean it up"): the little table with the juice cup,
// the toy box with its six toys, and the puddle. Meshes only; when each moves is messModel.ts, and mess.ts moves them.
//
//   buildCupTable(x, z)  the little blue table with an orange cup of juice on it. `userData.cup` is the cup's pivot (the cup's bottom front rim: rotating it about x tips the cup towards the
//                        camera and lays it on its side), `userData.juice` the juice's top, `userData.stream` the stream of juice off the table edge (hidden until the spill).
//   buildToyBox(x, z)    the open toy box. `userData.boxPivot` is its bottom front edge (rotating it about x leans the box towards the camera), `userData.toys` are the six toys, each a child of
//                        the box's group and sitting in the box until mess.ts moves them.
//   createPuddle()       the puddle: a flat orange ellipse on the floor with a shine, sized and placed by `set`.
import { T, M, rbox, plastic } from "./worldScene";
import { IN_BOX, TOY_SCALE, TOY_KINDS, type Pose, type ToyKind } from "./messModel";
import type * as THREE from "three";

export const TABLE_TOP_Y = 0.9;
export const CUP_R = 0.17;
export const CUP_H = 0.36;
export const TABLE_R = 0.55;
/** The toy box: width, depth and wall height. */
export const BOX_W = 1.9;
export const BOX_D = 1.2;
export const BOX_H = 0.85;

const JUICE = "#ffb347";

/** The little table with the juice cup: its centre on the floor at (x, 0, z). */
export function buildCupTable(x: number, z: number): THREE.Group {
  const g = new T.Group();
  g.position.set(x, 0, z);
  const top = plastic("#52b7ff", { roughness: 0.4 });
  const leg = plastic("#fff6ea", { roughness: 0.6 });
  g.add(M(new T.CylinderGeometry(TABLE_R, TABLE_R, 0.1, 32), top, 0, TABLE_TOP_Y - 0.05, 0));
  g.add(M(new T.CylinderGeometry(0.08, 0.1, TABLE_TOP_Y - 0.1, 14), leg, 0, (TABLE_TOP_Y - 0.1) / 2, 0));
  g.add(M(new T.CylinderGeometry(0.36, 0.4, 0.07, 24), top, 0, 0.035, 0));
  // The cup: an orange tapered cup with a cream rim and a striped straw, hinged at its bottom FRONT rim so a rotation about x lays it on its side towards the camera.
  const pivot = new T.Group();
  pivot.position.set(0, TABLE_TOP_Y, CUP_R);
  const body = plastic("#ff9d5c", { roughness: 0.35 });
  pivot.add(M(new T.CylinderGeometry(CUP_R, CUP_R * 0.78, CUP_H, 20), body, 0, CUP_H / 2, -CUP_R));
  const rim = M(new T.TorusGeometry(CUP_R, 0.025, 8, 24), plastic("#fff6ea", { roughness: 0.5 }), 0, CUP_H, -CUP_R);
  rim.rotation.x = Math.PI / 2;
  pivot.add(rim);
  const juice = M(new T.CylinderGeometry(CUP_R * 0.92, CUP_R * 0.92, 0.02, 20), plastic(JUICE, { roughness: 0.15, transparent: true, opacity: 0.95 }), 0, CUP_H - 0.06, -CUP_R);
  juice.castShadow = false;
  pivot.add(juice);
  const straw = M(new T.CylinderGeometry(0.02, 0.02, 0.4, 6), plastic("#ff5a4d", { roughness: 0.4 }), 0.06, CUP_H + 0.07, -CUP_R + 0.03);
  straw.rotation.z = -0.25;
  pivot.add(straw);
  g.add(pivot);
  // The stream off the table's front edge: a thin ribbon of juice, 1 unit tall, scaled and moved by mess.ts while it runs.
  const stream = M(new T.BoxGeometry(0.07, 1, 0.07), plastic(JUICE, { roughness: 0.1, transparent: true, opacity: 0.9 }), 0, TABLE_TOP_Y / 2, TABLE_R + 0.02);
  stream.castShadow = false;
  stream.userData.noPick = true;
  stream.visible = false;
  g.add(stream);
  g.userData.cup = pivot;
  g.userData.juice = juice;
  g.userData.stream = stream;
  return g;
}

/** One toy at rest, centred on its own origin (poses in messModel.ts put that origin on the floor or in the box). */
export function buildToy(kind: ToyKind): THREE.Group {
  const g = new T.Group();
  switch (kind) {
    case "cube": {
      g.add(M(rbox(0.4, 0.4, 0.4, 0.06), plastic("#ff5a4d", { roughness: 0.4 }), 0, 0, 0));
      g.add(M(rbox(0.22, 0.22, 0.02, 0.02), plastic("#fff6ea", { roughness: 0.5 }), 0, 0, 0.205));
      break;
    }
    case "ball": {
      g.add(M(new T.SphereGeometry(0.22, 20, 14), plastic("#52b7ff", { roughness: 0.3 }), 0, 0, 0));
      const band = M(new T.TorusGeometry(0.22, 0.04, 8, 24), plastic("#fff6ea", { roughness: 0.4 }), 0, 0, 0);
      band.rotation.x = Math.PI / 2.6;
      g.add(band);
      break;
    }
    case "car": {
      g.add(M(rbox(0.62, 0.2, 0.3, 0.06), plastic("#ffd24d", { roughness: 0.35 }), 0, 0, 0));
      g.add(M(rbox(0.3, 0.16, 0.26, 0.05), plastic("#fff6ea", { roughness: 0.4 }), -0.04, 0.17, 0));
      for (const [wx, wz] of [[-0.2, 0.16], [0.2, 0.16], [-0.2, -0.16], [0.2, -0.16]] as const) {
        const w = M(new T.CylinderGeometry(0.075, 0.075, 0.06, 12), plastic("#2a1a3a", { roughness: 0.6, clearcoat: 0.1 }), wx, -0.07, wz);
        w.rotation.x = Math.PI / 2;
        g.add(w);
      }
      break;
    }
    case "star": {
      const s = new T.Shape();
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2 - Math.PI / 2, r = k % 2 ? 0.12 : 0.27;
        if (k === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r); else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      s.closePath();
      const geo = new T.ExtrudeGeometry(s, { depth: 0.1, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 2 });
      geo.translate(0, 0, -0.05);
      g.add(M(geo, plastic("#c07aff", { roughness: 0.35 }), 0, 0, 0));
      break;
    }
    case "duck": {
      const yellow = plastic("#ffe27a", { roughness: 0.4 });
      const body = M(new T.SphereGeometry(0.2, 16, 12), yellow, 0, 0, 0);
      body.scale.set(1.2, 0.9, 0.9);
      g.add(body);
      g.add(M(new T.SphereGeometry(0.12, 14, 10), yellow, 0.16, 0.18, 0));
      const beak = M(new T.ConeGeometry(0.05, 0.12, 8), plastic("#ff9d5c", { roughness: 0.4 }), 0.3, 0.17, 0);
      beak.rotation.z = -Math.PI / 2;
      g.add(beak);
      g.add(M(new T.SphereGeometry(0.018, 6, 6), plastic("#2a1a3a", { roughness: 0.5 }), 0.22, 0.23, 0.08));
      break;
    }
    case "ring": {
      const torus = M(new T.TorusGeometry(0.18, 0.065, 10, 24), plastic("#5af0b0", { roughness: 0.35 }), 0, 0, 0);
      g.add(torus);
      break;
    }
  }
  g.scale.setScalar(TOY_SCALE);
  return g;
}

/** Put a toy (or anything) at a pose in its parent's frame. */
export function placeAt(o: THREE.Object3D, p: Pose): void {
  o.position.set(p.x, p.y, p.z);
  o.rotation.set(p.rx, p.ry, p.rz);
}

/** The toy box with its toys in it, its centre on the floor at (x, 0, z). */
export function buildToyBox(x: number, z: number): THREE.Group {
  const g = new T.Group();
  g.position.set(x, 0, z);
  const wall = plastic("#52b7ff", { roughness: 0.45 });
  const trim = plastic("#ffd24d", { roughness: 0.4 });
  // The box leans about its bottom FRONT edge, so it lives in a pivot group at that edge and is offset back by half its depth.
  const pivot = new T.Group();
  pivot.position.set(0, 0, BOX_D / 2);
  const inner = new T.Group();
  inner.position.set(0, 0, -BOX_D / 2);
  inner.add(M(rbox(BOX_W, 0.12, BOX_D, 0.04), wall, 0, 0.06, 0));
  inner.add(M(rbox(BOX_W, BOX_H, 0.1, 0.03), wall, 0, BOX_H / 2, BOX_D / 2 - 0.05));
  inner.add(M(rbox(BOX_W, BOX_H, 0.1, 0.03), wall, 0, BOX_H / 2, -BOX_D / 2 + 0.05));
  inner.add(M(rbox(0.1, BOX_H, BOX_D, 0.03), wall, -BOX_W / 2 + 0.05, BOX_H / 2, 0));
  inner.add(M(rbox(0.1, BOX_H, BOX_D, 0.03), wall, BOX_W / 2 - 0.05, BOX_H / 2, 0));
  inner.add(M(rbox(BOX_W + 0.04, 0.1, 0.14, 0.03), trim, 0, BOX_H - 0.05, BOX_D / 2 - 0.05));        // a yellow rim along the front
  inner.add(M(rbox(BOX_W - 0.5, 0.2, 0.03, 0.02), trim, 0, 0.38, BOX_D / 2 + 0.02));                  // and a label band
  pivot.add(inner);
  g.add(pivot);
  const toys: THREE.Object3D[] = [];
  TOY_KINDS.forEach((kind, i) => {
    const t = buildToy(kind);
    placeAt(t, IN_BOX[i]!);
    g.add(t);
    toys.push(t);
  });
  g.userData.boxPivot = pivot;
  g.userData.toys = toys;
  return g;
}

export interface Puddle {
  group: THREE.Group;
  /** Place its centre on the floor at (x, z) and set how much of it there is: `size` is a fraction of (rx, rz). 0 hides it. */
  set(x: number, z: number, size: number, rx: number, rz: number): void;
  dispose(): void;
}

let softEdge: THREE.CanvasTexture | null = null;
/** A radial fade (white in the middle to black at the edge) so the puddle's rim is soft, made once; none where there is no canvas. */
function softEdgeMap(): THREE.CanvasTexture | null {
  if (softEdge) return softEdge;
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "#fff");
  grad.addColorStop(0.72, "#fff");
  grad.addColorStop(1, "#000");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  softEdge = new T.CanvasTexture(c);
  return softEdge;
}

export function createPuddle(): Puddle {
  const group = new T.Group();
  group.visible = false;
  const flat = new T.CircleGeometry(1, 40);
  flat.rotateX(-Math.PI / 2);
  const map = softEdgeMap();
  const pool = new T.Mesh(flat, new T.MeshStandardMaterial({ color: JUICE, roughness: 0.12, metalness: 0, transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, ...(map ? { alphaMap: map } : {}) }));
  pool.position.y = 0.035;
  pool.renderOrder = 2;
  pool.receiveShadow = true;
  pool.userData.noPick = true;
  const shine = new T.Mesh(flat, new T.MeshBasicMaterial({ color: "#fff1c4", transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, ...(map ? { alphaMap: map } : {}) }));
  shine.position.set(-0.18, 0.04, -0.1);
  shine.scale.set(0.42, 1, 0.3);
  shine.renderOrder = 3;
  shine.userData.noPick = true;
  group.add(pool, shine);
  return {
    group,
    set(x, z, size, rx, rz) {
      group.position.set(x, 0, z);
      group.scale.set(Math.max(1e-4, rx * size), 1, Math.max(1e-4, rz * size));
      group.visible = size > 0.002;
    },
    dispose() {
      group.parent?.remove(group);
      flat.dispose();
      (pool.material as THREE.Material).dispose();
      (shine.material as THREE.Material).dispose();
    },
  };
}
