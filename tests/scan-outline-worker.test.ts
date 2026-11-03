import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scanOutlineOf, type SamScanResponse } from "../src/lib/api";
import { parseScanOutline } from "../shared/outlineScan";
import { applyAffine } from "../shared/photoOutline";
import { realCup, realSpoon, SPOON_PHOTO, spoonSamReply } from "./fixtures/realCupMask";
import worker from "../worker/index";
import { segmentToy } from "../worker/meta";

// The legalizer takes 0.5 to 0.9 s a call and the machine is often at load 50 or more.
vi.setConfig({ testTimeout: 60_000 });

// `scanOutline` passes through to the real one unless a test makes it throw.
vi.mock("../shared/outlineScan", async (importOriginal) => {
  const real = await importOriginal<typeof import("../shared/outlineScan")>();
  return { ...real, scanOutline: vi.fn(real.scanOutline) };
});
import { scanOutline } from "../shared/outlineScan";

// The cup captured from a live sam-3.1 call. tests/sam-worker.test.ts holds the string; read it from there so there is one copy.
const LIVE_CUP = (() => {
  const m = /const LIVE_CUP = "(.*?)";\n/s.exec(readFileSync(join(__dirname, "sam-worker.test.ts"), "utf8"));
  if (!m) throw new Error("the captured cup is gone from tests/sam-worker.test.ts");
  return m[1]!.replace(/\\n/g, "\n").replace(/\\"/g, '"');
})();
/** Independent of the code under test: ray casting. */
function inside(poly: readonly (readonly [number, number])[], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]!;
    const [xj, zj] = poly[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

const BOX_ONLY = "<0f>0<|box;x1=10;y1=20;x2=110;y2=70;w=200;h=100|>\n";
const NO_MATCH = "";
const IMAGE = "data:image/jpeg;base64,PHOTO-BYTES-THAT-MUST-NOT-COME-BACK";
const ENV = { MODEL_API_KEY: "test-key" };

function sseBody(outputText: string): string {
  const lane = { item_id: "message-1", output_index: 0, content_index: 0 };
  const split = Math.min(80, outputText.length);
  const events = [
    { type: "response.output_text.delta", ...lane, delta: outputText.slice(0, split) },
    { type: "response.output_text.delta", ...lane, delta: outputText.slice(split) },
    { type: "response.output_text.done", ...lane, text: outputText },
    { type: "response.completed" },
  ];
  return events.map((e) => `data: ${JSON.stringify(e)}\n`).join("");
}

function stubSam(outputText: string) {
  const fetchMock = vi.fn(async () => new Response(sseBody(outputText), { status: 200, headers: { "content-type": "text/event-stream" } }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.mocked(scanOutline).mockClear(); // a block body: a function returned from beforeEach would be run as cleanup
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("segmentToy with an outline request", () => {
  it("returns the print outline of the real cup mask, in photo pixels, and the same scan as without it", async () => {
    stubSam(LIVE_CUP);
    const plain = await segmentToy(ENV, IMAGE, "cup");
    const withOutline = await segmentToy(ENV, IMAGE, "cup", undefined, { outline: { targetHeightMm: 54 } });
    expect(plain.status).toBe("ok");
    expect(withOutline.status).toBe("ok");
    if (plain.status !== "ok" || withOutline.status !== "ok") return;
    expect(withOutline.box).toEqual(plain.box);
    expect(withOutline.matches).toBe(plain.matches);
    expect(withOutline.mask).toEqual(plain.mask); // the outline never changes what the scan already returned
    expect("outline" in plain).toBe(false);
    const o = withOutline.outline;
    expect(o?.ok).toBe(true);
    if (!o?.ok) return;
    expect(o.photoSize).toEqual({ width: 1920, height: 1280 });
    expect(o.points.length).toBeGreaterThan(8);
    expect(o.fidelity).toBeGreaterThan(0.95);
    expect(o.heightMm).toBeGreaterThan(40);
    expect(o.heightMm).toBeLessThanOrEqual(90);
    // The cup's box is at (347, 734) in the photo. The map is in photo pixels, so the box centre lands on the plate polygon;
    // a map in mask pixels would put it hundreds of mm away.
    expect(withOutline.box).toMatchObject({ x1: 347, y1: 734 });
    const cx = (withOutline.box.x1 + withOutline.box.x2) / 2;
    const cy = (withOutline.box.y1 + withOutline.box.y2) / 2;
    const [px, pz] = applyAffine(o.photoToPlate, cx, cy);
    expect(inside(o.points, px, pz)).toBe(true);
    const [fx, fz] = applyAffine(o.photoToPlate, 5, 5); // the photo's own corner is nowhere near the cup
    expect(inside(o.points, fx, fz)).toBe(false);
    expect(parseScanOutline(JSON.parse(JSON.stringify(o)))).toEqual(o);

    // The Worker's own decode must give the legalizer the same raster the vendor parser gives, in the same place in the photo:
    // the outline equals the one made from the independently decoded mask. (A raster read with width and height swapped is
    // still a plausible blob with a high fidelity of its own, so only this comparison sees it.)
    const real = await vi.importActual<typeof import("../shared/outlineScan")>("../shared/outlineScan");
    const cup = await realCup();
    const reference = real.scanOutline(cup.raster, cup.bounds, { width: 1920, height: 1280 }, { targetHeightMm: 54 });
    expect(reference.ok).toBe(true);
    expect(o).toEqual(reference);
  });

  it("runs nothing extra when no outline is asked for", async () => {
    stubSam(LIVE_CUP);
    const r = await segmentToy(ENV, IMAGE, "cup");
    expect(r.status).toBe("ok");
    expect(vi.mocked(scanOutline)).not.toHaveBeenCalled();
    const asked = await segmentToy(ENV, IMAGE, "cup", undefined, { outline: {} });
    expect(asked.status === "ok" && asked.outline?.ok).toBe(true);
    expect(vi.mocked(scanOutline)).toHaveBeenCalledTimes(1);
  });

  it("says so when the model sent a box and no mask: a failure the device can read, and the box kept", async () => {
    stubSam(BOX_ONLY);
    const r = await segmentToy(ENV, IMAGE, "cup", undefined, { outline: {} });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.mask).toBeUndefined();
    expect(r.outline).toMatchObject({ ok: false, reason: "bad_mask" });
    expect((r.outline as { detail: string }).detail).toContain("no mask came back");
    expect(vi.mocked(scanOutline)).not.toHaveBeenCalled();
  });

  it("does not let a fault in the outline step cost the scan its box and mask", async () => {
    stubSam(LIVE_CUP);
    vi.mocked(scanOutline).mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const r = await segmentToy(ENV, IMAGE, "cup", undefined, { outline: {} });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.box).toMatchObject({ x1: 347 });
    expect(r.mask).toBeDefined();
    expect(r.outline).toMatchObject({ ok: false, reason: "bad_mask" });
    expect(JSON.stringify(r.outline)).not.toContain("boom"); // the fault's text is not sent on
  });

  it("passes the request through to the legalizer", async () => {
    stubSam(LIVE_CUP);
    const a = await segmentToy(ENV, IMAGE, "cup", undefined, { outline: { targetHeightMm: 80 } });
    const b = await segmentToy(ENV, IMAGE, "cup", undefined, { outline: { targetHeightMm: 40, flip: true } });
    if (a.status !== "ok" || b.status !== "ok" || !a.outline?.ok || !b.outline?.ok) throw new Error("expected two outlines");
    expect(a.outline.heightMm).toBeGreaterThan(b.outline.heightMm * 1.5);
    expect(b.outline.orientation.flipped).toBe(true);
    expect(a.outline.orientation.flipped).toBe(false);
  });
});

describe("POST /api/scan with an outline request", () => {
  const scan = (extra: Record<string, unknown> = {}) => ({
    id: "toy-1",
    name: "Cup",
    kind: "other",
    lengthMm: 90,
    prompt: "cup",
    imageDataUrl: IMAGE,
    ...extra,
  });
  const post = (body: unknown) =>
    worker.fetch(new Request("http://local/api/scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), ENV as never);

  it("adds sam.outline to the reply, and the device can read it", async () => {
    stubSam(LIVE_CUP);
    const res = await post({ scan: scan({ outline: { targetHeightMm: 54 } }) });
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as SamScanResponse;
    expect(body.sam.applied).toBe(true);
    const o = scanOutlineOf(body);
    expect(o?.ok).toBe(true);
    if (!o?.ok) return;
    expect(o.points.length).toBeLessThanOrEqual(256);
    expect(o.photoSize).toEqual({ width: 1920, height: 1280 });
    expect(JSON.stringify(body.sam.outline).length).toBeLessThan(6_000);
    // The device reads the reply field by field: a reply that was changed on the way is no outline.
    const tampered = JSON.parse(text) as SamScanResponse;
    ((tampered.sam.outline as { points: number[][] }).points[0]) = [999, 0];
    expect(scanOutlineOf(tampered)).toBeUndefined();
    expect(text).not.toContain("PHOTO-BYTES"); // no photo comes back
    expect(body.toy).not.toBeNull();
  });

  it("leaves a scan without the field exactly as it was: no outline key, the same toy", async () => {
    stubSam(LIVE_CUP);
    const plain = (await (await post({ scan: scan() })).json()) as SamScanResponse;
    const keys = Object.keys(plain.sam);
    for (const k of ["applied", "box", "configured", "maskApplied", "matches"]) expect(keys).toContain(k); // other features add keys of their own (inspect)
    expect(keys).not.toContain("outline");
    expect(scanOutlineOf(plain)).toBeUndefined();
    stubSam(LIVE_CUP);
    const withOutline = (await (await post({ scan: scan({ outline: {} }) })).json()) as SamScanResponse;
    expect(withOutline.toy).toEqual(plain.toy);
    expect(withOutline.sam.box).toEqual(plain.sam.box);
    expect(vi.mocked(scanOutline)).toHaveBeenCalledTimes(1); // only the second scan asked
  });

  it.each([
    ["a height under the floor", { targetHeightMm: 5 }],
    ["a height over the box", { targetHeightMm: 120 }],
    ["a string height", { targetHeightMm: "54" }],
    ["an unknown orient", { orient: "sideways" }],
    ["a numeric flip", { flip: 1 }],
    ["not an object", "yes"],
    ["an array", [1]],
    ["null", null],
  ])("refuses %s with 422 before SAM is called", async (_name, outline) => {
    const sam = stubSam(LIVE_CUP);
    const res = await post({ scan: scan({ outline }) });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "invalid scan request" });
    expect(sam).not.toHaveBeenCalled();
  });

  it("has no outline when SAM found nothing, and says why through the status it already had", async () => {
    stubSam(NO_MATCH);
    const body = (await (await post({ scan: scan({ outline: {} }) })).json()) as SamScanResponse;
    expect(body.sam).toMatchObject({ applied: false, status: "no-match" });
    expect(body.sam.outline).toBeUndefined();
    expect(vi.mocked(scanOutline)).not.toHaveBeenCalled();
  });

  it("reports a refusal from the legalizer inside the outline, with the scan itself still ok", async () => {
    stubSam(BOX_ONLY);
    const body = (await (await post({ scan: scan({ outline: {} }) })).json()) as SamScanResponse;
    expect(body.sam).toMatchObject({ applied: true, maskApplied: false });
    expect(scanOutlineOf(body)).toMatchObject({ ok: false, reason: "bad_mask" });
  });

  it("logs that an outline was made, never its points or the photo", async () => {
    stubSam(LIVE_CUP);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await post({ scan: scan({ outline: {} }) });
    const lines = log.mock.calls.map((c) => String(c[0]));
    const event = lines.find((l) => l.includes('"sam_scan"'));
    expect(event).toBeDefined();
    expect(JSON.parse(event!)).toMatchObject({ event: "sam_scan", status: "ok", outline: "ok" });
    for (const l of lines) {
      expect(l).not.toContain("points");
      expect(l).not.toContain("PHOTO-BYTES");
    }
  });
});

describe("the real spoon stream through the Worker", () => {
  const stubSpoon = () => vi.stubGlobal("fetch", vi.fn(async () => new Response(spoonSamReply(), { status: 200, headers: { "content-type": "text/event-stream" } })));
  const post = (body: unknown) => worker.fetch(new Request("http://local/api/scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), ENV as never);

  it("returns the whole spoon, handle included, equal to the outline of the independently decoded mask", async () => {
    stubSpoon();
    const res = await post({ scan: { id: "spoon-1", name: "Spoon", kind: "other", lengthMm: 200, prompt: "spoon", imageDataUrl: IMAGE, outline: { targetHeightMm: 54 } } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SamScanResponse;
    expect(body.sam).toMatchObject({ applied: true, maskApplied: true, matches: 1, box: { x1: 109, y1: 22, x2: 199, y2: 468, imageWidth: 288, imageHeight: 512 } });
    const o = scanOutlineOf(body);
    expect(o?.ok).toBe(true);
    if (!o?.ok) return;
    expect(o.warnings).toEqual([]); // the handle is kept
    expect(o.fillet_r_mm).toBeLessThan(1.6);
    expect(o.heightMm).toBeGreaterThan(75);
    expect(o.photoSize).toEqual(SPOON_PHOTO);
    // The Worker's own decode of a tall, offset, non-square mask must give the legalizer what the vendor parser gives.
    const real = await vi.importActual<typeof import("../shared/outlineScan")>("../shared/outlineScan");
    const spoon = await realSpoon();
    expect(o).toEqual(real.scanOutline(spoon.raster, spoon.bounds, SPOON_PHOTO, { targetHeightMm: 54 }));
  });
});
