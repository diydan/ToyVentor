// Build and sync Kip's 3D Modular Rig Demo Viewer + runtime assets into public/kip/.
// Usage:
//   npm run build:kip
//   npx tsx scripts/build-kip.ts --scad       # also recompile all 30 binary STLs via OpenSCAD
//   npx tsx scripts/build-kip.ts --partspec   # also run PartSpec v2 gate for 18 Kip parts + 3 SDK examples
import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const kipSrcDir = join(root, "parts/kip");
const kipOutDir = join(root, "public/kip");
const vendorOutDir = join(kipOutDir, "vendor");
const stlOutDir = join(kipOutDir, "stls");
const customOutDir = join(kipOutDir, "custom");

mkdirSync(vendorOutDir, { recursive: true });
mkdirSync(stlOutDir, { recursive: true });
mkdirSync(customOutDir, { recursive: true });

// 1. Bundle Three.js + loaders from node_modules/three into a single self-contained ES module
const esbuildBin = join(
  root,
  "node_modules/.bin",
  process.platform === "win32" ? "esbuild.cmd" : "esbuild",
);
execFileSync(
  esbuildBin,
  [
    join(kipSrcDir, "viewer/kip-viewer-deps.js"),
    "--bundle",
    "--format=esm",
    "--minify",
    "--target=es2022",
    `--outfile=${join(vendorOutDir, "three-kip.js")}`,
  ],
  { stdio: "inherit" },
);

// 2. Sync viewer HTML, character rig manifest, and LLM PartSpec prompt into public/kip/
copyFileSync(
  join(kipSrcDir, "viewer/Kip-Demo.html"),
  join(kipOutDir, "Kip-Demo.html"),
);
copyFileSync(
  join(kipSrcDir, "viewer/kip-forge-sdk.js"),
  join(kipOutDir, "kip-forge-sdk.js"),
);
copyFileSync(
  join(kipSrcDir, "viewer/kip-vehicles-wardrobe.js"),
  join(kipOutDir, "kip-vehicles-wardrobe.js"),
);
copyFileSync(
  join(kipSrcDir, "viewer/kip-menu.js"),
  join(kipOutDir, "kip-menu.js"),
);
copyFileSync(
  join(kipSrcDir, "viewer/kip-print.js"),
  join(kipOutDir, "kip-print.js"),
);
copyFileSync(
  join(kipSrcDir, "viewer/kip-print-bom.js"),
  join(kipOutDir, "kip-print-bom.js"),
);
copyFileSync(
  join(kipSrcDir, "viewer/kip-print-profile.js"),
  join(kipOutDir, "kip-print-profile.js"),
);
copyFileSync(
  join(kipSrcDir, "viewer/kip-print-sprue.js"),
  join(kipOutDir, "kip-print-sprue.js"),
);
copyFileSync(
  join(kipSrcDir, "viewer/kip-print-stickers.js"),
  join(kipOutDir, "kip-print-stickers.js"),
);
copyFileSync(
  join(kipSrcDir, "viewer/kip-print-stencils.js"),
  join(kipOutDir, "kip-print-stencils.js"),
);
copyFileSync(
  join(kipSrcDir, "viewer/kip-print-view.js"),
  join(kipOutDir, "kip-print-view.js"),
);
copyFileSync(
  join(kipSrcDir, "viewer/kip-selfie.js"),
  join(kipOutDir, "kip-selfie.js"),
);
copyFileSync(
  join(kipSrcDir, "viewer/kip-selfie-image.js"),
  join(kipOutDir, "kip-selfie-image.js"),
);
copyFileSync(
  join(kipSrcDir, "viewer/kip-selfie-cloud.js"),
  join(kipOutDir, "kip-selfie-cloud.js"),
);
copyFileSync(
  join(kipSrcDir, "viewer/kip-faceplate-shape.js"),
  join(kipOutDir, "kip-faceplate-shape.js"),
);
// Both benches (Kip-Demo.html, Truck-Mockup.html) import the shared Kip rig module kip-rig.js (Workshop stage 2).
copyFileSync(
  join(kipSrcDir, "viewer/kip-rig.js"),
  join(kipOutDir, "kip-rig.js"),
);
// Truck print parts provider (Workshop stage 3), imported by truck-bench.js.
copyFileSync(
  join(kipSrcDir, "viewer/truck-print-parts.js"),
  join(kipOutDir, "truck-print-parts.js"),
);
copyFileSync(
  join(kipSrcDir, "viewer/Truck-Mockup.html"),
  join(kipOutDir, "Truck-Mockup.html"),
);
// Bench modules (Workshop stage 4a): Kip-Demo.html and Truck-Mockup.html are loaders that mount these; bench-lifecycle.js is their shared teardown.
copyFileSync(
  join(kipSrcDir, "viewer/kip-bench.js"),
  join(kipOutDir, "kip-bench.js"),
);
copyFileSync(
  join(kipSrcDir, "viewer/truck-bench.js"),
  join(kipOutDir, "truck-bench.js"),
);
copyFileSync(
  join(kipSrcDir, "viewer/bench-lifecycle.js"),
  join(kipOutDir, "bench-lifecycle.js"),
);
// Shared stage (Workshop stage 4b): the one renderer, camera, controls and loop the Workshop gives hosted benches; workshop.js loads it with import().
copyFileSync(
  join(kipSrcDir, "viewer/bench-stage.js"),
  join(kipOutDir, "bench-stage.js"),
);
// Photo-to-print panel (F2b): the panel is a viewer file, and its logic is TypeScript (shared/photoPrintFlow.ts), bundled here into one ES module.
// tests/photo-print-flow.test.ts rebuilds it and compares it with the committed copy, so a stale bundle fails a test.
copyFileSync(
  join(kipSrcDir, "viewer/kip-photo-print.js"),
  join(kipOutDir, "kip-photo-print.js"),
);
execFileSync(
  esbuildBin,
  [
    join(root, "shared/photoPrintFlow.ts"),
    "--bundle",
    "--format=esm",
    "--target=es2022",
    "--minify",
    "--legal-comments=none",
    `--outfile=${join(kipOutDir, "kip-photo-print-core.js")}`,
  ],
  { stdio: "inherit" },
);
// Hand-built reaction, dance and prop clips (kip-clips.js), imported by Kip-Demo.html.
copyFileSync(
  join(kipSrcDir, "viewer/kip-clips.js"),
  join(kipOutDir, "kip-clips.js"),
);
// Workshop shell (docs/specs/workshop-spec.md): one page with a tab per bench (Kip, Truck); the benches themselves are copied above.
copyFileSync(
  join(kipSrcDir, "viewer/Workshop.html"),
  join(kipOutDir, "Workshop.html"),
);
copyFileSync(
  join(kipSrcDir, "viewer/workshop.js"),
  join(kipOutDir, "workshop.js"),
);
// Wind Key Lab: a stand-alone test page for mom_wind_key against the Band core (its overlap table comes from parts/kip/windkey_table.py).
copyFileSync(
  join(kipSrcDir, "viewer/WindKey-Lab.html"),
  join(kipOutDir, "WindKey-Lab.html"),
);
copyFileSync(
  join(kipSrcDir, "viewer/windkey-overlaps.json"),
  join(kipOutDir, "windkey-overlaps.json"),
);
// Jet Car Lab: balloon on top of the Snap truck (clearance table from parts/kip/jetcar_table.py, driver pose snapshot from the Truck probe).
for (const f of ["JetCar-Lab.html", "jetcar-clearance.json", "jetcar-kip-pose.json"]) {
  copyFileSync(join(kipSrcDir, "viewer", f), join(kipOutDir, f));
}
// Describe & build tab (kip-describe-contract.md): the page modules and their data. The 30 part STLs it draws are written straight into
copyFileSync(
  join(kipSrcDir, "viewer/kip-describe-tab.js"),
  join(kipOutDir, "kip-describe-tab.js"),
);
copyFileSync(
  join(kipSrcDir, "viewer/kip-describe.js"),
  join(kipOutDir, "kip-describe.js"),
);
copyFileSync(
  join(kipSrcDir, "viewer/kip-describe-validate.js"),
  join(kipOutDir, "kip-describe-validate.js"),
);
copyFileSync(
  join(kipSrcDir, "viewer/kip-describe-view.js"),
  join(kipOutDir, "kip-describe-view.js"),
);
copyFileSync(
  join(kipSrcDir, "viewer/kip-describe-recipes.json"),
  join(kipOutDir, "kip-describe-recipes.json"),
);
copyFileSync(
  join(kipSrcDir, "viewer/kip-describe-parts.json"),
  join(kipOutDir, "kip-describe-parts.json"),
);
// Prompt-a-face gallery: same-origin static pictures the selfie modal preloads with the page.
cpSync(join(kipSrcDir, "viewer/selfie-faces"), join(kipOutDir, "selfie-faces"), { recursive: true });
copyFileSync(
  join(kipSrcDir, "kip-manifest.json"),
  join(kipOutDir, "kip-manifest.json"),
);
const promptSrc = join(kipSrcDir, "sdk/LLM_PART_PROMPT.md");
if (existsSync(promptSrc)) {
  copyFileSync(promptSrc, join(kipOutDir, "LLM_PART_PROMPT.md"));
}
console.log(
  "build:kip: synced public/kip/Kip-Demo.html, kip-manifest.json, LLM_PART_PROMPT.md, and vendor/three-kip.js",
);

// 3. Optional PartSpec v2 rebuild (--partspec)
if (process.argv.includes("--partspec")) {
  const venvPy = join(root, "parts/partspec/.venv/bin/python3");
  const pyBin = existsSync(venvPy) ? venvPy : "python3";
  execFileSync(pyBin, [join(kipSrcDir, "kip_partspec.py")], { stdio: "inherit" });
  execFileSync("npx", ["tsx", join(root, "scripts/validate-llm-part.ts")], { stdio: "inherit" });
}

// 4. Optional OpenSCAD rebuild (--scad)
if (process.argv.includes("--scad")) {
  const scadCandidates = [
    "openscad",
    "/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD",
  ];
  const scadBin = scadCandidates.find((bin) => {
    try {
      execFileSync(bin, ["--version"], { stdio: "ignore" });
      return true;
    } catch {
      return existsSync(bin);
    }
  });
  if (!scadBin) {
    console.error("build:kip --scad: OpenSCAD binary not found.");
    process.exit(2);
  }
  const parts = [
    "torso", "back_dock_studs", "upper_arm", "forearm", "hand_l", "hand_r",
    "thigh", "shin", "boot", "spark_peg_big", "spark_peg_sml",
    "ear_acc_l", "ear_acc_r", "tail_acc",
    "snap_torso", "snap_arm", "snap_leg", "snap_turret_big", "snap_turret", "neck_turret_2x1",
  ];
  const scadFile = join(kipSrcDir, "kip.scad");
  for (const part of parts) {
    const outPath = join(stlOutDir, `${part}.stl`);
    console.log(`openscad: ${part} -> public/kip/stls/${part}.stl`);
    execFileSync(
      scadBin,
      [
        "--backend=manifold",
        "--export-format=binstl",
        "-D",
        `PART="${part}"`,
        "-o",
        outPath,
        scadFile,
      ],
      { stdio: "ignore" },
    );
  }
  console.log(`build:kip: recompiled ${parts.length} binary STLs into public/kip/stls/`);
}
