#!/usr/bin/env node
// Serve the Kip demo from SOURCE for hand-testing the side menu, print view and selfie.
// Run: npm run kip:serve [-- --port 5180]
//
// Same overlay server the e2e suites use: public/ with parts/kip/viewer/* served at /kip/, so you see the
// working-tree viewer files without `npm run build:kip`. Missing STLs (the in-flight hair parts) are
// stood in with a placeholder and logged here, so the demo starts even while those files are unexported.
import { startServer } from "./lib/kip-e2e.mjs";

const args = process.argv.slice(2);
const i = args.indexOf("--port");
const port = Number(i >= 0 ? args[i + 1] : process.env.PORT ?? 0) || 0;

const server = await startServer({ port });
console.log(`Kip demo (side menu): ${server.base}/kip/Kip-Demo.html?menu=side`);
console.log(`Kip demo (old dock):  ${server.base}/kip/Kip-Demo.html`);
console.log("Ctrl+C to stop.");

let reported = 0;
setInterval(() => {
  const now = [...server.missing];
  for (const m of now.slice(reported)) console.log(`stand-in served for missing STL: ${m}`);
  reported = now.length;
}, 1000).unref();
process.on("SIGINT", () => { server.close(); process.exit(0); });
