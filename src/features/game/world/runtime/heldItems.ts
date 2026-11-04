// Things Kip holds while it plays (docs/specs/playful-interactions-spec.md section 6): the book it reads, the guitar it strums, the bubble wand it blows. Each is a small mesh attached to a part of Kip's rig for the
// length of the act: the book and the guitar to the body (so they follow where Kip turns), the wand to the right arm (so it goes up to the mouth with the hand). `createHeld` keeps track of the one thing held, so
// picking something up lets go of whatever was in the hand, and `release` is safe whenever. The placements are numbers in the rig's own space, tuned by eye against screenshots (scripts/e2e-toyroom2.mjs).
import { T, M, rbox, plastic } from "./worldScene";
import { HELD_GUITAR_SCALE, buildGuitarMesh } from "./guitar";
import { buildWandMesh } from "./bubbleWand";
import { buildMalletMesh } from "./xylophone";
import { buildMopMesh } from "./mop";
import { buildSpongeMesh, buildVacuumMesh } from "./cleanScene";
import { buildSpatulaMesh } from "./cookScene";
import type * as THREE from "three";

export type HeldItem = "book" | "guitar" | "wand" | "mallets" | "mop" | "vacuum" | "sponge" | "spatula";

/** A small hardback book: a coloured cover, cream pages and a spine, flat, about 0.7 by 0.5. */
export function buildBookMesh(): THREE.Group {
  const g = new T.Group();
  const cover = plastic("#52b7ff", { roughness: 0.5 });
  g.add(M(rbox(0.7, 0.07, 0.5, 0.02), cover, 0, 0, 0));
  g.add(M(rbox(0.64, 0.09, 0.44, 0.015), plastic("#fff6ea", { roughness: 0.8 }), 0.015, 0.005, 0));
  g.add(M(rbox(0.7, 0.07, 0.5, 0.02), cover, 0, 0.07, 0));
  g.add(M(rbox(0.04, 0.16, 0.5, 0.01), plastic("#ff9d5c", { roughness: 0.5 }), -0.34, 0.035, 0));
  return g;
}

export interface HeldSpec {
  /** What it is attached to: the rig's body group, the right arm (rig.arms[1]), or both arms (one copy in each hand). */
  parent: "model" | "armR" | "arms";
  position: readonly [number, number, number];
  rotation: readonly [number, number, number];
  scale: number;
  build(): THREE.Group;
}

export const HELD: Readonly<Record<HeldItem, HeldSpec>> = {
  // Held open in front of the chest, tilted up a little so the reader and the camera can see the cover.
  book: { parent: "model", position: [0.55, 1.2, 0], rotation: [0, 0, 0.55], scale: 1, build: buildBookMesh },
  // Across the body with the neck pointing forward and up (+x is forward), the body at the hip.
  guitar: { parent: "model", position: [0.3, 1.0, 0.28], rotation: [0, 0, -1.15], scale: HELD_GUITAR_SCALE, build: buildGuitarMesh },
  // In the right hand, the ring end continuing the line of the arm (the arm points along its own -y).
  wand: { parent: "armR", position: [0, -0.42, 0.05], rotation: [0, 0, Math.PI], scale: 1, build: buildWandMesh },
  // A mallet in each hand, the stick continuing the line of the arm and the head at its far end.
  mallets: { parent: "arms", position: [0, -0.38, 0.05], rotation: [0, 0, Math.PI], scale: 1, build: buildMalletMesh },
  // A mop slanted across the front of the body, the head on the floor ahead of Kip and the handle up against its chest (+x is forward); the body rocking while it mops moves it too.
  mop: { parent: "model", position: [0.95, 0.02, 0.05], rotation: [0, 0, 0.62], scale: 1, build: buildMopMesh },
  // The cleaning level's other two tools, held the same way as the mop (cleanScene.ts): the upright vacuum and the soapy sponge on a handle.
  vacuum: { parent: "model", position: [0.95, 0.02, 0.05], rotation: [0, 0, 0.62], scale: 1, build: buildVacuumMesh },
  sponge: { parent: "model", position: [0.95, 0.02, 0.05], rotation: [0, 0, 0.62], scale: 1, build: buildSpongeMesh },
  // The cooking level's spatula, held the same way (cookScene.ts).
  spatula: { parent: "model", position: [0.95, 0.02, 0.05], rotation: [0, 0, 0.62], scale: 1, build: buildSpatulaMesh },
};

export function createHeld() {
  let current: { item: HeldItem; meshes: THREE.Object3D[] } | null = null;
  const release = () => {
    if (!current) return;
    for (const m of current.meshes) m.parent?.remove(m);
    current = null;
  };
  return {
    get item(): HeldItem | null { return current ? current.item : null; },
    /** The thing held (for a pair, the one in the right hand). */
    get mesh(): THREE.Object3D | null { return current ? current.meshes[0]! : null; },
    /** Everything attached: one mesh, or two for a pair (right hand first, then left). */
    get meshes(): readonly THREE.Object3D[] { return current ? current.meshes : []; },
    /** Put `item` in Kip's hands: attach it to the right part of the rig (`model` is the body group, `armR` the right arm, `armL` the left, if the rig has them). Whatever was held is let go first. False if it cannot be attached. */
    hold(item: HeldItem, model: THREE.Object3D | null | undefined, armR: THREE.Object3D | null | undefined, armL?: THREE.Object3D | null): boolean {
      release();
      const spec = HELD[item];
      const parents = spec.parent === "arms" ? [armR, armL] : [spec.parent === "armR" ? armR : model];
      if (parents.some((p) => !p)) return false;
      const meshes = parents.map((parent) => {
        const mesh = spec.build();
        mesh.position.set(...spec.position);
        mesh.rotation.set(...spec.rotation);
        mesh.scale.setScalar(spec.scale);
        parent!.add(mesh);
        return mesh;
      });
      current = { item, meshes };
      return true;
    },
    release,
  };
}

export type Held = ReturnType<typeof createHeld>;
