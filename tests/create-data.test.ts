// Focused tests for the native create bridge (5A Unit 1 slice R).
// createData mirrors the legacy #cr cards template; expectations below are
// transcribed from that template, so drift fails here first.
import { describe, expect, it } from "vitest";
import { createData } from "../src/features/game/world/runtime/createData";

describe("create snapshot builder mirrors the legacy cards", () => {
  it("assembles place, hidden parts, scenery, and the tip", () => {
    const data = createData({
      busy: false,
      say: "I added 2 trees.",
      inputValue: "",
      chips: ["snow", "cave"],
      themeName: "Garden",
      spots: [
        { name: "Flower", hide: "scarecrow", x: 10 },
        { name: "Gear Crown", hide: "cave", x: 6 },
      ],
      scenery: ["2 trees", "1 lantern"],
      tip: false,
      canUndo: true,
      codeVisible: false,
      micAvailable: true,
      recipe: { format: "toyventor.level/1" },
    });
    expect(data.open).toBe(true);
    expect(data.cards).toEqual([
      { title: "Place", text: "Garden" },
      { title: "Hidden part 1", text: "Gear Crown in the cave at step 6" },
      { title: "Hidden part 2", text: "Flower in the scarecrow at step 10" },
      { title: "Scenery", text: "2 trees, 1 lantern" },
    ]);
    expect(data.chips).toEqual(["snow", "cave"]);
    expect(data.canUndo).toBe(true);
    expect(data.micAvailable).toBe(true);
  });

  it("shows the tip when no parts are hidden and stays quiet when shut", () => {
    const data = createData({
      busy: true,
      say: "Building your world…",
      inputValue: "snow",
      chips: [],
      themeName: "Snow Peak",
      spots: [],
      scenery: [],
      tip: true,
      canUndo: false,
      codeVisible: true,
      micAvailable: false,
      recipe: null,
    });
    expect(data.cards.at(-1)).toEqual({
      title: "Tip",
      text: "Ask for a cave, a tower, or a junk machine to hide parts in.",
    });
    expect(data.busy).toBe(true);
    expect(data.inputValue).toBe("snow");
  });

  it("emits no cards without a recipe", () => {
    const data = createData({
      busy: false, say: "", inputValue: "", chips: [],
      themeName: null, spots: [], scenery: [], tip: false,
      canUndo: false, codeVisible: false, micAvailable: false, recipe: null,
    });
    expect(data.cards).toEqual([]);
  });
});

describe("create bridge shape", () => {
  it("runtime exposes live snapshot data and native actions", async () => {
    const fs = await import("node:fs/promises");
    const text = await fs.readFile(
      new URL("../src/features/game/world/runtime/world.ts", import.meta.url),
      "utf8",
    );
    for (const token of [
      "function crSnap()",
      "function crSubmit(text: string)",
      "function crSetInput(t: string)",
      "function crUndo()",
      "function crKeep()",
      "function crCodeToggle()",
      "function crMicStart()",
      "function crFromTitle()",
      "crSnap:function()",
      "crSubmit:function(t)",
    ]) {
      expect(text).toContain(token);
    }
  });

  it("engine drives create natively without #cr selectors", async () => {
    const fs = await import("node:fs/promises");
    const text = await fs.readFile(
      new URL("../src/features/game/world/engine.ts", import.meta.url),
      "utf8",
    );
    expect(text).toContain("hooks()?.crSnap?.()");
    expect(text).toContain("hooks()?.crSubmit?.(text)");
    expect(text).toContain("api?.crUndo?.()");
    for (const selector of [
      "#cr-in", "#cr-make", "#cr-mic", "#cr-say", "#cr-cards",
      "#cr-undo", "#cr-keep", "#cr-play", "#cr-code", "#cr-chips", "#tcreate",
    ]) {
      expect(text).not.toContain(selector);
    }
  });
});
