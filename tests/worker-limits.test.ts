import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../worker/index";

// Payload caps are enforced on the bytes actually read, so a chunked
// request with no content-length cannot bypass the guard by omitting it.

function streamBody(size: number): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`{"pad":"${"x".repeat(size)}"}`));
      controller.close();
    },
  });
}

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  const init = (
    body instanceof ReadableStream
      ? {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body,
        duplex: "half",
      }
      : {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      }
  ) as RequestInit;
  return new Request(`http://local${path}`, init);
}

afterEach(() => vi.unstubAllGlobals());

describe("worker payload byte caps", () => {
  it("rejects a chunked scan body over 2MB", async () => {
    const res = await worker.fetch(post("/api/scan", streamBody(2_500_000)), {});
    expect(res.status).toBe(413);
    expect(await res.text()).toContain("scan payload over");
  });

  it("rejects a chunked skin body over 2MB", async () => {
    const res = await worker.fetch(post("/api/skin", streamBody(2_500_000)), {});
    expect(res.status).toBe(413);
  });

  it("rejects a chunked ownership body over 1MB", async () => {
    const res = await worker.fetch(
      post("/api/ownership", streamBody(1_500_000), { "x-device-id": "12345678-1234-1234-1234-123456789abc" }),
      // The byte cap answers before any store is touched.
      { DB: {} } as never,
    );
    expect(res.status).toBe(413);
  });

  it("still parses a small chunked scan body", async () => {
    const res = await worker.fetch(post("/api/scan", streamBody(100)), {});
    expect(res.status).toBe(422);
  });
});
