/**
 * scripts/modal/glimmer_train.py cannot be run here (it needs a GPU and Unsloth), so what can be verified is verified two ways: its text is checked for the settings and the things it
 * must never do, and its dataset guards, which are plain Python, are EXECUTED against datasets made by the real builder (a stub set, a set with leaks, a tampered file, a prompt-version
 * mismatch, and a good set). The guard tests need the `modal` Python package (the script imports it); without it they are skipped, and say so.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDataset, buildManifest, toJsonl } from "../scripts/tuning/lib/dataset";
import type { SampleRecord } from "../scripts/tuning/lib/sampling";
import type { Wish } from "../scripts/tuning/lib/wishgen";
import { TUNE_PROMPT_VERSION } from "../shared/forgeTunePrompt";

const SCRIPT = join(__dirname, "..", "scripts", "modal", "glimmer_train.py");
const src = readFileSync(SCRIPT, "utf8");
const code = src.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
const hasModal = spawnSync("python3", ["-c", "import modal"]).status === 0;

describe("the training script's text", () => {
  it("is marked written-and-never-run, credits Unsloth's notebook and its LGPL licence, and says it is not a copy", () => {
    expect(src).toContain("WRITTEN, NEVER RUN");
    expect(src).toContain("LGPL-3.0");
    expect(src).toContain("NOT a copy");
  });

  it("uses the settings Unsloth documents for Glimmer: transformers pinned to the release that knows the architecture, nll loss, 4-bit base, vision layers frozen, LoRA r 16 alpha 16", () => {
    expect(src).toContain('TRANSFORMERS_PIN = "5.15.0"');
    expect(code).toContain('loss_type="nll"');
    expect(src).toContain('BASE_MODEL = "unsloth/Muse-Glimmer-30B-unsloth-bnb-4bit"');
    expect(code).toContain("finetune_vision_layers=False");
    expect(code).toContain("finetune_language_layers=True");
    expect(src).toMatch(/"r": 16,/);
    expect(src).toMatch(/"lora_alpha": 16,/);
    expect(code).toContain('optim="adamw_8bit"');
    expect(code).toContain('use_gradient_checkpointing="unsloth"');
    expect(code).toContain("train_on_responses_only(");
  });

  it("masks with Glimmer's own markers: keep trains only the answer on the user channel, skip also trains the channel choice; keep is the default", () => {
    expect(src).toContain('INSTRUCTION_PART = "<|start|>user<|message|>"');
    expect(src).toContain('"keep": "<|start|>assistant to=user<|message|>"');
    expect(src).toContain('"skip": "<|start|>assistant"');
    expect(src).toMatch(/DEFAULTS = \{\s+"variant": "keep"/);
    expect(code).toMatch(/def train\(dataset: str = "dataset", run: str = "pilot-1", variant: str = "keep"/);
  });

  it("never calls Unsloth's GGUF export (its own notebook says it fails for Glimmer), never uploads anywhere, and never reaches the hosted API", () => {
    expect(code).not.toMatch(/save_pretrained_gguf|push_to_hub|requests\.|api\.meta\.ai|MODEL_API_KEY/);
    expect(src).toContain("convert_hf_to_gguf.py");
    expect(src).toContain("untested");
  });

  it("checks the dataset before it loads a model, and resumes from the newest checkpoint if a preempted run restarts", () => {
    const train = code.slice(code.indexOf("def train_remote("), code.indexOf("def generate_remote("));
    expect(train.indexOf("check_dataset(root)")).toBeGreaterThan(-1);
    expect(train.indexOf("check_dataset(root)")).toBeLessThan(train.indexOf("FastModel.from_pretrained"));
    expect(train).toContain("resume_from_checkpoint=resume");
    expect(code).toContain("modal.Retries(");
  });

  it("expects the same prompt version the prompt module declares", () => {
    expect(src).toContain(`EXPECT_PROMPT_VERSION = "${TUNE_PROMPT_VERSION}"`);
  });

  it("its imports of the GPU libraries are all inside functions, so deploying from a laptop never needs them", () => {
    const top = src.slice(0, src.indexOf("def sha256_of"));
    expect(top).not.toMatch(/^(import|from) (torch|transformers|unsloth|trl|datasets)\b/m);
  });
});

const SELF = { backend: "self" as const, model: "muse-glimmer-30B", promptStyle: "base" as const, runId: "run-test", at: "2026-11-04T00:00:00Z" };
const NAMES = { en: { w: "star hat", g: "m" }, es: { w: "sombrero de estrella", g: "m" }, fr: { w: "chapeau étoilé", g: "m" }, de: { w: "Sternenhut", g: "m" }, it: { w: "cappello stellato", g: "m" }, pt: { w: "chapéu estrelado", g: "m" }, tr: { w: "yıldızlı şapka", g: "m" } };
const RECIPE = { v: 1, id: "star_hat", name: "Star Hat", stat: "Glow", behavior: "A hat with a star", slot: "crown", shape: { kind: "loft", slices: [{ z: 0, w: 23.4, d: 11.4, r: 4.6 }, { z: 10, w: 28, d: 14, r: 5 }, { z: 20, w: 14, d: 8, r: 3 }] }, features: [] };
const one = (source: SampleRecord["source"] = SELF): SampleRecord => ({ id: "a-0", wish: "a sparkly seahorse hat", lang: "en", slot: "crown", split: "train", sampleIndex: 0, ok: true, printable: true, calls: 1, secs: 10, recipe: RECIPE, name: "Star Hat", names: NAMES, source });
const wishes: Wish[] = [{ text: "a sparkly seahorse hat", lang: "en", slot: "crown", split: "train", source: "seed" }, { text: "a tiny turtle hat", lang: "en", split: "heldout", source: "seed" }];

function writeSet(over: { stub?: boolean; promptVersion?: string; leak?: boolean } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "tune-ds-"));
  const built = buildDataset([one(over.stub ? { ...SELF, backend: "stub", model: "none" } : SELF)], wishes, { allowStub: over.stub });
  const files = { "train.jsonl": toJsonl(built.train), "val.jsonl": toJsonl(built.val), "heldout.jsonl": toJsonl(built.heldout) };
  for (const [n, c] of Object.entries(files)) writeFileSync(join(dir, n), c);
  const manifest = buildManifest(built, files);
  if (over.promptVersion) manifest.tunePromptVersion = over.promptVersion;
  if (over.leak) manifest.leaks = ["a leaked wish"];
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
  return dir;
}

const py = (fn: string, arg: string) =>
  spawnSync("python3", ["-c", `import importlib.util,sys\nspec=importlib.util.spec_from_file_location("gt",${JSON.stringify(SCRIPT)})\nm=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\ntry:\n    r=m.${fn}(sys.argv[1]);print("OK",r if not isinstance(r,dict) else "")\nexcept SystemExit as e:\n    print("REFUSED:",e.args[0] if e.args else "")`, arg], { encoding: "utf8" }).stdout.trim();

describe.skipIf(!hasModal)("the dataset guards, executed (they are plain Python)", () => {
  it("accepts a dataset of our own model's answers whose files match the manifest", () => {
    const dir = writeSet();
    try { expect(py("check_dataset", dir)).toMatch(/^OK/); } finally { rmSync(dir, { recursive: true }); }
  });

  it("refuses a stub dataset: canned recipes are not training data", () => {
    const dir = writeSet({ stub: true });
    try { expect(py("check_dataset", dir)).toMatch(/REFUSED: .*source='stub'/); } finally { rmSync(dir, { recursive: true }); }
  });

  it("refuses a manifest that lists leaks", () => {
    const dir = writeSet({ leak: true });
    try { expect(py("check_dataset", dir)).toMatch(/REFUSED: .*leaked/); } finally { rmSync(dir, { recursive: true }); }
  });

  it("refuses a dataset built with another prompt version: training and serving must match", () => {
    const dir = writeSet({ promptVersion: "t0" });
    try { expect(py("check_dataset", dir)).toMatch(/REFUSED: .*prompt version/); } finally { rmSync(dir, { recursive: true }); }
  });

  it("refuses a file that changed after the manifest was written, and a file that is missing", () => {
    const dir = writeSet();
    try {
      writeFileSync(join(dir, "train.jsonl"), readFileSync(join(dir, "train.jsonl"), "utf8") + "\n");
      expect(py("check_dataset", dir)).toMatch(/REFUSED: .*does not match the hash/);
      rmSync(join(dir, "val.jsonl"));
      expect(py("check_dataset", dir)).toMatch(/REFUSED: .*is not there|does not match/);
    } finally { rmSync(dir, { recursive: true }); }
  });

  it("refuses a folder with no manifest", () => {
    const dir = mkdtempSync(join(tmpdir(), "tune-empty-"));
    try { mkdirSync(join(dir, "x")); expect(py("check_dataset", dir)).toMatch(/REFUSED: .*manifest.json is missing/); } finally { rmSync(dir, { recursive: true }); }
  });

  it("reads Glimmer's answer out of a raw generation: the user channel, and whether it thought first", () => {
    const raw = "<|start|>assistant to=self<|message|>let me think<|eom|><|start|>assistant to=user<|message|>{\"recipe\":1}<|eot|>";
    const out = spawnSync("python3", ["-c", `import importlib.util,sys,json\nspec=importlib.util.spec_from_file_location("gt",${JSON.stringify(SCRIPT)})\nm=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\nprint(json.dumps(m.split_answer(sys.argv[1])))`, raw], { encoding: "utf8" }).stdout.trim();
    expect(JSON.parse(out)).toEqual(['{"recipe":1}', true]);
    const direct = spawnSync("python3", ["-c", `import importlib.util,sys,json\nspec=importlib.util.spec_from_file_location("gt",${JSON.stringify(SCRIPT)})\nm=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\nprint(json.dumps(m.split_answer(sys.argv[1])))`, "<|start|>assistant to=user<|message|>{\"a\":2}<|eot|>"], { encoding: "utf8" }).stdout.trim();
    expect(JSON.parse(direct)).toEqual(['{"a":2}', false]);
  });
});
