#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Local endpoint for the Describe & build tab (contract: ../kip-describe-contract.md).
//
// The viewer is static and must never hold a key, so the model call lives here: this process reads the key and URL from the repo's .dev.vars
// (or the environment), builds the prompt from the real connector and fit-matrix data, asks the model, and answers the page with exactly the
// contract's three bodies. Nothing but loopback can reach it, the key is never logged or returned, and the model's raw text never leaves this
// process: only the whitelisted recipe fields do.
//
//   node parts/kip/viewer/tools/describe-endpoint.mjs [--model <model id>]
//
// Config, first match wins. Key: DESCRIBE_API_KEY, else MODEL_API_KEY, else any variable ending in MODEL_API_KEY. URL: DESCRIBE_API_URL, else any
// variable ending in MODEL_API_URL. Model id: --model or DESCRIBE_MODEL, default muse-spark-1.3 (the same Muse the Worker's Create and Describe routes use). Env file: --env-file,
// DESCRIBE_ENV_FILE, or the nearest .dev.vars in this directory or any parent (works from a git worktree).
// Wire format: POST {url}/responses with {model, input} and a bearer key; the reply text is read from output_text or output[].content[].text.
//
// Every model recipe is checked before the page sees it: first the browser-side rules (kip-describe-validate.js), then the REAL assembly validator in a
// persistent Python worker (tools/validate_worker.py: mates, floating parts, exact collisions). A recipe that fails goes back to the model once with the
// reasons; steps are only returned when they pass, and then they carry `validated: true` and their `poses`. The worker needs the PartSpec virtual
// environment (found by walking up for parts/partspec/.venv, or --python / DESCRIBE_PYTHON) and takes a minute or two to warm up; without it the
// endpoint still runs but marks every reply `validated: false`.
//
// Options: --port 8788  --effort low (sent as reasoning.effort; retried without it if the model rejects it; --effort none to omit)
//          --validator off (skip the worker)  --python PATH  --retries 1
const DEFAULT_MODEL = 'muse-spark-1.3';   // Muse, like worker/muse.ts; --model or DESCRIBE_MODEL overrides
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { CONTRACT, normalizeBook, rankRecipes, readEndpointReply } from '../kip-describe.js';
import { describeProblems, explainValidatorError, indexPartsData, validateRecipe } from '../kip-describe-validate.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const MODEL_BUDGET_MS = 20000;
const MAX_BODY_BYTES = 16000;
const MAX_DESCRIPTION = 300;
const MAX_ALLOWED = 60;
const RATE_PER_MINUTE = 20;
const LOOPBACK_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const LINKISH = /https?:\/\/|www\.|\b[\w-]+\.(?:com|net|org|io|co|info|xyz|gg)\b/i;

// ---------------------------------------------------------------------------------------------------------------------------------
// config

export function parseEnvFile(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || m[1].startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

function findEnvFile(explicit) {
  if (explicit) return explicit;
  for (let dir = ROOT; ; dir = path.dirname(dir)) {
    const f = path.join(dir, '.dev.vars');
    if (fs.existsSync(f)) return f;
    if (path.dirname(dir) === dir) return null;
  }
}

/** { key, url, model, effort, source } with no values printed; `missing` names what is not configured. */
export function resolveConfig({ env = process.env, args = {} } = {}) {
  const file = findEnvFile(args['env-file'] ?? env.DESCRIBE_ENV_FILE);
  const vars = { ...(file && fs.existsSync(file) ? parseEnvFile(fs.readFileSync(file, 'utf8')) : {}), ...env };
  // Exact names win over suffix matches, so MODEL_API_KEY beats an older prefixed name that happens to come first in the file.
  const pick = (exact, suffix) => exact.find((k) => vars[k]) ?? Object.keys(vars).find((k) => k.endsWith(suffix) && vars[k]);
  const keyVar = pick(['DESCRIBE_API_KEY', 'MODEL_API_KEY'], 'MODEL_API_KEY');
  const urlVar = pick(['DESCRIBE_API_URL'], 'MODEL_API_URL');
  const model = args.model ?? env.DESCRIBE_MODEL ?? DEFAULT_MODEL;
  const missing = [];
  if (!keyVar) missing.push('an API key variable (DESCRIBE_API_KEY, or a name ending in MODEL_API_KEY)');
  if (!urlVar) missing.push('an API URL variable (DESCRIBE_API_URL, or a name ending in MODEL_API_URL)');
  return {
    key: keyVar ? vars[keyVar] : undefined,
    url: urlVar ? vars[urlVar] : undefined,
    model,
    effort: (args.effort ?? env.DESCRIBE_EFFORT ?? 'low') === 'none' ? undefined : (args.effort ?? env.DESCRIBE_EFFORT ?? 'low'),
    source: { file, keyVar, urlVar },
    missing,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// prompt

let data;   // parts manifest, fit matrix pairs and the fixture file, read once
function loadData() {
  if (data) return data;
  const ps = path.join(ROOT, 'parts', 'partspec');
  const manifest = JSON.parse(fs.readFileSync(path.join(ps, 'toyventor_parts.json'), 'utf8'));
  const fit = JSON.parse(fs.readFileSync(path.join(ps, 'fit_matrix.json'), 'utf8'));
  const fixtures = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'kip-describe-recipes.json'), 'utf8'));
  const cases = JSON.parse(fs.readFileSync(path.join(ps, 'build_examples.json'), 'utf8'));   // the hand-written valid_* assemblies
  data = { parts: new Map(manifest.parts.map((p) => [p.id, p])), pairs: fit.pairs, fixtures, cases, book: normalizeBook(fixtures) };
  return data;
}

const KIND = { stud_grid: 'studs', socket_grid: 'sockets', pin: 'pin', bore_grid: 'bore' };

/** The part table and the legal-mate table for exactly the allowed parts. */
export function catalogText(allowedIds) {
  const { parts, pairs, fixtures } = loadData();
  const cat = new Map(fixtures.allowedParts.map((a) => [a.id, a]));
  const allowed = new Set(allowedIds);
  const lines = [];
  for (const id of allowedIds) {
    const p = parts.get(id);
    if (!p) continue;
    const label = cat.get(id);
    const cs = p.connectors.map((c) => {
      const g = c.grid ? ` ${c.grid.nx}x${c.grid.ny}` : '';
      return `${c.id} (${KIND[c.kind] ?? c.kind}${c.gender === 'M' ? ', male' : ', female'}${g})`;
    });
    lines.push(`- ${id}${label ? ` [${label.category}: ${label.label}]` : ''}: ${cs.join('; ')}`);
  }
  const mates = new Map();
  for (const p of pairs) {
    if (!p.as_designed || !p.in_window) continue;
    const [pa, ca] = p.male.split('.'), [pb, cb] = p.female.split('.');
    if (!allowed.has(pa) || !allowed.has(pb)) continue;
    for (const [x, y] of [[p.male, p.female], [p.female, p.male]]) {
      if (!mates.has(x)) mates.set(x, new Set());
      mates.get(x).add(y);
    }
  }
  // Nearly every small stud fits every small socket, so listing partners per connector repeats itself ~30 times. Connectors with identical
  // partner sets form a group; by symmetry a connector's partners are a union of whole groups, so one line per group says the same thing.
  const groupOf = new Map(), groups = [];
  for (const [conn, partners] of [...mates].sort(([a], [b]) => a.localeCompare(b))) {
    const key = [...partners].sort().join('|');
    if (!groupOf.has(key)) { groupOf.set(key, groups.length); groups.push({ members: [], partners: [...partners].sort() }); }
    groups[groupOf.get(key)].members.push(conn);
  }
  const idOf = new Map();
  groups.forEach((g, i) => g.members.forEach((m) => idOf.set(m, `G${i + 1}`)));
  const legal = groups.map((g, i) => {
    const mateGroups = [...new Set(g.partners.map((p) => idOf.get(p)))].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
    return `G${i + 1} = ${g.members.join(', ')}  <->  every connector in ${mateGroups.join(', ')}`;
  });
  return { parts: lines.join('\n'), legal: legal.join('\n') };
}

const DEFAULT_EXAMPLE_IDS = ['kip-cowboy', 'race-car', 'kip-driving-race-car'];

/** The fixture recipes that talk about this description most (the same ranking the offline recipe book uses), topped up with the defaults. */
export function exampleRecipes(description, count = 3) {
  const { book } = loadData();
  const ranked = rankRecipes(description, book).filter((r) => r.score > 0 || r.coverage > 0).map((r) => r.recipe);
  const chosen = ranked.slice(0, count);
  for (const id of DEFAULT_EXAMPLE_IDS) {
    if (chosen.length >= count) break;
    const r = book.recipes.find((x) => x.id === id);
    if (r && !chosen.includes(r)) chosen.push(r);
  }
  return chosen;
}

/**
 * Connections that appear in tested builds: every mate of the fixture recipes plus every edge of the hand-written valid_* assemblies, between allowed
 * parts only. One undirected pair per line, with the cell or anchor a fixture used when it had one. Gives the model evidence for which connector to use
 * (a rider's legs on the scooter's seat studs, not its top studs) that the fit matrix cannot, since there nearly everything fits everything.
 */
export function testedMatesText(allowedIds) {
  const { fixtures, cases } = loadData();
  const allowed = new Set(allowedIds);
  const pairs = new Map();   // "a.x <-> b.y" -> Set of notes
  const add = (a, b, note) => {
    const key = [a, b].sort().join(' <-> ');
    if (!pairs.has(key)) pairs.set(key, new Set());
    if (note) pairs.get(key).add(note);
  };
  for (const r of fixtures.recipes) {
    const partOf = Object.fromEntries(r.steps.map((s) => [s.id, s.part]));
    for (const s of r.steps) {
      if (!s.mate || !allowed.has(s.part) || !allowed.has(partOf[s.mate.host])) continue;
      const note = [s.mate.hostCell ? `host cell ${JSON.stringify(s.mate.hostCell)}` : '', s.mate.along ? `along ${s.mate.along}` : ''].filter(Boolean).join(', ');
      add(`${s.part}.${s.mate.conn}`, `${partOf[s.mate.host]}.${s.mate.hostConn}`, note);
    }
  }
  for (const [name, c] of Object.entries(cases)) {
    if (!name.startsWith('valid_') || !c.ok) continue;
    const partOf = Object.fromEntries(c.build.map((b) => [b.id, b.part]));
    for (const e of c.edges) {
      const [mi, mc] = e.male.split('.'), [fi, fc] = e.female.split('.');
      if (allowed.has(partOf[mi]) && allowed.has(partOf[fi])) add(`${partOf[mi]}.${mc}`, `${partOf[fi]}.${fc}`, '');
    }
  }
  return [...pairs].sort(([a], [b]) => a.localeCompare(b)).map(([k, notes]) => (notes.size ? `${k}  (${[...notes].join('; ')})` : k)).join('\n');
}

export function buildPrompt(description, allowedIds) {
  const { parts, legal } = catalogText(allowedIds);
  const examples = exampleRecipes(description)
    .map((r) => `Description: ${r.description}\n${JSON.stringify({ title: r.title, steps: r.steps })}`).join('\n\n');
  return [
    'You turn a short description of a toy into a build recipe made ONLY from the parts listed below. Reply with one JSON object and nothing else.',
    '',
    'Reply forms (exactly one):',
    '{"title": "short name", "steps": [ ...steps... ], "note": "one plain sentence"}',
    '{"clarifyingQuestion": "one short question"}   only when the description could mean very different builds',
    '{"error": "one plain sentence"}   when it cannot be built from these parts',
    '',
    'A step is {"id": "...", "part": "<part id>", "mate": {...}}. ids are letters, digits and _ (max 24) and unique. Step 1 is the base and has no "mate". Every later step has a',
    'mate: {"conn": <connector on THIS part>, "host": <id of an EARLIER step>, "hostConn": <connector on the host>}, and only connector pairs from LEGAL MATES are allowed.',
    '- Studs and sockets stack: optional "hostCell": [i, j] picks the stud cell on the host and "cell": [i, j] the cell on this part (default [0, 0], i < columns, j < rows of the connector grid); "rot" is 0 to 3 quarter turns.',
    '- Pins and bores (axle shafts, hubs, face slots): optional "along" is "start", "center" (default) or "end". Never write millimetres. An axle sits "center" in its bore; two wheels on one axle are "start" and "end".',
    'Build order is physical: base first, then what sits on it. A figure stacks legs, torso, arms, head, then face plate, hair, hat. A hat goes on the head or on hair that has studs, never on the arms. Do not use',
    'a part twice in the same place. Use only part ids from the list. Almost every stud fits almost every socket on paper, so most paper-legal choices still crash two parts into',
    'each other: build from the TESTED CONNECTIONS (and copy their cells and "along" values) and treat anything else as risky. Where a figure sits in a vehicle, use the vehicle',
    'connector the tested builds use for it and leave off any cover that would sit where the figure sits.',
    '',
    'PARTS (connector name, kind, gender, grid columns x rows):',
    parts,
    '',
    'LEGAL MATES (connectors are in groups; a connector may mate with every connector in the groups named after "<->", and with nothing else):',
    legal,
    '',
    'TESTED CONNECTIONS (used in builds that were checked and fit; prefer these):',
    testedMatesText(allowedIds),
    '',
    'EXAMPLES (tested builds closest to the description):',
    examples,
    '',
    `Description: ${JSON.stringify(description)}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------------------------------------------------------------
// model call

function outputTextOf(body) {
  if (!body || typeof body !== 'object') return '';
  if (typeof body.output_text === 'string') return body.output_text;
  let text = '';
  for (const item of Array.isArray(body.output) ? body.output : []) {
    for (const part of Array.isArray(item?.content) ? item.content : []) if (typeof part?.text === 'string') text += part.text;
  }
  return text;
}

function firstJsonObject(text) {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(text.slice(a, b + 1)); } catch { return null; }
}

/** Ask the model. Resolves to { ok: true, object } or { ok: false, status } (status is the upstream HTTP status or 'timeout' / 'network' / 'unparseable'). */
export async function askModel(prompt, cfg, fetchImpl = globalThis.fetch) {
  const base = cfg.url.replace(/\/+$/, '').replace(/\/responses$/, '');
  const started = Date.now();
  const budget = cfg.budgetMs ?? MODEL_BUDGET_MS;
  const left = () => Math.max(1, budget - (Date.now() - started));
  const attempt = (withEffort) => fetchImpl(`${base}/responses`, {
    method: 'POST',
    headers: { authorization: `Bearer ${cfg.key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: cfg.model, input: prompt, ...(withEffort && cfg.effort ? { reasoning: { effort: cfg.effort } } : {}) }),
    signal: AbortSignal.timeout(left()),
  });
  let res;
  try {
    res = await attempt(true);
    if (res.status === 400 && cfg.effort && left() > 1) res = await attempt(false);   // some models reject the reasoning parameter
  } catch (e) {
    return { ok: false, status: e && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'timeout' : 'network' };
  }
  if (!res.ok) return { ok: false, status: res.status };
  let raw;
  try { raw = await res.json(); } catch { return { ok: false, status: 'unparseable' }; }
  const object = firstJsonObject(outputTextOf(raw));
  return object ? { ok: true, object } : { ok: false, status: 'unparseable' };
}

const calm = (t) => (typeof t === 'string' && !LINKISH.test(t) ? t : undefined);

/** A model answer -> exactly one of the contract's bodies. The raw model text never goes into a reply. */
export function toContractBody(modelResult, allowedIds) {
  if (!modelResult.ok) return { error: 'The model could not be reached right now.' };
  const r = readEndpointReply(modelResult.object, allowedIds);
  if (r.kind === 'question') return { clarifyingQuestion: calm(r.question) ?? 'Can you say a bit more about what you want to build?' };
  if (r.kind === 'error') return { error: calm(r.message) ?? 'That cannot be built from these parts.' };
  if (r.kind === 'steps') {
    const out = { steps: r.steps };
    if (calm(r.title)) out.title = r.title;
    if (calm(r.note)) out.note = r.note;
    return out;
  }
  return { error: 'The model answered in a way that could not be used.' };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// the real validator (persistent python worker) and the check-and-retry loop

export function findPython(explicit, env = process.env) {
  const given = explicit ?? env.DESCRIBE_PYTHON;
  if (given) return given;
  for (let dir = ROOT; ; dir = path.dirname(dir)) {
    const f = path.join(dir, 'parts', 'partspec', '.venv', 'bin', 'python');
    if (fs.existsSync(f)) return f;
    if (path.dirname(dir) === dir) return null;
  }
}

/** Start tools/validate_worker.py. Returns { state(), validate(steps) }; state is 'warming', 'ready' or 'down'. Requests are queued: the worker is single-threaded. */
export function startValidator({ python, log = () => {}, requestTimeoutMs = 90000, spawnImpl = spawn } = {}) {
  const child = spawnImpl(python, ['-B', path.join(HERE, 'validate_worker.py')], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  let state = 'warming', nextId = 1, chain = Promise.resolve();
  const waiting = new Map();
  const failAll = (why) => { for (const [, w] of waiting) w.resolve({ ok: false, errors: [{ code: 'validator_down', detail: why, steps: [] }] }); waiting.clear(); };
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    let msg; try { msg = JSON.parse(line); } catch { return; }
    if (msg.event === 'ready') { state = 'ready'; log({ event: 'validator', state: 'ready', parts: msg.parts }); return; }
    const w = waiting.get(msg.id);
    if (w) { waiting.delete(msg.id); w.resolve(msg); }
  });
  child.on('exit', (code) => { state = 'down'; log({ event: 'validator', state: 'down', code }); failAll('the fit checker stopped'); });
  child.on('error', () => { state = 'down'; failAll('the fit checker could not start'); });
  return {
    state: () => state,
    validate(steps) {
      const run = () => new Promise((resolve) => {
        if (state !== 'ready') return resolve({ ok: false, errors: [{ code: 'validator_down', detail: `the fit checker is ${state}`, steps: [] }] });
        const id = String(nextId++);
        const timer = setTimeout(() => { waiting.delete(id); resolve({ ok: false, errors: [{ code: 'validator_timeout', detail: 'the fit checker took too long', steps: [] }] }); }, requestTimeoutMs);
        waiting.set(id, { resolve: (m) => { clearTimeout(timer); resolve(m); } });
        child.stdin.write(JSON.stringify({ id, steps }) + '\n');
      });
      const p = chain.then(run, run);
      chain = p.catch(() => {});
      return p;
    },
    stop: () => { try { child.kill(); } catch { /* already gone */ } },
  };
}

/** The base prompt again, plus the model's rejected answer and why, asking for a corrected object. */
export function retryPrompt(basePrompt, rejected, problems) {
  const list = problems.map((p) => `- ${p.message}${p.suggestion ? ` ${p.suggestion}` : ''}${p.detail ? ` [${p.detail}]` : ''}`).join('\n');
  return `${basePrompt}\n\nYour previous answer was:\n${JSON.stringify(rejected)}\n\nIt was rejected because:\n${list}\n\nFix exactly these problems (change parts, connectors, cells or the build order as needed) and reply with the corrected JSON object only.`;
}

const PARTS_DATA = indexPartsData(JSON.parse(fs.readFileSync(path.join(HERE, '..', 'kip-describe-parts.json'), 'utf8')));

/**
 * One description -> one contract body. Asks the model, checks the recipe (browser rules, then the real validator when there is one) and, on failure,
 * asks again with the reasons, up to `retries` more times inside `totalBudgetMs`. Steps are returned only when they pass.
 */
export async function answerDescription(description, allowedIds, { cfg, fetchImpl, validator, retries = 1, totalBudgetMs = 45000, log = () => {} }) {
  const started = Date.now();
  const base = buildPrompt(description, allowedIds);
  let prompt = base, last = [], attempts = 0;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const remaining = totalBudgetMs - (Date.now() - started);
    if (remaining < 3000) break;
    attempts++;
    const result = await askModel(prompt, { ...cfg, budgetMs: Math.min(remaining, cfg.budgetMs ?? MODEL_BUDGET_MS) }, fetchImpl);
    if (!result.ok) return { body: { error: 'The model could not be reached right now.' }, attempts, upstream: result.status };
    const r = readEndpointReply(result.object, allowedIds);
    if (r.kind === 'question') return { body: { clarifyingQuestion: calm(r.question) ?? 'Can you say a bit more about what you want to build?' }, attempts };
    if (r.kind === 'error') return { body: { error: calm(r.message) ?? 'That cannot be built from these parts.' }, attempts };
    if (r.kind === 'unusable') {
      last = [{ message: `The answer could not be used: ${r.why}.` }];
      prompt = retryPrompt(base, result.object, last);
      continue;
    }
    const body = { steps: r.steps };
    if (calm(r.title)) body.title = r.title;
    if (calm(r.note)) body.note = r.note;
    const client = validateRecipe(r.steps, PARTS_DATA, { allowedIds });
    let problems = client.ok ? [] : client.errors, poses;
    if (!problems.length && validator) {
      const v = await validator.validate(r.steps);
      if (v.ok) poses = v.poses;
      else if (v.errors.some((e) => e.code === 'validator_down' || e.code === 'validator_timeout')) return { body: { error: 'The fit checker is not available right now.' }, attempts, validator: v.errors[0].code };
      else problems = v.errors.map((e) => explainValidatorError(e, r.steps, PARTS_DATA));
    }
    if (!problems.length) return { body: { ...body, validated: Boolean(validator), ...(poses ? { poses } : {}) }, attempts };
    last = problems;
    log({ event: 'describe-retry', attempt, problems: problems.map((p) => p.code) });
    prompt = retryPrompt(base, { title: r.title, steps: r.steps }, problems);
  }
  const why = last.length ? `That did not fit together: ${describeProblems(last, 1)}` : 'The model took too long to find a build that fits.';
  return { body: { error: why }, attempts, rejected: last.map((p) => p.code) };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// server

export function createServer(cfg, { fetchImpl = globalThis.fetch, log = (e) => console.error(JSON.stringify(e)), validator = null, retries = 1, totalBudgetMs = 45000 } = {}) {
  const hits = [];
  const cors = (req, res) => {
    const o = req.headers.origin;
    if (o && LOOPBACK_ORIGIN.test(o)) {
      res.setHeader('access-control-allow-origin', o);
      res.setHeader('vary', 'Origin');
      res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
      res.setHeader('access-control-allow-headers', 'content-type');
    }
    return !o || LOOPBACK_ORIGIN.test(o);
  };
  const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  return http.createServer(async (req, res) => {
    const t0 = Date.now();
    if (!cors(req, res)) return send(res, 403, { error: 'origin not allowed' });
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, contract: CONTRACT, validator: validator ? validator.state() : 'off' });
    if (req.method !== 'POST' || url.pathname !== '/describe') return send(res, 404, { error: 'not found' });
    if (!(req.headers['content-type'] ?? '').includes('application/json')) return send(res, 415, { error: 'expected application/json' });
    const now = Date.now();
    while (hits.length && now - hits[0] > 60000) hits.shift();
    if (hits.push(now) > RATE_PER_MINUTE) return send(res, 429, { error: 'Slow down for a minute.' });
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > MAX_BODY_BYTES) return send(res, 413, { error: 'request too large' });
    }
    let body;
    try { body = JSON.parse(raw); } catch { return send(res, 400, { error: 'invalid JSON' }); }
    const description = typeof body?.description === 'string' ? body.description.replace(/\s+/g, ' ').trim() : '';
    const allowedIds = body?.allowedIds;
    if (body?.contract !== CONTRACT) return send(res, 400, { error: `contract must be ${CONTRACT}` });
    if (!description || description.length > MAX_DESCRIPTION) return send(res, 400, { error: `description must be 1 to ${MAX_DESCRIPTION} characters` });
    if (!Array.isArray(allowedIds) || !allowedIds.length || allowedIds.length > MAX_ALLOWED || !allowedIds.every((i) => typeof i === 'string' && /^[a-z0-9_]{1,48}$/.test(i))) {
      return send(res, 400, { error: 'allowedIds must be a short list of part ids' });
    }
    if (validator && validator.state() === 'warming') return send(res, 200, { error: 'The fit checker is still warming up (a minute or two after the endpoint starts). Try again shortly.' });
    let out;
    try { out = await answerDescription(description, allowedIds, { cfg, fetchImpl, validator, retries, totalBudgetMs, log }); } catch (e) { log({ event: 'describe', status: 'failed' }); return send(res, 500, { error: 'could not prepare the request' }); }
    const reply = out.body;
    log({ event: 'describe', reply: Object.keys(reply)[0], attempts: out.attempts, steps: reply.steps?.length, validated: reply.validated, rejected: out.rejected, upstream: out.upstream, ms: Date.now() - t0 });
    return send(res, 200, reply);
  });
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const cfg = resolveConfig({ args });
  if (cfg.missing.length) {
    console.error(`describe endpoint is not configured, missing: ${cfg.missing.join('; ')}${cfg.source.file ? `\n(read ${cfg.source.file})` : '\n(no .dev.vars found)'}`);
    process.exit(2);
  }
  const port = Number(args.port ?? 8788);
  const log = (e) => console.error(JSON.stringify(e));
  const python = args.validator === 'off' ? null : findPython(args.python);
  const validator = python ? startValidator({ python, log }) : null;
  createServer(cfg, { validator, retries: Number(args.retries ?? 1), log }).listen(port, '127.0.0.1', () => {
    console.error(`describe endpoint on http://127.0.0.1:${port}/describe  (key from ${cfg.source.keyVar}, url from ${cfg.source.urlVar}, file ${cfg.source.file ?? 'environment'}; values not shown)`);
    console.error(validator ? `fit checker: warming up with ${python} (replies wait for "validator ready")` : 'fit checker: OFF, so every reply is marked validated:false (no PartSpec python found, or --validator off)');
  });
  process.on('exit', () => validator?.stop());
}
