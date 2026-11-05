// The planner of a turn on the spot in steps (runtime/stepTurn.ts): pure, no scene.
import { describe, expect, it } from "vitest";
import { CLOSE_S, IN_S, OUT_S, STEP_LIFT, STEP_MAX_YAW, STEP_S, STEP_TURN_MIN, StepTurner, leadingFoot, planSteps, trailingFoot, wrapAngle } from "../src/features/game/world/runtime/stepTurn";

const DT = 1 / 60;
/** Run the planner the way the world does: its yaw (when it gives one) is the toy's yaw next frame, else the world eases by the same rule. */
function run(t: StepTurner, face: number, tface: () => number, frames: number, allowed: (i: number) => boolean = () => true) {
  const log: Array<{ face: number; ang: [number, number]; lift: [number, number]; swing: number; stepping: boolean; w: number; phase: string }> = [];
  for (let i = 0; i < frames; i++) {
    const y = t.update(DT, face, tface(), allowed(i));
    if (y !== null) face = y; else face += wrapAngle(tface() - face) * Math.min(1, DT * 10);
    log.push({ face, ang: [t.ang[0], t.ang[1]], lift: [t.lift[0], t.lift[1]], swing: t.swing, stepping: t.stepping, w: t.w, phase: t.phase });
  }
  return { log, face };
}
const deg = (d: number) => (d * Math.PI) / 180;

describe("planSteps", () => {
  it("splits a turn into equal steps of at most 65 degrees", () => {
    expect(planSteps(deg(90))).toMatchObject({ n: 2, dir: 1 });
    expect(planSteps(deg(90)).each).toBeCloseTo(deg(45), 9);
    expect(planSteps(deg(180))).toMatchObject({ n: 3 });
    expect(planSteps(deg(180)).each).toBeCloseTo(deg(60), 9);
    expect(planSteps(deg(62))).toMatchObject({ n: 1 });
    expect(planSteps(-deg(135))).toMatchObject({ n: 3, dir: -1 });
    for (const d of [61, 90, 130, 131, 179, 180]) expect(planSteps(deg(d)).each).toBeLessThanOrEqual(STEP_MAX_YAW + 1e-9);
  });
  it("the foot on the side the toy turns towards leads (positive yaw turns towards -z, the left, foot 0); the one furthest behind steps next", () => {
    expect(leadingFoot(1)).toBe(0);
    expect(leadingFoot(-1)).toBe(1);
    expect(trailingFoot([1, 0], 1)).toBe(1);        // left is ahead (more yaw) in a positive turn: the right one steps
    expect(trailingFoot([1, 0], -1)).toBe(0);       // in a negative turn the larger yaw is the one behind
    expect(trailingFoot([0.5, 0.5], 1)).toBe(0);    // level: the leading foot
    expect(trailingFoot([0.5, 0.5], -1)).toBe(1);
  });
});

describe("StepTurner", () => {
  it("does nothing for a small turn, or when it is not allowed", () => {
    const t = new StepTurner();
    expect(t.update(DT, 0, STEP_TURN_MIN - 0.02, true)).toBeNull();
    expect(t.active).toBe(false);
    expect(t.update(DT, 0, Math.PI, false)).toBeNull();
    expect(t.active).toBe(false);
    expect(t.stepping).toBe(false);
  });

  it("a 90 degree turn is two steps and a closing one, alternating feet, ending exactly round with both feet level", () => {
    const t = new StepTurner();
    const { log, face } = run(t, 0, () => Math.PI / 2, 120);
    expect(face).toBeCloseTo(Math.PI / 2, 2);
    expect(t.active).toBe(false);
    expect(t.w).toBe(0);
    const swings = log.filter((l) => l.stepping).map((l) => l.swing);
    // the order of the swinging feet: the leading (left, 0) first, then the right, then the left closes
    const seq = swings.filter((s, i) => i === 0 || s !== swings[i - 1]);
    expect(seq).toEqual([0, 1, 0]);
    expect(t.a[0]).toBeCloseTo(Math.PI / 2, 9);
    expect(t.a[1]).toBeCloseTo(Math.PI / 2, 9);
    // 2 turning steps + 1 closing
    expect(t.steps).toBe(3);
  });

  it("the stance foot stays exactly where it is planted while the other swings, and the swinging one is lifted and comes down", () => {
    const t = new StepTurner();
    const { log } = run(t, 0, () => Math.PI, 120);
    let maxLift = 0;
    for (let i = 1; i < log.length; i++) {
      const a = log[i - 1]!, b = log[i]!;
      if (!a.stepping || !b.stepping || a.swing !== b.swing) continue;
      const st = 1 - b.swing;
      expect(b.ang[st]).toBe(a.ang[st]);               // planted
      expect(b.lift[st]).toBe(0);
      maxLift = Math.max(maxLift, b.lift[b.swing] ?? 0);
      expect(b.lift[b.swing]).toBeGreaterThanOrEqual(0);
    }
    expect(maxLift).toBeGreaterThan(STEP_LIFT * 0.95);
    expect(maxLift).toBeLessThanOrEqual(STEP_LIFT + 1e-9);
    // every swing starts and ends on the ground
    for (let i = 1; i < log.length; i++) if (log[i - 1]!.swing !== log[i]!.swing && log[i]!.stepping && log[i - 1]!.stepping) expect(Math.max(log[i - 1]!.lift[0], log[i - 1]!.lift[1])).toBeLessThan(0.05);
  });

  it("the body's yaw only ever goes the way of the turn (no overshoot) and reaches the mark; the feet are never more than two steps apart, so they cannot cross", () => {
    for (const [from, to] of [[0, deg(90)], [0, -deg(170)], [deg(40), deg(-120)], [deg(170), deg(-170)]] as const) {
      const t = new StepTurner();
      const dir = Math.sign(wrapAngle(to - from));
      const { log, face } = run(t, from, () => to, 160);
      let last = from;
      for (const l of log) { expect(dir * wrapAngle(l.face - last)).toBeGreaterThanOrEqual(-1e-9); last = l.face; }
      expect(Math.abs(wrapAngle(face - to))).toBeLessThan(0.02);
      const each = planSteps(wrapAngle(to - from)).each;
      for (const l of log) if (l.stepping) expect(Math.abs(l.ang[0] - l.ang[1])).toBeLessThanOrEqual(2 * each + 1e-9);
    }
  });

  it("takes about 0.3 s a step: a 90 degree turn has its body round in about 0.55 s, a 180 in about 0.9 s", () => {
    const t90 = new StepTurner();
    const r90 = run(t90, 0, () => Math.PI / 2, 120).log;
    const done90 = r90.findIndex((l) => Math.abs(wrapAngle(l.face - Math.PI / 2)) < 0.05) * DT;
    expect(done90).toBeGreaterThan(2 * STEP_S - 0.1);
    expect(done90).toBeLessThan(2 * STEP_S + 0.15);
    const t180 = new StepTurner();
    const r180 = run(t180, 0, () => Math.PI, 160).log;
    const done180 = r180.findIndex((l) => Math.abs(wrapAngle(l.face - Math.PI)) < 0.05) * DT;
    expect(done180).toBeGreaterThan(3 * STEP_S - 0.1);
    expect(done180).toBeLessThan(3 * STEP_S + 0.15);
    expect(CLOSE_S).toBeLessThan(STEP_S);
  });

  it("the overlay fades in over IN_S and, when the turn is cancelled, out over OUT_S; the toy is released to walk at once and cannot start another turn until the fade is over", () => {
    const t = new StepTurner();
    const first = run(t, 0, () => Math.PI, 3).log;
    expect(first[0]!.w).toBeCloseTo(DT / IN_S, 6);
    expect(t.stepping).toBe(true);
    let face = first[first.length - 1]!.face;
    // cancelled: not allowed any more
    const y = t.update(DT, face, Math.PI, false);
    expect(y).toBeNull();
    expect(t.stepping).toBe(false);
    expect(t.active).toBe(true);                           // still fading
    // while fading, a new turn is not started even though it is asked for and allowed
    expect(t.update(DT, face, -Math.PI / 2, true)).toBeNull();
    for (let i = 0; i < Math.ceil(OUT_S / DT) + 2; i++) { face += 0.01; t.update(DT, face, Math.PI, false); }
    expect(t.active).toBe(false);
    expect(t.w).toBe(0);
    expect(t.lift[0] + t.lift[1]).toBe(0);
  });

  it("something else setting the facing outright cancels the turn", () => {
    const t = new StepTurner();
    const r = run(t, 0, () => Math.PI, 10);
    expect(t.stepping).toBe(true);
    t.update(DT, r.face + 0.5, Math.PI, true);             // the world put the yaw somewhere the planner did not
    expect(t.stepping).toBe(false);
  });

  it("a new mark during the turn is taken at the next step: even the opposite way ends exactly there, the trailing foot stepping, the feet level", () => {
    const t = new StepTurner();
    let target = Math.PI;
    const { log, face } = run(t, 0, () => target, 160, (i) => { if (i === 14) target = -Math.PI / 2; return true; });
    expect(Math.abs(wrapAngle(face - -Math.PI / 2))).toBeLessThan(0.03);
    expect(t.active).toBe(false);
    expect(Math.abs(wrapAngle(t.a[0] - t.a[1]))).toBeLessThan(0.03);
    for (const l of log) if (l.stepping) expect(Math.abs(l.ang[0] - l.ang[1])).toBeLessThanOrEqual(2 * planSteps(Math.PI).each + 1e-6);
  });

  it("bodyYaw is the yaw the frame will be drawn with: the planner's own while it steps, the world's easing while it fades", () => {
    const t = new StepTurner();
    const y = t.update(DT, 0, Math.PI, true)!;
    expect(t.bodyYaw).toBe(y);
    t.update(DT, y, Math.PI, false);                       // cancelled: the world eases from here
    expect(t.bodyYaw).toBeCloseTo(y + wrapAngle(Math.PI - y) * Math.min(1, DT * 10), 9);
  });
});
