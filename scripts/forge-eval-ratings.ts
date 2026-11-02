#!/usr/bin/env tsx
/**
 * Bring the manual taste ratings (1 to 5, "cute and on-brand") back into a Forge eval report.
 *
 * Usage:
 *   npx tsx scripts/forge-eval-ratings.ts REPORT.json RATINGS.json [--write]
 *
 * RATINGS.json maps a prompt id to {rating, note}, which is what the Forge Taste Check page's
 * "Copy ratings as JSON" button produces. Prints how many prompts were rated, the mean, the
 * histogram, the mean per slot and the ids rated 1 or 2. With --write the ratings are stored in
 * REPORT.json (the `rating` field of each result); without it the report is left alone.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyRatings, type PromptResult, type RatingEntry } from "./lib/forgeEvalCore";

const args = process.argv.slice(2).filter((a) => a !== "--");
const write = args.includes("--write");
const [reportPath, ratingsPath] = args.filter((a) => !a.startsWith("--")).map((p) => resolve(p));
if (!reportPath || !ratingsPath) {
  process.stderr.write("usage: forge-eval-ratings.ts REPORT.json RATINGS.json [--write]\n");
  process.exit(2);
}

const report = JSON.parse(readFileSync(reportPath, "utf8")) as { results: PromptResult[] } & Record<string, unknown>;
const ratings = JSON.parse(readFileSync(ratingsPath, "utf8")) as Record<string, RatingEntry>;
const { results, summary } = applyRatings(report.results, ratings);

const f = (x: number | null) => (x === null ? "-" : x.toFixed(2));
process.stdout.write(
  [
    `rated        ${summary.rated} of ${summary.total}`,
    `mean         ${f(summary.mean)}`,
    `histogram    ${JSON.stringify(summary.histogram)}`,
    `by slot      ${Object.entries(summary.bySlot).map(([s, v]) => `${s} ${f(v.mean)} (n=${v.rated})`).join(", ") || "-"}`,
    `rated 1 or 2 ${summary.low.join(", ") || "none"}`,
    "",
  ].join("\n"),
);

if (write) {
  writeFileSync(reportPath, JSON.stringify({ ...report, results, ratingSummary: summary }, null, 2));
  process.stdout.write(`Wrote ratings into ${reportPath}\n`);
}
