#!/usr/bin/env node
// The household library in the Kip viewer (docs/specs/household-library-spec.md, phase 4): the offer in the print panel, and an item in Kip's hand.
// Run: npm run e2e:kip-household     Exits nonzero on any failing check. Needs the machine's GPU for the 3D bench: it sets E2E_GPU=metal itself.
//
// What is real: the panel and its bundled flow (public/kip/kip-photo-print-core.js, built by build-kip.ts), the Kip bench page (parts/kip/viewer,
// served in place of public/kip), the library's catalog and GLBs, and the browser (headless Chrome with a GPU).
// What is stood in: /api/scan. It answers with the outline of the real steel spoon (tests/fixtures/spoon-sam-reply.sse, run through the real
// outline code), changed in the one way each case needs (a clean outline, a poor one, no match, a busy helper). No photo leaves the machine.
//
// Part A is the panel in a plain page with a hook that records what it is asked to equip. Part B is the bench: every built item is put in the hand and
// measured (which way it faces, where its grip is, whether it stands up), then one item is taken from the panel's offer.
// Env: E2E_CHROME, E2E_SHOTS.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { crc32, deflateSync, inflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";

process.env.E2E_GPU ??= "metal";
const { createChecks, launchChrome, startServer } = await import("./lib/kip-e2e.mjs");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const SHOTS = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), "kip-household-shots");
const { check, finish } = createChecks("kip household e2e");

globalThis.__dirname = path.join(HERE, "../tests/fixtures");
const { realSpoon, realCup } = await import("../tests/fixtures/realCupMask.ts");
const { scanOutline } = await import("../shared/outlineScan.ts");
const { parseHouseholdCatalog, offerFor, offerSentence } = await import("../shared/householdMatch.ts");

// ---- the catalog decides everything below -------------------------------------------------------------------------------------

const catalogText = fs.readFileSync(path.join(ROOT, "public/kip/household/catalog.json"), "utf8");
const parsed = parseHouseholdCatalog(JSON.parse(catalogText));
if (!parsed.ok) throw new Error(parsed.message);
const catalog = parsed.catalog;
const built = catalog.items.filter((i) => i.built);
const unbuilt = catalog.items.filter((i) => !i.built);
if (!built.length) throw new Error("no built item in the catalog");
const target = built.find((i) => i.id === "wooden_spoon") ?? built[0];
const WORD = target.words[0];
const GOOD = offerFor(catalog, WORD, { kind: "outline", fidelity: 0.97, warnings: [] });
const POOR = offerFor(catalog, WORD, { kind: "outline", fidelity: 0.9, warnings: ["LOW_FIDELITY"] });
const NONE = offerFor(catalog, WORD, { kind: "failed" });

// ---- the stand-in scan ---------------------------------------------------------------------------------------------------------

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
    rgba.set(on ? [170, 176, 186, 255] : [196, 152, 104, 255], (y * PW + x) * 4);
  }
}
const FIXTURE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kip-household-fixture-")), "photo.png");
fs.writeFileSync(FIXTURE, pngOf(PW, PH, rgba));
const realScan = scanOutline(spoon.raster, spoon.bounds, { width: PW, height: PH }, { targetHeightMm: 54 });
if (!realScan.ok) throw new Error("the real spoon has no outline");
const clone = (o) => JSON.parse(JSON.stringify(o));

// A second photo: the real cup's mask (SAM, a 1920 x 1280 photo) shrunk to the 512 px the panel sends, drawn as a red-and-white cup with a blue dot on a
// wooden table. Only a drawing is ever used: no real photo.
const cup = await realCup();
const K = 512 / 1920;
const CW = 512, CH = Math.round(1280 * K);
const cupRaster = (() => {
  const w = Math.round(cup.raster.width * K), h = Math.round(cup.raster.height * K);
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = cup.raster.data[Math.min(cup.raster.height - 1, Math.floor((y + 0.5) / K)) * cup.raster.width + Math.min(cup.raster.width - 1, Math.floor((x + 0.5) / K))] ? 1 : 0;
  return { data, width: w, height: h };
})();
const cupBounds = { left: Math.round(cup.bounds.left * K), top: Math.round(cup.bounds.top * K) };
const cupRgba = Buffer.alloc(CW * CH * 4);
for (let y = 0; y < CH; y++) {
  for (let x = 0; x < CW; x++) {
    const mx = x - cupBounds.left, my = y - cupBounds.top;
    const on = mx >= 0 && my >= 0 && mx < cupRaster.width && my < cupRaster.height && cupRaster.data[my * cupRaster.width + mx];
    let c = [196 + 6 * Math.sin(y / 5), 152 + 6 * Math.sin(y / 5), 104 + 6 * Math.sin(y / 5)]; // the table
    if (on) {
      const fx = mx / cupRaster.width, fy = my / cupRaster.height;
      const shade = 0.82 + 0.18 * Math.sin(Math.PI * Math.min(1, Math.max(0, fx))); // round: darker at the sides
      c = fy > 0.42 && fy < 0.58 ? [244, 244, 240] : [208, 34, 46];
      if (fx < 0.28 && fy < 0.3) c = [30, 70, 222]; // a blue dot at the photo's top left, to tell a mirrored picture from a straight one
      c = c.map((v) => v * shade);
    }
    cupRgba.set([...c.map((v) => Math.max(0, Math.min(255, Math.round(v)))), 255], (y * CW + x) * 4);
  }
}
const CUP_FIXTURE = path.join(path.dirname(FIXTURE), "cup.png");
fs.writeFileSync(CUP_FIXTURE, pngOf(CW, CH, cupRgba));
const cupScan = scanOutline(cupRaster, cupBounds, { width: CW, height: CH }, { targetHeightMm: 54 });
if (!cupScan.ok) throw new Error("the real cup has no outline");

/** A PNG as RGBA (8 bit, not interlaced: what Chrome's screenshots are). */
function decodePng(buf) {
  let o = 8, w = 0, h = 0, ct = 0;
  const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), type = buf.toString("latin1", o + 4, o + 8), body = buf.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") { w = body.readUInt32BE(0); h = body.readUInt32BE(4); ct = body[9]; if (body[8] !== 8 || body[12] !== 0) throw new Error("png: need 8 bit, not interlaced"); }
    if (type === "IDAT") idat.push(body);
    o += 12 + len;
  }
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : 0;
  if (!bpp) throw new Error(`png: colour type ${ct}`);
  const raw = inflateSync(Buffer.concat(idat));
  const out = new Uint8ClampedArray(w * h * 4);
  const stride = w * bpp;
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      line[i] = (line[i] + (f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
    }
    for (let x = 0; x < w; x++) { out[(y * w + x) * 4] = line[x * bpp]; out[(y * w + x) * 4 + 1] = line[x * bpp + 1]; out[(y * w + x) * 4 + 2] = line[x * bpp + 2]; out[(y * w + x) * 4 + 3] = bpp === 4 ? line[x * bpp + 3] : 255; }
    prev = line;
  }
  return { w, h, data: out };
}

let scanMode = "good"; // good | poor | cup | nomatch | busy
const scanReply = () => {
  if (scanMode === "busy") return { status: 500, json: { error: "busy" } };
  if (scanMode === "nomatch") return { status: 200, json: { toy: null, sam: { configured: true, applied: false, status: "no-match", matches: 0 } } };
  const o = clone(scanMode === "cup" ? cupScan : realScan);
  if (scanMode === "cup") { o.fidelity = Math.max(o.fidelity, 0.96); o.warnings = []; }
  if (scanMode === "good") { o.fidelity = 0.97; o.warnings = []; }
  if (scanMode === "poor") { o.fidelity = 0.9; o.warnings = ["LOW_FIDELITY"]; }
  return { status: 200, json: { toy: null, sam: { configured: true, applied: true, matches: 1, outline: o } } };
};

const server = await startServer();
server.mock("POST", "/api/scan", () => scanReply());
const chrome = await launchChrome({ width: 1100, height: 900 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hosts = [];
const kips = [];
try {
  // E2E_PART=A or B runs one part only (a mutation round runs the part a change can reach).
  const PART = process.env.E2E_PART ?? "ABC";
  // ======== A. the panel in a plain page ===========================================================================================
  if (PART.includes("A")) {
  const page = await chrome.open(`${server.base}/__host`, { width: 900, height: 900 });
  hosts.push(page);
  await page.waitFor("document.readyState === 'complete'", 20000);
  const ev = (expr) => page.evaluate(expr);
  const press = (label) => ev(`(() => { const b = [...document.querySelectorAll('.kpp-back button')].find((x) => x.textContent.includes(${JSON.stringify(label)}) && !x.hidden && x.offsetParent !== null); if (!b) return false; b.click(); return true; })()`);
  // the labels without their leading emoji (a picture's exact code points are not what is being tested)
  const visibleButtons = () => ev(`[...document.querySelectorAll('.kpp-offer button')].filter((b) => !b.hidden && b.offsetParent !== null).map((b) => b.textContent.replace(/^[^A-Za-z]+/, ''))`);
  const offerBox = () => ev(`(() => { const o = document.querySelector('.kpp-offer'); return { shown: !!o && !o.hidden && o.offsetParent !== null, text: o ? o.querySelector('p').textContent : '' }; })()`);
  const catalogRequests = () => page.requests.filter((r) => r.url.includes("/kip/household/catalog.json"));
  // `minBand` (a number) is written into the target's catalog row as the panel reads it, so the age rule is tested whatever the real catalog says;
  // `band` is what the page says the child's band is (undefined, null, a number, or 'throw' for a reader that fails).
  const mount = (hook, { minBand = null, band = undefined } = {}) => ev(`(async () => {
    window.__taken = []; window.__takeOk = true; window.__band = ${JSON.stringify(band === "throw" ? null : band ?? null)}; window.__bandThrows = ${band === "throw"};
    if (window.__kpp) window.__kpp.dispose();
    const m = await import('/kip/kip-photo-print.js?v=10.0');
    localStorage.setItem('toyforge:device:v1', '12345678-1234-1234-1234-123456789abc');
    const patched = async (url, init) => { const r = await fetch(url, init); if (${minBand === null} || !String(url).endsWith('/household/catalog.json')) return r; const d = await r.json(); for (const i of d.items) if (i.id === ${JSON.stringify(target.id)}) i.minBand = ${JSON.stringify(minBand)}; return new Response(JSON.stringify(d), { status: 200, headers: { 'content-type': 'application/json' } }); };
    window.__kpp = m.createPhotoPrint({ root: document.body, fetch: patched${hook ? ", onLibraryItem: async (item) => { window.__taken.push(item); return { ok: window.__takeOk }; }, ageBand: () => { if (window.__bandThrows) throw new Error('unreadable'); return window.__band === null ? undefined : window.__band; }" : ""} });
    window.__kpp.open(); return true; })()`);
  const upload = async () => {
    const { root } = await page.send("DOM.getDocument", { depth: 1 });
    const { nodeId } = await page.send("DOM.querySelector", { nodeId: root.nodeId, selector: ".kpp-back input[type=file]" });
    await page.send("DOM.setFileInputFiles", { files: [FIXTURE], nodeId });
    await page.waitFor("window.__kpp.state.hasPhoto", 20000);
  };
  const setWord = (w) => ev(`(() => { const i = document.querySelector('.kpp-back input[type=text]'); i.value = ${JSON.stringify(w)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  /** Photo, word, Find; resolves when the scan has ended (a scan to see, or a sentence). */
  const find = async (word) => {
    if (!(await ev("window.__kpp.state.hasPhoto"))) await upload();
    await setWord(word);
    await press("Find the shape");
    await page.waitFor("!window.__kpp.state.busy", 30000); // the click sets busy before it returns
    await sleep(250);
  };
  const state = () => ev("window.__kpp.state");

  check("the library says what it offers: a good outline and the right word is an offer of the item beside the plate (read from the catalog)", GOOD.offer === "alongside" && POOR.offer === "alone" && NONE.offer === "alone" && !!target);

  // A1. no hook: no offer, no catalog request ---------------------------------------------------------------------------------
  scanMode = "good";
  await mount(false);
  await find(WORD);
  let s = await state();
  check("A1 a panel with no hook for the library makes no offer, whatever the scan found", s.hasScan && s.offer === null && !(await offerBox()).shown);
  check("A1 ...and never asks for the catalog", catalogRequests().length === 0);

  // A2. a good outline: the offer, three choices, nothing applied ------------------------------------------------------------
  await mount(true);
  await find(WORD);
  s = await state();
  const box = await offerBox();
  check("A2 a good outline and the right word: the offer is on screen with the sentence from the library", box.shown && box.text === offerSentence(GOOD), JSON.stringify(box));
  check("A2 the state says what is offered, for which item, with no reason (the photo is trusted)", s.offer?.kind === "alongside" && s.offer.item === target.id && s.offer.why === null, JSON.stringify(s.offer));
  check("A2 there are three choices: the 3D item, both, or only the plate", JSON.stringify(await visibleButtons()) === JSON.stringify([`Use the 3D ${target.label.toLowerCase()}`, "Both: the 3D one and the plate", "Just the photo plate"]), JSON.stringify(await visibleButtons()));
  check("A2 nothing is equipped by being offered, and the plate flow is still there to carry on", (await ev("window.__taken.length")) === 0 && s.step === "shape" && s.equipped === null);
  check("A2 the catalog was fetched once, by a GET, only after Find", catalogRequests().length === 1 && catalogRequests()[0].method === "GET");
  await page.shot(path.join(SHOTS, "A2-offer-alongside.png"));

  // A3. "Just the photo plate" ------------------------------------------------------------------------------------------------
  await press("Just the photo plate");
  s = await state();
  check("A3 only the plate: the offer goes away, nothing is equipped, and the panel stays on the shape", s.offer === null && !(await offerBox()).shown && (await ev("window.__taken.length")) === 0 && s.step === "shape");
  check("A3 a calm sentence says so", /photo plate/i.test(s.message) && !s.bad, s.message);

  // A4. both, with a hook that fails and then works ---------------------------------------------------------------------------
  await press("Another photo");
  scanMode = "good";
  await find(WORD);
  await ev("window.__takeOk = false");
  await press("Both:");
  await page.waitFor("window.__taken.length === 1", 5000);
  await sleep(150);
  s = await state();
  check("A4 when the item cannot be put in Kip's hand the child is told, and the offer stays to try again", s.bad && /could not be put in Kip's hand/.test(s.message) && s.offer !== null && s.equipped === null && (await offerBox()).shown, s.message);
  await ev("window.__takeOk = true");
  await press("Both:");
  await page.waitFor("window.__kpp.state.equipped !== null", 5000);
  s = await state();
  const taken = await ev("window.__taken");
  check("A4 'both' equips the item and keeps the panel open on the plate", s.equipped === target.id && s.step === "shape" && s.offer === null && (await ev("window.__kpp.isOpen()")) && /photo plate is still here/.test(s.message), JSON.stringify(s));
  check("A4 the hook was handed the catalog's own item (id, label, file name, size) and nothing the child typed", taken.length === 2 && taken[1].id === target.id && taken[1].glb === `${target.id}.glb` && taken[1].propMm === target.propMm && JSON.stringify(Object.keys(taken[1]).sort()) === JSON.stringify(["glb", "id", "label", "propMm"]), JSON.stringify(taken));

  // A5. a poor outline --------------------------------------------------------------------------------------------------------
  await press("Another photo");
  scanMode = "poor";
  await find(WORD);
  s = await state();
  check("A5 a poorly traced photo with the right word still gets the item, and the sentence says the outline is not clear", s.offer?.kind === "alone" && s.offer.why === "poor_outline" && (await offerBox()).text === offerSentence(POOR), JSON.stringify(s.offer));
  check("A5 the plate is still possible, so there are still three choices", (await visibleButtons()).length === 3);
  await press("Another photo");
  s = await state();
  check("A5 starting over with the offer still on screen takes it away (it belonged to that photo)", s.step === "pick" && s.offer === null && !(await offerBox()).shown && !s.hasPhoto, JSON.stringify(s));

  // A6. no match from the helper, right word: the item on its own ------------------------------------------------------------
  scanMode = "nomatch";
  await find(WORD);
  s = await state();
  const alone = await offerBox();
  check("A6 a photo the helper could not trace, with the right word: the item is offered on its own, in the library's sentence", s.step === "pick" && alone.shown && alone.text === offerSentence(NONE) && s.offer?.why === "no_outline", JSON.stringify({ step: s.step, alone, offer: s.offer }));
  check("A6 the helper's own sentence is still shown, and the choices are the 3D item or another photo (no plate to keep)", s.bad && JSON.stringify(await visibleButtons()) === JSON.stringify([`Use the 3D ${target.label.toLowerCase()}`, "Try another photo"]), JSON.stringify([s.message, await visibleButtons()]));
  await page.shot(path.join(SHOTS, "A6-offer-alone.png"));
  await press("Try another photo");
  s = await state();
  check("A6 'Try another photo' starts over with no offer and no photo", s.step === "pick" && s.offer === null && !s.hasPhoto && !(await offerBox()).shown);
  await find(WORD);
  await press("Use the 3D");
  await page.waitFor("window.__kpp.state.equipped !== null", 5000);
  s = await state();
  check("A6 taking the item alone equips it and closes the panel", s.equipped === target.id && !(await ev("window.__kpp.isOpen()")) && (await ev("window.__taken.length")) === 3, JSON.stringify(s));

  // A7. nothing to offer ------------------------------------------------------------------------------------------------------
  await ev("window.__kpp.open()");
  scanMode = "nomatch";
  await find("zzzz");
  s = await state();
  check("A7 a word that is not in the library offers nothing, even when the photo could not be traced", s.offer === null && !(await offerBox()).shown && s.bad);
  if (unbuilt.length) {
    await find(unbuilt[0].words[0]);
    s = await state();
    check("A7 an item that is not built is never offered, even for its own word", s.offer === null && !(await offerBox()).shown, unbuilt[0].id);
  }
  scanMode = "busy";
  await find(WORD);
  s = await state();
  check("A7 a busy helper is not about the photo: the right word still offers nothing, and the child sees the helper's sentence", s.offer === null && s.bad && /busy/i.test(s.message), s.message);
  const taken2 = await ev("window.__taken.length");
  check("A7 through all of it, nothing was equipped that the child did not press a button for", taken2 === 3);
  check("A7 the offer made no call of its own to the Worker: every /api call was the scan", server.apiCalls.length > 0 && server.apiCalls.every((c) => c.path === "/api/scan"), [...new Set(server.apiCalls.map((c) => c.path))].join(","));

  // A8. catalog unreachable ---------------------------------------------------------------------------------------------------
  server.blocked.add("/kip/household/catalog.json");
  scanMode = "good";
  await mount(true);
  await find(WORD);
  s = await state();
  check("A8 with the catalog unreachable there is no offer and the plate flow goes on as before", s.hasScan && s.offer === null && !(await offerBox()).shown && s.step === "shape");
  server.blocked.delete("/kip/household/catalog.json");
  server.missing.delete("/kip/household/catalog.json");
  await ev("window.__kpp.dispose()");
  check("A8 the page had no uncaught exception", page.exceptions.length === 0, page.exceptions.join(" | "));

  // A9. the age band: an item held back for an older band is not offered; the photo plate always is -------------------------------
  const other = built.find((i) => i.id !== target.id && i.minBand === 0 && i.words.some((w) => (catalog.wordIndex.get(w) ?? []).length === 1));
  const otherWord = other?.words.find((w) => (catalog.wordIndex.get(w) ?? []).length === 1);
  const ageCase = async (name, { band, minBand = 3, word = WORD, scan = "good", expectOffer }) => {
    scanMode = scan;
    await mount(true, { minBand, band });
    await find(word);
    const st = await state();
    const shown = (await offerBox()).shown;
    check(`A9 ${name}`, expectOffer ? shown && st.offer !== null : !shown && st.offer === null, JSON.stringify({ band, offer: st.offer?.kind ?? null }));
    return st;
  };
  await ageCase("no band chosen: the item is offered (no limit)", { band: undefined, expectOffer: true });
  await ageCase("band 3, an item that starts at band 3: offered", { band: 3, expectOffer: true });
  await ageCase("band 5: offered", { band: 5, expectOffer: true });
  const held = await ageCase("band 2, an item that starts at band 3: not offered", { band: 2, expectOffer: false });
  check("A9 ...but the photo plate is: the scan is kept, the shape step is shown with 'Check it prints', and no error is said", held.hasScan && held.step === "shape" && !held.bad && (await ev(`[...document.querySelectorAll('.kpp-back button')].some((b) => b.textContent.includes('Check it prints') && !b.hidden && b.offsetParent !== null)`)), JSON.stringify(held));
  check("A9 ...and nothing was equipped", (await ev("window.__taken.length")) === 0);
  await ev("window.__kpp.dispose()");
  await ageCase("band 0, the helper could not trace the photo: the held-back item is not offered on its own either", { band: 0, scan: "nomatch", expectOffer: false });
  await ageCase("a band that is not a band (99) is the strictest: not offered", { band: 99, expectOffer: false });
  await ageCase("a reader that fails is the strictest: not offered", { band: "throw", expectOffer: false });
  if (other) {
    await ageCase(`band 0 still offers an item for every band (${other.id})`, { band: 0, word: otherWord, expectOffer: true });
    await ageCase("a band that is not a band (99) still offers an item for every band", { band: 99, word: otherWord, expectOffer: true });
  } else {
    console.log("  note: no other built item at minBand 0 with a one-item word to use as the control (checked in the unit tests)");
  }
  const aged = built.find((i) => i.minBand > 0 && i.words.some((w) => (catalog.wordIndex.get(w) ?? []).length === 1));
  if (aged) {
    const agedWord = aged.words.find((w) => (catalog.wordIndex.get(w) ?? []).length === 1);
    scanMode = "good";
    await mount(true, { band: aged.minBand - 1 });
    await find(agedWord);
    check(`A9 the real catalog's own limit: ${aged.id} (from band ${aged.minBand}) is not offered one band below`, (await state()).offer === null);
    await mount(true, { band: aged.minBand });
    await find(agedWord);
    check(`A9 ...and is offered at band ${aged.minBand}`, (await state()).offer?.item === aged.id);
  } else {
    console.log("  note: the real catalog carries no minBand above 0 yet; the rule is checked above with the target's row set to band 3");
  }
  await ev("window.__kpp.dispose()");
  check("A9 the age rule made no call of its own to the Worker", server.apiCalls.every((c) => c.path === "/api/scan"));

  } // end of part A
  if (PART.includes("B")) {
  // ======== B. the bench ============================================================================================================
  const kip = await chrome.open(`${server.base}/kip/Kip-Demo.html`, { width: 1100, height: 900 });
  kips.push(kip);
  check("B the Kip bench loads", await kip.waitFor("window.__KIP_READY__ === true", 150000, 1000));
  const kev = (expr) => kip.evaluate(expr);
  const INFO = `(() => {
    const { THREE, kip } = window.kipRig();
    const c = kip.exp.customHandContainer; c.updateMatrixWorld(true);
    const grip = c.children[0].children[0], head = grip.children[2], it = head.children[0];
    const up = new THREE.Vector3(0, 1, 0).transformDirection(head.matrixWorld);
    const front = new THREE.Vector3(0, 0, -1).transformDirection(it.matrixWorld);
    const box = new THREE.Box3().setFromObject(head);
    const g = grip.children[0].getWorldPosition(new THREE.Vector3());
    const h = new THREE.Box3().setFromObject(kip.mover);
    return { up: up.toArray(), front: front.toArray(), handle: g.toArray(), min: box.min.toArray(), max: box.max.toArray(), kipTop: h.max.y, clip: window.kipMenu.ctx.read.clip(), held: window.kipMenu.ctx.read.household(), visible: kip.exp.customHandGroup.visible, prop: window.kipMenu.ctx.read.prop ? window.kipMenu.ctx.read.prop() : null };
  })()`;
  const equip = (it) => kev(`window.kipMenu.ctx.act.equipHousehold(${JSON.stringify({ id: it.id, label: it.label, glb: it.glb, propMm: it.propMm })})`);
  const bad = [];
  const rows = [];
  for (const it of built) {
    const r = await equip(it);
    await sleep(900);
    const i = await kev(INFO);
    rows.push({ id: it.id, front: i.front[2], up: i.up[1], gripZ: i.handle[2] });
    if (!r.ok) bad.push(`${it.id}: equip failed`);
    else if (!i.held || i.held.id !== it.id) bad.push(`${it.id}: the bench does not say it is held`);
    else if (!i.visible) bad.push(`${it.id}: the hand group is hidden`);
    else if (i.clip !== "prop_magnifier") bad.push(`${it.id}: clip ${i.clip}`);
    else if (!(i.up[1] > 0.9)) bad.push(`${it.id}: not upright (up.y ${i.up[1].toFixed(2)})`);
    else if (!(i.front[2] > 0.85)) bad.push(`${it.id}: front is not to the camera (front.z ${i.front[2].toFixed(2)})`);
    else if (!(i.handle[2] > 30 && i.handle[1] > 55 && i.handle[1] < 110)) bad.push(`${it.id}: the grip is not held out in front of Kip (${i.handle.map((v) => v.toFixed(0))})`);
    else if (!(i.min[1] > i.handle[1] - 5)) bad.push(`${it.id}: the item dips below its grip (${i.min[1].toFixed(0)} vs ${i.handle[1].toFixed(0)})`);
    else if (!(Math.max(i.max[0] - i.min[0], i.max[1] - i.min[1], i.max[2] - i.min[2]) >= it.propMm - 1)) bad.push(`${it.id}: smaller than its ${it.propMm} mm prop size`);
    else if (!(Math.max(i.max[0] - i.min[0], i.max[1] - i.min[1], i.max[2] - i.min[2]) <= it.propMm * 1.75)) bad.push(`${it.id}: bigger than its ${it.propMm} mm prop size`);
    if (["wooden_spoon", "mug", "plate", "banana", "pencil", "scissors", "hammer", "toy_brick"].includes(it.id)) await kip.shot(path.join(SHOTS, `B-${it.id}.png`));
  }
  check(`B every built item (${built.length}) goes in the hand upright, facing the camera, gripped out in front of Kip, with the Inspect clip playing`, bad.length === 0, bad.slice(0, 6).join(" | "));
  const minFront = Math.min(...rows.map((r) => r.front));
  console.log(`  (lowest front.z over ${rows.length} items: ${minFront.toFixed(3)}; up.y: ${Math.min(...rows.map((r) => r.up)).toFixed(3)})`);

  const refused = await kev(`window.kipMenu.ctx.act.equipHousehold({ id: 'x', label: 'x', glb: '../../etc/passwd' })`);
  const refused2 = await kev(`window.kipMenu.ctx.act.equipHousehold({ id: 'x', label: 'x', glb: 'nothing_like_this.glb' })`);
  check("B a file name that is not a library file is refused without a request, and a missing file fails calmly", refused.ok === false && refused2.ok === false && !kip.requests.some((r) => r.url.includes("passwd")));
  const afterRefusal = await kev(`window.kipMenu.ctx.read.household()`);
  check("B a failed equip leaves the previous item in the hand", afterRefusal && afterRefusal.id === built[built.length - 1].id, JSON.stringify(afterRefusal));
  await kev(`window.kipMenu.ctx.act.setProp('off')`);
  check("B putting the prop away is reflected: the bench no longer says an item is held", (await kev(`window.kipMenu.ctx.read.household()`)) === null);

  // B2. the offer inside the bench: nothing equipped until the button ----------------------------------------------------------
  scanMode = "good";
  // From here the bench's own fetch hands the panel a catalog whose target row starts at band 3 (so the stored band is tested whatever the real catalog says).
  await kev(`(() => { window.__realFetch = window.fetch.bind(window); window.fetch = async (url, init) => { const r = await window.__realFetch(url, init); if (!String(url).endsWith('/household/catalog.json')) return r; const d = await r.json(); for (const i of d.items) if (i.id === ${JSON.stringify(target.id)}) i.minBand = 3; return new Response(JSON.stringify(d), { status: 200, headers: { 'content-type': 'application/json' } }); }; })()`);
  await kev(`window.kipMenu.ctx.act.applyPreset('clean')`); // clears every custom mount
  check("B2 a clean start: nothing in the hand", (await kev(`window.kipMenu.ctx.read.household()`)) === null);
  await kev(`document.getElementById('modal-photo').classList.add('open'); document.getElementById('btn-print-photo').click()`);
  check("B2 the panel opens in the bench", await kip.waitFor(`window.kipPhotoPrint && window.kipPhotoPrint.isOpen()`, 20000));
  const { root: kroot } = await kip.send("DOM.getDocument", { depth: 1 });
  const { nodeId: kfile } = await kip.send("DOM.querySelector", { nodeId: kroot.nodeId, selector: ".kpp-back input[type=file]" });
  await kip.send("DOM.setFileInputFiles", { files: [FIXTURE], nodeId: kfile });
  await kip.waitFor("window.kipPhotoPrint.state.hasPhoto", 20000);
  await kev(`(() => { const i = document.querySelector('.kpp-back input[type=text]'); i.value = ${JSON.stringify(WORD)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await kev(`[...document.querySelectorAll('.kpp-back button')].find((b) => b.textContent.includes('Find the shape')).click()`);
  check("B2 the offer appears in the bench panel", await kip.waitFor(`window.kipPhotoPrint.state.offer && window.kipPhotoPrint.state.offer.item === ${JSON.stringify(target.id)}`, 30000));
  await sleep(300);
  check("B2 being offered equips nothing: Kip's hand is as it was", (await kev(`window.kipMenu.ctx.read.household()`)) === null);
  await kip.shot(path.join(SHOTS, "B2-offer-in-bench.png"));
  await kev(`[...document.querySelectorAll('.kpp-back button')].find((b) => b.textContent.includes('Use the 3D') && !b.hidden).click()`);
  check("B2 'Use the 3D ...' puts that item in Kip's hand and closes the panel", await kip.waitFor(`(window.kipMenu.ctx.read.household() || {}).id === ${JSON.stringify(target.id)} && !window.kipPhotoPrint.isOpen()`, 20000));
  await sleep(1500);
  const held = await kev(INFO);
  check("B2 and it is held up, facing the camera, in the Inspect clip", held.clip === "prop_magnifier" && held.front[2] > 0.85 && held.up[1] > 0.9, JSON.stringify({ clip: held.clip, front: held.front.map((v) => +v.toFixed(2)), up: held.up.map((v) => +v.toFixed(2)) }));
  await kip.shot(path.join(SHOTS, "B2-taken.png"));
  // B3. the band the bench reads from the app's progression record ---------------------------------------------------------------
  const kpress = (label) => kev(`(() => { const b = [...document.querySelectorAll('.kpp-back button')].find((x) => x.textContent.includes(${JSON.stringify(label)}) && !x.hidden && x.offsetParent !== null); if (!b) return false; b.click(); return true; })()`);
  const kscan = async (word) => {
    await kev(`window.kipPhotoPrint.open()`);
    if (await kev(`window.kipPhotoPrint.state.hasScan || window.kipPhotoPrint.state.hasPhoto`)) await kpress("Another photo");
    const { root } = await kip.send("DOM.getDocument", { depth: 1 });
    const { nodeId } = await kip.send("DOM.querySelector", { nodeId: root.nodeId, selector: ".kpp-back input[type=file]" });
    await kip.send("DOM.setFileInputFiles", { files: [FIXTURE], nodeId });
    await kip.waitFor("window.kipPhotoPrint.state.hasPhoto", 20000);
    await kev(`(() => { const i = document.querySelector('.kpp-back input[type=text]'); i.value = ${JSON.stringify(word)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await kev(`[...document.querySelectorAll('.kpp-back button')].find((b) => b.textContent.includes('Find the shape')).click()`);
    await kip.waitFor("!window.kipPhotoPrint.state.busy", 30000);
    await sleep(300);
    return kev(`window.kipPhotoPrint.state`);
  };
  const setProgression = (v) => kev(`localStorage.setItem('toyforge:progression:v1', ${JSON.stringify(v)})`);
  await setProgression(JSON.stringify({ ageBand: 2 }));
  let st = await kscan(WORD);
  check("B3 with band 2 stored in the app's progression record, the item that starts at band 3 is not offered in the bench panel, and the photo plate is", st.offer === null && st.hasScan && st.step === "shape", JSON.stringify(st));
  await setProgression(JSON.stringify({ ageBand: 3 }));
  st = await kscan(WORD);
  check("B3 with band 3 it is offered", st.offer?.item === target.id, JSON.stringify(st.offer));
  await setProgression(JSON.stringify({ ageBand: 0 }));
  st = await kscan(WORD);
  check("B3 with band 0 it is not", st.offer === null && st.hasScan);
  for (const [name, v] of [["no record at all", null], ["a record with no band", JSON.stringify({ totalXp: 5 })], ["a record that is not JSON", "{oops"], ["a band that is not a band (9)", JSON.stringify({ ageBand: 9 })]]) {
    if (v === null) await kev(`localStorage.removeItem('toyforge:progression:v1')`); else await setProgression(v);
    st = await kscan(WORD);
    check(`B3 ${name}: no band is known, so no limit (the same as the app, which reads that as not set)`, st.offer?.item === target.id, JSON.stringify(st.offer));
  }
  await kev(`localStorage.removeItem('toyforge:progression:v1')`);
  await kev(`window.kipPhotoPrint.close()`);
  check("B the bench page had no uncaught exception", kip.exceptions.length === 0, kip.exceptions.join(" | "));
  } // end of part B
  if (PART.includes("C")) {
  // ======== C. the photo's colours on the 3D item (the game asset only) ===================================================================
  const kip = await chrome.open(`${server.base}/kip/Kip-Demo.html`, { width: 1100, height: 900 });
  kips.push(kip);
  check("C the Kip bench loads", await kip.waitFor("window.__KIP_READY__ === true", 150000, 1000));
  const kev = (expr) => kip.evaluate(expr);
  const kpress = (label) => kev(`(() => { const b = [...document.querySelectorAll('.kpp-back button')].find((x) => x.textContent.includes(${JSON.stringify(label)}) && !x.hidden && x.offsetParent !== null); if (!b) return false; b.click(); return true; })()`);
  const HAND = `(() => { const { kip } = window.kipRig(); const g = kip.exp.customHandContainer.children[0].children[0]; return { kip, grip: g, head: g.children[2] }; })()`;
  const clipRect = { x: 330, y: 60, width: 640, height: 720, scale: 1 };
  const shotPng = async (name) => {
    const r = await kip.send("Page.captureScreenshot", { format: "png", clip: clipRect });
    const buf = Buffer.from(r.data, "base64");
    fs.mkdirSync(SHOTS, { recursive: true });
    fs.writeFileSync(path.join(SHOTS, `C-${name}.png`), buf);
    return decodePng(buf);
  };
  const diff = (a, b, thr = 36) => { // the pixels where two pictures differ by more than thr (sum of channels)
    const m = new Uint8Array(a.w * a.h);
    for (let i = 0; i < a.w * a.h; i++) m[i] = Math.abs(a.data[i * 4] - b.data[i * 4]) + Math.abs(a.data[i * 4 + 1] - b.data[i * 4 + 1]) + Math.abs(a.data[i * 4 + 2] - b.data[i * 4 + 2]) > thr ? 1 : 0;
    return m;
  };
  const count = (m) => m.reduce((n, v) => n + v, 0);
  const avg = (img, mask) => { let r = 0, g = 0, b = 0, n = 0; for (let i = 0; i < mask.length; i++) if (mask[i]) { r += img.data[i * 4]; g += img.data[i * 4 + 1]; b += img.data[i * 4 + 2]; n++; } return n ? [r / n, g / n, b / n].map(Math.round) : [0, 0, 0]; };
  const scanWith = async (word, file) => {
    await kev(`window.kipPhotoPrint ? window.kipPhotoPrint.open() : document.getElementById('btn-print-photo').click()`);
    await kip.waitFor(`window.kipPhotoPrint && window.kipPhotoPrint.isOpen()`, 20000);
    if (await kev(`window.kipPhotoPrint.state.hasScan || window.kipPhotoPrint.state.hasPhoto`)) await kpress("Another photo");
    const { root } = await kip.send("DOM.getDocument", { depth: 1 });
    const { nodeId } = await kip.send("DOM.querySelector", { nodeId: root.nodeId, selector: ".kpp-back input[type=file]" });
    await kip.send("DOM.setFileInputFiles", { files: [file], nodeId });
    await kip.waitFor("window.kipPhotoPrint.state.hasPhoto", 20000);
    await kev(`(() => { const i = document.querySelector('.kpp-back input[type=text]'); i.value = ${JSON.stringify(word)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await kev(`[...document.querySelectorAll('.kpp-back button')].find((b) => b.textContent.includes('Find the shape')).click()`);
    await kip.waitFor("!window.kipPhotoPrint.state.busy", 30000);
    await sleep(300);
    return kev(`window.kipPhotoPrint.state`);
  };
  const hold = async () => { // freeze the Inspect clip at one time so every picture is the same pose
    await kev(`window.kipClips.scrub('prop_magnifier', 0.5)`);
    await sleep(500);
  };
  const turn = (rad) => kev(`(() => { const { head } = ${HAND}; head.rotation.y = ${rad}; })()`);
  const showHand = (on) => kev(`(() => { const { kip } = window.kipRig(); kip.exp.customHandGroup.visible = ${on}; })()`);

  // C0. the picture is the right way round: a skin that is red on the left and blue on the right reads that way from the front -----------------
  const half = { w: 8, h: 8, widthMm: 40, heightMm: 40, data: [] };
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) half.data.push(...(x < 4 ? [235, 30, 30, 255] : [30, 60, 235, 255]));
  const ballRow = catalog.items.find((i) => i.id === "ball" && i.built) ?? built.find((i) => i.id === "marble") ?? built[0];
  const withSkin = await kev(`window.kipMenu.ctx.act.equipHousehold(${JSON.stringify({ id: ballRow.id, label: ballRow.label, glb: ballRow.glb, propMm: ballRow.propMm })}, { skin: ${JSON.stringify({ ...half, data: half.data })} })`);
  check("C0 the bench says it coloured the item when it was handed a skin", withSkin.ok === true && withSkin.coloured === true, JSON.stringify(withSkin));
  await hold();
  await showHand(false);
  const bare = await shotPng("bare");
  await showHand(true);
  await kev(`window.kipMenu.ctx.act.setHouseholdLook('standard')`);
  const stdBall = await shotPng("ball-standard");
  await kev(`window.kipMenu.ctx.act.setHouseholdLook('photo')`);
  const halfBall = await shotPng("ball-half");
  const itemMask = diff(stdBall, bare, 24);
  const sx = (() => { let lo = 1e9, hi = -1; for (let i = 0; i < itemMask.length; i++) if (itemMask[i]) { const x = i % bare.w; lo = Math.min(lo, x); hi = Math.max(hi, x); } return [lo, hi]; })();
  const mid = (sx[0] + sx[1]) / 2;
  const leftMask = itemMask.map((v, i) => (v && (i % bare.w) < mid - 6 ? 1 : 0));
  const rightMask = itemMask.map((v, i) => (v && (i % bare.w) > mid + 6 ? 1 : 0));
  const lc = avg(halfBall, leftMask), rc = avg(halfBall, rightMask);
  check("C0 a skin that is red on its left and blue on its right is red on the viewer's left and blue on the viewer's right (not mirrored)", (lc[0] - lc[2]) - (rc[0] - rc[2]) > 40 && lc[0] > lc[2] && rc[2] > rc[0] - 10, JSON.stringify({ left: lc, right: rc, item: sx }));

  // C1. the three real combinations, front and side -------------------------------------------------------------------------------------
  const byId = (id) => built.find((i) => i.id === id);
  const combos = [
    { name: "spoon-on-spoon", item: target, word: WORD, mode: "good", file: FIXTURE, expect: "steel" },
    { name: "cup-on-mug", item: byId("mug"), word: "mug", mode: "cup", file: CUP_FIXTURE, expect: "red" },
    { name: "cup-on-ball", item: byId("ball"), word: "ball", mode: "cup", file: CUP_FIXTURE, expect: "red" },
  ];
  const stats = [];
  for (const c of combos) {
    if (!c.item) { console.log(`  note: ${c.name} skipped, the item is not built`); continue; }
    scanMode = c.mode;
    await kev(`window.kipMenu.ctx.act.setProp('off')`); // the previous combination's item is put away
    const st = await scanWith(c.word, c.file);
    check(`C1 ${c.name}: the offer shows, and it says the item can wear the photo's colours`, st.offer?.item === c.item.id && (await kev(`!document.querySelector('.kpp-offer p.kpp-note').hidden`)), JSON.stringify(st.offer));
    check(`C1 ${c.name}: before the button is pressed nothing is in the hand`, (await kev(`window.kipMenu.ctx.read.household()`)) === null);
    await kpress("Use the 3D");
    await kip.waitFor(`(window.kipMenu.ctx.read.household() || {}).id === ${JSON.stringify(c.item.id)}`, 20000);
    const after = await kev(`window.kipPhotoPrint.state`);
    check(`C1 ${c.name}: the status line says it is coloured from the photo, and the bench agrees`, after.coloured === true && /coloured from your photo/.test(after.message) && (await kev(`window.kipMenu.ctx.read.householdLook()`)) === "photo", JSON.stringify({ message: after.message, coloured: after.coloured }));
    await hold();
    await showHand(false); const b = await shotPng(`${c.name}-bare`); await showHand(true);
    const views = {};
    for (const [vname, rad] of [["front", 0], ["side", Math.PI / 2], ["back", Math.PI]]) {
      await turn(rad);
      await kev(`window.kipMenu.ctx.act.setHouseholdLook('photo')`); await sleep(150);
      const ph = await shotPng(`${c.name}-${vname}-photo`);
      await kev(`window.kipMenu.ctx.act.setHouseholdLook('standard')`); await sleep(150);
      const sd = await shotPng(`${c.name}-${vname}-standard`);
      const mask = diff(sd, b, 24);
      const changed = diff(ph, sd, 40);
      views[vname] = { itemPx: count(mask), changedPx: count(changed.map((v, i) => (v && mask[i] ? 1 : 0))), photoAvg: avg(ph, mask), stdAvg: avg(sd, mask) };
    }
    await turn(0);
    await kev(`window.kipMenu.ctx.act.setHouseholdLook('photo')`);
    const f = views.front, sd = views.side, bk = views.back;
    const share = (v) => v.changedPx / Math.max(1, v.itemPx);
    stats.push({ name: c.name, front: share(f).toFixed(2), side: share(sd).toFixed(2), back: share(bk).toFixed(2), frontPhotoAvg: f.photoAvg, frontStdAvg: f.stdAvg });
    check(`C1 ${c.name}: from the front the photo changes most of the item (${(share(f) * 100).toFixed(0)}% of its pixels)`, share(f) > 0.35, JSON.stringify(f));
    check(`C1 ${c.name}: from the back the item is its own zone colours, the photo does not smear through (${(share(bk) * 100).toFixed(1)}% changed)`, share(bk) < 0.03, JSON.stringify(bk));
    check(`C1 ${c.name}: from the side far less of it changes than from the front (${(share(sd) * 100).toFixed(0)}% against ${(share(f) * 100).toFixed(0)}%)`, share(sd) < share(f) * 0.6, JSON.stringify({ front: share(f), side: share(sd) }));
    const skinAspect = await kev(`(() => { const k = window.kipPhotoPrint.lastSkin; return k ? k.widthMm / k.heightMm : null; })()`);
    stats[stats.length - 1].skinAspect = skinAspect && +skinAspect.toFixed(2);
    if (c.name === "cup-on-mug") {
      check("C1 cup-on-mug: the photo is the way up it was taken (a mug upright, wider than tall), not turned on its side by the scan", skinAspect > 1, String(skinAspect));
      // the red cup has a white band across its middle: seen on the mug the band runs ACROSS (some rows nearly all white, others nearly all red)
      const img = await shotPng("cup-on-mug-band-photo");
      await kev(`window.kipMenu.ctx.act.setHouseholdLook('standard')`); await sleep(150);
      const itemM = diff(await shotPng("cup-on-mug-band-standard"), b, 24);
      await kev(`window.kipMenu.ctx.act.setHouseholdLook('photo')`); await sleep(150);
      let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
      for (let i = 0; i < itemM.length; i++) if (itemM[i]) { const x = i % b.w, y = Math.floor(i / b.w); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      const cx0 = x0 + 0.38 * (x1 - x0), cx1 = x0 + 0.62 * (x1 - x0); // the middle of the item, away from the fade at its edges and the handle
      const rowWhite = [];
      for (let y = Math.round(y0 + 0.2 * (y1 - y0)); y < y0 + 0.8 * (y1 - y0); y++) {
        let white = 0, n = 0;
        for (let x = Math.round(cx0); x < cx1; x++) if (itemM[y * b.w + x]) { n++; const o = (y * img.w + x) * 4; if (img.data[o] > 200 && img.data[o + 1] > 200 && img.data[o + 2] > 200) white++; }
        if (n > 4) rowWhite.push(white / n);
      }
      const spread = Math.max(...rowWhite) - Math.min(...rowWhite);
      check("C1 cup-on-mug: the white band runs across the mug (some rows nearly all white, some nearly all red)", rowWhite.length > 20 && spread > 0.7, `rows ${rowWhite.length}, spread ${spread.toFixed(2)}`);
    }
    if (c.expect === "red") check(`C1 ${c.name}: the photo's own colours land on it (its front average is red, not its zone colour)`, f.photoAvg[0] > f.photoAvg[2] + 40 && f.photoAvg[0] > f.photoAvg[1] + 30, JSON.stringify(f.photoAvg));
    // the numbers behind the pictures: every vertex's weight follows its normal
    const mode = await kev(`window.kipMenu.ctx.read.householdMode()`);
    const w = await kev(`(() => { const { head } = ${HAND}; const item = head.children[0]; const out = { n: 0, badSide: 0, badFront: 0, backMax: 0, uvOut: 0, frontMin: 1 }; item.updateMatrixWorld(true); item.traverse((o) => { if (!o.isMesh) return; const g = o.geometry; const nor = g.attributes.normal, W = g.attributes.skinW, UV = g.attributes.skinUv; if (!W || !UV) { out.missing = true; return; } for (let i = 0; i < W.count; i++) { const nz = nor.getZ(i); const cosFront = -nz; const wgt = W.getX(i); out.n++; if (cosFront <= 0.25 && wgt !== 0) out.badSide++; if (cosFront >= 0.8 && Math.abs(wgt - 1) > 1e-6) out.badFront++; if (cosFront < 0) out.backMax = Math.max(out.backMax, wgt); if (cosFront >= 0.8) out.frontMin = Math.min(out.frontMin, wgt); if (UV.getX(i) < -1e-6 || UV.getX(i) > 1 + 1e-6 || UV.getY(i) < -1e-6 || UV.getY(i) > 1 + 1e-6) out.uvOut++; } }); return out; })()`);
    check(`C1 ${c.name}: every one of its ${w.n} vertices follows the rule (no photo at or past 75 degrees, all of it within 37), nothing on the back, every UV inside the picture`, !w.missing && w.n > 0 && w.badSide === 0 && w.badFront === 0 && w.backMax === 0 && (mode === "contain" || w.uvOut === 0), JSON.stringify({ ...w, mode }));
    stats[stats.length - 1].mode = mode;
    await kip.shot(path.join(SHOTS, `C-${c.name}-page.png`));
  }
  console.log("  C1 changed-pixel shares:", JSON.stringify(stats));

  // C1b. a photo whose shape is nothing like the item's: it is not stretched to fit (spoon photo on the mug), unless forced ---------------------------------
  {
    const mug = byId("mug");
    if (mug) {
      scanMode = "good";
      await kev(`window.kipMenu.ctx.act.setProp('off')`);
      await scanWith("mug", FIXTURE);
      await kpress("Use the 3D");
      await kip.waitFor(`(window.kipMenu.ctx.read.household() || {}).id === 'mug'`, 20000);
      await hold();
      const modes = {};
      for (const m of ["auto", "fit", "contain"]) {
        if (m !== "auto") await kev(`window.kipMenu.ctx.act.equipHousehold(${JSON.stringify({ id: mug.id, label: mug.label, glb: mug.glb, propMm: mug.propMm })}, { skin: window.kipPhotoPrint.lastSkin, skinMode: ${JSON.stringify(m)} })`);
        await hold();
        modes[m] = await kev(`window.kipMenu.ctx.read.householdMode()`);
        await shotPng(`spoon-on-mug-${m}`);
      }
      check("C1b a narrow spoon photo on the wide mug is not stretched to fit by itself (mode contain), and each mode can be forced (look at C-spoon-on-mug-*.png)", modes.auto === "contain" && modes.fit === "fit" && modes.contain === "contain", JSON.stringify(modes));
      // the scan's own turned outline (long axis up) is used when it fits the item's front better: the cup photo on a tall, thin item
      const tall = built.filter((i) => i.id !== "mug" && i.frontMm).sort((a, z) => a.frontMm[0] / a.frontMm[1] - z.frontMm[0] / z.frontMm[1])[0];
      scanMode = "cup";
      await kev(`window.kipMenu.ctx.act.setProp('off')`);
      await scanWith(tall.words[0], CUP_FIXTURE);
      await kpress("Use the 3D");
      await kip.waitFor(`(window.kipMenu.ctx.read.household() || {}).id === ${JSON.stringify(tall.id)}`, 20000);
      const turnedAspect = await kev(`(() => { const k = window.kipPhotoPrint.lastSkin; return k ? k.widthMm / k.heightMm : null; })()`);
      check(`C1b the cup photo on a tall thin item (${tall.id}): the scan's own turned outline (taller than wide) is the better fit and is used`, turnedAspect !== null && turnedAspect < 1, String(turnedAspect));
    }
  }

  // C2. the way back, and what is said ------------------------------------------------------------------------------------------------
  const chipState = () => kev(`(() => { const c = document.querySelector('.khh-chip'); return c && !c.hidden ? { text: c.querySelector('span').textContent, button: c.querySelector('button').textContent } : null; })()`);
  const chip = await chipState();
  check("C2 while a coloured item is held a small chip says so and offers its own colours", chip && /coloured from your photo/.test(chip.text) && /own colours/.test(chip.button), JSON.stringify(chip));
  await kev(`document.querySelector('.khh-chip button').click()`);
  const chip2 = await chipState();
  check("C2 pressing it puts the item's own colours back, and the chip says that (and offers the photo's colours again)", (await kev(`window.kipMenu.ctx.read.householdLook()`)) === "standard" && chip2 && /own colours/.test(chip2.text) && !/coloured from your photo/.test(chip2.text) && /Photo colours/.test(chip2.button), JSON.stringify(chip2));
  await kev(`document.querySelector('.khh-chip button').click()`);
  check("C2 and a second press brings the photo back", (await kev(`window.kipMenu.ctx.read.householdLook()`)) === "photo");
  await kev(`window.kipMenu.ctx.act.setProp('off')`);
  check("C2 putting the prop away takes the chip away", (await chipState()) === null);

  // C3. a word-only offer (no outline) keeps the zone colours and never says otherwise ------------------------------------------------------
  scanMode = "nomatch";
  const st0 = await scanWith(WORD, FIXTURE);
  check("C3 with no outline the offer does not say the item can wear the photo's colours", st0.offer?.why === "no_outline" && (await kev(`document.querySelector('.kpp-offer p.kpp-note').hidden`)), JSON.stringify(st0.offer));
  await kpress("Use the 3D");
  await kip.waitFor(`(window.kipMenu.ctx.read.household() || {}).id === ${JSON.stringify(target.id)}`, 20000);
  const st1 = await kev(`window.kipPhotoPrint.state`);
  check("C3 the status line does not say 'coloured', the item has no photo look, and there is no chip", st1.coloured === false && !/colour/i.test(st1.message) && (await kev(`window.kipMenu.ctx.read.householdLook()`)) === null && (await chipState()) === null, JSON.stringify({ message: st1.message }));
  check("C3 its materials are the GLB's own (no skin shader)", await kev(`(() => { const { head } = ${HAND}; let any = false; head.traverse((o) => { if (o.isMesh) { const ms = Array.isArray(o.material) ? o.material : [o.material]; if (ms.some((m) => m.onBeforeCompile && m.onBeforeCompile.toString().includes('skinMap'))) any = true; if (o.geometry.attributes.skinW) any = true; } }); return !any; })()`));

  const noSkin = await kev(`window.kipMenu.ctx.act.equipHousehold(${JSON.stringify({ id: target.id, label: target.label, glb: target.glb, propMm: target.propMm })})`);
  const badSkin = await kev(`window.kipMenu.ctx.act.equipHousehold(${JSON.stringify({ id: target.id, label: target.label, glb: target.glb, propMm: target.propMm })}, { skin: { w: 3, h: 3, widthMm: 5, heightMm: 5, data: [1, 2, 3] } })`);
  check("C3 the bench says it did NOT colour the item when it was handed no skin, or one it cannot use (the item is still held, in its own colours)", noSkin.ok === true && noSkin.coloured === false && badSkin.ok === true && badSkin.coloured === false && (await kev(`window.kipMenu.ctx.read.householdLook()`)) === null, JSON.stringify({ noSkin, badSkin }));

  // C4. the same item twice: coloured, then not, from one load; the print pack never sees it ----------------------------------------------
  scanMode = "good";
  await scanWith(WORD, FIXTURE);
  await kpress("Use the 3D");
  await kip.waitFor(`(window.kipMenu.ctx.read.householdLook()) === 'photo'`, 20000);
  const state = await kev(`window.kipMenu.ctx.read.household()`);
  check("C4 the bench says which look the held item has", state && state.id === target.id);
  const packTouched = await kev(`(() => { const s = window.kipPrint && window.kipPrint.summary ? window.kipPrint.summary() : null; return JSON.stringify(s || {}).toLowerCase().includes('household') || JSON.stringify(s || {}).includes('skin'); })()`);
  check("C4 the print view's summary knows nothing of the library item or its skin (a print stays single-colour)", packTouched === false);
  check("C pages had no uncaught exception", kip.exceptions.length === 0, kip.exceptions.join(" | "));
  } // end of part C
  check("the pages loaded no file that was missing", server.missing.size === 0, [...server.missing].join(","));
} catch (e) {
  check("the run reached its end", false, String(e?.stack ?? e).slice(0, 700));
} finally {
  finish();
  for (const p of [...hosts, ...kips]) p.close();
  chrome.close();
  server.close();
  console.log(`screenshots: ${SHOTS}`);
  setTimeout(() => process.exit(process.exitCode ?? 0), 200);
}
