#!/usr/bin/env node
// Calibration guide, step 2 of 2: bundle app.js (+ three.js) and guide_assets.json into ONE self-contained page.
//   node parts/partspec/calibration_guide/build.mjs
// Output: parts/partspec/calibration/calibration-guide.html (open it by double-clicking; no server, no network).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const assetsFile = path.join(here, "guide_assets.json");
if (!fs.existsSync(assetsFile)) {
  console.error("guide_assets.json is missing. Run build_guide.py first:\n  parts/partspec/.venv/bin/python3 parts/partspec/calibration_guide/build_guide.py");
  process.exit(1);
}
const out = path.resolve(here, "../calibration/calibration-guide.html");

const r = await build({
  entryPoints: [path.join(here, "app.js")],
  bundle: true, minify: true, format: "iife", target: "es2020", write: false, charset: "utf8", legalComments: "none",
});
const js = r.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const assets = fs.readFileSync(assetsFile, "utf8").replace(/</g, "\\u003c");
const html = fs.readFileSync(path.join(here, "template.html"), "utf8")
  .replace("/*__ASSETS__*/", () => assets)
  .replace("/*__APP__*/", () => js);
fs.writeFileSync(out, html);
console.log(`wrote ${path.relative(process.cwd(), out)} (${(html.length / 1e6).toFixed(2)} MB)`);
