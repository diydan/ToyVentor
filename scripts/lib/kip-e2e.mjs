// Shared harness for the Kip demo headless-Chrome checks (menu, print view, selfie).
//
//  - startServer(): static server over public/ with parts/kip/viewer/* overlaid at /kip/, so the
//    SOURCE viewer files are tested without running `npm run build:kip` (which would also copy any
//    in-flight edits into public/kip). Missing STLs: stubbed with a stand-in unless E2E_STRICT_STL=1;
//    `server.blocked.add('/kip/...')` forces a 404 to test missing-file handling. `server.mock(method, path, handler)` stubs an
//    /api/* route and `server.apiCalls` records every /api request (used by the Smart face tests: no real photo is ever sent).
//  - launchChrome(): the machine's Google Chrome over CDP using Node's global WebSocket, as
//    scripts/e2e-chrome.mjs does. No new dependencies.
//  - createChecks(): collects pass/fail lines and sets the exit code.
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const PUB = path.join(ROOT, "public");
const VIEWER = process.env.E2E_VIEWER ?? path.join(ROOT, "parts/kip/viewer"); // E2E_VIEWER: serve a copy of the viewer files instead (a mutation round runs against one, never the working tree)
const CHROME =
  process.env.E2E_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".json": "application/json",
  ".stl": "model/stl", ".glb": "model/gltf-binary", ".md": "text/markdown",
  ".png": "image/png", ".svg": "image/svg+xml", ".css": "text/css",
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Every file directly in parts/kip/viewer is served at /kip/<name> in place of public/kip/<name>, and so is the selfie sample
 * gallery (/kip/selfie-faces/*). Other subfolders are NOT overlaid: parts/kip/viewer/partspec would shadow the real STLs.
 */
function overlayFor(p) {
  const m = /^\/kip\/(?:selfie-faces\/)?([^/]+)$/.exec(p);
  if (!m) return null;
  const f = path.join(VIEWER, p.slice("/kip/".length));
  return fs.existsSync(f) && fs.statSync(f).isFile() && f.startsWith(VIEWER + path.sep) ? f : null;
}

export async function startServer({ port = 0 } = {}) {
  const strict = process.env.E2E_STRICT_STL === "1";
  const missing = new Set();
  const blocked = new Set(); // paths forced to 404, to test the missing-file path
  const standIn = path.join(PUB, "kip/partspec/toyventor_hair_bob_S.stl");
  // /api/* stubs for tests: `mock("POST", "/api/x", ({ json, headers }) => ({ status, json }))`; every /api request is recorded in
  // `apiCalls` ({ method, path, headers, body }). An /api path with no stub answers 404, as the static server always did.
  const mocks = new Map();
  const apiCalls = [];
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/favicon.ico") { res.writeHead(204); res.end(); return; }
    if (p.startsWith("/api/")) {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = body ? JSON.parse(body) : null; } catch { /* not JSON */ }
        apiCalls.push({ method: req.method, path: p, headers: { ...req.headers }, body });
        const h = mocks.get(`${req.method} ${p}`);
        if (!h && process.env.E2E_API_PROXY) { // a real local Worker (wrangler dev) answers instead: used for the end-to-end Smart face check
          fetch(new URL(req.url, process.env.E2E_API_PROXY), { method: req.method, headers: { "content-type": req.headers["content-type"] ?? "application/json", ...Object.fromEntries(["x-device-id", "x-parent-proof", "x-selfie-consent"].filter((k) => req.headers[k]).map((k) => [k, req.headers[k]])) }, body: req.method === "GET" ? undefined : body })
            .then(async (r) => { res.writeHead(r.status, { "content-type": r.headers.get("content-type") ?? "application/json", "cache-control": "no-store" }); res.end(Buffer.from(await r.arrayBuffer())); })
            .catch(() => { res.writeHead(502); res.end('{"error":"proxy"}'); });
          return;
        }
        if (!h) { res.writeHead(404, { "content-type": "application/json" }); res.end('{"error":"not found"}'); return; }
        const r = h({ json, body, headers: req.headers, search: new URL(req.url, "http://x").searchParams }) ?? {};
        if (r.raw) { res.writeHead(r.status ?? 200, { "content-type": r.type ?? "application/octet-stream", "cache-control": "no-store" }); res.end(r.raw); return; } // a handler may answer with bytes (a song)
        res.writeHead(r.status ?? 200, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify(r.json ?? {}));
      });
      return;
    }
    if (blocked.has(p)) { missing.add(p); res.writeHead(404); res.end("blocked"); return; }
    let file = overlayFor(p) ?? path.join(PUB, p);
    if (!file.startsWith(PUB) && !file.startsWith(VIEWER)) { res.writeHead(403); res.end(); return; }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      if (/\.stl$/.test(p)) missing.add(p);
      if (!strict && /\.stl$/.test(p) && fs.existsSync(standIn)) file = standIn;
      else { res.writeHead(404); res.end("not found"); return; }
    }
    res.writeHead(200, {
      "content-type": TYPES[path.extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, missing, blocked, apiCalls, mock: (method, pathname, handler) => mocks.set(`${method} ${pathname}`, handler), close: () => server.close() };
}

export async function launchChrome({ width = 1440, height = 900 } = {}) {
  const port = 9400 + Math.floor(Math.random() * 500);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kip-e2e-"));
  const proc = spawn(CHROME, [
    "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
    // Software GL by default; E2E_GPU=metal uses the machine's GPU, which the 3D bench needs to load in reasonable time (game-browser-testing memory).
    ...(process.env.E2E_GPU === "metal" ? ["--use-angle=metal"] : ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"]), "--ignore-gpu-blocklist",
    "--no-first-run", "--no-default-browser-check", "--disable-background-timer-throttling",
    "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
    `--window-size=${width},${height}`, "about:blank",
  ], { stdio: "ignore" });
  let ok = false;
  for (let i = 0; i < 80 && !ok; i++) {
    try { await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); ok = true; }
    catch { await sleep(250); }
  }
  if (!ok) { proc.kill("SIGKILL"); throw new Error("Chrome did not start (set E2E_CHROME)"); }

  async function open(url, { width: w = width, height: h = height, mobile = false } = {}) {
    const tgt = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
    const ws = new WebSocket(tgt.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0;
    const pending = new Map();
    const exceptions = [];
    const requests = [];
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const { res, rej } = pending.get(m.id);
        pending.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      } else if (m.method === "Runtime.exceptionThrown") {
        const d = m.params.exceptionDetails;
        exceptions.push(String(d.exception?.description ?? d.text).slice(0, 400));
      } else if (m.method === "Network.requestWillBeSent") {
        requests.push({ url: m.params.request.url, type: m.params.type, method: m.params.request.method });
      }
    };
    const send = (method, params = {}) => new Promise((res, rej) => {
      const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params }));
    });
    await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
    await send("Page.navigate", { url });
    const evaluate = async (expression) => {
      const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    };
    const waitFor = async (expr, timeoutMs = 120000, every = 500) => {
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        try { if (await evaluate(expr)) return true; } catch { /* page still loading */ }
        await sleep(every);
      }
      return false;
    };
    const shot = async (file) => {
      const r = await send("Page.captureScreenshot", { format: "png" });
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(r.data, "base64"));
      return file;
    };
    const key = async (k, code = k) => {
      for (const type of ["keyDown", "keyUp"]) {
        await send("Input.dispatchKeyEvent", { type, key: k, code, text: type === "keyDown" && k.length === 1 ? k : undefined });
      }
    };
    const click = async (x, y) => {
      for (const type of ["mousePressed", "mouseReleased"]) {
        await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
      }
    };
    const resize = (w2, h2, mobile2 = false) =>
      send("Emulation.setDeviceMetricsOverride", { width: w2, height: h2, deviceScaleFactor: 1, mobile: mobile2 });
    return { send, evaluate, waitFor, shot, key, click, resize, exceptions, requests, close: () => ws.close() };
  }
  return {
    open,
    close() {
      try { proc.kill("SIGKILL"); } catch { /* gone */ }
      // Chrome may still be writing its profile for a moment after the kill: retry, and never let cleanup crash a finished run.
      try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* a temp folder left behind is harmless */ }
    },
  };
}

export function createChecks(title) {
  const failures = [];
  let passed = 0;
  return {
    check(name, ok, detail = "") {
      if (ok) { passed++; console.log(`  ok   ${name}`); }
      else { failures.push(name); console.log(`  FAIL ${name}${detail ? `  -> ${detail}` : ""}`); }
      return ok;
    },
    finish() {
      console.log(`\n${title}: ${passed} passed, ${failures.length} failed`);
      if (failures.length) { console.log(failures.map((f) => `  - ${f}`).join("\n")); process.exitCode = 1; }
    },
  };
}
