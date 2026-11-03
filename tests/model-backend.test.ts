/**
 * worker/modelBackend.ts: the one switch between Meta's hosted models, our own models and nothing (docs/decisions/0008-meta-models-and-under-18-users.md).
 * The properties that matter: a client can never choose, "self" never quietly becomes "hosted", a typo is off, and no new file can call Meta's API around the switch.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CAPABILITIES, DEFAULT_MODE, chatTextOf, describeBackends, parseSelfUrl, requestedMode, resolveBackend, type BackendEnv } from "../worker/modelBackend";

const HOSTED: BackendEnv = { MODEL_API_KEY: "meta-key" };
const SELF_TEXT: BackendEnv = { SELF_TEXT_URL: "https://glimmer.example.test/v1/", SELF_TEXT_MODEL: "muse-glimmer-30b", SELF_TEXT_KEY: "own-key" };

describe("the default", () => {
  it("is hosted for the Nov 4 build, so nothing changes until the switch is set (flip DEFAULT_MODE after the demo and change this test)", () => {
    expect(DEFAULT_MODE).toBe("hosted");
    for (const c of CAPABILITIES) expect(resolveBackend(HOSTED, c).mode).toBe("hosted");
  });

  it("hosted needs the Meta key: without it the capability is off, not configured", () => {
    for (const c of CAPABILITIES) expect(resolveBackend({}, c)).toMatchObject({ mode: "off", reason: "not_configured" });
    expect(resolveBackend({ META_MODEL_API_KEY: "older-name" }, "text").mode).toBe("hosted"); // the earlier variable name still works
  });

  it("hosted text carries the Meta base URL and the Spark model id; the others carry no model id", () => {
    expect(resolveBackend(HOSTED, "text")).toMatchObject({ baseUrl: "https://api.meta.ai/v1", key: "meta-key", model: "muse-spark-1.3", api: "responses" });
    expect(resolveBackend({ ...HOSTED, META_MODEL_API_URL: "https://proxy.example.test/v1/responses" }, "text").baseUrl).toBe("https://proxy.example.test/v1");
    expect(resolveBackend(HOSTED, "segment").model).toBeNull();
  });
});

describe("the master switch and the per-capability overrides", () => {
  it("MODEL_BACKEND=off turns every capability off, even with the Meta key and a self-hosted endpoint set", () => {
    const env = { ...HOSTED, ...SELF_TEXT, MODEL_BACKEND: "off" };
    for (const c of CAPABILITIES) expect(resolveBackend(env, c)).toMatchObject({ mode: "off", reason: "disabled", baseUrl: null, key: null });
  });

  it("MODEL_BACKEND=self with nothing configured is off everywhere and NEVER hosted, even when the Meta key is present (fail closed)", () => {
    const env = { ...HOSTED, MODEL_BACKEND: "self" };
    for (const c of CAPABILITIES) expect(resolveBackend(env, c)).toMatchObject({ mode: "off", reason: "not_configured", baseUrl: null, key: null });
  });

  it("a capability's own variable wins over the master: text on our model while the rest stay hosted, or off", () => {
    const env: BackendEnv = { ...HOSTED, ...SELF_TEXT, MODEL_BACKEND: "hosted", TEXT_BACKEND: "self" };
    expect(describeBackends(env)).toEqual({ text: "self", segment: "hosted", image: "hosted", transcribe: "hosted" });
    expect(describeBackends({ ...env, MODEL_BACKEND: "self", SEGMENT_BACKEND: "off" })).toEqual({ text: "self", segment: "off", image: "off", transcribe: "off" });
  });

  it("values are trimmed and case-insensitive; an empty capability variable falls back to the master", () => {
    expect(requestedMode({ MODEL_BACKEND: "  OFF " }, "text")).toEqual({ mode: "off", invalid: false });
    expect(requestedMode({ MODEL_BACKEND: "self", TEXT_BACKEND: "  " }, "text").mode).toBe("self");
  });

  it("a misspelt value is off and marked invalid, not hosted: 'selfhosted', 'true', '1' all fail closed", () => {
    for (const v of ["selfhosted", "true", "1", "meta", "hosted,self"]) {
      expect(requestedMode({ MODEL_BACKEND: v }, "text")).toEqual({ mode: "off", invalid: true });
      expect(resolveBackend({ ...HOSTED, MODEL_BACKEND: v }, "text")).toMatchObject({ mode: "off", reason: "invalid" });
    }
  });
});

describe("a self-hosted capability", () => {
  const self = (extra: BackendEnv = {}): BackendEnv => ({ MODEL_BACKEND: "self", ...SELF_TEXT, ...extra });

  it("text needs its URL and its served model name; its key is optional", () => {
    expect(resolveBackend(self(), "text")).toMatchObject({ mode: "self", baseUrl: "https://glimmer.example.test/v1", key: "own-key", model: "muse-glimmer-30b", api: "responses" });
    expect(resolveBackend(self({ SELF_TEXT_KEY: undefined }), "text")).toMatchObject({ mode: "self", key: null });
    expect(resolveBackend(self({ SELF_TEXT_MODEL: undefined }), "text")).toMatchObject({ mode: "off", reason: "not_configured" });
    expect(resolveBackend(self({ SELF_TEXT_URL: undefined }), "text")).toMatchObject({ mode: "off", reason: "not_configured" });
  });

  it("our own text model carries a reasoning strength for the system prompt: low by default, settable, and 'off' sends none", () => {
    expect(resolveBackend(self(), "text").reasoning).toBe("low");
    expect(resolveBackend(self({ SELF_TEXT_REASONING: " High " }), "text").reasoning).toBe("high");
    for (const v of ["off", "none", "extreme"]) expect(resolveBackend(self({ SELF_TEXT_REASONING: v }), "text").reasoning).toBeNull();
    expect(resolveBackend({ MODEL_API_KEY: "k" }, "text").reasoning).toBeNull(); // hosted keeps its own reasoning parameter
  });

  it("SELF_TEXT_API=chat selects /chat/completions; anything else is the responses shape", () => {
    expect(resolveBackend(self({ SELF_TEXT_API: "chat" }), "text").api).toBe("chat");
    expect(resolveBackend(self({ SELF_TEXT_API: "Chat " }), "text").api).toBe("chat");
    expect(resolveBackend(self({ SELF_TEXT_API: "nonsense" }), "text").api).toBe("responses");
  });

  it("segment, image and transcribe need only a URL", () => {
    const env: BackendEnv = { MODEL_BACKEND: "self", SELF_SEGMENT_URL: "https://sam.example.test", SELF_IMAGE_URL: "https://img.example.test/edit/", SELF_TRANSCRIBE_URL: "https://asr.example.test" };
    expect(resolveBackend(env, "segment")).toMatchObject({ mode: "self", baseUrl: "https://sam.example.test" });
    expect(resolveBackend(env, "image")).toMatchObject({ mode: "self", baseUrl: "https://img.example.test/edit" });
    expect(resolveBackend(env, "transcribe").mode).toBe("self");
    expect(resolveBackend(env, "text").mode).toBe("off");
  });

  it("endpoint URLs: https, or http on this machine only; no credentials, query or fragment; trailing slashes dropped; anything else is not configured", () => {
    expect(parseSelfUrl("https://a.example.test/v1///")).toBe("https://a.example.test/v1");
    expect(parseSelfUrl("http://127.0.0.1:8000/v1")).toBe("http://127.0.0.1:8000/v1");
    expect(parseSelfUrl("http://localhost:8000")).toBe("http://localhost:8000");
    for (const bad of ["http://a.example.test", "ftp://a.example.test", "https://user:pw@a.example.test", "https://a.example.test/?k=1", "https://a.example.test/#x", "not a url", "", undefined, 5]) {
      expect(parseSelfUrl(bad as never)).toBeNull();
    }
  });
});

describe("what leaks", () => {
  it("describeBackends gives modes only: no URL, key or model name", () => {
    const out = JSON.stringify(describeBackends({ ...HOSTED, ...SELF_TEXT, MODEL_BACKEND: "self" }));
    for (const secret of ["meta-key", "own-key", "glimmer.example.test", "muse-glimmer-30b", "api.meta.ai"]) expect(out).not.toContain(secret);
  });

  it("the choice comes only from Worker variables: no function in the module reads a Request", () => {
    const src = readFileSync(join(__dirname, "..", "worker", "modelBackend.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(src).not.toMatch(/\bRequest\b|\brequest\b|searchParams|readCappedJson|CF-Connecting-IP|x-model|x-backend/i); // it parses what the UPSTREAM answers, never what the caller sent
  });
});

describe("chatTextOf", () => {
  it("reads a string or a list of parts, and is empty for anything else", () => {
    expect(chatTextOf({ choices: [{ message: { content: "hello" } }] })).toBe("hello");
    expect(chatTextOf({ choices: [{ message: { content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] } }] })).toBe("ab");
    for (const bad of [null, "x", {}, { choices: [] }, { choices: [null] }, { choices: [{}] }, { choices: [{ message: { content: 5 } }] }]) expect(chatTextOf(bad)).toBe("");
  });
});

describe("no file calls Meta's API around the switch", () => {
  // The ratchet: files that still read the Meta key or URL directly because their owners have not moved them onto the switch yet. It is EMPTY now (Dan, 2026-11-03:
  // describe.ts, meta.ts, muse.ts and parent.ts were moved). A new Worker file that reads env.MODEL_API_KEY / env.META_MODEL_API_*, calls apiKey()/apiUrl() or names
  // api.meta.ai fails here until it goes through resolveBackend(). Offline scripts under scripts/ (adult-run, no child input) are outside this guard.
  const NOT_YET_ON_THE_SWITCH: string[] = [];
  const ALLOWED = new Set(["modelBackend.ts", ...NOT_YET_ON_THE_SWITCH]);
  const direct = /\benv\.(MODEL_API_KEY|META_MODEL_API_KEY|META_MODEL_API_URL)\b|api\.meta\.ai|\bapiKey\(|\bapiUrl\(/;
  const files = readdirSync(join(__dirname, "..", "worker")).filter((f) => f.endsWith(".ts"));

  it("only modelBackend.ts (and any listed file) touches the Meta key or URL directly", () => {
    const offenders = files.filter((f) => !ALLOWED.has(f) && direct.test(readFileSync(join(__dirname, "..", "worker", f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")));
    expect(offenders).toEqual([]);
  });

  it("text to part is on the switch (and must not drift back)", () => {
    expect(NOT_YET_ON_THE_SWITCH).not.toContain("forgeMake.ts");
    const make = readFileSync(join(__dirname, "..", "worker", "forgeMake.ts"), "utf8");
    expect(make).toContain('resolveBackend(env, "text")');
  });

  it("the list does not name a file that no longer needs it", () => {
    for (const f of NOT_YET_ON_THE_SWITCH) {
      expect(files).toContain(f);
      expect(direct.test(readFileSync(join(__dirname, "..", "worker", f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""))).toBe(true); // remove it from the list when it is migrated
    }
  });
});
