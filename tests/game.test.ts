import { describe, expect, it } from "vitest";
import { createGame, stepGame } from "../src/features/game/engine/game";

const base = { speed: 0, spin: 0, glow: 0 };

describe("stepGame", () => {
  it("moves forward and counts the clock down to done", () => {
    let s = createGame(base);
    s = stepGame(s, 1, 0);
    expect(s.distance).toBeCloseTo(9);
    expect(s.timeLeft).toBe(29);
    for (let i = 0; i < 40; i++) s = stepGame(s, 1, 0);
    expect(s.done).toBe(true);
    expect(s.timeLeft).toBe(0);
  });

  it("build speed stat makes the same toy faster", () => {
    const slow = stepGame(createGame(base), 2, 0).distance;
    const fast = stepGame(createGame({ ...base, speed: 3 }), 2, 0).distance;
    expect(fast).toBeGreaterThan(slow);
  });

  it("steering clamps to the track and spin sharpens it", () => {
    const wide = stepGame(createGame(base), 5, 1);
    expect(wide.x).toBeLessThanOrEqual(0.92);
    const sharp = stepGame(createGame({ ...base, spin: 4 }), 0.2, 1).x;
    const dull = stepGame(createGame(base), 0.2, 1).x;
    expect(sharp).toBeGreaterThan(dull);
  });

  it("collects a star dead ahead, worth more with glow", () => {
    const mk = (glow: number) => {
      const s = createGame({ ...base, glow });
      s.stars[0] = { lane: 0, ahead: 10, taken: false };
      return stepGame(s, 1.2, 0).score; // distance ~10.8m, inside catch window
    };
    expect(mk(0)).toBe(10);
    expect(mk(3)).toBe(16);
  });

  it("is deterministic", () => {
    const run = () => {
      let s = createGame({ speed: 2, spin: 1, glow: 2 });
      for (let i = 0; i < 50; i++) s = stepGame(s, 0.2, i % 3 - 1);
      return s.score + s.distance;
    };
    expect(run()).toBe(run());
  });
});
