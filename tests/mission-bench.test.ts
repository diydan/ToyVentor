// The mission bench and the slim mission rail (Dan, 2026-11-04: the half-screen mission card hid the machine being built).
// Pure logic and the stylesheet text only (this suite has no DOM): the pads themselves were checked in the real game.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classicData } from "../src/features/game/world/runtime/missionData";
import { benchSpecFromControls } from "../src/features/game/world/runtime/missionBench";
import { MDEF, TOOLS } from "../src/features/game/world/runtime/catalog";
import { closedMissionPanelSnapshot, normalizeMissionPanelSnapshot } from "../src/features/game/world/engine";

const chrome = { title: "Gear lift", goal: "G", actionLabel: "Turn crank", binText: "", forgeAvailable: true };
const slots = MDEF.lift!.slots.map((s) => ({ id: s.id, name: s.n, accept: s.acc }));
const name = (k: string) => TOOLS[k]!.n;

describe("the bench reads its slots from the mission's own control list", () => {
  it("an empty gear lift is two empty slots with both gears as choices, out of stock ones disabled", () => {
    const d = classicData(chrome, slots, {}, { sgear: 2, bgear: 0 }, false, name);
    const spec = benchSpecFromControls(d.ctrls, "Turn crank", true);
    expect(spec.slots.map((s) => [s.id, s.name, s.filled])).toEqual([["mid", "Middle gear", null], ["drum", "Drum gear", null]]);
    expect(spec.slots[0]!.choices).toEqual([
      { key: "sgear", label: "Small gear (2)", disabled: false },
      { key: "bgear", label: "Big gear (0)", disabled: true },
    ]);
    expect(spec.goLabel).toBe("Turn crank");
    expect(spec.forgeAvailable).toBe(true);
  });

  it("a full slot says what is in it and has no choices (the pad takes it out)", () => {
    const d = classicData(chrome, slots, { drum: "bgear" }, { sgear: 1, bgear: 1 }, false, name);
    const spec = benchSpecFromControls(d.ctrls, "Turn crank", false);
    const drum = spec.slots.find((s) => s.id === "drum")!;
    expect(drum.filled).toBe("Big gear");
    expect(drum.choices).toEqual([]);
    expect(spec.slots.find((s) => s.id === "mid")!.filled).toBeNull();
  });

  it("a free (practice) mission offers every part, with no counts in the labels", () => {
    const d = classicData(chrome, slots, {}, {}, true, name);
    const spec = benchSpecFromControls(d.ctrls, "Turn crank", false);
    expect(spec.slots[1]!.choices.map((c) => [c.label, c.disabled])).toEqual([["Small gear", false], ["Big gear", false]]);
  });

  it("the bridge is a deck slot and a support slot", () => {
    const bs = MDEF.bridge!.slots.map((s) => ({ id: s.id, name: s.n, accept: s.acc }));
    const d = classicData({ ...chrome, actionLabel: "Test it" }, bs, {}, { beam: 1, brace: 1 }, false, name);
    const spec = benchSpecFromControls(d.ctrls, "Test it", true);
    expect(spec.slots.map((s) => s.id)).toEqual(["deck", "support"]);
    expect(spec.slots[0]!.choices.map((c) => c.key)).toEqual(["beam"]);
    expect(spec.slots[1]!.choices.map((c) => c.key)).toEqual(["brace"]);
  });
});

describe("walking up to a mission shows a chip, not the card", () => {
  it("a closed card can carry a hint, and its title is cleaned", () => {
    const s = normalizeMissionPanelSnapshot({ open: false, hint: { title: "  Lever   launch ", done: false } });
    expect(s.open).toBe(false);
    expect(s.hint).toEqual({ title: "Lever launch", done: false });
    expect(normalizeMissionPanelSnapshot({ open: false, hint: { title: "Bridge", done: true } }).hint).toEqual({ title: "Bridge", done: true });
  });
  it("no hint, an empty one, or an open card has none", () => {
    expect(normalizeMissionPanelSnapshot({ open: false }).hint).toBeNull();
    expect(normalizeMissionPanelSnapshot({ open: false, hint: { title: " " } }).hint).toBeNull();
    expect(normalizeMissionPanelSnapshot({ open: false, hint: null }).hint).toBeNull();
    expect(normalizeMissionPanelSnapshot({ open: true, title: "T", hint: { title: "X" } }).hint).toBeNull();
    expect(closedMissionPanelSnapshot.hint).toBeNull();
  });
});

describe("the mission card is a slim see-through rail", () => {
  const css = readFileSync(new URL("../src/game-hud.css", import.meta.url), "utf8");
  it("is a narrow, mostly see-through strip as tall as its content", () => {
    expect(css).toMatch(/\.tv-host \.tv-sheet-mission \{\s*inset: calc\(8px \+ env\(safe-area-inset-top, 0px\)\) auto auto 0;\s*width: min\(232px, 30vw\);/);
    expect(css).toMatch(/\.tv-sheet-mission \{[^}]*background: rgb\(var\(--surface-rgb\) \/ 0\.72\);/);
  });
  it("keeps the main button in sight and the tool belt free on the Clean-up mission", () => {
    expect(css).toMatch(/\.tv-sheet-mission \.tv-fg-b \{[^}]*position: sticky;[^}]*bottom: 0;/);
    expect(css).toMatch(/\.tv-sheet-mission\[data-mission\$="\.clean"\] \{ max-height: calc\(100% - 82px/);
  });
  it("the tier row is one row of three star buttons", () => {
    expect(css).toMatch(/\[aria-label="Difficulty tier"\] \{ flex-wrap: nowrap; \}/);
  });
  it("the chip sits top right and steps aside for any open card", () => {
    expect(css).toMatch(/\.tv-host \.tv-mission-chip \{[^}]*right: calc\(10px \+ env\(safe-area-inset-right, 0px\)\);/);
    expect(css).toContain(".tv-host:has(.tv-sheet:not([hidden]), .tv-modal:not([hidden])) .tv-mission-chip { display: none; }");
  });
});
