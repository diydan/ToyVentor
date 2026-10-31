#!/usr/bin/env node
// Kip demo selfie face: headless-Chrome checks for Phase 3 (L1 + L2 sticker) of docs/specs/kip-demo-implementation.md.
// Run: npm run e2e:kip-selfie     Exits nonzero on any failing check.
// Uses Chrome's fake camera (--use-fake-device-for-media-stream) and generated pattern images only: no real faces.
// Env: E2E_CHROME, E2E_SHOTS (see scripts/lib/kip-e2e.mjs).
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { createChecks, launchChrome, startServer } from "./lib/kip-e2e.mjs";

const SHOTS = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), "kip-selfie-shots");
const { check, finish } = createChecks("kip selfie e2e");

/** A generated test pattern (not a photo): coloured bands and a diagonal, big enough to survive the toon style. */
function makePng(w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 4 + 1) + 1 + x * 4;
      const band = Math.floor((x / w) * 4);
      const diag = Math.abs(x - y * (w / h)) < 6;
      const c = diag ? [20, 20, 30] : [[230, 90, 70], [240, 200, 80], [90, 170, 120], [80, 120, 220]][band];
      raw.set([...c, 255], o);
    }
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
const FIXTURE = path.join(mkdtempSync(path.join(os.tmpdir(), "kip-selfie-fixture-")), "pattern.png");
writeFileSync(FIXTURE, makePng(320, 240));

async function uploadFixture(tab) {
  await tab.send("DOM.enable");
  const doc = await tab.send("DOM.getDocument", { depth: 1 });
  const node = await tab.send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "#selfie-file" });
  await tab.send("DOM.setFileInputFiles", { nodeId: node.nodeId, files: [FIXTURE] });
}
const INSTRUMENT = `(() => { window.__streams = []; const md = navigator.mediaDevices; if (!md.__wrapped) { const orig = md.getUserMedia.bind(md); md.getUserMedia = async (c) => { const s = await orig(c); window.__streams.push(s); return s; }; md.__wrapped = orig; } return true; })()`;
const REJECT = (name) => `(() => { const md = navigator.mediaDevices; md.getUserMedia = async () => { const e = new Error('${name}'); e.name = '${name}'; throw e; }; return true; })()`;
const RESTORE = `(() => { const md = navigator.mediaDevices; if (md.__wrapped) { const orig = md.__wrapped; md.getUserMedia = async (c) => { const s = await orig(c); window.__streams.push(s); return s; }; } return true; })()`;
const liveTracks = `(window.__streams || []).flatMap(s => s.getTracks()).filter(t => t.readyState === 'live').length`;
const open = `document.getElementById('modal-selfie').classList.contains('open')`;
const step = `window.kipSelfie.state.step`;
const click = (id) => `document.getElementById('${id}').click()`;

const server = await startServer();
const chrome = await launchChrome({ width: 1440, height: 900 });
try {
  console.log(`serving ${server.base}`);
  const tab = await chrome.open(`${server.base}/kip/Kip-Demo.html?menu=side&cat=human`);
  check("demo initialises with the selfie module mounted", await tab.waitFor("window.__KIP_READY__ === true && !!window.kipSelfie", 180000), tab.exceptions[0]);
  check("starts on a human head with the selfie entry visible", await tab.waitFor(`window.kipMenu.ctx.loco.category === 'human' && !window.kipMenu.fields.get('selfie').root.hidden`, 20000));
  await tab.evaluate(INSTRUMENT);
  const mark = tab.requests.length;

  console.log("\n[1] camera path: tap to start, countdown, snap, adjust, apply");
  await tab.evaluate(click("km-selfie"));
  check("opens a modal with a privacy line and labelled choices", await tab.waitFor(open, 10000) && await tab.evaluate(`/Stays on this device/.test(document.getElementById('sf-privacy').textContent) && /Start camera/.test(document.getElementById('sf-start').textContent) && !!document.getElementById('sf-upload-label')`));
  check("the camera has NOT started before the tap", (await tab.evaluate(`window.__streams.length`)) === 0 && (await tab.evaluate(step)) === "intro");
  await tab.evaluate(click("sf-start"));
  check("camera starts after the tap and shows a live preview", await tab.waitFor(`${step} === 'camera' && document.getElementById('sf-video').videoWidth > 0 && ${liveTracks} === 1`, 30000));
  await tab.shot(path.join(SHOTS, "selfie-camera.png"));
  await tab.evaluate(click("sf-snap"));
  check("a countdown runs before the snap", await tab.waitFor(`window.kipSelfie.state.countdown > 0`, 5000));
  check("snapping moves to Adjust and the camera is released at once", await tab.waitFor(`${step} === 'adjust' && ${liveTracks} === 0 && window.__streams[0].getTracks().every(t => t.readyState === 'ended')`, 20000));
  const drawn = await tab.evaluate(`(() => { const c = document.getElementById('sf-canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const seen = new Set(); for (let i = 0; i < d.length; i += 4 * 97) seen.add((d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4)); return { colours: seen.size, cornerAlpha: d[3] }; })()`);
  check("Adjust shows the framed, styled picture inside a rounded window", drawn.colours > 3 && drawn.cornerAlpha === 0, JSON.stringify(drawn));
  check("Toon is the default style", await tab.evaluate(`document.querySelector('input[name=sf-style]:checked').value === 'toon'`));
  check("only the Adjust step is showing (no leftover camera/upload buttons)", await tab.evaluate(`['sf-intro', 'sf-cam'].every(id => getComputedStyle(document.getElementById(id)).display === 'none') && getComputedStyle(document.getElementById('sf-adjust')).display !== 'none'`));
  await tab.evaluate(`window.kipSelfie.setFrame({ zoom: 1.4, rotateDeg: 6 })`);
  await tab.shot(path.join(SHOTS, "selfie-adjust.png"));
  await tab.evaluate(click("sf-use"));
  check("Use this face wears it: flat insert, selfie expression, modal closed",
    await tab.waitFor(`(() => { const l = window.kipMenu.ctx.loco; return l.expr === 'selfie' && l.faceInsert === 'flat' && !(${open}); })()`, 10000));
  check("the Face select names it and Remove appears", await tab.evaluate(`window.kipMenu.sync(), (() => { const f = window.kipMenu.fields.get('face').select; return f.value === 'selfie' && f.selectedOptions[0].textContent === 'Selfie (this device only)' && !window.kipMenu.fields.get('selfieRemove').root.hidden; })()`));
  const decal = await tab.evaluate(`(async () => { const sdk = await import('/kip/kip-forge-sdk.js?v=10.0'); const c = sdk.createDecalExpressionCanvas('selfie', 'kid', 'flat'); const g = c.getContext('2d'); const mid = g.getImageData(c.width / 2, c.height / 2, 1, 1).data; const corner = g.getImageData(1, 1, 1, 1).data; return { has: sdk.hasSelfieCanvas(), w: c.width, h: c.height, midA: mid[3], cornerA: corner[3] }; })()`);
  check("the face plate decal is the 512x256 selfie canvas, opaque in the middle and clear at the corners", decal.has && decal.w === 512 && decal.h === 256 && decal.midA === 255 && decal.cornerA === 0, JSON.stringify(decal));

  console.log("\n[2] privacy");
  const net = tab.requests.slice(mark).filter((r) => /^https?:/.test(r.url));
  check("zero network requests during the whole selfie flow (no image data leaves the page)", net.length === 0, net.map((r) => `${r.method} ${r.url}`).join(", "));
  const store = await tab.evaluate(`(async () => ({
    ls: Object.entries(localStorage).map(([k, v]) => [k, v.length]), ss: sessionStorage.length,
    idb: (await indexedDB.databases()).length, caches: (await caches.keys()).length, cookie: document.cookie.length,
    href: location.href.length, hasSelfieInUrl: /selfie|data:image|blob:/i.test(location.href),
  }))()`);
  check("nothing is stored: no web storage, IndexedDB, caches or cookies hold the photo", store.ss === 0 && store.idb === 0 && store.caches === 0 && store.cookie === 0 && store.ls.every(([, n]) => n < 40), JSON.stringify(store));
  check("nothing in the URL", !store.hasSelfieInUrl && store.href < 300, String(store.href));

  console.log("\n[3] sticker (L2): true size");
  // re-open the adjust step from an upload to export from a known picture
  await tab.evaluate(click("km-selfieRemove"));
  check("Remove puts the previous face and insert back and drops the canvas", await tab.waitFor(`(() => { const l = window.kipMenu.ctx.loco; return l.expr === 'spark' && l.faceInsert === 'sculpted' && !window.kipSelfie.active(); })()`, 10000)
    && await tab.evaluate(`import('/kip/kip-forge-sdk.js?v=10.0').then(s => !s.hasSelfieCanvas())`));
  await tab.evaluate(click("km-selfie"));
  await tab.waitFor(open, 10000);
  await uploadFixture(tab);
  check("upload reaches Adjust", await tab.waitFor(`${step} === 'adjust' && window.kipSelfie.hasImage()`, 15000));
  const sticker = await tab.evaluate(`window.kipSelfie.exportSticker().then(r => ({ b64: btoa(String.fromCharCode(...r.png)), svg: r.svg, w: r.widthPx, h: r.heightPx, dpi: r.dpi }))`);
  const png = Buffer.from(sticker.b64, "base64");
  const chunks = []; for (let o = 8; o < png.length;) { const len = png.readUInt32BE(o); chunks.push({ t: png.toString("latin1", o + 4, o + 8), d: png.subarray(o + 8, o + 8 + len) }); o += 12 + len; }
  const ihdr = chunks.find((c) => c.t === "IHDR").d, phys = chunks.find((c) => c.t === "pHYs")?.d;
  // physical size = pixels / (pixels per metre), in mm
  const mmW = (ihdr.readUInt32BE(0) / phys.readUInt32BE(0)) * 1000, mmH = (ihdr.readUInt32BE(4) / phys.readUInt32BE(4)) * 1000;
  check(`sticker PNG prints at 100% as ${mmW.toFixed(2)} x ${mmH.toFixed(2)} mm (window 23.6 x 10.1)`, Math.abs(mmW - 23.6) < 0.05 && Math.abs(mmH - 10.1) < 0.05, `${mmW} x ${mmH}`);
  check("sticker SVG is in mm with a cut line", /width="23\.6mm"/.test(sticker.svg) && /height="10\.1mm"/.test(sticker.svg) && /id="cut-line"/.test(sticker.svg));
  await tab.evaluate(click("sf-use"));
  await tab.waitFor(`window.kipMenu.ctx.loco.expr === 'selfie'`, 10000);

  console.log("\n[4] leaving a human head, or picking another face, takes the photo off");
  await tab.evaluate(`window.kipMenu.ctx.act.setHead('fox')`);
  check("switching to a non-human head restores the expression and drops the photo", await tab.waitFor(`window.kipMenu.ctx.loco.expr !== 'selfie' && !window.kipSelfie.active()`, 10000)
    && await tab.evaluate(`import('/kip/kip-forge-sdk.js?v=10.0').then(s => !s.hasSelfieCanvas())`));
  await tab.evaluate(`window.kipMenu.ctx.act.setHead('kid')`);
  await tab.evaluate(click("km-selfie")); await tab.waitFor(open, 10000); await uploadFixture(tab);
  await tab.waitFor(`${step} === 'adjust'`, 15000); await tab.evaluate(click("sf-use"));
  await tab.waitFor(`window.kipMenu.ctx.loco.expr === 'selfie'`, 10000);
  await tab.evaluate(`window.kipMenu.ctx.act.setFace('happy')`);
  check("picking another face removes the photo", await tab.waitFor(`window.kipMenu.ctx.loco.expr === 'happy' && !window.kipSelfie.active()`, 10000));

  console.log("\n[5] camera denied, no camera, Escape, close");
  await tab.evaluate(REJECT("NotAllowedError"));
  await tab.evaluate(click("km-selfie")); await tab.waitFor(open, 10000);
  await tab.evaluate(click("sf-start"));
  check("denied: says so plainly and keeps the upload path open", await tab.waitFor(`!document.getElementById('sf-error').hidden && /blocked/.test(document.getElementById('sf-error').textContent) && ${step} === 'intro'`, 10000));
  await uploadFixture(tab);
  check("denied: upload still reaches Adjust", await tab.waitFor(`${step} === 'adjust'`, 15000));
  await tab.evaluate(click("sf-retake"));
  await tab.evaluate(REJECT("NotFoundError"));
  await tab.evaluate(click("sf-start"));
  check("no camera: says so plainly and keeps the upload path open", await tab.waitFor(`/No camera/.test(document.getElementById('sf-error').textContent) && ${step} === 'intro'`, 10000));
  await tab.evaluate(click("sf-close"));
  await tab.evaluate(RESTORE);
  await tab.evaluate(click("km-selfie")); await tab.waitFor(open, 10000);
  await tab.evaluate(click("sf-start"));
  await tab.waitFor(`${liveTracks} === 1`, 30000);
  await tab.key("Escape");
  check("Escape closes the modal and stops the camera", await tab.waitFor(`!(${open}) && ${liveTracks} === 0`, 10000));
  await tab.evaluate(click("km-selfie")); await tab.waitFor(open, 10000);
  await tab.evaluate(click("sf-start"));
  await tab.waitFor(`${liveTracks} === 1`, 30000);
  await tab.evaluate(click("sf-close"));
  check("Close stops the camera", await tab.waitFor(`${liveTracks} === 0`, 10000));
  await tab.evaluate(click("km-selfie")); await tab.waitFor(open, 10000);
  await tab.evaluate(click("sf-start"));
  await tab.waitFor(`${liveTracks} === 1`, 30000);
  await tab.evaluate(`window.dispatchEvent(new Event('pagehide'))`);
  check("page hide stops the camera", await tab.waitFor(`${liveTracks} === 0`, 10000));
  await tab.evaluate(click("sf-close"));
  check("no page exceptions", tab.exceptions.length === 0, tab.exceptions[0]);

  console.log("\n[6] reload leaves no selfie and no camera");
  await tab.evaluate(click("km-selfie")); await tab.waitFor(open, 10000); await uploadFixture(tab);
  await tab.waitFor(`${step} === 'adjust'`, 15000); await tab.evaluate(click("sf-use"));
  await tab.waitFor(`window.kipMenu.ctx.loco.expr === 'selfie'`, 10000);
  await tab.send("Page.reload");
  check("after reload the demo is back with no selfie and no live tracks", await tab.waitFor(`window.__KIP_READY__ === true && !!window.kipMenu`, 180000)
    && await tab.evaluate(`window.kipMenu.ctx.loco.expr !== 'selfie' && !window.kipSelfie.active() && !(window.__streams && window.__streams.length)`));
  check("reload left nothing behind in storage", await tab.evaluate(`(async () => sessionStorage.length === 0 && (await indexedDB.databases()).length === 0 && (await caches.keys()).length === 0)()`));
  tab.close();

  console.log("\n[7] every human head shows it (visual)");
  const t2 = await chrome.open(`${server.base}/kip/Kip-Demo.html?menu=side&cat=human&cam=head_close`);
  await t2.waitFor("window.__KIP_READY__ === true && !!window.kipSelfie", 180000);
  await t2.evaluate(click("km-selfie")); await t2.waitFor(open, 10000); await uploadFixture(t2);
  await t2.waitFor(`${step} === 'adjust'`, 15000); await t2.evaluate(click("sf-use"));
  for (const head of ["kid", "chibi", "tall", "jumbo"]) {
    await t2.evaluate(`window.kipMenu.ctx.act.setHead('${head}')`);
    const ok = await t2.waitFor(`window.kipMenu.ctx.loco.head === '${head}' && window.kipMenu.ctx.loco.expr === 'selfie'`, 10000);
    check(`${head}: still wearing the selfie on the flat insert`, ok && await t2.evaluate(`window.kipMenu.ctx.loco.faceInsert === 'flat'`));
    await new Promise((r) => setTimeout(r, 900));
    await t2.shot(path.join(SHOTS, `selfie-head-${head}.png`));
  }
  check("no page exceptions on the head sweep", t2.exceptions.length === 0, t2.exceptions[0]);
  t2.close();
  console.log(`\nscreenshots: ${SHOTS}`);
} finally {
  chrome.close();
  server.close();
  finish();
}
