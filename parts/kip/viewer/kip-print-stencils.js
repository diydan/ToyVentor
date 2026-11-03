// Kip 3D printable paint & marker stencils (§8.2): planar-outer-face / conformal-underside-cavity heightfields
// (`stencil_face_<expr>`, `stencil_shirt_<id>`, `stencil_crown_2x1`) + sprue-joined Adult Tool Card.
//
// PRIVACY & PURITY INVARIANTS (enforced by tests/kip-print.test.ts, tests/kip-selfie.test.ts, tests/kip-print-stencils.test.ts):
//  - Pure JS: typed arrays and plain objects in, Float32Array / Uint8Array / plain JSON manifests out.
//  - Zero DOM, window, document, Worker, network, Web Storage, IndexedDB, Cache API, URL, or biometric/camera APIs.
//  - Selfie camera pixels (`expr === 'selfie'`) never enter stencil meshes, filenames, layout.json, or README.txt.

import {
  PLATE_MM,
  PLATE_TOP_ZB,
  WINDOW_MM,
  WINDOW_ZB,
  FACE_TARGET_MM,
  plateHalfWidth,
  windowHalfWidth,
} from './kip-faceplate-shape.js?v=10.0';
import { normHex } from './kip-print-bom.js';
import { HUMAN_HEAD_IDS } from './kip-vehicles-wardrobe.js?v=10.0';
import {
  SPRUE_SPEC,
  sprueMarginMm,
  buildSprueCard,
  checkSprueCard,
} from './kip-print-sprue.js';
import {
  PRINT_PAGE_WARNINGS,
  supportReport,
  plateStl,
  to3mf,
} from './kip-print.js';

export const STENCIL_DEFAULTS = Object.freeze({
  gridStepMm: 0.28,
  minFloorMm: 1.00,           // >= 0.80 mm (5 layers at 0.20 mm)
  minWallMm: 0.95,            // >= 0.80 mm profile min_wall_mm (two 0.45 mm extrusion beads = 0.90 mm)
  minApertureMm: 0.95,        // fine paint-pen / marker tip clearance
  minBridgeMm: 1.05,          // >= 0.90 mm enclosed-island bridge width (§8.2)
  faceClearanceMm: 0.06,      // 0.05..0.08 mm anti-wicking gap over faceplate window (§8.2)
  faceRimSlipMm: 0.12,        // slip fit around 24.2 x 12.8 mm faceplate perimeter
  faceSkirtWallMm: 1.25,      // >= 1.20 mm rim indexing wall (`interfaces.json`)
  faceSkirtRiseMm: 1.45,      // vertical lip height above outer plate edge
  shirtWindowWmm: 18.8,       // torso chest decal plane width (§8.2)
  shirtWindowHmm: 21.6,       // torso chest decal plane height (§8.2)
  shirtCenterZmm: 86.8,       // torso chest decal center Z in rig/SCAD coordinates
  shirtClearanceMm: 0.08,     // slip fit over chest front
  shirtTotalWmm: 27.2,        // wraps +-13.6 mm across curved torso ribs (~5.4 mm deep saddle index)
  shirtTotalHmm: 25.6,        // 2.0 mm top/bottom margin around 21.6 mm chest window
  shirtCornerRmm: 3.2,
  crownWmm: 27.8,             // §8.2 crown paint cap outer width
  crownHmm: 15.4,             // §8.2 crown paint cap outer depth
  crownCornerRmm: 6.0,        // concentric with 31.4 x 19.2, R7.8 head saddle (7.8 - (31.4 - 27.8)/2)
  crownPitchMm: 12.5,         // 2x1 stud pitch (x = +-6.25 mm)
  crownStudDiaMm: 6.60,
  crownHoleDiaMm: 6.84,       // §8.2 chamfered stud bore (+0.24 mm diametral clearance)
  crownDeckHmm: 2.90,         // 2.80 mm studs sit 0.10 mm flush below z=0 marker face for effortless tip reach
  crownTotalHmm: 3.60,        // +0.70 mm outer saddle-indexing lip
  crownChamferMm: 0.50,       // 45° underside lead-in chamfer around each Ø6.84 mm bore
  adultCardMinWmm: 60.0,      // exceeds 57.15 mm small-parts cylinder depth
  adultCardMinHmm: 34.0,      // exceeds 31.75 mm small-parts cylinder diameter
  stencilHex: '#F4EFE6',      // Warm Shell Cream light neutral tool filament
});

const GRAPHIC_EXPRESSIONS = new Set([
  'spark', 'button', 'happy', 'wink', 'cool', 'starry', 'surprised',
]);

function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

function hexToRgb(hex) {
  const h = normHex(hex, '#F4EFE6');
  return [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ];
}

function colorDist(r0, g0, b0, r1, g1, b1) {
  const dr = r0 - r1, dg = g0 - g1, db = b0 - b1;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function roundedRectSdf(x, y, halfW, halfH, r) {
  const rad = Math.max(0, Math.min(r, halfW - 1e-4, halfH - 1e-4));
  const qx = Math.abs(x) - (halfW - rad);
  const qy = Math.abs(y) - (halfH - rad);
  const out = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inn = Math.min(Math.max(qx, qy), 0);
  return out + inn - rad;
}

// ---------------------------------------------------------------------------------------------
// 1. Marching-Squares Contour Tracer (§8.2)
// ---------------------------------------------------------------------------------------------

/**
 * Trace closed, oriented iso-contours (`field >= level` on the inside) on a regular `cols x rows` scalar grid.
 * Uses linear edge interpolation and bilinear center average to disambiguate saddle cells (`5` and `10`)
 * topologically so contours never self-cross.
 *
 * @param {Float32Array|Float64Array|number[]} field Row-major `rows * cols` scalar samples
 * @param {number} cols Grid column count (`>= 2`)
 * @param {number} rows Grid row count (`>= 2`)
 * @param {object} [opts]
 * @returns {Array<Array<[number, number]>>} Closed 2D polylines in world `(x, y)` coordinates
 */
export function marchingSquaresContours(field, cols, rows, {
  x0 = 0,
  y0 = 0,
  dx = 1,
  dy = 1,
  level = 0.5,
} = {}) {
  if (cols < 2 || rows < 2) return [];
  const segs = [];

  const interp = (va, vb) => {
    const denom = vb - va;
    if (Math.abs(denom) < 1e-12) return 0.5;
    return clamp((level - va) / denom, 0.001, 0.999);
  };

  // Edge key integer for exact topological segment stitching:
  // horizontal edges on row `r`, col `c`: `(r * cols + c) * 2`
  // vertical edges on col `c`, row `r`:   `(r * cols + c) * 2 + 1`
  const hKey = (c, r) => (r * cols + c) * 2;
  const vKey = (c, r) => (r * cols + c) * 2 + 1;

  for (let r = 0; r < rows - 1; r++) {
    const wy = y0 + r * dy;
    for (let c = 0; c < cols - 1; c++) {
      const wx = x0 + c * dx;
      const v00 = field[r * cols + c];
      const v10 = field[r * cols + c + 1];
      const v11 = field[(r + 1) * cols + c + 1];
      const v01 = field[(r + 1) * cols + c];

      const idx = (v00 >= level ? 1 : 0)
        | (v10 >= level ? 2 : 0)
        | (v11 >= level ? 4 : 0)
        | (v01 >= level ? 8 : 0);
      if (idx === 0 || idx === 15) continue;

      const eBot = () => ({ k: hKey(c, r), p: [wx + interp(v00, v10) * dx, wy] });
      const eRight = () => ({ k: vKey(c + 1, r), p: [wx + dx, wy + interp(v10, v11) * dy] });
      const eTop = () => ({ k: hKey(c, r + 1), p: [wx + interp(v01, v11) * dx, wy + dy] });
      const eLeft = () => ({ k: vKey(c, r), p: [wx, wy + interp(v00, v01) * dy] });

      // Directed segments keep `field >= level` on the LEFT (CCW around high plateaus, CW around low holes)
      switch (idx) {
        case 1:  segs.push([eBot(), eLeft()]); break;
        case 2:  segs.push([eRight(), eBot()]); break;
        case 3:  segs.push([eRight(), eLeft()]); break;
        case 4:  segs.push([eTop(), eRight()]); break;
        case 5: {
          const centerHigh = 0.25 * (v00 + v10 + v11 + v01) >= level;
          if (centerHigh) {
            segs.push([eBot(), eRight()], [eTop(), eLeft()]);
          } else {
            segs.push([eBot(), eLeft()], [eTop(), eRight()]);
          }
          break;
        }
        case 6:  segs.push([eTop(), eBot()]); break;
        case 7:  segs.push([eTop(), eLeft()]); break;
        case 8:  segs.push([eLeft(), eTop()]); break;
        case 9:  segs.push([eBot(), eTop()]); break;
        case 10: {
          const centerHigh = 0.25 * (v00 + v10 + v11 + v01) >= level;
          if (centerHigh) {
            segs.push([eRight(), eTop()], [eLeft(), eBot()]);
          } else {
            segs.push([eRight(), eBot()], [eLeft(), eTop()]);
          }
          break;
        }
        case 11: segs.push([eRight(), eTop()]); break;
        case 12: segs.push([eLeft(), eRight()]); break;
        case 13: segs.push([eBot(), eRight()]); break;
        case 14: segs.push([eLeft(), eBot()]); break;
      }
    }
  }

  // Stitch directed segments by exact shared edge keys
  const startMap = new Map();
  for (let i = 0; i < segs.length; i++) {
    const k0 = segs[i][0].k;
    if (!startMap.has(k0)) startMap.set(k0, []);
    startMap.get(k0).push(i);
  }

  const used = new Uint8Array(segs.length);
  const contours = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const poly = [segs[i][0].p];
    let cur = segs[i][1];
    const startKey = segs[i][0].k;
    let guard = 0;
    while (cur.k !== startKey && guard++ <= segs.length) {
      poly.push(cur.p);
      const list = startMap.get(cur.k);
      let nextIdx = -1;
      if (list) {
        for (const cand of list) {
          if (!used[cand]) { nextIdx = cand; break; }
        }
      }
      if (nextIdx < 0) {
        poly.push(cur.p);
        break;
      }
      used[nextIdx] = 1;
      cur = segs[nextIdx][1];
    }
    if (poly.length >= 3) contours.push(poly);
  }
  return contours;
}

function pointInPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-18) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInContoursEvenOdd(px, py, contours) {
  let inside = false;
  for (let i = 0; i < contours.length; i++) {
    if (pointInPoly(px, py, contours[i])) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------------------------------------
// 2. Pure-JS Deterministic Fallback RGBA Painters (for CLI / Node tests without DOM <canvas>)
// ---------------------------------------------------------------------------------------------

function makeSoftPainter(w, h) {
  const data = new Uint8Array(w * h * 4);
  const setPx = (x, y, r, g, b, a = 255) => {
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    const o = (y * w + x) * 4;
    data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = a;
  };
  const fillEllipse = (cx, cy, rx, ry, rgb) => {
    const x0 = Math.max(0, Math.floor(cx - rx - 1)), x1 = Math.min(w - 1, Math.ceil(cx + rx + 1));
    const y0 = Math.max(0, Math.floor(cy - ry - 1)), y1 = Math.min(h - 1, Math.ceil(cy + ry + 1));
    for (let y = y0; y <= y1; y++) {
      const ny = (y - cy) / Math.max(1e-6, ry);
      for (let x = x0; x <= x1; x++) {
        const nx = (x - cx) / Math.max(1e-6, rx);
        if (nx * nx + ny * ny <= 1) setPx(x, y, rgb[0], rgb[1], rgb[2], 255);
      }
    }
  };
  const fillCapsule = (x0, y0, x1, y1, radius, rgb) => {
    const minX = Math.max(0, Math.floor(Math.min(x0, x1) - radius - 1));
    const maxX = Math.min(w - 1, Math.ceil(Math.max(x0, x1) + radius + 1));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1) - radius - 1));
    const maxY = Math.min(h - 1, Math.ceil(Math.max(y0, y1) + radius + 1));
    const vx = x1 - x0, vy = y1 - y0;
    const len2 = vx * vx + vy * vy;
    const r2 = radius * radius;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const t = len2 > 1e-9 ? clamp(((x - x0) * vx + (y - y0) * vy) / len2, 0, 1) : 0;
        const dx = x - (x0 + t * vx), dy = y - (y0 + t * vy);
        if (dx * dx + dy * dy <= r2) setPx(x, y, rgb[0], rgb[1], rgb[2], 255);
      }
    }
  };
  const strokeArc = (cx, cy, r, a0, a1, halfThick, rgb, steps = 32) => {
    let px = cx + Math.cos(a0) * r, py = cy + Math.sin(a0) * r;
    for (let i = 1; i <= steps; i++) {
      const a = a0 + ((a1 - a0) * i) / steps;
      const nx = cx + Math.cos(a) * r, ny = cy + Math.sin(a) * r;
      fillCapsule(px, py, nx, ny, halfThick, rgb);
      px = nx; py = ny;
    }
  };
  const fillRoundRect = (rx, ry, rw, rh, rad, rgb) => {
    const cx = rx + rw * 0.5, cy = ry + rh * 0.5;
    const x0 = Math.max(0, Math.floor(rx)), x1 = Math.min(w - 1, Math.ceil(rx + rw));
    const y0 = Math.max(0, Math.floor(ry)), y1 = Math.min(h - 1, Math.ceil(ry + rh));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (roundedRectSdf(x - cx, y - cy, rw * 0.5, rh * 0.5, rad) <= 0) {
          setPx(x, y, rgb[0], rgb[1], rgb[2], 255);
        }
      }
    }
  };
  const fillPoly = (pts, rgb) => {
    let minX = w, maxX = 0, minY = h, maxY = 0;
    for (const [px, py] of pts) {
      if (px < minX) minX = px; if (px > maxX) maxX = px;
      if (py < minY) minY = py; if (py > maxY) maxY = py;
    }
    minX = Math.max(0, Math.floor(minX)); maxX = Math.min(w - 1, Math.ceil(maxX));
    minY = Math.max(0, Math.floor(minY)); maxY = Math.min(h - 1, Math.ceil(maxY));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (pointInPoly(x + 0.5, y + 0.5, pts)) setPx(x, y, rgb[0], rgb[1], rgb[2], 255);
      }
    }
  };
  return { w, h, data, fillEllipse, fillCapsule, strokeArc, fillRoundRect, fillPoly };
}

/** Deterministic pure-JS expression RGBA fallback (`256 x 128`) matching `kip-forge-sdk.js` proportions. */
export function renderFallbackExpressionRgba(expr = 'spark', faceInsert = 'flat') {
  const S = 0.5; // half of 512x256
  const p = makeSoftPainter(256, 128);
  if (!GRAPHIC_EXPRESSIONS.has(expr)) return { w: p.w, h: p.h, data: p.data };

  const dark = [36, 24, 20];
  const cheek = [255, 107, 74];
  const eyeMm = faceInsert === 'vinyl' ? 6.0 : (faceInsert === 'flat' ? FACE_TARGET_MM.eyeHalfSpan : 5.8);
  const exL = (256 - eyeMm * 21.69) * S;
  const exR = (256 + eyeMm * 21.69) * S;
  const ey = (faceInsert === 'vinyl' ? 123 : (faceInsert === 'flat' ? 114 : 110)) * S;
  const browY = (faceInsert === 'vinyl' ? 36 : (faceInsert === 'flat' ? 48 : 44)) * S;

  // Eyebrows
  for (const bx of [exL, exR]) {
    p.strokeArc(bx, browY + 12, 19, Math.PI * 1.24, Math.PI * 1.76, 3.0, dark, 18);
  }
  // Cheek blushes
  p.fillCapsule(24, 84, 38, 84, 5.5, cheek);
  p.fillCapsule(218, 84, 232, 84, 5.5, cheek);

  // Eyes
  if (expr === 'happy') {
    for (const bx of [exL, exR]) p.strokeArc(bx, ey + 7, 17, Math.PI * 1.15, Math.PI * 1.85, 3.5, dark, 18);
  } else if (expr === 'wink') {
    p.fillEllipse(exL, ey, 17, 21, dark);
    p.strokeArc(exR, ey + 6, 16, Math.PI * 1.15, Math.PI * 1.85, 3.5, dark, 18);
  } else if (expr === 'cool') {
    p.fillEllipse(exL + 3, ey, 28, 19, dark);
    p.fillEllipse(exR - 3, ey, 28, 19, dark);
    p.fillCapsule(exL + 26, ey - 4, exR - 26, ey - 4, 2.8, dark);
  } else if (expr === 'starry') {
    for (const bx of [exL, exR]) {
      const pts = [];
      for (let k = 0; k < 10; k++) {
        const r = k % 2 === 0 ? 20 : 9.5;
        const a = -Math.PI * 0.5 + (k * Math.PI) / 5;
        pts.push([bx + Math.cos(a) * r, ey + Math.sin(a) * r]);
      }
      p.fillPoly(pts, dark);
    }
  } else if (expr === 'surprised') {
    p.fillEllipse(exL, ey, 18, 22, dark);
    p.fillEllipse(exR, ey, 18, 22, dark);
  } else {
    // spark / button
    const rx = faceInsert === 'vinyl' || expr === 'button' ? 24 : 17;
    const ry = faceInsert === 'vinyl' || expr === 'button' ? 27 : 21;
    p.fillEllipse(exL, ey, rx, ry, dark);
    p.fillEllipse(exR, ey, rx, ry, dark);
  }

  // Mouth
  if (expr === 'surprised') {
    p.strokeArc(128, 108, 10, 0, Math.PI * 2, 3.0, dark, 24);
  } else if (expr === 'happy') {
    p.strokeArc(128, 105, 13, 0.05 * Math.PI, 0.95 * Math.PI, 3.4, dark, 20);
    p.fillCapsule(115, 105, 141, 105, 3.2, dark);
  } else if (expr === 'cool') {
    p.fillCapsule(128, 114, 155, 108, 3.2, dark);
  } else if (expr !== 'button') {
    p.strokeArc(128, 96, 26, 0.25 * Math.PI, 0.75 * Math.PI, 3.2, dark, 20);
  }
  return { w: p.w, h: p.h, data: p.data };
}

/** Deterministic pure-JS shirt motif RGBA fallback (`256 x 256`) matching `kip-forge-sdk.js` shirt decals. */
export function renderFallbackShirtRgba(shirtId = 'spark_tee') {
  const S = 0.5; // half of 512x512
  const p = makeSoftPainter(256, 256);
  const white = [255, 255, 255];
  const coral = [255, 107, 74];
  const gold = [255, 184, 48];
  const slate = [32, 35, 42];
  const denim = [47, 85, 150];

  if (shirtId === 'spark_tee') {
    p.strokeArc(128, 5, 52, 0.12 * Math.PI, 0.88 * Math.PI, 5.0, white, 24);
    p.fillEllipse(128, 128, 52, 52, white);
    p.fillPoly([
      [276 * S, 172 * S], [204 * S, 264 * S], [252 * S, 264 * S],
      [230 * S, 342 * S], [310 * S, 246 * S], [260 * S, 246 * S],
    ], coral);
  } else if (shirtId === 'hoodie') {
    p.fillCapsule(128, 18, 128, 240, 3.5, slate);
    p.fillCapsule(99, 18, 93, 98, 3.5, white);
    p.fillCapsule(157, 18, 163, 98, 3.5, white);
    p.fillRoundRect(157, 63, 46, 32, 8, coral);
    p.fillRoundRect(46, 152, 164, 74, 19, denim);
  } else if (shirtId === 'varsity') {
    p.fillRoundRect(116, 12, 24, 224, 8, white);
    p.fillCapsule(53, 154, 73, 202, 4.0, white);
    p.fillCapsule(203, 154, 183, 202, 4.0, white);
    p.fillRoundRect(151, 57, 57, 64, 12, coral);
    p.fillCapsule(168, 72, 168, 106, 3.8, white);
    p.fillCapsule(168, 89, 192, 72, 3.6, white);
    p.fillCapsule(168, 89, 192, 106, 3.6, white);
  } else if (shirtId === 'overalls') {
    p.fillRoundRect(48, 6, 34, 92, 8, denim);
    p.fillRoundRect(174, 6, 34, 92, 8, denim);
    p.fillRoundRect(42, 79, 172, 160, 14, denim);
    p.fillEllipse(65, 97, 9, 9, gold);
    p.fillEllipse(191, 97, 9, 9, gold);
    p.fillRoundRect(87, 123, 82, 73, 11, gold);
  } else if (shirtId === 'stripe_tee') {
    for (let sy = 42; sy < 230; sy += 33) {
      p.fillRoundRect(22, sy, 212, 15, 7, white);
    }
    p.fillRoundRect(152, 84, 49, 54, 10, coral);
  } else if (shirtId === 'track_top') {
    p.fillRoundRect(64, 10, 15, 228, 6, white);
    p.fillRoundRect(84, 10, 15, 228, 6, coral);
    p.fillCapsule(128, 12, 128, 236, 3.5, slate);
    p.fillRoundRect(149, 72, 55, 41, 8, coral);
  } else {
    // Generic custom shirt fallback: Spark star emblem
    const pts = [];
    for (let k = 0; k < 10; k++) {
      const r = k % 2 === 0 ? 52 : 23;
      const a = -Math.PI * 0.5 + (k * Math.PI) / 5;
      pts.push([128 + Math.cos(a) * r, 124 + Math.sin(a) * r]);
    }
    p.fillPoly(pts, coral);
  }
  return { w: p.w, h: p.h, data: p.data };
}

// ---------------------------------------------------------------------------------------------
// 3. Raster -> Marching-Squares -> Voronoi-Walled Morphology -> Automatic Island Bridging
// ---------------------------------------------------------------------------------------------

function morphDilate(mask, cols, rows, radiusCells) {
  const r = Math.max(0, Math.ceil(radiusCells));
  if (r === 0) return new Uint8Array(mask);
  const r2 = radiusCells * radiusCells + 1e-6;
  const offsets = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= r2) offsets.push([dx, dy]);
    }
  }
  const out = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!mask[y * cols + x]) continue;
      for (let k = 0; k < offsets.length; k++) {
        const nx = x + offsets[k][0], ny = y + offsets[k][1];
        if (nx >= 0 && nx < cols && ny >= 0 && ny < rows) out[ny * cols + nx] = 1;
      }
    }
  }
  return out;
}

function morphErode(mask, cols, rows, radiusCells, outsideValue = 0) {
  const r = Math.max(0, Math.ceil(radiusCells));
  if (r === 0) return new Uint8Array(mask);
  const r2 = radiusCells * radiusCells + 1e-6;
  const offsets = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= r2) offsets.push([dx, dy]);
    }
  }
  const out = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let ok = 1;
      for (let k = 0; k < offsets.length; k++) {
        const nx = x + offsets[k][0], ny = y + offsets[k][1];
        const v = (nx >= 0 && nx < cols && ny >= 0 && ny < rows) ? mask[ny * cols + nx] : outsideValue;
        if (!v) { ok = 0; break; }
      }
      out[y * cols + x] = ok;
    }
  }
  return out;
}

function morphOpen(mask, cols, rows, radiusCells, outsideValue = 0) {
  return morphDilate(morphErode(mask, cols, rows, radiusCells, outsideValue), cols, rows, radiusCells);
}

function labelComponents4(mask, cols, rows) {
  const labels = new Int32Array(cols * rows);
  const sizes = [0];
  let nextLabel = 0;
  const queue = new Int32Array(cols * rows);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || labels[i]) continue;
    nextLabel++;
    let head = 0, tail = 0, count = 0;
    labels[i] = nextLabel;
    queue[tail++] = i;
    while (head < tail) {
      const cur = queue[head++];
      count++;
      const cx = cur % cols, cy = (cur - cx) / cols;
      if (cx > 0 && mask[cur - 1] && !labels[cur - 1]) { labels[cur - 1] = nextLabel; queue[tail++] = cur - 1; }
      if (cx + 1 < cols && mask[cur + 1] && !labels[cur + 1]) { labels[cur + 1] = nextLabel; queue[tail++] = cur + 1; }
      if (cy > 0 && mask[cur - cols] && !labels[cur - cols]) { labels[cur - cols] = nextLabel; queue[tail++] = cur - cols; }
      if (cy + 1 < rows && mask[cur + cols] && !labels[cur + cols]) { labels[cur + cols] = nextLabel; queue[tail++] = cur + cols; }
    }
    sizes.push(count);
  }
  return { labels, count: nextLabel, sizes };
}

function stampCapsule(mask, cols, rows, x0, y0, x1, y1, radiusCells, value = 1) {
  const pad = Math.ceil(radiusCells) + 1;
  const minX = Math.max(0, Math.floor(Math.min(x0, x1) - pad));
  const maxX = Math.min(cols - 1, Math.ceil(Math.max(x0, x1) + pad));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1) - pad));
  const maxY = Math.min(rows - 1, Math.ceil(Math.max(y0, y1) + pad));
  const vx = x1 - x0, vy = y1 - y0;
  const len2 = vx * vx + vy * vy;
  const r2 = radiusCells * radiusCells;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const t = len2 > 1e-9 ? clamp(((x - x0) * vx + (y - y0) * vy) / len2, 0, 1) : 0;
      const dx = x - (x0 + t * vx), dy = y - (y0 + t * vy);
      if (dx * dx + dy * dy <= r2) mask[y * cols + x] = value;
    }
  }
}

/**
 * Connect every enclosed solid island (`solid === 1` disconnected from the outer stencil perimeter)
 * to the main outer-connected solid component using straight `>= minBridgeMm` solid bars (§8.2).
 */
export function bridgeEnclosedSolidIslands(solid, cols, rows, stepMm, minBridgeMm = STENCIL_DEFAULTS.minBridgeMm) {
  const out = new Uint8Array(solid);
  const bridgeRadiusCells = Math.max(1.2, (minBridgeMm * 0.5) / stepMm);
  let bridgesAdded = 0;

  for (let iter = 0; iter < 32; iter++) {
    const { labels, count } = labelComponents4(out, cols, rows);
    if (count <= 1) break;

    // Identify the main component (largest component touching outer solid perimeter, or largest overall)
    const compSizes = new Int32Array(count + 1);
    for (let i = 0; i < labels.length; i++) {
      if (labels[i] > 0) compSizes[labels[i]]++;
    }
    let mainComp = 1;
    for (let c = 2; c <= count; c++) {
      if (compSizes[c] > compSizes[mainComp]) mainComp = c;
    }

    // Collect boundary cells of mainComp and of every island component
    const mainBoundary = [];
    const islandCells = new Map();
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const idx = y * cols + x;
        const lb = labels[idx];
        if (!lb) continue;
        const isBound = x === 0 || x === cols - 1 || y === 0 || y === rows - 1
          || !out[idx - 1] || !out[idx + 1] || !out[idx - cols] || !out[idx + cols];
        if (!isBound) continue;
        if (lb === mainComp) {
          mainBoundary.push([x, y]);
        } else {
          if (!islandCells.has(lb)) islandCells.set(lb, []);
          islandCells.get(lb).push([x, y]);
        }
      }
    }

    if (islandCells.size === 0 || mainBoundary.length === 0) break;

    // Bridge the island closest to mainComp first (so chained islands can daisy-chain naturally)
    let bestD2 = Infinity;
    let bestP = null, bestQ = null;
    for (const pts of islandCells.values()) {
      for (let i = 0; i < pts.length; i++) {
        const [ix, iy] = pts[i];
        for (let j = 0; j < mainBoundary.length; j++) {
          const [mx, my] = mainBoundary[j];
          const d2 = (ix - mx) * (ix - mx) + (iy - my) * (iy - my);
          if (d2 < bestD2) {
            bestD2 = d2;
            bestP = [ix, iy];
            bestQ = [mx, my];
          }
        }
      }
    }
    if (!bestP || !bestQ) break;
    stampCapsule(out, cols, rows, bestP[0], bestP[1], bestQ[0], bestQ[1], bridgeRadiusCells, 1);
    bridgesAdded++;
  }

  return { solid: out, bridgesAdded };
}

/**
 * Heal 2x2 checkerboard diagonal pinches so every vertex on the boundary of `solid` is strictly 2-manifold.
 */
function healManifoldPinches(solid, cols, rows) {
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 12) {
    changed = false;
    for (let y = 0; y < rows - 1; y++) {
      for (let x = 0; x < cols - 1; x++) {
        const i00 = y * cols + x;
        const i10 = i00 + 1;
        const i01 = i00 + cols;
        const i11 = i01 + 1;
        const s00 = solid[i00], s10 = solid[i10], s01 = solid[i01], s11 = solid[i11];
        if (s00 && s11 && !s10 && !s01) {
          solid[i10] = 1; solid[i01] = 1; changed = true;
        } else if (!s00 && !s11 && s10 && s01) {
          solid[i00] = 1; solid[i11] = 1; changed = true;
        }
      }
    }
  }
}

/**
 * Sample an RGBA decal buffer into a stencil aperture mask on the print-bed grid `[xMin..xMax] x [yMin..yMax]`,
 * trace marching-squares contours, thicken thin graphic strokes (`>= minApertureMm`) while preserving
 * Voronoi separator walls (`>= minWallMm`) between distinct motif components, and bridge any enclosed solid islands.
 *
 * Handedness note: because the stencil is printed planar-outer-face-down on `z = 0` and flipped `180°` around Y
 * onto the part (`x_viewer = -x_print`, `y_viewer = +y_print`), UV lookup maps `u = 0.5 + (-x_print) / windowW`,
 * `v = 0.5 - (y_print - windowCenterY) / windowH`.
 */
function traceRasterAperturesOnGrid({
  rgba,
  cols,
  rows,
  xMin,
  yMin,
  stepMm,
  windowW,
  windowH,
  windowCenterY = 0,
  allowedApertureMask,
  mode = 'shirt',
  skinHex = '#F3BA95',
  shirtHex = null,
  minApertureMm = STENCIL_DEFAULTS.minApertureMm,
  minWallMm = STENCIL_DEFAULTS.minWallMm,
}) {
  const skinRgb = skinHex ? hexToRgb(skinHex) : null;
  const baseRgb = shirtHex ? hexToRgb(shirtHex) : null;

  // 1. Sample scalar foreground field & RGB onto the grid so marchingSquaresContours runs at native grid resolution
  const scalar = new Float32Array(cols * rows);
  const gridR = new Uint8Array(cols * rows);
  const gridG = new Uint8Array(cols * rows);
  const gridB = new Uint8Array(cols * rows);

  if (rgba && rgba.w > 0 && rgba.h > 0 && rgba.data) {
    const { w, h, data } = rgba;
    for (let r = 0; r < rows; r++) {
      const yp = yMin + (r + 0.5) * stepMm;
      const v = 0.5 - (yp - windowCenterY) / windowH;
      if (v < 0 || v > 1) continue;
      const py = clamp(Math.floor(v * h), 0, h - 1);
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (!allowedApertureMask[idx]) continue;
        const xp = xMin + (c + 0.5) * stepMm;
        const u = 0.5 + (-xp) / windowW; // x_viewer = -x_print
        if (u < 0 || u > 1) continue;
        const px = clamp(Math.floor(u * w), 0, w - 1);
        const o = (py * w + px) * 4;
        const pr = data[o], pg = data[o + 1], pb = data[o + 2], pa = data[o + 3];
        if (pa < 70) continue;
        if (mode === 'shirt' && skinRgb && v < 0.20 && colorDist(pr, pg, pb, skinRgb[0], skinRgb[1], skinRgb[2]) < 32) {
          continue; // exclude top crew-neck skin cutout
        }
        if (mode === 'shirt' && baseRgb && colorDist(pr, pg, pb, baseRgb[0], baseRgb[1], baseRgb[2]) < 26) {
          continue;
        }
        scalar[idx] = pa / 255;
        gridR[idx] = pr; gridG[idx] = pg; gridB[idx] = pb;
      }
    }
  }

  // 2. For multi-colour shirt motifs (e.g. lightning bolt inside circle badge on `spark_tee`, `'K'` inside varsity patch),
  //    carve a 1-cell colour-edge separator across strong internal colour jumps (`ΔRGB >= 95`) so nested emblems
  //    become distinct components rather than merging into a featureless silhouette!
  if (mode === 'shirt') {
    const edgeCut = new Uint8Array(cols * rows);
    for (let r = 1; r < rows - 1; r++) {
      for (let c = 1; c < cols - 1; c++) {
        const idx = r * cols + c;
        if (scalar[idx] < 0.5) continue;
        for (const nb of [idx - 1, idx + 1, idx - cols, idx + cols]) {
          if (scalar[nb] >= 0.5) {
            const cd = colorDist(gridR[idx], gridG[idx], gridB[idx], gridR[nb], gridG[nb], gridB[nb]);
            if (cd >= 95) { edgeCut[idx] = 1; break; }
          }
        }
      }
    }
    for (let i = 0; i < scalar.length; i++) {
      if (edgeCut[i]) scalar[i] = 0;
    }
  }

  // 3. Trace sub-cell marching-squares contours on `scalar` (`level = 0.5`) and evaluate inside/outside mask
  const contours = marchingSquaresContours(scalar, cols, rows, {
    x0: xMin + 0.5 * stepMm,
    y0: yMin + 0.5 * stepMm,
    dx: stepMm,
    dy: stepMm,
    level: 0.5,
  });

  const rawMask = new Uint8Array(cols * rows);
  if (contours.length > 0) {
    for (let r = 0; r < rows; r++) {
      const wy = yMin + (r + 0.5) * stepMm;
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (!allowedApertureMask[idx]) continue;
        const wx = xMin + (c + 0.5) * stepMm;
        if (scalar[idx] >= 0.5 || pointInContoursEvenOdd(wx, wy, contours)) {
          rawMask[idx] = 1;
        }
      }
    }
  }

  // Drop tiny dust specks (< 2 cells) before stroke thickening
  const { labels: rawLabels, count: rawCompCount, sizes: rawSizes } = labelComponents4(rawMask, cols, rows);
  if (rawCompCount === 0) return { apertureMask: rawMask, contours };

  const compPixels = [];
  for (let lb = 1; lb <= rawCompCount; lb++) {
    if (rawSizes[lb] >= 2) compPixels.push([]);
  }
  const remap = new Int32Array(rawCompCount + 1);
  let activeComps = 0;
  for (let lb = 1; lb <= rawCompCount; lb++) {
    if (rawSizes[lb] >= 2) remap[lb] = ++activeComps;
  }
  if (activeComps === 0) return { apertureMask: new Uint8Array(cols * rows), contours };

  // 4. Component-preserving thickening + Voronoi wall reservation:
  //    Thin graphic strokes (eyebrows ~0.48 mm, smile ~0.55 mm, hoodie strings) dilate up to `dilateMm` so marker tips fit,
  //    while keeping `d2 - d1 >= minWallMm` between distinct components so neighbouring features NEVER merge!
  const dilateCells = Math.max(1.2, (minApertureMm * 0.56) / stepMm);
  const wallSepCells = (minWallMm * 0.96) / stepMm;
  const maxSearchR = Math.ceil(dilateCells + wallSepCells + 2);

  // Collect ONLY boundary seed cells per component for fast O(perimeter) distance queries
  const seeds = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const lb = remap[rawLabels[idx]];
      if (lb <= 0) continue;
      const isBnd = c === 0 || c === cols - 1 || r === 0 || r === rows - 1
        || remap[rawLabels[idx - 1]] !== lb
        || remap[rawLabels[idx + 1]] !== lb
        || remap[rawLabels[idx - cols]] !== lb
        || remap[rawLabels[idx + cols]] !== lb;
      if (isBnd) seeds.push([c, r, lb]);
    }
  }

  // Bucket boundary seeds into coarse spatial bins of size `bucketSize`
  const bucketSize = Math.max(4, maxSearchR);
  const bCols = Math.ceil(cols / bucketSize);
  const bRows = Math.ceil(rows / bucketSize);
  const buckets = Array.from({ length: bCols * bRows }, () => []);
  for (let i = 0; i < seeds.length; i++) {
    const bx = Math.floor(seeds[i][0] / bucketSize);
    const by = Math.floor(seeds[i][1] / bucketSize);
    buckets[by * bCols + bx].push(seeds[i]);
  }

  const grown = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    const by = Math.floor(r / bucketSize);
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (!allowedApertureMask[idx]) continue;
      const insideLb = remap[rawLabels[idx]];
      const bx = Math.floor(c / bucketSize);

      let d1 = insideLb > 0 ? 0 : Infinity;
      let lb1 = insideLb;
      let d2 = Infinity;
      for (let nby = Math.max(0, by - 1); nby <= Math.min(bRows - 1, by + 1); nby++) {
        for (let nbx = Math.max(0, bx - 1); nbx <= Math.min(bCols - 1, bx + 1); nbx++) {
          const list = buckets[nby * bCols + nbx];
          for (let k = 0; k < list.length; k++) {
            const [sx, sy, slb] = list[k];
            if (insideLb > 0 && slb === insideLb) continue;
            const dx = c - sx, dy = r - sy;
            if (Math.abs(dx) > maxSearchR || Math.abs(dy) > maxSearchR) continue;
            const d = Math.hypot(dx, dy);
            if (slb === lb1) {
              if (d < d1) d1 = d;
            } else if (d < d1) {
              d2 = d1;
              d1 = d;
              lb1 = slb;
            } else if (d < d2) {
              d2 = d;
            }
          }
        }
      }

      if (lb1 > 0 && d1 <= dilateCells && (d2 - d1) >= wallSepCells) {
        grown[idx] = 1;
      }
    }
  }

  // 5. Morphological opening on apertures (`>= minApertureMm`) so no narrow pinhole or sharp tip remains
  const openR = Math.max(1.0, (minApertureMm * 0.45) / stepMm);
  const opened = morphOpen(grown, cols, rows, openR, 0);
  for (let i = 0; i < opened.length; i++) {
    if (!allowedApertureMask[i]) opened[i] = 0;
  }

  return { apertureMask: opened, contours };
}

// ---------------------------------------------------------------------------------------------
// 4. Watertight, Zero-Support Heightfield Mesh Builder (`buildHeightfieldStencilTri`)
// ---------------------------------------------------------------------------------------------

/**
 * Convert a 2D solid mask `solid[r * cols + c]` (`1` = plastic, `0` = air/aperture) and per-corner height
 * callback `heightAt(xMm, yMm) >= minFloorMm` into a 100% closed, 2-manifold, outward-oriented triangle soup
 * (`Float32Array`) with a planar `z = 0` outer face on the bed and upward-facing (`+z`) conformal cavity.
 *
 * Includes optional signed-distance boundary snapping + tangent smoothing on lattice corners `(ix, iy)`,
 * strictly guarded so every quad keeps positive 2D Jacobian area (zero self-intersections, zero T-junctions,
 * `0.00 mm^2` downward overhang).
 */
export function buildHeightfieldStencilTri({
  solid,
  cols,
  rows,
  xMin,
  yMin,
  stepMm,
  heightAt,
  boundarySdf = null,
  smoothPasses = 3,
}) {
  const work = new Uint8Array(solid);
  healManifoldPinches(work, cols, rows);

  const vCols = cols + 1;
  const vRows = rows + 1;
  const vx = new Float64Array(vCols * vRows);
  const vy = new Float64Array(vCols * vRows);
  for (let iy = 0; iy < vRows; iy++) {
    const y = yMin + iy * stepMm;
    for (let ix = 0; ix < vCols; ix++) {
      const vIdx = iy * vCols + ix;
      vx[vIdx] = xMin + ix * stepMm;
      vy[vIdx] = y;
    }
  }

  const cellAt = (cx, cy) => (cx >= 0 && cx < cols && cy >= 0 && cy < rows) ? work[cy * cols + cx] : 0;

  // Build boundary vertex adjacency along directed cell edges (`solid` on left, `empty` on right)
  const prevV = new Int32Array(vCols * vRows).fill(-1);
  const nextV = new Int32Array(vCols * vRows).fill(-1);
  const isBoundaryV = new Uint8Array(vCols * vRows);

  const addDirEdge = (u, v) => {
    isBoundaryV[u] = 1;
    isBoundaryV[v] = 1;
    nextV[u] = v;
    prevV[v] = u;
  };

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      if (!work[cy * cols + cx]) continue;
      const c00 = cy * vCols + cx;
      const c10 = c00 + 1;
      const c01 = c00 + vCols;
      const c11 = c01 + 1;
      if (!cellAt(cx, cy - 1)) addDirEdge(c00, c10);
      if (!cellAt(cx + 1, cy)) addDirEdge(c10, c11);
      if (!cellAt(cx, cy + 1)) addDirEdge(c11, c01);
      if (!cellAt(cx - 1, cy)) addDirEdge(c01, c00);
    }
  }

  const minTriArea = 0.04 * stepMm * stepMm;
  const triArea2 = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

  const cellQuadsValidAround = (ix, iy, candX, candY) => {
    const ox = vx[iy * vCols + ix], oy = vy[iy * vCols + ix];
    vx[iy * vCols + ix] = candX;
    vy[iy * vCols + ix] = candY;
    let ok = true;
    for (let cy = Math.max(0, iy - 1); cy <= Math.min(rows - 1, iy) && ok; cy++) {
      for (let cx = Math.max(0, ix - 1); cx <= Math.min(cols - 1, ix) && ok; cx++) {
        const c00 = cy * vCols + cx;
        const c10 = c00 + 1;
        const c01 = c00 + vCols;
        const c11 = c01 + 1;
        const x00 = vx[c00], y00 = vy[c00];
        const x10 = vx[c10], y10 = vy[c10];
        const x11 = vx[c11], y11 = vy[c11];
        const x01 = vx[c01], y01 = vy[c01];
        // Check all 4 possible triangulations of the quad so both diagonals stay strictly convex
        if (
          triArea2(x00, y00, x10, y10, x11, y11) < minTriArea * 2
          || triArea2(x00, y00, x11, y11, x01, y01) < minTriArea * 2
          || triArea2(x00, y00, x10, y10, x01, y01) < minTriArea * 2
          || triArea2(x10, y10, x11, y11, x01, y01) < minTriArea * 2
        ) {
          ok = false;
        }
      }
    }
    vx[iy * vCols + ix] = ox;
    vy[iy * vCols + ix] = oy;
    return ok;
  };

  // Optional analytical SDF snap on outer/hole boundaries (e.g. exact Ø6.84 mm crown holes & R6.0 saddle corners)
  if (typeof boundarySdf === 'function') {
    const eps = 1e-3;
    const maxSnap = 0.68 * stepMm;
    for (let iy = 0; iy < vRows; iy++) {
      for (let ix = 0; ix < vCols; ix++) {
        const idx = iy * vCols + ix;
        if (!isBoundaryV[idx]) continue;
        const x = vx[idx], y = vy[idx];
        const d = boundarySdf(x, y);
        if (!Number.isFinite(d) || Math.abs(d) > stepMm * 0.95) continue;
        const gx = (boundarySdf(x + eps, y) - boundarySdf(x - eps, y)) / (2 * eps);
        const gy = (boundarySdf(x, y + eps) - boundarySdf(x, y - eps)) / (2 * eps);
        const gLen = Math.hypot(gx, gy);
        if (gLen < 1e-6) continue;
        const shift = clamp(-d / gLen, -maxSnap, maxSnap);
        const nx = x + (gx / gLen) * shift;
        const ny = y + (gy / gLen) * shift;
        if (cellQuadsValidAround(ix, iy, nx, ny)) {
          vx[idx] = nx;
          vy[idx] = ny;
        }
      }
    }
  }

  // Area-guarded Taubin (lambda / mu) smoothing along boundary curves so staircase jaggies disappear without shrinkage
  const weights = [0.42, -0.44];
  for (let pass = 0; pass < smoothPasses; pass++) {
    for (const w of weights) {
      const nextX = new Float64Array(vx);
      const nextY = new Float64Array(vy);
      for (let iy = 0; iy < vRows; iy++) {
        for (let ix = 0; ix < vCols; ix++) {
          const idx = iy * vCols + ix;
          if (!isBoundaryV[idx]) continue;
          const p = prevV[idx], n = nextV[idx];
          if (p < 0 || n < 0) continue;
          const mx = 0.5 * (vx[p] + vx[n]);
          const my = 0.5 * (vy[p] + vy[n]);
          let cx = vx[idx] + w * (mx - vx[idx]);
          let cy = vy[idx] + w * (my - vy[idx]);
          if (typeof boundarySdf === 'function') {
            const d = boundarySdf(cx, cy);
            if (Number.isFinite(d) && Math.abs(d) < stepMm * 0.65) {
              const eps = 1e-3;
              const gx = (boundarySdf(cx + eps, cy) - boundarySdf(cx - eps, cy)) / (2 * eps);
              const gy = (boundarySdf(cx, cy + eps) - boundarySdf(cx, cy - eps)) / (2 * eps);
              const gLen = Math.hypot(gx, gy);
              if (gLen > 1e-6) {
                const s = clamp(-d / gLen, -0.25 * stepMm, 0.25 * stepMm);
                cx += (gx / gLen) * s;
                cy += (gy / gLen) * s;
              }
            }
          }
          nextX[idx] = cx;
          nextY[idx] = cy;
        }
      }
      for (let iy = 0; iy < vRows; iy++) {
        for (let ix = 0; ix < vCols; ix++) {
          const idx = iy * vCols + ix;
          if (!isBoundaryV[idx]) continue;
          const baseX = xMin + ix * stepMm;
          const baseY = yMin + iy * stepMm;
          if (Math.hypot(nextX[idx] - baseX, nextY[idx] - baseY) <= 0.68 * stepMm) {
            if (cellQuadsValidAround(ix, iy, nextX[idx], nextY[idx])) {
              vx[idx] = nextX[idx];
              vy[idx] = nextY[idx];
            }
          }
        }
      }
    }
  }

  // Evaluate top Z height at every lattice corner (shared across top faces & vertical walls -> zero T-junctions!)
  const vz = new Float64Array(vCols * vRows);
  for (let i = 0; i < vz.length; i++) {
    vz[i] = Math.max(0.4, heightAt(vx[i], vy[i]));
  }

  // Count triangles first so we allocate a single exact Float32Array
  let solidCells = 0;
  let wallQuads = 0;
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      if (!work[cy * cols + cx]) continue;
      solidCells++;
      if (!cellAt(cx, cy - 1)) wallQuads++;
      if (!cellAt(cx + 1, cy)) wallQuads++;
      if (!cellAt(cx, cy + 1)) wallQuads++;
      if (!cellAt(cx - 1, cy)) wallQuads++;
    }
  }

  const totalTris = solidCells * 4 + wallQuads * 2;
  const tri = new Float32Array(totalTris * 9);
  let ptr = 0;
  const pushTri = (ax, ay, az, bx, by, bz, cx, cy, cz) => {
    tri[ptr++] = ax; tri[ptr++] = ay; tri[ptr++] = az;
    tri[ptr++] = bx; tri[ptr++] = by; tri[ptr++] = bz;
    tri[ptr++] = cx; tri[ptr++] = cy; tri[ptr++] = cz;
  };

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      if (!work[cy * cols + cx]) continue;
      const c00 = cy * vCols + cx;
      const c10 = c00 + 1;
      const c01 = c00 + vCols;
      const c11 = c01 + 1;

      const x00 = vx[c00], y00 = vy[c00], z00 = vz[c00];
      const x10 = vx[c10], y10 = vy[c10], z10 = vz[c10];
      const x11 = vx[c11], y11 = vy[c11], z11 = vz[c11];
      const x01 = vx[c01], y01 = vy[c01], z01 = vz[c01];

      // Bottom face at z = 0 (outward normal = -Z -> CW when viewed from +Z)
      pushTri(x00, y00, 0, x01, y01, 0, x11, y11, 0);
      pushTri(x00, y00, 0, x11, y11, 0, x10, y10, 0);

      // Top face at z = zTop (outward normal = +Z -> CCW when viewed from +Z)
      pushTri(x00, y00, z00, x10, y10, z10, x11, y11, z11);
      pushTri(x00, y00, z00, x11, y11, z11, x01, y01, z01);

      // Vertical boundary walls (CCW when viewed from outside the solid)
      if (!cellAt(cx, cy - 1)) {
        pushTri(x00, y00, 0, x10, y10, 0, x10, y10, z10);
        pushTri(x00, y00, 0, x10, y10, z10, x00, y00, z00);
      }
      if (!cellAt(cx + 1, cy)) {
        pushTri(x10, y10, 0, x11, y11, 0, x11, y11, z11);
        pushTri(x10, y10, 0, x11, y11, z11, x10, y10, z10);
      }
      if (!cellAt(cx, cy + 1)) {
        pushTri(x11, y11, 0, x01, y01, 0, x01, y01, z01);
        pushTri(x11, y11, 0, x01, y01, z01, x11, y11, z11);
      }
      if (!cellAt(cx - 1, cy)) {
        pushTri(x01, y01, 0, x00, y00, 0, x00, y00, z00);
        pushTri(x01, y01, 0, x00, y00, z00, x01, y01, z01);
      }
    }
  }

  return tri;
}

// ---------------------------------------------------------------------------------------------
// 5. STL Surface Heightfield Sampler (Ray-Casts Real Faceplate & Torso STLs)
// ---------------------------------------------------------------------------------------------

function buildRayCastHeightGrid(tri, {
  xMin,
  xMax,
  yMin,
  yMax,
  cols,
  rows,
  mode = 'faceplate',
}) {
  if (!tri || tri.length < 9) return null;
  const nTri = Math.floor(tri.length / 9);
  const proj = new Float32Array(nTri * 9);
  const bMinX = new Float32Array(nTri);
  const bMaxX = new Float32Array(nTri);
  const bMinY = new Float32Array(nTri);
  const bMaxY = new Float32Array(nTri);

  for (let i = 0; i < nTri; i++) {
    const o = i * 9;
    for (let v = 0; v < 3; v++) {
      const k = o + v * 3;
      const sx = tri[k], sy = tri[k + 1], sz = tri[k + 2];
      if (mode === 'faceplate') {
        // Print-bed x_print = -x_viewer = +sx; y_print = zb = sz; front relief = +sy
        proj[k] = sx;
        proj[k + 1] = sz;
        proj[k + 2] = sy;
      } else {
        // Print-bed x_print = -x_viewer = -sx; y_print = sz; front chest relief = -sy
        proj[k] = -sx;
        proj[k + 1] = sz;
        proj[k + 2] = -sy;
      }
    }
    bMinX[i] = Math.min(proj[o], proj[o + 3], proj[o + 6]);
    bMaxX[i] = Math.max(proj[o], proj[o + 3], proj[o + 6]);
    bMinY[i] = Math.min(proj[o + 1], proj[o + 4], proj[o + 7]);
    bMaxY[i] = Math.max(proj[o + 1], proj[o + 4], proj[o + 7]);
  }

  const grid = new Float64Array(cols * rows);
  grid.fill(Number.NaN);
  let maxZ = -Infinity, minZ = Infinity;

  const invSpanX = cols > 1 ? (cols - 1) / Math.max(1e-6, xMax - xMin) : 0;
  const invSpanY = rows > 1 ? (rows - 1) / Math.max(1e-6, yMax - yMin) : 0;
  const stepX = cols > 1 ? (xMax - xMin) / (cols - 1) : 0;
  const stepY = rows > 1 ? (yMax - yMin) / (rows - 1) : 0;

  // Rasterize each triangle over its overlapping `[c0..c1] x [r0..r1]` grid window in O(nTri + cols*rows)
  for (let i = 0; i < nTri; i++) {
    if (bMaxX[i] < xMin - 1e-5 || bMinX[i] > xMax + 1e-5 || bMaxY[i] < yMin - 1e-5 || bMinY[i] > yMax + 1e-5) continue;
    const o = i * 9;
    const az = proj[o + 2], bz = proj[o + 5], cz = proj[o + 8];
    if (az <= 0 && bz <= 0 && cz <= 0) continue;
    const ax = proj[o], ay = proj[o + 1];
    const bx = proj[o + 3], by = proj[o + 4];
    const cx = proj[o + 6], cy = proj[o + 7];
    const v0x = cx - ax, v0y = cy - ay;
    const v1x = bx - ax, v1y = by - ay;
    const denom = v0x * v1y - v1x * v0y;
    if (Math.abs(denom) < 1e-10) continue;
    const inv = 1 / denom;

    const c0 = Math.max(0, Math.floor((bMinX[i] - xMin) * invSpanX - 1e-5));
    const c1 = Math.min(cols - 1, Math.ceil((bMaxX[i] - xMin) * invSpanX + 1e-5));
    const r0 = Math.max(0, Math.floor((bMinY[i] - yMin) * invSpanY - 1e-5));
    const r1 = Math.min(rows - 1, Math.ceil((bMaxY[i] - yMin) * invSpanY + 1e-5));

    for (let r = r0; r <= r1; r++) {
      const ry = yMin + r * stepY;
      const v2y = ry - ay;
      for (let c = c0; c <= c1; c++) {
        const rx = xMin + c * stepX;
        const v2x = rx - ax;
        const bu = (v2x * v1y - v1x * v2y) * inv;
        const bv = (v0x * v2y - v2x * v0y) * inv;
        if (bu >= -1e-5 && bv >= -1e-5 && bu + bv <= 1 + 1e-5) {
          const z = az + bu * (cz - az) + bv * (bz - az);
          if (z > 0) {
            const idx = r * cols + c;
            if (Number.isNaN(grid[idx]) || z > grid[idx]) {
              grid[idx] = z;
              if (z > maxZ) maxZ = z;
              if (z < minZ) minZ = z;
            }
          }
        }
      }
    }
  }
  if (!Number.isFinite(maxZ)) return null;

  // Fill exterior NaN cells iteratively by nearest-neighbour diffusion so rim skirts blend smoothly
  const filled = new Float64Array(grid);
  for (let pass = 0; pass < Math.max(cols, rows); pass++) {
    let anyNan = false;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (!Number.isNaN(filled[idx])) continue;
        let sum = 0, cnt = 0;
        if (c > 0 && !Number.isNaN(filled[idx - 1])) { sum += filled[idx - 1]; cnt++; }
        if (c + 1 < cols && !Number.isNaN(filled[idx + 1])) { sum += filled[idx + 1]; cnt++; }
        if (r > 0 && !Number.isNaN(filled[idx - cols])) { sum += filled[idx - cols]; cnt++; }
        if (r + 1 < rows && !Number.isNaN(filled[idx + cols])) { sum += filled[idx + cols]; cnt++; }
        if (cnt > 0) filled[idx] = sum / cnt;
        else anyNan = true;
      }
    }
    if (!anyNan) break;
  }

  const sample = (x, y) => {
    const u = clamp((x - xMin) / Math.max(1e-6, xMax - xMin), 0, 1) * (cols - 1);
    const v = clamp((y - yMin) / Math.max(1e-6, yMax - yMin), 0, 1) * (rows - 1);
    const c0 = Math.min(cols - 2, Math.floor(u)), r0 = Math.min(rows - 2, Math.floor(v));
    const fu = u - c0, fv = v - r0;
    const z00 = filled[r0 * cols + c0];
    const z10 = filled[r0 * cols + c0 + 1];
    const z01 = filled[(r0 + 1) * cols + c0];
    const z11 = filled[(r0 + 1) * cols + c0 + 1];
    return (1 - fv) * ((1 - fu) * z00 + fu * z10) + fv * ((1 - fu) * z01 + fu * z11);
  };

  return { sample, maxZ, minZ };
}

function normalizeTriToOrigin(tri) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < tri.length; i += 3) {
    const x = tri[i], y = tri[i + 1], z = tri[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const out = new Float32Array(tri.length);
  for (let i = 0; i < tri.length; i += 3) {
    out[i] = tri[i] - minX;
    out[i + 1] = tri[i + 1] - minY;
    out[i + 2] = tri[i + 2] - minZ;
  }
  return {
    tri: out,
    w: +(maxX - minX).toFixed(3),
    h: +(maxY - minY).toFixed(3),
    dz: +(maxZ - minZ).toFixed(3),
  };
}

// ---------------------------------------------------------------------------------------------
// 6. The Three Stencil Builders (§8.2)
// ---------------------------------------------------------------------------------------------

const PLATE_SDF_STATIONS = (() => {
  const n = 64;
  const zs = new Float64Array(n + 1);
  const hws = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const sz = (PLATE_TOP_ZB * i) / n;
    zs[i] = sz;
    hws[i] = plateHalfWidth(sz);
  }
  return { n, zs, hws, botHw: hws[0], topHw: hws[n] };
})();

function plateSignedDistance(x, zb) {
  // Fast O(1)-table 2D Euclidean signed distance to the `plateHalfWidth(zb)` contour (`<= 0` inside plate)
  const { n, zs, hws, botHw, topHw } = PLATE_SDF_STATIONS;
  let minD2 = Infinity;
  const ax = Math.abs(x);
  for (let i = 0; i <= n; i++) {
    const dx = ax - hws[i], dy = zb - zs[i];
    const d2 = dx * dx + dy * dy;
    if (d2 < minD2) minD2 = d2;
  }
  if (ax <= botHw) {
    const d0 = zb * zb;
    if (d0 < minD2) minD2 = d0;
  }
  if (ax <= topHw) {
    const d1 = (zb - PLATE_TOP_ZB) * (zb - PLATE_TOP_ZB);
    if (d1 < minD2) minD2 = d1;
  }

  let inside = false;
  if (zb >= 0 && zb <= PLATE_TOP_ZB) {
    const pos = (zb / PLATE_TOP_ZB) * n;
    const i0 = Math.min(n - 1, Math.floor(pos));
    const frac = pos - i0;
    const hw = hws[i0] + (hws[i0 + 1] - hws[i0]) * frac;
    inside = ax <= hw;
  }
  const d = Math.sqrt(minD2);
  return inside ? -d : d;
}

/**
 * 1) Universal Human Faceplate Stencil (`stencil_face_<expr>`, §8.2):
 *    - Planar outer marker face on `z = 0`, upward-facing conformal cavity (`0.06 mm` clearance) + `1.25 mm` rim skirt.
 *    - Used with the removable faceplate out of the head.
 *    - Includes local pocket clearance over the moulded smile ridge (`zb ≈ 0.85..1.35`) and sculpted nose / vinyl domes.
 */
export function buildFaceStencilMesh({
  expr = 'spark',
  faceInsert = 'flat',
  faceplateTri = null,
  renderedRgba = null,
  opts = {},
} = {}) {
  const cfg = { ...STENCIL_DEFAULTS, ...opts };
  const safeExpr = GRAPHIC_EXPRESSIONS.has(expr) ? expr : 'spark';
  const stepMm = cfg.gridStepMm;
  const outerOffset = cfg.faceRimSlipMm + cfg.faceSkirtWallMm;

  const halfSpanX = PLATE_MM.w * 0.5 + outerOffset + stepMm * 2;
  const yMin = -outerOffset - stepMm * 2;
  const yMax = PLATE_TOP_ZB + outerOffset + stepMm * 2;
  const cols = Math.ceil((halfSpanX * 2) / stepMm);
  const rows = Math.ceil((yMax - yMin) / stepMm);
  const xMin = -0.5 * cols * stepMm;

  // Precompute plate SDF on the cell grid so outer skirt, inner pocket, and safe aperture lip are exact
  const plateSdfGrid = new Float32Array(cols * rows);
  const outerMask = new Uint8Array(cols * rows);
  const allowedAperture = new Uint8Array(cols * rows);
  const lipInset = cfg.minWallMm + 0.15;

  for (let r = 0; r < rows; r++) {
    const zb = yMin + (r + 0.5) * stepMm;
    for (let c = 0; c < cols; c++) {
      const xp = xMin + (c + 0.5) * stepMm;
      const idx = r * cols + c;
      const dPlate = plateSignedDistance(xp, zb);
      plateSdfGrid[idx] = dPlate;
      if (dPlate <= outerOffset) outerMask[idx] = 1;

      // Safe aperture zone: inside windowHalfWidth(zb) minus `lipInset`, and outside sculpted 3D nose prism
      if (zb >= WINDOW_ZB.min + lipInset && zb <= WINDOW_ZB.max - lipInset) {
        const whw = windowHalfWidth(zb) - lipInset;
        if (Math.abs(xp) <= whw) {
          const inSculptedNose = faceInsert !== 'flat' && Math.abs(xp) <= 2.35 && zb >= 1.9 && zb <= 9.6;
          if (!inSculptedNose) allowedAperture[idx] = 1;
        }
      }
    }
  }

  const rgba = renderedRgba || renderFallbackExpressionRgba(safeExpr, faceInsert);
  const windowCenterY = 0.5 * (WINDOW_ZB.min + WINDOW_ZB.max);
  const { apertureMask, contours } = traceRasterAperturesOnGrid({
    rgba,
    cols,
    rows,
    xMin,
    yMin,
    stepMm,
    windowW: faceInsert === 'flat' && safeExpr === 'selfie' ? WINDOW_MM.w : 23.6,
    windowH: 10.1,
    windowCenterY: 5.25,
    allowedApertureMask: allowedAperture,
    mode: 'face',
    minApertureMm: cfg.minApertureMm,
    minWallMm: cfg.minWallMm,
  });
  void windowCenterY;

  // Subtract apertures from outer solid body, enforce min solid wall opening, then bridge any enclosed solid islands
  const rawSolid = new Uint8Array(cols * rows);
  for (let i = 0; i < rawSolid.length; i++) {
    if (outerMask[i] && !apertureMask[i]) rawSolid[i] = 1;
  }
  const cleanedSolid = morphOpen(rawSolid, cols, rows, Math.max(1.0, (cfg.minWallMm * 0.42) / stepMm), 0);
  // Restore full outer rim skirt so perimeter wall thickness stays >= 1.25 mm everywhere
  for (let i = 0; i < cleanedSolid.length; i++) {
    if (plateSdfGrid[i] > -cfg.minWallMm && plateSdfGrid[i] <= outerOffset) cleanedSolid[i] = 1;
  }
  const { solid, bridgesAdded } = bridgeEnclosedSolidIslands(cleanedSolid, cols, rows, stepMm, cfg.minBridgeMm);

  // Conformal ray-cast surface heightfield from faceplate STL (or smooth barrel-arch fallback)
  const rayGrid = buildRayCastHeightGrid(faceplateTri, {
    xMin: -PLATE_MM.w * 0.5,
    xMax: PLATE_MM.w * 0.5,
    yMin: 0,
    yMax: PLATE_TOP_ZB,
    cols: 65,
    rows: 41,
    mode: 'faceplate',
  });

  const peakFrontZ = rayGrid ? rayGrid.maxZ : 5.17;
  const fallbackFrontZ = (xp, zb) => {
    const nx = xp / 12.1;
    const ny = (zb - 6.2) / 6.6;
    return 5.17 - 3.15 * nx * nx - 0.35 * ny * ny;
  };

  // Extra pocket clearance over the moulded smile ridge (`zb = 0.85 + 0.50 * (x/2.5)^2`) and nose prism
  const localReliefPocket = (xp, zb) => {
    let extra = 0;
    if (Math.abs(xp) <= 2.9) {
      const t = clamp(xp / 2.5, -1, 1);
      const ridgeZb = 0.85 + 0.50 * t * t;
      const dy = Math.abs(zb - ridgeZb);
      if (dy < 0.85) extra = Math.max(extra, 0.22 * (1 - dy / 0.85));
    }
    if (faceInsert !== 'flat' && Math.abs(xp) <= 2.2 && zb >= 2.0 && zb <= 9.5) {
      extra = Math.max(extra, 0.14);
    }
    return extra;
  };

  const rimEdgeCavityZ = cfg.minFloorMm + (peakFrontZ - 1.75) + cfg.faceClearanceMm;
  const skirtTopZ = rimEdgeCavityZ + cfg.faceSkirtRiseMm;

  const heightAt = (xp, zb) => {
    const dPlate = plateSignedDistance(xp, zb);
    const frontZ = rayGrid ? rayGrid.sample(xp, zb) : fallbackFrontZ(xp, zb);
    const cavityZ = cfg.minFloorMm + Math.max(0, peakFrontZ - frontZ) + cfg.faceClearanceMm + localReliefPocket(xp, zb);
    if (dPlate <= cfg.faceRimSlipMm) return cavityZ;
    // Smooth 45° upward lead-in ramp into the outer 1.25 mm indexing skirt (`nz >= 0`, zero overhang!)
    const rampT = clamp((dPlate - cfg.faceRimSlipMm) / 0.45, 0, 1);
    return Math.max(cavityZ, cavityZ * (1 - rampT) + skirtTopZ * rampT);
  };

  const outerSdfOnly = (xp, zb) => {
    const d = plateSignedDistance(xp, zb) - outerOffset;
    return Math.abs(d) < stepMm * 1.1 ? d : Number.NaN;
  };

  const rawTri = buildHeightfieldStencilTri({
    solid,
    cols,
    rows,
    xMin,
    yMin,
    stepMm,
    heightAt,
    boundarySdf: outerSdfOnly,
    smoothPasses: 3,
  });

  const norm = normalizeTriToOrigin(rawTri);
  return {
    id: `stencil_face_${safeExpr}`,
    kind: 'face',
    label: `Face Stencil (${safeExpr}, ${faceInsert})`,
    ...norm,
    bridgesAdded,
    contourCount: contours.length,
  };
}

/**
 * 2) Conformal Chest Motif Stencil (`stencil_shirt_<id>`, §8.2):
 *    - Planar outer marker face on `z = 0`, upward-facing barrel-chest cavity ray-cast from `torso.stl` / `snap_torso.stl`.
 *    - Extends `+-13.6 mm` across the curved torso flanks (`~5.4 mm` deep C-saddle rib wrap) + shoulder taper for
 *      repeatable self-centering registration without a collar feature and with `0.00 mm^2` overhang.
 *    - Apertures traced from the shirt raster via `marchingSquaresContours` + automatic island bridging.
 */
export function buildShirtStencilMesh({
  shirtId = 'spark_tee',
  edition = 'pro',
  torsoTri = null,
  shirtHex = null,
  skinHex = '#F3BA95',
  renderedRgba = null,
  opts = {},
} = {}) {
  const cfg = { ...STENCIL_DEFAULTS, ...opts };
  const safeId = String(shirtId || 'spark_tee').replace(/[^a-zA-Z0-9_-]/g, '_');
  const stepMm = cfg.gridStepMm;

  const halfW = cfg.shirtTotalWmm * 0.5;
  const halfH = cfg.shirtTotalHmm * 0.5;
  const yCenter = cfg.shirtCenterZmm;

  const cols = Math.ceil((cfg.shirtTotalWmm + stepMm * 4) / stepMm);
  const rows = Math.ceil((cfg.shirtTotalHmm + stepMm * 4) / stepMm);
  const xMin = -0.5 * cols * stepMm;
  const yMin = yCenter - 0.5 * rows * stepMm;

  const outerMask = new Uint8Array(cols * rows);
  const allowedAperture = new Uint8Array(cols * rows);
  const apHalfW = cfg.shirtWindowWmm * 0.5 - 0.4;
  const apHalfH = cfg.shirtWindowHmm * 0.5 - 0.6;

  for (let r = 0; r < rows; r++) {
    const yp = yMin + (r + 0.5) * stepMm;
    for (let c = 0; c < cols; c++) {
      const xp = xMin + (c + 0.5) * stepMm;
      const idx = r * cols + c;
      if (roundedRectSdf(xp, yp - yCenter, halfW, halfH, cfg.shirtCornerRmm) <= 0) {
        outerMask[idx] = 1;
      }
      if (roundedRectSdf(xp, yp - yCenter, apHalfW, apHalfH, 1.8) <= 0) {
        allowedAperture[idx] = 1;
      }
    }
  }

  const rgba = renderedRgba || renderFallbackShirtRgba(safeId);
  const { apertureMask, contours } = traceRasterAperturesOnGrid({
    rgba,
    cols,
    rows,
    xMin,
    yMin,
    stepMm,
    windowW: cfg.shirtWindowWmm,
    windowH: cfg.shirtWindowHmm,
    windowCenterY: yCenter,
    allowedApertureMask: allowedAperture,
    mode: 'shirt',
    skinHex,
    shirtHex,
    minApertureMm: cfg.minApertureMm,
    minWallMm: cfg.minWallMm,
  });

  const rawSolid = new Uint8Array(cols * rows);
  for (let i = 0; i < rawSolid.length; i++) {
    if (outerMask[i] && !apertureMask[i]) rawSolid[i] = 1;
  }
  const cleanedSolid = morphOpen(rawSolid, cols, rows, Math.max(1.0, (cfg.minWallMm * 0.42) / stepMm), 0);
  // Keep side C-arm rib-indexing wings (`|x| >= halfW - 2.6 mm`) 100% solid for structural strength
  for (let r = 0; r < rows; r++) {
    const yp = yMin + (r + 0.5) * stepMm;
    for (let c = 0; c < cols; c++) {
      const xp = xMin + (c + 0.5) * stepMm;
      const idx = r * cols + c;
      if (outerMask[idx] && (Math.abs(xp) >= halfW - 2.6 || Math.abs(yp - yCenter) >= halfH - 1.5)) {
        cleanedSolid[idx] = 1;
      }
    }
  }
  const { solid, bridgesAdded } = bridgeEnclosedSolidIslands(cleanedSolid, cols, rows, stepMm, cfg.minBridgeMm);

  const rayGrid = buildRayCastHeightGrid(torsoTri, {
    xMin: -halfW,
    xMax: halfW,
    yMin: yCenter - halfH,
    yMax: yCenter + halfH,
    cols: 61,
    rows: 57,
    mode: 'torso',
  });

  const peakChestZ = rayGrid ? rayGrid.maxZ : (edition === 'snap' ? 12.92 : 12.45);
  const fallbackChestZ = (xp, yp) => {
    const base = edition === 'snap' ? 12.92 : 12.45;
    const kX = edition === 'snap' ? 0.0272 : 0.0308;
    const dy = yp - yCenter;
    return base - kX * xp * xp - 0.0022 * dy * dy;
  };

  const heightAt = (xp, yp) => {
    const chestZ = rayGrid ? rayGrid.sample(xp, yp) : fallbackChestZ(xp, yp);
    return cfg.minFloorMm + clamp(peakChestZ - chestZ, 0, 6.2) + cfg.shirtClearanceMm;
  };

  const outerSdfOnly = (xp, yp) => {
    const d = roundedRectSdf(xp, yp - yCenter, halfW, halfH, cfg.shirtCornerRmm);
    return Math.abs(d) < stepMm * 1.1 ? d : Number.NaN;
  };

  const rawTri = buildHeightfieldStencilTri({
    solid,
    cols,
    rows,
    xMin,
    yMin,
    stepMm,
    heightAt,
    boundarySdf: outerSdfOnly,
    smoothPasses: 3,
  });

  const norm = normalizeTriToOrigin(rawTri);
  return {
    id: `stencil_shirt_${safeId}`,
    kind: 'shirt',
    label: `Shirt Stencil (${safeId})`,
    ...norm,
    bridgesAdded,
    contourCount: contours.length,
  };
}

/**
 * 3) Crown 2x1 Stud Paint Cap (`stencil_crown_2x1`, §8.2):
 *    - `27.8 x 15.4 mm` rounded-corner cap (`R = 6.0 mm` concentric with the `31.4 x 19.2, R7.8` head saddle).
 *    - Two `Ø6.84 mm` vertical stud bores at `12.5 mm` pitch (`x = +-6.25 mm, y = 0`) with `45°` underside entry chamfers.
 *    - `2.90 mm` deck thickness puts `2.80 mm` crown stud tops `0.10 mm` flush below the `z = 0` outer face so any
 *      marker/paint-pen tip reaches effortlessly; outer `+0.70 mm` lip (`3.60 mm` total height) indexes on the saddle.
 */
export function buildCrownStencilMesh(opts = {}) {
  const cfg = { ...STENCIL_DEFAULTS, ...opts };
  const stepMm = 0.25;
  const halfW = cfg.crownWmm * 0.5;
  const halfH = cfg.crownHmm * 0.5;
  const holeR = cfg.crownHoleDiaMm * 0.5;
  const studHalfPitch = cfg.crownPitchMm * 0.5;

  const cols = Math.ceil((cfg.crownWmm + stepMm * 4) / stepMm);
  const rows = Math.ceil((cfg.crownHmm + stepMm * 4) / stepMm);
  const xMin = -0.5 * cols * stepMm;
  const yMin = -0.5 * rows * stepMm;

  const crownSdf = (x, y) => {
    const dOuter = roundedRectSdf(x, y, halfW, halfH, cfg.crownCornerRmm);
    const dHoleL = holeR - Math.hypot(x + studHalfPitch, y);
    const dHoleR = holeR - Math.hypot(x - studHalfPitch, y);
    return Math.max(dOuter, dHoleL, dHoleR);
  };

  const solid = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    const y = yMin + (r + 0.5) * stepMm;
    for (let c = 0; c < cols; c++) {
      const x = xMin + (c + 0.5) * stepMm;
      if (crownSdf(x, y) <= 0) solid[r * cols + c] = 1;
    }
  }

  const heightAt = (x, y) => {
    // 45° underside lead-in chamfer around each Ø6.84 mm bore (`z = 2.40 -> 2.90 mm` over `r = 3.42 -> 3.92 mm`)
    const rHole = Math.min(Math.hypot(x + studHalfPitch, y), Math.hypot(x - studHalfPitch, y));
    if (rHole < holeR + cfg.crownChamferMm) {
      const t = clamp((rHole - holeR) / cfg.crownChamferMm, 0, 1);
      return (cfg.crownDeckHmm - cfg.crownChamferMm) + t * cfg.crownChamferMm;
    }
    // Outer 1.35 mm perimeter saddle-indexing lip (`z = 2.90 -> 3.60 mm` with 45° inner ramp, zero overhang!)
    const dOuter = roundedRectSdf(x, y, halfW, halfH, cfg.crownCornerRmm);
    const lipInnerStart = -1.85;
    if (dOuter >= lipInnerStart) {
      const t = clamp((dOuter - lipInnerStart) / 0.55, 0, 1);
      return cfg.crownDeckHmm + t * (cfg.crownTotalHmm - cfg.crownDeckHmm);
    }
    return cfg.crownDeckHmm;
  };

  const rawTri = buildHeightfieldStencilTri({
    solid,
    cols,
    rows,
    xMin,
    yMin,
    stepMm,
    heightAt,
    boundarySdf: crownSdf,
    smoothPasses: 2,
  });

  const norm = normalizeTriToOrigin(rawTri);
  return {
    id: 'stencil_crown_2x1',
    kind: 'crown',
    label: 'Crown 2x1 Stud Paint Cap',
    ...norm,
    bridgesAdded: 0,
    contourCount: 2,
  };
}

// ---------------------------------------------------------------------------------------------
// 7. Stencil Planner, Sprue-Joined Adult Tool Card & Print-Pack Exporter (§8.2, §9.1, §9.2)
// ---------------------------------------------------------------------------------------------

function translateTriXY(tri, dx, dy) {
  const out = new Float32Array(tri.length);
  for (let i = 0; i < tri.length; i += 3) {
    out[i] = tri[i] + dx;
    out[i + 1] = tri[i + 1] + dy;
    out[i + 2] = tri[i + 2];
  }
  return out;
}

/** Lightweight (<0.05 ms) summary of which 3D stencils apply to `state` for interactive UI display. */
export function describeStencilSet(state = {}, { flatPackMode = 'loose' } = {}) {
  const head = state.head || 'kid';
  const category = state.category || (HUMAN_HEAD_IDS.has(head) ? 'human' : 'creature');
  const isHuman = category === 'human' && HUMAN_HEAD_IDS.has(head);
  const expr = state.selfie ? 'selfie' : (state.expr || 'spark');
  const shirtId = state.shirt || 'off';

  const ids = [];
  const notes = [];
  if (isHuman) {
    if (expr === 'selfie') {
      notes.push('Selfie photo face uses the 2D sticker sheet; 3D face stencil omitted.');
    } else if (expr !== 'blank' && GRAPHIC_EXPRESSIONS.has(expr)) {
      ids.push(`stencil_face_${expr}`);
    }
  } else if (expr !== 'blank') {
    notes.push('Face stencil fits the removable human faceplate; creature/robot heads use the 2D sticker sheet.');
  }
  if (shirtId && shirtId !== 'off') {
    ids.push(`stencil_shirt_${String(shirtId).replace(/[^a-zA-Z0-9_-]/g, '_')}`);
  }
  if (head !== 'custom' || ids.length === 0) {
    ids.push('stencil_crown_2x1');
  }

  const modeLabel = flatPackMode === 'sprue' ? 'Adult Tool Card (sprue)' : 'loose';
  return {
    ids,
    notes,
    summaryLine: `3D stencils: ${ids.length} tool${ids.length === 1 ? '' : 's'} (${ids.join(', ')} · ${modeLabel})`,
  };
}

/**
 * Plan and generate all applicable 3D stencils for the active character `state` & `bom`.
 * In `sprue` (`Kit tray`) mode, joins all stencils onto one connected **Adult Tool Card** exceeding the
 * `31.75 x 57.15 mm` 16 CFR 1501 small-parts cylinder (§8.2).
 */
export function planStencils(state = {}, bom = null, {
  flatPackMode = 'loose',
  boundMm = 180,
  faceplateTri = null,
  torsoTri = null,
  renderedSources = {},
  skinHex = '#F3BA95',
  shirtHex = null,
  sprueSpec = SPRUE_SPEC,
} = {}) {
  const notes = [];
  const head = state.head || 'kid';
  const category = state.category || (HUMAN_HEAD_IDS.has(head) ? 'human' : 'creature');
  const isHuman = category === 'human' && HUMAN_HEAD_IDS.has(head);
  const faceInsert = state.faceInsert || 'sculpted';
  const expr = state.selfie ? 'selfie' : (state.expr || 'spark');
  const shirtId = state.shirt || 'off';
  const edition = state.edition === 'snap' ? 'snap' : 'pro';

  const tools = [];

  // 1. Face stencil (removable universal human faceplate, graphic expressions only — never selfie pixels!)
  if (isHuman) {
    if (expr === 'selfie') {
      notes.push('Selfie photo face uses the 2D sticker sheet; 3D face stencil omitted (no camera pixels enter 3D geometry).');
    } else if (expr !== 'blank' && GRAPHIC_EXPRESSIONS.has(expr)) {
      const srcKey = `face:${expr}:${faceInsert}`;
      const renderedRgba = renderedSources[srcKey] || renderedSources[`face:${expr}:flat`] || null;
      tools.push(buildFaceStencilMesh({
        expr,
        faceInsert,
        faceplateTri,
        renderedRgba,
      }));
    }
  } else if (expr !== 'blank') {
    notes.push('Face stencil fits the removable human faceplate; creature/robot heads use the 2D conformal sticker sheet.');
  }

  // 2. Shirt motif stencil (whenever a shirt motif is active)
  if (shirtId && shirtId !== 'off') {
    const renderedRgba = renderedSources[`shirt:${shirtId}`] || null;
    tools.push(buildShirtStencilMesh({
      shirtId,
      edition,
      torsoTri,
      shirtHex,
      skinHex,
      renderedRgba,
    }));
  }

  // 3. Universal 2x1 Crown Stud Paint Cap (fits every standard Kip head & hat-compatible wig)
  if (head !== 'custom') {
    tools.push(buildCrownStencilMesh());
  }

  if (tools.length === 0) {
    // Fallback if custom head + blank face + no shirt: emit universal crown paint cap so explicit export never produces an empty mesh
    tools.push(buildCrownStencilMesh());
  }

  // Pack stencils cleanly in a compact row/2-column tray layout inside `[0, boundMm]^2`
  const gapMm = flatPackMode === 'sprue' ? Math.max(5.6, sprueSpec.partGapMm + 0.6) : 3.0;
  const margin = sprueMarginMm(sprueSpec);
  const rawPlaced = [];
  let curX = 0, rowY = 0, rowH = 0;
  const maxRowW = Math.min(boundMm - 2 * margin - 4, 96);

  for (let i = 0; i < tools.length; i++) {
    const t = tools[i];
    if (curX > 0 && curX + t.w > maxRowW) {
      curX = 0;
      rowY += rowH + gapMm;
      rowH = 0;
    }
    rawPlaced.push({ tool: t, rx: curX, ry: rowY });
    curX += t.w + gapMm;
    if (t.h > rowH) rowH = t.h;
  }

  const contentW = rawPlaced.reduce((m, r) => Math.max(m, r.rx + r.tool.w), 0);
  const contentH = rawPlaced.reduce((m, r) => Math.max(m, r.ry + r.tool.h), 0);
  const frameW = Math.max(STENCIL_DEFAULTS.adultCardMinWmm, contentW + 2 * margin);
  const frameH = Math.max(STENCIL_DEFAULTS.adultCardMinHmm, contentH + 2 * margin);
  const frameX = Math.max(0, +(0.5 * (boundMm - frameW)).toFixed(3));
  const frameY = Math.max(0, +(0.5 * (boundMm - frameH)).toFixed(3));
  const offsetX = +(frameX + 0.5 * (frameW - contentW)).toFixed(3);
  const offsetY = +(frameY + 0.5 * (frameH - contentH)).toFixed(3);

  const placed = rawPlaced.map(({ tool, rx, ry }) => {
    const px = +(offsetX + rx).toFixed(3);
    const py = +(offsetY + ry).toFixed(3);
    const worldTri = translateTriXY(tool.tri, px, py);
    const rep = supportReport(worldTri);
    return {
      id: tool.id,
      partId: tool.id,
      instance: tool.id,
      label: tool.label,
      kind: tool.kind,
      x: px,
      y: py,
      w: tool.w,
      h: tool.h,
      dz: tool.dz,
      localTri: tool.tri,
      localW: tool.w,
      localH: tool.h,
      turnIdx: 0,
      tri: worldTri,
      hex: STENCIL_DEFAULTS.stencilHex,
      colorName: 'Warm Shell Cream',
      tier: 'support-free',
      report: rep,
      bridgesAdded: tool.bridgesAdded,
      contourCount: tool.contourCount,
    };
  });

  let sprue = null;
  let sprueVerification = null;
  if (flatPackMode === 'sprue') {
    sprue = buildSprueCard(placed, {
      boundMm,
      spec: sprueSpec,
      frameBox: { x: frameX, y: frameY, w: frameW, h: frameH },
    });
    if (sprue) {
      sprueVerification = checkSprueCard(sprue, placed, sprueSpec);
    }
  }

  const plateRecord = {
    index: 0,
    label: sprue ? 'Adult Tool Card · 3D Paint Stencils' : '3D Paint Stencils',
    fileStem: sprue ? 'kip_stencils_adult_tool_card' : 'kip_stencils',
    hex: STENCIL_DEFAULTS.stencilHex,
    colorName: 'Warm Shell Cream',
    boundMm,
    extruderSlot: 1,
    requiresSupports: false,
    placed,
    sprue,
  };

  return {
    tools: placed,
    plate: plateRecord,
    sprue,
    sprueVerification,
    notes,
    warnings: [
      PRINT_PAGE_WARNINGS.small_part,
      ...(sprue ? [PRINT_PAGE_WARNINGS.sprue_prep] : []),
      PRINT_PAGE_WARNINGS.always,
    ],
  };
}

/** Single-file binary STL export for the `Stencils (STL)` menu action (§9.1). */
export function stencilsToStl(stencilPlan) {
  const pl = stencilPlan.plate;
  return plateStl(pl, pl.fileStem, pl.sprue);
}

/** Build `stencils/*` entries for `kip-print-pack.zip` (§8.2, §9.2) when `profile.includeStencils === true`. */
export function buildStencilPackFiles(stencilPlan, profile = {}) {
  if (!stencilPlan || !stencilPlan.tools || !stencilPlan.tools.length) return [];
  const pl = stencilPlan.plate;
  const files = [];

  // Combined card / tray in both 3MF and binary STL
  files.push({
    name: `stencils/${pl.fileStem}.3mf`,
    data: to3mf(pl, {
      bedMm: profile.bedXmm || 256,
      bedYmm: profile.bedYmm || 256,
      boundMm: pl.boundMm,
      title: pl.label,
      slicer: profile.slicer === 'prusa' ? 'prusa' : 'orca_bambu',
      profile,
      extruder: 1,
      filamentColours: [STENCIL_DEFAULTS.stencilHex],
      sprue: pl.sprue,
    }),
  });
  files.push({
    name: `stencils/${pl.fileStem}.stl`,
    data: plateStl(pl, pl.fileStem, pl.sprue),
  });

  // Individual stencil STLs (`stencils/stencil_face_<expr>.stl`, `stencils/stencil_shirt_<id>.stl`, `stencils/stencil_crown_2x1.stl`)
  for (const t of stencilPlan.tools) {
    files.push({
      name: `stencils/${t.id}.stl`,
      data: plateStl([{ tri: t.localTri }], t.id, null),
    });
  }

  return files;
}
