#!/usr/bin/env node
// Real-game E2E for the Garden's parallax backdrop (runtime/backdrop.ts, docs/specs/parallax-backdrops-spec.md), in portrait (a phone) and landscape.
// Boots the real app on its own vite port and reads the real scene through the dev handles. The geometry checks are computed IN THE PAGE from the live camera
// with plain trigonometry, independently of backdrop.ts. /api/voice is intercepted (no spend).
// Needs a real GPU: --headless=new with the Metal backend. Run: node scripts/e2e-backdrop.mjs
// Overrides: E2E_CHROME, E2E_PORT, E2E_DEBUG_PORT, E2E_PROFILE, E2E_SHOTS (screenshot folder). Exits nonzero on any failing check.
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const CHROME = process.env.E2E_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEV_PORT = Number(process.env.E2E_PORT ?? 5197);
const DEBUG_PORT = Number(process.env.E2E_DEBUG_PORT ?? 9347);
const PROFILE = process.env.E2E_PROFILE ?? "/tmp/toyforge-e2e-backdrop-profile";
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
  constructor(url) { this.url = url; this.id = 1; this.pending = new Map(); this.exceptions = []; this.voiceUrls = []; this.block = null; this.blocked = []; }
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
          if (this.block && this.block.some((re) => re.test(request.url))) {
            this.blocked.push(request.url);
            this.send("Fetch.failRequest", { requestId, errorReason: "Failed" }).catch(() => {});
          } else if (request.url.includes("/api/voice")) {
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

const SHOTS = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), "toyforge-backdrop-shots");
mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, pass, detail = "") => results.push({ name, pass: Boolean(pass), detail });
const VIEWS = { portrait: { w: 390, h: 844, dsf: 2, mobile: true }, landscape: { w: 1280, h: 720, dsf: 1, mobile: false } };
const APP_URL = `http://localhost:${DEV_PORT}/`;

const evA = async (cdp, expr) => {
  const r = await cdp.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r?.exceptionDetails) throw new Error("evaluate threw: " + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r?.result?.value;
};
const shot = async (cdp, name) => {
  const r = await cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(r.data, "base64"));
  return r.data;
};

// The scene's facts, computed IN THE PAGE from the live camera with plain trigonometry (not by backdrop.ts): where the ground line is on each plane's depth,
// the span the window covers there, the screen's top ray, and what the planes actually are.
const PROBE = `(() => {
  const dbg = window.__tvDebug, s = dbg.scene, cam = dbg.camera, g = s.getObjectByName("backdrop");
  const hills = []; s.traverse((o) => { if (o.isMesh && o.geometry.type === "SphereGeometry" && o.position.z < -15) hills.push(o.visible); });
  const out = { backdrop: Boolean(g), hillsTotal: hills.length, hillsVisible: hills.filter(Boolean).length, textures: dbg.renderer.info.memory.textures, geometries: dbg.renderer.info.memory.geometries,
    camera: { x: cam.position.x, y: cam.position.y, z: cam.position.z, aspect: cam.aspect } };
  if (!g) return JSON.stringify(out);
  cam.updateMatrixWorld();
  const V = cam.position.constructor;
  out.layers = g.children.map((m) => {
    const z = m.position.z, camY = cam.position.y, camZ = cam.position.z;
    const ground = camY * (1 - (camZ - z) / (camZ + 10));
    let xMin = 1e9, xMax = -1e9;
    for (const [nx, ny] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) { const d = new V(nx, ny, 0.5).unproject(cam).sub(cam.position), t = (z - camZ) / d.z, x = cam.position.x + t * d.x; xMin = Math.min(xMin, x); xMax = Math.max(xMax, x); }
    const dt = new V(0, 1, 0.5).unproject(cam).sub(cam.position), top = camY + ((z - camZ) / dt.z) * dt.y;
    const map = m.material.map, img = map.image;
    return { id: m.userData.backdrop, visible: m.visible, z, base: m.position.y - m.scale.y / 2, ground, planeTop: m.position.y + m.scale.y / 2, top, left: m.position.x - m.scale.x / 2, right: m.position.x + m.scale.x / 2,
      xMin, xMax, artAspect: (m.scale.x / map.repeat.x) / m.scale.y, imgAspect: img.width / img.height, imgW: img.width, imgH: img.height, ndcX: m.position.clone().project(cam).x };
  });
  out.laneNdcX = new V(22, 1, 0).project(cam).x;
  return JSON.stringify(out);
})()`;
const probe = async (cdp) => JSON.parse(await cdp.ev(PROBE));

/** Mean per-pixel difference, and the share of pixels that differ by more than 30, over the band of the picture where the backdrop shows. */
const bandDiff = async (cdp, a, b) => JSON.parse(await evA(cdp, `(async () => {
  const load = (d) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = "data:image/png;base64," + d; });
  const [A, B] = await Promise.all([load(${JSON.stringify(a)}), load(${JSON.stringify(b)})]);
  const w = A.width, h = A.height, x0 = Math.floor(w * 0.05), x1 = Math.floor(w * 0.95), y0 = Math.floor(h * 0.12), y1 = Math.floor(h * 0.36);
  const grab = (img) => { const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0); return g.getImageData(x0, y0, x1 - x0, y1 - y0).data; };
  const da = grab(A), db = grab(B); let sum = 0, big = 0; const n = da.length / 4;
  for (let i = 0; i < da.length; i += 4) { const d = (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2])) / 3; sum += d; if (d > 30) big++; }
  return JSON.stringify({ mean: sum / n, share: big / n });
})()`));

async function loadApp(cdp) {
  await cdp.send("Page.navigate", { url: APP_URL });
  await waitFor(() => cdp.ev(`!!document.querySelector("canvas") && !!(window.__tvWorld && window.__tvWorld.props) && !!window.__tvDebug`), { label: "stage + dev handles" });
  await sleep(2000);
  await cdp.ev(`(() => { const t = document.querySelector("#title"); if (t && !t.hidden) document.querySelector("#play")?.click(); })()`);
  await sleep(1500);
}
const dismissSheet = (cdp) => cdp.ev(`(() => { if (!document.querySelector(".building")) return false; const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Later"); if (b) b.click(); return Boolean(b); })()`);
async function moveTo(cdp, x) {
  await cdp.ev(`(() => { const w = window.__tvWorld; w.P.pos.x = ${x}; w.P.target = null; })()`);
  await sleep(2400);
  if (await dismissSheet(cdp)) {   // a mission sheet opened at this spot and locked the camera: close it and go again
    await sleep(600);
    await cdp.ev(`(() => { const w = window.__tvWorld; w.P.pos.x = ${x}; w.P.target = null; })()`);
    await sleep(2400);
  }
  await cdp.ev(`(() => { const t = document.querySelector("#toast"); if (t) t.classList.remove("on"); })()`);
  await sleep(250);
}
const waitBackdrop = (cdp, want = true) => waitFor(async () => { const p = await probe(cdp); return p.backdrop === want && (!want || p.layers.every((l) => l.visible)) ? p : null; }, { timeoutMs: 20000, label: `backdrop ${want}` });

/** The geometry rules, over one probe. Returns a list of what is wrong (empty = all good). */
function geometryProblems(p) {
  const bad = [];
  if (p.layers.length !== 2) bad.push(`${p.layers.length} layers`);
  for (const l of p.layers) {
    if (!l.visible) bad.push(`${l.id} hidden`);
    if (Math.abs(l.base - (l.ground - 0.12)) > 0.03) bad.push(`${l.id} base ${l.base.toFixed(3)} vs ground-tuck ${(l.ground - 0.12).toFixed(3)}`);
    if (Math.abs(l.artAspect - l.imgAspect) > 0.01 * l.imgAspect) bad.push(`${l.id} stretched ${l.artAspect.toFixed(3)} vs ${l.imgAspect.toFixed(3)}`);
    if (l.left > l.xMin + 1e-3 || l.right < l.xMax - 1e-3) bad.push(`${l.id} does not span the window [${l.left.toFixed(1)},${l.right.toFixed(1)}] vs [${l.xMin.toFixed(1)},${l.xMax.toFixed(1)}]`);
    if (l.id === "far" && l.planeTop < l.top - 1e-3) bad.push(`far stops below the screen top (${l.planeTop.toFixed(2)} < ${l.top.toFixed(2)})`);
  }
  return bad;
}

let counts = [];
/** World switching, measured identically for both series: Toy Room, back to the Garden, settle, count the GPU textures. */
const cycles = async (cdp, n) => { const out = []; for (let i = 0; i < n; i++) { await cdp.ev(`window.__tvWorld.handle.go("room")`); await sleep(1500); await cdp.ev(`window.__tvWorld.handle.go("garden")`); await sleep(1500); out.push((await probe(cdp)).textures); } return out; };

async function main() {
  rmSync(PROFILE, { recursive: true, force: true });
  const dev = spawn("npx", ["vite", "--port", String(DEV_PORT), "--strictPort"], { cwd: ROOT, stdio: "ignore" });
  const chrome = spawn(CHROME, ["--headless=new", "--use-angle=metal", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required",
    `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${PROFILE}`, "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
  const killAll = () => { try { chrome.kill(); } catch {} try { dev.kill(); } catch {} };
  process.on("SIGINT", () => { killAll(); process.exit(130); });
  try {
    await waitFor(async () => (await fetch(APP_URL)).ok || null, { label: APP_URL });
    await waitFor(async () => (await fetch(`http://localhost:${DEBUG_PORT}/json/version`)).ok || null, { label: "chrome" });
    await fetch(`http://localhost:${DEBUG_PORT}/json/new?about:blank`, { method: "PUT" });
    const targets = await waitFor(async () => { const l = (await (await fetch(`http://localhost:${DEBUG_PORT}/json/list`)).json()).filter((t) => t.url === "about:blank"); return l.length ? l : null; }, { label: "new tab" });
    const cdp = new Cdp(targets[0].webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send("Runtime.enable"); await cdp.send("Page.enable");
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/voice*" }, { urlPattern: "*garden-*" }] });

    for (const [vname, v] of Object.entries(VIEWS)) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: v.w, height: v.h, deviceScaleFactor: v.dsf, mobile: v.mobile });
      await loadApp(cdp);
      const p0 = await waitBackdrop(cdp).catch((e) => { check(`${vname}: the Garden gets its backdrop`, false, String(e.message)); return null; });
      if (!p0) continue;
      if (vname === "portrait") { counts = await cycles(cdp, 4); await waitBackdrop(cdp); }   // the "with" series: a fresh load, like the "without" series at the end
      check(`${vname}: the Garden gets its backdrop (far and mid, both laid out)`, p0.layers.map((l) => l.id).join() === "far,mid" && p0.layers.every((l) => l.visible));
      check(`${vname}: the old sphere hills (and the orb) are hidden once the images are in`, p0.hillsTotal >= 7 && p0.hillsVisible === 0, `${p0.hillsVisible}/${p0.hillsTotal} visible`);
      check(`${vname}: textures are inside the budget (far at most 4096 wide, mid at most 2048)`, p0.layers[0].imgW <= 4096 && p0.layers[0].imgW >= 2048 && p0.layers[1].imgW <= 2048 && p0.layers[1].imgW >= 1024, p0.layers.map((l) => `${l.id} ${l.imgW}x${l.imgH}`).join(", "));

      // ---- every pose: three places along the lane, three zoom levels (the camera runs from about 10 to 46 units back) ----
      const problems = [], poses = [];
      for (const zoom of [0, 1, 2]) {
        await cdp.ev(`window.__tvWorld.handle.setZoom(${zoom})`);
        for (const x of [6, 22, 38]) {
          await moveTo(cdp, x);
          const p = await waitBackdrop(cdp);
          poses.push(`z${zoom}/x${x}`);
          for (const b of geometryProblems(p)) problems.push(`zoom ${zoom} x ${x}: ${b}`);
          if (zoom === 0 && x === 22) await shot(cdp, `${vname}-garden-x22`);
          if (zoom === 2 && x === 22) await shot(cdp, `${vname}-garden-zoomed-out`);
          if (zoom === 0 && x === 38) await shot(cdp, `${vname}-garden-x38`);
          if (zoom === 0 && x === 6) await shot(cdp, `${vname}-garden-x6`);
        }
      }
      await cdp.ev(`window.__tvWorld.handle.setZoom(0)`);
      check(`${vname}: at all ${poses.length} poses each layer's base is on the ground line, the art is never stretched, the plane spans the window, and the far band reaches the screen top`, problems.length === 0, problems.slice(0, 4).join(" | "));

      // ---- parallax: the far layer moves least on screen, then the mid layer, then the lane ----
      await moveTo(cdp, 8); const a = await waitBackdrop(cdp);
      await moveTo(cdp, 34); const b = await waitBackdrop(cdp);
      const dFar = Math.abs(b.layers[0].ndcX - a.layers[0].ndcX), dMid = Math.abs(b.layers[1].ndcX - a.layers[1].ndcX), dLane = Math.abs(b.laneNdcX - a.laneNdcX);
      const camMoved = Math.abs(b.camera.x - a.camera.x);
      check(`${vname}: parallax: the camera really moved (${camMoved.toFixed(1)} units), and on screen the far layer moves least, then the mid layer, then the lane (${dFar.toFixed(3)} < ${dMid.toFixed(3)} < ${dLane.toFixed(3)})`, camMoved > 15 && dFar > 0.02 && dFar < dMid && dMid < dLane && dFar < 0.5 * dMid, JSON.stringify({ camMoved, dFar, dMid, dLane }));

      // ---- it is really in the picture: the band above the horizon changes a lot when the planes are hidden ----
      await moveTo(cdp, 22);
      const withPlanes = await shot(cdp, `${vname}-with-backdrop`);
      await cdp.ev(`window.__tvDebug.scene.getObjectByName("backdrop").visible = false`); await sleep(500);
      const without = await shot(cdp, `${vname}-without-backdrop`);
      await cdp.ev(`window.__tvDebug.scene.getObjectByName("backdrop").visible = true`); await sleep(300);
      const diff = await bandDiff(cdp, withPlanes, without);
      check(`${vname}: the planes really draw into the frame (the band above the horizon differs from the sky alone: mean ${diff.mean.toFixed(1)}, ${(diff.share * 100).toFixed(0)}% of pixels)`, diff.mean > 6 && diff.share > 0.25, JSON.stringify(diff));

      // ---- the title / character showcase camera has a view offset: the layers must still sit on the ground line ----
      await cdp.ev(`window.__tvWorld.P.showcase = true`); await sleep(1800);
      const sc = await probe(cdp);
      check(`${vname}: in the showcase view (asymmetric view offset) the layers still sit on the ground line and span the window`, geometryProblems(sc).length === 0, geometryProblems(sc).join(" | "));
      await shot(cdp, `${vname}-showcase`);
      await cdp.ev(`(() => { window.__tvWorld.P.showcase = false; window.__tvDebug.camera.clearViewOffset(); })()`); await sleep(800);
    }

    // ---- the Toy Room keeps its own look: no backdrop; switching worlds does not leak ----
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    await cdp.ev(`window.__tvWorld.handle.go("room")`); await sleep(3000);
    const room = await probe(cdp);
    check("Toy Room: no backdrop (it is a flat wall plus 3D props by design), and nothing of the Garden's hills is left behind", room.backdrop === false && room.hillsTotal === 0, JSON.stringify({ backdrop: room.backdrop, hills: room.hillsTotal }));
    await shot(cdp, "toyroom");
    // ---- no leak: the "with" series ran on the first fresh load (above); the "without" series below is the same procedure on a fresh load with the images blocked ----
    // ---- no pop: with the art already loaded, a world rebuild must not show ONE frame of the old hills or of no backdrop ----
    await cdp.ev(`(() => { window.__bd = { frames: [], run: true }; const loop = () => { const dbg = window.__tvDebug, s = dbg.scene, g = s.getObjectByName("backdrop"); let hills = 0;
      s.traverse((o) => { if (o.isMesh && o.geometry.type === "SphereGeometry" && o.position.z < -15 && o.visible) hills++; });
      window.__bd.frames.push({ hills, backdrop: !!g && g.children.length === 2 && g.children.every((m) => m.visible) }); if (window.__bd.run) requestAnimationFrame(loop); }; requestAnimationFrame(loop); })()`);
    await cdp.ev(`window.__tvWorld.handle.go("room")`); await sleep(1200);
    await cdp.ev(`window.__bd.frames.length = 0`);
    await cdp.ev(`window.__tvWorld.handle.go("garden")`); await sleep(1800);
    const rec = JSON.parse(await cdp.ev(`(() => { window.__bd.run = false; return JSON.stringify(window.__bd.frames); })()`));
    const oldHillFrames = rec.filter((f) => f.hills > 0).length, bareFrames = rec.filter((f) => !f.backdrop).length;
    check(`rebuild without a pop: across ${rec.length} frames of a Garden rebuild, ${oldHillFrames} showed the old hills and ${bareFrames} had no backdrop`, rec.length > 20 && oldHillFrames === 0 && bareFrames === 0, JSON.stringify({ frames: rec.length, oldHillFrames, bareFrames }));
    const withBackdropGrowth = (counts[counts.length - 1] - counts[0]) / (counts.length - 1);
    console.log(`  info: GPU textures after each Garden rebuild, with the backdrop: ${counts.join(", ")} (${withBackdropGrowth}/cycle)`);

    // ---- fallback: the images fail to load -> exactly the old hills, no errors, the game still plays ----
    cdp.block = [/garden-(far|mid)[^?]*\.webp$/];   // the image request itself, not the "?url" module (in dev that is JavaScript, and blocking it would stop the app booting)
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    const errsBefore = cdp.exceptions.length;
    await loadApp(cdp);
    await sleep(3000);
    const fb = await probe(cdp);
    check("fallback: with the images blocked there is no backdrop and the old hills are all still showing", fb.backdrop === false && fb.hillsTotal >= 7 && fb.hillsVisible === fb.hillsTotal, JSON.stringify({ backdrop: fb.backdrop, hills: `${fb.hillsVisible}/${fb.hillsTotal}` }));
    check("fallback: the requests really were blocked (so the check above is about the failure path)", cdp.blocked.length >= 2, `${cdp.blocked.length} blocked`);
    // The same switching with no backdrop at all: whatever the world itself leaks per rebuild is not the backdrop's. The backdrop must add nothing to it.
    const bare = await cycles(cdp, 4);
    const bareGrowth = (bare[bare.length - 1] - bare[0]) / (bare.length - 1);
    console.log(`  info: GPU textures after each Garden rebuild, WITHOUT the backdrop: ${bare.join(", ")} (${bareGrowth}/cycle)`);
    check(`switching worlds: the backdrop adds nothing to the world's own per-rebuild texture growth (with ${withBackdropGrowth}/cycle, without ${bareGrowth}/cycle)`, withBackdropGrowth <= bareGrowth + 0.5, `${counts.join(",")} vs ${bare.join(",")}`);
    check("fallback: no uncaught exception, and the toy still walks", cdp.exceptions.length === errsBefore && (await (async () => { await moveTo(cdp, 30); return (await probe(cdp)).camera.x > 20; })()), cdp.exceptions.slice(errsBefore).join(" | "));
    await shot(cdp, "fallback-old-hills");
    cdp.block = null;

    check("no uncaught exception anywhere", cdp.exceptions.length === 0, cdp.exceptions.slice(0, 3).join(" | "));
    console.log(`  screenshots: ${SHOTS}`);
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
