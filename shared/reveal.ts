// Reveal logic: a finished build becomes a character. Pure functions —
// the same build always produces the same character and the same theme
// melody, on any device, with no server state.
import { buildStats, type Placement } from "./build";
import { hashSeed } from "./pack";
import type { Part, StatName } from "./part";
import type { Toy } from "./toy";

export interface CharacterCard {
  /** toy id + build signature: rebuilding differently is a new character. */
  id: string;
  toyId: string;
  signature: string;
  title: string;
  toyName: string;
  leadStat: StatName;
  statTotals: Partial<Record<StatName, number>>;
  partNames: string[];
  /** ISO date the Reveal first played. */
  revealedOn: string;
}

/** Order-independent fingerprint of a build: same parts in the same
 *  places, in any placement order, give the same signature. */
export function buildSignature(placements: Placement[]): string {
  const canonical = placements
    .map((p) => `${p.partId}@${p.xMm},${p.yMm},${p.rotation}`)
    .sort()
    .join("|");
  return hashSeed(canonical).toString(36);
}

const TITLES: Record<StatName, string[]> = {
  speed: ["Turbo", "Dash", "Zoom"],
  spin: ["Whirl", "Twister", "Cyclone"],
  torque: ["Geargrinder", "Torque", "Crank"],
  glow: ["Glow", "Sparkle", "Lantern"],
};

export function characterFromBuild(
  toy: Toy,
  placements: Placement[],
  partsById: Map<string, Part>,
  revealedOn: string,
): CharacterCard {
  const signature = buildSignature(placements);
  const { statTotals } = buildStats(placements, partsById);
  const leadStat = (Object.entries(statTotals).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]?.[0] ??
    "glow") as StatName;
  const titles = TITLES[leadStat];
  const titleWord = titles[hashSeed(signature) % titles.length]!;
  const partNames = [...new Set(placements.map((p) => partsById.get(p.partId)?.name).filter(Boolean))] as string[];
  return {
    id: `${toy.id}:${signature}`,
    toyId: toy.id,
    signature,
    title: `${titleWord} ${toy.name}`,
    toyName: toy.name,
    leadStat,
    statTotals,
    partNames,
    revealedOn,
  };
}

/**
 * Deterministic theme melody for a build: 16 steps on a major pentatonic
 * scale, seeded by the build signature. Frequencies in Hz; the player in
 * features/reveal/theme.ts turns these into sound. Replaced by a Mureka
 * theme when that key lands; the seed idea (build -> theme) stays.
 */
export const ENTRANCE_STEPS = 36;
export const ENTRANCE_SECONDS = 36 * 0.42; // ~15.1 s at the player's step rate

/**
 * Day 8 entrance arrangement: the 16-step melody twice (second pass lifts
 * every fourth step an octave for a finale feel) plus a 4-note outro phrase
 * ending on the root. Deterministic per build; 36 steps ≈ 15 s.
 */
export function entranceNotes(signature: string): number[] {
  const base = themeNotes(signature);
  const out: number[] = [...base];
  for (let i = 0; i < base.length; i++) {
    out.push(i % 4 === 3 ? base[i]! * 2 : base[i]!);
  }
  out.push(base[0]!, base[2]!, base[4]!, base[0]!);
  return out;
}

export function themeNotes(signature: string): number[] {
  const scale = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33]; // C D E G A C D
  const seed = hashSeed(signature);
  const notes: number[] = [];
  let step = seed % scale.length;
  for (let i = 0; i < 16; i++) {
    notes.push(scale[step % scale.length]!);
    // Small melodic steps, seeded walk up/down the scale.
    step += ((seed >> (i % 16)) & 3) - 1;
    if (step < 0) step = 0;
    if (step >= scale.length) step = scale.length - 1;
  }
  return notes;
}
