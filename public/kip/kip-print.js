// Kip print view core: inventory, STL I/O, orientation + support scoring, deterministic plate packer, exports.
//
// Everything in this file is pure (typed arrays in, typed arrays out; no DOM, no three.js), so vitest and
// scripts/kip-plate-check.mjs run the same code the browser runs. The three.js plate view lives in
// kip-print-view.js and only calls into this module.
//
// What the plate does and does not promise (docs/specs/kip-demo-implementation.md, Phase 2):
//  - Catalog parts (toyventor_*.stl from parts/partspec) are printed in their native orientation, never
//    rotated, and are expected to be support-free; the badge says "verified" only when the served file's
//    sha-256 matches the validation report for the part, otherwise "unverified".
//  - Base body parts (public/kip/stls, from kip.scad) are exported in rig pose, so they are dropped to the
//    bed and re-oriented by overhang score. Most still need supports (see `supportReport`), and they are
//    flagged as such. No support geometry is generated.
//  - Layout uses rigid transforms only: quarter turns about Z and a translation. Gaps and bounds are
//    checked by `checkPlacement`; a violation is a bug, never a warning.

// ---------------------------------------------------------------------------------------------
// Limits (mirrors parts/partspec/print_profiles/fdm_kitplate_0.4.json; tests assert they agree)
// ---------------------------------------------------------------------------------------------
export const LIMITS = {
  bedMm: 180,
  maxPlateMm: 170,
  brimMm: 5,
  gapMm: 5.0,
  maxOverhangDeg: 45,
  firstLayerExclusionMm: 0.7,
  steepAreaToleranceMm2: 10.0,
};

/** Plate bound on a square bed: min(170, bed - 2*brim); larger beds get bed - 2*brim and a note. */
export function plateBound(bedMm = LIMITS.bedMm, brimMm = LIMITS.brimMm) {
  const free = bedMm - 2 * brimMm;
  if (bedMm <= LIMITS.bedMm) return { mm: Math.min(LIMITS.maxPlateMm, free), note: '' };
  return { mm: free, note: 'Bed larger than 180 mm: not covered by the kit-plate profile.' };
}

// ---------------------------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------------------------
const P = (id, file, qty = 1, role = '') => ({ id, file: `/kip/partspec/${file}`, qty, source: 'partspec', role });
const B = (id, qty = 1, role = '') => ({ id, file: `/kip/stls/${id}.stl`, qty, source: 'kip.scad', role });

const HEAD_FILE = {
  kid: 'toyventor_char_head_kid_S.stl', chibi: 'toyventor_char_head_chibi_S.stl', tall: 'toyventor_char_head_tall_S.stl',
  jumbo: 'toyventor_char_head_jumbo_S.stl', robot: 'toyventor_robot_head_visor_S.stl', scout: 'toyventor_robot_head_scout_S.stl',
  fox: 'toyventor_char_head_fox_S.stl', bear: 'toyventor_char_head_bear_S.stl', cat: 'toyventor_char_head_cat_S.stl',
  dragon: 'toyventor_char_head_dragon_S.stl', alien: 'toyventor_char_head_alien_S.stl', imp: 'toyventor_char_head_imp_S.stl',
};
const FACEPLATE_FILE = {
  sculpted: 'toyventor_char_faceplate_P.stl', vinyl: 'toyventor_char_faceplate_vinyl_P.stl', flat: 'toyventor_char_faceplate_flat_P.stl',
};
const HAT_FILE = {
  ballcap: 'toyventor_hat_ballcap_S.stl', beanie: 'toyventor_hat_beanie_S.stl', cowboy: 'toyventor_hat_cowboy_S.stl',
  hardhat: 'toyventor_hat_hardhat_S.stl', ranger: 'toyventor_hat_ranger_S.stl', tophat: 'toyventor_hat_tophat_S.stl',
  pirate: 'toyventor_hat_pirate_S.stl', hat: 'toyventor_wobble_hat_S.stl', ears: 'toyventor_pointy_ears_S.stl',
  horns: 'toyventor_bumper_horns_S.stl',
};
const BACK_FILE = {
  explorer: 'toyventor_pack_explorer_S.stl', jetpack: 'toyventor_robot_back_jetpack_S.stl', wings: 'toyventor_cloud_wings_S.stl',
};
const PROP_FILE = {
  wrench: 'toyventor_prop_wrench_P.stl', shield: 'toyventor_prop_star_shield_P.stl', skateboard: 'toyventor_prop_skateboard_deck_S.stl',
  hammer: 'toyventor_prop_hammer_P.stl', screwdriver: 'toyventor_prop_screwdriver_P.stl', paint_roller: 'toyventor_prop_paint_roller_P.stl',
  mop: 'toyventor_prop_mop_P.stl', broom: 'toyventor_prop_broom_P.stl', scrub_brush: 'toyventor_prop_scrub_brush_P.stl',
  vacuum: 'toyventor_prop_vacuum_P.stl', guitar: 'toyventor_prop_guitar_P.stl', trumpet: 'toyventor_prop_trumpet_P.stl',
  maracas: 'toyventor_prop_maracas_P.stl', flag: 'toyventor_prop_flag_P.stl', magnifier: 'toyventor_prop_magnifier_P.stl',
};

/**
 * What to print for a character state (the same fields as `loco` in Kip-Demo.html). Returns
 * { items, unmapped } where each item is { id, file, qty, source, role } and `unmapped` lists
 * options that show on screen but have no single STL yet (built procedurally in the viewer), so the
 * plate never claims to cover them. Vehicles are out of scope for v1 and always reported as unmapped.
 */
export function inventoryFor(s) {
  const items = [];
  const unmapped = [];
  const classic = s.head === 'classic';
  const hasHair = s.hair && s.hair !== 'off';
  const motion = s.edition !== 'snap';

  // Body
  if (motion) {
    items.push(B('torso', 1, 'body'), B('upper_arm', 2, 'body'), B('forearm', 2, 'body'), B('thigh', 2, 'body'), B('shin', 2, 'body'),
      B('spark_peg_big', 5, 'joint'), B('spark_peg_sml', 8, 'joint'));
  } else {
    items.push(B('snap_torso', 1, 'body'), B('snap_arm', 2, 'body'), B('snap_leg', 2, 'body'),
      B('snap_turret_big', 5, 'joint'), B('snap_turret', 4, 'joint'));
  }
  items.push(B('hand_l', 1, 'body'), B('hand_r', 1, 'body'), B('boot', 2, 'body'));
  if (s.back !== 'gears') items.push(B('back_dock_studs', 1, 'body'));

  // Head
  if (classic) {
    items.push(B('head_shell', 1, 'head'), B('head_hood', 1, 'head'), B('visor', 1, 'head'), B('ear_pod_l', 1, 'head'), B('ear_pod_r', 1, 'head'));
    items.push(s.hat === 'blank' ? B('crown_cap_blank', 1, 'head') : B('crown_buds', 1, 'head'));
    if (s.expr === 'spark') items.push(B('face_eyes', 1, 'face'), B('face_glints', 1, 'face'), B('face_cheeks', 1, 'face'));
  } else {
    items.push(B('neck_turret_2x1', 1, 'head'));
    if (s.head === 'custom') unmapped.push('Custom head (.stl)');
    else items.push(P(`head_${s.head}`, HEAD_FILE[s.head] ?? '', 1, 'head'));
    if (s.hat !== 'blank' || hasHair) items.push(P('crown_buds_2x1', 'toyventor_crown_buds_2x1.stl', 1, 'head'));
    if (['kid', 'chibi', 'tall', 'jumbo'].includes(s.head)) items.push(P(`faceplate_${s.faceInsert}`, FACEPLATE_FILE[s.faceInsert] ?? FACEPLATE_FILE.sculpted, 1, 'face'));
  }

  // Wardrobe
  if (hasHair) items.push(P(`hair_${s.hair}`, `toyventor_hair_${s.hair}_S.stl`, 1, 'hair'));
  if (HAT_FILE[s.hat]) items.push(P(`hat_${s.hat}`, HAT_FILE[s.hat], 1, 'hat'));
  else if (s.hat === 'wizardHat' || s.hat === 'custom') unmapped.push(s.hat === 'custom' ? 'Custom hat (.stl)' : 'Wizard hat (SDK example)');
  if (BACK_FILE[s.back]) items.push(P(`back_${s.back}`, BACK_FILE[s.back], 1, 'back'));
  else if (s.back === 'gears') unmapped.push('Motion 2:1 gears (built from several gear parts, no single STL yet)');
  else if (s.back === 'custom') unmapped.push('Custom / photo wings');
  if (PROP_FILE[s.prop]) items.push(P(`prop_${s.prop}`, PROP_FILE[s.prop], 1, 'prop'));
  else if (s.prop === 'shaft') unmapped.push('Motion Spinner (built from shaft parts, no single STL yet)');
  else if (s.prop && s.prop !== 'off') unmapped.push(s.prop === 'wand' ? 'Star wand (SDK example)' : 'Custom prop (.stl)');
  if (s.ears === 'comm') items.push(B('ear_acc_l', 1, 'ears'), B('ear_acc_r', 1, 'ears'));
  else if (s.ears === 'motion') unmapped.push('Motion Scanner ears');
  if (s.tail === 'wag') items.push(P('tail_wag', 'toyventor_waddle_tail_s_S.stl', 1, 'tail'));
  else if (s.tail === 'motion') unmapped.push('Motion Wheelie tail');
  if (s.vehicle && s.vehicle !== 'none') unmapped.push(`Vehicle (${s.vehicle}): vehicle parts are not on the v1 plate`);

  return { items, unmapped };
}

// ---------------------------------------------------------------------------------------------
// STL
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

/** Rotate by orientation `index`, then slide so the lowest point is z = 0 and the XY box starts at 0,0. */
export function seat(tri, index = 0) {
  const rotated = transform(tri, ORIENTATIONS[index].m);
  const b = bounds(rotated);
  return { tri: transform(rotated, [1, 0, 0, 0, 1, 0, 0, 0, 1], [-b.min[0], -b.min[1], -b.min[2]]), size: b.size };
}

/**
 * Same test as preprint_check.py V4: downward faces steeper than maxOverhangDeg whose centroid is above the
 * first-layer exclusion count as overhang, except flat ceilings (normal.z < -0.98), which are bridges judged by
 * the gate's V6/V10 checks. The part has no steep overhang when their area is under the tolerance.
 * So this is V4 only: it does not judge bridge spans or ledges, and that is why only catalog parts whose
 * sha matches a validation report are labelled "support-free". `tri` must already sit on the bed (z min = 0).
 * `flags` marks each offending triangle for a heatmap.
 */
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
 * Pick the "which face is down" orientation with the least overhang (ties: more bed contact, then lower).
 * Orientation 0 wins whenever it is already support-free, so parts built for printing are never turned.
 */
export function bestOrientation(tri, lim = LIMITS) {
  let best = null;
  for (let i = 0; i < ORIENTATIONS.length; i++) {
    const seated = seat(tri, i);
    const rep = supportReport(seated.tri, lim);
    const cand = { index: i, name: ORIENTATIONS[i].name, seated, report: rep };
    if (i === 0 && rep.supportFree) return cand;
    if (!best
      || rep.overhangMm2 < best.report.overhangMm2 - 1e-6
      || (Math.abs(rep.overhangMm2 - best.report.overhangMm2) <= 1e-6
        && (rep.contactMm2 > best.report.contactMm2 + 1e-6
          || (Math.abs(rep.contactMm2 - best.report.contactMm2) <= 1e-6 && rep.heightMm < best.report.heightMm)))) best = cand;
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Packer: deterministic MaxRects (best short side fit), 90 degree rotation, gaps on inflated footprints
// ---------------------------------------------------------------------------------------------
const EPS = 1e-9;

function maxRectsPack(items, W, H, gap) {
  // Inflate by `gap` on the right/top of every footprint and the bin by the same: parts keep >= gap
  // between them and stay inside [0,W] x [0,H] with no margin loss.
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
        const key = [short, long, f.y, f.x, rot ? 1 : 0];
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
    // Drop free rects wholly inside another one (identical rects: keep the first).
    const inside = (a, b) => b.x <= a.x + EPS && b.y <= a.y + EPS && b.x + b.w >= a.x + a.w - EPS && b.y + b.h >= a.y + a.h - EPS;
    free = next.filter((a, i) => !next.some((b, j) => j !== i && inside(a, b) && (!inside(b, a) || j < i)));
  }
  return { placed, rest };
}

function less(a, b) {
  for (let i = 0; i < a.length; i++) { if (a[i] < b[i] - EPS) return true; if (a[i] > b[i] + EPS) return false; }
  return false;
}

/**
 * Pack footprints {id, w, h} onto as many square plates as needed. Stable: items are ordered by longest side,
 * then area, then id, so the same inputs always give the same plates. `oversize` lists items that cannot fit
 * a plate even alone. Positions are the lower-left corner of the (possibly rotated) footprint.
 */
export function packPlates(items, boundMm = plateBound().mm, gap = LIMITS.gapMm) {
  const order = [...items].sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // A footprint fits a plate (rotated or not) exactly when both of its sides do.
  const tooBig = (it) => Math.max(it.w, it.h) > boundMm + EPS;
  let queue = order.filter((it) => !tooBig(it));
  const plates = [];
  while (queue.length) {
    const { placed, rest } = maxRectsPack(queue, boundMm, boundMm, gap);
    if (!placed.length) break;
    plates.push(placed);
    queue = rest;
  }
  return { plates, oversize: order.filter(tooBig), boundMm, gap };
}

/** Violations of the layout rules on one plate. Empty means legal. */
export function checkPlacement(placed, boundMm = plateBound().mm, gap = LIMITS.gapMm) {
  const bad = [];
  const tol = 1e-6;
  for (const p of placed) {
    if (p.x < -tol || p.y < -tol || p.x + p.w > boundMm + tol || p.y + p.h > boundMm + tol) bad.push(`${p.id} outside the ${boundMm} mm bound`);
  }
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i], b = placed[j];
      const dx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), 0);
      const dy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h), 0);
      // Chebyshev gap, the rule export_kitcards enforces: separated by >= gap along at least one axis.
      if (Math.max(dx, dy) < gap - tol) bad.push(`${a.id} and ${b.id} are ${Math.max(dx, dy).toFixed(2)} mm apart (need ${gap})`);
    }
  }
  return bad;
}

// ---------------------------------------------------------------------------------------------
// Plate assembly
// ---------------------------------------------------------------------------------------------
const ROT90 = [0, -1, 0, 1, 0, 0, 0, 0, 1];

/**
 * Prepare one inventory entry for packing. `tri` is the parsed STL. Catalog parts keep their native orientation
 * (only dropped to z = 0 if they are not already); base parts are re-oriented by overhang score. `verified` is
 * true when the caller matched the file's sha-256 to a passing validation report.
 * Returns { id, tri (seated, z min 0, XY min 0), w, h, report, orientation, tier, ... }.
 */
export function prepareItem(entry, tri, { verified = false } = {}) {
  const native = entry.source === 'partspec';
  const choice = native ? { index: 0, name: '+z up', seated: seat(tri, 0), report: null } : bestOrientation(tri);
  const report = choice.report ?? supportReport(choice.seated.tri);
  // support-free: catalog part whose bytes match a passing validation report (full gate: V1-V10).
  // unverified: catalog part with no matching report (stale or unlisted). geometry-checked: not a catalog part and
  // no steep overhang found (V4 only; bridges and ledges are not judged here). needs-supports: steep overhang found.
  const tier = !report.supportFree ? 'needs-supports'
    : native ? (verified ? 'support-free' : 'unverified')
      : 'geometry-checked';
  return {
    id: entry.id, role: entry.role, source: entry.source, file: entry.file,
    tri: choice.seated.tri, w: choice.seated.size[0], h: choice.seated.size[1], z: choice.seated.size[2],
    orientation: choice.name, report, tier,
  };
}

/** Expand quantities into individual packable items with stable instance ids ("boot#1", "boot#2"). */
export function expandInstances(prepared, qtyById) {
  const out = [];
  for (const p of prepared) {
    const q = qtyById[p.id] ?? 1;
    for (let i = 1; i <= q; i++) out.push({ ...p, instance: q > 1 ? `${p.id}#${i}` : p.id });
  }
  return out;
}

/** Pack prepared instances; returns plates of placed parts with final world triangles. */
export function buildPlates(instances, { boundMm = plateBound().mm, gap = LIMITS.gapMm } = {}) {
  const byId = new Map(instances.map((p) => [p.instance, p]));
  const res = packPlates(instances.map((p) => ({ id: p.instance, w: p.w, h: p.h })), boundMm, gap);
  const plates = res.plates.map((placed) => placed.map((pl) => {
    const inst = byId.get(pl.id);
    // A quarter turn about Z keeps the part on the bed; re-seat so its box starts at the placed corner.
    const tri = pl.rot ? transform(transform(inst.tri, ROT90), [1, 0, 0, 0, 1, 0, 0, 0, 1], [inst.h, 0, 0]) : inst.tri;
    const world = transform(tri, [1, 0, 0, 0, 1, 0, 0, 0, 1], [pl.x, pl.y, 0]);
    return { ...pl, instance: inst.instance, partId: inst.id, role: inst.role, tier: inst.tier, source: inst.source, tri: world, z: inst.z, orientation: inst.orientation, report: inst.report };
  }));
  return { plates, oversize: res.oversize.map((o) => o.id), boundMm, gap };
}

/** One binary STL holding every part on a plate (what the offline gate slices). */
export function plateStl(placed, name = 'kip-plate') {
  let n = 0;
  for (const p of placed) n += p.tri.length;
  const all = new Float32Array(n);
  let o = 0;
  for (const p of placed) { all.set(p.tri, o); o += p.tri.length; }
  return stlBytes(all, name);
}

// ---------------------------------------------------------------------------------------------
// Export: zip (store), 3MF, layout json
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

/**
 * 3MF with one object per placed part, already in plate coordinates (mm). Parts that need supports carry a
 * PrusaSlicer-style per-object `support_material` setting in Metadata/Slic3r_PE_model.config; other slicers
 * ignore it, and the tier is also written as plain object metadata. The bed offset puts the plate centre at
 * the middle of the printer bed.
 */
export function to3mf(placed, { bedMm = LIMITS.bedMm, boundMm = plateBound().mm, title = 'Kip plate' } = {}) {
  const off = (bedMm - boundMm) / 2;
  let objects = '';
  let build = '';
  let cfg = '';
  placed.forEach((p, idx) => {
    const id = idx + 1;
    const keys = new Map();
    const verts = [];
    const tris = [];
    for (let i = 0; i < p.tri.length; i += 3) {
      const k = `${p.tri[i]},${p.tri[i + 1]},${p.tri[i + 2]}`;
      let v = keys.get(k);
      if (v === undefined) { v = verts.length / 3; keys.set(k, v); verts.push(p.tri[i], p.tri[i + 1], p.tri[i + 2]); }
      tris.push(v);
    }
    let vx = '';
    for (let i = 0; i < verts.length; i += 3) vx += `<vertex x="${+verts[i].toFixed(4)}" y="${+verts[i + 1].toFixed(4)}" z="${+verts[i + 2].toFixed(4)}"/>`;
    let tx = '';
    for (let i = 0; i < tris.length; i += 3) tx += `<triangle v1="${tris[i]}" v2="${tris[i + 1]}" v3="${tris[i + 2]}"/>`;
    objects += `<object id="${id}" name="${xml(p.instance)}" type="model"><metadata name="kip:tier">${p.tier}</metadata><mesh><vertices>${vx}</vertices><triangles>${tx}</triangles></mesh></object>`;
    build += `<item objectid="${id}" transform="1 0 0 0 1 0 0 0 1 ${+off.toFixed(3)} ${+off.toFixed(3)} 0"/>`;
    cfg += `<object id="${id}" instances_count="1"><metadata type="object" key="name" value="${xml(p.instance)}"/>${p.tier === 'needs-supports' ? '<metadata type="object" key="support_material" value="1"/>' : ''}</object>`;
  });
  const model = `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Title">${xml(title)}</metadata><metadata name="Application">ToyVentor Kip print view</metadata><resources>${objects}</resources><build>${build}</build></model>`;
  return zipStore([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="config" ContentType="text/xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>' },
    { name: '3D/3dmodel.model', data: model },
    { name: 'Metadata/Slic3r_PE_model.config', data: `<?xml version="1.0" encoding="UTF-8"?><config>${cfg}</config>` },
  ]);
}

/** Layout summary written next to every export so a plate can be rebuilt and audited. */
export function layoutJson(plates, meta = {}) {
  return JSON.stringify({
    format: 'toyventor.kip-plate/1', ...meta,
    plates: plates.map((pl, i) => ({
      plate: i + 1,
      parts: pl.map((p) => ({ instance: p.instance, part: p.partId, source: p.source, tier: p.tier, x: +p.x.toFixed(3), y: +p.y.toFixed(3), w: +p.w.toFixed(3), h: +p.h.toFixed(3), rot90: p.rot, orientation: p.orientation, overhangMm2: +p.report.overhangMm2.toFixed(2) })),
    })),
  }, null, 2);
}

/**
 * Parts whose bounding box fits inside the 31.75 mm (1.25 in) diameter, 57.15 mm (2.25 in) long small-parts
 * cylinder get a choking-hazard line on the print sheet. Box-based, so it errs toward warning.
 */
export const SMALL_PARTS_DIAMETER_MM = 31.75;
export const SMALL_PARTS_LENGTH_MM = 57.15;
export function smallParts(plates) {
  const small = [];
  for (const pl of plates) {
    for (const p of pl) {
      const d = [p.w, p.h, p.z].sort((a, b) => a - b);
      if (Math.hypot(d[0], d[1]) <= SMALL_PARTS_DIAMETER_MM && d[2] <= SMALL_PARTS_LENGTH_MM) small.push(p.instance);
    }
  }
  return small;
}
