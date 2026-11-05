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
    // the win cheer: the world asks for the next variant (one-armed, alternating) just before it triggers the cheer
    // and a cheer that really started is played facing the screen (tests/face-user.test.ts pins that part)
    expect(world).toContain('function mixGo(a: MixAction,o?: {lift?: number;fade?: number;rate?: number;until?: number}){if(a==="cheer")CHEERS.roll();var ok=!!(mix&&!reduce&&P.rig&&mix.canDrive(P.rig)&&mix.trigger(a,o));');
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
    expect(world).toContain('"mallet"|"jump"|"shove"|"angel"|"pour"|"pick"|"smell"|"offer"|"sit_eat"|"swing"|"throw"){return mixGo(a as MixAction,a==="jump"?{lift:0,fade:.06}:a==="shove"?{fade:SHOVE_FADE_S,until:MOVES.shoveDur}:a==="angel"||a==="sit_eat"||a==="swing"?{fade:.4}:undefined)}');
    expect(acts).toContain('"pet" | "mallet" | "jump" | "shove" | "throw" | PlayAction): boolean;');
    expect(acts).toContain('w.clip("jump");');
  });
});

describe("foot slide as the game wires it (stops, key release, turns, the alert hover)", () => {
  it("tells the driver where the walk will stop, so its feet are together there", () => {
    expect(world).toContain("stopIn:(P.target&&!P.busy&&!P.showcase)?Math.max(0,Math.sqrt((P.target.x-P.pos.x)*(P.target.x-P.pos.x)+(P.target.z-P.pos.z)*(P.target.z-P.pos.z))-.07):undefined");
  });
  it("letting go of a movement key runs on a little to a stop (a target ahead of the toy) instead of stopping dead", () => {
    expect(world).toContain("var KEY_COAST=.6;");
    expect(world).toContain("if(!kd){if(P.kdLast&&!P.target&&!P.busy&&!P.showcase&&!P.mDrive&&P.speed>1.2)P.target=new T.Vector3(Math.max(kLo,Math.min(kHi,P.pos.x+P.kdLast*KEY_COAST)),0,P.pos.z);P.kdLast=0}else P.kdLast=kd;");
  });
  it("the alert hover is a bump that goes back to the ground (nHop, not a raise of P.hop nothing lowered), and a turn on the spot starts with a small hop (turnHop)", () => {
    expect(world).not.toContain("P.hop=Math.max(P.hop,nk*.12)");
    expect(world).toContain("P.nHop=nk*.12");
    expect(world).toContain("P.model.position.set(P.lunge,P.hop+(P.nHop||0)+(P.turnHop||0),0);");
    expect(world).toContain("var TURN_HOP=.1;");
    expect(world).toContain("P.turnHop=(S.type==='character'&&!reduce&&!P.busy&&!P.showcase&&sp<.6&&!(mix&&(mix.busyAction||mix.stepTurning)))?TURN_HOP*thk*thk*(3-2*thk):0;");
  });
});

describe("the step-turn as the game wires it (runtime/stepTurn.ts, mixamo.ts stepTurnFace, legIk.ts)", () => {
  it("a turn on the spot of more than 60 degrees gets its yaw from the driver's planner; the old fast easing is what is left otherwise", () => {
    expect(world).toContain('var stOk=!!(mix&&S.type==="character"&&!reduce&&!P.busy&&!P.showcase&&!P.mDrive&&sp<.6&&P.rig&&P.rig.type==="character"&&P.rig.snap&&!mix.busyAction&&!(P.target&&Math.abs(df)<.9)&&mix.canDrive(P.rig)),stFace=mix?mix.stepTurnFace(dt,P.face,P.tface,stOk):null;');
    expect(world).toContain("if(stFace!==null)P.face=stFace;else P.face+=df*Math.min(1,dt*10);");
  });
  it("the toy stands still while it steps round (no walking, no reversal hop), and a walk takes over when 50 degrees are left", () => {
    expect(world).toContain("function turnedToward(heading: number){if(mix&&mix.stepTurning)return 0;");
    expect(world).toContain("&&!P.busy&&!reduce&&!(mix&&mix.stepTurning))fx.push(");                    // the 0.2 hop when the direction flips
    expect(world).toContain("!(P.target&&Math.abs(df)<.9)");                                           // 0.9 rad is 52 degrees
  });
  it("a visit that has to turn to face its prop asks for the turn and waits for `facing`; only a few degrees are put right outright", () => {
    expect(world).toContain('face:function(d: number){var tf=d>0?0:Math.PI;P.tface=tf;');
    expect(world).toContain("Math.abs(((tf-P.face+Math.PI*3)%(Math.PI*2))-Math.PI)<.35)P.face=tf},facing:function(d: number){var tf=d>0?0:Math.PI;return Math.abs(((tf-P.face+Math.PI*3)%(Math.PI*2))-Math.PI)<.35},");
    expect(acts).toContain("facing: w.facing ? (d) => w.facing!(d) : undefined,");
  });
});

