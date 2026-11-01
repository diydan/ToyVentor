#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Self-check for the exploded-view maths (../kip-describe-view.js): the page's pose maths against the validator's own placed geometry, and the
// plan's promise that no two parts touch at full spread. Needs the exported STLs (public/kip/partspec/describe, tools/export_describe_stls.py), no Python.
// Run:  node parts/kip/viewer/tools/check_explode.mjs      Exits 1 if anything fails.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPROACH_MARGIN, APPROACH_MIN, DEFAULT_MARGIN, EASE, approachProblems, buildFrame, explodePlan, planBounds, planOverlaps, poseRotation, worldAxis, worldBox } from '../kip-describe-view.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const V = path.join(HERE, '..');
const STL = path.join(V, '..', '..', '..', 'public', 'kip', 'partspec', 'describe');
const doc = JSON.parse(fs.readFileSync(path.join(V, 'kip-describe-recipes.json'), 'utf8'));
const parts = JSON.parse(fs.readFileSync(path.join(V, 'kip-describe-parts.json'), 'utf8'));
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { (ok ? pass++ : fail++); console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok || !detail ? '' : `\n         ${detail}`}`); };
const clone = (v) => JSON.parse(JSON.stringify(v));

/** Bounding box of a binary STL (80-byte header, u32 count, 50-byte records of normal + 3 vertices + 2 spare bytes). */
function stlBox(file) {
  const buf = fs.readFileSync(file);
  const n = buf.readUInt32LE(80);
  if (84 + n * 50 !== buf.length) throw new Error(`${file} is not a binary STL (${n} triangles, ${buf.length} bytes)`);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < n; t++) for (let v = 0; v < 3; v++) for (let k = 0; k < 3; k++) {
    const x = buf.readFloatLE(84 + t * 50 + 12 + v * 12 + k * 4);
    if (x < lo[k]) lo[k] = x;
    if (x > hi[k]) hi[k] = x;
  }
  return [...lo, ...hi];
}

const ids = doc.allowedParts.map((p) => p.id);
console.log('\n[1] the exported STLs');
const local = {};
for (const id of ids) local[id] = stlBox(path.join(STL, `${id}.stl`));
check('all 30 curated parts have an assembly-frame STL with a sane box', ids.every((id) => local[id].every(Number.isFinite) && local[id][3] > local[id][0] && local[id][4] > local[id][1] && local[id][5] > local[id][2]));

console.log('\n[2] pose maths against the validator\'s placed geometry');
let worst = 0;
for (const r of doc.recipes) {
  let d = 0;
  for (const s of r.steps) {
    const mine = worldBox(local[s.part], r.reference.poses[s.id]), want = r.reference.boxes[s.id];
    for (let i = 0; i < 6; i++) d = Math.max(d, Math.abs(mine[i] - want[i]));
  }
  worst = Math.max(worst, d);
  check(`${r.id}: every part's box matches the validator's to ${d.toFixed(4)} mm`, d < 0.02, `${d}`);
}
const turned = doc.recipes.flatMap((r) => r.steps.map((s) => r.reference.poses[s.id])).filter((p) => p.tilt || p.rot);
check(`the fixtures exercise tilts and quarter turns (${turned.length} turned parts), not only upright ones`, turned.length > 10);
check('a pose that is off by one quarter turn is caught', (() => {
  const r = doc.recipes.find((x) => x.id === 'kip-cowboy'), s = r.steps.find((x) => x.id === 'hat');
  const wrong = { ...r.reference.poses[s.id], rot: (r.reference.poses[s.id].rot + 1) % 4, x: 3 };
  return worldBox(local[s.part], wrong).some((v, i) => Math.abs(v - r.reference.boxes[s.id][i]) > 0.5);
})());
const R = poseRotation({ rot: 1, tilt: [0, 0] });
check('poseRotation: one quarter turn about Z sends +X to +Y', Math.abs(R[1][0] - 1) < 1e-9 && Math.abs(R[0][0]) < 1e-9);
const T = poseRotation({ rot: 0, tilt: [90, 0] });
check('poseRotation: a 90 degree tilt about X sends +Y to +Z', Math.abs(T[2][1] - 1) < 1e-9);
const car = doc.recipes.find((r) => r.id === 'race-car');
const axle = worldAxis(parts, 'shaft_tu05', 'axis', car.reference.poses.ax_f);
check('an axle in the car lies along X after its pose', axle && Math.abs(axle[0]) === 1 && axle[1] === 0 && axle[2] === 0, JSON.stringify(axle));
check('a part with no axis connector has no axis', worldAxis(parts, 'hat_cowboy', 'under_sockets', { x: 0, y: 0, z: 0, rot: 0 }) === null);

console.log('\n[3] the plan: nothing touches at full spread');
const plans = {};
for (const r of doc.recipes) {
  let plan;
  try { plan = explodePlan(r.steps, r.reference.poses, local, parts); } catch (e) { check(`${r.id}: plan builds`, false, e.message); continue; }
  plans[r.id] = plan;
  const bad = planOverlaps(plan, DEFAULT_MARGIN);
  const moves = r.steps.map((s) => Math.hypot(...plan.offsets[s.id]));
  check(`${r.id}: all ${r.steps.length} parts clear each other by at least ${DEFAULT_MARGIN} mm (largest move ${Math.max(...moves).toFixed(0)} mm)`, bad.length === 0, JSON.stringify(bad));
  check(`${r.id}: every offset is finite and no move is wild`, moves.every((m) => Number.isFinite(m) && m < 300), moves.map((m) => m.toFixed(0)).join(','));
}
console.log('\n[4] the plan looks like an exploded view, not just a legal one');
const dirOf = (rid, sid) => plans[rid]?.dirs[sid];
const dir = (d) => (d ? d.join(',') : 'none');
check('the base part does not move', plans['kip-cowboy'].offsets.legs.every((v) => v === 0));
check('stacked figure parts lift straight up (torso, arms, head, hat)', ['torso', 'arms', 'head', 'hat'].every((s) => dirOf('kip-cowboy', s)?.join() === '0,0,1'), ['torso', 'arms', 'head', 'hat'].map((s) => dir(dirOf('kip-cowboy', s))).join(' | '));
check('the face plate leaves along its own axis (Y), toward the front', Math.abs(dirOf('kip-cowboy', 'faceplate')?.[1]) === 1, dir(dirOf('kip-cowboy', 'faceplate')));
check('the two wheels of an axle go opposite ways along X', (() => { const a = dirOf('race-car', 'wl_f'), b = dirOf('race-car', 'wr_f'); return a && b && Math.abs(a[0]) === 1 && a[0] === -b[0]; })(), `${dir(dirOf('race-car', 'wl_f'))} / ${dir(dirOf('race-car', 'wr_f'))}`);
check('every part of the car recipe has a direction except the chassis', plans['race-car'].order.slice(1).every((s) => plans['race-car'].dirs[s]));
const b0 = planBounds(plans['race-car'], 0), b1 = planBounds(plans['race-car'], 1);
check('full spread is larger than assembled, and both boxes are finite', b1.every(Number.isFinite) && (b1[3] - b1[0]) * (b1[4] - b1[1]) * (b1[5] - b1[2]) > 1.5 * (b0[3] - b0[0]) * (b0[4] - b0[1]) * (b0[5] - b0[2]));
{
  const o = plans['kip-driving-race-car'].offsets;
  const lift = ['legs', 'torso', 'arms', 'head'].map((s) => o[s][2]);
  check('a figure in the car rises as a stack (each part above the one below)', lift.every((z, i) => i === 0 || z > lift[i - 1]), lift.map((z) => z.toFixed(0)).join(' < '));
}
{
  // the slider is linear in t: position(t) = pose + t * offset, so halfway is halfway
  const plan = plans['scooter'];
  const half = plan.order.map((s) => plan.offsets[s].map((v) => v * 0.5));
  check('the slider is linear: t = 0.5 is exactly half the full offset', plan.order.every((s, i) => plan.offsets[s].every((v, k) => Math.abs(half[i][k] * 2 - v) < 1e-9)));
}

console.log('\n[5] the check can fail (mutations)');
{
  const r = doc.recipes.find((x) => x.id === 'kip-cowboy');
  const flat = clone(plans['kip-cowboy']);
  for (const s of flat.order) flat.exploded[s] = flat.assembled[s];
  check('no explosion at all is reported as overlapping parts', planOverlaps(flat, DEFAULT_MARGIN).length > 0);
  const squashed = clone(plans['race-car']);
  squashed.exploded.wl_f = squashed.exploded.wr_f.slice();
  check('two parts moved onto the same place are reported', planOverlaps(squashed, DEFAULT_MARGIN).some(([a, b]) => (a === 'wl_f' && b === 'wr_f')));
  let threw = false;
  try { explodePlan(r.steps, { ...r.reference.poses, hat: undefined }, local, parts); } catch { threw = true; }
  check('a missing pose is an error, not a silent skip', threw);
  threw = false;
  try { explodePlan(r.steps, r.reference.poses, { ...local, hat_cowboy: undefined }, parts); } catch { threw = true; }
  check('a missing part box is an error', threw);
  const tight = explodePlan(r.steps, r.reference.poses, local, parts, { margin: 12 });
  check('a bigger margin gives a bigger gap and still no overlaps', planOverlaps(tight, 12).length === 0 && Math.hypot(...tight.offsets.hat) > Math.hypot(...plans['kip-cowboy'].offsets.hat));
}

console.log('\n[6] the build: every part has a clear way in while the earlier parts are seated');
for (const r of doc.recipes) {
  const plan = plans[r.id];
  const bad = approachProblems(plan);
  const dist = r.steps.slice(1).map((s) => Math.hypot(...plan.approach[s.id]));
  check(`${r.id}: no part starts too close to, or slides through, a seated part (travel ${Math.min(...dist).toFixed(0)} to ${Math.max(...dist).toFixed(0)} mm)`, bad.length === 0, JSON.stringify(bad));
  check(`${r.id}: every part starts at least ${APPROACH_MIN} mm from its seat, and none further than 200`, dist.every((d) => d >= APPROACH_MIN - 1e-6 && d < 200), dist.map((d) => d.toFixed(0)).join(','));
}
{
  const o = plans['kip-cowboy'].approachDirs;
  check('figure parts come in from above (torso, arms, head, hat)', ['torso', 'arms', 'head', 'hat'].every((s) => o[s].join() === '0,0,1'), ['torso', 'arms', 'head', 'hat'].map((s) => dir(o[s])).join(' | '));
  const w = plans['race-car'].approachDirs;
  check('the wheels of the car come in from the outside, one per side', Math.abs(w.wl_f[0]) === 1 && w.wl_f[0] === -w.wr_f[0] && Math.abs(w.wl_r[0]) === 1 && w.wl_r[0] === -w.wr_r[0], `${dir(w.wl_f)} / ${dir(w.wr_f)}`);
  check('the base part has nowhere to come from', plans['race-car'].approachDirs.car === null && plans['race-car'].approach.car.every((v) => v === 0));
  const own = plans['race-car'];
  check('the approach plan is its own thing: the exploded move of a wheel (it inherits the axle\'s move) differs from its approach', own.offsets.wl_f.join() !== own.approach.wl_f.join());
}
{
  const plan = clone(plans['kip-cowboy']);
  plan.approach.hat = [0, 0, 0];
  check('MUTATION: a part that starts in place is reported as too close', approachProblems(plan).some(([id, , why]) => id === 'hat' && why === 'starts too close'));
  const car = clone(plans['race-car']);
  car.approach.wl_f = [car.assembled.wl_f[3] < 0 ? 90 : -90, 0, 0];   // straight through the chassis from the wrong side
  check('MUTATION: a part sliding in through the body is reported', approachProblems(car).some(([id]) => id === 'wl_f'), JSON.stringify(approachProblems(car)));
  const tight = explodePlan(doc.recipes[4].steps, doc.recipes[4].reference.poses, local, parts, { approachMin: 60 });
  check('a longer minimum run-up is honoured and still clear', approachProblems(tight).length === 0 && Math.hypot(...tight.approach.hat) >= 60 - 1e-6);
}

console.log('\n[7] the build timeline');
{
  const n = 7, frames = (p, o) => buildFrame(p, n, o);
  check('at the start nothing is visible', frames(0).every((f) => !f.visible));
  check('at the end everything is seated and opaque', frames(n).every((f) => f.visible && f.away === 0 && f.alpha === 1));
  let moving = 0, worstOverlap = 0, monotone = true, prev = 0, inRange = true, order = true;
  for (let k = 0; k <= 1400; k++) {
    const p = (k / 1400) * n, fs = frames(p);
    const mv = fs.filter((f) => f.visible && (f.away > 0 || f.alpha < 1)).length;
    moving = Math.max(moving, mv);
    const seated = fs.filter((f) => f.visible && f.away === 0 && f.alpha === 1).length;
    if (seated < prev) monotone = false;
    prev = seated;
    if (fs.some((f) => f.away < 0 || f.away > 1 || f.alpha < 0 || f.alpha > 1)) inRange = false;
    fs.forEach((f, i) => { if (f.visible !== (p > i)) order = false; });
    worstOverlap = Math.max(worstOverlap, fs.filter((f, i) => f.visible && i > Math.floor(p - 1e-9) && p < n).length > 1 ? 1 : 0);
  }
  check('one part seats per step: at most one part is ever in motion', moving <= 1, `${moving}`);
  check('parts appear strictly in recipe order (part i is visible exactly when progress > i)', order);
  check('the number of seated parts never goes down as the build advances', monotone);
  check('away and alpha always stay between 0 and 1', inRange);
  check('a part is seated for the last quarter of its slot (p = i + 0.8 is at rest, still the newest)', (() => { const f = frames(2.8)[2]; return f.visible && f.away === 0 && f.alpha === 1 && !frames(2.8)[3].visible; })());
  check('a part is mid-flight half way through its slot', (() => { const f = frames(2.3)[2]; return f.visible && f.away > 0 && f.away < 1 && f.alpha > 0; })());
  check('reduced motion: every part that is shown is seated and opaque, never in flight', Array.from({ length: 200 }, (_, k) => frames((k / 200) * n, { motion: false })).every((fs) => fs.every((f) => !f.visible || (f.away === 0 && f.alpha === 1))));
  check('EASE runs from 0 to 1 and never decreases', EASE(0) === 0 && EASE(1) === 1 && Array.from({ length: 100 }, (_, k) => EASE(k / 100)).every((v, k, a) => k === 0 || v >= a[k - 1]));
  check('MUTATION: a timeline that shows two parts at once would be caught by the same test', (() => {
    const fs = frames(2.3).map((f, i) => (i === 4 ? { visible: true, away: 0.5, alpha: 0.5 } : f));
    return fs.filter((f) => f.visible && (f.away > 0 || f.alpha < 1)).length === 2;
  })());
}

console.log(`\nexplode check: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
