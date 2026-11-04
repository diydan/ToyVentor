#!/usr/bin/env node
// 390x844 headless-Chrome E2E for the Toy Room toys (docs/specs/playful-interactions-spec.md section 6): tap the TEDDY and Kip walks over and hugs it (hearts), tap the CUSHIONS and Kip hops up, bounces and
// cheers, tap the BALL and Kip walks to it and kicks it across the room (it bounces, rolls and stays where it stops, and can be kicked again). Real mouse events; /api/voice is intercepted (no spend).
// Needs a real GPU: --headless=new with the Metal backend. Run: node scripts/e2e-toyroom.mjs     Overrides: E2E_CHROME, E2E_PORT, E2E_DEBUG_PORT, E2E_PROFILE, E2E_SHOTS (screenshot directory).
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
const CHROME = process.env.E2E_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEV_PORT = Number(process.env.E2E_PORT ?? 5200);
const DEBUG_PORT = Number(process.env.E2E_DEBUG_PORT ?? 9350);
const PROFILE = process.env.E2E_PROFILE ?? "/tmp/toyforge-e2e-toyroom-profile";
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
    for (const t of ["teddy", "cushions", "ball"]) check(`setup: the Toy Room has a ${t}`, Boolean(await prop(cdp, t)));
    await waitFor(() => world(cdp, `!!(w.getMix() && w.getMix().canDrive(w.P.rig))`), { timeoutMs: 30000, label: "the character clips" });

    // ---- the teddy: a hug ----
    const teddyAt = await stage(cdp, "teddy");
    await clearToast(cdp);
    await tapProp(cdp, "teddy");
    await sleep(250);
    check("teddy: a tap says its name", (await toastText(cdp)) === "Brown teddy bear", String(await toastText(cdp)));
    check("teddy: and Kip sets off (walking over, or already there)", ["walking", "acting"].includes(await phase(cdp)), String(await phase(cdp)));
    const hug = await sample(cdp, 4500, async () => ({ p: await phase(cdp), a: (await toy(cdp)).action, hearts: await world(cdp, `w.acts.heartCount`), sy: await scaleY(cdp, "teddy") }));
    check("teddy: Kip plays the hug clip", hug.some((s) => s.a === "hug"), JSON.stringify([...new Set(hug.map((s) => s.a))]));
    check("teddy: hearts float up", hug.some((s) => s.hearts >= 1), String(Math.max(...hug.map((s) => s.hearts))));
    check("teddy: the teddy is squished while it is hugged", Math.min(...hug.map((s) => s.sy)) < 0.95, String(Math.min(...hug.map((s) => s.sy))));
    const hugEnd = await toy(cdp);
    check("teddy: it finishes by itself and Kip is free to move again", (await phase(cdp)) === "idle" && hugEnd.busy === false, JSON.stringify(hugEnd));
    // tap it again (the camera has moved with Kip: find the teddy on screen again) and photograph the hug
    await tapProp(cdp, "teddy");
    await waitFor(async () => (((await toy(cdp)).action === "hug") ? true : null), { timeoutMs: 6000, everyMs: 40, label: "hug again" });
    await sleep(500);
    await shot(cdp, "1-hug");
    // a tap during the hug is swallowed: Kip does not walk off
    await cdp.tapAt(200, 640);
    await sleep(300);
    const swallowed = await toy(cdp);
    check("teddy: a tap during the hug is swallowed (Kip does not walk off)", swallowed.target === null && (await phase(cdp)) === "acting", JSON.stringify(swallowed));
    await waitFor(async () => ((await phase(cdp)) === "idle" ? true : null), { timeoutMs: 6000, everyMs: 50, label: "hug over" });

    // ---- the cushions: hop up, bounce, cheer, hop down ----
    const cushAt = await stage(cdp, "cushions");
    await clearToast(cdp);
    const cushNow0 = await tapProp(cdp, "cushions");
    await sleep(250);
    check("cushions: a tap says its name and Kip sets off", (await toastText(cdp)) === "Colorful cushions" && ["walking", "acting"].includes(await phase(cdp)), JSON.stringify({ toast: await toastText(cdp), phase: await phase(cdp), at: [cushAt, cushNow0], toy: await toy(cdp) }));
    const jump = await sample(cdp, 4200, async () => { const t = await toy(cdp); return { p: await phase(cdp), a: t.action, hop: t.hop, sy: await scaleY(cdp, "cushions"), x: t.x }; }, 35);
    check("cushions: Kip hops well off the floor", Math.max(...jump.map((s) => s.hop)) > 0.8, String(Math.max(...jump.map((s) => s.hop))));
    check("cushions: it cheers (arms up) at the top", jump.some((s) => s.a === "cheer"), JSON.stringify([...new Set(jump.map((s) => s.a))]));
    check("cushions: the pile squishes as it lands", Math.min(...jump.map((s) => s.sy)) < 0.95, String(Math.min(...jump.map((s) => s.sy))));
    const jumpEnd = await toy(cdp);
    const cp = await prop(cdp, "cushions");
    check("cushions: it ends back on the floor beside the pile, free to move", (await phase(cdp)) === "idle" && jumpEnd.hop < 0.3 && jumpEnd.busy === false && Math.abs(jumpEnd.x - (cp.x - 1.7)) < 0.4, JSON.stringify(jumpEnd));
    await tapProp(cdp, "cushions");
    await waitFor(async () => (((await toy(cdp)).hop > 1.2) ? true : null), { timeoutMs: 8000, everyMs: 30, label: "mid jump" }).catch(() => null);
    await shot(cdp, "2-jump");
    await waitFor(async () => ((await phase(cdp)) === "idle" ? true : null), { timeoutMs: 8000, everyMs: 50, label: "jump over" });

    // ---- the ball: walk over, kick, it flies and rolls and stays ----
    const ballAt = await stage(cdp, "ball");
    const ball0 = await ballState(cdp);
    await clearToast(cdp);
    await tapProp(cdp, "ball");
    await sleep(250);
    check("ball: a tap says its name", (await toastText(cdp)) === "Red ball", String(await toastText(cdp)));
    let shotTaken = false;
    const kick = await sample(cdp, 6500, async () => { const b = await ballState(cdp); const a = (await toy(cdp)).action; if (!shotTaken && b.y > 0.5) { shotTaken = true; await shot(cdp, "3-kick"); } return { a, ...b }; }, 40);
    check("ball: Kip plays the kick clip", kick.some((s) => s.a === "kick"), JSON.stringify([...new Set(kick.map((s) => s.a))]));
    // (The Toy Room has a dog, which fetches the ball back once it has stopped: measure the kick up to the moment the ball first comes to rest.)
    const flew = kick.findIndex((s) => s.moving);
    const stopAt = kick.findIndex((s, i) => i > flew && flew >= 0 && !s.moving);
    const stop = stopAt >= 0 ? kick[stopAt] : kick.at(-1);
    const flight = stopAt >= 0 ? kick.slice(0, stopAt + 1) : kick;
    check("ball: it flies off the floor and travels a few units (not across the room)", Math.max(...flight.map((s) => s.y)) > 0.3 && Math.abs(stop.x - ball0.x) > 3 && Math.abs(stop.x - ball0.x) < 8, JSON.stringify({ from: ball0.x, to: stop.x, up: Math.max(...flight.map((s) => s.y)) }));
    check("ball: it was kicked to the RIGHT (where the camera shows room), away from Kip", stop.x - ball0.x > 3, JSON.stringify({ from: ball0.x, to: stop.x }));
    check("ball: it rolled (turned) and has come to rest on the floor", Math.abs(stop.spin) > 3 && stop.moving === false && stop.y < 0.01, JSON.stringify(stop));
    const stopped = stop.x;
    check("ball: it stays where it stopped until the dog fetches it", kick.slice(stopAt, stopAt + 4).every((s) => Math.abs(s.x - stopped) < 0.001), JSON.stringify(kick.slice(stopAt, stopAt + 4).map((s) => +s.x.toFixed(3))));
    check("ball: Kip is free to move again", (await phase(cdp)) === "idle" && (await toy(cdp)).busy === false);
    // kick it again: Kip follows it
    const ballAt2 = await propScreen(cdp, "ball");
    if (ballAt2 && ballAt2.visible && ballAt2.x > 30 && ballAt2.x < 380) {
      await tapProp(cdp, "ball");
      const again = await sample(cdp, 7000, async () => (await ballState(cdp)).x, 80);
      check("ball: tapped again, Kip walks to it and kicks it again (it moves a good way once more)", Math.max(...again) - Math.min(...again) > 1.5, JSON.stringify([stopped, Math.min(...again), Math.max(...again)]));
    } else check("ball: it stopped where it can be tapped again", false, JSON.stringify(ballAt2));

    // ---- changing its mind on the way to the teddy ----
        // Kip stands 5 units away (the prop need not be on screen: the tap that starts the visit is made from the page), then a real tap on the ground comes at once
    await cdp.ev(`(() => { const w = window.__tvWorld; const i = w.props.list().find((p) => p.type === "teddy"); w.P.pos.x = i.base.px - 5; w.P.pos.z = 0; w.P.target = null; w.P.hop = 0; })()`);
    await sleep(400);
    check("mind: the visit starts (walking to the teddy)", (await world(cdp, `(() => { const i = w.props.list().find((p) => p.type === "teddy"); return w.acts.tap(i); })()`)) === true && (await phase(cdp)) === "walking", String(await phase(cdp)));
    await cdp.tapAt(120, 640);
    await sleep(500);
    check("mind: tapping the ground drops the visit; Kip goes where it was sent", (await phase(cdp)) === "idle", String(await phase(cdp)));

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
