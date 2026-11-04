/**
 * scripts/tuning/lib/sampling.ts and dataset.ts: how a tuned model's training set is made, and the ways it must be impossible to make it wrongly. The two that matter most are
 * the source guard (never hosted Spark's outputs, never a tuned model's) and "safe by construction" (no record whose answer carries an unsafe word, a brand or a refused wish).
 */
import { describe, expect, it } from "vitest";
import { answerJson, buildDataset, buildManifest, cleanNames, MAX_EXAMPLE_TOKENS, recipeHash, sampleToRecord, toJsonl } from "../scripts/tuning/lib/dataset";
import { planSampling, requireOwnModel, runSampling, sampleId, SamplingRefused, type SampleRecord, type SampleSource } from "../scripts/tuning/lib/sampling";
import { stubBody } from "../scripts/tuning/lib/stub";
import { finalizeWishes, seedWishes, type Wish } from "../scripts/tuning/lib/wishgen";
import { TUNE_PROMPT_VERSION, TUNE_SYSTEM_LINE, buildTunePrompt } from "../shared/forgeTunePrompt";

const SELF: SampleSource = { backend: "self", model: "muse-glimmer-30B", promptStyle: "base", runId: "run-test", at: "2026-11-04T00:00:00Z" };
const NAMES = { en: { w: "star hat", g: "m" }, es: { w: "sombrero de estrella", g: "m" }, fr: { w: "chapeau étoilé", g: "m" }, de: { w: "Sternenhut", g: "m" }, it: { w: "cappello stellato", g: "m" }, pt: { w: "chapéu estrelado", g: "m" }, tr: { w: "yıldızlı şapka", g: "m" } };
const RECIPE = { v: 1, id: "star_hat", name: "Star Hat", stat: "Glow", behavior: "A hat with a star", slot: "crown", shape: { kind: "loft", slices: [{ z: 0, w: 23.4, d: 11.4, r: 4.6 }, { z: 10, w: 28, d: 14, r: 5 }, { z: 20, w: 14, d: 8, r: 3 }] }, features: [] };
const sample = (over: Partial<SampleRecord> = {}): SampleRecord => ({ id: "x-0", wish: "a sparkly seahorse hat", lang: "en", slot: "crown", split: "train", sampleIndex: 0, ok: true, printable: true, calls: 1, secs: 10, recipe: RECIPE, name: "Star Hat", names: NAMES, source: SELF, ...over });
const wish = (text: string, split: Wish["split"] = "train", slot?: Wish["slot"]): Wish => ({ text, lang: "en", split, source: "seed", ...(slot ? { slot } : {}) });

describe("the source guard: training data comes from our own model only", () => {
  it("refuses the hosted API, off, and anything that is not 'self', and says why (the Model API terms, 10.1 ix)", () => {
    for (const mode of ["hosted", "off", ""]) {
      expect(() => requireOwnModel({ mode, promptStyle: "base", stub: false })).toThrow(SamplingRefused);
    }
    expect(() => requireOwnModel({ mode: "hosted", promptStyle: "base", stub: false })).toThrow(/10\.1 ix/);
  });

  it("refuses the tuned prompt: a tuned model's outputs are not a source for the next tune", () => {
    expect(() => requireOwnModel({ mode: "self", promptStyle: "tuned", stub: false })).toThrow(/base model/);
  });

  it("lets our own model with the base prompt through, and a stub run (which makes untrainable records)", () => {
    expect(() => requireOwnModel({ mode: "self", promptStyle: "base", stub: false })).not.toThrow();
    expect(() => requireOwnModel({ mode: "hosted", promptStyle: "base", stub: true })).not.toThrow();
  });

  it("a record from the hosted API, or from a tuned prompt, is refused by the dataset builder even if it reached the file", () => {
    const hosted = { ...SELF, backend: "hosted" as unknown as "self" };
    expect(sampleToRecord(sample({ source: hosted }))).toEqual({ ok: false, reason: "wrong_source" });
    expect(sampleToRecord(sample({ source: { ...SELF, promptStyle: "tuned" } }))).toEqual({ ok: false, reason: "wrong_source" });
  });
});

describe("planning and running a sampling run", () => {
  const wishes = [wish("a one", "train"), wish("a two", "val"), wish("a three", "heldout"), wish("a four", "train")];

  it("never samples heldout wishes, makes perWish calls each, and cuts at the spending brake", () => {
    const p = planSampling(wishes, { perWish: 2, maxCalls: 100, splits: ["train", "val"], existing: [] });
    expect(p.todo.map((t) => t.wish.text)).toEqual(["a one", "a one", "a two", "a two", "a four", "a four"]);
    expect(p.todo.some((t) => t.wish.split === "heldout")).toBe(false);
    const capped = planSampling(wishes, { perWish: 2, maxCalls: 4, splits: ["train", "val"], existing: [] });
    expect(capped.todo).toHaveLength(4);
    expect(capped.cutByMaxCalls).toBe(2);
  });

  it("resumes: what is already in the file is skipped", () => {
    const existing = [sample({ id: sampleId("a one", 0), wish: "a one" })];
    const p = planSampling(wishes, { perWish: 2, maxCalls: 100, splits: ["train", "val"], existing });
    expect(p.alreadyDone).toBe(1);
    expect(p.todo).toHaveLength(5);
    expect(p.todo.filter((t) => t.wish.text === "a one")).toEqual([{ wish: wishes[0], index: 1 }]);
  });

  it("a call that throws becomes a failed record, not a crashed run, and every task gets a record with its source", async () => {
    const plan = planSampling(wishes, { perWish: 1, maxCalls: 100, splits: ["train", "val"], existing: [] });
    const got: SampleRecord[] = [];
    await runSampling(plan.todo, async (t) => { if (t.wish.text === "a two") throw new Error("boom"); return stubBody(t); }, { concurrency: 2, source: SELF, onRecord: (r) => got.push(r) });
    expect(got).toHaveLength(3);
    expect(got.find((r) => r.wish === "a two")).toMatchObject({ ok: false, reason: "error:boom" });
    expect(got.every((r) => r.source.model === "muse-glimmer-30B")).toBe(true);
    expect(new Set(got.map((r) => r.id)).size).toBe(3);
  });
});

describe("safe by construction: what a record may not contain", () => {
  it("keeps a clean, printable, complete sample, in the training format with the pinned short prompt", () => {
    const r = sampleToRecord(sample());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.record.messages.map((m) => m.role)).toEqual(["system", "user", "assistant"]);
    expect(r.record.messages[0]!.content).toBe(TUNE_SYSTEM_LINE);
    expect(r.record.messages[1]!.content).toBe(buildTunePrompt({ text: "a sparkly seahorse hat", slot: "crown" }));
    expect(r.record.meta.promptVersion).toBe(TUNE_PROMPT_VERSION);
    const answer = JSON.parse(r.record.messages[2]!.content) as { recipe: { slot: string }; names: Record<string, { w: string; sig?: string }> };
    expect(Object.keys(answer.names)).toEqual(["en", "es", "fr", "de", "it", "pt", "tr"]);
    expect(answer.recipe.slot).toBe("crown");
  });

  it("drops a signature if one slipped into the names: the model writes words and a gender, never a signature", () => {
    const withSig = Object.fromEntries(Object.entries(NAMES).map(([l, n]) => [l, { ...n, sig: "abc" }]));
    const names = cleanNames(withSig as never)!;
    expect(JSON.stringify(names)).not.toContain("sig");
  });

  it("rejects each kind of bad answer for its own reason", () => {
    const why = (s: SampleRecord) => { const r = sampleToRecord(s); return r.ok ? "kept" : r.reason; };
    expect(why(sample({ ok: false, recipe: undefined, reason: "unavailable" }))).toBe("failed");
    expect(why(sample({ printable: false }))).toBe("not_printable");
    expect(why(sample({ recipe: { v: 1, id: "x", name: "x", slot: "hand" } }))).toBe("bad_recipe");
    expect(why(sample({ recipe: { ...RECIPE, name: "My Creation" }, name: "My Creation" }))).toBe("generic_name");
    expect(why(sample({ names: { en: NAMES.en } as never }))).toBe("names_incomplete");
    expect(why(sample({ names: { ...NAMES, tr: { w: "bıçaklı şapka", g: "m" } } }))).toBe("unsafe_output");
    expect(why(sample({ names: { ...NAMES, de: { w: "Messer Hut", g: "m" } } }))).toBe("unsafe_output");
    expect(why(sample({ recipe: { ...RECIPE, behavior: "A hat made of drugs" } }))).toBe("unsafe_output");
    expect(why(sample({ names: { ...NAMES, en: { w: "Mickey hat", g: "m" } } }))).toBe("brand_output");
    expect(why(sample({ recipe: { ...RECIPE, name: "Pikachu Hat" } }))).toBe("brand_output");
    expect(why(sample({ split: "heldout" }))).toBe("heldout_sample");
  });

  it("rejects an answer too long to train on (the trainer's window is 1,024 tokens)", () => {
    const long = { ...RECIPE, shape: { kind: "loft", slices: Array.from({ length: 400 }, (_, i) => ({ z: i, w: 20, d: 10, r: 4 })) } };
    const r = sampleToRecord(sample({ recipe: long }));
    expect(r).toMatchObject({ ok: false });
    expect(MAX_EXAMPLE_TOKENS).toBeLessThanOrEqual(1024);
  });
});

describe("building the set", () => {
  const wishes = [wish("a sparkly seahorse hat", "train", "crown"), wish("a wobbly walrus head", "val", "head"), wish("a tiny turtle hat", "heldout"), wish("a pretty parrot head", "train", "head")];

  it("splits train and val by the wish's split, lists heldout wishes without answers, and counts rejections", () => {
    const samples = [
      sample({ wish: "a sparkly seahorse hat", id: "a-0" }),
      sample({ wish: "a wobbly walrus head", id: "b-0", split: "val", slot: "head", recipe: { ...RECIPE, slot: "head" } }),
      sample({ wish: "a pretty parrot head", id: "c-0", ok: false, recipe: undefined }),
      sample({ wish: "a tiny turtle hat", id: "d-0", split: "heldout" }),
    ];
    const b = buildDataset(samples, wishes);
    expect(b.train.map((r) => r.meta.wish)).toEqual(["a sparkly seahorse hat"]);
    expect(b.val.map((r) => r.meta.wish)).toEqual(["a wobbly walrus head"]);
    expect(b.heldout.map((h) => h.wish)).toEqual(["a tiny turtle hat"]);
    expect(b.heldout[0]!.messages.map((m) => m.role)).toEqual(["system", "user"]); // the prompt a tuned model is given, no answer
    expect(b.heldout[0]!.messages[1]!.content).toContain("a tiny turtle hat");
    expect(b.rejected).toMatchObject({ failed: 1, heldout_sample: 1 });
    expect(b.leaks).toEqual([]);
  });

  it("keeps at most perWishMax distinct parts per wish, and counts two samples that differ only in their words as one part", () => {
    const a = sample({ id: "a-0" });
    const sameShape = sample({ id: "a-1", sampleIndex: 1, recipe: { ...RECIPE, id: "other", name: "Other Name" } });
    const other = sample({ id: "a-2", sampleIndex: 2, recipe: { ...RECIPE, shape: { kind: "loft", slices: [{ z: 0, w: 24, d: 12, r: 5 }, { z: 12, w: 26, d: 13, r: 5 }, { z: 22, w: 12, d: 8, r: 3 }] } } });
    const b = buildDataset([a, sameShape, other], wishes, { perWishMax: 2 });
    expect(b.train).toHaveLength(2);
    expect(b.rejected.duplicate_recipe).toBe(1);
    expect(recipeHash(a.recipe)).toBe(recipeHash(sameShape.recipe));
    expect(recipeHash(a.recipe)).not.toBe(recipeHash(other.recipe));
  });

  it("drops a sample whose wish is evaluation data, even if the wish file let it through", () => {
    const b = buildDataset([sample({ wish: "a wizard hat" })], [wish("a wizard hat")]);
    expect(b.train).toHaveLength(0);
    expect(b.rejected.eval_like_wish).toBe(1);
  });

  it("reports a leak if a heldout wish also has an answer in the training files", () => {
    const wishesWithLeak = [wish("a tiny turtle hat", "heldout")];
    const b = buildDataset([sample({ wish: "a tiny turtle hat", split: "train" })], wishesWithLeak);
    expect(b.leaks).toEqual(["a tiny turtle hat"]);
  });
});

describe("the offline demonstration, end to end with canned recipes", () => {
  const { wishes } = finalizeWishes(seedWishes(200));
  const plan = planSampling(wishes, { perWish: 2, maxCalls: 1000, splits: ["train", "val"], existing: [] });

  it("a stub set is built only with --allow-stub, and its manifest says stub, which the trainer refuses", async () => {
    const stubSource: SampleSource = { backend: "stub", model: "none", promptStyle: "base", runId: "run-stub", at: "2026-11-04T00:00:00Z" };
    const samples: SampleRecord[] = [];
    await runSampling(plan.todo.slice(0, 40), async (t) => stubBody(t), { concurrency: 4, source: stubSource, onRecord: (r) => samples.push(r) });
    expect(buildDataset(samples, wishes).train).toHaveLength(0); // refused without allowStub
    const b = buildDataset(samples, wishes, { allowStub: true });
    expect(b.train.length).toBeGreaterThan(10);
    const files = { "train.jsonl": toJsonl(b.train), "val.jsonl": toJsonl(b.val), "heldout.jsonl": toJsonl(b.heldout) };
    const m = buildManifest(b, files, new Date("2026-11-04T00:00:00Z"));
    expect(m.source).toBe("stub");
    expect(m.leaks).toEqual([]);
    expect(m.files["train.jsonl"]!.records).toBe(b.train.length);
    expect(m.files["train.jsonl"]!.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a set of our own model's records has a manifest that says 'self', names the model and the runs, and carries the licence statements", () => {
    const b = buildDataset([sample()], wishes);
    const m = buildManifest(b, { "train.jsonl": toJsonl(b.train), "val.jsonl": "", "heldout.jsonl": "" });
    expect(m.source).toBe("self");
    expect(m.models).toEqual([{ backend: "self", model: "muse-glimmer-30B", runIds: ["run-test"] }]);
    expect(m.licence.join(" ")).toContain("10.1 ix");
    expect(m.licence.join(" ")).toContain("Apache 2.0");
    expect(m.tunePromptVersion).toBe(TUNE_PROMPT_VERSION);
  });

  it("the answer is exactly the JSON the product reads: a recipe and seven names", () => {
    const j = JSON.parse(answerJson(RECIPE, cleanNames(NAMES as never)!)) as { recipe: unknown; names: Record<string, unknown> };
    expect(Object.keys(j)).toEqual(["recipe", "names"]);
    expect(Object.keys(j.names)).toHaveLength(7);
  });
});
