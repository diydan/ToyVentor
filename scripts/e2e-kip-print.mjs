#!/usr/bin/env node
// Kip demo print view: headless-Chrome checks for Phase 2 of docs/specs/kip-demo-implementation.md.
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
  const tab = await chrome.open(`${server.base}/kip/Kip-Demo.html?menu=side`);
  check("demo initialises", await tab.waitFor("window.__KIP_READY__ === true && !!window.kipPrint", 180000), tab.exceptions[0]);
  if (server.missing.size) console.log(`  note: ${server.missing.size} STL(s) missing on disk, stubbed`);

  console.log("\n[1] plate view for Leo Explorer");
  await tab.evaluate(STATE_BOY);
  check("Print group exists, collapsed to one toggle until the plate is on", await tab.evaluate(`(() => { const m = window.kipMenu; return m.controls.has('plateView') && m.fields.get('printInfo').root.hidden && m.fields.get('export3mf').root.hidden; })()`));
  await tab.evaluate(`(() => { const i = document.getElementById('km-plateView'); i.checked = true; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  check("plate view opens and packs", await tab.waitFor(`window.kipPrint.isOn() && window.kipPrint.plates().length > 0 && !window.kipPrint.isBusy()`, 120000));
  const info = await tab.evaluate(`document.getElementById('km-printInfo').textContent`);
  console.log(info.split("\n").map((l) => `    ${l}`).join("\n"));
  check("summary line names parts, plates, 5 mm gaps and 170 mm", /parts on \d+ plates? \(170 mm, 5 mm gaps\)/.test(info), info);

  const geo = await tab.evaluate(`(async () => {
    const K = await import('/kip/kip-print.js');
    const v = window.kipPrint; const out = { plates: v.plates().length, violations: [], parts: 0, tiers: {}, outside: 0 };
    for (const pl of v.plates()) {
      out.violations.push(...K.checkPlacement(pl, 170, 5));
      for (const p of pl) { out.parts++; out.tiers[p.tier] = (out.tiers[p.tier] || 0) + 1; const b = K.bounds(p.tri); if (b.min[2] < -1e-3 || b.min[0] < -1e-3 || b.min[1] < -1e-3 || b.max[0] > 170 + 1e-3 || b.max[1] > 170 + 1e-3) out.outside++; }
    }
    out.meshes = v.meshes().length; out.heat = v.meshes().filter(m => m.geometry.getAttribute('color')).length;
    return out; })()`);
  check("every plate is legal: >= 5 mm gaps, inside the 170 mm bound, sitting on the bed", geo.violations.length === 0 && geo.outside === 0, JSON.stringify(geo.violations.slice(0, 3)));
  check("one mesh per part on the shown plate", geo.meshes === (await tab.evaluate(`window.kipPrint.plates()[window.kipPrint.plateIndex()].length`)));
  check("torso and limbs are flagged as needing supports, with a heatmap", (geo.tiers["needs-supports"] ?? 0) > 0 && geo.heat === (await tab.evaluate(`window.kipPrint.meshes().filter(m => m.userData.tier === 'needs-supports').length`)), JSON.stringify(geo.tiers));
  check("catalog parts whose bytes match a validation report read as verified support-free", (geo.tiers["support-free"] ?? 0) > 0, JSON.stringify(geo.tiers));
  console.log(`    tiers: ${JSON.stringify(geo.tiers)}`);
  await tab.shot(path.join(SHOTS, "plate-1440.png"));

  console.log("\n[2] exports");
  const mf = toBuf(await tab.evaluate(b64(`window.kipPrint.exportBytes('3mf')`)));
  const mfOut = pyZip(mf, "m=z.read('3D/3dmodel.model').decode()\nc=z.read('Metadata/Slic3r_PE_model.config').decode()\nprint(m.count('<object '), c.count('support_material'), 'millimeter' in m)");
  const [objs, supp, mm] = mfOut.trim().split(" ");
  const shown = await tab.evaluate(`window.kipPrint.plates()[window.kipPrint.plateIndex()].length`);
  const wantSupp = await tab.evaluate(`window.kipPrint.plates()[window.kipPrint.plateIndex()].filter(p => p.tier === 'needs-supports').length`);
  check(`3MF is a valid package with one object per part (${shown})`, Number(objs) === shown && mm === "True", mfOut);
  check(`3MF flags exactly the ${wantSupp} parts that need supports`, Number(supp) === wantSupp, `${supp} flagged`);
  const zip = toBuf(await tab.evaluate(b64(`window.kipPrint.exportBytes('stl-zip')`)));
  const zOut = pyZip(zip, "print(' '.join(sorted(z.namelist())))\nimport json\nj=json.loads(z.read('layout.json'))\nprint(len(j['plates']), sum(len(p['parts']) for p in j['plates']))");
  check("STL zip holds layout.json and one STL per plate", /layout\.json plate_1\.stl/.test(zOut), zOut);
  const sheet = toBuf(await tab.evaluate(b64(`window.kipPrint.exportBytes('sheet')`)));
  check("print sheet is a PNG", sheet.subarray(0, 4).toString("hex") === "89504e47" && sheet.length > 5000, `${sheet.length} bytes`);
  await tab.evaluate(`window.kipPrint.exportBytes('sheet').then(u => { window.__sheet = URL.createObjectURL(new Blob([u], { type: 'image/png' })); })`);

  console.log("\n[3] changing the character re-packs the plate");
  const before = await tab.evaluate(`window.kipPrint.summary().parts`);
  await tab.evaluate(`window.kipMenu.ctx.act.applyPreset('pro')`); // robot, jetpack, spinner (unmapped), pro ears (unmapped)
  check("plate follows the character within a few seconds", await tab.waitFor(`window.kipPrint.summary().parts !== ${before} && !window.kipPrint.isBusy()`, 60000));
  const info2 = await tab.evaluate(`document.getElementById('km-printInfo').textContent`);
  check("options with no single STL are listed as not on the plate, never dropped silently", /Not on the plate:.*Spinner/.test(info2) && /Scanner/.test(info2), info2);

  console.log("\n[4] a missing STL fails loudly");
  await tab.evaluate(`window.kipMenu.ctx.act.applyPreset('boy')`);
  await tab.waitFor(`window.kipPrint.summary().parts > 0 && !window.kipPrint.isBusy()`, 60000);
  // The cowboy hat has not been fetched yet in this session (fetched files are cached), so blocking it forces a real 404.
  server.blocked.add("/kip/partspec/toyventor_hat_cowboy_S.stl");
  await tab.evaluate(`window.kipMenu.ctx.act.setHat('cowboy')`);
  check("the panel names the missing file and says exports are disabled", await tab.waitFor(`/toyventor_hat_cowboy_S\\.stl/.test(document.getElementById('km-printInfo').textContent) && /disabled/.test(document.getElementById('km-printInfo').textContent)`, 60000));
  check("export buttons are disabled", await tab.evaluate(`['export3mf', 'exportStl', 'exportSheet'].every(id => document.getElementById('km-' + id).disabled)`));
  check("exportBytes refuses instead of returning a partial plate", await tab.evaluate(`window.kipPrint.exportBytes('3mf').then(() => false, e => /incomplete/i.test(e.message))`));
  server.blocked.delete("/kip/partspec/toyventor_hat_cowboy_S.stl");
  await tab.evaluate(`window.kipMenu.ctx.act.setHat('beanie')`); // any change re-packs; the cowboy hat is fetched again below
  await tab.waitFor(`window.kipPrint.summary().errors.length === 0 && !window.kipPrint.isBusy()`, 60000);
  await tab.evaluate(`window.kipMenu.ctx.act.setHat('cowboy')`);
  check("fixing the file fixes the plate (failures are not cached)", await tab.waitFor(`!/toyventor_hat_cowboy_S/.test(document.getElementById('km-printInfo').textContent) && !document.getElementById('km-export3mf').disabled && window.kipPrint.plates().flat().some(p => p.partId === 'hat_cowboy')`, 60000));

  console.log("\n[5] leaving the plate view restores the character and camera");
  const camBefore = await tab.evaluate(`JSON.stringify(window.kipMenu.ctx.camera.position.toArray().map(v => Math.round(v)))`);
  await tab.evaluate(`(() => { const i = document.getElementById('km-plateView'); i.checked = false; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  check("plate is gone and the info box hides", await tab.waitFor(`!window.kipPrint.isOn() && window.kipMenu.fields.get('printInfo').root.hidden && window.kipPrint.meshes().length === 0`, 15000));
  const camAfter = await tab.evaluate(`JSON.stringify(window.kipMenu.ctx.camera.position.toArray().map(v => Math.round(v)))`);
  check("camera is no longer on the plate", camBefore !== camAfter);
  await new Promise((r) => setTimeout(r, 1200));
  await tab.shot(path.join(SHOTS, "plate-off-1440.png"));

  console.log("\n[6] 390 px");
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
