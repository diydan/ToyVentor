import { describe, expect, it } from "vitest";
import baseSetJson from "../sets/base.json";
import {
  boardForToy,
  buildStats,
  canPlace,
  findPlacement,
  footprintOf,
  pitchOf,
  rotatePlacement,
  snapMm,
  type Placement,
} from "../shared/build";
import type { Part, ToySet } from "../shared/part";
import type { Toy } from "../shared/toy";

const parts = (baseSetJson as ToySet).parts;
const byId = new Map(parts.map((p) => [p.id, p]));
const part = (id: string): Part => byId.get(id)!;

const car: Toy = {
  id: "seed-car", name: "Seed Car", kind: "car", sizeClass: "small",
  lengthMm: 110, widthMm: 55,
  attachPoints: [{ id: "roof", label: "Roof" }], source: "seed",
};
const board = boardForToy(car);

const at = (partId: string, xMm: number, yMm: number, rotation: Placement["rotation"] = 0): Placement =>
  ({ instanceId: `${partId}@${xMm},${yMm}`, partId, xMm, yMm, rotation });

describe("grid geometry", () => {
  it("derives pitch from footprint and grid units", () => {
    expect(pitchOf(part("snap-brick-2x2-small"), 0)).toEqual([16, 16]);
    expect(pitchOf(part("pro-beam-su05"), 0)).toEqual([12.5, 12.5]);
  });

  it("rotation swaps the footprint", () => {
    expect(footprintOf(part("snap-spoiler-01"), 0)).toEqual([32, 16]);
    expect(footprintOf(part("snap-spoiler-01"), 90)).toEqual([16, 32]);
  });

  it("snaps to the nearest pitch step", () => {
    expect(snapMm(20, 16)).toBe(16);
    expect(snapMm(25, 16)).toBe(32);
    expect(snapMm(31, 12.5)).toBe(25);
  });
});

describe("canPlace", () => {
  it("accepts an empty board and rejects off-board", () => {
    const brick = part("snap-brick-2x2-small");
    expect(canPlace(brick, 0, 0, 0, [], byId, board).ok).toBe(true);
    expect(canPlace(brick, 96, 0, 0, [], byId, board)).toEqual({ ok: false, reason: "outside" });
  });

  it("rejects collisions but ignores the piece being moved", () => {
    const brick = part("snap-brick-2x2-small");
    const placed = [at(brick.id, 0, 0)];
    expect(canPlace(brick, 16, 0, 0, placed, byId, board)).toEqual({ ok: false, reason: "collision" });
    expect(canPlace(brick, 32, 0, 0, placed, byId, board).ok).toBe(true);
    expect(canPlace(brick, 0, 0, 0, placed, byId, board, placed[0]!.instanceId).ok).toBe(true);
  });

  it("edge-touching is not a collision", () => {
    const spoiler = part("snap-spoiler-01"); // 32x16: stacks edge-to-edge in y
    expect(canPlace(spoiler, 0, 16, 0, [at(spoiler.id, 0, 0)], byId, board).ok).toBe(true);
  });
});

describe("findPlacement and rotate", () => {
  it("fills from the corner at the part's pitch", () => {
    const brick = part("snap-brick-2x2-small");
    expect(findPlacement(brick, [], byId, board)).toEqual({ xMm: 0, yMm: 0, rotation: 0 });
    expect(findPlacement(brick, [at(brick.id, 0, 0)], byId, board)).toEqual({ xMm: 32, yMm: 0, rotation: 0 });
  });

  it("returns null when the board is full or the part cannot fit", () => {
    const big = part("snap-brick-2x2-large"); // 64mm on a 55mm-wide board
    expect(findPlacement(big, [], byId, board)).toBeNull();
  });

  it("rotates when the rotated footprint still fits", () => {
    const spoiler = at("snap-spoiler-01", 0, 0);
    const rotated = rotatePlacement(spoiler, [spoiler], byId, board);
    expect(rotated?.rotation).toBe(90);
    const atEdge = at("snap-spoiler-01", 78, 39);
    expect(rotatePlacement(atEdge, [atEdge], byId, board)).toBeNull();
  });
});

describe("buildStats", () => {
  it("totals one stat per part and counts printables", () => {
    const stats = buildStats(
      [at("snap-spoiler-01", 0, 0), at("snap-wing-01", 32, 0), at("skin-racer-red", 64, 0)],
      byId,
    );
    expect(stats.placements).toBe(3);
    expect(stats.printableCount).toBe(2);
    expect(stats.statTotals).toEqual({ speed: 3, glow: 2 });
  });
});
