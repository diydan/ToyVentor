// The Kip's boots take a colour from the saved character ("Dress your Kip", `col.boots`); without one they are the demo's orange (runtime/kipLook.ts kipBodyColors).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KIP_BOOT_HEX, kipBodyColors } from "../src/features/game/world/runtime/kipLook";

const base = { c1: "#112233", c2: "#445566", skin: "#8a5035" };
describe("the boots", () => {
  it("are the demo's orange when the character has no boot colour", () => {
    expect(kipBodyColors(base).boots).toBe(KIP_BOOT_HEX);
    expect(kipBodyColors({ ...base, boots: undefined }).boots).toBe(KIP_BOOT_HEX);
  });
  it("take a valid hex (any case, kept lower case) and nothing else: a hand-edited value never reaches a material", () => {
    expect(kipBodyColors({ ...base, boots: "#3D7BE0" }).boots).toBe("#3d7be0");
    for (const bad of ["blue", "#12345", "#12345g", "rgb(1,2,3)", "", "#1234567", "<b>"]) expect(kipBodyColors({ ...base, boots: bad }).boots, bad).toBe(KIP_BOOT_HEX);
    expect(kipBodyColors({ ...base, boots: 5 as unknown as string }).boots).toBe(KIP_BOOT_HEX);
  });
  it("change nothing else about the body colours", () => {
    const a = kipBodyColors(base), b = kipBodyColors({ ...base, boots: "#3d7be0" });
    expect({ ...b, boots: "" }).toEqual({ ...a, boots: "" });
  });
  it("reach the boot mesh: the human Kip's boots use their own material only when the colour differs from the stock, so the shared orange material is untouched", () => {
    const rig = readFileSync(new URL("../src/features/game/world/runtime/stlRigLoader.ts", import.meta.url), "utf8");
    expect(rig).toContain("const bootMat = human && body.boots !== KIP_BOOT_HEX ? plastic(body.boots, { roughness: 0.34, clearcoat: 0.42 }) : sparkMat;");
    expect(rig).toContain("const bootMesh = scadMesh(geos.boot!, bootMat);");
  });
});
