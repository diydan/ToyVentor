// The reusable lighting setting and the cost and glare review behind it (lighting.ts, worldScene.ts; Dan, 2026-11-04: "bloom and light sometimes a bit too reflective, do a review on lighting,
// ideally a reusable setting for all scenes and levels with an indoor and outdoor, night and day", and "performance is a bit slow, any obvious wins for animated scenes").
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { LIGHT_PRESETS, LIGHT_RIGS, bloomWanted, moodRig, presetFor, rigFor, type LightRig, type PresetId } from "../src/features/game/world/runtime/lighting";
import { MAX_PIXEL_RATIO, QUALITY, SHADOW_MAP, metal, paintMat, perf, plastic, qualityTick, stepsFor } from "../src/features/game/world/runtime/worldScene";
import { levelWorld } from "../src/features/game/world/runtime/catalog";

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");
const IDS: PresetId[] = ["outdoor-day", "outdoor-night", "indoor-day", "indoor-night"];
const lights = (r: LightRig) => ({ exposure: r.exposure, hemi: r.hemi, key: r.key, rim: r.rim, hero: r.hero, env: r.env, fog: r.fog, bloom: r.bloom });

describe("the four presets are the whole vocabulary", () => {
  it("indoor and outdoor, day and night, each complete and sane", () => {
    expect(Object.keys(LIGHT_PRESETS).sort()).toEqual([...IDS].sort());
    for (const id of IDS) {
      const r = LIGHT_PRESETS[id];
      expect(r.exposure, id).toBeGreaterThan(0.8);
      expect(r.exposure, id).toBeLessThan(1.2);
      expect(r.key.i, id).toBeGreaterThan(0.5);
      expect(r.key.i, id).toBeLessThan(2.2);
      expect(r.hemi.i, id).toBeGreaterThan(0.3);
      expect(r.fog.near, id).toBeLessThan(r.fog.far);
      expect(r.env.scale, id).toBeGreaterThan(0.3);
      expect(r.env.scale, id).toBeLessThanOrEqual(0.6);   // the reflection budget: the studio environment must not read as a mirror
      expect(r.bloom.threshold, id).toBeGreaterThan(0.8);
    }
  });

  it("presetFor names the preset by place and time", () => {
    expect(presetFor("outdoor", "day")).toBe(LIGHT_PRESETS["outdoor-day"]);
    expect(presetFor("outdoor", "night")).toBe(LIGHT_PRESETS["outdoor-night"]);
    expect(presetFor("indoor", "day")).toBe(LIGHT_PRESETS["indoor-day"]);
    expect(presetFor("indoor", "night")).toBe(LIGHT_PRESETS["indoor-night"]);
  });

  it("day and night differ where it matters, and indoors differs from outdoors: a lamp and a window, not a sun and a moon", () => {
    const keys = new Set(IDS.map((id) => LIGHT_PRESETS[id].key.color));
    expect(keys.size).toBeGreaterThanOrEqual(3);
    expect(LIGHT_PRESETS["outdoor-day"].key.i).toBeLessThan(LIGHT_PRESETS["outdoor-night"].key.i);       // the sun is a softer key than the moon needs to be: day used to white out
    expect(LIGHT_PRESETS["indoor-day"].hero.i).toBe(0);                                                    // no fill light on the hero by day
    expect(LIGHT_PRESETS["indoor-night"].hero.i).toBeGreaterThan(0);                                       // a warm one at night so the face reads
    expect(LIGHT_PRESETS["indoor-night"].key.pos).not.toEqual(LIGHT_PRESETS["outdoor-night"].key.pos);
  });
});

describe("a world picks its look by place and mood", () => {
  it("the Toy Room is indoors and the default look is the evening; the worlds are outdoors", () => {
    expect(rigFor({ theme: "room" }, "room")).toEqual(LIGHT_PRESETS["indoor-night"]);
    expect(LIGHT_RIGS.room).toBe(LIGHT_PRESETS["indoor-night"]);
    for (const t of ["garden", "sky", "junk", "beach", "snow"]) expect(LIGHT_RIGS[t], t).toBeDefined();
  });

  it("mood day or night swaps the lights for the place's preset and keeps the world's own grade", () => {
    const room = rigFor({ theme: "room", mood: "day" }, "room");
    expect(lights(room)).toEqual(lights(LIGHT_PRESETS["indoor-day"]));
    expect(room.grade).toEqual(LIGHT_RIGS.room!.grade);
    const garden = rigFor({ theme: "garden", mood: "day" }, "garden");
    expect(lights(garden)).toEqual(lights(LIGHT_PRESETS["outdoor-day"]));
    expect(garden.grade).toEqual(LIGHT_RIGS.garden!.grade);
    expect(lights(rigFor({ theme: "sky", mood: "night" }, "sky"))).toEqual(lights(LIGHT_PRESETS["outdoor-night"]));
    expect(lights(rigFor({ theme: "room", mood: "night" }, "room"))).toEqual(lights(LIGHT_PRESETS["indoor-night"]));
  });

  it("a world can name its place: an outdoor theme set indoors gets the indoor preset in its own grade", () => {
    const r = rigFor({ theme: "beach", place: "indoor", mood: "day" }, "beach");
    expect(lights(r)).toEqual(lights(LIGHT_PRESETS["indoor-day"]));
    expect(r.grade).toEqual(LIGHT_RIGS.beach!.grade);
    expect(lights(rigFor({ theme: "room", place: "outdoor", mood: "night" }, "room"))).toEqual(lights(LIGHT_PRESETS["outdoor-night"]));
  });

  it("an unknown theme (a generated or made-up world) falls back to the preset for its place and time", () => {
    expect(rigFor({}, "mystery")).toEqual(LIGHT_PRESETS["outdoor-day"]);
    expect(rigFor({ night: true }, "mystery")).toEqual(LIGHT_PRESETS["outdoor-night"]);
    expect(rigFor({ place: "indoor", night: true }, "mystery")).toEqual(LIGHT_PRESETS["indoor-night"]);
    expect(rigFor({ place: "indoor" }, "mystery")).toEqual(LIGHT_PRESETS["indoor-day"]);
  });

  it("an explicit light override still wins, and dusk keeps its own sunset rig", () => {
    expect(rigFor({ theme: "garden", light: { exposure: 1.1 } }, "garden").exposure).toBe(1.1);
    const dusk = moodRig(LIGHT_RIGS.garden!, "dusk");
    expect(dusk.key.color).toBe(0xffc29a);
    expect(dusk.bloom.threshold).toBeGreaterThan(1.2);
  });

  it("a level can say where it is: the optional place reaches its world, and nothing else does", () => {
    expect(levelWorld({ theme: "garden", mood: "day", place: "indoor" })).toMatchObject({ place: "indoor", mood: "day" });
    expect(levelWorld({ theme: "garden", place: "outdoor" }).place).toBe("outdoor");
    expect(levelWorld({ theme: "garden", place: "underwater" }).place).toBeUndefined();
    expect(levelWorld({ theme: "garden" }).place).toBeUndefined();
  });
});

describe("glare: bloom is rarer, softer, and skipped where it cannot show", () => {
  it("the bloom rule: a strength of about 0 or a threshold of 2 and above is off", () => {
    expect(bloomWanted({ strength: 0.3, threshold: 1.25 })).toBe(true);
    expect(bloomWanted({ strength: 0.12, threshold: 2.4 })).toBe(false);
    expect(bloomWanted({ strength: 0, threshold: 1 })).toBe(false);
    expect(bloomWanted({ strength: 0.02, threshold: 1 })).toBe(false);
    expect(bloomWanted({ strength: 0.3, threshold: 2.0 })).toBe(false);
    expect(bloomWanted({ strength: 0.3, threshold: 1.99 })).toBe(true);
  });

  it("every day look skips the bloom pass; every night look keeps a soft one (strength at most 0.35, threshold at least 1.2)", () => {
    for (const id of ["outdoor-day", "indoor-day"] as PresetId[]) expect(bloomWanted(LIGHT_PRESETS[id].bloom), id).toBe(false);
    for (const id of ["outdoor-night", "indoor-night"] as PresetId[]) {
      const b = LIGHT_PRESETS[id].bloom;
      expect(bloomWanted(b), id).toBe(true);
      expect(b.strength, id).toBeLessThanOrEqual(0.35);
      expect(b.threshold, id).toBeGreaterThanOrEqual(1.2);
    }
    for (const t of ["sky", "beach"]) expect(bloomWanted(LIGHT_RIGS[t]!.bloom), t).toBe(false);
    for (const t of ["garden", "junk", "snow", "room"]) {
      expect(bloomWanted(LIGHT_RIGS[t]!.bloom), t).toBe(true);
      expect(LIGHT_RIGS[t]!.bloom.strength, t).toBeLessThanOrEqual(0.35);
      expect(LIGHT_RIGS[t]!.bloom.threshold, t).toBeGreaterThanOrEqual(1.2);
    }
  });

  it("syncPost turns the pass on or off with the rig, and never back on once quality was lowered", () => {
    const src = read("src/features/game/world/runtime/lighting.ts");
    expect(src).toContain("if (!quality.low) bloom.enabled = bloomWanted(rig.bloom);");
    const scene = read("src/features/game/world/runtime/worldScene.ts");
    expect(scene).toContain("{quality.low=true;bloom.enabled=false;");
  });
});

describe("reflections: the shared materials are satin, not mirror", () => {
  it("plastic, the toy paint and metal stay inside the reflection budget", () => {
    const p = plastic("#ffffff");
    expect(p.clearcoat).toBeLessThanOrEqual(0.35);
    expect(p.clearcoatRoughness).toBeGreaterThanOrEqual(0.3);
    expect(p.roughness).toBeGreaterThanOrEqual(0.4);
    expect(p.envMapIntensity).toBeLessThanOrEqual(0.6);
    const t = paintMat("#ff0000");
    expect(t.clearcoat).toBeLessThanOrEqual(0.35);
    expect(t.clearcoatRoughness).toBeGreaterThanOrEqual(0.3);
    expect(t.metalness).toBeLessThanOrEqual(0.1);
    expect(t.envMapIntensity).toBeLessThanOrEqual(0.6);
    const m = metal("#999999");
    expect(m.envMapIntensity).toBeLessThanOrEqual(1.0);
    expect(m.roughness).toBeGreaterThanOrEqual(0.35);
  });

  it("a caller can still ask for a glossier material (the Kip's skin and the glass do), so only the defaults moved", () => {
    expect(plastic("#f3ba95", { roughness: 0.55, clearcoat: 0.12 }).clearcoat).toBe(0.12);
    expect(plastic("#ffffff", { clearcoat: 1 }).clearcoat).toBe(1);
  });
});

describe("cost: the knobs that were measured", () => {
  it("a phone's pixel ratio is capped at 1.5 and the sun's shadow map at 1024", () => {
    expect(MAX_PIXEL_RATIO).toBeLessThanOrEqual(1.5);
    expect(SHADOW_MAP).toBeLessThanOrEqual(1024);
    const src = read("src/features/game/world/runtime/worldScene.ts");
    expect(src).toContain("renderer.setPixelRatio(Math.min(QP === \"low\" ? 1 : MAX_PIXEL_RATIO, window.devicePixelRatio || 1));");
    expect(src).toContain("sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);");
  });

  it("how many steps a slow window takes: none at 33 fps or better, one when slower, two when very slow, never past the last", () => {
    expect(stepsFor(1 / 60, 0)).toBe(0);
    expect(stepsFor(QUALITY.slowS, 0)).toBe(0);                    // exactly 33 ms is still fine
    expect(stepsFor(QUALITY.slowS + 0.001, 0)).toBe(1);
    expect(stepsFor(QUALITY.verySlowS, 0)).toBe(1);
    expect(stepsFor(QUALITY.verySlowS + 0.001, 0)).toBe(2);
    expect(stepsFor(0.05, 1)).toBe(1);                              // one is left
    expect(stepsFor(0.05, 2)).toBe(0);
    expect(stepsFor(0.031, 2)).toBe(0);
    for (const bad of [0, -1, NaN, Infinity * 0]) expect(stepsFor(bad, 0)).toBe(0);
  });

  describe("the rolling check", () => {
    beforeEach(() => { perf.n = 0; perf.sum = 0; perf.done = false; perf.taken = 0; perf.hold = 0; });
    const run = (frames: number, dt: number, t0: number) => { let t = t0; let resizes = 0; for (let i = 0; i < frames; i++) { t += dt; qualityTick(dt, t, () => { resizes++; }); } return { t, resizes }; };

    it("a very slow start takes its steps once the warm-up is over (15 s of 50 ms frames)", () => {
      run(300, 0.05, 0);
      expect(perf.taken).toBe(2);
      expect(perf.done).toBe(true);
    });

    it("waits out the warm-up before it counts a single frame", () => {
      let t = 0;
      for (let i = 0; i < 100; i++) { t += 0.02; qualityTick(0.05, Math.min(t, QUALITY.warmupS - 0.1), () => undefined); }   // the clock stays inside the warm-up
      expect(perf.n).toBe(0);
      expect(perf.taken).toBe(0);
    });

    it("a phone at 40 fps (25 ms) is left alone, and a phone at 20 fps (50 ms) takes both steps and stops checking", () => {
      const fast = run(600, 0.025, 10);
      expect(perf.taken).toBe(0);
      expect(perf.done).toBe(false);
      expect(fast.resizes).toBe(0);
      perf.n = 0; perf.sum = 0;
      run(QUALITY.window, 0.05, 20);
      expect(perf.taken).toBe(2);
      expect(perf.done).toBe(true);
    });

    it("a slow stretch later in the session is caught (the old check looked once, at the start), and after a step it settles before judging again", () => {
      run(600, 0.016, 10);                                                        // a good start
      expect(perf.taken).toBe(0);
      const slow = run(QUALITY.window, 0.034, 30);                                // then a party or a big world: 29 fps
      expect(perf.taken).toBe(1);
      expect(perf.hold).toBeGreaterThan(slow.t);                                  // a pause to settle
      const before = perf.n;
      qualityTick(0.034, slow.t + 0.1, () => undefined);                          // inside the settle: not counted
      expect(perf.n).toBe(before);
    });

    it("the world's frame loop uses it, and the one-shot check is gone", () => {
      const w = read("src/features/game/world/runtime/world.ts");
      expect(w).toContain("qualityTick(dt,t,resize);");
      expect(w).not.toContain("perf.n>=90");
    });
  });
});
