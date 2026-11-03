#!/usr/bin/env node
// Workshop shell: headless-Chrome checks (stage 4b of docs/specs/workshop-spec.md: benches are modules on one shared stage, no iframes).
// Run: npm run e2e:workshop     Exits nonzero on any failing check.
// Env: E2E_CHROME (binary), E2E_SHOTS (screenshot dir), E2E_STRICT_STL=1 (fail on missing STLs instead of stubbing).
//
// What it proves, with the REAL Kip and Truck modules inside the shell (nothing mocked):
//   - the shell is a proper tab bar (roles, one selected tab, arrow keys move focus without loading a bench) and there is no iframe;
//   - a deep link mounts only the bench it names, forwards the other params to it, and the bench actually uses them;
//   - picking a tab switches the active bench on the ONE canvas, keeps the bench you left mounted with its state, writes ?bench= and works with
//     Back/Forward;
//   - a bench's own link to another bench's page (the Truck's "Kip Viewer") switches the tab instead of leaving the page;
//   - the stage fills the window under the bar, on a desktop and on a phone width, with no page scroll, and the bench's fixed UI stays inside it;
//   - none of it throws.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createChecks, launchChrome, startServer } from "./lib/kip-e2e.mjs";

const SHOTS = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), "workshop-shots");
const { check, finish } = createChecks("workshop e2e");

const W = "window.workshop";
const KIP_READY = `${W}?.handles('kip')?.__KIP_READY__ === true`;
const TRUCK_READY = `${W}?.handles('truck')?.__TRUCK_READY__ === true`;
const selected = `[...document.querySelectorAll('.ws-tab')].filter((t) => t.getAttribute('aria-selected') === 'true').map((t) => t.dataset.bench)`;
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(SHOTS, { recursive: true });

const server = await startServer();
const chrome = await launchChrome();
try {
  // ---- A. deep link to Kip with a forwarded param; then tab, Back, Forward ----
  console.log("A. ?bench=kip&vehicle=truck");
  const a = await chrome.open(`${server.base}/kip/Workshop.html?bench=kip&vehicle=truck`);
  check("shell mounts a stage", await a.waitFor("!!document.querySelector('.ws-stage')", 30000));
  const shell = await a.evaluate(`({
    tabs: [...document.querySelectorAll('[role=tablist] [role=tab]')].map((t) => t.dataset.bench),
    selected: ${selected},
    panels: document.querySelectorAll('[role=tabpanel]').length,
    iframes: document.querySelectorAll('iframe').length,
    title: document.title,
    labelled: document.querySelector('[role=tabpanel]').getAttribute('aria-labelledby'),
    pop: document.querySelector('.ws-pop').getAttribute('href'),
  })`);
  check("tab bar lists Kip then Truck", JSON.stringify(shell.tabs) === '["kip","truck"]', JSON.stringify(shell.tabs));
  check("exactly one tab is selected: Kip", JSON.stringify(shell.selected) === '["kip"]', JSON.stringify(shell.selected));
  check("one tabpanel, labelled by the selected tab", shell.panels === 1 && shell.labelled === "ws-tab-kip", shell.labelled);
  check("there is no iframe anywhere", shell.iframes === 0, String(shell.iframes));
  check("document title names the bench", shell.title === "Workshop · Kip", shell.title);

  check("Kip finishes loading", await a.waitFor(KIP_READY, 240000), "never reached __KIP_READY__");
  const kip = await a.evaluate(`({
    vehicle: ${W}.handles('kip').kipMenu?.ctx?.loco?.vehicle,
    backLinkHidden: getComputedStyle(document.querySelector('.kip-bench .back-link')).display === 'none',
    loadingGone: !document.querySelector('.ws-loading'),
    truckMounted: ${W}.bench('truck') !== null,
    roots: document.querySelectorAll('.kip-bench, .truck-bench').length,
    canvases: document.querySelectorAll('#viewport canvas').length,
    canvasInKip: ${W}.stage().canvas.closest('.kip-bench') !== null,
  })`);
  check("forwarded ?vehicle=truck was applied by Kip itself", kip.vehicle === "truck", String(kip.vehicle));
  check("the bench hides its own back-to-app link inside the shell", kip.backLinkHidden);
  check("loading note is gone once the bench has loaded", kip.loadingGone);
  check("only the named bench is mounted (Truck is not)", kip.truckMounted === false && kip.roots === 1, JSON.stringify(kip));
  check("one WebGL canvas, drawn inside the Kip", kip.canvases === 1 && kip.canvasInKip, JSON.stringify(kip));
  check("the request log sees the Kip module load (control for the next checks)", a.requests.some((r) => /kip-bench\.js/.test(r.url)));
  check("the Truck module was never requested for a Kip deep link", !a.requests.some((r) => /truck-bench\.js/.test(r.url)), a.requests.filter((r) => /truck-bench/.test(r.url)).map((r) => r.url).join(","));

  const box = await a.evaluate(`(() => {
    const bar = document.querySelector('.ws-bar').getBoundingClientRect(), s = document.querySelector('.ws-stage').getBoundingClientRect();
    const root = document.querySelector('.kip-bench').getBoundingClientRect(), top = document.querySelector('.kip-bench .topbar').getBoundingClientRect();
    const cv = ${W}.stage().canvas.getBoundingClientRect();
    return { barBottom: bar.bottom, top: s.top, bottom: s.bottom, left: s.left, right: s.right, w: innerWidth, h: innerHeight,
      root: [root.top, root.bottom, root.left, root.right], topbarTop: top.top, canvas: [cv.top, cv.bottom, cv.left, cv.right],
      scrolls: document.documentElement.scrollHeight > innerHeight || document.documentElement.scrollWidth > innerWidth };
  })()`);
  check("the layout measurement returned numbers (a guard so the checks below cannot pass on an empty result)", typeof box?.top === "number" && typeof box?.scrolls === "boolean" && Array.isArray(box.root), JSON.stringify(box));
  check("the stage sits directly under the bar and fills the rest of the window", Math.abs(box.top - box.barBottom) <= 1 && Math.abs(box.bottom - box.h) <= 1 && box.left === 0 && box.right === box.w, JSON.stringify(box));
  check("the bench fills the stage and its canvas fills the bench", Math.abs(box.root[0] - box.top) <= 1 && Math.abs(box.root[1] - box.bottom) <= 1 && Math.abs(box.canvas[0] - box.top) <= 1 && Math.abs(box.canvas[1] - box.bottom) <= 1, JSON.stringify(box));
  check("the bench's fixed UI sits inside the stage, not over the tab bar", box.topbarTop >= box.barBottom, JSON.stringify(box));
  check("the shell page itself never scrolls", box.scrolls === false, JSON.stringify(box));
  await a.shot(path.join(SHOTS, "kip-bench.png"));

  // keyboard: arrows move focus between tabs, they do not load a bench
  const keys = await a.evaluate(`(() => {
    const kipTab = document.getElementById('ws-tab-kip'), truckTab = document.getElementById('ws-tab-truck');
    const press = (el, key) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    kipTab.focus(); press(kipTab, 'ArrowRight');
    const afterRight = document.activeElement.dataset.bench;
    const stillKip = ${selected}.join();
    const mountedAfter = document.querySelectorAll('.kip-bench, .truck-bench').length;
    press(document.activeElement, 'ArrowRight');
    const wrapped = document.activeElement.dataset.bench;
    press(document.activeElement, 'End'); const end = document.activeElement.dataset.bench;
    press(document.activeElement, 'Home'); const home = document.activeElement.dataset.bench;
    return { afterRight, stillKip, mountedAfter, wrapped, end, home, rove: [kipTab.tabIndex, truckTab.tabIndex] };
  })()`);
  check("ArrowRight moves focus to Truck without switching or loading it", keys.afterRight === "truck" && keys.stillKip === "kip" && keys.mountedAfter === 1, JSON.stringify(keys));
  check("arrows wrap, Home and End jump", keys.wrapped === "kip" && keys.end === "truck" && keys.home === "kip", JSON.stringify(keys));
  check("only the focused tab is in the tab order (roving tabindex)", JSON.stringify(keys.rove) === "[0,-1]", JSON.stringify(keys.rove));

  // pick Truck: the Kip stays mounted (hidden) and keeps its state; there is still one canvas
  await a.evaluate(`window.__kipRoot = ${W}.bench('kip').root; document.getElementById('ws-tab-truck').click()`);
  check("Truck finishes loading after the tab pick", await a.waitFor(TRUCK_READY, 240000), "never reached __TRUCK_READY__");
  await settle(500);
  const truck = await a.evaluate(`({
    kipKept: window.__kipRoot.isConnected && window.__kipRoot.hidden === true && ${W}.bench('kip').root === window.__kipRoot,
    roots: document.querySelectorAll('.kip-bench, .truck-bench').length,
    canvases: document.querySelectorAll('#viewport canvas').length,
    canvasInTruck: ${W}.stage().canvas.closest('.truck-bench') !== null,
    truckShown: document.querySelector('.truck-bench').hidden === false,
    kipVehicle: ${W}.handles('kip').kipMenu?.ctx?.loco?.vehicle,
    selected: ${selected}.join(),
    search: location.search,
    title: document.title,
    pop: document.querySelector('.ws-pop').getAttribute('href'),
    note: document.querySelector('.ws-note').textContent,
    active: ${W}.stage().activeId,
  })`);
  check("the Kip stays mounted (hidden) and keeps its state while the Truck is shown", truck.kipKept && truck.roots === 2 && truck.kipVehicle === "truck", JSON.stringify(truck));
  check("still one WebGL canvas, now inside the Truck, and the stage's active bench is the Truck", truck.canvases === 1 && truck.canvasInTruck && truck.truckShown && truck.active === "truck", JSON.stringify(truck));
  check("Truck tab is the selected one and the address bar says ?bench=truck (forwarded params dropped)", truck.selected === "truck" && truck.search === "?bench=truck", `${truck.selected} ${truck.search}`);
  check("title, note and 'open on its own page' follow the bench", truck.title === "Workshop · Truck" && /dump truck/i.test(truck.note) && truck.pop === "/kip/Truck-Mockup.html", `${truck.title} | ${truck.note} | ${truck.pop}`);
  await a.shot(path.join(SHOTS, "truck-bench.png"));

  // Canary: throw on purpose and require the exception hook to see it, so "no uncaught exception" below can fail.
  await a.evaluate("setTimeout(() => { throw new Error('ws-probe'); }, 0); 0");
  await settle(800);
  check("the exception hook sees errors thrown in the page (canary)", a.exceptions.some((e) => /ws-probe/.test(e)), a.exceptions.join(" || "));
  a.exceptions.splice(0, a.exceptions.length, ...a.exceptions.filter((e) => !/ws-probe/.test(e)));

  // Back returns to the deep-link entry; the Kip bench is still the same mounted bench (no reload), Forward returns to Truck
  await a.evaluate("history.back()");
  check("Back selects Kip again", await a.waitFor(`${selected}.join() === 'kip'`, 15000));
  await settle(300);
  const back = await a.evaluate(`({ same: ${W}.bench('kip').root === window.__kipRoot, search: location.search, roots: document.querySelectorAll('.kip-bench, .truck-bench').length, canvasInKip: ${W}.stage().canvas.closest('.kip-bench') !== null, vehicle: ${W}.handles('kip').kipMenu?.ctx?.loco?.vehicle })`);
  check("Back restores the deep-link entry on the same mounted Kip, state intact", back.same && back.search === "?bench=kip&vehicle=truck" && back.roots === 2 && back.canvasInKip && back.vehicle === "truck", JSON.stringify(back));
  await a.evaluate("history.forward()");
  check("Forward selects Truck again", await a.waitFor(`${selected}.join() === 'truck' && ${W}.stage().activeId === 'truck'`, 15000));
  // a plain tab pick back to Kip keeps its state too, and writes a clean address
  await a.evaluate("document.getElementById('ws-tab-kip').click()");
  await settle(600);
  const round = await a.evaluate(`({ search: location.search, same: ${W}.bench('kip').root === window.__kipRoot, vehicle: ${W}.handles('kip').kipMenu?.ctx?.loco?.vehicle, active: ${W}.stage().activeId })`);
  check("picking the Kip tab again keeps the Kip as it was and writes ?bench=kip", round.search === "?bench=kip" && round.same && round.vehicle === "truck" && round.active === "kip", JSON.stringify(round));
  check("no uncaught exception in the shell, Kip or Truck", a.exceptions.length === 0, a.exceptions.slice(0, 3).join(" || "));
  a.close();

  // ---- B. deep link to Truck mounts ONLY Truck; the Truck page's own link back to Kip is followed ----
  console.log("B. ?bench=truck&driver=snap&head=fox");
  const b = await chrome.open(`${server.base}/kip/Workshop.html?bench=truck&driver=snap&head=fox`);
  check("Truck deep link loads", await b.waitFor(TRUCK_READY, 240000), "never reached __TRUCK_READY__");
  const bt = await b.evaluate(`({ driver: document.getElementById('btn-driver')?.textContent, head: document.getElementById('btn-head')?.textContent, selected: ${selected}.join(), kipMounted: ${W}.bench('kip') !== null })`);
  check("Truck applied ?driver=snap&head=fox itself, and Truck is the selected tab", /snap/i.test(bt.driver ?? "") && /fox/i.test(bt.head ?? "") && bt.selected === "truck", JSON.stringify(bt));
  check("the request log sees the Truck module load (control for the next check)", b.requests.some((r) => /truck-bench\.js/.test(r.url)));
  check("the Kip module was never requested for a Truck deep link", !b.requests.some((r) => /kip-bench\.js/.test(r.url)) && bt.kipMounted === false, b.requests.filter((r) => /kip-bench/.test(r.url)).map((r) => r.url).join(","));
  await b.evaluate("window.__marker = 'same page'; 0");
  await b.evaluate("document.querySelector('a[href=\"./Kip-Demo.html\"]').click()");
  check("the bench's own link to Kip flips the tab bar to Kip", await b.waitFor(`${selected}.join() === 'kip'`, 60000));
  check("Kip mounts and loads from that link", await b.waitFor(KIP_READY, 240000), "never reached __KIP_READY__");
  const followed = await b.evaluate(`({ marker: window.__marker, search: location.search, title: document.title, pop: document.querySelector('.ws-pop').getAttribute('href'), roots: document.querySelectorAll('.kip-bench, .truck-bench').length, canvasInKip: ${W}.stage().canvas.closest('.kip-bench') !== null })`);
  check("without leaving the page, and the address bar, title and 'own page' link match", followed.marker === "same page" && followed.search === "?bench=kip" && followed.title === "Workshop · Kip" && /Kip-Demo\.html$/.test(followed.pop) && followed.roots === 2 && followed.canvasInKip, JSON.stringify(followed));
  check("no uncaught exception while the bench linked to the other", b.exceptions.length === 0, b.exceptions.slice(0, 3).join(" || "));
  b.close();

  // ---- C. unknown bench falls back to Kip and fixes the address ----
  console.log("C. ?bench=nope");
  const c = await chrome.open(`${server.base}/kip/Workshop.html?bench=nope`);
  check("an unknown bench shows Kip", await c.waitFor(`${selected}.join() === 'kip' && !!document.querySelector('.kip-bench')`, 60000));
  check("and the address bar is corrected to what is shown", await c.waitFor("location.search === '?bench=kip'", 5000), await c.evaluate("location.search"));
  c.close();

  // ---- D. phone width ----
  console.log("D. phone width 390x800");
  const d = await chrome.open(`${server.base}/kip/Workshop.html?bench=truck`, { width: 390, height: 800, mobile: true });
  check("Truck loads on a phone-sized window", await d.waitFor(TRUCK_READY, 240000), "never reached __TRUCK_READY__");
  await settle(300);
  const phone = await d.evaluate(`(() => {
    const kids = [...document.querySelector('.ws-bar').children].filter((el) => el.offsetParent !== null).map((el) => el.getBoundingClientRect());
    const s = document.querySelector('.ws-stage').getBoundingClientRect(), bar = document.querySelector('.ws-bar').getBoundingClientRect();
    return { overflowX: document.documentElement.scrollWidth > innerWidth, maxRight: Math.max(...kids.map((r) => r.right)), w: innerWidth,
      fills: Math.abs(s.top - bar.bottom) <= 1 && Math.abs(s.bottom - innerHeight) <= 1, noteShown: getComputedStyle(document.querySelector('.ws-note')).display !== 'none',
      tabH: Math.min(...[...document.querySelectorAll('.ws-tab')].map((t) => t.getBoundingClientRect().height)) };
  })()`);
  check("nothing in the bar runs past the phone's edge, and the page does not scroll sideways", !phone.overflowX && phone.maxRight <= phone.w + 1, JSON.stringify(phone));
  check("the stage still fills the window under the bar", phone.fills, JSON.stringify(phone));
  check("tabs are big enough to tap (34px or more)", phone.tabH >= 34, String(phone.tabH));
  await d.shot(path.join(SHOTS, "truck-bench-phone.png"));
  check("no uncaught exception on a phone-sized window", d.exceptions.length === 0, d.exceptions.slice(0, 3).join(" || "));
  d.close();
} catch (err) {
  check("e2e ran to the end", false, String(err?.stack ?? err));
} finally {
  chrome.close();
  server.close();
  console.log(`screenshots: ${SHOTS}`);
  finish();
}
