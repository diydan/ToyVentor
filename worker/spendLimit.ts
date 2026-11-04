// A last-resort cost backstop in front of every route that spends on a model, using a Workers Rate Limiting binding (wrangler.jsonc "ratelimits",
// MODEL_SPEND_LIMITER: 10 requests per 60 s). It is in addition to the limits inside each route, which are per Worker instance and so reset whenever an
// instance is replaced; this one is kept by Cloudflare per location. It is approximate by design (Cloudflare: "requests can exceed your configured limit
// while counts update in the background") and per location, not account-wide. The account-wide WAF rate-limit rule is a dashboard setting, not wrangler.
//
// The key is the route plus the visitor's address (CF-Connecting-IP), so one noisy address cannot use up another's budget and one route cannot use up another's.
// Cloudflare's own advice is to avoid addresses as keys because many people share one (a school, a household behind one router); here a visitor has no account
// and the aim is to bound spend, so the address is the only stable thing there is. If a class of children on one network hits the limit, raise `limit` in
// wrangler.jsonc rather than removing this.
//
// Fails OPEN: no binding (local dev, tests) or an error from it means the request goes on to the route's own limits. The address is never logged.

export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface SpendLimitEnv {
  MODEL_SPEND_LIMITER?: RateLimitBinding;
}

/** POST routes that call a model (Meta's hosted API, or our own). Polls, artifacts and the song's other sub-routes are not here: they spend nothing. */
export const METERED_PATHS: ReadonlySet<string> = new Set([
  "/api/forge/make",
  "/api/describe",
  "/api/muse/spark",
  "/api/world/look", // a world's look: one text call, then three image calls through /api/world/art
  "/api/world/art",
  "/api/scan",
  "/api/skin",
  "/api/theme-song", // starting a song; its polls are /api/theme-song/<id>
  "/api/transcribe",
  "/api/selfie/face-parts",
  "/api/selfie/cartoon",
]);

export function isMetered(method: string, pathname: string): boolean {
  return method === "POST" && METERED_PATHS.has(pathname);
}

/** A 429 when this visitor has used the route's budget, otherwise null. */
export async function spendLimited(request: Request, env: SpendLimitEnv, pathname: string): Promise<Response | null> {
  const limiter = env.MODEL_SPEND_LIMITER;
  if (!limiter || !isMetered(request.method, pathname)) return null;
  try {
    const { success } = await limiter.limit({ key: `${pathname}|${request.headers.get("CF-Connecting-IP") ?? "unknown"}` });
    if (success) return null;
  } catch {
    return null; // fail open
  }
  console.log(JSON.stringify({ event: "spend_limit", status: "limited", path: pathname }));
  return new Response(JSON.stringify({ ok: false, status: "slow-down", error: "slow down" }), {
    status: 429,
    headers: { "content-type": "application/json", "cache-control": "no-store", "retry-after": "30" },
  });
}
