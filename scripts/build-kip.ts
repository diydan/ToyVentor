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
  join(kipSrcDir, "viewer/kip-print-view.js"),
  join(kipOutDir, "kip-print-view.js"),
);
copyFileSync(
  join(kipSrcDir, "viewer/kip-selfie.js"),
  join(kipOutDir, "kip-selfie.js"),
);
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
    "head_shell", "head_hood", "crown_buds", "crown_cap_blank",
    "ear_pod_l", "ear_pod_r", "visor", "face_eyes", "face_glints", "face_cheeks",
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
