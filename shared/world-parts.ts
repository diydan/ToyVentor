// Pure bridge between ToyVentor World's 3D slot customizer / Daily Pack
// and the app-lane printable Part catalog (sets/*.json) + Placement[] store.
// Free of React, DOM, and bundler globals so Node/Vitest/scripts can import it.
import {
  boardForToy,
  canPlace,
  findPlacement,
  footprintOf,
  pitchOf,
  snapMm,
  type Board,
  type Placement,
  type Rotation,
} from "./build";
import { allPass, runChecks } from "./checks";
import type { Line, Part, StatName } from "./part";
import type { Toy } from "./toy";
import { toyTypeForKind, type ToyType } from "./toycontract";

export const SLOT_INSTANCE_PREFIX = "slot:";

export type SlotBucket = StatName | "skin";

export type EquipResult =
  | {
      ok: true;
      bucket: SlotBucket;
      placement: Placement;
      placements: Placement[];
      replaced: boolean;
    }
  | {
      ok: false;
      reason: "checks-failed" | "board-full";
    };

/** Map a World customizer slot id to the StatName carried by that slot. */
export function slotStatForWorldSlot(
  toyType: ToyType,
  slotId: string | undefined,
): StatName | undefined {
  if (!slotId) return undefined;
  const s = slotId.trim().toLowerCase();
  if (!s) return undefined;

  if (toyType === "vehicle") {
    if (s === "rear" || s === "spoiler" || s === "wing" || s === "back") return "speed";
    if (s === "wheels" || s === "wheel") return "spin";
    if (s === "front" || s === "bumper" || s === "light" || s === "lights") return "glow";
    if (s === "chassis" || s === "body" || s === "roof" || s === "top") return "torque";
  } else if (toyType === "character") {
    if (s === "back" || s === "pack" || s === "wings" || s === "torso") return "speed";
    if (
      s === "tail" ||
      s === "hat" ||
      s === "crown" ||
      s === "top" ||
      s === "hair" ||
      s === "head" ||
      s === "prop" ||
      s === "hand" ||
      s === "arms" ||
      s === "ears"
    )
      return "spin";
    if (s === "eyes" || s === "face" || s === "visor") return "glow";
    if (
      s === "base" ||
      s === "feet" ||
      s === "legs" ||
      s === "boots" ||
      s === "stance" ||
      s === "body"
    )
      return "torque";
  } else {
    if (s === "legs" || s === "feet" || s === "thrusters") return "speed";
    if (s === "head" || s === "arms") return "spin";
    if (s === "top" || s === "antenna" || s === "eyes") return "glow";
    if (s === "torso" || s === "body" || s === "chest") return "torque";
  }
  return undefined;
}

/**
 * Filter `parts` to printable parts with an `.stl` file that pass all four
 * engineering checks (`allPass(runChecks(part, toy))`) for `toy`, sorted so
 * parts matching the active World customizer slot appear first.
 *
 * Adding a new `sets/*.json` file surfaces matching parts here automatically
 * with zero code changes because `allParts` is passed in directly.
 */
export function printablePartsForWorld(
  toy: Toy,
  parts: readonly Part[],
  options?: {
    slot?: string;
    toyType?: ToyType;
    line?: Line | "all";
  },
): Part[] {
  const lineFilter = options?.line ?? "all";
  const resolvedType = options?.toyType ?? toyTypeForKind(toy.kind);
  const preferredStat = slotStatForWorldSlot(resolvedType, options?.slot);

  return parts
    .filter((part) => {
      if (!part.printable || !part.stlFile) return false;
      if (lineFilter !== "all" && part.line !== lineFilter) return false;
      return allPass(runChecks(part, toy));
    })
    .slice()
    .sort((a, b) => {
      if (preferredStat) {
        const aMatch = a.stat.name === preferredStat ? 0 : 1;
        const bMatch = b.stat.name === preferredStat ? 0 : 1;
        if (aMatch !== bMatch) return aMatch - bMatch;
      }
      if (b.stat.value !== a.stat.value) return b.stat.value - a.stat.value;
      return a.name.localeCompare(b.name);
    });
}

export function slotBucketForPart(part: Part): SlotBucket {
  if (!part.printable && part.skin) return "skin";
  return part.stat.name;
}

export function slotInstanceId(bucket: SlotBucket): string {
  return `${SLOT_INSTANCE_PREFIX}${bucket}`;
}

/**
 * Canonical board anchor per slot bucket on `board`, snapped to the part's own
 * grid pitch and clamped inside the board bounds so each of the 4 stat slots
 * naturally lands in its own quadrant before falling back to `findPlacement`.
 */
export function canonicalSlotAnchor(
  board: Board,
  part: Part,
  rotation: Rotation,
  bucket: SlotBucket,
): { xMm: number; yMm: number } {
  const [w, d] = footprintOf(part, rotation);
  const [px, py] = pitchOf(part, rotation);
  const maxX = Math.max(0, board.lengthMm - w);
  const maxY = Math.max(0, board.widthMm - d);

  const clampSnapped = (target: number, max: number, pitch: number): number => {
    if (max <= 0) return 0;
    if (!(pitch > 0)) return Math.min(max, Math.max(0, Math.round(target)));
    const snapped = snapMm(target, pitch);
    if (snapped <= max) return Math.max(0, snapped);
    return Math.max(0, Math.floor(max / pitch) * pitch);
  };

  switch (bucket) {
    case "speed":
      return { xMm: 0, yMm: 0 };
    case "glow":
      return { xMm: clampSnapped(maxX, maxX, px), yMm: 0 };
    case "torque":
      return { xMm: 0, yMm: clampSnapped(maxY, maxY, py) };
    case "spin":
      return {
        xMm: clampSnapped(maxX, maxX, px),
        yMm: clampSnapped(maxY, maxY, py),
      };
    case "skin":
      return {
        xMm: clampSnapped(maxX / 2, maxX, px),
        yMm: clampSnapped(maxY / 2, maxY, py),
      };
  }
}

/**
 * Equip `part` onto `toy`'s `Placement[]` build using deterministic slot-bucket
 * replacement:
 * - Verifies `allPass(runChecks(part, toy))` first.
 * - Replaces any existing slot-equipped placement in the same `SlotBucket`
 *   (`instanceId === "slot:{bucket}"`) so re-equipping a slot never duplicates.
 * - Synthesizes valid board coordinates `(xMm, yMm, rotation)` from the slot's
 *   canonical quadrant anchor, falling back to `findPlacement` if occupied.
 */
export function equipPartOnBuild(
  toy: Toy,
  part: Part,
  placements: readonly Placement[],
  partsById: Map<string, Part>,
): EquipResult {
  if (!allPass(runChecks(part, toy))) {
    return { ok: false, reason: "checks-failed" };
  }

  const bucket = slotBucketForPart(part);
  const instanceId = slotInstanceId(bucket);
  const existing = placements.find((p) => p.instanceId === instanceId);
  const remaining = placements.filter((p) => p.instanceId !== instanceId);
  const board = boardForToy(toy);

  // ensure `partsById` resolves `part.id` even if caller passed a stale map
  const lookup = partsById.has(part.id)
    ? partsById
    : new Map([...partsById, [part.id, part]]);

  // 1. Reuse previous coordinates in this slot if the new part fits right there.
  if (existing) {
    for (const rot of [existing.rotation, existing.rotation === 0 ? 90 : 0] as Rotation[]) {
      const [px, py] = pitchOf(part, rot);
      const sx = snapMm(existing.xMm, px);
      const sy = snapMm(existing.yMm, py);
      if (canPlace(part, sx, sy, rot, remaining, lookup, board).ok) {
        const placement: Placement = {
          instanceId,
          partId: part.id,
          xMm: sx,
          yMm: sy,
          rotation: rot,
        };
        return {
          ok: true,
          bucket,
          placement,
          placements: [...remaining, placement],
          replaced: true,
        };
      }
    }
  }

  // 2. Try canonical quadrant anchor for this slot bucket across rotations.
  for (const rot of [0, 90] as Rotation[]) {
    const { xMm, yMm } = canonicalSlotAnchor(board, part, rot, bucket);
    if (canPlace(part, xMm, yMm, rot, remaining, lookup, board).ok) {
      const placement: Placement = {
        instanceId,
        partId: part.id,
        xMm,
        yMm,
        rotation: rot,
      };
      return {
        ok: true,
        bucket,
        placement,
        placements: [...remaining, placement],
        replaced: Boolean(existing),
      };
    }
  }

  // 3. Fall back to the first collision-free grid cell on the board.
  const free = findPlacement(part, remaining, lookup, board);
  if (!free) {
    return { ok: false, reason: "board-full" };
  }

  const placement: Placement = {
    instanceId,
    partId: part.id,
    xMm: free.xMm,
    yMm: free.yMm,
    rotation: free.rotation,
  };
  return {
    ok: true,
    bucket,
    placement,
    placements: [...remaining, placement],
    replaced: Boolean(existing),
  };
}

/** Remove all placements of `partId` from `placements`. */
export function unequipPartFromBuild(
  partId: string,
  placements: readonly Placement[],
): Placement[] {
  return placements.filter((p) => p.partId !== partId);
}
