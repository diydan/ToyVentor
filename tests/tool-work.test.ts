// A belt tool at work on a fit (runtime/toolWork.ts; Dan, 2026-11-04 night): the tool in Kip's hand flies out to the screw, bolt or nail, works, and comes back. Pure motion, checked sample by sample.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { AIM, BACK_START, HAMMER_BACK, OUT_END, TOOL_WORK_S, TOOL_WORK_SCALE, newToolPose, toolPose } from "../src/features/game/world/runtime/toolWork";
import { TOOL_BUILDERS, TOOL_TIP, type ToolKind } from "../src/features/game/world/runtime/toolMeshes";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const KINDS: ToolKind[] = ["screwdriver", "spanner", "hammer", "drill"];
const hand = new THREE.Vector3(10, 1.1, 0.3);
const bolt = new THREE.Vector3(13.5, 1.4, -1.8);
const tipOf = (kind: ToolKind, k: number) => {
  const p = toolPose(kind, k, hand, bolt);
  return new THREE.Vector3(0, TOOL_TIP[kind] * TOOL_WORK_SCALE, 0).applyQuaternion(p.quaternion).add(p.position);   // where the working end is
};
const spinAbout = (kind: ToolKind, k: number) => {                                    // the turn about the tool's own long axis, from its aim
  const p = toolPose(kind, k, hand, bolt);
  const aim = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), AIM);
  const q = aim.clone().invert().multiply(p.quaternion);
  return 2 * Math.atan2(q.y, q.w);
};

describe("toolPose", () => {
  for (const kind of KINDS) {
    it(`${kind}: starts and ends in the hand, and is finite and unit-turned all the way`, () => {
      for (const k of [0, 1]) expect(toolPose(kind, k, hand, bolt).position.distanceTo(hand), `${kind} at ${k}`).toBeLessThan(1e-9);
      for (let i = 0; i <= 100; i++) {
        const p = toolPose(kind, i / 100, hand, bolt);
        expect([p.position.x, p.position.y, p.position.z, p.quaternion.x, p.quaternion.w].every(Number.isFinite)).toBe(true);
        expect(p.quaternion.length()).toBeCloseTo(1, 6);
      }
    });
    it(`${kind}: moves smoothly (no jump between frames at 120 fps)`, () => {
      let prev = toolPose(kind, 0, hand, bolt).position.clone();
      for (let t = 1 / 120; t <= TOOL_WORK_S + 1e-9; t += 1 / 120) {
        const p = toolPose(kind, t / TOOL_WORK_S, hand, bolt).position;
        expect(p.distanceTo(prev), `${kind} at ${t.toFixed(3)}`).toBeLessThan(0.45);
        prev = p.clone();
      }
    });
    it(`${kind}: its working end is on the fit while it works (hammer: at the strokes)`, () => {
      const mid = (OUT_END + BACK_START) / 2;
      const ks = kind === "hammer" ? [OUT_END, mid, BACK_START] : [OUT_END + 0.01, mid, BACK_START - 0.01];
      for (const k of ks) expect(tipOf(kind, k).distanceTo(bolt), `${kind} at ${k.toFixed(2)}`).toBeLessThan(kind === "drill" ? 0.09 : 0.05);
    });
    it(`${kind}: it is drawn in the same place for a different fit (it follows the bolt)`, () => {
      const other = bolt.clone().add(new THREE.Vector3(-4, 0.5, 0.3));
      const p = toolPose(kind, (OUT_END + BACK_START) / 2, hand, other);
      const tip = new THREE.Vector3(0, TOOL_TIP[kind] * TOOL_WORK_SCALE, 0).applyQuaternion(p.quaternion).add(p.position);
      expect(tip.distanceTo(other)).toBeLessThan(0.1);
    });
  }

  it("the screwdriver turns one and a half times, the spanner once, and the drill many times faster", () => {
    const turn = (kind: ToolKind) => Math.abs(unwrapped(kind, OUT_END, BACK_START));
    expect(turn("screwdriver")).toBeGreaterThan(Math.PI * 2.7);
    expect(turn("screwdriver")).toBeLessThan(Math.PI * 3.3);
    expect(turn("spanner")).toBeGreaterThan(Math.PI * 1.8);
    expect(turn("spanner")).toBeLessThan(Math.PI * 2.2);
    expect(turn("drill")).toBeGreaterThan(turn("screwdriver") * 4);
    expect(turn("hammer")).toBeLessThan(0.05);                                       // a hammer swings, it does not spin
  });

  it("the hammer bonks twice: the face is on the nail three times (start, middle, end) and back at the top of the swing between", () => {
    const dist: number[] = [];
    for (let i = 0; i <= 200; i++) dist.push(tipOf("hammer", OUT_END + ((BACK_START - OUT_END) * i) / 200).distanceTo(bolt));
    const minima = dist.filter((d, i) => i > 0 && i < dist.length - 1 && d < dist[i - 1]! && d <= dist[i + 1]! && d < 0.05).length;
    expect(minima + (dist[0]! < 0.05 ? 1 : 0) + (dist[200]! < 0.05 ? 1 : 0)).toBeGreaterThanOrEqual(3);
    expect(Math.max(...dist)).toBeGreaterThan(HAMMER_BACK * 0.8);                  // it really is drawn back between the blows
  });

  it("it flies in an arc, above the straight line from the hand to where it works", () => {
    const rest = toolPose("screwdriver", OUT_END, hand, bolt).position;
    const straightY = (hand.y + rest.y) / 2;
    expect(toolPose("screwdriver", OUT_END / 2, hand, bolt).position.y).toBeGreaterThan(straightY + 0.15);
  });

  it("every kind has a builder and a tip length that sits inside the mesh", () => {
    for (const kind of KINDS) {
      const g = TOOL_BUILDERS[kind]();
      const box = new THREE.Box3().setFromObject(g);
      expect(TOOL_TIP[kind]).toBeLessThanOrEqual(box.max.y + 0.05);
      expect(TOOL_TIP[kind]).toBeGreaterThan(box.max.y - 0.3);
    }
  });
});

// the turn about the long axis, followed across the work phase so a full turn counts (atan2 alone wraps)
function unwrapped(kind: ToolKind, from: number, to: number): number {
  let total = 0, prev = spinAbout(kind, from);
  const n = 400;
  for (let i = 1; i <= n; i++) {
    const a = spinAbout(kind, from + ((to - from) * i) / n);
    let d = a - prev;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    total += d; prev = a;
  }
  return total;
}

describe("the page wiring (text pins)", () => {
  const world = readFileSync(join(__dirname, "..", "src/features/game/world/runtime/world.ts"), "utf8");
  it("a tool used on a fit is the one from Kip's hand: it leaves the hand, is built from the held tool's mesh, and comes back", () => {
    expect(world).toMatch(/function toolAnim\([^\n]*TOOL_BUILDERS\[k as "hammer"\][^\n]*PICK\.beltVisible\(false\)[^\n]*toolPose\(k as "hammer",q,hand,bolt,o\)[^\n]*PICK\.beltVisible\(true\)/);
  });
});
export { newToolPose };
