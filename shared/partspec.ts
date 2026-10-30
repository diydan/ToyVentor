// PartSpec -> app bridge. Converts the PartSpec package's catalog +
// manifest records (parts/partspec) into app Part records (shared/part.ts).
//
// Two modes:
// 1. Default strict mode (no options): preserves conservative fail-closed
//    behavior (exact 4-stat synonyms, Snap only, placeholder stat value).
// 2. Full catalog mode ({ mapAllStats: true, includePro: true }): bridges
//    Snap Small (12.5 mm), Snap Large (25 mm), Forge Mounts, Snap-to-Pro
//    Adapter, and Pro mechanisms (12.5 mm TU) with real bboxMm, STL/GLB
//    asset filenames, deterministic 1..3 stat values, and CPSC 16 CFR 1500.19
//    small-part warnings.

import type { Line, Mount, Part, SizeClass, StatName } from "./part";

export interface PartSpecCatalogPart {
  id: string;
  name: string;
  line: string;
  family?: string;
  size: string;
  stat: string;
  tags?: string[];
}

export interface PartSpecConnector {
  id?: string;
  kind?: string;
  interface?: string;
  grid?: { nx: number; ny: number; pitch: number };
}

export interface PartSpecManifestPart {
  id: string;
  design_status?: string;
  prints?: boolean;
  file?: string;
  bbox_mm?: [number, number, number];
  connectors?: PartSpecConnector[];
  print?: { orientation?: string; supports?: boolean };
  safety?: { small_part_status?: string; small_part_warning?: string };
}

export interface BridgeOptions {
  /** Map all 19 PartSpec stat labels onto the 4 app game stats. */
  mapAllStats?: boolean;
  /** Bridge Pro parts (bore_grid, pins, shafts, gears, mounts) onto 12.5 mm TU. */
  includePro?: boolean;
  /** ID prefix (defaults to "partspec-"; pass "" for clean canonical IDs). */
  idPrefix?: string;
  /** Derive 1..3 rarity/tier stat values instead of PLACEHOLDER_STAT_VALUE. */
  deriveStatValue?: boolean;
  /** Populate stlFile, glbFile, bboxMm, and smallPartWarning on bridged Parts. */
  includeAssets?: boolean;
}

export type BridgeResult =
  | { ok: true; part: Part }
  | { ok: false; id: string; reason: string };

export const PLACEHOLDER_STAT_VALUE = 1;

const STRICT_STAT_MAP: Record<string, StatName> = {
  Speed: "speed",
  Spin: "spin",
  Torque: "torque",
  Glow: "glow",
};

/** Deterministic mapping of all 19 PartSpec stats onto the 4 game stats. */
export const EXTENDED_STAT_MAP: Record<string, StatName> = {
  // Speed slot (thrusters, wings, spoilers, slides)
  Speed: "speed",
  Lift: "speed",
  Launch: "speed",
  Slide: "speed",
  Bounce: "speed",
  // Spin slot (rotors, wheels, balance, sensors, hinges)
  Spin: "spin",
  Balance: "spin",
  Roll: "spin",
  Swing: "spin",
  Awareness: "spin",
  // Torque slot (structural bricks, grips, armor, shafts, beams)
  Torque: "torque",
  Sturdiness: "torque",
  Grip: "torque",
  Toughness: "torque",
  Power: "torque",
  Reach: "torque",
  // Glow slot (lights, capsules, hats, expressive flair)
  Glow: "glow",
  Charm: "glow",
  Style: "glow",
};

/** Curated stat values (1 = common, 2 = uncommon, 3 = rare) for hero & catalog parts. */
const CURATED_STAT_VALUES: Record<string, 1 | 2 | 3> = {
  glow_capsule: 3,
  glow_capsule_l: 3,
  gear_spur_z20: 3,
  gear_spur_z30: 3,
  robot_back_jetpack: 3,
  racer_light_bar: 3,
  prop_star_shield: 3,
  veh_car_chassis: 3,
  veh_truck_chassis: 3,
  racer_spoiler: 2,
  ridge_fin: 2,
  cloud_wings: 2,
  cloud_wings_l: 2,
  wobble_hat: 2,
  spin_capsule: 2,
  zoom_capsule: 2,
  zoom_capsule_s: 2,
  beam_str_tu05: 2,
  gear_spur_z10: 2,
  gear_spur_z15: 2,
  racer_hood_scoop: 2,
  racer_twin_exhaust: 2,
  bumper_horns: 2,
  waddle_tail_s: 2,
  pack_explorer: 2,
  veh_wheel_sport: 2,
};

export function statValueForPart(id: string): 1 | 2 | 3 {
  if (CURATED_STAT_VALUES[id]) return CURATED_STAT_VALUES[id]!;
  // Deterministic 1..2 fallback by ID hash so expansion parts have natural variety
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 3 === 0 ? 2 : 1;
}

function pickGridConnector(connectors: PartSpecConnector[]): PartSpecConnector | undefined {
  // Prefer socket_grid (bottom footprint on toy), then stud_grid, bore_grid, pin.
  const order = ["socket_grid", "stud_grid", "bore_grid", "pin"];
  for (const kind of order) {
    const found = connectors.find((c) => c.kind === kind && c.grid);
    if (found) return found;
  }
  return connectors.find((c) => c.grid);
}

export function convertPartSpecPart(
  catalog: PartSpecCatalogPart,
  manifest: PartSpecManifestPart | undefined,
  options: BridgeOptions = {},
): BridgeResult {
  const id = catalog.id;
  const skip = (reason: string): BridgeResult => ({ ok: false, id, reason });

  const allowPro = options.includePro === true;
  if (catalog.line !== "snap" && (!allowPro || catalog.line !== "pro")) {
    return skip(`line "${catalog.line}" not bridged yet (snap only)`);
  }

  let sizeClass: SizeClass;
  if (catalog.size === "small" || catalog.size === "large") {
    sizeClass = catalog.size;
  } else if (allowPro && catalog.size === "pro") {
    // Pro 12.5 mm TU shares the Small 12.5 mm pitch class.
    sizeClass = "small";
  } else {
    return skip(`size "${catalog.size}" is not a Snap size class`);
  }

  if (!manifest) return skip("no manifest entry (not generated)");
  if (manifest.design_status !== "verified") {
    return skip(`design_status "${manifest.design_status ?? "missing"}", not verified`);
  }
  if (manifest.prints !== true || !manifest.file) {
    return skip("not a printable part with an STL");
  }

  const statTable = options.mapAllStats ? EXTENDED_STAT_MAP : STRICT_STAT_MAP;
  const statName = statTable[catalog.stat];
  if (!statName) return skip(`stat "${catalog.stat}" has no app game mapping yet`);

  const gridConn = pickGridConnector(manifest.connectors ?? []);
  if (!gridConn?.grid) return skip("no connector grid to derive footprint from");
  const { nx, ny, pitch } = gridConn.grid;

  const isForgeMount =
    catalog.family === "forge_mount" ||
    (catalog.tags ?? []).includes("forge_mount") ||
    catalog.id === "adapter_snap_pro";

  const line: Line = catalog.line === "pro" ? "pro" : "snap";
  const isHoleGrid =
    line === "pro" || gridConn.kind === "bore_grid" || gridConn.interface === "bore_grid";
  const mount: Mount = isForgeMount
    ? "forge-mount"
    : isHoleGrid
      ? "hole"
      : "stud";

  const prefix = options.idPrefix ?? "partspec-";
  const appId = `${prefix}${id.replace(/_/g, "-")}`;
  const statValue = options.deriveStatValue ? statValueForPart(id) : PLACEHOLDER_STAT_VALUE;

  const profile = isHoleGrid
    ? "tu_12.5"
    : gridConn.interface
      ? `tu_${gridConn.interface}`
      : "tu_stud";

  const part: Part = {
    id: appId,
    name: catalog.name,
    line,
    mount,
    sizeClass,
    grid: {
      units: [nx, ny],
      profile,
    },
    footprintMm: [nx * pitch, ny * pitch],
    stat: { name: statName, value: statValue },
    printable: true,
    orientation: manifest.print?.orientation ?? "flat",
    supportFree: manifest.print?.supports !== true,
  };

  if (options.includeAssets) {
    part.stlFile = `${appId}.stl`;
    part.glbFile = `${appId}.glb`;
    if (
      Array.isArray(manifest.bbox_mm) &&
      manifest.bbox_mm.length === 3 &&
      manifest.bbox_mm.every((n) => typeof n === "number" && Number.isFinite(n))
    ) {
      part.bboxMm = [manifest.bbox_mm[0], manifest.bbox_mm[1], manifest.bbox_mm[2]];
    }
    const spStatus = manifest.safety?.small_part_status;
    if (spStatus && spStatus !== "above_cylinder") {
      part.smallPartWarning = true;
    }
  }

  return { ok: true, part };
}

/** Demo subset kept for backwards-compatible bridge tests. */
export const DEMO_SUBSET_IDS = [
  "ridge_fin",
  "zoom_capsule_s",
  "glow_capsule",
  "zoom_capsule",
  "glow_capsule_l",
  "spin_capsule",
];

/** Canonical 12.5 mm / 25 mm TU Base Library IDs in parts/partspec/catalog.json. */
export const BASE_SET_PARTSPEC_IDS = [
  "racer_spoiler",
  "brick_s_2x2",
  "dome_s_2x2",
  "big_blue_brick",
  "spin_capsule",
  "adapter_snap_pro",
  "forge_mount_ring_s",
  "cloud_wings",
  "glow_capsule",
  "beam_str_tu05",
  "pin_friction",
  "gear_spur_z10",
  "gear_spur_z20",
] as const;

/** Forge Club Expansion Set 1: Racer Garage (12.5 mm TU). */
export const RACER_GARAGE_PARTSPEC_IDS = [
  "racer_bull_bar",
  "racer_hood_scoop",
  "racer_twin_exhaust",
  "racer_light_bar",
  "racer_roof_rack",
  "racer_wheel",
  "veh_wheel_sport",
  "veh_car_hood_cover",
] as const;

/** Forge Club Expansion Set 2: Kip & Critter Wardrobe (12.5 mm TU). */
export const KIP_WARDROBE_PARTSPEC_IDS = [
  "bumper_horns",
  "pointy_ears",
  "wobble_hat",
  "waddle_tail_s",
  "robot_back_jetpack",
  "robot_head_visor",
  "pack_explorer",
  "prop_wrench",
  "prop_star_shield",
] as const;
