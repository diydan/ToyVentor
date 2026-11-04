import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ARRIVE, ENGAGE_X, FOLLOW_GAP, FOLLOW_START, SIT_AFTER_S, SPOT_COUNT, SPOT_STEP, TROT_SPEED, createFollow } from "../src/features/game/world/runtime/dogFollow";
import { DOG_BOUNDS } from "../src/features/game/world/runtime/dogFetch";

/** It stops once it is within ARRIVE of its mark, so the gap it leaves is FOLLOW_GAP minus up to ARRIVE. */
const gapOk = (gap: number) => expect(Math.abs(gap - FOLLOW_GAP)).toBeLessThanOrEqual(ARRIVE + 1e-6);

function world(opts: { dog?: number | null; toy?: number } = {}) {
  const none = opts.dog === null;
  const s = { dog: opts.dog ?? 20, toy: opts.toy ?? 2, still: true, allowed: true, occupied: (_x: number) => false };
  const log: string[] = [];
  const moves: Array<{ x: number; dir: number }> = [];
  const f = createFollow({
    dogX: () => (none ? null : s.dog),
    toyX: () => s.toy,
    toyStill: () => s.still,
    occupied: (x) => s.occupied(x),
    moveDog: (x, dir) => { s.dog = x; moves.push({ x, dir }); },
    cue: (n) => { log.push(n); },
    allowed: () => s.allowed,
  });
  const run = (seconds: number, dt = 1 / 60) => { for (let t = 0; t < seconds - 1e-9; t += dt) f.update(dt); };
  /** Kip walks to x (at a walking pace), updating as it goes. */
  const walkTo = (x: number, speed = 3.5) => {
    s.still = false;
    for (let k = 0; k < 6000 && Math.abs(s.toy - x) > 1e-6; k++) { const d = x - s.toy; s.toy += Math.sign(d) * Math.min(Math.abs(d), speed / 60); f.update(1 / 60); }
    s.still = true;
  };
  return { s, f, log, moves, run, walkTo };
}

describe("meeting the dog", () => {
  it("with no dog in the room it does nothing at all", () => {
    const w = world({ dog: null });
    w.run(10);
    expect(w.f.phase).toBe("home");
    expect(w.log).toEqual([]);
    expect(w.moves).toEqual([]);
  });

  it("stays at home while Kip is far away: it does not run across the room at the start", () => {
    const w = world({ dog: 42, toy: 2 });
    w.run(30);
    expect(w.f.phase).toBe("home");
    expect(w.f.engaged).toBe(false);
    expect(w.moves).toEqual([]);
    expect(w.log).toEqual([]);
    w.walkTo(20);                                                         // Kip walks about the room, still not near it
    expect(w.f.phase).toBe("home");
    expect(w.moves).toEqual([]);
  });

  it("when Kip first comes close it is delighted (one happy cue) and from then on follows", () => {
    const w = world({ dog: 42, toy: 2 });
    w.walkTo(42 - ENGAGE_X - 0.5);
    expect(w.f.phase).toBe("home");
    w.walkTo(42 - ENGAGE_X + 0.2);
    expect(w.f.phase).toBe("standing");
    expect(w.f.engaged).toBe(true);
    expect(w.log).toEqual(["happy"]);
    w.run(0.5);
    expect(w.log.filter((c) => c === "happy")).toHaveLength(1);
  });

  it("does not meet it while something else has it (a fetch, an act): it waits until it is free", () => {
    const w = world({ dog: 20, toy: 19 });
    w.s.allowed = false;
    w.run(5);
    expect(w.f.phase).toBe("home");
    expect(w.log).toEqual([]);
    w.s.allowed = true;
    w.run(0.1);
    expect(w.f.phase).toBe("standing");
    expect(w.log).toEqual(["happy"]);
  });
});

describe("the places it chooses", () => {
  it("even the furthest is well inside FOLLOW_START, so a dog standing there does not count as far from Kip and set off again", () => {
    const furthest = FOLLOW_GAP + SPOT_STEP * Math.floor((SPOT_COUNT - 1) / 2);
    expect(furthest).toBeLessThan(FOLLOW_START - 0.3);
    expect(FOLLOW_GAP).toBeLessThan(furthest + 1e-9);
  });
  it("the dog that has run out of places settles at the last one and stays: one trot, no cycling", () => {
    const w = world({ dog: 30, toy: 28.5 });
    w.run(0.1);
    w.s.occupied = () => true;
    w.s.toy = 25;
    w.run(30);
    expect(w.log.filter((c) => c === "run")).toHaveLength(1);
    expect(w.f.phase === "standing" || w.f.phase === "sitting").toBe(true);
  });
});

describe("sitting", () => {
  it("when Kip has stood still by it for a while it sits, facing Kip, once", () => {
    const w = world({ dog: 20, toy: 18.5 });
    w.run(SIT_AFTER_S - 0.3);
    expect(w.f.phase).toBe("standing");
    expect(w.log).toEqual(["happy"]);
    w.run(0.6);
    expect(w.f.phase).toBe("sitting");
    expect(w.log).toEqual(["happy", "sit"]);
    expect(w.moves.at(-1)!.dir).toBe(-1);                                 // Kip is to its left
    const n = w.moves.length;
    w.run(5);
    expect(w.log).toEqual(["happy", "sit"]);                              // one cue, not one a frame
    expect(w.moves).toHaveLength(n);
    expect(w.s.dog).toBe(20);
  });

  it("faces Kip whichever side Kip is on", () => {
    const w = world({ dog: 20, toy: 21.5 });
    w.run(SIT_AFTER_S + 0.5);
    expect(w.f.phase).toBe("sitting");
    expect(w.moves.at(-1)!.dir).toBe(1);
  });

  it("does not sit while Kip keeps moving about close by: the clock starts over", () => {
    const w = world({ dog: 20, toy: 18.5 });
    for (let k = 0; k < 6; k++) { w.s.still = false; w.run(1); w.s.still = true; w.run(SIT_AFTER_S - 0.4); }
    expect(w.f.phase).toBe("standing");
    expect(w.log).not.toContain("sit");
  });

  it("gets up when Kip walks again (without trotting: Kip is still close)", () => {
    const w = world({ dog: 20, toy: 18.5 });
    w.run(SIT_AFTER_S + 0.5);
    expect(w.f.phase).toBe("sitting");
    w.s.still = false;
    w.run(0.1);
    expect(w.f.phase).toBe("standing");
    expect(w.log.at(-1)).toBe("idle");
    expect(w.s.dog).toBe(20);
  });
});

describe("trotting after Kip", () => {
  const meet = () => { const w = world({ dog: 20, toy: 18.5 }); w.run(0.1); return w; };

  it("when Kip walks off, the dog trots after it, stays behind it (opposite to the way Kip walked) and stops FOLLOW_GAP short of it", () => {
    const w = meet();
    w.walkTo(5);
    w.run(8);
    expect(w.log).toContain("run");
    expect(w.s.dog).toBeGreaterThan(5);                                   // it stayed on its side of Kip (behind it, to the right)
    gapOk(w.s.dog - 5);
    expect(w.f.phase === "standing" || w.f.phase === "sitting").toBe(true);
  });

  it("it only sets off once Kip is more than FOLLOW_START away: a short stroll does not move it", () => {
    const w = meet();
    w.walkTo(20 - FOLLOW_START + 0.3);
    w.run(2);
    expect(w.log).not.toContain("run");
    expect(w.s.dog).toBe(20);
    w.walkTo(20 - FOLLOW_START - 0.5);
    expect(w.log).toContain("run");
  });

  it("it never runs faster than TROT_SPEED, and slows down for the last stretch", () => {
    const w = meet();
    w.s.toy = 5;
    const xs: number[] = [w.s.dog];
    for (let k = 0; k < 60 * 8; k++) { w.f.update(1 / 60); xs.push(w.s.dog); }
    const steps = xs.slice(1).map((x, i) => Math.abs(x - xs[i]!));
    expect(Math.max(...steps)).toBeLessThanOrEqual(TROT_SPEED / 60 + 1e-9);
    expect(Math.max(...steps)).toBeGreaterThan(TROT_SPEED / 60 - 1e-9);   // it did reach full speed
    const moving = steps.filter((d) => d > 1e-9);
    expect(moving.at(-1)!).toBeLessThan(TROT_SPEED / 60 / 2);             // and eased off at the end
    expect(Math.abs(xs.at(-1)! - (5 + FOLLOW_GAP))).toBeLessThanOrEqual(ARRIVE);
  });

  it("it never overshoots where it is going to", () => {
    const w = meet();
    w.s.toy = 5;
    for (let k = 0; k < 60 * 8; k++) { w.f.update(1 / 60); expect(w.s.dog).toBeGreaterThanOrEqual(5 + FOLLOW_GAP - ARRIVE - 1e-9); }
  });

  it("it runs facing the way it is going, then turns to Kip and, when Kip stays still, sits", () => {
    const w = meet();
    w.walkTo(5);
    w.run(6);
    const runMoves = w.moves.filter((m) => m.dir === -1);
    expect(runMoves.length).toBeGreaterThan(10);                          // running to the left, facing left
    expect(w.log).toEqual(["happy", "run", "idle", "sit"]);
    expect(w.f.phase).toBe("sitting");
  });

  it("when Kip walks on while it is trotting, it keeps going: the goal moves with Kip", () => {
    const w = meet();
    w.s.toy = 8;
    w.run(0.5);
    expect(w.f.phase).toBe("trotting");
    w.s.toy = 3;                                                          // Kip moves on before it gets there
    w.run(0.5);
    expect(w.f.phase).toBe("trotting");
    w.run(8);
    gapOk(w.s.dog - 3);
  });

  it("behind means behind: when Kip walks right it ends up on Kip's left, even if it had to run past Kip to get there", () => {
    const w = world({ dog: 20, toy: 21.5 });
    w.run(0.1);
    w.walkTo(35);
    w.run(8);
    gapOk(35 - w.s.dog);
    expect(w.s.dog).toBeLessThan(35);
    const ahead = world({ dog: 20, toy: 17 });                          // the dog is AHEAD of Kip, and Kip walks right, past it
    ahead.run(0.1);
    ahead.walkTo(30);
    ahead.run(8);
    gapOk(30 - ahead.s.dog);
    expect(ahead.s.dog).toBeLessThan(30);
  });

  it("when a prop stands where it would stop it tries the other side of Kip", () => {
    const w = meet();
    w.s.occupied = (x) => Math.abs(x - (5 + FOLLOW_GAP)) < 1;            // a prop where it would stand (to Kip's right)
    w.walkTo(5);
    w.run(10);
    gapOk(5 - w.s.dog);                                                  // it is on Kip's left instead
    expect(w.s.dog).toBeLessThan(5);
    expect(w.f.phase === "standing" || w.f.phase === "sitting").toBe(true);
  });
  it("with props on both sides it stands a little further out, on the first side that is free", () => {
    const w = meet();
    w.s.occupied = (x) => Math.abs(x - (5 + FOLLOW_GAP)) < 1 || Math.abs(x - (5 - FOLLOW_GAP)) < 1;
    w.walkTo(5);
    w.run(15);
    expect(Math.abs(w.s.dog - 5 - (FOLLOW_GAP + SPOT_STEP))).toBeLessThanOrEqual(ARRIVE + 1e-6);   // behind Kip (to its right) but one step further out
    expect(w.f.phase === "standing" || w.f.phase === "sitting").toBe(true);
  });
  it("the choices of place go behind, in front, behind further out, in front further out, and so on; the last is taken without asking", () => {
    const w = world({ dog: 30, toy: 28.5 });
    w.run(0.1);
    const asked: number[] = [];
    w.s.occupied = (x) => { asked.push(+(x - 25).toFixed(1)); return true; };
    w.s.toy = 25;                                                         // Kip moves left (all at once, so the places do not shift under it): behind it is to its right
    w.run(40);
    const seq = asked.filter((v, i) => i === 0 || v !== asked[i - 1]);
    expect(seq).toHaveLength(SPOT_COUNT - 1);
    expect(seq.map((v) => Math.sign(v))).toEqual([1, -1, 1]);
    for (let k = 2; k < seq.length; k++) expect(Math.abs(seq[k]!)).toBeGreaterThan(Math.abs(seq[k - 2]!));
    expect(w.s.dog - 25).toBeCloseTo(-(FOLLOW_GAP + SPOT_STEP), 0);      // and it ended at the last place: in front of Kip, furthest out, and settled there (it did not set off again)
    expect(w.f.phase === "standing" || w.f.phase === "sitting").toBe(true);
  });
  it("every trot gets its own go at the choices: a prop in the way the second time is avoided too", () => {
    const w = meet();
    w.s.occupied = (x) => Math.abs(x - (5 + FOLLOW_GAP)) < 1 || Math.abs(x - (25 - FOLLOW_GAP)) < 1;
    w.walkTo(5);
    w.run(10);
    gapOk(5 - w.s.dog);                                                  // first trot: Kip's left
    w.walkTo(25);
    w.run(10);
    gapOk(w.s.dog - 25);                                                 // second trot: its place (Kip's left) has a prop, so it is on Kip's right
  });
  it("it does not go back and forth when every place has a prop: it runs out of choices and stays at the last", () => {
    const w = meet();
    w.s.occupied = () => true;
    w.walkTo(5);
    w.run(40);
    expect(w.f.phase === "standing" || w.f.phase === "sitting").toBe(true);
    const at = w.s.dog;
    w.run(5);
    expect(w.s.dog).toBe(at);
  });
  it("when its place is free it does not change sides", () => {
    const w = meet();
    w.walkTo(5);
    w.run(10);
    gapOk(w.s.dog - 5);
    expect(w.s.dog).toBeGreaterThan(5);
  });

  it("it gets up and trots again when Kip leaves it sitting and walks far away", () => {
    const w = meet();
    w.run(SIT_AFTER_S + 0.5);
    expect(w.f.phase).toBe("sitting");
    w.walkTo(2);
    w.run(8);
    expect(w.log.filter((c) => c === "run").length).toBeGreaterThanOrEqual(1);
    gapOk(w.s.dog - 2);
  });

  it("it never goes outside the room", () => {
    const w = world({ dog: 2, toy: 3 });
    w.run(0.1);
    w.walkTo(-20);
    w.run(8);
    expect(w.s.dog).toBeGreaterThanOrEqual(DOG_BOUNDS[0] - 1e-9);
    const v = world({ dog: 42, toy: 41 });
    v.run(0.1);
    v.walkTo(80);
    v.run(8);
    expect(v.s.dog).toBeLessThanOrEqual(DOG_BOUNDS[1] + 1e-9);
  });
});

describe("when something else has the dog", () => {
  it("a trot stops at once (it stands), nothing moves while it is busy, and afterwards it follows again if Kip is far", () => {
    const w = world({ dog: 20, toy: 18.5 });
    w.run(0.1);
    w.s.toy = 5;
    w.run(1);
    expect(w.f.phase).toBe("trotting");
    w.s.allowed = false;
    w.run(0.1);
    expect(w.f.phase).toBe("standing");
    expect(w.log.at(-1)).toBe("idle");
    const at = w.s.dog, n = w.moves.length;
    w.run(3);
    expect(w.s.dog).toBe(at);
    expect(w.moves).toHaveLength(n);
    w.s.allowed = true;
    w.run(8);
    gapOk(w.s.dog - 5);
  });

  it("a sitting dog is left alone while busy, and starts its sitting clock again afterwards", () => {
    const w = world({ dog: 20, toy: 18.5 });
    w.run(SIT_AFTER_S + 0.5);
    expect(w.f.phase).toBe("sitting");
    w.s.allowed = false;
    w.run(0.1);
    expect(w.f.phase).toBe("standing");
    w.s.allowed = true;
    w.run(SIT_AFTER_S + 0.3);
    expect(w.f.phase).toBe("sitting");
  });
});

describe("reset", () => {
  it("forgets Kip: back at home, stands about, and has to meet Kip again", () => {
    const w = world({ dog: 20, toy: 18.5 });
    w.run(SIT_AFTER_S + 0.5);
    w.f.reset();
    expect(w.f.phase).toBe("home");
    expect(w.f.engaged).toBe(false);
    expect(w.log.at(-1)).toBe("idle");
    w.s.toy = 2;
    w.run(5);
    expect(w.s.dog).toBe(20);                                             // far from Kip: it stays
    w.s.toy = 19;
    w.run(0.1);
    expect(w.f.engaged).toBe(true);
  });
  it("is harmless when it never did anything", () => {
    const w = world();
    w.f.reset();
    expect(w.log).toEqual([]);
  });
});

describe("odd frame times", () => {
  it("a zero, negative or missing step moves nothing", () => {
    const w = world({ dog: 20, toy: 18.5 });
    w.run(0.1);
    w.s.toy = 5;
    for (const dt of [0, -1, -0.5]) { const before = w.s.dog; w.f.update(dt); expect(w.s.dog, String(dt)).toBe(before); }
  });
});

describe("the wiring in the world", () => {
  const world = readFileSync(join(new URL("..", import.meta.url).pathname, "src/features/game/world/runtime/world.ts"), "utf8");
  it("the follow is made from the dog, Kip and the busy states; it is updated every frame, reset with the world and on the dev handle", () => {
    expect(world).toContain('import { createFollow } from "./dogFollow";');
    expect(world).toContain("var FOLLOW=createFollow({dogX:function(){var d=theDog();return d?d.base.px:null},toyX:function(){return P.pos.x},toyStill:function(){return P.speed<.1&&!P.target},occupied:function(x: number){var d=theDog();return PFX.list().some(function(p: any){return p.type!==\"dog\"&&p.type!==\"ball\"&&(!d||Math.abs(p.base.pz-d.base.pz)<1.5)&&Math.abs(p.base.px-x)<p.size.x/2+.6})}");
    expect(world).toContain("DOGF.update(dt);BUBBLES.update(dt);FOLLOW.update(dt);");
    expect(world).toContain("BUBBLES.reset();HELD.release();FOLLOW.reset();");
    expect(world).toContain("fetch:DOGF,follow:FOLLOW,");
  });
  it("a fetch, an act, sleep, the pause screen, a mission or the editor always has the dog before the follow does", () => {
    const m = /var FOLLOW=createFollow\(\{[\s\S]*?allowed:function\(\)\{([^}]*)\}/.exec(world);
    expect(m).not.toBeNull();
    for (const part of ["!paused", "!P.showcase", "!P.mDrive", "!ED.on", "!DOGF.busy", "!ACTS.busy", "!SLEEPH.busy"]) expect(m![1], part).toContain(part);
  });
  it("it places the dog the way the fetch does (facing the way it goes) and cues the dog's own poses", () => {
    expect(world).toContain("moveDog:function(x: number,dir: number){var d=theDog();if(d)PFX.placeProp(d,x,{ry:dir>0?0:Math.PI})},cue:function(n: \"run\"|\"sit\"|\"idle\"|\"happy\"){var d=theDog();if(d)PFX.cue(d,n)}");
  });
});
