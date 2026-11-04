// A kicked ball (docs/specs/playful-interactions-spec.md section 6, Toy Room: "Ball: the toy kicks it, it bounces and rolls"): the physics, with no rendering in it.
//
// One dimension along the floor (x) plus a height above it (h, the ball's lowest point). It flies, bounces (each bounce keeps about half the speed), then rolls and slows by friction until it stops.
// A wall at either end of the play area turns it back, a little slower. `stepBall` is pure and substeps long frames, so a hitch cannot make the ball tunnel through the floor or a wall.
export const BALL_R = 0.55;
/** The small ball Kip picks up and throws (it fits his hand; the big one is kicked, being nearly as wide as his chest). */
export const SMALL_BALL_R = 0.22;
/** How big a ball prop of this type is across its radius (it only decides how far it turns as it rolls). */
export const ballRadius = (type: string): number => (type === "smallball" ? SMALL_BALL_R : BALL_R);
export const GRAVITY = 9.8;
export const RESTITUTION = 0.55;
/** Below this vertical speed a bounce is a roll: the ball stays on the floor. */
export const MIN_BOUNCE = 0.8;
/** Rolling friction: speed lost per second while rolling. */
export const ROLL_FRICTION = 2.5;
/** Each time the ball lands it keeps this share of its forward speed (the floor grips it a little), so a kick does not carry through its bounces at full speed. */
export const BOUNCE_KEEP_X = 0.85;
/** Speed kept when the ball hits a wall. */
export const WALL_KEEP = 0.6;
/** Below this speed on the floor the ball is at rest. */
export const STOP_V = 0.05;
/** A ball is always at rest after this long, however it bounces. */
export const MAX_S = 10;

/** The floor's limits for the ball's centre in the Toy Room (the playable lane is about 0.5 to 43.5; the ball is 0.55 across its radius). */
export const BALL_BOUNDS: readonly [number, number] = [0.9, 43.1];

export interface BallState {
  /** Along the floor (world x). */
  x: number;
  /** Height of the ball's lowest point above the floor (0 = on it). */
  h: number;
  vx: number;
  vy: number;
  /** How far it has turned about z (radians): a ball rolling forward (+x) turns by -x / radius, as `useRoll` draws it. */
  spin: number;
  t: number;
  resting: boolean;
}

/** A ball set off from `x` with this speed along the floor and up. `h0` is how high its lowest point starts (0 on the floor: a kick; the height of a hand: a throw). */
export function kick(x: number, vx: number, vy: number, h0 = 0): BallState {
  return { x, h: Number.isFinite(h0) && h0 > 0 ? h0 : 0, vx, vy, spin: 0, t: 0, resting: false };
}

const SUB = 1 / 120;

/** Advance the ball by `dt` seconds inside the floor's limits `[lo, hi]` (the ball's centre stays that far from the ends). Returns a NEW state. */
export function stepBall(s: BallState, dt: number, lo: number, hi: number, radius: number = BALL_R): BallState {
  const n = { ...s };
  if (n.resting) return n;
  let left = Math.min(dt, 1);                         // (a zero, negative or NaN step does nothing: the loop below never runs)
  while (left > 1e-9 && !n.resting) {
    const d = Math.min(SUB, left);
    left -= d;
    n.t += d;
    n.vy -= GRAVITY * d;
    n.h += n.vy * d;
    if (n.h <= 0) {
      n.h = 0;
      if (Math.abs(n.vy) > MIN_BOUNCE) { n.vy = -n.vy * RESTITUTION; n.vx *= BOUNCE_KEEP_X; } else n.vy = 0;
    }
    const x0 = n.x;
    n.x += n.vx * d;
    if (n.x < lo) { n.x = lo; n.vx = Math.abs(n.vx) * WALL_KEEP; }
    else if (n.x > hi) { n.x = hi; n.vx = -Math.abs(n.vx) * WALL_KEEP; }
    if (n.h === 0 && n.vy === 0) {
      const slow = ROLL_FRICTION * d;
      n.vx = Math.abs(n.vx) <= slow ? 0 : n.vx - Math.sign(n.vx) * slow;
    }
    n.spin -= (n.x - x0) / radius;                      // it turns by exactly the distance it rolled
    if ((n.h === 0 && n.vy === 0 && Math.abs(n.vx) < STOP_V) || n.t >= MAX_S) { n.resting = true; n.vx = 0; n.vy = 0; n.h = 0; }
  }
  return n;
}
