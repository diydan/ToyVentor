#!/usr/bin/env node
// 390x844 headless-Chrome E2E for the second set of Toy Room toys (docs/specs/playful-interactions-spec.md section 6): tap the BOOKS and Kip reads three names aloud, tap the GUITAR and Kip picks it up and strums
// (notes float up), tap the BUBBLE set and Kip blows bubbles that can be popped with a tap, tap the DOG and it barks, then Kip pets it. Also: the dog is alive on its own (its tail never stops wagging), and the dog fetches a kicked ball and brings it back.
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

const barScreen = (cdp, i) => cdp.ev(`(() => { const inst = window.__tvWorld.props.list().find((p) => p.type === "xylophone"); const bar = inst.holder.userData.bars[${i}]; const v = bar.getWorldPosition(new window.__tvDebug.camera.position.constructor()).project(window.__tvDebug.camera); const r = document.querySelector("canvas").getBoundingClientRect(); return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height, on: Math.abs(v.x) < 1 && Math.abs(v.y) < 1 }; })()`);
const barYs = (cdp) => cdp.ev(`(() => { const inst = window.__tvWorld.props.list().find((p) => p.type === "xylophone"); return inst.holder.userData.bars.map((b) => +(b.position.y - 0.04).toFixed(4)); })()`);
async function check_xylophone(cdp) {
  check("setup: the Toy Room has a xylophone", Boolean(await prop(cdp, "xylophone")));
  await stage(cdp, "xylophone", 1.9);
  await shot(cdp, "6-xylophone");
  // a tap on a bar: it rings (dips), nothing is said, Kip is not sent over
  await clearToast(cdp);
  const b4 = await barScreen(cdp, 4);
  check("xylophone: a bar is on screen to tap", b4.on && b4.x > 20 && b4.x < 370 && b4.y > 150, JSON.stringify(b4));
  await cdp.tapAt(b4.x, b4.y);
  const ring = await sample(cdp, 400, async () => barYs(cdp), 25);
  check("xylophone: tapping a bar rings that bar (it dips) and no other", Math.min(...ring.map((r) => r[4])) < -0.02 && ring.every((r) => r.every((y, i) => i === 4 || Math.abs(y) < 0.001)), JSON.stringify(ring.map((r) => r[4]).slice(0, 8)));
  check("xylophone: a bar tap says nothing and does not send Kip over", (await toastText(cdp)) === null && (await phase(cdp)) === "idle" && (await toy(cdp)).target === null, JSON.stringify({ toast: await toastText(cdp), phase: await phase(cdp) }));
  // tap each bar in turn: every one rings
  const seen = new Set();
  for (let i = 0; i < 8; i++) {
    const b = await barScreen(cdp, i);
    if (!(b.on && b.x > 10 && b.x < 380)) continue;
    await cdp.tapAt(b.x, b.y);
    const ys = await sample(cdp, 160, async () => barYs(cdp), 25);
    if (Math.min(...ys.map((r) => r[i])) < -0.02) seen.add(i);
  }
  check("xylophone: every bar on screen rings when it is tapped", seen.size >= 6, JSON.stringify([...seen]));
  // a tap on the frame: Kip plays the tune
  await sleep(700);
  await clearToast(cdp);
  const inst = await propScreen(cdp, "xylophone");
  const legs = await cdp.ev(`(() => { const i = window.__tvWorld.props.list().find((p) => p.type === "xylophone"); const v = i.holder.localToWorld(new window.__tvDebug.camera.position.constructor(-1.55, 0.3, 0.35)).project(window.__tvDebug.camera); const r = document.querySelector("canvas").getBoundingClientRect(); return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height }; })()`);
  await cdp.tapAt(legs.x, legs.y);
  await sleep(250);
  check("xylophone: a tap on its frame names it", (await toastText(cdp)) === "Colorful xylophone", JSON.stringify({ toast: await toastText(cdp), legs, inst }));
  let shotTune = false;
  const tune = await sample(cdp, 6500, async () => { const a = (await toy(cdp)).action; const ys = await barYs(cdp); const notes = await world(cdp, `w.acts.noteCount`); if (!shotTune && a === "mallet" && notes >= 2) { shotTune = true; await shot(cdp, "7-xylophone-tune"); } const held = await world(cdp, `w.held.item`); const mallets = (await world(cdp, `w.held.meshes.length`)); const floor = await world(cdp, `w.props.list().find((p) => p.type === "xylophone").holder.userData.mallets.visible`); return { a, ys, notes, held, mallets, floor }; }, 40);
  check("xylophone: Kip plays the mallet clip", tune.some((s) => s.a === "mallet"), JSON.stringify([...new Set(tune.map((s) => s.a))]));
  const rung = new Set(); for (const s of tune) s.ys.forEach((y, i) => { if (y < -0.02) rung.add(i); });
  check("xylophone: it plays a tune over several different bars", rung.size >= 4, JSON.stringify([...rung]));
  check("xylophone: music notes float up", Math.max(...tune.map((s) => s.notes)) >= 2, String(Math.max(...tune.map((s) => s.notes))));
  check("xylophone: Kip holds a mallet in each hand while it plays", tune.some((s) => s.held === "mallets" && s.mallets === 2), JSON.stringify([...new Set(tune.map((s) => `${s.held}/${s.mallets}`))]));
  check("xylophone: the mallets leave the ledge while Kip has them, and are back on it afterwards", tune.some((s) => s.held === "mallets" && s.floor === false) && !tune.some((s) => s.held === "mallets" && s.floor === true) && tune.at(-1).floor === true && tune.at(-1).held === null, JSON.stringify([...new Set(tune.map((s) => `${s.held}/${s.floor}`))]));
  check("xylophone: Kip is free again afterwards", (await phase(cdp)) === "idle" && (await toy(cdp)).busy === false);
  // the base plank is the big, plain, visible part of the frame: a tap on its front edge starts the tune too
  await sleep(500);
  await clearToast(cdp);
  const edge = await cdp.ev(`(() => { const i = window.__tvWorld.props.list().find((p) => p.type === "xylophone"); const v = i.holder.localToWorld(new window.__tvDebug.camera.position.constructor(1.0, 0.14, 0.8)).project(window.__tvDebug.camera); const r = document.querySelector("canvas").getBoundingClientRect(); return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height }; })()`);
  const before = await barYs(cdp);
  await cdp.tapAt(edge.x, edge.y);
  await sleep(350);
  const plankToast = await toastText(cdp);
  const plankPhase = await phase(cdp);
  check("xylophone: a tap on the front of the base plank names it and sends Kip over, and rings no bar", plankToast === "Colorful xylophone" && plankPhase !== "idle" && before.every((y) => Math.abs(y) < 0.001), JSON.stringify({ edge, plankToast, plankPhase }));
  await cdp.ev(`(() => { const w = window.__tvWorld; w.acts.reset(); w.P.busy = false; w.P.hop = 0; return true; })()`);
}

// ---- the block tower: each tap stacks a block, the tap on a full tower brings it down, then it is rebuilt ----
const blocksState = (cdp) => cdp.ev(`(() => { const i = window.__tvWorld.props.list().find((p) => p.type === "blocks"); const b = i.holder.userData.blocks; const t = i.holder.userData.tower; return { layers: t.layers, phase: t.phase, visible: b.filter((m) => m.visible).length, ys: b.map((m) => +m.position.y.toFixed(3)), xs: b.map((m) => +m.position.x.toFixed(2)) }; })()`);
const blockScreen = (cdp, k) => cdp.ev(`(() => { const i = window.__tvWorld.props.list().find((p) => p.type === "blocks"); const m = i.holder.userData.blocks[${k}]; const v = m.getWorldPosition(new window.__tvDebug.camera.position.constructor()).project(window.__tvDebug.camera); const r = document.querySelector("canvas").getBoundingClientRect(); return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height, on: Math.abs(v.x) < 0.95 && Math.abs(v.y) < 0.95 }; })()`);
async function check_blocks(cdp) {
  await cdp.ev(`(() => { const w = window.__tvWorld; if (w.acts) w.acts.reset(); w.follow.reset(); w.P.busy = false; w.P.hop = 0; return true; })()`);
  check("setup: the Toy Room has blocks", Boolean(await prop(cdp, "blocks")));
  await stage(cdp, "blocks", 1.9);
  await shot(cdp, "8-blocks-pile");
  const s0 = await blocksState(cdp);
  check("blocks: the room starts with the old pile (two layers, three blocks showing)", s0.layers === 2 && s0.visible === 3, JSON.stringify(s0));
  // one tap on the pile: it names them and a block falls in from above
  await clearToast(cdp);
  const top0 = await blockScreen(cdp, 2);
  check("blocks: the pile is on screen to tap", top0.on, JSON.stringify(top0));
  await cdp.tapAt(top0.x, top0.y);
  await sleep(150);
  const mid = await blocksState(cdp);
  check("blocks: a tap names them and a new block is falling in from high above", (await toastText(cdp)) === "Colorful blocks" && mid.layers === 3 && mid.visible === 4 && mid.ys[3] > 1.8, JSON.stringify({ toast: await toastText(cdp), mid }));
  await sleep(1500);
  const landed = await blocksState(cdp);
  check("blocks: it lands on top of the pile, one block higher than the one below", landed.layers === 3 && Math.abs(landed.ys[3] - 2.25) < 0.02 && Math.abs(landed.ys[2] - 1.35) < 0.02, JSON.stringify(landed));
  check("blocks: Kip was not sent anywhere by it", (await phase(cdp)) === "idle");
  // keep building, one tap on the top block each time
  const hits = [];
  for (let k = 0; k < 4; k++) {
    await clearToast(cdp);
    const st = await blocksState(cdp);
    const t = await blockScreen(cdp, st.layers);
    hits.push(t.on);
    await cdp.tapAt(t.x, t.y);
    await sleep(1300);
  }
  const tall = await blocksState(cdp);
  check("blocks: it can be built up by tapping the top, to seven layers (eight blocks)", tall.layers === 7 && tall.visible === 8 && hits.every(Boolean), JSON.stringify({ tall, hits }));
  check("blocks: every block lands where it belongs (a straight, tall tower)", tall.ys.every((y, i) => Math.abs(y - (i < 2 ? 0.45 : 0.45 + 0.9 * (i - 1))) < 0.03), JSON.stringify(tall.ys));
  await shot(cdp, "9-block-tower");
  // the tap on a full tower: it comes down
  await clearToast(cdp);
  const top = await blockScreen(cdp, 7);
  await cdp.tapAt(top.x, top.y);
  await sleep(120);
  check("blocks: the tap on a full tower brings it down", (await blocksState(cdp)).phase === "crashing");
  let shotCrash = false;
  const fall = await sample(cdp, 2600, async () => { const s = await blocksState(cdp); if (!shotCrash && s.xs.some((x) => Math.abs(x) > 1.2)) { shotCrash = true; await shot(cdp, "10-block-crash"); } return s; }, 60);
  const reach = Math.max(...fall.map((s) => Math.max(...s.xs.map((x) => Math.abs(x)))));
  check("blocks: the blocks scatter over the floor, near enough to stay on screen", reach > 1.2 && reach <= 3.25, String(reach));
  check("blocks: none goes through the floor", fall.every((s) => s.ys.every((y) => y > 0.44)), String(Math.min(...fall.map((s) => Math.min(...s.ys)))));
  // while it falls or is put back, a tap adds nothing
  const dur = await blocksState(cdp);
  if (dur.phase !== "standing") {
    const tt = await blockScreen(cdp, 0);
    await cdp.tapAt(tt.x, tt.y);
    await sleep(100);
    check("blocks: a tap while it is down adds nothing", (await blocksState(cdp)).layers === dur.layers, JSON.stringify({ before: dur.layers, after: (await blocksState(cdp)).layers }));
  }
  await waitFor(async () => (await blocksState(cdp)).phase === "standing", { timeoutMs: 20000, label: "the pile is rebuilt" });
  await sleep(300);
  const back = await blocksState(cdp);
  check("blocks: then the old pile is back as it was, ready to build again", back.layers === 2 && back.visible === 3 && Math.abs(back.ys[0] - 0.45) < 0.02 && Math.abs(back.ys[2] - 1.35) < 0.02, JSON.stringify(back));
  await shot(cdp, "11-blocks-rebuilt");
}

// ---- the dog follows Kip once they have met, and sits when Kip stops ----
const dogState = (cdp) => cdp.ev(`(() => { const w = window.__tvWorld; const d = w.props.list().find((p) => p.type === "dog"); const c = d.holder.userData.cue; return { t: performance.now() / 1000, x: +d.base.px.toFixed(2), sit: +(d.holder.userData.sitK || 0).toFixed(2), cue: c ? c.name : null, phase: w.follow.phase, engaged: w.follow.engaged, toy: +w.P.pos.x.toFixed(2), ry: +d.base.ry.toFixed(2) }; })()`);
const dogLane = (cdp) => cdp.ev(`(() => { const w = window.__tvWorld; const d = w.props.list().find((p) => p.type === "dog"); return w.props.list().filter((p) => p.type !== "dog" && p.type !== "ball" && Math.abs(p.base.pz - d.base.pz) < 1.5).map((p) => ({ type: p.type, x: +p.base.px.toFixed(2), half: +(p.size.x / 2).toFixed(2) })); })()`);
const walkKip = (cdp, x) => cdp.ev(`(() => { const w = window.__tvWorld; w.P.target = new w.P.pos.constructor(${x}, 0, w.P.pos.z); return true; })()`);
async function check_dog_follow(cdp) {
  // Kip is put near a dog that has forgotten him: out of reach to begin with
  await cdp.ev(`(() => { const w = window.__tvWorld; w.acts.reset(); w.fetch.cancel(); w.follow.reset(); w.P.busy = false; w.P.hop = 0; w.P.target = null; const d = w.props.list().find((p) => p.type === "dog"); w.props.placeProp(d, 29, { ry: Math.PI }); w.props.cue(d, "idle"); const ball = w.props.list().find((p) => p.type === "ball"); w.props.placeProp(ball, 12, {}); w.P.pos.x = 32.6; w.P.pos.z = 0.4; return true; })()`);       // (the ball is moved out of the way: a tap near it would kick it, and the dog would fetch)
  await sleep(800);
  const far = await dogState(cdp);
  check("dog follow: out of reach it stays put and has not met Kip", !far.engaged && far.phase === "home" && far.x === 29, JSON.stringify(far));
  // Kip walks up to it: it is delighted and from then on follows
  await walkKip(cdp, 31.4);
  const meet = await sample(cdp, 2500, () => dogState(cdp), 50);
  check("dog follow: when Kip walks up to it, it is delighted (happy) and has met Kip", meet.some((m) => m.cue === "happy") && meet.at(-1).engaged, JSON.stringify(meet.at(-1)));
  check("dog follow: meeting Kip does not move it", meet.every((m) => m.x === 29), JSON.stringify([...new Set(meet.map((m) => m.x))]));
  // Kip stands still: it sits, facing Kip
  await waitFor(async () => (await dogState(cdp)).phase === "sitting", { timeoutMs: 8000, label: "the dog sits" });
  await sleep(1200);
  const seated = await dogState(cdp);
  check("dog follow: after a while of Kip standing still it sits down (eased all the way) where it was, facing Kip", seated.sit === 1 && seated.cue === "sit" && seated.x === 29 && Math.abs(seated.ry - 3.14) > 3, JSON.stringify(seated));
  await stage(cdp, "dog", 2.6);
  await shot(cdp, "12-dog-sits");
  // Kip walks away to the right, past a ball and a bubble set: it gets up and trots after Kip
  await walkKip(cdp, 36.4);
  const trot = await sample(cdp, 6500, () => dogState(cdp), 60);
  check("dog follow: when Kip walks away it gets up and trots after it", trot.some((m) => m.cue === "run") && trot.some((m) => m.sit < 0.3 && m.phase === "trotting"), JSON.stringify([...new Set(trot.map((m) => `${m.phase}/${m.cue}`))]));
  const speeds = trot.map((m, i) => (i === 0 ? 0 : Math.abs(m.x - trot[i - 1].x) / Math.max(0.001, m.t - trot[i - 1].t)));
  check("dog follow: it never runs faster than a trot, and it does run", Math.max(...speeds) < 5.5 && Math.max(...speeds) > 2, String(Math.max(...speeds)));
  await waitFor(async () => (await dogState(cdp)).phase === "sitting", { timeoutMs: 10000, label: "the dog sits again" });
  await sleep(900);
  const after = await dogState(cdp);
  const lane = await dogLane(cdp);
  const clear = lane.every((p) => Math.abs(p.x - after.x) >= p.half + 0.6 - 0.2);
  check("dog follow: it settles close to Kip (a few units) and Kip stops, so it sits down again at its new place", after.sit === 1 && Math.abs(after.toy - after.x) > 1.5 && Math.abs(after.toy - after.x) <= 4.2, JSON.stringify(after));
  check("dog follow: and it is not standing inside a prop", clear, JSON.stringify({ x: after.x, lane }));
  await stage(cdp, "dog", 2.6);
  await shot(cdp, "13-dog-follows");
  // a tap on the sitting dog: it gets up and barks (Kip comes to pet it), and afterwards it sits again
  await clearToast(cdp);
  const on = await propScreen(cdp, "dog");
  await cdp.tapAt(on.x, on.y);
  const up = await sample(cdp, 900, () => dogState(cdp), 50);
  check("dog follow: a tap on the sitting dog gets it up to bark", up.some((m) => m.cue === "bark") && up.at(-1).sit < 0.5, JSON.stringify(up.at(-1)));
  await waitFor(async () => (await phase(cdp)) === "idle" && (await dogState(cdp)).phase === "sitting", { timeoutMs: 25000, label: "petted, and sitting again" });
  check("dog follow: when Kip has petted it and stands still it sits again", (await dogState(cdp)).phase === "sitting");
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
    // (Kip stays just out of reach for the idle wag: once he comes within a few units the dog has met him and hops about for a moment, which is not the idle wag)
    await cdp.ev(`(() => { const w = window.__tvWorld; w.follow.reset(); const d = w.props.list().find((p) => p.type === "dog"); w.P.pos.x = d.base.px - 3.8; w.P.target = null; return true; })()`);
    await sleep(400);
    const idle = await sample(cdp, 1500, async () => (await dogParts(cdp)).tail, 50);
    check("dog: it is alive: its tail wags on its own (it sweeps both ways)", Math.max(...idle) > 0.2 && Math.min(...idle) < -0.2, JSON.stringify([Math.min(...idle), Math.max(...idle)]));
    await stage(cdp, "dog");
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

    // ---- fetch: Kip kicks the ball and the dog brings it back ----
    await cdp.ev(`(() => { const w = window.__tvWorld; if (w.acts) w.acts.reset(); w.P.busy = false; w.P.hop = 0; return true; })()`);
    // The dog stands where it ended up; put it back at the right-hand end and the ball in the middle of the room, and Kip next to the ball.
    await cdp.ev(`(() => { const w = window.__tvWorld; const dog = w.props.list().find((p) => p.type === "dog"); const ball = w.props.list().find((p) => p.type === "ball"); w.props.placeProp(dog, 42.2, { ry: Math.PI, lift: 0 }); w.props.placeProp(ball, 34.5, { lift: 0 }); return true; })()`);
    await stage(cdp, "ball", 1.9);
    const ballNow = () => world(cdp, `(() => { const i = w.props.list().find((p) => p.type === "ball"); return { x: i.base.px, y: i.holder.position.y, moving: !!i.kick }; })()`);
    const dogNow = () => world(cdp, `(() => { const i = w.props.list().find((p) => p.type === "dog"); return { x: i.base.px, ry: i.base.ry, cue: i.holder.userData.cue ? i.holder.userData.cue.name : null }; })()`);
    const f0 = { ball: await ballNow(), dog: await dogNow() };
    await tapProp(cdp, "ball");
    let shotFetch = false;
    const fetchRun = await sample(cdp, 11000, async () => {
      const b = await ballNow(), d = await dogNow(), ph = await world(cdp, `w.fetch.phase`), k = await toy(cdp);
      if (!shotFetch && ph === "dropping") { shotFetch = true; await shot(cdp, "5-fetch"); }
      return { b, d, ph, kx: k.x, ka: k.action };
    }, 60);
    check("fetch: the dog sets off after the ball only once it has stopped (it waits while the ball is flying)", (() => { const firstRun = fetchRun.findIndex((s) => s.ph === "chasing"); return firstRun > 0 && fetchRun.slice(0, firstRun).some((s) => s.ph === "waiting" && s.b.moving) && fetchRun[firstRun].b.moving === false; })(), JSON.stringify(fetchRun.map((s) => `${s.ph}${s.b.moving ? "*" : ""}`).filter((p, i, a) => p !== a[i - 1]).slice(0, 12)));
    check("fetch: it goes through chasing, returning and dropping, and ends idle", ["waiting", "chasing", "returning", "dropping", "idle"].every((p) => fetchRun.some((s) => s.ph === p)) && fetchRun.at(-1).ph === "idle", JSON.stringify(fetchRun.map((s) => s.ph).filter((p, i, a) => p !== a[i - 1])));
    check("fetch: it runs (the run cue) and the ball is in its mouth, off the floor, on the way back", fetchRun.some((s) => s.d.cue === "run") && fetchRun.some((s) => s.ph === "returning" && s.b.y > 0.4), "");
    const end = fetchRun.at(-1);
    check("fetch: it ends with the ball near Kip, within a couple of units of its feet, at rest on the floor", Math.abs(end.b.x - end.kx) < 3.2 && end.b.y < 0.05 && !end.b.moving, JSON.stringify({ ball: end.b, kip: end.kx }));
    check("fetch: and the dog is beside it, facing Kip", Math.abs(end.d.x - end.kx) < 3.2 && end.d.ry === Math.PI, JSON.stringify(end.d));
    check("fetch: Kip did not trot after the ball (it stayed where it kicked from)", Math.abs(end.kx - fetchRun[0].kx) < 0.8, JSON.stringify([fetchRun[0].kx, end.kx]));
    check("fetch: the ball is no longer where it was kicked to, but near where the dog dropped it (it came back)", end.b.x < f0.ball.x + 3.5, JSON.stringify([f0.ball.x, end.b.x]));
    // and it can be kicked again
    const again = await propScreen(cdp, "ball");
    if (again && again.visible && again.x > 30 && again.x < 380) {
      await tapProp(cdp, "ball");
      const second = await sample(cdp, 9000, async () => ({ ph: await world(cdp, `w.fetch.phase`), b: await ballNow() }), 80);
      check("fetch: kick it again and the dog fetches it again", second.some((s) => s.ph === "returning") && second.at(-1).ph === "idle", JSON.stringify([...new Set(second.map((s) => s.ph))]));
    } else check("fetch: the ball is on screen to kick again", false, JSON.stringify(again));

    // ---- the xylophone: tap a bar to hear it; tap the frame and Kip plays a tune ----
    await cdp.ev(`(() => { const w = window.__tvWorld; if (w.acts) w.acts.reset(); w.fetch.cancel(); w.follow.reset(); w.P.busy = false; w.P.hop = 0; return true; })()`);       // (the dog has met Kip by now and would trot over to him: it is not what these sections are about)
    await check_xylophone(cdp);
    await check_blocks(cdp);
    await check_dog_follow(cdp);

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
