#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Self-check for the Describe & build matcher (../kip-describe.js) and its local endpoint (describe-endpoint.mjs).
// No network and no real key: the model is a mock server on loopback. Run:  node parts/kip/viewer/tools/check_describe.mjs
// Exits 1 if anything fails.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, matchRecipeBook, normalizeBook, rankRecipes, readEndpointReply } from '../kip-describe.js';
import { indexPartsData } from '../kip-describe-validate.js';
import { buildPrompt, createServer, exampleRecipes, findPython, parseEnvFile, resolveConfig, retryPrompt, startValidator, testedMatesText, toContractBody } from './describe-endpoint.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const book = normalizeBook(JSON.parse(fs.readFileSync(path.join(HERE, '..', 'kip-describe-recipes.json'), 'utf8')));
const byId = Object.fromEntries(book.recipes.map((r) => [r.id, r]));
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { (ok ? pass++ : fail++); console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok || !detail ? '' : `\n         ${detail}`}`); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- 1. recipe book -----------------------------------------------------------------------------------------------------------
console.log('\n[1] recipe book');
for (const r of book.recipes) {
  const m = matchRecipeBook(r.description, book);
  check(`"${r.description}" -> ${r.id}, high`, m.recipeId === r.id && m.confidence === 'high' && m.source === 'recipe-book', `${m.recipeId} ${m.confidence}`);
  check(`  steps are a copy, not the book's own array`, eq(m.steps, r.steps) && m.steps !== r.steps);
}
const paraphrases = [
  ['I want a roadster', 'race-car'], ['build me a fast sports car', 'race-car'], ['a pick-up truck', 'pickup-roof-rack'], ['truck with a roof rack', 'pickup-roof-rack'],
  ['a moped', 'scooter'], ['my motorbike', 'scooter'], ['a skate board please', 'skateboard'], ['Kip in a Cowboy Hat!', 'kip-cowboy'],
  ['kip with a top hat', 'kip-bob-tophat'], ['a park ranger', 'kip-ranger'], ['a robot', 'robot-jetpack'], ['robot with a jet pack', 'robot-jetpack'],
  ['kip in a car', 'kip-driving-race-car'], ['a cowboy in a truck', 'kip-pickup-cowboy'], ['racing', 'kip-driving-race-car'],
];
for (const [text, want] of paraphrases) {
  const m = matchRecipeBook(text, book);
  check(`"${text}" -> ${want}`, m.recipeId === want, `got ${m.recipeId} (${m.confidence})`);
}
const nothing = matchRecipeBook('a purple dragon that sings', book);
check('no match -> closest, low confidence, still has steps', nothing.source === 'closest' && nothing.confidence === 'low' && nothing.steps.length > 0);
check('filler words alone never make a recipe "close" ("a spaceship" is not a skateboard)', matchRecipeBook('a spaceship', book).recipeId === book.recipes[0].id && matchRecipeBook('make me a toy please', book).recipeId === book.recipes[0].id);
check('a content word still breaks the tie toward its recipe', matchRecipeBook('a purple skateboard thing', book).recipeId === 'skateboard');
const partial = matchRecipeBook('a robot with a jetpack and a cowboy hat', book);
check('a recipe that covers only one phrase of the request is "medium", never "high"', partial.confidence === 'medium' && partial.note.includes('only partly'), `${partial.recipeId} ${partial.confidence}`);
check('a recipe that covers the whole request is still "high"', matchRecipeBook('a robot with a jetpack', book).confidence === 'high' && matchRecipeBook('kip driving a race car', book).confidence === 'high');
check('scoring is deterministic (ties keep book order)', eq(rankRecipes('zzz', book).map((r) => r.recipe.id), book.recipes.map((r) => r.id)));

// ---- 2. describe() with a stubbed endpoint ------------------------------------------------------------------------------------
console.log('\n[2] describe() with a stub endpoint');
const reply = (body, status = 200) => async () => ({ status, ok: status === 200, json: async () => body });
const good = { steps: byId['skateboard'].steps, title: 'My board', note: 'Four wheels.' };
let seen;
const spy = async (url, init) => { seen = { url, init }; return reply(good)(); };
let r = await describe('a skateboard', { endpoint: 'http://x/describe', book, fetchImpl: spy });
check('endpoint steps win, but unvalidated means low confidence and a warning', r.source === 'model' && r.title === 'My board' && eq(r.steps, good.steps) && r.validated === false && r.confidence === 'low' && r.note.includes('not checked for fit') && !r.poses);
const goodPoses = Object.fromEntries(byId['skateboard'].steps.map((s, i) => [s.id, { x: i, y: 0, z: 0, rot: 0 }]));
r = await describe('a skateboard', { endpoint: 'http://x/describe', book, fetchImpl: reply({ ...good, validated: true, poses: goodPoses }) });
check('validated reply with poses: medium confidence, poses passed through', r.source === 'model' && r.validated === true && r.confidence === 'medium' && eq(r.poses, goodPoses) && !r.note.includes('not checked'));
r = await describe('a skateboard', { endpoint: 'http://x/describe', book, fetchImpl: reply({ ...good, validated: true }) });
check('"validated" without poses is not believed', r.validated === false && r.confidence === 'low');
r = await describe('a skateboard', { endpoint: 'http://x/describe', book, fetchImpl: reply({ ...good, validated: true, poses: { ...goodPoses, deck: { x: 'a', y: 0, z: 0, rot: 0 } } }) });
check('"validated" with bad poses is not believed', r.validated === false);
r = await describe('a skateboard', { endpoint: 'http://x/describe', book, fetchImpl: reply({ ...good, validated: true, poses: { deck: goodPoses.deck } }) });
check('poses that miss steps are not believed', r.validated === false);
r = await describe('a skateboard', { book });
check('recipe book answers are validated and carry their reference poses', r.validated === true && eq(r.poses, byId['skateboard'].reference.poses));
{ // browser-side rules run when the parts data is supplied
  const parts = indexPartsData(JSON.parse(fs.readFileSync(path.join(HERE, '..', 'kip-describe-parts.json'), 'utf8')));
  const hatOnWheel = byId['kip-cowboy'].steps.map((s) => (s.id === 'hat' ? { ...s, mate: { conn: 'under_sockets', host: 'head', hostConn: 'face_slot' } } : s));
  r = await describe('kip with a cowboy hat', { endpoint: 'http://x', book, parts, fetchImpl: reply({ steps: hatOnWheel }) });
  check('with parts data, a recipe that breaks the connector rules is rejected before it renders', r.source === 'recipe-book' && r.note.includes('did not fit together'), r.note);
  r = await describe('a skateboard', { endpoint: 'http://x', book, parts, fetchImpl: reply({ ...good, validated: true, poses: goodPoses }) });
  check('with parts data, a clean validated recipe is accepted', r.source === 'model' && r.validated === true);
}
const sent = JSON.parse(seen.init.body);
check('request follows the contract', sent.contract === 1 && sent.description === 'a skateboard' && sent.allowedIds.length === 30 && seen.init.method === 'POST' && !('key' in sent));
check('request carries no credentials', !JSON.stringify(seen.init.headers).toLowerCase().includes('authorization'));
r = await describe('what', { endpoint: 'http://x', book, fetchImpl: reply({ clarifyingQuestion: 'A car or a truck?' }) });
check('question -> recipe-book steps plus the question', r.clarifyingQuestion === 'A car or a truck?' && r.steps.length > 0 && r.note.includes('A car or a truck?'));
r = await describe('a race car', { endpoint: 'http://x', book, fetchImpl: reply({ error: 'no wheels for that' }) });
check('endpoint error -> falls back, quotes what the model said', r.source === 'recipe-book' && r.note.includes('The model said: "no wheels for that"'), r.note);
for (const [name, f, text] of [
  ['HTTP 500', reply({}, 500), 'answered 500'],
  ['network failure', async () => { throw new TypeError('fetch failed'); }, 'could not be reached'],
  ['not JSON', async () => ({ status: 200, ok: true, json: async () => { throw new SyntaxError('x'); } }), 'not JSON'],
  ['part not allowed', reply({ steps: [{ id: 'a', part: 'forbidden_part' }] }), 'not an allowed part'],
  ['host after step', reply({ steps: [{ id: 'a', part: 'veh_car_chassis' }, { id: 'b', part: 'veh_car_hood_cover', mate: { conn: 'under_sockets', host: 'c', hostConn: 'hood_studs' } }] }), 'earlier step'],
  ['unknown field', reply({ steps: [{ id: 'a', part: 'veh_car_chassis', x: 1 }] }), 'unknown field'],
  ['no steps', reply({ steps: [] }), 'no steps'],
]) {
  r = await describe('a race car', { endpoint: 'http://x', book, fetchImpl: f });
  check(`${name} -> recipe book answers`, r.source === 'recipe-book' && r.steps.length > 0 && r.note.includes(text), r.note);
}
r = await describe('a race car', { endpoint: 'http://x', book, timeoutMs: 40, fetchImpl: (u, i) => new Promise((_, rej) => i.signal.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' })))) });
check('slow endpoint is cut off and the book answers', r.source === 'recipe-book' && r.note.includes('took too long'));
r = await describe('a race car', { book });
check('no endpoint -> recipe book, no network use', r.source === 'recipe-book');
let threw = false; try { await describe('   ', { book }); } catch { threw = true; }
check('empty description throws', threw);

// ---- 3. reply shape -------------------------------------------------------------------------------------------------------------
console.log('\n[3] reply shape');
const shape = (steps) => readEndpointReply({ steps }, book.allowedIds).kind;
const ok1 = byId['race-car'].steps;
check('a fixture recipe is accepted', shape(ok1) === 'steps');
check('first step with a mate is refused', shape([{ ...ok1[1] }, ...ok1.slice(2)]) === 'unusable');
check('rot 4 is refused', shape(ok1.map((s, i) => (i === 1 ? { ...s, mate: { ...s.mate, rot: 4 } } : s))) === 'unusable');
check('along "middle" is refused', shape(ok1.map((s, i) => (i === 4 ? { ...s, mate: { ...s.mate, along: 'middle' } } : s))) === 'unusable');
check('cell [0] is refused', shape(ok1.map((s, i) => (i === 1 ? { ...s, mate: { ...s.mate, hostCell: [0] } } : s))) === 'unusable');
check('41 steps are refused', shape(Array.from({ length: 41 }, (_, i) => (i ? { id: `s${i}`, part: 'veh_car_chassis', mate: { conn: 'a', host: 's0', hostConn: 'b' } } : { id: 's0', part: 'veh_car_chassis' }))) === 'unusable');

// ---- 4. config ------------------------------------------------------------------------------------------------------------------
console.log('\n[4] config');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'describe-env-'));
const envFile = path.join(tmp, '.dev.vars');
fs.writeFileSync(envFile, '# comment\nOLD_MODEL_API_KEY=old-key\nMODEL_API_KEY="main-key"\nOLD_MODEL_API_URL=http://upstream.example/v1\nOTHER=1\n');
check('parses quotes and comments', eq(parseEnvFile(fs.readFileSync(envFile, 'utf8')), { OLD_MODEL_API_KEY: 'old-key', MODEL_API_KEY: 'main-key', OLD_MODEL_API_URL: 'http://upstream.example/v1', OTHER: '1' }));
let c = resolveConfig({ env: {}, args: { 'env-file': envFile, model: 'm1' } });
check('exact MODEL_API_KEY beats an earlier suffix match', c.key === 'main-key' && c.source.keyVar === 'MODEL_API_KEY');
check('URL comes from the suffix match', c.url === 'http://upstream.example/v1' && c.source.urlVar === 'OLD_MODEL_API_URL' && c.model === 'm1' && c.missing.length === 0);
c = resolveConfig({ env: {}, args: { 'env-file': envFile } });
check('no model id -> defaults to Muse (the same model the Worker routes use), and nothing is reported missing', c.model === 'muse-spark-1.3' && c.missing.length === 0);
c = resolveConfig({ env: { DESCRIBE_API_KEY: 'env-key', DESCRIBE_MODEL: 'm2' }, args: { 'env-file': envFile } });
check('DESCRIBE_* environment overrides the file', c.key === 'env-key' && c.model === 'm2');
c = resolveConfig({ env: {}, args: { 'env-file': path.join(tmp, 'nope'), model: 'm' } });
check('missing file -> key and URL reported missing', c.missing.length === 2);
check('effort none omits the parameter', resolveConfig({ env: {}, args: { 'env-file': envFile, model: 'm', effort: 'none' } }).effort === undefined);

// ---- 5. prompt ------------------------------------------------------------------------------------------------------------------
console.log('\n[5] prompt');
const prompt = buildPrompt('a race car', book.allowedIds);
check('prompt lists allowed parts and legal mates', prompt.includes('veh_car_chassis') && prompt.includes('LEGAL MATES') && prompt.includes('hood_studs') && /G\d+ = .*shaft_tu05\.axis/.test(prompt));
check('prompt mentions only allowed parts as parts', !prompt.includes('- big_blue_brick') && !prompt.includes('- kit_keel_base'));
check('prompt is a sane size', prompt.length > 3000 && prompt.length < 16000, `${prompt.length} chars`);
{   // the grouped table must say exactly what the fit matrix says: expand it and compare pair by pair
  const { legal } = (await import('./describe-endpoint.mjs')).catalogText(book.allowedIds);
  const groups = new Map(), want = new Set(), got = new Set();
  for (const line of legal.split('\n')) { const [, id, members, mates] = /^(G\d+) = (.*?)  <->  every connector in (.*)$/.exec(line); groups.set(id, members.split(', ')); groups.get(id).mates = mates.split(', '); }
  for (const members of groups.values()) for (const a of members) for (const g of members.mates) for (const b of groups.get(g)) got.add([a, b].sort().join('~'));
  const fm = JSON.parse(fs.readFileSync(path.join(HERE, '../../../partspec/fit_matrix.json'), 'utf8')).pairs;
  const allowed = new Set(book.allowedIds);
  for (const p of fm) if (p.as_designed && p.in_window && allowed.has(p.male.split('.')[0]) && allowed.has(p.female.split('.')[0])) want.add([p.male, p.female].sort().join('~'));
  check(`grouped legal-mates table expands to exactly the ${want.size} fit-matrix pairs`, eq([...want].sort(), [...got].sort()), `${want.size} vs ${got.size}`);
}
check('prompt carries the description', prompt.includes('"a race car"'));
check('examples follow the description: scooter words pull in a scooter recipe, and the fancy one (a top hat on a scooter) comes first', (() => { const ids = exampleRecipes('a scooter with a top hat').map((r) => r.id); return ids.slice(0, 2).some((id) => id.includes('scooter')) && ids[0] === 'fancy-scooter'; })());
check('examples for the plain words still find the plain scooter', exampleRecipes('a motor scooter').map((r) => r.id).slice(0, 2).includes('scooter'));
check('examples fall back to the defaults when nothing matches', exampleRecipes('zzz qqq').length === 3);
check('there are always three distinct examples', new Set(exampleRecipes('a robot').map((r) => r.id)).size === 3);
const tested = testedMatesText(book.allowedIds);
check('tested connections come from the hand-written valid builds too (scooter seat)', tested.split('\n').some((l) => l.startsWith('char_legs_seated.under_sockets <-> veh_scooter_frame.seat_studs') || l.startsWith('veh_scooter_frame.seat_studs <-> char_legs_seated.under_sockets')), tested.split('\n').filter((l) => l.includes('scooter')).join(' | '));
check('tested connections keep the cell a fixture used (driver legs on the car: host cell [1,0])', /veh_car_chassis\.top_studs.*host cell \[1,0\]/.test(tested.replace(/char_legs_seated\.under_sockets <-> /, '')) || /char_legs_seated\.under_sockets <-> veh_car_chassis\.top_studs  \(host cell \[1,0\]\)/.test(tested), tested.split('\n').filter((l) => l.includes('veh_car_chassis.top_studs')).join(' | '));
check('tested connections only name allowed parts', tested.split('\n').every((l) => l.split('  (')[0].split(' <-> ').every((side) => book.allowedIds.includes(side.split('.')[0]))));
check('the prompt includes the tested connections and tells the model to prefer them', prompt.includes('TESTED CONNECTIONS') && prompt.includes(tested.split('\n')[0]) && prompt.includes('prefer these'));

// ---- 6. endpoint against a mock upstream ---------------------------------------------------------------------------------------
console.log('\n[6] endpoint with a mock upstream');
const SECRET = 'test-key-9f3a7c';
const calls = [];
let mode = 'ok';
const upstream = http.createServer(async (req, res) => {
  let raw = ''; for await (const ch of req) raw += ch;
  const body = JSON.parse(raw);
  calls.push({ url: req.url, auth: req.headers.authorization, body });
  const text = (obj) => JSON.stringify({ output: [{ content: [{ type: 'output_text', text: obj }] }] });
  res.setHeader('content-type', 'application/json');
  if (mode === 'ok') return res.end(text('```json\n' + JSON.stringify({ title: 'Board', steps: byId['skateboard'].steps, note: 'Four wheels.' }) + '\n```'));
  if (mode === 'effort-400') { if (body.reasoning) { res.statusCode = 400; return res.end('{}'); } return res.end(JSON.stringify({ output_text: JSON.stringify({ steps: byId['skateboard'].steps }) })); }
  if (mode === 'question') return res.end(JSON.stringify({ output_text: '{"clarifyingQuestion":"Car or truck?"}' }));
  if (mode === 'link') return res.end(JSON.stringify({ output_text: JSON.stringify({ title: 'See www.example.com', steps: byId['skateboard'].steps, note: 'visit https://x.example now' }) }));
  if (mode === 'bad-part') return res.end(JSON.stringify({ output_text: '{"steps":[{"id":"a","part":"not_a_part"}]}' }));
  if (mode === 'garbage') return res.end(JSON.stringify({ output_text: 'I cannot help with that.' }));
  if (mode === 'fail') { res.statusCode = 503; return res.end('upstream says: ' + SECRET); }
  if (mode === 'hang') return;   // never answers
  if (mode === 'queue') return res.end(JSON.stringify({ output_text: JSON.stringify(answers.shift() ?? { error: 'queue empty' }) }));
});
const answers = [];   // queued model answers for mode 'queue'
await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
const upUrl = `http://127.0.0.1:${upstream.address().port}/v1`;
const logs = [];
const srv = createServer({ key: SECRET, url: upUrl, model: 'test-model', effort: 'low', budgetMs: 600 }, { log: (e) => logs.push(e) });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;
const post = (body, headers = {}) => fetch(`${base}/describe`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const ask = (description = 'a skateboard') => post({ contract: 1, description, allowedIds: book.allowedIds });
let res, out;

mode = 'ok'; res = await ask(); out = await res.json();
check('good answer -> contract steps, 200', res.status === 200 && eq(out.steps, byId['skateboard'].steps) && out.title === 'Board' && out.note === 'Four wheels.');
check('upstream got POST /v1/responses with bearer key, model, and effort', calls[0].url === '/v1/responses' && calls[0].auth === `Bearer ${SECRET}` && calls[0].body.model === 'test-model' && calls[0].body.reasoning?.effort === 'low');
check('upstream input carries the description and the catalog', calls[0].body.input.includes('a skateboard') && calls[0].body.input.includes('prop_skateboard_deck'));
check('the key is not in the prompt', !calls[0].body.input.includes(SECRET));
const n0 = calls.length; mode = 'effort-400'; res = await ask(); out = await res.json();
check('a 400 retries once without the reasoning parameter', calls.length === n0 + 2 && calls[n0].body.reasoning && !calls[n0 + 1].body.reasoning && Array.isArray(out.steps));
mode = 'question'; out = await (await ask('something')).json();
check('question passes through', eq(out, { clarifyingQuestion: 'Car or truck?' }));
mode = 'link'; out = await (await ask()).json();
check('links in title and note are dropped', Array.isArray(out.steps) && out.title === undefined && out.note === undefined);
mode = 'bad-part'; out = await (await ask()).json();
check('a part outside the allowed list -> error body, no steps', typeof out.error === 'string' && !out.steps);
mode = 'garbage'; out = await (await ask()).json();
check('non-JSON model text -> error body, raw text not echoed', typeof out.error === 'string' && !JSON.stringify(out).includes('cannot help'));
mode = 'fail'; res = await ask(); out = await res.json();
check('upstream 503 -> 200 with a plain error body', res.status === 200 && typeof out.error === 'string' && !JSON.stringify(out).includes('upstream says'));
mode = 'hang'; const t0 = Date.now(); out = await (await ask()).json();
check('a hung model is cut off at the budget', typeof out.error === 'string' && Date.now() - t0 < 3000, `${Date.now() - t0} ms`);

mode = 'ok';
check('GET /health', (await (await fetch(`${base}/health`)).json()).ok === true);
check('unknown path -> 404', (await fetch(`${base}/nope`)).status === 404);
check('wrong content type -> 415', (await fetch(`${base}/describe`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status === 415);
check('bad JSON -> 400', (await post('{nope')).status === 400);
check('wrong contract number -> 400', (await post({ contract: 2, description: 'x', allowedIds: ['a'] })).status === 400);
check('empty description -> 400', (await post({ contract: 1, description: ' ', allowedIds: ['a'] })).status === 400);
check('description over 300 chars -> 400', (await post({ contract: 1, description: 'x'.repeat(301), allowedIds: ['a'] })).status === 400);
check('allowedIds with a bad id -> 400', (await post({ contract: 1, description: 'x', allowedIds: ['ok', 'Bad Id!'] })).status === 400);
check('allowedIds over 60 -> 400', (await post({ contract: 1, description: 'x', allowedIds: Array.from({ length: 61 }, (_, i) => `p${i}`) })).status === 400);
check('body over the cap -> 413', (await post({ contract: 1, description: 'x', allowedIds: ['a'], pad: 'y'.repeat(17000) })).status === 413);
check('loopback origin gets CORS headers', (await post({ contract: 1, description: 'x', allowedIds: [] }, { origin: 'http://localhost:5174' })).headers.get('access-control-allow-origin') === 'http://localhost:5174');
res = await fetch(`${base}/describe`, { method: 'OPTIONS', headers: { origin: 'http://127.0.0.1:5199', 'access-control-request-method': 'POST' } });
check('preflight -> 204 with allowed headers', res.status === 204 && res.headers.get('access-control-allow-headers') === 'content-type');
res = await post({ contract: 1, description: 'x', allowedIds: book.allowedIds }, { origin: 'https://evil.example' });
check('other origins -> 403, no model call', res.status === 403 && res.headers.get('access-control-allow-origin') === null);
const before = calls.length;
let limited = 0; for (let i = 0; i < 25; i++) if ((await ask()).status === 429) limited++;
check('rate limit trips at 20 per minute', limited > 0 && calls.length - before < 25, `${limited} limited`);
check('the key never appears in a log line', !JSON.stringify(logs).includes(SECRET) && logs.length > 0);
check('log lines carry no description text', !JSON.stringify(logs).includes('skateboard'));

check('toContractBody on a failed call', eq(toContractBody({ ok: false, status: 500 }, book.allowedIds), { error: 'The model could not be reached right now.' }));

// ---- 7. validator in the loop ---------------------------------------------------------------------------------------------------
console.log('\n[7] endpoint with a validator: check, retry with the reasons, return poses');
const vseq = [];   // queued results for the fake validator
const vcalls = [];
let vstate = 'ready';
const fakeValidator = {
  state: () => vstate,
  validate: async (steps) => {
    vcalls.push(steps);
    const next = vseq.shift() ?? 'ok';
    if (next === 'ok') return { ok: true, poses: Object.fromEntries(steps.map((s, i) => [s.id, { x: i, y: 0, z: 0, rot: 0 }])), warnings: [] };
    if (next === 'collide') return { ok: false, errors: [{ code: 'collision', detail: 'ax_f and wl_f overlap by 600 mm3', steps: ['ax_f', 'wl_f'] }] };
    return { ok: false, errors: [{ code: 'validator_down', detail: 'the fit checker is down', steps: [] }] };
  },
};
const mkServer = async (opts) => { const s = createServer({ key: SECRET, url: upUrl, model: 'test-model', effort: 'low', budgetMs: 600 }, { log: () => {}, ...opts }); await new Promise((r) => s.listen(0, '127.0.0.1', r)); return s; };
const askAt = (s, d = 'a skateboard') => fetch(`http://127.0.0.1:${s.address().port}/describe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contract: 1, description: d, allowedIds: book.allowedIds }) }).then((x) => x.json());
const skate = byId['skateboard'].steps;
const srv2 = await mkServer({ validator: fakeValidator, retries: 1 });
mode = 'queue';
let c0 = calls.length, v0 = vcalls.length;
answers.push({ title: 'Board', steps: skate });
out = await askAt(srv2);
check('passing recipe -> validated:true with poses for every step', out.validated === true && eq(Object.keys(out.poses), skate.map((s) => s.id)) && eq(out.steps, skate) && calls.length === c0 + 1 && vcalls.length === v0 + 1);
c0 = calls.length; vseq.push('collide'); answers.push({ title: 'Bad', steps: skate }, { title: 'Fixed', steps: skate });
out = await askAt(srv2);
check('a collision triggers exactly one retry and the fixed recipe wins', calls.length === c0 + 2 && out.validated === true && out.title === 'Fixed');
const retried = calls[calls.length - 1].body.input;
check('the retry prompt carries the rejected answer, the plain reason and the raw detail', retried.includes('rejected because') && retried.includes('would be in the same space') && retried.includes('overlap by 600 mm3') && retried.includes('"title":"Bad"'));
c0 = calls.length; vseq.push('collide', 'collide'); answers.push({ steps: skate }, { steps: skate });
out = await askAt(srv2);
check('two failures -> an error body with the reason, no steps, 2 model calls', calls.length === c0 + 2 && !out.steps && out.error.startsWith('That did not fit together:') && out.error.includes('same space'), out.error);
check('the error is one short sentence, not a truncated paragraph', out.error.length < 200 && out.error.endsWith('.'), out.error);
const badHat = byId['kip-cowboy'].steps.map((s) => (s.id === 'hat' ? { ...s, mate: { conn: 'under_sockets', host: 'head', hostConn: 'face_slot' } } : s));
c0 = calls.length; v0 = vcalls.length; answers.push({ steps: badHat }, { steps: byId['kip-cowboy'].steps });
out = await askAt(srv2, 'kip with a cowboy hat');
check('a browser-rule failure is retried without ever calling the validator', calls.length === c0 + 2 && vcalls.length === v0 + 1 && out.validated === true && calls[calls.length - 1].body.input.includes('rejected because'));
c0 = calls.length; answers.push({ steps: [{ id: 'a', part: 'veh_car_chassis', mate: { conn: 'x', host: 'a', hostConn: 'y' } }] }, { steps: skate });
out = await askAt(srv2);
check('a reply that is not even shaped like a recipe is also retried', calls.length === c0 + 2 && out.validated === true);
c0 = calls.length; answers.push({ clarifyingQuestion: 'Car or truck?' });
out = await askAt(srv2, 'something');
check('a question is returned as is, no validation', eq(out, { clarifyingQuestion: 'Car or truck?' }) && calls.length === c0 + 1);
c0 = calls.length; vseq.push('down'); answers.push({ steps: skate });
out = await askAt(srv2);
check('a dead checker -> a plain error, not unvalidated steps', !out.steps && out.error.includes('not available') && calls.length === c0 + 1);
vstate = 'warming'; c0 = calls.length;
out = await askAt(srv2);
check('while warming up: a quick error and NO model call', out.error.includes('warming up') && calls.length === c0);
check('health reports the checker state', (await (await fetch(`http://127.0.0.1:${srv2.address().port}/health`)).json()).validator === 'warming');
vstate = 'ready';
const srv0 = await mkServer({ validator: fakeValidator, retries: 0 });
c0 = calls.length; vseq.push('collide'); answers.push({ steps: skate });
out = await askAt(srv0);
check('retries 0: one model call, then the error', calls.length === c0 + 1 && !out.steps && out.error.includes('same space'));
const srvOff = await mkServer({ validator: null });
answers.push({ steps: skate });
out = await askAt(srvOff);
check('no validator at all -> steps with validated:false and no poses', out.validated === false && !out.poses && Array.isArray(out.steps));
check('health says the checker is off', (await (await fetch(`http://127.0.0.1:${srvOff.address().port}/health`)).json()).validator === 'off');
check('retryPrompt keeps the base prompt first', retryPrompt('BASE', { a: 1 }, [{ message: 'm', suggestion: 's', detail: 'd' }]).startsWith('BASE') && retryPrompt('B', {}, [{ message: 'm', detail: 'd' }]).includes('- m [d]'));
for (const s of [srv2, srv0, srvOff]) s.close();

// the real startValidator plumbing against a tiny stand-in worker speaking the same line protocol
const { spawn } = await import('node:child_process');
const standIn = `const rl = require('readline').createInterface({ input: process.stdin }); setTimeout(() => console.log(JSON.stringify({ event: 'ready', parts: 3 })), 150);
rl.on('line', (l) => { const r = JSON.parse(l); if (r.steps.length === 99) return; if (r.steps.length === 98) process.exit(1); setTimeout(() => console.log(JSON.stringify({ id: r.id, ok: true, poses: { n: r.steps.length }, warnings: [] })), 20); });`;
const fakeSpawn = () => spawn(process.execPath, ['-e', standIn], { stdio: ['pipe', 'pipe', 'inherit'] });
const v = startValidator({ python: 'unused', spawnImpl: fakeSpawn, requestTimeoutMs: 300 });
check('worker starts in the warming state and refuses work until ready', v.state() === 'warming' && (await v.validate([{}])).errors[0].code === 'validator_down');
const until = async (cond, ms = 20000) => { const t0 = Date.now(); while (!cond() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 50)); return cond(); };   // polling, not a fixed sleep: starting a child process is slow on a busy machine
check('worker becomes ready', await until(() => v.state() === 'ready'));
const three = await Promise.all([1, 2, 3].map((n) => v.validate(Array.from({ length: n }, () => ({})))));
check('queued requests each get their own answer', three.every((x, i) => x.ok && x.poses.n === i + 1));
const slow = await v.validate(Array.from({ length: 99 }, () => ({})));
check('a request the worker never answers times out', slow.errors?.[0].code === 'validator_timeout');
const crash = await v.validate(Array.from({ length: 98 }, () => ({})));
await until(() => v.state() === 'down', 5000);
check('a worker that dies is reported and marked down', crash.errors?.[0].code === 'validator_down' && v.state() === 'down');
check('findPython honours an explicit path and DESCRIBE_PYTHON', findPython('/x/py') === '/x/py' && findPython(undefined, { DESCRIBE_PYTHON: '/y/py' }) === '/y/py');
v.stop();

srv.close(); upstream.close(); fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\ndescribe check: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
