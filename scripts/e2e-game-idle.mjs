#!/usr/bin/env node
// What the game's character does on its own, in a real browser (src/features/game/world/runtime/idleBehavior.ts; Dan, 2026-11-04: "idle waves and random dances if nothing is going on", and a
// dancing Kip on the title screen). Headless Chrome on the machine's GPU, the Vite dev server, real mouse events.
//   the title: Kip dances on the turntable (a dance, then another), with his elbows and knees bending, and stops when Play is pressed.
//   idle: after a spell of standing still Kip may wave, clap or (after a longer one) dance, facing the camera; never a dance in the first two ticks; walking or a tap ends it at once and he turns back;
//         the party's dance is never stopped by it; reduced motion switches it off.
// The idle tick is forced (the world waits 6.5 s of standing still for each; the test sets its timer to just under that) so the run is short.
// Run: E2E_GPU=metal node scripts/e2e-game-idle.mjs    Overrides: E2E_CHROME, E2E_PORT, E2E_DEBUG_PORT, E2E_PROFILE, E2E_SHOTS
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const CHROME = process.env.E2E_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEV_PORT = Number(process.env.E2E_PORT ?? 5340);
const DEBUG_PORT = Number(process.env.E2E_DEBUG_PORT ?? 9440);
const PROFILE = process.env.E2E_PROFILE ?? "/tmp/toyforge-e2e-idle-profile";
const SHOTS = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), "game-idle-shots");
const BASE = `http://localhost:${DEV_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, { timeoutMs = 60000, everyMs = 150, label = "?" } = {}) {
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
  connect() { return new Promise((res, rej) => { const ws = new WebSocket(this.url); this.ws = ws; ws.addEventListener("open", () => res(), { once: true }); ws.addEventListener("error", rej, { once: true }); ws.addEventListener("message", (ev) => { let m; try { m = JSON.parse(String(ev.data)); } catch { return; } if (m.id != null && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } else if (m.method === "Runtime.exceptionThrown") this.exceptions.push(m.params?.exceptionDetails?.exception?.description || m.params?.exceptionDetails?.text || "exception"); }); }); }
  send(method, params = {}) { const id = this.id++; return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async ev(expr) { const r = await this.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r?.exceptionDetails) throw new Error("evaluate threw: " + JSON.stringify(r.exceptionDetails).slice(0, 400)); return r?.result?.value; }
  async tapAt(x, y) { await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }); await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }); await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }); }
}
const results = [];
const check = (name, pass, detail = "") => { results.push({ name, pass: Boolean(pass), detail }); console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass ? "" : `  [${detail}]`}`); };
const shot = async (cdp, name) => { mkdirSync(SHOTS, { recursive: true }); const r = await cdp.send("Page.captureScreenshot", { format: "png" }); writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(r.data, "base64")); };

const MIX = "window.__tvWorld.getMix()";
const W = "window.__tvWorld";
const beatClip = (cdp) => cdp.ev(`${MIX} && ${MIX}.beatClip`);
const busy = (cdp) => cdp.ev(`${MIX} && ${MIX}.busyAction`);
/** How far the left forearm joint is from where the rigid arm holds it (rig mm): 0 when the sleeve is straight, large when the elbow is bent. */
const bend = (cdp) => cdp.ev(`(() => { const sn = ${W}.P.rig.snap; if (!sn) return -1; const f = sn.arms.map((a) => Math.hypot(a.fore.position.x, a.fore.position.y + 35, a.fore.position.z - 3.8)); const k = sn.legs.map((l) => Math.hypot(l.lower.position.x, l.lower.position.y + 39.2, l.lower.position.z)); return Math.max(...f, ...k); })()`);
const atRest = async (cdp) => (await bend(cdp)) < 0.01;
async function load(cdp, url, { reduce = false } = {}) {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: reduce ? "reduce" : "no-preference" }] });
  await cdp.send("Page.navigate", { url });
  await waitFor(() => cdp.ev(`!!(window.__tvWorld && window.__tvWorld.P && window.__tvWorld.P.rig && window.__tvWorld.P.rigReady && window.__tvWorld.getMix())`), { label: `${url} world`, timeoutMs: 120000 });
}
/** Wait for the gesture clips to be in the character's bank (they load in the background after the character does). */
const clipsIn = (cdp, ids) => waitFor(() => cdp.ev(`(${JSON.stringify(ids)}).every((id) => ${MIX}.hasClip(id))`), { label: `clips ${ids}`, timeoutMs: 60000 });
/** Make the idle timer fire on the next frame, with the stated number of ticks already behind the character in this spell of standing still. */
const forceTick = (cdp, n) => cdp.ev(`(() => { const P = ${W}.P; P.idleN = ${n}; P.idleT = 6.6; })()`);

async function main() {
  rmSync(PROFILE, { recursive: true, force: true });
  const dev = spawn("npx", ["vite", "--port", String(DEV_PORT), "--strictPort"], { cwd: ROOT, stdio: "ignore" });
  const chrome = spawn(CHROME, ["--headless=new", "--use-angle=metal", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required", `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${PROFILE}`, "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
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

    // ---- the title: a dancing Kip -----------------------------------------------------------------------------------------------------------
    await load(cdp, `${BASE}/`);
    check("the game opens on its title (the toy on the turntable)", await cdp.ev(`${W}.P.title === true && ${W}.P.showcase === true && !!document.querySelector(".tv-title")`));
    await waitFor(async () => (await beatClip(cdp)) !== null, { label: "the title show starts", timeoutMs: 30000 });
    check("Kip dances on the title (the Samba, his own, straight away)", (await beatClip(cdp)) !== null);
    await clipsIn(cdp, ["dance_silly", "dance_hiphop"]);
    const seen = new Set();
    let bentSeen = 0, rest = 0;
    for (let i = 0; i < 70 && seen.size < 3; i++) { const c = await beatClip(cdp); if (c) seen.add(c); const b = await bend(cdp); if (b > 3) bentSeen = Math.max(bentSeen, b); await sleep(400); }
    check(`the show goes from one dance to another (${[...seen].join(", ")})`, seen.size >= 2, [...seen].join());
    check(`his elbows and knees bend while he dances on the title (the most a joint was out of line: ${bentSeen.toFixed(1)} mm)`, bentSeen > 5);
    await shot(cdp, "title-dance");
    const playBtn = await cdp.ev(`(() => { const e = document.querySelector('[data-title-entry="play"]'); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, off: e.disabled }; })()`);
    await cdp.tapAt(playBtn.x, playBtn.y);
    await waitFor(async () => (await beatClip(cdp)) === null, { label: "the show stops on Play", timeoutMs: 5000 });
    check("Play ends the show", (await beatClip(cdp)) === null && (await cdp.ev(`${W}.P.title === false`)));
    await sleep(1200);
    check("and Kip's limbs are straight again, as before", await atRest(cdp), String(await bend(cdp)));

    // ---- idle: what he does after standing still -----------------------------------------------------------------------------------------------
    await load(cdp, `${BASE}/?title=0`);
    await clipsIn(cdp, ["react_wave", "react_clap", "dance_silly", "dance_hiphop", "dance_swing", "dance_locking", "dance_chicken"]);
    await sleep(2500); // the intro card goes
    check("playing, standing still: nothing is going on", (await busy(cdp)) === null && (await cdp.ev(`${W}.P.title === false && !${W}.P.busy`)));
    const kinds = { early: new Set(), late: new Set() };
    const sample = async (n, chain, into) => {
      for (let i = 0; i < n; i++) {
        await forceTick(cdp, chain);
        await sleep(160);
        const c = await beatClip(cdp);
        if (c) { into.add(c); await cdp.ev(`${MIX}.stopBeatDance()`); await waitFor(async () => (await busy(cdp)) === null, { label: "the behaviour to end", timeoutMs: 4000 }); await sleep(100); }
        else { await waitFor(async () => (await busy(cdp)) === null, { label: "an old gesture to end", timeoutMs: 6000, everyMs: 200 }).catch(() => {}); }
        await cdp.ev(`(() => { ${W}.P.target = null; })()`);
      }
    };
    await sample(14, 0, kinds.early);
    check(`in the first ticks of standing still he waves or claps, and never dances (${[...kinds.early].join(", ")})`, [...kinds.early].every((c) => c === "react_wave" || c === "react_clap") && kinds.early.size >= 1, [...kinds.early].join());
    await sample(30, 2, kinds.late);
    check(`later he may dance too (${[...kinds.late].join(", ")})`, [...kinds.late].some((c) => c.startsWith("dance")), [...kinds.late].join());
    check("a wave or a clap is among what he does", kinds.late.has("react_wave") || kinds.early.has("react_wave") || kinds.late.has("react_clap") || kinds.early.has("react_clap"));

    // a wave, looked at closely
    let waveSeen = false;
    for (let i = 0; i < 40 && !waveSeen; i++) { await forceTick(cdp, 0); await sleep(250); if ((await beatClip(cdp)) === "react_wave") waveSeen = true; else { await cdp.ev(`${MIX}.stopBeatDance()`); await sleep(700); } }
    check("a wave starts when the tick comes", waveSeen);
    if (waveSeen) {
      await sleep(900);
      check("he turns to face the camera for it", await cdp.ev(`Math.abs(${W}.P.tface + Math.PI / 2) < 1e-6`));
      check("the driver calls it idle, not a dance (so the party's checks for a dance are not fooled by it)", (await busy(cdp)) === "idle", String(await busy(cdp)));
      let maxBend = 0, lowest = 1e9;
      for (let i = 0; i < 10; i++) { maxBend = Math.max(maxBend, await bend(cdp)); await sleep(100); }
      check(`his elbow bends for the wave (${maxBend.toFixed(1)} mm out of line)`, maxBend > 4);
      lowest = await cdp.ev(`(() => { const rig = ${W}.P.rig, sn = rig.snap, T = window.__tvDebug.camera.position.constructor, S = 0.0185, parent = rig.g.parent; parent.updateWorldMatrix(true, true); let lo = 1e9; for (const l of sn.legs) for (const [dx, dz] of [[-7,-9],[7,-9],[-7,15],[7,15]]) { const v = l.foot.localToWorld(new T(l.boot.position.x + dx, l.boot.position.y, l.boot.position.z + dz)); parent.worldToLocal(v); lo = Math.min(lo, v.y / S); } return lo; })()`);
      check(`and he keeps his feet on the floor (the lowest sole is ${lowest.toFixed(2)} mm off it)`, Math.abs(lowest) < 0.6, String(lowest));
      await shot(cdp, "idle-wave");
      // walking ends it at once
      await cdp.ev(`(() => { const P = ${W}.P; P.target = { x: P.pos.x + 3, z: 0 }; })()`);
      await waitFor(async () => (await beatClip(cdp)) === null, { label: "walking ends the wave", timeoutMs: 3000 });
      check("walking ends it at once", (await beatClip(cdp)) === null);
      await sleep(2600);
      check("he turns back and his limbs go back to normal", await cdp.ev(`${W}.P.danceBack == null`) && await atRest(cdp), `${await cdp.ev(`${W}.P.danceBack`)} ${await bend(cdp)}`);
    }

    // a tap ends it
    let tapped = false;
    for (let i = 0; i < 40 && !tapped; i++) { await cdp.ev(`(() => { ${W}.P.target = null; })()`); await sleep(500); await forceTick(cdp, 0); await sleep(300); if ((await beatClip(cdp)) !== null) tapped = true; else await sleep(300); }
    if (tapped) {
      await cdp.tapAt(195, 120); // the sky: not the toy, not a prop
      await sleep(150);
      await waitFor(async () => (await beatClip(cdp)) === null, { label: "a tap ends it", timeoutMs: 3000 });
      check("a tap on the stage ends it", (await beatClip(cdp)) === null);
    } else check("a tap on the stage ends it", false, "no behaviour started to tap");

    // the party's dance is never stopped by it
    await cdp.ev(`(() => { ${W}.P.target = null; })()`);
    await sleep(2800);
    let started = false;
    for (let i = 0; i < 40 && !started; i++) { await forceTick(cdp, 0); await sleep(250); if ((await beatClip(cdp)) !== null) started = true; else await sleep(300); }
    if (started) {
      await cdp.ev(`window.__partyT0 = performance.now() / 1000; ${W}.handle.partyDanceStart(() => ({ name: 'dance_hiphop', time: performance.now() / 1000 - window.__partyT0 }))`);
      await sleep(5200); // past the longest a wave or a clap runs (and so its stop time)
      check("when the party takes over a behaviour, the party's dance is not stopped by it", (await beatClip(cdp)) === "dance_hiphop", String(await beatClip(cdp)));
      await cdp.ev(`${MIX}.stopBeatDance()`);
    } else check("when the party takes over a behaviour, the party's dance is not stopped by it", false, "no behaviour started");
    await sleep(900);

    // ---- reduced motion --------------------------------------------------------------------------------------------------------------------
    await load(cdp, `${BASE}/?title=0`, { reduce: true });
    await clipsIn(cdp, ["react_wave"]).catch(() => {});
    await sleep(2500);
    let any = false;
    for (let i = 0; i < 12; i++) { await forceTick(cdp, 3); await sleep(250); if ((await beatClip(cdp)) !== null) any = true; }
    check("with reduced motion on he does none of it", !any);
    await load(cdp, `${BASE}/`, { reduce: true });
    await sleep(3000);
    check("and the title does not dance either", (await beatClip(cdp)) === null);

    check("no page exceptions", cdp.exceptions.length === 0, cdp.exceptions.slice(0, 3).join(" | "));
    killAll();
  } catch (err) {
    check("e2e ran to completion", false, String((err && err.stack) || err));
    killAll();
  }
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed\nscreenshots: ${SHOTS}`);
  process.exit(failed.length ? 1 : 0);
}
main();
