/**
 * `npm run tune:check`: is the preparation complete, and how far has the tuning actually got? Prints both. Exit 1 only if a PREP file is missing (or with --strict, if any stage is not run).
 * It never prints a secret: the environment lines say only whether a variable is set.
 */
import { connect } from "node:net";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { missingPrep, PREP, stages } from "./lib/readiness";
import { readDevVars } from "./lib/inprocessWorker";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");

const up = (host: string, port: number) =>
  new Promise<boolean>((res) => {
    const s = connect({ host, port, timeout: 1500 }, () => { s.destroy(); res(true); });
    s.on("error", () => res(false));
    s.on("timeout", () => { s.destroy(); res(false); });
  });

const missing = missingPrep(ROOT);
console.log(`PREPARATION (no GPU, no spend): ${PREP.length - missing.length}/${PREP.length} files present${missing.length ? "" : " - complete"}`);
for (const m of missing) console.log(`  MISSING ${m.path}: ${m.what}`);

console.log("\nSTAGES (what has actually been run, judged from local files):");
const st = stages(ROOT);
for (const s of st) console.log(`  [${s.state === "done" ? "x" : " "}] ${s.name}${s.state === "done" ? `  (${s.evidence})` : `\n        next: ${s.command}`}`);

const vars = readDevVars();
console.log("\nENVIRONMENT (set or not, never the value):");
console.log(`  SELF_TEXT_KEY in .dev.vars: ${vars.SELF_TEXT_KEY ? "set" : "NOT set"}`);
console.log(`  SELF_TEXT_URL (env or .dev.vars): ${process.env.SELF_TEXT_URL || vars.SELF_TEXT_URL ? "set" : "NOT set (pass --url, see scripts/modal/glimmer_server.py)"}`);
console.log(`  optimizer daemon on 127.0.0.1:8791: ${(await up("127.0.0.1", 8791)) ? "answering" : "not running (npm run forge:optimizer -- --port 8791)"}`);
console.log("  Modal: needs `modal setup` done and the secret glimmer-api-key (see scripts/modal/glimmer_server.py); not checkable from here");

const notRun = st.filter((s) => s.state === "not_run").length;
console.log(`\n${missing.length === 0 ? "The preparation is complete." : "The preparation is INCOMPLETE."} ${notRun} of ${st.length} stages are not run: nothing has been trained, and no claim may say it has.`);
process.exit(missing.length > 0 || (process.argv.includes("--strict") && notRun > 0) ? 1 : 0);
