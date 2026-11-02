import { describe, expect, it } from "vitest";
import { LADDERS } from "../src/lib/ladders";
import { applySolve, emptyProgression } from "../src/lib/progression";
import {
  applyWorldEvent,
  initialWorldState,
} from "../src/features/game/world/engine";
import { LEARN_RUNGS, learnRungDef } from "../src/features/game/world/runtime/learnRungs";

describe("learn rung content (carousel C2)", () => {
  it("every non-lab rung has panel content and every def maps to a rung", () => {
    const defIds = new Set(LEARN_RUNGS.map((d) => d.missionId));
    for (const ladder of LADDERS) {
      for (const rung of ladder.rungs) {
        if (rung.missionId.startsWith("lab")) {
          expect(defIds.has(rung.missionId), rung.missionId).toBe(false);
        } else {
          expect(learnRungDef(rung.missionId), rung.missionId).toBeDefined();
        }
      }
    }
    const rungIds = new Set(LADDERS.flatMap((l) => l.rungs.map((r) => r.missionId)));
    for (const def of LEARN_RUNGS) expect(rungIds.has(def.missionId), def.missionId).toBe(true);
    expect(LEARN_RUNGS).toHaveLength(21); // 38 rungs - 17 lab-mapped
  });

  it("steps are solvable: 2-3 steps, in-range answer, distinct choices", () => {
    for (const def of LEARN_RUNGS) {
      expect(def.steps.length, def.missionId).toBeGreaterThanOrEqual(2);
      expect(def.steps.length, def.missionId).toBeLessThanOrEqual(3);
      for (const step of def.steps) {
        expect(step.choices).toHaveLength(3);
        expect(new Set(step.choices).size).toBe(3);
        expect(step.answer).toBeGreaterThanOrEqual(0);
        expect(step.answer).toBeLessThan(3);
        expect(step.say.length).toBeGreaterThan(5);
        expect(step.hint.length).toBeGreaterThan(5);
      }
    }
  });

  it("panel rungs score through the stock applySolve (Tier 1, no part-match)", () => {
    const result = applySolve(emptyProgression(), {
      missionId: "little.pop",
      tier: 1,
      attempts: 1,
      clean: true,
      partMatch: false,
      day: "2026-11-02",
    });
    expect(result.stars).toBe(3);
    expect(result.awarded).toBe(150); // 100 * (1 + 0.5 accuracy)
    expect(result.next.missionStars["little.pop:t1"]).toBe(3);
  });
});

describe("engine learn events (carousel C2 facade)", () => {
  it("learn snapshot lands in world state; finished leaves state untouched", () => {
    const run = { track: "little", rungIndex: 0, step: 1, total: 6, kidMode: true };
    let state = applyWorldEvent(initialWorldState, { type: "learn", learn: run });
    expect(state.learn).toEqual(run);
    state = applyWorldEvent(state, { type: "learn", learn: { ...run, step: 2 } });
    expect(state.learn?.step).toBe(2);
    const afterFinish = applyWorldEvent(state, { type: "learnFinished" });
    expect(afterFinish).toBe(state);
    state = applyWorldEvent(state, { type: "learn", learn: null });
    expect(state.learn).toBeNull();
  });

  it("runtime wires startLearnRun, learnId scoring, and the win advance", async () => {
    const fs = await import("node:fs/promises");
    const world = await fs.readFile(
      new URL("../src/features/game/world/runtime/world.ts", import.meta.url),
      "utf8",
    );
    const missions = await fs.readFile(
      new URL("../src/features/game/world/runtime/missions.ts", import.meta.url),
      "utf8",
    );
    expect(world).toContain("function startLearnRunFn");
    expect(world).toContain("function openLearnRung()");
    expect(world).toContain("onWin:onLearnWin");
    expect(world).toContain('m.type==="learn"');
    expect(world).toContain("ds.pick!==undefined");
    expect(missions).toContain("m.learnId?String(m.learnId)");
    expect(missions).toContain("deps.onWin(k)");
  });
});
