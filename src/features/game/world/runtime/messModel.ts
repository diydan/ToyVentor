// The numbers behind the Toy Room's two mess mini-interactions (docs/specs/playful-interactions-spec.md, "Spill and clean up" and "Make a mess, clean it up"), with nothing drawn and no
// three.js: when things happen, how big the puddle is at a moment, where every toy is at a moment. mess.ts reads them every frame and puts the meshes there; the tests read them without a GPU.
//
//   THE SPILL.  A child taps the juice cup on the little table. Kip walks over, reaches for it, and at SPILL_TIP_AT_S the cup tips over (CUP_LIE radians, on its side), a stream runs off
//   the table edge, and a puddle spreads on the floor in front of the table (it grows with a little overshoot and settles). Kip gasps, hands up: "Oh no, oh no!". Then "Clean?" and a
//   button. Clean: Kip fetches a mop and mops with MOP_STROKES strokes; the puddle is MOP_STROKES smaller after each; the cup stands up again; Kip cheers: "All clean! Hooray!".
//
//   THE PILE.  A child taps the toy box. Kip walks over and tips it: the box leans forward and its PILE_TOYS toys tumble out, one after another, into a heap on the floor in front of it.
//   "Oh no, oh no!", "Clean?", Clean: the box rights itself and the toys fly back in, one by one, with a rising note and a count ("1 toy home!" ... "All 6 toys home!"), then a cheer.
//
// Times are seconds. A "clock" starts when its thing starts (the tip cue, the first moment of the mopping) so the picture does not depend on the visit that started it.
//
// Frame: the prop's own (x to the right, y up, z towards the camera). The toys' poses are relative to the toy box's centre on the floor.

const clamp01 = (u: number) => (u < 0 ? 0 : u > 1 ? 1 : u);
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const smooth = (u: number) => { const k = clamp01(u); return k * k * (3 - 2 * k); };
const finite = (t: number) => (Number.isFinite(t) ? t : 0);

// ---- where Kip stands -------------------------------------------------------------------------------------------------------

/** Kip stands this far to the left of the table's centre to reach the cup, and this far back in the lane (the lane is z -1.2 to 1.2; the table is further back). */
export const SPILL_STAND = 1.15;
export const SPILL_STAND_Z = -1.1;
/** To mop, Kip stands this far to the left of the puddle's centre, at the puddle's depth. */
export const MOP_STAND = 1.2;
/** To tip the toy box, and to tidy it, Kip stands this far to the left of the box's centre, in the lane. */
export const BOX_STAND = 1.6;
export const BOX_STAND_Z = -0.9;

// ---- the visits -------------------------------------------------------------------------------------------------------------

/** The spill visit: when the cup tips, when Kip says "Oh no", when "Clean?" appears, and how long Kip is busy. */
export const SPILL_TIP_AT_S = 0.4;
export const SPILL_OHNO_AT_S = 0.95;
export const SPILL_PROMPT_AT_S = 2.35;
export const SPILL_S = 2.7;
/** The dump visit (the toy box): the same shape. */
export const DUMP_TIP_AT_S = 0.4;
export const DUMP_OHNO_AT_S = 0.85;
export const DUMP_PROMPT_AT_S = 2.35;
export const DUMP_S = 2.7;

// ---- the cup, the stream, the puddle ----------------------------------------------------------------------------------------

/** The cup lies on its side (radians about the front rim, towards the camera). */
export const CUP_LIE = Math.PI / 2;
export const CUP_FALL_S = 0.5;
export const CUP_ROCK_S = 0.35;
/** How far (radians) the cup rocks back up after it lands, before it settles. */
export const CUP_ROCK = 0.16;

/** The tilt of the cup `s` seconds after the tip cue: a fall that speeds up (gravity), one small rock, then still on its side. 0 before, CUP_LIE after. */
export function cupTilt(s: number): number {
  const t = finite(s);
  if (!(t > 0)) return 0;
  if (t < CUP_FALL_S) { const u = t / CUP_FALL_S; return CUP_LIE * u * u; }
  const v = (t - CUP_FALL_S) / CUP_ROCK_S;
  if (v < 1) return CUP_LIE - CUP_ROCK * Math.sin(Math.PI * v) * (1 - v);
  return CUP_LIE;
}
/** After the mopping the cup stands up again: this long after MOP_END_S it is upright. */
export const CUP_RIGHT_S = 0.45;
/** The tilt of the cup `t` seconds into the mopping: still lying until the mopping is done, then up with a small overshoot-free ease. */
export function cupTiltWhileMopping(t: number): number {
  return CUP_LIE * (1 - smooth((finite(t) - MOP_END_S) / CUP_RIGHT_S));
}

/** The stream of juice off the table edge: appears, runs, fades. 0 to 1 (its length and its opacity). */
export const STREAM_AT_S = 0.3;
export const STREAM_FULL_S = 0.55;
export const STREAM_FADE_AT_S = 1.5;
export const STREAM_END_S = 1.9;
export function streamLevel(s: number): number {
  const t = finite(s);
  if (t <= STREAM_AT_S || t >= STREAM_END_S) return 0;
  if (t < STREAM_FULL_S) return smooth((t - STREAM_AT_S) / (STREAM_FULL_S - STREAM_AT_S));
  if (t < STREAM_FADE_AT_S) return 1;
  return 1 - smooth((t - STREAM_FADE_AT_S) / (STREAM_END_S - STREAM_FADE_AT_S));
}

/** The puddle starts where the stream lands, and spreads for PUDDLE_GROW_S. */
export const PUDDLE_AT_S = 0.55;
export const PUDDLE_GROW_S = 1.6;
/** The puddle's size (x radius, then the flatter z radius), and where its centre is, in front of the table. */
export const PUDDLE_R = 1.25;
export const PUDDLE_DEPTH = 0.7;
export const PUDDLE_DX = 0.1;
export const PUDDLE_DZ = 1.1;
/** When everything about the spill has finished moving, seconds after the tip cue. */
export const SPILL_DONE_S = PUDDLE_AT_S + PUDDLE_GROW_S;

/** How much of the puddle there is `s` seconds after the tip cue: 0 before it starts, an ease-out with a small overshoot (about 5%) while it spreads, exactly 1 once it has settled. */
export function puddleGrow(s: number): number {
  const t = finite(s) - PUDDLE_AT_S;
  if (!(t > 0)) return 0;
  if (t >= PUDDLE_GROW_S) return 1;
  const u = t / PUDDLE_GROW_S - 1;
  const c1 = 0.7;
  return 1 + (c1 + 1) * u * u * u + c1 * u * u;                 // easeOutBack: 0 at the start, 1 at the end
}

// ---- the mop ----------------------------------------------------------------------------------------------------------------

export const MOP_STROKES = 6;
export const MOP_START_S = 0.55;
export const MOP_EVERY_S = 0.6;
/** When the last stroke ends (seconds from the start of the mopping). */
export const MOP_END_S = MOP_START_S + MOP_STROKES * MOP_EVERY_S;
/** The mop clip ends this long after the last stroke; the cheer starts then. */
export const MOP_CHEER_AT_S = MOP_END_S + 0.3;
/** The mopping visit: the strokes, the cup standing up, a cheer (the `cheer` clip is 1.3 s). */
export const MOP_S = MOP_CHEER_AT_S + 1.4;

/** When stroke `i` (0-based) ends: the puddle is (i + 1) / MOP_STROKES smaller then. */
export const strokeEndsAt = (i: number) => MOP_START_S + (i + 1) * MOP_EVERY_S;

/** The share of the puddle that is left `t` seconds into the mopping, as a fraction of what there was when the mopping began: 1 until the first stroke, one sixth less after each, exactly 0 after the last. */
export function puddleLeft(t: number): number {
  const k = clamp01((finite(t) - MOP_START_S) / (MOP_END_S - MOP_START_S)) * MOP_STROKES;
  const whole = Math.min(MOP_STROKES, Math.floor(k + 1e-9));
  const frac = whole >= MOP_STROKES ? 0 : k - whole;
  return clamp01(1 - (whole + smooth(frac)) / MOP_STROKES);
}

// ---- the toys ---------------------------------------------------------------------------------------------------------------

export const TOY_KINDS = ["cube", "ball", "car", "star", "duck", "ring"] as const;
export type ToyKind = (typeof TOY_KINDS)[number];
export const PILE_TOYS = TOY_KINDS.length;

export interface Pose { x: number; y: number; z: number; rx: number; ry: number; rz: number }
const PI2 = Math.PI / 2;

/** The toys are drawn this much bigger than their meshes' own size, so they read from the camera (messScene.ts). */
export const TOY_SCALE = 1.35;
/** Where each toy sits in the open box: the tops show over the rim. */
export const IN_BOX: readonly Pose[] = [
  { x: -0.5, y: 0.8, z: -0.08, rx: 0.3, ry: 0.4, rz: 0.2 },
  { x: -0.05, y: 0.84, z: 0.12, rx: 0, ry: 0, rz: 0 },
  { x: 0.4, y: 0.76, z: -0.05, rx: 0.2, ry: -0.5, rz: 0.35 },
  { x: -0.3, y: 0.72, z: -0.02, rx: -1.1, ry: 0, rz: 0.4 },
  { x: 0.1, y: 0.82, z: -0.15, rx: 0.2, ry: 0.9, rz: -0.2 },
  { x: 0.5, y: 0.86, z: 0.12, rx: 1.0, ry: 0.3, rz: 0 },
];
/** Where each toy lies in the heap on the floor in front of the box (z towards the camera): the ring sits on the cube. */
export const IN_PILE: readonly Pose[] = [
  { x: -0.75, y: 0.27, z: 1.15, rx: 0, ry: 0.5, rz: 0 },
  { x: -0.05, y: 0.3, z: 1.85, rx: 0, ry: 0, rz: 0 },
  { x: 0.95, y: 0.2, z: 1.35, rx: 0, ry: -0.4, rz: 0 },
  { x: 0.35, y: 0.08, z: 1.05, rx: -PI2, ry: 0, rz: 0.4 },
  { x: 1.6, y: 0.27, z: 1.9, rx: 0, ry: -0.7, rz: 0 },
  { x: -0.75, y: 0.63, z: 1.15, rx: PI2, ry: 0, rz: 0.3 },
];

/** The box leans this far forward (radians, towards the camera) while the toys are out. */
export const BOX_TILT = 0.5;
export const BOX_TIP_S = 0.35;

/** The toys leave one after another, each in a short arc, with one small hop on landing. */
export const TUMBLE_START_S = 0.2;
export const TUMBLE_STAGGER_S = 0.13;
export const TUMBLE_FLIGHT_S = 0.6;
export const TUMBLE_BOUNCE_S = 0.25;
export const TUMBLE_ARC = 1.0;
export const TUMBLE_HOP = 0.18;
/** When toy `i` lands in the heap, seconds after the tip cue. */
export const landsAt = (i: number) => TUMBLE_START_S + i * TUMBLE_STAGGER_S + TUMBLE_FLIGHT_S;
/** When the last toy has stopped moving. */
export const TUMBLE_DONE_S = landsAt(PILE_TOYS - 1) + TUMBLE_BOUNCE_S;

/** The lean of the toy box `s` seconds after the tip cue: forward over BOX_TIP_S and held. */
export function boxTiltDump(s: number): number {
  return BOX_TILT * smooth(finite(s) / BOX_TIP_S);
}

const flight = (a: Pose, b: Pose, u: number, arc: number, spin: number): Pose => {
  const k = clamp01(u);
  return {
    x: lerp(a.x, b.x, k), z: lerp(a.z, b.z, k), y: lerp(a.y, b.y, k) + arc * 4 * k * (1 - k),
    rx: lerp(a.rx, b.rx, k), ry: lerp(a.ry, b.ry, k) + spin * Math.sin(Math.PI * k), rz: lerp(a.rz, b.rz, k),
  };
};
/** Toy `i`, `s` seconds after the tip cue: in the box, then out in an arc (turning as it goes), a small hop, then lying in the heap. */
export function tumblePose(i: number, s: number): Pose {
  const from = IN_BOX[i]!, to = IN_PILE[i]!;
  const t = finite(s) - (TUMBLE_START_S + i * TUMBLE_STAGGER_S);
  if (!(t > 0)) return { ...from };
  if (t < TUMBLE_FLIGHT_S) return flight(from, to, t / TUMBLE_FLIGHT_S, TUMBLE_ARC, 2.2 * (i % 2 ? -1 : 1));
  const b = t - TUMBLE_FLIGHT_S;
  if (b < TUMBLE_BOUNCE_S) return { ...to, y: to.y + TUMBLE_HOP * Math.sin((Math.PI * b) / TUMBLE_BOUNCE_S) };
  return { ...to };
}

// ---- tidying up -------------------------------------------------------------------------------------------------------------

export const TIDY_BOX_RIGHT_AT_S = 0.1;
export const TIDY_BOX_RIGHT_S = 0.4;
export const TIDY_START_S = 0.5;
export const TIDY_EVERY_S = 0.55;
export const TIDY_FLIGHT_S = 0.5;
export const TIDY_ARC = 1.1;
/** The cheer starts this long after the last toy is home and the visit lasts this long after it (the `cheer` clip is 1.3 s). */
export const TIDY_CHEER_AT_S = 0.2;
export const TIDY_CHEER_S = 1.6;

/** When the toy that goes home in position `slot` (0 first) is in the box, seconds into the tidying. */
export const homeAt = (slot: number) => TIDY_START_S + slot * TIDY_EVERY_S + TIDY_FLIGHT_S;
/** When the last of `n` toys is home. */
export const tidyEndsAt = (n: number) => homeAt(Math.max(0, n - 1));
/** How long the tidy-up visit is for `n` toys still out: the toys, then the cheer. */
export const tidyVisitSeconds = (n: number) => tidyEndsAt(n) + TIDY_CHEER_S;

/** The lean of the box `t` seconds into the tidying, as a fraction of the lean it had when the tidying began: it rights itself first, so the toys fly into an upright box. */
export function boxTiltTidy(t: number, from = BOX_TILT): number {
  return from * (1 - smooth((finite(t) - TIDY_BOX_RIGHT_AT_S) / TIDY_BOX_RIGHT_S));
}

/** Toy `i`, going home in position `slot`, `t` seconds into the tidying: lying where it was, then up and over into the box, then in it. */
export function tidyPose(i: number, slot: number, t: number): Pose {
  const from = IN_PILE[i]!, to = IN_BOX[i]!;
  const u = (finite(t) - (TIDY_START_S + slot * TIDY_EVERY_S)) / TIDY_FLIGHT_S;
  if (!(u > 0)) return { ...from };
  if (u >= 1) return { ...to };
  return flight(from, to, u, TIDY_ARC, 1.6 * (i % 2 ? 1 : -1));
}

/** How many of the `n` toys that were out when the tidying began are home by `t` seconds in. */
export function toysHome(n: number, t: number): number {
  let c = 0;
  for (let slot = 0; slot < n; slot++) if (finite(t) >= homeAt(slot) - 1e-9) c++;
  return c;
}
