#!/usr/bin/env node
// The grown-up checks and limits master switch in the REAL game (docs/specs/parent-controls-off-spec.md): headless Chrome, the game on a phone-sized window, served by its
// own `vite dev` on a port of its own. The Worker's /api/parent routes are blocked so the game uses its local fallback (deterministic: no D1 to merge over the seeded state).
//
// What it proves (each phase is a fresh tab, so a new tab's own sessionStorage is also exercised):
//   P1  switch ON, Demo Mode on, today's time spent: the Sleep Curtain is up; the sheet asks (hold, then the question, then the PIN pad); only after that does the Showcase block
//       offer the switch; flipping it shows the banner, lifts the curtain, writes only sessionStorage, and leaves the saved settings + ledger byte-for-byte as they were;
//       "Turn back on" in the banner puts the curtain back; turning Demo Mode off while the switch is off clears it for good (Demo Mode on again does not bring it back).
//   P2  switch OFF (session value + Demo Mode): the banner is there at load, the curtain is not, the sheet opens straight onto the settings (no hold, no question), nothing is
//       written to the saved bundle, and flipping the switch on inside the open sheet locks it again at once.
//   P3  switch OFF with time left: five-second heartbeats do NOT count play time (bundle unchanged);  P4 control: switch ON, the same ledger DOES count it.
//   P5  "?parentControls=off" (and the other spellings) in the address bar changes nothing.
//   P6  switch OFF: the Workshop is mounted with downloads (the Kip bench has its Print group). (ON has none: e2e-game-workshop.mjs.)
// Run: E2E_GPU=metal node scripts/e2e-parent-controls.mjs     Overrides: E2E_PORT (default 5399), E2E_NO_SERVER=1 (use a running dev server).
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { createChecks, launchChrome } from "./lib/kip-e2e.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PORT = Number(process.env.E2E_PORT ?? 5399);
const BASE = `http://localhost:${PORT}`;
const SHOTS = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), "parent-controls-shots");
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { check, finish } = createChecks("parent controls e2e");

const PARENT_KEY = "toyforge:parent-time:v1";
const SESSION_KEY = "toyforge:parent-controls:v1";
const DEMO_KEY = "toyforge:demo-mode:v1";

/** Runs before the first page script of a tab: seeds today's play-time state, Demo Mode and (optionally) the tab's session value. */
const seed = ({ spent, demo, sessionOff }) => `(() => { try {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const settings = { enabled: true, timezone: tz, dailyBaseMinutes: 20, dailyLimitMinutes: 30, minutesPerChallenge: 5, sessionLimitMinutes: null,
    quietHours: { enabled: false, start: '19:30', end: '07:00' }, gateStrictness: 'every_time', pinHash: null, pinFailedAttempts: 0, pinCooldownUntil: null };
  const ledger = { day, usedSeconds: ${spent ? 3600 : 0}, earnedMinutes: 0, extraParentMinutes: 0, sessionUsedSeconds: 0, completedIds: [] };
  localStorage.setItem(${JSON.stringify(PARENT_KEY)}, JSON.stringify({ settings, ledger }));
  ${demo ? `localStorage.setItem(${JSON.stringify(DEMO_KEY)}, '1');` : ""}
  ${sessionOff ? `sessionStorage.setItem(${JSON.stringify(SESSION_KEY)}, 'off');` : ""}
} catch (e) { console.error('seed failed', e); } })()`;

const dev = process.env.E2E_NO_SERVER === "1" ? null : spawn("node", [path.join(ROOT, "node_modules/vite/bin/vite.js"), "--port", String(PORT), "--strictPort"], { cwd: ROOT, stdio: "ignore" });
let chrome;
const tabs = [];

/** A fresh tab with the given seed; resolves once the dock is up. */
async function tab(name, opts, url = `${BASE}/?title=0`) { // ?title=0: straight into the world, not the main menu
  const t = await chrome.open("about:blank", { width: 390, height: 844, mobile: true });
  tabs.push(t);
  await t.send("Page.addScriptToEvaluateOnNewDocument", { source: seed(opts) });
  await t.send("Network.enable");
  await t.send("Network.setBlockedURLs", { urls: ["*/api/parent/*"] });
  await t.send("Page.navigate", { url });
  const up = await t.waitFor(`!!document.querySelector('.tv-dock-right') && !!document.querySelector('.tv-toy-pill')`, 120000);
  check(`${name}: the game loads to its dock`, up);
  await sleep(600);
  return t;
}

/** Really close the tab (not just its debugging socket): tabs share one localStorage, and a left-over tab's 5-second heartbeat would write into the next phase's seeded ledger. */
const closeTab = async (t) => {
  if (t.__closed) return; // a closed socket never answers: sending to it would hang
  t.__closed = true;
  try { await Promise.race([t.send("Page.close"), sleep(2000)]); } catch { /* already gone */ }
  try { t.close(); } catch { /* closed */ }
  await sleep(300);
};
const toyPillDisabled = (t) => t.evaluate(`document.querySelector('.tv-toy-pill').disabled`);
const bannerText = (t) => t.evaluate(`document.querySelector('[data-testid=parent-controls-banner]')?.textContent ?? null`);
const bundle = (t) => t.evaluate(`localStorage.getItem(${JSON.stringify(PARENT_KEY)})`);
const sessionValue = (t) => t.evaluate(`sessionStorage.getItem(${JSON.stringify(SESSION_KEY)})`);
const clickText = (t, selector, re) => t.evaluate(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => ${re}.test(x.textContent)); if (!b) return false; b.click(); return true; })()`);
const openSheet = (t) => t.evaluate(`document.querySelector('.tv-ctl-gear').click(); 0`);
const sheetHas = (t, sel) => t.evaluate(`!!document.querySelector('.tv-parent-modal ${sel}')`);
const showcaseToggle = (t) => t.evaluate(`[...document.querySelectorAll('.tv-parent-modal button')].find((b) => /Grown-up checks and limits:/.test(b.textContent))?.textContent ?? null`);

try {
  for (let i = 0; i < 240; i++) {
    try { if ((await fetch(`${BASE}/`)).ok) break; } catch { /* not up yet */ }
    await sleep(500);
  }
  chrome = await launchChrome();

  // ================= P1: switch ON =================
  console.log("P1: the switch is on");
  {
    const t = await tab("P1", { spent: true, demo: true, sessionOff: false });
    check("P1: control: with today's time spent and the switch on, the Sleep Curtain is up (the dock is disabled)", await toyPillDisabled(t));
    check("P1: no banner while the switch is on", (await bannerText(t)) === null);

    await openSheet(t);
    check("P1: the Grown-Ups sheet opens onto the hold step, not the settings", await t.waitFor(`!!document.querySelector('.tv-parent-modal .tv-parent-hold-btn')`, 15000));
    check("P1: the switch is not offered before the grown-up question is passed", (await showcaseToggle(t)) === null);

    // hold 1.3 s -> the question
    await t.evaluate(`document.querySelector('.tv-parent-hold-btn').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 })); 0`);
    check("P1: holding for 1.2 s brings the question", await t.waitFor(`!!document.getElementById('tv-parent-answer')`, 8000));
    const [a, b] = JSON.parse(await t.evaluate(`JSON.stringify(document.querySelector('label[for=tv-parent-answer]').textContent.match(/\\d+/g).map(Number))`));
    await t.evaluate(`(() => { const i = document.getElementById('tv-parent-answer'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(String(a * b))}); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await sleep(200);
    await t.evaluate(`document.querySelector('.tv-parent-modal form button[type=submit]').click(); 0`);
    check("P1: the right answer leads to the PIN pad (first-time setup)", await t.waitFor(`!!document.querySelector('.tv-pin-pad')`, 8000));
    for (let round = 0; round < 2; round++) {
      for (const d of ["1", "2", "3", "4"]) { await t.evaluate(`[...document.querySelectorAll('.tv-pin-key')].find((k) => k.textContent.trim() === ${JSON.stringify(d)}).click(); 0`); await sleep(150); }
      await sleep(500);
    }
    check("P1: after the PIN is set the sheet is unlocked and the Showcase block offers the switch, currently On", await t.waitFor(`[...document.querySelectorAll('.tv-parent-modal button')].some((b) => /Grown-up checks and limits: On/.test(b.textContent))`, 15000));

    const before = await bundle(t);
    await clickText(t, ".tv-parent-modal button", "/Grown-up checks and limits: On/");
    check("P1: flipping it shows the banner", await t.waitFor(`!!document.querySelector('[data-testid=parent-controls-banner]')`, 8000));
    const text = await bannerText(t);
    check("P1: the banner says so and offers \"Turn back on\"", /Grown-up checks and limits are off \(demo\)/.test(text ?? "") && /Turn back on/.test(text ?? ""), String(text));
    check("P1: the Sleep Curtain is lifted (the dock is usable)", await t.waitFor(`!document.querySelector('.tv-toy-pill').disabled`, 8000));
    check("P1: only this tab's sessionStorage changed: the value is 'off', the saved bundle is byte-for-byte as it was", (await sessionValue(t)) === "off" && (await bundle(t)) === before);
    check("P1: the sheet's button now reads Off", (await showcaseToggle(t)) === "Grown-up checks and limits: Off", String(await showcaseToggle(t)));
    await t.shot(path.join(SHOTS, "parent-controls-banner.png"));

    await clickText(t, "[data-testid=parent-controls-banner] button", "/Turn back on/");
    check("P1: \"Turn back on\" in the banner removes the banner and puts the curtain back", await t.waitFor(`!document.querySelector('[data-testid=parent-controls-banner]') && document.querySelector('.tv-toy-pill').disabled`, 8000));
    check("P1: and clears the session value; the saved bundle is still byte-for-byte as it was", (await sessionValue(t)) === null && (await bundle(t)) === before);

    // Demo Mode off ends it for good
    await clickText(t, ".tv-parent-modal button", "/Grown-up checks and limits: On/");
    check("P1: (off again) the banner is back", await t.waitFor(`!!document.querySelector('[data-testid=parent-controls-banner]')`, 8000));
    await clickText(t, ".tv-parent-modal button", "/Demo Mode: On/");
    check("P1: turning Demo Mode off ends it: banner gone, curtain back, session value removed", await t.waitFor(`!document.querySelector('[data-testid=parent-controls-banner]') && document.querySelector('.tv-toy-pill').disabled`, 8000) && (await sessionValue(t)) === null);
    await clickText(t, ".tv-parent-modal button", "/Demo Mode: Off/");
    await sleep(500);
    check("P1: and turning Demo Mode on again does not bring it back", (await bannerText(t)) === null && (await sessionValue(t)) === null && (await toyPillDisabled(t)));
    await closeTab(t);
  }

  // ================= P2: switch OFF at load =================
  console.log("P2: the switch is off");
  {
    const t = await tab("P2", { spent: true, demo: true, sessionOff: true });
    const before = await bundle(t);
    check("P2: the banner is there at load and the curtain is not (time is spent, yet the dock is usable)", (await bannerText(t)) !== null && !(await toyPillDisabled(t)));
    await openSheet(t);
    check("P2: the sheet opens straight onto the settings: no hold step, no question, no PIN pad", await t.waitFor(`[...document.querySelectorAll('.tv-parent-modal button')].some((b) => /Grown-up checks and limits: Off/.test(b.textContent))`, 15000)
      && !(await sheetHas(t, ".tv-parent-hold-btn")) && !(await sheetHas(t, "#tv-parent-answer")) && !(await sheetHas(t, ".tv-pin-pad")));
    check("P2: opening it wrote nothing to the saved bundle", (await bundle(t)) === before);
    await t.shot(path.join(SHOTS, "parent-controls-open-sheet.png"));

    // flipping it on inside the open sheet locks the sheet again at once
    await clickText(t, ".tv-parent-modal button", "/Grown-up checks and limits: Off/");
    check("P2: turning the switch on inside the open sheet locks it again at once (the hold step returns, the Showcase block is gone)", await t.waitFor(`!!document.querySelector('.tv-parent-modal .tv-parent-hold-btn')`, 8000)
      && (await showcaseToggle(t)) === null && (await bannerText(t)) === null && (await toyPillDisabled(t)));
    check("P2: the bundle is still untouched", (await bundle(t)) === before);
    await closeTab(t);
  }

  // ================= P3 / P4: play time is not counted while off =================
  console.log("P3/P4: heartbeats");
  {
    const off = await tab("P3", { spent: false, demo: true, sessionOff: true });
    const b0 = await bundle(off);
    await sleep(7500);
    const b1 = await bundle(off);
    check("P3: switch off: after more than one 5-second heartbeat the saved bundle is unchanged (no play time counted)", b0 === b1, `${b0} -> ${b1}`);
    await closeTab(off);

    const on = await tab("P4", { spent: false, demo: true, sessionOff: false });
    const c0 = JSON.parse(await bundle(on)).ledger.usedSeconds;
    await sleep(7500);
    const c1 = JSON.parse(await bundle(on)).ledger.usedSeconds;
    check("P4: control: switch on, the same ledger does count it (usedSeconds went up)", c1 > c0, `${c0} -> ${c1}`);
    await closeTab(on);
  }

  // ================= P5: the address bar does nothing =================
  console.log("P5: the address bar");
  {
    const t = await tab("P5", { spent: true, demo: true, sessionOff: false }, `${BASE}/?title=0&parentControls=off&PARENT_CONTROLS=off&VITE_PARENT_CONTROLS=off#parentControls=off`);
    check("P5: ?parentControls=off (and the other spellings) leave the checks on: curtain up, no banner", (await toyPillDisabled(t)) && (await bannerText(t)) === null);
    await closeTab(t);
  }

  // ================= P6: the Workshop has downloads while off =================
  console.log("P6: the Workshop");
  {
    const t = await tab("P6", { spent: true, demo: true, sessionOff: true });
    check("P6: the Workshop button is there (the curtain is not up)", await clickText(t, ".tv-dock-right button", "/^\\s*Workshop\\s*$/"));
    check("P6: the Kip bench opens", await t.waitFor(`!!document.querySelector('[role=dialog][aria-label=Workshop] .ws-root .kip-bench #kip-menu')`, 300000));
    await sleep(800);
    const dl = await t.evaluate(`({ plateView: !!document.getElementById('km-plateView'), groups: [...document.querySelectorAll('#kip-menu .km-group')].map((g) => g.dataset.group).join() })`);
    check("P6: with the switch off the Kip bench has its Print group (downloads are on)", dl.plateView === true && /print/.test(dl.groups), JSON.stringify(dl));
    await closeTab(t);
  }

  const exceptions = tabs.flatMap((t) => t.exceptions ?? []);
  check("nothing threw in any tab", exceptions.length === 0, JSON.stringify(exceptions).slice(0, 300));
} finally {
  for (const t of tabs) await closeTab(t);
  try { chrome?.close?.(); } catch { /* gone */ }
  try { dev?.kill(); } catch { /* gone */ }
  finish();
}
