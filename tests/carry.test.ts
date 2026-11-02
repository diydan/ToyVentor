import { describe, expect, it } from "vitest";
import {
  applyDrop,
  applyTap,
  createCarryState,
  solveCarry,
  validateCarry,
  type CarryParams,
} from "../src/features/game/world/runtime/carry";
import { validateLevel2, type Level2Recipe } from "../src/features/game/world/runtime/level2";

// Pack the car (play-design conversion table): each thing fits exactly one place.
const packCar: CarryParams = {
  items: [
    { id: "suitcase", targetIds: ["trunk"] },
    { id: "teddy", targetIds: ["seat"] },
    { id: "ball", targetIds: ["roof", "trunk"] },
  ],
  targets: [
    { id: "trunk", x: 30 },
    { id: "seat", x: 34 },
    { id: "roof", x: 38 },
  ],
};

// Hungry cow blocker (play-design Q8 reading): the obstacle is food carried to the cow.
const cowRecipe: Level2Recipe = {
  format: "toyventor.level/2",
  id: "hungry-cow",
  band: "3-4",
  card: { goal: "Get past the hungry cow.", why: "Cows move for their favourite food.", finish: "Drag the right food to the cow." },
  concept: { domain: "biology", idea: "animals eat plants" },
  interaction: {
    primitive: "carry",
    params: {
      items: [
        { id: "grass", targetIds: ["cow"] },
        { id: "rock", targetIds: [] },
        { id: "shoe", targetIds: [] },
      ],
      targets: [{ id: "cow", x: 24 }],
    },
  },
  success: { when: "grass at cow" },
};

describe("level/2 carry primitive", () => {
  it("validates params and solves by carrying each item home", () => {
    expect(validateCarry(packCar)).toEqual([]);
    const sol = solveCarry(packCar);
    expect(sol).not.toBeNull();
    let state = createCarryState(packCar);
    for (const step of sol!) state = applyDrop(state, packCar, step.itemId, step.targetId).state;
    expect(state.done).toBe(true);
  });

  it("a wrong drop bounces home, counts a miss, and never finishes early", () => {
    const s0 = createCarryState(packCar);
    const { state, event } = applyDrop(s0, packCar, "suitcase", "seat");
    expect(event).toBe("wrong");
    expect(state.placed.suitcase).toBeUndefined();
    expect(state.misses).toBe(1);
    expect(state.done).toBe(false);
  });

  it("tap-then-tap does the same job as dragging (bands 0-1 path)", () => {
    let state = createCarryState(packCar);
    state = applyTap(state, packCar, { kind: "item", id: "teddy" }).state;
    expect(state.held).toBe("teddy");
    const dropped = applyTap(state, packCar, { kind: "target", id: "seat" });
    expect(dropped.event).toBe("progress");
    expect(dropped.state.placed.teddy).toBe("seat");
    expect(dropped.state.held).toBeNull();
  });

  it("reports unsolvable layouts instead of pretending", () => {
    const broken: CarryParams = {
      items: [
        { id: "a", targetIds: ["only"] },
        { id: "b", targetIds: ["only"] },
      ],
      targets: [{ id: "only", x: 10 }],
    };
    expect(solveCarry(broken)).toBeNull();
    expect(validateCarry({ items: [{ id: "x", targetIds: ["nope"] }], targets: [] }).length).toBeGreaterThan(0);
  });

  it("validates the hungry-cow blocker recipe (obstacle = a carry that clears)", () => {
    expect(validateLevel2(cowRecipe)).toEqual([]);
    expect(solveCarry(cowRecipe.interaction.params)).toEqual([{ itemId: "grass", targetId: "cow" }]);
    const bad = { ...cowRecipe, interaction: { primitive: "dance", params: cowRecipe.interaction.params } };
    expect(validateLevel2(bad as never).length).toBeGreaterThan(0);
  });
});
