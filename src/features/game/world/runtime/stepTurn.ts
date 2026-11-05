// The step-turn (Dan: "foot slide"): a turn on the spot that is made in real steps. Turning the whole figure about its middle swings both planted feet round in an arc (a quarter turn
// drags each boot about 0.5 stage units), and a hop only lifts them for the biggest part of it. Here the body turns in strides: while one foot is the stance foot and stays where it
// is on the ground, the other lifts and lands further round, then they swap, and at the end both stand shoulder-width apart, the figure facing the new way.
//
// Pure planning, no scene and no three.js. `StepTurner.update` is called every frame with the toy's yaw (the world's `P.face`), where it wants to face, and whether a turn on the spot is
// allowed now; it says what yaw the body should have (the world uses it instead of its fast easing) or null (not turning in steps) and keeps, for each foot, the angle round the toy's
// vertical axis at which it is planted (or on its way to) and how high it is lifted. The Mixamo driver turns those into leg poses with a two-bone IK (runtime/legIk.ts).
//
// Angles are the toy's yaw convention (`P.face`, `root.rotation.y`: positive turns +x towards -z). Foot 0 is the figure's left (z -), foot 1 its right, as `rig.feet`.

/** A turn on the spot of more than this (radians, 60 degrees) is made in steps; smaller ones keep the little hop (world.ts `TURN_HOP`). */
export const STEP_TURN_MIN = 1.05;
/** No step turns the body by more than this (65 degrees): a bigger turn is split into equal steps. */
export const STEP_MAX_YAW = 1.13;
/** How long a step takes, the closing step that brings the trailing foot in, and how high the swinging foot is lifted (stage units). */
export const STEP_S = 0.3;
export const CLOSE_S = 0.24;
export const STEP_LIFT = 0.2;
export const CLOSE_LIFT = 0.12;
/** The overlay fades in and out over these (seconds). */
export const IN_S = 0.06;
export const OUT_S = 0.14;
/** The yaw has been changed by something else (the world set the facing outright) when it is further than this from what the planner gave last (radians). */
const EXTERNAL = 0.04;
/** A remaining turn smaller than this is left to the world's own easing (radians, 3 degrees). */
const DONE = 0.05;

export const wrapAngle = (a: number): number => ((((a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
const ease = (u: number): number => { const k = u < 0 ? 0 : u > 1 ? 1 : u; return k * k * (3 - 2 * k); };

/** How a turn of `delta` radians is split: `n` equal steps of `each` radians in direction `dir` (1 or -1). */
export function planSteps(delta: number): { n: number; each: number; dir: 1 | -1 } {
  const a = Math.abs(delta);
  const n = Math.max(1, Math.ceil(a / STEP_MAX_YAW - 1e-9));
  return { n, each: a / n, dir: delta < 0 ? -1 : 1 };
}

/** The foot that steps first: the one on the side the toy turns towards (positive yaw turns towards -z, the left). */
export const leadingFoot = (dir: number): 0 | 1 => (dir > 0 ? 0 : 1);

/** The foot that is furthest behind in the direction of the turn steps next (so the feet never cross); level feet: the leading one. */
export function trailingFoot(a: readonly [number, number], dir: number): 0 | 1 {
  if (Math.abs(a[0] - a[1]) < 1e-6) return leadingFoot(dir);
  return dir * a[0] < dir * a[1] ? 0 : 1;
}

export type StepPhase = "step" | "close" | "out";

export class StepTurner {
  active = false;
  phase: StepPhase = "step";
  /** 0 to 1: how much of the leg pose is the steps (fades in at the start, out at the end or when the turn is cancelled). */
  w = 0;
  /** Set when a turn has just begun: the driver reads the starting pose of the legs and clears it. */
  fresh = false;
  /** The toy's yaw as it will be when the frame is drawn (what the feet are measured against). */
  bodyYaw = 0;
  /** The yaw (world frame) each foot is planted at, or is swinging to. */
  readonly a: [number, number] = [0, 0];
  /** Where each foot is now, as an angle round the toy: planted at `a`, the swinging one on its arc. */
  readonly ang: [number, number] = [0, 0];
  /** How high each foot is lifted (stage units). */
  readonly lift: [number, number] = [0, 0];
  swing: 0 | 1 = 0;
  /** Which way the turn goes (1 positive yaw). */
  dir: 1 | -1 = 1;
  private aFrom = 0;
  private aTo = 0;
  private yaw0 = 0;
  private yaw1 = 0;
  private t = 0;
  private T = STEP_S;
  private H = STEP_LIFT;
  private faceOut = 0;
  /** Steps made (including the closing one) in the current or last turn: for the tests and the debug handle. */
  steps = 0;

  /** True while the toy is being held still for the turn (so the world must not walk it): from the first step until it is cancelled or done. */
  get stepping(): boolean { return this.active && this.phase !== "out"; }

  reset(): void {
    this.active = false;
    this.w = 0;
    this.fresh = false;
    this.phase = "step";
    this.lift[0] = this.lift[1] = 0;
  }

  /** Start a turn of `delta` radians from yaw `face`: both feet level, the leading one swings first. */
  private begin(face: number, delta: number): void {
    const plan = planSteps(delta);
    this.active = true;
    this.fresh = true;
    this.phase = "step";
    this.w = 0;
    this.steps = 0;
    this.dir = plan.dir;
    this.a[0] = this.a[1] = face;
    this.ang[0] = this.ang[1] = face;
    this.lift[0] = this.lift[1] = 0;
    this.faceOut = face;
    this.startStep(leadingFoot(plan.dir), face, face + plan.dir * plan.each, STEP_S, STEP_LIFT, "step");
  }

  private startStep(swing: 0 | 1, yaw0: number, yaw1: number, T: number, H: number, phase: StepPhase): void {
    this.phase = phase;
    this.swing = swing;
    this.yaw0 = yaw0;
    this.yaw1 = yaw1;
    this.aFrom = this.a[swing];
    this.aTo = yaw1;
    this.t = 0;
    this.T = T;
    this.H = H;
  }

  private cancel(): void {
    this.phase = "out";
    this.lift[0] = this.lift[1] = 0;                 // a foot caught mid-step is put down where it is: the overlay fades out over it
  }

  /**
   * Advance by `dt`. `face` is the toy's yaw now, `tface` where it wants to face, `allowed` whether a turn in steps may go on (the toy is standing, nothing is playing, no walk is about
   * to take over). Returns the yaw the body should have, or null when the world should ease the yaw itself (not turning in steps, or the turn has just ended or been cancelled).
   */
  update(dt: number, face: number, tface: number, allowed: boolean): number | null {
    this.bodyYaw = face;
    if (!this.active) {
      if (!allowed) return null;
      const d = wrapAngle(tface - face);
      if (Math.abs(d) < STEP_TURN_MIN) return null;
      this.begin(face, d);
    } else if (this.phase !== "out" && (!allowed || Math.abs(wrapAngle(face - this.faceOut)) > EXTERNAL)) {
      this.cancel();
    }
    if (this.phase === "out") {
      this.w -= dt / OUT_S;
      if (this.w <= 0) this.reset();
      // the world eases the yaw itself from here (world.ts: face += wrap(tface - face) x min(1, dt x 10)): the feet are measured against the yaw it will have this frame
      this.bodyYaw = face + wrapAngle(tface - face) * Math.min(1, dt * 10);
      return null;
    }
    this.w = Math.min(1, this.w + dt / IN_S);
    this.t += dt;
    const u = Math.min(1, this.t / this.T);
    const e = ease(u);
    const yaw = this.phase === "step" ? this.yaw0 + (this.yaw1 - this.yaw0) * e : this.yaw0;
    const sw = this.swing, st = 1 - sw as 0 | 1;
    this.ang[sw] = this.aFrom + (this.aTo - this.aFrom) * e;
    this.lift[sw] = this.H * Math.sin(Math.PI * u);
    this.ang[st] = this.a[st];
    this.lift[st] = 0;
    this.faceOut = yaw;
    this.bodyYaw = yaw;                               // the yaw the body will have when this frame is drawn, which is what its feet are placed against
    if (u >= 1) this.land(tface, yaw);
    return yaw;
  }

  /** The swinging foot has landed: plan the next step, or the closing one, or finish. */
  private land(tface: number, yaw: number): void {
    const sw = this.swing;
    this.a[sw] = this.aTo;
    this.ang[sw] = this.aTo;
    this.lift[sw] = 0;
    this.steps++;
    if (this.phase === "close") { this.phase = "out"; return; }
    const d = wrapAngle(tface - yaw);
    if (Math.abs(d) > DONE) {
      const plan = planSteps(d);
      this.dir = plan.dir;
      this.startStep(trailingFoot(this.a, plan.dir), yaw, yaw + plan.dir * plan.each, STEP_S, STEP_LIFT, "step");
      return;
    }
    // the body is round: bring the trailing foot in beside the other
    const behind = Math.abs(this.a[0] - yaw) > 0.02 ? 0 : Math.abs(this.a[1] - yaw) > 0.02 ? 1 : -1;
    if (behind < 0) { this.phase = "out"; return; }
    this.startStep(behind as 0 | 1, yaw, yaw, CLOSE_S, CLOSE_LIFT, "close");
  }
}
