// What the cleaning level is made of (docs/specs/play-design-spec.md, "Activity levels", activity 1): the dirt (crumbs, a puddle, jam), the vacuum and the soapy sponge Kip holds (the mop is mop.ts),
// the tool head that follows the child's finger, the bucket of soapy water and the cleaning cart that is the Toy Room prop. Meshes only; the numbers are cleanModel.ts and scrub.ts, and
// clean.ts moves them. Primitive-built stand-ins, like the mop.
//
//   createDirt(kind, cells, brush)   the dirt cells as instances of one mesh: `set(clean)` marks the cells the scrub primitive has cleared (they shrink away), `update(dt, reduced)` eases it
//   buildVacuumMesh / buildSpongeMesh  the held tools (head on the floor at the origin, handle up, like buildMopMesh)
//   createToolHead()                 the one tool shown under the finger while the child scrubs: `show(tool, x, z)`, `hide()`
//   buildBucket()                    the bucket of soapy water; `userData.suds` is the foam, scaled by `setSuds`
//   buildCleanCart(x, z)             the Toy Room prop: a bucket with a mop and a sponge in it, a spray bottle beside
import { T, M, rbox, plastic } from "./worldScene";
import { buildMopMesh } from "./mop";
import type { CleanMess } from "./cleanModel";
import type { ScrubPoint, ScrubTool } from "./scrub";
import type * as THREE from "three";

export interface Dirt {
  group: THREE.Group;
  /** Mark which cells are clean (1) and which are not. The cleared ones shrink away on `update`. */
  set(clean: Uint8Array): void;
  /** Ease the cells toward their marks. With `reduced` they jump. */
  update(dt: number, reduced: boolean): void;
  /** Cells still showing. */
  readonly visibleCount: number;
  /** Drop the dirt in all at once (the mess lands) or grow it over a moment. */
  appear(reduced: boolean): void;
  dispose(): void;
}

const DIRT_COLOR: Record<CleanMess, string> = { crumbs: "#d9a05b", puddle: "#52b7ff", jam: "#b3123e" };

/** The dirt: one instance per scrub cell. `brush` sizes the blobs so the cells of a puddle or jam run together; crumbs stay small. */
export function createDirt(kind: CleanMess, cells: readonly ScrubPoint[], brush: number): Dirt {
  const group = new T.Group();
  let geo: THREE.BufferGeometry;
  let y = 0.04;
  if (kind === "crumbs") { geo = new T.BoxGeometry(0.2, 0.1, 0.18); y = 0.05; }
  else { geo = new T.CylinderGeometry(brush * (kind === "puddle" ? 1.1 : 0.95), brush * (kind === "puddle" ? 1.1 : 0.95), kind === "puddle" ? 0.03 : 0.07, 18); y = kind === "puddle" ? 0.02 : 0.04; }
  const mat = kind === "crumbs" ? plastic(DIRT_COLOR[kind], { roughness: 0.8, clearcoat: 0.05 }) : plastic(DIRT_COLOR[kind], { roughness: 0.12, clearcoat: 1 });
  const mesh = new T.InstancedMesh(geo, mat, cells.length);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.userData.noPick = true;
  mesh.frustumCulled = false;
  group.add(mesh);
  const target = new Float32Array(cells.length).fill(1);
  const cur = new Float32Array(cells.length).fill(0);
  let visible = cells.length;
  const dummy = new T.Object3D();
  const place = (i: number) => {
    const c = cells[i]!;
    const s = Math.max(0.0001, cur[i]!);
    dummy.position.set(c.x, y, c.z);
    dummy.rotation.set(0, kind === "crumbs" ? ((i * 2.399) % 3.14) : 0, 0);
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  };
  for (let i = 0; i < cells.length; i++) place(i);
  mesh.instanceMatrix.needsUpdate = true;
  return {
    group,
    set(clean) { for (let i = 0; i < cells.length; i++) target[i] = clean[i] ? 0 : 1; },
    update(dt, reduced) {
      let n = 0, changed = false;
      for (let i = 0; i < cells.length; i++) {
        const goal = target[i]!;
        const was = cur[i]!;
        const next = reduced ? goal : was + Math.sign(goal - was) * Math.min(Math.abs(goal - was), dt * 6);
        if (next !== was) { cur[i] = next; place(i); changed = true; }
        if (cur[i]! > 0.001 || target[i]! > 0) n++;
      }
      visible = n;
      if (changed) mesh.instanceMatrix.needsUpdate = true;
      group.visible = n > 0;
    },
    get visibleCount() { return visible; },
    appear(reduced) { cur.fill(reduced ? 1 : 0); for (let i = 0; i < cells.length; i++) place(i); mesh.instanceMatrix.needsUpdate = true; visible = cells.length; group.visible = true; },
    dispose() { group.parent?.remove(group); geo.dispose(); mesh.dispose(); },
  };
}

/** A vacuum cleaner standing on its head: the head's middle on the floor at the origin, the tube going up (+y), the bag near the top. */
export function buildVacuumMesh(): THREE.Group {
  const g = new T.Group();
  g.add(M(rbox(0.6, 0.13, 0.32, 0.04), plastic("#ff5a4d", { roughness: 0.4 }), 0, 0.07, 0));                         // the head
  g.add(M(new T.CylinderGeometry(0.035, 0.04, 1.35, 10), plastic("#cfd8ff", { roughness: 0.3 }), 0, 0.8, 0));          // the tube
  g.add(M(rbox(0.34, 0.5, 0.26, 0.07), plastic("#52b7ff", { roughness: 0.45 }), 0, 0.5, 0.0));                         // the dust bag
  g.add(M(new T.CylinderGeometry(0.025, 0.025, 0.3, 8), plastic("#2a1a3a", { roughness: 0.6 }), 0, 1.55, 0).rotateZ(Math.PI / 2));   // the handle
  return g;
}

/** A soapy sponge on a handle: like the mop, with a yellow sponge for a head and a few white suds on it. */
export function buildSpongeMesh(): THREE.Group {
  const g = new T.Group();
  g.add(M(new T.CylinderGeometry(0.035, 0.04, 1.4, 10), plastic("#ff9d5c", { roughness: 0.5 }), 0, 0.3 + 0.7, 0));
  g.add(M(rbox(0.5, 0.2, 0.34, 0.06), plastic("#ffd24d", { roughness: 0.85, clearcoat: 0.05 }), 0, 0.12, 0));
  for (const [x, z] of [[-0.14, 0.1], [0.1, 0.05], [0.18, -0.08], [-0.05, -0.1]] as const) g.add(M(new T.SphereGeometry(0.07, 8, 6), plastic("#ffffff", { roughness: 0.3 }), x, 0.27, z));
  return g;
}

export interface ToolHead {
  group: THREE.Group;
  show(tool: ScrubTool | null, x: number, z: number): void;
  hide(): void;
  readonly tool: ScrubTool | null;
  dispose(): void;
}

/** The tool under the child's finger, standing on the floor where the finger is. */
export function createToolHead(): ToolHead {
  const group = new T.Group();
  group.visible = false;
  const made = new Map<ScrubTool, THREE.Group>();
  let shown: ScrubTool | null = null;
  const build = (t: ScrubTool): THREE.Group => (t === "vacuum" ? buildVacuumMesh() : t === "sponge" ? buildSpongeMesh() : buildMopMesh());
  return {
    group,
    show(tool, x, z) {
      if (!tool) { group.visible = false; shown = null; return; }
      if (tool !== shown) {
        for (const g of made.values()) g.visible = false;
        let g = made.get(tool);
        if (!g) { g = build(tool); g.scale.setScalar(0.85); g.rotation.z = 0.22; g.traverse((o) => { o.userData.noPick = true; }); group.add(g); made.set(tool, g); }
        g.visible = true;
        shown = tool;
      }
      group.position.set(x, 0, z);
      group.visible = true;
    },
    hide() { group.visible = false; },
    get tool() { return shown; },
    dispose() { group.parent?.remove(group); },
  };
}

/** The bucket of soapy water. `userData.suds` is the foam on top (scale it with setSuds, 0 to 1). */
export function buildBucket(): THREE.Group {
  const g = new T.Group();
  g.add(M(new T.CylinderGeometry(0.45, 0.36, 0.55, 20), plastic("#52b7ff", { roughness: 0.4 }), 0, 0.275, 0));
  const rim = M(new T.TorusGeometry(0.45, 0.035, 8, 24), plastic("#ffd24d", { roughness: 0.4 }), 0, 0.55, 0);
  rim.rotation.x = Math.PI / 2;
  g.add(rim);
  const water = M(new T.CylinderGeometry(0.4, 0.4, 0.02, 20), plastic("#9fe3ff", { roughness: 0.1 }), 0, 0.5, 0);
  g.add(water);
  const suds = new T.Group();
  suds.position.set(0, 0.52, 0);
  for (const [x, y, z, r] of [[0, 0.05, 0, 0.17], [-0.2, 0.02, 0.08, 0.12], [0.2, 0.03, -0.06, 0.13], [0.06, 0.12, 0.16, 0.1], [-0.08, 0.1, -0.15, 0.1]] as const) suds.add(M(new T.SphereGeometry(r, 10, 8), plastic("#ffffff", { roughness: 0.3 }), x, y, z));
  suds.scale.setScalar(0.0001);
  g.add(suds);
  g.userData.suds = suds;
  return g;
}

/** Foam on the bucket: 0 = none, 1 = full. */
export function setSuds(bucket: THREE.Object3D, level: number): void {
  const s = bucket.userData.suds as THREE.Object3D | undefined;
  if (s) s.scale.setScalar(Math.max(0.0001, Math.min(1, level)));
}

/** The Toy Room prop: a bucket with a mop leaning in it, a sponge on its rim and a spray bottle beside, its centre on the floor at (x, 0, z). */
export function buildCleanCart(x: number, z: number): THREE.Group {
  const g = new T.Group();
  g.position.set(x, 0, z);
  g.add(buildBucket());
  const mop = buildMopMesh();
  mop.scale.setScalar(0.62);
  mop.position.set(0.1, 0.42, -0.05);
  mop.rotation.z = -0.5;
  g.add(mop);
  g.add(M(rbox(0.36, 0.14, 0.24, 0.05), plastic("#ffd24d", { roughness: 0.85, clearcoat: 0.05 }), -0.35, 0.62, 0.0));
  const bottle = new T.Group();
  bottle.position.set(0.72, 0, 0.1);
  bottle.add(M(new T.CylinderGeometry(0.13, 0.15, 0.5, 14), plastic("#5af0b0", { roughness: 0.35 }), 0, 0.25, 0));
  bottle.add(M(new T.CylinderGeometry(0.06, 0.09, 0.14, 12), plastic("#ffffff", { roughness: 0.4 }), 0, 0.57, 0));
  bottle.add(M(rbox(0.2, 0.08, 0.08, 0.02), plastic("#ff5a4d", { roughness: 0.4 }), 0.1, 0.66, 0));
  g.add(bottle);
  g.userData.cleanCart = true;
  return g;
}
