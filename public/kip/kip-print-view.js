// Print view: shows the character's parts packed flat on a plate, with a tier colour per part, and exports it.
// The maths lives in kip-print.js (pure, unit tested); this file only fetches STLs, builds three.js meshes,
// and drives download. It owns no character state: `ctx.getState()` is read each time the view opens or repacks.
//
//   ctx.THREE, ctx.scene, ctx.camera, ctx.controls
//   ctx.getState()               character fields for inventoryFor (loco + ears + tail)
//   ctx.setCharacterVisible(on)  hide/show the posed character while the plate is up
//   ctx.fetchBytes(url)          optional; defaults to fetch() -> Uint8Array, throws on a non-2xx response
import {
  LIMITS, plateBound, inventoryFor, parseStl, prepareItem, expandInstances, buildPlates, plateStl,
  to3mf, zipStore, layoutJson, smallParts,
} from './kip-print.js';

export const TIER_LABEL = {
  'support-free': 'Support-free (verified)',
  unverified: 'Unverified (no matching validation report)',
  'geometry-checked': 'No steep overhang (geometry check only)',
  'needs-supports': 'Needs supports',
};
const TIER_COLOR = { 'support-free': 0x1fa97c, unverified: 0xf0a020, 'geometry-checked': 0x7d8fb3, 'needs-supports': 0xe8503a };

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function defaultFetchBytes(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText || 'error'}`);
  return new Uint8Array(await r.arrayBuffer());
}

export function mountPrintView(ctx) {
  const { THREE, scene, camera, controls } = ctx;
  const fetchBytes = ctx.fetchBytes ?? defaultFetchBytes;
  const cache = new Map(); // url -> { tri, sha } | { error }
  let validation = null;
  let on = false;
  let busy = false;
  let plates = [];
  let plateIndex = 0;
  let view = null; // { group, meshes }
  let saved = null;
  let summary = { lines: [], errors: [], plates: 0, parts: 0 };
  let lastBuild = null;
  let watchKey = '';
  let watcher = 0;

  async function loadValidation() {
    if (validation) return validation;
    try { validation = JSON.parse(new TextDecoder().decode(await fetchBytes('/kip/partspec-validation.json'))).files ?? {}; }
    catch { validation = {}; } // no index: every catalog part is honestly "unverified"
    return validation;
  }

  async function load(url) {
    if (cache.has(url)) return cache.get(url);
    let rec;
    try {
      const bytes = await fetchBytes(url);
      const sha = hex(await crypto.subtle.digest('SHA-256', bytes));
      rec = { tri: parseStl(bytes), sha, bytes };
    } catch (e) { return { error: e.message }; } // failures are not cached: fixing the file fixes the plate
    cache.set(url, rec);
    return rec;
  }

  /** Build plates for the current character. Missing files are reported, never skipped silently. */
  async function build() {
    const state = ctx.getState();
    const inv = inventoryFor(state);
    const index = await loadValidation();
    const prepared = [];
    const errors = [];
    for (const entry of inv.items) {
      if (entry.file.endsWith('/')) { errors.push(`${entry.id}: no STL mapped for this option`); continue; }
      const rec = await load(entry.file);
      if (rec.error) { errors.push(`${entry.file.split('/').pop()} (${rec.error})`); continue; }
      const name = entry.file.split('/').pop();
      const rep = index[name];
      const verified = entry.source === 'partspec' && !!rep && rep.sha256 === rec.sha && rep.verdict !== 'fail';
      prepared.push(prepareItem(entry, rec.tri, { verified }));
    }
    const qty = Object.fromEntries(inv.items.map((e) => [e.id, e.qty]));
    const instances = expandInstances(prepared, qty);
    const bound = plateBound();
    const res = buildPlates(instances, { boundMm: bound.mm });
    const tiers = {};
    for (const pl of res.plates) for (const p of pl) tiers[p.tier] = (tiers[p.tier] ?? 0) + 1;
    const lines = [
      `${instances.length} parts on ${res.plates.length} plate${res.plates.length === 1 ? '' : 's'} (${bound.mm} mm, ${LIMITS.gapMm} mm gaps)`,
      ...Object.entries(tiers).map(([t, n]) => `${n} × ${TIER_LABEL[t]}`),
    ];
    if (res.oversize.length) errors.push(`Too big for a plate: ${res.oversize.join(', ')}`);
    summary = { lines, errors, unmapped: inv.unmapped, plates: res.plates.length, parts: instances.length, note: bound.note, small: smallParts(res.plates), exportError: null };
    lastBuild = { res, state, inv, instances };
    return res;
  }

  function clearView() {
    if (!view) return;
    scene.remove(view.group);
    view.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose?.(); });
    view = null;
  }

  function render() {
    clearView();
    const bound = plateBound().mm;
    const bed = LIMITS.bedMm;
    const outer = new THREE.Group();
    const flat = new THREE.Group(); // plate coordinates: x right, y "up the page", z up from the bed
    flat.position.set(-bound / 2, -bound / 2, 0);
    outer.rotation.x = -Math.PI / 2; // same STL-to-scene mapping the viewer uses (scadMesh)
    outer.add(flat);

    const bedMesh = new THREE.Mesh(new THREE.PlaneGeometry(bed, bed), new THREE.MeshStandardMaterial({ color: 0x2b3042, roughness: 0.9 }));
    bedMesh.position.set(bound / 2, bound / 2, -0.05);
    flat.add(bedMesh);
    const edge = (w, c) => {
      const g = new THREE.EdgesGeometry(new THREE.PlaneGeometry(w, w));
      const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: c }));
      l.position.set(bound / 2, bound / 2, 0.05);
      return l;
    };
    flat.add(edge(bound, 0xff6b4a), edge(bed, 0x8a90a8));

    const meshes = [];
    for (const p of plates[plateIndex] ?? []) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(p.tri, 3));
      geo.computeVertexNormals();
      let mat;
      if (p.tier === 'needs-supports') {
        // heatmap: triangles that overhang red, the rest a muted grey
        const colors = new Float32Array(p.tri.length);
        const hot = new THREE.Color(0xe8503a), cool = new THREE.Color(0xb9bfce);
        p.report.flags.forEach((f, i) => { const c = f ? hot : cool; for (let k = 0; k < 3; k++) { colors[i * 9 + k * 3] = c.r; colors[i * 9 + k * 3 + 1] = c.g; colors[i * 9 + k * 3 + 2] = c.b; } });
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
      } else {
        mat = new THREE.MeshStandardMaterial({ color: TIER_COLOR[p.tier], roughness: 0.55 });
      }
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true; m.receiveShadow = true;
      m.name = `plate_${p.instance}`;
      m.userData = { instance: p.instance, tier: p.tier };
      flat.add(m);
      meshes.push(m);
    }
    scene.add(outer);
    view = { group: outer, meshes };
  }

  async function enter() {
    if (busy) return;
    busy = true;
    try {
      const res = await build();
      plates = res.plates;
      plateIndex = Math.min(plateIndex, Math.max(0, plates.length - 1));
      if (!on) {
        saved = { pos: camera.position.clone(), target: controls.target.clone() };
        ctx.setCharacterVisible(false);
      }
      on = true;
      render();
      camera.position.set(0, 330, 250);
      controls.target.set(0, 0, 0);
      watchKey = JSON.stringify(ctx.getState());
      // Changing the character while the plate is up re-packs it (the packer is fast; STL bytes are cached).
      if (!watcher) {
        watcher = setInterval(() => {
          const k = JSON.stringify(ctx.getState());
          if (k !== watchKey && !busy) { watchKey = k; enter(); }
        }, 250);
      }
    } finally { busy = false; }
  }

  function exit() {
    if (!on) return;
    on = false;
    clearInterval(watcher); watcher = 0;
    clearView();
    ctx.setCharacterVisible(true);
    if (saved) { camera.position.copy(saved.pos); controls.target.copy(saved.target); }
    saved = null;
  }

  /** Re-pack after the character changed while the plate is up. */
  async function repack() { if (on) await enter(); }

  function exportable() {
    if (!lastBuild) throw new Error('Open the plate view first');
    if (summary.errors.length) throw new Error(`Plate is incomplete: ${summary.errors.join('; ')}`);
    return lastBuild;
  }

  /** Bytes for an export: '3mf' | 'stl-zip' | 'sheet' (PNG). Throws, never returns a partial plate. */
  async function exportBytes(kind) {
    const { res, state } = exportable();
    const meta = { title: 'Kip plate', character: { head: state.head, hair: state.hair, hat: state.hat, edition: state.edition }, boundMm: res.boundMm, gapMm: res.gap };
    if (kind === '3mf') return to3mf(res.plates[plateIndex] ?? [], { boundMm: res.boundMm, title: `Kip plate ${plateIndex + 1}/${res.plates.length}` });
    if (kind === 'stl-zip') {
      const files = [{ name: 'layout.json', data: layoutJson(res.plates, meta) }];
      res.plates.forEach((pl, i) => files.push({ name: `plate_${i + 1}.stl`, data: plateStl(pl, `kip-plate-${i + 1}`) }));
      return zipStore(files);
    }
    if (kind === 'sheet') return renderSheet(res, meta);
    throw new Error(`unknown export ${kind}`);
  }

  async function renderSheet(res, meta) {
    const PX = 5; // px per mm
    const bed = LIMITS.bedMm;
    const pad = 40;
    const w = bed * PX + pad * 2;
    const small = summary.small ?? [];
    const lines = [...(summary.lines ?? [])];
    if (summary.unmapped?.length) lines.push(`Not on this plate: ${summary.unmapped.join('; ')}`);
    const footer = [
      'Layout rules (>= 5 mm between parts, inside the 170 mm plate) are checked on every plate. `npm run kip:plate-check` runs the offline gate on the 10 presets;',
      'custom builds are geometry-checked only. Parts marked "Needs supports" must be printed with slicer supports.',
      ...(small.length ? [`SMALL PARTS: ${small.join(', ')} fit inside the 31.75 mm small-parts cylinder. Choking hazard: keep from children under 3 years.`] : []),
    ];
    const head = 70 + lines.length * 18;
    const foot = 30 + footer.length * 16;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = head + bed * PX + pad + foot;
    const g = canvas.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = '#1b2238'; g.font = 'bold 20px sans-serif'; g.fillText(`Kip print sheet · plate ${plateIndex + 1} of ${res.plates.length}`, pad, 34);
    g.font = '13px sans-serif'; lines.forEach((l, i) => g.fillText(l, pad, 58 + i * 18));
    const ox = pad, oy = head;
    g.fillStyle = '#eef0f6'; g.fillRect(ox, oy, bed * PX, bed * PX);
    g.strokeStyle = '#8a90a8'; g.strokeRect(ox, oy, bed * PX, bed * PX);
    const inset = (bed - res.boundMm) / 2;
    g.strokeStyle = '#ff6b4a'; g.setLineDash([6, 4]); g.strokeRect(ox + inset * PX, oy + inset * PX, res.boundMm * PX, res.boundMm * PX); g.setLineDash([]);
    for (const p of res.plates[plateIndex] ?? []) {
      const x = ox + (inset + p.x) * PX, y = oy + (bed - inset - p.y - p.h) * PX; // sheet y grows downward
      g.fillStyle = `#${TIER_COLOR[p.tier].toString(16).padStart(6, '0')}`; g.globalAlpha = 0.75; g.fillRect(x, y, p.w * PX, p.h * PX); g.globalAlpha = 1;
      g.strokeStyle = '#1b2238'; g.strokeRect(x, y, p.w * PX, p.h * PX);
      g.fillStyle = '#1b2238'; g.font = '11px sans-serif'; g.fillText(p.instance, x + 3, y + 13, Math.max(20, p.w * PX - 6));
    }
    g.fillStyle = '#5d657c'; g.font = '12px sans-serif';
    footer.forEach((l, i) => g.fillText(l, pad, head + bed * PX + pad - 8 + i * 16 + 10, w - pad * 2));
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    void meta;
    return new Uint8Array(await blob.arrayBuffer());
  }

  async function download(kind) {
    let bytes;
    try { bytes = await exportBytes(kind); }
    catch (e) { summary.exportError = e.message; return; } // shown in the panel; never a partial file
    summary.exportError = null;
    const type = kind === 'sheet' ? 'image/png' : kind === '3mf' ? 'model/3mf' : 'application/zip';
    const name = kind === 'sheet' ? 'kip-print-sheet.png' : kind === '3mf' ? 'kip-plate.3mf' : 'kip-plates-stl.zip';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type }));
    a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  return {
    enter, exit, repack, exportBytes, download,
    isOn: () => on,
    isBusy: () => busy,
    summary: () => summary,
    plateCount: () => plates.length,
    plateIndex: () => plateIndex,
    setPlate(i) { plateIndex = Math.max(0, Math.min(plates.length - 1, i)); if (on) render(); },
    plates: () => plates,
    meshes: () => view?.meshes ?? [],
  };
}
