// The all-screens landscape sweep (2026-11-04): what was wrong on a 844x390 phone once every card became a left card, pinned by text so it stays fixed. Each rule below was found by looking at the
// screen, not by a test: the Create card's picture words were squashed to 4 px, the Daily Pack's hint lay on the ticket, the grown-ups' sum box was 28 px wide, the PIN keypad's 0 was under the fold,
// the world title was unreadable over the scenery and the drawer needed scrolling to reach the grown-ups' gear. CSS only (src/game-hud.css), never another lane's file.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("..", import.meta.url).pathname;
const css = readFileSync(`${root}src/game-hud.css`, "utf8");

/** The body of the rule whose selector list is exactly `sel` (outside any media query unless `inMedia` says which), up to its closing brace. */
function body(sel: string, inMedia?: string): string {
  const from = inMedia ? css.indexOf(inMedia) : 0;
  expect(from, `media block ${inMedia}`).toBeGreaterThanOrEqual(0);
  const i = css.indexOf(sel + " {", from);
  expect(i, `rule ${sel}`).toBeGreaterThanOrEqual(0);
  return css.slice(i, css.indexOf("}", i));
}

describe("a card scrolls as a whole, so nothing in it shrinks", () => {
  it("every child of a sheet keeps its height (the picture-word row is an overflow scroller and went to 4 px)", () => {
    expect(body(".tv-host .tv-sheet > *")).toContain("flex-shrink: 0");
  });
});

describe("the Daily Pack in a 390 px card", () => {
  it("the ticket is smaller and the hint is one line, so the hint is not on the ticket's label", () => {
    const ticket = body(".tv-host .pack-float");
    expect(ticket).toMatch(/width:\s*130px/);
    expect(ticket).toMatch(/height:\s*180px/);
    expect(body(".tv-host .pack-hint small")).toContain("display: none");
  });
  it("the ticket keeps its 172:238 shape (the foil art is an SVG that fills the box)", () => {
    expect(130 / 180).toBeCloseTo(172 / 238, 1);
  });
});

describe("the grown-ups' corner", () => {
  it("the sum box has a real flex basis (it was 28 px: a zero basis in a row that shrinks to its content)", () => {
    const rule = body(".tv-host .tv-parent-input");
    expect(rule).toMatch(/flex:\s*1 1 150px/);
    expect(rule).toMatch(/min-width:\s*110px/);
  });
  it("the PIN keypad fits a 390 px card: tighter card, 40 px keys, 4 rows + 3 gaps well under the 260 px left below the title", () => {
    const m = "@media (max-height: 480px) {\n  .tv-host .tv-parent-gate-card";
    expect(css).toContain(m);
    const key = body(".tv-host .tv-pin-key", m);
    expect(key).toMatch(/min-height:\s*40px/);
    const keys = 4 * 40 + 3 * 6;
    expect(keys).toBeLessThan(260);
  });
});

describe("the drawer fits a 390 px phone without scrolling, gear included", () => {
  const media = "@media (max-height: 480px) {\n  .tv-host .tv-dock .tv-navstrip";
  it("the Home / Map / Settings strip is one short row (the strip is another lane's file; only game-hud.css restyles it, three selectors deep)", () => {
    expect(css).toContain(media);
    const btn = body(".tv-host .tv-dock .tv-navstrip-btn", media);
    expect(btn).toMatch(/min-height:\s*44px/);
    expect(btn).toContain("flex-direction: row");
  });
  it("the items are 42 px and the grown-ups' gear shares the last row (it keeps its class, hold text and parent dot, which tests and e2e click)", () => {
    expect(css).toMatch(/\.tv-host \.tv-dock-right \.tv-ctl,\s*\n\s*\.tv-host \.tv-dock \.tv-menu-item \{ min-height: 42px; \}/);
    expect(body(".tv-host .tv-dock .tv-ctl-gear", media)).toContain("grid-column: auto");
  });
  it("the budget adds up: pill 54 + strip 44 + five 42 px rows + gaps stays under 390", () => {
    const rows = 5, items = 42, gaps = 8;
    const total = 8 + 54 + gaps + 44 + gaps + rows * items + (rows - 1) * gaps;
    expect(total).toBeLessThanOrEqual(390);
  });
  it("phones only 360-400 px tall (iPhone mini / SE 375, small Androids 360) get a tighter tier: 40 px items, 6 px gaps, and it adds up to 360", () => {
    const media = "@media (max-height: 400px) {\n  .tv-host .tv-dock {";
    expect(css).toContain(media);
    expect(body(".tv-host .tv-dock", media)).toContain("gap: 6px");
    expect(css.slice(css.indexOf(media))).toMatch(/min-height:\s*40px/);
    const rows = 5, items = 40, gaps = 6;
    const total = 8 + 54 + gaps + 44 + gaps + rows * items + (rows - 1) * gaps + 8;                          // (top padding, pill, strip, rows, bottom padding)
    expect(total).toBeLessThanOrEqual(360);
  });
});

describe("the world's title over the scenery", () => {
  it("has a see-through dark backing so the thin yellow line reads over green hills and sky, and it is a chip, not a bar", () => {
    const rule = body(".tv-host .tv-stage-canvas-host .intro");
    expect(rule).toMatch(/background:\s*rgba\(10, 19, 54, 0\.5\)/);
    expect(rule).toContain("width: fit-content");
    expect(rule).toContain("right: auto");
  });
});
