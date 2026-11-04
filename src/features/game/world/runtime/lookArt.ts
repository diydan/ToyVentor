// The pixels of a generated world (docs/specs/generated-worlds-spec.md section 0), as PURE functions on RGBA arrays: no DOM, so a test runs them on real art and the browser wrapper (lookArtBrowser.ts)
// only decodes, calls these and encodes. The mid strip is painted on pure black and has to become a transparent cut-out: this is a TypeScript port of `scripts/make-backdrops.py`'s mid bake (flood-fill the
// black surround from the image border so dark pixels INSIDE the art survive, eat two rings of dark fringe, crop to the art, give transparent pixels the colour of the nearest art pixel so a filtered edge
// fades to the art's own colour and not to black, soften the alpha edge by 0.8 px). The two are tested against each other on the committed raw art (tests/look-art.test.ts), so they cannot drift.
//
// The gates are the spec's section 3.3 numbers, loosened where real art measured differently: the model ignoring "pure black" or "the whole width", or painting a far band that is far too dark for its
// look, is a failed layer (the caller tries once more, then falls back to the base theme's own art). Nothing here ever throws on odd input: a bad image is a failed gate, not a crash.
import type { LookTime } from "../../../../../shared/worldBrief";

export interface Rgba { data: Uint8ClampedArray; width: number; height: number }

/** A pixel this dark (max channel) on the border starts the surround. */
export const DARK_SEED = 24;
/** A pixel this dark next to the surround is fringe, eaten for two rings. */
export const DARK_FRINGE = 80;
/** The widest a generated mid strip is kept (phones: memory). Far bands are kept at most this wide too (WebGL's safe texture width). */
export const MAX_MID_WIDTH = 2048;
export const MAX_FAR_WIDTH = 4096;

const maxChannel = (d: Uint8ClampedArray, i: number) => Math.max(d[i]!, d[i + 1]!, d[i + 2]!);

/** 1 where the black surround is: dark pixels 4-connected to the border (interior darks survive), plus two rings of dark fringe. */
export function surroundMask(src: Rgba): Uint8Array {
  const { data, width: w, height: h } = src;
  const bg = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let sp = 0;
  const push = (p: number) => { if (!bg[p] && maxChannel(data, p * 4) < DARK_SEED) { bg[p] = 1; stack[sp++] = p; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (sp > 0) {
    const p = stack[--sp]!, x = p % w, y = (p - x) / w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (y > 0) push(p - w);
    if (y < h - 1) push(p + w);
  }
  for (let ring = 0; ring < 2; ring++) {                                              // the dark fringe: not yet surround, dark-ish, touching the surround
    const add: number[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (bg[p] || maxChannel(data, p * 4) >= DARK_FRINGE) continue;
        if ((x > 0 && bg[p - 1]) || (x < w - 1 && bg[p + 1]) || (y > 0 && bg[p - w]) || (y < h - 1 && bg[p + w])) add.push(p);
      }
    }
    for (const p of add) bg[p] = 1;
  }
  return bg;
}

/** Give transparent pixels the colour of the nearest art pixel, ring by ring (6 rings), so a filtered edge fades to the art's own colour, not to black. Works in place on a copy of `rgb` (RGBA, alpha untouched). */
function bleedColour(rgba: Uint8ClampedArray, w: number, h: number, opaque: Uint8Array, rings = 6): void {
  let have = Uint8Array.from(opaque);
  for (let r = 0; r < rings; r++) {
    const next = Uint8Array.from(have);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (have[p]) continue;
        let n = 0, R = 0, G = 0, B = 0, q = 0;
        if (x > 0 && have[(q = p - 1)]) { n++; R += rgba[q * 4]!; G += rgba[q * 4 + 1]!; B += rgba[q * 4 + 2]!; }
        if (x < w - 1 && have[(q = p + 1)]) { n++; R += rgba[q * 4]!; G += rgba[q * 4 + 1]!; B += rgba[q * 4 + 2]!; }
        if (y > 0 && have[(q = p - w)]) { n++; R += rgba[q * 4]!; G += rgba[q * 4 + 1]!; B += rgba[q * 4 + 2]!; }
        if (y < h - 1 && have[(q = p + w)]) { n++; R += rgba[q * 4]!; G += rgba[q * 4 + 1]!; B += rgba[q * 4 + 2]!; }
        if (n > 0) { rgba[p * 4] = R / n; rgba[p * 4 + 1] = G / n; rgba[p * 4 + 2] = B / n; next[p] = 1; }
      }
    }
    have = next;
  }
}

/** A separable Gaussian blur of a one-channel image (PIL's GaussianBlur(radius) uses sigma = radius), clamped at the edges. */
function blurAlpha(a: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const rad = Math.max(1, Math.ceil(sigma * 3));
  const k: number[] = [];
  let sum = 0;
  for (let i = -rad; i <= rad; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k.push(v); sum += v; }
  for (let i = 0; i < k.length; i++) k[i]! /= sum;
  const tmp = new Float32Array(a.length), out = new Float32Array(a.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let i = -rad; i <= rad; i++) s += a[y * w + Math.min(w - 1, Math.max(0, x + i))]! * k[i + rad]!;
    tmp[y * w + x] = s;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let i = -rad; i <= rad; i++) s += tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x]! * k[i + rad]!;
    out[y * w + x] = s;
  }
  return out;
}

export interface KeyedMid {
  /** The cut-out: cropped to the art, colour bled into the transparent pixels, soft alpha edge. */
  image: Rgba;
  /** The share of the cropped picture that is art (opaque). */
  opaqueShare: number;
  /** Where the art was in the source, in source pixels (inclusive). */
  box: { x0: number; y0: number; x1: number; y1: number };
  source: { width: number; height: number };
}

/** The mid strip cut out of its black surround, or null when there is no art at all. */
export function keyMid(src: Rgba): KeyedMid | null {
  const { width: w, height: h, data } = src;
  if (w < 4 || h < 4 || data.length < w * h * 4) return null;
  const bg = surroundMask(src);
  let x0 = w, x1 = -1, y0 = h, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!bg[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const out = new Uint8ClampedArray(cw * ch * 4);
  const opaque = new Uint8Array(cw * ch);
  let art = 0;
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const sp = (y + y0) * w + (x + x0), dp = y * cw + x;
    out[dp * 4] = data[sp * 4]!; out[dp * 4 + 1] = data[sp * 4 + 1]!; out[dp * 4 + 2] = data[sp * 4 + 2]!;
    if (!bg[sp]) { opaque[dp] = 1; art++; }
  }
  bleedColour(out, cw, ch, opaque);
  const alpha = blurAlpha(Float32Array.from(opaque, (v) => v * 255), cw, ch, 0.8);
  for (let i = 0; i < cw * ch; i++) out[i * 4 + 3] = Math.round(alpha[i]!);
  return { image: { data: out, width: cw, height: ch }, opaqueShare: art / (cw * ch), box: { x0, y0, x1, y1 }, source: { width: w, height: h } };
}

export interface Gate { ok: boolean; reasons: string[] }

/** Share of the image's border pixels that are near-black: the model really painted on black (a mid strip that ignored "pure black" cannot be keyed). */
export function borderBlackShare(src: Rgba): number {
  const { data, width: w, height: h } = src;
  let n = 0, dark = 0;
  const look = (p: number) => { n++; if (maxChannel(data, p * 4) < DARK_SEED) dark++; };
  for (let x = 0; x < w; x++) { look(x); look((h - 1) * w + x); }
  for (let y = 1; y < h - 1; y++) { look(y * w); look(y * w + w - 1); }
  return n ? dark / n : 0;
}

/** The mid strip's gates: painted on black, art across (nearly) the whole width, not a speck and not a solid slab, not touching the top. */
export function gateMid(src: Rgba, keyed: KeyedMid | null): Gate {
  const reasons: string[] = [];
  if (!keyed) return { ok: false, reasons: ["no art left after keying"] };
  if (borderBlackShare(src) < 0.35) reasons.push("not painted on black");                      // (a strip sits on the ground line, so its bottom edge is art: the top and the sides are the black)
  const span = (keyed.box.x1 - keyed.box.x0 + 1) / src.width;
  if (span < 0.6) reasons.push(`art spans only ${Math.round(span * 100)}% of the width`);          // (the strips in the game span 74% to 100%; the first Junkyard cluster was 40%)
  if (keyed.opaqueShare < 0.12) reasons.push(`only ${Math.round(keyed.opaqueShare * 100)}% opaque`);
  if (keyed.opaqueShare > 0.92) reasons.push("a solid slab, not a strip of things");
  const tall = (keyed.box.y1 - keyed.box.y0 + 1) / src.height;
  if (tall < 0.15) reasons.push("too flat");
  return { ok: reasons.length === 0, reasons };
}

/** Mean lightness (0..1, Rec. 709 luma of sRGB values, not linear: only a rough band is needed), the share of near-black pixels and of near-white ones. */
export function lumaStats(src: Rgba, step = 7): { mean: number; darkShare: number; whiteShare: number; spread: number } {
  const { data } = src;
  let n = 0, sum = 0, sum2 = 0, dark = 0, white = 0;
  for (let p = 0; p < data.length; p += 4 * step) {
    const l = (0.2126 * data[p]! + 0.7152 * data[p + 1]! + 0.0722 * data[p + 2]!) / 255;
    n++; sum += l; sum2 += l * l;
    if (Math.max(data[p]!, data[p + 1]!, data[p + 2]!) < 12) dark++;
    if (Math.min(data[p]!, data[p + 1]!, data[p + 2]!) > 245) white++;
  }
  if (!n) return { mean: 0, darkShare: 1, whiteShare: 0, spread: 0 };
  const mean = sum / n;
  return { mean, darkShare: dark / n, whiteShare: white / n, spread: Math.sqrt(Math.max(0, sum2 / n - mean * mean)) };
}

/** The far band's gates (calibrated on the eight committed bands: day means 0.76 to 0.83, night 0.24 to 0.50): its brightness fits its look (a day band is light, a night band dark), it is not mostly flat black or white, and it has some variety (not one flat colour). */
export function gateFar(src: Rgba, look: LookTime): Gate {
  const reasons: string[] = [];
  if (src.width < 64 || src.height < 8) return { ok: false, reasons: ["too small"] };
  const s = lumaStats(src);
  if (look === "day" && s.mean < 0.45) reasons.push(`too dark for a day band (${s.mean.toFixed(2)})`);
  if (look === "night" && s.mean > 0.6) reasons.push(`too bright for a night band (${s.mean.toFixed(2)})`);
  if (s.darkShare > 0.45 && look === "day") reasons.push("mostly black");
  if (s.whiteShare > 0.45) reasons.push("mostly white");
  if (s.spread < 0.02) reasons.push("one flat colour");
  return { ok: reasons.length === 0, reasons };
}

/** The size an image is kept at: its own, or scaled down to `maxWidth` (never up). */
export function fitWidth(width: number, height: number, maxWidth: number): { width: number; height: number } {
  if (width <= maxWidth) return { width, height };
  return { width: maxWidth, height: Math.max(1, Math.round((height * maxWidth) / width)) };
}
