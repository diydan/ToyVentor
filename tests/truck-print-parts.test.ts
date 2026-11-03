import { describe, expect, it } from "vitest";
// The viewer modules are plain browser JS with no declaration files.
// @ts-expect-error untyped JS module
import * as bomMod from "../parts/kip/viewer/kip-print-bom.js";
// @ts-expect-error untyped JS module
import * as truckPartsMod from "../parts/kip/viewer/truck-print-parts.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const { resolveProviderBom, resolveSceneBom, mergeBoms, resolvePrintBom } = bomMod as any;
const { countSceneParts, truckGetParts, truckDriverPrintState, partsSignature } = truckPartsMod as any;

const IDX = {
  files: {
    "toyventor_kit_wheel_med_S.stl": { part: "kit_wheel_med", verdict: "pass", sha256: "a", brim_width_mm: 0 },
    "toyventor_shaft_tu03_P.stl": { part: "shaft_tu03", verdict: "pass", sha256: "b", brim_width_mm: 0 },
  },
};

function fakeMesh(geo: object, hex: string, visible = true) {
  return {
    isMesh: true,
    geometry: geo,
    visible,
    parent: null as any,
    material: { color: { getHexString: () => hex.replace("#", "").toUpperCase() } },
  };
}
function fakeRoot(children: any[]) {
  const root: any = { visible: true, parent: null, traverse(cb: any) { cb(root); for (const c of children) cb(c); } };
  for (const c of children) c.parent = root;
  return root;
}

describe("Truck parts provider (Workshop stage 3)", () => {
  it("counts visible CAD instances by part id with their bench colours, skipping hidden and unmapped meshes", () => {
    const wheel = {}, shaft = {}, other = {};
    const root = fakeRoot([
      fakeMesh(wheel, "#262D40"), fakeMesh(wheel, "#262D40"), fakeMesh(wheel, "#262D40"), fakeMesh(wheel, "#262D40"),
      fakeMesh(shaft, "#7A8291"),
      fakeMesh(shaft, "#7A8291", false),
      fakeMesh(other, "#FFFFFF"),
    ]);
    const geoToId = new Map([[wheel, "kit_wheel_med"], [shaft, "shaft_tu03"]]);
    expect(countSceneParts(root, geoToId)).toEqual([
      { id: "kit_wheel_med", colour: "#262D40", count: 4 },
      { id: "shaft_tu03", colour: "#7A8291", count: 1 },
    ]);
  });

  it("truckGetParts only counts the Truck CAD file list and never the driver face plate", () => {
    const wheel = {}, face = {}, rigGeo = {};
    const root = fakeRoot([fakeMesh(wheel, "#262D40"), fakeMesh(face, "#F3BA95"), fakeMesh(rigGeo, "#F4EFE6")]);
    const parts = truckGetParts({
      cadRoot: root,
      geos: { kit_wheel_med: wheel, char_faceplate: face },
      partFiles: ["kit_wheel_med", "char_faceplate"],
    });
    expect(parts).toEqual([{ id: "kit_wheel_med", colour: "#262D40", count: 1 }]);
  });

  it("resolveProviderBom maps ids to print-pose STLs as native PartSpec entries and reports unmapped ids", () => {
    const bom = resolveProviderBom(
      [
        { id: "kit_wheel_med", colour: "#262D40", count: 4 },
        { id: "shaft_tu03", colour: "#7A8291", count: 2 },
        { id: "no_such_part", colour: "#000000", count: 1 },
        { id: "kit_wheel_med", colour: "#262D40", count: 0 },
      ],
      { validationIndex: IDX },
    );
    expect(bom.items).toHaveLength(2);
    expect(bom.items[0]).toMatchObject({ id: "kit_wheel_med", file: "/kip/partspec/toyventor_kit_wheel_med_S.stl", qty: 4, source: "partspec", group: "truck" });
    expect(bom.items[1].file).toBe("/kip/partspec/toyventor_shaft_tu03_P.stl");
    expect(bom.unmapped).toEqual(['No print STL mapped for part "no_such_part"']);
    expect(bom.hasVehicleInScene).toBe(false);
  });
});

describe("One print BOM for the driver and the mechanism (Workshop stage 4c)", () => {
  const MECH = [{ id: "kit_wheel_med", colour: "#262D40", count: 4 }, { id: "shaft_tu03", colour: "#7A8291", count: 2 }];
  const DRIVER = { edition: "pro", head: "kid", hair: "short_swept", hat: "hardhat" };
  const source = (extra: object = {}) => ({ getParts: () => MECH, getState: () => ({ stage: "pro" }), ...extra });

  it("prints a Kip scene bench exactly as the scene BOM did before", () => {
    const state = { edition: "pro", head: "kid", hair: "off", hat: "buds" };
    const viaSource = resolvePrintBom({ getState: () => state }, { includeVehicle: true, validationIndex: IDX });
    expect(viaSource).toEqual(resolveSceneBom(state, { includeVehicle: true, validationIndex: IDX }));
  });

  it("a mechanism bench without a driver prints just its parts", () => {
    const bom = resolvePrintBom(source(), { parts: MECH, validationIndex: IDX });
    expect(bom.items.map((i: any) => i.id)).toEqual(["kit_wheel_med", "shaft_tu03"]);
    expect(bom.hasVehicleInScene).toBe(false);
  });

  it("a mechanism bench with a driver prints the driver's parts first and the mechanism after, with no vehicle and no decals", () => {
    const kipState = truckDriverPrintState({ driver: DRIVER });
    const bom = resolvePrintBom(source(), { parts: MECH, kipState, validationIndex: IDX });
    const ids = bom.items.map((i: any) => i.id);
    expect(ids.slice(-2)).toEqual(["kit_wheel_med", "shaft_tu03"]);
    expect(ids).toContain("torso");
    expect(ids.some((id: string) => id.startsWith("char_head_kid"))).toBe(true);
    expect(ids.filter((id: string) => id === "char_faceplate")).toHaveLength(1); // the driver's, not a second one from the cab
    expect(bom.items.filter((i: any) => i.group === "vehicle")).toEqual([]);
    expect(bom.vehicleItems).toEqual([]);
    expect(bom.hasVehicleInScene).toBe(false);
    expect(bom.decals).toEqual([]);
    // the Kip's character items keep their own group, the mechanism its own
    expect(bom.items.find((i: any) => i.id === "torso").group).toBe("character");
    expect(bom.items.find((i: any) => i.id === "kit_wheel_med").group).toBe("truck");
  });

  it("the snap driver prints the snap parts", () => {
    const kipState = truckDriverPrintState({ driver: { ...DRIVER, edition: "snap" } });
    const ids = resolvePrintBom(source(), { parts: MECH, kipState, validationIndex: IDX }).items.map((i: any) => i.id);
    expect(ids).toContain("snap_torso");
    expect(ids).not.toContain("torso");
  });

  it("mergeBoms skips empty lists, keeps order, joins notes without repeats, and can drop the decals", () => {
    const a = { items: [{ id: "a" }], notes: ["n1", "n2"], decals: [{ kind: "human_face" }], unmapped: ["u1"], bodyColors: { chestHex: "#111111" } };
    const b = { items: [{ id: "b" }], notes: ["n2", "n3"], decals: [], unmapped: [], bodyColors: {} };
    expect(mergeBoms([a])).toBe(a);
    expect(mergeBoms([null, a, null])).toBe(a);
    const m = mergeBoms([a, b], { stickers: false });
    expect(m.items.map((i: any) => i.id)).toEqual(["a", "b"]);
    expect(m.notes).toEqual(["n1", "n2", "n3"]);
    expect(m.unmapped).toEqual(["u1"]);
    expect(m.decals).toEqual([]);
    expect(m.bodyColors).toEqual({ chestHex: "#111111" });
    expect(mergeBoms([a, b]).decals).toHaveLength(1);
    expect(mergeBoms([]).items).toEqual([]);
  });

  it("the driver's print state: the Truck's fields win, the seated Kip has no vehicle, prop, back or tail, and keeps only its head and crown STLs", () => {
    const head = { name: "h.stl", bytes: new Uint8Array(3) };
    const kip = {
      edition: "snap", head: "fox", hair: "bowl", hat: "crown", skin: "vinyl_cream", shirt: "tee", pants: "jeans",
      vehicle: "truck", vehCovers: true, racerKit: true, prop: "wrench", back: "jetpack", tail: "fox", hasPhotoAccessory: true, customHoodMode: "sdkCrest",
      customStlSlots: { head, crown: null, hand: { name: "w.stl" }, back: { name: "b.stl" }, hood: { name: "x.stl" } },
      photoAccessorySlots: { hand: { name: "p" } },
    };
    const s = truckDriverPrintState({ driver: DRIVER, kip });
    expect(s).toMatchObject({ edition: "pro", head: "kid", hair: "short_swept", hat: "hardhat", skin: "vinyl_cream", shirt: "tee", pants: "jeans" });
    expect(s).toMatchObject({ vehicle: "none", prop: "off", back: "off", tail: "off", racerKit: false, hasPhotoAccessory: false, customHoodMode: "none", includeVehicle: false, photoAccessorySlots: {} });
    expect(Object.keys(s.customStlSlots)).toEqual(["head"]);
    // and it does not mutate the Kip's own state
    expect(kip.vehicle).toBe("truck");
    expect(Object.keys(kip.customStlSlots)).toHaveLength(5);
    expect(truckDriverPrintState({ driver: {} })).toMatchObject({ edition: "pro", head: "kid", hair: "off", hat: "buds" });
  });

  it("partsSignature changes when a part, a count or a colour does", () => {
    const a = partsSignature(MECH);
    expect(partsSignature([...MECH])).toBe(a);
    expect(partsSignature([{ ...MECH[0], count: 5 }, MECH[1]])).not.toBe(a);
    expect(partsSignature([{ ...MECH[0], colour: "#ffffff" }, MECH[1]])).not.toBe(a);
    expect(partsSignature([...MECH, { id: "kit_scoop_blade", colour: "#fff", count: 1 }])).not.toBe(a);
  });
});
