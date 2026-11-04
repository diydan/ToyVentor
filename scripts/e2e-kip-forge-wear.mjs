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
  resetForgeRateLimit(); // the call that just got here was counted; clear it so a quick retry is never the fourth in a minute (a timer alone raced when the machine was busy)
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

const env = { DB: fakeDb(), PARENT_GATE_SECRET: "gate-secret-for-the-e2e", FORGE_OPTIMIZER_URL: "http://127.0.0.1:8791", FORGE_AUDIENCE_DEFAULT: "adult", MODEL_API_KEY: "e2e-key", VOICE_SIGNING_KEY: "e2e-voice-signing-key-0123456789abcdef" };
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
const CROWN_KEY = "toyforge:kip:forge-part:crown:v1";
const HEAD_KEY = "toyforge:kip:forge-part:head:v1";
const stored = (k) => ev(`localStorage.getItem(${JSON.stringify(k)})`);
// a reload inside the same Chrome profile (so storage survives): mark the old page, navigate, wait for the NEW page to be ready
const reload = async (url = `${server.base}/kip/Kip-Demo.html`) => {
  await ev("window.__stale = 1");
  await page.send("Page.navigate", { url });
  return page.waitFor("!window.__stale && window.__KIP_READY__ === true", 180000);
};

const inspect = (name) => ev(`(() => { const { THREE, kip } = window.kipRig(); const c = kip.exp.${name}; const box = new THREE.Box3().setFromObject(c); const first = []; c.traverse((o) => { if (o.isMesh) first.push({ type: o.type, vis: o.visible, verts: o.geometry.attributes.position.count, norm: o.geometry.attributes.position.normalized, bs: o.geometry.boundingSphere ? [o.geometry.boundingSphere.radius] : null, scale: o.getWorldScale(new THREE.Vector3()).toArray().map((v) => +v.toFixed(4)), mat: o.material && o.material.type, opacity: o.material && o.material.opacity, transparent: o.material && o.material.transparent }); }); let anc = c, chain = []; while (anc) { chain.push(anc.name + ':' + anc.visible); anc = anc.parent; } return JSON.stringify({ visible: c.visible, children: c.children.length, box: [box.min.toArray().map((v) => +v.toFixed(1)), box.max.toArray().map((v) => +v.toFixed(1))], worldPos: c.getWorldPosition(new THREE.Vector3()).toArray().map((v) => +v.toFixed(1)), meshes: first.slice(0, 3), chain: chain.slice(0, 8) }); })()`);
await ev(`localStorage.setItem('toyforge:device:v1', ${JSON.stringify(DEVICE)})`);
const meshInfo = (name) => ev(`(() => { const { kip } = window.kipRig(); const c = kip.exp.${name}; const hex = []; let meshes = 0; c.traverse((o) => { if (o.isMesh) { meshes++; hex.push(o.material.color.getHexString()); } }); return JSON.stringify({ groups: c.children.length, meshes, hex: [...new Set(hex)] }); })()`);
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
const hatMat = JSON.parse(await meshInfo("customCrownContainer"));
check("the worn hat is in the default custom-part purple until the child picks a colour", hatMat.hex.length === 1 && hatMat.hex[0] === "7c4dff", JSON.stringify(hatMat));
await ev("document.querySelector('.kfm-colours [data-colour=green]').click()");
check("picking green dresses Kip again: the same one hat, now green (not a second hat on top)", await page.waitFor(`JSON.parse((() => { const { kip } = window.kipRig(); const c = kip.exp.customCrownContainer; let h = []; c.traverse((o) => { if (o.isMesh) h.push(o.material.color.getHexString()); }); return JSON.stringify({ g: c.children.length, h }); })()).h.every((x) => x === '43a047')`, 15000));
const hatGreen = JSON.parse(await meshInfo("customCrownContainer"));
check("one group, the same meshes as before, all green", hatGreen.groups === 1 && hatGreen.meshes === hatMat.meshes && hatGreen.hex.join() === "43a047", JSON.stringify(hatGreen));
check("and it is still drawn at a size and place a child can see", sane(JSON.parse(await inspect("customCrownContainer"))));
await page.shot(`${SHOTS}/bench-hat-green.png`);
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

// 3b. kept across a reload (local storage, written by the bench): what is saved, that it holds no words, and that a reload puts both parts back
const crownRec = JSON.parse((await stored(CROWN_KEY)) || "null");
const headRec = JSON.parse((await stored(HEAD_KEY)) || "null");
check("wearing saved one record per slot: the part's file, its generated name and the colour the child picked", crownRec?.v === 1 && crownRec.slot === "crown" && crownRec.name === "Dome Hat" && crownRec.colorHex === "#43a047" && crownRec.glbBase64 === DOME && headRec?.slot === "head" && headRec.name === "Robot Head" && headRec.colorHex === "#43a047" && headRec.glbBase64 === ROBOT, JSON.stringify({ c: crownRec && Object.keys(crownRec), h: headRec && headRec.name }));
check("the records hold no words the child typed", !(await stored(CROWN_KEY)).includes("dome hat") && !(await stored(HEAD_KEY)).includes("robot head") && !(await stored(CROWN_KEY)).includes("a dome"));
check("those are the only two forge-part keys in storage (one per slot)", (await ev("Object.keys(localStorage).filter((k) => k.startsWith('toyforge:kip:forge-part')).sort().join(',')")) === `${CROWN_KEY},${HEAD_KEY}`);
check("the page reloads", await reload());
check("after the reload Kip is wearing the saved hat and the saved head", (await loco()).includes('"hat":"custom"') && (await loco()).includes('"head":"custom"'), await loco());
const hatBack = JSON.parse(await meshInfo("customCrownContainer"));
const headBack = JSON.parse(await meshInfo("customHeadContainer"));
check("the hat came back in the green the child picked, as one group", hatBack.groups === 1 && hatBack.hex.join() === "43a047", JSON.stringify(hatBack));
check("the head came back as one group in the same green (the colour the child picked carries to the next part)", headBack.groups === 1 && headBack.hex.join() === "43a047", JSON.stringify(headBack));
check("both are drawn at a size and place a child can see", sane(JSON.parse(await inspect("customCrownContainer"))) && sane(JSON.parse(await inspect("customHeadContainer"))));
check("restoring did not write the records again or lose them", (await stored(CROWN_KEY)) !== null && (await stored(HEAD_KEY)) !== null);
await ev("window.kipMenu.ctx.act.openForgeMake()");
await page.waitFor("window.kipForgeMake && window.kipForgeMake.isOpen()", 20000);
await ev("window.kipForgeMake.close()");
await sleep(1500);
await page.shot(`${SHOTS}/bench-head.png`);
// 4. the fallback on the real bench: a wish the maker cannot make ends with the nearest ready-made hat or head, worn through the bench's own setters
model.mode = "not_json";
const clock = setInterval(() => resetForgeRateLimit(), 20); // the minute a fourth call would rest for passes as it happens (every 20 ms, so four quick retries never count as four in a minute)
for (const [wish, slot, label, key, want] of [["a pirate hat", "crown", "Tricorne Hat", "hat", "pirate"], ["a robot head", "head", "Bolt Robot", "head", "robot"]]) {
  await ev("window.kipForgeMake.open()");
  await press("Make another");
  await setText(wish); await pickSlot(slot); await press("Make it");
  check(`"${wish}": the maker has no answer, and a ready-made one is offered`, await page.waitFor("(() => { const r = document.querySelector('.kfm-ready'); return Boolean(r && !r.hidden && r.offsetParent !== null); })()", 60000));
  await press(`Wear the ${label}`);
  check(`pressing it puts the ${label} on Kip, through the bench's own setter`, await page.waitFor(`window.kipMenu.ctx.loco.${key} === ${JSON.stringify(want)}`, 15000), await loco());
  check("and the panel says so", (await text(".kfm-wearnote")).includes(`Kip is wearing the ${label}`));
}
clearInterval(clock);
model.mode = "ok";

// 5. the saved part always says what Kip wears now: the ready-made hat and head just put on replaced them, so nothing is saved, and a reload brings nothing back
check("wearing a ready-made hat and head dropped both saved parts", (await stored(CROWN_KEY)) === null && (await stored(HEAD_KEY)) === null);
check("a reload after that puts nothing made-from-words on Kip", (await reload()) && !(await loco()).includes('"hat":"custom"') && !(await loco()).includes('"head":"custom"'), await loco());

// a record written by hand (a good one) is restored; the same with a look asked for in the address is not, and is dropped
const putRecord = (slot, rec) => ev(`localStorage.setItem(${JSON.stringify(slot === "crown" ? CROWN_KEY : HEAD_KEY)}, ${JSON.stringify(JSON.stringify(rec))})`);
await putRecord("crown", { v: 1, slot: "crown", name: "Hand Hat", colorHex: "#e53935", glbBase64: DOME, savedAt: 1 });
check("the page reloads with a hand-written good record", await reload());
check("it was put on Kip, in its red", (await loco()).includes('"hat":"custom"') && JSON.parse(await meshInfo("customCrownContainer")).hex.join() === "e53935");
check("a reload with a look asked for in the address (?head=fox) keeps that look and does not put the saved hat on", (await reload(`${server.base}/kip/Kip-Demo.html?head=fox`)) && (await loco()).includes('"head":"fox"') && !(await loco()).includes('"hat":"custom"'), await loco());
check("and the saved hat is NOT erased by that visit (a link never costs a child the part they made)", (await stored(CROWN_KEY)) !== null);
check("the next plain visit puts it back on, still in its red", (await reload()) && (await loco()).includes('"hat":"custom"') && JSON.parse(await meshInfo("customCrownContainer")).hex.join() === "e53935", await loco());

// records that are not what the bench wrote are dropped quietly, and never crash the page
await putRecord("crown", { v: 1, slot: "crown", name: "Bad", glbBase64: "not base64 !!" });
await putRecord("head", { v: 1, slot: "head", name: "Broken file", glbBase64: Buffer.from("this is not a glb file at all, just text").toString("base64") });
check("the page reloads with a record that is not base64 and one that is not a file", await reload());
check("neither is worn, both are dropped, and the page is calm", !(await loco()).includes('"hat":"custom"') && !(await loco()).includes('"head":"custom"') && (await stored(CROWN_KEY)) === null && (await stored(HEAD_KEY)) === null, await loco());
await ev("localStorage.setItem('toyforge:kip:forge-part:crown:v1', '{not json')");
check("a record that is not even JSON is dropped too", (await reload()) && (await stored(CROWN_KEY)) === null);
check("the page raised no exception", (page.exceptions ?? []).length === 0, JSON.stringify((page.exceptions ?? []).slice(0, 2)).slice(0, 400));
page.close();
await chrome.close();
server.close();
workerServer.close();
globalThis.fetch = realFetch;
finish();
console.log(`screenshots: ${SHOTS}`);
setTimeout(() => process.exit(process.exitCode ?? 0), 200);
