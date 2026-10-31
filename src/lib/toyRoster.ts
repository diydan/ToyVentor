// Phase 2 canonical Toy Box roster helpers, Star Scout grandfathering rule,
// FitChoice persistence for the hidden Forge Mount calibration row, and the
// 25-key `robot.*` -> Kip `Character` wardrobe alias table.
import {
  DEFAULT_FIT,
  FIT_VARIANTS,
  type FitChoice,
} from "../../shared/calibration";
import { isBuiltInToy, type Toy } from "../../shared/toy";
import {
  enabledStarterToys,
  seedCar,
  seedFigure,
  seedKip,
} from "../features/scan/scan";
import { revealsForToy } from "../state/reveals";
import { skinForToy } from "../state/skins";
import { BUILD_STORAGE_PREFIX } from "./builds";
import type { ProgressionState } from "./progression";
import {
  findVehicleAuditByIdOrAlias,
  resolvePhase4VehicleRoster,
  type LockedVehicleCard,
  type VehicleGrandfatherSignals,
} from "./vehicleReadiness";

export const ACTIVE_TOY_STORAGE_KEY = "toyforge:active-toy:v1";
export const FIT_CHOICE_STORAGE_KEY = "toyforge:fit-choice:v1";

/** Retired starter aliases collapse onto canonical starter ids, never creating new toys. */
const RETIRED_CAR_NAMES = new Set([
  "roadster racer",
  "race car",
  "red racer",
  "formula / gt race car",
]);
const RETIRED_KIP_NAMES = new Set(["kip (modular hero)", "kip"]);
const RETIRED_FIGURE_NAMES = new Set(["star scout", "space scout"]);

export type KipWardrobeSlot =
  | "base"
  | "eyes"
  | "ears"
  | "hat"
  | "back"
  | "tail"
  | "prop"
  | "boots";

export interface KipWardrobeAlias {
  robotKey: string;
  slot: KipWardrobeSlot;
  spotWorld?: "sky" | "junk" | "beach" | "snow" | "room";
}

/**
 * Exact 25-key `robot.*` -> Kip `Character` slot alias table
 * (`docs/specs/native-world-port-spec.md` §4.2 & `stage-simplification-and-kip-spec.md` §5).
 * Preserves all 25 wire keys and all 11 hidden world spots.
 */
export const ROBOT_WARDROBE_ALIASES: Readonly<Record<string, KipWardrobeAlias>> = {
  "robot.head.box": { robotKey: "robot.head.box", slot: "base" },
  "robot.head.dome": { robotKey: "robot.head.dome", slot: "base" },
  "robot.head.cams": { robotKey: "robot.head.cams", slot: "base", spotWorld: "sky" },
  "robot.head.tv": { robotKey: "robot.head.tv", slot: "base", spotWorld: "room" },
  "robot.head.visor": { robotKey: "robot.head.visor", slot: "base" },

  "robot.top.antenna": { robotKey: "robot.top.antenna", slot: "hat" },
  "robot.top.siren": { robotKey: "robot.top.siren", slot: "hat" },
  "robot.top.gearcrown": { robotKey: "robot.top.gearcrown", slot: "hat", spotWorld: "sky" },
  "robot.top.radar": { robotKey: "robot.top.radar", slot: "hat", spotWorld: "beach" },
  "robot.top.bulb": { robotKey: "robot.top.bulb", slot: "hat", spotWorld: "room" },

  "robot.torso.box": { robotKey: "robot.torso.box", slot: "back" },
  "robot.torso.tank": { robotKey: "robot.torso.tank", slot: "back" },
  "robot.torso.barrel": { robotKey: "robot.torso.barrel", slot: "back", spotWorld: "junk" },
  "robot.torso.core": { robotKey: "robot.torso.core", slot: "back", spotWorld: "snow" },
  "robot.torso.jet": { robotKey: "robot.torso.jet", slot: "back" },

  "robot.arms.claws": { robotKey: "robot.arms.claws", slot: "prop" },
  "robot.arms.hands": { robotKey: "robot.arms.hands", slot: "prop" },
  "robot.arms.tools": { robotKey: "robot.arms.tools", slot: "prop", spotWorld: "junk" },
  "robot.arms.magnets": { robotKey: "robot.arms.magnets", slot: "prop" },
  "robot.arms.propellers": { robotKey: "robot.arms.propellers", slot: "prop", spotWorld: "beach" },

  "robot.legs.walkers": { robotKey: "robot.legs.walkers", slot: "boots" },
  "robot.legs.treads": { robotKey: "robot.legs.treads", slot: "boots" },
  "robot.legs.wheels": { robotKey: "robot.legs.wheels", slot: "boots", spotWorld: "junk" },
  "robot.legs.springs": { robotKey: "robot.legs.springs", slot: "boots", spotWorld: "snow" },
  "robot.legs.hover": { robotKey: "robot.legs.hover", slot: "boots" },
};

/** Canonical display title for built-in and scanned toys (§5.2 name alignment). */
export function canonicalToyName(toy: Toy): string {
  if (toy.id === "seed-kip") return "Kip";
  if (toy.id === "seed-car") return "Red Racer";
  if (toy.id === "seed-figure") return "Star Scout";
  const byId = findVehicleAuditByIdOrAlias(toy.id);
  if (byId) return byId.name;
  const lower = toy.name.trim().toLowerCase();
  if (isBuiltInToy(toy)) {
    if (RETIRED_CAR_NAMES.has(lower)) return "Red Racer";
    if (RETIRED_KIP_NAMES.has(lower)) return "Kip";
    if (RETIRED_FIGURE_NAMES.has(lower)) return "Star Scout";
    const byAlias = findVehicleAuditByIdOrAlias(lower);
    if (byAlias) return byAlias.name;
  }
  return toy.name;
}

/** Normalize a saved seed/alias toy onto its canonical starter or Maker Rank identity. */
export function normalizeSavedToyIdentity(toy: Toy): Toy {
  const lower = toy.name.trim().toLowerCase();
  if (toy.id === "seed-kip" || (isBuiltInToy(toy) && RETIRED_KIP_NAMES.has(lower))) {
    return { ...seedKip };
  }
  if (toy.id === "seed-car" || (isBuiltInToy(toy) && RETIRED_CAR_NAMES.has(lower))) {
    return { ...seedCar };
  }
  if (
    toy.id === "seed-figure" ||
    (isBuiltInToy(toy) && RETIRED_FIGURE_NAMES.has(lower))
  ) {
    return { ...seedFigure };
  }
  const byVehicle =
    findVehicleAuditByIdOrAlias(toy.id) ??
    (isBuiltInToy(toy) ? findVehicleAuditByIdOrAlias(lower) : undefined);
  if (byVehicle) {
    if (byVehicle.seedToy) return { ...byVehicle.seedToy };
    return { ...toy, id: byVehicle.id, name: byVehicle.name };
  }
  return toy;
}

export interface StarScoutGrandfatherSignals {
  activeToyId?: string | null;
  savedToys?: readonly Toy[];
  hasSavedBuild?: boolean;
  hasSkin?: boolean;
  hasReveal?: boolean;
}

/**
 * Pure Phase 2 grandfathering predicate for `Star Scout` (`seed-figure`):
 * never presented as a new unlock or fresh starter, but remains enabled
 * immediately on any device with `activeToyId === "seed-figure"` or a saved
 * `seed-figure` build/customization.
 */
export function isStarScoutGrandfathered(
  signals: StarScoutGrandfatherSignals,
): boolean {
  if (signals.activeToyId === "seed-figure") return true;
  if (signals.hasSavedBuild) return true;
  if (signals.hasSkin) return true;
  if (signals.hasReveal) return true;
  if (signals.savedToys?.some((toy) => toy.id === "seed-figure")) return true;
  return false;
}

/** Check localStorage for any non-empty saved `Placement[]` on `toyId`. */
export function hasSavedBuildInStorage(toyId: string): boolean {
  try {
    const raw = localStorage.getItem(`${BUILD_STORAGE_PREFIX}${toyId}`);
    if (!raw) return false;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
  }
}

/** Inspect live browser storage for `Star Scout` (`seed-figure`) grandfathering. */
export function checkStarScoutGrandfatheredFromStorage(
  activeToyId?: string | null,
  savedToys?: readonly Toy[],
): boolean {
  return isStarScoutGrandfathered({
    activeToyId,
    savedToys,
    hasSavedBuild: hasSavedBuildInStorage("seed-figure"),
    hasSkin: Boolean(skinForToy("seed-figure")),
    hasReveal: revealsForToy("seed-figure").length > 0,
  });
}

/**
 * Enabled built-in starters for Phase 2:
 * `Kip` (`seed-kip`) #1, `Red Racer` (`seed-car`) #2, plus `Star Scout`
 * (`seed-figure`) ONLY when grandfathered.
 */
export function resolveEnabledBuiltInToys(
  signals: StarScoutGrandfatherSignals,
): Toy[] {
  return isStarScoutGrandfathered(signals)
    ? [...enabledStarterToys, seedFigure]
    : [...enabledStarterToys];
}

/**
 * Deduplicate and merge family-saved toys with enabled Phase 2 built-ins.
 * Enforces one active unit per `id` and collapses retired seed aliases so
 * starter multiplicity never creates duplicate toys.
 */
export function mergePhase2Roster(
  savedToys: readonly Toy[],
  signals: StarScoutGrandfatherSignals,
): Toy[] {
  const builtIns = resolveEnabledBuiltInToys({
    ...signals,
    savedToys,
  });
  const uploadsById = new Map<string, Toy>();
  for (const raw of savedToys) {
    const normalized = normalizeSavedToyIdentity(raw);
    if (isBuiltInToy(normalized)) continue;
    if (!uploadsById.has(normalized.id)) {
      uploadsById.set(normalized.id, normalized);
    }
  }
  // Starters lead with Kip (#1) + Red Racer (#2) on fresh boot; family uploads
  // stay addressable alongside them with zero duplicates.
  return [...builtIns, ...uploadsById.values()];
}

export interface Phase4RosterResult {
  enabledToys: Toy[];
  lockedVehicles: LockedVehicleCard[];
}

export interface Phase4RosterSignals extends StarScoutGrandfatherSignals {
  hasSavedBuildForToy?: (toyId: string) => boolean;
  hasSkinForToy?: (toyId: string) => boolean;
  hasRevealForToy?: (toyId: string) => boolean;
}

/**
 * Phase 4 XP-wired roster resolver (ready to flip into `MyToySheet.tsx` once
 * Phase 3 lands per `app-continuation-spec.md` §4.4 & §5.1–§5.3):
 * - Keeps `Kip` (`seed-kip`) and `Red Racer` (`seed-car`) enabled at Rank 1.
 * - Preserves `Star Scout` (`seed-figure`) strictly via grandfathering
 *   (including permanent `progression.unlockedIds`), never as a rank unlock.
 * - Exposes only `ready: true` Maker Rank vehicles (`unlockedVehicles` when
 *   rank-unlocked, sandbox-unlocked, or grandfathered; `lockedVehicles` with
 *   one-line §5.3 guidance otherwise).
 * - Deduplicates family-saved scan/manual uploads and collapses all §5.2
 *   built-in content aliases onto canonical IDs.
 */
export function mergePhase4Roster(
  savedToys: readonly Toy[],
  progression: ProgressionState,
  signals: Phase4RosterSignals = {},
): Phase4RosterResult {
  const starScoutEnabled =
    progression.unlockedIds.includes("seed-figure") ||
    isStarScoutGrandfathered({ ...signals, savedToys });
  const starters = starScoutEnabled
    ? [...enabledStarterToys, seedFigure]
    : [...enabledStarterToys];

  const vehicleSignals: VehicleGrandfatherSignals = {
    activeToyId: signals.activeToyId,
    savedToys,
    ...(signals.hasSavedBuildForToy
      ? { hasSavedBuild: signals.hasSavedBuildForToy }
      : {}),
    ...(signals.hasSkinForToy ? { hasSkin: signals.hasSkinForToy } : {}),
    ...(signals.hasRevealForToy ? { hasReveal: signals.hasRevealForToy } : {}),
  };

  const { unlockedVehicles, lockedVehicles } = resolvePhase4VehicleRoster(
    progression,
    vehicleSignals,
  );

  const byId = new Map<string, Toy>();
  for (const starter of starters) {
    byId.set(starter.id, starter);
  }
  for (const vehicle of unlockedVehicles) {
    if (!byId.has(vehicle.id)) {
      byId.set(vehicle.id, vehicle);
    }
  }
  for (const raw of savedToys) {
    const normalized = normalizeSavedToyIdentity(raw);
    if (isBuiltInToy(normalized)) continue;
    if (!byId.has(normalized.id)) {
      byId.set(normalized.id, normalized);
    }
  }

  return {
    enabledToys: [...byId.values()],
    lockedVehicles,
  };
}

export function loadActiveToyId(): string | undefined {
  try {
    const raw = localStorage.getItem(ACTIVE_TOY_STORAGE_KEY)?.trim();
    return raw ? raw : undefined;
  } catch {
    return undefined;
  }
}

export function saveActiveToyId(toyId: string): void {
  try {
    localStorage.setItem(ACTIVE_TOY_STORAGE_KEY, toyId);
  } catch {
    /* ignore storage quota */
  }
}

export function loadFitChoice(): FitChoice {
  try {
    const raw = localStorage.getItem(FIT_CHOICE_STORAGE_KEY);
    if (FIT_VARIANTS.some((v) => v.id === raw)) {
      return raw as FitChoice;
    }
    return DEFAULT_FIT;
  } catch {
    return DEFAULT_FIT;
  }
}

export function saveFitChoice(choice: FitChoice): void {
  try {
    localStorage.setItem(FIT_CHOICE_STORAGE_KEY, choice);
  } catch {
    /* ignore storage quota */
  }
}
