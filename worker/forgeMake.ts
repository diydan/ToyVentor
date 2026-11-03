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
import { MAKE_MAX_CALLS, MAKE_MAX_TEXT_CHARS, MAKE_SLOTS, buildMakePrompt, type MakeSlot } from "../shared/forgeMakePrompt";
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
import { type BackendEnv, askText, resolveBackend } from "./modelBackend";
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
 * rate limits (3 and 6 a minute, shared with /api/forge/preview), and intake. The durable guard on spend is a Cloudflare rate-limit rule on this
 * path (as for Muse, docs/product/spec.md); these in-isolate limits are best effort.
 */
export const makeRequiresProof = (env: ForgeMakeEnv): boolean => env.FORGE_MAKE_REQUIRES_PROOF === "1";

const MAX_MAKE_BODY_BYTES = 12_000;
/** Spark took 14 to 36 s for a recipe plus names in the eval (p95 36 s); the daemon's first look then takes about 40 ms. */
const MODEL_TIMEOUT_MS = 55_000;
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
}

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
  return { ok: true, req: { text, ...(slot ? { slot } : {}), attempt, ...(repair ? { repair } : {}) } };
}

export async function handleForgeMake(request: Request, env: ForgeMakeEnv): Promise<Response> {
  const backend = resolveBackend(env, "text");
  if (request.method === "POST" && backend.mode === "off") {
    logEvent("forge_make", "backend_off", { reason: backend.reason }); // a switch set to off, or to a model we have not configured: nothing to spend, nothing to gate
    return reply(503, { ok: false, status: "disabled" });
  }
  const g = await gateForge(request, env, "POST", "preview", "forge_make", makeRequiresProof(env));
  if (!g.ok) return g.response;

  const body = await readCappedJson(request, MAX_MAKE_BODY_BYTES);
  if (!body.ok) return reply(body.over ? 413 : 400, { ok: false, status: body.over ? "too-large" : "invalid" });
  const parsed = parseRequest(body.value);
  if (!parsed.ok) return parsed.response;
  const { text, slot, attempt, repair } = parsed.req;

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

  const asked = await askText(backend, buildMakePrompt({ text, ...(slot ? { slot } : {}), ...(previous ? { previous, feedback } : {}) }), { timeoutMs: MODEL_TIMEOUT_MS });
  if (!asked.ok) {
    logEvent("forge_make", asked.status === null ? "model_failed" : "model_status", { ...(asked.status !== null ? { httpStatus: asked.status } : {}), backend: backend.mode }); // error detail stays on the server
    return reply(502, { ok: false, status: "unavailable", attempt });
  }
  const modelText = asked.text;

  const envelope = firstJsonObject(modelText);
  if (!isRecord(envelope)) return reply(502, { ok: false, status: "no-recipe", attempt });
  // The model was asked for {recipe, names}; one that sends just a recipe is still read.
  const rawRecipe = isRecord(envelope.recipe) ? envelope.recipe : "shape" in envelope && "slot" in envelope ? envelope : null;
  if (!rawRecipe) return reply(502, { ok: false, status: "no-recipe", attempt });
  const wanted = { ...rawRecipe, ...(slot ? { slot } : {}) };
  if (!(MAKE_SLOTS as readonly unknown[]).includes(wanted.slot)) return reply(502, { ok: false, status: "no-recipe", attempt });

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

  const parsedNames = parseNames(envelope.names, text.toLowerCase());
  const names = Object.fromEntries(Object.entries(parsedNames.names).filter(([, n]) => !KID_BRAND_RE.test(n.w))) as typeof parsedNames.names;
  if (!names.en) for (const k of Object.keys(names)) delete names[k as keyof typeof names]; // English is every language's fallback: with no good English name nothing is kept
  const signed = await issueSpokenNames(env, names);
  logEvent("forge_make", "ok", { backend: backend.mode, attempt, slot: recipe.slot, repaired: repair !== undefined, namesKept: Object.keys(names).length, spoken: Object.keys(signed).length });
  return reply(200, {
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
