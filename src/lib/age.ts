// The player's age band (carousel-modes-ladders-spec §9.1). A grown-up
// sets it once behind the PIN gate; the Map carousel uses it to decide
// which ladders show and which rung each one starts on. Stored as the
// band index in progression:v1 (`ageBand`), never in its own key.
import { loadProgression, saveProgression } from "./progression";

export interface Band {
  /** The engine's own wording for the band, as on each ladder rung ("5 to 6"). */
  id: string;
  /** What the picker shows. */
  label: string;
  /** The youngest and oldest age in the band (13+ has no upper end). */
  from: number;
  to: number;
}

export const BANDS: readonly Band[] = [
  { id: "2 to 3", label: "2–3", from: 2, to: 3 },
  { id: "3 to 4", label: "3–4", from: 3, to: 4 },
  { id: "5 to 6", label: "5–6", from: 5, to: 6 },
  { id: "7 to 9", label: "7–9", from: 7, to: 9 },
  { id: "10 to 12", label: "10–12", from: 10, to: 12 },
  { id: "13+", label: "13+", from: 13, to: Infinity },
];

/** Which band a rung belongs to, from the engine's age text ("3 to 4", "4 to 6", "13+"). */
export function bandOf(age: string): number {
  const exact = BANDS.findIndex((b) => b.id === age);
  if (exact >= 0) return exact;
  const lo = Number(age.match(/\d+/)?.[0]);
  const found = BANDS.findIndex((b) => lo >= b.from && lo <= b.to);
  return found >= 0 ? found : BANDS.length - 1;
}

/** Parse an untrusted value into a band index, or null when unset/invalid. */
export function normalizeAgeBand(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < BANDS.length
    ? value
    : null;
}

/** The stored band index, or null while nobody has chosen one. */
export function readAge(): number | null {
  return normalizeAgeBand(loadProgression().ageBand);
}

/** Persist the band into progression:v1 (local only; sync rides the record). */
export function writeAge(band: number | null): void {
  const prog = loadProgression();
  const clean = normalizeAgeBand(band);
  const next = { ...prog };
  if (clean !== null) next.ageBand = clean;
  else delete next.ageBand;
  saveProgression(next);
}
