#!/usr/bin/env node
// Kip demo side menu: headless-Chrome checks (Phase 1 of docs/specs/parts-engineering-spec.md section 10.2).
// Run: npm run e2e:kip-menu     Exits nonzero on any failing check.
// Env: E2E_CHROME (binary), E2E_SHOTS (screenshot dir), E2E_STRICT_STL=1 (fail on missing STLs instead of stubbing).
//
// The menu is the page's only control surface (the bottom dock is gone). Its feature parity with the dock was
// proven before the dock was removed (commit aa60423: 165 one-step comparisons of "click the dock button" against
// "choose the same option in the menu", all equal, plus every dock option reachable and nothing extra). What stays
// here guards that result:
//   - every option of every control, chosen through the real <select>, must change the live state to that option
//     and leave the menu showing it (so no option is a dead entry and no handler throws);
//   - the option sets themselves are frozen in tests/kip-menu.test.ts (DOCK_OPTIONS), so an option cannot silently vanish;
//   - DOCK_PARITY (kip-menu.js) still names a real menu control for every old dock element.
import os from "node:os";
import path from "node:path";
import { DOCK_PARITY } from "../parts/kip/viewer/kip-menu.js";
import { createChecks, launchChrome, startServer } from "./lib/kip-e2e.mjs";

const SHOTS = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), "kip-menu-shots");
const { check, finish } = createChecks("kip menu e2e");

/** Runs inside the page. Chooses every option of every control and reports what did not take. */
async function optionsInPage() {
  const m = window.kipMenu;
  const ctx = m.ctx;
  const act = ctx.act;
  const loco = ctx.loco;
  const $ = (id) => document.getElementById(id);
  const sel = (id) => m.fields.get(id).select;
  const human = () => act.setCategory("human");
  const hatReadyHuman = () => { human(); act.setHair("short_swept"); };

  const reset = () => {
    act.setExplode(0);
    act.playClip("idle");
    act.applyPreset("clean");
    act.setFaceInsert("sculpted"); act.setCovers(true); act.setRacerKit(true);
    act.setEdition("pro"); act.setSpeed(1); act.setHairColor("chestnut"); act.setHatColor("cobalt_cap");
    if (ctx.read.refOn()) act.toggleRef();
    $("modal-llm").classList.remove("open"); $("modal-photo").classList.remove("open");
    m.sync();
  };
  const choose = (id, v) => {
    m.sync();
    const s = sel(id);
    s.value = String(v);
    if (s.value !== String(v)) throw new Error(`option ${v} missing from select ${id}`);
    s.dispatchEvent(new Event("change", { bubbles: true }));
    m.sync();
  };
  const flip = (id) => {
    const f = m.fields.get(id).input;
    f.checked = !f.checked;
    f.dispatchEvent(new Event("change", { bubbles: true }));
    m.sync();
  };

  // control id -> where its value lives, and the state it needs to be visible
  const controls = [
    { id: "type", get: () => loco.category, pre: () => {} },
    ...["human", "robot", "animal", "creature"].map((cat) => ({ id: "head", tag: cat, get: () => loco.head, pre: () => act.setCategory(cat) })),
    { id: "face", get: () => loco.expr, pre: () => {} },
    { id: "faceInsert", get: () => loco.faceInsert, pre: human },
    { id: "skin", get: () => loco.skin, pre: human },
    { id: "hair", get: () => loco.hair, pre: human },
    { id: "hairColor", get: () => loco.hairColor, pre: hatReadyHuman },
    { id: "hat", get: () => loco.hat, pre: hatReadyHuman },
    { id: "hatColor", get: () => loco.hatColor, pre: () => { hatReadyHuman(); act.setHat("ballcap"); } },
    { id: "shirt", get: () => loco.shirt, pre: human },
    { id: "pants", get: () => loco.pants, pre: human },
    { id: "back", get: () => loco.back, pre: () => {} },
    { id: "tail", get: () => ctx.read.tail(), pre: () => {} },
    { id: "prop", get: () => loco.prop, pre: () => {} },
    { id: "preset", get: () => ctx.read.preset(), pre: () => {} },
    { id: "edition", get: () => loco.edition, pre: () => {} },
    { id: "speed", get: () => String(ctx.read.speed()), pre: () => {} },
    { id: "vehicle", get: () => loco.vehicle, pre: () => {} },
    { id: "clip", get: () => ctx.read.clip(), pre: () => {} },
  ];

  const out = { options: {}, tried: 0, failures: [], errors: [] };
  for (const c of controls) {
    const key = c.tag ? `${c.id}[${c.tag}]` : c.id;
    try {
      reset(); c.pre(); m.sync();
      const values = [...sel(c.id).options].filter((o) => !o.disabled).map((o) => o.value);
      out.options[key] = values;
      for (const v of values) {
        reset(); c.pre();
        try {
          choose(c.id, v);
          out.tried++;
          if (String(c.get()) !== v) out.failures.push(`${key} = ${v}: state is ${c.get()}`);
          else if (sel(c.id).value !== v) out.failures.push(`${key} = ${v}: menu shows ${sel(c.id).value}`);
        } catch (e) { out.errors.push(`${key} = ${v}: ${e.message}`); }
      }
    } catch (e) { out.errors.push(`${key}: ${e.message}`); }
  }

  // switches, the pull slider, buttons
  const act1 = (key, fn, ok) => {
    try { reset(); fn(); m.sync(); out.tried++; if (!ok()) out.failures.push(key); } catch (e) { out.errors.push(`${key}: ${e.message}`); }
  };
  act1("covers off", () => flip("covers"), () => loco.vehCovers === false);
  act1("racer kit off", () => flip("racerKit"), () => loco.racerKit === false);
  act1("reference skeleton on", () => flip("ref"), () => ctx.read.refOn() === true);
  act1("explode on", () => flip("explode"), () => loco.explodeTarget >= 0.5);
  act1("part pile on", () => flip("pile"), () => loco.buildMode === "pile");
  act1("pull range 40", () => { const i = m.fields.get("pull").input; i.value = "40"; i.dispatchEvent(new Event("input", { bubbles: true })); }, () => Math.abs(loco.explodeTarget - 0.4) < 0.02);
  act1("pile -> build", () => $("km-build").click(), () => loco.buildMode === "building");
  act1("open LLM modal", () => $("km-llm").click(), () => $("modal-llm").classList.contains("open"));
  act1("open photo modal", () => $("km-photo").click(), () => $("modal-photo").classList.contains("open"));
  out.fileAccept = $("km-file").getAttribute("accept");
  reset();
  return out;
}

/** Runs inside the page: every control's DOM must equal what get() says (no select holds its own state). */
const INVARIANT = `(() => {
  const m = window.kipMenu; m.sync(); const bad = [];
  for (const [id, c] of m.controls) {
    const f = m.fields.get(id);
    if (f.root.hidden) continue; // hidden controls are not painted until they become visible
    if (c.kind === 'select') { if (f.select.value !== String(c.get()) && String(c.get()) !== '') bad.push(id + ': dom=' + f.select.value + ' state=' + c.get()); }
    else if (c.kind === 'toggle') { if (f.input.checked !== !!c.get()) bad.push(id + ' toggle'); }
    else if (c.kind === 'range') { if (f.input.value !== String(c.get())) bad.push(id + ' range'); }
  }
  return bad;
})()`;

const val = (id) => `(() => { const m = window.kipMenu; m.sync(); const f = m.fields.get(${JSON.stringify(id)}); return f.select ? f.select.value : f.input.checked; })()`;

function toyHash(contract) {
  const b64 = Buffer.from(JSON.stringify(contract)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `#toy=${b64}`;
}

async function loadPage(chrome, url, opts) {
  const tab = await chrome.open(url, opts);
  const ready = await tab.waitFor("window.__KIP_READY__ === true", 180000);
  await tab.waitFor("!!window.kipMenu", 5000);
  return { tab, ready };
}

const server = await startServer();
const chrome = await launchChrome({ width: 1440, height: 900 });
try {
  console.log(`serving ${server.base} (viewer sources overlaid on public/)`);

  // ---- 1. main page ----------------------------------------------------------------------
  console.log("\n[1] default page at 1440x900: the menu is the UI");
  const { tab, ready } = await loadPage(chrome, `${server.base}/kip/Kip-Demo.html`);
  check("demo initialises with the panel mounted (no flag)", ready && (await tab.evaluate("!!window.kipMenu")), tab.exceptions[0]);
  if (server.missing.size) console.log(`  note: ${server.missing.size} STL(s) missing on disk, stubbed: ${[...server.missing].map((p) => path.basename(p)).join(", ")}`);
  check("no bottom dock in the page", await tab.evaluate(`!document.querySelector('.dock') && !document.getElementById('row-clips') && document.querySelectorAll('button[id^="btn-veh-"], #btn-category, #btn-preset').length === 0`));
  check("panel visible and 288 px wide", await tab.evaluate(`(() => { const r = document.getElementById('kip-menu').getBoundingClientRect(); return Math.round(r.width) === 288 && r.height > 300; })()`));
  check("panel is live (not busy/inert)", await tab.evaluate(`document.getElementById('kip-menu').getAttribute('aria-busy') === 'false' && !document.getElementById('km-body').hasAttribute('inert')`));
  check("selects match state at load", (await tab.evaluate(INVARIANT)).length === 0, JSON.stringify(await tab.evaluate(INVARIANT)));

  const run = await tab.evaluate(`(${optionsInPage.toString()})()`);
  console.log(`\n[2] every option of every control: ${run.tried} choices through the real controls`);
  check("no handler errors", run.errors.length === 0, run.errors.slice(0, 4).join("; "));
  check("every choice changed the live state and the menu shows it", run.failures.length === 0, run.failures.slice(0, 6).join("; "));
  check("file loader accepts .stl, .fbx, .glb, .gltf", run.fileAccept === ".stl,.fbx,.glb,.gltf", run.fileAccept);
  console.log("\n  dock element (retired) -> menu control (options)");
  const counts = Object.fromEntries(Object.entries(run.options).map(([k, v]) => [k.replace(/\[.*/, ""), Math.max(v.length, 0)]));
  for (const [dock, ctl] of Object.entries(DOCK_PARITY)) console.log(`    ${dock.padEnd(16)} -> ${ctl.padEnd(11)} ${counts[ctl] ?? ""}`);
  const everyControl = await tab.evaluate(`[...window.kipMenu.controls.keys()]`);
  check("DOCK_PARITY names a real menu control for every retired dock element", Object.values(DOCK_PARITY).every((c) => everyControl.includes(c)));
  check("selects match state after the option sweep", (await tab.evaluate(INVARIANT)).length === 0);

  // ---- 3. two-way sync -------------------------------------------------------------------
  console.log("\n[3] two-way sync");
  await tab.evaluate(`window.kipMenu.ctx.act.applyPreset('boy')`);
  check("a programmatic preset shows in the menu (preset, hair, hat)", await tab.waitFor(`${val("preset")} === 'boy' && ${val("hair")} === 'short_swept' && ${val("hat")} === 'ranger'`, 15000));
  await tab.evaluate(`(() => { const s = window.kipMenu.fields.get('hair').select; s.value = 'curly'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  check("editing after a preset flips it to Custom", await tab.waitFor(`${val("preset")} === '__custom__'`, 15000));
  await tab.evaluate(`(() => { const s = window.kipMenu.fields.get('preset').select; s.value = 'boy'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  check("re-applying the preset restores it", await tab.waitFor(`${val("preset")} === 'boy' && ${val("hair")} === 'short_swept'`, 15000));
  await tab.evaluate(`window.kipMenu.ctx.act.setVehicle('moto')`);
  check("programmatic setter shows in the menu", await tab.waitFor(`${val("vehicle")} === 'moto'`, 15000));
  await tab.evaluate(`window.kipMenu.ctx.act.setCategory('animal')`);
  check("category change rebuilds Head options and hides human controls", await tab.waitFor(`(() => { const m = window.kipMenu; return [...m.fields.get('head').select.options].map(o => o.value).join() === 'fox,bear,cat' && m.fields.get('hair').root.hidden && m.fields.get('shirt').root.hidden === false && m.fields.get('tail').root.hidden === false; })()`, 15000));
  check("hat label follows the category (Topper)", await tab.evaluate(`window.kipMenu.fields.get('hat').label.textContent === 'Topper'`));
  check("selects match state after sync tests", (await tab.evaluate(INVARIANT)).length === 0);

  // ---- 4. shortcuts ----------------------------------------------------------------------
  console.log("\n[4] keyboard shortcuts");
  await tab.evaluate(`window.kipMenu.ctx.act.applyPreset('clean'); document.getElementById('km-speed').focus();`);
  await tab.key("e"); await tab.key("h"); await tab.key("b");
  const whileFocused = await tab.evaluate(`({ explode: window.kipMenu.ctx.loco.explodeTarget, clean: document.querySelector('.kip-bench').classList.contains('clean-ui'), mode: window.kipMenu.ctx.loco.buildMode, focus: document.activeElement.id })`);
  check("E, H, B ignored while a select is focused", whileFocused.explode === 0 && !whileFocused.clean && whileFocused.mode === 'assembled' && whileFocused.focus === 'km-speed', JSON.stringify(whileFocused));
  await tab.evaluate(`document.activeElement.blur()`);
  await tab.key("e");
  check("E toggles explode once focus is back on the scene", await tab.evaluate(`window.kipMenu.ctx.loco.explodeTarget === 1`));
  await tab.key("e");
  await tab.key("h");
  check("H hides the panel and releases the camera offset", await tab.waitFor(`document.querySelector('.kip-bench').classList.contains('clean-ui') && getComputedStyle(document.getElementById('kip-menu')).display === 'none' && !(window.kipMenu.ctx.camera.view && window.kipMenu.ctx.camera.view.enabled)`, 15000));
  await tab.key("h");
  check("H brings it back and re-centres Kip", await tab.waitFor(`!document.querySelector('.kip-bench').classList.contains('clean-ui') && window.kipMenu.ctx.camera.view && window.kipMenu.ctx.camera.view.enabled && Math.round(window.kipMenu.ctx.camera.view.offsetX) === -151`, 15000));
  check("selects keep keyboard focus after a keyboard change", await tab.evaluate(`(() => { const s = document.getElementById('km-edition'); s.focus(); s.value = 'snap'; s.dispatchEvent(new Event('change', { bubbles: true })); const kept = document.activeElement === s; s.value = 'pro'; s.dispatchEvent(new Event('change', { bubbles: true })); return kept; })()`));

  // ---- 5. layout -------------------------------------------------------------------------
  console.log("\n[5] layout and screenshots");
  await tab.evaluate(`window.kipMenu.ctx.act.applyPreset('boy')`);
  await tab.waitFor(`${val("hair")} === 'short_swept'`, 15000);
  const noOverflow = `document.documentElement.scrollWidth <= window.innerWidth`;
  await tab.shot(path.join(SHOTS, "menu-1440.png"));
  check("1440: no horizontal overflow, panel 288 px", await tab.evaluate(`${noOverflow} && Math.round(document.getElementById('kip-menu').getBoundingClientRect().width) === 288`));
  await tab.resize(1024, 768);
  await tab.waitFor(`window.innerWidth === 1024`, 10000);
  await tab.evaluate(`window.dispatchEvent(new Event('resize'))`);
  await tab.shot(path.join(SHOTS, "menu-1024.png"));
  check("1024: no overflow, panel visible, Kip re-centred for the new width", await tab.evaluate(`${noOverflow} && getComputedStyle(document.getElementById('kip-menu')).visibility === 'visible' && window.kipMenu.ctx.camera.view.fullWidth === 1024 && Math.round(window.kipMenu.ctx.camera.view.offsetX) === -151`));
  await tab.evaluate(`document.querySelector('.km-toggle').click()`);
  await tab.waitFor(`Math.round(document.getElementById('kip-menu').getBoundingClientRect().width) === 48`, 10000);
  check("collapses to a 48 px rail and widens the scene", await tab.evaluate(`Math.round(window.kipMenu.ctx.camera.view.offsetX) === -31`));
  await tab.shot(path.join(SHOTS, "menu-1024-rail.png"));
  await tab.evaluate(`document.querySelector('.km-toggle').click()`);
  await tab.resize(390, 844, true);
  await tab.waitFor(`window.innerWidth === 390`, 10000);
  await tab.evaluate(`window.dispatchEvent(new Event('resize'))`);
  await tab.waitFor(`getComputedStyle(document.getElementById('kip-menu')).visibility === 'hidden'`, 10000);
  await tab.shot(path.join(SHOTS, "menu-390-closed.png"));
  check("390: panel is a closed drawer (not focusable), FAB shown, no overflow, no camera offset", await tab.evaluate(`${noOverflow} && getComputedStyle(document.getElementById('kip-menu')).visibility === 'hidden' && getComputedStyle(document.querySelector('.km-fab')).display !== 'none' && !(window.kipMenu.ctx.camera.view && window.kipMenu.ctx.camera.view.enabled)`));
  await tab.evaluate(`document.querySelector('.km-fab').click()`);
  await tab.waitFor(`document.getElementById('kip-menu').classList.contains('km--open') && getComputedStyle(document.getElementById('kip-menu')).visibility === 'visible'`, 10000);
  await new Promise((r) => setTimeout(r, 500));
  await tab.shot(path.join(SHOTS, "menu-390-open.png"));
  check("390: FAB opens the drawer and moves focus into it", await tab.evaluate(`document.getElementById('kip-menu').contains(document.activeElement) && Math.round(document.getElementById('kip-menu').getBoundingClientRect().left) === 0`));
  await tab.key("Escape");
  check("Escape closes the drawer and returns focus to the FAB", await tab.waitFor(`!document.getElementById('kip-menu').classList.contains('km--open') && document.activeElement === document.querySelector('.km-fab')`, 10000));
  check("no page exceptions across the run", tab.exceptions.length === 0, tab.exceptions[0]);
  tab.close();

  // ---- 6. load paths ---------------------------------------------------------------------
  console.log("\n[6] URL params, #toy= and SDK loads leave every select on the active value");
  {
    // hair must be hat-ready: choosing a hat on sculpted-top hair swaps it to short_swept (app behaviour, see setCrownMode)
    const q = "?preset=boy&hair=bob&hat=cowboy&haircol=cobalt&vehicle=truck&insert=flat&clip=walk";
    const { tab: t, ready: r } = await loadPage(chrome, `${server.base}/kip/Kip-Demo.html${q}`);
    check("URL params: loads", r, t.exceptions[0]);
    check("URL params: hair/hat/tone/vehicle/insert selects show them", await t.waitFor(`${val("hair")} === 'bob' && ${val("hat")} === 'cowboy' && ${val("hairColor")} === 'cobalt' && ${val("vehicle")} === 'truck' && ${val("faceInsert")} === 'flat'`, 20000));
    check("URL params: preset still reads Leo Explorer id after overrides at load", await t.waitFor(`${val("preset")} === 'boy'`, 10000));
    check("URL params: every select equals its state", (await t.evaluate(INVARIANT)).length === 0, JSON.stringify(await t.evaluate(INVARIANT)));
    t.close();
  }
  {
    const hash = toyHash({ format: "toyventor.toy/1", name: "Menu Test", col: { c1: "#ff6b4a", c2: "#2e6fdb" }, parts: ["veh_car_x", "pack_jetpack", "tool_wrench", "eyes_pair"], stats: { speed: 1, spin: 0 }, prints: true });
    const { tab: t, ready: r } = await loadPage(chrome, `${server.base}/kip/Kip-Demo.html${hash}`);
    check("#toy=: loads", r, t.exceptions[0]);
    check("#toy=: vehicle, back, prop, hat selects show the contract", await t.waitFor(`${val("vehicle")} === 'car' && ${val("back")} === 'jetpack' && ${val("prop")} === 'wrench' && ${val("hat")} === 'ears'`, 20000));
    check("#toy=: every select equals its state", (await t.evaluate(INVARIANT)).length === 0);
    t.close();
  }
  {
    const { tab: t, ready: r } = await loadPage(chrome, `${server.base}/kip/Kip-Demo.html?sdk=hat`);
    check("SDK hat: loads", r, t.exceptions[0]);
    check("SDK hat: Hat select shows 'Wizard hat (SDK)' (not the first option)", await t.waitFor(`(() => { const s = window.kipMenu.fields.get('hat').select; return s.value === 'wizardHat' && s.selectedOptions[0].textContent === 'Wizard hat (SDK)'; })()`, 20000));
    check("SDK hat: every select equals its state", (await t.evaluate(INVARIANT)).length === 0);
    t.close();
  }
  {
    const { tab: t, ready: r } = await loadPage(chrome, `${server.base}/kip/Kip-Demo.html?clean=1`);
    check("?clean=1: loads with the whole UI hidden", r && await t.evaluate(`getComputedStyle(document.getElementById('kip-menu')).display === 'none' && !(window.kipMenu.ctx.camera.view && window.kipMenu.ctx.camera.view.enabled)`), t.exceptions[0]);
    t.close();
  }
  {
    const { tab: t, ready: r } = await loadPage(chrome, `${server.base}/kip/Kip-Demo.html?menu=side`);
    check("an old ?menu=side link still loads the same page", r && await t.evaluate(`!!window.kipMenu && !document.querySelector('.dock')`), t.exceptions[0]);
    t.close();
  }
  console.log(`\nscreenshots: ${SHOTS}`);
} finally {
  chrome.close();
  server.close();
  finish();
}
