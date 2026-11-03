import fs from "node:fs";
import { launchChrome, startServer } from "../lib/kip-e2e.mjs";
process.env.E2E_STRICT_STL = "1";
const server = await startServer();
const chrome = await launchChrome({ width: 400, height: 400 });
const page = await chrome.open(`${server.base}/kip/Kip-Demo.html?prop=spatula&clean=1&expr=spark`, { width: 400, height: 400 });
await page.waitFor("window.__KIP_READY__ === true", 180000);
await new Promise((r) => setTimeout(r, 2000));
const out = await page.evaluate(`(async () => {
  const m = await import('/kip/kip-clips.js?v=10.0');
  const { THREE, kip } = window.kipRig();
  const J = kip.joints;
  let mesh; J.rightHandCgripParent.traverse((o) => { if (o.isMesh) { let p = o, own = false, v = true; while (p) { if (p.visible === false) v = false; if (p.name && p.name.indexOf('slot_prop_') === 0) own = true; p = p.parent; } if (v && own) mesh = o; } });
  const rnd = (a, b) => a + Math.random() * (b - a);
  const cases = [];
  for (let i = 0; i < 6; i++) {
    const spec = { arm: [rnd(-110,0), rnd(-30,30), rnd(-30,0)], fore: [rnd(-120,-10), 0, 0], hand: [rnd(-60,60), rnd(-120,120), rnd(-40,40)], hips: [rnd(-5,20), rnd(-10,10), 0], head: [0,0,0], crouch: 0 };
    window.kipClips.scrub(m.probeClip(THREE, 'v' + i + Date.now(), spec), 0.5); kip.mover.updateMatrixWorld(true);
    const hq = J.RightHand.getWorldQuaternion(new THREE.Quaternion()), hp = J.RightHand.getWorldPosition(new THREE.Vector3());
    const hipsW = J.Hips.getWorldPosition(new THREE.Vector3());
    const P = (x,y,z) => new THREE.Vector3(x,y,z).applyMatrix4(mesh.matrixWorld).toArray();
    const D = (x,y,z) => new THREE.Vector3(x,y,z).transformDirection(mesh.matrixWorld).toArray();
    cases.push({ spec, hipsW: hipsW.toArray(), handQ: hq.toArray(), handP: hp.toArray(), p0: P(0,0,0), p1: P(0,-60,2.5), dH: D(0,-1,0), dN: D(0,0,1) });
  }
  // constant hand -> mesh transform (from the last pose)
  const hw = J.RightHand.matrixWorld.clone(), mw = mesh.matrixWorld.clone();
  const rel = hw.clone().invert().multiply(mw);
  mesh.geometry.computeBoundingBox(); const bb = mesh.geometry.boundingBox;
  return { cases, rel: rel.toArray(), bb: [bb.min.toArray(), bb.max.toArray()], meshScale: mesh.getWorldScale(new THREE.Vector3()).toArray() };
})()`);
fs.writeFileSync(process.argv[2], JSON.stringify(out));
console.log("saved; meshScale", out.meshScale, "bb", JSON.stringify(out.bb));
chrome.close(); server.close?.(); process.exit(0);
