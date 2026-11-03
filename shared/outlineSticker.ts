/**
 * Photo sticker for a printed outline (docs/specs/forge-ai-spec.md, "F2b", step 3).
 *
 * The plate prints one colour; the photo goes on as a sticker on the face that lay on the bed. This file turns the
 * outline the compiler gets into the sticker's cut path and says where the photo sits on it. Pure geometry, no pixels:
 * the device draws the artwork from the local photo (it never goes back to the server) and the cut file is built by
 * the sticker sheet module (`kip-print-stickers.js`, 8.1 C), so this returns the item shape that module plans with.
 *
 * Two facts about the real builder decide what the cut path is (measured 2026-11-02 on 14 outlines against the built
 * plate, parts/kip/sdk/kip_partspec_sdk.py `polygon_2d` and `handheld_prop`):
 *
 *   - The builder rounds the polygon again. Simplifying the traced outline leaves sharp convex corners, and the builder's
 *     erode-then-dilate takes their tips off: with the raw polygon as the cut path the sticker overhung the plate by up to
 *     0.28 mm on regular shapes and 0.85 mm on rough outlines. So the cut path is the polygon with the same rounding
 *     applied (`roundedPlateOutline`). Concave corners are left alone, as the builder leaves them.
 *   - The plate is the outline plus a 6.4 mm neck (2.5 mm below the polygon's bottom, up to 35% of its height), so a thin
 *     handle shows bare plate beside the sticker. That is cosmetic: the sticker never has plate missing behind it.
 *
 * The face: `-Y` is the front in the part frame and the bed face is `y = -2.5`, so the sticker is seen from the front, on
 * the bed face, with x to the right and z up. Nothing is mirrored.
 */

import { applyAffine, composeAffine, GRIP_ROUNDING_MM, invertAffine, type Affine, type OutlineSuccess } from "./photoOutline";

type Pt = readonly [number, number];

/** Turns smaller than this (radians) are kept as vertices: they are straight for the builder's rounding. */
const STRAIGHT_RAD = (1 * Math.PI) / 180;
/**
 * A corner whose arc would start less than this far from the vertex is left as a vertex. The arc would move the path by at most 0.012 mm (a
 * 14 degree kink at the 1.6 mm radius) and would double the point count of a dense outline, where almost every corner is a gentle one.
 */
const MIN_TANGENT_MM = 0.2;
/** An arc is cut into pieces of at most this turn; the chord sits 0.025 mm inside a 1.6 mm arc at this step. */
const ARC_STEP_RAD = (20 * Math.PI) / 180;

const round3 = (v: number) => Math.round(v * 1000) / 1000;

function signedArea(p: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length]!;
    a += p[i]![0] * q[1] - q[0] * p[i]![1];
  }
  return a / 2;
}

/**
 * Round the convex corners of a polygon the way an erode-then-dilate by `radiusMm` does: each convex vertex becomes the
 * arc of a circle of that radius, tangent to both edges. Concave vertices and straight runs are untouched. Where an edge
 * is too short for the full radius (the arc may use at most half of each neighbouring edge) the radius shrinks for that
 * corner, so a very short edge keeps a little of its sharp corner.
 *
 * Counter-clockwise in and out (a clockwise input is turned round first). Every returned point is on the original
 * outline or on an arc inside it, so the result never extends past the polygon.
 */
export function roundedPlateOutline(points: readonly Pt[], radiusMm: number = GRIP_ROUNDING_MM): [number, number][] {
  const base: readonly Pt[] = signedArea(points) < 0 ? [...points].reverse() : points;
  const n = base.length;
  if (n < 3 || !(radiusMm > 0)) return base.map(([x, z]) => [x, z] as [number, number]);
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const p = base[(i + n - 1) % n]!;
    const v = base[i]!;
    const q = base[(i + 1) % n]!;
    const inLen = Math.hypot(v[0] - p[0], v[1] - p[1]);
    const outLen = Math.hypot(q[0] - v[0], q[1] - v[1]);
    if (inLen < 1e-9 || outLen < 1e-9) {
      out.push([v[0], v[1]]);
      continue;
    }
    const e1: Pt = [(v[0] - p[0]) / inLen, (v[1] - p[1]) / inLen];
    const e2: Pt = [(q[0] - v[0]) / outLen, (q[1] - v[1]) / outLen];
    const turn = Math.atan2(e1[0] * e2[1] - e1[1] * e2[0], e1[0] * e2[0] + e1[1] * e2[1]); // CCW positive: convex on a CCW polygon
    if (turn <= STRAIGHT_RAD || turn >= Math.PI - 1e-3) {
      out.push([v[0], v[1]]);
      continue;
    }
    const tan = Math.tan(turn / 2);
    const tangent = Math.min(radiusMm * tan, 0.5 * inLen, 0.5 * outLen);
    if (tangent < MIN_TANGENT_MM) {
      out.push([v[0], v[1]]);
      continue;
    }
    const r = tangent / tan;
    const start: Pt = [v[0] - e1[0] * tangent, v[1] - e1[1] * tangent];
    const centre: Pt = [start[0] - e1[1] * r, start[1] + e1[0] * r]; // the left of travel is the inside of a CCW polygon
    const a0 = Math.atan2(start[1] - centre[1], start[0] - centre[0]);
    const pieces = Math.max(1, Math.ceil(turn / ARC_STEP_RAD));
    for (let k = 0; k <= pieces; k++) {
      const a = a0 + (turn * k) / pieces;
      out.push([round3(centre[0] + r * Math.cos(a)), round3(centre[1] + r * Math.sin(a))]);
    }
  }
  // Two arcs can end on the same point when an edge was used up; drop the repeat.
  return out.filter((pt, i) => {
    const next = out[(i + 1) % out.length]!;
    return pt[0] !== next[0] || pt[1] !== next[1];
  });
}

/** The sticker-sheet item for a photo accessory: the shape `kip-print-stickers.js` plans with, plus the photo map. */
export interface PhotoStickerItem {
  id: string;
  kind: "photo_accessory";
  label: string;
  /** Bounding box of the cut path, mm. */
  w: number;
  h: number;
  bgHex: string;
  /** Cut path in sticker millimetres: x right, y down, top-left of the bounding box at 0, 0, clockwise on screen (as that module wants). */
  outerPolyMm: [number, number][];
  holePolysMm: [];
  foldLinesMm: [];
  sampler: {
    mode: "photo_outline";
    /**
     * Photo pixel -> sticker millimetre. The pixel is one of the image the outline came from: `photoSize` says how big that is
     * when the outline arrived with a scan (then the map is in uploaded-image pixels), and is null when the outline was made
     * straight from a mask (then the map is in mask pixels and the artwork source must be mask-sized).
     */
    photoToSticker: Affine;
    /** The size of the image `photoToSticker` counts pixels of. The artwork source may be any resolution of it. */
    photoSize: { width: number; height: number } | null;
    /** Sticker millimetre -> mask pixel, for drawing the artwork pixel by pixel; null if the map cannot be inverted. */
    stickerToPhoto: Affine | null;
    /** Plate millimetre of the sticker's top-left corner, so `x = X + plateOriginMm.x` and `z = plateOriginMm.z - Y`. */
    plateOriginMm: { x: number; z: number };
    /** The rounding radius that was applied to get the cut path. */
    roundedByMm: number;
    /**
     * Present when the outline was made symmetric row by row (`OutlineSuccess.rowShift`), in sticker millimetres: [Y, shift] pairs, Y
     * ascending (down the sticker). The artwork at sticker (X, Y) is read from the photo where `stickerToPhoto` puts (X + shift(Y), Y), so
     * the photographed object fills the symmetric cut path instead of leaving a fringe of background. Linear between the pairs, constant
     * beyond the ends. Absent: no slide.
     */
    rowShiftMm?: [number, number][];
  };
}

export interface PhotoStickerOptions {
  id?: string;
  label?: string;
  /** Behind a transparent photo pixel, `#FFFFFF` by default (the sheet module's craft cut-outs use white). */
  bgHex?: string;
}

/**
 * The cut path of the sticker and the map from the photo onto it. The polygon is the outline's own points with the
 * builder's rounding applied; the only other change is the frame (a shift and a vertical flip into sticker millimetres),
 * so the rest of the pipeline can check the path against the recipe.
 */
export function photoStickerItem(outline: OutlineSuccess & { photoSize?: { width: number; height: number } }, options: PhotoStickerOptions = {}): PhotoStickerItem {
  const radius = Math.max(outline.fillet_r_mm, GRIP_ROUNDING_MM);
  const plate = roundedPlateOutline(outline.points, radius);
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const [x, z] of plate) {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    z0 = Math.min(z0, z);
    z1 = Math.max(z1, z);
  }
  let poly = plate.map(([x, z]): [number, number] => [round3(x - x0), round3(z1 - z)]);
  // Counter-clockwise in (x, z) is counter-clockwise on screen here, so reverse to the clockwise the sheet module expects.
  if (signedArea(poly) < 0) poly = poly.reverse();
  const photoToSticker = composeAffine([1, 0, 0, -1, -x0, z1], outline.photoToPlate);
  // The sticker's Y runs down from the top of the cut path (Y = z1 - z) and its X is the plate's x less x0, so a slide along x is the same
  // number of millimetres in both; only the order of the rows turns round.
  const rowShiftMm = outline.rowShift?.map(([z, d]): [number, number] => [round3(z1 - z) + 0, round3(d) + 0]).reverse();
  return {
    id: options.id ?? "photo_accessory",
    kind: "photo_accessory",
    label: options.label ?? "Photo accessory",
    w: round3(x1 - x0),
    h: round3(z1 - z0),
    bgHex: options.bgHex ?? "#FFFFFF",
    outerPolyMm: poly,
    holePolysMm: [],
    foldLinesMm: [],
    sampler: {
      mode: "photo_outline",
      photoToSticker,
      photoSize: outline.photoSize ? { width: outline.photoSize.width, height: outline.photoSize.height } : null,
      stickerToPhoto: invertAffine(photoToSticker) ?? null,
      plateOriginMm: { x: x0, z: z1 },
      roundedByMm: radius,
      ...(rowShiftMm && rowShiftMm.length >= 2 ? { rowShiftMm } : {}),
    },
  };
}

/** Where a mask pixel lands on the sticker, in sticker millimetres. */
export function photoPixelToSticker(item: PhotoStickerItem, px: number, py: number): [number, number] {
  return applyAffine(item.sampler.photoToSticker, px, py);
}
