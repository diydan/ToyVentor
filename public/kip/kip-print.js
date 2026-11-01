// Kip print view core: inventory, STL I/O, orientation + support scoring, deterministic plate packer, exports.
//
// Everything in this file is pure (typed arrays in, typed arrays out; no DOM, no three.js), so vitest and
// scripts/kip-plate-check.mjs run the same code the browser runs. The three.js plate view lives in
// kip-print-view.js and only calls into this module.

import {
  resolveSceneBom,
  normHex,
  colorNameForHex,
  colorSlug,
} from './kip-print-bom.js';
import {
  clampProfile,
  createDefaultProfile,
  consolidateColors,
  estimateSpoolAndChanges,
  fitCompensationForProfile,
  partMassEstimateGrams,
} from './kip-print-profile.js';
import {
  SPRUE_SPEC,
  sprueMarginMm,
  sprueUsableBoundMm,
  isSprueEligiblePart,
  samplePartAnchors,
  buildSprueCard,
  checkSprueCard,
  sliceMeshAtZ,
  pointToSegDistSq,
  segToSegDist,
} from './kip-print-sprue.js';

export {
  SPRUE_SPEC,
  isSprueEligiblePart,
  samplePartAnchors,
  buildSprueCard,
  checkSprueCard,
};

// ---------------------------------------------------------------------------------------------
// Limits (mirrors parts/partspec/print_profiles/fdm_kitplate_0.4.json; tests assert they agree)
// ---------------------------------------------------------------------------------------------
export const LIMITS = {
  bedMm: 180,
  maxPlateMm: 170,
  brimMm: 5,
  gapMm: 5.0,
  supportGapMm: 6.0,
  maxOverhangDeg: 45,
  firstLayerExclusionMm: 0.7,
  steepAreaToleranceMm2: 10.0,
};

// Verbatim warning text from `parts/partspec/interfaces.json` (`print_page_warnings`).
export const PRINT_PAGE_WARNINGS = Object.freeze({
  always: 'Printed at home or by a print service. Not tested to toy-safety standards. Adult supervision required. Check for cracks, sharp edges and loose pieces before each use, and stop using anything that has broken.',
  small_part: 'CHOKING HAZARD - Small parts. Not for children under 3 years.',
  marginal: 'Contains near-threshold pieces; inspect after printing and supervise young children.',
  sprue_prep: 'ADULT PREP REQUIRED: snip parts from the runners at the V-notches with flush cutters and smooth any gate nibs before giving parts to a child.',
});

/** Plate bound on a bed (bedX x bedY): min(170, minBed - 2*brim) on <=180 beds; larger beds get minBed - 2*brim and a note. */
export function plateBound(bedMm = LIMITS.bedMm, brimMm = LIMITS.brimMm, bedYmm = bedMm) {
  const minSide = Math.min(bedMm, bedYmm ?? bedMm);
  const free = minSide - 2 * brimMm;
  if (minSide <= LIMITS.bedMm) return { mm: Math.min(LIMITS.maxPlateMm, free), note: '' };
  return { mm: free, note: 'Bed larger than 180 mm: not covered by the kit-plate profile.' };
}

// ---------------------------------------------------------------------------------------------
// Inventory (delegates to the shared scene BOM & filament colour resolver)
// ---------------------------------------------------------------------------------------------
export function inventoryFor(s = {}, opts = {}) {
  return resolveSceneBom(s, opts);
}

// ---------------------------------------------------------------------------------------------
// STL & Mesh Metrics
// ---------------------------------------------------------------------------------------------
/** Parse binary or ASCII STL into positions: Float32Array of 9 floats per triangle. */
export function parseStl(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8.byteLength >= 84) {
    const n = dv.getUint32(80, true);
    if (84 + n * 50 === u8.byteLength) {
      const out = new Float32Array(n * 9);
      for (let i = 0, o = 84; i < n; i++, o += 50) {
        for (let k = 0; k < 9; k++) out[i * 9 + k] = dv.getFloat32(o + 12 + k * 4, true);
      }
      return out;
    }
  }
  const text = new TextDecoder().decode(u8);
  if (!/facet/.test(text.slice(0, 1024))) throw new Error('not an STL file');
  const nums = [];
  for (const m of text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)) nums.push(+m[1], +m[2], +m[3]);
  if (nums.length % 9) throw new Error('ASCII STL has a partial facet');
  return Float32Array.from(nums);
}

/** Binary STL bytes for positions (normals are computed). */
export function stlBytes(tri, name = 'kip') {
  const n = tri.length / 9;
  const out = new Uint8Array(84 + n * 50);
  const dv = new DataView(out.buffer);
  out.set(new TextEncoder().encode(name.slice(0, 79)), 0);
  dv.setUint32(80, n, true);
  for (let i = 0, o = 84; i < n; i++, o += 50) {
    const t = i * 9;
    const ux = tri[t + 3] - tri[t], uy = tri[t + 4] - tri[t + 1], uz = tri[t + 5] - tri[t + 2];
    const vx = tri[t + 6] - tri[t], vy = tri[t + 7] - tri[t + 1], vz = tri[t + 8] - tri[t + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true);
    for (let k = 0; k < 9; k++) dv.setFloat32(o + 12 + k * 4, tri[t + k], true);
  }
  return out;
}

export function bounds(tri) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tri.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = tri[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

/** Exact signed tetrahedron volume (mm^3) and surface area (mm^2) of a triangle soup. */
export function meshVolumeAndArea(tri) {
  let vol6 = 0;
  let area2 = 0;
  for (let t = 0; t < tri.length; t += 9) {
    const x0 = tri[t],     y0 = tri[t + 1], z0 = tri[t + 2];
    const x1 = tri[t + 3], y1 = tri[t + 4], z1 = tri[t + 5];
    const x2 = tri[t + 6], y2 = tri[t + 7], z2 = tri[t + 8];
    vol6 += x0 * (y1 * z2 - z1 * y2) - y0 * (x1 * z2 - z1 * x2) + z0 * (x1 * y2 - y1 * x2);
    const ux = x1 - x0, uy = y1 - y0, uz = z1 - z0;
    const vx = x2 - x0, vy = y2 - y0, vz = z2 - z0;
    area2 += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  }
  return { volumeMm3: Math.abs(vol6) / 6, areaMm2: area2 / 2 };
}

// ---------------------------------------------------------------------------------------------
// Orientation + support scoring
// ---------------------------------------------------------------------------------------------
/** The six "which face is down" rigid rotations (row-major 3x3, determinant +1). Index 0 is identity. */
export const ORIENTATIONS = [
  { name: '+z up', m: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
  { name: '-z up', m: [1, 0, 0, 0, -1, 0, 0, 0, -1] },
  { name: '+x up', m: [0, 0, -1, 0, 1, 0, 1, 0, 0] },
  { name: '-x up', m: [0, 0, 1, 0, 1, 0, -1, 0, 0] },
  { name: '+y up', m: [1, 0, 0, 0, 0, -1, 0, 1, 0] },
  { name: '-y up', m: [1, 0, 0, 0, 0, 1, 0, -1, 0] },
];

/** Apply rotation m (row-major 3x3) then translation t to every vertex. Returns a new array. */
export function transform(tri, m, t = [0, 0, 0]) {
  const out = new Float32Array(tri.length);
  for (let i = 0; i < tri.length; i += 3) {
    const x = tri[i], y = tri[i + 1], z = tri[i + 2];
    out[i] = m[0] * x + m[1] * y + m[2] * z + t[0];
    out[i + 1] = m[3] * x + m[4] * y + m[5] * z + t[1];
    out[i + 2] = m[6] * x + m[7] * y + m[8] * z + t[2];
  }
  return out;
}

/**
 * When an STL holds multiple side-by-side disconnected shells (e.g. `face_glints` with 4 eye catchlights),
 * land any shell whose interior XY box does not sit over another shell onto `z = 0` so no piece levitates in air.
 */
function landDisconnectedShells(tri) {
  const nTri = tri.length / 9;
  if (nTri < 2) return tri;
  const parent = new Int32Array(nTri);
  for (let i = 0; i < nTri; i++) parent[i] = i;
  const find = (x) => {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  };
  const vMap = new Map();
  for (let t = 0; t < nTri; t++) {
    const o = t * 9;
    for (let k = 0; k < 9; k += 3) {
      const key = `${Math.round(tri[o + k] * 200)},${Math.round(tri[o + k + 1] * 200)},${Math.round(tri[o + k + 2] * 200)}`;
      const prev = vMap.get(key);
      if (prev === undefined) vMap.set(key, t);
      else {
        const ra = find(prev), rb = find(t);
        if (ra !== rb) parent[rb] = ra;
      }
    }
  }
  const comps = new Map();
  for (let t = 0; t < nTri; t++) {
    const r = find(t);
    let c = comps.get(r);
    if (!c) {
      c = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, tris: [] };
      comps.set(r, c);
    }
    c.tris.push(t);
    const o = t * 9;
    for (let k = 0; k < 9; k += 3) {
      const x = tri[o + k], y = tri[o + k + 1], z = tri[o + k + 2];
      if (x < c.minX) c.minX = x;
      if (x > c.maxX) c.maxX = x;
      if (y < c.minY) c.minY = y;
      if (y > c.maxY) c.maxY = y;
      if (z < c.minZ) c.minZ = z;
    }
  }
  if (comps.size <= 1) return tri;
  const list = [...comps.values()];
  const eps = 0.05;
  let changed = false;
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a.minZ <= 0.02) continue;
    let supportedBelow = false;
    for (let j = 0; j < list.length; j++) {
      if (i === j) continue;
      const b = list[j];
      const ox = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
      const oy = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
      if (ox > eps && oy > eps && b.minZ < a.minZ) {
        supportedBelow = true;
        break;
      }
    }
    if (!supportedBelow) {
      a.dropZ = a.minZ;
      changed = true;
    }
  }
  if (!changed) return tri;
  const out = new Float32Array(tri);
  for (const c of list) {
    if (!c.dropZ) continue;
    for (const t of c.tris) {
      const o = t * 9;
      out[o + 2] -= c.dropZ;
      out[o + 5] -= c.dropZ;
      out[o + 8] -= c.dropZ;
    }
  }
  return out;
}

function seatMatrix(tri, m, auxTri = null) {
  const rotated = transform(tri, m);
  const b = bounds(rotated);
  const shift = [-b.min[0], -b.min[1], -b.min[2]];
  const shifted = transform(rotated, [1, 0, 0, 0, 1, 0, 0, 0, 1], shift);
  const landed = landDisconnectedShells(shifted);
  const lb = landed === shifted ? b : bounds(landed);
  let seatedAux = null;
  if (auxTri && auxTri.length) {
    const auxRot = transform(auxTri, m);
    seatedAux = transform(auxRot, [1, 0, 0, 0, 1, 0, 0, 0, 1], shift);
    for (let k = 2; k < seatedAux.length; k += 3) {
      if (seatedAux[k] < 0.02) seatedAux[k] = 0.02;
    }
  }
  return { tri: landed, size: lb.size, auxTri: seatedAux };
}

/** Rotate by orientation `index`, then slide so the lowest point is z = 0 and the XY box starts at 0,0. */
export function seat(tri, index = 0) {
  const res = seatMatrix(tri, ORIENTATIONS[index].m);
  return { tri: res.tri, size: res.size };
}

// Parametric mating-socket / bore guard volumes in `kip.scad` local coordinates for `needs-supports` parts:
// shields ball-joint cups, neck bores, ear-pod seats, visor pocket, crown/back mortises, and compliant flex slots
// so slicer tree/organic supports hold external overhangs without clogging precision snap joints.
const SOCKET_GUARD_BOXES = Object.freeze({
  torso: [
    [-5.2, -5.2, 97.5, 5.2, 5.2, 105.5],      // top neck socket
    [-16.5, -5.2, 90.2, -8.0, 5.2, 100.8],    // left shoulder socket
    [8.0, -5.2, 90.2, 16.5, 5.2, 100.8],      // right shoulder socket
    [-15.2, -5.0, 62.8, -5.8, 5.0, 70.5],     // left hip socket (leaves z = 57.5..62.5 pelvis unblocked)
    [5.8, -5.0, 62.8, 15.2, 5.0, 70.5],       // right hip socket
    [-4.2, 0.0, 83.2, 4.2, 13.4, 92.8],       // back central Pro bore
    [-12.3, 11.8, 75.2, 12.3, 13.4, 99.8],    // back dock shallow mortise
    [-4.2, 0.2, 58.5, 4.2, 13.3, 67.5],       // lower-back 2 TU tail bore
  ],
  snap_torso: [
    [-5.2, -5.2, 97.5, 5.2, 5.2, 105.5],
    [-16.8, -5.2, 89.8, -8.0, 5.2, 100.2],
    [8.0, -5.2, 89.8, 16.8, 5.2, 100.2],
    [-15.6, -5.0, 62.4, -6.0, 5.0, 70.2],
    [6.0, -5.0, 62.4, 15.6, 5.0, 70.2],
    [-4.2, 0.0, 83.2, 4.2, 13.4, 92.8],
    [-12.3, 11.8, 75.2, 12.3, 13.4, 99.8],
    [-4.2, 0.2, 58.5, 4.2, 13.3, 67.5],
  ],
  head_shell: [
    [-5.3, -5.3, 0.05, 5.3, 5.3, 8.5],        // bottom neck socket
    [-22.0, -6.2, 14.0, -17.5, 6.2, 27.5],    // left ear-pod seat
    [17.5, -6.2, 14.0, 22.0, 6.2, 27.5],      // right ear-pod seat
    [-15.4, -18.8, 9.8, 15.4, -15.8, 28.6],   // front visor bezel pocket
  ],
  head_hood: [
    [-11.6, -5.8, 39.8, 11.6, 5.8, 41.6],     // top crown mortise
  ],
  snap_arm: [
    [-4.8, -8.6, 0.05, 4.8, 1.0, 7.5],        // bottom wrist socket
    [-5.2, -5.2, 26.5, 5.2, 5.2, 34.0],       // top shoulder socket
  ],
  tail_acc: [
    [-3.42, -3.6, 0.2, 3.42, 3.6, 10.4],      // compliant slotted friction-pin plug
  ],
});

function pushOutwardBox(out, x0, y0, z0, x1, y1, z1) {
  const q = (a, b, c, d) => out.push(
    a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2],
    a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2],
  );
  // -Z bottom, +Z top, -Y front, +Y back, -X left, +X right (all outward CCW)
  q([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]);
  q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
  q([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
  q([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]);
  q([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
  q([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]);
}

export function rawSocketBlockerTri(partId) {
  const boxes = SOCKET_GUARD_BOXES[partId];
  if (!boxes || !boxes.length) return null;
  const tris = [];
  for (const [x0, y0, z0, x1, y1, z1] of boxes) pushOutwardBox(tris, x0, y0, z0, x1, y1, z1);
  return Float32Array.from(tris);
}

const FLAT_CEILING = -0.98;
export function supportReport(tri, lim = LIMITS) {
  const n = tri.length / 9;
  const flags = new Uint8Array(n);
  const sin = Math.sin((lim.maxOverhangDeg * Math.PI) / 180);
  let overhang = 0, contact = 0, maxZ = 0;
  for (let i = 0; i < n; i++) {
    const t = i * 9;
    const ux = tri[t + 3] - tri[t], uy = tri[t + 4] - tri[t + 1], uz = tri[t + 5] - tri[t + 2];
    const vx = tri[t + 6] - tri[t], vy = tri[t + 7] - tri[t + 1], vz = tri[t + 8] - tri[t + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len === 0) continue;
    const area = len / 2;
    const cz = (tri[t + 2] + tri[t + 5] + tri[t + 8]) / 3;
    for (const k of [2, 5, 8]) if (tri[t + k] > maxZ) maxZ = tri[t + k];
    const nzu = nz / len;
    if (nzu < -sin && cz > lim.firstLayerExclusionMm && nzu >= FLAT_CEILING) { overhang += area; flags[i] = 1; }
    else if (nzu < -0.9 && cz <= lim.firstLayerExclusionMm) contact += area;
  }
  return { overhangMm2: overhang, contactMm2: contact, heightMm: maxZ, supportFree: overhang < lim.steepAreaToleranceMm2, flags };
}

/**
 * Pure-JS V5 floating-island layer tracker (spec 7.1):
 * slices a seated mesh across Z in `layerMm` increments and counts connected solid regions above
 * `firstLayerExclusionMm` that have zero overlap with the 45-deg dilated support mask from the layer below.
 */
export function countFloatingIslands(tri, layerMm = 0.40, lim = LIMITS) {
  if (!tri || tri.length < 9) return 0;
  const b = bounds(tri);
  const maxZ = b.max[2];
  if (maxZ <= lim.firstLayerExclusionMm + 0.05) return 0;

  const cellMm = Math.max(0.25, layerMm);
  const gw = Math.max(4, Math.ceil((b.max[0] - b.min[0]) / cellMm) + 2);
  const gh = Math.max(4, Math.ceil((b.max[1] - b.min[1]) / cellMm) + 2);
  const ox = b.min[0] - cellMm;
  const oy = b.min[1] - cellMm;

  const rasterizeLoops = (loops) => {
    const mask = new Uint8Array(gw * gh);
    if (!loops.length) return mask;
    // 1. Scanline-fill solid interior across rows
    for (let row = 0; row < gh; row++) {
      const py = oy + (row + 0.5) * cellMm;
      const xs = [];
      for (const loop of loops) {
        const pts = loop.pts;
        const n = pts.length;
        for (let i = 0; i < n; i++) {
          const [x0, y0] = pts[i];
          const [x1, y1] = pts[(i + 1) % n];
          if ((y0 <= py && y1 > py) || (y1 <= py && y0 > py)) {
            xs.push(x0 + ((py - y0) / (y1 - y0)) * (x1 - x0));
          }
        }
      }
      if (xs.length >= 2) {
        xs.sort((a, c) => a - c);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const c0 = Math.max(0, Math.floor((xs[k] - ox) / cellMm));
          const c1 = Math.min(gw - 1, Math.floor((xs[k + 1] - ox) / cellMm));
          for (let col = c0; col <= c1; col++) mask[row * gw + col] = 1;
        }
      }
    }
    // 2. Also stroke loop boundary segments so thin features (< cellMm) never drop out
    for (const loop of loops) {
      if (loop.isHole) continue;
      const pts = loop.pts;
      const n = pts.length;
      for (let i = 0; i < n; i++) {
        const [x0, y0] = pts[i];
        const [x1, y1] = pts[(i + 1) % n];
        const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (cellMm * 0.5)));
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const col = Math.max(0, Math.min(gw - 1, Math.floor((x0 + t * (x1 - x0) - ox) / cellMm)));
          const row = Math.max(0, Math.min(gh - 1, Math.floor((y0 + t * (y1 - y0) - oy) / cellMm)));
          mask[row * gw + col] = 1;
        }
      }
    }
    return mask;
  };

  const dilateMask = (src, radiusCells) => {
    const out = new Uint8Array(gw * gh);
    for (let r = 0; r < gh; r++) {
      const rOff = r * gw;
      for (let c = 0; c < gw; c++) {
        if (!src[rOff + c]) continue;
        const r0 = Math.max(0, r - radiusCells), r1 = Math.min(gh - 1, r + radiusCells);
        const c0 = Math.max(0, c - radiusCells), c1 = Math.min(gw - 1, c + radiusCells);
        for (let rr = r0; rr <= r1; rr++) {
          const rrOff = rr * gw;
          for (let cc = c0; cc <= c1; cc++) out[rrOff + cc] = 1;
        }
      }
    }
    return out;
  };

  let prevMask = new Uint8Array(gw * gh);
  const visited = new Uint8Array(gw * gh);
  const queue = new Int32Array(gw * gh);
  const growRadius = Math.max(1, Math.ceil(layerMm / cellMm)) + 1;
  let islands = 0;

  for (let z = 0.20; z < maxZ - 0.05; z += layerMm) {
    const loops = sliceMeshAtZ(tri, z);
    const curMask = rasterizeLoops(loops);
    if (z <= lim.firstLayerExclusionMm + 1e-6) {
      for (let idx = 0; idx < curMask.length; idx++) {
        if (curMask[idx]) prevMask[idx] = 1;
      }
      continue;
    }

    const supported = dilateMask(prevMask, growRadius);
    visited.fill(0);
    for (let idx = 0; idx < curMask.length; idx++) {
      if (!curMask[idx] || visited[idx]) continue;
      let head = 0, tail = 0;
      queue[tail++] = idx;
      visited[idx] = 1;
      let touchesSupport = false;
      while (head < tail) {
        const cur = queue[head++];
        if (supported[cur]) touchesSupport = true;
        const cr = (cur / gw) | 0;
        const cc = cur - cr * gw;
        for (let dr = -1; dr <= 1; dr++) {
          const nr = cr + dr;
          if (nr < 0 || nr >= gh) continue;
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nc = cc + dc;
            if (nc < 0 || nc >= gw) continue;
            const nIdx = nr * gw + nc;
            if (curMask[nIdx] && !visited[nIdx]) {
              visited[nIdx] = 1;
              queue[tail++] = nIdx;
            }
          }
        }
      }
      if (!touchesSupport) islands++;
    }
    prevMask = curMask;
  }

  return islands;
}

function mulMat3(a, b) {
  return [
    a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
    a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
    a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
    a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
    a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
    a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
    a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
    a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
    a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
  ];
}

/** Proper SO(3) rotation (`det = +1`) mapping unit vector `u` onto `(0, 0, -1)` so face `u` lands flat on `z = 0`. */
function rotationLandingNormalDown(ux, uy, uz) {
  const cosT = Math.max(-1, Math.min(1, -uz));
  if (cosT > 0.9999) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  if (cosT < -0.9999) return [1, 0, 0, 0, -1, 0, 0, 0, -1];
  const s = Math.hypot(ux, uy) || 1;
  const kx = -uy / s;
  const ky = ux / s;
  const sinT = s;
  const omc = 1 - cosT;
  return [
    cosT + kx * kx * omc, kx * ky * omc, ky * sinT,
    kx * ky * omc, cosT + ky * ky * omc, -kx * sinT,
    -ky * sinT, kx * sinT, cosT,
  ];
}

export function bestOrientation(tri, lim = LIMITS) {
  let best = null;
  for (let i = 0; i < ORIENTATIONS.length; i++) {
    const seated = seat(tri, i);
    const rep = supportReport(seated.tri, lim);
    const cand = { index: i, name: ORIENTATIONS[i].name, m: ORIENTATIONS[i].m, seated, report: rep };
    if (i === 0 && rep.supportFree) return cand;
    if (!best
      || rep.overhangMm2 < best.report.overhangMm2 - 1e-6
      || (Math.abs(rep.overhangMm2 - best.report.overhangMm2) <= 1e-6
        && (rep.contactMm2 > best.report.contactMm2 + 1e-6
          || (Math.abs(rep.contactMm2 - best.report.contactMm2) <= 1e-6 && rep.heightMm < best.report.heightMm)))) best = cand;
  }
  return best;
}

/**
 * Extended custom-STL pose search (spec 7.1):
 * evaluates the 6 axis orientations PLUS up to 8 outward extreme convex-support facet poses landed flat on `z = 0`
 * (with XY bounding-box yaw alignment, all `det = +1`), minimizing floating islands then overhang area.
 */
export function bestCustomOrientation(tri, lim = LIMITS) {
  const candidates = ORIENTATIONS.map((o, idx) => ({ index: idx, name: o.name, m: o.m, isAxis: true }));

  // Cluster non-axis outward triangle normals and measure area resting on the extreme support plane `max(u . v)`
  const bins = new Map();
  for (let t = 0; t < tri.length; t += 9) {
    const ux = tri[t + 3] - tri[t], uy = tri[t + 4] - tri[t + 1], uz = tri[t + 5] - tri[t + 2];
    const vx = tri[t + 6] - tri[t], vy = tri[t + 7] - tri[t + 1], vz = tri[t + 8] - tri[t + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-8) continue;
    const area = len * 0.5;
    const unx = nx / len, uny = ny / len, unz = nz / len;
    if (Math.max(Math.abs(unx), Math.abs(uny), Math.abs(unz)) > 0.996) continue;
    const key = `${Math.round(unx * 20)},${Math.round(uny * 20)},${Math.round(unz * 20)}`;
    let rec = bins.get(key);
    if (!rec) { rec = { sx: 0, sy: 0, sz: 0, area: 0 }; bins.set(key, rec); }
    rec.sx += unx * area;
    rec.sy += uny * area;
    rec.sz += unz * area;
    rec.area += area;
  }

  const topBins = [...bins.values()].sort((a, b) => b.area - a.area).slice(0, 24);
  const hullNormals = [];
  for (const b of topBins) {
    const l = Math.hypot(b.sx, b.sy, b.sz) || 1;
    const ux = b.sx / l, uy = b.sy / l, uz = b.sz / l;
    if (hullNormals.some(h => h.ux * ux + h.uy * uy + h.uz * uz > 0.985)) continue;

    let maxProj = -Infinity;
    for (let i = 0; i < tri.length; i += 3) {
      const p = ux * tri[i] + uy * tri[i + 1] + uz * tri[i + 2];
      if (p > maxProj) maxProj = p;
    }
    // Sum area of facets resting within 0.45 mm of the extreme outer support plane
    let supportArea = 0;
    for (let t = 0; t < tri.length; t += 9) {
      const p0 = ux * tri[t] + uy * tri[t + 1] + uz * tri[t + 2];
      const p1 = ux * tri[t + 3] + uy * tri[t + 4] + uz * tri[t + 5];
      const p2 = ux * tri[t + 6] + uy * tri[t + 7] + uz * tri[t + 8];
      if (maxProj - p0 <= 0.45 && maxProj - p1 <= 0.45 && maxProj - p2 <= 0.45) {
        const ax = tri[t + 3] - tri[t], ay = tri[t + 4] - tri[t + 1], az = tri[t + 5] - tri[t + 2];
        const bx = tri[t + 6] - tri[t], by = tri[t + 7] - tri[t + 1], bz = tri[t + 8] - tri[t + 2];
        supportArea += Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx) * 0.5;
      }
    }
    if (supportArea >= 4.0) hullNormals.push({ ux, uy, uz, supportArea });
  }

  hullNormals.sort((a, b) => b.supportArea - a.supportArea);
  hullNormals.slice(0, 8).forEach((hn, k) => {
    const baseM = rotationLandingNormalDown(hn.ux, hn.uy, hn.uz);
    // Align Z-yaw for tightest axis-aligned XY bounding rectangle
    let bestM = baseM;
    let bestBoxArea = Infinity;
    const baseRot = transform(tri, baseM);
    for (let deg = 0; deg < 90; deg += 15) {
      const rad = (deg * Math.PI) / 180;
      const c = Math.cos(rad), s = Math.sin(rad);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < baseRot.length; i += 3) {
        const rx = c * baseRot[i] - s * baseRot[i + 1];
        const ry = s * baseRot[i] + c * baseRot[i + 1];
        if (rx < minX) minX = rx;
        if (rx > maxX) maxX = rx;
        if (ry < minY) minY = ry;
        if (ry > maxY) maxY = ry;
      }
      const area = (maxX - minX) * (maxY - minY);
      if (area < bestBoxArea - 1e-4) {
        bestBoxArea = area;
        bestM = mulMat3([c, -s, 0, s, c, 0, 0, 0, 1], baseM);
      }
    }
    candidates.push({ index: 6 + k, name: `hull#${k + 1}`, m: bestM, isAxis: false });
  });

  let best = null;
  for (const c of candidates) {
    const seatedRes = seatMatrix(tri, c.m);
    const seated = { tri: seatedRes.tri, size: seatedRes.size };
    const rep = supportReport(seated.tri, lim);
    const islands = countFloatingIslands(seated.tri, 0.40, lim);
    if (c.index === 0 && islands === 0 && rep.supportFree) {
      return { index: 0, name: c.name, m: c.m, seated, report: rep, islands: 0 };
    }
    const cost = islands * 1000 + rep.overhangMm2 - 0.02 * rep.contactMm2 + 0.05 * rep.heightMm;
    if (!best || cost < best.cost - 1e-4) {
      best = { index: c.index, name: c.name, m: c.m, seated, report: rep, islands, cost };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Packer: 12-combination deterministic MaxRects portfolio + 2D XY mesh silhouette nester (spec 6.4)
// ---------------------------------------------------------------------------------------------
const EPS = 1e-9;

function less(a, b) {
  for (let i = 0; i < a.length; i++) { if (a[i] < b[i] - EPS) return true; if (a[i] > b[i] + EPS) return false; }
  return false;
}

function maxRectsPack(items, W, H, gap, rule = 'bssf') {
  let free = [{ x: 0, y: 0, w: W + gap, h: H + gap }];
  const placed = [];
  const rest = [];
  for (const it of items) {
    let best = null;
    for (const rot of [false, true]) {
      const w = (rot ? it.h : it.w) + gap, h = (rot ? it.w : it.h) + gap;
      if (rot && Math.abs(it.w - it.h) < EPS) continue;
      for (const f of free) {
        if (w > f.w + EPS || h > f.h + EPS) continue;
        const short = Math.min(f.w - w, f.h - h), long = Math.max(f.w - w, f.h - h);
        let key;
        if (rule === 'baf') {
          key = [f.w * f.h - w * h, short, f.y, f.x, rot ? 1 : 0];
        } else if (rule === 'bl') {
          key = [f.y + h, f.x, short, long, rot ? 1 : 0];
        } else {
          key = [short, long, f.y, f.x, rot ? 1 : 0];
        }
        if (!best || less(key, best.key)) best = { key, x: f.x, y: f.y, w, h, rot };
      }
    }
    if (!best) { rest.push(it); continue; }
    placed.push({ id: it.id, x: best.x, y: best.y, w: best.w - gap, h: best.h - gap, rot: best.rot });
    const used = { x: best.x, y: best.y, w: best.w, h: best.h };
    const next = [];
    for (const f of free) {
      if (used.x >= f.x + f.w - EPS || used.x + used.w <= f.x + EPS || used.y >= f.y + f.h - EPS || used.y + used.h <= f.y + EPS) { next.push(f); continue; }
      if (used.x > f.x + EPS) next.push({ x: f.x, y: f.y, w: used.x - f.x, h: f.h });
      if (used.x + used.w < f.x + f.w - EPS) next.push({ x: used.x + used.w, y: f.y, w: f.x + f.w - used.x - used.w, h: f.h });
      if (used.y > f.y + EPS) next.push({ x: f.x, y: f.y, w: f.w, h: used.y - f.y });
      if (used.y + used.h < f.y + f.h - EPS) next.push({ x: f.x, y: used.y + used.h, w: f.w, h: f.y + f.h - used.y - used.h });
    }
    const inside = (a, b) => b.x <= a.x + EPS && b.y <= a.y + EPS && b.x + b.w >= a.x + a.w - EPS && b.y + b.h >= a.y + a.h - EPS;
    free = next.filter((a, i) => !next.some((b, j) => j !== i && inside(a, b) && (!inside(b, a) || j < i)));
  }
  return { placed, rest };
}

const cmpId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const PORTFOLIO_SORTS = [
  (a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || (b.w * b.h - a.w * a.h) || cmpId(a, b),
  (a, b) => (b.w * b.h - a.w * a.h) || Math.max(b.w, b.h) - Math.max(a.w, a.h) || cmpId(a, b),
  (a, b) => ((b.w + b.h) - (a.w + a.h)) || (b.w * b.h - a.w * a.h) || cmpId(a, b),
  (a, b) => (Math.max(b.w / Math.max(b.h, 1e-6), b.h / Math.max(b.w, 1e-6)) - Math.max(a.w / Math.max(a.h, 1e-6), a.h / Math.max(a.w, 1e-6))) || (b.w * b.h - a.w * a.h) || cmpId(a, b),
];
const PORTFOLIO_RULES = ['bssf', 'baf', 'bl'];

function scorePackedPlates(plates) {
  let sumArea = 0;
  let sumSpan = 0;
  for (const pl of plates) {
    let mx = 0, my = 0;
    for (const p of pl) {
      if (p.x + p.w > mx) mx = p.x + p.w;
      if (p.y + p.h > my) my = p.y + p.h;
    }
    sumArea += mx * my;
    sumSpan += Math.max(mx, my);
  }
  return [plates.length, sumArea, sumSpan];
}

export function packPlates(items, boundMm = plateBound().mm, gap = LIMITS.gapMm, boundYmm = boundMm) {
  const canonical = [...items].sort(cmpId);
  const maxSideAllowed = Math.max(boundMm, boundYmm);
  const minSideAllowed = Math.min(boundMm, boundYmm);
  const tooBig = (it) => Math.max(it.w, it.h) > maxSideAllowed + EPS || Math.min(it.w, it.h) > minSideAllowed + EPS;
  const oversize = [...canonical.filter(tooBig)].sort(PORTFOLIO_SORTS[0]);
  const fitItems = canonical.filter((it) => !tooBig(it));
  if (!fitItems.length) return { plates: [], oversize, boundMm, gap };

  let bestPlates = null;
  let bestKey = null;
  let comboIdx = 0;

  for (const sortFn of PORTFOLIO_SORTS) {
    const ordered = [...fitItems].sort(sortFn);
    for (const rule of PORTFOLIO_RULES) {
      let queue = ordered;
      const plates = [];
      while (queue.length) {
        const { placed, rest } = maxRectsPack(queue, boundMm, boundYmm, gap, rule);
        if (!placed.length) break;
        plates.push(placed);
        queue = rest;
      }
      if (!queue.length) {
        const [nPl, area, span] = scorePackedPlates(plates);
        const key = [nPl, area, span, comboIdx];
        if (!bestKey || less(key, bestKey)) {
          bestKey = key;
          bestPlates = plates;
        }
      }
      comboIdx++;
    }
  }

  return { plates: bestPlates || [], oversize, boundMm, gap };
}

function pointInTri2d(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const hasNeg = (d1 < -1e-9) || (d2 < -1e-9) || (d3 < -1e-9);
  const hasPos = (d1 > 1e-9) || (d2 > 1e-9) || (d3 > 1e-9);
  return !(hasNeg && hasPos);
}

function tri2dDist(ax0, ay0, bx0, by0, cx0, cy0, ax1, ay1, bx1, by1, cx1, cy1) {
  if (pointInTri2d(ax0, ay0, ax1, ay1, bx1, by1, cx1, cy1) || pointInTri2d(ax1, ay1, ax0, ay0, bx0, by0, cx0, cy0)) {
    return 0;
  }
  const e0 = [[ax0, ay0, bx0, by0], [bx0, by0, cx0, cy0], [cx0, cy0, ax0, ay0]];
  const e1 = [[ax1, ay1, bx1, by1], [bx1, by1, cx1, cy1], [cx1, cy1, ax1, ay1]];
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const d = segToSegDist(e0[i][0], e0[i][1], e0[i][2], e0[i][3], e1[j][0], e1[j][1], e1[j][2], e1[j][3]);
      if (d === 0) return 0;
      if (d < best) best = d;
    }
  }
  return best;
}

/** Exact minimum 2D XY Euclidean distance between two world-space triangle soups (`earlyStopMm` exits as soon as violation is proven). */
export function mesh2dMinDist(triA, triB, aBox, bBox, earlyStopMm = 0) {
  const pad = Math.max(earlyStopMm, 8.0) + 1.0;
  const subA = [];
  for (let t = 0; t < triA.length; t += 9) {
    const x0 = triA[t], y0 = triA[t + 1], x1 = triA[t + 3], y1 = triA[t + 4], x2 = triA[t + 6], y2 = triA[t + 7];
    const minX = Math.min(x0, x1, x2), maxX = Math.max(x0, x1, x2);
    const minY = Math.min(y0, y1, y2), maxY = Math.max(y0, y1, y2);
    if (maxX < bBox.x - pad || minX > bBox.x + bBox.w + pad || maxY < bBox.y - pad || minY > bBox.y + bBox.h + pad) continue;
    subA.push([x0, y0, x1, y1, x2, y2, minX, minY, maxX, maxY]);
  }
  if (!subA.length) return earlyStopMm + 1;

  const cell = 6.0;
  const gridB = new Map();
  let countB = 0;
  for (let t = 0; t < triB.length; t += 9) {
    const x0 = triB[t], y0 = triB[t + 1], x1 = triB[t + 3], y1 = triB[t + 4], x2 = triB[t + 6], y2 = triB[t + 7];
    const minX = Math.min(x0, x1, x2), maxX = Math.max(x0, x1, x2);
    const minY = Math.min(y0, y1, y2), maxY = Math.max(y0, y1, y2);
    if (maxX < aBox.x - pad || minX > aBox.x + aBox.w + pad || maxY < aBox.y - pad || minY > aBox.y + aBox.h + pad) continue;
    const rec = [x0, y0, x1, y1, x2, y2, minX, minY, maxX, maxY];
    countB++;
    const gx0 = Math.floor(minX / cell), gx1 = Math.floor(maxX / cell);
    const gy0 = Math.floor(minY / cell), gy1 = Math.floor(maxY / cell);
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gy = gy0; gy <= gy1; gy++) {
        const k = `${gx},${gy}`;
        let arr = gridB.get(k);
        if (!arr) { arr = []; gridB.set(k, arr); }
        arr.push(rec);
      }
    }
  }
  if (!countB) return earlyStopMm + 1;

  let best = Infinity;
  const rCells = Math.ceil(pad / cell);
  for (const ta of subA) {
    const gx0 = Math.floor(ta[6] / cell) - rCells, gx1 = Math.floor(ta[8] / cell) + rCells;
    const gy0 = Math.floor(ta[7] / cell) - rCells, gy1 = Math.floor(ta[9] / cell) + rCells;
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gy = gy0; gy <= gy1; gy++) {
        const bucket = gridB.get(`${gx},${gy}`);
        if (!bucket) continue;
        for (const tb of bucket) {
          const dx = Math.max(tb[6] - ta[8], ta[6] - tb[8], 0);
          const dy = Math.max(tb[7] - ta[9], ta[7] - tb[9], 0);
          if (dx >= best || dy >= best) continue;
          const d = tri2dDist(ta[0], ta[1], ta[2], ta[3], ta[4], ta[5], tb[0], tb[1], tb[2], tb[3], tb[4], tb[5]);
          if (d < best) {
            best = d;
            if (best < earlyStopMm) return best;
          }
        }
      }
    }
  }
  return best;
}

export function checkPlacement(placed, boundMm = plateBound().mm, gap = LIMITS.gapMm) {
  const bad = [];
  const tol = 1e-4;
  for (const p of placed) {
    const label = p.id || p.instance;
    if (p.x < -tol || p.y < -tol || p.x + p.w > boundMm + tol || p.y + p.h > boundMm + tol) {
      bad.push(`${label} outside the ${boundMm} mm bound`);
    }
  }
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i], b = placed[j];
      const dx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), 0);
      const dy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h), 0);
      const boxGap = Math.max(dx, dy);
      if (boxGap >= gap - tol) continue;
      if (a.tri && b.tri) {
        const exactDist = mesh2dMinDist(a.tri, b.tri, a, b, gap - 1e-3);
        if (exactDist < gap - 1e-3) {
          bad.push(`${a.id || a.instance} and ${b.id || b.instance} are ${exactDist.toFixed(2)} mm apart (need ${gap})`);
        }
      } else {
        bad.push(`${a.id || a.instance} and ${b.id || b.instance} are ${boxGap.toFixed(2)} mm apart (need ${gap})`);
      }
    }
  }
  return bad;
}

// ---------------------------------------------------------------------------------------------
// Plate assembly, True 2D XY Silhouette Nesting & Colour Plate Planner
// ---------------------------------------------------------------------------------------------
const Z_TURNS = Object.freeze([
  { deg: 0,   rot: false, m: [1, 0, 0, 0, 1, 0, 0, 0, 1],   shift: () => [0, 0, 0] },
  { deg: 90,  rot: true,  m: [0, -1, 0, 1, 0, 0, 0, 0, 1],  shift: (w, h) => [h, 0, 0] },
  { deg: 180, rot: false, m: [-1, 0, 0, 0, -1, 0, 0, 0, 1], shift: (w, h) => [w, h, 0] },
  { deg: 270, rot: true,  m: [0, 1, 0, -1, 0, 0, 0, 0, 1],  shift: (w) => [0, w, 0] },
]);
// Matches `export_print_oriented` in `parts/kip/kip.scad:1141-1143` (`rotate([-90,0,0])` -> `-y up`) for multi-catchlight visor pins.
const SCAD_FACE_PIN_ORIENT = Object.freeze({ face_glints: 5 });

function rotateSeatedZ(tri, w, h, turnIdx) {
  const t = Z_TURNS[turnIdx] || Z_TURNS[0];
  if (t.deg === 0) return tri;
  return transform(transform(tri, t.m), [1, 0, 0, 0, 1, 0, 0, 0, 1], t.shift(w, h));
}

function triIntersectsRect2d(ax, ay, bx, by, cx, cy, rx0, ry0, rx1, ry1) {
  if (ax >= rx0 && ax <= rx1 && ay >= ry0 && ay <= ry1) return true;
  if (bx >= rx0 && bx <= rx1 && by >= ry0 && by <= ry1) return true;
  if (cx >= rx0 && cx <= rx1 && cy >= ry0 && cy <= ry1) return true;
  const mx = (rx0 + rx1) * 0.5, my = (ry0 + ry1) * 0.5;
  if (pointInTri2d(mx, my, ax, ay, bx, by, cx, cy)) return true;
  const rEdges = [[rx0, ry0, rx1, ry0], [rx1, ry0, rx1, ry1], [rx1, ry1, rx0, ry1], [rx0, ry1, rx0, ry0]];
  const tEdges = [[ax, ay, bx, by], [bx, by, cx, cy], [cx, cy, ax, ay]];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 4; j++) {
      if (segToSegDist(tEdges[i][0], tEdges[i][1], tEdges[i][2], tEdges[i][3], rEdges[j][0], rEdges[j][1], rEdges[j][2], rEdges[j][3]) <= 1e-6) {
        return true;
      }
    }
  }
  return false;
}

function buildRasterPose(tri, w, h, cellMm) {
  const cols = Math.max(1, Math.ceil(w / cellMm));
  const rows = Math.max(1, Math.ceil(h / cellMm));
  const wordsPerRow = Math.ceil((cols + 32) / 32);
  const occ = new Uint8Array(cols * rows);
  for (let t = 0; t < tri.length; t += 9) {
    const ax = tri[t], ay = tri[t + 1], bx = tri[t + 3], by = tri[t + 4], cx = tri[t + 6], cy = tri[t + 7];
    const c0 = Math.max(0, Math.floor(Math.min(ax, bx, cx) / cellMm));
    const c1 = Math.min(cols - 1, Math.floor(Math.max(ax, bx, cx) / cellMm));
    const r0 = Math.max(0, Math.floor(Math.min(ay, by, cy) / cellMm));
    const r1 = Math.min(rows - 1, Math.floor(Math.max(ay, by, cy) / cellMm));
    for (let r = r0; r <= r1; r++) {
      const ry0 = r * cellMm, ry1 = (r + 1) * cellMm;
      for (let c = c0; c <= c1; c++) {
        if (occ[r * cols + c]) continue;
        if (triIntersectsRect2d(ax, ay, bx, by, cx, cy, c * cellMm, ry0, (c + 1) * cellMm, ry1)) {
          occ[r * cols + c] = 1;
        }
      }
    }
  }
  const rowBits = Array.from({ length: rows }, () => new Uint32Array(wordsPerRow));
  const occCells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (occ[r * cols + c]) {
        rowBits[r][c >>> 5] |= (1 << (c & 31));
        occCells.push([c, r]);
      }
    }
  }
  return { w, h, cols, rows, rowBits, occCells };
}

/**
 * Deterministic conservative 2D XY mesh silhouette packer (`1.0 mm` bit-packed raster with exact continuous
 * Euclidean `>= gap` dilation across `0/90/180/270 deg` `+Z` turns). Nests concave/diagonal silhouettes cleanly.
 */
export function packPolygonPlates(instances, boundMm = plateBound().mm, gap = LIMITS.gapMm) {
  const cellMm = 1.0;
  const gridN = Math.max(1, Math.floor(boundMm / cellMm));
  const words = Math.ceil(gridN / 32);

  // Conservative dilation disk: guarantees continuous distance >= gap + 0.05 mm between any non-overlapping grid cells
  const rMax = Math.ceil((gap + 0.05) / cellMm) + 1;
  const disk = [];
  for (let dy = -rMax; dy <= rMax; dy++) {
    for (let dx = -rMax; dx <= rMax; dx++) {
      const minContDist = Math.hypot(Math.max(0, Math.abs(dx) - 1) * cellMm, Math.max(0, Math.abs(dy) - 1) * cellMm);
      if (minContDist < gap + 0.05) disk.push([dx, dy]);
    }
  }

  const poseCache = new Map();
  const getPoses = (inst) => {
    const key = `${inst.id}|${inst.orientation}|${inst.w.toFixed(3)}x${inst.h.toFixed(3)}`;
    if (poseCache.has(key)) return poseCache.get(key);
    const list = [];
    for (let ti = 0; ti < 4; ti++) {
      const rw = Z_TURNS[ti].rot ? inst.h : inst.w;
      const rh = Z_TURNS[ti].rot ? inst.w : inst.h;
      if (rw > boundMm + EPS || rh > boundMm + EPS) continue;
      if (ti === 1 && Math.abs(inst.w - inst.h) < 0.05) continue;
      const rTri = rotateSeatedZ(inst.tri, inst.w, inst.h, ti);
      list.push({ turnIdx: ti, rot: Z_TURNS[ti].rot, w: rw, h: rh, raster: buildRasterPose(rTri, rw, rh, cellMm) });
    }
    poseCache.set(key, list);
    return list;
  };

  const ordered = [...instances].sort((a, b) => (b.w * b.h - a.w * a.h) || (Math.max(b.w, b.h) - Math.max(a.w, a.h)) || (a.instance < b.instance ? -1 : 1));
  const fit = ordered.filter(it => Math.max(it.w, it.h) <= boundMm + EPS);
  let queue = fit;
  const plates = [];

  const collidesAt = (board, raster, gx, gy) => {
    const { rows, rowBits } = raster;
    for (let r = 0; r < rows; r++) {
      const bRow = board[gy + r];
      const pRow = rowBits[r];
      const wordShift = gx >>> 5;
      const bitShift = gx & 31;
      for (let wIdx = 0; wIdx < pRow.length; wIdx++) {
        const val = pRow[wIdx];
        if (!val) continue;
        const bw0 = wordShift + wIdx;
        if (bw0 < words && (bRow[bw0] & (val << bitShift)) !== 0) return true;
        if (bitShift > 0 && bw0 + 1 < words && (bRow[bw0 + 1] & (val >>> (32 - bitShift))) !== 0) return true;
      }
    }
    return false;
  };

  const stampDilated = (board, raster, gx, gy) => {
    for (const [cx, cy] of raster.occCells) {
      const bx = gx + cx, by = gy + cy;
      for (let k = 0; k < disk.length; k++) {
        const nx = bx + disk[k][0], ny = by + disk[k][1];
        if (nx >= 0 && nx < gridN && ny >= 0 && ny < gridN) {
          board[ny][nx >>> 5] |= (1 << (nx & 31));
        }
      }
    }
  };

  while (queue.length) {
    const board = Array.from({ length: gridN }, () => new Uint32Array(words));
    const placed = [];
    const rest = [];
    let curMaxX = 0, curMaxY = 0;

    for (const inst of queue) {
      const poses = getPoses(inst);
      let best = null;
      const step = placed.length === 0 ? 1 : 2;

      for (const pose of poses) {
        const maxGx = Math.floor((boundMm - pose.w + 1e-6) / cellMm);
        const maxGy = Math.floor((boundMm - pose.h + 1e-6) / cellMm);
        if (maxGx < 0 || maxGy < 0 || gyLimit(pose.raster.rows, gridN) < 0) continue;

        for (let gy = 0; gy <= maxGy; gy += step) {
          if (gy + pose.raster.rows > gridN) break;
          for (let gx = 0; gx <= maxGx; gx += step) {
            if (gx + pose.raster.cols > gridN) break;
            const px = gx * cellMm, py = gy * cellMm;
            const nx = Math.max(curMaxX, px + pose.w);
            const ny = Math.max(curMaxY, py + pose.h);
            const key = [nx * ny, Math.max(nx, ny), py, px, pose.turnIdx];
            if (best && !less(key, best.key)) continue;
            if (!collidesAt(board, pose.raster, gx, gy)) {
              best = { key, gx, gy, px, py, pose };
            }
          }
        }

        // Local 1-mm refinement around best coarse hit for this pose
        if (best && best.pose === pose && step > 1) {
          const cgx = best.gx, cgy = best.gy;
          for (let gy = Math.max(0, cgy - 1); gy <= Math.min(maxGy, cgy + 1); gy++) {
            if (gy + pose.raster.rows > gridN) continue;
            for (let gx = Math.max(0, cgx - 1); gx <= Math.min(maxGx, cgx + 1); gx++) {
              if (gx + pose.raster.cols > gridN) continue;
              const px = gx * cellMm, py = gy * cellMm;
              const nx = Math.max(curMaxX, px + pose.w);
              const ny = Math.max(curMaxY, py + pose.h);
              const key = [nx * ny, Math.max(nx, ny), py, px, pose.turnIdx];
              if (!less(key, best.key)) continue;
              if (!collidesAt(board, pose.raster, gx, gy)) {
                best = { key, gx, gy, px, py, pose };
              }
            }
          }
        }
      }

      if (!best) {
        rest.push(inst);
        continue;
      }
      stampDilated(board, best.pose.raster, best.gx, best.gy);
      curMaxX = Math.max(curMaxX, best.px + best.pose.w);
      curMaxY = Math.max(curMaxY, best.py + best.pose.h);
      placed.push({
        id: inst.instance,
        x: best.px,
        y: best.py,
        w: best.pose.w,
        h: best.pose.h,
        rot: best.pose.rot,
        turnIdx: best.pose.turnIdx,
      });
    }

    if (!placed.length) break;
    plates.push(placed);
    queue = rest;
  }

  return plates;
}

function gyLimit(rows, gridN) {
  return gridN - rows;
}

export function prepareItem(entry, tri, { verified = false, sha256 = '' } = {}) {
  const native = entry.source === 'partspec' || entry.source === 'custom-example';
  const isCustomUpload = entry.source === 'custom' || Boolean(entry.bytes);
  const pinOrient = !native && !isCustomUpload ? SCAD_FACE_PIN_ORIENT[entry.id] : undefined;
  const rawBlocker = !native && !isCustomUpload ? rawSocketBlockerTri(entry.id) : null;

  let choice;
  if (native) {
    choice = { index: 0, name: '+z up', m: ORIENTATIONS[0].m, seated: seatMatrix(tri, ORIENTATIONS[0].m), report: null };
  } else if (pinOrient !== undefined) {
    choice = { index: pinOrient, name: ORIENTATIONS[pinOrient].name, m: ORIENTATIONS[pinOrient].m, seated: seatMatrix(tri, ORIENTATIONS[pinOrient].m), report: null };
  } else if (isCustomUpload) {
    choice = bestCustomOrientation(tri);
  } else {
    const bo = bestOrientation(tri);
    choice = { ...bo, seated: seatMatrix(tri, bo.m || ORIENTATIONS[bo.index].m, rawBlocker) };
  }

  const report = choice.report ?? supportReport(choice.seated.tri);
  const tier = !report.supportFree ? 'needs-supports'
    : (entry.source === 'partspec') ? (verified ? 'support-free' : 'unverified')
      : 'geometry-checked';
  const { volumeMm3, areaMm2 } = meshVolumeAndArea(choice.seated.tri);
  const hex = entry.hex ? normHex(entry.hex) : '#F4EFE6';
  return {
    id: entry.id,
    qty: entry.qty ?? 1,
    role: entry.role ?? '',
    source: entry.source ?? 'kip.scad',
    file: entry.file,
    hex,
    colorName: entry.colorName || colorNameForHex(hex),
    material: entry.material || 'PLA',
    group: entry.group || 'character',
    accents: entry.accents ? [...entry.accents] : [],
    sha256,
    tri: choice.seated.tri,
    blockerTri: tier === 'needs-supports' ? (choice.seated.auxTri || null) : null,
    w: choice.seated.size[0],
    h: choice.seated.size[1],
    z: choice.seated.size[2],
    heightMm: choice.seated.size[2],
    volumeMm3,
    areaMm2,
    orientation: choice.name,
    islands: choice.islands ?? 0,
    report,
    tier,
  };
}

/** Expand quantities into individual packable items with globally unique instance ids ("boot#1", "boot#2"). */
export function expandInstances(prepared, qtyById = null) {
  const totals = new Map();
  for (const p of prepared) {
    const q = (qtyById && qtyById[p.id] !== undefined) ? qtyById[p.id] : (p.qty ?? 1);
    totals.set(p.id, (totals.get(p.id) || 0) + q);
  }
  const seen = new Map();
  const out = [];
  for (const p of prepared) {
    const q = (qtyById && qtyById[p.id] !== undefined) ? qtyById[p.id] : (p.qty ?? 1);
    const totalForId = totals.get(p.id) || q;
    for (let i = 1; i <= q; i++) {
      const idx = (seen.get(p.id) || 0) + 1;
      seen.set(p.id, idx);
      out.push({
        ...p,
        qty: 1,
        instance: totalForId > 1 ? `${p.id}#${idx}` : p.id,
      });
    }
  }
  return out;
}

function materializePlacedPlate(placed, byId, boundMm, centerOnPlate = true) {
  let maxX = 0, maxY = 0;
  for (const pl of placed) {
    if (pl.x + pl.w > maxX) maxX = pl.x + pl.w;
    if (pl.y + pl.h > maxY) maxY = pl.y + pl.h;
  }
  const shiftX = centerOnPlate ? Math.max(0, (boundMm - maxX) / 2) : 0;
  const shiftY = centerOnPlate ? Math.max(0, (boundMm - maxY) / 2) : 0;
  return placed.map((pl) => {
    const inst = byId.get(pl.id);
    const px = pl.x + shiftX;
    const py = pl.y + shiftY;
    const turnIdx = pl.turnIdx !== undefined ? pl.turnIdx : (pl.rot ? 1 : 0);
    const tri = rotateSeatedZ(inst.tri, inst.w, inst.h, turnIdx);
    const world = transform(tri, [1, 0, 0, 0, 1, 0, 0, 0, 1], [px, py, 0]);
    const blockerWorld = inst.blockerTri
      ? transform(rotateSeatedZ(inst.blockerTri, inst.w, inst.h, turnIdx), [1, 0, 0, 0, 1, 0, 0, 0, 1], [px, py, 0])
      : null;
    return {
      ...pl,
      x: px,
      y: py,
      instance: inst.instance,
      partId: inst.id,
      role: inst.role,
      tier: inst.tier,
      source: inst.source,
      hex: inst.hex,
      colorName: inst.colorName,
      material: inst.material,
      group: inst.group,
      accents: inst.accents,
      sha256: inst.sha256 || '',
      volumeMm3: inst.volumeMm3,
      areaMm2: inst.areaMm2,
      tri: world,
      blockerTri: blockerWorld,
      z: inst.z,
      orientation: inst.orientation,
      report: inst.report,
    };
  });
}

function shiftPlacedItems(items, dx, dy) {
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return items;
  return items.map((p) => ({
    ...p,
    x: p.x + dx,
    y: p.y + dy,
    tri: transform(p.tri, [1, 0, 0, 0, 1, 0, 0, 0, 1], [dx, dy, 0]),
    blockerTri: p.blockerTri ? transform(p.blockerTri, [1, 0, 0, 0, 1, 0, 0, 0, 1], [dx, dy, 0]) : null,
  }));
}

/** Pack prepared instances onto square plates with final world triangles, centred inside `[0, boundMm]^2`. */
export function buildPlates(instances, {
  boundMm = plateBound().mm,
  gap = LIMITS.gapMm,
  polygonNest = true,
  centerOnPlate = true,
} = {}) {
  const byId = new Map(instances.map((p) => [p.instance, p]));
  const res = packPlates(instances.map((p) => ({ id: p.instance, w: p.w, h: p.h })), boundMm, gap);
  let chosenRaw = res.plates;

  if (polygonNest && res.plates.length > 0 && instances.length >= 2 && boundMm >= 40) {
    const fitInstances = instances.filter(it => !res.oversize.some(o => o.id === it.instance));
    const polyRaw = packPolygonPlates(fitInstances, boundMm, gap);
    if (polyRaw.length > 0 && polyRaw.reduce((s, p) => s + p.length, 0) === fitInstances.length) {
      const [rCount, rArea] = scorePackedPlates(res.plates);
      const [pCount, pArea] = scorePackedPlates(polyRaw);
      if (pCount < rCount || (pCount === rCount && pArea < rArea * 0.99)) {
        const candidatePlates = polyRaw.map((pl) => materializePlacedPlate(pl, byId, boundMm, centerOnPlate));
        if (candidatePlates.every((pl) => checkPlacement(pl, boundMm, gap).length === 0)) {
          return { plates: candidatePlates, oversize: res.oversize.map((o) => o.id), boundMm, gap };
        }
      }
    }
  }

  const plates = chosenRaw.map((placed) => materializePlacedPlate(placed, byId, boundMm, centerOnPlate));
  return { plates, oversize: res.oversize.map((o) => o.id), boundMm, gap };
}

/**
 * Plan colour-separated (and support-separated + vehicle-separated) plates for any printer (§5.1, §7.2),
 * including M4 flat-pack sprue kit cards + adjacent loose zones when `profile.flatPackMode === 'sprue'` (§6).
 */
export function planColorPlates(preparedItems, rawProfile = createDefaultProfile()) {
  const profile = clampProfile(rawProfile);
  const bound = plateBound(profile.bedXmm, profile.brimMarginMm, profile.bedYmm);

  let workingItems = preparedItems;
  let merges = [];
  if (profile.maxSlots > 1 && profile.tooManyColours === 'merge') {
    const merged = consolidateColors(preparedItems, profile.maxSlots);
    workingItems = merged.items;
    merges = merged.merges;
  }

  const instances = expandInstances(workingItems);
  const estimate = estimateSpoolAndChanges(workingItems, profile);

  // Assign stable 1-based colour ranks ordered by total spool grams descending
  const colorOrder = estimate.spools.map(s => s.hex);
  const colorRankMap = new Map(colorOrder.map((h, idx) => [h, idx]));

  // Partition by (group: character -> vehicle), then colour rank, then clean vs needs-supports
  const buckets = new Map();
  for (const inst of instances) {
    const grp = inst.group === 'vehicle' ? 'vehicle' : 'character';
    const isSup = inst.tier === 'needs-supports';
    const key = `${grp}|${inst.hex}|${isSup ? 'sup' : 'clean'}`;
    if (!buckets.has(key)) {
      buckets.set(key, {
        group: grp,
        hex: inst.hex,
        colorName: inst.colorName || colorNameForHex(inst.hex),
        requiresSupports: isSup,
        items: [],
      });
    }
    buckets.get(key).items.push(inst);
  }

  const orderedBuckets = [...buckets.values()].sort((a, b) => {
    if (a.group !== b.group) return a.group === 'character' ? -1 : 1;
    if (a.requiresSupports !== b.requiresSupports) return a.requiresSupports ? 1 : -1;
    const ra = colorRankMap.get(a.hex) ?? 999;
    const rb = colorRankMap.get(b.hex) ?? 999;
    return ra - rb || a.hex.localeCompare(b.hex);
  });

  const plannedPlates = [];
  const oversize = [];
  const sprueMode = profile.flatPackMode === 'sprue';
  const usableCardMm = sprueUsableBoundMm(bound.mm);
  const margin = sprueMarginMm();

  for (const b of orderedBuckets) {
    const gap = b.requiresSupports ? LIMITS.supportGapMm : LIMITS.gapMm;
    const rank = colorRankMap.get(b.hex) ?? 0;
    const extruderSlot = profile.maxSlots > 1 ? ((rank % profile.maxSlots) + 1) : 1;
    const projectExtruder = rank + 1;

    if (!sprueMode || b.requiresSupports || usableCardMm < 24) {
      const packed = buildPlates(b.items, { boundMm: bound.mm, gap });
      for (const ov of packed.oversize) oversize.push(ov);
      packed.plates.forEach((placed) => {
        plannedPlates.push({
          hex: b.hex,
          colorName: b.colorName,
          slug: colorSlug(b.hex),
          group: b.group,
          requiresSupports: b.requiresSupports,
          extruderSlot,
          projectExtruder,
          boundMm: bound.mm,
          gap,
          sprue: null,
          placed: placed.map(p => ({ ...p, sprueAnchored: false })),
        });
      });
      continue;
    }

    // Partition clean bucket into sprue-eligible (>= 2 safe anchors) vs loose-zone items (pegs, turrets, pins, gears, etc.)
    const cardItems = [];
    let looseQueue = [];
    for (const inst of b.items) {
      const elig = isSprueEligiblePart({ ...inst, partId: inst.id, cardMaxMm: bound.mm });
      if (elig.ok && samplePartAnchors(inst.tri, { partId: inst.id }).anchors.length >= 2) {
        cardItems.push(inst);
      } else {
        looseQueue.push(inst);
      }
    }

    if (cardItems.length > 0) {
      const cardPacked = buildPlates(cardItems, { boundMm: usableCardMm, gap: SPRUE_SPEC.partGapMm, centerOnPlate: false });
      // Any card item too big for usableCardMm falls back cleanly to looseQueue
      if (cardPacked.oversize.length) {
        const ovSet = new Set(cardPacked.oversize);
        for (const inst of cardItems) {
          if (ovSet.has(inst.instance)) looseQueue.push(inst);
        }
      }

      for (const rawCardPlate of cardPacked.plates) {
        let spanW = 0, spanH = 0;
        for (const p of rawCardPlate) {
          if (p.x + p.w > spanW) spanW = p.x + p.w;
          if (p.y + p.h > spanH) spanH = p.y + p.h;
        }
        const cardW = spanW + 2 * margin;
        const cardH = spanH + 2 * margin;

        // Check whether loose-zone parts can share an adjacent strip (`>= gap` outside `frameBox`) on this plate
        let looseOnPlate = [];
        let ensembleW = cardW;
        let ensembleH = cardH;
        if (looseQueue.length > 0) {
          const rightW = bound.mm - cardW - gap;
          const topH = bound.mm - cardH - gap;
          const useRight = rightW * bound.mm >= bound.mm * topH;
          const stripW = useRight ? rightW : bound.mm;
          const stripH = useRight ? bound.mm : topH;
          if (stripW >= 10 && stripH >= 10) {
            const byLooseId = new Map(looseQueue.map(it => [it.instance, it]));
            const stripPack = packPlates(
              looseQueue.map(it => ({ id: it.instance, w: it.w, h: it.h })),
              stripW,
              gap,
              stripH,
            );
            if (stripPack.plates.length > 0 && stripPack.plates[0].length > 0) {
              const firstStrip = materializePlacedPlate(stripPack.plates[0], byLooseId, bound.mm, false);
              const takenIds = new Set(firstStrip.map(p => p.instance));
              looseQueue = looseQueue.filter(it => !takenIds.has(it.instance));
              const lx = useRight ? cardW + gap : 0;
              const ly = useRight ? 0 : cardH + gap;
              looseOnPlate = shiftPlacedItems(firstStrip, lx, ly);
              for (const lp of looseOnPlate) {
                if (lp.x + lp.w > ensembleW) ensembleW = lp.x + lp.w;
                if (lp.y + lp.h > ensembleH) ensembleH = lp.y + lp.h;
              }
            }
          }
        }

        const shiftX = Math.max(0, (bound.mm - ensembleW) / 2);
        const shiftY = Math.max(0, (bound.mm - ensembleH) / 2);
        const finalCardParts = shiftPlacedItems(rawCardPlate, margin + shiftX, margin + shiftY)
          .map(p => ({ ...p, sprueAnchored: true }));
        const finalLooseParts = shiftPlacedItems(looseOnPlate, shiftX, shiftY)
          .map(p => ({ ...p, sprueAnchored: false }));

        const frameBox = { x: shiftX, y: shiftY, w: cardW, h: cardH };
        const sprue = buildSprueCard(finalCardParts, { frameBox, boundMm: bound.mm });

        // Account for kit-card frame & runner filament in spool estimate
        if (sprue && sprue.tri.length) {
          const { volumeMm3, areaMm2 } = meshVolumeAndArea(sprue.tri);
          const runnerEst = partMassEstimateGrams({ volumeMm3, areaMm2, qty: 1, material: profile.material || 'PLA' });
          const spool = estimate.spools.find(s => s.hex === b.hex);
          if (spool) {
            spool.grams = +(spool.grams + runnerEst.grams).toFixed(1);
            spool.minGrams = +(spool.minGrams + runnerEst.minGrams).toFixed(1);
            spool.maxGrams = +(spool.maxGrams + runnerEst.maxGrams).toFixed(1);
            spool.solidGrams = +(spool.solidGrams + runnerEst.solidGrams).toFixed(1);
          }
          estimate.totalGrams = +(estimate.totalGrams + runnerEst.grams).toFixed(1);
          estimate.minTotalGrams = +(estimate.minTotalGrams + runnerEst.minGrams).toFixed(1);
          estimate.maxTotalGrams = +(estimate.maxTotalGrams + runnerEst.maxGrams).toFixed(1);
          if (b.group === 'vehicle') estimate.vehicleGrams = +(estimate.vehicleGrams + runnerEst.grams).toFixed(1);
          else estimate.characterGrams = +(estimate.characterGrams + runnerEst.grams).toFixed(1);
        }

        plannedPlates.push({
          hex: b.hex,
          colorName: b.colorName,
          slug: colorSlug(b.hex),
          group: b.group,
          requiresSupports: false,
          extruderSlot,
          projectExtruder,
          boundMm: bound.mm,
          gap,
          sprue,
          placed: [...finalCardParts, ...finalLooseParts],
        });
      }
    }

    if (looseQueue.length > 0) {
      const loosePacked = buildPlates(looseQueue, { boundMm: bound.mm, gap });
      for (const ov of loosePacked.oversize) oversize.push(ov);
      loosePacked.plates.forEach((placed) => {
        plannedPlates.push({
          hex: b.hex,
          colorName: b.colorName,
          slug: colorSlug(b.hex),
          group: b.group,
          requiresSupports: false,
          extruderSlot,
          projectExtruder,
          boundMm: bound.mm,
          gap,
          sprue: null,
          placed: placed.map(p => ({ ...p, sprueAnchored: false })),
        });
      });
    }
  }

  const totalPlates = plannedPlates.length;
  plannedPlates.forEach((pl, i) => {
    pl.index = i;
    pl.plateNumber = i + 1;
    const tags = [];
    if (pl.sprue) {
      const hasLoose = pl.placed.some(p => !p.sprueAnchored);
      tags.push(hasLoose ? 'Kit card + Loose' : 'Kit card');
    }
    if (pl.requiresSupports) tags.push('Supports');
    if (pl.group === 'vehicle') tags.push('Vehicle');
    const suffix = tags.length ? ` · ${tags.join(' · ')}` : '';
    pl.label = `Plate ${i + 1} of ${totalPlates}: ${pl.colorName} (${pl.hex})${suffix}`;
    const fileTag = [pl.slug, pl.hex.slice(1).toLowerCase()];
    if (pl.sprue) fileTag.push('kitcard');
    if (pl.requiresSupports) fileTag.push('supports');
    if (pl.group === 'vehicle') fileTag.push('vehicle');
    pl.fileStem = `plate_${String(i + 1).padStart(2, '0')}_${fileTag.join('_')}`;
  });

  return {
    profile,
    bound,
    plates: plannedPlates,
    rawPlates: plannedPlates.map(p => p.placed),
    oversize,
    merges,
    estimate,
    filamentColoursHex: colorOrder.length ? colorOrder : ['#F4EFE6'],
  };
}

/** One binary STL holding every part on a plate (plus kit-card runners when present; never support blockers). */
export function plateStl(placedOrPlate, name = 'kip-plate', sprue = null) {
  const isRich = !Array.isArray(placedOrPlate) && placedOrPlate && Array.isArray(placedOrPlate.placed);
  const placed = isRich ? placedOrPlate.placed : placedOrPlate;
  const activeSprue = sprue ?? (isRich ? placedOrPlate.sprue : null);
  let n = activeSprue?.tri?.length || 0;
  for (const p of placed) n += p.tri.length;
  const all = new Float32Array(n);
  let o = 0;
  for (const p of placed) { all.set(p.tri, o); o += p.tri.length; }
  if (activeSprue?.tri?.length) all.set(activeSprue.tri, o);
  return stlBytes(all, name);
}

// ---------------------------------------------------------------------------------------------
// Export: zip (store), 3MF (Orca/Bambu & PrusaSlicer dialects), multi-plate project, layout, README
// ---------------------------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Minimal zip writer, "stored" (no compression). files: [{ name, data: Uint8Array | string }]. */
export function zipStore(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0x0800, true); dv.setUint16(8, 0, true);
    dv.setUint16(10, 0, true); dv.setUint16(12, 0x21, true); dv.setUint32(14, crc, true);
    dv.setUint32(18, data.length, true); dv.setUint32(22, data.length, true); dv.setUint16(26, name.length, true); dv.setUint16(28, 0, true);
    local.set(name, 30);
    parts.push(local, data);
    const c = new Uint8Array(46 + name.length);
    const cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true); cv.setUint16(12, 0, true); cv.setUint16(14, 0x21, true); cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    c.set(name, 46);
    central.push(c);
    offset += local.length + data.length;
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
  const total = offset + cdSize + 22;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of [...parts, ...central, end]) { out.set(p, o); o += p.length; }
  return out;
}

const xml = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);

function encodeMeshXml(tri) {
  const keys = new Map();
  const verts = [];
  const tris = [];
  for (let i = 0; i < tri.length; i += 3) {
    const k = `${tri[i]},${tri[i + 1]},${tri[i + 2]}`;
    let v = keys.get(k);
    if (v === undefined) {
      v = verts.length / 3;
      keys.set(k, v);
      verts.push(tri[i], tri[i + 1], tri[i + 2]);
    }
    tris.push(v);
  }
  let vx = '';
  for (let i = 0; i < verts.length; i += 3) {
    vx += `<vertex x="${+verts[i].toFixed(4)}" y="${+verts[i + 1].toFixed(4)}" z="${+verts[i + 2].toFixed(4)}"/>`;
  }
  let tx = '';
  for (let i = 0; i < tris.length; i += 3) {
    tx += `<triangle v1="${tris[i]}" v2="${tris[i + 1]}" v3="${tris[i + 2]}"/>`;
  }
  return { vx, tx, triCount: tris.length / 3 };
}

// Per-filament defaults required by OrcaSlicer / Bambu Studio CLI & GUI when loading multi-slot `project_settings.config`.
const ORCA_FILAMENT_SLOT_DEFAULTS = Object.freeze({
  activate_air_filtration: '0', activate_air_filtration_during_print: '1', activate_air_filtration_on_completion: '1',
  activate_chamber_temp_control: '0', adaptive_pressure_advance: '0', adaptive_pressure_advance_bridges: '0',
  adaptive_pressure_advance_model: '0,0,0\n0,0,0', adaptive_pressure_advance_overhangs: '0',
  additional_cooling_fan_speed: '0', additional_fan_full_speed_layer: '0', chamber_minimal_temperature: '0',
  chamber_temperature: '0', close_additional_fan_first_x_layers: '1', close_fan_the_first_x_layers: '1',
  complete_print_exhaust_fan_speed: '80', cool_plate_temp: '35', cool_plate_temp_initial_layer: '35',
  default_filament_colour: '', dont_slow_down_outer_wall: '0', during_print_exhaust_fan_speed: '60',
  enable_overhang_bridge_fan: '1', enable_pressure_advance: '0', eng_plate_temp: '45', eng_plate_temp_initial_layer: '45',
  extruder_printable_height: '0', fan_cooling_layer_time: '60', fan_max_speed: '100', fan_min_speed: '20',
  filament_adaptive_volumetric_speed: '0', filament_adhesiveness_category: '0', filament_change_extrusion_role_gcode: '',
  filament_change_length: '10', filament_cooling_before_tower: '10', filament_cooling_final_speed: '3.4',
  filament_cooling_initial_speed: '2.2', filament_cooling_moves: '4', filament_cost: '0', filament_end_gcode: '',
  filament_extruder_variant: 'Direct Drive Standard', filament_flow_ratio: '0.98', filament_flush_temp: '0',
  filament_flush_volumetric_speed: '0', filament_ironing_flow: 'nil', filament_ironing_inset: 'nil',
  filament_ironing_spacing: 'nil', filament_ironing_speed: 'nil', filament_is_support: '0',
  filament_loading_speed: '28', filament_loading_speed_start: '3', filament_map: '1',
  filament_max_volumetric_speed: '12', filament_minimal_purge_on_wipe_tower: '15', filament_multitool_ramming: '0',
  filament_multitool_ramming_flow: '10', filament_multitool_ramming_volume: '10', filament_notes: '',
  filament_printable: '3',
  filament_ramming_parameters: '120 100 6.6 6.8 7.2 7.6 7.9 8.2 8.7 9.4 9.9 10.0| 0.05 6.6 0.45 6.8 0.95 7.8 1.45 8.3 1.95 9.7 2.45 10 2.95 7.6 3.45 7.6 3.95 7.6 4.45 7.6 4.95 7.6',
  filament_shrink: '100%', filament_shrinkage_compensation_z: '100%', filament_soluble: '0',
  filament_stamping_distance: '0', filament_stamping_loading_speed: '0', filament_start_gcode: '',
  filament_toolchange_delay: '0', filament_tower_interface_pre_extrusion_dist: '10',
  filament_tower_interface_pre_extrusion_length: '0', filament_tower_interface_print_temp: '-1',
  filament_tower_interface_purge_volume: '20', filament_tower_ironing_area: '4', filament_unloading_speed: '90',
  filament_unloading_speed_start: '100', first_layer_print_sequence: '0', first_x_layer_fan_speed: '0',
  flush_multiplier: '0.3', full_fan_speed_layer: '0', grab_length: '0', hot_plate_temp: '55',
  hot_plate_temp_initial_layer: '55', idle_temperature: '0', internal_bridge_fan_speed: '-1',
  ironing_fan_speed: '-1', long_retractions_when_cut: '0', long_retractions_when_ec: '0',
  machine_max_junction_deviation: '0.01', max_layer_height: '0', min_layer_height: '0.07',
  nozzle_flush_dataset: '0', nozzle_temperature: '220', nozzle_temperature_initial_layer: '220',
  nozzle_temperature_range_high: '240', nozzle_temperature_range_low: '190', nozzle_type: 'undefine',
  nozzle_volume: '0', nozzle_volume_type: 'Standard', other_layers_print_sequence: '0', overhang_fan_speed: '100',
  overhang_fan_threshold: '95%', physical_extruder_map: '0', pressure_advance: '0.02', print_extruder_id: '1',
  print_extruder_variant: 'Direct Drive Standard', printer_extruder_id: '1',
  printer_extruder_variant: 'Direct Drive Standard', reduce_fan_stop_start_freq: '0', required_nozzle_HRC: '0',
  retract_lift_above: '0', retract_lift_below: '0', retract_lift_enforce: 'All Surfaces',
  retraction_distances_when_cut: '18', retraction_distances_when_ec: '10', retraction_length: '0.8',
  slow_down_for_layer_cooling: '1', slow_down_layer_time: '5', slow_down_min_speed: '10',
  supertack_plate_temp: '35', supertack_plate_temp_initial_layer: '35', support_material_interface_fan_speed: '-1',
  temperature_vitrification: '100', textured_cool_plate_temp: '40', textured_cool_plate_temp_initial_layer: '40',
  textured_plate_temp: '55', textured_plate_temp_initial_layer: '55', travel_slope: '3',
  volumetric_speed_coefficients: '',
});

function buildOrcaProjectSettingsJson(filamentColours, profile) {
  const cols = filamentColours.length ? filamentColours.map(h => normHex(h)) : ['#F4EFE6'];
  const mat = profile.material === 'PETG' ? 'PETG' : 'PLA';
  const rho = mat === 'PETG' ? '1.27' : '1.24';
  const types = cols.map(() => mat);
  const nozzle = Number(profile.nozzleMm) === 0.2 ? 0.2 : 0.4;
  const W = Math.max(120, Math.round(profile.bedXmm || 180));
  const D = Math.max(120, Math.round(profile.bedYmm || W));
  const H = Math.max(100, Math.round(profile.maxZmm || 180));
  const wipeY = String(Math.max(20, Math.min(D - 20, 150)));

  const perFil = {};
  for (const [k, val] of Object.entries(ORCA_FILAMENT_SLOT_DEFAULTS)) {
    perFil[k] = cols.map(() => val);
  }
  perFil.filament_map = cols.map((_, idx) => String(idx + 1));
  perFil.wipe_tower_x = cols.map(() => '15');
  perFil.wipe_tower_y = cols.map(() => wipeY);

  return JSON.stringify({
    version: '02.02.00.50',
    from: 'User',
    name: 'Kip Print Pack',
    printer_settings_id: nozzle === 0.2 ? 'Bambu Lab A1 mini 0.2 nozzle' : 'Bambu Lab A1 mini 0.4 nozzle',
    print_settings_id: nozzle === 0.2 ? '0.12mm Fine @BBL A1M 0.2 nozzle' : '0.20mm Standard @BBL A1M',
    ...perFil,
    filament_settings_id: cols.map(() => (mat === 'PETG' ? 'Generic PETG' : 'Generic PLA')),
    filament_ids: cols.map(() => (mat === 'PETG' ? 'GFG99' : 'GFL99')),
    filament_colour: cols,
    filament_type: types,
    filament_vendor: cols.map(() => 'Generic'),
    filament_density: cols.map(() => rho),
    filament_diameter: cols.map(() => '1.75'),
    nozzle_diameter: [String(nozzle)],
    printable_area: ['0x0', `${W}x0`, `${W}x${D}`, `0x${D}`],
    printable_height: String(H),
    bed_exclude_area: ['0x0'],
    layer_height: nozzle === 0.2 ? '0.12' : '0.2',
    initial_layer_print_height: '0.2',
    wall_loops: '3',
    top_shell_layers: '4',
    bottom_shell_layers: '3',
    sparse_infill_density: '15%',
    sparse_infill_pattern: 'grid',
    wall_generator: 'arachne',
    detect_thin_wall: '1',
    gcode_flavor: 'marlin',
    printer_technology: 'FFF',
    print_sequence: profile.multiColorStrategy === 'by-object' ? 'by object' : 'by layer',
    different_settings_to_system: ['', '', ...cols.map(() => '')],
  }, null, 2);
}

function concatTris(arrays) {
  let total = 0;
  for (const a of arrays) if (a && a.length) total += a.length;
  const out = new Float32Array(total);
  let off = 0;
  for (const a of arrays) {
    if (!a || !a.length) continue;
    out.set(a, off);
    off += a.length;
  }
  return out;
}

function resolve3mfObjects(placed, sprue, fallbackHex, fallbackName, cardName = 'kit_card') {
  if (!sprue || !sprue.tri || !sprue.tri.length) return placed;
  const cardParts = placed.filter(p => p.sprueAnchored !== false);
  const looseParts = placed.filter(p => p.sprueAnchored === false);
  if (!cardParts.length) return placed;
  const first = cardParts[0];
  const mergedCard = {
    instance: cardName,
    partId: cardName,
    tier: 'support-free',
    hex: first.hex || fallbackHex || '#F4EFE6',
    colorName: first.colorName || fallbackName || 'Warm Shell Cream',
    extruderSlot: first.extruderSlot,
    tri: concatTris([...cardParts.map(p => p.tri), sprue.tri]),
    blockerTri: null,
  };
  return [mergedCard, ...looseParts];
}

/**
 * Single-plate 3MF writer supporting both `orca_bambu` (`Metadata/model_settings.config` + `project_settings.config`)
 * and `prusa` (`Metadata/Slic3r_PE_model.config` + `Slic3r_PE.config`) dialects (§5.2),
 * including mating-socket `support_blocker` sub-parts and unioned kit-card sprue meshes.
 * When `slicer` is omitted, defaults to `prusa` metadata for backward compatibility with v1 callers.
 */
export function to3mf(placedOrPlate, {
  bedMm = LIMITS.bedMm,
  bedYmm = bedMm,
  boundMm = plateBound(bedMm).mm,
  title = 'Kip plate',
  slicer = 'prusa',
  profile = null,
  extruder = 1,
  filamentColours = null,
  sprue = null,
} = {}) {
  const isRich = !Array.isArray(placedOrPlate) && placedOrPlate && Array.isArray(placedOrPlate.placed);
  const placed = isRich ? placedOrPlate.placed : placedOrPlate;
  const activeSprue = sprue ?? (isRich ? placedOrPlate.sprue : null);
  const cardStem = isRich && placedOrPlate.slug ? `kit_card_${placedOrPlate.slug}` : 'kit_card';
  const emitItems = resolve3mfObjects(placed, activeSprue, isRich ? placedOrPlate.hex : null, isRich ? placedOrPlate.colorName : null, cardStem);

  const prof = profile ? clampProfile(profile) : clampProfile({ presetId: 'custom', slicer, bedXmm: bedMm, bedYmm });
  const fit = fitCompensationForProfile(prof);
  const isOrca = slicer === 'orca_bambu';
  const offX = (bedMm - boundMm) / 2;
  const offY = ((bedYmm ?? bedMm) - boundMm) / 2;

  const palette = [];
  const paletteIdx = new Map();
  const ensureColor = (hex, name) => {
    const h = normHex(hex || '#F4EFE6');
    if (!paletteIdx.has(h)) {
      paletteIdx.set(h, palette.length);
      palette.push({ hex: h, name: name || colorNameForHex(h) });
    }
    return paletteIdx.get(h);
  };
  for (const p of emitItems) ensureColor(p.hex || '#F4EFE6', p.colorName);
  if (!palette.length) ensureColor('#F4EFE6', 'Warm Shell Cream');

  const materialsXml = `<basematerials id="9000">${palette.map(c => `<base name="${xml(c.name)}" displaycolor="${c.hex}"/>`).join('')}</basematerials>`
    + `<m:colorgroup id="9001">${palette.map(c => `<m:color color="${c.hex}FF"/>`).join('')}</m:colorgroup>`;

  let objects = '';
  let build = '';
  let prusaCfg = '';
  let orcaObjCfg = '';
  let orcaPlateInstances = '';
  let nextId = 1;

  emitItems.forEach((p, idx) => {
    const pindex = ensureColor(p.hex || '#F4EFE6', p.colorName);
    const objExtruder = p.extruderSlot || extruder || 1;
    const needsSup = p.tier === 'needs-supports';
    const hasBlocker = needsSup && p.blockerTri && p.blockerTri.length > 0;

    let id;
    let modelSubId = 1;
    let blockerSubId = 0;

    if (isOrca && hasBlocker) {
      modelSubId = nextId++;
      blockerSubId = nextId++;
      id = nextId++;
      const mEnc = encodeMeshXml(p.tri);
      const bEnc = encodeMeshXml(p.blockerTri);
      objects += `<object id="${modelSubId}" name="${xml(p.instance)}" type="model" pid="9000" pindex="${pindex}"><mesh><vertices>${mEnc.vx}</vertices><triangles>${mEnc.tx}</triangles></mesh></object>`
        + `<object id="${blockerSubId}" name="${xml(`${p.instance}_socket_guard`)}" type="model"><mesh><vertices>${bEnc.vx}</vertices><triangles>${bEnc.tx}</triangles></mesh></object>`
        + `<object id="${id}" name="${xml(p.instance)}" type="model"><metadata name="kip:tier">${p.tier}</metadata><components><component objectid="${modelSubId}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/><component objectid="${blockerSubId}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></components></object>`;
    } else if (!isOrca && hasBlocker) {
      id = nextId++;
      const modelTriCount = p.tri.length / 9;
      const combined = concatTris([p.tri, p.blockerTri]);
      const { vx, tx, triCount } = encodeMeshXml(combined);
      objects += `<object id="${id}" name="${xml(p.instance)}" type="model" pid="9000" pindex="${pindex}"><metadata name="kip:tier">${p.tier}</metadata><mesh><vertices>${vx}</vertices><triangles>${tx}</triangles></mesh></object>`;

      let prusaMeta = `<metadata type="object" key="name" value="${xml(p.instance)}"/>`
        + `<metadata type="object" key="extruder" value="${objExtruder}"/>`;
      if (fit.prusa.xy_size_compensation !== 0) {
        prusaMeta += `<metadata type="object" key="xy_size_compensation" value="${fit.prusa.xy_size_compensation}"/>`;
      }
      prusaMeta += '<metadata type="object" key="support_material" value="1"/>'
        + '<metadata type="object" key="support_material_style" value="organic"/>'
        + '<metadata type="object" key="support_material_buildplate_only" value="0"/>'
        + '<metadata type="object" key="support_material_threshold" value="0"/>'
        + '<metadata type="object" key="brim_width" value="0"/>';
      prusaCfg += `<object id="${id}" instances_count="1">${prusaMeta}`
        + `<volume firstid="0" lastid="${Math.max(0, modelTriCount - 1)}"><metadata type="volume" key="volume_type" value="ModelPart"/></volume>`
        + `<volume firstid="${modelTriCount}" lastid="${Math.max(modelTriCount, triCount - 1)}"><metadata type="volume" key="volume_type" value="SupportBlocker"/></volume>`
        + `</object>`;
    } else {
      id = nextId++;
      const { vx, tx, triCount } = encodeMeshXml(p.tri);
      objects += `<object id="${id}" name="${xml(p.instance)}" type="model" pid="9000" pindex="${pindex}"><metadata name="kip:tier">${p.tier}</metadata><mesh><vertices>${vx}</vertices><triangles>${tx}</triangles></mesh></object>`;

      let prusaMeta = `<metadata type="object" key="name" value="${xml(p.instance)}"/>`
        + `<metadata type="object" key="extruder" value="${objExtruder}"/>`;
      if (fit.prusa.xy_size_compensation !== 0) {
        prusaMeta += `<metadata type="object" key="xy_size_compensation" value="${fit.prusa.xy_size_compensation}"/>`;
      }
      if (needsSup) {
        prusaMeta += '<metadata type="object" key="support_material" value="1"/>'
          + '<metadata type="object" key="support_material_style" value="organic"/>'
          + '<metadata type="object" key="support_material_buildplate_only" value="0"/>'
          + '<metadata type="object" key="support_material_threshold" value="0"/>';
      }
      prusaMeta += '<metadata type="object" key="brim_width" value="0"/>';
      prusaCfg += `<object id="${id}" instances_count="1">${prusaMeta}<volume firstid="0" lastid="${Math.max(0, triCount - 1)}"><metadata type="volume" key="volume_type" value="ModelPart"/></volume></object>`;
    }

    build += `<item objectid="${id}" transform="1 0 0 0 1 0 0 0 1 ${+offX.toFixed(3)} ${+offY.toFixed(3)} 0"/>`;

    // Orca / Bambu Studio per-object config
    let orcaMeta = `<metadata key="name" value="${xml(p.instance)}"/>`
      + `<metadata key="extruder" value="${objExtruder}"/>`;
    if (fit.orca.xy_contour_compensation !== 0 || fit.orca.xy_hole_compensation !== 0) {
      orcaMeta += `<metadata key="xy_contour_compensation" value="${fit.orca.xy_contour_compensation}"/>`
        + `<metadata key="xy_hole_compensation" value="${fit.orca.xy_hole_compensation}"/>`;
    }
    if (needsSup) {
      orcaMeta += '<metadata key="enable_support" value="1"/>'
        + '<metadata key="support_type" value="tree(auto)"/>'
        + '<metadata key="support_on_build_plate_only" value="0"/>'
        + '<metadata key="support_threshold_angle" value="35"/>';
    }
    orcaMeta += '<metadata key="brim_type" value="no_brim"/><metadata key="brim_width" value="0"/>';
    const partsXml = (isOrca && hasBlocker)
      ? `<part id="${modelSubId}" subtype="normal_part"><metadata key="name" value="${xml(p.instance)}"/></part><part id="${blockerSubId}" subtype="support_blocker"><metadata key="name" value="${xml(`${p.instance}_socket_guard`)}"/></part>`
      : `<part id="1" subtype="normal_part"><metadata key="name" value="${xml(p.instance)}"/></part>`;
    orcaObjCfg += `<object id="${id}">${orcaMeta}${partsXml}</object>`;
    orcaPlateInstances += `<model_instance><metadata key="object_id" value="${id}"/><metadata key="instance_id" value="0"/><metadata key="identify_id" value="${idx + 1}"/></model_instance>`;
  });

  // Never write "PrusaSlicer" in Application for Orca/Bambu files (§5.2 #3).
  const appMeta = isOrca ? 'BambuStudio-01.09.05.51' : 'ToyVentor Kip print view';
  const model = `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02"><metadata name="Title">${xml(title)}</metadata><metadata name="Application">${appMeta}</metadata><resources>${materialsXml}${objects}</resources><build>${build}</build></model>`;

  const entries = [
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="config" ContentType="text/xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>' },
    { name: '3D/3dmodel.model', data: model },
  ];

  const filCols = filamentColours || palette.map(c => c.hex);
  if (isOrca) {
    const plateXml = `<plate><metadata key="plater_id" value="1"/><metadata key="plater_name" value="${xml(title)}"/><metadata key="print_sequence" value="${prof.multiColorStrategy === 'by-object' ? 'by object' : 'by layer'}"/>${orcaPlateInstances}</plate>`;
    entries.push(
      { name: 'Metadata/model_settings.config', data: `<?xml version="1.0" encoding="UTF-8"?><config>${orcaObjCfg}${plateXml}</config>` },
      { name: 'Metadata/project_settings.config', data: buildOrcaProjectSettingsJson(filCols, prof) },
    );
  } else {
    const prusaGlobal = [
      '; generated by ToyVentor Kip Print Pack',
      `filament_colour = ${filCols.map(h => normHex(h)).join(';')}`,
      `nozzle_diameter = ${prof.nozzleMm || 0.4}`,
      `complete_objects = ${prof.multiColorStrategy === 'by-object' ? 1 : 0}`,
      '',
    ].join('\n');
    entries.push(
      { name: 'Metadata/Slic3r_PE_model.config', data: `<?xml version="1.0" encoding="UTF-8"?><config>${prusaCfg}</config>` },
      { name: 'Metadata/Slic3r_PE.config', data: prusaGlobal },
    );
  }
  return zipStore(entries);
}

/**
 * Multi-plate Orca/Bambu Studio project `.3mf` (`project/kip-project.3mf`, §5.2 #2).
 * Plate k (0-based) sits at world origin `(col * 1.2 * W, -row * 1.2 * D)` with `cols = ceil(sqrt(N))`.
 */
export function to3mfProject(plannedPlates, rawProfile = createDefaultProfile(), { title = 'Kip Project' } = {}) {
  const prof = clampProfile(rawProfile);
  const fit = fitCompensationForProfile(prof);
  const W = prof.bedXmm;
  const D = prof.bedYmm;
  const N = Math.max(1, plannedPlates.length);
  const cols = Math.max(1, Math.ceil(Math.sqrt(N)));

  const palette = [];
  const paletteIdx = new Map();
  const ensureColor = (hex, name) => {
    const h = normHex(hex || '#F4EFE6');
    if (!paletteIdx.has(h)) {
      paletteIdx.set(h, palette.length);
      palette.push({ hex: h, name: name || colorNameForHex(h) });
    }
    return paletteIdx.get(h);
  };
  for (const pl of plannedPlates) {
    ensureColor(pl.hex, pl.colorName);
    for (const p of pl.placed) ensureColor(p.hex || pl.hex, p.colorName || pl.colorName);
  }
  if (!palette.length) ensureColor('#F4EFE6', 'Warm Shell Cream');

  const materialsXml = `<basematerials id="9000">${palette.map(c => `<base name="${xml(c.name)}" displaycolor="${c.hex}"/>`).join('')}</basematerials>`
    + `<m:colorgroup id="9001">${palette.map(c => `<m:color color="${c.hex}FF"/>`).join('')}</m:colorgroup>`;

  let objects = '';
  let build = '';
  let orcaObjCfg = '';
  let orcaPlatesXml = '';
  let nextObjId = 1;
  let identifyId = 1;

  plannedPlates.forEach((pl, k) => {
    const col = k % cols;
    const row = Math.floor(k / cols);
    const plateOriginX = col * 1.2 * W;
    const plateOriginY = -row * 1.2 * D;
    const offX = plateOriginX + (W - pl.boundMm) / 2;
    const offY = plateOriginY + (D - pl.boundMm) / 2;

    const cardStem = `kit_card_p${k + 1}_${pl.slug || 'plate'}`;
    const emitItems = resolve3mfObjects(pl.placed, pl.sprue, pl.hex, pl.colorName, cardStem);

    let instancesXml = '';
    for (const p of emitItems) {
      const hex = normHex(p.hex || pl.hex);
      const pindex = ensureColor(hex, p.colorName || pl.colorName);
      // 1-based filament slot index into project_settings.config filament_colour[]
      const extruderIdx = pindex + 1;
      const needsSup = p.tier === 'needs-supports';
      const hasBlocker = needsSup && p.blockerTri && p.blockerTri.length > 0;

      let id;
      let modelSubId = 1;
      let blockerSubId = 0;

      if (hasBlocker) {
        modelSubId = nextObjId++;
        blockerSubId = nextObjId++;
        id = nextObjId++;
        const mEnc = encodeMeshXml(p.tri);
        const bEnc = encodeMeshXml(p.blockerTri);
        objects += `<object id="${modelSubId}" name="${xml(p.instance)}" type="model" pid="9000" pindex="${pindex}"><mesh><vertices>${mEnc.vx}</vertices><triangles>${mEnc.tx}</triangles></mesh></object>`
          + `<object id="${blockerSubId}" name="${xml(`${p.instance}_socket_guard`)}" type="model"><mesh><vertices>${bEnc.vx}</vertices><triangles>${bEnc.tx}</triangles></mesh></object>`
          + `<object id="${id}" name="${xml(p.instance)}" type="model"><metadata name="kip:tier">${p.tier}</metadata><components><component objectid="${modelSubId}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/><component objectid="${blockerSubId}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></components></object>`;
      } else {
        id = nextObjId++;
        const { vx, tx } = encodeMeshXml(p.tri);
        objects += `<object id="${id}" name="${xml(p.instance)}" type="model" pid="9000" pindex="${pindex}"><metadata name="kip:tier">${p.tier}</metadata><mesh><vertices>${vx}</vertices><triangles>${tx}</triangles></mesh></object>`;
      }

      build += `<item objectid="${id}" transform="1 0 0 0 1 0 0 0 1 ${+offX.toFixed(3)} ${+offY.toFixed(3)} 0"/>`;

      let orcaMeta = `<metadata key="name" value="${xml(p.instance)}"/>`
        + `<metadata key="extruder" value="${extruderIdx}"/>`;
      if (fit.orca.xy_contour_compensation !== 0 || fit.orca.xy_hole_compensation !== 0) {
        orcaMeta += `<metadata key="xy_contour_compensation" value="${fit.orca.xy_contour_compensation}"/>`
          + `<metadata key="xy_hole_compensation" value="${fit.orca.xy_hole_compensation}"/>`;
      }
      if (needsSup) {
        orcaMeta += '<metadata key="enable_support" value="1"/>'
          + '<metadata key="support_type" value="tree(auto)"/>'
          + '<metadata key="support_on_build_plate_only" value="0"/>'
          + '<metadata key="support_threshold_angle" value="35"/>';
      }
      orcaMeta += '<metadata key="brim_type" value="no_brim"/><metadata key="brim_width" value="0"/>';
      const partsXml = hasBlocker
        ? `<part id="${modelSubId}" subtype="normal_part"><metadata key="name" value="${xml(p.instance)}"/></part><part id="${blockerSubId}" subtype="support_blocker"><metadata key="name" value="${xml(`${p.instance}_socket_guard`)}"/></part>`
        : `<part id="1" subtype="normal_part"><metadata key="name" value="${xml(p.instance)}"/></part>`;
      orcaObjCfg += `<object id="${id}">${orcaMeta}${partsXml}</object>`;
      instancesXml += `<model_instance><metadata key="object_id" value="${id}"/><metadata key="instance_id" value="0"/><metadata key="identify_id" value="${identifyId++}"/></model_instance>`;
    }

    orcaPlatesXml += `<plate><metadata key="plater_id" value="${k + 1}"/><metadata key="plater_name" value="${xml(pl.label || `Plate ${k + 1}`)}"/><metadata key="print_sequence" value="by layer"/>${instancesXml}</plate>`;
  });

  const model = `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02"><metadata name="Title">${xml(title)}</metadata><metadata name="Application">BambuStudio-01.09.05.51</metadata><resources>${materialsXml}${objects}</resources><build>${build}</build></model>`;

  return zipStore([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="config" ContentType="text/xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>' },
    { name: '3D/3dmodel.model', data: model },
    { name: 'Metadata/model_settings.config', data: `<?xml version="1.0" encoding="UTF-8"?><config>${orcaObjCfg}${orcaPlatesXml}</config>` },
    { name: 'Metadata/project_settings.config', data: buildOrcaProjectSettingsJson(palette.map(c => c.hex), prof) },
  ]);
}

/**
 * Small-parts cylinder screen (31.75 mm diameter x 57.15 mm length, 16 CFR 1501).
 */
export const SMALL_PARTS_DIAMETER_MM = 31.75;
export const SMALL_PARTS_LENGTH_MM = 57.15;
export function smallParts(plates) {
  const small = [];
  for (const pl of plates) {
    const arr = Array.isArray(pl) ? pl : (pl.placed || []);
    for (const p of arr) {
      const d = [p.w, p.h, p.z].sort((a, b) => a - b);
      if (Math.hypot(d[0], d[1]) <= SMALL_PARTS_DIAMETER_MM && d[2] <= SMALL_PARTS_LENGTH_MM) small.push(p.instance);
    }
  }
  return small;
}

/**
 * Sanitize scene state before writing into `layout.json` so binary custom STL bytes or selfie pixel data never leak.
 */
function sanitizeStateForManifest(state = {}) {
  if (!state || typeof state !== 'object') return {};
  const clean = {};
  for (const [k, v] of Object.entries(state)) {
    if (k === 'customStlSlots') {
      clean.customStlSlots = Object.fromEntries(
        Object.entries(v || {}).filter(([, sv]) => sv && sv.bytes).map(([sk, sv]) => [sk, { name: sv.name || sk, colorHex: sv.colorHex || '' }]),
      );
    } else if (k === 'photoAccessorySlots') {
      clean.photoAccessorySlots = Object.fromEntries(
        Object.entries(v || {}).filter(([, pv]) => pv).map(([pk, pv]) => [pk, { label: pv.label || pk }]),
      );
    } else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || (v && typeof v === 'object' && !ArrayBuffer.isView(v) && !(v instanceof ArrayBuffer))) {
      clean[k] = v;
    }
  }
  return clean;
}

/** Layout summary (`toyventor.kip-plate/2`) written next to every export so a pack can be rebuilt and audited. */
export function layoutJson(plates, meta = {}) {
  const small = smallParts(plates);
  const hasSprue = plates.some((entry) => !Array.isArray(entry) && Boolean(entry?.sprue))
    || meta?.profile?.flatPackMode === 'sprue';
  const warnings = [PRINT_PAGE_WARNINGS.always];
  if (small.length) warnings.push(PRINT_PAGE_WARNINGS.small_part);
  if (hasSprue) warnings.push(PRINT_PAGE_WARNINGS.sprue_prep);

  const sanitizedMeta = { ...meta };
  if (sanitizedMeta.state) sanitizedMeta.state = sanitizeStateForManifest(sanitizedMeta.state);

  return JSON.stringify({
    format: 'toyventor.kip-plate/2',
    ...sanitizedMeta,
    warnings,
    smallParts: small,
    plates: plates.map((entry, i) => {
      const isRich = !Array.isArray(entry) && entry && Array.isArray(entry.placed);
      const placed = isRich ? entry.placed : entry;
      const base = {
        plate: i + 1,
        ...(isRich ? {
          label: entry.label,
          fileStem: entry.fileStem,
          hex: entry.hex,
          colorName: entry.colorName,
          group: entry.group,
          requiresSupports: Boolean(entry.requiresSupports),
          extruderSlot: entry.extruderSlot,
          boundMm: entry.boundMm,
          gapMm: entry.gap,
          ...(entry.sprue ? {
            sprue: {
              frameBox: entry.sprue.frameBox,
              gateCount: entry.sprue.gates.length,
              totalGateLengthMm: entry.sprue.totalGateLengthMm,
              cardParts: entry.sprue.cardInstances,
              partGateCounts: entry.sprue.partGateCounts,
            },
          } : {}),
        } : {}),
        parts: placed.map((p) => ({
          instance: p.instance,
          part: p.partId,
          source: p.source,
          tier: p.tier,
          hex: p.hex || (isRich ? entry.hex : '#F4EFE6'),
          sha256: p.sha256 || '',
          x: +p.x.toFixed(3),
          y: +p.y.toFixed(3),
          w: +p.w.toFixed(3),
          h: +p.h.toFixed(3),
          rot90: p.rot,
          orientation: p.orientation,
          overhangMm2: +p.report.overhangMm2.toFixed(2),
          ...(p.sprueAnchored !== undefined ? { sprueAnchored: Boolean(p.sprueAnchored) } : {}),
          ...(p.blockerTri && p.blockerTri.length ? { socketBlockerTris: p.blockerTri.length / 9 } : {}),
        })),
      };
      return base;
    }),
  }, null, 2);
}

/** Plain-text one-screen README included at the root of `kip-print-pack.zip` (§9.2, §9.3). */
export function readmeTxt({ plan, bom, hasPrintSheet = false, stickerFileNames = [] } = {}) {
  const prof = plan.profile;
  const est = plan.estimate;
  const small = smallParts(plan.plates);
  const spruePlateCount = plan.plates.filter(pl => Boolean(pl.sprue)).length;
  const lines = [
    'KIP 3D PRINT PACK — ToyVentor Modular Character System',
    '======================================================',
    '',
    'SAFETY WARNINGS',
    '---------------',
    `WARNING: ${PRINT_PAGE_WARNINGS.small_part}`,
    small.length ? `Small-parts screen (${small.length} pcs): ${small.join(', ')}` : 'Small-parts screen: none flagged.',
    ...(spruePlateCount > 0 || prof.flatPackMode === 'sprue' ? [`WARNING: ${PRINT_PAGE_WARNINGS.sprue_prep}`] : []),
    PRINT_PAGE_WARNINGS.always,
    '',
    'PRINTER & SLICER SETUP',
    '----------------------',
    `Preset: ${prof.presetId} (${prof.bedXmm} x ${prof.bedYmm} mm bed, ${prof.nozzleMm} mm nozzle, ${prof.material})`,
    `Slicer dialect: ${prof.slicer} | Colour slots: ${prof.maxSlots} (${prof.changerType}) | Fit: ${prof.fitChoice}`,
    `Layout: ${prof.flatPackMode}${spruePlateCount > 0 ? ` (${spruePlateCount} kit-card plate(s))` : ''} | Strategy: ${prof.multiColorStrategy}`,
    '',
    'SPOOL BUDGET (ESTIMATE — 3 walls, 15% infill)',
    '---------------------------------------------',
    `Total estimated filament: ~${est.totalGrams} g (range ${est.minTotalGrams}-${est.maxTotalGrams} g)`
      + (est.vehicleGrams > 0 ? ` [character ~${est.characterGrams} g + vehicle ~${est.vehicleGrams} g]` : ''),
    est.colorChanges > 0
      ? `Estimated automatic colour changes: ${est.colorChanges} (~${est.purgeGrams} g purge)`
      : `Manual spool swaps between monochrome plates: ${est.manualSpoolSwaps} (0 g purge tower)`,
    ...est.spools.map(s => `  - ${s.colorName} (${s.hex}): ~${s.grams} g (${s.minGrams}-${s.maxGrams} g), ${s.partCount} part(s)`),
  ];

  if (plan.merges && plan.merges.length) {
    lines.push('', 'AUTO-MERGED COLOURS', '-------------------');
    for (const m of plan.merges) {
      lines.push(`  - ${m.fromName} (${m.fromHex}) -> ${m.toName} (${m.toHex}) [DeltaE00 = ${m.deltaE}]`);
    }
  }

  lines.push('', 'FILES IN THIS PACK', '------------------');
  for (const pl of plan.plates) {
    const sprueNote = pl.sprue ? `, ${pl.sprue.gates.length} V-nick sprue gates` : '';
    lines.push(`  - plates/${pl.fileStem}.3mf & .stl : ${pl.label} (${pl.placed.length} pcs${sprueNote})`);
  }
  lines.push('  - project/kip-project.3mf : Multi-plate OrcaSlicer / Bambu Studio project');
  if (stickerFileNames.length) {
    lines.push('  - stickers/sticker-sheet.pdf : 1:1 printable sticker sheet (print at 100% / Actual size; verify 50.00 mm bar)');
    lines.push('  - stickers/stickers.png, stickers-cut.svg, stickers-cut.dxf : Print-then-cut artwork & cutter paths');
  }
  if (hasPrintSheet) lines.push('  - print-sheet.png : Visual plate map, colour swatches & warning notice');
  lines.push('  - layout.json : Reproducible plate manifest & part SHA-256 checksums');

  if (bom?.notes?.length) {
    lines.push('', 'FINISHING & ACCENT NOTES', '------------------------');
    for (const n of bom.notes) lines.push(`  - ${n}`);
  }
  if (bom?.unmapped?.length) {
    lines.push('', 'NOT ON THE 3D PLATES (2D CRAFT / RE-UPLOAD)', '-------------------------------------------');
    for (const u of bom.unmapped) lines.push(`  - ${u}`);
  }
  lines.push('');
  return lines.join('\n');
}

/** Build the complete `kip-print-pack.zip` entry list (`README.txt`, `plates/*`, `project/kip-project.3mf`, optional `stickers/*`, `print-sheet.png`, `layout.json`). */
export function buildPrintPackFiles({ plan, bom, state = {}, printSheetPng = null, stickerFiles = [] } = {}) {
  const prof = plan.profile;
  const files = [
    {
      name: 'README.txt',
      data: readmeTxt({
        plan,
        bom,
        hasPrintSheet: Boolean(printSheetPng),
        stickerFileNames: stickerFiles.map(f => f.name),
      }),
    },
  ];

  for (const pl of plan.plates) {
    const filCols = prof.maxSlots > 1 ? plan.filamentColoursHex.slice(0, prof.maxSlots) : [pl.hex];
    files.push({
      name: `plates/${pl.fileStem}.3mf`,
      data: to3mf(pl, {
        bedMm: prof.bedXmm,
        bedYmm: prof.bedYmm,
        boundMm: pl.boundMm,
        title: pl.label,
        slicer: prof.slicer === 'prusa' ? 'prusa' : 'orca_bambu',
        profile: prof,
        extruder: pl.extruderSlot,
        filamentColours: filCols,
        sprue: pl.sprue,
      }),
    });
    files.push({
      name: `plates/${pl.fileStem}.stl`,
      data: plateStl(pl, pl.fileStem, pl.sprue),
    });
  }

  files.push({
    name: 'project/kip-project.3mf',
    data: to3mfProject(plan.plates, prof, { title: 'Kip Print Pack' }),
  });

  for (const sf of stickerFiles) {
    if (sf && sf.name && sf.data) files.push({ name: sf.name, data: sf.data });
  }

  if (printSheetPng) {
    files.push({ name: 'print-sheet.png', data: printSheetPng });
  }

  files.push({
    name: 'layout.json',
    data: layoutJson(plan.plates, {
      state,
      profile: prof,
      estimate: plan.estimate,
      merges: plan.merges,
      unmapped: bom?.unmapped || [],
      notes: bom?.notes || [],
      decals: bom?.decals || [],
    }),
  });

  return files;
}
