/**
 * How well does a model do the VEHICLE slots and the held prop (hand) through the real pipeline? The 38 prompts of tests/forge/prompts.json that are not a hat or a head, each sent with its
 * slot through the real Worker, optimizer daemon and print gates, and the result written per slot: how many were printable, how many on the first call, calls, seconds, why the failures failed.
 *
 *   npx tsx scripts/tuning/slot-probe.ts --label base-slots [--slots back,hand,hood] [--daemon http://127.0.0.1:8792] [--url ... --model ... --prompt tuned]
 *
 * Defaults are the base model on the production prompt (SELF_TEXT_* from .dev.vars), like `eval.ts run --label base`. Writes scripts/tuning/results/slot-probe-<label>.json and .md (small, committed).
 * The point is a MEASUREMENT before anything is tuned: a tuned model copies the base, so a base that cannot do a slot gives nothing to copy. English prompts only, 3 to 8 per slot: a pointer, not a release test.
 */
import { fileURLToPath } from "node:url";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs, str } from "./args";
import { buildEnv, makeCaller, readDevVars } from "./lib/inprocessWorker";
import { runSampling } from "./lib/sampling";
import type { Wish } from "./lib/wishgen";
const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(HERE, "..", "..");
const EXTRA = ["back", "hand", "front", "rollbar", "spoiler", "hood", "roof", "exhaust"];

interface Row { id: string; slot: string; text: string; ok: boolean; printable: boolean; calls: number; secs: number; reason?: string; name?: string }

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const label = str(flags, "label") ?? "slots";
  const slots = (str(flags, "slots") ?? EXTRA.join(",")).split(",").filter(Boolean);
  const vars = readDevVars();
  const url = str(flags, "url") ?? process.env.SELF_TEXT_URL ?? vars.SELF_TEXT_URL ?? "";
  if (!url) throw new Error("no model URL: pass --url or set SELF_TEXT_URL.");
  const model = str(flags, "model") ?? process.env.SELF_TEXT_MODEL ?? vars.SELF_TEXT_MODEL ?? "muse-glimmer-30B";
  const prompt = str(flags, "prompt") === "tuned" ? "tuned" : "base";
  const env = buildEnv({ url, model, key: process.env.SELF_TEXT_KEY ?? vars.SELF_TEXT_KEY, api: "chat", prompt, daemonUrl: str(flags, "daemon") });
  const file = JSON.parse(readFileSync(join(ROOT, "tests/forge/prompts.json"), "utf8")) as { prompts: { id: string; slot: string; text: string }[] } | { id: string; slot: string; text: string }[];
  const all = Array.isArray(file) ? file : file.prompts;
  const items = all.filter((p) => slots.includes(p.slot));
  console.log(`${label}: ${items.length} prompts over ${[...new Set(items.map((i) => i.slot))].join(", ")}, prompt ${prompt}`);
  await fetch(`${new URL(url).origin}/health`, { signal: AbortSignal.timeout(170_000) }).catch(() => undefined);
  const send = makeCaller(env);
  const rows: Row[] = [];
  const todo = items.map((it, i) => ({ wish: { text: it.text, lang: "en", split: "heldout", source: "seed" } as Wish, index: i }));
  await runSampling(todo, async (t) => {
    const it = items[t.index]!;
    const { result, secs } = await send(it.text, it.slot as never);
    rows.push(result.ok
      ? { id: it.id, slot: it.slot, text: it.text, ok: true, printable: result.printable, calls: result.calls, secs, name: result.name }
      : { id: it.id, slot: it.slot, text: it.text, ok: false, printable: false, calls: result.calls, secs, reason: result.reason });
    return { ok: true };
  }, { concurrency: 2, source: { backend: "self", model, promptStyle: prompt, runId: label, at: new Date().toISOString() }, onRecord: () => { if (rows.length % 8 === 0) console.log(`  ${rows.length}/${items.length}`); } });

  const bySlot = [...new Set(items.map((i) => i.slot))].map((slot) => {
    const r = rows.filter((x) => x.slot === slot);
    const med = [...r.map((x) => x.secs)].sort((a, b) => a - b)[Math.floor(r.length / 2)] ?? 0;
    return { slot, n: r.length, printable: r.filter((x) => x.printable).length, firstCall: r.filter((x) => x.printable && x.calls === 1).length, meanCalls: Math.round((r.reduce((n, x) => n + x.calls, 0) / Math.max(1, r.length)) * 100) / 100, medianSecs: med, failures: r.filter((x) => !x.printable).map((x) => `${x.id}: ${x.reason ?? "not printable"}`) };
  });
  const tot = { n: rows.length, printable: rows.filter((x) => x.printable).length, firstCall: rows.filter((x) => x.printable && x.calls === 1).length };
  const out = join(HERE, "results");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `slot-probe-${label}.json`), JSON.stringify({ label, model, prompt, at: new Date().toISOString(), total: tot, bySlot, rows }, null, 1) + "\n");
  const md = `# Slot probe: ${label} (${new Date().toISOString().slice(0, 16)}Z)

Model ${model}, prompt ${prompt}; the English prompts of tests/forge/prompts.json for these slots, through the real Worker, daemon and gates. A pointer, not a release test (3 to 8 prompts a slot).

| slot | prompts | printable | on the first call | mean calls | median s |
| --- | --- | --- | --- | --- | --- |
${bySlot.map((s) => `| ${s.slot} | ${s.n} | ${s.printable} | ${s.firstCall} | ${s.meanCalls} | ${s.medianSecs} |`).join("\n")}
| **all** | ${tot.n} | **${tot.printable}** | **${tot.firstCall}** | | |

Failures: ${bySlot.flatMap((s) => s.failures).join("; ") || "none"}
`;
  writeFileSync(join(out, `slot-probe-${label}.md`), md);
  console.log(md);
}
main().catch((e) => { console.error(`error: ${(e as Error).message}`); process.exit(1); });
