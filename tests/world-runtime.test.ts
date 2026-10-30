import { describe, expect, it } from "vitest";
import { STAGE_CSS, STAGE_HTML } from "../src/features/game/world/runtime/stageDom";

describe("native world runtime (Phase 0A)", () => {
  it("stage host markup has no iframe and no legacy chrome stacks", () => {
    expect(STAGE_HTML).not.toContain("<iframe");
    expect(STAGE_HTML).toContain('id="c"');
    for (const id of ["tray", "beltb", "belt", "pcard", "mr", "intro", "bub", "toast", "fade"]) {
      expect(STAGE_HTML).toContain(`id="${id}"`);
    }
  });

  it("stage CSS hides React-owned backing sheets and has valid scoped keyframes/braces", () => {
    const opens = (STAGE_CSS.match(/\{/g) ?? []).length;
    const closes = (STAGE_CSS.match(/\}/g) ?? []).length;
    expect(opens).toBe(closes);
    expect(STAGE_CSS).not.toContain(":root");
    expect(STAGE_CSS).not.toMatch(/\.tv-stage-canvas-host\s+\d+%/);
    for (const hiddenId of ["#sheet", "#mp", "#cr", "#ed", "#ed-io", "#ed-back"]) {
      expect(STAGE_CSS).toContain(`.tv-stage-canvas-host ${hiddenId}`);
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

  it("StrictMode double-mount lifecycle, stock setToy(null), and host listener cleanup are present", async () => {
    const fs = await import("node:fs/promises");
    const text = await fs.readFile(new URL("../src/features/game/world/runtime/world.ts", import.meta.url), "utf8");
    const engineText = await fs.readFile(new URL("../src/features/game/world/engine.ts", import.meta.url), "utf8");
    expect(text).toContain("cancelAnimationFrame(rafId)");
    expect(text).toContain("clearTimers()");
    expect(text).toContain('hostEl.innerHTML=""');
    expect(text).toContain("renderer.dispose()");
    expect(text).toContain('if(!contract){ S.type="vehicle"; S.sel=stockSel(); S.col=stockCol();');
    expect(engineText).toContain("hostCtrl.abort()");
    // Exactly one canvas is created from stage markup per mount.
    expect(STAGE_HTML.match(/<canvas/g)?.length).toBe(1);
  });

  it("legacy /world/ToyVentor-World.html redirect reaches the Worker in production assets config", async () => {
    const fs = await import("node:fs/promises");
    const wranglerRaw = await fs.readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
    const wranglerJson = JSON.parse(wranglerRaw.replace(/^\s*\/\/.*$/gm, "")) as {
      assets?: { not_found_handling?: string; run_worker_first?: string[] | boolean };
    };
    expect(wranglerJson.assets?.not_found_handling).toBe("single-page-application");
    expect(wranglerJson.assets?.run_worker_first).toEqual(
      expect.arrayContaining(["/api/*", "/world/ToyVentor-World.html"]),
    );

    const workerMod = await import("../worker/index");
    const res = await workerMod.default.fetch(
      new Request("https://toyventor.com/world/ToyVentor-World.html", {
        headers: { accept: "text/html,application/xhtml+xml" },
      }),
      {} as never,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
  });

  it("scores failed evaluated tries without penalizing multi-stage steps and supports clean mission replay", async () => {
    const text = await (await import("node:fs/promises")).readFile(
      new URL("../src/features/game/world/runtime/world.ts", import.meta.url),
      "utf8",
    );
    expect(text).not.toContain("mTry(");
    expect(text).toContain("function mFailNote(m)");
    expect(text).toContain("attempts:(S.ma[k]||0)+1");
    expect(text).toContain("stats:Object.keys(st).filter");
    expect(text).toContain("function mStartReplay(m)");
    expect(text).toContain("function mCancelReplay(m)");
  });
});
