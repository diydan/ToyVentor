import { describe, expect, it } from "vitest";
import { ARRIVE_X, REDIRECT_X, WALK_TIMEOUT_S, createVisitor, type Visit, type VisitPhase } from "../src/features/game/world/runtime/visitRoutine";

function harness(start = { x: 10, y: 0, z: 0.5 }) {
  const s = { pos: { ...start }, target: null as number | null };
  const log: string[] = [];
  const phases: VisitPhase[] = [];
  const v = createVisitor({
    position: () => ({ ...s.pos }),
    targetX: () => s.target,
    walkTo: (x, z) => { s.target = x; log.push(`walkTo:${x},${z}`); },
    stopWalk: () => { s.target = null; log.push("stopWalk"); },
    face: (d) => log.push(`face:${d}`),
    onPhase: (p) => phases.push(p),
  });
  const ticks: number[] = [];
  const visit = (over: Partial<Visit> = {}): Visit => ({
    standX: 15, face: 1, seconds: 2,
    begin: () => log.push("begin"),
    tick: (t) => ticks.push(t),
    cues: [{ at: 0.5, fn: () => log.push("cue0.5") }, { at: 1.2, fn: () => log.push("cue1.2") }],
    end: (ok) => log.push(`end:${ok}`),
    ...over,
  });
  const run = (seconds: number, dt = 1 / 30) => { for (let t = 0; t < seconds - 1e-9; t += dt) v.update(dt); };
  const arrive = () => { s.pos.x = 15; s.target = null; };
  return { v, s, log, phases, ticks, visit, run, arrive };
}

describe("a visit", () => {
  it("walks along the toy's own lane to where it should stand, then acts when it gets there", () => {
    const h = harness();
    expect(h.v.start(h.visit())).toBe(true);
    expect(h.log).toEqual(["walkTo:15,0.5"]);
    expect(h.v.phase).toBe("walking");
    h.run(1);
    expect(h.v.phase).toBe("walking");                         // not there yet
    h.arrive();
    h.run(0.1);
    expect(h.v.phase).toBe("acting");
    expect(h.log.slice(1)).toEqual(["face:1", "begin"]);       // turns to face the prop, then starts
  });

  it("runs its cues once each, in order, at the right moments, then ends completed", () => {
    const h = harness();
    h.v.start(h.visit());
    h.arrive();
    h.run(0.05);
    expect(h.log).not.toContain("cue0.5");
    h.run(0.6);
    expect(h.log).toContain("cue0.5");
    expect(h.log).not.toContain("cue1.2");
    h.run(0.8);
    expect(h.log.filter((l) => l.startsWith("cue"))).toEqual(["cue0.5", "cue1.2"]);
    h.run(1.5);
    expect(h.log.at(-1)).toBe("end:true");
    expect(h.v.phase).toBe("idle");
    expect(h.phases).toEqual(["walking", "acting", "idle"]);
    expect(h.log.filter((l) => l.startsWith("cue"))).toHaveLength(2);        // none repeated
  });

  it("ticks every frame of the action with the seconds since it began", () => {
    const h = harness();
    h.v.start(h.visit());
    h.arrive();
    h.run(1);
    expect(h.ticks.length).toBeGreaterThan(20);
    for (let i = 1; i < h.ticks.length; i++) expect(h.ticks[i]!).toBeGreaterThan(h.ticks[i - 1]!);
    expect(h.ticks[0]!).toBeLessThan(0.1);
  });

  it("starts at once when the toy is already standing there", () => {
    const h = harness({ x: 15.1, y: 0, z: 0 });
    h.v.start(h.visit());
    h.run(0.05);
    expect(h.v.phase).toBe("acting");
  });

  it("only starts when the toy is within ARRIVE_X", () => {
    const h = harness({ x: 15 - ARRIVE_X - 0.1, y: 0, z: 0 });
    h.v.start(h.visit());
    h.run(0.2);
    expect(h.v.phase).toBe("walking");
    h.s.pos.x = 15 - ARRIVE_X + 0.05;
    h.run(0.1);
    expect(h.v.phase).toBe("acting");
  });
});

describe("only one at a time, and always a way out", () => {
  it("a second visit is refused while one is under way (walking or acting)", () => {
    const h = harness();
    h.v.start(h.visit());
    expect(h.v.start(h.visit({ standX: 3 }))).toBe(false);
    h.arrive();
    h.run(0.1);
    expect(h.v.start(h.visit({ standX: 3 }))).toBe(false);
    expect(h.log.filter((l) => l.startsWith("walkTo"))).toHaveLength(1);
  });

  it("can start again once it is over", () => {
    const h = harness();
    h.v.start(h.visit());
    h.arrive();
    h.run(3);
    expect(h.v.phase).toBe("idle");
    expect(h.v.start(h.visit({ standX: 20 }))).toBe(true);
  });

  it("gives up walking after WALK_TIMEOUT_S: nothing begins and end is never called", () => {
    const h = harness();
    h.v.start(h.visit());
    h.run(WALK_TIMEOUT_S - 0.3);
    expect(h.v.phase).toBe("walking");
    h.run(0.6);
    expect(h.v.phase).toBe("idle");
    expect(h.log).toContain("stopWalk");
    expect(h.log).not.toContain("begin");
    expect(h.log.some((l) => l.startsWith("end"))).toBe(false);
  });

  it("drops the visit when the player sends the toy somewhere else, but not for a target still at the prop", () => {
    const h = harness();
    h.v.start(h.visit());
    h.s.target = 15 + REDIRECT_X - 0.05;
    h.run(0.2);
    expect(h.v.phase).toBe("walking");
    h.s.target = 3;
    h.run(0.1);
    expect(h.v.phase).toBe("idle");
    expect(h.log).toContain("stopWalk");
  });

  it("tapElsewhere: drops a walk (and says the tap is the player's own), swallows a tap mid-action, ignores idle", () => {
    const a = harness();
    expect(a.v.tapElsewhere()).toBe(false);
    a.v.start(a.visit());
    expect(a.v.tapElsewhere()).toBe(false);
    expect(a.v.phase).toBe("idle");
    expect(a.log).toContain("stopWalk");
    const b = harness();
    b.v.start(b.visit());
    b.arrive();
    b.run(0.2);
    expect(b.v.tapElsewhere()).toBe(true);
    expect(b.v.phase).toBe("acting");                          // not interrupted by a tap
  });

  it("cancel mid-action ends it as cut short (so whatever it started is put right) and fires no further cues", () => {
    const h = harness();
    h.v.start(h.visit());
    h.arrive();
    h.run(0.7);
    h.v.cancel();
    expect(h.log.at(-1)).toBe("end:false");
    expect(h.v.phase).toBe("idle");
    h.run(3);
    expect(h.log).not.toContain("cue1.2");
    expect(h.log.filter((l) => l.startsWith("end"))).toEqual(["end:false"]);
  });

  it("cancel while walking stops the walk and does not call end; cancel when idle does nothing", () => {
    const h = harness();
    h.v.cancel();
    expect(h.log).toEqual([]);
    h.v.start(h.visit());
    h.v.cancel();
    expect(h.log).toEqual(["walkTo:15,0.5", "stopWalk"]);
    expect(h.v.phase).toBe("idle");
  });

  it("a long frame hitch does not skip the cues or the end", () => {
    const h = harness();
    h.v.start(h.visit());
    h.arrive();
    h.v.update(0.1);
    h.v.update(30);
    expect(h.log.filter((l) => l.startsWith("cue"))).toEqual(["cue0.5", "cue1.2"]);
    expect(h.log.at(-1)).toBe("end:true");
  });
});
