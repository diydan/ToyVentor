/** The model-spend backstop (worker/spendLimit.ts): which requests it counts, what a refusal looks like, and that it fails open. A stub stands in for the binding. */
import { describe, expect, it, vi } from "vitest";
import { METERED_PATHS, isMetered, spendLimited, type RateLimitBinding } from "../worker/spendLimit";

const post = (path: string, ip: string | null = "203.0.113.7") =>
  new Request(`https://toyventor.test${path}`, { method: "POST", headers: ip ? { "CF-Connecting-IP": ip } : {} });
const limiter = (success: boolean) => ({ limit: vi.fn(async (_o: { key: string }) => ({ success })) }) satisfies RateLimitBinding;

describe("spendLimited", () => {
  it("lets a request through while the budget lasts, keyed by route and address", async () => {
    const l = limiter(true);
    expect(await spendLimited(post("/api/forge/make"), { MODEL_SPEND_LIMITER: l }, "/api/forge/make")).toBeNull();
    expect(l.limit).toHaveBeenCalledWith({ key: "/api/forge/make|203.0.113.7" });
  });

  it("answers 429 in the shape the clients already handle, without the address", async () => {
    const res = await spendLimited(post("/api/describe"), { MODEL_SPEND_LIMITER: limiter(false) }, "/api/describe");
    expect(res?.status).toBe(429);
    expect(res?.headers.get("retry-after")).toBe("30");
    const body = await res!.text();
    expect(JSON.parse(body)).toEqual({ ok: false, status: "slow-down", error: "slow down" });
    expect(body).not.toContain("203.0.113.7");
  });

  it("counts only POSTs to the routes that call a model", async () => {
    for (const p of METERED_PATHS) expect(isMetered("POST", p)).toBe(true);
    const l = limiter(false);
    for (const [method, path] of [
      ["GET", "/api/forge/make"],
      ["GET", "/api/scan"], // the seed toy: free
      ["POST", "/api/forge/make/jobs/fjob_0123456789ab"],
      ["POST", "/api/theme-song/abc"], // a poll or setting, not a start
      ["POST", "/api/voice"],
      ["POST", "/api/ownership"],
      ["POST", "/index.html"],
    ] as const) {
      expect(await spendLimited(new Request(`https://toyventor.test${path}`, { method }), { MODEL_SPEND_LIMITER: l }, path)).toBeNull();
    }
    expect(l.limit).not.toHaveBeenCalled();
  });

  it("fails open: no binding, or a binding that throws", async () => {
    expect(await spendLimited(post("/api/forge/make"), {}, "/api/forge/make")).toBeNull();
    const broken: RateLimitBinding = { limit: async () => { throw new Error("limiter down"); } };
    expect(await spendLimited(post("/api/forge/make"), { MODEL_SPEND_LIMITER: broken }, "/api/forge/make")).toBeNull();
  });

  it("uses one shared key when the address header is absent (local dev)", async () => {
    const l = limiter(true);
    await spendLimited(post("/api/muse/spark", null), { MODEL_SPEND_LIMITER: l }, "/api/muse/spark");
    expect(l.limit).toHaveBeenCalledWith({ key: "/api/muse/spark|unknown" });
  });
});
