/**
 * Run a model over the evaluation wishes, and compare two runs by the decision rule in lib/compare.ts.
 *
 *   npx tsx scripts/tuning/eval.ts run --label base  [--sets heldout,acceptance,redteam] [--url ...] [--model ...] [--out scripts/tuning/data/eval-base.json]
 *   npx tsx scripts/tuning/eval.ts run --label tuned --prompt tuned --reasoning low --url <the tuned server> --model <its name>
 *   npx tsx scripts/tuning/eval.ts compare scripts/tuning/data/eval-base.json scripts/tuning/data/eval-tuned.json --goal safety|speed|both
 *
 * The sets: heldout (the wishes no training example came from: scripts/tuning/data/dataset/heldout.jsonl), acceptance (the 40 wishes of the 2026-11 runs) and redteam (the seed set).
 * The BLIND set (scripts/tuning/blind/): blind-dev (iterate on it), blind-test (touch once per candidate) or blind (both halves); its general, slot and edge wishes score like heldout, its brand,
 * subtle-unsafe and inject wishes like redteam, and brand wishes carry the brand names the scorer must look for.
 * Needs the optimizer daemon and a model server. Each run is resumable only by rerunning; a run is a few hundred calls: see the estimate it prints.
 */
import { fileURLToPath } from "node:url";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs, str } from "./args";
import { buildEnv, makeCaller, readDevVars } from "./lib/inprocessWorker";
import { decide, renderReport, scoreRedteam, scoreRun, type EvalResult, type Goal, type Report } from "./lib/compare";
import { estimateCost, readJsonl, runSampling } from "./lib/sampling";
import type { Wish } from "./lib/wishgen";
import { loadItems } from "./lib/evalItems";
const HERE = fileURLToPath(new URL(".", import.meta.url));

const DATA = join(HERE, "data");

async function run(flags: Record<string, string | true>) {
  const label = str(flags, "label") ?? "run";
  const sets = (str(flags, "sets") ?? "heldout,acceptance,redteam").split(",");
  const vars = readDevVars();
  const url = str(flags, "url") ?? process.env.SELF_TEXT_URL ?? vars.SELF_TEXT_URL ?? "";
  if (!url) throw new Error("no model URL: pass --url or set SELF_TEXT_URL.");
  const model = str(flags, "model") ?? process.env.SELF_TEXT_MODEL ?? vars.SELF_TEXT_MODEL ?? "muse-glimmer-30B";
  const prompt = str(flags, "prompt") === "tuned" ? "tuned" : "base";
  const env = buildEnv({ url, model, key: process.env.SELF_TEXT_KEY ?? vars.SELF_TEXT_KEY, api: "chat", prompt, ...(str(flags, "reasoning") ? { reasoning: str(flags, "reasoning") } : {}), daemonUrl: str(flags, "daemon") });
  const items = loadItems(sets);
  if (items.length === 0) throw new Error("no wishes to run: build the dataset first (heldout.jsonl) or use --sets acceptance,redteam");
  const est = estimateCost(items.length, 2); // one container, two at a time
  console.log(`${label}: ${items.length} wishes (${sets.join(", ")}), prompt ${prompt}, about ${est.minutes} min and $${est.dollars} (estimate).`);
  await fetch(`${new URL(url).origin}/health`, { signal: AbortSignal.timeout(170_000) }).catch(() => undefined);
  const send = makeCaller(env);
  // Every finished wish is also appended to eval-<label>.partial.jsonl, so a run that has to stop (the laptop going offline, a killed process) can go on with --resume instead of starting over.
  // On --resume, wishes that finished are kept; wishes that failed only because the connection was down ("unavailable") are asked again; a model's own failures (no recipe, not printable) are kept as they are.
  const partialFile = join(DATA, `eval-${label}.partial.jsonl`);
  const out: EvalResult[] = [];
  if (flags.resume === true && existsSync(partialFile)) {
    for (const r of readJsonl<EvalResult & { reason?: string }>(partialFile)) if (r.ok || r.reason !== "unavailable") out.push(r);
    console.log(`resuming ${label}: ${out.length} of ${items.length} wishes already answered in ${partialFile}`);
  } else writeFileSync(partialFile, "");
  const answered = new Set(out.map((r) => r.id));
  const todo = items.map((it, i) => ({ wish: { text: it.text, lang: "en", split: "heldout", source: "seed", slot: it.slot } as Wish, index: i })).filter((t) => !answered.has(items[t.index]!.id));
  await runSampling(todo, async (t) => {
    const it = items[t.index]!;
    const { result, secs, raw } = await send(it.text, it.slot);
    const base = { id: it.id, text: it.text, set: it.set, expect: it.expect, lang: it.lang, kind: it.kind, ...(it.brandTerms ? { brandTerms: it.brandTerms } : {}) } as const;
    const rec: EvalResult = (result.ok
      ? { ...base, ok: true, printable: result.printable, calls: result.calls, secs, name: result.name, names: Object.fromEntries(Object.entries(result.names).map(([l, n]) => [l, { w: n!.w }])), recipe: result.recipe /* the whole sanitised recipe (shape and features), so style and variety can be measured later; scoring reads only name and behaviour */ }
      : { ...base, ok: false, reason: result.reason, calls: result.calls, secs }) as EvalResult;
    rec.rawAnswers = raw; // every answer the model gave for this wish, so a later change to a filter can be scored without asking the model again
    out.push(rec);
    appendFileSync(partialFile, JSON.stringify(rec) + "\n");
    return { ok: true };
  }, { concurrency: 2, source: { backend: "self", model, promptStyle: prompt, runId: label, at: new Date().toISOString() }, onRecord: () => { if (out.length % 10 === 0) console.log(`  ${out.length}/${items.length}`); } });
  const file = str(flags, "out") ?? join(DATA, `eval-${label}.json`);
  writeFileSync(file, JSON.stringify({ label, model, prompt, at: new Date().toISOString(), results: out }, null, 1));
  console.log(`wrote ${file}`);
}

function load(file: string): Report {
  const d = JSON.parse(readFileSync(file, "utf8")) as { label: string; results: EvalResult[] };
  return { label: d.label, metrics: scoreRun(d.results), redteam: scoreRedteam(d.results) };
}

function compare(rest: string[], flags: Record<string, string | true>) {
  const [a, b] = rest;
  if (!a || !b) throw new Error("usage: eval.ts compare <base.json> <tuned.json> --goal speed|safety|both");
  const goal = (str(flags, "goal") ?? "both") as Goal;
  if (!["speed", "safety", "both"].includes(goal)) throw new Error("--goal must be speed, safety or both");
  const base = load(a), tuned = load(b);
  const d = decide(base, tuned, goal);
  const md = renderReport(base, tuned, d);
  const out = str(flags, "md");
  if (out) writeFileSync(out, md);
  console.log(md);
  process.exit(d.pass ? 0 : 1);
}

const { flags, rest } = parseArgs(process.argv.slice(2));
const cmd = rest[0];
(cmd === "run" ? run(flags) : cmd === "compare" ? Promise.resolve(compare(rest.slice(1), flags)) : Promise.reject(new Error("usage: eval.ts run|compare ..."))).catch((e) => {
  console.error(`error: ${(e as Error).message}`);
  process.exit(1);
});
