#!/usr/bin/env node
// 390x844 headless-Chrome E2E for the second set of Toy Room toys (docs/specs/playful-interactions-spec.md section 6): tap the BOOKS and Kip reads three names aloud, tap the GUITAR and Kip picks it up and strums
// (notes float up), tap the BUBBLE set and Kip blows bubbles that can be popped with a tap, tap the DOG and it barks, then Kip pets it. Also: the dog is alive on its own (its tail never stops wagging).
// Real mouse events; /api/voice is intercepted (no spend). Needs a real GPU: --headless=new with the Metal backend. Run: node scripts/e2e-toyroom2.mjs
// Overrides: E2E_CHROME, E2E_PORT, E2E_DEBUG_PORT, E2E_PROFILE, E2E_SHOTS (screenshot directory).
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
const CHROME = process.env.E2E_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEV_PORT = Number(process.env.E2E_PORT ?? 5201);
const DEBUG_PORT = Number(process.env.E2E_DEBUG_PORT ?? 9351);
const PROFILE = process.env.E2E_PROFILE ?? "/tmp/toyforge-e2e-toyroom2-profile";
const SHOTS = process.env.E2E_SHOTS ?? "";
const APP = `http://localhost:${DEV_PORT}/`;

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
  const source = `try { ${lang === undefined ? 'localStorage.removeItem("toyforge:prop-lang:v1");' : `localStorage.setItem("toyforge:prop-lang:v1", ${JSON.stringify(lang)});`} } catch (e) {}`;
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


const world = (cdp, expr) => cdp.ev(`(() => { const w = window.__tvWorld; if (!w) return null; return ${expr}; })()`);
const shot = async (cdp, name) => { if (!SHOTS) return; mkdirSync(SHOTS, { recursive: true }); const r = await cdp.send("Page.captureScreenshot", { format: "png" }); writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(r.data, "base64")); };
const dismissSheet = (cdp) => cdp.ev(`(() => { if (!document.querySelector(".building")) return false; const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Later"); if (b) b.click(); return Boolean(b); })()`);
const prop = (cdp, type) => world(cdp, `(() => { const i = w.props.list().find((p) => p.type === ${JSON.stringify(type)}); return i ? { x: i.base.px, z: i.base.pz, h: i.size.y } : null; })()`);
const propScreen = (cdp, type) => world(cdp, `(() => { const i = w.props.list().find((p) => p.type === ${JSON.stringify(type)}); return i ? w.props.screenPos(i, 0.5) : null; })()`);
const phase = (cdp) => world(cdp, `w.acts.phase`);
const toy = (cdp) => world(cdp, `({ x: w.P.pos.x, z: w.P.pos.z, hop: w.P.hop || 0, busy: w.P.busy, action: w.getMix() ? w.getMix().busyAction : null, target: w.P.target ? w.P.target.x : null })`);
const ballState = (cdp) => world(cdp, `(() => { const i = w.props.list().find((p) => p.type === "ball"); return { x: i.base.px, y: i.holder.position.y, moving: !!i.kick, spin: i.pivot ? i.pivot.rotation.z : 0 }; })()`);
const scaleY = (cdp, type) => world(cdp, `w.props.list().find((p) => p.type === ${JSON.stringify(type)}).holder.scale.y`);
/** Poll fast for `ms`, collecting what a sampler sees. */
async function sample(cdp, ms, fn, every = 40) { const out = []; const end = Date.now() + ms; while (Date.now() < end) { out.push(await fn()); await sleep(every); } return out; }
/** Tap a prop where it is on screen RIGHT NOW (the camera eases after Kip moves, so a position read earlier can be a few pixels off). */
async function tapProp(cdp, type) { const p = await propScreen(cdp, type); await cdp.tapAt(p.x, p.y); return p; }
/** Put Kip `dx` units left of a prop, wait for it to be on screen and return where. */
async function stage(cdp, type, dx = 1.9) {          // (once the camera has settled Kip is near the middle: only about 2 units to its right are on screen)
  const p = await prop(cdp, type);
  await cdp.ev(`(() => { const w = window.__tvWorld; w.P.pos.x = ${p.x} - ${dx}; w.P.pos.z = 0; w.P.target = null; w.P.hop = 0; })()`);
  const on = await waitFor(async () => { await dismissSheet(cdp); const s = await propScreen(cdp, type); return s && s.visible && s.x > 30 && s.x < 360 && s.y > 120 && s.y < 760 ? s : null; }, { timeoutMs: 15000, label: `${type} on screen` });
  // the camera eases after Kip is moved: wait until the prop stops moving on screen
  let last = on, still = 0;
  for (let i = 0; i < 60 && still < 4; i++) { await sleep(100); const now = await propScreen(cdp, type); still = now && Math.hypot(now.x - last.x, now.y - last.y) < 1.5 ? still + 1 : 0; last = now || last; }
  return last;
}

const held = (cdp) => world(cdp, `w.held.item`);
const visible = (cdp, type) => world(cdp, `w.props.list().find((p) => p.type === ${JSON.stringify(type)}).holder.visible`);
const toasts = async (cdp, ms) => { const seen = new Set(); const end = Date.now() + ms; while (Date.now() < end) { const t = await toastText(cdp); if (t) seen.add(t); await sleep(60); } return [...seen]; };
const dogParts = (cdp) => world(cdp, `(() => { const i = w.props.list().find((p) => p.type === "dog"); const d = i.holder.userData.dogParts; return { tail: d.tail.rotation.y, headX: d.head.rotation.x, cue: i.holder.userData.cue ? i.holder.userData.cue.name : null, bob: d.body.position.y }; })()`);
/** The screen position of the first live bubble. */
const bubbleScreen = (cdp) => cdp.ev(`(() => { const sp = window.__tvWorld.bubbles.sprites[0]; if (!sp) return null; const cam = window.__tvDebug.camera; const v = sp.position.clone().project(cam); const r = document.querySelector("canvas").getBoundingClientRect(); return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height, on: Math.abs(v.x) < 1 && Math.abs(v.y) < 1 }; })()`);

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

    await loadApp(cdp, "en");
    await cdp.ev(`window.__tvWorld.handle.go("room")`);
    await sleep(3000);
    for (const t of ["books", "guitar", "bubbles", "dog"]) check(`setup: the Toy Room has ${t}`, Boolean(await prop(cdp, t)));
    await waitFor(() => world(cdp, `!!(w.getMix() && w.getMix().canDrive(w.P.rig))`), { timeoutMs: 30000, label: "the character clips" });

    // ---- the books: Kip reads three names aloud ----
    await stage(cdp, "books");
    await clearToast(cdp); cdp.voiceUrls.length = 0;
    await tapProp(cdp, "books");
    let shotBook = false;
    const read = await sample(cdp, 8200, async () => { const a = (await toy(cdp)).action; const h = await held(cdp); if (!shotBook && a === "read" && h === "book") { shotBook = true; await sleep(300); await shot(cdp, "1-reading"); } return { a, h, p: await phase(cdp), toast: await toastText(cdp) }; }, 80);
    check("books: Kip plays the read clip holding a book", read.some((s) => s.a === "read" && s.h === "book"), JSON.stringify([...new Set(read.map((s) => `${s.a}/${s.h}`))]));
    const names = [...new Set(read.map((s) => s.toast).filter(Boolean))];
    check("books: it says the names of things around it, one on each page (at least two different names)", names.length >= 3, JSON.stringify(names));
    const clips = [...new Set(cdp.voiceUrls)];
    check("books: and asks for those names' voice clips (at least two distinct)", clips.length >= 2, JSON.stringify(clips));
    check("books: the book is put away and Kip is free again", (await held(cdp)) === null && (await phase(cdp)) === "idle" && (await toy(cdp)).busy === false, JSON.stringify({ held: await held(cdp), phase: await phase(cdp) }));

    // ---- the guitar: picks it up off the stand and strums ----
    await stage(cdp, "guitar");
    check("guitar: it stands on its stand to begin with", (await visible(cdp, "guitar")) === true);
    await clearToast(cdp);
    await tapProp(cdp, "guitar");
    await sleep(200);
    check("guitar: a tap says its name", (await toastText(cdp)) === "Orange guitar", String(await toastText(cdp)));
    let shotGuitar = false;
    const play = await sample(cdp, 6500, async () => { const a = (await toy(cdp)).action; const h = await held(cdp); const v = await visible(cdp, "guitar"); const notes = await world(cdp, `w.acts.noteCount`); if (!shotGuitar && a === "strum" && notes >= 2) { shotGuitar = true; await shot(cdp, "2-guitar"); } return { a, h, v, notes }; }, 80);
    check("guitar: Kip strums holding the guitar, and the one on the stand is gone while it plays", play.some((s) => s.a === "strum" && s.h === "guitar" && s.v === false), JSON.stringify([...new Set(play.map((s) => `${s.a}/${s.h}/${s.v}`))]));
    check("guitar: music notes float up", Math.max(...play.map((s) => s.notes)) >= 2, String(Math.max(...play.map((s) => s.notes))));
    check("guitar: afterwards it is back on its stand and Kip's hands are empty", (await visible(cdp, "guitar")) === true && (await held(cdp)) === null && (await phase(cdp)) === "idle");

    // ---- the bubbles: blow, then pop one ----
    await stage(cdp, "bubbles");
    await clearToast(cdp);
    await tapProp(cdp, "bubbles");
    let shotBubbles = false;
    const blow = await sample(cdp, 3300, async () => { const a = (await toy(cdp)).action; const h = await held(cdp); const n = await world(cdp, `w.bubbles.count`); if (!shotBubbles && n >= 8) { shotBubbles = true; await shot(cdp, "3-bubbles"); } return { a, h, n }; }, 80);
    check("bubbles: Kip blows holding the wand", blow.some((s) => s.a === "blow" && s.h === "wand"), JSON.stringify([...new Set(blow.map((s) => `${s.a}/${s.h}`))]));
    check("bubbles: bubbles fill the air (at least eight at once)", Math.max(...blow.map((s) => s.n)) >= 8, String(Math.max(...blow.map((s) => s.n))));
    await waitFor(async () => ((await phase(cdp)) === "idle" ? true : null), { timeoutMs: 6000, everyMs: 60, label: "blowing over" });
    check("bubbles: the wand is put away", (await held(cdp)) === null);
    const before = await world(cdp, `w.bubbles.count`);
    const bs = await bubbleScreen(cdp);
    check("bubbles: there are bubbles left to pop, on screen", before >= 3 && bs && bs.on, JSON.stringify({ before, bs }));
    if (bs && bs.on) {
      await cdp.tapAt(bs.x, bs.y);
      await sleep(120);
      const after = await world(cdp, `w.bubbles.count`);
      check("bubbles: a tap on a bubble pops it (one fewer), and Kip does not walk off", after === before - 1 && (await toy(cdp)).target === null, JSON.stringify({ before, after, toy: await toy(cdp) }));
    }

    // ---- the dog: alive on its own, barks when tapped, then Kip pets it ----
    await stage(cdp, "dog");
    const idle = await sample(cdp, 1500, async () => (await dogParts(cdp)).tail, 50);
    check("dog: it is alive: its tail wags on its own (it sweeps both ways)", Math.max(...idle) > 0.2 && Math.min(...idle) < -0.2, JSON.stringify([Math.min(...idle), Math.max(...idle)]));
    await clearToast(cdp);
    await tapProp(cdp, "dog");
    const bark = await sample(cdp, 500, async () => (await dogParts(cdp)).bob, 20);           // (the first woof is in the first 0.15 s: start sampling at once)
    check("dog: a tap says its name", (await toastText(cdp)) === "Brown dog", String(await toastText(cdp)));
    check("dog: it barks and hops (its body lifts off the floor)", Math.max(...bark) > 0.78 + 0.05, String(Math.max(...bark)));
    let shotDog = false;
    const pet = await sample(cdp, 4000, async () => { const a = (await toy(cdp)).action; const d = await dogParts(cdp); const hearts = await world(cdp, `w.acts.heartCount`); if (!shotDog && a === "pet" && hearts >= 1) { shotDog = true; await shot(cdp, "4-dog"); } return { a, cue: d.cue, hearts, tail: d.tail }; }, 60);
    check("dog: Kip walks over and pets it", pet.some((s) => s.a === "pet"), JSON.stringify([...new Set(pet.map((s) => s.a))]));
    check("dog: which it loves (wags harder), with hearts floating up", pet.some((s) => s.cue === "pet") && pet.some((s) => s.hearts >= 1), JSON.stringify({ cue: [...new Set(pet.map((s) => s.cue))], hearts: Math.max(...pet.map((s) => s.hearts)) }));
    await waitFor(async () => ((await phase(cdp)) === "idle" ? true : null), { timeoutMs: 6000, everyMs: 60, label: "petting over" });
    check("dog: Kip is free to move again", (await toy(cdp)).busy === false);

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
