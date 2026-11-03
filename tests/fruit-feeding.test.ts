// Drag-to-feed assembled: a recording adapter stands in for the world, and the gesture and the appetite rules run for real.
import { describe, expect, it } from "vitest";
import { FULL_AFTER, FULL_FOR_S, type EaterKind, type Verdict } from "../src/features/game/world/runtime/fruitAppetite";
import { AFTER_GAP_S, REACTION_SECONDS, createFeeding, reactionSteps, type FeedAdapter } from "../src/features/game/world/runtime/fruitFeeding";
import type { FruitKind } from "../src/features/game/world/runtime/propReactions";

interface Fruit { id: number; kind: FruitKind }

function harness(start: { eater?: EaterKind } = {}) {
  const log: string[] = [];
  const verdicts: Verdict[] = [];
  const s = { t: 0, eater: (start.eater ?? "character") as EaterKind, fruit: { id: 1, kind: "apple" } as Fruit };
  const TOY = { x: 100, y: 100, r: 30 };
  const adapter: FeedAdapter<Fruit> = {
    pick: (x, y) => (Math.hypot(x - 300, y - 300) < 20 ? s.fruit : null),
    kindOf: (f) => f.kind,
    eater: () => s.eater,
    now: () => s.t,
    overToy: (x, y) => Math.hypot(x - TOY.x, y - TOY.y) <= TOY.r,
    tap: (f) => log.push(`tap:${f.kind}`),
    pickUp: (f) => log.push(`pickUp:${f.kind}`),
    carry: () => { /* positions are not interesting here */ },
    lean: (over) => log.push(`lean:${over}`),
    drop: (f, x, y) => log.push(`drop:${f.kind}@${x},${y}`),
    eat: (f, v) => { log.push(`eat:${f.kind}:${v.reaction}${v.after ? `+${v.after}` : ""}`); verdicts.push(v); },
    refuse: (f, v) => { log.push(`refuse:${f.kind}:${v.reaction}${v.full ? ":full" : ""}`); verdicts.push(v); },
  };
  const feeding = createFeeding(adapter);
  /** A whole drag from the fruit to (x, y). */
  const dragTo = (x: number, y: number, kind: FruitKind = "apple") => {
    s.fruit = { id: s.fruit.id + 1, kind };
    feeding.drag.down(300, 300);
    feeding.drag.move(250, 280);
    feeding.drag.move(x, y);
    feeding.drag.up(x, y);
  };
  const toy = () => dragTo(TOY.x, TOY.y);
  return { log, verdicts, s, feeding, dragTo, toy, TOY };
}

describe("feeding a character", () => {
  it("a fruit dragged onto the toy is eaten, never dropped", () => {
    const h = harness();
    h.toy();
    expect(h.log).toEqual(["pickUp:apple", "lean:true", "lean:false", "eat:apple:eat"]);
  });

  it("a lemon makes the toy pull a sour face (and is still eaten)", () => {
    const h = harness();
    h.dragTo(h.TOY.x, h.TOY.y, "lemon");
    expect(h.log.at(-1)).toBe("eat:lemon:sour");
  });

  it("the fruit that fills the toy is followed by a belly pat, then the toy refuses until it is hungry again", () => {
    const h = harness();
    for (let i = 0; i < FULL_AFTER; i++) { h.toy(); h.s.t += 2; }
    expect(h.log.filter((l) => l.startsWith("eat:"))).toEqual(["eat:apple:eat", "eat:apple:eat", "eat:apple:eat+belly_pat"]);
    h.toy();                                               // still full
    expect(h.log.at(-1)).toBe("refuse:apple:belly_pat:full");
    h.s.t += FULL_FOR_S + 1;                               // time passes
    h.toy();
    expect(h.log.at(-1)).toBe("eat:apple:eat");
  });
});

describe("other toys", () => {
  it("a robot crunches", () => {
    const h = harness({ eater: "robot" });
    h.toy();
    expect(h.log.at(-1)).toBe("eat:apple:crunch");
  });

  it("a vehicle declines: the fruit is refused (not eaten, not lost) and the appetite is not used up", () => {
    const h = harness({ eater: "vehicle" });
    for (let i = 0; i < FULL_AFTER + 2; i++) { h.toy(); h.s.t += 1; }
    expect(h.log.filter((l) => l.startsWith("refuse:"))).toHaveLength(FULL_AFTER + 2);
    expect(h.log.every((l) => !l.startsWith("eat:"))).toBe(true);
    h.s.eater = "character";                               // switch toys: it is not full from the refusals
    h.toy();
    expect(h.log.at(-1)).toBe("eat:apple:eat");
  });

  it("asks which toy it is at the moment of release (the player can switch between drags)", () => {
    const h = harness();
    h.toy();
    h.s.eater = "robot";
    h.toy();
    expect(h.log.filter((l) => l.startsWith("eat:"))).toEqual(["eat:apple:eat", "eat:apple:crunch"]);
  });

  it("something that is not food (snow) is refused, not eaten", () => {
    const h = harness();
    h.dragTo(h.TOY.x, h.TOY.y, "snow");
    expect(h.log.at(-1)).toMatch(/^refuse:snow:/);
  });
});

describe("everything that is not a feed", () => {
  it("a tap names the fruit and never feeds or fills the toy", () => {
    const h = harness();
    for (let i = 0; i < 6; i++) { h.feeding.drag.down(300, 300); h.feeding.drag.up(300, 300); }
    expect(h.log).toEqual(Array(6).fill("tap:apple"));
    h.toy();                                               // not full: six taps are not six meals
    expect(h.log.at(-1)).toBe("eat:apple:eat");
  });

  it("a fruit let go away from the toy is dropped there, and does not count as a meal", () => {
    const h = harness();
    for (let i = 0; i < 5; i++) h.dragTo(200, 250);
    expect(h.log.filter((l) => l.startsWith("drop:"))).toHaveLength(5);
    expect(h.log.at(-1)).toBe("drop:apple@200,250");
    h.toy();
    expect(h.log.at(-1)).toBe("eat:apple:eat");
  });

  it("a cancelled carry drops the fruit and feeds nothing; the toy stops leaning", () => {
    const h = harness();
    h.s.fruit = { id: 9, kind: "pear" };
    h.feeding.drag.down(300, 300);
    h.feeding.drag.move(250, 280);
    h.feeding.drag.move(h.TOY.x, h.TOY.y);                 // over the toy
    h.feeding.drag.cancel();
    expect(h.log).toEqual(["pickUp:pear", "lean:true", "lean:false", `drop:pear@${h.TOY.x},${h.TOY.y}`]);
  });

  it("a press that misses every fruit is not ours", () => {
    const h = harness();
    expect(h.feeding.drag.down(10, 10)).toBe(false);
    expect(h.log).toEqual([]);
  });

  it("reset forgets fullness and any gesture in progress", () => {
    const h = harness();
    for (let i = 0; i < FULL_AFTER; i++) { h.toy(); h.s.t += 1; }
    expect(h.feeding.appetite.isFull).toBe(true);
    h.feeding.drag.down(300, 300);
    h.feeding.reset();
    expect(h.feeding.appetite.isFull).toBe(false);
    expect(h.feeding.drag.state).toBe("idle");
  });
});

describe("reactionSteps", () => {
  it("a plain verdict is one step at once", () => {
    expect(reactionSteps({ fed: true, reaction: "eat", full: false })).toEqual([{ at: 0, reaction: "eat" }]);
    expect(reactionSteps({ fed: false, reaction: "decline", full: false })).toEqual([{ at: 0, reaction: "decline" }]);
  });

  it("the belly pat starts after the first reaction has finished, with a gap", () => {
    for (const first of ["eat", "sour", "crunch"] as const) {
      const [a, b] = reactionSteps({ fed: true, reaction: first, after: "belly_pat", full: true });
      expect(a).toEqual({ at: 0, reaction: first });
      expect(b!.reaction).toBe("belly_pat");
      expect(b!.at).toBeCloseTo(REACTION_SECONDS[first] + AFTER_GAP_S, 6);
      expect(b!.at).toBeGreaterThan(REACTION_SECONDS[first]);
    }
  });

  it("the clip lengths are the real ones", () => {
    expect(REACTION_SECONDS.eat).toBeCloseTo(1.7, 6);
    expect(REACTION_SECONDS.sour).toBeCloseTo(1.1, 6);
    expect(REACTION_SECONDS.belly_pat).toBeCloseTo(1.6, 6);
  });
});
