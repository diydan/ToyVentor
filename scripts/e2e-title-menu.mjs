#!/usr/bin/env node
// The game's main menu in a real browser (src/features/game/world/titleEntries.ts, TitleMenu.tsx; docs/specs/carousel-modes-ladders-spec.md section 17, item 1).
// Headless Chrome on the machine's GPU, the Vite dev server, real mouse and key events. What the unit tests cannot see: the toy really stands on the turntable in the
// middle of the stage, the gears really turn, nothing is drawn over the toy, the three buttons are reachable on a phone held either way, Play / Build / Create each
// leave the menu into the right place, a deep link goes straight in, and the dock is not there under the menu.
// Run: node scripts/e2e-title-menu.mjs    Overrides: E2E_CHROME, E2E_PORT, E2E_DEBUG_PORT, E2E_PROFILE, E2E_SHOTS (screenshot directory).
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const CHROME = process.env.E2E_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEV_PORT = Number(process.env.E2E_PORT ?? 5230);
const DEBUG_PORT = Number(process.env.E2E_DEBUG_PORT ?? 9380);
const PROFILE = process.env.E2E_PROFILE ?? "/tmp/toyforge-e2e-title-profile";
const SHOTS = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), "title-menu-shots");
const BASE = `http://localhost:${DEV_PORT}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, { timeoutMs = 60000, everyMs = 200, label = "?" } = {}) {
  const end = Date.now() + timeoutMs;
  let last;
  for (;;) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e; }
    if (Date.now() > end) throw new Error(`timeout waiting for ${label}: ${String(last)}`);
    await sleep(everyMs);
  }
}

class Cdp {
  constructor(url) { this.url = url; this.id = 1; this.pending = new Map(); this.exceptions = []; }
  connect() {
    return new Promise((res, rej) => {
      const ws = new WebSocket(this.url); this.ws = ws;
      ws.addEventListener("open", () => res(), { once: true });
      ws.addEventListener("error", rej, { once: true });
      ws.addEventListener("message", (ev) => {
        let m; try { m = JSON.parse(String(ev.data)); } catch { return; }
        if (m.id != null && this.pending.has(m.id)) {
          const p = this.pending.get(m.id); this.pending.delete(m.id);
          m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
        } else if (m.method === "Runtime.exceptionThrown") {
          this.exceptions.push(m.params?.exceptionDetails?.exception?.description || m.params?.exceptionDetails?.text || "exception");
        }
      });
    });
  }
  send(method, params = {}) { const id = this.id++; return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async ev(expr) {
    const r = await this.send("Runtime.evaluate", { expression: expr, returnByValue: true });
    if (r?.exceptionDetails) throw new Error("evaluate threw: " + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r?.result?.value;
  }
  async tapAt(x, y) {
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  }
  async key(key, code) {
    await this.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: key === "Enter" ? 13 : 0, ...(key === "Enter" ? { text: "\r" } : {}) });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: key === "Enter" ? 13 : 0 });
  }
}

const results = [];
const check = (name, pass, detail = "") => results.push({ name, pass: Boolean(pass), detail });
const shot = async (cdp, name) => { mkdirSync(SHOTS, { recursive: true }); const r = await cdp.send("Page.captureScreenshot", { format: "png" }); writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(r.data, "base64")); };

async function open(cdp, url, w, h) {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 2, mobile: true });
  await cdp.send("Page.navigate", { url });
  await waitFor(() => cdp.ev(`!!document.querySelector("canvas") && !!(window.__tvWorld && window.__tvWorld.P)`), { label: `${url} stage + dev handle`, timeoutMs: 90000 });
}
const title = (cdp) => cdp.ev(`window.__tvWorld.P.title === true`);
const menuUp = (cdp) => cdp.ev(`!!document.querySelector(".tv-title")`);
const rect = (cdp, sel) => cdp.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, b: r.bottom, r: r.right }; })()`);
const entry = (cdp, id) => cdp.ev(`(() => { const e = document.querySelector('[data-title-entry="${id}"]'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, top: r.y, bottom: r.bottom, left: r.x, right: r.right, disabled: e.disabled, text: e.textContent.trim() }; })()`);
/** Where the toy is on the screen, in CSS pixels: its middle (x, y) and its feet (fy). */
const toyOnScreen = (cdp) => cdp.ev(`(() => { const w = window.__tvWorld, d = window.__tvDebug; const v = new d.camera.position.constructor(); w.P.root.getWorldPosition(v); const f = v.clone().project(d.camera); v.y += 1.0; v.project(d.camera); const c = document.querySelector("canvas").getBoundingClientRect(); return { x: c.left + (v.x + 1) / 2 * c.width, y: c.top + (1 - v.y) / 2 * c.height, fy: c.top + (1 - f.y) / 2 * c.height, w: c.width, h: c.height }; })()`);
/** The turntable and its gears, found in the scene by what the world gives them (FAC.userData.tt / .gears). */
const turntable = (cdp) => cdp.ev(`(() => { let f = null; window.__tvDebug.scene.traverse((o) => { if (!f && o.userData && o.userData.tt && o.userData.gears) f = o; }); return f ? { tt: f.userData.tt.rotation.y, g0: f.userData.gears[0].rotation.y, g1: f.userData.gears[1].rotation.y } : null; })()`);

async function main() {
  rmSync(PROFILE, { recursive: true, force: true });
  const dev = spawn("npx", ["vite", "--port", String(DEV_PORT), "--strictPort"], { cwd: ROOT, stdio: "ignore" });
  const chrome = spawn(CHROME, ["--headless=new", "--use-angle=metal", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required",
    `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${PROFILE}`, "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
  const killAll = () => { try { chrome.kill(); } catch {} try { dev.kill(); } catch {} };
  process.on("SIGINT", () => { killAll(); process.exit(130); });
  try {
    await waitFor(async () => (await fetch(BASE)).ok || null, { label: BASE, timeoutMs: 120000 });
    await waitFor(async () => (await fetch(`http://localhost:${DEBUG_PORT}/json/version`)).ok || null, { label: "chrome" });
    await fetch(`http://localhost:${DEBUG_PORT}/json/new?about:blank`, { method: "PUT" });
    const targets = await waitFor(async () => { const l = (await (await fetch(`http://localhost:${DEBUG_PORT}/json/list`)).json()).filter((t) => t.url === "about:blank"); return l.length ? l : null; }, { label: "new tab" });
    const cdp = new Cdp(targets[0].webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send("Runtime.enable"); await cdp.send("Page.enable");

    // ---- a phone held upright: the menu, the turntable, the gears -------------------------------------------------------------------------------------
    await open(cdp, `${BASE}/`, 390, 844);
    await waitFor(() => menuUp(cdp), { label: "the menu", timeoutMs: 30000 });
    check("the game opens on its main menu", await menuUp(cdp) && await title(cdp));
    check("the world is on its title and its showcase (the toy on the turntable), not playing", await cdp.ev(`window.__tvWorld.P.title === true && window.__tvWorld.P.showcase === true`));
    check("the menu names the game and says what it is for", await cdp.ev(`(() => { const t = document.querySelector(".tv-title"); return t.querySelector("h1").textContent === "ToyVentor" && t.textContent.includes("Build it. Play it. Make it real."); })()`));
    check("the dock is not shown under the menu", await cdp.ev(`getComputedStyle(document.querySelector(".tv-dock")).display === "none" && document.querySelector(".tv-host").classList.contains("tv-host--titled")`));
    check("the world's own HUD and tabs are hidden too, and the canvas is still there", await cdp.ev(`(() => { const st = document.querySelector(".tv-stage"); return [...st.children].filter((c) => !c.classList.contains("tv-stage-canvas-host") && !c.classList.contains("tv-title")).every((c) => getComputedStyle(c).display === "none") && st.querySelector("canvas") != null; })()`));

    await waitFor(async () => (await entry(cdp, "play"))?.disabled === false, { label: "Play enabled once the world is ready", timeoutMs: 90000 });
    const [play, build, create] = [await entry(cdp, "play"), await entry(cdp, "build"), await entry(cdp, "create")];
    check("three buttons: Play, Build, Create a world, in that order, top to bottom or left to right", play.text === "Play" && build.text === "Build" && create.text === "Create a world" && (play.y < build.y && build.y < create.y || play.x < build.x && build.x < create.x), JSON.stringify([play.text, build.text, create.text]));
    check("each is big enough for a thumb (at least 44 px tall) and on the screen", [play, build, create].every((b) => b.h >= 44 && b.left >= 0 && b.right <= 390 && b.bottom <= 844), JSON.stringify([play, build, create].map((b) => [Math.round(b.w), Math.round(b.h)])));
    check("the Play button has the keyboard focus (one key from the world)", await cdp.ev(`document.activeElement && document.activeElement.dataset.titleEntry === "play"`));

    const head = await rect(cdp, ".tv-title-head");
    const toy = await toyOnScreen(cdp);
    check(`the toy is in the middle of the screen (x ${Math.round(toy.x)} of ${Math.round(toy.w)})`, Math.abs(toy.x - toy.w / 2) < toy.w * 0.18, JSON.stringify(toy));
    check(`and nothing is drawn over it: below the name (${Math.round(head.b)}) and its feet (${Math.round(toy.fy)}) above the buttons (${Math.round(Math.min(play.top, build.top, create.top))})`, toy.y > head.b && toy.fy < Math.min(play.top, build.top, create.top), JSON.stringify({ toy, headBottom: head.b }));
    check("the world's ability bar (Dash, Whirl, Glow pulse, Shove) is there but hidden under the menu", await cdp.ev(`(() => { const mv = [...document.querySelectorAll(".mv")]; return mv.length >= 4 && mv.every((b) => b.offsetParent === null); })()`));
    const t0 = await turntable(cdp);
    await sleep(900);
    const t1 = await turntable(cdp);
    check("the turntable and both gears are turning (the cogs)", t0 && t1 && t1.tt !== t0.tt && t1.g0 !== t0.g0 && t1.g1 !== t0.g1 && Math.sign(t1.g0 - t0.g0) !== Math.sign(t1.g1 - t0.g1), JSON.stringify([t0, t1]));
    await shot(cdp, "title-portrait");

    // ---- Play, with a real tap -----------------------------------------------------------------------------------------------------------------------
    await cdp.tapAt(play.x, play.y);
    await waitFor(async () => !(await menuUp(cdp)), { label: "the menu gone after Play", timeoutMs: 8000 });
    await sleep(900);
    check("Play: the menu is gone and the world is playing (not on its title, not in showcase)", await cdp.ev(`window.__tvWorld.P.title === false && window.__tvWorld.P.showcase === false`));
    check("Play: the dock is back, and so is the ability bar", await cdp.ev(`getComputedStyle(document.querySelector(".tv-dock")).display !== "none" && !document.querySelector(".tv-host").classList.contains("tv-host--titled") && [...document.querySelectorAll(".mv")].some((b) => b.offsetParent !== null)`));
    const x0 = await cdp.ev(`window.__tvWorld.P.pos.x`);
    await cdp.ev(`(() => { const w = window.__tvWorld; w.P.target = { x: w.P.pos.x + 3, z: 0 }; })()`);
    await sleep(1500);
    check("Play: the toy walks when told (the world is live)", (await cdp.ev(`window.__tvWorld.P.pos.x`)) > x0 + 0.5, String(x0));
    await shot(cdp, "after-play");

    // ---- Build -----------------------------------------------------------------------------------------------------------------------------------------
    await open(cdp, `${BASE}/`, 390, 844);
    await waitFor(async () => (await entry(cdp, "build"))?.disabled === false, { label: "Build enabled", timeoutMs: 90000 });
    const b2 = await entry(cdp, "build");
    await cdp.tapAt(b2.x, b2.y);
    await waitFor(async () => !(await menuUp(cdp)), { label: "the menu gone after Build", timeoutMs: 8000 });
    await sleep(800);
    check("Build: the menu is gone and the build sheet is open (the world is in its building state)", await cdp.ev(`window.__tvWorld.P.title === false && document.querySelector(".tv-stage-canvas-host").classList.contains("building")`));
    await shot(cdp, "after-build");

    // ---- Create a world --------------------------------------------------------------------------------------------------------------------------------
    await open(cdp, `${BASE}/`, 390, 844);
    await waitFor(async () => (await entry(cdp, "create"))?.disabled === false, { label: "Create enabled", timeoutMs: 90000 });
    const c2 = await entry(cdp, "create");
    await cdp.tapAt(c2.x, c2.y);
    await waitFor(async () => !(await menuUp(cdp)), { label: "the menu gone after Create", timeoutMs: 8000 });
    await sleep(800);
    check("Create a world: the menu is gone and the creator is open", await cdp.ev(`window.__tvWorld.P.title === false && Boolean(window.__tvWorld.handle.crSnap && window.__tvWorld.handle.crSnap().open)`));
    await shot(cdp, "after-create");

    // ---- the keyboard ----------------------------------------------------------------------------------------------------------------------------------
    await open(cdp, `${BASE}/`, 390, 844);
    await waitFor(async () => (await entry(cdp, "play"))?.disabled === false, { label: "Play enabled again", timeoutMs: 90000 });
    await sleep(300);
    await cdp.key("Enter", "Enter");
    await waitFor(async () => !(await menuUp(cdp)), { label: "the menu gone after Enter", timeoutMs: 8000 }).catch(() => {});
    check("Enter on the focused Play button goes into the world", !(await menuUp(cdp)) && (await cdp.ev(`window.__tvWorld.P.title === false`)));

    // ---- a link that means "straight in" ----------------------------------------------------------------------------------------------------------------
    await open(cdp, `${BASE}/?title=0`, 390, 844);
    await sleep(2500);
    check("?title=0 goes straight into the world with no menu (what every other test relies on)", !(await menuUp(cdp)) && (await cdp.ev(`window.__tvWorld.P.title === false && window.__tvWorld.P.showcase === false`)) && (await cdp.ev(`getComputedStyle(document.querySelector(".tv-dock")).display !== "none"`)));

    // ---- a phone held sideways ---------------------------------------------------------------------------------------------------------------------------
    await open(cdp, `${BASE}/`, 844, 390);
    await waitFor(async () => (await entry(cdp, "play"))?.disabled === false, { label: "Play enabled (landscape)", timeoutMs: 90000 });
    await sleep(600);
    const [lp, lb, lc] = [await entry(cdp, "play"), await entry(cdp, "build"), await entry(cdp, "create")];
    const lhead = await rect(cdp, ".tv-title-head");
    const ltoy = await toyOnScreen(cdp);
    check("landscape: the three buttons are all on the screen and at least 44 px tall", [lp, lb, lc].every((b) => b.h >= 44 && b.left >= 0 && b.right <= 844 && b.bottom <= 390), JSON.stringify([lp, lb, lc].map((b) => [Math.round(b.left), Math.round(b.top), Math.round(b.w), Math.round(b.h)])));
    check("landscape: the buttons do not overlap each other or the name", ![[lp, lb], [lb, lc], [lp, lc]].some(([a, b]) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) && lhead.b <= Math.min(lp.top, lb.top, lc.top) + 1, JSON.stringify({ headBottom: lhead.b, tops: [lp.top, lb.top, lc.top] }));
    const under = (px, py) => [lp, lb, lc].some((b) => px > b.left && px < b.right && py > b.top && py < b.bottom);
    check(`landscape: the toy is still in the middle (x ${Math.round(ltoy.x)}), and neither its middle nor its feet (y ${Math.round(ltoy.fy)}) are under a button`, Math.abs(ltoy.x - 422) < 150 && !under(ltoy.x, ltoy.y) && !under(ltoy.x, ltoy.fy), JSON.stringify({ ltoy, buttons: [lp, lb, lc].map((b) => [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]) }));
    await shot(cdp, "title-landscape");

    // ---- a laptop window -----------------------------------------------------------------------------------------------------------------------------------
    await open(cdp, `${BASE}/`, 1280, 720);
    await waitFor(async () => (await entry(cdp, "play"))?.disabled === false, { label: "Play enabled (desktop)", timeoutMs: 90000 });
    await sleep(600);
    const [dp, db, dc] = [await entry(cdp, "play"), await entry(cdp, "build"), await entry(cdp, "create")];
    const dtoy = await toyOnScreen(cdp);
    const dhead = await rect(cdp, ".tv-title-head");
    check(`desktop: the toy is in the middle (x ${Math.round(dtoy.x)} of ${Math.round(dtoy.w)}), below the name, and its feet (${Math.round(dtoy.fy)}) are above the buttons (${Math.round(Math.min(dp.top, db.top, dc.top))})`, Math.abs(dtoy.x - dtoy.w / 2) < dtoy.w * 0.1 && dtoy.y > dhead.b && dtoy.fy < Math.min(dp.top, db.top, dc.top), JSON.stringify({ dtoy, headBottom: dhead.b }));
    await shot(cdp, "title-desktop");

    check("no page exceptions", cdp.exceptions.length === 0, cdp.exceptions.slice(0, 3).join(" | "));
    killAll();
  } catch (err) {
    check("e2e ran to completion", false, String(err && err.stack || err));
    killAll();
  }
  const failed = results.filter((r) => !r.pass);
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : `  [${r.detail}]`}`);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  console.log(`screenshots: ${SHOTS}`);
  process.exit(failed.length ? 1 : 0);
}
main();
