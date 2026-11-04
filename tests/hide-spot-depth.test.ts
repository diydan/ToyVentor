// The hiding spots stand BEHIND Kip's walking lane (src/features/game/world/runtime/hideSpots.ts), like the props do, and "is Kip near it" still works from the lane. Dan, 2026-11-04: "items off the main
// walking rail, currently many items are on Kip's walking path". The props were set back in the landscape HUD; the dark bush, the blue rock, the ice cave, the crates and the rest were not. Every spot in
// the real catalog is walked here, so a new hiding place cannot be added on the lane by accident.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HIDE } from "../src/features/game/world/runtime/catalog";
import { AIRBORNE_COVERS, LANE_BACK_Z, isNearDepth, nearDepth, setBackSpot, standsInLane } from "../src/features/game/world/runtime/hideSpots";

const root = new URL("..", import.meta.url).pathname;
const world = readFileSync(`${root}src/features/game/world/runtime/world.ts`, "utf8");
const CLEAR_Z = -2.8;                          // (the same number world.ts clears props to; pinned against the source below)
const LANE = 1.2;                              // clampPathZ in visitRoutine.ts: Kip walks z -1.2 to 1.2

/** A spot as catalog.ts builds it from a hide key: junk machines carry `obj`, everything else `cover`. */
const asSpot = (key: string): { t: string; z: number; obj?: string; cover?: string } => {
  const h = HIDE[key]!;
  return h.t === "junk" ? { t: h.t, z: h.z, obj: key } : { t: h.t, z: h.z, cover: key };
};

describe("which spots move", () => {
  const all = Object.keys(HIDE).map((key) => [key, asSpot(key)] as const);
  it("there are hiding places to look at, of every kind", () => {
    expect(all.length).toBeGreaterThanOrEqual(30);
    expect(new Set(all.map(([, h]) => h.t))).toEqual(new Set(["junk", "glow", "torque", "speed", "spin"]));
  });
  it("every spot standing on the ground inside the lane goes back to CLEAR_Z, on a COPY (the catalog, the editor and saved worlds keep the original)", () => {
    let moved = 0;
    for (const [key, h] of all) {
      const before = JSON.stringify(h);
      const built = setBackSpot(h, CLEAR_Z);
      expect(JSON.stringify(h), `${key} was mutated`).toBe(before);
      if (standsInLane(h, CLEAR_Z)) {
        moved++;
        expect(built.z, key).toBe(CLEAR_Z);
        expect(built, key).not.toBe(h);
        expect({ ...built, z: h.z }, `${key} lost a field`).toEqual(h);
      } else expect(built, key).toBe(h);
    }
    expect(moved).toBeGreaterThanOrEqual(27);                 // (30 spots less the plank, the island and the flat pond)
  });
  it("nothing that stands on the ground in front of Kip's back line is left in the lane (the floating ones and the flat pond in front are the only exceptions)", () => {
    for (const [key, h] of all) {
      if (AIRBORNE_COVERS.includes(key)) continue;
      const z = setBackSpot(h, CLEAR_Z).z ?? 0;
      if (z >= 0) continue;                    // the lily pond is a flat disc in front
      expect(z, key).toBeLessThanOrEqual(CLEAR_Z);
    }
  });
  it("the ones that stay: the plank in the tree and the floating island (nothing to walk into) and the flat pond in front", () => {
    expect([...AIRBORNE_COVERS].sort()).toEqual(["branch", "island"]);
    for (const key of AIRBORNE_COVERS) expect(standsInLane(asSpot(key), CLEAR_Z), key).toBe(false);
    expect(HIDE.pond!.z).toBeGreaterThan(0);
    expect(standsInLane(asSpot("pond"), CLEAR_Z)).toBe(false);
  });
  it("the tall spots that DO stand on the ground are moved: the crane's base, the lifeguard tower's legs, the ice ledge's pillar and the bookshelf's posts (Dash hops Kip to the spot's x at z 0, so their depth never mattered to it)", () => {
    for (const key of ["crane", "tower", "ledge", "shelf"]) {
      expect(HIDE[key]!.t, key).toBe("speed");
      expect(setBackSpot(asSpot(key), CLEAR_Z).z, key).toBe(CLEAR_Z);
    }
  });
  it("a spot already behind CLEAR_Z, or one with no depth of its own, is left alone / treated as depth 0 (in front of the lane's back, so not moved)", () => {
    expect(standsInLane({ z: -4 }, CLEAR_Z)).toBe(false);
    expect(standsInLane({ z: -2.8 }, CLEAR_Z)).toBe(false);
    expect(standsInLane({ z: -0.01 }, CLEAR_Z)).toBe(true);
    expect(standsInLane({}, CLEAR_Z)).toBe(false);
  });
  it("the shapes' own front edge clears the lane: the widest thing that sticks out toward Kip is the cave's and bush's 1.15 ring and the 0.3 sprite offset", () => {
    expect(CLEAR_Z + 0.3 + 1.15).toBeLessThan(-LANE);
  });
});

describe("near() from the lane", () => {
  it("Kip's usual line (z 0) and the whole back three quarters of the lane are near every spot that was moved, at the same 2 unit window as before", () => {
    for (const key of Object.keys(HIDE)) {
      const h = asSpot(key);
      if (!standsInLane(h, CLEAR_Z)) continue;
      const z = setBackSpot(h, CLEAR_Z).z!;
      for (const kipZ of [0, -0.4, -0.8, -LANE]) expect(isNearDepth(kipZ, z), `${key} at kip z ${kipZ}`).toBe(true);
    }
  });
  it("it was near from z 0 before the move too, so nothing about the usual walk changes", () => {
    for (const [key, h] of Object.entries(HIDE)) expect(isNearDepth(0, h.z ?? 0) || (h.z ?? 0) > 1.9, key).toBe(true);
  });
  it("a spot is still not near when Kip is really far in front of it (depth is compared, not ignored)", () => {
    expect(isNearDepth(5, -2.8)).toBe(false);
    expect(isNearDepth(0.9, -2.8)).toBe(false);          // the very front of the lane no longer counts for a set-back spot
  });
  it("a spot's depth is measured no further back than the back of the lane, and never changed for a spot in front of it", () => {
    expect(nearDepth(-2.8)).toBe(LANE_BACK_Z);
    expect(nearDepth(-0.7)).toBe(-0.7);
    expect(nearDepth(2)).toBe(2);
  });
});

describe("world.ts uses them", () => {
  it("imports the helpers, builds every spot through setBackSpot with the same CLEAR_Z as the props, and near() compares depth with isNearDepth", () => {
    expect(world).toContain('import { isNearDepth, setBackSpot } from "./hideSpots";');
    expect(world).toContain("const CLEAR_Z=-2.8;");
    expect(world).toContain("R.spots.forEach(function(d0,i){var d=setBackSpot(d0,CLEAR_Z);var sp: any={d:d,");
    expect(world).toContain("function near(sp: any,r: number){return Math.abs(sp.d.x-P.pos.x)<r&&isNearDepth(P.pos.z,(sp.d as any).z||0)}");
  });
  it("the old depth test is gone (it compared against the unmoved depth and would stop every moved spot from glowing)", () => {
    expect(world).not.toContain("Math.abs(P.pos.z-((sp.d as any).z||0))<2");
  });
});
