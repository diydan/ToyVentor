// The two-bone leg IK (runtime/legIk.ts) against the real forward kinematics of the Snap leg (runtime/snapFlex.ts solveSnapLeg): every ankle it is asked for, every foot it is asked to face.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { LEG_BONE_MM, LEG_REACH_MM, legForward, newLegIkResult, solveLegIk } from "../src/features/game/world/runtime/legIk";

const S = 0.0185;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const yawQ = (y: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), y);

describe("solveLegIk", () => {
  it("puts the ankle exactly where it is asked and the foot exactly the way it is asked, for any flex factor the rig might use", () => {
    const out = newLegIkResult();
    let worstPos = 0, worstFoot = 0, n = 0;
    for (const ff of [0.94, 1, 0.8]) {
      for (let i = 0; i < 300; i++) {
        const d = new THREE.Vector3(rnd(-0.4, 0.4), -rnd(0.2, 0.8), rnd(-0.4, 0.4));
        d.setLength(LEG_REACH_MM * S * rnd(0.4, 0.98));
        const yaw = rnd(-1.5, 1.5);
        const foot = yawQ(yaw);
        solveLegIk(d, S, new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), foot, ff, out);
        const f = new THREE.Quaternion();
        const got = legForward(out.hip, out.knee, out.ankle, ff, S, f);
        worstPos = Math.max(worstPos, got.distanceTo(d));
        worstFoot = Math.max(worstFoot, 1 - Math.abs(f.dot(foot)));
        n++;
      }
    }
    expect(n).toBe(900);
    expect(worstPos).toBeLessThan(1e-9);
    expect(worstFoot).toBeLessThan(1e-9);
  });

  it("a straight-down ankle at full reach is a straight leg; a nearer one bends the knee forward (the shin goes back) by the chord's angle", () => {
    const out = newLegIkResult();
    solveLegIk(new THREE.Vector3(0, -LEG_REACH_MM * S, 0), S, new THREE.Vector3(1, 0, 0), new THREE.Quaternion(), 0.94, out);
    expect(out.bend).toBeLessThan(0.1);
    const d = new THREE.Vector3(0, -LEG_BONE_MM * S * Math.SQRT2, 0);                 // chord of a right-angled knee
    solveLegIk(d, S, new THREE.Vector3(1, 0, 0), new THREE.Quaternion(), 0.94, out);
    expect(out.bend).toBeCloseTo(Math.PI / 2, 6);
  });

  it("the knee points the way the pole says (the foot's forward), whichever way the foot faces", () => {
    const out = newLegIkResult();
    for (const yaw of [0, 1, -2]) {
      const pole = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      const d = new THREE.Vector3(0.05, -0.55, 0.02);
      solveLegIk(d, S, pole, yawQ(yaw), 0.94, out);
      // the knee: the thigh's end, (0, -L, 0) turned by the hip as solveSnapLeg leaves it, in the stage frame
      const res = new THREE.Quaternion().slerp(out.knee, (1 - 0.94) * 0.35);
      const hip = out.hip.clone().multiply(res);
      const knee = new THREE.Vector3(0, -LEG_BONE_MM, 0).applyQuaternion(hip).applyQuaternion(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)).multiplyScalar(S);
      const mid = d.clone().multiplyScalar(0.5);
      const side = knee.clone().sub(mid);                                              // from the chord's middle to the knee
      expect(side.dot(pole)).toBeGreaterThan(0);                                       // the knee is on the pole's side
    }
  });

  it("an ankle out of reach is pulled in to the straight leg and keeps its direction; nothing goes NaN", () => {
    const out = newLegIkResult();
    const d = new THREE.Vector3(0.6, -0.9, 0.3);
    solveLegIk(d, S, new THREE.Vector3(1, 0, 0), new THREE.Quaternion(), 0.94, out);
    expect(out.reach).toBeGreaterThan(1);
    const got = legForward(out.hip, out.knee, out.ankle, 0.94, S);
    expect(got.length()).toBeLessThan(LEG_REACH_MM * S + 1e-6);
    expect(got.clone().normalize().distanceTo(d.clone().normalize())).toBeLessThan(1e-3);
    for (const q of [out.hip, out.knee, out.ankle]) expect(Number.isFinite(q.x + q.y + q.z + q.w)).toBe(true);
    // a target right at the hip does not blow up either
    solveLegIk(new THREE.Vector3(0, 0, 0), S, new THREE.Vector3(1, 0, 0), new THREE.Quaternion(), 0.94, out);
    for (const q of [out.hip, out.knee, out.ankle]) expect(Number.isFinite(q.x + q.y + q.z + q.w)).toBe(true);
  });
});
