import type { CharacterCard } from "../../shared/reveal";

const KEY = "toyforge:reveals:v1";

export function loadReveals(): CharacterCard[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CharacterCard[]) : [];
  } catch {
    return [];
  }
}

/** Save a character once. Returns true if this was its first Reveal. */
export function saveReveal(card: CharacterCard): boolean {
  const existing = loadReveals();
  if (existing.some((c) => c.id === card.id)) return false;
  try {
    localStorage.setItem(KEY, JSON.stringify([...existing, card]));
  } catch {
    // Storage unavailable: the card still shows this session.
  }
  return true;
}

export function revealForBuild(toyId: string, signature: string): CharacterCard | undefined {
  return loadReveals().find((c) => c.toyId === toyId && c.signature === signature);
}

export function revealsForToy(toyId: string): CharacterCard[] {
  return loadReveals().filter((c) => c.toyId === toyId);
}
