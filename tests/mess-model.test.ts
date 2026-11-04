import { describe, expect, it } from "vitest";
import { ALL_CLEAN, CLEAN_BUTTON, CLEAN_Q, MESS_PROMPT_LINES, OH_NO, countCaption } from "../src/features/game/world/runtime/messLines";
import {
  BOX_TILT, CUP_LIE, CUP_RIGHT_S, IN_BOX, IN_PILE, MOP_END_S, MOP_EVERY_S, MOP_S, MOP_START_S, MOP_STROKES, PILE_TOYS, PUDDLE_AT_S, PUDDLE_GROW_S, SPILL_DONE_S, SPILL_OHNO_AT_S,
  SPILL_PROMPT_AT_S, SPILL_S, SPILL_TIP_AT_S, STREAM_END_S, TIDY_EVERY_S, TIDY_START_S, TOY_KINDS, TUMBLE_DONE_S, TUMBLE_START_S, TUMBLE_STAGGER_S, DUMP_OHNO_AT_S, DUMP_PROMPT_AT_S, DUMP_S,
  DUMP_TIP_AT_S, boxTiltDump, boxTiltTidy, cupTilt, cupTiltWhileMopping, homeAt, landsAt, puddleGrow, puddleLeft, streamLevel, strokeEndsAt, tidyEndsAt, tidyPose, tidyVisitSeconds, toysHome,
  tumblePose, type Pose,
} from "../src/features/game/world/runtime/messModel";

describe("what Kip says, and the count", () => {
  it("has the three lines of the closed list, plain and short, and the button's word", () => {
    expect([OH_NO, CLEAN_Q, ALL_CLEAN]).toEqual(["Oh no, oh no!", "Clean?", "All clean! Hooray!"]);
    expect(MESS_PROMPT_LINES).toEqual([OH_NO, CLEAN_Q, ALL_CLEAN]);
    expect(CLEAN_BUTTON).toBe("Clean");
    for (const l of MESS_PROMPT_LINES) expect(l).toMatch(/^[A-Za-z0-9][\x20-\x7E]*[.!?]$/); // the shape the closed list requires
  });
  it("counts the toys home as a plain sentence, the last one 'All n toys home!', and clamps nonsense", () => {
    expect(countCaption(1, 6)).toBe("1 toy home!");
    expect(countCaption(2, 6)).toBe("2 toys home!");
    expect(countCaption(5, 6)).toBe("5 toys home!");
    expect(countCaption(6, 6)).toBe("All 6 toys home!");
    expect(countCaption(0, 6)).toBe("1 toy home!");
    expect(countCaption(99, 6)).toBe("All 6 toys home!");
    expect(countCaption(Number.NaN, 6)).toBe("1 toy home!");
    expect(countCaption(1, 1)).toBe("All 1 toys home!");
  });
});

describe("the visits", () => {
  it("the prompt comes after the 'oh no', which comes after the tip, and all of them fit inside the visit", () => {
    expect(SPILL_TIP_AT_S).toBeLessThan(SPILL_OHNO_AT_S);
    expect(SPILL_OHNO_AT_S).toBeLessThan(SPILL_PROMPT_AT_S);
    expect(SPILL_PROMPT_AT_S).toBeLessThan(SPILL_S);
    expect(DUMP_TIP_AT_S).toBeLessThan(DUMP_OHNO_AT_S);
    expect(DUMP_OHNO_AT_S).toBeLessThan(DUMP_PROMPT_AT_S);
    expect(DUMP_PROMPT_AT_S).toBeLessThan(DUMP_S);
  });
  it("the question is asked once the mess has finished moving, so the child looks at a settled mess", () => {
    expect(SPILL_TIP_AT_S + SPILL_DONE_S).toBeLessThanOrEqual(SPILL_PROMPT_AT_S + 0.5);
    expect(DUMP_TIP_AT_S + TUMBLE_DONE_S).toBeLessThanOrEqual(DUMP_PROMPT_AT_S + 0.1);
  });
});

describe("the cup", () => {
  it("is upright before the tip, falls faster and faster, rocks once and lies on its side", () => {
    expect(cupTilt(-1)).toBe(0);
    expect(cupTilt(0)).toBe(0);
    expect(cupTilt(Number.NaN)).toBe(0);
    let prev = 0;
    for (let s = 0.01; s < 0.5; s += 0.01) { const a = cupTilt(s); expect(a).toBeGreaterThan(prev); prev = a; }
    const d1 = cupTilt(0.25) - cupTilt(0.2), d2 = cupTilt(0.5) - cupTilt(0.45);
    expect(d2).toBeGreaterThan(d1);                                           // gravity: the fall speeds up
    expect(cupTilt(0.5)).toBeCloseTo(CUP_LIE, 6);
    let max = 0;
    for (let s = 0.5; s < 0.9; s += 0.005) max = Math.max(max, cupTilt(s));
    expect(max).toBeLessThanOrEqual(CUP_LIE + 1e-9);                          // never through the table
    expect(cupTilt(0.65)).toBeLessThan(CUP_LIE - 0.05);                       // the rock
    expect(cupTilt(1)).toBe(CUP_LIE);
    expect(cupTilt(1e6)).toBe(CUP_LIE);
  });
  it("stays lying through the mopping, then stands up over CUP_RIGHT_S, upright for good", () => {
    expect(cupTiltWhileMopping(0)).toBe(CUP_LIE);
    expect(cupTiltWhileMopping(MOP_END_S)).toBe(CUP_LIE);
    expect(cupTiltWhileMopping(MOP_END_S + CUP_RIGHT_S / 2)).toBeCloseTo(CUP_LIE / 2, 6);
    expect(cupTiltWhileMopping(MOP_END_S + CUP_RIGHT_S)).toBe(0);
    expect(cupTiltWhileMopping(1e6)).toBe(0);
    let prev = CUP_LIE;
    for (let t = MOP_END_S; t <= MOP_END_S + CUP_RIGHT_S; t += 0.01) { const a = cupTiltWhileMopping(t); expect(a).toBeLessThanOrEqual(prev + 1e-12); prev = a; }
  });
  it("the stream runs off the table edge for a moment: nothing before or after, full in between, always 0 to 1", () => {
    expect(streamLevel(0)).toBe(0);
    expect(streamLevel(STREAM_END_S)).toBe(0);
    expect(streamLevel(1)).toBe(1);
    for (let s = -1; s < 3; s += 0.02) { const v = streamLevel(s); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    expect(streamLevel(Number.NaN)).toBe(0);
  });
});

describe("the puddle", () => {
  it("does not exist before the juice lands, spreads with a small overshoot, and is exactly its full size once it has settled", () => {
    expect(puddleGrow(0)).toBe(0);
    expect(puddleGrow(PUDDLE_AT_S)).toBe(0);
    expect(puddleGrow(Number.NaN)).toBe(0);
    expect(puddleGrow(PUDDLE_AT_S + PUDDLE_GROW_S)).toBe(1);
    expect(puddleGrow(1e6)).toBe(1);
    let max = 0;
    for (let s = PUDDLE_AT_S; s <= PUDDLE_AT_S + PUDDLE_GROW_S; s += 0.01) max = Math.max(max, puddleGrow(s));
    expect(max).toBeGreaterThan(1.01);                                         // it overshoots a little ...
    expect(max).toBeLessThan(1.09);                                            // ... a little
    expect(puddleGrow(PUDDLE_AT_S + 0.1)).toBeGreaterThan(0);
    expect(SPILL_DONE_S).toBeCloseTo(PUDDLE_AT_S + PUDDLE_GROW_S, 9);
  });
  it("is mopped away one sixth at a time: whole after the dry start, exactly one sixth less at the end of each stroke, exactly gone at the end of the last", () => {
    expect(puddleLeft(0)).toBe(1);
    expect(puddleLeft(MOP_START_S)).toBe(1);
    for (let i = 0; i < MOP_STROKES; i++) expect(puddleLeft(strokeEndsAt(i))).toBeCloseTo(1 - (i + 1) / MOP_STROKES, 9);
    expect(puddleLeft(MOP_END_S)).toBe(0);
    expect(puddleLeft(1e6)).toBe(0);
    expect(puddleLeft(Number.NaN)).toBe(1);
  });
  it("only ever gets smaller, smoothly (no jumps), and each stroke takes MOP_EVERY_S", () => {
    let prev = 1;
    for (let t = 0; t <= MOP_END_S + 0.5; t += 1 / 60) {
      const v = puddleLeft(t);
      expect(v).toBeLessThanOrEqual(prev + 1e-12);
      expect(prev - v).toBeLessThan(0.05);
      prev = v;
    }
    expect(strokeEndsAt(0)).toBeCloseTo(MOP_START_S + MOP_EVERY_S, 9);
    expect(MOP_END_S).toBeCloseTo(MOP_START_S + MOP_STROKES * MOP_EVERY_S, 9);
    expect(MOP_S).toBeGreaterThan(MOP_END_S + CUP_RIGHT_S);                      // the visit has room for the cup to stand up and a cheer
  });
});

const dist = (a: Pose, b: Pose) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const same = (a: Pose, b: Pose) => expect(Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z), Math.abs(a.rx - b.rx), Math.abs(a.ry - b.ry), Math.abs(a.rz - b.rz))).toBeLessThan(1e-9);

describe("the toys: out of the box into a heap", () => {
  it("there are six, one of each kind, each with a place in the box and a place in the heap", () => {
    expect(PILE_TOYS).toBe(6);
    expect(new Set(TOY_KINDS).size).toBe(6);
    expect(IN_BOX).toHaveLength(6);
    expect(IN_PILE).toHaveLength(6);
  });
  it("every toy starts exactly in the box and ends exactly in the heap, and none is in the heap's place before it lands", () => {
    for (let i = 0; i < PILE_TOYS; i++) {
      expect(tumblePose(i, -1)).toEqual(IN_BOX[i]);
      expect(tumblePose(i, 0)).toEqual(IN_BOX[i]);
      expect(tumblePose(i, TUMBLE_DONE_S)).toEqual(IN_PILE[i]);
      expect(tumblePose(i, 1e6)).toEqual(IN_PILE[i]);
      expect(tumblePose(i, TUMBLE_START_S + i * TUMBLE_STAGGER_S - 0.01)).toEqual(IN_BOX[i]);
      same(tumblePose(i, landsAt(i)), IN_PILE[i]!);                          // (the hop starts at zero height)
    }
  });
  it("they leave one after another in order and land in order", () => {
    for (let i = 1; i < PILE_TOYS; i++) expect(landsAt(i)).toBeGreaterThan(landsAt(i - 1));
    // halfway through the stagger the first toy is out and the last is still in the box
    const s = TUMBLE_START_S + 2 * TUMBLE_STAGGER_S + 0.05;
    expect(dist(tumblePose(0, s), IN_BOX[0]!)).toBeGreaterThan(0.2);
    expect(tumblePose(PILE_TOYS - 1, s)).toEqual(IN_BOX[PILE_TOYS - 1]);
  });
  it("moves smoothly (no teleporting), never below the floor, and the heap is in front of the box and clear of the box's footprint", () => {
    for (let i = 0; i < PILE_TOYS; i++) {
      let prev = tumblePose(i, 0);
      for (let s = 1 / 60; s <= TUMBLE_DONE_S + 0.1; s += 1 / 60) {
        const p = tumblePose(i, s);
        expect(dist(p, prev), `toy ${i} at ${s.toFixed(3)}`).toBeLessThan(0.16);
        expect(p.y).toBeGreaterThanOrEqual(0);
        prev = p;
      }
      expect(IN_PILE[i]!.z, `toy ${i}`).toBeGreaterThan(0.7);                    // beyond the box's front face (z 0.55)
    }
  });
  it("the heap is a heap: nothing lies on anything else except the ring on the cube, and no two toys share a spot", () => {
    for (let i = 0; i < PILE_TOYS; i++) for (let j = i + 1; j < PILE_TOYS; j++) {
      const a = IN_PILE[i]!, b = IN_PILE[j]!;
      const flat = Math.hypot(a.x - b.x, a.z - b.z);
      if (flat < 0.3) expect([i, j], `toys ${i} and ${j} overlap`).toEqual([0, 5]);
    }
  });
  it("the box leans forward while the toys are out and rights itself first when they go back", () => {
    expect(boxTiltDump(0)).toBe(0);
    expect(boxTiltDump(1)).toBeCloseTo(BOX_TILT, 9);
    expect(boxTiltDump(1e6)).toBeCloseTo(BOX_TILT, 9);
    expect(boxTiltTidy(0)).toBeCloseTo(BOX_TILT, 9);
    expect(boxTiltTidy(TIDY_START_S)).toBe(0);                                  // upright before the first toy leaves the floor
    expect(boxTiltTidy(1e6)).toBe(0);
    expect(boxTiltTidy(0, 0.2)).toBeCloseTo(0.2, 9);                            // a box that was partly tipped rights from where it was
  });
});

describe("tidying up", () => {
  it("toys go home one at a time at a steady beat, in their own order, each to its own place in the box", () => {
    for (let slot = 1; slot < PILE_TOYS; slot++) expect(homeAt(slot) - homeAt(slot - 1)).toBeCloseTo(TIDY_EVERY_S, 9);
    for (let i = 0; i < PILE_TOYS; i++) {
      expect(tidyPose(i, i, 0)).toEqual(IN_PILE[i]);
      expect(tidyPose(i, i, homeAt(i))).toEqual(IN_BOX[i]);
      expect(tidyPose(i, i, 1e6)).toEqual(IN_BOX[i]);
    }
  });
  it("a toy waits on the floor until its turn", () => {
    expect(tidyPose(3, 3, TIDY_START_S + 3 * TIDY_EVERY_S - 0.01)).toEqual(IN_PILE[3]);
    expect(dist(tidyPose(3, 3, TIDY_START_S + 3 * TIDY_EVERY_S + 0.2), IN_PILE[3]!)).toBeGreaterThan(0.1);
  });
  it("flies in an arc (higher than both ends in the middle), smoothly, never below the floor", () => {
    for (let i = 0; i < PILE_TOYS; i++) {
      const mid = tidyPose(i, i, (TIDY_START_S + i * TIDY_EVERY_S + homeAt(i)) / 2);
      expect(mid.y).toBeGreaterThan(Math.max(IN_PILE[i]!.y, IN_BOX[i]!.y) + 0.3);
      let prev = tidyPose(i, i, 0);
      for (let t = 1 / 60; t <= homeAt(i) + 0.1; t += 1 / 60) {
        const p = tidyPose(i, i, t);
        expect(dist(p, prev), `toy ${i} at ${t.toFixed(3)}`).toBeLessThan(0.2);
        expect(p.y).toBeGreaterThanOrEqual(0);
        prev = p;
      }
    }
  });
  it("counts the toys home: none at the start, one more at each landing, all of them at the end", () => {
    expect(toysHome(PILE_TOYS, 0)).toBe(0);
    for (let slot = 0; slot < PILE_TOYS; slot++) {
      expect(toysHome(PILE_TOYS, homeAt(slot) - 0.01)).toBe(slot);
      expect(toysHome(PILE_TOYS, homeAt(slot))).toBe(slot + 1);
    }
    expect(toysHome(PILE_TOYS, 1e6)).toBe(PILE_TOYS);
    expect(toysHome(0, 5)).toBe(0);
  });
  it("a partly tidied room takes less time: with fewer toys left the visit is shorter, and always has room for the cheer", () => {
    expect(tidyEndsAt(PILE_TOYS)).toBeCloseTo(homeAt(PILE_TOYS - 1), 9);
    expect(tidyVisitSeconds(3)).toBeLessThan(tidyVisitSeconds(6));
    expect(tidyVisitSeconds(1)).toBeGreaterThan(tidyEndsAt(1) + 1);
    expect(tidyEndsAt(0)).toBeCloseTo(homeAt(0), 9);
  });
});
