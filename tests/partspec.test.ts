import { describe, expect, it } from "vitest";
import { convertPartSpecPart } from "../shared/partspec";
import { validatePart } from "../shared/part";

const catalog = {
  id: "ridge_fin",
  name: "Ridge Fin",
  line: "snap",
  size: "small",
  stat: "Speed",
};
const manifest = {
  id: "ridge_fin",
  design_status: "verified",
  prints: true,
  file: "toyventor_ridge_fin_S.stl",
  connectors: [
    { kind: "socket_grid", interface: "stud_small", grid: { nx: 1, ny: 2, pitch: 12.5 } },
  ],
  print: { orientation: "flat underside down", supports: false },
};

describe("PartSpec bridge", () => {
  it("converts a verified Snap part into a valid app Part", () => {
    const r = convertPartSpecPart(catalog, manifest);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.part.id).toBe("partspec-ridge-fin");
    expect(r.part.grid).toEqual({ units: [1, 2], profile: "tu_stud_small" });
    expect(r.part.footprintMm).toEqual([12.5, 25]);
    expect(r.part.stat.name).toBe("speed");
    expect(validatePart(r.part)).toEqual([]);
  });

  it("uses the TU pitch for large parts", () => {
    const r = convertPartSpecPart(
      { ...catalog, id: "zoom_capsule", size: "large" },
      {
        ...manifest,
        id: "zoom_capsule",
        connectors: [
          { kind: "socket_grid", interface: "stud_large", grid: { nx: 1, ny: 1, pitch: 25 } },
        ],
      },
    );
    expect(r.ok && r.part.footprintMm).toEqual([25, 25]);
  });

  it("skips unmapped stats instead of guessing a game mapping", () => {
    const r = convertPartSpecPart({ ...catalog, stat: "Sturdiness" }, manifest);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("Sturdiness");
  });

  it("skips Pro parts and non-verified parts", () => {
    expect(convertPartSpecPart({ ...catalog, line: "pro", size: "pro" }, manifest).ok).toBe(false);
    expect(
      convertPartSpecPart(catalog, { ...manifest, design_status: "needs_reproportion" }).ok,
    ).toBe(false);
    expect(convertPartSpecPart(catalog, undefined).ok).toBe(false);
  });
});
