#!/usr/bin/env node
// 390x844 headless-Chrome E2E for DRAG-TO-FEED (docs/specs/playful-interactions-spec.md section 4; Dan chose drag over tap on 2026-11-03).
// Boots the real app on its own vite port and drives the real Garden with real mouse events: presses on a hanging apple, drags it across the stage, and lets go over
// Kip (it is eaten and Kip plays the `eat` clip) or away from Kip (it falls and rests). Also: no speech until a press is RELEASED without moving (a drag is not a tap),
// the third apple fills Kip (a belly pat, then a refusal), and the apple under the finger really is under the finger. /api/voice is intercepted (no spend).
// Needs a real GPU: --headless=new with the Metal backend. Run: node scripts/e2e-feeding.mjs
// Overrides: E2E_CHROME, E2E_PORT, E2E_DEBUG_PORT, E2E_PROFILE, E2E_SHOTS (a directory: screenshots of the drag and the bite are saved there). Exits nonzero on any failing check.
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
const CHROME = process.env.E2E_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEV_PORT = Number(process.env.E2E_PORT ?? 5197);
const DEBUG_PORT = Number(process.env.E2E_DEBUG_PORT ?? 9347);
const PROFILE = process.env.E2E_PROFILE ?? "/tmp/toyforge-e2e-feeding-profile";
const SHOTS = process.env.E2E_SHOTS ?? "";
const APP = `http://localhost:${DEV_PORT}/?title=0`; // ?title=0: straight into the world, not the main menu (src/features/game/world/titleEntries.ts)

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

const LANE_JS = "p.holder.position.x >= 3 && p.holder.position.x <= 41";
const results = [];
const check = (name, pass, detail = "") => results.push({ name, pass: Boolean(pass), detail });
const clickButton = (cdp, sel, textStart) => cdp.ev(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => (x.getAttribute("aria-label") || x.textContent || "").trim().startsWith(${JSON.stringify(textStart)})); if (b) { b.click(); return true; } return false; })()`);
const toastText = (cdp) => cdp.ev(`(() => { const t = document.querySelector("#toast"); return t && t.classList.contains("on") ? t.textContent : null; })()`);
const clearToast = (cdp) => cdp.ev(`(() => { const t = document.querySelector("#toast"); if (t) t.classList.remove("on"); })()`);
const props = (cdp, expr) => cdp.ev(`(() => { const fx = window.__tvWorld && window.__tvWorld.props; if (!fx) return null; return ${expr}; })()`);

async function loadApp(cdp, lang) {
  const source = `try { localStorage.setItem("tvTimeOfDay:v1", "night"); } catch (e) {} try { ${lang === undefined ? 'localStorage.removeItem("toyforge:prop-lang:v1");' : `localStorage.setItem("toyforge:prop-lang:v1", ${JSON.stringify(lang)});`} } catch (e) {}`;
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
}

/** Walk the toy to a prop, wait for the camera, and return where it is on screen. */
async function bringIntoView(cdp, type) {
  const info = await props(cdp, `(() => { const i = fx.list().find((p) => p.type === ${JSON.stringify(type)} && p.holder.position.x >= 3 && p.holder.position.x <= 41); return i ? { x: i.holder.position.x, ok: true } : null; })()`);
  if (!info) return null;
  await cdp.ev(`(() => { const w = window.__tvWorld; w.P.pos.x = ${info.x}; w.P.target = null; })()`);
  try {
    await waitFor(async () => {
      const s = await props(cdp, `(() => { const i = fx.list().find((p) => p.type === ${JSON.stringify(type)} && p.holder.position.x >= 3 && p.holder.position.x <= 41); return fx.screenPos(i, ${type === "tree" ? 0.12 : 0.5}); })()`);
      return s && s.visible && s.x > 30 && s.x < 360 && s.y > 70 && s.y < 760 ? s : null;
    }, { timeoutMs: 15000, label: `${type} on screen` });
  } catch (err) {
    const diag = await props(cdp, `JSON.stringify({ toy: window.__tvWorld.P.pos.x, target: window.__tvWorld.P.target && window.__tvWorld.P.target.x, props: fx.list().map((p) => ({ t: p.type, x: +p.holder.position.x.toFixed(1), z: +p.holder.position.z.toFixed(1), s: (({ x, y, visible }) => ({ x: Math.round(x), y: Math.round(y), visible }))(fx.screenPos(p)) })) })`);
    throw new Error(`${err.message} | ${diag}`);
  }
  await sleep(600);
  return props(cdp, `(() => { const i = fx.list().find((p) => p.type === ${JSON.stringify(type)} && p.holder.position.x >= 3 && p.holder.position.x <= 41); return fx.screenPos(i, ${type === "tree" ? 0.12 : 0.5}); })()`);
}


const LANE = "p.holder.position.x >= 3 && p.holder.position.x <= 41";
const world = (cdp, expr) => cdp.ev(`(() => { const w = window.__tvWorld; if (!w) return null; return ${expr}; })()`);
/** Where a world point is on screen, in client pixels. */
const screenOf = (cdp, pointExpr) => cdp.ev(`(() => { const cam = window.__tvDebug.camera; const v = (${pointExpr}).project(cam); const r = document.querySelector("canvas").getBoundingClientRect(); return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height, on: Math.abs(v.x) < 1 && Math.abs(v.y) < 1 }; })()`);
const V3 = "new window.__tvDebug.camera.position.constructor";
const toyAt = (cdp) => screenOf(cdp, `${V3}(window.__tvWorld.P.pos.x, 1.1, window.__tvWorld.P.pos.z)`);
const hangingApple = (cdp) => screenOf(cdp, `(() => { const i = window.__tvWorld.props.list().find((p) => p.type === "tree" && ${LANE}); const s = i.slots.find((sl) => sl.mesh); if (!s) throw new Error("no hanging apple"); return s.mesh.getWorldPosition(${V3}()); })()`);
const carriedApple = (cdp) => screenOf(cdp, `(() => { const f = window.__tvWorld.props.fallers.find((x) => x.state === 3); if (!f) throw new Error("nothing carried"); return f.mesh.position.clone(); })()`);
const hangingCount = (cdp) => world(cdp, `w.props.list().find((p) => p.type === "tree" && ${LANE}).slots.filter((s) => s.mesh).length`);
const regrowAll = (cdp) => world(cdp, `(() => { for (const s of w.props.list().find((p) => p.type === "tree" && ${LANE}).slots) if (!s.mesh) s.regrowAt = 0.001; return true; })()`);
const action = (cdp) => world(cdp, `w.getMix() ? w.getMix().busyAction : "no-mix"`);
const fallerStates = (cdp) => world(cdp, `JSON.stringify(w.props.fallers.map((f) => f.state))`);
const shot = async (cdp, name) => { if (!SHOTS) return; mkdirSync(SHOTS, { recursive: true }); const r = await cdp.send("Page.captureScreenshot", { format: "png" }); writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(r.data, "base64")); };
const mouse = (cdp, type, x, y) => cdp.send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: type === "mouseMoved" ? 0 : 1 });
/** Press at a, drag in steps to b, and (optionally) release. Returns after the last move. */
async function dragTo(cdp, a, b, { release = true, steps = 8, onMid } = {}) {
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: a.x, y: a.y });
  await mouse(cdp, "mousePressed", a.x, a.y);
  for (let i = 1; i <= steps; i++) {
    await mouse(cdp, "mouseMoved", a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps);
    await sleep(40);
    if (i === Math.ceil(steps / 2) && onMid) await onMid();
  }
  if (release) await mouse(cdp, "mouseReleased", b.x, b.y);
}

async function main() {
  rmSync(PROFILE, { recursive: true, force: true });
  const dev = spawn("npx", ["vite", "--port", String(DEV_PORT), "--strictPort"], { cwd: ROOT, stdio: "ignore" });
  const chrome = spawn(CHROME, ["--headless=new", "--use-angle=metal", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required",
    `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${PROFILE}`, "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
  const killAll = () => { try { chrome.kill(); } catch {} try { dev.kill(); } catch {} };
  process.on("SIGINT", () => { killAll(); process.exit(130); });
  try {
    await waitFor(async () => (await fetch(APP)).ok || null, { label: APP });
    await waitFor(async () => (await fetch(`http://localhost:${DEBUG_PORT}/json/version`)).ok || null, { label: "chrome" });
    await fetch(`http://localhost:${DEBUG_PORT}/json/new?about:blank`, { method: "PUT" });
    const targets = await waitFor(async () => { const l = (await (await fetch(`http://localhost:${DEBUG_PORT}/json/list`)).json()).filter((t) => t.url === "about:blank"); return l.length ? l : null; }, { label: "new tab" });
    const cdp = new Cdp(targets[0].webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await cdp.send("Runtime.enable"); await cdp.send("Page.enable");
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/voice*" }] });

    await loadApp(cdp, "en");
    const treeAt = await bringIntoView(cdp, "tree");
    check("setup: a tree is on screen", Boolean(treeAt));
    // The toy stands a few units to the LEFT of the tree (the camera keeps the toy left of centre, so the tree is then on screen too), and the Mixamo clips are loaded.
    const treeX = await props(cdp, `fx.list().find((p) => p.type === "tree" && ${LANE_JS}).holder.position.x`);
    await cdp.ev(`(() => { const w = window.__tvWorld; w.P.pos.x = ${treeX} - 3.2; w.P.target = null; })()`);
    await waitFor(() => world(cdp, `!!(w.getMix() && w.getMix().canDrive(w.P.rig))`), { timeoutMs: 30000, label: "the character clips" });
    await sleep(1200);
    check("setup: Kip is a character the clips can drive", (await world(cdp, `w.getMix().canDrive(w.P.rig)`)) === true);
    const toy = await toyAt(cdp);
    const apple0 = await hangingApple(cdp);
    check("setup: Kip and the apples are both on screen", toy.on && apple0.on && apple0.x > 20 && apple0.x < 370, JSON.stringify({ toy, apple0 }));

    // ---- 1. a drag is not a tap: nothing is said while carrying; the apple really is under the finger ----
    await clearToast(cdp); cdp.voiceUrls.length = 0;
    const a1 = await hangingApple(cdp);
    // A drop point well away from Kip (the toy's drop target is generous), and still on screen.
    const kip0 = await toyAt(cdp);
    const away = [{ x: a1.x + 80, y: a1.y - 90 }, { x: a1.x + 80, y: a1.y + 90 }, { x: a1.x, y: a1.y - 160 }, { x: a1.x + 80, y: a1.y }]
      .find((c) => c.x > 20 && c.x < 370 && c.y > 60 && c.y < 780 && Math.hypot(c.x - kip0.x, c.y - kip0.y) > 190);
    check("setup: found a drop point away from Kip", Boolean(away), JSON.stringify({ a1, kip0 }));
    let mid = null;
    await dragTo(cdp, a1, away, { release: false, steps: 6, onMid: async () => { mid = { carried: await fallerStates(cdp), hanging: await hangingCount(cdp), toast: await toastText(cdp) }; } });
    check("drag: halfway, the apple is lifted off the tree (one carried, two left hanging)", mid && mid.carried === "[3]" && mid.hanging === 2, JSON.stringify(mid));
    check("drag: nothing was said while it was carried (a drag is not a tap)", mid && mid.toast === null && cdp.voiceUrls.length === 0, JSON.stringify({ toast: mid?.toast, voice: cdp.voiceUrls }));
    const under = await carriedApple(cdp);
    check("drag: the carried apple is under the finger (within 30 px)", Math.hypot(under.x - away.x, under.y - away.y) < 30, `finger ${JSON.stringify(away)} apple ${JSON.stringify(under)}`);
    await shot(cdp, "1-carrying");

    // ---- 2. let go away from Kip: it falls and rests; nothing is eaten ----
    await mouse(cdp, "mouseReleased", away.x, away.y);
    // It may be let go high up: a fall, a bounce, a settle. Watch the whole time for any eating clip (Kip's random idle fidget, a nod or a head shake, may play too: that is not eating).
    const clipsSeen = new Set();
    for (let k = 0; k < 28; k++) { clipsSeen.add(await action(cdp)); await sleep(100); }
    check("drop: it fell and is resting on the ground", (await fallerStates(cdp)) === "[1]", String(await fallerStates(cdp)));
    check("drop: Kip did not eat it (no eat, belly pat or sour clip at any time)", !["eat", "belly_pat", "sour"].some((a) => clipsSeen.has(a)), JSON.stringify([...clipsSeen]));
    check("drop: still nothing said", (await toastText(cdp)) === null && cdp.voiceUrls.length === 0);

    // ---- 3. a press and release without moving is still a tap: it says the name (on release) ----
    await clearToast(cdp); cdp.voiceUrls.length = 0;
    const a2 = await hangingApple(cdp);
    await mouse(cdp, "mousePressed", a2.x, a2.y);
    await sleep(120);
    check("tap: nothing is said on the press itself", (await toastText(cdp)) === null);
    await mouse(cdp, "mouseReleased", a2.x, a2.y);
    await sleep(400);
    check("tap: released without moving, it says 'Red apple'", (await toastText(cdp)) === "Red apple", String(await toastText(cdp)));
    check("tap: and the clip for exactly that fruit was asked for", cdp.voiceUrls.includes("/api/voice?lang=en&n=apple&c=red"), JSON.stringify(cdp.voiceUrls));

    // ---- 4. feed Kip: drag an apple onto Kip ----
    await regrowAll(cdp);
    await sleep(1200);
    const fallersBefore = await world(cdp, `w.props.fallerCount()`);
    const a3 = await hangingApple(cdp);
    const kip = await toyAt(cdp);
    await dragTo(cdp, a3, kip, { release: false, steps: 8 });
    await shot(cdp, "2-over-kip");
    check("feed: while it is over Kip it is still being carried", (await fallerStates(cdp)).includes("3"), String(await fallerStates(cdp)));
    await mouse(cdp, "mouseReleased", kip.x, kip.y);
    await shot(cdp, "3-released");
    const sawEat = await waitFor(async () => ((await action(cdp)) === "eat" ? true : null), { timeoutMs: 1500, everyMs: 30, label: "the eat clip" }).catch(() => false);
    check("feed: Kip plays the `eat` clip", sawEat === true, String(await action(cdp)));
    await sleep(350);
    await shot(cdp, "4-biting");
    await sleep(700);
    check("feed: the apple is gone (eaten, not dropped)", (await world(cdp, `w.props.fallerCount()`)) <= fallersBefore, `before=${fallersBefore} now=${await world(cdp, `w.props.fallerCount()`)}`);
    check("feed: a fed apple does not leave a faller behind that is carried or flying", !(await fallerStates(cdp)).includes("3") && !(await fallerStates(cdp)).includes("4"), String(await fallerStates(cdp)));

    // ---- 5. the third apple in a row fills Kip: a belly pat, then Kip politely refuses ----
    await sleep(1500);
    for (let n = 2; n <= 3; n++) {
      await regrowAll(cdp); await sleep(1100);
      const a = await hangingApple(cdp); const k = await toyAt(cdp);
      await dragTo(cdp, a, k, { release: true, steps: 6 });
      await sleep(n === 3 ? 100 : 2400);
    }
    const sawPat = await waitFor(async () => ((await action(cdp)) === "belly_pat" ? true : null), { timeoutMs: 4500, everyMs: 50, label: "the belly pat" }).catch(() => false);
    check("full: after the third apple Kip pats its belly", sawPat === true, String(await action(cdp)));
    await shot(cdp, "5-belly-pat");
    await sleep(2200);
    await regrowAll(cdp); await sleep(1100);
    const a4 = await hangingApple(cdp); const k4 = await toyAt(cdp);
    await dragTo(cdp, a4, k4, { release: true, steps: 6 });
    await sleep(300);
    const act = await action(cdp);
    check("full: a fourth apple is refused: Kip does not eat, and the apple falls to the ground", act !== "eat" && ((await fallerStates(cdp)).includes("0") || (await fallerStates(cdp)).includes("1")), `${act} ${await fallerStates(cdp)}`);

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
