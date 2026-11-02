import { afterEach, describe, expect, it, vi } from "vitest";
import {
  inspectPhotoNouns,
  makeSkin,
  parseInspectNouns,
  SAM_TIMEOUT_MS,
  segmentToy,
  SKIN_TIMEOUT_MS,
} from "../worker/meta";

// Complete output_text captured from a live sam-3.1 call on 2026-10-28
// (cup in the cup + water-bottle photo, 1920x1280, one_bit masks).
const LIVE_CUP = "<0f>0<|box;x1=347;y1=734;x2=837;y2=1104;w=1920;h=1280|><|mask;x=0;y=0;data=371,491,!!!!%P@^/csA5cPwK&8YStSm%Qgd1y%s/vzl&PI`H3?n&UVERYPSw)XPsVH)jan)S/U&1wai1U-Ukntshw%NITEXB-&#U!ei6uHAWHhQc(Iy?WXL5^2`.S5ohy%2V9=XBlCo4%9LA{S-!eeGQ{&U-Dmy$_K?*71ed9hyOy#zZiv_@X!6]cgQ^-ssT9FxU&'K0O4E@[w8`8*HSUo&TiZ(rM=F2[A6-X=4nIWJ?i:y5th3/aL0fYgkIpp&?Wve'5tZG0D0$s0Gs%xcSjh3/1o8&C4:uB)Da.N$V[uSV^'eC-hWo&?lC!c4ZD5V:g6yuDLo`&EJdhI#^qrOBXa=ATmD%PzH{C45Q11Ch31/vZ9Z3H8UM=)2=%HLxdui!!|>\n";
const BOX_ONLY = "<0f>0<|box;x1=10;y1=20;x2=110;y2=70;w=200;h=100|>\n";

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
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(sseBody(outputText), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    ),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("segmentToy mask integration", () => {
  it("decodes the live cup mask into a compact summary", async () => {
    stubSam(LIVE_CUP);
    const result = await segmentToy(
      { MODEL_API_KEY: "test-key" },
      "data:image/jpeg;base64,x",
      "cup",
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.box).toMatchObject({ x1: 347, y1: 734, x2: 837, y2: 1104 });
    expect(result.mask).toBeDefined();
    expect(result.mask!.coverage).toBeGreaterThan(0.7);
    expect(result.mask!.coverage).toBeLessThan(0.74);
    expect(result.mask!.pixelWidth).toBeLessThanOrEqual(491);
    expect(result.mask!.pixelHeight).toBeLessThanOrEqual(371);
    expect(result.mask!.outline.x1).toBeCloseTo(347 / 1920, 2);
    expect(result.mask!.silhouette?.path.length).toBeLessThanOrEqual(8_000);
  });

  it("keeps the box result when the stream carries no mask", async () => {
    stubSam(BOX_ONLY);
    const result = await segmentToy(
      { MODEL_API_KEY: "test-key" },
      "data:image/jpeg;base64,x",
      "cup",
    );
    expect(result).toMatchObject({ status: "ok", matches: 1 });
    if (result.status === "ok") expect(result.mask).toBeUndefined();
  });
});

describe("upstream error redaction", () => {
  function stubStatus(status: number, text: string): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(text, { status, headers: { "content-type": "text/plain" } })),
    );
  }

  it("keeps raw SAM error bodies out of the kid-facing message", async () => {
    stubStatus(500, 'upstream exploded: card 1234-5678 detail "SECRETDETAIL"');
    const result = await segmentToy(
      { MODEL_API_KEY: "test-key" },
      "data:image/jpeg;base64,x",
      "cup",
    );
    expect(result).toMatchObject({ status: "error", message: "SAM request failed" });
  });

  it("keeps raw skin error bodies out of the kid-facing message", async () => {
    stubStatus(500, 'card 1234-5678 "SECRETDETAIL"');
    const result = await makeSkin(
      { MODEL_API_KEY: "test-key" },
      "data:image/jpeg;base64,x",
      "red",
    );
    expect(result).toMatchObject({ status: "error", message: "skin request failed" });
  });
});

describe("upstream timeouts", () => {
  // Faithful hang: never resolves, rejects when the caller's signal aborts,
  // exactly like a real fetch against an unroutable upstream.
  function stubHang(): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: unknown, init?: { signal?: AbortSignal | null }) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(
                init.signal instanceof AbortSignal ? init.signal.reason : new Error("aborted"),
              );
            });
          }),
      ),
    );
  }

  it("pins generous default budgets", () => {
    expect(SAM_TIMEOUT_MS).toBe(20_000);
    expect(SKIN_TIMEOUT_MS).toBe(45_000);
  });

  it("gives up on a hanging SAM upstream instead of spinning forever", async () => {
    stubHang();
    const started = Date.now();
    const result = await segmentToy(
      { MODEL_API_KEY: "test-key" },
      "data:image/jpeg;base64,x",
      "cup",
      50,
    );
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.message).toMatch(/timed out/);
    expect(result.message).not.toMatch(/Bearer|test-key/);
  });

  it("gives up on a hanging skin upstream instead of spinning forever", async () => {
    stubHang();
    const started = Date.now();
    const result = await makeSkin(
      { MODEL_API_KEY: "test-key" },
      "data:image/jpeg;base64,x",
      "red",
      50,
    );
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.message).toMatch(/timed out/);
    expect(result.message).not.toMatch(/Bearer|test-key/);
  });
});

describe("Scan Assist inspect (A1)", () => {
  it("parses ranked nouns defensively (fenced, noisy, overlong)", () => {
    expect(parseInspectNouns(JSON.stringify({ nouns: ["Chair", "teddy bear", "CHAIR", "x".repeat(50)] }))).toEqual([
      "chair",
      "teddy bear",
    ]);
    expect(parseInspectNouns("```json\n{\"nouns\": [\"book\"]}\n```")).toEqual(["book"]);
    expect(parseInspectNouns("no json here")).toEqual([]);
    expect(parseInspectNouns('{"nouns": "book"}')).toEqual([]);
  });

  it("fails soft without a key (checked: false, no fetch)", async () => {
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    expect(await inspectPhotoNouns({}, "data:image/jpeg;base64,x")).toEqual({ checked: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns nouns from a Spark-shaped reply", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          output: [
            { type: "message", content: [{ type: "output_text", text: '{"nouns": ["chair", "bear"]}' }] },
          ],
        }),
      ),
    );
    expect(await inspectPhotoNouns({ MODEL_API_KEY: "test-key" }, "data:image/jpeg;base64,x")).toEqual({
      checked: true,
      nouns: ["chair", "bear"],
    });
  });
});
