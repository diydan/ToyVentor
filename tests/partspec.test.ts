import { describe, expect, it } from "vitest";
import { convertPartSpecPart, EXTENDED_STAT_MAP } from "../shared/partspec";
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
  bbox_mm: [11.9, 24.4, 23.8] as [number, number, number],
  connectors: [
    { kind: "socket_grid", interface: "stud_small", grid: { nx: 1, ny: 2, pitch: 12.5 } },
  ],
  print: { orientation: "flat underside down", supports: false },
  safety: { small_part_status: "small_part" },
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

  it("uses the 25 mm TU pitch for large parts", () => {
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

  it("skips unmapped stats and tier parts in default strict mode", () => {
    const r = convertPartSpecPart({ ...catalog, stat: "Sturdiness" }, manifest);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("Sturdiness");

    expect(convertPartSpecPart({ ...catalog, line: "motion", size: "pro" }, manifest).ok).toBe(false);
    expect(
      convertPartSpecPart(catalog, { ...manifest, design_status: "needs_reproportion" }).ok,
    ).toBe(false);
    expect(convertPartSpecPart(catalog, undefined).ok).toBe(false);
  });

  it("bridges tier parts, Forge Mounts, all 19 stats, bboxMm, and CPSC small-part warnings in full TU mode", () => {
    expect(Object.keys(EXTENDED_STAT_MAP).length).toBeGreaterThanOrEqual(19);

    const proGear = convertPartSpecPart(
      { id: "gear_spur_z10", name: "Gear Spur Z10", line: "motion", size: "pro", stat: "Speed" },
      {
        id: "gear_spur_z10",
        design_status: "verified",
        prints: true,
        file: "toyventor_gear_spur_z10_P.stl",
        bbox_mm: [30, 28.9, 6.2],
        connectors: [
          { kind: "bore_grid", interface: "bore_grid", grid: { nx: 1, ny: 1, pitch: 12.5 } },
        ],
        print: { orientation: "flat", supports: false },
        safety: { small_part_status: "small_part" },
      },
      { mapAllStats: true, includeAdvanced: true, idPrefix: "", deriveStatValue: true, includeAssets: true },
    );
    expect(proGear.ok).toBe(true);
    if (!proGear.ok) return;
    expect(proGear.part.id).toBe("gear-spur-z10");
    expect(proGear.part.line).toBe("motion");
    expect(proGear.part.mount).toBe("hole");
    expect(proGear.part.sizeClass).toBe("small");
    expect(proGear.part.footprintMm).toEqual([12.5, 12.5]);
    expect(proGear.part.bboxMm).toEqual([30, 28.9, 6.2]);
    expect(proGear.part.stlFile).toBe("gear-spur-z10.stl");
    expect(proGear.part.glbFile).toBe("gear-spur-z10.glb");
    expect(proGear.part.smallPartWarning).toBe(true);
    expect(validatePart(proGear.part)).toEqual([]);
  });
});
