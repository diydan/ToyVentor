#!/usr/bin/env node
// 390x844 headless-Chrome E2E for the two ACTIVITY LEVELS (docs/specs/play-design-spec.md, "Activity levels"; Dan, 2026-11-04: "build the cleaning level and the cooking level"):
//   CLEANING  Toy Room cart or Map rung `daily.clean` -> a mess lands ("Oh no, oh no!"), Kip asks "Clean?", the child picks the tool that fits and rubs the mess clean with a finger ("All clean! Hooray!")
//   COOKING   Toy Room hob or Map rung `daily.cook`   -> crack the egg, count the batter into the pan, a grown-up holds "it's hot", flick the pan to flip, serve one pancake to each plate
// Real mouse events on the real game (dragging along the mess with the age band set in progression:v1); /api/voice is intercepted (no spend) and its requests are recorded, so what Kip SAYS is checked by the
// clip id it asks for. Also: the Map door pays the rung, prefers-reduced-motion, sound off (the words are still on screen), a world change putting everything right. Needs a real GPU: --headless=new with the
// Metal backend. Run: E2E_PORT=5303 E2E_DEBUG_PORT=9403 E2E_PROFILE=/tmp/e2e-cleancook-fork node scripts/e2e-game-clean-cook.mjs   Overrides: E2E_CHROME, E2E_SHOTS (screenshot directory), E2E_ONLY=clean|cook.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
const CHROME = process.env.E2E_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEV_PORT = Number(process.env.E2E_PORT ?? 5303);
const DEBUG_PORT = Number(process.env.E2E_DEBUG_PORT ?? 9403);
const PROFILE = process.env.E2E_PROFILE ?? "/tmp/e2e-cleancook-fork";
const SHOTS = process.env.E2E_SHOTS ?? "";
const APP = `http://localhost:${DEV_PORT}/?title=0`; // ?title=0: straight into the world, not the main menu (src/features/game/world/titleEntries.ts)

const PROMPTS = JSON.parse(readFileSync(new URL("../src/lib/scenePrompts.json", import.meta.url), "utf8")).prompts;
const idOf = (text) => PROMPTS.find((p) => p.text === text)?.id;
const OH_NO = "Oh no, oh no!", CLEAN_Q = "Clean?", ALL_CLEAN = "All clean! Hooray!";
const WRONG = { "mop>crumbs": "Mopping crumbs just makes mush. Dry crumbs need the vacuum.", "vacuum>puddle": "Vacuums are for dry things. A puddle is a liquid, so use the mop.", "mop>jam": "The mop just smears sticky jam. Try the soapy sponge." };
const SOAP_FIRST = "Mix the soapy water first.", SOAP_LOW = "Not enough soap: the water would slide off the jam.", SOAP_HIGH = "Too much soap makes slippery suds. Pour it out and try again.";
const voiceFor = (text) => `/api/voice?s=${idOf(text)}`;

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
  constructor(url) { this.url = url; this.id = 1; this.pending = new Map(); this.exceptions = []; this.voiceUrls = []; this.voicesEver = new Set(); }
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
            this.voiceUrls.push(new URL(request.url).pathname + new URL(request.url).search); this.voicesEver.add(new URL(request.url).pathname + new URL(request.url).search);
            this.send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "content-type", value: "audio/wav" }], body: silentWavB64() }).catch(() => {});
          } else {
            this.send("Fetch.continueRequest", { requestId }).catch(() => {});
          }
        }
      });
    });
  }
  send(method, params = {}) { const id = this.id++; return new Promise((res, rej) => { const t = setTimeout(() => { this.pending.delete(id); rej(new Error(`CDP ${method} timed out`)); }, 60000); this.pending.set(id, { res: (v) => { clearTimeout(t); res(v); }, rej: (e) => { clearTimeout(t); rej(e); } }); this.ws.send(JSON.stringify({ id, method, params })); }); }
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


const results = [];
const check = (name, pass, detail = "") => { results.push({ name, pass: Boolean(pass), detail }); console.log(`${pass ? "pass" : "FAIL"}  ${name}${pass ? "" : `  [${String(detail).slice(0, 300)}]`}`); };
const toastText = (cdp) => cdp.ev(`(() => { const t = document.querySelector("#toast"); return t && t.classList.contains("on") ? t.textContent : null; })()`);
const clearToast = (cdp) => cdp.ev(`(() => { const t = document.querySelector("#toast"); if (t) t.classList.remove("on"); })()`);
const world = (cdp, expr) => cdp.ev(`(() => { const w = window.__tvWorld; if (!w) return null; return ${expr}; })()`);
const shot = async (cdp, name) => { if (!SHOTS) return; mkdirSync(SHOTS, { recursive: true }); const r = await cdp.send("Page.captureScreenshot", { format: "png" }); writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(r.data, "base64")); };
const dismissSheet = (cdp) => cdp.ev(`(() => { if (!document.querySelector(".building")) return false; const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Later"); if (b) b.click(); return Boolean(b); })()`);
const prop = (cdp, type) => world(cdp, `(() => { const i = w.props.list().find((p) => p.type === ${JSON.stringify(type)}); return i ? { x: i.base.px, z: i.base.pz, h: i.size.y } : null; })()`);
const propScreen = (cdp, type) => world(cdp, `(() => { const i = w.props.list().find((p) => p.type === ${JSON.stringify(type)}); return i ? w.props.screenPos(i, 0.5) : null; })()`);
const toy = (cdp) => world(cdp, `({ x: w.P.pos.x, z: w.P.pos.z, busy: w.P.busy, action: w.getMix() ? w.getMix().busyAction : null })`);
const held = (cdp) => world(cdp, `w.held.item`);
/** The activity levels' snapshot: [clean, cook]. */
const snap = async (cdp, id = "clean") => (await world(cdp, `w.act.snapshot()`))?.find((s) => s.id === id);
const card = (cdp) => cdp.ev(`(() => { const c = document.querySelector('[data-testid="activity-prompt"]'); if (!c) return null; const cs = getComputedStyle(c); const bs = [...c.querySelectorAll("button")].map((b) => { const r = b.getBoundingClientRect(); return { id: b.getAttribute("data-testid").replace("activity-prompt-", ""), text: b.textContent.trim(), label: b.getAttribute("aria-label"), x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, pressed: b.getAttribute("aria-pressed") }; }); return { hidden: c.hidden || cs.display === "none", line: c.querySelector('[data-testid="activity-prompt-line"]').textContent, label: c.getAttribute("aria-label"), role: c.getAttribute("role"), buttons: bs }; })()`);
const btn = async (cdp, id) => (await card(cdp))?.buttons.find((b) => b.id === id) ?? null;
const pressBtn = async (cdp, id) => { const b = await btn(cdp, id); if (!b) throw new Error(`no button ${id}`); await cdp.tapAt(b.x, b.y); await sleep(120); };
/** Project world points (x, y, z) to client pixels, page side. */
const projectMany = (cdp, pts) => cdp.ev(`(() => { const cam = window.__tvDebug.camera; const V = cam.position.constructor; const r = document.querySelector("canvas").getBoundingClientRect(); return ${JSON.stringify(pts)}.map((p) => { const v = new V(p[0], p[1], p[2]).project(cam); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; }); })()`);
const voices = (cdp) => [...new Set(cdp.voiceUrls)];
/** Was this line EVER asked of the voice in this run? (A line the game has heard once is kept, so a repeat asks for nothing.) */
const heard = (cdp, text) => cdp.voicesEver.has(voiceFor(text));
const noCard = async (cdp) => { const c = await card(cdp); return c === null || c.hidden; };
/** Collect the toasts seen for `ms`. */
async function toastsFor(cdp, ms) { const out = new Set(); await sample(cdp, ms, async () => { const t = await toastText(cdp); if (t) out.add(t); return 0; }, 40); return [...out]; }
/** Wait until the activity has finished walking in (the toy is free again). */
const freeToy = (cdp) => waitFor(async () => !(await world(cdp, `w.acts.busy`)), { timeoutMs: 15000, label: "the toy free" });
/** Poll fast for `ms`, collecting what a sampler sees. */
async function sample(cdp, ms, fn, every = 40) { const out = []; const end = Date.now() + ms; while (Date.now() < end) { out.push(await fn()); await sleep(every); } return out; }
async function tapProp(cdp, type) { const p = await propScreen(cdp, type); await cdp.tapAt(p.x, p.y); return p; }
/** Put Kip `dx` units left of a prop, wait for it to be on screen and return where. */
async function stage(cdp, type, dx = 1.9) {
  const p = await prop(cdp, type);
  await cdp.ev(`(() => { const w = window.__tvWorld; w.P.pos.x = ${p.x} - ${dx}; w.P.pos.z = 0; w.P.target = null; w.P.hop = 0; })()`);
  const on = await waitFor(async () => { await dismissSheet(cdp); const s = await propScreen(cdp, type); return s && s.visible && s.x > 30 && s.x < 360 && s.y > 120 && s.y < 760 ? s : null; }, { timeoutMs: 15000, label: `${type} on screen` });
  let last = on, still = 0;
  for (let i = 0; i < 60 && still < 4; i++) { await sleep(100); const now = await propScreen(cdp, type); still = now && Math.hypot(now.x - last.x, now.y - last.y) < 1.5 ? still + 1 : 0; last = now || last; }
  return last;
}
const setBand = (cdp, band) => cdp.ev(`(() => { try { const k = "toyforge:progression:v1"; const p = JSON.parse(localStorage.getItem(k) || "{}"); p.ageBand = ${band}; localStorage.setItem(k, JSON.stringify(p)); return true; } catch (e) { return String(e); } })()`);
const stars = (cdp, id) => cdp.ev(`(() => { try { const p = JSON.parse(localStorage.getItem("toyforge:progression:v1") || "{}"); const ms = p.missionStars || {}; return Object.keys(ms).filter((k) => k.startsWith(${JSON.stringify(id)} + ":")).reduce((a, k) => a + ms[k], 0); } catch (e) { return -1; } })()`);

/** Real mouse events: press at the first point, move through the rest (a few ms apart), release at the last. */
async function drag(cdp, pts, gap = 14) {
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pts[0].x, y: pts[0].y });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: pts[0].x, y: pts[0].y, button: "left", clickCount: 1 });
  for (const p of pts.slice(1)) { await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y, buttons: 1 }); await sleep(gap); }
  const l = pts.at(-1);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: l.x, y: l.y, button: "left", clickCount: 1 });
}
/** A serpentine over one mess (by its snapshot), in world units, then to the screen. */
async function scrubPath(cdp, m) {
  const step = 0.25, pad = m.brush * 0.5, lane = Math.max(0.2, m.brush * 0.9);
  const hw = m.width / 2 + pad, hd = m.depth / 2 + pad;
  const lanes = Math.max(1, Math.ceil((2 * hd) / lane)), world = [];
  for (let l = 0; l <= lanes; l++) {
    const z = m.z - hd + (2 * hd * l) / lanes, n = Math.ceil((2 * hw) / step);
    for (let s = 0; s <= n; s++) { const u = s / n; world.push([m.x + (l % 2 === 0 ? -hw + 2 * hw * u : hw - 2 * hw * u), 0, z]); }
  }
  return projectMany(cdp, world);
}
const scrubMess = async (cdp, kind) => { const m = (await messCentre(cdp, kind)).m; await drag(cdp, await scrubPath(cdp, m)); await sleep(150); return (await snap(cdp)).detail.messes.find((x) => x.kind === kind); };
const messCentre = async (cdp, kind) => {
  let last = null, still = 0;
  for (let i = 0; i < 40 && still < 3; i++) {
    const m = (await snap(cdp)).detail.messes.find((x) => x.kind === kind);
    const p = (await projectMany(cdp, [[m.x, 0, m.z]]))[0];
    still = last && Math.hypot(p.x - last.p.x, p.y - last.p.y) < 1 ? still + 1 : 0;
    last = { m, p };
    await sleep(120);
  }
  return last;
};

async function loadApp(cdp, { reduced = false } = {}) {
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: reduced ? "reduce" : "no-preference" }] });
  const source = `try { localStorage.setItem("toyforge:prop-lang:v1", "en"); } catch (e) {}`;
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
  await cdp.ev(`window.__tvWorld.handle.go("room")`);
  await sleep(3000);
  if (!reduced) await waitFor(() => world(cdp, `!!(w.getMix() && w.getMix().canDrive(w.P.rig))`), { timeoutMs: 30000, label: "the character clips" });
}

// ======================================= the cleaning level =======================================
async function cleanSection(cdp) {
  const W = (b) => b; void W;
  console.log("\n[C0] setup");
  await loadApp(cdp);
  check("setup: the Toy Room has the cleaning cart", Boolean(await prop(cdp, "cleancart")));
  const CLEAN_LINES = [OH_NO, CLEAN_Q, ALL_CLEAN, ...Object.values(WRONG), SOAP_FIRST, SOAP_LOW, SOAP_HIGH];
  check("setup: every line the level says is in the closed list the voice reads from", CLEAN_LINES.every((l) => Boolean(idOf(l))), JSON.stringify(CLEAN_LINES.filter((l) => !idOf(l))));
  check("setup: nothing is happening and no card is up", (await snap(cdp)).phase === "idle" && (await card(cdp)) === null);

  // ---------------- C1. the Toy Room door, ages 2 to 4 (band 0): one mess, the right tool in hand ----------------
  console.log("\n[C1] the cleaning cart, band 0");
  await setBand(cdp, 0);
  const cartOn = await stage(cdp, "cleancart", 1.9);
  check("cart: it is on the screen", cartOn.visible && cartOn.x > 30 && cartOn.x < 360, JSON.stringify(cartOn));
  await shot(cdp, "c1-cart");
  await clearToast(cdp);
  cdp.voiceUrls.length = 0;
  await tapProp(cdp, "cleancart");
  const toastsC1 = new Set();
  const seenC1 = await sample(cdp, 7000, async () => { const t = await toastText(cdp); if (t) toastsC1.add(t); const s = await snap(cdp); return { ph: s.phase, act: (await toy(cdp)).action }; }, 50);
  const sC1 = await snap(cdp);
  check("cart: a tap sends Kip over, the mess lands, and the level is waiting for the child", sC1.phase === "active" && sC1.source === "prop" && sC1.detail.messes.length === 1, JSON.stringify({ ph: sC1.phase, src: sC1.source, n: sC1.detail.messes.length }));
  check("cart: Kip played the oops clip as the mess landed", seenC1.some((s) => s.act === "oops"), JSON.stringify([...new Set(seenC1.map((s) => s.act))]));
  check("cart: Kip said 'Oh no, oh no!' then 'Clean?' (the clips asked for, in that order) and the first is on screen too", voices(cdp).indexOf(voiceFor(OH_NO)) >= 0 && voices(cdp).indexOf(voiceFor(CLEAN_Q)) > voices(cdp).indexOf(voiceFor(OH_NO)) && toastsC1.has(OH_NO), JSON.stringify({ v: voices(cdp), t: [...toastsC1] }));
  const kind0 = sC1.detail.messes[0].kind, tool0 = { crumbs: "vacuum", puddle: "mop" }[kind0];
  check("cart: one mess, never jam, and the tool that fits it is already in Kip's hand", ["crumbs", "puddle"].includes(kind0) && sC1.detail.tool === tool0 && (await held(cdp)) === tool0, JSON.stringify({ kind0, tool: sC1.detail.tool, held: await held(cdp) }));
  const cardC1 = await card(cdp);
  const b0 = cardC1?.buttons[0];
  check("cart: the card asks 'Clean?' with ONE real button, 'Clean it', at least 56 px tall, with an accessible name, in a labelled group", cardC1 && !cardC1.hidden && cardC1.line === CLEAN_Q && cardC1.buttons.length === 1 && b0.id === "clean" && b0.h >= 56 && b0.label === "Clean it" && cardC1.role === "group" && cardC1.label === "Clean up", JSON.stringify(cardC1));
  const cen0 = await messCentre(cdp, kind0);
  check("cart: the mess is on the screen, in reach of a finger", cen0.p.x > 20 && cen0.p.x < 370 && cen0.p.y > 150 && cen0.p.y < 700, JSON.stringify(cen0.p));
  await shot(cdp, "c1-mess");
  voices(cdp);
  cdp.voiceUrls.length = 0;
  await clearToast(cdp);
  await cdp.tapAt(cen0.p.x, cen0.p.y);                                                            // ONE tap on the mess cleans it at this age
  const afterTap = await sample(cdp, 1800, async () => { const s = await snap(cdp); return { ph: s.phase, act: (await toy(cdp)).action, left: s.detail.messes[0]?.visibleCells }; }, 40);
  check("cart: one tap on the mess cleans it (band 0)", afterTap.some((s) => s.ph === "cheer"), JSON.stringify(afterTap.slice(0, 3)));
  check("cart: Kip cheered and said 'All clean! Hooray!' (the clip asked for), and the words were shown", voices(cdp).includes(voiceFor(ALL_CLEAN)) && afterTap.some((s) => s.act === "cheer"), JSON.stringify({ v: voices(cdp), acts: [...new Set(afterTap.map((s) => s.act))] }));
  await sleep(2200);
  const sC1b = await snap(cdp);
  check("cart: afterwards everything is put away: idle, no card, nothing in Kip's hands, no mess left", sC1b.phase === "idle" && (await noCard(cdp)) && (await held(cdp)) === null && sC1b.detail.messes.length === 0, JSON.stringify({ ph: sC1b.phase, held: await held(cdp), n: sC1b.detail.messes.length }));
  check("cart: the Toy Room door pays nothing (practice only, Q4): no stars for the rung", (await stars(cdp, "daily.clean")) === 0, String(await stars(cdp, "daily.clean")));

  // ---------------- C2. band 2 through the cart: two messes, choose the tool ----------------
  console.log("\n[C2] the cleaning cart, band 2: choose the tool");
  await setBand(cdp, 2);
  await cdp.ev(`window.__tvWorld.act.clean.nextStart = 0`);                                       // crumbs and a puddle
  await stage(cdp, "cleancart", 1.9);
  await clearToast(cdp);
  cdp.voiceUrls.length = 0;
  await tapProp(cdp, "cleancart");
  await waitFor(async () => (await snap(cdp)).phase === "active", { timeoutMs: 15000, label: "the level waiting" });
  const sC2 = await snap(cdp);
  const cardC2 = await card(cdp);
  check("band 2: two different messes and no tool in hand yet", sC2.detail.messes.length === 2 && new Set(sC2.detail.messes.map((m) => m.kind)).size === 2 && sC2.detail.tool === null && (await held(cdp)) === null, JSON.stringify({ k: sC2.detail.messes.map((m) => m.kind), tool: sC2.detail.tool }));
  check("band 2: the card offers Vacuum, Mop and Soapy sponge, each a real button of at least 56 px with a name", cardC2.buttons.filter((b) => b.id.startsWith("tool:")).length === 3 && cardC2.buttons.every((b) => b.h >= 56 && b.label), JSON.stringify(cardC2.buttons.map((b) => [b.id, b.h])));
  await shot(cdp, "c2-two-messes");
  // a wrong tool on the crumbs: the mop
  await pressBtn(cdp, "tool:mop");
  check("band 2: picking the mop puts the mop in Kip's hands and marks it chosen", (await held(cdp)) === "mop" && (await btn(cdp, "tool:mop")).pressed === "true", String(await held(cdp)));
  const crumbs = await messCentre(cdp, "crumbs");
  await clearToast(cdp);
  cdp.voiceUrls.length = 0;
  await cdp.tapAt(crumbs.p.x, crumbs.p.y);
  const twAll = await toastsFor(cdp, 700);
  const sW = await snap(cdp);
  check("wrong tool: the mop on crumbs says why, out loud (the clip asked for) and in words, the same sentence", heard(cdp, WRONG["mop>crumbs"]) && twAll.includes(WRONG["mop>crumbs"]), JSON.stringify({ heard: heard(cdp, WRONG["mop>crumbs"]), t: twAll }));
  const cardW = await card(cdp);
  check("wrong tool: nothing was cleaned, the right tool (the vacuum) glows, and the card stays small with its short words (the sentence is on the toast)", sW.detail.messes.find((m) => m.kind === "crumbs").cleared === 0 && sW.detail.hintTool === "vacuum" && sW.phase === "active" && cardW.line.length < 20 && cardW.buttons.every((b) => b.y > 400), JSON.stringify({ hint: sW.detail.hintTool, line: cardW?.line }));
  // a wrong tool on a drag too: scrub the crumbs with the mop
  const wr = await scrubMess(cdp, "crumbs");
  check("wrong tool: rubbing the crumbs with the mop clears nothing", wr.cleared === 0 && !wr.done, JSON.stringify(wr.cleared));
  await pressBtn(cdp, "tool:vacuum");
  check("band 2: the vacuum is in hand now", (await held(cdp)) === "vacuum");
  const c1 = await scrubMess(cdp, "crumbs");
  check("band 2: rubbing the crumbs with the vacuum clears them (half is enough here)", c1.done && c1.progress >= 1, JSON.stringify({ cleared: c1.cleared, needed: c1.needed }));
  await shot(cdp, "c2-crumbs-done");
  check("band 2: one mess done and the level still waiting for the other", (await snap(cdp)).phase === "active");
  await clearToast(cdp);
  cdp.voiceUrls.length = 0;
  const wp = await messCentre(cdp, "puddle");
  await cdp.tapAt(wp.p.x, wp.p.y);                                                                // the vacuum on the puddle
  await sleep(400);
  check("wrong tool: the vacuum on the puddle says its own reason", heard(cdp, WRONG["vacuum>puddle"]), JSON.stringify(voices(cdp)));
  await pressBtn(cdp, "tool:mop");
  const c2 = await scrubMess(cdp, "puddle");
  check("band 2: the mop clears the puddle", c2.done, JSON.stringify(c2.cleared));
  await sleep(300);
  check("band 2: with both gone Kip cheers: 'All clean! Hooray!'", heard(cdp, ALL_CLEAN) && ["cheer", "idle"].includes((await snap(cdp)).phase));
  await sleep(2200);

  // ---------------- C3. the Map door, band 3: all three messes, the soap window, pays the rung ----------------
  console.log("\n[C3] the Map rung daily.clean, band 3");
  await setBand(cdp, 3);
  await cdp.ev(`window.__tvWorld.act.clean.nextStart = 0`);
  const star0 = await stars(cdp, "daily.clean");
  await cdp.ev(`window.__tvWorld.P.pos.x = 8; window.__tvWorld.P.pos.z = -1.1; window.__tvWorld.P.target = null`);
  await sleep(1500);
  await clearToast(cdp);
  cdp.voiceUrls.length = 0;
  await cdp.ev(`window.__tvWorld.handle.startLearnRun("daily", [7], false)`);
  await waitFor(async () => (await snap(cdp)).phase === "active", { timeoutMs: 20000, label: "the rung's level waiting" });
  const sC3 = await snap(cdp);
  check("rung: the mess lands where Kip stands and the level is waiting (source: rung)", sC3.source === "rung" && sC3.band === 3 && sC3.detail.messes.length === 3, JSON.stringify({ src: sC3.source, band: sC3.band, n: sC3.detail.messes.length }));
  check("rung: all three messes, each wanting its own tool", JSON.stringify(sC3.detail.messes.map((m) => m.tool).sort()) === JSON.stringify(["mop", "sponge", "vacuum"]), JSON.stringify(sC3.detail.messes.map((m) => m.tool)));
  const panelText = await cdp.ev(`document.body.innerText`);
  check("rung: the mission panel is out of the way (it would cover the mess) and the pick-one steps are not shown; the card says what to do", !/Say it again/.test(panelText) && !/Crumbs spilled! What now\?/.test(panelText) && !(await noCard(cdp)), panelText.slice(0, 200).replace(/\n/g, " | "));
  const ons = await projectMany(cdp, (await snap(cdp)).detail.messes.map((m) => [m.x, 0, m.z]));
  const cardC3 = await card(cdp);
  const cardTop = Math.min(...cardC3.buttons.map((b) => b.y - b.h / 2)) - 40;
  check("rung: all three messes fit on the phone screen, and none is under the card", ons.every((p) => p.x > 8 && p.x < 382 && p.y > 140 && p.y < cardTop), JSON.stringify({ ons, cardTop }));
  // (found by a direct look on a 390 px phone: with four buttons the card wrapped to two rows and sat on the crumbs; activityPrompt.ts now packs four or more into ONE row)
  const oneRow = (c) => c.buttons.length > 0 && Math.max(...c.buttons.map((b) => b.y)) - Math.min(...c.buttons.map((b) => b.y)) < 6 && c.buttons.every((b) => b.x - b.w / 2 >= 0 && b.x + b.w / 2 <= 390);
  check("rung: the four-button card is ONE row inside the 390 px phone and every button is still at least 56 px tall", oneRow(cardC3) && cardC3.buttons.every((b) => b.h >= 56), JSON.stringify(cardC3.buttons.map((b) => [b.id, Math.round(b.x), Math.round(b.y), Math.round(b.w), Math.round(b.h)])));
  await shot(cdp, "c3-three-messes");
  await pressBtn(cdp, "tool:sponge");
  check("soap: with the sponge in hand the card offers Add soap, Mix and (once there is some) Pour it out; there is no 'Clean it' until the soap is mixed", Boolean(await btn(cdp, "soap:add")) && Boolean(await btn(cdp, "soap:mix")) && !(await btn(cdp, "clean")), JSON.stringify((await card(cdp)).buttons.map((b) => b.id)));
  const cardSoap = await card(cdp);
  check("soap: the soap row (Add soap, Mix, Pour out, Tools) is also ONE row on the phone", cardSoap.buttons.length >= 3 && oneRow(cardSoap), JSON.stringify(cardSoap.buttons.map((b) => [b.id, Math.round(b.x), Math.round(b.y), Math.round(b.w)])));
  const jam = await messCentre(cdp, "jam");
  cdp.voiceUrls.length = 0;
  await cdp.tapAt(jam.p.x, jam.p.y);
  await sleep(400);
  check("soap: the sponge on jam before the soap says 'Mix the soapy water first.'", heard(cdp, SOAP_FIRST), JSON.stringify(voices(cdp)));
  await pressBtn(cdp, "soap:add");
  await pressBtn(cdp, "soap:mix");
  check("soap: one scoop is too little: it says so and the soap is not ready", heard(cdp, SOAP_LOW) && (await snap(cdp)).detail.soap.ready === false, JSON.stringify((await snap(cdp)).detail.soap));
  for (let i = 0; i < 4; i++) await pressBtn(cdp, "soap:add");
  await pressBtn(cdp, "soap:mix");
  check("soap: five scoops is too much: it says so", heard(cdp, SOAP_HIGH), JSON.stringify(voices(cdp)));
  await pressBtn(cdp, "soap:pour");
  await pressBtn(cdp, "soap:add"); await pressBtn(cdp, "soap:add");
  await pressBtn(cdp, "soap:mix");
  check("soap: two scoops are inside the window: the soap is ready and 'Clean it' is back", (await snap(cdp)).detail.soap.ready === true && Boolean(await btn(cdp, "clean")), JSON.stringify((await snap(cdp)).detail.soap));
  const jm = await scrubMess(cdp, "jam");
  check("band 3: the soapy sponge clears the jam", jm.done, JSON.stringify({ cleared: jm.cleared, needed: jm.needed }));
  // a quick jab does not do it at band 3 (70% needed): crumbs with a single tap
  await pressBtn(cdp, "tool:vacuum");
  const cr3 = await messCentre(cdp, "crumbs");
  await cdp.tapAt(cr3.p.x, cr3.p.y);
  await sleep(200);
  const jab = (await snap(cdp)).detail.messes.find((m) => m.kind === "crumbs");
  check("band 3: one tap on the crumbs clears some but not the mess (70% is needed)", jab.cleared > 0 && !jab.done, JSON.stringify({ cleared: jab.cleared, needed: jab.needed }));
  const cr = await scrubMess(cdp, "crumbs");
  check("band 3: rubbing them with the vacuum finishes the crumbs", cr.done);
  await pressBtn(cdp, "tool:mop");
  const pu = await scrubMess(cdp, "puddle");
  check("band 3: the mop finishes the puddle", pu.done);
  await shot(cdp, "c3-done");
  await sleep(1500);
  check("rung: the rung paid: a star is earned for daily.clean (the Map door counts, unlike the cart)", (await stars(cdp, "daily.clean")) > star0, JSON.stringify({ before: star0, after: await stars(cdp, "daily.clean") }));
  await sleep(2500);
  check("rung: and it is over: idle, no card, nothing in hand", (await snap(cdp)).phase === "idle" && (await noCard(cdp)) && (await held(cdp)) === null);
  await cdp.ev(`window.__tvWorld.handle.stopLearnRun && window.__tvWorld.handle.stopLearnRun()`);

  // ---------------- C4. the switch form ----------------
  console.log("\n[C4] the switch form: 'Clean it'");
  await setBand(cdp, 2);
  await cdp.ev(`window.__tvWorld.act.clean.nextStart = 0`);
  await stage(cdp, "cleancart", 1.9);
  await tapProp(cdp, "cleancart");
  await waitFor(async () => (await snap(cdp)).phase === "active", { timeoutMs: 15000, label: "the level waiting" });
  await pressBtn(cdp, "tool:vacuum"); await pressBtn(cdp, "clean");
  await pressBtn(cdp, "tool:mop"); await pressBtn(cdp, "clean");
  await sleep(500);
  check("switch form: choosing the tool and pressing 'Clean it' does the whole job with no dragging", ["cheer", "idle"].includes((await snap(cdp)).phase));
  await sleep(2200);

  // ---------------- C5. a world change puts everything right ----------------
  console.log("\n[C5] a world change mid-game");
  await setBand(cdp, 3);
  await stage(cdp, "cleancart", 1.9);
  await tapProp(cdp, "cleancart");
  await waitFor(async () => (await snap(cdp)).phase === "active", { timeoutMs: 15000, label: "the level waiting" });
  await freeToy(cdp);
  check("world change: the mess and the card are up", (await snap(cdp)).detail.messes.length === 3 && (await card(cdp))?.hidden === false);
  await cdp.ev(`window.__tvWorld.handle.go("garden")`);
  await sleep(2500);
  const gone = await snap(cdp);
  check("world change: everything is put right: idle, no card, nothing in hand, no mess", gone.phase === "idle" && (await noCard(cdp)) && (await held(cdp)) === null && gone.detail.messes.length === 0, JSON.stringify({ ph: gone.phase, held: await held(cdp) }));
  await cdp.ev(`window.__tvWorld.handle.go("room")`);
  await sleep(2500);

  // ---------------- C6. reduced motion ----------------
  console.log("\n[C6] prefers-reduced-motion");
  await loadApp(cdp, { reduced: true });
  await setBand(cdp, 0);
  await stage(cdp, "cleancart", 1.9);
  await clearToast(cdp);
  await tapProp(cdp, "cleancart");
  const redAct = new Set();
  await waitFor(async () => { redAct.add((await toy(cdp)).action); return (await snap(cdp)).phase === "active"; }, { timeoutMs: 15000, label: "the level waiting" });
  check("reduced: no character clip plays (the toy only walks and stands)", [...redAct].every((a) => a === null), JSON.stringify([...redAct]));
  const sR = await snap(cdp);
  check("reduced: the mess is simply there, all of it, at once", sR.detail.messes[0].visibleCells === sR.detail.messes[0].needed || sR.detail.messes[0].visibleCells > 0);
  const cenR = await messCentre(cdp, sR.detail.messes[0].kind);
  await cdp.tapAt(cenR.p.x, cenR.p.y);
  const redSteps = await sample(cdp, 1200, async () => (await snap(cdp)).detail.messes[0]?.visibleCells ?? -1, 30);
  const distinct = [...new Set(redSteps.filter((v) => v >= 0))];
  check("reduced: and it is gone in one step, nothing in between (full, then none)", distinct.length <= 2 && distinct.includes(0), JSON.stringify(distinct));
  await sleep(2200);

  // ---------------- C7. sound off ----------------
  console.log("\n[C7] sound off");
  await loadApp(cdp);
  await cdp.ev(`window.__tvWorld.handle.mute()`);
  await setBand(cdp, 2);
  await cdp.ev(`window.__tvWorld.act.clean.nextStart = 0`);
  await stage(cdp, "cleancart", 1.9);
  await clearToast(cdp);
  cdp.voiceUrls.length = 0;
  await tapProp(cdp, "cleancart");
  const toastsC7 = new Set();
  await sample(cdp, 6500, async () => { const t = await toastText(cdp); if (t) toastsC7.add(t); return 0; }, 50);
  const cardC7 = await card(cdp);
  check("sound off: no line was asked of the voice", !voices(cdp).some((u) => u.startsWith("/api/voice?s=")), JSON.stringify(voices(cdp)));
  check("sound off: but 'Oh no, oh no!' is on the screen and 'Clean?' is on the card", toastsC7.has(OH_NO) && cardC7 && !cardC7.hidden && cardC7.line === CLEAN_Q, JSON.stringify({ t: [...toastsC7], line: cardC7?.line }));
  await pressBtn(cdp, "tool:mop");
  const cr7 = await messCentre(cdp, "crumbs");
  await clearToast(cdp);
  await cdp.tapAt(cr7.p.x, cr7.p.y);
  const tw7 = await toastsFor(cdp, 700);
  check("sound off: a wrong tool still says why, in words, and asks nothing of the voice", tw7.includes(WRONG["mop>crumbs"]) && !voices(cdp).some((u) => u.startsWith("/api/voice?s=")), JSON.stringify(tw7));
  await pressBtn(cdp, "tool:vacuum"); await pressBtn(cdp, "clean"); await pressBtn(cdp, "tool:mop"); await pressBtn(cdp, "clean");
  const toastsC7b = new Set();
  await sample(cdp, 2500, async () => { const t = await toastText(cdp); if (t) toastsC7b.add(t); return 0; }, 50);
  check("sound off: 'All clean! Hooray!' is shown too, and the room is clean", toastsC7b.has(ALL_CLEAN) && (await snap(cdp)).phase === "idle", JSON.stringify([...toastsC7b]));
}

// ======================================= the cooking level =======================================
const COOK = { INTRO: "Let's make pancakes!", CRACK: "Crack the egg!", POUR: "Pour the batter. Count with me!", HOT: "The pan is hot! A grown-up helps here.", HOT_OK: "Thank you! Now flip it.", FLIP: "Flip it up!", AGAIN: "Almost! Flip it again.", SERVE: "One pancake for each plate.", SERVE_AGAIN: "One pancake on each plate.", DONE: "Yummy pancakes! Hooray!" };
const COUNT = ["One!", "Two!", "Three!", "Four!", "Five!", "Six!"];
const csnap = (cdp) => snap(cdp, "cook");
/** A real mouse press held for `ms`, then released (the grown-up's hold). */
async function holdAt(cdp, x, y, ms) {
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await sleep(ms);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}
/** The parts of the kitchen on the screen, once the camera has stopped. */
async function kitchenParts(cdp) {
  let last = null, still = 0;
  for (let i = 0; i < 40 && still < 3; i++) {
    const p = (await csnap(cdp)).detail.parts;
    still = last && Math.hypot(p.pan.x - last.pan.x, p.pan.y - last.pan.y) < 1 ? still + 1 : 0;
    last = p;
    await sleep(120);
  }
  return last;
}
const cookPhase = async (cdp) => (await csnap(cdp)).phase;
const waitPhase = (cdp, ph, ms = 12000) => waitFor(async () => (await cookPhase(cdp)) === ph, { timeoutMs: ms, label: `cook phase ${ph}` });

/** The beats, with real taps; returns what was seen. `flipper(cdp, parts)` does the flip beat. */
async function cookThrough(cdp, tag, flipper) {
  await waitPhase(cdp, "egg");
  let parts = await kitchenParts(cdp);
  const n = (await csnap(cdp)).detail.plan.spoons;
  const cardE = await card(cdp);
  check(`${tag}: the card asks to crack the egg with one real button (56 px, named)`, cardE && !cardE.hidden && cardE.buttons.length === 1 && cardE.buttons[0].id === "crack" && cardE.buttons[0].h >= 56 && cardE.buttons[0].label, JSON.stringify(cardE));
  check(`${tag}: the whole kitchen is on the screen: egg, bowl, pan and every plate`, [parts.egg, parts.bowl, parts.pan, ...parts.plates].every((q) => q && q.x > 8 && q.x < 382 && q.y > 120 && q.y < 690), JSON.stringify(parts));
  await shot(cdp, `${tag}-kitchen`);
  // 1. the egg
  await cdp.tapAt(parts.egg.x, parts.egg.y);
  await waitPhase(cdp, "pour", 6000);
  check(`${tag}: tapping the egg cracks it and the batter beat begins`, (await cookPhase(cdp)) === "pour");
  // 2. the count
  const cardP = await card(cdp);
  check(`${tag}: the card says how many spoons to pour (${n}) and counts them`, cardP && /spoon/.test(cardP.line) && new RegExp(`\\b${n}\\b`).test(cardP.line), JSON.stringify(cardP?.line));
  await clearToast(cdp);
  const toasts = new Set();
  for (let i = 0; i < n; i++) {
    parts = await kitchenParts(cdp);
    await cdp.tapAt(parts.bowl.x, parts.bowl.y);
    for (const t of await toastsFor(cdp, 500)) toasts.add(t);
  }
  check(`${tag}: Kip counted the spoons out loud, in order: ${COUNT.slice(0, n).join(" ")}`, COUNT.slice(0, n).every((c) => heard(cdp, c) && toasts.has(c)), JSON.stringify({ toasts: [...toasts] }));
  check(`${tag}: one pancake appeared for each spoon (${n}) and not one more`, (await csnap(cdp)).detail.poured === n && (await csnap(cdp)).detail.pancakesShown.filter(Boolean).length === n, JSON.stringify((await csnap(cdp)).detail.pancakesShown));
  parts = await kitchenParts(cdp);
  await cdp.tapAt(parts.bowl.x, parts.bowl.y);                                      // one tap too many: nothing more goes in
  await sleep(300);
  check(`${tag}: a tap too many pours nothing more`, (await csnap(cdp)).detail.poured === n);
  // 3. it's hot
  await waitPhase(cdp, "hot", 6000);
  check(`${tag}: 'The pan is hot! A grown-up helps here.' (spoken, and on the card)`, heard(cdp, COOK.HOT) && (await card(cdp)).line === COOK.HOT, JSON.stringify((await card(cdp))?.line));
  const hb = await btn(cdp, "hot");
  check(`${tag}: ONE hold button for the grown-up, at least 56 px, with an accessible name that says grown-up`, hb && hb.h >= 56 && /grown-up/i.test(hb.label), JSON.stringify(hb));
  await shot(cdp, `${tag}-hot`);
  await holdAt(cdp, hb.x, hb.y, 500);
  check(`${tag}: a short press (0.5 s) does not say it is hot: still waiting for the grown-up`, (await cookPhase(cdp)) === "hot" && !(await csnap(cdp)).detail.hot);
  await cdp.tapAt(hb.x, hb.y);
  check(`${tag}: a quick tap does nothing either`, (await cookPhase(cdp)) === "hot");
  await holdAt(cdp, hb.x, hb.y, 1500);
  await waitPhase(cdp, "flip", 4000);
  check(`${tag}: holding it for 1.2 s and more goes on to the flip, with 'Thank you! Now flip it.'`, (await cookPhase(cdp)) === "flip" && (await csnap(cdp)).detail.hot && heard(cdp, COOK.HOT_OK), JSON.stringify((await csnap(cdp)).detail));
  // 4. the flip
  await flipper(cdp, tag);
  await waitPhase(cdp, "serve", 6000);
  check(`${tag}: the pancakes are flipped and the serve begins: 'One pancake for each plate.'`, (await cookPhase(cdp)) === "serve" && heard(cdp, COOK.SERVE));
  // 5. the serve: one to one
  parts = await kitchenParts(cdp);
  const cardS = await card(cdp);
  await shot(cdp, `${tag}-serve`);
  await cdp.tapAt(parts.pan.x, parts.pan.y);
  await sleep(250);
  check(`${tag}: tapping the pan picks a pancake up`, (await csnap(cdp)).detail.selected === 0, JSON.stringify((await csnap(cdp)).detail.selected));
  await cdp.tapAt(parts.plates[0].x, parts.plates[0].y);
  await sleep(1100);
  check(`${tag}: tapping a plate puts it there: one pancake on plate 0`, JSON.stringify((await csnap(cdp)).detail.placed) === JSON.stringify({ pancake0: "plate0" }), JSON.stringify((await csnap(cdp)).detail.placed));
  if (n > 1) {
    await cdp.tapAt(parts.pan.x, parts.pan.y);
    await sleep(250);
    await clearToast(cdp);
    await cdp.tapAt(parts.plates[0].x, parts.plates[0].y);                          // the same plate again
    const tw = await toastsFor(cdp, 600);
    check(`${tag}: a second pancake on the same plate is sent back with 'One pancake on each plate.' (spoken and shown), and nothing is lost`, heard(cdp, COOK.SERVE_AGAIN) && tw.includes(COOK.SERVE_AGAIN) && (await csnap(cdp)).detail.served === 1 && (await cookPhase(cdp)) === "serve", JSON.stringify({ tw, served: (await csnap(cdp)).detail.served }));
    for (let j = 1; j < n; j++) {
      await cdp.tapAt(parts.pan.x, parts.pan.y);
      await sleep(200);
      if ((await csnap(cdp)).detail.selected === null) { await cdp.tapAt(parts.pan.x, parts.pan.y); await sleep(200); }
      await cdp.tapAt(parts.plates[j].x, parts.plates[j].y);
      await sleep(1000);
    }
  }
  check(`${tag}: every plate has exactly one pancake (${n} served, one to one)`, (await csnap(cdp)).detail.served === n && new Set(Object.values((await csnap(cdp)).detail.placed)).size === n || ["cheer", "idle"].includes(await cookPhase(cdp)), JSON.stringify((await csnap(cdp)).detail.placed));
  await waitFor(async () => ["cheer", "idle"].includes(await cookPhase(cdp)), { timeoutMs: 6000, label: "the cheer" });
  check(`${tag}: Kip cheered: 'Yummy pancakes! Hooray!'`, heard(cdp, COOK.DONE));
  void cardS;
}

async function cookSection(cdp) {
  console.log("\n[K0] setup");
  await loadApp(cdp);
  check("setup: the Toy Room has the hob", Boolean(await prop(cdp, "hob")));
  const lines = [COOK.INTRO, COOK.CRACK, COOK.POUR, ...COUNT, COOK.HOT, COOK.HOT_OK, COOK.FLIP, COOK.AGAIN, COOK.SERVE, COOK.SERVE_AGAIN, COOK.DONE];
  check("setup: all 16 lines the level says are in the closed list the voice reads from", lines.length === 16 && lines.every((l) => Boolean(idOf(l))), JSON.stringify(lines.filter((l) => !idOf(l))));
  check("setup: nothing is happening", (await csnap(cdp)).phase === "idle" && (await noCard(cdp)));

  // ---------------- K1. the Toy Room hob, band 0: 1 to 3 spoons, a tap flips it ----------------
  console.log("\n[K1] the hob, band 0");
  await setBand(cdp, 0);
  await cdp.ev(`window.__tvWorld.act.cook.nextStart = 2`);                                       // three spoons
  const hobOn = await stage(cdp, "hob", 1.9);
  check("hob: it is on the screen", hobOn.visible && hobOn.x > 30 && hobOn.x < 360, JSON.stringify(hobOn));
  await shot(cdp, "k1-hob");
  await clearToast(cdp);
  cdp.voiceUrls.length = 0;
  await tapProp(cdp, "hob");
  const seenK1 = await sample(cdp, 4500, async () => ({ ph: await cookPhase(cdp), act: (await toy(cdp)).action }), 80);
  check("hob: a tap sends Kip over, 'Let's make pancakes!' is said (clip and words), and the egg is waiting", heard(cdp, COOK.INTRO) && heard(cdp, COOK.CRACK) && seenK1.some((s) => s.ph === "making") && (await cookPhase(cdp)) === "egg", JSON.stringify({ ph: await cookPhase(cdp) }));
  check("hob: Kip holds the spatula", (await held(cdp)) === "spatula", String(await held(cdp)));
  await cookThrough(cdp, "band 0", async (c, tag) => {
    const parts = await kitchenParts(c);
    await c.tapAt(parts.pan.x, parts.pan.y);                                                      // a tap flips it at this age
    check(`${tag}: a tap on the pan flips it (bands 0 and 1 cannot miss)`, true);
  });
  await sleep(2600);
  const k1End = await csnap(cdp);
  check("hob: afterwards everything is put away: idle, no card, nothing in hand", k1End.phase === "idle" && (await noCard(cdp)) && (await held(cdp)) === null, JSON.stringify({ ph: k1End.phase, held: await held(cdp) }));
  check("hob: the Toy Room door pays nothing (practice only, Q4)", (await stars(cdp, "daily.cook")) === 0, String(await stars(cdp, "daily.cook")));

  // ---------------- K2. the Map door, band 3: six spoons, a real flick, one to one ----------------
  console.log("\n[K2] the Map rung daily.cook, band 3");
  await setBand(cdp, 3);
  await cdp.ev(`window.__tvWorld.act.cook.nextStart = 5`);                                       // six spoons
  const star0 = await stars(cdp, "daily.cook");
  await cdp.ev(`window.__tvWorld.P.pos.x = 16; window.__tvWorld.P.pos.z = 0; window.__tvWorld.P.target = null`);
  await sleep(1500);
  await clearToast(cdp);
  await cdp.ev(`window.__tvWorld.handle.startLearnRun("daily", [5], false)`);
  await waitPhase(cdp, "egg", 20000);
  const sK2 = await csnap(cdp);
  check("rung: the kitchen is where Kip stands (source: rung), band 3, six spoons", sK2.source === "rung" && sK2.band === 3 && sK2.detail.plan.spoons === 6 && sK2.detail.plan.range[1] === 6, JSON.stringify({ src: sK2.source, plan: sK2.detail.plan }));
  check("rung: the mission panel is out of the way and the card carries the words", !/Say it again/.test(await cdp.ev(`document.body.innerText`)) && !(await noCard(cdp)));
  await cookThrough(cdp, "band 3", async (c, tag) => {
    // a real swipe on the pan: first the wrong way (down), then up at random moments until it lands
    const swipe = async (up) => {
      const q = (await kitchenParts(c)).pan;
      const dy = up ? -70 : 70;
      await drag(c, [0, 0.25, 0.5, 0.75, 1].map((u) => ({ x: q.x, y: q.y + dy * u })), 12);
    };
    await clearToast(c);
    await swipe(false);
    const tw = await toastsFor(c, 500);
    check(`${tag}: a swipe down the pan is not the flip: 'Almost! Flip it again.' (spoken and shown), nothing lost`, heard(c, COOK.AGAIN) && tw.includes(COOK.AGAIN) && (await cookPhase(c)) === "flip" && (await csnap(c)).detail.flick.misses === 1, JSON.stringify({ tw, flick: (await csnap(c)).detail.flick }));
    const w0 = (await csnap(c)).detail.flick.window;
    let tries = 0;
    while ((await cookPhase(c)) === "flip" && tries++ < 14) { await swipe(true); await sleep(180 + (tries * 137) % 500); }
    const f = (await csnap(c)).detail.flick;
    check(`${tag}: swiping up on the pan flips it within a few tries (the window widens after misses, so it never gets stuck); misses ${f.misses}, window ${f.window}`, (await cookPhase(c)) !== "flip" && tries < 14 && f.window >= w0, JSON.stringify({ tries, f, w0 }));
  });
  await sleep(1500);
  check("rung: the rung paid: a star is earned for daily.cook", (await stars(cdp, "daily.cook")) > star0, JSON.stringify({ before: star0, after: await stars(cdp, "daily.cook") }));
  await sleep(2500);
  check("rung: and it is over: idle, no card, nothing in hand", (await csnap(cdp)).phase === "idle" && (await noCard(cdp)) && (await held(cdp)) === null);
  await cdp.ev(`window.__tvWorld.handle.stopLearnRun && window.__tvWorld.handle.stopLearnRun()`);

  // ---------------- K3. a world change puts everything right, at the hot beat ----------------
  console.log("\n[K3] a world change mid-cook");
  await setBand(cdp, 1);
  await cdp.ev(`window.__tvWorld.act.cook.nextStart = 0`);
  await stage(cdp, "hob", 1.9);
  await tapProp(cdp, "hob");
  await waitPhase(cdp, "egg", 15000);
  await freeToy(cdp);
  let parts = await kitchenParts(cdp);
  await cdp.tapAt(parts.egg.x, parts.egg.y);
  await waitPhase(cdp, "pour", 6000);
  parts = await kitchenParts(cdp);
  await cdp.tapAt(parts.bowl.x, parts.bowl.y);
  await waitPhase(cdp, "hot", 8000);
  check("world change: the kitchen and the grown-up's button are up, the pan is hot", (await noCard(cdp)) === false && Boolean(await btn(cdp, "hot")));
  await cdp.ev(`window.__tvWorld.handle.go("garden")`);
  await sleep(2500);
  const gone = await csnap(cdp);
  check("world change: everything is put right: idle, no card, nothing in hand, no pancakes", gone.phase === "idle" && (await noCard(cdp)) && (await held(cdp)) === null && gone.detail.pancakesShown.length === 0, JSON.stringify({ ph: gone.phase }));
  await cdp.ev(`window.__tvWorld.handle.go("room")`);
  await sleep(2500);

  // ---------------- K4. reduced motion ----------------
  console.log("\n[K4] prefers-reduced-motion");
  await loadApp(cdp, { reduced: true });
  await setBand(cdp, 0);
  await cdp.ev(`window.__tvWorld.act.cook.nextStart = 1`);                                       // two spoons
  await stage(cdp, "hob", 1.9);
  await tapProp(cdp, "hob");
  const acts = new Set();
  await waitFor(async () => { acts.add((await toy(cdp)).action); return (await cookPhase(cdp)) === "egg"; }, { timeoutMs: 15000, label: "the egg" });
  await freeToy(cdp);
  parts = await kitchenParts(cdp);
  await cdp.tapAt(parts.egg.x, parts.egg.y);
  await waitPhase(cdp, "pour", 3000);
  check("reduced: the egg is cracked at once (no shaking: the beat moves on straight away)", (await cookPhase(cdp)) === "pour");
  parts = await kitchenParts(cdp);
  await cdp.tapAt(parts.bowl.x, parts.bowl.y); await sleep(200); await cdp.tapAt(parts.bowl.x, parts.bowl.y);
  await waitPhase(cdp, "hot", 3000);
  check("reduced: both pancakes are simply there and it goes straight to the hot beat", (await csnap(cdp)).detail.pancakesShown.every(Boolean));
  const hr = await btn(cdp, "hot");
  await holdAt(cdp, hr.x, hr.y, 1500);
  await waitPhase(cdp, "flip", 3000);
  parts = await kitchenParts(cdp);
  await cdp.tapAt(parts.pan.x, parts.pan.y);
  await waitPhase(cdp, "serve", 3000);
  check("reduced: the flip is a change, not a flight: the serve begins at once", (await cookPhase(cdp)) === "serve");
  parts = await kitchenParts(cdp);
  for (let j = 0; j < 2; j++) { await cdp.tapAt(parts.pan.x, parts.pan.y); await sleep(150); await cdp.tapAt(parts.plates[j].x, parts.plates[j].y); await sleep(500); }
  await waitFor(async () => ["cheer", "idle"].includes(await cookPhase(cdp)), { timeoutMs: 6000, label: "the cheer" });
  check("reduced: every beat played with no character clip but the world's own (the toy only walks and stands)", [...acts].every((a) => a === null), JSON.stringify([...acts]));
  await sleep(2500);

  // ---------------- K5. sound off ----------------
  console.log("\n[K5] sound off");
  await loadApp(cdp);
  await cdp.ev(`window.__tvWorld.handle.mute()`);
  await setBand(cdp, 1);
  await cdp.ev(`window.__tvWorld.act.cook.nextStart = 1`);
  await stage(cdp, "hob", 1.9);
  await clearToast(cdp);
  cdp.voiceUrls.length = 0;
  await tapProp(cdp, "hob");
  const tw5 = new Set();
  await sample(cdp, 4200, async () => { const t = await toastText(cdp); if (t) tw5.add(t); return 0; }, 50);
  check("sound off: the intro and the first beat are on the screen and nothing was asked of the voice", tw5.has(COOK.INTRO) && !voices(cdp).some((u) => u.startsWith("/api/voice?s=")) && (await card(cdp))?.line === COOK.CRACK, JSON.stringify({ t: [...tw5], line: (await card(cdp))?.line }));
  await freeToy(cdp);
  parts = await kitchenParts(cdp);
  await cdp.tapAt(parts.egg.x, parts.egg.y);
  await waitPhase(cdp, "pour", 6000);
  await clearToast(cdp);
  parts = await kitchenParts(cdp);
  await cdp.tapAt(parts.bowl.x, parts.bowl.y);
  const c1 = await toastsFor(cdp, 500);
  check("sound off: the count is shown as words, 'One!'", c1.includes("One!") && !voices(cdp).some((u) => u.startsWith("/api/voice?s=")), JSON.stringify(c1));
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
    const only = process.env.E2E_ONLY ?? "";
    if (!only || only === "clean") await cleanSection(cdp);
    if (!only || only === "cook") await cookSection(cdp);
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
