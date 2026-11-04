#!/usr/bin/env node
// 390x844 headless-Chrome E2E for the DAY and NIGHT look of the outdoor worlds (src/features/game/world/runtime/worldLook.ts, src/lib/timeOfDay.ts; docs/specs/environment-spec.md).
// The look follows the device clock (07:00 to 18:59 is day) unless a grown-up pinned Day or Night (localStorage `tvTimeOfDay:v1`, the same pin the Grown-ups sheet writes), which is how this
// drives it. Every outdoor world is built in both looks and checked: which look it is, the fog the light rig gives it, the lanterns (lit at night, dark by day), a screenshot of each (E2E_SHOTS);
// the Toy Room is the same at any hour; and pinning the other look while a world is up re-skins it, with the toy where it was.
// Real GPU (Metal). Run: node scripts/e2e-daynight.mjs     Overrides: E2E_CHROME, E2E_PORT, E2E_DEBUG_PORT, E2E_PROFILE, E2E_SHOTS (a directory for screenshots).
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
const CHROME = process.env.E2E_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEV_PORT = Number(process.env.E2E_PORT ?? 5221);
const DEBUG_PORT = Number(process.env.E2E_DEBUG_PORT ?? 9371);
const PROFILE = process.env.E2E_PROFILE ?? "/tmp/toyforge-e2e-daynight-profile";
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



const WORLDS5 = ["garden", "sky", "junk", "beach", "snow"];
/** The fog colour of each world's light rig by day and by night: a mood rig where the world was not painted for that time of day (lighting.ts moodRig), the theme's own rig where it was. */
const FOG = { garden: { day: 0xcfe4f6, night: 0x1d2470 }, sky: { day: 0xbcd8f8, night: 0x1d2470 }, junk: { day: 0xcfe4f6, night: 0x3d2f5c }, beach: { day: 0xcfeaf6, night: 0x1d2470 }, snow: { day: 0xcfe4f6, night: 0x1c2f66 } };
const pin = (cdp, mode) => cdp.ev(`(() => { localStorage.setItem("tvTimeOfDay:v1", ${JSON.stringify(mode)}); return true; })()`);
const look = (cdp) => world(cdp, `w.look()`);
const fogHex = (cdp) => cdp.ev(`window.__tvDebug.scene.fog ? window.__tvDebug.scene.fog.color.getHex() : null`);
const backdrop = (cdp) => cdp.ev(`(() => { const g = window.__tvDebug.scene.getObjectByName("backdrop"); return g ? g.children.map((m) => ({ id: m.userData.backdrop, visible: m.visible, w: m.material && m.material.map && m.material.map.image ? m.material.map.image.width : 0, tex: m.material && m.material.map ? m.material.map.uuid : null })) : null; })()`);
const seen = {};
const lanterns = (cdp) => world(cdp, `JSON.stringify(w.props.list().filter((p) => p.type === "lantern").map((p) => p.on))`);

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
    const go = async (id) => { await cdp.ev(`window.__tvWorld.handle.go(${JSON.stringify(id)})`); await sleep(id === "room" ? 2200 : 2800); };

    for (const mode of ["day", "night"]) {
      await pin(cdp, mode);
      for (const id of WORLDS5) {
        await go("room"); await go(id);
        const l = await look(cdp), fog = await fogHex(cdp), lan = JSON.parse(await lanterns(cdp));
        check(`${id} pinned ${mode}: it is built in the ${mode} look`, l === mode, String(l));
        check(`${id} ${mode}: the light rig's fog is the ${mode} one`, fog === FOG[id][mode], `${fog?.toString(16)} wanted ${FOG[id][mode].toString(16)}`);
        if (lan.length) check(`${id} ${mode}: its ${lan.length} lanterns are ${mode === "night" ? "lit" : "dark"}`, lan.every((on) => on === (mode === "night")), JSON.stringify(lan));
        const bd = await waitFor(async () => { const r = await backdrop(cdp); return r && r.length === 2 && r.every((l) => l.visible && l.w > 0) ? r : null; }, { timeoutMs: 20000, label: `${id} ${mode} backdrop art` }).catch(() => null);
        check(`${id} ${mode}: its far band and its mid cut-out are in (the art loaded and shows)`, !!bd && bd[0].id === "far" && bd[1].id === "mid" && bd[0].w >= 4000 && bd[0].w <= 4096 && bd[1].w >= 1000, JSON.stringify(bd));
        if (bd) { seen[`${id}/${mode}`] = bd; }
        await shot(cdp, `look-${id}-${mode}`);
      }
      // the Toy Room is indoors: the same at any hour
      await go("room");
      check(`the Toy Room pinned ${mode}: no day or night look at all`, (await look(cdp)) === "", String(await look(cdp)));
      await shot(cdp, `look-room-${mode}`);
    }
    const roomFogDay = null;

    for (const id of WORLDS5) {
      const d = seen[`${id}/day`], n = seen[`${id}/night`];
      check(`${id}: the day and night far bands are different pictures, and the mid cut-out is the same one in both`, !!d && !!n && d[0].tex !== n[0].tex && d[1].tex === n[1].tex || (!!d && !!n && d[0].tex !== n[0].tex && d[1].w === n[1].w), JSON.stringify({ d, n }));
    }

    // a Toy Room fog does not change with the pin
    await pin(cdp, "day"); await go("room"); const fogDay = await fogHex(cdp);
    await pin(cdp, "night"); await go("room"); const fogNight = await fogHex(cdp);
    check("the Toy Room's light does not depend on the pin (indoors it is the same at any hour)", fogDay === fogNight, `${fogDay?.toString(16)} vs ${fogNight?.toString(16)}`);

    // pinning the other look while a world is up re-skins it, with the toy where it was
    await pin(cdp, "day");
    await go("garden");
    await cdp.ev(`(() => { const w = window.__tvWorld; w.P.pos.x = 12; w.P.target = null; return true; })()`);
    await sleep(1200);
    const before = { look: await look(cdp), x: await world(cdp, `+w.P.pos.x.toFixed(2)`) };
    await pin(cdp, "night");
    await waitFor(async () => (await look(cdp)) === "night", { timeoutMs: 8000, label: "the Garden to turn to night" });
    const after = { look: await look(cdp), x: await world(cdp, `+w.P.pos.x.toFixed(2)`), fog: await fogHex(cdp), lan: JSON.parse(await lanterns(cdp)) };
    check("pinning Night while the Garden is up turns it to night (from day) without a trip out of the world", before.look === "day" && after.look === "night" && after.fog === FOG.garden.night, JSON.stringify({ before, after }));
    check("and the toy is where it was, and the lanterns are lit", Math.abs(after.x - before.x) < 0.3 && after.lan.length > 0 && after.lan.every(Boolean), JSON.stringify({ before: before.x, after: after.x, lan: after.lan }));
    await pin(cdp, "day");
    await waitFor(async () => (await look(cdp)) === "day", { timeoutMs: 8000, label: "the Garden to turn back to day" });
    check("and pinning Day turns it back", (await look(cdp)) === "day" && JSON.parse(await lanterns(cdp)).every((on) => on === false), await look(cdp));

    // pinning while in the Toy Room changes nothing there and nothing is rebuilt
    await go("room");
    const marker = await world(cdp, `(() => { const d = w.props.list()[0]; d.holder.userData.__m = 1; return 1; })()`);
    await pin(cdp, "night"); await sleep(2500);
    check("pinning the other look in the Toy Room rebuilds nothing", (await world(cdp, `!!w.props.list()[0].holder.userData.__m`)) === true && (await look(cdp)) === "");

    // a grown-up pin of auto goes back to the clock: whatever the clock says, the look is day or night, never a mix
    await pin(cdp, "auto"); await go("garden");
    const auto = await look(cdp);
    check("Auto follows the device clock (day or night, whichever it is now)", auto === (new Date().getHours() >= 7 && new Date().getHours() < 19 ? "day" : "night"), String(auto));

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
