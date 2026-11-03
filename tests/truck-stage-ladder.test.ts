import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The decided ladder (Dan, 2026-11-02; docs/specs/motion-stage-options-spec.md section 3.0): Snap -> Motion -> Pro.
// Motion has two alternative cores (pull-back band, balloon jet); Pro has an optional powered add-on (Card F, the old "Mech").
// The viewer's stage ids (`?stage=` values, the probes) never change: only the button order and the labels follow the ladder.
// Since Workshop stage 4c the stage buttons are the Truck's declaration for the one menu (truck-menu.js), no longer markup in the bench.
// @ts-expect-error untyped JS module
import { TRUCK_STAGES } from "../parts/kip/viewer/truck-menu.js";

const source = readFileSync(join(process.cwd(), "parts/kip/viewer/truck-bench.js"), "utf8");
const menuSource = readFileSync(join(process.cwd(), "parts/kip/viewer/truck-menu.js"), "utf8");

const LADDER = [
  { id: "snap", step: "1", label: /Snap \(3\+\)/ },
  { id: "band", step: "2a", label: /Motion \(8\+\) Pull-Back Band/ },
  { id: "jet", step: "2b", label: /Motion \(8\+\) Balloon Jet/ },
  { id: "pro", step: "3", label: /Pro \(8\+\) Rack Steer/ },
  { id: "mech", step: "3+", label: /Pro Powered Add-On \(10\+\)/ },
];

const buttons = (TRUCK_STAGES as { id: string; label: string }[]).map((s) => ({ id: s.id, text: s.label.trim() }));
const hud = new Map(
  [...source.matchAll(/(\w+): \{\s*badge: (['"])(.*?)\2,\s*title: (['"])(.*?)\4,/g)].map((m) => [m[1] ?? "", { badge: m[3] ?? "", title: m[5] ?? "" }]),
);

describe("Truck stage ladder: Snap -> Motion -> Pro", () => {
  it("finds the five stages and five HUD entries (guards the parsing below)", () => {
    expect(buttons.map((b) => b.id)).toHaveLength(LADDER.length);
    expect([...hud.keys()].sort()).toEqual(LADDER.map((s) => s.id).sort());
  });

  it("lists the stage buttons in ladder order, with the same stage ids as before", () => {
    expect(buttons.map((b) => b.id)).toEqual(LADDER.map((s) => s.id));
  });

  it("numbers and names each button after its rung of the ladder", () => {
    LADDER.forEach((rung, i) => {
      const text = buttons[i]?.text ?? "";
      expect(text.startsWith(`${rung.step} ·`), `button ${rung.id} reads "${text}"`).toBe(true);
      expect(text, `button ${rung.id}`).toMatch(rung.label);
    });
  });

  it("gives the HUD badge and title the same step number as the button", () => {
    for (const rung of LADDER) {
      const found = hud.get(rung.id);
      expect(found, `HUD entry for ${rung.id}`).toBeDefined();
      const info = found ?? { badge: "", title: "" };
      expect(info.badge.startsWith(`Stage ${rung.step} ·`), `badge for ${rung.id} reads "${info.badge}"`).toBe(true);
      expect(info.title.startsWith(`${rung.step} ·`), `title for ${rung.id} reads "${info.title}"`).toBe(true);
    }
  });

  it("keeps no step number from the old four-stage numbering (3A, 3B, Stage 4) anywhere in the bench", () => {
    for (const [name, text] of [["truck-bench.js", source], ["truck-menu.js", menuSource]] as const) {
      const old = [...text.matchAll(/\b3A\b|\b3B[′']|\bStage 4\b|\b4 · Pro/g)].map((m) => {
        const line = text.slice(0, m.index).split("\n").length;
        return `${name} line ${line}: ${m[0]}`;
      });
      expect(old).toEqual([]);
    }
  });
});
