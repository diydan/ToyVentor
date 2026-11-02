/**
 * Synthetic masks for tests/photo-outline.test.ts, plus checkers that do NOT share code with
 * shared/photoOutline.ts (a module must not grade itself with its own helpers).
 *
 * Masks are drawn in pixels on a canvas, y down, sampled at pixel centres. The tests pick the printed
 * size, so "a 4 px spike" means whatever 4 px comes to at that scale; each test says what it is.
 */

export interface Raster {
  data: Uint8Array;
  width: number;
  height: number;
}

export type Inside = (x: number, y: number) => boolean;

export function rasterize(width: number, height: number, inside: Inside): Raster {
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (inside(x + 0.5, y + 0.5)) data[y * width + x] = 1;
  return { data, width, height };
}

export const disc = (cx: number, cy: number, r: number): Inside => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
export const rect = (x0: number, y0: number, x1: number, y1: number): Inside => (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
export const union = (...fns: Inside[]): Inside => (x, y) => fns.some((f) => f(x, y));
export const minus = (a: Inside, b: Inside): Inside => (x, y) => a(x, y) && !b(x, y);

/** Rotate a shape by `deg` degrees clockwise on screen about (cx, cy). */
export const rotated = (f: Inside, cx: number, cy: number, deg: number): Inside => {
  const a = (-deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return (x, y) => f(cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c);
};

/** Even-odd point-in-polygon for a list of [x, y]. */
export const polygon = (pts: readonly (readonly [number, number])[]): Inside => (x, y) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]!;
    const [xj, yj] = pts[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

export function star(cx: number, cy: number, ro: number, ri: number, n = 5): Inside {
  const pts: [number, number][] = [];
  for (let i = 0; i < 2 * n; i++) {
    const r = i % 2 === 0 ? ro : ri;
    const a = -Math.PI / 2 + (Math.PI * i) / n;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return polygon(pts);
}

/** Deterministic pseudo-random numbers (mulberry32), so a failing case can be rebuilt. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A blob of 3 to 6 overlapping discs and ellipse-ish arms: the shape SAM tends to hand back for a toy. */
export function randomBlob(seed: number, size = 300): Raster {
  const rnd = prng(seed);
  const parts: Inside[] = [];
  const n = 3 + Math.floor(rnd() * 4);
  let px = size / 2;
  let py = size / 2;
  for (let i = 0; i < n; i++) {
    const r = size * (0.07 + rnd() * 0.13);
    parts.push(disc(px, py, r));
    const a = rnd() * Math.PI * 2;
    const step = r * (0.8 + rnd() * 0.8);
    px = Math.min(size * 0.85, Math.max(size * 0.15, px + Math.cos(a) * step));
    py = Math.min(size * 0.85, Math.max(size * 0.15, py + Math.sin(a) * step));
  }
  return rasterize(size, size, union(...parts));
}

/** Rough edge: a disc whose radius wobbles with the angle (jagged but one piece). */
export function jaggedDisc(seed: number, size = 300): Raster {
  const rnd = prng(seed);
  const wob = Array.from({ length: 48 }, () => 1 + (rnd() - 0.5) * 0.12);
  const c = size / 2;
  const r0 = size * 0.38;
  return rasterize(size, size, (x, y) => {
    const a = Math.atan2(y - c, x - c);
    const k = Math.floor(((a + Math.PI) / (2 * Math.PI)) * wob.length) % wob.length;
    return Math.hypot(x - c, y - c) <= r0 * wob[k]!;
  });
}

// ---- the standard shapes (400 x 400 px) ------------------------------------------------------------

export const SHAPES = {
  disc: () => rasterize(400, 400, disc(200, 200, 150)),
  /** A round head on a stick: 350 px tall, stick 30 px wide. */
  paddle: () => rasterize(400, 400, union(disc(200, 120, 90), rect(185, 200, 215, 380))),
  /** A tall bar: 360 px tall, 40 px wide. */
  blade: () => rasterize(400, 400, rect(180, 20, 220, 380)),
  star: () => rasterize(400, 400, star(200, 215, 170, 80)),
  /** A disc with a round hole. */
  ring: () => rasterize(400, 400, minus(disc(200, 200, 150), disc(200, 200, 60))),
  /** A big blob and a small one with a gap between. */
  twoBlobs: () => rasterize(400, 400, union(disc(120, 200, 100), disc(335, 200, 40))),
} as const;

/** An object in a photo, cropped to its bounding box the way the model sends a mask: the crop, where it sits, and the photo. */
export interface Cropped {
  raster: Raster;
  bounds: { left: number; top: number };
  photo: Raster;
}

export function cropToObject(photo: Raster): Cropped {
  let x0 = photo.width, y0 = photo.height, x1 = -1, y1 = -1;
  for (let y = 0; y < photo.height; y++)
    for (let x = 0; x < photo.width; x++)
      if (photo.data[y * photo.width + x]) {
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = photo.data[(y + y0) * photo.width + x + x0] ? 1 : 0;
  return { raster: { data, width: w, height: h }, bounds: { left: x0, top: y0 }, photo };
}

/** The raster with every enclosed hole filled (a flood from the border marks the background; what it misses is inside). */
export function fillHoles(r: Raster): Raster {
  const { width: w, height: h } = r;
  const reached = new Uint8Array(w * h);
  const stack: number[] = [];
  const visit = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (reached[i] || r.data[i]) return;
    reached[i] = 1;
    stack.push(i);
  };
  for (let x = 0; x < w; x++) { visit(x, 0); visit(x, h - 1); }
  for (let y = 0; y < h; y++) { visit(0, y); visit(w - 1, y); }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w, y = (i / w) | 0;
    visit(x + 1, y); visit(x - 1, y); visit(x, y + 1); visit(x, y - 1);
  }
  const data = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) data[i] = r.data[i] || !reached[i] ? 1 : 0;
  return { data, width: w, height: h };
}

// ---- independent checkers --------------------------------------------------------------------------

export const countOn = (r: Raster) => r.data.reduce((a, b) => a + b, 0);

/** Number of 8-connected pieces, by a plain flood fill. */
export function countPieces(r: Raster): number {
  const seen = new Uint8Array(r.data.length);
  let pieces = 0;
  for (let s = 0; s < r.data.length; s++) {
    if (!r.data[s] || seen[s]) continue;
    pieces++;
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % r.width;
      const y = (p - x) / r.width;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= r.width || ny >= r.height) continue;
          const q = ny * r.width + nx;
          if (r.data[q] && !seen[q]) {
            seen[q] = 1;
            stack.push(q);
          }
        }
    }
  }
  return pieces;
}

export type Pt = readonly [number, number];

export const signedArea = (p: readonly Pt[]) => p.reduce((a, q, i) => a + (q[0] * p[(i + 1) % p.length]![1] - p[(i + 1) % p.length]![0] * q[1]), 0) / 2;

export function bbox(p: readonly Pt[]) {
  const xs = p.map((q) => q[0]);
  const zs = p.map((q) => q[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
}

/** True when no two non-adjacent edges touch. A separate, naive implementation (parametric intersection). */
export function isSimplePolygon(p: readonly Pt[]): boolean {
  const n = p.length;
  const hit = (a: Pt, b: Pt, c: Pt, d: Pt) => {
    const r = [b[0] - a[0], b[1] - a[1]];
    const s = [d[0] - c[0], d[1] - c[1]];
    const den = r[0]! * s[1]! - r[1]! * s[0]!;
    const qp = [c[0] - a[0], c[1] - a[1]];
    if (Math.abs(den) < 1e-12) {
      // parallel: only a problem when collinear and overlapping
      if (Math.abs(qp[0]! * r[1]! - qp[1]! * r[0]!) > 1e-9) return false;
      const rr = r[0]! * r[0]! + r[1]! * r[1]!;
      const t0 = (qp[0]! * r[0]! + qp[1]! * r[1]!) / rr;
      const t1 = t0 + (s[0]! * r[0]! + s[1]! * r[1]!) / rr;
      return Math.max(Math.min(t0, t1), 0) <= Math.min(Math.max(t0, t1), 1);
    }
    const t = (qp[0]! * s[1]! - qp[1]! * s[0]!) / den;
    const u = (qp[0]! * r[1]! - qp[1]! * r[0]!) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  };
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (hit(p[i]!, p[(i + 1) % n]!, p[j]!, p[(j + 1) % n]!)) return false;
    }
  return true;
}

/** Fraction of a sampling grid covered by the union that is covered by both (intersection over union). */
export function polygonIoU(a: readonly Pt[], b: readonly Pt[], step = 0.25): number {
  const fa = polygon(a as [number, number][]);
  const fb = polygon(b as [number, number][]);
  const A = bbox(a);
  const B = bbox(b);
  let inter = 0;
  let uni = 0;
  for (let z = Math.min(A.z0, B.z0); z <= Math.max(A.z1, B.z1); z += step)
    for (let x = Math.min(A.x0, B.x0); x <= Math.max(A.x1, B.x1); x += step) {
      const ia = fa(x, z);
      const ib = fb(x, z);
      if (ia && ib) inter++;
      if (ia || ib) uni++;
    }
  return uni ? inter / uni : 0;
}

/** Direction of the long axis of a polygon, in degrees from vertical (0 = upright), from sampled area moments. */
export function axisFromVerticalDeg(p: readonly Pt[], step = 0.5): number {
  const f = polygon(p as [number, number][]);
  const { x0, x1, z0, z1 } = bbox(p);
  let n = 0;
  let sx = 0;
  let sz = 0;
  const pts: [number, number][] = [];
  for (let z = z0; z <= z1; z += step)
    for (let x = x0; x <= x1; x += step)
      if (f(x, z)) {
        n++;
        sx += x;
        sz += z;
        pts.push([x, z]);
      }
  const cx = sx / n;
  const cz = sz / n;
  let sxx = 0;
  let szz = 0;
  let sxz = 0;
  for (const [x, z] of pts) {
    sxx += (x - cx) ** 2;
    szz += (z - cz) ** 2;
    sxz += (x - cx) * (z - cz);
  }
  const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz); // major axis from +x
  return Math.abs(90 - Math.abs((ang * 180) / Math.PI));
}

/** Mean width of the polygon in a band of height `band` mm whose lower edge is at z. */
export function widthNear(p: readonly Pt[], zFrom: number, zTo: number, step = 0.25): number {
  const f = polygon(p as [number, number][]);
  const { x0, x1 } = bbox(p);
  let cells = 0;
  let rows = 0;
  for (let z = zFrom; z <= zTo; z += step) {
    rows++;
    for (let x = x0; x <= x1; x += step) if (f(x, z)) cells++;
  }
  return (cells * step) / Math.max(1, rows);
}

// ---- roughness of an outline: plain arithmetic on its points ----------------------------------------------------

/** Turning angle at each vertex, degrees, counter-clockwise positive. Plain arithmetic on the output: nothing from the module. */
export function turns(points: readonly (readonly [number, number])[]): number[] {
  const n = points.length;
  return points.map((b, i) => {
    const a = points[(i + n - 1) % n]!;
    const c = points[(i + 1) % n]!;
    const v1 = [b[0] - a[0], b[1] - a[1]];
    const v2 = [c[0] - b[0], c[1] - b[1]];
    return (Math.atan2(v1[0]! * v2[1]! - v1[1]! * v2[0]!, v1[0]! * v2[0]! + v1[1]! * v2[1]!) * 180) / Math.PI;
  });
}
/** Corners of 80 degrees or more: on a rounded outline these are the steps of a staircase. */
export const stairCorners = (points: readonly (readonly [number, number])[]) => turns(points).filter((t) => Math.abs(t) >= 80).length;
/** Neighbouring vertices that turn opposite ways, each by more than 8 degrees: a zig-zag, not a curve. */
export function zigzags(points: readonly (readonly [number, number])[]): number {
  const t = turns(points);
  return t.filter((v, i) => v * t[(i + 1) % t.length]! < 0 && Math.abs(v) > 8 && Math.abs(t[(i + 1) % t.length]!) > 8).length;
}
export const totalTurning = (points: readonly (readonly [number, number])[]) => turns(points).reduce((a, t) => a + Math.abs(t), 0);

