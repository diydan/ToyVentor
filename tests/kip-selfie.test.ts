import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
// The viewer modules are plain browser JS with no declaration files.
// @ts-expect-error untyped JS module
import * as selfieMod from "../parts/kip/viewer/kip-selfie.js";

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
  it("the window matches what the viewer's conformal face decal uses, and the plate is the catalog part", () => {
    expect(S.WINDOW_MM).toEqual({ w: 23.6, h: 10.1 });
    const wardrobe = readFileSync(join(root, "parts/kip/viewer/kip-vehicles-wardrobe.js"), "utf8");
    expect(wardrobe).toMatch(/buildConformalFaceplateDecalGeo\(insertGeo, width = 23\.6, height = 10\.1/);
    const manifest = JSON.parse(readFileSync(join(root, "public/kip/kip-partspec-manifest.json"), "utf8"));
    const flat = manifest.parts.find((p: any) => p.id === "char_faceplate_flat");
    expect(flat.bbox_mm.slice(0, 2)).toEqual([S.PLATE_MM.w, S.PLATE_MM.h]);
    expect(S.CANVAS_PX).toEqual({ w: 512, h: 256 });
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

  it("toon is the default style", () => {
    expect(S.STYLES[0].id).toBe("toon");
    expect(Array.from(S.applyStyle("nope", edgeImg, 40, 20))).toEqual(Array.from(S.styleToon(edgeImg, 40, 20)));
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

  it("the SVG is in mm at the window size with a cut line", () => {
    const svg: string = S.stickerSvg({ pngDataUri: "data:image/png;base64,AAAA" });
    expect(svg).toContain('width="23.6mm"');
    expect(svg).toContain('height="10.1mm"');
    expect(svg).toContain('viewBox="0 0 23.6 10.1"');
    expect(svg).toContain('id="cut-line"');
    expect(svg).toContain("data:image/png;base64,AAAA");
  });
});

describe("privacy by construction", () => {
  it("the sticker generator module is pure: no network, storage, workers, DOM or detection", () => {
    for (const rel of ["parts/kip/viewer/kip-print-stickers.js"]) {
      const modSrc = readFileSync(join(root, rel), "utf8");
      const modCode = modSrc.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
      for (const banned of [/\bfetch\s*\(/, /XMLHttpRequest/, /sendBeacon/, /WebSocket/, /localStorage/, /sessionStorage/, /indexedDB/, /caches\./, /document\./, /window\./, /new Worker/, /FaceDetector/, /\bimport\(/, /navigator\./]) {
        expect(modCode, `${rel}: ${String(banned)}`).not.toMatch(banned);
      }
    }
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
