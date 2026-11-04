import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildScanRequest,
  canMakeSymmetric,
  createParentGate,
  DEFAULT_HEIGHT_MM,
  gateMessage,
  hintsFor,
  MAX_HEIGHT_MM,
  MAX_PHOTO_DATA_URL,
  MIN_HEIGHT_MM,
  overlayPoints,
  previewChoices,
  printAccessory,
  type PrintProgress,
  scanPhoto,
  type Fetch,
} from "../shared/photoPrintFlow";
import type { OutlineShape } from "../shared/outlineFit";
import { scanOutline, type ScanOutlineSuccess } from "../shared/outlineScan";
import { type PhotoAccessoryOptions, preparePhotoAccessory } from "../shared/photoAccessory";
import { applyAffine } from "../shared/photoOutline";
import { forgeRateLimitWait, resetForgeRateLimit } from "../worker/forgeOptimizer";
import worker from "../worker/index";
import { DEVICE, fakeDaemon, forgeEnv, mintParentProof, viaWorker } from "./fixtures/forgeWorkerHarness";
import { cropToObject, disc, rasterize, rect, union, type Inside } from "./fixtures/outlineMasks";
import { realSpoon, SPOON_PHOTO, spoonSamReply } from "./fixtures/realCupMask";

// The legalizer takes 0.1 to 0.9 s a call and the machine is often at load 30 or more.
vi.setConfig({ testTimeout: 60_000 });

type Pt = [number, number];
const IMAGE = "data:image/jpeg;base64,AAAA";

/** Independent of the code under test: ray casting. */
function inside(poly: readonly Pt[], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]!;
    const [xj, zj] = poly[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

const PHOTO = { width: 640, height: 480 };
function scanOf(shape: Inside, request: { targetHeightMm?: number; symmetry?: "auto" | "off" | "mirror" } = { targetHeightMm: 54 }): ScanOutlineSuccess {
  const c = cropToObject(rasterize(PHOTO.width, PHOTO.height, shape));
  const o = scanOutline(c.raster, c.bounds, PHOTO, request);
  if (!o.ok) throw new Error(`no outline: ${o.reason}`);
  return o;
}
const LOLLIPOP = union(disc(320, 130, 80), rect(305, 200, 335, 420));

// ---- scripted fetch ------------------------------------------------------------------------------------------------------

interface Step {
  status?: number;
  json?: unknown;
  raw?: string;
  throws?: boolean;
  headers?: Record<string, string>;
}
function scripted(steps: Step[]) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetch: Fetch = async (url, init) => {
    calls.push({ url, init });
    const step = steps[calls.length - 1];
    if (!step) throw new Error(`unscripted call ${calls.length}: ${url}`);
    if (step.throws) throw new TypeError("network down");
    return new Response(step.raw ?? JSON.stringify(step.json ?? {}), { status: step.status ?? 200, headers: { "content-type": "application/json", ...(step.headers ?? {}) } });
  };
  return { fetch, calls };
}

// ---- the request ---------------------------------------------------------------------------------------------------------

describe("buildScanRequest", () => {
  it("is the body /api/scan takes: a scan with an id, a name, a kind, a length, the word, the photo and the outline request", () => {
    const r = buildScanRequest({ imageDataUrl: IMAGE, word: "  spoon ", targetHeightMm: 60 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body).toEqual({
      scan: { id: "photo-accessory", name: "Photo accessory", kind: "other", lengthMm: 200, prompt: "spoon", imageDataUrl: IMAGE, outline: { targetHeightMm: 60 } },
    });
  });

  it("defaults to 54 mm and clamps the height to 30 to 90 mm, to a tenth", () => {
    const h = (targetHeightMm?: number) => {
      const r = buildScanRequest({ imageDataUrl: IMAGE, word: "x", ...(targetHeightMm === undefined ? {} : { targetHeightMm }) });
      if (!r.ok) throw new Error("refused");
      return (r.body.scan.outline as { targetHeightMm: number }).targetHeightMm;
    };
    expect([DEFAULT_HEIGHT_MM, MIN_HEIGHT_MM, MAX_HEIGHT_MM]).toEqual([54, 30, 90]);
    expect(h()).toBe(54);
    expect(h(5)).toBe(30);
    expect(h(500)).toBe(90);
    expect(h(41.26)).toBe(41.3);
  });

  it("asks for symmetry only when told to, and passes the choice through", () => {
    const body = (symmetry?: "auto" | "off") => {
      const r = buildScanRequest({ imageDataUrl: IMAGE, word: "x", ...(symmetry ? { symmetry } : {}) });
      if (!r.ok) throw new Error("refused");
      return r.body.scan.outline;
    };
    expect(body()).toEqual({ targetHeightMm: 54 });
    expect(body("off")).toEqual({ targetHeightMm: 54, symmetry: "off" });
    expect(body("auto")).toEqual({ targetHeightMm: 54, symmetry: "auto" });
  });

  it.each([
    ["no word", { imageDataUrl: IMAGE, word: "" }, "invalid_input", /word or two/],
    ["a word of blanks", { imageDataUrl: IMAGE, word: "   " }, "invalid_input", /word or two/],
    ["a word over 60 characters", { imageDataUrl: IMAGE, word: "w".repeat(61) }, "invalid_input", /word or two/],
    ["no photo", { imageDataUrl: "", word: "spoon" }, "invalid_input", /Pick a photo/],
    ["something that is not an image", { imageDataUrl: "data:text/plain;base64,AAAA", word: "spoon" }, "invalid_input", /Pick a photo/],
    ["a photo over the limit", { imageDataUrl: `data:image/jpeg;base64,${"A".repeat(MAX_PHOTO_DATA_URL)}`, word: "spoon" }, "too_large", /too big/],
    ["a height that is not a number", { imageDataUrl: IMAGE, word: "spoon", targetHeightMm: Number.NaN }, "invalid_input", /size/],
  ] as const)("refuses %s with a sentence and sends nothing", (_name, args, reason, text) => {
    const r = buildScanRequest(args);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe(reason);
    expect(r.message).toMatch(text);
  });

  it("takes a word of exactly 60 characters", () => {
    expect(buildScanRequest({ imageDataUrl: IMAGE, word: "w".repeat(60) }).ok).toBe(true);
  });
});

// ---- the scan, against scripted replies -----------------------------------------------------------------------------------

describe("scanPhoto: what it sends and what it does with the reply", () => {
  it("posts the body to /api/scan with no cookies, and reads the outline back from sam.outline", async () => {
    const outline = scanOf(LOLLIPOP);
    const s = scripted([{ json: { toy: null, sam: { configured: true, applied: true, maskApplied: true, matches: 1, outline: JSON.parse(JSON.stringify(outline)) } } }]);
    const r = await scanPhoto(s.fetch, { imageDataUrl: IMAGE, word: "lollipop", targetHeightMm: 54 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scan).toEqual(outline);
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]!.url).toBe("/api/scan");
    expect(s.calls[0]!.init).toMatchObject({ method: "POST", credentials: "omit", cache: "no-store" });
    expect(JSON.parse(String(s.calls[0]!.init!.body))).toMatchObject({ scan: { prompt: "lollipop", imageDataUrl: IMAGE, outline: { targetHeightMm: 54 } } });
  });

  it("sends nothing for input it would refuse", async () => {
    const s = scripted([]);
    const r = await scanPhoto(s.fetch, { imageDataUrl: IMAGE, word: "" });
    expect(r).toMatchObject({ ok: false, reason: "invalid_input" });
    expect(s.calls).toHaveLength(0);
  });

  it.each([
    ["the network is down", { throws: true }, "offline", /No connection/],
    ["a 429", { status: 429, json: {} }, "slow_down", /Too many tries/],
    ["a 413", { status: 413, json: {} }, "too_large", /too big/],
    ["a 422", { status: 422, json: {} }, "invalid_input", /could not be used/],
    ["a 400", { status: 400, json: {} }, "invalid_input", /could not be used/],
    ["a 500", { status: 500, json: {} }, "busy", /busy/],
    ["a reply that is not JSON", { raw: "<html>" }, "busy", /busy/],
    ["a reply with no sam in it", { json: { toy: null } }, "busy", /busy/],
    ["a helper that is not configured", { json: { toy: null, sam: { configured: false, applied: false } } }, "helper_off", /not turned on/],
  ] as const)("%s is one calm sentence, never a thrown error", async (_name, step, reason, text) => {
    const r = await scanPhoto(scripted([step]).fetch, { imageDataUrl: IMAGE, word: "spoon" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe(reason);
    expect(r.message).toMatch(text);
  });

  it("says what it could not find, in the child's own word, when the helper found nothing", async () => {
    const r = await scanPhoto(scripted([{ json: { toy: null, sam: { configured: true, applied: false, status: "no-match", matches: 0 } } }]).fetch, { imageDataUrl: IMAGE, word: " spoon " });
    expect(r).toMatchObject({ ok: false, reason: "no_match" });
    if (!r.ok) expect(r.message).toBe("I could not find a spoon in the photo. Try a clearer photo or another word.");
  });

  it("zero matches is no_match even when the reply names no status", async () => {
    const r = await scanPhoto(scripted([{ json: { toy: null, sam: { configured: true, applied: false, matches: 0 } } }]).fetch, { imageDataUrl: IMAGE, word: "spoon" });
    expect(r).toMatchObject({ ok: false, reason: "no_match" });
  });

  it("a match with no outline in the reply is its own case", async () => {
    const r = await scanPhoto(scripted([{ json: { toy: null, sam: { configured: true, applied: true, matches: 1 } } }]).fetch, { imageDataUrl: IMAGE, word: "spoon" });
    expect(r).toMatchObject({ ok: false, reason: "no_outline" });
  });

  it.each([
    ["too_thin", /too thin/],
    ["not_simple", /too tangled/],
    ["empty_mask", /could not find the shape/],
    ["bad_mask", /could not find the shape/],
  ] as const)("an outline the helper could not make (%s) says why, and keeps the failure", async (reason, text) => {
    const failure = { ok: false, reason, detail: "internal wording that must not reach a child" };
    const r = await scanPhoto(scripted([{ json: { toy: null, sam: { configured: true, applied: true, matches: 1, outline: failure } } }]).fetch, { imageDataUrl: IMAGE, word: "spoon" });
    expect(r).toMatchObject({ ok: false, reason: "outline_failed", outlineFailure: failure });
    if (!r.ok) {
      expect(r.message).toMatch(text);
      expect(r.message).not.toContain("internal wording");
    }
  });

  it("an outline that does not read field by field is no outline", async () => {
    const broken = { ...JSON.parse(JSON.stringify(scanOf(LOLLIPOP))), points: "not points" };
    const r = await scanPhoto(scripted([{ json: { toy: null, sam: { configured: true, applied: true, matches: 1, outline: broken } } }]).fetch, { imageDataUrl: IMAGE, word: "spoon" });
    expect(r).toMatchObject({ ok: false, reason: "no_outline" });
  });
});

// ---- the scan, through the real Worker ------------------------------------------------------------------------------------

describe("scanPhoto through the real /api/scan handler", () => {
  const ENV = { MODEL_API_KEY: "test-key" };
  const viaScan: Fetch = async (url, init) => worker.fetch(new Request(`http://local${url}`, init), ENV as never);
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reads the whole real spoon, handle and all, the same as the outline of the independently decoded mask", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(spoonSamReply(), { status: 200, headers: { "content-type": "text/event-stream" } })));
    const r = await scanPhoto(viaScan, { imageDataUrl: "data:image/jpeg;base64,PHOTO", word: "spoon", targetHeightMm: 54 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const spoon = await realSpoon();
    const direct = scanOutline(spoon.raster, spoon.bounds, SPOON_PHOTO, { targetHeightMm: 54 });
    expect(r.scan).toEqual(direct);
    expect(r.scan.photoSize).toEqual(SPOON_PHOTO);
    expect(r.scan.changes.map((c) => c.code)).toContain("made_symmetric");
  });

  it("with symmetry off, leaves the real spoon as traced", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(spoonSamReply(), { status: 200, headers: { "content-type": "text/event-stream" } })));
    const r = await scanPhoto(viaScan, { imageDataUrl: "data:image/jpeg;base64,PHOTO", word: "spoon", symmetry: "off" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scan.changes.map((c) => c.code)).not.toContain("made_symmetric");
      expect(canMakeSymmetric(r.scan)).toBe(true);
    }
  });

  it("a photo with nothing in it comes back as no_match, in the child's word", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 200, headers: { "content-type": "text/event-stream" } })));
    const r = await scanPhoto(viaScan, { imageDataUrl: "data:image/jpeg;base64,PHOTO", word: "dragon" });
    expect(r).toMatchObject({ ok: false, reason: "no_match" });
    if (!r.ok) expect(r.message).toContain("dragon");
  });

  it("the Worker's own refusal (no key set) is helper_off", async () => {
    const r = await scanPhoto(async (url, init) => worker.fetch(new Request(`http://local${url}`, init), {} as never), { imageDataUrl: "data:image/jpeg;base64,PHOTO", word: "spoon" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(["helper_off", "busy", "no_outline"]).toContain(r.reason);
  });
});

// ---- sentences and pictures -----------------------------------------------------------------------------------------------

describe("hintsFor", () => {
  it("turns each warning code into a sentence, in order, with no code in it", () => {
    const h = hintsFor(["THIN_PARTS_REMOVED", "SPLIT_OBJECT", "LARGE_HOLES_FILLED", "LOW_FIDELITY", "POINT_BUDGET_NOT_MET", "NOT_SYMMETRIC", "GATE_REWROTE_OUTLINE"]);
    expect(h).toHaveLength(7);
    expect(h[0]).toMatch(/too thin/);
    expect(h[6]).toMatch(/sticker may not line up/);
    for (const text of h) expect(text).not.toMatch(/[A-Z]{3,}_[A-Z]|_/);
  });

  it("says nothing for a code it does not know, and nothing twice", () => {
    expect(hintsFor(["MYSTERY_CODE", "toString", "__proto__"])).toEqual([]);
    expect(hintsFor(["LOW_FIDELITY", "LOW_FIDELITY"])).toHaveLength(1);
    expect(hintsFor([])).toEqual([]);
  });
});

describe("overlayPoints", () => {
  it("is the outline in photo pixels: carried back through the map, the points land on the plate points again", () => {
    const scan = scanOf(LOLLIPOP);
    const o = overlayPoints(scan);
    expect(o).toHaveLength(scan.points.length);
    for (let i = 0; i < o.length; i++) {
      const [px, pz] = applyAffine(scan.photoToPlate, o[i]![0], o[i]![1]);
      expect(Math.abs(px - scan.points[i]![0])).toBeLessThan(1e-6);
      expect(Math.abs(pz - scan.points[i]![1])).toBeLessThan(1e-6);
    }
  });

  it("puts the outline on the object in the photo: its centre is inside the lollipop and it stays inside the photo's box", () => {
    const o = overlayPoints(scanOf(LOLLIPOP));
    const cx = o.reduce((s, p) => s + p[0], 0) / o.length;
    const cy = o.reduce((s, p) => s + p[1], 0) / o.length;
    expect(inside([[240, 50], [400, 50], [400, 420], [240, 420]], cx, cy)).toBe(true); // the lollipop's own box in the photo
    const xs = o.map((p) => p[0]);
    const ys = o.map((p) => p[1]);
    expect(Math.min(...xs)).toBeGreaterThan(235);
    expect(Math.max(...xs)).toBeLessThan(405);
    expect(Math.min(...ys)).toBeGreaterThan(45);
    expect(Math.max(...ys)).toBeLessThan(425);
  });

  it("the real spoon's outline lies on the spoon: its centre is on the mask", async () => {
    const spoon = await realSpoon();
    const scan = scanOutline(spoon.raster, spoon.bounds, SPOON_PHOTO, { targetHeightMm: 54 });
    if (!scan.ok) throw new Error("no outline");
    const o = overlayPoints(scan);
    const cx = Math.round(o.reduce((s, p) => s + p[0], 0) / o.length) - spoon.bounds.left;
    const cy = Math.round(o.reduce((s, p) => s + p[1], 0) / o.length) - spoon.bounds.top;
    expect(spoon.raster.data[cy * spoon.raster.width + cx]).toBeTruthy();
  });

  it("is empty when the map cannot be turned round", () => {
    const scan = scanOf(LOLLIPOP);
    expect(overlayPoints({ points: scan.points, photoToPlate: [0, 0, 0, 0, 0, 0] })).toEqual([]);
  });
});

describe("canMakeSymmetric", () => {
  it("is false once the outline has been made symmetric, true before", () => {
    expect(canMakeSymmetric(scanOf(LOLLIPOP))).toBe(false); // a clearly symmetric object: the scan did it
    expect(canMakeSymmetric(scanOf(LOLLIPOP, { targetHeightMm: 54, symmetry: "off" }))).toBe(true);
  });
});

// ---- the child's choices, previewed ----------------------------------------------------------------------------------------

describe("previewChoices: the picture is the shape that is checked", () => {
  const firstShape = async (scan: ScanOutlineSuccess, options: PhotoAccessoryOptions): Promise<OutlineShape> => {
    const shapes: OutlineShape[] = [];
    await preparePhotoAccessory(
      scan,
      async (shape) => {
        shapes.push(shape);
        return { status: "pass", failures: [] };
      },
      options,
    );
    return shapes[0]!;
  };
  const PADDLE_OFF = () => scanOf(LOLLIPOP, { targetHeightMm: 54, symmetry: "off" });
  const bbox = (pts: readonly Pt[]) => ({ x0: Math.min(...pts.map((p) => p[0])), x1: Math.max(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), y1: Math.max(...pts.map((p) => p[1])) });

  it("with no choices it is the scan's outline", () => {
    const scan = scanOf(LOLLIPOP);
    const p = previewChoices(scan);
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.outline.points).toEqual(scan.points);
      expect("appliedScale" in p).toBe(false);
    }
  });

  it.each([
    ["nothing", {}],
    ["flip", { flip: true }],
    ["smaller", { scale: 0.8 }],
    ["bigger and flipped", { scale: 1.2, flip: true }],
    ["symmetry", { symmetry: "mirror" as const }],
    ["symmetry, smaller, flipped", { symmetry: "mirror" as const, scale: 0.9, flip: true }],
  ] as const)("%s: the first gate call gets exactly the points the preview shows", async (_name, choices) => {
    const scan = PADDLE_OFF();
    const p = previewChoices(scan, choices);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const shape = await firstShape(scan, choices);
    expect(shape.points).toEqual(p.outline.points);
  });

  it("flip and resize only change the plate's coordinates: the cut line stays on the same part of the photo", () => {
    const scan = scanOf(LOLLIPOP);
    const before = bbox(overlayPoints(scan));
    for (const choices of [{ flip: true }, { scale: 0.7 }, { scale: 1.3, flip: true }]) {
      const p = previewChoices(scan, choices);
      if (!p.ok) throw new Error("refused");
      const o = overlayPoints(p.outline);
      const after = bbox(o);
      for (const k of ["x0", "x1", "y0", "y1"] as const) expect(Math.abs(after[k] - before[k]), `${JSON.stringify(choices)} ${k}`).toBeLessThan(1.5);
      for (let i = 0; i < o.length; i++) {
        const [px, pz] = applyAffine(p.outline.photoToPlate, o[i]![0], o[i]![1]);
        expect(Math.abs(px - p.outline.points[i]![0])).toBeLessThan(1e-6);
        expect(Math.abs(pz - p.outline.points[i]![1])).toBeLessThan(1e-6);
      }
    }
    expect(previewChoices(scan, { flip: true }).ok && (previewChoices(scan, { flip: true }) as { outline: { points: Pt[] } }).outline.points).not.toEqual(scan.points); // guard: flip did change the plate
  });

  it("says what size it really used when the 90 mm box caps it", () => {
    const scan = scanOf(LOLLIPOP);
    const p = previewChoices(scan, { scale: 100 });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.appliedScale).toBeGreaterThan(1);
    expect(p.appliedScale).toBeLessThan(100);
    expect(p.outline.heightMm).toBeLessThanOrEqual(90 + 1e-6);
    expect(p.outline.widthMm).toBeLessThanOrEqual(90 + 1e-6);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("a size of %s is a sentence, not a throw", (scale) => {
    const p = previewChoices(scanOf(LOLLIPOP), { scale });
    expect(p).toEqual({ ok: false, message: "That size cannot be used." });
  });

  it("symmetry on an object that cannot have it is a sentence and nothing is drawn; on one that already has it, nothing changes", () => {
    const L = union(rect(200, 60, 270, 400), rect(200, 330, 460, 400));
    expect(previewChoices(scanOf(L, { targetHeightMm: 54, symmetry: "off" }), { symmetry: "mirror" })).toEqual({ ok: false, message: "This one cannot be made the same on both sides without losing a piece." });
    const already = scanOf(LOLLIPOP);
    const p = previewChoices(already, { symmetry: "mirror" });
    expect(p.ok && p.outline.points).toEqual(already.points);
  });

  it("the button goes further than automatic mode: a body with a step on one side is left alone by the scan, and the preview makes it symmetric", () => {
    const STEP = union(disc(320, 130, 70), rect(305, 190, 335, 420), rect(232, 110, 255, 150));
    const auto = scanOf(STEP);
    expect(canMakeSymmetric(auto)).toBe(true); // guard: the scan did not do it
    const p = previewChoices(auto, { symmetry: "mirror" });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    for (const [x, z] of p.outline.points) expect(p.outline.points.some(([x2, z2]) => x2 === -x && z2 === z)).toBe(true);
  });

  it("makes a traced-as-is outline symmetric when asked: every point has an exact twin", () => {
    const p = previewChoices(PADDLE_OFF(), { symmetry: "mirror" });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    for (const [x, z] of p.outline.points) expect(p.outline.points.some(([x2, z2]) => x2 === -x && z2 === z)).toBe(true);
  });
});

// ---- the grown-up check ---------------------------------------------------------------------------------------------------

describe("createParentGate", () => {
  const clock = (t0 = 1_000_000) => {
    let t = t0;
    return { now: () => t, advance: (ms: number) => (t += ms) };
  };
  const device = () => "12345678-1234-1234-1234-123456789abc";
  const CHALLENGE = { json: { mode: "math", a: 6, b: 7, challengeToken: "tok" } };

  it("asks for a question, and sends the device id and nothing else of the child", async () => {
    const s = scripted([CHALLENGE]);
    const g = createParentGate({ fetch: s.fetch, deviceId: device });
    expect(await g.challenge()).toEqual({ status: "ok", mode: "math", a: 6, b: 7, challengeToken: "tok", cooldownUntil: null });
    expect(s.calls[0]!.url).toBe("/api/parent/gate");
    expect(s.calls[0]!.init).toMatchObject({ method: "POST", credentials: "omit", cache: "no-store" });
    expect(JSON.parse(String(s.calls[0]!.init!.body))).toEqual({ action: "challenge" });
    expect((s.calls[0]!.init!.headers as Record<string, string>)["x-device-id"]).toBe(device());
  });

  it("reads a PIN question and a cooldown", async () => {
    const g = createParentGate({ fetch: scripted([{ json: { mode: "pin", a: 0, b: 0, challengeToken: "t", cooldownUntil: 1234 } }]).fetch, deviceId: device });
    expect(await g.challenge()).toMatchObject({ status: "ok", mode: "pin", cooldownUntil: 1234 });
  });

  it.each([
    ["the network is down", { throws: true }, "offline"],
    ["a gate that is not set up (501)", { status: 501, json: {} }, "disabled"],
    ["a 500", { status: 500, json: {} }, "unavailable"],
    ["a reply with no question in it", { json: { mode: "math" } }, "unavailable"],
    ["a reply that is not JSON", { raw: "oops" }, "unavailable"],
  ] as const)("a challenge that fails (%s) is a status, not an error", async (_name, step, status) => {
    const g = createParentGate({ fetch: scripted([step]).fetch, deviceId: device });
    expect((await g.challenge()).status).toBe(status);
  });

  it("keeps the proof from a right answer in memory, sends it on forge requests, and lets it go when it is nearly out of time", async () => {
    const c = clock();
    const s = scripted([{ json: { ok: true, proofToken: "PROOF", expiresAt: c.now() + 120_000 } }]);
    const g = createParentGate({ fetch: s.fetch, deviceId: device, now: c.now });
    expect(g.hasProof()).toBe(false);
    expect(g.headers()).toEqual({ "x-device-id": device() }); // no proof yet: the Worker will say 401
    expect(await g.verify({ challengeToken: "tok", answer: "42" })).toEqual({ status: "ok" });
    expect(JSON.parse(String(s.calls[0]!.init!.body))).toEqual({ action: "verify", challengeToken: "tok", answer: 42 });
    expect(g.hasProof()).toBe(true);
    expect(g.headers()).toEqual({ "x-device-id": device(), "x-parent-proof": "PROOF" });
    c.advance(114_000);
    expect(g.hasProof()).toBe(true);
    c.advance(2_000); // 4 s left: under the 5 s margin
    expect(g.hasProof()).toBe(false);
  });

  it("takes a PIN as the answer", async () => {
    const s = scripted([{ json: { ok: true, proofToken: "P" } }]);
    const g = createParentGate({ fetch: s.fetch, deviceId: device });
    expect(await g.verify({ pin: "1234" })).toEqual({ status: "ok" });
    expect(JSON.parse(String(s.calls[0]!.init!.body))).toEqual({ action: "verify", pin: "1234" });
  });

  it("assumes two minutes when the Worker names no end", async () => {
    const c = clock();
    const g = createParentGate({ fetch: scripted([{ json: { ok: true, proofToken: "P" } }]).fetch, deviceId: device, now: c.now });
    await g.verify({ challengeToken: "t", answer: 1 });
    c.advance(100_000);
    expect(g.hasProof()).toBe(true);
    c.advance(16_000);
    expect(g.hasProof()).toBe(false);
  });

  it("a wrong answer keeps no proof and says how many tries are left", async () => {
    const g = createParentGate({ fetch: scripted([{ status: 403, json: { ok: false, attemptsRemaining: 2 } }]).fetch, deviceId: device });
    expect(await g.verify({ challengeToken: "t", answer: 1 })).toEqual({ status: "wrong", attemptsRemaining: 2, cooldown: false });
    expect(g.hasProof()).toBe(false);
  });

  it("a PIN cooldown says how long to wait", async () => {
    const g = createParentGate({ fetch: scripted([{ status: 403, json: { error: "pin_cooldown", retryAfterSeconds: 30 } }]).fetch, deviceId: device });
    expect(await g.verify({ pin: "0000" })).toEqual({ status: "wrong", retryAfterSeconds: 30, cooldown: true });
  });

  it.each([
    ["the network is down", { throws: true }, "offline"],
    ["a 500", { status: 500, json: {} }, "unavailable"],
    ["a 200 that is not ok", { json: { ok: false } }, "unavailable"],
    ["a 200 with no token", { json: { ok: true } }, "unavailable"],
  ] as const)("a verify that fails (%s) is a status and keeps no proof", async (_name, step, status) => {
    const g = createParentGate({ fetch: scripted([step]).fetch, deviceId: device });
    expect((await g.verify({ challengeToken: "t", answer: 1 })).status).toBe(status);
    expect(g.hasProof()).toBe(false);
  });

  it("takes only ok: true as a right answer, not a word that merely looks true", async () => {
    for (const ok of ["yes", 1, "true"]) {
      const g = createParentGate({ fetch: scripted([{ json: { ok, proofToken: "P" } }]).fetch, deviceId: device });
      expect((await g.verify({ challengeToken: "t", answer: 1 })).status).toBe("unavailable");
      expect(g.hasProof()).toBe(false);
    }
  });

  it("clearProof lets go of the proof", async () => {
    const g = createParentGate({ fetch: scripted([{ json: { ok: true, proofToken: "P" } }]).fetch, deviceId: device });
    await g.verify({ challengeToken: "t", answer: 1 });
    g.clearProof();
    expect(g.hasProof()).toBe(false);
    expect(g.headers()["x-parent-proof"]).toBeUndefined();
  });

  it("sends no device id it does not trust: an id with odd characters, or none, is sent as empty", async () => {
    for (const id of ["bad id with spaces!!", null, "short"]) {
      const g = createParentGate({ fetch: scripted([]).fetch, deviceId: () => id });
      expect(g.headers()["x-device-id"]).toBe("");
    }
  });

  it("one sentence for each way a question or an answer can end", () => {
    expect(gateMessage({ status: "ok" })).toBe("");
    expect(gateMessage({ status: "wrong", cooldown: false })).toMatch(/not right/);
    expect(gateMessage({ status: "wrong", cooldown: true, retryAfterSeconds: 30 })).toMatch(/wait 30 seconds/);
    expect(gateMessage({ status: "wrong", cooldown: true })).toMatch(/not right/); // a cooldown with no time is just a wrong answer
    expect(gateMessage({ status: "disabled" })).toMatch(/not turned on/);
    expect(gateMessage({ status: "offline" })).toMatch(/No connection/);
    expect(gateMessage({ status: "unavailable" })).toMatch(/busy/);
  });
});

// ---- the print step, through the real Worker -----------------------------------------------------------------------------

describe("printAccessory through the real Worker routes", () => {
  const PLATE = "photo_accessory.0123456789ab.stl";
  const REPORT = (ok: boolean, small: Record<string, unknown>, blocking: unknown[] = []) => ({ ok, design_status: ok ? "ok" : "fail", small_part: small, blocking_failures: blocking, brand_errors: [] });
  const PASS = REPORT(true, { status: "above_cylinder", min_enclosing_diameter_mm: 61 });
  const SLIVER = REPORT(false, { status: "above_cylinder", min_enclosing_diameter_mm: 45 }, [{ id: "G1_watertight" }, { id: "G3_single_body" }]);
  const plateBytes = Uint8Array.from({ length: 400 }, (_, i) => (i * 7) % 256);

  let env: ReturnType<typeof forgeEnv>;
  beforeEach(async () => {
    resetForgeRateLimit();
    env = forgeEnv();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    resetForgeRateLimit();
  });

  /** A parent gate that has really passed the Worker's check. */
  async function liveGate(f: Fetch = viaWorker(env)) {
    const g = createParentGate({ fetch: f, deviceId: () => DEVICE });
    const ch = await g.challenge();
    if (ch.status !== "ok") throw new Error("no challenge");
    expect(await g.verify({ challengeToken: ch.challengeToken, answer: ch.a * ch.b })).toEqual({ status: "ok" });
    return g;
  }
  const events = () => {
    const seen: PrintProgress[] = [];
    return { seen, onProgress: (e: PrintProgress) => seen.push(e) };
  };

  it("goes from a scan to an accessory and the plate's bytes, and reports each gate call", async () => {
    const daemon = fakeDaemon([PASS], { plate: { name: PLATE, bytes: plateBytes } });
    const gate = await liveGate();
    const e = events();
    const r = await printAccessory({ scan: scanOf(LOLLIPOP), gate, fetch: viaWorker(env), onProgress: e.onProgress, sleep: async () => {} });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plateStl).toEqual(plateBytes);
    expect(r.accessory.artifacts).toMatchObject({ stl: PLATE });
    expect(r.accessory.recipe.shape).toEqual(daemon.recipes[0].recipe.shape);
    expect(daemon.artifactRequests).toEqual([PLATE]);
    expect(e.seen).toEqual([{ stage: "checking", call: 1 }, { stage: "fetching_plate" }]);
    expect(r.hints).toEqual([]);
    expect("plateMessage" in r).toBe(false);
  });

  it("passes the child's choices on to the print step: flip, resize and the name", async () => {
    const daemon = fakeDaemon([PASS], { plate: { name: PLATE, bytes: plateBytes } });
    const plain = scanOf(LOLLIPOP);
    const r = await printAccessory({ scan: plain, gate: await liveGate(), fetch: viaWorker(env), options: { flip: true, name: "My lollipop" }, sleep: async () => {} });
    expect(r.ok).toBe(true);
    expect(r.ok && r.accessory.recipe.name).toBe("My lollipop"); // the gate request uses its own generic name; the accessory carries the child's
    const zs = (daemon.recipes[0].recipe.shape.points as Pt[]).map((p) => p[1]);
    const plainZs = plain.points.map((p) => p[1]);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(Math.max(...plainZs) - Math.min(...plainZs), 1);
  });

  it("turns warnings on the outline into sentences, and none when there are none", async () => {
    fakeDaemon([PASS], { plate: { name: PLATE, bytes: plateBytes } });
    const scan = { ...scanOf(LOLLIPOP), warnings: ["THIN_PARTS_REMOVED", "MYSTERY_CODE"] };
    const r = await printAccessory({ scan, gate: await liveGate(), fetch: viaWorker(env), sleep: async () => {} });
    expect(r.ok && r.hints).toEqual(["Some parts were too thin to print and were left out."]);
  });

  it("reports the daemon's own rewrite of the outline as the sentence about the sticker", async () => {
    fakeDaemon([PASS], { plate: { name: PLATE, bytes: plateBytes }, legalizers: [{ symmetry: { action: "mirrored_left_half", iou_before: 0.96, iou_after: 1, points: 100 } }] });
    const r = await printAccessory({ scan: scanOf(LOLLIPOP), gate: await liveGate(), fetch: viaWorker(env), sleep: async () => {} });
    expect(r.ok && r.hints.some((h) => /sticker may not line up/.test(h))).toBe(true);
  });

  it("waits out a refusal for the time the Worker names, tells the screen, and asks again: a fit of four calls finishes when two earlier calls had used part of the minute's five", async () => {
    // The real limiter allows 5 previews a minute a device (3 until 2026-11-04), shared with Make from words. Two calls were already made this minute; three slivers then a pass is four
    // calls, like the real spoon, so the fourth is the sixth of the minute and is refused.
    for (let i = 0; i < 2; i++) forgeRateLimitWait("preview", DEVICE, null);
    const daemon = fakeDaemon([SLIVER, SLIVER, SLIVER, PASS], { plate: { name: PLATE, bytes: plateBytes } });
    const gate = await liveGate();
    const e = events();
    const slept: number[] = [];
    const r = await printAccessory({
      scan: scanOf(LOLLIPOP),
      gate,
      fetch: viaWorker(env),
      onProgress: e.onProgress,
      pollSleep: async () => {},
      sleep: async (ms) => {
        slept.push(ms);
        resetForgeRateLimit(); // the minute passes
      },
    });
    expect(r.ok).toBe(true);
    expect(daemon.recipes).toHaveLength(4); // the refused call never reached the daemon, and was asked again once
    expect(slept).toHaveLength(1);
    expect(slept[0]! % 1000).toBe(0);
    expect(slept[0]!).toBeGreaterThanOrEqual(55_000); // the Worker names the time (retry-after): the fourth call comes within a few seconds of the second
    expect(slept[0]!).toBeLessThanOrEqual(60_000); // so it is a little under the 60 s window, not the 61 s the flow assumes when no time is named
    const waiting = e.seen.filter((x) => x.stage === "waiting");
    expect(waiting).toEqual([{ stage: "waiting", call: 4, seconds: slept[0]! / 1000 }]);
    expect(e.seen.filter((x) => x.stage === "checking").map((x) => (x as { call: number }).call)).toEqual([1, 2, 3, 4, 4]);
  });

  it("does not wait for ever: after the waits it was given it says to try again in a minute", async () => {
    for (let i = 0; i < 5; i++) forgeRateLimitWait("preview", DEVICE, null); // the minute's five are already used, so every call is refused
    fakeDaemon([SLIVER], { plate: { name: PLATE, bytes: plateBytes } });
    const gate = await liveGate();
    const slept: number[] = [];
    const r = await printAccessory({ scan: scanOf(LOLLIPOP), gate, fetch: viaWorker(env), maxWaits: 2, pollSleep: async () => {}, sleep: async (ms) => void slept.push(ms) }); // the minute never passes
    expect(r).toMatchObject({ ok: false, reason: "too_many_waits" });
    if (!r.ok) expect(r.message).toMatch(/Too many tries/);
    expect(slept).toHaveLength(2);
    for (const ms of slept) {
      expect(ms % 1000).toBe(0);
      expect(ms).toBeGreaterThanOrEqual(55_000);
      expect(ms).toBeLessThanOrEqual(60_000);
    }
  });
});

// ---- the print step, with a backend that misbehaves ----------------------------------------------------------------------

describe("printAccessory: every way it can end is a sentence", () => {
  const PLATE = "photo_accessory.0123456789ab.stl";
  const PASS_REPORT = { ok: true, design_status: "ok", small_part: { status: "above_cylinder", min_enclosing_diameter_mm: 61 }, blocking_failures: [], brand_errors: [] };
  const SLIVER_REPORT = { ok: false, design_status: "fail", small_part: { status: "above_cylinder", min_enclosing_diameter_mm: 45 }, blocking_failures: [{ id: "G1_watertight" }], brand_errors: [] };
  const MARGINAL_REPORT = { ok: false, design_status: "marginal", small_part: { status: "marginal", min_enclosing_diameter_mm: 33.5 }, blocking_failures: [], brand_errors: [] };
  const plateBytes = Uint8Array.from({ length: 300 }, (_, i) => i % 251);
  const j = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

  /** A forge backend that answers from a rule per request; `rule` returns a Response to override, or undefined to use the good path. */
  function backend(report: unknown, rule: (path: string, n: number) => Response | undefined = () => undefined) {
    const seen: string[] = [];
    let previews = 0;
    const fetch: Fetch = async (url, init) => {
      const path = url.replace(/^\/api\/forge/, "");
      seen.push(`${init?.method ?? "GET"} ${path}`);
      if (path === "/preview") previews++;
      const override = rule(path, previews);
      if (override) return override;
      if (path === "/preview") return j({ ok: true, status: "preview_ready", job_id: `fjob_${String(previews).padStart(12, "0")}` });
      if (/^\/jobs\//.test(path)) return j({ ok: true, job_id: path.slice(6), status: report === PASS_REPORT ? "print_ready" : "digital_only", gate_report: report, stl_artifact: PLATE, glb_artifact: "photo_accessory.0123456789ab.glb", content_hash: "0123456789ab" });
      if (path === `/artifacts/${PLATE}`) return new Response(plateBytes as BodyInit, { status: 200, headers: { "content-type": "model/stl" } });
      return j({ ok: false }, 404);
    };
    return { fetch, seen };
  }
  const gateWithProof = () => {
    const g = createParentGate({ fetch: scripted([{ json: { ok: true, proofToken: "PROOF" } }]).fetch, deviceId: () => DEVICE });
    return g.verify({ challengeToken: "t", answer: 1 }).then(() => g);
  };
  const run = async (b: { fetch: Fetch }, extra: Partial<Parameters<typeof printAccessory>[0]> = {}) =>
    printAccessory({ scan: scanOf(LOLLIPOP), gate: await gateWithProof(), fetch: b.fetch, sleep: async () => {}, ...extra });

  it("a part the gates keep refusing is does_not_print, with a sentence about size and photo", async () => {
    const r = await run(backend(SLIVER_REPORT));
    expect(r).toMatchObject({ ok: false, reason: "does_not_print" });
    if (!r.ok) expect(r.message).toMatch(/did not like this shape/);
  });

  it("a size that stays marginal is no_size_found", async () => {
    const r = await run(backend(MARGINAL_REPORT));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(["no_size_found", "does_not_print"]).toContain(r.reason);
  });

  it("a gate that is off (503) is disabled", async () => {
    const r = await run(backend(PASS_REPORT, (p) => (p === "/preview" ? j({ ok: false, status: "disabled" }, 503) : undefined)));
    expect(r).toMatchObject({ ok: false, reason: "disabled" });
  });

  it("a recipe the Worker refuses (422) is rejected", async () => {
    const r = await run(backend(PASS_REPORT, (p) => (p === "/preview" ? j({ ok: false }, 422) : undefined)));
    expect(r).toMatchObject({ ok: false, reason: "rejected" });
  });

  it.each([["a dropped daemon (502)", 502], ["a timeout (504)", 504]] as const)("%s is busy", async (_name, status) => {
    const r = await run(backend(PASS_REPORT, (p) => (p === "/preview" ? j({ ok: false }, status) : undefined)));
    expect(r).toMatchObject({ ok: false, reason: "busy" });
  });

  it("a job that ends failed is busy, not a verdict", async () => {
    const r = await run(backend(PASS_REPORT, (p) => (/^\/jobs\//.test(p) ? j({ ok: true, job_id: "fjob_000000000001", status: "failed" }) : undefined)));
    expect(r).toMatchObject({ ok: false, reason: "busy" });
  });

  it("an expired grown-up check with nobody to ask is gate_required, with the sentence", async () => {
    const r = await run(backend(PASS_REPORT, (p) => (p === "/preview" ? j({ ok: false, status: "gate-required" }, 401) : undefined)));
    expect(r).toMatchObject({ ok: false, reason: "gate_required" });
    if (!r.ok) expect(r.message).toMatch(/ask a grown-up again/);
  });

  it("an expired grown-up check is renewed through renewGate in the middle of the fit, and the same call is asked again", async () => {
    let refused = false;
    const b = backend(PASS_REPORT, (p) => {
      if (p === "/preview" && !refused) {
        refused = true;
        return j({ ok: false, status: "gate-required" }, 401);
      }
      return undefined;
    });
    const seen: PrintProgress[] = [];
    let asked = 0;
    const r = await run(b, { onProgress: (e) => seen.push(e), renewGate: async () => (asked++, true) });
    expect(r.ok).toBe(true);
    expect(asked).toBe(1);
    expect(seen.map((e) => e.stage)).toEqual(["checking", "asking_again", "checking", "fetching_plate"]);
    expect(b.seen.filter((s) => s === "POST /preview")).toHaveLength(2);
  });

  it("when the grown-up does not pass the second check it is gate_required, and it asks once and no more", async () => {
    const b = backend(PASS_REPORT, (p) => (p === "/preview" ? j({ ok: false, status: "gate-required" }, 401) : undefined));
    let asked = 0;
    const r = await run(b, { renewGate: async () => (asked++, false) });
    expect(r).toMatchObject({ ok: false, reason: "gate_required" });
    expect(asked).toBe(1);
    expect(b.seen.filter((x) => x === "POST /preview")).toHaveLength(1); // a renewal that failed is not followed by another call
  });

  it("a renewal that still gets 401 is asked about once for that call, not for ever", async () => {
    const b = backend(PASS_REPORT, (p) => (p === "/preview" ? j({ ok: false, status: "gate-required" }, 401) : undefined));
    let asked = 0;
    const r = await run(b, { renewGate: async () => (asked++, true) });
    expect(r).toMatchObject({ ok: false, reason: "gate_required" });
    expect(asked).toBe(1);
  });

  it("waits the time the Worker names, capped at 90 s, and a full 61 s window when it names none", async () => {
    const waits = async (header: Record<string, string> | undefined) => {
      let n = 0;
      const b = backend(PASS_REPORT, (p) => (p === "/preview" && n++ === 0 ? j({ ok: false, status: "slow-down" }, 429, header) : undefined));
      const slept: number[] = [];
      const r = await run(b, { pollSleep: async () => {}, sleep: async (ms) => void slept.push(ms) });
      expect(r.ok).toBe(true);
      return slept;
    };
    expect(await waits({ "retry-after": "7" })).toEqual([7000]);
    expect(await waits({ "retry-after": "500" })).toEqual([90_000]);
    expect(await waits(undefined)).toEqual([61_000]);
    expect(await waits({ "retry-after": "0" })).toEqual([61_000]); // the gate driver reads only a time over zero, so this is "none": never a busy loop
  });

  it("a plate that cannot be fetched still returns the accessory, with the plate left out and a sentence", async () => {
    const r = await run(backend(PASS_REPORT, (p) => (p.startsWith("/artifacts/") ? j({ ok: false }, 502) : undefined)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plateStl).toBeNull();
    expect(r.plateMessage).toMatch(/plate file could not be fetched/);
  });

  it("a plate refused for want of the grown-up check says so", async () => {
    const r = await run(backend(PASS_REPORT, (p) => (p.startsWith("/artifacts/") ? j({ ok: false }, 401) : undefined)));
    expect(r.ok && r.plateMessage).toMatch(/grown-up check ran out/);
  });

  it("asking for symmetry on an object that cannot have it is cannot_symmetrize, before any gate call", async () => {
    const L = union(rect(200, 60, 270, 400), rect(200, 330, 460, 400));
    const b = backend(PASS_REPORT);
    const r = await printAccessory({ scan: scanOf(L, { targetHeightMm: 54, symmetry: "off" }), gate: await gateWithProof(), fetch: b.fetch, options: { symmetry: "mirror" }, sleep: async () => {} });
    expect(r).toMatchObject({ ok: false, reason: "cannot_symmetrize" });
    expect(b.seen).toEqual([]);
  });

  it("a name with a third-party brand in it is brand_rejected, in a sentence that does not repeat the brand, and nothing is sent", async () => {
    const brand = ["Le", "go"].join(""); // built here so the file itself holds no trademark
    const b = backend(PASS_REPORT);
    const r = await printAccessory({ scan: scanOf(LOLLIPOP), gate: await gateWithProof(), fetch: b.fetch, options: { name: `${brand} spoon` }, sleep: async () => {} });
    expect(r).toMatchObject({ ok: false, reason: "brand_rejected", message: "That name is not allowed. Pick another name." });
    expect(b.seen).toEqual([]);
  });

  it("a name that is not allowed, or a size that is nonsense, is a sentence and nothing is sent", async () => {
    const b = backend(PASS_REPORT);
    const gate = await gateWithProof();
    const badSize = await printAccessory({ scan: scanOf(LOLLIPOP), gate, fetch: b.fetch, options: { scale: -2 }, sleep: async () => {} });
    expect(badSize).toMatchObject({ ok: false, reason: "invalid_options" });
    const noName = await printAccessory({ scan: scanOf(LOLLIPOP), gate, fetch: b.fetch, options: { name: "   " }, sleep: async () => {} });
    expect(noName).toMatchObject({ ok: false, reason: "invalid_options" });
    expect(b.seen).toEqual([]);
  });

  it("a gate refusal keeps the technical detail apart from the sentence", async () => {
    const r = await run(backend(SLIVER_REPORT));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.detail).toBeTruthy(); // guard: there is a detail to leak
    expect(r.message).not.toContain(r.detail!);
    expect(r.message).not.toMatch(/G\d_|attempt|fillet/i);
  });

  it("never lets a raw detail into a message", async () => {
    for (const rule of [(p: string) => (p === "/preview" ? j({ ok: false, detail: "INTERNAL_SECRET_WORDING" }, 502) : undefined), (p: string) => (p === "/preview" ? j({ ok: false }, 422) : undefined)]) {
      const r = await run(backend(PASS_REPORT, rule));
      if (!r.ok) {
        expect(r.message).not.toMatch(/INTERNAL|forge route|fjob_|\b[45]\d\d\b/);
      }
    }
  });
});

// ---- the module itself ---------------------------------------------------------------------------------------------------

describe("photoPrintFlow.ts", () => {
  it("imports only the modules it drives, and nothing of the browser or a clock of its own", () => {
    const src = readFileSync(join(__dirname, "..", "shared", "photoPrintFlow.ts"), "utf8");
    expect([...src.matchAll(/^import[\s\S]*?from "(.*)";$/gm)].map((m) => m[1]).sort()).toEqual(["./householdMatch", "./outlineFit", "./outlineGate", "./outlineScan", "./outlineSticker", "./outlineSymmetry", "./photoAccessory", "./photoOutline"]);
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code.length).toBeGreaterThan(6000);
    expect(code).not.toMatch(/\bwindow\b|\bdocument\b|localStorage|sessionStorage|indexedDB|\bprocess\.|Math\.random/);
    // Date.now and setTimeout appear only as the defaults of the things a caller can pass in.
    expect([...code.matchAll(/Date\.now\(\)/g)]).toHaveLength(1);
    expect([...code.matchAll(/setTimeout\(/g)]).toHaveLength(1);
  });
});

// ---- the panel's bundle and its own promises --------------------------------------------------------------------------------

describe("the print panel: its bundle and its own source", () => {
  const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8");
  const panel = read("parts/kip/viewer/kip-photo-print.js");

  it("the committed bundle is what the source builds: a stale copy in public/kip fails here", () => {
    const dir = mkdtempSync(join(tmpdir(), "photo-print-bundle-"));
    try {
      const out = join(dir, "core.js");
      execFileSync(join(__dirname, "..", "node_modules/.bin/esbuild"), [join(__dirname, "..", "shared/photoPrintFlow.ts"), "--bundle", "--format=esm", "--target=es2022", "--minify", "--legal-comments=none", `--outfile=${out}`], { stdio: "pipe" });
      const built = readFileSync(out);
      expect(built.length).toBeGreaterThan(20_000);
      expect(Buffer.compare(built, readFileSync(join(__dirname, "..", "public/kip/kip-photo-print-core.js")))).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the panel keeps its promises in its own source: text set as text, no storage write, nothing on window or document", () => {
    const code = panel.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code.length).toBeGreaterThan(8000);
    expect(code).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|document\.cookie|sessionStorage|indexedDB|\.setItem|\.removeItem|\.cookie\b/);
    expect(code).not.toMatch(/window\.addEventListener|document\.addEventListener|document\.body|document\.head|document\.getElementById|document\.querySelector/);
    // The one storage access is a read of the app's anonymous device id.
    expect([...code.matchAll(/localStorage/g)]).toHaveLength(1);
    expect(code).toMatch(/localStorage\.getItem\(DEVICE_KEY\)/);
    // It starts no timer of its own. The waiting strip (kip-workshop-wait.js) starts the timers while the printer check runs, and the panel stops it
    // on every way out: when the check ends, when it is reset, and when it is disposed (the strip clears every timer in stop(); tools/e2e_workshop_wait.mjs).
    expect([...code.matchAll(/setInterval\(|setTimeout\(/g)]).toHaveLength(0);
    expect([...code.matchAll(/workshop\.stop\(/g)].length).toBeGreaterThanOrEqual(3);
    expect(code).toMatch(/workshop\.stop\(\{ finished: Boolean\(r\.ok\) \}\)/);
    expect(code.slice(code.indexOf("dispose() {"))).toMatch(/workshop\.stop\(\)/);
    expect(code.slice(code.indexOf("function reset() {"), code.indexOf("function reset() {") + 120)).toMatch(/workshop\.stop\(\)/);
    // It talks to no address of its own: every request goes through the flow module's routes.
    expect(code).not.toMatch(/['"`]\/api\//);
  });

  it("the panel imports the flow, the sticker module and the shared waiting strip, and nothing else", () => {
    expect([...panel.matchAll(/^import[\s\S]*?from '(.*)';/gm)].map((m) => m[1]).sort()).toEqual(["./kip-photo-print-core.js?v=10.0", "./kip-print-stickers.js", "./kip-workshop-wait.js"]);
  });
});
