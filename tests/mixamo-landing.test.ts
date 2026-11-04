// A limb clip with no joint data (the hand-built Samba, yawn, eat, oops, smell) used to leave Kip's soles above the floor, and the win cheer's copy of a baked clip was unplanted, so it hovered too
// (measured 2026-11-04 over the 47 bank clips: Samba median 0.23 up, win cheer 0.10 up). The driver now stands the lowest sole on the floor (and never lifts a toy that is below it).
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { MixamoDriver, type BakedClip, type ClipBank } from "../src/features/game/world/runtime/mixamo";
import { cheerClip } from "../src/features/game/world/runtime/winCheer";

type Drop = (j: unknown, w: number) => void;
/** A toy group (the parent is the stage) with one leg whose boot sits `bootY` above the group's origin and whose foot group is at `footY`. */
function toy(footY: number, bootY: number) {
  const stage = new THREE.Group(), g = new THREE.Group(), foot = new THREE.Group(), boot = new THREE.Object3D();
  stage.add(g); g.add(foot); foot.add(boot);
  foot.position.y = footY; boot.position.y = bootY;
  stage.updateMatrixWorld(true);
  const joints = { g, snap: { legs: [{ foot, boot }] } };
  return { g, joints };
}
const driver = () => new MixamoDriver({} as unknown as ClipBank);
const drop = (d: MixamoDriver): Drop => (j, w) => (d as unknown as { dropToFloor: Drop }).dropToFloor(j, w);

describe("the driver stands the lowest sole on the floor", () => {
  it("lowers a hovering toy by exactly its lowest sole height", () => {
    const { g, joints } = toy(0.5, -0.1); // the sole is 0.4 up
    drop(driver())(joints, 1);
    expect(g.position.y).toBeCloseTo(-0.4, 6);
  });
  it("lowers by the share of the pose that has no joint data (a blend half way down)", () => {
    const { g, joints } = toy(0.5, -0.1);
    drop(driver())(joints, 0.5);
    expect(g.position.y).toBeCloseTo(-0.2, 6);
  });
  it("never lifts a toy whose sole is already on or below the floor (crouches and sits stay down)", () => {
    for (const [footY, bootY] of [[0.1, -0.1], [-0.3, -0.1], [0.001, 0]] as const) {
      const { g, joints } = toy(footY, bootY);
      drop(driver())(joints, 1);
      expect(g.position.y, `foot ${footY} boot ${bootY}`).toBe(0);
    }
  });
  it("does nothing without a Snap rig, without a parent, or with no weight", () => {
    const { g, joints } = toy(0.5, -0.1);
    drop(driver())({ ...joints, snap: null }, 1);
    drop(driver())(joints, 0);
    drop(driver())(joints, Number.NaN);
    expect(g.position.y).toBe(0);
    const lone = new THREE.Group();
    drop(driver())({ g: lone, snap: joints.snap }, 1);
    expect(lone.position.y).toBe(0);
  });
  it("uses the lower of two feet", () => {
    const stage = new THREE.Group(), g = new THREE.Group();
    stage.add(g);
    const legs = [0.6, 0.3].map((y) => { const foot = new THREE.Group(), boot = new THREE.Object3D(); g.add(foot); foot.add(boot); foot.position.y = y; return { foot, boot }; });
    stage.updateMatrixWorld(true);
    drop(driver())({ g, snap: { legs } }, 1);
    expect(g.position.y).toBeCloseTo(-0.3, 6);
  });
});

describe("a win cheer is planted", () => {
  const src = { name: "react_cheer", duration: 4, loop: true, pose: true, frames: [], planted: false } as unknown as BakedClip;
  it("is planted whatever the source was, so the driver puts the sole on the floor", () => {
    expect(cheerClip(src).planted).toBe(true);
    expect(cheerClip({ ...src, planted: true } as BakedClip).planted).toBe(true);
  });
  it("leaves the original clip alone", () => {
    cheerClip(src);
    expect(src.planted).toBe(false);
    expect(src.name).toBe("react_cheer");
  });
});
