import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import kipManifest from "../parts/kip/kip-manifest.json";
import seedKip from "../seed/toys/seed-kip.json";
import { convertPartSpecPart } from "../shared/partspec";
import { validateToy, type Toy } from "../shared/toy";
import {
  KIP_DEMO_PATH,
  decodeToyContract,
  kipDemoUrl,
  toyContractFromBuild,
} from "../shared/toycontract";

const root = process.cwd();

describe("Kip modular character rig & 3D demo viewer integration", () => {
  it("validates Kip's built-in seed toy and 5 modular TU attach points", () => {
    expect(validateToy(seedKip)).toEqual([]);
    expect(seedKip.kind).toBe("figure");
    expect(seedKip.attachPoints.map((p) => p.id)).toEqual([
      "head",
      "ears",
      "back",
      "tail",
      "hand",
    ]);
  });

  it("builds valid #toy= contract URLs for Kip's 3D Demo Viewer", () => {
    expect(kipDemoUrl()).toBe(KIP_DEMO_PATH);
    const contract = toyContractFromBuild(
      seedKip as Toy,
      [],
      new Map(),
      () => "#ff6b4a",
    );
    const url = kipDemoUrl(contract);
    expect(url.startsWith(`${KIP_DEMO_PATH}#toy=`)).toBe(true);
    const encoded = url.split("#toy=")[1] ?? "";
    expect(decodeToyContract(encoded)).toEqual(contract);
  });

  it("ships all Kip Pro (8+), Snap (3+), Shared, PartSpec, and Mixamo assets in public/kip/", () => {
    expect(kipManifest.editions.snap.ageGroup).toBe("3+");
    expect(kipManifest.safety.smallPartsWarningRequired).toBe(true);
    expect(existsSync(join(root, "parts/kip/kip.scad"))).toBe(true);
    expect(existsSync(join(root, "public/kip/Kip-Demo.html"))).toBe(true);
    expect(existsSync(join(root, "public/kip/vendor/three-kip.js"))).toBe(true);
    expect(readFileSync(join(root, "public/kip/kip-manifest.json"), "utf8")).toBe(
      readFileSync(join(root, "parts/kip/kip-manifest.json"), "utf8"),
    );

    const allKipStls = [
      ...kipManifest.editions.pro.exclusiveParts,
      ...kipManifest.editions.snap.exclusiveParts,
      ...kipManifest.sharedParts,
      ...kipManifest.testAccessories,
    ];
    for (const part of allKipStls) {
      expect(
        existsSync(join(root, "public/kip/stls", `${part}.stl`)),
        `missing public/kip/stls/${part}.stl`,
      ).toBe(true);
    }

    for (const clipPath of kipManifest.assets.mixamoClips) {
      expect(existsSync(join(root, "public", clipPath))).toBe(true);
    }
  });

  it("verifies all 70 Kip PartSpec v2 parts (58 Wave 9 + 12 Wave 12 props) and 46 multi-part assemblies as Conforming", () => {
    const manifestPath = join(root, "public/kip/kip-partspec-manifest.json");
    expect(existsSync(manifestPath)).toBe(true);
    const psManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(psManifest.status).toBe("verified");
    expect(psManifest.parts).toHaveLength(70);
    expect(psManifest.assemblies).toHaveLength(46);

    // `kip_partspec.py` exports Waves W9 and W12; the Kip wardrobe stat rule applies to Wave 9, the workshop props carry their own stats.
    const catalog = JSON.parse(readFileSync(join(root, "parts/partspec/catalog.json"), "utf8"));
    const waveById = new Map<string, string>(catalog.parts.map((p: { id: string; wave?: string }) => [p.id, p.wave ?? ""]));
    const validStats = new Set(["Speed", "Spin", "Torque", "Glow"]);
    for (const part of psManifest.parts) {
      expect(part.design_status, `${part.id} must be verified`).toBe("verified");
      expect(part.prints, `${part.id} must be printable`).toBe(true);
      expect(part.print.supports, `${part.id} must be support-free`).toBe(false);
      if (waveById.get(part.id) === "W9") {
        expect(validStats.has(part.stat), `${part.id} stat ${part.stat}`).toBe(true);
      } else {
        expect(waveById.get(part.id), `${part.id} must be Wave 12`).toBe("W12");
        expect(typeof part.stat === "string" && part.stat.length > 0, `${part.id} stat`).toBe(true);
      }
      expect(
        existsSync(join(root, "public/kip/partspec", part.file)),
        `missing public/kip/partspec/${part.file}`,
      ).toBe(true);
      const blockingFailures = (part.checks ?? []).filter(
        (c: { level: string; result: string }) => c.level === "block" && c.result === "fail",
      );
      expect(blockingFailures, `${part.id} blocking failures`).toEqual([]);
    }

    for (const asm of psManifest.assemblies) {
      expect(asm.ok, `assembly ${asm.id} failed`).toBe(true);
      expect(asm.errors).toEqual([]);
      expect(asm.warnings).toEqual([]);
    }
  });

  it("verifies Phase 3 Conforming LLM Part-Maker SDK, prompt, and 3 custom example parts", () => {
    expect(existsSync(join(root, "parts/kip/sdk/kip_partspec_sdk.py"))).toBe(true);
    expect(existsSync(join(root, "parts/kip/sdk/LLM_PART_PROMPT.md"))).toBe(true);
    expect(existsSync(join(root, "public/kip/LLM_PART_PROMPT.md"))).toBe(true);

    const customExamples = [
      ["custom_wizard_hat.partspec.json", "toyventor_custom_wizard_hat_S.stl"],
      ["custom_star_wand.partspec.json", "toyventor_custom_star_wand_P.stl"],
      ["custom_hood_crest.partspec.json", "toyventor_custom_hood_crest_S.stl"],
    ] as const;

    for (const [jsonFile, stlFile] of customExamples) {
      const jsonPath = join(root, "public/kip/custom", jsonFile);
      const stlPath = join(root, "public/kip/custom", stlFile);
      expect(existsSync(jsonPath), `missing ${jsonFile}`).toBe(true);
      expect(existsSync(stlPath), `missing ${stlFile}`).toBe(true);
      const meta = JSON.parse(readFileSync(jsonPath, "utf8"));
      expect(meta.design_status).toBe("verified");
      expect(meta.prints).toBe(true);
      expect(meta.print.supports).toBe(false);
      const blockingFailures = (meta.checks ?? []).filter(
        (c: { level: string; result: string }) => c.level === "block" && c.result === "fail",
      );
      expect(blockingFailures).toEqual([]);
    }
  });

  it("enforces Phase 4 Photo-Forge prints:false boundary and BRAND_STYLE.md clean-room rules", () => {
    expect(kipManifest.photoForge.prints).toBe(false);
    expect(kipManifest.photoForge.digitalOnly).toBe(true);

    const forbidden = /\b(lego|duplo|technic|bionicle|playmobil|meccano|k'nex|knex|funko|nendoroid|verstappen|sasuke|uchiha|naruto|jackson|tripo|zelda|signalis)\b/i;
    const filesToScan = [
      "parts/kip/kip-manifest.json",
      "public/kip/kip-partspec-manifest.json",
      "parts/kip/sdk/LLM_PART_PROMPT.md",
      "parts/kip/viewer/kip-forge-sdk.js",
      "parts/kip/viewer/kip-vehicles-wardrobe.js",
      "parts/kip/viewer/kip-menu.js",
      "parts/kip/viewer/kip-print.js",
      "parts/kip/viewer/kip-print-bom.js",
      "parts/kip/viewer/kip-print-profile.js",
      "parts/kip/viewer/kip-print-sprue.js",
      "parts/kip/viewer/kip-print-stickers.js",
      "parts/kip/viewer/kip-print-view.js",
      "parts/kip/viewer/kip-selfie.js",
      "parts/kip/viewer/kip-selfie-image.js",
      "parts/kip/viewer/kip-selfie-cloud.js",
      "parts/kip/viewer/kip-faceplate-shape.js",
      "parts/kip/viewer/kip-classic-rig.js",
      "parts/kip/viewer/kip-describe.js",
      "parts/kip/viewer/kip-describe-validate.js",
      "parts/kip/viewer/kip-describe-view.js",
      "parts/kip/viewer/kip-describe-tab.js",
      "parts/kip/viewer/kip-describe-recipes.json",
      "parts/kip/viewer/kip-describe-parts.json",
      "parts/kip/viewer/Truck-Mockup.html",
      "parts/kip/viewer/Kip-Demo.html",
      "parts/kip/kip_partspec.py",
    ];
    for (const rel of filesToScan) {
      const text = readFileSync(join(root, rel), "utf8");
      expect(forbidden.test(text), `forbidden brand term in ${rel}`).toBe(false);
    }
  });

  it("promotes all 58 Kip wardrobe and V2 vehicle parts into parts/partspec as verified Wave 9 (W9)", () => {
    const catalog = JSON.parse(readFileSync(join(root, "parts/partspec/catalog.json"), "utf8"));
    const mainManifest = JSON.parse(
      readFileSync(join(root, "parts/partspec/toyventor_parts.json"), "utf8"),
    );
    const wave9Wave = catalog.waves.find((w: { id: string }) => w.id === "W9");
    expect(wave9Wave).toBeDefined();

    const w9Rows = catalog.parts.filter((p: { wave?: string }) => p.wave === "W9");
    expect(w9Rows).toHaveLength(58);
    expect(w9Rows.filter((p: { line: string }) => p.line === "snap")).toHaveLength(48);
    expect(w9Rows.filter((p: { line: string }) => p.line === "pro")).toHaveLength(10);

    const byId = new Map<string, Record<string, unknown>>(
      mainManifest.parts.map((p: { id: string }) => [p.id, p]),
    );
    for (const row of w9Rows) {
      const entry = byId.get(row.id);
      expect(entry, `missing ${row.id} in parts/partspec/toyventor_parts.json`).toBeDefined();
      expect(entry?.design_status, `${row.id} design_status`).toBe("verified");
      if (row.line === "snap") {
        const bridged = convertPartSpecPart(row, entry as never);
        expect(bridged.ok, `Snap W9 part ${row.id} must convert cleanly via shared/partspec.ts`).toBe(
          true,
        );
      }
    }
  });
});
