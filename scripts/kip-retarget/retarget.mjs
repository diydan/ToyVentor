// Retarget every prop clip's right arm so the prop goes where it went before, with a natural hand.
// usage: node retarget.mjs <oldposes.json> <out.json> [G] [clipId ...]
import fs from "node:fs";
import { THREE, armFK } from "./fk.mjs";
import { KIP_CLIPS, HIP_Y } from "../../parts/kip/viewer/kip-clips.js";

const [oldFile, outFile, gArg, ...only] = process.argv.slice(2);
const G = Number(gArg ?? 2.84);              // grounder lift: Hips world y minus the clip's hips y when the feet are planted
const old = JSON.parse(fs.readFileSync(oldFile, "utf8"));
const D2R = Math.PI / 180, N = 36;
const TOUCH_FLOOR = new Set(["prop_broom", "prop_mop", "prop_scrub_brush"]);
function stlVerts(propId) {
  const b = fs.readFileSync(new URL(`../../public/kip/partspec/toyventor_${propId}_P.stl`, import.meta.url));
  const n = b.readUInt32LE(80), out = [];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { const o = 84 + i * 50 + 12 + k * 12; out.push(new THREE.Vector3(b.readFloatLE(o), b.readFloatLE(o + 4), b.readFloatLE(o + 8))); }
  return out;
}
const VERTS = {};
const FLOOR_TOOLS = new Set(["prop_broom", "prop_mop", "prop_scrub_brush", "prop_upright_vacuum"]); // world height of the prop is preserved, not body-relative
const tL = new THREE.Vector3(-0.4644239185022784, -0.07867120597488464, 0.8821118212978706); // hand-local thumb direction (idle measurement)
const PTS = [new THREE.Vector3(0, -18.75, 2.5), new THREE.Vector3(0, -60, 2.5), new THREE.Vector3(12, -30, 2.5)]; // fist, along the head, off to one side: fixes the pose
// pose-fixing points in prop (STL) coordinates; the upright vacuum cares about its FOOT lying flat on the floor far more than about where the fist is
const V = (x, y, z) => new THREE.Vector3(x, y, z);
function stlTip(propId) {
  const b = fs.readFileSync(new URL(`../../public/kip/partspec/toyventor_${propId}_P.stl`, import.meta.url));
  const n = b.readUInt32LE(80); let best = null;
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {
    const o = 84 + i * 50 + 12 + k * 12, y = b.readFloatLE(o + 4);
    if (!best || y < best.y) best = { x: b.readFloatLE(o), y, z: b.readFloatLE(o + 8) };
  }
  return V(best.x, best.y, 2.5);   // on the mid-plane, so a raised rim does not move it
}
const PT_SETS = {
  // pts: the foot on the -x side (current model); tpts: the same three foot points on the +x side (the model the old poses were recorded with)
  prop_upright_vacuum: { pts: [V(-4.60, -103.36, 2.5), V(-19.92, -116.22, 2.5), V(10.72, -90.5, 2.5), V(0, -18.75, 2.5)],
                         tpts: [V(4.60, -103.36, 2.5), V(19.92, -116.22, 2.5), V(-10.72, -90.5, 2.5), V(0, -18.75, 2.5)], w: [1, 1, 1, 0.1] },
};
const TIPS = {};
const tipOf = (id) => (TIPS[id] ??= stlTip(id));
const ptsOf = (id) => (PT_SETS[id] ? PT_SETS[id].pts : [...PTS, tipOf(id)]);
const tptsOf = (id) => (PT_SETS[id] && PT_SETS[id].tpts ? PT_SETS[id].tpts : ptsOf(id));
const wOf = (id) => (PT_SETS[id] ? PT_SETS[id].w : [1, 1, 1, 2]);
const FLIP_L = new THREE.Matrix4().makeTranslation(0, -18.75, 2.5).multiply(new THREE.Matrix4().makeRotationX(Math.PI)).multiply(new THREE.Matrix4().makeTranslation(0, 18.75, -2.5));
// ^ flipping the prop end for end in the hand = a half turn about the prop's own x axis through the fist (the finger axis, within 12 degrees)
const eq = (a) => new THREE.Quaternion().setFromEuler(new THREE.Euler(a[0] * D2R, a[1] * D2R, a[2] * D2R, "ZYX"));

// the clips' new hips pose per frame (what the planted-feet clip really does): record the pose functions
function hipsTrack(entry) {
  const out = [];
  for (let i = 0; i < N; i++) {
    const ph = (i / N) * Math.PI * 2;
    const rec = { Hips: [0, 0, 0] };
    const hp = entry.pose(ph, (nm, rx, ry, rz) => { if (nm === "Hips") rec.Hips = [rx, ry, rz]; });
    out.push({ euler: rec.Hips, pos: [hp[0], hp[1] + G, hp[2]] });
  }
  return out;
}

const LIM = { ax: [-125, 10], ay: [-50, 50], az: [-50, 6], fx: [-150, -3], hx: [-30, 30], hy: [-100, 100], hz: [-30, 30] };
const over = (v, [a, b]) => (v < a ? a - v : v > b ? v - b : 0);

function makeCost(frame, hip, targets, flip, prev, wsm, pts, wts) {
  const spec = { arm: [0, 0, 0], fore: [0, 0, 0], hand: [0, 0, 0], hips: hip.euler };
  const fl = flip ? FLIP_L : null;
  const tmp = new THREE.Vector3();
  const qHand = new THREE.Quaternion();
  return (v) => {
    spec.arm[0] = v[0]; spec.arm[1] = v[1]; spec.arm[2] = v[2]; spec.fore[0] = v[3]; spec.hand[0] = v[4]; spec.hand[1] = v[5]; spec.hand[2] = v[6];
    const f = armFK(spec, hip.pos, null);
    const mesh = fl ? f.mesh.clone().multiply(fl) : f.mesh;
    let c = 0;
    for (let k = 0; k < pts.length; k++) { tmp.copy(pts[k]).applyMatrix4(mesh); c += wts[k] * tmp.distanceToSquared(targets[k]); }
    // natural hand: small wrist bend, thumb not pointing down
    const ay = new THREE.Vector3(0, 1, 0).applyQuaternion(eq(spec.hand));
    const bend = Math.acos(Math.min(1, Math.max(-1, ay.y))) / D2R;
    c += 6 * Math.pow(Math.max(0, bend - 15), 2);
    qHand.copy(f.qhand);
    const thumbY = tL.clone().applyQuaternion(qHand).y;
    c += 4000 * Math.pow(Math.max(0, -0.2 - thumbY), 2);
    // limits
    c += 3 * (Math.pow(over(v[0], LIM.ax), 2) + Math.pow(over(v[1], LIM.ay), 2) + Math.pow(over(v[2], LIM.az), 2) + Math.pow(over(v[3], LIM.fx), 2) + Math.pow(over(v[4], LIM.hx), 2) + Math.pow(over(v[5], LIM.hy), 2) + Math.pow(over(v[6], LIM.hz), 2));
    // not through the torso (Hips-local box in front of the chest)
    const wl = f.wr.clone().sub(new THREE.Vector3(...hip.pos)).applyQuaternion(eq(hip.euler).invert());
    if (Math.abs(wl.x) < 13 && wl.z < 9 && wl.y > -8 && wl.y < 48) c += 40 * Math.pow(13 - Math.abs(wl.x), 2);
    if (prev) for (let i = 0; i < 7; i++) c += wsm * Math.pow(v[i] - prev[i], 2);
    return c;
  };
}

// Nelder-Mead
function nm(fn, x0, step, iters = 500) {
  const n = x0.length;
  let sim = [x0.slice()];
  for (let i = 0; i < n; i++) { const x = x0.slice(); x[i] += step[i]; sim.push(x); }
  let fs = sim.map(fn);
  for (let it = 0; it < iters; it++) {
    const idx = fs.map((_, i) => i).sort((a, b) => fs[a] - fs[b]);
    sim = idx.map((i) => sim[i]); fs = idx.map((i) => fs[i]);
    if (Math.abs(fs[n] - fs[0]) < 1e-6) break;
    const cen = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) cen[j] += sim[i][j] / n;
    const along = (t) => cen.map((c, j) => c + t * (sim[n][j] - c));
    const xr = along(-1), fr = fn(xr);
    if (fr < fs[0]) { const xe = along(-2), fe = fn(xe); if (fe < fr) { sim[n] = xe; fs[n] = fe; } else { sim[n] = xr; fs[n] = fr; } }
    else if (fr < fs[n - 1]) { sim[n] = xr; fs[n] = fr; }
    else {
      const xc = along(fr < fs[n] ? -0.5 : 0.5), fc = fn(xc);
      if (fc < Math.min(fr, fs[n])) { sim[n] = xc; fs[n] = fc; }
      else for (let i = 1; i <= n; i++) { sim[i] = sim[0].map((c, j) => c + 0.5 * (sim[i][j] - c)); fs[i] = fn(sim[i]); }
    }
  }
  let b = 0; for (let i = 1; i <= n; i++) if (fs[i] < fs[b]) b = i;
  return { x: sim[b], f: fs[b] };
}

const rnd = (a, b) => a + Math.random() * (b - a);
function globalSearch(cost) {
  const cand = [];
  for (let i = 0; i < 6000; i++) {
    const v = [rnd(...LIM.ax), rnd(...LIM.ay), rnd(...LIM.az), rnd(...LIM.fx), rnd(-25, 25), rnd(...LIM.hy), rnd(-25, 25)];
    cand.push({ v, f: cost(v) });
  }
  cand.sort((a, b) => a.f - b.f);
  let best = null;
  for (const c of cand.slice(0, 12)) { const r = nm(cost, c.v, [12, 12, 8, 12, 8, 20, 8], 600); if (!best || r.f < best.f) best = r; }
  return best;
}


// Designed targets (hips-relative mesh pose per frame) for a clip whose original pose has no natural-hand equivalent: the screwdriver pointed along the forearm
// (impossible: the shaft always crosses the fingers). Here it points forward and a little down at chest height and rolls about its own axis, screwing.
const GFIST = new THREE.Vector3(0, -18.75, 2.5);
function designedRel(id, i) {
  if (id === "prop_screwdriver") {
    const ph = (i / N) * Math.PI * 2;
    const H = new THREE.Vector3(0.12, -0.32, 1).normalize();
    let up = new THREE.Vector3(0, 1, 0); up.sub(H.clone().multiplyScalar(up.dot(H))).normalize();          // blade normal starts "up"
    const roll = new THREE.Quaternion().setFromAxisAngle(H, 1.05 * Math.sin(2 * ph));                          // +-60 degrees, two turns a loop
    const Nn = up.applyQuaternion(roll);
    const yv = H.clone().negate();                                                                           // STL -y is the head
    const xv = new THREE.Vector3().crossVectors(yv, Nn);
    const R = new THREE.Matrix4().makeBasis(xv, yv, Nn);
    const pf = new THREE.Vector3(-13, 30, 17);
    return new THREE.Matrix4().makeTranslation(pf.x, pf.y, pf.z).multiply(R).multiply(new THREE.Matrix4().makeTranslation(-GFIST.x, -GFIST.y, -GFIST.z));
  }
  return null;
}

function solveClip(id, flip) {
  const data = old[id];
  const entry = KIP_CLIPS.find((c) => c.id === id);
  const hips = hipsTrack(entry);
  const rows = [];
  let prev = null;
  const floor = FLOOR_TOOLS.has(id);
  for (let i = 0; i < N; i++) {
    const fr = data.frames[i];
    const hOld = new THREE.Matrix4().fromArray(fr.hips), mOld = new THREE.Matrix4().fromArray(fr.mesh);
    const hq = eq(hips[i].euler);
    const hNew = new THREE.Matrix4().compose(new THREE.Vector3(...hips[i].pos), hq, new THREE.Vector3(1, 1, 1));
    const rel = designedRel(id, i) ?? hOld.clone().invert().multiply(mOld);   // the old prop pose in the old hips frame (or a designed one)
    const tM = hNew.clone().multiply(rel);
    let dy = floor ? new THREE.Vector3().setFromMatrixPosition(hOld).y - hips[i].pos[1] : 0;
    if (id === "prop_upright_vacuum") dy += 2.5;                                 // the foot lies flat: measured 1 to 3 mm too low without this
    if (TOUCH_FLOOR.has(id)) {                                                  // lowest vertex of the target pose -> 1 mm above the floor
      const vs = (VERTS[id] ??= stlVerts(id)); let lo = 1e9;
      const tm2 = tM.clone();
      for (let q = 0; q < vs.length; q += 7) lo = Math.min(lo, vs[q].clone().applyMatrix4(tm2).y);
      dy = 1.0 - lo;
    }
    const targets = tptsOf(id).map((p) => p.clone().applyMatrix4(tM).add(new THREE.Vector3(0, dy, 0)));
    const cost = makeCost(fr, hips[i], targets, flip, prev, i === 0 ? 0 : 0.02, ptsOf(id), wOf(id));
    let r;
    if (!prev) r = globalSearch(cost);
    else { r = nm(cost, prev, [4, 4, 3, 4, 3, 6, 3], 500); const r2 = nm(cost, r.x, [2, 2, 2, 2, 2, 3, 2], 300); if (r2.f < r.f) r = r2; }
    prev = r.x;
    rows.push({ v: r.x, f: r.f, targets, hip: hips[i] });
  }
  // wrap-up: close the loop by blending the last frames toward the first (the loop must be seamless)
  return rows;
}

function stats(id, rows, flip) {
  const PTSX = ptsOf(id);
  let maxPos = 0, maxBend = 0, minThumb = 9, worstLim = 0; const per = PTSX.map(() => 0);
  const spec = (r) => ({ arm: r.v.slice(0, 3), fore: [r.v[3], 0, 0], hand: [r.v[4], r.v[5], r.v[6]], hips: r.hip.euler });
  for (const r of rows) {
    const s = spec(r); const f = armFK(s, r.hip.pos, null);
    const mesh = flip ? f.mesh.clone().multiply(FLIP_L) : f.mesh;
    for (let k = 0; k < PTSX.length; k++) { const e = PTSX[k].clone().applyMatrix4(mesh).distanceTo(r.targets[k]); maxPos = Math.max(maxPos, e); per[k] = Math.max(per[k], e); }
    const ay = new THREE.Vector3(0, 1, 0).applyQuaternion(eq(s.hand)); maxBend = Math.max(maxBend, Math.acos(Math.min(1, ay.y)) / D2R);
    minThumb = Math.min(minThumb, tL.clone().applyQuaternion(f.qhand).y);
  }
  let jump = 0; for (let i = 0; i < rows.length; i++) { const a = rows[i].v, b = rows[(i + 1) % rows.length].v; for (let k = 0; k < 7; k++) jump = Math.max(jump, Math.abs(a[k] - b[k])); }
  return { perPointErrMm: per.map((x) => +x.toFixed(1)), maxPosErrMm: +maxPos.toFixed(1), maxWristBend: +maxBend.toFixed(0), minThumbY: +minThumb.toFixed(2), maxStepDeg: +jump.toFixed(0), cost: +rows.reduce((s, r) => s + r.f, 0).toFixed(0) };
}

const result = {};
for (const id of Object.keys(old)) {
  if (only.length && !only.includes(id)) continue;
  const t0 = Date.now();
  let best = null;
  for (const flip of [false, true]) {
    const rows = solveClip(id, flip);
    const st = stats(id, rows, flip);
    console.log(id.padEnd(22), flip ? "flip " : "plain", JSON.stringify(st));
    if (!best || st.cost < best.st.cost) best = { flip, rows, st };
  }
  result[id] = { flip: best.flip, stats: best.st, arm: best.rows.map((r) => r.v.slice(0, 3).map((x) => +x.toFixed(1))), fore: best.rows.map((r) => +r.v[3].toFixed(1)), hand: best.rows.map((r) => r.v.slice(4, 7).map((x) => +x.toFixed(1))) };
  console.log(" ->", id, "chosen:", best.flip ? "flipped" : "plain", `(${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}
fs.writeFileSync(outFile, JSON.stringify(result));
