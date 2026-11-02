import { describe, expect, it, vi } from "vitest";
import { BANDS, bandOf, normalizeAgeBand, readAge, writeAge } from "../src/lib/age";
import { LADDERS, ladderById, rungKey } from "../src/lib/ladders";
import { isBanded, ladderState, learnStates, planFor } from "../src/lib/learn";
import {
  buildMapCards,
  MAP_STOPS,
  STOP_GLYPH,
  THEME_COLOR,
} from "../src/lib/mapCards";
import {
  emptyProgression,
  importCarouselMockup,
  mergeProgression,
  normalizeProgression,
  resetProgression,
  type ProgressionState,
} from "../src/lib/progression";
import { LEVELS } from "../src/features/game/world/runtime/catalog";

const prog = (over: Partial<ProgressionState> = {}): ProgressionState => ({
  ...emptyProgression(),
  ...over,
});

describe("age bands (carousel §9.1, §13.1)", () => {
  it("maps every rung age string, including the 4 to 6 edge", () => {
    expect(bandOf("2 to 3")).toBe(0);
    expect(bandOf("3 to 4")).toBe(1);
    expect(bandOf("5 to 6")).toBe(2);
    expect(bandOf("7 to 9")).toBe(3);
    expect(bandOf("10 to 12")).toBe(4);
    expect(bandOf("13+")).toBe(5);
    expect(bandOf("4 to 6")).toBe(1); // first number's band
    for (const ladder of LADDERS) {
      for (const rung of ladder.rungs) {
        expect(bandOf(rung.age)).toBeGreaterThanOrEqual(0);
        expect(bandOf(rung.age)).toBeLessThan(BANDS.length);
      }
    }
  });

  it("normalizes corrupt values to unset", () => {
    expect(normalizeAgeBand(3)).toBe(3);
    expect(normalizeAgeBand(-1)).toBeNull();
    expect(normalizeAgeBand(6)).toBeNull();
    expect(normalizeAgeBand(1.5)).toBeNull();
    expect(normalizeAgeBand("2")).toBeNull();
    expect(normalizeAgeBand(undefined)).toBeNull();
  });

  it("readAge/writeAge round-trip through progression storage", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    try {
      expect(readAge()).toBeNull();
      writeAge(2);
      expect(readAge()).toBe(2);
      writeAge(null);
      expect(readAge()).toBeNull();
      store.set("toyforge:progression:v1", "{broken");
      expect(readAge()).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("ladders data (§10)", () => {
  it("has 7 ladders and 38 rungs, each with a unique progression key", () => {
    expect(LADDERS).toHaveLength(7);
    const keys: string[] = [];
    for (const ladder of LADDERS) {
      for (const rung of ladder.rungs) keys.push(rungKey(rung));
    }
    expect(keys).toHaveLength(38);
    expect(new Set(keys).size).toBe(38);
    // Keys must survive progression normalize (KEY_PATTERN shape).
    for (const key of keys) {
      expect(
        normalizeProgression({ missionStars: { [key]: 1 } }).missionStars[key],
      ).toBe(1);
    }
  });

  it("classifies banded vs sequence ladders", () => {
    expect(LADDERS.filter(isBanded).map((l) => l.id)).toEqual([
      "bridges",
      "gears",
      "circuits",
      "code",
    ]);
    expect(LADDERS.filter((l) => !isBanded(l)).map((l) => l.id)).toEqual([
      "little",
      "early",
      "daily",
    ]);
  });

  it("reused lab ids resolve to real catalog missions; new ids are the §10.2 set", () => {
    const real = new Set<string>();
    for (const level of LEVELS) {
      for (const m of level.missions ?? []) real.add(`${level.id}.${m.type}`);
    }
    const fresh = new Set<string>();
    for (const ladder of LADDERS) {
      for (const rung of ladder.rungs) {
        if (rung.missionId.startsWith("lab")) {
          expect(real.has(rung.missionId), rung.missionId).toBe(true);
        } else {
          fresh.add(rung.missionId.split(".")[0]!);
        }
      }
    }
    expect([...fresh].sort()).toEqual([
      "circuits",
      "daily",
      "early",
      "gears",
      "little",
    ]);
  });

  it("MAP_STOPS goals match the catalog spots and lab missions exactly", () => {
    for (const stop of MAP_STOPS) {
      const level = LEVELS.find((l) => l.id === stop.id);
      expect(level, stop.id).toBeDefined();
      if (stop.kind === "world") {
        expect(level!.spots.map((s) => s.part)).toEqual(stop.goals);
      } else {
        expect((level!.missions ?? []).map((m) => `${stop.id}.${m.type}`)).toEqual(
          stop.goals,
        );
      }
    }
  });

  it("every card id has a glyph and a theme colour", () => {
    for (const id of [...LADDERS.map((l) => l.id), ...MAP_STOPS.map((s) => s.id), "ask"]) {
      expect(STOP_GLYPH[id], id).toBeTruthy();
    }
    for (const theme of new Set([
      ...LADDERS.map((l) => l.theme),
      ...MAP_STOPS.map((s) => s.theme),
    ])) {
      expect(THEME_COLOR[theme], theme).toBeTruthy();
    }
  });
});

describe("learn states (§9.2)", () => {
  const visibleAt = (age: number | null) =>
    learnStates(age, prog()).map((s) => s.ladder.id);

  it("visibility matrix over unset + 6 bands", () => {
    expect(visibleAt(null)).toEqual([]);
    expect(visibleAt(0)).toEqual(["little"]);
    expect(visibleAt(1)).toEqual(["little", "early", "daily", "bridges", "gears", "circuits", "code"]);
    expect(visibleAt(2)).toEqual(["early", "daily", "bridges", "gears", "circuits", "code"]);
    expect(visibleAt(3)).toEqual(["daily", "bridges", "gears", "circuits", "code"]);
    expect(visibleAt(4)).toEqual(["bridges", "gears", "circuits", "code"]);
    expect(visibleAt(5)).toEqual(["bridges", "gears", "circuits", "code"]);
  });

  it("age-map examples: 5-6 starts bridges on rung 2; 3-4 daily skips Tidy the room", () => {
    const bridges = ladderState(ladderById("bridges")!, 2, { done: new Set() })!;
    expect(bridges.shown[0]?.index).toBe(1); // rung 2 of 5
    expect(bridges.next).toBe(1);
    expect(bridges.plan).toEqual([1]);
    expect(bridges.choices).toBe(2); // rung below the start stays open
    const daily = ladderState(ladderById("daily")!, 1, { done: new Set() })!;
    expect(daily.shown.map((r) => r.title)).not.toContain("Tidy the room");
    expect(daily.shown.map((r) => r.title)).toContain("Help cook"); // "4 to 6" -> band 1
    expect(daily.plan).toEqual(daily.shown.map((r) => r.index));
    expect(daily.choices).toBe(1);
  });

  it("banded unlock: finishing the age rung opens the next one up", () => {
    const fresh = ladderState(ladderById("gears")!, 3, { done: new Set() })!;
    expect(fresh.next).toBe(2);
    expect(fresh.rungs.map((r) => r.locked)).toEqual([false, false, false, true, true]);
    const mid = ladderState(ladderById("gears")!, 3, { done: new Set([2]) })!;
    expect(mid.next).toBe(3);
    expect(mid.choices).toBe(4);
    const doneAll = ladderState(ladderById("gears")!, 3, {
      done: new Set([2, 3, 4]),
    })!;
    expect(doneAll.complete).toBe(true);
  });

  it("sequence plan resumes at the first undone shown rung", () => {
    const little = ladderState(ladderById("little")!, 0, { done: new Set([0, 1]) })!;
    expect(little.next).toBe(2);
    expect(little.plan).toEqual([2, 3, 4, 5]);
    expect(little.done).toBe(2);
    expect(little.total).toBe(6);
  });

  it("planFor honours an explicit rung and never dead-ends off-age", () => {
    expect(planFor("bridges", 1, prog(), 4)).toEqual([4]);
    expect(planFor("little", 5, prog())).toEqual([0, 1, 2, 3, 4, 5]);
    expect(planFor("nope", 1, prog())).toBeNull();
    expect(planFor("daily", 1, prog(), 2)).toEqual([2, 3, 5, 6, 7]);
  });

  it("sandbox opens every ladder and rung", () => {
    const all = learnStates(null, prog({ sandboxUnlockAll: true }));
    expect(all).toHaveLength(7);
    for (const s of all) expect(s.rungs.every((r) => !r.locked)).toBe(true);
  });

  it("done comes from missionStars keys", () => {
    const p = prog({ missionStars: { "lab1.bridge:t1": 2, "little.pop:t1": 1 } });
    const states = learnStates(1, p);
    expect(states.find((s) => s.ladder.id === "bridges")!.rungs[0]?.done).toBe(true);
    expect(states.find((s) => s.ladder.id === "little")!.done).toBe(1);
  });
});

describe("map cards (§7)", () => {
  const base = {
    ageBand: 1,
    prog: prog(),
    found: new Set<string>(),
    missionsDone: new Set<string>(),
  };

  it("orders learn -> worlds -> labs and suggests the first incomplete learn card", () => {
    const cards = buildMapCards(base);
    expect(cards.map((c) => c.kind)).toEqual([
      ...Array(7).fill("learn"),
      ...Array(6).fill("world"),
      ...Array(6).fill("lab"),
    ]);
    expect(cards.find((c) => c.suggested)?.id).toBe("little");
    expect(cards.filter((c) => c.suggested)).toHaveLength(1);
  });

  it("leads with the ask card when no age is set", () => {
    const cards = buildMapCards({ ...base, ageBand: null });
    expect(cards[0]?.kind).toBe("ask");
    expect(cards[0]?.suggested).toBe(true);
    expect(cards).toHaveLength(13); // ask + 6 worlds + 6 labs
  });

  it("derives world pips from found and lab pips from missionsDone", () => {
    const cards = buildMapCards({
      ...base,
      found: new Set(["character.hat.flower", "robot.head.cams"]),
      missionsDone: new Set(["lab1.bridge", "lab1.measure", "lab1.balance"]),
    });
    const garden = cards.find((c) => c.id === "garden")!;
    expect(garden.done).toBe(1);
    expect(garden.pips[0]).toMatchObject({ icon: "hat", done: true, silhouette: true });
    const lab1 = cards.find((c) => c.id === "lab1")!;
    expect(lab1.complete).toBe(true);
    expect(lab1.pips.every((p) => p.done)).toBe(true);
  });
});

describe("progression ageBand + import (§9.3, §9.4)", () => {
  it("normalize keeps a valid band and drops corrupt ones", () => {
    expect(normalizeProgression({ ageBand: 4 }).ageBand).toBe(4);
    expect(normalizeProgression({ ageBand: 9 }).ageBand).toBeUndefined();
    expect(normalizeProgression({ ageBand: "2" }).ageBand).toBeUndefined();
    expect(normalizeProgression({}).ageBand).toBeUndefined();
  });

  it("merge prefers non-null, then the higher-XP record", () => {
    expect(mergeProgression(prog(), prog({ ageBand: 2 })).ageBand).toBe(2);
    expect(mergeProgression(prog({ ageBand: 1 }), prog()).ageBand).toBe(1);
    expect(
      mergeProgression(prog({ ageBand: 1, totalXp: 10 }), prog({ ageBand: 3, totalXp: 99 }))
        .ageBand,
    ).toBe(3);
  });

  it("reset keeps ageBand and unlockedIds", () => {
    const reset = resetProgression(
      prog({ ageBand: 2, unlockedIds: ["seed-figure"], totalXp: 500 }),
    );
    expect(reset.ageBand).toBe(2);
    expect(reset.unlockedIds).toEqual(["seed-figure"]);
    expect(reset.totalXp).toBe(0);
  });

  it("imports tvAge + finished rungs as 1 star, zero XP, once only", () => {
    const store: Record<string, string> = {
      tvAge: "2",
      tvDone: JSON.stringify({ bridges: [0, 1], little: [0] }),
      tvLittle: JSON.stringify([1]),
    };
    const get = (k: string) => store[k] ?? null;
    const { next, imported } = importCarouselMockup(prog(), get);
    expect(imported).toBe(true);
    expect(next.ageBand).toBe(2);
    expect(next.totalXp).toBe(0);
    expect(next.missionStars["lab1.bridge:t1"]).toBe(1);
    expect(next.missionStars["lab1.measure:t1"]).toBe(1);
    expect(next.missionStars["little.pop:t1"]).toBe(1);
    expect(next.missionStars["little.animals:t1"]).toBe(1);
    store["carousel:imported:v1"] = "1";
    expect(importCarouselMockup(next, get).imported).toBe(false);
    expect(importCarouselMockup(prog(), () => null).imported).toBe(false);
  });
});
