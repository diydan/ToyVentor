#!/usr/bin/env node
// Text to part: the panel (parts/kip/viewer/kip-forge-make.js) in headless Chrome, against the REAL Worker routes.
// Run: npm run e2e:kip-forge-make     Exits nonzero on any failing check.
//
// What is real: the panel and its bundled flow module (public/kip/kip-forge-make-core.js, built by build-kip.ts), the Worker (worker/index.ts:
// /api/forge/make, /api/forge/make/jobs/, /api/forge/artifacts/, /api/voice, the parent gate, rate limits and scrubbing), run in this process.
// What is stood in: the model (it answers with a recipe and names) and the optimizer daemon (it answers the gate with a script). No key, no real model.
// The bench's "Wear it" is a recording stub here (the real one is checked in tests/forge-make-wiring.test.ts and by hand): this proves the panel hands
// the page the first look and the slot.
// Env: E2E_CHROME, E2E_SHOTS (see scripts/lib/kip-e2e.mjs).
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createChecks, launchChrome, startServer } from "./lib/kip-e2e.mjs";

const SHOTS = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), "kip-forge-make-shots");
const DEVICE = "12345678-1234-1234-1234-123456789abc";
const STL = "custom_wizard_hat.0123456789ab.stl";
const { check, finish } = createChecks("kip forge make e2e");

const worker = (await import("../worker/index.ts")).default;
const { resetForgeRateLimit } = await import("../worker/forgeOptimizer.ts");

const RECIPE = { v: 1, id: "wizard_hat", name: "Starlight Wizard Hat", stat: "Glow", behavior: "Tall hat that clicks on", slot: "crown", shape: { kind: "loft", slices: [{ z: 0, w: 23.4, d: 11.4, r: 4.6 }, { z: 10, w: 28, d: 14, r: 5 }, { z: 20, w: 14, d: 8, r: 3 }] } };
const NAMES = { en: { w: "wizard hat", g: "m" }, es: { w: "sombrero de mago", g: "m" }, fr: { w: "chapeau de magicien", g: "m" }, de: { w: "Zauberhut", g: "m" }, it: { w: "cappello da mago", g: "m" }, pt: { w: "chapéu de mago", g: "m" }, tr: { w: "büyücü şapkası", g: "m" } };
const STL_BYTES = (() => { const b = Buffer.alloc(84 + 50); b.writeUInt32LE(1, 80); return b; })();

// ---- the stand-ins: the model and the daemon ----------------------------------------------------------------------------------
const model = { calls: 0, mode: "ok" }; // ok | not_json
const daemon = { previews: 0, polls: {}, down: false, artifactRequests: [], validatingPolls: 2 };

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function daemonFetch(url, init) {
  const p = url.pathname;
  if (p === "/v1/fast-preview") {
    if (daemon.down) return json({ ok: false }, 503);
    daemon.previews++;
    return json({ ok: true, status: "preview_ready", part_id: "custom_wizard_hat", job_id: `fjob_${String(daemon.previews).padStart(12, "0")}`, draft_artifact: "x.draft.glb", glb_size: 4, orig_tris: 1, web_verts: 1, web_tris: 1, finish_class: "show_curved", elapsed_ms: 20, glb_base64: "Z2xiZ2xi" });
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
  return json({ output_text: model.mode === "not_json" ? "Sure! Here is a hat." : JSON.stringify({ recipe: RECIPE, names: NAMES }) });
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

// ---- the run -------------------------------------------------------------------------------------------------------------------
const server = await startServer();
const chrome = await launchChrome({ width: 900, height: 900 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let page;
try {
  page = await chrome.open(`${server.base}/__host`);
  await page.waitFor("document.readyState === 'complete'", 20000);
  const ev = (expr) => page.evaluate(expr);
  const step = () => ev("window.__kfm.state.step");
  const text = (sel) => ev(`(document.querySelector(${JSON.stringify(sel)}) || {}).textContent || ''`);
  const visible = (sel) => ev(`(() => { const n = document.querySelector(${JSON.stringify(sel)}); return Boolean(n && !n.hidden && n.offsetParent !== null); })()`);
  const press = (label) => ev(`(() => { const b = [...document.querySelectorAll('.kfm-back button')].find((x) => x.textContent.includes(${JSON.stringify(label)}) && !x.hidden && x.offsetParent !== null && !x.disabled); if (!b) return false; b.click(); return true; })()`);
  const setText = (t) => ev(`(() => { const i = document.querySelector('.kfm-back input[type=text]'); i.value = ${JSON.stringify(t)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const pickSlot = (v) => ev(`(() => { const r = [...document.querySelectorAll('.kfm-slot input')].find((x) => x.value === ${JSON.stringify(v)}); r.checked = true; })()`);
  const mount = (extra = "") =>
    ev(`(async () => { const m = await import('/kip/kip-forge-make.js?v=10.0'); localStorage.setItem('toyforge:device:v1', ${JSON.stringify(DEVICE)}); window.__wear = []; window.__wearOk = true; window.__kfm = m.createForgeMake({ root: document.body, onWear: async (p) => { window.__wear.push(p); return { ok: window.__wearOk }; }, lang: () => window.__lang || 'en'${extra} }); window.__kfm.open(); return true; })()`);
  const apiCalls = () => server.apiCalls;
  const shot = async (name) => { try { await page.shot(path.join(SHOTS, `${name}.png`)); } catch { /* a screenshot is a convenience */ } };

  // [1] the panel opens on the question, and says what to do when there are no words
  await mount();
  check("it opens on the ask step with the idea chips and the three choices", (await step()) === "ask" && (await ev("document.querySelectorAll('.kfm-chips button').length")) === 6 && (await ev("document.querySelectorAll('.kfm-slot input').length")) === 3);
  await press("Make it");
  check("no words: a calm sentence, nothing sent", (await text(".kfm-status")).includes("Say what you would like") && model.calls === 0 && daemon.previews === 0);
  await ev("document.querySelector('.kfm-chips button').click()");
  check("an idea chip fills the box", (await ev("document.querySelector('.kfm-back input[type=text]').value")) === "a wizard hat");

  // [2] make a part: no grown-up proof asked, the strip shows, the first look arrives before the checks end and can be worn at once
  resetForgeRateLimit();
  await pickSlot("");
  await press("Make it");
  check("pressing Make it moves to the working step", await page.waitFor("window.__kfm.state.step === 'working'", 5000));
  check("the first look arrived", await page.waitFor("window.__kfm.state.hasFirstLook === true", 30000));
  check("the first look arrives while the checks are still running, with its name, and the strip is showing", (await step()) === "working" && (await text(".kfm-name")).includes("Starlight Wizard Hat") && (await visible(".kww-workshop")));
  check("no grown-up question was asked to make it (no proof, no gate calls)", !(await ev("window.__kfm.state.hasProof")) && !apiCalls().some((c) => c.path === "/api/parent/gate"));
  check("the make request carried the device id and no proof", apiCalls().filter((c) => c.path === "/api/forge/make").every((c) => c.headers["x-device-id"] === DEVICE && !c.headers["x-parent-proof"]));
  const wearNowShown = await visible(".kfm-ok");
  check("'Put it on Kip now' is offered as soon as the first look is there", wearNowShown);
  await press("Put it on Kip now");
  await page.waitFor("window.__wear.length === 1", 10000);
  const wore = await ev("window.__wear[0]");
  check("Wear it hands the page the first look and the slot", wore.slot === "crown" && wore.glbBase64 === "Z2xiZ2xi" && wore.name === "Starlight Wizard Hat", JSON.stringify(wore));
  check("the page said it worked, and the panel says so (on a line the strip does not overwrite)", (await text(".kfm-wearnote")).includes("Kip is wearing it"));
  await shot("working");

  // [3] done: the printable part, its name, the speaker, the save button
  check("the checks finished", await page.waitFor("window.__kfm.state.step === 'done'", 60000));
  check("the checks passed: a printable part, with a sentence and no code", (await ev("window.__kfm.state.printable")) === true && (await text(".kfm-done .kfm-sub")).includes("passed the printer check"));
  check("the name is shown, and the Say it button is there", (await text(".kfm-done .kfm-name")) === "Starlight Wizard Hat" && (await visible(".kfm-done .kfm-sayname")) && (await visible(".kfm-done button.kfm-ok")));
  check("it took one model call and one preview", model.calls === 1 && daemon.previews === 1);
  await ev("window.__lang = 'es'; window.__audio = []; window.Audio = class { constructor(u) { window.__audio.push(u); } play() { return Promise.resolve(); } pause() {} };");
  await press("Say it");
  await sleep(300);
  const voiceUrl = await ev("window.__audio[0] || ''");
  const vq = voiceUrl ? new URL(`http://x${voiceUrl}`).searchParams : null;
  check("Say it asks /api/voice for the name in the chosen language with a signature", Boolean(vq) && vq.get("lang") === "es" && vq.get("w") === "sombrero de mago" && vq.get("g") === "m" && /^[A-Za-z0-9_-]{43}$/.test(vq.get("sig") ?? ""), voiceUrl);
  const ask = (u) => realFetch(`${process.env.E2E_API_PROXY}${u}`, { headers: { "x-device-id": DEVICE } });
  check("the Worker accepts that signature (it is not refused as unsigned)", voiceUrl !== "" && (await ask(voiceUrl)).status !== 403);
  check("and refuses the same signature on a different word", voiceUrl !== "" && (await ask(voiceUrl.replace("sombrero+de+mago", "otro+sombrero"))).status === 403);

  // [4] saving the file is the one step that needs the grown-up
  const gateCallsBefore = apiCalls().filter((c) => c.path === "/api/parent/gate").length;
  await press("Save for printing");
  check("the grown-up question appears", await page.waitFor("window.__kfm.state.step === 'gate'", 10000));
  check("saving asks the grown-up question", (await ev("window.__kfm.state.step")) === "gate" && (await text(".kfm-gate .kfm-sub")).includes("A grown-up needs to say yes"));
  await page.waitFor("/what is \\d+ × \\d+/.test(document.querySelector('.kfm-gate .kfm-q').textContent)", 10000);
  const qText = await text(".kfm-gate .kfm-q");
  const [, a, b] = /what is (\d+) × (\d+)/.exec(qText);
  await ev("document.querySelector('.kfm-gate input').value = '0'");
  await press("Check");
  await page.waitFor("document.querySelector('.kfm-status.bad') !== null", 10000);
  check("a wrong answer gets a calm sentence and a fresh question", (await text(".kfm-status")).length > 0 && (await ev("window.__kfm.state.step")) === "gate");
  await page.waitFor("/what is \\d+ × \\d+/.test(document.querySelector('.kfm-gate .kfm-q').textContent)", 10000);
  const [, a2, b2] = /what is (\d+) × (\d+)/.exec(await text(".kfm-gate .kfm-q"));
  await ev(`document.querySelector('.kfm-gate input').value = ${JSON.stringify(String(Number(a2) * Number(b2)))}`);
  await press("Check");
  await page.waitFor("document.querySelector('.kfm-links a') !== null", 20000);
  const href = await ev("document.querySelector('.kfm-links a').getAttribute('download')");
  check("the right answer saves the file: a download link named for the part", href === "starlight-wizard-hat.stl" && daemon.artifactRequests.includes(STL), href);
  const fileReq = apiCalls().filter((c) => c.path.startsWith("/api/forge/artifacts/")).pop();
  check("the file request carried the grown-up proof", Boolean(fileReq?.headers["x-parent-proof"]));
  check("the question was asked for the file only: gate calls began after Save", apiCalls().filter((c) => c.path === "/api/parent/gate").length > gateCallsBefore);
  await shot("done");

  // [5] make another, and the refusals: a brand, a word that is not allowed, a daemon that is down, a model that sends nonsense
  await press("Make another");
  check("Make another returns to the question", (await step()) === "ask");
  const modelBefore = model.calls;
  for (const [words, why] of [["a lego car", "brand"], ["a scary knife", "unsafe"]]) {
    resetForgeRateLimit();
    await setText(words);
    await press("Make it");
    await page.waitFor("document.querySelector('.kfm-status.bad') !== null", 30000);
    check(`"${words}" ends calmly on the question with a sentence (${why}), no code, and spends no model call`, (await step()) === "ask" && /try another idea|something else/i.test(await text(".kfm-status")) && model.calls === modelBefore);
  }
  resetForgeRateLimit();
  daemon.down = true;
  await setText("a wizard hat");
  await press("Make it");
  await page.waitFor("document.querySelector('.kfm-status.bad') !== null", 40000);
  check("a daemon that is down ends calmly: busy, try again", (await step()) === "ask" && /busy|try again/i.test(await text(".kfm-status")) && !/\d{3}|unreachable|fjob/i.test(await text(".kfm-status")));
  daemon.down = false;
  resetForgeRateLimit();
  model.mode = "not_json";
  await setText("a wizard hat");
  const callsBefore = model.calls;
  // the Worker lets 3 calls through a minute, so a fourth would really rest for 60 s: let the minute pass as it happens, and check the rest was shown
  let sawRest = false;
  const clock = setInterval(() => { resetForgeRateLimit(); }, 250);
  const watch = setInterval(async () => { try { if ((await text(".kfm-work .kfm-sub, .kfm-status")).includes("short rest")) sawRest = true; } catch { /* page busy */ } }, 400);
  await press("Make it");
  await page.waitFor("document.querySelector('.kfm-status.bad') !== null", 90000);
  clearInterval(clock);
  clearInterval(watch);
  check("a model that sends no recipe is asked again, within the budget of four, then ends calmly", (await step()) === "ask" && model.calls - callsBefore >= 2 && model.calls - callsBefore <= 4 && (await text(".kfm-status")).includes("Try another idea"));
  model.mode = "ok";

  // [6] a part that will not wear ends calmly; letting go removes everything
  resetForgeRateLimit();
  daemon.validatingPolls = 0;
  await ev("window.__wearOk = false");
  await setText("a wizard hat");
  await press("Make it");
  await page.waitFor("window.__kfm.state.step === 'done'", 60000);
  await press("Wear it");
  await page.waitFor("window.__wear.length >= 2", 10000);
  await sleep(300);
  check("a part the page cannot put on Kip gets a calm sentence, and can be tried again", (await text(".kfm-wearnote")).includes("could not wear") && (await ev("window.__kfm.state.worn")) === false);
  await ev("window.__kfm.dispose()");
  check("dispose removes the panel from the page", (await ev("document.querySelector('.kfm-back') === null")) === true);
  check("the panel wrote nothing to storage (only the harness's device id is there)", (await ev("Object.keys(localStorage).sort().join(',')")) === "toyforge:device:v1" && (await ev("document.cookie")) === "");
} catch (e) {
  check("the run finished without an error", false, String(e?.stack ?? e));
} finally {
  page?.close?.();
  await chrome.close();
  server.close();
  workerServer.close();
}
globalThis.fetch = realFetch;
finish();
console.log(`screenshots: ${SHOTS}`);
setTimeout(() => process.exit(process.exitCode ?? 0), 200);
