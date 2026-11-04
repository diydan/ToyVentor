/**
 * Sample our own model: send the training wishes through the real pipeline and keep every answer with its verdict.
 *
 *   npx tsx scripts/tuning/sample.ts [--wishes scripts/tuning/data/wishes.jsonl] [--out scripts/tuning/data/samples.jsonl]
 *       [--per-wish 2] [--concurrency 2] [--max-calls 200] [--url https://<workspace>--toyventor-glimmer.us-east.modal.run/v1] [--model muse-glimmer-30B]
 *       [--retry-failed]  try again the wishes whose earlier call failed (a timeout, a dropped connection)
 *       [--dry-run]     print the plan and the estimate, send nothing
 *       [--stub]        canned recipes, no model, no daemon: shows the file format only (records are marked stub and are never trainable)
 *
 * Needs the optimizer daemon (`npm run forge:optimizer -- --port 8791`) and, unless --stub, the Modal Glimmer server and SELF_TEXT_KEY in .dev.vars.
 * It REFUSES to run against the hosted API or with the tuned prompt (scripts/tuning/lib/sampling.ts requireOwnModel), never samples the heldout wishes, and is resumable: records
 * already in --out are skipped. --max-calls (default 200) is the spending brake: raise it on purpose.
 */
import { fileURLToPath } from "node:url";
import { connect } from "node:net";
import { join } from "node:path";
import { resolveBackend } from "../../worker/modelBackend";
import { parseArgs, num, str } from "./args";
import { buildEnv, makeCaller, readDevVars } from "./lib/inprocessWorker";
import { appendJsonl, estimateCost, orderForSampling, planSampling, readJsonl, requireOwnModel, runSampling, SamplingRefused, type CallFn, type SampleRecord, type SampleSource } from "./lib/sampling";
import { stubBody } from "./lib/stub";
import type { Split, Wish } from "./lib/wishgen";
const HERE = fileURLToPath(new URL(".", import.meta.url));

const DATA = join(HERE, "data");

async function reachable(urlText: string): Promise<boolean> {
  const u = new URL(urlText);
  return new Promise((res) => {
    const s = connect({ host: u.hostname, port: Number(u.port || 80), timeout: 2000 }, () => { s.destroy(); res(true); });
    s.on("error", () => res(false));
    s.on("timeout", () => { s.destroy(); res(false); });
  });
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const stub = flags.stub === true;
  const wishesFile = str(flags, "wishes") ?? join(DATA, "wishes.jsonl");
  const out = str(flags, "out") ?? join(DATA, stub ? "samples.stub.jsonl" : "samples.jsonl");
  const perWish = num(flags, "per-wish", 2);
  const concurrency = num(flags, "concurrency", 2);
  const maxCalls = num(flags, "max-calls", 200);
  const promptStyle = str(flags, "prompt") === "tuned" ? "tuned" : "base";
  const wishes = readJsonl<Wish>(wishesFile);
  if (wishes.length === 0) throw new Error(`no wishes in ${wishesFile}: run  npx tsx scripts/tuning/wishes.ts  first`);

  const vars = readDevVars();
  const url = str(flags, "url") ?? process.env.SELF_TEXT_URL ?? vars.SELF_TEXT_URL ?? "";
  const model = str(flags, "model") ?? process.env.SELF_TEXT_MODEL ?? vars.SELF_TEXT_MODEL ?? "muse-glimmer-30B";
  const daemonUrl = str(flags, "daemon") ?? "http://127.0.0.1:8791";
  const env = buildEnv({ url, model, key: process.env.SELF_TEXT_KEY ?? vars.SELF_TEXT_KEY, api: "chat", prompt: promptStyle, daemonUrl });
  const mode = url ? resolveBackend(env, "text").mode : "off";
  requireOwnModel({ mode, promptStyle, stub });
  if (!stub && !url) throw new SamplingRefused("no model URL: pass --url or set SELF_TEXT_URL (see scripts/modal/glimmer_server.py).");

  const splits: Split[] = ["train", "val"]; // never heldout
  const plan = planSampling(orderForSampling(wishes), { perWish, maxCalls, splits, existing: readJsonl<SampleRecord>(out), retryFailed: flags["retry-failed"] === true });
  const est = estimateCost(plan.todo.length, concurrency);
  console.log(`${stub ? "STUB run (canned recipes, not trainable)" : "Sampling our own model"}: ${plan.todo.length} calls to make, ${plan.alreadyDone} already in ${out}${plan.cutByMaxCalls ? `, ${plan.cutByMaxCalls} more cut by --max-calls ${maxCalls}` : ""}.`);
  if (!stub) console.log(`Estimate (about 13 s of container time a call, ${Math.ceil(concurrency / 2)} container(s), L40S at list price): about ${est.minutes} min and $${est.dollars}. An estimate, not a quote.`);
  if (flags["dry-run"] === true || plan.todo.length === 0) return;

  if (!stub) {
    if (!(await reachable(daemonUrl))) throw new Error(`the optimizer daemon is not answering at ${daemonUrl}: npm run forge:optimizer -- --port 8791`);
    console.log("warming the model server (a cold start can take a few minutes)...");
    await fetch(`${new URL(url).origin}/health`, { signal: AbortSignal.timeout(170_000) }).catch(() => undefined);
  }

  const source: SampleSource = { backend: stub ? "stub" : "self", model: stub ? "none" : model, promptStyle, runId: `run-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12)}`, at: new Date().toISOString() };
  const call: CallFn = stub
    ? async (t) => stubBody(t)
    : (() => {
        const send = makeCaller(env);
        return async (t) => {
          const { result, secs } = await send(t.wish.text, t.wish.slot);
          if (!result.ok) return { ok: false, reason: result.reason, calls: result.calls, secs };
          const names = Object.fromEntries(Object.entries(result.names).map(([l, n]) => [l, { w: n!.w, g: n!.g, ...(n!.pl ? { pl: true } : {}) }]));
          return { ok: true, printable: result.printable, calls: result.calls, secs, recipe: result.recipe, name: result.name, names };
        };
      })();

  let done = 0, printable = 0, failed = 0;
  await runSampling(plan.todo, call, {
    concurrency,
    source,
    onRecord: (r) => {
      appendJsonl(out, r);
      done++;
      if (r.ok && r.printable) printable++;
      if (!r.ok) failed++;
      if (done % 10 === 0 || done === plan.todo.length) console.log(`  ${done}/${plan.todo.length}  printable ${printable}  failed ${failed}`);
    },
  });
  console.log(`done: ${done} samples, ${printable} printable, ${failed} failed -> ${out}`);
}

main().catch((e) => {
  console.error(e instanceof SamplingRefused ? `REFUSED: ${e.message}` : `error: ${(e as Error).message}`);
  process.exit(e instanceof SamplingRefused ? 2 : 1);
});
