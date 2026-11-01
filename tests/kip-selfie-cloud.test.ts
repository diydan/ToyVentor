import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error untyped JS module
import * as cloudMod from "../parts/kip/viewer/kip-selfie-cloud.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const C = cloudMod as any;
const root = process.cwd();
const DEVICE = "0123456789abcdef-device-id";

interface Call { url: string; init: any; body: any }
function fakeFetch(handler: (c: Call) => { status?: number; json?: unknown } | Error) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init: any) => {
    const c: Call = { url, init, body: init?.body ? JSON.parse(init.body) : null };
    calls.push(c);
    const r = handler(c);
    if (r instanceof Error) throw r;
    return { status: r.status ?? 200, json: async () => { if (r.json === undefined) throw new Error("no json"); return r.json; } };
  };
  return { calls, fetchImpl };
}
const GATE_OK = (c: Call) =>
  c.body.action === "challenge"
    ? { json: { mode: "math", a: 15, b: 7, challengeToken: "challenge-token" } }
    : { json: { ok: true, proofToken: "proof-token", expiresAt: 10_000_000 } };

async function passedGate(handler: (c: Call) => any, now = () => 1_000_000) {
  const f = fakeFetch((c) => (c.url === C.ENDPOINTS.gate ? GATE_OK(c) : handler(c)));
  const cloud = C.createSelfieCloud({ fetchImpl: f.fetchImpl, deviceId: () => DEVICE, now });
  const ch = await cloud.challenge();
  await cloud.verify({ challengeToken: ch.challengeToken, answer: "105" });
  return { cloud, calls: f.calls };
}

describe("selfie cloud: nothing is sent until asked", () => {
  it("creating the client makes no request", () => {
    const f = fakeFetch(() => ({ json: {} }));
    C.createSelfieCloud({ fetchImpl: f.fetchImpl, deviceId: () => DEVICE });
    expect(f.calls).toHaveLength(0);
  });

  it("refuses to send a picture before a grown-up has passed the gate (no request at all)", async () => {
    const f = fakeFetch(() => ({ json: { status: "ok", eyes: [], mouth: {} } }));
    const cloud = C.createSelfieCloud({ fetchImpl: f.fetchImpl, deviceId: () => DEVICE });
    expect(await cloud.faceParts("data:image/jpeg;base64,AAAA")).toEqual({ status: "gate-required" });
    expect(await cloud.cartoon("data:image/jpeg;base64,AAAA")).toEqual({ status: "gate-required" });
    expect(f.calls).toHaveLength(0);
  });
});

describe("selfie cloud: the parent gate", () => {
  it("asks the app's own gate endpoint with the device id and returns the question", async () => {
    const f = fakeFetch(GATE_OK);
    const cloud = C.createSelfieCloud({ fetchImpl: f.fetchImpl, deviceId: () => DEVICE });
    const ch = await cloud.challenge();
    expect(ch).toMatchObject({ status: "ok", mode: "math", a: 15, b: 7, challengeToken: "challenge-token" });
    expect(f.calls[0]!.url).toBe("/api/parent/gate");
    expect(f.calls[0]!.init.headers["x-device-id"]).toBe(DEVICE);
    expect(f.calls[0]!.body).toEqual({ action: "challenge" });
  });

  it("verifies a math answer or a PIN and keeps the proof in memory only until it expires", async () => {
    let t = 1_000_000;
    const f = fakeFetch(GATE_OK);
    const cloud = C.createSelfieCloud({ fetchImpl: f.fetchImpl, deviceId: () => DEVICE, now: () => t });
    expect(cloud.hasProof()).toBe(false);
    const r = await cloud.verify({ challengeToken: "challenge-token", answer: "105" });
    expect(r).toEqual({ status: "ok" });
    expect(f.calls[0]!.body).toEqual({ action: "verify", challengeToken: "challenge-token", answer: 105 });
    expect(cloud.hasProof()).toBe(true);
    t = 10_000_000; // past expiresAt
    expect(cloud.hasProof()).toBe(false);
    await cloud.verify({ pin: "1234" });
    expect(f.calls[1]!.body).toEqual({ action: "verify", pin: "1234" });
  });

  it("reports a wrong answer or a PIN cooldown without keeping a proof", async () => {
    const f = fakeFetch(() => ({ status: 403, json: { ok: false, error: "pin_cooldown", retryAfterSeconds: 30, attemptsRemaining: 0 } }));
    const cloud = C.createSelfieCloud({ fetchImpl: f.fetchImpl, deviceId: () => DEVICE });
    const r = await cloud.verify({ pin: "0000" });
    expect(r).toMatchObject({ status: "wrong", cooldown: true, retryAfterSeconds: 30 });
    expect(cloud.hasProof()).toBe(false);
  });

  it("says 'disabled' when the parent store is not available, and 'offline' when the network is down", async () => {
    expect((await C.createSelfieCloud({ fetchImpl: fakeFetch(() => ({ status: 501, json: { error: "parent store not bound" } })).fetchImpl, deviceId: () => DEVICE }).challenge()).status).toBe("disabled");
    expect((await C.createSelfieCloud({ fetchImpl: fakeFetch(() => new Error("down")).fetchImpl, deviceId: () => DEVICE }).challenge()).status).toBe("offline");
  });
});

describe("selfie cloud: sending one picture", () => {
  it("face parts: one POST to the face-parts endpoint with the proof, the consent version and nothing else attached", async () => {
    const { cloud, calls } = await passedGate(() => ({ json: { status: "ok", eyes: [{ x: 0.3, y: 0.4 }, { x: 0.6, y: 0.4 }], mouth: { x: 0.45, y: 0.7 } } }));
    const r = await cloud.faceParts("data:image/jpeg;base64,/9j/AAAA");
    expect(r).toEqual({ status: "ok", eyes: [{ x: 0.3, y: 0.4 }, { x: 0.6, y: 0.4 }], mouth: { x: 0.45, y: 0.7 } });
    const call = calls.find((c) => c.url === "/api/selfie/face-parts")!;
    expect(call.init.method).toBe("POST");
    expect(call.init.headers).toMatchObject({ "x-device-id": DEVICE, "x-parent-proof": "proof-token", "x-selfie-consent": "v1", "content-type": "application/json" });
    expect(call.init.credentials).toBe("omit");
    expect(call.init.cache).toBe("no-store");
    expect(Object.keys(call.body)).toEqual(["image"]);
    expect(call.body.image).toBe("data:image/jpeg;base64,/9j/AAAA");
  });

  it("cartoon: returns the redrawn picture as a data URL", async () => {
    const { cloud, calls } = await passedGate(() => ({ json: { status: "ok", image: "data:image/png;base64,iVBOR" } }));
    expect(await cloud.cartoon("data:image/jpeg;base64,AAAA")).toEqual({ status: "ok", image: "data:image/png;base64,iVBOR" });
    expect(calls.some((c) => c.url === "/api/selfie/cartoon")).toBe(true);
  });

  it("maps every server status to a status the screen can word, and drops the proof when the gate says it expired", async () => {
    for (const status of ["no-match", "slow-down", "too-large", "invalid", "disabled", "unavailable", "consent-required"]) {
      const { cloud } = await passedGate(() => ({ status: 200, json: { status } }));
      expect((await cloud.faceParts("data:image/jpeg;base64,AA")).status).toBe(status);
    }
    const { cloud } = await passedGate(() => ({ status: 401, json: { status: "gate-required" } }));
    expect((await cloud.faceParts("data:image/jpeg;base64,AA")).status).toBe("gate-required");
    expect(cloud.hasProof()).toBe(false); // the next tap asks the grown-up again
  });

  it("treats a malformed 'ok' answer as unavailable instead of trusting it", async () => {
    const { cloud } = await passedGate(() => ({ json: { status: "ok" } }));
    expect((await cloud.faceParts("data:image/jpeg;base64,AA")).status).toBe("unavailable");
    expect((await cloud.cartoon("data:image/jpeg;base64,AA")).status).toBe("unavailable");
  });

  it("never throws on a network failure and reports an aborted request as aborted", async () => {
    const { cloud } = await passedGate(() => new Error("boom"));
    expect((await cloud.faceParts("data:image/jpeg;base64,AA")).status).toBe("offline");
    const abort = Object.assign(new Error("a"), { name: "AbortError" });
    const { cloud: c2 } = await passedGate(() => abort);
    expect((await c2.faceParts("data:image/jpeg;base64,AA")).status).toBe("aborted");
  });

  it("words every status for a child without echoing server text", () => {
    for (const s of ["disabled", "gate-required", "consent-required", "slow-down", "too-large", "invalid", "no-match", "offline", "unavailable", "whatever"]) {
      const text = C.describeStatus(s);
      expect(text.length).toBeGreaterThan(20);
      expect(text).not.toMatch(/\b(HTTP|error|exception|undefined)\b/i);
    }
  });
});

describe("selfie cloud: device id and size helpers", () => {
  it("reads the app's device id and never writes storage", () => {
    const writes: string[] = [];
    const storage = { getItem: (k: string) => (k === "toyforge:device:v1" ? DEVICE : null), setItem: () => writes.push("set"), removeItem: () => writes.push("remove") };
    expect(C.readDeviceId(storage)).toBe(DEVICE);
    expect(C.readDeviceId({ getItem: () => "short" })).toBeNull();
    expect(C.readDeviceId({ getItem: () => { throw new Error("blocked"); } })).toBeNull();
    expect(writes).toEqual([]);
    expect(C.DEVICE_KEY).toBe("toyforge:device:v1");
  });

  it("measures a data URL's decoded bytes", () => {
    expect(C.dataUrlBytes("data:image/jpeg;base64,QUJD")).toBe(3); // "ABC"
    expect(C.dataUrlBytes("data:image/jpeg;base64,QUI=")).toBe(2);
    expect(C.dataUrlBytes("data:image/jpeg;base64,QQ==")).toBe(1);
    expect(C.MAX_SIDE).toBeLessThanOrEqual(768);
  });
});

describe("selfie cloud: the only networked selfie file", () => {
  const src = readFileSync(join(root, "parts/kip/viewer/kip-selfie-cloud.js"), "utf8");
  const code = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

  it("has exactly one fetch call site, to relative URLs, and no other way out", () => {
    expect((code.match(/\bfetch\s*\(/g) ?? []).length).toBe(1);
    for (const banned of [/XMLHttpRequest/, /sendBeacon/, /WebSocket/, /new Worker/, /EventSource/, /https?:\/\//, /document\.cookie/, /sessionStorage/, /indexedDB/, /caches\./, /localStorage\.(set|remove)Item/, /\.clear\(\)/]) {
      expect(code, String(banned)).not.toMatch(banned);
    }
    expect(Object.values(C.ENDPOINTS).every((u: any) => typeof u === "string" && u.startsWith("/api/"))).toBe(true);
    expect(Object.keys(C.ENDPOINTS).sort()).toEqual(["cartoon", "faceParts", "gate"]);
  });

  it("is the only selfie module that imports it, and kip-selfie.js itself still contains no network call", () => {
    const selfie = readFileSync(join(root, "parts/kip/viewer/kip-selfie.js"), "utf8");
    expect(selfie).toMatch(/from '\.\/kip-selfie-cloud\.js\?v=10\.0'/);
    const selfieCode = selfie.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    expect(selfieCode).not.toMatch(/\bfetch\s*\(/);
    const image = readFileSync(join(root, "parts/kip/viewer/kip-selfie-image.js"), "utf8");
    expect(image).not.toMatch(/kip-selfie-cloud/);
  });

  it("the selfie only reaches the cloud through the consent screen and the gate", () => {
    const selfie = readFileSync(join(root, "parts/kip/viewer/kip-selfie.js"), "utf8");
    // the only callers of the two picture endpoints are inside smartRun, which is only wired to the buttons shown after the gate
    expect((selfie.match(/cloud\(\)\.faceParts\(/g) ?? []).length).toBe(2); // 'parts' and the cartoon follow-up, both in smartRun
    expect((selfie.match(/cloud\(\)\.cartoon\(/g) ?? []).length).toBe(1);
    expect(selfie).toMatch(/\$\('sf-smart-parts'\)\.addEventListener\('click', \(\) => smartRun\('parts'\)\)/);
    expect(selfie).toMatch(/\$\('sf-smart-cartoon'\)\.addEventListener\('click', \(\) => smartRun\('cartoon'\)\)/);
    expect(selfie).toMatch(/smartStep\('consent'\);/); // entering Smart face always starts at the consent screen
    expect(selfie).toMatch(/if \(cloudInst\) cloudInst\.clearProof\(\)/); // and the proof does not outlive the modal
    expect(selfie).toContain("A grown-up has to say yes");
    expect(selfie).toContain("Meta's AI service");
    expect(selfie).toContain('Your cartoon is ready. The grown-up check ran out'); // a cartoon that arrives after the proof expired says what to do next
  });
});
