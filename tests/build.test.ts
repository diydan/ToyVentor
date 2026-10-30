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
  id: "seed-car",
  name: "Seed Car",
  kind: "car",
  sizeClass: "small",
  lengthMm: 110,
  widthMm: 55,
  attachPoints: [{ id: "roof", label: "Roof" }],
  source: "seed",
};
const board = boardForToy(car);

const at = (
  partId: string,
  xMm: number,
  yMm: number,
  rotation: Placement["rotation"] = 0,
): Placement => ({ instanceId: `${partId}@${xMm},${yMm}`, partId, xMm, yMm, rotation });

describe("grid geometry (12.5 mm / 25 mm TU lattice)", () => {
  it("derives 12.5 mm and 25 mm TU pitch from footprint and grid units", () => {
    expect(pitchOf(part("brick-s-2x2"), 0)).toEqual([12.5, 12.5]);
    expect(pitchOf(part("big-blue-brick"), 0)).toEqual([25, 25]);
    expect(pitchOf(part("beam-str-tu05"), 0)).toEqual([12.5, 12.5]);
  });

  it("rotation swaps the footprint", () => {
    expect(footprintOf(part("racer-spoiler"), 0)).toEqual([25, 12.5]);
    expect(footprintOf(part("racer-spoiler"), 90)).toEqual([12.5, 25]);
  });

  it("snaps to the nearest pitch step", () => {
    expect(snapMm(18, 12.5)).toBe(12.5);
    expect(snapMm(20, 12.5)).toBe(25);
    expect(snapMm(31, 12.5)).toBe(25);
    expect(snapMm(38, 25)).toBe(50);
  });
});

describe("canPlace", () => {
  it("accepts an empty board and rejects off-board", () => {
    const brick = part("brick-s-2x2"); // 25x25 mm
    expect(canPlace(brick, 0, 0, 0, [], byId, board).ok).toBe(true);
    expect(canPlace(brick, 87.5, 0, 0, [], byId, board)).toEqual({
      ok: false,
      reason: "outside",
    });
  });

  it("rejects collisions but ignores the piece being moved", () => {
    const brick = part("brick-s-2x2");
    const placed = [at(brick.id, 0, 0)];
    expect(canPlace(brick, 12.5, 0, 0, placed, byId, board)).toEqual({
      ok: false,
      reason: "collision",
    });
    expect(canPlace(brick, 25, 0, 0, placed, byId, board).ok).toBe(true);
    expect(canPlace(brick, 0, 0, 0, placed, byId, board, placed[0]!.instanceId).ok).toBe(true);
  });

  it("edge-touching is not a collision", () => {
    const spoiler = part("racer-spoiler"); // 25x12.5: stacks edge-to-edge in y
    expect(canPlace(spoiler, 0, 12.5, 0, [at(spoiler.id, 0, 0)], byId, board).ok).toBe(true);
  });
});

describe("findPlacement and rotate", () => {
  it("fills from the corner at the part's 12.5 mm TU pitch", () => {
    const brick = part("brick-s-2x2");
    expect(findPlacement(brick, [], byId, board)).toEqual({ xMm: 0, yMm: 0, rotation: 0 });
    expect(findPlacement(brick, [at(brick.id, 0, 0)], byId, board)).toEqual({
      xMm: 25,
      yMm: 0,
      rotation: 0,
    });
  });

  it("returns null when the part footprint exceeds the board width", () => {
    const ring = part("forge-mount-ring-s"); // 62.5x62.5 mm on a 55 mm-wide board
    expect(findPlacement(ring, [], byId, board)).toBeNull();
  });

  it("rotates when the rotated footprint still fits", () => {
    const spoiler = at("racer-spoiler", 0, 0);
    const rotated = rotatePlacement(spoiler, [spoiler], byId, board);
    expect(rotated?.rotation).toBe(90);
    const atEdge = at("racer-spoiler", 85, 42.5); // 25x12.5 fits, 12.5x25 exceeds 55 mm width
    expect(rotatePlacement(atEdge, [atEdge], byId, board)).toBeNull();
  });
});

describe("buildStats", () => {
  it("totals one stat per part and counts printables", () => {
    const stats = buildStats(
      [
        at("racer-spoiler", 0, 0),
        at("glow-capsule", 25, 0),
        at("skin-racer-red", 50, 0),
      ],
      byId,
    );
    expect(stats.placements).toBe(3);
    expect(stats.printableCount).toBe(2);
    expect(stats.statTotals).toEqual({ speed: 3, glow: 3 });
  });
});
