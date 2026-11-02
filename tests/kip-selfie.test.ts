import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
// The viewer modules are plain browser JS with no declaration files.
// @ts-expect-error untyped JS module
import * as selfieMod from "../parts/kip/viewer/kip-selfie.js";
// @ts-expect-error untyped JS module
import * as shapeMod from "../parts/kip/viewer/kip-faceplate-shape.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const S = selfieMod as any;
const root = process.cwd();

const at = (t: any, x: number, y: number): [number, number] => [t.a * x + t.c * y + t.e, t.b * x + t.d * y + t.f];
const rgba = (w: number, h: number, f: (x: number, y: number) => [number, number, number]) => {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = f(x, y); d.set([r, g, b, 255], (y * w + x) * 4); }
  return d;
};

describe("face plate geometry", () => {
  it("the picture covers the rounded window the viewer's selfie decal plane uses, at one scale both ways", () => {
    const wardrobe = readFileSync(join(root, "parts/kip/viewer/kip-vehicles-wardrobe.js"), "utf8");
    expect(wardrobe).toMatch(/FACEPLATE_DECAL\.width, FACEPLATE_DECAL\.height, FACEPLATE_DECAL\.centerY/);
    const manifest = JSON.parse(readFileSync(join(root, "public/kip/kip-partspec-manifest.json"), "utf8"));
    const flat = manifest.parts.find((p: any) => p.id === "char_faceplate_flat");
    expect(flat.bbox_mm[0]).toBeCloseTo(S.PLATE_MM.w, 1);
    // pixels per millimetre are the same across and down (the old 512x256 canvas was stretched 17% sideways on the plate)
    expect(S.CANVAS_PX.w / S.WINDOW_MM.w).toBeCloseTo(S.CANVAS_PX.h / S.WINDOW_MM.h, 1);
    expect(S.CANVAS_PX.w / S.WINDOW_MM.w).toBeCloseTo(S.PX_PER_MM, 1);
    expect(S.WINDOW_MM.h).toBeGreaterThan(10.1);
  });
});

describe("framing", () => {
  it("covers the frame at zoom 1 and keeps the image centre on the frame centre", () => {
    const t = S.frameTransform({ srcW: 400, srcH: 400 }, 512, 256);
    expect(t.a).toBeCloseTo(1.28, 6); // cover: the 400 px side must span 512 px
    const [cx, cy] = at(t, 200, 200);
    expect(cx).toBeCloseTo(256, 6);
    expect(cy).toBeCloseTo(128, 6);
    const id = S.frameTransform({ srcW: 512, srcH: 256 }, 512, 256);
    expect([id.a, id.b, id.c, id.d, id.e, id.f].map((v: number) => +v.toFixed(9))).toEqual([1, 0, 0, 1, 0, 0].map((v) => +v.toFixed(9)));
  });

  it("zoom scales about the centre, rotation turns about the centre, pan moves in frame-height units", () => {
    const z = S.frameTransform({ srcW: 400, srcH: 400, zoom: 2 }, 512, 256);
    expect(z.a).toBeCloseTo(2.56, 6);
    expect(at(z, 200, 200)).toEqual([expect.closeTo(256, 6), expect.closeTo(128, 6)]);
    const r = S.frameTransform({ srcW: 400, srcH: 400, rotateDeg: 90 }, 512, 256);
    const [rx, ry] = at(r, 300, 200); // 100 px right of centre -> 128 px below centre after a quarter turn
    expect(rx).toBeCloseTo(256, 5);
    expect(ry).toBeCloseTo(128 + 128, 5);
    const p = S.frameTransform({ srcW: 400, srcH: 400, panX: 0.25, panY: -0.5 }, 512, 256);
    const [px, py] = at(p, 200, 200);
    expect(px).toBeCloseTo(256 + 0.25 * 256, 6);
    expect(py).toBeCloseTo(128 - 0.5 * 256, 6);
  });

  it("clamps pan so the frame never shows beyond the photo", () => {
    // 400x400 into 512x256: the photo is 512 wide (no horizontal slack) and 512 tall (256 px of vertical slack).
    const c = S.clampPan({ srcW: 400, srcH: 400, panX: 5, panY: 2 }, 512, 256);
    expect(c.panX).toBeCloseTo(0, 9);
    expect(c.panY).toBeCloseTo(0.5, 9);
    expect(S.clampPan({ srcW: 400, srcH: 400, panY: -2 }, 512, 256).panY).toBeCloseTo(-0.5, 9);
    // zooming in opens slack on both axes
    expect(S.clampPan({ srcW: 400, srcH: 400, zoom: 2, panX: 9 }, 512, 256).panX).toBeGreaterThan(0.9);
  });
});

describe("zoom range", () => {
  it("lets a tall portrait photo zoom out to its full height and starts at about three quarters of it", () => {
    const z = S.zoomRange(720, 1280);
    expect(z.min).toBeLessThan(0.4);
    const cover = Math.max(S.CANVAS_PX.w / 720, S.CANVAS_PX.h / 1280);
    const shown = (zoom: number) => S.CANVAS_PX.h / (cover * zoom * 1280);
    expect(shown(z.min)).toBeCloseTo(1, 1);
    expect(shown(z.initial)).toBeCloseTo(0.75, 1);
  });
  it("starts a landscape webcam frame close to cover and never below its minimum", () => {
    const z = S.zoomRange(1280, 720);
    expect(z.min).toBeGreaterThan(0.85);
    expect(z.initial).toBeGreaterThanOrEqual(z.min);
    expect(z.initial).toBeLessThanOrEqual(3);
    for (const [w, h] of [[64, 64], [4000, 3000], [300, 1200]]) {
      const r = S.zoomRange(w, h);
      expect(r.min).toBeLessThanOrEqual(r.initial);
      expect(r.initial).toBeLessThanOrEqual(r.max);
    }
  });
  it("a photo smaller than the window stays centred when zoomed out", () => {
    const c = S.clampPan({ srcW: 720, srcH: 1280, zoom: 0.4, panX: 0.7, panY: 0.7 }, S.CANVAS_PX.w, S.CANVAS_PX.h);
    expect(c.panX).toBe(0);
  });
});

describe("line up eyes and mouth", () => {
  const T = shapeMod.faceTargetFractions();
  const Et = { x: S.CANVAS_PX.w * 0.5, y: S.CANVAS_PX.h * T.leftEye.y };
  const Mt = { x: S.CANVAS_PX.w * T.mouth.x, y: S.CANVAS_PX.h * T.mouth.y };
  const mapped = (srcW: number, srcH: number, f: any, p: { x: number; y: number }) => at(S.frameTransform({ srcW, srcH, ...f }, S.CANVAS_PX.w, S.CANVAS_PX.h), p.x, p.y);

  it("puts the eye midpoint and the mouth exactly on the plate's marks (a zoom, a turn and a shift: two points fix all three)", () => {
    for (const [w, h, eye, mouth] of [
      [720, 1280, { x: 360, y: 500 }, { x: 362, y: 640 }],
      [1280, 720, { x: 600, y: 300 }, { x: 612, y: 380 }],
      [800, 800, { x: 380, y: 360 }, { x: 410, y: 470 }], // a head tilted to one side
      [4000, 3000, { x: 2000, y: 1400 }, { x: 2010, y: 1560 }], // small face in a big photo (needs about 4.6x cover, inside the 8x cap)
    ] as const) {
      const f = S.alignFrame({ srcW: w, srcH: h, eye, mouth });
      const e = mapped(w, h, f, eye), m = mapped(w, h, f, mouth);
      expect(Math.hypot(e[0] - Et.x, e[1] - Et.y), `eye ${w}x${h}`).toBeLessThan(0.01);
      expect(Math.hypot(m[0] - Mt.x, m[1] - Mt.y), `mouth ${w}x${h}`).toBeLessThan(0.01);
    }
  });

  it("does not stretch: the face keeps its proportions (zoom is one number)", () => {
    const f = S.alignFrame({ srcW: 1000, srcH: 1000, eye: { x: 500, y: 400 }, mouth: { x: 500, y: 520 } });
    expect(Object.keys(f).sort()).toEqual(["panX", "panY", "rotateDeg", "zoom"]);
    expect(Math.abs(f.rotateDeg)).toBeLessThan(1e-9);
  });

  it("tilts the photo back to upright and limits the turn to the slider range", () => {
    const tilted = S.alignFrame({ srcW: 800, srcH: 800, eye: { x: 380, y: 360 }, mouth: { x: 410, y: 470 } });
    expect(tilted.rotateDeg).toBeGreaterThan(5);
    expect(tilted.rotateDeg).toBeLessThan(45);
    const upsideDown = S.alignFrame({ srcW: 800, srcH: 800, eye: { x: 400, y: 500 }, mouth: { x: 400, y: 400 } });
    expect(Math.abs(upsideDown.rotateDeg)).toBeCloseTo(45, 6);
  });

  it("caps the zoom at 8x cover and refuses two taps on the same spot", () => {
    const f = S.alignFrame({ srcW: 4000, srcH: 3000, eye: { x: 2000, y: 1500 }, mouth: { x: 2000, y: 1501 } });
    expect(f.zoom).toBeLessThanOrEqual(8 + 1e-9);
    expect(S.alignFrame({ srcW: 100, srcH: 100, eye: { x: 50, y: 50 }, mouth: { x: 50, y: 50 } })).toBeNull();
    expect(S.zoomRange(1000, 1000).max).toBe(8);
  });

  it("turns a sample face's fractional marks into source pixels", () => {
    const m = S.marksToPixels({ eyes: [{ x: 0.3, y: 0.4 }, { x: 0.5, y: 0.4 }], mouth: { x: 0.4, y: 0.7 } }, 1000, 500);
    expect(m.eye).toEqual({ x: 400, y: 200 });
    expect(m.mouth).toEqual({ x: 400, y: 350 });
  });

  it("the target marks sit on the plate: eyes above the mouth ridge, inside the window, symmetric", () => {
    expect(T.leftEye.y).toBeLessThan(T.mouth.y);
    expect(T.leftEye.x + T.rightEye.x).toBeCloseTo(1, 9);
    expect(T.mouth.y).toBeLessThan(1);
    expect(T.mouth.y).toBeGreaterThan(0.85); // the smile ridge is near the bottom of the plate
  });
});

describe("plate-shaped guide", () => {
  const parse = (svg: string) => {
    const paths = [...svg.matchAll(/<path class="(\w+)"[^>]* d="([^"]+)"/g)].map((m) => ({ cls: m[1]!, d: m[2]! }));
    return { paths, nums: (d: string) => [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0])) };
  };

  it("draws the window outline, dims the rest, marks the printed smile and the 2D art's eyes, all inside the stage", () => {
    const svg: string = S.guideMarkup();
    expect(svg).toContain('viewBox="0 0 1 1"');
    const { paths, nums } = parse(svg);
    expect(paths.map((p) => p.cls)).toEqual(["dim", "edge", "mark"]);
    for (const p of paths.filter((x) => x.cls !== "dim")) for (const n of nums(p.d)) { expect(n).toBeGreaterThanOrEqual(0); expect(n).toBeLessThanOrEqual(1); }
    expect((svg.match(/<circle class="mark"/g) ?? []).length).toBe(2);
    expect(svg).toMatch(/fill-rule="evenodd"/);
    // the dim layer is a frame with the plate cut out of it: two closed subpaths, each starting with its own M (an invalid path draws no hole)
    const dim = paths.find((p) => p.cls === "dim")!.d;
    expect((dim.match(/M/g) ?? []).length).toBe(2);
    expect((dim.match(/Z/g) ?? []).length).toBe(2);
    expect(dim).toMatch(/^M0 0H1V1H0Z M[\d.]+ [\d.]+ L/);
  });

  it("is the plate outline, not an oval: a 50% inset box scales it, and the outline has the plate's flat top and chamfered corners", () => {
    const half: string = S.guideMarkup({ left: 0.25, top: 0.25, w: 0.5, h: 0.5 });
    const edge = parse(half).paths.find((p) => p.cls === "edge")!;
    const n = parse(half).nums(edge.d);
    const xs = n.filter((_, i) => i % 2 === 0), ys = n.filter((_, i) => i % 2 === 1);
    expect(Math.min(...xs)).toBeCloseTo(0.25, 2); expect(Math.max(...xs)).toBeCloseTo(0.75, 2);
    expect(Math.min(...ys)).toBeCloseTo(0.25, 2); expect(Math.max(...ys)).toBeCloseTo(0.75, 2);
    // a flat top: two vertices share the topmost y, and they are far apart (an oval has a single topmost point)
    const top = Math.min(...ys);
    const topX = xs.filter((_, i) => Math.abs(ys[i]! - top) < 1e-3);
    expect(topX.length).toBe(2);
    expect(Math.abs(topX[0]! - topX[1]!)).toBeGreaterThan(0.2);
    // corners are cut: no point sits at both extremes of x and y
    expect(xs.some((x, i) => Math.abs(x - 0.25) < 0.005 && Math.abs(ys[i]! - 0.25) < 0.02)).toBe(false);
  });

  it("the Adjust screen is spaced and scrolls inside the card: a gap above the controls, a sticky header and a sticky action row", () => {
    const src = readFileSync(join(root, "parts/kip/viewer/kip-selfie.js"), "utf8");
    expect(src).toMatch(/\.sf-controls \{[^}]*margin-top:2\d?px[^}]*padding-top:\d+px[^}]*border-top/);
    expect(src).toMatch(/\.sf-sliders \{[^}]*grid-template-columns:1fr 1fr/);
    expect(src).toMatch(/\.modal-head \{ position:sticky/);
    expect(src).toMatch(/\.sf-actions \{ position:sticky; bottom:-18px/);
    expect(src).toMatch(/id="sf-use"/);
    expect(src).toMatch(/focus\(\{ preventScroll: true \}\)/); // focusing the main button must not scroll the picture out of view
  });

  it("the modal no longer draws any oval guide", () => {
    const src = readFileSync(join(root, "parts/kip/viewer/kip-selfie.js"), "utf8");
    expect(src).not.toMatch(/border-radius:\s*50%/);
    expect(src).not.toContain("sf-faceguide");
    expect(src).not.toMatch(/dashed oval/);
    expect(src).toMatch(/guideMarkup\(/);
  });
});

describe("sample faces", () => {
  const dir = join(root, "parts/kip/viewer/selfie-faces");
  const json = JSON.parse(readFileSync(join(dir, "faces.json"), "utf8"));
  const jpegSize = (file: string) => {
    const b = readFileSync(join(dir, file));
    for (let o = 2; o < b.length;) {
      if (b[o] !== 0xff) { o++; continue; }
      const m = b[o + 1]!;
      if (m >= 0xc0 && m <= 0xc3) return { h: b.readUInt16BE(o + 5), w: b.readUInt16BE(o + 7) };
      o += 2 + b.readUInt16BE(o + 2);
    }
    throw new Error(`no JPEG frame in ${file}`);
  };

  it("every gallery face has a picture at the window's aspect and marks that match faces.json (the build-time SAM measurement)", () => {
    expect(S.SAMPLE_FACES.length).toBe(8);
    expect(json.generator).toBe("muse-image-1.0");
    const aspect = S.WINDOW_MM.w / S.WINDOW_MM.h;
    for (const f of S.SAMPLE_FACES) {
      const meta = json.faces.find((x: any) => x.id === f.id);
      expect(meta, `faces.json has ${f.id}`).toBeTruthy();
      const { w, h } = jpegSize(f.file);
      expect(Math.abs(w / h - aspect), `${f.id} ${w}x${h} vs window aspect ${aspect.toFixed(3)}`).toBeLessThan(0.03);
      expect(f.marks.eyes[0].x).toBeCloseTo(meta.eyes[0].x, 4);
      expect(f.marks.eyes[1].y).toBeCloseTo(meta.eyes[1].y, 4);
      expect(f.marks.mouth.y).toBeCloseTo(meta.mouth.y, 4);
    }
  });

  it("the marks describe a face: left eye left of right eye, eyes above the mouth, everything inside the picture", () => {
    for (const f of S.SAMPLE_FACES) {
      const [l, r] = f.marks.eyes, m = f.marks.mouth;
      expect(l.x, f.id).toBeLessThan(r.x);
      expect(Math.abs(l.y - r.y), f.id).toBeLessThan(0.05);
      expect((l.y + r.y) / 2, f.id).toBeLessThan(m.y);
      for (const v of [l.x, l.y, r.x, r.y, m.x, m.y]) { expect(v).toBeGreaterThan(0.02); expect(v).toBeLessThan(0.98); }
    }
  });

  it("lining a sample face up puts its eye midpoint and mouth on the plate's marks, with a gentle zoom (the pictures are made for the window)", () => {
    const T = shapeMod.faceTargetFractions();
    for (const f of S.SAMPLE_FACES) {
      const w = 1120, h = 599;
      const px = S.marksToPixels(f.marks, w, h);
      const fr = S.alignFrame({ srcW: w, srcH: h, ...px });
      const tr = S.frameTransform({ srcW: w, srcH: h, ...fr }, S.CANVAS_PX.w, S.CANVAS_PX.h);
      const mouth = at(tr, px.mouth.x, px.mouth.y);
      expect(Math.abs(mouth[0] - S.CANVAS_PX.w * T.mouth.x), f.id).toBeLessThan(0.05);
      expect(Math.abs(mouth[1] - S.CANVAS_PX.h * T.mouth.y), f.id).toBeLessThan(0.05);
      expect(fr.zoom, `${f.id} zoom`).toBeGreaterThan(0.6);
      expect(fr.zoom, `${f.id} zoom`).toBeLessThan(1.8);
      expect(Math.abs(fr.rotateDeg), `${f.id} turn`).toBeLessThan(6);
    }
  });

  it("the generator script never writes or prints the API key", () => {
    const script = readFileSync(join(root, "scripts/kip-gen-faces.ts"), "utf8");
    expect(script).toMatch(/never printed or written/);
    expect(script).not.toMatch(/console\.(log|error)\([^)]*\bKEY\b/);
    expect(readFileSync(join(dir, "faces.json"), "utf8")).not.toMatch(/Bearer|MODEL_API_KEY|api_key/i);
  });
});

describe("styles", () => {
  const edgeImg = rgba(40, 20, (x) => (x < 20 ? [240, 220, 200] : [30, 40, 60]));
  const flatGrey = rgba(40, 20, () => [128, 128, 128]);

  it("never mutate the input and keep alpha", () => {
    const before = Uint8ClampedArray.from(edgeImg);
    for (const id of ["toon", "photo", "sketch"]) {
      const out = S.applyStyle(id, edgeImg, 40, 20);
      expect(out).toHaveLength(edgeImg.length);
      for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(255);
    }
    expect(Array.from(edgeImg)).toEqual(Array.from(before));
  });

  it("toon draws a dark outline on a hard edge and flattens colour elsewhere", () => {
    const out = S.styleToon(edgeImg, 40, 20);
    const px = (x: number, y: number) => out[(y * 40 + x) * 4]!;
    const nearEdge = Math.min(px(19, 10), px(20, 10));
    expect(nearEdge).toBeLessThan(60);
    // flat regions far from the edge share one band
    expect(px(3, 10)).toBe(px(8, 5));
    expect(px(35, 10)).toBe(px(30, 5));
  });

  it("sketch is white paper with ink only on edges and shadows", () => {
    const paper = S.styleSketch(flatGrey, 40, 20);
    expect(Math.min(...(Array.from(paper) as number[]).filter((_, i) => i % 4 === 0))).toBeGreaterThan(240);
    const inked = S.styleSketch(edgeImg, 40, 20) as Uint8ClampedArray;
    const lines = Array.from(inked).filter((_, i) => i % 4 === 0 && inked[i]! < 120).length;
    expect(lines).toBeGreaterThan(0);
  });

  it("photo lifts contrast around mid grey", () => {
    const out = S.stylePhoto(flatGrey, 40, 20);
    expect(out[0]).toBe(128);
    const hi = S.stylePhoto(rgba(2, 2, () => [200, 200, 200]), 2, 2);
    expect(hi[0]).toBeGreaterThan(200);
  });

  it("toon and the other styles keep a cut-out's transparency where it is given", () => {
    const alpha = new Uint8ClampedArray(40 * 20).map((_, i) => ((i % 40) < 20 ? 255 : 0));
    const out = S.applyStyle("toon", edgeImg, 40, 20, { alpha });
    for (let i = 0; i < 40 * 20; i++) expect(out[i * 4 + 3]).toBe(alpha[i]);
  });

  it("photo is the default style (first in the list, and what an unknown style means); toon and sketch are one choice away", () => {
    expect(S.STYLES.map((x: any) => x.id)).toEqual(["photo", "toon", "sketch"]);
    expect(Array.from(S.applyStyle("nope", edgeImg, 40, 20))).toEqual(Array.from(S.stylePhoto(edgeImg, 40, 20)));
    expect(Array.from(S.applyStyle("toon", edgeImg, 40, 20))).toEqual(Array.from(S.styleToon(edgeImg, 40, 20)));
    const src = readFileSync(join(root, "parts/kip/viewer/kip-selfie.js"), "utf8");
    expect(src).toMatch(/let style = 'photo'/);
    expect(src).toMatch(/\$\{s\.id === 'photo' \? ' checked' : ''\}/);
    expect((src.match(/style = 'toon'/g) ?? []).length).toBe(0); // no path resets to Toon any more
  });
});

describe("sticker export is 1:1 in millimetres", () => {
  const tinyPng = () => {
    const chunk = (type: string, data: Buffer) => {
      const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
      const body = Buffer.concat([Buffer.from(type), data]);
      const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
      return Buffer.concat([len, body, crc]);
    };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.from([0, 255, 0, 0]))), chunk("IEND", Buffer.alloc(0))]);
  };
  const chunks = (u8: Uint8Array) => {
    const out: { type: string; data: Buffer; crc: number }[] = [];
    const b = Buffer.from(u8);
    for (let o = 8; o < b.length;) { const len = b.readUInt32BE(o); out.push({ type: b.toString("latin1", o + 4, o + 8), data: b.subarray(o + 8, o + 8 + len), crc: b.readUInt32BE(o + 8 + len) }); o += 12 + len; }
    return out;
  };

  it("embeds a valid pHYs chunk right after IHDR, replacing any existing one", () => {
    const once = S.setPngDpi(tinyPng(), 600);
    const c = chunks(once);
    expect(c.map((x) => x.type)).toEqual(["IHDR", "pHYs", "IDAT", "IEND"]);
    const phys = c[1]!;
    expect(phys.data.readUInt32BE(0)).toBe(23622);
    expect(phys.data.readUInt32BE(4)).toBe(23622);
    expect(phys.data[8]).toBe(1);
    expect(phys.crc).toBe(crc32(Buffer.concat([Buffer.from("pHYs"), phys.data])));
    const twice = chunks(S.setPngDpi(once, 300));
    expect(twice.filter((x) => x.type === "pHYs")).toHaveLength(1);
    expect(twice[1]!.data.readUInt32BE(0)).toBe(Math.round(300 / 0.0254));
    expect(() => S.setPngDpi(new Uint8Array([1, 2, 3]), 600)).toThrow(/not a PNG/);
  });

  it("a 600 dpi sticker measures the window size within 0.05 mm at 100% print", () => {
    const { w, h, dpi } = S.stickerPixels();
    expect(dpi).toBe(600);
    expect(Math.abs((w / dpi) * 25.4 - S.WINDOW_MM.w)).toBeLessThan(0.05);
    expect(Math.abs((h / dpi) * 25.4 - S.WINDOW_MM.h)).toBeLessThan(0.05);
  });

  it("the SVG is in mm at the window size with a cut line that follows the rounded window", () => {
    const svg: string = S.stickerSvg({ pngDataUri: "data:image/png;base64,AAAA" });
    expect(svg).toContain(`width="${S.WINDOW_MM.w}mm"`);
    expect(svg).toContain(`height="${S.WINDOW_MM.h}mm"`);
    expect(svg).toContain(`viewBox="0 0 ${S.WINDOW_MM.w} ${S.WINDOW_MM.h}"`);
    expect(svg).toMatch(/<path id="cut-line" d="M[\d. -]+( L[\d. -]+)+ Z" fill="none"/);
    expect(svg).not.toContain("<rect");
    expect(svg).toContain("data:image/png;base64,AAAA");
  });
});

describe("privacy by construction", () => {
  it("the image maths and sticker/stencil generator modules are pure: no network, storage, workers, DOM or detection", () => {
    for (const rel of [
      "parts/kip/viewer/kip-selfie-image.js",
      "parts/kip/viewer/kip-print-stickers.js",
      "parts/kip/viewer/kip-print-stencils.js",
    ]) {
      const modSrc = readFileSync(join(root, rel), "utf8");
      const modCode = modSrc.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
      for (const banned of [/\bfetch\s*\(/, /XMLHttpRequest/, /sendBeacon/, /WebSocket/, /localStorage/, /sessionStorage/, /indexedDB/, /caches\./, /document\./, /window\./, /new Worker/, /FaceDetector/, /\bimport\(/, /navigator\./]) {
        expect(modCode, `${rel}: ${String(banned)}`).not.toMatch(banned);
      }
    }
    const imgOnly = readFileSync(join(root, "parts/kip/viewer/kip-selfie-image.js"), "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
    expect(imgOnly).not.toMatch(/\bimport\b/);
  });

  const src = readFileSync(join(root, "parts/kip/viewer/kip-selfie.js"), "utf8");
  const code = src.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n"); // ignore the comment header that names what is forbidden

  it("the module never reaches the network, storage, workers or the URL", () => {
    for (const banned of [/\bfetch\s*\(/, /XMLHttpRequest/, /sendBeacon/, /WebSocket/, /localStorage/, /sessionStorage/, /indexedDB/, /caches\./, /document\.cookie/, /new Worker/, /location\.(hash|search|href)\s*=/, /history\.(push|replace)State/, /api\/scan/, /trySamScanEndpoint/]) {
      expect(code, String(banned)).not.toMatch(banned);
    }
  });

  it("the camera only starts from a tap on a labelled button", () => {
    expect(code).toMatch(/\$\('sf-start'\)\.addEventListener\('click', startCamera\)/);
    expect((code.match(/\bgum\(\)/g) ?? []).length).toBe(1); // capture has exactly one call site...
    expect(code).toMatch(/async function startCamera\(\) \{\s*setError\(''\);\s*try \{\s*stream = await gum\(\)/); // ...inside startCamera...
    expect((code.match(/\bstartCamera\b/g) ?? []).length).toBe(2); // ...which is only the definition and the click wiring
    expect(src).toContain("Start camera");
  });

  it("the shared SDK keeps the canvas in memory and exposes no way to serialise it", () => {
    const sdk = readFileSync(join(root, "parts/kip/viewer/kip-forge-sdk.js"), "utf8");
    expect(sdk).toMatch(/let selfieCanvas = null/);
    expect(sdk).not.toMatch(/selfieCanvas[^;\n]*(toDataURL|toBlob)/);
  });
});

describe("prompt-a-face gallery", () => {
  it("matches plain words to the right face", () => {
    expect(S.matchPrompt("a brave knight")?.face.id).toBe("knight");
    expect(S.matchPrompt("PIRATE")?.face.id).toBe("pirate");
    expect(S.matchPrompt("robot")?.face.id).toBe("robot");
    expect(S.matchPrompt("kitty")?.face.id).toBe("cat");
    expect(S.matchPrompt("spaceman")?.face.id).toBe("astronaut");
    expect(S.matchPrompt("circus clown")?.face.id).toBe("clown");
    expect(S.matchPrompt("green monster")?.face.id).toBe("monster");
    expect(S.matchPrompt("super hero")?.face.id).toBe("superhero");
  });

  it("returns null for empty or unmatched prompts", () => {
    expect(S.matchPrompt("")).toBeNull();
    expect(S.matchPrompt("   ")).toBeNull();
    expect(S.matchPrompt("dragon")).toBeNull();
    expect(S.matchPrompt("a fast car")).toBeNull();
  });

  it("breaks keyword ties in gallery order", () => {
    // both astronaut and knight list "helmet"; astronaut comes first
    expect(S.matchPrompt("helmet")?.face.id).toBe("astronaut");
  });

  it("every gallery face ships its picture with keywords", () => {
    const faces = S.SAMPLE_FACES;
    expect(faces.length).toBeGreaterThanOrEqual(8);
    expect(new Set(faces.map((f: any) => f.id)).size).toBe(faces.length);
    expect(new Set(faces.map((f: any) => f.label)).size).toBe(faces.length);
    for (const f of faces) {
      expect(f.keywords.length).toBeGreaterThan(3);
      expect(existsSync(join(root, "parts/kip/viewer/selfie-faces", f.file))).toBe(true);
    }
  });

  it("the modal offers the prompt box on the intro step", () => {
    const src = readFileSync(join(root, "parts/kip/viewer/kip-selfie.js"), "utf8");
    expect(src).toContain('id="sf-prompt"');
    expect(src).toMatch(/\$\('sf-prompt-go'\)\.addEventListener\('click'/);
    expect(src).toMatch(/\$\('sf-prompt-row'\)\.hidden = step !== 'intro'/);
  });
});
