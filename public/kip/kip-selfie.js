// Selfie face: take or upload a photo, frame it through the face plate window, pick a style, wear it on Kip.
//
// PRIVACY (these are requirements, tested by scripts/e2e-kip-selfie.mjs):
//  - On device only. Nothing here calls fetch, XHR, sendBeacon, a worker or an endpoint. The only network-adjacent
//    API used is getUserMedia (local capture). The Photo -> Toy modal's /api/scan button is not reachable from here.
//  - Memory only. No localStorage, sessionStorage, IndexedDB, Cache API, cookie, URL or #toy= field ever holds
//    image data. Closing the tab, reloading, or pressing Remove drops it.
//  - The camera starts only from an explicit tap on a labelled button, every track is stopped when the picture is
//    taken, the modal closes, the tab hides, or an error occurs.
//  - No face detection, landmarks or other biometrics: framing is manual pan / zoom / rotate.
//
// The pure half (above "Browser") has no DOM, so vitest runs it on plain RGBA arrays.

/** Decal window on the universal human face plate, from buildConformalFaceplateDecalGeo (width 23.6, height 10.1). */
export const WINDOW_MM = { w: 23.6, h: 10.1 };
/** Whole plate (char_faceplate_flat bbox_mm [24.2, 17.7, 13.1]); the printed sticker is cut to the window. */
export const PLATE_MM = { w: 24.2, h: 17.7 };
/** The viewer stretches a 512x256 canvas over the window, so framing for the window aspect needs no extra distortion. */
export const CANVAS_PX = { w: 512, h: 256 };
export const STYLES = [
  { id: 'toon', label: 'Toon' },
  { id: 'photo', label: 'Photo' },
  { id: 'sketch', label: 'Sketch' },
];

// ---------------------------------------------------------------------------------------------
// Pure: framing
// ---------------------------------------------------------------------------------------------
/**
 * Affine transform (canvas setTransform order: a b c d e f) that draws a srcW x srcH image into an outW x outH
 * frame so the frame shows a window of the image: "cover" at zoom 1 (the image fills the frame), then zoom about
 * the centre, rotate by `rotateDeg`, and pan by (panX, panY) measured in frame heights (so pan feels the same at any size).
 */
export function frameTransform({ srcW, srcH, zoom = 1, panX = 0, panY = 0, rotateDeg = 0 }, outW, outH) {
  const cover = Math.max(outW / srcW, outH / srcH);
  const s = cover * zoom;
  const r = (rotateDeg * Math.PI) / 180;
  const cos = Math.cos(r) * s, sin = Math.sin(r) * s;
  const cx = outW / 2 + panX * outH, cy = outH / 2 + panY * outH;
  // x' = cos*(x - srcW/2) - sin*(y - srcH/2) + cx ; y' = sin*(x - srcW/2) + cos*(y - srcH/2) + cy
  return { a: cos, b: sin, c: -sin, d: cos, e: cx - cos * (srcW / 2) + sin * (srcH / 2), f: cy - sin * (srcW / 2) - cos * (srcH / 2) };
}

/** Clamp a pan so the frame never shows empty space beyond the image (in frame-height units). */
export function clampPan({ srcW, srcH, zoom = 1, panX = 0, panY = 0, rotateDeg = 0 }, outW, outH) {
  const s = Math.max(outW / srcW, outH / srcH) * zoom;
  const r = (Math.abs(rotateDeg) * Math.PI) / 180;
  // Bounding box of the rotated image, then how far the frame may slide inside it.
  const bw = s * (srcW * Math.cos(r) + srcH * Math.sin(r));
  const bh = s * (srcW * Math.sin(r) + srcH * Math.cos(r));
  const mx = Math.max(0, (bw - outW) / 2) / outH, my = Math.max(0, (bh - outH) / 2) / outH;
  return { panX: Math.min(mx, Math.max(-mx, panX)), panY: Math.min(my, Math.max(-my, panY)) };
}

// ---------------------------------------------------------------------------------------------
// Pure: styles. All take and return RGBA arrays of w*h*4 (Uint8ClampedArray), never mutating the input.
// ---------------------------------------------------------------------------------------------
const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

function sobel(gray, w, h) {
  const out = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = -gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1] + gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1];
      const gy = -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] + gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
      out[i] = Math.hypot(gx, gy);
    }
  }
  return out;
}

function grayOf(src, w, h) {
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = lum(src, i * 4);
  return g;
}

/** Photo: a gentle contrast lift so it reads at 24 mm. */
export function stylePhoto(src, w, h) {
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    for (let k = 0; k < 3; k++) out[i + k] = (src[i + k] - 128) * 1.15 + 128;
    out[i + 3] = src[i + 3];
  }
  return out;
}

/** Toon: flat colour bands plus a bold dark outline, so a face still reads at 24 mm (and prints as flat colour). */
export function styleToon(src, w, h, { bands = 5, outline = 0.55 } = {}) {
  const g = grayOf(src, w, h);
  const edge = sobel(g, w, h);
  let max = 1;
  for (const e of edge) if (e > max) max = e;
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const l = Math.max(1, g[i]);
    const q = (Math.floor((l / 256) * bands) + 0.5) / bands * 256; // quantised brightness
    const k = q / l;
    for (let c = 0; c < 3; c++) {
      const v = src[o + c] * k;
      const grey = q; // pull colour toward the band so the bands look flat
      out[o + c] = grey + (v - grey) * 1.25;
    }
    out[o + 3] = src[o + 3];
    if (edge[i] / max > 0.18 * (1.3 - outline)) { out[o] = out[o + 1] = out[o + 2] = 28; }
  }
  return out;
}

/** Sketch: dark line work on white from edges and shadows only. */
export function styleSketch(src, w, h) {
  const g = grayOf(src, w, h);
  const edge = sobel(g, w, h);
  let max = 1;
  for (const e of edge) if (e > max) max = e;
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const ink = Math.min(1, (edge[i] / max) * 2.4 + (g[i] < 70 ? 0.55 : 0));
    const v = 255 - ink * 235;
    out[o] = out[o + 1] = out[o + 2] = v;
    out[o + 3] = src[o + 3];
  }
  return out;
}

export function applyStyle(id, src, w, h) {
  if (id === 'photo') return stylePhoto(src, w, h);
  if (id === 'sketch') return styleSketch(src, w, h);
  return styleToon(src, w, h);
}

// ---------------------------------------------------------------------------------------------
// Pure: sticker export (1:1 mm)
// ---------------------------------------------------------------------------------------------
/** SVG in millimetres: the photo as an embedded raster plus a cut line (rounded window outline), at true size. */
export function stickerSvg({ pngDataUri, widthMm = WINDOW_MM.w, heightMm = WINDOW_MM.h, radiusMm = 1.6 }) {
  const f = (n) => +n.toFixed(3);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${f(widthMm)}mm" height="${f(heightMm)}mm" viewBox="0 0 ${f(widthMm)} ${f(heightMm)}">\n`
    + `<image x="0" y="0" width="${f(widthMm)}" height="${f(heightMm)}" preserveAspectRatio="none" xlink:href="${pngDataUri}"/>\n`
    + `<rect id="cut-line" x="0.05" y="0.05" width="${f(widthMm - 0.1)}" height="${f(heightMm - 0.1)}" rx="${f(radiusMm)}" fill="none" stroke="#ff00ff" stroke-width="0.1"/>\n</svg>\n`;
}

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

/** Insert (or replace) a pHYs chunk so a PNG prints at `dpi`: 100% scale gives the true size in mm. */
export function setPngDpi(png, dpi) {
  const u8 = png instanceof Uint8Array ? png : new Uint8Array(png);
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (sig.some((b, i) => u8[i] !== b)) throw new Error('not a PNG');
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9); chunk.set([0x70, 0x48, 0x59, 0x73], 4); // 'pHYs'
  dv.setUint32(8, ppm); dv.setUint32(12, ppm); chunk[16] = 1; // metres
  dv.setUint32(17, crc32(chunk.subarray(4, 17)));
  // copy chunks, dropping any existing pHYs, inserting ours right after IHDR
  const parts = [u8.subarray(0, 8)];
  let o = 8, placed = false;
  while (o < u8.length) {
    const len = new DataView(u8.buffer, u8.byteOffset + o, 4).getUint32(0);
    const type = String.fromCharCode(...u8.subarray(o + 4, o + 8));
    const end = o + 12 + len;
    if (type !== 'pHYs') parts.push(u8.subarray(o, end));
    if (type === 'IHDR' && !placed) { parts.push(chunk); placed = true; }
    o = end;
  }
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of parts) { out.set(part, p); p += part.length; }
  return out;
}

/** Pixel size and dpi for a sticker of the given mm size at ~600 dpi, rounded to whole pixels. */
export function stickerPixels(widthMm = WINDOW_MM.w, heightMm = WINDOW_MM.h, dpi = 600) {
  const pxPerMm = dpi / 25.4;
  return { w: Math.round(widthMm * pxPerMm), h: Math.round(heightMm * pxPerMm), dpi };
}

// ---------------------------------------------------------------------------------------------
// Browser
// ---------------------------------------------------------------------------------------------
const COPY = {
  privacy: 'Stays on this device. Your photo is not uploaded, saved, or put in the share link, and it is gone when you close or reload this page.',
  fit: 'The face plate window is only 24 mm wide and 10 mm tall, so the Toon style is the default: it keeps eyes, nose and mouth readable.',
};

function stopStream(stream) { if (stream) for (const t of stream.getTracks()) t.stop(); }

/**
 * Mount the selfie modal. ctx: { apply(canvas512x256), restore(), getUserMedia? , countdownSec? }
 * Returns { open, close, remove, active, snapNow, state } (state is for tests).
 */
export function mountSelfie(ctx) {
  const countdownSec = ctx.countdownSec ?? 3;
  const gum = () => (ctx.getUserMedia ?? ((c) => navigator.mediaDevices.getUserMedia(c)))({ video: { facingMode: 'user', width: 512, height: 512 }, audio: false });
  let stream = null;
  let bitmap = null; // memory only
  let frame = { zoom: 1, panX: 0, panY: 0, rotateDeg: 0 };
  let style = 'toon';
  let timer = 0;
  let isActive = false;
  const state = { step: 'closed', error: '', countdown: 0 };

  const css = document.createElement('style');
  css.textContent = `
  #modal-selfie [hidden] { display:none !important; } /* .sf-row's display:flex would otherwise beat the hidden attribute */
  #modal-selfie .sf-body { display:flex; flex-direction:column; gap:10px; }
  #modal-selfie .sf-row { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
  #modal-selfie .sf-stage { position:relative; width:100%; max-width:420px; aspect-ratio:${WINDOW_MM.w}/${WINDOW_MM.h}; background:#20232a; border-radius:12px; overflow:hidden; margin:0 auto; touch-action:none; }
  #modal-selfie .sf-stage.sf-cam { aspect-ratio:1/1; max-width:300px; }
  #modal-selfie video, #modal-selfie canvas.sf-view { width:100%; height:100%; display:block; object-fit:cover; transform:scaleX(-1); }
  #modal-selfie canvas.sf-view { transform:none; cursor:grab; }
  #modal-selfie .sf-guide { position:absolute; inset:12% 22%; border:3px dashed rgba(255,255,255,.85); border-radius:50%; pointer-events:none; }
  #modal-selfie .sf-count { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:72px; font-weight:800; color:#fff; text-shadow:0 2px 12px rgba(0,0,0,.6); pointer-events:none; }
  #modal-selfie .sf-note { font-size:12px; color:var(--muted); line-height:1.45; }
  #modal-selfie .sf-err { font-size:12.5px; color:#b3261e; font-weight:650; }
  #modal-selfie label.sf-r { display:flex; align-items:center; gap:6px; font-size:12px; font-weight:650; }
  #modal-selfie input[type=range] { accent-color: var(--spark); }
  `;
  document.head.append(css);

  const root = document.createElement('div');
  root.className = 'modal-backdrop';
  root.id = 'modal-selfie';
  root.innerHTML = `
  <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="sf-title">
    <div class="modal-head"><h2 id="sf-title">📸 Selfie face</h2><button type="button" id="sf-close">✕ Close</button></div>
    <div class="sf-body">
      <p class="modal-sub" id="sf-privacy">${COPY.privacy}</p>
      <div id="sf-intro" class="sf-row">
        <button type="button" id="sf-start" class="spark-active">📷 Start camera</button>
        <label class="file-btn" for="selfie-file" id="sf-upload-label">🖼️ Upload a photo instead</label>
        <input type="file" id="selfie-file" accept="image/*" hidden />
      </div>
      <div id="sf-cam" hidden>
        <div class="sf-stage sf-cam"><video id="sf-video" autoplay playsinline muted></video><div class="sf-guide"></div><div class="sf-count" id="sf-count" aria-live="assertive"></div></div>
        <div class="sf-row" style="justify-content:center;margin-top:8px"><button type="button" id="sf-snap" class="spark-active">🔴 Snap in ${countdownSec}…</button><button type="button" id="sf-cam-cancel">Cancel</button></div>
      </div>
      <div id="sf-adjust" hidden>
        <div class="sf-stage" id="sf-stage"><canvas class="sf-view" id="sf-canvas" width="${CANVAS_PX.w}" height="${CANVAS_PX.h}" aria-label="Drag to move the photo inside the face plate window"></canvas></div>
        <div class="sf-row" style="margin-top:8px">
          <label class="sf-r">Zoom <input type="range" id="sf-zoom" min="1" max="4" step="0.01" value="1" aria-label="Zoom"></label>
          <label class="sf-r">Turn <input type="range" id="sf-rot" min="-45" max="45" step="1" value="0" aria-label="Rotate"></label>
        </div>
        <fieldset class="sf-row" style="border:0" id="sf-styles"><legend class="sf-note">Style</legend>${STYLES.map((s) => `<label class="sf-r"><input type="radio" name="sf-style" value="${s.id}"${s.id === 'toon' ? ' checked' : ''}> ${s.label}</label>`).join('')}</fieldset>
        <p class="sf-note">${COPY.fit}</p>
        <div class="sf-row"><button type="button" id="sf-use" class="spark-active">✅ Use this face</button><button type="button" id="sf-sticker" title="Download a true-size sticker: 600 dpi PNG and an SVG in millimetres with a cut line">🖨️ Save as sticker</button><button type="button" id="sf-retake">Retake</button></div>
      </div>
      <p class="sf-err" id="sf-error" role="alert" hidden></p>
    </div>
  </div>`;
  document.body.append(root);
  const $ = (id) => root.querySelector(`#${id}`);
  const show = (step) => {
    state.step = step;
    $('sf-intro').hidden = step !== 'intro';
    $('sf-cam').hidden = step !== 'camera';
    $('sf-adjust').hidden = step !== 'adjust';
  };
  const setError = (msg) => { state.error = msg; $('sf-error').hidden = !msg; $('sf-error').textContent = msg; };

  function stopCamera() {
    clearInterval(timer); timer = 0;
    stopStream(stream); stream = null;
    const v = $('sf-video');
    v.srcObject = null;
    $('sf-count').textContent = '';
  }
  function dropImage() {
    if (bitmap && bitmap.close) bitmap.close();
    bitmap = null;
  }

  function close() {
    stopCamera();
    dropImage();
    root.classList.remove('open');
    show('closed');
    setError('');
  }

  function open() {
    stopCamera(); dropImage(); setError('');
    frame = { zoom: 1, panX: 0, panY: 0, rotateDeg: 0 };
    $('sf-zoom').value = '1'; $('sf-rot').value = '0';
    root.classList.add('open');
    show('intro');
    $('sf-start').focus();
  }

  // ---- camera ---------------------------------------------------------------------------
  async function startCamera() {
    setError('');
    try {
      stream = await gum();
    } catch (e) {
      stopCamera();
      const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      setError(denied
        ? 'The camera is blocked here. You can still upload a photo instead.'
        : 'No camera was found. You can still upload a photo instead.');
      show('intro');
      return;
    }
    const v = $('sf-video');
    v.srcObject = stream;
    show('camera');
    try { await v.play(); } catch { /* autoplay muted works; ignore */ }
    $('sf-snap').focus();
  }

  async function grabFrame() {
    const v = $('sf-video');
    const w = v.videoWidth || 512, h = v.videoHeight || 512;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.translate(w, 0); g.scale(-1, 1); // the preview is mirrored; keep the picture the way the person saw it
    g.drawImage(v, 0, 0, w, h);
    return c;
  }

  function beginCountdown() {
    if (timer) return;
    let n = countdownSec;
    state.countdown = n;
    $('sf-count').textContent = n > 0 ? String(n) : '';
    const done = () => { clearInterval(timer); timer = 0; state.countdown = 0; snapNow(); };
    if (n <= 0) { done(); return; }
    timer = setInterval(() => {
      n -= 1; state.countdown = n;
      $('sf-count').textContent = n > 0 ? String(n) : '';
      if (n <= 0) done();
    }, 1000);
  }

  async function snapNow() {
    if (!stream) return;
    const src = await grabFrame();
    stopCamera(); // the camera indicator goes off the moment the picture is taken
    bitmap = src;
    toAdjust();
  }

  // ---- upload ---------------------------------------------------------------------------
  async function loadFile(file) {
    setError('');
    if (!file || !/^image\//.test(file.type)) { setError('Pick a picture file (PNG, JPG, WebP).'); return; }
    try {
      const bmp = await createImageBitmap(file); // decoded locally; the File never leaves memory
      const c = document.createElement('canvas');
      c.width = bmp.width; c.height = bmp.height;
      c.getContext('2d').drawImage(bmp, 0, 0);
      bmp.close();
      stopCamera(); dropImage();
      bitmap = c;
      toAdjust();
    } catch {
      setError('That picture could not be opened. Try another one.');
    }
  }

  // ---- adjust ---------------------------------------------------------------------------
  function render() {
    if (!bitmap) return null;
    const cv = $('sf-canvas');
    const g = cv.getContext('2d');
    const out = CANVAS_PX;
    // 1) frame the source into a window-sized canvas
    const tmp = document.createElement('canvas');
    tmp.width = out.w; tmp.height = out.h;
    const tg = tmp.getContext('2d', { willReadFrequently: true });
    const t = frameTransform({ srcW: bitmap.width, srcH: bitmap.height, ...frame }, out.w, out.h);
    tg.fillStyle = '#e9e1d2'; tg.fillRect(0, 0, out.w, out.h);
    tg.setTransform(t.a, t.b, t.c, t.d, t.e, t.f);
    tg.drawImage(bitmap, 0, 0);
    tg.setTransform(1, 0, 0, 1, 0, 0);
    // 2) style
    const img = tg.getImageData(0, 0, out.w, out.h);
    const styled = applyStyle(style, img.data, out.w, out.h);
    const result = new ImageData(styled, out.w, out.h);
    g.putImageData(result, 0, 0);
    // 3) soft rounded window so the plate edge is clean (alpha 0 outside)
    g.globalCompositeOperation = 'destination-in';
    g.fillStyle = '#000';
    g.beginPath();
    const r = out.h * 0.16;
    g.roundRect ? g.roundRect(0, 0, out.w, out.h, r) : g.rect(0, 0, out.w, out.h);
    g.fill();
    g.globalCompositeOperation = 'source-over';
    return cv;
  }

  function toAdjust() {
    frame = { zoom: 1, panX: 0, panY: 0, rotateDeg: 0 };
    $('sf-zoom').value = '1'; $('sf-rot').value = '0';
    show('adjust');
    render();
    $('sf-use').focus();
  }

  function setFrame(patch) {
    frame = { ...frame, ...patch };
    const c = clampPan({ srcW: bitmap.width, srcH: bitmap.height, ...frame }, CANVAS_PX.w, CANVAS_PX.h);
    frame.panX = c.panX; frame.panY = c.panY;
    render();
  }

  // drag to pan
  (() => {
    const cv = $('sf-canvas');
    let drag = null;
    cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, px: frame.panX, py: frame.panY }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', (e) => {
      if (!drag || !bitmap) return;
      const rect = cv.getBoundingClientRect();
      const k = CANVAS_PX.h / rect.height / CANVAS_PX.h; // frame-height units per css pixel
      setFrame({ panX: drag.px + (e.clientX - drag.x) * k * (CANVAS_PX.h / rect.height) * (rect.height / CANVAS_PX.h) / 1, panY: drag.py + (e.clientY - drag.y) * k });
    });
    const end = () => { drag = null; };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  })();

  function use() {
    const cv = render();
    if (!cv) return;
    const out = document.createElement('canvas');
    out.width = CANVAS_PX.w; out.height = CANVAS_PX.h;
    out.getContext('2d').drawImage(cv, 0, 0);
    ctx.apply(out);
    isActive = true;
    close();
  }

  /** True-size sticker of the current framing: 600 dpi PNG (pHYs set) and an SVG in mm with a cut line. */
  async function exportSticker() {
    const cv = render();
    if (!cv) throw new Error('No photo to export');
    const { w, h, dpi } = stickerPixels();
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(cv, 0, 0, w, h); // the 512x256 canvas is authored for the window, so this is undistorted at true size
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const png = setPngDpi(new Uint8Array(await blob.arrayBuffer()), dpi);
    let bin = '';
    for (let i = 0; i < png.length; i += 0x8000) bin += String.fromCharCode(...png.subarray(i, i + 0x8000));
    const svg = stickerSvg({ pngDataUri: `data:image/png;base64,${btoa(bin)}` });
    return { png, svg, widthPx: w, heightPx: h, dpi };
  }

  async function downloadSticker() {
    try {
      const { png, svg } = await exportSticker();
      for (const [name, data, type] of [['kip-face-sticker.png', png, 'image/png'], ['kip-face-sticker.svg', svg, 'image/svg+xml']]) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([data], { type }));
        a.download = name;
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }
    } catch (e) { setError(e.message); }
  }

  function remove() {
    if (!isActive) return;
    isActive = false;
    ctx.restore();
  }

  // ---- wiring ---------------------------------------------------------------------------
  $('sf-close').addEventListener('click', close);
  $('sf-cam-cancel').addEventListener('click', () => { stopCamera(); show('intro'); });
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  root.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); });
  $('sf-start').addEventListener('click', startCamera);
  $('sf-snap').addEventListener('click', beginCountdown);
  $('selfie-file').addEventListener('change', (e) => { loadFile(e.target.files[0]); e.target.value = ''; });
  $('sf-retake').addEventListener('click', () => { dropImage(); show('intro'); });
  $('sf-zoom').addEventListener('input', (e) => setFrame({ zoom: Number(e.target.value) }));
  $('sf-rot').addEventListener('input', (e) => setFrame({ rotateDeg: Number(e.target.value) }));
  root.querySelectorAll('input[name="sf-style"]').forEach((r) => r.addEventListener('change', () => { style = r.value; if (bitmap) render(); }));
  $('sf-use').addEventListener('click', use);
  $('sf-sticker').addEventListener('click', downloadSticker);
  // The camera must never outlive the page being visible.
  const onHide = () => { if (document.hidden) stopCamera(); };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', () => { stopCamera(); dropImage(); });

  return {
    open, close, remove, snapNow, loadFile, exportSticker,
    active: () => isActive,
    state,
    // test hooks: framing without synthesising pointer events
    setFrame: (p) => { if (bitmap) setFrame(p); },
    setStyle: (s) => { style = s; if (bitmap) render(); },
    hasImage: () => !!bitmap,
  };
}
