import { describe, expect, it } from "vitest";
// @ts-expect-error untyped JS module
import * as img from "../parts/kip/viewer/kip-selfie-image.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const { removeBackground, plainBackgroundAlpha, toon, kmeans, morph } = img as any;

// ---- synthetic portraits (cartoon heads on invented backgrounds: no real person's photo is used) --------------------
type Rgb = [number, number, number];
function lcg(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

/** truth: 1 = head/ears/neck (the subject), 2 = shirt (ignored when scoring), 0 = background. */
function scene(w: number, h: number, bg: (x: number, y: number, w: number, h: number) => Rgb, zoom = 1) {
  const rnd = lcg(7);
  const px = new Uint8ClampedArray(w * h * 4);
  const truth = new Uint8Array(w * h);
  const skin: Rgb = [224, 172, 140], hair: Rgb = [58, 38, 28], shirt: Rgb = [60, 110, 190];
  const cx = w * 0.5, cy = h * 0.5, ry = h * 0.43 * zoom, rx = ry * 0.78;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, o = i * 4;
    let c: Rgb = bg(x, y, w, h);
    let inside = 0;
    if (y > cy + ry * 0.85 && Math.abs(x - cx) < rx * 2.2 - (y - cy - ry * 0.85) * 0.3) { c = shirt; inside = 2; }
    if (y > cy + ry * 0.6 && Math.abs(x - cx) < rx * 0.35) { c = skin.map((v) => v * 0.92) as Rgb; inside = 1; }
    const dx = (x - cx) / rx, dy = (y - cy) / ry, d = dx * dx + dy * dy;
    if (d < 1) {
      inside = 1;
      const shade = 1 - 0.18 * (dx * 0.6 + dy * 0.4 + 0.3) * d;
      c = skin.map((v) => v * shade) as Rgb;
      if (dy < -0.35 + 0.25 * dx * dx) c = hair;
      for (const ex of [-0.38, 0.38]) {
        if (((dx - ex) / 0.16) ** 2 + ((dy + 0.02) / 0.09) ** 2 < 1) c = [250, 250, 250];
        if (((dx - ex) / 0.07) ** 2 + ((dy + 0.02) / 0.09) ** 2 < 1) c = [30, 24, 22];
        if (Math.abs(dy + 0.2) < 0.03 && Math.abs(dx - ex) < 0.2) c = hair;
      }
      if (Math.abs(dy - 0.45 - 0.08 * dx * dx) < 0.035 && Math.abs(dx) < 0.28) c = [170, 60, 70];
    }
    for (const s of [-1, 1]) if (((x - (cx + s * rx * 1.02)) / (rx * 0.13)) ** 2 + ((y - cy) / (ry * 0.2)) ** 2 < 1) { c = skin.map((v) => v * 0.95) as Rgb; inside = 1; }
    px[o] = c[0] + (rnd() - 0.5) * 8; px[o + 1] = c[1] + (rnd() - 0.5) * 8; px[o + 2] = c[2] + (rnd() - 0.5) * 8; px[o + 3] = 255;
    truth[i] = inside;
  }
  return { px, truth };
}

const BACKGROUNDS = {
  plain: () => [235, 235, 238] as Rgb,
  gradient: (x: number, y: number, w: number, h: number): Rgb => [60 + (x / w) * 120, 90 + (y / h) * 80, 160 - (x / w) * 60],
  room: (x: number, y: number, w: number): Rgb => (x < w * 0.18 ? [150, 110, 70] : x > w * 0.84 ? [40, 90, 60] : (((x / 24) | 0) + ((y / 24) | 0)) % 2 ? [190, 190, 196] : [168, 170, 178]),
  dark: () => [20, 22, 30] as Rgb,
  warmWall: () => [214, 164, 130] as Rgb, // close to the skin tone: the hard case
} satisfies Record<string, (x: number, y: number, w: number, h: number) => Rgb>;

function iou(alpha: Uint8ClampedArray, truth: Uint8Array) {
  let i = 0, u = 0;
  for (let k = 0; k < truth.length; k++) {
    if (truth[k] === 2) continue;
    const a = (alpha[k] ?? 0) > 127 ? 1 : 0, t = truth[k] === 1 ? 1 : 0;
    if (a && t) i++;
    if (a || t) u++;
  }
  return i / u;
}

function blobs(alpha: Uint8ClampedArray, w: number, h: number, on: boolean) {
  const seen = new Uint8Array(alpha.length);
  const out: { size: number; touchesEdge: boolean }[] = [];
  for (let s = 0; s < alpha.length; s++) {
    if (seen[s] || ((alpha[s] ?? 0) > 127) !== on) continue;
    let size = 0, touchesEdge = false;
    const stack = [s]; seen[s] = 1;
    while (stack.length) {
      const i = stack.pop() as number; size++;
      const x = i % w, y = (i / w) | 0;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesEdge = true;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j >= 0 && !seen[j] && ((alpha[j] ?? 0) > 127) === on) { seen[j] = 1; stack.push(j); }
      }
    }
    out.push({ size, touchesEdge });
  }
  return out;
}

const W = 440, H = 260;

describe("selfie background removal", { timeout: 120000 }, () => {
  for (const [name, min] of [["plain", 0.95], ["gradient", 0.95], ["room", 0.95], ["dark", 0.95], ["warmWall", 0.88]] as const) {
    it(`cuts the head out of a ${name} background (IoU >= ${min})`, () => {
      const { px, truth } = scene(W, H, BACKGROUNDS[name]);
      const alpha = removeBackground(px, W, H);
      expect(alpha).toBeInstanceOf(Uint8ClampedArray);
      expect(alpha.length).toBe(W * H);
      expect(iou(alpha, truth)).toBeGreaterThanOrEqual(min);
    });
  }

  it("returns one solid blob: no loose specks, no holes", () => {
    const { px } = scene(W, H, BACKGROUNDS.room);
    const alpha = removeBackground(px, W, H);
    const on = blobs(alpha, W, H, true);
    expect(on.length).toBe(1);
    const holes = blobs(alpha, W, H, false).filter((b) => !b.touchesEdge);
    expect(holes).toEqual([]);
  });

  it("cuts a cartoon on a flat colour exactly, even where the subject is as pale as the backdrop (a white helmet with a dark outline)", () => {
    // pastel backdrop, a dark-outlined head whose fill is near white: the colour model would call the fill background
    const w = 440, h = 260;
    const px = new Uint8ClampedArray(w * h * 4);
    const truth = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const dx = (x - w / 2) / 150, dy = (y - h / 2) / 112, d = dx * dx + dy * dy;
      let c: Rgb = [228, 220, 255]; // backdrop
      if (d < 1) { c = d > 0.9 ? [20, 30, 90] : [250, 250, 252]; truth[y * w + x] = 1; } // outline ring, then a near-white fill
      if (d < 0.5 && Math.abs(dx) < 0.3 && Math.abs(dy) < 0.15) c = [240, 170, 90];
      px.set([...c, 255], o);
    }
    const a = plainBackgroundAlpha(px, w, h, 0.5);
    expect(a).not.toBeNull();
    expect(iou(a, truth)).toBeGreaterThan(0.97);
    // the white fill inside the outline is kept
    expect(a[(h / 2 + 60) * w + w / 2 - 40]).toBe(255);
    // and the public entry point takes the same path
    expect(iou(removeBackground(px, w, h), truth)).toBeGreaterThan(0.97);
  });

  it("cuts a face that fills the frame and touches all four edges, where only the corners show the backdrop", () => {
    const w = 440, h = 260;
    const px = new Uint8ClampedArray(w * h * 4);
    const truth = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = (x - w / 2) / 235, dy = (y - h / 2) / 150, d = dx * dx + dy * dy; // wider and taller than the frame
      const c: Rgb = d < 1 ? (d > 0.93 ? [40, 20, 20] : [245, 190, 160]) : [225, 240, 255];
      px.set([...c, 255], (y * w + x) * 4);
      truth[y * w + x] = d < 1 ? 1 : 0;
    }
    const a = plainBackgroundAlpha(px, w, h, 0.5);
    expect(a).not.toBeNull();
    expect(iou(a, truth)).toBeGreaterThan(0.97);
    expect(a[0]).toBe(0); expect(a[w - 1]).toBe(0); expect(a[(h - 1) * w]).toBe(0); expect(a[h * w - 1]).toBe(0); // all four corners cut
    expect(a[(h / 2) * w + w / 2]).toBe(255);
  });

  it("is quick enough to run on every adjustment of a window-sized frame", () => {
    const w = 510, h = 273;
    const px = new Uint8ClampedArray(w * h * 4).fill(255);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const dx = (x - w / 2) / 160, dy = (y - h / 2) / 110; if (dx * dx + dy * dy < 1) px.set([210, 140, 120, 255], (y * w + x) * 4); }
    const t0 = performance.now();
    plainBackgroundAlpha(px, w, h, 0.5);
    expect(performance.now() - t0).toBeLessThan(2500);
  });

  it("leaves a non-uniform backdrop, or a subject that matches the backdrop, to the colour model", () => {
    const { px } = scene(W, H, BACKGROUNDS.gradient);
    expect(plainBackgroundAlpha(px, W, H, 0.5)).toBeNull();
    const { px: wall } = scene(W, H, BACKGROUNDS.warmWall);
    const a = removeBackground(wall, W, H); // either path, but it must still find the head
    expect(a.reduce((n: number, v: number) => n + (v > 127 ? 1 : 0), 0)).toBeGreaterThan(W * H * 0.08);
  });

  it("tightness moves the edge inward and outward", () => {
    const { px } = scene(W, H, BACKGROUNDS.gradient);
    const area = (a: Uint8ClampedArray) => a.reduce((n, v) => n + (v > 127 ? 1 : 0), 0);
    const loose = area(removeBackground(px, W, H, { tightness: 0.2 }));
    const mid = area(removeBackground(px, W, H, { tightness: 0.5 }));
    const tight = area(removeBackground(px, W, H, { tightness: 0.8 }));
    expect(loose).toBeGreaterThanOrEqual(mid);
    expect(mid).toBeGreaterThanOrEqual(tight);
  });

  it("still finds a face that fills the frame and runs off the edges", () => {
    const { px, truth } = scene(W, H, BACKGROUNDS.plain, 1.35);
    const alpha = removeBackground(px, W, H);
    expect(iou(alpha, truth)).toBeGreaterThan(0.8);
  });

  it("is deterministic", () => {
    const { px } = scene(W, H, BACKGROUNDS.room);
    const a = removeBackground(px, W, H), b = removeBackground(px, W, H);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it("does not throw on tiny or flat input", () => {
    expect(removeBackground(new Uint8ClampedArray(4 * 4 * 4).fill(128), 4, 4)).toHaveLength(16);
    expect(removeBackground(new Uint8ClampedArray(W * H * 4).fill(200), W, H)).toHaveLength(W * H);
  });

  it("finishes a window-sized frame in a few seconds even on a loaded machine", () => {
    const { px } = scene(W, H, BACKGROUNDS.gradient);
    const t0 = performance.now();
    removeBackground(px, W, H);
    expect(performance.now() - t0).toBeLessThan(4000);
  });
});

describe("selfie toon", { timeout: 120000 }, () => {
  const { px } = scene(W, H, BACKGROUNDS.gradient);
  const alpha = removeBackground(px, W, H);

  it("flattens the face to a small palette plus ink, and keeps the cut-out's alpha", () => {
    const out = toon(px, W, H, { alpha, ppm: W / 23.6, colors: 6 });
    const colours = new Set<number>();
    for (let i = 0; i < W * H; i++) {
      expect(out[i * 4 + 3]).toBe(alpha[i]);
      if (alpha[i] > 100) colours.add((out[i * 4] << 16) | (out[i * 4 + 1] << 8) | out[i * 4 + 2]);
    }
    expect(colours.size).toBeLessThanOrEqual(7); // 6 palette colours + ink
    expect(colours.size).toBeGreaterThanOrEqual(3);
  });

  it("draws an outline of printable width and not a blob", () => {
    const ppm = W / 23.6;
    const out = toon(px, W, H, { alpha, ppm });
    let ink = 0, subject = 0;
    for (let i = 0; i < W * H; i++) {
      if (alpha[i] <= 100) continue;
      subject++;
      if (out[i * 4] === 38 && out[i * 4 + 1] === 24 && out[i * 4 + 2] === 20) ink++;
    }
    expect(ink / subject).toBeGreaterThan(0.01);
    expect(ink / subject).toBeLessThan(0.2);
  });

  it("is deterministic and leaves the background transparent", () => {
    const a = toon(px, W, H, { alpha, ppm: 18 }), b = toon(px, W, H, { alpha, ppm: 18 });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    for (let i = 0; i < W * H; i++) if (alpha[i] === 0) expect(a[i * 4 + 3]).toBe(0);
  });

  it("works without a cut-out too", () => {
    const out = toon(px, W, H, { ppm: 18 });
    expect(out).toHaveLength(px.length);
    expect(out[3]).toBe(255);
  });
});

describe("selfie image helpers", () => {
  it("k-means finds the two obvious clusters", () => {
    const pts = new Float32Array(200 * 3);
    for (let i = 0; i < 200; i++) { const off = i < 100 ? 0 : 60; pts[i * 3] = off + (i % 7); pts[i * 3 + 1] = off - (i % 5); pts[i * 3 + 2] = off + (i % 3); }
    const m = kmeans(pts, 200, 2, 8);
    const l = [m.cen[0], m.cen[3]].sort((a: number, b: number) => a - b);
    expect(l[0]).toBeLessThan(10);
    expect(l[1]).toBeGreaterThan(50);
  });

  it("morphological open removes a speck and close fills a pinhole", () => {
    const w = 12, h = 12;
    const speck = new Uint8Array(w * h); speck[5 * w + 5] = 1;
    expect(morph(speck, w, h, 1, false).reduce((a: number, b: number) => a + b, 0)).toBe(0);
    const block = new Uint8Array(w * h).fill(1); block[5 * w + 5] = 0;
    expect(morph(block, w, h, 1, true)[5 * w + 5]).toBe(1);
  });
});
