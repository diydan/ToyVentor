#!/usr/bin/env node
// A cheap look at the real game: start the dev server and a real-GPU headless Chrome (390x844 @2x, Metal), go to one world, run a few steps and save screenshots. It is NOT a test suite (no checks,
// one page load): it is the "open the page and look" step for a change while the full e2e suite is paused. Prints whatever `eval` steps return.
//
//   node scripts/shots.mjs --world beach --out /tmp/shots --steps '[{"stage":"sandcastle"},{"shot":"a"},{"tap":"sandcastle"},{"wait":900},{"shot":"b"}]'
//
// Steps: {"stage":"<prop type>","dx":1.9,"i":0}  walk Kip next to the i-th prop of that type and wait for the camera
//        {"tap":"<prop type>","i":0,"at":0.5}      a real mouse tap on the prop where it is on screen right now (`at` = how far up the prop, 0..1)
//        {"act":"<prop type>","i":0}  start that prop's act directly (what a tap on it does after the prop reacted), skipping the screen hit test
//        {"activate":"<prop type>","i":0}  what a tap on the prop itself does (its own reaction, e.g. a crane drops a crate), skipping the screen hit test
//        {"drag":{"from":"<prop type>","i":0,"toProp":"basket","j":0,"at":0.5}}  or  {"drag":{"from":"tree","to":[x,y]}}  press a hanging fruit of that prop, carry it and let go (real mouse events)
//        {"tapxy":[x,y]}  a real tap at a screen point      {"wait":ms}      {"shot":"name"}  a screenshot to <out>/<name>.png
//        {"eval":"<js>"}  evaluate in the page (the dev handle is `w` = window.__tvWorld) and print the result
// Options: --world <id> (default garden)  --time day|night (pin; default night)  --lang <code>  --out <dir>  --port <n>  --debug-port <n>
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const opt = (name, d) => { const i = argv.indexOf("--" + name); return i >= 0 ? argv[i + 1] : d; };
const ROOT = new URL("..", import.meta.url).pathname;
const CHROME = process.env.E2E_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEV_PORT = Number(opt("port", 5231));
const DEBUG_PORT = Number(opt("debug-port", 9371));
const PROFILE = `/tmp/toyforge-shots-profile-${DEBUG_PORT}`;
const WORLD = opt("world", "garden");
const TIME = opt("time", "night");
const LANG = opt("lang", "en");
const OUT = opt("out", "/tmp/toyforge-shots");
const STEPS = JSON.parse(opt("steps", "[]"));
const APP = `http://localhost:${DEV_PORT}/?title=0`;

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
function silentWavB64() {
  const n = 2400, bytes = n * 2, b = Buffer.alloc(44 + bytes);
  b.write("RIFF", 0); b.writeUInt32LE(36 + bytes, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(24000, 24); b.writeUInt32LE(48000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(bytes, 40);
  return b.toString("base64");
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
        if (m.id != null && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
        else if (m.method === "Runtime.exceptionThrown") this.exceptions.push(m.params?.exceptionDetails?.exception?.description || m.params?.exceptionDetails?.text || "exception");
        else if (m.method === "Fetch.requestPaused") {
          const { requestId, request } = m.params;
          if (request.url.includes("/api/voice")) this.send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "content-type", value: "audio/wav" }], body: silentWavB64() }).catch(() => {});
          else this.send("Fetch.continueRequest", { requestId }).catch(() => {});
        }
      });
    });
  }
  send(method, params = {}) { const id = this.id++; return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async ev(expr) {
    const r = await this.send("Runtime.evaluate", { expression: expr, returnByValue: true });
    if (r?.exceptionDetails) throw new Error("evaluate threw: " + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails).slice(0, 700));
    return r?.result?.value;
  }
  async tapAt(x, y) {
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  }
}
const world = (cdp, expr) => cdp.ev(`(() => { const w = window.__tvWorld; if (!w) return null; return ${expr}; })()`);
const nth = (type, i) => `w.props.list().filter((p) => p.type === ${JSON.stringify(type)})[${i}]`;
const screenOf = (cdp, type, i, at) => world(cdp, `(() => { const p = ${nth(type, i)}; return p ? w.props.screenPos(p, ${at}) : null; })()`);
const dismissSheet = (cdp) => cdp.ev(`(() => { if (!document.querySelector(".building")) return false; const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Later"); if (b) b.click(); return Boolean(b); })()`);

async function stage(cdp, type, dx, i) {
  const p = await world(cdp, `(() => { const p = ${nth(type, i)}; return p ? { x: p.base.px } : null; })()`);
  if (!p) throw new Error(`no ${type} #${i} in ${WORLD}`);
  await cdp.ev(`(() => { const w = window.__tvWorld; w.P.pos.x = ${p.x} - ${dx}; w.P.pos.z = 0; w.P.target = null; w.P.hop = 0; })()`);
  const on = await waitFor(async () => { await dismissSheet(cdp); const s = await screenOf(cdp, type, i, 0.5); return s && s.visible && s.x > 30 && s.x < 360 && s.y > 120 && s.y < 760 ? s : null; }, { timeoutMs: 15000, label: `${type} on screen` });
  let last = on, still = 0;
  for (let k = 0; k < 60 && still < 4; k++) { await sleep(100); const now = await screenOf(cdp, type, i, 0.5); still = now && Math.hypot(now.x - last.x, now.y - last.y) < 1.5 ? still + 1 : 0; last = now || last; }
  return last;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const dev = spawn("npx", ["vite", "--port", String(DEV_PORT), "--strictPort"], { cwd: ROOT, stdio: "ignore" });
  const chrome = spawn(CHROME, ["--headless=new", "--use-angle=metal", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required",
    `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${PROFILE}`, "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
  let cdp = null;
  try {
    await waitFor(async () => (await fetch(APP)).ok || null, { label: APP, timeoutMs: 120000 });
    await waitFor(async () => (await fetch(`http://localhost:${DEBUG_PORT}/json/version`)).ok || null, { label: "chrome" });
    await fetch(`http://localhost:${DEBUG_PORT}/json/new?about:blank`, { method: "PUT" });
    const targets = await waitFor(async () => { const l = (await (await fetch(`http://localhost:${DEBUG_PORT}/json/list`)).json()).filter((t) => t.url === "about:blank"); return l.length ? l : null; }, { label: "tab" });
    cdp = new Cdp(targets[0].webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await cdp.send("Runtime.enable"); await cdp.send("Page.enable");
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/voice*" }] });
    const source = `try { localStorage.setItem("tvTimeOfDay:v1", ${JSON.stringify(TIME)}); localStorage.setItem("toyforge:prop-lang:v1", ${JSON.stringify(LANG)}); } catch (e) {}`;
    const { identifier } = await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source });
    try {
      await cdp.send("Page.navigate", { url: APP });
      await waitFor(() => cdp.ev(`!!document.querySelector("canvas") && !!(window.__tvWorld && window.__tvWorld.props)`), { label: "stage + dev handle" });
    } finally { await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier }); }
    await sleep(2000);
    await cdp.ev(`(() => { const t = document.querySelector("#title"); if (t && !t.hidden) document.querySelector("#play")?.click(); })()`);
    await sleep(1500);
    if (WORLD !== "room") { await cdp.ev(`window.__tvWorld.handle.go("room")`); await sleep(1500); }
    await cdp.ev(`window.__tvWorld.handle.go(${JSON.stringify(WORLD)})`);
    await sleep(WORLD === "room" ? 2200 : 3000);
    await dismissSheet(cdp);
    for (const s of STEPS) {
      if (s.stage) { const at = await stage(cdp, s.stage, s.dx ?? 1.9, s.i ?? 0); console.log("staged", s.stage, JSON.stringify(at)); }
      else if (s.tap) { const p = await screenOf(cdp, s.tap, s.i ?? 0, s.at ?? 0.5); if (!p) throw new Error(`no ${s.tap} to tap`); await cdp.tapAt(p.x, p.y); console.log("tapped", s.tap, Math.round(p.x), Math.round(p.y)); }
      else if (s.act) { const r = await world(cdp, `(() => { const p = ${nth(s.act, s.i ?? 0)}; return p ? w.acts.tap(p) : "no prop"; })()`); console.log("act", s.act, JSON.stringify(r)); }
      else if (s.activate) { const r = await world(cdp, `(() => { const p = ${nth(s.activate, s.i ?? 0)}; if (!p) return "no prop"; w.props.activate(p); return true; })()`); console.log("activate", s.activate, JSON.stringify(r)); }
      else if (s.drag) {                       // press on a fruit of a prop (a hanging fruit of the i-th prop of that type), carry it to a point or onto another prop, let go
        const from = await world(cdp, `(() => { const p = ${nth(s.drag.from, s.drag.i ?? 0)}; const sl = p.slots.find((q) => q.mesh); if (!sl) return null; const v = sl.mesh.getWorldPosition(new w.P.pos.constructor()).project(window.__tvDebug.camera); const r = document.querySelector("canvas").getBoundingClientRect(); return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height }; })()`);
        const to = s.drag.toProp ? await screenOf(cdp, s.drag.toProp, s.drag.j ?? 0, s.drag.at ?? 0.5) : { x: s.drag.to[0], y: s.drag.to[1] };
        if (!from || !to) throw new Error("drag: no fruit or no target");
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x, y: from.y });
        await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", clickCount: 1 });
        for (const k of [0.15, 0.4, 0.7, 1]) { await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, button: "left", buttons: 1 }); await sleep(60); }
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: to.x, y: to.y, button: "left", clickCount: 1 });
        console.log("dragged", Math.round(from.x), Math.round(from.y), "->", Math.round(to.x), Math.round(to.y));
      }
      else if (s.tapxy) { await cdp.tapAt(s.tapxy[0], s.tapxy[1]); console.log("tapped", s.tapxy.join(",")); }
      else if (s.wait) await sleep(s.wait);
      else if (s.shot) { const r = await cdp.send("Page.captureScreenshot", { format: "png" }); writeFileSync(`${OUT}/${s.shot}.png`, Buffer.from(r.data, "base64")); console.log("shot", `${OUT}/${s.shot}.png`); }
      else if (s.eval) console.log("eval", JSON.stringify(await world(cdp, s.eval)));
      else throw new Error("unknown step " + JSON.stringify(s));
    }
    if (cdp.exceptions.length) console.log("PAGE EXCEPTIONS:", cdp.exceptions.slice(0, 5).join(" | "));
  } finally {
    try { cdp?.ws?.close(); } catch { /* ignore */ }
    chrome.kill("SIGKILL"); dev.kill("SIGKILL");
    spawn("pkill", ["-f", `--port ${DEV_PORT}`], { stdio: "ignore" });
  }
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
