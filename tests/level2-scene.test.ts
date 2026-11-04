import { describe, expect, it } from "vitest";
import { LEVEL2_RECIPES } from "../src/features/game/world/runtime/level2Recipes";
import {
  arriveScene,
  arriveSceneVisit,
  itemMarkerX,
  recipeForRung,
  startSceneCarry,
  startSceneVisit,
  tapSceneItem,
  tapSceneSpot,
  tapSceneTarget,
  visitForRung,
} from "../src/features/game/world/runtime/level2Scene";

describe("scene carry sessions (carousel C3, §11)", () => {
  it("recipes exist for pack and tidy, and nothing else yet", () => {
    expect(recipeForRung("little.pack")?.id).toBe("little.pack");
    expect(recipeForRung("little.tidy")?.id).toBe("little.tidy");
    expect(recipeForRung("little.pop")).toBeUndefined();
    expect(recipeForRung("lab1.bridge")).toBeUndefined();
    expect(startSceneCarry("little.pack")?.state.done).toBe(false);
    expect(startSceneCarry("little.pop")).toBeNull();
  });

  it("item markers sit left of every recipe's targets", () => {
    const pack = startSceneCarry("little.pack")!;
    const tidy = startSceneCarry("little.tidy")!;
    for (const session of [pack, tidy]) {
      const firstTarget = Math.min(...session.params.targets.map((t) => t.x));
      session.params.items.forEach((item, i) => {
        const x = itemMarkerX(i);
        expect(x).toBeGreaterThanOrEqual(2); // clear of the lane edge
        expect(x).toBeLessThan(firstTarget); // left of the targets
      });
      const xs = session.params.items.map((_, i) => itemMarkerX(i));
      expect(new Set(xs).size).toBe(xs.length); // no two markers share a spot
    }
  });

  it("tap-then-tap plays Pack the car to done", () => {
    const session = startSceneCarry("little.pack")!;
    // Tap the suitcase: walk there.
    const go = tapSceneItem(session, "suitcase", 4);
    expect(go.action).toBe("goto");
    if (go.action !== "goto") throw new Error("unreachable");
    expect(go.x).toBe(4);
    expect(go.say.length).toBeGreaterThan(5); // toast twin of the prompt
    // Arrive: holding the suitcase.
    const picked = arriveScene(session);
    expect(picked?.event).toBe("picked");
    // Tapping it again puts it down.
    expect(tapSceneItem(session, "suitcase", 4).action).toBe("hint");
    expect(session.state.held).toBeNull(); // really down, not still held
    // Tap the trunk without holding: a hint, not a walk.
    const hint = tapSceneTarget(session, "trunk", 30);
    expect(hint).toEqual({ action: "hint", say: expect.stringContaining("first") });
    // Pick up again, carry to the trunk.
    tapSceneItem(session, "suitcase", 4);
    arriveScene(session);
    tapSceneTarget(session, "trunk", 30);
    const placed = arriveScene(session);
    expect(placed?.event).toBe("placed");
    // Wrong drop: ball to the seat bounces home with a miss and a hint.
    tapSceneItem(session, "ball", 10);
    arriveScene(session);
    const missesBefore = session.state.misses;
    tapSceneTarget(session, "seat", 34);
    const wrong = arriveScene(session);
    expect(wrong?.event).toBe("wrong");
    expect(session.state.misses).toBe(missesBefore + 1);
    if (wrong?.event !== "wrong") throw new Error("unreachable");
    expect(wrong.hint.length).toBeGreaterThan(5);
    expect(session.state.held).toBeNull(); // bounced home
  });

  it("a placed item cannot be picked up again", () => {
    const session = startSceneCarry("little.tidy")!;
    tapSceneItem(session, "book", 4);
    arriveScene(session);
    tapSceneTarget(session, "bookshelf", 14);
    expect(arriveScene(session)?.event).toBe("placed");
    expect(tapSceneItem(session, "book", 4).action).toBe("hint");
  });

  it("finishing the last item reports done", () => {
    const session = startSceneCarry("little.tidy")!;
    let last: ReturnType<typeof arriveScene> = null;
    for (const [item, x, target, tx] of [
      ["book", 4, "bookshelf", 14],
      ["sock", 7, "laundry", 22],
    ] as const) {
      tapSceneItem(session, item, x);
      arriveScene(session);
      tapSceneTarget(session, target, tx);
      last = arriveScene(session);
    }
    expect(last?.event).toBe("done");
    expect(session.state.done).toBe(true);
  });

  it("arrival with nothing pending is a no-op", () => {
    const session = startSceneCarry("little.pack")!;
    expect(arriveScene(session)).toBeNull();
  });
});

describe("scene visit sessions (carousel C3, §11.3)", () => {
  it("visit recipes exist for the four non-carry rungs", () => {
    for (const id of ["little.pop", "little.animals", "little.peek", "little.gogo"]) {
      expect(visitForRung(id)?.missionId).toBe(id);
      expect(startSceneVisit(id)?.at).toBe(0);
    }
    expect(startSceneVisit("little.pack")).toBeNull();
    expect(startSceneVisit("lab1.bridge")).toBeNull();
  });

  it("spots are ordered, spread out, and say their prompt twin", () => {
    for (const id of ["little.pop", "little.animals", "little.peek", "little.gogo"]) {
      const recipe = visitForRung(id)!;
      expect(recipe.spots.length).toBeGreaterThan(1);
      const xs = recipe.spots.map((s) => s.x);
      expect(new Set(xs).size).toBe(xs.length);
      for (const s of recipe.spots) {
        expect(s.tap.length).toBeGreaterThan(5);
        expect(s.arrive.length).toBeGreaterThan(5);
        expect(s.hint.length).toBeGreaterThan(5);
      }
      expect(recipe.oops.toLowerCase()).not.toContain("wrong");
    }
  });

  it("tap-then-tap plays Pop the bubbles to done", () => {
    const session = startSceneVisit("little.pop")!;
    const go = tapSceneSpot(session, "big", 6);
    expect(go.action).toBe("goto");
    if (go.action !== "goto") throw new Error("unreachable");
    expect(go.x).toBe(6);
    const first = arriveSceneVisit(session);
    expect(first?.event).toBe("advanced");
    // Finished spots hint instead of walking.
    expect(tapSceneSpot(session, "big", 6).action).toBe("hint");
    tapSceneSpot(session, "tiny", 10);
    const last = arriveSceneVisit(session);
    expect(last?.event).toBe("done");
    expect(session.done).toBe(true);
    expect(arriveSceneVisit(session)).toBeNull();
  });

  it("out-of-order arrivals miss with the expected hint", () => {
    const session = startSceneVisit("little.pop")!;
    tapSceneSpot(session, "tiny", 10);
    const bad = arriveSceneVisit(session);
    expect(bad?.event).toBe("wrong");
    if (bad?.event !== "wrong") throw new Error("unreachable");
    expect(bad.say.length).toBeGreaterThan(3);
    expect(bad.hint).toContain("biggest");
    expect(session.at).toBe(0); // no progress on a miss
    // The expected spot still resolves after the miss.
    tapSceneSpot(session, "big", 6);
    expect(arriveSceneVisit(session)?.event).toBe("advanced");
  });
});

describe("kid copy (carousel standing rule)", () => {
  it("no recipe text a child can see says the word \"wrong\"; it says what does not fit", () => {
    for (const r of LEVEL2_RECIPES) {
      expect(JSON.stringify(r), r.id).not.toMatch(/\bwrong\b/i);
    }
  });
});
