// The title page's turntable you can play with (Dan, 2026-11-04: "on the first page we have kip on a turn table, can we make the speed interactive so we can hold, pause, slower and faster in
// any direction"). Pure: no DOM, no three.js, no audio and no clock. The world (runtime/world.ts) owns the table's angle and feeds this the finger's movement; this owns the speed.
//
//   hold      a finger down stops the table under it (it brakes in about a tenth of a second) and it stays stopped while the finger stays still
//   drag      the table follows the finger, either way (right = the front of the table goes right); the follow is rate-limited, so a wild swipe cannot spin it faster than `MAX_DRAG_SPEED`
//   release   a fling: the table keeps the speed the finger had (an average over the last ~40 ms, so a finger that stopped before it lifted flings nothing), capped at `MAX_FLING`,
//             and its friction eases that speed back to the slow idle turn, IN THE DIRECTION IT WAS LAST GOING (a flick the other way makes it turn the other way from then on)
//   reduced   prefers-reduced-motion: a fling is capped at the idle speed (dragging still follows the finger, because the child is moving it), and `whoosh` is silent
//   park      the table is not on show (the world is playing): back to the idle turn, nothing held
//
// `step(dt)` returns how far to turn the table this frame and what the sound needs (speed, detents passed, a `settled` event once a fling has died down).
// The table's 16 rim lights are the detents: each one passing the front is a `tick`.

/** The table's own slow turn, radians a second (the constant it had before it could be touched). */
export const IDLE_SPEED = 0.45;
/** The fastest a released spin can be: about one turn a second, a record deck's 45 rpm and a half. Faster than that and a toy standing on it starts to look sick. */
export const MAX_FLING = 6.5;
/** The fastest the table follows a finger, radians a second. A little over the fling cap so a normal drag feels glued to the finger. */
export const MAX_DRAG_SPEED = 9;
/** Friction: the share of the gap to the idle speed that is closed each second (1.5: the gap is a third as big after 0.73 s). */
export const SETTLE_RATE = 1.5;
/** How quickly a finger landing brakes the table, seconds (the time constant). */
export const BRAKE_TIME = 0.08;
/** The finger's speed is averaged over this long, seconds, so a pause before lifting cancels the fling. */
export const FLING_WINDOW = 0.04;
/** One turn of the finger across the table's rim is this many turns of the table: a little more than 1 so a small hand can spin it without a long reach. */
export const DRAG_GAIN = 1.5;
/** The rim lights, which are the detents. */
export const DETENTS = 16;
/** A press of the arrow keys adds this much speed. */
export const NUDGE = 1.8;
/** A fling above this many times the idle speed counts as an excited table: it ticks while it slows and `settled` fires when it is back. */
const EXCITED_ABOVE = 1.6;
const CALM_BELOW = 1.15;
/** The gears on the wall follow the table, in its own proportions (they used to turn at 0.6 and -0.9 against its 0.45). */
export const GEAR_RATIO: readonly [number, number] = [0.6 / 0.45, -0.9 / 0.45];

export interface SpinStep {
  /** How far to turn the table this frame, radians (signed). */
  d: number;
  /** The table's speed now, radians a second (signed). */
  speed: number;
  /** Detents (rim lights) that went past the front this frame. */
  ticks: number;
  /** True on the one frame a flung table is back near its idle speed. */
  settled: boolean;
  /** A finger is down. */
  held: boolean;
  /** A finger is down and has moved it recently, or the table is in the slow-down after a fling: the sound plays ticks only then, never at idle. */
  active: boolean;
}

export interface Turntable {
  /** A finger came down on the table. */
  grab(): void;
  /** The finger moved `dxPx` sideways; `rimPx` is the table's radius on screen in pixels (so a finger on the front rim and the rim move together). */
  drag(dxPx: number, rimPx: number): void;
  /** The finger lifted: fling. */
  release(): void;
  /** A key: add speed this way (-1 left, 1 right). */
  nudge(dir: 1 | -1): void;
  step(dt: number): SpinStep;
  /** The table is off show: idle turn, nothing held, nothing pending. */
  park(): void;
  /** For tests and the world's debugging. */
  state(): { vel: number; dir: 1 | -1; held: boolean; excited: boolean };
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const num = (v: number, d = 0): number => (Number.isFinite(v) ? v : d);

export function createTurntable(opts: { idle?: number; reduceMotion?: boolean } = {}): Turntable {
  const idle = opts.idle ?? IDLE_SPEED;
  const reduce = !!opts.reduceMotion;
  const maxFling = reduce ? idle : MAX_FLING;
  let vel = idle;           // the free speed, signed
  let dir: 1 | -1 = 1;      // which way it last turned: where it settles
  let held = false;
  let pending = 0;          // finger movement not yet turned into table movement, radians
  let est = 0;              // the finger's speed (a short average), radians a second
  let excited = false;
  let phase = 0;            // the table's total turn, only to count detents
  let moved = 0;            // seconds since the finger last moved

  const detent = (2 * Math.PI) / DETENTS;

  return {
    grab() {
      held = true;
      pending = 0;
      est = 0;
      moved = 1;
      excited = false;
    },
    drag(dxPx, rimPx) {
      if (!held) return;
      const rim = Math.max(1, num(rimPx, 1));
      pending += (num(dxPx) / rim) * DRAG_GAIN;
      moved = 0;
    },
    release() {
      if (!held) return;
      held = false;
      pending = 0;
      vel = clamp(est, -maxFling, maxFling);
      if (Math.abs(vel) > 0.12) dir = vel > 0 ? 1 : -1;   // a hold with no drag leaves the way it was going
      est = 0;
      excited = Math.abs(vel) > EXCITED_ABOVE * idle;
    },
    nudge(d) {
      vel = clamp(vel + d * (reduce ? idle : NUDGE), -maxFling, maxFling);
      dir = vel > 0 ? 1 : -1;
      excited = Math.abs(vel) > EXCITED_ABOVE * idle;
    },
    step(dt0) {
      const dt = clamp(num(dt0, 0), 0, 0.1);
      let d = 0;
      let settled = false;
      if (dt > 0) {
        if (held) {
          // brake whatever speed it had under the finger, then follow the finger
          vel += (0 - vel) * (1 - Math.exp(-dt / BRAKE_TIME));
          d += vel * dt;
          const limit = MAX_DRAG_SPEED * dt;
          const take = clamp(pending, -limit, limit);
          pending -= take;
          d += take;
          // the finger's speed: what it just did, averaged over a short window (nothing moved = it decays to 0)
          est += (take / dt - est) * (1 - Math.exp(-dt / FLING_WINDOW));
          moved += dt;
        } else {
          const target = dir * idle;
          vel += (target - vel) * (1 - Math.exp(-SETTLE_RATE * dt));
          vel = clamp(vel, -maxFling, maxFling);
          if (Math.abs(vel) > 0.12) dir = vel > 0 ? 1 : -1;
          d += vel * dt;
          if (excited && Math.abs(vel) < CALM_BELOW * idle) {
            excited = false;
            settled = true;
          }
        }
      }
      const before = Math.floor(phase / detent);
      phase += d;
      const ticks = Math.abs(Math.floor(phase / detent) - before);
      const speed = dt > 0 ? (held ? d / dt : vel) : held ? 0 : vel;
      return { d, speed, ticks, settled, held, active: (held && moved < 0.25) || excited };
    },
    park() {
      vel = idle;
      dir = 1;
      held = false;
      pending = 0;
      est = 0;
      excited = false;
      moved = 1;
    },
    state: () => ({ vel, dir, held, excited }),
  };
}

// ---- the sound's numbers --------------------------------------------------------------------------------------------------------------------------------------------

export interface Whoosh {
  /** 0 to about 0.16: the gain of the filtered noise. */
  gain: number;
  /** The noise's band centre, Hz: low and soft when slow, higher and brighter when fast. */
  freq: number;
  /** -0.45 to 0.45: the whoosh leans the way the table turns. */
  pan: number;
}
/** Where the whoosh starts and is full, in multiples of the idle speed: nothing at idle, and not much before the table is clearly spinning. */
export const WHOOSH_FROM = 1.3;
export const WHOOSH_FULL = 6;
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** The whoosh for a table turning at `speed` (signed, radians a second). Silent at idle, silent under reduced motion. */
export function whooshFor(speed: number, idle = IDLE_SPEED, reduceMotion = false): Whoosh {
  if (reduceMotion || !Number.isFinite(speed)) return { gain: 0, freq: 300, pan: 0 };
  const w = smooth(WHOOSH_FROM * idle, WHOOSH_FULL, Math.abs(speed));
  return { gain: 0.16 * w, freq: 260 + 1700 * w ** 1.2, pan: clamp(Math.sign(speed) * 0.45 * smooth(0.3, 3, Math.abs(speed)), -0.45, 0.45) };
}
/**
 * Should the ratchet tick play? Only while the table is being played with (a finger moving it, or the slow-down after a fling), only when it is slow enough for single ticks to be heard
 * (above `TICK_MAX` they would be a buzz inside the whoosh), and not when it is crawling.
 */
export const TICK_MAX = 3.4;
export function tickAudible(step: Pick<SpinStep, "active" | "speed">, reduceMotion = false): boolean {
  if (reduceMotion || !step.active) return false;
  const s = Math.abs(step.speed);
  return s > 0.12 && s < TICK_MAX;
}
