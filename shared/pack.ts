// Seeded daily pack selection: same date gives the same pack on every
// device, with no server state. One printable part is guaranteed.
import type { Part } from "./part";

/** Small stable string hash (FNV-1a). Not for security, just seeding. */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Pick `count` distinct parts for a date (YYYY-MM-DD), the first always
 * printable. Rotation steps by the date hash so days don't repeat parts
 * in lockstep.
 */
export function dailyPack(parts: Part[], dateISO: string, count = 3): Part[] {
  if (parts.length === 0) return [];
  const seed = hashSeed(dateISO);
  const printables = parts.filter((p) => p.printable);
  const rest = parts.filter((p) => !p.printable);
  const pick: Part[] = [];
  const used = new Set<string>();

  const take = (pool: Part[], offset: number) => {
    for (let i = 0; i < pool.length && pick.length < count; i++) {
      const candidate = pool[(seed + offset + i) % pool.length]!;
      if (!used.has(candidate.id)) {
        used.add(candidate.id);
        pick.push(candidate);
      }
    }
  };

  take(printables, 0);
  take([...printables, ...rest], 1);
  return pick.slice(0, count);
}

/**
 * Display-only pack rarity from a part's stat value. Epic and legendary
 * colors already exist for future sets, but the current eight-part base set
 * tops out at rare — which keeps tonight's demo honest.
 */
export type PackRarity = "common" | "uncommon" | "rare";

export const RARITY_PIPS: Record<PackRarity, number> = {
  common: 1,
  uncommon: 2,
  rare: 3,
};

export function rarityForPart(part: Pick<Part, "stat">): PackRarity {
  if (part.stat.value >= 3) return "rare";
  if (part.stat.value >= 2) return "uncommon";
  return "common";
}

/**
 * Order a pack's cards from lowest rarity to highest so the 3-card reveal
 * always builds toward the best pull on the final flip (ties keep pack order).
 */
export function sortPackForReveal<T extends Pick<Part, "stat">>(
  pack: readonly T[],
): T[] {
  return pack
    .map((part, index) => ({ part, index, rank: RARITY_PIPS[rarityForPart(part)] }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.part);
}
