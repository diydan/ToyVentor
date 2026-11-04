#!/usr/bin/env node
// Make the app's PNG icons from the two SVGs in public/ (icon.svg, icon-maskable.svg), with the same headless Chrome the e2e scripts use.
// Run: node scripts/gen-pwa-icons.mjs        Writes public/icon-192.png, icon-512.png, icon-maskable-512.png and apple-touch-icon.png (180 x 180).
//
// Why four files: Chrome and Android want a 192 and a 512 PNG to offer "Install"; a maskable icon fills the whole square, so Android can cut it to any shape; and iOS ignores the
// manifest's icons and an SVG alike, and wants a 180 x 180 PNG named in an <apple-touch-icon> link (index.html). iOS rounds the corners itself, so that one is the full-bleed art.
// The "any" icons keep the SVG's rounded corners (transparent outside them). Re-run it after changing either SVG.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchChrome } from "./lib/kip-e2e.mjs";

const PUB = path.join(path.dirname(fileURLToPath(import.meta.url)), "../public");
const JOBS = [
  { svg: "icon.svg", size: 192, out: "icon-192.png", transparent: true },
  { svg: "icon.svg", size: 512, out: "icon-512.png", transparent: true },
  { svg: "icon-maskable.svg", size: 512, out: "icon-maskable-512.png", transparent: false },
  { svg: "icon-maskable.svg", size: 180, out: "apple-touch-icon.png", transparent: false },
];

const chrome = await launchChrome({ width: 512, height: 512 });
try {
  for (const job of JOBS) {
    const svg = fs.readFileSync(path.join(PUB, job.svg), "utf8");
    const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}img{display:block;width:100vw;height:100vh}</style><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}">`;
    const page = await chrome.open(`data:text/html;base64,${Buffer.from(html).toString("base64")}`, { width: job.size, height: job.size });
    await page.waitFor("document.querySelector('img') && document.querySelector('img').complete", 10000, 100);
    await page.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: job.transparent ? 0 : 255 } });
    const r = await page.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: job.size, height: job.size, scale: 1 }, fromSurface: true });
    fs.writeFileSync(path.join(PUB, job.out), Buffer.from(r.data, "base64"));
    page.close();
    console.log(`wrote public/${job.out} (${job.size} x ${job.size}, from ${job.svg})`);
  }
} finally {
  chrome.close();
}
