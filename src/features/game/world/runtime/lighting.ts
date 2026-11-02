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
import {
  renderer, scene, hemi, sun, rim, hero, bloom, grade,
  setEnvironment, setEnvScale, DEFAULT_ENV, type EnvPalette,
} from "./worldScene";

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
const DAY_ENV: EnvPalette = { bg: 0x6f9be0, top: 0xfff6e0, topK: 1.5, left: 0xbcd8ff, right: 0xffe9c8, front: 0xe6f0ff };
const SUNSET_ENV: EnvPalette = { bg: 0x2a2450, top: 0xffb884, topK: 1.5, left: 0x9a86e8, right: 0xffa070, front: 0xffd2b0 };
const SNOW_ENV: EnvPalette = { bg: 0x1a2a5c, top: 0xdbe8ff, topK: 1.6, left: 0x9fd8ff, right: 0xcfe4ff, front: 0xe4eeff };
const ROOM_ENV: EnvPalette = { bg: 0x2c2058, top: 0xffe2b8, topK: 1.5, left: 0xc9a8ff, right: 0xffc990, front: 0xffe6c8 };

export const LIGHT_RIGS: Record<string, LightRig> = {
  // Moonlit garden: cool key from the back-left so shapes get an edge, warm lantern pools and a warm hero fill.
  garden: {
    exposure: 1.0,
    hemi: { sky: 0x8fa0ff, ground: 0x1f6a78, i: 0.95 },
    key: { color: 0xcdd9ff, i: 2.1, pos: [-9, 15, 7], radius: 3 },
    rim: { color: 0x9ab4ff, i: 1.5, pos: [-6, 9, -12] },
    hero: { color: 0xffd9a8, i: 1.1 },
    env: { scale: 0.9, palette: NIGHT_ENV },
    fog: { color: 0x1d2470, near: 46, far: 150 },
    bloom: { strength: 0.42, radius: 0.5, threshold: 0.9 },
    grade: { sat: 1.12, vig: 0.26, tint: [0.97, 1.0, 1.07] },
  },
  // Bright morning sky: warm sun, airy blue fill, restrained bloom so clouds stay shapely.
  sky: {
    exposure: 0.95,
    hemi: { sky: 0xffffff, ground: 0x9fbfe8, i: 0.8 },
    key: { color: 0xfff1d4, i: 1.7, pos: [-9, 18, 10], radius: 3 },
    rim: { color: 0xcfe4ff, i: 0.6, pos: [-6, 9, -12] },
    hero: { color: 0xffffff, i: 0 },
    env: { scale: 0.85, palette: DAY_ENV },
    fog: { color: 0xbcd8f8, near: 55, far: 150 },
    bloom: { strength: 0.2, radius: 0.5, threshold: 2.0 },
    grade: { sat: 1.1, vig: 0.2, tint: [1.03, 1.02, 0.98] },
  },
  // Junkyard at sunset: low orange key for long shadows, magenta rim, glossy puddles pick up the warm sky.
  junk: {
    exposure: 1.1,
    hemi: { sky: 0xb8a8ff, ground: 0x3a3f7a, i: 0.95 },
    key: { color: 0xffc9a0, i: 1.9, pos: [-14, 8, 7], radius: 3.5 },
    rim: { color: 0xff7aa8, i: 1.1, pos: [-6, 8, -12] },
    hero: { color: 0xffc799, i: 0.9 },
    env: { scale: 0.9, palette: SUNSET_ENV },
    fog: { color: 0x3d2f5c, near: 44, far: 140 },
    bloom: { strength: 0.45, radius: 0.5, threshold: 0.95 },
    grade: { sat: 1.14, vig: 0.28, tint: [1.07, 0.98, 0.94] },
  },
  // Beach noon: warm key, cream sand held below clipping.
  beach: {
    exposure: 0.92,
    hemi: { sky: 0xffffff, ground: 0xe0c08a, i: 0.7 },
    key: { color: 0xfff0d0, i: 1.55, pos: [-9, 17, 10], radius: 3 },
    rim: { color: 0xd8ecff, i: 0.5, pos: [-6, 9, -12] },
    hero: { color: 0xffffff, i: 0 },
    env: { scale: 0.7, palette: DAY_ENV },
    fog: { color: 0xcfeaf6, near: 50, far: 140 },
    bloom: { strength: 0.22, radius: 0.5, threshold: 2.2 },
    grade: { sat: 1.1, vig: 0.2, tint: [1.04, 1.02, 0.95] },
  },
  // Snow Peak twilight: cool moon key, snow kept from clipping, icy rim, aurora does the bloom work.
  snow: {
    exposure: 0.88,
    hemi: { sky: 0xbcd0ff, ground: 0x3a4f8a, i: 0.65 },
    key: { color: 0xd6e2ff, i: 1.6, pos: [-9, 15, 8], radius: 3 },
    rim: { color: 0x9fe0ff, i: 1.0, pos: [-6, 9, -12] },
    hero: { color: 0xe6efff, i: 0.6 },
    env: { scale: 0.75, palette: SNOW_ENV },
    fog: { color: 0x1c2f66, near: 46, far: 150 },
    bloom: { strength: 0.34, radius: 0.5, threshold: 1.3 },
    grade: { sat: 1.1, vig: 0.26, tint: [0.95, 1.0, 1.08] },
  },
  // Toy Room evening: warm lamp key, wood floor stays glossy, soft violet fill from the night window.
  room: {
    exposure: 0.95,
    hemi: { sky: 0xffd7b0, ground: 0x3a2a60, i: 0.6 },
    key: { color: 0xffe0b8, i: 1.7, pos: [-5, 14, 10], radius: 3 },
    rim: { color: 0xffb27a, i: 0.8, pos: [-6, 8, -12] },
    hero: { color: 0xffd6a0, i: 0.7 },
    env: { scale: 0.9, palette: ROOM_ENV },
    fog: { color: 0x2a2058, near: 46, far: 140 },
    bloom: { strength: 0.4, radius: 0.5, threshold: 1.0 },
    grade: { sat: 1.12, vig: 0.28, tint: [1.07, 0.99, 0.94] },
  },
};

interface RigSource {
  theme?: string;
  mood?: string;
  night?: boolean;
  light?: Partial<LightRig>;
  fog?: number;
}

/**
 * Time-of-day variants of any theme rig. Only the lights that carry the mood change (key colour and height, fill,
 * rim, exposure, fog); the theme keeps its own bloom, grade and environment character.
 */
export function moodRig(base: LightRig, mood: string): LightRig {
  if (mood === "day") {
    return { ...base, exposure: 0.93, hemi: { sky: 0xffffff, ground: 0xa9bfd8, i: 0.78 }, key: { color: 0xfff1d4, i: 1.65, pos: [-9, 17, 10], radius: 3 },
      rim: { color: 0xd8ecff, i: 0.5, pos: [-6, 9, -12] }, hero: { color: 0xffffff, i: 0 }, env: { scale: 0.8, palette: DAY_ENV },
      fog: { color: 0xcfe4f6, near: 50, far: 140 }, bloom: { strength: 0.22, radius: 0.5, threshold: 2.1 } };
  }
  if (mood === "dusk") {
    return { ...base, exposure: 1.08, hemi: { sky: 0xb8a8ff, ground: 0x3a3f7a, i: 0.9 }, key: { color: 0xffc29a, i: 1.9, pos: [-14, 8, 7], radius: 3.5 },
      rim: { color: 0xff7aa8, i: 1.0, pos: [-6, 8, -12] }, hero: { color: 0xffc799, i: 0.9 }, env: { scale: 0.9, palette: SUNSET_ENV },
      fog: { color: 0x4a2f66, near: 44, far: 140 }, bloom: { strength: 0.45, radius: 0.5, threshold: 0.95 } };
  }
  if (mood === "night") {
    const g = LIGHT_RIGS.garden!;
    return { ...base, exposure: 1.0, hemi: g.hemi, key: g.key, rim: g.rim, hero: g.hero, env: { scale: 0.9, palette: NIGHT_ENV },
      fog: g.fog, bloom: g.bloom };
  }
  return base;
}

/** Resolve the rig for a world: an explicit `light` override, then the theme preset, then a day or night default. */
export function rigFor(R: RigSource, id: string): LightRig {
  const themed = LIGHT_RIGS[R.theme || id] ?? (R.night ? LIGHT_RIGS.garden! : LIGHT_RIGS.sky!);
  const base = R.mood ? moodRig(themed, R.mood) : themed;
  const rig: LightRig = { ...base, ...(R.light || {}) } as LightRig;
  if (!LIGHT_RIGS[R.theme || id] && typeof R.fog === "number") rig.fog = { ...rig.fog, color: R.fog };
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

/** Push the current rig's bloom and grade values onto the post chain (it may be created after the first world). */
export function syncPost(): void {
  const rig = current;
  if (bloom) {
    bloom.strength = rig.bloom.strength;
    bloom.radius = rig.bloom.radius;
    bloom.threshold = rig.bloom.threshold;
  }
  if (grade && grade.uniforms) {
    const u = grade.uniforms as Record<string, { value: any }>;
    u.uSat!.value = rig.grade.sat;
    u.uVig!.value = rig.grade.vig;
    u.uTint!.value.set(rig.grade.tint[0], rig.grade.tint[1], rig.grade.tint[2]);
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
