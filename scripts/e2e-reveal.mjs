#!/usr/bin/env node
// 390x844 headless-Chrome E2E for the Reveal ("plays once, then saves"; Day 8 goal). Boots the real app on its own vite port,
// seeds a build for the active toy with NO saved Reveal (before any app code runs), and drives the real menus over CDP.
// Needs a real GPU: --headless=new with the Metal backend (SwiftShader hangs the stage). Run: node scripts/e2e-reveal.mjs
// Overrides: E2E_CHROME (binary), E2E_PORT, E2E_DEBUG_PORT, E2E_PROFILE. Exits nonzero on any failing check.
// Observable used for "the entrance theme plays": the overlay's theme button reads "Stop theme" only while audio is running
// (autoplay is allowed via a Chrome flag). Not covered: that the audio is audible or the 15 s melody sounds right.
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
const CHROME = process.env.E2E_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEV_PORT = Number(process.env.E2E_PORT ?? 5197);
const DEBUG_PORT = Number(process.env.E2E_DEBUG_PORT ?? 9347);
const PROFILE = process.env.E2E_PROFILE ?? "/tmp/toyforge-e2e-reveal-profile";
const APP = `http://localhost:${DEV_PORT}/`;
const BUILD = JSON.stringify([
  { instanceId: "1", partId: "racer-spoiler", xMm: 0, yMm: 0, rotation: 0 },
  { instanceId: "2", partId: "glow-capsule", xMm: 25, yMm: 0, rotation: 0 },
]);

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

class Cdp {
  constructor(url) { this.url = url; this.id = 1; this.pending = new Map(); this.exceptions = []; }
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
}

const results = [];
const check = (name, pass, detail = "") => results.push({ name, pass: Boolean(pass), detail });

const click = (cdp, sel, textStart) => cdp.ev(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => (x.getAttribute("aria-label") || x.textContent || "").trim().startsWith(${JSON.stringify(textStart)})); if (b) { b.click(); return true; } return false; })()`);
const overlay = async (cdp) => JSON.parse((await cdp.ev(`(() => { const d = document.querySelector('[role="dialog"][aria-label="Character Card"]'); if (!d) return "null"; const btns = [...d.querySelectorAll("button")].map((b) => b.textContent.trim()); return JSON.stringify({ kicker: d.querySelector(".kicker-label")?.textContent?.trim(), playing: btns.includes("Stop theme"), replay: btns.includes("Replay theme"), noBuild: /Open Build/.test(d.textContent) }); })()`)) ?? "null");
const revealCount = (cdp) => cdp.ev(`(() => { try { return JSON.parse(localStorage.getItem("toyforge:reveals:v1") || "[]").length; } catch { return -1; } })()`);
const pastTitle = (cdp) => cdp.ev(`(() => { const t = document.querySelector("#title"); if (t && !t.hidden) document.querySelector("#play")?.click(); })()`);

// Load the app fresh with the seed applied before any app code runs (a write-then-reload races the old page's autosave).
async function fresh(cdp, toyId, withBuild) {
  const source = `try { localStorage.removeItem("toyforge:reveals:v1"); ${withBuild ? `localStorage.setItem("toyforge:build:v1:${toyId}", ${JSON.stringify(BUILD)});` : `localStorage.removeItem("toyforge:build:v1:${toyId}");`} } catch (e) {}`;
  const { identifier } = await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source });
  try {
    await cdp.send("Page.navigate", { url: APP });
    await waitFor(() => cdp.ev(`!!document.querySelector("canvas")`), { label: "stage canvas" });
  } finally {
    await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
  }
  await sleep(2500);
  await pastTitle(cdp);
  await sleep(1500);
}
const openCharacterCardFromMenu = async (cdp) => {
  await click(cdp, "button", "More"); await sleep(600);
  const ok = await click(cdp, '[role="menuitem"]', "Character Card"); await sleep(2200);
  return ok;
};

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

    await cdp.send("Page.navigate", { url: APP });
    await waitFor(() => cdp.ev(`!!document.querySelector("canvas")`), { label: "stage canvas (first load)" });
    await sleep(2000); await pastTitle(cdp); await sleep(1500);
    const toyId = await cdp.ev(`(() => { const v = localStorage.getItem("toyforge:active-toy:v1"); try { const j = JSON.parse(v); return typeof j === "string" ? j : (j.id || j.toyId || v); } catch { return v; } })()`);
    check("active-toy-found", Boolean(toyId), String(toyId));

    // 1. The normal path: finish a build (Build -> Done) -> first Reveal plays and saves; it never plays again for that build.
    await fresh(cdp, toyId, true);
    check("normal: no card saved before", (await revealCount(cdp)) === 0);
    await click(cdp, "button", "Build"); await sleep(1500);
    await click(cdp, "button", "Done"); await sleep(2500);
    let o = await overlay(cdp);
    check("normal: Done opens the first Reveal", o?.kicker === "New Character Unlocked", JSON.stringify(o));
    check("normal: the entrance theme is playing", o?.playing === true, JSON.stringify(o));
    check("normal: the card is saved", (await revealCount(cdp)) === 1);
    await click(cdp, "button", "Close Character Card"); await sleep(800);
    check("normal: closing returns to the world", (await overlay(cdp)) === null);
    await click(cdp, "button", "Build"); await sleep(1500);
    await click(cdp, "button", "Done"); await sleep(2200);
    check("normal: finishing the same build again does not replay", (await overlay(cdp)) === null);
    check("normal: still exactly one saved card", (await revealCount(cdp)) === 1);
    await openCharacterCardFromMenu(cdp);
    o = await overlay(cdp);
    check("normal: the saved card re-opens as a plain card", o?.kicker === "Character Card", JSON.stringify(o));
    check("normal: and its theme does not autoplay", o?.playing === false && o?.replay === true, JSON.stringify(o));

    // 2. Menu first: a build that never had its Reveal, opened from More -> Character Card, is its first Reveal (was silently
    //    saved with no theme before the fix in GameCanvas: characterCardIsFirst).
    await fresh(cdp, toyId, true);
    check("menu-first: no card saved before", (await revealCount(cdp)) === 0);
    check("menu-first: menu item exists", await openCharacterCardFromMenu(cdp));
    o = await overlay(cdp);
    check("menu-first: opens as the first Reveal", o?.kicker === "New Character Unlocked", JSON.stringify(o));
    check("menu-first: the entrance theme is playing", o?.playing === true, JSON.stringify(o));
    check("menu-first: the card is saved", (await revealCount(cdp)) === 1);
    await click(cdp, "button", "Close Character Card"); await sleep(800);
    await openCharacterCardFromMenu(cdp);
    o = await overlay(cdp);
    check("menu-first: second open is a plain card, not playing", o?.kicker === "Character Card" && o?.playing === false, JSON.stringify(o));
    check("menu-first: still exactly one saved card", (await revealCount(cdp)) === 1);

    // 3. No build yet: the card prompts for Build and saves nothing (no Reveal to use up).
    await fresh(cdp, toyId, false);
    await openCharacterCardFromMenu(cdp);
    o = await overlay(cdp);
    check("no-build: shows the Open Build prompt", o?.noBuild === true, JSON.stringify(o));
    check("no-build: nothing saved", (await revealCount(cdp)) === 0);

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
