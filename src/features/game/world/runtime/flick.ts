// level primitive: flick (play-design-spec.md, "Activity levels": the primitives this adds).
//
// A swipe (or, for the youngest, a plain tap) inside a timing window: flip the pancake when the pan's ring is full. Pure core, like carry.ts and scrub.ts: parameters, the attempt
// state machine, a band table, a solver, a switch-control form and a seeded random toddler. The runtime owns the clock and the pointer; it hands in the time of the swipe and its
// travel, and draws the window from `flickWindowAt`.
//
// Rules carried from the activity contract:
//   - No failure state, ever. A miss is a `wrong` event (a kind line, "nearly, again!") and nothing is lost; after two misses in a row the window WIDENS, and it keeps widening until
//     it covers the whole cycle, so a child who keeps trying always lands one.
//   - Bands 0 and 1 (ages 2 to 4): the window is the whole cycle, a tap flips it, and nothing can miss. Band 2: a long window. Band 3 up: a shorter one, a real swipe up.
//   - A swipe in the wrong direction is a miss too, with the same kind answer; a touch too short to be a swipe is only `touched`.
import { clampBand, seededRandom } from "./scrub";

export type FlickDirection = "up" | "down" | "left" | "right";
export const FLICK_DIRECTIONS: readonly FlickDirection[] = ["up", "down", "left", "right"];

export interface FlickParams {
  /** Seconds in one cycle of the ring the runtime draws. */
  period: number;
  /** Where in the cycle the sweet spot sits (seconds, 0 to period). */
  at: number;
  /** Half-width of the window, seconds. The cycle is circular: the window is `at` plus or minus this. */
  window: number;
  /** The widest the window may grow: at `period / 2` it covers the whole cycle. */
  maxWindow: number;
  /** Misses in a row that make the window grow, and by what factor. */
  widenAfter: number;
  widenBy: number;
  /** The way the swipe must go. */
  direction: FlickDirection;
  /** A swipe shorter than this (in the runtime's units) is not a swipe. */
  minTravel: number;
  /** A tap counts as the flick (bands 0 and 1). */
  tapFlicks: boolean;
  /** How many flicks finish the beat (the pancakes in the pan). */
  needed: number;
}

export type FlickEvent = "touched" | "progress" | "wrong" | "done";

export interface FlickState {
  hits: number;
  misses: number;
  /** Misses since the last hit. */
  run: number;
  /** The current half-width, grown by misses. */
  window: number;
  done: boolean;
}

/** One touch: the time it ended (the runtime's clock, seconds) and how far it travelled (dx right, dz down the screen is +z, so up is -z in the runtime's units: pass dy up positive). */
export interface FlickAttempt {
  t: number;
  dx: number;
  /** Positive = up. */
  dy: number;
}

export interface FlickResult {
  state: FlickState;
  event: FlickEvent;
  /** On a `wrong`: why, so the runtime picks the right kind line. */
  why?: "timing" | "direction";
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

export function validateFlick(p: FlickParams): string[] {
  const errors: string[] = [];
  if (!finite(p.period) || p.period <= 0) errors.push("period must be a positive number");
  if (!finite(p.at) || p.at < 0 || (finite(p.period) && p.at > p.period)) errors.push("at must sit inside the period");
  if (!finite(p.window) || p.window <= 0) errors.push("window must be a positive number");
  if (!finite(p.maxWindow) || p.maxWindow < p.window) errors.push("maxWindow must be at least window");
  if (finite(p.period) && finite(p.maxWindow) && p.maxWindow < p.period / 2 - 1e-9) errors.push("maxWindow must reach period / 2, or a child could be shut out forever");
  if (!Number.isInteger(p.widenAfter) || p.widenAfter < 1) errors.push("widenAfter must be a whole number, 1 or more");
  if (!finite(p.widenBy) || p.widenBy <= 1) errors.push("widenBy must be above 1, or the window never grows");
  if (!FLICK_DIRECTIONS.includes(p.direction)) errors.push(`unknown direction "${String(p.direction)}"`);
  if (!finite(p.minTravel) || p.minTravel <= 0) errors.push("minTravel must be a positive number");
  if (typeof p.tapFlicks !== "boolean") errors.push("tapFlicks must be true or false");
  if (!Number.isInteger(p.needed) || p.needed < 1 || p.needed > 12) errors.push("needed must be a whole number from 1 to 12");
  return errors;
}

/** The band-dependent parts of a flick (the activity-levels band table). */
export function flickBandParams(band: number): Pick<FlickParams, "window" | "maxWindow" | "tapFlicks" | "widenAfter" | "widenBy"> {
  const b = clampBand(band);
  // the cycle is 1.6 s; a half-width of 0.8 s is the whole of it
  if (b <= 1) return { window: 0.8, maxWindow: 0.8, tapFlicks: true, widenAfter: 2, widenBy: 1.5 };
  if (b === 2) return { window: 0.4, maxWindow: 0.8, tapFlicks: false, widenAfter: 2, widenBy: 1.5 };
  return { window: 0.22, maxWindow: 0.8, tapFlicks: false, widenAfter: 2, widenBy: 1.5 };
}

export function createFlickState(p: FlickParams): FlickState {
  return { hits: 0, misses: 0, run: 0, window: p.window, done: false };
}

/** Shortest distance between two times on the circular cycle. */
export function cycleDistance(t: number, at: number, period: number): number {
  const d = (((t - at) % period) + period) % period;
  return Math.min(d, period - d);
}

/** 0 to 1: how near the swipe time is to the sweet spot right now, for the ring the runtime draws (1 at the spot, 0 outside the window). */
export function flickWindowAt(state: FlickState, p: FlickParams, t: number): number {
  const d = cycleDistance(t, p.at, p.period);
  return d >= state.window ? 0 : 1 - d / state.window;
}

/** Which way a touch went, or null when it did not go far enough to be a swipe. */
export function swipeDirection(a: FlickAttempt, minTravel: number): FlickDirection | null {
  if (!finite(a.dx) || !finite(a.dy)) return null;
  const ax = Math.abs(a.dx), ay = Math.abs(a.dy);
  if (Math.max(ax, ay) < minTravel) return null;
  return ay >= ax ? (a.dy > 0 ? "up" : "down") : a.dx > 0 ? "right" : "left";
}

function miss(state: FlickState, p: FlickParams, why: "timing" | "direction"): FlickResult {
  const run = state.run + 1;
  const grow = run % p.widenAfter === 0;
  const window = grow ? Math.min(p.maxWindow, state.window * p.widenBy) : state.window;
  return { state: { ...state, misses: state.misses + 1, run, window }, event: "wrong", why };
}

function hit(state: FlickState, p: FlickParams): FlickResult {
  const hits = state.hits + 1;
  const done = hits >= p.needed;
  return { state: { ...state, hits, run: 0, done }, event: done ? "done" : "progress" };
}

/** A touch ended at time `a.t` having travelled (dx, dy). */
export function flickAttempt(state: FlickState, p: FlickParams, a: FlickAttempt): FlickResult {
  if (state.done) return { state, event: "touched" };
  if (!finite(a.t)) return { state, event: "touched" };
  const dir = swipeDirection(a, p.minTravel);
  if (!dir && !p.tapFlicks) return { state, event: "touched" }; // a tap where a swipe is needed is just a touch
  if (dir && dir !== p.direction) return miss(state, p, "direction");
  if (cycleDistance(a.t, p.at, p.period) > state.window + 1e-9) return miss(state, p, "timing");
  return hit(state, p);
}

/** The switch-control form: one action is one flick, timing and direction ignored. */
export function flickSwitch(state: FlickState, p: FlickParams): FlickResult {
  if (state.done) return { state, event: "touched" };
  return hit(state, p);
}

/** A correct play, or null when the params are invalid: one clean swipe in the right direction at the sweet spot, once per flick needed, a cycle apart. */
export function solveFlick(p: FlickParams): FlickAttempt[] | null {
  if (validateFlick(p).length) return null;
  const travel = p.minTravel * 3;
  const mk = (t: number): FlickAttempt => ({ t, dx: p.direction === "right" ? travel : p.direction === "left" ? -travel : 0, dy: p.direction === "up" ? travel : p.direction === "down" ? -travel : 0 });
  return Array.from({ length: p.needed }, (_, k) => mk(p.at + k * p.period));
}

export function playFlick(p: FlickParams, attempts: readonly FlickAttempt[], state = createFlickState(p)): { state: FlickState; steps: number; events: FlickEvent[] } {
  const events: FlickEvent[] = [];
  let steps = 0;
  for (const a of attempts) {
    if (state.done) break;
    const r = flickAttempt(state, p, a);
    state = r.state;
    events.push(r.event);
    steps++;
  }
  return { state, steps, events };
}

/** The robot playtest: a toddler who swipes anywhere, any way, or just pokes, at random times. Returns whether it reached `done` within `maxSteps` touches. */
export function toddlerFlick(p: FlickParams, seed: number, maxSteps = 400): { done: boolean; steps: number; misses: number; state: FlickState } {
  const rand = seededRandom(seed);
  let state = createFlickState(p);
  let t = 0;
  let steps = 0;
  while (!state.done && steps < maxSteps) {
    t += 0.2 + rand() * 1.5;
    const poke = rand() < 0.3;
    const dir = FLICK_DIRECTIONS[Math.floor(rand() * FLICK_DIRECTIONS.length)]!;
    const far = p.minTravel * (1 + rand() * 3);
    const dx = poke ? 0 : dir === "right" ? far : dir === "left" ? -far : 0;
    const dy = poke ? 0 : dir === "up" ? far : dir === "down" ? -far : 0;
    state = flickAttempt(state, p, { t, dx, dy }).state;
    steps++;
  }
  return { done: state.done, steps, misses: state.misses, state };
}
