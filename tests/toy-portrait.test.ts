import { describe, expect, it } from "vitest";
import {
  isPortraitUrl,
  loadToyPortrait,
  PORTRAIT_PX,
  saveToyPortrait,
  toyPortraitSignature,
  type PortraitStorage,
} from "../src/lib/toyPortrait";

const base = {
  toyId: "seed-kip",
  type: "character",
  sel: { hat: "cap", hair: "short", base: "kip" },
  col: { c1: "#ffd24d", c2: "#52b7ff", skin: "#f2b98c" },
};

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

function memory(): PortraitStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

describe("toy portrait signature", () => {
  it("is the same for the same outfit, whatever order the keys come in", () => {
    const a = toyPortraitSignature(base);
    expect(toyPortraitSignature({ ...base, sel: { base: "kip", hair: "short", hat: "cap" } })).toBe(a);
    expect(toyPortraitSignature({ ...base, col: { skin: "#f2b98c", c2: "#52b7ff", c1: "#ffd24d" } })).toBe(a);
    expect(a).toMatch(/^[0-9a-z]+$/);
  });

  it("changes when the toy, the outfit or a colour changes", () => {
    const a = toyPortraitSignature(base);
    expect(toyPortraitSignature({ ...base, toyId: "seed-car" })).not.toBe(a);
    expect(toyPortraitSignature({ ...base, type: "vehicle" })).not.toBe(a);
    expect(toyPortraitSignature({ ...base, sel: { ...base.sel, hat: "crown" } })).not.toBe(a);
    expect(toyPortraitSignature({ ...base, col: { ...base.col, c1: "#ff5a4d" } })).not.toBe(a);
    // A missing toy id is a different (but valid) key, not a crash.
    expect(toyPortraitSignature({ ...base, toyId: null })).not.toBe(a);
  });
});

describe("only a real PNG picture is ever shown", () => {
  it("accepts a PNG data URL and refuses everything else", () => {
    expect(isPortraitUrl(PNG)).toBe(true);
    for (const bad of [
      "",
      "https://example.com/a.png",
      "javascript:alert(1)",
      "data:text/html;base64,PGgxPg==",
      "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
      "data:image/png;base64,not base64!",
      "data:image/png;base64," + "A".repeat(200_001),
      null,
      42,
      {},
    ]) {
      expect(isPortraitUrl(bad as unknown), String(bad).slice(0, 30)).toBe(false);
    }
  });
});

describe("keeping a portrait on the device", () => {
  it("round-trips for the same outfit and misses for a different one", () => {
    const store = memory();
    const sig = toyPortraitSignature(base);
    expect(loadToyPortrait("seed-kip", sig, store)).toBeNull();
    expect(saveToyPortrait({ toyId: "seed-kip", sig, url: PNG }, store)).toBe(true);
    expect(loadToyPortrait("seed-kip", sig, store)).toBe(PNG);
    // A new hat is a new signature: the old picture is not shown for it.
    const other = toyPortraitSignature({ ...base, sel: { ...base.sel, hat: "crown" } });
    expect(loadToyPortrait("seed-kip", other, store)).toBeNull();
    // Another toy is its own entry.
    expect(loadToyPortrait("seed-car", sig, store)).toBeNull();
  });

  it("keeps one picture per toy: a newer outfit replaces the older", () => {
    const store = memory();
    const a = toyPortraitSignature(base);
    const b = toyPortraitSignature({ ...base, col: { ...base.col, c1: "#000000" } });
    saveToyPortrait({ toyId: "seed-kip", sig: a, url: PNG }, store);
    saveToyPortrait({ toyId: "seed-kip", sig: b, url: PNG }, store);
    expect(store.data.size).toBe(1);
    expect(loadToyPortrait("seed-kip", b, store)).toBe(PNG);
    expect(loadToyPortrait("seed-kip", a, store)).toBeNull();
  });

  it("refuses to keep or show anything untrustworthy", () => {
    const store = memory();
    const sig = toyPortraitSignature(base);
    expect(saveToyPortrait({ toyId: "seed-kip", sig, url: "https://evil.example/x.png" }, store)).toBe(false);
    expect(saveToyPortrait({ toyId: "", sig, url: PNG }, store)).toBe(false);
    expect(store.data.size).toBe(0);
    // Something else written under the key (old build, hand edit) is not shown.
    store.setItem("tvToyPortrait:v1:seed-kip", JSON.stringify({ sig, url: "javascript:alert(1)" }));
    expect(loadToyPortrait("seed-kip", sig, store)).toBeNull();
    store.setItem("tvToyPortrait:v1:seed-kip", "{not json");
    expect(loadToyPortrait("seed-kip", sig, store)).toBeNull();
  });

  it("survives storage that is missing, full or blocked", () => {
    const sig = toyPortraitSignature(base);
    expect(loadToyPortrait("seed-kip", sig, null)).toBeNull();
    expect(saveToyPortrait({ toyId: "seed-kip", sig, url: PNG }, null)).toBe(false);
    const full: PortraitStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(loadToyPortrait("seed-kip", sig, full)).toBeNull();
    expect(saveToyPortrait({ toyId: "seed-kip", sig, url: PNG }, full)).toBe(false);
  });

  it("is a small picture", () => {
    expect(PORTRAIT_PX).toBeGreaterThanOrEqual(96);
    expect(PORTRAIT_PX).toBeLessThanOrEqual(192);
  });
});
