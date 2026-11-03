// The Garage: a place to build new things, always open, with a new drop every
// Friday, Saturday and Sunday (docs/specs/garage-weekend-spec.md). Pure helpers
// only, so the weekend window, the rotation, the age versions, the goal checks
// and the rewards are all unit-testable. Nothing here touches the game.
//
// Phase 1 (this file): three launch drops, one per kind, each with a version
// for every age group; deterministic rotation from the date (offline, no
// server); STEM minutes through the existing mission credit.

import { DAILY_QUEST_XP } from "./dailyQuests";
import { rankFor, type MakerRank, type ProgressionState } from "./progression";

/* ---------------------------------------------------------------- days */

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/** Days since 1970-01-01 for a "YYYY-MM-DD" key, or null when it is not a real date. */
export function dayNumber(dayKey: string): number | null {
  const m = DAY_RE.exec(dayKey);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    return null;
  }
  return Math.round(t / MS_PER_DAY);
}

export function dayKeyOf(dayNum: number): string {
  return new Date(dayNum * MS_PER_DAY).toISOString().slice(0, 10);
}

/** 0 = Sunday ... 6 = Saturday, for a "YYYY-MM-DD" key. */
export function dayOfWeek(dayKey: string): number | null {
  const n = dayNumber(dayKey);
  // 1970-01-01 was a Thursday (4).
  return n === null ? null : (((n + 4) % 7) + 7) % 7;
}

export interface WeekendInfo {
  /** Friday, Saturday or Sunday. */
  isWeekend: boolean;
  /** The date of the Friday that opens this weekend, or the last one on a weekday. */
  weekendKey: string;
  /** The Friday after `weekendKey`. */
  nextWeekendKey: string;
}

/** Friday opens the weekend; Saturday and Sunday belong to the Friday before. */
export function weekendOf(dayKey: string): WeekendInfo | null {
  const n = dayNumber(dayKey);
  const dow = dayOfWeek(dayKey);
  if (n === null || dow === null) return null;
  const sinceFriday = (dow - 5 + 7) % 7; // Fri 0, Sat 1, Sun 2, Mon 3 ... Thu 6
  const friday = n - sinceFriday;
  return {
    isWeekend: sinceFriday <= 2,
    weekendKey: dayKeyOf(friday),
    nextWeekendKey: dayKeyOf(friday + 7),
  };
}

/* --------------------------------------------------------------- goals */

export type StatId = "speed" | "spin" | "glow" | "torque";
export const STAT_IDS: readonly StatId[] = ["speed", "spin", "glow", "torque"];
export const STAT_LABEL: Record<StatId, string> = {
  speed: "Speed",
  spin: "Spin",
  glow: "Glow",
  torque: "Grip",
};
export type GarageToyType = "character" | "vehicle";

/** What the Garage needs to know about the toy right now (engine `buildSummary`). */
export interface BuildSummary {
  type: string;
  /** The part chosen in each slot (short ids like "crown", or full keys). */
  sel: Readonly<Record<string, string>>;
  /** The stats the equipped parts give. */
  stats: readonly StatId[];
}

export type GarageGoal =
  /** Wear the drop's loaner part (one per toy type). */
  | { kind: "equip"; keys: Record<GarageToyType, string> }
  /** Build with all of these stats. */
  | { kind: "stats"; need: readonly StatId[] }
  /** Build with at least this many different stats. */
  | { kind: "statCount"; count: number }
  /** Change parts from the build the child started with, under a twist. */
  | { kind: "remix"; changes: number; gainStat?: boolean; keepStats?: boolean }
  | { kind: "all"; goals: readonly GarageGoal[] };

export interface GoalPart {
  label: string;
  ok: boolean;
}
export interface GoalCheck {
  ok: boolean;
  parts: GoalPart[];
}

/** The part in each slot as a full key ("character.hat.crown"). */
export function equippedKeys(build: BuildSummary): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [slot, value] of Object.entries(build.sel)) {
    if (typeof value !== "string" || value === "") continue;
    out[slot] = value.includes(".") ? value : `${build.type}.${slot}.${value}`;
  }
  return out;
}

const has = (list: readonly StatId[], s: StatId): boolean => list.includes(s);

/** How many slots hold a different part in `now` than in `before` (a part added or removed counts). */
export function changedSlots(before: BuildSummary, now: BuildSummary): number {
  const a = equippedKeys(before);
  const b = equippedKeys(now);
  let changed = 0;
  for (const slot of new Set([...Object.keys(a), ...Object.keys(b)])) if (a[slot] !== b[slot]) changed++;
  return changed;
}

/**
 * A mission is done when the goal holds AND the child has changed something
 * since pressing Start. Without that, a goal the toy already meets (it already
 * glows, say) would pay out the moment Start was pressed.
 */
export function missionDone(goal: GarageGoal, now: BuildSummary, baseline: BuildSummary): boolean {
  return changedSlots(baseline, now) >= 1 && checkGoal(goal, now, baseline).ok;
}

/**
 * The goal's parts as the goal chip shows them. When the toy already meets a
 * goal that does not ask for a change, "Change something" is added, so the chip
 * shows what is left to do instead of a row of ticks that never finishes.
 */
export function missionParts(goal: GarageGoal, now: BuildSummary, baseline: BuildSummary): GoalPart[] {
  const check = checkGoal(goal, now, baseline);
  if (!check.ok || changedSlots(baseline, now) >= 1) return check.parts;
  return [...check.parts, { label: "Change something", ok: false }];
}

/**
 * Does this build meet the goal? `baseline` is the build the child started
 * from (needed by a remix). Each part of the goal reports on its own so the
 * goal chip can tick them off as the child builds.
 */
export function checkGoal(goal: GarageGoal, build: BuildSummary, baseline?: BuildSummary): GoalCheck {
  switch (goal.kind) {
    case "equip": {
      const key = (goal.keys as Record<string, string>)[build.type];
      const worn = key !== undefined && Object.values(equippedKeys(build)).includes(key);
      return { ok: worn, parts: [{ label: "Wear the new part", ok: worn }] };
    }
    case "stats": {
      const parts = goal.need.map((s) => ({ label: STAT_LABEL[s], ok: has(build.stats, s) }));
      return { ok: parts.every((p) => p.ok), parts };
    }
    case "statCount": {
      const n = new Set(build.stats).size;
      return {
        ok: n >= goal.count,
        parts: [{ label: `${Math.min(n, goal.count)} of ${goal.count} stats`, ok: n >= goal.count }],
      };
    }
    case "remix": {
      if (!baseline) return { ok: false, parts: [{ label: "Start from your build", ok: false }] };
      const changed = changedSlots(baseline, build);
      const parts: GoalPart[] = [
        {
          label: goal.changes === 1 ? "Change a part" : `Change ${goal.changes} parts`,
          ok: changed >= goal.changes,
        },
      ];
      if (goal.gainStat) {
        parts.push({ label: "Gain a new stat", ok: build.stats.some((s) => !has(baseline.stats, s)) });
      }
      if (goal.keepStats) {
        parts.push({ label: "Keep every stat", ok: baseline.stats.every((s) => has(build.stats, s)) });
      }
      return { ok: parts.every((p) => p.ok), parts };
    }
    case "all": {
      const checks = goal.goals.map((g) => checkGoal(g, build, baseline));
      return { ok: checks.every((c) => c.ok), parts: checks.flatMap((c) => c.parts) };
    }
  }
}

/* --------------------------------------------------------------- drops */

export type DropKind = "newPart" | "idea" | "remix";
/** The age ranges a drop is written for (bands 0-1, 2, 3, 4-5; unset reads as `early`). */
export type BandGroup = "tiny" | "early" | "mid" | "older";
export const BAND_GROUPS: readonly BandGroup[] = ["tiny", "early", "mid", "older"];

export function bandGroupOf(ageBand: number | null | undefined): BandGroup {
  if (typeof ageBand !== "number") return "early";
  return ageBand <= 1 ? "tiny" : ageBand === 2 ? "early" : ageBand === 3 ? "mid" : "older";
}

export interface GarageVariant {
  title: string;
  /** One or two short sentences, written for the age. */
  brief: string;
  goal: GarageGoal;
}

export interface GarageDrop {
  id: string;
  kind: DropKind;
  byGroup: Record<BandGroup, GarageVariant>;
  /** New part: the parts opened to try for the weekend, one per toy type. */
  loan?: Record<GarageToyType, string>;
}

const CROWN: Record<GarageToyType, string> = {
  character: "character.hat.crown",
  vehicle: "vehicle.rear.booster",
};

/**
 * The launch drops, one of each kind. Written in stats and "change one thing"
 * so they work for both toy types. Every goal is reachable with parts a child
 * already has open (tests check this against the part catalog).
 */
export const GARAGE_DROPS: readonly GarageDrop[] = [
  {
    id: "new-part-trial",
    kind: "newPart",
    loan: CROWN,
    byGroup: {
      tiny: { title: "Try the new part!", brief: "Put on the shiny new part.", goal: { kind: "equip", keys: CROWN } },
      early: {
        title: "Try the new part",
        brief: "This weekend you can wear a part you have not found yet. Put it on.",
        goal: { kind: "equip", keys: CROWN },
      },
      mid: {
        title: "Weekend loaner",
        brief: "A part from another world is yours to try this weekend. Wear it and see what it does.",
        goal: { kind: "equip", keys: CROWN },
      },
      older: {
        title: "Loaner part challenge",
        brief: "Wear this weekend's loaner part and build with three different stats.",
        goal: { kind: "all", goals: [{ kind: "equip", keys: CROWN }, { kind: "statCount", count: 3 }] },
      },
    },
  },
  {
    id: "glow-and-go",
    kind: "idea",
    byGroup: {
      tiny: { title: "Make it glow!", brief: "Pick a part that glows.", goal: { kind: "stats", need: ["glow"] } },
      early: {
        title: "Glow and go",
        brief: "Build something that glows and has speed.",
        goal: { kind: "stats", need: ["glow", "speed"] },
      },
      mid: {
        title: "Glow and speed",
        brief: "Build something with glow and speed. Mix parts until both show up.",
        goal: { kind: "stats", need: ["glow", "speed"] },
      },
      older: {
        title: "Night racer",
        brief: "Build with glow, speed and grip together.",
        goal: { kind: "stats", need: ["glow", "speed", "torque"] },
      },
    },
  },
  {
    id: "remix-your-toy",
    kind: "remix",
    byGroup: {
      tiny: { title: "Change one thing!", brief: "Swap one part for a different one.", goal: { kind: "remix", changes: 1 } },
      early: {
        title: "Remix it",
        brief: "Change one part of your toy to make it new.",
        goal: { kind: "remix", changes: 1 },
      },
      mid: {
        title: "Remix with a twist",
        brief: "Change a part and gain a stat your toy did not have.",
        goal: { kind: "remix", changes: 1, gainStat: true },
      },
      older: {
        title: "Remix, keep the power",
        brief: "Change two parts but keep every stat your toy had.",
        goal: { kind: "remix", changes: 2, keepStats: true },
      },
    },
  },
];

/** The first weekend with a drop (the first Friday after launch); the rotation counts from here. */
export const FIRST_WEEKEND = "2026-11-06";

/**
 * Which drop a weekend gets: the catalog in order, one per weekend, from the
 * first Friday. Same weekend, same drop on every device, offline, and a drop
 * never repeats until the whole catalog has been through.
 */
export function dropForWeekend(weekendKey: string): GarageDrop {
  const n = dayNumber(weekendKey) ?? dayNumber(FIRST_WEEKEND)!;
  const weeks = Math.floor((n - dayNumber(FIRST_WEEKEND)!) / 7);
  const len = GARAGE_DROPS.length;
  return GARAGE_DROPS[((weeks % len) + len) % len]!;
}

/** The parts a drop opens to try, for every toy type. */
export function loanKeys(drop: GarageDrop): string[] {
  return drop.loan ? Object.values(drop.loan) : [];
}

/* -------------------------------------------------------------- status */

export interface GarageStatus {
  dayKey: string;
  /** It is Friday to Sunday (or Preview weekend is on): the Garage is animated and in focus. */
  isWeekend: boolean;
  /** The Friday of the weekend the drop belongs to. */
  weekendKey: string;
  nextWeekendKey: string;
  drop: GarageDrop;
  group: BandGroup;
  variant: GarageVariant;
  /** This weekend's drop is finished. */
  done: boolean;
  /** Weekend and not finished: the badge, the animation and the suggestion. */
  open: boolean;
  preview: boolean;
}

export function garageStatus(input: {
  dayKey: string;
  ageBand: number | null | undefined;
  done: readonly string[] | undefined;
  /** Demo Mode "Preview weekend": show the weekend state on a weekday. */
  preview?: boolean;
}): GarageStatus {
  const real = weekendOf(input.dayKey) ?? weekendOf(FIRST_WEEKEND)!;
  const preview = input.preview === true && !real.isWeekend;
  // A preview on a weekday shows the next drop, so it never collides with last weekend's.
  const weekendKey = preview ? real.nextWeekendKey : real.weekendKey;
  const isWeekend = real.isWeekend || preview;
  const drop = dropForWeekend(weekendKey);
  const group = bandGroupOf(input.ageBand);
  const done = (input.done ?? []).includes(weekendKey);
  return {
    dayKey: input.dayKey,
    isWeekend,
    weekendKey,
    nextWeekendKey: dayKeyOf((dayNumber(weekendKey) ?? 0) + 7),
    drop,
    group,
    variant: drop.byGroup[group],
    done,
    open: isWeekend && !done,
    preview,
  };
}

/** The mission id credited as a STEM mission (parent time) once, on completion. */
export const garageMissionId = (weekendKey: string): string => `garage.${weekendKey}`;

/* ----------------------------------------------------------- rewards */

export const GARAGE_XP = DAILY_QUEST_XP;
/** Room for a few years of weekends. */
const GARAGE_DONE_MAX = 200;

export interface GarageCompleteResult {
  next: ProgressionState;
  awarded: number;
  rankBefore: MakerRank;
  rankAfter: MakerRank;
  /** Pass to `recordPlayProgress({ completedMissionIds })` so it earns STEM minutes. */
  stemMissionId: string | null;
}

/**
 * Finish this weekend's drop: XP once, a Workshop Day stamp (never resets) and
 * the weekend remembered as done. Finishing again changes nothing.
 */
export function completeGarage(prog: ProgressionState, weekendKey: string, dayKey: string): GarageCompleteResult {
  const rankBefore = rankFor(prog.totalXp);
  const noop: GarageCompleteResult = {
    next: prog,
    awarded: 0,
    rankBefore,
    rankAfter: rankBefore,
    stemMissionId: null,
  };
  if (dayNumber(weekendKey) === null) return noop;
  const done = prog.garageDone ?? [];
  if (done.includes(weekendKey)) return noop;
  const stamps = dayNumber(dayKey) === null ? (prog.workshopDays ?? []) : [...new Set([...(prog.workshopDays ?? []), dayKey])].sort();
  const next: ProgressionState = {
    ...prog,
    totalXp: prog.totalXp + GARAGE_XP,
    garageDone: [...done, weekendKey].sort().slice(-GARAGE_DONE_MAX),
    ...(stamps.length > 0 ? { workshopDays: stamps } : {}),
  };
  return {
    next,
    awarded: GARAGE_XP,
    rankBefore,
    rankAfter: rankFor(next.totalXp),
    stemMissionId: garageMissionId(weekendKey),
  };
}

/* -------------------------------------------------------------- grace */

/**
 * Extra time to finish a Garage mission when the day's limit would lock the
 * child out (today's mission grace is only 25 seconds, nothing for a build).
 * Once per weekend, never during quiet hours; spent only while the mission is
 * on screen. The length is a proposal (spec: Still open).
 */
export const GARAGE_GRACE_MS = 10 * 60_000;

export const garageGraceLeftMs = (usedMs: number): number =>
  Math.max(0, GARAGE_GRACE_MS - Math.max(0, usedMs));
