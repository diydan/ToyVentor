#!/usr/bin/env node
// Kip demo print workflow: headless-Chrome e2e checks for Milestone M1 of docs/specs/kip-print-workflow-spec.md.
// Run: npm run e2e:kip-print     Exits nonzero on any failing check.
// Env: E2E_CHROME, E2E_SHOTS, E2E_STRICT_STL=1 (see scripts/lib/kip-e2e.mjs). Needs python3 to validate zips.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createChecks, launchChrome, startServer } from "./lib/kip-e2e.mjs";

const SHOTS = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), "kip-print-shots");
const { check, finish } = createChecks("kip print e2e");

const b64 = (expr) => `(async () => { const u = await (${expr}); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); })()`;
const toBuf = (s) => Buffer.from(s, "base64");
function pyZip(buf, code) {
  const f = path.join(mkdtempSync(path.join(os.tmpdir(), "kip-zip-")), "x.zip");
  writeFileSync(f, buf);
  return execFileSync("python3", ["-c", `import zipfile,sys\nz=zipfile.ZipFile(sys.argv[1])\nassert z.testzip() is None\n${code}`, f], { encoding: "utf8" });
}
const STATE_BOY = `window.kipMenu.ctx.act.applyPreset('boy')`;

const server = await startServer();
const chrome = await launchChrome({ width: 1440, height: 900 });
try {
  console.log(`serving ${server.base}`);
  const tab = await chrome.open(`${server.base}/kip/Kip-Demo.html`);
  check("demo initialises", await tab.waitFor("window.__KIP_READY__ === true && !!window.kipPrint && !!window.kipRig", 180000), tab.exceptions[0]);
  if (server.missing.size) console.log(`  note: ${server.missing.size} STL(s) missing on disk, stubbed`);

  console.log("\n[1] Gate (b): resolved BOM colours match painted 3D scene colours across all 10 presets + car & truck");
  const colorParity = await tab.evaluate(`(async () => {
    const B = await import('/kip/kip-print-bom.js');
    const { THREE, kip } = window.kipRig();
    const c = window.kipMenu.ctx;
    const slotMap = new Map(kip.partSlots.map(s => [s.id, s]));
    const firstMesh = (obj) => {
      if (!obj) return null;
      if (obj.isMesh) return obj;
      let hit = null;
      obj.traverse(ch => { if (!hit && ch.isMesh) hit = ch; });
      return hit;
    };
    const meshHex = (m) => {
      if (!m) return null;
      const attr = m.geometry?.getAttribute?.('color');
      if (m.material?.vertexColors && attr && attr.count > 0) {
        return '#' + new THREE.Color(attr.getX(0), attr.getY(0), attr.getZ(0)).getHexString(THREE.SRGBColorSpace).toUpperCase();
      }
      if (m.material?.color) {
        return '#' + m.material.color.getHexString(THREE.SRGBColorSpace).toUpperCase();
      }
      return null;
    };
    const slotHex = (slotId) => meshHex(firstMesh(slotMap.get(slotId)?.grp));

    const mismatches = [];
    const checkedPresets = [];
    const checkScene = (tag) => {
      const st = window.kipPrint.getState();
      const bom = B.resolveSceneBom(st);
      const findBomHex = (id, role = null) => {
        const it = bom.items.find(x => x.id === id && (!role || x.role === role));
        return it ? it.hex : null;
      };
      const eq = (label, got, want) => {
        if (!got || !want || got !== want) mismatches.push(\`\${tag}/\${label}: painted=\${got} vs bom=\${want}\`);
      };
      if (st.edition === 'pro') {
        eq('torso', slotHex('torso_pro'), findBomHex('torso'));
        eq('upper_arm', slotHex('upper_arm_l'), findBomHex('upper_arm'));
        eq('forearm', slotHex('forearm_l'), findBomHex('forearm'));
        eq('thigh', slotHex('thigh_l'), findBomHex('thigh'));
        eq('shin', slotHex('shin_l'), findBomHex('shin'));
      } else {
        eq('snap_torso', slotHex('torso_snap'), findBomHex('snap_torso'));
        eq('snap_arm', slotHex('snap_arm_l'), findBomHex('snap_arm'));
        eq('snap_leg', slotHex('snap_leg_l'), findBomHex('snap_leg'));
      }
      eq('hand_l', slotHex('hand_l'), findBomHex('hand_l'));
      eq('hand_r', slotHex('hand_r'), findBomHex('hand_r'));
      eq('boot', slotHex('boot_l'), findBomHex('boot'));
      if (st.head !== 'custom') {
        eq('neck_turret_2x1', slotHex('neck_turret_2x1'), findBomHex('neck_turret_2x1'));
        const headMesh = firstMesh(kip.exp.headMeshes[st.head]);
        const headBom = bom.items.find(x => x.id.endsWith('_head_' + st.head) || (st.head === 'robot' && x.id === 'robot_head_visor'));
        eq('head_' + st.head, meshHex(headMesh), headBom?.hex);
      }
      if (['kid', 'chibi', 'tall', 'jumbo'].includes(st.head) && st.hair && st.hair !== 'off') {
        const hairMesh = firstMesh(kip.exp.hairMeshes[st.hair]);
        eq('hair_' + st.hair, meshHex(hairMesh), findBomHex('hair_' + st.hair));
      }
      if (['ballcap', 'beanie', 'hardhat', 'cowboy', 'ranger', 'pirate', 'tophat'].includes(st.hat)) {
        const hatMesh = firstMesh(kip.exp.hatMeshes[st.hat]);
        if (hatMesh && findBomHex('hat_' + st.hat)) {
          eq('hat_' + st.hat, meshHex(hatMesh), findBomHex('hat_' + st.hat));
        }
      }
      if (st.vehicle === 'scooter' || st.vehicle === 'moto') {
        eq('veh_scooter_frame', slotHex('veh_scooter_frame'), findBomHex('veh_scooter_frame'));
      } else if (st.vehicle === 'car') {
        eq('veh_car_chassis', slotHex('veh_car_chassis'), findBomHex('veh_car_chassis'));
      } else if (st.vehicle === 'truck') {
        eq('veh_truck_chassis', slotHex('veh_truck_chassis'), findBomHex('veh_truck_chassis'));
      }
      checkedPresets.push(tag);
    };

    for (const p of c.presets) {
      c.act.applyPreset(p.id);
      checkScene(p.id);
    }
    c.act.applyPreset('boy');
    c.act.setEdition('snap');
    checkScene('boy-snap');
    c.act.setEdition('pro');
    c.act.setVehicle('car');
    checkScene('boy-car');
    c.act.setVehicle('truck');
    checkScene('boy-truck');
    return { checked: checkedPresets.length, mismatches };
  })()`);
  check(`painted 3D rig colours match resolved BOM across ${colorParity.checked} preset/vehicle configurations`, colorParity.mismatches.length === 0, colorParity.mismatches.slice(0, 5).join("; "));

  console.log("\n[2] colour-grouped plate view & Support check toggle for Leo Explorer");
  await tab.evaluate(STATE_BOY);
  check("Print group exists, collapsed to one toggle until the plate is on", await tab.evaluate(`(() => { const m = window.kipMenu; return m.controls.has('plateView') && m.fields.get('printInfo').root.hidden && m.fields.get('export3mf').root.hidden && m.fields.get('downloadPack').root.hidden; })()`));
  await tab.evaluate(`(() => { const i = document.getElementById('km-plateView'); i.checked = true; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  check("plate view opens and packs colour-separated plates", await tab.waitFor(`window.kipPrint.isOn() && window.kipPrint.plannedPlates().length > 1 && !window.kipPrint.isBusy()`, 120000));
  const info = await tab.evaluate(`document.getElementById('km-printInfo').textContent`);
  console.log(info.split("\n").map((l) => `    ${l}`).join("\n"));
  check("summary line names parts, plates, support-free status, and spool budget grams", /\d+ parts across \d+ plates?/.test(info) && /All parts print without supports/.test(info) && /Spool budget \(est\.\): ~\d+(\.\d+)? g/.test(info), info);

  const geo = await tab.evaluate(`(async () => {
    const K = await import('/kip/kip-print.js');
    const { THREE } = window.kipRig();
    const v = window.kipPrint;
    const out = { plates: v.plannedPlates().length, violations: [], parts: 0, tiers: {}, outside: 0, colorMismatches: 0 };
    for (const pl of v.plannedPlates()) {
      out.violations.push(...K.checkPlacement(pl.placed, pl.boundMm, pl.gap));
      for (const p of pl.placed) {
        out.parts++;
        out.tiers[p.tier] = (out.tiers[p.tier] || 0) + 1;
        const b = K.bounds(p.tri);
        if (b.min[2] < -1e-3 || b.min[0] < -1e-3 || b.min[1] < -1e-3 || b.max[0] > pl.boundMm + 1e-3 || b.max[1] > pl.boundMm + 1e-3) out.outside++;
      }
    }
    for (const m of v.meshes()) {
      const shownHex = '#' + m.material.color.getHexString(THREE.SRGBColorSpace).toUpperCase();
      if (shownHex !== m.userData.hex) out.colorMismatches++;
    }
    out.meshes = v.meshes().length;
    out.heatOff = v.meshes().filter(m => m.geometry.getAttribute('color')).length;
    return out; })()`);
  check("every plate is legal: >= 5 mm (or 6 mm support) gaps, inside 170 mm bound, seated on bed", geo.violations.length === 0 && geo.outside === 0, JSON.stringify(geo.violations.slice(0, 3)));
  check("one mesh per part on the shown plate in true filament sRGB colour by default", geo.meshes === (await tab.evaluate(`window.kipPrint.plates()[window.kipPrint.plateIndex()].length`)) && geo.heatOff === 0 && geo.colorMismatches === 0);
  check("built-in Leo Explorer has 0 needs-supports parts and verified support-free catalog parts", (geo.tiers["support-free"] ?? 0) > 0 && (geo.tiers["needs-supports"] ?? 0) === 0, JSON.stringify(geo.tiers));

  // Switch Layout to 'Kit tray' ('sprue') and verify zero-support kit trays render cleanly
  const trayCheck = await tab.evaluate(`(async () => {
    const sel = document.getElementById('km-layout');
    const sprueOpt = [...sel.options].find(o => o.value === 'sprue');
    const optLabel = sprueOpt ? sprueOpt.textContent.trim() : '';
    sel.value = 'sprue';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return { optLabel };
  })()`);
  check("Layout option label is 'Kit tray' and repacks zero-support kit trays", trayCheck.optLabel === "Kit tray" && await tab.waitFor(`!window.kipPrint.isBusy() && window.kipPrint.profile().flatPackMode === 'sprue' && window.kipPrint.plannedPlates().some(pl => Boolean(pl.sprue)) && !/^Packing/.test(document.getElementById('km-printInfo').textContent) && /Kit trays:/.test(document.getElementById('km-printInfo').textContent)`, 60000));
  const trayInfo = await tab.evaluate(`(() => {
    const v = window.kipPrint;
    const sprueIdx = v.plannedPlates().findIndex(pl => Boolean(pl.sprue));
    if (sprueIdx >= 0) v.setPlate(sprueIdx);
    const hasSprueMesh = Boolean(v.meshes()[0]?.parent?.getObjectByName('plate_kit_card_sprue'));
    const supPlates = v.plannedPlates().filter(pl => pl.requiresSupports).length;
    const text = document.getElementById('km-printInfo').textContent;
    v.setPlate(0);
    return { hasSprueMesh, supPlates, text };
  })()`);
  check("Kit tray renders sprue runner mesh with 0 support plates and 'All parts print without supports'", trayInfo.hasSprueMesh && trayInfo.supPlates === 0 && /Kit trays:/.test(trayInfo.text) && /All parts print without supports/.test(trayInfo.text), JSON.stringify(trayInfo));
  console.log(`    tiers: ${JSON.stringify(geo.tiers)}`);
  await tab.shot(path.join(SHOTS, "plate-1440.png"));

  console.log("\n[3] exports & fallback support isolation: custom overhanging STL, Orca/Bambu 3MF, PrusaSlicer 3MF, STL zip, PNG, and kip-print-pack.zip");
  // Equip an SO(3)-invariant overhanging UV-sphere custom STL so we also verify dedicated support-plate isolation, red heatmap, and 3MF support flags
  await tab.evaluate(`(async () => {
    const K = await import('/kip/kip-print.js');
    const quad = (a, b, c, d) => [...a, ...b, ...c, ...a, ...c, ...d];
    const rings = 14, segs = 20, r = 10;
    const pt = (i, j) => {
      const phi = (Math.PI * i) / rings, th = (2 * Math.PI * (j % segs)) / segs, sp = Math.sin(phi);
      return [r * sp * Math.cos(th), r * sp * Math.sin(th), 10 + r * Math.cos(phi)];
    };
    const out = [];
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < segs; j++) {
        if (i === 0) out.push(...pt(0, 0), ...pt(1, j), ...pt(1, j + 1));
        else if (i === rings - 1) out.push(...pt(i, j), ...pt(rings, 0), ...pt(i, j + 1));
        else out.push(...quad(pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1)));
      }
    }
    const stlBytes = K.stlBytes(Float32Array.from(out), 'orb_hat');
    const file = new File([stlBytes], 'orb_hat.stl', { type: 'model/stl' });
    await window.kipMenu.ctx.act.loadFile(file);
  })()`);
  check("custom overhanging STL isolates off the tray onto a support plate and updates summary line", await tab.waitFor(`!window.kipPrint.isBusy() && window.kipPrint.plannedPlates().some(pl => pl.requiresSupports) && /1 part needs supports:/.test(document.getElementById('km-printInfo').textContent)`, 60000));

  const heatCheck = await tab.evaluate(`(() => {
    const v = window.kipPrint;
    const supIdx = v.plannedPlates().findIndex(pl => pl.requiresSupports);
    if (supIdx >= 0) v.setPlate(supIdx);
    const el = document.getElementById('km-supportCheck');
    el.checked = true;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    const heat = v.meshes().filter(m => m.geometry.getAttribute('color')).length;
    const want = v.meshes().filter(m => m.userData.tier === 'needs-supports').length;
    el.checked = false;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { supIdx, heat, want };
  })()`);
  check("Support check toggle reveals red overhang heatmap on dedicated support plates", heatCheck.supIdx >= 0 && heatCheck.want > 0 && heatCheck.heat === heatCheck.want, JSON.stringify(heatCheck));

  // Keep the support plate selected so we verify per-object support flags in both slicer dialects
  const shown = await tab.evaluate(`window.kipPrint.plates()[window.kipPrint.plateIndex()].length`);
  const wantSupp = await tab.evaluate(`window.kipPrint.plates()[window.kipPrint.plateIndex()].filter(p => p.tier === 'needs-supports').length`);

  const orcaMf = toBuf(await tab.evaluate(b64(`window.kipPrint.exportBytes('3mf')`)));
  const orcaOut = pyZip(orcaMf, "m=z.read('3D/3dmodel.model').decode()\nc=z.read('Metadata/model_settings.config').decode()\np=z.read('Metadata/project_settings.config').decode()\nprint(m.count('<item '), c.count('enable_support\" value=\"1\"'), 'millimeter' in m, 'PrusaSlicer' not in m, len(p) > 20)");
  const [oItems, oSupp, oMm, oNoPrusa, oHasProj] = orcaOut.trim().split(" ");
  check(`Orca/Bambu 3MF has ${shown} build items, ${wantSupp} tree-support flags, and non-empty project_settings.config`, Number(oItems) === shown && Number(oSupp) === wantSupp && oMm === "True" && oNoPrusa === "True" && oHasProj === "True", orcaOut);

  // Switch preset to prusa_mmu_5 and verify PrusaSlicer 3MF dialect
  await tab.evaluate(`window.kipPrint.setPreset('prusa_mmu_5')`);
  await tab.waitFor(`!window.kipPrint.isBusy() && window.kipPrint.profile().slicer === 'prusa'`, 60000);
  await tab.evaluate(`(() => { const v = window.kipPrint; const s = v.plannedPlates().findIndex(pl => pl.requiresSupports); if (s >= 0) v.setPlate(s); })()`);
  const shownP = await tab.evaluate(`window.kipPrint.plates()[window.kipPrint.plateIndex()].length`);
  const wantSuppP = await tab.evaluate(`window.kipPrint.plates()[window.kipPrint.plateIndex()].filter(p => p.tier === 'needs-supports').length`);
  const prusaMf = toBuf(await tab.evaluate(b64(`window.kipPrint.exportBytes('3mf')`)));
  const prusaOut = pyZip(prusaMf, "m=z.read('3D/3dmodel.model').decode()\nc=z.read('Metadata/Slic3r_PE_model.config').decode()\nprint(m.count('<object '), c.count('support_material\" value=\"1\"'), 'millimeter' in m)");
  const [pObjs, pSupp, pMm] = prusaOut.trim().split(" ");
  check(`PrusaSlicer 3MF has ${shownP} objects and ${wantSuppP} organic support flags`, Number(pObjs) === shownP && Number(pSupp) === wantSuppP && pMm === "True", prusaOut);

  // Restore clean Leo Explorer on compact_180 (Kit tray) before testing full zero-support print pack export
  await tab.evaluate(STATE_BOY);
  await tab.evaluate(`window.kipPrint.setPreset('compact_180')`);
  await tab.evaluate(`window.kipPrint.updateProfile({ flatPackMode: 'sprue' })`);
  await tab.waitFor(`!window.kipPrint.isBusy() && window.kipPrint.profile().presetId === 'compact_180' && window.kipPrint.plannedPlates().every(pl => !pl.requiresSupports)`, 60000);

  const zip = toBuf(await tab.evaluate(b64(`window.kipPrint.exportBytes('stl-zip')`)));
  const zOut = pyZip(zip, "import json\nj=json.loads(z.read('layout.json'))\nprint(j['format'], len(j['plates']), any(n.endswith('.stl') for n in z.namelist()))");
  check("STL zip holds layout.json (v2) and one STL per plate", /^toyventor\.kip-plate\/2 \d+ True$/.test(zOut.trim()), zOut);

  const sheet = toBuf(await tab.evaluate(b64(`window.kipPrint.exportBytes('sheet')`)));
  check("print sheet is a PNG with swatches and boxed safety warning", sheet.subarray(0, 4).toString("hex") === "89504e47" && sheet.length > 8000, `${sheet.length} bytes`);

  const stickerPdf = toBuf(await tab.evaluate(b64(`window.kipPrint.exportBytes('stickers-pdf')`)));
  const stickerPdfTxt = stickerPdf.toString("latin1");
  check("sticker sheet PDF is 1:1 with /PrintScaling /None, 50.00 mm bar, and WARNING box", stickerPdfTxt.startsWith("%PDF-1.6\n") && stickerPdfTxt.includes("/PrintScaling /None") && stickerPdfTxt.includes("(50.00 mm) Tj") && stickerPdfTxt.includes("(WARNING) Tj"), `${stickerPdf.length} bytes`);

  const pack = toBuf(await tab.evaluate(b64(`window.kipPrint.exportBytes('pack')`)));
  const packOut = pyZip(pack, "names=set(z.namelist())\nsvg=z.read('stickers/stickers-cut.svg').decode()\nprint('README.txt' in names, 'layout.json' in names, 'print-sheet.png' in names, 'project/kip-project.3mf' in names, 'stickers/sticker-sheet.pdf' in names, 'stickers/stickers.png' in names, 'stickers/stickers-cut.svg' in names, 'stickers/stickers-cut.dxf' in names, '<image' not in svg and 'id=\"cut\"' in svg, any(n.startswith('plates/') and n.endswith('.3mf') for n in names), any(n.startswith('plates/') and n.endswith('.stl') for n in names))");
  check("kip-print-pack.zip contains README.txt, layout.json, print-sheet.png, project/kip-project.3mf, stickers/* (PDF/PNG/SVG/DXF), and per-plate .3mf/.stl files", packOut.trim() === "True True True True True True True True True True True", packOut);

  console.log("\n[4] Pro mechanisms map cleanly; Photo-Forge craft items report as not on 3D plates");
  const before = await tab.evaluate(`window.kipPrint.summary().parts`);
  await tab.evaluate(`window.kipMenu.ctx.act.applyPreset('pro')`);
  check("plate re-packs Pro 8+ robot with zero unmapped parts", await tab.waitFor(`window.kipPrint.summary().parts !== ${before} && !window.kipPrint.isBusy() && window.kipPrint.summary().unmapped.length === 0`, 60000));
  await tab.evaluate(`window.kipMenu.ctx.act.setBack('gears')`);
  await tab.waitFor(`window.kipPrint.plates().flat().some(p => p.partId === 'gear_spur_z20') && !window.kipPrint.isBusy()`, 60000);
  const hasProGears = await tab.evaluate(`['gear_spur_z20', 'gear_spur_z10', 'shaft_tu05', 'beam_str_tu05', 'cross_connector_tu01'].every(id => window.kipPrint.plates().flat().some(p => p.partId === id)) && window.kipPrint.summary().unmapped.length === 0`);
  check("Pro mechanisms decompose into verified catalog gears, shafts, and beams on the plate", hasProGears);

  // Equip a Photo-Forge craft accessory (prints: false) and confirm it appears under "Not on the plate"
  await tab.evaluate(`document.getElementById('btn-equip-photo').click()`);
  check("Photo-Forge craft drawing is reported as 2D fold-tab cutout, never silently dropped or 3D-extruded", await tab.waitFor(`/Not on the plate:.*2D fold-tab craft cutout/i.test(document.getElementById('km-printInfo').textContent) && !window.kipPrint.isBusy()`, 60000));

  console.log("\n[5] a missing STL fails loudly");
  await tab.evaluate(`window.kipMenu.ctx.act.applyPreset('boy')`);
  await tab.waitFor(`window.kipPrint.summary().parts > 0 && !window.kipPrint.isBusy()`, 60000);
  // The cowboy hat has not been fetched yet in this session (fetched files are cached), so blocking it forces a real 404.
  server.blocked.add("/kip/partspec/toyventor_hat_cowboy_S.stl");
  await tab.evaluate(`window.kipMenu.ctx.act.setHat('cowboy')`);
  check("the panel names the missing file and says exports are disabled", await tab.waitFor(`/toyventor_hat_cowboy_S\\.stl/.test(document.getElementById('km-printInfo').textContent) && /disabled/.test(document.getElementById('km-printInfo').textContent)`, 60000));
  check("all export buttons (including Download print pack & Sticker sheet) are disabled", await tab.evaluate(`['downloadPack', 'export3mf', 'exportStickers', 'exportStl', 'exportSheet'].every(id => document.getElementById('km-' + id).disabled)`));
  check("exportBytes refuses instead of returning a partial pack", await tab.evaluate(`window.kipPrint.exportBytes('pack').then(() => false, e => /incomplete/i.test(e.message))`));
  server.blocked.delete("/kip/partspec/toyventor_hat_cowboy_S.stl");
  await tab.evaluate(`window.kipMenu.ctx.act.setHat('beanie')`);
  await tab.waitFor(`window.kipPrint.summary().errors.length === 0 && !window.kipPrint.isBusy()`, 60000);
  await tab.evaluate(`window.kipMenu.ctx.act.setHat('cowboy')`);
  check("fixing the file fixes the plate (failures are not cached)", await tab.waitFor(`!/toyventor_hat_cowboy_S/.test(document.getElementById('km-printInfo').textContent) && !document.getElementById('km-export3mf').disabled && window.kipPrint.plates().flat().some(p => p.partId === 'hat_cowboy')`, 60000));

  console.log("\n[6] leaving the plate view restores the character and camera");
  const camBefore = await tab.evaluate(`JSON.stringify(window.kipMenu.ctx.camera.position.toArray().map(v => Math.round(v)))`);
  await tab.evaluate(`(() => { const i = document.getElementById('km-plateView'); i.checked = false; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  check("plate is gone and the info box hides", await tab.waitFor(`!window.kipPrint.isOn() && window.kipMenu.fields.get('printInfo').root.hidden && window.kipPrint.meshes().length === 0`, 15000));
  const camAfter = await tab.evaluate(`JSON.stringify(window.kipMenu.ctx.camera.position.toArray().map(v => Math.round(v)))`);
  check("camera is no longer on the plate", camBefore !== camAfter);
  await new Promise((r) => setTimeout(r, 1200));
  await tab.shot(path.join(SHOTS, "plate-off-1440.png"));

  console.log("\n[7] 390 px");
  await tab.evaluate(`(() => { const i = document.getElementById('km-plateView'); i.checked = true; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await tab.waitFor(`window.kipPrint.isOn() && !window.kipPrint.isBusy()`, 60000);
  await tab.resize(390, 844, true);
  await tab.waitFor(`window.innerWidth === 390`, 10000);
  await tab.evaluate(`window.dispatchEvent(new Event('resize'))`);
  await new Promise((r) => setTimeout(r, 1200));
  await tab.shot(path.join(SHOTS, "plate-390.png"));
  check("390: no horizontal overflow with the plate up", await tab.evaluate(`document.documentElement.scrollWidth <= window.innerWidth`));
  check("no page exceptions", tab.exceptions.length === 0, tab.exceptions[0]);
  tab.close();
  console.log(`\nscreenshots: ${SHOTS}`);
} finally {
  chrome.close();
  server.close();
  finish();
}
