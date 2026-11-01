#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Self-check for the browser-side recipe validator (../kip-describe-validate.js) against the fixture recipes and a set of deliberately broken ones.
// Run:  node parts/kip/viewer/tools/check_validate.mjs      Exits 1 if anything fails. No network, no Python.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeProblems, explainValidatorError, indexPartsData, legalPair, validateRecipe } from '../kip-describe-validate.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const doc = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'kip-describe-recipes.json'), 'utf8'));
const data = indexPartsData(JSON.parse(fs.readFileSync(path.join(HERE, '..', 'kip-describe-parts.json'), 'utf8')));
const allowedIds = doc.allowedParts.map((p) => p.id);
const by = Object.fromEntries(doc.recipes.map((r) => [r.id, r]));
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { (ok ? pass++ : fail++); console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok || !detail ? '' : `\n         ${detail}`}`); };
const clone = (v) => JSON.parse(JSON.stringify(v));
const run = (steps, opts = { allowedIds }) => validateRecipe(steps, data, opts);
const codes = (r) => r.errors.map((e) => e.code);

console.log('\n[1] fixtures');
for (const r of doc.recipes) {
  const v = run(r.steps);
  check(`${r.id} passes`, v.ok, JSON.stringify(v.errors));
}
check('the data is the 4-group matrix the endpoint prompt describes', Object.keys(data.groups).length === 4);

console.log('\n[2] one broken thing at a time');
const edit = (id, fn) => { const s = clone(by[id].steps); fn(s); return s; };
const step = (s, id) => s.find((x) => x.id === id);
const cases = [
  ['no steps', [], 'no_steps'],
  ['unknown part', edit('kip-cowboy', (s) => { step(s, 'hat').part = 'hat_made_up'; }), 'unknown_part'],
  ['part not on the list', edit('kip-cowboy', (s) => { step(s, 'hat').part = 'hair_bob'; }), null],   // hair_bob IS allowed: control, must pass the list check
  ['duplicate id', edit('kip-cowboy', (s) => { step(s, 'hat').id = 'head'; }), 'duplicate_id'],
  ['bad id', edit('kip-cowboy', (s) => { step(s, 'hat').id = 'has space'; }), 'bad_field'],
  ['first step with a mate', edit('kip-cowboy', (s) => { s[0].mate = { conn: 'top_studs', host: 'torso', hostConn: 'under_sockets' }; }), 'unexpected_mate'],
  ['later step without a mate', edit('kip-cowboy', (s) => { delete step(s, 'hat').mate; }), 'missing_mate'],
  ['host that does not exist', edit('kip-cowboy', (s) => { step(s, 'hat').mate.host = 'ghost'; }), 'unknown_host'],
  ['host added later', edit('kip-cowboy', (s) => { const h = s.pop(); s.splice(1, 0, h); }), 'host_after_step'],
  ['connector missing on this part', edit('kip-cowboy', (s) => { step(s, 'hat').mate.conn = 'brim_studs'; }), 'unknown_connector'],
  ['connector missing on the host', edit('kip-cowboy', (s) => { step(s, 'hat').mate.hostConn = 'crown_studs'; }), 'unknown_connector'],
  ['studs into a bore', edit('kip-cowboy', (s) => { step(s, 'hat').mate.hostConn = 'face_slot'; }), 'kind_mismatch'],
  ['studs with studs (same gender)', edit('kip-bob-tophat', (s) => { step(s, 'hair').mate = { conn: 'top_studs', host: 'head', hostConn: 'top_studs' }; }), 'no_legal_pair'],
  ['pin into a pin (one axle onto another)', edit('race-car', (s) => { step(s, 'ax_r').mate = { conn: 'axis', host: 'ax_f', hostConn: 'axis' }; }), 'no_legal_pair'],
  ['a wheel has only a hub, not an axis', edit('race-car', (s) => { step(s, 'wl_f').mate.conn = 'axis'; }), 'unknown_connector'],
  ['along on a stack mate', edit('kip-cowboy', (s) => { step(s, 'hat').mate.along = 'center'; }), 'bad_field'],
  ['cell on an axis mate', edit('race-car', (s) => { step(s, 'wl_f').mate.cell = [0, 0]; }), 'bad_field'],
  ['host cell outside the grid', edit('kip-driving-race-car', (s) => { step(s, 'legs').mate.hostCell = [9, 0]; }), 'cell_out_of_range'],
  ['cell that is not two whole numbers', edit('kip-driving-race-car', (s) => { step(s, 'legs').mate.hostCell = [0.5, 0]; }), 'cell_out_of_range'],
  ['rot 4', edit('kip-cowboy', (s) => { step(s, 'hat').mate.rot = 4; }), 'bad_field'],
  ['along "middle"', edit('race-car', (s) => { step(s, 'wl_f').mate.along = 'middle'; }), 'bad_field'],
];
for (const [name, steps, want] of cases) {
  const v = run(steps);
  if (want === null) check(`${name}: control passes`, v.ok, JSON.stringify(v.errors));
  else check(`${name} -> ${want}`, !v.ok && codes(v).includes(want), JSON.stringify(codes(v)));
}
const notListed = run(by['kip-cowboy'].steps, { allowedIds: allowedIds.filter((i) => i !== 'hat_cowboy') });
check('a part left off the request list -> not_allowed', codes(notListed).includes('not_allowed'));
check('omitting allowedIds skips only the list check', run(by['kip-cowboy'].steps, {}).ok);

console.log('\n[3] cells and omitted cells');
{   // no curated connector omits a cell today, so test the rule on a copy of the data where the car's cell [2, 0] has no stud
  const raw = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'kip-describe-parts.json'), 'utf8'));
  check('(precondition) the real data omits no cells, so the next check is not a coincidence', Object.values(raw.parts).every((p) => Object.values(p.connectors).every((c) => !c.omit)));
  raw.parts.veh_car_chassis.connectors.top_studs.omit = [[2, 0]];
  const d2 = indexPartsData(raw);
  const withLegsAt = (cell) => validateRecipe(edit('kip-driving-race-car', (s) => { step(s, 'legs').mate.hostCell = cell; }), d2, { allowedIds });
  const r1 = withLegsAt([2, 0]);
  check('a host cell with no connector is refused and says so', codes(r1).includes('cell_out_of_range') && r1.errors[0].message.includes('no connector'), JSON.stringify(r1.errors));
  check('its neighbour is still fine', withLegsAt([1, 0]).ok);
}
check('the last real cell of a grid is accepted', run(edit('kip-driving-race-car', (s) => { step(s, 'legs').mate.hostCell = [3, 1]; })).ok);
check('one past the last column is refused', codes(run(edit('kip-driving-race-car', (s) => { step(s, 'legs').mate.hostCell = [4, 0]; }))).includes('cell_out_of_range'));

console.log('\n[4] wording');
const bad = run(edit('kip-cowboy', (s) => { step(s, 'hat').mate.hostConn = 'face_slot'; }));
const e0 = bad.errors[0];
check('messages name parts by label, not by id', e0.message.includes('cowboy hat') && e0.message.includes('kid head') && !/[a-z]+_[a-z]+/.test(e0.message), e0.message);
check('a mismatch comes with a legal alternative', typeof e0.suggestion === 'string' && /top studs/.test(e0.suggestion), e0.suggestion);
const noPair = run(edit('race-car', (s) => { step(s, 'ax_r').mate = { conn: 'axis', host: 'ax_f', hostConn: 'axis' }; })).errors[0];
check('no_legal_pair on two pins says nothing on the host takes it', noPair.code === 'no_legal_pair' && /Nothing on the .* takes/.test(noPair.suggestion ?? ''), `${noPair.code}: ${noPair.suggestion}`);
const studsStuds = run(edit('kip-bob-tophat', (s) => { step(s, 'hair').mate = { conn: 'top_studs', host: 'head', hostConn: 'top_studs' }; })).errors[0];
check('no_legal_pair on two stud sets points at the host sockets that fit', studsStuds.code === 'no_legal_pair' && /can go into the tall head's under sockets/.test(studsStuds.suggestion ?? ''), `${studsStuds.code}: ${studsStuds.suggestion}`);
const missing = run(edit('kip-cowboy', (s) => { step(s, 'hat').mate.conn = 'brim_studs'; })).errors[0];
check('an unknown connector lists the real ones', missing.suggestion.includes('under sockets'), missing.suggestion);
check('describeProblems joins and counts', describeProblems(run([]).errors.concat(run([]).errors, run([]).errors, run([]).errors), 3).includes('(and 1 more)'));
check('every error carries step, index, code and message', bad.errors.every((e) => 'step' in e && 'index' in e && e.code && e.message));
check('every problem is reported, not only the first', run(edit('kip-cowboy', (s) => { step(s, 'hat').mate.rot = 9; step(s, 'faceplate').mate.along = 'x'; })).errors.length >= 2);

console.log('\n[5] legalPair');
check('hat sockets on head studs', legalPair(data, 'hat_cowboy', 'under_sockets', 'char_head_kid', 'top_studs'));
check('and the other way round', legalPair(data, 'char_head_kid', 'top_studs', 'hat_cowboy', 'under_sockets'));
check('studs and studs are not a pair', !legalPair(data, 'char_head_kid', 'top_studs', 'hair_bob', 'top_studs'));
check('a connector that is not in the data is not a pair', !legalPair(data, 'hat_cowboy', 'nope', 'char_head_kid', 'top_studs'));

console.log('\n[6] real validator errors in plain language');
const steps = by['kip-driving-race-car'].steps;
const expl = (code, ids = ['legs', 'torso']) => explainValidatorError({ code, detail: `raw ${code}`, steps: ids }, steps, data);
check('collision names both parts by label', /seated legs.*torso.*same space/.test(expl('collision').message), expl('collision').message);
check('floating names the loose part', /seated legs.*not attached/.test(expl('floating', ['legs']).message));
for (const c of ['profile_mismatch', 'size_mismatch', 'misaligned', 'cannot_place', 'gear_mesh_distance']) {
  const m = expl(c).message;
  check(`${c} has a sentence and keeps the raw detail`, m.length > 20 && !m.includes('_') && expl(c).detail === `raw ${c}`, m);
}
check('collision without step ids still reads', explainValidatorError({ code: 'collision', detail: 'x', steps: [] }, steps, data).message.includes('same space'));

console.log(`\nvalidate check: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
