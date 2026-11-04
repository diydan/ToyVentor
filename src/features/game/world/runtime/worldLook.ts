// The day and night looks of the outdoor worlds (docs/specs/environment-spec.md: "two looks only, day and night; night is the same scene with the lights on; indoor scenes are identical").
//
// Each outdoor world was painted as ONE time of day: the Garden, the Junkyard and Snow Peak at night, Sky Meadow and the Beach by day. That painting is kept as it is for its own time of
// day; this file adds the other one (a green day Garden, a starry Sky Meadow...) as a SKIN: the fields of the world definition that make the time of day (sky, fog, ground, hills, the
// sun or the moon, the fireflies) plus the `mood` that makes `lighting.ts` swap to a day or a night rig. Which one a child sees comes from `src/lib/timeOfDay.ts`: the device's own clock
// (07:00 to 18:59 is day) unless a grown-up pinned Day or Night. The Toy Room and a level that names its own mood are left alone.
import type { WorldDef } from "./catalog";
import type { TimeOfDay } from "../../../../lib/timeOfDay";

/** The worlds that follow the clock (a world with a `theme` takes its theme's looks: the labs and the generated levels). The Toy Room is indoors: the same at any hour. */
export const CLOCK_THEMES: readonly string[] = ["garden", "sky", "junk", "beach", "snow"];

/** The time of day each world was originally painted for: it keeps that painting, and its own light rig, at that time of day. */
export const PAINTED_FOR: Readonly<Record<string, TimeOfDay>> = { garden: "night", sky: "day", junk: "night", beach: "day", snow: "night" };

export type Skin = Partial<Pick<WorldDef, "night" | "sky" | "fog" | "ground" | "hemi" | "sun" | "hills" | "orb" | "extras">> & { mood: TimeOfDay };

/** The other time of day for each world: what it looks like when the clock disagrees with how it was painted. */
export const SKINS: Readonly<Record<string, Skin>> = {
  // A fresh green meadow under a blue sky with a sun, instead of the moonlit teal one.
  garden: {
    mood: "day", night: false,
    sky: ["#2a78d8", "#86c4f4", "#fff3d2"], fog: 0xcfe4f6, ground: "#58b86a",
    hemi: [0xffffff, 0x6faa78, 0.7], sun: [0xfff1d4, 0.9],
    hills: ["#6fc48a", "#5eb67c", "#4ea66f"], orb: [30, 26, -80, "#fff3b8"],
    extras: { grass: "#78d67e", flowers: 1, stones: 1 },
  },
  // The cloud meadow after dark: indigo sky, a moon, the clouds a cool blue-grey.
  sky: {
    mood: "night", night: true,
    sky: ["#050b2a", "#14226e", "#3f4aa4"], fog: 0x1d2470, ground: "#4d5f9e",
    hemi: [0x9aa8ff, 0x34458a, 0.5], sun: [0xdce4ff, 0.8],
    hills: ["#2b3e8e", "#25367e", "#1e2c6c"], orb: [34, 30, -90, "#f4f7ff"],
    extras: { cloudFloor: 1, fireflies: "rgba(200,220,255,1)" },
  },
  // Sand and sea under the moon, with fireflies over the dunes.
  beach: {
    mood: "night", night: true,
    sky: ["#050c28", "#12255f", "#3a4f92"], fog: 0x1c2f66, ground: "#7d7aa0",
    hemi: [0xaab8ff, 0x3a3a6a, 0.5], sun: [0xd6e2ff, 0.8],
    hills: ["#1f4a72", "#1a4068", "#14355a"], orb: [34, 30, -90, "#f4f7ff"],
    extras: { sea: 1, shells: 1, fireflies: "rgba(255,244,160,1)" },
  },
  // Bright white snow under a blue sky and a sun; the aurora belongs to the night.
  snow: {
    mood: "day", night: false,
    sky: ["#4a8ee0", "#a6d2f6", "#eef6ff"], fog: 0xdfeefa, ground: "#f0f6ff",
    hemi: [0xffffff, 0xbdd0ec, 0.75], sun: [0xffffff, 0.9],
    hills: ["#d0e1f5", "#bed3ee", "#a9c4e6"], orb: [30, 28, -80, "#fff6cc"],
    extras: { snowfall: 1 },
  },
  // The scrapyard in daylight: a blue sky, grey gravel, no sunset glow.
  junk: {
    mood: "day", night: false,
    sky: ["#2a78d0", "#8cc0ee", "#ffe2b8"], fog: 0xdbe6f2, ground: "#8a8576",
    hemi: [0xffffff, 0x8a8a90, 0.7], sun: [0xfff0d8, 0.9],
    hills: ["#8d97ad", "#7d89a3", "#6d7b97"], orb: [34, 30, -90, "#fff3b8"],
    extras: { gravel: "#a29c8a", puddles: 1 },
  },
};

/** Which theme's looks a world wears, or null for a world that does not follow the clock (the Toy Room, a world with an unknown theme). */
export function clockTheme(def: Pick<WorldDef, "theme">, id: string): string | null {
  const t = def.theme || id;
  return CLOCK_THEMES.includes(t) ? t : null;
}

/** Does this world look different by day and by night? A level that pinned its own `mood` does not. */
export const followsClock = (def: Pick<WorldDef, "theme"> & { mood?: unknown }, id: string): boolean => clockTheme(def, id) !== null && !def.mood;

/**
 * The world as it looks at this time of day. The same object back when nothing changes (the time of day it was painted for, the Toy Room, a world with its own mood); otherwise a copy with
 * the skin laid over it. `look` on the result says which time of day it shows, for the backdrop art and the lanterns.
 */
export function lookFor(def: WorldDef, id: string, phase: TimeOfDay): WorldDef {
  const theme = clockTheme(def, id);
  if (!theme || def.mood) return def;
  if (PAINTED_FOR[theme] === phase) return { ...def, look: phase };
  const { mood, ...skin } = SKINS[theme]!;
  return { ...def, ...skin, extras: skin.extras ?? def.extras, mood, look: phase };            // (the skin's extras REPLACE the painting's: no fireflies in a day Garden)
}
