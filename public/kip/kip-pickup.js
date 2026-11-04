// Pick it up: point the camera at a real object, say what it is, and Kip picks it up (docs/product/close-out-checklist.md, section 1, rows 3 and 4).
//
// A full-screen live camera view (a browser and PWA feature: getUserMedia works over https and on localhost, and in an installed home-screen app).
// The child taps what it is (or types it) and presses the shutter, or presses the shutter and lets the helper work out what it is (the Worker's Scan Assist names the main thing, `nameBlob`); the camera stops, the frame freezes, and the photo goes to the same helper the print
// panel uses (kip-photo-print.js `scanBlob`: /api/scan, which asks SAM for that word and sends back the object's outline). When the outline comes back, the
// object is cut out of the frozen frame where it lies, lifts off the picture and flies into Kip's hand while Kip takes it:
//   - a WORKSHOP PROP word (guitar, trumpet, frying pan, broom ...) gives Kip the bench's own prop and its clip (a guitar strums);
//   - otherwise a household library item that the scan matched (a spoon) goes in Kip's hand, coloured from the photo;
//   - otherwise, with an outline, the cut-out itself goes in Kip's hand as a flat card on a handle (`holdCard`), like a photo plate;
//   - with no outline and nothing to hold, Kip cannot hold it: the message says so and the print panel can still make its plate.
//
// What this is NOT: tracked AR. The camera view is live, but the object is found once, in the frame taken at the shutter, by a round trip to SAM that takes
// a few seconds. Say "camera view with an overlay" in the write-up, never "real-time detection".
//
// Rules (the same as the print panel's): the picture, its cut-out and the stream live in this closure and in memory only; no storage writes, no cookies; the stream
// is stopped the moment the shutter is pressed and whenever the view closes; all DOM and CSS sit inside `root`; no listener on window or document; every message
// is a sentence written here or by the flow module, never a server's words; text is set with textContent.

/** What a child can tap instead of typing. Each word is one SAM can find and the bench or the household library can hold. */
export const CHIPS = [
  { word: 'spoon', icon: '🥄' },
  { word: 'guitar', icon: '🎸' },
  { word: 'trumpet', icon: '🎺' },
  { word: 'frying pan', icon: '🍳' },
  { word: 'broom', icon: '🧹' },
  { word: 'cup', icon: '🥤' },
];

/** Words that name one of the bench's own hand props (kip-vehicles-wardrobe.js WORKSHOP_PROPS), each with its own clip. A bare "brush" or "roller" is NOT here: the library has a paintbrush. */
const WORKSHOP_WORDS = {
  guitar: ['guitar', 'acoustic guitar', 'electric guitar', 'bass guitar', 'ukulele', 'banjo'],
  trumpet: ['trumpet', 'horn', 'bugle', 'cornet'],
  maracas: ['maracas', 'maraca', 'shaker'],
  hammer: ['hammer', 'claw hammer'],
  screwdriver: ['screwdriver', 'screw driver'],
  paint_roller: ['paint roller'],
  mop: ['mop'],
  broom: ['broom'],
  scrub_brush: ['scrub brush', 'scrubbing brush'],
  vacuum: ['vacuum', 'vacuum cleaner', 'hoover'],
  upright_vacuum: ['upright vacuum'],
  spatula: ['spatula', 'pancake turner'],
  frying_pan: ['frying pan', 'pan', 'skillet'],
  flag: ['flag'],
  magnifier: ['magnifying glass', 'magnifier'],
};
const WORD_TO_PROP = new Map();
for (const [id, words] of Object.entries(WORKSHOP_WORDS)) for (const w of words) WORD_TO_PROP.set(w, id);

/** The bench prop id a word names ("a Guitar" -> "guitar", "frying pans" -> "frying_pan"), or null. */
export function workshopPropForWord(word) {
  if (typeof word !== 'string') return null;
  const w = word.trim().toLowerCase().replace(/^(a|an|the|my)\s+/, '').replace(/\s+/g, ' ');
  if (!w || w.length > 60) return null;
  return WORD_TO_PROP.get(w) ?? (w.endsWith('s') ? WORD_TO_PROP.get(w.slice(0, -1)) ?? null : null);
}

// ---- geometry (pure) -----------------------------------------------------------------------------------------------------------------

/** Where a `srcW x srcH` picture lands when it covers a `boxW x boxH` box (CSS object-fit: cover): the scale and the offset of its top left. */
export function coverFit(srcW, srcH, boxW, boxH) {
  const s = Math.max(boxW / srcW, boxH / srcH);
  return { s, ox: (boxW - srcW * s) / 2, oy: (boxH - srcH * s) / 2 };
}
/** Picture points to box points. */
export const toBox = (pts, fit) => pts.map(([x, y]) => [x * fit.s + fit.ox, y * fit.s + fit.oy]);
/** The box around some points, grown by `pad`. */
export function boundsOf(pts, pad = 0) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
}
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
/** Where the cut-out is at time `t` (0 to 1) on its way from `from` to `to`: eased, with a little hop upward in the middle (`arc` pixels). */
export function flightAt(from, to, t, arc = 60) {
  const e = easeInOut(Math.min(1, Math.max(0, t)));
  return { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e - Math.sin(Math.PI * e) * arc };
}

/**
 * The object alone, as a small transparent PNG (at most `maxSide` px on its long side): the picture inside the cut line and nothing outside it. For a page that wants to show the
 * object somewhere else (the game's Kip holds it as a flat card). `r` is the panel's `scanBlob` answer. Null when it cannot be made. Memory only: nothing is stored or sent.
 */
export function cutoutPng(doc, r, maxSide = 256) {
  try {
    if (!r || !r.canvas || !Array.isArray(r.points) || r.points.length < 3) return null;
    const b = boundsOf(r.points, 2);
    const k = Math.min(1, maxSide / Math.max(b.w, b.h));
    const w = Math.max(1, Math.ceil(b.w * k));
    const h = Math.max(1, Math.ceil(b.h * k));
    const c = doc.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.scale(k, k);
    ctx.translate(-b.x, -b.y);
    ctx.beginPath();
    r.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(r.canvas, 0, 0);
    return { dataUrl: c.toDataURL('image/png'), w, h };
  } catch {
    return null;
  }
}

// ---- the view ------------------------------------------------------------------------------------------------------------------------

const CSS = `
.kpu-back{position:fixed;inset:0;z-index:90;background:#000;color:#fff;display:none;overflow:hidden;touch-action:manipulation;-webkit-tap-highlight-color:transparent;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.kpu-back.open{display:block}
.kpu-back *{box-sizing:border-box}
.kpu-video,.kpu-freeze{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#111}
.kpu-freeze{display:none;transition:filter .3s ease}
.kpu-freeze.dim{filter:brightness(.35) saturate(.8)}
.kpu-scan{position:absolute;inset:0;pointer-events:none;display:none;background:linear-gradient(180deg,transparent 0,rgba(255,255,255,.0) 40%,rgba(255,255,255,.28) 50%,rgba(255,255,255,.0) 60%,transparent 100%);background-size:100% 40%;background-repeat:no-repeat;animation:kpu-sweep 1.5s ease-in-out infinite}
.kpu-scan.on{display:block}
@keyframes kpu-sweep{0%{background-position:0 -40%}100%{background-position:0 140%}}
.kpu-cut{position:absolute;pointer-events:none;transform-origin:50% 50%;filter:drop-shadow(0 10px 16px rgba(0,0,0,.55)) drop-shadow(0 0 10px rgba(255,255,255,.55));will-change:transform}
.kpu-top{position:absolute;top:0;left:0;right:0;display:flex;justify-content:space-between;align-items:center;gap:10px;padding:calc(env(safe-area-inset-top,0px) + 10px) calc(env(safe-area-inset-right,0px) + 14px) 14px calc(env(safe-area-inset-left,0px) + 14px);background:linear-gradient(rgba(0,0,0,.6),transparent)}
.kpu-title{font-size:16px;font-weight:800;letter-spacing:-.01em;margin:0}
.kpu-bottom{position:absolute;bottom:0;left:0;right:0;display:flex;flex-direction:column;gap:10px;padding:26px calc(env(safe-area-inset-right,0px) + 14px) calc(env(safe-area-inset-bottom,0px) + 14px) calc(env(safe-area-inset-left,0px) + 14px);background:linear-gradient(transparent,rgba(0,0,0,.72))}
.kpu-chips{display:flex;gap:8px;overflow-x:auto;padding-bottom:2px;scrollbar-width:none}
.kpu-chips::-webkit-scrollbar{display:none}
.kpu-back button,.kpu-pick{font:inherit;font-size:15px;font-weight:700;color:#fff;background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.3);border-radius:999px;min-height:44px;padding:0 16px;display:inline-flex;align-items:center;justify-content:center;gap:6px;cursor:pointer;flex:none;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
.kpu-back button:disabled{opacity:.4;cursor:default}
.kpu-back button.on{background:#ff6b4a;border-color:#ff6b4a}
.kpu-row{display:flex;align-items:center;justify-content:space-between;gap:10px}
.kpu-controls{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:10px;min-height:76px}
.kpu-cell{display:flex;align-items:center;justify-content:center;gap:8px}
.kpu-cell.start{justify-content:flex-start}
.kpu-cell.end{justify-content:flex-end}
.kpu-word{font:inherit;font-size:16px;color:#fff;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.3);border-radius:12px;min-height:44px;padding:0 12px;min-width:0;flex:1}
.kpu-word::placeholder{color:rgba(255,255,255,.65)}
.kpu-back .kpu-shutter{width:76px;height:76px;min-height:76px;padding:0;border-radius:50%;background:#fff;border:5px solid rgba(255,255,255,.45);color:#111;font-size:26px;background-clip:padding-box}
.kpu-back .kpu-shutter:disabled{opacity:.35}
.kpu-status{font-size:15px;font-weight:700;line-height:1.35;min-height:1.35em;text-shadow:0 1px 6px rgba(0,0,0,.7)}
.kpu-status.bad{color:#ffb4a8}
.kpu-back [hidden]{display:none!important}
@media (prefers-reduced-motion: reduce){.kpu-scan{animation:none;background-position:0 50%}.kpu-freeze{transition:none}}
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

const MAX_SIDE = 1280;

/**
 * @param {{
 *   root: Element,
 *   panel: { scanBlob: (blob: Blob, word: string) => Promise<object>, takeOffered: () => Promise<{ ok: boolean, coloured?: boolean, label?: string }>, clearScan?: () => void, open?: () => void },
 *   getHandPoint?: () => ({ x: number, y: number } | null),
 *   holdWorkshopProp?: (id: string) => ({ ok: boolean } | Promise<{ ok: boolean }>),
 *   holdCard?: (cutout: { dataUrl: string, w: number, h: number }, label: string) => ({ ok: boolean } | Promise<{ ok: boolean }>),
 *   onPicked?: (info: { word: string, kind: 'workshop' | 'library' | 'card', id: string, label: string, coloured: boolean, colours: string[], cutout: { dataUrl: string, w: number, h: number } | null }) => void,
 *   canPrintPlate?: boolean,
 *   mediaDevices?: MediaDevices,
 *   reduceMotion?: () => boolean,
 * }} options
 */
export function createPickUp({ root, panel, getHandPoint, holdWorkshopProp, holdCard, onPicked, canPrintPlate = false, mediaDevices, reduceMotion } = {}) {
  if (!root) throw new Error('createPickUp needs a root element');
  if (!panel || typeof panel.scanBlob !== 'function') throw new Error('createPickUp needs the print panel');
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const md = mediaDevices ?? win?.navigator?.mediaDevices;
  const reduced = reduceMotion ?? (() => Boolean(win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches));

  // mode: closed | starting | live | nocamera | looking | picking | retry
  const state = { mode: 'closed', facing: 'environment', word: '', message: '', bad: false, lastPick: null };
  let built = null;
  let stream = null;
  let raf = 0;
  let cutEl = null;
  let freezeUrl = null;
  let disposed = false;
  let runId = 0; // a newer shutter (or a close) makes an older run stop touching the screen

  function build() {
    if (built) return built;
    const $ = {};
    $.back = el(doc, 'div', { class: 'kpu-back', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Pick it up with the camera' });
    $.video = el(doc, 'video', { class: 'kpu-video', autoplay: true, playsinline: true, muted: true });
    $.video.setAttribute('webkit-playsinline', '');
    $.video.muted = true;
    $.freeze = el(doc, 'canvas', { class: 'kpu-freeze', 'aria-hidden': 'true' });
    $.scan = el(doc, 'div', { class: 'kpu-scan', 'aria-hidden': 'true' });
    $.close = el(doc, 'button', { type: 'button', 'aria-label': 'Close the camera', text: '✕' });
    $.flip = el(doc, 'button', { type: 'button', 'aria-label': 'Use the other camera', text: '🔄', hidden: true });
    $.top = el(doc, 'div', { class: 'kpu-top' }, el(doc, 'h2', { class: 'kpu-title', text: '📷 Pick it up' }), $.close);
    $.chips = el(doc, 'div', { class: 'kpu-chips', role: 'group', 'aria-label': 'What is it?' });
    $.chipBtns = CHIPS.map((c) => {
      const b = el(doc, 'button', { type: 'button', 'data-word': c.word, text: `${c.icon} ${c.word}` });
      $.chips.append(b);
      return b;
    });
    $.word = el(doc, 'input', { class: 'kpu-word', type: 'text', maxlength: '40', placeholder: 'What is it? Or leave this empty…', 'aria-label': 'What is it?', autocomplete: 'off', autocapitalize: 'none' });
    $.file = el(doc, 'input', { type: 'file', accept: 'image/*', hidden: true });
    $.fileBtn = el(doc, 'label', { class: 'kpu-pick' }, doc.createTextNode('🖼️ Photo'), $.file);
    $.shutter = el(doc, 'button', { type: 'button', class: 'kpu-shutter', 'aria-label': 'Take the picture', text: '●', disabled: true });
    $.retry = el(doc, 'button', { type: 'button', class: 'on', text: '↩ Try again', hidden: true });
    $.plate = el(doc, 'button', { type: 'button', text: '🖨️ Make its plate', hidden: true });
    $.status = el(doc, 'div', { class: 'kpu-status', role: 'status', 'aria-live': 'polite' });
    $.controls = el(doc, 'div', { class: 'kpu-controls' },
      el(doc, 'div', { class: 'kpu-cell start' }, $.fileBtn, $.plate),
      el(doc, 'div', { class: 'kpu-cell' }, $.shutter, $.retry),
      el(doc, 'div', { class: 'kpu-cell end' }, $.flip));
    $.bottom = el(doc, 'div', { class: 'kpu-bottom' }, $.status, $.chips, $.word, $.controls);
    $.back.append(el(doc, 'style', { text: CSS }), $.video, $.freeze, $.scan, $.top, $.bottom);
    root.append($.back);
    built = $;
    wire($);
    return $;
  }

  function say(text, bad = false) {
    state.message = text;
    state.bad = bad;
    if (built) { built.status.textContent = text; built.status.classList.toggle('bad', bad); }
  }

  function setMode(mode) {
    state.mode = mode;
    if (!built) return;
    const $ = built;
    const live = mode === 'live' || mode === 'nocamera';
    $.chips.hidden = !live;
    $.word.hidden = !live;
    $.fileBtn.hidden = !(live || mode === 'retry');
    $.shutter.hidden = !(mode === 'live' || mode === 'starting');
    $.shutter.disabled = mode !== 'live';
    $.retry.hidden = mode !== 'retry';
    $.flip.hidden = !(mode === 'live' && $.flip.dataset.many === '1');
    $.video.style.display = mode === 'live' || mode === 'starting' ? 'block' : 'none';
    $.scan.classList.toggle('on', mode === 'looking');
    $.freeze.style.display = mode === 'looking' || mode === 'picking' || mode === 'retry' ? 'block' : 'none';
    if (mode !== 'picking' && mode !== 'looking') $.freeze.classList.remove('dim');
    if (mode !== 'retry') $.plate.hidden = true;
  }

  // ---- the camera --------------------------------------------------------------------------------------------------------------------

  function stopCamera() {
    if (stream) { for (const t of stream.getTracks()) t.stop(); stream = null; }
    if (built) built.video.srcObject = null;
  }

  function noCamera(message) {
    setMode('nocamera');
    say(message, true);
  }

  async function startCamera() {
    const id = ++runId;
    stopCamera();
    setMode('starting');
    say('Opening the camera…');
    if (!md || typeof md.getUserMedia !== 'function') { noCamera('This browser cannot open the camera here. You can use a photo instead.'); return; }
    let s = null;
    try {
      s = await md.getUserMedia({ audio: false, video: { facingMode: { ideal: state.facing }, width: { ideal: MAX_SIDE }, height: { ideal: 720 } } });
    } catch (err) {
      if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
        if (id === runId && !disposed) noCamera('The camera is turned off for this page. Turn it on in the browser settings, or use a photo instead.');
        return;
      }
      try { s = await md.getUserMedia({ audio: false, video: true }); } catch { if (id === runId && !disposed) noCamera('I could not open a camera. You can use a photo instead.'); return; }
    }
    if (disposed || id !== runId || state.mode === 'closed') { for (const t of s.getTracks()) t.stop(); return; }
    stream = s;
    built.video.srcObject = s;
    try { await built.video.play(); } catch { /* the first frame still arrives; autoplay is muted and inline */ }
    if (disposed || id !== runId) return;
    setMode('live');
    say('Press the big button and I will find out what it is. Or tap what it is first.');
    try {
      const devices = await md.enumerateDevices();
      built.flip.dataset.many = devices.filter((d) => d.kind === 'videoinput').length > 1 ? '1' : '0';
      built.flip.hidden = !(state.mode === 'live' && built.flip.dataset.many === '1');
    } catch { /* no flip button */ }
  }

  // ---- the shutter -------------------------------------------------------------------------------------------------------------------

  function chosenWord() {
    const w = built.word.value.trim();
    state.word = w;
    return w;
  }

  /** Draw a picture source onto the frozen-frame canvas, capped at MAX_SIDE, and return the canvas. */
  function freezeFrom(source, sw, sh) {
    const k = Math.min(1, MAX_SIDE / Math.max(sw, sh));
    const c = built.freeze;
    c.width = Math.max(1, Math.round(sw * k));
    c.height = Math.max(1, Math.round(sh * k));
    c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
    return c;
  }

  async function shoot() {
    if (state.mode !== 'live') return;
    const word = chosenWord(); // may be empty: then the helper works out what it is
    const v = built.video;
    if (!v.videoWidth || !v.videoHeight) { say('The camera is still waking up. Try again in a second.', true); return; }
    const frame = freezeFrom(v, v.videoWidth, v.videoHeight);
    stopCamera(); // privacy and battery: the stream ends the moment the picture is taken
    const blob = await new Promise((res) => frame.toBlob(res, 'image/jpeg', 0.9));
    if (!blob) { noCamera('That picture did not work. Try again.'); return; }
    await process(blob, word);
  }

  async function useFile(file) {
    if (!file || state.mode === 'closed') return;
    const word = chosenWord(); // may be empty: then the helper works out what it is
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('bad image')); i.src = url; });
      freezeFrom(img, img.naturalWidth, img.naturalHeight);
    } catch {
      say('That file could not be read as a picture. Try another one.', true);
      return;
    } finally {
      URL.revokeObjectURL(url);
      built.file.value = '';
    }
    stopCamera();
    await process(file, word);
  }

  // ---- finding it, lifting it, flying it to Kip's hand -------------------------------------------------------------------------------

  function cancelAnim() { if (raf) { win?.cancelAnimationFrame?.(raf); raf = 0; } }
  function removeCut() { if (cutEl) { cutEl.remove(); cutEl = null; } }

  /** Run `step(t)` for `ms` milliseconds on animation frames; resolves when done or when a newer run started. */
  function animate(ms, step, id) {
    return new Promise((resolve) => {
      const t0 = win.performance.now();
      const tick = (now) => {
        if (id !== runId || disposed) { resolve(false); return; }
        const t = Math.min(1, (now - t0) / ms);
        step(t);
        if (t >= 1) { raf = 0; resolve(true); } else raf = win.requestAnimationFrame(tick);
      };
      raf = win.requestAnimationFrame(tick);
    });
  }

  /** The object cut out of the frozen frame, laid exactly over where it is on screen. */
  function makeCut(r) {
    const box = built.back.getBoundingClientRect();
    const fit = coverFit(r.w, r.h, box.width, box.height);
    const pts = toBox(r.points, fit);
    const b = boundsOf(pts, 4);
    const dpr = Math.min(2, win.devicePixelRatio || 1);
    const c = doc.createElement('canvas');
    c.className = 'kpu-cut';
    c.width = Math.max(1, Math.ceil(b.w * dpr));
    c.height = Math.max(1, Math.ceil(b.h * dpr));
    c.style.left = `${b.x}px`;
    c.style.top = `${b.y}px`;
    c.style.width = `${b.w}px`;
    c.style.height = `${b.h}px`;
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.translate(-b.x, -b.y);
    const path = () => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };
    ctx.save();
    path();
    ctx.clip();
    ctx.drawImage(r.canvas, fit.ox, fit.oy, r.w * fit.s, r.h * fit.s);
    ctx.restore();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#fff';
    path();
    ctx.stroke();
    built.back.insertBefore(c, built.top);
    cutEl = c;
    return { bounds: b, box };
  }

  function dominantColours(r) {
    // Two or three colour words are what the song later wants; read them from the picture inside the cut line, a coarse grid only.
    try {
      const probe = doc.createElement('canvas');
      probe.width = probe.height = 24;
      const ctx = probe.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 24, 24);
      const b = boundsOf(r.points);
      ctx.save();
      ctx.scale(24 / Math.max(1, b.w), 24 / Math.max(1, b.h));
      ctx.translate(-b.x, -b.y);
      ctx.beginPath();
      r.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(r.canvas, 0, 0);
      ctx.restore();
      const px = ctx.getImageData(0, 0, 24, 24).data;
      const bins = new Map();
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] < 200 || (px[i] > 245 && px[i + 1] > 245 && px[i + 2] > 245)) continue; // outside the cut is white
        const name = colourWord(px[i], px[i + 1], px[i + 2]);
        bins.set(name, (bins.get(name) ?? 0) + 1);
      }
      return [...bins.entries()].sort((a, b2) => b2[1] - a[1]).slice(0, 2).map(([n]) => n);
    } catch {
      return [];
    }
  }

  /** Is this scan result something Kip can take: a bench prop, a library item, or (with an outline) the cut-out as a card? */
  const holdable = (w, r, hasCard) => Boolean(workshopPropForWord(w) && holdWorkshopProp) || Boolean(r && r.offer) || Boolean(r && r.ok && hasCard);

  async function process(blob, wordIn) {
    const id = ++runId;
    removeCut();
    setMode('looking');
    let word = wordIn;
    let candidates = [wordIn];
    if (!word) {
      // No word: ask the helper what is in the picture (one extra call, about as long as the scan), then scan for the best name it gives.
      say('Looking at what it is…');
      let n;
      try { n = await panel.nameBlob(blob); } catch { n = { ok: false, names: [], message: 'Something went wrong. Please try again.' }; }
      if (disposed || id !== runId) return;
      if (!n.ok || !n.names.length) { fail(n.message || 'I could not tell what that is. Tap what it is and try again.', false); return; }
      candidates = n.names.slice(0, 2);
      word = candidates[0];
      say(`It looks like a ${word}! Cutting it out…`);
    } else {
      say(`Looking for the ${word}…`);
    }
    let r = null;
    let first = null; // the first answer that found an outline, in case no name is something Kip can hold
    for (const c of candidates) {
      let got;
      try { got = await panel.scanBlob(blob, c); } catch { got = { ok: false, message: 'Something went wrong. Please try again.' }; }
      if (disposed || id !== runId) return;
      if (got.ok && !first) first = { r: got, word: c };
      if (holdable(c, got, Boolean(holdCard))) { r = got; word = c; break; }
      if (!r) { r = got; word = c; }
    }
    if (r && !holdable(word, r, Boolean(holdCard)) && first) { r = first.r; word = first.word; } // none can be held: show the first that was found, so the card is that one
    if (!wordIn && built) { state.word = word; built.word.value = word; }
    const prop = workshopPropForWord(word);
    const cutout = r.ok ? cutoutPng(doc, r) : null;
    const canHold = holdable(word, r, Boolean(holdCard && cutout));
    if (!r.ok && !canHold) { fail(r.message || `I could not find a ${word}. Try again.`, false); return; }

    // Kip starts taking it as soon as the cut-out lifts, so a model file that has to load is ready when the cut-out lands.
    const takePromise = (async () => {
      if (prop && holdWorkshopProp) {
        const h = await holdWorkshopProp(prop);
        return { ok: Boolean(h && h.ok), kind: 'workshop', id: prop, label: word, coloured: false };
      }
      if (r.offer) {
        const h = await panel.takeOffered();
        return { ok: Boolean(h && h.ok), kind: 'library', id: r.offer.id, label: r.offer.label, coloured: Boolean(h && h.coloured) };
      }
      if (holdCard && cutout) {
        const h = await holdCard(cutout, word);
        return { ok: Boolean(h && h.ok), kind: 'card', id: 'card', label: word, coloured: true };
      }
      return { ok: false, kind: 'library', id: '', label: word, coloured: false };
    })();

    setMode('picking');
    if (r.ok && r.points && r.points.length >= 3) {
      say(`Got it! Here comes the ${word}…`);
      const cut = makeCut(r);
      if (reduced()) {
        built.freeze.classList.add('dim');
        await animate(200, () => {}, id);
      } else {
        built.freeze.classList.add('dim');
        await animate(340, (t) => { cutEl.style.transform = `scale(${1 + 0.1 * easeInOut(t)})`; }, id); // lift
        if (id !== runId || disposed) return;
        const from = { x: cut.bounds.x + cut.bounds.w / 2, y: cut.bounds.y + cut.bounds.h / 2 };
        const endScale = Math.min(0.5, Math.max(0.08, 44 / Math.max(cut.bounds.w, cut.bounds.h)));
        await animate(820, (t) => {
          const hp = (getHandPoint && getHandPoint()) || { x: cut.box.width * 0.5, y: cut.box.height * 0.5 };
          state.lastHand = { x: hp.x, y: hp.y };
          const p = flightAt(from, { x: hp.x - cut.box.left, y: hp.y - cut.box.top }, t);
          const e = easeInOut(t);
          const k = 1.1 + (endScale - 1.1) * e;
          cutEl.style.transform = `translate(${p.x - from.x}px, ${p.y - from.y}px) scale(${k}) rotate(${-14 * e}deg)`;
          cutEl.style.opacity = String(t > 0.85 ? 1 - (t - 0.85) / 0.15 : 1);
        }, id);
      }
      if (id !== runId || disposed) return;
      removeCut();
    } else {
      say(`I could not trace it, but I know what a ${word} is. Giving it to Kip…`);
    }
    const taken = await takePromise;
    if (disposed || id !== runId) return;
    if (!taken.ok) {
      if (!prop && !r.offer && !(holdCard && cutout)) fail(`Kip cannot hold a ${word} yet.${canPrintPlate && r.ok ? ' But I can make its plate to print.' : ''}`, canPrintPlate && r.ok);
      else fail(`I could not give Kip the ${word}. Try again.`, false);
      return;
    }
    state.lastPick = { word, kind: taken.kind, id: taken.id, label: taken.label, coloured: taken.coloured, colours: r.ok ? dominantColours(r) : [], cutout, named: !wordIn };
    say(`Kip picked up the ${taken.label.toLowerCase()}!`);
    api.close();
    try { onPicked && onPicked({ ...state.lastPick }); } catch { /* the page's hook must not break the view */ }
  }

  function fail(message, showPlate) {
    removeCut();
    setMode('retry');
    built.plate.hidden = !showPlate;
    say(message, true);
  }

  // ---- wiring ------------------------------------------------------------------------------------------------------------------------

  function wire($) {
    $.close.addEventListener('click', () => api.close());
    $.shutter.addEventListener('click', shoot);
    $.retry.addEventListener('click', () => { panel.clearScan?.(); startCamera(); });
    $.plate.addEventListener('click', () => { api.close(); panel.open?.(); });
    $.flip.addEventListener('click', () => { state.facing = state.facing === 'environment' ? 'user' : 'environment'; startCamera(); });
    $.file.addEventListener('change', () => useFile($.file.files && $.file.files[0]));
    $.word.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); shoot(); } });
    $.back.addEventListener('keydown', (e) => { if (e.key === 'Escape') api.close(); });
    for (const b of $.chipBtns) b.addEventListener('click', () => {
      $.word.value = b.dataset.word;
      for (const o of $.chipBtns) o.classList.toggle('on', o === b);
      if (state.mode === 'live') say(`A ${b.dataset.word}. Point at it and press the big button.`);
    });
    $.word.addEventListener('input', () => { for (const o of $.chipBtns) o.classList.toggle('on', o.dataset.word === $.word.value.trim().toLowerCase()); });
  }

  const api = {
    /** Show the camera view and start the camera. */
    async open() {
      if (disposed) return;
      const $ = build();
      panel.clearScan?.();
      removeCut();
      $.back.classList.add('open');
      state.word = '';
      $.word.value = '';
      for (const o of $.chipBtns) o.classList.remove('on'); // a new pick-up starts with no word chosen
      await startCamera();
    },
    /** Hide the view and let the camera go. */
    close() {
      runId++;
      cancelAnim();
      stopCamera();
      removeCut();
      if (built) built.back.classList.remove('open');
      state.mode = 'closed';
      if (built) setMode('closed');
    },
    isOpen: () => Boolean(built && built.back.classList.contains('open')),
    /** The mode and the message, and the last pick-up, for tests and the page. */
    get state() { return { mode: state.mode, message: state.message, bad: state.bad, word: state.word, hasStream: Boolean(stream), lastPick: state.lastPick ? { ...state.lastPick } : null, lastHand: state.lastHand ? { ...state.lastHand } : null }; },
    dispose() {
      if (disposed) return;
      api.close();
      disposed = true;
      if (built) { built.back.remove(); built = null; }
      state.lastPick = null;
    },
  };
  return api;
}

/** A plain colour word for an RGB value, for the song (not for display): a small closed list. */
export function colourWord(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 510;
  if (d < 28) return l > 0.8 ? 'white' : l > 0.62 ? 'silver' : l > 0.25 ? 'grey' : 'black';
  let h;
  if (max === r) h = ((g - b) / d + 6) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  const s = d / (255 - Math.abs(2 * l * 255 - 255) || 1);
  if (l < 0.2) return 'dark';
  if (h < 15 || h >= 345) return 'red';
  if (h < 40) return l < 0.45 && s < 0.9 ? 'brown' : 'orange';
  if (h < 70) return 'yellow';
  if (h < 165) return 'green';
  if (h < 200) return 'teal';
  if (h < 255) return 'blue';
  if (h < 290) return 'purple';
  return 'pink';
}
