// Scanned (or seeded) toy shape. The seed toys in seed/toys/ use this exact
// shape so the demo's backup path exercises the same code as a live scan.
import type { SizeClass } from "./part";
import type { SamMaskSummary } from "./sam";

export type ToyKind = "car" | "figure" | "other";

/** Where a toy came from. "manual" = a human photographed and sized it
 *  without a model mask. Never relabel manual or seed toys as scans. */
export type ToySource = "scan" | "manual" | "seed";

export interface AttachPoint {
  id: string;
  label: string;
  /** Optional photo-space placement hint (0..1), present when SAM's mask
   *  supplied a real anchor. Existing seed/manual attach points omit it. */
  x?: number;
  y?: number;
}

export interface Toy {
  id: string;
  name: string;
  kind: ToyKind;
  sizeClass: SizeClass;
  /** Overall size from the scan mask (or human measurement), mm. Attach-part
   *  fit is judged against these, so a bad mask shows up as parts not fitting. */
  lengthMm: number;
  widthMm: number;
  attachPoints: AttachPoint[];
  source: ToySource;
  /** Downscaled photo of the toy, when one was taken. Display only. */
  imageDataUrl?: string;
  /** SAM outline as fractions of the photo (0..1). Present only when a
   *  model actually outlined this toy; used to place AR try-ons. */
  outline?: { x1: number; y1: number; x2: number; y2: number };
  /** Compact mask facts from a decoded SAM raster. Absent on the
   *  box-only fallback, manual toys, and seed toys. */
  mask?: SamMaskSummary;
}

/** Toys up to this length take "small" parts; past it they take "large".
 *  A target to revisit once Snap parts exist in hand, not a measurement. */
export const SMALL_MAX_LENGTH_MM = 120;

export function sizeClassForLength(lengthMm: number): SizeClass {
  return lengthMm <= SMALL_MAX_LENGTH_MM ? "small" : "large";
}

/** Built-in starter toys ship with the app; uploads are toys a family saved. */
export function isBuiltInToy(toy: Toy): boolean {
  return toy.source === "seed";
}

/** Catalog shown when the Toybox opens: saved toys first, then built-ins.
 *  Dedupe by id and keep the saved copy when an older build persisted a seed. */
export function mergeToyboxToys(savedToys: Toy[], builtInToys: Toy[]): Toy[] {
  const byId = new Map<string, Toy>();
  for (const toy of [...savedToys, ...builtInToys]) {
    if (!byId.has(toy.id)) byId.set(toy.id, toy);
  }
  return [...byId.values()];
}

/** Toys to persist and label as previous uploads. Built-ins are bundled, so
 *  they do not need another copy in local storage. */
export function toyboxUploads(toys: Toy[]): Toy[] {
  return toys.filter((toy) => !isBuiltInToy(toy));
}

export function attachPointsForKind(kind: ToyKind): AttachPoint[] {
  switch (kind) {
    case "car":
      return [
        { id: "roof", label: "Roof" },
        { id: "rear", label: "Rear deck" },
      ];
    case "figure":
      return [
        { id: "head", label: "Head" },
        { id: "back", label: "Back" },
      ];
    default:
      return [{ id: "top", label: "Top" }];
  }
}

export interface ScanInput {
  id: string;
  name: string;
  kind: ToyKind;
  lengthMm: number;
  widthMm: number;
  source: Extract<ToySource, "scan" | "manual">;
  imageDataUrl?: string;
  outline?: Toy["outline"];
  mask?: SamMaskSummary;
}

/** Build a Toy from scan/manual input, deriving size class and attach
 *  points so every entry path (SAM, manual sliders) agrees on them. */
export function toyFromScanInput(input: ScanInput): Toy {
  const attachPoints = attachPointsForKind(input.kind).map((point, index) =>
    input.mask && index === 0
      ? { ...point, x: input.mask.topAnchor.x, y: input.mask.topAnchor.y }
      : point,
  );
  return {
    id: input.id,
    name: input.name,
    kind: input.kind,
    sizeClass: sizeClassForLength(input.lengthMm),
    lengthMm: input.lengthMm,
    widthMm: input.widthMm,
    attachPoints,
    source: input.source,
    ...(input.imageDataUrl ? { imageDataUrl: input.imageDataUrl } : {}),
    ...(input.outline ? { outline: input.outline } : {}),
    ...(input.mask ? { mask: input.mask } : {}),
  };
}

const KINDS: ToyKind[] = ["car", "figure", "other"];
const SOURCES: ToySource[] = ["scan", "manual", "seed"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isFraction(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
}

function isNormalizedPoint(v: unknown): boolean {
  return isRecord(v) && isFraction(v.x) && isFraction(v.y);
}

function isNormalizedOutline(v: unknown): boolean {
  return (
    isRecord(v) &&
    isFraction(v.x1) && isFraction(v.y1) &&
    isFraction(v.x2) && isFraction(v.y2) &&
    v.x2 > v.x1 && v.y2 > v.y1
  );
}

function isValidMask(v: unknown): boolean {
  if (!isRecord(v)) return false;
  const silhouetteOk =
    v.silhouette === undefined ||
    (isRecord(v.silhouette) &&
      typeof v.silhouette.path === "string" &&
      v.silhouette.path.length > 0 &&
      v.silhouette.path.length <= 8_000 &&
      Number.isInteger(v.silhouette.width) &&
      Number(v.silhouette.width) > 0 && Number(v.silhouette.width) <= 48 &&
      Number.isInteger(v.silhouette.height) &&
      Number(v.silhouette.height) > 0 && Number(v.silhouette.height) <= 36);
  return (
    isFraction(v.coverage) &&
    isNormalizedOutline(v.outline) &&
    typeof v.pixelWidth === "number" && v.pixelWidth > 0 &&
    typeof v.pixelHeight === "number" && v.pixelHeight > 0 &&
    isNormalizedPoint(v.centroid) &&
    isNormalizedPoint(v.topAnchor) &&
    isNormalizedPoint(v.widestAnchor) &&
    silhouetteOk
  );
}

/** Returns human-readable errors; empty array means the toy is valid. */
export function validateToy(value: unknown): string[] {
  const errors: string[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return ["toy is not an object"];
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || !v.id) errors.push("id must be a non-empty string");
  if (typeof v.name !== "string" || !v.name) errors.push("name must be a non-empty string");
  if (!KINDS.includes(v.kind as ToyKind)) errors.push(`kind must be one of ${KINDS.join(", ")}`);
  if (v.sizeClass !== "small" && v.sizeClass !== "large")
    errors.push("sizeClass must be small or large");
  if (typeof v.lengthMm !== "number" || !(v.lengthMm > 0)) errors.push("lengthMm must be > 0");
  if (typeof v.widthMm !== "number" || !(v.widthMm > 0)) errors.push("widthMm must be > 0");
  if (!Array.isArray(v.attachPoints) || v.attachPoints.length === 0) {
    errors.push("attachPoints must be a non-empty array");
  } else if (
    v.attachPoints.some(
      (p) =>
        isRecord(p) &&
        (p.x !== undefined || p.y !== undefined) &&
        !(isFraction(p.x) && isFraction(p.y)),
    )
  ) {
    errors.push("attachPoint x/y hints must both be fractions in 0..1");
  }
  if (!SOURCES.includes(v.source as ToySource))
    errors.push(`source must be one of ${SOURCES.join(", ")}`);
  if (v.outline !== undefined && !isNormalizedOutline(v.outline))
    errors.push("outline must be {x1,y1,x2,y2} fractions in 0..1");
  if (v.mask !== undefined && !isValidMask(v.mask))
    errors.push("mask must be a normalized SAM mask summary");
  return errors;
}
