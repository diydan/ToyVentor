// ToyForge API Worker. Static assets are served before this Worker runs;
// it only sees /api/* (plus SPA fallback misses). Secrets live here and in
// .dev.vars locally — never in the browser bundle.
//
// Meta SAM/Muse calls land in worker/meta.ts, Mureka in mureka.ts, and
// D1/KV ownership in ownership.ts as those features start (plan Day 2+).
import seedCar from "../seed/toys/seed-car.json";

export interface Env {
  META_MODEL_API_KEY?: string;
  MUREKA_API_KEY?: string;
  ASSETS?: { fetch: (request: Request) => Promise<Response> };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({ ok: true, service: "toyforge" });
    }

    // Foundation scan route: until live SAM is wired (Day 2), this returns
    // the preloaded backup toy. source:"seed" keeps that honest end to end.
    if (url.pathname === "/api/scan") {
      return json(seedCar);
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "not found" }, 404);
    }

    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  },
};
