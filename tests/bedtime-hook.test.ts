// Bedtime in the world (Dan, 2026-11-05: "Kip going to bed by himself at quiet hours"): the sleep hook's `setBedtime("going" | "now" | "off")`, run on a fake game with the real sleep
// routine, the real bed geometry and real sprites. "going" is the last minute before play stops (walk to the nearest bed, or lie down where he is when the world has none), "now" is the
// curtain being up (asleep at once if not already), "off" is play coming back (wake the sleep bedtime started, never the child's own).
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { sleepSpot } from "../src/features/game/world/runtime/bed";
import { createSleepHook, type SleepWorld } from "../src/features/game/world/runtime/sleepHook";
import { CLIMB_S, DOWN_S, LYING_S, WAKING_S, WALK_TIMEOUT_S, createSleep, type SleepAdapter } from "../src/features/game/world/runtime/sleepRoutine";

type Bed = { x: number; z: number };
function game(opts: { eater?: "character" | "robot" | "vehicle"; allowed?: boolean; beds?: Bed[] | null; ok?: boolean; start?: { x: number; y: number; z: number } } = {}) {
  const root = new THREE.Group();
  const s = { eater: opts.eater ?? "character", allowed: opts.allowed ?? true, ok: opts.ok ?? true, pos: { ...(opts.start ?? { x: 20, y: 0, z: 0.4 }) }, target: null as number | null, beds: opts.beds === null ? undefined : (opts.beds ?? [{ x: 31, z: -2.6 }]) };
  const log: string[] = [];
  const levels: number[] = [];
  const w: SleepWorld = {
    root: () => root,
    eater: () => s.eater,
    position: () => ({ ...s.pos }),
    targetX: () => s.target,
    walkTo: (x, z) => { s.target = x; log.push(`walkTo:${x},${z}`); },
    stopWalk: () => { s.target = null; log.push("stopWalk"); },
    setPosition: (x, y, z) => { s.pos = { x, y, z }; },
    lieDown: () => log.push("lieDown"),
    getUp: () => log.push("getUp"),
    allowed: () => s.allowed,
    ambient: (l) => levels.push(l),
    phase: () => {},
    refuse: () => log.push("refuse"),
    beds: s.beds ? () => s.beds! : undefined,
    bedtimeOk: () => s.ok,
  };
  const hook = createSleepHook(w);
  const run = (seconds: number, dt = 1 / 30) => { for (let t = 0; t < seconds - 1e-9; t += dt) hook.update(dt); };
  /** The toy has walked as far as the walk goes (the real game does this in its own update). */
  const arrive = (x: number) => { s.pos.x = x; s.target = null; };
  return { hook, s, log, levels, root, run, arrive };
}
const BED: Bed = { x: 31, z: -2.6 };
const FAR: Bed = { x: 40, z: -2.6 };

describe("going to bed (the last minute)", () => {
  it("walks to the bed along its own lane, hops up, lies down and falls asleep, and the room darkens: all by itself, nothing was tapped", () => {
    const g = game();
    g.hook.setBedtime("going");
    expect(g.hook.phase, "nothing happens until the world's next frame").toBe("awake");
    g.run(1 / 30);
    expect(g.hook.phase).toBe("walking");
    expect(g.log).toEqual(["walkTo:31,0.4"]);
    expect(g.hook.bedtimeOwned).toBe(true);
    g.arrive(31);
    g.run(CLIMB_S + LYING_S + 3);
    expect(g.hook.phase).toBe("asleep");
    expect(g.s.pos).toMatchObject({ x: sleepSpot(BED).x, z: sleepSpot(BED).z });
    expect(g.hook.level).toBe(1);
    expect(g.levels.at(-1)).toBe(1);
    expect(g.hook.bubbleCount, "the Zzz drift up").toBeGreaterThan(0);
  });
  it("goes to the NEAREST bed when there are two", () => {
    const g = game({ beds: [FAR, BED], start: { x: 28, y: 0, z: 0.4 } });
    g.hook.setBedtime("going");
    g.run(1 / 30);
    expect(g.log).toEqual(["walkTo:31,0.4"]);
    const h = game({ beds: [FAR, BED], start: { x: 41, y: 0, z: 0.4 } });
    h.hook.setBedtime("going");
    h.run(1 / 30);
    expect(h.log).toEqual(["walkTo:40,0.4"]);
  });
  it("in a world with no bed he lies down where he stands: no walk, the lying pose, asleep after the settling, and the room darkens", () => {
    for (const beds of [null, [] as Bed[]]) {
      const g = game({ beds });
      g.hook.setBedtime("going");
      g.run(1 / 30);
      expect(g.log).toEqual(["lieDown"]);
      expect(g.hook.phase).toBe("lying");
      g.run(LYING_S + 3);                              // (the room takes 2.5 s to darken)
      expect(g.hook.phase).toBe("asleep");
      expect(g.s.pos, "he did not move").toEqual({ x: 20, y: 0, z: 0.4 });
      expect(g.hook.level).toBe(1);
      expect(g.hook.bubbleCount).toBeGreaterThan(0);
    }
  });
  it("waits while something owns the toy, and goes the moment it is free (a hug, a meal, a mission drive)", () => {
    const g = game({ allowed: false });
    g.hook.setBedtime("going");
    g.run(3);
    expect(g.hook.phase).toBe("awake");
    expect(g.log).toEqual([]);
    g.s.allowed = true;
    g.run(1 / 30);
    expect(g.hook.phase).toBe("walking");
  });
  it("does not start on the title screen, and goes when the game is on", () => {
    const g = game({ ok: false });
    g.hook.setBedtime("going");
    g.run(2);
    expect(g.log).toEqual([]);
    g.s.ok = true;
    g.run(1 / 30);
    expect(g.hook.phase).toBe("walking");
  });
  it("a robot or a vehicle is left alone: nothing starts, and nobody says no (bedtime is not a request)", () => {
    for (const eater of ["robot", "vehicle"] as const) {
      const g = game({ eater });
      g.hook.setBedtime("going");
      g.run(2);
      g.hook.setBedtime("now");
      g.run(2);
      expect(g.log, eater).toEqual([]);
      expect(g.hook.busy).toBe(false);
    }
  });
  it("if the walk gives up (a long way), he starts again while it is still the lead-in", () => {
    const g = game({ start: { x: 2, y: 0, z: 0.4 } });
    g.hook.setBedtime("going");
    g.run(1 / 30);
    expect(g.hook.phase).toBe("walking");
    g.run(WALK_TIMEOUT_S + 0.5);                       // never gets there
    g.run(1 / 30);
    expect(g.log.filter((l) => l.startsWith("walkTo")).length, "walks again").toBeGreaterThanOrEqual(2);
    expect(g.hook.bedtimeDeclined).toBe(false);
  });
});

describe("the child has a say before the curtain", () => {
  it("a tap that wakes him during the lead-in is respected: he stays up (no walking back to bed) until the curtain", () => {
    const g = game();
    g.hook.setBedtime("going"); g.run(1 / 30); g.arrive(31); g.run(CLIMB_S + LYING_S + 1);
    expect(g.hook.phase).toBe("asleep");
    expect(g.hook.consume(), "the tap wakes him and is swallowed").toBe(true);
    g.run(WAKING_S + DOWN_S + 1);
    expect(g.hook.phase).toBe("awake");
    expect(g.hook.bedtimeDeclined).toBe(true);
    g.log.length = 0;
    g.run(10);
    expect(g.log, "he stays up").toEqual([]);
    expect(g.hook.phase).toBe("awake");
    g.hook.setBedtime("now");                          // the curtain: now he sleeps, at once
    g.run(1 / 30);
    expect(g.hook.phase).toBe("asleep");
  });
  it("sending him away from the bed while he walks to it declines it too", () => {
    const g = game();
    g.hook.setBedtime("going"); g.run(1 / 30);
    expect(g.hook.phase).toBe("walking");
    g.s.target = 3;                                    // the child tapped far away from the bed
    g.run(1 / 30);
    expect(g.hook.phase).toBe("awake");
    expect(g.hook.bedtimeDeclined).toBe(true);
    g.log.length = 0;
    g.run(5);
    expect(g.log).toEqual([]);
  });
  it("a fresh lead-in (the mode changes) forgets that he was waved off", () => {
    const g = game();
    g.hook.setBedtime("going"); g.run(1 / 30); g.arrive(31); g.run(CLIMB_S + LYING_S + 1);
    g.hook.consume(); g.run(WAKING_S + DOWN_S + 1);
    expect(g.hook.bedtimeDeclined).toBe(true);
    g.hook.setBedtime("off");
    expect(g.hook.bedtimeDeclined).toBe(false);
    g.hook.setBedtime("going"); g.run(1 / 30);
    expect(["walking", "climbing"], "he goes to bed again (he is already beside it, so he climbs at once)").toContain(g.hook.phase);
  });
});

describe("the curtain is up", () => {
  it("puts him to sleep at once on the nearest bed, wherever he was, with the room at full dusk", () => {
    const g = game({ start: { x: 5, y: 0, z: 0.4 } });
    g.hook.setBedtime("now");
    g.run(1 / 30);
    expect(g.hook.phase).toBe("asleep");
    expect(g.s.pos).toMatchObject({ x: sleepSpot(BED).x, y: sleepSpot(BED).y, z: sleepSpot(BED).z });
    expect(g.log).toEqual(["lieDown"]);
    expect(g.hook.level).toBe(1);
    expect(g.hook.bedtimeOwned).toBe(true);
  });
  it("with no bed he lies down where he is, at once", () => {
    const g = game({ beds: null });
    g.hook.setBedtime("now");
    g.run(1 / 30);
    expect(g.hook.phase).toBe("asleep");
    expect(g.s.pos).toEqual({ x: 20, y: 0, z: 0.4 });
    expect(g.log).toEqual(["lieDown"]);
    expect(g.hook.level).toBe(1);
  });
  it("hurries a walk to bed that was not done: stops walking and is asleep on the bed", () => {
    const g = game();
    g.hook.setBedtime("going"); g.run(0.5);
    expect(g.hook.phase).toBe("walking");
    g.hook.setBedtime("now");
    g.run(1 / 30);
    expect(g.log).toContain("stopWalk");
    expect(g.hook.phase).toBe("asleep");
    expect(g.s.pos.x).toBeCloseTo(sleepSpot(BED).x, 6);
  });
  it("leaves a sleep that is already going alone (no second lie-down), and one the child started counts as bedtime's", () => {
    const g = game();
    g.hook.setBedtime("going"); g.run(1 / 30); g.arrive(31); g.run(CLIMB_S + LYING_S + 1);
    g.log.length = 0;
    g.hook.setBedtime("now"); g.run(2);
    expect(g.log).toEqual([]);
    expect(g.hook.phase).toBe("asleep");
    // the child's own tap on the bed, then bedtime
    const h = game();
    h.hook.tapBed(BED); h.arrive(31); h.run(CLIMB_S + LYING_S + 1);
    expect(h.hook.bedtimeOwned).toBe(false);
    h.hook.setBedtime("now"); h.run(1 / 30);
    expect(h.hook.bedtimeOwned).toBe(true);
  });
  it("waits while he is busy, then sleeps", () => {
    const g = game({ allowed: false });
    g.hook.setBedtime("now"); g.run(2);
    expect(g.hook.phase).toBe("awake");
    g.s.allowed = true; g.run(1 / 30);
    expect(g.hook.phase).toBe("asleep");
  });
});

describe("play comes back", () => {
  it("off wakes a bedtime sleep on a bed: the yawn, the hop down onto his own lane at the bed, awake", () => {
    const g = game({ start: { x: 5, y: 0, z: 0.4 } });
    g.hook.setBedtime("now"); g.run(1 / 30);
    g.log.length = 0;
    g.hook.setBedtime("off");
    expect(g.hook.phase).toBe("waking");
    expect(g.log).toEqual(["getUp"]);
    g.run(WAKING_S + DOWN_S + 0.2);
    expect(g.hook.phase).toBe("awake");
    expect(g.s.pos).toMatchObject({ x: sleepSpot(BED).x, y: 0, z: 0.4 });   // down beside the bed on his own lane
    expect(g.hook.level).toBe(0);
    expect(g.hook.bedtimeOwned).toBe(false);
  });
  it("off wakes a sleep where he lay with a yawn and NO hop (there was no bed to hop down from)", () => {
    const g = game({ beds: null });
    g.hook.setBedtime("now"); g.run(1 / 30);
    const positions: Array<[number, number, number]> = [];
    g.hook.setBedtime("off");
    for (let t = 0; t < WAKING_S + 1; t += 1 / 30) { g.hook.update(1 / 30); positions.push([g.s.pos.x, g.s.pos.y, g.s.pos.z]); }
    expect(g.hook.phase).toBe("awake");
    for (const p of positions) expect(p).toEqual([20, 0, 0.4]);              // never moved, never hopped
    expect(g.log.filter((l) => l === "getUp")).toHaveLength(1);
  });
  it("off with bedtime never on leaves a sleep the child started alone, and off does stop a walk to bed that bedtime started", () => {
    const own = game();
    own.hook.tapBed(BED); own.arrive(31); own.run(CLIMB_S + LYING_S + 1);
    own.hook.setBedtime("off");                        // (a no-op: bedtime was never on)
    own.run(2);
    expect(own.hook.phase, "the child's own sleep goes on").toBe("asleep");
    const walk = game();
    walk.hook.setBedtime("going"); walk.run(0.5);
    expect(walk.hook.phase).toBe("walking");
    walk.hook.setBedtime("off");
    expect(walk.hook.phase).toBe("awake");
    expect(walk.log).toContain("stopWalk");
  });
  it("is a no-op when bedtime was never on, and a repeated mode does nothing", () => {
    const g = game();
    g.hook.setBedtime("off"); g.run(2);
    expect(g.log).toEqual([]);
    g.hook.setBedtime("going"); g.hook.setBedtime("going"); g.run(1 / 30);
    expect(g.log).toEqual(["walkTo:31,0.4"]);
  });
});

describe("the lying pose is held for real", () => {
  it("when the animation loses the pose under a sleeper (the rig was swapped for the finished one), the hook lies him down again, and not otherwise", () => {
    const g = game({ beds: null });
    let holds = true;
    // a world that can say whether the pose is held
    const root = new THREE.Group();
    const log: string[] = [];
    const w: SleepWorld = {
      root: () => root, eater: () => "character", position: () => ({ x: 20, y: 0, z: 0.4 }), targetX: () => null, walkTo: () => {}, stopWalk: () => {}, setPosition: () => {},
      lieDown: () => { log.push("lieDown"); holds = true; }, getUp: () => log.push("getUp"), allowed: () => true, ambient: () => {}, phase: () => {}, refuse: () => {},
      beds: () => [], holdsPose: () => holds,
    };
    const hook = createSleepHook(w);
    const run = (n: number) => { for (let i = 0; i < n; i++) hook.update(1 / 30); };
    hook.setBedtime("now");
    run(3);
    expect(hook.phase).toBe("asleep");
    expect(log).toEqual(["lieDown"]);
    run(30);
    expect(log, "held: left alone").toEqual(["lieDown"]);
    holds = false;                                       // the rig was swapped: the pose is gone
    run(1);
    expect(log, "lies down again").toEqual(["lieDown", "lieDown"]);
    run(30);
    expect(log, "and once it holds again, not every frame").toEqual(["lieDown", "lieDown"]);
    hook.setBedtime("off");
    holds = false;                                       // waking: the yawn is playing, the hold is rightly gone
    run(10);
    expect(log.filter((l) => l === "lieDown")).toHaveLength(2);
    expect(g.hook.phase).toBe("awake");                  // (the other game, untouched)
  });
});

describe("the world is rebuilt in the middle of it", () => {
  it("a world change wakes everything but bedtime carries on in the new world: no bed there, so he lies down where he is", () => {
    const g = game();
    g.hook.setBedtime("going"); g.run(1 / 30); g.arrive(31); g.run(CLIMB_S + LYING_S + 1);
    expect(g.hook.phase).toBe("asleep");
    g.hook.reset();
    expect(g.hook.phase).toBe("awake");
    expect(g.hook.level).toBe(0);
    expect(g.hook.bedtime, "the mode survives the world change").toBe("going");
    g.s.beds = undefined as never;
    (g as unknown as { s: { beds: unknown } }).s.beds = undefined;
    g.run(1 / 30);
    expect(g.hook.phase).not.toBe("asleep");     // (it started again: walking to the same bed, which this fake still lists)
    expect(["walking", "lying", "asleep"]).toContain(g.hook.phase);
  });
});

describe("the routine's two new entries on their own", () => {
  function routine(rig: "character" | "vehicle" = "character") {
    const log: string[] = [];
    let pos = { x: 5, y: 0, z: 0.4 };
    const a: SleepAdapter = {
      rig: () => rig, position: () => ({ ...pos }), walkTo: () => log.push("walkTo"), arrived: () => false, stopWalk: () => log.push("stopWalk"),
      setPosition: (x, y, z) => { pos = { x, y, z }; }, lieDown: () => log.push("lieDown"), getUp: () => log.push("getUp"), zzz: () => log.push("zzz"),
    };
    const spot = { x: 31, y: 0.8, z: -2.6 };
    const c = createSleep(a, { spot });
    return { c, log, spot, pos: () => pos };
  }
  it("lieHere: lies down and falls asleep where it stands, wakes with a yawn and no hop, and a vehicle does not", () => {
    const r = routine();
    expect(r.c.lieHere()).toBe(true);
    expect(r.c.phase).toBe("lying");
    expect(r.c.inPlace).toBe(true);
    for (let t = 0; t < LYING_S + 0.1; t += 1 / 30) r.c.update(1 / 30);
    expect(r.c.phase).toBe("asleep");
    expect(r.c.tapElsewhere()).toBe(true);
    expect(r.c.phase).toBe("waking");
    for (let t = 0; t < WAKING_S + 0.1; t += 1 / 30) r.c.update(1 / 30);
    expect(r.c.phase, "straight to awake: nothing to hop down from").toBe("awake");
    expect(r.c.inPlace).toBe(false);
    expect(r.pos()).toEqual({ x: 5, y: 0, z: 0.4 });
    expect(routine("vehicle").c.lieHere()).toBe(false);
    expect(r.c.lieHere(), "and again from awake").toBe(true);
    expect(r.c.lieHere(), "but not while already lying").toBe(false);
  });
  it("sleepNow: asleep at once at the bed (home is his own lane at the bed) or in place, only from awake or walking, never a vehicle", () => {
    const r = routine();
    expect(r.c.sleepNow(true)).toBe(true);
    expect(r.c.phase).toBe("asleep");
    expect(r.c.level).toBe(1);
    expect(r.pos()).toEqual(r.spot);
    r.c.tapElsewhere();
    for (let t = 0; t < WAKING_S + DOWN_S + 0.1; t += 1 / 30) r.c.update(1 / 30);
    expect(r.c.phase).toBe("awake");
    expect(r.pos()).toEqual({ x: 31, y: 0, z: 0.4 });
    const walking = routine();
    walking.c.tapBed();
    expect(walking.c.phase).toBe("walking");
    expect(walking.c.sleepNow(false)).toBe(true);
    expect(walking.log).toContain("stopWalk");
    expect(walking.c.inPlace).toBe(true);
    expect(walking.c.sleepNow(true), "already asleep: left alone").toBe(false);
    expect(routine("vehicle").c.sleepNow(false)).toBe(false);
  });
});
