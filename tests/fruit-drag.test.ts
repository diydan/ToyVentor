import { describe, expect, it } from "vitest";
import { DRAG_THRESHOLD_PX, createFruitDrag } from "../src/features/game/world/runtime/fruitDrag";

// The drag-to-feed gesture (docs/specs/playful-interactions-spec.md section 4): tap, carry, drop, feed, with the world faked and every callback recorded.
type Fruit = { id: string };
const APPLE: Fruit = { id: "apple" }, PEAR: Fruit = { id: "pear" };

function setup(over: { fruit?: Array<{ f: Fruit; x: number; y: number; r: number }>; toy?: { x: number; y: number; r: number } } = {}) {
  const fruit = over.fruit ?? [{ f: APPLE, x: 100, y: 100, r: 20 }];
  const toy = over.toy ?? { x: 300, y: 100, r: 60 };
  const log: string[] = [];
  const drag = createFruitDrag<Fruit>({
    pick: (x, y) => fruit.find((q) => Math.hypot(x - q.x, y - q.y) <= q.r)?.f ?? null,
    overToy: (x, y) => Math.hypot(x - toy.x, y - toy.y) <= toy.r,
    tap: (f) => log.push(`tap:${f.id}`),
    pickUp: (f) => log.push(`pickUp:${f.id}`),
    carry: (f, x, y) => log.push(`carry:${f.id}@${x},${y}`),
    hover: (o, f) => log.push(`hover:${o}:${f.id}`),
    feed: (f) => log.push(`feed:${f.id}`),
    drop: (f, x, y) => log.push(`drop:${f.id}@${x},${y}`),
  });
  return { drag, log };
}

describe("a tap: press and release without moving", () => {
  it("claims the press, says nothing on press, and taps the fruit on release", () => {
    const { drag, log } = setup();
    expect(drag.down(100, 100)).toBe(true);
    expect(drag.state).toBe("pressed");
    expect(log).toEqual([]);              // not on press: a drag must not also speak the name
    expect(drag.up(100, 100)).toBe(true);
    expect(log).toEqual(["tap:apple"]);
    expect(drag.state).toBe("idle");
  });
  it("a shaky finger (movement within the threshold) is still a tap", () => {
    const { drag, log } = setup();
    drag.down(100, 100);
    expect(drag.move(100 + DRAG_THRESHOLD_PX, 100)).toBe(true);
    expect(drag.state).toBe("pressed");
    drag.up(103, 99);
    expect(log).toEqual(["tap:apple"]);
  });
  it("a press that misses every fruit is not claimed, so the world can walk the toy or shake the tree as before", () => {
    const { drag, log } = setup();
    expect(drag.down(500, 500)).toBe(false);
    expect(drag.state).toBe("idle");
    expect(drag.move(510, 500)).toBe(false);
    expect(drag.up(510, 500)).toBe(false);
    expect(log).toEqual([]);
  });
});

describe("a carry: press, move past the threshold", () => {
  it("lifts the fruit once, then it follows the finger", () => {
    const { drag, log } = setup();
    drag.down(100, 100);
    drag.move(100 + DRAG_THRESHOLD_PX + 1, 100);
    drag.move(140, 100);
    drag.move(180, 100);
    expect(drag.state).toBe("carrying");
    expect(log).toEqual(["pickUp:apple", "carry:apple@109,100", "carry:apple@140,100", "carry:apple@180,100"]);
  });
  it("released over the toy, the toy is fed (and the fruit is not dropped, nor tapped)", () => {
    const { drag, log } = setup();
    drag.down(100, 100);
    drag.move(200, 100);
    drag.move(290, 100);            // over the toy
    drag.up(295, 102);
    expect(log.filter((l) => l.startsWith("feed")).length).toBe(1);
    expect(log.some((l) => l.startsWith("drop") || l.startsWith("tap"))).toBe(false);
    expect(drag.state).toBe("idle");
  });
  it("released anywhere else, the fruit is dropped where the finger was let go, and nobody is fed", () => {
    const { drag, log } = setup();
    drag.down(100, 100);
    drag.move(150, 160);
    drag.up(150, 160);
    expect(log.at(-1)).toBe("drop:apple@150,160");
    expect(log.some((l) => l.startsWith("feed") || l.startsWith("tap"))).toBe(false);
  });
  it("the toy is told when the finger comes over it and when it leaves, once per change (so it can lean in and look away)", () => {
    const { drag, log } = setup();
    drag.down(100, 100);
    drag.move(150, 100);            // not over
    drag.move(280, 100);            // enters
    drag.move(300, 100);            // still over: no repeat
    drag.move(320, 110);            // still over
    drag.move(450, 100);            // leaves
    drag.move(460, 100);
    expect(log.filter((l) => l.startsWith("hover"))).toEqual(["hover:true:apple", "hover:false:apple"]);
  });
  it("releasing while over the toy first lets the toy settle (hover off), then feeds", () => {
    const { drag, log } = setup();
    drag.down(100, 100);
    drag.move(300, 100);
    drag.up(300, 100);
    expect(log.slice(-2)).toEqual(["hover:false:apple", "feed:apple"]);
  });
  it("once carrying, coming back to where it started is still a carry (a drag is a drag), so it is dropped there, not tapped", () => {
    const { drag, log } = setup();
    drag.down(100, 100);
    drag.move(160, 100);
    drag.move(100, 100);
    drag.up(100, 100);
    expect(log.at(-1)).toBe("drop:apple@100,100");
    expect(log.some((l) => l.startsWith("tap"))).toBe(false);
  });
  it("carries the fruit it picked, not another one that happens to be under the finger later", () => {
    const { drag, log } = setup({ fruit: [{ f: APPLE, x: 100, y: 100, r: 20 }, { f: PEAR, x: 200, y: 100, r: 20 }] });
    drag.down(100, 100);
    drag.move(200, 100);            // over the pear
    drag.up(200, 100);
    expect(log.every((l) => !l.includes("pear"))).toBe(true);
    expect(log.at(-1)).toBe("drop:apple@200,100");
  });
});

describe("interruptions and other fingers", () => {
  it("a second finger is ignored while the first is down, and cannot release or move the first's fruit", () => {
    const { drag, log } = setup({ fruit: [{ f: APPLE, x: 100, y: 100, r: 20 }, { f: PEAR, x: 200, y: 100, r: 20 }] });
    expect(drag.down(100, 100, 1)).toBe(true);
    expect(drag.down(200, 100, 2)).toBe(false);     // the pear is not picked up by a second finger
    expect(drag.move(250, 100, 2)).toBe(false);
    expect(drag.up(250, 100, 2)).toBe(false);
    expect(drag.state).toBe("pressed");
    drag.up(100, 100, 1);
    expect(log).toEqual(["tap:apple"]);
  });
  it("cancelling a carry drops the fruit where it was, and tells the toy it is no longer being offered one", () => {
    const { drag, log } = setup();
    drag.down(100, 100);
    drag.move(300, 100);            // over the toy
    drag.cancel();
    expect(log.slice(-2)).toEqual(["hover:false:apple", "drop:apple@300,100"]);
    expect(drag.state).toBe("idle");
    expect(drag.up(300, 100)).toBe(false);          // the late release is ignored
  });
  it("cancelling a merely pressed fruit does nothing (no tap, no drop)", () => {
    const { drag, log } = setup();
    drag.down(100, 100);
    drag.cancel();
    expect(log).toEqual([]);
    expect(drag.state).toBe("idle");
  });
  it("is reusable: after any ending, the next press starts a fresh gesture", () => {
    const { drag, log } = setup();
    drag.down(100, 100); drag.up(100, 100);
    drag.down(100, 100); drag.move(300, 100); drag.up(300, 100);
    drag.down(100, 100); drag.cancel();
    drag.down(100, 100); drag.up(100, 100);
    expect(log.filter((l) => l === "tap:apple").length).toBe(2);
    expect(log.filter((l) => l === "feed:apple").length).toBe(1);
  });
  it("move and up with no press, or from an unknown pointer, are harmless", () => {
    const { drag, log } = setup();
    expect(drag.move(10, 10)).toBe(false);
    expect(drag.up(10, 10)).toBe(false);
    expect(() => drag.cancel()).not.toThrow();
    drag.down(100, 100, "touch-1");
    expect(drag.move(300, 100, "touch-9")).toBe(false);
    expect(log).toEqual([]);
  });
  it("a custom threshold changes where a tap becomes a carry", () => {
    const calls: string[] = [];
    const d = createFruitDrag<Fruit>({ pick: () => APPLE, overToy: () => false, tap: () => calls.push("tap"), pickUp: () => calls.push("pickUp"), carry: () => {}, hover: () => {}, feed: () => {}, drop: () => {} }, { thresholdPx: 30 });
    d.down(0, 0); d.move(25, 0); expect(d.state).toBe("pressed"); d.move(35, 0); expect(d.state).toBe("carrying");
    expect(calls).toEqual(["pickUp"]);
  });
});
