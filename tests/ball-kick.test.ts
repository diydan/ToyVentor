import { describe, expect, it } from "vitest";
import { BALL_R, MAX_S, MIN_BOUNCE, RESTITUTION, STOP_V, WALL_KEEP, kick, stepBall, type BallState } from "../src/features/game/world/runtime/ballKick";

/** Run a ball to rest in 1/60 s frames, recording where it was. */
function fly(s: BallState, lo = 0.7, hi = 43.3, maxFrames = 1200) {
  const path: BallState[] = [s];
  for (let i = 0; i < maxFrames && !s.resting; i++) { s = stepBall(s, 1 / 60, lo, hi); path.push(s); }
  return path;
}

describe("a kicked ball", () => {
  it("rises, comes down, bounces lower each time, rolls and stops, further along than it started", () => {
    const path = fly(kick(10, 5.5, 3.2));
    const last = path.at(-1)!;
    expect(last.resting).toBe(true);
    expect(last.h).toBe(0);
    expect(last.x).toBeGreaterThan(14);                        // it travelled a good way
    expect(last.x).toBeLessThan(30);                           // but is not launched across the room
    expect(Math.max(...path.map((p) => p.h))).toBeGreaterThan(0.3);
    // bounce peaks: each lower than the one before
    const peaks: number[] = [];
    for (let i = 1; i < path.length - 1; i++) if (path[i]!.h > path[i - 1]!.h && path[i]!.h >= path[i + 1]!.h) peaks.push(path[i]!.h);
    expect(peaks.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < peaks.length; i++) expect(peaks[i]!).toBeLessThan(peaks[i - 1]!);
    expect(peaks[1]! / peaks[0]!).toBeCloseTo(RESTITUTION * RESTITUTION, 0);          // each bounce keeps about half the speed, a quarter of the height
  });

  it("never goes below the floor and never turns backwards when kicked forward", () => {
    const path = fly(kick(5, 4, 2.5));
    for (const p of path) { expect(p.h).toBeGreaterThanOrEqual(0); expect(p.vx).toBeGreaterThanOrEqual(0); }
    for (let i = 1; i < path.length; i++) expect(path[i]!.x).toBeGreaterThanOrEqual(path[i - 1]!.x);
  });

  it("a stronger kick goes further", () => {
    expect(fly(kick(5, 7, 3.2)).at(-1)!.x).toBeGreaterThan(fly(kick(5, 4, 3.2)).at(-1)!.x);
  });

  it("rolls and spins forward: negative spin, growing in size as it goes (as the roll prop draws it)", () => {
    const path = fly(kick(5, 4, 3));
    expect(path.at(-1)!.spin).toBeLessThan(-3);
    for (let i = 1; i < path.length; i++) expect(path[i]!.spin).toBeLessThanOrEqual(path[i - 1]!.spin + 1e-12);
    // the turn matches the distance rolled: spin = -x / radius
    expect(path.at(-1)!.spin).toBeCloseTo(-(path.at(-1)!.x - 5) / BALL_R, 1);
  });

  it("is turned back by a wall, a little slower, and stays inside", () => {
    const path = fly(kick(40, 9, 1.5), 0.7, 43.3);
    for (const p of path) { expect(p.x).toBeLessThanOrEqual(43.3 + 1e-9); expect(p.x).toBeGreaterThanOrEqual(0.7 - 1e-9); }
    const hit = path.findIndex((p) => p.x >= 43.3 - 1e-9);
    expect(hit).toBeGreaterThan(0);
    expect(path[hit + 2]!.vx).toBeLessThan(0);
    expect(Math.abs(path[hit + 2]!.vx)).toBeLessThan(9);
    expect(Math.abs(path[hit + 2]!.vx)).toBeLessThanOrEqual(9 * WALL_KEEP + 0.5);
    const leftWall = fly(kick(3, -9, 1.5)).at(-1)!;
    expect(leftWall.x).toBeGreaterThanOrEqual(0.7);
  });

  it("a ball with nearly no bounce just rolls, and a ball at rest stays at rest", () => {
    const rolled = fly(kick(5, 3, MIN_BOUNCE * 0.5));
    expect(Math.max(...rolled.map((p) => p.h))).toBeLessThan(0.05);
    const done = rolled.at(-1)!;
    expect(done.resting).toBe(true);
    expect(stepBall(done, 1, 0.7, 43.3)).toEqual(done);
  });

  it("always comes to rest, within MAX_S, even in a trap", () => {
    const path = fly(kick(5, 0, 12), 0.7, 43.3, 60 * 20);
    expect(path.at(-1)!.resting).toBe(true);
    expect(path.at(-1)!.t).toBeLessThanOrEqual(MAX_S + 0.1);
    expect(Math.abs(path.at(-1)!.vx)).toBeLessThan(STOP_V + 1e-9);
  });

  it("is always at rest after MAX_S, however fast it is still going", () => {
    const s = stepBall({ ...kick(5, 5, 3), t: MAX_S - 0.01 }, 0.05, 0.7, 43.3);
    expect(s.resting).toBe(true);
    expect([s.vx, s.vy, s.h]).toEqual([0, 0, 0]);
  });

  it("does not stop until it has nearly stopped: the last moving frame is slow", () => {
    const path = fly(kick(5, 4, 3));
    const lastMoving = path.at(-2)!;
    expect(lastMoving.resting).toBe(false);
    expect(Math.abs(lastMoving.vx)).toBeLessThan(STOP_V * 4);
    expect(lastMoving.h).toBe(0);
  });

  it("is deterministic, does not change the state it was given, and a long frame is as good as many short ones", () => {
    const s = kick(5, 5, 3);
    const copy = { ...s };
    const a = stepBall(s, 0.5, 0.7, 43.3);
    expect(s).toEqual(copy);
    let b = s;
    for (let i = 0; i < 30; i++) b = stepBall(b, 1 / 60, 0.7, 43.3);
    expect(a.x).toBeCloseTo(b.x, 1);
    expect(a.h).toBeCloseTo(b.h, 1);
    expect(stepBall(s, 0.5, 0.7, 43.3)).toEqual(a);
  });

  it("ignores a zero, negative or NaN step", () => {
    const s = kick(5, 5, 3);
    for (const dt of [0, -1, Number.NaN]) expect(stepBall(s, dt, 0.7, 43.3)).toEqual(s);
  });
});
