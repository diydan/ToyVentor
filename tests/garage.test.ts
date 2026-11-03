import { describe, expect, it } from "vitest";
import { PART, TYPES } from "../src/features/game/world/runtime/catalog";
import { isMissionId } from "../shared/parent-time";
import {
  BAND_GROUPS,
  bandGroupOf,
  changedSlots,
  checkGoal,
  completeGarage,
  dayNumber,
  dayOfWeek,
  dropForWeekend,
  equippedKeys,
  FIRST_WEEKEND,
  GARAGE_DROPS,
  GARAGE_GRACE_MS,
  GARAGE_XP,
  garageGraceLeftMs,
  garageMissionId,
  garageStatus,
  loanKeys,
  missionDone,
  missionParts,
  STAT_IDS,
  weekendOf,
  type BuildSummary,
  type GarageGoal,
  type GarageToyType,
  type StatId,
} from "../src/lib/garage";
import {
  emptyProgression,
  mergeProgression,
  normalizeProgression,
  resetProgression,
  RANKS,
  type ProgressionState,
} from "../src/lib/progression";

const prog = (over: Partial<ProgressionState> = {}): ProgressionState => ({ ...emptyProgression(), ...over });

describe("the weekend window", () => {
  it("knows the day of the week (2026-11-06 is a Friday)", () => {
    expect(dayOfWeek("2026-11-06")).toBe(5);
    expect(dayOfWeek("2026-11-07")).toBe(6);
    expect(dayOfWeek("2026-11-08")).toBe(0);
    expect(dayOfWeek("2026-11-09")).toBe(1);
    expect(dayOfWeek("1970-01-01")).toBe(4);
    expect(dayOfWeek("2000-02-29")).toBe(2); // a leap day
  });

  it("rejects things that are not dates", () => {
    for (const bad of ["", "2026-13-01", "2026-02-30", "2026-1-5", "yesterday", "2026-11-06T00:00"]) {
      expect(dayNumber(bad), bad).toBeNull();
      expect(weekendOf(bad), bad).toBeNull();
    }
  });

  it("Friday, Saturday and Sunday are the weekend, and share the Friday's key", () => {
    for (const day of ["2026-11-06", "2026-11-07", "2026-11-08"]) {
      const w = weekendOf(day)!;
      expect(w.isWeekend, day).toBe(true);
      expect(w.weekendKey, day).toBe("2026-11-06");
      expect(w.nextWeekendKey, day).toBe("2026-11-13");
    }
  });

  it("Monday to Thursday are not the weekend and point at the last Friday", () => {
    for (const day of ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"]) {
      const w = weekendOf(day)!;
      expect(w.isWeekend, day).toBe(false);
      expect(w.weekendKey, day).toBe("2026-11-06");
      expect(w.nextWeekendKey, day).toBe("2026-11-13");
    }
    expect(weekendOf("2026-11-05")!.weekendKey).toBe("2026-10-30");
  });

  it("crosses month, year and leap-day boundaries", () => {
    expect(weekendOf("2027-01-02")).toMatchObject({ weekendKey: "2027-01-01", isWeekend: true }); // Sat
    expect(weekendOf("2026-12-06")).toMatchObject({ weekendKey: "2026-12-04", isWeekend: true }); // Sun
    expect(weekendOf("2028-02-29")).toMatchObject({ weekendKey: "2028-02-25", isWeekend: false }); // Tue, leap day
    expect(weekendOf("2028-03-03")).toMatchObject({ weekendKey: "2028-03-03", isWeekend: true }); // Fri after it
  });
});

describe("the drop rotation", () => {
  it("starts with the first drop on the first weekend and is the same for everyone", () => {
    expect(dropForWeekend(FIRST_WEEKEND)).toBe(GARAGE_DROPS[0]);
    expect(dropForWeekend("2026-11-13")).toBe(GARAGE_DROPS[1]);
    expect(dropForWeekend("2026-11-20")).toBe(GARAGE_DROPS[2]);
    expect(dropForWeekend("2026-11-06")).toBe(dropForWeekend("2026-11-06"));
  });

  it("never repeats back to back, and comes round after the whole catalog", () => {
    const n = GARAGE_DROPS.length;
    let prev = dropForWeekend("2026-01-02"); // before launch: still defined
    for (let w = 1; w <= 60; w++) {
      const key = new Date(Date.UTC(2026, 0, 2) + w * 7 * 86_400_000).toISOString().slice(0, 10);
      const d = dropForWeekend(key);
      expect(d, key).not.toBe(prev);
      expect(dropForWeekend(new Date(Date.UTC(2026, 0, 2) + (w + n) * 7 * 86_400_000).toISOString().slice(0, 10))).toBe(d);
      prev = d;
    }
  });

  it("a never-started drop simply comes round again on a later weekend", () => {
    const first = dropForWeekend(FIRST_WEEKEND);
    expect(dropForWeekend("2026-11-27")).toBe(first); // three weekends later
  });

  it("has all three kinds", () => {
    expect(new Set(GARAGE_DROPS.map((d) => d.kind))).toEqual(new Set(["newPart", "idea", "remix"]));
  });
});

describe("age-specific missions", () => {
  it("maps age bands to the four written versions, an unset age reading as early", () => {
    expect([0, 1, 2, 3, 4, 5].map(bandGroupOf)).toEqual(["tiny", "tiny", "early", "mid", "older", "older"]);
    expect(bandGroupOf(null)).toBe("early");
    expect(bandGroupOf(undefined)).toBe("early");
  });

  it("every drop has a version for every age, with a title and a short brief", () => {
    for (const drop of GARAGE_DROPS) {
      for (const g of BAND_GROUPS) {
        const v = drop.byGroup[g];
        expect(v.title.length, `${drop.id}/${g}`).toBeGreaterThan(2);
        expect(v.brief.length, `${drop.id}/${g}`).toBeGreaterThan(5);
        expect(v.brief.length, `${drop.id}/${g} brief too long`).toBeLessThanOrEqual(130);
      }
      // The youngest get one short sentence.
      expect(drop.byGroup.tiny.brief.length, drop.id).toBeLessThanOrEqual(45);
    }
  });
});

/** Open parts (no world to find them in) per toy type and slot, with their stat. */
function openParts(type: GarageToyType): Map<string, StatId[]> {
  const out = new Map<string, StatId[]>();
  for (const slot of TYPES[type]!.slots) out.set(slot, []);
  for (const [key, def] of Object.entries(PART)) {
    const [t, slot] = key.split(".");
    if (t !== type || !out.has(slot!)) continue;
    const p = def as { w?: string; st?: string };
    if (p.w) continue; // needs finding
    if (p.st && p.st !== "none") out.get(slot!)!.push(p.st as StatId);
  }
  return out;
}

/** Can distinct slots, using only open parts, supply every needed stat? */
function reachable(type: GarageToyType, need: readonly StatId[]): boolean {
  const slots = [...openParts(type).entries()];
  const go = (i: number, used: Set<number>): boolean => {
    if (i === need.length) return true;
    for (let k = 0; k < slots.length; k++) {
      if (used.has(k) || !slots[k]![1].includes(need[i]!)) continue;
      if (go(i + 1, new Set([...used, k]))) return true;
    }
    return false;
  };
  return go(0, new Set());
}

describe("every mission can be done with parts a child already has", () => {
  const needs = (g: GarageGoal): StatId[][] =>
    g.kind === "stats"
      ? [[...g.need]]
      : g.kind === "statCount"
        ? [STAT_IDS.slice(0, g.count) as StatId[]]
        : g.kind === "all"
          ? g.goals.flatMap(needs)
          : [];

  it("stat goals are reachable on both toy types from open parts alone", () => {
    for (const drop of GARAGE_DROPS) {
      for (const g of BAND_GROUPS) {
        for (const need of needs(drop.byGroup[g].goal)) {
          for (const type of ["character", "vehicle"] as const) {
            expect(reachable(type, need), `${drop.id}/${g} needs ${need.join("+")} on a ${type}`).toBe(true);
          }
        }
      }
    }
  });

  it("each toy type has a part to change in at least two slots (remix)", () => {
    for (const type of ["character", "vehicle"] as const) {
      const swappable = [...openParts(type).values()].filter((stats) => stats.length >= 1).length;
      expect(swappable, type).toBeGreaterThanOrEqual(2);
    }
  });

  it("a new-part drop's loaner parts are real, and really are locked until found", () => {
    const drop = GARAGE_DROPS.find((d) => d.kind === "newPart")!;
    expect(loanKeys(drop)).toHaveLength(2);
    for (const [type, key] of Object.entries(drop.loan!)) {
      const p = (PART as Record<string, { w?: string }>)[key];
      expect(p, key).toBeTruthy();
      expect(key.startsWith(`${type}.`), key).toBe(true);
      expect(p!.w, `${key} should need finding, else it is no loaner`).toBeTruthy();
    }
  });
});

const build = (type: string, sel: Record<string, string>, stats: StatId[]): BuildSummary => ({ type, sel, stats });

describe("checking a goal against the live build", () => {
  it("reads short part ids and full keys alike", () => {
    expect(equippedKeys(build("character", { hat: "crown", back: "character.back.cape" }, []))).toEqual({
      hat: "character.hat.crown",
      back: "character.back.cape",
    });
    expect(equippedKeys(build("character", { hat: "" }, []))).toEqual({});
  });

  it("equip: wearing the loaner for this toy type", () => {
    const drop = GARAGE_DROPS.find((d) => d.kind === "newPart")!;
    const goal = drop.byGroup.early.goal;
    expect(checkGoal(goal, build("character", { hat: "crown" }, ["glow"])).ok).toBe(true);
    expect(checkGoal(goal, build("character", { hat: "wizard" }, ["glow"])).ok).toBe(false);
    expect(checkGoal(goal, build("vehicle", { rear: "booster" }, ["speed"])).ok).toBe(true);
    // The character's loaner does not count on a vehicle, and an unknown type never passes.
    expect(checkGoal(goal, build("vehicle", { hat: "crown" }, [])).ok).toBe(false);
    expect(checkGoal(goal, build("robot", { hat: "crown" }, [])).ok).toBe(false);
  });

  it("stats: every needed stat must be there, and each is reported", () => {
    const goal: GarageGoal = { kind: "stats", need: ["glow", "speed"] };
    const half = checkGoal(goal, build("character", {}, ["glow"]));
    expect(half.ok).toBe(false);
    expect(half.parts).toEqual([
      { label: "Glow", ok: true },
      { label: "Speed", ok: false },
    ]);
    expect(checkGoal(goal, build("character", {}, ["speed", "glow", "spin"])).ok).toBe(true);
  });

  it("statCount: how many different stats", () => {
    const goal: GarageGoal = { kind: "statCount", count: 3 };
    expect(checkGoal(goal, build("character", {}, ["glow", "glow", "speed"])).ok).toBe(false);
    expect(checkGoal(goal, build("character", {}, ["glow", "speed", "spin"])).ok).toBe(true);
  });

  it("remix: needs the build you started from, then counts changed parts", () => {
    const start = build("character", { hat: "wizard", ears: "cat", tail: "fox" }, ["glow", "speed"]);
    const one: GarageGoal = { kind: "remix", changes: 1 };
    expect(checkGoal(one, start).ok).toBe(false); // no baseline
    expect(checkGoal(one, start, start).ok).toBe(false); // nothing changed
    expect(checkGoal(one, build("character", { hat: "none", ears: "cat", tail: "fox" }, ["speed"]), start).ok).toBe(true);
    // Adding a part where there was none is a change too.
    expect(checkGoal(one, build("character", { hat: "wizard", ears: "cat", tail: "fox", back: "backpack" }, ["glow", "speed", "torque"]), start).ok).toBe(true);

    const twist: GarageGoal = { kind: "remix", changes: 1, gainStat: true };
    expect(checkGoal(twist, build("character", { hat: "none", ears: "cat", tail: "fox" }, ["speed"]), start).ok).toBe(false);
    expect(checkGoal(twist, build("character", { hat: "wizard", ears: "cat", tail: "dragon" }, ["glow", "speed", "torque"]), start).ok).toBe(true);

    const keep: GarageGoal = { kind: "remix", changes: 2, keepStats: true };
    const swapped = build("character", { hat: "propcap", ears: "horns", tail: "fox" }, ["spin", "torque", "speed"]);
    expect(checkGoal(keep, swapped, start).parts.map((p) => p.ok)).toEqual([true, false]); // lost glow
    const kept = build("character", { hat: "wizard", ears: "horns", tail: "curly" }, ["glow", "torque", "spin", "speed"]);
    expect(checkGoal(keep, kept, start).ok).toBe(true);
  });

  it("all: every part must hold, and the parts add up", () => {
    const goal: GarageGoal = { kind: "all", goals: [{ kind: "stats", need: ["glow"] }, { kind: "statCount", count: 2 }] };
    const r = checkGoal(goal, build("character", {}, ["glow"]));
    expect(r.ok).toBe(false);
    expect(r.parts).toHaveLength(2);
    expect(checkGoal(goal, build("character", {}, ["glow", "spin"])).ok).toBe(true);
  });
});

describe("a mission is only done after the child changes something", () => {
  const start = build("character", { hat: "wizard", ears: "cat" }, ["glow", "speed"]);

  it("counts changed slots, including a part added or taken off", () => {
    expect(changedSlots(start, start)).toBe(0);
    expect(changedSlots(start, build("character", { hat: "none", ears: "cat" }, []))).toBe(1);
    expect(changedSlots(start, build("character", { hat: "wizard", ears: "cat", back: "backpack" }, []))).toBe(1);
    expect(changedSlots(start, build("character", { hat: "crown", ears: "horns" }, []))).toBe(2);
  });

  it("a goal the toy already meets does not pay out on Start", () => {
    const goal: GarageGoal = { kind: "stats", need: ["glow", "speed"] };
    expect(checkGoal(goal, start).ok).toBe(true); // already glows and has speed
    expect(missionDone(goal, start, start)).toBe(false); // ...so nothing counts yet
    // Change something and still meet it: now it counts.
    expect(missionDone(goal, build("character", { hat: "wizard", ears: "cat", tail: "fox" }, ["glow", "speed"]), start)).toBe(true);
    // Change something but lose the goal: it does not.
    expect(missionDone(goal, build("character", { hat: "none", ears: "cat" }, ["speed"]), start)).toBe(false);
  });

  it("the chip adds a Change step only when the toy already meets the goal", () => {
    const goal: GarageGoal = { kind: "stats", need: ["glow"] };
    // Already glowing at Start: nothing is left but to change something.
    expect(missionParts(goal, start, start)).toEqual([
      { label: "Glow", ok: true },
      { label: "Change something", ok: false },
    ]);
    // Not glowing yet: just the goal, no extra step to confuse.
    const dark = build("character", { hat: "none", ears: "cat" }, ["speed"]);
    expect(missionParts(goal, dark, dark)).toEqual([{ label: "Glow", ok: false }]);
    // A remix already says it, so it is not doubled.
    const remix: GarageGoal = { kind: "remix", changes: 1 };
    expect(missionParts(remix, start, start).map((p) => p.label)).toEqual(["Change a part"]);
  });

  it("the loaner and a remix are done by the change itself", () => {
    const crown = GARAGE_DROPS.find((d) => d.kind === "newPart")!.byGroup.early.goal;
    expect(missionDone(crown, build("character", { hat: "crown", ears: "cat" }, ["glow"]), start)).toBe(true);
    const remix: GarageGoal = { kind: "remix", changes: 1 };
    expect(missionDone(remix, start, start)).toBe(false);
    expect(missionDone(remix, build("character", { hat: "none", ears: "cat" }, ["speed"]), start)).toBe(true);
  });
});

describe("the Garage's status for a day", () => {
  const status = (dayKey: string, over: Partial<Parameters<typeof garageStatus>[0]> = {}) =>
    garageStatus({ dayKey, ageBand: 3, done: [], ...over });

  it("Monday to Thursday: not animated, still offers the last weekend's drop", () => {
    const s = status("2026-11-10");
    expect(s).toMatchObject({ isWeekend: false, open: false, done: false, weekendKey: "2026-11-06", preview: false });
    expect(s.drop).toBe(GARAGE_DROPS[0]);
  });

  it("Friday to Sunday: open and in focus until the drop is done", () => {
    for (const day of ["2026-11-06", "2026-11-07", "2026-11-08"]) {
      expect(status(day), day).toMatchObject({ isWeekend: true, open: true, done: false });
    }
    const done = status("2026-11-07", { done: ["2026-11-06"] });
    expect(done).toMatchObject({ isWeekend: true, open: false, done: true });
    // Done for last weekend does not finish the next one.
    expect(status("2026-11-14", { done: ["2026-11-06"] })).toMatchObject({ weekendKey: "2026-11-13", done: false, open: true });
  });

  it("the version follows the age", () => {
    expect(status("2026-11-06", { ageBand: 0 }).group).toBe("tiny");
    expect(status("2026-11-06", { ageBand: 5 }).group).toBe("older");
    expect(status("2026-11-06", { ageBand: null }).variant).toBe(GARAGE_DROPS[0]!.byGroup.early);
  });

  it("Preview weekend shows the next drop on a weekday, and does nothing on a real weekend", () => {
    const p = status("2026-11-10", { preview: true });
    expect(p).toMatchObject({ isWeekend: true, open: true, preview: true, weekendKey: "2026-11-13" });
    expect(p.drop).toBe(GARAGE_DROPS[1]);
    // Last weekend being done does not hide the preview of the next.
    expect(status("2026-11-10", { preview: true, done: ["2026-11-06"] }).open).toBe(true);
    expect(status("2026-11-07", { preview: true })).toMatchObject({ preview: false, weekendKey: "2026-11-06" });
  });

  it("a bad date never throws", () => {
    expect(() => status("not a date")).not.toThrow();
    expect(status("not a date").weekendKey).toBe(FIRST_WEEKEND);
  });
});

describe("finishing a drop", () => {
  it("pays XP once, stamps a Workshop Day, and remembers the weekend", () => {
    const r = completeGarage(prog({ totalXp: 100 }), "2026-11-06", "2026-11-07");
    expect(r.awarded).toBe(GARAGE_XP);
    expect(r.next.totalXp).toBe(100 + GARAGE_XP);
    expect(r.next.garageDone).toEqual(["2026-11-06"]);
    expect(r.next.workshopDays).toEqual(["2026-11-07"]);
    expect(r.stemMissionId).toBe("garage.2026-11-06");
    // The id is one the parent-time ledger accepts and credits as a STEM mission.
    expect(isMissionId(r.stemMissionId)).toBe(true);
  });

  it("finishing again pays nothing and changes nothing", () => {
    const once = completeGarage(prog(), "2026-11-06", "2026-11-07").next;
    const twice = completeGarage(once, "2026-11-06", "2026-11-08");
    expect(twice.awarded).toBe(0);
    expect(twice.next).toBe(once);
    expect(twice.stemMissionId).toBeNull();
  });

  it("a different weekend pays again, and the stamp count never resets", () => {
    let p = completeGarage(prog(), "2026-11-06", "2026-11-06").next;
    p = completeGarage(p, "2026-11-13", "2026-11-14").next;
    expect(p.garageDone).toEqual(["2026-11-06", "2026-11-13"]);
    expect(p.workshopDays).toEqual(["2026-11-06", "2026-11-14"]);
    // Two stamps on the same day stay one stamp.
    expect(completeGarage(p, "2026-11-20", "2026-11-14").next.workshopDays).toEqual(["2026-11-06", "2026-11-14"]);
  });

  it("reports a rank-up when the XP crosses one", () => {
    const rank2 = RANKS[1]!;
    const r = completeGarage(prog({ totalXp: rank2.xp - 1 }), "2026-11-06", "2026-11-06");
    expect(r.rankAfter.rank).toBeGreaterThan(r.rankBefore.rank);
  });

  it("refuses a made-up weekend key", () => {
    for (const bad of ["", "soon", "2026-99-99"]) {
      const r = completeGarage(prog(), bad, "2026-11-06");
      expect(r.awarded, bad).toBe(0);
      expect(r.next.garageDone).toBeUndefined();
    }
    // A bad day only skips the stamp; the weekend still counts.
    const r = completeGarage(prog(), "2026-11-06", "garbage");
    expect(r.awarded).toBe(GARAGE_XP);
    expect(r.next.workshopDays).toBeUndefined();
  });
});

describe("garageDone in progress", () => {
  it("is validated, merged by union, and wiped by an XP reset", () => {
    expect(normalizeProgression({ garageDone: ["2026-11-13", "2026-11-06", "2026-11-06", "bad", 7, "2026-1-1"] }).garageDone).toEqual([
      "2026-11-06",
      "2026-11-13",
    ]);
    expect(normalizeProgression({ garageDone: "nope" }).garageDone).toBeUndefined();
    const merged = mergeProgression(prog({ garageDone: ["2026-11-06"] }), prog({ garageDone: ["2026-11-13", "2026-11-06"] }));
    expect(merged.garageDone).toEqual(["2026-11-06", "2026-11-13"]);
    expect(resetProgression(prog({ garageDone: ["2026-11-06"] })).garageDone).toBeUndefined();
  });

  it("stays bounded", () => {
    const many = Array.from({ length: 500 }, (_, i) => new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10));
    expect(normalizeProgression({ garageDone: many }).garageDone!.length).toBeLessThanOrEqual(200);
  });
});

describe("the Garage grace", () => {
  it("is ten minutes, spent down, never negative", () => {
    expect(GARAGE_GRACE_MS).toBe(600_000);
    expect(garageGraceLeftMs(0)).toBe(600_000);
    expect(garageGraceLeftMs(120_000)).toBe(480_000);
    expect(garageGraceLeftMs(700_000)).toBe(0);
    expect(garageGraceLeftMs(-5)).toBe(600_000);
  });

  it("the mission id has the form the ledger credits", () => {
    expect(garageMissionId("2026-11-06")).toBe("garage.2026-11-06");
  });
});

describe("Garage settings kept on the device", () => {
  const memory = () => {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    };
  };

  it("Preview weekend is off until turned on, then on, then off again", async () => {
    const { loadGaragePreview, saveGaragePreview } = await import("../src/lib/garageDevice");
    const store = memory();
    expect(loadGaragePreview(store)).toBe(false);
    saveGaragePreview(true, store);
    expect(loadGaragePreview(store)).toBe(true);
    saveGaragePreview(false, store);
    expect(loadGaragePreview(store)).toBe(false);
    expect(loadGaragePreview(null)).toBe(false);
  });

  it("remembers the grace spent per weekend, bounded, and ignores junk", async () => {
    const { loadGraceUsedMs, saveGraceUsedMs } = await import("../src/lib/garageDevice");
    const store = memory();
    expect(loadGraceUsedMs("2026-11-06", store)).toBe(0);
    saveGraceUsedMs("2026-11-06", 125_000.4, store);
    expect(loadGraceUsedMs("2026-11-06", store)).toBe(125_000);
    expect(loadGraceUsedMs("2026-11-13", store)).toBe(0); // another weekend starts fresh
    saveGraceUsedMs("2026-11-06", 99_999_999, store);
    expect(loadGraceUsedMs("2026-11-06", store)).toBeLessThanOrEqual(GARAGE_GRACE_MS * 2);
    // Bad keys and bad numbers are refused, and storage can fail.
    saveGraceUsedMs("nope", 5, store);
    saveGraceUsedMs("2026-11-20", Number.NaN, store);
    expect(store.data.has("tvGarageGrace:v1:nope")).toBe(false);
    expect(store.data.has("tvGarageGrace:v1:2026-11-20")).toBe(false);
    expect(loadGraceUsedMs("nope", store)).toBe(0);
    const blocked = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); } };
    expect(loadGraceUsedMs("2026-11-06", blocked)).toBe(0);
    expect(() => saveGraceUsedMs("2026-11-06", 5, blocked)).not.toThrow();
  });
});
