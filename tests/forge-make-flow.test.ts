/**
 * shared/forgeMakeFlow.ts: the client loop for text to part, driven through the real Worker routes (make, job, artifact) with the model and the
 * optimizer daemon stubbed. Time is faked (the sleeps are recorded, and a rest resets the Worker's limiter the way a minute passing would).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAKE_MAX_CALLS } from "../shared/forgeMakePrompt";
import { WARM_ROUTE, makeFromText, voiceUrl, warmMaker, type MakeArgs, type MakeProgress } from "../shared/forgeMakeFlow";
import type { ForgeMakeEnv } from "../worker/forgeMake";
import { resetForgeRateLimit } from "../worker/forgeOptimizer";
import { verifySpeech } from "../worker/forgeNames";
import worker from "../worker/index";
import { parseVoiceKey } from "../worker/voice";
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

const SLICES = [
  { z: 0, w: 23.4, d: 11.4, r: 4.6 },
  { z: 10, w: 28, d: 14, r: 5 },
  { z: 20, w: 14, d: 8, r: 3 },
];
const NAMES = { en: { w: "wizard hat", g: "m" }, es: { w: "sombrero de mago", g: "m" } };
const recipeOf = (over: object = {}) => ({ v: 1, id: "wizard_hat", name: "Starlight Wizard Hat", stat: "Glow", behavior: "Tall hat that clicks on", slot: "crown", shape: { kind: "loft", slices: SLICES }, ...over });
const json = (body: unknown, status = 200, h: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...h } });

describe("makeFromText", () => {
  let env: ForgeMakeEnv;
  let proof: string;
  let proofIssued: number;
  let calls: { model: string[]; previews: number; jobGets: number };
  /** What the stubs answer next; a test sets what it needs. */
  let modelAnswers: (n: number) => Response;
  let previewAnswer: (n: number) => Response;
  let jobAnswer: (jobId: string, poll: number) => Response;
  let progress: MakeProgress[];
  let slept: number[];
  let renewals: number;
  let polls: Record<string, number>;

  const gate = { headers: () => ({ "x-device-id": DEVICE, "x-parent-proof": proof }) };
  const mintProof = async (): Promise<string> => {
    const call = (b: object) => worker.fetch(new Request("http://local/api/parent/gate", { method: "POST", headers: { "content-type": "application/json", "x-device-id": DEVICE }, body: JSON.stringify(b) }), env as never);
    const ch = (await (await call({ action: "challenge" })).json()) as { a: number; b: number; challengeToken: string };
    return ((await (await call({ action: "verify", challengeToken: ch.challengeToken, answer: ch.a * ch.b })).json()) as { proofToken: string }).proofToken;
  };

  const args = (over: Partial<MakeArgs> = {}): MakeArgs => ({
    text: "a wizard hat",
    gate,
    fetch: (url, init) => worker.fetch(new Request(`http://local${url}`, init), env as never),
    onProgress: (e) => progress.push(e),
    sleep: async (ms) => {
      slept.push(ms);
      resetForgeRateLimit(); // a rest is a minute going by
    },
    pollSleep: async () => undefined,
    ...over,
  });

  beforeEach(async () => {
    resetForgeRateLimit();
    env = { DB: fakeDb(), PARENT_GATE_SECRET: "gate-secret-for-tests", FORGE_OPTIMIZER_URL: DAEMON, MODEL_API_KEY: "test-key", VOICE_SIGNING_KEY: "voice-signing-key-for-the-tests-0123456789" };
    proof = await mintProof();
    calls = { model: [], previews: 0, jobGets: 0 };
    progress = [];
    slept = [];
    renewals = 0;
    polls = {};
    modelAnswers = () => json({ output_text: JSON.stringify({ recipe: recipeOf(), names: NAMES }) });
    previewAnswer = (n) => json({ ok: true, status: "preview_ready", part_id: "custom_x", job_id: `fjob_${String(n).padStart(12, "0")}`, draft_artifact: "x.draft.glb", glb_size: 1, orig_tris: 1, web_verts: 1, web_tris: 1, finish_class: "show_curved", elapsed_ms: 1, glb_base64: `GLB${n}` });
    jobAnswer = (id) => json({ job_id: id, status: "print_ready", stl_artifact: "custom_x.0123456789ab.stl", gate_report: { ok: true, design_status: "verified" } });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/responses")) {
        calls.model.push((JSON.parse(String(init?.body)) as { input: string }).input);
        return modelAnswers(calls.model.length);
      }
      if (url.endsWith("/v1/fast-preview")) return previewAnswer(++calls.previews);
      if (url.startsWith(`${DAEMON}/v1/jobs/`)) {
        calls.jobGets++;
        const id = url.slice(`${DAEMON}/v1/jobs/`.length);
        polls[id] = (polls[id] ?? 0) + 1;
        return jobAnswer(id, polls[id]!);
      }
      throw new Error(`unexpected fetch ${url}`);
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    resetForgeRateLimit();
  });

  const failedJob = (id: string) => json({ job_id: id, status: "digital_only", gate_report: { ok: false, blocking_failures: [{ id: "P1_no_supports", detail: "10.7 mm2 steeper than 45 deg" }] } });

  it("makes a part from words: one model call, the first look at once, the checks, and a printable part with its names", async () => {
    jobAnswer = (id, poll) => (poll < 3 ? json({ job_id: id, status: poll === 1 ? "queued" : "validating" }) : json({ job_id: id, status: "print_ready", stl_artifact: "custom_x.0123456789ab.stl" }));
    const r = await makeFromText(args());
    expect(r).toMatchObject({ ok: true, printable: true, calls: 1, name: "Starlight Wizard Hat", stlArtifact: "custom_x.0123456789ab.stl", glbBase64: "GLB1", gates: [] });
    if (!r.ok) throw new Error("not ok");
    expect(Object.keys(r.names).sort()).toEqual(["en", "es"]);
    expect(r.names.en!.sig).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(progress.map((p) => p.stage)).toEqual(["proposing", "preview", "checking"]); // the first look came before the checks ended
    expect(progress[1]).toMatchObject({ stage: "preview", name: "Starlight Wizard Hat", glbBase64: "GLB1" });
    expect(calls.model).toHaveLength(1);
    expect(calls.jobGets).toBe(3);
  });

  it("carries the slot on the first look, so the screen can put it on Kip", async () => {
    await makeFromText(args());
    expect(progress.find((p) => p.stage === "preview")).toMatchObject({ slot: "crown" });
    progress = [];
    resetForgeRateLimit();
    modelAnswers = () => json({ output_text: JSON.stringify({ recipe: recipeOf({ slot: "head" }), names: NAMES }) });
    await makeFromText(args({ slot: "head" }));
    expect(progress.find((p) => p.stage === "preview")).toMatchObject({ slot: "head" });
  });

  it("builds the address /api/voice speaks, which the Worker answers only for exactly the name it signed", async () => {
    const r = await makeFromText(args());
    if (!r.ok) throw new Error("not ok");
    const es = r.names.es!;
    const url = voiceUrl("es", es);
    expect(url).toMatch(/^\/api\/voice\?lang=es&w=sombrero\+de\+mago&g=m&sig=[A-Za-z0-9_-]{43}$/);
    const key = parseVoiceKey(new URL(`http://local${url}`));
    expect(key).toMatchObject({ lang: "es", name: { w: "sombrero de mago", g: "m" }, sig: es.sig });
    if (!key || !("name" in key)) throw new Error("not a signed name");
    expect(await verifySpeech(env, "es", key.name, key.sig)).toBe(true);
    // the same signature for a different word, a different language or a different gender is refused
    expect(await verifySpeech(env, "es", { ...key.name, w: "sombrero" }, key.sig)).toBe(false);
    expect(await verifySpeech(env, "fr", key.name, key.sig)).toBe(false);
    expect(await verifySpeech(env, "es", { ...key.name, g: "f" }, key.sig)).toBe(false);
    // a colour word is optional and not signed
    expect(voiceUrl("es", es, "red")).toContain("&c=red");
    expect(voiceUrl("en", { w: "scissors", g: "m", pl: true, sig: es.sig })).toContain("&pl=1");
  });

  it("repairs a part whose checks failed, telling the model only the failure", async () => {
    jobAnswer = (id) => (id.endsWith("1") ? failedJob(id) : json({ job_id: id, status: "print_ready", stl_artifact: "custom_x.0123456789ab.stl" }));
    // a second call must differ from the first, or it is "no progress": the repaired recipe is a narrower hat
    modelAnswers = (n) => json({ output_text: JSON.stringify({ recipe: recipeOf(n === 1 ? {} : { shape: { kind: "loft", slices: SLICES.map((s) => ({ ...s, w: s.w * 0.9 })) } }), names: NAMES }) });
    const r = await makeFromText(args());
    expect(r).toMatchObject({ ok: true, printable: true, calls: 2 });
    expect(progress.map((p) => p.stage)).toEqual(["proposing", "preview", "checking", "fixing", "preview", "checking"]);
    expect(calls.model[1]).toContain("P1_no_supports (measured 10.7 mm2 steeper than 45 deg)");
    expect(calls.model[1]).toContain("Your previous recipe:");
  });

  it("repairs a recipe the daemon refused before any check", async () => {
    previewAnswer = (n) => (n === 1 ? json({ ok: false }, 422) : json({ ok: true, job_id: `fjob_${String(n).padStart(12, "0")}`, glb_base64: "GLB" }));
    const r = await makeFromText(args());
    expect(r).toMatchObject({ ok: true, printable: true, calls: 2 });
    expect(progress.map((p) => p.stage)).toEqual(["proposing", "fixing", "preview", "checking"]);
    expect(calls.model[1]).toContain("The recipe was rejected before any check");
  });

  it("waits out a refused call for as long as the Worker says, and says so", async () => {
    for (let i = 0; i < 3; i++) await worker.fetch(new Request("http://local/api/forge/make", { method: "POST", headers: { "content-type": "application/json", ...gate.headers() }, body: JSON.stringify({ text: "x" }) }), env as never);
    calls.model.length = 0; // those three spent the minute's budget
    const r = await makeFromText(args());
    expect(r).toMatchObject({ ok: true, printable: true });
    const waiting = progress.find((p) => p.stage === "waiting");
    expect(waiting).toMatchObject({ stage: "waiting", call: 1 });
    expect(slept).toHaveLength(1);
    expect(slept[0]).toBe((waiting as { seconds: number }).seconds * 1000);
    expect((waiting as { seconds: number }).seconds).toBeGreaterThan(0);
    expect(calls.model).toHaveLength(1); // the refused call spent no model call
  });

  it("makes a part with no grown-up proof at all (the default)", async () => {
    proof = "";
    const r = await makeFromText(args());
    expect(r).toMatchObject({ ok: true, printable: true, calls: 1 });
    expect(progress.some((p) => p.stage === "asking_again")).toBe(false);
  });

  it("asks the grown-up again when the check runs out mid-wish, and carries on (when the proof is required)", async () => {
    env = { ...env, FORGE_MAKE_REQUIRES_PROOF: "1" };
    proof = "expired";
    const r = await makeFromText(args({ renewGate: async () => { renewals++; proof = await mintProof(); return true; } }));
    expect(r).toMatchObject({ ok: true, printable: true });
    expect(renewals).toBe(1);
    expect(progress.some((p) => p.stage === "asking_again")).toBe(true);
  });

  it("ends calmly, with no model call, when the proof is required, has run out and nobody renews it", async () => {
    env = { ...env, FORGE_MAKE_REQUIRES_PROOF: "1" };
    proof = "expired";
    const r = await makeFromText(args());
    expect(r).toMatchObject({ ok: false, reason: "gate_required" });
    expect(calls.model).toHaveLength(0);
  });

  it("ends calmly on words that are not allowed, on a brand and on no model, without a second call", async () => {
    const refused = await makeFromText(args({ text: "a scary knife" }));
    expect(refused).toMatchObject({ ok: false, reason: "not_allowed", calls: 1 });
    if (!refused.ok) expect(refused.message).toMatch(/something else/); // every failure carries a sentence a child can read
    resetForgeRateLimit();
    expect(await makeFromText(args({ text: "a lego car" }))).toMatchObject({ ok: false, reason: "brand_rejected", calls: 1 });
    resetForgeRateLimit();
    expect(await makeFromText(args({ text: "   " }))).toMatchObject({ ok: false, reason: "invalid" });
    resetForgeRateLimit();
    env = { ...env, MODEL_API_KEY: undefined };
    expect(await makeFromText(args())).toMatchObject({ ok: false, reason: "disabled" });
    expect(calls.model).toHaveLength(0);
  });

  it("does not burn more calls on a model that is down", async () => {
    modelAnswers = () => new Response("boom", { status: 500 });
    const r = await makeFromText(args());
    expect(r).toMatchObject({ ok: false, reason: "unavailable", calls: 1 });
    expect(calls.model).toHaveLength(1);
  });

  it("asks the same wish again when the model sends no usable recipe, within the call budget", async () => {
    modelAnswers = (n) => (n === 1 ? json({ output_text: "Sure! A hat." }) : json({ output_text: JSON.stringify({ recipe: recipeOf(), names: NAMES }) }));
    const r = await makeFromText(args());
    expect(r).toMatchObject({ ok: true, printable: true, calls: 2 });
    expect(calls.model[1]).not.toContain("Your previous recipe"); // there was nothing to repair
  });

  it(`stops after ${MAKE_MAX_CALLS} calls and still ends usefully: the best first look, marked fine on screen`, async () => {
    jobAnswer = (id) => failedJob(id);
    // each call a different recipe, so it is not "no progress"
    modelAnswers = (n) => json({ output_text: JSON.stringify({ recipe: recipeOf({ shape: { kind: "loft", slices: SLICES.map((s) => ({ ...s, w: s.w - n })) } }), names: NAMES }) });
    const r = await makeFromText(args());
    expect(r).toMatchObject({ ok: true, printable: false, calls: MAKE_MAX_CALLS, stlArtifact: null, gates: ["P1_no_supports"], glbBase64: `GLB${MAKE_MAX_CALLS}` });
    expect(calls.model).toHaveLength(MAKE_MAX_CALLS); // never a fifth
  });

  it("stops early when the same recipe fails the same check twice (no progress)", async () => {
    jobAnswer = (id) => failedJob(id);
    const r = await makeFromText(args()); // the stub model answers with the same recipe every time
    expect(r).toMatchObject({ ok: true, printable: false, calls: 2 });
    expect(calls.model).toHaveLength(2);
  });

  it("gives up on a job that never finishes, keeping the first look", async () => {
    jobAnswer = (id) => json({ job_id: id, status: "validating" });
    let t = 0;
    const r = await makeFromText(args({ jobTimeoutMs: 10_000, now: () => (t += 4000) }));
    expect(r).toMatchObject({ ok: true, printable: false, glbBase64: "GLB1" });
  });
});

describe("warmMaker: tell the maker a child opened the panel", () => {
  const gate = { headers: () => ({ "x-device-id": "12345678-1234-1234-1234-123456789abc" }) };

  it("posts once to the warm route with the device id and an empty body: no wish, no words", () => {
    const f = vi.fn(async () => new Response("{}", { status: 202 }));
    warmMaker({ gate, fetch: f });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(WARM_ROUTE);
    expect(init.method).toBe("POST");
    expect(init.body).toBe("{}");
    expect((init.headers as Record<string, string>)["x-device-id"]).toBe("12345678-1234-1234-1234-123456789abc");
  });

  it("never throws and never waits: a rejected fetch, a fetch that throws at once, a refusal and a fetch that never answers are all ignored", async () => {
    expect(() => warmMaker({ gate, fetch: async () => { throw new Error("offline"); } })).not.toThrow();
    expect(() => warmMaker({ gate, fetch: () => { throw new Error("sync"); } })).not.toThrow();
    expect(() => warmMaker({ gate, fetch: async () => new Response("{}", { status: 429 }) })).not.toThrow();
    expect(() => warmMaker({ gate, fetch: () => new Promise(() => undefined) })).not.toThrow();
    await new Promise((r) => setTimeout(r, 10)); // a rejection nobody handled would fail the run here
  });
});

