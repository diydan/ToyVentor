// usage: E2E_VIEWER=<viewer_old> node oldposes.mjs <out.json> <clipId> [<clipId>...]   (records hips + prop-mesh world pose per frame of the ORIGINAL clip)
import fs from "node:fs";
import { launchChrome, startServer } from "../lib/kip-e2e.mjs";
const [outFile, ...ids] = process.argv.slice(2);
const N = 36;
process.env.E2E_STRICT_STL = "1";
const server = await startServer();
const chrome = await launchChrome({ width: 400, height: 400 });
const res = {};
for (const id of ids) {
  const page = await chrome.open(`${server.base}/kip/Kip-Demo.html?clean=1&expr=spark`, { width: 400, height: 400 });
  await page.waitFor("window.__KIP_READY__ === true", 180000);
  await new Promise((r) => setTimeout(r, 1500));
  const prop = await page.evaluate(`window.kipClips.entries.find(c => c.id === ${JSON.stringify(id)}).prop`);
  // equip the prop through the page's own menu path
  await page.evaluate(`(async () => { const m = window.kipMenu; const sel = m.fields.get('prop').select; sel.value = ${JSON.stringify(prop)}; sel.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await new Promise((r) => setTimeout(r, 1500));
  const out = await page.evaluate(`(async () => {
    const { THREE, kip } = window.kipRig();
    const J = kip.joints;
    let mesh; J.rightHandCgripParent.traverse((o) => { if (o.isMesh) { let p = o, own = false, v = true; while (p) { if (p.visible === false) v = false; if (p.name && p.name.indexOf('slot_prop_') === 0) own = true; p = p.parent; } if (v && own) mesh = o; } });
    if (!mesh) return { error: 'no prop mesh for ' + ${JSON.stringify(prop)} };
    const c = window.kipClips.entries.find(c => c.id === ${JSON.stringify(id)});
    const frames = [];
    for (let i = 0; i < ${N}; i++) {
      window.kipClips.scrub(c.id, c.dur * i / ${N}); kip.mover.updateMatrixWorld(true);
      frames.push({ hips: J.Hips.matrixWorld.toArray(), mesh: mesh.matrixWorld.toArray() });
    }
    return { prop: ${JSON.stringify(prop)}, dur: c.dur, frames };
  })()`);
  res[id] = out;
  console.log(id, out.error || `ok ${out.frames.length} frames (prop ${out.prop})`);
  page.close();
}
fs.writeFileSync(outFile, JSON.stringify(res));
chrome.close(); server.close?.(); process.exit(0);
