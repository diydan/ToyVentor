import { describe, expect, it } from "vitest";
import { ARRIVE, CARRY_LIFT, DOG_BOUNDS, DOG_SPEED, DROP_S, MOUTH, REACT_S, RETURN_GAP, WAIT_MAX_S, createFetch } from "../src/features/game/world/runtime/dogFetch";

function game(o: { dog?: number; ball?: number; toy?: number; resting?: boolean } = {}) {
  const s = { dog: o.dog ?? 30, ball: o.ball ?? 22, toy: o.toy ?? 15, resting: o.resting ?? true };
  const dogMoves: Array<{ x: number; dir: number }> = [];
  const ballMoves: Array<{ x: number; lift: number }> = [];
  const log: string[] = [];
  const fetch = createFetch({
    dogX: () => s.dog, ballX: () => s.ball, ballResting: () => s.resting, toyX: () => s.toy,
    moveDog: (x, dir) => { s.dog = x; dogMoves.push({ x, dir }); },
    moveBall: (x, lift) => { s.ball = x; ballMoves.push({ x, lift }); },
    dropBall: () => log.push("drop"),
    cue: (n) => log.push(`cue:${n}`),
    woof: () => log.push("woof"),
  });
  const run = (seconds: number, dt = 1 / 30) => { for (let t = 0; t < seconds - 1e-9; t += dt) fetch.update(dt); };
  return { s, fetch, dogMoves, ballMoves, log, run };
}

describe("a fetch", () => {
  it("waits for the ball to stop, then sets off after a beat, running", () => {
    const g = game({ resting: false });
    g.fetch.start();
    expect(g.fetch.phase).toBe("waiting");
    expect(g.log).toEqual(["cue:happy"]);                          // delighted at the kick
    g.run(2);
    expect(g.dogMoves).toHaveLength(0);                            // the ball is still moving: the dog stays put
    g.s.resting = true;
    g.run(REACT_S - 0.1);
    expect(g.dogMoves).toHaveLength(0);                            // a beat before it sets off
    g.run(0.3);
    expect(g.fetch.phase).toBe("chasing");
    expect(g.log).toEqual(["cue:happy", "cue:run"]);
    g.run(0.1);
    expect(g.dogMoves.length).toBeGreaterThan(0);
  });

  it("runs to the ball from the right, facing it, and picks it up in its mouth", () => {
    const g = game({ dog: 30, ball: 22, toy: 15 });
    g.fetch.start();
    g.run(REACT_S + 0.2);
    g.run(4);
    expect(g.dogMoves[0]!.dir).toBe(-1);                           // running left
    const pickUp = g.ballMoves[0]!;
    expect(pickUp).toEqual({ x: 22, lift: CARRY_LIFT });           // the ball is lifted at the spot where it lay
    expect(g.dogMoves.find((m) => m.x <= 22 + MOUTH + ARRIVE)).toBeTruthy();
  });

  it("runs to the ball from the left too, and stops short of it on its own side", () => {
    const g = game({ dog: 10, ball: 20, toy: 25 });
    g.fetch.start();
    g.run(REACT_S + 0.2);
    g.run(0.1);
    expect(g.dogMoves[0]!.dir).toBe(1);
    g.run(5);
    const at = g.ballMoves[0]!;
    expect(at.lift).toBe(CARRY_LIFT);
    const stopX = g.dogMoves.filter((m, i) => g.dogMoves.slice(0, i + 1).length && m.x <= 20 - MOUTH + ARRIVE).pop()!;
    expect(stopX.x).toBeLessThanOrEqual(20 - MOUTH + ARRIVE + 1e-9);
  });

  it("brings the ball back to Kip, carrying it in front of it all the way, and drops it near Kip's feet with a woof", () => {
    const g = game({ dog: 30, ball: 22, toy: 15 });
    g.fetch.start();
    g.run(REACT_S + 0.2);
    g.run(10);
    expect(g.fetch.phase === "dropping" || g.fetch.phase === "idle").toBe(true);
    const carried = g.ballMoves.slice(1);
    expect(carried.length).toBeGreaterThan(10);
    for (const b of carried) expect(b.lift).toBe(CARRY_LIFT);
    expect(g.log.filter((l) => l === "drop")).toHaveLength(1);
    expect(g.log.filter((l) => l === "woof")).toHaveLength(1);
    expect(g.s.dog).toBeCloseTo(15 + RETURN_GAP, 1);                // stopped RETURN_GAP from Kip, on the side it came from
    expect(g.s.ball).toBeCloseTo(g.s.dog - MOUTH, 1);               // the ball is in front of its mouth, towards Kip
    expect(g.dogMoves.at(-1)!.dir).toBe(-1);                        // and it faces Kip
    expect(g.log).toEqual(["cue:happy", "cue:run", "drop", "cue:happy", "woof", "cue:idle"]);       // delighted at the kick, runs, drops it, delighted again, woofs, settles
  });

  it("the ball stays at the dog's mouth as it runs back (always the same distance in front of it)", () => {
    const g = game({ dog: 30, ball: 22, toy: 15 });
    g.fetch.start();
    g.run(REACT_S + 0.2 + 2.0);                                      // (the dog needs about 1.6 s to reach the ball, then it turns back)
    expect(g.fetch.phase).toBe("returning");
    g.ballMoves.length = 0; g.dogMoves.length = 0;
    g.run(0.5);
    expect(g.ballMoves.length).toBeGreaterThan(5);
    for (let i = 0; i < g.ballMoves.length; i++) expect(Math.abs(g.ballMoves[i]!.x - g.dogMoves[i]!.x)).toBeCloseTo(MOUTH, 6);
  });

  it("afterwards it is delighted for a moment and then stands about again", () => {
    const g = game({ dog: 30, ball: 22, toy: 15 });
    g.fetch.start();
    g.run(REACT_S + 0.2 + 3.1);                                      // about 3.4 s from the kick to the drop: 1.5 s out, 1.4 s back
    expect(g.fetch.phase).toBe("dropping");
    expect(g.log.at(-1)).toBe("woof");
    g.run(DROP_S + 0.1);
    expect(g.fetch.phase).toBe("idle");
    expect(g.log.at(-1)).toBe("cue:idle");
    expect(g.fetch.busy).toBe(false);
  });

  it("never moves faster than its running speed", () => {
    const g = game({ dog: 40, ball: 5, toy: 12 });
    g.fetch.start();
    let prev = g.s.dog;
    for (let i = 0; i < 30 * 20; i++) {
      g.fetch.update(1 / 30);
      expect(Math.abs(g.s.dog - prev), `frame ${i}`).toBeLessThanOrEqual(DOG_SPEED / 30 + 1e-9);
      prev = g.s.dog;
    }
  });

  it("does not run out of the room, even for a ball against the wall", () => {
    const g = game({ dog: 30, ball: 43, toy: 38 });
    g.fetch.start();
    g.run(15);
    for (const m of g.dogMoves) { expect(m.x).toBeGreaterThanOrEqual(DOG_BOUNDS[0] - 1e-9); expect(m.x).toBeLessThanOrEqual(DOG_BOUNDS[1] + 1e-9); }
    const h = game({ dog: 10, ball: 0.5, toy: 6 });
    h.fetch.start();
    h.run(15);
    for (const m of h.dogMoves) expect(m.x).toBeGreaterThanOrEqual(DOG_BOUNDS[0] - 1e-9);
  });

  it("does not run out of the room on the far side of a ball near a wall either", () => {
    const g = game({ dog: 42.5, ball: 42, toy: 38 });
    g.fetch.start();
    g.run(8);
    expect(g.dogMoves.length).toBeGreaterThan(0);
    for (const m of g.dogMoves) expect(m.x).toBeLessThanOrEqual(DOG_BOUNDS[1] + 1e-9);
    const h = game({ dog: 1.4, ball: 2.0, toy: 9 });
    h.fetch.start();
    h.run(8);
    for (const m of h.dogMoves) expect(m.x).toBeGreaterThanOrEqual(DOG_BOUNDS[0] - 1e-9);
  });

  it("follows Kip if Kip walks while the dog brings the ball", () => {
    const g = game({ dog: 30, ball: 22, toy: 15 });
    g.fetch.start();
    g.run(REACT_S + 0.2 + 2.0);
    expect(g.fetch.phase).toBe("returning");
    g.s.toy = 8;                                                    // Kip walks off to the left
    g.run(10);
    expect(g.s.dog).toBeCloseTo(8 + RETURN_GAP, 1);
  });

  it("gives up waiting for a ball that never stops", () => {
    const g = game({ resting: false });
    g.fetch.start();
    g.run(WAIT_MAX_S - 0.5);
    expect(g.fetch.phase).toBe("waiting");
    g.run(1);
    expect(g.fetch.phase).toBe("idle");
    expect(g.log.at(-1)).toBe("cue:idle");
    expect(g.dogMoves).toHaveLength(0);
  });

  it("only counts the ball as stopped when it STAYS stopped for the beat (a ball that bounces on is waited for)", () => {
    const g = game({ resting: true });
    g.fetch.start();
    g.run(REACT_S - 0.15);
    g.s.resting = false;                                            // it was still moving after all
    g.run(1);
    expect(g.fetch.phase).toBe("waiting");
    expect(g.dogMoves).toHaveLength(0);
    g.s.resting = true;
    g.run(REACT_S - 0.2);
    expect(g.fetch.phase).toBe("waiting");                          // the beat starts again from when it stopped for good
    g.run(0.4);
    expect(g.fetch.phase).toBe("chasing");
  });

  it("a dog that is already at the ball picks it up at once", () => {
    const g = game({ dog: 22 + MOUTH, ball: 22, toy: 15 });
    g.fetch.start();
    g.run(REACT_S + 0.1);
    g.run(0.1);
    expect(g.ballMoves[0]).toEqual({ x: 22, lift: CARRY_LIFT });
  });
});

describe("restarting and cancelling", () => {
  it("a second kick while the ball is being carried sets it down where it is and starts again", () => {
    const g = game({ dog: 30, ball: 22, toy: 15 });
    g.fetch.start();
    g.run(REACT_S + 0.2 + 2.0);
    expect(g.fetch.phase).toBe("returning");
    const atBall = g.s.ball;
    g.fetch.start();
    expect(g.ballMoves.at(-1)).toEqual({ x: atBall, lift: 0 });
    expect(g.fetch.phase).toBe("waiting");
    g.s.ball = 33;                                                  // the new kick landed here
    g.run(REACT_S + 0.2);
    g.run(10);
    expect(g.log.filter((l) => l === "drop")).toHaveLength(1);
  });

  it("cancel puts a carried ball down, stops the dog and is harmless when nothing is happening", () => {
    const g = game({ dog: 30, ball: 22, toy: 15 });
    g.fetch.cancel();
    expect(g.log).toEqual([]);
    g.fetch.start();
    g.run(REACT_S + 0.2 + 2.0);
    expect(g.fetch.phase).toBe("returning");
    g.fetch.cancel();
    expect(g.ballMoves.at(-1)!.lift).toBe(0);
    expect(g.log.at(-1)).toBe("cue:idle");
    expect(g.fetch.phase).toBe("idle");
    const n = g.dogMoves.length;
    g.run(3);
    expect(g.dogMoves.length).toBe(n);
    g.fetch.cancel();
  });

  it("an update when idle does nothing", () => {
    const g = game();
    g.run(5);
    expect(g.dogMoves).toHaveLength(0);
    expect(g.log).toEqual([]);
  });
});
