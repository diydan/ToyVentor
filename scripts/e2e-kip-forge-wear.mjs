#!/usr/bin/env node
// Text to part, "Wear it" on the REAL Kip page: headless Chrome opens Kip-Demo.html, the Tools entry's action opens the panel, a part is made through the
// real Worker routes (the model and the daemon are stand-ins, but the GLB the daemon "returns" is a real one from the optimizer's own exporter), and
// pressing Wear it must put a visible, right-sized part on Kip. Found by this check on 2026-11-03: the web GLB is in metres, the bench in millimetres, and a
// part worn unscaled was drawn 1000 times too small to see while every state flag said it worked. So this looks at the 3D objects, not at the flags.
// Run: npm run e2e:kip-forge-wear     Exits nonzero on any failing check. Env: E2E_CHROME, E2E_SHOTS (see scripts/lib/kip-e2e.mjs).
//
// The GLBs are real catalog parts from public/parts-glb (made by the same exporter as a daemon preview): a dome for the crown, a robot head for the head.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createChecks, launchChrome, startServer } from "./lib/kip-e2e.mjs";

const SHOTS = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), "kip-forge-wear-shots");
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const DEVICE = "12345678-1234-1234-1234-123456789abc";
const STL = "custom_wizard_hat.0123456789ab.stl";
const { check, finish } = createChecks("kip forge wear e2e");

const worker = (await import("../worker/index.ts")).default;
const { resetForgeRateLimit } = await import("../worker/forgeOptimizer.ts");

const RECIPE = { v: 1, id: "wizard_hat", name: "Starlight Wizard Hat", stat: "Glow", behavior: "Tall hat that clicks on", slot: "crown", shape: { kind: "loft", slices: [{ z: 0, w: 23.4, d: 11.4, r: 4.6 }, { z: 10, w: 28, d: 14, r: 5 }, { z: 20, w: 14, d: 8, r: 3 }] } };
const NAMES = { en: { w: "wizard hat", g: "m" }, es: { w: "sombrero de mago", g: "m" }, fr: { w: "chapeau de magicien", g: "m" }, de: { w: "Zauberhut", g: "m" }, it: { w: "cappello da mago", g: "m" }, pt: { w: "chapéu de mago", g: "m" }, tr: { w: "büyücü şapkası", g: "m" } };
const STL_BYTES = (() => { const b = Buffer.alloc(84 + 50); b.writeUInt32LE(1, 80); return b; })();

// ---- the stand-ins: the model and the daemon ----------------------------------------------------------------------------------
const model = { calls: 0, mode: "ok", recipe: null }; // ok | not_json
const daemon = { glb: "", previews: 0, polls: {}, down: false, artifactRequests: [], validatingPolls: 2 };

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function daemonFetch(url, init) {
  const p = url.pathname;
  if (p === "/v1/fast-preview") {
    if (daemon.down) return json({ ok: false }, 503);
    daemon.previews++;
    return json({ ok: true, status: "preview_ready", part_id: "custom_wizard_hat", job_id: `fjob_${String(daemon.previews).padStart(12, "0")}`, draft_artifact: "x.draft.glb", glb_size: 4, orig_tris: 1, web_verts: 1, web_tris: 1, finish_class: "show_curved", elapsed_ms: 20, glb_base64: daemon.glb });
  }
  const m = /^\/v1\/jobs\/(fjob_[a-f0-9]{12})$/.exec(p);
  if (m) {
    daemon.polls[m[1]] = (daemon.polls[m[1]] ?? 0) + 1;
    if (daemon.polls[m[1]] <= daemon.validatingPolls) return json({ ok: true, job_id: m[1], status: "validating" });
    return json({ ok: true, job_id: m[1], part_id: "custom_wizard_hat", status: "print_ready", stl_artifact: STL, glb_artifact: STL.replace(/\.stl$/, ".glb"), content_hash: "0123456789ab", gate_report: { ok: true, design_status: "verified", blocking_failures: [] } });
  }
  const a = /^\/v1\/artifacts\/(.+)$/.exec(p);
  if (a && a[1] === STL) {
    daemon.artifactRequests.push(a[1]);
    return new Response(STL_BYTES, { status: 200, headers: { "content-type": "model/stl" } });
  }
  return json({ ok: false }, 404);
}
// The Worker calls the global fetch for the daemon (127.0.0.1:8791) and for the model provider (anywhere else that is not this machine).
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : (input.url ?? String(input)));
  if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return url.port === "8791" ? daemonFetch(url, init) : realFetch(input, init);
  model.calls++;
  return json({ output_text: model.mode === "not_json" ? "Sure! Here is a hat." : JSON.stringify({ recipe: model.recipe ?? RECIPE, names: NAMES }) });
};

function fakeDb() {
  const settings = new Map();
  return {
    prepare: (sql) => ({
      bind: (...values) => ({
        run: async () => {
          if (sql.includes("INSERT INTO parent_settings")) {
            const [id, text] = values;
            if (!(sql.includes("DO NOTHING") && settings.has(id))) settings.set(id, text);
          }
          return {};
        },
        all: async () => (sql.includes("FROM parent_settings") ? { results: settings.has(values[0]) ? [{ settings_json: settings.get(values[0]) }] : [] } : { results: [] }),
      }),
    }),
  };
}

const env = { DB: fakeDb(), PARENT_GATE_SECRET: "gate-secret-for-the-e2e", FORGE_OPTIMIZER_URL: "http://127.0.0.1:8791", MODEL_API_KEY: "e2e-key", VOICE_SIGNING_KEY: "e2e-voice-signing-key-0123456789abcdef" };
const workerServer = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    try {
      const body = Buffer.concat(chunks);
      const r = await worker.fetch(new Request(`http://local${req.url}`, { method: req.method, headers: req.headers, ...(req.method === "GET" || req.method === "HEAD" ? {} : { body }) }), env);
      res.writeHead(r.status, { "content-type": r.headers.get("content-type") ?? "application/json", ...(r.headers.get("retry-after") ? { "retry-after": r.headers.get("retry-after") } : {}) });
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: String(e) }));
    }
  });
});
await new Promise((r) => workerServer.listen(0, "127.0.0.1", r));
process.env.E2E_API_PROXY = `http://127.0.0.1:${workerServer.address().port}`;


const DOME = fs.readFileSync(path.join(ROOT, "public/parts-glb/dome-s-2x2.glb")).toString("base64");
const ROBOT = fs.readFileSync(path.join(ROOT, "public/parts-glb/robot-head-visor.glb")).toString("base64");
daemon.validatingPolls = 0;
const server = await startServer();
const chrome = await launchChrome({ width: 1100, height: 800 });
const page = await chrome.open(`${server.base}/kip/Kip-Demo.html`);
const ready = await page.waitFor("window.__KIP_READY__ === true", 180000);
check("the real Kip page is ready", ready);
const ev = (e) => page.evaluate(e);
const text = (sel) => ev(`(document.querySelector(${JSON.stringify(sel)}) || {}).textContent || ''`);
const press = (label) => ev(`(() => { const b = [...document.querySelectorAll('.kfm-back button')].find((x) => x.textContent.includes(${JSON.stringify(label)}) && !x.hidden && x.offsetParent !== null && !x.disabled); if (!b) return false; b.click(); return true; })()`);
const setText = (t) => ev(`(() => { const i = document.querySelector('.kfm-back input[type=text]'); i.value = ${JSON.stringify(t)}; })()`);
const pickSlot = (v) => ev(`(() => { const r = [...document.querySelectorAll('.kfm-slot input')].find((x) => x.value === ${JSON.stringify(v)}); r.checked = true; })()`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const loco = () => ev("JSON.stringify({ hat: window.kipMenu.ctx.loco.hat, head: window.kipMenu.ctx.loco.head, hasPhotoAccessory: window.kipMenu.ctx.loco.hasPhotoAccessory })");

const inspect = (name) => ev(`(() => { const { THREE, kip } = window.kipRig(); const c = kip.exp.${name}; const box = new THREE.Box3().setFromObject(c); const first = []; c.traverse((o) => { if (o.isMesh) first.push({ type: o.type, vis: o.visible, verts: o.geometry.attributes.position.count, norm: o.geometry.attributes.position.normalized, bs: o.geometry.boundingSphere ? [o.geometry.boundingSphere.radius] : null, scale: o.getWorldScale(new THREE.Vector3()).toArray().map((v) => +v.toFixed(4)), mat: o.material && o.material.type, opacity: o.material && o.material.opacity, transparent: o.material && o.material.transparent }); }); let anc = c, chain = []; while (anc) { chain.push(anc.name + ':' + anc.visible); anc = anc.parent; } return JSON.stringify({ visible: c.visible, children: c.children.length, box: [box.min.toArray().map((v) => +v.toFixed(1)), box.max.toArray().map((v) => +v.toFixed(1))], worldPos: c.getWorldPosition(new THREE.Vector3()).toArray().map((v) => +v.toFixed(1)), meshes: first.slice(0, 3), chain: chain.slice(0, 8) }); })()`);
await ev(`localStorage.setItem('toyforge:device:v1', ${JSON.stringify(DEVICE)})`);
const sane = (j) => { const [lo, hi] = j.box; const size = [0, 1, 2].map((k) => hi[k] - lo[k]); const cy = (lo[1] + hi[1]) / 2; return j.visible && size.every((v) => v > 8 && v < 120) && cy > 90 && cy < 190; };

// 1. the menu entry opens the panel
const menuHas = await ev("(window.kipMenu.ctx.act.openForgeMake ? 'act ok' : 'no act') + ' / ' + document.body.innerText.includes('Make from words')");
check("the Tools menu has the entry and the act hook", menuHas.startsWith("act ok") && menuHas.endsWith("true"), menuHas);
await ev("window.kipMenu.ctx.act.openForgeMake()");
check("openForgeMake opens the panel on the real page", await page.waitFor("window.kipForgeMake && window.kipForgeMake.isOpen()", 20000));

// 2. a real pirate hat, worn
resetForgeRateLimit(); daemon.glb = DOME; model.recipe = { ...RECIPE, slot: "crown", name: "Dome Hat" };
await setText("a dome hat"); await pickSlot("crown"); await press("Make it");
check("the hat is made and done", await page.waitFor("window.kipForgeMake.state.step === 'done'", 60000));
await press("Wear it");
await page.waitFor("document.querySelector('.kfm-wearnote') && document.querySelector('.kfm-wearnote').textContent.length > 0", 20000);
check("Kip wears the hat as a custom hat", (await loco()).includes('"hat":"custom"'));
const hat = JSON.parse(await inspect("customCrownContainer"));
check("the worn hat is drawn at a size and place a child can see: 8 to 120 mm each way, up at Kip's head", sane(hat), JSON.stringify(hat.box));
await ev("window.kipForgeMake.close()");
await sleep(1500);
await page.shot(`${SHOTS}/bench-hat.png`);

// 3. a real cat head, worn
await ev("window.kipForgeMake.open()");
await press("Make another");
resetForgeRateLimit(); daemon.glb = ROBOT; model.recipe = { ...RECIPE, slot: "head", name: "Robot Head" };
await setText("a robot head"); await pickSlot("head"); await press("Make it");
check("the head is made and done", await page.waitFor("window.kipForgeMake.state.step === 'done'", 60000));
await press("Wear it");
await page.waitFor("document.querySelector('.kfm-wearnote').textContent.includes('wearing') || document.querySelector('.kfm-wearnote').textContent.includes('could not')", 20000);
check("Kip wears the head as a custom head", (await loco()).includes('"head":"custom"'));
const hd = JSON.parse(await inspect("customHeadContainer"));
check("the worn head is drawn at a size and place a child can see: 8 to 120 mm each way, up at Kip's head", sane(hd), JSON.stringify(hd.box));
await ev("window.kipForgeMake.close()");
await sleep(1500);
await page.shot(`${SHOTS}/bench-head.png`);
check("the page raised no exception", (page.exceptions ?? []).length === 0, JSON.stringify((page.exceptions ?? []).slice(0, 2)).slice(0, 400));
page.close();
await chrome.close();
server.close();
workerServer.close();
globalThis.fetch = realFetch;
finish();
console.log(`screenshots: ${SHOTS}`);
setTimeout(() => process.exit(process.exitCode ?? 0), 200);
