#!/usr/bin/env node
// Dance quality gate (docs/specs/dance-party-spec.md 3.2): measure a dance in the REAL page and pass or fail it.
//
//   node scripts/kip-dance-gate.mjs                       # the dances Kip has today and every shipped baked clip with planted feet
//   node scripts/kip-dance-gate.mjs SambaDance:18.2333 my_new_dance:6.4     # id:duration-in-seconds (a Mixamo clip has no entry in kipClips, so say how long it is)
//
// Needs the machine's GPU for the 3D page: E2E_GPU=metal. Exits non-zero if any dance fails.
// Checks, per dance (the numbers are the spec's):
//   loop seam      every joint within 2 degrees between the last frame and the first
//   feet planted   a foot on the floor travels at most 3 mm (a stepping dance lifts a foot, it must not slide)
//   floor          the lowest ankle is at standing height, 12.9 mm within 3 (not sunk into the floor, not floating; a leg at full reach clamps 1 to 2 mm high)
//   knees          no knee bent backwards
//   bare hands     wrist bend 45 degrees or less
import fs from "node:fs";
import { createChecks, launchChrome, startServer } from "./lib/kip-e2e.mjs";

const { check, finish } = createChecks("dance quality gate");
// The clips scripts/mixamo-bake.mjs shipped (public/kip/mixamo/baked/index.json) join the default list when their feet are planted: a jump or a
// cheer leaves the floor on purpose, so those are not held to the floor checks.
function shippedClips() {
  try {
    const index = JSON.parse(fs.readFileSync(new URL("../public/kip/mixamo/baked/index.json", import.meta.url), "utf8"));
    return index.clips.filter((c) => c.planted).map((c) => `${c.id}:${c.dur}`);
  } catch {
    return [];
  }
}
const DEFAULT = ["dance_boogie:8", "dance_robot:8", "dance_disco:6", "dance_sway:6", "SambaDance:18.2333", ...shippedClips()];
const specs = (process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT).map((a) => { const [id, d] = a.split(":"); return { id, dur: Number(d) }; });

process.env.E2E_STRICT_STL = "1";
const server = await startServer();
const chrome = await launchChrome({ width: 400, height: 400 });
const page = await chrome.open(`${server.base}/kip/Kip-Demo.html?clean=1&expr=spark`, { width: 400, height: 400 });
await page.waitFor("window.__KIP_READY__ === true", 180000);
await new Promise((r) => setTimeout(r, 2000));

const measure = (spec) => `(async () => {
  const { THREE, kip } = window.kipRig(); const J = kip.joints; const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const N = 60, dur = ${spec.dur}, L = [], R = [], names = Object.keys(J).filter((n) => /^(Hips|Head|Left|Right)/.test(n) && n !== 'rightHandCgripParent');
  const snap = (t) => { window.kipClips.scrub(${JSON.stringify(spec.id)}, t); kip.mover.updateMatrixWorld(true); };
  snap(0); const first = Object.fromEntries(names.map((n) => [n, J[n].quaternion.clone()]));
  snap(dur * 0.9999); const last = Object.fromEntries(names.map((n) => [n, J[n].quaternion.clone()]));
  let seam = 0; for (const n of names) seam = Math.max(seam, 2 * Math.acos(Math.min(1, Math.abs(first[n].dot(last[n])))) * 180 / Math.PI);
  let bend = 0, kneeMin = 1e9;
  for (let i = 0; i < N; i++) {
    snap(dur * i / N);
    const a = J.LeftFoot.getWorldPosition(V(0, 0, 0)), b = J.RightFoot.getWorldPosition(V(0, 0, 0)); L.push([a.x, a.y, a.z]); R.push([b.x, b.y, b.z]);
    bend = Math.max(bend, Math.acos(Math.min(1, V(0, 1, 0).applyQuaternion(J.RightHand.quaternion).y)) * 180 / Math.PI);
    for (const k of ['LeftLeg', 'RightLeg']) kneeMin = Math.min(kneeMin, new THREE.Euler().setFromQuaternion(J[k].quaternion, 'ZYX').x * 180 / Math.PI);
  }
  const lo = (A) => Math.min(...A.map((p) => p[1]));
  const contactSlide = (A) => { const on = A.filter((p) => p[1] - lo(A) < 2); let s = 0; for (const p of on) for (const q of on) s = Math.max(s, Math.hypot(p[0] - q[0], p[2] - q[2])); return s; };
  return { seam, slideL: contactSlide(L), slideR: contactSlide(R), lowest: Math.min(lo(L), lo(R)), kneeMin, bend };
})()`;

for (const spec of specs) {
  const m = await page.evaluate(measure(spec));
  const f = (x, d = 1) => Number(x).toFixed(d);
  console.log(`${spec.id}: seam ${f(m.seam)} deg, floor slide L ${f(m.slideL)} R ${f(m.slideR)} mm, lowest ankle ${f(m.lowest)} mm, knee min ${f(m.kneeMin)} deg, wrist ${f(m.bend, 0)} deg`);
  check(`${spec.id}: loops (seam ${f(m.seam)} deg)`, m.seam <= 2, "the last frame must match the first within 2 degrees");
  check(`${spec.id}: feet planted (slide ${f(Math.max(m.slideL, m.slideR))} mm)`, Math.max(m.slideL, m.slideR) <= 3, "a foot on the floor must not travel more than 3 mm");
  check(`${spec.id}: lowest ankle ${f(m.lowest)} mm at standing height (12.9 +- 3)`, m.lowest >= 11.5 && m.lowest <= 15.5, "the feet must be on the floor, not sunk or floating");
  check(`${spec.id}: no knee bent backwards (min ${f(m.kneeMin)} deg)`, m.kneeMin >= -1, "a knee only bends one way");
  check(`${spec.id}: bare hands natural (wrist ${f(m.bend, 0)} deg)`, m.bend <= 45, "wrist bend 45 degrees or less");
}
chrome.close();
server.close?.();
finish();
