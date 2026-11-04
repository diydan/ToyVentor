// Kip faces the player (runtime/faceUser.ts): after a few seconds of standing free he turns to the screen, turns back when he is asked to do something, never fights a dance or a
// clip for the facing, and a win cheer is played facing the screen. Dan, 2026-11-04: "Kip looks left and right but never towards the user?"
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FACE_CAMERA, FACE_USER_AFTER_S, createFaceUser, facingCamera } from "../src/features/game/world/runtime/faceUser";

const LEFT = Math.PI, RIGHT = 0;
/** Run `seconds` of frames at 60 fps in `mode`, returning every facing the machine asked for. */
function run(fu: ReturnType<typeof createFaceUser>, seconds: number, mode: "free" | "away" | "owned", tface: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < Math.round(seconds * 60); i++) { const r = fu.step(1 / 60, mode, tface); if (r !== null) { out.push(r); tface = r; } }
  return out;
}

describe("facingCamera", () => {
  it("knows the screen however the angle is written", () => {
    expect(facingCamera(FACE_CAMERA)).toBe(true);
    expect(facingCamera(Math.PI * 1.5)).toBe(true);
    expect(facingCamera(-Math.PI / 2 - Math.PI * 2)).toBe(true);
    for (const a of [0, Math.PI, Math.PI / 2, 1, -1]) expect(facingCamera(a)).toBe(false);
  });
});

describe("standing free", () => {
  it("does nothing for the first moments, then turns once, to the screen", () => {
    const fu = createFaceUser(() => 0); // the shortest wait
    expect(run(fu, FACE_USER_AFTER_S[0] - 0.1, "free", LEFT)).toEqual([]);
    expect(fu.turned).toBe(false);
    expect(run(fu, 0.3, "free", LEFT)).toEqual([FACE_CAMERA]);
    expect(fu.turned).toBe(true);
  });
  it("the wait is drawn between the two bounds, and a bad draw still turns him", () => {
    for (const [r, secs] of [[0, 2.5], [0.999999, 4.5], [Number.NaN, 3.5]] as const) {
      const fu = createFaceUser(() => r);
      expect(run(fu, secs - 0.05, "free", LEFT), `rng ${r}`).toEqual([]);
      expect(run(fu, 0.2, "free", LEFT), `rng ${r}`).toEqual([FACE_CAMERA]);
    }
  });
  it("turns once and then leaves him alone, however long he stands", () => {
    const fu = createFaceUser(() => 0);
    let face = RIGHT;
    const first = run(fu, 3, "free", face);
    face = first[0]!;
    expect(run(fu, 60, "free", face)).toEqual([]);
  });
  it("a Kip who is already looking at the screen (a cheer, a dance that ended) is not turned again and has nothing to turn back to", () => {
    const fu = createFaceUser(() => 0);
    expect(run(fu, 10, "free", FACE_CAMERA)).toEqual([]);
    expect(fu.turned).toBe(false);
    expect(run(fu, 0.1, "away", FACE_CAMERA)).toEqual([]);
  });
  it("ignores a frame time that is not a number", () => {
    const fu = createFaceUser(() => 0);
    for (const dt of [Number.NaN, -1, 0, Infinity]) expect(fu.step(dt, "free", LEFT)).toBeNull();
  });
});

describe("being asked to do something", () => {
  it("turns him back to the way he was facing, once", () => {
    const fu = createFaceUser(() => 0);
    run(fu, 3, "free", LEFT);
    expect(fu.step(1 / 60, "away", FACE_CAMERA)).toBe(LEFT);
    expect(fu.turned).toBe(false);
    expect(fu.step(1 / 60, "away", LEFT)).toBeNull();
  });
  it("leaves a walk alone: walking sets its own facing, so there is nothing to undo", () => {
    const fu = createFaceUser(() => 0);
    run(fu, 3, "free", LEFT);
    expect(fu.step(1 / 60, "away", RIGHT)).toBeNull(); // he already turned to walk right
    expect(fu.turned).toBe(false);
  });
  it("starts a fresh wait after he moves, so he turns to you again the next time he stops", () => {
    const fu = createFaceUser(() => 0);
    run(fu, 3, "free", LEFT);
    fu.step(1 / 60, "away", RIGHT);
    expect(run(fu, 2, "free", RIGHT)).toEqual([]);
    expect(run(fu, 1, "free", RIGHT)).toEqual([FACE_CAMERA]);
  });
  it("an interruption in the middle of the wait starts it again", () => {
    const fu = createFaceUser(() => 0);
    run(fu, 2.2, "free", LEFT);
    fu.step(1 / 60, "away", LEFT);
    expect(run(fu, 2.2, "free", LEFT)).toEqual([]);
  });
});

describe("somebody else has the facing", () => {
  it("a dance, an idle gesture, a clip, the title or the Create screen is never fought, before or after the turn", () => {
    const fu = createFaceUser(() => 0);
    expect(run(fu, 30, "owned", LEFT)).toEqual([]);
    run(fu, 3, "free", LEFT); // turned to the screen
    expect(fu.step(1 / 60, "owned", FACE_CAMERA)).toBeNull(); // a dance starts: no turn back in the middle of it
    expect(fu.turned).toBe(false);
    expect(fu.step(1 / 60, "away", FACE_CAMERA)).toBeNull(); // and nothing is remembered for afterwards
  });
  it("what it remembers goes stale when something else turns him (a new world), and he can turn to you again", () => {
    const fu = createFaceUser(() => 0);
    run(fu, 3, "free", LEFT);
    expect(fu.turned).toBe(true);
    expect(run(fu, 0.5, "free", RIGHT)).toEqual([]); // set to face right by a world switch
    expect(fu.turned).toBe(false);
    expect(run(fu, 3, "free", RIGHT)).toEqual([FACE_CAMERA]);
  });
  it("reset forgets everything", () => {
    const fu = createFaceUser(() => 0);
    run(fu, 3, "free", LEFT);
    fu.reset();
    expect(fu.turned).toBe(false);
    expect(fu.step(1 / 60, "away", FACE_CAMERA)).toBeNull();
  });
});

describe("how the world uses it", () => {
  const world = readFileSync(new URL("../src/features/game/world/runtime/world.ts", import.meta.url), "utf8");
  it("steps it every frame for the character only, owned by anything that owns the facing, free only when he is idle, away otherwise", () => {
    const m = /if\(S\.type==="character"\)\{var fnew=FACEU\.step\(dt,\(([^)]*(?:\([^)]*\))?[^)]*)\)\?"owned":idleOk\(\)\?"free":"away",P\.tface\);if\(fnew!==null\)P\.tface=fnew\}/.exec(world);
    expect(m, "the frame step").not.toBeNull();
    for (const owner of ["P.showcase", "P.danceBack!=null", "P.mDrive", "ED.on", "paused", "ACT.active", "ACTS.busy", "SLEEPH.busy", 'MESS.phase!=="idle"', "mix.busyAction"]) expect(m![1], owner).toContain(owner);
    expect(world).toContain("var FACEU=createFaceUser(Math.random);");
    expect(world).toContain('import { createFaceUser } from "./faceUser";');
  });
  it("a win cheer is played facing the screen, only when the clip really started and only for the character", () => {
    expect(world).toContain('if(ok&&a==="cheer"&&S.type==="character"&&!P.showcase)P.tface=-Math.PI/2;return ok');
  });
  it("turning to the screen is not a change of direction: no turn-around hop", () => {
    expect(world).toContain("var dirNow=Math.abs(P.tface+Math.PI/2)<1e-6?(P.lastDir||1):(Math.cos(P.tface)>0?1:-1);");
  });
});
