// Photo → printable hand accessory: the panel (docs/specs/forge-ai-spec.md, F2b "a screen that calls it").
//
// A child types what it is, picks a photo, sees the cut line drawn on the photo, flips or resizes it, and a grown-up passes the
// check; then the shape is fitted to the printer's rules and the child gets a plate file (.stl) and a sticker sheet to cut out.
//
// This file is only buttons and pictures. Everything that can go wrong is decided, with one calm sentence, in shared/photoPrintFlow.ts
// (bundled by scripts/build-kip.ts into kip-photo-print-core.js) and tested there. The sticker sheet comes from kip-print-stickers.js.
//
// Rules (checked by scripts/e2e-kip-photo-print.mjs):
//   - Nothing is sent until "Find the shape" is pressed; the photo goes to /api/scan only. The forge routes get an outline, never a photo.
//   - The photo, the proof from the grown-up check and the files live in this closure and in memory only: no cookies, no storage writes.
//     The one storage access is a READ of the app's anonymous device id (the same key the selfie helper reads).
//   - All DOM and CSS sit inside the root it is given; no listener on window or document; timers and object URLs are let go by dispose().
//   - Every message is a sentence from the flow module or written here; a server's words and raw codes are never shown. Text is set with
//     textContent, never as HTML.

import * as flow from './kip-photo-print-core.js?v=10.0';
import * as ST from './kip-print-stickers.js'; // the same specifier kip-print-view.js uses, so the browser loads it once
import { createWorkshop } from './kip-workshop-wait.js'; // the waiting state: belt, bricks, parts pile, driven by the real stages below

/** The app's anonymous device id lives under this key (src/lib/sync.ts); the same one kip-selfie-cloud.js reads. */
export const DEVICE_KEY = 'toyforge:device:v1';
/** The photo sent to the helper is shrunk to this on its long side; the sticker is cut from a larger copy kept in memory. */
export const SEND_SIDE = 512;
export const STICKER_SIDE = 1024;
const SEND_QUALITY = 0.85;

const CSS = `
.kpp-back{position:fixed;inset:0;background:rgba(27,34,56,.34);backdrop-filter:blur(6px);display:none;align-items:center;justify-content:center;z-index:45;padding:18px}
.kpp-back.open{display:flex}
.kpp-card{background:#fbf9f5;border:1px solid rgba(27,34,56,.15);border-radius:20px;box-shadow:0 22px 56px rgba(27,34,56,.24);width:min(620px,96vw);max-height:90vh;overflow-y:auto;padding:18px 20px;display:flex;flex-direction:column;gap:12px;user-select:text;color:#1b2238;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.kpp-card *{box-sizing:border-box}
.kpp-head{display:flex;justify-content:space-between;align-items:center;gap:10px}
.kpp-head h2{font-size:16px;font-weight:800;letter-spacing:-.01em;margin:0}
.kpp-sub{font-size:12.5px;color:#5d657c;line-height:1.45;margin:0}
.kpp-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.kpp-label{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:#5d657c;min-width:70px}
.kpp-card button,.kpp-file{font:inherit;font-size:12.5px;font-weight:700;color:#1b2238;background:rgba(255,255,255,.7);border:1px solid rgba(27,34,56,.11);padding:6px 11px;border-radius:9px;cursor:pointer;display:inline-flex;align-items:center;gap:5px}
.kpp-card button:hover,.kpp-file:hover{background:#fff;border-color:rgba(27,34,56,.25)}
.kpp-card button:disabled{opacity:.45;cursor:default}
.kpp-card button.kpp-go{background:#ff6b4a;border-color:#ff6b4a;color:#fff}
.kpp-card button.kpp-ok{background:#1fa97c;border-color:#1fa97c;color:#fff}
.kpp-card input[type=text],.kpp-card input[type=number]{font:inherit;font-size:13px;padding:6px 9px;border:1px solid rgba(27,34,56,.2);border-radius:9px;background:#fff;color:#1b2238;min-width:0}
.kpp-card input[type=range]{flex:1;min-width:120px}
.kpp-stage{display:flex;justify-content:center;background:#efe9dd;border-radius:14px;padding:8px}
.kpp-stage canvas{display:block;width:auto;height:auto;max-width:100%;max-height:min(46vh,420px);border-radius:8px;background:#fff}
.kpp-status{font-size:13px;line-height:1.45;min-height:1.45em}
.kpp-status.kpp-bad{color:#b3261e;font-weight:700}
.kpp-hints{margin:0;padding-left:18px;font-size:12.5px;color:#5d657c;line-height:1.45}
.kpp-note{font-size:11.5px;color:#5d657c}
.kpp-links{display:flex;flex-wrap:wrap;gap:8px}
.kpp-links a{font-size:12.5px;font-weight:700;color:#fff;background:#1fa97c;padding:6px 11px;border-radius:9px;text-decoration:none}
.kpp-sheet{max-width:100%;max-height:340px;object-fit:contain;align-self:center;border:1px solid rgba(27,34,56,.15);border-radius:10px;background:#fff}
.kpp-card [hidden]{display:none!important}
`;

function el(doc, tag, props = {}, ...kids) {
  const n = doc.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (v === true) n.setAttribute(k, '');
    else if (v !== false && v != null) n.setAttribute(k, String(v));
  }
  for (const kid of kids) if (kid) n.append(kid);
  return n;
}

/** "spoon" → "Spoon": the accessory's name in the game. */
function titleCase(word) {
  const w = word.trim().slice(0, 40);
  return w.charAt(0).toUpperCase() + w.slice(1);
}

function slug(word) {
  return word.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'photo';
}

function defaultDeviceId() {
  try { return localStorage.getItem(DEVICE_KEY); } catch { return null; }
}

/** The picture drawn on white (a JPEG has no transparency), shrunk so its long side is at most `side`. */
function shrink(doc, img, side) {
  const k = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * k));
  const h = Math.max(1, Math.round(img.naturalHeight * k));
  const c = doc.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return c;
}

/**
 * The panel. `root` is the element it lives in (the bench root); nothing is added anywhere else.
 * @param {{ root: Element, fetch?: (url: string, init?: RequestInit) => Promise<Response>, deviceId?: () => string | null }} options
 */
export function createPhotoPrint({ root, fetch: fetchFn, deviceId = defaultDeviceId } = {}) {
  if (!root) throw new Error('createPhotoPrint needs a root element');
  const doc = root.ownerDocument;
  const doFetch = fetchFn ?? ((url, init) => fetch(url, init));
  const gate = flow.createParentGate({ fetch: doFetch, deviceId });

  const state = {
    step: 'pick', // pick | shape | gate | working | done
    word: '',
    heightMm: flow.DEFAULT_HEIGHT_MM,
    photo: null, // { send: canvas, dataUrl, w, h, source: { w, h, data } }
    scan: null,
    choices: { flip: false, scale: 1, symmetry: undefined },
    preview: null,
    busy: false,
    message: '',
    bad: false,
    result: null,
  };

  let built = null;
  let urls = [];
  let gateWaiter = null; // { resolve } while the grown-up question is on screen
  let disposed = false;

  const forgetUrls = () => { for (const u of urls) URL.revokeObjectURL(u); urls = []; };
  // The printer check can take a minute (up to four gate tries, with real rests when the Worker's limiter says wait). The strip shows the real stages
  // (see onProgress) and also owns the rest countdown; its words go to the panel's status line, which is what a screen reader hears.
  const workshop = createWorkshop({ doc, onLabel: (text) => say(text) });
  const blobUrl = (data, type) => { const u = URL.createObjectURL(new Blob([data], { type })); urls.push(u); return u; };

  function build() {
    if (built) return built;
    const $ = {};
    $.back = el(doc, 'div', { class: 'kpp-back', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Print a photo accessory', tabindex: '-1' });
    const card = el(doc, 'div', { class: 'kpp-card' });
    $.back.append(el(doc, 'style', { text: CSS }), card);

    $.close = el(doc, 'button', { type: 'button', text: '✕ Close' });
    card.append(el(doc, 'div', { class: 'kpp-head' }, el(doc, 'h2', { text: '🖨️ Print a photo accessory' }), $.close));
    card.append(el(doc, 'p', { class: 'kpp-sub', text: 'Pick a photo of something Kip can hold, like a spoon or a sword. You get a plate to print and a sticker with your photo on it to stick on top.' }));

    // pick
    $.pick = el(doc, 'div', { class: 'kpp-pick', style: 'display:flex;flex-direction:column;gap:12px' });
    $.word = el(doc, 'input', { type: 'text', maxlength: String(flow.MAX_WORD), placeholder: 'spoon, sword, wand…', 'aria-label': 'What is it?' });
    $.file = el(doc, 'input', { type: 'file', accept: 'image/*', hidden: true });
    $.fileBtn = el(doc, 'label', { class: 'kpp-file' }, doc.createTextNode('📷 Take or pick a photo'), $.file);
    $.size = el(doc, 'input', { type: 'range', min: String(flow.MIN_HEIGHT_MM), max: String(flow.MAX_HEIGHT_MM), step: '1', value: String(flow.DEFAULT_HEIGHT_MM), 'aria-label': 'How tall, in millimetres' });
    $.sizeText = el(doc, 'span', { text: `${flow.DEFAULT_HEIGHT_MM} mm tall` });
    $.find = el(doc, 'button', { type: 'button', class: 'kpp-go', text: '🔍 Find the shape', disabled: true });
    $.pick.append(
      el(doc, 'div', { class: 'kpp-row' }, el(doc, 'span', { class: 'kpp-label', text: 'What is it?' }), $.word),
      el(doc, 'div', { class: 'kpp-row' }, el(doc, 'span', { class: 'kpp-label', text: 'Photo' }), $.fileBtn),
      el(doc, 'div', { class: 'kpp-row' }, el(doc, 'span', { class: 'kpp-label', text: 'Size' }), $.size, $.sizeText),
      el(doc, 'div', { class: 'kpp-row' }, $.find),
      el(doc, 'p', { class: 'kpp-note', text: 'To find the shape, your photo is sent to our online helper. Our server does not keep it.' }),
    );

    // shape
    $.shape = el(doc, 'div', { class: 'kpp-shape', style: 'display:flex;flex-direction:column;gap:10px' });
    $.canvas = el(doc, 'canvas', { 'aria-label': 'Your photo with the cut line' });
    $.hints = el(doc, 'ul', { class: 'kpp-hints' });
    $.flip = el(doc, 'button', { type: 'button', text: '↕ Flip it over' });
    $.smaller = el(doc, 'button', { type: 'button', text: '− Smaller' });
    $.bigger = el(doc, 'button', { type: 'button', text: '+ Bigger' });
    $.sym = el(doc, 'button', { type: 'button', text: '◐ Make both sides the same' });
    $.dims = el(doc, 'span', { class: 'kpp-note' });
    $.again = el(doc, 'button', { type: 'button', text: '↩ Another photo' });
    $.check = el(doc, 'button', { type: 'button', class: 'kpp-ok', text: '✅ Check it prints' });
    $.shape.append(
      el(doc, 'div', { class: 'kpp-stage' }, $.canvas),
      $.hints,
      el(doc, 'div', { class: 'kpp-row' }, $.flip, $.smaller, $.bigger, $.sym, $.dims),
      el(doc, 'div', { class: 'kpp-row' }, $.again, $.check),
    );

    // grown-up question
    $.gate = el(doc, 'div', { class: 'kpp-gate', style: 'display:flex;flex-direction:column;gap:10px' });
    $.gateQ = el(doc, 'div', { class: 'kpp-status', style: 'font-weight:800' });
    $.gateIn = el(doc, 'input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', 'aria-label': 'The grown-up answer' });
    $.gateGo = el(doc, 'button', { type: 'button', class: 'kpp-go', text: 'Check' });
    $.gateNo = el(doc, 'button', { type: 'button', text: 'Cancel' });
    $.gate.append(
      el(doc, 'p', { class: 'kpp-sub', text: 'A grown-up needs to say yes before the printer check starts.' }),
      $.gateQ,
      el(doc, 'div', { class: 'kpp-row' }, $.gateIn, $.gateGo, $.gateNo),
    );

    // working
    $.work = el(doc, 'div', { class: 'kpp-work', style: 'display:flex;flex-direction:column;gap:8px' });
    $.work.append(el(doc, 'p', { class: 'kpp-sub', text: 'The printer check can take a minute. You can leave this open.' }), workshop.node);

    // done
    $.done = el(doc, 'div', { class: 'kpp-done', style: 'display:flex;flex-direction:column;gap:10px' });
    $.summary = el(doc, 'div', { class: 'kpp-status' });
    $.doneHints = el(doc, 'ul', { class: 'kpp-hints' });
    $.sheet = el(doc, 'img', { class: 'kpp-sheet', alt: 'Your sticker sheet' });
    $.links = el(doc, 'div', { class: 'kpp-links' });
    $.restart = el(doc, 'button', { type: 'button', text: '↩ Start again' });
    $.done.append($.summary, $.doneHints, $.links, $.sheet, el(doc, 'div', { class: 'kpp-row' }, $.restart));

    $.status = el(doc, 'div', { class: 'kpp-status', role: 'status', 'aria-live': 'polite' });
    card.append($.pick, $.shape, $.gate, $.work, $.done, $.status);
    root.append($.back);
    built = $;
    wire($);
    return $;
  }

  function say(text, bad = false) {
    state.message = text;
    state.bad = bad;
    if (built) {
      built.status.textContent = text;
      built.status.classList.toggle('kpp-bad', bad);
    }
  }

  function show(step) {
    state.step = step;
    if (!built) return;
    built.pick.hidden = step !== 'pick';
    built.shape.hidden = step !== 'shape';
    built.gate.hidden = step !== 'gate';
    built.work.hidden = step !== 'working';
    built.done.hidden = step !== 'done';
  }

  function refreshPick() {
    if (!built) return;
    built.find.disabled = state.busy || !state.photo || !state.word.trim();
    built.sizeText.textContent = `${state.heightMm} mm tall`;
  }

  function drawShape() {
    const $ = built;
    const photo = state.photo;
    if (!photo || !state.preview) return;
    const k = Math.min(1, 380 / Math.max(photo.w, photo.h));
    $.canvas.width = Math.round(photo.w * k);
    $.canvas.height = Math.round(photo.h * k);
    const ctx = $.canvas.getContext('2d');
    ctx.drawImage(photo.send, 0, 0, $.canvas.width, $.canvas.height);
    const pts = flow.overlayPoints(state.preview);
    if (pts.length) {
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * k, y * k) : ctx.moveTo(x * k, y * k)));
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,107,74,0.18)';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#ff6b4a';
      ctx.stroke();
    }
    $.dims.textContent = `${state.preview.widthMm} × ${state.preview.heightMm} mm`;
    const hints = flow.hintsFor(state.preview.warnings);
    $.hints.replaceChildren(...hints.map((t) => el(doc, 'li', { text: t })));
    $.sym.hidden = state.choices.symmetry === 'mirror' || !flow.canMakeSymmetric(state.scan);
  }

  /** Recompute the previewed outline from the choices. Returns false (and says why) when the choices cannot be made. */
  function repreview(next) {
    const p = flow.previewChoices(state.scan, next);
    if (!p.ok) { say(p.message, true); return false; }
    state.choices = next;
    state.preview = p.outline;
    if (p.appliedScale !== undefined && Math.abs(p.appliedScale - (next.scale ?? 1)) > 1e-9) {
      state.choices = { ...next, scale: p.appliedScale };
      say('That is as big as it can go.');
    } else {
      say('');
    }
    drawShape();
    return true;
  }

  async function pickFile(file) {
    if (!file) return;
    say('');
    state.photo = null;
    refreshPick();
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error('bad image'));
        i.src = url;
      });
      const send = shrink(doc, img, SEND_SIDE);
      const big = shrink(doc, img, STICKER_SIDE);
      const px = big.getContext('2d').getImageData(0, 0, big.width, big.height);
      state.photo = { send, dataUrl: send.toDataURL('image/jpeg', SEND_QUALITY), w: send.width, h: send.height, source: { w: big.width, h: big.height, data: px.data } };
      say('Got the photo. Type what it is, then press Find the shape.');
    } catch {
      say('That file could not be read as a picture. Try another one.', true);
    } finally {
      URL.revokeObjectURL(url);
    }
    refreshPick();
  }

  async function findShape() {
    if (state.busy || !state.photo) return;
    state.busy = true;
    refreshPick();
    say('Looking for the shape…');
    const r = await flow.scanPhoto(doFetch, { imageDataUrl: state.photo.dataUrl, word: state.word, targetHeightMm: state.heightMm });
    state.busy = false;
    if (!r.ok) { say(r.message, true); refreshPick(); return; }
    state.scan = r.scan;
    state.choices = { flip: false, scale: 1, symmetry: undefined };
    state.preview = r.scan;
    show('shape');
    say('Here is the cut line. Flip it, change the size, then check it prints.');
    drawShape();
  }

  /** Put the grown-up question on screen and wait for a right answer (true) or Cancel (false). */
  function askGate() {
    return new Promise(async (resolve) => {
      const $ = built;
      const before = state.step;
      gateWaiter = { resolve: (ok) => { gateWaiter = null; show(ok ? 'working' : before === 'working' ? 'shape' : before); resolve(ok); } };
      show('gate');
      $.gateIn.value = '';
      $.gateQ.textContent = 'Asking…';
      $.gateGo.disabled = true;
      const c = await gate.challenge();
      if (disposed) return;
      if (c.status !== 'ok') { $.gateQ.textContent = flow.gateMessage(c); $.gateGo.disabled = true; return; }
      state.gateChallenge = c;
      $.gateQ.textContent = c.mode === 'pin' ? 'Grown-up: type the PIN.' : `Grown-up: what is ${c.a} × ${c.b}?`;
      $.gateIn.type = c.mode === 'pin' ? 'password' : 'text';
      $.gateGo.disabled = false;
      $.gateIn.focus();
    });
  }

  async function submitGate() {
    const c = state.gateChallenge;
    if (!c || !gateWaiter) return;
    const $ = built;
    $.gateGo.disabled = true;
    const v = await gate.verify(c.mode === 'pin' ? { pin: $.gateIn.value } : { challengeToken: c.challengeToken, answer: $.gateIn.value });
    if (disposed) return;
    if (v.status === 'ok') { say(''); gateWaiter.resolve(true); return; }
    say(flow.gateMessage(v), true);
    $.gateIn.value = '';
    // A wrong answer burns the question: ask for a fresh one.
    const again = await gate.challenge();
    if (disposed) return;
    if (again.status === 'ok') {
      state.gateChallenge = again;
      $.gateQ.textContent = again.mode === 'pin' ? 'Grown-up: type the PIN.' : `Grown-up: what is ${again.a} × ${again.b}?`;
      $.gateGo.disabled = false;
    } else {
      $.gateQ.textContent = flow.gateMessage(again);
    }
  }

  /** The flow's real stages to the strip. The words are the panel's own; the rest countdown is the strip's (one tick a second, cancelled by the next stage). */
  function onProgress(e) {
    if (e.stage === 'checking') workshop.setStage('checking', { call: e.call, label: `Checking with the printer… (try ${e.call})` });
    else if (e.stage === 'asking_again') workshop.setStage('asking', { label: 'The grown-up check ran out. Asking again…' });
    else if (e.stage === 'fetching_plate') workshop.setStage('fetching', { label: 'Getting your plate file…' });
    else if (e.stage === 'waiting') workshop.setStage('rest', { seconds: e.seconds, label: (left) => `The printer check needs a short rest. Trying again in ${left} s…` });
  }

  function stickerFiles(accessory) {
    const plan = ST.planStickerSheet([accessory.decal], {});
    const key = plan.items[0].sampler.sourceKey;
    return ST.buildStickerPackFiles([accessory.decal], {}, { [key]: state.photo.source }, { dpi: 200 });
  }

  async function checkIt() {
    if (state.busy || !state.scan) return;
    if (!gate.hasProof() && !(await askGate())) { say('Okay. Nothing was checked.'); return; }
    state.busy = true;
    show('working');
    say('Starting the printer check…');
    workshop.start({ staged: true, delayMs: 300 });
    const c = state.choices;
    const options = {
      name: titleCase(state.word),
      ...(c.flip ? { flip: true } : {}),
      ...(c.scale !== 1 ? { scale: c.scale } : {}),
      ...(c.symmetry ? { symmetry: c.symmetry } : {}),
    };
    const r = await flow.printAccessory({ scan: state.scan, gate, fetch: doFetch, options, onProgress, renewGate: () => askGate() });
    workshop.stop({ finished: Boolean(r.ok) });
    state.busy = false;
    if (disposed) return;
    if (!r.ok) { show('shape'); say(r.message, true); return; }
    state.result = r;
    forgetUrls();
    const $ = built;
    const name = slug(state.word);
    $.links.replaceChildren();
    let sheetUrl = '';
    let stickerMessage = '';
    try {
      for (const f of stickerFiles(r.accessory)) {
        const base = f.name.split('/').pop();
        const type = base.endsWith('.png') ? 'image/png' : base.endsWith('.pdf') ? 'application/pdf' : base.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream';
        const href = blobUrl(f.data, type);
        if (base.endsWith('.png')) sheetUrl = href;
        const label = base.endsWith('.pdf') ? '⬇ Sticker sheet (PDF)' : base.endsWith('.png') ? '⬇ Sticker picture (PNG)' : base.endsWith('.svg') ? '⬇ Cut lines (SVG)' : base.endsWith('.dxf') ? '⬇ Cut lines (DXF)' : `⬇ ${base}`;
        $.links.append(el(doc, 'a', { href, download: `${name}-${base}`, text: label }));
      }
    } catch {
      stickerMessage = ' The sticker sheet could not be made, but the plate is ready.';
    }
    if (r.plateStl) $.links.prepend(el(doc, 'a', { href: blobUrl(r.plateStl, 'model/stl'), download: `${name}-plate.stl`, text: '⬇ Plate to print (STL)' }));
    if (sheetUrl) { $.sheet.src = sheetUrl; $.sheet.hidden = false; } else { $.sheet.removeAttribute('src'); $.sheet.hidden = true; }
    const o = r.accessory.outline;
    $.summary.textContent = `Ready! ${o.widthMm} × ${o.heightMm} mm.` + (r.plateMessage ? ` ${r.plateMessage}` : '') + stickerMessage;
    $.doneHints.replaceChildren(...r.hints.map((t) => el(doc, 'li', { text: t })));
    show('done');
    say('');
  }

  function reset() {
    workshop.stop();
    forgetUrls();
    gateWaiter?.resolve(false);
    state.photo = null;
    state.scan = null;
    state.preview = null;
    state.result = null;
    state.busy = false;
    state.choices = { flip: false, scale: 1, symmetry: undefined };
    if (built) {
      built.file.value = '';
      built.sheet.removeAttribute('src');
      built.links.replaceChildren();
      built.canvas.width = built.canvas.height = 0;
    }
    show('pick');
    say('');
    refreshPick();
  }

  function wire($) {
    $.close.addEventListener('click', () => api.close());
    $.back.addEventListener('click', (e) => { if (e.target === $.back) api.close(); });
    $.back.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !state.busy) api.close(); });
    $.word.addEventListener('input', () => { state.word = $.word.value; refreshPick(); });
    $.file.addEventListener('change', () => pickFile($.file.files && $.file.files[0]));
    $.size.addEventListener('input', () => { state.heightMm = Number($.size.value); refreshPick(); });
    $.find.addEventListener('click', findShape);
    $.flip.addEventListener('click', () => repreview({ ...state.choices, flip: !state.choices.flip }));
    $.smaller.addEventListener('click', () => repreview({ ...state.choices, scale: Math.max(0.4, Math.round(state.choices.scale * 0.9 * 1000) / 1000) }));
    $.bigger.addEventListener('click', () => repreview({ ...state.choices, scale: Math.round(state.choices.scale * 1.1 * 1000) / 1000 }));
    $.sym.addEventListener('click', () => repreview({ ...state.choices, symmetry: 'mirror' }));
    $.again.addEventListener('click', reset);
    $.check.addEventListener('click', checkIt);
    $.gateGo.addEventListener('click', submitGate);
    $.gateIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitGate(); });
    $.gateNo.addEventListener('click', () => gateWaiter?.resolve(false));
    $.restart.addEventListener('click', reset);
  }

  const api = {
    /** Show the panel on the first step. */
    open() {
      if (disposed) return;
      const $ = build();
      if (!state.scan) show('pick');
      refreshPick();
      $.back.classList.add('open');
      $.back.focus();
    },
    /** Hide it. The photo and the files stay in memory until "Start again" or dispose(). */
    close() {
      if (!built) return;
      built.back.classList.remove('open');
    },
    isOpen: () => Boolean(built && built.back.classList.contains('open')),
    /** A copy of the panel's state, for tests: the step and the message, and whether a photo and an outline are held. */
    get state() {
      return { step: state.step, message: state.message, bad: state.bad, hasPhoto: Boolean(state.photo), hasScan: Boolean(state.scan), busy: state.busy, choices: { ...state.choices }, hasProof: gate.hasProof() };
    },
    /** Let go of everything: timers, object URLs, the photo, the proof, and the DOM. Safe to call twice. */
    dispose() {
      if (disposed) return;
      disposed = true;
      workshop.stop();
      forgetUrls();
      gateWaiter?.resolve(false);
      gate.clearProof();
      state.photo = null;
      state.scan = null;
      state.preview = null;
      state.result = null;
      if (built) { built.back.remove(); built = null; }
    },
  };
  return api;
}
