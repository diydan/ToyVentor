import { describe, expect, it, vi } from "vitest";
import type { ToyContract } from "../shared/toycontract";
import {
  applyWorldEvent,
  chipWord,
  closedCreateSnapshot,
  closedCustomizerSnapshot,
  closedEditorSnapshot,
  closedMissionPanelSnapshot,
  createWorldStore,
  diffFoundKeys,
  initialWorldState,
  nextZoom,
  normalizeCreateSnapshot,
  normalizeCustomizerSnapshot,
  normalizeEditorSnapshot,
  normalizeMissionPanelSnapshot,
  normalizeRecipe,
  sameCreateSnapshot,
  sameCustomizerSnapshot,
  sameEditorSnapshot,
  sameMissionPanelSnapshot,
  worldUrlFor,
  zoomClicks,
  ZOOM_LEVELS,
  type CustomizerSnapshot,
  type MissionPanelSnapshot,
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
    state = applyWorldEvent(state, {
      type: "missionsDone",
      keys: ["lab1.measure"],
      total: 1,
    });
    state = applyWorldEvent(state, { type: "mission", title: "Bridge" });
    state = applyWorldEvent(state, { type: "toast", text: "You found it" });
    expect(state).toMatchObject({
      ready: true,
      world: "sky",
      foundTotal: 3,
      missionsDoneTotal: 1,
      missionTitle: "Bridge",
      toast: "You found it",
    });
    state = applyWorldEvent(state, { type: "mission", title: null });
    expect(state.missionTitle).toBeNull();
  });

  it("normalizes a legacy customizer snapshot into React state", () => {
    const snapshot = normalizeCustomizerSnapshot({
      open: true,
      types: [
        { id: "character", label: "Character", selected: false },
        { id: "vehicle", label: "Vehicle", selected: true },
      ],
      slots: [
        { id: "chassis", label: "Chassis", selected: false },
        { id: "rear", label: "Rear", selected: true },
      ],
      options: [
        {
          id: "spoiler",
          label: "Spoiler",
          detail: "Snap · Speed",
          selected: true,
          locked: false,
          lockLabel: "",
        },
        {
          id: "booster",
          label: "Booster",
          detail: "Snap · Speed",
          selected: false,
          locked: true,
          lockLabel: "Find in the Beach",
        },
      ],
      paintZones: [
        { id: "c1", label: "Main", selected: false },
        { id: "c2", label: "Accent", selected: true },
      ],
      paints: [{ color: "#52b7ff", selected: true }],
      moves: "Moves: Dash",
      checkText: "Ready to 3D print",
      checkOk: true,
      scrap: 4,
    });

    expect(snapshot).toMatchObject({
      open: true,
      toyType: "vehicle",
      slot: "rear",
      paintZone: "c2",
      moves: "Moves: Dash",
      checkOk: true,
      scrap: 4,
    });
    expect(snapshot.options[1]).toMatchObject({ locked: true, lockLabel: "Find in the Beach" });
    expect(normalizeCustomizerSnapshot({ open: false, scrap: 9 })).toEqual({
      ...closedCustomizerSnapshot,
      scrap: 9,
    });
  });

  it("does not rerender HUD state for an identical customizer snapshot", () => {
    const customizer: CustomizerSnapshot = normalizeCustomizerSnapshot({
      open: true,
      types: [{ id: "robot", label: "Robot", selected: true }],
      slots: [{ id: "head", label: "Head", selected: true }],
    });
    const state = applyWorldEvent(initialWorldState, { type: "customizer", customizer });
    const again = applyWorldEvent(state, {
      type: "customizer",
      customizer: structuredClone(customizer),
    });
    expect(sameCustomizerSnapshot(customizer, structuredClone(customizer))).toBe(true);
    expect(again).toBe(state);
    expect(applyWorldEvent(state, { type: "customizer", customizer: closedCustomizerSnapshot }))
      .not.toBe(state);
  });

  it("normalizes every legacy mission panel into shared panel data", () => {
    const panel = normalizeMissionPanelSnapshot({
      open: true,
      title: " Bridge the river ",
      goal: " Put parts in the slots. ",
      lines: [" Deck empty ", "", "Support: Triangle brace"],
      chips: [{ text: "?", question: true }],
      controls: [
        {
          index: 99,
          label: "Beam (1)",
          disabled: false,
          primary: true,
          active: false,
          danger: false,
          dataset: { use: "deck:beam" },
          group: "Deck empty",
        },
        {
          index: 42,
          label: "Take out",
          disabled: false,
          primary: false,
          active: false,
          danger: false,
          dataset: { out: "support" },
          group: "Support Triangle brace",
        },
      ],
      actionLabel: " Test it ",
      forgeAvailable: true,
      binText: "Scrap 3",
    });

    expect(panel).toMatchObject({
      open: true,
      title: "Bridge the river",
      goal: "Put parts in the slots.",
      lines: ["Deck empty", "Support: Triangle brace"],
      actionLabel: "Test it",
      forgeAvailable: true,
      binText: "Scrap 3",
    });
    expect(panel.controls.map((control) => control.index)).toEqual([0, 1]);
    expect(panel.controls[0]?.dataset).toEqual({ use: "deck:beam" });
    expect(normalizeMissionPanelSnapshot({ open: false, title: "Stale" })).toEqual(
      closedMissionPanelSnapshot,
    );
  });

  it("folds mission panel snapshots into state without duplicate renders", () => {
    const panel: MissionPanelSnapshot = normalizeMissionPanelSnapshot({
      open: true,
      title: "Measure the gap",
      goal: "Make exactly 6.",
      lines: ["2 + 3 = 5 of 6"],
      controls: [
        {
          index: 0,
          label: "Add 2",
          disabled: false,
          primary: true,
          active: false,
          danger: false,
          dataset: { a: "2" },
        },
      ],
    });
    const state = applyWorldEvent(initialWorldState, { type: "missionPanel", panel });
    const again = applyWorldEvent(state, {
      type: "missionPanel",
      panel: structuredClone(panel),
    });
    expect(state.missionTitle).toBe("Measure the gap");
    expect(state.missionPanel).toEqual(panel);
    expect(sameMissionPanelSnapshot(panel, structuredClone(panel))).toBe(true);
    expect(again).toBe(state);
    const closed = applyWorldEvent(state, {
      type: "missionPanel",
      panel: closedMissionPanelSnapshot,
    });
    expect(closed.missionTitle).toBeNull();
  });

  it("normalizes Create mode into React panel data", () => {
    const create = normalizeCreateSnapshot({
      open: true,
      busy: false,
      say: " I made you a garden. ",
      inputValue: " three snowmen ",
      chips: ["❄️ snow", "⛄ snowmen"],
      cards: [
        { title: "Place", text: "Snow Peak" },
        { title: "", text: "" },
      ],
      canUndo: true,
      codeVisible: true,
      recipe: {
        format: "toyventor.level/1",
        id: "kid-world",
        name: "Snow Day",
        theme: "snow",
        props: [{ type: "snowman", x: 8 }],
        spots: [{ part: "character.hat.flower", hide: "snowcannon", x: 6 }],
      },
    });
    expect(create).toMatchObject({
      open: true,
      say: "I made you a garden.",
      inputValue: "three snowmen",
      cards: [{ title: "Place", text: "Snow Peak" }],
      canUndo: true,
      codeVisible: true,
    });
    expect(create.recipe?.props).toHaveLength(1);
    expect(chipWord("❄️ snow")).toBe("snow");
    expect(chipWord("🕳️ a cave to hide a part")).toBe("a cave to hide a part");

    const state = applyWorldEvent(initialWorldState, { type: "create", create });
    expect(state.create).toEqual(create);
    expect(sameCreateSnapshot(create, structuredClone(create))).toBe(true);
    expect(normalizeCreateSnapshot({ open: false, say: "stale" })).toEqual(
      closedCreateSnapshot,
    );
  });

  it("normalizes the level editor and preserves testing state", () => {
    const editor = normalizeEditorSnapshot({
      open: true,
      name: " My level ",
      theme: "sky",
      tabs: [
        { id: "spots", label: "Hiding spots", selected: false },
        { id: "checks", label: "Checks 4/6", selected: true },
      ],
      canUndo: true,
      lines: [" Tap a pin to edit it. "],
      palette: [
        {
          index: 8,
          label: "Junk machine",
          detail: "Unscrew",
          selected: true,
          color: "#f4f7ff",
        },
      ],
      checks: [{ title: "Five hidden parts", detail: "3 placed", ok: false }],
      io: {
        open: true,
        title: "Export this level",
        text: "{}",
        readOnly: true,
        canCopy: true,
        canLoad: false,
      },
      recipe: {
        format: "toyventor.level/1",
        id: "my-level",
        name: "My level",
        theme: "sky",
        props: [],
        spots: [],
      },
    });
    expect(editor).toMatchObject({
      open: true,
      name: "My level",
      theme: "sky",
      tab: "checks",
      canUndo: true,
    });
    expect(editor.palette[0]?.index).toBe(0);
    expect(editor.checks[0]?.ok).toBe(false);

    const testing = normalizeEditorSnapshot({
      open: false,
      testing: true,
      mode: "create",
      backLabel: "Back to making",
    });
    expect(testing).toEqual({
      ...closedEditorSnapshot,
      testing: true,
      mode: "create",
      backLabel: "Back to making",
    });
    const state = applyWorldEvent(initialWorldState, { type: "editor", editor });
    expect(sameEditorSnapshot(editor, structuredClone(editor))).toBe(true);
    expect(applyWorldEvent(state, { type: "editor", editor: structuredClone(editor) })).toBe(
      state,
    );
    expect(normalizeRecipe({ format: "nope", props: [] })).toBeNull();
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
