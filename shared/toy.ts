// Scanned (or seeded) toy shape. The seed toys in seed/toys/ use this exact
// shape so the demo's backup path exercises the same code as a live scan.
import type { SizeClass } from "./part";

export type ToyKind = "car" | "figure" | "other";

/** Where a toy came from. "manual" = a human photographed and sized it
 *  without a model mask. Never relabel manual or seed toys as scans. */
export type ToySource = "scan" | "manual" | "seed";

export interface AttachPoint {
  id: string;
  label: string;
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
}

/** Build a Toy from scan/manual input, deriving size class and attach
 *  points so every entry path (SAM, manual sliders) agrees on them. */
export function toyFromScanInput(input: ScanInput): Toy {
  return {
    id: input.id,
    name: input.name,
    kind: input.kind,
    sizeClass: sizeClassForLength(input.lengthMm),
    lengthMm: input.lengthMm,
    widthMm: input.widthMm,
    attachPoints: attachPointsForKind(input.kind),
    source: input.source,
    ...(input.imageDataUrl ? { imageDataUrl: input.imageDataUrl } : {}),
  };
}

const KINDS: ToyKind[] = ["car", "figure", "other"];
const SOURCES: ToySource[] = ["scan", "manual", "seed"];

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
  if (!Array.isArray(v.attachPoints) || v.attachPoints.length === 0)
    errors.push("attachPoints must be a non-empty array");
  if (!SOURCES.includes(v.source as ToySource))
    errors.push(`source must be one of ${SOURCES.join(", ")}`);
  return errors;
}
