import { describe, expect, it } from "vitest";
import {
  applySolve,
  canAccessTier,
  canAccessVehicle,
  computeAward,
  emptyProgression,
  familyOf,
  familyStars,
  grandfatherToyIds,
  hasProStatUnlock,
  mergeProgression,
  normalizeProgression,
  rankFor,
  resetProgression,
  starsFor,
  unlockedVehiclesFor,
  type ProgressionState,
} from "../src/lib/progression";

const DAY = "2026-10-30";

function solved(
  prog: ProgressionState,
  opts: Partial<Parameters<typeof applySolve>[1]> & { missionId: string },
) {
  return applySolve(prog, {
    tier: 1,
    attempts: 1,
    partMatch: false,
    day: DAY,
    ...opts,
  });
}

describe("starsFor", () => {
  it("awards 3/2/1 stars by attempt count", () => {
    expect(starsFor(1)).toBe(3);
    expect(starsFor(2)).toBe(2);
    expect(starsFor(3)).toBe(1);
    expect(starsFor(9)).toBe(1);
  });

  it("gates measure-family 3 stars on a clean first solve", () => {
    expect(starsFor(1, { clean: true, measureFamily: true })).toBe(3);
    expect(starsFor(1, { clean: false, measureFamily: true })).toBe(2);
    expect(starsFor(1, { clean: false, measureFamily: false })).toBe(3);
  });
});

describe("computeAward", () => {
  it("matches the confirmed formula with Math.round", () => {
    // Tier 1 base 100, 3 stars +50%, part-match +10% => 160.
    expect(computeAward({ tier: 1, stars: 3, partMatch: true })).toBe(160);
    // Tier 1, 2 stars +25%, no part-match => 125.
    expect(computeAward({ tier: 1, stars: 2, partMatch: false })).toBe(125);
    // Tier 3 base 220, 1 star +0% => 220.
    expect(computeAward({ tier: 3, stars: 1, partMatch: false })).toBe(220);
    // Practice replay factor 0.25 on a 3-star Tier 1 with part-match => 40.
    expect(
      computeAward({ tier: 1, stars: 3, partMatch: true, replayFactor: 0.25 }),
    ).toBe(40);
  });
});

describe("applySolve anti-farming", () => {
  it("pays full on first solve, delta on improvement, practice on maxed repeat", () => {
    const first = solved(emptyProgression(), {
      missionId: "lab1.measure",
      attempts: 3,
    });
    expect(first.stars).toBe(1);
    expect(first.awarded).toBe(100);
    expect(first.next.totalXp).toBe(100);

    const improved = solved(first.next, {
      missionId: "lab1.measure",
      attempts: 1,
      clean: true,
    });
    expect(improved.stars).toBe(3);
    // Full 3-star award is 150; 100 already paid, so delta is 50.
    expect(improved.awarded).toBe(50);
    expect(improved.next.totalXp).toBe(150);

    const practice = solved(improved.next, {
      missionId: "lab1.measure",
      attempts: 1,
      clean: true,
    });
    expect(practice.awarded).toBe(38); // round(150 * 0.25) = 38 (37.5 rounds up)
    expect(practice.kind).toBe("practice");
  });

  it("pays capped practice for non-improving same-day repeats", () => {
    const first = solved(emptyProgression(), {
      missionId: "lab1.bridge",
      attempts: 2,
    });
    expect(first.awarded).toBe(125);
    const worse = solved(first.next, {
      missionId: "lab1.bridge",
      attempts: 5,
    });
    // 1-star multiplier 1.0 at 0.25x => 25, first of 2 daily practice pays.
    expect(worse.awarded).toBe(25);
    expect(worse.kind).toBe("practice");
    const second = solved(worse.next, {
      missionId: "lab1.bridge",
      attempts: 5,
    });
    expect(second.awarded).toBe(25);
    const third = solved(second.next, {
      missionId: "lab1.bridge",
      attempts: 5,
    });
    expect(third.awarded).toBe(0);
    expect(third.kind).toBe("none");
  });

  it("pays full again on a new local day", () => {
    const first = solved(emptyProgression(), {
      missionId: "lab1.bridge",
      attempts: 1,
    });
    expect(first.awarded).toBe(150);
    const nextDay = applySolve(first.next, {
      missionId: "lab1.bridge",
      tier: 1,
      attempts: 1,
      partMatch: false,
      day: "2026-10-31",
    });
    expect(nextDay.awarded).toBe(150);
    expect(nextDay.kind).toBe("full");
  });
});

describe("ranks and family gates", () => {
  it("resolves Maker Rank thresholds and Rank 2 vehicles", () => {
    expect(rankFor(0).rank).toBe(1);
    expect(rankFor(249).rank).toBe(1);
    expect(rankFor(250).rank).toBe(2);
    expect(rankFor(250).title).toBe("Workshop Builder");
    expect(rankFor(250).vehicles).toEqual(["Hauler Truck", "Motor Scooter"]);
    expect(rankFor(2700).rank).toBe(6);
  });

  it("gates tiers per mission, with sandbox override", () => {
    let prog = emptyProgression();
    prog = solved(prog, { missionId: "lab1.bridge", attempts: 2 }).next;
    expect(familyOf("lab1.bridge")).toBe("lab1");
    expect(familyStars(prog, "lab1")).toBe(2);
    expect(canAccessTier(prog, "lab1.bridge", 2)).toBe(true);
    expect(canAccessTier(prog, "lab1.bridge", 3)).toBe(false);
    expect(canAccessTier(prog, "lab1.measure", 2)).toBe(false);
    const tier2 = applySolve(prog, {
      missionId: "lab1.bridge",
      tier: 2,
      attempts: 2,
      partMatch: false,
      day: DAY,
    }).next;
    expect(canAccessTier(tier2, "lab1.bridge", 3)).toBe(true);
    expect(
      canAccessTier({ ...prog, sandboxUnlockAll: true }, "lab2.logic", 3),
    ).toBe(true);
  });

  it("unlocks Pro stats on a 3-star solve in a matching lab or world mission", () => {
    const prog = solved(emptyProgression(), {
      missionId: "lab1.bridge",
      attempts: 1,
    }).next;
    expect(hasProStatUnlock(prog, "torque")).toBe(true);
    expect(hasProStatUnlock(prog, "spin")).toBe(false);

    expect(familyOf("garden.bridge")).toBe("lab1");
    expect(familyOf("junk.lift")).toBe("lab2");
    const gardenProg = solved(emptyProgression(), {
      missionId: "garden.bridge",
      attempts: 1,
    }).next;
    expect(hasProStatUnlock(gardenProg, "torque")).toBe(true);
  });

  it("checks vehicle access cumulatively across ranks and preserves starter/grandfathered vehicles", () => {
    const rank1 = emptyProgression();
    expect(canAccessVehicle(rank1, "Red Racer")).toBe(true);
    expect(canAccessVehicle(rank1, "Hauler Truck")).toBe(false);

    const rank3: ProgressionState = { ...emptyProgression(), totalXp: 600 };
    expect(canAccessVehicle(rank3, "Hauler Truck")).toBe(true);
    expect(canAccessVehicle(rank3, "Sport Motorbike")).toBe(true);
    expect(canAccessVehicle(rank3, "Prop Aeroplane")).toBe(false);
    expect(unlockedVehiclesFor(600)).toEqual([
      "Hauler Truck",
      "Motor Scooter",
      "Sport Motorbike",
      "Loader Tractor & Trailer",
    ]);

    const grandfathered = grandfatherToyIds(emptyProgression(), [
      "seed-truck",
      "Prop Aeroplane",
    ]).next;
    expect(canAccessVehicle(grandfathered, "Hauler Truck", "seed-truck")).toBe(
      true,
    );
    expect(canAccessVehicle(grandfathered, "Prop Aeroplane")).toBe(true);
  });
});

describe("persistence helpers", () => {
  it("normalizes untrusted stored data", () => {
    const prog = normalizeProgression({
      totalXp: 300,
      missionStars: { "lab1.bridge:t1": 3, bogus: 9 },
      unlockedIds: ["seed-car"],
      resetAt: 1700000000000,
    });
    expect(prog.totalXp).toBe(300);
    expect(prog.missionStars["lab1.bridge:t1"]).toBe(3);
    expect(prog.missionStars.bogus).toBeUndefined();
    expect(prog.resetAt).toBe(1700000000000);
  });

  it("merges remote progression without losing stars or unlocks", () => {
    const local = solved(emptyProgression(), {
      missionId: "lab1.bridge",
      attempts: 1,
    }).next;
    const remote: ProgressionState = {
      ...emptyProgression(),
      totalXp: 500,
      unlockedIds: ["scanned-1"],
    };
    const merged = mergeProgression(local, remote);
    expect(merged.totalXp).toBe(500);
    expect(merged.missionStars["lab1.bridge:t1"]).toBe(3);
    expect(merged.unlockedIds).toContain("scanned-1");
  });

  it("reset wipes XP and stars, keeps grandfathered unlocks, and wins over stale remote XP", () => {
    const prog: ProgressionState = {
      ...solved(emptyProgression(), {
        missionId: "lab1.bridge",
        attempts: 1,
      }).next,
      unlockedIds: ["seed-figure", "scanned-1"],
    };
    const reset = resetProgression(prog, 1700000005000);
    expect(reset.totalXp).toBe(0);
    expect(reset.missionStars).toEqual({});
    expect(reset.unlockedIds).toEqual(["seed-figure", "scanned-1"]);

    const staleRemote: ProgressionState = {
      ...emptyProgression(),
      totalXp: 850,
      missionStars: { "lab1.bridge:t1": 3 },
      unlockedIds: ["remote-scan"],
    };
    const merged = mergeProgression(reset, staleRemote);
    expect(merged.totalXp).toBe(0);
    expect(merged.missionStars).toEqual({});
    expect(merged.unlockedIds).toEqual([
      "seed-figure",
      "scanned-1",
      "remote-scan",
    ]);
  });
});
