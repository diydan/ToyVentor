import { describe, expect, it } from "vitest";
// The viewer modules are plain browser JS with no declaration files.
// @ts-expect-error untyped JS module
import * as bomMod from "../parts/kip/viewer/kip-print-bom.js";
// @ts-expect-error untyped JS module
import * as truckPartsMod from "../parts/kip/viewer/truck-print-parts.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const { resolveProviderBom } = bomMod as any;
const { countSceneParts, truckGetParts } = truckPartsMod as any;

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
