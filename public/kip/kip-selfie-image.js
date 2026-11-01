// Selfie image maths: on-device background removal and the Toon style. Pure functions on RGBA arrays, no DOM, no network.
//
// PRIVACY: nothing here sends, stores or recognises anything. There is no face detection, landmark model or any other
// biometric step. The cut-out is a centre-weighted colour model (k-means) smoothed along image edges, and Toon is a
// smooth + palette + outline filter. Both read the pixels they are given and return new arrays.

// ---- colour ----------------------------------------------------------------------------------------
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const LIN = new Float32Array(256).map((_, i) => lin(i));
export function rgb2lab(r, g, b, out, o = 0) {
  const R = LIN[r], G = LIN[g], B = LIN[b];
  let x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  let y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  let z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = f(x); y = f(y); z = f(z);
  out[o] = 116 * y - 16; out[o + 1] = 500 * (x - y); out[o + 2] = 200 * (y - z);
}

// ---- k-means (deterministic: k-means++ style farthest-point seeding from a fixed start) -----------------
export function kmeans(samples, n, k, iters = 8) {
  const cen = new Float32Array(k * 3);
  const first = Math.floor(n / 2);
  cen.set(samples.subarray(first * 3, first * 3 + 3), 0);
  const d2 = new Float32Array(n).fill(Infinity);
  for (let c = 1; c < k; c++) {
    let best = 0, bd = -1;
    for (let i = 0; i < n; i++) {
      const dx = samples[i * 3] - cen[(c - 1) * 3], dy = samples[i * 3 + 1] - cen[(c - 1) * 3 + 1], dz = samples[i * 3 + 2] - cen[(c - 1) * 3 + 2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d < d2[i]) d2[i] = d;
      if (d2[i] > bd) { bd = d2[i]; best = i; }
    }
    cen.set(samples.subarray(best * 3, best * 3 + 3), c * 3);
  }
  const assign = new Int32Array(n);
  for (let it = 0; it < iters; it++) {
    const sum = new Float64Array(k * 3), cnt = new Int32Array(k);
    for (let i = 0; i < n; i++) {
      let bi = 0, bd2 = Infinity;
      for (let c = 0; c < k; c++) {
        const dx = samples[i * 3] - cen[c * 3], dy = samples[i * 3 + 1] - cen[c * 3 + 1], dz = samples[i * 3 + 2] - cen[c * 3 + 2];
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bd2) { bd2 = d; bi = c; }
      }
      assign[i] = bi; cnt[bi]++;
      sum[bi * 3] += samples[i * 3]; sum[bi * 3 + 1] += samples[i * 3 + 1]; sum[bi * 3 + 2] += samples[i * 3 + 2];
    }
    for (let c = 0; c < k; c++) if (cnt[c]) { cen[c * 3] = sum[c * 3] / cnt[c]; cen[c * 3 + 1] = sum[c * 3 + 1] / cnt[c]; cen[c * 3 + 2] = sum[c * 3 + 2] / cnt[c]; }
  }
  // per-cluster spread and weight
  const varc = new Float32Array(k).fill(36), wt = new Float32Array(k), cnt = new Int32Array(k), acc = new Float64Array(k);
  for (let i = 0; i < n; i++) {
    const c = assign[i];
    const dx = samples[i * 3] - cen[c * 3], dy = samples[i * 3 + 1] - cen[c * 3 + 1], dz = samples[i * 3 + 2] - cen[c * 3 + 2];
    acc[c] += dx * dx + dy * dy + dz * dz; cnt[c]++;
  }
  for (let c = 0; c < k; c++) { wt[c] = cnt[c] / Math.max(1, n); varc[c] = Math.max(36, cnt[c] > 1 ? acc[c] / (3 * cnt[c]) : 36); }
  return { cen, varc, wt, k, assign };
}

function nll(model, L, a, b) {
  // -log sum_k w_k N(x; mu_k, var_k I) up to a constant shared by both classes
  let s = 0;
  for (let c = 0; c < model.k; c++) {
    if (model.wt[c] <= 0) continue;
    const dx = L - model.cen[c * 3], dy = a - model.cen[c * 3 + 1], dz = b - model.cen[c * 3 + 2];
    const v = model.varc[c];
    s += model.wt[c] * Math.exp(-(dx * dx + dy * dy + dz * dz) / (2 * v)) / (v * Math.sqrt(v));
  }
  return -Math.log(s + 1e-9);
}

// ---- resampling --------------------------------------------------------------------------------------
export function boxDownsample(src, w, h, sw, sh) {
  const out = new Uint8ClampedArray(sw * sh * 4);
  for (let y = 0; y < sh; y++) {
    const y0 = Math.floor((y * h) / sh), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * h) / sh));
    for (let x = 0; x < sw; x++) {
      const x0 = Math.floor((x * w) / sw), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * w) / sw));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const i = (yy * w + xx) * 4; r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3]; n++; }
      const o = (y * sw + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
    }
  }
  return out;
}

export function bilinearUp(m, sw, sh, w, h) {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(sh - 1, Math.max(0, ((y + 0.5) * sh) / h - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(sw - 1, Math.max(0, ((x + 0.5) * sw) / w - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0;
      const a = m[y0 * sw + x0] * (1 - tx) + m[y0 * sw + x1] * tx;
      const b = m[y1 * sw + x0] * (1 - tx) + m[y1 * sw + x1] * tx;
      out[y * w + x] = a * (1 - ty) + b * ty;
    }
  }
  return out;
}

const smooth01 = (lo, hi, v) => { const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo))); return t * t * (3 - 2 * t); };

// ---- background removal -----------------------------------------------------------------------------
/**
 * Alpha mask (0..255, one byte per pixel) of the subject in the middle of the frame.
 * `prior` is where the subject is expected: an ellipse (centre and radii as fractions of the frame). The user frames the
 * face with pan and zoom, so the prior is what makes this a cut-out of the face, not of the busiest object.
 */
export function removeBackground(src, w, h, opts = {}) {
  const { work = 160, tightness = 0.5, em = 3, prior: priorIn = {}, plain = true } = opts;
  if (plain) {
    // A uniform backdrop (a cartoon on a flat colour, a plain wall) is cut exactly by flood fill from the edges; anything else
    // goes to the colour model below.
    const exact = plainBackgroundAlpha(src, w, h, tightness, { ryH: 0.46, aspect: 0.78, ...priorIn });
    if (exact) return exact;
  }
  const prior = { cx: 0.5, cy: 0.5, ryH: 0.46, aspect: 0.78, ...priorIn }; // ry as a fraction of the height; rx = ry * aspect (a face is about 0.78 as wide as it is tall)
  const scale = Math.min(1, work / Math.max(w, h));
  const sw = Math.max(8, Math.round(w * scale)), sh = Math.max(8, Math.round(h * scale));
  const img = boxDownsample(src, w, h, sw, sh);
  const N = sw * sh;
  const lab = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) rgb2lab(img[i * 4], img[i * 4 + 1], img[i * 4 + 2], lab, i * 3);

  const rr = new Float32Array(N), pri = new Float32Array(N);
  const label = new Int8Array(N); // 1 fg, -1 bg, 0 unknown
  const ring = Math.max(1, Math.round(Math.min(sw, sh) * 0.04));
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const i = y * sw + x;
    const r = Math.hypot(((x + 0.5) / sh - prior.cx * (sw / sh)) / (prior.ryH * prior.aspect), ((y + 0.5) / sh - prior.cy) / prior.ryH);
    rr[i] = r;
    pri[i] = r <= 0.6 ? 0.97 : Math.max(0.04, 0.97 - 0.93 * smooth01(0.6, 1.5, r));
    label[i] = r < 0.5 ? 1 : (r > 1.3 || x < ring || y < ring || x >= sw - ring || y >= sh - ring ? -1 : 0);
  }
  const prLogit = new Float32Array(N);
  for (let i = 0; i < N; i++) prLogit[i] = Math.log(pri[i] / (1 - pri[i]));

  // neighbour weights (edge aware): horizontal and vertical
  const BETA = 11;
  const wH = new Float32Array(N), wV = new Float32Array(N);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const i = y * sw + x;
    if (x + 1 < sw) { const dx = lab[i * 3] - lab[(i + 1) * 3], dy = lab[i * 3 + 1] - lab[(i + 1) * 3 + 1], dz = lab[i * 3 + 2] - lab[(i + 1) * 3 + 2]; wH[i] = Math.exp(-(dx * dx + dy * dy + dz * dz) / (2 * BETA * BETA)); }
    if (y + 1 < sh) { const j = i + sw; const dx = lab[i * 3] - lab[j * 3], dy = lab[i * 3 + 1] - lab[j * 3 + 1], dz = lab[i * 3 + 2] - lab[j * 3 + 2]; wV[i] = Math.exp(-(dx * dx + dy * dy + dz * dz) / (2 * BETA * BETA)); }
  }

  let p = new Float32Array(N);
  const unary = new Float32Array(N);
  for (let it = 0; it < em; it++) {
    // fit both colour models from the current labels
    const take = (want) => {
      const idx = [];
      for (let i = 0; i < N; i++) if (label[i] === want) idx.push(i);
      const step = Math.max(1, Math.floor(idx.length / 3000));
      const arr = new Float32Array(Math.ceil(idx.length / step) * 3);
      let n = 0;
      for (let q = 0; q < idx.length; q += step) { arr.set(lab.subarray(idx[q] * 3, idx[q] * 3 + 3), n * 3); n++; }
      return { arr, n };
    };
    const F = take(1), B = take(-1);
    if (F.n < 8 || B.n < 8) break;
    const mf = kmeans(F.arr, F.n, Math.min(4, F.n), 6), mb = kmeans(B.arr, B.n, Math.min(4, B.n), 6);
    for (let i = 0; i < N; i++) {
      const L = lab[i * 3], a = lab[i * 3 + 1], b = lab[i * 3 + 2];
      const u = nll(mb, L, a, b) - nll(mf, L, a, b);
      unary[i] = Math.max(-9, Math.min(9, u)) * 0.9 + prLogit[i] * 0.9;
    }
    // mean-field smoothing with edge-aware couplings
    for (let i = 0; i < N; i++) p[i] = 1 / (1 + Math.exp(-unary[i]));
    const next = new Float32Array(N);
    for (let m = 0; m < 10; m++) {
      for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
        const i = y * sw + x;
        let s = 0;
        if (x > 0) s += wH[i - 1] * (2 * p[i - 1] - 1);
        if (x + 1 < sw) s += wH[i] * (2 * p[i + 1] - 1);
        if (y > 0) s += wV[i - sw] * (2 * p[i - sw] - 1);
        if (y + 1 < sh) s += wV[i] * (2 * p[i + sw] - 1);
        next[i] = 1 / (1 + Math.exp(-(unary[i] + 1.5 * s)));
      }
      p.set(next);
    }
    // re-label for the next round: confident pixels only
    for (let i = 0; i < N; i++) label[i] = p[i] > 0.8 ? 1 : p[i] < 0.2 ? -1 : 0;
  }

  // clean up: threshold, keep the component that best matches the prior, fill holes
  let mask = new Uint8Array(N);
  for (let i = 0; i < N; i++) mask[i] = p[i] > 0.5 ? 1 : 0;
  mask = morph(mask, sw, sh, 1, false); // open
  mask = morph(mask, sw, sh, 1, true);  // close
  // Tightness is the user's edge control: below 0.5 grows the cut-out, above shrinks it, up to 3 working pixels
  // (about 0.5 mm on the plate). Applied to the final mask so it is exactly monotonic.
  const steps = Math.round(Math.min(1, Math.abs(tightness - 0.5) * 2) * 3);
  for (let k = 0; k < steps; k++) mask = step3(mask, sw, sh, tightness < 0.5);
  mask = keepBest(mask, pri, sw, sh);
  mask = fillHoles(mask, sw, sh);

  // soft edge at output size
  const f = new Float32Array(N);
  for (let i = 0; i < N; i++) f[i] = mask[i];
  const blurred = blur3(blur3(f, sw, sh), sw, sh);
  const up = bilinearUp(blurred, sw, sh, w, h);
  const alpha = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) alpha[i] = Math.round(255 * smooth01(0.3, 0.7, up[i]));
  return alpha;
}

/**
 * Flood fill from the frame edge over pixels close to the backdrop colour, when the corners of the frame are one colour (a cartoon
 * on a flat colour, a plain wall; the subject may touch or fill the edges, so only the corners are tested). Returns the alpha
 * (0..255, soft 1-2 px edge) or null when the backdrop is not plain or the fill clearly went wrong (the subject is expected in the
 * middle, so a fill that ate the middle means the subject and the backdrop are alike: leave that to the colour model).
 */
export function plainBackgroundAlpha(src, w, h, tightness = 0.5, prior = { ryH: 0.46, aspect: 0.78 }) {
  const N = w * h;
  if (N < 64) return null;
  const lab = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) rgb2lab(src[i * 4], src[i * 4 + 1], src[i * 4 + 2], lab, i * 3);
  // the backdrop colour: the median of the four corner blocks, which must agree
  const cw = Math.max(3, Math.round(w * 0.08)), ch = Math.max(3, Math.round(h * 0.1));
  const blocks = [[0, 0], [w - cw, 0], [0, h - ch], [w - cw, h - ch]].map(([x0, y0]) => {
    const idx = [];
    for (let y = y0; y < y0 + ch; y++) for (let x = x0; x < x0 + cw; x++) idx.push(y * w + x);
    return idx;
  });
  const all = blocks.flat();
  const med = [0, 1, 2].map((c) => { const v = all.map((i) => lab[i * 3 + c]).sort((a, b) => a - b); return v[v.length >> 1]; });
  const dist = new Float32Array(N);
  for (let i = 0; i < N; i++) dist[i] = Math.hypot(lab[i * 3] - med[0], lab[i * 3 + 1] - med[1], lab[i * 3 + 2] - med[2]);
  const agree = blocks.filter((idx) => idx.filter((i) => dist[i] < 9).length / idx.length >= 0.8).length;
  if (agree < 3) return null; // the corners are not one colour
  const ring = Math.max(2, Math.round(Math.min(w, h) * 0.03));
  const ringIdx = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < ring || y < ring || x >= w - ring || y >= h - ring) ringIdx.push(y * w + x);
  const dE = (i) => dist[i];
  const TOL = 14;
  const bg = new Uint8Array(N);
  const stack = [];
  for (const i of ringIdx) if (dE(i) < TOL && !bg[i]) { bg[i] = 1; stack.push(i); }
  while (stack.length) {
    const i = stack.pop();
    const x = i % w, y = (i / w) | 0;
    if (x > 0 && !bg[i - 1] && dE(i - 1) < TOL) { bg[i - 1] = 1; stack.push(i - 1); }
    if (x + 1 < w && !bg[i + 1] && dE(i + 1) < TOL) { bg[i + 1] = 1; stack.push(i + 1); }
    if (y > 0 && !bg[i - w] && dE(i - w) < TOL) { bg[i - w] = 1; stack.push(i - w); }
    if (y + 1 < h && !bg[i + w] && dE(i + w) < TOL) { bg[i + w] = 1; stack.push(i + w); }
  }
  let mask = new Uint8Array(N);
  let fgCount = 0;
  for (let i = 0; i < N; i++) { mask[i] = bg[i] ? 0 : 1; fgCount += mask[i]; }
  if (fgCount < N * 0.06 || fgCount > N * 0.985) return null;
  // the middle of the frame must be subject
  let centreFg = 0, centreAll = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (Math.hypot(((x + 0.5) / h - 0.5 * (w / h)) / (prior.ryH * prior.aspect), ((y + 0.5) / h - 0.5) / prior.ryH) < 0.5) { centreAll++; centreFg += mask[y * w + x]; }
  }
  if (centreAll && centreFg / centreAll < 0.6) return null;
  mask = morph(mask, w, h, 1, false); // open: no specks
  mask = keepBest(mask, new Float32Array(N).fill(1), w, h);
  mask = fillHoles(mask, w, h);
  // the user's edge control, scaled to the frame (3 working pixels of a 160 px frame at most)
  const steps = Math.round(Math.min(1, Math.abs(tightness - 0.5) * 2) * 3 * (w / 160));
  for (let k = 0; k < steps; k++) mask = step3(mask, w, h, tightness < 0.5);
  const f = new Float32Array(N);
  for (let i = 0; i < N; i++) f[i] = mask[i];
  const soft = blur3(f, w, h);
  const alpha = new Uint8ClampedArray(N);
  for (let i = 0; i < N; i++) alpha[i] = Math.round(255 * smooth01(0.3, 0.7, soft[i]));
  return alpha;
}

function blur3(m, w, h) {
  const out = new Float32Array(m.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      s += m[yy * w + xx]; n++;
    }
    out[y * w + x] = s / n;
  }
  return out;
}

/** One 3x3 box step: grow (dilate) or shrink (erode). Outside the frame counts as the same value as the edge pixel. */
function step3(m, w, h, grow) {
  const out = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let any = 0, all = 1;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = Math.min(w - 1, Math.max(0, x + dx)), yy = Math.min(h - 1, Math.max(0, y + dy));
      if (m[yy * w + xx]) any = 1; else all = 0;
    }
    out[y * w + x] = grow ? any : all;
  }
  return out;
}

/** Binary erode+dilate (open) or dilate+erode (close) with a 3x3 box, `r` times. */
export function morph(mask, w, h, r, close) {
  const step = (m, grow) => {
    const out = new Uint8Array(m.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let any = 0, all = 1;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        const v = xx < 0 || yy < 0 || xx >= w || yy >= h ? (grow ? 0 : 1) : m[yy * w + xx];
        if (v) any = 1; else all = 0;
      }
      out[y * w + x] = grow ? any : all;
    }
    return out;
  };
  let m = mask;
  for (let i = 0; i < r; i++) m = step(m, close);
  for (let i = 0; i < r; i++) m = step(m, !close);
  return m;
}

function components(mask, w, h) {
  const comp = new Int32Array(mask.length).fill(-1);
  const sizes = [];
  const stack = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || comp[s] >= 0) continue;
    const id = sizes.length; let n = 0;
    stack.push(s); comp[s] = id;
    while (stack.length) {
      const i = stack.pop(); n++;
      const x = i % w, y = (i / w) | 0;
      if (x > 0 && mask[i - 1] && comp[i - 1] < 0) { comp[i - 1] = id; stack.push(i - 1); }
      if (x + 1 < w && mask[i + 1] && comp[i + 1] < 0) { comp[i + 1] = id; stack.push(i + 1); }
      if (y > 0 && mask[i - w] && comp[i - w] < 0) { comp[i - w] = id; stack.push(i - w); }
      if (y + 1 < h && mask[i + w] && comp[i + w] < 0) { comp[i + w] = id; stack.push(i + w); }
    }
    sizes.push(n);
  }
  return { comp, sizes };
}

function keepBest(mask, prior, w, h) {
  const { comp, sizes } = components(mask, w, h);
  if (!sizes.length) return mask;
  const score = new Float64Array(sizes.length);
  for (let i = 0; i < mask.length; i++) if (comp[i] >= 0) score[comp[i]] += prior[i];
  let best = 0;
  for (let c = 1; c < sizes.length; c++) if (score[c] > score[best]) best = c;
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) if (comp[i] === best) out[i] = 1;
  return out;
}

function fillHoles(mask, w, h) {
  const inv = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) inv[i] = mask[i] ? 0 : 1;
  const { comp, sizes } = components(inv, w, h);
  const touches = new Uint8Array(sizes.length);
  for (let x = 0; x < w; x++) { if (comp[x] >= 0) touches[comp[x]] = 1; if (comp[(h - 1) * w + x] >= 0) touches[comp[(h - 1) * w + x]] = 1; }
  for (let y = 0; y < h; y++) { if (comp[y * w] >= 0) touches[comp[y * w]] = 1; if (comp[y * w + w - 1] >= 0) touches[comp[y * w + w - 1]] = 1; }
  const out = mask.slice();
  for (let i = 0; i < out.length; i++) if (!out[i] && comp[i] >= 0 && !touches[comp[i]]) out[i] = 1;
  return out;
}

// ---- toon --------------------------------------------------------------------------------------------
function bilateral(src, w, h, radius, sigR) {
  const out = new Uint8ClampedArray(src.length);
  const k = 2 * radius + 1;
  const spatial = new Float32Array(k * k);
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) spatial[(dy + radius) * k + dx + radius] = Math.exp(-(dx * dx + dy * dy) / (radius * radius));
  const inv = 1 / (2 * sigR * sigR);
  const range = new Float32Array((3 * 255 * 255 >> 4) + 2); // weight by squared colour distance in steps of 16
  for (let i = 0; i < range.length; i++) range[i] = Math.exp(-(i * 16) * inv);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    const r0 = src[o], g0 = src[o + 1], b0 = src[o + 2];
    let r = 0, g = 0, b = 0, ws = 0;
    for (let dy = -radius; dy <= radius; dy++) {
      const yy = y + dy < 0 ? 0 : y + dy >= h ? h - 1 : y + dy;
      for (let dx = -radius; dx <= radius; dx++) {
        const xx = x + dx < 0 ? 0 : x + dx >= w ? w - 1 : x + dx;
        const q = (yy * w + xx) * 4;
        const dr = src[q] - r0, dg = src[q + 1] - g0, db = src[q + 2] - b0;
        const wt = spatial[(dy + radius) * k + dx + radius] * range[(dr * dr + dg * dg + db * db) >> 4];
        r += src[q] * wt; g += src[q + 1] * wt; b += src[q + 2] * wt; ws += wt;
      }
    }
    out[o] = r / ws; out[o + 1] = g / ws; out[o + 2] = b / ws; out[o + 3] = src[o + 3];
  }
  return out;
}

/**
 * Cartoon: smooth, snap to a small palette fitted to the subject, clean up speckle, then ink the edges at a fixed line width
 * in millimetres (`ppm` = pixels per mm), so the line is printable and reads at 24 mm.
 * `alpha` (optional, w*h bytes) restricts the palette and the ink to the subject.
 */
export function toon(src, w, h, { alpha = null, ppm = 22, colors = 6, lineMm = 0.2 } = {}) {
  const sm = bilateral(bilateral(src, w, h, 2, 24), w, h, 2, 24);
  const inSubject = (i) => (alpha ? alpha[i] > 100 : true);
  // palette from subject pixels (Lab k-means), assignment in Lab
  const idx = [];
  for (let i = 0; i < w * h; i++) if (inSubject(i)) idx.push(i);
  const step = Math.max(1, Math.floor(idx.length / 4000));
  const sample = new Float32Array(Math.ceil(idx.length / step) * 3);
  let n = 0;
  for (let q = 0; q < idx.length; q += step) { rgb2lab(sm[idx[q] * 4], sm[idx[q] * 4 + 1], sm[idx[q] * 4 + 2], sample, n * 3); n++; }
  const model = kmeans(sample, n, Math.min(colors, Math.max(2, n)), 10);
  const labs = new Float32Array(w * h * 3);
  const lab = new Int16Array(w * h).fill(-1);
  for (const i of idx) {
    rgb2lab(sm[i * 4], sm[i * 4 + 1], sm[i * 4 + 2], labs, i * 3);
    let bi = 0, bd = Infinity;
    for (let c = 0; c < model.k; c++) {
      const dx = labs[i * 3] - model.cen[c * 3], dy = labs[i * 3 + 1] - model.cen[c * 3 + 1], dz = labs[i * 3 + 2] - model.cen[c * 3 + 2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bd) { bd = d; bi = c; }
    }
    lab[i] = bi;
  }
  // mode filter 3x3 (twice) to remove single-pixel islands
  let cur = lab;
  const cnt = new Uint8Array(model.k);
  for (let pass = 0; pass < 2; pass++) {
    const nxt = cur.slice();
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (cur[i] < 0) continue;
      cnt.fill(0);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const l = cur[i + dy * w + dx]; if (l >= 0) cnt[l]++; }
      let bi = cur[i];
      for (let c = 0; c < model.k; c++) if (cnt[c] > cnt[bi]) bi = c;
      nxt[i] = bi;
    }
    cur = nxt;
  }
  // palette colours in RGB: mean of the original pixels that landed in each class (keeps natural hues)
  const sum = new Float64Array(model.k * 3), cn = new Int32Array(model.k);
  for (const i of idx) { const c = cur[i]; if (c < 0) continue; sum[c * 3] += src[i * 4]; sum[c * 3 + 1] += src[i * 4 + 1]; sum[c * 3 + 2] += src[i * 4 + 2]; cn[c]++; }
  const pal = [];
  for (let c = 0; c < model.k; c++) {
    const m = cn[c] || 1;
    let r = sum[c * 3] / m, g = sum[c * 3 + 1] / m, b = sum[c * 3 + 2] / m;
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    r = l + (r - l) * 1.18; g = l + (g - l) * 1.18; b = l + (b - l) * 1.18; // a little more colour so flat areas read
    pal.push([r, g, b]);
  }
  // ink: edges of the smoothed luminance plus the silhouette, thickened to the line width
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = 0.299 * sm[i * 4] + 0.587 * sm[i * 4 + 1] + 0.114 * sm[i * 4 + 2];
  const edge = new Float32Array(w * h);
  const mags = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    if (!inSubject(i)) continue;
    const gx = -gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1] + gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1];
    const gy = -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] + gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
    edge[i] = Math.hypot(gx, gy); mags.push(edge[i]);
  }
  mags.sort((a, b) => a - b);
  const thr = Math.max(40, mags.length ? mags[Math.floor(mags.length * 0.90)] : 1e9);
  let ink = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (edge[i] >= thr) ink[i] = 1;
  if (alpha) {
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (alpha[i] > 100 && (alpha[i - 1] <= 100 || alpha[i + 1] <= 100 || alpha[i - w] <= 100 || alpha[i + w] <= 100)) ink[i] = 1;
    }
  }
  const rad = Math.max(0, Math.round((lineMm * ppm - 3) / 2));
  for (let k = 0; k < rad; k++) ink = dilate(ink, w, h);
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (alpha && alpha[i] <= 100) { out[o + 3] = alpha ? alpha[i] : 255; continue; }
    const c = cur[i] >= 0 ? pal[cur[i]] : [src[o], src[o + 1], src[o + 2]];
    if (ink[i]) { out[o] = 38; out[o + 1] = 24; out[o + 2] = 20; } else { out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; }
    out[o + 3] = alpha ? alpha[i] : src[o + 3];
  }
  return out;
}

function dilate(m, w, h) {
  const out = m.slice();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (m[i]) continue;
    if ((x > 0 && m[i - 1]) || (x + 1 < w && m[i + 1]) || (y > 0 && m[i - w]) || (y + 1 < h && m[i + w])) out[i] = 1;
  }
  return out;
}
