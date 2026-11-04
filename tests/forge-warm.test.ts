/**
 * POST /api/forge/warm (worker/forgeMake.ts handleForgeWarm): a child opened "Make from words", so wake our own model. The properties that matter: it does nothing unless the text
 * backend is "self", it sends one GET to the model server's /health and nothing else (no key, no body, no child data), however often it is called it pings at most once every
 * WARM_PING_EVERY_MS, and it answers the same 202 whatever happened so it leaks neither the backend nor the address. Cost is the point: a sleeping GPU is cheap, an awake one is not.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WARM_PING_EVERY_MS, handleForgeWarm, resetForgeWarm, type ForgeMakeEnv } from "../worker/forgeMake";
import { resetForgeRateLimit } from "../worker/forgeOptimizer";
import worker from "../worker/index";

const DEVICE = "12345678-1234-1234-1234-123456789abc";
const SELF: ForgeMakeEnv = {
  FORGE_OPTIMIZER_URL: "http://127.0.0.1:8791",
  MODEL_BACKEND: "self",
  SELF_TEXT_URL: "https://glimmer.example.test/v1",
  SELF_TEXT_MODEL: "muse-glimmer-30b",
  SELF_TEXT_KEY: "own-key",
  MODEL_API_KEY: "meta-key",
};
const headers = { "content-type": "application/json", "x-device-id": DEVICE };

let calls: { url: string; init: RequestInit | undefined }[];
let waits: Promise<unknown>[];
const ctx = () => ({ waitUntil: (p: Promise<unknown>) => void waits.push(p) });
const warm = (env: ForgeMakeEnv = SELF, h: Record<string, string> = headers, method = "POST") =>
  handleForgeWarm(new Request("http://local/api/forge/warm", { method, headers: h, body: method === "POST" ? "{}" : undefined }), env, ctx());

beforeEach(() => {
  calls = [];
  waits = [];
  resetForgeWarm();
  resetForgeRateLimit();
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => { calls.push({ url: String(url), init }); return new Response("{\"status\":\"ok\"}", { status: 200 }); }));
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("what it sends", () => {
  it("self: one GET to the model server's health address (the origin, not /v1), with no key, no body and no wish", async () => {
    const res = await warm();
    expect(res.status).toBe(202);
    await Promise.all(waits);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://glimmer.example.test/health");
    expect(calls[0]!.init?.method).toBe("GET");
    expect(calls[0]!.init?.body).toBeUndefined();
    expect(new Headers(calls[0]!.init?.headers).get("authorization")).toBeNull();
    expect(JSON.stringify(calls[0])).not.toContain(DEVICE);
  });

  it("with the fast path on, the fast model's health address is pinged too (a cold fast model would time out its short leash); a missing or off fast path adds nothing", async () => {
    const fast = { ...SELF, FORGE_FAST_MODE: "on", SELF_FAST_URL: "https://fast.example.test/v1", SELF_FAST_MODEL: "forge-fast", SELF_FAST_KEY: "fast-key" };
    await warm(fast);
    await Promise.all(waits);
    expect(calls.map((c) => c.url).sort()).toEqual(["https://fast.example.test/health", "https://glimmer.example.test/health"]);
    for (const c of calls) expect(new Headers(c.init?.headers).get("authorization")).toBeNull(); // no key goes to either
    calls.length = 0;
    resetForgeWarm();
    resetForgeRateLimit();
    await warm({ ...fast, FORGE_FAST_MODE: "off" });
    await Promise.all(waits);
    expect(calls.map((c) => c.url)).toEqual(["https://glimmer.example.test/health"]);
  });

  it("with a HOSTED standard backend and the fast path on, only the fast model is pinged (the hosted API is never touched)", async () => {
    const hostedFast: ForgeMakeEnv = { FORGE_OPTIMIZER_URL: "http://127.0.0.1:8791", MODEL_API_KEY: "meta-key", FORGE_FAST_MODE: "on", SELF_FAST_URL: "https://fast.example.test/v1", SELF_FAST_MODEL: "forge-fast" };
    await warm(hostedFast);
    await Promise.all(waits);
    expect(calls.map((c) => c.url)).toEqual(["https://fast.example.test/health"]);
  });

  it("does not wait for the model server: it answers at once, and a hung server cannot hold the child's request", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
    const res = await Promise.race([warm(), new Promise<"slow">((r) => setTimeout(() => r("slow"), 500))]);
    expect(res).not.toBe("slow");
    expect((res as Response).status).toBe(202);
  });

  it("gives the ping a timeout, so it ends inside the time a Worker keeps a background task", async () => {
    const spy = vi.spyOn(AbortSignal, "timeout");
    await warm();
    expect(spy.mock.calls[0]?.[0]).toBeLessThanOrEqual(30_000);
    expect(spy.mock.calls[0]?.[0]).toBeGreaterThan(5_000);
  });
});

describe("when it does nothing", () => {
  it("hosted, off and a typo: no call goes anywhere (the hosted API needs no waking, and a typo fails closed)", async () => {
    for (const mode of [undefined, "hosted", "off", "selfhosted"]) {
      resetForgeWarm();
      await warm({ ...SELF, MODEL_BACKEND: mode });
    }
    await Promise.all(waits);
    expect(calls).toHaveLength(0);
  });

  it("self with no endpoint configured: nothing to wake, and never a fallback to anything else", async () => {
    await warm({ ...SELF, SELF_TEXT_URL: undefined });
    await Promise.all(waits);
    expect(calls).toHaveLength(0);
  });

  it("the text capability alone decides: TEXT_BACKEND=self wakes it while MODEL_BACKEND is hosted, and TEXT_BACKEND=off does not while MODEL_BACKEND is self", async () => {
    await warm({ ...SELF, MODEL_BACKEND: "hosted", TEXT_BACKEND: "self" });
    expect(calls).toHaveLength(1);
    resetForgeWarm();
    await warm({ ...SELF, TEXT_BACKEND: "off" });
    expect(calls).toHaveLength(1);
  });

  it("no maker to warm (the daemon is not configured): refused, and no call goes out", async () => {
    const res = await warm({ ...SELF, FORGE_OPTIMIZER_URL: undefined });
    expect(res.status).toBe(503);
    await Promise.all(waits);
    expect(calls).toHaveLength(0);
  });

  it("needs a device id and the right method, and sends nothing without them", async () => {
    expect((await warm(SELF, { "content-type": "application/json" })).status).toBe(401);
    expect((await warm(SELF, { "content-type": "application/json", "x-device-id": "not-a-device" })).status).toBe(401);
    expect((await warm(SELF, headers, "GET")).status).toBe(405);
    await Promise.all(waits);
    expect(calls).toHaveLength(0);
  });
});

describe("the cost guard", () => {
  it("however many calls arrive, one ping goes out per window: the second and third are coalesced", async () => {
    for (let i = 0; i < 3; i++) { resetForgeRateLimit(); await warm(); }
    await Promise.all(waits);
    expect(calls).toHaveLength(1);
  });

  it("different devices do not each get a ping: device ids are free to make up", async () => {
    for (let i = 0; i < 20; i++) {
      resetForgeRateLimit();
      await warm(SELF, { ...headers, "x-device-id": `12345678-1234-1234-1234-${String(100000000000 + i)}` });
    }
    await Promise.all(waits);
    expect(calls).toHaveLength(1);
  });

  it("after the window it pings again (a child who comes back later wakes it again), and not a minute earlier", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-04T10:00:00Z"));
    await warm();
    vi.setSystemTime(new Date(Date.now() + WARM_PING_EVERY_MS - 60_000));
    resetForgeRateLimit();
    await warm();
    expect(calls).toHaveLength(1);
    vi.setSystemTime(new Date(Date.now() + 61_000));
    resetForgeRateLimit();
    await warm();
    expect(calls).toHaveLength(2);
  });

  it("a caller that keeps asking is slowed down by the per-device and per-address limits before it reaches the ping", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await warm()).status);
    expect(statuses.slice(0, 2)).toEqual([202, 202]);
    expect(statuses).toContain(429);
  });

  it("a ping the model server never answers is forgotten, not retried: one call, whatever happens to it", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: unknown) => { calls.push({ url: String(url), init: undefined }); throw new Error("connection reset"); }));
    await warm();
    await Promise.all(waits);
    expect(calls).toHaveLength(1);
  });
});

describe("what it gives away", () => {
  it("answers the same 202 whatever happened, and the body names no backend, address, key or model", async () => {
    const bodies: string[] = [];
    for (const env of [SELF, { ...SELF, MODEL_BACKEND: "hosted" }, { ...SELF, MODEL_BACKEND: "off" }]) {
      resetForgeWarm(); resetForgeRateLimit();
      const res = await warm(env);
      expect(res.status).toBe(202);
      bodies.push(await res.text());
    }
    expect(new Set(bodies).size).toBe(1);
    for (const secret of ["glimmer", "own-key", "meta-key", "muse-glimmer", "self", "hosted"]) expect(bodies[0]).not.toContain(secret);
  });

  it("logs what happened without the address, the device id or any key", async () => {
    await warm();
    await Promise.all(waits);
    const logged = vi.mocked(console.log).mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain('"event":"forge_warm"');
    expect(logged).toContain('"status":"pinged"');
    expect(logged).toContain('"status":"up"');
    for (const secret of ["glimmer.example.test", DEVICE, "own-key", "meta-key"]) expect(logged).not.toContain(secret);
  });
});

describe("routing", () => {
  it("is routed by the Worker at /api/forge/warm, and a background task is handed to the runtime, not awaited", async () => {
    const res = await worker.fetch(new Request("http://local/api/forge/warm", { method: "POST", headers, body: "{}" }), SELF as never, ctx());
    expect(res.status).toBe(202);
    expect(waits).toHaveLength(1);
  });
});
