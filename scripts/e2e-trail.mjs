#!/usr/bin/env node
// Explorer trail map (docs/specs/explorer-map-spec.md): headless-Chrome checks
// at 390x844. Own dev server + own Chrome profile, so it never touches a dev
// server another session is running. Exits nonzero on any failing check.
// Run: npm run e2e:trail
// Overrides: E2E_CHROME (binary), E2E_PORT, E2E_DEBUG_PORT, E2E_PROFILE,
//            E2E_SHOTS (dir; when set, saves trail-map screenshots).
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
//   - a secret exit stays hidden until a world's hidden parts are all found,
//     then opens (with a notice and the reveal animation) and plays a bonus
//     level at the hardest tier the age is offered;
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
async function loadApp(cdp, seed, { fresh = false } = {}) {
  const { identifier } = await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `${fresh ? "try{localStorage.clear();}catch(e){}" : ""}try{localStorage.setItem(${JSON.stringify(STORAGE_KEY)},${JSON.stringify(JSON.stringify(seed))});}catch(e){}`,
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

// A secret exit: hidden, then opens when a world is complete, then plays a bonus level.
async function scenarioSecret(cdp) {
  await loadApp(cdp, { version: 1, totalXp: 0, ageBand: 3 });
  await openMap(cdp); // records what is shown (no secret yet)
  const secretIds = () =>
    cdp.evaluate(`[...document.querySelectorAll('[data-node-id^="secret:"]')].map((b) => b.dataset.nodeId)`);
  check("secret exits are hidden until a world is complete", (await secretIds()).length === 0);
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
    await run("young", scenarioYoung);
    await run("older", scenarioOlder);
    await run("play", scenarioPlay);
    await run("reveal", scenarioReveal);
    await run("secret", scenarioSecret);
    await run("portrait", scenarioPortrait);
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
