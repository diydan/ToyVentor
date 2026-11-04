// runtime/lookArt.ts: the pure pixel rules of generated worlds. The mid strip's key-and-crop is a TypeScript port of scripts/make-backdrops.py; it is checked here on the committed raw art against the numbers
// that script gives (the reference values below were computed with its own `surround_mask` on each raw file) and against the asset it baked, so the two cannot drift.
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { DARK_FRINGE, borderBlackShare, fitWidth, gateFar, gateMid, keyMid, lumaStats, surroundMask, type Rgba } from "../src/features/game/world/runtime/lookArt";

const root = new URL("..", import.meta.url).pathname;
const RAW = `${root}docs/mockups/generated-backdrops/worlds/`;
const BAKED = `${root}src/features/game/world/runtime/assets/`;

/** An RGBA image from a per-pixel function returning [r, g, b] (alpha 255). */
function make(w: number, h: number, f: (x: number, y: number) => [number, number, number]): Rgba {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = f(x, y); const p = (y * w + x) * 4; data[p] = r; data[p + 1] = g; data[p + 2] = b; data[p + 3] = 255; }
  return { data, width: w, height: h };
}
const px = (im: Rgba, x: number, y: number) => { const p = (y * im.width + x) * 4; return [im.data[p]!, im.data[p + 1]!, im.data[p + 2]!, im.data[p + 3]!]; };
const ART: [number, number, number] = [200, 120, 60];
/** A black picture with a coloured block. */
const block = (w: number, h: number, x0: number, y0: number, x1: number, y1: number) => make(w, h, (x, y) => (x >= x0 && x <= x1 && y >= y0 && y <= y1 ? ART : [0, 0, 0]));

describe("surroundMask", () => {
  it("floods the black from the border and leaves the art, and a black hole INSIDE the art survives", () => {
    const im = make(40, 20, (x, y) => (x >= 5 && x <= 34 && y >= 3 && y <= 16 ? ((x >= 15 && x <= 24 && y >= 7 && y <= 12) ? [0, 0, 0] : ART) : [0, 0, 0]));
    const m = surroundMask(im);
    expect(m[0]).toBe(1);
    expect(m[10 * 40 + 2]).toBe(1);
    expect(m[10 * 40 + 20]).toBe(0);                                           // the hole in the middle of the art is NOT surround
    expect(m[5 * 40 + 8]).toBe(0);
  });
  it("eats two rings of dark fringe next to the surround, only where the pixel is dark-ish, and no more", () => {
    const dim: [number, number, number] = [DARK_FRINGE - 10, 0, 0], bright: [number, number, number] = [DARK_FRINGE + 40, 0, 0];
    const im = make(30, 5, (x) => (x < 10 ? [0, 0, 0] : x < 13 ? dim : ART));  // black | three columns of dim fringe | art
    const m = surroundMask(im);
    expect([m[10]!, m[11]!, m[12]!, m[13]!]).toEqual([1, 1, 0, 0]);            // two rings eaten, the third dim column stays, the art stays
    const keep = make(30, 5, (x) => (x < 10 ? [0, 0, 0] : x < 12 ? bright : ART));
    expect(surroundMask(keep)[10]).toBe(0);                                    // bright edge pixels are art, not fringe
  });
});

describe("keyMid", () => {
  it("crops to the art, reports where it was and how much of the crop is art", () => {
    const k = keyMid(block(100, 40, 10, 8, 89, 31))!;
    expect(k.box).toEqual({ x0: 10, y0: 8, x1: 89, y1: 31 });
    expect([k.image.width, k.image.height]).toEqual([80, 24]);
    expect(k.opaqueShare).toBe(1);
    expect(k.source).toEqual({ width: 100, height: 40 });
  });
  it("makes the edge soft (alpha between 0 and 255) and the inside solid", () => {
    const k = keyMid(make(60, 30, (x, y) => (Math.hypot(x - 30, y - 15) < 11 ? ART : [0, 0, 0])))!;
    const a = (x: number, y: number) => px(k.image, x, y)[3]!;
    expect(a(Math.floor(k.image.width / 2), Math.floor(k.image.height / 2))).toBe(255);
    const edge = [...Array(k.image.width).keys()].map((x) => a(x, 0));
    expect(edge.some((v) => v > 0 && v < 255)).toBe(true);
    expect(k.opaqueShare).toBeLessThan(1);
  });
  it("gives the transparent pixels the colour of the nearest art, not black, so a filtered edge fades to the art", () => {
    const k = keyMid(make(60, 30, (x, y) => (Math.hypot(x - 30, y - 15) < 11 ? ART : [0, 0, 0])))!;
    const [r, g, b, a] = px(k.image, 0, 0);                                    // a corner of the crop: transparent, but bled
    expect(a).toBeLessThan(40);
    expect([r, g, b]).not.toEqual([0, 0, 0]);
    expect(Math.abs(r! - ART[0])).toBeLessThan(30);
  });
  it("returns null for a picture with no art, one that is not big enough, or no usable data", () => {
    expect(keyMid(make(50, 20, () => [0, 0, 0]))).toBeNull();
    expect(keyMid({ data: new Uint8ClampedArray(16), width: 2, height: 2 })).toBeNull();
    expect(keyMid({ data: new Uint8ClampedArray(4), width: 50, height: 20 })).toBeNull();
  });
  it("art that touches the picture's edge is still art (a strip sits on the ground line)", () => {
    const k = keyMid(make(80, 30, (x, y) => (y >= 15 ? ART : [0, 0, 0])))!;
    expect(k.box).toEqual({ x0: 0, y0: 15, x1: 79, y1: 29 });
  });
});

describe("gateMid", () => {
  /** A strip of separate things (blocks with gaps), spanning x0 to x1: what a real mid strip is, not one solid slab. */
  const strip = (x0: number, x1: number, y0 = 12, y1 = 39) => make(400, 50, (x, y) => (x >= x0 && x <= x1 && y >= y0 && y <= y1 && (x - x0) % 40 < 26 ? ART : [0, 0, 0]));
  const gate = (im: Rgba) => gateMid(im, keyMid(im));
  it("passes a strip painted on black that spans the width", () => { expect(gate(strip(5, 394))).toEqual({ ok: true, reasons: [] }); });
  it("fails a picture that was not painted on black (the model ignored the instruction)", () => {
    const g = gate(make(400, 50, (x) => [30 + (x % 200), 90, 120]));
    expect(g.ok).toBe(false);
    expect(g.reasons.join(" ")).toMatch(/black/);
  });
  it("fails art that covers only a part of the width (one cluster, as the first Junkyard strip was)", () => {
    const g = gate(strip(150, 250));
    expect(g.ok).toBe(false);
    expect(g.reasons.join(" ")).toMatch(/spans only/);
  });
  it("fails a solid slab (no gaps at all is not a strip of things)", () => { expect(gate(block(400, 50, 5, 12, 394, 39)).reasons.join(" ")).toMatch(/slab/); });
  it("fails a speck, a flat sliver, and no art at all", () => {
    expect(gate(make(400, 50, (x, y) => (x > 5 && x < 395 && y === 30 ? ART : [0, 0, 0]))).ok).toBe(false);
    expect(gateMid(make(100, 20, () => [0, 0, 0]), null).reasons).toEqual(["no art left after keying"]);
  });
  it("borderBlackShare counts only the border", () => {
    expect(borderBlackShare(strip(50, 350))).toBeGreaterThan(0.9);
    expect(borderBlackShare(make(40, 40, () => ART))).toBe(0);
  });
});

describe("gateFar", () => {
  const sky = (r: number, g: number, b: number) => make(200, 30, (x, y) => [r + (x % 40), g + (y % 25), b + (x % 20)]);
  it("a day band is light and a night band is dark", () => {
    expect(gateFar(sky(150, 190, 235), "day").ok).toBe(true);
    expect(gateFar(sky(10, 14, 50), "night").ok).toBe(true);
    expect(gateFar(sky(120, 120, 150), "night").ok).toBe(true);                                         // (Snow Peak's night band, with its aurora, is as bright as 0.50)
    expect(gateFar(sky(10, 14, 50), "day").reasons.join(" ")).toMatch(/too dark/);
    expect(gateFar(sky(190, 200, 240), "night").reasons.join(" ")).toMatch(/too bright/);
  });
  it("refuses a flat colour, a mostly white picture and an image that is too small", () => {
    expect(gateFar(make(200, 30, () => [120, 150, 200]), "day").reasons.join(" ")).toMatch(/flat/);
    expect(gateFar(make(200, 30, () => [255, 255, 255]), "day").ok).toBe(false);
    expect(gateFar(make(10, 3, () => [120, 150, 200]), "day")).toEqual({ ok: false, reasons: ["too small"] });
  });
  it("lumaStats and fitWidth", () => {
    expect(lumaStats(make(10, 10, () => [255, 255, 255])).whiteShare).toBe(1);
    expect(lumaStats(make(10, 10, () => [0, 0, 0])).darkShare).toBe(1);
    expect(fitWidth(4480, 560, 2048)).toEqual({ width: 2048, height: 256 });
    expect(fitWidth(1000, 100, 2048)).toEqual({ width: 1000, height: 100 });
  });
});

describe("the port against scripts/make-backdrops.py on the committed raw art", () => {
  // computed with make-backdrops.py's surround_mask on each raw file: [name, x0, x1, y0, y1, opaque share of the crop]
  const REF: Array<[string, number, number, number, number, number]> = [
    ["junk-mid", 27, 4397, 34, 546, 0.3532], ["sky-mid", 0, 4479, 195, 559, 0.7151], ["beach-mid", 465, 3795, 227, 537, 0.6201], ["snow-mid", 528, 3869, 261, 559, 0.586],
  ];
  const decode = async (file: string): Promise<Rgba> => {
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
  };
  for (const [name, x0, x1, y0, y1, share] of REF) {
    it(`${name}: the same crop box and the same opaque share as the Python bake`, async () => {
      const k = keyMid(await decode(`${RAW}${name}.webp`))!;
      expect(Math.abs(k.box.x0 - x0)).toBeLessThanOrEqual(2);
      expect(Math.abs(k.box.x1 - x1)).toBeLessThanOrEqual(2);
      expect(Math.abs(k.box.y0 - y0)).toBeLessThanOrEqual(2);
      expect(Math.abs(k.box.y1 - y1)).toBeLessThanOrEqual(2);
      expect(Math.abs(k.opaqueShare - share)).toBeLessThan(0.004);
    }, 60_000);
  }
  it("junk-mid: the cut-out matches the asset the Python script baked (same size, alpha within 3 of 255, colour within webp's loss)", async () => {
    const k = keyMid(await decode(`${RAW}junk-mid.webp`))!;
    const baked = await decode(`${BAKED}junk-mid.webp`);
    expect([k.image.width, k.image.height]).toEqual([baked.width, baked.height]);
    let da = 0, dc = 0, n = 0, opaque = 0;
    for (let i = 0; i < baked.width * baked.height; i += 3) {
      da += Math.abs(k.image.data[i * 4 + 3]! - baked.data[i * 4 + 3]!);
      if (baked.data[i * 4 + 3]! === 255) { opaque++; dc += (Math.abs(k.image.data[i * 4]! - baked.data[i * 4]!) + Math.abs(k.image.data[i * 4 + 1]! - baked.data[i * 4 + 1]!) + Math.abs(k.image.data[i * 4 + 2]! - baked.data[i * 4 + 2]!)) / 3; }
      n++;
    }
    expect(da / n).toBeLessThan(3);
    expect(dc / Math.max(1, opaque)).toBeLessThan(7);
  }, 120_000);
  it("all four committed strips pass the mid gate; keying a 2.5 MP strip takes well under five seconds", async () => {
    for (const [name] of REF) {
      const src = await decode(`${RAW}${name}.webp`);
      const t0 = Date.now();
      const g = gateMid(src, keyMid(src));
      expect(g, name).toEqual({ ok: true, reasons: [] });
      expect(Date.now() - t0, `${name} took ${Date.now() - t0} ms`).toBeLessThan(5000);
    }
  }, 120_000);
  it("the committed far bands pass the far gate in their look", async () => {
    for (const [file, look] of [["sky-far-day", "day"], ["sky-far-night", "night"], ["beach-far-day", "day"], ["beach-far-night", "night"], ["snow-far-day", "day"], ["snow-far-night", "night"], ["junk-far-day", "day"], ["junk-far-night", "night"]] as const) {
      const src = await decode(`${RAW}${file}.webp`);
      expect(gateFar(src, look), file).toEqual({ ok: true, reasons: [] });
    }
  }, 120_000);
});
