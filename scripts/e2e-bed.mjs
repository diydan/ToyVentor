#!/usr/bin/env node
// 390x844 headless-Chrome E2E for "tap the bed and the toy goes to sleep" (docs/specs/playful-interactions-spec.md section 6).
// Boots the real app on its own vite port, goes to the Toy Room and drives it with real mouse events: tap the bed (it says its name, Kip walks over, hops up and lies down on the
// mattress, the lamps go out, the room dims, Zzz drift up), then tap anywhere to wake (a yawn, the lamps come back, Kip hops down and can walk again); also changing its mind
// while walking to the bed. /api/voice is intercepted (no spend). Needs a real GPU: --headless=new with the Metal backend. Run: node scripts/e2e-bed.mjs
// Overrides: E2E_CHROME, E2E_PORT, E2E_DEBUG_PORT, E2E_PROFILE, E2E_SHOTS (a directory for screenshots). Exits nonzero on any failing check.
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
const CHROME = process.env.E2E_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEV_PORT = Number(process.env.E2E_PORT ?? 5198);
const DEBUG_PORT = Number(process.env.E2E_DEBUG_PORT ?? 9348);
const PROFILE = process.env.E2E_PROFILE ?? "/tmp/toyforge-e2e-bed-profile";
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
const phase = (cdp) => world(cdp, `w.sleep.phase`);
const bedInfo = (cdp) => world(cdp, `(() => { const i = w.props.list().find((p) => p.type === "bed"); return i ? { x: i.base.px, z: i.base.pz } : null; })()`);
const bedScreen = (cdp) => world(cdp, `(() => { const i = w.props.list().find((p) => p.type === "bed"); return i ? w.props.screenPos(i, 0.5) : null; })()`);
const toySnap = (cdp) => world(cdp, `({ x: w.P.pos.x, y: w.P.hop || 0, z: w.P.pos.z, busy: w.P.busy, holding: w.getMix() ? w.getMix().holding : null, action: w.getMix() ? w.getMix().busyAction : null })`);
const lampsOn = (cdp) => world(cdp, `w.props.list().filter((p) => p.type === "lamp").map((p) => p.on)`);
const waitPhase = (cdp, want, timeoutMs = 12000) => waitFor(async () => ((await phase(cdp)) === want ? true : null), { timeoutMs, everyMs: 50, label: `phase ${want}` });

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
    await cdp.ev(`window.__tvWorld.handle.go("room")`);
    await sleep(3000);
    const bed = await bedInfo(cdp);
    check("setup: the Toy Room has a bed", Boolean(bed), JSON.stringify(bed));
    // Kip a few units to the left of the bed; wait for the clips and for the bed to be on screen.
    await cdp.ev(`(() => { const w = window.__tvWorld; w.P.pos.x = ${bed.x} - 3.2; w.P.pos.z = 0; w.P.target = null; })()`);
    await waitFor(() => world(cdp, `!!(w.getMix() && w.getMix().canDrive(w.P.rig))`), { timeoutMs: 30000, label: "the character clips" });
    const onScreen = await waitFor(async () => { await dismissSheet(cdp); const s = await bedScreen(cdp); return s && s.visible && s.x > 30 && s.x < 360 && s.y > 80 && s.y < 760 ? s : null; }, { timeoutMs: 15000, label: "the bed on screen" })
      .catch(async (err) => { throw new Error(`${err.message} | toy=${JSON.stringify(await toySnap(cdp))} bed=${JSON.stringify(bed)} screen=${JSON.stringify(await bedScreen(cdp))} sheet=${await cdp.ev(`!!document.querySelector(".building")`)}`); });
    await sleep(800);
    check("setup: the bed is on screen", Boolean(onScreen), JSON.stringify(onScreen));
    const lamps0 = await lampsOn(cdp);
    check("setup: there are lamps, all on", lamps0.length >= 2 && lamps0.every(Boolean), JSON.stringify(lamps0));
    await shot(cdp, "0-before");

    // ---- 1. tap the bed: it names itself, Kip walks over, hops up and lies down ----
    await clearToast(cdp); cdp.voiceUrls.length = 0;
    const b1 = await bedScreen(cdp);
    await cdp.tapAt(b1.x, b1.y);
    await sleep(300);
    check("bed: a tap says 'Colorful bed'", (await toastText(cdp)) === "Colorful bed", String(await toastText(cdp)));
    check("bed: and asks for the English clip for exactly that", cdp.voiceUrls.includes("/api/voice?lang=en&n=bed&c=colorful"), JSON.stringify(cdp.voiceUrls));
    check("bed: Kip starts walking to it", ["walking", "climbing"].includes(await phase(cdp)), String(await phase(cdp)));
    await waitPhase(cdp, "climbing");
    await shot(cdp, "1-hopping");
    await waitPhase(cdp, "asleep", 12000);
    await sleep(2800);
    const asleep = await toySnap(cdp);
    check("sleep: Kip is on the mattress (right x, the mattress height, the bed's depth)", Math.abs(asleep.x - bed.x) < 0.05 && Math.abs(asleep.y - 0.8) < 0.05 && Math.abs(asleep.z - bed.z) < 0.05, JSON.stringify({ asleep, bed }));
    check("sleep: it is holding the sleep pose", asleep.holding === "sleep", JSON.stringify(asleep));
    check("sleep: the toy is busy (no walking off in its sleep)", asleep.busy === true);
    check("sleep: the room is fully asleep and the lamps are out", (await world(cdp, `w.sleep.level`)) === 1 && (await lampsOn(cdp)).every((v) => v === false), JSON.stringify(await lampsOn(cdp)));
    check("sleep: Zzz are floating up", (await world(cdp, `w.sleep.bubbleCount`)) >= 1, String(await world(cdp, `w.sleep.bubbleCount`)));
    await shot(cdp, "2-asleep");

    // ---- 2. tap anywhere: a yawn, the lamps come back, Kip hops down and can walk again ----
    const walkTapAt = { x: 250, y: 640 };       // empty ground (not one of the buttons)
    await cdp.tapAt(walkTapAt.x, walkTapAt.y);
    await sleep(500);
    check("wake: a tap wakes it (waking, yawning)", (await phase(cdp)) === "waking" && (await toySnap(cdp)).action === "yawn", JSON.stringify({ p: await phase(cdp), s: await toySnap(cdp) }));
    check("wake: and that tap did NOT also send Kip walking", (await world(cdp, `w.P.target === null`)) === true);
    await shot(cdp, "3-yawning");
    await waitPhase(cdp, "awake", 8000);
    await sleep(500);
    const up = await toySnap(cdp);
    check("wake: Kip is back on the floor (the world's own little turn-around hop aside), free to move, the pose let go", up.y < 0.3 && up.busy === false && up.holding === null, JSON.stringify(up));
    check("wake: the lamps are back on and the room is bright", (await lampsOn(cdp)).every(Boolean) && (await world(cdp, `w.sleep.level`)) === 0, JSON.stringify(await lampsOn(cdp)));
    await shot(cdp, "4-awake");
    await cdp.tapAt(200, 650);
    await sleep(1500);
    check("wake: Kip walks again when tapped on the ground", Math.abs((await toySnap(cdp)).x - up.x) > 0.3, JSON.stringify([up.x, (await toySnap(cdp)).x]));

    // ---- 3. changing its mind on the way to bed ----
    await cdp.ev(`(() => { const w = window.__tvWorld; w.P.pos.x = ${bed.x} - 3.2; w.P.pos.z = 0; w.P.target = null; })()`);
    await sleep(1200);
    const b2 = await bedScreen(cdp);
    if (b2 && b2.visible) {
      await cdp.tapAt(b2.x, b2.y);
      await sleep(400);
      check("mind: it starts walking", (await phase(cdp)) === "walking", String(await phase(cdp)));
      await cdp.tapAt(200, 650);      // the player taps the ground somewhere else
      await sleep(600);
      check("mind: tapping elsewhere drops the sleep and Kip goes where it was sent", (await phase(cdp)) === "awake", String(await phase(cdp)));
      await sleep(1500);
      check("mind: and it never climbed or lay down (still on the floor; the world's little turn-around hop aside)", (await toySnap(cdp)).y < 0.3);
    } else check("mind: the bed was on screen", false, JSON.stringify(b2));

    // ---- 4. the bed is also the hiding place of the jetpack, and it stays when that part has been found (it used to vanish: the cover is only built for unfound parts) ----
    await cdp.ev(`(() => { let s = {}; try { s = JSON.parse(localStorage.getItem("tf25") || "{}"); } catch (e) {} s.found = Object.assign({}, s.found, { "character.back.jetpack": true }); localStorage.setItem("tf25", JSON.stringify(s)); })()`);
    await cdp.send("Page.reload");
    await waitFor(() => cdp.ev(`!!document.querySelector("canvas") && !!(window.__tvWorld && window.__tvWorld.props)`), { label: "stage after reload" });
    await sleep(2000);
    await cdp.ev(`(() => { const t = document.querySelector("#title"); if (t && !t.hidden) document.querySelector("#play")?.click(); })()`);
    await sleep(1500);
    await cdp.ev(`window.__tvWorld.handle.go("room")`);
    await sleep(3000);
    const bed2 = await bedInfo(cdp);
    check("found: with the jetpack already found, the bed is still in the room and still a bed", Boolean(bed2) && Math.abs(bed2.x - bed.x) < 0.01, JSON.stringify(bed2));

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
