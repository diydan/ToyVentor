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
import { buildBouquetMesh, buildCanMesh, buildCarrotMesh, buildSandwichMesh } from "./outdoorProps";
import { buildSmallBallMesh } from "./smallBall";
import type * as THREE from "three";

export type HeldItem = "book" | "guitar" | "wand" | "mallets" | "mop" | "vacuum" | "sponge" | "spatula" | "can" | "carrot" | "bouquet" | "sandwich" | "smallball";

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
  /**
   * Tools and the book stay in the body's frame, so how they are tilted does not depend on how the arms are bent, but are moved every frame (`follow`) so that this point of them, in their
   * own frame, is in the fist (or midway between the fists, `both`): the handle always passes through the hands, whatever the clip does with the arms.
   */
  hands?: { grip: readonly [number, number, number]; both?: boolean };
  /** For an item held in a fist: the point of the item (in its own frame) that goes in the fist, in place of its origin: the can's handle, say. `position` then moves the item from there. */
  at?: readonly [number, number, number];
}

/** Where the fist is in an ARM HOLDER's frame (a rig that has no grip anchors, rig.grips, holds things from the holder: the same place, 0.85 down the arm). */
export const ARM_FIST: readonly [number, number, number] = [0.125, -0.845, 0];

/*
 * Held items, in the frame of what they are attached to. For `armR` and `arms` that is the GRIP (the fist, a child of the hand, turned to the arm holder's own frame: y down the arm, +x forward,
 * z across; the origin is where the fist closes), so an item sits in the hand in every pose. Dan, 2026-11-04: "holding props is often in the wrong orientation": they used to hang off the arm
 * 0.4 to 0.5 down it, the middle of the one-piece Snap sleeve (the fist is 0.85 down), so the can, the carrot and the sandwich were round the forearm and the mop and the book missed the hands.
 */
export const HELD: Readonly<Record<HeldItem, HeldSpec>> = {
  // Held open between the two hands, tilted up a little so the reader and the camera can see the cover (the hands are 0.8 apart: the book is that wide).
  book: { parent: "model", position: [0.55, 1.2, 0], rotation: [0, 0, 0.55], scale: 1.45, build: buildBookMesh, hands: { grip: [0, 0.035, 0], both: true } },
  // Across the body with the neck pointing forward and up (+x is forward), the body at the hip.
  guitar: { parent: "model", position: [0.3, 1.0, 0.28], rotation: [0, 0, -1.15], scale: HELD_GUITAR_SCALE, build: buildGuitarMesh },
  // In the right fist, the ring end continuing the line of the arm (the arm points along its own -y).
  wand: { parent: "armR", position: [0, 0, 0], rotation: [0, 0, Math.PI], scale: 1, build: buildWandMesh },
  // A mallet in each fist, the stick continuing the line of the arm and the head at its far end.
  mallets: { parent: "arms", position: [0, 0, 0], rotation: [0, 0, Math.PI], scale: 1, build: buildMalletMesh },
  // A mop slanted across the front of the body, the head on the floor ahead of Kip and the handle through his hands (+x is forward); the body rocking while it mops moves it too.
  mop: { parent: "model", position: [0.95, 0.02, 0.05], rotation: [0, 0, 0.62], scale: 1, build: buildMopMesh, hands: { grip: [0, 1.15, 0], both: true } },
  // The cleaning level's other two tools, held the same way as the mop (cleanScene.ts): the upright vacuum and the soapy sponge on a handle.
  vacuum: { parent: "model", position: [0.95, 0.02, 0.05], rotation: [0, 0, 0.62], scale: 1, build: buildVacuumMesh, hands: { grip: [0, 1.15, 0], both: true } },
  sponge: { parent: "model", position: [0.95, 0.02, 0.05], rotation: [0, 0, 0.62], scale: 1, build: buildSpongeMesh, hands: { grip: [0, 1.15, 0], both: true } },
  // The cooking level's spatula, held the same way (cookScene.ts).
  spatula: { parent: "model", position: [0.95, 0.02, 0.05], rotation: [0, 0, 0.62], scale: 1, build: buildSpatulaMesh, hands: { grip: [0, 1.15, 0], both: true } },
  // The outdoor things (playthings.ts), all in the right fist. The watering can is turned a quarter so it is upright and its spout points ahead while the arm is out level (it is only picked up once the arm is out);
  // the carrot points along the arm (its tip towards the bunny); the bouquet and the sandwich are held at the fist.
  can: { parent: "armR", position: [0, 0, 0], rotation: [0, 0, -Math.PI / 2], scale: 1.1, build: buildCanMesh, at: [-0.33, 0.3, 0] },  // by its handle (the arc on its back)
  carrot: { parent: "armR", position: [0, 0, 0], rotation: [0, 0, 0], scale: 1.7, build: buildCarrotMesh },
  bouquet: { parent: "armR", position: [0, 0, 0], rotation: [0, 0, Math.PI], scale: 1, build: buildBouquetMesh },
  sandwich: { parent: "armR", position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, build: buildSandwichMesh },
  // The small ball, in the right fist (the throw: toyRoomActs.ts `throwVisit`).
  smallball: { parent: "armR", position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, build: buildSmallBallMesh },
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
        placeHeldMesh(mesh, spec, parent!);
        parent!.add(mesh);
        return mesh;
      });
      current = { item, meshes };
      return true;
    },
    release,
    /**
     * Call it every frame after the arms are posed: a tool or the book (a spec with `hands`) is moved so its grip point is in the fist (midway between the fists for `both`), keeping the tilt it was given.
     * `model` is the body group it hangs from, `grips` the two fist anchors (left, right: rig.grips). Does nothing for anything else, or when the rig has no grips.
     */
    follow(model: THREE.Object3D | null | undefined, grips: ReadonlyArray<THREE.Object3D | null | undefined> | null | undefined): void {
      if (!current || !model || !grips) return;
      followHandsMesh(current.meshes[0]!, HELD[current.item], model, grips);
    },
  };
}
const _target = new T.Vector3(), _other = new T.Vector3(), _grip = new T.Vector3(), _at = new T.Vector3();

/** Put a freshly built item where its spec says in `parent`'s frame: the spec's place and turn, its own grip point (`at`) in the fist, and (from an arm holder rather than a fist) the fist's distance down the arm. */
export function placeHeldMesh(mesh: THREE.Object3D, spec: HeldSpec, parent: THREE.Object3D): void {
  mesh.position.set(...spec.position);
  mesh.rotation.set(...spec.rotation);
  if (spec.at) mesh.position.sub(_at.set(...spec.at).multiplyScalar(spec.scale).applyEuler(mesh.rotation));   // the item's own grip point goes where its origin would have been
  if (spec.parent !== "model" && !parent.userData.grip) mesh.position.add({ x: ARM_FIST[0], y: ARM_FIST[1], z: ARM_FIST[2] } as THREE.Vector3);     // from an arm holder, not a grip: the fist is that far down it
  mesh.scale.setScalar(spec.scale);
}

/** A tool or the book (a spec with `hands`) hung from `model`: move it so its grip point is in the fist, or midway between the fists, keeping its tilt. True when it did. */
export function followHandsMesh(mesh: THREE.Object3D, spec: HeldSpec, model: THREE.Object3D | null | undefined, grips: ReadonlyArray<THREE.Object3D | null | undefined> | null | undefined): boolean {
  if (!spec.hands || !model || !grips || mesh.parent !== model) return false;
  const right = grips[1], left = grips[0];
  if (!right) return false;
  model.updateWorldMatrix(true, false);
  right.updateWorldMatrix(true, false);
  right.getWorldPosition(_target);
  if (spec.hands.both && left) { left.updateWorldMatrix(true, false); left.getWorldPosition(_other); _target.add(_other).multiplyScalar(0.5); }
  model.worldToLocal(_target);
  _grip.set(...spec.hands.grip).multiplyScalar(spec.scale).applyEuler(mesh.rotation);   // where the grip point is from the item's origin, in the body's frame
  mesh.position.copy(_target).sub(_grip);
  return true;
}

export type Held = ReturnType<typeof createHeld>;
