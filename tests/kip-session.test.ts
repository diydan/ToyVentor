import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
// @ts-expect-error untyped JS module
import { createKipSession } from "../parts/kip/viewer/kip-session.js";

function fakeSession() {
  let loadCount = 0;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const disposeGeo = vi.spyOn(geo, "dispose");
  const mover = new THREE.Group();
  const grounder = new THREE.Group();
  const joint = new THREE.Group();
  mover.add(grounder);
  grounder.add(joint);
  const partSlots = ["snap_arm_l", "snap_arm_r", "snap_leg_l", "snap_leg_r"].map((id) => {
    const grp = new THREE.Group();
    grounder.add(grp);
    return { id, grp };
  });
  const rig: any = {
    mover,
    grounder,
    partSlots,
    createSlot: () => new THREE.Group(),
  };
  const K: any = {
    loadSTL: vi.fn(async () => geo),
    scadMesh: (g: THREE.BufferGeometry, m: THREE.Material) => new THREE.Mesh(g, m),
    mats: { shell: new THREE.MeshBasicMaterial() },
    buildKipRig: () => rig,
    loadGeos: async () => {
      loadCount++;
      return { geos: { snap_arm: geo, snap_leg: geo }, baseParts: {} };
    },
    STL_NAMES: [],
  };
  const session = createKipSession({
    THREE,
    STLLoader: class {},
    mergeVertices: (g: THREE.BufferGeometry) => g,
    toCreasedNormals: (g: THREE.BufferGeometry) => g,
    createRig: () => K,
    loadExpansion: async () => ({}),
    attachExpansion: () => ({ expMats: {} }),
  });
  return { session, rig, joint, geo, disposeGeo, loadCount: () => loadCount };
}

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

describe("shared Kip session wiring", () => {
  it("is copied to public/kip and used by both benches and the Workshop", () => {
    expect(read("scripts/build-kip.ts")).toContain("viewer/kip-session.js");
    for (const f of ["kip-session.js", "kip-bench.js", "truck-bench.js", "workshop.js"]) {
      expect(readFileSync(join(root, "public/kip", f), "utf8"), `public/kip/${f} drifted`).toBe(read(`parts/kip/viewer/${f}`));
    }
    expect(read("parts/kip/viewer/kip-bench.js")).toContain("env.sharedKip ?? createKipSession");
    expect(read("parts/kip/viewer/truck-bench.js")).toContain("env.sharedKip ?? createKipSession");
    expect(read("parts/kip/viewer/kip-bench.js")).not.toContain("createKipRig(");
    expect(read("parts/kip/viewer/truck-bench.js")).not.toContain("createKipRig(");
    expect(read("parts/kip/viewer/workshop.js")).toContain("sharedKip,");
    expect(read("parts/kip/viewer/workshop.js")).toContain("'/kip/kip-session.js?v=10.0'");
  });
});

describe("shared Kip session", () => {
  it("loads and builds one rig for concurrent bench loads", async () => {
    const f = fakeSession();
    f.session.acquire("kip").acquire("truck");
    const [a, b] = await Promise.all([f.session.load(), f.session.load()]);
    expect(a).toBe(b);
    expect(a.rig).toBe(f.rig);
    expect(f.loadCount()).toBe(1);
    expect(Object.values(f.rig.rigidSnapMeshes).every((m: any) => m?.visible === false)).toBe(true);
  });

  it("leases the mover to one bench and restores Kip's pose after Truck", async () => {
    const f = fakeSession();
    f.session.acquire("kip").acquire("truck");
    await f.session.load();
    const kipScene = new THREE.Scene();
    const truckScene = new THREE.Scene();

    expect(f.session.borrow("kip", kipScene)).toBe(f.rig);
    expect(f.session.borrow("truck", truckScene)).toBeNull();
    f.joint.position.set(1, 2, 3);
    f.joint.visible = false;
    expect(f.session.release("kip")).toBe(true);
    expect(f.rig.mover.parent).toBeNull();

    expect(f.session.borrow("truck", truckScene)).toBe(f.rig);
    f.joint.position.set(9, 8, 7);
    f.joint.visible = true;
    expect(f.session.release("truck")).toBe(true);
    expect(f.joint.position.toArray()).toEqual([1, 2, 3]);
    expect(f.joint.visible).toBe(false);
    expect(f.rig.mover.parent).toBeNull();
    expect(f.session.borrow("kip", kipScene)).toBe(f.rig);
    expect(f.rig.mover.parent).toBe(kipScene);
  });

  it("keeps the rig alive until the last bench releases it", async () => {
    const f = fakeSession();
    f.session.acquire("kip").acquire("truck");
    await f.session.load();
    f.session.borrow("truck", new THREE.Scene());
    f.session.releaseRef("kip");
    expect(f.session.disposed).toBe(false);
    expect(f.disposeGeo).not.toHaveBeenCalled();
    f.session.releaseRef("truck");
    expect(f.session.disposed).toBe(true);
    expect(f.disposeGeo).toHaveBeenCalled();
  });

  it("stores shared driver fields and routes wardrobe sync through the registered Kip sync", () => {
    const f = fakeSession();
    const sync = vi.fn(() => true);
    const unregister = f.session.registerSync(sync);
    f.session.setDriverState({ edition: "snap", head: "fox", hair: "off", hat: "ballcap" }, "truck");
    expect(f.session.state).toMatchObject({ edition: "snap", head: "fox", hair: "off", hat: "ballcap", source: "truck" });
    expect(f.session.syncDriver()).toBe(true);
    expect(sync).toHaveBeenCalledWith(expect.objectContaining({ edition: "snap", head: "fox" }));
    unregister();
    expect(f.session.syncDriver()).toBe(false);
  });
});
