// Offline build-time LLM LOD, Crease & Toy-Finish Recipe Advisor.
//
// Evaluates per-part geometry and surface-finish telemetry against Muse Spark
// (`MODEL_API_KEY` from `.dev.vars` or environment), clamps every returned knob
// inside strict G2/G3 arc-safe and sub-pixel Web-LOD bounds, and caches results
// by `source_sha256` inside `parts/partspec/asset_optimization_manifest.json`.
//
// `npm run bridge` and `npm run build` read the committed manifest with ZERO
// network or LLM calls.
//
// Usage: npm run parts:tune-llm [-- --dry-run] [-- --force] [-- --part <id>] [-- --limit <n>]
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Part, ToySet } from "../shared/part";

export interface SlicerRecipe {
  layer_height_mm: number;
  wall_loops: number;
  outer_wall_speed_mms: number;
  wall_order: "outer_first" | "inner_first";
  seam_position: "aligned" | "back";
  ironing: "all_top" | "none";
  ironing_inset_mm: number;
  brim_width_mm: number;
  support_mode: "none" | "tree_slim" | "soluble_interface";
  parent_tip?: string;
}

export type FinishClass = "show_curved" | "precision_gear_pin" | "prismatic_structural";

export interface ManifestPartEntry {
  source_sha256: string;
  finish_class: FinishClass;
  print_simplify_mm: number;
  web_simplify_mm: number;
  web_crease_deg: number;
  slicer_recipe: SlicerRecipe;
  llm_tuned_at?: string;
  llm_tuned_sha256?: string;
  rationale?: string;
}

export interface OptimizationManifest {
  version: number;
  defaults: Record<string, unknown>;
  parts: Record<string, ManifestPartEntry>;
}

const PRINT_BOUNDS_BY_CLASS: Record<FinishClass, [number, number]> = {
  show_curved: [0.004, 0.008],
  precision_gear_pin: [0.004, 0.008],
  prismatic_structural: [0.010, 0.018],
};

const FORBIDDEN_BRAND_RE =
  /\b(lego|duplo|technic|mega\s*bloks|bionicle|k'nex|knex|playmobil|meccano|hasbro|mattel|bambu|prusa)\b/gi;

export function clampAdvisorProposal(
  entry: ManifestPartEntry,
  raw: Record<string, unknown>,
): Partial<ManifestPartEntry> & { parent_tip?: string } {
  const [pLo, pHi] = PRINT_BOUNDS_BY_CLASS[entry.finish_class] ?? [0.005, 0.018];
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  const out: Partial<ManifestPartEntry> & { parent_tip?: string } = {};
  if (typeof raw.print_simplify_mm === "number" && Number.isFinite(raw.print_simplify_mm)) {
    out.print_simplify_mm = Number(clamp(raw.print_simplify_mm, pLo, pHi).toFixed(4));
  }
  if (typeof raw.web_simplify_mm === "number" && Number.isFinite(raw.web_simplify_mm)) {
    out.web_simplify_mm = Number(clamp(raw.web_simplify_mm, 0.035, 0.16).toFixed(4));
  }
  if (typeof raw.web_crease_deg === "number" && Number.isFinite(raw.web_crease_deg)) {
    out.web_crease_deg = Math.round(clamp(raw.web_crease_deg, 20, 48));
  }
  if (typeof raw.rationale === "string") {
    const clean = raw.rationale.replace(FORBIDDEN_BRAND_RE, "modular").trim().slice(0, 180);
    if (clean) out.rationale = clean;
  }
  if (typeof raw.parent_tip === "string") {
    const clean = raw.parent_tip
      .replace(FORBIDDEN_BRAND_RE, "modular")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
    if (clean) out.parent_tip = clean;
  }
  return out;
}

function readDevVars(root: string): Record<string, string> {
  const p = join(root, ".dev.vars");
  if (!existsSync(p)) return {};
  const vars: Record<string, string> = {};
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    vars[k] = v;
  }
  return vars;
}

function extractOutputText(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const r = raw as Record<string, unknown>;
  if (typeof r.output_text === "string") return r.output_text;
  if (Array.isArray(r.output)) {
    const chunks: string[] = [];
    for (const item of r.output) {
      if (!item || typeof item !== "object") continue;
      const content = (item as Record<string, unknown>).content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c && typeof c === "object" && typeof (c as Record<string, unknown>).text === "string") {
            chunks.push((c as Record<string, unknown>).text as string);
          }
        }
      }
    }
    return chunks.join("\n");
  }
  return "";
}

function firstJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function queryMuseAdvisor(
  apiUrl: string,
  apiKey: string,
  model: string,
  partId: string,
  partMeta: Part | undefined,
  entry: ManifestPartEntry,
): Promise<Record<string, unknown> | null> {
  const prompt = [
    "You are an FDM 3D-printing surface-finish and glTF Web-LOD engineering advisor for modular toy parts.",
    "Never name third-party toy or printer brands. Return ONLY a single JSON object with keys:",
    '{"print_simplify_mm": number, "web_simplify_mm": number, "web_crease_deg": number, "parent_tip": string, "rationale": string}',
    "",
    "Rules:",
    "- Curved cosmetic shells (show_curved) must keep print_simplify_mm <= 0.008 mm so 0.12 mm slow outer walls fit smooth G2/G3 arcs.",
    "- Precision gears/pins must keep print_simplify_mm in 0.006..0.012 mm and web_crease_deg in 24..30 deg for crisp teeth.",
    "- Prismatic structural bricks/plates can use print_simplify_mm in 0.014..0.018 mm and web_simplify_mm in 0.08..0.12 mm.",
    "- parent_tip: concise <= 100 char tip covering smooth PEI bed, slow 30 mm/s walls, dry PLA, and seam/ironing.",
    "",
    `Part telemetry: ${JSON.stringify({
      id: partId,
      name: partMeta?.name ?? partId,
      line: partMeta?.line ?? "snap",
      mount: partMeta?.mount ?? "stud",
      bboxMm: partMeta?.bboxMm,
      finish_class: entry.finish_class,
      current_print_simplify_mm: entry.print_simplify_mm,
      current_web_simplify_mm: entry.web_simplify_mm,
      current_web_crease_deg: entry.web_crease_deg,
      slicer_recipe: entry.slicer_recipe,
    })}`,
  ].join("\n");

  const res = await fetch(`${apiUrl.replace(/\/+$/, "")}/responses`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ model, input: prompt }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as unknown;
  return firstJsonObject(extractOutputText(body));
}

async function main(): Promise<void> {
  const root = process.cwd();
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const force = argv.includes("--force");
  const partIdx = argv.indexOf("--part");
  const onlyPart = partIdx >= 0 ? argv[partIdx + 1] : undefined;
  const limitIdx = argv.indexOf("--limit");
  const limit = limitIdx >= 0 ? Math.max(1, Number(argv[limitIdx + 1]) || 10) : 64;

  const manifestPath = join(root, "parts/partspec/asset_optimization_manifest.json");
  if (!existsSync(manifestPath)) {
    console.error(`llm-lod-advisor: ${manifestPath} not found — run \`npm run bridge\` first.`);
    process.exit(1);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as OptimizationManifest;
  const partsById = new Map<string, Part>();
  for (const f of readdirSync(join(root, "sets")).filter((s) => s.endsWith(".json"))) {
    const set = JSON.parse(readFileSync(join(root, "sets", f), "utf8")) as ToySet;
    for (const p of set.parts ?? []) partsById.set(p.id, p);
  }

  const devVars = readDevVars(root);
  const apiKey = process.env.MODEL_API_KEY ?? devVars.MODEL_API_KEY ?? "";
  const apiUrl = process.env.META_MODEL_API_URL ?? devVars.META_MODEL_API_URL ?? "https://api.meta.ai/v1";
  const model = process.env.MUSE_SPARK_MODEL ?? devVars.MUSE_SPARK_MODEL ?? "muse-spark-1.3";

  const targets = Object.entries(manifest.parts)
    .filter(([id, entry]) => {
      if (onlyPart && id !== onlyPart) return false;
      if (!force && entry.llm_tuned_sha256 === entry.source_sha256) return false;
      return true;
    })
    .slice(0, limit);

  if (targets.length === 0) {
    console.log("llm-lod-advisor: all manifest entries already match source_sha256 (0 calls needed).");
    return;
  }

  if (dryRun || !apiKey) {
    console.log(
      `llm-lod-advisor: ${dryRun ? "--dry-run" : "no MODEL_API_KEY"} — ${targets.length} candidate part(s) verified within deterministic bounds.`,
    );
    return;
  }

  let updated = 0;
  const today = new Date().toISOString().slice(0, 10);
  for (const [partId, entry] of targets) {
    try {
      const proposal = await queryMuseAdvisor(
        apiUrl,
        apiKey,
        model,
        partId,
        partsById.get(partId),
        entry,
      );
      if (!proposal) {
        console.warn(`llm-lod-advisor: skipped ${partId} (no structured JSON returned)`);
        continue;
      }
      const clamped = clampAdvisorProposal(entry, proposal);
      if (clamped.print_simplify_mm !== undefined) entry.print_simplify_mm = clamped.print_simplify_mm;
      if (clamped.web_simplify_mm !== undefined) entry.web_simplify_mm = clamped.web_simplify_mm;
      if (clamped.web_crease_deg !== undefined) entry.web_crease_deg = clamped.web_crease_deg;
      if (clamped.rationale) entry.rationale = clamped.rationale;
      if (clamped.parent_tip) entry.slicer_recipe.parent_tip = clamped.parent_tip;
      entry.llm_tuned_at = today;
      entry.llm_tuned_sha256 = entry.source_sha256;
      updated++;
      console.log(
        `llm-lod-advisor: tuned ${partId} (print=${entry.print_simplify_mm}mm, web=${entry.web_simplify_mm}mm, crease=${entry.web_crease_deg}deg)`,
      );
    } catch (err) {
      console.warn(`llm-lod-advisor: error on ${partId}: ${(err as Error).message}`);
    }
  }

  if (updated > 0) {
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
    console.log(`llm-lod-advisor: updated ${updated} part(s) in asset_optimization_manifest.json`);
  }
}

const isMain = process.argv[1]?.endsWith("llm-lod-advisor.ts");
if (isMain) {
  void main();
}
