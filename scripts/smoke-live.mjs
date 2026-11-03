#!/usr/bin/env node
// Post-deploy smoke test for the live site (docs/product/deploy-checklist.md, step 9). READ-ONLY: it fetches static files and loads pages in a headless browser with
// every /api/* request blocked, so nothing reaches the Worker, no device id or row is created, and no model call is made.
//
//   E2E_GPU=metal node scripts/smoke-live.mjs https://toyventor.com            (checks the commit that is HEAD here)
//   E2E_GPU=metal node scripts/smoke-live.mjs https://toyventor.com --commit bd49a81
//   node scripts/smoke-live.mjs https://toyventor.com --no-browser              (the byte comparison only, a few seconds)
//
// Why bytes and not status codes: the site is configured `not_found_handling: single-page-application` (wrangler.jsonc), so a file that was NOT deployed answers 200
// with the HTML shell. A "200?" check would pass a broken deploy. Instead every file below is fetched and compared with the same file in the commit (git cat-file), and
// a page's requests fail if a non-HTML file comes back as HTML.
//   1. /sw.js carries the cache name the commit has (a deploy that touches /kip/ must bump it: returning visitors keep cache-first copies otherwise).
//   2. Every tracked file under public/kip that a page loads by name: the flat .js and .html files and public/kip/partspec/mockup/* (the Truck and Yard STLs) are
//      byte-identical to the commit.
//   3. (browser) the game boots to its dock; the Kip, Truck (pro and mech) and Yard benches become ready in the Workshop shell; no request for a non-HTML file
//      returns HTML or a non-200; nothing throws.
// Exit code 0 only if every check passes.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const base = (args.find((a) => /^https?:\/\//.test(a)) ?? "").replace(/\/+$/, "");
if (!base) { console.error("usage: node scripts/smoke-live.mjs <https://site> [--commit <rev>] [--no-browser]"); process.exit(2); }
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const git = (...a) => execFileSync("git", a, { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 });
const commit = (opt("--commit") ?? "HEAD");
const short = git("rev-parse", "--short", commit).toString().trim();
const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
const failures = [];
const check = (name, ok, detail = "") => {
  if (ok) { passed++; console.log(`  ok   ${name}`); } else { failures.push(name); console.log(`  FAIL ${name}${detail ? `  -> ${detail}` : ""}`); }
  return ok;
};
const isHtml = (ct) => /text\/html/i.test(ct ?? "");
const get = async (p) => { const r = await fetch(`${base}${p}`, { cache: "no-store", redirect: "follow" }); return { status: r.status, ct: r.headers.get("content-type"), body: Buffer.from(await r.arrayBuffer()) }; };

console.log(`smoke test: ${base}  against commit ${short}\n`);

// ---- 1. the service worker's cache name ----
console.log("service worker");
{
  const want = /const CACHE = "([^"]+)"/.exec(git("show", `${commit}:public/sw.js`).toString())?.[1];
  const live = await get("/sw.js").catch((e) => ({ status: 0, ct: "", body: Buffer.from(String(e)) }));
  const have = /const CACHE = "([^"]+)"/.exec(live.body.toString())?.[1];
  check(`/sw.js answers 200 as JavaScript, not the HTML shell`, live.status === 200 && !isHtml(live.ct), `${live.status} ${live.ct}`);
  check(`/sw.js has the commit's cache name (${want})`, !!want && have === want, `live has ${have ?? "none"}`);
}

// ---- 2. byte comparison with the commit ----
console.log("\nfiles the benches load, compared with the commit");
{
  const names = git("ls-tree", "-r", "--name-only", commit, "public/kip").toString().split("\n").filter(Boolean);
  const wanted = names.filter((n) => /^public\/kip\/[^/]+\.(js|html)$/.test(n) || /^public\/kip\/partspec\/mockup\/[^/]+$/.test(n));
  const queue = wanted.slice();
  const bad = [];
  const worker = async () => {
    for (let n = queue.shift(); n; n = queue.shift()) {
      const expected = git("cat-file", "blob", `${commit}:${n}`);
      let got;
      try { got = await get(n.replace(/^public/, "")); } catch (e) { bad.push(`${n} (${String(e).slice(0, 60)})`); continue; }
      if (got.status !== 200) bad.push(`${n} (status ${got.status})`);
      else if (!/\.html$/.test(n) && isHtml(got.ct)) bad.push(`${n} (the HTML shell came back: the file is not deployed)`);
      else if (sha(got.body) !== sha(expected)) bad.push(`${n} (differs from the commit: ${got.body.length} bytes live, ${expected.length} in the commit)`);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  check(`${wanted.length} files (.js and .html in public/kip, and the mockup STLs) are byte-identical to ${short}`, bad.length === 0, `${bad.length} wrong: ${bad.slice(0, 4).join("; ")}${bad.length > 4 ? " ..." : ""}`);
  const mockup = wanted.filter((n) => n.includes("/mockup/"));
  check(`the Truck's 19 formerly-ignored files are among them and live`, ["kip_stack.json", "kit_turntable.stl", "mech_sill_duct.stl", "shaft_tu03.stl", "pro_steer_wheel.stl"].every((f) => mockup.some((n) => n.endsWith(`/${f}`)) && !bad.some((b) => b.includes(f))));
}

// ---- 3. pages in a browser, /api/* blocked ----
if (!flag("--no-browser")) {
  console.log("\npages in a headless browser (every /api request blocked: nothing reaches the Worker)");
  const { launchChrome } = await import("./lib/kip-e2e.mjs");
  const chrome = await launchChrome();
  const READY_MS = Number(process.env.READY_MS ?? 120000);
  const W = "window.workshop";
  const pages = [
    ["the game", "/", "!!document.querySelector('.tv-dock-right') && !!document.querySelector('.tv-toy-pill')"],
    ["Workshop: Kip bench", "/kip/Workshop.html?bench=kip", `${W}?.handles('kip')?.__KIP_READY__ === true`],
    ["Workshop: Truck bench (pro)", "/kip/Workshop.html?bench=truck", `${W}?.handles('truck')?.__TRUCK_READY__ === true`],
    ["Workshop: Truck bench (mech)", "/kip/Workshop.html?bench=truck&stage=mech", `${W}?.handles('truck')?.__TRUCK_READY__ === true`],
    ["Workshop: Yard bench", "/kip/Workshop.html?bench=yard", `${W}?.handles('yard')?.__YARD_READY__ === true`],
  ];
  try {
    for (const [name, url, ready] of pages) {
      const t = await chrome.open("about:blank", { width: 900, height: 700 });
      await t.send("Network.enable");
      await t.send("Network.setBlockedURLs", { urls: ["*/api/*"] });
      await t.send("Page.navigate", { url: `${base}${url}` });
      const ok = await t.waitFor(ready, READY_MS);
      await sleep(2500);
      const urls = [...new Set(t.requests.map((r) => r.url).filter((u) => u.startsWith(base) && !new URL(u).pathname.startsWith("/api/")))];
      const wrong = [];
      for (const u of urls) {
        const p = new URL(u).pathname;
        if (p === "/favicon.ico") continue; // the browser asks for it by itself and the SPA fallback answers with the shell: not a file the app loads
        const r = await fetch(u, { cache: "no-store" });
        await r.arrayBuffer().catch(() => {});
        const html = isHtml(r.headers.get("content-type"));
        const documentLike = p === "/" || /\.html$/.test(p) || !/\.[a-z0-9]+$/i.test(p);
        if (r.status !== 200 && r.status !== 204) wrong.push(`${r.status} ${p}`);
        else if (html && !documentLike) wrong.push(`HTML for ${p}`);
      }
      check(`${name} becomes ready`, ok);
      check(`${name}: ${urls.length} same-origin requests, none missing or answered with the HTML shell`, wrong.length === 0, wrong.slice(0, 4).join("; "));
      check(`${name}: nothing threw`, t.exceptions.length === 0, t.exceptions[0]?.slice(0, 200));
      try { await t.send("Page.close"); } catch { /* already gone */ }
      t.close();
    }
  } finally {
    chrome.close();
  }
}

console.log(`\nsmoke test: ${passed} passed, ${failures.length} failed${failures.length ? "\n" + failures.map((f) => `  - ${f}`).join("\n") : ""}`);
process.exitCode = failures.length ? 1 : 0;
