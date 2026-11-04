// How the new-player setup is wired into the game (docs/specs/accounts-and-new-user-spec.md section 8). Source checks, because the game's shell is too big to mount in a unit test; the real
// page was driven in headless Chrome (every step, the validation, the shirt colour, the profile, the song request).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TITLE_ENTRIES } from "../src/features/game/world/titleEntries";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const canvas = read("src/features/game/world/GameCanvas.tsx");
const title = read("src/features/game/world/TitleMenu.tsx");
const grownUps = read("src/features/game/world/GrownUpsSheet.tsx");
const sheet = read("src/features/game/world/OnboardingSheet.tsx");
const css = read("src/index.css");

describe("the title screen", () => {
  it("still has exactly Play, Build and Create; the setup is a small link under them, not a fourth entry", () => {
    expect(TITLE_ENTRIES.map((e) => e.id)).toEqual(["play", "build", "create"]);
    expect(title).toContain("onNewPlayer");
    expect(title).toContain('className="tv-title-new"');
    expect(title).not.toMatch(/data-title-entry="new/);
  });
  it("hides every stage overlay while it is up EXCEPT the setup sheet (else the sheet opens invisibly behind the menu)", () => {
    expect(css).toContain(".tv-host--titled .tv-stage > :not(.tv-stage-canvas-host):not(.tv-title):not(.tv-onb) {");
  });
});

describe("the game opens it", () => {
  it("from the title link, the Grown-Ups sheet and ?onboarding=1, and only those", () => {
    expect(canvas).toContain("onNewPlayer={openOnboarding}");
    expect(canvas.match(/onNewPlayer=\{openOnboarding\}/g)).toHaveLength(2); // the title menu and the Grown-Ups sheet
    expect(canvas).toContain("/[?&]onboarding=1(&|$)/");
    expect(grownUps).toContain("onNewPlayer");
    expect(grownUps).toContain("Set up a new player");
  });
  it("starts the world when the intro begins, paints the shirt through the engine's own paint zone, and asks for the song through the game's song flow as a screened 'prompt'", () => {
    expect(canvas).toContain('if (titleOpen) chooseTitle("play")');
    expect(canvas).toContain('e?.setPaintZone("c1"); e?.setPaint(hex);');
    expect(canvas).toContain('startFromSheet(() => void getSong().flow.start(idea, "prompt"))');
    expect(canvas).toContain("<OnboardingSheet");
  });
});

describe("the sheet keeps its promises", () => {
  it("never talks to a server itself: no fetch, no XMLHttpRequest, no sendBeacon; the only storage is the profile on the device", () => {
    expect(sheet).not.toMatch(/\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket/);
    expect(sheet).toContain("saveProfile(");
    expect(sheet).not.toMatch(/localStorage\.(set|get)Item/); // everything goes through newPlayer.ts
  });
  it("asks for the song only from a tap and only from the profile's own song idea (null without the grown-up's yes)", () => {
    expect(sheet).toContain("const idea = songIdea(made.profile);");
    expect(sheet).toContain("if (idea) onSong(idea);");
    expect(sheet.match(/\bonSong\(idea\)/g)).toHaveLength(1);
  });
  it("shows no price, no buy button and no sign-up field in the tour", () => {
    expect(sheet).not.toMatch(/type="email"|type="tel"|placeholder="[^"]*@/i);
  });
});
