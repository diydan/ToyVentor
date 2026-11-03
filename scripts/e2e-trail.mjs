#!/usr/bin/env node
// Explorer trail map (docs/specs/explorer-map-spec.md): headless-Chrome checks
// at 390x844. Own dev server + own Chrome profile, so it never touches a dev
// server another session is running. Exits nonzero on any failing check.
// Run: npm run e2e:trail
// Overrides: E2E_CHROME (binary), E2E_PORT, E2E_DEBUG_PORT, E2E_PROFILE,
//            E2E_SHOTS (dir; when set, saves trail-map screenshots),
//            E2E_ONLY (comma-separated scenario names, e.g. garage-weekend).
//
// Guards, in the real React overlay (unit tests cannot see these):
//   - which view the Map opens in by age (carousel for 2-6 and unset, trail
//     map from the 7-9 band up) and that each is one tap from the other;
//   - the trail map is full screen and covers the dock;
//   - travel is two-step: tap a place and the toy hops there (HUD names it),
//     tap it again or press the big button to go in; arrow keys walk the roads;
//   - fog is drawing only: clouded places stay enabled buttons;
//   - a frontier go that cannot start keeps the map open, shows a notice and
//     records no visit; once it can start it closes, plays the seed, records it;
//   - the rung sheet opens over the map without losing the map's scroll;
//   - the map remembers what it showed: the first open animates nothing,
//     what is new on a later open animates (clouds part, roads draw in,
//     places pop in) and is not replayed on the open after that;
//   - walking a generated path grows its branch (two more appear beyond it);
//   - difficulty by depth: a 4th path is labelled Tricky and plays with its
//     stations at tier 2;
//   - the toy's token is a picture of the toy as it is dressed now, rendered
//     from the live 3D rig, kept per outfit, and different after the child
//     changes the outfit (built-in toys; scanned toys keep their own icon);
//   - the map's look follows the time of day: pinned Day and Night, and Auto
//     reading the device clock (every other scenario pins Day, so results do
//     not depend on when the suite runs); night is the same scene with the
//     lights on, not a different map;
//   - a secret exit stays hidden until a world's hidden parts are all found,
//     then opens (with a notice and the reveal animation) and plays a bonus
//     level at the hardest tier the age is offered;
//   - the Garage (docs/specs/garage-weekend-spec.md), on a pinned weekday and a
//     pinned Saturday: always on the trail map and the carousel; lit and NEW
//     only on a weekend until the drop is done; the sheet is written for the
//     age; Start opens Build with a goal chip that ticks as the toy changes;
//     finishing pays XP once, stamps a Workshop Day, remembers the weekend and
//     credits the STEM mission to the parent ledger; a replay pays nothing;
//     the weekend's loaner part is wearable on a weekend and not on a weekday;
//     Demo Mode's Preview weekend runs the flow and saves nothing;
//   - layout measured in the DOM: tap targets, node-on-road alignment, no
//     overlapping nodes, the toy in view;
//   - no uncaught exception in any scenario.
// A road passing under a node it skips, and scenery on a road, are pure
// geometry and live in tests/explorer-map.test.ts and tests/explorer-art.test.ts.
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

/** Load the app with a seeded save in place before any app code runs.
 *  `fresh` first wipes everything else on the device (the toy, the game save,
 *  kept portraits), because scenarios share one Chrome profile and an earlier
 *  one (sandbox unlocks vehicles) can leave a different toy selected. */
// The page's clock, pinned (it still ticks): a Wednesday and a Saturday at noon UTC.
// Pinned so the Garage's weekend state never depends on the day the suite runs.
const CLOCKS = { weekday: Date.UTC(2026, 10, 4, 12), weekend: Date.UTC(2026, 10, 7, 12) };
const clockShim = (ms) =>
  `(()=>{const R=Date,t0=R.now(),now=()=>${ms}+(R.now()-t0);class D extends R{constructor(...a){a.length?super(...a):super(now())}static now(){return now()}}Date=D;})();`;

async function loadApp(cdp, seed, { fresh = false, tod = "day", clock = "weekday", extra = {} } = {}) {
  // `tod` pins the map's look (day, night or auto); day by default so the other
  // scenarios do not depend on the hour the suite runs at. `clock` pins the date
  // ("weekday" by default, "weekend", or null for the real clock); `extra` is more
  // localStorage to set before the app runs.
  const extras = Object.entries(extra)
    .map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`)
    .join("");
  const { identifier } = await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `${clock ? clockShim(CLOCKS[clock]) : ""}${fresh ? "try{localStorage.clear();}catch(e){}" : ""}try{localStorage.setItem(${JSON.stringify(STORAGE_KEY)},${JSON.stringify(JSON.stringify(seed))});localStorage.setItem("tvTimeOfDay:v1",${JSON.stringify(tod)});${extras}}catch(e){}`,
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

/** Dock ⋯ -> Map. Opens in the view that suits the saved age. */
async function openMap(cdp) {
  await cdp.evaluate(
    `(()=>{const b=[...document.querySelectorAll(".tv-dock-right button")].find(x=>(x.textContent||"").includes("⋯"));b&&b.click()})()`,
  );
  await waitFor(() => cdp.evaluate(`!!document.querySelector(".tv-more-menu")`), { label: "more menu" });
  await clickButton(cdp, ".tv-more-menu [role=menuitem]", "Map");
  await waitFor(() => cdp.evaluate(`!!document.querySelector(".tv-sheet-map, .tv-trail-full")`), { label: "map" });
  await sleep(400);
}

const hasTrail = (cdp) => cdp.evaluate(`!!document.querySelector(".tv-trail-full")`);
const hasCarousel = (cdp) => cdp.evaluate(`!!document.querySelector(".tv-sheet-map")`);

/** Open the Map and make sure it is the trail map. */
async function openTrail(cdp) {
  await openMap(cdp);
  if (!(await hasTrail(cdp))) {
    await clickButton(cdp, ".tv-sheet-map button", "Trail map");
    await waitFor(() => hasTrail(cdp), { label: "trail view" });
    await sleep(400);
  }
}

/** Wait for the toy to be standing on a place, hop finished. */
const waitKipAt = (cdp, id) =>
  waitFor(
    () =>
      cdp.evaluate(
        `(()=>{const s=document.querySelector(".tv-trail-full");return !!s&&s.dataset.kipAt===${JSON.stringify(id)}&&s.dataset.moving==="0"})()`,
      ),
    { timeoutMs: 20000, label: `toy at ${id}` },
  );

const tapNode = (cdp, id) =>
  cdp.evaluate(`(()=>{const b=document.querySelector('[data-node-id="${id}"]');if(!b)return false;b.click();return true})()`);

const clickPlay = (cdp) => cdp.evaluate(`document.querySelector(".tv-trail-play")?.click()`);

const visited = (cdp) =>
  cdp.evaluate(
    `(()=>{try{return JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)})||"{}").explorerVisited||[]}catch(e){return null}})()`,
  );

const seenOf = (cdp) =>
  cdp.evaluate(
    `(()=>{try{return JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)})||"{}").explorerSeen||null}catch(e){return null}})()`,
  );

const animCount = (cdp) =>
  cdp.evaluate(`document.querySelectorAll(".tv-trail-node-new,.tv-trail-draw,.tv-trail-fade,.tv-trail-open").length`);

// Age 3-4: the carousel opens first; the trail map is one tap away and back.
async function scenarioYoung(cdp) {
  await loadApp(cdp, { version: 1, totalXp: 0, ageBand: 1 });
  await openMap(cdp);
  check("age 3-4: Map opens as the carousel", (await hasCarousel(cdp)) && !(await hasTrail(cdp)));
  await clickButton(cdp, ".tv-sheet-map button", "Trail map");
  await waitFor(() => hasTrail(cdp), { label: "trail view" });
  check("age 3-4: Trail map button opens the trail map", (await hasTrail(cdp)) && !(await hasCarousel(cdp)));
  await clickButton(cdp, ".tv-trail-hud button", "Cards");
  await waitFor(() => hasCarousel(cdp), { label: "carousel back" });
  check("age 3-4: Cards button returns to the carousel", !(await hasTrail(cdp)));
  // Closing and reopening starts from the age's default again, not the last view.
  await clickButton(cdp, ".tv-sheet-map button", "Trail map");
  await waitFor(() => hasTrail(cdp), { label: "trail again" });
  await clickButton(cdp, ".tv-trail-hud button", "Home");
  await sleep(300);
  await openMap(cdp);
  check("age 3-4: reopening the Map starts on the carousel again", (await hasCarousel(cdp)) && !(await hasTrail(cdp)));
}

// Age 7-9 fresh save: trail map by default, full screen, fog, two-step travel.
async function scenarioOlder(cdp) {
  await loadApp(cdp, { version: 1, totalXp: 0, ageBand: 3 });
  await openMap(cdp);
  check("age 7-9: Map opens as the trail map", (await hasTrail(cdp)) && !(await hasCarousel(cdp)));

  // Full screen, over the dock.
  const fs = await cdp.evaluate(
    `(()=>{const r=document.querySelector(".tv-trail-full").getBoundingClientRect();const d=document.querySelector(".tv-dock").getBoundingClientRect();const el=document.elementFromPoint(d.x+d.width/2,d.y+d.height/2);return {x:r.x,y:r.y,w:r.width,h:r.height,vw:innerWidth,vh:innerHeight,overDock:!!el?.closest(".tv-trail-full")}})()`,
  );
  check(
    "trail map fills the whole screen",
    fs.x === 0 && fs.y === 0 && fs.w === fs.vw && fs.h === fs.vh,
    JSON.stringify(fs),
  );
  check("trail map covers the dock", fs.overDock === true);

  // Fog is drawing only.
  const fog = await cdp.evaluate(
    `(()=>{const m={};for(const b of document.querySelectorAll("[data-node-id]")){m[b.dataset.nodeId]={cls:b.className,disabled:b.disabled}}return m})()`,
  );
  const has = (id, c) => fog[id]?.cls.includes(`tv-trail-node-${c}`);
  check("fog: Toy Room is revealed", has("room", "revealed"));
  check("fog: a far world is clouded", has("snow", "clouded"));
  check("fog: a neighbour of home is a silhouette", has("daily", "next"));
  check(
    "fog never locks: every place is an enabled button",
    Object.values(fog).length > 20 && Object.values(fog).every((n) => n.disabled === false),
  );

  // The toy starts on the world you are in, in view.
  const start = await cdp.evaluate(`document.querySelector(".tv-trail-full").dataset.kipAt`);
  check("the toy starts on the current world", start === "garden", start);
  const inView = await cdp.evaluate(
    `(()=>{const k=document.querySelector(".tv-trail-kip").getBoundingClientRect();const v=document.querySelector(".tv-trail-scroll").getBoundingClientRect();return k.x>=v.x&&k.x<=v.x+v.width&&k.y>=v.y&&k.y<=v.y+v.height})()`,
  );
  check("the toy is in view when the map opens", inView === true);

  // Two-step travel: first tap hops, the plate names the place, nothing is entered.
  await tapNode(cdp, "beach");
  const hopping = await cdp.evaluate(`document.querySelector(".tv-trail-full").dataset.moving`);
  await waitKipAt(cdp, "beach");
  const plate = await cdp.evaluate(`document.querySelector(".tv-trail-plate-title")?.textContent||""`);
  check("first tap hops the toy (map stays open)", hopping === "1" && (await hasTrail(cdp)));
  check("the name plate names the place the toy stands on", plate === "Beach", plate);
  check("play button is the way in (Go! for a world)", (await cdp.evaluate(`document.querySelector(".tv-trail-play")?.textContent`)) === "Go!");

  // Arrow keys walk the roads like a d-pad.
  await cdp.evaluate(`document.querySelector('[data-node-id="room"]').focus()`);
  const key = async (k, expect) => {
    await cdp.evaluate(
      `document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:${JSON.stringify(k)},bubbles:true}))`,
    );
    await waitKipAt(cdp, expect).catch(() => {});
    return cdp.evaluate(`document.querySelector(".tv-trail-full").dataset.kipAt`);
  };
  await tapNode(cdp, "room");
  await waitKipAt(cdp, "room");
  check("arrow right from Toy Room walks to Junkyard", (await key("ArrowRight", "junk")) === "junk");
  check("arrow left from Junkyard walks back to Toy Room", (await key("ArrowLeft", "room")) === "room");
  check("arrow up from Toy Room walks to Sky Meadow", (await key("ArrowUp", "sky")) === "sky");

  // Layout, measured in the DOM.
  const m = await cdp.evaluate(`(()=>{
    const canvas = document.querySelector(".tv-trail-canvas").getBoundingClientRect();
    return [...document.querySelectorAll(".tv-trail-node")].map((b) => {
      const r = b.getBoundingClientRect();
      return { id: b.dataset.nodeId, w: r.width, h: r.height,
        cx: r.x + r.width / 2 - canvas.x, cy: r.y + r.height / 2 - canvas.y,
        px: parseFloat(b.style.left), py: parseFloat(b.style.top) };
    });
  })()`);
  check("layout: measured every place", m.length >= 25, `${m.length} places`);
  check("layout: every tap target is at least 56px", m.every((n) => n.w >= 56 && n.h >= 56), `${Math.min(...m.map((n) => Math.min(n.w, n.h)))}px`);
  const off = m.filter((n) => Math.hypot(n.cx - n.px, n.cy - n.py) > 2);
  check("layout: each place is centred on the point its roads end at", off.length === 0, off.slice(0, 3).map((n) => n.id).join(", "));
  const touching = [];
  for (let i = 0; i < m.length; i++) {
    for (let j = i + 1; j < m.length; j++) {
      if (Math.abs(m[i].cx - m[j].cx) < 56 && Math.abs(m[i].cy - m[j].cy) < 56) touching.push(`${m[i].id}/${m[j].id}`);
    }
  }
  check("layout: no two places overlap", touching.length === 0, touching.slice(0, 4).join(", "));

  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(path.join(SHOTS, "trail-map.png"), Buffer.from(shot.data, "base64"));
  }

  // Cards <-> Trail map from the trail side.
  await clickButton(cdp, ".tv-trail-hud button", "Cards");
  await waitFor(() => hasCarousel(cdp), { label: "carousel" });
  check("Cards button swaps to the carousel", !(await hasTrail(cdp)));
  await clickButton(cdp, ".tv-sheet-map button", "Trail map");
  await waitFor(() => hasTrail(cdp), { label: "trail" });
  check("Trail map button swaps back", !(await hasCarousel(cdp)));
}

// Sandbox-open so the Bridges ladder offers several rungs (opens the RungSheet).
async function scenarioPlay(cdp) {
  await loadApp(cdp, { version: 1, totalXp: 0, ageBand: 3, sandboxUnlockAll: true });
  await openTrail(cdp);

  // The rung sheet opens over the map; the map keeps its scroll.
  await tapNode(cdp, "bridges");
  await waitKipAt(cdp, "bridges");
  const before = await cdp.evaluate(
    `(()=>{const s=document.querySelector(".tv-trail-scroll");return {l:s.scrollLeft,t:s.scrollTop,scrollable:s.scrollWidth>s.clientWidth}})()`,
  );
  check("map scrolls (rung-sheet test is meaningful)", before.scrollable && before.l > 0, JSON.stringify(before));
  await clickPlay(cdp);
  const sheet = await waitFor(() => cdp.evaluate(`!!document.querySelector(".tv-trail-full .tv-rung-list")`), {
    timeoutMs: 5000,
    label: "rung sheet",
  }).catch(() => false);
  check("Play on Bridges opens the rung sheet over the map", sheet === true);
  if (sheet) {
    const sheetTop = await cdp.evaluate(
      `(()=>{const r=document.querySelector(".tv-trail-full .tv-sheet-rungs").getBoundingClientRect();const el=document.elementFromPoint(r.x+r.width/2,r.y+20);return !!el?.closest(".tv-sheet-rungs")})()`,
    );
    check("the rung sheet is on top of the map, not hidden behind it", sheetTop === true);
    await clickButton(cdp, ".tv-sheet-rungs .tv-ctl", "");
    await sleep(300);
    const after = await cdp.evaluate(
      `(()=>{const s=document.querySelector(".tv-trail-scroll");return {l:s.scrollLeft,t:s.scrollTop}})()`,
    );
    check(
      "closing the rung sheet leaves the map where it was",
      Math.abs(after.l - before.l) <= 1 && Math.abs(after.t - before.t) <= 1,
      `before ${before.l},${before.t} after ${after.l},${after.t}`,
    );
  }

  // Frontier go that cannot start, then one that can.
  const hasHandle = (await cdp.evaluate(`typeof window.__tvWorld`)) === "object";
  check("dev handle window.__tvWorld present", hasHandle);
  if (!hasHandle) return;
  const node = "frontier:lab3:2";
  await tapNode(cdp, node);
  await waitKipAt(cdp, node);
  await cdp.evaluate(`window.__tvWorld.P.busy = true`);
  await clickPlay(cdp);
  await sleep(400);
  const notice = await cdp.evaluate(`document.querySelector(".tv-trail-notice")?.textContent||""`);
  const v1 = await visited(cdp);
  check("busy frontier go: map stays open", await hasTrail(cdp));
  check("busy frontier go: notice shown", /can't start/i.test(notice), JSON.stringify(notice));
  check("busy frontier go: no visit recorded", Array.isArray(v1) && !v1.includes(node), JSON.stringify(v1));

  await cdp.evaluate(`window.__tvWorld.P.busy = false`);
  await clickPlay(cdp);
  await sleep(1200);
  const world = await cdp.evaluate(`String(window.__tvWorld.handle?.S?.world ?? "?")`);
  const v2 = await visited(cdp);
  check("ready frontier go: map closes", !(await hasTrail(cdp)));
  check("ready frontier go: seeded level is the current world", world.startsWith("seed-"), world);
  check("ready frontier go: visit recorded", Array.isArray(v2) && v2.includes(node), JSON.stringify(v2));

  // Walking a generated path grows its branch: two more beyond the one walked.
  await openTrail(cdp);
  const ids = await cdp.evaluate(
    `[...document.querySelectorAll('[data-node-id^="frontier:lab3:"]')].map((b) => b.dataset.nodeId)`,
  );
  check(
    "walking path 2 grew the branch: paths 3 and 4 appear, 5 does not",
    ids.includes("frontier:lab3:3") && ids.includes("frontier:lab3:4") && !ids.includes("frontier:lab3:5"),
    JSON.stringify(ids),
  );

  // Difficulty by depth: the 4th path is Tricky and plays at tier 2 (path 2 was Easy).
  await tapNode(cdp, "frontier:lab3:4");
  await waitKipAt(cdp, "frontier:lab3:4");
  const kicker = await cdp.evaluate(`document.querySelector(".tv-trail-plate-kicker")?.textContent||""`);
  check("the 4th path is labelled Tricky", /Tricky/.test(kicker), kicker);
  await clickPlay(cdp);
  await sleep(1500);
  const lvl = await levelTiers(cdp);
  check("the 4th path starts its stations at tier 2", lvl.world.startsWith("seed-") && lvl.tiers.length > 0 && lvl.tiers.every((t) => t === 2), JSON.stringify(lvl));
}

/** The seeded level now playing, and the tier each of its stations starts at. */
const levelTiers = (cdp) =>
  cdp.evaluate(`(()=>{const S=window.__tvWorld.handle.S;const w=String(S.world);return {world:w,tiers:Object.entries(S.ms||{}).filter(([k])=>k.startsWith(w+".")).map(([,v])=>v&&v.tier)}})()`);

// Garden's five hidden parts (catalog LEVELS garden spots); the map reads them from the save.
const GARDEN_PARTS = ["character.hat.flower", "character.ears.antennae", "character.back.cape", "vehicle.front.lightbar", "vehicle.shell.bubble"];

// The toy's token on the map: a studio picture of the toy as dressed now.
async function scenarioPortrait(cdp) {
  await loadApp(cdp, { version: 1, totalXp: 0, ageBand: 3 }, { fresh: true });
  const hasHandle = (await cdp.evaluate(`typeof window.__tvWorld`)) === "object";
  check("dev handle window.__tvWorld present", hasHandle);
  if (!hasHandle) return;
  const sigNow = () => cdp.evaluate(`window.__tvWorld.handle.portraitSig()`);
  // The rig loads its wardrobe parts first; until then there is no picture to take.
  const sigA = await waitFor(sigNow, { timeoutMs: 20000, label: "rig ready" }).catch(() => null);
  check("the toy's parts load and a portrait signature appears", typeof sigA === "string" && sigA.length > 0, String(sigA));

  const tokenSrc = () => cdp.evaluate(`document.querySelector(".tv-trail-kip img")?.src||""`);
  await openTrail(cdp);
  const a = await tokenSrc();
  check("the token is an image taken from the toy (a PNG data URL)", /^data:image\/png;base64,/.test(a), a.slice(0, 40));

  // Not blank, not just the backdrop: a good share of its pixels differ from the corner colour.
  const ink = await cdp.evaluate(`new Promise((res)=>{const i=new Image();i.onload=()=>{const c=document.createElement("canvas");c.width=i.naturalWidth;c.height=i.naturalHeight;const x=c.getContext("2d");x.drawImage(i,0,0);const d=x.getImageData(0,0,c.width,c.height).data;const r=d[0],g=d[1],b=d[2];let n=0;for(let k=0;k<d.length;k+=4)if(Math.abs(d[k]-r)+Math.abs(d[k+1]-g)+Math.abs(d[k+2]-b)>40)n++;res({w:c.width,h:c.height,share:n/(d.length/4)})};i.onerror=()=>res(null);i.src=${JSON.stringify(a)}})`);
  check("the picture is square and the toy fills a fair share of it", ink && ink.w === ink.h && ink.share > 0.25 && ink.share < 0.95, JSON.stringify(ink));

  // Kept on the device, per toy, against the outfit it was taken for.
  const kept = await cdp.evaluate(`(()=>{try{const v=JSON.parse(localStorage.getItem("tvToyPortrait:v1:seed-kip")||"null");return v?{sig:v.sig,same:v.url===document.querySelector(".tv-trail-kip img")?.src}:null}catch(e){return null}})()`);
  check("it is kept on the device against the outfit's signature", kept && kept.sig === sigA && kept.same === true, JSON.stringify(kept));

  // Same outfit, opened again: the kept picture is reused (identical bytes), not retaken.
  await clickButton(cdp, ".tv-trail-hud button", "Home");
  await sleep(400);
  await openTrail(cdp);
  check("opening the map again with the same outfit reuses it", (await tokenSrc()) === a);

  // A new outfit: new signature, and a new picture on the map.
  await clickButton(cdp, ".tv-trail-hud button", "Home");
  await sleep(400);
  await cdp.evaluate(`(()=>{const h=window.__tvWorld.handle;h.cuSlot("ears");h.cuPart("bunny")})()`);
  await sleep(300);
  const sigB = await waitFor(async () => {
    const v = await sigNow();
    return v && v !== sigA ? v : null;
  }, { timeoutMs: 20000, label: "new outfit ready" }).catch(() => null);
  check("changing the outfit changes the signature", typeof sigB === "string" && sigB !== sigA, `${sigA} -> ${sigB}`);
  await openTrail(cdp);
  const b = await tokenSrc();
  check("the map now shows the new outfit (a different picture)", /^data:image\/png/.test(b) && b !== a, `${a.length} -> ${b.length}`);
  const kept2 = await cdp.evaluate(`(()=>{try{return JSON.parse(localStorage.getItem("tvToyPortrait:v1:seed-kip")||"null")?.sig||null}catch(e){return null}})()`);
  check("only the newest outfit is kept for the toy", kept2 === sigB, String(kept2));
}

// The map's look: day, night (same scene, lights on), and Auto from the clock.
async function scenarioTimeOfDay(cdp) {
  const look = () =>
    cdp.evaluate(`(()=>{
      const f = document.querySelector(".tv-trail-full");
      return {
        tod: f?.dataset.tod || null,
        night: f?.classList.contains("tv-trail-night") === true,
        veil: !!document.querySelector(".tv-trail-nightfall"),
        glows: document.querySelectorAll(".tv-trail-nightfall circle").length,
        flies: document.querySelectorAll(".tv-trail-firefly").length,
        lit: document.querySelectorAll('.tv-trail-node svg[data-lit="1"]').length,
        places: document.querySelectorAll(".tv-trail-node").length,
      };
    })()`);

  // Day: no veil, no lights.
  await loadApp(cdp, { version: 1, totalXp: 0, ageBand: 3 }, { tod: "day" });
  await openTrail(cdp);
  const day = await look();
  check("pinned Day: the day look, no night veil or lights", day.tod === "day" && !day.night && !day.veil && day.glows === 0 && day.flies === 0 && day.lit === 0, JSON.stringify(day));

  // Night: the same scene (same places), veil on, lights on.
  await loadApp(cdp, { version: 1, totalXp: 0, ageBand: 3 }, { tod: "night" });
  await openTrail(cdp);
  const night = await look();
  check("pinned Night: the night look", night.tod === "night" && night.night && night.veil, JSON.stringify(night));
  check("night has its lights on: lamp glows, fireflies and lit windows", night.glows > 0 && night.flies > 0 && night.lit > 0, JSON.stringify(night));
  check("night is the same map: the same places, none added or lost", night.places === day.places, `${day.places} / ${night.places}`);
  const tap = await cdp.evaluate(`Math.min(...[...document.querySelectorAll(".tv-trail-node")].map((b)=>Math.min(b.getBoundingClientRect().width,b.getBoundingClientRect().height)))`);
  check("night keeps the tap targets at least 56px", tap >= 56, `${tap}px`);
  // The toy still hops and the plate still names the place, in the dark.
  await tapNode(cdp, "beach");
  await waitKipAt(cdp, "beach");
  check("at night the toy still hops and the plate names the place", (await cdp.evaluate(`document.querySelector(".tv-trail-plate-title")?.textContent||""`)) === "Beach");
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(path.join(SHOTS, "trail-night.png"), Buffer.from(shot.data, "base64"));
  }

  // Auto follows the device clock: day from 7:00 to 18:59, night otherwise.
  await loadApp(cdp, { version: 1, totalXp: 0, ageBand: 3 }, { tod: "auto", clock: null });
  const hour = await cdp.evaluate(`new Date().getHours()`);
  await openTrail(cdp);
  const auto = await look();
  const expect = hour >= 7 && hour < 19 ? "day" : "night";
  check("Auto follows the clock", auto.tod === expect, `hour ${hour} -> ${auto.tod} (expected ${expect})`);
}

// A secret exit: hidden, then opens when a world is complete, then plays a bonus level.
async function scenarioSecret(cdp) {
  await loadApp(cdp, { version: 1, totalXp: 0, ageBand: 3 });
  await openMap(cdp); // records what is shown (no secret yet)
  const secretIds = () =>
    cdp.evaluate(`[...document.querySelectorAll('[data-node-id^="secret:"]')].map((b) => b.dataset.nodeId)`);
  check("secret exits are hidden until a world is complete", (await secretIds()).length === 0, JSON.stringify({ ids: await secretIds(), sandbox: (await progOf(cdp))?.sandboxUnlockAll }));
  await clickButton(cdp, ".tv-trail-hud button", "Home");
  await sleep(300);

  // Find every hidden part in the Garden. The engine reports the save when the
  // game notifies it (a world change does), not on a timer, so nudge it.
  const hasHandle = (await cdp.evaluate(`typeof window.__tvWorld`)) === "object";
  check("dev handle window.__tvWorld present", hasHandle);
  if (!hasHandle) return;
  await cdp.evaluate(`(()=>{const h=window.__tvWorld.handle;for(const k of ${JSON.stringify(GARDEN_PARTS)})h.S.found[k]=true;h.go("room")})()`);
  await sleep(1800);
  await openMap(cdp);
  const ids = await secretIds();
  check("finishing the Garden opens its secret exit, and only that one", ids.length === 1 && ids[0] === "secret:garden", JSON.stringify(ids));
  const notice = await cdp.evaluate(`document.querySelector(".tv-trail-notice")?.textContent||""`);
  check("the map says a secret exit opened", /secret exit opened near Garden/i.test(notice), JSON.stringify(notice));
  check(
    "the new exit animates in like anything else that is new",
    await cdp.evaluate(`document.querySelector('[data-node-id="secret:garden"]')?.classList.contains("tv-trail-node-new")===true`),
  );
  await sleep(2600);

  await tapNode(cdp, "secret:garden");
  await waitKipAt(cdp, "secret:garden");
  const kicker = await cdp.evaluate(`document.querySelector(".tv-trail-plate-kicker")?.textContent||""`);
  const title = await cdp.evaluate(`document.querySelector(".tv-trail-plate-title")?.textContent||""`);
  check("the plate calls it a Secret exit, a Hard bonus level", title === "Secret exit" && /Bonus level/.test(kicker) && /Hard/.test(kicker), `${title} / ${kicker}`);
  await clickPlay(cdp);
  await sleep(1500);
  const lvl = await levelTiers(cdp);
  check("the secret exit plays a seeded level", lvl.world.startsWith("seed-"), lvl.world);
  check("its stations start at tier 3 (the hardest this age is offered)", lvl.tiers.length > 0 && lvl.tiers.every((t) => t === 3), JSON.stringify(lvl.tiers));
  check("walking it is recorded", (await visited(cdp)).includes("secret:garden"));
}

// What is new animates once: first open records, later open reveals, then quiet.
async function scenarioReveal(cdp) {
  await loadApp(cdp, { version: 1, totalXp: 0, ageBand: 3 });
  await openMap(cdp);
  const seen1 = await seenOf(cdp);
  check("first open: nothing animates (there is no record yet)", (await animCount(cdp)) === 0);
  check(
    "first open: the map records what it showed",
    Array.isArray(seen1) && seen1.includes("room") && seen1.includes("room#"),
    JSON.stringify((seen1 || []).slice(0, 6)),
  );

  // Walk to the beach and go in, then look at the map again.
  await tapNode(cdp, "beach");
  await waitKipAt(cdp, "beach");
  await clickPlay(cdp);
  await sleep(1200);
  check("went to the beach (the map closed)", !(await hasTrail(cdp)));
  const shot = async (name) => {
    if (!SHOTS) return;
    mkdirSync(SHOTS, { recursive: true });
    const r = await cdp.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(r.data, "base64"));
  };
  await openMap(cdp);

  // Early in the animation: new places are waiting to pop, a new road is part-drawn.
  const early = await cdp.evaluate(`(()=>{
    const fresh = [...document.querySelectorAll(".tv-trail-node-new")];
    const draw = [...document.querySelectorAll("svg .tv-trail-draw")];
    return {
      ids: fresh.map((b) => b.dataset.nodeId),
      waiting: fresh.filter((b) => parseFloat(getComputedStyle(b.querySelector("svg")).opacity) < 1).length,
      drawing: draw.filter((p) => Math.abs(parseFloat(getComputedStyle(p).strokeDashoffset)) > 0.001).length,
      fades: document.querySelectorAll("svg .tv-trail-fade").length,
      opens: document.querySelectorAll("svg .tv-trail-open").length,
    };
  })()`);
  check("reopened: the beach clears and its lab appears", early.ids.includes("beach") && early.ids.includes("lab3"), JSON.stringify(early.ids));
  check("reopened: new places are waiting to pop in", early.waiting > 0, `${early.waiting} waiting`);
  check("reopened: a new road is part-way through drawing", early.drawing > 0, `${early.drawing} drawing`);
  check("reopened: dotted roads fade in and the fog parts", early.fades > 0 && early.opens > 0, `fades ${early.fades}, opens ${early.opens}`);
  await shot("trail-reveal-1");
  await sleep(300);
  await shot("trail-reveal-2");
  await sleep(2300);
  await shot("trail-reveal-3");
  const done = await cdp.evaluate(`(()=>{
    const fresh = [...document.querySelectorAll(".tv-trail-node-new svg")];
    const draw = [...document.querySelectorAll("svg .tv-trail-draw")];
    return {
      shown: fresh.every((v) => getComputedStyle(v).opacity === "1"),
      drawn: draw.every((p) => Math.abs(parseFloat(getComputedStyle(p).strokeDashoffset)) < 0.001),
    };
  })()`);
  check("settled: every new place is fully shown and every new road fully drawn", done.shown && done.drawn, JSON.stringify(done));

  // Close and reopen: already seen, so nothing replays.
  await clickButton(cdp, ".tv-trail-hud button", "Home");
  await sleep(300);
  await openMap(cdp);
  check("the open after that replays nothing", (await animCount(cdp)) === 0);
}

const progOf = (cdp) =>
  cdp.evaluate(`(()=>{try{return JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)})||"{}")}catch(e){return null}})()`);
const ledgerIds = (cdp) =>
  cdp.evaluate(`(()=>{try{return JSON.parse(localStorage.getItem("toyforge:parent-time:v1")||"{}").ledger?.completedIds||[]}catch(e){return null}})()`);
const sheetText = (cdp, sel) => cdp.evaluate(`document.querySelector(${JSON.stringify(sel)})?.textContent||""`);
const shotNamed = async (cdp, name) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  const r = await cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(r.data, "base64"));
};
/** The part worn in a slot, read from the live toy. */
const worn = (cdp, slot) => cdp.evaluate(`window.__tvWorld.handle.buildSummary().sel[${JSON.stringify(slot)}]||null`);

// The Garage on an ordinary weekday: always there, not lit, the latest drop,
// free build works, and the weekend's loaner part is not wearable.
async function scenarioGarageWeekday(cdp) {
  await loadApp(cdp, { version: 1, totalXp: 0, ageBand: 3 }, { fresh: true });
  await openTrail(cdp);
  const g = await cdp.evaluate(`(()=>{const b=document.querySelector('[data-node-id="garage"]');if(!b)return null;const r=b.getBoundingClientRect();return {w:r.width,h:r.height,lit:!!b.querySelector('svg[data-lit="1"]')}})()`);
  check("weekday: the Garage is on the trail map, a big enough tap target", g && g.w >= 56 && g.h >= 56, JSON.stringify(g));
  check("weekday: its door is down (not lit, no drop waiting)", g && g.lit === false);
  await tapNode(cdp, "garage");
  await waitKipAt(cdp, "garage");
  check("weekday: the plate says Always open", (await sheetText(cdp, ".tv-trail-plate-kicker")) === "Always open" && (await sheetText(cdp, ".tv-trail-plate-title")) === "Garage");
  check("weekday: the way in is Build!", (await sheetText(cdp, ".tv-trail-play")) === "Build!");
  await clickPlay(cdp);
  await waitFor(() => cdp.evaluate(`!!document.querySelector(".tv-sheet-garage")`), { label: "garage sheet" });
  check("weekday: the sheet opens over the closed map", !(await hasTrail(cdp)));
  const tag = await sheetText(cdp, ".tv-garage-tag");
  check("weekday: it shows the latest drop and when the next arrives", /latest drop/i.test(tag) && /arrives on Friday/.test(await sheetText(cdp, ".tv-sheet-garage")), tag);
  // The pinned Wednesday is before the first launch weekend, so the latest drop is the
  // rotation's one before the first: the remix, in its 7-9 wording.
  check("weekday: the drop is written for the age (7-9)", (await sheetText(cdp, ".tv-garage-title")) === "Remix with a twist", await sheetText(cdp, ".tv-garage-title"));
  await shotNamed(cdp, "garage-weekday-sheet");

  // The loaner is a weekend thing: on a weekday it cannot be worn.
  await cdp.evaluate(`(()=>{const h=window.__tvWorld.handle;h.cuSlot("hat");h.cuPart("crown")})()`);
  await sleep(300);
  check("weekday: the weekend's loaner part cannot be worn", (await worn(cdp, "hat")) !== "crown", String(await worn(cdp, "hat")));

  // Free build: Build opens, no goal chip.
  await clickButton(cdp, ".tv-sheet-garage button", "Free build");
  await waitFor(() => cdp.evaluate(`!!document.querySelector('[aria-label="Build your toy"]')`), { label: "build sheet" });
  check("weekday: Free build opens Build with no goal chip", !(await cdp.evaluate(`!!document.querySelector(".tv-garage-chip")`)));
}

// The carousel, age 3-4, on a weekday: the Garage is a card, not NEW.
async function scenarioGarageCarousel(cdp) {
  await loadApp(cdp, { version: 1, totalXp: 0, ageBand: 1 }, { fresh: true });
  await openMap(cdp);
  const card = await cdp.evaluate(`(()=>{const li=document.querySelector('.tv-map-card[data-id="garage"]');return li?{hot:li.classList.contains("tv-map-card-hot"),badge:!!li.querySelector(".tv-map-new")}:null})()`);
  check("carousel, weekday: the Garage is a card and not marked NEW", card && card.hot === false && card.badge === false, JSON.stringify(card) + " ids " + (await cdp.evaluate(`[...document.querySelectorAll(".tv-map-card")].map(l=>l.dataset.id).join(",")`)));
  await cdp.evaluate(`document.querySelector('.tv-map-card[data-id="garage"] .tv-map-card-btn').click()`);
  await waitFor(() => cdp.evaluate(`!!document.querySelector(".tv-sheet-garage")`), { label: "garage sheet" });
  check("carousel: the card opens the Garage, written for age 3-4", (await sheetText(cdp, ".tv-garage-title")) === "Change one thing!", await sheetText(cdp, ".tv-garage-title"));

  // Weekend: the same card is NEW and first.
  await loadApp(cdp, { version: 1, totalXp: 0, ageBand: 1 }, { fresh: true, clock: "weekend" });
  await openMap(cdp);
  const hot = await cdp.evaluate(`(()=>{const li=document.querySelector(".tv-map-card");return {id:li?.dataset.id,hot:li?.classList.contains("tv-map-card-hot"),badge:li?.querySelector(".tv-map-new")?.textContent||""}})()`);
  check("carousel, weekend: the Garage comes first, marked NEW", hot.id === "garage" && hot.hot && hot.badge === "NEW", JSON.stringify(hot));
  await shotNamed(cdp, "garage-weekend-carousel");
}

// A whole weekend mission on the trail map: lit door, sheet, Start, goal chip, finish, pay once, replay free.
async function scenarioGarageWeekend(cdp) {
  await loadApp(cdp, { version: 1, totalXp: 0, ageBand: 3 }, { fresh: true, clock: "weekend" });
  await openTrail(cdp);
  const lit = await cdp.evaluate(`!!document.querySelector('[data-node-id="garage"] svg[data-lit="1"]')`);
  check("weekend: the Garage door is up and lit, by day", lit === true);
  await tapNode(cdp, "garage");
  await waitKipAt(cdp, "garage");
  check("weekend: the plate says there is something new", (await sheetText(cdp, ".tv-trail-plate-kicker")) === "New this weekend");
  await shotNamed(cdp, "garage-weekend-trail");
  await clickPlay(cdp);
  await waitFor(() => cdp.evaluate(`!!document.querySelector(".tv-sheet-garage")`), { label: "garage sheet" });
  check("weekend: the sheet says New this weekend, a New part", (await sheetText(cdp, ".tv-garage-tag")) === "New this weekend" && (await sheetText(cdp, ".tv-garage-kind")) === "New part");
  await shotNamed(cdp, "garage-weekend-sheet");

  // Start: Build opens, the chip shows the goal, nothing is paid yet.
  const xp0 = (await progOf(cdp)).totalXp ?? 0;
  await clickButton(cdp, ".tv-sheet-garage button", "Start");
  await waitFor(() => cdp.evaluate(`!!document.querySelector('[aria-label="Build your toy"]')&&!!document.querySelector(".tv-garage-chip")`), { label: "build + chip" });
  const chip0 = await cdp.evaluate(`({title:document.querySelector(".tv-garage-chip-title")?.textContent,parts:[...document.querySelectorAll(".tv-garage-chip-parts li")].map(l=>({t:l.textContent.trim(),on:l.classList.contains("on")}))})`);
  check("Start: Build opens with a goal chip naming the mission", chip0.title === "Weekend loaner", JSON.stringify(chip0));
  check("Start: the goal is one open step (Wear the new part)", chip0.parts.length === 1 && !chip0.parts[0].on && /Wear the new part/.test(chip0.parts[0].t), JSON.stringify(chip0.parts));
  await sleep(1200);
  check("Start: standing still pays nothing and does not finish", !(await cdp.evaluate(`document.querySelector(".tv-garage-chip")?.classList.contains("tv-garage-chip-done")`)) && ((await progOf(cdp)).totalXp ?? 0) === xp0);
  await shotNamed(cdp, "garage-chip-start");

  // Wear the loaner crown (a part the child has not found): it works on a weekend.
  await cdp.evaluate(`(()=>{const h=window.__tvWorld.handle;h.cuSlot("hat");h.cuPart("crown")})()`);
  await waitFor(() => cdp.evaluate(`document.querySelector(".tv-garage-chip")?.classList.contains("tv-garage-chip-done")===true`), { timeoutMs: 8000, label: "mission done" });
  check("the loaner crown can be worn on a weekend", (await worn(cdp, "hat")) === "crown", String(await worn(cdp, "hat")));
  check("finishing shows Done with what it paid", /Done/.test(await sheetText(cdp, ".tv-garage-chip-title")) && /\+40 XP/.test(await sheetText(cdp, ".tv-garage-chip")), await sheetText(cdp, ".tv-garage-chip"));
  await shotNamed(cdp, "garage-chip-done");
  const p1 = await progOf(cdp);
  check("it paid 40 XP once", (p1.totalXp ?? 0) === xp0 + 40, `${xp0} -> ${p1.totalXp}`);
  check("it remembers the weekend as done (the Friday)", Array.isArray(p1.garageDone) && p1.garageDone.length === 1 && p1.garageDone[0] === "2026-11-06", JSON.stringify(p1.garageDone));
  check("it stamps a Workshop Day", Array.isArray(p1.workshopDays) && p1.workshopDays.length === 1 && /^2026-11-0[78]$/.test(p1.workshopDays[0]), JSON.stringify(p1.workshopDays));
  check("it is credited to the parent ledger as a STEM mission", (await ledgerIds(cdp)).includes("garage.2026-11-06"), JSON.stringify(await ledgerIds(cdp)));

  // Close the chip, look at the map: the Garage is done now, no longer NEW.
  await clickButton(cdp, ".tv-garage-chip button", "Close");
  await sleep(200);
  check("Close puts the chip away", !(await cdp.evaluate(`!!document.querySelector(".tv-garage-chip")`)));
  await clickButton(cdp, '[aria-label="Build your toy"] button', "Done");
  await sleep(300);
  await openTrail(cdp);
  await tapNode(cdp, "garage");
  await waitKipAt(cdp, "garage");
  check("done: the plate says Built it", /Built it/.test(await sheetText(cdp, ".tv-trail-plate-kicker")), await sheetText(cdp, ".tv-trail-plate-kicker"));
  await clickPlay(cdp);
  await waitFor(() => cdp.evaluate(`!!document.querySelector(".tv-sheet-garage")`), { label: "garage sheet" });
  check("done: the sheet says Done this weekend and offers it again", /Done this weekend/.test(await sheetText(cdp, ".tv-garage-tag")) && (await sheetText(cdp, ".tv-garage-start")) === "Do it again");

  // Replay: finish it again (change another part; the crown stays on). Nothing more is paid.
  await clickButton(cdp, ".tv-sheet-garage button", "Do it again");
  await waitFor(() => cdp.evaluate(`!!document.querySelector(".tv-garage-chip")`), { label: "replay chip" });
  await cdp.evaluate(`(()=>{const h=window.__tvWorld.handle;h.cuSlot("ears");h.cuPart("bunny")})()`);
  await waitFor(() => cdp.evaluate(`document.querySelector(".tv-garage-chip")?.classList.contains("tv-garage-chip-done")===true`), { timeoutMs: 8000, label: "replay done" });
  const p2 = await progOf(cdp);
  check("a replay pays nothing more", (p2.totalXp ?? 0) === (p1.totalXp ?? 0) && p2.garageDone.length === 1, `${p1.totalXp} -> ${p2.totalXp}`);
  check("a replay says it is just for fun", /just for fun/.test(await sheetText(cdp, ".tv-garage-chip")), await sheetText(cdp, ".tv-garage-chip"));
}

// Demo Mode's Preview weekend: the weekend look on a weekday, the flow runs, nothing is saved.
async function scenarioGaragePreview(cdp) {
  await loadApp(cdp, { version: 1, totalXp: 0, ageBand: 3 }, { fresh: true, extra: { "toyforge:demo-mode:v1": "1", "tvGaragePreview:v1": "1" } });
  await openTrail(cdp);
  check("preview: a weekday shows the lit weekend Garage", await cdp.evaluate(`!!document.querySelector('[data-node-id="garage"] svg[data-lit="1"]')`));
  await tapNode(cdp, "garage");
  await waitKipAt(cdp, "garage");
  await clickPlay(cdp);
  await waitFor(() => cdp.evaluate(`!!document.querySelector(".tv-sheet-garage")`), { label: "garage sheet" });
  check("preview: the sheet says New this weekend", (await sheetText(cdp, ".tv-garage-tag")) === "New this weekend");
  const xp0 = (await progOf(cdp)).totalXp ?? 0;
  // The dev worker keeps a ledger between scenarios and merges it in when it answers,
  // so compare against what is there before the mission, not against empty.
  const ledger0 = JSON.stringify(await ledgerIds(cdp));
  await clickButton(cdp, ".tv-sheet-garage button", "Start");
  await waitFor(() => cdp.evaluate(`!!document.querySelector(".tv-garage-chip")`), { label: "chip" });
  await cdp.evaluate(`(()=>{const h=window.__tvWorld.handle;h.cuSlot("hat");h.cuPart("crown")})()`);
  await waitFor(() => cdp.evaluate(`document.querySelector(".tv-garage-chip")?.classList.contains("tv-garage-chip-done")===true`), { timeoutMs: 8000, label: "preview done" });
  check("preview: it runs through to Done and says nothing is saved", /Nothing is saved/.test(await sheetText(cdp, ".tv-garage-chip")), await sheetText(cdp, ".tv-garage-chip"));
  const p = await progOf(cdp);
  check("preview: no XP, no weekend marked done, no Workshop Day", (p.totalXp ?? 0) === xp0 && !(p.garageDone || []).length && !(p.workshopDays || []).length, JSON.stringify({ xp: p.totalXp, d: p.garageDone, w: p.workshopDays }));
  check("preview: nothing credited to the parent ledger", JSON.stringify(await ledgerIds(cdp)) === ledger0, `${ledger0} -> ${JSON.stringify(await ledgerIds(cdp))}`);
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
  const only = process.env.E2E_ONLY ? process.env.E2E_ONLY.split(",") : null;
  const run = async (name, fn) => {
    if (only && !only.includes(name)) return;
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
    await run("young", scenarioYoung);
    await run("older", scenarioOlder);
    await run("play", scenarioPlay);
    await run("reveal", scenarioReveal);
    await run("secret", scenarioSecret);
    await run("portrait", scenarioPortrait);
    await run("time-of-day", scenarioTimeOfDay);
    await run("garage-weekday", scenarioGarageWeekday);
    await run("garage-carousel", scenarioGarageCarousel);
    await run("garage-weekend", scenarioGarageWeekend);
    await run("garage-preview", scenarioGaragePreview);
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
