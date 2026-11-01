#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Integration check of the REAL validator worker (validate_worker.py) through the endpoint's own startValidator(): every fixture must pass with exactly its
// reference poses, and known-bad recipes must be refused for the right reason. Slow (the worker builds every curated part first), so run it on demand:
//   node parts/kip/viewer/tools/check_worker.mjs [--python PATH]        Exits 1 on any failure, 2 if there is no PartSpec python.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findPython, startValidator } from './describe-endpoint.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const doc = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'kip-describe-recipes.json'), 'utf8'));
const by = Object.fromEntries(doc.recipes.map((r) => [r.id, r]));
const argPython = process.argv.includes('--python') ? process.argv[process.argv.indexOf('--python') + 1] : undefined;
const python = findPython(argPython);
if (!python) { console.error('no PartSpec python found (parts/partspec/.venv); pass --python PATH'); process.exit(2); }

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { (ok ? pass++ : fail++); console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok || !detail ? '' : `\n         ${detail}`}`); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = (v) => JSON.parse(JSON.stringify(v));
const edit = (id, fn) => { const s = clone(by[id].steps); fn(s); return s; };
const step = (s, id) => s.find((x) => x.id === id);

const t0 = Date.now();
const worker = startValidator({ python, requestTimeoutMs: 240000, log: () => {} });
while (worker.state() === 'warming') await new Promise((r) => setTimeout(r, 500));
console.log(`worker ${worker.state()} after ${((Date.now() - t0) / 1000).toFixed(0)} s (geometry of the 30 curated parts built)`);
if (worker.state() !== 'ready') process.exit(1);

console.log('\n[1] fixtures: pass, with exactly the reference poses');
const times = [];
for (const r of doc.recipes) {
  const t = Date.now();
  const v = await worker.validate(r.steps);
  times.push(Date.now() - t);
  check(`${r.id}: ok, poses match the fixture`, v.ok === true && eq(v.poses, r.reference.poses), v.ok ? 'poses differ' : JSON.stringify(v.errors));
}
console.log(`  (validation took ${Math.min(...times)} to ${Math.max(...times)} ms per recipe once warm)`);

console.log('\n[2] known-bad recipes are refused for the right reason');
const named = (v, ...ids) => v.ok === false && v.errors.some((e) => e.code === 'collision' && ids.every((i) => e.steps.includes(i)));
let v = await worker.validate(edit('kip-driving-race-car', (s) => { s.splice(2, 0, { id: 'cab', part: 'veh_cab_roof_cover', mate: { conn: 'under_sockets', host: 'car', hostConn: 'rollbar_studs' } }); }));
check('cab roof + seated Kip -> collision between cab and torso', named(v, 'cab', 'torso'), JSON.stringify(v.errors));
v = await worker.validate(edit('kip-cowboy', (s) => { step(s, 'hat').mate.host = 'arms'; }));
check('hat on the arms -> collision with the hat', v.ok === false && v.errors.some((e) => e.code === 'collision' && e.steps.includes('hat')), JSON.stringify(v.errors));
v = await worker.validate(edit('race-car', (s) => { step(s, 'wr_f').mate.along = 'start'; }));
check('both wheels at one end of the axle -> collision between them', named(v, 'wl_f', 'wr_f'), JSON.stringify(v.errors));
v = await worker.validate(edit('scooter', (s) => { for (const id of ['ax_f', 'ax_r']) { const x = step(s, id); x.part = 'shaft_tu05'; } }));
check('scooter on the long axle shaft (the live model\'s mistake) -> collision with the frame', v.ok === false && v.errors.some((e) => e.code === 'collision' && e.steps.includes('scooter')), JSON.stringify(v.errors));
v = await worker.validate(edit('kip-cowboy', (s) => { step(s, 'hat').mate.hostConn = 'face_slot'; }));
check('a recipe the browser rules would refuse is still refused here (structure)', v.ok === false && v.errors[0].code === 'structure', JSON.stringify(v.errors));

console.log('\n[3] what does the real validator say about silly-but-possible pairings? (observed, not asserted)');
const observe = async (label, steps) => { const r = await worker.validate(steps); console.log(`  ${r.ok ? 'ACCEPTED' : 'refused '} ${label}${r.ok ? '' : `: ${r.errors.map((e) => `${e.code} ${e.detail}`).join('; ')}`}`); return r; };
await observe('a hat on the car\'s exhaust studs', edit('race-car', (s) => { s.push({ id: 'hat', part: 'hat_cowboy', mate: { conn: 'under_sockets', host: 'car', hostConn: 'exhaust_studs' } }); }));
await observe('a face plate in a wheel hub', edit('race-car', (s) => { s.push({ id: 'fp', part: 'char_faceplate', mate: { conn: 'axis', host: 'wl_f', hostConn: 'hub', along: 'start' } }); }));
await observe('a spoiler on the wheel-free skateboard deck studs', edit('skateboard', (s) => { s.push({ id: 'sp', part: 'racer_spoiler', mate: { conn: 'under_sockets', host: 'deck', hostConn: 'top_studs' } }); }));

worker.stop();
console.log(`\nworker check: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
