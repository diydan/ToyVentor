import { describe, expect, it } from "vitest";
import { normalizeMissionPanelSnapshot } from "../src/features/game/world/engine";
import { resolveEffectiveMissionTier } from "../src/features/game/world/MissionPanel";
import {
  applySolve,
  canAccessTier,
  emptyProgression,
  familyStars,
  hasStatUnlock,
  MAX_PRACTICE_PER_DAY,
  progressionKey,
  starsFor,
  type ProgressionState,
} from "../src/lib/progression";

const DAY = "2026-10-31";

function withStars(stars: Record<string, number>): ProgressionState {
  return { ...emptyProgression(), missionStars: stars };
}

describe("Phase 3 difficulty tiers", () => {
  it("Tier 1 is always open; higher tiers need 2 stars below", () => {
    const fresh = emptyProgression();
    expect(canAccessTier(fresh, "lab1.bridge", 1)).toBe(true);
    expect(canAccessTier(fresh, "lab1.bridge", 2)).toBe(false);
    expect(canAccessTier(fresh, "lab1.bridge", 3)).toBe(false);
    const t1 = withStars({ "lab1.bridge:t1": 2 });
    expect(canAccessTier(t1, "lab1.bridge", 2)).toBe(true);
    expect(canAccessTier(t1, "lab1.bridge", 3)).toBe(false);
    const t2 = withStars({ "lab1.bridge:t1": 2, "lab1.bridge:t2": 2 });
    expect(canAccessTier(t2, "lab1.bridge", 3)).toBe(true);
  });

  it("sandbox unlock-all opens every tier", () => {
    const prog: ProgressionState = {
      ...emptyProgression(),
      sandboxUnlockAll: true,
    };
    expect(canAccessTier(prog, "lab4.circuit", 3)).toBe(true);
  });

  it("tiered solves pay tier base XP with the star bonus", () => {
    const first = applySolve(emptyProgression(), {
      missionId: "lab2.lift",
      tier: 2,
      attempts: 1,
      clean: true,
      partMatch: true,
      day: DAY,
    });
    expect(first.stars).toBe(3);
    expect(first.kind).toBe("full");
    expect(first.awarded).toBe(Math.round(150 * 1.6));
    const second = applySolve(emptyProgression(), {
      missionId: "lab4.circuit",
      tier: 3,
      attempts: 2,
      partMatch: false,
      day: DAY,
    });
    expect(second.stars).toBe(2);
    expect(second.awarded).toBe(Math.round(220 * 1.25));
  });

  it("star upgrades pay the delta; repeats pay practice XP", () => {
    const input = {
      missionId: "lab1.bridge",
      tier: 1 as const,
      partMatch: false,
      day: DAY,
    };
    const one = applySolve(emptyProgression(), { ...input, attempts: 5 });
    expect(one.stars).toBe(1);
    expect(one.awarded).toBe(100);
    const three = applySolve(one.next, { ...input, attempts: 1, clean: true });
    expect(three.kind).toBe("delta");
    expect(three.awarded).toBe(150 - 100);
    const again = applySolve(three.next, { ...input, attempts: 1, clean: true });
    expect(again.kind).toBe("practice");
    expect(again.awarded).toBe(Math.round(100 * 1.5 * 0.25));
    expect(MAX_PRACTICE_PER_DAY).toBeGreaterThan(0);
  });
});

describe("Phase 3 star scoring", () => {
  it("attempts map to stars; measure family needs a clean first solve for 3", () => {
    expect(starsFor(1)).toBe(3);
    expect(starsFor(2)).toBe(2);
    expect(starsFor(4)).toBe(1);
    expect(starsFor(1, { measureFamily: true })).toBe(2);
    expect(starsFor(1, { measureFamily: true, clean: true })).toBe(3);
  });

  it("familyStars sums every tier key in the family", () => {
    const prog = withStars({
      "lab1.bridge:t1": 2,
      "lab1.measure:t2": 3,
      "lab2.lift:t1": 1,
    });
    expect(familyStars(prog, "lab1")).toBe(5);
    expect(familyStars(prog, "lab2")).toBe(1);
    expect(familyStars(prog, "lab3")).toBe(0);
  });

  it("progression keys carry the tier", () => {
    expect(progressionKey("lab1.bridge", 2)).toBe("lab1.bridge:t2");
  });
});

describe("Phase 3 tier-part mastery", () => {
  it("3 stars in a matching lab unlocks that stat", () => {
    const prog = withStars({ "lab1.bridge:t1": 3 });
    expect(hasStatUnlock(prog, "torque")).toBe(true);
    expect(hasStatUnlock(prog, "speed")).toBe(false);
  });

  it("2 stars are not enough and other families do not count", () => {
    const prog = withStars({
      "lab1.bridge:t1": 2,
      "lab5.code:t1": 3,
    });
    expect(hasStatUnlock(prog, "torque")).toBe(false);
    expect(hasStatUnlock(prog, "spin")).toBe(true);
  });

  it("sandbox unlock-all opens every stat", () => {
    const prog: ProgressionState = {
      ...emptyProgression(),
      sandboxUnlockAll: true,
    };
    expect(hasStatUnlock(prog, "glow")).toBe(true);
  });
});

describe("Phase 3 MissionPanel tier sync & clamping", () => {
  it("normalizes tier 1/2/3 on open MissionPanelSnapshot and defaults invalid/closed tiers to 1", () => {
    expect(normalizeMissionPanelSnapshot({ open: false, tier: 3 }).tier).toBe(1);
    expect(
      normalizeMissionPanelSnapshot({
        open: true,
        title: "Measure the gap",
        tier: 3,
      }).tier,
    ).toBe(3);
    expect(
      normalizeMissionPanelSnapshot({
        open: true,
        title: "Measure the gap",
        tier: 2,
      }).tier,
    ).toBe(2);
    expect(
      normalizeMissionPanelSnapshot({
        open: true,
        title: "Measure the gap",
        tier: 99,
      }).tier,
    ).toBe(1);
  });

  it("preserves unlocked Tier 2/3 from engine state and clamps back down on Reset XP or Sandbox off", () => {
    const sandboxOn: ProgressionState = {
      ...emptyProgression(),
      sandboxUnlockAll: true,
    };
    expect(resolveEffectiveMissionTier(3, "lab1.measure", sandboxOn)).toBe(3);

    // Turning Sandbox off with no stars clamps Tier 3 back to Tier 1.
    expect(
      resolveEffectiveMissionTier(3, "lab1.measure", emptyProgression()),
    ).toBe(1);

    // If Tier 1 has 2 stars (so Tier 2 is open, Tier 3 locked), Tier 3 clamps to Tier 2.
    const tier2Open = withStars({ "lab1.measure:t1": 2 });
    expect(resolveEffectiveMissionTier(3, "lab1.measure", tier2Open)).toBe(2);
    expect(resolveEffectiveMissionTier(2, "lab1.measure", tier2Open)).toBe(2);

    // If both Tier 1 and Tier 2 have >= 2 stars, Tier 3 stays selected across reloads.
    const tier3Open = withStars({
      "lab1.measure:t1": 2,
      "lab1.measure:t2": 3,
    });
    expect(resolveEffectiveMissionTier(3, "lab1.measure", tier3Open)).toBe(3);
  });
});
