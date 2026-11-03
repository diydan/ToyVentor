#!/usr/bin/env node
// Shared stage (Workshop stage 4b, docs/specs/workshop-spec.md): both benches mounted in ONE page on ONE renderer, camera, controls
// and loop (bench-stage.js), switched with stage.activate(). Headless Chrome, the real bench modules (nothing mocked).
// Run: npm run e2e:bench-stage     Exits nonzero on any failing check.
//
// What it proves:
//   - one WebGL canvas for any number of mounted benches; only the active bench is visible and only its scene is drawn;
//   - each bench applies its own look (exposure, camera range, orbit limits) on activation and gets its camera pose back;
//   - a switched-away bench keeps its state (a menu opened, the hidden-UI toggle) and ignores the keyboard until it is active again;
//   - hosted draws exactly what standalone draws: pixel-identical screenshots of the scene (UI hidden) for a Kip state and a Truck state;
//   - the stage sizes the benches from its host box, not the window (the Kip menu's camera offset follows it);
//   - disposing the benches and the stage leaves no listener, canvas, root or running frame.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createChecks, launchChrome, startServer } from "./lib/kip-e2e.mjs";

const { check, finish } = createChecks("bench stage e2e");
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex").slice(0, 16);

const SHOTS = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), "bench-stage-shots");
// The Kip is compared with its UI hidden: the blurred hint pill's glyph anti-aliasing differs by compositing layer (the scene itself is identical).
const KIP_Q = "?screenshot=1&clean=1";
// The Truck is compared with its UI hidden too (ui=0): bar and card shadows differ by one level at their edges between layers.
const TRUCK_Q = "?stage=pro&steer=22&tip=10&demoT=1.9&hold=1&cam=hero&ui=0";

// Counts window/document/media-query listeners and animation frames from before any page script runs.
const INSTRUMENT = `(() => {
  const ids = new WeakMap(); let nid = 0;
  const idOf = (o) => { if (!ids.has(o)) ids.set(o, ++nid); return ids.get(o); };
  const tracked = (t) => t === window || t === document || (typeof MediaQueryList !== 'undefined' && t instanceof MediaQueryList);
  const entries = new Set();
  const sig = (t, type, fn, opts) => [t === window ? 'w' : t === document ? 'd' : 'm' + idOf(t), type, idOf(fn), typeof opts === 'boolean' ? opts : !!(opts && opts.capture)].join('|');
  const add = EventTarget.prototype.addEventListener, rem = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, opts) { if (tracked(this) && fn) entries.add(sig(this, type, fn, opts)); return add.call(this, type, fn, opts); };
  EventTarget.prototype.removeEventListener = function (type, fn, opts) { if (tracked(this) && fn) entries.delete(sig(this, type, fn, opts)); return rem.call(this, type, fn, opts); };
  const intervals = new Set(); const si = window.setInterval, ci = window.clearInterval;
  window.setInterval = function (...a) { const id = si.apply(window, a); intervals.add(id); return id; };
  window.clearInterval = function (id) { intervals.delete(id); return ci.call(window, id); };
  let rafCalls = 0; const raf = window.requestAnimationFrame;
  window.requestAnimationFrame = function (cb) { rafCalls++; return raf.call(window, cb); };
  window.__live = () => ({ listeners: [...entries].map((e) => e.split('|').slice(0, 2).join(':').replace(/^m\\d+:/, 'mql:')).sort(), intervals: intervals.size, rafCalls });
})();`;

// Wait until the stage has drawn `n` more frames (a loaded machine draws slowly: never wait a fixed time for a frame).
let t = null;
const framesDrawn = (n, from = 0) => t.waitFor(`window.__t.drawn.length >= ${from} + ${n}`, 120000);

const server = await startServer();
const chrome = await launchChrome();
try {
  // ---- reference screenshots: the same two states, standalone ----
  console.log("reference: standalone pages");
  const shotOf = async (url, ready) => {
    const t = await chrome.open(`${server.base}${url}`);
    await t.waitFor(ready, 240000);
    await settle(3000);
    const f = await t.shot(path.join(SHOTS, `${ready.includes("KIP") ? "kip" : "truck"}-standalone.png`));
    t.close();
    return sha(fs.readFileSync(f));
  };
  const refKip = await shotOf(`/kip/Kip-Demo.html${KIP_Q}`, "window.__KIP_READY__ === true");
  const refTruck = await shotOf(`/kip/Truck-Mockup.html${TRUCK_Q}`, "window.__TRUCK_READY__ === true");

  // ---- hosted ----
  console.log("hosted: both benches on one stage");
  t = await chrome.open("about:blank");
  await t.send("Page.addScriptToEvaluateOnNewDocument", { source: INSTRUMENT });
  await t.send("Page.navigate", { url: `${server.base}/kip/Kip-Demo.html` });
  check("the standalone page loads (to borrow its origin)", await t.waitFor("typeof window.kipBench?.dispose === 'function' && window.__KIP_READY__ === true", 240000));
  await t.evaluate("window.kipBench.dispose()");

  await t.evaluate(`(async () => {
    const { createStage } = await import('/kip/bench-stage.js');
    const { THREE, OrbitControls } = await import('/kip/vendor/three-kip.js');
    const { mountKipBench } = await import('/kip/kip-bench.js?v=10.0');
    const { mountTruckBench } = await import('/kip/truck-bench.js');
    const host = document.getElementById('app');
    const stage = createStage({ THREE, OrbitControls, host });
    const kipG = {}, truckG = {};
    const kip = mountKipBench(host, { stage, globals: kipG, getSearch: () => ${JSON.stringify(KIP_Q)}, getHash: () => '' });
    const truck = mountTruckBench(host, { stage, globals: truckG, getSearch: () => ${JSON.stringify(TRUCK_Q)} });
    stage.add('kip', kip).add('truck', truck);
    // record which scene each draw call uses (a bench draws only its own scene)
    const drawn = [];
    const render = stage.renderer.render.bind(stage.renderer);
    stage.renderer.render = (s, c) => { drawn.push(s.uuid); return render(s, c); };
    window.__t = { THREE, stage, kip, truck, kipG, truckG, host, drawn };
  })()`);
  const T = "window.__t";
  check("both benches report hosted", await t.evaluate(`${T}.kip.hosted === true && ${T}.truck.hosted === true`));
  check("hosted benches start hidden and the stage has no active bench", await t.evaluate(`${T}.kip.root.hidden && ${T}.truck.root.hidden && ${T}.stage.activeId === null`));
  check("both benches finish loading while hidden", await t.waitFor(`${T}.kipG.__KIP_READY__ === true && ${T}.truckG.__TRUCK_READY__ === true`, 240000));

  await t.evaluate(`${T}.stage.activate('kip'); ${T}.stage.start();`);
  await framesDrawn(8);
  const k1 = await t.evaluate(`({
    canvases: document.querySelectorAll('#viewport canvas').length,
    canvasIn: ${T}.stage.canvas.closest('.kip-bench') !== null,
    visible: [${T}.kip.root.hidden, ${T}.truck.root.hidden],
    active: ${T}.stage.activeId,
    exposure: ${T}.stage.renderer.toneMappingExposure, fov: ${T}.stage.camera.fov, near: ${T}.stage.camera.near, far: ${T}.stage.camera.far,
    minD: ${T}.stage.controls.minDistance, maxD: ${T}.stage.controls.maxDistance, maxPolar: ${T}.stage.controls.maxPolarAngle,
    scenes: [...new Set(${T}.drawn)].length,
    glContexts: ${T}.stage.renderer.info.programs?.length ?? -1,
  })`);
  check("one WebGL canvas for two mounted benches", k1.canvases === 1, String(k1.canvases));
  check("the canvas sits inside the active bench (Kip) and only the Kip root is visible", k1.canvasIn && JSON.stringify(k1.visible) === "[false,true]", JSON.stringify(k1));
  check("Kip look applied: exposure 0.92, fov 34, near 5, far 4000, orbit 85..1600 and polar limit", k1.exposure === 0.92 && k1.fov === 34 && k1.near === 5 && k1.far === 4000 && k1.minD === 85 && k1.maxD === 1600 && Math.abs(k1.maxPolar - Math.PI * 0.495) < 1e-9, JSON.stringify(k1));
  check("only one scene is drawn while Kip is active", k1.scenes === 1, String(k1.scenes));

  // hosted == standalone, pixel for pixel (Kip)
  const shot1 = await t.shot(path.join(SHOTS, "kip-hosted.png"));
  check("hosted Kip is pixel-identical to the standalone Kip page", sha(fs.readFileSync(shot1)) === refKip, "screenshots differ: see " + SHOTS);

  // Kip state to carry across a switch: the hide-UI toggle (H key), starting from hidden (clean=1), and a camera pose
  check("the Kip started with its UI hidden (clean=1)", await t.evaluate(`${T}.kip.root.classList.contains('clean-ui')`));
  await t.key("h");
  await settle(300);
  await t.evaluate(`(() => { const s = ${T}.stage; s.camera.position.set(111, 99, 222); s.controls.target.set(1, 2, 3); s.controls.update(); })()`);
  const kipPose = await t.evaluate(`(() => { const s = ${T}.stage; return [s.camera.position.x, s.camera.position.y, s.camera.position.z, s.controls.target.x, s.controls.target.y, s.controls.target.z]; })()`);
  check("H showed the Kip UI while Kip was active", await t.evaluate(`!${T}.kip.root.classList.contains('clean-ui')`));

  // ---- switch to the Truck ----
  const drawnBefore = await t.evaluate(`${T}.drawn.length`);
  await t.evaluate(`${T}.stage.activate('truck')`);
  await framesDrawn(8, drawnBefore);
  const t1 = await t.evaluate(`({
    canvases: document.querySelectorAll('#viewport canvas').length,
    canvasIn: ${T}.stage.canvas.closest('.truck-bench') !== null,
    visible: [${T}.kip.root.hidden, ${T}.truck.root.hidden],
    exposure: ${T}.stage.renderer.toneMappingExposure, fov: ${T}.stage.camera.fov, near: ${T}.stage.camera.near, far: ${T}.stage.camera.far,
    minD: ${T}.stage.controls.minDistance, maxDInf: ${T}.stage.controls.maxDistance === Infinity, maxPolar: ${T}.stage.controls.maxPolarAngle,
    pos: ${T}.stage.camera.position.toArray(), target: ${T}.stage.controls.target.toArray(),
    sceneRuns: (() => { const d = ${T}.drawn.slice(${drawnBefore}); const runs = d.filter((u, i) => i === 0 || u !== d[i - 1]); return runs.length; })(),
    viewOffset: ${T}.stage.camera.view,
  })`);
  check("still one canvas, now inside the Truck; only the Truck root is visible", t1.canvases === 1 && t1.canvasIn && JSON.stringify(t1.visible) === "[true,false]", JSON.stringify(t1));
  check("Truck look applied: exposure 1.04, fov 36, near 1, far 2000, orbit limits reset", t1.exposure === 1.04 && t1.fov === 36 && t1.near === 1 && t1.far === 2000 && t1.minD === 0 && t1.maxDInf === true && t1.maxPolar === Math.PI, JSON.stringify(t1));
  check("after the switch only the Truck's scene is drawn (no Kip frame, no alternating)", t1.sceneRuns === 1, String(t1.sceneRuns));
  check("the Kip's menu camera offset is cleared on the shared camera when Kip stands down", t1.viewOffset === null || t1.viewOffset?.enabled === false, JSON.stringify(t1.viewOffset));

  // hosted == standalone (Truck)
  const shot2 = await t.shot(path.join(SHOTS, "truck-hosted.png"));
  check("hosted Truck is pixel-identical to the standalone Truck page", sha(fs.readFileSync(shot2)) === refTruck, "screenshots differ: see " + SHOTS);

  // input isolation: the Kip's H key must not reach a Kip that is not active
  await t.key("h");
  await settle(200);
  check("H pressed while the Truck is active does not toggle the hidden Kip bench", await t.evaluate(`${T}.kip.root.classList.contains('clean-ui')`) === false);

  // Truck state: open its phone menu, then Escape only counts while the Truck is active
  await t.evaluate(`${T}.truck.root.classList.add('truck-menu-open')`);
  await t.key("Escape");
  await settle(200);
  check("Escape closes the Truck menu while the Truck is active", await t.evaluate(`!${T}.truck.root.classList.contains('truck-menu-open')`));
  await t.evaluate(`${T}.truck.root.classList.add('truck-menu-open')`);
  await t.evaluate(`(() => { const s = ${T}.stage; s.camera.position.set(-50, 60, 90); s.controls.target.set(0, 10, 0); s.controls.update(); })()`);
  const truckPose = await t.evaluate(`(() => { const s = ${T}.stage; return [s.camera.position.x, s.camera.position.y, s.camera.position.z, s.controls.target.x, s.controls.target.y, s.controls.target.z]; })()`);

  // ---- back to the Kip: state and pose restored ----
  await t.evaluate(`${T}.stage.activate('kip')`);
  await settle(1500);
  const k2 = await t.evaluate(`(() => { const s = ${T}.stage; return { pose: [s.camera.position.x, s.camera.position.y, s.camera.position.z, s.controls.target.x, s.controls.target.y, s.controls.target.z], shown: !${T}.kip.root.classList.contains('clean-ui'), canvasIn: s.canvas.closest('.kip-bench') !== null, fov: s.camera.fov, truckMenu: ${T}.truck.root.classList.contains('truck-menu-open') }; })()`);
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
  check("the Kip gets its own camera pose back after the Truck", near(k2.pose, kipPose), JSON.stringify([k2.pose, kipPose]));
  check("the Kip kept its state (UI shown) while switched away", k2.shown === true && k2.canvasIn && k2.fov === 34);
  await t.key("Escape");
  await settle(200);
  check("Escape does not reach the Truck while the Kip is active", await t.evaluate(`${T}.truck.root.classList.contains('truck-menu-open')`) === true);
  await t.evaluate(`${T}.stage.activate('truck')`);
  await settle(1200);
  const t2 = await t.evaluate(`(() => { const s = ${T}.stage; return { pose: [s.camera.position.x, s.camera.position.y, s.camera.position.z, s.controls.target.x, s.controls.target.y, s.controls.target.z], menu: ${T}.truck.root.classList.contains('truck-menu-open') }; })()`);
  check("the Truck gets its own camera pose back after the Kip", near(t2.pose, truckPose), JSON.stringify([t2.pose, truckPose]));
  check("the Truck kept its state (menu open) while switched away", t2.menu === true);

  // ---- size comes from the host box ----
  await t.evaluate(`${T}.stage.activate('kip'); ${T}.host.style.height = '600px'; ${T}.host.style.width = '1000px';`);
  // the stage resizes on a ResizeObserver tick and the Kip menu applies its camera offset on a 100 ms timer: wait for both, not for a fixed time
  await t.waitFor(`${T}.stage.canvas.clientWidth === 1000 && ${T}.stage.canvas.clientHeight === 600`, 60000);
  await t.waitFor(`(() => { const v = ${T}.stage.camera.view; return !!v && v.enabled && v.fullWidth === 1000 && v.fullHeight === 600; })()`, 60000);
  const sz = await t.evaluate(`(() => { const s = ${T}.stage; const c = s.canvas; const v = s.camera.view; return { w: c.clientWidth, h: c.clientHeight, aspect: s.camera.aspect, viewFull: v && v.enabled ? [v.fullWidth, v.fullHeight] : null }; })()`);
  check("the canvas follows the host box (1000 x 600), not the window", sz.w === 1000 && sz.h === 600, JSON.stringify(sz));
  check("the camera aspect follows the host box", Math.abs(sz.aspect - 1000 / 600) < 1e-9, String(sz.aspect));
  check("the Kip menu's camera offset is computed for the host box, not the window", sz.viewFull !== null && sz.viewFull[0] === 1000 && sz.viewFull[1] === 600, JSON.stringify(sz.viewFull));

  // ---- dispose ----
  const raf0 = await t.evaluate("window.__live().rafCalls");
  await t.evaluate(`(() => { ${T}.stage.stop(); ${T}.kip.dispose(); ${T}.truck.dispose(); ${T}.stage.dispose(); })()`);
  await settle(700);
  const gone = await t.evaluate(`({ live: window.__live(), canvases: document.querySelectorAll('canvas').length, roots: document.querySelectorAll('.kip-bench, .truck-bench').length, styles: document.querySelectorAll('#kip-bench-css, #truck-bench-css').length })`);
  check("disposing both benches and the stage leaves no canvas, bench root or stylesheet", gone.canvases === 0 && gone.roots === 0 && gone.styles === 0, JSON.stringify(gone));
  check("... no window/document/media-query listener", gone.live.listeners.length === 0, JSON.stringify(gone.live.listeners));
  check("... no interval and no animation frame requested", gone.live.intervals === 0 && gone.live.rafCalls <= raf0 + 1, JSON.stringify({ i: gone.live.intervals, raf0, now: gone.live.rafCalls }));
  check("dispose is safe to call twice", await t.evaluate(`(() => { try { ${T}.kip.dispose(); ${T}.truck.dispose(); ${T}.stage.dispose(); return true; } catch (e) { return String(e); } })()`) === true);
  check("no uncaught exception", t.exceptions.length === 0, t.exceptions.join(" | ").slice(0, 500));
  t.close();
} finally {
  chrome.close();
  server.close?.();
}
finish();
process.exit(process.exitCode ?? 0);
