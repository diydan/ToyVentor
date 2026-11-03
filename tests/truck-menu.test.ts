import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error untyped JS module
import { buildTruckMenu, TRUCK_STAGES, TRUCK_CAMERAS } from "../parts/kip/viewer/truck-menu.js";
// @ts-expect-error untyped JS module
import { flattenMenu, buildPrintGroup, createMenuHost } from "../parts/kip/viewer/kip-menu.js";
// @ts-expect-error untyped JS module
import { buildYardMenu, YARD_FLOATS } from "../parts/kip/viewer/yard-menu.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const root = process.cwd();
// Since Workshop stage 4a the Truck page is a loader; its script lives in truck-bench.js. Since 4c its controls are a DECLARATION (truck-menu.js) drawn by the
// one menu (kip-menu.js), which replaced the Truck's own dock, drawer and print panel.
const bench = readFileSync(join(root, "parts/kip/viewer/truck-bench.js"), "utf8");

const pair = (initial: unknown) => {
  let v = initial;
  return { get: () => v, set: (x: unknown) => { v = x; } };
};
function fakeApi(over: Record<string, unknown> = {}) {
  const sel = (opts: string[], initial: string) => ({ options: () => opts.map((o) => ({ value: o, label: o })), ...pair(initial) });
  const print: any = {
    isOn: () => false, busy: () => false, summary: () => ({}), setOn: () => {}, plateCount: () => 0, plateIndex: () => 0, plateLabel: () => "", setPlate: () => {},
    profile: () => ({}), setPreset: () => {}, updateProfile: () => {}, supportCheck: () => false, setSupportCheck: () => {}, splitByColour: () => false, setSplitByColour: () => {}, download: () => {},
  };
  return {
    stage: pair("snap"), demo: pair(false), tip: { ...pair(22), min: () => 0 }, steer: pair(0), explode: pair(0),
    giant: pair(false), hood: pair(false), plow: pair(false), xray: pair("auto"), sweep: pair(false), drive: pair(false), kip: pair(true), rig: pair("pro"),
    head: sel(["a", "b"], "a"), hair: { ...sel(["off", "x"], "off"), visible: () => true }, hat: { ...sel(["off", "y"], "off"), visible: () => true },
    jet: { visible: () => false, balloon: sel(["125"], "125"), lean: sel(["0"], "0"), nozzle: sel(["3"], "3") },
    goCamera: () => {}, print, ...over,
  };
}

describe("Truck sections for the one menu (Workshop stage 4c)", () => {
  it("declares Stage, Motion, Options, Driver, Camera and then the very same Print group the Kip menu has", () => {
    const api = fakeApi();
    const groups = buildTruckMenu(api);
    expect(groups.map((g: any) => g.id)).toEqual(["stage", "motion", "options", "driver", "view", "print"]);
    const print = groups.at(-1);
    expect(print.controls.map((c: any) => c.id)).toEqual(buildPrintGroup(api.print).controls.map((c: any) => c.id));
  });

  it("has one control per id, so a label can never point into the wrong field", () => {
    const ids = flattenMenu(buildTruckMenu(fakeApi())).map((c: any) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every control carries what the menu draws it with: a kind, a label, and get/set or run", () => {
    for (const c of flattenMenu(buildTruckMenu(fakeApi()))) {
      expect(["select", "toggle", "range", "action", "info", "swatch", "preview"], c.id).toContain(c.kind);
      if (c.kind === "action") expect(typeof c.run, c.id).toBe("function");
      else if (c.kind === "select" || c.kind === "toggle" || c.kind === "range") {
        expect(typeof c.get, c.id).toBe("function");
        expect(typeof c.set, c.id).toBe("function");
      }
    }
  });

  it("the stage control lists the ladder in order and writes through to the bench", () => {
    const api = fakeApi();
    const stage = flattenMenu(buildTruckMenu(api)).find((c: any) => c.id === "stage");
    expect(stage.options().map((o: any) => o.value)).toEqual(TRUCK_STAGES.map((s: any) => s.id));
    stage.set("pro");
    expect(stage.get()).toBe("pro");
  });

  it("the dump-tip slider takes its minimum from the stage, and the steer slider is bounded by the widest lock", () => {
    let min = 0;
    const c = flattenMenu(buildTruckMenu(fakeApi({ tip: { ...pair(22), min: () => min } })));
    const tip = c.find((x: any) => x.id === "tip");
    expect(tip.min()).toBe(0);
    min = 12;
    expect(tip.min()).toBe(12);
    const steer = c.find((x: any) => x.id === "steer");
    expect([steer.min, steer.max]).toEqual([-34, 34]);
  });

  it("the balloon-jet controls show only in the jet stage; hair only when the head can wear it; hat only when the wig has studs", () => {
    let jet = false, hair = true, hat = true;
    const all = flattenMenu(buildTruckMenu(fakeApi({
      jet: { visible: () => jet, balloon: { options: () => [], get: () => "", set: () => {} }, lean: { options: () => [], get: () => "", set: () => {} }, nozzle: { options: () => [], get: () => "", set: () => {} } },
      hair: { options: () => [], get: () => "off", set: () => {}, visible: () => hair },
      hat: { options: () => [], get: () => "off", set: () => {}, visible: () => hat },
    })));
    const vis = (id: string) => all.find((c: any) => c.id === id).visibleWhen();
    expect(["jetBalloon", "jetLean", "jetNozzle"].map(vis)).toEqual([false, false, false]);
    jet = true; hair = false; hat = false;
    expect(["jetBalloon", "jetLean", "jetNozzle"].map(vis)).toEqual([true, true, true]);
    expect([vis("hair"), vis("hat")]).toEqual([false, false]);
  });

  it("the camera presets are four actions that call the bench with the preset's id", () => {
    const seen: string[] = [];
    const cams = flattenMenu(buildTruckMenu(fakeApi({ goCamera: (id: string) => seen.push(id) }))).filter((c: any) => c.id.startsWith("cam-"));
    expect(cams).toHaveLength(TRUCK_CAMERAS.length);
    cams.forEach((c: any) => c.run());
    expect(seen).toEqual(TRUCK_CAMERAS.map((c: any) => c.id));
    for (const c of TRUCK_CAMERAS) expect([c.position.length, c.target.length]).toEqual([3, 3]);
  });

  it("the Print group hides stickers and stencils for a source with no artwork (a mechanism bench), and shows them for the Kip", () => {
    const pr: any = { ...fakeApi().print, isOn: () => true, summary: () => ({ art: false, hasDecals: true }), profile: () => ({ includeStencils: true, includeStickers: true, presetId: "x" }) };
    const hidden = flattenMenu([buildPrintGroup(pr)]);
    for (const id of ["stencils", "exportStencils"]) expect(hidden.find((c: any) => c.id === id).visibleWhen(), id).toBe(false);
    pr.summary = () => ({ art: true, hasDecals: true });
    const shown = flattenMenu([buildPrintGroup(pr)]);
    for (const id of ["stencils", "exportStencils"]) expect(shown.find((c: any) => c.id === id).visibleWhen(), id).toBe(true);
  });
});

describe("a host with no file exits (Workshop 4d: the game mounts with downloads: false)", () => {
  it("the Truck's declaration has no Print group without a print adapter, and everything else is unchanged", () => {
    const withPrint = buildTruckMenu(fakeApi()).map((g: any) => g.id);
    const { print: _print, ...noPrint } = fakeApi();
    const without = buildTruckMenu(noPrint).map((g: any) => g.id);
    expect(withPrint).toEqual(["stage", "motion", "options", "driver", "view", "print"]);
    expect(without).toEqual(["stage", "motion", "options", "driver", "view"]);
  });

  it("the shell passes the switch to every bench, and each bench drops its file exits when it is off", () => {
    const read = (f: string) => readFileSync(join(root, "parts/kip/viewer", f), "utf8");
    expect(read("workshop.js")).toContain("features: { downloads: opts.downloads !== false }");
    expect(read("workshop.js")).toContain("if (opts.downloads === false) pop.hidden = true;");
    const kip = read("kip-bench.js");
    expect(kip).toContain("const downloadsOn = env.features?.downloads !== false;");
    expect(kip).toContain("if (!downloadsOn) delete kipMenuCtx.print;");
    expect(kip).toContain("if (!downloadsOn) $el('btn-print-photo').hidden = true;");
    expect(kip).toContain("downloads: downloadsOn,");
    expect(read("kip-selfie.js")).toContain("if (ctx.downloads === false) $('sf-sticker').hidden = true;");
    expect(bench).toContain("if (env.features?.downloads === false) delete truckMenuApi.print;");
    expect(bench).toContain("renderStickerSources: truckStickerSources({ makeFace: createDecalExpressionCanvas, makeShirt: createTorsoOutfitDecalCanvas, skinTones: SKIN_TONES })");
  });

  it("the game launcher mounts the shell with downloads off and pauses the world while it is open", () => {
    const src = readFileSync(join(root, "src/features/game/world/WorkshopLauncher.tsx"), "utf8");
    expect(src).toContain("downloads: false");
    expect(src).toContain("urlSync: false");
    expect(src).toContain("setPaused(true)");
    expect(src).toContain("setPaused(false)");
    expect(src).toMatch(/new URL\(WORKSHOP_ENTRY, window\.location\.origin\)/); // the full-origin entry import (spiked): a literal /kip path breaks Vite
    expect(src).not.toMatch(/<iframe/i);
    expect(readFileSync(join(root, "src/features/game/world/GameCanvas.tsx"), "utf8")).toContain("<WorkshopLauncher engine={engineRef}");
  });
});

describe("Yard sections for the one menu (Workshop 4c leftover)", () => {
  const api = () => {
    let f = "0";
    const calls: string[] = [];
    return { calls, api: { float: { get: () => f, set: (v: string) => { f = v; } }, home: () => calls.push("home"), readout: () => "Speed 0 m/s" } };
  };

  it("declares a Roller group (front axle, back to the start, the readout) and a Keys group, and no Print group", () => {
    const { api: a } = api();
    const groups = buildYardMenu(a);
    expect(groups.map((g: any) => g.id)).toEqual(["roller", "keys"]);
    expect(flattenMenu(groups).map((c: any) => c.id)).toEqual(["yardFloat", "yardHome", "yardReadout", "yardKeys"]);
    const ids = flattenMenu(groups).map((c: any) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("the front-axle control offers the three positions and writes through; Home calls the bench; the readout is the bench's text", () => {
    const { api: a, calls } = api();
    const c = flattenMenu(buildYardMenu(a));
    const float = c.find((x: any) => x.id === "yardFloat");
    expect(float.options().map((o: any) => o.value)).toEqual(YARD_FLOATS.map((o: any) => o.value));
    float.set("2");
    expect(float.get()).toBe("2");
    c.find((x: any) => x.id === "yardHome").run();
    expect(calls).toEqual(["home"]);
    expect(c.find((x: any) => x.id === "yardReadout").text()).toBe("Speed 0 m/s");
  });

  it("the Yard bench shows it through the shared host, keeps its published handle's ctx, and tears down the menu with the bench", () => {
    const src = readFileSync(join(root, "parts/kip/viewer/yard-bench.js"), "utf8");
    expect(src).toContain("buildYardMenu({");
    expect(src).toContain("menuHost.show('yard', yardMenuCtx, { root: benchRoot })");
    expect(src).toContain("{ ctx: { get: () => yardMenuCtx, enumerable: true } }");
    expect(src).toContain("if (sharedMenu) sharedMenu.hide('yard'); else menuHost.destroy();");
    expect(src).toContain("'yardMenu'");
    expect(src).toContain("menuHost.hide('yard');");
  });
});

describe("one menu host", () => {
  it("is a module with the host API, and the benches use it instead of mounting their own panel", () => {
    expect(typeof createMenuHost).toBe("function");
    for (const f of ["kip-bench.js", "truck-bench.js"]) {
      const src = readFileSync(join(root, "parts/kip/viewer", f), "utf8");
      expect(src, f).toMatch(/createMenuHost\(\)/);
      expect(src, f).toMatch(/env\.sharedMenu/);
      expect(src, f).not.toMatch(/mountKipMenu\(/);
    }
  });
});

describe("Truck bench: no dock of its own any more", () => {
  it("has no dock, drawer, print panel or per-control buttons left in the markup or the script", () => {
    for (const gone of ['id="truck-dock"', 'id="truck-menu-toggle"', 'truck-menu-backdrop', 'id="print-panel"', "setTruckMenu", "syncSliders", "syncKipButtons", 'id="btn-', "data-stage=", "data-cam="]) {
      expect(bench, gone).not.toContain(gone);
    }
  });

  it("declares its menu over the shared host and the shared print view", () => {
    expect(bench).toContain("buildTruckMenu(truckMenuApi)");
    expect(bench).toContain("menuHost.show('truck', truckMenuCtx, { root: benchRoot })");
    expect(bench).toContain("{ ctx: { get: () => truckMenuCtx, enumerable: true } }"); // the published handle keeps the Truck's own ctx while the Kip holds the panel
    expect(bench).toContain("sharedPrint.register('truck', printSource)");
    expect(bench).toContain("sharedPrint?.release('truck')");
  });

  it("keeps the served Truck page, bench and menu modules byte-identical to their sources (run npm run build:kip)", () => {
    for (const f of ["Truck-Mockup.html", "truck-bench.js", "truck-menu.js", "bench-lifecycle.js"]) {
      expect(readFileSync(join(root, "public/kip", f), "utf8"), `public/kip/${f} drifted from parts/kip/viewer/${f}`).toBe(
        readFileSync(join(root, "parts/kip/viewer", f), "utf8"),
      );
    }
  });
});
