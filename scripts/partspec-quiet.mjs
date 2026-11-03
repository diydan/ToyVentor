#!/usr/bin/env node
// Is the PartSpec tree quiet? Exit 0 if no generator, gate, export or self-test is running, exit 1 and list them if one is.
// Run it as its OWN step before editing parts/partspec sources or regenerating anything:   npm run partspec:quiet && <your edit>
// (Other sessions and tools regenerate and self-test this tree while you work; an edit made while one of them is mid-run can change what it sees.
// 2026-11-03: an edit was applied in the same command as a check that printed a running selftest: reading the output is not a gate, an exit code is.)
import { execFileSync } from "node:child_process";

const JOBS = [
  "toyventor_parts", "toyventor_assembly", "toyventor_kitcard", "selftest", "preprint_check", "make_catalog", "make_specs", "make_standard",
  "make_agents", "kip_partspec", "verify_band_jet", "sync_truck_parts", "sync_truck_kip", "optimize_assets", "export_kitcards",
];
let out = "";
try {
  out = execFileSync("pgrep", ["-fl", `(${JOBS.join("|")})\\.py`], { encoding: "utf8" });
} catch (e) {
  if (e.status !== 1) throw e; // pgrep exits 1 when nothing matches: that is the quiet case
}
const mine = new Set([String(process.pid), String(process.ppid)]);
const running = out.split("\n").filter(Boolean).filter((l) => !mine.has(l.split(" ")[0]) && !/partspec-quiet/.test(l));
if (running.length) {
  console.log(`partspec is NOT quiet: ${running.length} job(s) running\n` + running.map((l) => "  " + l.slice(0, 170)).join("\n"));
  process.exit(1);
}
console.log("partspec is quiet: no generator, gate, export or self-test is running");
