// Describe & build: the matcher. Turns a short description into a recipe (see kip-describe-contract.md).
//
// Order of attempts: (1) the user's configured endpoint, if any; (2) the baked-in recipe book (keyword match against the fixture recipes);
// (3) the closest recipe. It always resolves with steps and a plain-language note, and it never throws on a bad endpoint: an unreachable, slow
// or nonsensical reply just means the recipe book answers instead. The module is provider-agnostic: it knows the contract, not who sits behind the
// URL, and it holds no key. A key, if the endpoint needs one, belongs to the endpoint (see tools/describe-endpoint.mjs), never to this page.
//
// This module only shapes and matches. Whether a recipe's mates are legal and its parts do not collide is the validator's job (next step); the
// shape check here exists so that garbage from an endpoint is dropped before it gets that far.

import { describeProblems, validateRecipe } from './kip-describe-validate.js';

export const CONTRACT = 1;
const ID_RE = /^[A-Za-z0-9_]{1,24}$/;
const ANCHORS = ['start', 'center', 'end'];
const MAX_STEPS = 40;
// The endpoint may ask the model twice and run the fit checker between; its own budget is 45 s.
const DEFAULT_TIMEOUT_MS = 50000;

// ---------------------------------------------------------------------------------------------------------------------------------
// Recipe book

const stem = (w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);

/** Lower-case words, punctuation dropped, light plural stemming: "Top Hats!" -> ["top", "hat"]. */
export function words(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map(stem);
}

const phrase = (text) => ` ${words(text).join(' ')} `;

// Filler that says nothing about what to build. Only the closest-recipe fallback ignores it ("a spaceship" must not resemble "a skateboard" because of "a").
const FILLER = new Set(['a', 'an', 'the', 'with', 'and', 'of', 'in', 'on', 'for', 'to', 'my', 'me', 'i', 'it', 'is', 'please', 'want', 'build', 'make', 'create', 'some', 'toy']);
const contentWords = (text) => words(text).filter((w) => !FILLER.has(w));

/** Fetch the fixture file that doubles as the recipe book. */
export async function loadRecipeBook(url = '/kip/kip-describe-recipes.json', fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`recipe book ${url} returned ${res.status}`);
  return normalizeBook(await res.json());
}

export function normalizeBook(doc) {
  if (!doc || !Array.isArray(doc.recipes) || !Array.isArray(doc.allowedParts)) throw new Error('recipe book has no recipes or allowedParts');
  return { allowedIds: doc.allowedParts.map((p) => p.id), recipes: doc.recipes };
}

/**
 * Score every recipe against the description. A keyword scores its word count when it appears as a whole phrase ("race car" = 2, "kip" = 1);
 * saying a recipe's own description scores 10. Returns the ranked list, best first (ties keep book order).
 */
export function rankRecipes(description, book) {
  const text = phrase(description);
  const textSet = new Set(contentWords(description));
  const ranked = book.recipes.map((recipe, order) => {
    const hits = (recipe.keywords ?? []).filter((k) => phrase(k).trim() && text.includes(phrase(k)));
    const exact = phrase(recipe.description) === text;
    const score = (exact ? 10 : 0) + hits.reduce((n, k) => n + words(k).length, 0);
    const own = new Set(contentWords(`${recipe.description} ${(recipe.keywords ?? []).join(' ')}`));
    const shared = [...textSet].filter((w) => own.has(w)).length;
    const overlap = shared / (new Set([...textSet, ...own]).size || 1);
    const coverage = textSet.size ? shared / textSet.size : 0;   // how much of what was asked for the recipe talks about
    return { recipe, order, score, hits, exact, overlap, coverage };
  });
  return ranked.sort((a, b) => b.score - a.score || b.overlap - a.overlap || a.order - b.order);
}

/**
 * Recipe-book answer: { steps, title, source: 'recipe-book' | 'closest', confidence, note, recipeId, validated, poses }. Never empty while the book has recipes.
 * Every book recipe was run through the real validator when the book was built, so `validated` is true and `poses` are its reference poses.
 */
export function matchRecipeBook(description, book) {
  const ranked = rankRecipes(description, book);
  const best = ranked[0];
  if (!best) throw new Error('the recipe book is empty');
  const { recipe } = best;
  const poses = recipe.reference?.poses;
  const base = { steps: clone(recipe.steps), title: recipe.title, recipeId: recipe.id, validated: Boolean(poses), ...(poses ? { poses: clone(poses) } : {}) };
  // "high" means the sample build talks about most of what was asked, not just one phrase of it.
  if (best.exact || (best.score >= 3 && best.coverage >= 0.6)) {
    return { ...base, source: 'recipe-book', confidence: 'high', note: `Matched the sample build "${recipe.title}"${best.hits.length ? ` (${best.hits.join(', ')})` : ''}.` };
  }
  if (best.score >= 1) {
    return { ...base, source: 'recipe-book', confidence: 'medium', note: `Closest keyword match is the sample build "${recipe.title}" (${best.hits.join(', ')}); it only partly matches what you described.` };
  }
  return { ...base, source: 'closest', confidence: 'low', note: `Nothing in the sample builds matches that description, so this is "${recipe.title}" as a starting point.` };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Endpoint reply shape

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => JSON.parse(JSON.stringify(v));
const cellOk = (c) => Array.isArray(c) && c.length === 2 && c.every((n) => Number.isInteger(n) && n >= 0 && n < 64);

/** Why a steps array is not usable, or null when its shape is fine. Legality (mates, collisions) is NOT checked here. */
export function stepsShapeProblem(steps, allowedIds) {
  if (!Array.isArray(steps) || steps.length < 1) return 'no steps';
  if (steps.length > MAX_STEPS) return `more than ${MAX_STEPS} steps`;
  const seen = new Set();
  for (const [n, s] of steps.entries()) {
    const where = `step ${n}`;
    if (!isObj(s)) return `${where} is not an object`;
    if (typeof s.id !== 'string' || !ID_RE.test(s.id)) return `${where} has a bad id`;
    if (seen.has(s.id)) return `${where} repeats the id ${s.id}`;
    if (typeof s.part !== 'string' || !s.part) return `${where} has no part`;
    if (allowedIds && !allowedIds.includes(s.part)) return `${where} uses ${s.part}, which is not an allowed part`;
    if ((n === 0) !== (s.mate === undefined)) return n === 0 ? 'the first step must not have a mate' : `${where} has no mate`;
    if (s.mate !== undefined) {
      const m = s.mate;
      if (!isObj(m)) return `${where} mate is not an object`;
      for (const k of ['conn', 'host', 'hostConn']) if (typeof m[k] !== 'string' || !m[k]) return `${where} mate needs ${k}`;
      if (!seen.has(m.host)) return `${where} mate host ${m.host} is not an earlier step`;
      if (m.cell !== undefined && !cellOk(m.cell)) return `${where} mate cell is not [i, j]`;
      if (m.hostCell !== undefined && !cellOk(m.hostCell)) return `${where} mate hostCell is not [i, j]`;
      if (m.rot !== undefined && !(Number.isInteger(m.rot) && m.rot >= 0 && m.rot <= 3)) return `${where} mate rot must be 0 to 3`;
      if (m.along !== undefined && !(typeof m.along === 'number' && Number.isFinite(m.along)) && !ANCHORS.includes(m.along)) return `${where} mate along must be a number or ${ANCHORS.join('/')}`;
      const extra = Object.keys(m).filter((k) => !['conn', 'host', 'hostConn', 'cell', 'hostCell', 'rot', 'along'].includes(k));
      if (extra.length) return `${where} mate has unknown field(s) ${extra.join(', ')}`;
    }
    const extra = Object.keys(s).filter((k) => !['id', 'part', 'mate'].includes(k));
    if (extra.length) return `${where} has unknown field(s) ${extra.join(', ')}`;
    seen.add(s.id);
  }
  return null;
}

const oneLine = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** Why a poses object is not usable for these steps, or null. Poses are mm in the validator's frame, rot in quarter turns, optional tilt in degrees. */
export function posesProblem(poses, steps) {
  if (!isObj(poses)) return 'poses is not an object';
  const ids = steps.map((s) => s.id);
  if (Object.keys(poses).length !== ids.length || !ids.every((id) => isObj(poses[id]))) return 'poses do not cover exactly the steps';
  for (const id of ids) {
    const p = poses[id];
    if (!['x', 'y', 'z'].every((k) => Number.isFinite(p[k]))) return `pose of ${id} needs numeric x, y, z`;
    if (!(Number.isInteger(p.rot) && p.rot >= 0 && p.rot <= 3)) return `pose of ${id} needs rot 0 to 3`;
    if (p.tilt !== undefined && !(Array.isArray(p.tilt) && p.tilt.length === 2 && p.tilt.every(Number.isFinite))) return `pose of ${id} has a bad tilt`;
  }
  return null;
}

/** Classify an endpoint reply: { kind: 'steps' | 'question' | 'error', ... } or { kind: 'unusable', why }. */
export function readEndpointReply(body, allowedIds) {
  if (!isObj(body)) return { kind: 'unusable', why: 'the reply was not a JSON object' };
  if (typeof body.clarifyingQuestion === 'string' && oneLine(body.clarifyingQuestion, 200)) {
    return { kind: 'question', question: oneLine(body.clarifyingQuestion, 200) };
  }
  if (typeof body.error === 'string') return { kind: 'error', message: oneLine(body.error, 300) || 'the endpoint reported an error' };
  const problem = stepsShapeProblem(body.steps, allowedIds);
  if (problem) return { kind: 'unusable', why: problem };
  // `validated: true` is a claim by the endpoint that the real validator passed these steps; it only counts together with usable poses.
  const poses = body.validated === true && body.poses !== undefined && !posesProblem(body.poses, body.steps) ? clone(body.poses) : undefined;
  return { kind: 'steps', steps: clone(body.steps), title: oneLine(body.title, 60) || undefined, note: oneLine(body.note, 200) || undefined, validated: Boolean(poses), ...(poses ? { poses } : {}) };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The matcher

async function askEndpoint(endpoint, description, allowedIds, fetchImpl, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contract: CONTRACT, description, allowedIds }),
      signal: ctl.signal,
    });
    if (res.status !== 200) return { kind: 'down', why: `the endpoint answered ${res.status}` };
    let body;
    try { body = await res.json(); } catch { return { kind: 'unusable', why: 'the reply was not JSON' }; }
    return readEndpointReply(body, allowedIds);
  } catch (e) {
    return { kind: 'down', why: e && e.name === 'AbortError' ? 'the endpoint took too long' : 'the endpoint could not be reached' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Turn a description into a recipe. Resolves to
 *   { steps, title, source: 'model' | 'recipe-book' | 'closest', confidence: 'high' | 'medium' | 'low', note, validated, poses?, clarifyingQuestion? }
 * `steps` is never empty. `validated` says the real validator passed the steps (then `poses` are their poses, ready to draw): always true for the
 * recipe book, true for a model recipe only when the endpoint says so and sends usable poses. A model recipe that is not validated is returned with
 * confidence 'low' and a note, so the tab can warn. When the endpoint asks a question instead, the recipe book's best guess comes back with
 * `clarifyingQuestion` set so the tab can show a build and ask at once.
 * Options: { endpoint, book, parts (indexed kip-describe-parts.json: also runs the browser-side rules), fetchImpl, timeoutMs }.
 */
export async function describe(description, { endpoint, book, parts, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const text = oneLine(description, 300);
  if (!text) throw new Error('describe() needs a description');
  if (!book) throw new Error('describe() needs the recipe book (loadRecipeBook)');
  let aside = '';
  if (endpoint) {
    const r = await askEndpoint(endpoint, text, book.allowedIds, fetchImpl, timeoutMs);
    if (r.kind === 'steps' && parts) {
      const v = validateRecipe(r.steps, parts, { allowedIds: book.allowedIds });
      if (!v.ok) {
        aside = `The model's recipe did not fit together (${describeProblems(v.errors, 2)}). `;
        r.kind = 'rejected';
      }
    }
    if (r.kind === 'steps') {
      const base = r.note ?? 'Built from your description.';
      return {
        steps: r.steps, title: r.title ?? 'Your build', source: 'model', validated: r.validated,
        confidence: r.validated ? 'medium' : 'low',
        note: r.validated ? base : `${base} This recipe was not checked for fit.`,
        ...(r.poses ? { poses: r.poses } : {}),
      };
    }
    if (r.kind === 'question') {
      const guess = matchRecipeBook(text, book);
      return { ...guess, clarifyingQuestion: r.question, note: `${guess.note} The model asked: ${r.question}` };
    }
    if (r.kind !== 'rejected') aside = r.kind === 'error' ? `The model said: "${r.message}" ` : `The model's answer could not be used (${r.why}). `;
  }
  const guess = matchRecipeBook(text, book);
  return { ...guess, note: `${aside}${guess.note}` };
}
