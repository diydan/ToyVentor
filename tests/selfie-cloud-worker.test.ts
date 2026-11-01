import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../worker/index";
import { SELFIE_CARTOON_PROMPT } from "../worker/meta";
import type { D1Like } from "../worker/ownership";
import { verifyParentProofFromRequest } from "../worker/parent";
import {
  MAX_SELFIE_BODY_BYTES,
  MAX_SELFIE_JPEG_BYTES,
  pickEyes,
  pickMouth,
  plausibleFace,
  resetSelfieRateLimit,
  selfieCloudEnabled,
  validJpegDataUrl,
} from "../worker/selfie";

const DEVICE_A = "12345678-1234-1234-1234-123456789abc";
const DEVICE_B = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DEVICE_C = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const DEVICE_D = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const KEY = "test-model-key-DO-NOT-LEAK";
const UPSTREAM_SECRET = "UPSTREAM-SECRET-TEXT-1234";

/** In-memory D1 stand-in: enough of `parent_settings` for the gate to issue and verify proofs. */
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

const baseEnv = () => ({ DB: fakeDb(), PARENT_GATE_SECRET: "gate-secret-for-tests", MODEL_API_KEY: KEY, SELFIE_CLOUD: "on" });
type TestEnv = ReturnType<typeof baseEnv> & Record<string, unknown>;

/** A real proof token, obtained through the real gate (math mode) for `device`. */
async function proofFor(env: object, device: string): Promise<string> {
  const call = (body: object) =>
    worker.fetch(
      new Request("http://local/api/parent/gate", {
        method: "POST",
        headers: { "content-type": "application/json", "x-device-id": device },
        body: JSON.stringify(body),
      }),
      env as never,
    );
  const ch = (await (await call({ action: "challenge" })).json()) as { a: number; b: number; challengeToken: string };
  const ok = await call({ action: "verify", challengeToken: ch.challengeToken, answer: ch.a * ch.b });
  return ((await ok.json()) as { proofToken: string }).proofToken;
}

/** A small JPEG-looking data URL: the right magic bytes, then filler. `tail` makes its base64 recognisable in logs. */
function jpegUrl(bytes = 3_000, tail = "SELFIE-PAYLOAD-MARKER"): string {
  const buf = new Uint8Array(bytes);
  buf.set([0xff, 0xd8, 0xff, 0xe0], 0);
  for (let i = 4; i < bytes; i++) buf[i] = (i * 31 + 7) & 0xff;
  const t = new TextEncoder().encode(tail);
  buf.set(t, Math.max(4, bytes - t.length));
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return `data:image/jpeg;base64,${btoa(bin)}`;
}

interface Headers_ {
  proof?: string | null;
  consent?: string | null;
  device?: string | null;
  contentType?: string | null;
  ip?: string;
}
function selfieReq(path: string, body: unknown, h: Headers_ = {}, method = "POST"): Request {
  const headers: Record<string, string> = {};
  if (h.contentType !== null) headers["content-type"] = h.contentType ?? "application/json";
  if (h.consent !== null) headers["x-selfie-consent"] = h.consent ?? "v1";
  if (h.device !== null) headers["x-device-id"] = h.device ?? DEVICE_A;
  if (h.proof) headers["x-parent-proof"] = h.proof;
  if (h.ip) headers["CF-Connecting-IP"] = h.ip;
  return new Request(`http://local${path}`, {
    method,
    headers,
    ...(method === "POST" ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  });
}

const FACE = "/api/selfie/face-parts";
const CARTOON = "/api/selfie/cartoon";

interface Box { id: number; x1: number; y1: number; x2: number; y2: number; w?: number; h?: number }
/** A SAM stream carrying these boxes, in the wire format shared/sam.ts parses. */
function samStream(boxes: Box[]): Response {
  const text = boxes
    .map((b) => `${b.id}<|box;x1=${b.x1};y1=${b.y1};x2=${b.x2};y2=${b.y2};w=${b.w ?? 1000};h=${b.h ?? 500};c=0.9|>`)
    .join(",");
  const events = [`data: ${JSON.stringify({ type: "response.output_text.delta", delta: text })}`, "data: [DONE]"];
  return new Response(events.join("\n") + "\n", { status: 200, headers: { "content-type": "text/event-stream" } });
}
/** Boxes (on a 1000x500 picture) for a clean face: eyes at x 0.35/0.65, y 0.4; mouth at 0.5, 0.75. */
const EYES: Box[] = [
  { id: 1, x1: 330, y1: 190, x2: 370, y2: 210 },
  { id: 2, x1: 630, y1: 190, x2: 670, y2: 210 },
];
const MOUTH: Box[] = [{ id: 3, x1: 450, y1: 365, x2: 550, y2: 385 }];

type Upstream = (url: string, init: RequestInit, prompt: string | null) => Response | Promise<Response>;
/** Stub global fetch for the model calls; `prompt` is the SAM text prompt for /responses calls. */
function stubUpstream(handler: Upstream) {
  const calls: { url: string; init: RequestInit; prompt: string | null }[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const fn = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const prompt = body?.input?.[0]?.content?.[0]?.text ?? null;
    calls.push({ url, init: init ?? {}, prompt });
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await new Promise((r) => setTimeout(r, 5));
      return await handler(url, init ?? {}, prompt);
    } finally {
      inFlight--;
    }
  });
  vi.stubGlobal("fetch", fn);
  return { fn, calls, maxInFlight: () => maxInFlight };
}
const cleanFace: Upstream = (_u, _i, prompt) => samStream(prompt === "eye" ? EYES : prompt === "mouth" ? MOUTH : []);

let logs: string[];
beforeEach(() => {
  resetSelfieRateLimit();
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => { logs.push(args.map(String).join(" ")); });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function ready(device = DEVICE_A, env: object = baseEnv()) {
  return { env, proof: await proofFor(env, device) };
}

describe("selfie cloud: off by default, and a disabled deployment reveals nothing", () => {
  it("is off unless SELFIE_CLOUD is exactly 'on' AND a model key is set", () => {
    expect(selfieCloudEnabled({})).toBe(false);
    expect(selfieCloudEnabled({ MODEL_API_KEY: KEY })).toBe(false);
    expect(selfieCloudEnabled({ MODEL_API_KEY: KEY, SELFIE_CLOUD: "ON" })).toBe(false);
    expect(selfieCloudEnabled({ MODEL_API_KEY: KEY, SELFIE_CLOUD: "true" })).toBe(false);
    expect(selfieCloudEnabled({ SELFIE_CLOUD: "on" })).toBe(false);
    expect(selfieCloudEnabled({ MODEL_API_KEY: KEY, SELFIE_CLOUD: "on" })).toBe(true);
    expect(selfieCloudEnabled({ META_MODEL_API_KEY: KEY, SELFIE_CLOUD: "on" })).toBe(true);
  });

  for (const path of [FACE, CARTOON]) {
    it(`${path}: 503 disabled for any request when switched off, before looking at headers, body or proof`, async () => {
      const up = stubUpstream(cleanFace);
      for (const env of [{ MODEL_API_KEY: KEY }, { MODEL_API_KEY: KEY, SELFIE_CLOUD: "off" }, { SELFIE_CLOUD: "on" }]) {
        // no consent, no device, no proof, not even a body: still just "disabled"
        const res = await worker.fetch(selfieReq(path, "not json", { consent: null, device: null, contentType: "text/plain" }), env as never);
        expect(res.status).toBe(503);
        expect(await res.json()).toEqual({ status: "disabled" });
        expect(res.headers.get("cache-control")).toBe("no-store");
      }
      expect(up.fn).not.toHaveBeenCalled();
    });

    it(`${path}: 405 for anything but POST`, async () => {
      for (const env of [baseEnv(), { MODEL_API_KEY: KEY }]) {
        for (const method of ["GET", "PUT", "DELETE"]) {
          const res = await worker.fetch(selfieReq(path, {}, {}, method), env as never);
          expect(res.status).toBe(405);
          expect(res.headers.get("cache-control")).toBe("no-store");
        }
      }
    });
  }

  it("/api/health says whether the selfie cloud is on, and keeps its other fields", async () => {
    const on = await (await worker.fetch(new Request("http://local/api/health"), baseEnv() as never)).json();
    expect(on).toMatchObject({ ok: true, service: "toyventor", samConfigured: true, selfieCloud: true });
    expect(on).toHaveProperty("museConfigured");
    const off = await (await worker.fetch(new Request("http://local/api/health"), { MODEL_API_KEY: KEY } as never)).json();
    expect(off).toMatchObject({ ok: true, samConfigured: true, selfieCloud: false });
  });
});

describe("selfie cloud: the order of checks and every refusal", () => {
  it("413 when the declared size is over the cap, before the consent and gate checks (no consent, no proof, still 413)", async () => {
    const up = stubUpstream(cleanFace);
    const req = new Request(`http://local${FACE}`, {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(MAX_SELFIE_BODY_BYTES + 1) },
      body: "{}",
    });
    expect(req.headers.get("content-length")).toBe(String(MAX_SELFIE_BODY_BYTES + 1));
    const res = await worker.fetch(req, baseEnv() as never);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ status: "too-large" });
    expect(up.fn).not.toHaveBeenCalled();
  });

  it("413 for a body that is actually over the cap even with no declared length", async () => {
    const { env, proof } = await ready();
    const up = stubUpstream(cleanFace);
    const res = await worker.fetch(selfieReq(FACE, JSON.stringify({ image: "x".repeat(MAX_SELFIE_BODY_BYTES + 100) }), { proof }), env as never);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ status: "too-large" });
    expect(up.fn).not.toHaveBeenCalled();
  });

  it("415 invalid for a content type other than JSON", async () => {
    const { env, proof } = await ready();
    const res = await worker.fetch(selfieReq(FACE, "x", { proof, contentType: "text/plain" }), env as never);
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ status: "invalid" });
  });

  it("403 consent-required without the header or with another version", async () => {
    const { env, proof } = await ready();
    const up = stubUpstream(cleanFace);
    for (const consent of [null, "v0", "v2", "yes", ""]) {
      const res = await worker.fetch(selfieReq(FACE, { image: jpegUrl() }, { proof, consent }), env as never);
      expect(res.status, String(consent)).toBe(403);
      expect(await res.json()).toEqual({ status: "consent-required" });
    }
    expect(up.fn).not.toHaveBeenCalled();
  });

  it("401 gate-required for a missing, garbage, expired or other-device proof, and for a bad device id", async () => {
    const { env, proof } = await ready(DEVICE_A);
    const otherProof = await proofFor(env, DEVICE_B);
    const up = stubUpstream(cleanFace);
    const body = { image: jpegUrl() };
    for (const [label, h] of [
      ["no proof", {}],
      ["garbage", { proof: "not.a.token" }],
      ["tampered", { proof: proof.slice(0, -3) + "AAA" }],
      ["another device's proof", { proof: otherProof }],
      ["bad device id", { proof, device: "short" }],
      ["no device id", { proof, device: null }],
    ] as const) {
      const res = await worker.fetch(selfieReq(FACE, body, h), env as never);
      expect(res.status, label).toBe(401);
      expect(await res.json(), label).toEqual({ status: "gate-required" });
    }
    expect(up.fn).not.toHaveBeenCalled();
  });

  it("fails closed when there is no D1 binding to resolve the proof key", async () => {
    const withDb = baseEnv();
    const proof = await proofFor(withDb, DEVICE_A);
    const noDb = { MODEL_API_KEY: KEY, SELFIE_CLOUD: "on", PARENT_GATE_SECRET: "gate-secret-for-tests" };
    const up = stubUpstream(cleanFace);
    const res = await worker.fetch(selfieReq(FACE, { image: jpegUrl() }, { proof }), noDb as never);
    expect(res.status).toBe(401);
    expect(up.fn).not.toHaveBeenCalled();
  });

  it("verifyParentProofFromRequest: true for the issuing device, false for others, expired, or without a binding", async () => {
    const env = baseEnv();
    const proof = await proofFor(env, DEVICE_A);
    const req = (device: string, token: string | null) =>
      new Request("http://local/x", { headers: { "x-device-id": device, ...(token ? { "x-parent-proof": token } : {}) } });
    expect(await verifyParentProofFromRequest(req(DEVICE_A, proof), env)).toBe(true);
    expect(await verifyParentProofFromRequest(req(DEVICE_B, proof), env)).toBe(false);
    expect(await verifyParentProofFromRequest(req(DEVICE_A, null), env)).toBe(false);
    expect(await verifyParentProofFromRequest(req(DEVICE_A, proof), env, Date.now() + 60 * 60 * 1000)).toBe(false); // an hour later
    expect(await verifyParentProofFromRequest(req(DEVICE_A, proof), { PARENT_GATE_SECRET: "gate-secret-for-tests" })).toBe(false);
    expect(await verifyParentProofFromRequest(req("bad", proof), env)).toBe(false);
  });

  it("422 invalid for a missing image, a non-JPEG, bad base64, a wrong magic number, or unparsable JSON", async () => {
    const { env, proof } = await ready();
    const up = stubUpstream(cleanFace);
    const good = jpegUrl();
    const png = good.replace("image/jpeg", "image/png");
    const notBase64 = "data:image/jpeg;base64,@@@@@@@@@@@@@@@@@@@@";
    const wrongMagic = "data:image/jpeg;base64," + btoa("A".repeat(60));
    for (const [label, body] of [
      ["no image", {}],
      ["image not a string", { image: 5 }],
      ["png", { image: png }],
      ["not base64", { image: notBase64 }],
      ["wrong magic", { image: wrongMagic }],
      ["http url", { image: "https://example.com/a.jpg" }],
      ["unparsable json", "{not json"],
    ] as const) {
      resetSelfieRateLimit(); // validation comes after the rate limit; seven cases would otherwise hit the 6 a minute
      const res = await worker.fetch(selfieReq(FACE, body as never, { proof }), env as never);
      expect(res.status, label).toBe(422);
      expect(await res.json(), label).toEqual({ status: "invalid" });
    }
    expect(up.fn).not.toHaveBeenCalled();
  });

  it("validJpegDataUrl enforces the 900 000 byte decoded cap exactly", () => {
    expect(validJpegDataUrl(jpegUrl(MAX_SELFIE_JPEG_BYTES))).not.toBeNull();
    expect(validJpegDataUrl(jpegUrl(MAX_SELFIE_JPEG_BYTES + 1))).toBeNull();
    expect(validJpegDataUrl(jpegUrl(3_000))).not.toBeNull();
    expect(validJpegDataUrl(null)).toBeNull();
  });

  it("429 slow-down per device (6 face-parts, 3 cartoons a minute) and per IP, and other devices are unaffected", async () => {
    const env = baseEnv();
    const proofA = await proofFor(env, DEVICE_A);
    const proofB = await proofFor(env, DEVICE_B);
    stubUpstream((u, _i, prompt) => (u.includes("/images/edits") ? new Response(JSON.stringify({ data: [{ b64_json: "AAAA" }], output_format: "png" })) : cleanFace(u, _i, prompt)));
    const body = { image: jpegUrl() };
    for (let i = 0; i < 6; i++) expect((await worker.fetch(selfieReq(FACE, body, { proof: proofA }), env as never)).status).toBe(200);
    const seventh = await worker.fetch(selfieReq(FACE, body, { proof: proofA }), env as never);
    expect(seventh.status).toBe(429);
    expect(await seventh.json()).toEqual({ status: "slow-down" });
    expect((await worker.fetch(selfieReq(FACE, body, { proof: proofB, device: DEVICE_B }), env as never)).status).toBe(200);
    // cartoons have their own, smaller budget
    for (let i = 0; i < 3; i++) expect((await worker.fetch(selfieReq(CARTOON, body, { proof: proofA }), env as never)).status).toBe(200);
    expect((await worker.fetch(selfieReq(CARTOON, body, { proof: proofA }), env as never)).status).toBe(429);

    // per IP across devices: 12 face-parts a minute from one address
    resetSelfieRateLimit();
    const devices = [DEVICE_A, DEVICE_B, DEVICE_C];
    const proofs = new Map<string, string>();
    for (const d of devices) proofs.set(d, await proofFor(env, d));
    let last = 200;
    for (let i = 0; i < 13; i++) {
      const d = devices[i % 3]!;
      last = (await worker.fetch(selfieReq(FACE, body, { proof: proofs.get(d)!, device: d, ip: "203.0.113.9" }), env as never)).status;
      if (i < 12) expect(last, `request ${i + 1}`).toBe(200);
    }
    expect(last).toBe(429);
    // another address is fine
    const d4 = DEVICE_D;
    expect((await worker.fetch(selfieReq(FACE, body, { proof: await proofFor(env, d4), device: d4, ip: "203.0.113.77" }), env as never)).status).toBe(200);
  });
});

describe("selfie cloud: face parts from SAM", () => {
  it("returns the eyes and the mouth as fractions, left eye first, and calls SAM twice IN PARALLEL", async () => {
    const { env, proof } = await ready();
    const up = stubUpstream(cleanFace);
    const res = await worker.fetch(selfieReq(FACE, { image: jpegUrl() }, { proof }), env as never);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      status: "ok",
      eyes: [{ x: 0.35, y: 0.4 }, { x: 0.65, y: 0.4 }],
      mouth: { x: 0.5, y: 0.75 },
    });
    expect(up.calls.map((c) => c.prompt).sort()).toEqual(["eye", "mouth"]);
    expect(up.maxInFlight()).toBe(2); // both were in flight at once
    for (const c of up.calls) {
      expect(c.url).toMatch(/\/responses$/);
      const sent = JSON.parse(String(c.init.body));
      expect(sent.model).toBe("sam-3.1");
      expect(sent.input[0].content[1].image_url).toMatch(/^data:image\/jpeg;base64,/); // inline, as worker/meta.ts does
      expect((c.init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    }
  });

  it("sends nothing about the child upstream: no device id, proof, address or consent header", async () => {
    const { env, proof } = await ready();
    const up = stubUpstream(cleanFace);
    await worker.fetch(selfieReq(FACE, { image: jpegUrl() }, { proof, ip: "198.51.100.23" }), env as never);
    const wire = up.calls.map((c) => JSON.stringify(c.init)).join("\n");
    for (const secret of [DEVICE_A, proof, "198.51.100.23", "x-selfie-consent", "x-device-id", "x-parent-proof"]) expect(wire).not.toContain(secret);
  });

  it("keeps the last box per object (a stream repeats them) and splits one wide box in two", async () => {
    const { env, proof } = await ready();
    // objects repeat with growing boxes; the last record per object wins
    stubUpstream((_u, _i, prompt) =>
      samStream(prompt === "eye"
        ? [{ id: 1, x1: 0, y1: 0, x2: 10, y2: 10 }, EYES[0]!, EYES[1]!]
        : MOUTH));
    const a = await (await worker.fetch(selfieReq(FACE, { image: jpegUrl() }, { proof }), env as never)).json();
    expect(a).toMatchObject({ status: "ok", eyes: [{ x: 0.35, y: 0.4 }, { x: 0.65, y: 0.4 }] });

    resetSelfieRateLimit();
    // goggles: one wide eye box (0.6 of the width) is split into two eyes a quarter-width either side of its centre
    stubUpstream((_u, _i, prompt) => samStream(prompt === "eye" ? [{ id: 1, x1: 200, y1: 190, x2: 800, y2: 210 }] : MOUTH));
    const b = (await (await worker.fetch(selfieReq(FACE, { image: jpegUrl() }, { proof }), env as never)).json()) as { status: string; eyes: { x: number }[] };
    expect(b.status).toBe("ok");
    expect(b.eyes[0]!.x).toBeCloseTo(0.35, 3);
    expect(b.eyes[1]!.x).toBeCloseTo(0.65, 3);
  });

  it("answers no-match, never a guess, for a mouth above the eyes, a lopsided pair, one narrow eye, or no mouth", async () => {
    const { env, proof } = await ready();
    const run = async (eyes: Box[], mouth: Box[]) => {
      resetSelfieRateLimit();
      stubUpstream((_u, _i, prompt) => samStream(prompt === "eye" || prompt === "eyes" ? eyes : prompt === "mouth" || prompt === "lips" ? mouth : []));
      const res = await worker.fetch(selfieReq(FACE, { image: jpegUrl() }, { proof }), env as never);
      expect(res.status).toBe(200);
      return res.json();
    };
    // mouth above the eye line
    expect(await run(EYES, [{ id: 3, x1: 450, y1: 40, x2: 550, y2: 60 }])).toEqual({ status: "no-match" });
    // eyes at very different heights
    expect(await run([EYES[0]!, { id: 2, x1: 630, y1: 340, x2: 670, y2: 360 }], MOUTH)).toEqual({ status: "no-match" });
    // one narrow eye box
    expect(await run([EYES[0]!], MOUTH)).toEqual({ status: "no-match" });
    // no mouth at all
    expect(await run(EYES, [])).toEqual({ status: "no-match" });
    // the mouth far to the side of the eyes
    expect(await run(EYES, [{ id: 3, x1: 900, y1: 365, x2: 990, y2: 385 }])).toEqual({ status: "no-match" });
  });

  it("retries an empty prompt once with a synonym ('eyes', 'lips') and uses that result", async () => {
    const { env, proof } = await ready();
    const up = stubUpstream((_u, _i, prompt) => samStream(prompt === "eyes" ? EYES : prompt === "lips" ? MOUTH : []));
    const res = await worker.fetch(selfieReq(FACE, { image: jpegUrl() }, { proof }), env as never);
    expect(await res.json()).toMatchObject({ status: "ok", mouth: { x: 0.5, y: 0.75 } });
    expect(up.calls.map((c) => c.prompt).sort()).toEqual(["eye", "eyes", "lips", "mouth"]);
  });

  it("pickEyes / pickMouth / plausibleFace as pure rules", () => {
    const box = (id: number, cx: number, cy: number, w = 0.04, h = 0.04): never =>
      ({ objectId: id, x1: (cx - w / 2) * 1000, x2: (cx + w / 2) * 1000, y1: (cy - h / 2) * 1000, y2: (cy + h / 2) * 1000, imageWidth: 1000, imageHeight: 1000 }) as never;
    const eyes = pickEyes([box(2, 0.65, 0.4), box(1, 0.35, 0.4)]);
    expect(eyes && eyes[0]!.x < eyes[1]!.x).toBe(true);
    expect(pickEyes([box(1, 0.35, 0.4), box(2, 0.37, 0.4)])).toBeNull(); // too close in x
    expect(pickEyes([])).toBeNull();
    const mouth = pickMouth([box(1, 0.5, 0.7, 0.05, 0.02), box(2, 0.2, 0.2, 0.2, 0.2)]); // the larger box wins
    expect(mouth!.x).toBeCloseTo(0.2, 9);
    expect(mouth!.y).toBeCloseTo(0.2, 9);
    const l = { x: 0.35, y: 0.4 }, r = { x: 0.65, y: 0.4 }, m = { x: 0.5, y: 0.75 };
    expect(plausibleFace([l, r], m)).toBe(true);
    expect(plausibleFace([r, l], m)).toBe(false); // swapped eyes
    expect(plausibleFace([l, { x: 0.65, y: 0.5 }], m)).toBe(false); // not level
    expect(plausibleFace([l, r], { x: 0.5, y: 0.42 })).toBe(false); // mouth not below the eyes
    expect(plausibleFace([l, r], { x: 0.9, y: 0.75 })).toBe(false); // mouth beside the face
    expect(plausibleFace([l, { x: 1.2, y: 0.4 }], m)).toBe(false); // outside the picture
    expect(plausibleFace([l, r], { x: Number.NaN, y: 0.75 })).toBe(false);
  });
});

describe("selfie cloud: cartoon from Muse Image", () => {
  const png = new Response(JSON.stringify({ data: [{ b64_json: "iVBORw0KGgo=" }], output_format: "png" }));
  it("returns the redrawn picture as a data URL and asks Muse with the kid-safe prompt and the photo inline", async () => {
    const { env, proof } = await ready();
    const up = stubUpstream(() => png.clone());
    const res = await worker.fetch(selfieReq(CARTOON, { image: jpegUrl() }, { proof }), env as never);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ status: "ok", image: "data:image/png;base64,iVBORw0KGgo=" });
    expect(up.calls).toHaveLength(1);
    expect(up.calls[0]!.url).toMatch(/\/images\/edits$/);
    const sent = JSON.parse(String(up.calls[0]!.init.body));
    expect(sent.model).toBe("muse-image-1.0");
    expect(sent.prompt).toBe(SELFIE_CARTOON_PROMPT);
    expect(sent.prompt).toMatch(/children's toy/);
    expect(sent.prompt).toMatch(/no text/);
    expect(sent.images[0].image_url).toMatch(/^data:image\/jpeg;base64,/);
    expect(sent.n).toBe(1);
  });

  it("labels a non-png result as webp", async () => {
    const { env, proof } = await ready();
    stubUpstream(() => new Response(JSON.stringify({ data: [{ b64_json: "UklGRg==" }] })));
    const res = await worker.fetch(selfieReq(CARTOON, { image: jpegUrl() }, { proof }), env as never);
    expect(((await res.json()) as { image: string }).image).toBe("data:image/webp;base64,UklGRg==");
  });
});

describe("selfie cloud: upstream failures never leak", () => {
  const failures: [string, Upstream][] = [
    ["a 500 with text", () => new Response(UPSTREAM_SECRET, { status: 500 })],
    ["a 401 with text", () => new Response(UPSTREAM_SECRET, { status: 401 })],
    ["a timeout", () => { throw new DOMException("The operation timed out", "TimeoutError"); }],
    ["a network error with text", () => { throw new Error(UPSTREAM_SECRET); }],
  ];
  for (const [label, handler] of failures) {
    for (const path of [FACE, CARTOON]) {
      it(`${path}: ${label} -> 502 unavailable, with no upstream text in the response or the logs`, async () => {
        const { env, proof } = await ready();
        stubUpstream(handler);
        const res = await worker.fetch(selfieReq(path, { image: jpegUrl() }, { proof }), env as never);
        expect(res.status).toBe(502);
        const text = await res.text();
        expect(JSON.parse(text)).toEqual({ status: "unavailable" });
        expect(text).not.toContain(UPSTREAM_SECRET);
        expect(text).not.toContain(KEY);
        expect(logs.join("\n")).not.toContain(UPSTREAM_SECRET);
        expect(logs.join("\n")).not.toContain(KEY);
      });
    }
  }

  it("a cartoon response without an image is a 502, not a broken 200", async () => {
    const { env, proof } = await ready();
    stubUpstream(() => new Response(JSON.stringify({ data: [] })));
    const res = await worker.fetch(selfieReq(CARTOON, { image: jpegUrl() }, { proof }), env as never);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ status: "unavailable" });
  });

  it("one SAM call failing fails the request (502), not a half answer", async () => {
    const { env, proof } = await ready();
    stubUpstream((_u, _i, prompt) => (prompt === "mouth" ? new Response("x", { status: 503 }) : samStream(EYES)));
    const res = await worker.fetch(selfieReq(FACE, { image: jpegUrl() }, { proof }), env as never);
    expect(res.status).toBe(502);
  });
});

describe("selfie cloud: privacy", () => {
  it("logs only {event, status}: never the picture, the proof, the device id, the key or the eye and mouth numbers", async () => {
    const { env, proof } = await ready();
    const image = jpegUrl(4_000, "SELFIE-PAYLOAD-MARKER");
    stubUpstream((u, _i, prompt) => (u.includes("/images/edits") ? new Response(JSON.stringify({ data: [{ b64_json: "AAAA" }], output_format: "png" })) : cleanFace(u, _i, prompt)));
    await worker.fetch(selfieReq(FACE, { image }, { proof, ip: "198.51.100.5" }), env as never);
    await worker.fetch(selfieReq(CARTOON, { image }, { proof, ip: "198.51.100.5" }), env as never);
    await worker.fetch(selfieReq(FACE, { image }, { proof: "bad.token", ip: "198.51.100.5" }), env as never); // a refusal logs too
    const all = logs.join("\n");
    const b64 = image.slice("data:image/jpeg;base64,".length);
    for (let i = 0; i + 24 <= b64.length; i += 97) expect(all).not.toContain(b64.slice(i, i + 24));
    for (const secret of [proof, DEVICE_A, KEY, "198.51.100.5", "0.35", "0.65", "0.75", "SELFIE-PAYLOAD-MARKER", "data:image"]) expect(all).not.toContain(secret);
    const selfieLines = logs.filter((l) => l.includes("selfie_"));
    expect(selfieLines.length).toBeGreaterThanOrEqual(3);
    for (const line of selfieLines) {
      const o = JSON.parse(line) as Record<string, unknown>;
      expect(Object.keys(o).sort()).toEqual(["event", "status"]);
    }
  });

  it("never touches storage: the D1 stand-in sees no write that carries the picture", async () => {
    const writes: unknown[][] = [];
    const db = fakeDb();
    const spying: D1Like = { prepare: (sql) => ({ bind: (...v) => { writes.push([sql, ...v]); return db.prepare(sql).bind(...v); } }) };
    const env = { ...baseEnv(), DB: spying };
    const proof = await proofFor(env, DEVICE_A);
    writes.length = 0;
    stubUpstream(cleanFace);
    await worker.fetch(selfieReq(FACE, { image: jpegUrl(4_000) }, { proof }), env as never);
    expect(JSON.stringify(writes)).not.toContain("SELFIE-PAYLOAD-MARKER");
    expect(JSON.stringify(writes)).not.toContain("data:image");
    // the only D1 traffic is the proof key lookup
    for (const w of writes) expect(String(w[0])).toMatch(/parent_settings/);
  });

  it("every response, success or refusal, is no-store JSON", async () => {
    const { env, proof } = await ready();
    stubUpstream(cleanFace);
    const responses = [
      await worker.fetch(selfieReq(FACE, { image: jpegUrl() }, { proof }), env as never),
      await worker.fetch(selfieReq(FACE, { image: jpegUrl() }, { proof, consent: "v0" }), env as never),
      await worker.fetch(selfieReq(FACE, {}, { proof }), env as never),
      await worker.fetch(selfieReq(FACE, {}, { proof: "x" }), env as never),
      await worker.fetch(selfieReq(FACE, {}, {}, "GET"), env as never),
    ];
    for (const r of responses) {
      expect(r.headers.get("cache-control")).toBe("no-store");
      expect(r.headers.get("content-type")).toContain("application/json");
    }
  });
});
