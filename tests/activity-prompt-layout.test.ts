import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The activity card's layout, pinned from the source (the card is drawn by the real DOM only; it was measured in a 390 x 844 browser on 2026-11-04).
// What that measurement found: at the roomy button size three tools plus "Clean it" (band 3 of the cleaning level) WRAPPED to two rows, 176 px tall, and the card's top edge sat on the
// front mess. Four buttons are now tight and stay in ONE row, the same 108 px card as the one-button card, with every button still at least 56 px tall.
const src = readFileSync(join(__dirname, "..", "src/features/game/world/runtime/activityPrompt.ts"), "utf8");

describe("the activity card keeps four buttons in one row", () => {
  it("is tight from four buttons up: no wrapping, a smaller gap, narrower buttons", () => {
    expect(src).toMatch(/const tight = spec\.buttons\.length >= 4;/);
    expect(src).toMatch(/row\.style\.cssText = tight \? ROW_TIGHT_CSS : ROW_CSS;/);
    expect(src).toMatch(/const ROW_TIGHT_CSS = \["display:flex", "flex-wrap:nowrap"/);
    expect(src).toMatch(/makeButton\(doc, b, tight\)/);
  });
  it("never trades height for width: the tight button keeps the 56 px minimum height, and a width of at least 56 px", () => {
    const tightCss = src.match(/const TIGHT_BUTTON_CSS = "([^"]+)"/)?.[1] ?? "";
    expect(tightCss).toContain("min-width:56px");
    expect(tightCss).not.toMatch(/min-height|height:/);
    expect(src).toMatch(/`min-height:\$\{PROMPT_MIN_HEIGHT_PX\}px`/);
  });
  it("leaves the roomy layout for one to three buttons (they may wrap on a very narrow screen rather than shrink)", () => {
    expect(src).toMatch(/const ROW_CSS = \["display:flex", "flex-wrap:wrap"/);
  });
});
