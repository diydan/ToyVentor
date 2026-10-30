// STEM XP progression (Phase 3). Pure award/rank/gate math plus local-first
// persistence in localStorage, synced in the ownership `character` lane as
// id "progression:v1" (see docs/specs/xp-system-spec.md). One shared pool
// per device; no per-kid or per-toy XP.
import type { StatName } from "../../shared/part";
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
  { rank: 6, title: "Mech Inventor", xp: 2700, vehicles: ["Bolt Power Mech"] },
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

/** Lab family of a mission id: "lab1.measure" -> "lab1". */
export function familyOf(missionId: string): string {
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
): boolean {
  if (prog.sandboxUnlockAll) return true;
  return rankFor(prog.totalXp).vehicles.includes(vehicle);
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

const KEY_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+:t[123]$/;

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
  };
}

/** Union merge: highest XP/stars win, unlocks union, sandbox OR. */
export function mergeProgression(
  local: ProgressionState,
  remote: ProgressionState,
): ProgressionState {
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
  return {
    version: 1,
    totalXp: Math.max(local.totalXp, remote.totalXp),
    missionStars,
    daily,
    unlockedIds: [...new Set([...local.unlockedIds, ...remote.unlockedIds])],
    sandboxUnlockAll: local.sandboxUnlockAll || remote.sandboxUnlockAll,
  };
}

/** XP reset wipes totals and stars only; grandfathered unlocks survive. */
export function resetProgression(prog: ProgressionState): ProgressionState {
  return {
    ...emptyProgression(),
    unlockedIds: [...prog.unlockedIds],
    sandboxUnlockAll: prog.sandboxUnlockAll,
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

export async function pullProgression(): Promise<ProgressionState | null> {
  const items = await pullOwnership();
  if (!items) return null;
  const record = items.find(
    (item) => item.type === "character" && item.id === PROGRESSION_OWNERSHIP_ID,
  );
  if (!record) return null;
  return normalizeProgression(record.payload);
}
