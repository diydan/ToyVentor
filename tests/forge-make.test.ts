/**
 * POST /api/forge/make (worker/forgeMake.ts): a child's words to a printable part. The model and the optimizer daemon are stubs here, so every
 * branch is cheap to reach; tests/forge-worker-daemon.test.ts runs the real daemon behind the Worker, and the live check with the real model is
 * recorded in docs/specs/forge-ai-spec.md.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleForgeMake, type ForgeMakeEnv } from "../worker/forgeMake";
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
    seen = { model: [], daemonPosts: [], daemonGets: [] };
    model = modelSays({ recipe: recipeOf(), names: NAMES });
    daemonPreview = () => json({ ok: true, status: "preview_ready", part_id: "custom_wizard_hat", job_id: "fjob_0123456789ab", draft_artifact: "custom_wizard_hat.x.draft.glb", glb_size: 10, orig_tris: 5, web_verts: 5, web_tris: 5, finish_class: "show_curved", elapsed_ms: 40, glb_base64: "Z2xi" });
    daemonJob = () => json({ job_id: "fjob_0123456789ab", status: "print_ready", gate_report: { ok: true } });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/responses")) {
        seen.model.push(JSON.parse(String(init?.body)) as { input: string });
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
      [{ text: "a hat", slot: "hand" }, "invalid"],
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

  it("drops a name that is wrong or unsafe and keeps the rest, and says nothing when no signing key is set", async () => {
    model = modelSays({ recipe: recipeOf(), names: { ...NAMES, es: { w: "sombrero", g: "n" }, fr: { w: "a scary knife", g: "m" }, de: { w: "Zauber123", g: "m" } } });
    const out = (await (await make({ text: "a wizard hat" })).json()) as { names: Record<string, unknown> };
    expect(Object.keys(out.names).sort()).toEqual(["en", "it", "pt", "tr"]); // es: no neuter in Spanish, fr: unsafe word, de: digits
    resetForgeRateLimit();
    const unsigned = (await (await make({ text: "a wizard hat" }, headers, { ...env, VOICE_SIGNING_KEY: undefined })).json()) as { names: unknown; recipe: unknown };
    expect(unsigned.names).toEqual({}); // nothing can be spoken without the key, the part still comes back
    expect(unsigned.recipe).toBeTruthy();
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

  it("shares the preview budget: the fourth call in a minute is told to rest, with when to come back", async () => {
    for (let i = 0; i < 3; i++) expect((await make({ text: "a wizard hat" })).status).toBe(200);
    const res = await make({ text: "a wizard hat" });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(seen.model).toHaveLength(3); // the refused call spent no model call
  });
});
