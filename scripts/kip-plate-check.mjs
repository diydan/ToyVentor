#!/usr/bin/env node
// Offline plate gate for the Kip print view: packs the character of every preset and checks it.
// Run: npm run kip:plate-check [-- --preset boy,girl] [--strict] [--out DIR]
//
// Why this is not "preprint_check.py on the plate": V1 blocks any STL with more than one body, so a packed plate
// can never pass as a single file. What can be checked, per preset, is:
//   layout   every plate legal: >= 5 mm gaps, inside the 170 mm bound, parts seated on the bed, rigid transforms
//   catalog  each catalog part's file matches a passing validation report (sha-256 + verdict; the full V1-V10 gate)
//   files    every mapped STL exists (a missing one fails, never skipped)
//   supports base body parts (kip.scad) that need supports are listed, not failed: the plate flags them for the slicer
// Exit 1 on any layout violation, missing file or failing catalog verdict. A stale report (sha mismatch) is a warning
// unless --strict. Preset end states are read from the live demo in headless Chrome so the preset logic is not copied.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPlates, checkPlacement, expandInstances, inventoryFor, layoutJson, parseStl, plateBound, plateStl, prepareItem, smallParts,
} from "../parts/kip/viewer/kip-print.js";
import { launchChrome, startServer } from "./lib/kip-e2e.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const strict = flag("strict");
const outDir = opt("out") ?? path.join(os.tmpdir(), "kip-plates");
const only = opt("preset")?.split(",");
mkdirSync(outDir, { recursive: true });

const index = JSON.parse(readFileSync(path.join(root, "public/kip/partspec-validation.json"), "utf8")).files;
const stlCache = new Map();
function loadStl(url) {
  if (!stlCache.has(url)) {
    try {
      const bytes = readFileSync(path.join(root, "public", url));
      stlCache.set(url, { tri: parseStl(bytes), sha: createHash("sha256").update(bytes).digest("hex") });
    } catch (e) { stlCache.set(url, { error: e.code === "ENOENT" ? "missing" : e.message }); }
  }
  return stlCache.get(url);
}

// ---- preset end states, straight from the demo ------------------------------------------------
const server = await startServer();
const chrome = await launchChrome();
let states;
try {
  const tab = await chrome.open(`${server.base}/kip/Kip-Demo.html?menu=side`);
  if (!(await tab.waitFor("window.__KIP_READY__ === true", 180000))) throw new Error(`demo did not initialise: ${tab.exceptions[0] ?? "timeout"}`);
  states = await tab.evaluate(`(() => {
    const c = window.kipMenu.ctx, l = c.loco, out = {};
    for (const p of c.presets) {
      c.act.applyPreset(p.id);
      out[p.id] = { edition: l.edition, category: l.category, head: l.head, faceInsert: l.faceInsert, expr: l.expr, hair: l.hair, hat: l.hat,
        back: l.back, prop: l.prop, vehicle: l.vehicle, ears: c.read.ears(), tail: c.read.tail() };
    }
    return out; })()`);
  tab.close();
} finally { chrome.close(); server.close(); }

// ---- check each preset ------------------------------------------------------------------------
const bound = plateBound();
let failed = 0, warned = 0;
const rows = [];
for (const [id, state] of Object.entries(states)) {
  if (only && !only.includes(id)) continue;
  const inv = inventoryFor(state);
  const problems = [], warnings = [];
  const prepared = [];
  for (const entry of inv.items) {
    const rec = loadStl(entry.file);
    if (rec.error) { problems.push(`${entry.file.split("/").pop()}: ${rec.error}`); continue; }
    const name = entry.file.split("/").pop();
    const rep = index[name];
    let verified = false;
    if (entry.source === "partspec") {
      if (!rep) warnings.push(`${name}: no validation report`);
      else if (rep.verdict === "fail") problems.push(`${name}: validation verdict is fail`);
      else if (rep.sha256 !== rec.sha) warnings.push(`${name}: validation report is stale (sha mismatch)`);
      else verified = true;
    }
    prepared.push(prepareItem(entry, rec.tri, { verified }));
  }
  const instances = expandInstances(prepared, Object.fromEntries(inv.items.map((e) => [e.id, e.qty])));
  const res = buildPlates(instances, { boundMm: bound.mm });
  if (res.oversize.length) problems.push(`too big for a plate: ${res.oversize.join(", ")}`);
  res.plates.forEach((pl, i) => {
    for (const v of checkPlacement(pl, res.boundMm, res.gap)) problems.push(`plate ${i + 1}: ${v}`);
    writeFileSync(path.join(outDir, `${id}_plate${i + 1}.stl`), plateStl(pl, `kip-${id}-${i + 1}`));
  });
  writeFileSync(path.join(outDir, `${id}_layout.json`), layoutJson(res.plates, { preset: id }));
  const tiers = {};
  for (const p of instances) tiers[p.tier] = (tiers[p.tier] ?? 0) + 1;
  const bad = problems.length > 0 || (strict && warnings.length > 0);
  if (bad) failed++;
  if (warnings.length) warned++;
  rows.push({ id, parts: instances.length, plates: res.plates.length, tiers, unmapped: inv.unmapped.length, small: smallParts(res.plates).length, problems, warnings, bad });
}

console.log(`plate bound ${bound.mm} mm, gap 5 mm, plates written to ${outDir}\n`);
console.log("preset".padEnd(9), "parts".padEnd(6), "plates".padEnd(7), "support-free".padEnd(13), "unverified/geom".padEnd(16), "needs-supports".padEnd(15), "not-on-plate".padEnd(13), "result");
for (const r of rows) {
  const t = r.tiers;
  console.log(r.id.padEnd(9), String(r.parts).padEnd(6), String(r.plates).padEnd(7), String(t["support-free"] ?? 0).padEnd(13),
    String((t.unverified ?? 0) + (t["geometry-checked"] ?? 0)).padEnd(16), String(t["needs-supports"] ?? 0).padEnd(15), String(r.unmapped).padEnd(13), r.bad ? "FAIL" : r.warnings.length ? "ok (warnings)" : "ok");
  for (const p of r.problems) console.log(`    FAIL  ${p}`);
  for (const w of r.warnings) console.log(`    warn  ${w}`);
}
console.log(`\n${rows.length - failed}/${rows.length} presets pass${warned ? ` (${warned} with warnings; --strict makes warnings fail)` : ""}`);
console.log("unverified/geom = catalog parts with no matching validation report + non-catalog parts with no steep overhang (V4 only).");
console.log("Note: base body parts that need supports are flagged on the plate and in the 3MF, not failed here. Bridges and ledges of non-catalog parts are not judged.");
if (failed) process.exitCode = 1;
