// Focused tests for the native editor bridge (5A Unit 1 slice E).
// editorData mirrors the legacy #ed template; expectations below are
// transcribed from that template, so drift fails here first.
import { describe, expect, it } from "vitest";
import { editorData } from "../src/features/game/world/runtime/editorData";

const io = {
  open: false, title: "Level file", text: "",
  readOnly: true, canCopy: false, canLoad: false,
};

const base = {
  testing: false, kid: false, backLabel: "Back to editor",
  name: "My world", theme: "garden", tab: "spots",
  checkPass: 1, checkTotal: 6, canUndo: true, canRedo: false,
  io, recipe: { format: "toyventor.level/1" },
};

describe("editor snapshot builder mirrors the legacy template", () => {
  it("renders the inspector with grouped selects and fixed controls", () => {
    const data = editorData({
      ...base,
      sel: {
        title: "Hiding spot",
        mut: "Junk machine, revealed by unscrewing",
        hide: {
          label: "Hidden in", value: "cave",
          groups: [{
            label: "Junk machine (hollow, unscrew)",
            options: [
              { value: "cave", label: "Cave", selected: true },
              { value: "tower", label: "Tower", selected: false },
            ],
          }],
        },
        part: {
          label: "Part", value: "char.head.box",
          groups: [{
            label: "Character",
            options: [{ value: "char.head.box", label: "Box head (Head, none)", selected: true }],
          }],
        },
      },
      palette: null, tabMut: null, checks: null,
    });
    expect(data.open).toBe(true);
    expect(data.mode).toBe("editor");
    expect(data.selectedTitle).toBe("Hiding spot");
    expect(data.lines).toEqual(["Junk machine, revealed by unscrewing"]);
    expect(data.controls.map((c) => c.label)).toEqual(["Move left", "Move right", "Delete", "Done"]);
    expect(data.controls[3]).toMatchObject({ primary: true, disabled: false });
    expect(data.selects).toHaveLength(2);
    expect(data.selects[0]).toMatchObject({ index: 0, label: "Hidden in", value: "cave" });
    expect(data.selects[0]!.options[0]).toMatchObject({ group: "Junk machine (hollow, unscrew)" });
    expect(data.palette).toEqual([]);
    expect(data.checks).toEqual([]);
  });

  it("renders the spots palette with tab text and live check counts", () => {
    const data = editorData({
      ...base,
      sel: null,
      palette: [{ label: "Cave", detail: "Hollow rock", selected: false, color: "#8a96c8" }],
      tabMut: "Tap a hiding spot, then tap the path to place it. Tap a pin to edit it, or drag it to move it.",
      checks: null,
    });
    expect(data.tabs).toEqual([
      { id: "spots", label: "Hiding spots", selected: true },
      { id: "props", label: "Scenery", selected: false },
      { id: "checks", label: "Checks 1/6", selected: false },
    ]);
    expect(data.palette[0]).toMatchObject({ index: 0, label: "Cave", color: "#8a96c8" });
    expect(data.lines).toHaveLength(1);
    expect(data.controls).toEqual([]);
  });

  it("renders check rows only in the checks view", () => {
    const data = editorData({
      ...base, tab: "checks", sel: null, palette: null, tabMut: null,
      checks: [
        { title: "Five hidden parts", detail: "Passing", ok: true },
        { title: "A junk machine in the first 10 units", detail: "So the first find never needs a move", ok: false },
      ],
    });
    expect(data.checks[1]).toMatchObject({ ok: false });
    expect(data.lines).toEqual([]);
  });
});

describe("editor bridge shape", () => {
  it("runtime exposes live snapshot data and native actions", async () => {
    // Unit 2e: editor logic lives in editor.ts; the shipped runtime is both files.
    const fs = await import("node:fs/promises");
    const text = (
      await Promise.all(
        ["world.ts", "editor.ts"].map((f) =>
          fs.readFile(
            new URL(`../src/features/game/world/runtime/${f}`, import.meta.url),
            "utf8",
          ),
        ),
      )
    ).join("\n");
    for (const token of [
      "function edSnap()",
      "function edSetTab(t: string)",
      "function edArm(i: number)",
      "function edControl(i: number)",
      "function edDelete()",
      "function edSetHide(v: string)",
      "function edNew(v: string)",
      "function edIoLoad()",
      "function edFromTitle()",
      "edSnap:function()",
      "edSetTab:function(t)",
    ]) {
      expect(text).toContain(token);
    }
  });

  it("engine drives the editor natively without #ed selectors", async () => {
    const fs = await import("node:fs/promises");
    const text = await fs.readFile(
      new URL("../src/features/game/world/engine.ts", import.meta.url),
      "utf8",
    );
    expect(text).toContain("hooks()?.edSnap?.()");
    expect(text).toContain("hooks()?.edSetTab?.(tab)");
    expect(text).toContain("hooks()?.edArm?.(index)");
    expect(text).toContain("api.edFromTitle?.()");
    for (const selector of [
      "#ed-body", "#ed-tabs", "#ed-name", "#ed-theme", "#ed-new",
      "#ed-undo", "#ed-redo", "#ed-zi", "#ed-zo", "#ed-export",
      "#ed-import", "#ed-copy", "#ed-load", "#ed-close", "#ed-txt",
      "#ed-io", "#ed-del", "#ed-ok", "#ed-hide", "#ed-part",
      "#ed-back", "#tedit",
    ]) {
      expect(text).not.toContain(selector);
    }
  });
});
