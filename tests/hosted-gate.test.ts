/**
 * The grown-up gate in front of the routes that send a photo, a recording or a prompt to ANOTHER model (worker/hostedGate.ts): SAM outline and the camera pick-up (/api/scan), generated
 * art and skins (/api/world/art, /api/skin) and voice input (/api/transcribe). Dan, 2026-11-04 night: the proof may be 3 minutes old, 5 for the AR flow (the Scavenger camera).
 * OFF unless the feature's switch is exactly "on", so each screen can be switched on once it can ask for the gate. Driven through the real Worker and the real gate (challenge, then verify).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../worker/index";
import { HOSTED_PROOF_MAX_AGE_MS, hostedGateOn } from "../worker/hostedGate";
import type { D1Like } from "../worker/ownership";

const DEVICE = "12345678-1234-1234-1234-123456789abc";
const OTHER = "87654321-4321-4321-4321-cba987654321";
const SECRET = "gate-secret-for-tests";

function fakeDb(): D1Like {
  const settings = new Map<string, string>();
  return {
    prepare: (sql) => ({
      bind: (...values: unknown[]) => ({
        run: async () => {
          if (sql.includes("INSERT INTO parent_settings")) {
            const [id, text] = values as [string, string];
            if (sql.includes("DO NOTHING")) {
              if (!settings.has(id)) settings.set(id, text);
            } else settings.set(id, text);
          }
          return {};
        },
        all: async () => {
          if (sql.includes("FROM parent_settings")) {
            const [id] = values as [string];
            const v = settings.get(id);
            return { results: v !== undefined ? [{ settings_json: v }] : [] };
          }
          return { results: [] };
        },
      }),
    }),
  };
}

type Env = Record<string, unknown>;
let env: Env;
const call = (path: string, init: RequestInit, e: Env = env) => worker.fetch(new Request(`http://local${path}`, init), e as never);
const json = (body: unknown, device = DEVICE, proof?: string): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json", "x-device-id": device, ...(proof ? { "x-parent-proof": proof } : {}) },
  body: JSON.stringify(body),
});

/** A real grown-up proof: the maths challenge, solved. */
async function proofFor(device = DEVICE): Promise<string> {
  const ch = (await (await call("/api/parent/gate", json({ action: "challenge" }, device))).json()) as { a: number; b: number; challengeToken: string };
  const ok = await call("/api/parent/gate", json({ action: "verify", challengeToken: ch.challengeToken, answer: ch.a * ch.b }, device));
  return ((await ok.json()) as { proofToken: string }).proofToken;
}

/** A proof signed with the gate's own key but with NO issue time: what a proof issued before this check existed looks like. */
async function oldProof(device = DEVICE): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(`toyventor-parent-hmac:v1:${SECRET}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const payload = b64(new TextEncoder().encode(JSON.stringify({ kind: "proof", playerId: device, exp: Date.now() + 300_000 })));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  return `${payload}.${b64(sig)}`;
}

const PHOTO = "data:image/png;base64,AAAA";
const scan = (proof?: string, extra: object = {}, device = DEVICE) => call("/api/scan", json({ nameIt: { imageDataUrl: PHOTO }, ...extra }, device, proof));
const skin = (proof?: string) => call("/api/skin", json({ imageDataUrl: PHOTO, style: "cartoon" }, DEVICE, proof));
const art = (proof?: string) => call("/api/world/art", json({ ticket: "x" }, DEVICE, proof));
const voice = (proof?: string) => call("/api/transcribe", { method: "POST", headers: { "content-type": "audio/wav", "x-device-id": DEVICE, ...(proof ? { "x-parent-proof": proof } : {}) }, body: new Uint8Array([1, 2, 3]) });

beforeEach(() => {
  env = { DB: fakeDb(), PARENT_GATE_SECRET: SECRET, TRANSCRIBE_BACKEND: "hosted", MODEL_API_KEY: "k" };
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-04T22:00:00Z"));
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const refused = async (res: Response) => {
  expect(res.status).toBe(401);
  return (await res.json()) as { status: string; feature: string; maxAgeSeconds: number };
};

describe("off by default: nothing asks for the gate until a feature's switch is on", () => {
  it("no switch, no 401 on any of the four routes", async () => {
    for (const r of [await scan(), await skin(), await art(), await voice()]) expect(r.status).not.toBe(401);
  });
  it("only the exact word on turns a switch on (trimmed, any case); the rest are off", () => {
    for (const v of ["on", "ON", " On "]) expect(hostedGateOn({ PARENT_GATE_SEGMENT: v }, "segment"), v).toBe(true);
    for (const v of [undefined, "", "off", "true", "1", "yes", "onn", "enabled"]) expect(hostedGateOn({ PARENT_GATE_SEGMENT: v }, "segment"), String(v)).toBe(false);
  });
  it("one switch does not turn on another feature", async () => {
    env = { ...env, PARENT_GATE_IMAGE: "on" };
    await refused(await skin());
    for (const r of [await scan(), await voice()]) expect(r.status).not.toBe(401);
  });
});

describe("segment (the SAM outline and the camera pick-up): a proof at most 3 minutes old", () => {
  beforeEach(() => void (env = { ...env, PARENT_GATE_SEGMENT: "on" }));

  it("no proof: 401 gate-required, before any model is asked, naming the feature and how fresh the proof must be", async () => {
    const body = await refused(await scan());
    expect(body).toMatchObject({ status: "gate-required", feature: "segment", maxAgeSeconds: 180 });
    expect(HOSTED_PROOF_MAX_AGE_MS.segment).toBe(180_000);
  });
  it("a fresh proof is let through", async () => {
    const proof = await proofFor();
    expect((await scan(proof)).status).not.toBe(401);
    vi.setSystemTime(Date.now() + 170_000); // 2 minutes 50 seconds
    expect((await scan(proof)).status).not.toBe(401);
  });
  it("a proof older than 3 minutes is refused, even though the gate's own proof lasts 5 or 10", async () => {
    const proof = await proofFor();
    vi.setSystemTime(Date.now() + 181_000);
    await refused(await scan(proof));
    vi.setSystemTime(Date.now() + 200_000); // 6 minutes: still inside the proof's own 10, still refused
    await refused(await scan(proof));
  });
  it("a proof with no issue time (issued before this check existed) is refused; one for another device is refused; garbage is refused", async () => {
    await refused(await scan(await oldProof()));
    await refused(await scan(await proofFor(OTHER))); // sent with this device's id
    await refused(await scan("not.aproof"));
    await refused(await scan("x"));
  });
  it("the room scan keeps its own rule (it already needs a proof) and is not double-gated here", async () => {
    const res = await call("/api/scan", json({ mode: "room", imageDataUrl: PHOTO, nouns: ["bed"] }));
    expect(res.status).toBe(401); // its own gate (worker/roomScan.ts)
    expect(((await res.json()) as { feature?: string }).feature).toBeUndefined();
  });
});

describe("ar (the Scavenger camera, whose photo ends in the phone's AR viewer): a proof at most 5 minutes old", () => {
  beforeEach(() => void (env = { ...env, PARENT_GATE_SEGMENT: "on", PARENT_GATE_AR: "on" }));

  it("purpose ar has the 5-minute leash: 4 minutes is fine, 6 is not, while a plain scan at 4 minutes is refused", async () => {
    const proof = await proofFor();
    vi.setSystemTime(Date.now() + 240_000);
    expect((await scan(proof, { purpose: "ar" })).status).not.toBe(401);
    await refused(await scan(proof)); // not the AR flow: 3 minutes
    vi.setSystemTime(Date.now() + 120_000); // 6 minutes
    const body = await refused(await scan(proof, { purpose: "ar" }));
    expect(body).toMatchObject({ feature: "ar", maxAgeSeconds: 300 });
  });
  it("AR switched off while segment is on: an ar request falls under ar's switch, which is off", async () => {
    env = { ...env, PARENT_GATE_AR: "off" };
    expect((await scan(undefined, { purpose: "ar" })).status).not.toBe(401);
    await refused(await scan(undefined)); // plain scans still gated
  });
  it("any other purpose word is just a plain scan (3 minutes), never a longer leash", async () => {
    const proof = await proofFor();
    vi.setSystemTime(Date.now() + 240_000);
    for (const purpose of ["AR", "ar ", "", 1, null, "arr"]) await refused(await scan(proof, { purpose }));
  });
});

describe("image (generated art and skins) and transcribe (voice input): a proof at most 3 minutes old", () => {
  it("image: both routes, no proof is 401, a fresh proof passes, a 4-minute-old proof is refused", async () => {
    env = { ...env, PARENT_GATE_IMAGE: "on" };
    await refused(await skin());
    const a = await refused(await art());
    expect(a.feature).toBe("image");
    const proof = await proofFor();
    expect((await skin(proof)).status).not.toBe(401);
    expect((await art(proof)).status).not.toBe(401);
    vi.setSystemTime(Date.now() + 240_000);
    await refused(await skin(proof));
    await refused(await art(proof));
  });
  it("transcribe: the gate is in front of reading the recording", async () => {
    env = { ...env, PARENT_GATE_TRANSCRIBE: "on" };
    const body = await refused(await voice());
    expect(body).toMatchObject({ feature: "transcribe", maxAgeSeconds: 180 });
    const proof = await proofFor();
    expect((await voice(proof)).status).not.toBe(401);
    vi.setSystemTime(Date.now() + 200_000);
    await refused(await voice(proof));
  });
  it("a refusal carries no wish, photo or device id in the log", async () => {
    env = { ...env, PARENT_GATE_SEGMENT: "on" };
    await scan();
    const logged = vi.mocked(console.log).mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("hosted_gate");
    expect(logged).not.toContain(DEVICE);
    expect(logged).not.toContain("AAAA");
  });
});
