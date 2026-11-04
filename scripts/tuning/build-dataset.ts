/**
 * Turn samples into the training set and write its datasheet.
 *
 *   npx tsx scripts/tuning/build-dataset.ts [--samples scripts/tuning/data/samples.jsonl] [--wishes scripts/tuning/data/wishes.jsonl]
 *       [--out scripts/tuning/data/dataset] [--per-wish-max 2] [--min-train 200] [--allow-stub]
 *
 * Writes train.jsonl, val.jsonl, heldout.jsonl (wishes only, for evaluation), manifest.json and DATASHEET.md. Exits 1 if any wish is in two sets or is evaluation data, or if there are fewer
 * than --min-train examples (a stub set may be small: --allow-stub lifts the minimum and marks the manifest "stub", which the trainer refuses).
 */
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs, num, str } from "./args";
import { buildDataset, buildManifest, toJsonl } from "./lib/dataset";
import { readJsonl, type SampleRecord } from "./lib/sampling";
import type { Wish } from "./lib/wishgen";
const HERE = fileURLToPath(new URL(".", import.meta.url));

function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const data = join(HERE, "data");
  const samples = readJsonl<SampleRecord>(str(flags, "samples") ?? join(data, "samples.jsonl"));
  const wishes = readJsonl<Wish>(str(flags, "wishes") ?? join(data, "wishes.jsonl"));
  const out = str(flags, "out") ?? join(data, "dataset");
  const allowStub = flags["allow-stub"] === true;
  const minTrain = allowStub ? 0 : num(flags, "min-train", 200);
  if (samples.length === 0) throw new Error("no samples: run  npx tsx scripts/tuning/sample.ts  first");

  const built = buildDataset(samples, wishes, { perWishMax: num(flags, "per-wish-max", 2), allowStub });
  const files = { "train.jsonl": toJsonl(built.train), "val.jsonl": toJsonl(built.val), "heldout.jsonl": toJsonl(built.heldout) };
  const manifest = buildManifest(built, files);
  mkdirSync(out, { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(join(out, name), content);
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(join(out, "DATASHEET.md"), datasheet(manifest));
  console.log(`wrote ${out}: ${built.train.length} train, ${built.val.length} val, ${built.heldout.length} heldout wishes; source: ${manifest.source}\nrejected: ${JSON.stringify(built.rejected)}`);
  if (built.leaks.length > 0) { console.error(`LEAK: ${built.leaks.length} wish(es) are evaluation data or in the heldout set: ${built.leaks.slice(0, 5).join(" | ")}`); process.exit(1); }
  if (built.train.length < minTrain) { console.error(`only ${built.train.length} training examples, --min-train is ${minTrain}`); process.exit(1); }
}

function datasheet(m: ReturnType<typeof buildManifest>): string {
  const rej = Object.entries(m.rejected).map(([k, v]) => `| ${k} | ${v} |`).join("\n") || "| none | 0 |";
  return `# Dataset datasheet (${m.source === "stub" ? "STUB: canned recipes, NOT training data" : "base Muse Glimmer's own gate-verified answers"})

Created ${m.createdAt}. Prompt version ${m.tunePromptVersion}, system line "${m.systemLine}".

## Contents
- examples: ${m.counts.examples} (train ${m.counts.perSplit.train}, val ${m.counts.perSplit.val}); heldout wishes (no answers): ${m.counts.perSplit.heldout}
- distinct wishes ${m.counts.distinctWishes}, distinct parts ${m.counts.distinctParts}
- by language: ${JSON.stringify(m.counts.perLanguage)}; by slot: ${JSON.stringify(m.counts.perSlot)}
- feature operations used: ${JSON.stringify(m.counts.featureOps)}
- approximate tokens per example: mean ${m.counts.approxTokens.mean}, max ${m.counts.approxTokens.max} (the trainer uses a 1,024-token window)

## Where it came from
${m.models.map((x) => `- ${x.backend} / ${x.model}: runs ${x.runIds.join(", ") || "none"}`).join("\n")}

## What was kept, and what was thrown away
${m.filters.map((f) => `- ${f}`).join("\n")}

| rejected for | samples |
| --- | --- |
${rej}

## Licence and provenance
${m.licence.map((l) => `- ${l}`).join("\n")}

## Leakage check
${m.leaks.length === 0 ? "No training wish is evaluation data, near it, or in the heldout set." : `LEAKS: ${m.leaks.join(", ")}`}

## Files
${Object.entries(m.files).map(([n, f]) => `- ${n}: ${f.records} records, sha256 ${f.sha256}`).join("\n")}

## Notes
${m.notes.map((n) => `- ${n}`).join("\n")}
`;
}

try {
  main();
} catch (e) {
  console.error(`error: ${(e as Error).message}`);
  process.exit(1);
}
