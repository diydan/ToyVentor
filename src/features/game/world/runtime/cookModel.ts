// The cooking level's numbers (docs/specs/play-design-spec.md, "Activity levels", activity 2). Pure: the five beats, how many spoons of batter by age band, where things sit, and the little timelines of
// the egg, the spoon, the flip and the serve. No three.js. The flick is the shared `flick` primitive (flick.ts), the one-to-one serving is the shared `carry` primitive (carry.ts); the meshes are
// cookScene.ts, the state machine is cook.ts, the words cookLines.ts.
//
// The concept in one sentence: counting to N (the number of spoons of batter is the number of pancakes is the number of plates). The beats, each one primitive (Q1): crack the egg (a tap), pour the
// batter and count (taps), it's hot (a grown-up's 1.2 second hold, Q2), flip (a flick up on the pan), serve (carry one pancake to each plate). Nothing here can fail a child.
import type { CarryParams } from "./carry";
import { flickBandParams, type FlickParams } from "./flick";
import { clampBand } from "./scrub";

export type CookBeat = "egg" | "pour" | "hot" | "flip" | "serve";
export const COOK_BEATS: readonly CookBeat[] = ["egg", "pour", "hot", "flip", "serve"];

/** Spoons of batter, by band: 1 to 3 for bands 0 to 2, 1 to 6 from band 3 (the counting is the learning). */
export function spoonRange(band: number): [number, number] {
  return clampBand(band) >= 3 ? [1, 6] : [1, 3];
}

export interface CookPlan {
  band: number;
  /** How many spoons to pour: the number of pancakes and of plates. */
  spoons: number;
  range: [number, number];
  /** The flip: the shared flick's parameters (bands 0 and 1 can flip with a tap and cannot miss). */
  flick: FlickParams;
}

/** Screen pixels a swipe must travel to count as a swipe. */
export const FLICK_MIN_PX = 24;

/** The flick for a band: a 1.6 s ring, the sweet spot at 1.2 s, one flip. */
export function flickFor(band: number): FlickParams {
  return { period: 1.6, at: 1.2, direction: "up", minTravel: FLICK_MIN_PX, needed: 1, ...flickBandParams(band) };
}

/** What a band cooks: the spoons rotate through the band's range with `start`, so playing again is not the same count. */
export function cookPlan(band: number, start = 0): CookPlan {
  const b = clampBand(band);
  const range = spoonRange(b);
  const n = Math.max(0, Math.floor(Number.isFinite(start) ? start : 0));
  const size = range[1] - range[0] + 1;
  return { band: b, spoons: range[0] + (n % size), range, flick: flickFor(b) };
}

/** The serve, as the shared carry primitive: each pancake may go on any plate, each plate takes one. */
export function serveParams(n: number): CarryParams {
  const ids = Array.from({ length: n }, (_, i) => i);
  return {
    items: ids.map((i) => ({ id: `pancake${i}`, label: "pancake", targetIds: ids.map((j) => `plate${j}`) })),
    targets: ids.map((j) => ({ id: `plate${j}`, label: "plate", x: plateOffset(j, n).x })),
  };
}

// ---- where things are (local units: x across, z toward the camera, y up from the floor; the set's origin is the middle of the counter on the floor). A phone held upright shows about 6.3 units across the
// lane and Kip stands a little left of the middle, so the whole set is about 3.6 wide and starts 0.75 right of Kip. -----------------------------------------------------------------------------------

export const COUNTER = { width: 3.6, depth: 1.3, height: 0.95, z: -1.0 };
export const HOB_X = -0.95;
export const PAN = { x: HOB_X, y: COUNTER.height + 0.2, z: COUNTER.z, r: 0.62 };
export const BOWL = { x: 0.35, y: COUNTER.height, z: COUNTER.z, r: 0.42 };
export const EGG = { x: 1.25, y: COUNTER.height, z: COUNTER.z + 0.15 };
/** The middle of the counter is this far in front of Kip (the same as the cleaning row, cleanModel.ts ROW_AHEAD). */
export const COOK_AHEAD = 2.55;
/** The set sits this far behind Kip's own line (z), so the plates are not under the card at the bottom of the stage. */
export const COOK_Z = -0.35;
/** At the hob Kip stands this far to the right of it, so the counter is beyond the prop. */
export const HOB_STAND = 1.6;
export const PLATE_R = 0.28;
export const PLATE_Z = 0.7;
export const PANCAKE_R = 0.18;
export const PANCAKE_H = 0.07;
/** The plate that the finger is closest to counts if it is within this many units (a plate is small; a finger is not). */
export const PLATE_REACH = 0.5;

/** Where pancake `i` of `n` sits in the pan (offset from its middle): one in the middle, two side by side, then a ring (with one in the middle from four up). */
export function panSlot(i: number, n: number): { x: number; z: number } {
  if (n <= 1) return { x: 0, z: 0 };
  if (n === 2) return { x: i === 0 ? -0.22 : 0.22, z: 0 };
  const ring = n <= 3 ? n : n - 1;
  if (n >= 4 && i === n - 1) return { x: 0, z: 0 };
  const a = (i / ring) * Math.PI * 2 + Math.PI / 2;
  return { x: Math.cos(a) * 0.4, z: Math.sin(a) * 0.4 };
}
/** Where plate `j` of `n` sits (offset from the counter's middle): a single row on the floor in front, 0.6 apart at most six. */
export function plateOffset(j: number, n: number): { x: number; z: number } {
  const gap = Math.min(0.95, 3.6 / Math.max(1, n));
  return { x: (j - (n - 1) / 2) * gap, z: PLATE_Z };
}
/** The plate nearest a floor point (in the set's own units), or -1 if none is within reach. */
export function plateAt(x: number, z: number, n: number): number {
  let best = -1, bestD = PLATE_REACH;
  for (let j = 0; j < n; j++) {
    const p = plateOffset(j, n);
    const d = Math.hypot(x - p.x, z - p.z);
    if (d <= bestD) { best = j; bestD = d; }
  }
  return best;
}

// ---- timelines (seconds) ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------

export const COOK_MAKE_S = 2.0;
export const COOK_INTRO_AT_S = 0.6;
export const COOK_ASK_AT_S = 1.6;
export const CRACK_S = 0.9;
export const SPOON_S = 0.7;
export const FLIP_S = 0.8;
export const SERVE_S = 0.7;
export const COOK_CHEER_S = 2.0;
export const COOK_WIN_AT_S = 1.2;
/** The count is said at most as fast as this (seconds apart), however fast the child taps; the spoons still go in. */
export const COUNT_GAP_S = 0.45;

const clamp01 = (u: number): number => (Number.isFinite(u) ? Math.min(1, Math.max(0, u)) : 0);
const smooth = (u: number): number => { const k = clamp01(u); return k * k * (3 - 2 * k); };

/** The egg `t` seconds after the tap: shakes for the first 40%, then the halves fall away and the yolk drops into the bowl. `split` 0 to 1, `shake` a small angle, `drop` 0 to 1 (the yolk's fall). */
export function crackPose(t: number): { shake: number; split: number; drop: number } {
  const u = clamp01(t / CRACK_S);
  return { shake: u < 0.4 ? Math.sin(u * 40) * 0.18 * (1 - u / 0.4) : 0, split: smooth((u - 0.4) / 0.2), drop: smooth((u - 0.5) / 0.5) };
}
/** The batter's blob `t` seconds after a spoon: 0 at the bowl, 1 in the pan (an arc), and how much the pancake has spread (0 to 1) once it lands. */
export function spoonPose(t: number): { f: number; arc: number; spread: number } {
  const u = clamp01(t / SPOON_S);
  return { f: smooth(u / 0.6), arc: Math.sin(Math.PI * smooth(u / 0.6)) * 0.55, spread: smooth((u - 0.5) / 0.5) };
}
/** The flip `t` seconds after it: up and over (a half turn about the x axis) and down; `turn` in radians, `lift` above the pan. */
export function flipPose(t: number): { lift: number; turn: number } {
  const u = clamp01(t / FLIP_S);
  return { lift: Math.sin(Math.PI * u) * 0.9, turn: smooth(u) * Math.PI };
}
/** A pancake carried from its slot to a plate: the point along an arc, `u` 0 to 1 (not the time). */
export function servePath(u: number, from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const k = smooth(u);
  return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k + Math.sin(Math.PI * k) * 0.8, z: from.z + (to.z - from.z) * k };
}
