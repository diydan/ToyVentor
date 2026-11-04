/**
 * The real Worker, in this process, behind the real client loop: how the sampler and the evaluator send a wish through exactly what a child's request goes through
 * (intake, the model call, the allowlist, the daemon's gates, the name filters), with nothing stubbed but the database. The daemon must be running (`npm run forge:optimizer`).
 *
 * The key is read from .dev.vars into memory and passed to the Worker; nothing here prints it, logs it or writes it anywhere.
 */
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { makeFromText, type MakeResult } from "../../../shared/forgeMakeFlow";
import type { MakeSlot } from "../../../shared/forgeMakeLimits";
import { resetForgeRateLimit } from "../../../worker/forgeOptimizer";
import forgeWorker from "../../../worker/index";
const HERE = fileURLToPath(new URL(".", import.meta.url));

const ROOT = join(HERE, "..", "..", "..");

/** KEY=VALUE lines of .dev.vars (comments and blanks skipped). Never log the result. */
export function readDevVars(file = join(ROOT, ".dev.vars")): Record<string, string> {
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (m) out[m[1]!] = m[2]!.trim();
  }
  return out;
}

export interface BackendOptions {
  /** Our own model's base URL, e.g. https://<workspace>--toyventor-glimmer.us-east.modal.run/v1 */
  url: string;
  /** The model name the server answers to. */
  model: string;
  key?: string;
  api?: "chat" | "responses";
  /** "tuned" sends the short prompt (shared/forgeTunePrompt.ts); only for a model trained on it. */
  prompt?: "base" | "tuned";
  /** Glimmer's reasoning strength line; "off" sends none. Default low, which is what production sends. */
  reasoning?: string;
  daemonUrl?: string;
}

function fakeDb() {
  const settings = new Map<string, string>();
  return {
    prepare: (sql: string) => ({
      bind: (...v: unknown[]) => ({
        run: async () => {
          if (sql.includes("INSERT INTO parent_settings")) {
            const [id, t] = v as [string, string];
            if (!sql.includes("DO NOTHING") || !settings.has(id)) settings.set(id, t);
          }
          return {};
        },
        all: async () => (sql.includes("FROM parent_settings") ? { results: settings.has(v[0] as string) ? [{ settings_json: settings.get(v[0] as string) }] : [] } : { results: [] }),
      }),
    }),
  };
}

/** A Worker environment pointing the text capability at OUR OWN model (never the hosted API: MODEL_BACKEND is "self" and there is no Meta key in it). */
export function buildEnv(o: BackendOptions) {
  return {
    DB: fakeDb(),
    PARENT_GATE_SECRET: "tuning-harness-only-secret",
    FORGE_OPTIMIZER_URL: o.daemonUrl ?? "http://127.0.0.1:8791",
    // signatures are irrelevant to sampling, but names are only returned when signing is configured: a throwaway, non-secret value
    VOICE_SIGNING_KEY: "tuning-harness-signing-key-not-a-secret-0123456789",
    MODEL_BACKEND: "self",
    SELF_TEXT_URL: o.url,
    SELF_TEXT_MODEL: o.model,
    SELF_TEXT_API: o.api ?? "chat",
    ...(o.key ? { SELF_TEXT_KEY: o.key } : {}),
    ...(o.prompt === "tuned" ? { SELF_TEXT_PROMPT: "tuned" } : {}),
    ...(o.reasoning !== undefined ? { SELF_TEXT_REASONING: o.reasoning } : {}),
  };
}

export type Env = ReturnType<typeof buildEnv>;

/** Sends one wish through the Worker and the client loop. Each call is a new device and a fresh rate limit, as a real child's would be. */
export function makeCaller(env: Env) {
  let n = 0;
  return async (text: string, slot?: MakeSlot): Promise<{ result: MakeResult; secs: number }> => {
    const device = `tun-${String(++n % 10000).padStart(4, "0")}-aaaa-bbbb-cccc-dddddddddddd`.slice(0, 36);
    const t0 = Date.now();
    const result = await makeFromText({
      text,
      ...(slot ? { slot } : {}),
      gate: { headers: () => ({ "x-device-id": device }) },
      fetch: async (url, init) => {
        resetForgeRateLimit();
        return forgeWorker.fetch(new Request(`http://local${url}`, init as RequestInit), env as never);
      },
    });
    return { result, secs: Math.round((Date.now() - t0) / 100) / 10 };
  };
}
