// The places the game's Snap rig, the joint-driven clips and the idle behaviours plug into the rest of the game (docs/specs/dance-party-spec.md 6.10). The behaviour is tested where it lives
// (tests/snap-flex*.test.ts, tests/idle-behavior.test.ts, scripts/e2e-game-dance-rig.mjs, scripts/e2e-game-idle.mjs); what is here is what could silently rot between them.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { jointClipToGame, parseJointClip } from "../src/features/game/world/runtime/bakedDance";

const root = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const world = () => read("src/features/game/world/runtime/world.ts");

describe("joint data is opt-in, so nobody's clip changes by accident", () => {
  const raw = JSON.parse(read("public/kip/mixamo/baked/dance_hiphop.json"));
  it("jointClipToGame gives the clip it always gave unless asked for the joints, and the joints and the planted flag when asked", () => {
    const j = parseJointClip(raw)!;
    const plain = jointClipToGame(j, "x");
    expect(plain.joints).toBeUndefined();
    expect(plain.planted).toBeUndefined();
    const full = jointClipToGame(j, "x", { joints: true });
    expect(full.joints).toBeTruthy();
    expect(full.planted).toBe(true);
    // the direction channels are the same either way (they are the fallback for a rig that cannot bend)
    for (const k of ["hips", "body", "head", "armL", "armR", "legL", "legR"] as const) expect(Array.from(full[k])).toEqual(Array.from(plain[k]));
  });
  it("the jump, the shove and the idle, walk and run (gameMoves.ts) ask for them too: the toy bends its elbows and knees for every move it makes, and none of them is cut or sped up", () => {
    const f = "src/features/game/world/runtime/gameMoves.ts";
    if (!existsSync(join(root, f))) return; // not in this tree
    const src = read(f);
    expect(src.match(/jointClipToGame\([^)]*\{ joints: true \}\)/g)?.length).toBeGreaterThanOrEqual(3);          // jump, shove, and the loop over the three cycles
    expect(src).not.toMatch(/cutClip|joinClips|easeSeam|SHOVE_RATE/);
  });
  it("the party's dances and the idle clips do ask for them", () => {
    expect(read("src/features/game/world/runtime/gameDances.ts")).toContain("jointClipToGame(joint, id, { joints: true })");
    expect(read("src/features/game/world/runtime/idleBehavior.ts")).toContain("jointClipToGame(joint, id, { joints: true })");
  });
});

describe("the rig and the driver", () => {
  it("the loader builds the bench's joint chain for the Snap limbs and hands it to the driver as rig.snap", () => {
    const f = read("src/features/game/world/runtime/stlRigLoader.ts");
    expect(f).toContain("makeFlexLimb(geos.snapArm!");
    expect(f).toContain("makeFlexLimb(geos.snapLeg!");
    expect(f).toContain("rig.snap = {");
    // what Kip holds is attached to rig.arms[i] (the holder) and must go with the bent hand: a counter group between the holder and the sleeve, and the hand-follow handed to the driver
    expect(f).toContain("handCounter.add(armCad);");
    expect(f).toContain("swingHolder.add(handCounter);");
    expect(f).toContain("follow: makeHandFollow(swingHolder, handCounter, handJoint)");
    // at rest the boot sits where it always did: hip-relative (0, -61.5, 2)
    expect(f).toContain("bootMesh.position.set(0, -KIP_HIP_MM + 39.6, 2.0 + 1.5)");
  });
  it("the driver poses the Snap limbs after it has posed the rig from the directions, and grounds only planted clips", () => {
    const m = read("src/features/game/world/runtime/mixamo.ts");
    expect(m.indexOf("this.apply(j, p);")).toBeLessThan(m.indexOf("this.applyJoints(j, p);"));
    expect(m).toContain("if (on && p.gw * jw > 0.001) this.ground(j, sn, p.gw * jw);");
    expect(m).toContain("if (j.snap) resetSnapRig(j.snap);");
    // the holder goes with the hand while the pose is in force, and is exactly home on the faded-out frame
    expect(m).toContain("if (on) followHand(h, j.arms[i]!.quaternion);");
    expect(m).toContain("else releaseHand(h);");
  });
});

describe("the world's idle behaviours", () => {
  it("the idle tick asks for a wave, a clap or a dance first, counts the ticks of one spell of standing still, and the count starts again when he moves", () => {
    const w = world();
    expect(w).toContain('function idleAct(){P.idleN=(P.idleN||0)+1;if(S.type==="character"&&IDLEB.tryStart(P.idleN-1))return;');
    expect(w).toContain("else{P.idleT=0;P.idleN=0}");
  });
  it("it runs every frame, a tap cancels it, Play stops the title's show, and the clips and the show start once the driver exists", () => {
    const w = world();
    expect(w.indexOf("IDLEB.update();")).toBeGreaterThan(0);
    expect(w.indexOf("IDLEB.update();")).toBeLessThan(w.indexOf("if(driven&&mix){mix.update("));
    expect(w).toMatch(/canvas\.addEventListener\("pointerdown",function\(e: PointerEvent\)\{ctx\(\);IDLEB\.cancel\(\);/);
    expect(w).toMatch(/function startPlay\(build: boolean\)\{if\(!P\.title\)return;P\.title=false;IDLEB\.stopShow\(\);/);
    expect(w).toMatch(/mix=new MixamoDriver\(\{\.\.\.b,\.\.\.PROCEDURAL_CLIPS[^}]*\}\);startGestures\(\)/); // other lanes add their own clip sets to the same call: anything between the braces
    expect(w).toContain("if(P.title&&!reduce)IDLEB.startShow()");
  });
  it("he is free to do something on his own only when nothing is going on: standing still, nothing in his hands, no sheet open, motion not reduced, not the title or the editor", () => {
    const w = world();
    const ok = w.slice(w.indexOf("function idleOk(){"), w.indexOf("function startGestures(){"));
    for (const need of ["!reduce", 'S.type==="character"', "!HELD.item", "!P.showcase", "!P.busy", "!P.mDrive", "!P.target", "P.speed<.1", "!ED.on", "!paused", 'hostEl.classList.contains("building")', "mix.canDrive(P.rig)"]) expect(ok, need).toContain(need);
  });
  it("a behaviour turns him to face the camera the way the party's dance does, and the world turns him back when the dance is over", () => {
    const w = world();
    expect(w).toContain("begin:function(){if(P.danceBack==null){P.danceBack=P.tface;P.tface=-Math.PI/2}}");
    expect(w).toContain('if(P.danceBack!=null&&!(mix&&(mix.busyAction==="dance"||mix.busyAction===IDLE_LABEL)))'); // the existing restore: a dance, and now an idle behaviour, keep him facing the camera
    // the camera push is for the party's dance alone: an idle wave turns him to the camera but never moves it (a push shifted everything on screen and failed e2e-game-mess's framing check)
    expect(w).toContain('var pushT=mix&&mix.busyAction==="dance"?DANCE_PUSH:1;');
  });
});
