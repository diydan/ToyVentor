// Home in the drawer (NavStrip -> GameCanvas goHome -> engine.goTitle -> world.ts goTitle): back to the main menu from wherever the child is. Pinned by text because the world runtime
// is one big script string-compiled by the engine; the browser run of this is scratch (headless Chrome: Play, Home, Play again, Home from Build, and the refusal toast below).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("..", import.meta.url).pathname;
const world = readFileSync(`${root}src/features/game/world/runtime/world.ts`, "utf8");
const engine = readFileSync(`${root}src/features/game/world/engine.ts`, "utf8");
const canvas = readFileSync(`${root}src/features/game/world/GameCanvas.tsx`, "utf8");
const strip = readFileSync(`${root}src/features/game/world/NavStrip.tsx`, "utf8");

const goTitle = (): string => {
  const i = world.indexOf("function goTitle()");
  expect(i, "goTitle in world.ts").toBeGreaterThanOrEqual(0);
  return world.slice(i, world.indexOf("\n", i));
};

describe("Home: the world goes back to the main menu", () => {
  it("is a no-op if already on the menu, and re-enters the same title state the boot line sets", () => {
    const g = goTitle();
    expect(g).toContain("if(P.title)return true;");
    expect(g).toContain("P.title=true;P.showcase=true;");
    expect(g).toContain('hostEl.classList.add("titled")');
  });
  it("refuses while the editor play-test, a driven mission, a sleep or an act is mid-way, and says why instead of doing nothing", () => {
    const g = goTitle();
    expect(g).toMatch(/if\(ED\.on\|\|P\.mDrive\|\|P\.busy\|\|SLEEPH\.busy\|\|ACTS\.busy\)\{toast\("Finish this first, then Home"\);return false\}/);
  });
  it("the title music stays silent after Home (Play turns it back on)", () => {
    expect(goTitle()).toContain("if(MUS.on){musGain(0,.5);MUS.on=false}");
  });
  it("the handle and the engine both expose goTitle, and the engine answers false when the world is gone", () => {
    expect(world).toContain("start:startPlay,goTitle:goTitle");
    expect(engine).toContain("goTitle: () => !disposed && hooks()?.goTitle?.() === true,");
  });
});

describe("Home: the drawer button", () => {
  it("NavStrip leads with Home and Map, and its third cell is the Settings button it is handed", () => {
    expect([...strip.matchAll(/data-nav="(\w+)"/g)].map((m) => m[1])).toEqual(["home", "map"]);
    expect(strip).toContain("{settings}");
  });
  it("goHome closes what is open, ends a Learn run and a song party, and only shows the menu if the world agreed", () => {
    const i = canvas.indexOf("const goHome = useCallback(");
    expect(i).toBeGreaterThanOrEqual(0);
    const body = canvas.slice(i, canvas.indexOf("[closeEngineSheets, closeReactOverlays, state.learn]", i));
    expect(body).toContain('songRef.current?.party.stop("stopped");');
    expect(body).toContain("if (state.learn) engine()?.stopLearnRun();");
    expect(body).toContain("if (engine()?.goTitle()) setTitleOpen(true);");
    expect(body.indexOf("closeEngineSheets();")).toBeLessThan(body.indexOf("goTitle()"));
  });
  it("the strip is mounted once with Map wired, and Settings in it is THE grown-ups' gear: one button, the 1.2 s hold kept, not a second Settings in the drawer", () => {
    expect(canvas.match(/<NavStrip/g)?.length).toBe(1);
    expect(canvas).toMatch(/<NavStrip[\s\S]{0,120}disabled=\{sleepActive\}[\s\S]{0,60}onHome=\{goHome\}/);
    expect(canvas).toMatch(/onMap=\{[\s\S]{0,200}openMap\(\)/);
    expect(canvas.match(/tv-ctl tv-ctl-gear/g)?.length).toBe(1);
    expect(canvas).toMatch(/settings=\{\s*<button[\s\S]{0,160}className="tv-ctl tv-ctl-gear tv-navstrip-btn"\s+data-nav="settings"/);
    expect(canvas).toContain("onPointerDown={startGearHold}");
    expect(canvas).toContain("openGrownUps(true);"); // the long press still skips the sheet's own hold
    expect(canvas).toContain('className="tv-parent-dot"');
  });
  it("opening the grown-ups' card closes the drawer (the Settings button inside it does not close it by itself)", () => {
    const i = canvas.indexOf("const openGrownUps = useCallback(");
    expect(canvas.slice(i, canvas.indexOf("[closeEngineSheets, closeReactOverlays],", i))).toContain("setMenuOpen(false);");
  });
});
