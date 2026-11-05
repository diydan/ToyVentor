// The accounts groundwork is wired into the Worker but OFF: /api/account/* answers 404 {"error":"accounts are off"} unless ACCOUNTS is exactly "on", and every other route is untouched.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import worker from "../worker/index";

const call = (path: string, env: Record<string, unknown> = {}, init?: RequestInit) => worker.fetch(new Request(`https://toyventor.test${path}`, init), env as never);

describe("accounts are wired in and off", () => {
  it("answers /api/account/* with 'accounts are off' while ACCOUNTS is unset or anything but 'on'", async () => {
    for (const env of [{}, { ACCOUNTS: "off" }, { ACCOUNTS: "ON" }, { ACCOUNTS: "true" }]) {
      for (const [path, method] of [["/api/account/login/start", "POST"], ["/api/account/me", "GET"], ["/api/account", "DELETE"]] as const) {
        const res = await call(path, env, { method });
        expect(res.status, `${method} ${path} with ${JSON.stringify(env)}`).toBe(404);
        expect(await res.json()).toEqual({ error: "accounts are off" });
      }
    }
  });
  it("does not touch the neighbouring routes: an unknown /api path still says 'not found', and the account prefix is not a loose match", async () => {
    const res = await call("/api/nothing-here");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
    const near = await call("/api/accountant");
    expect(await near.json()).toEqual({ error: "not found" });
  });
  it("the Worker file hands the request over before the final 404, once", () => {
    const src = readFileSync(new URL("../worker/index.ts", import.meta.url), "utf8");
    expect(src).toContain('import { type AccountsEnv, handleAccounts } from "./accounts";');
    const at = src.indexOf("await handleAccounts(request, env as AccountsEnv, ctx)");
    expect(at).toBeGreaterThan(0);
    expect(src.indexOf("await handleAccounts(", at + 1)).toBe(-1);
    expect(at).toBeLessThan(src.indexOf('if (url.pathname.startsWith("/api/")) {\n      return json({ error: "not found" }, 404);'));
  });
});
