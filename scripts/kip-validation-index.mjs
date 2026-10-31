#!/usr/bin/env node
// Writes public/kip/partspec-validation.json: for every served catalog STL, the sha-256 and verdict recorded
// in parts/partspec/validation/<part>.json. The print view hashes the bytes it fetches and shows "verified"
// only when they match this index; a mismatch (stale report) or an unlisted file shows "unverified".
// Deterministic (sorted, no timestamp) so reruns only change the file when a report changes.
// Run: node scripts/kip-validation-index.mjs
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const validationDir = join(root, "parts/partspec/validation");
const served = join(root, "public/kip/partspec");
const outFile = join(root, "public/kip/partspec-validation.json");

const files = {};
for (const name of readdirSync(validationDir).sort()) {
  if (!name.endsWith(".json") || name === "summary.json") continue;
  const report = JSON.parse(readFileSync(join(validationDir, name), "utf8"));
  if (!report.file || !report.file_sha256) continue;
  if (!existsSync(join(served, report.file))) continue; // not served to the viewer
  files[report.file] = { part: report.part_id, sha256: report.file_sha256, verdict: report.verdict };
}
const index = { format: "toyventor.kip-validation-index/1", files };
writeFileSync(outFile, `${JSON.stringify(index, null, 1)}\n`);

let match = 0;
const stale = [];
for (const [file, v] of Object.entries(files)) {
  const sha = createHash("sha256").update(readFileSync(join(served, file))).digest("hex");
  if (sha === v.sha256) match++; else stale.push(file);
}
console.log(`kip-validation-index: ${Object.keys(files).length} served files indexed, ${match} match their report`);
if (stale.length) console.log(`  stale reports (will show "unverified"): ${stale.join(", ")}`);
