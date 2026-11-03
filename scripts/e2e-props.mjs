#!/usr/bin/env node
// 390x844 headless-Chrome E2E for "no dead props" + the say-what-it-is language option (carousel spec 11.7, propReactions.ts).
// Boots the real app on its own vite port and drives the real stage: taps a real tree and a real lantern, switches language
// through the real More menu, and checks what is spoken. /api/voice is INTERCEPTED (CDP Fetch): the e2e never calls the model
// (no spend); it records the clip URLs the game asks for and answers with a tiny silent WAV.
// Needs a real GPU: --headless=new with the Metal backend. Run: node scripts/e2e-props.mjs
// Overrides: E2E_CHROME, E2E_PORT, E2E_DEBUG_PORT, E2E_PROFILE. Exits nonzero on any failing check.
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
const CHROME = process.env.E2E_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEV_PORT = Number(process.env.E2E_PORT ?? 5196);
const DEBUG_PORT = Number(process.env.E2E_DEBUG_PORT ?? 9346);
const PROFILE = process.env.E2E_PROFILE ?? "/tmp/toyforge-e2e-props-profile";
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

    await loadApp(cdp, undefined);
    if (process.env.E2E_SURVEY) {   // dev aid: which props sit on the playable lane (x 3..41) in each world?
      for (const w of ["garden", "sky", "junk", "beach", "snow", "room"]) {
        await cdp.ev(`window.__tvWorld.handle.go(${JSON.stringify(w)})`);
        await sleep(2500);
        console.log(w.padEnd(7), await props(cdp, `JSON.stringify(fx.list().filter((p) => p.holder.position.x >= 3 && p.holder.position.x <= 41).map((p) => p.type + "@" + Math.round(p.holder.position.x)))`));
      }
      killAll(); return;
    }

    // ---- 1. default language is English; every placed prop is registered ----
    const types = await props(cdp, `fx.list().map((p) => p.type)`);
    check("props: the garden's props are registered", Array.isArray(types) && types.length >= 4, JSON.stringify(types));
    const everyReacts = await props(cdp, `fx.list().every((p) => p.holder.userData.propInst === p)`);
    check("props: every registered prop is pickable", everyReacts === true);

    // ---- 2. tap a tree: caption, spoken clip, apples fall; the toy does NOT walk to it ----
    const treeAt = await bringIntoView(cdp, "tree");
    check("tree: found one and brought it on screen", Boolean(treeAt), JSON.stringify(types));
    if (treeAt) {
      const before = await props(cdp, `fx.list().find((p) => p.type === "tree" && p.holder.position.x >= 3 && p.holder.position.x <= 41).slots.filter((s) => s.mesh).length`);
      const targetBefore = await cdp.ev(`JSON.stringify(window.__tvWorld.P.target && window.__tvWorld.P.target.x)`);
      await clearToast(cdp);
      cdp.voiceUrls.length = 0;
      await cdp.tapAt(treeAt.x, treeAt.y);
      await sleep(500);
      const apples = await props(cdp, `fx.list().find((p) => p.type === "tree" && p.holder.position.x >= 3 && p.holder.position.x <= 41).slots.filter((s) => s.mesh).length`);
      check("tree: starts with apples hanging", before === 3, String(before));
      check("tree: a tap shakes two apples loose", apples === 1 && (await props(cdp, `fx.fallerCount()`)) === 2, `hanging=${apples}`);
      check("tree: says 'Green tree' (English default)", (await toastText(cdp)) === "Green tree", String(await toastText(cdp)));
      check("tree: asks for the English clip for exactly this object", cdp.voiceUrls.includes("/api/voice?lang=en&n=tree&c=green"), JSON.stringify(cdp.voiceUrls));
      const targetAfter = await cdp.ev(`JSON.stringify(window.__tvWorld.P.target && window.__tvWorld.P.target.x)`);
      check("tree: tapping it does not send the toy walking", targetBefore === targetAfter, `${targetBefore} -> ${targetAfter}`);
    }

    // ---- 2b. tap the apples themselves: the FRUIT says its name; a hanging one is plucked, a fallen one hops (Dan's playtest, 2026-11-03) ----
    if (treeAt) {
      const applePos = (which) => props(cdp, `(() => { const which = ${JSON.stringify(which)}; const i = fx.list().find((p) => p.type === "tree" && ${LANE_JS}); const m = which === "hanging" ? (i.slots.find((s) => s.mesh) || {}).mesh : (fx.fallers.find((f) => f.state === 1) || {}).mesh; if (!m) return null; const v = m.getWorldPosition(new window.__tvDebug.camera.position.constructor()).project(window.__tvDebug.camera); const r = document.querySelector("canvas").getBoundingClientRect(); return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height, on: Math.abs(v.x) < 1 && Math.abs(v.y) < 1 }; })()`);
      await sleep(1500); // the two shaken apples have landed
      const hangAt = await applePos("hanging");
      check("apple: one apple is still hanging and on screen", hangAt && hangAt.on, JSON.stringify(hangAt));
      if (hangAt && hangAt.on) {
        await clearToast(cdp); cdp.voiceUrls.length = 0;
        await cdp.tapAt(hangAt.x, hangAt.y);
        await sleep(500);
        check("apple: tapping the hanging apple says 'Red apple', not the tree", (await toastText(cdp)) === "Red apple", String(await toastText(cdp)));
        check("apple: and asks for the English clip for exactly that fruit", cdp.voiceUrls.includes("/api/voice?lang=en&n=apple&c=red"), JSON.stringify(cdp.voiceUrls));
        check("apple: it is plucked (nothing left hanging) and joins the two on the ground", (await props(cdp, `fx.list().find((p) => p.type === "tree" && ${LANE_JS}).slots.filter((s) => s.mesh).length`)) === 0 && (await props(cdp, `fx.fallerCount()`)) === 3);
      }
      await sleep(1600);
      const fallenAt = await applePos("fallen");
      check("apple: a fallen apple is lying on the ground, on screen", fallenAt && fallenAt.on, JSON.stringify(fallenAt));
      if (fallenAt && fallenAt.on) {
        await clearToast(cdp); cdp.voiceUrls.length = 0;
        await cdp.tapAt(fallenAt.x, fallenAt.y);
        await sleep(250);
        check("apple: tapping a fallen apple says 'Red apple' too", (await toastText(cdp)) === "Red apple", String(await toastText(cdp)));
        check("apple: and it hops (airborne again)", (await props(cdp, `fx.fallers.some((f) => f.state === 0)`)) === true);
        await sleep(1800);
        check("apple: still on the ground afterwards, not tidied away mid-hop", (await props(cdp, `fx.fallerCount()`)) === 3 && (await props(cdp, `fx.fallers.every((f) => f.state === 1)`)) === true);
      }
    }

    // ---- 3. tap a lantern: light off, then on ----
    const lanternAt = await bringIntoView(cdp, "lantern");
    check("lantern: found one and brought it on screen", Boolean(lanternAt));
    if (lanternAt) {
      const lit = () => props(cdp, `(() => { const i = fx.list().find((p) => p.type === "lantern" && p.holder.position.x >= 3 && p.holder.position.x <= 41); return { on: i.on, lights: i.lights.length, sprites: i.sprites.length, glows: i.glows.length, spritesVisible: i.sprites.every((s) => s.s.visible), peak: Math.max(0, ...i.lights.map((l) => l.l.intensity), ...i.glows.map((g) => g.m.emissiveIntensity)) }; })()`);
      const on0 = await lit();
      check("lantern: starts lit and has real light parts to switch", on0 && on0.on && on0.lights + on0.sprites + on0.glows > 0, JSON.stringify(on0));
      await clearToast(cdp);
      await cdp.tapAt(lanternAt.x, lanternAt.y);
      await sleep(400);
      const off = await lit();
      check("lantern: a tap switches it off (lights, glow and glass all dim)", off && off.on === false && off.peak < (on0?.peak ?? 1) * 0.2 && off.spritesVisible === (on0.sprites === 0), JSON.stringify(off));
      check("lantern: says 'Blue light'", (await toastText(cdp)) === "Blue light", String(await toastText(cdp)));
      await sleep(1000);
      await cdp.tapAt(lanternAt.x, lanternAt.y);
      await sleep(400);
      const on1 = await lit();
      check("lantern: the next tap switches it back on (bright again; the world flickers lantern light, so not an exact match)", on1 && on1.on === true && on1.peak >= on0.peak * 0.7 && on1.peak > off.peak * 5, JSON.stringify({ start: on0, off, back: on1 }));
    }

    // ---- 4. empty ground still walks the toy ----
    await cdp.ev(`(() => { window.__tvWorld.P.target = null; })()`);
    await cdp.tapAt(300, 640);
    await sleep(300);
    const walking = await cdp.ev(`window.__tvWorld.P.target != null`);
    check("ground: tapping empty ground still sends the toy walking", walking === true);

    // ---- 5. language: pick Spanish through the real menu; the sample plays; taps now speak Spanish ----
    await clickButton(cdp, "button", "More"); await sleep(500);
    const item = await cdp.ev(`(() => { const b = [...document.querySelectorAll('[role="menuitem"]')].find((x) => x.textContent.trim().startsWith("Words")); return b ? b.textContent.trim() : null; })()`);
    check("language: the More menu has 'Words & Language' showing English", item && item.includes("English"), String(item));
    await clickButton(cdp, '[role="menuitem"]', "Words"); await sleep(600);
    check("language: the sheet opens", await cdp.ev(`!!document.querySelector('[role="dialog"][aria-label="Words and Language"]:not([hidden])')`));
    cdp.voiceUrls.length = 0;
    await clickButton(cdp, "button.tv-sc", "Español"); await sleep(700);
    check("language: choosing Español plays its sample (árbol verde)", cdp.voiceUrls.includes("/api/voice?lang=es&n=tree&c=green"), JSON.stringify(cdp.voiceUrls));
    check("language: the choice is saved", (await cdp.ev(`localStorage.getItem("toyforge:prop-lang:v1")`)) === "es");
    await clickButton(cdp, "button", "Done"); await sleep(500);
    const tree2 = await bringIntoView(cdp, "tree");
    if (tree2) {
      await clearToast(cdp); cdp.voiceUrls.length = 0;
      await sleep(1000); // past the repeat-word guard
      await cdp.tapAt(tree2.x, tree2.y); await sleep(500);
      check("language: now the tree says 'Árbol verde'", (await toastText(cdp)) === "Árbol verde", String(await toastText(cdp)));
      check("language: and asks for the Spanish clip", cdp.voiceUrls.includes("/api/voice?lang=es&n=tree&c=green"), JSON.stringify(cdp.voiceUrls));
    }

    // ---- 5b. Türkçe is offered with the others, and works ----
    await clickButton(cdp, "button", "More"); await sleep(500);
    await clickButton(cdp, '[role="menuitem"]', "Words"); await sleep(600);
    const offered = await cdp.ev(`[...document.querySelectorAll('[aria-label="Words and Language"] button.tv-sc')].map((b) => (b.querySelector("span") || b).textContent.trim()).join(",")`);
    check("language: the picker offers all seven languages and Off", offered === "English,Español,Français,Deutsch,Italiano,Português,Türkçe,Off", String(offered));
    cdp.voiceUrls.length = 0;
    await clickButton(cdp, "button.tv-sc", "Türkçe"); await sleep(700);
    check("language: choosing Türkçe plays its sample", cdp.voiceUrls.includes("/api/voice?lang=tr&n=tree&c=green"), JSON.stringify(cdp.voiceUrls));
    await clickButton(cdp, "button", "Done"); await sleep(500);
    const tree3 = await bringIntoView(cdp, "tree");
    if (tree3) {
      await clearToast(cdp); await sleep(1000);
      await cdp.tapAt(tree3.x, tree3.y); await sleep(500);
      check("language: the tree now says 'Yeşil ağaç'", (await toastText(cdp)) === "Yeşil ağaç", String(await toastText(cdp)));
    }

    // ---- 6. persists across a reload, and Off silences the naming but not the reaction ----
    await loadApp(cdp, "es");
    const t3 = await bringIntoView(cdp, "tree");
    if (t3) {
      await clearToast(cdp); cdp.voiceUrls.length = 0;
      await cdp.tapAt(t3.x, t3.y); await sleep(500);
      check("persist: after a reload the saved language still applies", (await toastText(cdp)) === "Árbol verde", String(await toastText(cdp)));
    }
    await loadApp(cdp, "off");
    const t4 = await bringIntoView(cdp, "tree");
    if (t4) {
      await clearToast(cdp); cdp.voiceUrls.length = 0;
      await cdp.tapAt(t4.x, t4.y); await sleep(500);
      check("off: the prop still reacts (apples fall)", (await props(cdp, `fx.fallerCount()`)) === 2);
      check("off: but nothing is said or asked for", (await toastText(cdp)) === null && cdp.voiceUrls.filter((u) => u.includes("n=tree")).length === 0, `${await toastText(cdp)} ${JSON.stringify(cdp.voiceUrls)}`);
    }


    // ---- 7. the tour: every prop type on the lane, in every world, in the real app ----
    await loadApp(cdp, "en");
    let tapped = 0, direct = 0;
    for (const w of ["garden", "sky", "junk", "beach", "snow", "room"]) {
      await cdp.ev(`window.__tvWorld.handle.go(${JSON.stringify(w)})`);
      await sleep(2500);
      const laneTypes = await props(cdp, `[...new Set(fx.list().filter((p) => ${LANE_JS}).map((p) => p.type))]`);
      check(`tour ${w}: has props on the lane`, Array.isArray(laneTypes) && laneTypes.length > 0, JSON.stringify(laneTypes));
      for (const type of laneTypes ?? []) {
        let at = null;
        // Tapping a toy sends Kip off to play with it (hug, kick, strum, sleep...), and a tap during that is deliberately swallowed: end whatever the last prop started, so each prop is tapped on its own.
        await cdp.ev(`(() => { const w = window.__tvWorld; if (w.acts) w.acts.reset(); if (w.sleep) w.sleep.reset(); if (w.bubbles) w.bubbles.reset(); w.P.busy = false; w.P.hop = 0; return true; })()`);
        try { at = await bringIntoView(cdp, type); } catch { at = null; }
        await clearToast(cdp);
        await sleep(1000); // past the repeat-word guard
        const taps0 = await props(cdp, `fx.list().find((p) => p.type === ${JSON.stringify(type)} && ${LANE_JS}).taps`);
        if (at) { await cdp.tapAt(at.x, at.y); tapped++; }
        else { await props(cdp, `fx.activate(fx.list().find((p) => p.type === ${JSON.stringify(type)} && ${LANE_JS}))`); direct++; }
        await sleep(350);
        const r = await props(cdp, `(() => { const i = fx.list().find((p) => p.type === ${JSON.stringify(type)} && ${LANE_JS}); const n = fx.nameOf(i); return { taps: i.taps, name: n && n.text }; })()`);
        const said = await toastText(cdp);
        const how = at ? "tapped" : "direct";
        check(`tour ${w}/${type}: reacts (${how})`, r && r.taps === taps0 + 1, JSON.stringify({ taps0, r }));
        check(`tour ${w}/${type}: says its name (${how})`, r && r.name && said === r.name.charAt(0).toUpperCase() + r.name.slice(1), `${said} vs ${r && r.name}`);
      }
    }
    check("tour: most props were reached with a real mouse tap, not a direct call", tapped >= direct, `tapped=${tapped} direct=${direct}`);

    check("no-uncaught-exception", cdp.exceptions.length === 0, cdp.exceptions.slice(0, 3).join(" | "));
  } catch (err) {
    check("scenario-error", false, String((err && err.message) || err));
  } finally {
    killAll();
  }
  let failed = 0;
  for (const r of results) { if (!r.pass) failed += 1; console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.detail && !r.pass ? ` — ${r.detail}` : ""}`); }
  console.log(`${results.length - failed}/${results.length} checks passed`);
  process.exitCode = failed > 0 ? 1 : 0;
}

await main();
