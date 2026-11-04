#!/usr/bin/env node
// 390x844 headless-Chrome E2E for the landed phases. Uses the machine's
// installed Google Chrome over CDP (global WebSocket, no new dependencies).
// Run: npm run e2e. Exits nonzero on any failing check.
// Overrides: E2E_CHROME (binary), E2E_PORT, E2E_DEBUG_PORT, E2E_PROFILE.
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";

const CHROME =
  process.env.E2E_CHROME ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEV_PORT = Number(process.env.E2E_PORT ?? 5198);
const DEBUG_PORT = Number(process.env.E2E_DEBUG_PORT ?? 9333);
const PROFILE = process.env.E2E_PROFILE ?? "/tmp/toyforge-e2e-profile";
const APP_URL = `http://localhost:${DEV_PORT}/?title=0`; // ?title=0: straight into the world, not the main menu (src/features/game/world/titleEntries.ts)
const VIEWPORT = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
          const desc =
            d?.exception?.description ?? d?.text ?? "unknown exception";
          this.exceptions.push(String(desc).slice(0, 500));
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
  async evaluate(expression, awaitPromise = false) {
    const res = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true,
    });
    if (res?.exceptionDetails) {
      throw new Error(
        `evaluate threw: ${JSON.stringify(res.exceptionDetails).slice(0, 300)}`,
      );
    }
    return res?.result?.value;
  }
  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

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
    if (Date.now() > deadline) {
      throw new Error(`timeout waiting for ${label}: ${String(last)}`);
    }
    await sleep(everyMs);
  }
}

async function waitHttpOk(url, timeoutMs = 90000) {
  await waitFor(
    async () => {
      try {
        const res = await fetch(url);
        return res.ok || null;
      } catch {
        return null;
      }
    },
    { timeoutMs, label: url },
  );
}

async function chromeTargets() {
  const res = await fetch(`http://localhost:${DEBUG_PORT}/json/list`);
  return res.json();
}

async function openPage() {
  // The debug port may not be bound yet on a slow start; every other CDP
  // interaction retries via waitFor, so gate the one-shot tab creation too.
  await waitHttpOk(`http://localhost:${DEBUG_PORT}/json/version`, 60000);
  await fetch(`http://localhost:${DEBUG_PORT}/json/new?about:blank`, {
    method: "PUT",
  });
  const targets = await waitFor(
    async () => {
      const list = (await chromeTargets()).filter((t) => t.url === "about:blank");
      return list.length > 0 ? list : null;
    },
    { timeoutMs: 15000, label: "new tab" },
  );
  const cdp = new Cdp(targets[0].webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send("Emulation.setDeviceMetricsOverride", VIEWPORT);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  return cdp;
}

async function pastTitle(cdp) {
  await cdp.evaluate(
    `(() => { const t = document.querySelector("#title"); if (t && !t.hidden) document.querySelector("#play")?.click(); })()`,
  );
  await waitFor(
    () =>
      cdp.evaluate(
        `(() => { const t = document.querySelector("#title"); return !t || t.hidden || null; })()`,
      ),
    { timeoutMs: 15000, label: "title dismissed" },
  );
}

async function gotoApp(cdp, seedProgression) {
  if (seedProgression !== undefined) {
    // Seed before any app code runs in the new document. The old
    // write-then-reload order left the outgoing page live between the seed
    // write and the reload commit, and its boot effects (grandfather +
    // progression pull in GameCanvas) saved stale totalXp: 0 straight over
    // the seed ~1 run in 3.
    const seeded = JSON.stringify(JSON.stringify(seedProgression));
    const { identifier } = await cdp.send(
      "Page.addScriptToEvaluateOnNewDocument",
      {
        source: `try { localStorage.setItem("toyforge:progression:v1", ${seeded}); } catch (e) {}`,
      },
    );
    try {
      await cdp.send("Page.navigate", { url: APP_URL });
      await waitFor(
        () => cdp.evaluate(`!!document.querySelector("canvas")`),
        { timeoutMs: 60000, label: "stage canvas after reseed" },
      );
    } finally {
      await cdp.send("Page.removeScriptToEvaluateOnNewDocument", {
        identifier,
      });
    }
  } else {
    await cdp.send("Page.navigate", { url: APP_URL });
    await waitFor(
      () => cdp.evaluate(`!!document.querySelector("canvas")`),
      { timeoutMs: 60000, label: "stage canvas" },
    );
  }
  await pastTitle(cdp);
  await sleep(1500);
}

async function openToyBox(cdp) {
  const clicked = await cdp.evaluate(
    `(() => { const b = [...document.querySelectorAll(".tv-dock button")].find((x) => (x.getAttribute("aria-label") || "").startsWith("Toy Box:")); if (b) { b.click(); return b.getAttribute("aria-label"); } return null; })()`,
  );
  try {
    await waitFor(
      () =>
        cdp.evaluate(
          `document.querySelector(".tv-roster-card-lock, .tv-roster-card") ? true : null`,
        ),
      { timeoutMs: 15000, label: "toy box cards" },
    );
  } catch (err) {
    const diag = await cdp.evaluate(
      `JSON.stringify({ clicked: ${JSON.stringify(clicked)}, rootKids: document.querySelector("#root")?.childElementCount ?? -1, bodyText: (document.body.textContent || "").slice(0, 200), dockBtns: [...document.querySelectorAll(".tv-dock button")].map((b) => b.getAttribute("aria-label")) })`,
    );
    throw new Error(
      `toy box cards: ${diag} exceptions: ${cdp.exceptions.slice(0, 2).join(" | ")}`,
    );
  }
}

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass: Boolean(pass), detail: String(detail ?? "") });
}

async function scenarioFresh(cdp) {
  await gotoApp(cdp);
  check(
    "no-iframe",
    await cdp.evaluate(`document.querySelector("iframe") === null`),
    "stage renders without an iframe",
  );
  const dock = await cdp.evaluate(
    `(() => { const d = document.querySelector(".tv-dock"); return d ? { sw: d.scrollWidth, cw: d.clientWidth } : null; })()`,
  );
  check(
    "dock-single-row",
    !!dock && dock.sw <= dock.cw + 1,
    dock ? `scrollWidth ${dock.sw} vs clientWidth ${dock.cw}` : "no dock",
  );
  await openToyBox(cdp);
  const locked = await cdp.evaluate(
    `[...document.querySelectorAll(".tv-roster-card-lock")].map((el) => el.getAttribute("aria-label") || "")`,
  );
  // Deliberately >= rather than ===: the count mirrors however many audit
  // entries are ready with a seed toy, which the CAD session edits. The
  // name checks below pin these three without pinning the total.
  check("locked-at-least-3", locked.length >= 3, `locked=${locked.length}`);
  for (const name of ["Hauler Truck", "Motor Scooter", "Sport Motorbike"]) {
    check(
      `locked-has-${name}`,
      locked.some((label) => label.includes(name)),
      label0(locked),
    );
  }
  const ctas = await cdp.evaluate(
    `[...document.querySelectorAll(".tv-roster-card-lock button")].map((b) => b.textContent || "")`,
  );
  check(
    "locked-ctas",
    ctas.length === locked.length &&
      ctas.every((t) => t.includes("Play a STEM Lab")),
    ctas.join("|"),
  );
  const noScout = await cdp.evaluate(
    `!document.body.textContent?.includes("Star Scout") || undefined`,
  );
  check("no-star-scout-fresh", noScout !== false, "seed figure stays out");
  const questCards = await cdp.evaluate(
    `document.querySelectorAll(".tv-quest-card").length`,
  );
  check(
    "daily-quest-board-3",
    questCards === 3,
    `questCards=${questCards}`,
  );
}

async function scenarioXp600(cdp) {
  await gotoApp(cdp, { totalXp: 600 });
  await openToyBox(cdp);
  const locked = await cdp.evaluate(
    `[...document.querySelectorAll(".tv-roster-card-lock")].map((el) => el.getAttribute("aria-label") || "")`,
  );
  // Ranks 4 to 6 are still locked at 600 XP: Prop Aeroplane, Catamaran Boat, Rescue Helicopter, Space Shuttle and (Phase 4
  // promoted it to ready) the Rank 6 Bolt Power Pro. This was `=== 4` before the Rank 6 vehicle shipped.
  check("promote-at-600", locked.length === 5, `locked=${locked.length}`);
  const body = await cdp.evaluate(`document.body.textContent || ""`);
  check(
    "motorbike-selectable",
    body.includes("Sport Motorbike") && body.includes("Loader Tractor & Trailer"),
    "Rank 3 vehicles present",
  );
}

async function scenarioXp1800(cdp) {
  await gotoApp(cdp, { totalXp: 1800 });
  await openToyBox(cdp);
  const locked = await cdp.evaluate(
    `[...document.querySelectorAll(".tv-roster-card-lock")].map((el) => el.getAttribute("aria-label") || "")`,
  );
  // At 1800 XP only the Rank 6 vehicle is still locked (tests/phase4-readiness.test.ts pins lockedVehicles = ["seed-mech"]).
  check("promote-at-1800", locked.length === 1, `locked=${locked.length}`);
  const body = await cdp.evaluate(`document.body.textContent || ""`);
  check(
    "rank5-craft-selectable",
    body.includes("Rescue Helicopter") &&
      body.includes("Space Shuttle") &&
      !locked.some((l) => l.includes("Rescue Helicopter") || l.includes("Space Shuttle")) &&
      locked.some((l) => l.includes("Bolt Power Pro")),
    "Rank 5 craft unlocked, Rank 6 Bolt Power Pro still locked",
  );
}

function label0(locked) {
  return locked.length > 0 ? locked[0].slice(0, 80) : "none";
}

async function main() {
  const root = new URL("..", import.meta.url).pathname;
  rmSync(PROFILE, { recursive: true, force: true });
  const dev = spawn("npm", ["run", "dev", "--", "--port", String(DEV_PORT)], {
    cwd: root,
    stdio: "ignore",
  });
  const chrome = spawn(
    CHROME,
    [
      "--headless",
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
  const runScenario = async (name, fn) => {
    const page = await openPage();
    try {
      await fn(page);
      // Named honestly: this subscribes only to Runtime.exceptionThrown, so
      // it sees uncaught exceptions — not console.error output, swallowed
      // error-boundary catches, or failed network requests.
      check(
        `no-uncaught-exception-${name}`,
        page.exceptions.length === 0,
        page.exceptions.slice(0, 3).join(" | "),
      );
    } catch (err) {
      check(`scenario-${name}`, false, String((err && err.message) || err));
    } finally {
      page.close();
    }
  };
  try {
    await waitHttpOk(APP_URL);
    await runScenario("fresh", scenarioFresh);
    await runScenario("xp600", scenarioXp600);
    await runScenario("xp1800", scenarioXp1800);
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
