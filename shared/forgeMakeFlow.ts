/**
 * The client side of text to part (POST /api/forge/make, worker/forgeMake.ts): a child's words in, a part out, with the real stages a waiting
 * strip can show (docs/specs/forge-ai-spec.md, "Naming and the waiting state"). Nothing here touches the DOM, the clock or the network except through
 * what the caller passes in, so the whole loop is testable and the screen only has to draw the stages.
 *
 * The loop, one wish: ask the Worker for a part (one model call: recipe and names). The first look comes back at once and can be turned while the
 * checks run. Poll the job. If the checks fail, ask again with the recipe and the job (a repair), up to 4 calls in all (the spec's F1 budget). A refused
 * call (the Worker allows 3 a minute) is waited out for as long as `retry-after` says; an expired grown-up check is renewed. Every end is a result:
 * this never throws. A part that never passes the checks still ends usefully: the best first look, marked fine on screen and not printable.
 */
import { MAKE_MAX_CALLS, type MakeSlot } from "./forgeMakePrompt";
import type { ForgeRecipeV1 } from "./forgeOptimizer";

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export const MAKE_ROUTE = "/api/forge/make";
export const JOB_ROUTE = "/api/forge/jobs/";
export const ARTIFACT_ROUTE = "/api/forge/artifacts/";
/** The Worker allows 30 polls a minute per device (worker/forgeOptimizer.ts LIMITS.poll): one every 2.2 s stays inside it. */
export const POLL_EVERY_MS = 2200;
/** The longest one job is waited for: the slowest measured gate run (a slim head's small-part rescale) took about 150 s. */
export const JOB_TIMEOUT_MS = 240_000;
/** Used when a refusal names no time: a full 60 s window and a second, the soonest a retry is sure to be let in. */
export const DEFAULT_WAIT_S = 61;

/** One language's name with the signature that lets /api/voice speak it (worker/forgeNames.ts). */
export interface SignedName {
  w: string;
  g: "m" | "f" | "n";
  pl?: true;
  sig: string;
}

export type MakeProgress =
  /** Model call `call` (of at most 4) has started. */
  | { stage: "proposing"; call: number }
  /** The first look arrived: it can be shown and turned while the checks run. */
  | { stage: "preview"; call: number; name: string; glbBase64: string }
  /** The checks are running on call `call`. */
  | { stage: "checking"; call: number }
  /** The checks failed and a corrected part is being asked for: call `call` is the new one. */
  | { stage: "fixing"; call: number }
  /** A call was refused for now; waiting `seconds` before asking again. */
  | { stage: "waiting"; call: number; seconds: number }
  /** The grown-up check ran out: it is being asked again. */
  | { stage: "asking_again"; call: number };

export type MakeFailureReason =
  | "gate_required"
  | "disabled"
  | "not_allowed"
  | "brand_rejected"
  | "invalid"
  | "unavailable"
  | "no_recipe"
  | "too_many_waits";

export type MakeResult =
  | {
      ok: true;
      /** True when the checks passed and the part can be printed; false when it is only fine on screen. */
      printable: boolean;
      recipe: ForgeRecipeV1;
      name: string;
      names: Partial<Record<"en" | "es" | "fr" | "de" | "it" | "pt" | "tr", SignedName>>;
      jobId: string;
      /** The finished STL's artifact name (fetch it with `artifactUrl`), only when printable. */
      stlArtifact: string | null;
      /** The first look of the last part, base64 GLB. */
      glbBase64: string;
      calls: number;
      /** What failed on the last try when it is not printable, as gate ids: for the log, never shown to a child. */
      gates: string[];
    }
  | { ok: false; reason: MakeFailureReason; message: string; calls: number };

export interface MakeArgs {
  /** What the child typed. The Worker cleans and checks it; this only trims. */
  text: string;
  slot?: MakeSlot;
  /** What every Forge request carries: the device id and the grown-up proof (the app's parent gate: `gate.headers()`). */
  gate: { headers(): Record<string, string> };
  fetch: Fetch;
  onProgress?: (e: MakeProgress) => void;
  /** Called when a request is refused for want of a live proof: ask the grown-up again, and say whether it worked. Without it that ends the wish. */
  renewGate?: () => Promise<boolean>;
  /** How to wait out a refused call. Default: real time. */
  sleep?: (ms: number) => Promise<void>;
  /** How long between polls of a job. Default: POLL_EVERY_MS of real time. */
  pollSleep?: (ms: number) => Promise<void>;
  /** How many refused calls to wait out in all. Default 6. */
  maxWaits?: number;
  /** The longest to wait for one refused call, whatever the Worker says. Default 90 s. */
  maxWaitSeconds?: number;
  /** The longest to wait for one job. Default JOB_TIMEOUT_MS. */
  jobTimeoutMs?: number;
  now?: () => number;
}

export const artifactUrl = (name: string): string => `${ARTIFACT_ROUTE}${name}`;

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const MESSAGES: Record<MakeFailureReason, string> = {
  gate_required: "The grown-up check ran out. Please ask a grown-up again.",
  disabled: "Making parts from words is not turned on here.",
  not_allowed: "Let's make something else. Try another idea.",
  brand_rejected: "That name is not allowed. Try another idea.",
  invalid: "That idea could not be used. Try a few other words.",
  unavailable: "The parts maker is busy. Please try again in a minute.",
  no_recipe: "I could not make that one. Try another idea.",
  too_many_waits: "Too many tries. Please wait a minute and try again.",
};
const fail = (reason: MakeFailureReason, calls: number): MakeResult => ({ ok: false, reason, message: MESSAGES[reason], calls });

type Reply = { status: number; body: Record<string, unknown>; retryAfterS: number | null };

/**
 * Make a part from words. Never throws: every end is a MakeResult.
 */
export async function makeFromText(args: MakeArgs): Promise<MakeResult> {
  const { gate, onProgress } = args;
  const sleep = args.sleep ?? defaultSleep;
  const pollSleep = args.pollSleep ?? defaultSleep;
  const maxWaits = args.maxWaits ?? 6;
  const maxWaitSeconds = args.maxWaitSeconds ?? 90;
  const jobTimeoutMs = args.jobTimeoutMs ?? JOB_TIMEOUT_MS;
  const now = args.now ?? (() => Date.now());
  const text = args.text.trim();
  let waits = 0;

  /** One request, with a refusal waited out and an expired proof renewed. Returns null when it cannot go on (a failure reason is set). */
  let stop: MakeFailureReason | null = null;
  async function ask(call: number, url: string, init: RequestInit): Promise<Reply | null> {
    let renewed = false;
    for (;;) {
      let res: Response;
      try {
        res = await args.fetch(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), ...gate.headers() } });
      } catch {
        stop = "unavailable";
        return null;
      }
      let body: Record<string, unknown> = {};
      try {
        const j: unknown = await res.json();
        if (isRecord(j)) body = j;
      } catch {
        // an artifact, or a body that is not JSON: only the status matters
      }
      const retry = Number(res.headers.get("retry-after"));
      const reply: Reply = { status: res.status, body, retryAfterS: Number.isFinite(retry) && retry > 0 ? retry : null };
      if (res.status === 429) {
        if (waits >= maxWaits) {
          stop = "too_many_waits";
          return null;
        }
        waits++;
        const seconds = Math.min(maxWaitSeconds, Math.max(1, Math.ceil(reply.retryAfterS ?? DEFAULT_WAIT_S)));
        onProgress?.({ stage: "waiting", call, seconds });
        await sleep(seconds * 1000);
        continue;
      }
      if (res.status === 401) {
        if (args.renewGate && !renewed) {
          renewed = true;
          onProgress?.({ stage: "asking_again", call });
          if (await args.renewGate()) continue;
        }
        stop = "gate_required";
        return null;
      }
      return reply;
    }
  }

  let repair: Record<string, unknown> | undefined;
  let lastRecipeKey = "";
  let best: Extract<MakeResult, { ok: true }> | null = null;
  let calls = 0;

  for (let call = 1; call <= MAKE_MAX_CALLS; call++) {
    calls = call;
    onProgress?.({ stage: call === 1 || !repair ? "proposing" : "fixing", call });
    const made = await ask(call, MAKE_ROUTE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, ...(args.slot ? { slot: args.slot } : {}), attempt: call, ...(repair ? { repair } : {}) }),
    });
    if (!made) return fail(stop ?? "unavailable", call);
    const status = String(made.body.status ?? "");
    if (made.status === 503) return fail("disabled", call);
    if (made.status === 422 && status === "bad-recipe") {
      // the daemon would not compile it: a repair with no job to ask about
      repair = { bad_recipe: true, recipe: made.body.recipe };
      continue;
    }
    if (made.status === 422) return fail(status === "not-allowed" ? "not_allowed" : status === "brand-rejected" ? "brand_rejected" : "invalid", call);
    if (made.status === 502 && status === "no-recipe") {
      repair = undefined; // nothing to repair: the same wish again
      continue;
    }
    if (made.status !== 200 || typeof made.body.job_id !== "string" || !isRecord(made.body.recipe)) return fail("unavailable", call);

    const recipe = made.body.recipe as unknown as ForgeRecipeV1;
    const jobId = made.body.job_id;
    const name = typeof made.body.name === "string" ? made.body.name : recipe.name;
    const glbBase64 = typeof made.body.glb_base64 === "string" ? made.body.glb_base64 : "";
    onProgress?.({ stage: "preview", call, name, glbBase64 });
    onProgress?.({ stage: "checking", call });

    // poll the job until the checks are done
    const started = now();
    let job: Record<string, unknown> | null = null;
    for (;;) {
      const polled = await ask(call, `${JOB_ROUTE}${jobId}`, { method: "GET" });
      if (!polled) return best ?? fail(stop ?? "unavailable", call);
      if (polled.status === 200 && ["print_ready", "digital_only", "failed"].includes(String(polled.body.status))) {
        job = polled.body;
        break;
      }
      if (polled.status !== 200 && polled.status !== 202) return best ?? fail("unavailable", call);
      if (now() - started > jobTimeoutMs) break; // the checks did not finish in time: the first look stands
      await pollSleep(POLL_EVERY_MS);
    }

    const gates = Array.isArray((job?.gate_report as { blocking_failures?: unknown } | undefined)?.blocking_failures)
      ? ((job!.gate_report as { blocking_failures: { id?: unknown }[] }).blocking_failures.map((f) => String(f.id ?? "")).filter(Boolean))
      : [];
    const names = isRecord(made.body.names) ? (made.body.names as Extract<MakeResult, { ok: true }>["names"]) : {};
    const printable = job?.status === "print_ready";
    const result: Extract<MakeResult, { ok: true }> = {
      ok: true,
      printable,
      recipe,
      name,
      names,
      jobId,
      stlArtifact: printable && typeof job?.stl_artifact === "string" ? job.stl_artifact : null,
      glbBase64,
      calls: call,
      gates: printable ? [] : gates.length > 0 ? gates : [String(job?.status ?? "unfinished")],
    };
    if (printable) return result;
    best = result;
    // No progress (the same recipe and the same failure twice) ends the loop: a fourth call of the same thing helps no one.
    const key = `${JSON.stringify(recipe)}|${result.gates.join(",")}`;
    if (key === lastRecipeKey || job === null) return result;
    lastRecipeKey = key;
    repair = { job_id: jobId, recipe };
  }
  return best ?? fail("no_recipe", calls);
}
