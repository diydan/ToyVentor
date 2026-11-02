// Kip 2D printable sticker sheet, conformal surface unroller, print-then-cut PNG, vector cut SVG, and Silhouette DXF (§8.1).
//
// PRIVACY & PURITY INVARIANTS (enforced by tests/kip-print.test.ts, tests/kip-selfie.test.ts, tests/kip-print-stickers.test.ts):
//  - Pure JS: typed arrays and plain objects in, Uint8Array / string out. Zero DOM, window, document, Worker, network,
//    Web Storage, IndexedDB, Cache API, URL, or biometric/face-detection APIs.
//  - Selfie and Photo-Forge pixels stay strictly in transient memory buffers passed to `stickersToPdf` / `stickersToPng`
//    and never enter `planStickerSheet`, `layout.json`, `README.txt`, or printer profiles.

import { WINDOW_MM, WINDOW_ZB, windowPolygon } from './kip-faceplate-shape.js';
import { normHex } from './kip-print-bom.js';
import { PRINT_PAGE_WARNINGS } from './kip-print.js';

export const PAGE_SIZES_MM = Object.freeze({
  letter: Object.freeze({ id: 'letter', label: 'US Letter', w: 215.9, h: 279.4 }),
  a4: Object.freeze({ id: 'a4', label: 'ISO A4', w: 210.0, h: 297.0 }),
});

export const SAFE_ZONE_MM = Object.freeze({ w: 190.0, h: 257.0 });
export const CRICUT_MAX_MM = Object.freeze({ w: 180.0, h: 240.0 });
export const SCALE_BAR_MM = 50.0;
export const BLEED_MM = 1.0;
export const SCISSOR_GUIDE_OFFSET_MM = 1.2;
export const BONUS_EXPRESSIONS = Object.freeze(['happy', 'wink', 'surprised']);

// Measured per-row and per-column conformal arc-length / chord ratios across shipped Kip STLs (§8.1 B).
export const UNROLL_PROFILES = Object.freeze({
  selfie_face: {
    planeW: 23.2, planeH: 12.4, centerY: 6.3, mode: 'faceplate',
    rowScales: [1.0006, 1.0036, 1.0036, 1.0069, 1.0096, 1.0142, 1.0142, 1.0157, 1.0178, 1.0212, 1.0183, 1.018, 1.0204, 1.0433, 1.0349],
    colScales: [1.071, 1.0751, 1.0778, 1.0738, 1.0791, 1.0797, 1.0708, 1.063, 1.0586, 1.0544, 1.0557, 1.0531, 1.0494, 1.0424, 1.04, 1.0424, 1.0494, 1.0531, 1.0557, 1.0544, 1.0586, 1.063, 1.0708, 1.0797, 1.0791, 1.0738, 1.0778, 1.0751, 1.071],
  },
  human_face_flat: {
    planeW: 23.6, planeH: 10.1, centerY: 5.25, mode: 'faceplate',
    rowScales: [1.0074, 1.0074, 1.01, 1.01, 1.0155, 1.0162, 1.0179, 1.0201, 1.0155, 1.0185, 1.0175, 1.0223, 1.0362, 1.0429, 1.0373],
    colScales: [1.0536, 1.0731, 1.0836, 1.0884, 1.0908, 1.0886, 1.0783, 1.0693, 1.0642, 1.0593, 1.061, 1.0542, 1.0497, 1.0482, 1.0449, 1.0482, 1.0497, 1.0542, 1.061, 1.0593, 1.0642, 1.0693, 1.0783, 1.0886, 1.0908, 1.0884, 1.0836, 1.0731, 1.0536],
  },
  human_face_sculpted: {
    planeW: 23.6, planeH: 10.1, centerY: 5.25, mode: 'faceplate',
    rowScales: [1.0074, 1.0074, 1.0168, 1.0292, 1.042, 1.0569, 1.0627, 1.0713, 1.0757, 1.0617, 1.048, 1.0374, 1.0362, 1.0429, 1.0373],
    colScales: [1.0536, 1.0731, 1.0836, 1.0884, 1.0908, 1.0886, 1.0783, 1.0693, 1.0642, 1.0593, 1.061, 1.0542, 1.0497, 1.1106, 1.1081, 1.1106, 1.0497, 1.0542, 1.061, 1.0593, 1.0642, 1.0693, 1.0783, 1.0886, 1.0908, 1.0884, 1.0836, 1.0731, 1.0536],
  },
  human_face_vinyl: {
    planeW: 23.6, planeH: 10.1, centerY: 5.25, mode: 'faceplate',
    rowScales: [1.0074, 1.0074, 1.01, 1.01, 1.0326, 1.0296, 1.0294, 1.0314, 1.04, 1.0618, 1.0392, 1.028, 1.0362, 1.0429, 1.0373],
    colScales: [1.0536, 1.0731, 1.0836, 1.0884, 1.1088, 1.1185, 1.1155, 1.0976, 1.0774, 1.0611, 1.061, 1.0542, 1.0497, 1.0817, 1.0863, 1.0817, 1.0497, 1.0542, 1.061, 1.0611, 1.0774, 1.0976, 1.1155, 1.1185, 1.1088, 1.0884, 1.0836, 1.0731, 1.0536],
  },
  classic_visor_face: {
    planeW: 25.5, planeH: 12.8, centerY: 0.0, mode: 'visor',
    rowScales: [1.0129, 1.0129, 1.0129, 1.0129, 1.0129],
    colScales: [1.0, 1.0, 1.0, 1.0, 1.0],
  },
  shirt_pro: {
    planeW: 18.8, planeH: 21.6, centerY: 86.8, mode: 'torso',
    rowScales: [1.0376, 1.0366, 1.0357, 1.0348, 1.0342, 1.0336, 1.033, 1.0333, 1.0338, 1.0343, 1.0349, 1.0354, 1.0362, 1.0369, 1.0377, 1.0384, 1.0392, 1.04, 1.0409, 1.0417, 1.0426, 1.0434, 1.0443, 1.0452, 1.0461],
    colScales: [1.0076, 1.0071, 1.0065, 1.0061, 1.0058, 1.0057, 1.0054, 1.0053, 1.0053, 1.0051, 1.0051, 1.0051, 1.0051, 1.0051, 1.0053, 1.0053, 1.0054, 1.0057, 1.0058, 1.0061, 1.0065, 1.0071, 1.0076],
  },
  shirt_snap: {
    planeW: 18.8, planeH: 21.6, centerY: 86.8, mode: 'torso',
    rowScales: [1.0364, 1.0354, 1.0344, 1.0337, 1.0331, 1.0324, 1.0317, 1.031, 1.0309, 1.0312, 1.0314, 1.0316, 1.0318, 1.0321, 1.0323, 1.0326, 1.0328, 1.0331, 1.0333, 1.0336, 1.0338, 1.034, 1.0343, 1.0345, 1.0348],
    colScales: [1.0044, 1.0041, 1.0039, 1.0036, 1.0034, 1.0034, 1.0033, 1.0032, 1.0031, 1.0031, 1.003, 1.003, 1.003, 1.0031, 1.0031, 1.0032, 1.0033, 1.0034, 1.0034, 1.0036, 1.0039, 1.0041, 1.0044],
  },
  creature_fox: {
    planeW: 28.4, planeH: 14.2, centerY: 15.0, mode: 'head',
    rowScales: [1.0632, 1.0645, 1.0827, 1.0751, 1.069, 1.0629, 1.0629, 1.0631, 1.0641, 1.0671, 1.0701, 1.0745, 1.079],
    colScales: [1.1417, 1.1331, 1.1277, 1.1248, 1.1227, 1.1213, 1.1207, 1.1264, 1.145, 1.1545, 1.1576, 1.1545, 1.145, 1.1264, 1.1207, 1.1213, 1.1227, 1.1248, 1.1277, 1.1331, 1.1417],
  },
  creature_bear: {
    planeW: 28.0, planeH: 14.0, centerY: 14.8, mode: 'head',
    rowScales: [1.0593, 1.0599, 1.0707, 1.0656, 1.0613, 1.059, 1.059, 1.0593, 1.0606, 1.063, 1.0664, 1.0703, 1.0743],
    colScales: [1.1479, 1.1399, 1.1347, 1.1317, 1.1295, 1.1279, 1.1297, 1.1355, 1.1398, 1.1407, 1.1411, 1.1407, 1.1398, 1.1355, 1.1297, 1.1279, 1.1295, 1.1317, 1.1347, 1.1399, 1.1479],
  },
  creature_robot: {
    planeW: 24.0, planeH: 10.6, centerY: 17.8, mode: 'head',
    rowScales: [1.0113, 1.0071, 1.0071, 1.0071, 1.0071, 1.007, 1.0066, 1.0058, 1.0056, 1.0097, 1.0154, 1.0208, 1.0219],
    colScales: [1.0515, 1.0534, 1.0467, 1.0325, 1.0284, 1.018, 1.0102, 1.0059, 1.0038, 1.0028, 1.0024, 1.0028, 1.0038, 1.0059, 1.0102, 1.018, 1.0284, 1.0325, 1.0467, 1.0534, 1.0515],
  },
  creature_scout: {
    planeW: 25.0, planeH: 9.6, centerY: 17.6, mode: 'head',
    rowScales: [1.0027, 1.0034, 1.0013, 1, 1, 1, 1, 1, 1, 1, 1.0001, 1.0052, 1.0118],
    colScales: [1.0387, 1.0269, 1.0034, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.0034, 1.0269, 1.0387],
  },
  creature_cat: {
    planeW: 28.0, planeH: 14.0, centerY: 15.2, mode: 'head',
    rowScales: [1.0611, 1.0607, 1.0606, 1.0606, 1.0606, 1.0606, 1.0606, 1.0607, 1.0614, 1.0634, 1.0666, 1.0701, 1.0738],
    colScales: [1.1221, 1.1154, 1.111, 1.1085, 1.1067, 1.1055, 1.105, 1.1045, 1.1042, 1.1039, 1.1037, 1.1039, 1.1042, 1.1045, 1.105, 1.1055, 1.1067, 1.1085, 1.111, 1.1154, 1.1221],
  },
  creature_dragon: {
    planeW: 26.0, planeH: 13.0, centerY: 17.2, mode: 'head',
    rowScales: [1.0482, 1.0363, 1.0709, 1.1112, 1.0928, 1.0917, 1.0945, 1.0747, 1.0591, 1.0592, 1.0598, 1.0611, 1.0623],
    colScales: [1.1597, 1.1101, 1.1044, 1.1385, 1.0612, 1.0825, 1.0871, 1.087, 1.0845, 1.0819, 1.0806, 1.0819, 1.0845, 1.087, 1.0871, 1.0825, 1.0612, 1.1385, 1.1044, 1.1101, 1.1597],
  },
  creature_alien: {
    planeW: 24.0, planeH: 13.0, centerY: 18.2, mode: 'head',
    rowScales: [1.0087, 1.0088, 1.0091, 1.0097, 1.0106, 1.0117, 1.0129, 1.0142, 1.0164, 1.0188, 1.021, 1.0243, 1.0276],
    colScales: [1.1553, 1.1444, 1.1366, 1.1309, 1.1258, 1.1225, 1.1199, 1.1187, 1.1168, 1.1167, 1.1166, 1.1167, 1.1168, 1.1187, 1.1199, 1.1225, 1.1258, 1.1309, 1.1366, 1.1444, 1.1553],
  },
  creature_imp: {
    planeW: 28.0, planeH: 13.6, centerY: 16.4, mode: 'head',
    rowScales: [1.058, 1.0575, 1.0572, 1.0572, 1.0666, 1.0343, 1.0206, 1.0146, 1.0194, 1.0291, 1.0353, 1.038, 1.072],
    colScales: [1.2548, 1.1888, 1.163, 1.1431, 1.1307, 1.1161, 1.1042, 1.0928, 1.0839, 1.0799, 1.0789, 1.0799, 1.0839, 1.0928, 1.1042, 1.1161, 1.1307, 1.1431, 1.163, 1.1888, 1.2548],
  },
});

// ---------------------------------------------------------------------------------------------
// 1. Conformal Surface Ray-Cast Unrolling (§8.1 B)
// ---------------------------------------------------------------------------------------------
function interpCurve(arr, t) {
  if (!arr || !arr.length) return 1.0;
  if (arr.length === 1) return arr[0];
  const clamped = Math.max(0, Math.min(1, t));
  const pos = clamped * (arr.length - 1);
  const i0 = Math.min(arr.length - 2, Math.floor(pos));
  const frac = pos - i0;
  return arr[i0] + (arr[i0 + 1] - arr[i0]) * frac;
}

/**
 * Ray-cast a triangle mesh in viewer decal-probe coordinates along `-Z` and measure per-row and per-column
 * surface arc-length / chord ratios (`rowScales`, `colScales`). Used both offline and in unit tests to verify
 * that `UNROLL_PROFILES` stay within 0.3% of the exported STLs.
 */
export function measureDecalSurfaceGrid(tri, {
  planeW = 23.6,
  planeH = 10.1,
  centerY = 5.25,
  mode = 'faceplate',
  cols = 29,
  rows = 15,
} = {}) {
  const nTri = Math.floor(tri.length / 9);
  const proj = new Float32Array(tri.length);
  for (let i = 0; i < nTri; i++) {
    const o = i * 9;
    for (let v = 0; v < 3; v++) {
      const k = o + v * 3;
      const sx = tri[k], sy = tri[k + 1], sz = tri[k + 2];
      if (mode === 'faceplate') {
        proj[k] = -sx;
        proj[k + 1] = sz;
        proj[k + 2] = sy;
      } else {
        proj[k] = sx;
        proj[k + 1] = sz;
        proj[k + 2] = -sy;
      }
    }
  }

  // Acceleration bboxes in XY per triangle
  const bMinX = new Float32Array(nTri);
  const bMaxX = new Float32Array(nTri);
  const bMinY = new Float32Array(nTri);
  const bMaxY = new Float32Array(nTri);
  for (let i = 0; i < nTri; i++) {
    const o = i * 9;
    const x0 = proj[o], y0 = proj[o + 1];
    const x1 = proj[o + 3], y1 = proj[o + 4];
    const x2 = proj[o + 6], y2 = proj[o + 7];
    bMinX[i] = Math.min(x0, x1, x2);
    bMaxX[i] = Math.max(x0, x1, x2);
    bMinY[i] = Math.min(y0, y1, y2);
    bMaxY[i] = Math.max(y0, y1, y2);
  }

  const hitZGrid = new Float64Array(rows * cols);
  hitZGrid.fill(Number.NaN);

  for (let r = 0; r < rows; r++) {
    const v = rows > 1 ? r / (rows - 1) : 0.5;
    const ry = centerY + (0.5 - v) * planeH;
    for (let c = 0; c < cols; c++) {
      const u = cols > 1 ? c / (cols - 1) : 0.5;
      const rx = (u - 0.5) * planeW;
      let bestZ = -Infinity;
      for (let i = 0; i < nTri; i++) {
        if (rx < bMinX[i] - 1e-6 || rx > bMaxX[i] + 1e-6 || ry < bMinY[i] - 1e-6 || ry > bMaxY[i] + 1e-6) continue;
        const o = i * 9;
        const ax = proj[o], ay = proj[o + 1], az = proj[o + 2];
        const bx = proj[o + 3], by = proj[o + 4], bz = proj[o + 5];
        const cx = proj[o + 6], cy = proj[o + 7], cz = proj[o + 8];
        const v0x = cx - ax, v0y = cy - ay;
        const v1x = bx - ax, v1y = by - ay;
        const v2x = rx - ax, v2y = ry - ay;
        const denom = v0x * v1y - v1x * v0y;
        if (Math.abs(denom) < 1e-10) continue;
        const inv = 1 / denom;
        const bu = (v2x * v1y - v1x * v2y) * inv;
        const bv = (v0x * v2y - v2x * v0y) * inv;
        if (bu >= -1e-6 && bv >= -1e-6 && bu + bv <= 1 + 1e-6) {
          const z = az + bu * (cz - az) + bv * (bz - az);
          if (z > bestZ) bestZ = z;
        }
      }
      if (bestZ > -Infinity) hitZGrid[r * cols + c] = bestZ;
    }
  }

  const dx = cols > 1 ? planeW / (cols - 1) : planeW;
  const dy = rows > 1 ? planeH / (rows - 1) : planeH;
  const rowScales = [];
  for (let r = 0; r < rows; r++) {
    let arc = 0, chord = 0;
    for (let c = 0; c < cols - 1; c++) {
      const z0 = hitZGrid[r * cols + c];
      const z1 = hitZGrid[r * cols + c + 1];
      if (!Number.isNaN(z0) && !Number.isNaN(z1)) {
        const dz = z1 - z0;
        // Guard steep lateral silhouette graze on narrow chests
        if (Math.abs(dz) <= dx * 3.0) {
          arc += Math.hypot(dx, dz);
          chord += dx;
        }
      }
    }
    rowScales.push(chord > 1e-6 ? +(arc / chord).toFixed(4) : 1.0);
  }

  const colScales = [];
  for (let c = 0; c < cols; c++) {
    let arc = 0, chord = 0;
    for (let r = 0; r < rows - 1; r++) {
      const z0 = hitZGrid[r * cols + c];
      const z1 = hitZGrid[(r + 1) * cols + c];
      if (!Number.isNaN(z0) && !Number.isNaN(z1)) {
        const dz = z1 - z0;
        if (Math.abs(dz) <= dy * 3.0) {
          arc += Math.hypot(dy, dz);
          chord += dy;
        }
      }
    }
    colScales.push(chord > 1e-6 ? +(arc / chord).toFixed(4) : 1.0);
  }

  return { planeW, planeH, centerY, mode, rowScales, colScales };
}

/** Envelope dimensions `(w, h)` in mm of a separable per-row / per-column unrolled plane or sub-crop `cropUv`. */
export function unrollDimensionsMm(profile, cropUv = null) {
  const p = typeof profile === 'string' ? (UNROLL_PROFILES[profile] || UNROLL_PROFILES.human_face_flat) : profile;
  const u0 = cropUv ? cropUv.u0 : 0;
  const u1 = cropUv ? cropUv.u1 : 1;
  const v0 = cropUv ? cropUv.v0 : 0;
  const v1 = cropUv ? cropUv.v1 : 1;

  let maxRow = 1.0, maxCol = 1.0;
  const samples = 24;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    maxRow = Math.max(maxRow, interpCurve(p.rowScales, v0 + (v1 - v0) * t));
    maxCol = Math.max(maxCol, interpCurve(p.colScales, u0 + (u1 - u0) * t));
  }
  const midRow = interpCurve(p.rowScales, 0.5 * (v0 + v1));
  const midCol = interpCurve(p.colScales, 0.5 * (u0 + u1));
  return {
    w: +(p.planeW * (u1 - u0) * maxRow).toFixed(3),
    h: +(p.planeH * (v1 - v0) * maxCol).toFixed(3),
    midW: +(p.planeW * (u1 - u0) * midRow).toFixed(3),
    midH: +(p.planeH * (v1 - v0) * midCol).toFixed(3),
    maxRowScale: maxRow,
    maxColScale: maxCol,
  };
}

/** Forward separable conformal unroll: normalized `(u, v) in [0, 1]^2` -> `[xMm, yMm]` inside `unrollDimensionsMm(profile)`. */
export function unrollPointMm(profile, u, v, dims = null) {
  const p = typeof profile === 'string' ? (UNROLL_PROFILES[profile] || UNROLL_PROFILES.human_face_flat) : profile;
  const d = dims || unrollDimensionsMm(p);
  const rs = interpCurve(p.rowScales, v);
  const cs = interpCurve(p.colScales, u);
  return [
    d.w * 0.5 + (u - 0.5) * p.planeW * rs,
    d.h * 0.5 + (v - 0.5) * p.planeH * cs,
  ];
}

/** Inverse separable conformal unroll: `[xMm, yMm]` -> `[u, v]` in 3 fixed-point iterations (`< 1e-6` residual). */
export function inverseUnrollUv(profile, xMm, yMm, dims = null) {
  const p = typeof profile === 'string' ? (UNROLL_PROFILES[profile] || UNROLL_PROFILES.human_face_flat) : profile;
  const d = dims || unrollDimensionsMm(p);
  const dx = xMm - d.w * 0.5;
  const dy = yMm - d.h * 0.5;
  let u = 0.5 + dx / (p.planeW * interpCurve(p.rowScales, 0.5));
  let v = 0.5 + dy / (p.planeH * interpCurve(p.colScales, 0.5));
  for (let iter = 0; iter < 3; iter++) {
    const rs = interpCurve(p.rowScales, v);
    const cs = interpCurve(p.colScales, u);
    u = 0.5 + dx / (p.planeW * rs);
    v = 0.5 + dy / (p.planeH * cs);
  }
  return [u, v];
}

// ---------------------------------------------------------------------------------------------
// 2. Polygon & Cut-Line Builders (Flat, Sculpted Split Set, Vinyl, Visor, Shirt, Craft Cutout)
// ---------------------------------------------------------------------------------------------
function signedPolygonArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    a += x0 * y1 - x1 * y0;
  }
  return a * 0.5;
}

function ensureWinding(poly, clockwise = true) {
  const area = signedPolygonArea(poly);
  const isCw = area > 0; // screen/SVG coordinates (x right, y down): positive shoelace = clockwise
  if (isCw === clockwise) return poly;
  return [...poly].reverse();
}

function roundedRectPoly(x0, y0, w, h, r, segsPerCorner = 6) {
  const rad = Math.max(0, Math.min(r, w * 0.5 - 1e-3, h * 0.5 - 1e-3));
  if (rad <= 1e-4) {
    return [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]];
  }
  const pts = [];
  const corners = [
    [x0 + w - rad, y0 + rad, -Math.PI * 0.5, 0],
    [x0 + w - rad, y0 + h - rad, 0, Math.PI * 0.5],
    [x0 + rad, y0 + h - rad, Math.PI * 0.5, Math.PI],
    [x0 + rad, y0 + rad, Math.PI, Math.PI * 1.5],
  ];
  for (const [cx, cy, a0, a1] of corners) {
    for (let i = 0; i <= segsPerCorner; i++) {
      const a = a0 + ((a1 - a0) * i) / segsPerCorner;
      pts.push([+(cx + Math.cos(a) * rad).toFixed(3), +(cy + Math.sin(a) * rad).toFixed(3)]);
    }
  }
  return pts;
}

function circlePoly(cx, cy, r, segs = 32) {
  const pts = [];
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    pts.push([+(cx + Math.cos(a) * r).toFixed(3), +(cy + Math.sin(a) * r).toFixed(3)]);
  }
  return pts;
}

function offsetPolygonRadialFromCentroid(poly, offsetMm) {
  let cx = 0, cy = 0;
  for (const [x, y] of poly) { cx += x; cy += y; }
  cx /= Math.max(1, poly.length);
  cy /= Math.max(1, poly.length);

  const cw = ensureWinding(poly, true);
  const out = [];
  const n = cw.length;
  for (let i = 0; i < n; i++) {
    const [px, py] = cw[(i - 1 + n) % n];
    const [x, y] = cw[i];
    const [nxp, nyp] = cw[(i + 1) % n];
    // Outward normals in screen coords (x right, y down) for CW polygon: (dy, -dx)
    const e0x = x - px, e0y = y - py, l0 = Math.hypot(e0x, e0y) || 1;
    const e1x = nxp - x, e1y = nyp - y, l1 = Math.hypot(e1x, e1y) || 1;
    let ox = (e0y / l0) + (e1y / l1);
    let oy = -(e0x / l0) - (e1x / l1);
    const ol = Math.hypot(ox, oy);
    if (ol > 1e-5) {
      ox /= ol;
      oy /= ol;
    } else {
      const rx = x - cx, ry = y - cy, rl = Math.hypot(rx, ry) || 1;
      ox = rx / rl;
      oy = ry / rl;
    }
    // Miter clamp to 1.35 * offsetMm so sharp corners stay smooth
    const dot = Math.max(0.74, ox * (e1y / l1) + oy * (-e1x / l1));
    const scale = offsetMm / dot;
    out.push([+(x + ox * scale).toFixed(3), +(y + oy * scale).toFixed(3)]);
  }
  return out;
}

/**
 * Curved mouth-ridge relief slot inside `WINDOW_MM` (`x in [-2.60, +2.60] mm`, crest `zb = 1.25 mm`, corners `zb = 1.75 mm`,
 * slot half-thickness `0.42 mm`), mapped through the same `unrollPointMm('selfie_face', u, v)` as the outer squircle (§8.1 C).
 */
function buildUnrolledFlatFaceGeometry() {
  const prof = UNROLL_PROFILES.selfie_face;
  const fullDims = unrollDimensionsMm(prof);
  const rawWin = windowPolygon(0.2);
  const unrolledRaw = rawWin.map(([wx, wy]) => unrollPointMm(prof, wx / WINDOW_MM.w, wy / WINDOW_MM.h, fullDims));

  // Normalize polygon so min sits at (0, 0)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of unrolledRaw) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const outer = ensureWinding(unrolledRaw.map(([x, y]) => [+(x - minX).toFixed(3), +(y - minY).toFixed(3)]), true);

  // Curved mouth-ridge slot (`FACE_MOUTH` in toyventor_parts.py: parabolic arc zb(x) = 1.25 + 0.50*(x/2.5)^2)
  const slotUpper = [];
  const slotLower = [];
  const steps = 12;
  const halfSpan = 2.62;
  const halfThick = 0.42;
  for (let i = 0; i <= steps; i++) {
    const t = -1 + (2 * i) / steps;
    const xPlate = t * halfSpan;
    const zbCenter = 0.85 + 0.50 * (t * t);
    const u = (WINDOW_MM.w * 0.5 + xPlate) / WINDOW_MM.w;
    const vTop = (WINDOW_ZB.max - (zbCenter + halfThick)) / WINDOW_MM.h;
    const vBot = (WINDOW_ZB.max - (zbCenter - halfThick)) / WINDOW_MM.h;
    const [ux, uy] = unrollPointMm(prof, u, vTop, fullDims);
    const [lx, ly] = unrollPointMm(prof, u, vBot, fullDims);
    slotUpper.push([+(ux - minX).toFixed(3), +(uy - minY).toFixed(3)]);
    slotLower.push([+(lx - minX).toFixed(3), +(ly - minY).toFixed(3)]);
  }
  const hole = ensureWinding([...slotUpper, ...slotLower.reverse()], false);
  return {
    w: +(maxX - minX).toFixed(3),
    h: +(maxY - minY).toFixed(3),
    shiftX: minX,
    shiftY: minY,
    fullDims,
    outerPolyMm: outer,
    holePolysMm: [hole],
  };
}

function makeUnrolledCropSticker({
  id,
  kind,
  label,
  sourceKey,
  profileKey,
  cropUv,
  cornerRadiusMm = 1.2,
  bgHex = '#F3BA95',
}) {
  const prof = UNROLL_PROFILES[profileKey] || UNROLL_PROFILES.human_face_sculpted;
  const fullDims = unrollDimensionsMm(prof);
  const p00 = unrollPointMm(prof, cropUv.u0, cropUv.v0, fullDims);
  const p11 = unrollPointMm(prof, cropUv.u1, cropUv.v1, fullDims);
  const p01 = unrollPointMm(prof, cropUv.u0, cropUv.v1, fullDims);
  const p10 = unrollPointMm(prof, cropUv.u1, cropUv.v0, fullDims);
  const minX = Math.min(p00[0], p01[0]);
  const maxX = Math.max(p10[0], p11[0]);
  const minY = Math.min(p00[1], p10[1]);
  const maxY = Math.max(p01[1], p11[1]);
  const w = +(maxX - minX).toFixed(3);
  const h = +(maxY - minY).toFixed(3);
  const outerPolyMm = ensureWinding(roundedRectPoly(0, 0, w, h, Math.min(cornerRadiusMm, w * 0.35, h * 0.35)), true);
  return {
    id,
    kind,
    label,
    w,
    h,
    bgHex: normHex(bgHex),
    outerPolyMm,
    holePolysMm: [],
    foldLinesMm: [],
    sampler: {
      mode: 'unroll_crop',
      sourceKey,
      profileKey,
      originX: minX,
      originY: minY,
      fullDims,
    },
  };
}

const PHOTO_ACCESSORY_MAX_MM = 120.0;
const PHOTO_ACCESSORY_MAX_POINTS = 400;

function finiteNums(arr, n) {
  return Array.isArray(arr) && arr.length === n && arr.every((v) => typeof v === 'number' && Number.isFinite(v));
}

/**
 * F2b photo accessory: a sticker whose cut path and photo map were built elsewhere (shared/outlineSticker.ts `photoStickerItem`)
 * and arrive as data. Rebuilt field by field so a malformed item never reaches the packer or the writers; returns null for one
 * that cannot be drawn (no cut path, no invertible photo map, a size past the sheet). Carries geometry only, never pixels.
 */
function photoAccessoryBase(it) {
  if (!it || typeof it !== 'object' || !it.sampler || it.sampler.mode !== 'photo_outline') return null;
  const poly = it.outerPolyMm;
  if (!Array.isArray(poly) || poly.length < 3 || poly.length > PHOTO_ACCESSORY_MAX_POINTS) return null;
  if (!poly.every((p) => finiteNums(p, 2))) return null;
  if (!(it.w > 0 && it.w <= PHOTO_ACCESSORY_MAX_MM && it.h > 0 && it.h <= PHOTO_ACCESSORY_MAX_MM)) return null;
  if (!finiteNums(it.sampler.stickerToPhoto, 6)) return null;
  const size = it.sampler.photoSize;
  const photoSize = size && size.width > 0 && size.height > 0 ? { width: size.width, height: size.height } : null;
  const id = String(it.id || 'photo_accessory').toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40) || 'photo_accessory';
  return {
    id,
    kind: 'photo_accessory',
    label: String(it.label || 'Photo accessory').replace(/[^\x20-\x7e]/g, ' ').slice(0, 60),
    w: it.w,
    h: it.h,
    bgHex: normHex(it.bgHex || '#FFFFFF'),
    outerPolyMm: ensureWinding(poly.map(([x, y]) => [x, y]), true),
    holePolysMm: [],
    foldLinesMm: [],
    sampler: {
      mode: 'photo_outline',
      sourceKey: `photo:${id}`,
      stickerToPhoto: it.sampler.stickerToPhoto.slice(),
      photoSize,
    },
  };
}

/**
 * Plan the complete 2D sticker sheet layout for the active scene BOM decals (§8.1 A-D).
 * Deterministic and pure: inspects only `bomDecals` and scalar `state` fields (never image pixels).
 */
export function planStickerSheet(bomDecals = [], state = {}, opts = {}) {
  const pageSpec = PAGE_SIZES_MM[opts.pageSize === 'a4' ? 'a4' : 'letter'];
  const headSkinHex = normHex(opts.headSkinHex || state.headSkinHex || '#F3BA95');
  const shirtHex = normHex(opts.shirtHex || state.shirtHex || '#FF6B4A');
  const edition = state.edition === 'snap' ? 'snap' : 'pro';

  const items = [];
  for (const dec of bomDecals) {
    if (dec.kind === 'selfie_face' || (dec.kind === 'human_face' && dec.faceInsert === 'flat')) {
      const geo = buildUnrolledFlatFaceGeometry();
      const isSelfie = dec.kind === 'selfie_face' || dec.expr === 'selfie';
      const primaryKey = isSelfie ? 'face:selfie' : `face:${dec.expr || 'spark'}:flat`;
      const mkFlat = (id, label, srcKey, isWindowCanvas) => ({
        id,
        kind: isSelfie && srcKey === 'face:selfie' ? 'selfie_face' : 'human_face_flat',
        label,
        w: geo.w,
        h: geo.h,
        bgHex: headSkinHex,
        outerPolyMm: geo.outerPolyMm,
        holePolysMm: geo.holePolysMm,
        foldLinesMm: [],
        sampler: {
          mode: isWindowCanvas ? 'flat_window' : 'flat_expr_on_window',
          sourceKey: srcKey,
          profileKey: 'selfie_face',
          originX: geo.shiftX,
          originY: geo.shiftY,
          fullDims: geo.fullDims,
        },
      });

      items.push(mkFlat('face_primary', isSelfie ? 'Selfie Face' : `Face (${dec.expr || 'spark'})`, primaryKey, isSelfie));
      items.push(mkFlat('face_spare', isSelfie ? 'Selfie Face (spare)' : `Face (${dec.expr || 'spark'} spare)`, primaryKey, isSelfie));
      for (const bonusExpr of BONUS_EXPRESSIONS) {
        items.push(mkFlat(`face_bonus_${bonusExpr}`, `Bonus: ${bonusExpr}`, `face:${bonusExpr}:flat`, false));
      }
    } else if (dec.kind === 'human_face' && dec.faceInsert === 'vinyl') {
      // §8.1 C: Vinyl lenses are Ø5.5 mm raised caps; emit plain Ø5.00 mm circular iris stickers + kiss-cut brows, cheeks, smile (+ 1 spare set).
      const srcKey = `face:${dec.expr || 'spark'}:vinyl`;
      for (const pass of ['set1', 'spare']) {
        const sfx = pass === 'spare' ? ' (spare)' : '';
        const tag = pass === 'spare' ? '_spare' : '';
        for (const [side, uCenter] of [['l', 126 / 512], ['r', 386 / 512]]) {
          const diam = 5.0;
          items.push({
            id: `vinyl_iris_${side}${tag}`,
            kind: 'human_face_vinyl',
            label: `Vinyl Iris ${side.toUpperCase()}${sfx}`,
            w: diam,
            h: diam,
            bgHex: headSkinHex,
            outerPolyMm: ensureWinding(circlePoly(2.5, 2.5, 2.5, 36), true),
            holePolysMm: [],
            foldLinesMm: [],
            sampler: {
              mode: 'planar_uv_box',
              sourceKey: srcKey,
              u0: uCenter - (2.5 / 23.6),
              u1: uCenter + (2.5 / 23.6),
              v0: (123 / 256) - (2.5 / 10.1),
              v1: (123 / 256) + (2.5 / 10.1),
            },
          });
        }
        items.push(
          makeUnrolledCropSticker({ id: `vinyl_brow_l${tag}`, kind: 'human_face_vinyl', label: `Vinyl Brow L${sfx}`, sourceKey: srcKey, profileKey: 'human_face_vinyl', cropUv: { u0: 0.14, u1: 0.35, v0: 0.03, v1: 0.27 }, cornerRadiusMm: 0.9, bgHex: headSkinHex }),
          makeUnrolledCropSticker({ id: `vinyl_brow_r${tag}`, kind: 'human_face_vinyl', label: `Vinyl Brow R${sfx}`, sourceKey: srcKey, profileKey: 'human_face_vinyl', cropUv: { u0: 0.65, u1: 0.86, v0: 0.03, v1: 0.27 }, cornerRadiusMm: 0.9, bgHex: headSkinHex }),
          makeUnrolledCropSticker({ id: `vinyl_cheek_l${tag}`, kind: 'human_face_vinyl', label: `Vinyl Cheek L${sfx}`, sourceKey: srcKey, profileKey: 'human_face_vinyl', cropUv: { u0: 0.09, u1: 0.25, v0: 0.72, v1: 0.89 }, cornerRadiusMm: 0.8, bgHex: headSkinHex }),
          makeUnrolledCropSticker({ id: `vinyl_cheek_r${tag}`, kind: 'human_face_vinyl', label: `Vinyl Cheek R${sfx}`, sourceKey: srcKey, profileKey: 'human_face_vinyl', cropUv: { u0: 0.75, u1: 0.91, v0: 0.72, v1: 0.89 }, cornerRadiusMm: 0.8, bgHex: headSkinHex }),
          makeUnrolledCropSticker({ id: `vinyl_mouth${tag}`, kind: 'human_face_vinyl', label: `Vinyl Smile${sfx}`, sourceKey: srcKey, profileKey: 'human_face_vinyl', cropUv: { u0: 0.35, u1: 0.65, v0: 0.78, v1: 0.99 }, cornerRadiusMm: 0.9, bgHex: headSkinHex }),
        );
      }
    } else if (dec.kind === 'human_face') {
      // §8.1 C + Open Decision 5: Sculpted faceplate (`char_faceplate`) emits ONLY the 5-piece split kiss-cut set (+ 1 spare set). Zero nose keyhole!
      const srcKey = `face:${dec.expr || 'spark'}:sculpted`;
      for (const pass of ['set1', 'spare']) {
        const sfx = pass === 'spare' ? ' (spare)' : '';
        const tag = pass === 'spare' ? '_spare' : '';
        items.push(
          makeUnrolledCropSticker({ id: `sculpted_eye_l${tag}`, kind: 'human_face_sculpted', label: `Left Eye+Brow${sfx}`, sourceKey: srcKey, profileKey: 'human_face_sculpted', cropUv: { u0: 0.11, u1: 0.40, v0: 0.05, v1: 0.64 }, cornerRadiusMm: 1.4, bgHex: headSkinHex }),
          makeUnrolledCropSticker({ id: `sculpted_eye_r${tag}`, kind: 'human_face_sculpted', label: `Right Eye+Brow${sfx}`, sourceKey: srcKey, profileKey: 'human_face_sculpted', cropUv: { u0: 0.60, u1: 0.89, v0: 0.05, v1: 0.64 }, cornerRadiusMm: 1.4, bgHex: headSkinHex }),
          makeUnrolledCropSticker({ id: `sculpted_cheek_l${tag}`, kind: 'human_face_sculpted', label: `Left Cheek${sfx}`, sourceKey: srcKey, profileKey: 'human_face_sculpted', cropUv: { u0: 0.06, u1: 0.25, v0: 0.58, v1: 0.80 }, cornerRadiusMm: 1.0, bgHex: headSkinHex }),
          makeUnrolledCropSticker({ id: `sculpted_cheek_r${tag}`, kind: 'human_face_sculpted', label: `Right Cheek${sfx}`, sourceKey: srcKey, profileKey: 'human_face_sculpted', cropUv: { u0: 0.75, u1: 0.94, v0: 0.58, v1: 0.80 }, cornerRadiusMm: 1.0, bgHex: headSkinHex }),
          makeUnrolledCropSticker({ id: `sculpted_mouth${tag}`, kind: 'human_face_sculpted', label: `Mouth Strip${sfx}`, sourceKey: srcKey, profileKey: 'human_face_sculpted', cropUv: { u0: 0.34, u1: 0.66, v0: 0.76, v1: 0.99 }, cornerRadiusMm: 1.0, bgHex: headSkinHex }),
        );
      }
    } else if (dec.kind === 'classic_visor_face') {
      const srcKey = `classic_visor:${dec.expr || 'happy'}`;
      for (const [id, label] of [['visor_primary', `Classic Visor (${dec.expr})`], ['visor_spare', `Classic Visor (${dec.expr} spare)`]]) {
        items.push(makeUnrolledCropSticker({
          id,
          kind: 'classic_visor_face',
          label,
          sourceKey: srcKey,
          profileKey: 'classic_visor_face',
          cropUv: { u0: 0.03, u1: 0.97, v0: 0.06, v1: 0.94 },
          cornerRadiusMm: 4.5,
          bgHex: '#1C2338',
        }));
      }
    } else if (dec.kind === 'creature_face') {
      const headId = dec.head || state.head || 'fox';
      const profKey = UNROLL_PROFILES[`creature_${headId}`] ? `creature_${headId}` : 'creature_fox';
      const isRobot = headId === 'robot' || headId === 'scout';
      const bg = isRobot ? '#161D30' : (opts.creatureHeadHex || '#F4EFE6');
      const srcKey = `creature:${headId}:${dec.expr || 'spark'}`;
      for (const [id, label] of [[`creature_${headId}`, `${headId} Face`], [`creature_${headId}_spare`, `${headId} Face (spare)`]]) {
        items.push(makeUnrolledCropSticker({
          id,
          kind: 'creature_face',
          label,
          sourceKey: srcKey,
          profileKey: profKey,
          cropUv: { u0: 0.05, u1: 0.95, v0: 0.08, v1: 0.94 },
          cornerRadiusMm: 4.2,
          bgHex: bg,
        }));
      }
    } else if (dec.kind === 'shirt') {
      const profKey = edition === 'snap' ? 'shirt_snap' : 'shirt_pro';
      const fullDims = unrollDimensionsMm(profKey);
      const srcKey = `shirt:${dec.shirtId}`;
      for (const [id, label] of [[`shirt_${dec.shirtId}`, `Shirt (${dec.shirtId})`], [`shirt_${dec.shirtId}_spare`, `Shirt (${dec.shirtId} spare)`]]) {
        items.push({
          id,
          kind: 'shirt',
          label,
          w: fullDims.w,
          h: fullDims.h,
          bgHex: shirtHex,
          outerPolyMm: ensureWinding(roundedRectPoly(0, 0, fullDims.w, fullDims.h, 2.6), true),
          holePolysMm: [],
          foldLinesMm: [],
          sampler: {
            mode: 'unroll_crop',
            sourceKey: srcKey,
            profileKey: profKey,
            originX: 0,
            originY: 0,
            fullDims,
          },
        });
      }
    } else if (dec.kind === 'photo_accessory') {
      // F2b: a photo-shaped accessory. `dec.item` is the prebuilt cut path and photo map; the artwork is the device's own photo,
      // handed to the renderer as `renderedSources['photo:<id>']`. One sticker and one spare, like the face sets (`spare: false` for one).
      const base = photoAccessoryBase(dec.item);
      if (base) {
        items.push(base);
        if (dec.spare !== false) items.push({ ...base, id: `${base.id}_spare`, label: `${base.label} (spare)` });
      }
    } else if (dec.kind === 'craft_cutout') {
      // §8.1 C: Mirrored left & right panels joined across a vertical dashed fold line + 6.0 mm glue/mount tab inside one closed cut contour.
      const slot = dec.slot || 'hand';
      const panelW = slot === 'wings' ? 38.0 : (slot === 'crown' ? 28.0 : 30.0);
      const panelH = slot === 'wings' ? 34.0 : (slot === 'crown' ? 26.0 : 34.0);
      const tabW = 6.0;
      const tabInsetY = 5.0;
      const totalW = +(panelW * 2 + tabW).toFixed(3);
      const outerPolyMm = ensureWinding([
        [0, 0],
        [+(panelW * 2).toFixed(3), 0],
        [+(panelW * 2).toFixed(3), tabInsetY],
        [totalW, +(tabInsetY + 2.0).toFixed(3)],
        [totalW, +(panelH - tabInsetY - 2.0).toFixed(3)],
        [+(panelW * 2).toFixed(3), +(panelH - tabInsetY).toFixed(3)],
        [+(panelW * 2).toFixed(3), panelH],
        [0, panelH],
      ], true);
      items.push({
        id: `craft_${slot}`,
        kind: 'craft_cutout',
        label: `2D Fold-Tab Cutout: ${dec.label || slot}`,
        w: totalW,
        h: panelH,
        bgHex: '#FFFFFF',
        outerPolyMm,
        holePolysMm: [],
        foldLinesMm: [
          [[panelW, 0], [panelW, panelH]],
          [[+(panelW * 2).toFixed(3), tabInsetY], [+(panelW * 2).toFixed(3), +(panelH - tabInsetY).toFixed(3)]],
        ],
        sampler: {
          mode: 'mirrored_craft',
          sourceKey: `craft:${slot}`,
          panelW,
          panelH,
          tabW,
        },
      });
    }
  }

  // Deterministic shelf packing inside <= 168 mm width (leaves comfortable bleed + margin inside 180 x 240 mm Cricut limit)
  const marginMm = 4.0;
  const gapMm = 5.0;
  const maxInnerW = CRICUT_MAX_MM.w - marginMm * 2;
  let curX = marginMm;
  let curY = marginMm;
  let rowH = 0;
  let maxRight = marginMm * 2;

  const placed = items.map((it, idx) => {
    const needW = it.w + BLEED_MM * 2;
    const needH = it.h + BLEED_MM * 2;
    if (curX > marginMm && curX + needW > marginMm + maxInnerW) {
      curX = marginMm;
      curY += rowH + gapMm;
      rowH = 0;
    }
    const px = +(curX + BLEED_MM).toFixed(3);
    const py = +(curY + BLEED_MM).toFixed(3);
    curX += needW + gapMm;
    if (needH > rowH) rowH = needH;
    if (px + it.w + BLEED_MM > maxRight) maxRight = px + it.w + BLEED_MM;

    const scissorPolyMm = offsetPolygonRadialFromCentroid(it.outerPolyMm, SCISSOR_GUIDE_OFFSET_MM);
    return {
      ...it,
      index: idx,
      svgId: idx === 0 ? 'cut-line' : `cut-${idx + 1}`,
      x: px,
      y: py,
      scissorPolyMm,
    };
  });

  const activeW = +Math.max(40, Math.min(CRICUT_MAX_MM.w, maxRight + marginMm)).toFixed(3);
  const activeH = +Math.max(30, Math.min(CRICUT_MAX_MM.h, (placed.length ? curY + rowH + marginMm : 30))).toFixed(3);

  const safeX = +((pageSpec.w - SAFE_ZONE_MM.w) * 0.5).toFixed(3);
  const safeY = +((pageSpec.h - SAFE_ZONE_MM.h) * 0.5).toFixed(3);
  const headerH = 26.0;
  const activePageX = +(safeX + (SAFE_ZONE_MM.w - activeW) * 0.5).toFixed(3);
  const activePageY = +(safeY + headerH).toFixed(3);

  return {
    page: pageSpec,
    safeZoneMm: { x: safeX, y: safeY, w: SAFE_ZONE_MM.w, h: SAFE_ZONE_MM.h },
    scaleBarMm: {
      x: +(safeX + 4.0).toFixed(3),
      y: +(safeY + 16.5).toFixed(3),
      lengthMm: SCALE_BAR_MM,
    },
    activeBoxMm: {
      x: activePageX,
      y: activePageY,
      w: activeW,
      h: activeH,
    },
    bleedMm: BLEED_MM,
    items: placed,
    warnings: [PRINT_PAGE_WARNINGS.small_part, PRINT_PAGE_WARNINGS.always],
  };
}

// ---------------------------------------------------------------------------------------------
// 3. Pure Raster Sampling, Polygon Masking & 1.0 mm Nearest-Opaque Bleed Dilation
// ---------------------------------------------------------------------------------------------
function parseHexRgb(hex) {
  const h = normHex(hex || '#FFFFFF').slice(1);
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInsideSticker(xMm, yMm, item) {
  if (!pointInPoly(xMm, yMm, item.outerPolyMm)) return false;
  for (const hole of item.holePolysMm || []) {
    if (pointInPoly(xMm, yMm, hole)) return false;
  }
  return true;
}

function sampleRgbaBilinear(src, u, v) {
  if (!src || !src.data || src.w <= 0 || src.h <= 0) return [0, 0, 0, 0];
  if (u < 0 || u > 1 || v < 0 || v > 1) return [0, 0, 0, 0];
  const fx = Math.max(0, Math.min(src.w - 1, u * (src.w - 1)));
  const fy = Math.max(0, Math.min(src.h - 1, v * (src.h - 1)));
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(src.w - 1, x0 + 1), y1 = Math.min(src.h - 1, y0 + 1);
  const tx = fx - x0, ty = fy - y0;
  const d = src.data;
  const i00 = (y0 * src.w + x0) * 4;
  const i10 = (y0 * src.w + x1) * 4;
  const i01 = (y1 * src.w + x0) * 4;
  const i11 = (y1 * src.w + x1) * 4;
  const w00 = (1 - tx) * (1 - ty);
  const w10 = tx * (1 - ty);
  const w01 = (1 - tx) * ty;
  const w11 = tx * ty;
  return [
    Math.round(d[i00] * w00 + d[i10] * w10 + d[i01] * w01 + d[i11] * w11),
    Math.round(d[i00 + 1] * w00 + d[i10 + 1] * w10 + d[i01 + 1] * w01 + d[i11 + 1] * w11),
    Math.round(d[i00 + 2] * w00 + d[i10 + 2] * w10 + d[i01 + 2] * w01 + d[i11 + 2] * w11),
    Math.round(d[i00 + 3] * w00 + d[i10 + 3] * w10 + d[i01 + 3] * w01 + d[i11 + 3] * w11),
  ];
}

/**
 * Dilate opaque pixels (`alpha > 0`) outward by `radiusPx` pixels using a two-pass Manhattan/chamfer flood
 * so every sticker carries a true 1.0 mm colour bleed outside its cut line with zero white registration halos.
 */
export function dilateBleedRgba(rgba, w, h, radiusPx) {
  const rad = Math.max(0, Math.ceil(radiusPx));
  if (rad === 0) return new Uint8ClampedArray(rgba);
  let cur = new Uint8ClampedArray(rgba);
  let next = new Uint8ClampedArray(rgba.length);
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];

  for (let step = 0; step < rad; step++) {
    next.set(cur);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        if (cur[idx + 3] >= 250) continue;
        let sr = 0, sg = 0, sb = 0, count = 0;
        for (let k = 0; k < 8; k++) {
          // Alternate 4-neighbour and 8-neighbour steps to approximate Euclidean disk (`1 + sqrt(2)` ratio)
          if (k >= 4 && (step % 2 === 1)) continue;
          const nx = x + dirs[k][0], ny = y + dirs[k][1];
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          const nIdx = (ny * w + nx) * 4;
          if (cur[nIdx + 3] >= 250) {
            sr += cur[nIdx];
            sg += cur[nIdx + 1];
            sb += cur[nIdx + 2];
            count++;
          }
        }
        if (count > 0) {
          next[idx] = Math.round(sr / count);
          next[idx + 1] = Math.round(sg / count);
          next[idx + 2] = Math.round(sb / count);
          next[idx + 3] = 255;
        }
      }
    }
    const tmp = cur;
    cur = next;
    next = tmp;
  }
  return cur;
}

/**
 * Render one planned sticker item (with `bleedMm` padding all around) into `{ w, h, bleedPx, data: Uint8ClampedArray }`.
 */
export function renderStickerItemRgba(item, renderedSources = {}, dpi = 300, bleedMm = BLEED_MM) {
  const pxPerMm = dpi / 25.4;
  const totalWMm = item.w + bleedMm * 2;
  const totalHMm = item.h + bleedMm * 2;
  const w = Math.max(4, Math.round(totalWMm * pxPerMm));
  const h = Math.max(4, Math.round(totalHMm * pxPerMm));
  const bleedPx = Math.round(bleedMm * pxPerMm);
  const raw = new Uint8ClampedArray(w * h * 4);
  const [bgR, bgG, bgB] = parseHexRgb(item.bgHex);
  const smp = item.sampler;
  const src = renderedSources[smp.sourceKey] || null;

  for (let py = 0; py < h; py++) {
    const localYMm = ((py + 0.5) / h) * totalHMm - bleedMm;
    for (let px = 0; px < w; px++) {
      const localXMm = ((px + 0.5) / w) * totalWMm - bleedMm;
      if (!pointInsideSticker(localXMm, localYMm, item)) continue;

      let u = 0.5, v = 0.5;
      if (smp.mode === 'flat_window') {
        const [uu, vv] = inverseUnrollUv(smp.profileKey, smp.originX + localXMm, smp.originY + localYMm, smp.fullDims);
        u = uu;
        v = vv;
      } else if (smp.mode === 'flat_expr_on_window') {
        // Map physical flat-plate window `(xPlate, zb)` into the `23.6 x 10.1 mm` (`zb in [0.20, 10.30]`) 2D expression plane
        const [uu, vv] = inverseUnrollUv(smp.profileKey, smp.originX + localXMm, smp.originY + localYMm, smp.fullDims);
        const xPlate = (uu - 0.5) * WINDOW_MM.w;
        const zb = WINDOW_ZB.max - vv * WINDOW_MM.h;
        u = (xPlate + 11.8) / 23.6;
        v = (10.30 - zb) / 10.10;
      } else if (smp.mode === 'unroll_crop') {
        const [uu, vv] = inverseUnrollUv(smp.profileKey, smp.originX + localXMm, smp.originY + localYMm, smp.fullDims);
        u = uu;
        v = vv;
      } else if (smp.mode === 'planar_uv_box') {
        u = smp.u0 + (localXMm / item.w) * (smp.u1 - smp.u0);
        v = smp.v0 + (localYMm / item.h) * (smp.v1 - smp.v0);
      } else if (smp.mode === 'photo_outline') {
        // Sticker millimetre -> a pixel of the photo the outline came from -> the same place in the source we were handed,
        // which may be any resolution of that photo (pixel centres line up: index i of W sits at (i + 0.5) / W).
        const m = smp.stickerToPhoto;
        const ix = m[0] * localXMm + m[2] * localYMm + m[4];
        const iy = m[1] * localXMm + m[3] * localYMm + m[5];
        const sw = src ? src.w : 1;
        const sh = src ? src.h : 1;
        const pw = smp.photoSize ? smp.photoSize.width : sw;
        const ph = smp.photoSize ? smp.photoSize.height : sh;
        // Clamped: the cut path hugs the object, and a path a hair past the photo's edge must repeat the edge colour, not print white.
        u = sw > 1 ? Math.min(1, Math.max(0, ((ix + 0.5) * sw / pw - 0.5) / (sw - 1))) : 0.5;
        v = sh > 1 ? Math.min(1, Math.max(0, ((iy + 0.5) * sh / ph - 0.5) / (sh - 1))) : 0.5;
      } else if (smp.mode === 'mirrored_craft') {
        if (localXMm <= smp.panelW) {
          u = localXMm / smp.panelW;
          v = localYMm / smp.panelH;
        } else if (localXMm <= smp.panelW * 2) {
          // Mirrored back panel across fold line at `x = panelW`
          u = 1.0 - ((localXMm - smp.panelW) / smp.panelW);
          v = localYMm / smp.panelH;
        } else {
          // Glue tab stays clean light tab grey
          const o = (py * w + px) * 4;
          raw[o] = 242; raw[o + 1] = 244; raw[o + 2] = 248; raw[o + 3] = 255;
          continue;
        }
      }

      const [sr, sg, sb, sa] = sampleRgbaBilinear(src, u, v);
      const aFrac = sa / 255;
      const o = (py * w + px) * 4;
      raw[o] = Math.round(sr * aFrac + bgR * (1 - aFrac));
      raw[o + 1] = Math.round(sg * aFrac + bgG * (1 - aFrac));
      raw[o + 2] = Math.round(sb * aFrac + bgB * (1 - aFrac));
      raw[o + 3] = 255;
    }
  }

  const bled = dilateBleedRgba(raw, w, h, bleedPx);
  return { w, h, bleedPx, bleedMm, totalWMm, totalHMm, data: bled };
}

// ---------------------------------------------------------------------------------------------
// 4. Pure JS Zlib (RFC 1950 + Fixed-Huffman LZ77 RFC 1951) & RGBA PNG Encoder with `pHYs`
// ---------------------------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32Bytes(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function adler32Bytes(u8) {
  let a = 1, b = 0;
  const MOD = 65521;
  for (let i = 0; i < u8.length;) {
    const end = Math.min(u8.length, i + 5550);
    for (; i < end; i++) {
      a += u8[i];
      b += a;
    }
    a %= MOD;
    b %= MOD;
  }
  return ((b << 16) | a) >>> 0;
}

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

function reverseBits(val, bits) {
  let out = 0;
  for (let i = 0; i < bits; i++) {
    out = (out << 1) | (val & 1);
    val >>>= 1;
  }
  return out;
}

const FIXED_LIT_CODE = new Uint16Array(288);
const FIXED_LIT_BITS = new Uint8Array(288);
for (let s = 0; s <= 143; s++) { FIXED_LIT_CODE[s] = reverseBits(0x30 + s, 8); FIXED_LIT_BITS[s] = 8; }
for (let s = 144; s <= 255; s++) { FIXED_LIT_CODE[s] = reverseBits(0x190 + (s - 144), 9); FIXED_LIT_BITS[s] = 9; }
for (let s = 256; s <= 279; s++) { FIXED_LIT_CODE[s] = reverseBits(s - 256, 7); FIXED_LIT_BITS[s] = 7; }
for (let s = 280; s <= 287; s++) { FIXED_LIT_CODE[s] = reverseBits(0xc0 + (s - 280), 8); FIXED_LIT_BITS[s] = 8; }

const FIXED_DIST_CODE = new Uint8Array(30);
for (let d = 0; d < 30; d++) FIXED_DIST_CODE[d] = reverseBits(d, 5);

/** Pure JS RFC 1950 zlib compressor using fast LZ77 + Fixed Huffman (`BTYPE=01`). Zero external libraries. */
export function zlibCompressPure(input) {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  const cap = Math.max(64, u8.length + (u8.length >>> 3) + 32);
  let out = new Uint8Array(cap);
  let outPos = 0;
  const ensure = (more) => {
    if (outPos + more <= out.length) return;
    const grown = new Uint8Array(Math.max(out.length * 2, outPos + more));
    grown.set(out);
    out = grown;
  };

  // Zlib header: CMF=0x78 (Deflate, 32K window), FLG=0x9C (default compression, header % 31 == 0)
  out[outPos++] = 0x78;
  out[outPos++] = 0x9c;

  let bitBuf = 0;
  let bitCount = 0;
  const putBits = (bits, count) => {
    bitBuf |= (bits << bitCount);
    bitCount += count;
    while (bitCount >= 8) {
      ensure(4);
      out[outPos++] = bitBuf & 0xff;
      bitBuf >>>= 8;
      bitCount -= 8;
    }
  };

  // Final block (`BFINAL=1`) + Fixed Huffman (`BTYPE=01`) => bits `0b011 = 3` (3 bits LSB-first: BFINAL=1, BTYPE=01)
  putBits(0b011, 3);

  const hashHead = new Int32Array(16384);
  hashHead.fill(-1);
  const n = u8.length;
  let pos = 0;

  while (pos < n) {
    let matchLen = 0;
    let matchDist = 0;
    if (pos + 3 <= n) {
      const h = (((u8[pos] << 10) ^ (u8[pos + 1] << 5) ^ u8[pos + 2]) & 0x3fff);
      const prev = hashHead[h];
      hashHead[h] = pos;
      if (prev >= 0 && prev < pos && pos - prev <= 32768) {
        const maxL = Math.min(258, n - pos);
        let l = 0;
        while (l < maxL && u8[prev + l] === u8[pos + l]) l++;
        if (l >= 3) {
          matchLen = l;
          matchDist = pos - prev;
        }
      }
      // Also check run-length (`dist = 1` or `dist = 4` for RGBA pixels!)
      for (const dCand of [1, 4]) {
        if (pos >= dCand && matchLen < 258) {
          const maxL = Math.min(258, n - pos);
          let l = 0;
          const p0 = pos - dCand;
          while (l < maxL && u8[p0 + l] === u8[pos + l]) l++;
          if (l > matchLen && l >= 3) {
            matchLen = l;
            matchDist = dCand;
          }
        }
      }
    }

    if (matchLen >= 3) {
      // Find length code
      let lc = 28;
      for (let k = 0; k < 28; k++) {
        if (matchLen < LEN_BASE[k + 1]) { lc = k; break; }
      }
      const sym = 257 + lc;
      putBits(FIXED_LIT_CODE[sym], FIXED_LIT_BITS[sym]);
      if (LEN_EXTRA[lc] > 0) putBits(matchLen - LEN_BASE[lc], LEN_EXTRA[lc]);

      // Find distance code
      let dc = 29;
      for (let k = 0; k < 29; k++) {
        if (matchDist < DIST_BASE[k + 1]) { dc = k; break; }
      }
      putBits(FIXED_DIST_CODE[dc], 5);
      if (DIST_EXTRA[dc] > 0) putBits(matchDist - DIST_BASE[dc], DIST_EXTRA[dc]);

      const endStep = Math.min(n - 3, pos + matchLen - 1);
      for (let p = pos + 1; p <= endStep; p++) {
        const hh = (((u8[p] << 10) ^ (u8[p + 1] << 5) ^ u8[p + 2]) & 0x3fff);
        hashHead[hh] = p;
      }
      pos += matchLen;
    } else {
      const lit = u8[pos++];
      putBits(FIXED_LIT_CODE[lit], FIXED_LIT_BITS[lit]);
    }
  }

  // End-of-block symbol 256
  putBits(FIXED_LIT_CODE[256], FIXED_LIT_BITS[256]);
  if (bitCount > 0) {
    ensure(2);
    out[outPos++] = bitBuf & 0xff;
  }

  ensure(4);
  const adler = adler32Bytes(u8);
  out[outPos++] = (adler >>> 24) & 0xff;
  out[outPos++] = (adler >>> 16) & 0xff;
  out[outPos++] = (adler >>> 8) & 0xff;
  out[outPos++] = adler & 0xff;
  return out.subarray(0, outPos);
}

function makePngChunk(typeAscii, payload) {
  const chunk = new Uint8Array(12 + payload.length);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, payload.length, false);
  for (let i = 0; i < 4; i++) chunk[4 + i] = typeAscii.charCodeAt(i);
  chunk.set(payload, 8);
  dv.setUint32(8 + payload.length, crc32Bytes(chunk.subarray(4, 8 + payload.length)), false);
  return chunk;
}

/** Encode an RGBA buffer (`w * h * 4`) to a valid PNG with an explicit `pHYs` DPI chunk right after `IHDR`. */
export function encodeRgbaPng(rgba, w, h, dpi = 300) {
  const rowStride = w * 4 + 1;
  const rawScanlines = new Uint8Array(rowStride * h);
  for (let y = 0; y < h; y++) {
    const rowOff = y * rowStride;
    rawScanlines[rowOff] = 0; // Filter 0 (None) pairs cleanly with 4-byte LZ77 stride
    const srcOff = y * w * 4;
    rawScanlines.set(rgba.subarray(srcOff, srcOff + w * 4), rowOff + 1);
  }
  const idatPayload = zlibCompressPure(rawScanlines);

  const ihdr = new Uint8Array(13);
  const idv = new DataView(ihdr.buffer);
  idv.setUint32(0, w, false);
  idv.setUint32(4, h, false);
  ihdr[8] = 8; // 8-bit depth
  ihdr[9] = 6; // RGBA truecolour with alpha
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const ppm = Math.round(dpi / 0.0254);
  const phys = new Uint8Array(9);
  const pdv = new DataView(phys.buffer);
  pdv.setUint32(0, ppm, false);
  pdv.setUint32(4, ppm, false);
  phys[8] = 1; // pixels per metre

  const sig = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const cIhdr = makePngChunk('IHDR', ihdr);
  const cPhys = makePngChunk('pHYs', phys);
  const cIdat = makePngChunk('IDAT', idatPayload);
  const cIend = makePngChunk('IEND', new Uint8Array(0));

  const total = sig.length + cIhdr.length + cPhys.length + cIdat.length + cIend.length;
  const png = new Uint8Array(total);
  let p = 0;
  for (const part of [sig, cIhdr, cPhys, cIdat, cIend]) {
    png.set(part, p);
    p += part.length;
  }
  return png;
}

// ---------------------------------------------------------------------------------------------
// 5. Transparent Print-Then-Cut PNG, Vector Cut SVG, Silhouette DXF, and 1:1 mm PDF 1.6 Writer
// ---------------------------------------------------------------------------------------------

/** Render the entire active sticker sheet (`activeBoxMm.w x activeBoxMm.h`) as a transparent RGBA PNG with 1.0 mm bleed and truthful `pHYs`. */
export function stickersToPng(sheetPlan, renderedSources = {}, opts = {}) {
  const dpi = opts.dpi || 300;
  const pxPerMm = dpi / 25.4;
  const sheetW = Math.max(8, Math.round(sheetPlan.activeBoxMm.w * pxPerMm));
  const sheetH = Math.max(8, Math.round(sheetPlan.activeBoxMm.h * pxPerMm));
  const rgba = new Uint8Array(sheetW * sheetH * 4);

  for (const it of sheetPlan.items) {
    const rendered = renderStickerItemRgba(it, renderedSources, dpi, sheetPlan.bleedMm);
    const dstX0 = Math.round((it.x - sheetPlan.bleedMm) * pxPerMm);
    const dstY0 = Math.round((it.y - sheetPlan.bleedMm) * pxPerMm);
    for (let sy = 0; sy < rendered.h; sy++) {
      const dy = dstY0 + sy;
      if (dy < 0 || dy >= sheetH) continue;
      for (let sx = 0; sx < rendered.w; sx++) {
        const dx = dstX0 + sx;
        if (dx < 0 || dx >= sheetW) continue;
        const sOff = (sy * rendered.w + sx) * 4;
        if (rendered.data[sOff + 3] === 0) continue;
        const dOff = (dy * sheetW + dx) * 4;
        rgba[dOff] = rendered.data[sOff];
        rgba[dOff + 1] = rendered.data[sOff + 1];
        rgba[dOff + 2] = rendered.data[sOff + 2];
        rgba[dOff + 3] = rendered.data[sOff + 3];
      }
    }
  }
  return encodeRgbaPng(rgba, sheetW, sheetH, dpi);
}

function polyToSvgSubpath(poly, offX, offY) {
  return `M${poly.map(([x, y]) => `${+(offX + x).toFixed(3)} ${+(offY + y).toFixed(3)}`).join(' L')} Z`;
}

/**
 * Cricut Design Space & Brother CanvasWorkspace compatible vector-only cut SVG (§8.1 D):
 * - Dimensions in `mm` matching `stickers.png` (`activeBoxMm.w x activeBoxMm.h`).
 * - `<g id="cut">` with one closed, flat-filled `<path>` per sticker (`id="cut-line"` on primary).
 * - Zero `<image>`, `<clipPath>`, `<text>`, or `<pattern>` elements.
 */
export function stickersCutSvg(sheetPlan) {
  const W = sheetPlan.activeBoxMm.w;
  const H = sheetPlan.activeBoxMm.h;
  const paths = sheetPlan.items.map((it) => {
    const dParts = [polyToSvgSubpath(it.outerPolyMm, it.x, it.y)];
    for (const hole of it.holePolysMm || []) {
      dParts.push(polyToSvgSubpath(hole, it.x, it.y));
    }
    const rule = (it.holePolysMm && it.holePolysMm.length) ? ' fill-rule="evenodd"' : '';
    return `<path id="${it.svgId}" d="${dParts.join(' ')}" fill="#1b2238" stroke="none"${rule}/>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">`
    + `<g id="cut">${paths.join('')}</g>`
    + `</svg>\n`;
}

/** Silhouette Studio Basic Edition compatible ASCII R12 DXF (`$INSUNITS = 4` mm, closed `POLYLINE`s on layer `CUT`). */
export function stickersCutDxf(sheetPlan) {
  const H = sheetPlan.activeBoxMm.h;
  const lines = [
    '0', 'SECTION',
    '2', 'HEADER',
    '9', '$ACADVER', '1', 'AC1009',
    '9', '$INSUNITS', '70', '4',
    '0', 'ENDSEC',
    '0', 'SECTION',
    '2', 'TABLES',
    '0', 'TABLE', '2', 'LAYER', '70', '1',
    '0', 'LAYER', '2', 'CUT', '70', '0', '62', '7', '6', 'CONTINUOUS',
    '0', 'ENDTAB',
    '0', 'ENDSEC',
    '0', 'SECTION',
    '2', 'ENTITIES',
  ];

  const emitClosedPoly = (poly, offX, offY) => {
    lines.push('0', 'POLYLINE', '8', 'CUT', '66', '1', '70', '1');
    for (const [x, y] of poly) {
      const dx = +(offX + x).toFixed(3);
      const dy = +(H - (offY + y)).toFixed(3);
      lines.push('0', 'VERTEX', '8', 'CUT', '10', String(dx), '20', String(dy), '30', '0.0');
    }
    lines.push('0', 'SEQEND', '8', 'CUT');
  };

  for (const it of sheetPlan.items) {
    emitClosedPoly(it.outerPolyMm, it.x, it.y);
    for (const hole of it.holePolysMm || []) {
      emitClosedPoly(hole, it.x, it.y);
    }
  }

  lines.push('0', 'ENDSEC', '0', 'EOF', '');
  return lines.join('\n');
}

function pdfEsc(str) {
  return String(str)
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x20-\x7e]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function wrapChars(text, maxChars) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const out = [];
  let line = '';
  for (const w of words) {
    const cand = line ? `${line} ${w}` : w;
    if (cand.length <= maxChars || !line) line = cand;
    else { out.push(line); line = w; }
  }
  if (line) out.push(line);
  return out;
}

/**
 * Pure JS PDF 1.6 writer at exact 1:1 millimetre scale (§8.1 D, §9.3):
 * - `/ViewerPreferences << /PrintScaling /None /Enforce [/PrintScaling] >>`
 * - Mandatory `50.00 mm` (`141.7323 pt`) calibration scale bar with tick marks & `100% / Actual size` instruction
 * - Per-sticker `/FlateDecode` `/Image` + `/SMask` streams with 1.0 mm bleed, dashed 1.2 mm scissor guides, and dashed fold lines
 * - Boxed `16 CFR 1500.19(d)` warning notice with exclamation triangle (`>=` `WARNING` cap height) and repo warning strings.
 */
export function stickersToPdf(sheetPlan, renderedSources = {}, opts = {}) {
  const dpi = opts.dpi || 300;
  const MM_TO_PT = 72 / 25.4;
  const pt = (mm) => +(mm * MM_TO_PT).toFixed(4);
  const pageW = sheetPlan.page.w;
  const pageH = sheetPlan.page.h;
  const py = (yTopMm) => pt(pageH - yTopMm);

  const enc = new TextEncoder();
  const objects = []; // 1-based PDF objects (`{ bodyBytes }`)
  const addObj = (parts) => {
    const chunks = parts.map((p) => (typeof p === 'string' ? enc.encode(p) : p));
    const len = chunks.reduce((a, c) => a + c.length, 0);
    const merged = new Uint8Array(len);
    let o = 0;
    for (const c of chunks) { merged.set(c, o); o += c.length; }
    objects.push(merged);
    return objects.length;
  };

  // Reserve catalog (1), pages (2), page (3), Helvetica (4), Helvetica-Bold (5)
  objects.push(new Uint8Array(0), new Uint8Array(0), new Uint8Array(0));
  const fontRegId = addObj(['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']);
  const fontBoldId = addObj(['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>']);

  const xObjectEntries = [];
  const contentOps = [];

  // 1. Header & Mandatory 50.00 mm Calibration Scale Bar
  const sx = sheetPlan.safeZoneMm.x;
  const sy = sheetPlan.safeZoneMm.y;
  contentOps.push(
    'q',
    '0.106 0.133 0.220 rg',
    `BT /F2 12 Tf ${pt(sx)} ${py(sy + 5.5)} Td (Kip 1:1 Printable Sticker Sheet) Tj ET`,
    `BT /F1 8.5 Tf ${pt(sx)} ${py(sy + 10.2)} Td (Print at 100% / Actual size \\(Page Scaling: None\\), then measure the 50.00 mm bar below before cutting.) Tj ET`,
    'Q',
  );

  // Exact 50.00 mm vector scale bar (`x1 - x0 = 50.00 * 72 / 25.4 = 141.7323 pt`)
  const bx0 = pt(sheetPlan.scaleBarMm.x);
  const bx1 = pt(sheetPlan.scaleBarMm.x + SCALE_BAR_MM);
  const by0 = py(sheetPlan.scaleBarMm.y);
  contentOps.push(
    'q',
    '0.106 0.133 0.220 RG',
    '1.2 w',
    '[] 0 d',
    // Kip scale bar: exact 50.00 mm span
    `${bx0} ${by0} m ${bx1} ${by0} l S`,
    `${bx0} ${+(by0 - pt(2.0)).toFixed(4)} m ${bx0} ${+(by0 + pt(2.0)).toFixed(4)} l S`,
    `${bx1} ${+(by0 - pt(2.0)).toFixed(4)} m ${bx1} ${+(by0 + pt(2.0)).toFixed(4)} l S`,
  );
  for (let mm = 10; mm < SCALE_BAR_MM; mm += 10) {
    const tx = pt(sheetPlan.scaleBarMm.x + mm);
    contentOps.push(`${tx} ${+(by0 - pt(1.1)).toFixed(4)} m ${tx} ${+(by0 + pt(1.1)).toFixed(4)} l S`);
  }
  contentOps.push(
    '0.106 0.133 0.220 rg',
    `BT /F2 8.5 Tf ${+(bx1 + pt(3.0)).toFixed(4)} ${+(by0 - pt(1.0)).toFixed(4)} Td (50.00 mm) Tj ET`,
    'Q',
  );

  // 2. Render each sticker item with 1.0 mm bleed + SMask + 1.2 mm dashed scissor guide + dashed fold lines
  const actX = sheetPlan.activeBoxMm.x;
  const actY = sheetPlan.activeBoxMm.y;

  sheetPlan.items.forEach((it, idx) => {
    const rendered = renderStickerItemRgba(it, renderedSources, dpi, sheetPlan.bleedMm);
    const pxCount = rendered.w * rendered.h;
    const rgbRaw = new Uint8Array(pxCount * 3);
    const alphaRaw = new Uint8Array(pxCount);
    for (let i = 0; i < pxCount; i++) {
      rgbRaw[i * 3] = rendered.data[i * 4];
      rgbRaw[i * 3 + 1] = rendered.data[i * 4 + 1];
      rgbRaw[i * 3 + 2] = rendered.data[i * 4 + 2];
      alphaRaw[i] = rendered.data[i * 4 + 3];
    }
    const zAlpha = zlibCompressPure(alphaRaw);
    const zRgb = zlibCompressPure(rgbRaw);

    const smaskId = addObj([
      `<< /Type /XObject /Subtype /Image /Width ${rendered.w} /Height ${rendered.h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${zAlpha.length} >>\nstream\n`,
      zAlpha,
      '\nendstream',
    ]);
    const imgId = addObj([
      `<< /Type /XObject /Subtype /Image /Width ${rendered.w} /Height ${rendered.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask ${smaskId} 0 R /Filter /FlateDecode /Length ${zRgb.length} >>\nstream\n`,
      zRgb,
      '\nendstream',
    ]);
    const imName = `Im${idx + 1}`;
    xObjectEntries.push(`/${imName} ${imgId} 0 R`);

    const imgXMm = actX + it.x - sheetPlan.bleedMm;
    const imgBottomYMm = actY + it.y - sheetPlan.bleedMm + rendered.totalHMm;
    contentOps.push(
      'q',
      `${pt(rendered.totalWMm)} 0 0 ${pt(rendered.totalHMm)} ${pt(imgXMm)} ${py(imgBottomYMm)} cm`,
      `/${imName} Do`,
      'Q',
    );

    // Faint solid kiss-cut hairline on exact cut contour + reliefs so hand-cutters see exact edge and reliefs
    contentOps.push('q', '0.25 0.30 0.42 RG', '0.35 w', '[] 0 d');
    for (const poly of [it.outerPolyMm, ...(it.holePolysMm || [])]) {
      const cmds = poly.map(([px, pyMm], pi) => `${pt(actX + it.x + px)} ${py(actY + it.y + pyMm)} ${pi === 0 ? 'm' : 'l'}`);
      contentOps.push(`${cmds.join(' ')} h S`);
    }
    contentOps.push('Q');

    // Faint dashed scissor guide 1.2 mm outside outer cut path (§8.1 D)
    if (it.scissorPolyMm && it.scissorPolyMm.length) {
      contentOps.push('q', '0.58 0.62 0.72 RG', '0.45 w', '[2.5 2.0] 0 d');
      const cmds = it.scissorPolyMm.map(([px, pyMm], pi) => `${pt(actX + it.x + px)} ${py(actY + it.y + pyMm)} ${pi === 0 ? 'm' : 'l'}`);
      contentOps.push(`${cmds.join(' ')} h S`, 'Q');
    }

    // Dashed fold lines for 2D Photo-Forge craft cutouts
    if (it.foldLinesMm && it.foldLinesMm.length) {
      contentOps.push('q', '0.95 0.40 0.25 RG', '0.6 w', '[3.0 2.0] 0 d');
      for (const [[x0, y0], [x1, y1]] of it.foldLinesMm) {
        contentOps.push(`${pt(actX + it.x + x0)} ${py(actY + it.y + y0)} m ${pt(actX + it.x + x1)} ${py(actY + it.y + y1)} l S`);
      }
      contentOps.push('Q');
    }
  });

  // 3. Boxed 16 CFR 1500.19(d) Safety Warning Footer (triangle >= WARNING height + multi-line English block)
  const warnLines = [
    ...wrapChars(PRINT_PAGE_WARNINGS.small_part, 108),
    ...wrapChars(PRINT_PAGE_WARNINGS.always, 108),
  ];
  const boxH = 11.0 + warnLines.length * 3.6;
  const boxTopY = sheetPlan.safeZoneMm.y + sheetPlan.safeZoneMm.h - boxH;
  const boxX = sheetPlan.safeZoneMm.x;
  const boxW = sheetPlan.safeZoneMm.w;

  contentOps.push(
    'q',
    '1.0 0.973 0.933 rg',
    '0.106 0.133 0.220 RG',
    '1.2 w',
    '[] 0 d',
    `${pt(boxX)} ${py(boxTopY + boxH)} ${pt(boxW)} ${pt(boxH)} re B`,
    // Exclamation triangle (4.6 mm tall >= 10 pt WARNING cap height)
    '1.0 0.722 0.188 rg',
    `${pt(boxX + 5.8)} ${py(boxTopY + 2.0)} m ${pt(boxX + 8.4)} ${py(boxTopY + 6.6)} l ${pt(boxX + 3.2)} ${py(boxTopY + 6.6)} l h B`,
    '0.106 0.133 0.220 rg',
    `BT /F2 8.5 Tf ${pt(boxX + 5.2)} ${py(boxTopY + 6.1)} Td (!) Tj ET`,
    `BT /F2 10 Tf ${pt(boxX + 10.2)} ${py(boxTopY + 6.1)} Td (WARNING) Tj ET`,
  );
  warnLines.forEach((ln, idx) => {
    contentOps.push(`BT /F1 7.6 Tf ${pt(boxX + 3.5)} ${py(boxTopY + 10.2 + idx * 3.5)} Td (${pdfEsc(ln)}) Tj ET`);
  });
  contentOps.push('Q');

  const contentBytes = enc.encode(contentOps.join('\n'));
  const contentId = addObj([
    `<< /Length ${contentBytes.length} >>\nstream\n`,
    contentBytes,
    '\nendstream',
  ]);

  // Fill reserved objects 1, 2, 3
  objects[0] = enc.encode('<< /Type /Catalog /Pages 2 0 R /ViewerPreferences << /PrintScaling /None /Enforce [/PrintScaling] >> >>');
  objects[1] = enc.encode('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objects[2] = enc.encode(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pt(pageW)} ${pt(pageH)}] `
    + `/Resources << /Font << /F1 ${fontRegId} 0 R /F2 ${fontBoldId} 0 R >> /XObject << ${xObjectEntries.join(' ')} >> >> `
    + `/Contents ${contentId} 0 R >>`,
  );

  // Assemble PDF 1.6 byte stream with xref table
  const pdfChunks = [enc.encode('%PDF-1.6\n%\xe2\xe3\xcf\xd3\n')];
  let byteOffset = pdfChunks[0].length;
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(byteOffset);
    const head = enc.encode(`${i + 1} 0 obj\n`);
    const tail = enc.encode('\nendobj\n');
    pdfChunks.push(head, objects[i], tail);
    byteOffset += head.length + objects[i].length + tail.length;
  }

  const xrefOffset = byteOffset;
  const xrefLines = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`];
  for (let i = 1; i <= objects.length; i++) {
    xrefLines.push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  xrefLines.push(
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  );
  pdfChunks.push(enc.encode(xrefLines.join('')));

  const totalLen = pdfChunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(totalLen);
  let pos = 0;
  for (const c of pdfChunks) { out.set(c, pos); pos += c.length; }
  return out;
}

/** Build all four `stickers/*` pack entries (`sticker-sheet.pdf`, `stickers.png`, `stickers-cut.svg`, `stickers-cut.dxf`). */
export function buildStickerPackFiles(bomDecals, state, renderedSources = {}, opts = {}) {
  const sheetPlan = planStickerSheet(bomDecals, state, opts);
  if (!sheetPlan.items.length) return [];
  return [
    { name: 'stickers/sticker-sheet.pdf', data: stickersToPdf(sheetPlan, renderedSources, opts) },
    { name: 'stickers/stickers.png', data: stickersToPng(sheetPlan, renderedSources, opts) },
    { name: 'stickers/stickers-cut.svg', data: stickersCutSvg(sheetPlan) },
    { name: 'stickers/stickers-cut.dxf', data: stickersCutDxf(sheetPlan) },
  ];
}
