import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WORLDS, THEME_DEF, levelWorld, type WorldDef } from "../src/features/game/world/runtime/catalog";
import { LIGHT_RIGS, rigFor } from "../src/features/game/world/runtime/lighting";
import { CLOCK_THEMES, PAINTED_FOR, SKINS, clockTheme, followsClock, lookFor } from "../src/features/game/world/runtime/worldLook";

const HEX = /^#[0-9a-f]{6}$/i;
const OTHER = (t: "day" | "night") => (t === "day" ? "night" : "day");

describe("which worlds follow the clock", () => {
  it("the five outdoor themes do, and the Toy Room does not (indoor scenes are identical at any hour)", () => {
    expect([...CLOCK_THEMES].sort()).toEqual(["beach", "garden", "junk", "sky", "snow"]);
    for (const id of ["garden", "sky", "junk", "beach", "snow"]) expect(followsClock(WORLDS[id]!, id), id).toBe(true);
    expect(followsClock(WORLDS.room!, "room")).toBe(false);
  });
  it("a lab takes the clock behaviour of its theme (Lab 1 is a garden, Lab 5 a sky, Lab 6 the Toy Room)", () => {
    expect(clockTheme(WORLDS.lab1!, "lab1")).toBe("garden");
    expect(clockTheme(WORLDS.lab5!, "lab5")).toBe("sky");
    expect(clockTheme(WORLDS.lab2!, "lab2")).toBe("junk");
    expect(clockTheme(WORLDS.lab3!, "lab3")).toBe("beach");
    expect(clockTheme(WORLDS.lab4!, "lab4")).toBe("snow");
    expect(clockTheme(WORLDS.lab6!, "lab6")).toBeNull();
  });
  it("a world with a theme the game does not know stays as it is", () => {
    const odd = { ...WORLDS.garden!, theme: "volcano" } as WorldDef;
    expect(clockTheme(odd, "x")).toBeNull();
    expect(lookFor(odd, "x", "day")).toBe(odd);
  });
  it("a generated level that names its own mood keeps it: the child chose that look", () => {
    const pinned = levelWorld({ theme: "garden", mood: "dusk", props: [] });
    expect(followsClock(pinned, "mine")).toBe(false);
    expect(lookFor(pinned, "mine", "day")).toBe(pinned);
    expect(lookFor(pinned, "mine", "night")).toBe(pinned);
    const free = levelWorld({ theme: "garden", props: [] });
    expect(followsClock(free, "mine")).toBe(true);
  });
});

describe("the time of day each world was painted for", () => {
  it("is what the world definition already says: the painted look is untouched at its own time of day", () => {
    for (const [theme, painted] of Object.entries(PAINTED_FOR)) {
      const def = WORLDS[theme]!;
      expect(def.night, theme).toBe(painted === "night");
      const look = lookFor(def, theme, painted);
      expect(look.look).toBe(painted);
      expect(look.mood, theme).toBeUndefined();                                   // no mood: the theme's own light rig, tuned for it, is used
      for (const k of ["sky", "fog", "ground", "hills", "orb", "extras", "night", "hemi", "sun"] as const) expect(look[k], `${theme}.${k}`).toEqual(def[k]);
    }
  });
  it("the Garden, the Junkyard and Snow Peak were painted at night, Sky Meadow and the Beach by day", () => {
    expect(PAINTED_FOR).toEqual({ garden: "night", sky: "day", junk: "night", beach: "day", snow: "night" });
  });
});

describe("the other time of day", () => {
  for (const theme of CLOCK_THEMES) {
    const painted = PAINTED_FOR[theme]!;
    const other = OTHER(painted);
    describe(theme, () => {
      const look = lookFor(WORLDS[theme]!, theme, other);
      it("is the opposite time of day: the night flag, the sky and the light rig say so", () => {
        expect(look.look).toBe(other);
        expect(look.mood).toBe(other);
        expect(look.night).toBe(other === "night");
        expect(rigFor(look, theme)).not.toEqual(rigFor(WORLDS[theme]!, theme));      // `mood` makes lighting.ts swap to a different rig
      });
      it("changes what makes the time of day, and keeps what makes the place", () => {
        const def = WORLDS[theme]!;
        expect(look.sky).not.toEqual(def.sky);
        expect(look.ground).not.toBe(def.ground);
        expect(look.fog).not.toBe(def.fog);
        expect(look.hills).not.toEqual(def.hills);
        expect(look.n).toBe(def.n);
        expect(look.theme).toBe(def.theme);
        expect(look.props).toBe(def.props);
        expect(look.spots).toBe(def.spots);
        expect(look.missions).toBe(def.missions);
      });
      it("is a well-formed world: real colours, a sun or a moon, and extras that fit the time of day", () => {
        for (const c of look.sky) expect(c).toMatch(HEX);
        expect(look.ground).toMatch(HEX);
        for (const c of look.hills!) expect(c).toMatch(HEX);
        expect(look.orb).not.toBeNull();
        expect(look.orb![3]).toMatch(HEX);
        expect(Number.isInteger(look.fog)).toBe(true);
        expect(look.hemi).toHaveLength(3);
        expect(look.sun).toHaveLength(2);
        if (other === "day") expect(JSON.stringify(look.extras)).not.toMatch(/aurora|fireflies/);   // no aurora or fireflies in daylight
      });
      it("does not change the shared theme or world definitions", () => {
        const before = JSON.stringify([WORLDS[theme], THEME_DEF[theme]]);
        lookFor(WORLDS[theme]!, theme, other);
        lookFor(WORLDS[theme]!, theme, painted);
        expect(JSON.stringify([WORLDS[theme], THEME_DEF[theme]])).toBe(before);
      });
    });
  }
  it("each skin replaces the painting's extras: a day Garden has no fireflies, a night Beach has them", () => {
    expect(lookFor(WORLDS.garden!, "garden", "day").extras.fireflies).toBeUndefined();
    expect(WORLDS.garden!.extras.fireflies).toBeDefined();
    expect(lookFor(WORLDS.beach!, "beach", "night").extras.fireflies).toBeDefined();
    expect(lookFor(WORLDS.snow!, "snow", "day").extras.aurora).toBeUndefined();
  });
  it("a day world looks bright and a night world dark: the sky's top colour is lighter by day for every world", () => {
    const lum = (c: string) => { const n = parseInt(c.slice(1), 16); return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255); };
    for (const theme of CLOCK_THEMES) {
      const day = lookFor(WORLDS[theme]!, theme, "day"), night = lookFor(WORLDS[theme]!, theme, "night");
      expect(lum(day.sky[0]), `${theme} top`).toBeGreaterThan(lum(night.sky[0]) + 30);
      expect(lum(day.sky[2]), `${theme} horizon`).toBeGreaterThan(lum(night.sky[2]) + 30);
      expect(lum(day.ground), `${theme} ground`).toBeGreaterThan(lum(night.ground) - 1);
    }
  });
  it("the skins cover exactly the clock themes", () => {
    expect(Object.keys(SKINS).sort()).toEqual([...CLOCK_THEMES].sort());
  });
  it("every outdoor theme has a light rig of its own for the time it was painted", () => {
    for (const theme of CLOCK_THEMES) expect(LIGHT_RIGS[theme], theme).toBeDefined();
  });
});

describe("the same world at the same time of day twice", () => {
  it("gives equal looks (nothing random or time-dependent in the skins)", () => {
    for (const theme of CLOCK_THEMES) for (const t of ["day", "night"] as const) expect(lookFor(WORLDS[theme]!, theme, t)).toEqual(lookFor(WORLDS[theme]!, theme, t));
  });
});

describe("the look in the world (runtime/world.ts is one minified-style file: checked by its text)", () => {
  const world = readFileSync(join(new URL("..", import.meta.url).pathname, "src/features/game/world/runtime/world.ts"), "utf8");
  it("a world is built in the time of day the device clock says (or the pinned one), through lookFor, and remembers which", () => {
    expect(world).toContain('import { followsClock, lookFor } from "./worldLook";');
    expect(world).toContain('import { loadTimeOfDayMode, timeOfDayFor } from "../../../../lib/timeOfDay";');
    expect(world).toContain(' var ph=timeOfDayFor(Date.now(),undefined,loadTimeOfDayMode());TOD=ph;var R=lookFor(WORLDS[id]!,id,ph);W.look=R.look||"";');
    expect(world).not.toContain(" var R=WORLDS[id]!;");
  });
  it("the lanterns are lit at night and dark by day, once the world is final (after linearize), and only for a world that has a look", () => {
    expect(world).toContain(' linearize(scene);if(R.look)PFX.setLights(R.look==="night");');
  });
  it("pinning Day or Night again while a world is up re-skins it, but only when the toy is free, and a clock that passes 19:00 does not rebuild a world under a child", () => {
    const m = /function lookTick\(dt: number\)\{([^\n]*)\}\n/.exec(world);
    expect(m).not.toBeNull();
    const body = m![1]!;
    expect(body).toContain("var m=loadTimeOfDayMode();if(m!==lookMode){lookMode=m;lookPending=true}");     // it only wakes on a CHANGE of the pin
    expect(body).toContain("if(!lookPending)return;");
    expect(body).toContain("timeOfDayFor(Date.now(),undefined,m)===TOD");                                   // already the look the pin asks for: nothing to do
    expect(body).toContain("!followsClock(def,S.world)");                                                    // the Toy Room and a level with its own mood are left alone
    for (const busy of ["paused", "P.busy", "P.showcase", "ED.on", "P.mDrive", "SLEEPH.busy", "ACTS.busy"]) expect(body, busy).toContain(busy);
    expect(body).toContain("lookPending=false;buildWorld(S.world)");
    expect(world).toContain("streetCd=Math.max(0,streetCd-dt);lookTick(dt);");
  });
  it("the ground and the sea follow the look too: a lighter gravel in the Junkyard by day, the cloud floor and the sand cooled at night, a dark sea at night", () => {
    expect(world).toContain("groundPlane(R.theme||id,R.look);");
    expect(world).toContain('var GROUND_LOOK: Record<string,{name?: string;c?: string}>={"junk/day":{name:"sand",c:"#a2a0ac"},"sky/night":{c:"#7f8fcc"},"beach/night":{c:"#aab0e0"}};');
    expect(world).toContain('gl=GROUND_LOOK[kind+"/"+look]||{},name=gl.name||gNames[kind]||"grass";');
    expect(world).toContain("env:kind===\"junk\"||kind===\"room\"?.35:.1,c:gl.c})");
    expect(world).toContain('var nt=W.look==="night",p=new T.Mesh(new T.PlaneGeometry(160,48),new T.MeshPhysicalMaterial({color:nt?"#0c3566":"#1e93cf",');
    expect(world).toContain("opacity:nt?.3:.75");
    // the Toy Room's floor is wood whatever the look: no entry for it
    expect(world).not.toContain('"room/day"');
  });
  it("the world's variable for it does not collide with the existing LOOK stat default that (STATS[x]||LOOK) uses", () => {
    expect(world).toContain('var TOD: ""|"day"|"night"="",lookMode=');
    expect(world).toContain("(STATS[p.st]||LOOK)");
    expect(world).toContain(",look:function(){return W.look},");
  });
});
