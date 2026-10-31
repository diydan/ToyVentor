import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cachedMuseMiniIcon,
  MAX_CACHED_MINI_ICON_BYTES,
  MAX_CACHED_MINI_ICONS,
  MINI_ICON_STORAGE_KEY,
  resetMiniIconCache,
  resetMiniIconUpgradeAttempts,
  saveCachedMuseMiniIcon,
} from "../src/lib/toyIcon";

function makeMemoryStorage(options?: { throwOnSet?: () => boolean }) {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      if (options?.throwOnSet?.()) throw new Error("QuotaExceededError");
      map.set(k, String(v));
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

function storedMap(): Record<string, unknown> {
  const raw = globalThis.localStorage.getItem(MINI_ICON_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

describe("Phase 2C: Muse mini-icon cache", () => {
  const originalStorage = globalThis.localStorage;

  beforeEach(() => {
    resetMiniIconCache();
    resetMiniIconUpgradeAttempts();
    Object.defineProperty(globalThis, "localStorage", {
      value: makeMemoryStorage(),
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      value: originalStorage,
      configurable: true,
      writable: true,
    });
  });

  it("round-trips a saved icon and misses unknown ids", () => {
    expect(cachedMuseMiniIcon("toy-1")).toBeUndefined();
    saveCachedMuseMiniIcon("toy-1", "data:image/png;base64,AAA");
    expect(cachedMuseMiniIcon("toy-1")).toBe("data:image/png;base64,AAA");
  });

  it("rejects empty ids and payloads without touching storage", () => {
    saveCachedMuseMiniIcon("", "data:x");
    saveCachedMuseMiniIcon("toy-1", "");
    expect(globalThis.localStorage.getItem(MINI_ICON_STORAGE_KEY)).toBeNull();
    expect(cachedMuseMiniIcon("toy-1")).toBeUndefined();
  });

  it("sanitizes non-string values already in storage", () => {
    globalThis.localStorage.setItem(
      MINI_ICON_STORAGE_KEY,
      JSON.stringify({ good: "data:x", bad: 42, empty: "" }),
    );
    expect(cachedMuseMiniIcon("good")).toBe("data:x");
    expect(cachedMuseMiniIcon("bad")).toBeUndefined();
    expect(cachedMuseMiniIcon("empty")).toBeUndefined();
  });

  it(`evicts the oldest entry past ${MAX_CACHED_MINI_ICONS} icons`, () => {
    for (let i = 0; i <= MAX_CACHED_MINI_ICONS; i++) {
      saveCachedMuseMiniIcon(`toy-${i}`, `data:${i}`);
    }
    expect(Object.keys(storedMap())).toHaveLength(MAX_CACHED_MINI_ICONS);
    expect(cachedMuseMiniIcon("toy-0")).toBeUndefined();
    expect(cachedMuseMiniIcon(`toy-${MAX_CACHED_MINI_ICONS}`)).toBe(
      `data:${MAX_CACHED_MINI_ICONS}`,
    );
  });

  it("re-saving an icon refreshes its recency", () => {
    saveCachedMuseMiniIcon("keep", "data:keep");
    saveCachedMuseMiniIcon("drop", "data:drop");
    saveCachedMuseMiniIcon("keep", "data:keep2");
    for (let i = 0; i < MAX_CACHED_MINI_ICONS - 1; i++) {
      saveCachedMuseMiniIcon(`fill-${i}`, `data:${i}`);
    }
    expect(cachedMuseMiniIcon("keep")).toBe("data:keep2");
    expect(cachedMuseMiniIcon("drop")).toBeUndefined();
  });

  it("evicts half the cache and retries when quota throws once", () => {
    for (let i = 0; i < 10; i++) {
      saveCachedMuseMiniIcon(`old-${i}`, `data:${i}`);
    }
    let armed = false;
    let calls = 0;
    const flaky = makeMemoryStorage({
      throwOnSet: () => {
        if (!armed) return false;
        calls += 1;
        return calls === 1;
      },
    });
    flaky.setItem(
      MINI_ICON_STORAGE_KEY,
      globalThis.localStorage.getItem(MINI_ICON_STORAGE_KEY)!,
    );
    armed = true;
    Object.defineProperty(globalThis, "localStorage", {
      value: flaky,
      configurable: true,
      writable: true,
    });
    const before = Object.keys(storedMap()).length;
    expect(before).toBe(10);
    expect(() =>
      saveCachedMuseMiniIcon("new", "data:new"),
    ).not.toThrow();
    expect(cachedMuseMiniIcon("new")).toBe("data:new");
    const after = Object.keys(storedMap()).length;
    expect(after).toBeLessThan(before);
    expect(after).toBeLessThanOrEqual(MAX_CACHED_MINI_ICONS);
  });

  it("stays silent when quota keeps failing", () => {
    saveCachedMuseMiniIcon("before", "data:before");
    const rawBefore = globalThis.localStorage.getItem(MINI_ICON_STORAGE_KEY);
    Object.defineProperty(globalThis, "localStorage", {
      value: makeMemoryStorage({
        throwOnSet: () => true,
      }),
      configurable: true,
      writable: true,
    });
    expect(() => saveCachedMuseMiniIcon("new", "data:new")).not.toThrow();
    resetMiniIconCache();
    expect(globalThis.localStorage.getItem(MINI_ICON_STORAGE_KEY)).toBeNull();
    expect(rawBefore).toContain("data:before");
  });

  it("evicts even when the saved id sorts ahead of the rest", () => {
    for (let i = 2; i <= MAX_CACHED_MINI_ICONS + 1; i++) {
      saveCachedMuseMiniIcon(String(i), `data:${i}`);
    }
    saveCachedMuseMiniIcon("1", "data:1");
    expect(Object.keys(storedMap())).toHaveLength(MAX_CACHED_MINI_ICONS);
    expect(cachedMuseMiniIcon("1")).toBe("data:1");
    expect(cachedMuseMiniIcon("2")).toBeUndefined();
  });

  it("sheds oldest icons past the byte budget", () => {
    const big = (n: number) => `data:${"x".repeat(300_000)}:${n}`;
    for (let i = 0; i < 8; i++) {
      saveCachedMuseMiniIcon(`big-${i}`, big(i));
    }
    const raw = globalThis.localStorage.getItem(MINI_ICON_STORAGE_KEY)!;
    expect(raw.length).toBeLessThanOrEqual(MAX_CACHED_MINI_ICON_BYTES);
    expect(cachedMuseMiniIcon("big-7")).toBe(big(7));
    expect(cachedMuseMiniIcon("big-0")).toBeUndefined();
  });
});
