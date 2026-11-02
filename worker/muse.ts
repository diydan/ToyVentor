// Create mode in ToyVentor World posts to /api/muse/spark and expects a
// level recipe back. This route is the only place that talks to the
// model, so the kid-facing rules live here: a short warm line, safe
// topics, and a recipe that matches the game's own level shape.
//
// Request: {model: "muse-spark", input: string, format: "json"}
// Response: {say: string, recipe: {format, id, name, theme, props, spots}}
//
// The game falls back to its own word parser when this route answers with
// an error, so a model hiccup never breaks Create mode for a kid.
import { readCappedJson } from "./body";
import type { MetaEnv } from "./meta";

export interface MuseEnv extends MetaEnv {
  /** Model id for Create mode. Defaults to the current Muse Spark. */
  MUSE_SPARK_MODEL?: string;
}

const DEFAULT_MODEL = "muse-spark-1.3";
/** The game sends the recipe rules plus the child's words, so the prompt
 *  is long. This is a ceiling, not a target. */
const MAX_INPUT_CHARS = 8_000;
const MAX_SAY_CHARS = 160;
const MAX_NAME_CHARS = 40;
/** Request bodies stay small (input ceiling plus envelope); the byte cap
 *  is enforced while reading so a missing content-length cannot bypass it. */
const MAX_BODY_BYTES = 64_000;
/** In-isolate per-IP budget for the metered kid-facing route. Best effort
 *  only: requests can land on different isolates, so the Cloudflare
 *  dashboard rule recorded in docs/product/spec.md is the durable limit. */
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_WINDOW = 10;
const recentHits = new Map<string, number[]>();

export function museRateLimited(ip: string | null | undefined, now = Date.now()): boolean {
  if (!ip) return false;
  const hits = (recentHits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  hits.push(now);
  recentHits.set(ip, hits);
  return hits.length > RATE_MAX_PER_WINDOW;
}
/** The game gives up after 18s, so answer before that. This budget covers
 *  every attempt combined, including the reasoning-parameter retry. */
const MODEL_TIMEOUT_MS = 13_000;
const THEMES = ["garden", "sky", "junk", "beach", "snow", "room"];

/** Kid-facing rules, applied to every request. */
const SAFETY = [
  "You help a young child (ages 4 to 10) build a pretend play world.",
  "Keep it kind and safe: nothing scary, violent, adult, or personal.",
  "Never include real names, addresses, phone numbers, or details that identify a person.",
  "Never mention brands, trademarks, or real-world products.",
  "Never repeat the child's own words back to them.",
].join(" ");

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isHex(v: unknown): v is string {
  return typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
}

/** Model ids this route will call. Anything else is refused, so a client
 *  cannot use the kid-facing route to reach another model. */
function resolveModel(requested: unknown, env: MuseEnv): string | null {
  const wanted = typeof requested === "string" ? requested : "";
  if (wanted && !/^muse-spark/i.test(wanted)) return null;
  const configured = env.MUSE_SPARK_MODEL?.trim();
  if (configured && /^muse-spark/i.test(configured)) return configured;
  return DEFAULT_MODEL;
}

function apiUrl(env: MetaEnv, path: string): string {
  const base = (env.META_MODEL_API_URL ?? "https://api.meta.ai/v1")
    .replace(/\/+$/, "")
    .replace(/\/responses$/, "");
  return `${base}${path}`;
}

function apiKey(env: MetaEnv): string | undefined {
  return env.MODEL_API_KEY ?? env.META_MODEL_API_KEY;
}

/** Pull the plain text out of a Responses API body. The SDK exposes
 *  output_text; the raw body carries it in output[].content[].text. */
function outputTextOf(body: unknown): string {
  if (!isRecord(body)) return "";
  if (typeof body.output_text === "string") return body.output_text;
  const output = Array.isArray(body.output) ? body.output : [];
  let text = "";
  for (const item of output) {
    if (!isRecord(item)) continue;
    const content = Array.isArray(item.content) ? item.content : [];
    for (const part of content) {
      if (isRecord(part) && typeof part.text === "string") text += part.text;
    }
  }
  return text;
}

/** The model sometimes wraps JSON in a code fence. Take the first JSON
 *  object in the text. */
function firstJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Backstop for text a kid reads. The model prompt asks for kind, safe
 *  lines, but a prompt is not a filter: anything with a link, contact
 *  details, scary or adult terms, or the child's own words echoed back
 *  is replaced by a fixed safe line instead of shown. */
const UNSAFE_TERMS =
  /\b(scary|haunt\w*|horror|nightmare\w*|kill\w*|dead|death|blood\w*|gun|guns|knife|knives|weapon\w*|hate\w*|naked|nude|sexy|drug\w*|beer|wine|vodka|cigarette\w*)\b|\bwar\b/i;
const LINKISH = /https?:\/\/|www\.|\b[\w-]+\.(?:com|net|org|io|co|info|xyz|gg)\b/i;
const CONTACTISH = /@|(?:\d[\s-]?){7,}/;

function squish(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** The child's own words, when the game prompt carries them in its usual
 *  final line. Used only to stop the model repeating them back. */
function childSaidOf(input: string): string {
  const match = /The child said: "([^"]*)"/.exec(input);
  return match ? squish(match[1] ?? "") : "";
}

/** Redact what looks like contact details before the child's words reach
 *  the model. Narrow on purpose: emails and phone-like digit runs only,
 *  so ordinary world descriptions pass through untouched. */
function scrubContactDetails(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[email removed]")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "[number removed]");
}

function kidSafeText(text: string, childSaid = ""): boolean {
  if (!text) return true;
  if (UNSAFE_TERMS.test(text) || LINKISH.test(text) || CONTACTISH.test(text)) return false;
  if (childSaid.length >= 8) {
    const squished = squish(text);
    if (squished.includes(childSaid)) return false;
    const words = childSaid.split(" ");
    for (let i = 0; i + 4 <= words.length; i++) {
      if (squished.includes(words.slice(i, i + 4).join(" "))) return false;
    }
  }
  return true;
}

/** House style for anything a kid reads: no em dashes, no long lines. */
function tidy(text: string): string {
  return text
    .replace(/\u2014/g, ",")
    .replace(/\u2013/g, "-")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** A recipe only counts if it has the shape the game can actually load. */
interface CleanRecipe {
  format: "toyventor.level/1";
  id: string;
  name: string;
  theme: string;
  props: { type: string; x: number }[];
  spots: { part: string; hide: string; x: number }[];
}

function cleanRecipe(value: unknown): CleanRecipe | null {
  if (!isRecord(value)) return null;
  if (value.format !== "toyventor.level/1") return null;
  const theme = typeof value.theme === "string" ? value.theme : "";
  if (!THEMES.includes(theme)) return null;
  const rawName = typeof value.name === "string" ? tidy(value.name).slice(0, MAX_NAME_CHARS) : "";
  if (!rawName) return null;
  // A name that fails the text check loses to a plain one, same as say.
  const name = kidSafeText(rawName) ? rawName : "My world";
  const props = Array.isArray(value.props) ? value.props : [];
  const spots = Array.isArray(value.spots) ? value.spots : [];
  // Positions clamp into the playable strip, matching the editor's edSnap
  // (runtime/editor.ts): the spec's "clamps positions into range" holds here.
  const clampX = (x: number) => Math.min(45, Math.max(0, x));
  const cleanProps = props
    .filter((p) => isRecord(p) && typeof p.type === "string" && typeof p.x === "number")
    .slice(0, 32)
    .map((p) => ({
      type: (p as Record<string, unknown>).type as string,
      x: clampX((p as Record<string, unknown>).x as number),
    }));
  const cleanSpots = spots
    .filter(
      (s) =>
        isRecord(s) &&
        typeof s.part === "string" &&
        typeof s.hide === "string" &&
        typeof s.x === "number",
    )
    .slice(0, 12)
    .map((s) => ({
      part: (s as Record<string, unknown>).part as string,
      hide: (s as Record<string, unknown>).hide as string,
      x: clampX((s as Record<string, unknown>).x as number),
    }));
  return {
    format: "toyventor.level/1",
    id: typeof value.id === "string" ? value.id : "kid-world",
    name,
    theme,
    props: cleanProps,
    spots: cleanSpots,
  };
}

export async function handleMuseSpark(request: Request, env: MuseEnv): Promise<Response> {
  if (request.method === "GET") {
    return json({
      ok: true,
      route: "muse-spark",
      model: resolveModel(undefined, env) ?? DEFAULT_MODEL,
      configured: Boolean(apiKey(env)),
    });
  }
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);

  if (museRateLimited(request.headers.get("CF-Connecting-IP")))
    return json({ error: "Slow down, one world at a time. Try again in a minute." }, 429);

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json"))
    return json({ error: "expected application/json" }, 415);

  const parsedBody = await readCappedJson(request, MAX_BODY_BYTES);
  if (!parsedBody.ok)
    return json(
      { error: parsedBody.over ? "request body too large" : "invalid JSON body" },
      parsedBody.over ? 413 : 400,
    );
  const body = parsedBody.value as { model?: unknown; input?: unknown; format?: unknown };

  const input = typeof body.input === "string" ? body.input : "";
  if (!input.trim()) return json({ error: "input is required" }, 422);
  if (input.length > MAX_INPUT_CHARS)
    return json({ error: `input over ${MAX_INPUT_CHARS} characters` }, 413);
  if (body.format !== undefined && body.format !== "json")
    return json({ error: "format must be json" }, 422);
  const wantedModel = resolveModel(body.model, env);
  if (!wantedModel) return json({ error: "model must be muse-spark" }, 422);

  const key = apiKey(env);
  if (!key) return json({ error: "muse is not configured" }, 503);

  const prompt = `${SAFETY}\n\n${scrubContactDetails(input)}`;

  // Low reasoning effort keeps a kid's wait short: the task is a small
  // JSON recipe, not a hard problem. If a model refuses the parameter,
  // the same request goes again without it, inside the same time budget
  // so the pair can never outlast the game's own 18s wait.
  const startedAt = Date.now();
  const remainingMs = () => MODEL_TIMEOUT_MS - (Date.now() - startedAt);
  const attempt = async (withEffort: boolean): Promise<Response> =>
    fetch(apiUrl(env, "/responses"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: wantedModel,
        input: prompt,
        ...(withEffort ? { reasoning: { effort: "low" } } : {}),
      }),
      signal: AbortSignal.timeout(Math.max(1, remainingMs())),
    });

  let res: Response;
  try {
    res = await attempt(true);
    if (res.status === 400 && remainingMs() > 0) {
      // Older models do not know the reasoning parameter.
      res = await attempt(false);
    }
  } catch {
    // Error detail stays server side. The game only needs to know the
    // call failed so it can fall back to its word parser.
    console.log(JSON.stringify({ event: "muse_spark", status: "fetch-failed" }));
    return json({ error: "muse request failed" }, 502);
  }

  if (!res.ok) {
    console.log(JSON.stringify({ event: "muse_spark", status: res.status }));
    return json({ error: `muse returned ${res.status}` }, 502);
  }

  const raw = (await res.json()) as unknown;
  const text = outputTextOf(raw);
  const parsed = firstJsonObject(text);
  if (!isRecord(parsed)) {
    console.log(JSON.stringify({ event: "muse_spark", status: "unparseable" }));
    return json({ error: "muse did not return JSON" }, 502);
  }

  const recipe = cleanRecipe(parsed.recipe);
  if (!recipe) {
    console.log(JSON.stringify({ event: "muse_spark", status: "bad-recipe" }));
    return json({ error: "muse recipe did not match the level format" }, 502);
  }

  const rawSay = tidy(typeof parsed.say === "string" ? parsed.say : "").slice(0, MAX_SAY_CHARS);
  const sayFiltered = rawSay !== "" && !kidSafeText(rawSay, childSaidOf(input));
  const say = sayFiltered ? "" : rawSay;
  console.log(
    JSON.stringify({
      event: "muse_spark",
      status: "ok",
      model: wantedModel,
      props: recipe.props.length,
      spots: recipe.spots.length,
      ...(sayFiltered ? { sayFiltered: true } : {}),
    }),
  );
  return json({ say: say || "Here is your world!", recipe });
}

/** Health check for the deploy preflight. */
export function museConfigured(env: MetaEnv): boolean {
  return Boolean(apiKey(env));
}
