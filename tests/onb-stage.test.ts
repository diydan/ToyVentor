// The new-player build stage's numbers (runtime/onbStage.ts): the pile lies far left of the turntable and never touches it, the bricks fly slowly, and the table sinks with Kip on it.
import { describe, expect, it } from "vitest";
import {
  ARRIVE_MS, BRICK_REACH, BUILT_FALLBACK_MS, FLIGHT_S, LAND_S, PILE_DX, PILE_DZ, PILE_GAP, PLACE_S, STAGE_ZOOM, TURNTABLE,
  buildTiming, landPose, nearestTurn, pileClearance, pileSpot, stageZoom,
} from "../src/features/game/world/runtime/onbStage";

describe("the pile lies far to the left of the turntable", () => {
  it("is clear of the table for any pile of up to 200 bricks, by the gap it was built with", () => {
    expect(pileClearance(200)).toBeGreaterThan(PILE_GAP - 0.12);
    for (const n of [1, 3, 28, 40, 120, 200]) expect(pileClearance(n), `n=${n}`).toBeGreaterThan(0.1);
  });
  it("every brick is left of the table's left edge, whatever the angle", () => {
    for (let i = 0; i < 200; i++) { const s = pileSpot(i); expect(PILE_DX + s.dx + BRICK_REACH, `brick ${i}`).toBeLessThan(-TURNTABLE.r); }
  });
  it("sits behind Kip's front by the old depth, and every brick lies on the floor (a little above it)", () => {
    expect(PILE_DZ).toBeCloseTo(0.3, 6);
    for (let i = 0; i < 100; i++) { const s = pileSpot(i); expect(s.dy).toBeGreaterThan(0.1); expect(s.dy).toBeLessThan(0.45); }
  });
  it("lays a brick by its place in the rig only: the same i is the same spot every time", () => {
    for (let i = 0; i < 50; i++) expect(pileSpot(i)).toEqual(pileSpot(i));
  });
  it("a pile put on the table would have been caught (the old pile, 2.3 left, touches it)", () => {
    const old = (i: number) => { const s = pileSpot(i); return Math.hypot(-2.3 + s.dx, PILE_DZ + s.dz) - BRICK_REACH - TURNTABLE.r; };
    expect(Math.min(...Array.from({ length: 40 }, (_, i) => old(i)))).toBeLessThan(0);
  });
});

describe("the bricks fly slowly", () => {
  it("a flight is between 1.6 and 2.2 seconds, for the build and for a brick the child places", () => {
    for (const s of [FLIGHT_S, PLACE_S, buildTiming(28).dur]) { expect(s).toBeGreaterThanOrEqual(1.6); expect(s).toBeLessThanOrEqual(2.2); }
  });
  it("starts are staggered and the last brick lands at the total, which is at most 6.4 s", () => {
    for (const n of [2, 10, 28, 40, 100]) {
      const t = buildTiming(n);
      expect(t.stag, `n=${n}`).toBeGreaterThan(0);
      expect(t.stag * (n - 1) + t.dur).toBeCloseTo(t.total, 6);
      expect(t.total).toBeLessThanOrEqual(6.4 + 1e-9);
    }
    expect(buildTiming(28).total).toBeGreaterThan(5);
  });
  it("one brick, no brick and a bad number all have a sensible total", () => {
    expect(buildTiming(1).total).toBeGreaterThanOrEqual(FLIGHT_S);
    expect(buildTiming(0).total).toBeLessThan(0.5);
    expect(buildTiming(Number.NaN).total).toBeLessThan(0.5);
  });
  it("the sheet's fallback outlasts the build and the arrival, so the world's own word comes first", () => {
    expect(BUILT_FALLBACK_MS).toBeGreaterThan((buildTiming(200).total + ARRIVE_MS / 1000) * 1000);
  });
});

describe("the landing", () => {
  it("starts with Kip on the table and ends on the floor, the table under it, facing the screen", () => {
    const a = landPose(0, TURNTABLE.top, 2.2, -Math.PI / 2), b = landPose(1, TURNTABLE.top, 2.2, -Math.PI / 2);
    expect(a).toEqual({ y: TURNTABLE.top, sink: -0, face: 2.2 });
    expect(b.y).toBeCloseTo(0, 9);
    expect(b.sink).toBeCloseTo(-TURNTABLE.sink, 9);
    expect(Math.cos(b.face)).toBeCloseTo(Math.cos(-Math.PI / 2), 9); expect(Math.sin(b.face)).toBeCloseTo(Math.sin(-Math.PI / 2), 9);
    expect(TURNTABLE.top - TURNTABLE.sink).toBeLessThan(0);                    // the table's top ends below the floor
    expect(LAND_S).toBeLessThan(1);
  });
  it("never spins more than half a turn to face the screen, and the height only falls", () => {
    for (const f0 of [-20, -7, -3, 0, 1, 3.1, 9, 40]) {
      const end = landPose(1, TURNTABLE.top, f0, -Math.PI / 2).face;
      expect(Math.abs(end - f0), `from ${f0}`).toBeLessThanOrEqual(Math.PI + 1e-9);
      let prev = Infinity; for (let k = 0; k <= 10; k++) { const y = landPose(k / 10, TURNTABLE.top, f0, -Math.PI / 2).y; expect(y).toBeLessThanOrEqual(prev + 1e-12); prev = y; }
    }
  });
  it("nearestTurn handles bad numbers and gives the equivalent angle nearest the start", () => {
    expect(nearestTurn(Number.NaN, 1)).toBeCloseTo(1, 9);
    expect(nearestTurn(7, 1)).toBeCloseTo(1 + 2 * Math.PI, 9);
    expect(nearestTurn(-7, 1)).toBeCloseTo(1 - 2 * Math.PI, 9);
  });
  it("landPose tolerates a bad k", () => {
    expect(landPose(Number.NaN, 0.36, 0, 0).y).toBeCloseTo(0, 9);
    expect(landPose(-5, 0.36, 0, 0).y).toBeCloseTo(0.36, 9);
  });
});

describe("the stage's view is wider on a narrower screen", () => {
  it("is 1.3 at 844 by 390, 1.58 at 667 by 375, never nearer than 1.25 or farther than 2", () => {
    expect(stageZoom(844 / 390)).toBeCloseTo(1.3, 2);
    expect(stageZoom(932 / 430)).toBeCloseTo(1.3, 2);
    expect(stageZoom(2.5)).toBe(STAGE_ZOOM);
    expect(stageZoom(667 / 375)).toBeCloseTo(1.58, 2);
    expect(stageZoom(740 / 360)).toBeGreaterThan(1.3);
    expect(stageZoom(0.5)).toBe(2);
    for (const bad of [0, -1, Number.NaN, Infinity * 0]) expect(stageZoom(bad)).toBe(STAGE_ZOOM);
  });
  it("only ever steps back as the screen narrows", () => {
    let prev = 0; for (let a = 3; a >= 1.2; a -= 0.1) { const z = stageZoom(a); expect(z).toBeGreaterThanOrEqual(prev - 1e-12); prev = z; }
  });
});
