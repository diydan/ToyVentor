// The jump and the shove as the game wires them (runtime/world.ts is one minified-style file: the pieces are checked by their text, and the behaviour by gameMoves.ts, the driver and the acts).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = new URL("..", import.meta.url).pathname;
const world = readFileSync(join(root, "src/features/game/world/runtime/world.ts"), "utf8");
const acts = readFileSync(join(root, "src/features/game/world/runtime/toyRoomActs.ts"), "utf8");

describe("the Mixamo moves in the world", () => {
  it("are loaded once the driver exists and put in its bank, and the shove's timing is taken from the real clip", () => {
    expect(world).toContain('import { SHOVE_FADE_S, loadMoves } from "./gameMoves";');
    expect(world).toContain("mix=new MixamoDriver({...b,...PROCEDURAL_CLIPS,...PLAY_CLIPS});startGestures();loadMoves({");
    expect(world).toContain("addClips:function(c: Record<string,BakedClip>){if(mix)mix.addClips(c)}");
    expect(world).toContain("MOVES.shoveContact=r.shoveContactS;MOVES.shoveDur=r.shoveDurationS");
    expect(world).toContain("var MOVES={shoveContact:.6,shoveDur:2.2};");
  });
  it("mixGo passes the options on to the driver", () => {
    // (the cheer-variant lane adds `if(a==="cheer")CHEERS.roll();` in front: allowed, not required)
    expect(world).toMatch(/function mixGo\(a: MixAction,o\?: \{lift\?: number;fade\?: number;rate\?: number;until\?: number\}\)\{(if\(a==="cheer"\)CHEERS\.roll\(\);)?return !!\(mix&&!reduce&&P\.rig&&mix\.canDrive\(P\.rig\)&&mix\.trigger\(a,o\)\)\}/);
  });
  it("the celebration hop (joy) plays the jump clip for a character and keeps the old sine hop for everything else (or until the clip is there)", () => {
    expect(world).toContain('var jumped=S.type==="character"&&mixGo("jump",{fade:.06,lift:.8});');                 // a big one: 80% of the clip's height (about 1.3 units)
    expect(world).toContain("if(!jumped)P.hop=.6*Math.sin(Math.PI*k);P.spin=Math.PI*2*k");
    expect(world).toContain("d:jumped?.93:.75");
  });
  it("the idle hop plays it too", () => {
    expect(world).toContain('if(c===0&&S.type==="character"&&mixGo("jump",{fade:.06,lift:.45}))return;');         // a small one for a fidget: 45% (about 0.7 units)
  });
  it("the Shove ability plays the shove clip, lands its effect when the arms are out, and falls back to the old lunge", () => {
    const m = /torque:async function\(\)\{([\s\S]*?)\},\n speed:/.exec(world);
    expect(m).not.toBeNull();
    const body = m![1]!;
    expect(body).toContain('var pushed=S.type==="character"&&mixGo("shove",{fade:SHOVE_FADE_S,until:MOVES.shoveDur});');       // the real push from its first frame, ended by the driver's own ease-out
    expect(body).toContain("if(pushed)await sleep(MOVES.shoveContact*1000);sfx.shove();");
    expect(body).toContain("var lunge=pushed?.3:.7;");
    expect(body).toContain("reveal(s)");
    expect(body).toContain("(MOVES.shoveDur-MOVES.shoveContact)*1000-420");
    expect(body.indexOf("sfx.shove()")).toBeLessThan(body.indexOf("reveal(s)"));          // the shove lands, then the spots show
  });
  it("the cushion act's clip is played without the clip's own lift (the act's path lifts Kip) and with a sudden take-off", () => {
    expect(world).toContain('"mallet"|"jump"|"shove"|"angel"|"pour"|"pick"|"smell"|"offer"|"sit_eat"|"swing"){return mixGo(a as MixAction,a==="jump"?{lift:0,fade:.06}:a==="shove"?{fade:SHOVE_FADE_S,until:MOVES.shoveDur}:a==="angel"||a==="sit_eat"||a==="swing"?{fade:.4}:undefined)}');
    expect(acts).toContain('"pet" | "mallet" | "jump" | "shove" | PlayAction): boolean;');
    expect(acts).toContain('w.clip("jump");');
  });
});
