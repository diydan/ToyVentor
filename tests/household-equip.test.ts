// A household library item in Kip's hand (parts/kip/viewer/kip-forge-sdk.js: buildHouseholdHandMesh; docs/specs/household-library-spec.md).
//
// Every built item in the committed catalog is read back through three's own GLTFLoader (not the build's writer) and put in the hand, and the hand
// slot is checked against the photo accessory's, which is the reference: the same handle, collar and group pose, the item standing on the handle with
// its front where a photo plate's front is. The real page (scripts/e2e-kip-household.mjs) checks the same thing through the bench, with the clip.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";
// @ts-expect-error the viewer is plain JavaScript
import { buildHouseholdHandMesh, buildPhotoAccessoryMesh } from "../parts/kip/viewer/kip-forge-sdk.js";

const ROOT = join(__dirname, "..");
const catalog = JSON.parse(readFileSync(join(ROOT, "public/kip/household/catalog.json"), "utf8")) as { items: { id: string; label: string; built: boolean; glb: string | null; propMm: number; tris: number; zones: { name: string; hex: string }[] }[] };
const built = catalog.items.filter((i) => i.built);

async function load(file: string): Promise<THREE.Group> {
  const buf = readFileSync(join(ROOT, "public/kip/household", file));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const gltf = await new GLTFLoader().parseAsync(ab, "");
  return gltf.scene;
}

type Hand = THREE.Group;
const parts = (root: Hand) => {
  const grip = root.children[0] as THREE.Group;
  return { grip, handle: grip.children[0] as THREE.Mesh, collar: grip.children[1] as THREE.Mesh, head: grip.children[2] as THREE.Object3D };
};
const itemOf = (root: Hand) => parts(root).head.children[0] as THREE.Object3D;

/** The item's library axes in the head's frame (the frame the handle's +Y runs along): its up (library +z) and its front (library +y). */
function axesInHead(root: Hand): { up: THREE.Vector3; front: THREE.Vector3 } {
  root.updateMatrixWorld(true);
  const { head } = parts(root);
  const item = itemOf(root);
  const toHead = new THREE.Matrix4().copy(head.matrixWorld).invert();
  const dir = (v: THREE.Vector3) => v.clone().transformDirection(item.matrixWorld).transformDirection(toHead);
  // the GLB holds library (x, y, z) as (x, z, -y): up is glTF +y, front is glTF -z
  return { up: dir(new THREE.Vector3(0, 1, 0)), front: dir(new THREE.Vector3(0, 0, -1)) };
}

function boxInHead(root: Hand): THREE.Box3 {
  root.updateMatrixWorld(true);
  const { head } = parts(root);
  const toHead = new THREE.Matrix4().copy(head.matrixWorld).invert();
  const box = new THREE.Box3();
  itemOf(root).traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const pos = m.geometry.attributes.position!;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).applyMatrix4(toHead));
  });
  return box;
}

const near = (v: THREE.Vector3, x: number, y: number, z: number, eps = 1e-6) => Math.abs(v.x - x) < eps && Math.abs(v.y - y) < eps && Math.abs(v.z - z) < eps;

describe("a library item in the hand slot", () => {
  it("there are built items to check (the catalog says which, not this test)", () => {
    expect(built.length).toBeGreaterThan(0);
  });

  it.each(built.map((i) => [i.id, i] as const))("%s: stands on the handle, in mm, with its front on +z and its grip at the handle's top", async (_id, item) => {
    const scene = await load(item.glb!);
    const hand = buildHouseholdHandMesh(THREE, scene, { id: item.id, label: item.label }) as Hand;
    const { up, front } = axesInHead(hand);
    // up is the handle's +Y, and the front is +z: where a photo plate's front is
    expect(near(up, 0, 1, 0, 1e-5), `up ${up.toArray()}`).toBe(true);
    expect(near(front, 0, 0, 1, 1e-5), `front ${front.toArray()}`).toBe(true);
    // millimetres, standing on the handle: the lowest point is the head's origin, the longest side is the prop size
    const box = boxInHead(hand);
    const size = box.getSize(new THREE.Vector3());
    expect(box.min.y).toBeCloseTo(0, 2);
    expect(Math.max(size.x, size.y, size.z)).toBeCloseTo(item.propMm, 1);
    // the shaft's axis passes through the item: the handle's line (x = z = 0 in the head) is inside the item's footprint
    expect(box.min.x).toBeLessThanOrEqual(1e-3);
    expect(box.max.x).toBeGreaterThanOrEqual(-1e-3);
    expect(box.min.z).toBeLessThanOrEqual(1e-3);
    expect(box.max.z).toBeGreaterThanOrEqual(-1e-3);
    // what it says about itself
    expect(hand.userData).toMatchObject({ digitalOnly: true, prints: false, slot: "hand", household: { id: item.id, label: item.label }, triCount: item.tris });
  });

  it("the handle, the collar and the group's pose are the photo accessory's, number for number", async () => {
    const seg = { mask: new Uint8Array(64 * 64), width: 64, height: 64 };
    for (let y = 8; y < 56; y++) for (let x = 20; x < 44; x++) seg.mask[y * 64 + x] = 1;
    const photo = buildPhotoAccessoryMesh(THREE, { width: 64, height: 64 } as unknown as HTMLCanvasElement, seg, { slot: "hand" }) as Hand;
    const pg = parts(photo);
    const scene = await load(built[0]!.glb!);
    const lib = buildHouseholdHandMesh(THREE, scene, {}) as Hand;
    const lg = parts(lib);
    expect(lg.grip.rotation.toArray().slice(0, 3)).toEqual(pg.grip.rotation.toArray().slice(0, 3));
    expect(lg.grip.position.toArray()).toEqual(pg.grip.position.toArray());
    for (const k of ["handle", "collar"] as const) {
      const a = lg[k].geometry as THREE.CylinderGeometry;
      const b = pg[k].geometry as THREE.CylinderGeometry;
      expect(a.parameters, k).toEqual(b.parameters);
      expect(lg[k].position.toArray(), k).toEqual(pg[k].position.toArray());
    }
    // the head stands where the plate's body stands, and the plate's front (an extrusion, front cap on +z) is on +z, as the item's is
    expect(lg.head.position.toArray()).toEqual(pg.head.position.toArray());
    const plate = pg.head as THREE.Mesh;
    const pos = plate.geometry.attributes.position!;
    const zs = Array.from({ length: pos.count }, (_, i) => pos.getZ(i));
    expect(Math.max(...zs)).toBeGreaterThan(0);
    expect(Math.min(...zs)).toBeLessThan(0); // an extrusion about z = 0: its two caps face +z and -z
  });

  it("the front check can fail: an item turned the wrong way round is caught, and so is one left unturned", async () => {
    const item = built.find((i) => i.id === "wooden_spoon") ?? built[0]!;
    const scene = await load(item.glb!);
    const hand = buildHouseholdHandMesh(THREE, scene, { id: item.id, label: item.label }) as Hand;
    itemOf(hand).rotation.y += Math.PI; // turned back to face away
    expect(near(axesInHead(hand).front, 0, 0, 1, 1e-5)).toBe(false);
    expect(near(axesInHead(hand).front, 0, 0, -1, 1e-5)).toBe(true);
    // the same scene put in with no half turn (the GLB's own frame): front is -z
    const bare = scene.clone(true);
    bare.scale.setScalar(1000);
    const plain = new THREE.Group();
    plain.add(new THREE.Group().add(new THREE.Group(), new THREE.Group(), new THREE.Group().add(bare)));
    const holder = parts(plain as Hand).head;
    expect(holder.children[0]).toBe(bare);
    const front = new THREE.Vector3(0, 0, -1).transformDirection(bare.matrixWorld);
    expect(front.z).toBeLessThan(0);
  });

  it("a yaw turns the item about its own up axis and nothing else", async () => {
    const item = built.find((i) => i.id === "wooden_spoon") ?? built[0]!;
    const scene = await load(item.glb!);
    const hand = buildHouseholdHandMesh(THREE, scene, { yaw: Math.PI / 2 }) as Hand;
    const { up, front } = axesInHead(hand);
    expect(near(up, 0, 1, 0, 1e-5)).toBe(true); // still upright
    expect(Math.abs(front.z)).toBeLessThan(1e-5); // a quarter turn: the front is now sideways
    expect(Math.abs(Math.abs(front.x) - 1)).toBeLessThan(1e-5);
    expect(boxInHead(hand).min.y).toBeCloseTo(0, 2);
  });

  it("it works on a copy: the parsed scene is left as it was, so one load can be equipped twice", async () => {
    const item = built[0]!;
    const scene = await load(item.glb!);
    buildHouseholdHandMesh(THREE, scene, {});
    buildHouseholdHandMesh(THREE, scene, { yaw: 1 });
    expect(scene.scale.toArray()).toEqual([1, 1, 1]);
    expect(scene.rotation.y).toBe(0);
    expect(scene.parent).toBeNull();
  });

  it("every zone colour survives into the hand (the photo projection can only replace it, never lose it)", async () => {
    for (const item of built.filter((i) => i.zones.length > 1).slice(0, 4)) {
      const hand = buildHouseholdHandMesh(THREE, await load(item.glb!), {}) as Hand;
      const colours = new Set<string>();
      itemOf(hand).traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) colours.add(`#${(mat as THREE.MeshStandardMaterial).color.getHexString(THREE.SRGBColorSpace).toUpperCase()}`);
      });
      for (const z of item.zones) expect(colours.has(z.hex.toUpperCase()), `${item.id}: ${z.name} ${z.hex} in ${[...colours]}`).toBe(true);
    }
  });
});
