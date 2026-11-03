import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  allChoresWithState,
  applyDailyQuestProgress,
  CHORE_QUEST_XP,
  choresForDay,
  completeRealLifeChore,
  CONCEPT_BADGES,
  conceptBadgesFor,
  DAILY_QUEST_XP,
  dailyQuestsForDay,
  earnedConceptBadges,
  practicedSkillsSummary,
  REAL_LIFE_CHORES,
  toggleChoreEnabled,
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
import { SCAVENGER_QUESTS } from "../src/lib/scavenger";

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

describe("Real-Life Chore & Habit Quests ('Real Life Counts')", () => {
  it("keeps chores off by default, toggles in canonical order, and is em-dash-free", () => {
    const fresh = emptyProgression();
    expect(REAL_LIFE_CHORES).toHaveLength(8);
    for (const spec of REAL_LIFE_CHORES) {
      expect(spec.title).not.toContain("\u2014");
      expect(spec.goal).not.toContain("\u2014");
      expect(spec.parentHint).not.toContain("\u2014");
    }

    expect(choresForDay("2026-11-01", fresh)).toEqual([]);
    expect(allChoresWithState("2026-11-01", fresh)).toHaveLength(8);

    const step1 = toggleChoreEnabled(fresh, "read-10m");
    const step2 = toggleChoreEnabled(step1, "brush-teeth");
    expect(step2.enabledChoreIds).toEqual(["brush-teeth", "read-10m"]);
    expect(choresForDay("2026-11-01", step2).map((c) => c.id)).toEqual([
      "brush-teeth",
      "read-10m",
    ]);

    const disabledAgain = toggleChoreEnabled(
      toggleChoreEnabled(step2, "brush-teeth"),
      "read-10m",
    );
    expect(disabledAgain.enabledChoreIds).toEqual([]);
    expect(choresForDay("2026-11-01", disabledAgain)).toEqual([]);
  });

  it("shares one +25 XP/day ceiling across all real-life quests (SAM spec Q10) and stamps Workshop Days without streak loss", () => {
    let prog = toggleChoreEnabled(emptyProgression(), "brush-teeth");
    prog = toggleChoreEnabled(prog, "tidy-bench");

    // Disabled chore cannot be farmed
    const blocked = completeRealLifeChore(prog, "pack-bag", "2026-11-01");
    expect(blocked.awarded).toBe(0);
    expect(blocked.chore).toBeNull();

    // First completion awards +25 XP and stamps Workshop Day 1
    const done1 = completeRealLifeChore(prog, "brush-teeth", "2026-11-01");
    expect(done1.awarded).toBe(CHORE_QUEST_XP);
    expect(done1.next.totalXp).toBe(25);
    expect(workshopDaysCount(done1.next)).toBe(1);

    // Repeating same chore on same day pays 0 XP (anti-farming)
    const repeat = completeRealLifeChore(
      done1.next,
      "brush-teeth",
      "2026-11-01",
    );
    expect(repeat.awarded).toBe(0);
    expect(repeat.next.totalXp).toBe(25);

    // Second enabled chore on same day still ticks the board but pays 0 XP (Q10 shared ceiling)
    const done2 = completeRealLifeChore(
      repeat.next,
      "tidy-bench",
      "2026-11-01",
    );
    expect(done2.awarded).toBe(0);
    expect(done2.next.totalXp).toBe(25);
    expect(done2.next.completedChoresByDay?.["2026-11-01"]).toContain(
      "tidy-bench",
    );
    expect(workshopDaysCount(done2.next)).toBe(1);

    // Skipping days (Nov 2..4) and completing on Nov 5 pays again and increments Workshop Day to 2
    const doneNov5 = completeRealLifeChore(
      done2.next,
      "brush-teeth",
      "2026-11-05",
    );
    expect(doneNov5.awarded).toBe(CHORE_QUEST_XP);
    expect(doneNov5.next.totalXp).toBe(50);
    expect(workshopDaysCount(doneNov5.next)).toBe(2);
    expect(doneNov5.next.workshopDays).toEqual(["2026-11-01", "2026-11-05"]);
  });

  it("scavenger quests join as chores and share the same daily ceiling (S1, Q5/Q10)", () => {
    const choreIds = REAL_LIFE_CHORES.map((c) => c.id);
    for (const quest of SCAVENGER_QUESTS) {
      expect(choreIds).toContain(quest.id);
      const chore = REAL_LIFE_CHORES.find((c) => c.id === quest.id)!;
      expect(chore.title).toBe(quest.title);
    }

    let prog = toggleChoreEnabled(emptyProgression(), "brush-teeth");
    prog = toggleChoreEnabled(prog, "scavenge-wheel");
    const hunt = completeRealLifeChore(prog, "scavenge-wheel", "2026-11-02");
    expect(hunt.awarded).toBe(CHORE_QUEST_XP);
    const routine = completeRealLifeChore(
      hunt.next,
      "brush-teeth",
      "2026-11-02",
    );
    expect(routine.awarded).toBe(0); // scavenger already paid today's shared +25
    expect(routine.next.totalXp).toBe(25);
  });

  it("persists enabledChoreIds across normalize, merge (respecting local disable), and XP reset", () => {
    const remote = normalizeProgression({
      totalXp: 100,
      enabledChoreIds: ["brush-teeth", "read-10m"],
      completedChoresByDay: { "2026-11-01": ["brush-teeth"] },
    });
    // Parent locally disables all routines -> explicit [] beats remote list
    const localDisabled = normalizeProgression({
      totalXp: 100,
      enabledChoreIds: [],
      completedChoresByDay: { "2026-11-01": ["read-10m"] },
    });
    const merged = mergeProgression(localDisabled, remote);
    expect(merged.enabledChoreIds).toEqual([]);
    expect(merged.completedChoresByDay?.["2026-11-01"]?.sort()).toEqual([
      "brush-teeth",
      "read-10m",
    ]);

    // Parent routine selection survives XP reset while completedChoresByDay resets
    const reset = resetProgression(remote, 1_700_000_020_000);
    expect(reset.totalXp).toBe(0);
    expect(reset.enabledChoreIds).toEqual(["brush-teeth", "read-10m"]);
    expect(reset.completedChoresByDay).toBeUndefined();
  });
});
