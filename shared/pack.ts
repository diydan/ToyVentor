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
