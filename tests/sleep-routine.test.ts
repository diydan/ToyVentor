// "Tap the bed": the whole sleep cycle against a recording adapter, with the real clock arithmetic.
import { describe, expect, it } from "vitest";
import { MATTRESS_TOP, sleepSpot } from "../src/features/game/world/runtime/bed";
import {
  CLIMB_S, DOWN_S, FIRST_ZZZ_S, HOP_HEIGHT, LEVEL_DOWN_PER_S, LEVEL_UP_PER_S, LYING_S, WAKING_S, WALK_TIMEOUT_S, ZZZ_EVERY_S,
  createSleep, hopPoint, lampScale, musicGain, tintAmount, type P3, type Rig, type SleepAdapter, type SleepPhase,
} from "../src/features/game/world/runtime/sleepRoutine";

const SPOT: P3 = { x: 20, y: 0.8, z: -2.4 };

function harness(opts: { rig?: Rig; start?: P3; spot?: P3 } = {}) {
  const spot = opts.spot ?? SPOT;
  const s = { rig: (opts.rig ?? "character") as Rig, pos: { ...(opts.start ?? { x: 14, y: 0, z: 0.6 }) }, arrived: false };
  const log: string[] = [];
  const phases: SleepPhase[] = [];
  const path: P3[] = [];
  const marks: Partial<Record<SleepPhase, number>> = {};    // how many positions had been set when each phase began
  const busyAt: Partial<Record<SleepPhase, boolean>> = {};  // what `busy` said as each phase began
  const adapter: SleepAdapter = {
    rig: () => s.rig,
    position: () => ({ ...s.pos }),
    walkTo: (x, z) => log.push(`walkTo:${x},${z}`),
    arrived: () => s.arrived,
    stopWalk: () => log.push("stopWalk"),
    setPosition: (x, y, z) => { s.pos = { x, y, z }; path.push({ x, y, z }); },
    lieDown: () => log.push("lieDown"),
    getUp: () => log.push("getUp"),
    zzz: () => log.push("zzz"),
    onPhase: (p) => { phases.push(p); marks[p] = path.length; busyAt[p] = sleep.busy; },
  };
  const sleep = createSleep(adapter, { spot });
  const run = (seconds: number, dt = 1 / 30) => { for (let t = 0; t < seconds - 1e-9; t += dt) sleep.update(dt); };
  /** From awake to deeply asleep. */
  const fallAsleep = () => { sleep.tapBed(); s.arrived = true; run(CLIMB_S + LYING_S + 1 / LEVEL_UP_PER_S + 0.5); s.arrived = false; };
  return { s, log, phases, path, marks, busyAt, sleep, run, fallAsleep, spot };
}

describe("hopPoint", () => {
  const a: P3 = { x: 0, y: 0, z: 0 }, b: P3 = { x: 4, y: 0.8, z: -2 };
  it("starts at a and ends exactly at b", () => {
    expect(hopPoint(a, b, 0)).toEqual(a);
    expect(hopPoint(a, b, 1)).toEqual(b);
    expect(hopPoint(a, b, -3)).toEqual(a);
    expect(hopPoint(a, b, 9)).toEqual(b);
    expect(hopPoint(a, b, Number.NaN)).toEqual(a);
  });
  it("rises above both ends in the middle and moves steadily", () => {
    const mid = hopPoint(a, b, 0.5);
    expect(mid.y).toBeCloseTo(0.4 + HOP_HEIGHT, 6);
    expect(mid.x).toBeCloseTo(2, 6);            // halfway across, in x and in z
    expect(mid.z).toBeCloseTo(-1, 6);
    expect(hopPoint(a, b, 0.25).x).toBeLessThan(1);   // eases in: a quarter of the way in time is less than a quarter of the way across
    expect(hopPoint(a, b, 0.75).x).toBeGreaterThan(3);
    let prev = -1;
    for (let u = 0; u <= 1.0001; u += 0.1) { const p = hopPoint(a, b, u); expect(p.x).toBeGreaterThanOrEqual(prev); prev = p.x; }
  });
});

describe("the room's light and sound", () => {
  it("lamp and music fall and the tint rises as the room falls asleep, and clamp", () => {
    expect([lampScale(0), musicGain(0), tintAmount(0)]).toEqual([1, 1, 0]);
    expect(lampScale(1)).toBeCloseTo(0.15, 6);
    expect(musicGain(1)).toBeCloseTo(0.2, 6);
    expect(tintAmount(1)).toBeCloseTo(0.6, 6);
    expect(lampScale(0.5)).toBeLessThan(lampScale(0.2));
    expect(musicGain(0.5)).toBeLessThan(musicGain(0.2));
    expect(tintAmount(0.5)).toBeGreaterThan(tintAmount(0.2));
    expect(lampScale(7)).toBe(lampScale(1));
    expect(musicGain(-2)).toBe(1);
  });
});

describe("a full night", () => {
  it("goes awake, walking, climbing, lying, asleep, waking, descending, awake, doing each thing once", () => {
    const h = harness();
    expect(h.sleep.tapBed()).toBe(true);
    expect(h.log).toEqual([`walkTo:${SPOT.x},0.6`]);          // along the toy's own lane to the bed's x
    expect(h.sleep.busy).toBe(true);
    h.run(1);
    expect(h.sleep.phase).toBe("walking");                    // not there yet
    h.s.arrived = true;
    h.run(CLIMB_S + LYING_S + 0.2);
    expect(h.sleep.phase).toBe("asleep");
    h.s.arrived = false;
    h.sleep.tapElsewhere();
    h.run(WAKING_S + DOWN_S + 0.2);
    expect(h.sleep.phase).toBe("awake");
    expect(h.phases).toEqual(["walking", "climbing", "lying", "asleep", "waking", "descending", "awake"]);
    expect(h.sleep.busy).toBe(false);
    expect(h.log.filter((l) => l === "lieDown")).toHaveLength(1);
    expect(h.log.filter((l) => l === "getUp")).toHaveLength(1);
  });

  it("`busy` is true in every phase except awake", () => {
    const h = harness();
    h.fallAsleep();
    h.sleep.tapElsewhere();
    h.run(WAKING_S + DOWN_S + 0.2);
    for (const p of ["walking", "climbing", "lying", "asleep", "waking", "descending"] as const) expect(h.busyAt[p], p).toBe(true);
    expect(h.busyAt.awake).toBe(false);
  });

  it("the hop up starts at the toy, rises over the mattress and moves steadily towards it", () => {
    const h = harness({ start: { x: 14, y: 0, z: 0.6 } });
    h.sleep.tapBed();
    h.s.arrived = true;
    h.run(CLIMB_S + 0.2);
    const hop = h.path.slice(h.marks.climbing!, h.marks.lying! + 1);
    expect(hop.length).toBeGreaterThan(10);
    expect(Math.abs(hop[0]!.x - 14)).toBeLessThan(0.6);                 // starts beside the toy's own spot, not at the bed
    expect(Math.max(...hop.map((p) => p.y))).toBeGreaterThan(SPOT.y + 0.3);
    for (let i = 1; i < hop.length; i++) expect(hop[i]!.x).toBeGreaterThanOrEqual(hop[i - 1]!.x);
    expect(hop.at(-1)).toEqual(SPOT);
  });

  it("lands exactly on the mattress spot, and hops back down to exactly where it climbed from", () => {
    const h = harness({ start: { x: 17, y: 0, z: 0.6 } });
    h.sleep.tapBed();
    h.s.arrived = true;
    h.run(CLIMB_S + 0.2);
    expect(h.s.pos).toEqual(SPOT);                            // on the mattress
    h.s.arrived = false;
    h.run(LYING_S + 1);
    h.sleep.tapElsewhere();
    h.run(WAKING_S + DOWN_S + 0.2);
    expect(h.s.pos).toEqual({ x: 17, y: 0, z: 0.6 });        // back on the floor where it climbed (here: where it was when it "arrived")
    // the hop down starts from the mattress, not from the floor spot
    const firstDown = h.path[h.marks.descending!]!;
    expect(Math.abs(firstDown.x - SPOT.x)).toBeLessThan(0.5);
    expect(firstDown.y).toBeGreaterThan(0.5);
    // while hopping the toy goes above the mattress, never below the floor
    expect(Math.max(...h.path.map((p) => p.y))).toBeGreaterThan(SPOT.y + 0.3);
    expect(Math.min(...h.path.map((p) => p.y))).toBeGreaterThanOrEqual(0);
  });

  it("the room darkens to full while asleep and is fully bright again once the toy is back on the floor", () => {
    const h = harness();
    h.sleep.tapBed();
    expect(h.sleep.level).toBe(0);
    h.s.arrived = true;
    h.run(CLIMB_S + 0.3);
    expect(h.sleep.level).toBeGreaterThan(0);                  // dimming has begun as it lies down
    expect(h.sleep.level).toBeLessThan(1);
    h.run(1 / LEVEL_UP_PER_S);
    expect(h.sleep.level).toBe(1);
    h.sleep.tapElsewhere();
    h.run(1 / LEVEL_DOWN_PER_S + 0.1);
    expect(h.sleep.level).toBe(0);
    expect(h.sleep.phase === "waking" || h.sleep.phase === "descending").toBe(true);   // brightened before it was even down
  });

  it("zzz bubbles: the first after a moment, then a steady beat, and none when awake or waking", () => {
    const h = harness();
    h.fallAsleep();
    const base = h.log.filter((l) => l === "zzz").length;
    h.run(5, 0.05);
    const during = h.log.filter((l) => l === "zzz").length - base;
    expect(during).toBeGreaterThanOrEqual(2);
    expect(during).toBeLessThanOrEqual(4);
    h.sleep.tapElsewhere();
    const at = h.log.filter((l) => l === "zzz").length;
    h.run(WAKING_S + DOWN_S + 3);
    expect(h.log.filter((l) => l === "zzz").length).toBe(at);
  });

  it("the first zzz comes FIRST_ZZZ_S after falling asleep, then every ZZZ_EVERY_S", () => {
    const h = harness();
    h.sleep.tapBed();
    h.s.arrived = true;
    h.run(CLIMB_S + LYING_S + 0.05);
    expect(h.sleep.phase).toBe("asleep");
    const zs = () => h.log.filter((l) => l === "zzz").length;
    expect(zs()).toBe(0);
    h.run(FIRST_ZZZ_S + 0.1);
    expect(zs()).toBe(1);
    h.run(ZZZ_EVERY_S);
    expect(zs()).toBe(2);
  });
});

describe("taps", () => {
  it("a vehicle does not sleep: the tap is not used and nothing starts", () => {
    const h = harness({ rig: "vehicle" });
    expect(h.sleep.tapBed()).toBe(false);
    expect(h.sleep.phase).toBe("awake");
    expect(h.log).toEqual([]);
  });

  it("a robot sleeps like a character (the adapter decides how it looks)", () => {
    const h = harness({ rig: "robot" });
    h.fallAsleep();
    expect(h.sleep.phase).toBe("asleep");
  });

  it("tapping the bed again while walking changes its mind; tapping elsewhere does too; neither leaves it walking", () => {
    for (const tap of ["tapBed", "tapElsewhere"] as const) {
      const h = harness();
      h.sleep.tapBed();
      h.run(1);
      expect(h.sleep[tap]()).toBe(true);
      expect(h.sleep.phase).toBe("awake");
      expect(h.log).toContain("stopWalk");
      h.s.arrived = true;
      h.run(3);
      expect(h.sleep.phase).toBe("awake");                    // a late arrival does not start a climb
    }
  });

  it("gives up after WALK_TIMEOUT_S if it never gets there, and can try again", () => {
    const h = harness();
    h.sleep.tapBed();
    h.run(WALK_TIMEOUT_S - 0.5);
    expect(h.sleep.phase).toBe("walking");
    h.run(1);
    expect(h.sleep.phase).toBe("awake");
    expect(h.log).toContain("stopWalk");
    expect(h.sleep.tapBed()).toBe(true);
    expect(h.sleep.phase).toBe("walking");
  });

  it("arriving just before the timeout still climbs", () => {
    const h = harness();
    h.sleep.tapBed();
    h.run(WALK_TIMEOUT_S - 0.5);
    h.s.arrived = true;
    h.run(0.2);
    expect(h.sleep.phase).toBe("climbing");
  });

  it("taps are ignored mid-hop (climbing, waking, descending): no half poses", () => {
    const h = harness();
    h.sleep.tapBed();
    h.s.arrived = true;
    h.run(0.2);
    expect(h.sleep.phase).toBe("climbing");
    expect(h.sleep.tapBed()).toBe(false);
    expect(h.sleep.tapElsewhere()).toBe(false);
    expect(h.sleep.phase).toBe("climbing");
    h.run(CLIMB_S + LYING_S + 0.5);
    h.sleep.tapBed();                                         // wakes (tap on the bed itself)
    expect(h.sleep.phase).toBe("waking");
    expect(h.sleep.tapBed()).toBe(false);
    h.run(WAKING_S + 0.1);
    expect(h.sleep.phase).toBe("descending");
    expect(h.sleep.tapElsewhere()).toBe(false);
    expect(h.sleep.phase).toBe("descending");
  });

  it("a tap while it is only lying down (not yet asleep) still wakes it, once", () => {
    const h = harness();
    h.sleep.tapBed();
    h.s.arrived = true;
    h.run(CLIMB_S + 0.2);
    expect(h.sleep.phase).toBe("lying");
    expect(h.sleep.tapElsewhere()).toBe(true);
    expect(h.sleep.phase).toBe("waking");
    expect(h.log.filter((l) => l === "getUp")).toHaveLength(1);
  });

  it("while asleep, a tap anywhere (the bed or elsewhere) wakes it", () => {
    for (const tap of ["tapBed", "tapElsewhere"] as const) {
      const h = harness();
      h.fallAsleep();
      expect(h.sleep[tap]()).toBe(true);
      expect(h.sleep.phase).toBe("waking");
    }
  });

  it("while awake, a tap elsewhere is not used (the world walks the toy as usual)", () => {
    const h = harness();
    expect(h.sleep.tapElsewhere()).toBe(false);
    expect(h.sleep.busy).toBe(false);
  });
});

describe("reset and hitches", () => {
  it("reset from deep sleep puts the room back at once and lets it start again", () => {
    const h = harness();
    h.fallAsleep();
    expect(h.sleep.level).toBe(1);
    h.sleep.reset();
    expect(h.sleep.phase).toBe("awake");
    expect(h.sleep.level).toBe(0);
    expect(h.sleep.busy).toBe(false);
    expect(h.sleep.tapBed()).toBe(true);
  });

  it("reset while walking stops the walk", () => {
    const h = harness();
    h.sleep.tapBed();
    h.sleep.reset();
    expect(h.log).toContain("stopWalk");
  });

  it("a long frame hitch advances one phase at a time and never skips the landing", () => {
    const h = harness();
    h.sleep.tapBed();
    h.s.arrived = true;
    h.sleep.update(30);                                       // walking -> climbing
    expect(h.sleep.phase).toBe("climbing");
    h.sleep.update(30);                                       // climbing -> lying (lands, lies down)
    expect(h.sleep.phase).toBe("lying");
    expect(h.s.pos).toEqual(SPOT);
    expect(h.log.filter((l) => l === "lieDown")).toHaveLength(1);
    h.sleep.update(30);
    expect(h.sleep.phase).toBe("asleep");
    expect(h.sleep.level).toBe(1);
  });
});

describe("with the real bed", () => {
  it("lands on the mattress surface at the bed's own position", () => {
    const bed = { x: 31, z: -2.4 };
    const h = harness({ spot: sleepSpot(bed), start: { x: 28, y: 0, z: 0 } });
    h.sleep.tapBed();
    h.s.arrived = true;
    h.run(CLIMB_S + 0.2);
    expect(h.s.pos).toEqual({ x: 31, y: MATTRESS_TOP, z: -2.4 });
  });
});
