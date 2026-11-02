import { afterEach, describe, expect, it, vi } from "vitest";
import { ROOM_NOUNS, handleRoomScan, roomNounsFor, segmentRoom } from "../worker/roomScan";

const BOX = "<0f>0<|box;x1=40;y1=50;x2=140;y2=90;w=200;h=100|>\n";

function sseBody(outputText: string): string {
  const lane = { item_id: "message-1", output_index: 0, content_index: 0 };
  return [
    { type: "response.output_text.delta", ...lane, delta: outputText },
    { type: "response.output_text.done", ...lane, text: outputText },
    { type: "response.completed" },
  ]
    .map((e) => `data: ${JSON.stringify(e)}\n`)
    .join("");
}

function stubSam(outputText: string) {
  const fetchMock = vi.fn(
    async () => new Response(sseBody(outputText), { status: 200, headers: { "content-type": "text/event-stream" } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("room scan worker (Feature 3, S0b gate)", () => {
  it("roomNounsFor keeps only the closed list, deduped and capped", () => {
    expect(roomNounsFor(["book", "Book", "dragon", "lamp"])).toEqual(["book", "lamp"]);
    expect(roomNounsFor(undefined)).toEqual([...ROOM_NOUNS]);
    expect(roomNounsFor("book")).toEqual([...ROOM_NOUNS]);
  });

  it("segmentRoom returns normalized boxes per noun within the job budget", async () => {
    const fetchMock = stubSam(BOX);
    const result = await segmentRoom({ MODEL_API_KEY: "test-key" }, "data:image/jpeg;base64,x", ["book", "lamp"]);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.calls).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.segments).toEqual([
      { noun: "book", box: { x1: 0.2, y1: 0.5, x2: 0.7, y2: 0.9 } },
      { noun: "lamp", box: { x1: 0.2, y1: 0.5, x2: 0.7, y2: 0.9 } },
    ]);
  });

  it("segmentRoom reports not-configured without a key and never fetches", async () => {
    const fetchMock = stubSam(BOX);
    const result = await segmentRoom({}, "data:image/jpeg;base64,x", ["book"]);
    expect(result.status).toBe("not-configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("handleRoomScan fails closed without a device id / parent proof (401, no fetch)", async () => {
    const fetchMock = stubSam(BOX);
    const res = await handleRoomScan(
      new Request("http://localhost/api/scan", { method: "POST" }),
      { MODEL_API_KEY: "test-key" } as never,
      { imageDataUrl: "data:image/jpeg;base64,x" },
    );
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
