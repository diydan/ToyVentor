// Phase 4 Per-Vehicle Readiness Audit, Canonical Alias Map, and Locked-Card
// Gate Helpers (docs/specs/app-continuation-spec.md §4.5, §5.1–§5.3).
//
// Invariants enforced here:
// 1. Star Scout (`seed-figure`) is already a bundled seed toy and is never
//    listed as a Maker Rank unlock or locked card (§4.5, §5.1).
// 2. No rank or sandbox override exposes unverified or unprinted geometry:
//    only entries with `ready === true` (all four §5.1 gates passing and a
//    verified bundled `seedToy`) can appear as unlocked vehicles or greyed-out
//    locked cards (§4.5, §5.1).
// 3. Content aliases collapse onto canonical vehicle IDs and names so alternate
//    art/spec titles never create duplicate roster rows (§5.2).
// 4. Previously earned access never regresses across roster updates or XP
//    resets (§5.3).

import type { Toy } from "../../shared/toy";
import {
  seedAeroplane,
  seedCatamaran,
  seedHelicopter,
  seedMotorbike,
  seedScooter,
  seedShuttle,
  seedTractor,
  seedTruck,
} from "../features/scan/scan";
import { revealsForToy } from "../state/reveals";
import { skinForToy } from "../state/skins";
import { BUILD_STORAGE_PREFIX } from "./builds";
import { canAccessVehicle, type ProgressionState } from "./progression";

export type Phase4VehicleSeedId =
  | "seed-truck"
  | "seed-scooter"
  | "seed-motorbike"
  | "seed-tractor"
  | "seed-aeroplane"
  | "seed-catamaran"
  | "seed-helicopter"
  | "seed-shuttle"
  | "seed-mech";

export type Phase4VehicleIconVariant =
  | "truck"
  | "scooter"
  | "motorbike"
  | "tractor"
  | "aeroplane"
  | "catamaran"
  | "helicopter"
  | "shuttle"
  | "mech";

export interface VehicleReadinessGates {
  /** Verified PartSpec v2 geometry + passing preprint_check + STL on disk. */
  partVerified: boolean;
  /** Cited STEM mission(s) exist in shipped Lab 1..6 / world levels. */
  missionShipped: boolean;
  /** Final crisp vector SVG silhouette shipped in ToyMiniIcon. */
  artFinal: boolean;
  /** Flattened build save + toyventor.toy/1 contract verified (no parallel payload). */
  saveShapeVerified: boolean;
}

export interface VehicleReadinessEntry {
  id: Phase4VehicleSeedId;
  /** Exact canonical display name matching RANKS[i].vehicles in progression.ts. */
  name: string;
  /** §5.2 content/spec aliases that resolve to this canonical vehicle. */
  contentAliases: readonly string[];
  rank: 2 | 3 | 4 | 5 | 6;
  rankTitle: string;
  xpThreshold: number;
  /** Primary PartSpec part IDs (verified W9 or planned W10/W11/Card F). */
  partSpecIds: readonly string[];
  /** Conforming assembly ID in kip-partspec-manifest.json or Gate G1 kitcard sweep when verified. */
  verifiedAssemblyId: string | null;
  /** Shipped app builder set part IDs (sets/base.json, racer-garage.json, modular-craft.json). */
  appCatalogPartIds: readonly string[];
  /** Shipped STEM lab / world mission IDs where the kid earns XP toward this unlock. */
  recommendedMissions: readonly string[];
  /** Primary STEM lab cited in one-line locked-card guidance. */
  recommendedLabLabel: string;
  /** Vector SVG variant rendered by ToyMiniIcon. */
  iconVariant: Phase4VehicleIconVariant;
  /** Deterministic rarity source citation (§5.1). */
  raritySource: string;
  /** Authoritative flattened save & wire contract shape (§5.1, §7). */
  saveBehavior: string;
  /** Bundled Toy JSON when partVerified is true; null while held back. */
  seedToy: Toy | null;
  /** Default §5.3 one-line locked-card guidance (at 0 XP). */
  unlockGuidance: string;
  gates: VehicleReadinessGates;
  /** True iff all four §5.1 gates pass and `seedToy` is non-null. */
  ready: boolean;
  /** Explicit engineering blocker when `ready === false`. */
  blocker?: string;
}

const RARITY_SOURCE_CITATION =
  "shared/pack.ts rarityForPart(part.stat.value: 1=common, 2=uncommon, 3=rare) + deterministic Maker Rank XP Track A (0 RNG)";

function saveBehaviorFor(id: Phase4VehicleSeedId): string {
  return `localStorage "${BUILD_STORAGE_PREFIX}${id}" (Placement[]) + "toyforge:active-toy:v1" + "toyventor.toy/1" (type: "vehicle")`;
}

function computeReady(gates: VehicleReadinessGates, seedToy: Toy | null): boolean {
  return (
    seedToy !== null &&
    gates.partVerified &&
    gates.missionShipped &&
    gates.artFinal &&
    gates.saveShapeVerified
  );
}

function defineEntry(
  input: Omit<VehicleReadinessEntry, "raritySource" | "saveBehavior" | "ready">,
): VehicleReadinessEntry {
  return {
    ...input,
    raritySource: RARITY_SOURCE_CITATION,
    saveBehavior: saveBehaviorFor(input.id),
    ready: computeReady(input.gates, input.seedToy),
  };
}

/**
 * Complete §5.1 Per-Vehicle Readiness Audit across all 9 Rank 2–6 vehicles in
 * catalog order (`src/lib/progression.ts` `RANKS`).
 */
export const VEHICLE_READINESS_AUDIT: readonly VehicleReadinessEntry[] = [
  defineEntry({
    id: "seed-truck",
    name: "Hauler Truck",
    contentAliases: [
      "Dump / Tow Truck",
      "Dump Truck",
      "Tow Truck",
      "Heavy Hauler Truck",
    ],
    rank: 2,
    rankTitle: "Workshop Builder",
    xpThreshold: 250,
    partSpecIds: [
      "veh_truck_chassis",
      "veh_truck_bed_cover",
      "veh_cab_roof_cover",
      "veh_car_hood_cover",
      "veh_steering_wheel",
      "veh_wheel_offroad",
    ],
    verifiedAssemblyId: "hauler_truck_v2_covers_and_offroad_wheels",
    appCatalogPartIds: [
      "racer-bull-bar",
      "racer-roof-rack",
      "racer-light-bar",
      "veh-car-hood-cover",
      "veh-wheel-sport",
      "brick-s-2x2",
    ],
    recommendedMissions: ["lab1.bridge", "lab1.balance", "garden.bridge"],
    recommendedLabLabel: "Lab 1: Bridges",
    iconVariant: "truck",
    seedToy: seedTruck,
    unlockGuidance: "Earn 250 XP in Lab 1: Bridges to unlock Hauler Truck.",
    gates: {
      partVerified: true,
      missionShipped: true,
      artFinal: true,
      saveShapeVerified: true,
    },
  }),
  defineEntry({
    id: "seed-scooter",
    name: "Motor Scooter",
    contentAliases: [
      "Step-Through Motor Scooter",
      "City Scooter",
      "Snap Scooter",
    ],
    rank: 2,
    rankTitle: "Workshop Builder",
    xpThreshold: 250,
    partSpecIds: [
      "veh_scooter_frame",
      "veh_scooter_fairing",
      "veh_handlebar_fork",
      "veh_wheel_moto",
    ],
    verifiedAssemblyId: "motor_scooter_v2_inline_2wheel",
    appCatalogPartIds: [
      "racer-light-bar",
      "racer-wheel",
      "veh-wheel-sport",
      "dome-s-2x2",
      "glow-capsule",
    ],
    recommendedMissions: ["lab1.measure", "lab4.circuit"],
    recommendedLabLabel: "Lab 1: Bridges",
    iconVariant: "scooter",
    seedToy: seedScooter,
    unlockGuidance: "Earn 250 XP in Lab 1: Bridges to unlock Motor Scooter.",
    gates: {
      partVerified: true,
      missionShipped: true,
      artFinal: true,
      saveShapeVerified: true,
    },
  }),
  defineEntry({
    id: "seed-motorbike",
    name: "Sport Motorbike",
    contentAliases: [
      "2-in-1 Sport Motorbike",
      "Motorbike & Cargo Trike",
      "Inline Motorbike",
      "Cargo Trike",
    ],
    rank: 3,
    rankTitle: "Gearhead",
    xpThreshold: 600,
    partSpecIds: [
      "veh_scooter_frame",
      "veh_scooter_fairing",
      "veh_moto_cowling",
      "veh_handlebar_fork",
      "veh_wheel_moto",
    ],
    verifiedAssemblyId: "sport_motorbike_v2_inline_2wheel",
    appCatalogPartIds: [
      "veh-car-hood-cover",
      "veh-wheel-sport",
      "racer-twin-exhaust",
      "racer-spoiler",
      "gear-spur-z10",
    ],
    recommendedMissions: ["lab2.lift", "lab2.logic", "junk.lift"],
    recommendedLabLabel: "Lab 2: Machines",
    iconVariant: "motorbike",
    seedToy: seedMotorbike,
    unlockGuidance: "Earn 600 XP in Lab 2: Machines to unlock Sport Motorbike.",
    gates: {
      partVerified: true,
      missionShipped: true,
      artFinal: true,
      saveShapeVerified: true,
    },
  }),
  defineEntry({
    id: "seed-tractor",
    name: "Loader Tractor & Trailer",
    contentAliases: [
      "Farm / Loader Tractor",
      "Modular Trailer",
      "Loader Tractor",
      "Tractor & Trailer",
    ],
    rank: 3,
    rankTitle: "Gearhead",
    xpThreshold: 600,
    partSpecIds: [
      "kit_keel_base",
      "kit_clevis_spine",
      "kit_wheel_med",
      "kit_wheel_giant",
      "kit_scoop_blade",
      "kit_tilting_tub",
      "kit_turntable",
      "kit_barbell_shaft",
      "kit_spinner_pin",
    ],
    verifiedAssemblyId: "3_tractor_giant_steer",
    appCatalogPartIds: [
      "kit-keel-base",
      "kit-wheel-giant",
      "kit-scoop-blade",
      "kit-tilting-tub",
      "kit-turntable",
      "racer-bull-bar",
      "gear-spur-z20",
    ],
    recommendedMissions: ["lab2.lift", "lab4.lever"],
    recommendedLabLabel: "Lab 2: Machines",
    iconVariant: "tractor",
    seedToy: seedTractor,
    unlockGuidance:
      "Earn 600 XP in Lab 2: Machines to unlock Loader Tractor & Trailer.",
    gates: {
      partVerified: true,
      missionShipped: true,
      artFinal: true,
      saveShapeVerified: true,
    },
  }),
  defineEntry({
    id: "seed-aeroplane",
    name: "Prop Aeroplane",
    contentAliases: ["Prop / Jet Aeroplane", "Swoosh Aeroplane", "Aeroplane"],
    rank: 4,
    rankTitle: "Sky & Sea Pilot",
    xpThreshold: 1100,
    partSpecIds: [
      "kit_keel_base",
      "kit_aero_wedge",
      "kit_rotor_blade",
      "kit_foil_wing",
      "kit_spinner_pin",
      "kit_wheel_med",
    ],
    verifiedAssemblyId: "6_aeroplane_prop",
    appCatalogPartIds: [
      "kit-keel-base",
      "kit-aero-wedge",
      "kit-foil-wing",
      "kit-rotor-blade",
      "kit-wheel-med",
      "cloud-wings",
    ],
    recommendedMissions: ["lab4.lever", "lab5.code"],
    recommendedLabLabel: "Lab 4: Levers and Lights",
    iconVariant: "aeroplane",
    seedToy: seedAeroplane,
    unlockGuidance:
      "Earn 1,100 XP in Lab 4: Levers and Lights to unlock Prop Aeroplane.",
    gates: {
      partVerified: true,
      missionShipped: true,
      artFinal: true,
      saveShapeVerified: true,
    },
  }),
  defineEntry({
    id: "seed-catamaran",
    name: "Catamaran Boat",
    contentAliases: [
      "Catamaran / Speedboat",
      "Ski Catamaran",
      "Catamaran Airboat",
      "Speedboat",
    ],
    rank: 4,
    rankTitle: "Sky & Sea Pilot",
    xpThreshold: 1100,
    partSpecIds: [
      "kit_keel_base",
      "kit_skid_runner",
      "kit_aero_wedge",
      "kit_yoke_hbar",
      "kit_foil_wing",
    ],
    verifiedAssemblyId: "7_catamaran",
    appCatalogPartIds: [
      "kit-keel-base",
      "kit-skid-runner",
      "kit-aero-wedge",
      "kit-foil-wing",
      "kit-yoke-hbar",
      "racer-light-bar",
    ],
    recommendedMissions: ["lab3.raft"],
    recommendedLabLabel: "Lab 3: Water",
    iconVariant: "catamaran",
    seedToy: seedCatamaran,
    unlockGuidance:
      "Earn 1,100 XP in Lab 3: Water to unlock Catamaran Boat.",
    gates: {
      partVerified: true,
      missionShipped: true,
      artFinal: true,
      saveShapeVerified: true,
    },
  }),
  defineEntry({
    id: "seed-helicopter",
    name: "Rescue Helicopter",
    contentAliases: [
      "Twin-Blade Rescue Helicopter",
      "Helicopter",
      "Heli Rescue Craft",
    ],
    rank: 5,
    rankTitle: "Aero Captain",
    xpThreshold: 1800,
    partSpecIds: [
      "kit_keel_base",
      "kit_skid_runner",
      "kit_turntable",
      "kit_aero_wedge",
      "kit_barbell_shaft",
      "kit_rotor_blade",
      "kit_clevis_spine",
      "kit_scoop_blade",
    ],
    verifiedAssemblyId: "8_helicopter_mohawk",
    appCatalogPartIds: [
      "kit-keel-base",
      "kit-skid-runner",
      "kit-turntable",
      "kit-rotor-blade",
      "kit-barbell-shaft",
      "racer-light-bar",
    ],
    recommendedMissions: ["lab5.code", "lab5.pattern"],
    recommendedLabLabel: "Lab 5: Code and Patterns",
    iconVariant: "helicopter",
    seedToy: seedHelicopter,
    unlockGuidance:
      "Earn 1,800 XP in Lab 5: Code and Patterns to unlock Rescue Helicopter.",
    gates: {
      partVerified: true,
      missionShipped: true,
      artFinal: true,
      saveShapeVerified: true,
    },
  }),
  defineEntry({
    id: "seed-shuttle",
    name: "Space Shuttle",
    contentAliases: [
      "Space Shuttle Orbiter",
      "Orbiter",
      "Shuttle Orbiter",
    ],
    rank: 5,
    rankTitle: "Aero Captain",
    xpThreshold: 1800,
    partSpecIds: [
      "kit_keel_base",
      "kit_aero_wedge",
      "kit_foil_wing",
      "kit_booster_pod",
      "kit_tilting_tub",
      "skin_cargo_shroud",
      "kit_wheel_med",
    ],
    verifiedAssemblyId: "9_shuttle_and_mech_keepouts",
    appCatalogPartIds: [
      "kit-keel-base",
      "kit-aero-wedge",
      "kit-foil-wing",
      "kit-booster-pod",
      "skin-cargo-shroud",
      "glow-capsule",
    ],
    recommendedMissions: ["lab4.circuit", "lab5.pattern"],
    recommendedLabLabel: "Lab 5: Code and Patterns",
    iconVariant: "shuttle",
    seedToy: seedShuttle,
    unlockGuidance:
      "Earn 1,800 XP in Lab 5: Code and Patterns to unlock Space Shuttle.",
    gates: {
      partVerified: true,
      missionShipped: true,
      artFinal: true,
      saveShapeVerified: true,
    },
  }),
  defineEntry({
    id: "seed-mech",
    name: "Bolt Power Mech",
    contentAliases: ["Bolt Mech", "Stage 4 Mech", "Power Core Mech"],
    rank: 6,
    rankTitle: "Mech Inventor",
    xpThreshold: 2700,
    partSpecIds: [
      "mech_brain_tray",
      "mech_brain_lid",
      "mech_bat_door_screw",
      "mech_drive_tray",
      "mech_drive_lid",
      "mech_servo_tray",
      "mech_servo_lid",
      "mech_sill_duct",
      "motion_steer_bridge",
      "motion_steer_rack",
    ],
    verifiedAssemblyId: null,
    appCatalogPartIds: [
      "adapter-snap-motion",
      "beam-str-tu05",
      "gear-spur-z10",
      "gear-spur-z20",
    ],
    recommendedMissions: ["lab5.code", "lab6.clean", "lab2.logic"],
    recommendedLabLabel: "STEM Labs 1 to 6",
    iconVariant: "mech",
    seedToy: null,
    unlockGuidance:
      "Earn 2,700 XP across STEM Labs 1 to 6 to unlock Bolt Power Mech.",
    gates: {
      partVerified: false,
      missionShipped: true,
      artFinal: true,
      saveShapeVerified: true,
    },
    blocker:
      "Stage 4 Card F PETG robotics enclosures (mech_brain_*, mech_drive_*, mech_servo_*), Wave 11 motion_steer_* linkage, Gate G5 thermal soak, and ASTM F963-23 §4.25 battery-door hardware are pre-CAD (Pass 4g spec only).",
  }),
];

const BY_KEY = new Map<string, VehicleReadinessEntry>();
for (const entry of VEHICLE_READINESS_AUDIT) {
  BY_KEY.set(entry.id.toLowerCase(), entry);
  BY_KEY.set(entry.name.toLowerCase(), entry);
  for (const alias of entry.contentAliases) {
    BY_KEY.set(alias.trim().toLowerCase(), entry);
  }
}

/** Look up a Phase 4 vehicle audit entry by canonical `seed-*` ID, name, or §5.2 content alias. */
export function findVehicleAuditByIdOrAlias(
  idOrName: string,
): VehicleReadinessEntry | undefined {
  const key = idOrName.trim().toLowerCase();
  return key ? BY_KEY.get(key) : undefined;
}

/** Return only audited Phase 4 vehicles that pass all four §5.1 entry gates (`ready === true`). */
export function readyPhase4Vehicles(): VehicleReadinessEntry[] {
  return VEHICLE_READINESS_AUDIT.filter(
    (entry) => entry.ready && entry.seedToy !== null,
  );
}

/**
 * §5.3 one-line locked-card guidance: names what to earn, where to earn it,
 * and what unlocks, without multi-line copy or em dashes.
 */
export function formatLockedVehicleGuidance(
  entry: VehicleReadinessEntry,
  currentXp = 0,
): string {
  const safeXp = Math.max(0, Math.floor(currentXp) || 0);
  if (safeXp <= 0) {
    return entry.unlockGuidance;
  }
  const remaining = Math.max(1, entry.xpThreshold - safeXp);
  const totalFmt = entry.xpThreshold.toLocaleString("en-US");
  const remFmt = remaining.toLocaleString("en-US");
  return `Earn ${remFmt} more XP (${totalFmt} XP, Rank ${entry.rank}) in ${entry.recommendedLabLabel} to unlock ${entry.name}.`;
}

export interface VehicleGrandfatherSignals {
  activeToyId?: string | null;
  savedToys?: readonly Toy[];
  hasSavedBuild?: (toyId: string) => boolean;
  hasSkin?: (toyId: string) => boolean;
  hasReveal?: (toyId: string) => boolean;
}

function defaultHasSavedBuild(toyId: string): boolean {
  try {
    const raw = localStorage.getItem(`${BUILD_STORAGE_PREFIX}${toyId}`);
    if (!raw) return false;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
  }
}

function defaultHasSkin(toyId: string): boolean {
  return Boolean(skinForToy(toyId));
}

function defaultHasReveal(toyId: string): boolean {
  return revealsForToy(toyId).length > 0;
}

function matchesEntryToy(entry: VehicleReadinessEntry, toy: Toy): boolean {
  if (toy.id === entry.id) return true;
  if (toy.source !== "seed") return false;
  const hit = findVehicleAuditByIdOrAlias(toy.name);
  return hit?.id === entry.id;
}

/**
 * §5.3 non-regression predicate: a device with an existing build, active toy
 * ID, painted skin, reveal, or saved seed copy keeps that vehicle enabled
 * immediately even if XP is 0 or reset.
 */
export function isVehicleGrandfathered(
  entry: VehicleReadinessEntry,
  signals: VehicleGrandfatherSignals = {},
): boolean {
  if (signals.activeToyId) {
    const byActive = findVehicleAuditByIdOrAlias(signals.activeToyId);
    if (signals.activeToyId === entry.id || byActive?.id === entry.id) {
      return true;
    }
  }
  const checkBuild = signals.hasSavedBuild ?? defaultHasSavedBuild;
  const checkSkin = signals.hasSkin ?? defaultHasSkin;
  const checkReveal = signals.hasReveal ?? defaultHasReveal;
  if (checkBuild(entry.id) || checkSkin(entry.id) || checkReveal(entry.id)) {
    return true;
  }
  if (signals.savedToys?.some((toy) => matchesEntryToy(entry, toy))) {
    return true;
  }
  return false;
}

export interface LockedVehicleCard {
  entry: VehicleReadinessEntry;
  toy: Toy;
  guidance: string;
}

export interface Phase4VehicleRosterSplit {
  unlockedVehicles: Toy[];
  lockedVehicles: LockedVehicleCard[];
}

/**
 * Partition audited `ready: true` Maker Rank vehicles into enabled (`Toy[]`)
 * and greyed-out locked cards (`LockedVehicleCard[]`) for a given
 * `ProgressionState` + device grandfathering signals.
 *
 * Unverified (`ready: false`) vehicles are strictly excluded from both lists so
 * no rank or locked card ever wires to unverified geometry or a placeholder.
 */
export function resolvePhase4VehicleRoster(
  progression: ProgressionState,
  signals: VehicleGrandfatherSignals = {},
): Phase4VehicleRosterSplit {
  const unlockedVehicles: Toy[] = [];
  const lockedVehicles: LockedVehicleCard[] = [];

  for (const entry of readyPhase4Vehicles()) {
    const toy = entry.seedToy!;
    const unlocked =
      canAccessVehicle(progression, entry.name, entry.id) ||
      isVehicleGrandfathered(entry, signals);
    if (unlocked) {
      unlockedVehicles.push({ ...toy });
    } else {
      lockedVehicles.push({
        entry,
        toy: { ...toy },
        guidance: formatLockedVehicleGuidance(entry, progression.totalXp),
      });
    }
  }

  return { unlockedVehicles, lockedVehicles };
}

const LAB_WORLD_PATTERN = /^lab[1-6]$/;

/**
 * Lab world id behind a locked card's "Play a STEM Lab" CTA, taken from
 * the entry's first recommended mission. Falls back to `lab1` so a bad
 * row can never strand the CTA.
 */
export function labWorldForEntry(entry: VehicleReadinessEntry): string {
  const worldId = (entry.recommendedMissions[0] ?? "").split(".")[0] ?? "";
  return LAB_WORLD_PATTERN.test(worldId) ? worldId : "lab1";
}
