/**
 * Does the trainer render a prompt the same way llama-server does? A model trained on text built by one chat template and served text built by another is a different model, and the
 * difference is silent. This compares the two for the same messages.
 *
 *   modal volume get toyventor-tune-out /pilot-1/generate_check.json scripts/tuning/data/generate_check.json   # written by glimmer_train.py::generate (rendered_prompt, first 5)
 *   npx tsx scripts/tuning/template-parity.ts --url https://<workspace>--toyventor-glimmer-tuned.us-east.modal.run --check scripts/tuning/data/generate_check.json
 *
 * It asks the server's POST /apply-template for the prompt of each heldout example's messages (the key comes from .dev.vars and is never printed) and prints where the two texts first differ.
 * A leading begin-of-text token is ignored on either side (the tokenizer adds exactly one). Exit 1 if any differ. RUN 2026-11-04 against the tuned server: it found that the Unsloth copy of the
 * chat template added a second "Reasoning strength" line (5 of 5 prompts differed); the trainer now renders with Meta's template and 5 of 5 are identical.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { parseArgs, str } from "./args";
import { readDevVars } from "./lib/inprocessWorker";

const HERE = fileURLToPath(new URL(".", import.meta.url));

export function stripBos(text: string): string {
  return text.replace(/^<\|begin_of_text\|>/, "");
}

/** Where two strings first differ, with a little context, or null if they are the same. */
export function firstDifference(a: string, b: string): { index: number; a: string; b: string } | null {
  if (a === b) return null;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const cut = (s: string) => s.slice(Math.max(0, i - 30), i + 50).replace(/\n/g, "\\n");
  return { index: i, a: cut(a), b: cut(b) };
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const origin = new URL(str(flags, "url") ?? "").origin;
  const checkFile = str(flags, "check") ?? join(HERE, "data", "generate_check.json");
  const heldoutFile = str(flags, "heldout") ?? join(HERE, "data", "dataset", "heldout.jsonl");
  const key = process.env.SELF_TEXT_KEY ?? readDevVars().SELF_TEXT_KEY;
  const heldout = new Map(readFileSync(heldoutFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { id: string; messages: unknown[] }).map((h) => [h.id, h.messages]));
  const rows = (JSON.parse(readFileSync(checkFile, "utf8")) as { results: { id: string; rendered_prompt: string | null }[] }).results.filter((r) => r.rendered_prompt);
  if (rows.length === 0) throw new Error("no rendered prompts in the check file: run glimmer_train.py::generate first");
  let bad = 0;
  for (const r of rows) {
    const res = await fetch(`${origin}/apply-template`, { method: "POST", headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify({ messages: heldout.get(r.id) }), signal: AbortSignal.timeout(170_000) });
    if (!res.ok) throw new Error(`/apply-template answered ${res.status}`);
    const served = stripBos(String(((await res.json()) as { prompt?: string }).prompt ?? ""));
    const diff = firstDifference(stripBos(r.rendered_prompt!), served);
    console.log(diff ? `DIFFERENT ${r.id} at ${diff.index}\n   trainer: ${diff.a}\n   server:  ${diff.b}` : `same      ${r.id}`);
    if (diff) bad++;
  }
  console.log(bad === 0 ? `\n${rows.length} of ${rows.length} prompts render identically.` : `\n${bad} of ${rows.length} DIFFER: do not serve this model until they match.`);
  process.exit(bad === 0 ? 0 : 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(`error: ${(e as Error).message}`);
    process.exit(1);
  });
}
