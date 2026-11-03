import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// The viewer modules are plain browser JS with no declaration files.
// @ts-expect-error untyped JS module
import * as drive from "../parts/kip/viewer/truck-drive.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const { ROLLING_DRAG, G_MM_S2, N20_RPM, PUSH_SPEED_MM_S, approach, driveParams, stepSpeed, stepSteer, yawRate, advancePose } = drive as any;

const WHEELBASE = 100;
const KINGPIN_SPAN = 37.5;
// An ideal Ackermann solver (the real one is the rack linkage in truck-bench.js, checked in the browser by scripts/e2e-truck-drive.mjs):
// the inner wheel takes the requested angle, the outer follows cot(outer) = cot(inner) + span / wheelbase.
const ackermann = (deg: number) => {
  const inner = (Math.abs(deg) * Math.PI) / 180;
  const outer = inner > 1e-9 ? Math.atan(1 / (1 / Math.tan(inner) + KINGPIN_SPAN / WHEELBASE)) : 0;
  const s = Math.sign(deg);
  return s >= 0 ? { aPlus: inner, aMinus: outer } : { aPlus: -outer, aMinus: -inner }; // aPlus = the wheel at the vehicle's left
};

function run(seconds: number, dt: number, input: (t: number) => { throttle: number; brake?: boolean; steerDir: number }, p: any, start: any = {}) {
  const pose = { px: 0, pz: 0, psi: 0, ...start };
  let v = start.v ?? 0;
  let steer = start.steer ?? 0;
  const path: Array<[number, number]> = [];
  const steps = Math.round(seconds / dt); // a step count, not a float loop bound
  for (let i = 0; i < steps; i++) {
    const k = input(i * dt);
    v = stepSpeed(v, k, p, dt);
    steer = stepSteer(steer, k.steerDir, p, dt);
    const sol = p.steered ? ackermann(steer) : { aPlus: 0, aMinus: 0 };
    advancePose(pose, v, yawRate(v, sol, WHEELBASE), dt);
    path.push([pose.px, pose.pz]);
  }
  return { pose, v, steer, path };
}

describe("truck driving model: numbers and where they come from", () => {
  it("uses the spec's rolling-drag coefficient and the N20's 250 rpm for the powered top speed", () => {
    expect(ROLLING_DRAG).toBe(0.045);
    expect(ROLLING_DRAG * G_MM_S2).toBeCloseTo(441.45, 2);
    expect(N20_RPM).toBe(250);
    const med = driveParams({ stage: "mech" });
    const giant = driveParams({ stage: "mech", giantWheels: true });
    expect(med.maxSpeed).toBeCloseTo(471.2, 0); // 250 rpm x 2 pi x 18 mm
    expect(giant.maxSpeed).toBeCloseTo(654.5, 0); // 250 rpm x 2 pi x 25 mm
    expect(med.coast).toBeCloseTo(441.45, 2);
  });

  it("only the Pro Powered Add-On (stage id mech) is powered; every other stage is pushed by hand at a walking pace", () => {
    for (const stage of ["snap", "pro", "band", "bellows", "jet"]) {
      const p = driveParams({ stage });
      expect(p.powered, stage).toBe(false);
      expect(p.maxSpeed, stage).toBe(PUSH_SPEED_MM_S);
    }
    expect(driveParams({ stage: "mech" }).powered).toBe(true);
  });

  it("steers only the two rack-linkage stages, and caps giant wheels at 25 degrees like the linkage does", () => {
    expect(driveParams({ stage: "pro" }).steered).toBe(true);
    expect(driveParams({ stage: "mech" }).steered).toBe(true);
    for (const stage of ["snap", "band", "bellows", "jet"]) expect(driveParams({ stage }).steered, stage).toBe(false);
    expect(driveParams({ stage: "pro" }).lock).toBe(34);
    expect(driveParams({ stage: "pro", giantWheels: true }).lock).toBe(25);
    expect(driveParams({ stage: "pro", giantWheels: true }).wRad).toBe(25);
  });
});

describe("truck driving model: speed", () => {
  const p = driveParams({ stage: "mech" });

  it("approach moves toward the target and never past it", () => {
    expect(approach(0, 10, 3)).toBe(3);
    expect(approach(9, 10, 3)).toBe(10);
    expect(approach(0, -10, 3)).toBe(-3);
    expect(approach(-9, -10, 3)).toBe(-10);
  });

  it("accelerates to top speed at the stated rate and holds it", () => {
    const r = run(2, 1 / 120, () => ({ throttle: 1, steerDir: 0 }), p);
    expect(r.v).toBeCloseTo(p.maxSpeed, 6);
    const half = run(0.2, 1 / 120, () => ({ throttle: 1, steerDir: 0 }), p);
    expect(half.v).toBeCloseTo(p.accel * 0.2, 0);
  });

  it("brake stops from top speed in v / brake seconds, and coasting takes about v / 441 mm/s^2", () => {
    const brake = run(p.maxSpeed / p.brake + 0.01, 1 / 240, () => ({ throttle: 0, brake: true, steerDir: 0 }), p, { v: p.maxSpeed });
    expect(brake.v).toBe(0);
    const coast = run(0.5, 1 / 240, () => ({ throttle: 0, steerDir: 0 }), p, { v: p.maxSpeed });
    expect(coast.v).toBeCloseTo(p.maxSpeed - 0.5 * p.coast, 0);
    expect(coast.v).toBeGreaterThan(0);
  });

  it("reverse is slower than forward, and pushing the other way uses the brake first", () => {
    const rev = run(3, 1 / 120, () => ({ throttle: -1, steerDir: 0 }), p);
    expect(rev.v).toBeCloseTo(-p.maxSpeed * p.reverseFactor, 6);
    const flip = stepSpeed(p.maxSpeed, { throttle: -1 }, p, 0.1);
    expect(flip).toBeCloseTo(p.maxSpeed - p.brake * 0.1, 6);
  });

  it("does not move without a key and does not creep when stopped", () => {
    const r = run(2, 1 / 120, () => ({ throttle: 0, steerDir: 0 }), p);
    expect(r.v).toBe(0);
    expect(r.pose.px).toBe(0);
    expect(r.pose.pz).toBe(0);
  });
});

describe("truck driving model: steering and path", () => {
  const p = driveParams({ stage: "mech" });

  it("steers to lock at the servo rate and returns to centre when the key is released", () => {
    const s1 = stepSteer(0, +1, p, 0.1);
    expect(s1).toBeCloseTo(p.steerRate * 0.1, 9);
    expect(stepSteer(33, +1, p, 1)).toBe(34);
    expect(stepSteer(-33, -1, p, 1)).toBe(-34);
    expect(stepSteer(10, 0, p, 0.01)).toBeCloseTo(10 - p.steerRate * 0.01, 9);
    expect(stepSteer(0.5, 0, p, 1)).toBe(0);
  });

  it("drives dead straight with the wheels straight", () => {
    const r = run(2, 1 / 120, () => ({ throttle: 1, steerDir: 0 }), p);
    expect(r.pose.px).toBeCloseTo(0, 9);
    expect(r.pose.psi).toBe(0);
    // distance = integral of speed: ramp then cruise
    const rampTime = p.maxSpeed / p.accel;
    const expected = 0.5 * p.accel * rampTime ** 2 + p.maxSpeed * (2 - rampTime);
    expect(Math.abs(r.pose.pz - expected) / expected).toBeLessThan(0.01);
  });

  it("turns left for a positive steer angle and right for a negative one (the vehicle's left is +X)", () => {
    const left = run(1, 1 / 120, () => ({ throttle: 1, steerDir: +1 }), p, { v: 300, steer: 20 });
    const right = run(1, 1 / 120, () => ({ throttle: 1, steerDir: -1 }), p, { v: 300, steer: -20 });
    expect(left.pose.psi).toBeGreaterThan(0);
    expect(left.pose.px).toBeGreaterThan(0);
    expect(right.pose.psi).toBeLessThan(0);
    expect(right.pose.px).toBeLessThan(0);
    expect(left.pose.px).toBeCloseTo(-right.pose.px, 6);
  });

  it("a full lap at a steady lock is a circle of the radius the wheel angles predict, and it closes", () => {
    for (const lock of [10, 20, 34]) {
      const v = 300;
      const sol = ackermann(lock);
      const cotAvg = 0.5 * (1 / Math.tan(sol.aPlus) + 1 / Math.tan(sol.aMinus));
      const radius = WHEELBASE * cotAvg; // of the rear-axle centre
      const lapTime = (2 * Math.PI * radius) / v;
      const dt = 1 / 60;
      const pose = { px: 0, pz: 0, psi: 0 };
      const path: Array<[number, number]> = [];
      for (let t = 0; t < lapTime - 1e-9; t += dt) {
        advancePose(pose, v, yawRate(v, sol, WHEELBASE), dt);
        path.push([pose.px, pose.pz]);
      }
      // the centre of the circle is at (+radius, 0) for a left turn from the origin heading +Z
      const dist = path.map(([x, z]) => Math.hypot(x - radius, z));
      const worst = Math.max(...dist.map((d) => Math.abs(d - radius)));
      expect(worst / radius, `lock ${lock} radius ${radius.toFixed(1)}`).toBeLessThan(0.005);
      expect(Math.hypot(pose.px, pose.pz) / radius, `lock ${lock} closure`).toBeLessThan(0.02);
      expect(pose.psi).toBeCloseTo(2 * Math.PI, 1);
    }
  });

  it("treats the linkage solver's near-zero angles (about 1e-17 rad for straight) as straight, not as an enormous radius", () => {
    expect(yawRate(400, { aPlus: 3e-17, aMinus: -2e-17 }, WHEELBASE)).toBe(0);
    expect(yawRate(400, { aPlus: 0, aMinus: 0 }, WHEELBASE)).toBe(0);
    expect(yawRate(400, { aPlus: 1e-4, aMinus: 1e-4 }, WHEELBASE)).not.toBe(0);
  });

  it("reversing turns the other way for the same wheels, and reversing a left arc retraces it backwards", () => {
    const sol = ackermann(20);
    expect(yawRate(-200, sol, WHEELBASE)).toBeCloseTo(-yawRate(200, sol, WHEELBASE), 12);
    const there = { px: 0, pz: 0, psi: 0 };
    const back = { px: 0, pz: 0, psi: 0 };
    for (let i = 0; i < 120; i++) advancePose(there, 250, yawRate(250, sol, WHEELBASE), 1 / 120);
    // drive the arc backwards from the end pose with the wheels straight-line equivalent: it must come home
    Object.assign(back, there);
    for (let i = 0; i < 120; i++) advancePose(back, -250, yawRate(-250, sol, WHEELBASE), 1 / 120);
    expect(Math.hypot(back.px, back.pz)).toBeLessThan(0.5);
    expect(back.psi).toBeCloseTo(0, 3);
  });
});

describe("truck driving model: stays pure", () => {
  it("has no DOM, no three.js and no timers, so it runs in Node and is deterministic", () => {
    const src = readFileSync(join(process.cwd(), "parts/kip/viewer/truck-drive.js"), "utf8");
    const code = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/\b(document|window|THREE|requestAnimationFrame|setTimeout|setInterval|Math\.random|Date\.now|performance)\b/);
    expect(code).not.toMatch(/^\s*import\s/m);
  });
});
