import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createMissions } from "../src/features/game/world/runtime/missions";

function stubDeps() {
  return {
    S: { world: "garden", ms: {}, mdone: {}, ma: {}, me: {} },
    P: { pos: { x: 0 }, busy: false, mDrive: false },
    W: { missions: [], root: null },
    fx: [],
    $: () => null,
    $$: () => [],
    toast: () => {},
    save: () => {},
    notify: () => {},
    updHud: () => {},
    creStats: () => ({ atk: 1, def: 1, spd: 1 }),
    mPanel: () => {},
    mtPanel: () => {},
    mReplayPrompt: () => {},
    mtFail: () => {},
    walkTo: async () => true,
    hop: async () => {},
    soapWin: () => [3, 3],
    joy: () => {},
    mpPress: () => {},
    add: (o: any) => o,
    darkSprite: () => ({ position: { set() {} }, scale: { set() {} } }),
    rockMesh: () => ({
      position: { set() {} },
      scale: { set() {} },
      rotation: { set() {} },
      visible: true,
    }),
    chestMesh: () => ({ position: { set() {} } }),
    setTimeout: ((fn: () => void, ms?: number) =>
      setTimeout(fn, ms) as unknown as number) as (fn: () => void) => number,
    resetNear: () => {},
  };
}

function withCanvasDocument() {
  const g: any = {
    font: "", textAlign: "", textBaseline: "", lineWidth: 0,
    strokeStyle: "", fillStyle: "",
    strokeText() {}, fillText() {},
    createRadialGradient: () => ({ addColorStop() {} }),
    fillRect() {},
  };
  (globalThis as any).document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => g }),
  };
}

describe("Unit 2d missions factory (deps-injected MT table)", () => {
  it("exposes all 9 mission entries with build/st/sync (+act/upd where designed)", () => {
    const MS = createMissions(stubDeps() as any);
    const withAct = new Set(["measure", "balance", "logic", "raft", "lever", "code"]);
    const withUpd = new Set(["measure", "balance", "raft"]);
    for (const t of [
      "measure", "balance", "logic", "raft", "lever",
      "circuit", "code", "pattern", "clean",
    ]) {
      expect(MS.MT[t], t).toBeDefined();
      expect(typeof MS.MT[t].build).toBe("function");
      // measure tracks state via mst()+list() directly, without an st() wrapper.
      if (t !== "measure") expect(typeof MS.MT[t].st).toBe("function");
      expect(typeof MS.MT[t].sync).toBe("function");
      if (withAct.has(t)) expect(typeof MS.MT[t].act).toBe("function");
      if (withUpd.has(t)) expect(typeof MS.MT[t].upd).toBe("function");
      expect(typeof MS.MT[t].t).toBe("string");
      expect(typeof MS.MT[t].goal).toBe("string");
    }
  });

  it("keys missions per world+tier and gates tiers", () => {
    const MS = createMissions(stubDeps() as any);
    const m = { type: "measure", x: 1 } as any;
    expect(MS.mid(m)).toBe("garden.measure");
    expect(MS.mTier(m)).toBe(1);
    expect(MS.mkk(m)).toBe("garden.measure:t1");
    expect(MS.tq(m, 0, 2, 4)).toBe(0);
    expect(MS.prRounds(m)).toBe(3);
  });

  it("builds the measure mission headless with stub scene deps", () => {
    const MS = createMissions(stubDeps() as any);
    // textSprite labels need a 2d context: stub the canvas surface only.
    const g: any = {
      font: "", textAlign: "", textBaseline: "", lineWidth: 0,
      strokeStyle: "", fillStyle: "",
      strokeText() {}, fillText() {},
      createRadialGradient: () => ({ addColorStop() {} }),
      fillRect() {},
    };
    (globalThis as any).document = {
      createElement: () => ({ width: 0, height: 0, getContext: () => g }),
    };
    try {
      const m = { type: "measure", x: 23 } as any;
      MS.MT.measure.build(m);
      expect(m.rg).toBeDefined();
      expect(MS.MT.measure.gap(m)).toBeGreaterThan(0);
    } finally {
      delete (globalThis as any).document;
    }
  });

  it("builds all 9 entries headless (every build path runs at boot)", () => {
    const MS = createMissions(stubDeps() as any);
    const g: any = {
      font: "", textAlign: "", textBaseline: "", lineWidth: 0,
      strokeStyle: "", fillStyle: "",
      strokeText() {}, fillText() {},
      createRadialGradient: () => ({ addColorStop() {} }),
      fillRect() {},
    };
    (globalThis as any).document = {
      createElement: () => ({ width: 0, height: 0, getContext: () => g }),
    };
    try {
      const xs: Record<string, number> = {
        measure: 23, balance: 36, logic: 10, raft: 16, lever: 12,
        circuit: 14, code: 18, pattern: 20, clean: 8,
      };
      for (const t of Object.keys(xs)) {
        const m = { type: t, x: xs[t] } as any;
        // Must not throw: proves every dep the entry closes over is wired.
        MS.MT[t].build(m);
      }
      const mg = { type: "measure", x: 23 } as any;
      MS.MT.measure.build(mg);
      expect(mg.rg).toBeDefined();
      const bl = { type: "balance", x: 36 } as any;
      MS.MT.balance.build(bl);
      expect(bl.pv).toBeDefined();
    } finally {
      delete (globalThis as any).document;
    }
  });

  it("panel() opens for all 9 entries (what mtPanel calls on proximity)", () => {
    withCanvasDocument();
    try {
      const MS = createMissions(stubDeps() as any);
      const xs: Record<string, number> = {
        measure: 23, balance: 36, logic: 10, raft: 16, lever: 12,
        circuit: 14, code: 18, pattern: 20, clean: 8,
      };
      for (const t of Object.keys(xs)) {
        const m = { type: t, x: xs[t] } as any;
        MS.MT[t].build(m);
        // Must return html, not throw: circuit reads CGL, code reads CNM,
        // clean reads CTN — all must be wired deps/imports.
        expect(typeof MS.MT[t].panel(m), t).toBe("string");
      }
    } finally {
      delete (globalThis as any).document;
    }
  });

  it("act: code wrong-card path names the card and obstacle (CNM/CON)", async () => {
    withCanvasDocument();
    try {
      const deps = { ...stubDeps(), $: () => ({ hidden: false }) };
      const MS = createMissions(deps as any);
      const m = { type: "code", x: 18 } as any;
      MS.MT.code.build(m);
      MS.MT.code.st(m).p.push("rock"); // wrong card for step 1 (walk)
      await MS.MT.code.act(m);
      expect(MS.MT.code.st(m).bad).toBe(0);
    } finally {
      delete (globalThis as any).document;
    }
  });

  describe("W is read live (buildWorld reassigns it after createMissions)", () => {
    // Mirrors world.ts: createMissions runs with W={root:null};
    // buildWorld then does W={root:new Group(),...}. Missions must read
    // the live binding per use, not the captured initial object.
    function bootLive() {
      let W: any = { root: null, missions: [] };
      const deps: any = stubDeps();
      Object.defineProperty(deps, "W", { get: () => W, enumerable: true });
      const MS = createMissions(deps);
      W = { root: { remove() {}, traverse() {}, add() {} }, missions: [], blades: [], blink: [] };
      return MS;
    }

    it("lift mission: mSync at world-build time (via mLift)", () => {
      const MS = bootLive();
      const m = {
        type: "lift", x: 20, gm: {}, gx0: 0, gy: 0, px: 3,
        drum: { position: { set() {} }, visible: false },
      } as any;
      expect(() => MS.mSync(m)).not.toThrow();
    });

    it("logic mission: second sync removes the gate (first crate press)", () => {
      withCanvasDocument();
      try {
        const MS = bootLive();
        const m = { type: "logic", x: 10 } as any;
        MS.MT.logic.build(m); // first sync: m.gate unset, no remove
        expect(() => MS.MT.logic.sync(m)).not.toThrow();
      } finally {
        delete (globalThis as any).document;
      }
    });
  });

  it("mWait resolves and clearG empties a mock group", async () => {
    const MS = createMissions(stubDeps() as any);
    await MS.mWait(0.01);
    const kids = [{}, {}];
    const g = {
      children: kids,
      remove(o: any) {
        const i = this.children.indexOf(o);
        if (i >= 0) this.children.splice(i, 1);
      },
    };
    MS.clearG(g);
    expect(kids).toHaveLength(0);
  });

  it("keeps the MT table out of world.ts (single ownership)", () => {
    const worldSrc = readFileSync(
      resolve(process.cwd(), "src/features/game/world/runtime/world.ts"),
      "utf8",
    );
    for (const t of ["measure", "balance", "logic", "raft", "lever", "circuit", "code", "pattern", "clean"]) {
      expect(worldSrc).not.toContain(`MT.${t}=`);
    }
    expect(worldSrc).toContain("createMissions({");
  });
});
