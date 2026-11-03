import { describe, expect, it } from "vitest";
import { LEVELS, MOOD_DEF, PART, PROPS, levelWorld } from "../src/features/game/world/runtime/catalog";
import {
  MOODS,
  THEME_IDS,
  checkLevel,
  codeToSeed,
  composeLevel,
  kitSize,
  seedToCode,
} from "../src/features/game/world/runtime/levelKit";
import { LIGHT_RIGS, moodRig, rigFor } from "../src/features/game/world/runtime/lighting";

const SEEDS = 3000;
const sig = (l: ReturnType<typeof composeLevel>) =>
  JSON.stringify([l.theme, l.mood, l.spots.map((s) => [s.hide, s.part, s.x]), l.props.map((p) => [p.type, p.x]), l.missions?.map((m) => [m.type, m.x])]);

describe("level kit composer", () => {
  it("is deterministic: the same seed and options always give the same level", () => {
    for (const seed of [1, 42, 99999, 0xdeadbeef]) {
      expect(JSON.stringify(composeLevel({ seed }))).toBe(JSON.stringify(composeLevel({ seed })));
    }
    expect(composeLevel({ seed: 7 }).id).not.toBe(composeLevel({ seed: 8 }).id);
  });

  it(`passes the editor's own checks on ${SEEDS} seeds, with nothing the engine cannot build`, () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const l = composeLevel({ seed });
      const bad = checkLevel(l).filter((c) => !c.ok).map((c) => c.n);
      expect(bad, `seed ${seed} ${l.theme}/${l.mood}`).toEqual([]);
      expect(l.format).toBe("toyventor.level/1");
      expect(l.props.length).toBeGreaterThanOrEqual(4);
      // The compiled world keeps every spot and prop (levelWorld silently drops unknown ones).
      const w = levelWorld(l);
      expect(w.spots.length).toBe(l.spots.length);
      expect(w.props.length).toBe(l.props.length);
      expect(w.theme).toBe(l.theme);
      for (const m of l.missions ?? []) expect(m.free).toBe(true); // never gated behind blueprints a child may not have
    }
  });

  it("never puts a mission station on top of a hiding spot or another station", () => {
    for (let seed = 1; seed <= 500; seed++) {
      const l = composeLevel({ seed });
      for (const m of l.missions ?? []) {
        for (const s of l.spots) expect(Math.abs(s.x - m.x)).toBeGreaterThanOrEqual(3.5);
      }
      const ms = (l.missions ?? []).map((m) => m.x);
      for (let i = 1; i < ms.length; i++) expect(Math.abs(ms[i]! - ms[0]!)).toBeGreaterThanOrEqual(6);
    }
  });

  it("is genuinely varied: almost no repeats, and every theme and mood shows up", () => {
    const seen = new Set<string>();
    const themes = new Set<string>();
    const moods = new Set<string>();
    for (let seed = 1; seed <= 2000; seed++) {
      const l = composeLevel({ seed });
      seen.add(sig(l));
      themes.add(l.theme);
      moods.add(l.mood);
    }
    expect(seen.size).toBeGreaterThan(1990);
    expect([...themes].sort()).toEqual([...THEME_IDS].sort());
    expect([...moods].sort()).toEqual([...MOODS].sort());
  });

  it("honours a forced theme and mood", () => {
    for (const theme of THEME_IDS) {
      const l = composeLevel({ seed: 5, theme, mood: "dusk" });
      expect(l.theme).toBe(theme);
      expect(l.mood).toBe("dusk");
    }
  });

  it("hides parts the child has not found yet before repeating ones they have", () => {
    const pool = Object.keys(PART).filter((k) => PART[k]!.w && PART[k]!.st !== "none");
    const owned = new Set(pool.slice(0, pool.length - 5)); // exactly five unfound parts left
    for (let seed = 1; seed <= 50; seed++) {
      const l = composeLevel({ seed, owned });
      expect(l.spots.every((s) => !owned.has(s.part))).toBe(true);
      expect(checkLevel(l).every((c) => c.ok)).toBe(true);
    }
    // Everything owned: the level still builds (spots reuse parts) and passes the same bar.
    const all = new Set(pool);
    expect(checkLevel(composeLevel({ seed: 3, owned: all })).every((c) => c.ok)).toBe(true);
  });

  it("holds hand-made explore worlds to the same bar (so the checks are not stricter than the real levels)", () => {
    for (const l of LEVELS.filter((x) => x.spots.length === 5)) {
      const bad = checkLevel(l).filter((c) => !c.ok).map((c) => c.n);
      expect(bad, l.id).toEqual([]);
    }
  });

  it("round-trips seed codes", () => {
    for (const seed of [0, 1, 36, 1295, 123456, 0xfffffff]) expect(codeToSeed(seedToCode(seed))).toBe(seed >>> 0);
    expect(seedToCode(1).length).toBeGreaterThanOrEqual(4);
  });

  it("K1: pinnedProps are placed verbatim in order, and the kit composes around them", () => {
    const pinned = [
      { type: "books", x: 8 },
      { type: "lamp", x: 20 },
      { type: "blocks", x: 33 },
    ];
    for (let seed = 1; seed <= 200; seed++) {
      const l = composeLevel({ seed, theme: "room", pinnedProps: pinned });
      // Every pinned prop survives, in photo order, at its pinned x.
      const at = pinned.map((p) => l.props.findIndex((q) => q.type === p.type && q.x === p.x));
      expect(at.every((i) => i >= 0), `seed ${seed}`).toBe(true);
      expect(at).toEqual([...at].sort((a, b) => a - b));
      // The level still passes the shared bar, and no spot cover sits on a pinned prop.
      expect(checkLevel(l).every((c) => c.ok), `seed ${seed}`).toBe(true);
      for (const s of l.spots) for (const p of pinned) expect(Math.abs(s.x - p.x)).toBeGreaterThanOrEqual(1.6);
      const w = levelWorld(l);
      expect(w.spots.length).toBe(l.spots.length);
      expect(w.props.length).toBe(l.props.length);
    }
    // Unknown pinned types are dropped, never invented; empty pinnedProps is a no-op.
    const l = composeLevel({ seed: 9, pinnedProps: [{ type: "not-a-prop", x: 10 }, { type: "tree", x: 12 }] });
    expect(l.props.some((p) => p.type === "not-a-prop")).toBe(false);
    expect(l.props.some((p) => p.type === "tree" && p.x === 12)).toBe(true);
    expect(JSON.stringify(composeLevel({ seed: 42, pinnedProps: [] }))).toBe(JSON.stringify(composeLevel({ seed: 42 })));
    // Deterministic with pinned props too.
    expect(JSON.stringify(composeLevel({ seed: 7, pinnedProps: pinned }))).toBe(
      JSON.stringify(composeLevel({ seed: 7, pinnedProps: pinned })),
    );
  });

  it("K2: the room prop pack is in the catalog and shows up in composed room levels", () => {
    const pack = ["chair", "plant", "teddy", "ball", "cushions"];
    for (const t of pack) expect(PROPS[t], t).toBeTruthy();
    const seen = new Set<string>();
    for (let seed = 1; seed <= 300; seed++) {
      const l = composeLevel({ seed, theme: "room" });
      expect(checkLevel(l).every((c) => c.ok), `seed ${seed}`).toBe(true);
      for (const p of l.props) seen.add(p.type);
    }
    for (const t of pack) expect(seen.has(t), t).toBe(true);
  });

  it("reports a kit size in the billions", () => {
    expect(kitSize()).toBeGreaterThan(1e9);
  });
});

describe("moods re-skin any theme", () => {
  it("applies the mood's sky, fog and night flag through levelWorld", () => {
    for (const mood of MOODS) {
      const w = levelWorld({ theme: "beach", mood, props: [], spots: [], missions: [] });
      expect(w.mood).toBe(mood);
      expect(w.night).toBe(MOOD_DEF[mood]!.night);
      expect(w.sky).toEqual(MOOD_DEF[mood]!.sky);
      expect(w.fog).toBe(MOOD_DEF[mood]!.fog);
    }
    expect(levelWorld({ theme: "beach", props: [], spots: [], missions: [] }).mood).toBeUndefined();
  });

  it("gives every theme x mood a complete, sane light rig (no blown-out exposure)", () => {
    for (const theme of THEME_IDS) {
      for (const mood of [undefined, ...MOODS]) {
        const rig = rigFor({ theme, ...(mood ? { mood } : {}) }, theme);
        // key + hemi + rim well under the level that used to white-out the day worlds (hemi 1.95, sun 2.47)
        expect(rig.key.i).toBeLessThan(2.4);
        expect(rig.hemi.i).toBeLessThan(1.2);
        expect(rig.exposure).toBeGreaterThan(0.8);
        expect(rig.exposure).toBeLessThan(1.2);
        expect(rig.bloom.threshold).toBeGreaterThan(0.8);
        expect(rig.fog.far).toBeGreaterThan(rig.fog.near);
      }
    }
    expect(moodRig(LIGHT_RIGS.garden!, "day").key.color).not.toBe(LIGHT_RIGS.garden!.key.color);
  });

  it("every catalog prop used by a cluster exists", () => {
    for (let seed = 1; seed <= 200; seed++) for (const p of composeLevel({ seed }).props) expect(PROPS[p.type], p.type).toBeTruthy();
  });
});

describe("level kit difficulty tier", () => {
  const N = 600;

  it("tier 1 (or none) is byte-identical to the plain composer, so every shared seed replays the same", () => {
    for (let seed = 1; seed <= N; seed++) {
      const plain = JSON.stringify(composeLevel({ seed }));
      expect(JSON.stringify(composeLevel({ seed, tier: 1 })), `seed ${seed}`).toBe(plain);
    }
    // A forced theme and mood are unaffected too.
    expect(JSON.stringify(composeLevel({ seed: 9, theme: "beach", mood: "dusk", tier: 1 }))).toBe(
      JSON.stringify(composeLevel({ seed: 9, theme: "beach", mood: "dusk" })),
    );
  });

  it("tier 2 and 3 start every station at that tier and never carry more than three", () => {
    for (const tier of [2, 3] as const) {
      for (let seed = 1; seed <= N; seed++) {
        const l = composeLevel({ seed, tier });
        const ms = l.missions ?? [];
        expect(ms.length, `seed ${seed} tier ${tier}`).toBeLessThanOrEqual(3);
        for (const m of ms) {
          expect(m.tier).toBe(tier);
          expect(m.free).toBe(true);
        }
      }
    }
    // Tier 1 stations carry no tier field at all (the byte-identical shape).
    for (let seed = 1; seed <= 50; seed++) {
      for (const m of composeLevel({ seed }).missions ?? []) expect("tier" in m).toBe(false);
    }
  });

  it("a higher tier is genuinely more to do: more stations on average", () => {
    const mean = (tier?: 1 | 2 | 3) => {
      let n = 0;
      for (let seed = 1; seed <= N; seed++) n += (composeLevel({ seed, tier }).missions ?? []).length;
      return n / N;
    };
    expect(mean(2)).toBeGreaterThan(mean(1) + 0.5);
    expect(mean(3)).toBeGreaterThan(mean(1) + 0.5);
  });

  it("every tiered level still passes the editor's own checks, and keeps exactly five spots", () => {
    for (const tier of [2, 3] as const) {
      for (let seed = 1; seed <= N; seed++) {
        const l = composeLevel({ seed, tier });
        const bad = checkLevel(l).filter((c) => !c.ok).map((c) => c.n);
        expect(bad, `seed ${seed} tier ${tier} ${l.theme}`).toEqual([]);
        expect(l.spots).toHaveLength(5);
        // Stations keep clear of the spots and of each other.
        const ms = l.missions ?? [];
        for (const m of ms) for (const s of l.spots) expect(Math.abs(s.x - m.x)).toBeGreaterThanOrEqual(3.5);
        for (let i = 0; i < ms.length; i++) {
          for (let j = i + 1; j < ms.length; j++) expect(Math.abs(ms[i]!.x - ms[j]!.x)).toBeGreaterThanOrEqual(6);
        }
      }
    }
  });
});
