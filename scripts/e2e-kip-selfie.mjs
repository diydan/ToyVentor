#!/usr/bin/env node
// Kip demo selfie face: headless-Chrome checks for Phase 3 (L1 + L2 sticker) of docs/specs/kip-demo-implementation.md,
// plus the rounded face plate window, the background cut-out and the 2D face art staying on the plate.
// Run: npm run e2e:kip-selfie     Exits nonzero on any failing check.
// Uses Chrome's fake camera (--use-fake-device-for-media-stream) and a generated cartoon portrait only: no real faces.
// Env: E2E_CHROME, E2E_SHOTS (see scripts/lib/kip-e2e.mjs).
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { createChecks, launchChrome, startServer } from "./lib/kip-e2e.mjs";

const SHOTS = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), "kip-selfie-shots");
const { check, finish } = createChecks("kip selfie e2e");

/** A generated cartoon portrait (not a photo): head, hair, eyes, mouth, shoulders on a gradient wall. Portrait shaped, like a phone selfie. */
function makePng(w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  const cx = w / 2, cy = h * 0.46, ry = h * 0.27, rx = ry * 0.78;
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 4 + 1) + 1 + x * 4;
      let c = [70 + (x / w) * 110, 100 + (y / h) * 70, 170 - (x / w) * 70]; // wall
      if (y > cy + ry * 0.9 && Math.abs(x - cx) < rx * 2.1) c = [60, 110, 190]; // shirt
      if (y > cy + ry * 0.6 && Math.abs(x - cx) < rx * 0.35) c = [205, 158, 128]; // neck
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      if (dx * dx + dy * dy < 1) {
        c = [224 - 25 * (dx + 0.3) * (dx + 0.3), 172 - 20 * dy, 140];
        if (dy < -0.35 + 0.25 * dx * dx) c = [58, 38, 28];
        for (const ex of [-0.38, 0.38]) {
          if (((dx - ex) / 0.16) ** 2 + ((dy + 0.02) / 0.09) ** 2 < 1) c = [250, 250, 250];
          if (((dx - ex) / 0.07) ** 2 + ((dy + 0.02) / 0.09) ** 2 < 1) c = [30, 24, 22];
        }
        if (Math.abs(dy - 0.45 - 0.08 * dx * dx) < 0.035 && Math.abs(dx) < 0.28) c = [170, 60, 70];
      }
      raw.set([...c.map((v) => Math.max(0, Math.min(255, Math.round(v)))), 255], o);
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
const FIXTURE = path.join(mkdtempSync(path.join(os.tmpdir(), "kip-selfie-fixture-")), "portrait.png");
writeFileSync(FIXTURE, makePng(360, 480));

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
const SHAPE = `import('/kip/kip-faceplate-shape.js?v=10.0')`;
const SELFIE = `import('/kip/kip-selfie.js?v=10.0')`;
const canvasAlpha = (xf, yf) => `(() => { const c = document.getElementById('sf-canvas'); return c.getContext('2d').getImageData(Math.round(c.width * ${xf}), Math.round(c.height * ${yf}), 1, 1).data[3]; })()`;
const click = (id) => `document.getElementById('${id}').click()`;

const server = await startServer();
const chrome = await launchChrome({ width: 1440, height: 900 });
try {
  console.log(`serving ${server.base}`);
  const tab = await chrome.open(`${server.base}/kip/Kip-Demo.html?cat=human`);
  check("demo initialises with the selfie module mounted", await tab.waitFor("window.__KIP_READY__ === true && !!window.kipSelfie", 180000), tab.exceptions[0]);
  check("starts on a human head with the selfie entry visible", await tab.waitFor(`window.kipMenu.ctx.loco.category === 'human' && !window.kipMenu.fields.get('selfie').root.hidden`, 20000));
  await tab.evaluate(INSTRUMENT);
  const mark = tab.requests.length;

  console.log("\n[1] camera path: tap to start, countdown, snap, adjust, apply");
  await tab.evaluate(click("km-selfie"));
  check("opens a modal with a privacy line and labelled choices", await tab.waitFor(open, 10000) && await tab.evaluate(`/Stays on this device/.test(document.getElementById('sf-privacy').textContent) && /Start camera/.test(document.getElementById('sf-start').textContent) && !!document.getElementById('sf-upload-label')`));
  check("the camera has NOT started before the tap", (await tab.evaluate(`window.__streams.length`)) === 0 && (await tab.evaluate(step)) === "intro");
  await tab.evaluate(click("sf-start"));
  check("camera starts after the tap and shows a live preview", await tab.waitFor(`${step} === 'camera' && document.getElementById('sf-video').videoWidth > 0 && ${liveTracks} === 1`, 90000));
  await tab.shot(path.join(SHOTS, "selfie-camera.png"));
  await tab.evaluate(click("sf-snap"));
  check("a countdown runs before the snap", await tab.waitFor(`window.kipSelfie.state.countdown > 0`, 5000));
  check("snapping moves to Adjust and the camera is released at once", await tab.waitFor(`${step} === 'adjust' && ${liveTracks} === 0 && window.__streams[0].getTracks().every(t => t.readyState === 'ended')`, 60000));
  const drawn = await tab.evaluate(`(() => { const c = document.getElementById('sf-canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const seen = new Set(); for (let i = 0; i < d.length; i += 4 * 97) seen.add((d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4)); return { colours: seen.size, cornerAlpha: d[3] }; })()`);
  check("Adjust shows the framed, styled picture inside a rounded window", drawn.colours > 1 && drawn.cornerAlpha === 0, JSON.stringify(drawn));
  const dims = await tab.evaluate(`${SELFIE}.then(m => ({ w: m.CANVAS_PX.w, h: m.CANVAS_PX.h, mmw: m.WINDOW_MM.w, mmh: m.WINDOW_MM.h, ppm: m.PX_PER_MM, cw: document.getElementById('sf-canvas').width, ch: document.getElementById('sf-canvas').height }))`);
  check(`the picture canvas is ${dims.w}x${dims.h}, the same pixels per mm both ways, matching the ${dims.mmw} x ${dims.mmh} mm window`, dims.cw === dims.w && dims.ch === dims.h && Math.abs(dims.w / dims.mmw - dims.h / dims.mmh) < 0.1 && Math.abs(dims.w / dims.mmw - dims.ppm) < 0.1, JSON.stringify(dims));
  const corners = await Promise.all([[0.01, 0.02], [0.99, 0.02], [0.01, 0.98], [0.99, 0.98]].map(([x, y]) => tab.evaluate(canvasAlpha(x, y))));
  check("all four corners of the window box are clear: the window is rounded, not a rectangle", corners.every((a) => a === 0), corners.join(","));
  check("Photo is the default style for a camera selfie (Toon and Sketch are one tap away)", await tab.evaluate(`document.querySelector('input[name=sf-style]:checked').value === 'photo' && window.kipSelfie.state.style === 'photo' && [...document.querySelectorAll('input[name=sf-style]')].map(r => r.value).join() === 'photo,toon,sketch'`));
  // spacing: the controls sit clear of the picture, and the two sliders have room (the Adjust screen used to feel cramped)
  const gaps = await tab.evaluate(`(() => { const r = (id) => document.getElementById(id).getBoundingClientRect(); const stage = r('sf-stage'), zoom = r('sf-zoom'), rot = r('sf-rot'), intro = document.getElementById('sf-privacy').getBoundingClientRect(); return { stageToControls: zoom.top - stage.bottom, introToStage: stage.top - intro.bottom, sliderGap: rot.left - zoom.right, sliderW: zoom.width }; })()`);
  check("the Adjust screen has breathing room: at least 24 px between the picture and the sliders, 8 px above the picture, and the sliders sit apart", gaps.stageToControls >= 24 && gaps.introToStage >= 8 && gaps.sliderGap >= 16 && gaps.sliderW >= 120, JSON.stringify(gaps));
  check("only the Adjust step is showing (no leftover camera/upload buttons)", await tab.evaluate(`['sf-intro', 'sf-cam'].every(id => getComputedStyle(document.getElementById(id)).display === 'none') && getComputedStyle(document.getElementById('sf-adjust')).display !== 'none'`));
  await tab.evaluate(`window.kipSelfie.setFrame({ zoom: 1.4, rotateDeg: 6 })`);
  await tab.shot(path.join(SHOTS, "selfie-adjust.png"));
  await tab.evaluate(click("sf-use"));
  check("Use this face wears it: flat insert, selfie expression, modal closed",
    await tab.waitFor(`(() => { const l = window.kipMenu.ctx.loco; return l.expr === 'selfie' && l.faceInsert === 'flat' && !(${open}); })()`, 10000));
  check("the Face select names it and Remove appears", await tab.evaluate(`window.kipMenu.sync(), (() => { const f = window.kipMenu.fields.get('face').select; return f.value === 'selfie' && f.selectedOptions[0].textContent === 'Selfie (not saved)' && !window.kipMenu.fields.get('selfieRemove').root.hidden; })()`));
  const decal = await tab.evaluate(`(async () => { const sdk = await import('/kip/kip-forge-sdk.js?v=10.0'); const c = sdk.createDecalExpressionCanvas('selfie', 'kid', 'flat'); const g = c.getContext('2d'); const mid = g.getImageData(c.width / 2, c.height / 2, 1, 1).data; const corner = g.getImageData(1, 1, 1, 1).data; return { has: sdk.hasSelfieCanvas(), w: c.width, h: c.height, midA: mid[3], cornerA: corner[3] }; })()`);
  check(`the face plate decal is the selfie canvas (${dims.w}x${dims.h}), solid in the middle and clear at the corners`, decal.has && decal.w === dims.w && decal.h === dims.h && decal.midA === 255 && decal.cornerA === 0, JSON.stringify(decal));

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
  // portrait photo: the zoom slider can go below 1 so the whole head fits the short window, and starts there
  const zoom = await tab.evaluate(`(() => { const z = document.getElementById('sf-zoom'); return { min: +z.min, max: +z.max, value: +z.value }; })()`);
  check("a portrait photo starts zoomed out to fit a head, and the slider reaches its full height", zoom.min < 0.6 && zoom.value >= zoom.min && zoom.value < 1 && zoom.max === 8, JSON.stringify(zoom));
  await tab.evaluate(`window.kipSelfie.setStyle('toon')`);
  const cut = await tab.evaluate(`(() => { const s = window.kipSelfie; const c = document.getElementById('sf-canvas'); const at = (xf, yf) => c.getContext('2d').getImageData(Math.round(c.width * xf), Math.round(c.height * yf), 1, 1).data[3]; const on = { wall: at(0.06, 0.5), face: at(0.5, 0.5) }; s.setCutout(false); const off = { wall: at(0.06, 0.5), face: at(0.5, 0.5) }; s.setCutout(true); return { on, off, flag: s.state.cutout }; })()`);
  check("Remove background clears the wall beside the head and keeps the face; turning it off keeps the wall", cut.on.wall === 0 && cut.on.face === 255 && cut.off.wall === 255 && cut.off.face === 255 && cut.flag === true, JSON.stringify(cut));
  const palette = await tab.evaluate(`(() => { const c = document.getElementById('sf-canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const seen = new Set(); for (let i = 0; i < d.length; i += 4) if (d[i + 3] === 255) seen.add(d[i] + ',' + d[i + 1] + ',' + d[i + 2]); return seen.size; })()`); // solid pixels only: the window edge is anti-aliased
  check("Toon flattens the face to six colours plus ink", palette >= 3 && palette <= 8, String(palette));
  await tab.evaluate(`window.kipSelfie.setStyle('photo')`);
  const photoCut = await tab.evaluate(`(() => { const c = document.getElementById('sf-canvas'); return c.getContext('2d').getImageData(Math.round(c.width * 0.06), Math.round(c.height * 0.5), 1, 1).data[3]; })()`);
  await tab.evaluate(`window.kipSelfie.setStyle('toon')`);
  check("the cut-out applies to Photo too (the wall stays clear)", photoCut === 0, String(photoCut));
  await tab.shot(path.join(SHOTS, "selfie-cutout.png"));
  const sticker = await tab.evaluate(`window.kipSelfie.exportSticker().then(r => ({ b64: btoa(String.fromCharCode(...r.png)), svg: r.svg, w: r.widthPx, h: r.heightPx, dpi: r.dpi }))`);
  const png = Buffer.from(sticker.b64, "base64");
  const chunks = []; for (let o = 8; o < png.length;) { const len = png.readUInt32BE(o); chunks.push({ t: png.toString("latin1", o + 4, o + 8), d: png.subarray(o + 8, o + 8 + len) }); o += 12 + len; }
  const ihdr = chunks.find((c) => c.t === "IHDR").d, phys = chunks.find((c) => c.t === "pHYs")?.d;
  // physical size = pixels / (pixels per metre), in mm
  const mmW = (ihdr.readUInt32BE(0) / phys.readUInt32BE(0)) * 1000, mmH = (ihdr.readUInt32BE(4) / phys.readUInt32BE(4)) * 1000;
  check(`sticker PNG prints at 100% as ${mmW.toFixed(2)} x ${mmH.toFixed(2)} mm (window ${dims.mmw} x ${dims.mmh})`, Math.abs(mmW - dims.mmw) < 0.05 && Math.abs(mmH - dims.mmh) < 0.05, `${mmW} x ${mmH}`);
  check("sticker SVG is in mm with a cut line shaped like the rounded window", new RegExp(`width="${dims.mmw}mm"`).test(sticker.svg) && new RegExp(`height="${dims.mmh}mm"`).test(sticker.svg) && /<path id="cut-line" d="M[^"]+ Z"/.test(sticker.svg) && !/<rect/.test(sticker.svg));
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
  await tab.waitFor(`${liveTracks} === 1`, 90000);
  await tab.key("Escape");
  check("Escape closes the modal and stops the camera", await tab.waitFor(`!(${open}) && ${liveTracks} === 0`, 10000));
  await tab.evaluate(click("km-selfie")); await tab.waitFor(open, 10000);
  await tab.evaluate(click("sf-start"));
  await tab.waitFor(`${liveTracks} === 1`, 90000);
  await tab.evaluate(click("sf-close"));
  check("Close stops the camera", await tab.waitFor(`${liveTracks} === 0`, 10000));
  await tab.evaluate(click("km-selfie")); await tab.waitFor(open, 10000);
  await tab.evaluate(click("sf-start"));
  await tab.waitFor(`${liveTracks} === 1`, 90000);
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
  const t2 = await chrome.open(`${server.base}/kip/Kip-Demo.html?cat=human&cam=head_close`);
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

  console.log("\n[8] the 2D face art stays inside the rounded plate");
  {
    const t3 = await chrome.open(`${server.base}/kip/Kip-Demo.html?cat=human`);
    await t3.waitFor("window.__KIP_READY__ === true", 180000);
    const art = await t3.evaluate(`(async () => {
      const sdk = await import('/kip/kip-forge-sdk.js?v=10.0'); const shape = await import('/kip/kip-faceplate-shape.js?v=10.0');
      const bad = []; let drawn = 0;
      for (const head of ['kid', 'chibi', 'tall', 'jumbo']) for (const insert of ['sculpted', 'vinyl', 'flat']) for (const e of sdk.DECAL_EXPRESSIONS) {
        const c = sdk.createDecalExpressionCanvas(e.id, head, insert, { onPlate: true });
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        for (let row = 0; row < c.height; row += 3) {
          const zb = 10.3 - row / 25.35, hw = shape.plateHalfWidth(zb);
          for (let col = 0; col < c.width; col++) {
            const a = d[(row * c.width + col) * 4 + 3];
            if (a > 8) { drawn++; if (Math.abs(col + 0.5 - 256) / 21.69 > hw - 0.3) { bad.push(head + '/' + insert + '/' + e.id + ' row ' + row + ' col ' + col); break; } }
          }
        }
      }
      return { drawn, bad: bad.slice(0, 5), n: bad.length };
    })()`);
    check("no face art pixel sits past the plate outline (4 heads x 3 inserts x 8 faces)", art.drawn > 1000 && art.n === 0, JSON.stringify(art));
    const classic = await t3.evaluate(`(async () => { const sdk = await import('/kip/kip-forge-sdk.js?v=10.0'); const c = sdk.createDecalExpressionCanvas('happy', 'kid', 'vinyl'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let far = 0; for (let row = 150; row < 250; row++) for (let col = 0; col < 120; col++) if (d[(row * c.width + col) * 4 + 3] > 8) far++; return far; })()`);
    check("art for the classic head and others (no plate) is not clipped or moved", classic > 20, String(classic));
    check("no page exceptions", t3.exceptions.length === 0, t3.exceptions[0]);
    t3.close();
  }
  console.log("\n[8b] line up eyes and mouth: two taps zoom and turn the photo onto the plate's marks");
  {
    const t8 = await chrome.open(`${server.base}/kip/Kip-Demo.html?cat=human`);
    await t8.waitFor("window.__KIP_READY__ === true && !!window.kipSelfie", 180000);
    await t8.evaluate(click("km-selfie")); await t8.waitFor(open, 10000); await uploadFixture(t8);
    await t8.waitFor(`${step} === 'adjust'`, 15000);
    await t8.evaluate(`window.kipSelfie.setCutout(false); window.kipSelfie.setStyle('photo')`);
    const before = await t8.evaluate(`document.getElementById('sf-zoom').value`);
    await t8.evaluate(click("sf-align"));
    check("Line up opens a picker over the whole photo with the first instruction", await t8.waitFor(`window.kipSelfie.state.pick === 'eyes' && !document.getElementById('sf-pick').hidden && document.getElementById('sf-adjust').hidden && /between the eyes/.test(document.getElementById('sf-pick-help').textContent)`, 5000));
    // the fixture head is centred at (w/2, 0.46h), ry 0.27h, rx 0.78 ry; eyes at +-0.38 rx, y -0.02 ry; mouth at y +0.45 ry
    const rect = await t8.evaluate(`(() => { const r = document.getElementById('sf-pick-canvas').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
    const W = 360, H = 480, cy = 0.46 * H, ry = 0.27 * H;
    const tap = async (px, py) => { const x = rect.x + (px / W) * rect.w, y = rect.y + (py / H) * rect.h; await t8.evaluate(`document.getElementById('sf-pick-canvas').dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: ${x}, clientY: ${y} }))`); };
    await tap(W / 2, cy - 0.02 * ry);
    check("after the first tap it asks for the mouth", await t8.waitFor(`window.kipSelfie.state.pick === 'mouth' && /mouth/.test(document.getElementById('sf-pick-help').textContent)`, 5000));
    await tap(W / 2, cy + 0.45 * ry);
    check("the second tap returns to Adjust and zooms the photo in", await t8.waitFor(`window.kipSelfie.state.pick === '' && document.getElementById('sf-pick').hidden && !document.getElementById('sf-adjust').hidden`, 5000)
      && await t8.evaluate(`Number(document.getElementById('sf-zoom').value) > ${Number(before) * 1.5}`));
    // The picture now has the eye midpoint on the eye line and the mouth on the plate's smile. Line-up fixes those two points (a zoom,
    // a turn, a shift), not the eye spacing, so each pupil is where the face's own spacing puts it: 0.38 head half-widths either side.
    const marks = await t8.evaluate(`(async () => { const shape = await ${SHAPE}; const t = shape.faceTargetFractions(); const c = document.getElementById('sf-canvas'); const g = c.getContext('2d');
      const ryS = ${0.27 * H}, rxS = 0.78 * ryS, eyeToMouthSrc = 0.47 * ryS; // the fixture's own geometry, in source pixels
      const scale = ((t.mouth.y - t.leftEye.y) * c.height) / eyeToMouthSrc; // source px -> canvas px after the line-up
      const off = (0.38 * rxS * scale) / c.width;
      const near = (fx, fy) => { let best = 999; for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) { const d = g.getImageData(Math.round(c.width * fx) + dx, Math.round(c.height * fy) + dy, 1, 1).data; best = Math.min(best, d[0] * 0.3 + d[1] * 0.59 + d[2] * 0.11); } return best; };
      const mid = g.getImageData(Math.round(c.width * 0.5), Math.round(c.height * t.leftEye.y), 1, 1).data;
      const m = g.getImageData(Math.round(c.width * t.mouth.x), Math.round(c.height * t.mouth.y), 1, 1).data;
      return { leftDark: near(0.5 - off, t.leftEye.y), rightDark: near(0.5 + off, t.leftEye.y), midLum: mid[0] * 0.3 + mid[1] * 0.59 + mid[2] * 0.11, mouth: Array.from(m) }; })()`);
    check("a dark pupil sits at each eye (spacing as in the photo) on the plate's eye line, with skin between them", marks.leftDark < 70 && marks.rightDark < 70 && marks.midLum > 110, JSON.stringify(marks));
    check("the mouth mark lands on the mouth (red, not skin)", marks.mouth[0] > 120 && marks.mouth[1] < 110 && marks.mouth[3] === 255, JSON.stringify(marks.mouth));
    await t8.shot(path.join(SHOTS, "selfie-lineup.png"));
    await t8.evaluate(click("sf-align")); await t8.key("Escape");
    check("Escape in the picker cancels it without closing the modal", await t8.waitFor(`window.kipSelfie.state.pick === '' && ${open} && ${step} === 'adjust'`, 5000));
    check("no page exceptions", t8.exceptions.length === 0, t8.exceptions[0]);
    t8.close();
  }

  console.log("\n[9] prompt-a-face: typed words load a sample face with no network");
  // its own tab: the first one was closed at the end of [6]
  const t9 = await chrome.open(`${server.base}/kip/Kip-Demo.html?cat=human`);
  await t9.waitFor("window.__KIP_READY__ === true && !!window.kipSelfie", 180000);
  const mark9 = t9.requests.length;
  await t9.evaluate(click("km-selfie"));
  await t9.waitFor(open, 10000);
  check("the prompt box is offered on the intro step", await t9.evaluate(`!!document.getElementById('sf-prompt') && !!document.getElementById('sf-prompt-go') && getComputedStyle(document.getElementById('sf-prompt-row')).display !== 'none'`));
  await t9.evaluate(`{ document.getElementById('sf-prompt').value = 'a fire-breathing dragon'; }`);
  await t9.evaluate(click("sf-prompt-go"));
  check("an unmatched prompt explains itself and stays put", await t9.waitFor(`window.kipSelfie.state.step === 'intro' && /No sample face/.test(document.getElementById('sf-error').textContent)`, 5000));
  await t9.evaluate(`{ document.getElementById('sf-prompt').value = 'a brave knight'; }`);
  await t9.evaluate(click("sf-prompt-go"));
  check("a prompt reaches Adjust with a picture", await t9.waitFor(`${step} === 'adjust' && window.kipSelfie.hasImage()`, 15000));
  // the browser asks for /favicon.ico lazily on a fresh tab; it is a bare GET of a static icon, not part of the selfie flow
  const net9 = t9.requests.slice(mark9).filter((r) => /^https?:/.test(r.url) && !/\/favicon\.ico$/.test(r.url));
  // a gallery face is lined up automatically: its mouth (a dark line) must sit on the plate's smile ridge mark
  const mouthOnRidge = await t9.evaluate(`(async () => { const shape = await ${SHAPE}; const t = shape.faceTargetFractions(); const c = document.getElementById('sf-canvas'); const g = c.getContext('2d'); let best = 999; for (let dy = -9; dy <= 9; dy++) for (let dx = -14; dx <= 14; dx++) { const d = g.getImageData(Math.round(c.width * t.mouth.x) + dx, Math.round(c.height * t.mouth.y) + dy, 1, 1).data; if (d[3] > 200) best = Math.min(best, d[0] * 0.3 + d[1] * 0.59 + d[2] * 0.11); } return best; })()`);
  check("the prompted face is lined up: its mouth sits on the printed smile mark", mouthOnRidge < 110, String(mouthOnRidge));
  check("prompting a face made zero network requests (preloaded with the page)", net9.length === 0, net9.map((r) => `${r.method} ${r.url}`).join(", "));
  await t9.shot(path.join(SHOTS, "selfie-prompt.png"));
  await t9.evaluate(click("sf-use"));
  check("Use this face wears the prompted face", await t9.waitFor(`(() => { const l = window.kipMenu.ctx.loco; return l.expr === 'selfie' && !(${open}); })()`, 10000));
  await t9.evaluate(`(() => { const i = document.getElementById('km-plateView'); i.checked = true; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await t9.waitFor(`window.kipPrint.isOn() && !window.kipPrint.isBusy()`, 120000);
  const selfieStickerCheck = await t9.evaluate(`(async () => {
    const pdf = await window.kipPrint.exportBytes('stickers-pdf');
    const head = new TextDecoder('latin1').decode(pdf.subarray(0, 128));
    const smallStorage = Object.values(localStorage).every(v => v.length < 80) && sessionStorage.length === 0;
    return { isPdf: head.startsWith('%PDF-1.6'), bytes: pdf.length, smallStorage, cleanUrl: !location.href.includes('data:') };
  })()`);
  check("selfie sticker sheet PDF exports cleanly in memory with zero storage or URL pixel leaks", selfieStickerCheck.isPdf && selfieStickerCheck.bytes > 1500 && selfieStickerCheck.smallStorage && selfieStickerCheck.cleanUrl, JSON.stringify(selfieStickerCheck));
  check("no page exceptions", t9.exceptions.length === 0, t9.exceptions[0]);
  t9.close();


  console.log("\n[10] Smart face (opt-in online helper): consent, grown-up gate, one picture, nothing kept (all server calls are stubs)");
  {
    const jpegSize = (b64) => { const buf = Buffer.from(b64, "base64"); for (let o = 2; o < buf.length;) { if (buf[o] !== 0xff) { o++; continue; } const m = buf[o + 1]; if (m >= 0xc0 && m <= 0xc3) return { h: buf.readUInt16BE(o + 5), w: buf.readUInt16BE(o + 7), bytes: buf.length }; o += 2 + buf.readUInt16BE(o + 2); } return null; };
    const W = 360, H = 480, cy = 0.46 * H, ry = 0.27 * H, rx = 0.78 * ry;
    const parts = { status: "ok", eyes: [{ x: (W / 2 - 0.38 * rx) / W, y: (cy - 0.02 * ry) / H }, { x: (W / 2 + 0.38 * rx) / W, y: (cy - 0.02 * ry) / H }], mouth: { x: 0.5, y: (cy + 0.45 * ry) / H } };
    const DEVICE = "e2e-device-0123456789abcdef";
    let partsReply = () => ({ json: parts });
    server.apiCalls.length = 0;
    server.mock("POST", "/api/parent/gate", ({ json }) => (json.action === "challenge"
      ? { json: { mode: "math", a: 15, b: 7, challengeToken: "ct-e2e" } }
      : json.answer === 105 ? { json: { ok: true, proofToken: "proof-e2e", expiresAt: Date.now() + 120000 } } : { status: 403, json: { ok: false, error: "incorrect answer" } }));
    server.mock("POST", "/api/selfie/face-parts", () => partsReply());
    server.mock("POST", "/api/selfie/cartoon", () => ({ json: { status: "ok", image: `data:image/png;base64,${readFileSync(FIXTURE).toString("base64")}` } }));
    const t10 = await chrome.open(`${server.base}/kip/Kip-Demo.html?cat=human`);
    await t10.waitFor("window.__KIP_READY__ === true && !!window.kipSelfie", 180000);
    await t10.evaluate(`localStorage.setItem('toyforge:device:v1', '${DEVICE}')`); // the app's anonymous id, as src/lib/sync.ts would have stored it
    const api = () => server.apiCalls.filter((c) => c.path.startsWith("/api/"));
    const gateCalls = () => api().filter((c) => c.path === "/api/parent/gate").length;
    const picCalls = () => api().filter((c) => c.path.startsWith("/api/selfie/"));
    await t10.evaluate(click("km-selfie")); await t10.waitFor(open, 10000); await uploadFixture(t10);
    await t10.waitFor(`${step} === 'adjust'`, 15000);
    await t10.evaluate(`window.kipSelfie.setCutout(false); window.kipSelfie.setStyle('photo')`);
    check("a picture is on screen and the server has heard nothing", api().length === 0);
    await t10.evaluate(click("sf-smart"));
    check("Smart face opens the consent screen first, naming where the picture would go and that a grown-up must say yes", await t10.waitFor(`window.kipSelfie.state.smart === 'consent' && !document.getElementById('sf-smart-consent').hidden && document.getElementById('sf-adjust').hidden && /Meta's AI service/.test(document.getElementById('sf-smart-consent').textContent) && /grown-up has to say yes/.test(document.getElementById('sf-smart-consent').textContent) && /does not save it/.test(document.getElementById('sf-smart-consent').textContent)`, 5000));
    check("the consent screen has sent nothing", api().length === 0);
    await t10.evaluate(click("sf-smart-no"));
    check("No thanks goes straight back with nothing sent", await t10.waitFor(`window.kipSelfie.state.smart === '' && !document.getElementById('sf-adjust').hidden`, 5000) && api().length === 0);
    await t10.evaluate(click("sf-smart")); await t10.evaluate(click("sf-smart-yes"));
    check("a grown-up saying yes asks the app's parent gate for a question (only the gate is called, with the device id)", await t10.waitFor(`window.kipSelfie.state.smart === 'gate' && /15 × 7/.test(document.getElementById('sf-gate-q').textContent)`, 10000)
      && api().length === 1 && api()[0].path === "/api/parent/gate" && api()[0].headers["x-device-id"] === DEVICE && picCalls().length === 0);
    await t10.evaluate(`document.getElementById('sf-gate-input').value = '100'; ${click("sf-gate-ok")}`);
    check("a wrong answer is refused, says so, and still sends no picture", await t10.waitFor(`!document.getElementById('sf-gate-err').hidden && /not it/.test(document.getElementById('sf-gate-err').textContent) && window.kipSelfie.state.smart === 'gate'`, 10000) && picCalls().length === 0);
    await t10.evaluate(`document.getElementById('sf-gate-input').value = '105'; ${click("sf-gate-ok")}`);
    check("the right answer moves on to the choice, still nothing sent", await t10.waitFor(`window.kipSelfie.state.smart === 'choose'`, 10000) && picCalls().length === 0);
    await t10.evaluate(click("sf-smart-parts"));
    check("Find the eyes and mouth sends exactly one picture, then lines the face up", await t10.waitFor(`window.kipSelfie.state.smart === '' && !document.getElementById('sf-adjust').hidden`, 20000) && picCalls().length === 1);
    const sent = picCalls()[0];
    const sentJson = JSON.parse(sent.body);
    const dim = jpegSize(sentJson.image.split(",")[1]);
    check("the request is one JPEG, resized to at most 768 px and a few hundred KB, with the proof, the consent version and the device id, and no cookie", sent.path === "/api/selfie/face-parts" && sentJson.image.startsWith("data:image/jpeg;base64,") && Object.keys(sentJson).join() === "image"
      && dim && Math.max(dim.w, dim.h) <= 768 && dim.bytes < 250000 && sent.headers["x-parent-proof"] === "proof-e2e" && sent.headers["x-selfie-consent"] === "v1" && sent.headers["x-device-id"] === DEVICE && !sent.headers.cookie, JSON.stringify({ dim, headers: Object.keys(sent.headers) }));
    const lined = await t10.evaluate(`(async () => { const shape = await ${SHAPE}; const t = shape.faceTargetFractions(); const c = document.getElementById('sf-canvas'); const g = c.getContext('2d'); const m = g.getImageData(Math.round(c.width * t.mouth.x), Math.round(c.height * t.mouth.y), 1, 1).data; return Array.from(m); })()`);
    check("the stubbed eyes and mouth lined the picture up: the mouth is on the printed smile mark", lined[0] > 120 && lined[1] < 110 && lined[3] === 255, JSON.stringify(lined));
    const gatesBefore = gateCalls();
    await t10.evaluate(click("sf-smart"));
    check("Smart face asks for consent again for the next use, and a grown-up who passed the gate a moment ago is not quizzed twice", await t10.waitFor(`window.kipSelfie.state.smart === 'consent'`, 5000));
    await t10.evaluate(click("sf-smart-yes"));
    check("...it goes straight to the choice with no new gate request", await t10.waitFor(`window.kipSelfie.state.smart === 'choose'`, 5000) && gateCalls() === gatesBefore);
    await t10.evaluate(click("sf-smart-cartoon"));
    check("Make it a cartoon sends one picture to the cartoon route, then one more to line the cartoon up, and shows the cartoon", await t10.waitFor(`window.kipSelfie.state.smart === '' && !document.getElementById('sf-adjust').hidden && window.kipSelfie.state.style === 'photo'`, 30000)
      && picCalls().map((c) => c.path).join() === "/api/selfie/face-parts,/api/selfie/cartoon,/api/selfie/face-parts");
    await t10.shot(path.join(SHOTS, "selfie-smart.png"));
    // the grown-up check runs out: the server answers 401, the screen asks the grown-up again instead of failing quietly
    partsReply = () => ({ status: 401, json: { status: "gate-required" } });
    await t10.evaluate(click("sf-smart")); await t10.evaluate(click("sf-smart-yes"));
    await t10.waitFor(`window.kipSelfie.state.smart === 'choose'`, 5000);
    await t10.evaluate(click("sf-smart-parts"));
    check("an expired grown-up check goes back to the gate with a plain sentence", await t10.waitFor(`window.kipSelfie.state.smart === 'gate' && /ran out/.test(document.getElementById('sf-error').textContent)`, 15000));
    await t10.evaluate(click("sf-gate-cancel"));
    // a deployment where the helper is off answers disabled
    partsReply = () => ({ status: 503, json: { status: "disabled" } });
    await t10.evaluate(click("sf-smart")); await t10.evaluate(click("sf-smart-yes"));
    await t10.waitFor(`window.kipSelfie.state.smart === 'gate'`, 10000);
    await t10.evaluate(`document.getElementById('sf-gate-input').value = '105'; ${click("sf-gate-ok")}`);
    await t10.waitFor(`window.kipSelfie.state.smart === 'choose'`, 10000);
    await t10.evaluate(click("sf-smart-parts"));
    check("a switched-off helper says so calmly and the manual line-up is still there", await t10.waitFor(`window.kipSelfie.state.smart === '' && /not turned on here/.test(document.getElementById('sf-error').textContent) && !document.getElementById('sf-align').hidden`, 15000));
    // closing the modal ends the grown-up's proof and forgets the consent
    await t10.evaluate(click("sf-close"));
    const gatesClosed = gateCalls();
    await t10.evaluate(click("km-selfie")); await t10.waitFor(open, 10000); await uploadFixture(t10);
    await t10.waitFor(`${step} === 'adjust'`, 15000);
    await t10.evaluate(click("sf-smart")); await t10.evaluate(click("sf-smart-yes"));
    check("after closing and reopening the grown-up is asked again", await t10.waitFor(`window.kipSelfie.state.smart === 'gate'`, 10000) && gateCalls() === gatesClosed + 1);
    check("nothing was kept: no cookie, no session storage, no IndexedDB, and local storage holds only the app's device id and the menu's collapsed flag (no value anywhere near the size of a picture)", await t10.evaluate(`(async () => document.cookie === '' && sessionStorage.length === 0 && (await indexedDB.databases()).length === 0
      && Object.keys(localStorage).every((k) => ['toyforge:device:v1', 'kipMenu.collapsed'].includes(k)) && Object.values(localStorage).every((v) => v.length < 80))()`));
    check("every call went to a same-origin /api route of the three allowed ones", api().every((c) => ["/api/parent/gate", "/api/selfie/face-parts", "/api/selfie/cartoon"].includes(c.path)) && picCalls().every((c) => c.method === "POST"));
    check("no page exceptions", t10.exceptions.length === 0, t10.exceptions[0]);
    t10.close();
  }

  console.log(`\nscreenshots: ${SHOTS}`);
} finally {
  chrome.close();
  server.close();
  finish();
}
