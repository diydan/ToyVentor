// The household weekends (docs/specs/garage-weekend-spec.md, "Household library drops"): the rotation, the age rules, the shape game, the completion and the
// roof stars. The library data is the real, committed one (public/kip/household/catalog.json), so a catalog change that breaks a rule fails here.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { completeRealLifeChore, CHORE_QUEST_XP, REAL_LIFE_CHORES } from "../src/lib/dailyQuests";
import {
  BAND_GROUPS,
  bandGroupOf,
  checkGoal,
  completeGarage,
  completeGarageHousehold,
  completeGarageReal,
  dayKeyOf,
  dayNumber,
  dropForWeekend,
  FIRST_WEEKEND,
  GARAGE_DROPS,
  GARAGE_REAL_XP,
  GARAGE_XP,
  garageMissionId,
  garageStatus,
  garageTrophyCounts,
  isBuildDayWeekend,
  loanKeys,
  type BandGroup,
} from "../src/lib/garage";
import {
  allowedForBand,
  childBand,
  findPhrase,
  GROUP_MAX_BAND,
  HOUSEHOLD_ORDER,
  householdDropFor,
  householdIndex,
  householdOrder,
  householdPlan,
  SHAPE_CHOICES,
  SHAPE_COLOUR_AFTER,
  SHAPE_NAME_AFTER,
  SHAPE_NEED,
  shapeSpeech,
  nameToSay,
  startShape,
  tapShape,
  TOOL_WEEKEND_EVERY,
  toolJob,
  weekendItemFor,
  wrongAnswers,
  type HouseholdItem,
  type ShapeContext,
  type ShapeState,
} from "../src/lib/garageHousehold";
import { NodeArt } from "../src/features/game/world/ExplorerNodeArt";
import { buildExplorerGraph } from "../src/lib/explorerMap";
import { buildMapCards } from "../src/lib/mapCards";
import { emptyProgression, mergeProgression, normalizeProgression, resetProgression, type ProgressionState } from "../src/lib/progression";

const ROOT = resolve(__dirname, "..");
const CATALOG = JSON.parse(readFileSync(join(ROOT, "public/kip/household/catalog.json"), "utf8")) as { items: HouseholdItem[]; support: HouseholdItem[] };
const ITEMS = CATALOG.items;
const SUPPORT = CATALOG.support;
const byId = new Map(ITEMS.map((i) => [i.id, i]));

const prog = (over: Partial<ProgressionState> = {}): ProgressionState => ({ ...emptyProgression(), ...over });

/** A small seeded random source (mulberry32), so every run of a test sees the same game. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ctxOf = (seed = 1): ShapeContext => ({ items: ITEMS, support: SUPPORT, rng: seeded(seed) });

/** Every Friday from the first weekend for `years` years. */
function fridays(years: number, from = FIRST_WEEKEND): string[] {
  const out: string[] = [];
  const n0 = dayNumber(from)!;
  for (let w = 0; w < years * 52; w++) out.push(dayKeyOf(n0 + w * 7));
  return out;
}
const HOUSEHOLD_FRIDAYS = fridays(6).filter((k) => !isBuildDayWeekend(k));

/* ------------------------------------------------------------ rotation */

describe("Build Days and household weekends", () => {
  it("makes the first weekend of every month a Build Day: the Friday's day of the month is 1 to 7", () => {
    expect(isBuildDayWeekend(FIRST_WEEKEND)).toBe(true); // 2026-11-06, the launch weekend
    expect(isBuildDayWeekend("2026-11-13")).toBe(false);
    expect(isBuildDayWeekend("2026-11-20")).toBe(false);
    expect(isBuildDayWeekend("2026-11-27")).toBe(false);
    expect(isBuildDayWeekend("2026-12-04")).toBe(true);
    expect(isBuildDayWeekend("2027-01-01")).toBe(true); // a Friday that is the 1st
    expect(isBuildDayWeekend("2027-01-08")).toBe(false); // the 8th is already the second weekend
  });

  it("has exactly one Build Day in every calendar month, six years through", () => {
    const perMonth = new Map<string, number>();
    for (const k of fridays(6)) if (isBuildDayWeekend(k)) perMonth.set(k.slice(0, 7), (perMonth.get(k.slice(0, 7)) ?? 0) + 1);
    expect(perMonth.size).toBe(72);
    for (const [month, n] of perMonth) expect(n, month).toBe(1);
  });

  it("keeps every weekend before launch a build weekend, as it was: the household rule starts with the first weekend", () => {
    for (const k of ["2026-10-30", "2026-10-23", "2026-10-02", "2025-06-13", "2026-10-31", "2026-11-01"]) expect(isBuildDayWeekend(k), k).toBe(true);
    expect(isBuildDayWeekend("2026-11-13")).toBe(false); // the first household weekend
  });

  it("reads a Saturday or a Sunday as its Friday, and anything that is not a date as a Build Day", () => {
    expect(isBuildDayWeekend("2026-11-07")).toBe(true); // Saturday of the launch weekend
    expect(isBuildDayWeekend("2026-11-08")).toBe(true);
    expect(isBuildDayWeekend("2026-11-14")).toBe(false); // Saturday of a household weekend
    expect(isBuildDayWeekend("2026-11-15")).toBe(false);
    for (const bad of ["", "soon", "2026-02-30", "2026-11-6"]) expect(isBuildDayWeekend(bad), bad).toBe(true);
  });

  it("leaves the build rotation as it was on Build Days: no drop twice running, every drop in the first twelve, and a repeat is at least three Build Days away", () => {
    const builds = fridays(8).filter(isBuildDayWeekend);
    expect(dropForWeekend(FIRST_WEEKEND)).toBe(GARAGE_DROPS[0]);
    expect(dropForWeekend("2026-12-04")).toBe(GARAGE_DROPS[4]); // four weeks after the first: the old formula, unchanged
    const ids = builds.map((k) => dropForWeekend(k).id);
    for (let i = 1; i < ids.length; i++) expect(ids[i], `build day ${i}`).not.toBe(ids[i - 1]);
    expect(new Set(ids.slice(0, GARAGE_DROPS.length)).size, "the first twelve Build Days show every drop").toBe(GARAGE_DROPS.length);
    // The formula counts weekends, and a month has four or five of them, so after the first year a drop can come back sooner than twelve Build Days
    // later. Measured over eight years: most repeats are 11 to 14 Build Days apart, the nearest is 3 (a month-by-month count would make it exactly 12).
    const last = new Map<string, number>();
    const gaps: number[] = [];
    ids.forEach((id, i) => {
      if (last.has(id)) gaps.push(i - last.get(id)!);
      last.set(id, i);
    });
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(3);
    expect(gaps.filter((g) => g >= 11).length / gaps.length).toBeGreaterThan(0.85);
  });
});

describe("household weekend numbers", () => {
  it("is null on a Build Day and counts household weekends from the first one", () => {
    expect(householdIndex(FIRST_WEEKEND)).toBeNull();
    expect(householdIndex("2026-11-13")).toBe(0);
    expect(householdIndex("2026-11-20")).toBe(1);
    expect(householdIndex("2026-11-27")).toBe(2);
    expect(householdIndex("2026-12-04")).toBeNull();
    expect(householdIndex("2026-12-11")).toBe(3);
    expect(householdIndex("nonsense")).toBeNull();
  });

  it("counts every household weekend once, one after the other, from launch for eight years", () => {
    const keys = fridays(8).filter((k) => !isBuildDayWeekend(k));
    const nums = keys.map((k) => householdIndex(k)!);
    expect(nums[0]).toBe(0);
    for (let i = 1; i < nums.length; i++) expect(nums[i], keys[i]).toBe(nums[i - 1]! + 1);
  });

  it("has no number for a weekend before launch", () => {
    for (const k of ["2026-10-30", "2026-10-23", "2025-01-03"]) expect(householdIndex(k), k).toBeNull();
  });

  it("gives a Saturday and a Sunday their Friday's number", () => {
    expect(householdIndex("2026-11-14")).toBe(0);
    expect(householdIndex("2026-11-15")).toBe(0);
  });
});

describe("what a household weekend is", () => {
  it("is nothing on a Build Day", () => {
    expect(householdPlan(FIRST_WEEKEND, ITEMS)).toBeNull();
    expect(householdDropFor(FIRST_WEEKEND, ITEMS)).toBeNull();
  });

  it("starts with the first authored item and goes through the authored order", () => {
    const first = householdPlan("2026-11-13", ITEMS)!;
    expect(first).toMatchObject({ kind: "item", index: 0, itemId: HOUSEHOLD_ORDER[0] });
    const items = HOUSEHOLD_FRIDAYS.map((k) => householdPlan(k, ITEMS)!).filter((p) => p.kind === "item");
    for (let i = 0; i < 20; i++) expect((items[i] as { itemId: string }).itemId).toBe(householdOrder(ITEMS)[i]);
  });

  it("makes every 8th household weekend a tool weekend, and no other", () => {
    HOUSEHOLD_FRIDAYS.forEach((k, n) => {
      const plan = householdPlan(k, ITEMS)!;
      expect(plan.kind === "tools", `weekend ${n}`).toBe(n % TOOL_WEEKEND_EVERY === TOOL_WEEKEND_EVERY - 1);
    });
    expect(TOOL_WEEKEND_EVERY).toBe(8);
  });

  it("never asks for the same item two household weekends running, and shows every item before it repeats one", () => {
    const seq = HOUSEHOLD_FRIDAYS.map((k) => householdPlan(k, ITEMS)!).filter((p) => p.kind === "item").map((p) => (p as { itemId: string }).itemId);
    for (let i = 1; i < seq.length; i++) expect(seq[i], `weekend ${i}`).not.toBe(seq[i - 1]);
    const n = householdOrder(ITEMS).length;
    expect(new Set(seq.slice(0, n)).size, "the first full cycle has no repeat").toBe(n);
    for (let i = 0; i < seq.length - n; i++) expect(seq[i + n], `cycle at ${i}`).toBe(seq[i]);
  });

  it("is the same on every device: a pure function of the weekend and the catalog, whichever day of the weekend", () => {
    expect(householdPlan("2026-11-13", [...ITEMS].reverse())).toEqual(householdPlan("2026-11-13", ITEMS)); // the catalog's own order does not matter
    expect(householdPlan("2026-11-14", ITEMS)).toEqual(householdPlan("2026-11-13", ITEMS));
    expect(householdPlan("2026-11-15", ITEMS)).toEqual(householdPlan("2026-11-13", ITEMS));
  });

  it("keeps the authored order honest: real items, none repeated, no tool, and every everyday item is in it", () => {
    expect(new Set(HOUSEHOLD_ORDER).size).toBe(HOUSEHOLD_ORDER.length);
    for (const id of HOUSEHOLD_ORDER) {
      expect(byId.has(id), id).toBe(true);
      expect(byId.get(id)!.tags, id).not.toContain("garage");
    }
    const everyday = ITEMS.filter((i) => i.built && !i.tags.includes("garage")).map((i) => i.id).sort();
    expect([...HOUSEHOLD_ORDER].sort(), "an item the catalog has but the list lacks").toEqual(everyday);
    expect(householdOrder(ITEMS)).toEqual([...HOUSEHOLD_ORDER]);
  });

  it("appends an item the catalog gains later, and leaves out one that is not built", () => {
    const extra: HouseholdItem = { ...byId.get("ball")!, id: "new_thing", label: "New thing" };
    expect(householdOrder([...ITEMS, extra]).at(-1)).toBe("new_thing");
    const unbuilt = ITEMS.map((i) => (i.id === "orange" ? { ...i, built: false } : i));
    expect(householdOrder(unbuilt)).not.toContain("orange");
    expect(householdPlan("2026-11-13", unbuilt)).toMatchObject({ kind: "item", itemId: HOUSEHOLD_ORDER[1] });
  });
});

/* ------------------------------------------------------------ age rules */

describe("the age rules", () => {
  it("reads the child's band, and the middle group when none is set", () => {
    expect(childBand(0)).toBe(0);
    expect(childBand(5)).toBe(5);
    expect(childBand(9)).toBe(5);
    expect(childBand(-3)).toBe(0);
    expect(childBand(undefined)).toBe(2);
    expect(childBand(null)).toBe(2);
    expect(GROUP_MAX_BAND).toEqual({ tiny: 1, early: 2, mid: 3, older: 5 });
    for (const g of BAND_GROUPS) expect(bandGroupOf(GROUP_MAX_BAND[g]), g).toBe(g);
  });

  it("allows an item only from its minBand, and only the simple ones to the youngest", () => {
    const fork = byId.get("fork")!;
    expect(fork.minBand).toBe(3);
    expect(allowedForBand(fork, 2)).toBe(false);
    expect(allowedForBand(fork, 3)).toBe(true);
    const comb = byId.get("comb")!;
    expect(comb.simple).toBe(false);
    expect(allowedForBand(comb, 1)).toBe(false); // not simple: not for the youngest
    expect(allowedForBand(comb, 2)).toBe(true);
    expect(allowedForBand(byId.get("ball")!, 0)).toBe(true);
    expect(allowedForBand({ ...byId.get("ball")!, built: false }, 5)).toBe(false);
  });

  it("never asks a child for something that is not for them: every weekend item, every group", () => {
    for (const k of HOUSEHOLD_FRIDAYS.slice(0, 120)) {
      const plan = householdPlan(k, ITEMS)!;
      if (plan.kind !== "item") continue;
      for (const g of BAND_GROUPS) {
        const it = weekendItemFor(plan.itemId, g, ITEMS);
        expect(allowedForBand(it, GROUP_MAX_BAND[g]), `${plan.itemId} for ${g} became ${it.id}`).toBe(true);
        if (g === "tiny" || g === "early") expect(it.tags, `${it.id} for ${g}`).not.toContain("sharp-looking");
        if (g === "tiny") expect(it.simple, `${it.id} for the youngest`).toBe(true);
        if (g === "older") expect(it.id).toBe(plan.itemId); // the oldest are asked the weekend's item itself
      }
    }
  });

  it("gives the youngest the next simple item when the weekend's is not for them, and keeps it when it is", () => {
    expect(weekendItemFor("ball", "tiny", ITEMS).id).toBe("ball");
    const forTiny = weekendItemFor("fork", "tiny", ITEMS);
    expect(forTiny.id).not.toBe("fork");
    expect(forTiny.simple).toBe(true);
    expect(weekendItemFor("fork", "early", ITEMS).tags).not.toContain("sharp-looking");
    expect(weekendItemFor("fork", "mid", ITEMS).id).toBe("fork");
  });

  it("sets a tool job: none for the youngest (the toy tool is the picture), then 1, 2, 3 different tools from those the group may see", () => {
    expect(toolJob("tiny", ITEMS)).toEqual({ count: 0, pool: [], toyTool: true });
    const early = toolJob("early", ITEMS);
    const mid = toolJob("mid", ITEMS);
    const older = toolJob("older", ITEMS);
    expect([early.count, mid.count, older.count]).toEqual([1, 2, 3]);
    expect(early.pool.map((t) => t.id).sort()).toEqual(["bucket", "flashlight", "hammer", "pliers", "tape_measure"]); // five: the screwdriver is band 3
    expect(mid.pool.map((t) => t.id).sort()).toEqual(["bucket", "flashlight", "hammer", "pliers", "screwdriver", "tape_measure"]);
    expect(older.pool).toEqual(mid.pool);
    for (const j of [early, mid, older]) {
      expect(j.toyTool).toBe(false);
      expect(j.pool.length).toBeGreaterThanOrEqual(j.count);
    }
    expect(early.pool.some((t) => t.tags.includes("sharp-looking"))).toBe(false);
  });

  it("reads the pool from the data: a tool made band 4 leaves the mid group's pool", () => {
    const edited = ITEMS.map((i) => (i.id === "hammer" ? { ...i, minBand: 4 } : i));
    expect(toolJob("mid", edited).pool.map((t) => t.id)).not.toContain("hammer");
    expect(toolJob("older", edited).pool.map((t) => t.id)).toContain("hammer");
  });
});

/* ------------------------------------------------------------ the drop */

describe("the household drop", () => {
  const itemWeekend = "2026-11-13";
  const toolWeekend = HOUSEHOLD_FRIDAYS.find((k) => householdPlan(k, ITEMS)!.kind === "tools")!;

  it("is a drop of the idea kind with a household goal, a version for every age group and no loaner", () => {
    const drop = householdDropFor(itemWeekend, ITEMS)!;
    expect(drop.kind).toBe("idea");
    expect(drop.id).toBe(`household-${HOUSEHOLD_ORDER[0]}`);
    expect(drop.household).toEqual({ kind: "item", itemId: HOUSEHOLD_ORDER[0] });
    expect(loanKeys(drop)).toEqual([]);
    for (const g of BAND_GROUPS) {
      const v = drop.byGroup[g];
      expect(v.title.length).toBeGreaterThan(0);
      expect(v.brief.length).toBeGreaterThan(0);
      expect(v.goal).toMatchObject({ kind: "household", count: 1 });
    }
    expect(drop.byGroup.tiny.title).toBe("Find an orange!");
    expect(drop.byGroup.early.title).toBe("Find an orange");
  });

  it("is never met by a build: the household goal never checks as done", () => {
    const drop = householdDropFor(itemWeekend, ITEMS)!;
    const build = { type: "character", sel: { hat: "crown" }, stats: ["speed", "spin", "glow", "torque"] as const };
    for (const g of BAND_GROUPS) expect(checkGoal(drop.byGroup[g].goal, build as never).ok).toBe(false);
  });

  it("writes a tool weekend: the toy tool for the youngest, then one, two, three tools, naming what counts", () => {
    const drop = householdDropFor(toolWeekend, ITEMS)!;
    expect(drop.id).toBe("household-tools");
    expect(drop.household).toEqual({ kind: "tools" });
    expect(drop.byGroup.tiny.goal).toEqual({ kind: "household", items: [], count: 0, toyTool: true });
    expect(drop.byGroup.tiny.brief).toBe("Ask a grown-up to show you a tool.");
    expect((drop.byGroup.early.goal as { count: number }).count).toBe(1);
    expect((drop.byGroup.mid.goal as { count: number }).count).toBe(2);
    expect((drop.byGroup.older.goal as { count: number }).count).toBe(3);
    for (const g of ["early", "mid", "older"] as BandGroup[]) {
      const goal = drop.byGroup[g].goal as unknown as { items: string[] };
      expect(drop.byGroup[g].brief, g).toContain("hammer");
      expect(goal.items.length).toBeGreaterThanOrEqual(5);
    }
    expect(drop.byGroup.early.brief).not.toContain("screwdriver"); // not before band 3
    expect(drop.byGroup.mid.brief).toContain("screwdriver");
    expect(drop.byGroup.older.brief).toContain("no play time"); // honest about what a skip pays
  });

  it("never names a sharp-looking item to the two younger groups, over three years of weekends", () => {
    const sharp = new Set(ITEMS.filter((i) => i.tags.includes("sharp-looking")).map((i) => i.label.toLowerCase()));
    for (const k of HOUSEHOLD_FRIDAYS.slice(0, 160)) {
      const drop = householdDropFor(k, ITEMS)!;
      for (const g of ["tiny", "early"] as BandGroup[]) {
        const text = `${drop.byGroup[g].title} ${drop.byGroup[g].brief}`.toLowerCase();
        for (const s of sharp) expect(text.includes(s), `${k} ${g}: ${text}`).toBe(false);
      }
    }
  });

  it("says what to find in a child's words", () => {
    expect(findPhrase(byId.get("orange")!)).toBe("an orange");
    expect(findPhrase(byId.get("wooden_spoon")!)).toBe("a wooden spoon");
    expect(findPhrase(byId.get("scissors")!)).toBe("a pair of scissors");
    expect(findPhrase(byId.get("pliers")!)).toBe("a pair of pliers");
    expect(findPhrase(byId.get("dice")!)).toBe("a die");
    expect(findPhrase(byId.get("alarm_clock")!)).toBe("an alarm clock");
  });
});

/* ------------------------------------------------------ Who's that shape? */

describe("Who's that shape?", () => {
  it("offers 2, 3, 4, 4 pictures and wants 2, 2, 3, 3 right in a row, by age group", () => {
    expect(BAND_GROUPS.map((g) => SHAPE_CHOICES[g])).toEqual([2, 3, 4, 4]);
    expect(BAND_GROUPS.map((g) => SHAPE_NEED[g])).toEqual([2, 2, 3, 3]);
    expect([SHAPE_COLOUR_AFTER, SHAPE_NAME_AFTER]).toEqual([3, 5]);
    for (const [band, group] of [[0, "tiny"], [1, "tiny"], [2, "early"], [3, "mid"], [4, "older"], [5, "older"]] as const) {
      const s = startShape(ctxOf(), { ageBand: band, firstTarget: "ball" });
      expect(s.group, `band ${band}`).toBe(group);
      expect(s.choices).toHaveLength(SHAPE_CHOICES[group]);
      expect(s.need).toBe(SHAPE_NEED[group]);
    }
    expect(startShape(ctxOf(), { ageBand: undefined, firstTarget: "ball" }).group).toBe("early");
  });

  it("starts with the weekend's item among the pictures, unmarked, with nothing said about which is right", () => {
    const s = startShape(ctxOf(), { ageBand: 4, firstTarget: "wooden_spoon" });
    expect(s.target).toBe("wooden_spoon");
    expect(s.choices).toContain("wooden_spoon");
    expect(s).toMatchObject({ streak: 0, misses: 0, level: 0, highlight: null, nameShown: false, done: false, lastWrong: null });
    expect(new Set(s.choices).size).toBe(s.choices.length);
  });

  it("can ask about the toy support tool, which is never a wrong answer", () => {
    const s = startShape(ctxOf(), { ageBand: 1, firstTarget: "support_tool" });
    expect(s.target).toBe("support_tool");
    expect(s.choices).toContain("support_tool");
    for (let seed = 1; seed < 60; seed++) {
      const g = startShape(ctxOf(seed), { ageBand: 4, firstTarget: "ball" });
      expect(g.choices).not.toContain("support_tool");
    }
  });

  describe("the wrong pictures", () => {
    it("never look like the answer, never above the child's band, and the youngest see only simple items: every item, every band", () => {
      for (const target of ITEMS) {
        for (let band = 0; band <= 5; band++) {
          if (!allowedForBand(target, band) && band < target.minBand) continue;
          const wrong = wrongAnswers(target, SHAPE_CHOICES[bandGroupOf(band)] - 1, band, ctxOf(band * 100 + 7));
          expect(wrong, `${target.id} at band ${band}`).toHaveLength(SHAPE_CHOICES[bandGroupOf(band)] - 1);
          expect(new Set(wrong).size).toBe(wrong.length);
          for (const id of wrong) {
            const w = byId.get(id)!;
            expect(id).not.toBe(target.id);
            expect(target.confusableWith, `${target.id} / ${id}`).not.toContain(id);
            expect(w.confusableWith, `${id} / ${target.id}`).not.toContain(target.id);
            expect(w.minBand, `${id} at band ${band}`).toBeLessThanOrEqual(band);
            if (bandGroupOf(band) === "tiny") expect(w.simple, `${id} for the youngest`).toBe(true);
          }
        }
      }
    });

    it("come from the answer's own group first, and are topped up from everything allowed when the group is too small", () => {
      // a fork (cutlery, a group of two) among four pictures: its one same-group mate (the spoon) first, the rest from elsewhere
      const fork = byId.get("fork")!;
      const wrong = wrongAnswers(fork, 3, 4, ctxOf(5));
      expect(wrong).toContain("wooden_spoon");
      expect(wrong).toHaveLength(3);
      // a toothbrush (bath, five items): three same-group wrong answers exist, so all come from the bath
      const brush = byId.get("toothbrush")!;
      const bath = wrongAnswers(brush, 3, 4, ctxOf(5));
      for (const id of bath) expect(byId.get(id)!.group, id).toBe("bath");
    });

    it("keep a fork out for a five-year-old, and a tool out for the youngest", () => {
      for (let seed = 1; seed < 80; seed++) {
        expect(wrongAnswers(byId.get("wooden_spoon")!, 2, 2, ctxOf(seed)), "band 2").not.toContain("fork");
        for (const id of wrongAnswers(byId.get("ball")!, 1, 0, ctxOf(seed))) expect(byId.get(id)!.tags, id).toEqual([]);
      }
    });

    it("are the same for the same random source, and differ with another", () => {
      const a = startShape(ctxOf(11), { ageBand: 4, firstTarget: "apple" });
      const b = startShape(ctxOf(11), { ageBand: 4, firstTarget: "apple" });
      expect(a).toEqual(b);
      const seen = new Set<string>();
      for (let seed = 1; seed < 40; seed++) seen.add(startShape(ctxOf(seed), { ageBand: 4, firstTarget: "apple" }).choices.join());
      expect(seen.size).toBeGreaterThan(5);
    });

    it("fall back to look-alikes only when the data leaves too few, rather than failing", () => {
      const allAlike = ITEMS.map((i) => ({ ...i, confusableWith: ITEMS.map((o) => o.id).filter((o) => o !== i.id) }));
      const wrong = wrongAnswers(allAlike.find((i) => i.id === "apple")!, 3, 4, { items: allAlike, support: SUPPORT, rng: seeded(2) });
      expect(wrong).toHaveLength(3);
    });
  });

  describe("playing it", () => {
    const correct = (s: ShapeState, ctx: ShapeContext): ShapeState => tapShape(s, s.target, ctx);
    const wrongPick = (s: ShapeState): string => s.choices.find((c) => c !== s.target)!;

    it("counts a right answer, moves to a different item and finishes after `need` in a row", () => {
      for (const band of [1, 2, 3, 4]) {
        const ctx = ctxOf(band);
        let s = startShape(ctx, { ageBand: band, firstTarget: "ball" });
        const seen = [s.target];
        for (let n = 1; n < s.need; n++) {
          s = correct(s, ctx);
          expect(s.streak, `band ${band}`).toBe(n);
          expect(s.done).toBe(false);
          expect(seen).not.toContain(s.target); // a new item, not the last one again
          seen.push(s.target);
        }
        s = correct(s, ctx);
        expect(s.done).toBe(true);
        expect(s.streak).toBe(s.need);
        expect(tapShape(s, s.target, ctx), "a finished game stays finished").toBe(s);
      }
    });

    it("sends the youngest back to the SAME item after a wrong answer, with the same pictures, keeping their streak", () => {
      const ctx = ctxOf(3);
      let s = correct(startShape(ctx, { ageBand: 0, firstTarget: "ball" }), ctx); // one right
      const before = s;
      s = tapShape(s, wrongPick(s), ctx);
      expect(s.target).toBe(before.target);
      expect(s.choices).toEqual(before.choices);
      expect(s.streak).toBe(1);
      expect(s.misses).toBe(1);
      expect(s.lastWrong).not.toBe(before.target);
    });

    it("starts the older groups' streak again with a DIFFERENT item after a wrong answer, and does not say which was right", () => {
      for (const band of [2, 3, 5]) {
        const ctx = ctxOf(band + 40);
        let s = correct(startShape(ctx, { ageBand: band, firstTarget: "ball" }), ctx);
        const before = s;
        s = tapShape(s, wrongPick(s), ctx);
        expect(s.streak, `band ${band}`).toBe(0);
        expect(s.target).not.toBe(before.target);
        expect(s.misses).toBe(1);
        expect(s.highlight).toBeNull();
        expect(s.nameShown).toBe(false);
        expect(s.lastWrong).not.toBeNull();
      }
    });

    it("never asks the same item twice running, even when every item has been asked once", () => {
      const ctx = ctxOf(4);
      const s = startShape(ctx, { ageBand: 4, firstTarget: "ball" });
      const exhausted: ShapeState = { ...s, used: ITEMS.filter((i) => allowedForBand(i, 4)).map((i) => i.id) };
      for (let seed = 1; seed <= 40; seed++) {
        const next = tapShape(exhausted, exhausted.target, ctxOf(seed));
        expect(next.target, `seed ${seed}`).not.toBe(exhausted.target);
      }
    });

    it("ignores a tap on something that is not one of the pictures", () => {
      const ctx = ctxOf(8);
      const s = startShape(ctx, { ageBand: 4, firstTarget: "ball" });
      expect(tapShape(s, "not_an_item", ctx)).toBe(s);
    });

    it("gives its hints in order and keeps them: colours after 3 wrong taps, the name and the right picture after 5, never taken back", () => {
      for (const band of [0, 2, 4]) {
        const ctx = ctxOf(band + 70);
        let s = startShape(ctx, { ageBand: band, firstTarget: "ball" });
        const levels: number[] = [];
        for (let n = 1; n <= 8; n++) {
          s = tapShape(s, wrongPick(s), ctx);
          levels.push(s.level);
          if (n < SHAPE_COLOUR_AFTER) expect(s.level, `band ${band} miss ${n}`).toBe(0);
          if (n >= SHAPE_COLOUR_AFTER && n < SHAPE_NAME_AFTER) {
            expect(s.level).toBe(1);
            expect(s.highlight).toBeNull();
            expect(s.nameShown).toBe(false);
          }
          if (n >= SHAPE_NAME_AFTER) {
            expect(s.level).toBe(2);
            expect(s.highlight).toBe(s.target);
            expect(s.nameShown).toBe(true);
          }
        }
        expect(levels).toEqual([...levels].sort());
        // a right answer does not take a hint back: the miss count never resets
        const afterRight = correct(s, ctx);
        expect(afterRight.misses).toBe(s.misses);
        expect(afterRight.level).toBe(2);
        if (!afterRight.done) {
          expect(afterRight.highlight).toBe(afterRight.target); // a new round at level 2 is highlighted too
        }
      }
    });

    it("can always be finished by tapping the highlighted picture, and a wrong tap NEVER finishes it (a long run of wrong taps, many games)", () => {
      for (const band of [0, 1, 2, 3, 4, 5]) {
        for (let seed = 1; seed <= 12; seed++) {
          const ctx = ctxOf(seed * 13 + band);
          let s = startShape(ctx, { ageBand: band, firstTarget: "ball" });
          const rng = seeded(seed);
          for (let n = 0; n < 150; n++) {
            const wrongs = s.choices.filter((c) => c !== s.target);
            s = tapShape(s, wrongs[Math.floor(rng() * wrongs.length)]!, ctx);
            expect(s.done, `band ${band} seed ${seed} after ${n + 1} wrong taps`).toBe(false);
            expect(s.streak).toBeLessThan(s.need);
          }
          // the hints are all on now: following the highlight finishes in at most `need` taps
          expect(s.level).toBe(2);
          for (let n = 0; n < s.need && !s.done; n++) {
            expect(s.highlight).toBe(s.target);
            s = tapShape(s, s.highlight!, ctx);
          }
          expect(s.done, `band ${band} seed ${seed}`).toBe(true);
        }
      }
    }, 30_000);

    it("lets a child who only guesses finish only by getting the right ones right", () => {
      // random guessing, 3000 taps over many games: the streak only ever grows by a right answer
      const rng = seeded(99);
      for (const band of [2, 4]) {
        for (let seed = 1; seed <= 20; seed++) {
          const ctx = ctxOf(seed + 500);
          let s = startShape(ctx, { ageBand: band, firstTarget: "orange" });
          for (let n = 0; n < 150 && !s.done; n++) {
            const pick = s.choices[Math.floor(rng() * s.choices.length)]!;
            const next = tapShape(s, pick, ctx);
            if (pick !== s.target) expect(next.streak).toBeLessThanOrEqual(s.streak);
            else expect(next.streak).toBe(s.streak + 1);
            s = next;
          }
        }
      }
    });

    it("says the name aloud exactly when it is first shown, and again for each new round at that level", () => {
      const ctx = ctxOf(21);
      let s = startShape(ctx, { ageBand: 4, firstTarget: "ball" });
      expect(shapeSpeech(null, s)).toBeNull();
      let prev = s;
      const spoken: (string | null)[] = [];
      for (let n = 0; n < 7; n++) {
        s = tapShape(s, wrongPick(s), ctx);
        spoken.push(shapeSpeech(prev, s));
        prev = s;
      }
      expect(spoken.slice(0, 4)).toEqual([null, null, null, null]);
      expect(spoken.slice(4).every((x) => typeof x === "string")).toBe(true); // misses 5, 6, 7: each round is a new target
      const same = tapShape({ ...s, level: 2, nameShown: true, highlight: s.target, choices: s.choices }, "not_there", ctx);
      expect(shapeSpeech(s, same)).toBeNull(); // nothing new: no repeat
    });

    it("says the name of what was found on a right answer, and on a wrong one only when that tap shows the name", () => {
      const ctx = ctxOf(22);
      const s = startShape(ctx, { ageBand: 4, firstTarget: "ball" });
      expect(nameToSay(s, tapShape(s, s.target, ctx), s.target)).toBe(s.target); // a right answer says its name
      let cur = s;
      const said: (string | null)[] = [];
      let lastTarget = "";
      for (let n = 0; n < 5; n++) {
        const wrong = wrongPick(cur);
        const next = tapShape(cur, wrong, ctx);
        said.push(nameToSay(cur, next, wrong));
        lastTarget = next.target; // in the older groups a wrong tap starts a new round with a different item
        cur = next;
      }
      expect(said.slice(0, 4)).toEqual([null, null, null, null]); // four misses say nothing
      expect(said[4], "the fifth miss shows the name of the round it starts, so says it").toBe(lastTarget);
      expect(cur.nameShown).toBe(true);
    });
  });
});

/* ------------------------------------------------------------- finishing */

describe("finishing a household weekend", () => {
  const HOUSE = "2026-11-13"; // a household weekend
  const DAY = "2026-11-14";
  const choreId = REAL_LIFE_CHORES[0]!.id;

  it("pays the drop's 40 XP for a find, once, stamps the day, remembers it as found and earns the play-time minutes", () => {
    const r = completeGarageHousehold(prog({ totalXp: 100 }), HOUSE, DAY, "found");
    expect(r.awarded).toBe(GARAGE_XP);
    expect(GARAGE_XP).toBe(40);
    expect(r.next.totalXp).toBe(140);
    expect(r.next.garageDone).toEqual([HOUSE]);
    expect(r.next.garageFound).toEqual([HOUSE]);
    expect(r.next.workshopDays).toEqual([DAY]);
    expect(r.stemMissionId).toBe(garageMissionId(HOUSE));
    expect(r.stemMissionId).toBe(`garage.${HOUSE}`);
    expect(r.next.garageRealByDay).toEqual({ [DAY]: [HOUSE] });
  });

  it("pays the same XP and the stamp for a skip, but no play-time minutes and no find on record", () => {
    const r = completeGarageHousehold(prog({ totalXp: 100 }), HOUSE, DAY, "skipped");
    expect(r.awarded).toBe(GARAGE_XP);
    expect(r.next.totalXp).toBe(140);
    expect(r.next.garageDone).toEqual([HOUSE]);
    expect(r.next.garageFound).toBeUndefined();
    expect(r.next.garageRealByDay).toBeUndefined();
    expect(r.next.workshopDays).toEqual([DAY]);
    expect(r.stemMissionId).toBeNull();
  });

  it("cannot be finished twice, by either way", () => {
    for (const first of ["found", "skipped"] as const) {
      const once = completeGarageHousehold(prog(), HOUSE, DAY, first).next;
      for (const second of ["found", "skipped"] as const) {
        const again = completeGarageHousehold(once, HOUSE, "2026-11-15", second);
        expect(again.awarded, `${first} then ${second}`).toBe(0);
        expect(again.next).toBe(once);
        expect(again.stemMissionId).toBeNull();
      }
    }
  });

  it("is only for a household weekend: a Build Day is refused, whatever the mode", () => {
    for (const mode of ["found", "skipped"] as const) {
      const r = completeGarageHousehold(prog(), FIRST_WEEKEND, "2026-11-07", mode);
      expect(r.awarded).toBe(0);
      expect(r.next.garageDone).toBeUndefined();
    }
  });

  it("refuses a mode that is not one, and keys that are not dates", () => {
    const p = prog();
    for (const [w, d, m] of [[HOUSE, DAY, "both"], ["soon", DAY, "found"], [HOUSE, "garbage", "found"], [HOUSE, "2026-02-30", "skipped"], ["", DAY, "skipped"]] as const) {
      const r = completeGarageHousehold(p, w, d, m as never);
      expect(r.awarded, `${w} ${d} ${m}`).toBe(0);
      expect(r.next).toBe(p);
    }
  });

  it("needs the real-life switch on for a find (a family that turned real-life tasks off can still skip)", () => {
    const off = prog({ garageRealLife: false });
    expect(completeGarageHousehold(off, HOUSE, DAY, "found").awarded).toBe(0);
    expect(completeGarageHousehold(off, HOUSE, DAY, "skipped").awarded).toBe(GARAGE_XP);
    expect(completeGarageHousehold(prog({ garageRealLife: true }), HOUSE, DAY, "found").awarded).toBe(GARAGE_XP);
  });

  it("does not use the shared +25 XP/day real-life ceiling: a routine done the same day still pays 25, before or after a find", () => {
    const p = prog({ enabledChoreIds: [choreId] });
    const afterFind = completeGarageHousehold(p, HOUSE, DAY, "found").next;
    const chore = completeRealLifeChore(afterFind, choreId, DAY);
    expect(chore.awarded).toBe(CHORE_QUEST_XP);
    const afterChore = completeRealLifeChore(p, choreId, DAY).next;
    expect(completeGarageHousehold(afterChore, HOUSE, DAY, "found").awarded).toBe(GARAGE_XP); // a routine earlier does not cut the find's 40
    expect(completeGarageHousehold(p, HOUSE, DAY, "found").next.completedChoresByDay).toBeUndefined(); // a find is not a routine
  });

  it("blocks a later same-day “We built it” bonus after a find, but not after a skip", () => {
    const build = "2026-11-06"; // a Build Day weekend, finished earlier
    const base = prog({ garageDone: [build] });
    const afterFind = completeGarageHousehold(base, HOUSE, DAY, "found").next;
    expect(completeGarageReal(afterFind, build, DAY).awarded).toBe(0);
    const afterSkip = completeGarageHousehold(base, HOUSE, DAY, "skipped").next;
    expect(completeGarageReal(afterSkip, build, DAY).awarded).toBe(GARAGE_REAL_XP);
    // on another day the build bonus is paid as ever
    expect(completeGarageReal(afterFind, build, "2026-11-16").awarded).toBe(GARAGE_REAL_XP);
  });

  it("gives a found household weekend nothing to “build for real”, and leaves a build weekend exactly as it was", () => {
    const found = completeGarageHousehold(prog(), HOUSE, DAY, "found").next;
    const real = completeGarageReal(found, HOUSE, DAY);
    expect(real.awarded).toBe(0);
    expect(real.next).toBe(found);
    // on a LATER day too (the same-day record cannot be what stops it): nothing to confirm, nothing paid, nothing recorded
    const later = completeGarageReal(found, HOUSE, "2026-11-16");
    expect(later.awarded).toBe(0);
    expect(later.next).toBe(found);
    // build weekends: the same result with and without the household field in the record
    const build = prog({ garageDone: [FIRST_WEEKEND] });
    expect(completeGarageReal(build, FIRST_WEEKEND, "2026-11-07").awarded).toBe(GARAGE_REAL_XP);
    expect(completeGarageReal(prog({ garageDone: [FIRST_WEEKEND], garageFound: [] }), FIRST_WEEKEND, "2026-11-07").awarded).toBe(GARAGE_REAL_XP);
    expect(completeGarage(prog(), FIRST_WEEKEND, "2026-11-07").stemMissionId).toBe(`garage.${FIRST_WEEKEND}`);
  });

  it("can finish a different household weekend the same day as another", () => {
    let p = completeGarageHousehold(prog(), HOUSE, DAY, "found").next;
    p = completeGarageHousehold(p, "2026-11-20", DAY, "skipped").next;
    expect(p.garageDone).toEqual([HOUSE, "2026-11-20"]);
    expect(p.garageFound).toEqual([HOUSE]);
    expect(p.totalXp).toBe(80);
  });
});

describe("remembering a find", () => {
  it("keeps garageFound through a save and a load, only for weekends that are finished, and loads an old save unchanged", () => {
    const p = completeGarageHousehold(prog(), "2026-11-13", "2026-11-14", "found").next;
    const round = normalizeProgression(JSON.parse(JSON.stringify(p)));
    expect(round.garageFound).toEqual(["2026-11-13"]);
    // an entry that is not finished, not a weekend key, or repeated does not survive
    const messy = normalizeProgression({ ...p, garageFound: ["2026-11-13", "2026-11-13", "2026-11-20", "junk", 7, null] });
    expect(messy.garageFound).toEqual(["2026-11-13"]);
    // a save from before household weekends has no garageFound and loads as it was
    const old = normalizeProgression({ ...emptyProgression(), garageDone: ["2026-11-06"] });
    expect("garageFound" in old).toBe(false);
    expect(old.garageDone).toEqual(["2026-11-06"]);
    expect("garageFound" in normalizeProgression(emptyProgression())).toBe(false);
  });

  it("merges two devices: a find on either is a find, and nothing finished is lost", () => {
    const a = completeGarageHousehold(prog(), "2026-11-13", "2026-11-14", "found").next;
    const b = completeGarageHousehold(prog(), "2026-11-20", "2026-11-21", "skipped").next;
    const merged = mergeProgression(a, b);
    expect(merged.garageDone).toEqual(["2026-11-13", "2026-11-20"]);
    expect(merged.garageFound).toEqual(["2026-11-13"]);
    // either way round: the find may be on the local side or on the remote one
    expect(mergeProgression(b, a).garageFound).toEqual(["2026-11-13"]);
    // a find recorded on one device for a weekend the other finished by a skip stays a find (a find is the better record)
    const skippedHere = completeGarageHousehold(prog(), "2026-11-13", "2026-11-14", "skipped").next;
    expect(mergeProgression(a, skippedHere).garageFound).toEqual(["2026-11-13"]);
    expect(mergeProgression(skippedHere, a).garageFound).toEqual(["2026-11-13"]);
  });

  it("is forgotten on a reset, with the rest of the finished weekends", () => {
    const p = completeGarageHousehold(prog({ totalXp: 500 }), "2026-11-13", "2026-11-14", "found").next;
    const reset = resetProgression(p);
    expect(reset.garageDone).toBeUndefined();
    expect(reset.garageFound).toBeUndefined();
  });
});

/* ------------------------------------------------------------ the roof */

describe("the roof stars", () => {
  it("counts a found weekend and a build weekend as gold, and a skipped household weekend as hollow", () => {
    expect(garageTrophyCounts(undefined, undefined)).toEqual({ gold: 0, hollow: 0 });
    expect(garageTrophyCounts([], [])).toEqual({ gold: 0, hollow: 0 });
    // 2026-11-06 build; 2026-11-13 found; 2026-11-20 skipped; 2026-12-04 build
    const done = ["2026-11-06", "2026-11-13", "2026-11-20", "2026-12-04"];
    expect(garageTrophyCounts(done, ["2026-11-13"])).toEqual({ gold: 3, hollow: 1 });
    expect(garageTrophyCounts(done, [])).toEqual({ gold: 2, hollow: 2 });
    expect(garageTrophyCounts(done, undefined)).toEqual({ gold: 2, hollow: 2 });
    // weekends before launch were build weekends: gold, never hollow
    expect(garageTrophyCounts(["2026-10-24", "2026-10-31"], [])).toEqual({ gold: 2, hollow: 0 });
  });

  it("never counts a skipped weekend as found, and counts every finished weekend once", () => {
    const keys = HOUSEHOLD_FRIDAYS.slice(0, 40);
    const counts = garageTrophyCounts([...keys, ...keys], []);
    expect(counts).toEqual({ gold: 0, hollow: 40 });
    const all = garageTrophyCounts(keys, keys);
    expect(all).toEqual({ gold: 40, hollow: 0 });
    expect(garageTrophyCounts(["2026-11-06", "2027-01-01"], [])).toEqual({ gold: 2, hollow: 0 });
  });
});

describe("the roof, drawn", () => {
  /** The Garage as the trail map draws it, for a finished-weekend count of gold and hollow stars. */
  function roof(gold: number, hollow: number): string {
    const cards = buildMapCards({
      ageBand: 3,
      prog: emptyProgression(),
      found: new Set<string>(),
      missionsDone: new Set<string>(),
      garage: { weekend: false, done: false, trophies: gold, hollow },
    });
    const node = buildExplorerGraph({ cards }).nodes.find((n) => n.id === "garage")!;
    return renderToStaticMarkup(createElement(NodeArt, { node }));
  }
  const count = (html: string, kind: string) => (html.match(new RegExp(`data-star="${kind}"`, "g")) ?? []).length;

  it("draws a gold star for each found or built weekend and a hollow star for each skipped one, gold first", () => {
    const html = roof(2, 1);
    expect(count(html, "gold")).toBe(2);
    expect(count(html, "hollow")).toBe(1);
    expect(html.indexOf('data-star="gold"')).toBeLessThan(html.indexOf('data-star="hollow"'));
    expect(html).toMatch(/data-star="hollow"[^>]*fill="none"/); // hollow: not filled
    expect(html).toMatch(/data-star="gold"[^>]*fill="#ffd24d"/);
  });

  it("draws a roof with only skipped weekends as hollow stars and no gold, and an empty roof with none", () => {
    const only = roof(0, 3);
    expect(count(only, "gold")).toBe(0);
    expect(count(only, "hollow")).toBe(3);
    const none = roof(0, 0);
    expect(count(none, "gold") + count(none, "hollow")).toBe(0);
  });

  it("shows at most four stars and counts the rest, hollow ones included", () => {
    const html = roof(3, 4);
    expect(count(html, "gold") + count(html, "hollow")).toBe(4);
    expect(html).toContain("+3");
    expect(count(roof(6, 0), "gold")).toBe(4);
    expect(roof(6, 0)).toContain("+2");
  });

  it("reads a roof with the old gold-only count exactly as before", () => {
    const html = roof(2, 0);
    expect(count(html, "gold")).toBe(2);
    expect(count(html, "hollow")).toBe(0);
  });
});

describe("the Garage's status for a household weekend", () => {
  const status = (dayKey: string, over: Record<string, unknown> = {}) =>
    garageStatus({ dayKey, ageBand: 3, done: [], householdDrop: (k) => householdDropFor(k, ITEMS), ...over });

  it("is a build weekend on a Build Day and a household weekend on every other, with no loaner on a household one", () => {
    const build = status("2026-11-07");
    expect(build.kind).toBe("build");
    expect(build.drop).toBe(GARAGE_DROPS[0]);
    const house = status("2026-11-14");
    expect(house.kind).toBe("household");
    expect(house.drop.household).toEqual({ kind: "item", itemId: HOUSEHOLD_ORDER[0] });
    expect(loanKeys(house.drop)).toEqual([]);
    expect(house.variant).toBe(house.drop.byGroup.mid);
    expect(house.found).toBe(false);
  });

  it("does not trust the household callback on a Build Day: a build weekend stays a build weekend", () => {
    const hostile = householdDropFor("2026-11-13", ITEMS)!;
    const s = garageStatus({ dayKey: "2026-11-07", ageBand: 3, done: [], householdDrop: () => hostile });
    expect(s.kind).toBe("build");
    expect(s.drop).toBe(GARAGE_DROPS[0]);
  });

  it("knows a household weekend that was finished by a find, and one finished by a skip", () => {
    expect(status("2026-11-14", { done: ["2026-11-13"], found: ["2026-11-13"] })).toMatchObject({ done: true, found: true, open: false });
    expect(status("2026-11-14", { done: ["2026-11-13"], found: [] })).toMatchObject({ done: true, found: false, open: false });
    expect(status("2026-11-14", { done: [], found: ["2026-11-13"] }).found).toBe(false); // not finished: not a find
  });

  it("behaves exactly as before when no household data is passed in (every weekend a build weekend)", () => {
    const s = garageStatus({ dayKey: "2026-11-14", ageBand: 3, done: [] });
    expect(s.kind).toBe("build");
    expect(s.drop).toBe(GARAGE_DROPS[1]);
    expect(s.found).toBe(false);
  });

  it("keeps the drop switch and the days as they were", () => {
    expect(status("2026-11-14", { dropEnabled: false })).toMatchObject({ kind: "household", dropEnabled: false, open: false });
    expect(status("2026-11-16")).toMatchObject({ isWeekend: false, open: false, kind: "household" }); // a Monday points at the last Friday's drop
  });
});
