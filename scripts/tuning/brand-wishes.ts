/**
 * Write the brand and character wishes for the training set (scripts/tuning/lib/brandWishes.ts) to scripts/tuning/data/wishes-brand.jsonl. No model call. Then sample them like any others:
 *
 *   npx tsx scripts/tuning/brand-wishes.ts
 *   npx tsx scripts/tuning/sample.ts --wishes scripts/tuning/data/wishes-brand.jsonl --out scripts/tuning/data/samples-brand.jsonl --per-wish 1 --concurrency 4 --max-calls 500
 */
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs, num, str } from "./args";
import { brandWishes } from "./lib/brandWishes";
const HERE = fileURLToPath(new URL(".", import.meta.url));

const { flags } = parseArgs(process.argv.slice(2));
const out = str(flags, "out") ?? join(HERE, "data", "wishes-brand.jsonl");
const { wishes, rejected } = brandWishes({ perLang: num(flags, "per-lang", 60) });
mkdirSync(join(out, ".."), { recursive: true });
writeFileSync(out, wishes.map((w) => JSON.stringify(w)).join("\n") + "\n");
const by: Record<string, number> = {};
for (const w of wishes) by[w.lang] = (by[w.lang] ?? 0) + 1;
console.log(`wrote ${out}: ${wishes.length} wishes ${JSON.stringify(by)}; rejected ${JSON.stringify(rejected)}`);
