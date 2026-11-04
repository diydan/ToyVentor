// POST /api/describe: the model behind the Describe & Build tab (contract: parts/kip/viewer/kip-describe-contract.md), run by Muse through
// the same Meta key and client conventions as Create mode (worker/muse.ts): key from MODEL_API_KEY / META_MODEL_API_KEY, URL from
// META_MODEL_API_URL, model muse-spark-* (MUSE_SPARK_MODEL), Responses API.
//
// What the model is allowed to do here, and why it is only this. The contract says poses are never written by a model: they come from the
// real assembly validator (Python, exact collisions), which cannot run in a Worker. So the Worker never lets Muse invent a build. Muse
// reads the child's words (in any language, which the tab's English keyword matcher cannot) and CHOOSES one of the ten ready builds in
// kip-describe-recipes.json, each already checked by the real validator. The reply is that build's own steps and reference poses, so what
// the child sees is always buildable and always checked. Inventing new builds stays with the local tool (tools/describe-endpoint.mjs),
// which runs the real validator.
//
// Kid-facing rules are Create mode's: contact details are scrubbed before the words reach the model, the prompt carries the safety rules,
// anything the model says back is filtered (and never echoes the child), the route is rate limited per IP, and any failure answers with an
// error status so the tab quietly falls back to its own matcher.
import book from "../parts/kip/viewer/kip-describe-recipes.json";
import { readCappedJson } from "./body";
import { askText, resolveBackend, resolveModel } from "./modelBackend";
import { SAFETY, firstJsonObject, kidSafeText, scrubContactDetails, tidy, type MuseEnv } from "./muse";

export const DESCRIBE_CONTRACT = 1;
const MAX_BODY_BYTES = 4_000;
const MAX_DESCRIPTION = 300; // the tab trims to 300 too
/** Separate from Create mode's budget: a kid using both should not starve one with the other. Best effort per isolate. */
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_WINDOW = 10;
const recentHits = new Map<string, number[]>();
/** The tab waits up to 45 s for an endpoint (parts/kip/viewer/tools/describe-endpoint.mjs) and keeps a busy state meanwhile, but a child does not wait forever: a quick pick or a
 *  quick fallback. Covers the retry too. Glimmer needs this budget: a measured Glimmer answer took 11 to 46 s (median about 20 s), so 12 s never fitted our own model and
 *  Describe & Build would have fallen back to the word matcher on every call. The hosted model answers in a second or two and is unaffected, because a budget is a ceiling. */
const MODEL_TIMEOUT_MS = 45_000;

interface Recipe {
  id: string;
  title: string;
  description: string;
  steps: unknown[];
  reference: { poses: Record<string, unknown> };
}
const RECIPES = (book as { recipes: Recipe[] }).recipes;
const BY_ID = new Map(RECIPES.map((r) => [r.id, r]));

export function describeRateLimited(ip: string | null | undefined, now = Date.now()): boolean {
  if (!ip) return false;
  const hits = (recentHits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  hits.push(now);
  recentHits.set(ip, hits);
  return hits.length > RATE_MAX_PER_WINDOW;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function describePrompt(description: string): string {
  const list = RECIPES.map((r) => `- ${r.id}: ${r.description} (${r.title})`).join("\n");
  return [
    SAFETY,
    "You match a child's words to one of these ready-made toy builds. The child may write in any language.",
    'Reply with JSON only: {"recipeId": "<one id from the list, or null if nothing is close>", "say": "<one short warm sentence for the child about what you picked, in the child\'s language>", "question": "<one short question for the child if their words are unclear, otherwise null>"}',
    "Ready builds:",
    list,
    "Choose the build closest in meaning. Never invent an id. If nothing is close, set recipeId to null and ask one short question that offers two builds from the list.",
    `The child said: "${scrubContactDetails(description).replace(/"/g, "'")}"`,
  ].join("\n");
}

const clean = (v: unknown, max: number): string => (typeof v === "string" ? tidy(v).replace(/\s+/g, " ").slice(0, max) : "");
const squish = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();

export async function handleDescribe(request: Request, env: MuseEnv): Promise<Response> {
  if (request.method === "GET") {
    return json({ ok: true, route: "describe", contract: DESCRIBE_CONTRACT, model: resolveBackend(env, "text").mode === "hosted" ? resolveModel(undefined, env) : null, configured: resolveBackend(env, "text").mode !== "off", builds: RECIPES.length });
  }
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (describeRateLimited(request.headers.get("CF-Connecting-IP"))) return json({ error: "Slow down, one build at a time. Try again in a minute." }, 429);
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) return json({ error: "expected application/json" }, 415);

  const parsed = await readCappedJson(request, MAX_BODY_BYTES);
  if (!parsed.ok) return json({ error: parsed.over ? "request body too large" : "invalid JSON body" }, parsed.over ? 413 : 400);
  const body = parsed.value as { description?: unknown };
  const description = typeof body.description === "string" ? body.description.replace(/\s+/g, " ").trim() : "";
  if (!description) return json({ error: "description is required" }, 422);
  if (description.length > MAX_DESCRIPTION) return json({ error: `description over ${MAX_DESCRIPTION} characters` }, 413);

  const backend = resolveBackend(env, "text"); // hosted (Meta), self (our own model) or off: see worker/modelBackend.ts
  if (backend.mode === "off") return json({ error: "muse is not configured" }, 503);

  const asked = await askText(backend, describePrompt(description), { timeoutMs: MODEL_TIMEOUT_MS });
  if (!asked.ok) {
    console.log(JSON.stringify({ event: "describe", status: asked.status === null ? "fetch-failed" : asked.status, backend: backend.mode }));
    return json({ error: asked.status === null ? "muse request failed" : `muse returned ${asked.status}` }, 502);
  }

  const reply = firstJsonObject(asked.text);
  if (!isRecord(reply)) {
    console.log(JSON.stringify({ event: "describe", status: "unparseable" }));
    return json({ error: "muse did not return JSON" }, 502);
  }
  const childSaid = squish(description);
  const sayRaw = clean(reply.say, 160);
  const say = sayRaw && kidSafeText(sayRaw, childSaid) ? sayRaw : "";

  const id = typeof reply.recipeId === "string" ? reply.recipeId : "";
  const recipe = BY_ID.get(id);
  if (recipe) {
    console.log(JSON.stringify({ event: "describe", status: "ok", backend: backend.mode, recipe: recipe.id, sayFiltered: sayRaw !== "" && say === "" }));
    const note = `Muse picked "${recipe.title}", a checked build. ${say}`.trim().slice(0, 200);
    return json({ contract: DESCRIBE_CONTRACT, title: recipe.title, note, validated: true, steps: recipe.steps, poses: recipe.reference.poses });
  }
  const questionRaw = clean(reply.question, 200);
  if (questionRaw && kidSafeText(questionRaw, childSaid)) {
    console.log(JSON.stringify({ event: "describe", status: "question", backend: backend.mode }));
    return json({ contract: DESCRIBE_CONTRACT, clarifyingQuestion: questionRaw });
  }
  console.log(JSON.stringify({ event: "describe", status: "no-pick", backend: backend.mode }));
  return json({ error: "muse did not pick a build" }, 502);
}
