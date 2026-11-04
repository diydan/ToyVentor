import { describe, expect, it } from "vitest";
import { applyDrop, createCarryState, solveCarry, validateCarry } from "../src/features/game/world/runtime/carry";
import {
  COOK_BEATS, COUNTER, PANCAKE_R, PAN, PLATE_R, PLATE_REACH, cookPlan, plateAt, crackPose, flickFor, flipPose, panSlot, plateOffset, servePath, serveParams, spoonPose, spoonRange,
  CRACK_S, FLIP_S, SPOON_S,
} from "../src/features/game/world/runtime/cookModel";
import { COOK_COUNT, COOK_PROMPT_LINES, COOK_TEXT } from "../src/features/game/world/runtime/cookLines";
import { CLEAN_PROMPT_LINES } from "../src/features/game/world/runtime/cleanLines";
import { MESS_PROMPT_LINES } from "../src/features/game/world/runtime/messLines";
import { createFlickState, flickAttempt, validateFlick } from "../src/features/game/world/runtime/flick";

describe("closed-list lines", () => {
  it("are plain sentences of the shape the closed list requires, each once, none shared with the mess or the cleaning", () => {
    expect(new Set(COOK_PROMPT_LINES).size).toBe(COOK_PROMPT_LINES.length);
    expect(COOK_PROMPT_LINES.length).toBe(16);
    for (const l of COOK_PROMPT_LINES) {
      expect(l).toMatch(/^[A-Za-z0-9][\x20-\x7E]*[.!?]$/);
      expect(MESS_PROMPT_LINES).not.toContain(l);
      expect(CLEAN_PROMPT_LINES).not.toContain(l);
    }
  });
  it("has a spoken count for every spoon up to the biggest band's six", () => {
    expect(COOK_COUNT.length).toBe(spoonRange(5)[1]);
    expect(COOK_COUNT[0]).toBe("One!");
    expect(COOK_COUNT[5]).toBe("Six!");
  });
  it("the hot line asks for a grown-up and never says the pan is safe", () => {
    const hot = COOK_PROMPT_LINES.filter((l) => /hot/i.test(l));
    expect(hot.length).toBe(1);
    expect(hot[0]).toMatch(/grown-up/);
    for (const l of COOK_PROMPT_LINES) expect(l, l).not.toMatch(/\b(safe|touch|cool)\b/i);
  });
  it("the card's text counts and pluralises", () => {
    expect(COOK_TEXT.target(1)).toBe("Pour 1 spoon");
    expect(COOK_TEXT.target(3)).toBe("Pour 3 spoons");
    expect(COOK_TEXT.progress(2, 3)).toBe("2 of 3");
  });
});

describe("the band table", () => {
  it("spoons: 1 to 3 for bands 0 to 2, 1 to 6 from band 3", () => {
    for (const b of [0, 1, 2]) expect(spoonRange(b)).toEqual([1, 3]);
    for (const b of [3, 4, 5]) expect(spoonRange(b)).toEqual([1, 6]);
  });
  it("every plan counts inside its range, and `start` rotates through the whole range", () => {
    for (let band = 0; band <= 5; band++) {
      const [lo, hi] = spoonRange(band);
      const seen = new Set<number>();
      for (let start = 0; start < 2 * (hi - lo + 1); start++) {
        const p = cookPlan(band, start);
        expect(p.spoons).toBeGreaterThanOrEqual(lo);
        expect(p.spoons).toBeLessThanOrEqual(hi);
        seen.add(p.spoons);
      }
      expect(seen.size).toBe(hi - lo + 1);
    }
  });
  it("a bad band or start reads as the youngest and the first", () => {
    expect(cookPlan(-3, NaN)).toEqual(cookPlan(0, 0));
    expect(cookPlan(99).band).toBe(5);
  });
  it("the flip: bands 0 and 1 cannot miss and flip with a tap; later bands need an upward swipe at the right moment", () => {
    for (const b of [0, 1]) {
      const f = flickFor(b);
      expect(validateFlick(f)).toEqual([]);
      expect(f.tapFlicks).toBe(true);
      expect(flickAttempt(createFlickState(f), f, { t: 0.1, dx: 0, dy: 0 }).event).toBe("done");
    }
    for (const b of [2, 3, 4, 5]) {
      const f = flickFor(b);
      expect(validateFlick(f)).toEqual([]);
      expect(f.tapFlicks).toBe(false);
      expect(f.direction).toBe("up");
      expect(flickAttempt(createFlickState(f), f, { t: f.at + 0.8, dx: 0, dy: 60 }).event).toBe("wrong");
      expect(flickAttempt(createFlickState(f), f, { t: f.at, dx: 0, dy: 60 }).event).toBe("done");
    }
  });
  it("the beats are the five of the spec, in order", () => {
    expect(COOK_BEATS).toEqual(["egg", "pour", "hot", "flip", "serve"]);
  });
});

describe("serving is one to one, with the shared carry primitive", () => {
  it("is valid and solvable for every count from 1 to 6, and a plate takes only one", () => {
    for (let n = 1; n <= 6; n++) {
      const p = serveParams(n);
      expect(validateCarry(p), `n=${n}`).toEqual([]);
      const plan = solveCarry(p);
      expect(plan?.length).toBe(n);
      expect(new Set(plan!.map((s) => s.targetId)).size).toBe(n);
      let st = createCarryState(p);
      for (const step of plan!) st = applyDrop(st, p, step.itemId, step.targetId).state;
      expect(st.done).toBe(true);
    }
  });
  it("a second pancake on a full plate is a miss and goes back", () => {
    const p = serveParams(3);
    let r = applyDrop(createCarryState(p), p, "pancake0", "plate1");
    expect(r.event).toBe("progress");
    r = applyDrop(r.state, p, "pancake1", "plate1");
    expect(r.event).toBe("wrong");
    expect(r.state.placed).toEqual({ pancake0: "plate1" });
  });
});

describe("where things are", () => {
  it("the pancakes fit in the pan without touching, for every count", () => {
    for (let n = 1; n <= 6; n++) {
      const slots = Array.from({ length: n }, (_, i) => panSlot(i, n));
      for (const s of slots) expect(Math.hypot(s.x, s.z) + PANCAKE_R, `n=${n}`).toBeLessThanOrEqual(PAN.r + 1e-9);
      for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) expect(Math.hypot(slots[a]!.x - slots[b]!.x, slots[a]!.z - slots[b]!.z), `n=${n} ${a},${b}`).toBeGreaterThanOrEqual(PANCAKE_R * 2 - 1e-9);
    }
  });
  it("the plates never overlap and the whole row is no wider than the counter, so the set fits beside Kip in a phone's 6.3 units, for every count", () => {
    for (let n = 1; n <= 6; n++) {
      const xs = Array.from({ length: n }, (_, j) => plateOffset(j, n).x);
      for (let j = 1; j < n; j++) expect(xs[j]! - xs[j - 1]!).toBeGreaterThan(PLATE_R * 2);
      expect(Math.max(...xs) - Math.min(...xs) + PLATE_R * 2).toBeLessThanOrEqual(COUNTER.width + 1e-9);
      expect(xs.reduce((a, b) => a + b, 0)).toBeCloseTo(0);
    }
  });
  it("a finger finds the nearest plate within reach, and none when it is away from all of them", () => {
    for (let n = 1; n <= 6; n++) for (let j = 0; j < n; j++) {
      const p = plateOffset(j, n);
      expect(plateAt(p.x, p.z, n)).toBe(j);
      expect(plateAt(p.x + 0.1, p.z - 0.1, n)).toBe(j);
    }
    expect(plateAt(0, 3, 4)).toBe(-1);
    expect(plateAt(0, -1, 4)).toBe(-1);
    expect(PLATE_REACH).toBeGreaterThan(PLATE_R);
  });
  it("the pan sits on the counter, on the left", () => {
    expect(PAN.y).toBeGreaterThan(COUNTER.height);
    expect(PAN.x).toBeLessThan(0);
  });
});

describe("timelines", () => {
  it("the egg shakes, then splits, then the yolk drops, ending split and dropped", () => {
    expect(crackPose(0)).toEqual({ shake: 0, split: 0, drop: 0 });
    expect(crackPose(CRACK_S * 0.2).shake).not.toBe(0);
    expect(crackPose(CRACK_S * 0.5).split).toBeGreaterThan(0);
    expect(crackPose(CRACK_S)).toMatchObject({ split: 1, drop: 1 });
    expect(crackPose(NaN).split).toBe(0);
  });
  it("the spoon goes from the bowl to the pan in an arc and the pancake spreads once it lands", () => {
    expect(spoonPose(0)).toMatchObject({ f: 0, arc: 0, spread: 0 });
    expect(spoonPose(SPOON_S * 0.3).arc).toBeGreaterThan(0);
    expect(spoonPose(SPOON_S)).toMatchObject({ f: 1, spread: 1 });
    expect(spoonPose(SPOON_S).arc).toBeCloseTo(0);
  });
  it("the flip goes up and over: a half turn, back on the pan at the end", () => {
    expect(flipPose(0)).toEqual({ lift: 0, turn: 0 });
    expect(flipPose(FLIP_S / 2).lift).toBeGreaterThan(0.8);
    const end = flipPose(FLIP_S);
    expect(end.turn).toBeCloseTo(Math.PI);
    expect(end.lift).toBeCloseTo(0);
  });
  it("a served pancake starts at its slot and ends on its plate", () => {
    const a = { x: -1, y: 1.2, z: -0.9 }, b = { x: 0.5, y: 0.1, z: 0.95 };
    expect(servePath(0, a, b)).toEqual(a);
    const end = servePath(1, a, b);
    expect(end.x).toBeCloseTo(b.x); expect(end.y).toBeCloseTo(b.y); expect(end.z).toBeCloseTo(b.z);
    expect(servePath(0.5, a, b).y).toBeGreaterThan((a.y + b.y) / 2);
  });
});
