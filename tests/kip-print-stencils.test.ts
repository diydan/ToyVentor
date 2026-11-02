import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// @ts-expect-error — viewer print modules are pure ES modules without .d.ts files
import * as STEN from "../parts/kip/viewer/kip-print-stencils.js";
// @ts-expect-error — viewer print modules are pure ES modules without .d.ts files
import * as K from "../parts/kip/viewer/kip-print.js";
// @ts-expect-error — viewer print modules are pure ES modules without .d.ts files
import * as P from "../parts/kip/viewer/kip-print-profile.js";
// @ts-expect-error — viewer print modules are pure ES modules without .d.ts files
import * as B from "../parts/kip/viewer/kip-print-bom.js";

const root = resolve(__dirname, "..");
const ORCA_BIN = "/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer";
const hasOrcaCli = existsSync(ORCA_BIN);

function verifyWatertightManifold(tri: Float32Array) {
  const vMap = new Map<string, number>();
  const vid = (x: number, y: number, z: number) => {
    const k = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
    let id = vMap.get(k);
    if (id === undefined) {
      id = vMap.size;
      vMap.set(k, id);
    }
    return id;
  };
  const edges = new Map<string, number>();
  let vol6 = 0;
  let degenerateTris = 0;

  for (let i = 0; i < tri.length; i += 9) {
    const ax = tri[i]!, ay = tri[i + 1]!, az = tri[i + 2]!;
    const bx = tri[i + 3]!, by = tri[i + 4]!, bz = tri[i + 5]!;
    const cx = tri[i + 6]!, cy = tri[i + 7]!, cz = tri[i + 8]!;
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    if (Math.hypot(nx, ny, nz) < 1e-8) degenerateTris++;
    vol6 += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);

    const a = vid(ax, ay, az);
    const b = vid(bx, by, bz);
    const c = vid(cx, cy, cz);
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const ek = `${u}->${v}`;
      edges.set(ek, (edges.get(ek) || 0) + 1);
    }
  }

  let unmatchedHalfEdges = 0;
  let duplicateHalfEdges = 0;
  for (const [ek, cnt] of edges.entries()) {
    if (cnt !== 1) duplicateHalfEdges += cnt;
    const [u, v] = ek.split("->");
    if ((edges.get(`${v}->${u}`) || 0) !== cnt) unmatchedHalfEdges++;
  }

  return {
    triCount: tri.length / 9,
    volumeMm3: vol6 / 6,
    degenerateTris,
    unmatchedHalfEdges,
    duplicateHalfEdges,
  };
}

describe("M5 3D paint & marker stencils (§8.2, §9.1, §9.2)", () => {
  const flatFaceTri = K.parseStl(readFileSync(join(root, "public/kip/partspec/toyventor_char_faceplate_flat_P.stl")));
  const sculptedFaceTri = K.parseStl(readFileSync(join(root, "public/kip/partspec/toyventor_char_faceplate_P.stl")));
  const vinylFaceTri = K.parseStl(readFileSync(join(root, "public/kip/partspec/toyventor_char_faceplate_vinyl_P.stl")));
  const proTorsoTri = K.parseStl(readFileSync(join(root, "public/kip/stls/torso.stl")));
  const snapTorsoTri = K.parseStl(readFileSync(join(root, "public/kip/stls/snap_torso.stl")));

  it("traces closed marching-squares contours on annular & saddle scalar fields without self-crossing", () => {
    const cols = 41, rows = 41;
    const field = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const d = Math.hypot(c - 20, r - 20);
        // Annular ring between r = 5 and r = 13 -> 2 closed contours
        field[r * cols + c] = d >= 5 && d <= 13 ? 1.0 : 0.0;
      }
    }
    const contours = STEN.marchingSquaresContours(field, cols, rows, { x0: 0, y0: 0, dx: 1, dy: 1, level: 0.5 });
    expect(contours.length).toBe(2);
    for (const poly of contours) {
      expect(poly.length).toBeGreaterThan(12);
    }

    // Saddle cases 5 and 10 disambiguate cleanly into closed loops (center = 0.50: 1 connected neck at level=0.50, 2 islands at level=0.51)
    const saddleField = new Float32Array([
      0, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 0,
    ]);
    expect(STEN.marchingSquaresContours(saddleField, 4, 4, { level: 0.50 }).length).toBe(1);
    expect(STEN.marchingSquaresContours(saddleField, 4, 4, { level: 0.51 }).length).toBe(2);
  });

  it("bridges enclosed solid islands with >= 0.90 mm bars into a single connected component", () => {
    const cols = 40, rows = 40;
    const solid = new Uint8Array(cols * rows).fill(1);
    // Cut an annular aperture ring (r in [8, 14]), leaving an isolated central solid island (r < 8)
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const d = Math.hypot(x - 20, y - 20);
        if (d >= 8 && d <= 14) solid[y * cols + x] = 0;
      }
    }
    const bridged = STEN.bridgeEnclosedSolidIslands(solid, cols, rows, 0.25, 1.05);
    expect(bridged.bridgesAdded).toBe(1);

    const tri = STEN.buildHeightfieldStencilTri({
      solid: bridged.solid,
      cols,
      rows,
      xMin: -5,
      yMin: -5,
      stepMm: 0.25,
      heightAt: () => 2.0,
      smoothPasses: 2,
    });
    expect(K.countFloatingIslands(tri)).toBe(0);
    const mf = verifyWatertightManifold(tri);
    expect(mf.unmatchedHalfEdges).toBe(0);
    expect(mf.duplicateHalfEdges).toBe(0);
    expect(mf.degenerateTris).toBe(0);
    expect(mf.volumeMm3).toBeGreaterThan(150);
  });

  it("builds watertight, zero-support Crown 2x1 cap (27.8 x 15.4 x 3.6 mm, Ø6.84 mm bores at 12.5 mm pitch)", () => {
    const crown = STEN.buildCrownStencilMesh();
    expect(crown.id).toBe("stencil_crown_2x1");
    expect(Math.abs(crown.w - 27.8)).toBeLessThan(0.08);
    expect(Math.abs(crown.h - 15.4)).toBeLessThan(0.08);
    expect(Math.abs(crown.dz - 3.6)).toBeLessThan(0.05);

    const rep = K.supportReport(crown.tri);
    expect(rep.overhangMm2).toBeLessThan(0.01);
    expect(K.countFloatingIslands(crown.tri)).toBe(0);

    const mf = verifyWatertightManifold(crown.tri);
    expect(mf.unmatchedHalfEdges).toBe(0);
    expect(mf.duplicateHalfEdges).toBe(0);
    expect(mf.degenerateTris).toBe(0);
    expect(mf.volumeMm3).toBeGreaterThan(800);

    // Verify the two Ø6.84 mm vertical bores sit at x = center +- 6.25 mm (12.5 mm pitch)
    const cx = crown.w * 0.5;
    const cy = crown.h * 0.5;
    for (const studX of [cx - 6.25, cx + 6.25]) {
      let minRadialWall = Infinity;
      for (let i = 0; i < crown.tri.length; i += 9) {
        // Vertical bore walls touch z = 0
        if (crown.tri[i + 2] === 0 && crown.tri[i + 5] === 0 && crown.tri[i + 8] > 0) {
          const r = Math.hypot(crown.tri[i] - studX, crown.tri[i + 1] - cy);
          if (r < minRadialWall) minRadialWall = r;
        }
      }
      expect(Math.abs(minRadialWall * 2 - 6.84)).toBeLessThan(0.15);
    }
  });

  it("builds watertight, zero-support Face & Shirt heightfield stencils across flat/sculpted/vinyl & pro/snap STLs", () => {
    const faceCases = [
      { expr: "spark", faceInsert: "flat", tri: flatFaceTri },
      { expr: "wink", faceInsert: "sculpted", tri: sculptedFaceTri },
      { expr: "surprised", faceInsert: "vinyl", tri: vinylFaceTri },
    ];
    for (const fc of faceCases) {
      const m = STEN.buildFaceStencilMesh({
        expr: fc.expr,
        faceInsert: fc.faceInsert,
        faceplateTri: fc.tri,
      });
      expect(m.id).toBe(`stencil_face_${fc.expr}`);
      expect(m.w).toBeGreaterThan(26.5);
      expect(m.w).toBeLessThan(27.6);
      expect(m.h).toBeGreaterThan(15.2);
      expect(m.h).toBeLessThan(16.2);

      const rep = K.supportReport(m.tri);
      expect(rep.overhangMm2, `${m.id} (${fc.faceInsert}) overhang`).toBeLessThan(0.01);
      expect(K.countFloatingIslands(m.tri), `${m.id} (${fc.faceInsert}) islands`).toBe(0);

      const mf = verifyWatertightManifold(m.tri);
      expect(mf.unmatchedHalfEdges).toBe(0);
      expect(mf.duplicateHalfEdges).toBe(0);
      expect(mf.degenerateTris).toBe(0);
      expect(mf.volumeMm3).toBeGreaterThan(600);
    }

    const shirtCases = [
      { shirtId: "spark_tee", edition: "pro", tri: proTorsoTri },
      { shirtId: "varsity", edition: "snap", tri: snapTorsoTri },
      { shirtId: "overalls", edition: "pro", tri: proTorsoTri },
    ];
    for (const sc of shirtCases) {
      const m = STEN.buildShirtStencilMesh({
        shirtId: sc.shirtId,
        edition: sc.edition,
        torsoTri: sc.tri,
      });
      expect(m.id).toBe(`stencil_shirt_${sc.shirtId}`);
      expect(Math.abs(m.w - 27.2)).toBeLessThan(0.35);
      expect(Math.abs(m.h - 25.6)).toBeLessThan(0.35);
      expect(m.dz).toBeGreaterThan(5.0); // confirms deep C-arm rib-wrap cavity

      const rep = K.supportReport(m.tri);
      expect(rep.overhangMm2, `${m.id} overhang`).toBeLessThan(0.01);
      expect(K.countFloatingIslands(m.tri), `${m.id} islands`).toBe(0);

      const mf = verifyWatertightManifold(m.tri);
      expect(mf.unmatchedHalfEdges).toBe(0);
      expect(mf.duplicateHalfEdges).toBe(0);
      expect(mf.degenerateTris).toBe(0);
      expect(mf.volumeMm3).toBeGreaterThan(1200);
    }
  }, 30_000);

  it("joins stencils into a verified Adult Tool Card exceeding the 31.75 x 57.15 mm small-parts cylinder in sprue mode", () => {
    for (const state of [
      { category: "human", head: "kid", faceInsert: "flat", expr: "spark", shirt: "spark_tee", edition: "pro" },
      // Even a minimal 1-tool character (blank face, no shirt -> crown cap only) gets a full-size >= 60x34 mm Adult Tool Card
      { category: "human", head: "kid", faceInsert: "flat", expr: "blank", shirt: "off", edition: "snap" },
    ]) {
      const plan = STEN.planStencils(state, null, {
        flatPackMode: "sprue",
        boundMm: 180,
        faceplateTri: flatFaceTri,
        torsoTri: proTorsoTri,
      });
      expect(plan.sprue).toBeTruthy();
      expect(plan.sprueVerification).toEqual([]);

      const fb = plan.sprue.frameBox;
      const cardDz = Math.max(...plan.tools.map((t: any) => t.dz));
      expect(fb.w).toBeGreaterThanOrEqual(60.0);
      expect(fb.h).toBeGreaterThanOrEqual(34.0);
      expect(K.smallParts([[{ id: "adult_tool_card", instance: "adult_tool_card", w: fb.w, h: fb.h, dz: cardDz }]])).toEqual([]);
      expect(plan.warnings).toContain(K.PRINT_PAGE_WARNINGS.small_part);
      expect(plan.warnings).toContain(K.PRINT_PAGE_WARNINGS.sprue_prep);
    }
  });

  it("never accesses selfie camera pixels or writes selfie stencil files when expr === 'selfie'", () => {
    const poisonedSources = new Proxy(
      { "shirt:spark_tee": STEN.renderFallbackShirtRgba("spark_tee") },
      {
        get(target, prop) {
          if (String(prop).includes("selfie")) {
            throw new Error("Privacy violation: stencil planner attempted to read selfie pixels");
          }
          return Reflect.get(target, prop);
        },
      },
    );

    const state = {
      category: "human",
      head: "kid",
      faceInsert: "flat",
      expr: "selfie",
      selfie: true,
      shirt: "spark_tee",
      edition: "pro",
    };
    const stencilPlan = STEN.planStencils(state, null, {
      flatPackMode: "sprue",
      faceplateTri: flatFaceTri,
      torsoTri: proTorsoTri,
      renderedSources: poisonedSources,
    });

    expect(stencilPlan.tools.map((t: any) => t.id)).toEqual(["stencil_shirt_spark_tee", "stencil_crown_2x1"]);
    expect(stencilPlan.notes.join(" ")).toMatch(/Selfie photo face uses the 2D sticker sheet/i);

    const profile = P.clampProfile({ ...P.createDefaultProfile(), includeStencils: true, flatPackMode: "sprue" });
    const stencilFiles = STEN.buildStencilPackFiles(stencilPlan, profile);
    expect(stencilFiles.some((f: any) => f.name.includes("selfie"))).toBe(false);
    expect(stencilFiles.map((f: any) => f.name)).toContain("stencils/kip_stencils_adult_tool_card.3mf");
    expect(stencilFiles.map((f: any) => f.name)).toContain("stencils/kip_stencils_adult_tool_card.stl");
    expect(stencilFiles.map((f: any) => f.name)).toContain("stencils/stencil_crown_2x1.stl");

    // Verify `buildPrintPackFiles` wires `stencils/*`, `README.txt`, and `layout.json` cleanly
    const bom = B.resolveSceneBom(state);
    const dummyPlan = K.planColorPlates([
      K.prepareItem({ id: "stencil_crown_2x1", file: "mem.stl", qty: 1, hex: "#F4EFE6", source: "partspec" }, STEN.buildCrownStencilMesh().tri, { verified: true }),
    ], profile);
    const packFiles = K.buildPrintPackFiles({
      plan: dummyPlan,
      bom,
      state,
      stencilFiles,
      stencilsMeta: { mode: "adult-tool-card", tools: stencilPlan.tools.map((t: any) => ({ id: t.id })) },
    });
    expect(packFiles.some((f: any) => f.name.startsWith("stencils/"))).toBe(true);
    const readme = new TextDecoder().decode(
      typeof packFiles[0].data === "string" ? new TextEncoder().encode(packFiles[0].data) : packFiles[0].data,
    );
    expect(readme).toMatch(/stencils\/\*/);
    expect(readme).toMatch(/planar outer face on bed/i);
    const layoutEntry = packFiles.find((f: any) => f.name === "layout.json");
    const layoutObj = JSON.parse(typeof layoutEntry.data === "string" ? layoutEntry.data : new TextDecoder().decode(layoutEntry.data));
    expect(layoutObj.stencils.mode).toBe("adult-tool-card");
    expect(JSON.stringify(layoutObj.stencils)).not.toMatch(/selfie/i);
    expect(JSON.stringify(layoutObj)).not.toMatch(/data:image|base64/i);
  }, 30_000);

  it.skipIf(!hasOrcaCli)("slices Adult Tool Card 3MF in real OrcaSlicer CLI with 0 support lines", () => {
    const plan = STEN.planStencils(
      { category: "human", head: "kid", faceInsert: "flat", expr: "surprised", shirt: "spark_tee", edition: "pro" },
      null,
      { flatPackMode: "sprue", boundMm: 180, faceplateTri: flatFaceTri, torsoTri: proTorsoTri },
    );
    const profile = P.clampProfile({ ...P.createDefaultProfile(), includeStencils: true, flatPackMode: "sprue" });
    const files = STEN.buildStencilPackFiles(plan, profile);
    const card3mf = files.find((f: any) => f.name.endsWith(".3mf"));
    expect(card3mf).toBeTruthy();

    const tmp = mkdtempSync(join(tmpdir(), "kip-stencils-orca-"));
    try {
      const inPath = join(tmp, "adult_tool_card.3mf");
      const outDir = join(tmp, "out");
      writeFileSync(inPath, card3mf.data);
      execFileSync(ORCA_BIN, ["--slice", "0", "--outputdir", outDir, inPath], { stdio: "pipe" });
      const gcodes = readdirSync(outDir).filter((f) => f.endsWith(".gcode"));
      expect(gcodes.length).toBe(1);
      const gcode = readFileSync(join(outDir, gcodes[0]!), "utf8");
      const supportLines = (gcode.match(/^; FEATURE: Support/gm) || []).length;
      expect(supportLines).toBe(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 60_000);
});
