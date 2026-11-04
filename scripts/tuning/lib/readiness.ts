/**
 * What "ready to tune" means, as a checkable list. PREP is everything that needs no GPU and no money and must exist in the repo; STAGES is what has actually been RUN, which this file can only
 * see from local files (a training run on Modal leaves no local trace until its adapter is fetched). Used by `npm run tune:check` and tests/tuning-readiness.test.ts.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface Item { path: string; what: string }

/** Every file the preparation consists of. The readiness test fails if one is deleted. */
export const PREP: readonly Item[] = [
  { path: "shared/forgeTunePrompt.ts", what: "the short prompt a tuned model is trained on and served with (pinned by a hash)" },
  { path: "worker/modelBackend.ts", what: "the switch that serves it: SELF_TEXT_PROMPT=tuned, default off" },
  { path: "scripts/tuning/lib/wishgen.ts", what: "wish generator: seeds, the other six languages from our own model, splits, leakage guards" },
  { path: "scripts/tuning/wishes.ts", what: "command: write the wish files" },
  { path: "scripts/tuning/lib/sampling.ts", what: "sampling plan and the guard: only our own model, never hosted Spark" },
  { path: "scripts/tuning/lib/inprocessWorker.ts", what: "the real Worker in process, so samples go through the production pipeline" },
  { path: "scripts/tuning/sample.ts", what: "command: sample our own model through the real gates (resumable, spending brake)" },
  { path: "scripts/tuning/lib/dataset.ts", what: "dataset builder: safety filters, split files, leakage check, manifest" },
  { path: "scripts/tuning/build-dataset.ts", what: "command: write train, val, heldout, manifest and datasheet" },
  { path: "scripts/modal/glimmer_train.py", what: "the Modal training job (QLoRA, Unsloth): run as a 60-step smoke only" },
  { path: "scripts/modal/glimmer_convert.py", what: "the Modal converter: adapter to a GGUF LoRA, or merged weights to a quantised GGUF (llama.cpp pinned to b12078): the LoRA route has converted a smoke adapter, the merged route never ran" },
  { path: "scripts/modal/glimmer_tuned_server.py", what: "serves the tuned model in its own Modal app beside the base one, scale to zero: lora mode has served a smoke adapter, merged mode never ran" },
  { path: "scripts/tuning/template-parity.ts", what: "checks the trainer and llama-server render the chat template identically" },
  { path: "scripts/tuning/lib/compare.ts", what: "scoring and the decision rule (safety is a hard gate)" },
  { path: "scripts/tuning/eval.ts", what: "command: run a model over heldout, acceptance and red-team wishes; compare two runs" },
  { path: "tests/fixtures/forge-redteam.json", what: "seed red-team set in seven languages" },
  { path: "tests/fixtures/forge-acceptance-wishes.json", what: "the 40 acceptance wishes (evaluation only)" },
  { path: "tests/fixtures/kid-wishes.json", what: "harmless wishes in seven languages that must never be refused" },
  { path: "shared/kidSafeTerms.ts", what: "unsafe terms in seven languages (needs a native read)" },
  { path: "scripts/tuning/README.md", what: "the runbook: stages, commands, costs, risks, what may be claimed" },
  { path: "scripts/tuning/results.ts", what: "command: write the small committed summary of every evaluated run (results/pilots.md and .json) with the decision rule's verdict" },
  { path: "scripts/tuning/results/LEDGER.md", what: "the GPU spend ledger: a row before each use, reconciled after" },
  { path: "scripts/tuning/MODEL_CARD.md", what: "model card and risk-assessment draft (status: two pilots trained and evaluated, none shipped)" },
  { path: "scripts/tuning/data/example/dataset/manifest.json", what: "a worked example of the dataset's manifest, from canned recipes (stub, not trainable)" },
  { path: "scripts/tuning/data/example/dataset/DATASHEET.md", what: "a worked example of the datasheet" },
  { path: "tests/tuning-prompt.test.ts", what: "tests: prompt, hash pin, serving switch" },
  { path: "tests/tuning-wishgen.test.ts", what: "tests: wishes, splits, leakage" },
  { path: "tests/tuning-dataset.test.ts", what: "tests: source guard, safety filters, dataset, manifest" },
  { path: "tests/tuning-compare.test.ts", what: "tests: scoring and the decision rule" },
  { path: "tests/tuning-train.test.ts", what: "tests: trainer settings, converter, tuned server, and their executed plain-Python parts" },
  { path: "tests/tuning-redteam.test.ts", what: "tests: red-team seed against the live filters" },
];

export type StageState = "done" | "not_run";
export interface Stage { name: string; state: StageState; evidence: string; command: string }

/** What has been run, judged only from local files. "done" for a stage means its output file exists, not that the output is good. */
export function stages(root: string): Stage[] {
  const data = join(root, "scripts/tuning/data");
  const has = (p: string) => existsSync(join(data, p));
  let datasetSource = "";
  try { datasetSource = (JSON.parse(readFileSync(join(data, "dataset/manifest.json"), "utf8")) as { source?: string }).source ?? ""; } catch { /* not built */ }
  return [
    { name: "wishes written", state: has("wishes.jsonl") ? "done" : "not_run", evidence: "scripts/tuning/data/wishes.jsonl", command: "npx tsx scripts/tuning/wishes.ts --expand --count 600 --per-lang 120" },
    { name: "our own model sampled through the real gates", state: has("samples.jsonl") ? "done" : "not_run", evidence: "scripts/tuning/data/samples.jsonl", command: "npx tsx scripts/tuning/sample.ts --max-calls 2000" },
    { name: "dataset built from OUR model's answers", state: datasetSource === "self" ? "done" : "not_run", evidence: datasetSource ? `dataset/manifest.json says source=${datasetSource}` : "scripts/tuning/data/dataset/manifest.json", command: "npx tsx scripts/tuning/build-dataset.ts" },
    { name: "training run (Modal GPU)", state: has("adapter.fetched") ? "done" : "not_run", evidence: "an adapter in the Modal volume toyventor-tune-out (not visible from here)", command: "modal run scripts/modal/glimmer_train.py::smoke --dataset dataset --run smoke-1" },
    { name: "base model evaluated", state: has("eval-base.json") ? "done" : "not_run", evidence: "scripts/tuning/data/eval-base.json", command: "npx tsx scripts/tuning/eval.ts run --label base" },
    { name: "tuned model evaluated", state: has("eval-tuned.json") ? "done" : "not_run", evidence: "scripts/tuning/data/eval-tuned.json", command: "npx tsx scripts/tuning/eval.ts run --label tuned --prompt tuned --url <tuned server> --model <its name>" },
    { name: "decision rule applied", state: has("eval-compare.md") ? "done" : "not_run", evidence: "scripts/tuning/data/eval-compare.md", command: "npx tsx scripts/tuning/eval.ts compare scripts/tuning/data/eval-base.json scripts/tuning/data/eval-tuned.json --goal safety --md scripts/tuning/data/eval-compare.md" },
  ];
}

export function missingPrep(root: string): Item[] {
  return PREP.filter((i) => !existsSync(join(root, i.path)));
}
