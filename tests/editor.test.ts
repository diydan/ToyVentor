import { describe, expect, it } from "vitest";
import { createEditor } from "../src/features/game/world/runtime/editor";
import { SPOT_COUNT, checkLevel, composeLevel } from "../src/features/game/world/runtime/levelKit";
import { WORLDS } from "../src/features/game/world/runtime/catalog";
import { MUS } from "../src/features/game/world/runtime/audio";

// Tests that drive edApply/edEnter/edExit mutate the shared catalog WORLDS
// table (WORLDS.custom) and the shared audio MUS flag; both are restored so
// no other suite observes editor-test state.
function guardSharedState() {
  const hadCustom = Object.prototype.hasOwnProperty.call(WORLDS, "custom");
  const customBefore = (WORLDS as any).custom;
  const musOnBefore = (MUS as any).on;
  return () => {
    if (hadCustom) (WORLDS as any).custom = customBefore;
    else delete (WORLDS as any).custom;
    (MUS as any).on = musOnBefore;
  };
}

function el(): any {
  return {
    hidden: false, value: "", textContent: "", innerHTML: "",
    disabled: false, dataset: {}, offsetWidth: 0,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, getAttribute: () => null,
    addEventListener() {}, select() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: 700 }),
    style: {},
  };
}

function stubDeps() {
  const sceneEl = { removed: [] as any[], added: [] as any[] };
  const built: string[] = [];
  return {
    S: { world: "garden", ms: {}, mdone: {}, ma: {}, me: {}, found: {}, started: true },
    P: {
      pos: { x: 2, set() {} }, busy: false, mDrive: false, title: false,
      showcase: false, target: null, face: 0, tface: 0,
      root: { visible: true },
    },
    scene: {
      remove: (o: any) => { sceneEl.removed.push(o); },
      add: (o: any) => { sceneEl.added.push(o); },
    },
    camera: { fov: 60, aspect: 1, setViewOffset() {}, clearViewOffset() {} },
    canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: 700 }) },
    hostEl: { clientWidth: 390, clientHeight: 700, classList: { add() {}, remove() {}, toggle() {} } },
    cam: { x: 3 },
    $: () => el(),
    $$: () => [],
    toast: () => {},
    save: () => {},
    notify: () => {},
    flash: () => {},
    updHud: () => {},
    showIntro: () => {},
    built,
    buildWorld: (id: string) => { built.push(id); },
    crUI: () => {},
    rayAt: () => {},
    laneX: () => null,
    sceneEl,
  };
}

function withCanvasDocument() {
  const g: any = {
    font: "", textAlign: "", textBaseline: "", lineWidth: 0,
    strokeStyle: "", fillStyle: "",
    strokeText() {}, fillText() {},
    beginPath() {}, arc() {}, fill() {}, moveTo() {}, lineTo() {},
    closePath() {}, stroke() {},
    createRadialGradient: () => ({ addColorStop() {} }),
    fillRect() {},
  };
  (globalThis as any).document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => g }),
  };
}

describe("Unit 2e editor factory (deps-injected ED state)", () => {
  it("builds blank levels and validates the level format", () => {
    const EDX = createEditor(stubDeps() as any);
    const blank = EDX.edBlank("garden");
    expect(blank.format).toBe("toyventor.level/1");
    expect(EDX.edValid(blank)).toBe(true);
    expect(EDX.edValid(null)).toBeFalsy();
    expect(EDX.edValid({ format: "toyventor.level/1", theme: "nope", props: [], spots: [] })).toBe(false);
    const copy = EDX.edCopy("garden");
    expect(copy.id).toBe("garden-copy");
  });

  it("K3: editor Checks are checkLevel (one shared bar, SPOT_COUNT spots)", () => {
    const EDX = createEditor(stubDeps() as any);
    expect(SPOT_COUNT).toBe(5);
    for (const level of [composeLevel({ seed: 42 }), EDX.edBlank("garden"), EDX.edCopy("garden")]) {
      expect(EDX.edChecks(level)).toEqual(checkLevel(level));
    }
    const composed = EDX.edChecks(composeLevel({ seed: 42 }));
    expect(composed.every((c) => c.ok)).toBe(true);
    expect(composed[0]!.n).toBe("Five hidden parts");
  });

  it("edNew + edSetName keep a working recipe with undo history", () => {
    const restore = guardSharedState();
    const EDX = createEditor(stubDeps() as any);
    withCanvasDocument();
    try {
      EDX.edNew("blank:garden");
      expect(EDX.ED.R.theme).toBe("garden");
      expect(EDX.ED.undo.length).toBeGreaterThan(0);
      EDX.edSetName("  My Level  ");
      expect(EDX.ED.R.name).toBe("My Level");
      const before = EDX.ED.R.name;
      EDX.edUndo();
      expect(EDX.ED.R.name).not.toBe(before);
      EDX.edRedo();
      expect(EDX.ED.R.name).toBe(before);
    } finally {
      delete (globalThis as any).document;
      restore();
    }
  });

  it("edNudge snaps to 0.5 units numerically (edSnapX, not the snapshot)", () => {
    const restore = guardSharedState();
    const EDX = createEditor(stubDeps() as any);
    withCanvasDocument();
    try {
      EDX.edNew("blank:garden");
      EDX.ED.R.spots.push({ part: "character.hat.flower", hide: "scarecrow", x: 6 });
      EDX.ED.sel = { kind: "spot", i: 0 };
      EDX.edNudge(1);
      // Regression: Unit 1-E added a second function named edSnap (the
      // engine snapshot), which hoisted over the coord rounder — nudge then
      // stored {open:false,...} instead of a number. edSnapX keeps the names apart.
      expect(typeof EDX.ED.R.spots[0].x).toBe("number");
      expect(EDX.ED.R.spots[0].x).toBe(6.5);
      // And the snapshot keeps its engine-contract name/shape.
      expect(typeof EDX.edSnap).toBe("function");
    } finally {
      delete (globalThis as any).document;
      restore();
    }
  });

  it("edExport/edIoLoad round-trip a level through the io dialog state", () => {
    const restore = guardSharedState();
    const EDX = createEditor(stubDeps() as any);
    withCanvasDocument();
    try {
      EDX.edNew("blank:beach");
      EDX.ED.on = true; // io snapshot only renders while the editor is open
      EDX.edExport();
      const exported = JSON.parse(EDX.edSnap().io.text);
      expect(exported.theme).toBe("beach");
      EDX.edSetIoText(JSON.stringify({ ...exported, name: "Imported" }));
      EDX.edIoLoad();
      expect(EDX.ED.R.name).toBe("Imported");
      EDX.edSetIoText("not json{{{");
      EDX.edIoLoad(); // invalid payload keeps the current recipe
      expect(EDX.ED.R.name).toBe("Imported");
    } finally {
      delete (globalThis as any).document;
      restore();
    }
  });

  it("setBackLabel flows into the snapshot dialog label", () => {
    const restore = guardSharedState();
    const EDX = createEditor(stubDeps() as any);
    withCanvasDocument();
    try {
      EDX.edNew("blank:garden");
      EDX.setBackLabel("Back to making");
      // Snapshot when closed still carries the label for the shell.
      const snap = EDX.edSnap();
      expect(snap.backLabel).toBe("Back to making");
    } finally {
      delete (globalThis as any).document;
      restore();
    }
  });

  it("edEnter/edExit toggle editor mode around a stubbed world build", () => {
    const restore = guardSharedState();
    const deps = stubDeps() as any;
    const EDX = createEditor(deps);
    withCanvasDocument();
    try {
      (globalThis as any).localStorage = {
        getItem: () => null,
        setItem: () => {},
      };
      EDX.edEnter();
      expect(EDX.ED.on).toBe(true);
      expect(deps.built).toContain("custom");
      EDX.edExit();
      expect(EDX.ED.on).toBe(false);
      delete (globalThis as any).localStorage;
    } finally {
      delete (globalThis as any).document;
      restore();
    }
  });
});
