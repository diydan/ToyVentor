// The win cheer (src/features/game/world/runtime/winCheer.ts; Dan, 2026-11-04: "then start 2": the baked Mixamo cheer and fist pump in place of the hand-built cheer). Every win moment asks the
// driver for the action `cheer`; this makes that the real performance, alternating two, at about the length the win moments reserve. The rules are functions of an implementation so each can
// be run on a version that is wrong on purpose and must fail.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createGestureLibrary } from "../src/features/game/world/runtime/idleBehavior";
import { CHEER_ACTION, CHEER_FILES, CHEER_SECONDS, cheerClip, createCheers, nextCheer } from "../src/features/game/world/runtime/winCheer";
import { CLEAN_CHEER_S } from "../src/features/game/world/runtime/cleanModel";
import { COOK_CHEER_S } from "../src/features/game/world/runtime/cookModel";
import { jointClipToGame, parseJointClip } from "../src/features/game/world/runtime/bakedDance";
import type { BakedClip } from "../src/features/game/world/runtime/mixamo";

const root = join(__dirname, "..");
const baked = (id: string) => readFileSync(join(root, "public/kip/mixamo/baked", `${id}.json`), "utf8");
const seeded = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const fetchOf = (overrides: Record<string, string | number> = {}): typeof fetch => (async (url: string) => {
  const id = String(url).replace(/^.*\//, "").replace(/\.json$/, "");
  const o = overrides[id];
  if (typeof o === "number") return { ok: false, status: o, text: async () => "" } as unknown as Response;
  return { ok: true, status: 200, text: async () => (typeof o === "string" ? o : baked(id)) } as unknown as Response;
}) as unknown as typeof fetch;
const realClip = (id: string): BakedClip => jointClipToGame(parseJointClip(JSON.parse(baked(id)))!, id, { joints: true });

describe("the clip a win plays", () => {
  it("is the baked clip under the name the game asks for, one-shot, at the length the win moments reserve, with its joint data", () => {
    for (const id of CHEER_FILES) {
      const src = realClip(id);
      const c = cheerClip(src);
      expect(c.name).toBe(CHEER_ACTION);
      expect(c.name).toBe("cheer");
      expect(c.loop).toBe(false);
      expect(c.pose).toBe(false);
      expect(c.duration).toBe(CHEER_SECONDS);
      expect(c.frames).toBe(src.frames);
      expect(c.joints).toBeDefined();
      expect(c.joints).toBe(src.joints); // the same data, played faster: not copied, not changed
    }
  });
  it("leaves the clip it was made from alone", () => {
    const src = realClip("react_cheer");
    const before = { name: src.name, duration: src.duration, loop: src.loop };
    cheerClip(src);
    expect({ name: src.name, duration: src.duration, loop: src.loop }).toEqual(before);
    expect(src.duration).toBeGreaterThan(3); // the real clip is 3.4 s
  });
  it("lasts about as long as the win moments reserve for it: not shorter than cleaning's 1.8 s by more than a fifth of a second, not longer than cooking's 2.0 s by more than a tenth", () => {
    expect(CHEER_SECONDS).toBeGreaterThanOrEqual(CLEAN_CHEER_S - 0.2);
    expect(CHEER_SECONDS).toBeLessThanOrEqual(COOK_CHEER_S + 0.1);
  });
  it("survives a length that is not a number", () => {
    for (const bad of [NaN, Infinity, -1, 0]) expect(cheerClip(realClip("react_cheer"), bad).duration).toBe(CHEER_SECONDS);
  });
});

describe("which cheer comes next", () => {
  /** The rules, as a function of the picker. Returns what is wrong. */
  function failures(pick: (last: string | null, have: readonly string[], rng: () => number) => string | null): string[] {
    const bad = new Set<string>();
    const both: string[] = [...CHEER_FILES];
    // two loaded: they alternate, starting from either
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const rng = seeded(seed);
      let last: string | null = null;
      for (let i = 0; i < 12; i++) {
        const n = pick(last, both, rng);
        if (n === null || !both.includes(n)) { bad.add("a cheer that is loaded"); break; }
        if (n === last) { bad.add("two wins in a row are not the same cheer"); break; }
        last = n;
      }
    }
    // the first pick is not always the same one
    const firsts = new Set([0.1, 0.4, 0.6, 0.9].map((r) => pick(null, both, () => r)));
    if (firsts.size < 2) bad.add("the first cheer is not always the same");
    // one loaded: that one, every time; none: nothing, so the hand-built cheer stays
    for (const only of both) { let last: string | null = null; for (let i = 0; i < 4; i++) { const n = pick(last, [only], seeded(9)); if (n !== only) bad.add("with one loaded, that one"); last = n; } }
    if (pick(null, [], seeded(3)) !== null) bad.add("with none loaded, nothing (the hand-built cheer stays)");
    // never something that is not one of ours, even if it is "loaded"
    if (pick(null, ["dance_silly"], seeded(3)) !== null) bad.add("only our own cheers");
    return [...bad];
  }
  it("alternates the two, starts with either, uses the only one there is, and says nothing when there is none", () => {
    expect(failures(nextCheer)).toEqual([]);
  });
  it("is caught when it repeats one, always starts with the same, ignores what is loaded, or picks what is not ours", () => {
    expect(failures((last, have) => (have.includes("react_cheer") ? "react_cheer" : null)).length).toBeGreaterThan(0);
    expect(failures((last, have, rng) => (have.length ? have[Math.floor(rng() * have.length)]! : null)).length).toBeGreaterThan(0); // random: repeats
    expect(failures((last, have) => (have.length ? (last === "react_cheer" ? "react_fistpump" : "react_cheer") : null)).length).toBeGreaterThan(0); // first pick fixed; picks one that is not loaded
    expect(failures((last, have) => (last === "dance_silly" ? null : have[0] ?? "dance_silly")).length).toBeGreaterThan(0);
  });
  it("survives a draw that is not a number", () => {
    for (const bad of [NaN, -1, Infinity]) expect(CHEER_FILES).toContain(nextCheer(null, [...CHEER_FILES], () => bad));
  });
});

describe("the cheers in the driver's bank", () => {
  function make(over: Record<string, string | number> = {}, rng: () => number = seeded(5)) {
    const bank: Record<string, BakedClip> = {};
    let adds = 0;
    const cheers = createCheers({ fetchImpl: fetchOf(over), addClips: (c) => { adds++; Object.assign(bank, c); }, rng });
    return { cheers, bank, adds: () => adds };
  }
  it("loads both real files and puts the next one in the bank as `cheer` each time, alternating", async () => {
    const { cheers, bank } = make();
    expect((await cheers.load()).sort()).toEqual([...CHEER_FILES].sort());
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      expect(cheers.roll()).toBe(true);
      expect(bank.cheer!.name).toBe("cheer");
      expect(bank.cheer!.duration).toBe(CHEER_SECONDS);
      seen.push(bank.cheer!.frames === realClip("react_cheer").frames ? "cheer" : "fistpump");
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1]);
    expect(Object.keys(bank)).toEqual(["cheer"]); // nothing else is put in the driver's bank by the win cheer
  });
  it("leaves the hand-built cheer in the bank until a file has loaded, and when none can", async () => {
    const m = make();
    expect(m.cheers.roll()).toBe(false);
    expect(m.adds()).toBe(0);
    const broken = make({ react_cheer: 404, react_fistpump: "{not json" });
    expect(await broken.cheers.load()).toEqual([]);
    expect(broken.cheers.roll()).toBe(false);
    expect(broken.adds()).toBe(0);
  });
  it("uses the one that loaded when the other file is missing or is a different clip", async () => {
    const wrongId = baked("react_wave"); // a real file, but not the cheer it is asked for
    for (const over of [{ react_fistpump: 404 }, { react_fistpump: wrongId }] as const) {
      const { cheers, bank } = make(over);
      expect(await cheers.load()).toEqual(["react_cheer"]);
      for (let i = 0; i < 3; i++) { expect(cheers.roll()).toBe(true); expect(bank.cheer!.name).toBe("cheer"); }
      expect(cheers.loaded()).toEqual(["react_cheer"]);
    }
  });
  it("the shared loader refuses a file that is not on the list it was given (the idle files are not cheers, and the other way round)", async () => {
    const bank: Record<string, BakedClip> = {};
    const lib = createGestureLibrary({ fetchImpl: fetchOf(), addClips: (c) => Object.assign(bank, c), allowed: CHEER_FILES });
    expect(await lib.ensure(["dance_silly", "react_wave", "react_cheer"])).toEqual(["react_cheer"]);
    const idleLib = createGestureLibrary({ fetchImpl: fetchOf(), addClips: (c) => Object.assign(bank, c) });
    expect(await idleLib.ensure(["react_cheer", "react_fistpump"])).toEqual([]);
  });
});

describe("the world's use of it", () => {
  const w = readFileSync(join(root, "src/features/game/world/runtime/world.ts"), "utf8");
  it("rolls the next cheer just before every `cheer` is triggered, so every win moment (cooking, cleaning, the mop and the box, the jump) gets it", () => {
    const i = w.indexOf("function mixGo(");
    const line = w.slice(i, w.indexOf("\n", i));
    expect(line).toContain('if(a==="cheer")CHEERS.roll();');
    expect(line.indexOf('CHEERS.roll()')).toBeLessThan(line.indexOf("mix.trigger(a,o)"));
  });
  it("loads the files when the driver starts, into the driver's bank", () => {
    expect(w).toMatch(/var CHEERS=createCheers\(\{fetchImpl:.*addClips:function\(c: Record<string,BakedClip>\)\{if\(mix\)mix\.addClips\(c\)\}\}\);/);
    expect(w).toContain("function startGestures(){CHEERS.load().catch(function(){});");
  });
});
