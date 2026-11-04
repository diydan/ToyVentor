// Captures the screenshot on each Map card: public/map/cards/<id>.jpg.
//
//   node scripts/capture-map-cards.mjs            # all cards
//   node scripts/capture-map-cards.mjs garden code  # only these
//   OUT=/some/dir node scripts/capture-map-cards.mjs   # write elsewhere (default public/map/cards)
//
// It starts its own vite server and headless Chrome, pins the day look, and for each card opens the
// Map, taps the card exactly as a child would, waits for the level, hides every overlay and saves a
// 16:9 crop of the 3D stage. The ids are CARD_SHOT_IDS in src/lib/mapCards.ts. Run it again after the
// art changes; the pictures are committed so a clean checkout needs no browser.
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(process.env.OUT ?? `${ROOT}/public/map/cards`);
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.PORT ?? 5281);
const CDP = Number(process.env.CDP ?? 9411);
// Sideways: the wide view shows the markers and the world, where a portrait crop shows only the toy.
const W = 844;
const H = 390;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** id -> how to reach it. `band` is the saved age. `panel`: the level is a question panel over the stage (no scene of its own), so the panel stays in the picture. `sheet`: the card opens a sheet over the Map (the Garage), so the picture is the sheet as it opens. */
const ALL = [
  { id: "little", band: 0 }, { id: "early", band: 1, panel: true }, { id: "daily", band: 2, panel: true },
  { id: "bridges", band: 3 }, { id: "gears", band: 4 }, { id: "circuits", band: 4 }, { id: "code", band: 3 }, { id: "garage", band: 3, sheet: true },
  { id: "garden", band: 3, world: true }, { id: "sky", band: 3 }, { id: "junk", band: 3 }, { id: "beach", band: 3 }, { id: "snow", band: 3 }, { id: "room", band: 3 },
  { id: "lab1", band: 3 }, { id: "lab2", band: 3 }, { id: "lab3", band: 3 }, { id: "lab4", band: 3 }, { id: "lab5", band: 3 }, { id: "lab6", band: 3 },
];
const want = process.argv.slice(2);
const cards = want.length ? ALL.filter((c) => want.includes(c.id)) : ALL;

async function waitHttp(url) {
  for (let i = 0; i < 150; i++) { try { const r = await fetch(url); if (r.ok) return; } catch { /* retry */ } await sleep(400); }
  throw new Error(`no answer from ${url}`);
}

class Cdp {
  constructor(url) { this.url = url; this.id = 1; this.pending = new Map(); }
  connect() {
    return new Promise((res, rej) => {
      const ws = new WebSocket(this.url); this.ws = ws;
      ws.addEventListener("open", () => res(), { once: true });
      ws.addEventListener("error", rej, { once: true });
      ws.addEventListener("message", (ev) => {
        let m; try { m = JSON.parse(String(ev.data)); } catch { return; }
        if (m.id != null && this.pending.has(m.id)) { const q = this.pending.get(m.id); this.pending.delete(m.id); q(m.result); }
      });
    });
  }
  send(method, params = {}) { return new Promise((resolve) => { const id = this.id++; this.pending.set(id, resolve); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async ev(expr) { const r = await this.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); return r.result?.value; }
}

const profile = `/tmp/map-cards-profile-${process.pid}`;
rmSync(profile, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { cwd: ROOT, stdio: "ignore" });
// The 3D stage needs the real GPU (SwiftShader never answers); see docs notes on headless Chrome.
const chrome = spawn(CHROME, ["--headless=new", "--use-angle=metal", "--ignore-gpu-blocklist", `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, "--no-first-run", "about:blank"], { stdio: "ignore" });

const hide = (panel) => `(() => {
  let s = document.getElementById("cap-hide");
  if (!s) { s = document.createElement("style"); s.id = "cap-hide"; document.head.appendChild(s); }
  s.textContent = ${JSON.stringify(
    panel
      ? '.tv-kip-fab, .tv-worlds-compact, .tv-dock, .tv-topbar, [class*="toast"] { visibility: hidden !important; }'
      : '.tv-stage > :not(.tv-stage-canvas-host), .tv-stage-canvas-host > :not(canvas), [class*="toast"], [role="status"], .tv-dock, .tv-topbar { visibility: hidden !important; }',
  )};
})()`;

let failed = 0;
try {
  await waitHttp(`http://localhost:${PORT}/`);
  await waitHttp(`http://localhost:${CDP}/json/version`);
  const list = await (await fetch(`http://localhost:${CDP}/json/list`)).json();
  const page = new Cdp(list.find((t) => t.type === "page").webSocketDebuggerUrl);
  await page.connect();
  await page.send("Runtime.enable"); await page.send("Page.enable");
  const metrics = () => page.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: true });
  await metrics();
  const load = async (band) => {
    await page.send("Page.navigate", { url: `http://localhost:${PORT}/?title=0` }); await sleep(1500);
    await page.ev(`localStorage.clear(); localStorage.setItem("tvTimeOfDay:v1", "day"); localStorage.setItem("toyforge:progression:v1", JSON.stringify({version:1,totalXp:0,missionStars:{},daily:{},unlockedIds:[],sandboxUnlockAll:true,ageBand:${band}}))`);
    await page.send("Page.navigate", { url: `http://localhost:${PORT}/?title=0` });
    // Wait for the stage (the first load transforms every module, so a fixed sleep is not enough).
    for (let i = 0; i < 90 && !(await page.ev(`!!document.querySelector('.tv-navstrip-btn[data-nav=map]')`)); i++) await sleep(500);
    await sleep(2500);
    await metrics();
  };

  for (const card of cards) {
    try {
      await load(card.band);
      await page.ev(`document.querySelector('.tv-navstrip-btn[data-nav=map]')?.click()`); await sleep(1200);
      const tapped = await page.ev(`(() => { const b = document.querySelector('.tv-map-card[data-id="${card.id}"] .tv-map-card-btn'); if (!b) return false; b.scrollIntoView({inline:"center"}); b.click(); return true; })()`);
      if (!tapped) {
        const seen = await page.ev(`JSON.stringify({navMap: !!document.querySelector('.tv-navstrip-btn[data-nav=map]'), trail: !!document.querySelector(".tv-trail-full"), cards: [...document.querySelectorAll(".tv-map-card")].map((e) => e.dataset.id), title: !!document.querySelector("#title:not([hidden])"), body: document.body.innerText.slice(0, 80)})`);
        throw new Error(`card not on the Map (${seen})`);
      }
      await sleep(1200);
      // A ladder with a choice asks which rung: take the first one, like a child's first tap.
      await page.ev(`(() => { const r = document.querySelector(".tv-rung-list button, .tv-rung-list [role=button]"); if (r) r.click(); })()`);
      if (card.sheet) {
        // A sheet opens from the left over the Map: take the left 16:9 of the screen as a child sees it.
        await sleep(1800);
        const sw = Math.round((H * 16) / 9);
        const sheet = await page.send("Page.captureScreenshot", { format: "jpeg", quality: 72, clip: { x: 0, y: 0, width: sw, height: H, scale: 1 } });
        if (!sheet?.data) throw new Error("no screenshot data");
        writeFileSync(`${OUT}/${card.id}.jpg`, Buffer.from(sheet.data, "base64"));
        console.log(`ok   ${card.id}  ${Math.round(Buffer.from(sheet.data, "base64").length / 1024)} KB`);
        continue;
      }
      await sleep(card.world ? 9000 : 6000);
      await page.ev(hide(card.panel)); await sleep(400);
      const r = await page.ev(`(() => { const b = document.querySelector("${card.panel ? ".tv-stage" : ".tv-stage-canvas-host canvas"}").getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()`);
      // The middle 16:9 of the stage (the card's picture is about that shape).
      const cw = Math.min(r.w, Math.round((r.h * 16) / 9));
      // A question panel sits at the left of the stage, so keep the left edge; a scene is cropped from the middle.
      const clip = { x: card.panel ? r.x : r.x + (r.w - cw) / 2, y: r.y, width: cw, height: r.h, scale: 1 };
      const shot = await page.send("Page.captureScreenshot", { format: "jpeg", quality: 72, clip });
      if (!shot?.data) throw new Error("no screenshot data");
      writeFileSync(`${OUT}/${card.id}.jpg`, Buffer.from(shot.data, "base64"));
      console.log(`ok   ${card.id}  ${Math.round(Buffer.from(shot.data, "base64").length / 1024)} KB`);
    } catch (err) {
      failed += 1;
      console.log(`FAIL ${card.id}: ${err.message}`);
    }
  }
} finally {
  try { chrome.kill(); } catch { /* gone */ }
  try { dev.kill(); } catch { /* gone */ }
}
console.log(failed ? `${failed} card(s) failed` : "all captured");
process.exit(failed ? 1 : 0);
