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
  it("says it has only run as a smoke, credits Unsloth's notebook and its LGPL licence, and says it is not a copy", () => {
    expect(src).toContain("RUN AS A SMOKE ONLY");
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

  it("checks the dataset before it loads a model, resumes from the newest checkpoint when run again, and does not retry on its own", () => {
    const train = code.slice(code.indexOf("def train_remote("), code.indexOf("def generate_remote("));
    expect(train.indexOf("check_dataset(root)")).toBeGreaterThan(-1);
    expect(train.indexOf("check_dataset(root)")).toBeLessThan(train.indexOf("FastModel.from_pretrained"));
    expect(train).toContain("resume_from_checkpoint=resume");
    // no automatic retries: a code error retried 4 times on the first smoke run and paid for four model loads (and Unsloth's in-process patch let attempt 2 pass, which hid the bug)
    expect(code).not.toContain("modal.Retries(");
    expect(code).not.toMatch(/@app\.function\([^)]*retries\s*=/);
  });

  it("expects the same prompt version the prompt module declares", () => {
    expect(src).toContain(`EXPECT_PROMPT_VERSION = "${TUNE_PROMPT_VERSION}"`);
  });

  it("knows two prompt versions, each with its own training window, and picks the window from the dataset unless told otherwise", () => {
    expect(src).toContain('PROMPT_WINDOWS = {EXPECT_PROMPT_VERSION: 1024, "p1": 4608}');
    expect(code).toContain('cfg["max_seq_length"] = PROMPT_WINDOWS[manifest["tunePromptVersion"]]');
    expect(code).toContain('if "max_seq_length" not in overrides');
    expect(code).toContain('os.environ.get("TUNE_GPU", "L40S")');
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

  it("accepts a dataset built with the production prompt (p1) as well as the short one (t1)", () => {
    const dir = writeSet({ promptVersion: "p1" });
    try { expect(py("check_dataset", dir)).toMatch(/^OK/); } finally { rmSync(dir, { recursive: true }); }
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

// ---- the chat template: the trainer must render what the server renders --------------------------------------------------------------------------------------------------------------

describe("the chat template the trainer renders with", () => {
  it("is Meta's, pinned to a revision of Meta's repo, and set on the tokenizer after EVERY place the trainer loads one (training, the generate check, the merge)", () => {
    expect(src).toContain('TEMPLATE_REPO = "meta-models/Muse-Glimmer-30B"');
    expect(src).toMatch(/TEMPLATE_REVISION = "[0-9a-f]{40}"/);
    const loads = code.match(/FastModel\.from_pretrained\(/g)?.length ?? 0;
    const uses = code.match(/^\s+use_serving_template\(tokenizer\)$/gm)?.length ?? 0;
    expect(loads).toBeGreaterThanOrEqual(3);
    expect(uses).toBe(loads);
  });

  const hasJinja = spawnSync("python3", ["-c", "import jinja2"]).status === 0;
  it.skipIf(!hasJinja)("renders our system line ONCE: the vendored copy of Meta's template adds no second 'Reasoning strength' line (the Unsloth copy did, which template-parity.ts caught)", () => {
    const py = [
      "import json,sys,jinja2",
      "t=open(sys.argv[1]).read()",
      "env=jinja2.Environment()",
      "env.globals['raise_exception']=lambda m: (_ for _ in ()).throw(Exception(m))",
      "out=env.from_string(t).render(messages=[{'role':'system','content':'Reasoning strength: low'},{'role':'user','content':'hello'}],bos_token='<|begin_of_text|>',add_generation_prompt=True)",
      "print(json.dumps(out))",
    ].join("\n");
    const r = spawnSync("python3", ["-c", py, join(__dirname, "fixtures", "glimmer-chat-template.jinja")], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout) as string;
    expect(out.match(/Reasoning strength/gi)?.length).toBe(1);
    expect(out.startsWith('<|begin_of_text|><|start|>system<|message|>Reasoning strength: low\n\n# Valid recipients: "self", "user".<|eot|><|start|>user<|message|>hello<|eot|>')).toBe(true);
  });
});

// ---- the converter, the tuned server and the template check ----------------------------------------------------------------------------------------------------------------------------

const CONVERT = join(__dirname, "..", "scripts", "modal", "glimmer_convert.py");
const SERVER = join(__dirname, "..", "scripts", "modal", "glimmer_tuned_server.py");
const convertSrc = readFileSync(CONVERT, "utf8");
const serverSrc = readFileSync(SERVER, "utf8");
const strip = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");

describe("the converter's text", () => {
  it("says the merged route never ran, pins llama.cpp to the release that knows Glimmer's converter layout, and rents no GPU", () => {
    expect(convertSrc).toContain("route B (merged) has NEVER RUN");
    expect(convertSrc).toContain('LLAMA_CPP_TAG = "b12078"');
    expect(strip(convertSrc)).not.toMatch(/gpu\s*=/);
    expect(convertSrc).toContain("conversion/muse_glimmer.py");
  });

  it("names both routes, fetches only config files of the base model (never its weights), and says what is unverified about the LoRA route", () => {
    expect(convertSrc).toContain("convert_lora_to_gguf.py");
    expect(convertSrc).toContain("convert_hf_to_gguf.py");
    expect(convertSrc).toContain('allow_patterns=["*.json", "*.jinja", "tokenizer*", "*.txt"]');
    expect(convertSrc).toContain("Unverified risks");
    expect(convertSrc).toContain("llama-quantize");
  });

  it("patches llama.cpp's LoRA converter on a copy, with every anchor checked: adds ndim, drops the base-only q_norm / k_norm tensors, and refuses a source whose anchors changed", () => {
    // the two anchors as they stand in llama.cpp b12078 (convert_lora_to_gguf.py)
    const mini = [
      "class LoraTorchTensor:",
      "    def get_lora_A_B(self) -> tuple[Tensor, Tensor]:",
      "        return (self._lora_A, self._lora_B)",
      "",
      "            def modify_tensors(self):",
      "                for dest_name, dest_data in dest:",
      "                    # mergekit-extract-lora add these layernorm to the adapter",
      '                    if "_norm" in dest_name:',
      "                        assert dest_data.dim() == 1",
      "",
    ].join("\n");
    const code = `import json,sys\nsrc=open(${JSON.stringify(CONVERT)}).read()\na=src.index("LORA_SCRIPT = ");b=src.index("def base_config_dir")\nns={}\nexec(src[a:b],ns)\nmini=json.loads(sys.stdin.read())\nout=ns["patch_lora_script"](mini)\nprint(json.dumps({"ndim":"def ndim(self)" in out,"skip":'dest_name.endswith(("attn_q_norm.weight"' in out,"before":out.index("attn_q_norm.weight")<out.index('if "_norm" in dest_name')}))\ntry:\n    ns["patch_lora_script"](mini.replace("get_lora_A_B","get_lora_AB"))\n    print("NO-REFUSAL")\nexcept SystemExit as e:\n    print("REFUSED "+str(e)[:60])`;
    const r = spawnSync("python3", ["-c", code], { input: JSON.stringify(mini), encoding: "utf8" });
    const [first, second] = r.stdout.trim().split("\n");
    expect(JSON.parse(first!)).toEqual({ ndim: true, skip: true, before: true });
    expect(second).toMatch(/^REFUSED llama\.cpp LoRA converter: patch anchor found 0 times/);
  });
});

describe("the tuned server's text", () => {
  it("is a separate app with its own label, scales to zero, uses the same key secret, and never names the base app's name as its own", () => {
    expect(serverSrc).toContain('APP_NAME = "toyventor-glimmer-tuned"');
    expect(serverSrc).toContain("min_containers=0");
    expect(strip(serverSrc)).not.toMatch(/min_containers=[1-9]/);
    expect(serverSrc).toContain('modal.Secret.from_name("glimmer-api-key")');
    expect(serverSrc).toContain('SERVED_NAME = "forge-glimmer"');
    expect(serverSrc).toContain("modal app stop toyventor-glimmer-tuned");
  });

  it("keeps the drafter off by default (it was trained for the base model) and pins the same llama.cpp image as the base app", () => {
    expect(serverSrc).toContain('TUNED_DRAFTER = os.environ.get("TUNED_DRAFTER", "0")');
    const base = readFileSync(join(__dirname, "..", "scripts", "modal", "glimmer_server.py"), "utf8");
    const digest = /@sha256:[0-9a-f]{64}/.exec(base)![0];
    expect(serverSrc).toContain(digest);
  });
});

describe.skipIf(!hasModal)("the converter and the tuned server, executed where they are plain Python", () => {
  const load = (path: string, env: Record<string, string>, body: string) =>
    spawnSync("python3", ["-c", `import importlib.util,sys,json,os\nspec=importlib.util.spec_from_file_location("m",${JSON.stringify(path)})\nm=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\n${body}`], { encoding: "utf8", env: { ...process.env, ...env } });

  it("reads a safetensors header: names, dtypes and shapes, without torch", () => {
    const dir = mkdtempSync(join(tmpdir(), "tune-st-"));
    try {
      const header = Buffer.from(JSON.stringify({ __metadata__: { format: "pt" }, "base_model.model.layers.0.self_attn.q_proj.lora_A.weight": { dtype: "F16", shape: [16, 6656], data_offsets: [0, 0] } }));
      const len = Buffer.alloc(8);
      len.writeBigUInt64LE(BigInt(header.length));
      writeFileSync(join(dir, "a.safetensors"), Buffer.concat([len, header]));
      const r = load(CONVERT, {}, `print(json.dumps(m.safetensors_header(sys.argv[1])))`.replace("sys.argv[1]", JSON.stringify(join(dir, "a.safetensors"))));
      expect(JSON.parse(r.stdout.trim())).toEqual({ "base_model.model.layers.0.self_attn.q_proj.lora_A.weight": ["F16", [16, 6656]] });
    } finally { rmSync(dir, { recursive: true }); }
  });

  const cmdFor = (env: Record<string, string>, existing: string[]) =>
    load(SERVER, env, `os.path.exists=lambda p: p in ${JSON.stringify(existing)}\ntry:\n    print(json.dumps(m.launch_command()))\nexcept RuntimeError as e:\n    print("ERR:",e)`);

  it("lora mode: the base GGUF plus --lora, the served name, and no drafter unless asked", () => {
    const files = ["/models/Muse-Glimmer-30B-KQuant-17GB-Q4_K_M.gguf", "/out/pilot-1/lora-f16.gguf"];
    const cmd = JSON.parse(cmdFor({ TUNED_RUN: "pilot-1", TUNED_MODE: "lora" }, files).stdout.trim()) as string[];
    expect(cmd[0]).toBe("/app/llama-server");
    expect(cmd.slice(cmd.indexOf("-m"), cmd.indexOf("-m") + 2)).toEqual(["-m", files[0]]);
    expect(cmd.slice(cmd.indexOf("--lora"), cmd.indexOf("--lora") + 2)).toEqual(["--lora", files[1]]);
    expect(cmd).toContain("forge-glimmer");
    expect(cmd).toContain("--jinja");
    expect(cmd).not.toContain("-md");
    const withDrafter = JSON.parse(cmdFor({ TUNED_RUN: "pilot-1", TUNED_MODE: "lora", TUNED_DRAFTER: "1" }, [...files, "/models/dflash-Muse-Glimmer-30B-Q4_K_M.gguf"]).stdout.trim()) as string[];
    expect(withDrafter).toContain("-md");
  });

  it("merged mode: the merged GGUF alone, no --lora", () => {
    const cmd = JSON.parse(cmdFor({ TUNED_RUN: "pilot-2", TUNED_MODE: "merged" }, ["/out/pilot-2/merged-Q4_K_M.gguf"]).stdout.trim()) as string[];
    expect(cmd.slice(cmd.indexOf("-m"), cmd.indexOf("-m") + 2)).toEqual(["-m", "/out/pilot-2/merged-Q4_K_M.gguf"]);
    expect(cmd).not.toContain("--lora");
  });

  it("refuses to start when a file it needs is not there, and says which step makes it", () => {
    expect(cmdFor({ TUNED_RUN: "pilot-1", TUNED_MODE: "lora" }, []).stdout).toMatch(/ERR: .*missing: run glimmer_convert\.py \(lora\)/);
    expect(cmdFor({ TUNED_RUN: "pilot-1", TUNED_MODE: "merged" }, []).stdout).toMatch(/ERR: .*merged-Q4_K_M\.gguf is missing: run glimmer_convert\.py \(merged\)/);
  });

  it("refuses a mode that is neither lora nor merged when the module loads", () => {
    const r = load(SERVER, { TUNED_MODE: "yolo" }, "print('loaded')");
    expect(r.stdout).not.toContain("loaded");
    expect(r.stderr).toMatch(/TUNED_MODE must be lora or merged/);
  });
});

describe("the template-parity check's pure parts", () => {
  it("ignores a leading begin-of-text on either side, and reports where two prompts first differ", async () => {
    const { firstDifference, stripBos } = await import("../scripts/tuning/template-parity");
    expect(stripBos("<|begin_of_text|><|start|>system")).toBe("<|start|>system");
    expect(stripBos("<|start|>system")).toBe("<|start|>system");
    expect(firstDifference("abc", "abc")).toBeNull();
    const d = firstDifference("<|start|>user<|message|>hello", "<|start|>user<|message|>help")!;
    expect(d.index).toBe("<|start|>user<|message|>hel".length);
  });
});

