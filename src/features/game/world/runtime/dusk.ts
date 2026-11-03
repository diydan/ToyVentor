// The room at bedtime (docs/specs/playful-interactions-spec.md section 6): how far the picture and the lights move towards a soft dusk blue as the toy falls asleep.
// Pure numbers, no three.js: `lighting.ts` applies them to the real lights and the colour-grade pass, and the tests check them without a GPU.
// `level` is the room's sleepiness from sleepRoutine.ts, 0 (awake) to 1 (deep asleep).

/** The colour-grade multipliers at full dusk: cooler and bluer. */
export const DUSK_TINT: readonly [number, number, number] = [0.8, 0.9, 1.18];
/** Dusk never goes fully dark: the toy and the bed must stay clearly visible. Light intensities fall to this share at most. */
export const DUSK_LIGHT_FLOOR = 0.55;

const clamp01 = (x: number) => (x > 0 ? (x < 1 ? x : 1) : 0);

export interface Grade { tint: readonly [number, number, number]; sat: number; vig: number }

/** The grade for a room that is `level` asleep: the world's own grade at 0, the dusk grade at 1. */
export function duskGrade(base: Grade, level: number): Grade {
  const k = clamp01(level);
  const mix = 0.85 * k;
  return {
    tint: [base.tint[0] + (DUSK_TINT[0] - base.tint[0]) * mix, base.tint[1] + (DUSK_TINT[1] - base.tint[1]) * mix, base.tint[2] + (DUSK_TINT[2] - base.tint[2]) * mix],
    sat: base.sat * (1 - 0.18 * k),
    vig: base.vig + 0.16 * k,
  };
}

/** What to multiply every scene light's intensity by: 1 awake, `DUSK_LIGHT_FLOOR` deep asleep. */
export const duskLightScale = (level: number) => 1 - (1 - DUSK_LIGHT_FLOOR) * clamp01(level);
