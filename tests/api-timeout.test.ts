import { afterEach, describe, expect, it, vi } from "vitest";
import {
  API_TIMEOUT_MS,
  fetchHealth,
  fetchScanToy,
  fetchWithTimeout,
  postSamScan,
  postScanToy,
  postSkin,
  SAM_SCAN_TIMEOUT_MS,
  SKIN_TIMEOUT_MS,
} from "../src/lib/api";

// Every client fetch must carry a timeout so a hung Worker degrades into a
// rejection the UI already handles (backup toys), never an endless spinner.

function stubResolving(capture: { signal?: AbortSignal | null }): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: unknown, init?: { signal?: AbortSignal | null }) => {
      capture.signal = init?.signal ?? null;
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
}

function stubHanging(): void {
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

afterEach(() => vi.unstubAllGlobals());

describe("client fetch timeouts", () => {
  it("pins budgets above the slowest live upstream call", () => {
    expect(SAM_SCAN_TIMEOUT_MS).toBe(25_000);
    expect(SKIN_TIMEOUT_MS).toBe(60_000);
    expect(API_TIMEOUT_MS).toBe(10_000);
  });

  it("rejects instead of hanging when the server never answers", async () => {
    stubHanging();
    await expect(fetchWithTimeout("/api/health", {}, 50)).rejects.toThrow();
  });

  it("resolves when the server answers in time", async () => {
    stubResolving({});
    const res = await fetchWithTimeout("/api/health", {}, 5_000);
    expect(res.ok).toBe(true);
  });

  it("sends an abort signal on every api call", async () => {
    const capture: { signal?: AbortSignal | null } = {};
    stubResolving(capture);
    await fetchScanToy();
    expect(capture.signal).toBeInstanceOf(AbortSignal);
    await postScanToy(
      {
        id: "x",
        name: "x",
        kind: "car",
        sizeClass: "small",
        lengthMm: 100,
        widthMm: 50,
        attachPoints: [],
        source: "manual",
      },
      "car",
    );
    expect(capture.signal).toBeInstanceOf(AbortSignal);
    await postSamScan({
      id: "x",
      name: "x",
      kind: "car",
      lengthMm: 100,
      prompt: "car",
      imageDataUrl: "data:image/jpeg;base64,x",
    });
    expect(capture.signal).toBeInstanceOf(AbortSignal);
    await postSkin("data:image/jpeg;base64,x", "red");
    expect(capture.signal).toBeInstanceOf(AbortSignal);
    expect(await fetchHealth()).toBe(true);
    expect(capture.signal).toBeInstanceOf(AbortSignal);
  });
});
