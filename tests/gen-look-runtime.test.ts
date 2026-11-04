// The runtime side of generated worlds (docs/specs/generated-worlds-spec.md section 0): a level carries a WorldLook, the world wears its palette for the time of day, and its backdrop is asked from a registry
// before the base theme's table, falling back to the base theme's own art when a layer is missing. Nothing here changes a world that has no look.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { BACKDROPS, GENERATED_MID_FIT, NIGHT_MID, backdropFor, generatedBackdrops, isBackdropRegistered, registerBackdrop, unregisterBackdrop } from "../src/features/game/world/runtime/backdrop";
import { levelWorld, WORLDS } from "../src/features/game/world/runtime/catalog";
import { lookFor, withGen } from "../src/features/game/world/runtime/worldLook";
import { buildLook, parseBrief, type WorldLook } from "../shared/worldBrief";

const root = new URL("..", import.meta.url).pathname;
const world = readFileSync(`${root}src/features/game/world/runtime/world.ts`, "utf8");

const BRIEF = {
  name: "Sweet Sunset", far: "A low round sun glows over a level line of soft purple hills in a peachy sky.", mid: "Rounded gumdrop hills with swirly lollipop trees, a candy cottage, a striped lamp post and a jelly bean rock.",
  day: { sky: ["#8a7bee", "#ff9ecd", "#ffd59e"], fog: "#ffd5e5", ground: "#a8e6a3" }, night: { sky: ["#0a0820", "#241a52", "#4a2f7a"], fog: "#2a1f4a", ground: "#2d5a47" }, say: "Let's explore this sweet place together!",
};
function look(base: "garden" | "room", over: Partial<WorldLook> = {}): WorldLook {
  const r = parseBrief(base === "room" ? { name: "Pirate Room", day: BRIEF.day, room: { wall: "stars", floor: "wood", accent: "#ff7744" } } : BRIEF, { base, safe: () => true });
  if (!r.ok) throw new Error("brief");
  return { ...buildLook(r.brief, base, "gen-0123456789"), ...over };
}
const KEY = "gen-0123456789";
afterEach(() => unregisterBackdrop(KEY));

describe("the backdrop registry", () => {
  const art = { farDay: "blob:far-day", farNight: "blob:far-night", mid: "blob:mid" };
  it("a generated world's own art is asked first, per look, and the base theme's art is what any other world gets", () => {
    registerBackdrop(KEY, generatedBackdrops(art));
    expect(backdropFor("garden", "day", KEY)!.layers[0]!.url).toBe("blob:far-day");
    expect(backdropFor("garden", "night", KEY)!.layers[0]!.url).toBe("blob:far-night");
    expect(backdropFor("garden", "day", KEY)!.layers[1]!.url).toBe("blob:mid");
    expect(backdropFor("garden", "day")).toBe(BACKDROPS.garden!.day);                              // (no key: the theme's own, exactly as before)
    expect(backdropFor("garden", "day", "gen-aaaaaaaaaa")).toBe(BACKDROPS.garden!.day);            // (a key nothing registered: the theme's own)
  });
  it("a look the generated world has no art for falls back to its BASE THEME's art, not to nothing (a layer that failed)", () => {
    registerBackdrop(KEY, generatedBackdrops({ farDay: "blob:far-day", mid: "blob:mid" }));         // no night far band
    expect(backdropFor("beach", "day", KEY)!.layers[0]!.url).toBe("blob:far-day");
    expect(backdropFor("beach", "night", KEY)).toBe(BACKDROPS.beach!.night);
    registerBackdrop(KEY, generatedBackdrops({ farDay: "blob:far-day", farNight: "blob:far-night" })); // no mid strip: neither look is complete
    expect(backdropFor("beach", "day", KEY)).toBe(BACKDROPS.beach!.day);
    expect(backdropFor("beach", "night", KEY)).toBe(BACKDROPS.beach!.night);
  });
  it("a generated world over a theme with no backdrop (the Toy Room) with no art has none, and a world with no look time has none", () => {
    expect(backdropFor("room", "day", KEY)).toBeNull();
    expect(backdropFor("garden", "", KEY)).toBeNull();
    expect(backdropFor("garden", "dusk", KEY)).toBeNull();
  });
  it("the layers are built like every world's: far untinted, mid untinted by day and tinted cool by night, at the generated fit", () => {
    const g = generatedBackdrops(art);
    expect(g.day!.layers.map((l) => [l.id, l.tint])).toEqual([["far", 0xffffff], ["mid", 0xffffff]]);
    expect(g.night!.layers.map((l) => [l.id, l.tint])).toEqual([["far", 0xffffff], ["mid", NIGHT_MID]]);
    expect(g.day!.layers[1]!.fitFrac).toBe(GENERATED_MID_FIT);
    expect(g.day!.layers[0]!.alpha).toBe(false);
    expect(g.day!.layers[1]!.alpha).toBe(true);
    expect(generatedBackdrops({ mid: "m" })).toEqual({});
  });
  it("registering twice replaces, unregistering removes, and the key is a plain own key (no prototype names)", () => {
    registerBackdrop(KEY, generatedBackdrops(art));
    expect(isBackdropRegistered(KEY)).toBe(true);
    registerBackdrop(KEY, generatedBackdrops({ ...art, farDay: "blob:other" }));
    expect(backdropFor("garden", "day", KEY)!.layers[0]!.url).toBe("blob:other");
    unregisterBackdrop(KEY);
    expect(isBackdropRegistered(KEY)).toBe(false);
    for (const k of ["toString", "constructor", "__proto__", "hasOwnProperty"]) expect(isBackdropRegistered(k), k).toBe(false);
    expect(backdropFor("garden", "day", "toString")).toBe(BACKDROPS.garden!.day);
  });
});

describe("a level carries a look and the world wears it", () => {
  it("levelWorld puts the look on the world, and a level without one has no `gen`", () => {
    const l = look("garden");
    expect(levelWorld({ theme: "garden", look: l }).gen).toBe(l);
    expect("gen" in levelWorld({ theme: "garden" })).toBe(false);
    expect(levelWorld({ theme: "garden", look: l }).theme).toBe("garden");                       // (the base theme still decides the physics, props and missions)
  });
  it("withGen lays the look's palette for the time of day over the world and leaves everything else the base theme's", () => {
    const l = look("garden");
    const def = levelWorld({ theme: "garden", look: l });
    const d = withGen(def, "day"), n = withGen(def, "night");
    expect(d.sky).toEqual(l.day.sky);
    expect(n.sky).toEqual(l.night.sky);
    expect(d.ground).toBe(l.day.ground);
    expect(n.fog).toBe(parseInt(l.night.fog.slice(1), 16));
    for (const k of ["hemi", "sun", "hills", "orb", "extras", "props", "spots", "missions", "theme"]) expect(d[k], k).toBe(def[k]);
    expect(withGen(WORLDS.garden!, "day")).toBe(WORLDS.garden!);                                  // (no look: the very same object back)
  });
  it("lookFor on a generated world: the base theme's day or night look first, then the palette; `look` says which time of day", () => {
    const l = look("garden");
    const def = levelWorld({ theme: "garden", look: l });
    const day = lookFor(def, "kid-world", "day"), night = lookFor(def, "kid-world", "night");
    expect(day.look).toBe("day");
    expect(night.look).toBe("night");
    expect(day.sky).toEqual(l.day.sky);
    expect(night.sky).toEqual(l.night.sky);
    expect(day.night).toBe(false);                                                               // (the garden's day skin: not a night rig)
    expect(night.night).toBe(true);
    expect(day.extras).not.toBe(night.extras);                                                   // (fireflies at night only: the base theme's skins still apply)
  });
  it("an indoor look is the same at every hour (its day palette), and a world with no look is untouched by lookFor's new step", () => {
    const l = look("room");
    expect(l.kind).toBe("indoor");
    const def = levelWorld({ theme: "room", look: l });
    expect(lookFor(def, "kid-world", "day").sky).toEqual(l.day.sky);
    expect(lookFor(def, "kid-world", "night").sky).toEqual(l.day.sky);
    for (const id of ["garden", "sky", "junk", "beach", "snow", "room"]) if (WORLDS[id]) expect(lookFor(WORLDS[id]!, id, "day").gen, id).toBeUndefined();
  });
  it("world.ts asks the backdrop with the look's key", () => {
    expect(world).toContain('var bd=backdropFor(R.theme||id,R.look||"",R.gen?R.gen.id:null);');
  });
});

import { roomLookExtras } from "../src/features/game/world/runtime/worldLook";
import { toHsl } from "../shared/worldBrief";

describe("an indoor look dresses the room", () => {
  const room = (over: Record<string, unknown> = {}) => { const l = look("room"); return { ...l, room: { ...l.room!, ...over } } as WorldLook; };
  it("the wall takes the palette's middle sky colour with a lighter stripe, the accent for its motifs, and the pattern from the look", () => {
    const l = room({ wall: "dots", accent: "#ff7744" });
    const r = roomLookExtras(l);
    expect(r.wall.base).toBe(l.day.sky[1]);
    expect(toHsl(r.wall.stripe)[2]).toBeGreaterThan(toHsl(r.wall.base)[2]);
    expect(r.wall.motif).toBe("#ff7744");
    for (const p of ["stars", "stripes", "dots", "plain"] as const) expect(roomLookExtras(room({ wall: p })).wall.pattern).toBe(p);
  });
  it("the rug is five rings starting at the accent and turning round the colour wheel (all visible colours, not five greys)", () => {
    const r = roomLookExtras(room({ accent: "#ff7744" }));
    expect(r.rug.cols).toHaveLength(5);
    expect(r.rug.cols[0]).toBe("#ff7744");
    expect(new Set(r.rug.cols).size).toBe(5);
    for (const c of r.rug.cols.slice(1)) { const [, s, l] = toHsl(c); expect(s).toBeGreaterThan(0.4); expect(l).toBeGreaterThan(0.35); expect(l).toBeLessThan(0.75); }
  });
  it("the floor tint is a light colour (it multiplies the wood, so a dark tint would black the floor out)", () => {
    for (const a of ["#ff7744", "#223344", "#ffffff"]) expect(toHsl(roomLookExtras(room({ accent: a })).floorTint)[2]).toBeGreaterThanOrEqual(0.54);
  });
  it("withGen on an indoor look puts the wall, the rug and the floor tint on the world and keeps the room's other extras; an outdoor look adds none of them", () => {
    const def = levelWorld({ theme: "room", look: look("room") });
    const w = withGen(def, "night");
    expect(w.extras.wall).toEqual(roomLookExtras(look("room")).wall);
    expect(w.extras.rug).toEqual(roomLookExtras(look("room")).rug);
    expect(w.floorTint).toBe(roomLookExtras(look("room")).floorTint);
    expect(w.extras.fireflies).toBe(def.extras.fireflies);
    const out = withGen(levelWorld({ theme: "garden", look: look("garden") }), "day");
    expect("floorTint" in out).toBe(false);
    expect(out.extras.wall).toBeUndefined();
  });
  it("world.ts draws the wall and the rug from the config and the floor from the tint, and with no config they are what they always were", () => {
    expect(world).toContain("function roomWall(cfg?: any){cfg=cfg&&typeof cfg===\"object\"?cfg:{};var pat=cfg.pattern||\"stars\"");
    expect(world).toContain('g.fillStyle=cfg.base||"#2a2266";');
    expect(world).toContain('g.fillStyle=cfg.stripe||"#30287a";');
    expect(world).toContain("function rug(cfg?: any)");
    expect(world).toContain('["#ff9d5c","#ffd24d","#5af0b0","#52b7ff","#a78bff"]');
    expect(world).toContain("if(E.wall)roomWall(E.wall);if(E.rug)rug(E.rug);");
    expect(world).toContain("if(GEN_FLOOR)fm.color=new T.Color(GEN_FLOOR);");
    expect(world).toContain('W.look=R.look||"";GEN_FLOOR=R.floorTint||null;');
  });
});
