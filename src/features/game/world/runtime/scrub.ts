// level primitive: scrub (play-design-spec.md, "Activity levels": the primitives this adds).
//
// The child drags a finger along a mess to clear it: crumbs with the vacuum, a puddle with the mop, jam with the soapy sponge. Pure core, like carry.ts:
// parameter validation, the touch state machine, a band table, a solver, a switch-control form and a seeded random toddler. No three.js, no DOM: the
// runtime turns a pointer position into mess-local units and calls `scrubTouch`; it draws the dirt cells that `scrubCells` lays out and `state.clean` marks.
//
// Rules carried from the activity contract:
//   - No failure state. A wrong tool clears nothing and returns a `wrong` event (the runtime answers with a kind line and the right tool pulsing); nothing is lost.
//   - Bands 0 and 1 (ages 2 to 4): a single tap on the mess clears it (`tapClears`), a scribble does too. Band 2: half of it. Band 3 up: seven tenths, finger speed matters.
//   - A finger that goes too fast skips the stretch between samples (it clears only where it landed); a finger held still does not scrub. Neither is punished.
//   - The switch form (`scrubAll`) does the whole job in one action, for a child who cannot drag.
//
// Units are the mess's own: x across, z deep, centred on 0, so a mess can sit anywhere in the world and the model never knows where.

export type ScrubShape = "blob" | "line" | "scatter";
export type ScrubTool = "vacuum" | "mop" | "sponge" | "brush" | "broom";

export const SCRUB_SHAPES: readonly ScrubShape[] = ["blob", "line", "scatter"];
export const SCRUB_TOOLS: readonly ScrubTool[] = ["vacuum", "mop", "sponge", "brush", "broom"];

export interface ScrubParams {
  shape: ScrubShape;
  /** The tool that clears it. */
  tool: ScrubTool;
  /** Size of the mess, in units: across (x) and deep (z). */
  width: number;
  depth: number;
  /** How many dirt cells the mess is made of (the resolution of "how much is left"). */
  cells: number;
  /** The fraction of cells to clear for `done`, 0 to 1 (not 0). */
  coverage: number;
  /** Radius of the wipe, in units. */
  brush: number;
  /** Finger speed (units per second) under which the finger counts as held still, and over which a stretch is skipped. */
  speedFloor: number;
  speedCeiling: number;
  /** A tap (a touch that is not a drag) clears everything: bands 0 and 1. */
  tapClears: boolean;
}

export type ScrubEvent = "touched" | "progress" | "wrong" | "done";

export interface ScrubState {
  /** One byte per cell: 1 = clear, 0 = still dirty. */
  clean: Uint8Array;
  cleared: number;
  /** Wrong-tool touches on the mess (the runtime spaces its hint lines by this, never a score). */
  wrongs: number;
  done: boolean;
}

export interface ScrubPoint {
  x: number;
  z: number;
}

/** One finger sample: where, with which tool in Kip's hand, how long since the last sample (seconds; 0 = a fresh touch). */
export interface ScrubTouch extends ScrubPoint {
  tool: ScrubTool;
  dt: number;
}

export interface ScrubResult {
  state: ScrubState;
  event: ScrubEvent;
  /** Cells cleared by this touch. */
  gained: number;
  /** The tool the mess needs, set only on a `wrong`. */
  need?: ScrubTool;
}

const MAX_CELLS = 600;
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export function validateScrub(p: ScrubParams): string[] {
  const errors: string[] = [];
  if (!SCRUB_SHAPES.includes(p.shape)) errors.push(`unknown shape "${String(p.shape)}"`);
  if (!SCRUB_TOOLS.includes(p.tool)) errors.push(`unknown tool "${String(p.tool)}"`);
  if (!finite(p.width) || p.width <= 0) errors.push("width must be a positive number");
  if (!finite(p.depth) || p.depth <= 0) errors.push("depth must be a positive number");
  if (!Number.isInteger(p.cells) || p.cells < 4 || p.cells > MAX_CELLS) errors.push(`cells must be a whole number from 4 to ${MAX_CELLS}`);
  if (!finite(p.coverage) || p.coverage <= 0 || p.coverage > 1) errors.push("coverage must be above 0 and at most 1");
  if (!finite(p.brush) || p.brush <= 0) errors.push("brush must be a positive number");
  if (!finite(p.speedFloor) || p.speedFloor < 0) errors.push("speedFloor must be 0 or more");
  if (!finite(p.speedCeiling) || (finite(p.speedFloor) && p.speedCeiling <= p.speedFloor)) errors.push("speedCeiling must be above speedFloor");
  if (typeof p.tapClears !== "boolean") errors.push("tapClears must be true or false");
  return errors;
}

/** Where each dirt cell sits, in the mess's own units (centred on 0). Deterministic: the same params always lay the same cells. */
export function scrubCells(p: Pick<ScrubParams, "shape" | "width" | "depth" | "cells">): ScrubPoint[] {
  const n = p.cells;
  const out: ScrubPoint[] = [];
  if (p.shape === "line") {
    // along x, a little zig-zag in z so it is a smear and not a ruler
    for (let i = 0; i < n; i++) out.push({ x: -p.width / 2 + (p.width * (i + 0.5)) / n, z: (i % 2 === 0 ? -1 : 1) * (p.depth / 4) });
    return out;
  }
  if (p.shape === "scatter") {
    // piles: sunflower-spaced centres, up to four cells round each
    const piles = Math.max(3, Math.ceil(n / 4));
    const per = Math.ceil(n / piles);
    const r = Math.min(p.width, p.depth) * 0.06;
    for (let k = 0; k < piles && out.length < n; k++) {
      const rad = Math.sqrt((k + 0.5) / piles);
      const cx = Math.cos(k * GOLDEN) * rad * (p.width / 2 - r);
      const cz = Math.sin(k * GOLDEN) * rad * (p.depth / 2 - r);
      for (let j = 0; j < per && out.length < n; j++) {
        const a = (j / per) * Math.PI * 2;
        out.push({ x: cx + (per > 1 ? Math.cos(a) * r : 0), z: cz + (per > 1 ? Math.sin(a) * r : 0) });
      }
    }
    return out;
  }
  // blob: a sunflower fill of the ellipse
  for (let i = 0; i < n; i++) {
    const rad = Math.sqrt((i + 0.5) / n);
    out.push({ x: Math.cos(i * GOLDEN) * rad * (p.width / 2), z: Math.sin(i * GOLDEN) * rad * (p.depth / 2) });
  }
  return out;
}

/** Age band 0 to 5 as the carousel keeps it (src/lib/age.ts); anything else reads as the youngest. */
export function clampBand(band: number): number {
  return Number.isInteger(band) && band >= 0 ? Math.min(band, 5) : 0;
}

/** The band-dependent parts of a scrub (the activity-levels band table). `scale` is the size of the activity's own brush at band 3. */
export function scrubBandParams(band: number, scale = 1): Pick<ScrubParams, "coverage" | "brush" | "speedFloor" | "speedCeiling" | "tapClears"> {
  const b = clampBand(band);
  if (b <= 1) return { coverage: 0.3, brush: 1.6 * scale, speedFloor: 0, speedCeiling: 1e9, tapClears: true };
  if (b === 2) return { coverage: 0.5, brush: 1.25 * scale, speedFloor: 0, speedCeiling: 60, tapClears: false };
  return { coverage: 0.7, brush: 1 * scale, speedFloor: 0.4, speedCeiling: 40, tapClears: false };
}

export function createScrubState(p: ScrubParams): ScrubState {
  return { clean: new Uint8Array(p.cells), cleared: 0, wrongs: 0, done: false };
}

/** Cells that need clearing for `done`. */
export const scrubNeeded = (p: Pick<ScrubParams, "cells" | "coverage">): number => Math.min(p.cells, Math.max(1, Math.ceil(p.cells * p.coverage - 1e-9)));

/** 0 to 1 toward `done` (full at the coverage, not at every cell, so a bar never stalls short). */
export function scrubProgress(state: ScrubState, p: Pick<ScrubParams, "cells" | "coverage">): number {
  return Math.min(1, state.cleared / scrubNeeded(p));
}

/** Is the finger on the mess? A little generous: within one brush of the mess's rectangle. */
export function onMess(p: Pick<ScrubParams, "width" | "depth" | "brush">, pt: ScrubPoint): boolean {
  return Math.abs(pt.x) <= p.width / 2 + p.brush && Math.abs(pt.z) <= p.depth / 2 + p.brush;
}

function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

/** `prev` is the last sample of the same stroke (or null for a fresh touch). The state is copied, never changed in place. */
export function scrubTouch(state: ScrubState, p: ScrubParams, prev: ScrubPoint | null, t: ScrubTouch, cells: readonly ScrubPoint[] = scrubCells(p)): ScrubResult {
  if (state.done) return { state, event: "touched", gained: 0 };
  if (!finite(t.x) || !finite(t.z) || !onMess(p, t)) return { state, event: "touched", gained: 0 };
  if (t.tool !== p.tool) return { state: { ...state, wrongs: state.wrongs + 1 }, event: "wrong", gained: 0, need: p.tool };
  // a fresh touch with tapClears is a tap: the whole mess goes (a drag that began as that touch is the same thing, so a scribble works too)
  const clearAll = p.tapClears && !prev;
  const clean = new Uint8Array(state.clean);
  let gained = 0;
  if (!clearAll) {
    const speed = prev && t.dt > 0 ? Math.hypot(t.x - prev.x, t.z - prev.z) / t.dt : null;
    if (speed !== null && speed < p.speedFloor) return { state, event: "touched", gained: 0 }; // held still: not scrubbing
    // a stroke over the speed ceiling clears only where the finger landed
    const swept = prev !== null && speed !== null && speed <= p.speedCeiling;
    for (let i = 0; i < cells.length; i++) {
      if (clean[i]) continue;
      const c = cells[i]!;
      const d = swept ? distToSegment(c.x, c.z, prev!.x, prev!.z, t.x, t.z) : Math.hypot(c.x - t.x, c.z - t.z);
      if (d <= p.brush) { clean[i] = 1; gained++; }
    }
  } else {
    for (let i = 0; i < clean.length; i++) if (!clean[i]) { clean[i] = 1; gained++; }
  }
  const cleared = state.cleared + gained;
  const done = cleared >= scrubNeeded(p);
  const next: ScrubState = { clean, cleared, wrongs: state.wrongs, done };
  return { state: next, event: done ? "done" : gained > 0 ? "progress" : "touched", gained };
}

/** The switch-control form: the whole job in one action. */
export function scrubAll(state: ScrubState, p: ScrubParams): ScrubResult {
  if (state.done) return { state, event: "touched", gained: 0 };
  const clean = new Uint8Array(p.cells).fill(1);
  return { state: { clean, cleared: p.cells, wrongs: state.wrongs, done: true }, event: "done", gained: p.cells - state.cleared };
}

export interface ScrubSample extends ScrubTouch {
  /** The first sample of a stroke has no previous one. */
  fresh: boolean;
}

/** A correct play, or null when the params are invalid: a back-and-forth sweep over the mess at a speed inside the band's limits, every sample with the right tool. */
export function solveScrub(p: ScrubParams): ScrubSample[] | null {
  if (validateScrub(p).length) return null;
  const out: ScrubSample[] = [];
  if (p.tapClears) return [{ x: 0, z: 0, tool: p.tool, dt: 0, fresh: true }];
  // lanes a brush-radius apart, a sample every half brush at a speed between the floor and the ceiling
  const speed = Math.min(p.speedCeiling * 0.5, Math.max(p.speedFloor * 2, p.brush * 4));
  const step = Math.max(p.brush * 0.5, 1e-3);
  const dt = step / speed;
  const halfW = p.width / 2 + p.brush * 0.5, halfD = p.depth / 2 + p.brush * 0.5;
  const lanes = Math.max(1, Math.ceil((2 * halfD) / p.brush));
  for (let lane = 0; lane <= lanes; lane++) {
    const z = -halfD + (2 * halfD * lane) / lanes;
    const ltr = lane % 2 === 0;
    const samples = Math.max(1, Math.ceil((2 * halfW) / step));
    for (let s = 0; s <= samples; s++) {
      const u = s / samples;
      out.push({ x: -halfW + 2 * halfW * (ltr ? u : 1 - u), z, tool: p.tool, dt: s === 0 ? 0 : dt, fresh: s === 0 });
    }
  }
  return out;
}

/** Replay samples through `scrubTouch`; the last result and how many samples it took. */
export function playScrub(p: ScrubParams, samples: readonly ScrubSample[], state = createScrubState(p)): { state: ScrubState; steps: number; events: ScrubEvent[]; wrongs: number } {
  const cells = scrubCells(p);
  let prev: ScrubPoint | null = null;
  let steps = 0;
  const events: ScrubEvent[] = [];
  let wrongs = 0;
  for (const s of samples) {
    if (state.done) break;
    const r = scrubTouch(state, p, s.fresh ? null : prev, s, cells);
    state = r.state;
    events.push(r.event);
    if (r.event === "wrong") wrongs++;
    prev = s;
    steps++;
  }
  return { state, steps, events, wrongs };
}

/** A small seeded generator (mulberry32), so a random toddler plays the same game for the same seed. */
export function seededRandom(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The robot playtest: a toddler who jabs and smears at random, sometimes with the wrong tool in hand, sometimes off the mess, never reading a thing. Strokes are random walks with
 * momentum on a stage 1.5 times the mess; every few samples the finger lifts and a new stroke starts somewhere else. Returns whether it reached `done` within `maxSteps`.
 */
export function toddlerScrub(p: ScrubParams, seed: number, maxSteps = 6000): { done: boolean; steps: number; wrongs: number; state: ScrubState } {
  const rand = seededRandom(seed);
  const cells = scrubCells(p);
  let state = createScrubState(p);
  const spanX = p.width * 1.5, spanZ = p.depth * 1.5;
  let prev: ScrubPoint | null = null;
  let tool: ScrubTool = p.tool;
  let vx = 0, vz = 0;
  let left = 0;
  let steps = 0;
  while (!state.done && steps < maxSteps) {
    let fresh = false;
    if (left <= 0 || !prev) {
      fresh = true;
      left = 3 + Math.floor(rand() * 25);
      prev = { x: (rand() - 0.5) * spanX, z: (rand() - 0.5) * spanZ };
      tool = rand() < 0.25 ? SCRUB_TOOLS[Math.floor(rand() * SCRUB_TOOLS.length)]! : p.tool;
      vx = (rand() - 0.5) * p.brush * 2;
      vz = (rand() - 0.5) * p.brush * 2;
    }
    const nx: number = prev.x + vx + (rand() - 0.5) * p.brush, nz: number = prev.z + vz + (rand() - 0.5) * p.brush;
    const cur: ScrubPoint = { x: Math.max(-spanX / 2, Math.min(spanX / 2, nx)), z: Math.max(-spanZ / 2, Math.min(spanZ / 2, nz)) };
    const dt = fresh ? 0 : 1 / 60;
    const r = scrubTouch(state, p, fresh ? null : prev, { x: cur.x, z: cur.z, tool, dt }, cells);
    state = r.state;
    prev = cur;
    left--;
    steps++;
  }
  return { done: state.done, steps, wrongs: state.wrongs, state };
}
