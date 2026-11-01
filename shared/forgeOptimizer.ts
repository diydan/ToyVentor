/**
 * Shared contract for two-stage dynamic / AI-generated part optimization:
 *   Stage 1 (`preview_ready`): ~20-40 ms warm Web LOD + KHR_mesh_quantization GLB preview
 *   Stage 2 (`print_ready` | `digital_only`): background V1-V10 gate + finish-safe Print STL + slicer_recipe
 */

import type { PartSlicerRecipe } from "../src/lib/printRecipe";

export type ForgeOptimizationStatus =
  | "queued"
  | "preview_ready"
  | "validating"
  | "optimizing"
  | "print_ready"
  | "digital_only"
  | "failed";

export const FORGE_SLOTS = [
  "crown",
  "head",
  "back",
  "hand",
  "front",
  "hood",
  "roof",
  "rollbar",
  "spoiler",
  "exhaust",
] as const;

export type ForgeSlot = (typeof FORGE_SLOTS)[number];

export interface ForgeLoftSlice {
  z: number;
  w: number;
  d: number;
  r: number;
  x?: number;
  y?: number;
}

export interface ForgeRecipeV1 {
  v?: 1;
  id?: string;
  name: string;
  stat?: "Speed" | "Spin" | "Torque" | "Glow";
  behavior?: string;
  slot: ForgeSlot;
  shape:
    | { kind?: "loft"; slices: ForgeLoftSlice[]; height_mm?: number }
    | { kind: "star2d"; points?: number; outer_r_mm?: number; inner_r_mm?: number; grip_tu?: number }
    | { kind: "profile2d"; points: [number, number][]; fillet_r_mm?: number; grip_tu?: number };
  features?: Array<
    | { op: "knob"; radius_mm?: number }
    | { op: "brim"; width_mm?: number; depth_mm?: number; thickness_mm?: number }
  >;
}

export interface ForgeFastPreviewRequest {
  recipe?: ForgeRecipeV1;
  part_id?: string;
  slot?: ForgeSlot;
  stl_base64?: string;
  enqueue_background?: boolean;
  include_glb_base64?: boolean;
}

export interface ForgeFastPreviewResponse {
  ok: boolean;
  status: "preview_ready";
  part_id: string;
  job_id: string | null;
  draft_artifact: string;
  glb_size: number;
  orig_tris: number;
  web_verts: number;
  web_tris: number;
  finish_class: "show_curved" | "precision_gear_pin" | "prismatic_structural";
  elapsed_ms: number;
  glb_base64?: string;
}

export interface ForgeOptimizationJob {
  ok: boolean;
  job_id: string;
  part_id: string;
  status: ForgeOptimizationStatus;
  created_at: number;
  updated_at: number;
  stl_artifact: string | null;
  glb_artifact: string | null;
  content_hash: string | null;
  slicer_recipe: PartSlicerRecipe | null;
  metrics: {
    orig_bytes?: number;
    print_bytes?: number;
    glb_bytes: number;
    orig_tris: number;
    print_tris?: number;
    web_verts: number;
    web_tris: number;
    max_bbox_delta_mm?: number;
    rel_vol_delta_pct?: number;
  } | null;
  gate_report: {
    ok: boolean;
    design_status?: string;
    blocking_failures?: Array<{ id: string; detail?: string }>;
    preprint_failures?: string[];
    brand_errors?: string[];
  } | null;
  error: string | null;
  elapsed_ms: number | null;
}

const FORBIDDEN_BRAND_RE =
  /\b(lego|duplo|technic|bionicle|meccano|playmobil|knex|k'nex|megabloks|mega\s*bloks)\b/i;

export function checkForgeRecipeBrandSafety(recipe: ForgeRecipeV1): string | null {
  for (const [field, val] of [
    ["id", recipe.id ?? ""],
    ["name", recipe.name ?? ""],
    ["behavior", recipe.behavior ?? ""],
  ] as const) {
    const m = FORBIDDEN_BRAND_RE.exec(val);
    if (m) {
      return `Forbidden third-party brand term '${m[0]}' in ${field}`;
    }
  }
  return null;
}
