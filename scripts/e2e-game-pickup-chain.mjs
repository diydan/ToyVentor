#!/usr/bin/env node
// The whole chain, in the REAL game: Workshop button, the Kip bench inside the overlay, Tools > Pick it up, the camera view, the cut-out, and then the GAME's Kip holding it after the
// overlay closes. scripts/e2e-kip-pickup.mjs checks the bench alone and scripts/e2e-game-pickup.mjs checks the game side with an event dispatched from the page; this is the one that proves
// the two meet (the bench's event reaching the game's listener across the Workshop shell).
// Run: npx tsx scripts/e2e-game-pickup-chain.mjs     Needs the machine's GPU. Overrides: E2E_PORT (default 5463), E2E_NO_SERVER=1 (use a `vite dev` already on that port), E2E_SHOTS.
//
// What is real: the game (its own `vite dev`), the Workshop shell and the Kip bench inside it, the camera view, the print panel and its bundled flow, getUserMedia, the household library.
// What is stood in: /api/scan only (the page's fetch answers it: the outline of the real steel spoon, and a name), and the camera, which shows the drawn spoon at the size the outline was
// traced on (so the cut-out lands on the spoon). Nothing else is mocked, and no photo and no key leave the machine.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";

process.env.E2E_GPU ??= "metal";
const { createChecks, launchChrome } = await import("./lib/kip-e2e.mjs");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const PORT = Number(process.env.E2E_PORT ?? 5463);
const BASE = `http://localhost:${PORT}`;
const SHOTS = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), "game-pickup-chain-shots");
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { check, finish } = createChecks("game pick-up chain e2e");

globalThis.__dirname = path.join(HERE, "../tests/fixtures");
const { realSpoon } = await import("../tests/fixtures/realCupMask.ts");
const { scanOutline } = await import("../shared/outlineScan.ts");

function pngOf(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body)); return Buffer.concat([len, body, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const PW = 288, PH = 512;
const spoon = await realSpoon();
const rgba = Buffer.alloc(PW * PH * 4);
for (let y = 0; y < PH; y++) {
  for (let x = 0; x < PW; x++) {
    const mx = x - spoon.bounds.left, my = y - spoon.bounds.top;
    const on = mx >= 0 && my >= 0 && mx < spoon.raster.width && my < spoon.raster.height && spoon.raster.data[my * spoon.raster.width + mx];
    const c = on ? [150 + 60 * Math.sin(x / 11), 156 + 50 * Math.sin(x / 11), 166 + 50 * Math.sin(x / 11)] : [196 + 8 * Math.sin(y / 5), 152 + 8 * Math.sin(y / 5), 104 + 8 * Math.sin(y / 5)];
    rgba.set([...c.map((v) => Math.max(0, Math.min(255, Math.round(v)))), 255], (y * PW + x) * 4);
  }
}
const SPOON_PNG_B64 = pngOf(PW, PH, rgba).toString("base64");
const realScan = scanOutline(spoon.raster, spoon.bounds, { width: PW, height: PH }, { targetHeightMm: 54 });
if (!realScan.ok) throw new Error("the real spoon has no outline");
const SCAN_REPLY = { toy: null, sam: { configured: true, applied: true, matches: 1, outline: { ...realScan, fidelity: 0.97, warnings: [] } } };

// In the page before anything else runs: answer /api/scan, and make the camera the drawn spoon.
const INIT = `(() => {
  const SCAN = ${JSON.stringify(SCAN_REPLY)};
  const realFetch = window.fetch.bind(window);
  window.__scanBodies = [];
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (/\\/api\\/scan$/.test(url) && init && init.method === 'POST') {
      const body = JSON.parse(init.body);
      window.__scanBodies.push(Object.keys(body));
      const json = body.nameIt ? { ok: true, configured: true, checked: true, names: ['spoon'] } : SCAN;
      return Promise.resolve(new Response(JSON.stringify(json), { status: 200, headers: { 'content-type': 'application/json' } }));
    }
    return realFetch(input, init);
  };
  const img = new Image();
  const ready = new Promise((res) => { img.onload = res; });
  img.src = 'data:image/png;base64,${SPOON_PNG_B64}';
  navigator.mediaDevices.getUserMedia = async () => {
    await ready;
    const c = document.createElement('canvas'); c.width = ${PW}; c.height = ${PH};
    const x = c.getContext('2d');
    const draw = () => { x.drawImage(img, 0, 0); window.__camRaf = requestAnimationFrame(draw); };
    draw();
    return c.captureStream(15);
  };
  window.__pickEvents = [];
  window.addEventListener('tv:kip-picked-up', (e) => window.__pickEvents.push({ kind: e.detail.kind, id: e.detail.id, word: e.detail.word, named: e.detail.named, hasCutout: !!e.detail.cutout }));
})()`;

const dev = process.env.E2E_NO_SERVER === "1" ? null : spawn("node", [path.join(ROOT, "node_modules/vite/bin/vite.js"), "--port", String(PORT), "--strictPort"], { cwd: ROOT, stdio: "ignore" });
let chrome;
let t;
try {
  for (let i = 0; i < 240; i++) {
    try { if ((await fetch(`${BASE}/`)).ok) break; } catch { /* not up yet */ }
    await sleep(500);
  }
  chrome = await launchChrome();
  t = await chrome.open("about:blank", { width: 390, height: 844, mobile: true });
  await t.send("Page.addScriptToEvaluateOnNewDocument", { source: INIT });
  await t.send("Network.enable");
  await t.send("Page.navigate", { url: `${BASE}/?title=0` });
  const ev = (expr) => t.evaluate(expr);
  const DLG = `[role=dialog][aria-label=Workshop]`;
  const workshopButton = `[...document.querySelectorAll('.tv-dock-right button')].find((x) => x.textContent.trim() === 'Workshop')`;
  const pk = () => ev("window.__tvWorld.pick.state");

  check("the game loads with its Workshop button and the pick-up holder", await t.waitFor(`!!document.querySelector('.tv-dock-right') && !!window.__tvWorld && !!window.__tvWorld.pick`, 180000, 1000));
  check("nothing is held yet", (await pk()).wanted === null && (await pk()).onKip === false);

  const openWorkshop = async () => {
    await ev(`${workshopButton}.click(); 0`);
    return t.waitFor(`!!document.querySelector('${DLG} .ws-root .kip-bench #kip-menu')`, 300000, 1000);
  };
  const pressMenu = (text) => ev(`(() => { const b = [...document.querySelectorAll('${DLG} #kip-menu button')].find((x) => x.textContent.includes(${JSON.stringify(text)})); if (!b) return false; b.click(); return true; })()`);
  const press = (sel) => ev(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b || b.hidden || b.disabled) return false; b.click(); return true; })()`);
  const closeWorkshop = () => ev(`[...document.querySelectorAll('${DLG} button')].find((b) => /Close/.test(b.textContent)).click(); 0`);

  // 1. no word: the helper names it, the cut-out flies, and the game's Kip has it when the overlay closes ---------------------------------------------------------
  check("the Workshop opens with the Kip bench inside the game", await openWorkshop());
  check("Tools has Pick it up, and it opens the camera view inside the Workshop dialog", (await pressMenu("Pick it up")) && await t.waitFor(`!!document.querySelector('${DLG} .kpu-back.open')`, 20000) && await t.waitFor("document.querySelector('.kpu-video') && document.querySelector('.kpu-video').videoWidth > 0", 20000));
  await t.shot(path.join(SHOTS, "chain-1-camera.png"));
  await press(".kpu-shutter");
  check("the view hands over: Kip picks it up and the camera view closes", await t.waitFor(`!document.querySelector('.kpu-back.open')`, 60000));
  check("the helper named it first (nameIt, then a scan)", JSON.stringify(await ev("window.__scanBodies")) === JSON.stringify([["nameIt"], ["scan"]]), JSON.stringify(await ev("window.__scanBodies")));
  check("the bench told the page once: the household spoon, named, with a cut-out", await ev("window.__pickEvents.length === 1 && window.__pickEvents[0].kind === 'library' && window.__pickEvents[0].word === 'spoon' && window.__pickEvents[0].named === true && window.__pickEvents[0].hasCutout"), JSON.stringify(await ev("window.__pickEvents")));
  const s1 = await pk();
  check("the game heard it at once, with the overlay still open (the world is paused)", !!s1.wanted && /spoon/i.test(s1.wanted.label || "") && s1.wanted.card === true, JSON.stringify(s1));
  await t.shot(path.join(SHOTS, "chain-2-bench-holds.png"));
  await closeWorkshop();
  check("closing the Workshop returns to the world", await t.waitFor(`!document.querySelector('${DLG}')`, 20000));
  check("the game's Kip is holding the spoon card, in his hand", await t.waitFor("window.__tvWorld.pick.state.onKip === true", 20000), JSON.stringify(await pk()));
  await sleep(800);
  await t.shot(path.join(SHOTS, "chain-3-game-holds-spoon.png"));
  check("a chip offers to put it away", (await pk()).chipShowing === true);
  await ev("(() => { const b = [...document.querySelectorAll('button')].find((x) => /away/i.test(x.textContent)); if (b) b.click(); })()");
  check("putting it away leaves nothing held", await t.waitFor("window.__tvWorld.pick.state.wanted === null && window.__tvWorld.pick.state.onKip === false", 10000), JSON.stringify(await pk()));

  // 2. a guitar: the bench takes its own guitar, and the game uses the game's own guitar --------------------------------------------------------------------------
  check("the Workshop opens again after being closed", await openWorkshop());
  await pressMenu("Pick it up");
  await t.waitFor("document.querySelector('.kpu-video') && document.querySelector('.kpu-video').videoWidth > 0", 20000);
  await press(`.kpu-chips button[data-word="guitar"]`);
  await press(".kpu-shutter");
  check("a guitar is picked up through the bench", await t.waitFor(`!document.querySelector('.kpu-back.open')`, 60000) && (await ev("window.__pickEvents.length")) === 2 && (await ev("window.__pickEvents[1].kind === 'workshop' && window.__pickEvents[1].id === 'guitar'")));
  await closeWorkshop();
  await t.waitFor(`!document.querySelector('${DLG}')`, 20000);
  check("the game's Kip holds the game's own guitar", await t.waitFor("window.__tvWorld.pick.state.onKip === true && window.__tvWorld.pick.state.wanted && window.__tvWorld.pick.state.wanted.item === 'guitar'", 20000), JSON.stringify(await pk()));
  await sleep(800);
  await t.shot(path.join(SHOTS, "chain-4-game-holds-guitar.png"));

  // 3. what left the page ----------------------------------------------------------------------------------------------------------------------------------------
  check("only /api/scan was asked for a picture: three calls in all (a name, a scan, a scan)", JSON.stringify(await ev("window.__scanBodies")) === JSON.stringify([["nameIt"], ["scan"], ["scan"]]), JSON.stringify(await ev("window.__scanBodies")));
  check("the page threw no exceptions", t.exceptions.length === 0, t.exceptions.join(" | ").slice(0, 500));
} finally {
  try { t?.close(); } catch { /* gone */ }
  chrome?.close();
  try { dev?.kill("SIGTERM"); } catch { /* gone */ }
}
finish();
console.log(`screenshots: ${SHOTS}`);
