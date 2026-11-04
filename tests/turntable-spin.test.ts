// The title turntable you can play with (runtime/turntableSpin.ts; Dan, 2026-11-04: hold, pause, slower and faster, in any direction). Pure physics, so every claim is checked with numbers.
import { describe, expect, it } from "vitest";
import {
  DETENTS, DRAG_GAIN, GEAR_RATIO, IDLE_SPEED, MAX_DRAG_SPEED, MAX_FLING, SETTLE_RATE, TICK_MAX, WHOOSH_FROM, createTurntable, tickAudible, whooshFor, type Turntable,
} from "../src/features/game/world/runtime/turntableSpin";

const DT = 1 / 60;
/** Run `seconds` of frames; returns the total turn and the last step. */
function run(t: Turntable, seconds: number, dt = DT) {
  let total = 0;
  let last = t.step(0);
  let ticks = 0;
  let settled = 0;
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    last = t.step(dt);
    total += last.d;
    ticks += last.ticks;
    settled += last.settled ? 1 : 0;
  }
  return { total, last, ticks, settled };
}
/** A finger dragging at a steady `pxPerSec` for `seconds`, rim 100 px. */
function drag(t: Turntable, pxPerSec: number, seconds: number, rim = 100) {
  let total = 0;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    t.drag(pxPerSec * DT, rim);
    total += t.step(DT).d;
  }
  return total;
}

describe("idle", () => {
  it("turns at the speed it always had, 0.45 rad/s, from the first frame", () => {
    const t = createTurntable();
    expect(t.step(DT).d).toBeCloseTo(IDLE_SPEED * DT, 12);
    expect(run(t, 10).total).toBeCloseTo(IDLE_SPEED * 10, 6);
  });
  it("is deterministic: the same inputs give the same turn", () => {
    const a = createTurntable(), b = createTurntable();
    for (const t of [a, b]) { t.grab(); drag(t, 300, 0.3); t.release(); }
    expect(run(a, 3).total).toBe(run(b, 3).total);
  });
  it("survives a zero, negative, huge or NaN frame time", () => {
    const t = createTurntable();
    expect(t.step(0).d).toBe(0);
    expect(t.step(-1).d).toBe(0);
    expect(t.step(Number.NaN).d).toBe(0);
    expect(Math.abs(t.step(99).d)).toBeLessThanOrEqual(IDLE_SPEED * 0.1 + 1e-9);   // clamped to a tenth of a second
  });
});

describe("hold = pause", () => {
  it("a finger down stops the table in a fraction of a second and it stays stopped while the finger is still", () => {
    const t = createTurntable();
    run(t, 1);
    t.grab();
    const braking = run(t, 0.5);
    expect(braking.total).toBeLessThan(IDLE_SPEED * 0.12);                  // it hardly turns once more
    const still = run(t, 3);
    expect(Math.abs(still.total)).toBeLessThan(1e-3);                       // stopped
    expect(still.last.speed).toBeCloseTo(0, 6);
    expect(still.last.held).toBe(true);
  });
  it("lifting a finger that never moved does not fling, and the table picks up again the way it was going", () => {
    const t = createTurntable();
    run(t, 1);
    t.grab(); run(t, 2); t.release();
    expect(t.state().vel).toBeCloseTo(0, 3);
    const after = run(t, 6);
    expect(after.total).toBeGreaterThan(0);                                  // the original direction
    expect(after.last.speed).toBeGreaterThan(IDLE_SPEED * 0.9);
    expect(after.last.speed).toBeLessThanOrEqual(IDLE_SPEED + 1e-9);
  });
  it("a hold on a table that was turning the other way resumes THAT way", () => {
    const t = createTurntable();
    t.grab(); drag(t, -400, 0.3); t.release(); run(t, 5);                    // now turning backwards
    expect(t.state().dir).toBe(-1);
    t.grab(); run(t, 1); t.release();
    expect(run(t, 5).total).toBeLessThan(0);
  });
});

describe("drag = follow the finger, either way", () => {
  it("moves the table by dx / rim x the gain, right is positive, left negative", () => {
    const t = createTurntable();
    t.grab(); run(t, 2);                                                     // let the brake finish
    t.drag(5, 100);                                                          // a twentieth of a rim to the right (under the follow limit)
    expect(t.step(DT).d).toBeCloseTo(0.05 * DRAG_GAIN, 6);
    t.drag(-3, 100);
    expect(t.step(DT).d).toBeCloseTo(-0.03 * DRAG_GAIN, 6);
  });
  it("a slow drag turns it slowly and a faster drag turns it faster", () => {
    const slow = createTurntable(), fast = createTurntable();
    slow.grab(); fast.grab();
    run(slow, 0.5); run(fast, 0.5);
    expect(Math.abs(drag(fast, 200, 1))).toBeGreaterThan(Math.abs(drag(slow, 50, 1)) * 3.5);
  });
  it("cannot be dragged past the follow limit: a wild swipe is rate-limited, the rest catches up", () => {
    const t = createTurntable();
    t.grab(); run(t, 2);
    t.drag(100000, 100);
    const s = t.step(DT);
    expect(s.d).toBeLessThanOrEqual(MAX_DRAG_SPEED * DT + 1e-9);
    expect(s.speed).toBeLessThanOrEqual(MAX_DRAG_SPEED + 1e-6);
  });
  it("a drag with no finger down does nothing", () => {
    const t = createTurntable();
    t.drag(500, 100);
    expect(t.step(DT).d).toBeCloseTo(IDLE_SPEED * DT, 12);
  });
  it("a zero or NaN rim does not blow up", () => {
    const t = createTurntable();
    t.grab(); t.drag(10, 0); t.drag(Number.NaN, Number.NaN);
    expect(Number.isFinite(t.step(DT).d)).toBe(true);
  });
});

describe("release = a fling that eases back to idle", () => {
  it("keeps the speed of the finger, then friction brings it back to idle in the direction it was flung", () => {
    const t = createTurntable();
    t.grab(); run(t, 0.3);
    drag(t, 250, 0.25);                                                      // 250 px/s on a 100 px rim = 2.5 x 1.5 = 3.75 rad/s
    t.release();
    const v0 = t.state().vel;
    expect(v0).toBeGreaterThan(3);
    expect(v0).toBeLessThanOrEqual(MAX_FLING);
    const half = run(t, 0.5).last.speed;
    expect(half).toBeLessThan(v0);
    expect(half).toBeGreaterThan(IDLE_SPEED);
    const later = run(t, 6);
    expect(later.last.speed).toBeCloseTo(IDLE_SPEED, 2);
    expect(t.state().dir).toBe(1);
  });
  it("friction is the documented rate: the gap to idle shrinks by exp(-SETTLE_RATE t)", () => {
    const t = createTurntable();
    t.grab(); run(t, 0.3); drag(t, 300, 0.3); t.release();
    const v0 = t.state().vel;
    const v1 = run(t, 1).last.speed;
    expect(v1 - IDLE_SPEED).toBeCloseTo((v0 - IDLE_SPEED) * Math.exp(-SETTLE_RATE), 2);
  });
  it("flung the other way it turns the other way from then on, at the idle speed", () => {
    const t = createTurntable();
    t.grab(); run(t, 0.3); drag(t, -250, 0.25); t.release();
    const out = run(t, 8);
    expect(t.state().dir).toBe(-1);
    expect(out.last.speed).toBeCloseTo(-IDLE_SPEED, 2);
    expect(out.total).toBeLessThan(0);
  });
  it("a finger that stopped before it lifted flings (almost) nothing", () => {
    const t = createTurntable();
    t.grab(); run(t, 0.3); drag(t, 300, 0.3);
    run(t, 0.3);                                                             // finger rests, still down
    t.release();
    expect(Math.abs(t.state().vel)).toBeLessThan(0.05);
  });
  it("the speed is capped, however hard it was flicked", () => {
    const t = createTurntable();
    t.grab(); run(t, 0.3); drag(t, 100000, 0.2); t.release();
    expect(Math.abs(t.state().vel)).toBeLessThanOrEqual(MAX_FLING + 1e-9);
    let top = 0;
    for (let i = 0; i < 300; i++) top = Math.max(top, Math.abs(t.step(DT).speed));
    expect(top).toBeLessThanOrEqual(MAX_FLING + 1e-9);
  });
  it("fires `settled` once, when a real fling is over, and never for a gentle one", () => {
    const hard = createTurntable();
    hard.grab(); run(hard, 0.3); drag(hard, 300, 0.3); hard.release();
    const r = run(hard, 8);
    expect(r.settled).toBe(1);
    const gentle = createTurntable();
    gentle.grab(); run(gentle, 0.3); drag(gentle, 15, 0.3); gentle.release();
    expect(run(gentle, 8).settled).toBe(0);
  });
});

describe("prefers-reduced-motion", () => {
  it("caps a fling at the idle speed, but the table still follows a dragging finger", () => {
    const t = createTurntable({ reduceMotion: true });
    t.grab(); run(t, 0.3);
    const dragged = drag(t, 300, 0.5);
    expect(dragged).toBeGreaterThan(IDLE_SPEED * 0.5 * 3);                    // follows the finger
    t.release();
    expect(Math.abs(t.state().vel)).toBeLessThanOrEqual(IDLE_SPEED + 1e-9);
    let top = 0;
    for (let i = 0; i < 300; i++) top = Math.max(top, Math.abs(t.step(DT).speed));
    expect(top).toBeLessThanOrEqual(IDLE_SPEED + 1e-9);
  });
  it("a key nudge only reverses or sets the idle speed", () => {
    const t = createTurntable({ reduceMotion: true });
    t.nudge(-1);
    expect(Math.abs(t.state().vel)).toBeLessThanOrEqual(IDLE_SPEED + 1e-9);
  });
});

describe("keys", () => {
  it("an arrow adds speed that way and it settles like a fling", () => {
    const t = createTurntable();
    t.nudge(-1);
    expect(t.state().vel).toBeLessThan(-1);
    expect(t.state().dir).toBe(-1);
    t.nudge(-1); t.nudge(-1); t.nudge(-1); t.nudge(-1);
    expect(Math.abs(t.state().vel)).toBeLessThanOrEqual(MAX_FLING + 1e-9);
    expect(run(t, 8).last.speed).toBeCloseTo(-IDLE_SPEED, 2);
  });
});

describe("park", () => {
  it("puts a spinning, held table back to the idle turn", () => {
    const t = createTurntable();
    t.grab(); drag(t, 300, 0.3); t.release(); t.grab();
    t.park();
    expect(t.state()).toEqual({ vel: IDLE_SPEED, dir: 1, held: false, excited: false });
    expect(t.step(DT).d).toBeCloseTo(IDLE_SPEED * DT, 12);
  });
});

describe("detents (the 16 rim lights)", () => {
  it("one tick per 1/16 turn, in either direction", () => {
    const fwd = createTurntable(), back = createTurntable();
    for (const [t, sgn] of [[fwd, 1], [back, -1]] as const) {
      t.grab(); run(t, 0.3);
      let ticks = 0, turned = 0;
      for (let i = 0; i < 60; i++) { t.drag(sgn * 4, 100); const s = t.step(DT); ticks += s.ticks; turned += Math.abs(s.d); }
      expect(Math.abs(ticks - turned / ((2 * Math.PI) / DETENTS))).toBeLessThanOrEqual(1);
    }
  });
  it("a full turn is 16 ticks", () => {
    const t = createTurntable();
    expect(Math.abs(run(t, (2 * Math.PI) / IDLE_SPEED).ticks - DETENTS)).toBeLessThanOrEqual(1);
  });
});

describe("the sound's numbers", () => {
  it("nothing at idle, rising and brightening with speed, leaning the way it turns", () => {
    expect(whooshFor(IDLE_SPEED).gain).toBe(0);
    expect(whooshFor(IDLE_SPEED * WHOOSH_FROM * 0.99).gain).toBe(0);
    let last = whooshFor(1);
    for (const s of [2, 3, 4, 5, 6.5]) {
      const w = whooshFor(s);
      expect(w.gain).toBeGreaterThanOrEqual(last.gain);
      expect(w.freq).toBeGreaterThan(last.freq);
      last = w;
    }
    expect(whooshFor(6.5).gain).toBeLessThanOrEqual(0.16 + 1e-9);
    expect(whooshFor(5).pan).toBeGreaterThan(0);
    expect(whooshFor(-5).pan).toBeLessThan(0);
    expect(whooshFor(-5).gain).toBeCloseTo(whooshFor(5).gain, 12);
  });
  it("is silent under reduced motion and for a bad number", () => {
    expect(whooshFor(6, IDLE_SPEED, true).gain).toBe(0);
    expect(whooshFor(Number.NaN).gain).toBe(0);
  });
  it("ticks only while the table is being played with, slowly enough to hear one by one", () => {
    expect(tickAudible({ active: false, speed: 1 })).toBe(false);            // idle, untouched
    expect(tickAudible({ active: true, speed: 1 })).toBe(true);
    expect(tickAudible({ active: true, speed: TICK_MAX + 0.1 })).toBe(false); // a buzz inside the whoosh
    expect(tickAudible({ active: true, speed: 0.05 })).toBe(false);
    expect(tickAudible({ active: true, speed: 1 }, true)).toBe(false);        // reduced motion
  });
});

describe("the gears", () => {
  it("keep the proportions they had against the table (0.6 and -0.9 against 0.45)", () => {
    expect(GEAR_RATIO[0]).toBeCloseTo(0.6 / 0.45, 12);
    expect(GEAR_RATIO[1]).toBeCloseTo(-0.9 / 0.45, 12);
  });
});
