#!/usr/bin/env node
// Workshop shell: headless-Chrome checks (stage 1 of docs/specs/workshop-spec.md).
// Run: npm run e2e:workshop     Exits nonzero on any failing check.
// Env: E2E_CHROME (binary), E2E_SHOTS (screenshot dir), E2E_STRICT_STL=1 (fail on missing STLs instead of stubbing).
//
// What it proves, with the REAL Kip and Truck pages inside the shell (nothing mocked):
//   - the shell is a proper tab bar (roles, one selected tab, arrow keys move focus without loading a bench);
//   - a deep link loads only the bench it names, forwards the other params to it, and the bench actually uses them;
//   - picking a tab swaps the bench (the old frame is removed, not hidden), writes ?bench= and works with Back/Forward;
//   - a bench that navigates itself (the Truck page's "Kip Viewer" link) keeps the tab bar and address bar honest;
//   - the frame fills the window under the bar, on a desktop and on a phone width, with no page scroll;
//   - neither bench throws while embedded.
import os from "node:os";
import path from "node:path";
import { createChecks, launchChrome, startServer } from "./lib/kip-e2e.mjs";

const SHOTS = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), "workshop-shots");
const { check, finish } = createChecks("workshop e2e");

const FRAME = "document.querySelector('.ws-frame')";
const KIP_READY = `${FRAME}?.contentWindow?.__KIP_READY__ === true`;
const TRUCK_READY = `${FRAME}?.contentWindow?.__TRUCK_READY__ === true`;
const selected = `[...document.querySelectorAll('.ws-tab')].filter((t) => t.getAttribute('aria-selected') === 'true').map((t) => t.dataset.bench)`;
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

const server = await startServer();
const chrome = await launchChrome();
try {
  // ---- A. deep link to Kip with a forwarded param; then tab, Back, Forward ----
  console.log("A. ?bench=kip&vehicle=truck");
  const a = await chrome.open(`${server.base}/kip/Workshop.html?bench=kip&vehicle=truck`);
  check("shell mounts a frame", await a.waitFor(`!!${FRAME}`, 30000));
  const shell = await a.evaluate(`({
    tabs: [...document.querySelectorAll('[role=tablist] [role=tab]')].map((t) => t.dataset.bench),
    selected: ${selected},
    panels: document.querySelectorAll('[role=tabpanel]').length,
    frames: document.querySelectorAll('.ws-frame').length,
    frameTitle: ${FRAME}.title,
    allow: ${FRAME}.getAttribute('allow'),
    src: ${FRAME}.getAttribute('src'),
    title: document.title,
    labelled: document.querySelector('[role=tabpanel]').getAttribute('aria-labelledby'),
  })`);
  check("tab bar lists Kip then Truck", JSON.stringify(shell.tabs) === '["kip","truck"]', JSON.stringify(shell.tabs));
  check("exactly one tab is selected: Kip", JSON.stringify(shell.selected) === '["kip"]', JSON.stringify(shell.selected));
  check("one tabpanel, labelled by the selected tab", shell.panels === 1 && shell.labelled === "ws-tab-kip", shell.labelled);
  check("one frame, titled for screen readers", shell.frames === 1 && shell.frameTitle === "Kip bench", shell.frameTitle);
  check("frame may use the camera (selfie) and fullscreen", /camera/.test(shell.allow) && /fullscreen/.test(shell.allow), shell.allow);
  check("forwarded param reaches the bench URL", shell.src === "/kip/Kip-Demo.html?vehicle=truck", shell.src);
  check("document title names the bench", shell.title === "Workshop · Kip", shell.title);

  check("Kip finishes loading inside the frame", await a.waitFor(KIP_READY, 240000), "never reached __KIP_READY__");
  const kip = await a.evaluate(`({
    inIframe: ${FRAME}.contentDocument.body.classList.contains('in-iframe'),
    vehicle: ${FRAME}.contentWindow.kipMenu?.ctx?.loco?.vehicle,
    loadingGone: !document.querySelector('.ws-loading'),
    focused: document.activeElement === ${FRAME},
  })`);
  check("Kip knows it is embedded (its own in-iframe mode)", kip.inIframe === true);
  check("forwarded ?vehicle=truck was applied by Kip itself", kip.vehicle === "truck", String(kip.vehicle));
  check("loading note is gone once the bench has loaded", kip.loadingGone);
  check("the frame takes keyboard focus so Kip's single-key shortcuts work", kip.focused);

  const box = await a.evaluate(`(() => {
    const bar = document.querySelector('.ws-bar').getBoundingClientRect(), f = ${FRAME}.getBoundingClientRect();
    return { barBottom: bar.bottom, top: f.top, bottom: f.bottom, left: f.left, right: f.right, w: innerWidth, h: innerHeight,
      scrolls: document.documentElement.scrollHeight > innerHeight || document.documentElement.scrollWidth > innerWidth };
  })()`);
  check("the layout measurement returned numbers (a guard so the next two checks cannot pass on an empty result)", typeof box?.top === "number" && typeof box?.scrolls === "boolean", JSON.stringify(box));
  check("frame sits directly under the bar and fills the rest of the window", Math.abs(box.top - box.barBottom) <= 1 && Math.abs(box.bottom - box.h) <= 1 && box.left === 0 && box.right === box.w, JSON.stringify(box));
  check("the shell page itself never scrolls", box.scrolls === false, JSON.stringify(box));
  await a.shot(path.join(SHOTS, "kip-bench.png"));

  // keyboard: arrows move focus between tabs, they do not load a bench
  const keys = await a.evaluate(`(() => {
    const kipTab = document.getElementById('ws-tab-kip'), truckTab = document.getElementById('ws-tab-truck');
    const press = (el, key) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    kipTab.focus(); press(kipTab, 'ArrowRight');
    const afterRight = document.activeElement.dataset.bench;
    const stillKip = ${selected}.join();
    const framesAfter = document.querySelectorAll('.ws-frame').length;
    press(document.activeElement, 'ArrowRight');
    const wrapped = document.activeElement.dataset.bench;
    press(document.activeElement, 'End'); const end = document.activeElement.dataset.bench;
    press(document.activeElement, 'Home'); const home = document.activeElement.dataset.bench;
    return { afterRight, stillKip, framesAfter, wrapped, end, home, rove: [kipTab.tabIndex, truckTab.tabIndex] };
  })()`);
  check("ArrowRight moves focus to Truck without switching", keys.afterRight === "truck" && keys.stillKip === "kip" && keys.framesAfter === 1, JSON.stringify(keys));
  check("arrows wrap, Home and End jump", keys.wrapped === "kip" && keys.end === "truck" && keys.home === "kip", JSON.stringify(keys));
  check("only the focused tab is in the tab order (roving tabindex)", JSON.stringify(keys.rove) === "[0,-1]", JSON.stringify(keys.rove));

  // pick Truck: the Kip frame must be REMOVED
  await a.evaluate(`window.__oldFrame = ${FRAME}; document.getElementById('ws-tab-truck').click()`);
  check("Truck finishes loading after the tab pick", await a.waitFor(TRUCK_READY, 240000), "never reached __TRUCK_READY__");
  const truck = await a.evaluate(`({
    oldGone: window.__oldFrame.isConnected === false,
    frames: document.querySelectorAll('.ws-frame').length,
    selected: ${selected}.join(),
    search: location.search,
    title: document.title,
    canvas: !!${FRAME}.contentDocument.querySelector('canvas'),
    pop: document.querySelector('.ws-pop').getAttribute('href'),
    note: document.querySelector('.ws-note').textContent,
  })`);
  check("the Kip frame is removed (its WebGL context is released), not hidden", truck.oldGone && truck.frames === 1, JSON.stringify(truck));
  check("Truck tab is the selected one and the address bar says ?bench=truck (forwarded params dropped)", truck.selected === "truck" && truck.search === "?bench=truck", `${truck.selected} ${truck.search}`);
  check("title, note and 'open on its own page' follow the bench", truck.title === "Workshop · Truck" && /dump truck/i.test(truck.note) && truck.pop === "/kip/Truck-Mockup.html", `${truck.title} | ${truck.note} | ${truck.pop}`);
  check("Truck drew a canvas", truck.canvas);
  await a.shot(path.join(SHOTS, "truck-bench.png"));

  // Canary: throw inside the bench frame on purpose and require the exception hook to see it, so "no uncaught exception" below can fail.
  await a.evaluate(`${FRAME}.contentWindow.setTimeout(() => { throw new Error('ws-probe-frame'); }, 0); 0`);
  await settle(800);
  check("the exception hook sees errors thrown inside a bench frame (canary)", a.exceptions.some((e) => /ws-probe-frame/.test(e)), a.exceptions.join(" || "));
  a.exceptions.splice(0, a.exceptions.length, ...a.exceptions.filter((e) => !/ws-probe-frame/.test(e)));

  // Back returns to the deep-link entry (so its forwarded param comes back), Forward returns to Truck
  await a.evaluate("history.back()");
  check("Back selects Kip again", await a.waitFor(`${selected}.join() === 'kip'`, 15000));
  const back = await a.evaluate(`({ src: ${FRAME}.getAttribute('src'), frames: document.querySelectorAll('.ws-frame').length, search: location.search })`);
  check("Back restores the deep-link entry, forwarded param included, with one frame", back.src === "/kip/Kip-Demo.html?vehicle=truck" && back.frames === 1 && back.search === "?bench=kip&vehicle=truck", JSON.stringify(back));
  await a.evaluate("history.forward()");
  check("Forward selects Truck again", await a.waitFor(`${selected}.join() === 'truck' && ${FRAME}.getAttribute('src') === '/kip/Truck-Mockup.html'`, 15000));
  check("no uncaught exception in the shell, Kip or Truck while embedded", a.exceptions.length === 0, a.exceptions.slice(0, 3).join(" || "));
  a.close();

  // ---- B. deep link to Truck loads ONLY Truck; the Truck page's own link back to Kip is followed ----
  console.log("B. ?bench=truck&driver=snap&head=fox");
  const b = await chrome.open(`${server.base}/kip/Workshop.html?bench=truck&driver=snap&head=fox`);
  check("Truck deep link loads", await b.waitFor(TRUCK_READY, 240000), "never reached __TRUCK_READY__");
  const bsrc = await b.evaluate(`({ search: ${FRAME}.contentWindow.location.search, selected: ${selected}.join() })`);
  check("Truck got ?driver=snap&head=fox, and Truck is the selected tab", bsrc.search === "?driver=snap&head=fox" && bsrc.selected === "truck", JSON.stringify(bsrc));
  check("the request log sees the bench frame's own page load (control for the next check)", b.requests.some((r) => /Truck-Mockup\.html/.test(r.url)));
  check("the Kip page was never requested for a Truck deep link", !b.requests.some((r) => /Kip-Demo\.html/.test(r.url)), b.requests.filter((r) => /Kip-Demo/.test(r.url)).map((r) => r.url).join(","));
  await b.evaluate(`${FRAME}.contentDocument.querySelector('a[href="./Kip-Demo.html"]').click()`);
  check("the bench's own link to Kip flips the tab bar to Kip", await b.waitFor(`${selected}.join() === 'kip'`, 60000));
  const followed = await b.evaluate(`({ search: location.search, title: document.title, pop: document.querySelector('.ws-pop').getAttribute('href'), frames: document.querySelectorAll('.ws-frame').length })`);
  check("and rewrites the address bar, title and 'own page' link to match", followed.search === "?bench=kip" && followed.title === "Workshop · Kip" && /Kip-Demo\.html$/.test(followed.pop) && followed.frames === 1, JSON.stringify(followed));
  check("no uncaught exception while the bench navigated itself", b.exceptions.length === 0, b.exceptions.slice(0, 3).join(" || "));
  b.close();

  // ---- C. unknown bench falls back to Kip and fixes the address ----
  console.log("C. ?bench=nope");
  const c = await chrome.open(`${server.base}/kip/Workshop.html?bench=nope`);
  check("an unknown bench shows Kip", await c.waitFor(`${selected}.join() === 'kip' && !!${FRAME}`, 30000));
  check("and the address bar is corrected to what is shown", await c.waitFor("location.search === '?bench=kip'", 5000), await c.evaluate("location.search"));
  c.close();

  // ---- D. phone width ----
  console.log("D. phone width 390x800");
  const d = await chrome.open(`${server.base}/kip/Workshop.html?bench=truck`, { width: 390, height: 800, mobile: true });
  check("Truck loads on a phone-sized window", await d.waitFor(TRUCK_READY, 240000), "never reached __TRUCK_READY__");
  await settle(300);
  const phone = await d.evaluate(`(() => {
    const kids = [...document.querySelector('.ws-bar').children].filter((el) => el.offsetParent !== null).map((el) => el.getBoundingClientRect());
    const f = ${FRAME}.getBoundingClientRect(), bar = document.querySelector('.ws-bar').getBoundingClientRect();
    return { overflowX: document.documentElement.scrollWidth > innerWidth, maxRight: Math.max(...kids.map((r) => r.right)), w: innerWidth,
      fills: Math.abs(f.top - bar.bottom) <= 1 && Math.abs(f.bottom - innerHeight) <= 1, noteShown: getComputedStyle(document.querySelector('.ws-note')).display !== 'none',
      tabH: Math.min(...[...document.querySelectorAll('.ws-tab')].map((t) => t.getBoundingClientRect().height)) };
  })()`);
  check("nothing in the bar runs past the phone's edge, and the page does not scroll sideways", !phone.overflowX && phone.maxRight <= phone.w + 1, JSON.stringify(phone));
  check("the frame still fills the window under the bar", phone.fills, JSON.stringify(phone));
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
