#!/usr/bin/env node
// The Workshop inside the REAL game (Workshop stage 4d, docs/specs/workshop-spec.md "4d scope"): headless Chrome on the machine's GPU, the game on a phone-sized
// window, served by its own `vite dev` (the Cloudflare plugin and all) on a port of its own. Nothing is mocked.
//
// What it proves:
//   - the dock has a Workshop button, and opening it mounts the shell as a full-screen dialog with NO iframe;
//   - the entry import survives Vite (a failed load shows a retry, and Try again works);
//   - the world is PAUSED while the overlay is open (its WebGL canvas stops drawing, WASD no longer moves the toy) and resumes on close;
//   - NO DOWNLOADS: no Print group on either bench, no photo "Print it", no selfie sticker, no "Open on its own page" link;
//   - closing destroys the shell (no panel, no style, no stage canvas left), returns focus to the button, and it can be opened again;
//   - Escape closes the dialog only when none of the bench's own layers (menu drawer, Describe panel) is open, and never both at once;
//   - the world's music is faded out while it is open and brought back after (only counted when the music is running in that headless run);
//   - nothing throws.
// Run: E2E_GPU=metal node scripts/e2e-game-workshop.mjs     Overrides: E2E_PORT (default 5398).
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { createChecks, launchChrome } from "./lib/kip-e2e.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PORT = Number(process.env.E2E_PORT ?? 5398);
const BASE = `http://localhost:${PORT}`;
const SHOTS = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), "game-workshop-shots");
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { check, finish } = createChecks("game workshop e2e");

// Counts every WebGL draw call per canvas, from before the first page script, so "the world stopped drawing" is something that can be seen.
const INSTRUMENT = `(() => {
  const counts = new Map();
  for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!C) continue;
    for (const fn of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      const orig = C.prototype[fn];
      if (!orig) continue;
      C.prototype[fn] = function (...a) { counts.set(this.canvas, (counts.get(this.canvas) || 0) + 1); return orig.apply(this, a); };
    }
  }
  window.__fades = [];
  if (window.AudioParam) { const o = AudioParam.prototype.setTargetAtTime; AudioParam.prototype.setTargetAtTime = function (v, t, tc) { window.__fades.push([v, tc]); return o.call(this, v, t, tc); }; }
  window.__drawsOf = (sel) => { const c = document.querySelector(sel); return c ? (counts.get(c) || 0) : -1; };
})()`;

// E2E_NO_SERVER=1: use a dev server that is already running on E2E_PORT (the Cloudflare plugin makes a cold start slow).
const dev = process.env.E2E_NO_SERVER === "1" ? null : spawn("node", [path.join(ROOT, "node_modules/vite/bin/vite.js"), "--port", String(PORT), "--strictPort"], { cwd: ROOT, stdio: "ignore" });
let chrome;
try {
  for (let i = 0; i < 240; i++) {
    try { if ((await fetch(`${BASE}/`)).ok) break; } catch { /* not up yet */ }
    await sleep(500);
  }
  chrome = await launchChrome();
  const t = await chrome.open("about:blank", { width: 390, height: 844, mobile: true });
  await t.send("Page.addScriptToEvaluateOnNewDocument", { source: INSTRUMENT });
  await t.send("Network.enable");
  await t.send("Page.navigate", { url: `${BASE}/` });

  // ---- the game ----
  check("the game loads to its dock, with a Workshop button that opens a dialog", await t.waitFor(`!!document.querySelector('.tv-dock-right')`, 120000)
    && await t.evaluate(`(() => { const b = [...document.querySelectorAll('.tv-dock-right button')].find((x) => x.textContent.trim() === 'Workshop'); return !!b && b.getAttribute('aria-haspopup') === 'dialog' && b.getAttribute('aria-expanded') === 'false'; })()`));
  const button = `[...document.querySelectorAll('.tv-dock-right button')].find((x) => x.textContent.trim() === 'Workshop')`;
  const world = `'.tv-host canvas'`;
  const DLG = `[role=dialog][aria-label=Workshop]`; // the game has other role=dialog elements: ours is the one labelled Workshop
  const hold = async (key, code, vk, ms) => {
    await t.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk, text: key });
    await sleep(ms);
    await t.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk });
  };
  const toyAt = () => t.evaluate(`(() => { const p = window.__tvWorld?.P?.pos; return p ? [p.x, p.z] : null; })()`);
  const moved = (a, b) => !!a && !!b && Math.hypot(a[0] - b[0], a[1] - b[1]) > 0.05;
  const worldDraws = async (ms) => { const a = await t.evaluate(`window.__drawsOf(${world})`); await sleep(ms); return (await t.evaluate(`window.__drawsOf(${world})`)) - a; };

  // controls: the probes can tell a running world from a stopped one
  check("control: the world is drawing before the Workshop is opened", await t.waitFor(`window.__drawsOf(${world}) > 0`, 30000) && (await worldDraws(700)) > 0);
  const p0 = await toyAt();
  await hold("d", "KeyD", 68, 700);
  const p1 = await toyAt();
  check("control: holding D moves the toy while the world runs", moved(p0, p1), JSON.stringify([p0, p1]));

  const fadesNow = () => t.evaluate(`window.__fades.length`);
  const fadesSince = (n) => t.evaluate(`JSON.stringify(window.__fades.slice(${n}))`).then((j) => JSON.parse(j));

  // ---- a failed load: the overlay says so, the world is still paused, Try again recovers ----
  await t.send("Network.setBlockedURLs", { urls: ["*/kip/workshop.js*"] });
  await t.evaluate(`${button}.click(); 0`);
  check("with the shell unreachable the dialog says it could not open, and offers Try again", await t.waitFor(`!!document.querySelector('${DLG} [role=alert]')`, 30000)
    && await t.evaluate(`/could not open/i.test(document.querySelector('[role=alert]').textContent) && !!document.querySelector('[role=alert] button')`));
  await t.send("Network.setBlockedURLs", { urls: [] });
  await t.evaluate(`document.querySelector('[role=alert] button').click(); 0`);

  // ---- opened ----
  const fadeMark = await fadesNow();
  check("Try again loads the shell: a Kip bench with its menu panel appears", await t.waitFor(`!!document.querySelector('${DLG} .ws-root .kip-bench #kip-menu')`, 300000), "the Kip bench never showed its menu");
  const open = await t.evaluate(`(() => { const d = document.querySelector('${DLG}'); const r = d.getBoundingClientRect();
    return { modal: d.getAttribute('aria-modal'), full: Math.abs(r.width - innerWidth) < 1 && Math.abs(r.height - innerHeight) < 1, iframes: document.querySelectorAll('iframe').length,
      shells: document.querySelectorAll('.ws-root').length, tabs: [...document.querySelectorAll('.ws-tab')].map((x) => x.dataset.bench).join(), expanded: (${button}).getAttribute('aria-expanded'),
      inBody: d.parentElement === document.body }; })()`);
  check("it is one full-screen modal dialog straight under <body>, with the three benches as tabs and no iframe", open.modal === "true" && open.full && open.inBody && open.shells === 1 && open.tabs === "kip,truck,yard" && open.iframes === 0 && open.expanded === "true", JSON.stringify(open));
  await sleep(1500);
  await t.shot(path.join(SHOTS, "game-workshop-kip.png"));

  const opened = await fadesSince(fadeMark);
  const duck = opened.find(([v, tc]) => v === 0 && Math.abs(tc - 0.3) < 1e-9);
  if (duck) check("the world's music is faded out when the Workshop opens", true);
  else console.log("  note the world's music is not running in this headless run (no music bus), so the fade-out was not exercised");
  const musicRan = !!duck;

  // ---- the world stands still ----
  check("the world's canvas stops drawing while the Workshop is open, and the bench's does draw", (await worldDraws(900)) === 0
    && await t.evaluate(`(async () => { const a = window.__drawsOf('.ws-stage canvas'); await new Promise((r) => setTimeout(r, 600)); return window.__drawsOf('.ws-stage canvas') - a > 0; })()`));
  const q0 = await toyAt();
  await hold("d", "KeyD", 68, 700);
  const q1 = await toyAt();
  check("holding D no longer moves the toy under the dialog (the keys are the bench's)", !moved(q0, q1), JSON.stringify([q0, q1]));

  // ---- no downloads ----
  const noKip = await t.evaluate(`({ plateView: !!document.getElementById('km-plateView'), groups: [...document.querySelectorAll('#kip-menu .km-group')].map((g) => g.dataset.group).join(),
    photo: document.getElementById('btn-print-photo')?.hidden ?? 'missing', sticker: document.getElementById('sf-sticker')?.hidden ?? 'missing', pop: document.querySelector('.ws-pop')?.hidden ?? 'missing' })`);
  check("Kip tab: no Print group in the menu", noKip.plateView === false && /character/.test(noKip.groups) && !/print/.test(noKip.groups), JSON.stringify(noKip));
  check("Kip tab: the photo \"Print it\" button and the selfie sticker download are hidden (and they exist: not a check that cannot fail)", noKip.photo === true && noKip.sticker === true, JSON.stringify(noKip));
  check("the shell's \"Open on its own page\" link (the standalone page has downloads) is hidden", noKip.pop === true, JSON.stringify(noKip));
  await t.evaluate(`document.getElementById('ws-tab-truck').click(); 0`);
  check("Truck tab loads and the same panel shows the Truck's sections", await t.waitFor(`!!document.querySelector('.truck-bench #kip-menu') && document.querySelector('#kip-menu .km-title')?.textContent === 'Truck controls'`, 300000));
  const noTruck = await t.evaluate(`({ groups: [...document.querySelectorAll('#kip-menu .km-group')].map((g) => g.dataset.group).join(), plateView: !!document.getElementById('km-plateView') })`);
  check("Truck tab: Stage, Motion, Options, Driver and Camera, and no Print group", noTruck.groups === "stage,motion,options,driver,view" && noTruck.plateView === false, JSON.stringify(noTruck));
  await sleep(1200);
  await t.shot(path.join(SHOTS, "game-workshop-truck.png"));

  // ---- closed ----
  await t.evaluate(`[...document.querySelectorAll('${DLG} button')].find((b) => /Close/.test(b.textContent)).click(); 0`);
  check("Close removes the dialog and destroys the shell: no panel, no menu style, no stage canvas, one canvas left (the world's)", await t.waitFor(`!document.querySelector('${DLG}') && !document.querySelector('.ws-root') && !document.getElementById('kip-menu') && !document.getElementById('km-style') && document.querySelectorAll('canvas').length === 1`, 20000));
  if (musicRan) check("and the music is brought back to the player's own setting when it closes", (await fadesSince(fadeMark)).some(([v, tc]) => Math.abs(tc - 0.8) < 1e-9 && (v === 0.7 || v === 0)));
  check("focus goes back to the Workshop button", await t.evaluate(`document.activeElement === (${button}) && (${button}).getAttribute('aria-expanded') === 'false'`));
  check("the world draws again", (await worldDraws(900)) > 0);
  const r0 = await toyAt();
  await hold("d", "KeyD", 68, 700);
  const r1 = await toyAt();
  check("and D moves the toy again", moved(r0, r1), JSON.stringify([r0, r1]));

  // ---- opened a second time ----
  await t.evaluate(`${button}.click(); 0`);
  check("it opens a second time (a fresh mount)", await t.waitFor(`!!document.querySelector('${DLG} .kip-bench #kip-menu') && document.querySelectorAll('.ws-root').length === 1`, 300000));
  await t.evaluate(`[...document.querySelectorAll('${DLG} button')].find((b) => /Close/.test(b.textContent)).click(); 0`);
  check("and closes again, leaving the world running", await t.waitFor(`!document.querySelector('${DLG}') && !document.getElementById('kip-menu')`, 20000) && (await worldDraws(700)) > 0);
  // ---- Escape ----
  const esc = async () => { await t.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await t.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await sleep(400); };
  const dialogUp = () => t.evaluate(`!!document.querySelector('${DLG}')`);
  await t.evaluate(`${button}.click(); 0`);
  check("Escape: the Workshop is open again for the Escape checks", await t.waitFor(`!!document.querySelector('${DLG} .kip-bench #kip-menu') && !!document.querySelector('${DLG} .km-fab')`, 300000));
  await t.evaluate(`document.querySelector('${DLG} .km-fab').click(); 0`);
  check("Escape: the phone menu drawer opens", await t.waitFor(`!!document.querySelector('${DLG} .km--open')`, 10000));
  await esc();
  check("Escape with the menu drawer open closes the drawer and leaves the Workshop open (one key, one layer)", await dialogUp() && await t.evaluate(`!document.querySelector('${DLG} .km--open')`));
  await t.evaluate(`document.querySelector('${DLG} .kdb-toggle').click(); 0`);
  check("Escape: the Describe & build panel opens", await t.waitFor(`!!document.querySelector('${DLG} .kdb-panel:not([hidden])')`, 20000));
  await t.evaluate(`document.querySelector('${DLG} .kdb-toggle').focus(); 0`); // focus OUTSIDE the panel: its own Escape handler will not hear this key
  await esc();
  check("Escape with the Describe panel open and focus outside it does not close the Workshop", await dialogUp() && await t.evaluate(`!!document.querySelector('${DLG} .kdb-panel:not([hidden])')`));
  await t.evaluate(`document.querySelector('${DLG} .kdb-panel textarea, ${DLG} .kdb-panel input, ${DLG} .kdb-panel button').focus(); 0`); // focus INSIDE it
  await esc();
  check("Escape with focus inside the Describe panel closes the panel by its own handler, and not the Workshop (one key, one layer)", await dialogUp() && await t.waitFor(`!document.querySelector('${DLG} .kdb-panel:not([hidden])')`, 10000));
  await esc();
  check("Escape with nothing open closes the Workshop, returns focus to the button and the world runs again", await t.waitFor(`!document.querySelector('${DLG}') && document.activeElement === (${button})`, 20000) && (await worldDraws(700)) > 0);
  check("no uncaught exception anywhere in the run", t.exceptions.length === 0, t.exceptions.slice(0, 3).join(" || "));
  t.close();
} catch (err) {
  check("e2e ran to the end", false, String(err?.stack ?? err));
} finally {
  chrome?.close();
  dev?.kill("SIGTERM");
  console.log(`screenshots: ${SHOTS}`);
  finish();
}
