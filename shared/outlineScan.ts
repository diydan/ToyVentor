/**
 * The photo outline as it crosses the wire (docs/specs/forge-ai-spec.md, "F2b", step 4; question 31, option a).
 *
 * Only the Worker holds the mask raster, and it drops it when the call ends. So when a scan asks for an outline, the
 * Worker runs `legalizeOutline` on the raster it has and sends the polygon back with the scan. The device keeps it and, at
 * the print step behind the grown-up gate, runs `fitPolygon` with `forgeRouteGate` and draws the sticker from its own photo.
 *
 * Three jobs live here, all pure:
 *   - `parseScanOutlineRequest`: the opt-in field on `POST /api/scan`. Without it nothing here runs and a scan is unchanged.
 *   - `scanOutline`: raster in, outline out, with the map from the photo folded in. The raster covers only the object's
 *     bounding box, so `photoToPlate` here maps a pixel of the UPLOADED image (not a mask pixel) to plate millimetres.
 *   - `parseScanOutline`: what the device does with the reply. It rebuilds the outline field by field and refuses anything
 *     the compiler would clamp or the sticker could not use, so a reply that was cut, changed or sent by something else never
 *     reaches the gate or the cut file. Nothing it does not know survives.
 *
 * No photo and no mask crosses the wire: the outline is a polygon of at most 64 points.
 */

import {
  composeAffine,
  HAND_BOX,
  legalizeOutline,
  MAX_RECIPE_POINTS,
  type Affine,
  type OutlineChange,
  type OutlineFailure,
  type OutlineMask,
  type OutlineOptions,
  type OutlineOrientation,
  type OutlineStep,
  type OutlineSuccess,
} from "./photoOutline";

/** The smallest and largest outline height a caller may ask for, mm (the clamp box is 90 tall). */
export const SCAN_OUTLINE_HEIGHT_MM = { min: 8, max: HAND_BOX.maxHeightMm } as const;
/**
 * A mask bigger than this is refused. The client sends photos at 512 px on the long edge, so the mask is at most about
 * 0.26 MP; this leaves room for a full-size upload and keeps one request's CPU bounded (the legalizer took 0.5 to 0.9 s on a
 * real 0.18 MP mask and on the same mask enlarged to 2.9 MP, measured 2026-11-02).
 */
export const SCAN_OUTLINE_MAX_PIXELS = 4_000_000;

/** What a scan may ask for. Everything is optional; the legalizer's own defaults apply to what is left out. */
export interface ScanOutlineRequest {
  /** Height of the outline in mm, 8 to 90. Default 54 (the legalizer's). */
  targetHeightMm?: number;
  /** `long-axis-up` (default) or `as-photographed`. */
  orient?: "long-axis-up" | "as-photographed";
  /** Swap which end is the handle. */
  flip?: boolean;
}

/** An outline that came back with a scan: the legalizer's result, plus the size of the photo the pixels belong to. */
export type ScanOutlineSuccess = OutlineSuccess & { photoSize: { width: number; height: number } };
export type ScanOutline = ScanOutlineSuccess | OutlineFailure;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The opt-in field on a scan. Unknown keys are dropped; a wrong type or a height outside 8 to 90 refuses the whole request. */
export function parseScanOutlineRequest(raw: unknown): { ok: true; request: ScanOutlineRequest } | { ok: false } {
  if (!isRecord(raw)) return { ok: false };
  const request: ScanOutlineRequest = {};
  if (raw.targetHeightMm !== undefined) {
    if (!isNum(raw.targetHeightMm) || raw.targetHeightMm < SCAN_OUTLINE_HEIGHT_MM.min || raw.targetHeightMm > SCAN_OUTLINE_HEIGHT_MM.max) return { ok: false };
    request.targetHeightMm = raw.targetHeightMm;
  }
  if (raw.orient !== undefined) {
    if (raw.orient !== "long-axis-up" && raw.orient !== "as-photographed") return { ok: false };
    request.orient = raw.orient;
  }
  if (raw.flip !== undefined) {
    if (typeof raw.flip !== "boolean") return { ok: false };
    request.flip = raw.flip;
  }
  return { ok: true, request };
}

/**
 * Legalize the decoded mask of one object and place the photo on the result.
 *
 * `bounds` is where the raster sits in the uploaded image (its top-left pixel is `left, top` there), and `photo` is the
 * uploaded image's size. Thin parts are kept: the outline grows (inside the 90 mm box) until they survive, because the
 * fit loop's rescales only ever grow first and a shrunk outline loses its thinnest part.
 */
export function scanOutline(
  raster: OutlineMask,
  bounds: { left: number; top: number },
  photo: { width: number; height: number },
  request: ScanOutlineRequest = {},
): ScanOutline {
  const pixels = raster.width * raster.height;
  if (pixels > SCAN_OUTLINE_MAX_PIXELS) {
    return { ok: false, reason: "bad_mask", detail: `the mask is ${raster.width} x ${raster.height}, over the ${SCAN_OUTLINE_MAX_PIXELS} pixel limit` };
  }
  const options: OutlineOptions = {
    keepThinParts: true,
    ...(request.targetHeightMm === undefined ? {} : { targetHeightMm: request.targetHeightMm }),
    ...(request.orient === undefined ? {} : { orient: request.orient }),
    ...(request.flip === undefined ? {} : { flip: request.flip }),
  };
  const out = legalizeOutline(raster, options);
  if (!out.ok) return out;
  // Mask pixel = photo pixel minus the raster's corner; the corner is a whole pixel, so this shift is exact.
  const photoToPlate = composeAffine(out.photoToPlate, [1, 0, 0, 1, -bounds.left, -bounds.top]);
  return { ...out, photoToPlate, photoSize: { width: photo.width, height: photo.height } };
}

// ---- the reply, as the device reads it ----------------------------------------------------------------------------

const FAILURE_REASONS = new Set<OutlineFailure["reason"]>(["bad_mask", "empty_mask", "too_thin", "not_simple"]);
const ORIENT_REASONS = new Set<OutlineOrientation["reason"]>(["too-round", "as-photographed", "near-upright", "narrow-end-down", "tie"]);
const STEPS = new Set<OutlineStep>(["C1", "C2", "C3", "C4"]);
const MAX_CHANGES = 40;
const MAX_WARNINGS = 20;
const MAX_TEXT = 300;
/** Slack on the clamp box, mm: the legalizer rounds to 0.001 and the compiler clamps anyway. */
const EDGE_EPS_MM = 0.01;
/** The recipe fillet's range (the compiler's, and the legalizer clamps to it). */
const FILLET_RANGE_MM = { min: 0.4, max: 4 } as const;

const text = (v: unknown): v is string => typeof v === "string" && v.length <= MAX_TEXT;

function parseAffine(v: unknown): Affine | undefined {
  if (!Array.isArray(v) || v.length !== 6 || !v.every(isNum)) return undefined;
  return [v[0], v[1], v[2], v[3], v[4], v[5]] as unknown as Affine;
}

function parseChanges(v: unknown): OutlineChange[] | undefined {
  if (!Array.isArray(v) || v.length > MAX_CHANGES) return undefined;
  const out: OutlineChange[] = [];
  for (const c of v) {
    if (!isRecord(c) || !STEPS.has(c.step as OutlineStep) || !text(c.code) || !text(c.detail)) return undefined;
    if (c.value !== undefined && !isNum(c.value)) return undefined;
    out.push({ step: c.step as OutlineStep, code: c.code, detail: c.detail, ...(c.value === undefined ? {} : { value: c.value as number }) });
  }
  return out;
}

/**
 * Read an outline the Worker sent. Returns a rebuilt object, or undefined when anything is wrong: the caller then has no
 * outline and falls back to the digital-only accessory. Never throws.
 */
export function parseScanOutline(raw: unknown): ScanOutline | undefined {
  if (!isRecord(raw)) return undefined;
  if (raw.ok === false) {
    if (!FAILURE_REASONS.has(raw.reason as OutlineFailure["reason"]) || !text(raw.detail)) return undefined;
    return { ok: false, reason: raw.reason as OutlineFailure["reason"], detail: raw.detail };
  }
  if (raw.ok !== true) return undefined;

  if (!Array.isArray(raw.points) || raw.points.length < 3 || raw.points.length > MAX_RECIPE_POINTS) return undefined;
  const points: [number, number][] = [];
  for (const p of raw.points) {
    if (!Array.isArray(p) || p.length !== 2 || !isNum(p[0]) || !isNum(p[1])) return undefined;
    if (Math.abs(p[0]) > HAND_BOX.halfWidthMm + EDGE_EPS_MM || p[1] < -HAND_BOX.halfWidthMm - EDGE_EPS_MM || p[1] > HAND_BOX.maxHeightMm + EDGE_EPS_MM) return undefined;
    points.push([p[0], p[1]]);
  }
  const fillet = raw.fillet_r_mm;
  if (!isNum(fillet) || fillet < FILLET_RANGE_MM.min || fillet > FILLET_RANGE_MM.max) return undefined;
  if (!isNum(raw.widthMm) || raw.widthMm <= 0 || raw.widthMm > 2 * HAND_BOX.halfWidthMm + EDGE_EPS_MM) return undefined;
  if (!isNum(raw.heightMm) || raw.heightMm <= 0 || raw.heightMm > HAND_BOX.maxHeightMm + EDGE_EPS_MM) return undefined;
  if (!isNum(raw.fidelity) || raw.fidelity < 0 || raw.fidelity > 1) return undefined;

  const o = raw.orientation;
  if (!isRecord(o) || !isNum(o.rotationDeg) || typeof o.flipped !== "boolean" || !ORIENT_REASONS.has(o.reason as OutlineOrientation["reason"])) return undefined;

  const changes = parseChanges(raw.changes);
  if (!changes) return undefined;
  if (!Array.isArray(raw.warnings) || raw.warnings.length > MAX_WARNINGS || !raw.warnings.every(text)) return undefined;
  const photoToPlate = parseAffine(raw.photoToPlate);
  if (!photoToPlate) return undefined;
  const size = raw.photoSize;
  if (!isRecord(size) || !Number.isInteger(size.width) || !Number.isInteger(size.height) || (size.width as number) <= 0 || (size.height as number) <= 0) return undefined;

  return {
    ok: true,
    points,
    fillet_r_mm: fillet,
    widthMm: raw.widthMm,
    heightMm: raw.heightMm,
    orientation: { rotationDeg: o.rotationDeg, flipped: o.flipped, reason: o.reason as OutlineOrientation["reason"] },
    changes,
    warnings: [...(raw.warnings as string[])],
    fidelity: raw.fidelity,
    photoToPlate,
    photoSize: { width: size.width as number, height: size.height as number },
  };
}
