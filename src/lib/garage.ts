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
  /**
   * A household weekend (household-library-spec.md): find one at home, or skip by playing "Who's that shape?". It is never met by a build, so
   * `checkGoal` never says ok: a grown-up confirms the find, or the shape game finishes it (`completeGarageHousehold`). `items` are the library
   * item ids asked for (one item, or the tools of a tool weekend), `count` how many different ones, and `toyTool` the youngest tool weekend, where
   * the toy support tool is the picture and the task is to ask a grown-up to show a tool.
   */
  | { kind: "household"; items: readonly string[]; count: number; toyTool?: boolean }
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
    case "household":
      // Never met by a build: the grown-up's "We found it" or the shape game completes a household weekend.
      return { ok: false, parts: [{ label: goal.toyTool ? "Ask a grown-up to show you a tool" : "Find one at home", ok: false }] };
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
  /** A household weekend (garageHousehold.ts builds these): what it is about, so the sheet can show the item. */
  household?: { kind: "item" | "tools"; itemId?: string };
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
  {
    id: "propeller-cap",
    kind: "newPart",
    loan: {
      character: "character.hat.propcap",
      vehicle: "vehicle.rear.spoiler",
    },
    byGroup: {
      tiny: { title: "Spinny hat!", brief: "Put on the spinny hat.", goal: { kind: "equip", keys: { character: "character.hat.propcap", vehicle: "vehicle.rear.spoiler" } } },
      early: {
        title: "Spin into the weekend",
        brief: "Try the loaner part and give your toy spin.",
        goal: { kind: "equip", keys: { character: "character.hat.propcap", vehicle: "vehicle.rear.spoiler" } },
      },
      mid: {
        title: "Weekend loaner: spin",
        brief: "A spinny loaner part is yours this weekend. Wear it, then keep the spin with your own parts.",
        goal: { kind: "all", goals: [{ kind: "equip", keys: { character: "character.hat.propcap", vehicle: "vehicle.rear.spoiler" } }, { kind: "stats", need: ["spin"] }] },
      },
      older: {
        title: "Loaner spin trial",
        brief: "Wear the loaner, then rebuild the same spin from found parts and hand the loaner back.",
        goal: { kind: "all", goals: [{ kind: "equip", keys: { character: "character.hat.propcap", vehicle: "vehicle.rear.spoiler" } }, { kind: "stats", need: ["spin", "speed"] }] },
      },
    },
  },
  {
    id: "sky-wings",
    kind: "newPart",
    loan: {
      character: "character.back.wings",
      vehicle: "vehicle.chassis.buggy",
    },
    byGroup: {
      tiny: { title: "Wings!", brief: "Put on the wings and fly.", goal: { kind: "equip", keys: { character: "character.back.wings", vehicle: "vehicle.chassis.buggy" } } },
      early: {
        title: "Wings for the weekend",
        brief: "Borrow the wings and take your toy racing.",
        goal: { kind: "equip", keys: { character: "character.back.wings", vehicle: "vehicle.chassis.buggy" } },
      },
      mid: {
        title: "Weekend loaner: wings",
        brief: "Sky wings are yours to try. Wear them and feel the speed.",
        goal: { kind: "equip", keys: { character: "character.back.wings", vehicle: "vehicle.chassis.buggy" } },
      },
      older: {
        title: "Flight test",
        brief: "Wear the wings, then build speed and spin around them.",
        goal: { kind: "all", goals: [{ kind: "equip", keys: { character: "character.back.wings", vehicle: "vehicle.chassis.buggy" } }, { kind: "stats", need: ["speed", "spin"] }] },
      },
    },
  },
  {
    id: "jetpack-weekend",
    kind: "newPart",
    loan: {
      character: "character.back.jetpack",
      vehicle: "vehicle.front.lightbar",
    },
    byGroup: {
      tiny: { title: "Jetpack!", brief: "Put on the jetpack. 3, 2, 1!", goal: { kind: "equip", keys: { character: "character.back.jetpack", vehicle: "vehicle.front.lightbar" } } },
      early: {
        title: "Blast off",
        brief: "Borrow the jetpack and blast your toy off.",
        goal: { kind: "equip", keys: { character: "character.back.jetpack", vehicle: "vehicle.front.lightbar" } },
      },
      mid: {
        title: "Weekend loaner: jetpack",
        brief: "A real jetpack to try. Wear it and chase the glow.",
        goal: { kind: "all", goals: [{ kind: "equip", keys: { character: "character.back.jetpack", vehicle: "vehicle.front.lightbar" } }, { kind: "stats", need: ["glow"] }] },
      },
      older: {
        title: "Jetpack trial",
        brief: "Wear the jetpack and build glow and speed to match it.",
        goal: { kind: "all", goals: [{ kind: "equip", keys: { character: "character.back.jetpack", vehicle: "vehicle.front.lightbar" } }, { kind: "stats", need: ["glow", "speed"] }] },
      },
    },
  },
  {
    id: "spin-and-grip",
    kind: "idea",
    byGroup: {
      tiny: { title: "Spin!", brief: "Make your toy spin around.", goal: { kind: "stats", need: ["spin"] } },
      early: {
        title: "Spin and grip",
        brief: "Build something with spin and grip.",
        goal: { kind: "stats", need: ["spin", "torque"] },
      },
      mid: {
        title: "Whirl and hold",
        brief: "Spin and grip together. Mix parts until both show up.",
        goal: { kind: "stats", need: ["spin", "torque"] },
      },
      older: {
        title: "Controlled whirl",
        brief: "Spin, grip and speed, all three at once.",
        goal: { kind: "stats", need: ["spin", "torque", "speed"] },
      },
    },
  },
  {
    id: "glow-and-spin",
    kind: "idea",
    byGroup: {
      tiny: { title: "Glow!", brief: "Make your toy glow bright.", goal: { kind: "stats", need: ["glow"] } },
      early: {
        title: "Glow and whirl",
        brief: "Build something that glows and spins.",
        goal: { kind: "stats", need: ["glow", "spin"] },
      },
      mid: {
        title: "Bright whirl",
        brief: "Glow and spin together. Mix parts until both show up.",
        goal: { kind: "stats", need: ["glow", "spin"] },
      },
      older: {
        title: "Light storm",
        brief: "Glow, spin and grip, all three at once.",
        goal: { kind: "stats", need: ["glow", "spin", "torque"] },
      },
    },
  },
  {
    id: "speed-and-grip",
    kind: "idea",
    byGroup: {
      tiny: { title: "Fast!", brief: "Make your toy super fast.", goal: { kind: "stats", need: ["speed"] } },
      early: {
        title: "Fast and strong",
        brief: "Build something fast that can shove.",
        goal: { kind: "stats", need: ["speed", "torque"] },
      },
      mid: {
        title: "Muscle racer",
        brief: "Speed and grip together. Mix parts until both show up.",
        goal: { kind: "stats", need: ["speed", "torque"] },
      },
      older: {
        title: "Two-stat tune",
        brief: "Any two stats from your own parts, then a third.",
        goal: { kind: "statCount", count: 3 },
      },
    },
  },
  {
    id: "swap-two",
    kind: "remix",
    byGroup: {
      tiny: { title: "Two swaps!", brief: "Swap two parts, not one.", goal: { kind: "remix", changes: 2 } },
      early: {
        title: "Double remix",
        brief: "Change two parts of your toy to make it new.",
        goal: { kind: "remix", changes: 2 },
      },
      mid: {
        title: "Two-part twist",
        brief: "Change two parts and gain a stat your toy did not have.",
        goal: { kind: "remix", changes: 2, gainStat: true },
      },
      older: {
        title: "Full rebuild",
        brief: "Change three parts but keep every stat your toy had.",
        goal: { kind: "remix", changes: 3, keepStats: true },
      },
    },
  },
  {
    id: "keep-the-glow",
    kind: "remix",
    byGroup: {
      tiny: { title: "One swap!", brief: "Swap one part. Keep it glowing.", goal: { kind: "remix", changes: 1 } },
      early: {
        title: "Keep it glowing",
        brief: "Change a part but keep the glow.",
        goal: { kind: "remix", changes: 1 },
      },
      mid: {
        title: "Hold the shine",
        brief: "Change two parts and keep every stat your toy had.",
        goal: { kind: "remix", changes: 2, keepStats: true },
      },
      older: {
        title: "Shine, rebuilt",
        brief: "Change three parts, keep every stat, and gain a new one.",
        goal: { kind: "remix", changes: 3, keepStats: true, gainStat: true },
      },
    },
  },
  {
    id: "mirror-build",
    kind: "remix",
    byGroup: {
      tiny: { title: "Copy toy!", brief: "Copy a friend's toy part.", goal: { kind: "remix", changes: 1 } },
      early: {
        title: "Borrow an idea",
        brief: "Change a part to match a toy you saw today.",
        goal: { kind: "remix", changes: 1, gainStat: true },
      },
      mid: {
        title: "Tribute build",
        brief: "Rebuild your toy as a tribute: two changed parts, same heart.",
        goal: { kind: "remix", changes: 2, keepStats: true },
      },
      older: {
        title: "Tribute, improved",
        brief: "Two changed parts, every stat kept, one stat gained.",
        goal: { kind: "remix", changes: 2, keepStats: true, gainStat: true },
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

/**
 * The build drop of a Build Day (household-library spec / garage spec "The rotation", Dan 2026-11-03: count them month by month). From launch the Build
 * Days are one a month, so they run through the catalog one per MONTH, and every drop comes back after exactly as many Build Days as there are drops.
 * (Counting weekends, as `dropForWeekend` does, would bring one back after as few as 3 Build Days, because months have 4 or 5 weekends.) The first
 * Build Day, the launch weekend's, gets the first drop, as `dropForWeekend` gives it. A weekend before launch keeps the per-weekend rotation, and so does
 * a key that is not a date.
 */
export function buildDropForWeekend(weekendKey: string): GarageDrop {
  const w = weekendOf(weekendKey);
  if (w === null || dayNumber(w.weekendKey)! < dayNumber(FIRST_WEEKEND)!) return dropForWeekend(weekendKey);
  const months = Number(w.weekendKey.slice(0, 4)) * 12 + Number(w.weekendKey.slice(5, 7)) - (Number(FIRST_WEEKEND.slice(0, 4)) * 12 + Number(FIRST_WEEKEND.slice(5, 7)));
  const len = GARAGE_DROPS.length;
  return GARAGE_DROPS[((months % len) + len) % len]!;
}

/**
 * Is this weekend a Build Day? The first weekend of each month (the Friday's day of the month is 1 to 7) keeps a build drop from the rotation
 * above, which is unchanged for it; every other weekend is a household weekend (garageHousehold.ts). Dan, 2026-11-03: without it, adding the
 * household drops to the same rotation would bring a household weekend round only every sixth weekend. A key that is not a date is a Build Day,
 * so nothing unexpected is ever treated as a household weekend; so is every weekend before the first one (the rule starts at launch, and the Garage
 * before it was all build weekends).
 */
export function isBuildDayWeekend(weekendKey: string): boolean {
  const w = weekendOf(weekendKey);
  if (w === null) return true;
  if (dayNumber(w.weekendKey)! < dayNumber(FIRST_WEEKEND)!) return true;
  return Number(w.weekendKey.slice(8, 10)) <= 7; // the Friday that opens the weekend
}

/** The parts a drop opens to try, for every toy type. */
export function loanKeys(drop: GarageDrop): string[] {
  return drop.loan ? Object.values(drop.loan) : [];
}

/* -------------------------------------------------------------- status */

/** The days the Garage drop may be live on, as day-of-week numbers (0 = Sunday). */
export const GARAGE_DAYS_DEFAULT: readonly number[] = [0, 5, 6];

export interface GarageStatus {
  /** A Build Day (a build drop from the rotation) or a household weekend (find one at home, or skip). */
  kind: "build" | "household";
  /** This weekend was finished by a find (a household weekend); false for a skip and for a build. */
  found: boolean;
  dayKey: string;
  /** It is a drop day (or Preview weekend is on): the Garage is animated and in focus. */
  isWeekend: boolean;
  /** The grown-up weekend-drop switch is on. Off hides the drop card. */
  dropEnabled: boolean;
  /** The Friday of the weekend the drop belongs to. */
  weekendKey: string;
  nextWeekendKey: string;
  drop: GarageDrop;
  group: BandGroup;
  variant: GarageVariant;
  /** This weekend's drop is finished. */
  done: boolean;
  /** A drop day, the drop switch on, and not finished: the badge, the animation and the suggestion. */
  open: boolean;
  preview: boolean;
}

export function garageStatus(input: {
  dayKey: string;
  ageBand: number | null | undefined;
  done: readonly string[] | undefined;
  /** Grown-up switch: the weekend drop is on (absent = on). */
  dropEnabled?: boolean;
  /** Grown-up days: day-of-week numbers the drop is live on (absent = Fri–Sun). */
  days?: readonly number[];
  /** Demo Mode "Preview weekend": show the weekend state on a weekday. */
  preview?: boolean;
  /** Weekends finished by a find (`garageFound`). */
  found?: readonly string[];
  /**
   * The household drop for a weekend that is not a Build Day, or null (`householdDropFor` in garageHousehold.ts, which needs the library catalog,
   * so the caller passes it in). Absent: every weekend is a build weekend, as before the household weekends.
   */
  householdDrop?: (weekendKey: string) => GarageDrop | null;
}): GarageStatus {
  const real = weekendOf(input.dayKey) ?? weekendOf(FIRST_WEEKEND)!;
  const preview = input.preview === true && !real.isWeekend;
  // A preview on a weekday shows the next drop, so it never collides with last weekend's.
  const weekendKey = preview ? real.nextWeekendKey : real.weekendKey;
  const days =
    input.days === undefined ? GARAGE_DAYS_DEFAULT : [...new Set(input.days)];
  // A drop is live on the grown-up-picked days (within Fri–Sun); the drop
  // switch only hides the card, never the Garage itself.
  const dow = dayOfWeek(input.dayKey);
  const live = preview || (dow !== null && days.includes(dow) && real.isWeekend);
  const household = !isBuildDayWeekend(weekendKey) ? (input.householdDrop?.(weekendKey) ?? null) : null;
  // a Build Day runs through the catalog month by month; a weekend with no household drop given (the callers from before household weekends) stays per weekend
  const drop = household ?? (isBuildDayWeekend(weekendKey) ? buildDropForWeekend(weekendKey) : dropForWeekend(weekendKey));
  const group = bandGroupOf(input.ageBand);
  const done = (input.done ?? []).includes(weekendKey);
  const dropEnabled = input.dropEnabled !== false;
  return {
    kind: household ? "household" : "build",
    found: household !== null && done && (input.found ?? []).includes(weekendKey),
    dayKey: input.dayKey,
    isWeekend: live,
    weekendKey,
    nextWeekendKey: dayKeyOf((dayNumber(weekendKey) ?? 0) + 7),
    drop,
    group,
    variant: drop.byGroup[group],
    done,
    dropEnabled,
    open: dropEnabled && !done && live,
    preview,
  };
}

/** The mission id credited as a STEM mission (parent time) once, on completion. */
export const garageMissionId = (weekendKey: string): string => `garage.${weekendKey}`;

/* ----------------------------------------------------------- rewards */

export const GARAGE_XP = DAILY_QUEST_XP;
/** The real-life build bonus: small, once per weekend, and only when no
 *  real-life XP was earned yet that day (shared +25 XP/day ceiling). */
export const GARAGE_REAL_XP = 10;
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

export interface GarageRealResult {
  next: ProgressionState;
  awarded: number;
  rankBefore: MakerRank;
  rankAfter: MakerRank;
}

/**
 * The grown-up "We built it": the family built this weekend's drop for real.
 * Only after the in-app drop is done, only with the real-life leg switched
 * on, and once per weekend. Pays the small real-life bonus only when no
 * real-life XP was earned yet that day (a routine or an earlier confirm).
 */
export function completeGarageReal(
  prog: ProgressionState,
  weekendKey: string,
  dayKey: string,
): GarageRealResult {
  const rankBefore = rankFor(prog.totalXp);
  const noop: GarageRealResult = {
    next: prog,
    awarded: 0,
    rankBefore,
    rankAfter: rankBefore,
  };
  if (dayNumber(weekendKey) === null || !DAY_RE.test(dayKey)) {
    return noop;
  }
  if (prog.garageRealLife === false) return noop;
  if (!(prog.garageDone ?? []).includes(weekendKey)) return noop;
  // A household weekend that was found has nothing to build: "We found it" was its real-life step.
  if ((prog.garageFound ?? []).includes(weekendKey)) return noop;
  const realToday = prog.garageRealByDay?.[dayKey] ?? [];
  if (realToday.includes(weekendKey)) return noop;
  const earnedToday =
    (prog.completedChoresByDay?.[dayKey] ?? []).length > 0 ||
    Object.entries(prog.garageRealByDay ?? {}).some(
      ([day, ids]) => day === dayKey && ids.length > 0,
    );
  const awarded = earnedToday ? 0 : GARAGE_REAL_XP;
  const stamps = [...new Set([...(prog.workshopDays ?? []), dayKey])].sort();
  return {
    next: {
      ...prog,
      totalXp: prog.totalXp + awarded,
      garageRealByDay: {
        ...(prog.garageRealByDay ?? {}),
        [dayKey]: [...new Set([...realToday, weekendKey])],
      },
      workshopDays: stamps,
    },
    awarded,
    rankBefore,
    rankAfter: rankFor(prog.totalXp + awarded),
  };
}

/** How a household weekend was finished. */
export type HouseholdMode = "found" | "skipped";

/**
 * Finish a household weekend (household-library-spec.md, garage-weekend-spec.md "Household library drops"): the grown-up's "We found it", or the child's
 * "Who's that shape?" skip. Not `completeGarage` (it has a build to wait for) and not `completeGarageReal` (it refuses a weekend with no in-app drop done
 * and pays the real-life 10, not the drop's 40). Both ways pay the drop's XP once, stamp the Workshop Day and remember the weekend as done, so it cannot
 * be finished twice; only a find earns play-time minutes (`stemMissionId`, the same mission id as a build) and is remembered in `garageFound`, so the roof
 * can tell a found weekend from a skipped one. A find does NOT touch `completedChoresByDay`, so it never uses the shared +25 XP/day real-life ceiling
 * (that ceiling counts routines), but it IS written to `garageRealByDay`, which a later same-day "We built it" reads (`earnedToday`): that one then pays 0.
 * A find needs the real-life leg switched on (a family that turned real-life tasks off can still skip). Only a household weekend can be finished here.
 */
export function completeGarageHousehold(
  prog: ProgressionState,
  weekendKey: string,
  dayKey: string,
  mode: HouseholdMode,
): GarageCompleteResult {
  const rankBefore = rankFor(prog.totalXp);
  const noop: GarageCompleteResult = { next: prog, awarded: 0, rankBefore, rankAfter: rankBefore, stemMissionId: null };
  if (mode !== "found" && mode !== "skipped") return noop;
  if (dayNumber(weekendKey) === null || !DAY_RE.test(dayKey) || dayNumber(dayKey) === null) return noop;
  if (isBuildDayWeekend(weekendKey)) return noop;
  const done = prog.garageDone ?? [];
  if (done.includes(weekendKey)) return noop;
  if (mode === "found" && prog.garageRealLife === false) return noop;
  const stamps = [...new Set([...(prog.workshopDays ?? []), dayKey])].sort();
  const next: ProgressionState = {
    ...prog,
    totalXp: prog.totalXp + GARAGE_XP,
    garageDone: [...done, weekendKey].sort().slice(-GARAGE_DONE_MAX),
    workshopDays: stamps,
    ...(mode === "found"
      ? {
          garageFound: [...(prog.garageFound ?? []), weekendKey].sort().slice(-GARAGE_DONE_MAX),
          garageRealByDay: {
            ...(prog.garageRealByDay ?? {}),
            [dayKey]: [...new Set([...(prog.garageRealByDay?.[dayKey] ?? []), weekendKey])],
          },
        }
      : { garageSkipped: [...(prog.garageSkipped ?? []), weekendKey].sort().slice(-GARAGE_DONE_MAX) }),
  };
  return {
    next,
    awarded: GARAGE_XP,
    rankBefore,
    rankAfter: rankFor(next.totalXp),
    stemMissionId: mode === "found" ? garageMissionId(weekendKey) : null,
  };
}

/**
 * The roof stars (a Garage trophy per finished weekend): gold for a build weekend and for a household weekend that was found, hollow for a household
 * weekend that was skipped, so the roof stays a true picture of real-world effort. With `skipped` (`garageSkipped`, stored when a skip is finished) a
 * hollow star is exactly a finished weekend in that list, whatever the Build Day rule is later. Without it (a caller that does not pass it yet) a skipped
 * one is a finished weekend that is a household weekend and is not in `garageFound`.
 */
export function garageTrophyCounts(
  done: readonly string[] | undefined,
  found: readonly string[] | undefined,
  skipped?: readonly string[] | undefined,
): { gold: number; hollow: number } {
  const all = new Set(done ?? []);
  let hollow = 0;
  if (skipped !== undefined) {
    for (const key of all) if (skipped.includes(key)) hollow++;
  } else {
    const foundSet = new Set(found ?? []);
    for (const key of all) if (!isBuildDayWeekend(key) && !foundSet.has(key)) hollow++;
  }
  return { gold: all.size - hollow, hollow };
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
