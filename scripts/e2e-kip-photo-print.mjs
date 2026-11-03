#!/usr/bin/env node
// Kip photo → print panel (parts/kip/viewer/kip-photo-print.js): headless-Chrome checks against the REAL Worker routes.
// Run: npm run e2e:kip-photo-print     Exits nonzero on any failing check.
//
// What is real: the panel and its bundled flow module (public/kip/kip-photo-print-core.js, built by build-kip.ts), and the Worker
// (worker/index.ts: /api/scan, the parent gate, the forge routes with their allowlist, rate limits and scrub), run in this process.
// What is stood in: the model provider (it answers with the captured reply for the real steel spoon, tests/fixtures/spoon-sam-reply.sse)
// and the optimizer daemon (it answers the gate with a script). The photo is drawn from the real spoon's mask at the size the model saw
// (288 x 512), so the cut line has to land on the spoon. Only a drawing of a spoon is ever used: no real photo, no key.
// Env: E2E_CHROME, E2E_SHOTS (see scripts/lib/kip-e2e.mjs).
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { createChecks, launchChrome, startServer } from "./lib/kip-e2e.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), "kip-photo-print-shots");
const DEVICE = "12345678-1234-1234-1234-123456789abc";
const PLATE = "photo_accessory.0123456789ab.stl";
const { check, finish } = createChecks("kip photo print e2e");

// The fixtures read their files relative to __dirname, which an ES module does not have.
globalThis.__dirname = path.join(HERE, "../tests/fixtures");
const { realSpoon, spoonSamReply } = await import("../tests/fixtures/realCupMask.ts");
const worker = (await import("../worker/index.ts")).default;
const { resetForgeRateLimit } = await import("../worker/forgeOptimizer.ts");

// ---- the photo: the real spoon's mask, drawn as a steel spoon on a wooden table, 288 x 512 ---------------------------------

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
const spoon = await realSpoon();
const PW = 288, PH = 512;
const rgba = Buffer.alloc(PW * PH * 4);
for (let y = 0; y < PH; y++) {
  for (let x = 0; x < PW; x++) {
    const o = (y * PW + x) * 4;
    const mx = x - spoon.bounds.left, my = y - spoon.bounds.top;
    const on = mx >= 0 && my >= 0 && mx < spoon.raster.width && my < spoon.raster.height && spoon.raster.data[my * spoon.raster.width + mx];
    const grain = 8 * Math.sin(y / 5 + 3 * Math.sin(x / 40));
    const c = on ? [150 + 60 * Math.sin(x / 11) + 20 * Math.sin(y / 23), 156 + 50 * Math.sin(x / 11), 166 + 50 * Math.sin(x / 11)] : [196 + grain, 152 + grain, 104 + grain];
    rgba.set([...c.map((v) => Math.max(0, Math.min(255, Math.round(v)))), 255], o);
  }
}
const FIXTURE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kip-photo-print-fixture-")), "spoon.png");
fs.writeFileSync(FIXTURE, pngOf(PW, PH, rgba));

// ---- the stand-ins behind the real Worker -------------------------------------------------------------------------------------

/** A tiny binary STL (a box): 80 byte header, a count, 12 facets of 50 bytes. */
function boxStl() {
  const b = Buffer.alloc(84 + 12 * 50);
  b.write("kip photo print e2e plate", 0);
  b.writeUInt32LE(12, 80);
  for (let i = 0; i < 12; i++) for (let k = 0; k < 12; k++) b.writeFloatLE((i * 7 + k * 3) % 11, 84 + i * 50 + k * 4);
  return b;
}
const PLATE_BYTES = boxStl();
const PASS = { ok: true, design_status: "ok", small_part: { status: "above_cylinder", min_enclosing_diameter_mm: 61 }, blocking_failures: [], brand_errors: [] };
let daemonMode = "pass"; // pass | down
const daemon = { recipes: [], artifactRequests: [] };

function daemonFetch(url, init) {
  const j = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const p = url.pathname;
  if (p === "/v1/fast-preview") {
    if (daemonMode === "down") return j({ ok: false }, 503);
    daemon.recipes.push(JSON.parse(String(init?.body)));
    return j({ ok: true, status: "preview_ready", part_id: "custom_photo_outline", job_id: `fjob_${String(daemon.recipes.length).padStart(12, "0")}`, draft_artifact: "", glb_size: 1, orig_tris: 1, web_verts: 1, web_tris: 1, finish_class: "show_curved", elapsed_ms: 1 });
  }
  const m = /^\/v1\/jobs\/(fjob_[a-f0-9]{12})$/.exec(p);
  if (m) return j({ ok: true, job_id: m[1], part_id: "custom_photo_outline", status: "print_ready", gate_report: PASS, stl_artifact: PLATE, glb_artifact: PLATE.replace(/\.stl$/, ".glb"), content_hash: "0123456789ab" });
  const a = /^\/v1\/artifacts\/(.+)$/.exec(p);
  if (a && a[1] === PLATE) {
    daemon.artifactRequests.push(a[1]);
    return new Response(PLATE_BYTES, { status: 200, headers: { "content-type": "model/stl" } });
  }
  return j({ ok: false }, 404);
}

// The Worker calls the global fetch for the daemon (127.0.0.1:8791) and for the model provider (anywhere else that is not this machine).
// Everything on this machine other than the daemon (Chrome's debugging port, the harness proxy) goes through untouched.
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : (input.url ?? String(input)));
  if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return url.port === "8791" ? daemonFetch(url, init) : realFetch(input, init);
  return new Response(spoonSamReply(), { status: 200, headers: { "content-type": "text/event-stream" } });
};

function fakeDb() {
  const settings = new Map();
  return {
    prepare: (sql) => ({
      bind: (...values) => ({
        run: async () => {
          if (sql.includes("INSERT INTO parent_settings")) {
            const [id, text] = values;
            if (!(sql.includes("DO NOTHING") && settings.has(id))) settings.set(id, text);
          }
          return {};
        },
        all: async () => (sql.includes("FROM parent_settings") ? { results: settings.has(values[0]) ? [{ settings_json: settings.get(values[0]) }] : [] } : { results: [] }),
      }),
    }),
  };
}
const env = { DB: fakeDb(), PARENT_GATE_SECRET: "gate-secret-for-the-e2e", FORGE_OPTIMIZER_URL: "http://127.0.0.1:8791", MODEL_API_KEY: "e2e-key" };

// The harness proxies every unmocked /api request to this server, which hands it to the real Worker.
const workerServer = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    try {
      const body = Buffer.concat(chunks);
      const r = await worker.fetch(new Request(`http://local${req.url}`, { method: req.method, headers: req.headers, ...(req.method === "GET" || req.method === "HEAD" ? {} : { body }) }), env);
      res.writeHead(r.status, { "content-type": r.headers.get("content-type") ?? "application/json" });
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: String(e) }));
    }
  });
});
await new Promise((r) => workerServer.listen(0, "127.0.0.1", r));
process.env.E2E_API_PROXY = `http://127.0.0.1:${workerServer.address().port}`;

// ---- the fringe, measured in-process with and without the per-row slide, to calibrate what the browser must show ------------------

const ST = await import("../parts/kip/viewer/kip-print-stickers.js");
const { scanOutline } = await import("../shared/outlineScan.ts");
const { preparePhotoAccessory } = await import("../shared/photoAccessory.ts");
/** Share of the non-white pixels of a sticker that are the table's warm brown: the one rule used here and in the page. */
function tableShare(rgba) {
  let wood = 0, ink = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] === 0 || (rgba[i] > 240 && rgba[i + 1] > 240 && rgba[i + 2] > 240)) continue;
    ink++;
    if (rgba[i] > 150 && rgba[i] - rgba[i + 2] > 50) wood++;
  }
  return wood / ink;
}
const calibration = await (async () => {
  const scan = scanOutline(spoon.raster, spoon.bounds, { width: PW, height: PH }, { targetHeightMm: 54 });
  const acc = await preparePhotoAccessory(scan, async () => ({ status: "pass", failures: [] }));
  if (!acc.ok) throw new Error("calibration: no accessory");
  const measure = (strip) => {
    const item = JSON.parse(JSON.stringify(acc.decal.item));
    if (strip) delete item.sampler.rowShiftMm;
    const plan = ST.planStickerSheet([{ kind: "photo_accessory", item, spare: false }], {});
    const it = plan.items[0];
    return tableShare(ST.renderStickerItemRgba(it, { [it.sampler.sourceKey]: { w: PW, h: PH, data: new Uint8ClampedArray(rgba) } }, 200, 1.0).data);
  };
  return { withSlide: measure(false), withoutSlide: measure(true), hadSlide: Boolean(acc.decal.item.sampler.rowShiftMm) };
})();

// ---- the run ------------------------------------------------------------------------------------------------------------------

const server = await startServer();
const chrome = await launchChrome({ width: 900, height: 900 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let page;
try {
  // A page on the server's origin to run in: the 404 page is a document with that origin, and the panel is imported as a module.
  page = await chrome.open(`${server.base}/__host`);
  await page.waitFor("document.readyState === 'complete'", 20000);
  const ev = (expr) => page.evaluate(expr);
  const ui = `document.querySelector('.kpp-back')`;
  const step = () => ev("window.__kpp.state.step");
  const text = (sel) => ev(`(document.querySelector(${JSON.stringify(sel)}) || {}).textContent || ''`);
  const press = (label) => ev(`(() => { const b = [...document.querySelectorAll('.kpp-back button')].find((x) => x.textContent.includes(${JSON.stringify(label)}) && !x.hidden && x.offsetParent !== null); if (!b) return false; b.click(); return true; })()`);
  const setWord = (w) => ev(`(() => { const i = document.querySelector('.kpp-back input[type=text]'); i.value = ${JSON.stringify(w)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const upload = async () => {
    const { root } = await page.send("DOM.getDocument", { depth: 1 });
    const { nodeId } = await page.send("DOM.querySelector", { nodeId: root.nodeId, selector: ".kpp-back input[type=file]" });
    await page.send("DOM.setFileInputFiles", { files: [FIXTURE], nodeId });
  };
  const mount = async () =>
    ev(`(async () => { const m = await import('/kip/kip-photo-print.js?v=10.0'); localStorage.setItem('toyforge:device:v1', ${JSON.stringify(DEVICE)}); window.__kpp = m.createPhotoPrint({ root: document.body }); window.__kpp.open(); return true; })()`);
  const orange = () => ev(`(() => { const c = document.querySelector('.kpp-back canvas'); if (!c || !c.width) return 0; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 235 && d[i + 1] > 90 && d[i + 1] < 130 && d[i + 2] < 100) n++; return n; })()`);
  const api = () => server.apiCalls;

  // 1. opening ------------------------------------------------------------------------------------------------------------------
  check("the panel mounts inside the page and opens on the first step", (await mount()) && (await step()) === "pick" && (await ev(`${ui}.classList.contains('open')`)));
  check("only the first step is showing", await ev(`(() => { const v = (s) => !document.querySelector('.kpp-back ' + s).hidden; return v('.kpp-pick') && !v('.kpp-shape') && !v('.kpp-gate') && !v('.kpp-work') && !v('.kpp-done'); })()`));
  check("Find the shape cannot be pressed with no photo and no word", await ev(`[...document.querySelectorAll('.kpp-back button')].find((b) => b.textContent.includes('Find the shape')).disabled`));
  check("the page says the photo goes to the online helper and that the server does not keep it", /sent to our online helper/.test(await text(".kpp-note")) && /does not keep it/.test(await text(".kpp-note")));

  // 2. a photo and a word, and nothing is sent -------------------------------------------------------------------------------
  await upload();
  check("a picked photo is read and held in memory", await page.waitFor("window.__kpp.state.hasPhoto", 15000));
  await setWord("spoon");
  check("with a photo and a word the button is ready, and the server has heard nothing", !(await ev(`[...document.querySelectorAll('.kpp-back button')].find((b) => b.textContent.includes('Find the shape')).disabled`)) && api().length === 0);

  // 3. find the shape -----------------------------------------------------------------------------------------------------------
  check("Find the shape sends one request, to /api/scan", (await press("Find the shape")) && (await page.waitFor("window.__kpp.state.hasScan", 30000)) && api().length === 1 && api()[0].path === "/api/scan");
  const scanBody = JSON.parse(api()[0].body).scan;
  check("it sent the word, the size and a JPEG shrunk to at most 512 px, and no cookies", scanBody.prompt === "spoon" && scanBody.outline.targetHeightMm === 54 && scanBody.imageDataUrl.startsWith("data:image/jpeg") && !("cookie" in api()[0].headers));
  check("the shape step shows, with the cut line drawn on the photo", (await step()) === "shape" && (await orange()) > 150, `orange pixels ${await orange()}`);
  const dims0 = await text(".kpp-shape .kpp-note");
  check("it shows the size in millimetres", /^\d+(\.\d+)? × \d+(\.\d+)? mm$/.test(dims0), dims0);
  check("the real spoon was made symmetric by the scan, so the button for it is hidden", await ev(`[...document.querySelectorAll('.kpp-back button')].find((b) => b.textContent.includes('Make both sides')).hidden`));
  await page.shot(path.join(SHOTS, "1-shape.png"));

  // 4. flip and resize ---------------------------------------------------------------------------------------------------------
  const px0 = await orange();
  check("Flip changes the choice and keeps the cut line on the photo", (await press("Flip")) && (await ev("window.__kpp.state.choices.flip")) && Math.abs((await orange()) - px0) < px0 * 0.2);
  const w0 = parseFloat(dims0);
  await press("Bigger");
  const w1 = parseFloat(await text(".kpp-shape .kpp-note"));
  check("Bigger makes it bigger", w1 > w0 && (await ev("window.__kpp.state.choices.scale")) > 1, `${w0} -> ${w1}`);
  await press("Smaller"); await press("Smaller");
  check("Smaller makes it smaller again", parseFloat(await text(".kpp-shape .kpp-note")) < w0);
  await press("Flip");

  // 5. the grown-up check ------------------------------------------------------------------------------------------------------
  const callsBefore = api().length;
  check("Check it prints asks a grown-up first and sends nothing yet", (await press("Check it prints")) && (await page.waitFor("window.__kpp.state.step === 'gate'", 15000)) && api().filter((c) => c.path.startsWith("/api/forge")).length === 0);
  const q = await (async () => { await page.waitFor(`/what is \\d+ × \\d+/i.test(document.querySelector('.kpp-gate .kpp-status').textContent)`, 15000); return /what is (\d+) × (\d+)/i.exec(await text(".kpp-gate .kpp-status")); })();
  check("the question is a sum", Boolean(q));
  const answer = (v) => ev(`(() => { const i = document.querySelector('.kpp-gate input'); i.value = ${JSON.stringify(String(v))}; document.querySelector('.kpp-gate .kpp-go').click(); })()`);
  await answer(Number(q[1]) * Number(q[2]) + 1);
  check("a wrong answer says so, keeps the child out, and asks a fresh question", await page.waitFor(`/not right/.test(document.querySelector('.kpp-back .kpp-status:last-child').textContent) && window.__kpp.state.step === 'gate' && /what is \\d+ × \\d+/i.test(document.querySelector('.kpp-gate .kpp-status').textContent)`, 15000));
  check("no gate call yet counted as a pass: the forge routes have still heard nothing", api().filter((c) => c.path.startsWith("/api/forge")).length === 0);
  await page.shot(path.join(SHOTS, "2-gate.png"));
  const q2 = /what is (\d+) × (\d+)/i.exec(await text(".kpp-gate .kpp-status"));
  await answer(Number(q2[1]) * Number(q2[2]));

  // 6. the fit and the files ----------------------------------------------------------------------------------------------------
  check("a right answer runs the printer check and ends on the done step", await page.waitFor("window.__kpp.state.step === 'done'", 60000), await text(".kpp-back .kpp-status:last-child"));
  const forge = api().filter((c) => c.path.startsWith("/api/forge"));
  check("the printer check went through the Worker's forge routes: a preview, a poll, and the plate", forge.some((c) => c.path === "/api/forge/preview" && c.method === "POST") && forge.some((c) => /^\/api\/forge\/jobs\/fjob_/.test(c.path)) && forge.some((c) => c.path === `/api/forge/artifacts/${PLATE}`));
  check("every forge request carried the device id and the grown-up proof", forge.length > 0 && forge.every((c) => c.headers["x-device-id"] === DEVICE && typeof c.headers["x-parent-proof"] === "string" && c.headers["x-parent-proof"].length > 10));
  const preview = forge.find((c) => c.path === "/api/forge/preview");
  const sent = JSON.parse(preview.body);
  check("the daemon was sent an outline of at most 256 points and no photo", sent.recipe.shape.kind === "profile2d" && sent.recipe.shape.points.length > 20 && sent.recipe.shape.points.length <= 256 && !/data:image/.test(preview.body) && daemon.recipes.length >= 1);
  check("the forge request holds only the recipe and the two flags, so there is nowhere for a photo to ride", Object.keys(sent).sort().join() === "enqueue_background,include_glb_base64,recipe" && Object.keys(sent.recipe).sort().join() === "name,shape,slot" && sent.recipe.slot === "hand");
  check("only the three allowed kinds of route were called, all on this origin", api().every((c) => c.path === "/api/scan" || c.path === "/api/parent/gate" || c.path.startsWith("/api/forge/")) && api().filter((c) => c.path === "/api/scan").length === 1);
  const links = await ev(`[...document.querySelectorAll('.kpp-back .kpp-links a')].map((a) => ({ name: a.download, href: a.href.slice(0, 5) }))`);
  check("the done step offers the plate and the sticker files as downloads", ["-plate.stl", ".pdf", ".png", ".svg", ".dxf"].every((s) => links.some((l) => l.name.endsWith(s))) && links.every((l) => l.href === "blob:"), JSON.stringify(links.map((l) => l.name)));
  const plate = await ev(`(async () => { const a = document.querySelector('.kpp-back .kpp-links a[download$="-plate.stl"]'); const b = new Uint8Array(await (await fetch(a.href)).arrayBuffer()); return { n: b.length, head: [...b.slice(0, 12)] }; })()`);
  check("the plate link is exactly the file the daemon made", plate.n === PLATE_BYTES.length && plate.head.every((v, i) => v === PLATE_BYTES[i]), `${plate.n} bytes`);
  const sheet = await ev(`(async () => { const a = document.querySelector('.kpp-back .kpp-links a[download$=".png"]'); const b = new Uint8Array(await (await fetch(a.href)).arrayBuffer()); const img = document.querySelector('.kpp-back .kpp-sheet'); await new Promise((r) => (img.complete ? r() : (img.onload = r))); return { sig: [...b.slice(0, 4)], w: img.naturalWidth, h: img.naturalHeight, shown: !img.hidden }; })()`);
  check("the sticker picture is a real PNG and is shown on the page", sheet.sig.join() === "137,80,78,71" && sheet.w > 200 && sheet.h > 200 && sheet.shown, JSON.stringify(sheet));
  check("it says how big the plate is", /^Ready! \d+(\.\d+)? × \d+(\.\d+)? mm\./.test(await text(".kpp-back .kpp-done .kpp-status")));
  // The sticker is cut along the symmetric outline but the photographed spoon leans a little: the artwork is slid row by row so the spoon fills
  // the cut line. The same table-colour rule as the calibration above, on the picture the child gets, against what the same spoon gives with
  // and without the slide.
  const fringe = await ev(`(async () => { const a = document.querySelector('.kpp-back .kpp-links a[download$=".png"]'); const bmp = await createImageBitmap(await (await fetch(a.href)).blob()); const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bmp, 0, 0); const d = ctx.getImageData(0, 0, c.width, c.height).data; let wood = 0, ink = 0; for (let i = 0; i < d.length; i += 4) { if (d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240) continue; ink++; if (d[i] > 150 && d[i] - d[i + 2] > 50) wood++; } return { share: wood / ink, ink }; })()`);
  check("guard: the calibration saw a slide, and the table shows far more without it than with it", calibration.hadSlide && calibration.withoutSlide > calibration.withSlide * 1.6, JSON.stringify(calibration));
  check("the sticker picture shows the table about as little as the in-process sticker with the slide, and clearly less than without it", fringe.ink > 20000 && fringe.share < (calibration.withSlide + calibration.withoutSlide) / 2, `${JSON.stringify(fringe)} vs ${JSON.stringify(calibration)}`);
  await page.shot(path.join(SHOTS, "3-done.png"));

  // 7. what the page left behind ---------------------------------------------------------------------------------------------
  const left = await ev(`({ cookie: document.cookie, local: Object.keys(localStorage), session: Object.keys(sessionStorage) })`);
  check("no cookie, no session storage, and local storage holds only the device id the test put there", left.cookie === "" && left.session.length === 0 && left.local.length === 1 && left.local[0] === "toyforge:device:v1", JSON.stringify(left));

  // 8. a printer check that is down is one calm sentence --------------------------------------------------------------------
  const url0 = await ev(`document.querySelector('.kpp-back .kpp-links a').href`);
  await ev("window.__kpp.dispose()");
  check("dispose removes the panel from the page, and lets go of the files", (await ev(`!document.querySelector('.kpp-back')`)) && (await ev(`fetch(${JSON.stringify(url0)}).then(() => false, () => true)`)));
  resetForgeRateLimit();
  daemonMode = "down";
  await mount();
  await upload();
  await page.waitFor("window.__kpp.state.hasPhoto", 15000);
  await setWord("spoon");
  await press("Find the shape");
  check("a second panel finds the shape again", await page.waitFor("window.__kpp.state.hasScan", 30000));
  await press("Check it prints");
  await page.waitFor("window.__kpp.state.step === 'gate'", 15000);
  await page.waitFor(`/what is \\d+ × \\d+/i.test(document.querySelector('.kpp-gate .kpp-status').textContent)`, 15000);
  const q3 = /what is (\d+) × (\d+)/i.exec(await text(".kpp-gate .kpp-status"));
  await answer(Number(q3[1]) * Number(q3[2]));
  check("a daemon that is down ends back on the shape step with a calm sentence and no files", await page.waitFor(`window.__kpp.state.step === 'shape' && window.__kpp.state.bad`, 60000));
  const msg = await text(".kpp-back .kpp-status:last-child");
  check("the sentence is plain: no status code, no route, no internal word", /busy|try again/i.test(msg) && !/\b[45]\d\d\b|forge|fjob_|daemon|unreachable/i.test(msg), msg);
  await page.shot(path.join(SHOTS, "4-down.png"));

  // 9. it can be closed and opened again, and Escape closes it ----------------------------------------------------------------
  await ev(`document.querySelector('.kpp-back').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  check("Escape closes the panel", !(await ev("window.__kpp.isOpen()")));
  await ev("window.__kpp.open()");
  check("it opens again where it was", (await ev("window.__kpp.isOpen()")) && (await step()) === "shape");
  await ev("window.__kpp.dispose()");
  check("the page had no uncaught exception", page.exceptions.length === 0, page.exceptions.join(" | "));

  // 10. in the real Kip page: the button, the panel inside the bench root, and the same first steps --------------------------
  const kip = await chrome.open(`${server.base}/kip/Kip-Demo.html`, { width: 1100, height: 900 });
  try {
    check("the Kip bench loads", await kip.waitFor("window.__KIP_READY__ === true", 150000, 1000));
    await kip.evaluate(`localStorage.setItem('toyforge:device:v1', ${JSON.stringify(DEVICE)})`);
    check("the Photo modal has the Print it button, and no panel exists before it is pressed", (await kip.evaluate(`!!document.getElementById('btn-print-photo') && !document.querySelector('.kpp-back') && !window.kipPhotoPrint`)));
    await kip.evaluate(`document.getElementById('modal-photo').classList.add('open')`);
    await kip.evaluate(`document.getElementById('btn-print-photo').click()`);
    check("pressing it closes the Photo modal and opens the panel, inside the bench root", await kip.waitFor(`window.kipPhotoPrint && window.kipPhotoPrint.isOpen() && !document.getElementById('modal-photo').classList.contains('open') && !!document.querySelector('.kip-bench .kpp-back')`, 20000));
    check("it is published for the page and starts on the first step", (await kip.evaluate("window.kipPhotoPrint.state.step")) === "pick");
    const { root: kroot } = await kip.send("DOM.getDocument", { depth: 1 });
    const { nodeId: kfile } = await kip.send("DOM.querySelector", { nodeId: kroot.nodeId, selector: ".kpp-back input[type=file]" });
    await kip.send("DOM.setFileInputFiles", { files: [FIXTURE], nodeId: kfile });
    check("a photo picked in the bench is read", await kip.waitFor("window.kipPhotoPrint.state.hasPhoto", 20000));
    await kip.evaluate(`(() => { const i = document.querySelector('.kpp-back input[type=text]'); i.value = 'spoon'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    const scansBefore = api().filter((c) => c.path === "/api/scan").length;
    await kip.evaluate(`[...document.querySelectorAll('.kpp-back button')].find((b) => b.textContent.includes('Find the shape')).click()`);
    check("the bench panel finds the real spoon's shape through the real Worker", await kip.waitFor("window.kipPhotoPrint.state.hasScan", 40000) && api().filter((c) => c.path === "/api/scan").length === scansBefore + 1);
    // The bench styles every canvas in it to fill its box (for the 3D view); the panel's photo must keep its own size and the buttons stay on screen.
    const box = await kip.evaluate(`(() => { const c = document.querySelector('.kpp-back canvas').getBoundingClientRect(); const b = [...document.querySelectorAll('.kpp-back button')].find((x) => x.textContent.includes('Check it prints')).getBoundingClientRect(); return { w: c.width, h: c.height, btnBottom: b.bottom, vh: window.innerHeight }; })()`);
    check("in the bench the photo keeps its own size, not the bench's full-width canvas rule, and Check it prints is on screen", box.w >= 120 && box.w <= 400 && box.h <= 0.46 * box.vh + 1 && box.btnBottom <= box.vh, JSON.stringify(box));
    await kip.shot(path.join(SHOTS, "5-in-bench.png"));
    // ...and the whole way to the done step in the bench (its styles could reach the sticker picture and the links too).
    daemonMode = "pass";
    resetForgeRateLimit();
    const kpress = (label) => kip.evaluate(`(() => { const b = [...document.querySelectorAll('.kpp-back button')].find((x) => x.textContent.includes(${JSON.stringify(label)}) && !x.hidden && x.offsetParent !== null); if (!b) return false; b.click(); return true; })()`);
    await kpress("Check it prints");
    await kip.waitFor(`/what is \\d+ × \\d+/i.test((document.querySelector('.kpp-gate .kpp-status') || {}).textContent || '')`, 20000);
    const kq = /what is (\d+) × (\d+)/i.exec(await kip.evaluate(`document.querySelector('.kpp-gate .kpp-status').textContent`));
    await kip.evaluate(`(() => { const i = document.querySelector('.kpp-gate input'); i.value = ${JSON.stringify(String(Number(kq[1]) * Number(kq[2])))}; document.querySelector('.kpp-gate .kpp-go').click(); })()`);
    check("in the bench the whole way through reaches the done step", await kip.waitFor("window.kipPhotoPrint.state.step === 'done'", 90000));
    const done = await kip.evaluate(`(async () => { const img = document.querySelector('.kpp-back .kpp-sheet'); await new Promise((r) => (img.complete ? r() : (img.onload = r))); const a = document.querySelector('.kpp-back .kpp-links a').getBoundingClientRect(); const s = img.getBoundingClientRect(); return { sheetH: s.height, linkBottom: a.bottom, vh: window.innerHeight, links: document.querySelectorAll('.kpp-back .kpp-links a').length }; })()`);
    check("in the bench the downloads are on screen and the sticker picture keeps its size", done.links >= 5 && done.linkBottom <= done.vh && done.sheetH <= 342, JSON.stringify(done));
    await kip.shot(path.join(SHOTS, "6-in-bench-done.png"));
    const held = await kip.evaluate(`(() => { const a = document.querySelector('.kpp-back .kpp-links'); return { open: window.kipPhotoPrint.isOpen(), scan: window.kipPhotoPrint.state.hasScan, links: a ? a.children.length : 0 }; })()`);
    check("guard: the panel is open and holds a photo and an outline when the bench is torn down", held.open && held.scan);
    await kip.evaluate("window.kipBench.dispose()");
    check("disposing the BENCH with the panel open takes the panel out of the page, and unpublishes its handle", await kip.evaluate(`!document.querySelector('.kpp-back') && !document.querySelector('.kip-bench') && window.kipPhotoPrint === undefined`));
    check("nothing of the panel is left in the page: no style element of its own, no leftover node", await kip.evaluate(`![...document.querySelectorAll('style')].some((st) => st.textContent.includes('.kpp-')) && document.querySelectorAll('[class*="kpp-"]').length === 0`));
    check("the bench page had no uncaught exception", kip.exceptions.length === 0, kip.exceptions.join(" | "));
  } finally {
    kip.close();
  }
  check("the page loaded no file that was missing", server.missing.size === 0, [...server.missing].join(","));
} catch (e) {
  check("the run reached its end", false, String(e?.stack ?? e).slice(0, 600));
} finally {
  finish();
  page?.close();
  chrome.close();
  server.close();
  workerServer.close();
  globalThis.fetch = realFetch;
  console.log(`screenshots: ${SHOTS}`);
  setTimeout(() => process.exit(process.exitCode ?? 0), 200);
}
