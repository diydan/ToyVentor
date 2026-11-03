#!/usr/bin/env node
// "Does a deploy built from git actually load?" (docs/product/deploy-checklist.md). The app serves public/ straight from git with no build step for /kip/, so a file
// that exists on disk but is gitignored works on a dev machine and 404s in production. This loads every bench from a CLEAN EXPORT of the commit and lists every
// same-origin request that is not a 200: public/kip is served exactly as a deploy would serve it (no overlay from parts/kip/viewer) and a missing STL fails
// instead of being replaced by a stand-in.
//
//   E=$(mktemp -d) && git archive HEAD | tar -x -C "$E" && ln -s "$PWD/node_modules" "$E/node_modules"
//   E2E_GPU=metal node scripts/check-clean-export.mjs "$E"
//
// Exits nonzero when a page does not become ready or any request is not a 200. Pages: the Kip, Truck (pro and mech) and Yard benches in the Workshop shell, and the
// standalone Truck-Mockup page. (The game's own bundle is checked by building the export: `cd "$E" && npm run build`.)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const exportDir = path.resolve(process.argv[2] ?? "");
if (!process.argv[2] || !fs.existsSync(path.join(exportDir, "scripts/lib/kip-e2e.mjs"))) {
  console.error("usage: node scripts/check-clean-export.mjs <a clean export of the commit, made with git archive>");
  process.exit(2);
}
// The harness reads these when it is imported: no source overlay (an empty folder), no stand-ins for missing STLs.
process.env.E2E_STRICT_STL = "1";
process.env.E2E_VIEWER = fs.mkdtempSync(path.join(os.tmpdir(), "empty-viewer-"));
const { startServer, launchChrome } = await import(path.join(exportDir, "scripts/lib/kip-e2e.mjs"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = "window.workshop";
const pages = [
  ["Workshop: Kip", "/kip/Workshop.html?bench=kip", `${W}?.handles('kip')?.__KIP_READY__ === true`],
  ["Workshop: Truck (pro)", "/kip/Workshop.html?bench=truck", `${W}?.handles('truck')?.__TRUCK_READY__ === true`],
  ["Workshop: Truck (mech)", "/kip/Workshop.html?bench=truck&stage=mech", `${W}?.handles('truck')?.__TRUCK_READY__ === true`],
  ["Workshop: Yard", "/kip/Workshop.html?bench=yard", `${W}?.handles('yard')?.__YARD_READY__ === true`],
  ["Truck-Mockup (pro)", "/kip/Truck-Mockup.html?stage=pro&ui=0", "window.__TRUCK_READY__ === true"],
  ["Truck-Mockup (mech)", "/kip/Truck-Mockup.html?stage=mech&ui=0", "window.__TRUCK_READY__ === true"],
];
const READY_MS = Number(process.env.READY_MS ?? 120000);

const server = await startServer();
const chrome = await launchChrome();
const bad = new Map();
let notReady = 0;
try {
  for (const [name, url, ready] of pages) {
    const t = await chrome.open(server.base + url, { width: 900, height: 600 });
    const ok = await t.waitFor(ready, READY_MS);
    await sleep(2500);
    const urls = [...new Set(t.requests.map((r) => r.url).filter((u) => u.startsWith(server.base)))];
    let failing = 0;
    for (const u of urls) {
      const p = new URL(u).pathname;
      if (p.startsWith("/api/")) continue; // the Worker answers these, not the static files
      const r = await fetch(u);
      await r.arrayBuffer().catch(() => {});
      if (r.status !== 200 && r.status !== 204) { bad.set(p, r.status); failing++; }
    }
    if (!ok) notReady++;
    console.log(`${ok ? "ok       " : "NOT READY"} ${name}  (${urls.length} requests, ${failing} not 200)`);
    try { await t.send("Page.close"); } catch { /* already gone */ }
    t.close();
  }
} finally {
  chrome.close();
  server.close();
}
if (bad.size) console.log(`\nNot 200 (${bad.size}):\n${[...bad].sort().map(([p, s]) => `  ${s} ${p}`).join("\n")}`);
console.log(`\n${notReady === 0 && bad.size === 0 ? "clean export loads: every bench ready, no missing file" : `PROBLEM: ${notReady} page(s) not ready, ${bad.size} file(s) not 200`}`);
process.exitCode = notReady === 0 && bad.size === 0 ? 0 : 1;
