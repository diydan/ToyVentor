// The Make-from-words maker as a Cloudflare Container (scripts/forge_optimizer_daemon.py, unchanged, in ./Dockerfile).
//
// This Worker has no public address (workers_dev and preview URLs are off, no routes). The main Worker calls it through a service binding,
// so the daemon is never on the internet. It adds the Bearer token the daemon requires for a non-loopback bind; the token is a secret of THIS
// Worker (`wrangler secret put FORGE_OPTIMIZER_TOKEN`, run in this folder), and the main Worker never sees it.
//
// One named instance ("forge") on purpose: the daemon keeps its jobs in memory, so a job started by one request is polled by the next, and
// both must reach the same process. The container sleeps after 10 idle minutes; the next request starts it (import and warm-up take a few
// seconds, hence the long port wait). A restart loses running jobs; the client then falls back to a ready-made part, as it does when the
// maker is unreachable.
import { Container, getContainer } from "@cloudflare/containers";

interface Env {
  FORGE_MAKER: DurableObjectNamespace<ForgeMaker>;
  FORGE_OPTIMIZER_TOKEN?: string;
}

const PORT = 8791;

export class ForgeMaker extends Container<Env> {
  defaultPort = PORT;
  sleepAfter = "10m";
  /** The daemon needs no outbound access. */
  enableInternet = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.envVars = { FORGE_OPTIMIZER_TOKEN: env.FORGE_OPTIMIZER_TOKEN?.trim() ?? "" };
  }

  override async fetch(request: Request): Promise<Response> {
    if (!this.ctx.container?.running) {
      await this.startAndWaitForPorts({
        ports: PORT,
        cancellationOptions: { portReadyTimeoutMS: 90_000, instanceGetTimeoutMS: 30_000, abort: request.signal },
      });
    }
    return super.fetch(request);
  }
}

const reply = (status: number, body: Record<string, unknown>): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const token = env.FORGE_OPTIMIZER_TOKEN?.trim();
    if (!token) return reply(503, { ok: false, status: "disabled" }); // fail closed: no token, no daemon
    const { pathname } = new URL(request.url);
    // Only the daemon's own routes (health, jobs, artifacts, fast preview).
    if (pathname !== "/health" && !pathname.startsWith("/v1/")) return reply(404, { ok: false, status: "not-found" });
    const headers = new Headers(request.headers);
    headers.set("authorization", `Bearer ${token}`);
    return getContainer(env.FORGE_MAKER, "forge").fetch(new Request(request, { headers }));
  },
};
