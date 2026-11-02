// Pure Printer Profile, Fit Compensation, CIELAB DeltaE00 Palette Quantizer,
// and Spool / Filament-Change Estimator for Kip's 3D Print Workflow.
// Zero DOM, storage, network, or Three.js dependencies.

import { normHex, colorNameForHex } from './kip-print-bom.js';

export const FIT_OPTIONS = Object.freeze([
  { id: 'snug',     label: 'Snug (1 dot)',     clearanceMm: 0.00 },
  { id: 'standard', label: 'Standard (2 dots)', clearanceMm: 0.10 },
  { id: 'easy',     label: 'Easy (3 dots)',     clearanceMm: 0.26 },
]);

// Verified slicer profiles (§3.2 — OrcaSlicer, Bambu Studio, PrusaSlicer 2.9.6).
export const PRINTER_PRESETS = Object.freeze({
  compact_180: {
    presetId: 'compact_180',
    label: 'Compact 180 (1 colour)',
    slicer: 'orca_bambu',
    changerType: 'single',
    maxSlots: 1,
    multiColorStrategy: 'split-plates',
    bedXmm: 180,
    bedYmm: 180,
    maxZmm: 180,
    brimMarginMm: 5.0,
    exclusionZones: [],
    sequential: null,
    purgeGramsPerChange: 0,
  },
  standard_220: {
    presetId: 'standard_220',
    label: 'Standard 220 (1 colour)',
    slicer: 'orca_bambu',
    changerType: 'single',
    maxSlots: 1,
    multiColorStrategy: 'split-plates',
    bedXmm: 220,
    bedYmm: 220,
    maxZmm: 250,
    brimMarginMm: 5.0,
    exclusionZones: [],
    sequential: null,
    purgeGramsPerChange: 0,
  },
  large_300: {
    presetId: 'large_300',
    label: 'Large 300 (1 colour)',
    slicer: 'orca_bambu',
    changerType: 'single',
    maxSlots: 1,
    multiColorStrategy: 'split-plates',
    bedXmm: 300,
    bedYmm: 300,
    maxZmm: 340,
    brimMarginMm: 5.0,
    exclusionZones: [],
    sequential: null,
    purgeGramsPerChange: 0,
  },
  changer_256_4: {
    presetId: 'changer_256_4',
    label: '4-Slot Changer 256 (X1/P1)',
    slicer: 'orca_bambu',
    changerType: 'multiplexer',
    maxSlots: 4,
    multiColorStrategy: 'auto',
    bedXmm: 256,
    bedYmm: 256,
    maxZmm: 256,
    brimMarginMm: 5.0,
    exclusionZones: [{ xMm: 0, yMm: 0, wMm: 18, dMm: 28 }],
    sequential: { radiusMm: 68, heightToRodMm: 34, heightToLidMm: 90 },
    purgeGramsPerChange: 0.54,
  },
  changer_a1_4: {
    presetId: 'changer_a1_4',
    label: '4-Slot Changer 256 (A1)',
    slicer: 'orca_bambu',
    changerType: 'multiplexer',
    maxSlots: 4,
    multiColorStrategy: 'auto',
    bedXmm: 256,
    bedYmm: 256,
    maxZmm: 256,
    brimMarginMm: 5.0,
    exclusionZones: [],
    sequential: { radiusMm: 73, heightToRodMm: 25, heightToLidMm: 256 },
    purgeGramsPerChange: 0.54,
  },
  changer_256_8: {
    presetId: 'changer_256_8',
    label: '8-Slot Dual Changer 256',
    slicer: 'orca_bambu',
    changerType: 'multiplexer',
    maxSlots: 8,
    multiColorStrategy: 'auto',
    bedXmm: 256,
    bedYmm: 256,
    maxZmm: 256,
    brimMarginMm: 5.0,
    exclusionZones: [{ xMm: 0, yMm: 0, wMm: 18, dMm: 28 }],
    sequential: { radiusMm: 68, heightToRodMm: 34, heightToLidMm: 90 },
    purgeGramsPerChange: 0.54,
  },
  prusa_mmu_5: {
    presetId: 'prusa_mmu_5',
    label: 'Single-Nozzle 5-Slot (250×210)',
    slicer: 'prusa',
    changerType: 'multiplexer',
    maxSlots: 5,
    multiColorStrategy: 'auto',
    bedXmm: 250,
    bedYmm: 210,
    maxZmm: 220,
    brimMarginMm: 5.0,
    exclusionZones: [],
    sequential: { radiusMm: 45, heightToRodMm: 13, heightToLidMm: 220 },
    purgeGramsPerChange: 0.20,
  },
  toolchanger_5: {
    presetId: 'toolchanger_5',
    label: 'Toolchanger 5-Head (360)',
    slicer: 'prusa',
    changerType: 'toolchanger',
    maxSlots: 5,
    multiColorStrategy: 'by-layer',
    bedXmm: 360,
    bedYmm: 360,
    maxZmm: 360,
    brimMarginMm: 5.0,
    exclusionZones: [],
    sequential: { radiusMm: 67, heightToRodMm: 21, heightToLidMm: 360 },
    purgeGramsPerChange: 0,
  },
  custom: {
    presetId: 'custom',
    label: 'Custom…',
    slicer: 'orca_bambu',
    changerType: 'single',
    maxSlots: 1,
    multiColorStrategy: 'split-plates',
    bedXmm: 220,
    bedYmm: 220,
    maxZmm: 250,
    brimMarginMm: 5.0,
    exclusionZones: [],
    sequential: null,
    purgeGramsPerChange: 0,
  },
});

export const PRESET_LIST = Object.freeze(Object.values(PRINTER_PRESETS));

const VALID_SLICERS = new Set(['orca_bambu', 'prusa', 'generic']);
const VALID_CHANGERS = new Set(['single', 'multiplexer', 'toolchanger']);
const VALID_STRATEGIES = new Set(['auto', 'by-object', 'by-layer', 'split-plates']);
const VALID_LAYOUTS = new Set(['loose', 'sprue']);
const VALID_FITS = new Set(['snug', 'standard', 'easy']);
const VALID_MATERIALS = new Set(['PLA', 'PETG']);
const VALID_OVERFLOW = new Set(['extra-plates', 'merge']);

export function createDefaultProfile() {
  return clampProfile({
    ...PRINTER_PRESETS.compact_180,
    flatPackMode: 'loose',
    nozzleMm: 0.4,
    material: 'PLA',
    fitChoice: 'standard',
    tooManyColours: 'extra-plates',
    loadedSpoolsHex: [],
    includeVehicle: true,
    includeStickers: true,
    includeStencils: false,
  });
}

function clampNum(v, lo, hi, def) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(lo, Math.min(hi, n));
}

export function applyPresetToProfile(current, presetId) {
  const base = PRINTER_PRESETS[presetId] || PRINTER_PRESETS.compact_180;
  return clampProfile({
    ...current,
    ...base,
    presetId: base.presetId,
    exclusionZones: base.exclusionZones.map(z => ({ ...z })),
    sequential: base.sequential ? { ...base.sequential } : null,
  });
}

export function clampProfile(raw = {}) {
  const presetId = PRINTER_PRESETS[raw.presetId] ? raw.presetId : 'compact_180';
  const preset = PRINTER_PRESETS[presetId];
  const isCustom = presetId === 'custom';

  const slicer = VALID_SLICERS.has(raw.slicer) ? raw.slicer : preset.slicer;
  const changerType = isCustom
    ? (VALID_CHANGERS.has(raw.changerType) ? raw.changerType : preset.changerType)
    : preset.changerType;
  const maxSlots = changerType === 'single'
    ? 1
    : Math.round(clampNum(isCustom ? raw.maxSlots : preset.maxSlots, 1, 16, preset.maxSlots));

  let multiColorStrategy = VALID_STRATEGIES.has(raw.multiColorStrategy)
    ? raw.multiColorStrategy
    : preset.multiColorStrategy;
  if (maxSlots <= 1 || changerType === 'single') {
    multiColorStrategy = 'split-plates';
  }

  const bedXmm = Math.round(clampNum(isCustom ? raw.bedXmm : preset.bedXmm, 120, 500, preset.bedXmm));
  const bedYmm = Math.round(clampNum(isCustom ? raw.bedYmm : preset.bedYmm, 120, 500, preset.bedYmm));
  const maxZmm = Math.round(clampNum(isCustom ? raw.maxZmm : preset.maxZmm, 100, 500, preset.maxZmm));
  const brimMarginMm = clampNum(raw.brimMarginMm, 0, 15, 5.0);
  const nozzleMm = Number(raw.nozzleMm) === 0.2 ? 0.2 : 0.4;
  const material = VALID_MATERIALS.has(raw.material) ? raw.material : 'PLA';
  const fitChoice = VALID_FITS.has(raw.fitChoice) ? raw.fitChoice : 'standard';
  const flatPackMode = VALID_LAYOUTS.has(raw.flatPackMode) ? raw.flatPackMode : 'loose';
  const tooManyColours = VALID_OVERFLOW.has(raw.tooManyColours) ? raw.tooManyColours : 'extra-plates';

  let purgeGramsPerChange = preset.purgeGramsPerChange;
  if (isCustom) {
    const defPurge = changerType === 'multiplexer' ? (slicer === 'prusa' ? 0.20 : 0.54) : 0;
    purgeGramsPerChange = clampNum(raw.purgeGramsPerChange, 0, 5, defPurge);
  }

  return {
    presetId,
    slicer,
    changerType,
    maxSlots,
    multiColorStrategy,
    flatPackMode,
    bedXmm,
    bedYmm,
    maxZmm,
    brimMarginMm,
    exclusionZones: (isCustom ? (Array.isArray(raw.exclusionZones) ? raw.exclusionZones : []) : preset.exclusionZones).map(z => ({ ...z })),
    sequential: isCustom ? (raw.sequential ? { ...raw.sequential } : null) : (preset.sequential ? { ...preset.sequential } : null),
    purgeGramsPerChange,
    nozzleMm,
    material,
    fitChoice,
    tooManyColours,
    loadedSpoolsHex: Array.isArray(raw.loadedSpoolsHex) ? raw.loadedSpoolsHex.map(h => normHex(h)) : [],
    includeVehicle: raw.includeVehicle !== false,
    includeStickers: raw.includeStickers !== false,
    includeStencils: Boolean(raw.includeStencils),
  };
}

// Per-surface fit offset (§5.2 #7, `CALIBRATION.md` §3):
// D = clearance - 0.10 mm, s = D / 4 -> snug -0.025, standard 0, easy +0.04 mm.
export function fitCompensationForProfile(profile) {
  const fit = FIT_OPTIONS.find(f => f.id === profile?.fitChoice) || FIT_OPTIONS[1];
  const deltaDiametralMm = fit.clearanceMm - 0.10;
  const surfaceOffsetMm = Number((deltaDiametralMm / 4).toFixed(4));
  // Positive `s` (easy) shrinks outer contours (-s) and widens inner holes (+s).
  const contourMm = Number((-surfaceOffsetMm).toFixed(4)) || 0;
  const holeMm = Number((surfaceOffsetMm).toFixed(4)) || 0;
  return {
    fitChoice: fit.id,
    clearanceMm: fit.clearanceMm,
    surfaceOffsetMm,
    orca: {
      xy_contour_compensation: contourMm,
      xy_hole_compensation: holeMm,
    },
    prusa: {
      xy_size_compensation: contourMm,
    },
  };
}

// Compact < 38-char profile token for `toyforge.printerProfile.v1` so storage stays tiny.
// Append new presets after `custom` (index 7) so existing `1:0..1:7` tokens keep their exact indices.
const PRESET_CODES = ['compact_180', 'standard_220', 'changer_256_4', 'changer_a1_4', 'changer_256_8', 'prusa_mmu_5', 'toolchanger_5', 'custom', 'large_300'];
const SLICER_CODES = ['orca_bambu', 'prusa', 'generic'];
const CHANGER_CODES = ['single', 'multiplexer', 'toolchanger'];
const STRAT_CODES = ['split-plates', 'auto', 'by-layer', 'by-object'];
const FIT_CODES = ['snug', 'standard', 'easy'];
const LAYOUT_CODES = ['loose', 'sprue'];

export function encodeProfileCompact(profile) {
  const p = clampProfile(profile);
  const pi = Math.max(0, PRESET_CODES.indexOf(p.presetId));
  const si = Math.max(0, SLICER_CODES.indexOf(p.slicer));
  const ci = Math.max(0, CHANGER_CODES.indexOf(p.changerType));
  const mi = Math.max(0, STRAT_CODES.indexOf(p.multiColorStrategy));
  const fi = Math.max(0, FIT_CODES.indexOf(p.fitChoice));
  const li = Math.max(0, LAYOUT_CODES.indexOf(p.flatPackMode));
  const flags = `${p.includeVehicle ? 1 : 0}${p.includeStickers ? 1 : 0}${p.includeStencils ? 1 : 0}${p.nozzleMm === 0.2 ? 2 : 4}`;
  if (p.presetId !== 'custom') {
    return `1:${pi}:${si}:${mi}:${fi}:${li}:${flags}`;
  }
  return `1:7:${si}:${ci}:${p.maxSlots}:${p.bedXmm}x${p.bedYmm}:${mi}:${fi}:${li}:${flags}`;
}

export function decodeProfileCompact(raw) {
  if (!raw || typeof raw !== 'string') return createDefaultProfile();
  const s = raw.trim();
  if (s.startsWith('{')) {
    try {
      return clampProfile(JSON.parse(s));
    } catch {
      return createDefaultProfile();
    }
  }
  const parts = s.split(':');
  if (parts[0] !== '1') return createDefaultProfile();
  const pi = Number(parts[1]) || 0;
  const presetId = PRESET_CODES[pi] || 'compact_180';
  if (presetId !== 'custom') {
    const [, , si, mi, fi, li, flags = '1104'] = parts;
    const base = applyPresetToProfile(createDefaultProfile(), presetId);
    return clampProfile({
      ...base,
      slicer: SLICER_CODES[Number(si)] || base.slicer,
      multiColorStrategy: STRAT_CODES[Number(mi)] || base.multiColorStrategy,
      fitChoice: FIT_CODES[Number(fi)] || 'standard',
      flatPackMode: LAYOUT_CODES[Number(li)] || 'loose',
      includeVehicle: flags[0] !== '0',
      includeStickers: flags[1] !== '0',
      includeStencils: flags[2] === '1',
      nozzleMm: flags[3] === '2' ? 0.2 : 0.4,
    });
  }
  const [, , si, ci, slots, bed = '220x220', mi, fi, li, flags = '1104'] = parts;
  const [bx, by] = bed.split('x').map(Number);
  return clampProfile({
    presetId: 'custom',
    slicer: SLICER_CODES[Number(si)] || 'orca_bambu',
    changerType: CHANGER_CODES[Number(ci)] || 'single',
    maxSlots: Number(slots) || 1,
    bedXmm: bx || 220,
    bedYmm: by || bx || 220,
    maxZmm: Math.max(180, bx || 220),
    multiColorStrategy: STRAT_CODES[Number(mi)] || 'split-plates',
    fitChoice: FIT_CODES[Number(fi)] || 'standard',
    flatPackMode: LAYOUT_CODES[Number(li)] || 'loose',
    includeVehicle: flags[0] !== '0',
    includeStickers: flags[1] !== '0',
    includeStencils: flags[2] === '1',
    nozzleMm: flags[3] === '2' ? 0.2 : 0.4,
  });
}

// ---------------------------------------------------------------------------
// CIELAB & CIEDE2000 (DeltaE00) Colour Distance + Role-Affinity Consolidation
// ---------------------------------------------------------------------------
export function hexToLab(hex) {
  const h = normHex(hex).slice(1);
  const srgb = [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
  const lin = srgb.map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  // D65 sRGB -> XYZ
  const x = (lin[0] * 0.4124564 + lin[1] * 0.3575761 + lin[2] * 0.1804375) / 0.95047;
  const y = (lin[0] * 0.2126729 + lin[1] * 0.7151522 + lin[2] * 0.0721750) / 1.00000;
  const z = (lin[0] * 0.0193339 + lin[1] * 0.1191920 + lin[2] * 0.9503041) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : (7.787 * t) + (16 / 116));
  const fx = f(x), fy = f(y), fz = f(z);
  return {
    L: (116 * fy) - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

export function deltaE00(hexA, hexB) {
  const lab1 = hexToLab(hexA);
  const lab2 = hexToLab(hexB);
  const deg2rad = Math.PI / 180;
  const rad2deg = 180 / Math.PI;

  const C1 = Math.hypot(lab1.a, lab1.b);
  const C2 = Math.hypot(lab2.a, lab2.b);
  const Cbar = (C1 + C2) / 2;
  const Cbar7 = Cbar ** 7;
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + 25 ** 7)));

  const a1p = (1 + G) * lab1.a;
  const a2p = (1 + G) * lab2.a;
  const C1p = Math.hypot(a1p, lab1.b);
  const C2p = Math.hypot(a2p, lab2.b);

  const hp = (ap, b) => {
    if (ap === 0 && b === 0) return 0;
    const ang = Math.atan2(b, ap) * rad2deg;
    return ang >= 0 ? ang : ang + 360;
  };
  const h1p = hp(a1p, lab1.b);
  const h2p = hp(a2p, lab2.b);

  const dLp = lab2.L - lab1.L;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    if (Math.abs(h2p - h1p) <= 180) dhp = h2p - h1p;
    else if (h2p - h1p > 180) dhp = h2p - h1p - 360;
    else dhp = h2p - h1p + 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * deg2rad);

  const Lbarp = (lab1.L + lab2.L) / 2;
  const Cbarp = (C1p + C2p) / 2;
  let hbarp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) / 2;
    else if (h1p + h2p < 360) hbarp = (h1p + h2p + 360) / 2;
    else hbarp = (h1p + h2p - 360) / 2;
  }

  const T = 1
    - 0.17 * Math.cos((hbarp - 30) * deg2rad)
    + 0.24 * Math.cos((2 * hbarp) * deg2rad)
    + 0.32 * Math.cos((3 * hbarp + 6) * deg2rad)
    - 0.20 * Math.cos((4 * hbarp - 63) * deg2rad);

  const dTheta = 30 * Math.exp(-(((hbarp - 275) / 25) ** 2));
  const Cbarp7 = Cbarp ** 7;
  const RC = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + 25 ** 7));
  const SL = 1 + ((0.015 * ((Lbarp - 50) ** 2)) / Math.sqrt(20 + ((Lbarp - 50) ** 2)));
  const SC = 1 + 0.045 * Cbarp;
  const SH = 1 + 0.015 * Cbarp * T;
  const RT = -Math.sin(2 * dTheta * deg2rad) * RC;

  const termL = dLp / SL;
  const termC = dCp / SC;
  const termH = dHp / SH;
  return Math.sqrt(termL * termL + termC * termC + termH * termH + RT * termC * termH);
}

function mergeAffinityWeight(rolesA, rolesB) {
  const isAccentOnly = (roles) => [...roles].every(r => r === 'accent' || r === 'joint');
  if (isAccentOnly(rolesA) || isAccentOnly(rolesB)) return 0.30;
  const hasShoe = (roles) => roles.has('shoes');
  const hasDarkPeer = (roles) => roles.has('clothing') || roles.has('tire') || roles.has('mechanism');
  if ((hasShoe(rolesA) && hasDarkPeer(rolesB)) || (hasShoe(rolesB) && hasDarkPeer(rolesA))) return 0.60;
  return 1.0;
}

function isProtectedPair(rolesA, rolesB, dE) {
  if (dE <= 8.0) return false;
  const aSkin = rolesA.has('skin');
  const bSkin = rolesB.has('skin');
  const aHairOrTop = rolesA.has('hair') || rolesA.has('clothing');
  const bHairOrTop = rolesB.has('hair') || rolesB.has('clothing');
  return (aSkin && bHairOrTop) || (bSkin && aHairOrTop);
}

/**
 * Consolidate BOM item colours down to `targetSlots` using role-weighted DeltaE00 (§3.3).
 */
export function consolidateColors(items, targetSlots) {
  const maxColors = Math.max(1, Math.round(Number(targetSlots) || 1));
  const groups = new Map();
  for (const it of items) {
    const h = normHex(it.hex);
    if (!groups.has(h)) {
      groups.set(h, { hex: h, qty: 0, roles: new Set() });
    }
    const g = groups.get(h);
    g.qty += it.qty || 1;
    if (it.role) g.roles.add(it.role);
  }

  const remap = new Map();
  for (const h of groups.keys()) remap.set(h, h);
  const merges = [];

  while (groups.size > maxColors) {
    const keys = [...groups.keys()];
    let bestPair = null;
    let bestCost = Infinity;

    for (let pass = 0; pass < 2 && !bestPair; pass++) {
      const allowProtected = pass === 1;
      for (let i = 0; i < keys.length; i++) {
        for (let j = i + 1; j < keys.length; j++) {
          const gA = groups.get(keys[i]);
          const gB = groups.get(keys[j]);
          const dE = deltaE00(gA.hex, gB.hex);
          if (!allowProtected && isProtectedPair(gA.roles, gB.roles, dE)) continue;
          const cost = dE * mergeAffinityWeight(gA.roles, gB.roles);
          if (cost < bestCost) {
            bestCost = cost;
            bestPair = [gA, gB, dE];
          }
        }
      }
    }
    if (!bestPair) break;

    const [gA, gB, dE] = bestPair;
    // Keep the dominant colour (or non-accent colour when tied)
    const aAccent = [...gA.roles].every(r => r === 'accent' || r === 'joint');
    const bAccent = [...gB.roles].every(r => r === 'accent' || r === 'joint');
    const [keep, drop] = (aAccent && !bAccent)
      ? [gB, gA]
      : ((!aAccent && bAccent) ? [gA, gB] : (gA.qty >= gB.qty ? [gA, gB] : [gB, gA]));

    keep.qty += drop.qty;
    for (const r of drop.roles) keep.roles.add(r);
    groups.delete(drop.hex);

    for (const [orig, cur] of remap.entries()) {
      if (cur === drop.hex) remap.set(orig, keep.hex);
    }
    merges.push({
      fromHex: drop.hex,
      fromName: colorNameForHex(drop.hex),
      toHex: keep.hex,
      toName: colorNameForHex(keep.hex),
      deltaE: Number(dE.toFixed(1)),
    });
  }

  const mergedItems = items.map(it => {
    const nextHex = remap.get(normHex(it.hex)) || normHex(it.hex);
    return {
      ...it,
      hex: nextHex,
      colorName: colorNameForHex(nextHex),
    };
  });

  return { items: mergedItems, merges, remap };
}

// ---------------------------------------------------------------------------
// Spool Mass & Colour-Change / Purge Waste Estimator (§3.4)
// ---------------------------------------------------------------------------
export const MATERIAL_DENSITY_G_CM3 = Object.freeze({
  PLA:  1.24,
  PETG: 1.27,
});

/**
 * Shell + infill mass model (§3.4, calibrated against OrcaSlicer 2.4.2 3-wall / 15%-grid slices):
 * m = rho * (min(V, A * t) + f * max(0, V - A * t))
 * Nominal: t = 1.15 mm, f = 0.15; range: [t = 0.90, f = 0.15] .. [t = 1.55, f = 0.20].
 */
export function partMassEstimateGrams({ volumeMm3 = 0, areaMm2 = 0, qty = 1, material = 'PLA' }) {
  const V = Math.max(0, Number(volumeMm3) || 0);
  const A = Math.max(0, Number(areaMm2) || 0);
  const rho = MATERIAL_DENSITY_G_CM3[material] || MATERIAL_DENSITY_G_CM3.PLA;
  const evalShellInfill = (tMm, f) => {
    const shell = Math.min(V, A * tMm);
    const core = Math.max(0, V - A * tMm);
    return ((shell + f * core) / 1000) * rho * qty;
  };
  const grams = evalShellInfill(1.15, 0.15);
  const minGrams = evalShellInfill(0.90, 0.15);
  const maxGrams = evalShellInfill(1.55, 0.20);
  const solidGrams = (V / 1000) * rho * qty;
  return { grams, minGrams, maxGrams, solidGrams };
}

/**
 * Compute per-colour spool budget and colour-change / purge waste across prepared parts.
 * Each entry in `partInstances` carries `{ hex, colorName, volumeMm3, areaMm2, heightMm, group }`.
 */
export function estimateSpoolAndChanges(partInstances = [], profile = createDefaultProfile()) {
  const byColor = new Map();
  let characterGrams = 0;
  let vehicleGrams = 0;

  for (const inst of partInstances) {
    const hex = normHex(inst.hex || '#F4EFE6');
    const est = partMassEstimateGrams({
      volumeMm3: inst.volumeMm3 || 0,
      areaMm2: inst.areaMm2 || 0,
      qty: inst.qty || 1,
      material: profile.material || 'PLA',
    });
    if (inst.group === 'vehicle') vehicleGrams += est.grams;
    else characterGrams += est.grams;

    if (!byColor.has(hex)) {
      byColor.set(hex, {
        hex,
        colorName: inst.colorName || colorNameForHex(hex),
        partCount: 0,
        grams: 0,
        minGrams: 0,
        maxGrams: 0,
        solidGrams: 0,
        maxHeightMm: 0,
      });
    }
    const g = byColor.get(hex);
    g.partCount += inst.qty || 1;
    g.grams += est.grams;
    g.minGrams += est.minGrams;
    g.maxGrams += est.maxGrams;
    g.solidGrams += est.solidGrams;
    g.maxHeightMm = Math.max(g.maxHeightMm, Number(inst.heightMm) || 0);
  }

  const spools = [...byColor.values()]
    .map(s => ({
      ...s,
      grams: Number(s.grams.toFixed(1)),
      minGrams: Number(s.minGrams.toFixed(1)),
      maxGrams: Number(s.maxGrams.toFixed(1)),
      solidGrams: Number(s.solidGrams.toFixed(1)),
    }))
    .sort((a, b) => b.grams - a.grams || a.hex.localeCompare(b.hex));

  const uniqueColors = spools.length;
  const strategy = profile.multiColorStrategy || 'split-plates';
  const layerMm = 0.20;

  let colorChanges = 0;
  let manualSpoolSwaps = 0;
  if (strategy === 'split-plates' || profile.maxSlots <= 1) {
    colorChanges = 0;
    manualSpoolSwaps = Math.max(0, uniqueColors - 1);
  } else if (strategy === 'by-object') {
    colorChanges = Math.max(0, uniqueColors - 1);
  } else if (strategy === 'by-layer') {
    const maxH = spools.reduce((m, s) => Math.max(m, s.maxHeightMm), 0);
    const totalLayers = Math.max(1, Math.ceil(maxH / layerMm));
    for (let l = 1; l <= totalLayers; l++) {
      const z = l * layerMm;
      let present = 0;
      for (const s of spools) {
        if (s.maxHeightMm >= z - 1e-6) present++;
      }
      if (present >= 2) {
        colorChanges += (present - 1) + (profile.changerType === 'toolchanger' ? 0 : 1);
      }
    }
  } else {
    // `auto` hybrid estimate: top large colour(s) solo, remaining small colours batched sequentially
    const smallCount = spools.filter((_, idx) => idx >= 1).length;
    colorChanges = Math.max(0, Math.min(smallCount, profile.maxSlots) - 1);
  }

  const purgeGrams = Number((colorChanges * (profile.purgeGramsPerChange || 0)).toFixed(1));
  const totalGrams = Number(spools.reduce((a, s) => a + s.grams, 0).toFixed(1));
  const minTotalGrams = Number(spools.reduce((a, s) => a + s.minGrams, 0).toFixed(1));
  const maxTotalGrams = Number(spools.reduce((a, s) => a + s.maxGrams, 0).toFixed(1));

  return {
    spools,
    uniqueColors,
    totalGrams,
    minTotalGrams,
    maxTotalGrams,
    characterGrams: Number(characterGrams.toFixed(1)),
    vehicleGrams: Number(vehicleGrams.toFixed(1)),
    colorChanges,
    manualSpoolSwaps,
    purgeGrams,
  };
}
