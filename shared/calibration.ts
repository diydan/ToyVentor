// Hidden calibration on the canonical 12.5 mm TU lattice (PartSpec stud_small:
// stud_d = 6.6 mm, nominal fit = 0.10 mm diametral / 0.05 mm radial).
// The first Forge Mount print (make_calibration.forge_mount_first_print) carries
// a breakaway strip with three dotted underside sockets (1, 2, 3 embossed dots)
// plus a 2x1 finger-grip test brick. The user answers one question -
// "which clicked best?" - and that choice becomes the printer offset.
// No standalone calibration step ever reaches the user.

export type FitChoice = "snug" | "standard" | "easy";

export interface FitVariant {
  id: FitChoice;
  label: string;
  /** Dots embossed on the selector strip cell (no text to misprint). */
  dots: 1 | 2 | 3;
  /** Diametral socket clearance over the nominal 6.6 mm stud_small, mm. */
  clearanceMm: number;
  /** Printer surface-offset window [min, max] in mm covered within PartSpec fit limits. */
  surfaceOffsetWindowMm: readonly [number, number];
}

export const FIT_VARIANTS: readonly [FitVariant, FitVariant, FitVariant] = [
  {
    id: "snug",
    label: "Snug",
    dots: 1,
    clearanceMm: 0.0,
    surfaceOffsetWindowMm: [-0.1, 0.05],
  },
  {
    id: "standard",
    label: "Standard",
    dots: 2,
    clearanceMm: 0.1,
    surfaceOffsetWindowMm: [-0.075, 0.075],
  },
  {
    id: "easy",
    label: "Easy",
    dots: 3,
    clearanceMm: 0.26,
    surfaceOffsetWindowMm: [-0.035, 0.115],
  },
];

export const DEFAULT_FIT: FitChoice = "standard";

export function clearanceForFit(choice: FitChoice): number {
  return FIT_VARIANTS.find((v) => v.id === choice)!.clearanceMm;
}

export function fitForDots(dots: number): FitVariant | undefined {
  return FIT_VARIANTS.find((v) => v.dots === dots);
}

export const FIT_QUESTION = "Snap the little brick into each dotted slot. Which clicked best?";
