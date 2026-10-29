// One place for the kid's saved builds. The builder writes them, the Play
// screen reads them, and the toy contract is built from them.
// The storage key keeps its old "toyforge:" prefix on purpose: it is an
// internal key, not public copy, and changing it would drop every build
// kids have already made.
import type { Placement } from "../../shared/build";
import type { Part } from "../../shared/part";

export const BUILD_STORAGE_PREFIX = "toyforge:build:v1:";

export function buildStorageKey(toyId: string): string {
  return `${BUILD_STORAGE_PREFIX}${toyId}`;
}

/** Read a saved build. Placements whose parts left the set are dropped, so
 *  an old build never breaks the Play screen. */
export function loadBuild(toyId: string, partsById: Map<string, Part>): Placement[] {
  try {
    const raw = localStorage.getItem(buildStorageKey(toyId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as Placement[]).filter((placement) => partsById.has(placement.partId));
  } catch {
    return [];
  }
}

/** Write a build. Storage being unavailable is not worth interrupting the
 *  kid over: the build just will not survive a reload. */
export function saveBuild(toyId: string, placements: Placement[]): void {
  try {
    localStorage.setItem(buildStorageKey(toyId), JSON.stringify(placements));
  } catch {
    // Storage full or unavailable.
  }
}
