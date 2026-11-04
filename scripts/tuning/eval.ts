/**
 * Run a model over the evaluation wishes, and compare two runs by the decision rule in lib/compare.ts.
 *
 *   npx tsx scripts/tuning/eval.ts run --label base  [--sets heldout,acceptance,redteam] [--url ...] [--model ...] [--out scripts/tuning/data/eval-base.json]
 *   npx tsx scripts/tuning/eval.ts run --label tuned --prompt tuned --reasoning low --url <the tuned server> --model <its name>
 *   npx tsx scripts/tuning/eval.ts compare scripts/tuning/data/eval-base.json scripts/tuning/data/eval-tuned.json --goal safety|speed|both
 *
 * The sets: heldout (the wishes no training example came from: scripts/tuning/data/dataset/heldout.jsonl), acceptance (the 40 wishes of the 2026-11 runs) and redteam (the seed set).
 * Needs the optimizer daemon and a model server. Each run is resumable only by rerunning; a run is a few hundred calls: see the estimate it prints.
 */
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs, str } from "./args";
import { buildEnv, makeCaller, readDevVars } from "./lib/inprocessWorker";
import { decide, renderReport, scoreRedteam, scoreRun, type EvalResult, type Expect, type Goal, type Report } from "./lib/compare";
import { estimateCost, readJsonl, runSampling } from "./lib/sampling";
import type { Wish } from "./lib/wishgen";
const HERE = fileURLToPath(new URL(".", import.meta.url));

const ROOT = join(HERE, "..", "..");
const DATA = join(HERE, "data");

interface Item { id: string; text: string; set: EvalResult["set"]; expect: Expect; slot?: "crown" | "head"; lang?: string; kind?: string }

function loadItems(sets: string[]): Item[] {
  const items: Item[] = [];
  if (sets.includes("heldout")) for (const h of readJsonl<{ id: string; wish: string; slot?: "crown" | "head"; lang?: string }>(join(DATA, "dataset", "heldout.jsonl"))) items.push({ id: h.id, text: h.wish, set: "heldout", expect: "make", slot: h.slot, lang: h.lang });
  if (sets.includes("acceptance")) {
    const d = JSON.parse(readFileSync(join(ROOT, "tests/fixtures/forge-acceptance-wishes.json"), "utf8")) as { wishes: { text: string; group: string; slot?: "crown" | "head"; expect: Expect }[] };
    d.wishes.forEach((w, i) => items.push({ id: `a${String(i + 1).padStart(2, "0")}`, text: w.text, set: "acceptance", expect: w.expect, slot: w.slot, kind: w.group }));
  }
  if (sets.includes("redteam")) {
    const d = JSON.parse(readFileSync(join(ROOT, "tests/fixtures/forge-redteam.json"), "utf8")) as { cases: { id: string; text: string; lang: string; expect: Expect; kind: string }[] };
    for (const c of d.cases) items.push({ id: c.id, text: c.text, set: "redteam", expect: c.expect, lang: c.lang, kind: c.kind });
  }
  return items;
}

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
  const est = estimateCost(items.length, 2);
  console.log(`${label}: ${items.length} wishes (${sets.join(", ")}), prompt ${prompt}, about ${est.minutes} min and $${est.dollars} (estimate).`);
  await fetch(`${new URL(url).origin}/health`, { signal: AbortSignal.timeout(170_000) }).catch(() => undefined);
  const send = makeCaller(env);
  const out: EvalResult[] = [];
  const todo = items.map((it, i) => ({ wish: { text: it.text, lang: "en", split: "heldout", source: "seed", slot: it.slot } as Wish, index: i }));
  await runSampling(todo, async (t) => {
    const it = items[t.index]!;
    const { result, secs } = await send(it.text, it.slot);
    const base = { id: it.id, text: it.text, set: it.set, expect: it.expect, lang: it.lang, kind: it.kind } as const;
    out.push(result.ok
      ? { ...base, ok: true, printable: result.printable, calls: result.calls, secs, name: result.name, names: Object.fromEntries(Object.entries(result.names).map(([l, n]) => [l, { w: n!.w }])), recipe: { name: result.recipe.name, behavior: result.recipe.behavior } }
      : { ...base, ok: false, reason: result.reason, calls: result.calls, secs });
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
