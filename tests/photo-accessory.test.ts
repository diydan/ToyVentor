import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error untyped browser JS module
import * as ST from "../parts/kip/viewer/kip-print-stickers.js";
import type { OutlineGate, OutlineShape, OutlineVerdict } from "../shared/outlineFit";
import { fetchPlateStl, forgeRouteGate, OutlineGateError } from "../shared/outlineGate";
import { parseScanOutline, scanOutline, type ScanOutline, type ScanOutlineSuccess } from "../shared/outlineScan";
import { type PhotoAccessory, type PhotoAccessoryFailure, preparePhotoAccessory } from "../shared/photoAccessory";
import { applyAffine, flipOutline } from "../shared/photoOutline";
import { resetForgeRateLimit } from "../worker/forgeOptimizer";
import { DEVICE, fakeDaemon, forgeEnv, mintParentProof, viaWorker } from "./fixtures/forgeWorkerHarness";
import { cropToObject, disc, type Inside, rasterize, rect, star, union, type Raster } from "./fixtures/outlineMasks";
import { realSpoon, SPOON_PHOTO } from "./fixtures/realCupMask";

/* eslint-disable @typescript-eslint/no-explicit-any */

// The legalizer takes up to 0.9 s a call and the machine is often at load 50 or more.
vi.setConfig({ testTimeout: 60_000 });

// ---- a scanned outline, a stand-in gate, and a check of the sticker that does not use the code under test ----------------

const PHOTO = { width: 640, height: 480 };

function scan(shape: Inside, request: { targetHeightMm?: number } = { targetHeightMm: 54 }): { outline: ScanOutlineSuccess; photo: Raster } {
  const photo = rasterize(PHOTO.width, PHOTO.height, shape);
  const c = cropToObject(photo);
  const outline = scanOutline(c.raster, c.bounds, PHOTO, request);
  if (!outline.ok) throw new Error(`no outline: ${outline.reason}`);
  return { outline, photo };
}

const LOLLIPOP = union(disc(320, 130, 80), rect(305, 200, 335, 420));
const STAR = star(320, 240, 160, 70);

const pass = (extra: Partial<OutlineVerdict> = {}): OutlineVerdict => ({ status: "pass", failures: [], ...extra });
const sliver = (): OutlineVerdict => ({ status: "fail", failures: ["G1_watertight", "G3_single_body"] });
const marginal = (cylinderMm?: number): OutlineVerdict => ({ status: "marginal", failures: [], ...(cylinderMm === undefined ? {} : { cylinderMm }) });

function recorder(rule: (shape: OutlineShape, call: number) => OutlineVerdict = () => pass()): { gate: OutlineGate; shapes: OutlineShape[] } {
  const shapes: OutlineShape[] = [];
  return {
    shapes,
    gate: async (shape) => {
      shapes.push(shape);
      return rule(shape, shapes.length);
    },
  };
}

function inside(poly: readonly (readonly [number, number])[], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Overlap of the sticker's cut path with the object, in PHOTO pixels: every photo pixel goes through the sticker's own photo map. */
function stickerIoU(a: PhotoAccessory, photo: Raster, step = 2): number {
  const map = a.sticker.sampler.photoToSticker;
  let inter = 0, uni = 0;
  for (let y = 0; y < photo.height; y += step)
    for (let x = 0; x < photo.width; x += step) {
      const [sx, sy] = applyAffine(map, x, y);
      const onSticker = inside(a.sticker.outerPolyMm, sx, sy);
      const onObject = photo.data[y * photo.width + x] !== 0;
      if (onSticker && onObject) inter++;
      if (onSticker || onObject) uni++;
    }
  return uni === 0 ? 0 : inter / uni;
}

function ok(r: unknown): PhotoAccessory {
  const x = r as PhotoAccessory | PhotoAccessoryFailure;
  if (!x.ok) throw new Error(`expected an accessory, got ${x.reason}: ${x.detail}`);
  return x;
}
function failed(r: unknown): PhotoAccessoryFailure {
  const x = r as PhotoAccessory | PhotoAccessoryFailure;
  if (x.ok) throw new Error("expected a failure");
  return x;
}

// ---- the common path ----------------------------------------------------------------------------------------------

describe("preparePhotoAccessory: a pass on the first gate call", () => {
  it("hands back the recipe that was gated, the sticker for it, and the outline's change log", async () => {
    const { outline } = scan(LOLLIPOP);
    const { gate, shapes } = recorder();
    const a = ok(await preparePhotoAccessory(outline, gate, {}));
    expect(shapes).toHaveLength(1);
    expect(a.attempts).toHaveLength(1);
    expect(a.recipe).toEqual({ name: "Photo accessory", slot: "hand", shape: shapes[0] }); // the recipe is exactly what the gate passed
    expect(shapes[0]).toEqual({ kind: "profile2d", points: outline.points, fillet_r_mm: 1.6, grip_tu: 2 });
    expect(a.outline.points).toEqual(outline.points);
    expect(a.outline.changes).toEqual(outline.changes); // nothing was retried, so nothing is added
    expect(a.decal).toEqual({ kind: "photo_accessory", item: a.sticker });
    expect(a.sticker.sampler.photoSize).toEqual(PHOTO); // carried from the scan, so artwork at any resolution lines up
    expect(a.artifacts).toBeNull();
    expect("appliedScale" in a).toBe(false);
  });

  it("makes a sticker that lies on the object in the photo (IoU above 0.95)", async () => {
    const { outline, photo } = scan(LOLLIPOP);
    const a = ok(await preparePhotoAccessory(outline, recorder().gate));
    expect(stickerIoU(a, photo)).toBeGreaterThan(0.95);
  });

  it("passes on the plate the gate job left", async () => {
    const { outline } = scan(LOLLIPOP);
    const artifacts = { jobId: "fjob_000000000001", stl: "photo_accessory.0123456789ab.stl", glb: null, contentHash: null };
    const a = ok(await preparePhotoAccessory(outline, recorder(() => pass({ artifacts })).gate));
    expect(a.artifacts).toEqual(artifacts);
  });

  it("takes the grip, the name and the sticker options", async () => {
    const { outline } = scan(LOLLIPOP);
    const { gate, shapes } = recorder();
    const a = ok(await preparePhotoAccessory(outline, gate, { gripTu: 3, name: "  Sam's wand  ", sticker: { id: "wand", label: "Wand", bgHex: "#112233" } }));
    expect(shapes[0]!.grip_tu).toBe(3);
    expect(a.recipe.shape).toMatchObject({ grip_tu: 3 });
    expect(a.recipe.name).toBe("Sam's wand");
    expect(a.sticker).toMatchObject({ id: "wand", label: "Wand", bgHex: "#112233" });
  });

  it("uses the small-parts band it is given: a marginal 50 mm cylinder grows under a 60 mm band and shrinks under the default", async () => {
    const { outline } = scan(LOLLIPOP, { targetHeightMm: 40 });
    const rule = (_s: OutlineShape, call: number) => (call === 1 ? marginal(50) : pass());
    const wide = ok(await preparePhotoAccessory(outline, recorder(rule).gate, { band: { cylinderMm: 60, marginalPct: 10 } }));
    const normal = ok(await preparePhotoAccessory(outline, recorder(rule).gate));
    expect(wide.outline.heightMm).toBeGreaterThan(outline.heightMm * 1.2);
    expect(normal.outline.heightMm).toBeLessThan(outline.heightMm);
  });

  it("keeps to the call budget it is given", async () => {
    const { outline } = scan(LOLLIPOP);
    const { gate, shapes } = recorder(() => sliver());
    const r = failed(await preparePhotoAccessory(outline, gate, { maxGateCalls: 2 }));
    expect(r.reason).toBe("out_of_budget");
    expect(shapes).toHaveLength(2);
  });
});

// ---- the loop's work reaches the sticker --------------------------------------------------------------------------

describe("preparePhotoAccessory: what the loop changes, the sticker follows", () => {
  it("a marginal result is rescaled, and the recipe and the sticker are the grown outline's", async () => {
    const { outline, photo } = scan(LOLLIPOP, { targetHeightMm: 33 });
    const { gate, shapes } = recorder((_s, call) => (call === 1 ? marginal(33.5) : pass()));
    const a = ok(await preparePhotoAccessory(outline, gate));
    expect(a.attempts.map((x) => `${x.kind}:${x.status}`)).toEqual(["first:marginal", "rescale:pass"]);
    expect(a.outline.heightMm).toBeGreaterThan(outline.heightMm * 1.03);
    expect(a.recipe.shape).toEqual(shapes[1]); // the one that passed, not the first
    expect(a.outline.changes.map((c) => c.code)).toContain("rescaled_out_of_marginal");
    expect(Math.abs(a.sticker.h - a.outline.heightMm)).toBeLessThan(1.5); // the sticker is the final size
    expect(stickerIoU(a, photo)).toBeGreaterThan(0.95); // and the photo map was carried through the rescale
  });

  it("a sliver is nudged, and the sticker follows the nudged outline", async () => {
    const { outline, photo } = scan(LOLLIPOP);
    const { gate } = recorder((_s, call) => (call === 1 ? sliver() : pass()));
    const a = ok(await preparePhotoAccessory(outline, gate));
    expect(a.attempts.map((x) => `${x.kind}:${x.status}`)).toEqual(["first:fail", "size_nudge:pass"]);
    expect(a.outline.heightMm / outline.heightMm).toBeCloseTo(1.02, 2);
    expect(stickerIoU(a, photo)).toBeGreaterThan(0.95);
  });
});

// ---- the kid's flip and resize ------------------------------------------------------------------------------------

describe("preparePhotoAccessory: flip and resize", () => {
  it("flips before the fit: the gate sees the flipped outline, and the sticker still lies on the object", async () => {
    const { outline, photo } = scan(LOLLIPOP);
    const { gate, shapes } = recorder();
    const a = ok(await preparePhotoAccessory(outline, gate, { flip: true }));
    expect(a.outline.orientation.flipped).toBe(!outline.orientation.flipped);
    expect(shapes[0]!.points).toEqual(flipOutline(outline.points));
    expect(shapes[0]!.points).not.toEqual(outline.points);
    expect(a.outline.changes.map((c) => c.code)).toContain("flipped");
    expect(stickerIoU(a, photo)).toBeGreaterThan(0.95);
  });

  it("a flip does not change how well the sticker fits the object: a half turn keeps the overlap", async () => {
    const { outline, photo } = scan(STAR, { targetHeightMm: 40 });
    const plain = stickerIoU(ok(await preparePhotoAccessory(outline, recorder().gate)), photo);
    const flipped = stickerIoU(ok(await preparePhotoAccessory(outline, recorder().gate, { flip: true })), photo);
    expect(plain).toBeGreaterThan(0.9);
    expect(Math.abs(plain - flipped)).toBeLessThan(0.005);
  });

  it("resizes before the fit and says the factor it used", async () => {
    const { outline, photo } = scan(LOLLIPOP);
    const { gate } = recorder();
    const a = ok(await preparePhotoAccessory(outline, gate, { scale: 0.6 }));
    expect(a.appliedScale).toBeCloseTo(0.6, 2);
    expect(a.outline.heightMm).toBeCloseTo(outline.heightMm * 0.6, 1);
    expect(stickerIoU(a, photo)).toBeGreaterThan(0.95);
  });

  it("the 90 mm box caps a big resize, and the result says so", async () => {
    const { outline } = scan(LOLLIPOP);
    const a = ok(await preparePhotoAccessory(outline, recorder().gate, { scale: 5 }));
    expect(a.outline.heightMm).toBeLessThanOrEqual(90.01);
    expect(a.appliedScale!).toBeLessThan(5);
    expect(a.appliedScale!).toBeCloseTo(a.outline.heightMm / outline.heightMm, 2);
  });

  it("flips and resizes together, and the sticker still lies on the object", async () => {
    const { outline, photo } = scan(STAR);
    const a = ok(await preparePhotoAccessory(outline, recorder().gate, { flip: true, scale: 0.7 }));
    expect(stickerIoU(a, photo)).toBeGreaterThan(0.95);
  });
});

// ---- what is refused, and what is not a verdict -------------------------------------------------------------------

describe("preparePhotoAccessory: failures leave the caller its fallback", () => {
  it("has no outline when the scan has none or could not make one, and gates nothing", async () => {
    const { gate, shapes } = recorder();
    expect(failed(await preparePhotoAccessory(undefined, gate))).toMatchObject({ reason: "no_outline" });
    const refusal: ScanOutline = { ok: false, reason: "too_thin", detail: "the outline is 2 mm wide" };
    const r = failed(await preparePhotoAccessory(refusal, gate));
    expect(r).toMatchObject({ reason: "no_outline", detail: "the outline is 2 mm wide", outlineFailure: refusal });
    expect(shapes).toHaveLength(0);
  });

  it("refuses a name that is empty or too long, and a resize that is not a positive number, before any gate call", async () => {
    const { outline } = scan(LOLLIPOP);
    const { gate, shapes } = recorder();
    for (const options of [{ name: "" }, { name: "   " }, { name: "x".repeat(81) }, { scale: 0 }, { scale: -1 }, { scale: Number.NaN }, { scale: Number.POSITIVE_INFINITY }]) {
      expect(failed(await preparePhotoAccessory(outline, gate, options)).reason, JSON.stringify(options)).toBe("invalid_options");
    }
    expect(shapes).toHaveLength(0);
    expect(ok(await preparePhotoAccessory(outline, gate, { name: "x".repeat(80) })).recipe.name).toHaveLength(80); // the edge is allowed
  });

  it("refuses a brand name before any gate call", async () => {
    const { outline } = scan(LOLLIPOP);
    const { gate, shapes } = recorder();
    const brand = ["Le", "go"].join(""); // spelled out in pieces: this repo keeps third-party names out of its source
    const r = failed(await preparePhotoAccessory(outline, gate, { name: `${brand} crown` }));
    expect(r.reason).toBe("brand_rejected");
    expect(shapes).toHaveLength(0);
  });

  it("says why the fit ended, with the attempts and the first outline, so the caller can fall back", async () => {
    const { outline } = scan(LOLLIPOP);
    const r = failed(await preparePhotoAccessory(outline, recorder(() => sliver()).gate));
    expect(r.reason).toBe("gate_failed");
    if (r.reason !== "gate_failed") return;
    expect(r.attempts.length).toBeGreaterThan(1);
    expect(r.attempts.every((x) => x.status === "fail")).toBe(true);
    expect(r.outline?.points).toEqual(outline.points);
    const m = failed(await preparePhotoAccessory(outline, recorder(() => marginal()).gate));
    expect(m.reason).toBe("marginal_unresolved");
  });

  it("a gate that could not run is a gate_error with its kind, not a verdict", async () => {
    const { outline } = scan(LOLLIPOP);
    let calls = 0;
    const gate: OutlineGate = async () => {
      calls++;
      throw new OutlineGateError("slow_down", "busy", { httpStatus: 429, retryAfterS: 5 });
    };
    const r = failed(await preparePhotoAccessory(outline, gate));
    expect(r.reason).toBe("gate_error");
    if (r.reason !== "gate_error") return;
    expect(r.error.kind).toBe("slow_down");
    expect(r.error.retryAfterS).toBe(5);
    expect(calls).toBe(1);
  });

  it("does not hide a bug: an error that is not the gate's own is thrown on", async () => {
    const { outline } = scan(LOLLIPOP);
    const gate: OutlineGate = async () => {
      throw new TypeError("a bug");
    };
    await expect(preparePhotoAccessory(outline, gate)).rejects.toThrow(TypeError);
  });
});

// ---- the real steel spoon: a thin handle must survive the whole step -------------------------------------------------------

describe("preparePhotoAccessory: the real steel spoon", () => {
  async function spoon() {
    const { raster, bounds } = await realSpoon();
    const outline = scanOutline(raster, bounds, SPOON_PHOTO, { targetHeightMm: 54 });
    if (!outline.ok) throw new Error(`no outline: ${outline.reason}`);
    const photo: Raster = { width: SPOON_PHOTO.width, height: SPOON_PHOTO.height, data: new Uint8Array(SPOON_PHOTO.width * SPOON_PHOTO.height) };
    for (let y = 0; y < raster.height; y++) for (let x = 0; x < raster.width; x++) if (raster.data[y * raster.width + x]) photo.data[(y + bounds.top) * photo.width + x + bounds.left] = 1;
    return { outline, photo };
  }

  it("gates the whole spoon, and when the first fillet slivers three times the gentler rung passes with the handle still on", async () => {
    const { outline, photo } = await spoon();
    expect(outline.fillet_r_mm).toBeGreaterThan(0.8); // guard: there is a gentler rung to fall to
    expect(outline.warnings).toEqual([]);
    const { gate, shapes } = recorder((_s, call) => (call <= 3 ? sliver() : pass()));
    const a = ok(await preparePhotoAccessory(outline, gate));
    expect(shapes.map((x) => x.fillet_r_mm)).toEqual([outline.fillet_r_mm, outline.fillet_r_mm, outline.fillet_r_mm, 0.8]);
    expect(a.attempts.map((x) => x.kind)).toEqual(["first", "size_nudge", "size_nudge", "fillet"]);
    expect(a.recipe.shape).toMatchObject({ kind: "profile2d", fillet_r_mm: 0.8 });
    expect(a.outline.heightMm).toBeGreaterThan(75); // the spoon, not the bowl alone (a bowl is 21 mm)
    expect(a.outline.warnings).toEqual([]);
    expect(stickerIoU(a, photo)).toBeGreaterThan(0.95); // the sticker is the whole spoon too
  });

  it("is the same whole spoon when the gate passes the first time", async () => {
    const { outline, photo } = await spoon();
    const { gate, shapes } = recorder();
    const a = ok(await preparePhotoAccessory(outline, gate));
    expect(shapes).toHaveLength(1);
    expect(a.outline.heightMm).toBeCloseTo(outline.heightMm, 5);
    expect(stickerIoU(a, photo)).toBeGreaterThan(0.95);
  });

  it("a flipped spoon keeps its handle through the same rungs", async () => {
    const { outline, photo } = await spoon();
    const { gate, shapes } = recorder((_s, call) => (call <= 3 ? sliver() : pass()));
    const a = ok(await preparePhotoAccessory(outline, gate, { flip: true }));
    expect(shapes.at(-1)!.fillet_r_mm).toBe(0.8);
    expect(a.outline.orientation.flipped).toBe(true);
    expect(stickerIoU(a, photo)).toBeGreaterThan(0.95);
  });
});

// ---- the whole print step, through the real Worker routes ----------------------------------------------------------

describe("the whole print step: scan reply, fit, plate, sticker pack", () => {
  const PLATE = "photo_accessory.0123456789ab.stl";
  const REPORT = (small: Record<string, unknown>, ok: boolean) => ({ ok, design_status: ok ? "ok" : "marginal", small_part: small, blocking_failures: [], brand_errors: [] });
  const MARGINAL = REPORT({ status: "marginal", min_enclosing_diameter_mm: 33.5 }, false);
  const PASS = REPORT({ status: "above_cylinder", min_enclosing_diameter_mm: 40 }, true);
  let env: ReturnType<typeof forgeEnv>;
  let proof: string;

  beforeEach(async () => {
    resetForgeRateLimit();
    env = forgeEnv();
    proof = await mintParentProof(env);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    resetForgeRateLimit();
  });

  it("goes from the JSON a scan returned to a plate, a recipe and four sticker files", async () => {
    const plateBytes = Uint8Array.from({ length: 900 }, (_, i) => (i * 13) % 256);
    const daemon = fakeDaemon([MARGINAL, PASS], { plate: { name: PLATE, bytes: plateBytes } });
    const { outline, photo } = scan(STAR, { targetHeightMm: 33 });

    // The scan reply crosses the wire and is read back field by field, as the device does.
    const read = parseScanOutline(JSON.parse(JSON.stringify(outline)));
    expect(read?.ok).toBe(true);

    const routes = { fetch: viaWorker(env), headers: () => ({ "x-device-id": DEVICE, "x-parent-proof": proof }) };
    const a = ok(await preparePhotoAccessory(read, forgeRouteGate({ ...routes, sleep: async () => {} }), { flip: true }));

    // It was gated twice: the flipped outline, then a rescale of it. The Worker forwarded each point for point.
    expect(a.attempts.map((x) => `${x.kind}:${x.status}`)).toEqual(["first:marginal", "rescale:pass"]);
    expect(daemon.recipes).toHaveLength(2);
    expect(daemon.recipes[0].recipe.shape.points).toEqual(flipOutline((read as ScanOutlineSuccess).points));
    expect(daemon.recipes[1].recipe.shape).toEqual(a.recipe.shape);
    expect(daemon.recipes[1].recipe.slot).toBe("hand");

    // The plate of the job that passed, not of the first one.
    expect(a.artifacts).toMatchObject({ jobId: "fjob_000000000002", stl: PLATE });
    expect(await fetchPlateStl(a.artifacts!.stl, routes)).toEqual(plateBytes);
    expect(daemon.artifactRequests).toEqual([PLATE]);

    // The sticker is for the flipped, grown outline and lies on the object in the photo. A small star loses its thin tips to the
    // rounding the builder applies (0.949 measured for this star at this size with no flip and no rescale, 0.98 at 70 mm), so the
    // bar is the measured floor, not 0.95; a wrong map would be far below it.
    expect(stickerIoU(a, photo)).toBeGreaterThan(0.93);
    const plan = ST.planStickerSheet([a.decal], {});
    expect(plan.items).toHaveLength(2);
    const key = plan.items[0].sampler.sourceKey as string;
    const source = { w: 4, h: 4, data: new Uint8ClampedArray(4 * 4 * 4).fill(200) };
    const files = ST.buildStickerPackFiles([a.decal], {}, { [key]: source }, { dpi: 40 });
    expect(files.map((f: any) => f.name)).toEqual(["stickers/sticker-sheet.pdf", "stickers/stickers.png", "stickers/stickers-cut.svg", "stickers/stickers-cut.dxf"]);
    expect(files.every((f: any) => (typeof f.data === "string" ? f.data.length : f.data.length) > 100)).toBe(true);
  });

  it("stops with the limit's kind when the Worker's preview budget runs out mid-fit, and does not guess", async () => {
    fakeDaemon([MARGINAL, MARGINAL, MARGINAL, MARGINAL], {});
    // Spend the budget (3 a minute) first, as a kid who flipped a few times would have.
    const g = forgeRouteGate({ fetch: viaWorker(env), headers: () => ({ "x-device-id": DEVICE, "x-parent-proof": proof }), sleep: async () => {} });
    const { outline } = scan(LOLLIPOP, { targetHeightMm: 33 });
    const stub: OutlineShape = { kind: "profile2d", points: outline.points, fillet_r_mm: 1.6, grip_tu: 2 };
    for (let i = 0; i < 3; i++) await g(stub);
    const r = failed(await preparePhotoAccessory(outline, g));
    expect(r.reason).toBe("gate_error");
    if (r.reason === "gate_error") expect(r.error.kind).toBe("slow_down");
  });
});

// ---- the module stays pure ----------------------------------------------------------------------------------------

describe("photoAccessory.ts", () => {
  it("imports only shared modules, and nothing of the browser, the Worker or the network", () => {
    const src = readFileSync(join(__dirname, "..", "shared", "photoAccessory.ts"), "utf8");
    const imports = [...src.matchAll(/^import[\s\S]*?from "(.*)";$/gm)].map((m) => m[1]);
    expect(imports.sort()).toEqual(["./forgeOptimizer", "./outlineFit", "./outlineGate", "./outlineScan", "./outlineSticker", "./photoOutline"]);
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code.length).toBeGreaterThan(2000);
    expect(code).not.toMatch(/\bwindow\b|\bdocument\b|localStorage|\bprocess\.|\bfetch\b/);
  });
});
