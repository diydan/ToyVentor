#!/usr/bin/env node
// 390x844 headless-Chrome E2E for the character's Mixamo MOVES (src/features/game/world/runtime/gameMoves.ts): the jump (Mixamo "Jump") and the Shove ability (Mixamo "Push", played from its first frame and eased out 2.2 s in): both as the bench's joint data, so the elbows and knees bend.
// Real GPU (Metal), real game. Checks: both clips are in the character's bank; a standing jump leaves the ground by about a unit and lands (the boots' soles are measured); the Shove ability
// plays the shove clip, lands its effect while the arms are out, and the boots stay on the floor; and the cushion jump in the Toy Room plays the jump clip and then the cheer.
// Run: node scripts/e2e-moves.mjs     Overrides: E2E_CHROME, E2E_PORT, E2E_DEBUG_PORT, E2E_PROFILE, E2E_SHOTS (a directory for screenshots).
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
const CHROME = process.env.E2E_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEV_PORT = Number(process.env.E2E_PORT ?? 5211);
const DEBUG_PORT = Number(process.env.E2E_DEBUG_PORT ?? 9361);
const PROFILE = process.env.E2E_PROFILE ?? "/tmp/toyforge-e2e-moves-profile";
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
    if (r?.exceptionDetails) throw new Error("evaluate threw: " + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails).slice(0, 700) + " :: " + String(expr).slice(0, 160));
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


/** The lowest point of each boot's sole in world units (the boots hang under the leg pivots: rig.feet are fixed holders, the legs and boots swing below them). */
const soles = (cdp) => world(cdp, `(() => { const rig = w.P.rig; const V = w.P.pos.constructor; const out = []; for (let i = 0; i < 2; i++) { const sn = w.getMix() && w.getMix().j && w.getMix().j.snap; const o = sn ? sn.legs[i].boot : rig.feet[i].userData.hip.children[0].children[1]; o.updateWorldMatrix(true, false); const g = o.geometry; if (!g.boundingBox) g.computeBoundingBox(); const bb = g.boundingBox; let y0 = 1e9; for (let k = 0; k < 8; k++) y0 = Math.min(y0, new V(k & 1 ? bb.max.x : bb.min.x, k & 2 ? bb.max.y : bb.min.y, k & 4 ? bb.max.z : bb.min.z).applyMatrix4(o.matrixWorld).y); out.push(y0); } return Math.min(out[0], out[1]); })()`);
const action = (cdp) => world(cdp, `w.getMix() ? w.getMix().busyAction : "no-mix"`);

async function main() {
  rmSync(PROFILE, { recursive: true, force: true });
  const dev = spawn("npx", ["vite", "--port", String(DEV_PORT), "--strictPort"], { cwd: ROOT, stdio: "ignore" });
  const chrome = spawn(CHROME, ["--headless=new", "--use-angle=metal", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required",
    `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${PROFILE}`, "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
  const killAll = () => { try { chrome.kill(); } catch {} try { dev.kill(); } catch {} };
  let cdp = null, pageOrigin = null;
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
    await loadApp(cdp, "en");
    pageOrigin = await cdp.ev(`performance.timeOrigin`);
    await sleep(2500);
    await waitFor(() => world(cdp, `!!(w.getMix() && w.getMix().canDrive(w.P.rig))`), { timeoutMs: 30000, label: "the character clips" });
    await waitFor(() => world(cdp, `!!(w.getMix().hasClip("jump") && w.getMix().hasClip("shove"))`), { timeoutMs: 20000, label: "the jump and shove clips" });
    check("the Mixamo jump and shove are in the character's bank", true);

    // ---- a standing jump: the clip itself, at the celebration's strength ----
    await cdp.ev(`(() => { const w = window.__tvWorld; w.P.pos.x = 30; w.P.target = null; w.P.hop = 0; return true; })()`);
    await sleep(1800);
    const ground = await soles(cdp);
    check("standing, the boots are on the floor (within 8 cm)", ground < 0.08, String(ground));
    await cdp.ev(`(() => { window.__tvWorld.getMix().trigger("jump", { fade: 0.06, lift: 0.8 }); return true; })()`);
    const jump = await sample(cdp, 1500, async () => ({ y: await soles(cdp), a: await action(cdp) }), 25);
    check("the jump clip plays", jump.some((s) => s.a === "jump"), JSON.stringify([...new Set(jump.map((s) => s.a))]));
    const apex = Math.max(...jump.map((s) => s.y));
    check("it leaves the floor by about a unit or more and clearly comes back", apex > 0.8 && apex < 2.4 && jump.at(-1).y < 0.1, JSON.stringify({ apex, end: jump.at(-1).y }));
    check("the jump is over by itself in about a second", jump.at(-1).a === null && jump.findIndex((s) => s.a === null && s.y < 0.1) > 3, JSON.stringify(jump.map((s) => s.a === "jump" ? 1 : 0).join("")));
    await shot(cdp, "moves-after-jump");

    // ---- the Shove ability ----
    await cdp.ev(`(() => { const w = window.__tvWorld; w.P.pos.x = 30; w.P.target = null; w.P.hop = 0; return true; })()`);
    await sleep(1200);
    await cdp.ev(`(() => { window.__tvWorld.handle.ability("torque"); return true; })()`);
    let shotTaken = false;
    const shove = await sample(cdp, 7000, async () => { const a = await action(cdp); const y = await soles(cdp); const lunge = await world(cdp, `+(w.P.lunge || 0).toFixed(2)`); if (!shotTaken && a === "shove") { shotTaken = true; await sleep(250); await shot(cdp, "moves-shove"); } return { a, y, lunge }; }, 40);
    check("the Shove ability plays the Mixamo shove clip", shove.some((s) => s.a === "shove"), JSON.stringify([...new Set(shove.map((s) => s.a))]));
    const during = shove.filter((s) => s.a === "shove");
    check("the shove lasts about two seconds (the first 2.2 s of the real push, eased out), not a flicker and not the whole eight-second lean", during.length > 15 && during.length * 0.04 < 3.4, String(during.length));
    check("the boots stay on the floor through the shove (no float)", during.length > 0 && Math.max(...during.map((s) => s.y)) < 0.35, String(Math.max(...during.map((s) => s.y))));
    check("the shove found the hidden part: the game's own celebration follows it (a dance)", shove.some((s) => s.a === "dance"), JSON.stringify([...new Set(shove.map((s) => s.a))]));
    await waitFor(async () => (await action(cdp)) === null, { timeoutMs: 15000, label: "the celebration to end" });
    check("then Kip is free again: no action, no lunge left over, the toy not busy", (await world(cdp, `+(w.P.lunge || 0).toFixed(2)`)) === 0 && (await world(cdp, `!w.P.busy`)) === true, JSON.stringify({ a: await action(cdp), lunge: await world(cdp, `w.P.lunge`), busy: await world(cdp, `w.P.busy`) }));
    await sleep(500);

    // ---- the cushion jump in the Toy Room ----
    await cdp.ev(`window.__tvWorld.handle.go("room")`);
    await sleep(3000);
    await waitFor(() => world(cdp, `!!(w.getMix() && w.getMix().canDrive(w.P.rig))`), { timeoutMs: 30000, label: "the character clips again" });
    await cdp.ev(`(() => { const w = window.__tvWorld; w.follow.reset(); const c = w.props.list().find((p) => p.type === "cushions"); w.P.pos.x = c.base.px - 1.7; w.P.target = null; return true; })()`);
    await sleep(1500);
    await cdp.ev(`(() => { const w = window.__tvWorld; const c = w.props.list().find((p) => p.type === "cushions"); w.acts.tap(c); return true; })()`);
    const cush = await sample(cdp, 4300, async () => ({ a: await action(cdp), hop: await world(cdp, `+(w.P.hop || 0).toFixed(2)`) }), 40);
    const seq = cush.map((s) => s.a).filter((a, i, all) => a && a !== all[i - 1]);
    check("the cushion jump plays the Mixamo jump first and the cheer at the top", seq.indexOf("jump") >= 0 && seq.indexOf("cheer") > seq.indexOf("jump"), JSON.stringify(seq));
    check("and the path still lifts Kip well above the floor (the clip adds no height of its own there)", Math.max(...cush.map((s) => s.hop)) > 0.8 && Math.max(...cush.map((s) => s.hop)) < 2.2, String(Math.max(...cush.map((s) => s.hop))));

    check("the page was not reloaded during the run", (await cdp.ev(`performance.timeOrigin`)) === pageOrigin, "reloaded");
    check("no page exceptions", cdp.exceptions.length === 0, cdp.exceptions.slice(0, 3).join(" | "));
    killAll();
  } catch (err) {
    check("e2e ran to completion", false, String(err && err.stack || err));
    try { if (cdp && pageOrigin !== null && (await cdp.ev(`performance.timeOrigin`)) !== pageOrigin) check("the page was not reloaded during the run (it WAS: a source file changed under the dev server)", false, "reloaded"); } catch {}
    killAll();
  }
  const failed = results.filter((r) => !r.pass);
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : `  [${r.detail}]`}`);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}
main();
