import {
  checkForgeRecipeBrandSafety,
  type ForgeFastPreviewRequest,
} from "../shared/forgeOptimizer";
import { readCappedJson } from "./body";

export interface ForgeOptimizerEnv {
  FORGE_OPTIMIZER_URL?: string;
  FORGE_OPTIMIZER_TOKEN?: string;
}

const MAX_FORGE_BODY_BYTES = 4_000_000;
const JOB_ID_RE = /^fjob_[a-f0-9]{8,32}$/;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function forgeOptimizerConfigured(env: ForgeOptimizerEnv): boolean {
  return typeof env.FORGE_OPTIMIZER_URL === "string" && env.FORGE_OPTIMIZER_URL.trim().length > 0;
}

function upstreamUrl(env: ForgeOptimizerEnv, path: string): string {
  const base = (env.FORGE_OPTIMIZER_URL ?? "").trim().replace(/\/+$/, "");
  return `${base}${path}`;
}

function upstreamHeaders(env: ForgeOptimizerEnv): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (env.FORGE_OPTIMIZER_TOKEN) {
    headers["authorization"] = `Bearer ${env.FORGE_OPTIMIZER_TOKEN}`;
  }
  return headers;
}

export async function handleForgePreview(
  request: Request,
  env: ForgeOptimizerEnv,
): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }
  if (!forgeOptimizerConfigured(env)) {
    return json(
      {
        ok: false,
        configured: false,
        error: "FORGE_OPTIMIZER_URL is not configured (run `npm run forge:optimizer` locally)",
      },
      503,
    );
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return json({ error: "expected application/json" }, 415);
  }

  const parsed = await readCappedJson(request, MAX_FORGE_BODY_BYTES);
  if (!parsed.ok) {
    return json(
      { error: parsed.over ? `payload over ${MAX_FORGE_BODY_BYTES} bytes` : "invalid JSON body" },
      parsed.over ? 413 : 400,
    );
  }

  const payload = parsed.value as ForgeFastPreviewRequest;
  if (payload && typeof payload === "object" && payload.recipe) {
    const brandErr = checkForgeRecipeBrandSafety(payload.recipe);
    if (brandErr) {
      return json({ ok: false, error: brandErr }, 422);
    }
  }

  try {
    const res = await fetch(upstreamUrl(env, "/v1/fast-preview"), {
      method: "POST",
      headers: upstreamHeaders(env),
      body: JSON.stringify(payload),
    });
    const out = await res.json();
    console.log(
      JSON.stringify({
        event: "forge_fast_preview",
        status: res.status,
        hasRecipe: Boolean(payload?.recipe),
      }),
    );
    return json(out, res.status);
  } catch (err) {
    console.log(
      JSON.stringify({
        event: "forge_fast_preview_error",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return json({ ok: false, error: "optimizer upstream unreachable" }, 502);
  }
}

export async function handleForgeJobStatus(
  request: Request,
  env: ForgeOptimizerEnv,
  jobId: string,
): Promise<Response> {
  if (request.method !== "GET") {
    return json({ error: "method not allowed" }, 405);
  }
  if (!JOB_ID_RE.test(jobId)) {
    return json({ ok: false, error: "invalid job id" }, 400);
  }
  if (!forgeOptimizerConfigured(env)) {
    return json({ ok: false, configured: false, error: "FORGE_OPTIMIZER_URL is not configured" }, 503);
  }

  try {
    const res = await fetch(upstreamUrl(env, `/v1/jobs/${jobId}`), {
      method: "GET",
      headers: upstreamHeaders(env),
    });
    const out = await res.json();
    return json(out, res.status);
  } catch (err) {
    console.log(
      JSON.stringify({
        event: "forge_job_poll_error",
        jobId,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return json({ ok: false, error: "optimizer upstream unreachable" }, 502);
  }
}
