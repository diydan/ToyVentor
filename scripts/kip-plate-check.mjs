#!/usr/bin/env node
// Offline plate gate for the Kip print view: packs the colour-grouped plates of every preset and checks them.
// Run: npm run kip:plate-check [-- --preset boy,girl] [--sprue] [--slice] [--strict] [--out DIR]
//
// Why this is not "preprint_check.py on the plate": V1 blocks any STL with more than one body, so a packed plate
// can never pass as a single file. What can be checked, per preset, is:
//   layout   every plate legal: >= 5 mm gaps (6 mm on support plates), inside the 170 mm bound, seated, rigid
//   sprue    when --sprue: frame inside bound, >= 1.20 mm frame-to-part air gap, single connected MST, 0 support parts
//   slice    when --slice: OrcaSlicer CLI (--slice 0) slices multi-plate kip-project.3mf cleanly (exit 0)
//   catalog  each catalog part's file matches a passing validation report (sha-256 + verdict; the full V1-V10 gate)
//   files    every mapped STL exists (a missing one fails, never skipped)
//   supports base body parts (kip.scad) that need supports sit on dedicated support plates and are flagged in 3MF
// Exit 1 on any layout violation, missing file or failing catalog verdict. A stale report (sha mismatch) is a warning
// unless --strict. Preset end states are read from the live demo in headless Chrome so the preset logic is not copied.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkPlacement, checkSprueCard, layoutJson, parseStl, planColorPlates, plateBound, plateStl, prepareItem, smallParts, to3mfProject,
} from "../parts/kip/viewer/kip-print.js";
import { resolveSceneBom } from "../parts/kip/viewer/kip-print-bom.js";
import { createDefaultProfile } from "../parts/kip/viewer/kip-print-profile.js";
import { launchChrome, startServer } from "./lib/kip-e2e.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const strict = flag("strict");
const sprueMode = flag("sprue");
const sliceGate = flag("slice");
const outDir = opt("out") ?? path.join(os.tmpdir(), "kip-plates");
const only = opt("preset")?.split(",");
mkdirSync(outDir, { recursive: true });

const ORCA_CANDIDATES = [
  process.env.ORCA_SLICER_BIN,
  "/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer",
  "orca-slicer",
].filter(Boolean);
const orcaBin = sliceGate
  ? ORCA_CANDIDATES.find((bin) => {
    try {
      if (bin.startsWith("/")) return existsSync(bin);
      execFileSync(bin, ["--help"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })
  : null;
if (sliceGate && !orcaBin) {
  console.error("kip:plate-check --slice: OrcaSlicer CLI binary not found (set ORCA_SLICER_BIN or install /Applications/OrcaSlicer.app).");
  process.exit(2);
}

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
  const tab = await chrome.open(`${server.base}/kip/Kip-Demo.html`);
  if (!(await tab.waitFor("window.__KIP_READY__ === true && !!window.kipPrint", 180000))) {
    throw new Error(`demo did not initialise: ${tab.exceptions[0] ?? "timeout"}`);
  }
  states = await tab.evaluate(`(() => {
    const c = window.kipMenu.ctx, out = {};
    for (const p of c.presets) {
      c.act.applyPreset(p.id);
      out[p.id] = window.kipPrint.getState();
    }
    return out; })()`);
  tab.close();
} finally { chrome.close(); server.close(); }

// ---- check each preset ------------------------------------------------------------------------
const profile = { ...createDefaultProfile(), flatPackMode: sprueMode ? "sprue" : "loose" };
const bound = plateBound(profile.bedXmm, profile.brimMarginMm, profile.bedYmm);
let failed = 0, warned = 0;
const rows = [];
for (const [id, state] of Object.entries(states)) {
  if (only && !only.includes(id)) continue;
  const bom = resolveSceneBom(state, { validationIndex: index });
  const problems = [], warnings = [];
  const prepared = [];
  for (const entry of bom.items) {
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
    prepared.push(prepareItem(entry, rec.tri, { verified, sha256: rec.sha }));
  }
  const plan = planColorPlates(prepared, profile);
  if (plan.oversize.length) problems.push(`too big for a plate: ${plan.oversize.join(", ")}`);
  let sprueCards = 0;
  plan.plates.forEach((pl, i) => {
    for (const v of checkPlacement(pl.placed, pl.boundMm, pl.gap)) problems.push(`plate ${i + 1} (${pl.fileStem}): ${v}`);
    if (pl.sprue) {
      sprueCards++;
      const cardParts = pl.placed.filter((p) => p.sprueAnchored);
      for (const sv of checkSprueCard(pl.sprue, cardParts)) problems.push(`plate ${i + 1} sprue (${pl.fileStem}): ${sv}`);
    }
    writeFileSync(path.join(outDir, `${id}_${pl.fileStem}.stl`), plateStl(pl, `kip-${id}-${i + 1}`, pl.sprue));
  });
  const projPath = path.join(outDir, `${id}_kip-project.3mf`);
  writeFileSync(projPath, to3mfProject(plan.plates, plan.profile, { title: `Kip ${id}` }));
  writeFileSync(path.join(outDir, `${id}_layout.json`), layoutJson(plan.plates, { preset: id, profile: plan.profile }));

  if (sliceGate && orcaBin) {
    const sliceDir = mkdtempSync(path.join(os.tmpdir(), `kip-orca-${id}-`));
    try {
      execFileSync(orcaBin, ["--slice", "0", "--outputdir", sliceDir, projPath], { stdio: "pipe" });
      const gcodes = readdirSync(sliceDir).filter((f) => f.endsWith(".gcode")).sort();
      if (gcodes.length !== plan.plates.length) {
        problems.push(`OrcaSlicer produced ${gcodes.length} gcode plate(s), expected ${plan.plates.length}`);
      }
      gcodes.forEach((gf, gIdx) => {
        if (!plan.plates[gIdx]?.requiresSupports) {
          const gtxt = readFileSync(path.join(sliceDir, gf), "utf8");
          const supLines = (gtxt.match(/; FEATURE: Support\b/g) ?? []).length;
          if (supLines > 0) problems.push(`OrcaSlicer emitted ${supLines} support feature(s) on support-free plate ${gIdx + 1} (${gf})`);
        }
      });
    } catch (e) {
      const msg = (e.stderr ? e.stderr.toString() : e.message).trim().split("\n").slice(-3).join(" | ");
      problems.push(`OrcaSlicer slice failed: ${msg}`);
    } finally {
      rmSync(sliceDir, { recursive: true, force: true });
    }
  }

  const tiers = {};
  let totalParts = 0;
  for (const pl of plan.plates) {
    for (const p of pl.placed) {
      totalParts++;
      tiers[p.tier] = (tiers[p.tier] ?? 0) + 1;
    }
  }
  const bad = problems.length > 0 || (strict && warnings.length > 0);
  if (bad) failed++;
  if (warnings.length) warned++;
  rows.push({
    id,
    parts: totalParts,
    plates: plan.plates.length,
    sprueCards,
    colours: plan.estimate.spools.length,
    grams: plan.estimate.totalGrams,
    tiers,
    unmapped: bom.unmapped.length,
    small: smallParts(plan.plates).length,
    problems,
    warnings,
    bad,
  });
}

console.log(`plate bound ${bound.mm} mm, layout=${profile.flatPackMode}${sliceGate ? " + OrcaSlicer --slice 0" : ""}, gap 5 mm (6 mm on support plates), plates written to ${outDir}\n`);
console.log(
  "preset".padEnd(9),
  "parts".padEnd(6),
  "plates".padEnd(7),
  ...(sprueMode ? ["cards".padEnd(6)] : []),
  "cols".padEnd(5),
  "~grams".padEnd(7),
  "support-free".padEnd(13),
  "unverified/geom".padEnd(16),
  "needs-supports".padEnd(15),
  "not-on-plate".padEnd(13),
  "result",
);
for (const r of rows) {
  const t = r.tiers;
  console.log(
    r.id.padEnd(9),
    String(r.parts).padEnd(6),
    String(r.plates).padEnd(7),
    ...(sprueMode ? [String(r.sprueCards).padEnd(6)] : []),
    String(r.colours).padEnd(5),
    `${r.grams}g`.padEnd(7),
    String(t["support-free"] ?? 0).padEnd(13),
    String((t.unverified ?? 0) + (t["geometry-checked"] ?? 0)).padEnd(16),
    String(t["needs-supports"] ?? 0).padEnd(15),
    String(r.unmapped).padEnd(13),
    r.bad ? "FAIL" : r.warnings.length ? "ok (warnings)" : "ok",
  );
  for (const p of r.problems) console.log(`    FAIL  ${p}`);
  for (const w of r.warnings) console.log(`    warn  ${w}`);
}
console.log(`\n${rows.length - failed}/${rows.length} presets pass${warned ? ` (${warned} with warnings; --strict makes warnings fail)` : ""}`);
console.log("unverified/geom = catalog parts with no matching validation report + non-catalog parts with no steep overhang (V4 only).");
console.log("Note: base body parts that need supports sit on dedicated support plates (>= 6 mm gap) with socket support_blocker protection.");
if (failed) process.exitCode = 1;
