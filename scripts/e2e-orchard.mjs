#!/usr/bin/env node
// 390x844 headless-Chrome E2E for the ORCHARD (docs/specs/playful-interactions-spec.md section 3): the Garden's trees are not all apple trees. Each lane tree has its own kind (apple, pear,
// orange, cherry), its own fruit hanging on it, and the fruit says its own name and can be dragged to Kip and eaten. The Beach has a coconut palm and a banana palm, the Garden a strawberry bush. Real mouse events; /api/voice is intercepted (no spend).
// Needs a real GPU: --headless=new with the Metal backend. Run: node scripts/e2e-orchard.mjs     Overrides: E2E_CHROME, E2E_PORT, E2E_DEBUG_PORT, E2E_PROFILE, E2E_SHOTS (screenshot directory).
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
const CHROME = process.env.E2E_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEV_PORT = Number(process.env.E2E_PORT ?? 5199);
const DEBUG_PORT = Number(process.env.E2E_DEBUG_PORT ?? 9349);
const PROFILE = process.env.E2E_PROFILE ?? "/tmp/toyforge-e2e-orchard-profile";
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


const LANE = "p.holder.position.x >= 3 && p.holder.position.x <= 41";
const world = (cdp, expr) => cdp.ev(`(() => { const w = window.__tvWorld; if (!w) return null; return ${expr}; })()`);
/** Where a world point is on screen, in client pixels. */
const screenOf = (cdp, pointExpr) => cdp.ev(`(() => { const cam = window.__tvDebug.camera; const v = (${pointExpr}).project(cam); const r = document.querySelector("canvas").getBoundingClientRect(); return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height, on: Math.abs(v.x) < 1 && Math.abs(v.y) < 1 }; })()`);
const V3 = "new window.__tvDebug.camera.position.constructor";
const toyAt = (cdp) => screenOf(cdp, `${V3}(window.__tvWorld.P.pos.x, 1.1, window.__tvWorld.P.pos.z)`);
const hangingApple = (cdp) => screenOf(cdp, `(() => { const i = window.__tvWorld.props.list().find((p) => p.type === "tree" && ${LANE}); const s = i.slots.find((sl) => sl.mesh); if (!s) throw new Error("no hanging apple"); return s.mesh.getWorldPosition(${V3}()); })()`);
const carriedApple = (cdp) => screenOf(cdp, `(() => { const f = window.__tvWorld.props.fallers.find((x) => x.state === 3); if (!f) throw new Error("nothing carried"); return f.mesh.position.clone(); })()`);
const hangingCount = (cdp) => world(cdp, `w.props.list().find((p) => p.type === "tree" && ${LANE}).slots.filter((s) => s.mesh).length`);
const regrowAll = (cdp) => world(cdp, `(() => { for (const s of w.props.list().find((p) => p.type === "tree" && ${LANE}).slots) if (!s.mesh) s.regrowAt = 0.001; return true; })()`);
const action = (cdp) => world(cdp, `w.getMix() ? w.getMix().busyAction : "no-mix"`);
const fallerStates = (cdp) => world(cdp, `JSON.stringify(w.props.fallers.map((f) => f.state))`);
const shot = async (cdp, name) => { if (!SHOTS) return; mkdirSync(SHOTS, { recursive: true }); const r = await cdp.send("Page.captureScreenshot", { format: "png" }); writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(r.data, "base64")); };
const mouse = (cdp, type, x, y) => cdp.send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: type === "mouseMoved" ? 0 : 1 });
/** Press at a, drag in steps to b, and (optionally) release. Returns after the last move. */
async function dragTo(cdp, a, b, { release = true, steps = 8, onMid } = {}) {
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: a.x, y: a.y });
  await mouse(cdp, "mousePressed", a.x, a.y);
  for (let i = 1; i <= steps; i++) {
    await mouse(cdp, "mouseMoved", a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps);
    await sleep(40);
    if (i === Math.ceil(steps / 2) && onMid) await onMid();
  }
  if (release) await mouse(cdp, "mouseReleased", b.x, b.y);
}

const dismissAny = (cdp) => cdp.ev(`(() => { if (!document.querySelector(".building")) return false; const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Later"); if (b) b.click(); return Boolean(b); })()`);

const treeList = (cdp) => world(cdp, `JSON.stringify(w.props.list().filter((p) => p.type === "tree" && ${LANE}).sort((a, b) => a.holder.position.x - b.holder.position.x).map((p) => ({ x: p.holder.position.x, kind: p.holder.userData.treeKind, fruit: p.fruit, slots: p.slots.length, hung: p.slots.filter((s) => s.mesh).map((s) => s.mesh.userData.fruitKind) })))`).then((s) => JSON.parse(s));
// The LOWEST hanging fruit of the tree at x (the top of the screen has buttons over it), in client pixels.
const fruitOn = (cdp, x) => cdp.ev(`(() => { const cam = window.__tvDebug.camera; const i = window.__tvWorld.props.list().find((p) => p.type === "tree" && Math.abs(p.holder.position.x - ${x}) < 0.01); const r = document.querySelector("canvas").getBoundingClientRect(); let best = null; for (const s of i.slots) { if (!s.mesh) continue; const v = s.mesh.getWorldPosition(${V3}()).project(cam); const p = { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height, on: Math.abs(v.x) < 1 && Math.abs(v.y) < 1 }; if (!best || p.y > best.y) best = p; } return best || { x: 0, y: 0, on: false }; })()`);
const hangingAt = (cdp, x) => world(cdp, `w.props.list().find((p) => p.type === "tree" && Math.abs(p.holder.position.x - ${x}) < 0.01).slots.filter((s) => s.mesh).length`);
const plants = (cdp, type, minX = 3) => world(cdp, `JSON.stringify(w.props.list().filter((p) => p.type === ${JSON.stringify(type)} && p.holder.position.x >= ${minX}).sort((a, b) => a.holder.position.x - b.holder.position.x).map((p) => ({ x: p.holder.position.x, kind: p.holder.userData.treeKind, fruit: p.fruit, slots: p.slots.length, hung: p.slots.filter((s) => s.mesh).map((s) => s.mesh.userData.fruitKind) })))`).then((s) => JSON.parse(s));
const lowestFruit = (cdp, type, x) => cdp.ev(`(() => { const cam = window.__tvDebug.camera; const i = window.__tvWorld.props.list().find((p) => p.type === ${JSON.stringify(type)} && Math.abs(p.holder.position.x - ${x}) < 0.01); const r = document.querySelector("canvas").getBoundingClientRect(); let best = null; for (const s of i.slots) { if (!s.mesh) continue; const v = s.mesh.getWorldPosition(${V3}()).project(cam); const p = { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height, on: Math.abs(v.x) < 1 && Math.abs(v.y) < 1 }; if (!best || p.y > best.y) best = p; } return best || { x: 0, y: 0, on: false }; })()`);
const hangingOf = (cdp, type, x) => world(cdp, `w.props.list().find((p) => p.type === ${JSON.stringify(type)} && Math.abs(p.holder.position.x - ${x}) < 0.01).slots.filter((s) => s.mesh).length`);
/** Walk Kip to a plant, tap its lowest fruit and check what it says; then leave it. */
async function visit(cdp, type, t, said, label, dx = 3.2) {
  await cdp.ev(`(() => { const w = window.__tvWorld; w.P.pos.x = ${t.x} - ${dx}; w.P.pos.z = 0; w.P.target = null; })()`);
  const on = await waitFor(async () => { await dismissAny(cdp); const f = await lowestFruit(cdp, type, t.x); return f.on && f.x > 30 && f.x < 360 && f.y > 170 && f.y < 760 ? f : null; }, { timeoutMs: 15000, label: `${label} fruit on screen` }).catch(() => null);
  check(`${label}: its fruit is on screen`, Boolean(on), JSON.stringify({ on, fruit: await lowestFruit(cdp, type, t.x), toy: await toyAt(cdp), plant: t }));
  await sleep(700);
  await shot(cdp, `plant-${label.replace(/ /g, "-")}`);
  if (!on) return;
  await clearToast(cdp);
  const f = await lowestFruit(cdp, type, t.x);
  await mouse(cdp, "mousePressed", f.x, f.y);
  await mouse(cdp, "mouseReleased", f.x, f.y);
  await sleep(450);
  check(`${label}: tapping its fruit says '${said}'`, (await toastText(cdp)) === said, String(await toastText(cdp)));
  check(`${label}: and one fruit came off (one fewer hanging)`, (await hangingOf(cdp, type, t.x)) === t.slots - 1, String(await hangingOf(cdp, type, t.x)));
}
const SAYS = { apple: "Red apple", pear: "Green pear", orange: "Orange", cherry: "Red cherries" };

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
    const trees = await treeList(cdp);
    check("garden: the lane has four trees of four different kinds", trees.length === 4 && new Set(trees.map((t) => t.kind)).size === 4, JSON.stringify(trees));
    check("garden: the first tree a child meets is the apple tree they know", trees[0]?.kind === "apple" && trees[0]?.fruit === "apple", JSON.stringify(trees[0]));
    check("garden: the kinds are apple, pear, orange, cherry in order along the lane", JSON.stringify(trees.map((t) => t.kind)) === JSON.stringify(["apple", "pear", "orange", "cherry"]), JSON.stringify(trees.map((t) => t.kind)));
    check("garden: every tree has three fruit hanging, all ITS fruit", trees.every((t) => t.slots === 3 && t.hung.length === 3 && t.hung.every((h) => h === t.fruit)), JSON.stringify(trees.map((t) => [t.kind, t.hung])));
    const offLane = await world(cdp, `w.props.list().filter((p) => p.type === "tree" && p.holder.position.x < 3).map((p) => p.holder.userData.treeKind).join(",")`);
    check("garden: the tree left of the lane is the plain apple tree and took no turn in the orchard", offLane === "apple", String(offLane));

    await waitFor(() => world(cdp, `!!(w.getMix() && w.getMix().canDrive(w.P.rig))`), { timeoutMs: 30000, label: "the character clips" });
    for (const t of trees) {
      await cdp.ev(`(() => { const w = window.__tvWorld; w.P.pos.x = ${t.x} - 3.2; w.P.pos.z = 0; w.P.target = null; })()`);
      const on = await waitFor(async () => { await dismissAny(cdp); const f = await fruitOn(cdp, t.x); return f.on && f.x > 30 && f.x < 360 && f.y > 170 && f.y < 760 ? f : null; }, { timeoutMs: 15000, label: `${t.kind} fruit on screen` }).catch(() => null);
      check(`${t.kind}: its fruit is on screen`, Boolean(on), JSON.stringify(on));
      await sleep(700);
      await shot(cdp, `tree-${t.kind}`);
      if (!on) continue;
      await clearToast(cdp); cdp.voiceUrls.length = 0;
      const f = await fruitOn(cdp, t.x);
      await mouse(cdp, "mousePressed", f.x, f.y);
      await mouse(cdp, "mouseReleased", f.x, f.y);
      await sleep(450);
      check(`${t.kind}: tapping its fruit says '${SAYS[t.kind]}'`, (await toastText(cdp)) === SAYS[t.kind], String(await toastText(cdp)));
      check(`${t.kind}: and one fruit came off (two left hanging)`, (await hangingAt(cdp, t.x)) === 2);
    }

    // Feed Kip a pear straight off the pear tree.
    const pear = trees.find((t) => t.kind === "pear");
    await cdp.ev(`(() => { const w = window.__tvWorld; w.P.pos.x = ${pear.x} - 3.2; w.P.pos.z = 0; w.P.target = null; })()`);
    await sleep(1800);
    await waitFor(async () => { const f = await fruitOn(cdp, pear.x); return f.on && f.x > 30 && f.x < 360 && f.y > 170 ? f : null; }, { timeoutMs: 15000, label: "pear on screen" });
    const pf = await fruitOn(cdp, pear.x);
    const kip = await toyAt(cdp);
    // Tapped fruit regrows 8 to 12 s later, which can land in the middle of this check: hold the regrowth off while we count.
    await world(cdp, `(() => { for (const p of w.props.list()) for (const s of p.slots) if (!s.mesh) s.regrowAt = 1e9; return true; })()`);
    const before = await hangingAt(cdp, pear.x);
    const fallersBefore = await world(cdp, `w.props.fallers.length`);
    const loose = () => world(cdp, `JSON.stringify(w.props.fallers.map((f) => f.kind + ":" + f.state + "@" + f.mesh.position.x.toFixed(1)))`);
    const looseBefore = await loose();
    const pearTreeHang = () => world(cdp, `JSON.stringify(w.props.list().filter((p) => p.type === "tree" && Math.abs(p.holder.position.x - ${pear.x}) < 0.01)[0].slots.map((s) => s.mesh ? s.mesh.userData.fruitKind : "-"))`);
    const hangBefore = await pearTreeHang();
    await dragTo(cdp, pf, kip, { release: true, steps: 8 });
    const ate = await waitFor(async () => ((await action(cdp)) === "eat" ? true : null), { timeoutMs: 1500, everyMs: 30, label: "eat" }).catch(() => false);
    check("pear: dragged onto Kip, it is eaten (the eat clip plays)", ate === true, String(await action(cdp)));
    await sleep(1200);
    check("pear: and the pear is gone from the tree and from the ground", (await hangingAt(cdp, pear.x)) === before - 1 && (await world(cdp, `w.props.fallers.length`)) <= fallersBefore, `hanging ${await hangingAt(cdp, pear.x)} (was ${before}), loose ${await world(cdp, `w.props.fallers.length`)} (was ${fallersBefore}); pear slots ${hangBefore} -> ${await pearTreeHang()}; loose ${looseBefore} -> ${await loose()}; press at ${JSON.stringify(pf)} kip ${JSON.stringify(kip)}`);
    await shot(cdp, "pear-eaten");

    // ---- the Garden's bushes: a strawberry bush near the start and a blueberry bush past the bridge ----
    const bushes = await plants(cdp, "bushes");
    check("bushes: the Garden has a strawberry bush and a blueberry bush, four fruit hanging on each", JSON.stringify(bushes.map((b) => b.kind)) === JSON.stringify(["strawberry", "blueberry"]) && bushes.every((b) => b.slots === 4 && b.hung.length === 4 && b.hung.every((h) => h === b.fruit)), JSON.stringify(bushes));
    if (bushes[0]) await visit(cdp, "bushes", bushes[0], "Red strawberry", "strawberry bush", 2.0);

    // ---- the Beach: a coconut palm and a banana palm ----
    await cdp.ev(`window.__tvWorld.handle.go("beach")`);
    await sleep(3500);
    await dismissAny(cdp);
    const palms = await plants(cdp, "palm");
    check("beach: the lane has a coconut palm and a banana palm, in that order", JSON.stringify(palms.map((p) => p.kind)) === JSON.stringify(["coconut", "banana"]), JSON.stringify(palms));
    check("beach: two coconuts hang on the coconut palm and three bananas on the banana palm", palms[0]?.hung.length === 2 && palms[0].hung.every((h) => h === "coconut") && palms[1]?.hung.length === 3 && palms[1].hung.every((h) => h === "banana"), JSON.stringify(palms));
    const offLanePalm = await world(cdp, `w.props.list().filter((p) => p.type === "palm" && p.holder.position.x < 3).map((p) => p.holder.userData.treeKind).join(",")`);
    check("beach: the palm left of the lane is the plain coconut palm and took no turn", offLanePalm === "coconut", String(offLanePalm));
    await waitFor(() => world(cdp, `!!(w.getMix() && w.getMix().canDrive(w.P.rig))`), { timeoutMs: 30000, label: "the character clips (beach)" });
    if (palms[0]) await visit(cdp, "palm", palms[0], "Brown coconut", "coconut palm", 2.6);
    if (palms[1]) {
      await visit(cdp, "palm", palms[1], "Yellow banana", "banana palm", 2.6);
      // feed Kip a banana straight off the palm
      await cdp.ev(`(() => { const w = window.__tvWorld; w.P.pos.x = ${palms[1].x} - 2.6; w.P.pos.z = 0; w.P.target = null; })()`);
      await sleep(1800);
      await world(cdp, `(() => { for (const p of w.props.list()) for (const s of p.slots) if (!s.mesh) s.regrowAt = 1e9; return true; })()`);
      const bf = await waitFor(async () => { const f = await lowestFruit(cdp, "palm", palms[1].x); return f.on && f.x > 30 && f.x < 360 && f.y > 170 ? f : null; }, { timeoutMs: 15000, label: "banana on screen" });
      const kip2 = await toyAt(cdp);
      const hb = await hangingOf(cdp, "palm", palms[1].x);
      await dragTo(cdp, bf, kip2, { release: true, steps: 8 });
      const ate2 = await waitFor(async () => ((await action(cdp)) === "eat" ? true : null), { timeoutMs: 1500, everyMs: 30, label: "eat" }).catch(() => false);
      check("banana: dragged onto Kip, it is eaten (the eat clip plays)", ate2 === true, String(await action(cdp)));
      await sleep(1000);
      check("banana: and it is gone from the palm", (await hangingOf(cdp, "palm", palms[1].x)) === hb - 1, `${await hangingOf(cdp, "palm", palms[1].x)} (was ${hb})`);
      await shot(cdp, "banana-eaten");
    }

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
