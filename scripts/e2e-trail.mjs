#!/usr/bin/env node
// Explorer trail map (docs/specs/explorer-map-spec.md): headless-Chrome checks
// at 390x844. Own dev server + own Chrome profile, so it never touches a dev
// server another session is running. Exits nonzero on any failing check.
// Run: npm run e2e:trail
// Overrides: E2E_CHROME (binary), E2E_PORT, E2E_DEBUG_PORT, E2E_PROFILE,
//            E2E_SHOTS (dir; when set, saves a trail-map screenshot).
//
// Guards, in the real React overlay (unit tests cannot see these):
//   - the scroll position survives opening and closing the RungSheet;
//   - a frontier tap that cannot start keeps the map open, shows a notice and
//     records no visit; once it can start it closes, plays the seed, records it;
//   - fog is drawing only: clouded nodes stay enabled buttons;
//   - arrow keys walk the roads; Cards and Trail map swap views;
//   - layout (measured in the real DOM): each node circle is centred on the
//     point its roads end at, and no label runs into another node or label;
//   - no uncaught exception in any scenario.
// A road passing under a node it skips is pure geometry and lives in
// tests/explorer-map.test.ts.
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const CHROME =
  process.env.E2E_CHROME ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEV_PORT = Number(process.env.E2E_PORT ?? 5199);
const DEBUG_PORT = Number(process.env.E2E_DEBUG_PORT ?? 9335);
const PROFILE =
  process.env.E2E_PROFILE ?? path.join(os.tmpdir(), "toyforge-e2e-trail-profile");
const SHOTS = process.env.E2E_SHOTS;
const APP_URL = `http://localhost:${DEV_PORT}/`;
const VIEWPORT = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
const STORAGE_KEY = "toyforge:progression:v1";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, pass, detail = "") => results.push({ name, pass: Boolean(pass), detail });

async function waitFor(fn, { timeoutMs = 30000, everyMs = 250, label = "?" } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  for (;;) {
    try {
      last = await fn();
      if (last) return last;
    } catch (err) {
      last = err;
    }
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${label}: ${String(last)}`);
    await sleep(everyMs);
  }
}

class Cdp {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.exceptions = [];
  }
  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", (e) => reject(e), { once: true });
      ws.addEventListener("message", (event) => {
        let msg;
        try {
          msg = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (msg.id != null && this.pending.has(msg.id)) {
          const { resolve: res, reject: rej } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) rej(new Error(JSON.stringify(msg.error)));
          else res(msg.result);
        } else if (msg.method === "Runtime.exceptionThrown") {
          const d = msg.params?.exceptionDetails;
          this.exceptions.push(String(d?.exception?.description ?? d?.text ?? "unknown").slice(0, 400));
        }
      });
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const res = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res?.exceptionDetails) {
      throw new Error(`evaluate threw: ${JSON.stringify(res.exceptionDetails).slice(0, 300)}`);
    }
    return res?.result?.value;
  }
  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

async function waitHttpOk(url, timeoutMs = 90000) {
  await waitFor(
    async () => {
      try {
        return (await fetch(url)).ok || null;
      } catch {
        return null;
      }
    },
    { timeoutMs, label: url },
  );
}

async function openPage() {
  await waitHttpOk(`http://localhost:${DEBUG_PORT}/json/version`, 60000);
  await fetch(`http://localhost:${DEBUG_PORT}/json/new?about:blank`, { method: "PUT" });
  const target = await waitFor(
    async () => {
      const list = await (await fetch(`http://localhost:${DEBUG_PORT}/json/list`)).json();
      return list.find((t) => t.url === "about:blank") ?? null;
    },
    { timeoutMs: 15000, label: "new tab" },
  );
  const cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", VIEWPORT);
  return cdp;
}

/** Load the app with a seeded save in place before any app code runs. */
async function loadApp(cdp, seed) {
  const { identifier } = await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `try{localStorage.setItem(${JSON.stringify(STORAGE_KEY)},${JSON.stringify(JSON.stringify(seed))});}catch(e){}`,
  });
  try {
    await cdp.send("Page.navigate", { url: APP_URL });
    await waitFor(() => cdp.evaluate(`!!document.querySelector("canvas")`), {
      timeoutMs: 90000,
      label: "stage canvas",
    });
  } finally {
    await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
  }
  await cdp.evaluate(
    `(()=>{const t=document.querySelector("#title");if(t&&!t.hidden)document.querySelector("#play")?.click();})()`,
  );
  await waitFor(
    () => cdp.evaluate(`(()=>{const t=document.querySelector("#title");return !t||t.hidden||null})()`),
    { timeoutMs: 15000, label: "title dismissed" },
  );
  await sleep(1500);
}

const clickButton = (cdp, scope, text) =>
  cdp.evaluate(
    `(()=>{const b=[...document.querySelectorAll(${JSON.stringify(scope)})].find(x=>(x.textContent||"").trim().startsWith(${JSON.stringify(text)}));if(!b)return false;b.click();return true})()`,
  );

/** Dock ⋯ -> Map, then the Trail map view. */
async function openTrail(cdp) {
  await cdp.evaluate(
    `(()=>{const b=[...document.querySelectorAll(".tv-dock-right button")].find(x=>(x.textContent||"").includes("⋯"));b&&b.click()})()`,
  );
  await waitFor(() => cdp.evaluate(`!!document.querySelector(".tv-more-menu")`), { label: "more menu" });
  await clickButton(cdp, ".tv-more-menu [role=menuitem]", "Map");
  await waitFor(() => cdp.evaluate(`!!document.querySelector(".tv-sheet-map")`), { label: "map sheet" });
  if (!(await cdp.evaluate(`!!document.querySelector(".tv-trail-scroll")`))) {
    await clickButton(cdp, ".tv-sheet-map button", "Trail map");
    await waitFor(() => cdp.evaluate(`!!document.querySelector(".tv-trail-scroll")`), { label: "trail view" });
  }
  await sleep(300);
}

const visited = (cdp) =>
  cdp.evaluate(
    `(()=>{try{return JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)})||"{}").explorerVisited||[]}catch(e){return null}})()`,
  );

// Sandbox-open so the Bridges ladder offers several rungs (opens the RungSheet).
async function scenarioScrollAndFrontier(cdp) {
  await loadApp(cdp, { version: 1, totalXp: 0, ageBand: 3, sandboxUnlockAll: true });
  await openTrail(cdp);

  // Scroll restore after the RungSheet.
  const before = await cdp.evaluate(
    `(()=>{const s=document.querySelector(".tv-trail-scroll");s.scrollLeft=230;s.scrollTop=170;return {l:s.scrollLeft,t:s.scrollTop,scrollable:s.scrollWidth>s.clientWidth}})()`,
  );
  check("trail scroller scrolls (restore test is meaningful)", before.scrollable && before.l > 0, JSON.stringify(before));
  await cdp.evaluate(`document.querySelector('[data-node-id="bridges"]')?.click()`);
  const sheet = await waitFor(() => cdp.evaluate(`!!document.querySelector(".tv-rung-list")`), {
    timeoutMs: 5000,
    label: "rung sheet",
  }).catch(() => false);
  check("Bridges opens the rung sheet", sheet === true);
  if (sheet) {
    await clickButton(cdp, ".tv-sheet-rungs .tv-ctl", "");
    await waitFor(() => cdp.evaluate(`!!document.querySelector(".tv-trail-scroll")`), { label: "trail back" });
    await sleep(200);
    const after = await cdp.evaluate(
      `(()=>{const s=document.querySelector(".tv-trail-scroll");return {l:s.scrollLeft,t:s.scrollTop}})()`,
    );
    check(
      "scroll position restored after closing the rung sheet",
      Math.abs(after.l - before.l) <= 1 && Math.abs(after.t - before.t) <= 1,
      `before ${before.l},${before.t} after ${after.l},${after.t}`,
    );
  }

  // Frontier tap that cannot start, then one that can.
  const hasHandle = (await cdp.evaluate(`typeof window.__tvWorld`)) === "object";
  check("dev handle window.__tvWorld present", hasHandle);
  if (!hasHandle) return;
  const node = "frontier:lab3:2";
  await cdp.evaluate(`window.__tvWorld.P.busy = true`);
  await cdp.evaluate(`document.querySelector('[data-node-id="${node}"]').click()`);
  await sleep(400);
  const notice = await cdp.evaluate(
    `document.querySelector(".tv-sheet-map .tv-moves[role=status]")?.textContent||""`,
  );
  const v1 = await visited(cdp);
  check("busy frontier tap: map stays open", await cdp.evaluate(`!!document.querySelector(".tv-trail-scroll")`));
  check("busy frontier tap: notice shown", /can't start/i.test(notice), JSON.stringify(notice));
  check("busy frontier tap: no visit recorded", Array.isArray(v1) && !v1.includes(node), JSON.stringify(v1));

  await cdp.evaluate(`window.__tvWorld.P.busy = false`);
  await cdp.evaluate(`document.querySelector('[data-node-id="${node}"]').click()`);
  await sleep(1200);
  const world = await cdp.evaluate(`String(window.__tvWorld.handle?.S?.world ?? "?")`);
  const v2 = await visited(cdp);
  check("ready frontier tap: map closes", await cdp.evaluate(`!document.querySelector(".tv-sheet-map")`));
  check("ready frontier tap: seeded level is the current world", world.startsWith("seed-"), world);
  check("ready frontier tap: visit recorded", Array.isArray(v2) && v2.includes(node), JSON.stringify(v2));
}

// Fresh age-1 save: real fog, keyboard travel, view toggle.
async function scenarioFogKeysToggle(cdp) {
  await loadApp(cdp, { version: 1, totalXp: 0, ageBand: 1 });
  await openTrail(cdp);

  const fog = await cdp.evaluate(
    `(()=>{const m={};for(const b of document.querySelectorAll("[data-node-id]")){m[b.dataset.nodeId]={cls:b.className,disabled:b.disabled}}return m})()`,
  );
  const has = (id, c) => fog[id]?.cls.includes(`tv-trail-node-${c}`);
  check("fog: Toy Room is revealed", has("room", "revealed"));
  check("fog: a far world is clouded", has("snow", "clouded"));
  check("fog: a neighbour of home is a silhouette", has("daily", "next"));
  check(
    "fog never locks: every node is an enabled button",
    Object.values(fog).length > 20 && Object.values(fog).every((n) => n.disabled === false),
  );

  // Arrow keys walk the roads (real keydown through the React handler).
  const key = (k) =>
    cdp.evaluate(
      `(()=>{const el=document.activeElement;el.dispatchEvent(new KeyboardEvent("keydown",{key:${JSON.stringify(k)},bubbles:true}));return document.activeElement?.dataset?.nodeId||null})()`,
    );
  await cdp.evaluate(`document.querySelector('[data-node-id="room"]').focus()`);
  check("arrow right from Toy Room reaches Junkyard", (await key("ArrowRight")) === "junk");
  await cdp.evaluate(`document.querySelector('[data-node-id="room"]').focus()`);
  check("arrow left from Toy Room reaches Garden", (await key("ArrowLeft")) === "garden");
  await cdp.evaluate(`document.querySelector('[data-node-id="room"]').focus()`);
  check("arrow up from Toy Room reaches Sky Meadow", (await key("ArrowUp")) === "sky");

  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(path.join(SHOTS, "trail-map.png"), Buffer.from(shot.data, "base64"));
  }

  // Cards <-> Trail map.
  await clickButton(cdp, ".tv-sheet-map button", "Cards");
  await sleep(300);
  check(
    "Cards swaps to the carousel (trail gone, Trail map button back)",
    await cdp.evaluate(
      `!document.querySelector(".tv-trail-scroll") && [...document.querySelectorAll(".tv-sheet-map button")].some(b=>(b.textContent||"").trim()==="Trail map")`,
    ),
  );
  await clickButton(cdp, ".tv-sheet-map button", "Trail map");
  await sleep(300);
  check("Trail map swaps back to the trail view", await cdp.evaluate(`!!document.querySelector(".tv-trail-scroll")`));
}

// Everything revealed (all 31 labels at full length): measure the real DOM.
// The unit tests see grid coordinates; only the browser knows how big a node
// and its label are, so overlap is checked here.
async function scenarioLayout(cdp) {
  await loadApp(cdp, { version: 1, totalXp: 0, ageBand: 3, sandboxUnlockAll: true });
  await openTrail(cdp);
  const m = await cdp.evaluate(`(()=>{
    const canvas = document.querySelector(".tv-trail-canvas").getBoundingClientRect();
    const nodes = [...document.querySelectorAll(".tv-trail-node-wrap")].map((w) => {
      const btn = w.querySelector("button");
      const b = btn.getBoundingClientRect();
      const lab = w.querySelector(".tv-trail-node-label");
      const range = document.createRange();
      range.selectNodeContents(lab);
      const lines = [...range.getClientRects()]
        .filter((r) => r.width > 0 && r.height > 0)
        .map((r) => ({ x: r.x - canvas.x, y: r.y - canvas.y, w: r.width, h: r.height }));
      return {
        id: btn.dataset.nodeId,
        px: parseFloat(w.style.left), py: parseFloat(w.style.top),
        cx: b.x + b.width / 2 - canvas.x, cy: b.y + b.height / 2 - canvas.y,
        r: b.width / 2, lines,
      };
    });
    return nodes;
  })()`);
  check("layout: measured every node", m.length >= 30, `${m.length} nodes`);

  // 1. The circle sits on the point its roads are drawn to.
  const off = m.filter((n) => Math.hypot(n.cx - n.px, n.cy - n.py) > 2);
  check(
    "layout: each circle is centred on its road endpoint",
    off.length === 0,
    off.slice(0, 4).map((n) => `${n.id} off by ${Math.round(Math.hypot(n.cx - n.px, n.cy - n.py))}px`).join(", "),
  );

  // 2. No label text runs into another node's circle.
  const hitsCircle = [];
  for (const a of m) {
    for (const line of a.lines) {
      for (const b of m) {
        if (b.id === a.id) continue;
        const dx = Math.max(line.x - b.cx, 0, b.cx - (line.x + line.w));
        const dy = Math.max(line.y - b.cy, 0, b.cy - (line.y + line.h));
        if (dx * dx + dy * dy < b.r * b.r) hitsCircle.push(`${a.id} label under ${b.id}`);
      }
    }
  }
  check(
    "layout: no label text runs into another node's circle",
    hitsCircle.length === 0,
    [...new Set(hitsCircle)].slice(0, 6).join(", "),
  );

  // 3. No label text overlaps another node's label text.
  const hitsLabel = [];
  for (let i = 0; i < m.length; i++) {
    for (let j = i + 1; j < m.length; j++) {
      for (const p of m[i].lines) {
        for (const q of m[j].lines) {
          if (p.x < q.x + q.w - 1 && q.x < p.x + p.w - 1 && p.y < q.y + q.h - 1 && q.y < p.y + p.h - 1) {
            hitsLabel.push(`${m[i].id} / ${m[j].id}`);
          }
        }
      }
    }
  }
  check(
    "layout: no two labels overlap",
    hitsLabel.length === 0,
    [...new Set(hitsLabel)].slice(0, 6).join(", "),
  );
}

async function main() {
  const root = new URL("..", import.meta.url).pathname;
  rmSync(PROFILE, { recursive: true, force: true });
  const dev = spawn("npm", ["run", "dev", "--", "--port", String(DEV_PORT), "--strictPort"], {
    cwd: root,
    stdio: "ignore",
  });
  // Real GPU: with SwiftShader the stage never answers CDP.
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      "--use-angle=metal",
      "--ignore-gpu-blocklist",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${PROFILE}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-features=Translate",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  const killAll = () => {
    try {
      chrome.kill();
    } catch {}
    try {
      dev.kill();
    } catch {}
  };
  process.on("SIGINT", () => {
    killAll();
    process.exit(130);
  });
  const run = async (name, fn) => {
    const page = await openPage();
    try {
      await fn(page);
      check(`no-uncaught-exception-${name}`, page.exceptions.length === 0, page.exceptions.slice(0, 3).join(" | "));
    } catch (err) {
      check(`scenario-${name}`, false, String((err && err.message) || err));
    } finally {
      page.close();
    }
  };
  try {
    await waitHttpOk(APP_URL);
    await run("scroll-frontier", scenarioScrollAndFrontier);
    await run("fog-keys-toggle", scenarioFogKeysToggle);
    await run("layout", scenarioLayout);
  } finally {
    killAll();
  }
  let failed = 0;
  for (const r of results) {
    if (!r.pass) failed += 1;
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  }
  console.log(`${results.length - failed}/${results.length} checks passed`);
  process.exitCode = failed > 0 ? 1 : 0;
}

await main();
