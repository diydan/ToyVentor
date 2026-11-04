// The landscape HUD (src/game-hud.css + GameCanvas.tsx): one Kip button, one drawer, cards from the left edge, small pop-ups beside the button, abilities bottom-right. Pinned by text, because the
// pieces are CSS and JSX: what must stay true is which element goes where, and that the hidden sheets (they stay mounted with `hidden`) never hide the Kip button.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("..", import.meta.url).pathname;
const canvas = readFileSync(`${root}src/features/game/world/GameCanvas.tsx`, "utf8");
const css = readFileSync(`${root}src/game-hud.css`, "utf8");
const rule = (sel: string): string => {
  const i = css.indexOf(sel + " {");
  expect(i, `rule ${sel}`).toBeGreaterThanOrEqual(0);
  return css.slice(i, css.indexOf("}", i));
};

describe("the one button and its drawer (GameCanvas.tsx)", () => {
  it("there is one Kip button, not on the title menu, the Map or while the toy sleeps, and it opens the drawer", () => {
    expect(canvas).toContain('className="tv-kip-fab"');
    expect(canvas).toContain("{!titleOpen && !sleepActive && !mapOpen && (");                          // (the Map is a full screen of its own: the button would sit on its header)
    expect(canvas).toContain("setMenuOpen((open) => !open);");
    expect(canvas).toContain('aria-controls="tv-drawer"');
  });
  it("the old top bar is the drawer: same buttons, slid in from the left, closed again by any button in it (the grown-ups' gear, which needs a hold, keeps it open)", () => {
    expect(canvas).toContain('id="tv-drawer"');
    expect(canvas).toContain('data-open={menuOpen ? "true" : "false"}');
    expect(canvas).toContain('if (t && !t.classList.contains("tv-ctl-gear")) window.setTimeout(() => setMenuOpen(false), 0);');
    for (const label of ["Build", "Create", "Pack"]) expect(canvas).toContain(`${label}\n`);
    expect(canvas).toContain("<WorkshopLauncher");
    expect(canvas).toContain('className="tv-ctl tv-ctl-gear tv-navstrip-btn"');
  });
  it("the menu is open inside the drawer, and it gained a Worlds entry (the world pill is gone); the Map is one of the strip's three buttons at the top, not listed twice", () => {
    expect(canvas).toContain("{(moreOpen || menuOpen) && (");
    expect(canvas).toMatch(/tv-menu-worlds[\s\S]{0,400}setWorldsOpen\(true\)/);
    expect(canvas).toContain("<NavStrip");
    expect(canvas).toMatch(/<NavStrip[\s\S]{0,400}onMap=\{[\s\S]{0,200}openMap\(\)/);
    expect(canvas).not.toMatch(/<span>Map<\/span>\s*<span className="tv-menu-meta">Play<\/span>/);                    // (no "Map / Play" menu item under Worlds)
  });
  it("a scrim behind the open drawer closes it", () => {
    expect(canvas).toContain('className="tv-drawer-scrim"');
    expect(canvas).toContain("onClick={() => setMenuOpen(false)}");
  });
  it("the rotate gate covers the game while the device is upright on a touch screen", () => {
    expect(canvas).toContain('className="tv-rotate-gate"');
    expect(canvas).toContain("{uprightGate && (");
    expect(canvas).toContain("window.matchMedia(ROTATE_GATE_QUERY)");
    expect(canvas).toContain("rotateGateShowing(window.location.search, mq.matches)");
  });
});

describe("where everything sits (game-hud.css)", () => {
  it("the Kip button is top-left and the drawer comes from the left edge, off-screen and not focusable until opened", () => {
    expect(rule(".tv-host .tv-kip-fab")).toMatch(/top: calc\(8px/);
    expect(rule(".tv-host .tv-kip-fab")).toMatch(/left: calc\(8px/);
    const d = rule(".tv-host .tv-dock");
    expect(d).toContain("left: 0;");
    expect(d).toContain("transform: translateX(-104%);");
    expect(d).toContain("visibility: hidden;");
    expect(rule('.tv-host .tv-dock[data-open="true"]')).toContain("visibility: visible;");
  });
  it("the world pill and the big Map button are gone from the screen (the drawer has both; the Map button is not in the markup at all any more)", () => {
    expect(canvas).not.toContain("tv-map-fab");
    expect(rule(".tv-host .tv-worlds-btn")).toContain("display: none;");
  });
  it("every sheet and every full-screen modal is a card at the left edge, never a bottom sheet", () => {
    expect(css).toMatch(/\.tv-host \.tv-sheet,\s*\.tv-host \.tv-modal \{[^}]*inset: 0 auto 0 0;/);
    expect(css).toMatch(/\.tv-host \.tv-sheet,\s*\.tv-host \.tv-modal \{[^}]*width: min\(420px, 58vw\);/);
    expect(css).toContain(".tv-host .tv-song-card,");
    expect(css).toContain(".tv-host .tv-garage-chip {");
  });
  it("the Kip button steps aside only for a card that is really open: sheets that stay mounted with `hidden` never match", () => {
    expect(css).toContain(":has(.tv-sheet:not([hidden]), .tv-modal:not([hidden]))");
    expect(css).not.toMatch(/:has\(\.tv-sheet, \.tv-modal\)/);
  });
  it("the small pop-ups (name toast, hint chip, the world's name, the XP line) all sit at the left, beside the Kip button; none is centred", () => {
    for (const sel of [".tv-host .tv-stage-canvas-host .toast", ".tv-host .tv-stage-canvas-host .intro", ".tv-host .tv-xp-toast"]) {
      const r = rule(sel);
      expect(r, sel).toMatch(/left: calc\(72px/);
      expect(r, sel).not.toContain("50%");
    }
    expect(css).toMatch(/\.bubble \{[^}]*left: calc\(72px[^}]*!important/);                       // the world sets the bubble's position inline, so this one needs !important
    expect(rule(".tv-host .tv-stage-canvas-host .toast")).toMatch(/background: rgba\(16, 26, 68, 0\.5\d?\)/);        // see-through
    expect(rule(".tv-host .tv-stage-canvas-host .toast")).toContain("border-radius: 999px;");
  });
  it("a found part or finished mission card slides in from the left edge under the Kip button", () => {
    const r = rule(".tv-host .tv-stage-canvas-host .pcard");
    expect(r).toContain("left: 0;");
    expect(r).toContain("transform: none;");
    expect(r).toMatch(/top: calc\(72px/);
  });
  it("the abilities are bottom-right under the right thumb, the tool belt bottom-left under the left", () => {
    const tray = rule(".tv-host .tv-stage-canvas-host .tray");
    expect(tray).toMatch(/right: calc\(8px/);
    expect(tray).toContain("left: auto;");
    expect(tray).toContain("background: none;");
    expect(rule(".tv-host .tv-stage-canvas-host .belt-b")).toMatch(/left: calc\(12px/);
  });
  it("a card open at the left moves the pop-ups over to its right edge, by the card's own width", () => {
    expect(css).toContain(".toast,");
    expect(css).toMatch(/left: calc\(min\(420px, 58vw\) \+ 14px\)/);
  });
});

describe("the game is landscape (the rotate gate)", () => {
  it("covers everything, above every card, and cannot be touched through", () => {
    const g = rule(".tv-rotate-gate");
    expect(g).toContain("position: fixed;");
    expect(g).toContain("inset: 0;");
    expect(g).toContain("z-index: 9999;");
    expect(g).toContain("touch-action: none;");
  });
  it("the camera comes closer on a wide screen so toys keep finger-sized targets", () => {
    const world = readFileSync(`${root}src/features/game/world/runtime/world.ts`, "utf8");
    expect(world).toContain("const LAND_DD=7.6;");
    expect(world).toContain("Math.max(asp>1.2?LAND_DD:10,");
  });
});
