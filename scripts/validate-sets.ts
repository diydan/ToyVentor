// Validates every sets/*.json against the shared schema so bad content
// fails here, not inside the running app. Run: npm run validate
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validateSet } from "../shared/part";

const dir = join(process.cwd(), "sets");
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
if (files.length === 0) {
  console.error("no set files found in sets/");
  process.exit(1);
}

let failed = 0;
for (const file of files) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(dir, file), "utf8"));
  } catch (err) {
    failed++;
    console.error(`${file}: invalid JSON — ${(err as Error).message}`);
    continue;
  }
  const errors = validateSet(parsed);
  if (errors.length > 0) {
    failed++;
    console.error(`${file}:`);
    for (const e of errors) console.error(`  - ${e}`);
  } else {
    const parts = (parsed as { parts: unknown[] }).parts.length;
    console.log(`${file}: ok (${parts} parts)`);
  }
}

if (failed > 0) {
  console.error(`validate: ${failed} file(s) failed`);
  process.exit(1);
}
console.log(`validate: ${files.length} set file(s) ok`);
