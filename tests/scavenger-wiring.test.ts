import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const canvas = read("../src/features/game/world/GameCanvas.tsx");
const toySheet = read("../src/features/game/world/MyToySheet.tsx");
const camera = read("../src/features/game/world/ScavengerCamera.tsx");
const css = read("../src/scavenger-cam.css");

describe("the scavenger camera is wired into the game (SAM spec §7)", () => {
  it("the Toy Box gives a scavenger chore a camera button and leaves every other chore its tap", () => {
    expect(toySheet).toContain("onScavenge?: (choreId: string) => void;");
    expect(toySheet).toMatch(/isScavengerChore\(chore\.id\)[\s\S]{0,400}📷 Find it/);
    expect(toySheet).toMatch(/!\(onScavenge && isScavengerChore\(chore\.id\)\)[\s\S]{0,300}I did it!/);
  });

  it("the game opens the camera for the chosen quest and pays the chore through the one completion path", () => {
    expect(canvas).toContain("const completeChore = (choreId: string) => {");
    expect(canvas).toContain("onCompleteChore={completeChore}");
    expect(canvas).toMatch(/onScavenge=\{\(choreId: string\) => \{\s*setScavenge\(SCAVENGER_QUESTS\.find/);
    expect(canvas).toMatch(/<ScavengerCamera[\s\S]{0,200}onFound=\{completeChore\}/);
  });

  it("a find is paid once the verdict is in, before the outline is asked for (a slow trace never takes it away)", () => {
    const found = camera.indexOf("onFoundRef.current(quest.id)");
    const trace = camera.indexOf("await scanPhoto(");
    expect(found).toBeGreaterThan(0);
    expect(trace).toBeGreaterThan(found);
  });

  it("the verdict is the quest's closed word list, never the child's say-so", () => {
    expect(camera).toContain("scavengerVerdictFromNames(quest, named.names)");
    expect(camera).not.toMatch(/onFoundRef\.current\([^)]*\)[\s\S]{0,40}input/);
  });

  it("keeps nothing: no storage, no cookies, the picture only in memory, the camera let go at the shutter", () => {
    expect(camera).not.toMatch(/localStorage|sessionStorage|document\.cookie|indexedDB|FileReader|\.download\b/);
    expect(camera).toMatch(/stopCamera\(\);\s*setFrame\(f\)/);
    expect(camera).toMatch(/getTracks\(\)\.forEach\(\(t\) => t\.stop\(\)\)/);
  });

  it("the only privacy sentence promises our side and nothing about the provider (spec Q7 is still open)", () => {
    const code = camera.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""); // what a child can read is in the code, not the comments
    expect(camera).toContain("We check the photo, then we throw away our copy. We only keep the count.");
    expect(code).not.toMatch(/provider|Meta|never stored|deleted by/i);
  });

  it("the part in the room uses the real model-viewer part, only for a quest with a part", () => {
    expect(camera).toContain("SCAVENGER_REWARD_GLB[quest.concept]");
    expect(camera).toContain("<PartPreview glbFile={reward.glb}");
  });

  it("sits above the sheets and below the rotate screen, and respects reduced motion", () => {
    expect(css).toMatch(/\.tv-scav \{[\s\S]{0,200}z-index: 60;/);
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]{0,200}animation: none/);
  });
});

describe("Print it after a pick-up (kip-pickup.js)", () => {
  const pickup = read("../parts/kip/viewer/kip-pickup.js");
  it("the button is made, shown only with an outline and where printing is on, hidden when a new pick-up starts, and opens the panel", () => {
    expect(pickup).toContain("class: 'kpu-print'");
    expect(pickup).toContain("built.print.hidden = !(canPrintPlate && r.ok)");
    expect(pickup).toMatch(/\$\.print\.hidden = true; \/\/ its scan is gone/);
    expect(pickup).toContain("$.print.addEventListener('click', () => panel.open?.())");
    expect(pickup).toContain("built.print.remove()");
  });
});
