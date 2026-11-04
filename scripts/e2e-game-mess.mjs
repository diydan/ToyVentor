#!/usr/bin/env node
// 390x844 headless-Chrome E2E for the Toy Room's two MESS mini-interactions (docs/specs/playful-interactions-spec.md, "Spill and clean up" and "Make a mess, clean it up"; Dan, 2026-11-03):
//   tap the JUICE CUP        -> Kip walks over, the cup tips, a puddle spreads, "Oh no, oh no!", "Clean?" + a Clean button, Kip mops it up (six strokes), the cup stands up, "All clean! Hooray!"
//   tap the TOY BOX          -> Kip tips it, six toys tumble into a heap, "Oh no, oh no!", "Clean?" + Clean, the toys fly back one by one with a count ("1 toy home!" ... "All 6 toys home!"), a cheer
// Real mouse events on the real game; /api/voice is intercepted (no spend) and its requests are recorded, so what Kip SAYS is checked by the clip id it asks for. Also: prefers-reduced-motion, sound off
// (the words are still on screen), a world change clearing a mess, and nothing starting while a mess waits. Needs a real GPU: --headless=new with the Metal backend. Run: node scripts/e2e-game-mess.mjs
// Overrides: E2E_CHROME, E2E_PORT (default 5302), E2E_DEBUG_PORT (9402), E2E_PROFILE, E2E_SHOTS (screenshot directory).
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
const CHROME = process.env.E2E_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEV_PORT = Number(process.env.E2E_PORT ?? 5302);
const DEBUG_PORT = Number(process.env.E2E_DEBUG_PORT ?? 9402);
const PROFILE = process.env.E2E_PROFILE ?? "/tmp/e2e-mess-fork";
const SHOTS = process.env.E2E_SHOTS ?? "";
const APP = `http://localhost:${DEV_PORT}/`;

const PROMPTS = JSON.parse(readFileSync(new URL("../src/lib/scenePrompts.json", import.meta.url), "utf8")).prompts;
const idOf = (text) => PROMPTS.find((p) => p.text === text)?.id;
const OH_NO = "Oh no, oh no!", CLEAN_Q = "Clean?", ALL_CLEAN = "All clean! Hooray!";
const voiceFor = (text) => `/api/voice?s=${idOf(text)}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, { timeoutMs = 60000, everyMs = 250, label = "?" } = {}) {
  const end = Date.now() + timeoutMs;
  let last;
  for (;;) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e; }
    if (Date.now() > end) throw new Error(`timeout waiting for ${label}: ${String(last)}`);
    await sleep(everyMs);
  }
}

// 0.1 s of 16-bit mono silence at 24 kHz, as a valid WAV.
function silentWavB64() {
  const n = 2400, bytes = n * 2, b = Buffer.alloc(44 + bytes);
  b.write("RIFF", 0); b.writeUInt32LE(36 + bytes, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(24000, 24); b.writeUInt32LE(48000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(bytes, 40);
  return b.toString("base64");
}

class Cdp {
  constructor(url) { this.url = url; this.id = 1; this.pending = new Map(); this.exceptions = []; this.voiceUrls = []; }
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
        } else if (m.method === "Fetch.requestPaused") {
          const { requestId, request } = m.params;
          if (request.url.includes("/api/voice")) {
            this.voiceUrls.push(new URL(request.url).pathname + new URL(request.url).search);
            this.send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "content-type", value: "audio/wav" }], body: silentWavB64() }).catch(() => {});
          } else {
            this.send("Fetch.continueRequest", { requestId }).catch(() => {});
          }
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
}

const results = [];
const check = (name, pass, detail = "") => results.push({ name, pass: Boolean(pass), detail });
const toastText = (cdp) => cdp.ev(`(() => { const t = document.querySelector("#toast"); return t && t.classList.contains("on") ? t.textContent : null; })()`);
const clearToast = (cdp) => cdp.ev(`(() => { const t = document.querySelector("#toast"); if (t) t.classList.remove("on"); })()`);
const world = (cdp, expr) => cdp.ev(`(() => { const w = window.__tvWorld; if (!w) return null; return ${expr}; })()`);
const shot = async (cdp, name) => { if (!SHOTS) return; mkdirSync(SHOTS, { recursive: true }); const r = await cdp.send("Page.captureScreenshot", { format: "png" }); writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(r.data, "base64")); };
const dismissSheet = (cdp) => cdp.ev(`(() => { if (!document.querySelector(".building")) return false; const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Later"); if (b) b.click(); return Boolean(b); })()`);
const prop = (cdp, type) => world(cdp, `(() => { const i = w.props.list().find((p) => p.type === ${JSON.stringify(type)}); return i ? { x: i.base.px, z: i.base.pz, h: i.size.y } : null; })()`);
const propScreen = (cdp, type) => world(cdp, `(() => { const i = w.props.list().find((p) => p.type === ${JSON.stringify(type)}); return i ? w.props.screenPos(i, 0.5) : null; })()`);
const phase = (cdp) => world(cdp, `w.mess.phase`);
const toy = (cdp) => world(cdp, `({ x: w.P.pos.x, z: w.P.pos.z, busy: w.P.busy, action: w.getMix() ? w.getMix().busyAction : null, target: w.P.target ? w.P.target.x : null })`);
const held = (cdp) => world(cdp, `w.held.item`);
const cupTilt = (cdp) => world(cdp, `w.props.list().find((p) => p.type === "cup").holder.userData.cup.rotation.x`);
const boxTilt = (cdp) => world(cdp, `w.props.list().find((p) => p.type === "toybox").holder.userData.boxPivot.rotation.x`);
const toyYs = (cdp) => world(cdp, `w.props.list().find((p) => p.type === "toybox").holder.userData.toys.map((t) => +t.position.y.toFixed(3))`);
const puddle = (cdp) => world(cdp, `({ size: +w.mess.puddleSize.toFixed(4), at: w.mess.puddleAt })`);
const card = (cdp) => cdp.ev(`(() => { const c = document.querySelector('[data-testid="mess-prompt"]'); if (!c) return null; const b = c.querySelector("button"), r = b.getBoundingClientRect(); const cs = getComputedStyle(c); return { hidden: c.hidden || cs.display === "none", text: c.querySelector("span").textContent, label: c.getAttribute("aria-label"), role: c.getAttribute("role"), btn: { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }, btnText: b.textContent.trim(), btnLabel: b.getAttribute("aria-label") }; })()`);
const screenOf = (cdp, pointExpr) => cdp.ev(`(() => { const cam = window.__tvDebug.camera; const v = (${pointExpr}).project(cam); const r = document.querySelector("canvas").getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height, on: v.z > -1 && v.z < 1 }; })()`);
const V3 = "new window.__tvDebug.camera.position.constructor";
/** Poll fast for `ms`, collecting what a sampler sees. */
async function sample(cdp, ms, fn, every = 40) { const out = []; const end = Date.now() + ms; while (Date.now() < end) { out.push(await fn()); await sleep(every); } return out; }
const voices = (cdp) => [...new Set(cdp.voiceUrls)];
/** Tap a prop where it is on screen RIGHT NOW. */
async function tapProp(cdp, type) { const p = await propScreen(cdp, type); await cdp.tapAt(p.x, p.y); return p; }
/** Put Kip `dx` units left of a prop, wait for it to be on screen and return where. */
async function stage(cdp, type, dx = 1.9) {
  const p = await prop(cdp, type);
  await cdp.ev(`(() => { const w = window.__tvWorld; w.P.pos.x = ${p.x} - ${dx}; w.P.pos.z = 0; w.P.target = null; w.P.hop = 0; })()`);
  const on = await waitFor(async () => { await dismissSheet(cdp); const s = await propScreen(cdp, type); return s && s.visible && s.x > 30 && s.x < 360 && s.y > 120 && s.y < 760 ? s : null; }, { timeoutMs: 15000, label: `${type} on screen` });
  let last = on, still = 0;
  for (let i = 0; i < 60 && still < 4; i++) { await sleep(100); const now = await propScreen(cdp, type); still = now && Math.hypot(now.x - last.x, now.y - last.y) < 1.5 ? still + 1 : 0; last = now || last; }
  return last;
}

async function loadApp(cdp, { reduced = false } = {}) {
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: reduced ? "reduce" : "no-preference" }] });
  const source = `try { localStorage.setItem("toyforge:prop-lang:v1", "en"); } catch (e) {}`;
  const { identifier } = await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source });
  try {
    await cdp.send("Page.navigate", { url: APP });
    await waitFor(() => cdp.ev(`!!document.querySelector("canvas") && !!(window.__tvWorld && window.__tvWorld.props)`), { label: "stage + dev handle" });
  } finally {
    await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
  }
  await sleep(2000);
  await cdp.ev(`(() => { const t = document.querySelector("#title"); if (t && !t.hidden) document.querySelector("#play")?.click(); })()`);
  await sleep(1500);
  await cdp.ev(`window.__tvWorld.handle.go("room")`);
  await sleep(3000);
  if (!reduced) await waitFor(() => world(cdp, `!!(w.getMix() && w.getMix().canDrive(w.P.rig))`), { timeoutMs: 30000, label: "the character clips" });
}

/** The whole spill, with a sampler running from the tap to the question: returns what was seen. */
async function spill(cdp) {
  await clearToast(cdp);
  cdp.voiceUrls.length = 0;
  await tapProp(cdp, "cup");
  const toasts = new Set();
  const seen = await sample(cdp, 9000, async () => {
    const t = await toastText(cdp); if (t) toasts.add(t);
    return { ph: await phase(cdp), act: (await toy(cdp)).action, tilt: await cupTilt(cdp), pud: (await puddle(cdp)).size, toy: await toy(cdp) };
  }, 50);
  return { seen, toasts: [...toasts] };
}

async function main() {
  rmSync(PROFILE, { recursive: true, force: true });
  const dev = spawn("npx", ["vite", "--port", String(DEV_PORT), "--strictPort"], { cwd: ROOT, stdio: "ignore" });
  const chrome = spawn(CHROME, ["--headless=new", "--use-angle=metal", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required",
    `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${PROFILE}`, "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
  const killAll = () => { try { chrome.kill(); } catch {} try { dev.kill(); } catch {} };
  process.on("SIGINT", () => { killAll(); process.exit(130); });
  try {
    await waitFor(async () => (await fetch(APP)).ok || null, { label: APP, timeoutMs: 120000 });
    await waitFor(async () => (await fetch(`http://localhost:${DEBUG_PORT}/json/version`)).ok || null, { label: "chrome" });
    await fetch(`http://localhost:${DEBUG_PORT}/json/new?about:blank`, { method: "PUT" });
    const targets = await waitFor(async () => { const l = (await (await fetch(`http://localhost:${DEBUG_PORT}/json/list`)).json()).filter((t) => t.url === "about:blank"); return l.length ? l : null; }, { label: "new tab" });
    const cdp = new Cdp(targets[0].webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await cdp.send("Runtime.enable"); await cdp.send("Page.enable");
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/voice*" }] });

    // ======================================= 0. setup =======================================
    await loadApp(cdp);
    for (const t of ["cup", "toybox"]) check(`setup: the Toy Room has the ${t}`, Boolean(await prop(cdp, t)));
    check("setup: the three lines Kip says are in the closed list the voice reads from", [OH_NO, CLEAN_Q, ALL_CLEAN].every((l) => Boolean(idOf(l))), JSON.stringify([OH_NO, CLEAN_Q, ALL_CLEAN].map(idOf)));
    check("setup: nothing is happening and no card is up", (await phase(cdp)) === "idle" && (await card(cdp)) === null);

    // ======================================= 1. the spill =======================================
    console.log("\n[1] the juice cup");
    const cupOn = await stage(cdp, "cup", 1.9);
    check("cup: it is on the screen, with its table", cupOn.visible && cupOn.x > 30 && cupOn.x < 360, JSON.stringify(cupOn));
    await shot(cdp, "1-cup");
    check("cup: it stands upright, the stream is hidden, and there is no puddle", (await cupTilt(cdp)) === 0 && (await puddle(cdp)).size === 0 && (await world(cdp, `w.props.list().find((p) => p.type === "cup").holder.userData.stream.visible`)) === false);
    let shotMid = false;
    await clearToast(cdp);
    cdp.voiceUrls.length = 0;
    await tapProp(cdp, "cup");
    await sleep(250);
    check("cup: a tap says its name (its clip asked for)", voices(cdp).includes("/api/voice?lang=en&n=cup&c=orange"), JSON.stringify(voices(cdp)));
    const toasts1 = new Set();
    const walkSeen = [];
    const seen1 = await sample(cdp, 9500, async () => {
      const t = await toastText(cdp); if (t) toasts1.add(t);
      const s = { ph: await phase(cdp), act: (await toy(cdp)).action, tilt: await cupTilt(cdp), pud: (await puddle(cdp)).size, toy: await toy(cdp), card: (await card(cdp))?.hidden === false };
      if (!shotMid && s.pud > 0.3 && s.pud < 1) { shotMid = true; await shot(cdp, "2-spilling"); }
      walkSeen.push(s.toy);
      return s;
    }, 50);
    const cupW = await prop(cdp, "cup");
    check("cup: Kip walked to the cup's left side (about 1.15 units off), at the front of the lane (z about -1.1)", walkSeen.some((s) => Math.abs(s.z - -1.1) < 0.3 && Math.abs(s.x - (cupW.x - 1.15)) < 0.4), JSON.stringify(walkSeen.at(-1)));
    check("cup: Kip played the oops clip (reach, gasp)", seen1.some((s) => s.act === "oops"), JSON.stringify([...new Set(seen1.map((s) => s.act))]));
    const tilts = seen1.map((s) => s.tilt);
    check("cup: the cup tipped: upright at first, over to its side (about 90 degrees) at the end, in between falling", tilts[0] === 0 && Math.abs(tilts.at(-1) - Math.PI / 2) < 0.01 && tilts.some((t) => t > 0.3 && t < 1.4), JSON.stringify([tilts[0], Math.max(...tilts), tilts.at(-1)]));
    const puds = seen1.map((s) => s.pud);
    check("cup: a puddle spread: none before the tip, full size at the end, growing in between", puds[0] === 0 && puds.at(-1) > 0.98 && puds.some((v) => v > 0.2 && v < 0.9), JSON.stringify([puds[0], Math.max(...puds), puds.at(-1)]));
    check("cup: Kip said 'Oh no, oh no!' (its clip asked for, and the words on screen)", voices(cdp).includes(voiceFor(OH_NO)) && toasts1.has(OH_NO), JSON.stringify({ voices: voices(cdp), toasts: [...toasts1] }));
    check("cup: then asked 'Clean?' (its clip asked for)", voices(cdp).includes(voiceFor(CLEAN_Q)), JSON.stringify(voices(cdp)));
    check("cup: the mess waits: the phase is messy and Kip is free", seen1.at(-1).ph === "messy" && (await toy(cdp)).busy === false, JSON.stringify(seen1.at(-1)));
    const c1 = await card(cdp);
    check("cup: the question and its button are on the screen: 'Clean?' and a Clean button, a labelled group", c1 && !c1.hidden && c1.text === "Clean?" && c1.btnLabel === "Clean" && c1.role === "group" && c1.label === "Clean up?", JSON.stringify(c1));
    check("cup: the button is a real touch target: at least 56 px tall and wholly on the screen", c1 && c1.btn.h >= 56 && c1.btn.x > 40 && c1.btn.x < 350 && c1.btn.y > 200 && c1.btn.y < 800, JSON.stringify(c1?.btn));
    const pd = await puddle(cdp);
    const pOn = await screenOf(cdp, `${V3}(${pd.at.x}, 0.05, ${pd.at.z})`);
    check("cup: the puddle is on the screen, on the floor in front of the table", pOn.on && pOn.x > 20 && pOn.x < 370 && pOn.y > 150 && pOn.y < 780, JSON.stringify({ pd, pOn }));
    await shot(cdp, "3-spilled");
    // one mess at a time: a second tap on the cup, or on the toy box, starts nothing
    const before = await toy(cdp);
    await tapProp(cdp, "cup");
    await sleep(400);
    check("cup: tapping it again while it is spilled starts nothing (still one mess, Kip stays put)", (await phase(cdp)) === "messy" && Math.abs((await toy(cdp)).x - before.x) < 0.2, JSON.stringify(await toy(cdp)));

    // ---- Clean ----
    cdp.voiceUrls.length = 0;
    await clearToast(cdp);
    await cdp.tapAt(c1.btn.x, c1.btn.y);
    const toasts1b = new Set();
    let shotMop = false;
    const mop = await sample(cdp, 12000, async () => {
      const t = await toastText(cdp); if (t) toasts1b.add(t);
      const s = { ph: await phase(cdp), act: (await toy(cdp)).action, held: await held(cdp), pud: (await puddle(cdp)).size, tilt: await cupTilt(cdp), z: (await toy(cdp)).z };
      if (!shotMop && s.act === "mop" && s.pud > 0.3 && s.pud < 0.8) { shotMop = true; await shot(cdp, "4-mopping"); }
      return s;
    }, 50);
    check("clean: Kip walked to the puddle's depth (z about -0.9) with the mop in hand, and played the mop clip", mop.some((s) => s.held === "mop" && s.act === "mop" && Math.abs(s.z - -0.9) < 0.35), JSON.stringify([...new Set(mop.map((s) => `${s.act}/${s.held}`))]));
    check("clean: the card went when Kip started mopping", (await card(cdp))?.hidden === true);
    const mp = mop.filter((s) => s.act === "mop").map((s) => s.pud);
    let mono = true; for (let i = 1; i < mp.length; i++) if (mp[i] > mp[i - 1] + 1e-6) mono = false;
    check("clean: the puddle only ever got smaller while Kip mopped, from about full to nothing", mono && mp[0] > 0.8 && mp.at(-1) < 0.2, JSON.stringify([mp[0], mp.at(-1), mp.length]));
    const levels = [...new Set(mp.map((v) => Math.round(v * 6)))];
    check("clean: it went down in six strokes (the sixths 5, 4, 3, 2, 1 and 0 of it were all seen)", [5, 4, 3, 2, 1, 0].every((k) => levels.includes(k)), JSON.stringify(levels));
    check("clean: it is all gone, the cup stands up again, the mop is put away, and the phase is idle", mop.at(-1).pud === 0 && mop.at(-1).tilt === 0 && mop.at(-1).held === null && mop.at(-1).ph === "idle", JSON.stringify(mop.at(-1)));
    check("clean: Kip cheered ('All clean! Hooray!' said and shown)", mop.some((s) => s.act === "cheer") && voices(cdp).includes(voiceFor(ALL_CLEAN)) && toasts1b.has(ALL_CLEAN), JSON.stringify({ acts: [...new Set(mop.map((s) => s.act))], voices: voices(cdp), toasts: [...toasts1b] }));
    check("clean: and the card stays away", (await card(cdp))?.hidden === true);

    // ---- again: the same cup spills a second time ----
    await stage(cdp, "cup", 1.9);
    const again = await spill(cdp);
    check("cup again: the same cup can be spilled a second time, and asks again", again.seen.at(-1).ph === "messy" && again.seen.at(-1).pud > 0.98 && (await card(cdp))?.hidden === false, JSON.stringify(again.seen.at(-1)));
    const ca = await card(cdp);
    await cdp.tapAt(ca.btn.x, ca.btn.y);
    await waitFor(async () => ((await phase(cdp)) === "idle" ? true : null), { timeoutMs: 15000, label: "second cleaning done" });
    check("cup again: and cleans up again", (await puddle(cdp)).size === 0 && (await cupTilt(cdp)) === 0);

    // ======================================= 2. a world change clears a mess =======================================
    console.log("\n[2] a world change");
    await stage(cdp, "cup", 1.9);
    await spill(cdp);
    check("world change: a mess is waiting", (await phase(cdp)) === "messy" && (await card(cdp))?.hidden === false);
    await cdp.ev(`window.__tvWorld.handle.go("garden")`);
    await sleep(2500);
    check("world change: leaving the room clears it: nothing waiting, no card, no puddle", (await phase(cdp)) === "idle" && ((await card(cdp)) === null || (await card(cdp)).hidden === true) && (await puddle(cdp)).size === 0);
    await cdp.ev(`window.__tvWorld.handle.go("room")`);
    await sleep(3000);
    check("world change: back in the room the cup is upright again and nothing is spilled", (await cupTilt(cdp)) === 0 && (await puddle(cdp)).size === 0 && (await phase(cdp)) === "idle");

    // ======================================= 3. the toy box =======================================
    console.log("\n[3] the toy box");
    const boxOn = await stage(cdp, "toybox", 2.2);
    check("toy box: it is on the screen with its six toys in it", boxOn.visible && boxOn.x > 30 && boxOn.x < 360 && (await world(cdp, `w.props.list().find((p) => p.type === "toybox").holder.userData.toys.length`)) === 6, JSON.stringify(boxOn));
    await shot(cdp, "5-toybox");
    const yIn = await toyYs(cdp);
    await clearToast(cdp);
    cdp.voiceUrls.length = 0;
    await tapProp(cdp, "toybox");
    await sleep(250);
    check("toy box: a tap says its name (its clip asked for)", voices(cdp).includes("/api/voice?lang=en&n=toybox&c=blue"), JSON.stringify(voices(cdp)));
    const toasts3 = new Set();
    let shotTumble = false;
    const seen3 = await sample(cdp, 9500, async () => {
      const t = await toastText(cdp); if (t) toasts3.add(t);
      const ys = await toyYs(cdp);
      const s = { ph: await phase(cdp), act: (await toy(cdp)).action, tilt: await boxTilt(cdp), out: await world(cdp, `w.mess.toysOut`), ys, toy: await toy(cdp) };
      if (!shotTumble && ys.some((y) => y > 1.1)) { shotTumble = true; await shot(cdp, "6-tumbling"); }
      return s;
    }, 50);
    check("toy box: Kip walked to the box's left, in the lane (z about -0.9), and played the oops clip", seen3.some((s) => s.act === "oops") && seen3.some((s) => Math.abs(s.toy.z - -0.9) < 0.35), JSON.stringify([...new Set(seen3.map((s) => s.act))]));
    check("toy box: the box leaned over (about 0.5 rad) and stayed leaning", seen3.at(-1).tilt > 0.45 && seen3.at(-1).tilt < 0.55, String(seen3.at(-1).tilt));
    check("toy box: the toys tumbled out: at some moment some were in the air above the rim", seen3.some((s) => s.ys.some((y) => y > 1.1)), String(Math.max(...seen3.flatMap((s) => s.ys))));
    const ysOut = seen3.at(-1).ys;
    check("toy box: they ended in a heap on the floor (every toy low, the ring on the cube), none in the box", ysOut.filter((y) => y < 0.35).length === 5 && ysOut.every((y) => y < 0.8) && seen3.at(-1).out === 6, JSON.stringify(ysOut));
    const heap = [];
    for (let i = 0; i < 6; i++) heap.push(await screenOf(cdp, `window.__tvWorld.props.list().find((p) => p.type === "toybox").holder.userData.toys[${i}].getWorldPosition(${V3}())`));
    check("toy box: the heap is on the screen (every toy within the stage)", heap.every((p) => p.on && p.x > 10 && p.x < 380 && p.y > 130 && p.y < 800), JSON.stringify(heap.map((p) => [Math.round(p.x), Math.round(p.y)])));
    check("toy box: Kip said 'Oh no, oh no!' then 'Clean?'", voices(cdp).includes(voiceFor(OH_NO)) && voices(cdp).includes(voiceFor(CLEAN_Q)) && toasts3.has(OH_NO), JSON.stringify({ voices: voices(cdp), toasts: [...toasts3] }));
    const c3 = await card(cdp);
    check("toy box: the Clean card is up, with a big button", c3 && !c3.hidden && c3.text === "Clean?" && c3.btn.h >= 56 && c3.btn.y > 200 && c3.btn.y < 800, JSON.stringify(c3));
    await shot(cdp, "7-pile");

    cdp.voiceUrls.length = 0;
    await clearToast(cdp);
    await cdp.tapAt(c3.btn.x, c3.btn.y);
    const counts = [];
    let shotTidy = false;
    const tidy = await sample(cdp, 9000, async () => {
      const t = await toastText(cdp); if (t && /toys? home!$/.test(t) && counts.at(-1) !== t) counts.push(t);
      const ys = await toyYs(cdp);
      const s = { ph: await phase(cdp), act: (await toy(cdp)).action, tilt: await boxTilt(cdp), out: await world(cdp, `w.mess.toysOut`), ys, toast: t };
      if (!shotTidy && ys.some((y) => y > 1.2)) { shotTidy = true; await shot(cdp, "8-tidying"); }
      return s;
    }, 40);
    check("tidy: Kip waved the toys home (the tidy clip) and the box is upright while they go in", tidy.some((s) => s.act === "tidy") && tidy.filter((s) => s.ys.some((y) => y > 1.1)).every((s) => s.tilt < 0.05), JSON.stringify([...new Set(tidy.map((s) => s.act))]));
    check("tidy: each toy was counted as it went in: 1 toy home!, 2 toys home!, ... All 6 toys home!", JSON.stringify(counts) === JSON.stringify(["1 toy home!", "2 toys home!", "3 toys home!", "4 toys home!", "5 toys home!", "All 6 toys home!"]), JSON.stringify(counts));
    check("tidy: they flew back in an arc (in the air above the rim on the way)", tidy.some((s) => s.ys.some((y) => y > 1.2)), String(Math.max(...tidy.flatMap((s) => s.ys))));
    const yEnd = tidy.at(-1).ys;
    check("tidy: every toy is back in the box exactly where it started, the box is upright, and the room is idle", JSON.stringify(yEnd) === JSON.stringify(yIn) && tidy.at(-1).tilt === 0 && tidy.at(-1).ph === "idle" && tidy.at(-1).out === 0, JSON.stringify({ yEnd, yIn, tilt: tidy.at(-1).tilt }));
    check("tidy: Kip cheered and said 'All clean! Hooray!'", tidy.some((s) => s.act === "cheer") && voices(cdp).includes(voiceFor(ALL_CLEAN)), JSON.stringify({ acts: [...new Set(tidy.map((s) => s.act))], voices: voices(cdp) }));
    check("tidy: and the card is gone", (await card(cdp))?.hidden === true);

    // ======================================= 4. reduced motion =======================================
    console.log("\n[4] prefers-reduced-motion");
    await loadApp(cdp, { reduced: true });
    await stage(cdp, "cup", 1.9);
    await clearToast(cdp);
    await tapProp(cdp, "cup");
    const red = await sample(cdp, 7000, async () => ({ ph: await phase(cdp), tilt: await cupTilt(cdp), pud: (await puddle(cdp)).size, act: (await toy(cdp)).action }), 40);
    check("reduced: no character clip plays (the toy only walks and stands)", red.every((s) => s.act === null), JSON.stringify([...new Set(red.map((s) => s.act))]));
    const tiltSteps = [...new Set(red.map((s) => s.tilt))], pudSteps = [...new Set(red.map((s) => s.pud))];
    check("reduced: the spill appears finished at once: the cup goes straight from upright to lying, the puddle from nothing to full, with nothing in between", tiltSteps.length === 2 && pudSteps.length === 2 && red.at(-1).pud > 0.98, JSON.stringify({ tiltSteps, pudSteps }));
    check("reduced: and it still asks", red.at(-1).ph === "messy" && (await card(cdp))?.hidden === false);
    const cr = await card(cdp);
    await cdp.tapAt(cr.btn.x, cr.btn.y);
    const redMop = await sample(cdp, 12000, async () => ({ ph: await phase(cdp), pud: (await puddle(cdp)).size, tilt: await cupTilt(cdp) }), 40);
    const steps = [...new Set(redMop.map((s) => Math.round(s.pud * 1000) / 1000))].filter((v) => v > 0);
    check("reduced: the mopping still gets it all clean, in whole steps (at most the six sizes between full and nothing)", redMop.at(-1).pud === 0 && redMop.at(-1).tilt === 0 && redMop.at(-1).ph === "idle" && steps.length <= 6, JSON.stringify(steps));

    // ======================================= 5. sound off =======================================
    console.log("\n[5] sound off");
    await loadApp(cdp);
    await cdp.ev(`window.__tvWorld.handle.mute()`);
    await stage(cdp, "cup", 1.9);
    await clearToast(cdp);
    cdp.voiceUrls.length = 0;
    await tapProp(cdp, "cup");
    const toasts5 = new Set();
    await sample(cdp, 7500, async () => { const t = await toastText(cdp); if (t) toasts5.add(t); return 0; }, 50);
    const c5 = await card(cdp);
    check("sound off: no line was asked of the voice (nothing is said aloud)", !voices(cdp).some((u) => u.startsWith("/api/voice?s=")), JSON.stringify(voices(cdp)));
    check("sound off: but the words are all on the screen: 'Oh no, oh no!' as a toast and 'Clean?' on the card", toasts5.has(OH_NO) && c5 && !c5.hidden && c5.text === "Clean?", JSON.stringify({ toasts: [...toasts5], card: c5?.text }));
    await cdp.tapAt(c5.btn.x, c5.btn.y);
    const toasts5b = new Set();
    await sample(cdp, 9500, async () => { const t = await toastText(cdp); if (t) toasts5b.add(t); return 0; }, 50);
    check("sound off: and 'All clean! Hooray!' is shown too, and the room is clean", toasts5b.has(ALL_CLEAN) && (await phase(cdp)) === "idle" && (await puddle(cdp)).size === 0, JSON.stringify([...toasts5b]));

    check("no page exceptions", cdp.exceptions.length === 0, cdp.exceptions.slice(0, 3).join(" | "));
    killAll();
  } catch (err) {
    check("e2e ran to completion", false, String(err && err.stack || err));
    killAll();
  }
  const failed = results.filter((r) => !r.pass);
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : `  [${r.detail}]`}`);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}
main();
