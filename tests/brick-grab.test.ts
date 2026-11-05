// The rules of holding a brick of the Kip pile (src/features/game/world/runtime/brickGrab.ts): a tap is a tap, a drag starts past 9 px, every way a hold can end carries the brick on, another finger is
// ignored, a second press ends the first, and a hold nobody lets go of ends by itself.
import { describe, expect, it } from "vitest";
import { createBrickGrab } from "../src/features/game/world/runtime/brickGrab";

/** A clock the test turns by hand. */
function clock() {
  let now = 0, next = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    setTimer: (fn: () => void, ms: number) => { const id = next++; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimer: (id: unknown) => { timers.delete(id as number); },
    advance: (ms: number) => { now += ms; for (const [id, t] of [...timers]) if (t.at <= now) { timers.delete(id); t.fn(); } },
    pending: () => timers.size,
  };
}

describe("a tap", () => {
  it("is a press and a lift that stays within the threshold: nothing moved, and the brick is handed back", () => {
    const g = createBrickGrab<string>();
    expect(g.down("armL", 1, 100, 100)).toBeNull();
    expect(g.move(1, 104, 103)).toBe("ignore");                    // a wobble of 5 px
    expect(g.move(1, 108, 100)).toBe("ignore");                    // 8 px: still a tap
    expect(g.held).toEqual({ item: "armL", id: 1, moved: false });
    expect(g.up(1)).toEqual({ item: "armL", id: 1, moved: false });
    expect(g.held).toBeNull();
  });
});

describe("a drag", () => {
  it("starts on the first move of 9 px or more, once, and every move after is a drag", () => {
    const g = createBrickGrab<number>();
    g.down(7, 3, 50, 50);
    expect(g.move(3, 59, 50)).toBe("start");
    expect(g.move(3, 60, 50)).toBe("drag");
    expect(g.move(3, 50, 50)).toBe("drag");                        // coming back to where it began does not undo the drag
    expect(g.up(3)).toEqual({ item: 7, id: 3, moved: true });
  });
  it("counts the distance as a hypotenuse, not per axis", () => {
    const g = createBrickGrab<number>();
    g.down(1, 1, 0, 0);
    expect(g.move(1, 6, 6)).toBe("ignore");                       // 8.49
    expect(g.move(1, 7, 7)).toBe("start");                        // 9.9
  });
  it("a threshold can be given", () => {
    const g = createBrickGrab<number>({ threshold: 20 });
    g.down(1, 1, 0, 0);
    expect(g.move(1, 15, 0)).toBe("ignore");
    expect(g.move(1, 20, 0)).toBe("start");
  });
});

describe("every way a hold ends carries the brick on", () => {
  it("a lift, a cancel and a lost pointer are all `up` (the caller places the brick whatever the reason)", () => {
    for (const how of ["lift", "cancel", "lost"]) {
      const g = createBrickGrab<string>();
      g.down("legR", 9, 10, 10);
      g.move(9, 80, 80);
      const h = g.up(9);                                           // pointerup, pointercancel and lostpointercapture all end up here
      expect(h, how).toEqual({ item: "legR", id: 9, moved: true });
      expect(g.held).toBeNull();
    }
  });
  it("ending with no pointer id ends whatever is held (the build starting, abort)", () => {
    const g = createBrickGrab<string>();
    g.down("torso", 2, 0, 0);
    expect(g.cancel()).toEqual({ item: "torso", id: 2, moved: false });
    expect(g.cancel()).toBeNull();
    g.down("torso", 2, 0, 0);
    expect(g.up()).toEqual({ item: "torso", id: 2, moved: false });
  });
  it("a hold that nobody lets go of ends by itself after maxMs and tells the caller", () => {
    const c = clock();
    let expired = 0, who: string | null = null;
    const g = createBrickGrab<string>({ maxMs: 20000, setTimer: c.setTimer, clearTimer: c.clearTimer, onExpire: (h) => { expired++; who = h.item; } });
    g.down("head", 4, 0, 0);
    c.advance(19999);
    expect(g.held).not.toBeNull();
    expect(expired).toBe(0);
    c.advance(1);
    expect(g.held).toBeNull();
    expect(expired).toBe(1);
    expect(who).toBe("head");                                         // the caller is told which brick to carry on
  });
  it("a hold that ended normally leaves no timer behind and never calls the expiry", () => {
    const c = clock();
    let expired = 0;
    const g = createBrickGrab<string>({ setTimer: c.setTimer, clearTimer: c.clearTimer, onExpire: () => { expired++; } });
    g.down("head", 4, 0, 0);
    expect(c.pending()).toBe(1);
    g.up(4);
    expect(c.pending()).toBe(0);
    c.advance(60000);
    expect(expired).toBe(0);
  });
});

describe("another finger", () => {
  it("is ignored while a brick is held: its moves and its lift change nothing", () => {
    const g = createBrickGrab<string>();
    g.down("armR", 1, 0, 0);
    expect(g.move(2, 200, 200)).toBe("ignore");
    expect(g.up(2)).toBeNull();
    expect(g.held).toEqual({ item: "armR", id: 1, moved: false });
  });
  it("a second press ends the first hold (handed back to be carried on) and holds the new brick", () => {
    const c = clock();
    const g = createBrickGrab<string>({ setTimer: c.setTimer, clearTimer: c.clearTimer });
    g.down("armR", 1, 0, 0);
    g.move(1, 50, 0);
    expect(g.down("legL", 2, 5, 5)).toEqual({ item: "armR", id: 1, moved: true });
    expect(g.held).toEqual({ item: "legL", id: 2, moved: false });
    expect(c.pending()).toBe(1);                                   // the first hold's timer is gone, only the new one runs
  });
});

describe("nothing held", () => {
  it("moves and lifts with nothing held are ignored, and bad numbers never start a drag", () => {
    const g = createBrickGrab<string>();
    expect(g.move(1, 100, 100)).toBe("ignore");
    expect(g.up(1)).toBeNull();
    expect(g.up()).toBeNull();
    g.down("x", 1, 0, 0);
    expect(g.move(1, Number.NaN, 5)).toBe("ignore");
    expect(g.move(1, 5, Infinity)).toBe("ignore");
    expect(g.held!.moved).toBe(false);
  });
});
