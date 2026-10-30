// Part and set-file shapes. Pure TypeScript: no DOM, no Worker APIs, no
// React. Imported by the app, the Worker, scripts, and tests — this file is
// the contract every set in sets/ is validated against.

export type Line = "snap" | "pro";
export type Mount = "stud" | "hole" | "forge-mount";
export type SizeClass = "small" | "large";
export type StatName = "speed" | "spin" | "torque" | "glow";

export interface Part {
  id: string;
  name: string;
  line: Line;
  mount: Mount;
  sizeClass: SizeClass;
  grid: {
    /** Whole units on the stud (snap) or hole (pro) grid. */
    units: [number, number];
    /** e.g. "stud_profile_small" or "tu_12.5". Behind a setting so the
     *  standard can change without redoing every part. */
    profile: string;
  };
  /** Physical footprint, mm. Used by the fits-toy and fits-bed checks. */
  footprintMm: [number, number];
  /** Exactly one stat: a part that's good at two things becomes the default
   *  pick and the rest of the library stops mattering. */
  stat: { name: StatName; value: number };
  printable: boolean;
  /** Claimed support-free print orientation, e.g. "flat". Non-printable
   *  parts (skins) omit it. */
  orientation?: string;
  supportFree?: boolean;
  /** True 3D mesh bounding box [x, y, z] in mm in print orientation. */
  bboxMm?: [number, number, number];
  /** Generated binary STL filename under public/parts-stl/. */
  stlFile?: string;
  /** Generated GLB filename under public/parts-glb/. */
  glbFile?: string;
  /** True when ASTM F963 / 16 CFR 1500.19 small-parts cylinder warning applies (3+). */
  smallPartWarning?: boolean;
  /** AR/game texture id. Printed parts are one color; skins never print. */
  skin?: string;
}

export interface ToySet {
  id: string;
  name: string;
  parts: Part[];
}

const LINES: Line[] = ["snap", "pro"];
const MOUNTS: Mount[] = ["stud", "hole", "forge-mount"];
const SIZES: SizeClass[] = ["small", "large"];
const STATS: StatName[] = ["speed", "spin", "torque", "glow"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isPair(v: unknown): v is [number, number] {
  return (
    Array.isArray(v) &&
    v.length === 2 &&
    v.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

function isTriple(v: unknown): v is [number, number, number] {
  return (
    Array.isArray(v) &&
    v.length === 3 &&
    v.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

/** Returns human-readable errors; empty array means the part is valid. */
export function validatePart(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ["part is not an object"];
  const id = typeof value.id === "string" && value.id ? value.id : "<missing id>";
  const at = (msg: string) => errors.push(`${id}: ${msg}`);

  if (typeof value.id !== "string" || !value.id) at("id must be a non-empty string");
  if (typeof value.name !== "string" || !value.name) at("name must be a non-empty string");
  if (!LINES.includes(value.line as Line)) at(`line must be one of ${LINES.join(", ")}`);
  if (!MOUNTS.includes(value.mount as Mount)) at(`mount must be one of ${MOUNTS.join(", ")}`);
  if (!SIZES.includes(value.sizeClass as SizeClass)) at(`sizeClass must be one of ${SIZES.join(", ")}`);

  if (!isRecord(value.grid)) {
    at("grid must be an object");
  } else {
    if (!isPair(value.grid.units)) at("grid.units must be [number, number]");
    if (typeof value.grid.profile !== "string" || !value.grid.profile)
      at("grid.profile must be a non-empty string");
  }

  if (!isPair(value.footprintMm)) at("footprintMm must be [number, number]");

  if (Array.isArray(value.stat)) {
    at("stat must be a single object, never a list");
  } else if (!isRecord(value.stat)) {
    at("stat must be an object");
  } else {
    if (!STATS.includes(value.stat.name as StatName)) at(`stat.name must be one of ${STATS.join(", ")}`);
    if (typeof value.stat.value !== "number") at("stat.value must be a number");
  }

  if (typeof value.printable !== "boolean") at("printable must be a boolean");
  if (value.printable === true) {
    if (typeof value.orientation !== "string" || !value.orientation)
      at("printable parts must list a print orientation");
    if (value.supportFree !== true) at("printable parts must claim supportFree: true");
  }
  if (value.bboxMm !== undefined && !isTriple(value.bboxMm))
    at("bboxMm must be [number, number, number]");
  if (value.stlFile !== undefined && (typeof value.stlFile !== "string" || !value.stlFile.endsWith(".stl")))
    at("stlFile must be a .stl filename");
  if (value.glbFile !== undefined && (typeof value.glbFile !== "string" || !value.glbFile.endsWith(".glb")))
    at("glbFile must be a .glb filename");
  if (value.smallPartWarning !== undefined && typeof value.smallPartWarning !== "boolean")
    at("smallPartWarning must be a boolean");
  return errors;
}

/** Returns human-readable errors; empty array means the set is valid. */
export function validateSet(value: unknown): string[] {
  if (!isRecord(value)) return ["set is not an object"];
  const errors: string[] = [];
  if (typeof value.id !== "string" || !value.id) errors.push("set id must be a non-empty string");
  if (typeof value.name !== "string" || !value.name) errors.push("set name must be a non-empty string");
  if (!Array.isArray(value.parts) || value.parts.length === 0) {
    errors.push("set parts must be a non-empty array");
    return errors;
  }
  const seen = new Set<string>();
  for (const part of value.parts) {
    errors.push(...validatePart(part));
    if (isRecord(part) && typeof part.id === "string") {
      if (seen.has(part.id)) errors.push(`duplicate part id: ${part.id}`);
      seen.add(part.id);
    }
  }
  return errors;
}
