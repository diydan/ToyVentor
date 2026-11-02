// Kip flat-pack kit-card (sprue) engine: z = 0.30 mm contact-slice contour & keep-out sampler,
// Prim's minimum-spanning tree + opposed secondary gate planner, watertight perimeter frame &
// V-nick breakaway gate mesh builders, and card verification checks (spec section 6).
//
// Pure ES module: typed arrays and plain objects only; zero browser globals, storage, or Three.js.

export const SPRUE_SPEC = Object.freeze({
  layerHeightMm: 0.20,
  frameWidthMm: 2.40,
  frameHeightMm: 1.00,
  outerRadiusMm: 2.00,
  innerRadiusMm: 1.00,
  frameGapMm: 1.20,               // >= 1.20 mm clear air gap from inner frame wall to parts (margin = 3.60 mm/side)
  partGapMm: 5.00,                // >= 5.00 mm clear gap between parts
  gateWidthMm: 1.80,
  gateHeightMm: 0.80,             // 4 layers at 0.20 mm
  neckHeightMm: 0.40,             // 2 layers at 0.20 mm
  grooveTopMm: 0.80,              // 45-deg V-groove opening at top (2 * 0.40 = 0.80 mm >= 0.60 mm spec minimum)
  nickOffsetFromPartMm: 0.80,     // V-nick centre placed 0.80 mm outside the part wall for minimal stub
  anchorInsetMm: 1.60,            // primary anchor inset inside z = 0.30 mm slice
  anchorFallbackInsetMm: 0.80,    // fallback inset when wall thickness is < ~3.2 mm
  sliceZMm: 0.30,                 // bed contact slice plane
  extraGatePerimeterMm: 75.0,     // 2 opposed gates by default; 3 gates above 75 mm contact perimeter
  holeKeepoutMm: 2.20,            // min distance from gate wall entry to internal bore/socket contours
  ballSocketKeepoutRadiusMm: 5.50,// reject spans within r <= 5.5 mm of ball-socket centres
  minOutwardRayClearMm: 3.60,     // reject concave pockets where outward normal ray hits same part within 3.6 mm
  allowPegsAndTurrets: false,     // Decision 11: keep pegs & turrets loose by default until Gate 4 coupon is recorded
});

// Pegs & turrets stay loose by default (Decision 11), gateable behind `spec.allowPegsAndTurrets`.
const PEG_TURRET_ID_RE = /^(?:toyventor_)?(spark_peg_|snap_turret|neck_turret)/;
// Pins, gears, racks, pawls, face pins, and flex skins always stay in the loose zone (spec 6.1 & 6.3).
const ALWAYS_LOOSE_ID_RE = /^(?:toyventor_)?(pin_|pro_captive_pin|pro_pilot_pin|kit_spinner_pin|mech_bat_door_screw|bushing_half|skin_|face_eyes|face_cheeks|face_glints)|(?:^|_)(gear_spur|gear_bevel|pto_gear|pinion_z|steer_rack|ripcord_rack|spool_pawl)/;

/** Usable interior span inside a card of outer limit `cardMaxMm` (`cardMaxMm - 2 * (frameWidth + frameGap)` = `cardMaxMm - 7.2`). */
export function sprueMarginMm(spec = SPRUE_SPEC) {
  return spec.frameWidthMm + spec.frameGapMm;
}

export function sprueUsableBoundMm(cardMaxMm = 170, spec = SPRUE_SPEC) {
  return Math.max(0, cardMaxMm - 2 * sprueMarginMm(spec));
}

/**
 * Check static part eligibility before anchor sampling (spec 6.1 & Decision 11):
 * excludes `needs-supports`, pins/gears, pegs/turrets (unless `spec.allowPegsAndTurrets`), non-rigid materials, and brimmed parts.
 */
export function isSprueEligiblePart(item, spec = SPRUE_SPEC) {
  if (!item) return { ok: false, reason: 'missing-item' };
  const partId = String(item.partId || item.id || '');
  if (item.tier === 'needs-supports') return { ok: false, reason: 'needs-supports' };
  if (item.material && item.material !== 'PLA' && item.material !== 'PETG') {
    return { ok: false, reason: 'non-rigid-material' };
  }
  if ((Number(item.brimWidthMm) || 0) > 0) return { ok: false, reason: 'requires-brim' };
  if (ALWAYS_LOOSE_ID_RE.test(partId)) return { ok: false, reason: 'connector-or-gear' };
  if (!spec.allowPegsAndTurrets && PEG_TURRET_ID_RE.test(partId)) {
    return { ok: false, reason: 'connector-or-gear' };
  }
  const usable = sprueUsableBoundMm(item.cardMaxMm || 170, spec);
  if (Number.isFinite(item.w) && Number.isFinite(item.h)) {
    if (Math.max(item.w, item.h) > usable + 1e-6) return { ok: false, reason: 'exceeds-usable-card' };
  }
  return { ok: true, reason: '' };
}

// ---------------------------------------------------------------------------------------------
// 2D Triangle-Plane Slicer & Oriented Contour Builder
// ---------------------------------------------------------------------------------------------

function shoelaceArea(pts) {
  let a2 = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    a2 += p[0] * q[1] - q[0] * p[1];
  }
  return a2 * 0.5;
}

function loopPerimeter(pts) {
  let len = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    len += Math.hypot(q[0] - p[0], q[1] - p[1]);
  }
  return len;
}

function loopBounds(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return {
    minX, minY, maxX, maxY,
    cx: (minX + maxX) * 0.5,
    cy: (minY + maxY) * 0.5,
    radius: Math.hypot(maxX - minX, maxY - minY) * 0.5,
  };
}

/**
 * Slice a triangle soup `tri` (`Float32Array` of 9 floats/tri) at height `zMm` and return
 * closed oriented 2D loops:
 * - Outer solid contours have `area > 0` (CCW; solid interior on the left of each edge).
 * - Internal hole / socket / bore contours have `area < 0` (CW).
 */
export function sliceMeshAtZ(tri, zMm = SPRUE_SPEC.sliceZMm) {
  const z = zMm + 1.37e-5; // avoid exact vertex-on-plane degeneracies
  const segs = [];

  for (let t = 0; t < tri.length; t += 9) {
    const x0 = tri[t],     y0 = tri[t + 1], z0 = tri[t + 2];
    const x1 = tri[t + 3], y1 = tri[t + 4], z1 = tri[t + 5];
    const x2 = tri[t + 6], y2 = tri[t + 7], z2 = tri[t + 8];

    const s0 = z0 > z ? 1 : 0;
    const s1 = z1 > z ? 1 : 0;
    const s2 = z2 > z ? 1 : 0;
    const sum = s0 + s1 + s2;
    if (sum === 0 || sum === 3) continue;

    const pts = [];
    if (s0 !== s1) {
      const u = (z - z0) / (z1 - z0);
      pts.push([x0 + u * (x1 - x0), y0 + u * (y1 - y0)]);
    }
    if (s1 !== s2) {
      const u = (z - z1) / (z2 - z1);
      pts.push([x1 + u * (x2 - x1), y1 + u * (y2 - y1)]);
    }
    if (s2 !== s0) {
      const u = (z - z2) / (z0 - z2);
      pts.push([x2 + u * (x0 - x2), y2 + u * (y0 - y2)]);
    }
    if (pts.length !== 2) continue;

    let [ax, ay] = pts[0];
    let [bx, by] = pts[1];
    if (Math.hypot(bx - ax, by - ay) < 1e-6) continue;

    // Outward triangle normal XY projection
    const ux = x1 - x0, uy = y1 - y0, uz = z1 - z0;
    const vx = x2 - x0, vy = y2 - y0, vz = z2 - z0;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;

    // Orient A -> B so outward normal points to the RIGHT of A -> B (solid interior on the LEFT => CCW outer)
    if (nx * (by - ay) - ny * (bx - ax) < 0) {
      const tx = ax, ty = ay;
      ax = bx; ay = by;
      bx = tx; by = ty;
    }
    segs.push({ ax, ay, bx, by, used: false });
  }

  const keyOf = (x, y) => `${Math.round(x * 1000)},${Math.round(y * 1000)}`;
  const startMap = new Map();
  segs.forEach((s, idx) => {
    const k = keyOf(s.ax, s.ay);
    let arr = startMap.get(k);
    if (!arr) { arr = []; startMap.set(k, arr); }
    arr.push(idx);
  });

  const loops = [];
  for (let i = 0; i < segs.length; i++) {
    if (segs[i].used) continue;
    segs[i].used = true;
    const pts = [[segs[i].ax, segs[i].ay]];
    const startX = segs[i].ax, startY = segs[i].ay;
    const startKey = keyOf(startX, startY);
    let curX = segs[i].bx, curY = segs[i].by;

    for (let guard = 0; guard < segs.length + 2; guard++) {
      if (pts.length >= 3 && (keyOf(curX, curY) === startKey || Math.hypot(curX - startX, curY - startY) < 0.02)) {
        break;
      }
      pts.push([curX, curY]);
      const k = keyOf(curX, curY);
      const bucket = startMap.get(k);
      let nextIdx = -1;
      if (bucket) {
        for (const candIdx of bucket) {
          if (!segs[candIdx].used) { nextIdx = candIdx; break; }
        }
      }
      if (nextIdx < 0) {
        // Fallback nearest unused segment start within 0.05 mm for imperfect custom STLs
        let bestD = 0.05;
        for (let j = 0; j < segs.length; j++) {
          if (segs[j].used) continue;
          const d = Math.hypot(segs[j].ax - curX, segs[j].ay - curY);
          if (d < bestD) { bestD = d; nextIdx = j; }
        }
      }
      if (nextIdx < 0) break;
      segs[nextIdx].used = true;
      curX = segs[nextIdx].bx;
      curY = segs[nextIdx].by;
    }

    if (pts.length >= 3) {
      // Light vertex decimation of nearly collinear micro-steps (< 0.05 mm)
      const clean = [pts[0]];
      for (let k = 1; k < pts.length; k++) {
        const prev = clean[clean.length - 1];
        if (Math.hypot(pts[k][0] - prev[0], pts[k][1] - prev[1]) >= 0.05) clean.push(pts[k]);
      }
      if (clean.length >= 3) {
        const area = shoelaceArea(clean);
        if (Math.abs(area) >= 0.05) {
          loops.push({
            pts: clean,
            area,
            isHole: area < 0,
            perimeter: loopPerimeter(clean),
            bounds: loopBounds(clean),
          });
        }
      }
    }
  }

  return loops;
}

// ---------------------------------------------------------------------------------------------
// 2D Geometry Queries (Winding Number, Point-to-Segment Distance, Ray Hit, Segment Crossing)
// ---------------------------------------------------------------------------------------------

export function pointToSegDistSq(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const lenSq = vx * vx + vy * vy;
  if (lenSq <= 1e-12) return (px - ax) ** 2 + (py - ay) ** 2;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / lenSq));
  const cx = ax + t * vx, cy = ay + t * vy;
  return (px - cx) ** 2 + (py - cy) ** 2;
}

function pointToLoopDist(px, py, pts) {
  let minSq = Infinity;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const dSq = pointToSegDistSq(px, py, a[0], a[1], b[0], b[1]);
    if (dSq < minSq) minSq = dSq;
  }
  return Math.sqrt(minSq);
}

/** Signed winding number across oriented loops (`> 0` means strictly inside solid and outside holes). */
export function pointInLoops(px, py, loops) {
  let wn = 0;
  for (const loop of loops) {
    const pts = loop.pts;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[(i + 1) % n];
      if (y0 <= py) {
        if (y1 > py && (x1 - x0) * (py - y0) - (px - x0) * (y1 - y0) > 0) wn++;
      } else if (y1 <= py && (x1 - x0) * (py - y0) - (px - x0) * (y1 - y0) < 0) {
        wn--;
      }
    }
  }
  return wn > 0;
}

/** Minimum positive ray distance `t > tMin` where ray `(ox, oy) + t * (dx, dy)` hits any segment in `loops`. */
function rayLoopsHitDist(ox, oy, dx, dy, loops, tMin = 0.08) {
  let minT = Infinity;
  for (const loop of loops) {
    const pts = loop.pts;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % n];
      const sx = x2 - x1, sy = y2 - y1;
      const denom = dx * sy - dy * sx;
      if (Math.abs(denom) < 1e-12) continue;
      const rx = x1 - ox, ry = y1 - oy;
      const t = (rx * sy - ry * sx) / denom;
      const u = (rx * dy - ry * dx) / denom;
      if (t > tMin && u >= -1e-6 && u <= 1 + 1e-6 && t < minT) {
        minT = t;
      }
    }
  }
  return minT;
}

export function segToSegDist(ax, ay, bx, by, cx, cy, dx, dy) {
  const orient = (px, py, qx, qy, rx, ry) => (qx - px) * (ry - py) - (qy - py) * (rx - px);
  const o1 = orient(ax, ay, bx, by, cx, cy);
  const o2 = orient(ax, ay, bx, by, dx, dy);
  const o3 = orient(cx, cy, dx, dy, ax, ay);
  const o4 = orient(cx, cy, dx, dy, bx, by);
  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) {
    return 0;
  }
  return Math.sqrt(Math.min(
    pointToSegDistSq(ax, ay, cx, cy, dx, dy),
    pointToSegDistSq(bx, by, cx, cy, dx, dy),
    pointToSegDistSq(cx, cy, ax, ay, bx, by),
    pointToSegDistSq(dx, dy, ax, ay, bx, by),
  ));
}

function segToLoopsDist(ax, ay, bx, by, loops) {
  let best = Infinity;
  for (const loop of loops) {
    const pts = loop.pts;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      const d = segToSegDist(ax, ay, bx, by, p[0], p[1], q[0], q[1]);
      if (d < best) best = d;
      if (best === 0) return 0;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Contact-Slice Anchor Sampler & Connector Keep-Out Filter (spec 6.3)
// ---------------------------------------------------------------------------------------------

const shellCountMemo = new WeakMap();

function count3dShells(tri) {
  const cached = shellCountMemo.get(tri);
  if (cached !== undefined) return cached;
  const nTri = tri.length / 9;
  if (nTri <= 1) return nTri;
  const parent = new Int32Array(nTri);
  for (let i = 0; i < nTri; i++) parent[i] = i;
  const find = (x) => {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  };
  const vMap = new Map();
  let comps = nTri;
  for (let t = 0; t < nTri; t++) {
    const o = t * 9;
    for (let k = 0; k < 9; k += 3) {
      // Pack 3 signed 17-bit grid coords (±327 mm at 0.005 mm) into one 51-bit safe integer (zero string allocation)
      const ix = (Math.round(tri[o + k] * 200) + 65536) & 0x1ffff;
      const iy = (Math.round(tri[o + k + 1] * 200) + 65536) & 0x1ffff;
      const iz = (Math.round(tri[o + k + 2] * 200) + 65536) & 0x1ffff;
      const key = ix + iy * 131072 + iz * 17179869184;
      const prev = vMap.get(key);
      if (prev === undefined) vMap.set(key, t);
      else {
        const ra = find(prev), rb = find(t);
        if (ra !== rb) { parent[rb] = ra; comps--; }
      }
    }
  }
  shellCountMemo.set(tri, comps);
  return comps;
}

const partAnchorsMemo = new WeakMap();

/**
 * Sample connector-safe interior gate anchors on a seated part's `z = 0.30 mm` contact slice.
 * Multi-body STLs (`shellCount > 1`) return `anchors: []` so every body stays safely in the loose zone.
 * Returns `{ outerLoops, holeLoops, upperHoleLoops, outerPerimeterMm, anchors, insetUsedMm, shellCount }`.
 * Each anchor is `{ ax, ay, wx, wy, nx, ny, insetMm }`:
 *   - `(wx, wy)` is the exposed outer contour wall point,
 *   - `(nx, ny)` is the unit outward normal at `(wx, wy)`,
 *   - `(ax, ay) = (wx - insetMm * nx, wy - insetMm * ny)` sits inside solid material.
 */
export function samplePartAnchors(tri, { partId = '', spec = SPRUE_SPEC, knownShellCount = null, precomputed = null } = {}) {
  // Build-time anchors from `kip-partspec-manifest.json` (`print.anchors` + `print.slice_z03`,
  // spec 6.3) skip both z-slices and the shell count when they survive the same keep-out
  // filters the sampler applies. Anything malformed or fully filtered falls back to sampling.
  if (precomputed) {
    const fromManifest = samplePrecomputedAnchors(precomputed, { partId, spec });
    if (fromManifest && fromManifest.anchors.length > 0) return fromManifest;
  }
  const memoKey = `${partId}|${spec.sliceZMm}|${spec.anchorInsetMm}|${spec.anchorFallbackInsetMm}|${spec.ballSocketKeepoutRadiusMm}`;
  let perTri = partAnchorsMemo.get(tri);
  if (perTri && perTri.has(memoKey)) return perTri.get(memoKey);

  const shellCount = knownShellCount ?? count3dShells(tri);
  const loops = sliceMeshAtZ(tri, spec.sliceZMm);
  const outerLoops = loops.filter(l => !l.isHole);
  const holeLoops = loops.filter(l => l.isHole);
  // Also inspect z = 0.90 mm internal holes to catch chamfered socket throats and horizontal bores
  const upperHoleLoops = sliceMeshAtZ(tri, 0.90).filter(l => l.isHole);
  const allHoles = [...holeLoops, ...upperHoleLoops];

  const outerPerimeterMm = outerLoops.reduce((s, l) => s + l.perimeter, 0);
  if (!outerLoops.length || shellCount > 1) {
    return { outerLoops, holeLoops, upperHoleLoops, outerPerimeterMm, anchors: [], insetUsedMm: 0, shellCount };
  }

  // Ball-socket keep-out centres: circular internal cavities at z = 0.30 mm on articulated socket parts
  const isBallSocketPart = /^(hand_|upper_arm|forearm|thigh|shin|snap_leg|boot)/.test(partId);
  const ballSocketCentres = isBallSocketPart
    ? holeLoops.filter(h => h.bounds.radius >= 3.0 && h.bounds.radius <= 6.2).map(h => [h.bounds.cx, h.bounds.cy])
    : [];

  const trySampleWithInset = (insetMm) => {
    const candidates = [];
    const sampleStepMm = 2.2;

    for (const outer of outerLoops) {
      const pts = outer.pts;
      const n = pts.length;
      if (outer.perimeter < 6.0) continue;

      let nextSampleArc = sampleStepMm * 0.5;
      let accArc = 0;

      for (let i = 0; i < n; i++) {
        const [x0, y0] = pts[i];
        const [x1, y1] = pts[(i + 1) % n];
        const dx = x1 - x0, dy = y1 - y0;
        const segLen = Math.hypot(dx, dy);
        if (segLen < 1e-5) continue;

        // Outward unit normal of CCW segment (x0,y0)->(x1,y1) is (+dy/L, -dx/L)
        const nx = dy / segLen;
        const ny = -dx / segLen;

        while (nextSampleArc <= accArc + segLen) {
          const t = (nextSampleArc - accArc) / segLen;
          nextSampleArc += sampleStepMm;

          const wx = x0 + t * dx;
          const wy = y0 + t * dy;

          // 1. Reject concave pockets / notches: outward ray from wall must travel >= minOutwardRayClearMm before hitting same part
          if (rayLoopsHitDist(wx, wy, nx, ny, outerLoops, 0.08) < spec.minOutwardRayClearMm) continue;

          // 2. Reject spans inside r <= 5.5 mm of a ball-socket centre (spec 6.3)
          let nearBallSocket = false;
          for (const [scx, scy] of ballSocketCentres) {
            if (Math.hypot(wx - scx, wy - scy) <= spec.ballSocketKeepoutRadiusMm) {
              nearBallSocket = true;
              break;
            }
          }
          if (nearBallSocket) continue;

          // 3. Interior anchor at `insetMm` inward must sit strictly inside solid and leave >= 0.35 mm wall to every hole/socket
          const ax = wx - insetMm * nx;
          const ay = wy - insetMm * ny;
          const midX = wx - 0.5 * insetMm * nx;
          const midY = wy - 0.5 * insetMm * ny;
          if (!pointInLoops(ax, ay, loops) || !pointInLoops(midX, midY, loops)) continue;

          let minOuterClear = Infinity;
          for (const oLoop of outerLoops) {
            const d = pointToLoopDist(ax, ay, oLoop.pts);
            if (d < minOuterClear) minOuterClear = d;
          }
          if (minOuterClear < insetMm * 0.55) continue;

          let minHoleClear = Infinity;
          for (const hole of allHoles) {
            const d = pointToLoopDist(ax, ay, hole.pts);
            if (d < minHoleClear) minHoleClear = d;
          }
          // Anchor stops inside the outer wall with >= 0.35 mm of intact solid wall before any internal socket/cage/bore
          if (minHoleClear < 0.35) continue;

          candidates.push({ ax, ay, wx, wy, nx, ny, insetMm });
        }
        accArc += segLen;
      }
    }

    // Deduplicate nearby anchors (< 2.5 mm apart) so Prim's MST evaluates ~12-32 crisp well-spaced anchors per part
    const filtered = [];
    for (const c of candidates) {
      if (!filtered.some(f => Math.hypot(c.wx - f.wx, c.wy - f.wy) < 2.5)) {
        filtered.push(c);
      }
    }
    return filtered;
  };

  let anchors = trySampleWithInset(spec.anchorInsetMm);
  let insetUsedMm = spec.anchorInsetMm;
  if (anchors.length < 2) {
    const fb = trySampleWithInset(spec.anchorFallbackInsetMm);
    if (fb.length > anchors.length) {
      anchors = fb;
      insetUsedMm = spec.anchorFallbackInsetMm;
    }
  }

  const result = {
    outerLoops,
    holeLoops,
    upperHoleLoops,
    outerPerimeterMm,
    anchors,
    insetUsedMm,
    shellCount,
  };
  if (!perTri) {
    perTri = new Map();
    partAnchorsMemo.set(tri, perTri);
  }
  perTri.set(memoKey, result);
  return result;
}

function loopFromPolygon(rawPts, isHole) {
  if (!Array.isArray(rawPts) || rawPts.length < 3) return null;
  const pts = [];
  for (const p of rawPts) {
    if (!Array.isArray(p) || p.length < 2) return null;
    const x = Number(p[0]), y = Number(p[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const prev = pts[pts.length - 1];
    if (!prev || Math.hypot(x - prev[0], y - prev[1]) > 1e-9) pts.push([x, y]);
  }
  if (pts.length > 1) {
    const first = pts[0], last = pts[pts.length - 1];
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) <= 1e-9) pts.pop();
  }
  if (pts.length < 3) return null;
  let area = shoelaceArea(pts);
  if (Math.abs(area) < 1e-9) return null;
  // Outer loops run CCW (area > 0), holes CW (area < 0), matching sliceMeshAtZ.
  if ((isHole && area > 0) || (!isHole && area < 0)) {
    pts.reverse();
    area = -area;
  }
  return { pts, area, isHole, perimeter: loopPerimeter(pts), bounds: loopBounds(pts) };
}

const precomputedMemo = new WeakMap();

/**
 * Rebuild a sampler result from build-time manifest data (`print.slice_z03` polygons and
 * `print.anchors`, both in the seated local frame `samplePartAnchors` uses). Anchors are
 * re-checked against the stored contours with the sampler's keep-out rules (concave-pocket
 * ray, ball-socket radius, solid interior, hole clearance); the z = 0.90 mm throat check has
 * no stored equivalent and is covered by the build-time inset, which erodes from holes too.
 * Returns `null` for anything malformed so callers fall back to live sampling.
 */
export function samplePrecomputedAnchors(precomputed, { partId = '', spec = SPRUE_SPEC } = {}) {
  if (!precomputed || typeof precomputed !== 'object') return null;
  const memoKey = `${partId}|${spec.minOutwardRayClearMm}|${spec.ballSocketKeepoutRadiusMm}`;
  let perPre = precomputedMemo.get(precomputed);
  if (perPre && perPre.has(memoKey)) return perPre.get(memoKey);

  const finish = (result) => {
    if (!perPre) {
      perPre = new Map();
      precomputedMemo.set(precomputed, perPre);
    }
    perPre.set(memoKey, result);
    return result;
  };

  const slice = precomputed.slice_z03;
  if (!slice || !Array.isArray(slice.outer) || !Array.isArray(precomputed.anchors)) return finish(null);
  const outerLoops = slice.outer.map((poly) => loopFromPolygon(poly, false)).filter(Boolean);
  const holeLoops = (Array.isArray(slice.holes) ? slice.holes : []).map((poly) => loopFromPolygon(poly, true)).filter(Boolean);
  if (!outerLoops.length) return finish(null);
  const loops = [...outerLoops, ...holeLoops];
  const outerPerimeterMm = outerLoops.reduce((s, l) => s + l.perimeter, 0);

  const isBallSocketPart = /^(hand_|upper_arm|forearm|thigh|shin|snap_leg|boot)/.test(partId);
  const ballSocketCentres = isBallSocketPart
    ? holeLoops.filter(h => h.bounds.radius >= 3.0 && h.bounds.radius <= 6.2).map(h => [h.bounds.cx, h.bounds.cy])
    : [];

  const anchors = [];
  let insetUsedMm = 0;
  for (const raw of precomputed.anchors) {
    if (!raw || typeof raw !== 'object') continue;
    const ax = Number(raw.ax), ay = Number(raw.ay), wx = Number(raw.wx), wy = Number(raw.wy);
    let nx = Number(raw.nx), ny = Number(raw.ny);
    const insetMm = Number(raw.insetMm) > 0 ? Number(raw.insetMm) : spec.anchorInsetMm;
    if (![ax, ay, wx, wy, nx, ny].every(Number.isFinite)) continue;
    const nLen = Math.hypot(nx, ny);
    if (nLen < 1e-9) continue;
    nx /= nLen;
    ny /= nLen;
    if (rayLoopsHitDist(wx, wy, nx, ny, outerLoops, 0.08) < spec.minOutwardRayClearMm) continue;
    if (ballSocketCentres.some(([scx, scy]) => Math.hypot(wx - scx, wy - scy) <= spec.ballSocketKeepoutRadiusMm)) continue;
    const midX = wx - 0.5 * insetMm * nx;
    const midY = wy - 0.5 * insetMm * ny;
    if (!pointInLoops(ax, ay, loops) || !pointInLoops(midX, midY, loops)) continue;
    let minOuterClear = Infinity;
    for (const oLoop of outerLoops) minOuterClear = Math.min(minOuterClear, pointToLoopDist(ax, ay, oLoop.pts));
    if (minOuterClear < insetMm * 0.55) continue;
    let minHoleClear = Infinity;
    for (const hole of holeLoops) minHoleClear = Math.min(minHoleClear, pointToLoopDist(ax, ay, hole.pts));
    if (minHoleClear < 0.35) continue;
    if (anchors.some(f => Math.hypot(wx - f.wx, wy - f.wy) < 2.5)) continue;
    anchors.push({ ax, ay, wx, wy, nx, ny, insetMm });
    insetUsedMm = insetMm;
  }

  return finish({
    outerLoops,
    holeLoops,
    upperHoleLoops: [],
    outerPerimeterMm,
    anchors,
    insetUsedMm,
    shellCount: 1,
  });
}

// ---------------------------------------------------------------------------------------------
// Watertight Sprue Perimeter Frame & V-Nick Gate Mesh Builders (spec 6.2)
// ---------------------------------------------------------------------------------------------

function ensurePositiveVolume(tri) {
  let vol6 = 0;
  for (let i = 0; i < tri.length; i += 9) {
    const ax = tri[i], ay = tri[i + 1], az = tri[i + 2];
    const bx = tri[i + 3], by = tri[i + 4], bz = tri[i + 5];
    const cx = tri[i + 6], cy = tri[i + 7], cz = tri[i + 8];
    vol6 += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  if (vol6 >= 0) return tri;
  const out = new Float32Array(tri.length);
  for (let i = 0; i < tri.length; i += 9) {
    out[i] = tri[i]; out[i + 1] = tri[i + 1]; out[i + 2] = tri[i + 2];
    out[i + 3] = tri[i + 6]; out[i + 4] = tri[i + 7]; out[i + 5] = tri[i + 8];
    out[i + 6] = tri[i + 3]; out[i + 7] = tri[i + 4]; out[i + 8] = tri[i + 5];
  }
  return out;
}

function roundedRectLoop(x0, y0, w, h, r, arcSteps = 8) {
  const rad = Math.max(0.05, Math.min(r, w * 0.45, h * 0.45));
  const corners = [
    { cx: x0 + w - rad, cy: y0 + rad,     a0: -Math.PI * 0.5, a1: 0 },
    { cx: x0 + w - rad, cy: y0 + h - rad, a0: 0,              a1: Math.PI * 0.5 },
    { cx: x0 + rad,     cy: y0 + h - rad, a0: Math.PI * 0.5,  a1: Math.PI },
    { cx: x0 + rad,     cy: y0 + rad,     a0: Math.PI,        a1: Math.PI * 1.5 },
  ];
  const pts = [];
  for (const c of corners) {
    for (let s = 0; s <= arcSteps; s++) {
      const a = c.a0 + ((c.a1 - c.a0) * s) / arcSteps;
      pts.push([c.cx + rad * Math.cos(a), c.cy + rad * Math.sin(a)]);
    }
  }
  return pts;
}

function pushQuad(out, a, b, c, d) {
  out.push(
    a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2],
    a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2],
  );
}

/**
 * Build a 100% watertight annular rounded-rectangle perimeter frame (`2.40 x 1.00 mm`, outer R 2.0, inner R 1.0)
 * resting flat on `z = 0..frameHeightMm`.
 */
export function buildFrameMesh(x0, y0, outerW, outerH, spec = SPRUE_SPEC) {
  const fw = spec.frameWidthMm;
  const fh = spec.frameHeightMm;
  const outer = roundedRectLoop(x0, y0, outerW, outerH, spec.outerRadiusMm, 8);
  const inner = roundedRectLoop(x0 + fw, y0 + fw, outerW - 2 * fw, outerH - 2 * fw, spec.innerRadiusMm, 8);
  const n = outer.length;
  const tris = [];

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const [ox0, oy0] = outer[i], [ox1, oy1] = outer[j];
    const [ix0, iy0] = inner[i], [ix1, iy1] = inner[j];

    // Top ring (z = fh, normal +Z)
    pushQuad(tris, [ox0, oy0, fh], [ox1, oy1, fh], [ix1, iy1, fh], [ix0, iy0, fh]);
    // Bottom ring (z = 0, normal -Z)
    pushQuad(tris, [ix0, iy0, 0], [ix1, iy1, 0], [ox1, oy1, 0], [ox0, oy0, 0]);
    // Outer vertical wall (normal outward)
    pushQuad(tris, [ox0, oy0, 0], [ox1, oy1, 0], [ox1, oy1, fh], [ox0, oy0, fh]);
    // Inner vertical wall (normal inward toward hole)
    pushQuad(tris, [ix1, iy1, 0], [ix0, iy0, 0], [ix0, iy0, fh], [ix1, iy1, fh]);
  }

  return ensurePositiveVolume(Float32Array.from(tris));
}

/**
 * Build a 100% watertight V-nick sprue gate bar from `(x0, y0)` to `(x1, y1)`:
 * - Cross-section `1.80 x 0.80 mm` (`z = 0..0.80`),
 * - `0.40 mm` (2-layer) breakaway V-nick(s) with `0.80 mm` top groove opening (`>= 0.60 mm`),
 * - Each V-nick sits `0.80 mm` outside the connected part's outer wall (`uFromStart` / `uFromEnd`).
 */
export function buildVNickGateMesh(x0, y0, x1, y1, {
  wallAtStartMm = null, // distance from (x0,y0) where part A's outer wall sits (null if start is on the frame)
  wallAtEndMm = null,   // distance from (x1,y1) backward where part B's outer wall sits
  spec = SPRUE_SPEC,
} = {}) {
  const dx = x1 - x0, dy = y1 - y0;
  const L = Math.hypot(dx, dy);
  if (L < 0.4) return new Float32Array(0);

  const hw = spec.gateWidthMm * 0.5;
  const hg = spec.gateHeightMm;
  const hn = spec.neckHeightMm;
  const halfOpen = Math.max(spec.grooveTopMm * 0.5, hg - hn);

  // Compute sorted V-nick centres along u in [0, L]
  const rawNicks = [];
  if (wallAtStartMm !== null && Number.isFinite(wallAtStartMm)) {
    rawNicks.push(wallAtStartMm + spec.nickOffsetFromPartMm);
  }
  if (wallAtEndMm !== null && Number.isFinite(wallAtEndMm)) {
    rawNicks.push(L - (wallAtEndMm + spec.nickOffsetFromPartMm));
  }
  if (!rawNicks.length) rawNicks.push(L * 0.5);

  const minU = halfOpen + 0.15;
  const maxU = L - halfOpen - 0.15;
  const nicks = [];
  if (maxU <= minU) {
    if (L > 2 * halfOpen + 0.1) nicks.push(L * 0.5);
  } else {
    rawNicks.sort((a, b) => a - b);
    for (const u of rawNicks) {
      const clamped = Math.max(minU, Math.min(maxU, u));
      if (!nicks.length) {
        nicks.push(clamped);
      } else if (clamped - nicks[nicks.length - 1] >= 2 * halfOpen + 0.40) {
        nicks.push(clamped);
      } else {
        // Merge two close nicks on a short inter-part bar into one clean central V-nick
        nicks[nicks.length - 1] = 0.5 * (nicks[nicks.length - 1] + clamped);
      }
    }
  }

  // Build piecewise-linear top profile (u, z) from u = 0 to u = L
  const topPts = [[0, hg]];
  for (const un of nicks) {
    const uL = un - halfOpen;
    const uR = un + halfOpen;
    if (uL > topPts[topPts.length - 1][0] + 1e-4) topPts.push([uL, hg]);
    topPts.push([un, hn], [uR, hg]);
  }
  if (L > topPts[topPts.length - 1][0] + 1e-4) topPts.push([L, hg]);

  const cosA = dx / L, sinA = dy / L;
  const toWorld = (u, v, z) => [
    x0 + u * cosA - v * sinA,
    y0 + u * sinA + v * cosA,
    z,
  ];

  const tris = [];
  // Bottom single quad? Wait: to keep side-wall vertices 100% shared (zero T-junctions -> strict manifold!),
  // subdivide the bottom face at the exact same `u` stations as `topPts`!
  for (let i = 0; i < topPts.length - 1; i++) {
    const [u0, z0] = topPts[i];
    const [u1, z1] = topPts[i + 1];

    const tL0 = toWorld(u0,  hw, z0), tL1 = toWorld(u1,  hw, z1);
    const tR0 = toWorld(u0, -hw, z0), tR1 = toWorld(u1, -hw, z1);
    const bL0 = toWorld(u0,  hw, 0),  bL1 = toWorld(u1,  hw, 0);
    const bR0 = toWorld(u0, -hw, 0),  bR1 = toWorld(u1, -hw, 0);

    // Top strip (normal +Z / tilted V flank)
    pushQuad(tris, tR0, tR1, tL1, tL0);
    // Bottom strip (normal -Z)
    pushQuad(tris, bL0, bL1, bR1, bR0);
    // +v side cheek
    pushQuad(tris, bL1, bL0, tL0, tL1);
    // -v side cheek
    pushQuad(tris, bR0, bR1, tR1, tR0);
  }

  // Start cap at u = 0 (normal -u)
  const zStart = topPts[0][1];
  pushQuad(
    tris,
    toWorld(0,  hw, 0),
    toWorld(0, -hw, 0),
    toWorld(0, -hw, zStart),
    toWorld(0,  hw, zStart),
  );
  // End cap at u = L (normal +u)
  const zEnd = topPts[topPts.length - 1][1];
  pushQuad(
    tris,
    toWorld(L, -hw, 0),
    toWorld(L,  hw, 0),
    toWorld(L,  hw, zEnd),
    toWorld(L, -hw, zEnd),
  );

  return ensurePositiveVolume(Float32Array.from(tris));
}

// ---------------------------------------------------------------------------------------------
// Prim's MST + Opposed Secondary Gate Planner & Sprue Card Builder (spec 6.2 - 6.5)
// ---------------------------------------------------------------------------------------------

function buildFrameAnchors(fx, fy, outerW, outerH, spec = SPRUE_SPEC) {
  const fw = spec.frameWidthMm;
  const inset = Math.min(1.20, fw * 0.5);
  const step = 3.5;
  const out = [];

  // Bottom bar (inner wall at fy + fw, inward toward card is +Y)
  for (let x = fx + fw + 2.0; x <= fx + outerW - fw - 2.0 + 1e-6; x += step) {
    out.push({ ax: x, ay: fy + fw - inset, wx: x, wy: fy + fw, nx: 0, ny: 1, insetMm: inset });
  }
  // Top bar (inner wall at fy + outerH - fw, inward toward card is -Y)
  for (let x = fx + fw + 2.0; x <= fx + outerW - fw - 2.0 + 1e-6; x += step) {
    out.push({ ax: x, ay: fy + outerH - fw + inset, wx: x, wy: fy + outerH - fw, nx: 0, ny: -1, insetMm: inset });
  }
  // Left bar (inner wall at fx + fw, inward toward card is +X)
  for (let y = fy + fw + 2.0; y <= fy + outerH - fw - 2.0 + 1e-6; y += step) {
    out.push({ ax: fx + fw - inset, ay: y, wx: fx + fw, wy: y, nx: 1, ny: 0, insetMm: inset });
  }
  // Right bar (inner wall at fx + outerW - fw, inward toward card is -X)
  for (let y = fy + fw + 2.0; y <= fy + outerH - fw - 2.0 + 1e-6; y += step) {
    out.push({ ax: fx + outerW - fw + inset, ay: y, wx: fx + outerW - fw, wy: y, nx: -1, ny: 0, insetMm: inset });
  }
  return out;
}

function transformSampledPart(base, localW, localH, turnIdx, px, py) {
  const mapPt = (lx, ly) => {
    if (turnIdx === 1) return [localH - ly + px, lx + py];
    if (turnIdx === 2) return [localW - lx + px, localH - ly + py];
    if (turnIdx === 3) return [ly + px, localW - lx + py];
    return [lx + px, ly + py];
  };
  const mapNorm = (nx, ny) => {
    if (turnIdx === 1) return [-ny, nx];
    if (turnIdx === 2) return [-nx, -ny];
    if (turnIdx === 3) return [ny, -nx];
    return [nx, ny];
  };
  const mapLoop = (loop) => {
    const pts = loop.pts.map(([x, y]) => mapPt(x, y));
    return {
      pts,
      area: loop.area,
      isHole: loop.isHole,
      perimeter: loop.perimeter,
      bounds: loopBounds(pts),
    };
  };
  return {
    outerLoops: base.outerLoops.map(mapLoop),
    holeLoops: base.holeLoops.map(mapLoop),
    upperHoleLoops: base.upperHoleLoops.map(mapLoop),
    outerPerimeterMm: base.outerPerimeterMm,
    insetUsedMm: base.insetUsedMm,
    shellCount: base.shellCount,
    anchors: base.anchors.map((a) => {
      const [ax, ay] = mapPt(a.ax, a.ay);
      const [wx, wy] = mapPt(a.wx, a.wy);
      const [nx, ny] = mapNorm(a.nx, a.ny);
      return { ax, ay, wx, wy, nx, ny, insetMm: a.insetMm };
    }),
  };
}

/**
 * Build a complete flat-pack sprue kit card around `placedParts` (already positioned in world XY so all card parts
 * have `>= frameWidth + frameGap` clearance inside `[frameX, frameX + frameW] x [frameY, frameY + frameH]`).
 */
export function buildSprueCard(placedParts, {
  frameBox = null,
  boundMm = 170,
  spec = SPRUE_SPEC,
} = {}) {
  if (!placedParts || !placedParts.length) return null;

  const margin = sprueMarginMm(spec);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of placedParts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x + p.w > maxX) maxX = p.x + p.w;
    if (p.y + p.h > maxY) maxY = p.y + p.h;
  }

  const fx = frameBox ? frameBox.x : (minX - margin);
  const fy = frameBox ? frameBox.y : (minY - margin);
  const fw = frameBox ? frameBox.w : (maxX - minX + 2 * margin);
  const fh = frameBox ? frameBox.h : (maxY - minY + 2 * margin);

  // Sample world-space slice & anchors for every card part (card parts were already screened as single-shell)
  const partRecords = placedParts.map((p, idx) => {
    const sampled = (p.localTri && Number.isFinite(p.localW) && Number.isFinite(p.localH))
      ? transformSampledPart(
          samplePartAnchors(p.localTri, { partId: p.partId || p.id || '', spec, knownShellCount: 1, precomputed: p.precomputedAnchors || null }),
          p.localW,
          p.localH,
          p.turnIdx || 0,
          p.x,
          p.y,
        )
      : samplePartAnchors(p.tri, { partId: p.partId || p.id || '', spec, knownShellCount: 1 });
    const targetGates = sampled.anchors.length <= 1
      ? Math.max(1, sampled.anchors.length)
      : (sampled.outerPerimeterMm > spec.extraGatePerimeterMm && sampled.anchors.length >= 3 ? 3 : 2);
    return {
      nodeId: idx + 1, // 0 is the outer perimeter frame
      part: p,
      ...sampled,
      targetGates,
      usedAnchorIndices: new Set(),
      attachedNormals: [],
    };
  });

  // Every card part must have at least 1 valid anchor
  if (partRecords.some(r => r.anchors.length === 0)) {
    return null;
  }

  const frameAnchors = buildFrameAnchors(fx, fy, fw, fh, spec);
  const chosenGates = [];

  const partAabbGap = (pA, pB) => {
    const gx = Math.max(0, pA.x - (pB.x + pB.w), pB.x - (pA.x + pA.w));
    const gy = Math.max(0, pA.y - (pB.y + pB.h), pB.y - (pA.y + pA.h));
    return Math.hypot(gx, gy);
  };

  // Legality & cost check for a candidate gate connecting anchor `a` on `nodeA` to anchor `b` on `nodeB`.
  // `score = clearSpan + alignPenalty` with `alignPenalty >= 0`, so `clearSpan >= maxScore` is an exact branch-and-bound prune.
  const evalGate = (nodeA, ancA, ancBIdxA, nodeB, ancB, ancBIdxB, maxScore = Infinity) => {
    const dx = ancB.wx - ancA.wx;
    const dy = ancB.wy - ancA.wy;
    const clearSpan = Math.hypot(dx, dy);
    if (clearSpan < 0.6 || clearSpan > 65.0 || clearSpan >= maxScore) return null;

    const ux = dx / clearSpan, uy = dy / clearSpan;
    // Gate must leave both walls outward (within ~72 degrees of each wall's outward normal)
    const cosA = ancA.nx * ux + ancA.ny * uy;
    const cosB = -(ancB.nx * ux + ancB.ny * uy);
    if (cosA < 0.25 || cosB < 0.25) return null;

    // Full bar runs from interior anchor A to interior anchor B
    const x0 = ancA.ax, y0 = ancA.ay;
    const x1 = ancB.ax, y1 = ancB.ay;

    // Must not cross or graze any third part's outer contour (clearance >= gateWidth/2 + 0.6 mm)
    const minThirdClear = spec.gateWidthMm * 0.5 + 0.60;
    for (const rec of partRecords) {
      if (rec.nodeId === nodeA || rec.nodeId === nodeB) {
        // Also ensure the external span [wxA..wxB] does not cut back across another lobe of its own part!
        const mx = 0.5 * (ancA.wx + ancB.wx), my = 0.5 * (ancA.wy + ancB.wy);
        if (pointInLoops(mx, my, [...rec.outerLoops, ...rec.holeLoops])) return null;
        continue;
      }
      // Fast AABB pre-reject
      const p = rec.part;
      const segMinX = Math.min(x0, x1) - minThirdClear, segMaxX = Math.max(x0, x1) + minThirdClear;
      const segMinY = Math.min(y0, y1) - minThirdClear, segMaxY = Math.max(y0, y1) + minThirdClear;
      if (segMaxX < p.x || segMinX > p.x + p.w || segMaxY < p.y || segMinY > p.y + p.h) continue;
      if (segToLoopsDist(ancA.wx, ancA.wy, ancB.wx, ancB.wy, rec.outerLoops) < minThirdClear) return null;
    }

    // Must not cross or overlap existing gates
    for (const g of chosenGates) {
      const d = segToSegDist(ancA.wx, ancA.wy, ancB.wx, ancB.wy, g.wx0, g.wy0, g.wx1, g.wy1);
      if (d < spec.gateWidthMm + 0.65) return null;
    }

    const alignPenalty = (1 - cosA) * 2.2 + (1 - cosB) * 2.2;
    const score = clearSpan + alignPenalty;
    return {
      nodeA, ancAIdx: ancBIdxA,
      nodeB, ancBIdx: ancBIdxB,
      ax0: x0, ay0: y0, wx0: ancA.wx, wy0: ancA.wy, nx0: ancA.nx, ny0: ancA.ny,
      ax1: x1, ay1: y1, wx1: ancB.wx, wy1: ancB.wy, nx1: ancB.nx, ny1: ancB.ny,
      wallAtStartMm: nodeA === 0 ? null : ancA.insetMm,
      wallAtEndMm: nodeB === 0 ? null : ancB.insetMm,
      clearSpanMm: clearSpan,
      lengthMm: Math.hypot(x1 - x0, y1 - y0),
      score,
    };
  };

  // 1. Prim's MST starting from Node 0 (outer perimeter frame)
  const inTree = new Set([0]);
  const remaining = new Set(partRecords.map(r => r.nodeId));

  const anchorsForNode = (nid) => (nid === 0 ? frameAnchors : partRecords[nid - 1].anchors);

  while (remaining.size > 0) {
    let best = null;
    for (const u of inTree) {
      const aList = anchorsForNode(u);
      const uRec = u === 0 ? null : partRecords[u - 1];
      for (const v of remaining) {
        const bList = anchorsForNode(v);
        const vRec = partRecords[v - 1];
        const limit = best ? best.score : 65.0001;
        if (uRec && vRec && partAabbGap(uRec.part, vRec.part) >= limit) continue;
        for (let ia = 0; ia < aList.length; ia++) {
          if (uRec && uRec.usedAnchorIndices.has(ia)) continue;
          const ancA = aList[ia];
          for (let ib = 0; ib < bList.length; ib++) {
            if (vRec.usedAnchorIndices.has(ib)) continue;
            const cand = evalGate(u, ancA, ia, v, bList[ib], ib, best ? best.score : Infinity);
            if (cand && (!best || cand.score < best.score - 1e-6)) {
              best = cand;
            }
          }
        }
      }
    }

    // Relaxed fallback if all strict-angle gates for a part were blocked (e.g. tight interior pocket)
    if (!best) {
      for (const u of inTree) {
        const aList = anchorsForNode(u);
        for (const v of remaining) {
          const bList = anchorsForNode(v);
          for (let ia = 0; ia < aList.length; ia++) {
            for (let ib = 0; ib < bList.length; ib++) {
              const ancA = aList[ia], ancB = bList[ib];
              const d = Math.hypot(ancB.ax - ancA.ax, ancB.ay - ancA.ay);
              if (!best || d < best.score) {
                best = {
                  nodeA: u, ancAIdx: ia, nodeB: v, ancBIdx: ib,
                  ax0: ancA.ax, ay0: ancA.ay, wx0: ancA.wx, wy0: ancA.wy, nx0: ancA.nx, ny0: ancA.ny,
                  ax1: ancB.ax, ay1: ancB.ay, wx1: ancB.wx, wy1: ancB.wy, nx1: ancB.nx, ny1: ancB.ny,
                  wallAtStartMm: u === 0 ? null : ancA.insetMm,
                  wallAtEndMm: ancB.insetMm,
                  clearSpanMm: Math.hypot(ancB.wx - ancA.wx, ancB.wy - ancA.wy),
                  lengthMm: d,
                  score: d,
                };
              }
            }
          }
        }
      }
    }
    if (!best) break;

    chosenGates.push(best);
    inTree.add(best.nodeB);
    remaining.delete(best.nodeB);
    if (best.nodeA > 0) {
      partRecords[best.nodeA - 1].usedAnchorIndices.add(best.ancAIdx);
      partRecords[best.nodeA - 1].attachedNormals.push([best.nx0, best.ny0]);
    }
    partRecords[best.nodeB - 1].usedAnchorIndices.add(best.ancBIdx);
    partRecords[best.nodeB - 1].attachedNormals.push([best.nx1, best.ny1]);
  }

  // 2. Opposed secondary (& >75 mm tertiary) gates so parts cannot twist on a single hinge tab (spec 6.2)
  for (const rec of partRecords) {
    let safety = 0;
    while (rec.attachedNormals.length < rec.targetGates && safety++ < 4) {
      let bestSec = null;
      for (let ia = 0; ia < rec.anchors.length; ia++) {
        if (rec.usedAnchorIndices.has(ia)) continue;
        const ancA = rec.anchors[ia];
        // Measure worst dot product against already-attached gate normals on this part:
        // dot == -1 means perfectly opposed (180 degrees apart); reject anchors pointing the same way (dot > 0.35)
        let maxDot = -1;
        for (const [enx, eny] of rec.attachedNormals) {
          const d = ancA.nx * enx + ancA.ny * eny;
          if (d > maxDot) maxDot = d;
        }
        if (maxDot > 0.35) continue;

        // Connect to frame (node 0) or any other card part
        const dotPen = (maxDot + 1) * 6.0;
        for (let otherNode = 0; otherNode <= partRecords.length; otherNode++) {
          if (otherNode === rec.nodeId) continue;
          const bList = anchorsForNode(otherNode);
          const otherRec = otherNode === 0 ? null : partRecords[otherNode - 1];
          const maxClear = bestSec ? bestSec.secScore - dotPen : 65.0001;
          if (maxClear <= 0.6) break;
          if (otherRec && partAabbGap(rec.part, otherRec.part) >= maxClear) continue;
          for (let ib = 0; ib < bList.length; ib++) {
            if (otherRec && otherRec.usedAnchorIndices.has(ib)) continue;
            const cand = evalGate(rec.nodeId, ancA, ia, otherNode, bList[ib], ib, bestSec ? bestSec.secScore - dotPen : Infinity);
            if (!cand) continue;
            // Reward strong angular opposition (`maxDot` near -1) while keeping gates short
            const secScore = cand.score + dotPen;
            if (!bestSec || secScore < bestSec.secScore - 1e-6) {
              bestSec = { ...cand, secScore };
            }
          }
        }
      }
      if (!bestSec) break;
      chosenGates.push(bestSec);
      rec.usedAnchorIndices.add(bestSec.ancAIdx);
      rec.attachedNormals.push([bestSec.nx0, bestSec.ny0]);
      if (bestSec.nodeB > 0) {
        partRecords[bestSec.nodeB - 1].usedAnchorIndices.add(bestSec.ancBIdx);
        partRecords[bestSec.nodeB - 1].attachedNormals.push([bestSec.nx1, bestSec.ny1]);
      }
    }
  }

  // 3. Emit overlapping watertight frame + V-nick gate shells
  const frameTri = buildFrameMesh(fx, fy, fw, fh, spec);
  const gateMeshes = chosenGates.map((g) => buildVNickGateMesh(g.ax0, g.ay0, g.ax1, g.ay1, {
    wallAtStartMm: g.wallAtStartMm,
    wallAtEndMm: g.wallAtEndMm,
    spec,
  }));

  let totalFloats = frameTri.length;
  for (const gm of gateMeshes) totalFloats += gm.length;
  const sprueTri = new Float32Array(totalFloats);
  sprueTri.set(frameTri, 0);
  let off = frameTri.length;
  for (const gm of gateMeshes) {
    sprueTri.set(gm, off);
    off += gm.length;
  }

  const totalGateLenMm = chosenGates.reduce((s, g) => s + g.lengthMm, 0);
  return {
    spec,
    boundMm,
    frameBox: { x: fx, y: fy, w: fw, h: fh },
    tri: sprueTri,
    frameTri,
    gateMeshes,
    gates: chosenGates.map((g) => ({
      fromNode: g.nodeA,
      toNode: g.nodeB,
      ax0: +g.ax0.toFixed(3),
      ay0: +g.ay0.toFixed(3),
      wx0: +g.wx0.toFixed(3),
      wy0: +g.wy0.toFixed(3),
      ax1: +g.ax1.toFixed(3),
      ay1: +g.ay1.toFixed(3),
      wx1: +g.wx1.toFixed(3),
      wy1: +g.wy1.toFixed(3),
      lengthMm: +g.lengthMm.toFixed(3),
      clearSpanMm: +g.clearSpanMm.toFixed(3),
    })),
    cardInstances: placedParts.map(p => p.instance),
    partGateCounts: Object.fromEntries(partRecords.map(r => [r.part.instance, r.attachedNormals.length])),
    totalGateLengthMm: +totalGateLenMm.toFixed(2),
  };
}

/**
 * Self-verification gate for a generated kit card (spec 6.5):
 *   1. Frame lies inside `[0, boundMm]^2` and every card part keeps `>= frameGapMm` (`1.20 mm`) air gap to the inner frame wall.
 *   2. Zero `needs-supports` or ineligible parts sit inside the card.
 *   3. Gate graph forms a single connected component (`1` component spanning frame `0` + all `K` card parts).
 *   4. Every gate is non-degenerate and every card part has `>= 1` gate (`>= 2` when >= 2 opposed anchors exist).
 */
export function checkSprueCard(sprue, cardPlacedParts, spec = SPRUE_SPEC) {
  const problems = [];
  if (!sprue) {
    problems.push('missing sprue card');
    return problems;
  }
  const tol = 1e-4;
  const { x: fx, y: fy, w: fw, h: fh } = sprue.frameBox;
  if (fx < -tol || fy < -tol || fx + fw > sprue.boundMm + tol || fy + fh > sprue.boundMm + tol) {
    problems.push(`sprue frame (${fx.toFixed(2)}, ${fy.toFixed(2)}, ${fw.toFixed(2)}x${fh.toFixed(2)}) exceeds ${sprue.boundMm} mm plate bound`);
  }

  const innerX0 = fx + spec.frameWidthMm;
  const innerY0 = fy + spec.frameWidthMm;
  const innerX1 = fx + fw - spec.frameWidthMm;
  const innerY1 = fy + fh - spec.frameWidthMm;

  for (const p of cardPlacedParts) {
    if (p.tier === 'needs-supports') {
      problems.push(`${p.instance}: needs-supports part inside sprue frame`);
    }
    const elig = isSprueEligiblePart(p, spec);
    if (!elig.ok) {
      problems.push(`${p.instance}: ineligible part (${elig.reason}) inside sprue frame`);
    }
    const gLeft = p.x - innerX0;
    const gRight = innerX1 - (p.x + p.w);
    const gBot = p.y - innerY0;
    const gTop = innerY1 - (p.y + p.h);
    const minFrameGap = Math.min(gLeft, gRight, gBot, gTop);
    if (minFrameGap < spec.frameGapMm - 1e-3) {
      problems.push(`${p.instance}: frame-to-part air gap ${minFrameGap.toFixed(2)} mm < ${spec.frameGapMm} mm`);
    }
  }

  // Graph connectivity across nodes 0..K
  const K = cardPlacedParts.length;
  const parent = Array.from({ length: K + 1 }, (_, i) => i);
  const find = (a) => {
    while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
    return a;
  };
  for (const g of sprue.gates) {
    if (g.lengthMm <= 0.4) problems.push(`degenerate gate (${g.fromNode} -> ${g.toNode})`);
    const ra = find(g.fromNode), rb = find(g.toNode);
    if (ra !== rb) parent[rb] = ra;
  }
  const roots = new Set(Array.from({ length: K + 1 }, (_, i) => find(i)));
  if (roots.size !== 1) {
    problems.push(`gate graph has ${roots.size} disconnected components (expected 1)`);
  }

  return problems;
}

// ---------------------------------------------------------------------------------------------
// Printable Physical Calibration Coupons (Decision 7 & §12.7 Gate 4)
// ---------------------------------------------------------------------------------------------

function buildClosedBoxMesh(x0, y0, w, d, h) {
  const x1 = x0 + w, y1 = y0 + d;
  const tris = [];
  // Bottom (z = 0, -Z) & Top (z = h, +Z)
  pushQuad(tris, [x0, y0, 0], [x0, y1, 0], [x1, y1, 0], [x1, y0, 0]);
  pushQuad(tris, [x0, y0, h], [x1, y0, h], [x1, y1, h], [x0, y1, h]);
  // 4 vertical walls
  pushQuad(tris, [x0, y0, 0], [x1, y0, 0], [x1, y0, h], [x0, y0, h]);
  pushQuad(tris, [x1, y0, 0], [x1, y1, 0], [x1, y1, h], [x1, y0, h]);
  pushQuad(tris, [x1, y1, 0], [x0, y1, 0], [x0, y1, h], [x1, y1, h]);
  pushQuad(tris, [x0, y1, 0], [x0, y0, 0], [x0, y0, h], [x0, y1, h]);
  return ensurePositiveVolume(Float32Array.from(tris));
}

/**
 * Revolve a closed meridian profile `rings` (`[[r0, z0], [r1, z1], ...]`, all `r_k > 0`) around `(cx, cy)`,
 * closing the bottom (`z0`) and top (`zLast`) axis caps cleanly with zero unmatched half-edges.
 */
function buildRevolvedSolidMesh(cx, cy, rings, segs = 48) {
  const tris = [];
  const [r0, z0] = rings[0];
  const [rLast, zLast] = rings[rings.length - 1];
  const pt = (r, z, s) => {
    const a = (2 * Math.PI * (s % segs)) / segs;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a), z];
  };

  // Bottom cap fan around (cx, cy, z0)
  for (let s = 0; s < segs; s++) {
    const p0 = pt(r0, z0, s);
    const p1 = pt(r0, z0, s + 1);
    tris.push(cx, cy, z0, p1[0], p1[1], p1[2], p0[0], p0[1], p0[2]);
  }
  // Lateral strips
  for (let k = 0; k < rings.length - 1; k++) {
    const [ra, za] = rings[k];
    const [rb, zb] = rings[k + 1];
    for (let s = 0; s < segs; s++) {
      pushQuad(tris, pt(ra, za, s), pt(ra, za, s + 1), pt(rb, zb, s + 1), pt(rb, zb, s));
    }
  }
  // Top cap fan around (cx, cy, zLast)
  for (let s = 0; s < segs; s++) {
    const p0 = pt(rLast, zLast, s);
    const p1 = pt(rLast, zLast, s + 1);
    tris.push(cx, cy, zLast, p0[0], p0[1], p0[2], p1[0], p1[1], p1[2]);
  }
  return ensurePositiveVolume(Float32Array.from(tris));
}

function buildSocketCupMesh(cx, cy, d = 9.0, sockClr = 0.15) {
  const rc = d * 0.5 + sockClr;
  const ro = d * 0.43;
  const rOut = rc + 2.6;
  const cupH = 9.4;
  const zCenter = cupH - 4.2;
  const aLip = Math.acos(Math.min(0.98, ro / rc));
  const rings = [
    [rOut, 0.0],
    [rOut, cupH],
    [rc + 0.25, cupH],
    [ro, cupH - 0.90],
  ];
  const arcSteps = 10;
  for (let i = 0; i <= arcSteps; i++) {
    const a = aLip - ((aLip + Math.PI * 0.42) * i) / arcSteps; // down to ~75 deg below equator, then flat floor
    rings.push([Math.max(0.45, rc * Math.cos(a)), zCenter + rc * Math.sin(a)]);
  }
  return buildRevolvedSolidMesh(cx, cy, rings, 48);
}

function buildFallbackConnectorMesh(cx, cy, d = 9.0, isTurret = false) {
  const r = d * 0.5;
  if (!isTurret) {
    const h = +(d * 0.92).toFixed(3);
    const rings = [];
    const steps = 10;
    for (let i = 0; i <= steps; i++) {
      const z = (h * i) / steps;
      const u = (z - h * 0.5) / (r * 1.06);
      const rad = r * Math.sqrt(Math.max(0.18, 1 - u * u));
      rings.push([rad, z]);
    }
    return buildRevolvedSolidMesh(cx, cy, rings, 48);
  }
  const h = +(d * 1.15).toFixed(3);
  const rBase = +(r * Math.sqrt(1 - 0.5 * 0.5)).toFixed(3);
  const rShaft = +(r * 0.84).toFixed(3);
  const rf = +(r + 1.15).toFixed(3);
  const zm = h * 0.5;
  const dzFlange = (rf - rShaft) / Math.tan((38 * Math.PI) / 180); // <= 38 deg overhang (< 45 deg)
  return buildRevolvedSolidMesh(cx, cy, [
    [rBase, 0.0],
    [r, d * 0.25],
    [rShaft, zm - dzFlange - 0.25],
    [rf, zm - 0.25],
    [rf, zm + 0.25],
    [rShaft, zm + dzFlange + 0.25],
    [r, h - d * 0.25],
    [rBase, h],
  ], 48);
}

function placeAndRotateSeatedMesh(srcTri, angleDeg, cx, cy) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < srcTri.length; i += 3) {
    const x = srcTri[i], y = srcTri[i + 1], z = srcTri[i + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
  }
  const ox = 0.5 * (minX + maxX);
  const oy = 0.5 * (minY + maxY);
  const rad = (angleDeg * Math.PI) / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  const out = new Float32Array(srcTri.length);
  for (let i = 0; i < srcTri.length; i += 3) {
    const dx = srcTri[i] - ox;
    const dy = srcTri[i + 1] - oy;
    out[i]     = cx + dx * c - dy * s;
    out[i + 1] = cy + dx * s + dy * c;
    out[i + 2] = srcTri[i + 2] - minZ;
  }
  return out;
}

function concatMeshes(shells) {
  let n = 0;
  for (const s of shells) n += s.length;
  const out = new Float32Array(n);
  let off = 0;
  for (const s of shells) {
    out.set(s, off);
    off += s.length;
  }
  return out;
}

/**
 * Decision 7 physical break-off coupon (`56 x 38 x 3.0 mm`, zero supports):
 * three test tabs gated at `0.30 mm`, `0.40 mm` (default), and `0.60 mm` V-nick neck heights in PLA/PETG.
 */
export function buildBreakoffCouponMesh(spec = SPRUE_SPEC) {
  const outerW = 56, outerH = 38;
  const necksMm = [0.30, 0.40, 0.60];
  const ys = [6.5, 15.5, 24.5];
  const tabX = 22.0, tabW = 12.0, tabD = 7.0, tabH = 3.0;
  const fw = spec.frameWidthMm;
  const shells = [buildFrameMesh(0, 0, outerW, outerH, spec)];

  for (let i = 0; i < necksMm.length; i++) {
    const y0 = ys[i];
    const yc = y0 + tabD * 0.5;
    const neckSpec = { ...spec, neckHeightMm: necksMm[i], grooveTopMm: Math.max(0.60, (spec.gateHeightMm - necksMm[i]) * 2) };
    shells.push(buildClosedBoxMesh(tabX, y0, tabW, tabD, tabH));
    shells.push(buildVNickGateMesh(fw - 1.2, yc, tabX + 1.6, yc, { wallAtEndMm: 1.6, spec: neckSpec }));
    shells.push(buildVNickGateMesh(tabX + tabW - 1.6, yc, outerW - fw + 1.2, yc, { wallAtStartMm: 1.6, spec: neckSpec }));
  }

  return {
    tri: concatMeshes(shells),
    shells,
    bounds: { w: outerW, h: outerH, z: tabH },
    necksMm,
  };
}

/**
 * §12.7 Gate 4 peg & turret fit coupon (`78 x 52 x 9.4 mm`, zero supports):
 * gates both a Ø9.0 mm ball-peg and a Ø8.0 mm snap-turret at three orientations (`0°`, `45°`, `90°`
 * relative to their compliant flex slots) alongside printed Ø9.0 mm & Ø8.0 mm mating snap-socket cups.
 */
export function buildPegTurretFitCouponMesh({
  pegTri = null,
  turretTri = null,
  spec = SPRUE_SPEC,
} = {}) {
  const frameW = 56, frameH = 52;
  const fw = spec.frameWidthMm;
  const anglesDeg = [0, 45, 90];
  const rowYs = [12.0, 26.0, 40.0];
  const pegX = 16.5, turX = 39.5;
  const shells = [buildFrameMesh(0, 0, frameW, frameH, spec)];

  for (let i = 0; i < anglesDeg.length; i++) {
    const cy = rowYs[i];
    const ang = anglesDeg[i];
    const pMesh = pegTri && pegTri.length
      ? placeAndRotateSeatedMesh(pegTri, ang, pegX, cy)
      : buildFallbackConnectorMesh(pegX, cy, 9.0, false);
    const tMesh = turretTri && turretTri.length
      ? placeAndRotateSeatedMesh(turretTri, ang, turX, cy)
      : buildFallbackConnectorMesh(turX, cy, 8.0, true);
    shells.push(pMesh, tMesh);

    // Opposed gates into left frame, inter-column runner, and right frame:
    // spark_peg_big (d=9.0) outer wall at z=0.8 is r=3.21 mm; snap_turret (d=8.0) outer wall at z=0.8 is r=3.82 mm
    shells.push(buildVNickGateMesh(fw - 1.2, cy, pegX - 1.8, cy, { wallAtEndMm: 1.45, spec }));
    shells.push(buildVNickGateMesh(pegX + 1.8, cy, turX - 2.4, cy, { wallAtStartMm: 1.45, wallAtEndMm: 1.45, spec }));
    shells.push(buildVNickGateMesh(turX + 2.4, cy, frameW - fw + 1.2, cy, { wallAtStartMm: 1.45, spec }));
  }

  // Mating Ø9.0 mm & Ø8.0 mm ToyVentor socket test cups in the adjacent loose strip
  shells.push(buildSocketCupMesh(69.5, 15.0, 9.0, 0.15));
  shells.push(buildSocketCupMesh(69.5, 37.0, 8.0, 0.15));

  return {
    tri: concatMeshes(shells),
    shells,
    bounds: { w: 78, h: frameH, z: 9.4 },
    anglesDeg,
    socketDiametersMm: [9.0, 8.0],
  };
}
