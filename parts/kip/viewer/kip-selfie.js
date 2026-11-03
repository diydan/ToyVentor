// Selfie face: take or upload a photo, frame it inside the face plate window, cut the background out, pick a style, wear it on Kip.
//
// PRIVACY (these are requirements, tested by scripts/e2e-kip-selfie.mjs and tests/kip-selfie*.test.ts):
//  - On device by default. Nothing in this file calls fetch, XHR, sendBeacon, a worker or an endpoint. The only network-adjacent
//    API used here is getUserMedia (local capture). The Photo -> Toy modal's /api/scan button is not reachable from here.
//    The one exception is the opt-in Smart face: kip-selfie-cloud.js is the only module that talks to a server, it is called only
//    after the consent screen AND the app's parent gate, and it sends one resized JPEG per tap (see that file's header).
//  - Memory only. No localStorage, sessionStorage, IndexedDB, Cache API, cookie, URL or #toy= field ever holds
//    image data. Closing the tab, reloading, or pressing Remove drops it.
//  - The camera starts only from an explicit tap on a labelled button, every track is stopped when the picture is
//    taken, the modal closes, the tab hides, or an error occurs.
//  - No face detection, landmarks or other biometrics: framing is manual pan / zoom / rotate, and the background
//    cut-out is a colour model around the middle of the frame (kip-selfie-image.js), not a model of faces.
//  - The sample-face gallery below is same-origin static pictures preloaded with the page (before any flow
//    starts), so prompting one makes zero network requests: the bytes are already in memory, and the typed
//    prompt lives only in the input box, never in a URL, storage or request.
//
// The pure half (above "Browser") has no DOM, so vitest runs it on plain RGBA arrays.
import { WINDOW_MM, WINDOW_ZB, FACE_TARGET_MM, PLATE_MM, windowPolygon, windowPathD, traceWindow, faceTargetFractions } from './kip-faceplate-shape.js?v=10.0';
import { removeBackground, toon } from './kip-selfie-image.js?v=10.0';
import { createSelfieCloud, toJpegDataUrl, describeStatus } from './kip-selfie-cloud.js?v=10.0';

/** The picture window on the universal human face plate: the plate's own outline pulled in by a bezel margin (same shape as the plate). */
export { WINDOW_MM, PLATE_MM };
/** The picture is drawn at the same pixels per millimetre both ways, so it is not stretched on the plate or on the sticker. */
export const PX_PER_MM = 22;
export const CANVAS_PX = { w: Math.round(WINDOW_MM.w * PX_PER_MM), h: Math.round(WINDOW_MM.h * PX_PER_MM) };
/** Where the face is expected in the frame, as a fraction of the window height (a hint for the cut-out only; it is not drawn). */
export const FACE_FRACTION = 0.92;
export const STYLES = [
  { id: 'photo', label: 'Photo' },
  { id: 'toon', label: 'Toon' },
  { id: 'sketch', label: 'Sketch' },
];

/**
 * Prompt-a-face gallery: ready-made cartoon faces composed for the short wide window (face fills the frame edge to edge, bold
 * readable features at 24 mm), so a child without a camera or photo still gets a face that fits.
 * Pure data: matched locally by matchPrompt, pictures preloaded with the page, nothing generated at runtime.
 * The pictures were made with Muse Image (muse-image-1.0) on a plate-shaped template, and `marks` (eyes, mouth, as fractions of the
 * picture) were measured once at build time with SAM 3.1 (scripts/kip-gen-faces.ts, parts/kip/viewer/selfie-faces/faces.json). Only
 * these cartoon pictures were ever sent to those models, never a photo of a person. The marks make a chosen face line up on the
 * plate's eye line and printed smile automatically (alignFrame).
 */
export const SAMPLE_FACES = [
  { id: 'pirate', label: 'Pirate', file: 'face-pirate.jpg', marks: { eyes: [{ x: 0.3549, y: 0.4608 }, { x: 0.654, y: 0.4616 }], mouth: { x: 0.5054, y: 0.8047 } }, keywords: ['pirate', 'captain', 'bandana', 'red', 'gold', 'earring', 'tooth', 'sailor', 'sea', 'patch'] },
  { id: 'astronaut', label: 'Astronaut', file: 'face-astronaut.jpg', marks: { eyes: [{ x: 0.3384, y: 0.4975 }, { x: 0.6661, y: 0.4975 }], mouth: { x: 0.5022, y: 0.9065 } }, keywords: ['astronaut', 'space', 'helmet', 'moon', 'stars', 'spaceman', 'nova'] },
  { id: 'robot', label: 'Robot', file: 'face-robot.jpg', marks: { eyes: [{ x: 0.3491, y: 0.5476 }, { x: 0.6545, y: 0.5484 }], mouth: { x: 0.5036, y: 0.8948 } }, keywords: ['robot', 'metal', 'antenna', 'bot', 'machine', 'steel', 'beep'] },
  { id: 'cat', label: 'Cat', file: 'face-cat.jpg', marks: { eyes: [{ x: 0.371, y: 0.5217 }, { x: 0.6308, y: 0.5217 }], mouth: { x: 0.5004, y: 0.828 } }, keywords: ['cat', 'kitten', 'kitty', 'whiskers', 'orange', 'tabby', 'pet'] },
  { id: 'clown', label: 'Clown', file: 'face-clown.jpg', marks: { eyes: [{ x: 0.3656, y: 0.4466 }, { x: 0.6384, y: 0.4457 }], mouth: { x: 0.5022, y: 0.8155 } }, keywords: ['clown', 'circus', 'rainbow', 'funny', 'nose', 'wig', 'joke'] },
  { id: 'knight', label: 'Knight', file: 'face-knight.jpg', marks: { eyes: [{ x: 0.3768, y: 0.5751 }, { x: 0.6223, y: 0.5743 }], mouth: { x: 0.5076, y: 0.899 } }, keywords: ['knight', 'armor', 'armour', 'helmet', 'brave', 'castle', 'plume', 'sword'] },
  { id: 'monster', label: 'Monster', file: 'face-monster.jpg', marks: { eyes: [{ x: 0.3795, y: 0.4508 }, { x: 0.6223, y: 0.4624 }], mouth: { x: 0.5049, y: 0.823 } }, keywords: ['monster', 'green', 'horns', 'silly', 'goofy', 'cyclops', 'alien'] },
  { id: 'superhero', label: 'Superhero', file: 'face-superhero.jpg', marks: { eyes: [{ x: 0.308, y: 0.4566 }, { x: 0.6969, y: 0.4583 }], mouth: { x: 0.4996, y: 0.8464 } }, keywords: ['superhero', 'super', 'hero', 'mask', 'lightning', 'bolt', 'cape', 'power'] },
];

/** Prompt words that name every sample face, for the "nothing matched" hint. */
export const SAMPLE_SUGGESTIONS = SAMPLE_FACES.map((f) => f.id).join(', ');

/**
 * Match typed words against the gallery: exact word hits count double, prefix hits (plurals, "super" for
 * "superhero") single. Ties go to gallery order. Returns { face, score } or null when nothing matches.
 */
export function matchPrompt(text) {
  const tokens = String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1); // single letters prefix-match everything
  if (!tokens.length) return null;
  let best = null;
  for (const face of SAMPLE_FACES) {
    let score = 0;
    for (const t of tokens) {
      for (const k of face.keywords) {
        if (t === k) score += 2;
        else if (k.startsWith(t) || t.startsWith(k)) score += 1;
      }
    }
    if (score > 0 && (!best || score > best.score)) best = { face, score };
  }
  return best;
}

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

/** Clamp a pan so the frame never shows empty space beyond the image (in frame-height units). A photo smaller than the frame stays centred. */
export function clampPan({ srcW, srcH, zoom = 1, panX = 0, panY = 0, rotateDeg = 0 }, outW, outH) {
  const s = Math.max(outW / srcW, outH / srcH) * zoom;
  const r = (Math.abs(rotateDeg) * Math.PI) / 180;
  // Bounding box of the rotated image, then how far the frame may slide inside it.
  const bw = s * (srcW * Math.cos(r) + srcH * Math.sin(r));
  const bh = s * (srcW * Math.sin(r) + srcH * Math.cos(r));
  const mx = Math.max(0, (bw - outW) / 2) / outH, my = Math.max(0, (bh - outH) / 2) / outH;
  return { panX: Math.min(mx, Math.max(-mx, panX)), panY: Math.min(my, Math.max(-my, panY)) };
}

/**
 * Zoom limits for a photo. The window is short and wide, a portrait photo is tall and narrow, so zoom 1 ("cover") would show a
 * thin band across the middle of a face. `min` shows the whole photo height, `initial` shows about three quarters of it
 * (a typical selfie has the head at about 60% of the height, which then fills the plate), `max` is 8x cover (a small
 * face in a large photo needs that to line up with the plate's marks).
 */
/** Sample-face marks (eyes and mouth as fractions of the picture) as the eye midpoint and mouth in source pixels. */
export function marksToPixels({ eyes, mouth }, w, h) {
  return { eye: { x: ((eyes[0].x + eyes[1].x) / 2) * w, y: ((eyes[0].y + eyes[1].y) / 2) * h }, mouth: { x: mouth.x * w, y: mouth.y * h } };
}

export function zoomRange(srcW, srcH, outW = CANVAS_PX.w, outH = CANVAS_PX.h) {
  const cover = Math.max(outW / srcW, outH / srcH);
  const heightFitZoom = outH / srcH / cover; // zoom at which the photo's whole height is the window height
  const min = Math.min(1, heightFitZoom);
  const visibleAtCover = Math.min(1, heightFitZoom); // fraction of the photo's height shown at zoom 1
  const initial = Math.min(3, Math.max(min, visibleAtCover / 0.75));
  return { min: +min.toFixed(3), max: 8, initial: +initial.toFixed(3) };
}

/**
 * The frame (zoom, rotation, pan) that puts a face's eyes and mouth on the plate's marks: the eye midpoint on the eye line and the
 * mouth on the printed smile ridge. Two points fix scale, turn and position exactly, so this is a zoom, a turn and a shift, never a
 * stretch. `eye` is the point between the eyes and `mouth` the middle of the mouth, both in source pixels. Returns null if the two
 * points coincide. The turn is limited to the slider range (+-45 degrees) and the zoom to 8x cover.
 */
export function alignFrame({ srcW, srcH, eye, mouth }, outW = CANVAS_PX.w, outH = CANVAS_PX.h, targets = faceTargetFractions()) {
  const Et = { x: (outW * (targets.leftEye.x + targets.rightEye.x)) / 2, y: outH * targets.leftEye.y };
  const Mt = { x: outW * targets.mouth.x, y: outH * targets.mouth.y };
  const dx = mouth.x - eye.x, dy = mouth.y - eye.y;
  const len = Math.hypot(dx, dy);
  if (!(len > 1e-6)) return null;
  const cover = Math.max(outW / srcW, outH / srcH);
  const s = Math.min(8 * cover, Math.hypot(Mt.x - Et.x, Mt.y - Et.y) / len);
  let r = Math.atan2(Mt.y - Et.y, Mt.x - Et.x) - Math.atan2(dy, dx);
  r = Math.atan2(Math.sin(r), Math.cos(r)); // into (-pi, pi]
  const limit = Math.PI / 4;
  r = Math.max(-limit, Math.min(limit, r));
  // frameTransform: out = R * s * (p - src/2) + c, with c = (outW/2 + panX * outH, outH/2 + panY * outH)
  const cr = Math.cos(r) * s, sr = Math.sin(r) * s;
  const px = eye.x - srcW / 2, py = eye.y - srcH / 2;
  const cx = Et.x - (cr * px - sr * py), cy = Et.y - (sr * px + cr * py);
  return { zoom: s / cover, rotateDeg: (r * 180) / Math.PI, panX: (cx - outW / 2) / outH, panY: (cy - outH / 2) / outH };
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

/**
 * Toon: a smoothed, six-colour cartoon with an ink outline of printable width (0.2 mm), so a face still reads at 24 mm and
 * prints as flat colour. `alpha` (w*h bytes) limits the palette and the ink to the cut-out subject.
 */
export function styleToon(src, w, h, opts = {}) {
  return toon(src, w, h, { ppm: w / WINDOW_MM.w, ...opts });
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

export function applyStyle(id, src, w, h, opts = {}) {
  if (id === 'toon') return styleToon(src, w, h, opts);
  if (id === 'sketch') return styleSketch(src, w, h);
  return stylePhoto(src, w, h); // Photo is the default, and what an unknown id means
}

// ---------------------------------------------------------------------------------------------
// Pure: sticker export (1:1 mm)
// ---------------------------------------------------------------------------------------------
/** SVG in millimetres: the picture as an embedded raster plus the cut line (the window outline), at true size. */
export function stickerSvg({ pngDataUri, widthMm = WINDOW_MM.w, heightMm = WINDOW_MM.h, cutPathD = windowPathD() }) {
  const f = (n) => +n.toFixed(3);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${f(widthMm)}mm" height="${f(heightMm)}mm" viewBox="0 0 ${f(widthMm)} ${f(heightMm)}">\n`
    + `<image x="0" y="0" width="${f(widthMm)}" height="${f(heightMm)}" preserveAspectRatio="none" xlink:href="${pngDataUri}"/>\n`
    + `<path id="cut-line" d="${cutPathD}" fill="none" stroke="#ff00ff" stroke-width="0.1"/>\n</svg>\n`;
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

/**
 * The plate-shaped guide drawn over the live camera and over Adjust, as SVG markup in a unit square (viewBox 0 0 1 1, stretched to
 * the stage): the window outline (white), everything outside it dimmed, the printed smile ridge and the 2D art's eye positions
 * (orange). `box` places the window inside the stage as fractions (left, top, w, h); the default is the whole stage.
 */
export function guideMarkup(box = { left: 0, top: 0, w: 1, h: 1 }) {
  const W = WINDOW_MM.w, H = WINDOW_MM.h;
  const X = (x) => +(box.left + (x / W) * box.w).toFixed(4);
  const Y = (y) => +(box.top + (y / H) * box.h).toFixed(4);
  const d = `M${windowPolygon().map(([x, y]) => `${X(x)} ${Y(y)}`).join(' L')} Z`;
  const row = (zb) => WINDOW_ZB.max - zb; // plate height -> mm from the window's top edge
  const t = FACE_TARGET_MM;
  const ridge = `M${X(W / 2 - 2.5)} ${Y(row(1.75))} Q${X(W / 2)} ${Y(row(0.75))} ${X(W / 2 + 2.5)} ${Y(row(1.75))}`;
  const eye = (sx) => `<circle class="mark" cx="${X(W / 2 + sx * t.eyeHalfSpan)}" cy="${Y(row(t.eyeZb))}" r="0.012" />`;
  return `<svg class="sf-plate" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true" focusable="false">`
    + `<path class="dim" fill-rule="evenodd" d="M0 0H1V1H0Z ${d}"/><path class="edge" d="${d}"/>`
    + `<path class="mark" d="${ridge}"/>${eye(-1)}${eye(1)}</svg>`;
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
  privacy: 'Stays on this device. Your photo is not uploaded, saved, or put in the share link, and it is gone when you close or reload this page. The optional ✨ Smart face sends it to an online helper only if a grown-up says yes.',
  fit: `The picture on the face plate is ${WINDOW_MM.w} mm wide and ${WINDOW_MM.h} mm tall, so a face is small. Photo shows you as you are; Toon keeps eyes, nose and mouth readable at this size. The white outline is the plate; the orange smile is the printed ridge. Fill the plate with your face, or use Line up eyes &amp; mouth.`,
};

function stopStream(stream) { if (stream) for (const t of stream.getTracks()) t.stop(); }

/**
 * Mount the selfie modal. ctx: { apply(canvas), restore(), plateColor?(), getUserMedia?, countdownSec? }
 * apply gets a canvas of CANVAS_PX covering WINDOW_MM, transparent outside the window and where the background was removed.
 * Returns { open, close, remove, active, snapNow, loadFile, exportSticker, state, ...test hooks }.
 */
export function mountSelfie(ctx) {
  const countdownSec = ctx.countdownSec ?? 3;
  const gum = () => (ctx.getUserMedia ?? ((c) => navigator.mediaDevices.getUserMedia(c)))({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  const plateColor = () => (ctx.plateColor ? ctx.plateColor() : '#f1d6c1');
  let stream = null;
  let bitmap = null; // memory only
  let imageId = 0;
  let frame = { zoom: 1, panX: 0, panY: 0, rotateDeg: 0 };
  let style = 'photo'; // a camera or uploaded picture starts as it is; Toon and Sketch are one tap away
  let cutout = true;
  let tight = 0.5;
  let timer = 0;
  let settle = 0;
  let cut = { key: '' };
  let marks = null; // eye midpoint and mouth in source pixels, once the face has been lined up
  let isActive = false;
  let pick = null; // the two-tap line-up: { step: 'eyes' | 'mouth', eye?, k }
  let smart = null; // the opt-in online helper: { step, challenge? }
  let smartAbort = null;
  let cloudInst = null;
  let free = false; // after a line-up the frame is exact, so pan is not clamped back toward the centre until a new picture arrives
  const state = { step: 'closed', error: '', countdown: 0, cutout: true, style: 'photo', pick: '', smart: '' };

  // Sample faces ride with the page: preloaded here at mount (before any flow starts), so prompting one
  // later reuses the in-memory picture and makes zero network requests.
  const sampleCache = new Map();
  for (const f of SAMPLE_FACES) {
    const im = new Image();
    im.src = `./selfie-faces/${f.file}`;
    sampleCache.set(f.id, im);
  }

  const css = document.createElement('style');
  css.textContent = `
  #modal-selfie [hidden] { display:none !important; } /* .sf-row's display:flex would otherwise beat the hidden attribute */
  #modal-selfie .sf-body { display:flex; flex-direction:column; gap:14px; }
  #modal-selfie .modal-head { position:sticky; top:-18px; z-index:3; background:#fbf9f5; margin:-18px -20px 0; padding:16px 20px 8px; }
  #modal-selfie .modal-sub { margin:0 0 2px; }
  #modal-selfie .sf-row { display:flex; flex-wrap:wrap; gap:10px 12px; align-items:center; }
  #modal-selfie .sf-row button, #modal-selfie .sf-row .file-btn { min-height:34px; padding:6px 13px; }
  #modal-selfie .sf-controls { display:flex; flex-direction:column; gap:16px; margin-top:20px; padding-top:18px; border-top:1px solid var(--line); }
  #modal-selfie .sf-actions { position:sticky; bottom:-18px; z-index:2; background:#fbf9f5; margin:0 -20px -18px; padding:12px 20px 16px; border-top:1px solid var(--line); }
  #modal-selfie .sf-sliders { display:grid; grid-template-columns:1fr 1fr; gap:14px 24px; }
  #modal-selfie .sf-slider { display:flex; flex-direction:column; gap:8px; font-size:12px; font-weight:650; }
  #modal-selfie .sf-slider input[type=range] { width:100%; margin:0; }
  #modal-selfie fieldset.sf-row { padding:0; margin:0; gap:10px 16px; }
  #modal-selfie fieldset.sf-row legend { padding:0 0 6px; }
  #modal-selfie .sf-stage { position:relative; margin-top:8px; width:100%; max-width:460px; aspect-ratio:${WINDOW_MM.w}/${WINDOW_MM.h}; background:#20232a; border-radius:12px; overflow:hidden; margin-left:auto; margin-right:auto; touch-action:none; }
  #modal-selfie .sf-stage.sf-cam { aspect-ratio:4/3; max-width:380px; }
  #modal-selfie video, #modal-selfie canvas.sf-view { width:100%; height:100%; display:block; object-fit:contain; transform:scaleX(-1); }
  #modal-selfie canvas.sf-view { transform:none; cursor:grab; background:repeating-conic-gradient(#cfd3da 0% 25%, #eceef2 0% 50%) 50% / 14px 14px; }
  #modal-selfie .sf-guidehost { position:absolute; inset:0; pointer-events:none; }
  #modal-selfie .sf-plate { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; }
  #modal-selfie .sf-plate .dim { fill:rgba(32,35,42,.58); }
  #modal-selfie .sf-plate .edge { fill:none; stroke:#fff; stroke-width:2px; vector-effect:non-scaling-stroke; }
  #modal-selfie .sf-plate .mark { fill:none; stroke:#ff6b4a; stroke-width:2px; stroke-linecap:round; vector-effect:non-scaling-stroke; }
  #modal-selfie .sf-pickview { display:block; width:100%; max-width:460px; max-height:340px; margin:0 auto; object-fit:contain; border-radius:12px; background:#20232a; cursor:crosshair; touch-action:manipulation; }
  #modal-selfie .sf-smartbox { border:1px solid var(--line); border-radius:12px; padding:12px; background:rgba(255,255,255,.7); display:flex; flex-direction:column; gap:10px; }
  #modal-selfie .sf-smartbox h3 { margin:0; font-size:15px; }
  #modal-selfie .sf-smartbox ul { margin:0; padding-left:18px; font-size:12.5px; line-height:1.5; }
  #modal-selfie .sf-gate-input { font-size:18px; padding:6px 10px; width:8em; border:1px solid var(--line); border-radius:9px; }
  #modal-selfie .sf-busy { position:absolute; right:8px; top:8px; background:rgba(32,35,42,.78); color:#fff; font-size:11.5px; font-weight:700; padding:3px 9px; border-radius:999px; pointer-events:none; }
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
      <div id="sf-prompt-row" class="sf-row">
        <label class="sf-r" for="sf-prompt">✨ Prompt a face</label>
        <input type="text" id="sf-prompt" maxlength="80" placeholder="a brave knight…" autocomplete="off" aria-label="Describe a face, for example a brave knight" />
        <button type="button" id="sf-prompt-go">Find a face</button>
      </div>
      <div id="sf-cam" hidden>
        <div class="sf-stage sf-cam"><video id="sf-video" autoplay playsinline muted></video><div id="sf-cam-guide" class="sf-guidehost"></div><div class="sf-count" id="sf-count" aria-live="assertive"></div></div>
        <div class="sf-row" style="justify-content:center;margin-top:8px"><button type="button" id="sf-snap" class="spark-active">🔴 Snap in ${countdownSec}…</button><button type="button" id="sf-cam-cancel">Cancel</button></div>
      </div>
      <div id="sf-smart-panel" class="sf-smartbox" hidden role="group" aria-label="Online helper">
        <div id="sf-smart-consent" hidden>
          <h3>Use the online helper?</h3>
          <ul>
            <li>Your picture is made smaller and sent over the internet, through ToyVentor, to Meta's AI service.</li>
            <li>It is used once: to find your eyes and mouth, or to redraw you as a cartoon.</li>
            <li>ToyVentor does not save it. Meta's service handles it under Meta's own rules, which ToyVentor does not control.</li>
            <li>A grown-up has to say yes. If nobody does, nothing leaves this device.</li>
          </ul>
          <div class="sf-row"><button type="button" id="sf-smart-yes" class="spark-active">A grown-up says yes</button><button type="button" id="sf-smart-no">No thanks, keep it on this device</button></div>
        </div>
        <div id="sf-smart-gate" hidden>
          <h3>Grown-up check</h3>
          <p class="sf-note" id="sf-gate-q"></p>
          <div class="sf-row"><input id="sf-gate-input" class="sf-gate-input" type="text" inputmode="numeric" autocomplete="off" aria-label="Grown-up answer"><button type="button" id="sf-gate-ok" class="spark-active">Check</button><button type="button" id="sf-gate-cancel">Cancel</button></div>
          <p class="sf-err" id="sf-gate-err" role="alert" hidden></p>
        </div>
        <div id="sf-smart-choose" hidden>
          <h3>What should the helper do?</h3>
          <div class="sf-row"><button type="button" id="sf-smart-parts" class="spark-active">🎯 Find the eyes and mouth for me</button><button type="button" id="sf-smart-cartoon">🎨 Make it a cartoon</button><button type="button" id="sf-smart-back">Cancel</button></div>
        </div>
        <div id="sf-smart-work" hidden>
          <p class="sf-note" id="sf-work-text" role="status" aria-live="polite"></p>
          <div class="sf-row"><button type="button" id="sf-work-cancel">Cancel</button></div>
        </div>
      </div>
      <div id="sf-pick" hidden>
        <p class="sf-note" id="sf-pick-help" role="status" aria-live="polite"></p>
        <canvas id="sf-pick-canvas" class="sf-pickview" aria-label="Tap the picture to mark the eyes, then the mouth"></canvas>
        <div class="sf-row" style="margin-top:8px"><button type="button" id="sf-pick-cancel">Cancel</button></div>
      </div>
      <div id="sf-adjust" hidden>
        <div class="sf-stage" id="sf-stage"><canvas class="sf-view" id="sf-canvas" width="${CANVAS_PX.w}" height="${CANVAS_PX.h}" aria-label="Drag to move the photo inside the face plate window"></canvas><div id="sf-adjust-guide" class="sf-guidehost"></div><div class="sf-busy" id="sf-busy" role="status" hidden>Working…</div></div>
        <div class="sf-controls">
        <div class="sf-sliders">
          <label class="sf-slider"><span>Zoom</span><input type="range" id="sf-zoom" min="0.25" max="4" step="0.01" value="1" aria-label="Zoom"></label>
          <label class="sf-slider"><span>Turn</span><input type="range" id="sf-rot" min="-45" max="45" step="1" value="0" aria-label="Rotate"></label>
        </div>
        <div class="sf-row">
          <button type="button" id="sf-align" title="Tap the middle between your eyes, then your mouth: the photo is zoomed and turned so they sit where the plate's smile and eyes are">🎯 Line up eyes &amp; mouth</button>
          <span class="sf-note">Zooms and turns the photo so the face fills the plate.</span>
        </div>
        <div class="sf-row">
          <button type="button" id="sf-smart" title="Ask an online helper to find the eyes and mouth, or to redraw the photo as a cartoon. A grown-up has to say yes first, and the picture is sent over the internet.">✨ Smart face (online)</button>
          <span class="sf-note">Needs a grown-up. Sends the picture over the internet.</span>
        </div>
        <div class="sf-row">
          <label class="sf-r"><input type="checkbox" id="sf-cutout" checked> Remove background</label>
          <label class="sf-r" id="sf-tight-wrap">Edge <input type="range" id="sf-tight" min="0" max="1" step="0.05" value="0.5" aria-label="Cut-out edge: looser to tighter"></label>
        </div>
        <fieldset class="sf-row" style="border:0" id="sf-styles"><legend class="sf-note">Style</legend>${STYLES.map((s) => `<label class="sf-r"><input type="radio" name="sf-style" value="${s.id}"${s.id === 'photo' ? ' checked' : ''}> ${s.label}</label>`).join('')}</fieldset>
        <p class="sf-note">${COPY.fit}</p>
        <div class="sf-row sf-actions"><button type="button" id="sf-use" class="spark-active">✅ Use this face</button><button type="button" id="sf-sticker" title="Download a true-size sticker: 600 dpi PNG and an SVG in millimetres with a cut line">🖨️ Save as sticker</button><button type="button" id="sf-retake">Retake</button></div>
        </div>
      </div>
      <p class="sf-err" id="sf-error" role="alert" hidden></p>
    </div>
  </div>`;
  (ctx.root ?? document.body).append(root);
  const $ = (id) => root.querySelector(`#${id}`);
  $('sf-adjust-guide').innerHTML = guideMarkup();
  const show = (step) => {
    state.step = step;
    const card = root.querySelector('.modal-card'); if (card) card.scrollTop = 0;
    $('sf-intro').hidden = step !== 'intro';
    $('sf-prompt-row').hidden = step !== 'intro';
    $('sf-cam').hidden = step !== 'camera';
    $('sf-adjust').hidden = step !== 'adjust';
    $('sf-pick').hidden = true; pick = null; state.pick = '';
    if (smartAbort) { smartAbort.abort(); smartAbort = null; }
    $('sf-smart-panel').hidden = true; smart = null; state.smart = '';
  };
  const setError = (msg) => { state.error = msg; $('sf-error').hidden = !msg; $('sf-error').textContent = msg; };

  /** Camera preview: the stage takes the video's own shape and the guide sits where the plate will be after the default framing. */
  function setCameraGuide(vw, vh) {
    const cover = Math.max(CANVAS_PX.w / vw, CANVAS_PX.h / vh);
    const s = cover * zoomRange(vw, vh).initial; // output pixels per video pixel
    const wf = Math.min(1, CANVAS_PX.w / s / vw), hf = Math.min(1, CANVAS_PX.h / s / vh);
    $('sf-cam').querySelector('.sf-stage').style.aspectRatio = `${vw} / ${vh}`;
    $('sf-cam-guide').innerHTML = guideMarkup({ left: (1 - wf) / 2, top: (1 - hf) / 2, w: wf, h: hf });
  }
  setCameraGuide(640, 480);
  $('sf-video').addEventListener('loadedmetadata', () => { const v = $('sf-video'); if (v.videoWidth && v.videoHeight) setCameraGuide(v.videoWidth, v.videoHeight); });

  function stopCamera() {
    clearInterval(timer); timer = 0;
    stopStream(stream); stream = null;
    const v = $('sf-video');
    v.srcObject = null;
    $('sf-count').textContent = '';
  }
  function dropImage() {
    clearTimeout(settle); settle = 0;
    if (bitmap && bitmap.close) bitmap.close();
    bitmap = null;
    cut = { key: '' };
    marks = null;
  }

  function close() {
    stopCamera();
    dropImage();
    if (cloudInst) cloudInst.clearProof();
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
    style = 'photo';
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
      style = 'photo';
      toAdjust();
    } catch {
      setError('That picture could not be opened. Try another one.');
    }
  }

  // ---- sample faces ---------------------------------------------------------------
  /** Load a gallery face into Adjust. Uses the preloaded picture, so no request is made. */
  async function loadSample(face) {
    setError('');
    try {
      let img = face && sampleCache.get(face.id);
      if (!img || !img.complete || !img.naturalWidth) {
        img = new Image();
        img.src = `./selfie-faces/${face.file}`;
        await img.decode();
        sampleCache.set(face.id, img);
      }
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      stopCamera(); dropImage();
      bitmap = c;
      style = 'photo'; // already cartoon art: Toon would ink over its own outlines
      toAdjust(face.marks ? marksToPixels(face.marks, c.width, c.height) : null);
      return face;
    } catch {
      setError('That sample face could not be opened. Try another one.');
      return null;
    }
  }

  /** Match a typed prompt against the gallery and load the winner into Adjust. */
  async function promptFace(text) {
    const hit = matchPrompt(text);
    if (!hit) {
      setError(`No sample face matches that. Try ${SAMPLE_SUGGESTIONS}.`);
      return null;
    }
    return loadSample(hit.face);
  }

  // ---- adjust ---------------------------------------------------------------------------
  const out = CANVAS_PX;
  const work = document.createElement('canvas');
  work.width = out.w; work.height = out.h;
  const wg = work.getContext('2d', { willReadFrequently: true });

  /**
   * The photo framed into a window-sized frame (RGBA). With the cut-out off, a photo smaller than the window gets a blurred copy of
   * itself behind it; with it on the gap stays empty, because the gap is not photo and must not be mistaken for backdrop.
   */
  function framedPixels(underlay) {
    const t = frameTransform({ srcW: bitmap.width, srcH: bitmap.height, ...frame }, out.w, out.h);
    wg.setTransform(1, 0, 0, 1, 0, 0);
    wg.globalCompositeOperation = 'source-over';
    wg.clearRect(0, 0, out.w, out.h);
    if (underlay) {
      wg.fillStyle = '#e9e1d2'; wg.fillRect(0, 0, out.w, out.h);
      if (frame.zoom < 1) {
        wg.save();
        try { wg.filter = 'blur(10px)'; } catch { /* filter is optional */ }
        wg.drawImage(bitmap, -12, -12, out.w + 24, out.h + 24);
        wg.restore();
      }
    }
    wg.setTransform(t.a, t.b, t.c, t.d, t.e, t.f);
    wg.drawImage(bitmap, 0, 0);
    wg.setTransform(1, 0, 0, 1, 0, 0);
    return wg.getImageData(0, 0, out.w, out.h);
  }

  // The cut-out is made on the photo itself, once per picture (not on every zoom or pan), and carried through the same frame as the
  // photo. That keeps the frame's own edge out of it: an earlier version cut the framed picture, and the blurred strip it showed
  // around a small photo smeared the subject's outline and let the backdrop fill leak in.
  const maskCanvas = document.createElement('canvas');
  const frameMask = document.createElement('canvas');
  frameMask.width = out.w; frameMask.height = out.h;
  const mg = frameMask.getContext('2d', { willReadFrequently: true });
  /** Where the face is in the photo: from the eye and mouth marks when we have them, otherwise the middle. */
  function facePrior() {
    if (marks) {
      const { eye, mouth } = marks;
      const d = Math.hypot(mouth.x - eye.x, mouth.y - eye.y);
      return { cx: (eye.x + (mouth.x - eye.x) * 0.45) / bitmap.width, cy: (eye.y + (mouth.y - eye.y) * 0.45) / bitmap.height, ryH: Math.min(0.5, (1.7 * d) / bitmap.height), aspect: 0.78 };
    }
    return { cx: 0.5, cy: 0.46, ryH: 0.36, aspect: 0.78 };
  }
  function sourceCutout() {
    const key = `${imageId}|${tight}|${marks ? `${marks.eye.x},${marks.eye.y},${marks.mouth.x},${marks.mouth.y}` : ''}`;
    if (cut.key === key) return;
    const k = Math.min(1, 640 / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(8, Math.round(bitmap.width * k)), h = Math.max(8, Math.round(bitmap.height * k));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bitmap, 0, 0, w, h);
    const px = g.getImageData(0, 0, w, h).data;
    const alpha = removeBackground(px, w, h, { tightness: tight, prior: facePrior() });
    const m = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) { m[i * 4] = m[i * 4 + 1] = m[i * 4 + 2] = 255; m[i * 4 + 3] = alpha[i]; }
    maskCanvas.width = w; maskCanvas.height = h;
    maskCanvas.getContext('2d').putImageData(new ImageData(m, w, h), 0, 0);
    cut = { key, k: w / bitmap.width };
  }
  /** The cut-out as the frame sees it: one byte per frame pixel, 0 outside the photo. */
  function framedAlpha() {
    sourceCutout();
    const t = frameTransform({ srcW: bitmap.width, srcH: bitmap.height, ...frame }, out.w, out.h);
    mg.setTransform(1, 0, 0, 1, 0, 0);
    mg.clearRect(0, 0, out.w, out.h);
    mg.setTransform(t.a / cut.k, t.b / cut.k, t.c / cut.k, t.d / cut.k, t.e, t.f);
    mg.drawImage(maskCanvas, 0, 0);
    mg.setTransform(1, 0, 0, 1, 0, 0);
    const d = mg.getImageData(0, 0, out.w, out.h).data;
    const a = new Uint8ClampedArray(out.w * out.h);
    for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
    return a;
  }

  /** Draw the picture into the display canvas. `quick` skips the cut-out and the style (used while dragging). */
  function paint(quick) {
    const cv = $('sf-canvas');
    const g = cv.getContext('2d');
    const img = framedPixels(!cutout);
    let data;
    let alpha = null;
    if (quick) {
      data = img.data;
    } else {
      if (cutout) alpha = framedAlpha();
      data = applyStyle(style, img.data, out.w, out.h, { alpha, ppm: PX_PER_MM });
      if (alpha && style !== 'toon') { data = Uint8ClampedArray.from(data); for (let i = 0; i < alpha.length; i++) data[i * 4 + 3] = alpha[i]; }
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, out.w, out.h);
    g.putImageData(new ImageData(data, out.w, out.h), 0, 0);
    // the window: every corner round, nothing outside the plate's visible area
    g.globalCompositeOperation = 'destination-in';
    g.fillStyle = '#000';
    traceWindow(g, out.w / WINDOW_MM.w, out.h / WINDOW_MM.h);
    g.fill();
    g.globalCompositeOperation = 'source-over';
    return cv;
  }

  const busy = (on) => { const b = $('sf-busy'); if (b) b.hidden = !on; };
  /** Full render now (cut-out + style). */
  function render() {
    if (!bitmap) return null;
    clearTimeout(settle); settle = 0;
    busy(false);
    return paint(false);
  }
  /** Cheap preview now, full render once the input settles. */
  function renderSoon() {
    if (!bitmap) return;
    paint(true);
    busy(true);
    clearTimeout(settle);
    settle = setTimeout(() => { settle = 0; if (bitmap) { paint(false); busy(false); } }, 180);
  }

  function toAdjust(faceMarks = null) {
    imageId += 1;
    free = false;
    marks = null;
    const z = zoomRange(bitmap.width, bitmap.height);
    frame = { zoom: z.initial, panX: 0, panY: 0, rotateDeg: 0 };
    const zs = $('sf-zoom');
    zs.min = String(z.min); zs.max = String(z.max); zs.value = String(z.initial);
    $('sf-rot').value = '0';
    show('adjust');
    syncControls();
    if (!(faceMarks && lineUp(faceMarks))) render();
    $('sf-use').focus({ preventScroll: true });
  }

  // ---- Smart face (opt-in, online): consent -> grown-up gate -> one picture sent -----------------------------------
  const cloud = () => (cloudInst ??= (ctx.cloud ?? createSelfieCloud()));
  const SMART_STEPS = ['consent', 'gate', 'choose', 'work'];
  function smartStep(name, text = '') {
    smart = { ...(smart ?? {}), step: name };
    state.smart = name;
    for (const n of SMART_STEPS) $(`sf-smart-${n}`).hidden = n !== name;
    if (name === 'work') $('sf-work-text').textContent = text;
  }
  function enterSmart() {
    if (!bitmap) return;
    setError('');
    $('sf-adjust').hidden = true; $('sf-smart-panel').hidden = false;
    smartStep('consent'); // consent is asked again for every picture and every visit; nothing has been sent yet
    $('sf-smart-no').focus();
  }
  function exitSmart() {
    if (smartAbort) { smartAbort.abort(); smartAbort = null; }
    smart = null; state.smart = '';
    $('sf-smart-panel').hidden = true;
    if (state.step === 'adjust') { $('sf-adjust').hidden = false; $('sf-smart').focus(); }
  }
  async function smartYes() {
    setError('');
    if (cloud().hasProof()) { smartStep('choose'); $('sf-smart-parts').focus(); return; } // a grown-up passed the gate a moment ago
    smartStep('work', 'Asking the grown-up check for a question…');
    smartAbort = new AbortController();
    const ch = await cloud().challenge(smartAbort.signal);
    if (state.smart !== 'work') return; // cancelled meanwhile
    if (ch.status !== 'ok') { exitSmart(); setError(describeStatus(ch.status)); return; }
    smart.challenge = ch;
    $('sf-gate-q').textContent = ch.mode === 'pin' ? 'Type the grown-up PIN.' : `What is ${ch.a} × ${ch.b}?`;
    const inp = $('sf-gate-input');
    inp.value = ''; inp.type = ch.mode === 'pin' ? 'password' : 'text';
    $('sf-gate-err').hidden = true;
    smartStep('gate');
    inp.focus();
  }
  async function smartCheck() {
    const ch = smart && smart.challenge;
    const v = $('sf-gate-input').value.trim();
    if (!ch || !v) return;
    $('sf-gate-err').hidden = true;
    smartAbort = new AbortController();
    const r = await cloud().verify(ch.mode === 'pin' ? { pin: v } : { challengeToken: ch.challengeToken, answer: v }, smartAbort.signal);
    if (state.smart !== 'gate') return;
    if (r.status === 'ok') { smartStep('choose'); $('sf-smart-parts').focus(); return; }
    $('sf-gate-err').textContent = r.status === 'wrong'
      ? (r.cooldown ? `Too many tries. Please wait ${r.retryAfterSeconds ?? 60} seconds.` : 'That is not it. Try again.')
      : describeStatus(r.status);
    $('sf-gate-err').hidden = false;
    $('sf-gate-input').value = ''; $('sf-gate-input').focus();
  }
  async function decodeToCanvas(dataUrl) {
    try {
      const im = new Image();
      im.src = dataUrl;
      await im.decode();
      const c = document.createElement('canvas');
      c.width = im.naturalWidth; c.height = im.naturalHeight;
      c.getContext('2d').drawImage(im, 0, 0);
      return c;
    } catch { return null; }
  }
  /** One picture goes out per tap, after the consent screen and the gate: eyes and mouth ('parts') or a cartoon redraw ('cartoon'). */
  async function smartRun(kind) {
    if (!bitmap) return;
    smartAbort = new AbortController();
    const signal = smartAbort.signal;
    smartStep('work', kind === 'cartoon' ? 'Sending your picture to be redrawn as a cartoon… (about 20 seconds)' : 'Sending your picture to find the eyes and mouth… (a few seconds)');
    const r = kind === 'cartoon' ? await cloud().cartoon(toJpegDataUrl(bitmap), signal) : await cloud().faceParts(toJpegDataUrl(bitmap), signal);
    if (state.smart !== 'work') return; // cancelled
    if (r.status === 'gate-required') { await smartYes(); setError(describeStatus('gate-required')); return; }
    if (r.status !== 'ok') { exitSmart(); setError(describeStatus(r.status)); return; }
    if (kind === 'parts') {
      exitSmart();
      lineUp(marksToPixels(r, bitmap.width, bitmap.height));
      return;
    }
    // cartoon: the redraw becomes the picture, then the helper finds its eyes and mouth so it lines up too
    const next = await decodeToCanvas(r.image);
    if (!next) { exitSmart(); setError(describeStatus('unavailable')); return; }
    smartStep('work', 'Finding the eyes and mouth on the cartoon…');
    const p = await cloud().faceParts(toJpegDataUrl(next), signal);
    if (state.smart !== 'work') return;
    if (bitmap && bitmap.close) bitmap.close();
    bitmap = next;
    style = 'photo'; // already cartoon art
    exitSmart();
    toAdjust(p.status === 'ok' ? marksToPixels(p, next.width, next.height) : null);
    if (p.status === 'gate-required') setError('Your cartoon is ready. The grown-up check ran out before it could be lined up: tap Line up eyes & mouth, or ask a grown-up again with Smart face.');
    else if (p.status !== 'ok') setError(describeStatus(p.status));
  }

  // ---- line up eyes and mouth: two taps, nothing is detected ------------------------------------------------
  /** Zoom, turn and shift the photo so the eyes and mouth sit on the plate's marks. `eye` and `mouth` are source pixels. */
  function lineUp({ eye, mouth }) {
    if (!bitmap) return null;
    const f = alignFrame({ srcW: bitmap.width, srcH: bitmap.height, eye, mouth }, out.w, out.h);
    if (!f) return null;
    marks = { eye, mouth };
    const zs = $('sf-zoom');
    const zoom = Math.max(Number(zs.min) || 0.25, Math.min(8, f.zoom));
    zs.max = '8'; zs.value = String(zoom);
    $('sf-rot').value = String(Math.round(f.rotateDeg));
    frame = { ...frame, zoom, rotateDeg: f.rotateDeg, panX: f.panX, panY: f.panY };
    free = true; // exact: a photo smaller than the window must be able to sit off-centre (the mouth is near the bottom edge)
    render();
    return { ...frame };
  }
  const dot = (g, x, y, colour) => { g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fillStyle = colour; g.fill(); g.lineWidth = 3; g.strokeStyle = '#fff'; g.stroke(); };
  function drawPick() {
    const pc = $('sf-pick-canvas'), g = pc.getContext('2d');
    g.clearRect(0, 0, pc.width, pc.height);
    g.drawImage(bitmap, 0, 0, pc.width, pc.height);
    if (pick && pick.eye) dot(g, pick.eye.x * pick.k, pick.eye.y * pick.k, '#1fa97c');
  }
  function enterPick() {
    if (!bitmap) return;
    const pc = $('sf-pick-canvas');
    const k = Math.min(1, 720 / Math.max(bitmap.width, bitmap.height));
    pc.width = Math.max(1, Math.round(bitmap.width * k)); pc.height = Math.max(1, Math.round(bitmap.height * k));
    $('sf-adjust').hidden = true; $('sf-pick').hidden = false;
    pick = { step: 'eyes', k };
    state.pick = 'eyes';
    $('sf-pick-help').textContent = 'Tap the middle between the eyes.';
    drawPick();
    $('sf-pick-cancel').focus();
  }
  function exitPick() {
    pick = null; state.pick = '';
    $('sf-pick').hidden = true;
    if (state.step === 'adjust') { $('sf-adjust').hidden = false; $('sf-align').focus(); }
  }
  function pickTap(clientX, clientY, rect) {
    if (!pick || !bitmap) return;
    const x = ((clientX - rect.left) / rect.width) * bitmap.width, y = ((clientY - rect.top) / rect.height) * bitmap.height;
    if (pick.step === 'eyes') {
      pick.eye = { x, y }; pick.step = 'mouth'; state.pick = 'mouth';
      $('sf-pick-help').textContent = 'Now tap the middle of the mouth.';
      drawPick();
      return;
    }
    const marks = { eye: pick.eye, mouth: { x, y } };
    exitPick();
    if (!lineUp(marks)) setError('Those two taps are on the same spot. Try again.');
  }

  function syncControls() {
    $('sf-cutout').checked = cutout;
    $('sf-tight-wrap').hidden = !cutout;
    root.querySelectorAll('input[name="sf-style"]').forEach((r) => { r.checked = r.value === style; });
    state.cutout = cutout; state.style = style;
  }

  function setFrame(patch, soon = true) {
    frame = { ...frame, ...patch };
    if (!free) {
      const c = clampPan({ srcW: bitmap.width, srcH: bitmap.height, ...frame }, out.w, out.h);
      frame.panX = c.panX; frame.panY = c.panY;
    }
    if (soon) renderSoon(); else render();
  }

  // drag to pan (pan is in frame heights, so one css pixel is 1 / displayed height)
  (() => {
    const cv = $('sf-canvas');
    let drag = null;
    cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, px: frame.panX, py: frame.panY }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', (e) => {
      if (!drag || !bitmap) return;
      const k = 1 / cv.getBoundingClientRect().height;
      setFrame({ panX: drag.px + (e.clientX - drag.x) * k, panY: drag.py + (e.clientY - drag.y) * k });
    });
    const end = () => { drag = null; };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  })();

  /** The finished picture as a fresh canvas of CANVAS_PX. */
  function finished() {
    const cv = render();
    if (!cv) return null;
    const c = document.createElement('canvas');
    c.width = out.w; c.height = out.h;
    c.getContext('2d').drawImage(cv, 0, 0);
    return c;
  }

  function use() {
    const c = finished();
    if (!c) return;
    ctx.apply(c);
    isActive = true;
    close();
  }

  /** True-size sticker of the current framing: 600 dpi PNG (pHYs set) and an SVG in mm with a cut line shaped like the window. */
  async function exportSticker() {
    const cv = render();
    if (!cv) throw new Error('No photo to export');
    const { w, h, dpi } = stickerPixels();
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    if (cutout) { // the removed background becomes the plate colour, so the sticker blends into the plate it sits on
      g.fillStyle = plateColor();
      traceWindow(g, w / WINDOW_MM.w, h / WINDOW_MM.h);
      g.fill();
    }
    g.drawImage(cv, 0, 0, w, h); // the canvas is drawn at the same pixels per mm both ways, so this is undistorted at true size
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
    if (cloudInst) cloudInst.clearProof();
    if (!isActive) return;
    isActive = false;
    ctx.restore();
  }

  // ---- wiring ---------------------------------------------------------------------------
  $('sf-close').addEventListener('click', close);
  $('sf-cam-cancel').addEventListener('click', () => { stopCamera(); show('intro'); });
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  root.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { if (pick) exitPick(); else if (smart) exitSmart(); else close(); } });
  $('sf-start').addEventListener('click', startCamera);
  $('sf-snap').addEventListener('click', beginCountdown);
  $('selfie-file').addEventListener('change', (e) => { loadFile(e.target.files[0]); e.target.value = ''; });
  $('sf-retake').addEventListener('click', () => { dropImage(); show('intro'); });
  $('sf-prompt-go').addEventListener('click', () => { promptFace($('sf-prompt').value); });
  $('sf-prompt').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); promptFace($('sf-prompt').value); } });
  $('sf-smart').addEventListener('click', enterSmart);
  $('sf-smart-no').addEventListener('click', exitSmart);
  $('sf-smart-yes').addEventListener('click', smartYes);
  $('sf-gate-ok').addEventListener('click', smartCheck);
  $('sf-gate-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); smartCheck(); } });
  $('sf-gate-cancel').addEventListener('click', exitSmart);
  $('sf-smart-back').addEventListener('click', exitSmart);
  $('sf-work-cancel').addEventListener('click', exitSmart);
  $('sf-smart-parts').addEventListener('click', () => smartRun('parts'));
  $('sf-smart-cartoon').addEventListener('click', () => smartRun('cartoon'));
  $('sf-align').addEventListener('click', enterPick);
  $('sf-pick-cancel').addEventListener('click', exitPick);
  $('sf-pick-canvas').addEventListener('click', (e) => pickTap(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect()));
  $('sf-zoom').addEventListener('input', (e) => setFrame({ zoom: Number(e.target.value) }));
  $('sf-rot').addEventListener('input', (e) => setFrame({ rotateDeg: Number(e.target.value) }));
  $('sf-cutout').addEventListener('change', (e) => { cutout = e.target.checked; syncControls(); if (bitmap) render(); });
  $('sf-tight').addEventListener('input', (e) => { tight = Number(e.target.value); if (bitmap) renderSoon(); });
  root.querySelectorAll('input[name="sf-style"]').forEach((r) => r.addEventListener('change', () => { style = r.value; syncControls(); if (bitmap) render(); }));
  $('sf-use').addEventListener('click', use);
  $('sf-sticker').addEventListener('click', downloadSticker);
  // The camera must never outlive the page being visible.
  const onHide = () => { if (document.hidden) stopCamera(); };
  document.addEventListener('visibilitychange', onHide);
  const onPageHide = () => { stopCamera(); dropImage(); };
  window.addEventListener('pagehide', onPageHide);

  return {
    open, close, remove, snapNow, loadFile, exportSticker, promptFace, loadSample, lineUp,
    /** Unmount: stop the camera, drop the picture, remove the modal and its own <style>, and detach the page-level listeners. */
    dispose() {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      stopCamera(); dropImage();
      root.remove(); css.remove();
    },
    active: () => isActive,
    state,
    samples: () => SAMPLE_FACES.map((f) => f.id),
    // test hooks: framing and options without synthesising pointer events
    setFrame: (p) => { if (bitmap) setFrame(p, false); },
    setStyle: (s) => { style = s; syncControls(); if (bitmap) render(); },
    setCutout: (on) => { cutout = !!on; syncControls(); if (bitmap) render(); },
    setTightness: (v) => { tight = Number(v); if (bitmap) render(); },
    renderNow: () => render(),
    hasImage: () => !!bitmap,
  };
}
