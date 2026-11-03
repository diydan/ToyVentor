#!/usr/bin/env node
// Bench lifecycle (Workshop stage 4a, docs/specs/workshop-spec.md): each bench module can be unmounted and mounted again in
// the same page, and unmounting gives everything back. Headless Chrome, the REAL pages and modules (nothing mocked).
// Run: npm run e2e:bench-lifecycle     Exits nonzero on any failing check.
//
// What it proves, per bench:
//   - the page is a loader: it mounts the module into #app and keeps the handle (window.kipBench / window.truckBench);
//   - dispose() leaves no window/document/media-query listener, no interval, no animation frame running, no canvas, no bench
//     root, no published handle (window.__KIP_READY__, kipMenu, ...), and no stray modal or panel from the shared UI modules;
//   - a second mount in the same page loads again, with the same listener count as the first mount (no growth, no leak);
//   - neither mount threw.
// The instrument runs before any page script (Page.addScriptToEvaluateOnNewDocument), so every listener is counted.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createChecks, launchChrome, startServer } from "./lib/kip-e2e.mjs";

const VIEWER = path.join(path.dirname(fileURLToPath(import.meta.url)), "../parts/kip/viewer");
const { check, finish } = createChecks("bench lifecycle e2e");
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

const BENCHES = [
  {
    id: "kip", page: "Kip-Demo.html", module: "kip-bench.js", mount: "mountKipBench", handle: "kipBench", ready: "__KIP_READY__", rootClass: "kip-bench", cssId: "kip-bench-css",
    published: ["__KIP_READY__", "kipMenu", "kipPrint", "kipRig", "kipClips", "kipDescribe", "kipSelfie"],
    strays: ["#modal-selfie", ".kdb-panel", ".kdb-toggle", ".km", ".km-fab"],
  },
  {
    id: "truck", page: "Truck-Mockup.html", module: "truck-bench.js", mount: "mountTruckBench", handle: "truckBench", ready: "__TRUCK_READY__", rootClass: "truck-bench", cssId: "truck-bench-css",
    published: ["__TRUCK_READY__", "__truckProbe", "__truckProbeSweep", "truckPrint", "truckMenu", "truckState"],
    strays: [".km", ".km-fab", ".km-backdrop", "#km-style"], // the Truck's controls are the shared menu since stage 4c
  },
  {
    id: "yard", page: "Yard-Bench.html", module: "yard-bench.js", mount: "mountYardBench", handle: "yardBench", ready: "__YARD_READY__", rootClass: "yard-bench", cssId: "yard-bench-css",
    published: ["__YARD_READY__", "__yardProbe", "__yardDrive"],
    strays: [],
  },
].filter((b) => fs.existsSync(path.join(VIEWER, b.module)));

// Counts what a leaking page leaves behind. Only window, document and MediaQueryList listeners are tracked: they outlive the bench's DOM.
const INSTRUMENT = `(() => {
  const live = new Map();   // key -> count
  const key = (t, type, fn, cap) => (t === window ? 'window' : t === document ? 'document' : 'mql') + ':' + type;
  const tracked = (t) => t === window || t === document || (typeof MediaQueryList !== 'undefined' && t instanceof MediaQueryList);
  const ids = new WeakMap(); let nid = 0;
  const idOf = (o) => { if (!ids.has(o)) ids.set(o, ++nid); return ids.get(o); };
  const entries = new Set();
  const sig = (t, type, fn, opts) => { const cap = typeof opts === 'boolean' ? opts : !!(opts && opts.capture); return [t === window ? 'w' : t === document ? 'd' : 'm' + idOf(t), type, idOf(fn), cap].join('|'); };
  for (const proto of [EventTarget.prototype]) {
    const add = proto.addEventListener, rem = proto.removeEventListener;
    proto.addEventListener = function (type, fn, opts) { if (tracked(this) && fn) entries.add(sig(this, type, fn, opts)); return add.call(this, type, fn, opts); };
    proto.removeEventListener = function (type, fn, opts) { if (tracked(this) && fn) entries.delete(sig(this, type, fn, opts)); return rem.call(this, type, fn, opts); };
  }
  const intervals = new Set();
  const si = window.setInterval, ci = window.clearInterval;
  window.setInterval = function (...a) { const id = si.apply(window, a); intervals.add(id); return id; };
  window.clearInterval = function (id) { intervals.delete(id); return ci.call(window, id); };
  let rafCalls = 0;
  const raf = window.requestAnimationFrame;
  window.requestAnimationFrame = function (cb) { rafCalls++; return raf.call(window, cb); };
  window.__live = () => ({ listeners: [...entries].map((e) => e.split('|').slice(0, 2).join(':').replace(/^m\\d+:/, 'mql:')).sort(), intervals: intervals.size, rafCalls });
})();`;

const server = await startServer();
const chrome = await launchChrome();
try {
  for (const b of BENCHES) {
    console.log(`\n${b.id}: ${b.page}`);
    const t = await chrome.open("about:blank");
    await t.send("Page.addScriptToEvaluateOnNewDocument", { source: INSTRUMENT });
    await t.send("Page.navigate", { url: `${server.base}/kip/${b.page}` });

    check(`${b.id}: the loader mounts the bench and keeps its handle`, await t.waitFor(`typeof window.${b.handle}?.dispose === 'function'`, 60000));
    check(`${b.id}: first mount finishes loading`, await t.waitFor(`window.${b.ready} === true`, 240000), `never reached ${b.ready}`);
    await settle(800);
    const mounted = await t.evaluate(`({
      roots: document.querySelectorAll('.${b.rootClass}').length,
      canvases: document.querySelectorAll('canvas').length,
      styles: document.querySelectorAll('#${b.cssId}').length,
      handleRoot: window.${b.handle}.root === document.querySelector('.${b.rootClass}'),
      live: window.__live(),
    })`);
    check(`${b.id}: one bench root, one stylesheet, the handle points at the root`, mounted.roots === 1 && mounted.styles === 1 && mounted.handleRoot, JSON.stringify(mounted));
    check(`${b.id}: the mounted bench holds window/document listeners (so the leak check below can fail)`, mounted.live.listeners.length >= 2, JSON.stringify(mounted.live.listeners));

    // ---- dispose ----
    await t.evaluate(`window.${b.handle}.dispose()`);
    const raf0 = (await t.evaluate("window.__live().rafCalls"));
    await settle(700);
    const gone = await t.evaluate(`({
      live: window.__live(),
      roots: document.querySelectorAll('.${b.rootClass}').length,
      canvases: document.querySelectorAll('canvas').length,
      styles: document.querySelectorAll('#${b.cssId}').length,
      published: ${JSON.stringify(b.published)}.filter((k) => window[k] !== undefined),
      strays: ${JSON.stringify(b.strays)}.filter((s) => document.querySelector(s)),
      bodyKids: document.body.children.length,
    })`);
    check(`${b.id}: dispose removes the bench root, canvas and stylesheet`, gone.roots === 0 && gone.canvases === 0 && gone.styles === 0, JSON.stringify(gone));
    check(`${b.id}: dispose leaves no window/document/media-query listener`, gone.live.listeners.length === 0, JSON.stringify(gone.live.listeners));
    check(`${b.id}: dispose leaves no interval running`, gone.live.intervals === 0, String(gone.live.intervals));
    check(`${b.id}: no animation frame is requested after dispose`, gone.live.rafCalls <= raf0 + 1, `${raf0} -> ${gone.live.rafCalls}`);
    check(`${b.id}: published handles are gone (${b.published.join(", ")})`, gone.published.length === 0, JSON.stringify(gone.published));
    check(`${b.id}: no panel, modal or button left behind by the shared UI modules`, gone.strays.length === 0, JSON.stringify(gone.strays));
    check(`${b.id}: dispose is safe to call twice`, await t.evaluate(`(() => { try { window.${b.handle}.dispose(); return true; } catch (e) { return String(e); } })()`) === true);

    // ---- mount again in the same page ----
    await t.evaluate(`import('/kip/${b.module}').then((m) => { window.${b.handle}2 = m.${b.mount}(document.getElementById('app')); })`);
    check(`${b.id}: a second mount loads again in the same page`, await t.waitFor(`window.${b.ready} === true`, 240000), `never reached ${b.ready} on the second mount`);
    await settle(800);
    const again = await t.evaluate(`({
      roots: document.querySelectorAll('.${b.rootClass}').length,
      canvases: document.querySelectorAll('canvas').length,
      live: window.__live(),
    })`);
    check(`${b.id}: second mount has one root and one canvas`, again.roots === 1 && again.canvases >= 1, JSON.stringify(again));
    check(`${b.id}: second mount holds the same listeners as the first (no growth)`, JSON.stringify(again.live.listeners) === JSON.stringify(mounted.live.listeners),
      `first ${mounted.live.listeners.length}, second ${again.live.listeners.length}`);
    await t.evaluate(`window.${b.handle}2.dispose()`);
    await settle(300);
    const end = await t.evaluate("window.__live()");
    check(`${b.id}: and the second dispose leaves nothing either`, end.listeners.length === 0 && end.intervals === 0, JSON.stringify(end));
    check(`${b.id}: no uncaught exception across mount, dispose, mount, dispose`, t.exceptions.length === 0, t.exceptions.join(" | ").slice(0, 400));
    t.close();
  }
} finally {
  chrome.close();
  server.close?.();
}
finish();
process.exit(process.exitCode ?? 0);
