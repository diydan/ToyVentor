// Focused tests for the native customizer bridge (5A Unit 1 slice C).
// customizerData mirrors the legacy #sheet templates; expectations below
// are transcribed from those templates, so drift fails here first.
import { describe, expect, it } from "vitest";
import { customizerData } from "../src/features/game/world/runtime/customizerData";

const types = [
  { id: "character", label: "Character", selected: true },
  { id: "vehicle", label: "Vehicle", selected: false },
];

describe("customizer snapshot builder mirrors the legacy sheet", () => {
  it("assembles types, slots, options, zones, paints, and moves", () => {
    const data = customizerData({
      forge: false,
      toyType: "character",
      scrap: 7,
      types,
      slots: [{ id: "head", label: "Head", selected: true }],
      options: [
        { optId: "box", name: "Box", detail: "Snap · none", statColor: "#888", locked: false, lockLabel: "", selected: true },
        { optId: "cams", name: "Cams", detail: "Spy · Look", statColor: "#52b7ff", locked: true, lockLabel: "Find in Sky Meadow", selected: false },
      ],
      skinZone: true,
      zone: "c1",
      paints: ["#ff0000", "#00ff00"],
      paintSelected: "#00ff00",
      movesText: "Moves: Dash, Shove",
      forgeRows: null,
    });
    expect(data.open).toBe(true);
    expect(data.toyType).toBe("character");
    expect(data.slots).toEqual([{ id: "head", label: "Head", selected: true }]);
    expect(data.options[1]).toMatchObject({
      id: "cams", label: "Cams", detail: "Spy · Look",
      locked: true, lockLabel: "Find in Sky Meadow", selected: false,
    });
    expect(data.paintZones.map((z) => z.id)).toEqual(["c1", "c2", "skin"]);
    expect(data.paints).toEqual([
      { color: "#ff0000", selected: false },
      { color: "#00ff00", selected: true },
    ]);
    expect(data.moves).toBe("Moves: Dash, Shove");
    expect(data.checkText).toBe("Ready to 3D print");
    expect(data.checkOk).toBe(true);
    expect(data.forgeItems).toEqual([]);
  });

  it("omits the skin zone when the toy cannot wear it", () => {
    const data = customizerData({
      forge: false, toyType: "vehicle", scrap: 0, types, slots: [],
      options: [], skinZone: false, zone: "c1", paints: [],
      paintSelected: "", movesText: "Moves: none", forgeRows: null,
    });
    expect(data.paintZones.map((z) => z.id)).toEqual(["c1", "c2"]);
  });

  it("builds forge rows with blueprint gating and owned counts", () => {
    const data = customizerData({
      forge: true, toyType: "character", scrap: 3, types, slots: [],
      options: [], skinZone: false, zone: "c1", paints: [],
      paintSelected: "", movesText: "", forgeRows: [
        { key: "beam", name: "Beam", desc: "A straight Pro beam.", cost: 2, hasBlueprint: true, owned: 1, canForge: true, onPrintList: false },
        { key: "bgear", name: "Big gear", desc: "Slow but strong.", cost: 3, hasBlueprint: true, owned: 0, canForge: true, onPrintList: true },
        { key: "brace", name: "Triangle brace", desc: "Stops sagging.", cost: 2, hasBlueprint: false, owned: 0, canForge: false, onPrintList: false },
      ],
    });
    expect(data.forge).toBe(true);
    expect(data.forgeItems[0]).toMatchObject({
      id: "beam", label: "Beam", owned: 1, locked: false,
      canForge: true, forgeLabel: "Forge (2 scrap)",
      printLabel: "Print it for real", onPrintList: false,
    });
    expect(data.forgeItems[1]).toMatchObject({ owned: 0, printLabel: "On print list", onPrintList: true });
    expect(data.forgeItems[2]).toMatchObject({
      id: null, label: "Blueprint not found yet",
      description: "Solve missions to find more blueprints.",
      owned: null, locked: true, canForge: false,
      forgeLabel: "", printLabel: "", onPrintList: false,
    });
  });
});

describe("customizer bridge shape", () => {
  it("runtime exposes live snapshot data and native actions", async () => {
    const fs = await import("node:fs/promises");
    const text = await fs.readFile(
      new URL("../src/features/game/world/runtime/world.ts", import.meta.url),
      "utf8",
    );
    for (const token of [
      "function cuSnap()",
      "function cuAct(a: string)",
      "function cuType(t: string)",
      "function cuPart(id: string)",
      "function cuForgeTool(id: string)",
      "function cuPrintTool(id: string)",
      "cuSnap:function()",
      "cuAct:function(a)",
    ]) {
      expect(text).toContain(token);
    }
  });

  it("engine drives the sheet natively without #sheet selectors", async () => {
    const fs = await import("node:fs/promises");
    const text = await fs.readFile(
      new URL("../src/features/game/world/engine.ts", import.meta.url),
      "utf8",
    );
    expect(text).toContain("hooks()?.cuSnap?.()");
    expect(text).toContain("hooks()?.cuPart?.(partId)");
    expect(text).toContain("hooks()?.cuAct?.(action)");
    for (const selector of [
      "#sheet", "#types button", "#slots button", "#opts button",
      "#seg button", "#sw button", "#forge button", "#forgeb",
    ]) {
      expect(text).not.toContain(selector);
    }
  });
});
