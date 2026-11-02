import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error untyped JS module
import { HAIR_OPTIONS, HAT_COLORS, HAT_OPTIONS } from "../parts/kip/viewer/kip-vehicles-wardrobe.js";

const root = process.cwd();
const source = readFileSync(join(root, "parts/kip/viewer/Truck-Mockup.html"), "utf8");
const table = JSON.parse(
  readFileSync(join(root, "parts/kip/viewer/partspec/mockup/kip_stack.json"), "utf8"),
);

const wardrobeHatId = (stackHatId: string) =>
  stackHatId === "hat_wobble_hat" || stackHatId === "wobble_hat"
    ? "hat"
    : stackHatId.replace(/^hat_/, "");

describe("Truck one-Kip hair and hats", () => {
  it("maps every stack hair and hat selection onto a wardrobe slot", () => {
    const hairIds = new Set(HAIR_OPTIONS.map((h: { id: string }) => h.id));
    for (const stackHairId of Object.keys(table.hairs)) {
      expect(hairIds.has(stackHairId.replace(/^hair_/, "")), stackHairId).toBe(true);
    }

    const hatsById = new Map(HAT_OPTIONS.map((h: { id: string }) => [h.id, h]));
    const hatColors = new Set(HAT_COLORS.map((c: { id: string }) => c.id));
    for (const stackHatId of table.hats) {
      const hatId = wardrobeHatId(stackHatId);
      const hat = hatsById.get(hatId) as { defaultCol?: string } | undefined;
      expect(hat, stackHatId).toBeDefined();
      if (hat?.defaultCol) expect(hatColors.has(hat.defaultCol), stackHatId).toBe(true);
    }
  });

  it("shows wardrobe hair and hats instead of the old CAD stack", () => {
    expect(source).toContain("for (const [k, m] of Object.entries(exp.hairMeshes))");
    expect(source).toContain("for (const [k, m] of Object.entries(exp.hatMeshes))");
    expect(source).toContain("KIP_DRIVER.rig.crownAccSlot.visible = canWearHat;");
    expect(source).toContain("exp.expMats.hat.color.set(hatColor.hex);");
    expect(source).not.toContain("headCadWrap");
    expect(source).not.toContain("meshOf(KIP_STACK.hair");
    expect(source).not.toContain("meshOf(KIP_STACK.hat");
  });
});
