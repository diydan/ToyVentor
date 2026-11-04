/**
 * The one place that decides where a model call goes: Meta's hosted Model API, a model we host ourselves, or nowhere.
 *
 * Why it exists: the Meta Model API terms (section 10.1) bar End Users under 18 and products targeted at them, and ToyVentor is for children
 * (docs/decisions/0008-meta-models-and-under-18-users.md). Child-facing calls must be able to run on models we host, and the hosted ones must be
 * switchable off. Dan, 2026-11-03: "a switch between all Meta hosted models and our own".
 *
 * Rules (each has a test in tests/model-backend.test.ts):
 *  1. Server-side only. The mode comes from Worker variables; no request header, parameter or body can choose it, so a child cannot flip it.
 *  2. Four capabilities, each resolved on its own: text (Spark / Glimmer), segment (SAM), image (image edit), transcribe (speech to text).
 *     A capability's own variable (TEXT_BACKEND, SEGMENT_BACKEND, IMAGE_BACKEND, TRANSCRIBE_BACKEND) wins, then the master MODEL_BACKEND, then DEFAULT_MODE.
 *     One master switch for the policy, per-capability overrides because our own models will not all be ready on the same day.
 *  3. FAIL CLOSED. "self" never falls back to hosted: a self-hosted capability with no endpoint is OFF. A misspelt mode is OFF. Hosted without the Meta key is OFF.
 *  4. Nothing here logs or returns a URL or a key; `describeBackends` gives modes only.
 *
 * A route that is off answers with the status it already uses for "not configured", and its client already degrades from that.
 */
// Types only: this module has no runtime import of its callers, so there is no import cycle (muse.ts re-exports the helpers below).
import type { MetaEnv } from "./meta";
import type { MuseEnv } from "./muse";

export const DEFAULT_TEXT_MODEL = "muse-spark-1.3";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Model ids the kid-facing text routes will call on the hosted API. Anything else is refused, so a client cannot use a kid-facing route to reach another model. */
export function resolveModel(requested: unknown, env: MuseEnv): string | null {
  const wanted = typeof requested === "string" ? requested : "";
  if (wanted && !/^muse-spark/i.test(wanted)) return null;
  const configured = env.MUSE_SPARK_MODEL?.trim();
  if (configured && /^muse-spark/i.test(configured)) return configured;
  return DEFAULT_TEXT_MODEL;
}

/** The hosted API's base URL plus a path. */
export function apiUrl(env: MetaEnv, path: string): string {
  const base = (env.META_MODEL_API_URL ?? "https://api.meta.ai/v1").replace(/\/+$/, "").replace(/\/responses$/, "");
  return `${base}${path}`;
}

/** The hosted API's key. Read only here, so the switch below is the only way to a hosted call. */
export function apiKey(env: MetaEnv): string | undefined {
  return env.MODEL_API_KEY ?? env.META_MODEL_API_KEY;
}

/** Pull the plain text out of a Responses API body. */
export function outputTextOf(body: unknown): string {
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

export const CAPABILITIES = ["text", "segment", "image", "transcribe"] as const;
export type Capability = (typeof CAPABILITIES)[number];
export type BackendMode = "hosted" | "self" | "off";
export type OffReason = "disabled" | "invalid" | "not_configured";

/**
 * What an unset switch means. "hosted" keeps today's behaviour for the Nov 4 build (the demo is run by adults, option B in decision 0008).
 * After the demo this becomes "off" (or "self") for the child-facing deployment: change this one constant and update the tests that say so.
 */
export const DEFAULT_MODE: BackendMode = "hosted";

export interface BackendEnv extends MuseEnv {
  /** Master switch: hosted | self | off. */
  MODEL_BACKEND?: string;
  TEXT_BACKEND?: string;
  SEGMENT_BACKEND?: string;
  IMAGE_BACKEND?: string;
  TRANSCRIBE_BACKEND?: string;
  /** Our own text model: base URL (https, or http on localhost), optional key, the served model name, and which API shape it speaks. */
  SELF_TEXT_URL?: string;
  SELF_TEXT_KEY?: string;
  SELF_TEXT_MODEL?: string;
  /** "responses" (default, the shape the hosted model uses) or "chat" (/chat/completions). llama.cpp and vLLM serve Glimmer on the chat shape. */
  SELF_TEXT_API?: string;
  /** Glimmer takes its reasoning strength from the system prompt ("Reasoning strength: low"), not from an API parameter. low (default), medium, high, xhigh; "off" sends none. */
  SELF_TEXT_REASONING?: string;
  /**
   * Which prompt the make route sends our own text model: "base" (default, the long prompt that teaches the Recipe v1 operations) or "tuned" (the short prompt in shared/forgeTunePrompt.ts, for a
   * model trained on it: scripts/tuning/README.md). Only "tuned", spelt exactly, selects it; anything else is "base". Never applies to the hosted API.
   */
  SELF_TEXT_PROMPT?: string;
  /**
   * The FAST PATH (docs/specs/forge-ai-spec.md, "Fast path"): a second model of ours, tuned on Recipe v1, asked FIRST for a hat or head wish, with the standard model above as the fallback.
   * FORGE_FAST_MODE: "on" = every make request tries it first unless the client says fast:false; "optin" = only when the client says fast:true; anything else, unset included = never.
   * It needs SELF_FAST_URL and SELF_FAST_MODEL; it is always our own server (chat shape) and reads the production prompt, which is the text it was trained on. The standard backend, hosted or self, is the fallback.
   */
  FORGE_FAST_MODE?: string;
  /** "off" (exactly) = the server-wide child lock: the hosted model is never used, whatever a device says. See Audience. */
  FORGE_HOSTED_FOR_ADULTS?: string;
  /** What a request that names no audience gets: "child" or "adult"; anything else is DEFAULT_AUDIENCE. */
  FORGE_AUDIENCE_DEFAULT?: string;
  SELF_FAST_URL?: string;
  SELF_FAST_KEY?: string;
  SELF_FAST_MODEL?: string;
  SELF_SEGMENT_URL?: string;
  SELF_SEGMENT_KEY?: string;
  SELF_IMAGE_URL?: string;
  SELF_IMAGE_KEY?: string;
  SELF_TRANSCRIBE_URL?: string;
  SELF_TRANSCRIBE_KEY?: string;
}

export interface Backend {
  capability: Capability;
  mode: BackendMode;
  /** Only when mode is "off". */
  reason: OffReason | null;
  baseUrl: string | null;
  key: string | null;
  /** The model id to send, for the text capability; the other capabilities keep their own ids in their routes. */
  model: string | null;
  /** Which API shape the text model speaks. */
  api: "responses" | "chat";
  /** Our own text model only: the reasoning strength sent in the system prompt, or null for none. */
  reasoning: string | null;
  /** Which prompt the make route builds for this backend (see BackendEnv.SELF_TEXT_PROMPT). */
  promptStyle: "base" | "tuned";
}

const SPECIFIC: Record<Capability, keyof BackendEnv> = {
  text: "TEXT_BACKEND",
  segment: "SEGMENT_BACKEND",
  image: "IMAGE_BACKEND",
  transcribe: "TRANSCRIBE_BACKEND",
};
const SELF_URL: Record<Capability, keyof BackendEnv> = {
  text: "SELF_TEXT_URL",
  segment: "SELF_SEGMENT_URL",
  image: "SELF_IMAGE_URL",
  transcribe: "SELF_TRANSCRIBE_URL",
};
const SELF_KEY: Record<Capability, keyof BackendEnv> = {
  text: "SELF_TEXT_KEY",
  segment: "SELF_SEGMENT_KEY",
  image: "SELF_IMAGE_KEY",
  transcribe: "SELF_TRANSCRIBE_KEY",
};

const norm = (v: unknown): string => (typeof v === "string" ? v.trim().toLowerCase() : "");
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** The mode a capability asks for, before anything is checked to be configured. A value that is not one of the three is "off" and marked invalid. */
export function requestedMode(env: BackendEnv, capability: Capability): { mode: BackendMode; invalid: boolean } {
  const raw = norm(env[SPECIFIC[capability]]) || norm(env.MODEL_BACKEND) || DEFAULT_MODE;
  if (raw === "hosted" || raw === "self" || raw === "off") return { mode: raw, invalid: false };
  return { mode: "off", invalid: true };
}

/** A self-hosted base URL: https, or http only on this machine, no embedded credentials, no query or fragment. Trailing slashes are dropped. */
export function parseSelfUrl(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return null;
  if (u.username || u.password || u.search || u.hash) return null;
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
}

const OFF = (capability: Capability, reason: OffReason): Backend => ({ capability, mode: "off", reason, baseUrl: null, key: null, model: null, api: "responses", reasoning: null, promptStyle: "base" });

export function resolveBackend(env: BackendEnv, capability: Capability): Backend {
  const { mode, invalid } = requestedMode(env, capability);
  if (invalid) return OFF(capability, "invalid");
  if (mode === "off") return OFF(capability, "disabled");

  if (mode === "hosted") {
    const key = apiKey(env);
    if (!key) return OFF(capability, "not_configured");
    return { capability, mode, reason: null, baseUrl: apiUrl(env, ""), key, model: capability === "text" ? resolveModel(undefined, env) : null, api: "responses", reasoning: null, promptStyle: "base" };
  }

  // self: never falls through to hosted
  return selfBackend(env, capability);
}

/**
 * Our own server for a capability, whatever the master switch says: the backend a CHILD's request is allowed to use (the hosted API is for adults: see Audience below). Off ("not_configured")
 * when the address, or for text the served model name, is missing.
 */
export function selfBackend(env: BackendEnv, capability: Capability): Backend {
  const baseUrl = parseSelfUrl(env[SELF_URL[capability]]);
  if (!baseUrl) return OFF(capability, "not_configured");
  const model = capability === "text" ? text(env.SELF_TEXT_MODEL) : "";
  if (capability === "text" && !model) return OFF(capability, "not_configured"); // the served model name is part of every request
  const key = text(env[SELF_KEY[capability]]) || null;
  const api = capability === "text" && norm(env.SELF_TEXT_API) === "chat" ? "chat" : "responses";
  const strength = norm(env.SELF_TEXT_REASONING) || "low";
  const reasoning = capability === "text" && ["low", "medium", "high", "xhigh"].includes(strength) ? strength : null; // anything else, "off" included, sends none
  const promptStyle = capability === "text" && norm(env.SELF_TEXT_PROMPT) === "tuned" ? "tuned" : "base";
  return { capability, mode: "self", reason: null, baseUrl, key, model: model || null, api, reasoning, promptStyle };
}

/**
 * WHO the service treats a make request as being for. The hosted model is for adults (18+); a child's request is only ever sent to our own models, and if none is configured the child
 * gets no part, never an outside one. The SERVICE decides, not the device: there is no parent-facing choice and a client cannot name an audience (a field that says so is ignored).
 *  - FORGE_HOSTED_FOR_ADULTS = "off" (exactly) is the server-wide child lock: every request is a child's, so make-from-words runs on our own models only;
 *  - otherwise FORGE_AUDIENCE_DEFAULT ("child" or "adult"), else the constant below.
 * The constant is "adult" for the Nov 4 build only because the demo is run by adults (decision 0008, option B, like DEFAULT_MODE): it lets the hosted model stay as the fallback and the
 * repairer while our tuned model is proven. Flip it to "child" (or set the lock) for the child-facing deployment, with the tests that say so. A practical control, not an age check and not compliance.
 */
export type Audience = "child" | "adult";
export const DEFAULT_AUDIENCE: Audience = "adult";
export function effectiveAudience(env: BackendEnv): Audience {
  if (text(env.FORGE_HOSTED_FOR_ADULTS).toLowerCase() === "off") return "child";
  const d = norm(env.FORGE_AUDIENCE_DEFAULT);
  return d === "child" ? "child" : d === "adult" ? "adult" : DEFAULT_AUDIENCE;
}

export type FastMode = "on" | "optin" | "off";

/** Only the exact words "on" and "optin" turn the fast path on; anything else, unset included, is off. */
export function fastMode(env: BackendEnv): FastMode {
  const m = norm(env.FORGE_FAST_MODE);
  return m === "on" ? "on" : m === "optin" ? "optin" : "off";
}

/**
 * The tuned model as a backend, or null when the fast path is off or not fully configured (an address and a served model name). It is ALWAYS our own server (mode "self", the chat
 * shape llama.cpp serves, Glimmer's reasoning line, the production prompt it was trained on), whatever the standard text backend is: with the standard backend hosted (today's
 * adult-operated demo) the fast path still runs our own model first and the hosted model stays the fallback and the repairer; with it self, the base Glimmer is. "off" on the standard
 * backend still means off for everything, the fast path included (the make route answers 503 before it looks here).
 */
export function resolveFastBackend(env: BackendEnv): Backend | null {
  if (fastMode(env) === "off") return null;
  const baseUrl = parseSelfUrl(env.SELF_FAST_URL);
  const model = text(env.SELF_FAST_MODEL);
  if (!baseUrl || !model) return null;
  const strength = norm(env.SELF_TEXT_REASONING) || "low";
  const reasoning = ["low", "medium", "high", "xhigh"].includes(strength) ? strength : null;
  return { capability: "text", mode: "self", reason: null, baseUrl, key: text(env.SELF_FAST_KEY) || null, model, api: "chat", reasoning, promptStyle: "base" };
}

/** Modes only, for logs and for a future capabilities route: never a URL, a key or a model name. */
export function describeBackends(env: BackendEnv): Record<Capability, BackendMode> {
  const out = {} as Record<Capability, BackendMode>;
  for (const c of CAPABILITIES) out[c] = resolveBackend(env, c).mode;
  return out;
}

/** The text of a /chat/completions reply (a string, or a list of parts with text), or "". */
export function chatTextOf(body: unknown): string {
  if (typeof body !== "object" || body === null) return "";
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || typeof choices[0] !== "object" || choices[0] === null) return "";
  const message = (choices[0] as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p) => (typeof p === "object" && p !== null && typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : "")).join("");
  return "";
}

/**
 * For a capability that has no adapter for our own model yet (segment, image, and the photo-nouns look): the hosted URL builder and key, or null when it
 * is not hosted. "self" is null ON PURPOSE: with no adapter it is not configured, and it must never become a quiet call to Meta.
 */
export function hostedOnly(env: BackendEnv, capability: Capability): { key: string; url: (path: string) => string } | null {
  const b = resolveBackend(env, capability);
  if (b.mode !== "hosted" || !b.key) return null;
  return { key: b.key, url: (path) => apiUrl(env, path) };
}

export type AskResult = { ok: true; text: string } | { ok: false; status: number | null };

/**
 * One text-model call for every kid-facing text route: low reasoning effort, and the same request again without it if the model refuses the parameter, both
 * inside one time budget. WHERE it goes is the backend's decision (resolveBackend), never this function's. `model` is honoured for the hosted API only (Create
 * mode lets the game ask for a Spark version); our own model's name always comes from the backend. `status` is the upstream HTTP status, or null when there was
 * no answer (off, timeout, network, an unreadable body). Nothing is logged here: callers log their own event names.
 *
 * ONE RETRY, our own model only (2026-11-04). Modal's web proxy in front of llama-server dropped its connection to the server on 3 of 37 calls in the first 40-wish run
 * (`ServerDisconnectedError`, a 500 inside 0.3 to 1.1 s, before any token was generated; the server's own log shows no error). Such a call did no work, so asking again costs
 * nothing and is safe. It is retried once, after a short pause, only for HTTP 500, 502, 503 or 504 or a network error that arrived while at least RETRY_MIN_LEFT_MS of the budget
 * is left. A timeout, a 4xx, an unreadable reply and every hosted call are never retried.
 *
 * RETRY_MIN_LEFT_MS is small because the failure it covers is FAST: the proxy drops the connection in about a second, so the budget is barely touched and the call is worth
 * asking again as long as a few seconds are left. What the retried call needs is a budget that fits a whole answer, and that is the route's job: the routes that talk to
 * Glimmer give askText 45 s, because a measured Glimmer answer took 11 to 46 s (median about 20 s) and a retry with 13 s of budget would have turned a 500 into a timeout.
 */
const RETRYABLE_STATUS = new Set([500, 502, 503, 504]);
export const RETRY_MIN_LEFT_MS = 3_000;
export const RETRY_PAUSE_MS = 400;

/** `onRetry` is called once if our own model is asked a second time, so a route can put "retried" in its log line (the result's shape is deliberately unchanged). */
export async function askText(backend: Backend, prompt: string, opts: { timeoutMs: number; model?: string; onRetry?: () => void }): Promise<AskResult> {
  if (backend.mode === "off" || !backend.baseUrl) return { ok: false, status: null };
  const model = backend.mode === "hosted" && opts.model ? opts.model : backend.model;
  if (!model) return { ok: false, status: null };
  const chat = backend.api === "chat";
  const self = backend.mode === "self";
  const system = self && backend.reasoning ? `Reasoning strength: ${backend.reasoning}` : null; // Glimmer's way to say how hard to think
  const startedAt = Date.now();
  const remaining = () => opts.timeoutMs - (Date.now() - startedAt);
  // The hosted API takes a `reasoning` parameter (and a retry without it for models that refuse it); our own model does not, so it gets neither.
  const attempt = (withEffort: boolean): Promise<Response> =>
    fetch(`${backend.baseUrl}${chat ? "/chat/completions" : "/responses"}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(backend.key ? { authorization: `Bearer ${backend.key}` } : {}) },
      body: JSON.stringify(
        chat
          ? { model, messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }], ...(withEffort && !self ? { reasoning_effort: "low" } : {}) }
          : { model, input: prompt, ...(system ? { instructions: system } : {}), ...(withEffort && !self ? { reasoning: { effort: "low" } } : {}) },
      ),
      signal: AbortSignal.timeout(Math.max(1, remaining())),
    });
  const canRetry = () => self && remaining() >= RETRY_MIN_LEFT_MS;
  let retried = false;
  for (;;) {
    try {
      let res = await attempt(true);
      if (res.status === 400 && !self && remaining() > 0) res = await attempt(false); // older hosted models do not know the reasoning parameter
      if (!res.ok) {
        if (!retried && RETRYABLE_STATUS.has(res.status) && canRetry()) {
          retried = true;
          opts.onRetry?.();
          await new Promise((r) => setTimeout(r, RETRY_PAUSE_MS));
          continue;
        }
        return { ok: false, status: res.status };
      }
      const body = (await res.json()) as unknown;
      return { ok: true, text: chat ? chatTextOf(body) : outputTextOf(body) };
    } catch (err) {
      const timedOut = err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError");
      if (!retried && !timedOut && canRetry()) {
        retried = true;
        opts.onRetry?.();
        await new Promise((r) => setTimeout(r, RETRY_PAUSE_MS));
        continue;
      }
      return { ok: false, status: null };
    }
  }
}

