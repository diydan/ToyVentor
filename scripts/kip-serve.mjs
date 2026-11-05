#!/usr/bin/env node
// Serve the Kip demo from SOURCE for hand-testing the menu, print view and selfie.
// Run: npm run kip:serve [-- --port 5180] [--api http://localhost:5372]
//
// This is a plain file server: it has no Worker, so /api/* answers 404 and anything that needs the app's server (Describe & build's
// "Muse transcribe", the model that picks a build, the voice that says part names) stays off. `--api <address>` sends every /api/* request on
// to a running dev server of the app (npm run dev prints its address) so those work here too, with the same keys the app already has.
//
// Same overlay server the e2e suites use: public/ with parts/kip/viewer/* served at /kip/, so you see the
// working-tree viewer files without `npm run build:kip`. Missing STLs (the in-flight hair parts) are
// stood in with a placeholder and logged here, so the demo starts even while those files are unexported.
import { startServer } from "./lib/kip-e2e.mjs";

const args = process.argv.slice(2);
const i = args.indexOf("--port");
const port = Number(i >= 0 ? args[i + 1] : process.env.PORT ?? 0) || 0;

const a = args.indexOf("--api");
const api = a >= 0 ? args[a + 1] : process.env.KIP_API;
if (api) {
  try { process.env.E2E_API_PROXY = new URL(api).origin; } catch { console.error(`--api needs an address like http://localhost:5372, not "${api}"`); process.exit(1); }
}

const server = await startServer({ port });
console.log(`Kip demo: ${server.base}/kip/Kip-Demo.html`);
console.log(api ? `/api/* goes to ${process.env.E2E_API_PROXY} (Muse transcribe and the other routes work here).` : "No --api: /api/* answers 404, so Muse transcribe shows as off. Add --api http://localhost:<your dev port>.");
console.log("Ctrl+C to stop.");

let reported = 0;
setInterval(() => {
  const now = [...server.missing];
  for (const m of now.slice(reported)) console.log(`stand-in served for missing STL: ${m}`);
  reported = now.length;
}, 1000).unref();
process.on("SIGINT", () => { server.close(); process.exit(0); });
