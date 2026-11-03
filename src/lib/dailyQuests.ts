// Deterministic Daily Quest Board + STEM Concept Badges.
//
// Design invariants (docs/specs/toyventor-town-vision.md & play-design-spec.md):
// 1. Offline-first & zero RNG: 3 daily quests rotate deterministically from the
//    local YYYY-MM-DD date string (1 Fix-It mission, 1 Gear/Tier stretch, 1
//    3-star Clean Mastery goal).
// 2. Anti-farming: each quest ID pays its +40 XP bonus at most once per local
//    day via `ProgressionState.completedQuestsByDay`.
// 3. Zero streak-loss punishment: `workshopDays` counts total unique days on
//    which >=1 quest was completed. Skipping a day pauses the count rather than
//    resetting it to zero.
// 4. STEM Concept Badges derive purely from `progression.missionStars` across
//    all 11 shipped mission types, surfacing plain-English skills for kids and
//    parents without extra storage keys or stage HUD clutter.

import {
  familyOf,
  missionTypeOf,
  rankFor,
  RANKS,
  type MakerRank,
  type MissionType,
  type ProgressionState,
  type SolveInput,
  type StarCount,
} from "./progression";

export const DAILY_QUEST_XP = 40;
export const CHORE_QUEST_XP = 25;

export type ConceptTierLabel = "Locked" | "Sprout" | "Tinker" | "Master";

export interface ConceptBadgeSpec {
  id: MissionType;
  /** Kid-facing badge title. */
  title: string;
  /** Short 1-word or 2-word tag for compact pills. */
  shortLabel: string;
  /** Plain-English skill name shown in Grown-Ups read-only summary. */
  parentSkill: string;
  /** Primary world/lab to jump to when practicing this concept. */
  worldId: string;
  /** Shipped mission IDs (`world.type`) that award stars toward this badge. */
  missionIds: readonly string[];
}

export interface EarnedConceptBadge extends ConceptBadgeSpec {
  bestStars: StarCount;
  tierLabel: ConceptTierLabel;
  earned: boolean;
}

export const CONCEPT_BADGES: readonly ConceptBadgeSpec[] = [
  {
    id: "bridge",
    title: "Triangles & Stiffness",
    shortLabel: "Triangles",
    parentSkill: "Structural triangles",
    worldId: "lab1",
    missionIds: ["garden.bridge", "lab1.bridge"],
  },
  {
    id: "measure",
    title: "True Measure",
    shortLabel: "Measure",
    parentSkill: "Length measurement",
    worldId: "lab1",
    missionIds: ["lab1.measure"],
  },
  {
    id: "balance",
    title: "Balance & Moments",
    shortLabel: "Balance",
    parentSkill: "Moments & balance",
    worldId: "lab1",
    missionIds: ["lab1.balance"],
  },
  {
    id: "logic",
    title: "Boolean Logic",
    shortLabel: "Logic",
    parentSkill: "Boolean logic gates",
    worldId: "lab2",
    missionIds: ["lab2.logic"],
  },
  {
    id: "lift",
    title: "Gear Ratios",
    shortLabel: "Gears",
    parentSkill: "Gear ratio & torque",
    worldId: "lab2",
    missionIds: ["junk.lift", "lab2.lift"],
  },
  {
    id: "raft",
    title: "Buoyancy",
    shortLabel: "Buoyancy",
    parentSkill: "Buoyancy & displacement",
    worldId: "lab3",
    missionIds: ["lab3.raft"],
  },
  {
    id: "lever",
    title: "Levers & Fulcrums",
    shortLabel: "Levers",
    parentSkill: "Lever arms & fulcrums",
    worldId: "lab4",
    missionIds: ["lab4.lever"],
  },
  {
    id: "circuit",
    title: "Bright Circuits",
    shortLabel: "Circuits",
    parentSkill: "Series circuits",
    worldId: "lab4",
    missionIds: ["lab4.circuit"],
  },
  {
    id: "code",
    title: "Step Sequencing",
    shortLabel: "Coding",
    parentSkill: "Step sequencing",
    worldId: "lab5",
    missionIds: ["lab5.code"],
  },
  {
    id: "pattern",
    title: "Pattern Finder",
    shortLabel: "Patterns",
    parentSkill: "Repeating patterns",
    worldId: "lab5",
    missionIds: ["lab5.pattern"],
  },
  {
    id: "clean",
    title: "Tidy Bench & Fair Share",
    shortLabel: "Tidy Bench",
    parentSkill: "Cleanup & fair sharing",
    worldId: "lab6",
    missionIds: ["lab6.clean"],
  },
];

export function tierLabelForStars(stars: StarCount): ConceptTierLabel {
  if (stars >= 3) return "Master";
  if (stars === 2) return "Tinker";
  if (stars === 1) return "Sprout";
  return "Locked";
}

/** Best star count achieved across any tier (:t1..:t3) for a given mission type. */
export function bestStarsForConcept(
  prog: ProgressionState,
  conceptType: MissionType,
): StarCount {
  let best = 0;
  for (const [key, stars] of Object.entries(prog.missionStars)) {
    const missionId = key.split(":t")[0] ?? key;
    if (missionTypeOf(missionId) === conceptType && stars > best) {
      best = stars;
    }
  }
  return Math.min(3, Math.max(0, Math.floor(best))) as StarCount;
}

/** Return all 11 STEM concept badges with current mastery state. */
export function conceptBadgesFor(prog: ProgressionState): EarnedConceptBadge[] {
  return CONCEPT_BADGES.map((spec) => {
    const bestStars = bestStarsForConcept(prog, spec.id);
    return {
      ...spec,
      bestStars,
      tierLabel: tierLabelForStars(bestStars),
      earned: bestStars >= 1,
    };
  });
}

/** Return only earned (>= 1 star) STEM concept badges. */
export function earnedConceptBadges(
  prog: ProgressionState,
): EarnedConceptBadge[] {
  return conceptBadgesFor(prog).filter((b) => b.earned);
}

/** Plain-English parent summary of practiced STEM skills (em-dash-free). */
export function practicedSkillsSummary(prog: ProgressionState): string {
  const earned = earnedConceptBadges(prog);
  if (earned.length === 0) {
    return "None yet (solve any world bridge, crane, or STEM Lab)";
  }
  return earned
    .map((b) => `${b.parentSkill} (${"★".repeat(b.bestStars)})`)
    .join(", ");
}

export type DailyQuestSlot = "fix" | "tinker" | "mastery";

export interface DailyQuest {
  id: string;
  slot: DailyQuestSlot;
  title: string;
  goal: string;
  /** World or STEM Lab ID for the one-tap "Go" button. */
  worldId: string;
  worldLabel: string;
  xpBonus: number;
  completed: boolean;
}

interface FixQuestTemplate {
  id: string;
  missionId: string;
  worldId: string;
  worldLabel: string;
  title: string;
  goal: string;
}

interface TinkerQuestTemplate {
  id: string;
  family: string;
  worldId: string;
  worldLabel: string;
  title: string;
  goal: string;
}

interface MasteryQuestTemplate {
  id: string;
  worldId: string;
  worldLabel: string;
  title: string;
  goal: string;
}

const FIX_TEMPLATES: readonly FixQuestTemplate[] = [
  {
    id: "fix:garden.bridge",
    missionId: "garden.bridge",
    worldId: "garden",
    worldLabel: "Garden",
    title: "Fix the Garden Bridge",
    goal: "Brace the river crossing in Garden.",
  },
  {
    id: "fix:junk.lift",
    missionId: "junk.lift",
    worldId: "junk",
    worldLabel: "Junkyard",
    title: "Run the Junkyard Crane",
    goal: "Pick the right gear train to hoist the load.",
  },
  {
    id: "fix:lab1.measure",
    missionId: "lab1.measure",
    worldId: "lab1",
    worldLabel: "Lab 1",
    title: "Measure the Span",
    goal: "Cut the exact beam length in Lab 1.",
  },
  {
    id: "fix:lab3.raft",
    missionId: "lab3.raft",
    worldId: "lab3",
    worldLabel: "Lab 3",
    title: "Float the Cargo Raft",
    goal: "Balance buoyancy in Lab 3 without sinking.",
  },
  {
    id: "fix:lab4.circuit",
    missionId: "lab4.circuit",
    worldId: "lab4",
    worldLabel: "Lab 4",
    title: "Light the Lab Circuit",
    goal: "Wire a working series circuit in Lab 4.",
  },
  {
    id: "fix:lab6.clean",
    missionId: "lab6.clean",
    worldId: "lab6",
    worldLabel: "Lab 6",
    title: "Tidy Bench & Fair Share",
    goal: "Sort and share workshop parts in Lab 6.",
  },
];

const TINKER_TEMPLATES: readonly TinkerQuestTemplate[] = [
  {
    id: "tinker:lab1",
    family: "lab1",
    worldId: "lab1",
    worldLabel: "Lab 1",
    title: "Torque Gear Check",
    goal: "Solve a Lab 1 or Garden job with a Torque part or on Tier 2+.",
  },
  {
    id: "tinker:lab2",
    family: "lab2",
    worldId: "lab2",
    worldLabel: "Lab 2",
    title: "Machine Shop Stretch",
    goal: "Solve a Lab 2 or Junkyard job with a matching part or on Tier 2+.",
  },
  {
    id: "tinker:lab3",
    family: "lab3",
    worldId: "lab3",
    worldLabel: "Lab 3",
    title: "Harbour Speed Check",
    goal: "Solve Lab 3 Raft with a Speed part or on Tier 2+.",
  },
  {
    id: "tinker:lab4",
    family: "lab4",
    worldId: "lab4",
    worldLabel: "Lab 4",
    title: "Levers & Lights Check",
    goal: "Solve a Lab 4 job with a matching part or on Tier 2+.",
  },
  {
    id: "tinker:lab5",
    family: "lab5",
    worldId: "lab5",
    worldLabel: "Lab 5",
    title: "Code & Spin Check",
    goal: "Solve a Lab 5 job with a Spin part or on Tier 2+.",
  },
];

const MASTERY_TEMPLATES: readonly MasteryQuestTemplate[] = [
  {
    id: "mastery:3star-a",
    worldId: "lab1",
    worldLabel: "Lab 1",
    title: "Measure Twice, Cut Once",
    goal: "Earn a clean 3-star first-try solve on any mission today.",
  },
  {
    id: "mastery:3star-b",
    worldId: "lab2",
    worldLabel: "Lab 2",
    title: "First-Try Tinkerer",
    goal: "Earn a clean 3-star first-try solve on any mission today.",
  },
  {
    id: "mastery:3star-c",
    worldId: "lab4",
    worldLabel: "Lab 4",
    title: "Steady Hands 3-Star",
    goal: "Earn a clean 3-star first-try solve on any mission today.",
  },
  {
    id: "mastery:3star-d",
    worldId: "lab5",
    worldLabel: "Lab 5",
    title: "Master Planner 3-Star",
    goal: "Earn a clean 3-star first-try solve on any mission today.",
  },
];

function dayIndex(day: string, salt: number, mod: number): number {
  let h = (2166136261 ^ salt) >>> 0;
  for (let i = 0; i < day.length; i++) {
    h ^= day.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return mod > 0 ? h % mod : 0;
}

function activeTemplatesForDay(day: string): {
  fix: FixQuestTemplate;
  tinker: TinkerQuestTemplate;
  mastery: MasteryQuestTemplate;
} {
  const safeDay = day || "1970-01-01";
  const fix =
    FIX_TEMPLATES[dayIndex(safeDay, 11, FIX_TEMPLATES.length)] ??
    FIX_TEMPLATES[0]!;
  // Offset tinker if its worldId collides with fix so the 3 cards point across town.
  let tinkerIdx = dayIndex(safeDay, 37, TINKER_TEMPLATES.length);
  if (
    TINKER_TEMPLATES.length > 1 &&
    TINKER_TEMPLATES[tinkerIdx]?.worldId === fix.worldId
  ) {
    tinkerIdx = (tinkerIdx + 1) % TINKER_TEMPLATES.length;
  }
  const tinker = TINKER_TEMPLATES[tinkerIdx] ?? TINKER_TEMPLATES[0]!;
  let masteryIdx = dayIndex(safeDay, 73, MASTERY_TEMPLATES.length);
  if (
    MASTERY_TEMPLATES.length > 1 &&
    (MASTERY_TEMPLATES[masteryIdx]?.worldId === fix.worldId ||
      MASTERY_TEMPLATES[masteryIdx]?.worldId === tinker.worldId)
  ) {
    masteryIdx = (masteryIdx + 1) % MASTERY_TEMPLATES.length;
  }
  const mastery = MASTERY_TEMPLATES[masteryIdx] ?? MASTERY_TEMPLATES[0]!;
  return { fix, tinker, mastery };
}

/** Deterministic 3-card Daily Quest Board for a local YYYY-MM-DD day. */
export function dailyQuestsForDay(
  day: string,
  prog: ProgressionState,
): DailyQuest[] {
  const { fix, tinker, mastery } = activeTemplatesForDay(day);
  const doneSet = new Set(prog.completedQuestsByDay?.[day] ?? []);
  return [
    {
      id: fix.id,
      slot: "fix",
      title: fix.title,
      goal: fix.goal,
      worldId: fix.worldId,
      worldLabel: fix.worldLabel,
      xpBonus: DAILY_QUEST_XP,
      completed: doneSet.has(fix.id),
    },
    {
      id: tinker.id,
      slot: "tinker",
      title: tinker.title,
      goal: tinker.goal,
      worldId: tinker.worldId,
      worldLabel: tinker.worldLabel,
      xpBonus: DAILY_QUEST_XP,
      completed: doneSet.has(tinker.id),
    },
    {
      id: mastery.id,
      slot: "mastery",
      title: mastery.title,
      goal: mastery.goal,
      worldId: mastery.worldId,
      worldLabel: mastery.worldLabel,
      xpBonus: DAILY_QUEST_XP,
      completed: doneSet.has(mastery.id),
    },
  ];
}

/** Non-resetting Workshop Day stamp count (pauses on missed days, never resets to 0). */
export function workshopDaysCount(prog: ProgressionState): number {
  return prog.workshopDays?.length ?? 0;
}

export interface DailyQuestEvalResult {
  next: ProgressionState;
  questXpAwarded: number;
  completedQuests: DailyQuest[];
  upgradedBadges: EarnedConceptBadge[];
  rankAfter: MakerRank;
  newVehiclesFromQuests: string[];
}

/**
 * Evaluate today's 3 daily quests + STEM concept badge upgrades after a mission
 * solve (`solvedProg` is the output of `applySolve(prevProg, input)`).
 */
export function applyDailyQuestProgress(
  prevProg: ProgressionState,
  solvedProg: ProgressionState,
  input: SolveInput,
  stars: StarCount,
): DailyQuestEvalResult {
  const { fix, tinker, mastery } = activeTemplatesForDay(input.day);
  const existingDone = new Set(
    solvedProg.completedQuestsByDay?.[input.day] ?? [],
  );
  const newlyCompletedIds: string[] = [];

  if (!existingDone.has(fix.id) && input.missionId === fix.missionId) {
    newlyCompletedIds.push(fix.id);
  }
  if (
    !existingDone.has(tinker.id) &&
    familyOf(input.missionId) === tinker.family &&
    (input.partMatch || input.tier >= 2)
  ) {
    newlyCompletedIds.push(tinker.id);
  }
  if (!existingDone.has(mastery.id) && stars >= 3) {
    newlyCompletedIds.push(mastery.id);
  }

  // Detect any STEM Concept Badge unlocked or upgraded on this solve.
  const solvedConcept = missionTypeOf(input.missionId) as MissionType;
  const beforeConceptStars = bestStarsForConcept(prevProg, solvedConcept);
  const afterConceptStars = bestStarsForConcept(solvedProg, solvedConcept);
  const upgradedBadges =
    afterConceptStars > beforeConceptStars
      ? conceptBadgesFor(solvedProg).filter((b) => b.id === solvedConcept)
      : [];

  if (newlyCompletedIds.length === 0) {
    return {
      next: solvedProg,
      questXpAwarded: 0,
      completedQuests: [],
      upgradedBadges,
      rankAfter: rankFor(solvedProg.totalXp),
      newVehiclesFromQuests: [],
    };
  }

  const questXpAwarded = newlyCompletedIds.length * DAILY_QUEST_XP;
  const rankBeforeQuests = rankFor(solvedProg.totalXp);
  const updatedForDay = [...existingDone, ...newlyCompletedIds];
  const completedQuestsByDay: Record<string, string[]> = {
    ...(solvedProg.completedQuestsByDay ?? {}),
    [input.day]: updatedForDay,
  };
  const workshopDays = [
    ...new Set([...(solvedProg.workshopDays ?? []), input.day]),
  ].sort();

  const next: ProgressionState = {
    ...solvedProg,
    totalXp: solvedProg.totalXp + questXpAwarded,
    completedQuestsByDay,
    workshopDays,
  };
  const rankAfter = rankFor(next.totalXp);
  const newVehiclesFromQuests = RANKS.filter(
    (r) => r.rank > rankBeforeQuests.rank && r.rank <= rankAfter.rank,
  ).flatMap((r) => r.vehicles);

  const allToday = dailyQuestsForDay(input.day, next);
  const completedQuests = allToday.filter((q) =>
    newlyCompletedIds.includes(q.id),
  );

  return {
    next,
    questXpAwarded,
    completedQuests,
    upgradedBadges,
    rankAfter,
    newVehiclesFromQuests,
  };
}

export interface RealLifeChoreSpec {
  id: string;
  title: string;
  goal: string;
  parentHint: string;
}

export interface RealLifeChoreStatus extends RealLifeChoreSpec {
  enabled: boolean;
  completed: boolean;
  xpBonus: number;
}

export const REAL_LIFE_CHORES: readonly RealLifeChoreSpec[] = [
  {
    id: "brush-teeth",
    title: "Brush Teeth",
    goal: "Brush top, bottom, and back molars for 2 full minutes.",
    parentHint: "Morning or bedtime tooth-brushing",
  },
  {
    id: "tidy-bench",
    title: "Tidy Room & Toys",
    goal: "Put blocks, clothes, and workshop parts back in their bins.",
    parentHint: "Quick tidy-up of bedroom or play table",
  },
  {
    id: "read-10m",
    title: "Read for 10 Minutes",
    goal: "Read a book, comic, or picture story aloud or quietly.",
    parentHint: "10 minutes of calm offline reading",
  },
  {
    id: "pack-bag",
    title: "Pack Tomorrow's Bag",
    goal: "Check water bottle, folder, and shoes by the door.",
    parentHint: "School or outing bag prep",
  },
  {
    id: "help-table",
    title: "Help at the Table",
    goal: "Set napkins and spoons or clear your plate after a meal.",
    parentHint: "Helping with family meal setup or cleanup",
  },
  // Scavenger quests (SAM spec S1, Q5): ids and titles match src/lib/scavenger.ts quests.
  {
    id: "scavenge-lever",
    title: "Find a Lever",
    goal: "Find a real lever at home, like a door handle or a tap.",
    parentHint: "Scavenger hunt: spot a lever indoors",
  },
  {
    id: "scavenge-gear",
    title: "Find a Gear",
    goal: "Find a real gear or cog, like on a bike or a clock.",
    parentHint: "Scavenger hunt: spot a gear indoors",
  },
  {
    id: "scavenge-wheel",
    title: "Find a Wheel",
    goal: "Find a real wheel, like on a toy car, bike, or chair.",
    parentHint: "Scavenger hunt: spot a wheel indoors",
  },
];

const CHORE_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Return all parent-configurable routines with enabled + today's completion state. */
export function allChoresWithState(
  day: string,
  prog: ProgressionState,
): RealLifeChoreStatus[] {
  const enabledSet = new Set(prog.enabledChoreIds ?? []);
  const doneSet = new Set(prog.completedChoresByDay?.[day] ?? []);
  return REAL_LIFE_CHORES.map((spec) => ({
    ...spec,
    enabled: enabledSet.has(spec.id),
    completed: doneSet.has(spec.id),
    xpBonus: CHORE_QUEST_XP,
  }));
}

/** Return only parent-enabled routines for the kid-facing Toy Box board. */
export function choresForDay(
  day: string,
  prog: ProgressionState,
): RealLifeChoreStatus[] {
  return allChoresWithState(day, prog).filter((c) => c.enabled);
}

/** Toggle a routine in `ProgressionState.enabledChoreIds` in canonical order. */
export function toggleChoreEnabled(
  prog: ProgressionState,
  choreId: string,
): ProgressionState {
  if (!REAL_LIFE_CHORES.some((c) => c.id === choreId)) return prog;
  const enabledSet = new Set(prog.enabledChoreIds ?? []);
  if (enabledSet.has(choreId)) {
    enabledSet.delete(choreId);
  } else {
    enabledSet.add(choreId);
  }
  const enabledChoreIds = REAL_LIFE_CHORES.map((c) => c.id).filter((id) =>
    enabledSet.has(id),
  );
  return { ...prog, enabledChoreIds };
}

export interface ChoreCompleteResult {
  next: ProgressionState;
  awarded: number;
  chore: RealLifeChoreStatus | null;
  rankBefore: MakerRank;
  rankAfter: MakerRank;
  newVehicles: string[];
}

/**
 * Mark an enabled real-life routine done for `day` (`YYYY-MM-DD`).
 * One shared `+25 XP`/day ceiling across ALL real-life quests (SAM spec Q10): the first
 * completion of the day pays; later ones still tick the board and stamp `workshopDays`.
 */
export function completeRealLifeChore(
  prog: ProgressionState,
  choreId: string,
  day: string,
): ChoreCompleteResult {
  const rankBefore = rankFor(prog.totalXp);
  const spec = REAL_LIFE_CHORES.find((c) => c.id === choreId);
  if (
    !spec ||
    !CHORE_DAY_PATTERN.test(day) ||
    !(prog.enabledChoreIds ?? []).includes(choreId)
  ) {
    return {
      next: prog,
      awarded: 0,
      chore: null,
      rankBefore,
      rankAfter: rankBefore,
      newVehicles: [],
    };
  }

  const existingDone = new Set(prog.completedChoresByDay?.[day] ?? []);
  if (existingDone.has(choreId)) {
    return {
      next: prog,
      awarded: 0,
      chore: {
        ...spec,
        enabled: true,
        completed: true,
        xpBonus: CHORE_QUEST_XP,
      },
      rankBefore,
      rankAfter: rankBefore,
      newVehicles: [],
    };
  }

  const updatedForDay = [...existingDone, choreId];
  const completedChoresByDay: Record<string, string[]> = {
    ...(prog.completedChoresByDay ?? {}),
    [day]: updatedForDay,
  };
  const workshopDays = [
    ...new Set([...(prog.workshopDays ?? []), day]),
  ].sort();

  // Q10 shared ceiling, enforced here (the one place chore XP is awarded).
  const awardedXp = existingDone.size > 0 ? 0 : CHORE_QUEST_XP;
  const next: ProgressionState = {
    ...prog,
    totalXp: prog.totalXp + awardedXp,
    completedChoresByDay,
    workshopDays,
  };
  const rankAfter = rankFor(next.totalXp);
  const newVehicles = RANKS.filter(
    (r) => r.rank > rankBefore.rank && r.rank <= rankAfter.rank,
  ).flatMap((r) => r.vehicles);

  return {
    next,
    awarded: awardedXp,
    chore: {
      ...spec,
      enabled: true,
      completed: true,
      xpBonus: CHORE_QUEST_XP,
    },
    rankBefore,
    rankAfter,
    newVehicles,
  };
}
