/**
 * POST /api/forge/make (worker/forgeMake.ts): a child's words to a printable part. The model and the optimizer daemon are stubs here, so every
 * branch is cheap to reach; tests/forge-worker-daemon.test.ts runs the real daemon behind the Worker, and the live check with the real model is
 * recorded in docs/specs/forge-ai-spec.md.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FAST_TIMEOUT_MS, fastEligible, handleForgeMake, type ForgeMakeEnv } from "../worker/forgeMake";
import { resetForgeRateLimit } from "../worker/forgeOptimizer";
import worker from "../worker/index";
import type { D1Like } from "../worker/ownership";

const DEVICE = "12345678-1234-1234-1234-123456789abc";
const DAEMON = "http://127.0.0.1:8791";

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

async function parentProof(env: ForgeMakeEnv): Promise<string> {
  const call = (body: object) =>
    worker.fetch(
      new Request("http://local/api/parent/gate", { method: "POST", headers: { "content-type": "application/json", "x-device-id": DEVICE }, body: JSON.stringify(body) }),
      env as never,
    );
  const ch = (await (await call({ action: "challenge" })).json()) as { a: number; b: number; challengeToken: string };
  const ok = await call({ action: "verify", challengeToken: ch.challengeToken, answer: ch.a * ch.b });
  return ((await ok.json()) as { proofToken: string }).proofToken;
}

const SLICES = [
  { z: 0, w: 23.4, d: 11.4, r: 4.6 },
  { z: 10, w: 28, d: 14, r: 5 },
  { z: 20, w: 14, d: 8, r: 3 },
];
const NAMES = {
  en: { w: "wizard hat", g: "m" },
  es: { w: "sombrero de mago", g: "m" },
  fr: { w: "chapeau de magicien", g: "m" },
  de: { w: "Zauberhut", g: "m" },
  it: { w: "cappello da mago", g: "m" },
  pt: { w: "chapéu de mago", g: "m" },
  tr: { w: "büyücü şapkası", g: "m" },
};
const recipeOf = (over: object = {}) => ({ v: 1, id: "wizard_hat", name: "Starlight Wizard Hat", stat: "Glow", behavior: "Tall hat that clicks on", slot: "crown", shape: { kind: "loft", slices: SLICES }, ...over });

interface Seen {
  model: { input: string }[];
  /** Every model call as it went out: where, with what key, and what body (hosted and our own alike). */
  modelCalls: { url: string; auth: string | null; body: { model?: string; input?: string; instructions?: string; messages?: { role?: string; content: string }[] } }[];
  daemonPosts: { recipe: Record<string, unknown> }[];
  daemonGets: string[];
}

describe("POST /api/forge/make", () => {
  let env: ForgeMakeEnv;
  let headers: Record<string, string>;
  let seen: Seen;
  /** What the stubs answer; each test changes what it needs. */
  let model: () => Response;
  let daemonPreview: () => Response;
  let daemonJob: () => Response;

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const modelSays = (envelope: unknown) => () => json({ output_text: JSON.stringify(envelope) });

  beforeEach(async () => {
    resetForgeRateLimit();
    env = {
      DB: fakeDb(),
      PARENT_GATE_SECRET: "gate-secret-for-tests",
      FORGE_OPTIMIZER_URL: DAEMON,
      MODEL_API_KEY: "test-key",
      VOICE_SIGNING_KEY: "voice-signing-key-for-the-tests-0123456789",
    };
    headers = { "content-type": "application/json", "x-device-id": DEVICE, "x-parent-proof": await parentProof(env) };
    seen = { model: [], modelCalls: [], daemonPosts: [], daemonGets: [] };
    model = modelSays({ recipe: recipeOf(), names: NAMES });
    daemonPreview = () => json({ ok: true, status: "preview_ready", part_id: "custom_wizard_hat", job_id: "fjob_0123456789ab", draft_artifact: "custom_wizard_hat.x.draft.glb", glb_size: 10, orig_tris: 5, web_verts: 5, web_tris: 5, finish_class: "show_curved", elapsed_ms: 40, glb_base64: "Z2xi" });
    daemonJob = () => json({ job_id: "fjob_0123456789ab", status: "print_ready", gate_report: { ok: true } });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/responses") || url.includes("/chat/completions")) {
        const body = JSON.parse(String(init?.body)) as { input: string };
        seen.model.push(body);
        seen.modelCalls.push({ url, auth: new Headers(init?.headers).get("authorization"), body });
        return model();
      }
      if (url.startsWith(DAEMON) && url.endsWith("/v1/fast-preview")) {
        seen.daemonPosts.push(JSON.parse(String(init?.body)) as { recipe: Record<string, unknown> });
        return daemonPreview();
      }
      if (url.startsWith(`${DAEMON}/v1/jobs/`)) {
        seen.daemonGets.push(url);
        return daemonJob();
      }
      throw new Error(`unexpected fetch ${url}`);
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    resetForgeRateLimit();
  });

  const make = (body: object, h: Record<string, string> = headers, e: ForgeMakeEnv = env) =>
    handleForgeMake(new Request("http://local/api/forge/make", { method: "POST", headers: h, body: JSON.stringify(body) }), e);

  it("is routed by the Worker at /api/forge/make", async () => {
    const res = await worker.fetch(new Request("http://local/api/forge/make", { method: "POST", headers, body: JSON.stringify({ text: "a wizard hat" }) }), env as never);
    expect(res.status).toBe(200);
  });

  it("answers 503 and spends nothing when there is no model key", async () => {
    const res = await make({ text: "a wizard hat" }, headers, { ...env, MODEL_API_KEY: undefined, META_MODEL_API_KEY: undefined });
    expect(res.status).toBe(503);
    expect(seen.model).toHaveLength(0);
  });

  describe("the model switch (worker/modelBackend.ts)", () => {
    const SELF: ForgeMakeEnv = { MODEL_BACKEND: "self", SELF_TEXT_URL: "https://glimmer.example.test/v1/", SELF_TEXT_MODEL: "muse-glimmer-30b", SELF_TEXT_KEY: "own-key" };
    const logs = () => vi.mocked(console.log).mock.calls.map((c) => String(c[0]));

    beforeEach(() => {
      vi.spyOn(console, "log").mockImplementation(() => undefined);
    });

    it("hosted (the default): the call goes to Meta with the Meta key and the Spark model", async () => {
      expect((await make({ text: "a wizard hat" })).status).toBe(200);
      expect(seen.modelCalls).toHaveLength(1);
      expect(seen.modelCalls[0]).toMatchObject({ url: "https://api.meta.ai/v1/responses", auth: "Bearer test-key", body: { model: "muse-spark-1.3" } });
      expect(logs().some((l) => l.includes('"status":"ok"') && l.includes('"backend":"hosted"'))).toBe(true);
    });

    it("self: the call goes to OUR endpoint with OUR key and model name, in the responses shape, and nothing goes to Meta even though the Meta key is set", async () => {
      expect((await make({ text: "a wizard hat" }, headers, { ...env, ...SELF })).status).toBe(200);
      expect(seen.modelCalls).toHaveLength(1);
      expect(seen.modelCalls[0]).toMatchObject({ url: "https://glimmer.example.test/v1/responses", auth: "Bearer own-key", body: { model: "muse-glimmer-30b" } });
      expect(seen.modelCalls.some((c) => c.url.includes("meta.ai"))).toBe(false);
      expect(logs().some((l) => l.includes('"status":"ok"') && l.includes('"backend":"self"'))).toBe(true);
    });

    it("self with SELF_TEXT_API=chat speaks /chat/completions and reads the chat reply", async () => {
      model = () => json({ choices: [{ message: { content: JSON.stringify({ recipe: recipeOf(), names: NAMES }) } }] });
      const res = await make({ text: "a wizard hat" }, headers, { ...env, ...SELF, SELF_TEXT_API: "chat" });
      expect(res.status).toBe(200);
      expect(seen.modelCalls[0]).toMatchObject({ url: "https://glimmer.example.test/v1/chat/completions", auth: "Bearer own-key", body: { model: "muse-glimmer-30b" } });
      // Glimmer's reasoning strength rides in the system prompt, and no `reasoning` parameter is sent to our own model
      expect(seen.modelCalls[0]!.body.messages?.[0]).toEqual({ role: "system", content: "Reasoning strength: low" });
      expect(seen.modelCalls[0]!.body.messages?.[1]?.content).toContain("Child's wish");
      expect(seen.modelCalls[0]!.body).not.toHaveProperty("reasoning_effort");
      expect(seen.daemonPosts).toHaveLength(1); // the recipe from the chat reply reached the daemon
    });

    describe("the fast path: a tuned model first for a hat or head wish, the standard model as the fallback", () => {
      const FAST: ForgeMakeEnv = { ...SELF, SELF_TEXT_API: "chat", SELF_FAST_URL: "https://fast.example.test/v1", SELF_FAST_MODEL: "forge-fast", SELF_FAST_KEY: "fast-key" };
      const ON: ForgeMakeEnv = { ...FAST, FORGE_FAST_MODE: "on" };
      /** Answers a chat reply; the fast host answers with `fastStatus` instead when one is given. */
      const answer = (fastStatus?: number) => () => {
        const url = seen.modelCalls.at(-1)!.url;
        if (fastStatus && url.startsWith("https://fast.example.test")) return json({ error: "down" }, fastStatus);
        return json({ choices: [{ message: { content: JSON.stringify({ recipe: recipeOf(), names: NAMES }) } }] });
      };
      const hosts = () => seen.modelCalls.map((c) => new URL(c.url).host);
      const run = async (body: object, e: ForgeMakeEnv) => {
        resetForgeRateLimit();
        const res = await make(body, headers, { ...env, ...e });
        return { res, out: (await res.json()) as { ok?: boolean; model?: string; status?: string } };
      };

      it("on: the first attempt at a hat goes to the fast model with its own key and name, reads the production prompt, and the reply says which model made it", async () => {
        model = answer();
        const { res, out } = await run({ text: "a wizard hat" }, ON);
        expect(res.status).toBe(200);
        expect(hosts()).toEqual(["fast.example.test"]);
        expect(seen.modelCalls[0]).toMatchObject({ auth: "Bearer fast-key", body: { model: "forge-fast" } });
        expect(seen.modelCalls[0]!.body.messages?.[1]?.content).toContain("Child's wish"); // the production prompt, the text it was trained on
        expect(out.model).toBe("fast");
        expect(logs().some((l) => l.includes('"status":"ok"') && l.includes('"model":"fast"'))).toBe(true);
      });

      it("when the fast model is down or slow, the standard model answers the SAME request, and the log says so", async () => {
        model = answer(500);
        const { res, out } = await run({ text: "a wizard hat" }, ON);
        expect(res.status).toBe(200);
        // askText asks a model that answered 5xx once more when time allows (existing behaviour): so the fast model may be tried twice, the standard model answers exactly once
        expect(hosts()[0]).toBe("fast.example.test");
        expect(hosts().at(-1)).toBe("glimmer.example.test");
        expect(hosts().filter((h) => h === "glimmer.example.test")).toHaveLength(1);
        expect(hosts().length).toBeLessThanOrEqual(3);
        expect(out.model).toBe("standard");
        expect(logs().some((l) => l.includes("fast_fallback"))).toBe(true);
      });

      it("the fast model gets a short leash and the fallback fits in one request", async () => {
        const waits: number[] = [];
        const real = AbortSignal.timeout.bind(AbortSignal);
        vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => (waits.push(ms), real(ms)));
        model = answer(500);
        await run({ text: "a wizard hat" }, ON);
        expect(waits[0]).toBeLessThanOrEqual(FAST_TIMEOUT_MS);
        expect(FAST_TIMEOUT_MS + 55_000).toBeLessThanOrEqual(90_000);
        expect(waits[1]).toBeLessThanOrEqual(55_000);
      });

      it("a repair attempt (attempt 2 or later) never goes to the fast model", async () => {
        model = answer();
        const { res } = await run({ text: "a wizard hat", attempt: 2, repair: { bad_recipe: true, recipe: recipeOf() } }, ON);
        expect(res.status).toBe(200);
        expect(hosts()).toEqual(["glimmer.example.test"]);
      });

      it("every vehicle slot and the held prop go to the standard model; crown and head can go fast", async () => {
        model = answer();
        for (const slot of ["back", "hand", "front", "rollbar", "spoiler", "hood", "roof", "exhaust"]) {
          seen.modelCalls.length = 0;
          await run({ text: "a toy part", slot }, ON);
          expect(hosts(), slot).toEqual(["glimmer.example.test"]);
        }
        for (const slot of ["crown", "head"]) {
          seen.modelCalls.length = 0;
          await run({ text: "a wizard hat", slot }, ON);
          expect(hosts(), slot).toEqual(["fast.example.test"]);
        }
      });

      it("the grown-up's choice: fast:false is the standard model only; anything but true or false is refused", async () => {
        model = answer();
        await run({ text: "a wizard hat", fast: false }, ON);
        expect(hosts()).toEqual(["glimmer.example.test"]);
        const bad = await run({ text: "a wizard hat", fast: "yes" }, ON);
        expect(bad.res.status).toBe(422);
        expect(bad.out.status).toBe("invalid");
      });

      it("optin: only when the client says fast:true; with no choice it is the standard model", async () => {
        model = answer();
        await run({ text: "a wizard hat" }, { ...FAST, FORGE_FAST_MODE: "optin" });
        expect(hosts()).toEqual(["glimmer.example.test"]);
        seen.modelCalls.length = 0;
        await run({ text: "a wizard hat", fast: true }, { ...FAST, FORGE_FAST_MODE: "optin" });
        expect(hosts()).toEqual(["fast.example.test"]);
      });

      it("off by default: unset, misspelt or anything else is the standard model, even when the client asks for fast", async () => {
        model = answer();
        for (const mode of [undefined, "", "off", "ON ", "true", "1", "yes", "optIn "]) {
          seen.modelCalls.length = 0;
          const e: ForgeMakeEnv = { ...FAST, ...(mode === undefined ? {} : { FORGE_FAST_MODE: mode }) };
          await run({ text: "a wizard hat", fast: true }, e);
          // "ON " and "optIn " are trimmed and lower-cased like every other switch, so they DO mean on and optin: the rest are off
          const expected = mode === "ON " || mode === "optIn " ? "fast.example.test" : "glimmer.example.test";
          expect(hosts(), JSON.stringify(mode)).toEqual([expected]);
        }
      });

      it("not fully configured means no fast path: no address, no model name, or an address that is not https", async () => {
        model = answer();
        for (const e of [{ ...ON, SELF_FAST_URL: undefined }, { ...ON, SELF_FAST_MODEL: undefined }, { ...ON, SELF_FAST_URL: "http://fast.example.test/v1" }]) {
          seen.modelCalls.length = 0;
          await run({ text: "a wizard hat" }, e as ForgeMakeEnv);
          expect(hosts()).toEqual(["glimmer.example.test"]);
        }
      });

      it("with the standard backend HOSTED (today's adult-operated demo) the fast path still runs our own model first, and the hosted model is the fallback and the repairer", async () => {
        const HOSTED_FAST: ForgeMakeEnv = { FORGE_FAST_MODE: "on", SELF_FAST_URL: "https://fast.example.test/v1", SELF_FAST_MODEL: "forge-fast", SELF_FAST_KEY: "fast-key" }; // no MODEL_BACKEND: hosted by default
        const chat = () => json({ choices: [{ message: { content: JSON.stringify({ recipe: recipeOf(), names: NAMES }) } }] });
        const hostedReply = () => json({ output_text: JSON.stringify({ recipe: recipeOf(), names: NAMES }) });
        model = () => (seen.modelCalls.at(-1)!.url.startsWith("https://fast.example.test") ? chat() : hostedReply());
        const ok = await run({ text: "a wizard hat" }, HOSTED_FAST);
        expect(ok.out.model).toBe("fast");
        expect(hosts()).toEqual(["fast.example.test"]);
        expect(seen.modelCalls[0]!.auth).toBe("Bearer fast-key"); // our own key goes to our own server only, never the hosted key
        seen.modelCalls.length = 0;
        model = () => (seen.modelCalls.at(-1)!.url.startsWith("https://fast.example.test") ? json({ error: "down" }, 500) : hostedReply());
        const fallback = await run({ text: "a wizard hat" }, HOSTED_FAST);
        expect(fallback.out.model).toBe("standard");
        expect(hosts().at(-1)).not.toBe("fast.example.test"); // the hosted model answered
        expect(seen.modelCalls.at(-1)!.auth).toBe("Bearer test-key");
        seen.modelCalls.length = 0;
        model = hostedReply;
        await run({ text: "a wizard hat", attempt: 2, repair: { bad_recipe: true, recipe: recipeOf() } }, HOSTED_FAST);
        expect(hosts().every((h) => h !== "fast.example.test")).toBe(true); // a repair never goes to the fast model
      });

      describe("who the SERVICE treats the request as: a child's request never reaches the hosted model", () => {
        const OWN: ForgeMakeEnv = { SELF_TEXT_URL: "https://glimmer.example.test/v1", SELF_TEXT_MODEL: "muse-glimmer-30b", SELF_TEXT_KEY: "own-key", SELF_TEXT_API: "chat" }; // our standard server, configured beside the HOSTED switch
        const HOSTED_FAST: ForgeMakeEnv = { ...OWN, FORGE_FAST_MODE: "on", SELF_FAST_URL: "https://fast.example.test/v1", SELF_FAST_MODEL: "forge-fast", SELF_FAST_KEY: "fast-key" }; // MODEL_BACKEND unset: hosted by default
        const CHILD: ForgeMakeEnv = { ...HOSTED_FAST, FORGE_AUDIENCE_DEFAULT: "child" };
        const chat = () => json({ choices: [{ message: { content: JSON.stringify({ recipe: recipeOf(), names: NAMES }) } }] });
        const hostedReply = () => json({ output_text: JSON.stringify({ recipe: recipeOf(), names: NAMES }) });
        const routed = (fastDown = false) => () => {
          const url = seen.modelCalls.at(-1)!.url;
          if (url.startsWith("https://fast.example.test")) return fastDown ? json({ error: "down" }, 500) : chat();
          return url.includes("/chat/completions") ? chat() : hostedReply(); // our standard server speaks chat; the hosted one speaks responses
        };
        const hostedCalls = () => seen.modelCalls.filter((c) => c.url.includes("/responses"));

        it("a child: the fast model first, then OUR standard server as the fallback and the repairer; the hosted model is never called", async () => {
          model = routed(true);
          const a = await run({ text: "a wizard hat" }, CHILD);
          expect(a.out.model).toBe("standard");
          expect((a.out as { audience?: string }).audience).toBe("child");
          expect(new Set(hosts())).toEqual(new Set(["fast.example.test", "glimmer.example.test"]));
          seen.modelCalls.length = 0;
          model = routed();
          await run({ text: "a wizard hat", attempt: 2, repair: { bad_recipe: true, recipe: recipeOf() } }, CHILD);
          await run({ text: "a toy part", slot: "hood" }, CHILD);
          expect(hosts().every((h) => h === "glimmer.example.test")).toBe(true);
          expect(hostedCalls()).toHaveLength(0);
          expect(seen.modelCalls.every((c) => c.auth !== "Bearer test-key")).toBe(true); // the hosted key never leaves for a child
        });

        it("an adult build (the Nov 4 default): the hosted model is the standard one, exactly as today", async () => {
          model = routed(true);
          const a = await run({ text: "a wizard hat" }, HOSTED_FAST);
          expect(a.out.model).toBe("standard");
          expect((a.out as { audience?: string }).audience).toBe("adult");
          expect(hostedCalls().length).toBeGreaterThan(0);
        });

        it("a child with no server of ours configured gets NO part, not a hosted one (503 disabled), and nothing is sent anywhere", async () => {
          model = routed();
          const { res, out } = await run({ text: "a wizard hat" }, { FORGE_AUDIENCE_DEFAULT: "child" });
          expect(res.status).toBe(503);
          expect(out.status).toBe("disabled");
          expect(seen.modelCalls).toHaveLength(0);
          expect(logs().some((l) => l.includes("no_model_for_audience") && l.includes("child_has_no_own_model"))).toBe(true);
        });

        it("a child with only the fast model configured: it answers first attempts, and a repair or a vehicle slot (which it must not make) is refused 503, never sent to the hosted model", async () => {
          const ONLY_FAST: ForgeMakeEnv = { FORGE_AUDIENCE_DEFAULT: "child", FORGE_FAST_MODE: "on", SELF_FAST_URL: "https://fast.example.test/v1", SELF_FAST_MODEL: "forge-fast" };
          model = routed();
          const first = await run({ text: "a wizard hat" }, ONLY_FAST);
          expect(first.out.model).toBe("fast");
          seen.modelCalls.length = 0;
          const repair = await run({ text: "a wizard hat", attempt: 2, repair: { bad_recipe: true, recipe: recipeOf() } }, ONLY_FAST);
          const slot = await run({ text: "a toy part", slot: "hood" }, ONLY_FAST);
          expect(repair.res.status).toBe(503);
          expect(slot.res.status).toBe(503);
          expect(seen.modelCalls).toHaveLength(0);
        });

        it("the server-wide child lock (FORGE_HOSTED_FOR_ADULTS=off) makes every request a child's, so make-from-words runs on our own models only; an unrecognised value does not lock", async () => {
          model = routed();
          await run({ text: "a wizard hat" }, { ...HOSTED_FAST, FORGE_FAST_MODE: "off", FORGE_AUDIENCE_DEFAULT: "adult", FORGE_HOSTED_FOR_ADULTS: "off" });
          expect(hostedCalls()).toHaveLength(0);
          expect(hosts()).toEqual(["glimmer.example.test"]);
          seen.modelCalls.length = 0;
          await run({ text: "a wizard hat" }, { ...HOSTED_FAST, FORGE_FAST_MODE: "off", FORGE_HOSTED_FOR_ADULTS: "no" });
          expect(hostedCalls().length).toBeGreaterThan(0);
        });

        it("a request that names no audience gets the service's default: the build's (adult for Nov 4), or what FORGE_AUDIENCE_DEFAULT says; an odd value falls back to the build's", async () => {
          model = routed();
          await run({ text: "a wizard hat" }, { ...HOSTED_FAST, FORGE_FAST_MODE: "off" });
          expect(hostedCalls().length).toBeGreaterThan(0);
          seen.modelCalls.length = 0;
          await run({ text: "a wizard hat" }, { ...HOSTED_FAST, FORGE_FAST_MODE: "off", FORGE_AUDIENCE_DEFAULT: "child" });
          expect(hostedCalls()).toHaveLength(0);
          seen.modelCalls.length = 0;
          await run({ text: "a wizard hat" }, { ...HOSTED_FAST, FORGE_FAST_MODE: "off", FORGE_AUDIENCE_DEFAULT: "banana" });
          expect(hostedCalls().length).toBeGreaterThan(0);
        });

        it("a device cannot choose: a request that names an audience is treated exactly like one that does not (it can neither widen nor narrow what the service allows)", async () => {
          model = routed();
          const asksAdult = await run({ text: "a wizard hat", audience: "adult" }, { ...CHILD, FORGE_FAST_MODE: "off" });
          expect(asksAdult.res.status).toBe(200);
          expect(hostedCalls()).toHaveLength(0); // the service says child: naming itself an adult changes nothing
          seen.modelCalls.length = 0;
          const asksChild = await run({ text: "a wizard hat", audience: "child" }, { ...HOSTED_FAST, FORGE_FAST_MODE: "off" });
          expect(asksChild.res.status).toBe(200);
          expect(hostedCalls().length).toBeGreaterThan(0); // the service says adult: the field is ignored
        });
      });

      it("a standard backend switched OFF is off for the fast path too", async () => {
        model = answer();
        const { res } = await run({ text: "a wizard hat" }, { ...ON, MODEL_BACKEND: "off" });
        expect(res.status).toBe(503);
        expect(seen.modelCalls).toHaveLength(0);
      });

      it("fastEligible, as a table", () => {
        const e = (o: Partial<Parameters<typeof fastEligible>[0]>) => fastEligible({ mode: "on", wantsFast: undefined, attempt: 1, repaired: false, ...o });
        expect(e({})).toBe(true);
        expect(e({ mode: "off" })).toBe(false);
        expect(e({ wantsFast: false })).toBe(false);
        expect(e({ mode: "optin" })).toBe(false);
        expect(e({ mode: "optin", wantsFast: true })).toBe(true);
        expect(e({ mode: "off", wantsFast: true })).toBe(false);
        expect(e({ attempt: 2 })).toBe(false);
        expect(e({ repaired: true })).toBe(false);
        expect(e({ slot: "crown" })).toBe(true);
        expect(e({ slot: "head" })).toBe(true);
        expect(e({ slot: "hand" })).toBe(false);
      });
    });

    it("self in the responses shape sends the strength as `instructions`, and only one attempt even if the server answers 400", async () => {
      model = () => json({ error: "bad request" }, 400);
      const res = await make({ text: "a wizard hat" }, headers, { ...env, ...SELF });
      expect(res.status).toBe(502);
      expect(seen.modelCalls).toHaveLength(1); // no second try without a parameter we never sent
      expect(seen.modelCalls[0]!.body).toMatchObject({ model: "muse-glimmer-30b", instructions: "Reasoning strength: low" });
      expect(seen.modelCalls[0]!.body).not.toHaveProperty("reasoning");
    });

    it("hosted still sends the reasoning parameter and retries without it on a 400 (unchanged)", async () => {
      let n = 0;
      model = () => (++n === 1 ? json({ error: "unknown parameter" }, 400) : json({ output_text: JSON.stringify({ recipe: recipeOf(), names: NAMES }) }));
      expect((await make({ text: "a wizard hat" })).status).toBe(200);
      expect(seen.modelCalls).toHaveLength(2);
      expect(seen.modelCalls[0]!.body).toHaveProperty("reasoning");
      expect(seen.modelCalls[1]!.body).not.toHaveProperty("reasoning");
    });

    it("SELF_TEXT_PROMPT=tuned sends the short prompt to our own model, and the default sends the long one; the hosted API always gets the long one", async () => {
      await make({ text: "a wizard hat" }, headers, { ...env, ...SELF });
      const long = seen.modelCalls[0]!.body.input ?? seen.modelCalls[0]!.body.messages?.[1]?.content ?? "";
      resetForgeRateLimit();
      await make({ text: "a wizard hat" }, headers, { ...env, ...SELF, SELF_TEXT_PROMPT: "tuned" });
      const short = seen.modelCalls[1]!.body.input ?? seen.modelCalls[1]!.body.messages?.[1]?.content ?? "";
      resetForgeRateLimit();
      await make({ text: "a wizard hat" }, headers, { ...env, SELF_TEXT_PROMPT: "tuned" }); // hosted: the flag is ignored
      const hosted = seen.modelCalls[2]!.body.input ?? "";
      expect(long.length).toBeGreaterThan(5000);
      expect(short.length).toBeLessThan(900);
      expect(short).toContain("Child's wish: \"a wizard hat\"");
      expect(hosted.length).toBeGreaterThan(5000);
    });

    it("our own model is given 80 s and the hosted API 55 s, so a slow Glimmer answer finishes instead of falling back", async () => {
      const spy = vi.spyOn(AbortSignal, "timeout");
      await make({ text: "a wizard hat" }, headers, { ...env, ...SELF });
      const selfMs = spy.mock.calls[0]?.[0] as number;
      spy.mockClear();
      resetForgeRateLimit();
      await make({ text: "a wizard hat" });
      const hostedMs = spy.mock.calls[0]?.[0] as number;
      expect(selfMs).toBeGreaterThan(79_000);
      expect(selfMs).toBeLessThanOrEqual(80_000);
      expect(hostedMs).toBeGreaterThan(54_000);
      expect(hostedMs).toBeLessThanOrEqual(55_000);
      spy.mockRestore();
    });

    it("a retried call shows in the log line, and a call that was not retried does not", async () => {
      let n = 0;
      model = () => (++n === 1 ? json({ error: "proxy dropped" }, 500) : json({ output_text: JSON.stringify({ recipe: recipeOf(), names: NAMES }) }));
      expect((await make({ text: "a wizard hat" }, headers, { ...env, ...SELF, SELF_TEXT_API: "responses" })).status).toBe(200);
      expect(seen.modelCalls).toHaveLength(2);
      expect(logs().some((l) => l.includes('"status":"ok"') && l.includes('"retried":true'))).toBe(true);
      resetForgeRateLimit();
      vi.mocked(console.log).mockClear();
      model = modelSays({ recipe: recipeOf(), names: NAMES });
      await make({ text: "a wizard hat" }, headers, { ...env, ...SELF });
      expect(logs().some((l) => l.includes('"status":"ok"') && l.includes("retried"))).toBe(false);
    });

    it("self without a key sends no authorization header at all", async () => {
      await make({ text: "a wizard hat" }, headers, { ...env, ...SELF, SELF_TEXT_KEY: undefined });
      expect(seen.modelCalls[0]!.auth).toBeNull();
    });

    it("FAIL CLOSED: self with no endpoint answers 503 disabled and makes NO network call, even with the Meta key set", async () => {
      const res = await make({ text: "a wizard hat" }, headers, { ...env, MODEL_BACKEND: "self" });
      expect(res.status).toBe(503);
      expect(((await res.json()) as { status: string }).status).toBe("disabled");
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(logs().some((l) => l.includes('"no_model_for_audience"') && l.includes('"not_configured"'))).toBe(true); // decided per audience now (a missing config is no model, not an early off)
    });

    it("off, and a misspelt switch: 503 disabled, no network call, and the log says why", async () => {
      for (const [mode, reason] of [["off", "disabled"], ["selfhosted", "invalid"]] as const) {
        resetForgeRateLimit();
        const res = await make({ text: "a wizard hat" }, headers, { ...env, MODEL_BACKEND: mode });
        expect(res.status).toBe(503);
        expect(logs().some((l) => l.includes('"backend_off"') && l.includes(`"${reason}"`))).toBe(true);
      }
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("a request cannot choose: a header or a body field naming a backend changes nothing", async () => {
      const sneaky = { ...headers, "x-model-backend": "hosted", "x-backend": "hosted" };
      const off = await make({ text: "a wizard hat", backend: "hosted", MODEL_BACKEND: "hosted" }, sneaky, { ...env, MODEL_BACKEND: "off" });
      expect(off.status).toBe(503);
      expect(globalThis.fetch).not.toHaveBeenCalled();
      resetForgeRateLimit();
      await make({ text: "a wizard hat", backend: "hosted" }, sneaky, { ...env, ...SELF });
      expect(seen.modelCalls.map((c) => c.url)).toEqual(["https://glimmer.example.test/v1/responses"]);
    });

    it("no log line carries a URL, a key or the model name", async () => {
      await make({ text: "a wizard hat" }, headers, { ...env, ...SELF });
      const all = logs().join("\n");
      for (const secret of ["own-key", "test-key", "glimmer.example.test", "muse-glimmer-30b"]) expect(all).not.toContain(secret);
    });
  });

  it("needs no grown-up proof to make a part (Dan, 2026-11-03), but does need a device id", async () => {
    const noProof: Record<string, string> = { "content-type": "application/json", "x-device-id": DEVICE };
    expect((await make({ text: "a wizard hat" }, noProof)).status).toBe(200);
    resetForgeRateLimit();
    expect((await make({ text: "a wizard hat" }, { "content-type": "application/json" })).status).toBe(401); // no device id: refused before the model
    expect(seen.model).toHaveLength(1);
  });

  it("puts the grown-up proof back in front of making when FORGE_MAKE_REQUIRES_PROOF=1, before any model call", async () => {
    const strict: ForgeMakeEnv = { ...env, FORGE_MAKE_REQUIRES_PROOF: "1" };
    for (const h of [{ "content-type": "application/json" }, { "content-type": "application/json", "x-device-id": DEVICE }] as Record<string, string>[]) {
      expect((await make({ text: "a wizard hat" }, h, strict)).status).toBe(401);
    }
    expect(seen.model).toHaveLength(0);
    expect((await make({ text: "a wizard hat" }, headers, strict)).status).toBe(200); // with the proof it works as before
  });

  it("serves a make job's status without a proof, and keeps the proof in front of the printable file", async () => {
    const noProof: Record<string, string> = { "x-device-id": DEVICE };
    const job = await worker.fetch(new Request("http://local/api/forge/make/jobs/fjob_0123456789ab", { headers: noProof }), env as never);
    expect(job.status).toBe(200);
    expect(((await job.json()) as { status: string }).status).toBe("print_ready");
    expect((await worker.fetch(new Request("http://local/api/forge/make/jobs/not-a-job", { headers: noProof }), env as never)).status).toBe(400);
    // the proof comes back for the status when the switch is on
    const strict = { ...env, FORGE_MAKE_REQUIRES_PROOF: "1" };
    expect((await worker.fetch(new Request("http://local/api/forge/make/jobs/fjob_0123456789ab", { headers: noProof }), strict as never)).status).toBe(401);
    // the printable file: always behind the proof
    const file = await worker.fetch(new Request("http://local/api/forge/artifacts/custom_wizard_hat.0123456789ab.stl", { headers: noProof }), env as never);
    expect(file.status).toBe(401);
  });

  it("turns away what intake refuses, before any model call", async () => {
    const cases: [object, string][] = [
      [{ text: "" }, "invalid"],
      [{ text: "x".repeat(121) }, "invalid"],
      [{ text: 42 }, "invalid"],
      [{ text: "a scary knife" }, "not-allowed"],
      [{ text: "a lego car" }, "brand-rejected"],
      [{ text: "a hat", slot: "wing" }, "invalid"],
      [{ text: "a hat", attempt: 5 }, "invalid"],
      [{ text: "a hat", attempt: 1.5 }, "invalid"],
    ];
    for (const [body, status] of cases) {
      resetForgeRateLimit();
      const res = await make(body);
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect(((await res.json()) as { status: string }).status, JSON.stringify(body)).toBe(status);
    }
    expect(seen.model).toHaveLength(0);
    expect(seen.daemonPosts).toHaveLength(0);
  });

  it("builds a part: the model prompt carries the wish and the rules, the daemon gets the checked recipe, the reply carries signed names", async () => {
    // a recipe with a key the allowlist does not know, and a number out of range for nothing: both must be handled before the daemon sees it
    model = modelSays({ recipe: recipeOf({ evil: "rm -rf /", features: [{ op: "star", size_mm: 10, run: "x" }] }), names: NAMES });
    const res = await make({ text: "a wizard hat, call 555-123-4567 please" });
    expect(res.status).toBe(200);
    const out = (await res.json()) as Record<string, any>;
    expect(out).toMatchObject({ ok: true, status: "preview_ready", job_id: "fjob_0123456789ab", attempt: 1, calls_left: 3, name: "Starlight Wizard Hat", name_en: "wizard hat" });
    expect(out.glb_base64).toBe("Z2xi");
    expect(out.recipe.evil).toBeUndefined();
    expect(out.recipe.features).toEqual([{ op: "star", size_mm: 10 }]);
    // the model saw the wish, with the phone number scrubbed, the recipe rules (prompt v5) and the reply envelope
    const prompt = seen.model[0]!.input;
    expect(prompt).toContain(`Child's wish: "a wizard hat, call [number removed] please"`);
    expect(prompt).not.toContain("555-123-4567");
    expect(prompt).toContain("0.78");
    expect(prompt).toContain('{"recipe": <the Recipe v1 described above>, "names"');
    // the daemon got only the checked recipe
    expect(seen.daemonPosts[0]!.recipe.evil).toBeUndefined();
    expect(seen.daemonPosts[0]!.recipe.slot).toBe("crown");
    // every language kept its noun and carries a 43-character signature
    expect(Object.keys(out.names).sort()).toEqual(["de", "en", "es", "fr", "it", "pt", "tr"]);
    for (const n of Object.values(out.names) as { sig: string }[]) expect(n.sig).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("a two-word wish keeps all seven names even when the model's English name is the wish itself (found 2026-11-04: 'robot hat' lost every name, in every model)", async () => {
    model = modelSays({ recipe: recipeOf({ name: "Robot Dome Hat" }), names: { ...NAMES, en: { w: "robot hat", g: "m" } } });
    const out = (await (await make({ text: "robot hat" })).json()) as { names: Record<string, { w: string }>; recipe: { name: string } };
    expect(Object.keys(out.names).sort()).toEqual(["de", "en", "es", "fr", "it", "pt", "tr"]);
    expect(out.names.en!.w).toBe("Robot Dome Hat"); // the recipe's own name stands in for the echo
    expect(out.recipe.name).toBe("Robot Dome Hat");
  });
  it("but a wish the model merely repeats keeps nothing when the recipe name repeats it too", async () => {
    model = modelSays({ recipe: recipeOf({ name: "robot hat" }), names: { ...NAMES, en: { w: "robot hat", g: "m" } } });
    const out = (await (await make({ text: "robot hat" })).json()) as { names: Record<string, unknown>; recipe: { name: string } };
    expect(out.names).toEqual({});
    expect(out.recipe.name).toBe("My Creation");
  });
  it("drops a name that is wrong or unsafe and keeps the rest, and says nothing when no signing key is set", async () => {
    model = modelSays({ recipe: recipeOf(), names: { ...NAMES, es: { w: "sombrero", g: "n" }, fr: { w: "a scary knife", g: "m" }, de: { w: "Zauber123", g: "m" } } });
    const out = (await (await make({ text: "a wizard hat" })).json()) as { names: Record<string, unknown> };
    expect(Object.keys(out.names).sort()).toEqual(["en", "it", "pt", "tr"]); // es: no neuter in Spanish, fr: unsafe word, de: digits
    resetForgeRateLimit();
    const unsigned = (await (await make({ text: "a wizard hat" }, headers, { ...env, VOICE_SIGNING_KEY: undefined })).json()) as { names: unknown; recipe: unknown };
    expect(unsigned.names).toEqual({}); // nothing can be spoken without the key, the part still comes back
    expect(unsigned.recipe).toBeTruthy();
  });

  it("builds the vehicle slots and the held prop when a panel asks for them (added 2026-11-04), and each reaches the daemon as that slot", async () => {
    for (const slot of ["back", "front", "rollbar", "spoiler", "hood", "roof", "exhaust"] as const) {
      resetForgeRateLimit();
      model = modelSays({ recipe: recipeOf({ slot }), names: NAMES });
      const res = await make({ text: "a shiny part", slot });
      expect(res.status, slot).toBe(200);
      expect(seen.daemonPosts.at(-1)!.recipe.slot, slot).toBe(slot);
    }
    resetForgeRateLimit();
    model = modelSays({ recipe: recipeOf({ slot: "hand", shape: { kind: "star2d", points: 5, outer_r_mm: 20, inner_r_mm: 10 } }), names: NAMES });
    const hand = await make({ text: "a star wand", slot: "hand" });
    expect(hand.status).toBe(200);
    expect(seen.daemonPosts.at(-1)!.recipe.slot).toBe("hand");
  });

  it("holds the recipe to the slot asked for, and to a hat or a head when none is asked for", async () => {
    model = modelSays({ recipe: recipeOf({ slot: "crown" }), names: NAMES });
    await make({ text: "a robot head", slot: "head" });
    expect(seen.daemonPosts[0]!.recipe.slot).toBe("head");
    resetForgeRateLimit();
    model = modelSays({ recipe: recipeOf({ slot: "exhaust" }), names: NAMES });
    const res = await make({ text: "a pipe" });
    expect(res.status).toBe(502);
    expect(((await res.json()) as { status: string }).status).toBe("no-recipe");
    expect(seen.daemonPosts).toHaveLength(1); // the second never reached the daemon
  });

  it("does not trust what the model says: a brand in the recipe, text that is not JSON, a model that fails", async () => {
    model = modelSays({ recipe: recipeOf({ name: "Lego Wizard Hat" }), names: NAMES });
    expect((await make({ text: "a wizard hat" })).status).toBe(502);
    resetForgeRateLimit();
    model = () => json({ output_text: "Sure! Here is a hat, enjoy." });
    expect((await make({ text: "a wizard hat" })).status).toBe(502);
    resetForgeRateLimit();
    model = () => new Response("boom", { status: 500 });
    const res = await make({ text: "a wizard hat" });
    expect(res.status).toBe(502);
    expect(((await res.json()) as { status: string }).status).toBe("unavailable");
    expect(seen.daemonPosts).toHaveLength(0);
  });

  it("keeps a part's name and line safe for a child, and never echoes the wish", async () => {
    model = modelSays({ recipe: recipeOf({ name: "Scary Knife Hat", behavior: "A hat for a wizard hat" }), names: NAMES });
    const out = (await (await make({ text: "a wizard hat" })).json()) as { name: string; recipe: { behavior: string } };
    expect(out.name).toBe("My Creation");
    expect(out.recipe.behavior).toBe("Made from your idea");
  });

  it("replaces a trademarked name the model produced, in the part name and in each language (the intake only knows building-toy brands)", async () => {
    model = modelSays({ recipe: recipeOf({ name: "Pikachu Hat", behavior: "A Disney hat" }), names: { ...NAMES, es: { w: "sombrero de Spiderman", g: "m" } } });
    const out = (await (await make({ text: "a yellow mouse hat" })).json()) as { name: string; recipe: { behavior: string }; names: Record<string, { w: string }> };
    expect(out.name).toBe("My Creation");
    expect(out.recipe.behavior).toBe("Made from your idea");
    expect(Object.keys(out.names)).not.toContain("es"); // that language is dropped, the others stay
    expect(out.names.en!.w).toBe("wizard hat");
    resetForgeRateLimit();
    // the 2026-11-04 Glimmer slip: a bare character first name in the part's name ("Mickey Style Ears Hat") used to get through the two-word list
    resetForgeRateLimit();
    model = modelSays({ recipe: recipeOf({ name: "Mickey Style Ears Hat", behavior: "Minnie bow on top" }), names: NAMES });
    const slip = (await (await make({ text: "mickey mouse ears" })).json()) as { name: string; recipe: { behavior: string } };
    expect(slip.name).toBe("My Creation");
    expect(slip.recipe.behavior).toBe("Made from your idea");
    // an English name that is a brand takes every language with it: English is the fallback for all of them
    model = modelSays({ recipe: recipeOf(), names: { ...NAMES, en: { w: "pokemon hat", g: "m" } } });
    expect(((await (await make({ text: "a hat" })).json()) as { names: unknown }).names).toEqual({});
  });

  it("gives the daemon long enough to build a part before calling the first look unavailable", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("../worker/forgeMake.ts", import.meta.url), "utf8");
    expect(src).toMatch(/MAKE_PREVIEW_TIMEOUT_MS = (\d[\d_]*)/);
    const ms = Number(/MAKE_PREVIEW_TIMEOUT_MS = (\d[\d_]*)/.exec(src)![1]!.replace(/_/g, ""));
    expect(ms).toBeGreaterThanOrEqual(60_000); // a monkey head builds in 37 CPU-seconds
  });

  it("reads a model that sends only the recipe, with no envelope", async () => {
    model = modelSays(recipeOf());
    const res = await make({ text: "a wizard hat" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { names: unknown }).names).toEqual({});
  });

  it("returns the recipe with a 422 when the daemon refuses it, so the client can ask for a repair", async () => {
    daemonPreview = () => json({ ok: false, error: "bad" }, 422);
    const res = await make({ text: "a wizard hat" });
    expect(res.status).toBe(422);
    const out = (await res.json()) as { status: string; recipe: { slot: string }; attempt: number };
    expect(out).toMatchObject({ status: "bad-recipe", attempt: 1 });
    expect(out.recipe.slot).toBe("crown");
  });

  describe("repair", () => {
    const failed = () =>
      json({ job_id: "fjob_0123456789ab", status: "digital_only", gate_report: { ok: false, blocking_failures: [{ id: "P1_no_supports", detail: "10.7 mm2 steeper than 45 deg" }] } });

    it("asks the daemon what failed and tells the model only the failure, then builds the corrected recipe", async () => {
      daemonJob = failed;
      const res = await make({ text: "a wizard hat", attempt: 2, repair: { job_id: "fjob_0123456789ab", recipe: recipeOf() } });
      expect(res.status).toBe(200);
      expect(((await res.json()) as { attempt: number; calls_left: number })).toMatchObject({ attempt: 2, calls_left: 2 });
      expect(seen.daemonGets).toEqual([`${DAEMON}/v1/jobs/fjob_0123456789ab`]);
      const prompt = seen.model[0]!.input;
      expect(prompt).toContain("Your previous recipe:");
      expect(prompt).toContain("P1_no_supports (measured 10.7 mm2 steeper than 45 deg)");
      expect(prompt).toContain("0.78 times its height step"); // the hint table's own words
    });

    it("repairs a recipe the daemon refused outright, with no job to ask about", async () => {
      const res = await make({ text: "a wizard hat", attempt: 2, repair: { bad_recipe: true, recipe: recipeOf() } });
      expect(res.status).toBe(200);
      expect(seen.daemonGets).toHaveLength(0);
      expect(seen.model[0]!.input).toContain("The recipe was rejected before any check");
    });

    it("refuses a repair of a part that already passed, or is still being checked, or is not a repair at all", async () => {
      const post = (body: object) => make({ text: "a wizard hat", ...body });
      expect((await post({ attempt: 2, repair: { job_id: "fjob_0123456789ab", recipe: recipeOf() } })).status).toBe(409); // print_ready
      resetForgeRateLimit();
      daemonJob = () => json({ job_id: "fjob_0123456789ab", status: "validating" });
      expect((await post({ attempt: 2, repair: { job_id: "fjob_0123456789ab", recipe: recipeOf() } })).status).toBe(409);
      resetForgeRateLimit();
      expect((await post({ attempt: 2, repair: { job_id: "../etc/passwd", recipe: recipeOf() } })).status).toBe(422);
      resetForgeRateLimit();
      expect((await post({ attempt: 1, repair: { job_id: "fjob_0123456789ab", recipe: recipeOf() } })).status).toBe(422); // a first call is not a repair
      resetForgeRateLimit();
      expect((await post({ attempt: 2, repair: { recipe: recipeOf() } })).status).toBe(422); // says nothing about what to repair
      resetForgeRateLimit();
      expect((await post({ attempt: 2, repair: { job_id: "fjob_0123456789ab", recipe: { slot: "crown" } } })).status).toBe(422); // not a recipe
      expect(seen.model).toHaveLength(0);
    });
  });

  it("shares the preview budget: the sixth call in a minute is told to rest, with when to come back", async () => {
    for (let i = 0; i < 5; i++) expect((await make({ text: "a wizard hat" })).status).toBe(200);
    const res = await make({ text: "a wizard hat" });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(seen.model).toHaveLength(5); // the refused call spent no model call
  });
});
