// Hidden calibration: the first Forge Mount print carries a breakaway
// strip with three socket clearances. The user answers one question —
// "which clicked best?" — and that choice becomes the printer offset.
// No standalone calibration step ever reaches the user.

export type FitChoice = "snug" | "standard" | "easy";

export interface FitVariant {
  id: FitChoice;
  label: string;
  /** Dots embossed on the selector strip cell (no text to misprint). */
  dots: 1 | 2 | 3;
  /** Diametral socket clearance over the nominal stud, mm. */
  clearanceMm: number;
}

export const FIT_VARIANTS: FitVariant[] = [
  { id: "snug", label: "Snug", dots: 1, clearanceMm: 0.05 },
  { id: "standard", label: "Standard", dots: 2, clearanceMm: 0.2 },
  { id: "easy", label: "Easy", dots: 3, clearanceMm: 0.35 },
];

export const DEFAULT_FIT: FitChoice = "standard";

export function clearanceForFit(choice: FitChoice): number {
  return FIT_VARIANTS.find((v) => v.id === choice)!.clearanceMm;
}

export function fitForDots(dots: number): FitVariant | undefined {
  return FIT_VARIANTS.find((v) => v.dots === dots);
}

export const FIT_QUESTION = "Snap the little brick into each dotted slot. Which clicked best?";
