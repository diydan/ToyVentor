import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";
import { clampAdvisorProposal, type OptimizationManifest } from "../scripts/llm-lod-advisor";
import { allParts, glbFileFor, stlFileFor } from "../src/lib/catalog";
import {
  formatShortPrintTag,
  formatToyFinishRecipe,
  slicerRecipeForPart,
} from "../src/lib/printRecipe";

const ROOT = process.cwd();
const STL_DIR = join(ROOT, "public/parts-stl");
const GLB_DIR = join(ROOT, "public/parts-glb");
const MANIFEST_PATH = join(ROOT, "parts/partspec/asset_optimization_manifest.json");

describe("Parts asset optimization (Print STL + Web GLB + Toy-Finish Recipes)", () => {
  it("keeps public/parts-glb under 5 MB total and 250 KB per file using KHR_mesh_quantization", () => {
    const glbFiles = readdirSync(GLB_DIR).filter((f) => f.endsWith(".glb"));
    expect(glbFiles.length).toBeGreaterThanOrEqual(45);

    let totalBytes = 0;
    for (const file of glbFiles) {
      const p = join(GLB_DIR, file);
      const buf = readFileSync(p);
      totalBytes += buf.length;
      expect(buf.length, `${file} exceeds 250 KB cap`).toBeLessThanOrEqual(250 * 1024);

      expect(buf.readUInt32LE(0), `${file} bad glTF magic`).toBe(0x46546c67);
      expect(buf.readUInt32LE(4), `${file} bad glTF version`).toBe(2);
      expect(buf.readUInt32LE(8), `${file} bad glTF length`).toBe(buf.length);
      const jsonLen = buf.readUInt32LE(12);
      expect(buf.readUInt32LE(16), `${file} bad JSON chunk`).toBe(0x4e4f534a);
      const header = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8")) as {
        extensionsRequired?: string[];
      };
      expect(header.extensionsRequired, `${file} missing KHR_mesh_quantization`).toContain(
        "KHR_mesh_quantization",
      );
    }

    expect(totalBytes).toBeLessThanOrEqual(5 * 1024 * 1024);
  });

  it("keeps public/parts-stl watertight binary STLs under 21 MB total and 1.6 MB per file with zero support bloat", () => {
    const stlFiles = readdirSync(STL_DIR).filter((f) => f.endsWith(".stl"));
    expect(stlFiles.length).toBeGreaterThanOrEqual(46);

    let totalBytes = 0;
    for (const file of stlFiles) {
      expect(file.toLowerCase()).not.toContain("support");
      const p = join(STL_DIR, file);
      const buf = readFileSync(p);
      totalBytes += buf.length;
      expect(buf.length, `${file} exceeds 1.6 MB cap`).toBeLessThanOrEqual(
        Math.round(1.6 * 1024 * 1024),
      );
      const tris = buf.readUInt32LE(80);
      expect(buf.length, `${file} binary STL length mismatch`).toBe(84 + tris * 50);
    }

    expect(totalBytes).toBeLessThanOrEqual(21 * 1024 * 1024);
    expect(existsSync(join(STL_DIR, "forge-mount-first-print.stl"))).toBe(true);
  });

  it("decodes real catalog GLBs natively in Three.js GLTFLoader with accurate physical dimensions", async () => {
    const loader = new GLTFLoader();
    const sampleIds = [
      "brick-s-2x2",
      "dome-s-2x2",
      "gear-spur-z20",
      "forge-mount-ring-s",
      "kit-keel-base",
    ];
    for (const id of sampleIds) {
      const part = allParts.find((p) => p.id === id);
      expect(part, `missing catalog part ${id}`).toBeDefined();
      const glbName = glbFileFor(part)!;
      const stlName = stlFileFor(part)!;
      expect(statSync(join(GLB_DIR, glbName)).size).toBeLessThan(
        statSync(join(STL_DIR, stlName)).size,
      );

      const buf = readFileSync(join(GLB_DIR, glbName));
      const ab = new Uint8Array(buf).buffer;
      const gltf = await loader.parseAsync(ab, "");
      gltf.scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const size = new THREE.Vector3();
      box.getSize(size);

      // STL Z-up (x, y, z) maps to GLB Y-up (x, z, -y) in metres -> sizeMm = [x, z, y]
      if (part?.bboxMm) {
        expect(Math.abs(size.x * 1000 - part.bboxMm[0])).toBeLessThan(0.35);
        expect(Math.abs(size.z * 1000 - part.bboxMm[1])).toBeLessThan(0.35);
        expect(Math.abs(size.y * 1000 - part.bboxMm[2])).toBeLessThan(0.35);
      }
    }
  });

  it("populates finish-class tolerances and toy-grade slicer recipes in asset_optimization_manifest.json", () => {
    expect(existsSync(MANIFEST_PATH)).toBe(true);
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as OptimizationManifest;
    expect(manifest.version).toBe(2);

    const dome = manifest.parts["dome-s-2x2"];
    expect(dome?.finish_class).toBe("show_curved");
    expect(dome?.print_simplify_mm).toBeLessThanOrEqual(0.008);
    expect(dome?.slicer_recipe.layer_height_mm).toBe(0.12);
    expect(dome?.slicer_recipe.wall_order).toBe("inner_first");
    expect(dome?.slicer_recipe.ironing).toBe("none");

    const gear = manifest.parts["gear-spur-z20"];
    expect(gear?.finish_class).toBe("precision_gear_pin");
    expect(gear?.print_simplify_mm).toBeLessThanOrEqual(0.012);
    expect(gear?.slicer_recipe.layer_height_mm).toBe(0.16);

    const brick = manifest.parts["brick-s-2x2"];
    expect(brick?.finish_class).toBe("prismatic_structural");
    expect(brick?.slicer_recipe.layer_height_mm).toBe(0.16);
    expect(brick?.slicer_recipe.wall_loops).toBe(3);
    expect(brick?.slicer_recipe.outer_wall_speed_mms).toBe(30);
    expect(brick?.slicer_recipe.wall_order).toBe("outer_first");
    expect(brick?.slicer_recipe.ironing).toBe("all_top");
    expect(brick?.slicer_recipe.ironing_inset_mm).toBeCloseTo(0.21, 2);

    // UI helpers surface 0.12 / 0.16 mm smooth PEI + wall order + seam + ironing
    const domePart = allParts.find((p) => p.id === "dome-s-2x2")!;
    const brickPart = allParts.find((p) => p.id === "brick-s-2x2")!;
    expect(formatShortPrintTag(domePart)).toContain("0.12 mm PLA");
    expect(formatToyFinishRecipe(domePart).headline).toContain("inner-first");
    expect(formatToyFinishRecipe(domePart).headline).toContain("rear seam");
    expect(formatToyFinishRecipe(brickPart).headline).toContain("0.16 mm PLA");
    expect(formatToyFinishRecipe(brickPart).headline).toContain("outer-first");
    expect(formatToyFinishRecipe(brickPart).headline).toContain("iron flat tops");
    expect(slicerRecipeForPart(brickPart).support_mode).toBe("none");
  });

  it("clamps offline LLM advisor proposals within G2/G3 finish-safe bounds and scrubs brand names", () => {
    const baseEntry = {
      source_sha256: "abc12345",
      finish_class: "show_curved" as const,
      print_simplify_mm: 0.006,
      web_simplify_mm: 0.075,
      web_crease_deg: 36,
      slicer_recipe: {
        layer_height_mm: 0.12,
        wall_loops: 3,
        outer_wall_speed_mms: 30,
        wall_order: "inner_first" as const,
        seam_position: "back" as const,
        ironing: "none" as const,
        ironing_inset_mm: 0,
        brim_width_mm: 0,
        support_mode: "none" as const,
      },
    };
    const clamped = clampAdvisorProposal(baseEntry, {
      print_simplify_mm: 0.05, // way too coarse for curved show face -> must clamp to 0.008!
      web_simplify_mm: 0.5, // must clamp to 0.16
      web_crease_deg: 95, // must clamp to 48
      parent_tip: "Print like Lego bricks on Bambu smooth PEI at 30 mm/s.",
      rationale: "Smooth Duplo dome.",
    });
    expect(clamped.print_simplify_mm).toBe(0.008);
    expect(clamped.web_simplify_mm).toBe(0.16);
    expect(clamped.web_crease_deg).toBe(48);
    expect(clamped.parent_tip?.toLowerCase()).not.toContain("lego");
    expect(clamped.parent_tip?.toLowerCase()).not.toContain("bambu");
    expect(clamped.rationale?.toLowerCase()).not.toContain("duplo");
  });
});
