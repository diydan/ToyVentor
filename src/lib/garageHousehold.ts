// The household weekends (docs/specs/garage-weekend-spec.md, "Household library drops"; docs/specs/household-library-spec.md): every weekend that is not a
// Build Day names one everyday item to find at home, or a tool weekend; a child who cannot find it can skip by playing "Who's that shape?". Pure helpers
// only, like garage.ts: the rotation, the item and tool jobs for each age group, the drop for the Garage sheet, and the shape game as a pure state machine.
// The library data (`public/kip/household/catalog.json`) is passed in, so nothing here fetches or reads a file and everything is unit-testable.

import {
  bandGroupOf,
  dayNumber,
  FIRST_WEEKEND,
  isBuildDayWeekend,
  weekendOf,
  type BandGroup,
  type GarageDrop,
  type GarageGoal,
  type GarageVariant,
} from "./garage";

/** The fields of a library item this module reads (the catalog has more). */
export interface HouseholdItem {
  id: string;
  label: string;
  tags: readonly string[];
  /** The youngest age band (0 to 5) the item is shown to. */
  minBand: number;
  /** Reads at a glance for ages 2 to 4: the only items the youngest group is asked about. */
  simple: boolean;
  /** cutlery, kitchen, containers, fruit, tools, stationery, toys, bath or home. */
  group: string;
  /** Items whose outline looks like this one's: never a wrong answer beside it. */
  confusableWith: readonly string[];
  built: boolean;
}

/** The oldest band each age group covers, so a group can be asked what its youngest child is allowed to see. */
export const GROUP_MAX_BAND: Record<BandGroup, number> = { tiny: 1, early: 2, mid: 3, older: 5 };

/** The child's band for the age rules: a grown-up-set band 0 to 5, else the middle group (as `bandGroupOf` reads an unset band). */
export function childBand(ageBand: number | null | undefined): number {
  return typeof ageBand === "number" && Number.isFinite(ageBand) ? Math.min(5, Math.max(0, Math.floor(ageBand))) : 2;
}

const isTool = (i: HouseholdItem): boolean => i.tags.includes("garage");

/* ------------------------------------------------------------ rotation */

/**
 * The order household weekends go through the everyday items, written by hand (not the catalog's order): it alternates fruit, kitchen, toys,
 * stationery, bath, containers, home and cutlery, the simple ones of each first, so two weekends in a row are never alike and the first weekends are easy
 * ones. The six tools are not here: they are the tool weekends. An item the catalog gains later is appended after these (`householdOrder`).
 */
export const HOUSEHOLD_ORDER: readonly string[] = [
  "orange", "mug", "ball", "crayon", "toothbrush", "watering_can", "key", "wooden_spoon",
  "lemon", "water_bottle", "yo_yo", "paintbrush", "soap", "potted_plant", "alarm_clock", "fork",
  "banana", "drinking_glass", "flying_disc", "pencil", "sponge", "pencil_case", "desk_lamp", "carrot",
  "cookie_tin", "marble", "marker", "comb", "lunchbox", "apple", "bowl", "toy_brick",
  "eraser", "hairbrush", "avocado", "plate", "spinning_top", "ruler", "flask", "dice",
  "scissors", "jam_jar", "bubble_wand", "glue_stick", "soda_can", "toy_sword", "stapler", "cereal_box",
  "board_game", "tape_dispenser", "jigsaw", "notebook", "playing_cards", "book",
];

/** Every Nth household weekend is a tool weekend (the items tagged `garage`). */
export const TOOL_WEEKEND_EVERY = 8;

/** The built everyday items in weekend order: the authored list, then anything the catalog gained since (in its own order). Tools are left out. */
export function householdOrder(items: readonly HouseholdItem[]): string[] {
  const usable = new Map(items.filter((i) => i.built && !isTool(i)).map((i) => [i.id, i]));
  const listed = HOUSEHOLD_ORDER.filter((id) => usable.has(id));
  const rest = [...usable.keys()].filter((id) => !HOUSEHOLD_ORDER.includes(id));
  return [...listed, ...rest];
}

const floorMod = (a: number, n: number): number => ((a % n) + n) % n;

/** Whole weeks from the first weekend to this one's Friday (negative before launch), or null for a date that is not one. */
function weeksSinceFirst(weekendKey: string): number | null {
  const w = weekendOf(weekendKey);
  const n = w ? dayNumber(w.weekendKey) : null;
  const first = dayNumber(FIRST_WEEKEND);
  if (n === null || first === null) return null;
  return Math.round((n - first) / 7);
}

const fridayKeyOfWeek = (weeks: number): string => new Date((dayNumber(FIRST_WEEKEND)! + weeks * 7) * 86_400_000).toISOString().slice(0, 10);

const indexCache = new Map<number, number>();

/**
 * How many household weekends came before this one (0 for the first), or null when this weekend is a Build Day (every weekend before launch is one).
 * Counted one weekend at a time from the first weekend, so it is exact whatever the calendar does.
 */
export function householdIndex(weekendKey: string): number | null {
  const weeks = weeksSinceFirst(weekendKey);
  if (weeks === null || weeks < 0 || isBuildDayWeekend(weekendKey)) return null;
  const cached = indexCache.get(weeks);
  if (cached !== undefined) return cached;
  let n = 0;
  for (let w = 0; w < weeks; w++) if (!isBuildDayWeekend(fridayKeyOfWeek(w))) n++;
  indexCache.set(weeks, n);
  return n;
}

export type HouseholdPlan =
  | { kind: "item"; weekendKey: string; index: number; itemId: string }
  | { kind: "tools"; weekendKey: string; index: number };

/**
 * What a weekend is: null on a Build Day; a tool weekend on every TOOL_WEEKEND_EVERY-th household weekend; else one everyday item from the authored
 * order. A pure function of the weekend and the catalog: the same on every device, offline, no randomness, and never the same item twice running.
 */
export function householdPlan(weekendKey: string, items: readonly HouseholdItem[]): HouseholdPlan | null {
  const index = householdIndex(weekendKey);
  if (index === null) return null;
  const friday = weekendOf(weekendKey)!.weekendKey;
  if (floorMod(index, TOOL_WEEKEND_EVERY) === TOOL_WEEKEND_EVERY - 1) return { kind: "tools", weekendKey: friday, index };
  const order = householdOrder(items);
  if (order.length === 0) return null;
  const itemIndex = index - Math.floor((index + 1) / TOOL_WEEKEND_EVERY);
  return { kind: "item", weekendKey: friday, index, itemId: order[floorMod(itemIndex, order.length)]! };
}

/** May a child in this band be asked about this item? Never above its `minBand`; the youngest group only the simple items. */
export function allowedForBand(item: HouseholdItem, band: number): boolean {
  if (!item.built || item.minBand > band) return false;
  return bandGroupOf(band) !== "tiny" || item.simple;
}

/**
 * The item a weekend asks one age group to find. The weekend's item for everyone it suits; for a group it does not (a sharp-looking item before band 3,
 * a hard one for the youngest) the next item in the authored order that does, so no child is ever asked for something that is not for them.
 */
export function weekendItemFor(baseId: string, group: BandGroup, items: readonly HouseholdItem[]): HouseholdItem {
  const byId = new Map(items.map((i) => [i.id, i]));
  const order = householdOrder(items);
  const start = Math.max(0, order.indexOf(baseId));
  const band = GROUP_MAX_BAND[group];
  for (let step = 0; step < order.length; step++) {
    const item = byId.get(order[(start + step) % order.length]!);
    if (item && allowedForBand(item, band)) return item;
  }
  return byId.get(baseId) ?? items[0]!;
}

export interface ToolJob {
  /** How many different tools to find (0: the youngest are not asked to handle one). */
  count: number;
  /** The tools it may be, shown on the sheet. */
  pool: HouseholdItem[];
  /** The youngest: the toy support tool is the picture, and the task is to ask a grown-up to show a tool. */
  toyTool: boolean;
}

/** The tool job for an age group: none for the youngest, 1, 2, then 3 different tools from those the group may see (`minBand` is the data). */
export function toolJob(group: BandGroup, items: readonly HouseholdItem[]): ToolJob {
  if (group === "tiny") return { count: 0, pool: [], toyTool: true };
  const pool = items.filter((i) => i.built && isTool(i) && i.minBand <= GROUP_MAX_BAND[group]);
  return { count: group === "early" ? 1 : group === "mid" ? 2 : 3, pool, toyTool: false };
}

/* ---------------------------------------------------------- the drop */

const PHRASES: Record<string, string> = {
  scissors: "a pair of scissors",
  pliers: "a pair of pliers",
  dice: "a die",
  playing_cards: "a pack of playing cards",
  soap: "a bar of soap",
  jigsaw: "a jigsaw piece",
};

/** "a spoon", "an orange": the item as a child reads it in "Find ...". */
export function findPhrase(item: HouseholdItem): string {
  const override = PHRASES[item.id];
  if (override) return override;
  const name = item.label.toLowerCase();
  return `${/^[aeiou]/.test(name) ? "an" : "a"} ${name}`;
}

const SKIP_NOTE = "Skipping earns XP but no play time.";

function itemVariant(group: BandGroup, item: HouseholdItem): GarageVariant {
  const phrase = findPhrase(item);
  const goal: GarageGoal = { kind: "household", items: [item.id], count: 1 };
  if (group === "tiny") return { title: `Find ${phrase}!`, brief: "Look around. Show a grown-up.", goal };
  if (group === "early") return { title: `Find ${phrase}`, brief: "Look around your home, then show a grown-up.", goal };
  if (group === "mid") return { title: `Find ${phrase}`, brief: "Find one at home and show a grown-up. Can't find one? Play “Who's that shape?”.", goal };
  return { title: `Find ${phrase}`, brief: `Find one at home and show a grown-up. ${SKIP_NOTE}`, goal };
}

function toolsVariant(group: BandGroup, items: readonly HouseholdItem[]): GarageVariant {
  const job = toolJob(group, items);
  const names = job.pool.map((t) => t.label.toLowerCase()).join(", ");
  const goal: GarageGoal = { kind: "household", items: job.pool.map((t) => t.id), count: job.count, ...(job.toyTool ? { toyTool: true } : {}) };
  if (group === "tiny") return { title: "Tool time!", brief: "Ask a grown-up to show you a tool.", goal };
  if (group === "early") return { title: "Find a tool", brief: `Ask a grown-up first. Then find a tool: ${names}.`, goal };
  if (group === "mid") return { title: "Find two tools", brief: `Find two different tools: ${names}.`, goal };
  return { title: "Find three tools", brief: `Find three different tools from these: ${names}. ${SKIP_NOTE}`, goal };
}

/**
 * The Garage drop for a household weekend, or null on a Build Day. It is a drop of the existing "idea" kind with the household goal, a variant written
 * for each age group (built from templates, not written 60 times), and no loaner: nothing is equipped.
 */
export function householdDropFor(weekendKey: string, items: readonly HouseholdItem[]): GarageDrop | null {
  const plan = householdPlan(weekendKey, items);
  if (!plan) return null;
  const groups: BandGroup[] = ["tiny", "early", "mid", "older"];
  if (plan.kind === "tools") {
    return {
      id: "household-tools",
      kind: "idea",
      household: { kind: "tools" },
      byGroup: Object.fromEntries(groups.map((g) => [g, toolsVariant(g, items)])) as Record<BandGroup, GarageVariant>,
    };
  }
  return {
    id: `household-${plan.itemId}`,
    kind: "idea",
    household: { kind: "item", itemId: plan.itemId },
    byGroup: Object.fromEntries(groups.map((g) => [g, itemVariant(g, weekendItemFor(plan.itemId, g, items))])) as Record<BandGroup, GarageVariant>,
  };
}

/* ------------------------------------------------- Who's that shape? */

/** Pictures to pick from, and right answers in a row to finish, by age group (the spec's table; the numbers are Dan's to change). */
export const SHAPE_CHOICES: Record<BandGroup, number> = { tiny: 2, early: 3, mid: 4, older: 4 };
export const SHAPE_NEED: Record<BandGroup, number> = { tiny: 2, early: 2, mid: 3, older: 3 };
/** Wrong taps before the picture gains its colours, and before the name is shown and the right picture highlighted. */
export const SHAPE_COLOUR_AFTER = 3;
export const SHAPE_NAME_AFTER = 5;

/** What the shape game needs from the library: the everyday items, the support tool(s) (which may be a target, never a wrong answer) and a random source. */
export interface ShapeContext {
  items: readonly HouseholdItem[];
  support: readonly HouseholdItem[];
  /** 0 <= value < 1. Injected so a test is deterministic; the app passes Math.random. */
  rng: () => number;
}

export interface ShapeState {
  group: BandGroup;
  band: number;
  /** Right answers in a row to finish, and pictures to pick from. */
  need: number;
  count: number;
  /** Right answers in a row so far. */
  streak: number;
  /** Wrong taps so far in this game: never reset, so a hint, once earned, stays. */
  misses: number;
  /** 0 the silhouette alone, 1 it gains its colours, 2 its name is shown and the right picture is highlighted. */
  level: 0 | 1 | 2;
  round: number;
  /** The item whose silhouette is shown, and the pictures to pick from (it is one of them, unmarked). */
  target: string;
  choices: string[];
  /** Targets already asked, so the game does not repeat one until it has to. */
  used: string[];
  /** The picture the child tapped wrong last (to shake it); never the right one. */
  lastWrong: string | null;
  /** Set only at level 2: the right picture. At lower levels the state does not say which is right. */
  highlight: string | null;
  nameShown: boolean;
  done: boolean;
}

function shuffled<T>(list: readonly T[], rng: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * The wrong pictures for a target: from the target's own group first, then topped up from everything the child may be asked about; never an item that
 * looks like the target, never one above the child's band, and for the youngest only simple items. If the data ever leaves too few, the rest are filled
 * from the look-alikes rather than failing the game (the library build refuses a catalog that leaves fewer than three, so this is a safety net).
 */
export function wrongAnswers(target: HouseholdItem, count: number, band: number, ctx: ShapeContext): string[] {
  const pool = ctx.items.filter((i) => i.id !== target.id && allowedForBand(i, band));
  const free = pool.filter((i) => !target.confusableWith.includes(i.id) && !i.confusableWith.includes(target.id));
  const sameGroup = shuffled(free.filter((i) => i.group === target.group), ctx.rng);
  const others = shuffled(free.filter((i) => i.group !== target.group), ctx.rng);
  const picked = [...sameGroup, ...others].slice(0, count);
  if (picked.length < count) {
    const lookAlikes = shuffled(pool.filter((i) => !picked.includes(i)), ctx.rng);
    picked.push(...lookAlikes.slice(0, count - picked.length));
  }
  return picked.map((i) => i.id);
}

const levelFor = (misses: number): 0 | 1 | 2 => (misses >= SHAPE_NAME_AFTER ? 2 : misses >= SHAPE_COLOUR_AFTER ? 1 : 0);

function lookup(ctx: ShapeContext, id: string): HouseholdItem | undefined {
  return ctx.items.find((i) => i.id === id) ?? ctx.support.find((i) => i.id === id);
}

function newRound(prev: Pick<ShapeState, "group" | "band" | "need" | "count" | "streak" | "misses" | "round" | "used">, target: HouseholdItem, ctx: ShapeContext): ShapeState {
  const level = levelFor(prev.misses);
  const wrong = wrongAnswers(target, prev.count - 1, prev.band, ctx);
  return {
    group: prev.group,
    band: prev.band,
    need: prev.need,
    count: prev.count,
    streak: prev.streak,
    misses: prev.misses,
    level,
    round: prev.round + 1,
    target: target.id,
    choices: shuffled([target.id, ...wrong], ctx.rng),
    used: [...prev.used, target.id],
    lastWrong: null,
    highlight: level === 2 ? target.id : null,
    nameShown: level === 2,
    done: false,
  };
}

/** The next target: any item the child may be asked about that has not been asked yet (all of them again once they have), and never the one just asked. */
function nextTarget(state: Pick<ShapeState, "band" | "used" | "target">, ctx: ShapeContext): HouseholdItem {
  const pool = ctx.items.filter((i) => allowedForBand(i, state.band) && i.id !== state.target);
  const fresh = pool.filter((i) => !state.used.includes(i.id));
  const from = fresh.length > 0 ? fresh : pool;
  return from[Math.min(from.length - 1, Math.floor(ctx.rng() * from.length))]!;
}

/** Begin the game. `firstTarget` is the weekend's item (or the support tool, or a tool, on a tool weekend). */
export function startShape(ctx: ShapeContext, input: { ageBand: number | null | undefined; firstTarget: string }): ShapeState {
  const band = childBand(input.ageBand);
  const group = bandGroupOf(band);
  const target = lookup(ctx, input.firstTarget) ?? nextTarget({ band, used: [], target: "" }, ctx);
  return newRound({ group, band, need: SHAPE_NEED[group], count: SHAPE_CHOICES[group], streak: 0, misses: 0, round: 0, used: [] }, target, ctx);
}

/**
 * The child taps a picture. Right: one more in a row, a new item, and done when `need` are in a row. Wrong, for the youngest: the same item again, so
 * the child learns why; for the others: the streak starts over with a different item and nothing says which was right. Either way it counts a miss, and
 * enough misses hand out hints that never complete the game for the child: after SHAPE_COLOUR_AFTER the picture gains its colours; after SHAPE_NAME_AFTER
 * its name is shown and the right picture is highlighted, and the child still has to tap it. Only a right tap can ever add to the streak, so no run of
 * wrong taps finishes the game. Tapping a picture that is not among the choices changes nothing.
 */
export function tapShape(state: ShapeState, pickedId: string, ctx: ShapeContext): ShapeState {
  if (state.done || !state.choices.includes(pickedId)) return state;
  if (pickedId === state.target) {
    const streak = state.streak + 1;
    if (streak >= state.need) return { ...state, streak, lastWrong: null, done: true };
    return newRound({ ...state, streak }, nextTarget(state, ctx), ctx);
  }
  const misses = state.misses + 1;
  const level = levelFor(misses);
  if (state.group === "tiny") {
    return { ...state, misses, level, lastWrong: pickedId, highlight: level === 2 ? state.target : null, nameShown: level === 2 };
  }
  return { ...newRound({ ...state, streak: 0, misses }, nextTarget(state, ctx), ctx), lastWrong: pickedId };
}

/**
 * The item whose name the game should say aloud now, or null: when the name has just been shown (the level reached 2, or a new round began at level 2).
 * The game calls `speakName` with it. Pure, so a test can see exactly when.
 */
export function shapeSpeech(prev: ShapeState | null, next: ShapeState): string | null {
  if (!next.nameShown || next.done) return null;
  return prev === null || !prev.nameShown || prev.target !== next.target ? next.target : null;
}

/**
 * Say an item's name aloud. A deliberate NO-OP for now: the game's spoken names are a controlled vocabulary (src/lib/propNames.ts) and the household
 * names are not in it yet; the main session adds them through the voice route. Where the shape game reaches level 2 it calls this, and nothing else
 * has to change when the voice arrives.
 */
export function speakName(_itemId: string): void {
  // intentionally empty
}
