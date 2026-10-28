// Virtual-builder placement logic, pure and renderer-free. The board is
// the toy's top surface in millimetres; placements snap to each part's own
// grid pitch (footprint / grid units), so Snap studs and Pro holes can
// share a board without a common denominator hack.
import type { Part } from "./part";
import type { Toy } from "./toy";

export type Rotation = 0 | 90;

export interface Placement {
  instanceId: string;
  partId: string;
  xMm: number;
  yMm: number;
  rotation: Rotation;
}

export interface Board {
  lengthMm: number;
  widthMm: number;
}

export function boardForToy(toy: Toy): Board {
  return { lengthMm: toy.lengthMm, widthMm: toy.widthMm };
}

/** Footprint after rotation, [along board length, along board width]. */
export function footprintOf(part: Part, rotation: Rotation): [number, number] {
  const [w, d] = part.footprintMm;
  return rotation === 0 ? [w, d] : [d, w];
}

/** Snap pitch per axis after rotation, derived from the part's grid. */
export function pitchOf(part: Part, rotation: Rotation): [number, number] {
  const [w, d] = part.footprintMm;
  const [gu, gv] = part.grid.units;
  return rotation === 0 ? [w / gu, d / gv] : [d / gv, w / gu];
}

export function snapMm(value: number, pitch: number): number {
  if (!(pitch > 0)) return Math.round(value);
  return Math.round(value / pitch) * pitch;
}

interface Rect { x: number; y: number; w: number; d: number }

function rectOf(part: Part, p: { xMm: number; yMm: number; rotation: Rotation }): Rect {
  const [w, d] = footprintOf(part, p.rotation);
  return { x: p.xMm, y: p.yMm, w, d };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.d && b.y < a.y + a.d;
}

export type PlaceCheck =
  | { ok: true }
  | { ok: false; reason: "outside" | "collision" | "unknown-part" };

export function canPlace(
  part: Part,
  xMm: number,
  yMm: number,
  rotation: Rotation,
  placements: Placement[],
  partsById: Map<string, Part>,
  board: Board,
  ignoreInstanceId?: string,
): PlaceCheck {
  const rect = rectOf(part, { xMm, yMm, rotation });
  if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > board.lengthMm || rect.y + rect.d > board.widthMm)
    return { ok: false, reason: "outside" };
  for (const placed of placements) {
    if (placed.instanceId === ignoreInstanceId) continue;
    const other = partsById.get(placed.partId);
    if (!other) return { ok: false, reason: "unknown-part" };
    if (overlaps(rect, rectOf(other, placed))) return { ok: false, reason: "collision" };
  }
  return { ok: true };
}

/** First free position scanning rows then columns at the part's pitch. */
export function findPlacement(
  part: Part,
  placements: Placement[],
  partsById: Map<string, Part>,
  board: Board,
): { xMm: number; yMm: number; rotation: Rotation } | null {
  for (const rotation of [0, 90] as Rotation[]) {
    const [px, py] = pitchOf(part, rotation);
    const [w, d] = footprintOf(part, rotation);
    for (let y = 0; y + d <= board.widthMm; y += py) {
      for (let x = 0; x + w <= board.lengthMm; x += px) {
        if (canPlace(part, x, y, rotation, placements, partsById, board).ok)
          return { xMm: x, yMm: y, rotation };
      }
    }
  }
  return null;
}

export function rotatePlacement(
  placement: Placement,
  placements: Placement[],
  partsById: Map<string, Part>,
  board: Board,
): Placement | null {
  const part = partsById.get(placement.partId);
  if (!part) return null;
  const rotated: Placement = {
    ...placement,
    rotation: placement.rotation === 0 ? 90 : 0,
  };
  return canPlace(part, rotated.xMm, rotated.yMm, rotated.rotation, placements, partsById, board, placement.instanceId).ok
    ? rotated
    : null;
}

export interface BuildStats {
  placements: number;
  printableCount: number;
  statTotals: Partial<Record<Part["stat"]["name"], number>>;
}

export function buildStats(
  placements: Placement[],
  partsById: Map<string, Part>,
): BuildStats {
  const statTotals: BuildStats["statTotals"] = {};
  let printableCount = 0;
  for (const placed of placements) {
    const part = partsById.get(placed.partId);
    if (!part) continue;
    if (part.printable) printableCount++;
    statTotals[part.stat.name] = (statTotals[part.stat.name] ?? 0) + part.stat.value;
  }
  return { placements: placements.length, printableCount, statTotals };
}
