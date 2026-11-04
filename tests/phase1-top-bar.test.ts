import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Toy } from "../shared/toy";
import { seedCar, seedFigure, seedKip } from "../src/features/scan/scan";
import { loadDemoMode, saveDemoMode } from "../src/lib/demoMode";
import {
  cachedMuseMiniIcon,
  maybeUpgradeToyMiniIcon,
  resetMiniIconUpgradeAttempts,
  resolveToyMiniIcon,
} from "../src/lib/toyIcon";
import { clearSkin, saveSkin } from "../src/state/skins";

function makeMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => {
      map.delete(k);
    },
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
  };
}

describe("Phase 1: Toy Box mini-icon fallback chain, single parent entry & Demo Mode v1", () => {
  const originalStorage = globalThis.localStorage;

  beforeEach(() => {
    resetMiniIconUpgradeAttempts();
    Object.defineProperty(globalThis, "localStorage", {
      value: makeMemoryStorage(),
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(globalThis, "localStorage", {
      value: originalStorage,
      configurable: true,
      writable: true,
    });
  });

  it("resolves built-in seed SVG -> SAM cutout -> silhouette -> glyph synchronously", () => {
    expect(resolveToyMiniIcon(seedKip)).toEqual({ kind: "svg", variant: "kip" });
    expect(resolveToyMiniIcon(seedCar)).toEqual({ kind: "svg", variant: "car" });
    expect(resolveToyMiniIcon(seedFigure)).toEqual({
      kind: "svg",
      variant: "figure",
    });

    const samToy: Toy = {
      id: "scan-cup-1",
      name: "Blue Cup Bot",
      kind: "other",
      sizeClass: "small",
      lengthMm: 95,
      widthMm: 60,
      attachPoints: [{ id: "top", label: "Top" }],
      source: "scan",
      imageDataUrl: "data:image/jpeg;base64,AAEC",
      outline: { x1: 0.1, y1: 0.1, x2: 0.9, y2: 0.9 },
      mask: {
        coverage: 0.42,
        outline: { x1: 0.12, y1: 0.14, x2: 0.88, y2: 0.9 },
        pixelWidth: 100,
        pixelHeight: 100,
        centroid: { x: 0.5, y: 0.5 },
        topAnchor: { x: 0.5, y: 0.15 },
        widestAnchor: { x: 0.5, y: 0.6 },
        silhouette: { path: "M1 1H9V9H1Z", width: 10, height: 10 },
      },
    };
    const cutout = resolveToyMiniIcon(samToy);
    expect(cutout.kind).toBe("cutout");
    if (cutout.kind === "cutout") {
      expect(cutout.src).toBe("data:image/jpeg;base64,AAEC");
      expect(cutout.silhouette?.path).toBe("M1 1H9V9H1Z");
      expect(cutout.cropBox).toEqual({ x1: 0.12, y1: 0.14, x2: 0.88, y2: 0.9 });
    }

    const silhouetteOnly: Toy = { ...samToy, id: "scan-sil-1", imageDataUrl: undefined };
    expect(resolveToyMiniIcon(silhouetteOnly)).toEqual({
      kind: "silhouette",
      silhouette: { path: "M1 1H9V9H1Z", width: 10, height: 10 },
    });

    const manualNoPhoto: Toy = {
      ...samToy,
      id: "manual-1",
      source: "manual",
      imageDataUrl: undefined,
      outline: undefined,
      mask: undefined,
    };
    expect(resolveToyMiniIcon(manualNoPhoto)).toEqual({
      kind: "glyph",
      toyKind: "other",
    });

    // Kid-painted Muse skin takes priority, and skipMuse falls back cleanly
    saveSkin(samToy.id, "data:image/png;base64,SKIN");
    expect(resolveToyMiniIcon(samToy)).toEqual({
      kind: "muse",
      src: "data:image/png;base64,SKIN",
    });
    expect(resolveToyMiniIcon(samToy, { skipMuse: true }).kind).toBe("cutout");
    clearSkin(samToy.id);
  });

  it("runs async Muse Image mini-icon upgrade strictly off the render path and caches once per toy", async () => {
    vi.useFakeTimers();
    const scanned: Toy = {
      id: "scan-racer-9",
      name: "Super Long Custom Scanned Wooden Racer Name",
      kind: "car",
      sizeClass: "small",
      lengthMm: 100,
      widthMm: 50,
      attachPoints: [{ id: "roof", label: "Roof" }],
      source: "scan",
      imageDataUrl: "data:image/jpeg;base64,SCANPHOTO",
    };

    const fetcher = vi.fn(async () => ({
      imageDataUrl: "data:image/png;base64,MUSEICON",
      skin: { applied: true, status: "ok" },
    }));
    const upgraded: string[] = [];

    // Built-in seed toys never trigger network icon upgrades
    maybeUpgradeToyMiniIcon(seedCar, (u) => upgraded.push(u), fetcher);
    await vi.runAllTimersAsync();
    expect(fetcher).not.toHaveBeenCalled();

    // Scanned toy schedules off-render-path (0 synchronous calls before timers run)
    maybeUpgradeToyMiniIcon(scanned, (u) => upgraded.push(u), fetcher);
    expect(fetcher).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(upgraded).toEqual(["data:image/png;base64,MUSEICON"]);
    expect(cachedMuseMiniIcon(scanned.id)).toBe("data:image/png;base64,MUSEICON");
    expect(resolveToyMiniIcon(scanned)).toEqual({
      kind: "muse",
      src: "data:image/png;base64,MUSEICON",
    });

    // Subsequent mounts reuse cached icon with zero network calls
    maybeUpgradeToyMiniIcon(scanned, (u) => upgraded.push(u), fetcher);
    await vi.runAllTimersAsync();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("defaults Demo Mode v1 to Off and persists toggle changes", () => {
    expect(loadDemoMode()).toBe(false);
    saveDemoMode(true);
    expect(loadDemoMode()).toBe(true);
    saveDemoMode(false);
    expect(loadDemoMode()).toBe(false);
  });

  it("consolidates Grown-ups to the top-bar ⚙️ control and keeps SleepCurtain intact", () => {
    const root = process.cwd();
    const myToySrc = readFileSync(
      join(root, "src/features/game/world/MyToySheet.tsx"),
      "utf8",
    );
    const canvasSrc = readFileSync(
      join(root, "src/features/game/world/GameCanvas.tsx"),
      "utf8",
    );
    const sleepSrc = readFileSync(
      join(root, "src/features/game/world/SleepCurtain.tsx"),
      "utf8",
    );

    // Duplicate parent entries removed from MyToySheet and `⋯` overflow menu
    expect(myToySrc).not.toContain("onOpenGrownUps");
    expect(myToySrc).not.toContain("Grown-ups");
    expect(canvasSrc).toContain('className="tv-toy-pill-name">Toy Box</span>');
    expect(canvasSrc).toContain('className="tv-ctl tv-ctl-gear tv-navstrip-btn"');
    expect(canvasSrc).not.toContain("<span>Grown-ups</span>");

    // SleepCurtain door preserved
    expect(sleepSrc).toContain("onOpenGrownUps");
    expect(canvasSrc).toContain("<SleepCurtain");
  });
});
