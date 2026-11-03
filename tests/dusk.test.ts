import { describe, expect, it } from "vitest";
import { DUSK_LIGHT_FLOOR, DUSK_TINT, duskGrade, duskLightScale } from "../src/features/game/world/runtime/dusk";

const ROOM = { tint: [1.07, 0.99, 0.94] as const, sat: 1.14, vig: 0.34 };

describe("duskGrade", () => {
  it("is the world's own grade when awake, exactly", () => {
    expect(duskGrade(ROOM, 0)).toEqual({ tint: [1.07, 0.99, 0.94], sat: 1.14, vig: 0.34 });
  });
  it("goes cooler and bluer, a little less saturated and a little more vignetted as the room falls asleep", () => {
    const d = duskGrade(ROOM, 1);
    expect(d.tint[0]).toBeLessThan(ROOM.tint[0]);                  // less red
    expect(d.tint[2]).toBeGreaterThan(ROOM.tint[2]);               // more blue
    expect(d.tint[2]).toBeGreaterThan(d.tint[0]);                  // and blue wins
    expect(d.sat).toBeLessThan(ROOM.sat);
    expect(d.sat).toBeGreaterThan(ROOM.sat * 0.7);                 // never washed out
    expect(d.vig).toBeGreaterThan(ROOM.vig);
    expect(d.vig).toBeLessThan(ROOM.vig + 0.3);
    for (let i = 0; i < 3; i++) expect(d.tint[i]!).toBeCloseTo(ROOM.tint[i]! + (DUSK_TINT[i]! - ROOM.tint[i]!) * 0.85, 6);
  });
  it("moves smoothly and monotonically between the two", () => {
    let prev = duskGrade(ROOM, 0);
    for (let l = 0.1; l <= 1.0001; l += 0.1) {
      const g = duskGrade(ROOM, l);
      expect(g.tint[2]).toBeGreaterThanOrEqual(prev.tint[2]);
      expect(g.tint[0]).toBeLessThanOrEqual(prev.tint[0]);
      expect(g.sat).toBeLessThanOrEqual(prev.sat);
      expect(g.vig).toBeGreaterThanOrEqual(prev.vig);
      prev = g;
    }
  });
  it("clamps odd input and does not touch the base", () => {
    expect(duskGrade(ROOM, 7)).toEqual(duskGrade(ROOM, 1));
    expect(duskGrade(ROOM, -3)).toEqual(duskGrade(ROOM, 0));
    expect(duskGrade(ROOM, Number.NaN)).toEqual(duskGrade(ROOM, 0));
    expect(ROOM).toEqual({ tint: [1.07, 0.99, 0.94], sat: 1.14, vig: 0.34 });
  });
});

describe("duskLightScale", () => {
  it("is 1 awake and falls to the floor, never to dark", () => {
    expect(duskLightScale(0)).toBe(1);
    expect(duskLightScale(1)).toBeCloseTo(DUSK_LIGHT_FLOOR, 9);
    expect(DUSK_LIGHT_FLOOR).toBeGreaterThan(0.4);
    expect(duskLightScale(0.5)).toBeLessThan(duskLightScale(0.2));
    expect(duskLightScale(9)).toBeCloseTo(DUSK_LIGHT_FLOOR, 9);
    expect(duskLightScale(-1)).toBe(1);
    expect(duskLightScale(Number.NaN)).toBe(1);
  });
});
