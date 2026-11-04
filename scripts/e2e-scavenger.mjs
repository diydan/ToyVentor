#!/usr/bin/env node
// "Find a Wheel!" in the REAL game at 844 x 390: the Toy Box's chore rows, the scavenger camera, the helper's name for the photo, a miss (warm, nothing paid), a find (the chore
// pays once, the outline glows over the frozen picture, the 3D part opens for the phone's AR viewer), and what left the page. Needs the machine's GPU.
// Run: npx tsx scripts/e2e-scavenger.mjs     Overrides: E2E_PORT (default 5473), E2E_NO_SERVER=1, E2E_SHOTS, E2E_W / E2E_H.
//
// What is real: the game (its own `vite dev`), the Toy Box, the camera view, getUserMedia, model-viewer and the part's GLB. What is stood in: /api/scan only (the page's fetch answers
// it: a name list the test sets, and the outline of the real steel spoon), and the camera, which shows a drawn picture. No photo and no key leave the machine.
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
const PORT = Number(process.env.E2E_PORT ?? 5473);
const BASE = `http://localhost:${PORT}`;
const SHOTS = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), "scavenger-shots");
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { check, finish } = createChecks("scavenger e2e");

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


// In the page before anything else runs: a game with the wheel and gear chores switched on, a fetch that answers /api/scan, and a camera that shows a drawn picture.
const PROG = { version: 1, totalXp: 0, missionStars: {}, daily: {}, unlockedIds: [], sandboxUnlockAll: true, ageBand: 3, enabledChoreIds: ["scavenge-wheel", "scavenge-gear", "tidy-bench"] };
const INIT = `(() => {
  try { if (!sessionStorage.getItem("__seeded")) { sessionStorage.setItem("__seeded", "1"); localStorage.clear(); localStorage.setItem("toyforge:progression:v1", ${JSON.stringify(JSON.stringify(PROG))}); localStorage.setItem("tvTimeOfDay:v1", "day"); } } catch (e) {}
  const SCAN = ${JSON.stringify(SCAN_REPLY)};
  window.__names = ['toy car'];
  window.__scanBodies = [];
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (/\\/api\\/scan$/.test(url) && init && init.method === 'POST') {
      const body = JSON.parse(init.body);
      window.__scanBodies.push(Object.keys(body).concat(body.scan ? ['prompt=' + body.scan.prompt] : []));
      const json = body.nameIt ? { ok: true, configured: true, checked: true, names: window.__names } : SCAN;
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
  t = await chrome.open("about:blank", { width: Number(process.env.E2E_W ?? 844), height: Number(process.env.E2E_H ?? 390), mobile: true });
  await t.send("Page.addScriptToEvaluateOnNewDocument", { source: INIT });
  await t.send("Network.enable");
  await t.send("Page.navigate", { url: `${BASE}/?title=0` });
  const ev = (expr) => t.evaluate(expr);
  const prog = () => ev(`JSON.parse(localStorage.getItem("toyforge:progression:v1") || "{}")`);
  const wheelRow = `[...document.querySelectorAll('.tv-quest-card')].find((c) => /Find a Wheel/.test(c.textContent))`;
  const press = (sel) => ev(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b || b.hidden || b.disabled) return false; b.click(); return true; })()`);
  const pressText = (sel, text) => ev(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.textContent.includes(${JSON.stringify(text)})); if (!b || b.disabled) return false; b.click(); return true; })()`);

  check("the game loads", await t.waitFor(`!!document.querySelector('.tv-kip-fab') && !!window.__tvWorld`, 180000, 1000));
  await ev(`document.querySelector('.tv-kip-fab').click(); 0`);
  await sleep(400);
  await ev(`document.querySelector('.tv-toy-pill').click(); 0`);
  check("the Toy Box lists the enabled chores", await t.waitFor(`document.querySelectorAll('.tv-quest-card').length >= 3`, 20000));
  check("the wheel and gear chores have a camera button; the tidy chore keeps its tap", await ev(`(() => { const row = (n) => [...document.querySelectorAll('.tv-quest-card')].find((c) => c.textContent.includes(n)); const w = row('Find a Wheel'), g = row('Find a Gear'), tdy = row('Tidy'); return !!w && /Find it/.test(w.textContent) && !/I did it/.test(w.textContent) && !!g && /Find it/.test(g.textContent) && !!tdy && /I did it/.test(tdy.textContent) && !/Find it/.test(tdy.textContent); })()`));
  check("the lever chore is not listed (a grown-up has not switched it on)", await ev(`![...document.querySelectorAll('.tv-quest-card')].some((c) => /Find a Lever/.test(c.textContent))`));
  await t.shot(path.join(SHOTS, "s1-toy-box-chores.png"));

  // 1. a miss: it is a cup. Warm words, nothing paid, the camera is let go --------------------------------------------------------------------------------
  await ev(`window.__names = ['cup', 'mug']`);
  await ev(`(${wheelRow}).querySelector('button').click(); 0`);
  check("the camera view opens over the game with the quest's hint and the one privacy sentence", await t.waitFor(`!!document.querySelector('.tv-scav .tv-scav-shutter:not([disabled])')`, 20000) && await ev(`(() => { const s = document.querySelector('.tv-scav'); return /Find a Wheel/.test(s.textContent) && /wheel goes round/i.test(s.textContent) && /We check the photo, then we throw away our copy\\. We only keep the count\\./.test(s.textContent); })()`));
  check("it makes no claim about anyone else deleting the photo", await ev(`!/provider|Meta|deleted by|never stored|private forever/i.test(document.querySelector('.tv-scav').textContent)`));
  check("the view covers the screen", await ev(`(() => { const r = document.querySelector('.tv-scav').getBoundingClientRect(); return r.width === innerWidth && r.height === innerHeight; })()`));
  await t.waitFor(`document.querySelector('.tv-scav-video').videoWidth > 0`, 10000, 100);
  await t.shot(path.join(SHOTS, "s2-camera-live.png"));
  await press(".tv-scav-shutter");
  check("pressing the shutter lets the camera go at once", await t.waitFor(`[...document.querySelectorAll('video')].every((v) => !v.srcObject)`, 5000));
  check("a cup is a warm miss that says what it saw", await t.waitFor(`!!document.querySelector('.tv-scav-say-miss')`, 20000) && await ev(`/I can see a cup/.test(document.querySelector('.tv-scav-say').textContent) && !/wrong|fail|bad/i.test(document.querySelector('.tv-scav-say').textContent)`));
  const p1 = await prog();
  check("nothing was paid for a miss", !JSON.stringify(p1.completedChoresByDay ?? {}).includes("scavenge-wheel") && (p1.totalXp ?? 0) === 0, JSON.stringify(p1.completedChoresByDay ?? {}));
  await t.shot(path.join(SHOTS, "s3-miss.png"));

  // 2. try again: a toy car is a wheel ---------------------------------------------------------------------------------------------------------------------
  await ev(`window.__names = ['toy car']`);
  check("Try something else starts the camera again", (await pressText(".tv-scav-btn", "Try something else")) && await t.waitFor(`!!document.querySelector('.tv-scav .tv-scav-shutter:not([disabled])')`, 20000));
  await t.waitFor(`document.querySelector('.tv-scav-video').videoWidth > 0`, 10000, 100);
  await press(".tv-scav-shutter");
  check("a toy car is a find: the words say so and the XP", await t.waitFor(`!!document.querySelector('.tv-scav-say-found')`, 20000) && await ev(`(() => { const s = document.querySelector('.tv-scav-say').textContent; return /That is a toy car: a wheel/.test(s) && /\\+25 XP/.test(s); })()`));
  const p2 = await prog();
  check("the chore was paid once: +25 XP and the wheel chore is done today", (p2.totalXp ?? 0) === 25 && JSON.stringify(p2.completedChoresByDay ?? {}).includes("scavenge-wheel"), `${p2.totalXp} ${JSON.stringify(p2.completedChoresByDay ?? {})}`);
  check("the object's outline glows over the frozen picture", await t.waitFor(`!!document.querySelector('.tv-scav-glow polygon') && document.querySelector('.tv-scav-glow polygon').getAttribute('points').split(' ').length > 10`, 20000));
  await sleep(500);
  await t.shot(path.join(SHOTS, "s4-found-glow.png"));

  // 3. the part in the room (the phone's own AR viewer) ------------------------------------------------------------------------------------------------------
  check("a wheel can be shown as a 3D part for the phone's AR viewer", (await pressText(".tv-scav-btn", "in your room")) && await t.waitFor(`!!document.querySelector('.tv-scav-ar model-viewer')`, 20000));
  check("the viewer asks for AR, with the phone's own viewers, and loads a part that ships", await ev(`(() => { const m = document.querySelector('.tv-scav-ar model-viewer'); return (m.ar === true || m.hasAttribute('ar')) && /scene-viewer/.test(m.getAttribute('ar-modes')) && /\\/parts-glb\\/veh-wheel-sport\\.glb$/.test(m.src || m.getAttribute('src') || ''); })()`) && await t.waitFor(`!!customElements.get('model-viewer')`, 30000), await ev(`(() => { const m = document.querySelector('.tv-scav-ar model-viewer'); return m ? [...m.attributes].map((a) => a.name + '=' + a.value).join(' ') : 'none'; })()`));
  await sleep(2500);
  await t.shot(path.join(SHOTS, "s5-ar-panel.png"));
  check("the AR panel says what to expect on a phone that cannot do AR", await ev(`/If your phone can do AR/.test(document.querySelector('.tv-scav-ar').textContent)`));

  // 4. done: the chore is ticked, the camera button is gone for it ---------------------------------------------------------------------------------------------
  check("Done closes the camera and the Toy Box shows the chore done", (await pressText(".tv-scav-btn", "Done")) && await t.waitFor(`!document.querySelector('.tv-scav')`, 10000) && await ev(`(() => { const w = ${wheelRow}; return !!w && w.classList.contains('tv-quest-card-done') && !/Find it/.test(w.textContent); })()`));
  check("the gear chore still has its camera button", await ev(`/Find it/.test([...document.querySelectorAll('.tv-quest-card')].find((c) => /Find a Gear/.test(c.textContent)).textContent)`));
  await t.shot(path.join(SHOTS, "s6-chore-done.png"));

  // 5. what left the page ------------------------------------------------------------------------------------------------------------------------------------------
  const bodies = JSON.stringify(await ev("window.__scanBodies"));
  check("only /api/scan was asked: a name for the cup, a name for the toy car, then the toy car's outline", bodies === JSON.stringify([["nameIt"], ["nameIt"], ["scan", "prompt=toy car"]]), bodies);
  check("no picture was kept: nothing in local storage holds an image (the toy's own drawn portrait is not a photo)", await ev(`Object.keys(localStorage).filter((k) => !k.startsWith('tvToyPortrait')).every((k) => !String(localStorage.getItem(k)).includes('data:image'))`), await ev(`JSON.stringify(Object.keys(localStorage).filter((k) => String(localStorage.getItem(k)).includes('data:image')))`));
  check("the page threw no exceptions", t.exceptions.length === 0, t.exceptions.join(" | ").slice(0, 500));
} finally {
  try { t?.close(); } catch { /* gone */ }
  chrome?.close();
  try { dev?.kill("SIGTERM"); } catch { /* gone */ }
}
finish();
console.log(`screenshots: ${SHOTS}`);
