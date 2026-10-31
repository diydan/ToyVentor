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
    expect(text).toContain('if(!contract){ S.type="character"; S.sel=stockSel(); S.col=stockCol();');
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
    expect(text).toContain("attempts:(S.ma[akk]||0)+1");
    expect(text).toContain("stats:Object.keys(st).filter");
    expect(text).toContain("function mStartReplay(m)");
    expect(text).toContain("function mCancelReplay(m)");
  });

  it("tracks tiered mission errors per tier, stamps #mp dataset.tier, and resyncs 3D state on setTier", async () => {
    const text = await (await import("node:fs/promises")).readFile(
      new URL("../src/features/game/world/runtime/world.ts", import.meta.url),
      "utf8",
    );
    // Bug 1: no untiered S.me[mid(m)] writes; measure, balance, and lever all write S.me[mkk(m)].
    expect(text).not.toContain("S.me[mid(m)]");
    expect(text.match(/S\.me\[mkk\(m\)\]/g)?.length).toBeGreaterThanOrEqual(6);

    // Bug 2 & 4: #mp stamps dataset.tier across mReplayPrompt, mPanel, and mtPanel.
    expect(text.match(/\$\("#mp"\)\.dataset\.tier=String\(mTier\(m\)\)/g)?.length).toBe(3);

    // Bug 2: measure scales unit width by 3/gap and rebuilds ruler posts; balance stacks L/2; logic initializes NOT gate with A=1.
    expect(text).toContain("u:function(m){return 3/this.gap(m)}");
    expect(text).toContain("if(m.rgG!==G){clearG(m.rg);m.rgG=G;");
    expect(text).toContain("stack(-1.5,this.tq(m).L/2,lm)");
    expect(text).toContain("s.A=this.ord(m)[0]===2?1:0");

    // Bug 2: setTier refunds placed bin parts, resets step state to {tier:t}, and syncs 3D meshes.
    expect(text).toContain('["deck","support","mid","drum"].forEach(function(sl){if(old[sl])S.bin[old[sl]]=(S.bin[old[sl]]||0)+1})');
    expect(text).toContain("S.ms[k]={tier:t};if(MT[m.type]){MT[m.type].st&&MT[m.type].st(m);MT[m.type].sync(m)}else mSync(m)");

    // Bug 3: logic failure toast branches on gate kind gk rather than door index s.g; raft distinguishes 0 <= net < need.
    expect(text).toContain("gk=O[Math.min(s.g,O.length-1)]");
    expect(text).toContain('gk===0?"Shut. OR needs at least one plate pressed."');
    expect(text).toContain('Almost! Up beats down by "+n.n+", and this tier needs +"+need+". Try barrels and logs.');
  });

  it("Unit 2 keeps shared static content init-once in modules (StrictMode remount safe)", async () => {
    const fs = await import("node:fs/promises");
    const text = await fs.readFile(
      new URL("../src/features/game/world/runtime/world.ts", import.meta.url),
      "utf8",
    );
    // Static table fills must not run per factory call: a second
    // createWorldRuntime (StrictMode remount) would duplicate LEVELS and
    // double-wrap sfx. They live at module import time instead.
    expect(text).not.toContain("LEVELS.push(");
    expect(text).not.toContain("WORLDS=");
    expect(text).not.toContain("sfx[k]=");

    const { LEVELS, WORLDS } = await import(
      "../src/features/game/world/runtime/catalog"
    );
    const ids = LEVELS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const lab of ["lab1", "lab2", "lab3", "lab4", "lab5", "lab6"]) {
      expect(ids).toContain(lab);
    }
    for (const id of ids) {
      expect(WORLDS[id]).toBeDefined();
    }
    for (const biome of ["garden", "sky", "junk"]) {
      expect(WORLDS[biome]).toBeDefined();
    }
  });

  it("Unit 2 audio primitives no-op cleanly without an AudioContext", async () => {
    const audio = await import("../src/features/game/world/runtime/audio");
    expect(Object.keys(audio.sfx).sort()).toEqual([
      "bolt", "bump", "crash", "found", "glow",
      "pop", "shove", "snap", "whirl", "zoom",
    ]);
    expect(() => {
      const keys = Object.keys(audio.sfx) as (keyof typeof audio.sfx)[];
      for (const k of keys) audio.sfx[k]();
      audio.partSound("character.base.creature");
      audio.partSound("nope.missing.part");
      audio.toolSound("screwdriver");
      audio.toolSound("spanner");
      audio.toolSound("wrench");
      audio.bellTone("red");
      audio.motor(0.5);
      audio.mnote(69, 0, 0.3, "triangle", 0.05);
      audio.kick(0);
      audio.hit(0, 1800, 0.12, 0.07);
      audio.musInit();
      audio.musGain(0.5, 1);
      audio.noteGesture();
    }).not.toThrow();
    expect(audio.toggleSound()).toBe(false);
    expect(audio.toggleSound()).toBe(true);
  });

  it("retires the theatrical fix warning and meshes background gears", async () => {
    const fs = await import("node:fs/promises");
    const text = await fs.readFile(
      new URL("../src/features/game/world/runtime/world.ts", import.meta.url),
      "utf8",
    );
    // Unit 2b: gear builder lives in worldScene.ts; mesh calls stay in world.
    const sceneText = await fs.readFile(
      new URL("../src/features/game/world/runtime/worldScene.ts", import.meta.url),
      "utf8",
    );
    expect(text).not.toContain("Fix it for me");
    expect(text).not.toContain("function checkBad(");
    expect(text).not.toContain("FLAG={");
    expect(text).not.toContain("S.fixed");
    expect(text).toContain("Ready to 3D print");
    expect(sceneText).toContain("function gear(r: number, th: number, mat: THREE.Material, teeth?: number)");
    expect(text).toContain("gear(.9,.2,plastic(\"#2c3f94\"),12)");
    expect(text).toContain("gear(.6,.2,plastic(\"#3c55b8\"),8)");
    expect(text).toContain("gears[1].rotation.y-=dt*.9");
  });
});
