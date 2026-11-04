import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MESS_PROMPT_LINES } from "../src/features/game/world/runtime/messLines";
import { SCENE_PROMPTS } from "../src/lib/scenePrompts";

// The Toy Room mess mini-interactions: how they are wired into the game (the behaviour is in tests/mess.test.ts, tests/mess-parts.test.ts, tests/mess-model.test.ts and, in a real browser, scripts/e2e-game-mess.mjs).
const root = path.join(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const world = read("src/features/game/world/runtime/world.ts");
const mess = read("src/features/game/world/runtime/mess.ts");

describe("wiring in world.ts", () => {
  it("the mess is created with the stage's own element, the reduced-motion flag and the game's voice and toast, and its clips and mop go through the same mixer and held-item code as the other acts", () => {
    expect(world).toContain("var MESS=createMess({root:function(){return W.root},host:function(){return hostEl},reduced:function(){return reduce},say:say,toast:function(s: string){toast(s)},");
    expect(world).toContain('clip:function(a: "oops"|"mop"|"tidy"|"cheer"){return mixGo(a as MixAction)}');
    expect(world).toContain('hold:function(i: "mop"){HELD.hold(i,P.model,P.rig&&P.rig.arms&&P.rig.arms[1],P.rig&&P.rig.arms&&P.rig.arms[0])}');
    expect(world).toContain("run:function(v: any){return ACTS.run(v)}");
  });
  it("hands the mess to the acts, updates it every frame, and puts it right with the world", () => {
    expect(world).toContain('mess:{visitFor:function(k: "spill"|"dump",i: any){return MESS.visitFor(k,i)}}');
    expect(world).toContain("PFX.update(dt,t);MESS.update(dt);");
    expect(world).toContain("PFX.reset();MESS.reset();");                       // (before the acts are reset: a mopping cut short by that reset must not bring the card back, see tests/mess.test.ts)
    expect(world).toContain("acts:ACTS,mess:MESS,");
  });
  it("builds the two props", () => {
    expect(world).toContain("cup:function(x,z){return add(buildCupTable(x,z))},toybox:function(x,z){return add(buildToyBox(x,z))}");
  });
  it("speaks only through `say:say` (a reference, not a call), so tests/scene-prompts.test.ts's list of world.ts's spoken call sites is unchanged", () => {
    const withoutSayT = world.replace("function sayT(t: string){toast(t);say(t)}", "");                      // (the twin's own definition, which tests/scene-prompts.test.ts also sets aside)
    expect([...withoutSayT.matchAll(/(?<![A-Za-z0-9_$.])say\(([^()]*)\)/g)].map((m) => m[1])).toEqual(["wtxt", "wtxt2"]);   // the win lines, exactly as before
  });
});

describe("what mess.ts says", () => {
  it("only ever says the three lines of the closed list, by their constants", () => {
    const calls = [...mess.matchAll(/w\.say\(([^()]*)\)/g)].map((m) => m[1]);
    expect(new Set(calls)).toEqual(new Set(["OH_NO", "CLEAN_Q", "ALL_CLEAN"]));
    for (const l of MESS_PROMPT_LINES) expect(SCENE_PROMPTS.some((p) => p.text === l), l).toBe(true);
  });
  it("shows every spoken line as text: 'Oh no, oh no!' and 'All clean! Hooray!' as a toast (and the question on the card), so a muted game loses nothing", () => {
    expect(mess).toContain("const ohNo = () => { w.say(OH_NO); w.toast(OH_NO); };");
    expect(mess).toContain("w.say(ALL_CLEAN); w.toast(ALL_CLEAN);");
    expect(read("src/features/game/world/runtime/messPrompt.ts")).toContain("q.textContent = CLEAN_Q;");
  });
  it("never uses the phone's own voice, a network call or storage", () => {
    for (const f of ["mess.ts", "messModel.ts", "messLines.ts", "messScene.ts", "messPrompt.ts", "mop.ts"]) {
      const src = read(`src/features/game/world/runtime/${f}`);
      expect(src, f).not.toMatch(/speechSynthesis|SpeechSynthesisUtterance|fetch\(|localStorage|sessionStorage|XMLHttpRequest|WebSocket/);
    }
  });
  it("the card is styled inline: no stylesheet and no change to the stage's CSS", () => {
    const src = read("src/features/game/world/runtime/messPrompt.ts");
    expect(src).toContain("style.cssText");
    expect(src).not.toMatch(/createElement\("style"\)|<style|STAGE_CSS/);
  });
});

describe("the prompt list generator knows the lines", () => {
  it("scripts/lib/scene-prompts-enum.ts adds MESS_PROMPT_LINES, so `scene-prompts.ts --check` fails if they drift", () => {
    const src = read("scripts/lib/scene-prompts-enum.ts");
    expect(src).toContain('import { MESS_PROMPT_LINES } from "../../src/features/game/world/runtime/messLines";');
    expect(src).toContain('for (const line of MESS_PROMPT_LINES) add(line, "mess:toy-room");');
  });
});

describe("the acts run the mess", () => {
  it("a cup tap and a toy box tap are acts, and a visit can be started from the Clean button", () => {
    const acts = read("src/features/game/world/runtime/toyRoomActs.ts");
    expect(acts).toContain('cup: "spill", toybox: "dump"');
    expect(acts).toContain("run(visit: Visit): boolean");
    expect(acts).toContain('kind === "spill" || kind === "dump" ? w.mess?.visitFor(kind, inst) ?? null');
  });
});
