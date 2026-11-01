// One place for the kid's saved builds. The builder writes them, the Play
// screen reads them, and the toy contract is built from them.
// The storage key keeps its old "toyforge:" prefix on purpose: it is an
// internal key, not public copy, and changing it would drop every build
// kids have already made.
import type { Placement } from "../../shared/build";
import type { Part } from "../../shared/part";

export const BUILD_STORAGE_PREFIX = "toyforge:build:v1:";

/** Part ids renamed by the Snap -> Motion -> Pro tier rename (2026-11-01).
 *  A saved build stores the part id, so a renamed part would silently drop out
 *  of a child's build. Rewriting the id on read keeps those builds intact;
 *  the next save writes the new id. */
const RENAMED_PART_IDS: Record<string, string> = {
  "adapter-snap-pro": "adapter-snap-motion",
  "pro-steer-bridge": "motion-steer-bridge",
  "pro-steer-knuckle-l": "motion-steer-knuckle-l",
  "pro-steer-knuckle-r": "motion-steer-knuckle-r",
  "pro-steer-rack": "motion-steer-rack",
  "pro-tie-rod-link": "motion-tie-rod-link",
  "pro-fork-rake-adpt": "motion-fork-rake-adpt",
  "pro-axle-keeper": "motion-axle-keeper",
  "pro-tub-hinge": "motion-tub-hinge",
  "pro-captive-pin-28": "motion-captive-pin-28",
  "pro-steer-column": "motion-steer-column",
  "pro-steer-wheel": "motion-steer-wheel",
  "pro-pilot-pin": "motion-pilot-pin",
};

export function migratedPartId(partId: string): string {
  return RENAMED_PART_IDS[partId] ?? partId;
}

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
    return (parsed as Placement[])
      .map((placement) => {
        const partId = migratedPartId(placement.partId);
        return partId === placement.partId ? placement : { ...placement, partId };
      })
      .filter((placement) => partsById.has(placement.partId));
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
