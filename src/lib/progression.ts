// STEM XP progression (Phase 3). Pure award/rank/gate math plus local-first
// persistence in localStorage, synced in the ownership `character` lane as
// id "progression:v1" (see docs/specs/xp-system-spec.md). One shared pool
// per device; no per-kid or per-toy XP.
import type { StatName } from "../../shared/part";
import { LADDERS, rungKey } from "./ladders";
import { pullOwnership, pushOwnership } from "./sync";

export const PROGRESSION_STORAGE_KEY = "toyforge:progression:v1";
export const PROGRESSION_OWNERSHIP_ID = "progression:v1";
export const MAX_PRACTICE_PER_DAY = 2;

export type Tier = 1 | 2 | 3;
export type StarCount = 0 | 1 | 2 | 3;

export const MISSION_TYPES = [
  "bridge",
  "measure",
  "balance",
  "logic",
  "lift",
  "lever",
  "circuit",
  "code",
  "pattern",
  "clean",
  "raft",
] as const;
export type MissionType = (typeof MISSION_TYPES)[number];

export const MEASURE_FAMILY: ReadonlySet<string> = new Set([
  "measure",
  "balance",
  "lever",
]);

/** Mission stat worn by the active toy for the +10% part-match bonus. */
export const MISSION_STAT: Record<MissionType, StatName> = {
  bridge: "torque",
  lift: "torque",
  lever: "torque",
  raft: "speed",
  circuit: "glow",
  code: "spin",
  pattern: "spin",
  logic: "spin",
  measure: "glow",
  balance: "torque",
  clean: "glow",
};

export const BASE_XP_BY_TIER: Record<Tier, number> = {
  1: 100,
  2: 150,
  3: 220,
};

export const ACCURACY_BONUS: Record<number, number> = {
  3: 0.5,
  2: 0.25,
  1: 0,
  0: 0,
};

export const PART_MATCH_BONUS = 0.1;
export const PRACTICE_FACTOR = 0.25;

export interface MakerRank {
  rank: number;
  title: string;
  xp: number;
  vehicles: string[];
}

export const RANKS: MakerRank[] = [
  { rank: 1, title: "Snap Sprout", xp: 0, vehicles: [] },
  {
    rank: 2,
    title: "Workshop Builder",
    xp: 250,
    vehicles: ["Hauler Truck", "Motor Scooter"],
  },
  {
    rank: 3,
    title: "Gearhead",
    xp: 600,
    vehicles: ["Sport Motorbike", "Loader Tractor & Trailer"],
  },
  {
    rank: 4,
    title: "Sky & Sea Pilot",
    xp: 1100,
    vehicles: ["Prop Aeroplane", "Catamaran Boat"],
  },
  {
    rank: 5,
    title: "Aero Captain",
    xp: 1800,
    vehicles: ["Rescue Helicopter", "Space Shuttle"],
  },
  { rank: 6, title: "Power Pro Inventor", xp: 2700, vehicles: ["Bolt Power Pro"] },
];

export interface DailyKeyState {
  /** Best award multiplier M achieved for the key that day. */
  best: number;
  /** Paid practice replays for the key that day (max 2). */
  practice: number;
}

export interface ProgressionState {
  version: 1;
  totalXp: number;
  /** Best stars per `${missionId}:t${tier}`, e.g. "lab1.measure:t1". */
  missionStars: Record<string, number>;
  /** Per local day (YYYY-MM-DD), per-key daily award state. */
  daily: Record<string, Record<string, DailyKeyState>>;
  /** Grandfathered toy ids; never wiped by XP reset. */
  unlockedIds: string[];
  /** Grown-up demo override: gates open without changing earned XP. */
  sandboxUnlockAll: boolean;
  /** Epoch ms of most recent parent XP reset, so offline resets beat stale remote totals. */
  resetAt?: number;
  /** Per local day (YYYY-MM-DD), daily quest IDs already completed and paid out. */
  completedQuestsByDay?: Record<string, string[]>;
  /** Non-resetting YYYY-MM-DD stamps for days with >=1 completed daily quest or routine. */
  workshopDays?: string[];
  /** Parent-configured real-life daily routine IDs enabled for the Toy Box board. */
  enabledChoreIds?: string[];
  /** Per local day (YYYY-MM-DD), real-life routine IDs already completed and paid out. */
  completedChoresByDay?: Record<string, string[]>;
  /** Grown-up-set age band index 0-5 for the Map carousel; absent = unset. */
  ageBand?: number;
  /** Explorer-map node ids the child has walked to (gentle-fog reveal set). */
  explorerVisited?: string[];
  /** What the child has already seen on the trail map (explorerMap
   *  seenEntries), so only what is new animates on the next open. */
  explorerSeen?: string[];
  /** Weekends (the Friday's "YYYY-MM-DD") whose Garage drop was finished. */
  garageDone?: string[];
}

export function emptyProgression(): ProgressionState {
  return {
    version: 1,
    totalXp: 0,
    missionStars: {},
    daily: {},
    unlockedIds: [],
    sandboxUnlockAll: false,
  };
}

export function progressionKey(missionId: string, tier: Tier): string {
  return `${missionId}:t${tier}`;
}

export function missionTypeOf(missionId: string): string {
  return missionId.split(".").pop() ?? missionId;
}

/** Lab family of a mission id: "lab1.measure" -> "lab1" (world torque missions map to Lab 1/2). */
export function familyOf(missionId: string): string {
  if (missionId === "garden.bridge") return "lab1";
  if (missionId === "junk.lift") return "lab2";
  const dot = missionId.indexOf(".");
  return dot > 0 ? missionId.slice(0, dot) : missionId;
}

export function starsFor(
  attempts: number,
  opts: { clean?: boolean; measureFamily?: boolean } = {},
): StarCount {
  const tries = Math.max(1, Math.floor(attempts) || 1);
  if (tries === 1) {
    if (opts.measureFamily && !opts.clean) return 2;
    return 3;
  }
  if (tries === 2) return 2;
  return 1;
}

export function computeAward(opts: {
  tier: Tier;
  stars: number;
  partMatch: boolean;
  replayFactor?: number;
}): number {
  const base = BASE_XP_BY_TIER[opts.tier] ?? BASE_XP_BY_TIER[1];
  const accuracy = ACCURACY_BONUS[opts.stars] ?? 0;
  const part = opts.partMatch ? PART_MATCH_BONUS : 0;
  const factor = opts.replayFactor ?? 1;
  return Math.round(base * (1 + accuracy + part) * factor);
}

export function rankFor(totalXp: number): MakerRank {
  let current = RANKS[0]!;
  for (const rank of RANKS) {
    if (totalXp >= rank.xp) current = rank;
  }
  return current;
}

export function unlockedVehiclesFor(totalXp: number): string[] {
  const current = rankFor(totalXp);
  return RANKS.filter((r) => r.rank <= current.rank).flatMap((r) => r.vehicles);
}

export function nextRankProgress(totalXp: number): {
  rank: MakerRank;
  next: MakerRank | null;
  into: number;
  span: number;
  pct: number;
} {
  const rank = rankFor(totalXp);
  const next = RANKS.find((r) => r.rank === rank.rank + 1) ?? null;
  if (!next) return { rank, next: null, into: 0, span: 1, pct: 100 };
  const span = next.xp - rank.xp;
  const into = Math.min(span, Math.max(0, totalXp - rank.xp));
  return { rank, next, into, span, pct: Math.round((into / span) * 100) };
}

export function familyStars(
  prog: ProgressionState,
  family: string,
): number {
  let total = 0;
  for (const [key, stars] of Object.entries(prog.missionStars)) {
    const missionId = key.split(":t")[0] ?? key;
    if (familyOf(missionId) === family) total += stars;
  }
  return total;
}

export function multiplierFor(stars: number, partMatch: boolean): number {
  return 1 + (ACCURACY_BONUS[stars] ?? 0) + (partMatch ? PART_MATCH_BONUS : 0);
}

export function canAccessTier(
  prog: ProgressionState,
  missionId: string,
  tier: Tier,
): boolean {
  if (prog.sandboxUnlockAll) return true;
  if (tier === 1) return true;
  if (tier === 2) {
    return (prog.missionStars[progressionKey(missionId, 1)] ?? 0) >= 2;
  }
  return (prog.missionStars[progressionKey(missionId, 2)] ?? 0) >= 2;
}

/** Pro-part labs per stat (continuation §4.4): 3★ in a matching lab unlocks. */
export const PRO_STAT_LABS: Record<StatName, string[]> = {
  torque: ["lab1", "lab2"],
  speed: ["lab3", "lab4"],
  glow: ["lab2", "lab4"],
  spin: ["lab5", "lab6"],
};

export function hasProStatUnlock(
  prog: ProgressionState,
  stat: StatName,
): boolean {
  if (prog.sandboxUnlockAll) return true;
  const labs = PRO_STAT_LABS[stat];
  for (const [key, stars] of Object.entries(prog.missionStars)) {
    if (stars < 3) continue;
    if (labs.includes(familyOf(key.split(":t")[0] ?? key))) return true;
  }
  return false;
}

export function canAccessVehicle(
  prog: ProgressionState,
  vehicle: string,
  toyId?: string,
): boolean {
  if (prog.sandboxUnlockAll) return true;
  if (toyId && prog.unlockedIds.includes(toyId)) return true;
  if (prog.unlockedIds.includes(vehicle)) return true;
  const current = rankFor(prog.totalXp);
  const gatedInAnyRank = RANKS.some((r) => r.vehicles.includes(vehicle));
  if (!gatedInAnyRank) return true;
  return RANKS.some(
    (r) => r.rank <= current.rank && r.vehicles.includes(vehicle),
  );
}

export type AwardKind = "full" | "delta" | "practice" | "none";

export interface SolveInput {
  missionId: string;
  tier: Tier;
  attempts: number;
  clean?: boolean;
  partMatch: boolean;
  /** Local day, YYYY-MM-DD (parent-time localDay with settings timezone). */
  day: string;
}

export interface SolveResult {
  next: ProgressionState;
  awarded: number;
  stars: StarCount;
  kind: AwardKind;
  rankBefore: MakerRank;
  rankAfter: MakerRank;
  newVehicles: string[];
}

export function applySolve(
  prog: ProgressionState,
  input: SolveInput,
): SolveResult {
  const type = missionTypeOf(input.missionId);
  const stars = starsFor(input.attempts, {
    clean: input.clean,
    measureFamily: MEASURE_FAMILY.has(type),
  });
  const key = progressionKey(input.missionId, input.tier);
  const rankBefore = rankFor(prog.totalXp);
  const oldBest = prog.missionStars[key] ?? 0;
  const newBest = Math.max(oldBest, stars);
  const base = BASE_XP_BY_TIER[input.tier] ?? BASE_XP_BY_TIER[1];
  const multiplier = multiplierFor(stars, input.partMatch);
  const today: Record<string, DailyKeyState> = {
    ...(prog.daily[input.day] ?? {}),
  };
  const entry = today[key];

  let awarded = 0;
  let kind: AwardKind = "none";
  if (!entry) {
    awarded = Math.round(base * multiplier);
    kind = "full";
    today[key] = { best: multiplier, practice: 0 };
  } else if (multiplier > entry.best) {
    awarded = Math.round(base * multiplier) - Math.round(base * entry.best);
    kind = "delta";
    today[key] = { best: multiplier, practice: entry.practice };
  } else if (entry.practice < MAX_PRACTICE_PER_DAY) {
    awarded = Math.round(base * multiplier * PRACTICE_FACTOR);
    kind = awarded > 0 ? "practice" : "none";
    today[key] = { best: entry.best, practice: entry.practice + 1 };
  }

  const next: ProgressionState = {
    ...prog,
    totalXp: prog.totalXp + awarded,
    missionStars: { ...prog.missionStars, [key]: newBest },
    daily: { ...prog.daily, [input.day]: today },
  };
  const rankAfter = rankFor(next.totalXp);
  const beforeVehicles = new Set(rankBefore.vehicles);
  // Vehicles from every rank at or below the new rank count as unlocked.
  const unlockedNow = RANKS.filter((r) => r.rank <= rankAfter.rank).flatMap(
    (r) => r.vehicles,
  );
  const newVehicles = unlockedNow.filter((v) => {
    const neededRank = RANKS.find((r) => r.vehicles.includes(v));
    return neededRank !== undefined && neededRank.rank > rankBefore.rank;
  });
  void beforeVehicles;
  return { next, awarded, stars, kind, rankBefore, rankAfter, newVehicles };
}

/** Explorer node ids: authored ("garden") or frontier ("frontier:lab3:1"). */
export const EXPLORER_NODE_PATTERN = /^[A-Za-z0-9_-]+(?::[A-Za-z0-9_-]+)*$/;

export function cleanExplorerVisited(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(
      raw.filter(
        (id): id is string =>
          typeof id === "string" &&
          id.length <= 64 &&
          EXPLORER_NODE_PATTERN.test(id),
      ),
    ),
  ];
}

const GARAGE_WEEKEND_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const GARAGE_DONE_MAX = 200;

/** The finished-weekend list: real-looking dates only, no repeats, oldest first, bounded. */
export function cleanGarageDone(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(
      raw.filter(
        (d): d is string => typeof d === "string" && GARAGE_WEEKEND_PATTERN.test(d),
      ),
    ),
  ]
    .sort()
    .slice(-GARAGE_DONE_MAX);
}

/** `garden` = seen as a silhouette, `garden#` = seen in full colour. */
export const EXPLORER_SEEN_PATTERN = /^[A-Za-z0-9_-]+(?::[A-Za-z0-9_-]+)*#?$/;
/** Room for every place on a fully grown map (about 200) twice over. */
const EXPLORER_SEEN_MAX = 800;

export function cleanExplorerSeen(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(
      raw.filter(
        (id): id is string =>
          typeof id === "string" &&
          id.length <= 66 &&
          EXPLORER_SEEN_PATTERN.test(id),
      ),
    ),
  ].slice(0, EXPLORER_SEEN_MAX);
}

/** Record what the trail map showed. Only adds; nothing is ever un-seen. */
export function markExplorerSeen(
  prog: ProgressionState,
  entries: readonly string[],
): { next: ProgressionState; changed: boolean } {
  const existing = prog.explorerSeen ?? [];
  const have = new Set(existing);
  const added = cleanExplorerSeen(entries).filter((e) => !have.has(e));
  if (added.length === 0) return { next: prog, changed: false };
  return {
    next: {
      ...prog,
      explorerSeen: cleanExplorerSeen([...existing, ...added]),
    },
    changed: true,
  };
}

/** Record an explorer-map visit. Invalid or repeat ids change nothing. */
export function markExplorerVisited(
  prog: ProgressionState,
  nodeId: string,
): { next: ProgressionState; changed: boolean } {
  if (nodeId.length > 64 || !EXPLORER_NODE_PATTERN.test(nodeId)) {
    return { next: prog, changed: false };
  }
  const existing = prog.explorerVisited ?? [];
  if (existing.includes(nodeId)) return { next: prog, changed: false };
  return {
    next: { ...prog, explorerVisited: [...existing, nodeId] },
    changed: true,
  };
}

const KEY_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+:t[123]$/;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeProgression(raw: unknown): ProgressionState {
  const base = emptyProgression();
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return base;
  }
  const v = raw as Record<string, unknown>;
  const missionStars: Record<string, number> = {};
  if (
    typeof v.missionStars === "object" &&
    v.missionStars !== null &&
    !Array.isArray(v.missionStars)
  ) {
    for (const [key, stars] of Object.entries(
      v.missionStars as Record<string, unknown>,
    )) {
      if (!KEY_PATTERN.test(key)) continue;
      if (typeof stars !== "number" || !Number.isFinite(stars)) continue;
      missionStars[key] = Math.min(3, Math.max(0, Math.floor(stars)));
    }
  }
  const daily: ProgressionState["daily"] = {};
  if (
    typeof v.daily === "object" &&
    v.daily !== null &&
    !Array.isArray(v.daily)
  ) {
    for (const [day, perKey] of Object.entries(
      v.daily as Record<string, unknown>,
    )) {
      if (typeof perKey !== "object" || perKey === null || Array.isArray(perKey)) {
        continue;
      }
      const cleaned: Record<string, DailyKeyState> = {};
      for (const [key, entry] of Object.entries(
        perKey as Record<string, unknown>,
      )) {
        if (!KEY_PATTERN.test(key)) continue;
        if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
          continue;
        }
        const e = entry as Record<string, unknown>;
        cleaned[key] = {
          best:
            typeof e.best === "number" && Number.isFinite(e.best)
              ? Math.max(0, e.best)
              : 0,
          practice:
            typeof e.practice === "number" && Number.isFinite(e.practice)
              ? Math.min(
                  MAX_PRACTICE_PER_DAY,
                  Math.max(0, Math.floor(e.practice)),
                )
              : 0,
        };
      }
      if (Object.keys(cleaned).length > 0) daily[day] = cleaned;
    }
  }
  const resetAt =
    typeof v.resetAt === "number" && Number.isFinite(v.resetAt) && v.resetAt > 0
      ? Math.floor(v.resetAt)
      : undefined;
  const completedQuestsByDay: Record<string, string[]> = {};
  if (
    typeof v.completedQuestsByDay === "object" &&
    v.completedQuestsByDay !== null &&
    !Array.isArray(v.completedQuestsByDay)
  ) {
    for (const [day, ids] of Object.entries(
      v.completedQuestsByDay as Record<string, unknown>,
    )) {
      if (!DAY_PATTERN.test(day) || !Array.isArray(ids)) continue;
      const cleanIds = [
        ...new Set(
          ids.filter((id): id is string => typeof id === "string" && id.length > 0),
        ),
      ];
      if (cleanIds.length > 0) completedQuestsByDay[day] = cleanIds;
    }
  }
  const workshopDays = Array.isArray(v.workshopDays)
    ? [
        ...new Set(
          v.workshopDays.filter(
            (d): d is string => typeof d === "string" && DAY_PATTERN.test(d),
          ),
        ),
      ].sort()
    : [];
  const enabledChoreIds = Array.isArray(v.enabledChoreIds)
    ? [
        ...new Set(
          v.enabledChoreIds.filter(
            (id): id is string => typeof id === "string" && id.length > 0,
          ),
        ),
      ]
    : undefined;
  const completedChoresByDay: Record<string, string[]> = {};
  if (
    typeof v.completedChoresByDay === "object" &&
    v.completedChoresByDay !== null &&
    !Array.isArray(v.completedChoresByDay)
  ) {
    for (const [day, ids] of Object.entries(
      v.completedChoresByDay as Record<string, unknown>,
    )) {
      if (!DAY_PATTERN.test(day) || !Array.isArray(ids)) continue;
      const cleanIds = [
        ...new Set(
          ids.filter((id): id is string => typeof id === "string" && id.length > 0),
        ),
      ];
      if (cleanIds.length > 0) completedChoresByDay[day] = cleanIds;
    }
  }
  const ageBand =
    typeof v.ageBand === "number" &&
    Number.isInteger(v.ageBand) &&
    v.ageBand >= 0 &&
    v.ageBand <= 5
      ? v.ageBand
      : undefined;
  const explorerVisited = cleanExplorerVisited(v.explorerVisited);
  const explorerSeen = cleanExplorerSeen(v.explorerSeen);
  const garageDone = cleanGarageDone(v.garageDone);
  return {
    version: 1,
    totalXp:
      typeof v.totalXp === "number" && Number.isFinite(v.totalXp)
        ? Math.max(0, Math.floor(v.totalXp))
        : 0,
    missionStars,
    daily,
    unlockedIds: Array.isArray(v.unlockedIds)
      ? [...new Set(v.unlockedIds.filter((id): id is string => typeof id === "string"))]
      : [],
    sandboxUnlockAll: v.sandboxUnlockAll === true,
    ...(resetAt !== undefined ? { resetAt } : {}),
    ...(Object.keys(completedQuestsByDay).length > 0
      ? { completedQuestsByDay }
      : {}),
    ...(workshopDays.length > 0 ? { workshopDays } : {}),
    ...(enabledChoreIds !== undefined ? { enabledChoreIds } : {}),
    ...(Object.keys(completedChoresByDay).length > 0
      ? { completedChoresByDay }
      : {}),
    ...(ageBand !== undefined ? { ageBand } : {}),
    ...(explorerVisited.length > 0 ? { explorerVisited } : {}),
    ...(explorerSeen.length > 0 ? { explorerSeen } : {}),
    ...(garageDone.length > 0 ? { garageDone } : {}),
  };
}

/** §9.3: non-null age wins; conflicting ages follow the higher-XP record. */
function mergedAgeBand(
  local: ProgressionState,
  remote: ProgressionState,
): number | undefined {
  if (local.ageBand === undefined) return remote.ageBand;
  if (remote.ageBand === undefined || remote.ageBand === local.ageBand) {
    return local.ageBand;
  }
  return local.totalXp >= remote.totalXp ? local.ageBand : remote.ageBand;
}

/** Union merge: highest XP/stars win unless one side carries a newer parent reset. */
export function mergeProgression(
  local: ProgressionState,
  remote: ProgressionState,
): ProgressionState {
  const localReset = local.resetAt ?? 0;
  const remoteReset = remote.resetAt ?? 0;
  const unlockedIds = [
    ...new Set([...local.unlockedIds, ...remote.unlockedIds]),
  ];
  const sandboxUnlockAll = local.sandboxUnlockAll || remote.sandboxUnlockAll;
  const enabledChoreIds = local.enabledChoreIds ?? remote.enabledChoreIds;
  const ageBand = mergedAgeBand(local, remote);
  if (localReset !== remoteReset) {
    const newer = localReset > remoteReset ? local : remote;
    const merged: ProgressionState = {
      ...newer,
      unlockedIds,
      sandboxUnlockAll,
      ...(enabledChoreIds !== undefined ? { enabledChoreIds } : {}),
    };
    if (ageBand !== undefined) merged.ageBand = ageBand;
    else delete merged.ageBand;
    return merged;
  }
  const missionStars: Record<string, number> = { ...remote.missionStars };
  for (const [key, stars] of Object.entries(local.missionStars)) {
    missionStars[key] = Math.max(missionStars[key] ?? 0, stars);
  }
  const daily: ProgressionState["daily"] = {};
  for (const day of new Set([
    ...Object.keys(remote.daily),
    ...Object.keys(local.daily),
  ])) {
    const perKey: Record<string, DailyKeyState> = {
      ...(remote.daily[day] ?? {}),
    };
    for (const [key, entry] of Object.entries(local.daily[day] ?? {})) {
      const existing = perKey[key];
      perKey[key] = existing
        ? {
            best: Math.max(existing.best, entry.best),
            practice: Math.max(existing.practice, entry.practice),
          }
        : entry;
    }
    daily[day] = perKey;
  }
  const completedQuestsByDay: Record<string, string[]> = {};
  for (const day of new Set([
    ...Object.keys(remote.completedQuestsByDay ?? {}),
    ...Object.keys(local.completedQuestsByDay ?? {}),
  ])) {
    const mergedIds = [
      ...new Set([
        ...(remote.completedQuestsByDay?.[day] ?? []),
        ...(local.completedQuestsByDay?.[day] ?? []),
      ]),
    ];
    if (mergedIds.length > 0) completedQuestsByDay[day] = mergedIds;
  }
  const completedChoresByDay: Record<string, string[]> = {};
  for (const day of new Set([
    ...Object.keys(remote.completedChoresByDay ?? {}),
    ...Object.keys(local.completedChoresByDay ?? {}),
  ])) {
    const mergedIds = [
      ...new Set([
        ...(remote.completedChoresByDay?.[day] ?? []),
        ...(local.completedChoresByDay?.[day] ?? []),
      ]),
    ];
    if (mergedIds.length > 0) completedChoresByDay[day] = mergedIds;
  }
  const workshopDays = [
    ...new Set([
      ...(remote.workshopDays ?? []),
      ...(local.workshopDays ?? []),
    ]),
  ].sort();
  const explorerVisited = cleanExplorerVisited([
    ...(remote.explorerVisited ?? []),
    ...(local.explorerVisited ?? []),
  ]);
  const explorerSeen = cleanExplorerSeen([
    ...(remote.explorerSeen ?? []),
    ...(local.explorerSeen ?? []),
  ]);
  const garageDone = cleanGarageDone([
    ...(remote.garageDone ?? []),
    ...(local.garageDone ?? []),
  ]);
  return {
    version: 1,
    totalXp: Math.max(local.totalXp, remote.totalXp),
    missionStars,
    daily,
    unlockedIds,
    sandboxUnlockAll,
    ...(localReset > 0 ? { resetAt: localReset } : {}),
    ...(Object.keys(completedQuestsByDay).length > 0
      ? { completedQuestsByDay }
      : {}),
    ...(workshopDays.length > 0 ? { workshopDays } : {}),
    ...(enabledChoreIds !== undefined ? { enabledChoreIds } : {}),
    ...(Object.keys(completedChoresByDay).length > 0
      ? { completedChoresByDay }
      : {}),
    ...(ageBand !== undefined ? { ageBand } : {}),
    ...(explorerVisited.length > 0 ? { explorerVisited } : {}),
    ...(explorerSeen.length > 0 ? { explorerSeen } : {}),
    ...(garageDone.length > 0 ? { garageDone } : {}),
  };
}

/** XP reset wipes totals and stars only; grandfathered unlocks and routine setup survive. */
export function resetProgression(
  prog: ProgressionState,
  now = Date.now(),
): ProgressionState {
  return {
    ...emptyProgression(),
    unlockedIds: [...prog.unlockedIds],
    sandboxUnlockAll: prog.sandboxUnlockAll,
    ...(prog.ageBand !== undefined ? { ageBand: prog.ageBand } : {}),
    ...(prog.enabledChoreIds !== undefined
      ? { enabledChoreIds: [...prog.enabledChoreIds] }
      : {}),
    resetAt: Math.max(1, Math.floor(now)),
  };
}

/** Add toy ids to the permanent grandfather set. Returns true if changed. */
export function grandfatherToyIds(
  prog: ProgressionState,
  toyIds: readonly string[],
): { next: ProgressionState; changed: boolean } {
  const existing = new Set(prog.unlockedIds);
  let changed = false;
  for (const id of toyIds) {
    if (id && !existing.has(id)) {
      existing.add(id);
      changed = true;
    }
  }
  if (!changed) return { next: prog, changed: false };
  return { next: { ...prog, unlockedIds: [...existing] }, changed: true };
}

export function loadProgression(): ProgressionState {
  try {
    const raw = localStorage.getItem(PROGRESSION_STORAGE_KEY);
    if (!raw) return emptyProgression();
    return normalizeProgression(JSON.parse(raw) as unknown);
  } catch {
    return emptyProgression();
  }
}

export function saveProgression(prog: ProgressionState): void {
  try {
    localStorage.setItem(PROGRESSION_STORAGE_KEY, JSON.stringify(prog));
  } catch {
    /* storage unavailable: progression stays in memory for the session */
  }
}

/** Best-effort ownership sync; local storage stays authoritative offline. */
export async function pushProgression(prog: ProgressionState): Promise<void> {
  await pushOwnership({
    type: "character",
    id: PROGRESSION_OWNERSHIP_ID,
    payload: prog,
  });
}

export const CAROUSEL_IMPORT_MARKER = "carousel:imported:v1";

/**
 * One-time silent playtest-mockup import (carousel spec §9.4): tvAge ->
 * ageBand, each finished rung (tvDone, plus tvLittle for `little`) ->
 * 1 star on its rung key, no retro XP. tf25 found/mdone already share
 * ToyForge goal keys and re-derive from our own save, so only its
 * presence counts as a trigger. Idempotent via the marker key.
 */
export function importCarouselMockup(
  prog: ProgressionState,
  getItem: (key: string) => string | null = (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
): { next: ProgressionState; imported: boolean } {
  if (getItem(CAROUSEL_IMPORT_MARKER) !== null) return { next: prog, imported: false };
  const tvAge = getItem("tvAge");
  const tvDoneRaw = getItem("tvDone");
  const tvLittleRaw = getItem("tvLittle");
  const tf25 = getItem("tf25");
  if (tvAge === null && tvDoneRaw === null && tvLittleRaw === null && tf25 === null) {
    return { next: prog, imported: false };
  }
  const missionStars = { ...prog.missionStars };
  const grant = (trackId: string, indexes: unknown): void => {
    const ladder = LADDERS.find((l) => l.id === trackId);
    if (!ladder || !Array.isArray(indexes)) return;
    for (const i of indexes) {
      if (!Number.isInteger(i)) continue;
      const rung = ladder.rungs[i as number];
      if (!rung) continue;
      const key = rungKey(rung);
      missionStars[key] = Math.max(missionStars[key] ?? 0, 1);
    }
  };
  try {
    const done = JSON.parse(tvDoneRaw ?? "{}") as Record<string, unknown>;
    for (const [trackId, indexes] of Object.entries(done)) grant(trackId, indexes);
  } catch {
    /* corrupt mockup data imports nothing */
  }
  try {
    grant("little", JSON.parse(tvLittleRaw ?? "[]") as unknown);
  } catch {
    /* corrupt mockup data imports nothing */
  }
  const parsedAge = tvAge === null ? null : Number(tvAge);
  const ageBand =
    prog.ageBand === undefined &&
    parsedAge !== null &&
    Number.isInteger(parsedAge) &&
    parsedAge >= 0 &&
    parsedAge <= 5
      ? parsedAge
      : prog.ageBand;
  return {
    next: {
      ...prog,
      missionStars,
      ...(ageBand !== undefined ? { ageBand } : {}),
    },
    imported: true,
  };
}

/** Run the §9.4 import against localStorage and stamp the marker. */
export function runCarouselImportOnce(prog: ProgressionState): ProgressionState {
  const { next, imported } = importCarouselMockup(prog);
  if (!imported) return prog;
  try {
    localStorage.setItem(CAROUSEL_IMPORT_MARKER, "1");
  } catch {
    /* storage unavailable: a later boot retries */
  }
  return next;
}

export async function pullProgression(): Promise<ProgressionState | null> {
  const items = await pullOwnership();
  if (!items) return null;
  const record = items.find(
    (item) => item.type === "character" && item.id === PROGRESSION_OWNERSHIP_ID,
  );
  if (!record) return null;
  return normalizeProgression(record.payload);
}
