// The game's main menu (src/features/game/world/titleEntries.ts, TitleMenu.tsx; docs/specs/carousel-modes-ladders-spec.md section 17, item 1).
// It was removed on 2026-11-02 (296de10) and the game booted straight into play; a deploy then showed the gap. The behaviour is checked in a real browser by
// scripts/e2e-title-menu.mjs; what is here is the rule for when it shows, the three entries, how the component renders, and the wiring that could silently rot
// between them: the boot waiting, the engine telling the page when the title is over, and every existing e2e going straight in.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TitleMenu } from "../src/features/game/world/TitleMenu";
import { TITLE_ENTRIES, TITLE_TAGLINE, shouldShowTitle } from "../src/features/game/world/titleEntries";

const root = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("when the game opens on the main menu", () => {
  /** The rule as a function of the chooser, so it can be run on a broken one. Returns what is wrong. */
  function failures(show: (search: string | null | undefined) => boolean): string[] {
    const bad: string[] = [];
    for (const s of ["", "?", "?tab=play", "?a=1&b=2", "#toy=abc", "?title=1", "?title=", "?title=yes", "?Title=0", "?subtitle=0", undefined, null]) if (!show(s as string)) bad.push(`${String(s)} must show the menu`);
    for (const s of ["?title=0", "?title=false", "?title=off", "?a=1&title=0", "?title=0&a=1", "title=0"]) if (show(s)) bad.push(`${s} must go straight in`);
    if (show("?title=0") !== show("?x=1&title=0&y=2")) bad.push("the position of the parameter must not matter");
    return bad;
  }

  it("is always, unless the address says title=0 (or false or off)", () => {
    expect(failures(shouldShowTitle)).toEqual([]);
  });

  it("fails the same rules on a version that never shows it, one that always does, and one that reads the wrong parameter (so the check can fail)", () => {
    expect(failures(() => false).length).toBeGreaterThan(0);
    expect(failures(() => true).length).toBeGreaterThan(0);
    expect(failures((s) => !(typeof s === "string" && /[?&]skip=0/.test(s))).length).toBeGreaterThan(0);
  });

  it("does not throw on a string URLSearchParams cannot make sense of", () => {
    for (const s of ["%", "?%zz=1", "?title=%E0%A4%A", "\u0000"]) expect(() => shouldShowTitle(s)).not.toThrow();
  });
});

describe("the three entries", () => {
  it("are Play, Build and Create, in that order, and only Play is the primary button", () => {
    expect(TITLE_ENTRIES.map((e) => e.id)).toEqual(["play", "build", "create"]);
    expect(TITLE_ENTRIES.filter((e) => e.primary).map((e) => e.id)).toEqual(["play"]);
    expect(new Set(TITLE_ENTRIES.map((e) => e.label)).size).toBe(3);
    for (const e of TITLE_ENTRIES) {
      expect(e.label.length).toBeGreaterThan(0);
      expect(e.hint.length).toBeGreaterThan(10);
    }
    expect(TITLE_TAGLINE).toBe("Build it. Play it. Make it real.");
  });
});

describe("the menu as it is drawn", () => {
  const draw = (props: { toyName?: string; ready: boolean }) => renderToStaticMarkup(createElement(TitleMenu, { ...props, onChoose: () => {} }));

  it("has the logo, the tagline and the three buttons, each named for what it does", () => {
    const html = draw({ ready: true, toyName: "Kip" });
    expect(html).toContain("ToyVentor");
    expect(html).toContain(TITLE_TAGLINE);
    for (const e of TITLE_ENTRIES) {
      expect(html).toContain(`data-title-entry="${e.id}"`);
      expect(html).toContain(`aria-label="${e.label}: ${e.hint}"`);
    }
    expect(html.match(/<button/g)?.length).toBe(3);
    expect(html).toContain('aria-label="ToyVentor main menu"');
  });

  it("shows the toy's name when it has one, and nothing when it has not", () => {
    expect(draw({ ready: true, toyName: "Blue Racer" })).toContain("Blue Racer");
    expect(draw({ ready: true })).not.toContain("tv-title-toy");
    expect(draw({ ready: true, toyName: "" })).not.toContain("tv-title-toy");
  });

  it("holds every entry back until the world is ready (nothing to start yet), and says Loading on Play", () => {
    const waiting = draw({ ready: false });
    expect(waiting.match(/disabled=""/g)?.length).toBe(3);
    expect(waiting).toContain("Loading…");
    const ready = draw({ ready: true });
    expect(ready).not.toContain("disabled");
    expect(ready).not.toContain("Loading…");
  });

  it("never prints a word that is not the child's: no free text comes in except the toy's name, and that is escaped", () => {
    const html = draw({ ready: true, toyName: '<img src=x onerror="alert(1)">' });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

describe("the wiring", () => {
  it("the world waits on its title when it is told to, and goes straight in when it is not (as every script before this expected)", () => {
    const world = read("src/features/game/world/runtime/world.ts");
    expect(world).toContain("title?: boolean;");
    expect(world).toContain("S.started=true;if(!options.title)startPlay(false);");
    // the scene the menu stands on is still there: the turntable, its two gears, and the way out of the title
    expect(world).toContain('hostEl.classList.add("titled")');
    expect(world).toMatch(/function startPlay\(build: boolean\)\{if\(!P\.title\)return;/);
    // ...and it turns under the child's hand now (runtime/turntableSpin.ts: hold, drag, fling): the frame moves the table, and the gears follow it in their old proportions (0.6 and -0.9 against 0.45)
    expect(world).toContain("var tts=TT.step(dt);facA+=tts.d;");
    expect(world).toContain("FAC.userData.gears[0].rotation.y+=tts.d*GEAR_RATIO[0];FAC.userData.gears[1].rotation.y+=tts.d*GEAR_RATIO[1]");
    expect(world).toContain("else{TT.park();TTS.quiet()}");                                                  // off the title the table is back to its idle turn and quiet
    expect(world).toContain("if(!P.title||!FAC||ttGrab||disposed");                                           // only the title reacts to a press on the stage
  });

  it("the engine passes the choice to the world and tells the page when the title is over", () => {
    const engine = read("src/features/game/world/engine.ts");
    expect(engine).toContain("initial: { contract: ToyContract | null; title?: boolean }");
    expect(engine).toMatch(/createWorldRuntime\(hostEl, \{[^}]*title: initial\.title,/);
    expect(engine).toContain("isTitle: () => !disposed && Boolean(hooks()?.P?.title),");
    // the panels a deep link can open all end the title state themselves, so the menu never has to be dismissed by hand
    expect(engine).toContain("if (api.P?.title) api.crFromTitle?.();");
    expect(engine).toContain("if (api.P?.title) api.start?.(true);");
  });

  it("the page asks for the title, draws the menu over the stage, hides the dock under it, and wires the three entries", () => {
    const page = read("src/features/game/world/GameCanvas.tsx");
    expect(page).toContain("{ contract: contractRef.current, title: wantTitleRef.current }");
    expect(page).toContain("shouldShowTitle(typeof window === \"undefined\" ? \"\" : window.location.search)");
    expect(page).toMatch(/\{titleOpen && <TitleMenu toyName=\{label\} ready=\{state\.ready\} onChoose=\{chooseTitle\} onNewPlayer=\{openOnboarding\} songKey=\{songFlow\?\.phase\} musicHold=\{onboardOpen \|\| songFlow\?\.phase === "dancing"\} \/>\}/); // the small new-player link (tests/onboarding-wiring.test.ts), and the title's music (it waits for the setup and for a dance party, and re-reads the kept songs when one lands: tests/title-music.test.ts)
    expect(page.indexOf('<div ref={stageHostRef} className="tv-stage-canvas-host" />')).toBeLessThan(page.indexOf("<TitleMenu"));
    expect(page).toContain('titleOpen ? " tv-host--titled" : ""');
    const choose = page.slice(page.indexOf("const chooseTitle = useCallback("), page.indexOf("[closeReactOverlays, openBuildSheet]"));
    expect(choose).toContain('choice === "play"');
    expect(choose).toContain("engineRef.current?.start()");
    expect(choose).toContain("openBuildSheet()");
    expect(choose).toContain("engineRef.current?.openCreate()");
    expect(choose).toContain("setTitleOpen(false)");
    // and it notices the title ending without a button (a deep link to Create or the editor)
    expect(page).toContain("if (!engineRef.current?.isTitle()) setTitleOpen(false);");
  });

  it("the styles hide the dock and the other stage overlays while the menu is up, and let touches through everywhere but its buttons", () => {
    const css = read("src/index.css");
    expect(css).toMatch(/\.tv-host--titled \.tv-dock \{\s*display: none;/);
    expect(css).toMatch(/\.tv-host--titled \.tv-stage > :not\(\.tv-stage-canvas-host\):not\(\.tv-title\):not\(\.tv-onb\) \{\s*display: none;/); // the new-player sheet is the one other overlay allowed over the menu
    expect(css).toMatch(/\.tv-host--titled \.tv-stage-canvas-host #tray \{\s*display: none;/); // the ability buttons are in the canvas host's #tray
    expect(css).toMatch(/\.tv-title \{[^}]*pointer-events: none;/);
    expect(css).toMatch(/\.tv-title-btns \{[^}]*pointer-events: auto;/);
  });

  it("the pure module and the component have names that differ by more than case (a case-insensitive disk made TypeScript refuse the first pair)", () => {
    const names = ["TitleMenu.tsx", "titleEntries.ts"].map((n) => n.replace(/\.[a-z]+$/, "").toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it("every e2e that expects the game already in play asks for it with title=0", () => {
    const scripts = ["bed", "feeding", "game-mess", "game-party", "orchard", "props", "toyroom", "toyroom2", "backdrop", "chrome", "trail", "game-workshop", "parent-controls"];
    // the URL itself, not a comment about it: the page address ends in /?title=0 (the dev server's port, or the base the script builds)
    for (const s of scripts) expect(read(`scripts/e2e-${s}.mjs`), `scripts/e2e-${s}.mjs`).toMatch(/\$\{(?:DEV_PORT|PORT)\}\/\?title=0|\$\{BASE\}\/\?title=0/);
  });

  it("the menu reads nothing about the child except the toy's name: no storage, no network, no timer of its own", () => {
    const code = strip(read("src/features/game/world/TitleMenu.tsx")) + strip(read("src/features/game/world/titleEntries.ts"));
    expect(code).not.toMatch(/\b(localStorage|sessionStorage|fetch|XMLHttpRequest|setTimeout|setInterval|navigator)\b/);
  });
});
