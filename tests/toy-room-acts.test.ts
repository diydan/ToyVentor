// Hug the teddy, jump on the cushions, kick the ball: a fake world stands in for the game; the visit routine, the jump path and the hearts are real.
import { readFileSync } from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { BALL_BOUNDS } from "../src/features/game/world/runtime/ballKick";
import { BLOW_PUFFS_S, HUG_SQUEEZE_S, KICK_CONTACT_S, MALLET_COUNT, MALLET_EVERY_S, MALLET_START_S, PET_STROKES_S, READ_PAGES_S, STRUM_COUNT, STRUM_EVERY_S } from "../src/features/game/world/runtime/proceduralClips";
import type { PropInst } from "../src/features/game/world/runtime/propReactions";
import { BAR_COUNT } from "../src/features/game/world/runtime/xylophone";
import {
  ACT_FOR_PROP, MALLET_S, MALLET_STAND, TUNE, BLOW_S, BLOW_STAND, BUBBLES_PER_PUFF, CUSHION_TOP, HEART_RISE, HEART_RISE_S, HUG_S, HUG_SECOND_SQUEEZE_S, HUG_STAND, JUMP_BOUNCES, JUMP_DOWN_S, JUMP_STAND, JUMP_UP_S, FOLLOW_STAND, PET_CUE_S, PET_S, PET_STAND, PLAY_S, PLAY_STAND, READ_NAMES, READ_S, READ_STAND, RIFF, KICK_ROOM, KICK_S, KICK_STAND, KICK_VX, KICK_VY,
  createActs, jumpPath, type JumpPlan,
} from "../src/features/game/world/runtime/toyRoomActs";
import type { VisitPhase } from "../src/features/game/world/runtime/visitRoutine";

const PLAN: JumpPlan = { standX: 20.3, cushX: 22, topY: CUSHION_TOP, z0: 0.4, zTop: -2.25 };

describe("jumpPath", () => {
  it("starts and ends exactly on the floor where it stood, and is clamped outside the jump", () => {
    expect(jumpPath(0, PLAN)).toEqual({ x: 20.3, y: 0, z: 0.4 });
    expect(jumpPath(JUMP_DOWN_S, PLAN)).toEqual({ x: 20.3, y: 0, z: 0.4 });
    expect(jumpPath(-5, PLAN)).toEqual({ x: 20.3, y: 0, z: 0.4 });
    expect(jumpPath(99, PLAN)).toEqual({ x: 20.3, y: 0, z: 0.4 });
    expect(jumpPath(Number.NaN, PLAN)).toEqual({ x: 20.3, y: 0, z: 0.4 });
  });

  it("lands exactly on top of the pile at the end of the hop up and after each bounce, standing over it", () => {
    for (const t of [JUMP_UP_S, ...JUMP_BOUNCES.map((b) => b.end).slice(0, -1)]) {
      const p = jumpPath(t, PLAN);
      expect(p.y, `landing at ${t}`).toBeCloseTo(CUSHION_TOP, 6);
      expect(p.x).toBeCloseTo(22, 6);
      expect(p.z).toBeCloseTo(-2.25, 6);
    }
    const last = jumpPath(JUMP_BOUNCES.at(-1)!.end, PLAN);              // the third bounce ends and the hop down begins
    expect(last.y).toBeCloseTo(CUSHION_TOP, 6);
  });

  it("each bounce is lower than the one before, by the amount authored", () => {
    let from = JUMP_UP_S;
    const apexes: number[] = [];
    for (const b of JUMP_BOUNCES) { apexes.push(jumpPath((from + b.end) / 2, PLAN).y - CUSHION_TOP); from = b.end; }
    expect(apexes.map((a) => +a.toFixed(6))).toEqual(JUMP_BOUNCES.map((b) => +b.height.toFixed(6)));
    for (let i = 1; i < apexes.length; i++) expect(apexes[i]!).toBeLessThan(apexes[i - 1]!);
  });

  it("is continuous (no teleporting), never below the floor, and stays between where it started and the pile", () => {
    let prev = jumpPath(0, PLAN);
    for (let t = 1 / 60; t <= JUMP_DOWN_S + 0.01; t += 1 / 60) {
      const p = jumpPath(t, PLAN);
      expect(Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z), `step at ${t.toFixed(3)}`).toBeLessThan(0.2);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeGreaterThanOrEqual(PLAN.standX - 1e-9);
      expect(p.x).toBeLessThanOrEqual(PLAN.cushX + 1e-9);
      expect(p.z).toBeGreaterThanOrEqual(PLAN.zTop - 1e-9);
      expect(p.z).toBeLessThanOrEqual(PLAN.z0 + 1e-9);
      prev = p;
    }
  });

  it("goes up onto the pile moving steadily towards it, and back down moving steadily away", () => {
    let prev = PLAN.standX;
    for (let t = 0.02; t <= JUMP_UP_S; t += 0.02) { const x = jumpPath(t, PLAN).x; expect(x).toBeGreaterThanOrEqual(prev - 1e-9); prev = x; }
    prev = PLAN.cushX;
    for (let t = JUMP_BOUNCES.at(-1)!.end; t <= JUMP_DOWN_S; t += 0.02) { const x = jumpPath(t, PLAN).x; expect(x).toBeLessThanOrEqual(prev + 1e-9); prev = x; }
  });

  it("eases into the hop up (a quarter of the way in time is less than a quarter of the way across) and swings back to its own lane on the way down", () => {
    const quarter = jumpPath(JUMP_UP_S * 0.25, PLAN);
    expect((quarter.x - PLAN.standX) / (PLAN.cushX - PLAN.standX)).toBeLessThan(0.2);
    let prevZ = PLAN.zTop;
    for (let t = JUMP_BOUNCES.at(-1)!.end; t <= JUMP_DOWN_S; t += 0.02) { const z = jumpPath(t, PLAN).z; expect(z).toBeGreaterThanOrEqual(prevZ - 1e-9); prevZ = z; }
    expect(jumpPath(JUMP_DOWN_S - 0.02, PLAN).z).toBeGreaterThan(PLAN.z0 - 0.15);       // nearly back on its lane just before it lands
  });

  it("rises well above the pile on the hop up (so it clearly jumps, not slides)", () => {
    expect(Math.max(...Array.from({ length: 30 }, (_, i) => jumpPath((i / 30) * JUMP_UP_S, PLAN).y))).toBeGreaterThan(CUSHION_TOP + 0.5);
  });
});

function inst(type: string, px: number, pz = -2.4, h = 2): PropInst {
  return { type, base: { px, pz }, size: new THREE.Vector3(1.6, h, 1.6) } as unknown as PropInst;
}

function game(opts: { eater?: "character" | "robot" | "vehicle"; allowed?: boolean; start?: { x: number; y: number; z: number }; fetch?: boolean } = {}) {
  const root = new THREE.Group();
  const s = { eater: opts.eater ?? "character", allowed: opts.allowed ?? true, pos: { ...(opts.start ?? { x: 12, y: 0, z: 0.4 }) }, target: null as number | null };
  const log: string[] = [];
  const phases: VisitPhase[] = [];
  const places: Array<[number, number, number]> = [];
  const squished: PropInst[] = [];
  const kicks: Array<{ inst: PropInst; vx: number; vy: number }> = [];
  const tones: number[] = [];
  const held: string[] = [];
  const blows: Array<{ from: { x: number; y: number; z: number }; dir: number; n: number }> = [];
  const says: PropInst[] = [], flutters: PropInst[] = [], cues: Array<[PropInst, string]> = [], visibility: Array<[PropInst, boolean]> = [];
  const nearbyCalls: Array<[number, number, ReadonlyArray<string> | undefined]> = [];
  const nearbyList: PropInst[] = [];
  const fetches: PropInst[] = [];
  const strikes: Array<[PropInst, number]> = [];
  const w = {
    position: () => ({ ...s.pos }), targetX: () => s.target,
    walkTo: (x: number, z: number) => { s.target = x; log.push(`walkTo:${+x.toFixed(3)},${z}`); },
    stopWalk: () => { s.target = null; log.push("stopWalk"); },
    face: (d: 1 | -1) => log.push(`face:${d}`),
    root: () => root, eater: () => s.eater, allowed: () => s.allowed,
    clip: (a: string) => { log.push(`clip:${a}`); return true; },
    setPosition: (x: number, y: number, z: number) => { s.pos = { x, y, z }; places.push([x, y, z]); },
    tone: (f: number) => { tones.push(f); },
    phase: (p: VisitPhase) => phases.push(p),
    ...(opts.fetch === undefined ? {} : { fetch: (b: PropInst) => { fetches.push(b); log.push("fetch"); return opts.fetch!; } }),
    hold: (i: string) => { held.push(`hold:${i}`); log.push(`hold:${i}`); },
    release: () => { held.push("release"); log.push("release"); },
    mouth: (d: number) => ({ x: s.pos.x + 0.5 * d, y: 1.8, z: s.pos.z }),
    bubbles: { blow: (from: { x: number; y: number; z: number }, dir: number, n: number) => { blows.push({ from, dir, n }); } },
    fx: {
      squish: (i: PropInst) => { squished.push(i); }, strike: (i: PropInst, b: number) => { strikes.push([i, b]); return 262; }, kickBall: (i: PropInst, vx: number, vy: number) => { kicks.push({ inst: i, vx, vy }); return true; },
      flutter: (i: PropInst) => { flutters.push(i); }, say: (i: PropInst) => { says.push(i); },
      setVisible: (i: PropInst, v: boolean) => { visibility.push([i, v]); log.push(`visible:${v}`); },
      cue: (i: PropInst, n: string) => { cues.push([i, n]); },
      nearby: (x: number, n: number, ex?: ReadonlyArray<string>) => { nearbyCalls.push([x, n, ex]); return nearbyList.slice(0, n); },
    },
  };
  const acts = createActs(w as never);
  const run = (seconds: number, dt = 1 / 30) => { for (let t = 0; t < seconds - 1e-9; t += dt) acts.update(dt); };
  const arriveAt = (x: number) => { s.pos.x = x; s.target = null; };
  return { acts, s, log, phases, places, squished, kicks, tones, root, run, arriveAt, held, blows, says, flutters, cues, visibility, nearbyCalls, nearbyList, fetches, strikes };
}

describe("which props do something", () => {
  it("the teddy is hugged, the ball kicked, the cushions jumped on, a book read, the guitar played, the bubbles blown and the dog petted; nothing else starts an act", () => {
    expect(ACT_FOR_PROP).toEqual({ teddy: "hug", ball: "kick", cushions: "jump", books: "read", guitar: "play", bubbles: "blow", dog: "pet", xylophone: "mallet", cup: "spill", toybox: "dump", cleancart: "scrub", hob: "cook", puffcloud: "jump", tire: "roll", angelpatch: "angel", flowerbed: "water", bunny: "feed", picnic: "picnic", swing: "ride" });
    const g = game();
    for (const type of ["lamp", "blocks", "chair", "plant", "bed", "tree", "unknown"]) expect(g.acts.tap(inst(type, 20)), type).toBe(false);
    expect(g.log).toEqual([]);
  });
});

describe("hugging the teddy", () => {
  const teddy = inst("teddy", 25, -2.2, 2);
  it("walks to just left of it, turns to face it, plays the hug, squeezes twice with a heart each time, and finishes", () => {
    const g = game();
    expect(g.acts.tap(teddy)).toBe(true);
    expect(g.log).toEqual([`walkTo:${25 - HUG_STAND},0.4`]);
    g.arriveAt(25 - HUG_STAND);
    g.run(0.1);
    expect(g.log.slice(1)).toEqual(["face:1", "clip:hug"]);
    expect(g.squished).toHaveLength(0);
    g.run(HUG_SQUEEZE_S);
    expect(g.squished).toEqual([teddy]);
    expect(g.acts.heartCount).toBe(1);
    g.run(HUG_SECOND_SQUEEZE_S - HUG_SQUEEZE_S);
    expect(g.squished).toHaveLength(2);
    expect(g.acts.heartCount).toBe(2);
    g.run(HUG_S - HUG_SECOND_SQUEEZE_S + 0.2);
    expect(g.acts.busy).toBe(false);
    expect(g.phases).toEqual(["walking", "acting", "idle"]);
    expect(g.tones.length).toBe(2);
    expect(g.tones[1]!).toBeGreaterThan(g.tones[0]!);
  });

  it("the hearts start at the teddy's head, float up and sway, fade in and out, and are removed from the world when done", () => {
    const g = game();
    g.acts.tap(teddy);
    g.arriveAt(25 - HUG_STAND);
    g.run(HUG_SQUEEZE_S + 0.2);
    const h = g.root.children[0] as THREE.Sprite;
    expect(h.isSprite).toBe(true);
    expect(h.position.y).toBeGreaterThan(1.8);                           // at the teddy's head (its height is 2)
    expect(Math.abs(h.position.x - 25)).toBeLessThan(0.5);
    expect(h.material.opacity).toBeLessThan(0.7);                        // fading in
    const y0 = h.position.y;
    g.run(0.6);
    expect(h.position.y).toBeGreaterThan(y0);
    expect(h.material.opacity).toBeGreaterThan(0.5);
    g.run(HEART_RISE_S);
    expect(h.position.y).toBeLessThan(2 * 0.95 + HEART_RISE + 0.01);
    g.run(HUG_S + HEART_RISE_S);
    expect(g.acts.heartCount).toBe(0);
    expect(g.root.children).toHaveLength(0);
  });
});

describe("kicking the ball", () => {
  it("walks to just behind it (on the room side), plays the kick and launches it at the contact moment, towards the room", () => {
    const b = inst("ball", 10, -2);
    const g = game();
    g.acts.tap(b);
    expect(g.log).toEqual([`walkTo:${10 - KICK_STAND},0.4`]);
    g.arriveAt(10 - KICK_STAND);
    g.run(0.1);
    expect(g.log.slice(1)).toEqual(["face:1", "clip:kick"]);
    expect(g.kicks).toHaveLength(0);                                      // not yet: the foot has not reached it
    g.run(KICK_CONTACT_S);
    expect(g.kicks).toEqual([{ inst: b, vx: KICK_VX, vy: KICK_VY }]);
    g.run(KICK_S);
    expect(g.acts.busy).toBe(false);
    expect(g.kicks).toHaveLength(1);                                      // exactly one kick
  });

  it("a ball is kicked to the right (where the camera shows most room), even in the far half of the room", () => {
    const b = inst("ball", 30, -2);
    const g = game({ start: { x: 25, y: 0, z: 0 } });
    g.acts.tap(b);
    expect(g.log[0]).toBe(`walkTo:${30 - KICK_STAND},0`);
    g.arriveAt(30 - KICK_STAND);
    g.run(0.1);
    expect(g.log).toContain("face:1");
    g.run(KICK_CONTACT_S);
    expect(g.kicks[0]!.vx).toBe(KICK_VX);
  });

  it("a ball too near the right wall for a kick to the right is kicked back the other way", () => {
    const b = inst("ball", BALL_BOUNDS[1] - KICK_ROOM + 0.5, -2);
    const g = game({ start: { x: 38, y: 0, z: 0 } });
    g.acts.tap(b);
    expect(g.log[0]).toBe(`walkTo:${b.base.px + KICK_STAND},0`);
    g.arriveAt(b.base.px + KICK_STAND);
    g.run(0.1);
    expect(g.log).toContain("face:-1");
    g.run(KICK_CONTACT_S);
    expect(g.kicks[0]!.vx).toBe(-KICK_VX);
  });

  it("a ball against the left wall is kicked the way that leaves room to stand", () => {
    const b = inst("ball", 1.2, -2);
    const g = game({ start: { x: 5, y: 0, z: 0 } });
    g.acts.tap(b);
    const stand = +g.log[0]!.split(":")[1]!.split(",")[0]!;
    expect(stand).toBeGreaterThanOrEqual(BALL_BOUNDS[0]);
  });
});

describe("reading a book", () => {
  const books = inst("books", 16.5, -2.6, 1.2);
  const teddy = inst("teddy", 15), ball = inst("ball", 18), cush = inst("cushions", 19);
  it("walks to just left of the stack, picks up a book and reads the names of the three nearest things aloud, turning a page for each", () => {
    const g = game();
    g.nearbyList.push(teddy, ball, cush);
    expect(g.acts.tap(books)).toBe(true);
    expect(g.log).toEqual([`walkTo:${16.5 - READ_STAND},0.4`]);
    g.arriveAt(16.5 - READ_STAND);
    g.run(0.1);
    expect(g.log.slice(1)).toEqual(["face:1", "hold:book", "clip:read"]);
    expect(g.nearbyCalls).toEqual([[16.5, READ_NAMES, ["books"]]]);          // the nearest three things that are not books
    g.run(READ_PAGES_S[0]!);
    expect(g.says).toEqual([teddy]);
    expect(g.flutters).toEqual([books]);
    g.run(READ_PAGES_S[1]! - READ_PAGES_S[0]!);
    expect(g.says).toEqual([teddy, ball]);
    g.run(READ_PAGES_S[2]! - READ_PAGES_S[1]!);
    expect(g.says).toEqual([teddy, ball, cush]);
    expect(g.flutters).toHaveLength(3);
    expect(g.acts.busy).toBe(true);
    g.run(READ_S - READ_PAGES_S[2]! + 0.2);
    expect(g.acts.busy).toBe(false);
    expect(g.log.at(-1)).toBe("release");                                    // the book is put away
  });

  it("with nothing else around it reads out the book's own name on every page", () => {
    const g = game();
    g.acts.tap(books);
    g.arriveAt(16.5 - READ_STAND);
    g.run(READ_S + 0.2);
    expect(g.says).toEqual([books, books, books]);
  });

  it("with fewer than three things around it goes round them again", () => {
    const g = game();
    g.nearbyList.push(teddy);
    g.acts.tap(books);
    g.arriveAt(16.5 - READ_STAND);
    g.run(READ_S + 0.2);
    expect(g.says).toEqual([teddy, teddy, teddy]);
    g.nearbyList.push(ball);
    const h = game();
    h.nearbyList.push(teddy, ball);
    h.acts.tap(books);
    h.arriveAt(16.5 - READ_STAND);
    h.run(READ_S + 0.2);
    expect(h.says).toEqual([teddy, ball, teddy]);
  });

  it("cut short, the book is still put away", () => {
    const g = game();
    g.acts.tap(books);
    g.arriveAt(16.5 - READ_STAND);
    g.run(1.5);
    g.acts.reset();
    expect(g.log.at(-1)).toBe("release");
    g.run(5);
    expect(g.says.length).toBe(1);
  });
});

describe("playing the guitar", () => {
  const guitar = inst("guitar", 18, -2.4, 3);
  it("picks the guitar up off its stand (it disappears from the stand), strums the tune and puts it back", () => {
    const g = game();
    expect(g.acts.tap(guitar)).toBe(true);
    expect(g.log).toEqual([`walkTo:${18 - PLAY_STAND},0.4`]);
    g.arriveAt(18 - PLAY_STAND);
    g.run(0.1);
    expect(g.log.slice(1)).toEqual(["face:1", "visible:false", "hold:guitar", "clip:strum"]);
    g.run(PLAY_S + 0.2);
    expect(g.acts.busy).toBe(false);
    expect(g.log.slice(-2)).toEqual(["release", "visible:true"]);
    expect(g.visibility).toEqual([[guitar, false], [guitar, true]]);
  });

  it("plays a chord on every downstroke and one bright note on every upstroke, to the tune, one strum after another", () => {
    const g = game();
    g.acts.tap(guitar);
    g.arriveAt(18 - PLAY_STAND);
    g.run(0.1);
    expect(g.tones).toEqual([]);                                             // nothing before the first strum
    g.run(PLAY_S + 0.2);
    const expected: number[] = [];
    for (let i = 0; i < STRUM_COUNT; i++) {
      const f = RIFF[i]!;
      if (i % 2 === 0) expected.push(f, f * 1.25, f * 1.5); else expected.push(f * 2);
    }
    expect(g.tones).toEqual(expected);
    expect(g.tones.length).toBe(Math.ceil(STRUM_COUNT / 2) * 3 + Math.floor(STRUM_COUNT / 2));
  });

  it("the first strum comes after the hand has settled (about 0.5 s), then one every STRUM_EVERY_S", () => {
    const g = game();
    g.acts.tap(guitar);
    g.arriveAt(18 - PLAY_STAND);
    g.run(0.3);
    expect(g.tones).toHaveLength(0);
    g.run(0.25);
    expect(g.tones).toHaveLength(3);
    g.run(STRUM_EVERY_S);
    expect(g.tones).toHaveLength(4);
    g.run(STRUM_EVERY_S);
    expect(g.tones).toHaveLength(7);
  });

  it("music notes float up from the guitar as it plays and are gone afterwards", () => {
    const g = game();
    g.acts.tap(guitar);
    g.arriveAt(18 - PLAY_STAND);
    g.run(1.5);
    expect(g.acts.noteCount).toBeGreaterThanOrEqual(2);
    expect(g.acts.heartCount).toBe(0);
    const n = g.root.children[0] as THREE.Sprite;
    expect(n.position.y).toBeGreaterThan(2.2);
    g.run(PLAY_S + HEART_RISE_S + 0.5);
    expect(g.acts.noteCount).toBe(0);
    expect(g.root.children).toHaveLength(0);
  });

  it("cut short, the guitar goes back on its stand and is not left in Kip's hands", () => {
    const g = game();
    g.acts.tap(guitar);
    g.arriveAt(18 - PLAY_STAND);
    g.run(1);
    g.acts.reset();
    expect(g.log.slice(-2)).toEqual(["release", "visible:true"]);
  });
});

describe("blowing bubbles", () => {
  const bottle = inst("bubbles", 37.8, -2.2, 2);
  it("picks up the wand and blows four puffs of bubbles from its mouth, then puts the wand back", () => {
    const g = game({ start: { x: 34, y: 0, z: 0.4 } });
    expect(g.acts.tap(bottle)).toBe(true);
    expect(g.log).toEqual([`walkTo:${37.8 - BLOW_STAND},0.4`]);
    g.arriveAt(37.8 - BLOW_STAND);
    g.run(0.1);
    expect(g.log.slice(1)).toEqual(["face:1", "hold:wand", "clip:blow"]);
    expect(g.blows).toHaveLength(0);
    g.run(BLOW_PUFFS_S[0]!);
    expect(g.blows).toHaveLength(1);
    g.run(BLOW_S);
    expect(g.blows).toHaveLength(BLOW_PUFFS_S.length);
    for (const b of g.blows) { expect(b.n).toBe(BUBBLES_PER_PUFF); expect(b.dir).toBe(1); expect(b.from.y).toBeCloseTo(1.8, 6); expect(b.from.x).toBeGreaterThan(37.8 - BLOW_STAND); }
    expect(g.log.at(-1)).toBe("release");
    expect(g.acts.busy).toBe(false);
  });

  it("cut short, the wand is put away and no more bubbles come", () => {
    const g = game({ start: { x: 34, y: 0, z: 0.4 } });
    g.acts.tap(bottle);
    g.arriveAt(37.8 - BLOW_STAND);
    g.run(0.8);
    g.acts.reset();
    const n = g.blows.length;
    expect(g.log.at(-1)).toBe("release");
    g.run(4);
    expect(g.blows.length).toBe(n);
  });
});

describe("petting the dog", () => {
  const dog = inst("dog", 42, -2, 1.6);
  it("walks to just left of the dog, crouches to pet it (the dog is told, and answers by wagging) with a heart at each stroke", () => {
    const g = game({ start: { x: 38, y: 0, z: 0.4 } });
    expect(g.acts.tap(dog)).toBe(true);
    expect(g.log).toEqual([`walkTo:${42 - PET_STAND},0.4`]);
    g.arriveAt(42 - PET_STAND);
    g.run(0.1);
    expect(g.log.slice(1)).toEqual(["face:1", "clip:pet"]);
    expect(g.cues).toEqual([]);                                              // not at once: the dog has just barked at the tap, let it finish
    g.run(PET_CUE_S + 0.1);
    expect(g.cues).toEqual([[dog, "pet"]]);
    let most = 0;
    for (let t = 0; t < PET_S + 0.3; t += 1 / 30) { g.acts.update(1 / 30); most = Math.max(most, g.acts.heartCount); }
    expect(most).toBe(PET_STROKES_S.length);                                  // a heart on each stroke
    expect(g.acts.busy).toBe(false);
  });

  it("hearts rise from just above the dog's back", () => {
    const g = game({ start: { x: 38, y: 0, z: 0.4 } });
    g.acts.tap(dog);
    g.arriveAt(42 - PET_STAND);
    g.run(PET_STROKES_S[0]! + 0.3);
    const h = g.root.children[0] as THREE.Sprite;
    expect(h.position.y).toBeGreaterThan(1.7);
    expect(Math.abs(h.position.x - 42)).toBeLessThan(0.6);
  });
});

describe("a dog that fetches", () => {
  const ball = () => ({ ...inst("ball", 10, -2), kick: null });
  it("is sent after the ball at the moment of contact, once, and not before", () => {
    const g = game({ fetch: true });
    const b = ball();
    g.acts.tap(b);
    g.arriveAt(10 - KICK_STAND);
    g.run(KICK_CONTACT_S - 0.1);
    expect(g.fetches).toHaveLength(0);
    g.run(0.3);
    expect(g.fetches).toEqual([b]);
    expect(g.kicks).toHaveLength(1);
    expect(g.log.indexOf("fetch")).toBeGreaterThan(g.log.indexOf("clip:kick"));
    g.run(KICK_S + 2);
    expect(g.fetches).toHaveLength(1);
  });

  it("saves Kip the trot: it does not walk after the ball when the dog is bringing it back", () => {
    const g = game({ fetch: true });
    const b = ball();
    g.acts.tap(b);
    g.arriveAt(10 - KICK_STAND);
    g.run(KICK_CONTACT_S + 0.1);
    (b as { kick: unknown }).kick = { moving: true };
    g.run(KICK_S);
    g.log.length = 0;
    (b as { kick: unknown }).kick = null;
    (b as { base: { px: number } }).base.px = 14.2;
    g.run(3);
    expect(g.log.filter((l) => l.startsWith("walkTo"))).toEqual([]);
  });

  it("with no dog in the room (fetch says no, or there is no fetch at all) Kip trots after the ball as before", () => {
    for (const fetch of [false, undefined]) {
      const g = game({ fetch });
      const b = ball();
      g.acts.tap(b);
      g.arriveAt(10 - KICK_STAND);
      g.run(KICK_CONTACT_S + 0.1);
      (b as { kick: unknown }).kick = { moving: true };
      g.run(KICK_S);
      g.log.length = 0;
      (b as { kick: unknown }).kick = null;
      (b as { base: { px: number } }).base.px = 14.2;
      g.run(0.3);
      expect(g.log.filter((l) => l.startsWith("walkTo")), String(fetch)).toHaveLength(1);
    }
  });
});

describe("playing the xylophone", () => {
  const mallets = new THREE.Group();
  const xylo = { ...inst("xylophone", 3.6, -2.6, 2), holder: { userData: { mallets } } } as unknown as PropInst;
  it("walks to just left of it, plays the tune with a mallet in each hand, a bar at a time, and finishes", () => {
    const g = game({ start: { x: 1, y: 0, z: 0.4 } });
    expect(g.acts.tap(xylo)).toBe(true);
    expect(g.log).toEqual([`walkTo:${+(3.6 - MALLET_STAND).toFixed(3)},0.4`]);
    g.arriveAt(3.6 - MALLET_STAND);
    g.run(0.1);
    expect(g.log.slice(1)).toEqual(["face:1", "hold:mallets", "clip:mallet"]);
    expect(g.strikes).toHaveLength(0);                                      // nothing before the first stroke
    g.run(MALLET_S + 0.2);
    expect(g.strikes).toEqual(TUNE.slice(0, MALLET_COUNT).map((bar) => [xylo, bar]));
    expect(g.acts.busy).toBe(false);
    expect(g.log.at(-1)).toBe("release");
  });

  it("takes the mallets off the ledge into its hands while it plays, and puts them back when it is done", () => {
    const g = game({ start: { x: 1, y: 0, z: 0.4 } });
    mallets.visible = true;
    g.acts.tap(xylo);
    expect(mallets.visible).toBe(true);                                     // still walking over: they are on the ledge
    g.arriveAt(3.6 - MALLET_STAND);
    g.run(1.5);
    expect(mallets.visible).toBe(false);
    expect(g.held).toEqual(["hold:mallets"]);
    g.run(MALLET_S + 0.2);
    expect(mallets.visible).toBe(true);
    expect(g.held).toEqual(["hold:mallets", "release"]);
  });

  it("cut short, the mallets are back on the ledge and out of its hands", () => {
    const g = game({ start: { x: 1, y: 0, z: 0.4 } });
    mallets.visible = true;
    g.acts.tap(xylo);
    g.arriveAt(3.6 - MALLET_STAND);
    g.run(1.2);
    expect(mallets.visible).toBe(false);
    g.acts.reset();
    expect(mallets.visible).toBe(true);
    expect(g.held.at(-1)).toBe("release");
  });

  it("a xylophone with no mallet group (built some other way) is still played", () => {
    const g = game({ start: { x: 1, y: 0, z: 0.4 } });
    const bare = inst("xylophone", 3.6, -2.6, 2);
    expect(g.acts.tap(bare)).toBe(true);
    g.arriveAt(3.6 - MALLET_STAND);
    g.run(MALLET_S + 0.2);
    expect(g.strikes).toHaveLength(MALLET_COUNT);
  });

  it("strikes each bar when its stroke lands: the first after about half a second, then one every MALLET_EVERY_S", () => {
    const g = game({ start: { x: 1, y: 0, z: 0.4 } });
    g.acts.tap(xylo);
    g.arriveAt(3.6 - MALLET_STAND);
    g.run(MALLET_START_S - 0.1);
    expect(g.strikes).toHaveLength(0);
    g.run(0.25);
    expect(g.strikes).toHaveLength(1);
    g.run(MALLET_EVERY_S);
    expect(g.strikes).toHaveLength(2);
    g.run(MALLET_EVERY_S);
    expect(g.strikes).toHaveLength(3);
  });

  it("is a tune on the five bars: Mary had a little lamb (E D C D E E E, D D D, E G G) and home to C", () => {
    expect(TUNE).toHaveLength(MALLET_COUNT);
    expect(TUNE).toEqual([2, 1, 0, 1, 2, 2, 2, 1, 1, 1, 2, 3, 3, 0]);
    expect(Math.max(...TUNE)).toBeLessThan(BAR_COUNT);                       // only bars the xylophone has
    expect(Math.min(...TUNE)).toBeGreaterThanOrEqual(0);
    expect(new Set(TUNE).size).toBe(4);                                      // C, D, E and G
    expect(TUNE.at(-1)).toBe(0);                                             // it ends on the home note
    expect(TUNE.slice(0, 3)).toEqual([2, 1, 0]);                             // and begins with the three notes everyone knows
  });
  it("music notes float up from the bars it hits", () => {
    const g = game({ start: { x: 1, y: 0, z: 0.4 } });
    g.acts.tap(xylo);
    g.arriveAt(3.6 - MALLET_STAND);
    g.run(1.8);
    expect(g.acts.noteCount).toBeGreaterThanOrEqual(2);
    const n = g.root.children[0] as THREE.Sprite;
    expect(n.position.y).toBeGreaterThan(2.4);
    expect(Math.abs(n.position.x - 3.6)).toBeLessThan(2.2);
    g.run(MALLET_S + 2);
    expect(g.acts.noteCount).toBe(0);
  });

  it("cut short, no more bars are struck", () => {
    const g = game({ start: { x: 1, y: 0, z: 0.4 } });
    g.acts.tap(xylo);
    g.arriveAt(3.6 - MALLET_STAND);
    g.run(1.2);
    const n = g.strikes.length;
    expect(n).toBeGreaterThan(0);
    g.acts.reset();
    g.run(4);
    expect(g.strikes.length).toBe(n);
  });
});

describe("following the ball", () => {
  const ball = () => ({ ...inst("ball", 10, -2), kick: null });
  function kicked(g: ReturnType<typeof game>, b: ReturnType<typeof ball>) {
    g.acts.tap(b);
    g.arriveAt(10 - KICK_STAND);
    g.run(KICK_CONTACT_S + 0.1);
    (b as { kick: unknown }).kick = { moving: true };                    // the world's ball is flying now
    g.run(KICK_S);
    expect(g.acts.busy).toBe(false);
  }
  it("waits while the ball is still moving, then trots after it once it stops and stands behind it", () => {
    const g = game();
    const b = ball();
    kicked(g, b);
    g.log.length = 0;
    g.run(1);
    expect(g.log).toEqual([]);                                            // still rolling: Kip waits
    (b as { kick: unknown }).kick = null;
    (b as { base: { px: number } }).base.px = 14.2;                       // it stopped further along
    g.run(0.1);
    expect(g.log).toEqual([`walkTo:${+(14.2 - FOLLOW_STAND).toFixed(3)},0.4`]);
    g.run(2);
    expect(g.log).toHaveLength(1);                                        // once, not repeatedly
  });

  it("does not bother when it is already close behind the ball", () => {
    const g = game();
    const b = ball();
    kicked(g, b);
    g.log.length = 0;
    (b as { kick: unknown }).kick = null;
    (b as { base: { px: number } }).base.px = 10 + 0.5;
    g.s.pos.x = 10.5 - FOLLOW_STAND + 0.2;
    g.run(0.2);
    expect(g.log).toEqual([]);
  });

  it("a new tap, a reset, or a world that says no stops the following", () => {
    for (const how of ["tap", "reset", "disallow"] as const) {
      const g = game();
      const b = ball();
      kicked(g, b);
      g.log.length = 0;
      if (how === "tap") { g.acts.tap(inst("teddy", 20)); g.arriveAt(20 - HUG_STAND); }       // the player taps the teddy instead
      if (how === "reset") g.acts.reset();
      if (how === "disallow") g.s.allowed = false;
      g.log.length = 0;
      (b as { kick: unknown }).kick = null;
      (b as { base: { px: number } }).base.px = 15;
      g.run(HUG_S + 1);                                                  // long enough for a hug to finish, so only a stale "following" could still send Kip after the ball
      expect(g.log.filter((l) => l.startsWith("walkTo:13")), how).toEqual([]);
    }
  });

  it("a kick cut short by a reset is not followed", () => {
    const g = game();
    const b = ball();
    g.acts.tap(b);
    g.arriveAt(10 - KICK_STAND);
    g.run(0.3);
    g.acts.reset();                                                        // cut short before the foot met the ball
    g.log.length = 0;
    g.run(1);
    expect(g.log).toEqual([]);
  });
});

describe("jumping on the cushions", () => {
  const cush = inst("cushions", 22, -2.6, 0.8);
  it("walks to just left of the pile, hops up (cheering), bounces three times with a squish and a boing each, and hops down to where it stood", () => {
    const g = game({ start: { x: 12, y: 0, z: 0.4 } });
    g.acts.tap(cush);
    expect(g.log).toEqual([`walkTo:${22 - JUMP_STAND},0.4`]);
    g.arriveAt(22 - JUMP_STAND);
    g.run(JUMP_UP_S + 0.1);
    expect(g.log).toContain("clip:cheer");
    expect(g.squished).toHaveLength(1);                                   // the first landing on the pile
    expect(g.s.pos.y).toBeGreaterThan(0);
    g.run(JUMP_DOWN_S);
    expect(g.acts.busy).toBe(false);
    expect(g.squished).toHaveLength(4);                                   // up, then three bounces
    expect(g.tones.length).toBe(5);                                       // a take-off whoosh and four boings
    expect(g.tones.slice(1)).toEqual([...g.tones.slice(1)].sort((a, b) => a - b));       // the boings rise
    expect(g.log.filter((l) => l === "clip:cheer")).toHaveLength(1);
    expect(g.s.pos).toEqual({ x: 22 - JUMP_STAND, y: 0, z: 0.4 });         // back on the floor where it started
    expect(g.places.some((p) => p[1] > CUSHION_TOP)).toBe(true);           // it really went above the pile
  });

  it("takes off with the Mixamo jump clip (the pose; the path lifts it) and then cheers at the top: jump first, cheer second, each once", () => {
    const g = game({ start: { x: 12, y: 0, z: 0.4 } });
    g.acts.tap(cush);
    g.arriveAt(22 - JUMP_STAND);
    g.run(0.05);
    expect(g.log.filter((l) => l.startsWith("clip:"))).toEqual(["clip:jump"]);                 // at once, as it leaves the floor
    g.run(JUMP_UP_S + 0.1);
    expect(g.log.filter((l) => l.startsWith("clip:"))).toEqual(["clip:jump", "clip:cheer"]);
    g.run(JUMP_DOWN_S);
    expect(g.log.filter((l) => l === "clip:jump")).toHaveLength(1);
  });

  it("cut short (a reset) it is put back on the floor where it started", () => {
    const g = game({ start: { x: 12, y: 0, z: 0.4 } });
    g.acts.tap(cush);
    g.arriveAt(22 - JUMP_STAND);
    g.run(1.2);
    expect(g.s.pos.y).toBeGreaterThan(0.3);
    g.acts.reset();
    expect(g.s.pos).toEqual({ x: 22 - JUMP_STAND, y: 0, z: 0.4 });
    expect(g.acts.busy).toBe(false);
  });
});

describe("when nothing starts", () => {
  it("a vehicle or a robot lets the prop react alone: no walking, no act", () => {
    for (const eater of ["vehicle", "robot"] as const) {
      const g = game({ eater });
      expect(g.acts.tap(inst("teddy", 25))).toBe(false);
      expect(g.log).toEqual([]);
    }
  });
  it("nothing starts while the world says no", () => {
    const g = game({ allowed: false });
    expect(g.acts.tap(inst("ball", 10))).toBe(false);
    expect(g.log).toEqual([]);
  });
  it("a second tap while one act is under way does nothing", () => {
    const g = game();
    expect(g.acts.tap(inst("teddy", 25))).toBe(true);
    expect(g.acts.tap(inst("ball", 10))).toBe(false);
    expect(g.log.filter((l) => l.startsWith("walkTo"))).toHaveLength(1);
  });
  it("it can start another once the first is over", () => {
    const g = game();
    g.acts.tap(inst("teddy", 25));
    g.arriveAt(25 - HUG_STAND);
    g.run(HUG_S + 0.3);
    expect(g.acts.tap(inst("ball", 10))).toBe(true);
  });
});

describe("consume and reset", () => {
  it("a tap during the action is swallowed; a tap while still walking over drops the visit and is the player's own", () => {
    const a = game();
    expect(a.acts.consume()).toBe(false);
    a.acts.tap(inst("teddy", 25));
    expect(a.acts.consume()).toBe(false);
    expect(a.acts.busy).toBe(false);
    expect(a.log).toContain("stopWalk");
    const b = game();
    b.acts.tap(inst("teddy", 25));
    b.arriveAt(25 - HUG_STAND);
    b.run(0.4);
    expect(b.acts.consume()).toBe(true);
    expect(b.acts.phase).toBe("acting");
  });
  it("reset in the middle of a hug stops it and removes the hearts; the toy can start again", () => {
    const g = game();
    g.acts.tap(inst("teddy", 25));
    g.arriveAt(25 - HUG_STAND);
    g.run(HUG_SQUEEZE_S + 0.1);
    expect(g.acts.heartCount).toBe(1);
    g.acts.reset();
    expect(g.acts.busy).toBe(false);
    expect(g.acts.heartCount).toBe(0);
    expect(g.root.children).toHaveLength(0);
    g.run(3);
    expect(g.squished).toHaveLength(1);                                   // the later squeeze never happened
    expect(g.acts.tap(inst("teddy", 25))).toBe(true);
  });
});

void vi;

describe("wiring in world.ts", () => {
  const world = readFileSync(path.join(__dirname, "..", "src/features/game/world/runtime/world.ts"), "utf8");
  const catalog = readFileSync(path.join(__dirname, "..", "src/features/game/world/runtime/catalog.ts"), "utf8");
  it("every prop tap is heard by the acts, a tap during an act is swallowed before anything else, and the acts are updated and reset with the world", () => {
    expect(world).toContain("ACTS.tap(inst)}");
    expect(world).toContain("if(SLEEPH.consume())return;if(ACTS.consume())return;");
    expect(world).toContain("SLEEPH.update(dt);ACTS.update(dt);");
    expect(world).toContain("SLEEPH.reset();ACTS.reset();");
  });
  it("sleeping and acting never overlap: each waits for the other", () => {
    expect(world).toContain("&&!SLEEPH.busy},position:function(){return{x:P.pos.x,y:P.hop||0,z:P.pos.z}}");     // the acts' allowed()
    expect(world).toContain("&&!ED.on&&!ACTS.busy},ambient:sleepAmbient,");                                       // the sleep's allowed()
  });
  it("the toy is busy only while it acts, and its walk target is cleared when it starts (so it does not wander off afterwards)", () => {
    expect(world).toContain('phase:function(p: string){P.busy=p==="acting";if(p==="acting")P.target=null;if(p!=="acting")P.hop=0},fx:PFX});');
  });
  it("the xylophone is in the prop table and the default Toy Room", () => {
    expect(world).toContain("xylophone:function(x,z){return add(buildXylophone(x,z))}");
    expect(catalog).toMatch(/"id":"room".*?\{"type":"xylophone","x":[0-9.]+\}/s);
  });
  it("the new toys' builders are in the prop table, and the bubbles are popped, updated and cleared with the world", () => {
    expect(world).toContain("guitar:function(x,z){return add(buildGuitarProp(x,z))}");
    expect(world).toContain("bubbles:function(x,z){return add(buildBubbleBottle(x,z))}");
    expect(world).toContain("dog:function(x,z){return add(buildDog(x,z))}");
    expect(world).toContain("if(BUBBLES.count&&BUBBLES.popAt(ray))return;");                  // a tap on a bubble is used before anything else
    expect(world).toContain("BUBBLES.update(dt);");
    expect(world).toContain("BUBBLES.reset();HELD.release();");
  });
  it("the dog fetch is wired: started by a kick when there is a dog, updated each frame, cancelled with the world and when the dog is tapped", () => {
    expect(world).toContain("fetch:function(ball: any){if(!theDog())return false;fetchBall=ball;DOGF.start();return true}");
    expect(world).toContain("SLEEPH.update(dt);ACTS.update(dt);DOGF.update(dt);BUBBLES.update(dt);");
    expect(world).toContain("SLEEPH.reset();ACTS.reset();DOGF.cancel();BUBBLES.reset();HELD.release();");
    expect(world).toContain('onTap:function(inst: any){if(inst.type==="dog")DOGF.cancel();ACTS.tap(inst)}');
    expect(world).toContain("bubbles:BUBBLES,held:HELD,fetch:DOGF,");
  });
  it("Kip can hold a book, the guitar, the wand and a pair of mallets: the right arm is arms[1], the left arms[0] and the mouth is found from Kip's own box", () => {
    expect(world).toContain("hold:function(i: \"book\"|\"guitar\"|\"wand\"|\"mallets\"|\"can\"|\"carrot\"|\"bouquet\"|\"sandwich\"){HELD.hold(i,P.model,P.rig&&P.rig.arms&&P.rig.arms[1],P.rig&&P.rig.arms&&P.rig.arms[0])}");
    expect(world).toContain("release:function(){HELD.release()}");
    expect(world).toContain("bubbles:BUBBLES,");
    expect(world).toMatch(/mouth:function\(d: number\)\{var b=new T\.Box3\(\)\.setFromObject\(P\.root\)/);
  });
  it("the default Toy Room has a teddy, a pile of cushions, a ball, books, a guitar, a bubble set and a dog to play with", () => {
    for (const t of ["teddy", "cushions", "ball", "books", "guitar", "bubbles", "dog"]) expect(catalog, t).toMatch(new RegExp(`"id":"room".*?\\{"type":"${t}","x":[0-9.]+\\}`, "s"));
  });
});
