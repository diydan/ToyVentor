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
import { fitPolygon, type FitAttempt, type FitFailure, type FitOptions, type GateArtifacts, type OutlineGate } from "./outlineFit";
import { OutlineGateError } from "./outlineGate";
import type { ScanOutline } from "./outlineScan";
import { photoStickerItem, type PhotoStickerItem } from "./outlineSticker";
import { outlineToRecipeShape, withFlipped, withScaled, type OutlineFailure, type OutlineSuccess } from "./photoOutline";

export interface PhotoAccessoryOptions extends FitOptions {
  /** The kid's flip button: swap which end is the handle. Applied before the fit. */
  flip?: boolean;
  /** The kid's resize, as a factor on the outline. The 90 mm box may cap it; `appliedScale` in the result says what was used. */
  scale?: number;
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
}

export type PhotoAccessoryFailure =
  /** The scan had no outline, or it could not be read. */
  | { ok: false; reason: "no_outline"; detail: string; outlineFailure?: OutlineFailure }
  /** The name is not allowed. Nothing was gated. */
  | { ok: false; reason: "brand_rejected" | "invalid_options"; detail: string }
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

  const sticker = photoStickerItem({ ...fit.outline, photoSize: scan.photoSize }, options.sticker);
  const recipe: ForgeRecipeV1 = { ...recipeBase, shape: outlineToRecipeShape(fit.outline, fitOptions.gripTu) };
  return {
    ok: true,
    recipe,
    outline: fit.outline,
    attempts: fit.attempts,
    sticker,
    decal: { kind: "photo_accessory", item: sticker },
    artifacts: fit.verdict.artifacts ?? null,
    ...(appliedScale === undefined ? {} : { appliedScale }),
  };
}
