import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyDailyQuestProgress,
  CONCEPT_BADGES,
  conceptBadgesFor,
  DAILY_QUEST_XP,
  dailyQuestsForDay,
  earnedConceptBadges,
  practicedSkillsSummary,
  workshopDaysCount,
} from "../src/lib/dailyQuests";
import {
  applySolve,
  emptyProgression,
  familyOf,
  grandfatherToyIds,
  mergeProgression,
  MISSION_TYPES,
  normalizeProgression,
  resetProgression,
  type ProgressionState,
  type SolveInput,
} from "../src/lib/progression";

const ROOT = resolve(__dirname, "..");

function solveWithQuests(prog: ProgressionState, input: SolveInput) {
  const solved = applySolve(prog, input);
  const quests = applyDailyQuestProgress(prog, solved.next, input, solved.stars);
  return { solved, quests, next: quests.next };
}

describe("STEM Concept Badges", () => {
  it("maps every shipped MissionType to a verified runtime mission and em-dash-free copy", () => {
    expect(CONCEPT_BADGES.map((b) => b.id).sort()).toEqual(
      [...MISSION_TYPES].sort(),
    );

    const worldSrc = ["world.ts", "catalog.ts"]
      .map((f) =>
        readFileSync(
          resolve(ROOT, `src/features/game/world/runtime/${f}`),
          "utf8",
        ),
      )
      .join("\n");

    for (const badge of CONCEPT_BADGES) {
      expect(badge.title).not.toContain("\u2014");
      expect(badge.parentSkill).not.toContain("\u2014");
      expect(worldSrc).toContain(`"id":"${badge.worldId}"`);
      for (const mKey of badge.missionIds) {
        const [wId, mType] = mKey.split(".");
        expect(worldSrc).toContain(`"id":"${wId}"`);
        expect(worldSrc).toContain(`"type":"${mType}"`);
      }
    }
  });

  it("derives Sprout / Tinker / Master badge tiers from missionStars and formats parent summary", () => {
    const fresh = emptyProgression();
    expect(earnedConceptBadges(fresh)).toEqual([]);
    expect(practicedSkillsSummary(fresh)).toContain("None yet");
    expect(practicedSkillsSummary(fresh)).not.toContain("\u2014");

    // 1-star solve -> Sprout
    const step1 = solveWithQuests(fresh, {
      missionId: "garden.bridge",
      tier: 1,
      attempts: 4,
      partMatch: false,
      day: "2026-11-01",
    });
    expect(step1.quests.upgradedBadges.map((b) => b.tierLabel)).toEqual([
      "Sprout",
    ]);

    // 2-star solve on lab3.raft -> Tinker
    const step2 = solveWithQuests(step1.next, {
      missionId: "lab3.raft",
      tier: 1,
      attempts: 2,
      partMatch: false,
      day: "2026-11-01",
    });
    expect(step2.quests.upgradedBadges[0]?.id).toBe("raft");
    expect(step2.quests.upgradedBadges[0]?.tierLabel).toBe("Tinker");

    // 3-star solve on lab1.bridge (same "bridge" concept, Tier 2) -> upgrades Sprout to Master
    const step3 = solveWithQuests(step2.next, {
      missionId: "lab1.bridge",
      tier: 2,
      attempts: 1,
      partMatch: true,
      day: "2026-11-01",
    });
    expect(step3.quests.upgradedBadges[0]?.id).toBe("bridge");
    expect(step3.quests.upgradedBadges[0]?.tierLabel).toBe("Master");

    const all = conceptBadgesFor(step3.next);
    expect(all.find((b) => b.id === "bridge")?.bestStars).toBe(3);
    expect(all.find((b) => b.id === "raft")?.bestStars).toBe(2);
    expect(all.find((b) => b.id === "code")?.earned).toBe(false);

    const summary = practicedSkillsSummary(step3.next);
    expect(summary).toContain("Structural triangles (★★★)");
    expect(summary).toContain("Buoyancy & displacement (★★)");
    expect(summary).not.toContain("\u2014");
  });
});

describe("Daily Quest Board & non-resetting Workshop Days", () => {
  it("rotates 3 deterministic, distinct-world daily quests across local dates without RNG", () => {
    const prog = emptyProgression();
    const seenSignatures = new Set<string>();

    for (const day of [
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
    ]) {
      const firstCall = dailyQuestsForDay(day, prog);
      const secondCall = dailyQuestsForDay(day, prog);
      expect(secondCall).toEqual(firstCall);
      expect(firstCall).toHaveLength(3);
      expect(firstCall.map((q) => q.slot)).toEqual(["fix", "tinker", "mastery"]);

      const worlds = new Set(firstCall.map((q) => q.worldId));
      expect(worlds.size).toBe(3);

      for (const q of firstCall) {
        expect(q.xpBonus).toBe(DAILY_QUEST_XP);
        expect(q.completed).toBe(false);
        expect(q.title).not.toContain("\u2014");
        expect(q.goal).not.toContain("\u2014");
      }
      seenSignatures.add(firstCall.map((q) => q.id).join("|"));
    }

    // Multiple distinct boards appear across the week.
    expect(seenSignatures.size).toBeGreaterThanOrEqual(4);
  });

  it("pays +40 XP once per completed daily quest and preserves Workshop Day stamps across skipped days", () => {
    const day1 = "2026-11-01";
    const board1 = dailyQuestsForDay(day1, emptyProgression());
    const fixQuest = board1.find((q) => q.slot === "fix")!;
    const tinkerQuest = board1.find((q) => q.slot === "tinker")!;
    const fixMissionId = fixQuest.id.replace("fix:", "");

    // Solve today's exact Fix-It mission cleanly on 1st try -> triggers both fix + mastery (+80 XP quest bonus)
    const run1 = solveWithQuests(emptyProgression(), {
      missionId: fixMissionId,
      tier: 1,
      attempts: 1,
      clean: true,
      partMatch: false,
      day: day1,
    });
    expect(run1.quests.completedQuests.map((q) => q.slot)).toEqual([
      "fix",
      "mastery",
    ]);
    expect(run1.quests.questXpAwarded).toBe(DAILY_QUEST_XP * 2);
    expect(run1.next.totalXp).toBe(run1.solved.awarded + DAILY_QUEST_XP * 2);
    expect(workshopDaysCount(run1.next)).toBe(1);

    // Replaying the exact same mission on the same day never re-awards quest XP
    const replay = solveWithQuests(run1.next, {
      missionId: fixMissionId,
      tier: 1,
      attempts: 1,
      clean: true,
      partMatch: false,
      day: day1,
    });
    expect(replay.quests.completedQuests).toEqual([]);
    expect(replay.quests.questXpAwarded).toBe(0);
    expect(workshopDaysCount(replay.next)).toBe(1);

    // Complete the remaining Tinker quest via Tier 2 in its target lab family
    const tinkerMission =
      tinkerQuest.worldId === "lab3"
        ? "lab3.raft"
        : tinkerQuest.worldId === "lab4"
          ? "lab4.lever"
          : tinkerQuest.worldId === "lab5"
            ? "lab5.code"
            : tinkerQuest.worldId === "lab2"
              ? "lab2.lift"
              : "lab1.bridge";
    expect(familyOf(tinkerMission)).toBe(tinkerQuest.id.replace("tinker:", ""));

    const run2 = solveWithQuests(replay.next, {
      missionId: tinkerMission,
      tier: 2,
      attempts: 2,
      partMatch: false,
      day: day1,
    });
    expect(run2.quests.completedQuests.map((q) => q.slot)).toEqual(["tinker"]);
    expect(run2.quests.questXpAwarded).toBe(DAILY_QUEST_XP);
    expect(
      dailyQuestsForDay(day1, run2.next).every((q) => q.completed),
    ).toBe(true);
    expect(workshopDaysCount(run2.next)).toBe(1);

    // Skip 4 days (Nov 2..5) and play again on Nov 6 -> Workshop Day increments to 2 (zero reset penalty!)
    const day6 = "2026-11-06";
    expect(workshopDaysCount(run2.next)).toBe(1);
    const runDay6 = solveWithQuests(run2.next, {
      missionId: "lab2.logic",
      tier: 1,
      attempts: 1,
      partMatch: false,
      day: day6,
    });
    expect(runDay6.quests.questXpAwarded).toBeGreaterThanOrEqual(DAILY_QUEST_XP);
    expect(workshopDaysCount(runDay6.next)).toBe(2);
    expect(runDay6.next.workshopDays).toEqual(["2026-11-01", "2026-11-06"]);
  });

  it("normalizes, union-merges, and resets quest progression cleanly", () => {
    const local = normalizeProgression({
      totalXp: 240,
      completedQuestsByDay: {
        "2026-11-01": ["fix:garden.bridge"],
        bogus: ["nope"],
      },
      workshopDays: ["2026-11-01", "bad-date"],
    });
    expect(local.completedQuestsByDay).toEqual({
      "2026-11-01": ["fix:garden.bridge"],
    });
    expect(local.workshopDays).toEqual(["2026-11-01"]);

    const remote = normalizeProgression({
      totalXp: 300,
      completedQuestsByDay: {
        "2026-11-01": ["mastery:3star-a"],
        "2026-11-03": ["tinker:lab2"],
      },
      workshopDays: ["2026-11-03"],
    });

    const merged = mergeProgression(local, remote);
    expect(merged.completedQuestsByDay?.["2026-11-01"]?.sort()).toEqual([
      "fix:garden.bridge",
      "mastery:3star-a",
    ]);
    expect(merged.workshopDays).toEqual(["2026-11-01", "2026-11-03"]);

    const withToy = grandfatherToyIds(merged, ["seed-shuttle"]).next;
    const reset = resetProgression(withToy, 1_700_000_010_000);
    expect(reset.totalXp).toBe(0);
    expect(reset.completedQuestsByDay).toBeUndefined();
    expect(reset.workshopDays).toBeUndefined();
    expect(reset.unlockedIds).toEqual(["seed-shuttle"]);
  });
});
