import { describe, expect, it, vi } from "vitest";
import type { ToyContract } from "../shared/toycontract";
import {
  applyWorldEvent,
  createWorldStore,
  diffFoundKeys,
  initialWorldState,
  nextZoom,
  worldUrlFor,
  zoomClicks,
  ZOOM_LEVELS,
} from "../src/features/game/world/engine";

const contract: ToyContract = {
  format: "toyventor.toy/1",
  id: "playtest-1",
  name: "Playtest racer",
  type: "vehicle",
  parts: ["vehicle.rear.spoiler"],
  col: { c1: "#b91c1c", c2: "#52b7ff", skin: "#f2b98c" },
  stats: { speed: 2 },
};

describe("world engine facade helpers", () => {
  it("builds the world URL with and without a contract", () => {
    expect(worldUrlFor(null)).toBe("/world/ToyVentor-World.html");
    const withToy = worldUrlFor(contract);
    expect(withToy.startsWith("/world/ToyVentor-World.html#toy=")).toBe(true);
    expect(withToy).not.toContain("Playtest");
  });

  it("reports only newly found part keys", () => {
    const prev = new Set(["vehicle.rear.spoiler"]);
    const next = new Set(["vehicle.rear.spoiler", "vehicle.front.lightbar"]);
    expect(diffFoundKeys(prev, next)).toEqual(["vehicle.front.lightbar"]);
    expect(diffFoundKeys(next, next)).toEqual([]);
    expect(diffFoundKeys(next, prev)).toEqual([]);
  });

  it("cycles zoom the same way the engine button does", () => {
    expect(ZOOM_LEVELS).toEqual(["Close", "Mid", "Far"]);
    expect(nextZoom(0)).toBe(1);
    expect(nextZoom(2)).toBe(0);
    expect(zoomClicks(0, 2)).toBe(2);
    expect(zoomClicks(2, 0)).toBe(1);
    expect(zoomClicks(1, 1)).toBe(0);
  });

  it("folds engine events into HUD state", () => {
    let state = applyWorldEvent(initialWorldState, { type: "ready" });
    state = applyWorldEvent(state, { type: "world", world: "sky" });
    state = applyWorldEvent(state, { type: "found", keys: ["a.b.c"], total: 3 });
    state = applyWorldEvent(state, { type: "mission", title: "Bridge" });
    state = applyWorldEvent(state, { type: "toast", text: "You found it" });
    expect(state).toMatchObject({
      ready: true,
      world: "sky",
      foundTotal: 3,
      missionTitle: "Bridge",
      toast: "You found it",
    });
    state = applyWorldEvent(state, { type: "mission", title: null });
    expect(state.missionTitle).toBeNull();
  });

  it("notifies store subscribers only when state changes", () => {
    const store = createWorldStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.apply({ type: "ready" });
    store.apply({ type: "ready" });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.apply({ type: "world", world: "junk" });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
