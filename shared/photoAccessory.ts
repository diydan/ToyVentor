/**
 * The print step for a photo-shaped accessory (docs/specs/forge-ai-spec.md, "F2b", step 4; question 31, option a).
 *
 * The scan has already given the device an outline (`scanOutlineOf`). At the print step, behind the grown-up gate, the device
 * runs this one function: it applies the kid's flip and resize, fits the outline to the real gates, and hands back what the
 * rest of the product needs.
 *
 *   outline  ->  fitPolygon (gate calls, retry, rescale out of the marginal band)
 *            ->  the recipe that passed        (a hand part, `profile2d`; compile it, bridge it, print it)
 *            ->  the sticker decal             (for `planStickerSheet` / `buildStickerPackFiles`; the photo is the device's)
 *            ->  the gate job's plate file     (`fetchPlateStl` fetches the STL to print)
 *
 * Nothing here touches the network, the DOM or a photo. The gate is injected (`forgeRouteGate` in production), so the same
 * function runs against the real Worker routes and a stand-in. It never says "passes" for a part the gate did not pass, and a
 * gate that could not run (a refused call, a limit, a job that failed) is a failure with the typed error, not a made-up verdict.
 *
 * Every failure leaves the caller its fallback: the digital-only accessory (`kip-forge-sdk.js`, `prints: false`) needs no gate.
 */

import { checkForgeRecipeBrandSafety, type ForgeRecipeV1 } from "./forgeOptimizer";
import { type DaemonSymmetry, fitPolygon, type FitAttempt, type FitFailure, type FitOptions, type GateArtifacts, type OutlineGate } from "./outlineFit";
import { OutlineGateError } from "./outlineGate";
import type { ScanOutline } from "./outlineScan";
import { photoStickerItem, type PhotoStickerItem } from "./outlineSticker";
import { symmetrizeOutline, type SymmetryReport } from "./outlineSymmetry";
import { outlineToRecipeShape, withFlipped, withScaled, type OutlineFailure, type OutlineSuccess } from "./photoOutline";

export interface PhotoAccessoryOptions extends FitOptions {
  /** The kid's flip button: swap which end is the handle. Applied before the fit. */
  flip?: boolean;
  /** The kid's resize, as a factor on the outline. The 90 mm box may cap it; `appliedScale` in the result says what was used. */
  scale?: number;
  /**
   * The kid's "make it symmetrical" button. `mirror` straightens the outline's axis and makes both sides identical whenever that can be done
   * without losing a thin part (a scan has already done it by itself if the object was clearly symmetric; asking again is harmless).
   * Applied first, before the flip and the resize, both of which keep it.
   */
  symmetry?: "mirror";
  /** The part's name, shown in the game and checked against the brand list. Default "Photo accessory", at most 80 characters. */
  name?: string;
  /** The sticker's id, label and background colour, as `photoStickerItem` takes them. */
  sticker?: { id?: string; label?: string; bgHex?: string };
}

export interface PhotoAccessory {
  ok: true;
  /** The recipe that passed the gates, for the compiler and the bridge into the game. */
  recipe: ForgeRecipeV1;
  /** The outline that passed: the final shape and size, and the change log (what the legalizers and the loop did). */
  outline: OutlineSuccess;
  attempts: FitAttempt[];
  /** The sticker, and the decal that puts it on a sheet: `buildStickerPackFiles([accessory.decal], state, sources)`. */
  sticker: PhotoStickerItem;
  decal: { kind: "photo_accessory"; item: PhotoStickerItem };
  /** The plate the passing job left, or null when the gate reported none (a stand-in gate): then compile the recipe again. */
  artifacts: GateArtifacts | null;
  /** The factor the resize really used after the box capped it; undefined when no resize was asked for. */
  appliedScale?: number;
  /** What the symmetry button found; set only when `symmetry: "mirror"` was asked for. */
  symmetry?: SymmetryReport;
  /**
   * Set when the daemon's own symmetry step rebuilt the outline before it built the plate (it keeps one half about the bounding-box centre and
   * mirrors it). The plate then differs from `outline` and from the sticker, more the lower `iouBefore` (the outline's own overlap with its
   * mirror image) was. `outline.warnings` has `GATE_REWROTE_OUTLINE`. An outline this module already made exactly symmetric is left alone.
   */
  gateRewrite?: DaemonSymmetry;
}

export type PhotoAccessoryFailure =
  /** The scan had no outline, or it could not be read. */
  | { ok: false; reason: "no_outline"; detail: string; outlineFailure?: OutlineFailure }
  /** The name is not allowed. Nothing was gated. */
  | { ok: false; reason: "brand_rejected" | "invalid_options"; detail: string }
  /** `symmetry: "mirror"` was asked for and the outline cannot be made symmetric (a lump, a fork, a thin part that would go). Nothing was gated. */
  | { ok: false; reason: "cannot_symmetrize"; detail: string; symmetry: SymmetryReport }
  /** The gate could not run: a limit, no grown-up proof, the optimizer off or down. Ask again later; `error.kind` says which. */
  | { ok: false; reason: "gate_error"; detail: string; error: OutlineGateError }
  /** The gate ran and the outline did not pass inside the budget. */
  | { ok: false; reason: FitFailure["reason"]; detail: string; attempts: FitAttempt[]; outline?: OutlineSuccess };

export type PhotoAccessoryResult = PhotoAccessory | PhotoAccessoryFailure;

const DEFAULT_NAME = "Photo accessory";
const MAX_NAME = 80;

/**
 * Fit a scanned outline to the gates and gather what printing needs. `scan` is what `scanOutlineOf` returned (undefined when
 * the reply had no readable outline).
 */
export async function preparePhotoAccessory(
  scan: ScanOutline | undefined,
  gate: OutlineGate,
  options: PhotoAccessoryOptions = {},
): Promise<PhotoAccessoryResult> {
  if (!scan) return { ok: false, reason: "no_outline", detail: "the scan came back with no outline" };
  if (!scan.ok) return { ok: false, reason: "no_outline", detail: scan.detail, outlineFailure: scan };

  const name = options.name === undefined ? DEFAULT_NAME : options.name.trim();
  if (!name || name.length > MAX_NAME) return { ok: false, reason: "invalid_options", detail: `the name must be 1 to ${MAX_NAME} characters` };
  if (options.scale !== undefined && !(Number.isFinite(options.scale) && options.scale > 0)) return { ok: false, reason: "invalid_options", detail: "the resize factor must be a positive number" };
  const recipeBase = { name, slot: "hand" } as const;
  const brand = checkForgeRecipeBrandSafety({ ...recipeBase, shape: { slices: [] } });
  if (brand) return { ok: false, reason: "brand_rejected", detail: brand };

  let start: OutlineSuccess = scan;
  let symmetry: SymmetryReport | undefined;
  if (options.symmetry === "mirror") {
    const made = symmetrizeOutline(start, { mode: "mirror" });
    symmetry = made.report;
    if (!made.report.applied && !made.report.symmetric) {
      return { ok: false, reason: "cannot_symmetrize", detail: `the outline cannot be made symmetric: ${made.report.reason}`, symmetry: made.report };
    }
    start = made.outline;
  }
  let appliedScale: number | undefined;
  if (options.scale !== undefined) {
    const scaled = withScaled(start, options.scale);
    start = scaled.outline;
    appliedScale = scaled.factor;
  }
  if (options.flip) start = withFlipped(start);

  const fitOptions: FitOptions = {
    ...(options.maxGateCalls === undefined ? {} : { maxGateCalls: options.maxGateCalls }),
    ...(options.gripTu === undefined ? {} : { gripTu: options.gripTu }),
    ...(options.band === undefined ? {} : { band: options.band }),
  };

  let fit;
  try {
    fit = await fitPolygon(start, gate, fitOptions);
  } catch (err) {
    if (err instanceof OutlineGateError) return { ok: false, reason: "gate_error", detail: err.message, error: err };
    throw err;
  }
  if (!fit.ok) return { ok: false, reason: fit.reason, detail: fit.detail, attempts: fit.attempts, ...(fit.outline ? { outline: fit.outline } : {}) };

  // The daemon runs its own symmetry step on every hand outline. If it rebuilt this one, the plate it built is not the outline we hold.
  const note = fit.verdict.daemonSymmetry;
  const gateRewrite = note !== undefined && (note.action === "mirrored_left_half" || note.action === "mirrored_right_half") ? note : undefined;
  const outline: OutlineSuccess = gateRewrite && !fit.outline.warnings.includes("GATE_REWROTE_OUTLINE") ? { ...fit.outline, warnings: [...fit.outline.warnings, "GATE_REWROTE_OUTLINE"] } : fit.outline;

  const sticker = photoStickerItem({ ...outline, photoSize: scan.photoSize }, options.sticker);
  const recipe: ForgeRecipeV1 = { ...recipeBase, shape: outlineToRecipeShape(outline, fitOptions.gripTu) };
  return {
    ok: true,
    recipe,
    outline,
    attempts: fit.attempts,
    sticker,
    decal: { kind: "photo_accessory", item: sticker },
    artifacts: fit.verdict.artifacts ?? null,
    ...(appliedScale === undefined ? {} : { appliedScale }),
    ...(symmetry === undefined ? {} : { symmetry }),
    ...(gateRewrite === undefined ? {} : { gateRewrite }),
  };
}
