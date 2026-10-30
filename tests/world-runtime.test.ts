import { describe, expect, it } from "vitest";
import { STAGE_HTML } from "../src/features/game/world/runtime/stageDom";

describe("native world runtime (Phase 0A)", () => {
  it("stage host markup has no iframe and no legacy chrome stacks", () => {
    expect(STAGE_HTML).not.toContain("<iframe");
    expect(STAGE_HTML).toContain('id="c"');
    for (const id of ["tray", "beltb", "belt", "pcard", "mr", "intro", "bub", "toast", "fade"]) {
      expect(STAGE_HTML).toContain(`id="${id}"`);
    }
  });

  it("runtime source uses Timer, AbortController and dispose contract", async () => {
    const src = await import("../src/features/game/world/runtime/world.ts?raw").catch(() => null);
    // Vite ?raw is unavailable in vitest node env; fall back to fs.
    const text = src ? String((src as { default: string }).default) : await (await import("node:fs/promises")).readFile(new URL("../src/features/game/world/runtime/world.ts", import.meta.url), "utf8");
    expect(text).toContain("new T.Timer()");
    expect(text).not.toContain("new T.Clock()");
    expect(text).toContain("AbortController");
    expect(text).toContain("ResizeObserver");
    expect(text).toContain("dispose");
    expect(text).not.toContain("setInterval(poll");
  });

  it("StrictMode double-mount lifecycle contract is present in source", async () => {
    const text = await (await import("node:fs/promises")).readFile(new URL("../src/features/game/world/runtime/world.ts", import.meta.url), "utf8");
    expect(text).toContain("cancelAnimationFrame(rafId)");
    expect(text).toContain('hostEl.innerHTML=""');
    expect(text).toContain("renderer.dispose()");
    // Exactly one canvas is created from stage markup per mount.
    expect(STAGE_HTML.match(/<canvas/g)?.length).toBe(1);
  });
});
