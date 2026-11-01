// Print view: shows the character's (and optional vehicle's) parts packed flat on colour-grouped plates,
// renders true filament colours by default (or the overhang tier heatmap when Support Check is toggled on),
// and exports per-plate 3MFs, multi-plate Orca/Bambu projects, print sheets, and `kip-print-pack.zip`.
//
// All geometry, BOM, profile, and 3MF maths live in pure modules (`kip-print-bom.js`, `kip-print-profile.js`,
// `kip-print.js`); this file handles STL fetching, Three.js plate rendering, canvas sheet drawing, and downloads.

import { resolveSceneBom } from './kip-print-bom.js';
import { resolveBodyColors } from './kip-vehicles-wardrobe.js';
import {
  BONUS_EXPRESSIONS,
  planStickerSheet,
  stickersToPdf,
  buildStickerPackFiles,
} from './kip-print-stickers.js';
import {
  createDefaultProfile,
  applyPresetToProfile,
  clampProfile,
  encodeProfileCompact,
  decodeProfileCompact,
} from './kip-print-profile.js';
import {
  LIMITS,
  PRINT_PAGE_WARNINGS,
  parseStl,
  prepareItem,
  planColorPlates,
  plateStl,
  to3mf,
  to3mfProject,
  zipStore,
  layoutJson,
  smallParts,
  buildPrintPackFiles,
} from './kip-print.js';

export const TIER_LABEL = {
  'support-free': 'Support-free (verified)',
  unverified: 'Unverified (no matching validation report)',
  'geometry-checked': 'No steep overhang (geometry check only)',
  'needs-supports': 'Needs supports',
};
const TIER_COLOR = {
  'support-free': 0x1fa97c,
  unverified: 0xf0a020,
  'geometry-checked': 0x7d8fb3,
  'needs-supports': 0xe8503a,
};

const PROFILE_STORAGE_KEY = 'toyforge.printerProfile.v1';

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function defaultFetchBytes(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText || 'error'}`);
  return new Uint8Array(await r.arrayBuffer());
}

function readStoredProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    return raw ? decodeProfileCompact(raw) : createDefaultProfile();
  } catch {
    return createDefaultProfile();
  }
}

function writeStoredProfile(profile) {
  try {
    localStorage.setItem(PROFILE_STORAGE_KEY, encodeProfileCompact(profile));
  } catch {
    // Storage unavailable (private browsing / iframe sandbox); keep in memory.
  }
}

function stateWatchSignature(state, profile) {
  const customSig = {};
  if (state && state.customStlSlots) {
    for (const [k, v] of Object.entries(state.customStlSlots)) {
      if (v && v.bytes) customSig[k] = `${v.name || k}|${v.colorHex || ''}|${v.bytes.byteLength || v.bytes.length || 0}`;
    }
  }
  return JSON.stringify({
    ...state,
    customStlSlots: customSig,
    _prof: encodeProfileCompact(profile),
    _overflow: profile.tooManyColours,
  });
}

function wrapTextLines(ctx2d, text, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const out = [];
  let line = '';
  for (const w of words) {
    const cand = line ? `${line} ${w}` : w;
    if (ctx2d.measureText(cand).width <= maxWidth || !line) {
      line = cand;
    } else {
      out.push(line);
      line = w;
    }
  }
  if (line) out.push(line);
  return out;
}

export function mountPrintView(ctx) {
  const { THREE, scene, camera, controls } = ctx;
  const fetchBytes = ctx.fetchBytes ?? defaultFetchBytes;
  const cache = new Map(); // url -> { tri, sha, bytes }
  let validationIndex = null;
  let profile = readStoredProfile();
  let supportCheckOn = false;
  let on = false;
  let busy = false;
  let planned = []; // rich planned plates
  let rawPlates = []; // legacy placed[][] view
  let plateIndex = 0;
  let view = null; // { group, meshes }
  let saved = null;
  let summary = {
    lines: [],
    errors: [],
    unmapped: [],
    plates: 0,
    parts: 0,
    sceneColorCount: 0,
    hasVehicleInScene: false,
    hasDecals: false,
    small: [],
    note: '',
    exportError: null,
  };
  let lastBuild = null;
  let watchKey = '';
  let watcher = 0;

  async function loadValidation() {
    if (validationIndex) return validationIndex;
    try {
      const parsed = JSON.parse(new TextDecoder().decode(await fetchBytes('/kip/partspec-validation.json')));
      validationIndex = { files: parsed.files ?? {} };
    } catch {
      validationIndex = { files: {} };
    }
    return validationIndex;
  }

  async function load(url) {
    if (cache.has(url)) return cache.get(url);
    let rec;
    try {
      const bytes = await fetchBytes(url);
      const sha = hex(await crypto.subtle.digest('SHA-256', bytes));
      rec = { tri: parseStl(bytes), sha, bytes };
    } catch (e) {
      return { error: e.message };
    }
    cache.set(url, rec);
    return rec;
  }

  async function prepareCustomEntry(entry) {
    try {
      const u8 = entry.bytes instanceof Uint8Array ? entry.bytes : new Uint8Array(entry.bytes);
      const sha = hex(await crypto.subtle.digest('SHA-256', u8));
      const tri = parseStl(u8);
      return { tri, sha };
    } catch (e) {
      return { error: e.message };
    }
  }

  /** Build colour-separated plates for the live character & optional vehicle. */
  async function build() {
    const state = ctx.getState();
    const valIdx = await loadValidation();
    const bom = resolveSceneBom(state, {
      includeVehicle: profile.includeVehicle,
      validationIndex: valIdx,
    });

    const prepared = [];
    const errors = [];
    for (const entry of bom.items) {
      if (entry.bytes) {
        const rec = await prepareCustomEntry(entry);
        if (rec.error) { errors.push(`${entry.customName || entry.id} (${rec.error})`); continue; }
        prepared.push(prepareItem(entry, rec.tri, { verified: false, sha256: rec.sha }));
        continue;
      }
      if (!entry.file || entry.file.endsWith('/')) {
        errors.push(`${entry.id}: no STL mapped for this option`);
        continue;
      }
      const rec = await load(entry.file);
      if (rec.error) {
        errors.push(`${entry.file.split('/').pop()} (${rec.error})`);
        continue;
      }
      const fname = entry.file.split('/').pop();
      const rep = valIdx.files[fname];
      const verified = entry.source === 'partspec' && !!rep && rep.sha256 === rec.sha && rep.verdict !== 'fail';
      prepared.push(prepareItem(entry, rec.tri, { verified, sha256: rec.sha }));
    }

    const sceneColorCount = new Set(prepared.map(p => p.hex)).size;
    const plan = planColorPlates(prepared, profile);
    const est = plan.estimate;
    const totalParts = plan.rawPlates.reduce((n, pl) => n + pl.length, 0);

    const tiers = {};
    for (const pl of plan.rawPlates) {
      for (const p of pl) tiers[p.tier] = (tiers[p.tier] ?? 0) + 1;
    }

    const spruePlateCount = plan.plates.filter(pl => Boolean(pl.sprue)).length;
    const lines = [
      `${totalParts} parts across ${plan.plates.length} plate${plan.plates.length === 1 ? '' : 's'} (${plan.bound.mm} mm plate on ${profile.bedXmm}×${profile.bedYmm} mm bed)`,
      ...(spruePlateCount > 0
        ? [`Kit cards: ${spruePlateCount} sprue plate${spruePlateCount === 1 ? '' : 's'} (2.4×1.0 mm frame, 0.4 mm V-notches)`]
        : []),
      `Spool budget (est.): ~${est.totalGrams} g (${est.minTotalGrams}–${est.maxTotalGrams} g)`
        + (bom.hasVehicleInScene ? (profile.includeVehicle ? ` · vehicle +${est.vehicleGrams} g` : ' · vehicle excluded') : ''),
      ...est.spools.map(s => `• ${s.colorName} (${s.hex}): ~${s.grams} g · ${s.partCount} pcs`),
      est.colorChanges > 0
        ? `Colour changes: ≈ ${est.colorChanges}${est.purgeGrams > 0 ? `, ≈ ${est.purgeGrams} g purge` : ' (0 g toolchanger)'}`
        : `Single-colour plates: ${est.manualSpoolSwaps} manual spool swap${est.manualSpoolSwaps === 1 ? '' : 's'}, 0 g purge`,
    ];

    if (plan.merges.length) {
      lines.push(`Merged to ${profile.maxSlots} slots: ${plan.merges.map(m => `${m.fromName} → ${m.toName}`).join(', ')}`);
    }
    for (const [t, n] of Object.entries(tiers)) {
      lines.push(`${n} × ${TIER_LABEL[t]}`);
    }
    if (bom.notes?.length) {
      for (const n of bom.notes) lines.push(n);
    }

    if (plan.oversize.length) errors.push(`Too big for a ${plan.bound.mm} mm plate: ${plan.oversize.join(', ')}`);

    summary = {
      lines,
      errors,
      unmapped: bom.unmapped,
      plates: plan.plates.length,
      parts: totalParts,
      sceneColorCount,
      hasVehicleInScene: bom.hasVehicleInScene,
      hasDecals: (bom.decals?.length ?? 0) > 0,
      hasSprue: spruePlateCount > 0,
      note: plan.bound.note,
      small: smallParts(plan.rawPlates),
      exportError: null,
    };
    lastBuild = { plan, bom, state };
    return plan;
  }

  function clearView() {
    if (!view) return;
    scene.remove(view.group);
    view.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose?.();
    });
    view = null;
  }

  function render() {
    clearView();
    const activePlate = planned[plateIndex];
    const bound = activePlate?.boundMm ?? Math.min(LIMITS.maxPlateMm, Math.min(profile.bedXmm, profile.bedYmm) - 2 * profile.brimMarginMm);
    const bedX = profile.bedXmm || LIMITS.bedMm;
    const bedY = profile.bedYmm || LIMITS.bedMm;

    const outer = new THREE.Group();
    const flat = new THREE.Group(); // plate coordinates: x right, y "up the page", z up from the bed
    flat.position.set(-bound / 2, -bound / 2, 0);
    outer.rotation.x = -Math.PI / 2;
    outer.add(flat);

    const bedMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(bedX, bedY),
      new THREE.MeshStandardMaterial({ color: 0x2b3042, roughness: 0.9 }),
    );
    bedMesh.position.set(bound / 2, bound / 2, -0.05);
    flat.add(bedMesh);

    const edge = (w, d, c) => {
      const g = new THREE.EdgesGeometry(new THREE.PlaneGeometry(w, d));
      const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: c }));
      l.position.set(bound / 2, bound / 2, 0.05);
      return l;
    };
    flat.add(edge(bound, bound, 0xff6b4a), edge(bedX, bedY, 0x8a90a8));

    const meshes = [];
    for (const p of rawPlates[plateIndex] ?? []) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(p.tri, 3));
      geo.computeVertexNormals();
      let mat;
      if (supportCheckOn) {
        if (p.tier === 'needs-supports') {
          const colors = new Float32Array(p.tri.length);
          const hot = new THREE.Color(0xe8503a);
          const cool = new THREE.Color(0xb9bfce);
          p.report.flags.forEach((f, i) => {
            const c = f ? hot : cool;
            for (let k = 0; k < 3; k++) {
              colors[i * 9 + k * 3] = c.r;
              colors[i * 9 + k * 3 + 1] = c.g;
              colors[i * 9 + k * 3 + 2] = c.b;
            }
          });
          geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
          mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
        } else {
          mat = new THREE.MeshStandardMaterial({ color: TIER_COLOR[p.tier], roughness: 0.55 });
        }
      } else {
        const partHex = p.hex || activePlate?.hex || '#F4EFE6';
        mat = new THREE.MeshStandardMaterial({ color: partHex, roughness: 0.46, metalness: 0.04 });
      }
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      m.name = `plate_${p.instance}`;
      m.userData = { instance: p.instance, partId: p.partId, tier: p.tier, hex: p.hex || activePlate?.hex || '#F4EFE6' };
      flat.add(m);
      meshes.push(m);

      if (supportCheckOn && p.blockerTri && p.blockerTri.length) {
        const bGeo = new THREE.BufferGeometry();
        bGeo.setAttribute('position', new THREE.BufferAttribute(p.blockerTri, 3));
        bGeo.computeVertexNormals();
        const bMat = new THREE.MeshStandardMaterial({
          color: 0x38bdf8,
          transparent: true,
          opacity: 0.28,
          depthWrite: false,
          roughness: 0.4,
        });
        const bm = new THREE.Mesh(bGeo, bMat);
        bm.name = `socket_guard_${p.instance}`;
        flat.add(bm);
      }
    }

    if (activePlate?.sprue?.tri?.length) {
      const sGeo = new THREE.BufferGeometry();
      sGeo.setAttribute('position', new THREE.BufferAttribute(activePlate.sprue.tri, 3));
      sGeo.computeVertexNormals();
      const sMat = supportCheckOn
        ? new THREE.MeshStandardMaterial({ color: TIER_COLOR['support-free'], roughness: 0.55 })
        : new THREE.MeshStandardMaterial({ color: activePlate.hex || '#F4EFE6', roughness: 0.52, metalness: 0.04 });
      const sm = new THREE.Mesh(sGeo, sMat);
      sm.castShadow = true;
      sm.receiveShadow = true;
      sm.name = 'plate_kit_card_sprue';
      flat.add(sm);
    }

    scene.add(outer);
    view = { group: outer, meshes };
  }

  async function enter() {
    if (busy) return;
    busy = true;
    try {
      const plan = await build();
      planned = plan.plates;
      rawPlates = plan.rawPlates;
      plateIndex = Math.min(plateIndex, Math.max(0, planned.length - 1));
      if (!on) {
        saved = { pos: camera.position.clone(), target: controls.target.clone() };
        ctx.setCharacterVisible(false);
      }
      on = true;
      render();
      const span = Math.max(180, profile.bedXmm, profile.bedYmm);
      camera.position.set(0, span * 1.82, span * 1.38);
      controls.target.set(0, 0, 0);
      watchKey = stateWatchSignature(ctx.getState(), profile);
      if (!watcher) {
        watcher = setInterval(() => {
          const k = stateWatchSignature(ctx.getState(), profile);
          if (k !== watchKey && !busy) {
            watchKey = k;
            enter();
          }
        }, 250);
      }
    } finally {
      busy = false;
    }
  }

  function exit() {
    if (!on) return;
    on = false;
    clearInterval(watcher);
    watcher = 0;
    clearView();
    ctx.setCharacterVisible(true);
    if (saved) {
      camera.position.copy(saved.pos);
      controls.target.copy(saved.target);
    }
    saved = null;
  }

  async function repack() {
    if (on) await enter();
  }

  function setPreset(presetId) {
    profile = applyPresetToProfile(profile, presetId);
    writeStoredProfile(profile);
    if (on && !busy) enter();
  }

  function updateProfile(patch) {
    profile = clampProfile({ ...profile, ...patch });
    writeStoredProfile(profile);
    if (on && !busy) enter();
  }

  function setSupportCheck(next) {
    supportCheckOn = Boolean(next);
    if (on) render();
  }

  function exportable() {
    if (!lastBuild) throw new Error('Open the plate view first');
    if (summary.errors.length) throw new Error(`Plate is incomplete: ${summary.errors.join('; ')}`);
    return lastBuild;
  }

  /** Render one-page visual plate map + spool swatches + 16 CFR 1500.19(d) warning box as PNG bytes. */
  async function renderSheet(plan, bom) {
    const prof = plan.profile;
    const activePlate = plan.plates[plateIndex] || plan.plates[0];
    const placed = activePlate ? activePlate.placed : [];
    const boundMm = activePlate ? activePlate.boundMm : plan.bound.mm;
    const bedX = prof.bedXmm;
    const bedY = prof.bedYmm;
    const PX = Math.max(2.5, Math.min(5, Math.floor(920 / Math.max(bedX, bedY))));
    const pad = 40;
    const w = Math.max(760, Math.round(bedX * PX + pad * 2));

    const headerLines = [
      `${summary.parts} parts · ${plan.plates.length} plate${plan.plates.length === 1 ? '' : 's'} · ~${plan.estimate.totalGrams} g ${prof.material} (est. ${plan.estimate.minTotalGrams}–${plan.estimate.maxTotalGrams} g)`,
      `Printer: ${prof.presetId} (${bedX}×${bedY} mm, ${prof.nozzleMm} mm nozzle, fit: ${prof.fitChoice}, slicer: ${prof.slicer})`,
    ];
    if (summary.unmapped?.length) {
      headerLines.push(`Not on 3D plates: ${summary.unmapped.join('; ')}`);
    }

    const swatchRows = Math.max(1, Math.ceil(plan.estimate.spools.length / 3));
    const headH = 74 + headerLines.length * 18 + swatchRows * 22 + 12;

    // Measure wrapped warning lines inside a 16 CFR 1500.19(d) warning rectangle
    const measureCanvas = document.createElement('canvas');
    const mg = measureCanvas.getContext('2d');
    mg.font = '12.5px sans-serif';
    const warnInnerW = w - pad * 2 - 28;
    const small = summary.small ?? [];
    const hasAnySprue = plan.plates.some(pl => Boolean(pl.sprue)) || prof.flatPackMode === 'sprue';
    const warnParagraphs = [
      ...(small.length ? [`${PRINT_PAGE_WARNINGS.small_part} Small-parts screen (${small.length} pcs): ${small.slice(0, 12).join(', ')}${small.length > 12 ? '…' : ''}.`] : []),
      ...(hasAnySprue ? [PRINT_PAGE_WARNINGS.sprue_prep] : []),
      PRINT_PAGE_WARNINGS.always,
      'Parts marked "Needs supports" are placed on dedicated support plates (>= 6 mm spacing) with mating-socket guards and require slicer supports enabled.',
    ];
    const warnWrapped = warnParagraphs.flatMap(p => wrapTextLines(mg, p, warnInnerW));
    const warnBoxH = 44 + warnWrapped.length * 17;
    const bedPxW = Math.round(bedX * PX);
    const bedPxH = Math.round(bedY * PX);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = headH + bedPxH + 28 + warnBoxH + pad;
    const g = canvas.getContext('2d');

    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, canvas.width, canvas.height);

    g.fillStyle = '#1b2238';
    g.font = 'bold 20px sans-serif';
    g.fillText(`Kip Print Sheet · ${activePlate ? activePlate.label : 'Plate 1'}`, pad, 34);

    g.font = '13px sans-serif';
    g.fillStyle = '#36405c';
    headerLines.forEach((l, i) => g.fillText(l, pad, 58 + i * 18, w - pad * 2));

    // Spool colour swatches
    const swatchTop = 62 + headerLines.length * 18;
    const colW = Math.floor((w - pad * 2) / 3);
    plan.estimate.spools.forEach((s, idx) => {
      const col = idx % 3;
      const row = Math.floor(idx / 3);
      const sx = pad + col * colW;
      const sy = swatchTop + row * 22;
      g.fillStyle = s.hex;
      g.fillRect(sx, sy, 14, 14);
      g.strokeStyle = '#1b2238';
      g.lineWidth = 1;
      g.strokeRect(sx, sy, 14, 14);
      g.fillStyle = '#1b2238';
      g.font = '12px sans-serif';
      g.fillText(`${s.colorName} ${s.hex} (~${s.grams}g, ${s.partCount})`, sx + 20, sy + 11.5, colW - 26);
    });

    // Bed & plate map
    const ox = Math.round((w - bedPxW) / 2);
    const oy = headH;
    g.fillStyle = '#eef0f6';
    g.fillRect(ox, oy, bedPxW, bedPxH);
    g.strokeStyle = '#8a90a8';
    g.lineWidth = 1.5;
    g.strokeRect(ox, oy, bedPxW, bedPxH);

    const insetX = (bedX - boundMm) / 2;
    const insetY = (bedY - boundMm) / 2;
    g.strokeStyle = '#ff6b4a';
    g.setLineDash([6, 4]);
    g.strokeRect(ox + insetX * PX, oy + insetY * PX, boundMm * PX, boundMm * PX);
    g.setLineDash([]);

    // Draw flat-pack kit-card perimeter frame & V-nick runner gates when present on this plate
    if (activePlate?.sprue) {
      const fb = activePlate.sprue.frameBox;
      const fw = activePlate.sprue.spec?.frameWidthMm ?? 2.4;
      const fx = ox + (insetX + fb.x) * PX;
      const fy = oy + (bedY - insetY - fb.y - fb.h) * PX;
      g.strokeStyle = '#1b2238';
      g.lineWidth = Math.max(2, fw * PX);
      g.strokeRect(fx + (fw * PX) * 0.5, fy + (fw * PX) * 0.5, (fb.w - fw) * PX, (fb.h - fw) * PX);
      g.lineWidth = Math.max(1.5, 1.8 * PX);
      for (const gt of activePlate.sprue.gates) {
        g.beginPath();
        g.moveTo(ox + (insetX + gt.wx0) * PX, oy + (bedY - insetY - gt.wy0) * PX);
        g.lineTo(ox + (insetX + gt.wx1) * PX, oy + (bedY - insetY - gt.wy1) * PX);
        g.stroke();
      }
      g.lineWidth = 1;
    }

    for (const p of placed) {
      const x = ox + (insetX + p.x) * PX;
      const y = oy + (bedY - insetY - p.y - p.h) * PX;
      const fillHex = supportCheckOn
        ? `#${TIER_COLOR[p.tier].toString(16).padStart(6, '0')}`
        : (p.hex || activePlate?.hex || '#F4EFE6');
      g.fillStyle = fillHex;
      g.globalAlpha = 0.85;
      g.fillRect(x, y, p.w * PX, p.h * PX);
      g.globalAlpha = 1;
      g.strokeStyle = p.tier === 'needs-supports' ? '#d63a34' : '#1b2238';
      g.lineWidth = p.tier === 'needs-supports' ? 1.8 : 1;
      g.strokeRect(x, y, p.w * PX, p.h * PX);
      g.fillStyle = '#1b2238';
      g.font = '10.5px sans-serif';
      g.fillText(p.instance, x + 3, y + 12, Math.max(18, p.w * PX - 6));
    }

    // 16 CFR 1500.19(d) Boxed Warning Notice (triangle + bold WARNING + multi-line English block)
    const wx = pad;
    const wy = oy + bedPxH + 20;
    const ww = w - pad * 2;
    g.fillStyle = '#fff8ee';
    g.fillRect(wx, wy, ww, warnBoxH);
    g.strokeStyle = '#1b2238';
    g.lineWidth = 2;
    g.strokeRect(wx, wy, ww, warnBoxH);

    // Exclamation triangle (>= height of WARNING lettering)
    const tx = wx + 14;
    const ty = wy + 27;
    g.beginPath();
    g.moveTo(tx + 10, ty - 18);
    g.lineTo(tx + 20, ty);
    g.lineTo(tx, ty);
    g.closePath();
    g.fillStyle = '#ffb830';
    g.fill();
    g.lineWidth = 1.6;
    g.strokeStyle = '#1b2238';
    g.stroke();
    g.fillStyle = '#1b2238';
    g.font = 'bold 13px sans-serif';
    g.fillText('!', tx + 8, ty - 3);

    g.font = 'bold 15px sans-serif';
    g.fillStyle = '#1b2238';
    g.fillText('WARNING', tx + 28, ty - 2);

    g.font = '12.5px sans-serif';
    warnWrapped.forEach((line, i) => {
      g.fillText(line, wx + 14, wy + 46 + i * 17, warnInnerW);
    });

    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  }

  /** Bytes for an export: 'pack' | 'project-3mf' | '3mf' | 'stickers-pdf' | 'stl-zip' | 'sheet' (PNG). Throws on incomplete plate. */
  async function exportBytes(kind) {
    const { plan, bom, state } = exportable();
    const prof = plan.profile;
    const activePlate = plan.plates[plateIndex] || plan.plates[0];
    const bodyColors = resolveBodyColors(state);
    const stickerOpts = {
      headSkinHex: bodyColors.headSkinHex,
      shirtHex: bodyColors.chestHex,
    };

    if (kind === 'stickers-pdf') {
      if (!bom.decals?.length) throw new Error('No active decals to export on this character');
      const renderedSources = ctx.renderStickerSources ? await ctx.renderStickerSources(state, bom, BONUS_EXPRESSIONS) : {};
      const sheetPlan = planStickerSheet(bom.decals, state, stickerOpts);
      return stickersToPdf(sheetPlan, renderedSources, stickerOpts);
    }

    if (kind === 'project-3mf') {
      return to3mfProject(plan.plates, prof, { title: 'Kip Print Pack' });
    }

    if (kind === 'pack') {
      const sheetPng = await renderSheet(plan, bom);
      let stickerFiles = [];
      if (prof.includeStickers !== false && bom.decals?.length) {
        const renderedSources = ctx.renderStickerSources ? await ctx.renderStickerSources(state, bom, BONUS_EXPRESSIONS) : {};
        stickerFiles = buildStickerPackFiles(bom.decals, state, renderedSources, stickerOpts);
      }
      const packFiles = buildPrintPackFiles({ plan, bom, state, printSheetPng: sheetPng, stickerFiles });
      return zipStore(packFiles);
    }
    if (kind === '3mf') {
      const placed = activePlate ? activePlate.placed : [];
      const filCols = prof.maxSlots > 1 ? plan.filamentColoursHex.slice(0, prof.maxSlots) : [activePlate?.hex || '#F4EFE6'];
      return to3mf(activePlate || placed, {
        bedMm: prof.bedXmm,
        bedYmm: prof.bedYmm,
        boundMm: activePlate ? activePlate.boundMm : plan.bound.mm,
        title: activePlate ? activePlate.label : 'Kip plate',
        slicer: prof.slicer === 'prusa' ? 'prusa' : 'orca_bambu',
        profile: prof,
        extruder: activePlate ? activePlate.extruderSlot : 1,
        filamentColours: filCols,
        sprue: activePlate?.sprue || null,
      });
    }
    if (kind === 'stl-zip') {
      const files = [{
        name: 'layout.json',
        data: layoutJson(plan.plates, {
          state,
          profile: prof,
          estimate: plan.estimate,
          merges: plan.merges,
          unmapped: bom.unmapped,
          notes: bom.notes,
        }),
      }];
      plan.plates.forEach((pl) => {
        files.push({ name: `${pl.fileStem}.stl`, data: plateStl(pl, pl.fileStem, pl.sprue) });
      });
      return zipStore(files);
    }
    if (kind === 'sheet') return renderSheet(plan, bom);
    throw new Error(`unknown export ${kind}`);
  }

  async function download(kind) {
    let bytes;
    try {
      bytes = await exportBytes(kind);
    } catch (e) {
      summary.exportError = e.message;
      return;
    }
    summary.exportError = null;
    const activePlate = planned[plateIndex];
    const type = kind === 'sheet'
      ? 'image/png'
      : (kind === '3mf' || kind === 'project-3mf')
        ? 'model/3mf'
        : kind === 'stickers-pdf'
          ? 'application/pdf'
          : 'application/zip';
    const name = kind === 'pack'
      ? 'kip-print-pack.zip'
      : kind === 'project-3mf'
        ? 'kip-project.3mf'
        : kind === 'sheet'
          ? 'kip-print-sheet.png'
          : kind === 'stickers-pdf'
            ? 'kip-sticker-sheet.pdf'
            : kind === '3mf'
              ? `${activePlate?.fileStem || 'kip-plate'}.3mf`
              : 'kip-plates-stl.zip';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type }));
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  return {
    enter,
    exit,
    repack,
    exportBytes,
    download,
    getState: () => ctx.getState(),
    isOn: () => on,
    isBusy: () => busy,
    summary: () => summary,
    plateCount: () => planned.length,
    plateIndex: () => plateIndex,
    plateLabel: (i) => planned[i]?.label ?? `Plate ${i + 1} of ${planned.length}`,
    setPlate(i) {
      plateIndex = Math.max(0, Math.min(planned.length - 1, i));
      if (on) render();
    },
    plates: () => rawPlates,
    plannedPlates: () => planned,
    meshes: () => view?.meshes ?? [],
    profile: () => profile,
    setPreset,
    updateProfile,
    supportCheck: () => supportCheckOn,
    setSupportCheck,
  };
}
