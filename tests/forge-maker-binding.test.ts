/**
 * The Worker reaches the Make-from-words maker (containers/forge-maker) through a service binding when FORGE_OPTIMIZER_URL is not set,
 * and keeps using the URL (the daemon on the Mac) when it is. No daemon runs here: the binding and the global fetch are stubs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchUpstreamJson,
  forgeOptimizerConfigured,
  gateForge,
  resetForgeRateLimit,
  upstreamUrl,
  type ForgeOptimizerEnv,
  type MakerBinding,
} from "../worker/forgeOptimizer";

const DEVICE = "12345678-1234-1234-1234-123456789abc";
const JOB = "fjob_0123456789ab";
const jsonReply = () => new Response(JSON.stringify({ ok: true, status: "queued" }), { status: 200, headers: { "content-type": "application/json" } });

const gate = (env: ForgeOptimizerEnv) =>
  gateForge(
    new Request("https://toyventor.test/api/forge/warm", { method: "POST", headers: { "content-type": "application/json", "x-device-id": DEVICE } }),
    env,
    "POST",
    "warm",
    "forge_warm",
    false,
  );

async function askJob(env: ForgeOptimizerEnv) {
  const g = await gate(env);
  if (!g.ok) throw new Error("the gate refused");
  return fetchUpstreamJson(upstreamUrl(g.baseUrl, `/v1/jobs/${JOB}`), { method: "GET" }, 1_000, "test");
}

let globalFetch: ReturnType<typeof vi.fn>;
let maker: MakerBinding & { fetch: ReturnType<typeof vi.fn> };

beforeEach(() => {
  resetForgeRateLimit();
  globalFetch = vi.fn(async () => jsonReply());
  vi.stubGlobal("fetch", globalFetch);
  maker = { fetch: vi.fn(async () => jsonReply()) };
});
afterEach(() => vi.unstubAllGlobals());

describe("the maker service binding", () => {
  it("is used when no URL is set, and the global fetch is not", async () => {
    const env: ForgeOptimizerEnv = { FORGE_MAKER: maker };
    expect(forgeOptimizerConfigured(env)).toBe(true);
    const up = await askJob(env);
    expect(up.ok).toBe(true);
    expect(maker.fetch).toHaveBeenCalledTimes(1);
    expect(maker.fetch.mock.calls[0]![0]).toBe(`http://forge-maker.internal/v1/jobs/${JOB}`);
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it("is ignored when a URL is set: the Mac daemon keeps working in dev, and a binding used before does not leak into the next call", async () => {
    await askJob({ FORGE_MAKER: maker }); // sets the binding as this instance's transport...
    resetForgeRateLimit();
    const up = await askJob({ FORGE_OPTIMIZER_URL: "http://127.0.0.1:8791", FORGE_MAKER: maker }); // ...which a URL environment must not inherit
    expect(up.ok).toBe(true);
    expect(globalFetch).toHaveBeenCalledTimes(1);
    expect(String(globalFetch.mock.calls[0]![0])).toBe(`http://127.0.0.1:8791/v1/jobs/${JOB}`);
    expect(maker.fetch).toHaveBeenCalledTimes(1); // only the first call
  });

  it("with neither a URL nor a binding the routes stay disabled and nothing is called", async () => {
    expect(forgeOptimizerConfigured({})).toBe(false);
    const g = await gate({});
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.response.status).toBe(503);
    expect(maker.fetch).not.toHaveBeenCalled();
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it("a failing binding is reported like an unreachable daemon, never as text from upstream", async () => {
    maker.fetch.mockRejectedValueOnce(new Error("internal detail that must not reach a child"));
    const up = await askJob({ FORGE_MAKER: maker });
    expect(up.ok).toBe(false);
    if (!up.ok) {
      expect(up.response.status).toBe(502);
      expect(await up.response.text()).not.toContain("internal detail");
    }
  });

  it("a 429 from the maker keeps its retry-after", async () => {
    maker.fetch.mockResolvedValueOnce(new Response("{}", { status: 429, headers: { "retry-after": "5" } }));
    const up = await askJob({ FORGE_MAKER: maker });
    expect(up.ok).toBe(false);
    if (!up.ok) {
      expect(up.response.status).toBe(429);
      expect(up.response.headers.get("retry-after")).toBe("5");
    }
  });
});
