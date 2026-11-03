// The world-side half of "tap the bed": a fake world standing in for the game, the real sleep routine, the real bed geometry and real three.js sprites.
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { MATTRESS_TOP } from "../src/features/game/world/runtime/bed";
import { ARRIVE_X, REDIRECT_X, ZZZ_FROM, ZZZ_RISE, ZZZ_RISE_S, createSleepHook, type SleepWorld } from "../src/features/game/world/runtime/sleepHook";
import { CLIMB_S, DOWN_S, FIRST_ZZZ_S, LYING_S, WAKING_S, WALK_TIMEOUT_S, type SleepPhase } from "../src/features/game/world/runtime/sleepRoutine";

function game(opts: { eater?: "character" | "robot" | "vehicle"; allowed?: boolean; start?: { x: number; y: number; z: number } } = {}) {
  const root = new THREE.Group();
  const s = { eater: opts.eater ?? "character", allowed: opts.allowed ?? true, pos: { ...(opts.start ?? { x: 20, y: 0, z: 0.4 }) }, target: null as number | null };
  const log: string[] = [];
  const phases: Array<[SleepPhase, SleepPhase]> = [];
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
    phase: (p, prev) => phases.push([p, prev]),
    refuse: () => log.push("refuse"),
  };
  const hook = createSleepHook(w);
  const run = (seconds: number, dt = 1 / 30) => { for (let t = 0; t < seconds - 1e-9; t += dt) hook.update(dt); };
  /** The toy has walked to the bed. */
  const arrive = (bedX: number) => { s.pos.x = bedX; s.target = null; };
  const BED = { x: 31, z: -2.6 };
  const fallAsleep = (bed = BED) => { hook.tapBed(bed); arrive(bed.x); run(CLIMB_S + LYING_S + 3); };
  return { hook, s, log, phases, levels, root, run, arrive, BED, fallAsleep };
}

describe("starting", () => {
  it("tapping a bed sends the character walking along its own lane to the bed", () => {
    const g = game();
    expect(g.hook.tapBed(g.BED)).toBe(true);
    expect(g.log).toEqual(["walkTo:31,0.4"]);
    expect(g.hook.phase).toBe("walking");
    expect(g.hook.busy).toBe(true);
  });

  it("does nothing while the world says a sleep must not start", () => {
    const g = game({ allowed: false });
    expect(g.hook.tapBed(g.BED)).toBe(false);
    expect(g.log).toEqual([]);
    expect(g.hook.busy).toBe(false);
  });

  it("a robot or a vehicle politely refuses: the world is told, and nothing starts", () => {
    for (const eater of ["robot", "vehicle"] as const) {
      const g = game({ eater });
      expect(g.hook.tapBed(g.BED)).toBe(false);
      expect(g.log).toEqual(["refuse"]);
      expect(g.hook.busy).toBe(false);
    }
  });
});

describe("a night's sleep", () => {
  it("walks, hops up onto the real mattress, lies down once, falls asleep and the room darkens to full", () => {
    const g = game();
    g.hook.tapBed(g.BED);
    g.arrive(g.BED.x);
    g.run(CLIMB_S + 0.1);
    expect(g.s.pos).toEqual({ x: 31, y: MATTRESS_TOP, z: -2.6 });
    expect(g.log.filter((l) => l === "lieDown")).toHaveLength(1);
    g.run(LYING_S + 3);
    expect(g.hook.phase).toBe("asleep");
    expect(g.hook.level).toBe(1);
    expect(g.levels.at(-1)).toBe(1);
    expect(g.levels.every((v, i) => i === 0 || v >= g.levels[i - 1]!)).toBe(true);        // only ever darker on the way down
    expect(g.phases.map(([p]) => p)).toEqual(["walking", "climbing", "lying", "asleep"]);
  });

  it("a tap anywhere wakes it (and is swallowed), the room brightens, and it hops back to where it climbed from", () => {
    const g = game({ start: { x: 29.6, y: 0, z: 0.4 } });
    g.fallAsleep();
    expect(g.hook.consume()).toBe(true);
    expect(g.log.filter((l) => l === "getUp")).toHaveLength(1);
    g.run(WAKING_S + DOWN_S + 0.3);
    expect(g.hook.phase).toBe("awake");
    expect(g.hook.busy).toBe(false);
    expect(g.s.pos).toEqual({ x: 31, y: 0, z: 0.4 });          // beside the bed, on the floor, on its own lane
    expect(g.levels.at(-1)).toBe(0);
    expect(g.phases.map(([p]) => p).slice(-3)).toEqual(["waking", "descending", "awake"]);
  });

  it("ambient is told only when the level really changes, not every frame", () => {
    const g = game();
    g.fallAsleep();
    const n = g.levels.length;
    g.run(5);
    expect(g.levels.length).toBe(n);                            // deep asleep: steady
    expect(n).toBeLessThan(200);
  });
});

describe("consume", () => {
  it("is false and harmless when the toy is awake, and while it is still walking to the bed", () => {
    const g = game();
    expect(g.hook.consume()).toBe(false);
    g.hook.tapBed(g.BED);
    expect(g.hook.consume()).toBe(false);
    expect(g.hook.phase).toBe("walking");                       // not cancelled: the next tap is the player's own
  });

  it("swallows a tap mid-hop without waking it", () => {
    const g = game();
    g.hook.tapBed(g.BED);
    g.arrive(g.BED.x);
    g.run(0.2);
    expect(g.hook.phase).toBe("climbing");
    expect(g.hook.consume()).toBe(true);
    expect(g.hook.phase).toBe("climbing");
  });

  it("tapping the bed itself while asleep wakes it too (and only once)", () => {
    const g = game();
    g.fallAsleep();
    expect(g.hook.tapBed(g.BED)).toBe(true);
    expect(g.hook.phase).toBe("waking");
    expect(g.log.filter((l) => l === "getUp")).toHaveLength(1);
  });
});

describe("being sent elsewhere", () => {
  it("drops the sleep when the player sends the toy away from the bed while it walks", () => {
    const g = game();
    g.hook.tapBed(g.BED);
    g.run(0.3);
    expect(g.hook.phase).toBe("walking");
    g.s.target = 12;                                            // the player tapped the ground far away
    g.run(0.1);
    expect(g.hook.phase).toBe("awake");
    expect(g.log).toContain("stopWalk");
  });

  it("keeps walking when the target is still at the bed, or is gone because it got there", () => {
    const g = game();
    g.hook.tapBed(g.BED);
    g.s.target = 31 + REDIRECT_X - 0.05;
    g.run(0.3);
    expect(g.hook.phase).toBe("walking");
    g.s.target = null;
    g.run(0.3);
    expect(g.hook.phase).toBe("walking");
  });

  it("starts climbing only when the toy is close enough in x, and gives up if it never arrives", () => {
    const g = game();
    g.hook.tapBed(g.BED);
    g.s.pos.x = 31 - ARRIVE_X - 0.2;
    g.run(0.5);
    expect(g.hook.phase).toBe("walking");
    g.s.pos.x = 31 - ARRIVE_X + 0.05;
    g.run(0.1);
    expect(g.hook.phase).toBe("climbing");
    const h = game();
    h.hook.tapBed(h.BED);
    h.run(WALK_TIMEOUT_S + 0.5);
    expect(h.hook.phase).toBe("awake");
  });
});

describe("two beds", () => {
  it("aims at the bed that was tapped: a second bed gets its own mattress spot", () => {
    const g = game();
    g.fallAsleep({ x: 31, z: -2.6 });
    g.hook.consume();
    g.run(WAKING_S + DOWN_S + 0.3);
    const other = { x: 12, z: -2.2 };
    g.s.pos = { x: 12.1, y: 0, z: 0.4 };
    g.hook.tapBed(other);
    expect(g.hook.spot).toEqual({ x: 12, y: MATTRESS_TOP, z: -2.2 });
    g.arrive(12);
    g.run(CLIMB_S + 0.1);
    expect(g.s.pos).toEqual({ x: 12, y: MATTRESS_TOP, z: -2.2 });
  });
});

describe("the Zzz", () => {
  it("drift up from the sleeper's head, fade, and are removed from the world when they are done", () => {
    const g = game();
    g.hook.tapBed(g.BED);
    g.arrive(g.BED.x);
    g.run(CLIMB_S + LYING_S + FIRST_ZZZ_S + 0.15);
    expect(g.hook.bubbleCount).toBeGreaterThanOrEqual(1);
    const z = g.root.children[0] as THREE.Sprite;
    expect(z.isSprite).toBe(true);
    expect(z.position.x).toBeLessThan(31);                               // at the head end (-x)
    expect(z.position.y).toBeGreaterThan(MATTRESS_TOP + 0.5);
    const y0 = z.position.y, o0 = z.material.opacity;
    expect(o0).toBeGreaterThan(0);
    expect(o0).toBeLessThan(0.6);                                        // fading IN, not popping in
    g.run(1.0);
    expect(z.position.y - y0).toBeGreaterThan(0.3);                      // about half a unit a second
    expect(z.material.opacity).toBeGreaterThan(0.5);                     // clearly visible mid-flight
    g.run(ZZZ_RISE_S - 1.0 - 0.15 - 0.1);                                // nearly at the end of its life
    expect(z.material.opacity).toBeLessThan(0.25);                       // and fading out
    expect(z.position.y).toBeGreaterThan(y0);                            // rising
    expect(z.position.y).toBeLessThan(MATTRESS_TOP + ZZZ_FROM.y + ZZZ_RISE + 0.01);
    g.hook.consume();                                                    // wake: no new ones
    g.run(WAKING_S + DOWN_S + ZZZ_RISE_S + 0.5);
    expect(g.hook.bubbleCount).toBe(0);
    expect(g.root.children).toHaveLength(0);
  });

  it("are gone at once on reset", () => {
    const g = game();
    g.fallAsleep();
    expect(g.hook.bubbleCount).toBeGreaterThan(0);
    g.hook.reset();
    expect(g.hook.bubbleCount).toBe(0);
    expect(g.root.children).toHaveLength(0);
  });
});

describe("reset", () => {
  it("in deep sleep: the room is awake at once, the world is told the toy is awake, and it can start again", () => {
    const g = game();
    g.fallAsleep();
    g.hook.reset();
    expect(g.hook.phase).toBe("awake");
    expect(g.hook.busy).toBe(false);
    expect(g.levels.at(-1)).toBe(0);
    expect(g.phases.at(-1)![0]).toBe("awake");
    g.s.pos = { x: 31.1, y: 0, z: 0.4 };
    expect(g.hook.tapBed(g.BED)).toBe(true);
    expect(g.hook.phase).toBe("walking");
  });

  it("when nothing was happening the toy's phase is not announced, and the room is only ever told 'awake'", () => {
    const g = game();
    const n = g.phases.length;
    g.hook.reset();
    g.hook.reset();
    expect(g.phases.length).toBe(n);
    expect(g.levels.every((v) => v === 0)).toBe(true);
    expect(g.levels.length).toBeLessThanOrEqual(1);          // told once, not on every reset
  });
});

void vi;
