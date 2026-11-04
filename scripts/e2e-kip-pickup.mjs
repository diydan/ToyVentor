#!/usr/bin/env node
// The camera pick-up in the real Kip bench (parts/kip/viewer/kip-pickup.js, Tools > Pick it up): a live camera view, a word, a shutter, SAM's outline, and Kip takes it.
// Run: node scripts/e2e-kip-pickup.mjs     Exits nonzero on any failing check. Needs the machine's GPU for the 3D bench: it sets E2E_GPU=metal itself.
//
// What is real: the bench page (parts/kip/viewer, served in place of public/kip), the camera view, the print panel it scans through and its bundled flow, the household
// library's catalog and GLBs, getUserMedia (Chrome's own fake camera: --use-fake-device-for-media-stream), and the browser (headless Chrome with a GPU, 390 x 844).
// What is stood in: /api/scan. It answers with the outline of the real steel spoon (tests/fixtures/spoon-sam-reply.sse, run through the real outline code), or no match.
// For the spoon run the camera is a canvas that shows the drawn spoon at the size the outline was traced on, so the cut-out lands on the spoon; every other check uses Chrome's
// own fake camera. Only a drawing of a spoon is ever used: no real photo, no key.
// Env: E2E_CHROME, E2E_SHOTS.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";

process.env.E2E_GPU ??= "metal";
const { createChecks, launchChrome, startServer } = await import("./lib/kip-e2e.mjs");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), "kip-pickup-shots");
const { check, finish } = createChecks("kip pick-up e2e");

globalThis.__dirname = path.join(HERE, "../tests/fixtures");
const { realSpoon } = await import("../tests/fixtures/realCupMask.ts");
const { scanOutline } = await import("../shared/outlineScan.ts");

function pngOf(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const PW = 288, PH = 512;
const spoon = await realSpoon();
const rgba = Buffer.alloc(PW * PH * 4);
for (let y = 0; y < PH; y++) {
  for (let x = 0; x < PW; x++) {
    const mx = x - spoon.bounds.left, my = y - spoon.bounds.top;
    const on = mx >= 0 && my >= 0 && mx < spoon.raster.width && my < spoon.raster.height && spoon.raster.data[my * spoon.raster.width + mx];
    const c = on ? [150 + 60 * Math.sin(x / 11), 156 + 50 * Math.sin(x / 11), 166 + 50 * Math.sin(x / 11)] : [196 + 8 * Math.sin(y / 5), 152 + 8 * Math.sin(y / 5), 104 + 8 * Math.sin(y / 5)];
    rgba.set([...c.map((v) => Math.max(0, Math.min(255, Math.round(v)))), 255], (y * PW + x) * 4);
  }
}
const SPOON_PNG = pngOf(PW, PH, rgba);
const FIXTURE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kip-pickup-fixture-")), "spoon.png");
fs.writeFileSync(FIXTURE, SPOON_PNG);
const realScan = scanOutline(spoon.raster, spoon.bounds, { width: PW, height: PH }, { targetHeightMm: 54 });
if (!realScan.ok) throw new Error("the real spoon has no outline");

let scanMode = "good"; // good | nomatch
const scanReply = () => {
  if (scanMode === "nomatch") return { status: 200, json: { toy: null, sam: { configured: true, applied: false, status: "no-match", matches: 0 } } };
  const o = JSON.parse(JSON.stringify(realScan));
  o.fidelity = 0.97;
  o.warnings = [];
  return { status: 200, json: { toy: null, sam: { configured: true, applied: true, matches: 1, outline: o } } };
};

const server = await startServer();
let nameMode = "spoon"; // spoon | gizmo | none: what the helper says is in the picture
const nameReply = () => ({ status: 200, json: { ok: true, configured: true, checked: true, names: nameMode === "none" ? [] : nameMode === "gizmo" ? ["gizmo"] : ["spoon", "ladle"] } });
server.mock("POST", "/api/scan", ({ json }) => (json && json.nameIt ? nameReply() : scanReply()));
// the song route, stood in: on, with a song that is "ready" the moment it is asked after (a starter tune's file stands for the audio)
const firstSong = JSON.parse(fs.readFileSync(path.join(HERE, "../public/kip/songs/index.json"), "utf8")).songs[0].file;
const SONG = { name: "Silver Spoon Samba", verse: ["Spoon, spoon, shining bright", "Kip is holding it so tight", "Stirring up a sunny day", "Humming as we play"], chorus: ["Tap tap, spoon, spoon", "Dance beneath the moon", "Tap tap, spoon, spoon", "Sing a happy tune"], mood: "kitchen", task: "task_e2e" };
const songPosts = [];
server.mock("GET", "/api/theme-song", ({ search }) => (search.get("id") ? { json: { status: "ready", url: `/kip/songs/${firstSong}`, durationMs: 32000 } } : { json: { enabled: true, quota: { left: 5, makerOn: true } } }));
server.mock("POST", "/api/theme-song", ({ json }) => { songPosts.push(json); return { json: SONG }; });
const chrome = await launchChrome({ width: 390, height: 844 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let kip;
try {
  kip = await chrome.open(`${server.base}/kip/Kip-Demo.html`, { width: 390, height: 844, mobile: true });
  const ev = (expr) => kip.evaluate(expr);
  check("the Kip bench loads", await kip.waitFor("window.__KIP_READY__ === true", 150000, 1000));
  const st = () => ev("window.kipPickUp ? window.kipPickUp.state : null");
  const mode = async () => (await st())?.mode;
  const press = (sel) => ev(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b || b.hidden || b.disabled) return false; b.click(); return true; })()`);
  const chip = (w) => press(`.kpu-chips button[data-word="${w}"]`);
  const prop = () => ev("window.kipMenu.ctx.loco.prop");
  const clip = () => ev("window.kipMenu.ctx.read.clip()");

  // 1. the entry point ----------------------------------------------------------------------------------------------------------------
  check("the Tools menu offers Pick it up", await ev("typeof window.kipMenu.ctx.act.openPickUp === 'function'"));
  await ev("window.kipMenu.ctx.act.openPickUp()");
  check("opening it shows the full-screen view and starts the real (fake-device) camera", await kip.waitFor("window.kipPickUp && window.kipPickUp.state.mode === 'live'", 20000), JSON.stringify(await st()));
  check("the stream is live and the video has a picture size", (await st()).hasStream && (await ev("document.querySelector('.kpu-video').videoWidth")) > 0);
  check("the view covers the screen", await ev("(() => { const r = document.querySelector('.kpu-back').getBoundingClientRect(); return r.width === innerWidth && r.height === innerHeight; })()"));
  check("the video is inline and muted, as an installed web app and iOS need", await ev("(() => { const v = document.querySelector('.kpu-video'); return v.playsInline === true && v.muted === true; })()"));
  await kip.shot(path.join(SHOTS, "1-live.png"));
  check("with no word chosen the view says the helper will find out, and nothing has been sent", /find out/i.test((await st()).message) && (await mode()) === "live" && server.apiCalls.filter((c) => c.path === "/api/scan").length === 0);

  // 2. a workshop prop: a guitar -----------------------------------------------------------------------------------------------------
  await ev("window.__pickEvents = []; window.addEventListener('tv:kip-picked-up', (e) => window.__pickEvents.push(e.detail))");
  check("tapping a chip fills in the word", (await chip("guitar")) && (await ev("document.querySelector('.kpu-word').value")) === "guitar");
  await press(".kpu-shutter");
  check("pressing the shutter stops the camera at once", await kip.waitFor("!window.kipPickUp.state.hasStream", 5000));
  await kip.waitFor("window.kipPickUp.state.mode === 'picking' || window.kipPickUp.state.mode === 'closed'", 20000, 100);
  const scanCall = server.apiCalls.find((c) => c.path === "/api/scan");
  const body = scanCall && JSON.parse(scanCall.body).scan;
  check("the request was one POST to /api/scan with prompt 'guitar' and a JPEG data URL", server.apiCalls.filter((c) => c.path === "/api/scan").length === 1 && body && body.prompt === "guitar" && body.imageDataUrl.startsWith("data:image/jpeg") && !("cookie" in scanCall.headers));
  const sawCut = await kip.waitFor("!!document.querySelector('.kpu-cut')", 8000, 60);
  if (sawCut) await kip.shot(path.join(SHOTS, "2-cutout.png"));
  check("the object was cut out of the frozen frame and shown over it", sawCut);
  check("the view closes when Kip has it", await kip.waitFor("window.kipPickUp.state.mode === 'closed'", 20000));
  check("Kip holds the bench's own guitar and plays its strum clip", (await prop()) === "guitar" && (await clip()) === "prop_guitar", `${await prop()} / ${await clip()}`);
  check("the pick-up is reported to the page (a workshop prop, the guitar)", await ev("(() => { const p = window.kipPickUp.state.lastPick; return !!p && p.kind === 'workshop' && p.id === 'guitar' && p.word === 'guitar' && Array.isArray(p.colours); })()"));
  check("the page is told once, on window, with the cut-out as a transparent PNG", await ev("window.__pickEvents.length === 1 && window.__pickEvents[0].id === 'guitar' && window.__pickEvents[0].kind === 'workshop'"));
  const png = await ev(`(async () => { const c = window.__pickEvents[0].cutout; if (!c || !c.dataUrl.startsWith('data:image/png;base64,')) return { ok: false }; const img = new Image(); img.src = c.dataUrl; await img.decode(); const k = document.createElement('canvas'); k.width = img.naturalWidth; k.height = img.naturalHeight; const x = k.getContext('2d'); x.drawImage(img, 0, 0); const a = (px, py) => x.getImageData(px, py, 1, 1).data[3]; let solid = 0, clear = 0; const d = x.getImageData(0, 0, k.width, k.height).data; for (let i = 3; i < d.length; i += 4) { if (d[i] > 200) solid++; else if (d[i] === 0) clear++; } return { ok: true, w: c.w, h: c.h, nw: img.naturalWidth, nh: img.naturalHeight, longest: Math.max(c.w, c.h), solid, clear, total: d.length / 4, bytes: c.dataUrl.length }; })()`);
  check("the cut-out is the object alone: some solid pixels, some clear ones, and at most 256 px a side", png.ok && png.w === png.nw && png.h === png.nh && png.longest <= 256 && png.solid > png.total * 0.05 && png.clear > 0 && png.bytes < 400000, JSON.stringify(png));
  await sleep(600);
  await kip.shot(path.join(SHOTS, "3-guitar.png"));
  check("no camera stays open after the pick-up", await ev("[...document.querySelectorAll('video')].every((v) => !v.srcObject)"));

  // 2b. the moment song ------------------------------------------------------------------------------------------------------------------
  check("a song button for the guitar appears (the song route is on)", await kip.waitFor("!!window.kipMomentSong && window.kipMomentSong.state.buttonShowing", 10000), JSON.stringify(await ev("window.kipMomentSong && window.kipMomentSong.state")));
  check("it says what it is about", /guitar/i.test(await ev("document.querySelector('.kms-btn').textContent")));
  const sentence = await ev("window.kipMomentSong.state.sentence");
  check("the song's sentence is built from closed words: the object and what Kip does", /guitar/.test(sentence) && /strums/.test(sentence) && sentence.length <= 300 && !/[<>{}]/.test(sentence), sentence);
  await kip.shot(path.join(SHOTS, "3b-song-button.png"));
  await press(".kms-btn");
  check("pressing it asks the song route for one song, with that sentence", (await kip.waitFor("!!document.querySelector('.kms-box .kts-name') && /Samba/.test(document.querySelector('.kms-box .kts-name').textContent)", 15000)) && songPosts.length === 1 && songPosts[0].description === sentence, JSON.stringify(songPosts));
  check("the card is labelled for the pick-up, not the build", /Song about it/.test(await ev("document.querySelector('.kms-box .kts-label').textContent")) && !/keep building/i.test(await ev("document.querySelector('.kms-box .kts-status').textContent")));
  check("the song becomes ready and can be played", await kip.waitFor("window.kipMomentSong.theme.state === 'ready' && !document.querySelector('.kms-box .kts-play').hidden", 25000), await ev("window.kipMomentSong.theme.state"));
  await kip.shot(path.join(SHOTS, "3c-song-ready.png"));
  await press(".kms-close");
  check("closing the card puts the button back, and the song stays in My songs", (await ev("window.kipMomentSong.state.buttonShowing")) && (await ev("JSON.parse(localStorage.getItem('tv.themeSongs.v1') || '[]').some((x) => x.name === 'Silver Spoon Samba')")));
  const off = await ev(`(async () => { const m = (await import('/kip/kip-moment-song.js?v=10.0')).createMomentSong({ root: document.body, url: '/api/no-such-route' }); const shown = await m.offer({ word: 'spoon', label: 'spoon', kind: 'library', id: 'x', colours: [] }); const r = { shown, button: m.state.buttonShowing, dom: document.querySelectorAll('.kms-btn').length }; m.dispose(); return r; })()`);
  check("when the song route is off no button is shown at all", off.shown === false && off.button === false && off.dom === 1, JSON.stringify(off)); // 1 = the guitar's own button, still there

  // 3. a household item: the spoon, from a camera that shows the drawn spoon ---------------------------------------------------------------
  await ev(`(() => {
    const img = new Image();
    window.__spoonReady = new Promise((res) => { img.onload = res; });
    img.src = 'data:image/png;base64,${SPOON_PNG.toString("base64")}';
    window.__spoonImg = img;
    window.__realGum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async () => {
      await window.__spoonReady;
      const c = document.createElement('canvas'); c.width = ${PW}; c.height = ${PH};
      const x = c.getContext('2d');
      const draw = () => { x.drawImage(img, 0, 0); window.__spoonRaf = requestAnimationFrame(draw); };
      draw();
      return c.captureStream(15);
    };
  })()`);
  await ev("window.kipMenu.ctx.act.openPickUp()");
  check("the camera view opens again with the spoon camera", await kip.waitFor("window.kipPickUp.state.mode === 'live'", 20000));
  check("a new pick-up starts with no word chosen", (await ev("document.querySelector('.kpu-word').value")) === "");
  await chip("spoon");
  await kip.waitFor("document.querySelector('.kpu-video').videoWidth > 0", 5000, 100);
  // sample where the cut-out is, every 30 ms, so the flight can be checked against where Kip's hand was
  await ev("window.__trail = []; window.__trailTimer = setInterval(() => { const c = document.querySelector('.kpu-cut'); if (c) { const r = c.getBoundingClientRect(); window.__trail.push([r.left + r.width / 2, r.top + r.height / 2, r.width]); } }, 30)");
  await press(".kpu-shutter");
  const sawCut2 = await kip.waitFor("!!document.querySelector('.kpu-cut')", 20000, 40);
  if (sawCut2) await kip.shot(path.join(SHOTS, "4-spoon-cut.png"));
  check("the spoon was cut out of the frame", sawCut2);
  // catch it in flight: the sampled width has shrunk to under 60% of where it started
  const flying = await kip.waitFor("(() => { const t = window.__trail; return t.length > 3 && t[t.length - 1][2] < t[0][2] * 0.6 && t[t.length - 1][2] > t[0][2] * 0.3; })()", 10000, 20);
  if (flying) await kip.shot(path.join(SHOTS, "5-spoon-flying.png"));
  check("the cut-out shrinks as it flies", flying);
  check("the view closes when Kip has it", await kip.waitFor("window.kipPickUp.state.mode === 'closed'", 30000));
  await ev("clearInterval(window.__trailTimer)");
  const trail = await ev("window.__trail");
  const hand = (await st()).lastHand;
  const dist = (p) => (hand ? Math.hypot(p[0] - hand.x, p[1] - hand.y) : Infinity);
  check("the flight was sampled many times", trail.length > 12, `${trail.length} samples`);
  check("the cut-out ends at Kip's hand and starts far from it", !!hand && dist(trail[trail.length - 1]) < Math.max(60, dist(trail[0]) * 0.2) && dist(trail[0]) > 120, `first ${Math.round(dist(trail[0]))} px, last ${Math.round(dist(trail[trail.length - 1]))} px from the hand at ${JSON.stringify(hand)}`);
  check("it got smaller on the way (a spoon that lands in a hand is hand-sized)", trail[trail.length - 1][2] < trail[0][2] * 0.35, `${Math.round(trail[0][2])} -> ${Math.round(trail[trail.length - 1][2])} px wide`);
  check("Kip holds the 3D wooden spoon from the household library, coloured from the photo", await ev("(() => { const p = window.kipPickUp.state.lastPick; return !!p && p.kind === 'library' && /spoon/i.test(p.id) && p.coloured === true; })()") && (await prop()) === "custom", JSON.stringify((await st()).lastPick));
  await sleep(800);
  await kip.shot(path.join(SHOTS, "6-spoon-in-hand.png"));
  await ev("cancelAnimationFrame(window.__spoonRaf)");

  // 3c. no word: the helper says what it is, then the scan runs for that name --------------------------------------------------------------
  const before = server.apiCalls.length;
  await ev("window.kipMenu.ctx.act.openPickUp()");
  check("a new pick-up starts live with no word and the shutter ready", await kip.waitFor("window.kipPickUp.state.mode === 'live'", 20000) && (await ev("document.querySelector('.kpu-word').value")) === "");
  await kip.waitFor("document.querySelector('.kpu-video').videoWidth > 0", 5000, 100);
  // the stood-in server answers at once, so the lines come and go in milliseconds: record every one of them
  await ev("window.__says = []; new MutationObserver(() => window.__says.push(document.querySelector('.kpu-status').textContent)).observe(document.querySelector('.kpu-status'), { childList: true, characterData: true, subtree: true })");
  await press(".kpu-shutter");
  await kip.waitFor("window.kipPickUp.state.mode === 'closed' && !!window.kipPickUp.state.lastPick", 40000);
  const says = await ev("window.__says");
  const iName = says.findIndex((t) => /looks like a spoon/i.test(t));
  const iCut = says.findIndex((t) => /Here comes the spoon/i.test(t));
  check("the view says what it is looking at, then what it found, then that it is cutting it out, in that order", says.findIndex((t) => /Looking at what it is/i.test(t)) >= 0 && iName > says.findIndex((t) => /Looking at what it is/i.test(t)) && iCut > iName, JSON.stringify(says));
  check("then Kip holds it and the view closes", await kip.waitFor("window.kipPickUp.state.mode === 'closed' && !!window.kipPickUp.state.lastPick", 40000));
  const mine = server.apiCalls.slice(before).filter((c) => c.path === "/api/scan").map((c) => JSON.parse(c.body));
  check("two calls to /api/scan: first { nameIt } with a JPEG, then a scan for the name it gave", mine.length === 2 && !!mine[0].nameIt && mine[0].nameIt.imageDataUrl.startsWith("data:image/jpeg") && !mine[0].scan && mine[1].scan && mine[1].scan.prompt === "spoon", JSON.stringify(mine.map((m) => Object.keys(m))));
  check("it is the household spoon, named by the helper, and the page is told so", await ev("(() => { const p = window.kipPickUp.state.lastPick; return !!p && p.word === 'spoon' && p.kind === 'library' && p.named === true; })()"), JSON.stringify((await st()).lastPick && { ...(await st()).lastPick, cutout: "..." }));

  // 3d. something Kip has no prop or 3D item for: the cut-out itself goes in his hand as a card ----------------------------------------------
  nameMode = "gizmo";
  await ev("window.kipMenu.ctx.act.openPickUp()");
  await kip.waitFor("window.kipPickUp.state.mode === 'live'", 20000);
  await kip.waitFor("document.querySelector('.kpu-video').videoWidth > 0", 5000, 100);
  await press(".kpu-shutter");
  check("a thing with no prop and no library item becomes a card in Kip's hand", await kip.waitFor("window.kipPickUp.state.mode === 'closed' && !!window.kipPickUp.state.lastPick && window.kipPickUp.state.lastPick.kind === 'card'", 40000), JSON.stringify((await st()).lastPick && { ...(await st()).lastPick, cutout: "..." }));
  check("the card is in the hand slot, with the cut-out as its picture", await ev("(() => { const c = window.kipRig().kip.exp.customHandContainer; let found = false; c.traverse((o) => { if (o.isMesh && o.material && o.material.map && o.material.map.image && o.material.transparent) found = true; }); return found && window.kipMenu.ctx.loco.prop === 'custom'; })()"));
  await sleep(900);
  await kip.shot(path.join(SHOTS, "6c-card.png"));
  const cardHand = (await st()).lastHand;
  if (cardHand) { // a zoomed look at the hand, to see which way the card faces
    const r = await kip.send("Page.captureScreenshot", { format: "png", clip: { x: Math.max(0, cardHand.x - 90), y: Math.max(0, cardHand.y - 150), width: 200, height: 300, scale: 3 } });
    fs.writeFileSync(path.join(SHOTS, "6d-card-zoom.png"), Buffer.from(r.data, "base64"));
  }
  check("the page is told it is a card, and the song sentence still reads well", await ev("window.__pickEvents.some((e) => e.kind === 'card' && e.word === 'gizmo' && e.cutout)") && /gizmo/.test(await ev("window.kipMomentSong.state.sentence || ''")), await ev("window.kipMomentSong.state.sentence"));

  // 3e. the helper cannot tell what it is: one calm sentence, and the child can still tap a word --------------------------------------------
  nameMode = "none";
  await ev("window.kipMenu.ctx.act.openPickUp()");
  await kip.waitFor("window.kipPickUp.state.mode === 'live'", 20000);
  await kip.waitFor("document.querySelector('.kpu-video').videoWidth > 0", 5000, 100);
  await press(".kpu-shutter");
  check("when it cannot name the thing the view says so and offers Try again", await kip.waitFor("window.kipPickUp.state.mode === 'retry'", 30000) && /could not tell what that is/i.test((await st()).message) && /Tap what it is/.test((await st()).message), (await st()).message);
  await press(".kpu-top button[aria-label='Close the camera']");
  nameMode = "spoon";

  // 4. nothing found: a calm message, and Try again restarts the camera ------------------------------------------------------------------
  scanMode = "nomatch";
  await ev("navigator.mediaDevices.getUserMedia = window.__realGum");
  await ev("window.kipMenu.ctx.act.openPickUp()");
  await kip.waitFor("window.kipPickUp.state.mode === 'live'", 20000);
  await ev("(() => { const i = document.querySelector('.kpu-word'); i.value = 'zebra'; i.dispatchEvent(new Event('input', { bubbles: true })); })()");
  await press(".kpu-shutter");
  check("a word with no match ends on a retry screen with one calm sentence", await kip.waitFor("window.kipPickUp.state.mode === 'retry'", 30000) && /zebra/.test((await st()).message) && !/error|undefined|\{/.test((await st()).message), (await st()).message);
  check("Try again is offered, and the camera is off until it is pressed", (await ev("!document.querySelector('.kpu-back button.on').hidden")) && !(await st()).hasStream);
  await kip.shot(path.join(SHOTS, "7-no-match.png"));
  await press(".kpu-back button.on");
  check("Try again restarts the camera", await kip.waitFor("window.kipPickUp.state.mode === 'live' && window.kipPickUp.state.hasStream", 20000));
  await press(".kpu-top button[aria-label='Close the camera']");
  check("closing lets the camera go", (await mode()) === "closed" && !(await st()).hasStream && (await ev("[...document.querySelectorAll('video')].every((v) => !v.srcObject)")));

  // 5. the camera is turned off: say so, and a photo works instead --------------------------------------------------------------------------
  scanMode = "good";
  await ev("navigator.mediaDevices.getUserMedia = async () => { const e = new Error('denied'); e.name = 'NotAllowedError'; throw e; }");
  await ev("window.kipMenu.ctx.act.openPickUp()");
  check("with the camera turned off the view says so and offers a photo", await kip.waitFor("window.kipPickUp.state.mode === 'nocamera'", 20000) && /turned off/.test((await st()).message));
  await kip.shot(path.join(SHOTS, "8-camera-off.png"));
  await chip("spoon");
  const { root } = await kip.send("DOM.getDocument", { depth: 1 });
  const { nodeId } = await kip.send("DOM.querySelector", { nodeId: root.nodeId, selector: ".kpu-back input[type=file]" });
  await kip.send("DOM.setFileInputFiles", { files: [FIXTURE], nodeId });
  check("a picked photo goes through the same scan and pick-up", await kip.waitFor("window.kipPickUp.state.mode === 'closed' && !!window.kipPickUp.state.lastPick && window.kipPickUp.state.lastPick.kind === 'library'", 40000), JSON.stringify(await st()));

  // 6. what left the page ------------------------------------------------------------------------------------------------------------------
  check("only the scan and the song routes were ever called, and the song route once for a song", server.apiCalls.length > 0 && server.apiCalls.every((c) => c.path === "/api/scan" || c.path === "/api/theme-song" || c.path === "/api/no-such-route") && server.apiCalls.filter((c) => c.path === "/api/scan").every((c) => c.method === "POST") && songPosts.length === 1, JSON.stringify(server.apiCalls.map((c) => `${c.method} ${c.path}`)));
  check("nothing was written to local storage by the view", await ev("Object.keys(localStorage).every((k) => !/pickup|kpu/i.test(k))"));
  check("the page threw no exceptions", kip.exceptions.length === 0, kip.exceptions.join(" | ").slice(0, 400));
  check("no module or file was missing", server.missing.size === 0, [...server.missing].join(", "));
} finally {
  try { kip?.close(); } catch { /* gone */ }
  chrome.close();
  server.close();
}
finish();
console.log(`screenshots: ${SHOTS}`);
