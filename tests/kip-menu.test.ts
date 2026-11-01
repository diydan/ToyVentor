import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import kipManifest from "../parts/kip/kip-manifest.json";
// The viewer modules are plain browser JS with no declaration files.
// @ts-expect-error untyped JS module
import * as menuMod from "../parts/kip/viewer/kip-menu.js";
// @ts-expect-error untyped JS module
import * as wardrobe from "../parts/kip/viewer/kip-vehicles-wardrobe.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const { buildMenu, flattenMenu, resolveOptions, wardrobeVisibility, faceLabel, hatLabel, DOCK_PARITY } = menuMod as any;
const { HAIR_OPTIONS, HEAD_CATEGORIES, headsInCategory, PROP_OPTIONS, HAT_OPTIONS } = wardrobe as any;

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

function baseLoco(): Record<string, any> {
  return {
    edition: "pro", category: "human", head: "kid", skin: "warm_peach", hairColor: "chestnut",
    hatColor: "cobalt_cap", shirt: "off", pants: "off", hair: "off", faceInsert: "sculpted", expr: "spark",
    hat: "buds", crown: "buds", back: "off", prop: "off", vehicle: "none", vehCovers: true, racerKit: true,
    speedScale: 1, explodeTarget: 0, buildMode: "assembled",
  };
}

/** A scene-free ctx: setters write straight to plain state, so get() after set() is a pure round trip. */
function fakeCtx(patch: Record<string, any> = {}) {
  const loco = { ...baseLoco(), ...patch };
  const st = { tail: "off", preset: "clean", clip: "idle", ref: false, pile: false };
  const clips = [{ id: "idle", label: "Idle" }, { id: "walk", label: "Walk" }, { id: "drive_sit", label: "Sit & Drive" }];
  const act = {
    setCategory: (v: string) => { loco.category = v; }, setHead: (v: string) => { loco.head = v; },
    setFace: (v: string) => { loco.expr = v; }, setFaceInsert: (v: string) => { loco.faceInsert = v; },
    setSkin: (v: string) => { loco.skin = v; }, setHair: (v: string) => { loco.hair = v; },
    setHairColor: (v: string) => { loco.hairColor = v; }, setHat: (v: string) => { loco.hat = v; loco.crown = v; },
    setHatColor: (v: string) => { loco.hatColor = v; }, setShirt: (v: string) => { loco.shirt = v; },
    setPants: (v: string) => { loco.pants = v; }, setBack: (v: string) => { loco.back = v; },
    setTail: (v: string) => { st.tail = v; },
    setProp: (v: string) => { loco.prop = v; }, setVehicle: (v: string) => { loco.vehicle = v; },
    setCovers: (v: boolean) => { loco.vehCovers = v; }, setRacerKit: (v: boolean) => { loco.racerKit = v; },
    setEdition: (v: string) => { loco.edition = v; }, applyPreset: (v: string) => { st.preset = v; },
    playClip: (v: string) => { st.clip = v; }, setSpeed: (v: number) => { loco.speedScale = v; },
    toggleExplode: () => { loco.explodeTarget = loco.explodeTarget < 0.5 ? 1 : 0; },
    setExplode: (v: number) => { loco.explodeTarget = v; }, togglePile: () => { st.pile = !st.pile; },
    startBuild: () => { loco.buildMode = "building"; }, toggleRef: () => { st.ref = !st.ref; },
    openLlm: () => {}, openPhoto: () => {}, loadFile: () => {},
  };
  const ctx = {
    loco, act, camera: null, ready: () => true, speeds: [1, 0.5, 0.25, 1.5],
    presets: [{ id: "clean", label: "Clean" }, { id: "boy", label: "Leo Explorer" }],
    clips: () => clips,
    read: {
      tail: () => st.tail, preset: () => st.preset, speed: () => loco.speedScale,
      clip: () => st.clip, refOn: () => st.ref, explodeOn: () => loco.explodeTarget >= 0.5, pileOn: () => st.pile,
    },
  };
  return ctx;
}

const flat = (ctx: any) => flattenMenu(buildMenu(ctx)) as any[];
const byId = (ctx: any, id: string) => flat(ctx).find((c) => c.id === id);

describe("kip menu schema", () => {
  it("has unique control ids and every control carries a tooltip", () => {
    const ids = flat(fakeCtx()).map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of flat(fakeCtx())) expect(c.title, `title for ${c.id}`).toBeTruthy();
  });

  it("round-trips every select option through set() then get()", () => {
    // Head options depend on the type, and several controls only matter on a human, so sweep each type.
    for (const cat of HEAD_CATEGORIES) {
      const ctx = fakeCtx({ category: cat.id, head: headsInCategory(cat.id)[0].id });
      for (const c of flat(ctx).filter((x) => x.kind === "select")) {
        const opts = resolveOptions(c).filter((o: any) => !o.disabled);
        expect(opts.length, `${c.id} has options`).toBeGreaterThan(0);
        expect(new Set(opts.map((o: any) => String(o.value))).size, `${c.id} option values unique`).toBe(opts.length);
        for (const o of opts) {
          expect(String(o.label).trim(), `${c.id}/${o.value} label`).not.toBe("");
          c.set(o.value);
          expect(String(c.get()), `${cat.id}: ${c.id} -> ${o.value}`).toBe(String(o.value));
        }
      }
    }
  });

  it("round-trips toggles and the pull range", () => {
    const ctx = fakeCtx();
    for (const id of ["covers", "racerKit", "ref", "explode", "pile"]) {
      const c = byId(ctx, id);
      c.set(true); expect(!!c.get(), id).toBe(true);
      c.set(false); expect(!!c.get(), id).toBe(false);
    }
    const pull = byId(ctx, "pull");
    pull.set(40);
    expect(pull.get()).toBe(40);
  });

  it("offers a disabled placeholder for values outside the list instead of showing the first option", () => {
    const wizard = byId(fakeCtx({ hat: "wizardHat" }), "hat");
    const opts = resolveOptions(wizard);
    const last = opts[opts.length - 1];
    expect(last).toMatchObject({ value: "wizardHat", label: "Wizard hat (SDK)", disabled: true });
    expect(resolveOptions(byId(fakeCtx({ prop: "custom" }), "prop")).at(-1).label).toBe("Custom prop (.stl)");
    expect(resolveOptions(byId(fakeCtx({ head: "custom", category: "human" }), "head")).at(-1).label).toBe("Custom head (.stl)");
    // A known value adds nothing.
    expect(resolveOptions(byId(fakeCtx({ hat: "ballcap" }), "hat")).length).toBe(HAT_OPTIONS.length);
  });

  it("builds the Hair groups and counts from data, never from copy", () => {
    const hair = byId(fakeCtx({ category: "human", head: "kid" }), "hair");
    const opts = hair.options();
    const groups = new Map<string, number>();
    for (const o of opts) if (o.group) groups.set(o.group, (groups.get(o.group) ?? 0) + 1);
    const styles = HAIR_OPTIONS.length - 1; // everything except `off`
    expect(opts.length).toBe(HAIR_OPTIONS.length);
    expect([...groups.values()].reduce((a, b) => a + b, 0)).toBe(styles);
    const hatReady = HAIR_OPTIONS.filter((h: any) => h.id !== "off" && h.hatReady).length;
    expect([...groups.keys()]).toEqual([`Hat-Ready (${hatReady})`, `Sculpted-Top (${styles - hatReady})`]);
    // Every hairstyle in the data is reachable.
    expect(new Set(opts.map((o: any) => o.value))).toEqual(new Set(HAIR_OPTIONS.map((h: any) => h.id)));
  });

  it("groups props by kind and reaches every prop the old dock could", () => {
    const opts = byId(fakeCtx(), "prop").options();
    expect(new Set(opts.map((o: any) => o.value))).toEqual(new Set(PROP_OPTIONS.map((p: any) => p.id)));
    expect(opts[0]).toMatchObject({ value: "off" });
    expect(opts.filter((o: any) => o.group).every((o: any) => ["Tools", "Cleaning", "Instruments", "Play & Gear"].includes(o.group))).toBe(true);
  });

  it("labels follow the head type", () => {
    expect(faceLabel({ head: "kid", category: "human" })).toBe("Face plate");
    expect(faceLabel({ head: "robot", category: "robot" })).toBe("Visor");
    expect(faceLabel({ head: "fox", category: "animal" })).toBe("Face");
    expect(hatLabel({ category: "human" })).toBe("Hat");
    expect(hatLabel({ category: "animal" })).toBe("Topper");
    expect(hatLabel({ category: "creature" })).toBe("Crown");
  });
});

describe("kip menu optional groups", () => {
  const withSelfie = (patch: Record<string, any>) => ({ ...fakeCtx(patch), selfie: { open() {}, remove() {} } });
  const ids = (ctx: any) => new Set(flat(ctx).map((c) => c.id));
  const visible = (ctx: any, id: string) => { const c = byId(ctx, id); return !c.visibleWhen || c.visibleWhen(); };

  it("has no selfie or print controls unless the page supplies them", () => {
    const plain = ids(fakeCtx());
    for (const id of ["selfie", "selfieRemove", "selfieNote", "plateView", "printInfo", "export3mf"]) expect(plain.has(id), id).toBe(false);
  });

  it("offers the selfie only on human heads, and Remove only while one is worn", () => {
    const human = withSelfie({ category: "human", head: "kid" });
    expect(visible(human, "selfie")).toBe(true);
    expect(visible(human, "selfieRemove")).toBe(false);
    expect(visible(withSelfie({ category: "robot", head: "robot" }), "selfie")).toBe(false);
    const worn = withSelfie({ category: "human", head: "tall", expr: "selfie" });
    expect(visible(worn, "selfieRemove")).toBe(true);
    expect(visible(worn, "selfieNote")).toBe(true);
    expect(resolveOptions(byId(worn, "face")).at(-1)).toMatchObject({ value: "selfie", label: "Selfie (not saved)", disabled: true });
  });

  it("the Print group only shows its details while the plate is up and disables exports when it is incomplete", () => {
    let on = false;
    const summary = { lines: ["3 parts"], errors: [] as string[] };
    const ctx: any = { ...fakeCtx(), print: { isOn: () => on, setOn: (v: boolean) => { on = v; }, busy: () => false, summary: () => summary, plateCount: () => 2, plateIndex: () => 0, setPlate() {}, download() {} } };
    expect(visible(ctx, "plateView")).toBe(true);
    for (const id of ["printInfo", "plate", "export3mf", "exportStl", "exportSheet"]) expect(visible(ctx, id), id).toBe(false);
    on = true;
    for (const id of ["printInfo", "plate", "export3mf", "exportStl", "exportSheet"]) expect(visible(ctx, id), id).toBe(true);
    expect(byId(ctx, "export3mf").disabled()).toBe(false);
    summary.errors = ["toyventor_hat_ranger_S.stl (404)"];
    expect(byId(ctx, "export3mf").disabled()).toBe(true);
    expect(byId(ctx, "printInfo").text()).toMatch(/hat_ranger.*Exports are disabled/);
    expect(byId(ctx, "plate").options().map((o: any) => o.label)).toEqual(["Plate 1 of 2", "Plate 2 of 2"]);
  });

  it("M1 Print group exposes printer presets, custom bed/slots, fit, overflow, vehicle, stickers, stencils, support check, and pack download", () => {
    let on = true;
    let sup = false;
    let prof: any = {
      presetId: "compact_180", slicer: "orca_bambu", changerType: "single", maxSlots: 1,
      multiColorStrategy: "split-plates", flatPackMode: "loose", bedXmm: 180, bedYmm: 180,
      nozzleMm: 0.4, fitChoice: "standard", tooManyColours: "extra-plates",
      includeVehicle: true, includeStickers: true, includeStencils: false,
    };
    const summary: any = { lines: ["60 parts"], errors: [], sceneColorCount: 6, hasVehicleInScene: true, hasDecals: true };
    let downloadedKind = "";
    const ctx: any = {
      ...fakeCtx({ vehicle: "scooter" }),
      print: {
        isOn: () => on, setOn: (v: boolean) => { on = v; }, busy: () => false,
        summary: () => summary, plateCount: () => 2, plateIndex: () => 0,
        plateLabel: (i: number) => `Plate ${i + 1} of 2: Warm Peach (#F7C8A8)`,
        setPlate() {},
        profile: () => prof,
        setPreset: (id: string) => {
          prof = id === "changer_256_4"
            ? { ...prof, presetId: id, changerType: "multiplexer", maxSlots: 4, multiColorStrategy: "auto", bedXmm: 256, bedYmm: 256 }
            : id === "custom"
              ? { ...prof, presetId: "custom", changerType: "multiplexer", maxSlots: 6, bedXmm: 220, bedYmm: 220 }
              : { ...prof, presetId: id, changerType: "single", maxSlots: 1, multiColorStrategy: "split-plates", bedXmm: 180, bedYmm: 180 };
        },
        updateProfile: (patch: any) => { prof = { ...prof, ...patch }; },
        supportCheck: () => sup,
        setSupportCheck: (v: boolean) => { sup = v; },
        download: (k: string) => { downloadedKind = k; },
      },
    };

    for (const c of flat(ctx)) expect(c.title, `title for ${c.id}`).toBeTruthy();
    expect(visible(ctx, "printer")).toBe(true);
    expect(visible(ctx, "fit")).toBe(true);
    expect(visible(ctx, "layout")).toBe(true);
    expect(byId(ctx, "layout").options().find((o: any) => o.value === "sprue")).toMatchObject({ value: "sprue", label: "Kit tray" });
    byId(ctx, "layout").set("sprue");
    expect(byId(ctx, "layout").get()).toBe("sprue");
    expect(visible(ctx, "includeVehicle")).toBe(true);
    expect(visible(ctx, "stickers")).toBe(true);
    expect(visible(ctx, "stencils")).toBe(true);
    expect(visible(ctx, "supportCheck")).toBe(true);
    expect(visible(ctx, "downloadPack")).toBe(true);
    expect(visible(ctx, "exportProject3mf")).toBe(true);
    byId(ctx, "exportProject3mf").run();
    expect(downloadedKind).toBe("project-3mf");
    // Single-colour preset hides multi-colour strategy & custom controls
    expect(visible(ctx, "colours")).toBe(false);
    expect(visible(ctx, "tooManyColours")).toBe(false);
    expect(visible(ctx, "slicer")).toBe(false);

    // Switch to 4-slot changer -> colours and tooManyColours appear (6 scene colours > 4 slots)
    byId(ctx, "printer").set("changer_256_4");
    expect(visible(ctx, "colours")).toBe(true);
    expect(visible(ctx, "tooManyColours")).toBe(true);
    byId(ctx, "tooManyColours").set("merge");
    expect(byId(ctx, "tooManyColours").get()).toBe("merge");

    // Switch to custom -> slicer, changerType, customBedMm, customNozzle, customSlots appear
    byId(ctx, "printer").set("custom");
    for (const id of ["slicer", "changerType", "customBedMm", "customNozzle", "customSlots"]) {
      expect(visible(ctx, id), `custom ${id}`).toBe(true);
    }
    byId(ctx, "customBedMm").set(300);
    expect(byId(ctx, "customBedMm").get()).toBe(300);

    // Round-trip supportCheck & colour-named plate labels
    byId(ctx, "supportCheck").set(true);
    expect(byId(ctx, "supportCheck").get()).toBe(true);
    expect(byId(ctx, "plate").options()[0].label).toMatch(/Warm Peach \(#F7C8A8\)/);
  });
});

describe("kip menu visibility vs kip-manifest.json categoryControls", () => {
  // The manifest note says it mirrors syncWardrobeCategoryUi(). Its tokens use per-type names; map them to menu ids.
  const TOKEN_TO_MENU: Record<string, string> = {
    faceInsert: "faceInsert", hair: "hair", hairColor: "hairColor", hat: "hat", hatColor: "hatColor", skin: "skin",
    shirt: "shirt", pants: "pants", back: "back", prop: "prop", visor: "face", crown: "hat", topper: "hat",
    face: "face", tail: "tail",
  };
  const CONDITIONAL = ["faceInsert", "hair", "hairColor", "hatColor", "skin", "shirt", "pants", "tail"];
  const ALWAYS = ["type", "head", "face", "hat", "back", "prop"];
  const cc = kipManifest.categoryControls as Record<string, string[] | string>;

  for (const cat of HEAD_CATEGORIES as { id: string }[]) {
    it(`${cat.id}: conditional controls match the manifest`, () => {
      const tokens = cc[cat.id] as string[];
      expect(Array.isArray(tokens)).toBe(true);
      for (const t of tokens) expect(TOKEN_TO_MENU[t], `unmapped manifest token "${t}"`).toBeTruthy();
      const expected = new Set(tokens.map((t) => TOKEN_TO_MENU[t]));
      // Hair on + a wearable hat on so that every conditional control can show.
      const head = headsInCategory(cat.id)[0].id;
      const ctx = fakeCtx({ category: cat.id, head, hair: cat.id === "human" ? "short_swept" : "off", hat: "ballcap" });
      const visible = new Set(flat(ctx).filter((c) => !c.visibleWhen || c.visibleWhen()).map((c) => c.id));
      for (const id of CONDITIONAL) expect(visible.has(id), `${cat.id}: ${id}`).toBe(expected.has(id));
      for (const id of ALWAYS) expect(visible.has(id), `${cat.id}: ${id} always shown`).toBe(true);
    });
  }

  it("hair tone needs hair and hat tone needs a wearable hat on a hat-ready style", () => {
    const vis = (patch: Record<string, any>) => wardrobeVisibility({ ...baseLoco(), ...patch });
    expect(vis({ category: "human", head: "kid", hair: "off" }).hairColor).toBe(false);
    expect(vis({ category: "human", head: "kid", hair: "curly" }).hairColor).toBe(true);
    expect(vis({ category: "human", head: "kid", hair: "short_swept", hat: "ballcap" }).hatColor).toBe(true);
    expect(vis({ category: "human", head: "kid", hair: "short_swept", hat: "buds" }).hatColor).toBe(false);
    // Sculpted-top hair cannot take a hat, so the tone control stays hidden and the hat note appears.
    const sculpted = vis({ category: "human", head: "kid", hair: "curly", hat: "ballcap" });
    expect(sculpted.canWearHat).toBe(false);
    expect(sculpted.hatColor).toBe(false);
    expect(byId(fakeCtx({ category: "human", hair: "curly" }), "hat").note()).toMatch(/swaps to a hat-ready/);
  });
});

describe("retired bottom dock", () => {
  // Parity was proven (aa60423: 165 one-step comparisons of a dock click against the same menu choice, all equal, every
  // dock option reachable, nothing extra) and then the dock was removed. These guard that result.
  const html = read("parts/kip/viewer/Kip-Demo.html");

  it("the page has no dock, no dock buttons, and no ?menu= gate", () => {
    expect(html).not.toContain('class="dock"');
    expect(html).not.toContain('id="row-clips"');
    expect(html).not.toMatch(/id="btn-(category|head|face|face-insert|hair|crown|hat-col|skin|hair-col|shirt|pants|back|prop-cat|hand|ears|tail|veh-[a-z]+|racer-kit|preset|edition|explode|pile|build|open-llm|open-photo|Skeleton|speed)"/);
    expect(html).not.toMatch(/params\.get\(['"]menu['"]\)/);
    expect(html).toMatch(/window\.kipMenu = mountKipMenu\(/);
  });

  it("the page code no longer reaches for any retired dock element", () => {
    const script = html.slice(html.indexOf('<script type="module">'));
    expect(script).not.toMatch(/getElementById\(['"](btn-(?!close-|copy-|ex-|clear-|kid-|cam-|sam-|equip-|sync-)[\w-]+|rng-explode|file-input)['"]\)/);
    expect(script).not.toContain("row-clips");
    expect(script).not.toContain("data-veh");
  });

  it("every retired dock element still maps to a control that exists in the menu", () => {
    const ids = new Set(flat(fakeCtx()).map((c) => c.id));
    expect(Object.keys(DOCK_PARITY).length).toBeGreaterThan(30);
    for (const [dock, ctl] of Object.entries(DOCK_PARITY)) expect(ids.has(ctl as string), `${dock} -> ${ctl}`).toBe(true);
  });

  it("keeps the option sets the dock cycled through that do not come from the wardrobe data", () => {
    const opts = (id: string, patch: Record<string, any> = {}) => resolveOptions(byId(fakeCtx(patch), id)).filter((o: any) => !o.disabled).map((o: any) => String(o.value));
    expect(opts("type")).toEqual(["human", "robot", "animal", "creature"]);
    expect(opts("faceInsert", { category: "human", head: "kid" })).toEqual(["sculpted", "vinyl", "flat"]);
    expect(opts("tail")).toEqual(["off", "wag", "pro"]);
    expect(opts("edition")).toEqual(["pro", "snap"]);
    expect(opts("vehicle")).toEqual(["none", "car", "truck", "scooter", "moto"]);
    expect(opts("speed")).toEqual(["1", "0.5", "0.25", "1.5"]);
  });
});

describe("kip viewer build wiring", () => {
  it("copies every local viewer module the demo imports into public/kip", () => {
    const build = read("scripts/build-kip.ts");
    for (const rel of ["parts/kip/viewer/Kip-Demo.html", "parts/kip/viewer/kip-menu.js"]) {
      const src = read(rel);
      for (const m of src.matchAll(/from\s+['"]\/kip\/([\w.-]+\.js)(?:\?[^'"]*)?['"]/g)) {
        expect(build, `${m[1]} imported by ${rel} but missing from scripts/build-kip.ts`).toContain(`viewer/${m[1]}`);
      }
    }
  });

  it("copies every sibling module the viewer modules import by relative path", () => {
    const build = read("scripts/build-kip.ts");
    for (const rel of ["kip-menu.js", "kip-print-view.js", "kip-selfie.js", "kip-selfie-image.js", "kip-forge-sdk.js", "kip-vehicles-wardrobe.js"]) {
      const src = read(`parts/kip/viewer/${rel}`);
      for (const m of src.matchAll(/from\s+['"]\.\/([\w.-]+\.js)(?:\?[^'"]*)?['"]/g)) {
        expect(build, `${m[1]} imported by ${rel} but missing from scripts/build-kip.ts`).toContain(`viewer/${m[1]}`);
      }
    }
  });

  it("imports siblings with the same ?v= specifier as the page so each module loads once", () => {
    const page = read("parts/kip/viewer/Kip-Demo.html");
    const menu = read("parts/kip/viewer/kip-menu.js");
    const version = (src: string, file: string) => new RegExp(`${file.replace(".", "\\.")}(\\?v=[\\d.]+)`).exec(src)?.[1];
    expect(version(menu, "kip-vehicles-wardrobe.js")).toBe(version(page, "kip-vehicles-wardrobe.js"));
    expect(version(menu, "kip-forge-sdk.js")).toBe(version(page, "kip-forge-sdk.js"));
  });
});
