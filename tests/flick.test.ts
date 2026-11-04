import { describe, expect, it } from "vitest";
import {
  FLICK_DIRECTIONS,
  createFlickState,
  cycleDistance,
  flickAttempt,
  flickBandParams,
  flickSwitch,
  flickWindowAt,
  playFlick,
  solveFlick,
  swipeDirection,
  toddlerFlick,
  validateFlick,
  type FlickParams,
} from "../src/features/game/world/runtime/flick";

const base = (band: number, needed = 1): FlickParams => ({ period: 1.6, at: 1.2, direction: "up", minTravel: 20, needed, ...flickBandParams(band) });
const up = (t: number) => ({ t, dx: 0, dy: 60 });

describe("flick parameters", () => {
  it("accepts every band", () => {
    for (let b = 0; b <= 5; b++) expect(validateFlick(base(b))).toEqual([]);
  });
  it("names every bad field", () => {
    const bad = { period: 0, at: 9, window: -1, maxWindow: NaN, widenAfter: 0, widenBy: 1, direction: "sideways", minTravel: 0, tapFlicks: "yes", needed: 99 } as unknown as FlickParams;
    const errors = validateFlick(bad).join(" | ");
    for (const w of ["period", "at", "window", "maxWindow", "widenAfter", "widenBy", "direction", "minTravel", "tapFlicks", "needed"]) expect(errors).toContain(w);
  });
  it("refuses a window that can never grow to cover the cycle, so nobody can be shut out", () => {
    expect(validateFlick({ ...base(3), maxWindow: 0.5 }).join()).toContain("shut out");
  });
});

describe("band table", () => {
  it("gets narrower with age and never narrower than the widest it can grow to", () => {
    for (let b = 1; b <= 5; b++) expect(flickBandParams(b).window).toBeLessThanOrEqual(flickBandParams(b - 1).window);
    for (let b = 0; b <= 5; b++) expect(flickBandParams(b).maxWindow).toBeGreaterThanOrEqual(flickBandParams(b).window);
  });
  it("bands 0 and 1 cannot miss: the window is the whole cycle and a tap flips it", () => {
    for (const b of [0, 1]) {
      const p = base(b);
      expect(p.window).toBe(p.period / 2);
      expect(p.tapFlicks).toBe(true);
      for (let t = 0; t < 3.2; t += 0.1) expect(flickAttempt(createFlickState(p), p, { t, dx: 0, dy: 0 }).event).toBe("done");
    }
  });
});

describe("flick attempts", () => {
  it("a swipe up at the sweet spot is a hit", () => {
    const p = base(3);
    expect(flickAttempt(createFlickState(p), p, up(1.2)).event).toBe("done");
  });
  it("counts progress until the last flick", () => {
    const p = base(3, 3);
    const a = flickAttempt(createFlickState(p), p, up(1.2));
    expect(a.event).toBe("progress");
    const b = flickAttempt(a.state, p, up(2.8));
    expect(b.event).toBe("progress");
    expect(flickAttempt(b.state, p, up(4.4)).event).toBe("done");
  });
  it("a swipe off the sweet spot misses with why `timing` and loses nothing", () => {
    const p = base(3);
    const r = flickAttempt(createFlickState(p), p, up(0.4));
    expect(r.event).toBe("wrong");
    expect(r.why).toBe("timing");
    expect(r.state.hits).toBe(0);
    expect(r.state.done).toBe(false);
  });
  it("the wrong direction misses with why `direction`, at the right moment too", () => {
    const p = base(3);
    for (const [dx, dy] of [[0, -60], [60, 0], [-60, 0]] as const) {
      const r = flickAttempt(createFlickState(p), p, { t: 1.2, dx, dy });
      expect(r.event).toBe("wrong");
      expect(r.why).toBe("direction");
    }
  });
  it("a tap where a swipe is needed is only a touch", () => {
    const p = base(3);
    const r = flickAttempt(createFlickState(p), p, { t: 1.2, dx: 1, dy: 1 });
    expect(r.event).toBe("touched");
    expect(r.state.misses).toBe(0);
  });
  it("two misses in a row widen the window, a hit resets the run, and it stops at the whole cycle", () => {
    const p = base(3, 5);
    let s = createFlickState(p);
    const w0 = s.window;
    s = flickAttempt(s, p, up(0.2)).state;
    expect(s.window).toBe(w0);
    s = flickAttempt(s, p, up(0.2)).state;
    expect(s.window).toBeCloseTo(w0 * 1.5);
    expect(s.run).toBe(2);
    // from here on the child swipes the wrong way, so nothing can hit and reset the run: the window grows to its limit and no further
    for (let i = 0; i < 20; i++) s = flickAttempt(s, p, { t: 1.2, dx: 0, dy: -60 }).state;
    expect(s.window).toBeLessThanOrEqual(p.maxWindow);
    expect(s.window).toBe(p.maxWindow);
  });
  it("a hit clears the run of misses", () => {
    const p = base(3, 3);
    let s = flickAttempt(createFlickState(p), p, up(0.2)).state;
    s = flickAttempt(s, p, up(1.2)).state;
    expect(s.run).toBe(0);
    expect(s.misses).toBe(1);
  });
  it("the cycle is circular: just before the start counts as near the end", () => {
    expect(cycleDistance(0.1, 1.5, 1.6)).toBeCloseTo(0.2);
    expect(cycleDistance(3.1, 1.5, 1.6)).toBeCloseTo(0.0);
    const p = { ...base(3), at: 1.55, window: 0.15 };
    expect(flickAttempt(createFlickState(p), p, up(0.05)).event).toBe("done");
  });
  it("ignores everything after done, and a non-finite time", () => {
    const p = base(3);
    const done = flickAttempt(createFlickState(p), p, up(1.2)).state;
    expect(flickAttempt(done, p, up(0.2)).state).toBe(done);
    const s = createFlickState(p);
    expect(flickAttempt(s, p, up(NaN)).state).toBe(s);
  });
  it("reads the swipe direction, and nothing from a short touch", () => {
    expect(swipeDirection({ t: 0, dx: 3, dy: 40 }, 20)).toBe("up");
    expect(swipeDirection({ t: 0, dx: 3, dy: -40 }, 20)).toBe("down");
    expect(swipeDirection({ t: 0, dx: 40, dy: 3 }, 20)).toBe("right");
    expect(swipeDirection({ t: 0, dx: -40, dy: 3 }, 20)).toBe("left");
    expect(swipeDirection({ t: 0, dx: 5, dy: 5 }, 20)).toBeNull();
    expect(swipeDirection({ t: 0, dx: NaN, dy: 50 }, 20)).toBeNull();
  });
  it("does not change the state it was given", () => {
    const p = base(3);
    const s = createFlickState(p);
    flickAttempt(s, p, up(1.2));
    expect(s).toEqual(createFlickState(p));
  });
  it("draws a ring that is full at the sweet spot and gone outside the window", () => {
    const p = base(3);
    const s = createFlickState(p);
    expect(flickWindowAt(s, p, 1.2)).toBe(1);
    expect(flickWindowAt(s, p, 1.2 + s.window)).toBeCloseTo(0);
    expect(flickWindowAt(s, p, 0.2)).toBe(0);
  });
});

describe("players", () => {
  it("the switch form flips on any single action", () => {
    const p = base(3, 3);
    let s = createFlickState(p);
    for (let i = 0; i < 3; i++) s = flickSwitch(s, p).state;
    expect(s.done).toBe(true);
    expect(flickSwitch(s, p).event).toBe("touched");
  });
  it("the solver reaches done at every band, with no miss", () => {
    for (let b = 0; b <= 5; b++) for (const needed of [1, 3, 6]) {
      const p = base(b, needed);
      const out = playFlick(p, solveFlick(p)!);
      expect(out.state.done, `band ${b} x${needed}`).toBe(true);
      expect(out.state.misses).toBe(0);
    }
  });
  it("the solver refuses invalid params", () => {
    expect(solveFlick({ ...base(3), period: -1 })).toBeNull();
  });
  it("a random toddler reaches done, every band, every direction, 60 seeds each", () => {
    for (let b = 0; b <= 5; b++) for (const direction of FLICK_DIRECTIONS) for (let seed = 1; seed <= 60; seed++) {
      const p = { ...base(b, 3), direction };
      const r = toddlerFlick(p, seed);
      expect(r.done, `band ${b} ${direction} seed ${seed} after ${r.steps}`).toBe(true);
    }
  });
  it("a toddler at the younger bands needs no more touches than flicks wanted", () => {
    for (const b of [0, 1]) {
      const p = base(b, 3);
      for (let seed = 1; seed <= 20; seed++) {
        // pokes always flip; a swipe in the wrong direction is the only miss
        expect(toddlerFlick(p, seed).steps).toBeLessThan(60);
      }
    }
  });
});
