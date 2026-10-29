import { afterEach, describe, expect, it, vi } from "vitest";
import { segmentToy } from "../worker/meta";

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
