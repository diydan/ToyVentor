// Per-part FDM toy-grade surface-finish recipe lookup & human-readable copy.
// Reads `parts/partspec/asset_optimization_manifest.json` (populated by
// `scripts/optimize_assets.py` + `scripts/llm-lod-advisor.ts`) with a
// deterministic geometry-class fallback when a test fixture part is not listed.
import type { Part } from "../../shared/part";

export type WallOrder = "outer_first" | "inner_first";
export type SeamPosition = "aligned" | "back";
export type IroningMode = "all_top" | "none";
export type SupportMode = "none" | "tree_slim" | "soluble_interface";
export type FinishClass = "show_curved" | "precision_gear_pin" | "prismatic_structural";

export interface PartSlicerRecipe {
  layer_height_mm: number;
  wall_loops: number;
  outer_wall_speed_mms: number;
  wall_order: WallOrder;
  seam_position: SeamPosition;
  ironing: IroningMode;
  ironing_inset_mm: number;
  brim_width_mm: number;
  support_mode: SupportMode;
  parent_tip?: string;
}

interface ManifestPartRecord {
  finish_class?: FinishClass;
  slicer_recipe?: Partial<PartSlicerRecipe>;
}

interface OptimizationManifestDoc {
  version?: number;
  parts?: Record<string, ManifestPartRecord>;
}

const rawManifestModules = import.meta.glob<OptimizationManifestDoc>(
  "../../parts/partspec/asset_optimization_manifest.json",
  { eager: true, import: "default" },
);

const manifestDoc: OptimizationManifestDoc =
  Object.values(rawManifestModules)[0] ?? {};

function fallbackFinishClass(partId: string): FinishClass {
  const pid = partId.toLowerCase();
  const curved = [
    "dome-",
    "skin-",
    "windscreen",
    "capsule",
    "cloud-wings",
    "robot-head-",
    "bumper-horns",
    "aero-wedge",
    "booster-pod",
    "foil-wing",
    "scoop-blade",
    "wobble-hat",
    "pointy-ears",
    "waddle-tail",
    "hood-scoop",
    "hood-cover",
  ];
  if (curved.some((t) => pid.includes(t))) return "show_curved";
  const precision = [
    "gear-",
    "pin-",
    "-pin",
    "shaft",
    "pinion",
    "screw",
    "forge-mount-",
    "wheel",
    "rotor-blade",
    "turntable",
    "beam-",
    "adapter-",
    "clevis-",
    "yoke-",
  ];
  if (precision.some((t) => pid.includes(t))) return "precision_gear_pin";
  return "prismatic_structural";
}

function fallbackRecipeFor(partId: string): PartSlicerRecipe {
  const fc = fallbackFinishClass(partId);
  const pid = partId.toLowerCase();
  const layer_height_mm =
    fc === "show_curved" ? 0.12 : pid.endsWith("-tray") ? 0.2 : 0.16;
  const wall_order: WallOrder = fc === "show_curved" ? "inner_first" : "outer_first";
  const roundTokens = [
    "dome-",
    "capsule",
    "wobble-hat",
    "forge-mount-ring",
    "pin-",
    "-pin",
    "wheel",
    "turntable",
  ];
  const seam_position: SeamPosition = roundTokens.some((t) => pid.includes(t))
    ? "back"
    : "aligned";
  const noIron = ["gear-", "pin-", "-pin", "shaft", "pinion", "screw", "wheel", "rotor-blade"];
  const ironing: IroningMode =
    fc !== "show_curved" && !noIron.some((t) => pid.includes(t)) ? "all_top" : "none";
  return {
    layer_height_mm,
    wall_loops: 3,
    outer_wall_speed_mms: 30,
    wall_order,
    seam_position,
    ironing,
    ironing_inset_mm: ironing === "all_top" ? 0.21 : 0,
    brim_width_mm: 0,
    support_mode: "none",
  };
}

/** Return the validated toy-grade FDM slicer recipe for a catalog or custom part. */
export function slicerRecipeForPart(part: Pick<Part, "id" | "stlFile" | "supportFree">): PartSlicerRecipe {
  const key = part.stlFile ? part.stlFile.replace(/\.stl$/i, "") : part.id;
  const base = fallbackRecipeFor(key);
  const rec = manifestDoc.parts?.[key]?.slicer_recipe ?? manifestDoc.parts?.[part.id]?.slicer_recipe;
  const supportFallback: SupportMode =
    part.supportFree === false ? "tree_slim" : "none";
  if (!rec) {
    return { ...base, support_mode: supportFallback };
  }
  return {
    layer_height_mm: rec.layer_height_mm ?? base.layer_height_mm,
    wall_loops: rec.wall_loops ?? base.wall_loops,
    outer_wall_speed_mms: rec.outer_wall_speed_mms ?? base.outer_wall_speed_mms,
    wall_order: rec.wall_order ?? base.wall_order,
    seam_position: rec.seam_position ?? base.seam_position,
    ironing: rec.ironing ?? base.ironing,
    ironing_inset_mm: rec.ironing_inset_mm ?? base.ironing_inset_mm,
    brim_width_mm: rec.brim_width_mm ?? base.brim_width_mm,
    support_mode: rec.support_mode ?? supportFallback,
    parent_tip: rec.parent_tip,
  };
}

/** Concise one-line badge for buttons and summary pills (e.g. "0.12 mm PLA · smooth PEI"). */
export function formatShortPrintTag(part: Pick<Part, "id" | "stlFile" | "supportFree">): string {
  const r = slicerRecipeForPart(part);
  const lh = r.layer_height_mm.toFixed(2).replace(/0$/, "");
  return `${lh} mm PLA · smooth PEI`;
}

/** Detailed toy-grade finish summary surfaced in PrintDrawer before STL download. */
export function formatToyFinishRecipe(part: Pick<Part, "id" | "stlFile" | "orientation" | "supportFree">): {
  headline: string;
  checklist: string;
} {
  const r = slicerRecipeForPart(part);
  const lh = r.layer_height_mm.toFixed(2).replace(/0$/, "");
  const wallOrderLabel = r.wall_order === "outer_first" ? "outer-first" : "inner-first";
  const seamLabel = r.seam_position === "back" ? "rear seam" : "corner seam";
  const supportLabel =
    r.support_mode === "none"
      ? "support-free"
      : r.support_mode === "soluble_interface"
        ? "soluble supports (keep off show faces)"
        : "slim tree supports (keep off show faces)";
  const extras: string[] = [];
  if (r.ironing === "all_top") extras.push("iron flat tops");
  if (r.brim_width_mm > 0) extras.push(`${r.brim_width_mm} mm brim`);
  extras.push(supportLabel);

  const headline = [
    `${lh} mm PLA`,
    `${part.orientation ?? "flat"} on smooth PEI`,
    `${r.wall_loops} walls @ ${r.outer_wall_speed_mms} mm/s (${wallOrderLabel})`,
    seamLabel,
    ...extras,
  ].join(" · ");

  const checklist =
    r.parent_tip ??
    "Best show face on smooth PEI or vertical · dry PLA + calibrated flow (prevents surface blemishes)";

  return { headline, checklist };
}
