/**
 * Photo outline -> hand-prop outline (docs/specs/forge-ai-spec.md, "F2b", Route A).
 *
 * Turns a decoded SAM mask into the one polygon the `hand` slot's `profile2d`
 * shape accepts, and says what it changed. No model, no DOM, no network: a pure
 * function of the mask, so it runs in the Worker and in tests.
 *
 *   C1 one body        keep the largest piece, fill holes (the builder draws ONE outline)
 *   C4 orientation     long axis to z, handle end down (a flip is one option away)
 *   C3 fit             scale into the clamp box; height defaults to DEFAULT_TARGET_MM
 *   C2 minimum feature round the outline the way the builder will (so preview == print)
 *
 * The numbers below mirror what the builder does and must be kept in step with
 * `compile_recipe_to_partspec` and `handheld_prop` (scripts/forge_optimizer_daemon.py,
 * parts/kip/sdk/kip_partspec_sdk.py): profile2d takes 3 to 256 points, x within 45 mm,
 * z from -45 to 90 mm, `fillet_r_mm` 0.4 to 4 (rounds the outline by that radius:
 * shrink, then grow), and `handheld_prop` rounds by a further 0.8 mm. Rounding twice
 * with radii r1 and r2 equals rounding once with the larger, so the smallest feature
 * that survives is 2 x max(fillet, 0.8) mm: 3.2 mm at the default fillet.
 *
 * The outline's bottom sits at z = 0 and x is centred, so the usable box is 90 wide
 * by 90 tall. The builder re-centres x and lifts the bottom onto the grip neck itself.
 */

import type { ForgeRecipeV1 } from "./forgeOptimizer";

/** A decoded mask: row-major, any non-zero value is the object. Same shape `summarizeMaskRaster` takes. */
export interface OutlineMask {
  data: Uint8Array | readonly number[];
  width: number;
  height: number;
}

export type OutlineStep = "C1" | "C2" | "C3" | "C4";

/** One thing the legalizers did, so the eval can count it and the UI can say it ("I filled the holes"). */
export interface OutlineChange {
  step: OutlineStep;
  code: string;
  detail: string;
  /** The number the detail is about (pieces, mm, degrees, share of the mask), when there is one. */
  value?: number;
}

export interface OutlineOptions {
  /** Height the outline is scaled to, in mm. Default 54; capped at the clamp box. */
  targetHeightMm?: number;
  /** Rounding radius written to the recipe, 0.4 to 4 mm. Default 1.6, the first of FILLET_LADDER (the daemon's own default, 1.2, fails the gates on most outlines). */
  fillet_r_mm?: number;
  /** Point budget, 3 to 256 (the compiler's limit). Default 240, leaving room under it. */
  maxPoints?: number;
  /** `long-axis-up` (default) is C4; `as-photographed` leaves the photo's orientation alone. */
  orient?: "long-axis-up" | "as-photographed";
  /** Swap which end is the handle (a half turn). The kid's flip button. */
  flip?: boolean;
  /**
   * Parts narrower than the rounding allows are removed at the requested size. With this on, the outline grows (never past
   * the 90 mm box) to the smallest size at which they survive; if none does, the requested size is used and they are removed.
   */
  keepThinParts?: boolean;
  /**
   * Smooth the outline before it is simplified: the working raster is blurred by this many millimetres (a Gaussian sigma) and the
   * outline is traced as the 0.5 contour of the blur, at sub-pixel precision, instead of along the raster's pixel corners. A mask
   * edge is a staircase (one step per source pixel, plus the mask's own wobble) and the simplifier keeps every step taller than its
   * tolerance, so without this the plate and the sticker's cut line carry notches. Default: 2 source pixels, kept between
   * 0.3 and 0.8 mm; a value given here is kept between 0 and 0.8 (measured 2026-11-02 on a real spoon, a real cup and 20 synthetic masks: 0.4 mm gave the least zig-zag, a disc
   * reached the 360 degrees of turning a circle has, and the overlap with the mask moved by 0.003 at most). `0` turns it off.
   */
  smoothMm?: number;
  /**
   * How far a straight chord of the outline may leave the smoothed edge, in millimetres (the simplifier's tolerance). A smaller one
   * follows the edge more closely with more points, up to the point budget; a larger one uses fewer. Only on a smoothed outline
   * (`smoothMm` above 0). Default 0.03.
   */
  sagMm?: number;
  /**
   * After the blur, the outline is also low-pass filtered along its own length (Taubin smoothing, which does not shrink a shape, so a
   * thin neck keeps its width): ripple shorter than this many millimetres is taken out. The blur leaves a ripple of a few hundredths of
   * a millimetre where the raster's pixels were, and a polygon with many points would follow it, so this is what lets a large point
   * budget pay off. Only on a smoothed outline. Default 10% of the longer side, kept between 3 and 8 mm; `0` turns it off.
   */
  curveMm?: number;
}

export interface OutlineOrientation {
  /** Counter-clockwise rotation applied to the photo, in degrees (x right, z up). */
  rotationDeg: number;
  flipped: boolean;
  reason: "too-round" | "as-photographed" | "near-upright" | "narrow-end-down" | "tie";
}

/** SVG-style affine `[a, b, c, d, e, f]`: x' = a*x + c*y + e, y' = b*x + d*y + f. */
export type Affine = readonly [number, number, number, number, number, number];

export interface OutlineSuccess {
  ok: true;
  /** Counter-clockwise polygon in (x, z) mm, bottom at z = 0, ready for `shape.points`. */
  points: [number, number][];
  fillet_r_mm: number;
  widthMm: number;
  heightMm: number;
  orientation: OutlineOrientation;
  changes: OutlineChange[];
  /** Short codes the caller may turn into a hint: SPLIT_OBJECT, LARGE_HOLES_FILLED, THIN_PARTS_REMOVED, LOW_FIDELITY, POINT_BUDGET_NOT_MET. */
  warnings: string[];
  /** Overlap (intersection over union) of the polygon with the rounded mask it came from, 0 to 1. */
  fidelity: number;
  /**
   * Where the photo sits on the plate: maps a mask pixel index (x right, y down, the top-left pixel's centre is 0, 0) to
   * plate millimetres (x right, z up, the same frame as `points`). The sticker is drawn from the local photo with this,
   * because the photo and mask never come back from the server. A photo larger than the mask: scale the pixel first.
   * `withFlipped` and `withScaled` keep it in step with `points`; `flipOutline` and `scaleOutline` do not touch it.
   */
  photoToPlate: Affine;
}

export interface OutlineFailure {
  ok: false;
  reason: "bad_mask" | "empty_mask" | "too_thin" | "not_simple";
  detail: string;
}

export type OutlineResult = OutlineSuccess | OutlineFailure;

/** The object drawn on a working raster in millimetres and rounded, at one scale. */
interface Built {
  scale: number; // mm per source pixel
  work: Uint8Array;
  nx: number;
  nz: number;
  wpx: number; // mm per working pixel
  originX: number; // mm of the raster's left edge
  originZ: number; // mm of the raster's top edge
  areaBefore: number; // mm2, before rounding
  areaAfter: number; // mm2, after rounding and keeping one body
  thin: { count: number; areaMm2: number };
  split: boolean;
  widthMm: number;
  heightMm: number;
  empty: boolean; // rounding took everything
}

/** Clamp box of `profile2d` (daemon): |x| <= 45, z <= 90 with the bottom at 0. */
export const HAND_BOX = { halfWidthMm: 45, maxHeightMm: 90 } as const;
export const DEFAULT_TARGET_MM = 54;
/**
 * The recipe's `fillet_r_mm`, in the order to try them. Measured 2026-11-02 on 33 legalized outlines (7 standard shapes,
 * 20 random blobs, 6 rough discs) through the real compile and gate path: 1.2 (the daemon's default) passed 8, every
 * failure `G1_watertight` plus `G3_single_body`; 1.6 passed all 33; 2.0 passed 32; 3.0 passed 32. The failures are
 * zero-volume two-triangle slivers beside the main body, not a real split, and they come and go with the radius (a
 * star failed at 0.8, 1.2 and 2.4 and passed at 0.4, 1.6, 2.0, 3.0 and 4.0), so a bigger radius is not safer in
 * general: retry down this list, do not compute a radius. 0.8 and 2.4 are the builder's own grip rounding and crest inset.
 */
export const FILLET_LADDER = [1.6, 2.0, 3.0] as const;
export const DEFAULT_FILLET_MM = FILLET_LADDER[0];

/**
 * What to try, in order, when a hand outline fails the gates with `G1_watertight` plus `G3_single_body`. At 1.6 mm
 * 2 of 110 outlines (33 at 54 mm, 77 across other sizes) failed, and a 2% bigger size passed both with the same shape:
 * the slivers depend on sub-millimetre geometry, so a nudge reshuffles them. The fillets 2.0 and 3.0 also passed, but
 * only by raising the minimum feature to 4 and 6 mm, which removed the paddle's stick: they change the shape, so
 * they come last. At fillet 1.2 the same nudges rescued only 14 of 33, so the nudge backs up 1.6, it does not replace it.
 * A `marginal` small-parts result is a different failure: rescale by the measured cylinder (`scaleOutline`), not this list.
 */
export const RETRY_LADDER = [
  { fillet_r_mm: FILLET_LADDER[0], sizeFactor: 1 },
  { fillet_r_mm: FILLET_LADDER[0], sizeFactor: 1.02 },
  { fillet_r_mm: FILLET_LADDER[0], sizeFactor: 1.04 },
  { fillet_r_mm: FILLET_LADDER[1], sizeFactor: 1 },
  { fillet_r_mm: FILLET_LADDER[2], sizeFactor: 1 },
] as const;

/** Options for attempt `n` (0 = the first try) of the retry ladder, or undefined once it runs out. */
export function retryOptions(base: OutlineOptions, attempt: number): OutlineOptions | undefined {
  const step = RETRY_LADDER[attempt];
  if (!step) return undefined;
  return { ...base, fillet_r_mm: step.fillet_r_mm, targetHeightMm: (base.targetHeightMm ?? DEFAULT_TARGET_MM) * step.sizeFactor };
}
/** `handheld_prop` rounds the plate by this much on top of the recipe's fillet. */
export const GRIP_ROUNDING_MM = 0.8;
export const MAX_RECIPE_POINTS = 256;

const DEFAULT_MAX_POINTS = 240;
const WORK_LONG_PX = 400; // long side of the working raster
const DEFAULT_SAG_MM = 0.03; // how far a straight chord may leave the smoothed edge: the simplifier's tolerance on a smoothed contour
const MIN_EPS_PX = 0.05;
const CURVE_SHARE = 0.1; // wavelength below which the contour's own ripple is filtered out, as a share of the longer side
const CURVE_MIN_MM = 3;
const CURVE_MAX_MM = 8;
const PIXEL_STAIR_EPS_PX = 0.6; // the tolerance for the pixel-corner trace, which has steps of a pixel
const PIXEL_TRACE_POINTS = 60; // and its point budget: the trace is all steps, and only a tight budget prunes them
const SMOOTH_SOURCE_PX = 2; // blur sigma, in source pixels, so a stair step and the mask's own one-pixel wobble are smoothed out
const SMOOTH_MIN_MM = 0.3;
const SMOOTH_MAX_MM = 0.8; // past this a 2 mm neck starts to lose width
const MAX_MASK_PIXELS = 16_000_000;
const ROUND_ELONGATION = 1.15; // below this the long axis means nothing
const UPRIGHT_WITHIN_DEG = 30; // inside this the photo's own "up" is kept
const SPLIT_SHARE = 0.7; // the kept piece holds less than this share of the mask: SPLIT_OBJECT
const LARGE_HOLE_SHARE = 0.1;
const LOW_FIDELITY = 0.9;

type Vec = [number, number];

const clampNum = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round2 = (v: number) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------------------
// Raster helpers
// ---------------------------------------------------------------------------

interface Labels {
  labels: Int32Array; // 0 = not in the set, 1.. = component id
  sizes: number[]; // sizes[id - 1]
}

/** Label connected components of the pixels equal to `want`. `eight` selects 8- or 4-connectivity. */
function label(bin: Uint8Array, w: number, h: number, want: 0 | 1, eight: boolean): Labels {
  const labels = new Int32Array(w * h);
  const sizes: number[] = [];
  const stack = new Int32Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (bin[start] !== want || labels[start] !== 0) continue;
    const id = sizes.length + 1;
    let top = 0;
    let count = 0;
    stack[top++] = start;
    labels[start] = id;
    while (top > 0) {
      const p = stack[--top]!;
      count++;
      const x = p % w;
      const y = (p - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if ((dx === 0 && dy === 0) || (!eight && dx !== 0 && dy !== 0)) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (bin[q] === want && labels[q] === 0) {
            labels[q] = id;
            stack[top++] = q;
          }
        }
      }
    }
    sizes.push(count);
  }
  return { labels, sizes };
}

const countOn = (bin: Uint8Array) => {
  let n = 0;
  for (let i = 0; i < bin.length; i++) n += bin[i]!;
  return n;
};

interface PieceReport {
  pieces: number; // pieces before keeping the largest
  keptShare: number; // of the object pixels
  holes: number;
  holeShare: number; // hole area as a share of the filled object
}

/** C1 on a raster: keep the largest 8-connected piece, then fill every hole. Returns a new raster. */
function oneBody(bin: Uint8Array, w: number, h: number): { bin: Uint8Array; report: PieceReport } {
  const fg = label(bin, w, h, 1, true);
  const total = fg.sizes.reduce((a, b) => a + b, 0);
  let best = 0;
  for (let i = 1; i < fg.sizes.length; i++) if (fg.sizes[i]! > fg.sizes[best]!) best = i;
  const keep = new Uint8Array(w * h);
  for (let i = 0; i < keep.length; i++) keep[i] = fg.labels[i] === best + 1 ? 1 : 0;

  // Holes = background pieces (4-connected) that do not touch the border.
  const bg = label(keep, w, h, 0, false);
  const outside = new Set<number>();
  for (let x = 0; x < w; x++) {
    outside.add(bg.labels[x]!);
    outside.add(bg.labels[(h - 1) * w + x]!);
  }
  for (let y = 0; y < h; y++) {
    outside.add(bg.labels[y * w]!);
    outside.add(bg.labels[y * w + w - 1]!);
  }
  let holes = 0;
  let holePixels = 0;
  for (let id = 1; id <= bg.sizes.length; id++) {
    if (!outside.has(id)) {
      holes++;
      holePixels += bg.sizes[id - 1]!;
    }
  }
  if (holes > 0) for (let i = 0; i < keep.length; i++) if (keep[i] === 0 && !outside.has(bg.labels[i]!)) keep[i] = 1;

  const filled = countOn(keep);
  return {
    bin: keep,
    report: {
      pieces: fg.sizes.length,
      keptShare: total > 0 ? (fg.sizes[best] ?? 0) / total : 0,
      holes,
      holeShare: filled > 0 ? holePixels / filled : 0,
    },
  };
}

const INF = 1e9;

/** Felzenszwalb squared Euclidean distance transform: distance^2 from each pixel to the nearest `target` pixel. */
function distanceSquared(isTarget: Uint8Array, w: number, h: number): Float64Array {
  const out = new Float64Array(w * h);
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const line = (len: number) => {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
      while (s <= z[k]!) {
        k--;
        s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while (z[k + 1]! < q) k++;
      const dq = q - v[k]!;
      d[q] = dq * dq + f[v[k]!]!;
    }
  };
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = isTarget[y * w + x] ? 0 : INF;
    line(h);
    for (let y = 0; y < h; y++) out[y * w + x] = d[y]!;
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = out[y * w + x]!;
    line(w);
    for (let x = 0; x < w; x++) out[y * w + x] = d[x]!;
  }
  return out;
}

/**
 * Which parts did rounding take off that are really parts, not just rounded corners? A piece that came off counts as a
 * thin part when it is long (over 4 radii) and bigger than one radius squared. A rounded 90 degree corner loses about
 * 0.2 r^2 and a sharp star tip (half angle 18 degrees) only reaches 2.2 r along its axis, so neither counts; an antenna
 * or a thin blade does.
 */
function thinParts(before: Uint8Array, after: Uint8Array, w: number, h: number, mmPerPx: number, radiusMm: number): { count: number; areaMm2: number } {
  const removed = new Uint8Array(w * h);
  for (let i = 0; i < removed.length; i++) removed[i] = before[i] === 1 && after[i] === 0 ? 1 : 0;
  const L = label(removed, w, h, 1, true);
  const n = L.sizes.length;
  const x0 = new Array<number>(n).fill(Infinity);
  const x1 = new Array<number>(n).fill(-Infinity);
  const y0 = new Array<number>(n).fill(Infinity);
  const y1 = new Array<number>(n).fill(-Infinity);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const id = L.labels[y * w + x]!;
      if (id === 0) continue;
      const k = id - 1;
      if (x < x0[k]!) x0[k] = x;
      if (x > x1[k]!) x1[k] = x;
      if (y < y0[k]!) y0[k] = y;
      if (y > y1[k]!) y1[k] = y;
    }
  }
  let count = 0;
  let areaMm2 = 0;
  for (let k = 0; k < n; k++) {
    const extent = Math.max(x1[k]! - x0[k]! + 1, y1[k]! - y0[k]! + 1) * mmPerPx;
    const area = L.sizes[k]! * mmPerPx * mmPerPx;
    if (extent > 4 * radiusMm && area > radiusMm * radiusMm) {
      count++;
      areaMm2 += area;
    }
  }
  return { count, areaMm2 };
}

/** Morphological opening with a disc of radius `r` pixels: shrink by r, then grow by r. Removes anything narrower than 2r. */
function open(bin: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const r2 = r * r;
  const bgDist = distanceSquared(invert(bin), w, h); // distance to the nearest background pixel
  const eroded = new Uint8Array(w * h);
  for (let i = 0; i < eroded.length; i++) eroded[i] = bin[i] === 1 && bgDist[i]! >= r2 ? 1 : 0;
  const fgDist = distanceSquared(eroded, w, h); // distance to the nearest surviving pixel
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = fgDist[i]! <= r2 ? 1 : 0;
  return out;
}

function invert(bin: Uint8Array): Uint8Array {
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < out.length; i++) out[i] = bin[i] ? 0 : 1;
  return out;
}

function sample(src: Uint8Array, w: number, h: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const at = (xx: number, yy: number) => (xx < 0 || yy < 0 || xx >= w || yy >= h ? 0 : src[yy * w + xx]!);
  return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
}

// ---------------------------------------------------------------------------
// C4: orientation
// ---------------------------------------------------------------------------

interface Moments {
  cx: number;
  cy: number;
  /** Unit vector of the long axis in (u, v) = (right, up), pointing to the photo's upper half (or right if level). */
  axis: Vec;
  elongation: number;
  /** Mean widths of the two end bands, along +axis and along -axis. */
  widthPlus: number;
  widthMinus: number;
}

function momentsOf(bin: Uint8Array, w: number, h: number): Moments {
  let n = 0;
  let sx = 0;
  let sy = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (bin[y * w + x]) {
        n++;
        sx += x;
        sy += y;
      }
    }
  }
  const cx = sx / n;
  const cy = sy / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (bin[y * w + x]) {
        const u = x - cx;
        const v = -(y - cy);
        sxx += u * u;
        syy += v * v;
        sxy += u * v;
      }
    }
  }
  sxx /= n;
  syy /= n;
  sxy /= n;
  const tr = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + disc;
  const l2 = Math.max(1e-9, tr / 2 - disc);
  let ang = 0.5 * Math.atan2(2 * sxy, sxx - syy); // major axis angle from +u
  let ax = Math.cos(ang);
  let av = Math.sin(ang);
  if (av < -1e-9 || (Math.abs(av) <= 1e-9 && ax < 0)) {
    ax = -ax;
    av = -av;
    ang += Math.PI;
  }
  // Mean width of the two end bands (the outer 20% of the length along the axis).
  let tMin = Infinity;
  let tMax = -Infinity;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (bin[y * w + x]) {
        const t = (x - cx) * ax + -(y - cy) * av;
        if (t < tMin) tMin = t;
        if (t > tMax) tMax = t;
      }
    }
  }
  const band = 0.2 * (tMax - tMin);
  let plus = 0;
  let minus = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (bin[y * w + x]) {
        const t = (x - cx) * ax + -(y - cy) * av;
        if (t >= tMax - band) plus++;
        else if (t <= tMin + band) minus++;
      }
    }
  }
  return {
    cx,
    cy,
    axis: [ax, av],
    elongation: Math.sqrt(l1 / l2),
    widthPlus: band > 0 ? plus / band : 0,
    widthMinus: band > 0 ? minus / band : 0,
  };
}

/** Choose the counter-clockwise rotation (radians, in the (right, up) frame) that C4 applies. */
function chooseRotation(m: Moments, orient: "long-axis-up" | "as-photographed", flip: boolean): { rad: number; orientation: OutlineOrientation } {
  let rad = 0;
  let reason: OutlineOrientation["reason"] = "as-photographed";
  if (orient === "long-axis-up") {
    if (m.elongation < ROUND_ELONGATION) {
      reason = "too-round";
    } else {
      const axisFromVertical = (Math.acos(clampNum(Math.abs(m.axis[1]), 0, 1)) * 180) / Math.PI;
      // Rotation that maps +axis to +z, versus the one that maps -axis to +z (a half turn more).
      const toUp = Math.PI / 2 - Math.atan2(m.axis[1], m.axis[0]);
      if (axisFromVertical <= UPRIGHT_WITHIN_DEG) {
        rad = toUp; // keep the photo's up; only straighten it
        reason = "near-upright";
      } else {
        const wider = Math.abs(m.widthPlus - m.widthMinus) / Math.max(m.widthPlus, m.widthMinus, 1e-9);
        if (wider < 0.05) {
          rad = toUp;
          reason = "tie";
        } else {
          // The narrow end is the handle, so it goes down: the wider end goes up.
          rad = m.widthPlus >= m.widthMinus ? toUp : toUp + Math.PI;
          reason = "narrow-end-down";
        }
      }
    }
  }
  if (flip) rad += Math.PI;
  let deg = (rad * 180) / Math.PI;
  deg = ((((deg + 180) % 360) + 360) % 360) - 180;
  return { rad: (deg * Math.PI) / 180, orientation: { rotationDeg: round2(deg), flipped: flip, reason } };
}

// ---------------------------------------------------------------------------
// Tracing and simplification
// ---------------------------------------------------------------------------

/**
 * Trace the outer boundary of a single hole-free piece along pixel corners. Returns the corner vertices
 * (a vertex only where the direction changes) in the raster's own frame: x right, y down, integer corners.
 */
function traceCorners(bin: Uint8Array, w: number, h: number): Vec[] {
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && bin[y * w + x] === 1;
  let sx = -1;
  let sy = -1;
  for (let i = 0; i < bin.length && sx < 0; i++) {
    if (bin[i]) {
      sx = i % w;
      sy = (i - sx) / w;
    }
  }
  if (sx < 0) return [];
  // Directions in y-down coordinates: E, S, W, N. Right of travel is (-dy, dx); left is (dy, -dx).
  const DX = [1, 0, -1, 0];
  const DY = [0, 1, 0, -1];
  let x = sx;
  let y = sy;
  let dir = 0; // east along the top edge of the first pixel, object on the right
  const out: Vec[] = [];
  const startDir = dir;
  const maxSteps = 4 * (w + 1) * (h + 1);
  for (let step = 0; step < maxSteps; step++) {
    const nx = x + DX[dir]!;
    const ny = y + DY[dir]!;
    // Pixels just ahead of the vertex we are about to reach.
    const lx = DY[dir]!;
    const ly = -DX[dir]!;
    const rx = -DY[dir]!;
    const ry = DX[dir]!;
    const frontLeft = on(Math.floor(nx + 0.5 * DX[dir]! + 0.5 * lx), Math.floor(ny + 0.5 * DY[dir]! + 0.5 * ly));
    const frontRight = on(Math.floor(nx + 0.5 * DX[dir]! + 0.5 * rx), Math.floor(ny + 0.5 * DY[dir]! + 0.5 * ry));
    const next = frontLeft ? (dir + 3) % 4 : frontRight ? dir : (dir + 1) % 4;
    if (next !== dir || (nx === sx && ny === sy)) out.push([nx, ny]);
    x = nx;
    y = ny;
    if (x === sx && y === sy && next === startDir) break;
    dir = next;
  }
  return out;
}

/** Gaussian blur of a 0/1 raster (separable, edges replicated), as floats in 0..1. Exported for tests/photo-outline.test.ts. */
export function gaussBlur(bin: Uint8Array, w: number, h: number, sigma: number): Float32Array {
  const r = Math.max(1, Math.ceil(3 * sigma));
  const k = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
    sum += k[i + r]!;
  }
  for (let i = 0; i < k.length; i++) k[i] = k[i]! / sum;
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += k[i + r]! * bin[y * w + Math.min(w - 1, Math.max(0, x + i))]!;
      tmp[y * w + x] = acc;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += k[i + r]! * tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x]!;
      out[y * w + x] = acc;
    }
  }
  return out;
}

/**
 * The closed loops where `f` crosses `level`, by marching squares, each crossing placed by linear interpolation between the two
 * pixel centres it lies between (so the loop is at sub-pixel precision). Points are in the raster's corner frame, like
 * `traceCorners`: pixel (i, j) has its centre at (i + 0.5, j + 0.5). A saddle is resolved by the cell's mean. Exported for tests.
 */
export function isoLoops(f: Float32Array, w: number, h: number, level: number): Vec[][] {
  const at = (i: number, j: number) => f[j * w + i]!;
  // An edge of the grid, named by its first pixel: horizontal (i, j)-(i+1, j) is j*w+i, vertical (i, j)-(i, j+1) is w*h + j*w+i.
  const horiz = (i: number, j: number) => j * w + i;
  const vert = (i: number, j: number) => w * h + j * w + i;
  const adj = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
    (adj.get(b) ?? adj.set(b, []).get(b)!).push(a);
  };
  for (let j = 0; j < h - 1; j++) {
    for (let i = 0; i < w - 1; i++) {
      const a = at(i, j);
      const b = at(i + 1, j);
      const c = at(i + 1, j + 1);
      const d = at(i, j + 1);
      const ai = a >= level;
      const bi = b >= level;
      const ci = c >= level;
      const di = d >= level;
      if (ai === bi && bi === ci && ci === di) continue;
      const T = horiz(i, j); // a-b
      const R = vert(i + 1, j); // b-c
      const B = horiz(i, j + 1); // d-c
      const L = vert(i, j); // a-d
      const hit: number[] = [];
      if (ai !== bi) hit.push(T);
      if (bi !== ci) hit.push(R);
      if (di !== ci) hit.push(B);
      if (ai !== di) hit.push(L);
      if (hit.length === 2) link(hit[0]!, hit[1]!);
      else if (hit.length === 4) {
        const centreIn = (a + b + c + d) / 4 >= level;
        if (ai === centreIn) {
          link(T, R);
          link(B, L);
        } else {
          link(T, L);
          link(R, B);
        }
      }
    }
  }
  const place = (e: number): Vec => {
    if (e < w * h) {
      const i = e % w;
      const j = (e - i) / w;
      const t = (level - at(i, j)) / (at(i + 1, j) - at(i, j));
      return [i + 0.5 + t, j + 0.5];
    }
    const r = e - w * h;
    const i = r % w;
    const j = (r - i) / w;
    const t = (level - at(i, j)) / (at(i, j + 1) - at(i, j));
    return [i + 0.5, j + 0.5 + t];
  };
  const seen = new Set<number>();
  const loops: Vec[][] = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const loop: Vec[] = [];
    let prev = -1;
    let cur = start;
    for (;;) {
      seen.add(cur);
      loop.push(place(cur));
      const ns = adj.get(cur)!;
      const nxt = ns[0] !== prev ? ns[0]! : ns[1] ?? ns[0]!;
      if (nxt === start || seen.has(nxt)) break;
      prev = cur;
      cur = nxt;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

/**
 * The outer boundary of a raster as a smooth loop: blur by `sigmaPx`, take the 0.5 contour at sub-pixel precision, keep the
 * biggest loop. Empty when there is none (the caller falls back to the pixel-corner trace). Exported for tests.
 */
export function smoothContour(bin: Uint8Array, w: number, h: number, sigmaPx: number): Vec[] {
  const loops = isoLoops(gaussBlur(bin, w, h, sigmaPx), w, h, 0.5);
  let best: Vec[] = [];
  let bestArea = 0;
  for (const l of loops) {
    let a = 0;
    for (let i = 0; i < l.length; i++) {
      const q = l[(i + 1) % l.length]!;
      a += l[i]![0] * q[1] - q[0] * l[i]![1];
    }
    if (Math.abs(a) > bestArea) {
      bestArea = Math.abs(a);
      best = l;
    }
  }
  return best;
}

/** A closed loop resampled at equal arc length into `count` points. */
function resampleClosed(loop: readonly Vec[], count: number): Vec[] {
  const n = loop.length;
  const cum = [0];
  for (let i = 0; i < n; i++) cum.push(cum[i]! + Math.hypot(loop[(i + 1) % n]![0] - loop[i]![0], loop[(i + 1) % n]![1] - loop[i]![1]));
  const total = cum[n]!;
  const out: Vec[] = [];
  let seg = 0;
  for (let k = 0; k < count; k++) {
    const at = (k / count) * total;
    while (seg < n - 1 && cum[seg + 1]! < at) seg++;
    const a = loop[seg]!;
    const b = loop[(seg + 1) % n]!;
    const span = cum[seg + 1]! - cum[seg]!;
    const t = span > 0 ? (at - cum[seg]!) / span : 0;
    out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
  }
  return out;
}

/**
 * Low-pass a closed loop without shrinking it. Taubin smoothing is a smoothing pass followed by a slightly stronger opposite one, which
 * removes wiggles shorter than `wavelengthPx` and keeps the size of the shape. It is only stable while its pass-band edge is small (an
 * eigenvalue of the discrete Laplacian of at most about 0.1), so the loop is resampled at a twentieth of the wavelength: that fixes the
 * edge at 0.1 whatever the cut-off, and a short cut-off simply gets finer samples.
 */
function taubinSmooth(loop: readonly Vec[], wavelengthPx: number): Vec[] {
  const total = loop.reduce((a, p, i) => a + Math.hypot(loop[(i + 1) % loop.length]![0] - p[0], loop[(i + 1) % loop.length]![1] - p[1]), 0);
  const spacing = Math.max(0.2, wavelengthPx / 20);
  let pts = resampleClosed(loop, Math.max(12, Math.round(total / spacing)));
  const lambda = 0.5;
  const mu = 1 / (0.1 - 1 / lambda); // = -0.526: with lambda 0.5 the pass-band edge is 0.1
  const pass = (src: Vec[], w: number): Vec[] =>
    src.map((p, i) => {
      const a = src[(i + src.length - 1) % src.length]!;
      const b = src[(i + 1) % src.length]!;
      return [p[0] + w * ((a[0] + b[0]) / 2 - p[0]), p[1] + w * ((a[1] + b[1]) / 2 - p[1])] as Vec;
    });
  for (let it = 0; it < 40; it++) pts = pass(pass(pts, lambda), mu);
  return pts;
}

const cross = (o: Vec, a: Vec, b: Vec) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
const dist = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function areaOf(p: readonly Vec[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length]!;
    a += p[i]![0] * q[1] - q[0] * p[i]![1];
  }
  return a / 2;
}

/** Do segments ab and cd touch or cross? */
function segmentsMeet(a: Vec, b: Vec, c: Vec, d: Vec): boolean {
  const eps = 1e-9;
  const d1 = cross(a, b, c);
  const d2 = cross(a, b, d);
  const d3 = cross(c, d, a);
  const d4 = cross(c, d, b);
  if (((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))) return true;
  const on = (p: Vec, q: Vec, r: Vec) =>
    Math.min(p[0], q[0]) - eps <= r[0] && r[0] <= Math.max(p[0], q[0]) + eps && Math.min(p[1], q[1]) - eps <= r[1] && r[1] <= Math.max(p[1], q[1]) + eps;
  return (
    (Math.abs(d1) <= eps && on(a, b, c)) || (Math.abs(d2) <= eps && on(a, b, d)) || (Math.abs(d3) <= eps && on(c, d, a)) || (Math.abs(d4) <= eps && on(c, d, b))
  );
}

/** A polygon is simple when no two edges that are not neighbours touch. */
function isSimple(p: readonly Vec[]): boolean {
  const n = p.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsMeet(p[i]!, p[(i + 1) % n]!, p[j]!, p[(j + 1) % n]!)) return false;
    }
  }
  return true;
}

function douglasPeucker(p: readonly Vec[], eps: number): Vec[] {
  const keep = new Uint8Array(p.length);
  keep[0] = 1;
  keep[p.length - 1] = 1;
  const stack: [number, number][] = [[0, p.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    let worst = -1;
    let at = -1;
    const pa = p[a]!;
    const pb = p[b]!;
    const len = dist(pa, pb);
    for (let i = a + 1; i < b; i++) {
      const d = len < 1e-12 ? dist(p[i]!, pa) : Math.abs(cross(pa, pb, p[i]!)) / len;
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (at >= 0 && worst > eps) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return p.filter((_, i) => keep[i] === 1);
}

/** Douglas-Peucker on a closed loop: split at the vertex farthest from vertex 0 and simplify each half. */
function simplifyClosed(p: readonly Vec[], eps: number): Vec[] {
  if (p.length <= 4) return [...p];
  let far = 0;
  for (let i = 1; i < p.length; i++) if (dist(p[i]!, p[0]!) > dist(p[far]!, p[0]!)) far = i;
  const first = douglasPeucker(p.slice(0, far + 1), eps);
  const second = douglasPeucker([...p.slice(far), p[0]!], eps);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}

/**
 * Remove the least important vertex until `limit` remain (Visvalingam-Whyatt), refusing any removal that
 * would make two edges touch, so a simple polygon stays simple. Returns false in `met` if it ran out of moves.
 */
function reduceTo(p: Vec[], limit: number): { points: Vec[]; met: boolean } {
  const pts = [...p];
  while (pts.length > Math.max(3, limit)) {
    const n = pts.length;
    const order = pts
      .map((_, i) => ({ i, a: Math.abs(cross(pts[(i + n - 1) % n]!, pts[i]!, pts[(i + 1) % n]!)) / 2 }))
      .sort((x, y) => x.a - y.a);
    let removed = false;
    for (const { i } of order) {
      const prev = (i + n - 1) % n;
      const next = (i + 1) % n;
      let clear = true;
      for (let e = 0; e < n && clear; e++) {
        const e2 = (e + 1) % n;
        if (e === prev || e === i || e2 === prev || e === next || e2 === next || e === i || e2 === i) continue;
        if (segmentsMeet(pts[prev]!, pts[next]!, pts[e]!, pts[e2]!)) clear = false;
      }
      if (clear) {
        pts.splice(i, 1);
        removed = true;
        break;
      }
    }
    if (!removed) return { points: pts, met: false };
  }
  return { points: pts, met: true };
}

/** Overlap of a polygon with a raster, both in the same frame: intersection over union of the filled areas. */
function overlap(poly: readonly Vec[], bin: Uint8Array, w: number, h: number, toWorld: (px: number, py: number) => Vec): number {
  let inter = 0;
  let union = 0;
  const n = poly.length;
  for (let j = 0; j < h; j++) {
    const z = toWorld(0.5, j + 0.5)[1];
    const xs: number[] = [];
    for (let k = 0; k < n; k++) {
      const a = poly[k]!;
      const b = poly[(k + 1) % n]!;
      if ((a[1] <= z && b[1] > z) || (b[1] <= z && a[1] > z)) xs.push(a[0] + ((z - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i < w; i++) {
      const x = toWorld(i + 0.5, j + 0.5)[0];
      let inside = false;
      for (let k = 0; k + 1 < xs.length; k += 2) if (x >= xs[k]! && x < xs[k + 1]!) inside = true;
      const r = bin[j * w + i] === 1;
      if (inside && r) inter++;
      if (inside || r) union++;
    }
  }
  return union > 0 ? inter / union : 0;
}

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

export function legalizeOutline(mask: OutlineMask, options: OutlineOptions = {}): OutlineResult {
  const { width: w, height: h } = mask;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 2 || h < 2 || w * h > MAX_MASK_PIXELS) {
    return { ok: false, reason: "bad_mask", detail: `mask is ${w} x ${h}` };
  }
  if (mask.data.length !== w * h) {
    return { ok: false, reason: "bad_mask", detail: `mask has ${mask.data.length} values for ${w} x ${h}` };
  }
  const fillet = clampNum(Number.isFinite(options.fillet_r_mm) ? (options.fillet_r_mm as number) : DEFAULT_FILLET_MM, 0.4, 4);
  const target = clampNum(Number.isFinite(options.targetHeightMm) ? (options.targetHeightMm as number) : DEFAULT_TARGET_MM, 8, HAND_BOX.maxHeightMm);
  const maxPoints = Math.round(clampNum(options.maxPoints ?? DEFAULT_MAX_POINTS, 3, MAX_RECIPE_POINTS));
  const changes: OutlineChange[] = [];
  const warnings: string[] = [];
  if (options.fillet_r_mm !== undefined && fillet !== options.fillet_r_mm) {
    changes.push({ step: "C2", code: "fillet_clamped", detail: `fillet ${options.fillet_r_mm} mm is outside 0.4 to 4, using ${fillet}`, value: fillet });
  }

  const raw = new Uint8Array(w * h);
  for (let i = 0; i < raw.length; i++) raw[i] = mask.data[i] ? 1 : 0;
  if (countOn(raw) === 0) return { ok: false, reason: "empty_mask", detail: "the mask has no object pixels" };

  // C1 on the photo's own raster.
  const first = oneBody(raw, w, h);
  if (first.report.pieces > 1) {
    changes.push({
      step: "C1",
      code: "dropped_pieces",
      detail: `kept the largest of ${first.report.pieces} pieces (${Math.round(first.report.keptShare * 100)}% of the mask)`,
      value: first.report.pieces - 1,
    });
    if (first.report.keptShare < SPLIT_SHARE) warnings.push("SPLIT_OBJECT");
  }
  if (first.report.holes > 0) {
    changes.push({
      step: "C1",
      code: "filled_holes",
      detail: `filled ${first.report.holes} hole${first.report.holes === 1 ? "" : "s"} (${Math.round(first.report.holeShare * 100)}% of the object)`,
      value: first.report.holes,
    });
    if (first.report.holeShare > LARGE_HOLE_SHARE) warnings.push("LARGE_HOLES_FILLED");
  }
  const body = first.bin;

  // C4: which way up.
  const m = momentsOf(body, w, h);
  const { rad, orientation } = chooseRotation(m, options.orient ?? "long-axis-up", options.flip === true);
  const cosR = Math.cos(rad);
  const sinR = Math.sin(rad);
  if (orientation.reason === "too-round") {
    changes.push({ step: "C4", code: "kept_orientation", detail: "nearly round, so the photo's own up is kept" });
  } else if (orientation.rotationDeg !== 0 || orientation.flipped) {
    changes.push({ step: "C4", code: "rotated", detail: `rotated ${orientation.rotationDeg} degrees (${orientation.reason})`, value: orientation.rotationDeg });
  }

  // Extent of the rotated object, in source pixels.
  let xMin = Infinity;
  let xMax = -Infinity;
  let zMin = Infinity;
  let zMax = -Infinity;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!body[y * w + x]) continue;
      const u = x - m.cx;
      const v = -(y - m.cy);
      const rx = u * cosR - v * sinR;
      const rz = u * sinR + v * cosR;
      if (rx < xMin) xMin = rx;
      if (rx > xMax) xMax = rx;
      if (rz < zMin) zMin = rz;
      if (rz > zMax) zMax = rz;
    }
  }
  const slack = 0.5 * (Math.abs(cosR) + Math.abs(sinR));
  const widthPx = xMax - xMin + 2 * slack;
  const heightPx = zMax - zMin + 2 * slack;

  // C3 and C2: set the scale, draw the object on a working raster in millimetres, round it the way the builder will.
  // Which parts are too thin is decided at the requested size and the size is kept: refitting after a thin part is
  // removed can flip-flop (the part survives at the new, bigger size, then not at the next).
  const radiusMm = Math.max(fillet, GRIP_ROUNDING_MM);
  const boxMm = 2 * HAND_BOX.halfWidthMm;
  const s0 = Math.min(target / heightPx, boxMm / widthPx); // mm per source pixel at the requested size
  const sMax = Math.min(HAND_BOX.maxHeightMm / heightPx, boxMm / widthPx); // the biggest the box allows
  const limitedBy: "height" | "width" = target / heightPx <= boxMm / widthPx ? "height" : "width";

  const buildAt = (scale: number): Built => {
    const widthMm = widthPx * scale;
    const heightMm = heightPx * scale;
    const wpx = Math.max(widthMm, heightMm) / WORK_LONG_PX;
    const pad = Math.ceil(radiusMm / wpx) + 3;
    const nx = Math.ceil(widthMm / wpx) + 2 * pad;
    const nz = Math.ceil(heightMm / wpx) + 2 * pad;
    const originX = (xMin - slack) * scale - pad * wpx; // mm of the raster's left edge
    const originZ = (zMax + slack) * scale + pad * wpx; // mm of the raster's top edge
    const grid = new Uint8Array(nx * nz);
    for (let j = 0; j < nz; j++) {
      const zmm = originZ - (j + 0.5) * wpx;
      for (let i = 0; i < nx; i++) {
        const xmm = originX + (i + 0.5) * wpx;
        const rx = xmm / scale;
        const rz = zmm / scale;
        const u = rx * cosR + rz * sinR; // inverse rotation
        const v = -rx * sinR + rz * cosR;
        grid[j * nx + i] = sample(body, w, h, m.cx + u, m.cy - v) >= 0.5 ? 1 : 0;
      }
    }
    const areaBefore = countOn(grid) * wpx * wpx;
    const rounded = open(grid, nx, nz, radiusMm / wpx);
    if (countOn(rounded) === 0) {
      return { scale, work: rounded, nx, nz, wpx, originX, originZ, areaBefore, areaAfter: 0, thin: { count: 0, areaMm2: 0 }, split: false, widthMm: 0, heightMm: 0, empty: true };
    }
    const thin = thinParts(grid, rounded, nx, nz, wpx, radiusMm);
    const again = oneBody(rounded, nx, nz); // rounding can cut a thin bridge
    const work = again.bin;
    let a = Infinity;
    let b = -Infinity;
    let c = Infinity;
    let d = -Infinity;
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        if (!work[j * nx + i]) continue;
        if (i < a) a = i;
        if (i > b) b = i;
        if (j < c) c = j;
        if (j > d) d = j;
      }
    }
    return {
      scale,
      work,
      nx,
      nz,
      wpx,
      originX,
      originZ,
      areaBefore,
      areaAfter: countOn(work) * wpx * wpx,
      thin,
      split: again.report.pieces > 1,
      widthMm: (b - a + 1) * wpx,
      heightMm: (d - c + 1) * wpx,
      empty: false,
    };
  };

  let built = buildAt(s0);
  let grownFromMm: number | undefined;
  if (options.keepThinParts === true && (built.empty || built.thin.count > 0) && sMax > s0 * 1.001) {
    // A part that survives at one size survives at every bigger one, so bisect for the smallest size that keeps them all.
    const top = buildAt(sMax);
    if (!top.empty && top.thin.count === 0) {
      let lo = s0;
      let hi = sMax;
      let best = top;
      for (let i = 0; i < 4; i++) {
        const mid = (lo + hi) / 2;
        const t = buildAt(mid);
        if (!t.empty && t.thin.count === 0) {
          hi = mid;
          best = t;
        } else lo = mid;
      }
      grownFromMm = built.empty ? heightPx * s0 : built.heightMm;
      built = best;
    }
  }
  if (built.empty) return { ok: false, reason: "too_thin", detail: `nothing is wider than ${round2(2 * radiusMm)} mm at the printed size` };
  const { work, nx, nz, wpx, originX, originZ } = built;
  if (built.split) {
    changes.push({ step: "C1", code: "split_by_rounding", detail: "rounding cut a thin bridge; kept the larger side" });
    warnings.push("SPLIT_OBJECT");
  }
  const removedMm2 = built.areaBefore - built.areaAfter;
  changes.push({
    step: "C2",
    code: "rounded",
    detail: `rounded by ${round2(radiusMm)} mm (nothing narrower than ${round2(2 * radiusMm)} mm survives); ${round2(Math.max(0, removedMm2))} mm2 came off`,
    value: round2(Math.max(0, removedMm2)),
  });
  if (built.thin.count > 0) {
    changes.push({
      step: "C2",
      code: "thin_parts_removed",
      detail: `removed ${built.thin.count} thin part${built.thin.count === 1 ? "" : "s"} (${round2(built.thin.areaMm2)} mm2) narrower than ${round2(2 * radiusMm)} mm`,
      value: built.thin.count,
    });
    warnings.push("THIN_PARTS_REMOVED");
  }
  if (grownFromMm !== undefined) {
    changes.push({
      step: "C3",
      code: "grew_to_keep_thin_parts",
      detail: `grew from ${round2(grownFromMm)} mm to ${round2(built.heightMm)} mm so the thin parts are wide enough to print`,
      value: round2(built.heightMm),
    });
  }
  changes.push({
    step: "C3",
    code: "fitted",
    detail: `scaled to ${round2(built.widthMm)} x ${round2(built.heightMm)} mm${grownFromMm === undefined ? `, limited by ${limitedBy}` : ""}`,
    value: round2(built.heightMm),
  });

  // Trace, then simplify to the point budget while staying a simple polygon.
  const sigmaMm = Number.isFinite(options.smoothMm) ? clampNum(options.smoothMm as number, 0, SMOOTH_MAX_MM) : clampNum(SMOOTH_SOURCE_PX * built.scale, SMOOTH_MIN_MM, SMOOTH_MAX_MM);
  let corners: Vec[] = sigmaMm > 0 ? smoothContour(work, nx, nz, sigmaMm / wpx) : [];
  const smoothedTrace = corners.length >= 4;
  const curveMm = Number.isFinite(options.curveMm) ? Math.max(0, options.curveMm as number) : clampNum(CURVE_SHARE * Math.max(built.widthMm, built.heightMm), CURVE_MIN_MM, CURVE_MAX_MM);
  if (smoothedTrace && curveMm > 0) corners = taubinSmooth(corners, curveMm / wpx);
  if (!smoothedTrace) corners = traceCorners(work, nx, nz);
  if (corners.length < 4) return { ok: false, reason: "not_simple", detail: "could not trace the outline" };
  let loop: Vec[] = corners;
  // On a smoothed contour the tolerance is a target sag in millimetres, raised only as far as the point budget needs. On the pixel-corner
  // trace (smoothing off) it stays at the old 0.6 of a pixel.
  const sagMm = Number.isFinite(options.sagMm) ? clampNum(options.sagMm as number, 0, 1) : DEFAULT_SAG_MM;
  let eps = smoothedTrace ? clampNum(sagMm / wpx, MIN_EPS_PX, PIXEL_STAIR_EPS_PX) : PIXEL_STAIR_EPS_PX;
  let simplified = simplifyClosed(loop, eps);
  while (simplified.length > maxPoints && eps < PIXEL_STAIR_EPS_PX) {
    eps = Math.min(PIXEL_STAIR_EPS_PX, eps * 1.25);
    simplified = simplifyClosed(loop, eps);
  }
  for (let tries = 0; tries < 3 && !isSimple(simplified); tries++) {
    eps /= 2;
    simplified = simplifyClosed(loop, eps);
  }
  if (!isSimple(simplified)) return { ok: false, reason: "not_simple", detail: "the simplified outline crosses itself" };
  const reduced = reduceTo(simplified, smoothedTrace ? maxPoints : Math.min(maxPoints, PIXEL_TRACE_POINTS));
  if (!reduced.met) warnings.push("POINT_BUDGET_NOT_MET");
  loop = reduced.points;
  if (loop.length > MAX_RECIPE_POINTS) return { ok: false, reason: "not_simple", detail: `${loop.length} points, the compiler takes ${MAX_RECIPE_POINTS}` };

  // To millimetres: x centred, bottom at z = 0, counter-clockwise, two decimals.
  let loX = Infinity;
  let hiX = -Infinity;
  let loZ = Infinity;
  for (const [px, py] of loop) {
    const x = originX + px * wpx;
    const z = originZ - py * wpx;
    if (x < loX) loX = x;
    if (x > hiX) hiX = x;
    if (z < loZ) loZ = z;
  }
  const shiftX = (loX + hiX) / 2;
  const toMm = (px: number, py: number): Vec => [originX + px * wpx - shiftX, originZ - py * wpx - loZ];
  // The photo-to-plate map in closed form: pixel -> centred -> rotated -> scaled, then the shifts that centre x and drop the bottom to 0.
  const sc = built.scale;
  const photoToPlate: Affine = [
    sc * cosR,
    sc * sinR,
    sc * sinR,
    -sc * cosR,
    sc * (-cosR * m.cx - sinR * m.cy) - shiftX,
    sc * (-sinR * m.cx + cosR * m.cy) - loZ,
  ];
  let pts: Vec[] = loop.map(([px, py]) => toMm(px, py));
  if (areaOf(pts) < 0) pts = pts.reverse();
  // `+ 0` turns a rounded -0.00 into 0 on x (z is clamped by Math.max(0, z), which never gives -0): JSON cannot carry a negative zero, so an outline with one would not survive the wire unchanged.
  pts = pts.map(([x, z]) => [round2(clampNum(x, -HAND_BOX.halfWidthMm, HAND_BOX.halfWidthMm)) + 0, round2(clampNum(z, 0, HAND_BOX.maxHeightMm))]);
  // Two neighbours can land on the same 0.01 mm; a zero-length edge makes the edges either side look like they touch.
  pts = pts.filter((p, i) => {
    const q = pts[(i + 1) % pts.length]!;
    return p[0] !== q[0] || p[1] !== q[1];
  });
  if (pts.length < 3) return { ok: false, reason: "not_simple", detail: "the outline collapsed when rounded to 0.01 mm" };
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of pts) {
    maxX = Math.max(maxX, Math.abs(x));
    maxZ = Math.max(maxZ, z);
  }
  if (!isSimple(pts)) return { ok: false, reason: "not_simple", detail: "the outline crosses itself after rounding to 0.01 mm" };

  const fidelity = overlap(pts, work, nx, nz, toMm);
  if (fidelity < LOW_FIDELITY) warnings.push("LOW_FIDELITY");

  return {
    ok: true,
    points: pts.map(([x, z]) => [x, z] as [number, number]),
    fillet_r_mm: fillet,
    widthMm: round2(2 * maxX),
    heightMm: round2(maxZ),
    orientation,
    changes,
    warnings: [...new Set(warnings)],
    fidelity: Math.round(fidelity * 1000) / 1000,
    photoToPlate,
  };
}

/**
 * Half turn of a finished outline (the kid's flip button): the handle end swaps. Works on the polygon, because the
 * photo and its mask are gone after the SAM call. x stays centred, the bottom returns to z = 0, winding stays
 * counter-clockwise.
 */
export function flipOutline(points: readonly (readonly [number, number])[]): [number, number][] {
  let zMax = -Infinity;
  for (const [, z] of points) zMax = Math.max(zMax, z);
  // x -> -x and z -> top - z is a half turn about the middle: the winding stays counter-clockwise, and doing it twice is exact.
  return points.map(([x, z]): [number, number] => [round2(-x), round2(zMax - z)]);
}

/**
 * Uniform resize of a finished outline about its bottom centre, limited to the clamp box. Returns the factor
 * actually used. Shrinking can take a feature under the builder's minimum (2 x the larger of fillet and 0.8 mm);
 * the builder rounds it away, so a preview made from this outline may show a sliver the print will not have.
 */
export function scaleOutline(points: readonly (readonly [number, number])[], factor: number): { points: [number, number][]; factor: number } {
  let xAbs = 0;
  let zMax = 0;
  for (const [x, z] of points) {
    xAbs = Math.max(xAbs, Math.abs(x));
    zMax = Math.max(zMax, z);
  }
  const f = Number.isFinite(factor) && factor > 0 ? Math.min(factor, HAND_BOX.halfWidthMm / Math.max(xAbs, 1e-9), HAND_BOX.maxHeightMm / Math.max(zMax, 1e-9)) : 1;
  return { points: points.map(([x, z]) => [round2(x * f), round2(z * f)] as [number, number]), factor: f };
}

/** `outer` after `inner`: apply `inner` first. */
export function composeAffine(outer: Affine, inner: Affine): Affine {
  const [a1, b1, c1, d1, e1, f1] = outer;
  const [a2, b2, c2, d2, e2, f2] = inner;
  return [a1 * a2 + c1 * b2, b1 * a2 + d1 * b2, a1 * c2 + c1 * d2, b1 * c2 + d1 * d2, a1 * e2 + c1 * f2 + e1, b1 * e2 + d1 * f2 + f1];
}

export function applyAffine(t: Affine, x: number, y: number): [number, number] {
  return [t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]];
}

/** Inverse of an affine map, or undefined when it is singular. */
export function invertAffine(t: Affine): Affine | undefined {
  const [a, b, c, d, e, f] = t;
  const det = a * d - b * c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return undefined;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

const sizeOf = (points: readonly (readonly [number, number])[]) => {
  let xAbs = 0;
  let zMax = 0;
  for (const [x, z] of points) {
    xAbs = Math.max(xAbs, Math.abs(x));
    zMax = Math.max(zMax, z);
  }
  return { widthMm: round2(2 * xAbs), heightMm: round2(zMax), zMax };
};

/**
 * `flipOutline` for a whole result: the polygon turns a half turn and the photo-to-plate map turns with it, so a sticker
 * drawn from the photo still lands on the shape. Doing it twice gives the original back (to 0.01 mm).
 */
export function withFlipped(outline: OutlineSuccess): OutlineSuccess {
  const points = flipOutline(outline.points);
  const { zMax } = sizeOf(outline.points);
  return {
    ...outline,
    points,
    photoToPlate: composeAffine([-1, 0, 0, -1, 0, zMax], outline.photoToPlate),
    orientation: { ...outline.orientation, flipped: !outline.orientation.flipped },
    changes: [...outline.changes, { step: "C4", code: "flipped", detail: "the handle end was swapped" }],
  };
}

/** `scaleOutline` for a whole result, with the photo-to-plate map scaled too. Returns the factor actually used. */
export function withScaled(outline: OutlineSuccess, factor: number): { outline: OutlineSuccess; factor: number } {
  const scaled = scaleOutline(outline.points, factor);
  const f = scaled.factor;
  return {
    factor: f,
    outline: {
      ...outline,
      points: scaled.points,
      ...(({ widthMm, heightMm }) => ({ widthMm, heightMm }))(sizeOf(scaled.points)),
      photoToPlate: composeAffine([f, 0, 0, f, 0, 0], outline.photoToPlate),
    },
  };
}

/** The `shape` a Recipe v1 hand part takes for this outline. */
export function outlineToRecipeShape(result: OutlineSuccess, gripTu = 2): Extract<ForgeRecipeV1["shape"], { kind: "profile2d" }> {
  return { kind: "profile2d", points: result.points.map(([x, z]) => [x, z] as [number, number]), fillet_r_mm: result.fillet_r_mm, grip_tu: gripTu };
}

/**
 * Would the builder's rounding at `filletMm` take a real part off this polygon? The polygon-only counterpart of the
 * legalizer's thin-part test, for a caller that changes the recipe fillet with no mask to re-legalize from (the retry
 * ladder in `fitPolygon`). The builder rounds by the recipe fillet itself, so a bigger fillet can take a thin part off the
 * printed plate while the polygon, and the sticker cut to it, still show it, and the gates cannot see the difference
 * (they pass a spoon with no handle as readily as one with). Same definition of "a part" as the legalizer: a piece that
 * comes off counts when it is long and bigger than one radius squared, so rounded corners and star tips do not.
 */
export function roundingRemovesParts(points: readonly (readonly [number, number])[], filletMm: number): { count: number; areaMm2: number } {
  const n = points.length;
  if (n < 3) return { count: 0, areaMm2: 0 };
  let xMin = Infinity, xMax = -Infinity, zMin = Infinity, zMax = -Infinity;
  for (const [x, z] of points) {
    xMin = Math.min(xMin, x); xMax = Math.max(xMax, x);
    zMin = Math.min(zMin, z); zMax = Math.max(zMax, z);
  }
  const widthMm = xMax - xMin;
  const heightMm = zMax - zMin;
  if (!(widthMm > 0) || !(heightMm > 0)) return { count: 0, areaMm2: 0 };
  const radiusMm = Math.max(filletMm, GRIP_ROUNDING_MM);
  const wpx = Math.max(widthMm, heightMm) / WORK_LONG_PX;
  const pad = Math.ceil(radiusMm / wpx) + 3;
  const nx = Math.ceil(widthMm / wpx) + 2 * pad;
  const nz = Math.ceil(heightMm / wpx) + 2 * pad;
  const originX = xMin - pad * wpx;
  const originZ = zMax + pad * wpx;
  // Even-odd scanline fill, sampled at pixel centres like the legalizer's own raster.
  const grid = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    const zc = originZ - (j + 0.5) * wpx;
    const xs: number[] = [];
    for (let a = 0, b = n - 1; a < n; b = a++) {
      const [xa, za] = points[a]!;
      const [xb, zb] = points[b]!;
      if (za > zc !== zb > zc) xs.push(xa + ((zc - za) * (xb - xa)) / (zb - za));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil((xs[k]! - originX) / wpx - 0.5));
      const to = Math.min(nx, Math.ceil((xs[k + 1]! - originX) / wpx - 0.5));
      for (let i = from; i < to; i++) grid[j * nx + i] = 1;
    }
  }
  const rounded = open(grid, nx, nz, radiusMm / wpx);
  return thinParts(grid, rounded, nx, nz, wpx, radiusMm);
}
