// Per-theme lighting rigs for the native world runtime.
//
// One rig = a key light (sun / moon / lamp), a hemisphere fill, a rim light, a soft follow light on the hero,
// the environment the PBR materials reflect, fog, bloom and the colour grade. Intensities here are FINAL values:
// the global lights are flagged `userData.lin` in worldScene.ts so linearize() never multiplies them again.
//
// Why this exists: the old setup set one hemisphere + one sun per world and then boosted them x2.6 on every
// world build while bloom thresholded at 1.0. Night worlds survived that; every day world (Sky Meadow, Beach,
// Snow Peak) rendered as a white-out with the hero almost invisible.
import * as THREE from "three";
import { duskGrade, duskLightScale } from "./dusk";
import {
  renderer, scene, hemi, sun, rim, hero, bloom, grade, quality,
  setEnvironment, setEnvScale, DEFAULT_ENV, type EnvPalette,
} from "./worldScene";

// THE REUSABLE SETTING (Dan, 2026-11-04: "bloom and light sometimes a bit too reflective, do a review on lighting; ideally this is a reusable setting for all scenes and levels, with an
// indoor and outdoor, night and day"). Four named presets, `LIGHT_PRESETS["outdoor-day" | "outdoor-night" | "indoor-day" | "indoor-night"]`, are the whole vocabulary: any world, level or generated
// level says WHERE it is (`place`: indoor or outdoor; the Toy Room is indoor, everything else outdoor) and WHEN (`mood`: day or night; dusk keeps its own sunset rig), and gets that preset's lights, fog,
// reflections, bloom and grade. The themed rigs below (Garden, Sky Meadow...) are the same presets with a world's own character on top (its colour grade, its key colour).
//
// WHAT THE REVIEW FOUND (screenshots of every world by day and night, and a frame-cost benchmark): (1) almost every material had a full clearcoat and a strong reflection of the studio
// environment, so floors, palm leaves and toy parts shone like mirrors and their highlights went over the bloom threshold: glare; (2) the day worlds (Sky Meadow, Snow Peak) were near white-outs
// (key 1.7 plus a bright white sky reflection plus the fill, then tone mapping): no shape left on the ground and the hero hard to see; (3) the night worlds bloomed at 0.9 to 1.0, so every
// highlight glowed, and the twilight Snow Peak was barely darker than its day; (4) bloom ran at full price in the day worlds where its threshold (2.0+) made it do nothing.
// So: materials are matte-satin (worldScene.ts), day rigs are lower and cooler, night bloom is rarer and softer, and a bloom pass that cannot show is not run (`bloomWanted`).
export interface LightRig {
  /** Tone-mapping exposure. */
  exposure: number;
  hemi: { sky: number; ground: number; i: number };
  /** Key light: colour, intensity and its offset from the hero (x is relative, y and z absolute). */
  key: { color: number; i: number; pos: [number, number, number]; radius: number };
  rim: { color: number; i: number; pos: [number, number, number] };
  /** Soft follow light so faces stay readable when the key is low or blue. */
  hero: { color: number; i: number };
  env: { scale: number; palette: EnvPalette };
  fog: { color: number; near: number; far: number };
  bloom: { strength: number; radius: number; threshold: number };
  grade: { sat: number; vig: number; tint: [number, number, number] };
}

const NIGHT_ENV: EnvPalette = DEFAULT_ENV;
const DAY_ENV: EnvPalette = { bg: 0x6f9be0, top: 0xfff6e0, topK: 1.1, left: 0xbcd8ff, right: 0xffe9c8, front: 0xe6f0ff };
const ROOM_DAY_ENV: EnvPalette = { bg: 0x8a8fa8, top: 0xfff4e4, topK: 1.1, left: 0xf2e6d4, right: 0xffe9cc, front: 0xefe6da };
const SUNSET_ENV: EnvPalette = { bg: 0x2a2450, top: 0xffb884, topK: 1.5, left: 0x9a86e8, right: 0xffa070, front: 0xffd2b0 };
const SNOW_ENV: EnvPalette = { bg: 0x1a2a5c, top: 0xdbe8ff, topK: 1.6, left: 0x9fd8ff, right: 0xcfe4ff, front: 0xe4eeff };
const ROOM_ENV: EnvPalette = { bg: 0x2c2058, top: 0xffe2b8, topK: 1.5, left: 0xc9a8ff, right: 0xffc990, front: 0xffe6c8 };

export type Place = "indoor" | "outdoor";
export type LightTime = "day" | "night";
export type PresetId = `${Place}-${LightTime}`;

/** Moonlit open air: a cool key from the back-left for an edge on every shape, warm hero fill, reflections low so nothing glares. */
const OUTDOOR_NIGHT: LightRig = {
  exposure: 1.0,
  hemi: { sky: 0x8fa0ff, ground: 0x1f6a78, i: 0.85 },
  key: { color: 0xcdd9ff, i: 1.85, pos: [-9, 17, 7], radius: 3 },
  rim: { color: 0x9ab4ff, i: 1.2, pos: [-6, 9, -12] },
  hero: { color: 0xffd9a8, i: 1.1 },
  env: { scale: 0.6, palette: NIGHT_ENV },
  fog: { color: 0x1d2470, near: 46, far: 150 },
  bloom: { strength: 0.3, radius: 0.5, threshold: 1.25 },
  grade: { sat: 1.12, vig: 0.26, tint: [0.97, 1.0, 1.07] },
};
/** Open air by day: a warm sun, an airy fill, and nothing above the bloom threshold (so no bloom pass at all). Lower and cooler than before: it used to white out. */
const OUTDOOR_DAY: LightRig = {
  exposure: 0.9,
  hemi: { sky: 0xffffff, ground: 0xa9bfd8, i: 0.62 },
  key: { color: 0xfff1d4, i: 1.4, pos: [-9, 17, 10], radius: 3 },
  rim: { color: 0xd8ecff, i: 0.4, pos: [-6, 9, -12] },
  hero: { color: 0xffffff, i: 0 },
  env: { scale: 0.55, palette: DAY_ENV },
  fog: { color: 0xcfe4f6, near: 50, far: 140 },
  bloom: { strength: 0.12, radius: 0.5, threshold: 2.4 },
  grade: { sat: 1.1, vig: 0.2, tint: [1.03, 1.02, 0.98] },
};
/** A room in the evening (the Toy Room): a warm lamp key, a soft violet fill from the night window, a little glow round the lamp only. */
const INDOOR_NIGHT: LightRig = {
  exposure: 0.95,
  hemi: { sky: 0xffd7b0, ground: 0x3a2a60, i: 0.55 },
  key: { color: 0xffe0b8, i: 1.55, pos: [-5, 14, 10], radius: 3 },
  rim: { color: 0xffb27a, i: 0.7, pos: [-6, 8, -12] },
  hero: { color: 0xffd6a0, i: 0.7 },
  env: { scale: 0.6, palette: ROOM_ENV },
  fog: { color: 0x2a2058, near: 46, far: 140 },
  bloom: { strength: 0.28, radius: 0.5, threshold: 1.3 },
  grade: { sat: 1.12, vig: 0.28, tint: [1.07, 0.99, 0.94] },
};
/** A room by day: window light, a soft warm fill, a pale warm wall colour in the fog, no bloom. */
const INDOOR_DAY: LightRig = {
  exposure: 0.93,
  hemi: { sky: 0xfff4e0, ground: 0xcdb89a, i: 0.75 },
  key: { color: 0xfff0d8, i: 1.25, pos: [-5, 14, 10], radius: 3 },
  rim: { color: 0xffe8cc, i: 0.3, pos: [-6, 8, -12] },
  hero: { color: 0xffffff, i: 0 },
  env: { scale: 0.5, palette: ROOM_DAY_ENV },
  fog: { color: 0xe6dccb, near: 46, far: 140 },
  bloom: { strength: 0.1, radius: 0.5, threshold: 2.4 },
  grade: { sat: 1.08, vig: 0.18, tint: [1.04, 1.0, 0.96] },
};

/** The four settings: where a scene is and when. Pick one for any scene, level or generated level (`presetFor`), or name `place` and `mood` on the world and `rigFor` does it. */
export const LIGHT_PRESETS: Readonly<Record<PresetId, LightRig>> = {
  "outdoor-day": OUTDOOR_DAY,
  "outdoor-night": OUTDOOR_NIGHT,
  "indoor-day": INDOOR_DAY,
  "indoor-night": INDOOR_NIGHT,
};
export const presetFor = (place: Place, time: LightTime): LightRig => LIGHT_PRESETS[`${place}-${time}` as PresetId];

/** The worlds' own rigs: a preset with the world's character on top (the beach's warmer sand fill, the junkyard's sunset, the twilight snow). */
export const LIGHT_RIGS: Record<string, LightRig> = {
  garden: OUTDOOR_NIGHT,
  sky: OUTDOOR_DAY,
  // Junkyard at sunset: low orange key for long shadows, magenta rim, the warm sky in the puddles.
  junk: {
    exposure: 1.05,
    hemi: { sky: 0xb8a8ff, ground: 0x3a3f7a, i: 0.85 },
    key: { color: 0xffc9a0, i: 1.7, pos: [-14, 8, 7], radius: 3.5 },
    rim: { color: 0xff7aa8, i: 1.0, pos: [-6, 8, -12] },
    hero: { color: 0xffc799, i: 0.9 },
    env: { scale: 0.6, palette: SUNSET_ENV },
    fog: { color: 0x3d2f5c, near: 44, far: 140 },
    bloom: { strength: 0.32, radius: 0.5, threshold: 1.3 },
    grade: { sat: 1.14, vig: 0.28, tint: [1.07, 0.98, 0.94] },
  },
  // Beach noon: a warm key and a sand-coloured fill, held below clipping.
  beach: {
    ...OUTDOOR_DAY,
    exposure: 0.88,
    hemi: { sky: 0xffffff, ground: 0xe0c08a, i: 0.6 },
    key: { color: 0xfff0d0, i: 1.3, pos: [-9, 17, 10], radius: 3 },
    rim: { color: 0xd8ecff, i: 0.35, pos: [-6, 9, -12] },
    env: { scale: 0.5, palette: DAY_ENV },
    fog: { color: 0xcfeaf6, near: 50, far: 140 },
    grade: { sat: 1.1, vig: 0.2, tint: [1.04, 1.02, 0.95] },
  },
  // Snow Peak twilight: a cool moon key, snow kept from clipping and from glowing like day, an icy rim; the aurora does the bloom work.
  snow: {
    exposure: 0.84,
    hemi: { sky: 0xbcd0ff, ground: 0x3a4f8a, i: 0.5 },
    key: { color: 0xd6e2ff, i: 1.3, pos: [-9, 15, 8], radius: 3 },
    rim: { color: 0x9fe0ff, i: 0.9, pos: [-6, 9, -12] },
    hero: { color: 0xe6efff, i: 0.6 },
    env: { scale: 0.55, palette: SNOW_ENV },
    fog: { color: 0x1c2f66, near: 46, far: 150 },
    bloom: { strength: 0.24, radius: 0.5, threshold: 1.5 },
    grade: { sat: 1.1, vig: 0.26, tint: [0.95, 1.0, 1.08] },
  },
  room: INDOOR_NIGHT,
};

interface RigSource {
  theme?: string;
  mood?: string;
  night?: boolean;
  /** Where the scene is. Absent: indoor for the Toy Room, outdoor for everything else. */
  place?: Place;
  light?: Partial<LightRig>;
  fog?: number;
}

/** The lights that carry a mood (everything but the grade, which stays the world's own). */
const lightsOf = (r: LightRig): Pick<LightRig, "exposure" | "hemi" | "key" | "rim" | "hero" | "env" | "fog" | "bloom"> =>
  ({ exposure: r.exposure, hemi: r.hemi, key: r.key, rim: r.rim, hero: r.hero, env: r.env, fog: r.fog, bloom: r.bloom });

/**
 * Time-of-day variants of any theme rig. Only the lights that carry the mood change (key colour and height, fill,
 * rim, exposure, fog, bloom); the theme keeps its own grade. `place` picks the indoor or the outdoor version (a room has a lamp and a window, not a sun and a moon).
 */
export function moodRig(base: LightRig, mood: string, place: Place = "outdoor"): LightRig {
  if (mood === "day") return { ...base, ...lightsOf(presetFor(place, "day")) };
  if (mood === "night") return { ...base, ...lightsOf(presetFor(place, "night")) };
  if (mood === "dusk") {
    return { ...base, exposure: 1.06, hemi: { sky: 0xb8a8ff, ground: 0x3a3f7a, i: 0.85 }, key: { color: 0xffc29a, i: 1.75, pos: [-14, 8, 7], radius: 3.5 },
      rim: { color: 0xff7aa8, i: 1.0, pos: [-6, 8, -12] }, hero: { color: 0xffc799, i: 0.9 }, env: { scale: 0.6, palette: SUNSET_ENV },
      fog: { color: 0x4a2f66, near: 44, far: 140 }, bloom: { strength: 0.32, radius: 0.5, threshold: 1.3 } };
  }
  return base;
}

/** Resolve the rig for a world: an explicit `light` override, then the mood and place, then the theme preset, then a day or night default. */
export function rigFor(R: RigSource, id: string): LightRig {
  const theme = R.theme || id;
  const themed = LIGHT_RIGS[theme];
  const natural: Place = theme === "room" ? "indoor" : "outdoor";
  const place: Place = R.place ?? natural;
  const time: LightTime = R.mood === "night" || (!R.mood && R.night) ? "night" : "day";
  // an unknown theme falls back to the preset for its place and time; a world that names the OTHER kind of place than its theme's takes that place's preset with the theme's grade
  let base: LightRig = themed ?? presetFor(place, time);
  if (themed && place !== natural) base = { ...presetFor(place, time), grade: themed.grade };
  const themedBase = R.mood ? moodRig(base, R.mood, place) : base;
  const rig: LightRig = { ...themedBase, ...(R.light || {}) } as LightRig;
  if (!LIGHT_RIGS[theme] && typeof R.fog === "number") rig.fog = { ...rig.fog, color: R.fog };
  return rig;
}

let current: LightRig = LIGHT_RIGS.garden!;

/** Apply a world's rig to the live lights, fog, environment and post chain. Call before linearize(scene). */
export function applyLightRig(R: RigSource, id: string): LightRig {
  const rig = rigFor(R, id);
  current = rig;
  renderer.toneMappingExposure = rig.exposure;
  hemi.color.set(rig.hemi.sky);
  hemi.groundColor.set(rig.hemi.ground);
  hemi.intensity = rig.hemi.i;
  sun.color.set(rig.key.color);
  sun.intensity = rig.key.i;
  sun.shadow.radius = rig.key.radius;
  rim.color.set(rig.rim.color);
  rim.intensity = rig.rim.i;
  hero.color.set(rig.hero.color);
  hero.intensity = rig.hero.i;
  scene.fog = new THREE.Fog(rig.fog.color, rig.fog.near, rig.fog.far);
  setEnvironment(rig.env.palette);
  setEnvScale(rig.env.scale);
  syncPost();
  return rig;
}

/** Can this bloom setting show at all? Above a threshold of 2 nothing in these scenes is bright enough, and a strength of about 0 is off. */
export function bloomWanted(b: { strength: number; threshold: number }): boolean {
  return b.strength > 0.02 && b.threshold < 2.0;
}

/** Push the current rig's bloom and grade values onto the post chain (it may be created after the first world). */
export function syncPost(): void {
  const rig = current;
  if (bloom) {
    bloom.strength = rig.bloom.strength;
    bloom.radius = rig.bloom.radius;
    bloom.threshold = rig.bloom.threshold;
    // A bloom pass is ten full-screen passes. In a day or indoor-day rig its threshold is above anything the scene can reach, so it would cost the frame and show nothing: skip it.
    // (Once the adaptive quality has turned bloom off, a new world must not turn it back on.)
    if (!quality.low) bloom.enabled = bloomWanted(rig.bloom);
  }
  if (grade && grade.uniforms) {
    const u = grade.uniforms as Record<string, { value: any }>;
    u.uSat!.value = rig.grade.sat;
    u.uVig!.value = rig.grade.vig;
    u.uTint!.value.set(rig.grade.tint[0], rig.grade.tint[1], rig.grade.tint[2]);
  }
}

/**
 * Tint the whole picture towards a soft dusk blue and dim every light a little, `level` 0 (the world's own look) to 1 (asleep): the room at bedtime (sleepRoutine.ts).
 * It is computed from the CURRENT rig every call, so it never accumulates, and `setDusk(0)` (or the next `applyLightRig`) puts the world back exactly.
 */
export function setDusk(level: number): void {
  const rig = current;
  const k = duskLightScale(level);
  hemi.intensity = rig.hemi.i * k;
  sun.intensity = rig.key.i * k;
  rim.intensity = rig.rim.i * k;
  hero.intensity = rig.hero.i * k;
  if (grade && grade.uniforms) {
    const u = grade.uniforms as Record<string, { value: any }>;
    const g = duskGrade(rig.grade, level);
    u.uSat!.value = g.sat;
    u.uVig!.value = g.vig;
    u.uTint!.value.set(g.tint[0], g.tint[1], g.tint[2]);
  }
}

/** Move the key, rim and hero lights with the player each frame (the shadow frustum follows the hero). */
export function followHero(px: number, pz: number): void {
  const k = current.key.pos;
  sun.position.set(px + k[0], k[1], k[2]);
  sun.target.position.set(px, 0, 0);
  const r = current.rim.pos;
  rim.position.set(px + r[0], r[1], r[2]);
  hero.position.set(px + 0.8, 2.4, pz + 3.2);
}
