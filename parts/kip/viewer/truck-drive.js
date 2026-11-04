// truck-drive.js: the Truck bench's driving model (Workshop, 2026-11-03: "can we control it like the Kip and drive around").
// Pure maths with no DOM and no three.js, so it is unit-tested in Node (tests/truck-drive.test.ts); the bench feeds it the keys and applies the result.
//
// What this is: a KINEMATIC model. The truck is a bicycle at its REAR axle; the yaw rate comes from the two REAL solved front-wheel angles
// (cot of the effective steer angle = mean of the two wheel cotangents, the same rule the Pro slalom demo has always used), so the truck turns
// where its wheels point. Speed follows the keys through a plain acceleration, brake and rolling-drag model.
// What it is not: no tyre slip, no motor curve, no battery, no firmware (none is built: progressive-power-system-spec 4.1). The numbers marked
// [viewer feel] are chosen to feel right, not measured; the ones marked [spec] come from the specs.

/** Rolling-resistance coefficient the print-and-test plan models (docs/specs/parts-engineering-spec.md section 11.1, test T1: 0.045). [spec] */
export const ROLLING_DRAG = 0.045;
/** Gravity in mm/s^2, so a coefficient becomes a deceleration in the bench's units (mm, s). */
export const G_MM_S2 = 9810;
/** N20 micro gearmotor output speed, the middle of the 200..300 rpm class (progressive-power-system-spec 4.1), on a 1:1 Z10 mesh to the axle gear. [spec] */
export const N20_RPM = 250;
/** Pushed by hand (every stage but the powered one): a walking-pace nudge. [viewer feel] */
export const PUSH_SPEED_MM_S = 300;

/** Move `a` toward `b` by at most `d` (d >= 0). */
export function approach(a, b, d) {
  return a < b ? Math.min(a + d, b) : Math.max(a - d, b);
}

/**
 * Driving limits for a stage and wheel size.
 * `powered` is only the Pro Powered Add-On (stage id `mech`): there the keys play the remote and the top speed is the N20's wheel speed
 * (rpm x wheel circumference: about 471 mm/s on the O36 wheel, 654 mm/s on the O50). Every other stage is pushed by hand.
 * `steered` stages have the rack linkage (pro, mech); the others have a fixed front axle and drive straight.
 */
export function driveParams({ stage, giantWheels = false }) {
  const wRad = giantWheels ? 25.0 : 18.0; // kit_wheel_giant R 24.97, kit_wheel_med R 17.98
  const powered = stage === 'mech';
  const steered = stage === 'pro' || stage === 'mech';
  return {
    wRad,
    powered,
    steered,
    lock: giantWheels ? 25 : 34, // inner-wheel lock in degrees: what steerSolution accepts (giants are capped at 25)
    maxSpeed: powered ? (N20_RPM / 60) * 2 * Math.PI * wRad : PUSH_SPEED_MM_S,
    reverseFactor: 0.6, // [viewer feel]
    accel: powered ? 1200 : 800, // mm/s^2 [viewer feel]
    brake: 2500, // mm/s^2 [viewer feel]
    coast: ROLLING_DRAG * G_MM_S2, // about 441 mm/s^2 with nothing pushing [spec]
    steerRate: powered ? 180 : 90, // deg/s of inner-wheel angle: a servo is quick, a hand on the wheel is not [viewer feel]
  };
}

/**
 * One step of speed (mm/s, + forward). `throttle` is -1..1 (W/S), `brake` is Space.
 * Brake and pushing against the direction of travel both use the brake rate; letting go coasts down at the rolling drag.
 */
export function stepSpeed(v, { throttle = 0, brake = false }, p, dt) {
  if (brake) return approach(v, 0, p.brake * dt);
  if (throttle === 0) return approach(v, 0, p.coast * dt);
  const target = throttle > 0 ? p.maxSpeed * throttle : p.maxSpeed * p.reverseFactor * throttle;
  const sameWay = v === 0 || Math.sign(target) === Math.sign(v);
  return approach(v, target, (sameWay ? p.accel : p.brake) * dt);
}

/** One step of the requested inner-wheel angle (deg, + = left). `dir` is -1, 0 or +1 (D, none, A); no key returns to centre at the same rate. */
export function stepSteer(steerDeg, dir, p, dt) {
  return approach(steerDeg, dir * p.lock, p.steerRate * dt);
}

/**
 * Yaw rate (rad/s) from the two solved front-wheel angles `sol = { aPlus, aMinus }` (signed rad, + = toward the vehicle's left).
 * Straight ahead (cot of zero is infinite) is no yaw. Reversing flips the sign, as a real car does.
 */
export function yawRate(v, sol, wheelbase) {
  // The linkage solver returns angles around 1e-17 rad for "straight", not exact zero: below a micro-radian the wheels are straight.
  if (Math.max(Math.abs(sol.aPlus), Math.abs(sol.aMinus)) < 1e-6) return 0;
  const cotAvg = 0.5 * (1 / Math.tan(sol.aPlus) + 1 / Math.tan(sol.aMinus));
  const tanC = Number.isFinite(cotAvg) && cotAvg !== 0 ? 1 / cotAvg : 0;
  return (v * tanC) / wheelbase;
}

/** Advance the rear-axle-centre pose one step (midpoint heading, so a full lap closes to well under 1 percent at 60 steps per second). */
export function advancePose(pose, v, psiDot, dt) {
  const mid = pose.psi + 0.5 * psiDot * dt;
  pose.psi += psiDot * dt;
  pose.px += v * Math.sin(mid) * dt;
  pose.pz += v * Math.cos(mid) * dt;
  return pose;
}
