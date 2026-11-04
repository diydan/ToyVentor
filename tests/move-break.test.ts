// The movement break's pure logic (shared/moveBreak.ts, docs/specs/dance-party-spec.md 5.2, D6). The rules are stated once as functions of an implementation,
// so the same checks can be run on versions that are wrong on purpose and must fail (a rule that cannot fail proves nothing).
import { describe, expect, it } from "vitest";
import {
  BREAK_SEQUENCE,
  BREAK_STEP_BEATS,
  breakFrame,
  breakPool,
  breakStyleFor,
  planBreak,
  resolveBreakMove,
  type BreakClip,
  type BreakFrame,
  type BreakPlan,
} from "../shared/moveBreak";
import { clipTime, type BeatMap } from "../shared/songBeat";
import { practiceBeatMap } from "../shared/songParty";

// the clips the bench really has (public/kip/mixamo/baked/index.json): three moves (only the jacks have a tempo), the guitar strum, and the dances
const MOVES: BreakClip[] = [
  { id: "move_jacks", bpm: 112.5, beats: 2, group: "move" },
  { id: "move_arms", group: "move" },
  { id: "move_neck", group: "move" },
];
const DANCES: BreakClip[] = [
  { id: "dance_sway", bpm: 80, beats: 8, group: "dance" },
  { id: "dance_hiphop", bpm: 101.41, beats: 8, group: "dance" },
  { id: "dance_silly", bpm: 125.22, beats: 8, group: "dance" },
  { id: "dance_swing", bpm: 137.8, beats: 48, group: "dance" },
  { id: "dance_chicken", group: "dance" }, // no tempo: never picked
  { id: "music_guitar", bpm: 100.7, beats: 8, group: "music" }, // the strum is not a dance
  { id: "move_jacks", bpm: 112.5, beats: 2, group: "move" },
];
const ids = (xs: { clip: BreakClip }[]) => xs.map((x) => x.clip.id);

describe("the break's style by age band", () => {
  it("bands 0 and 1 do one move, 2 and 3 copy a sequence, 4 and 5 copy and then choose", () => {
    expect([0, 1].map(breakStyleFor)).toEqual(["one", "one"]);
    expect([2, 3].map(breakStyleFor)).toEqual(["copy", "copy"]);
    expect([4, 5].map(breakStyleFor)).toEqual(["choose", "choose"]);
  });
  it("anything that is not a band gets the youngest, simplest break", () => {
    for (const bad of [-1, 6, 2.5, NaN, Infinity, "3", null, undefined, {}]) expect(breakStyleFor(bad)).toBe("one");
  });
});

describe("the moves a break can use", () => {
  it("takes the moves in the order given, then the dance the tempo would pick, and never the strum or a dance with no tempo", () => {
    const pool = breakPool(110, MOVES, DANCES);
    expect(ids(pool)).toEqual(["move_jacks", "move_arms", "move_neck", "dance_hiphop"]);
    expect(pool.find((m) => m.clip.id === "move_jacks")!.rate).toBeCloseTo(110 / 112.5, 6);
    expect(pool.find((m) => m.clip.id === "move_arms")!.rate).toBeNull(); // a stretch runs at its own speed
  });
  it("leaves out a move whose tempo does not fit, rather than stretching it (the jacks fit 90 to 140 bpm)", () => {
    expect(ids(breakPool(64, MOVES, DANCES))).toEqual(["move_arms", "move_neck", "dance_sway"]); // 64 bpm is exactly 0.8 of the 80 bpm sway
    expect(ids(breakPool(90, MOVES, DANCES))).toContain("move_jacks");
    expect(ids(breakPool(89, MOVES, DANCES))).not.toContain("move_jacks");
    expect(ids(breakPool(140, MOVES, DANCES))).toContain("move_jacks");
    expect(ids(breakPool(141, MOVES, DANCES))).not.toContain("move_jacks");
    expect(ids(breakPool(200, MOVES, DANCES))).toEqual(["move_arms", "move_neck"]); // the stretches are always there
  });
  it("lists a clip once, and ignores a dance or the strum handed in as a move", () => {
    const pool = breakPool(110, [...MOVES, { id: "move_arms", group: "move" }, { id: "dance_silly", bpm: 125.22, beats: 8, group: "dance" }, { id: "music_guitar", bpm: 100.7, beats: 8, group: "music" }], DANCES);
    expect(ids(pool)).toEqual(["move_jacks", "move_arms", "move_neck", "dance_hiphop"]);
  });
  it("a clip with half a tempo (a bpm but no beats) is treated as having none, so it is never stretched by a guess", () => {
    const pool = breakPool(110, [{ id: "move_x", bpm: 100, group: "move" }, { id: "move_y", beats: 4, group: "move" }], []);
    expect(pool.map((m) => m.rate)).toEqual([null, null]);
  });
});

describe("planning a break", () => {
  const tempos = Array.from({ length: 107 }, (_, i) => 64 + i); // 64 to 170 bpm: every tempo a dance can follow

  it("bands 0 and 1: one move, the first the tempo allows, for every step, counted in eights", () => {
    for (const band of [0, 1]) {
      const plan = planBreak(110, band, MOVES, DANCES);
      expect(plan.style).toBe("one");
      expect(new Set(plan.steps.map((s) => s.moveId))).toEqual(new Set(["move_jacks"]));
      expect(plan.steps.every((s) => s.kind === "show")).toBe(true);
    }
    expect(planBreak(64, 0, MOVES, DANCES).steps[0]!.moveId).toBe("move_arms"); // the jacks do not fit 64 bpm: the first one that does
  });

  it("bands 2 and 3: a four-move sequence, the same in every round, in the order of the pool", () => {
    for (const band of [2, 3]) {
      const plan = planBreak(110, band, MOVES, DANCES);
      const rounds = plan.steps.length / BREAK_SEQUENCE;
      expect(rounds).toBeGreaterThanOrEqual(2);
      for (let r = 0; r < rounds; r++) expect(plan.steps.slice(r * 4, r * 4 + 4).map((s) => s.moveId)).toEqual(["move_jacks", "move_arms", "move_neck", "dance_hiphop"]);
    }
  });

  it("with fewer than four moves the sequence takes them in turn (the pool goes round)", () => {
    const plan = planBreak(200, 2, MOVES, DANCES); // 200 bpm: only the two stretches
    expect(plan.steps.slice(0, 4).map((s) => s.moveId)).toEqual(["move_arms", "move_neck", "move_arms", "move_neck"]);
  });

  it("bands 4 and 5: Kip shows the four moves, then the child chooses the next four, and so on", () => {
    for (const band of [4, 5]) {
      const plan = planBreak(110, band, MOVES, DANCES);
      plan.steps.forEach((s) => {
        if (s.round % 2 === 0) { expect(s.kind).toBe("show"); expect(s.moveId).not.toBeNull(); }
        else { expect(s.kind).toBe("choose"); expect(s.moveId).toBeNull(); }
      });
      expect(plan.steps.some((s) => s.kind === "choose")).toBe(true);
    }
    // at every tempo: a break always has a round to copy and a round to choose in (the slowest tempos are the ones that would be short of rounds)
    for (const bpm of tempos) for (const band of [4, 5]) {
      const kinds = new Set(planBreak(bpm, band, MOVES, DANCES).steps.map((s) => s.kind));
      expect(kinds, `${bpm} bpm`).toEqual(new Set(["show", "choose"]));
    }
  });

  it("lasts 30 to 60 seconds at every tempo a dance can follow, in whole rounds", () => {
    for (const bpm of tempos) {
      for (const band of [0, 2, 4]) {
        const plan = planBreak(bpm, band, MOVES, DANCES);
        expect(plan.steps.length % BREAK_SEQUENCE, `${bpm} bpm`).toBe(0);
        expect(plan.seconds, `${bpm} bpm`).toBeGreaterThanOrEqual(30);
        expect(plan.seconds, `${bpm} bpm`).toBeLessThanOrEqual(60);
        expect(plan.totalBeats).toBe(plan.steps.length * BREAK_STEP_BEATS);
        expect(plan.seconds).toBeCloseTo((plan.totalBeats * 60) / bpm, 9);
      }
    }
  });

  it("with nothing to do (no move fits, or the tempo is not a number) the plan is empty, not a crash and not a guess", () => {
    expect(planBreak(110, 2, [], []).steps).toEqual([]);
    expect(planBreak(200, 2, [{ id: "move_jacks", bpm: 112.5, beats: 2, group: "move" }], DANCES).steps).toEqual([]);
    for (const bad of [NaN, 0, -5, Infinity]) expect(planBreak(bad, 2, MOVES, DANCES).steps).toEqual([]);
  });

  it("nothing is measured from the child's movement: a plan and a frame carry only music and move data, no score, camera or motion field", () => {
    const plan = planBreak(110, 4, MOVES, DANCES);
    expect(Object.keys(plan).sort()).toEqual(["pool", "seconds", "songBpm", "stepBeats", "steps", "style", "totalBeats"]);
    const frame = breakFrame(plan, practiceBeatMap(110, 200), 1);
    expect(Object.keys(frame).sort()).toEqual(["beatInStep", "count", "count8", "done", "downbeat", "kind", "locked", "moveId", "moveTime", "place", "pulse", "round", "slot", "step", "steps"]);
  });
});

describe("a choose step", () => {
  const plan = planBreak(110, 4, MOVES, DANCES); // steps 0-3 shown, 4-7 chosen
  it("does the child's pick, and while there is none keeps doing the move before it", () => {
    expect(resolveBreakMove(plan, [], 3)).toBe("dance_hiphop"); // the last shown move
    expect(resolveBreakMove(plan, [], 4)).toBe("dance_hiphop"); // no pick yet: Kip keeps going
    const picks: (string | null)[] = [];
    picks[4] = "move_neck";
    expect(resolveBreakMove(plan, picks, 4)).toBe("move_neck");
    expect(resolveBreakMove(plan, picks, 5)).toBe("move_neck"); // no pick for 5: what step 4 was
    picks[5] = "move_jacks";
    expect(resolveBreakMove(plan, picks, 5)).toBe("move_jacks");
    expect(resolveBreakMove(plan, picks, 6)).toBe("move_jacks");
  });
  it("never does a move that is not in the pool, whatever a client sends", () => {
    const picks: (string | null)[] = [];
    picks[4] = "move_do_a_handstand";
    expect(resolveBreakMove(plan, picks, 4)).toBe("dance_hiphop");
    picks[4] = "";
    expect(resolveBreakMove(plan, picks, 4)).toBe("dance_hiphop");
  });
  it("a show step ignores picks", () => {
    const picks: (string | null)[] = [];
    picks[1] = "move_neck";
    expect(resolveBreakMove(plan, picks, 1)).toBe("move_arms");
  });
  it("an index outside the plan is the nearest step, and an empty plan has no move", () => {
    expect(resolveBreakMove(plan, [], -3)).toBe("move_jacks");
    expect(resolveBreakMove(plan, [], 999)).toBe("dance_hiphop");
    expect(resolveBreakMove(plan, [], NaN)).toBe("move_jacks");
    expect(resolveBreakMove(planBreak(110, 2, [], []), [], 0)).toBeNull();
  });
});

// ---- the frame: the rules as a function of the frame maker, so they can be run on a broken one --------------------------------

type FrameFn = (plan: BreakPlan, map: BeatMap, t: number, picks?: (string | null | undefined)[]) => BreakFrame;

/** Walks a whole break at a quarter of a beat and returns what is wrong with the frames `make` gives. */
function frameFailures(make: FrameFn): string[] {
  const bad = new Set<string>();
  const bpm = 110;
  const map = practiceBeatMap(bpm, 200);
  const plan = planBreak(bpm, 4, MOVES, DANCES);
  const picks: (string | null)[] = [];
  picks[4] = "move_neck";
  picks[6] = "move_jacks";
  const beat = 60 / bpm;
  let prev: BreakFrame | null = null;
  for (let b = 0; b < plan.totalBeats + 4; b += 0.25) {
    const t = b * beat;
    const f = make(plan, map, t, picks);
    const stepWanted = Math.min(Math.floor(b / BREAK_STEP_BEATS), plan.steps.length - 1);
    if (f.step !== stepWanted) bad.add("the step is floor(beats / 8)");
    if (f.count8 !== (Math.floor(b) % 8) + 1) bad.add("the count goes 1 to 8 through a step");
    if (f.count !== (Math.floor(b) % 4) + 1) bad.add("the bar count goes 1 to 4");
    if (f.downbeat !== (Math.floor(b) % 4 === 0)) bad.add("the downbeat is the 1 of the bar");
    if (f.done !== b >= plan.totalBeats) bad.add("it is done exactly at the end of the plan");
    const want = resolveBreakMove(plan, picks, stepWanted);
    if (f.moveId !== want) bad.add("the move is the one the plan and the picks say");
    if (prev && prev.step === f.step && prev.moveId !== f.moveId) bad.add("a move holds for its whole step");
    if (prev && prev.step !== f.step && Math.abs(b % BREAK_STEP_BEATS) > 1e-9) bad.add("a move changes only on a step line");
    const move = plan.pool.find((m) => m.clip.id === f.moveId);
    if (move && move.rate !== null) {
      if (!f.locked || f.moveTime === null || Math.abs(f.moveTime - clipTime(map, t, { bpm: move.clip.bpm as number, beats: move.clip.beats as number })) > 1e-9) bad.add("a move with a tempo is held to the beat");
    } else if (f.locked || f.moveTime !== null) bad.add("a stretch is not held to the beat");
    prev = f;
  }
  return [...bad];
}

describe("the frame", () => {
  it("follows the rules: step, count, move, holding, picks, ending, and the beat lock", () => {
    expect(frameFailures(breakFrame)).toEqual([]);
  });

  it("fails them on a version that changes move every beat, one that ignores the child's picks, one that counts to 4, and one that never ends (so the check can fail)", () => {
    const everyBeat: FrameFn = (plan, map, t, picks) => {
      const f = breakFrame(plan, map, t, picks);
      const alt = plan.pool[f.place.index % plan.pool.length]!.clip.id;
      return { ...f, moveId: alt };
    };
    const ignoresPicks: FrameFn = (plan, map, t) => breakFrame(plan, map, t, []);
    const countsToFour: FrameFn = (plan, map, t, picks) => { const f = breakFrame(plan, map, t, picks); return { ...f, count8: f.count }; };
    const neverEnds: FrameFn = (plan, map, t, picks) => ({ ...breakFrame(plan, map, t, picks), done: false });
    for (const [name, broken] of Object.entries({ everyBeat, ignoresPicks, countsToFour, neverEnds })) expect(frameFailures(broken).length, name).toBeGreaterThan(0);
  });

  it("before the first beat (a count-in) it is the first step, and not done", () => {
    const plan = planBreak(110, 2, MOVES, DANCES);
    const f = breakFrame(plan, practiceBeatMap(110, 100), -0.7);
    expect(f.step).toBe(0);
    expect(f.done).toBe(false);
    expect(f.moveId).toBe("move_jacks");
  });

  it("an empty plan gives a frame with no move and never done, and does not throw", () => {
    const f = breakFrame(planBreak(110, 2, [], []), practiceBeatMap(110, 100), 5);
    expect(f.moveId).toBeNull();
    expect(f.moveTime).toBeNull();
    expect(f.locked).toBe(false);
    expect(f.done).toBe(false);
    expect(f.steps).toBe(0);
  });

  it("a locked move's time inside a step is on the beat: the same beat of the move on every step", () => {
    const bpm = 110;
    const map = practiceBeatMap(bpm, 200);
    const plan = planBreak(bpm, 0, MOVES, DANCES); // jacks all the way
    const beat = 60 / bpm;
    const at = (b: number) => breakFrame(plan, map, b * beat).moveTime!;
    for (const k of [0, 1, 3, 5]) expect(at(k * BREAK_STEP_BEATS + 0.5)).toBeCloseTo(at(0.5), 9); // the jacks loop is 2 beats: a step line is the same point of it
  });
});
