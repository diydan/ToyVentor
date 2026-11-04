import { describe, expect, it } from "vitest";
import {
  SCRUB_SHAPES,
  SCRUB_TOOLS,
  clampBand,
  createScrubState,
  onMess,
  playScrub,
  scrubAll,
  scrubBandParams,
  scrubCells,
  scrubNeeded,
  scrubProgress,
  scrubTouch,
  seededRandom,
  solveScrub,
  toddlerScrub,
  validateScrub,
  type ScrubParams,
  type ScrubShape,
} from "../src/features/game/world/runtime/scrub";

const base = (shape: ScrubShape, band: number): ScrubParams => ({
  shape,
  tool: "mop",
  width: shape === "line" ? 9 : 6,
  depth: shape === "line" ? 1.6 : 4,
  cells: 60,
  ...scrubBandParams(band),
});

describe("scrub parameters", () => {
  it("accepts every shape at every band", () => {
    for (const shape of SCRUB_SHAPES) for (let b = 0; b <= 5; b++) expect(validateScrub(base(shape, b))).toEqual([]);
  });

  it("names every bad field", () => {
    const bad = { ...base("blob", 3), shape: "ring", tool: "laser", width: 0, depth: -1, cells: 2, coverage: 0, brush: NaN, speedFloor: 5, speedCeiling: 5, tapClears: 1 } as unknown as ScrubParams;
    const errors = validateScrub(bad).join(" | ");
    for (const word of ["shape", "tool", "width", "depth", "cells", "coverage", "brush", "speedCeiling", "tapClears"]) expect(errors).toContain(word);
  });

  it("lays out exactly `cells` cells for every shape, inside the mess", () => {
    for (const shape of SCRUB_SHAPES) {
      for (const cells of [4, 17, 60, 600]) {
        const p = { ...base(shape, 3), cells };
        const pts = scrubCells(p);
        expect(pts.length).toBe(cells);
        for (const c of pts) {
          expect(Math.abs(c.x)).toBeLessThanOrEqual(p.width / 2 + 1e-9);
          expect(Math.abs(c.z)).toBeLessThanOrEqual(p.depth / 2 + 1e-9);
        }
      }
    }
  });

  it("lays the same cells every time", () => {
    expect(scrubCells(base("scatter", 3))).toEqual(scrubCells(base("scatter", 3)));
  });
});

describe("band table", () => {
  it("asks for more with age: coverage never falls, the brush never grows", () => {
    for (let b = 1; b <= 5; b++) {
      expect(scrubBandParams(b).coverage).toBeGreaterThanOrEqual(scrubBandParams(b - 1).coverage);
      expect(scrubBandParams(b).brush).toBeLessThanOrEqual(scrubBandParams(b - 1).brush);
    }
  });
  it("matches the spec: tap clears at bands 0 and 1, half at band 2, seven tenths from band 3", () => {
    expect(scrubBandParams(0).tapClears).toBe(true);
    expect(scrubBandParams(1).tapClears).toBe(true);
    expect(scrubBandParams(2)).toMatchObject({ tapClears: false, coverage: 0.5 });
    for (const b of [3, 4, 5]) expect(scrubBandParams(b)).toMatchObject({ tapClears: false, coverage: 0.7 });
  });
  it("reads a bad band as the youngest and a high one as the oldest", () => {
    expect(clampBand(-1)).toBe(0);
    expect(clampBand(2.5)).toBe(0);
    expect(clampBand(NaN)).toBe(0);
    expect(clampBand(99)).toBe(5);
  });
});

describe("scrub touch", () => {
  it("clears nothing and says `wrong` with the tool it needs when the tool is wrong", () => {
    const p = base("blob", 3);
    const r = scrubTouch(createScrubState(p), p, null, { x: 0, z: 0, tool: "vacuum", dt: 0 });
    expect(r.event).toBe("wrong");
    expect(r.need).toBe("mop");
    expect(r.gained).toBe(0);
    expect(r.state.cleared).toBe(0);
    expect(r.state.wrongs).toBe(1);
  });

  it("is just `touched` off the mess, with any tool", () => {
    const p = base("blob", 3);
    for (const tool of SCRUB_TOOLS) expect(scrubTouch(createScrubState(p), p, null, { x: 50, z: 50, tool, dt: 0 }).event).toBe("touched");
    expect(onMess(p, { x: 0, z: 0 })).toBe(true);
    expect(onMess(p, { x: 50, z: 0 })).toBe(false);
  });

  it("a tap clears everything at bands 0 and 1, and a drag does not need to", () => {
    for (const b of [0, 1]) {
      const p = base("scatter", b);
      const r = scrubTouch(createScrubState(p), p, null, { x: 0, z: 0, tool: "mop", dt: 0 });
      expect(r.event).toBe("done");
      expect(r.state.cleared).toBe(p.cells);
    }
  });

  it("a tap does not clear a mess at band 3: it needs scrubbing", () => {
    const p = base("blob", 3);
    const r = scrubTouch(createScrubState(p), p, null, { x: 0, z: 0, tool: "mop", dt: 0 });
    expect(r.event).not.toBe("done");
    expect(r.state.cleared).toBeLessThan(scrubNeeded(p));
  });

  it("does not change the state it was given", () => {
    const p = base("blob", 3);
    const s0 = createScrubState(p);
    scrubTouch(s0, p, null, { x: 0, z: 0, tool: "mop", dt: 0 });
    expect(s0.cleared).toBe(0);
    expect(Array.from(s0.clean).every((v) => v === 0)).toBe(true);
  });

  it("a finger held still does not scrub where a floor is set", () => {
    const p = base("blob", 3);
    const s = createScrubState(p);
    const r = scrubTouch(s, p, { x: 0, z: 0 }, { x: 0.0001, z: 0, tool: "mop", dt: 1 });
    expect(r.gained).toBe(0);
    expect(r.event).toBe("touched");
  });

  it("a stroke over the speed ceiling clears only where the finger landed, not the stretch between", () => {
    const p: ScrubParams = { ...base("line", 3), cells: 40, brush: 0.4, speedCeiling: 10 };
    const cells = scrubCells(p);
    const slow = scrubTouch(createScrubState(p), p, { x: -4, z: 0 }, { x: 4, z: 0, tool: "mop", dt: 8 / 5 }, cells);
    const fast = scrubTouch(createScrubState(p), p, { x: -4, z: 0 }, { x: 4, z: 0, tool: "mop", dt: 8 / 50 }, cells);
    expect(slow.gained).toBeGreaterThan(fast.gained);
    expect(fast.gained).toBeLessThan(p.cells / 4);
  });

  it("stops at done and ignores everything after", () => {
    const p = base("blob", 0);
    const done = scrubTouch(createScrubState(p), p, null, { x: 0, z: 0, tool: "mop", dt: 0 }).state;
    const again = scrubTouch(done, p, null, { x: 0, z: 0, tool: "vacuum", dt: 0 });
    expect(again.event).toBe("touched");
    expect(again.state).toBe(done);
  });

  it("ignores a non-finite finger", () => {
    const p = base("blob", 3);
    const s = createScrubState(p);
    expect(scrubTouch(s, p, null, { x: NaN, z: 0, tool: "mop", dt: 0 }).state).toBe(s);
  });

  it("done comes at exactly the coverage: not a cell sooner", () => {
    const p: ScrubParams = { ...base("blob", 3), cells: 10, coverage: 0.7, brush: 0.01, speedFloor: 0, speedCeiling: 1e9 };
    expect(scrubNeeded(p)).toBe(7);
    const cells = scrubCells(p);
    let s = createScrubState(p);
    for (let i = 0; i < 6; i++) { const r = scrubTouch(s, p, { x: 99, z: 99 }, { x: cells[i]!.x, z: cells[i]!.z, tool: "mop", dt: 0.016 }, cells); s = r.state; }
    expect(s.cleared).toBe(6);
    expect(s.done).toBe(false);
    expect(scrubProgress(s, p)).toBeCloseTo(6 / 7);
    const last = scrubTouch(s, p, { x: 99, z: 99 }, { x: cells[6]!.x, z: cells[6]!.z, tool: "mop", dt: 0.016 }, cells);
    expect(last.event).toBe("done");
    expect(scrubProgress(last.state, p)).toBe(1);
  });
});

describe("players", () => {
  it("the switch form finishes any mess in one action", () => {
    for (const shape of SCRUB_SHAPES) for (let b = 0; b <= 5; b++) {
      const p = base(shape, b);
      const r = scrubAll(createScrubState(p), p);
      expect(r.event).toBe("done");
      expect(r.state.done).toBe(true);
    }
  });

  it("the solver reaches done for every shape at every band, with no wrong touch", () => {
    for (const shape of SCRUB_SHAPES) for (let b = 0; b <= 5; b++) {
      const p = base(shape, b);
      const plan = solveScrub(p);
      expect(plan, `${shape} band ${b}`).not.toBeNull();
      const out = playScrub(p, plan!);
      expect(out.state.done, `${shape} band ${b}`).toBe(true);
      expect(out.wrongs).toBe(0);
    }
  });

  it("the solver refuses invalid params", () => {
    expect(solveScrub({ ...base("blob", 3), coverage: 2 })).toBeNull();
  });

  it("the solver is not a free ride at band 3: it needs a real sweep, not one touch", () => {
    const plan = solveScrub(base("blob", 3))!;
    expect(plan.length).toBeGreaterThan(20);
    expect(playScrub(base("blob", 3), plan.slice(0, 3)).state.done).toBe(false);
  });

  it("a random toddler reaches done, every shape, every band, 40 seeds each", () => {
    for (const shape of SCRUB_SHAPES) for (let b = 0; b <= 5; b++) {
      const p = base(shape, b);
      for (let seed = 1; seed <= 40; seed++) {
        const r = toddlerScrub(p, seed);
        expect(r.done, `${shape} band ${b} seed ${seed} after ${r.steps}`).toBe(true);
      }
    }
  });

  it("a toddler who only ever holds the wrong tool never clears a cell", () => {
    const p = base("blob", 3);
    let s = createScrubState(p);
    const rand = seededRandom(7);
    for (let i = 0; i < 500; i++) s = scrubTouch(s, p, { x: 0, z: 0 }, { x: (rand() - 0.5) * 6, z: (rand() - 0.5) * 4, tool: "brush", dt: 0.016 }).state;
    expect(s.cleared).toBe(0);
    expect(s.done).toBe(false);
  });

  it("is deterministic for a seed", () => {
    const p = base("scatter", 2);
    expect(toddlerScrub(p, 3).steps).toBe(toddlerScrub(p, 3).steps);
    const r = seededRandom(5);
    const a = [r(), r(), r()];
    const r2 = seededRandom(5);
    expect([r2(), r2(), r2()]).toEqual(a);
    for (const v of a) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });
});
