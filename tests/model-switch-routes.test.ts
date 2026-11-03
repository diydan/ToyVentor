/**
 * The model switch (worker/modelBackend.ts) as the kid-facing routes see it: Create mode, Describe & Build, SAM, the image model, the photo-nouns look and the
 * grown-up gate. The property under test everywhere: when the switch says "off" or "self", NOTHING goes to Meta, even with the Meta key set.
 * Text-to-part has its own tests in tests/forge-make.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleDescribe } from "../worker/describe";
import worker from "../worker/index";
import type { D1Like } from "../worker/ownership";
import { cartoonizeFace, inspectPhotoNouns, makeSkin, samConfigured, segmentBoxes, segmentToy } from "../worker/meta";
import type { BackendEnv } from "../worker/modelBackend";
import { handleMuseSpark } from "../worker/muse";

const PHOTO = "data:image/png;base64,AAAA";
const META: BackendEnv = { MODEL_API_KEY: "meta-key" };
const OWN_TEXT: BackendEnv = { SELF_TEXT_URL: "https://glimmer.example.test/v1", SELF_TEXT_MODEL: "muse-glimmer-30b", SELF_TEXT_KEY: "own-key" };
const RECIPE = { format: "toyventor.level/1", id: "kid-world", name: "Garden", theme: "garden", props: [{ type: "lantern", x: 12 }], spots: [{ part: "character.hat.flower", hide: "scarecrow", x: 6 }] };

let calls: { url: string; auth: string | null; body: unknown }[];
let reply: () => Response;
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const responsesBody = (text: string) => ({ output: [{ content: [{ type: "output_text", text }] }] });

beforeEach(() => {
  calls = [];
  reply = () => json(responsesBody("{}"));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      calls.push({ url: String(input), auth: new Headers(init?.headers).get("authorization"), body: init?.body ? JSON.parse(String(init.body)) : null });
      return reply();
    }),
  );
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

let ip = 0;
const fresh = () => ({ "CF-Connecting-IP": `10.9.0.${++ip}` });
const post = (path: string, body: unknown) => new Request(`https://toyventor.com${path}`, { method: "POST", headers: { "content-type": "application/json", ...fresh() }, body: JSON.stringify(body) });
const museCall = (env: BackendEnv, extra: object = {}) => handleMuseSpark(post("/api/muse/spark", { model: "muse-spark", input: "a garden with lanterns", format: "json", ...extra }), env);
const describeCall = (env: BackendEnv) => handleDescribe(post("/api/describe", { description: "a race car" }), env);

describe("Create mode (/api/muse/spark)", () => {
  it("hosted: goes to Meta with the Meta key and the Spark model", async () => {
    reply = () => json(responsesBody(JSON.stringify({ say: "Hi!", recipe: RECIPE })));
    expect((await museCall(META)).status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: "https://api.meta.ai/v1/responses", auth: "Bearer meta-key", body: { model: "muse-spark-1.3" } });
  });

  it("self: goes to OUR endpoint with our key and model name, ignores the model the client asked for, and never touches Meta", async () => {
    reply = () => json(responsesBody(JSON.stringify({ say: "Hi!", recipe: RECIPE })));
    const res = await museCall({ ...META, ...OWN_TEXT, MODEL_BACKEND: "self" }, { model: "muse-spark-1.1" });
    expect(res.status).toBe(200);
    expect(calls.map((c) => c.url)).toEqual(["https://glimmer.example.test/v1/responses"]);
    expect(calls[0]).toMatchObject({ auth: "Bearer own-key", body: { model: "muse-glimmer-30b" } });
    const logged = vi.mocked(console.log).mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain('"backend":"self"');
    for (const secret of ["muse-glimmer-30b", "own-key", "glimmer.example.test"]) expect(logged).not.toContain(secret);
  });

  it("off, self with no endpoint, and a typo: 503 'not configured' and no network call, even with the Meta key set", async () => {
    for (const env of [{ ...META, MODEL_BACKEND: "off" }, { ...META, MODEL_BACKEND: "self" }, { ...META, MODEL_BACKEND: "selfhosted" }, { ...META, TEXT_BACKEND: "off" }]) {
      expect((await museCall(env)).status).toBe(503);
    }
    expect(calls).toHaveLength(0);
  });

  it("the status check says whether text is configured and does not publish our own model's name", async () => {
    const get = (env: BackendEnv) => handleMuseSpark(new Request("https://toyventor.com/api/muse/spark"), env).then((r) => r.json()) as Promise<{ configured: boolean; model: string | null }>;
    expect(await get(META)).toMatchObject({ configured: true, model: "muse-spark-1.3" });
    expect(await get({ ...META, ...OWN_TEXT, MODEL_BACKEND: "self" })).toEqual(expect.objectContaining({ configured: true, model: null }));
    expect(await get({ ...META, MODEL_BACKEND: "off" })).toMatchObject({ configured: false });
  });

  it("an upstream error is still a 502 with the status, and a call that never answered is still 'muse request failed'", async () => {
    reply = () => json({}, 500);
    const r1 = await museCall({ ...META, ...OWN_TEXT, MODEL_BACKEND: "self" });
    expect(r1.status).toBe(502);
    expect(((await r1.json()) as { error: string }).error).toBe("muse returned 500");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("boom"); }));
    const r2 = await museCall(META);
    expect(((await r2.json()) as { error: string }).error).toBe("muse request failed");
  });
});

describe("Describe & Build (/api/describe)", () => {
  it("self: our endpoint, our key, our model; off: 503 and silence", async () => {
    reply = () => json(responsesBody(JSON.stringify({ recipeId: "race-car", say: "Vroom!", question: null })));
    expect((await describeCall({ ...META, ...OWN_TEXT, MODEL_BACKEND: "self" })).status).toBe(200);
    expect(calls.map((c) => c.url)).toEqual(["https://glimmer.example.test/v1/responses"]);
    expect(calls[0]).toMatchObject({ auth: "Bearer own-key", body: { model: "muse-glimmer-30b" } });
    calls = [];
    expect((await describeCall({ ...META, MODEL_BACKEND: "off" })).status).toBe(503);
    expect((await describeCall({ ...META, MODEL_BACKEND: "self" })).status).toBe(503);
    expect(calls).toHaveLength(0);
  });
});

describe("SAM, the image model and the photo-nouns look have no adapter for our own models yet", () => {
  const modes: [string, BackendEnv][] = [
    ["off", { ...META, MODEL_BACKEND: "off" }],
    ["self", { ...META, MODEL_BACKEND: "self", SELF_SEGMENT_URL: "https://sam.example.test", SELF_IMAGE_URL: "https://img.example.test", ...OWN_TEXT }],
    ["a typo", { ...META, MODEL_BACKEND: "selfhosted" }],
  ];

  it("hosted still works: SAM goes to Meta's Responses API with the Meta key", async () => {
    reply = () => json(responsesBody(""));
    await segmentToy(META, PHOTO, "toy");
    expect(calls[0]).toMatchObject({ url: "https://api.meta.ai/v1/responses", auth: "Bearer meta-key" });
    expect(samConfigured(META)).toBe(true);
  });

  for (const [name, env] of modes) {
    it(`${name}: every call answers 'not configured' and sends NOTHING, even though the Meta key is set and our own endpoints are`, async () => {
      expect(samConfigured(env)).toBe(false);
      expect(await segmentToy(env, PHOTO, "toy")).toEqual({ status: "not-configured" });
      expect(await segmentBoxes(env, PHOTO, "face")).toEqual({ status: "not-configured" });
      expect(await makeSkin(env, PHOTO, "gold")).toEqual({ status: "not-configured" });
      expect(await cartoonizeFace(env, PHOTO)).toEqual({ status: "not-configured" });
      expect(await inspectPhotoNouns(env, PHOTO)).toEqual({ checked: false });
      expect(calls).toHaveLength(0);
    });
  }

  it("each capability is separate: image off leaves SAM hosted, and text self leaves SAM hosted", async () => {
    expect(samConfigured({ ...META, IMAGE_BACKEND: "off" })).toBe(true);
    expect(await makeSkin({ ...META, IMAGE_BACKEND: "off" }, PHOTO, "gold")).toEqual({ status: "not-configured" });
    expect(samConfigured({ ...META, ...OWN_TEXT, TEXT_BACKEND: "self" })).toBe(true);
    expect(await inspectPhotoNouns({ ...META, ...OWN_TEXT, TEXT_BACKEND: "self" }, PHOTO)).toEqual({ checked: false }); // the look reads photos: no adapter yet
    expect(calls).toHaveLength(0);
  });
});

describe("the grown-up gate no longer signs with the model key (worker/parent.ts)", () => {
  const DEVICE = "12345678-1234-1234-1234-123456789abc";
  function fakeDb(): D1Like {
    const settings = new Map<string, string>();
    return {
      prepare: (sql) => ({
        bind: (...values: unknown[]) => ({
          run: async () => {
            if (sql.includes("INSERT INTO parent_settings")) {
              const [id, text] = values as [string, string];
              if (!sql.includes("DO NOTHING") || !settings.has(id)) settings.set(id, text);
            }
            return {};
          },
          all: async () => {
            if (sql.includes("FROM parent_settings")) {
              const v = settings.get(values[0] as string);
              return { results: v !== undefined ? [{ settings_json: v }] : [] };
            }
            return { results: [] };
          },
        }),
      }),
    };
  }
  const gate = (env: object, body: object) =>
    worker.fetch(new Request("http://local/api/parent/gate", { method: "POST", headers: { "content-type": "application/json", "x-device-id": DEVICE }, body: JSON.stringify(body) }), env as never);

  it("a challenge made under one Meta key verifies under another key, and with no key at all (the secret is the stored one, not the model key)", async () => {
    const db = fakeDb();
    for (const [made, checked] of [[{ MODEL_API_KEY: "key-one" }, { MODEL_API_KEY: "key-two" }], [{ MODEL_API_KEY: "key-one" }, {}], [{}, { MODEL_API_KEY: "key-two" }]] as const) {
      const ch = (await (await gate({ DB: db, ...made }, { action: "challenge" })).json()) as { a: number; b: number; challengeToken: string };
      const ok = await gate({ DB: db, ...checked }, { action: "verify", challengeToken: ch.challengeToken, answer: ch.a * ch.b });
      expect(ok.status).toBe(200);
    }
  });

  it("an explicit PARENT_GATE_SECRET still wins, so a different secret does not verify", async () => {
    const db = fakeDb();
    const ch = (await (await gate({ DB: db, PARENT_GATE_SECRET: "secret-one" }, { action: "challenge" })).json()) as { a: number; b: number; challengeToken: string };
    const bad = await gate({ DB: db, PARENT_GATE_SECRET: "secret-two" }, { action: "verify", challengeToken: ch.challengeToken, answer: ch.a * ch.b });
    expect(bad.status).not.toBe(200);
  });
});

