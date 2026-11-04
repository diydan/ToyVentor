// POST /api/forge/make: text to part. A child's words in, a printable accessory out (F1 "Describe it" in docs/specs/forge-ai-spec.md).
//
// One call asks the model for a Recipe v1 AND the object's name in seven languages (Dan's design: "Naming and the waiting state"). Everything the
// model says is data and is checked here, field by field, before it goes anywhere: the recipe goes through the same allowlist as every other Forge
// route (worker/forgeOptimizer.ts `sanitizeRecipe`: no code, no unknown keys, bounded numbers), then to the optimizer daemon for the first look and
// the gates; the names go through `parseNames` (kid-safety, brand, script and gender checks) and are signed so /api/voice can speak them.
// The model never builds anything and never gets to run anything.
//
// Gate, in this order, before a single model call is spent: the device, the per-device and per-IP rate limit (the same budget as
// /api/forge/preview, because each call here ends in one preview), then intake (length, contact details, unsafe words, brand words). The grown-up
// proof is not asked for (Dan, 2026-11-03) unless FORGE_MAKE_REQUIRES_PROOF=1: making and previewing are digital; printing keeps the proof.
//
// One request is one model call. A repair is a second request that carries the recipe that did not pass and the daemon's job id: the Worker asks the
// daemon what failed (never the client), tells the model only `{gate, measured, limit, hint}`, and the client counts its own calls (at most 4, the
// spec's F1 budget). So nothing here holds a request open for minutes, and a Worker restart loses nothing.
import { type DaemonJob, buildFeedback } from "../scripts/lib/forgeEvalCore";
import { MAKE_CHOICE_SLOTS, MAKE_MAX_CALLS, MAKE_MAX_TEXT_CHARS, MAKE_SLOTS, buildMakePrompt, type MakeSlot } from "../shared/forgeMakePrompt";
import { checkForgeRecipeBrandSafety, type ForgeRecipeV1 } from "../shared/forgeOptimizer";
import { readCappedJson } from "./body";
import { issueSpokenNames, parseNames, type SigningEnv } from "./forgeNames";
import {
  JOB_ID_RE,
  UPSTREAM_POLL_TIMEOUT_MS,
  fetchUpstreamJson,
  gateForge,
  handleForgeJobStatus,
  logEvent,
  reply,
  sanitizeRecipe,
  scrubPreviewOutput,
  upstreamHeaders,
  upstreamUrl,
  type ForgeOptimizerEnv,
} from "./forgeOptimizer";
import { buildTunePrompt } from "../shared/forgeTunePrompt";
import { type Backend, type BackendEnv, type FastMode, askText, effectiveAudience, fastMode, resolveBackend, resolveFastBackend, selfBackend } from "./modelBackend";
import { firstJsonObject, kidSafeText, scrubContactDetails, tidy } from "./muse";

export type ForgeMakeEnv = ForgeOptimizerEnv &
  BackendEnv &
  SigningEnv & {
    /** Set to "1" to put the grown-up proof back in front of making a part. Unset: making and previewing need only the device id and the rate limits. */
    FORGE_MAKE_REQUIRES_PROOF?: string;
  };

/**
 * Dan, 2026-11-03: the grown-up check is dropped for making and previewing (the first look and the checks) and kept for what is printed: the
 * file route (/api/forge/artifacts/) still needs the proof. What stays in front of the model call: a valid device id, the per-device and per-IP
 * rate limits (5 and 10 a minute, shared with /api/forge/preview), and intake. The durable guard on spend is a Cloudflare rate-limit rule on this
 * path (as for Muse, docs/product/spec.md); these in-isolate limits are best effort.
 */
export const makeRequiresProof = (env: ForgeMakeEnv): boolean => env.FORGE_MAKE_REQUIRES_PROOF === "1";

const MAX_MAKE_BODY_BYTES = 12_000;
/** Spark took 14 to 36 s for a recipe plus names in the eval (p95 36 s); the daemon's first look then takes about 40 ms. */
const MODEL_TIMEOUT_MS = 55_000;
const MODEL_TIMEOUT_SELF_MS = 80_000;
/**
 * Our own model (Glimmer on Modal) shares one GPU between its two slots, so under load a long generation runs at about a third of its solo speed: in the 2026-11-04 run 3, one of 37 wishes
 * outlasted 55 s and fell back to a ready-made part, while a child alone waits 10 to 14 s. Dan (2026-11-04): wait longer instead. The panel already says "this can take a minute", and a slow
 * generation that finishes is better than a fallback. CAUTION, not yet checked: a request that takes over about 100 s may meet Cloudflare's edge timeout once this is deployed (the model wait,
 * up to 80 s, plus the daemon's first look, normally under a second but up to 37 CPU-seconds for a monkey head). The hosted API keeps 55 s.
/**
 * How long the daemon gets for the first look. The shared 8 s (UPSTREAM_PREVIEW_TIMEOUT_MS) suits a mesh that is already built; for a recipe the daemon
 * builds the part first, and a head with big side ears takes 37 CPU-seconds (a monkey, measured 2026-11-03), so 8 s turned those wishes into "unavailable".
 * A busy machine does the same to a quick one (a fox head is 0.6 CPU-seconds and still timed out while the Mac was at load 188).
 */
const MAKE_PREVIEW_TIMEOUT_MS = 90_000;
const TERMINAL = new Set(["print_ready", "digital_only", "failed"]);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Defence in depth on what the MODEL says (the part's name and its names in seven languages): the intake and recipe checks only know the building-toy
 * brands (FORBIDDEN_BRAND_RE in shared/forgeOptimizer.ts), but a child may well ask for a spiderman mask or a pikachu hat. In the 2026-11-03 run of 40 wishes
 * the model turned all four into generic names, so this has never fired; it is here because that is the model's behaviour and not a guarantee. Unambiguous
 * names only (no "frozen", "sonic" or "elsa", which are also ordinary words). A match replaces the part's name, or drops that language's name.
 * The list is a product call and short on purpose: extend it as the owner of the brand rule decides. Bare "mickey" and "minnie" (Dan, 2026-11-04) because base Glimmer named a
 * part "Mickey Style Ears Hat" for "mickey mouse ears" and the two-word form missed it. This filter runs on what the MODEL says, never on the child's wish, and a false positive
 * only swaps a name for "My Creation", so it can afford to be liberal; refusing a child's own wish is the costly side and stays narrow.
 */
export const KID_BRAND_RE =
  /\b(spider-?man|bat-?man|super-?man|wonder woman|iron man|pok[eé]mon|pikachu|mickey|minnie|disney|marvel|hello kitty|sanrio|nintendo|super mario|minecraft|roblox|barbie|paw patrol|peppa pig|star wars|darth vader|harry potter|hogwarts|transformers|optimus prime|hot wheels|fortnite|pixar|nickelodeon)\b/i;

/** The child's words, cleaned: contact details out, control characters out, whitespace collapsed. */
function cleanWish(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return scrubContactDetails(raw)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface MakeRequest {
  text: string;
  slot?: MakeSlot;
  attempt: number;
  repair?: { jobId?: string; recipe: unknown; badRecipe: boolean };
  /** The grown-up's choice for the fast path: false = standard model only, true = the fast path is welcome; absent = whatever the server's FORGE_FAST_MODE says. */
  fast?: boolean;
}

/**
 * Does THIS call try the fast (tuned) model first? Only the FIRST attempt of a hat or head wish: a repair, or any later attempt, goes to the standard model (it is the fallback and the
 * better one at fixing), and every vehicle slot goes to the standard model (a tuned model that saw only hats and heads lost the held prop in the probe: scripts/tuning/results/slot-probe-*.md).
 * FORGE_FAST_MODE "on": yes unless the client sent fast:false. "optin": only when the client sent fast:true. Off: never.
 */
export function fastEligible(a: { mode: FastMode; wantsFast: boolean | undefined; attempt: number; repaired: boolean; slot?: MakeSlot }): boolean {
  if (a.mode === "off") return false;
  if (a.mode === "optin" ? a.wantsFast !== true : a.wantsFast === false) return false;
  if (a.attempt !== 1 || a.repaired) return false;
  return !a.slot || (MAKE_CHOICE_SLOTS as readonly string[]).includes(a.slot);
}
/** The fast model gets a short leash so the fallback still fits in one request (a Worker request that runs past about 100 s may be cut at Cloudflare's edge). */
export const FAST_TIMEOUT_MS = 35_000;
const FALLBACK_AFTER_FAST_TIMEOUT_MS = 55_000;

type Parsed = { ok: true; req: MakeRequest } | { ok: false; response: Response };

function parseRequest(raw: unknown): Parsed {
  const bad = (status: string, http = 422): Parsed => ({ ok: false, response: reply(http, { ok: false, status }) });
  if (!isRecord(raw)) return bad("invalid");
  const text = cleanWish(raw.text);
  if (text.length < 1 || text.length > MAKE_MAX_TEXT_CHARS) return bad("invalid");
  if (!kidSafeText(text)) return bad("not-allowed");
  if (checkForgeRecipeBrandSafety({ name: text, slot: "crown", shape: { slices: [] } } as unknown as ForgeRecipeV1)) return bad("brand-rejected");
  let slot: MakeSlot | undefined;
  if (raw.slot !== undefined && raw.slot !== null) {
    if (typeof raw.slot !== "string" || !(MAKE_SLOTS as readonly string[]).includes(raw.slot)) return bad("invalid");
    slot = raw.slot as MakeSlot;
  }
  let fast: boolean | undefined;
  if (raw.fast !== undefined) {
    if (typeof raw.fast !== "boolean") return bad("invalid");
    fast = raw.fast;
  }
  const attempt = raw.attempt === undefined ? 1 : raw.attempt;
  if (typeof attempt !== "number" || !Number.isInteger(attempt) || attempt < 1 || attempt > MAKE_MAX_CALLS) return bad("invalid");
  let repair: MakeRequest["repair"];
  if (raw.repair !== undefined) {
    const r = raw.repair;
    if (!isRecord(r) || attempt < 2) return bad("invalid");
    const jobId = r.job_id;
    if (jobId !== undefined && (typeof jobId !== "string" || !JOB_ID_RE.test(jobId))) return bad("invalid");
    const badRecipe = r.bad_recipe === true;
    if (jobId === undefined && !badRecipe) return bad("invalid"); // a repair says what to repair: a job, or a recipe the daemon refused
    repair = { ...(jobId ? { jobId } : {}), recipe: r.recipe, badRecipe };
  }
  return { ok: true, req: { text, ...(slot ? { slot } : {}), attempt, ...(repair ? { repair } : {}), ...(fast !== undefined ? { fast } : {}) } };
}

/**
 * POST /api/forge/warm: a child opened "Make from words", so wake our own model now. Glimmer on Modal scales to zero when idle (Dan, 2026-11-04: keep it cheaper), and the first
 * request after a quiet spell waits 26 to 150+ seconds for a container; the child is about to type a wish, so the wake-up overlaps with the typing.
 *
 * What it does: only when the text backend is "self", send ONE GET to the model server's /health (the origin, not /v1) and do not wait for the answer. An abandoned request still wakes
 * the container (measured 2026-11-04: a request dropped after 2 s, silence for 25 s, then a health check answered in 0.6 s). Nothing else: no key is sent, no child data, no wish.
 * For the hosted API or "off" it does nothing at all.
 *
 * Cost guard. Device ids are free to invent, so a per-device limit alone cannot stop someone keeping the GPU awake (every ping restarts the idle timer): the real guard is that this
 * isolate sends at most one ping every WARM_PING_EVERY_MS however many calls arrive (best effort: isolates multiply), plus a Cloudflare rate-limit rule on this path. The worst case
 * is one container always on, the same cost as min_containers = 1 (about $47 a day), never more: pings are instant requests and do not make Modal start a second container.
 * The answer is the same 202 whatever happened, so the route reveals neither the backend nor the address; the log line says what happened (no URL, no device id).
 */
export const WARM_PING_EVERY_MS = 4 * 60_000;
const WARM_PING_TIMEOUT_MS = 28_000; // a Worker keeps a background task for about 30 s after it has answered
let lastWarmPing = 0;
export function resetForgeWarm(): void {
  lastWarmPing = 0;
}

export async function handleForgeWarm(request: Request, env: ForgeMakeEnv, ctx?: { waitUntil(p: Promise<unknown>): void }): Promise<Response> {
  const g = await gateForge(request, env, "POST", "warm", "forge_warm", false); // a device id and the limits; the daemon must be configured (no maker, nothing to warm)
  if (!g.ok) return g.response;
  const accepted = () => reply(202, { ok: true, status: "accepted" });
  const backend = resolveBackend(env, "text");
  const fastBackend = backend.mode === "off" ? null : resolveFastBackend(env); // the fast model is ours whatever the standard backend is
  if ((backend.mode !== "self" || !backend.baseUrl) && !fastBackend) {
    logEvent("forge_warm", "not_needed", { backend: backend.mode });
    return accepted();
  }
  const now = Date.now();
  if (now - lastWarmPing < WARM_PING_EVERY_MS) {
    logEvent("forge_warm", "coalesced");
    return accepted();
  }
  // the standard model, and the fast one too when the fast path is on (a cold fast model would time out its short leash and make every first wish fall back)
  const origins = [backend.mode === "self" ? backend.baseUrl : null, fastBackend?.baseUrl ?? null];
  const healths: string[] = [];
  for (const o of origins) {
    if (!o) continue;
    try {
      const h = `${new URL(o).origin}/health`;
      if (!healths.includes(h)) healths.push(h);
    } catch {
      // an unparsable address is skipped
    }
  }
  if (healths.length === 0) return accepted();
  lastWarmPing = now;
  const started = Date.now();
  const pings = healths.map((health) =>
    fetch(health, { method: "GET", signal: AbortSignal.timeout(WARM_PING_TIMEOUT_MS) }).then(
      (r) => logEvent("forge_warm", "up", { httpStatus: r.status, ms: Date.now() - started }),
      () => logEvent("forge_warm", "no_answer", { ms: Date.now() - started }),
    ),
  );
  const ping = Promise.all(pings);
  if (ctx) ctx.waitUntil(ping);
  logEvent("forge_warm", "pinged");
  return accepted();
}

export async function handleForgeMake(request: Request, env: ForgeMakeEnv): Promise<Response> {
  const backend = resolveBackend(env, "text");
  if (request.method === "POST" && backend.mode === "off" && backend.reason !== "not_configured") {
    logEvent("forge_make", "backend_off", { reason: backend.reason }); // a switch set to off (or an invalid one): nothing to spend, nothing to gate, for every audience
    return reply(503, { ok: false, status: "disabled" });
  }
  const g = await gateForge(request, env, "POST", "preview", "forge_make", makeRequiresProof(env));
  if (!g.ok) return g.response;

  const body = await readCappedJson(request, MAX_MAKE_BODY_BYTES);
  if (!body.ok) return reply(body.over ? 413 : 400, { ok: false, status: body.over ? "too-large" : "invalid" });
  const parsed = parseRequest(body.value);
  if (!parsed.ok) return parsed.response;
  const { text, slot, attempt, repair, fast: wantsFast } = parsed.req;

  // A repair: ask the daemon what failed, never trust the client's account of it.
  let previous: ForgeRecipeV1 | undefined;
  let feedback: ReturnType<typeof buildFeedback> | undefined;
  if (repair) {
    const prev = sanitizeRecipe(repair.recipe);
    if (!prev.ok) return reply(422, { ok: false, status: "invalid" });
    previous = prev.recipe;
    if (repair.jobId) {
      const up = await fetchUpstreamJson(upstreamUrl(g.baseUrl, `/v1/jobs/${repair.jobId}`), { method: "GET", headers: upstreamHeaders(env) }, UPSTREAM_POLL_TIMEOUT_MS, "forge_make");
      if (!up.ok) return up.response;
      const job = up.data as unknown as DaemonJob;
      const status = String((up.data as { status?: unknown }).status ?? "");
      if (!TERMINAL.has(status)) return reply(409, { ok: false, status: "not-finished" });
      if (status === "print_ready") return reply(409, { ok: false, status: "already-ok" });
      feedback = buildFeedback(status, job, status === "failed");
    } else {
      feedback = buildFeedback("failed", null, true); // the daemon refused the recipe before any check
    }
  }

  let retried = false; // our own model was asked a second time (worker/modelBackend.ts askText): said in the log line, so a retry can be counted
  // our own model, once trained on the short prompt (SELF_TEXT_PROMPT=tuned, default off): training and serving use the same text, see shared/forgeTunePrompt.ts
  const promptArgs = { text, ...(slot ? { slot } : {}), ...(previous ? { previous, feedback } : {}) };
  // WHO is asking decides what may answer. An adult's request may use the standard backend as configured (hosted or ours); a CHILD's request only ever goes to our own models: our own
  // standard server if one is configured, else the fast model alone, else nothing (the child gets no part, never an outside one). See Audience in worker/modelBackend.ts.
  const audience = effectiveAudience(env);
  const ownStandard = audience === "child" ? selfBackend(env, "text") : null;
  const standard: Backend | null = audience === "adult" ? backend : ownStandard && ownStandard.mode !== "off" ? ownStandard : null;
  const fastBackend = fastEligible({ mode: fastMode(env), wantsFast, attempt, repaired: repair !== undefined, ...(slot ? { slot } : {}) }) ? resolveFastBackend(env) : null;
  if ((!standard || standard.mode === "off") && !fastBackend) {
    logEvent("forge_make", "no_model_for_audience", { audience, reason: audience === "adult" ? backend.reason : "child_has_no_own_model" });
    return reply(503, { ok: false, status: "disabled" });
  }
  const promptFor = (b: Backend) => (b.promptStyle === "tuned" ? buildTunePrompt(promptArgs) : buildMakePrompt(promptArgs));
  const timeoutOf = (b: Backend) => (b.mode === "self" ? MODEL_TIMEOUT_SELF_MS : MODEL_TIMEOUT_MS);
  let usedFast = false;
  let asked: Awaited<ReturnType<typeof askText>>;
  let askedMode = standard?.mode ?? "self";
  if (fastBackend) {
    usedFast = true;
    askedMode = "self";
    asked = await askText(fastBackend, buildMakePrompt(promptArgs), { timeoutMs: standard ? FAST_TIMEOUT_MS : timeoutOf(fastBackend), onRetry: () => { retried = true; } });
    if (!asked.ok && standard && standard.mode !== "off") {
      logEvent("forge_make", "fast_fallback", { audience, ...(asked.status !== null ? { httpStatus: asked.status } : { timeout: true }) });
      usedFast = false;
      askedMode = standard.mode;
      asked = await askText(standard, promptFor(standard), { timeoutMs: Math.min(timeoutOf(standard), FALLBACK_AFTER_FAST_TIMEOUT_MS), onRetry: () => { retried = true; } });
    }
  } else {
    asked = await askText(standard!, promptFor(standard!), { timeoutMs: timeoutOf(standard!), onRetry: () => { retried = true; } });
  }
  if (!asked.ok) {
    logEvent("forge_make", asked.status === null ? "model_failed" : "model_status", { ...(asked.status !== null ? { httpStatus: asked.status } : {}), backend: askedMode, audience, ...(retried ? { retried: true } : {}) }); // error detail stays on the server
    return reply(502, { ok: false, status: "unavailable", attempt });
  }
  const modelText = asked.text;

  const envelope = firstJsonObject(modelText);
  if (!isRecord(envelope)) return reply(502, { ok: false, status: "no-recipe", attempt });
  // The model was asked for {recipe, names}; one that sends just a recipe is still read.
  const rawRecipe = isRecord(envelope.recipe) ? envelope.recipe : "shape" in envelope && "slot" in envelope ? envelope : null;
  if (!rawRecipe) return reply(502, { ok: false, status: "no-recipe", attempt });
  const wanted = { ...rawRecipe, ...(slot ? { slot } : {}) };
  // A slot the child asked for is forced above and was checked on the way in; with none asked for, the model may choose a hat or a head and nothing else.
  if (!slot && !(MAKE_CHOICE_SLOTS as readonly unknown[]).includes(wanted.slot)) return reply(502, { ok: false, status: "no-recipe", attempt });

  const clean = sanitizeRecipe(wanted);
  if (!clean.ok || checkForgeRecipeBrandSafety(clean.recipe)) return reply(502, { ok: false, status: "no-recipe", attempt });
  // What a child reads (the part's name and its one-line behaviour) is filtered like any model text, and never echoes the wish.
  const name = tidy(clean.recipe.name);
  const recipe: ForgeRecipeV1 = {
    ...clean.recipe,
    name: kidSafeText(name, text.toLowerCase()) && !KID_BRAND_RE.test(name) ? name : "My Creation",
    behavior: clean.recipe.behavior && kidSafeText(clean.recipe.behavior, text.toLowerCase()) && !KID_BRAND_RE.test(clean.recipe.behavior) ? tidy(clean.recipe.behavior) : "Made from your idea",
  };

  const up = await fetchUpstreamJson(
    upstreamUrl(g.baseUrl, "/v1/fast-preview"),
    { method: "POST", headers: upstreamHeaders(env), body: JSON.stringify({ recipe, enqueue_background: true, include_glb_base64: true }) },
    MAKE_PREVIEW_TIMEOUT_MS,
    "forge_make",
  );
  // The daemon answers 400 or 422 for a recipe it cannot compile (fetchUpstreamJson turns that into a 422): not a failure of the service, a recipe to
  // repair. The recipe is returned so the client can ask (`repair: {bad_recipe: true, recipe}`).
  if ((!up.ok && up.response.status === 422) || (up.ok && !up.data.ok)) {
    logEvent("forge_make", "daemon_refused", { attempt });
    return reply(422, { ok: false, status: "bad-recipe", attempt, recipe });
  }
  if (!up.ok) return up.response;

  const parsedNames = parseNames(envelope.names, text.toLowerCase(), recipe.name); // the filtered recipe name may stand in for an English name that only echoes the wish
  const names = Object.fromEntries(Object.entries(parsedNames.names).filter(([, n]) => !KID_BRAND_RE.test(n.w))) as typeof parsedNames.names;
  if (!names.en) for (const k of Object.keys(names)) delete names[k as keyof typeof names]; // English is every language's fallback: with no good English name nothing is kept
  const signed = await issueSpokenNames(env, names);
  logEvent("forge_make", "ok", { backend: askedMode, audience, ...(retried ? { retried: true } : {}), attempt, slot: recipe.slot, repaired: repair !== undefined, namesKept: Object.keys(names).length, spoken: Object.keys(signed).length, model: usedFast ? "fast" : "standard" });
  return reply(200, {
    audience, // who the request was treated as: a child's request never reaches the hosted model
    model: usedFast ? "fast" : "standard", // which of our models wrote the recipe, so a grown-up can see what the setting did
    ...scrubPreviewOutput(up.data),
    attempt,
    calls_left: MAKE_MAX_CALLS - attempt,
    recipe,
    name: recipe.name,
    names: signed,
    ...(names.en ? { name_en: names.en.w } : {}),
  });
}

/** GET /api/forge/make/jobs/:id: the status of a text-to-part job, with no grown-up proof unless FORGE_MAKE_REQUIRES_PROOF=1. The file route keeps its proof. */
export function handleForgeMakeJobStatus(request: Request, env: ForgeMakeEnv, jobId: string): Promise<Response> {
  return handleForgeJobStatus(request, env, jobId, makeRequiresProof(env));
}
