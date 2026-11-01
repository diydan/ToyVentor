// Focused tests for the native mission bridge (5A Unit 1 slice M).
// The builders in runtime/missionData.ts mirror the legacy #mp templates;
// each expectation below is transcribed from the template it mirrors, so a
// drift between builder output and rendered DOM fails here first.
import { describe, expect, it } from "vitest";
import {
  balanceData,
  circuitData,
  classicData,
  cleanData,
  codeData,
  leverData,
  logicData,
  measureData,
  patternData,
  raftData,
  replayData,
  soapWindow,
} from "../src/features/game/world/runtime/missionData";

const chrome = {
  title: "T",
  goal: "G",
  actionLabel: "Test it",
  binText: "",
  forgeAvailable: false,
};

describe("mission panel data builders mirror the legacy templates", () => {
  it("classic slots group Take out / Take with bin counts", () => {
    const data = classicData(
      { ...chrome, binText: "Scrap 0", forgeAvailable: true },
      [
        { id: "deck", name: "Deck", accept: ["beam"] },
        { id: "support", name: "Support", accept: ["brace"] },
      ],
      { deck: "beam" },
      { beam: 1, brace: 0 },
      false,
      (id) => ({ beam: "Beam", brace: "Triangle brace" })[id]!,
    );
    expect(data.ctrls).toEqual([
      expect.objectContaining({ label: "Take out", dataset: { out: "deck" }, group: "Deck · Beam", primary: false, disabled: false }),
      expect.objectContaining({ label: "Triangle brace (0)", dataset: { use: "support:brace" }, group: "Support · empty", primary: false, disabled: true }),
    ]);
    expect(data.forgeAvailable).toBe(true);
  });

  it("measure sums the list against the gap", () => {
    const data = measureData(chrome, [2, 3], 8);
    expect(data.lines).toEqual(["2 + 3 = 5 of 8"]);
    expect(data.ctrls.map((c) => c.label)).toEqual(["Add 2", "Add 3", "Add 4", "Take one off"]);
    expect(measureData(chrome, [4, 4], 8).lines).toEqual(["4 + 4 = 8 of 8  Just right!"]);
  });

  it("balance reports both sides and the level state", () => {
    const data = balanceData(chrome, 1, 1, 4, 4);
    expect(data.lines).toEqual([
      "Left: 2 blocks far out = 4",
      "Right: 1 near + 1 far x 2 = 4  Level!",
    ]);
    expect(data.ctrls).toHaveLength(4);
    expect(data.ctrls[0]).toMatchObject({ label: "Add near", dataset: { b: "n1:1" }, primary: true });
  });

  it("logic shows door progress and hides plate B on NOT", () => {
    const or = logicData(chrome, 0, 3, "OR", "either plate opens it", false, true, false, true, false);
    expect(or.lines[0]).toBe("Door 1 of 3: OR gate, either plate opens it.");
    expect(or.lines[1]).toBe("Door is shut");
    expect(or.ctrls.map((c) => c.label)).toEqual(["Put crate on A", "Put crate on B"]);
    const not = logicData(chrome, 2, 3, "NOT", "the opposite", true, true, true, false, false);
    expect(not.ctrls).toHaveLength(1);
    expect(not.lines[1]).toBe("Door is open");
  });

  it("raft nets buoyancy against the tier need and locks when full", () => {
    const names = { log: "Log", barrel: "Barrel" };
    const open = raftData(chrome, 5, 4, 2, names, false);
    expect(open.lines[2]).toBe("It will sink (need +2)");
    expect(open.ctrls.at(-1)).toMatchObject({ label: "Take one off", dataset: { r: "off" } });
    const full = raftData(chrome, 9, 4, 0, names, true);
    expect(full.lines[2]).toBe("It will float");
    expect(full.ctrls[0]).toMatchObject({ primary: false, disabled: true });
  });

  it("lever reduces the ratio and numbers the baskets", () => {
    const data = leverData(chrome, 0, 3, 5);
    expect(data.lines).toEqual(["Basket 1 of 2", "Toy side 3 : star side 5 (3 : 5)"]);
  });

  it("circuit maps lit and locked cells", () => {
    const data = circuitData(chrome, "Power reaches 2 of 6 squares", [
      { key: "0,0", label: "─", lit: true, locked: true },
      { key: "1,0", label: "·", lit: false, locked: false },
    ]);
    expect(data.ctrls[0]).toMatchObject({ dataset: { c: "0,0" }, active: true, disabled: true });
    expect(data.ctrls[1]).toMatchObject({ active: false, disabled: false });
  });

  it("code marks empty slots by number and bad cards as danger", () => {
    const data = codeData(
      chrome,
      [
        { label: "Walk", filled: true, bad: false },
        { label: "", filled: false, bad: true },
      ],
      [{ id: "walk", label: "Walk" }],
      false,
    );
    expect(data.ctrls[0]).toMatchObject({ label: "Walk", dataset: { q: "0" }, disabled: false, danger: false });
    expect(data.ctrls[1]).toMatchObject({ label: "2", dataset: { q: "1" }, disabled: true, danger: true });
    expect(codeData(chrome, [], [], true).ctrls).toEqual([]);
  });

  it("pattern renders seq chips, ? placeholders, and bordered keys", () => {
    const data = patternData(
      chrome,
      0,
      3,
      [{ text: "●", background: "#ff5a4d" }],
      [{ text: "▲", background: "#52b7ff" }, null],
      [{ id: "red", label: "● red", border: "#ff5a4d" }],
    );
    expect(data.lines).toEqual(["Pattern 1 of 3"]);
    expect(data.chips).toEqual([
      { text: "●", question: false, background: "#ff5a4d" },
      { text: "▲", question: false, background: "#52b7ff" },
      { text: "?", question: true },
    ]);
    expect(data.ctrls[0]).toMatchObject({ label: "● red", dataset: { pb: "red" }, borderColor: "#ff5a4d" });
  });

  it("clean walks the three stages with tiered soap windows", () => {
    expect(soapWindow(1)).toEqual([2, 3]);
    expect(soapWindow(2)).toEqual([2, 2]);
    expect(soapWindow(3)).toEqual([3, 3]);
    const base = {
      stage: 0, tool: "vacuum", soap: 0, soapMixed: false,
      cleaned: {}, fixed: {}, holeReady: false, plates: [0, 0, 0],
      holdingName: null, tier: 1,
      toolNames: { vacuum: "Vacuum", mop: "Mop", sponge: "Soapy sponge" },
      messLabel: (id: string) => (id === "jam" ? "Sticky jam" : id),
    };
    const g0 = cleanData(chrome, base);
    expect(g0.lines).toEqual(["Step 1 of 3: clean up. Pick a tool, then tap a mess."]);
    expect(g0.ctrls[0]).toMatchObject({ label: "Vacuum", primary: true });
    const sponge = cleanData(chrome, { ...base, tool: "sponge", soap: 1 });
    expect(sponge.lines[1]).toContain("Soap drops: 1 (not enough)");
    expect(sponge.ctrls).toContainEqual(expect.objectContaining({ label: "Ready", dataset: { s: "ready" }, primary: false }));
    const g1 = cleanData(chrome, { ...base, stage: 1, holdingName: "Drill", fixed: { nail: true } });
    expect(g1.ctrls[0]).toMatchObject({ label: "nail fixed", disabled: true });
    const g2 = cleanData(chrome, { ...base, stage: 2, plates: [2, 2, 1] });
    expect(g2.lines[0]).toContain("Left: 1");
    expect(g2.ctrls).toHaveLength(6);
  });

  it("replay prompts carry no controls", () => {
    const data = replayData({ ...chrome, actionLabel: "Play again" });
    expect(data.ctrls).toEqual([]);
    expect(data.actionLabel).toBe("Play again");
  });
});

describe("mission bridge shape", () => {
  it("runtime exposes stamped snapshot data and native actions", async () => {
    const fs = await import("node:fs/promises");
    const text = await fs.readFile(
      new URL("../src/features/game/world/runtime/world.ts", import.meta.url),
      "utf8",
    );
    for (const token of ["mpStamp=mpData(m)", "function mpSnap()", "function mpPress(m: Mission,ds: any)", "function mpGo(m: Mission | null)", "mpSnap:function()", "mpPress:function(i)", "mpAct:function(a)"]) {
      expect(text).toContain(token);
    }
  });

  it("engine reads missions natively without #mp selectors", async () => {
    const fs = await import("node:fs/promises");
    const text = await fs.readFile(
      new URL("../src/features/game/world/engine.ts", import.meta.url),
      "utf8",
    );
    expect(text).toContain("hooks()?.mpSnap?.()");
    expect(text).toContain("hooks()?.mpPress?.(index)");
    expect(text).toContain("hooks()?.mpAct?.(action)");
    expect(text).not.toContain("#mp-go");
    expect(text).not.toContain("#mp-slots");
    expect(text).not.toContain("#mp-forge");
  });
});
