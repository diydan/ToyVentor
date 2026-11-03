/**
 * Mirror symmetry of a finished outline (docs/specs/forge-ai-spec.md, "F2b"): find out whether the object is meant to be symmetric,
 * and if so straighten its axis and make both sides identical.
 *
 * A photographed object is rarely exactly symmetric even when the real thing is: the bowl of a spoon leans a few degrees off its handle in
 * the picture, and the mask edge wobbles differently on each side. The plate then looks lopsided. This module works on the outline alone
 * (no mask), so the Worker can apply it at scan time and the device can offer it later as a button.
 *
 * Deciding what is symmetric. Raw overlap with the mirror image cannot tell a skewed spoon (0.87) from a mug with a handle (0.88). The
 * difference is in the shape of the mismatch: a skewed spoon leaves thin slivers along its edges, a handle leaves a lump. So the mismatch
 * (shape XOR its mirror image about the best axis) is opened by a small disc, which removes slivers and keeps lumps, and what survives is
 * the "lump share". Measured 2026-11-02 at a 1.2 mm disc: real spoon 0.00%, mug 9.2%, a side handle on a disc 13.7%, an L 39%, a random
 * blob 28%, discs, stars and paddles 0.00%.
 *
 * Making it symmetric. The outline is rotated so the axis is exactly vertical. At every height it has a left edge and a right edge; the symmetric
 * half-width there is the average of the two, which is the same as re-centring the row on the axis: every width is kept exactly (a thin neck
 * stays as wide as it was, only centred) and a lean or curve of the centre line is taken out. ONE half of that profile is simplified and the
 * other half is its reflection, so the polygon is symmetric exactly (every vertex has a twin at -x, same z) and not just nearly. An earlier
 * version blended the outline with its mirror image as a field; that shrinks a thin part that sits off the axis (the real spoon's handle was
 * lost), so it is only the fallback for a shape that has two or more pieces in some row (a star's side arms), where there is no single left
 * and right edge to average; there a part the average would remove makes it refuse. No edge may move further than 1 mm in automatic mode
 * (0.15 of its size in `mirror` mode).
 *
 * Pure: imports only the outline module.
 */

import {
  composeAffine,
  gaussBlur,
  HAND_BOX,
  isoLoops,
  MAX_RECIPE_POINTS,
  openRaster,
  polygonIsSimple,
  rasterizePolygon,
  simplifyPolyline,
  type Affine,
  type OutlineChange,
  type OutlineSuccess,
} from "./photoOutline";

type Pt = [number, number];

/** How far from vertical the axis may lean, degrees. The outline is already turned upright by its long axis. */
export const AXIS_MAX_DEG = 12;
/** In automatic mode, what survives opening the mismatch may be at most this share of the area. */
export const LUMP_MAX_SHARE = 0.005;
/** In automatic mode no edge may move by more than this, mm. */
export const MAX_MOVE_MM = 1.0;
/** Below this overlap with its mirror image an outline is not looked at any further. */
const MIN_OVERLAP = 0.7;
const PX_MM = 0.15; // the raster the symmetry is measured on
const ROW_MM = 0.05; // the spacing of the rows the profile is read at
const SAG_MM = 0.015; // how far a chord of the symmetric outline may leave its profile, as in legalizeOutline
const BLUR_MM = 0.45; // for the field fallback
const LOST_PART_MM = 0.5; // a removed piece wider than twice this counts as a lost part; a thinner one is only an edge that moved
const DEFAULT_BUDGET = 240;

export interface SymmetryAxis {
  /** Lean from vertical, degrees: positive leans towards +x going up. */
  angleDeg: number;
  /** Where the axis crosses the middle of the outline's height, mm in x. */
  offsetMm: number;
}

export type SymmetryReason =
  | "symmetric"
  /** The mismatch has a lump (a handle, a spout, an arm): not mirror symmetric. */
  | "lump"
  /** The axis cuts the blended outline more than twice (a C, a ring of pieces), so it cannot be split into two halves. */
  | "split_rows"
  /** A thin part of the original would be lost (field fallback only). */
  | "parts_lost"
  /** An edge would move further than the limit. */
  | "moved_too_far"
  /** The result is not a simple polygon, or does not fit the clamp box or the point budget. */
  | "not_buildable"
  | "too_small";

export interface SymmetryReport {
  /** Symmetric enough to apply (in `mirror` mode this means: could be applied). */
  symmetric: boolean;
  /** True when the outline returned is the symmetric one. */
  applied: boolean;
  reason: SymmetryReason;
  axis: SymmetryAxis;
  /** Overlap (intersection over union) of the outline with its mirror image about the axis, 0 to 1. */
  overlap: number;
  /** Share of the outline's area that survives opening the mismatch: slivers go, lumps stay. */
  lumpShare: number;
  /** The furthest any edge moved, mm; set when a symmetric outline was built. */
  moveMm?: number;
}

export interface SymmetryOptions {
  /** `auto` (default): only when the object is symmetric and the change is small. `mirror`: whenever it can be done without losing a thin part. */
  mode?: "auto" | "mirror";
  /** Point budget, 3 to 256. Default 240. */
  maxPoints?: number;
  /** In automatic mode, the furthest an edge may move. Default 1.5 mm. */
  maxMoveMm?: number;
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function extent(points: readonly Pt[]) {
  let xMin = Infinity, xMax = -Infinity, zMin = Infinity, zMax = -Infinity;
  for (const [x, z] of points) {
    xMin = Math.min(xMin, x); xMax = Math.max(xMax, x);
    zMin = Math.min(zMin, z); zMax = Math.max(zMax, z);
  }
  return { xMin, xMax, zMin, zMax, width: xMax - xMin, height: zMax - zMin };
}

/** Overlap of a raster with its mirror image about the axis through (offsetMm, zMid) leaning `angleRad`. */
function mirrorOverlap(grid: Uint8Array, nx: number, nz: number, originX: number, originZ: number, px: number, angleRad: number, offsetMm: number, zMid: number): number {
  const dx = Math.sin(angleRad);
  const dz = Math.cos(angleRad);
  let inter = 0;
  let union = 0;
  for (let j = 0; j < nz; j++) {
    const z = originZ - (j + 0.5) * px;
    for (let i = 0; i < nx; i++) {
      const a = grid[j * nx + i]!;
      const x = originX + (i + 0.5) * px;
      const t = (x - offsetMm) * dx + (z - zMid) * dz;
      const rx = 2 * (offsetMm + t * dx) - x;
      const rz = 2 * (zMid + t * dz) - z;
      const ri = Math.floor((rx - originX) / px);
      const rj = Math.floor((originZ - rz) / px);
      const b = ri >= 0 && ri < nx && rj >= 0 && rj < nz ? grid[rj * nx + ri]! : 0;
      if (a && b) inter++;
      if (a || b) union++;
    }
  }
  return union === 0 ? 0 : inter / union;
}

/** The best mirror axis near vertical, coarse to fine. */
function findAxis(points: readonly Pt[]): SymmetryAxis & { overlap: number } {
  const e = extent(points);
  const size = Math.max(e.width, e.height);
  const zMid = (e.zMin + e.zMax) / 2;
  const reach = Math.max(2, 0.12 * e.width); // how far the axis may sit from the middle of the outline, mm
  const best = { overlap: -1, angleDeg: 0, offsetMm: 0 };
  const pass = (px: number, angles: number[], offsets: number[]) => {
    const pad = Math.ceil((0.25 * size) / px);
    const r = rasterizePolygon(points, px, pad);
    const tried: { s: number; a: number; o: number }[] = [];
    for (const a of angles) {
      for (const o of offsets) tried.push({ s: mirrorOverlap(r.grid, r.nx, r.nz, r.originX, r.originZ, px, (a * Math.PI) / 180, o, zMid), a, o });
    }
    const top = Math.max(...tried.map((t) => t.s));
    // A disc is symmetric about every axis: among the axes that score within 0.002 of the best, the one nearest upright and centred wins.
    const near = tried.filter((t) => t.s >= top - 0.002).sort((m, n) => Math.abs(m.a) - Math.abs(n.a) || Math.abs(m.o) - Math.abs(n.o))[0]!;
    best.overlap = near.s;
    best.angleDeg = near.a;
    best.offsetMm = near.o;
  };
  const coarse = Math.max(0.4, size / 120);
  const angles: number[] = [];
  for (let a = -AXIS_MAX_DEG; a <= AXIS_MAX_DEG; a += 2) angles.push(a);
  const offsets: number[] = [];
  for (let o = -reach; o <= reach + 1e-9; o += coarse) offsets.push(o);
  pass(coarse, angles, offsets);
  if (best.overlap < MIN_OVERLAP) return { ...best };
  const fine = Math.max(PX_MM, size / 360);
  const a0 = best.angleDeg;
  const o0 = best.offsetMm;
  const fineAngles: number[] = [];
  for (let a = a0 - 2; a <= a0 + 2 + 1e-9; a += 0.5) fineAngles.push(clamp(a, -AXIS_MAX_DEG, AXIS_MAX_DEG));
  const fineOffsets: number[] = [];
  for (let o = o0 - coarse; o <= o0 + coarse + 1e-9; o += fine) fineOffsets.push(o);
  best.overlap = -1;
  pass(fine, fineAngles, fineOffsets);
  return { ...best };
}

/** Distance from a point to a polygon's boundary. */
function boundaryDistance(poly: readonly Pt[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i]!;
    const [bx, bz] = poly[(i + 1) % poly.length]!;
    const dx = bx - ax;
    const dz = bz - az;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    best = Math.min(best, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
  }
  return best;
}

/** The furthest either polygon's boundary is from the other's: a Hausdorff distance, sampled every 0.25 mm. */
function movement(a: readonly Pt[], b: readonly Pt[]): number {
  let worst = 0;
  for (const [p, q] of [[a, b], [b, a]] as const) {
    for (let i = 0; i < p.length; i++) {
      const [ax, az] = p[i]!;
      const [bx, bz] = p[(i + 1) % p.length]!;
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.25));
      for (let k = 0; k < steps; k++) worst = Math.max(worst, boundaryDistance(q, ax + ((bx - ax) * k) / steps, az + ((bz - az) * k) / steps));
    }
  }
  return worst;
}

function areaOf(grid: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < grid.length; i++) n += grid[i]!;
  return n;
}

/**
 * Is the outline mirror symmetric, and about which axis? Looks only; builds nothing.
 */
export function detectSymmetry(outline: Pick<OutlineSuccess, "points" | "fillet_r_mm">): SymmetryReport {
  const points = outline.points as Pt[];
  const e = extent(points);
  const empty: SymmetryAxis = { angleDeg: 0, offsetMm: 0 };
  if (points.length < 3 || !(e.width > 4) || !(e.height > 4)) return { symmetric: false, applied: false, reason: "too_small", axis: empty, overlap: 0, lumpShare: 1 };
  const axis = findAxis(points);
  const base: SymmetryReport = { symmetric: false, applied: false, reason: "lump", axis: { angleDeg: axis.angleDeg, offsetMm: axis.offsetMm }, overlap: axis.overlap, lumpShare: 1 };
  if (axis.overlap < MIN_OVERLAP) return base;
  const frame = frameOf(points, axis);
  const lump = lumpShareOf(frame.grid, frame.nx, frame.nz, Math.max(e.width, e.height));
  return { ...base, lumpShare: lump, symmetric: lump <= LUMP_MAX_SHARE, reason: lump <= LUMP_MAX_SHARE ? "symmetric" : "lump" };
}

/** The outline turned so its axis is vertical and drawn on a raster whose middle column is the axis. */
function frameOf(points: readonly Pt[], axis: SymmetryAxis) {
  const e = extent(points);
  const phi = (axis.angleDeg * Math.PI) / 180; // rotating by +angle makes a lean of +angle vertical
  const zMid = (e.zMin + e.zMax) / 2;
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  const q: Pt[] = points.map(([x, z]) => {
    const vx = x - axis.offsetMm;
    const vz = z - zMid;
    return [c * vx - s * vz, s * vx + c * vz];
  });
  const qe = extent(q);
  const xAbs = Math.max(Math.abs(qe.xMin), Math.abs(qe.xMax)) + 4;
  const nx = 2 * Math.ceil(xAbs / PX_MM); // even, so column i and column nx-1-i are mirror images exactly
  const padPx = Math.ceil(4 / PX_MM);
  const nz = Math.ceil(qe.height / PX_MM) + 2 * padPx;
  const originX = -(nx * PX_MM) / 2;
  const originZ = qe.zMax + padPx * PX_MM;
  const { grid } = rasterizePolygon(q, PX_MM, 0, { originX, originZ, nx, nz });
  return { q, grid, nx, nz, originX, originZ, phi, zMid };
}

function lumpShareOf(grid: Uint8Array, nx: number, nz: number, sizeMm: number): number {
  const mismatch = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) mismatch[j * nx + i] = grid[j * nx + i] !== grid[j * nx + (nx - 1 - i)] ? 1 : 0;
  const r = clamp(0.025 * sizeMm, 0.8, 2.0);
  const kept = openRaster(mismatch, nx, nz, r / PX_MM);
  const area = areaOf(grid);
  return area === 0 ? 1 : areaOf(kept) / area;
}

/**
 * The right half of the outline blended with its own mirror image (a blurred field averaged with its reflection, contoured at 0.5): the way to
 * go when some row has more than one piece. Returns the half from bottom to top with both ends on the axis, or why there is none.
 */
function blendedHalf(frame: ReturnType<typeof frameOf>): Pt[] | "crossings" | "none" {
  const { nx, nz, originX, originZ } = frame;
  const field = gaussBlur(frame.grid, nx, nz, BLUR_MM / PX_MM);
  const sym = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) sym[j * nx + i] = 0.5 * (field[j * nx + i]! + field[j * nx + (nx - 1 - i)]!);
  let loop: Pt[] = [];
  let loopArea = 0;
  for (const l of isoLoops(sym, nx, nz, 0.5)) {
    let a = 0;
    for (let i = 0; i < l.length; i++) {
      const p = l[i]!;
      const q = l[(i + 1) % l.length]!;
      a += p[0] * q[1] - q[0] * p[1];
    }
    if (Math.abs(a) > loopArea) {
      loopArea = Math.abs(a);
      loop = l;
    }
  }
  if (loop.length < 8) return "none";
  const contour: Pt[] = loop.map(([cx, cy]): Pt => [originX + cx * PX_MM, originZ - cy * PX_MM]);
  const crossings: number[] = [];
  for (let i = 0; i < contour.length; i++) if (contour[i]![0] < 0 !== contour[(i + 1) % contour.length]![0] < 0) crossings.push(i);
  if (crossings.length !== 2) return "crossings";
  const cross = (i: number): Pt => {
    const p = contour[i]!;
    const q = contour[(i + 1) % contour.length]!;
    return [0, p[1] + (p[0] / (p[0] - q[0])) * (q[1] - p[1])];
  };
  // The right half runs from the crossing where x turns positive to the one where it turns negative. The tracer always winds the outer loop the
  // same way, so that is bottom to top up the right side (counter-clockwise overall); a test checks the area of the result comes out positive.
  const enter = contour[crossings[0]!]![0] < 0 ? crossings[0]! : crossings[1]!;
  const exit = enter === crossings[0] ? crossings[1]! : crossings[0]!;
  const half: Pt[] = [cross(enter)];
  for (let i = (enter + 1) % contour.length; i !== (exit + 1) % contour.length; i = (i + 1) % contour.length) half.push(contour[i]!);
  half.push(cross(exit));
  half[0] = [0, half[0]![1]];
  half[half.length - 1] = [0, half[half.length - 1]![1]];
  return half;
}

/** The longest `rowShift` table a result carries. */
export const MAX_ROW_SHIFT_POINTS = 256;
/** A slide under this is not worth drawing: the sticker would not change by a printable amount. */
const MIN_SLIDE_MM = 0.005;
const SHIFT_SAG_MM = 0.01;

/**
 * The per-row slide that puts the photographed object on the symmetric outline: how far each row of the object sits from the axis, as a
 * short table. `rows` are [z, offset] in the new plate frame, one per 0.05 mm. Simplified so the sticker's slide is never more than
 * 0.01 mm off the true one, rounded to a micron, and left out (undefined) when the object already sits on the axis.
 */
export function rowShiftOf(rows: readonly Pt[]): [number, number][] | undefined {
  if (rows.length < 2 || rows.every(([, d]) => Math.abs(d) < MIN_SLIDE_MM)) return undefined;
  let eps = SHIFT_SAG_MM;
  let pts = simplifyPolyline(rows as Pt[], eps);
  while (pts.length > MAX_ROW_SHIFT_POINTS && eps < 1) {
    eps *= 1.5;
    pts = simplifyPolyline(rows as Pt[], eps);
  }
  const out: [number, number][] = [];
  for (const [z, d] of pts) {
    const pair: [number, number] = [Math.round(z * 1000) / 1000 + 0, Math.round(d * 1000) / 1000 + 0];
    const prev = out[out.length - 1];
    if (!prev || pair[0] > prev[0]) out.push(pair);
  }
  return out.length >= 2 ? out : undefined;
}

export interface SymmetrizeResult<T extends OutlineSuccess> {
  outline: T;
  report: SymmetryReport;
}

/**
 * Make an outline mirror symmetric, if it is. In `auto` mode (the default) nothing changes unless the object is symmetric and the change is
 * small; the report says why not. The outline returned is the same object when it was not applied.
 */
export function symmetrizeOutline<T extends OutlineSuccess>(outline: T, options: SymmetryOptions = {}): SymmetrizeResult<T> {
  const mode = options.mode ?? "auto";
  // Already done (at scan time, say): the entry in the change log says so, and a second pass would only add another one.
  if (outline.changes.some((c) => c.code === "made_symmetric")) {
    return { outline, report: { symmetric: true, applied: false, reason: "symmetric", axis: { angleDeg: 0, offsetMm: 0 }, overlap: 1, lumpShare: 0 } };
  }
  const budget = Math.round(clamp(options.maxPoints ?? DEFAULT_BUDGET, 4, MAX_RECIPE_POINTS));
  const maxMove = options.maxMoveMm ?? MAX_MOVE_MM;
  const report = detectSymmetry(outline);
  const refuse = (reason: SymmetryReason, extra: Partial<SymmetryReport> = {}): SymmetrizeResult<T> => ({ outline, report: { ...report, applied: false, symmetric: reason === "symmetric", reason, ...extra } });
  if (report.reason === "too_small") return refuse("too_small");
  if (report.overlap < MIN_OVERLAP) return refuse("lump");
  if (mode === "auto" && !report.symmetric) return refuse("lump");

  const points = outline.points as Pt[];
  const frame = frameOf(points, report.axis);
  const { q } = frame;
  const qe = extent(q);

  // Read the outline's left and right edge at every height. If every row is one piece, the symmetric half-width is the average of the two.
  const rows: { z: number; c: number; h: number }[] = [];
  let oneEveryRow = true;
  const nRows = Math.max(8, Math.floor(qe.height / ROW_MM));
  for (let k = 0; k < nRows && oneEveryRow; k++) {
    const z = qe.zMin + (qe.height * (k + 0.5)) / nRows + 0.00137; // off the 0.01 mm grid the vertices sit on, so a row never runs along a vertex
    const xs: number[] = [];
    for (let a = 0, b = q.length - 1; a < q.length; b = a++) {
      const [xa, za] = q[a]!;
      const [xb, zb] = q[b]!;
      if (za > z !== zb > z) xs.push(xa + ((z - za) * (xb - xa)) / (zb - za));
    }
    if (xs.length === 0) continue; // a hair above or below the outline
    if (xs.length !== 2) {
      oneEveryRow = false;
      break;
    }
    xs.sort((m, n) => m - n);
    rows.push({ z, c: (xs[0]! + xs[1]!) / 2, h: (xs[1]! - xs[0]!) / 2 });
  }
  let half: Pt[];
  let centre = 0;
  let rowCentres: Pt[] | null = null; // [z, centre] of every row, when the outline is made row by row (not by the blend)
  if (oneEveryRow && rows.length >= 8) {
    rowCentres = rows.map((r): Pt => [r.z, r.c]);
    // Where the object's centre line sits on average (weighted by width): the symmetric outline is centred there, so the photo stays where it was.
    let wSum = 0;
    let cSum = 0;
    for (const r of rows) {
      wSum += r.h;
      cSum += r.c * r.h;
    }
    centre = cSum / Math.max(wSum, 1e-9);
    half = [[0, qe.zMin], ...rows.map((r): Pt => [r.h, r.z]), [0, qe.zMax]];
  } else {
    const blended = blendedHalf(frame);
    if (blended === "crossings") return refuse("split_rows");
    if (blended === "none") return refuse("not_buildable");
    half = blended;
  }

  // The right half, bottom to top, simplified to the budget; the other half is its reflection.
  const interiorBudget = Math.max(1, Math.floor((budget - 2) / 2));
  let eps = SAG_MM;
  let simple = simplifyPolyline(half, eps);
  while (simple.length - 2 > interiorBudget && eps < 2) {
    eps *= 1.25;
    simple = simplifyPolyline(half, eps);
  }
  const rightSide: Pt[] = [];
  for (let k = 1; k < simple.length - 1; k++) {
    const [x, z] = simple[k]!;
    const p: Pt = [round2(x), round2(z)];
    const prev = rightSide[rightSide.length - 1];
    if (p[0] > 0 && (!prev || prev[0] !== p[0] || prev[1] !== p[1])) rightSide.push(p);
  }
  if (rightSide.length < 1) return refuse("not_buildable");
  const bottom: Pt = [0, round2(simple[0]![1])];
  const top: Pt = [0, round2(simple[simple.length - 1]![1])];
  const poly: Pt[] = [bottom, ...rightSide, top];
  for (let k = rightSide.length - 1; k >= 0; k--) poly.push([-rightSide[k]![0], rightSide[k]![1]]);
  const zLow = Math.min(...poly.map((p) => p[1]));
  const pts: Pt[] = poly.map(([x, z]): Pt => [x, round2(z - zLow)]);
  const pe = extent(pts);
  if (pts.length < 4 || pts.length > budget || pts.length > MAX_RECIPE_POINTS) return refuse("not_buildable");
  if (pe.xMax > HAND_BOX.halfWidthMm || pe.height > HAND_BOX.maxHeightMm || !polygonIsSimple(pts)) return refuse("not_buildable");

  // How far the symmetric outline is from the original (both in the straightened, centred frame), and how well they overlap.
  const ptsQ: Pt[] = pts.map(([x, z]): Pt => [x, z + zLow]);
  const original: Pt[] = q.map(([x, z]): Pt => [x - centre, z]);
  const move = movement(original, ptsQ);
  const size = Math.max(extent(points).width, extent(points).height);
  if (!oneEveryRow) {
    // A blend can remove a thin part that sits off the axis. A removed piece counts only if it is wider than 2 x LOST_PART_MM: a thinner one is an edge that moved.
    const gone = new Uint8Array(frame.grid.length);
    const check = rasterizePolygon(ptsQ, PX_MM, 0, { originX: frame.originX, originZ: frame.originZ, nx: frame.nx, nz: frame.nz }).grid;
    for (let i = 0; i < gone.length; i++) gone[i] = frame.grid[i] && !check[i] ? 1 : 0;
    const kept = openRaster(gone, frame.nx, frame.nz, LOST_PART_MM / PX_MM);
    if (areaOf(kept) * PX_MM * PX_MM > 1.0) return refuse("parts_lost");
  }
  if (mode === "auto" && move > maxMove) return refuse("moved_too_far", { moveMm: round2(move) });
  if (mode === "mirror" && move > 0.15 * size) return refuse("moved_too_far", { moveMm: round2(move) });
  const frameOriginX = frame.originX;
  const mine = rasterizePolygon(ptsQ, PX_MM, 0, { originX: frameOriginX, originZ: frame.originZ, nx: frame.nx, nz: frame.nz }).grid;
  const theirs = rasterizePolygon(original, PX_MM, 0, { originX: frameOriginX, originZ: frame.originZ, nx: frame.nx, nz: frame.nz }).grid;
  let inter = 0;
  let union = 0;
  for (let i = 0; i < mine.length; i++) {
    if (mine[i] && theirs[i]) inter++;
    if (mine[i] || theirs[i]) union++;
  }
  const agreement = union === 0 ? 0 : inter / union;

  // Where the photo sits now: the same straightening and centring, applied to the photo's map into the plate.
  const c = Math.cos(frame.phi);
  const s = Math.sin(frame.phi);
  const toFrame: Affine = [1, 0, 0, 1, -report.axis.offsetMm, -frame.zMid];
  const turn: Affine = [c, s, -s, c, 0, 0];
  const recentre: Affine = [1, 0, 0, 1, -centre, 0];
  const lower: Affine = [1, 0, 0, 1, 0, -zLow];
  const photoToPlate = composeAffine(lower, composeAffine(recentre, composeAffine(turn, composeAffine(toFrame, outline.photoToPlate))));

  const change: OutlineChange = {
    step: "C4",
    code: "made_symmetric",
    detail: `the object is mirror symmetric (${Math.round(report.overlap * 1000) / 10}% overlap with its mirror image), so its axis was straightened by ${Math.round(report.axis.angleDeg * 10) / 10} degrees and both sides made identical; no edge moved more than ${round2(move)} mm`,
    value: round2(move),
  };
  const fidelity = Math.round(outline.fidelity * agreement * 1000) / 1000;
  const rowShift = rowCentres ? rowShiftOf(rowCentres.map(([z, c]): Pt => [z - zLow, c - centre])) : undefined;
  const result: T = {
    ...outline,
    ...(rowShift ? { rowShift } : {}),
    points: pts,
    widthMm: round2(2 * Math.max(pe.xMax, -pe.xMin)),
    heightMm: round2(pe.zMax),
    orientation: { ...outline.orientation, rotationDeg: Math.round((outline.orientation.rotationDeg + report.axis.angleDeg) * 100) / 100 },
    changes: [...outline.changes, change],
    warnings: fidelity < 0.9 && !outline.warnings.includes("LOW_FIDELITY") ? [...outline.warnings, "LOW_FIDELITY"] : outline.warnings,
    fidelity,
    photoToPlate,
  };
  return { outline: result, report: { ...report, applied: true, symmetric: true, reason: "symmetric", moveMm: round2(move) } };
}
