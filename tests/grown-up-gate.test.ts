/**
 * "Ask the grown-up" on the client (src/lib/grownUpGate.ts): the proof is kept in memory only and has an age; a gated fetch carries the device id and a fresh enough proof, asks the grown-up
 * ONCE when the Worker says gate-required, sends the request again with the new proof, and hands the 401 back if they cancel. Pairs with worker/hostedGate.ts (tests/hosted-gate.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROOF_MAX_AGE_MS, askGrownUp, forgetGrownUpProof, freshGrownUpProof, makeGatedFetch, registerGrownUpAsker, rememberGrownUpProof } from "../src/lib/grownUpGate";
import { HOSTED_PROOF_MAX_AGE_MS } from "../worker/hostedGate";

const T0 = 1_800_000_000_000;
const session = (token: string, lifetimeMs = 600_000) => ({ proofToken: token, expiresAt: T0 + lifetimeMs });
const gateRequired = () => new Response(JSON.stringify({ ok: false, status: "gate-required", feature: "segment" }), { status: 401, headers: { "content-type": "application/json" } });
const okRes = () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });

beforeEach(() => {
  const mem = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) });
  forgetGrownUpProof();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  forgetGrownUpProof();
  registerGrownUpAsker(null);
});

describe("the proof in memory", () => {
  it("is fresh inside its age limit and its own lifetime, and not after either", () => {
    rememberGrownUpProof(session("p1"), T0);
    expect(freshGrownUpProof(180_000, T0 + 179_000)).toBe("p1");
    expect(freshGrownUpProof(180_000, T0 + 181_000)).toBeNull(); // older than 3 minutes
    expect(freshGrownUpProof(300_000, T0 + 299_000)).toBe("p1"); // but fine for the 5-minute AR leash
    expect(freshGrownUpProof(300_000, T0 + 301_000)).toBeNull();
    rememberGrownUpProof({ proofToken: "short", expiresAt: T0 + 60_000 }, T0);
    expect(freshGrownUpProof(300_000, T0 + 61_000)).toBeNull(); // past the gate's own lifetime
  });
  it("never keeps the local stand-in, which proves nothing to the Worker, and can be forgotten", () => {
    rememberGrownUpProof(session("local-proof"), T0);
    expect(freshGrownUpProof(300_000, T0)).toBeNull();
    rememberGrownUpProof(session("p2"), T0);
    forgetGrownUpProof();
    expect(freshGrownUpProof(300_000, T0)).toBeNull();
  });
  it("is held in memory only: nothing is written to storage", () => {
    const set = vi.fn();
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: set, removeItem: () => undefined });
    vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: set, removeItem: () => undefined });
    rememberGrownUpProof(session("p3"), T0);
    expect(set.mock.calls.filter((c) => String(c[1]).includes("p3"))).toHaveLength(0);
  });
  it("the client's age limits are the Worker's", () => {
    for (const k of Object.keys(PROOF_MAX_AGE_MS) as (keyof typeof PROOF_MAX_AGE_MS)[]) expect(PROOF_MAX_AGE_MS[k], k).toBe(HOSTED_PROOF_MAX_AGE_MS[k]);
  });
});

describe("a gated fetch", () => {
  const run = (over: Parameters<typeof makeGatedFetch>[0], answers: Response[], init: RequestInit = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nameIt: { imageDataUrl: "data:image/png;base64,AAAA" } }) }) => {
    const calls: { headers: Headers; body: unknown; signal: unknown }[] = [];
    const fetchImpl = (async (_u: unknown, i?: RequestInit) => {
      calls.push({ headers: new Headers(i?.headers), body: i?.body, signal: i?.signal });
      return answers.shift() ?? okRes();
    }) as typeof fetch;
    const f = makeGatedFetch({ fetchImpl, now: () => T0, ...over });
    return { f, calls, go: () => f("/api/scan", init) };
  };

  it("always sends the device id; sends a proof only when one is fresh enough; asks nobody when the answer is fine", async () => {
    const ask = vi.fn(async () => true);
    const a = run({ ask }, [okRes()]);
    expect((await a.go()).status).toBe(200);
    expect(a.calls[0]!.headers.get("x-device-id")).toBeTruthy();
    expect(a.calls[0]!.headers.get("x-parent-proof")).toBeNull();
    rememberGrownUpProof(session("p4"), T0);
    const b = run({ ask }, [okRes()]);
    await b.go();
    expect(b.calls[0]!.headers.get("x-parent-proof")).toBe("p4");
    expect(ask).not.toHaveBeenCalled();
  });
  it("on gate-required it asks ONCE and sends the request again with the new proof", async () => {
    const r = run({ ask: async () => { rememberGrownUpProof(session("p5"), T0); return true; } }, [gateRequired(), okRes()]);
    const res = await r.go();
    expect(res.status).toBe(200);
    expect(r.calls).toHaveLength(2);
    expect(r.calls[0]!.headers.get("x-parent-proof")).toBeNull();
    expect(r.calls[1]!.headers.get("x-parent-proof")).toBe("p5");
  });
  it("if the grown-up cancels, the 401 goes back to the screen untouched and nothing is retried", async () => {
    const r = run({ ask: async () => false }, [gateRequired()]);
    const res = await r.go();
    expect(res.status).toBe(401);
    expect(((await res.json()) as { status: string }).status).toBe("gate-required");
    expect(r.calls).toHaveLength(1);
  });
  it("a second refusal after they answered is returned, not asked again (no loop)", async () => {
    const ask = vi.fn(async () => true);
    const r = run({ ask }, [gateRequired(), gateRequired()]);
    expect((await r.go()).status).toBe(401);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(r.calls).toHaveLength(2);
  });
  it("a 401 that is not gate-required (or not JSON) never opens the prompt", async () => {
    const ask = vi.fn(async () => true);
    const r = run({ ask }, [new Response(JSON.stringify({ error: "nope" }), { status: 401 })]);
    expect((await r.go()).status).toBe(401);
    const r2 = run({ ask }, [new Response("plain", { status: 401 })]);
    expect((await r2.go()).status).toBe(401);
    expect(ask).not.toHaveBeenCalled();
  });
  it("purpose ar is put into a JSON body that has none, never over one it has, and the 5-minute proof is the one it sends", async () => {
    rememberGrownUpProof(session("p6"), T0 - 240_000); // 4 minutes old
    const ar = run({ purpose: "ar" }, [okRes()]);
    await ar.go();
    expect(JSON.parse(String(ar.calls[0]!.body))).toMatchObject({ purpose: "ar" });
    expect(ar.calls[0]!.headers.get("x-parent-proof")).toBe("p6"); // fine for AR (5 minutes)
    const plain = run({ feature: "segment" }, [okRes()]);
    await plain.go();
    expect(plain.calls[0]!.headers.get("x-parent-proof")).toBeNull(); // too old for the 3-minute leash
    const keep = run({ purpose: "ar" }, [okRes()], { method: "POST", body: JSON.stringify({ purpose: "other" }) });
    await keep.go();
    expect(JSON.parse(String(keep.calls[0]!.body))).toEqual({ purpose: "other" });
    const nonJson = run({ purpose: "ar" }, [okRes()], { method: "POST", body: "not json" });
    await nonJson.go();
    expect(nonJson.calls[0]!.body).toBe("not json");
  });
  it("each attempt gets its own fresh timeout, so waiting for the grown-up cannot use up the second attempt's time", async () => {
    const timeouts: number[] = [];
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => (timeouts.push(ms), new AbortController().signal));
    const r = run({ timeoutMs: 25_000, ask: async () => true }, [gateRequired(), okRes()]);
    await r.go();
    expect(timeouts).toEqual([25_000, 25_000]);
    expect(r.calls[0]!.signal).not.toBe(r.calls[1]!.signal);
  });
});

describe("askGrownUp", () => {
  it("is false at once when no prompt is mounted, and remembers the proof when the grown-up passes", async () => {
    expect(await askGrownUp()).toBe(false);
    registerGrownUpAsker(async () => session("p7", 600_000));
    expect(await askGrownUp()).toBe(true);
    expect(freshGrownUpProof(300_000, Date.now())).toBe("p7");
  });
  it("cancel is false and remembers nothing", async () => {
    registerGrownUpAsker(async () => null);
    expect(await askGrownUp()).toBe(false);
    expect(freshGrownUpProof(300_000, Date.now())).toBeNull();
  });
});
