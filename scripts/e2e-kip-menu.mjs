#!/usr/bin/env node
// Kip demo side menu: headless-Chrome checks for Phase 1 of docs/specs/kip-demo-implementation.md.
// Run: npm run e2e:kip-menu     Exits nonzero on any failing check.
// Env: E2E_CHROME (binary), E2E_SHOTS (screenshot dir), E2E_STRICT_STL=1 (fail on missing STLs instead of stubbing).
//
// What "parity" means here. Each dock button is a cycle: click once and the control moves to the next
// option, running whatever side effects its handler has. For every control and every adjacent pair
// (P -> X) in the dock's own cycle order we build the same start state with the control at P, then
//   route A: click the dock button once        route B: choose X in the menu select
// and require an identical fingerprint: live state, status text and every legacy dock label/class.
// That catches any menu path that skips a handler side effect, without trusting the schema.
import os from "node:os";
import path from "node:path";
import { DOCK_PARITY } from "../parts/kip/viewer/kip-menu.js";
import { createChecks, launchChrome, startServer } from "./lib/kip-e2e.mjs";

const SHOTS = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), "kip-menu-shots");
const { check, finish } = createChecks("kip menu e2e");

/** Runs inside the page. Returns laps, menu option sets and every parity mismatch. */
async function parityInPage() {
  const m = window.kipMenu;
  const ctx = m.ctx;
  const act = ctx.act;
  const loco = ctx.loco;
  const $ = (id) => document.getElementById(id);
  const sel = (id) => m.fields.get(id).select;
  const human = () => act.setCategory("human");
  const hatReadyHuman = () => { human(); act.setHair("short_swept"); };

  const fingerprint = () => JSON.stringify({
    loco: Object.fromEntries(
      ["edition", "category", "head", "skin", "hairColor", "hatColor", "shirt", "pants", "hair", "faceInsert", "expr",
        "hat", "crown", "back", "prop", "vehicle", "vehCovers", "racerKit", "hasPhotoAccessory", "speedScale",
        "explodeTarget", "buildMode"].map((k) => [k, loco[k]]),
    ),
    read: [ctx.read.ears(), ctx.read.tail(), ctx.read.preset(), ctx.read.clip(), ctx.read.refOn()],
    status: $("status-text").textContent,
    modals: [$("modal-llm").className, $("modal-photo").className],
    dock: [...document.querySelectorAll(".dock button, .dock input")].map(
      (b) => `${b.id || b.dataset.clip || b.dataset.veh}|${(b.textContent || "").trim()}|${b.className}|${b.value ?? ""}|${b.style.display}`,
    ),
  });

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
  };
  const flip = (id) => {
    const f = m.fields.get(id).input;
    f.checked = !f.checked;
    f.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const diff = (a, b) => {
    const A = JSON.parse(a); const B = JSON.parse(b); const out = [];
    for (const k of Object.keys(A.loco)) if (A.loco[k] !== B.loco[k]) out.push(`loco.${k}: dock=${A.loco[k]} menu=${B.loco[k]}`);
    if (A.status !== B.status) out.push(`status: dock="${A.status}" menu="${B.status}"`);
    if (JSON.stringify(A.read) !== JSON.stringify(B.read)) out.push(`read: dock=${JSON.stringify(A.read)} menu=${JSON.stringify(B.read)}`);
    if (JSON.stringify(A.modals) !== JSON.stringify(B.modals)) out.push(`modals: dock=${A.modals} menu=${B.modals}`);
    A.dock.forEach((d, i) => { if (d !== B.dock[i]) out.push(`dock[${d.split("|")[0]}]: dock="${d}" menu="${B.dock[i]}"`); });
    return out;
  };

  const cycles = [
    { id: "type", btn: "btn-category", get: () => loco.category, pre: () => {} },
    ...["human", "robot", "animal", "creature"].map((cat) => ({ id: "head", tag: cat, btn: "btn-head", get: () => loco.head, pre: () => act.setCategory(cat) })),
    { id: "face", btn: "btn-face", get: () => loco.expr, pre: () => {} },
    { id: "faceInsert", btn: "btn-face-insert", get: () => loco.faceInsert, pre: human },
    { id: "skin", btn: "btn-skin", get: () => loco.skin, pre: human },
    { id: "hair", btn: "btn-hair", get: () => loco.hair, pre: human },
    { id: "hairColor", btn: "btn-hair-col", get: () => loco.hairColor, pre: hatReadyHuman },
    { id: "hat", btn: "btn-crown", get: () => loco.hat, pre: hatReadyHuman },
    { id: "hatColor", btn: "btn-hat-col", get: () => loco.hatColor, pre: () => { hatReadyHuman(); act.setHat("ballcap"); } },
    { id: "shirt", btn: "btn-shirt", get: () => loco.shirt, pre: human },
    { id: "pants", btn: "btn-pants", get: () => loco.pants, pre: human },
    { id: "back", btn: "btn-back", get: () => loco.back, pre: () => {} },
    { id: "ears", btn: "btn-ears", get: () => ctx.read.ears(), pre: () => {} },
    { id: "tail", btn: "btn-tail", get: () => ctx.read.tail(), pre: () => {} },
    { id: "prop", btn: "btn-hand", get: () => loco.prop, pre: () => {} },
    { id: "preset", btn: "btn-preset", get: () => ctx.read.preset(), pre: () => {} },
    { id: "edition", btn: "btn-edition", get: () => loco.edition, pre: () => {} },
    { id: "speed", btn: "btn-speed", get: () => String(ctx.read.speed()), pre: () => {} },
  ];

  const out = { laps: {}, menuOptions: {}, mismatches: [], pairs: 0, errors: [] };
  const record = (key, route, d) => { out.pairs++; if (d.length) out.mismatches.push({ key, route, diff: d }); };

  for (const cy of cycles) {
    const key = cy.tag ? `${cy.id}[${cy.tag}]` : cy.id;
    try {
      reset(); cy.pre(); m.sync();
      out.menuOptions[key] = [...sel(cy.id).options].filter((o) => !o.disabled).map((o) => o.value);
      const seq = [String(cy.get())];
      let closed = false;
      for (let i = 0; i < 40 && !closed; i++) {
        $(cy.btn).click();
        const v = String(cy.get());
        if (v === seq[0]) closed = true; else seq.push(v);
      }
      out.laps[key] = { seq, closed };
      for (let i = 0; i < seq.length; i++) {
        const P = seq[i]; const X = seq[(i + 1) % seq.length];
        reset(); cy.pre(); choose(cy.id, P); $(cy.btn).click(); const a = fingerprint();
        reset(); cy.pre(); choose(cy.id, P); choose(cy.id, X); const b = fingerprint();
        record(`${key}: ${P} -> ${X}`, "select", diff(a, b));
      }
    } catch (e) { out.errors.push(`${key}: ${e.message}`); }
  }

  const single = (key, dockRoute, menuRoute) => {
    try {
      reset(); dockRoute(); const a = fingerprint();
      reset(); menuRoute(); const b = fingerprint();
      record(key, "single", diff(a, b));
    } catch (e) { out.errors.push(`${key}: ${e.message}`); }
  };
  for (const v of ["none", "car", "truck", "scooter", "moto"]) {
    single(`vehicle -> ${v}`, () => $(`btn-veh-${v}`).click(), () => choose("vehicle", v));
  }
  single("vehicle car -> truck", () => { act.setVehicle("car"); $("btn-veh-truck").click(); }, () => { choose("vehicle", "car"); choose("vehicle", "truck"); });
  const clips = [...document.querySelectorAll("#row-clips button[data-clip]")].map((b) => b.dataset.clip);
  out.laps.clip = { seq: clips, closed: true };
  m.sync(); out.menuOptions.clip = [...sel("clip").options].filter((o) => !o.disabled).map((o) => o.value);
  for (const c of clips) {
    single(`clip -> ${c}`, () => document.querySelector(`#row-clips button[data-clip="${c}"]`).click(), () => choose("clip", c));
  }
  out.laps.vehicle = { seq: ["none", "car", "truck", "scooter", "moto"], closed: true };
  out.menuOptions.vehicle = [...sel("vehicle").options].map((o) => o.value);
  for (const [id, btn] of [["covers", "btn-veh-covers"], ["racerKit", "btn-racer-kit"], ["ref", "btn-Skeleton"], ["explode", "btn-explode"], ["pile", "btn-pile"]]) {
    single(`toggle ${id}`, () => $(btn).click(), () => flip(id));
  }
  single("pull range 40", () => { $("rng-explode").value = "40"; $("rng-explode").dispatchEvent(new Event("input", { bubbles: true })); },
    () => { const i = m.fields.get("pull").input; i.value = "40"; i.dispatchEvent(new Event("input", { bubbles: true })); });
  single("pile -> build", () => $("btn-build").click(), () => $("km-build").click());
  single("open llm modal", () => $("btn-open-llm").click(), () => $("km-llm").click());
  single("open photo modal", () => $("btn-open-photo").click(), () => $("km-photo").click());
  out.fileAccept = [$("file-input").getAttribute("accept"), $("km-file").getAttribute("accept")];
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
  await tab.waitFor("!!window.kipMenu || !location.search.includes('menu=side')", 5000);
  return { tab, ready };
}

const server = await startServer();
const chrome = await launchChrome({ width: 1440, height: 900 });
try {
  console.log(`serving ${server.base} (viewer sources overlaid on public/)`);

  // ---- 1. flag off: old dock untouched ---------------------------------------------------
  console.log("\n[1] default (no ?menu=side)");
  {
    const { tab, ready } = await loadPage(chrome, `${server.base}/kip/Kip-Demo.html`);
    check("demo initialises", ready, tab.exceptions[0]);
    check("no panel, dock still shown", await tab.evaluate(`!document.getElementById('kip-menu') && getComputedStyle(document.querySelector('.dock')).display !== 'none' && !document.body.classList.contains('menu-side')`));
    check("no page exceptions", tab.exceptions.length === 0, tab.exceptions[0]);
    tab.close();
  }

  // ---- 2. main page ----------------------------------------------------------------------
  console.log("\n[2] ?menu=side at 1440x900");
  const { tab, ready } = await loadPage(chrome, `${server.base}/kip/Kip-Demo.html?menu=side`);
  check("demo initialises with the panel mounted", ready && (await tab.evaluate("!!window.kipMenu")), tab.exceptions[0]);
  if (server.missing.size) console.log(`  note: ${server.missing.size} STL(s) missing on disk, stubbed: ${[...server.missing].map((p) => path.basename(p)).join(", ")}`);
  check("dock hidden, panel visible and 288 px wide", await tab.evaluate(`(() => { const r = document.getElementById('kip-menu').getBoundingClientRect(); return getComputedStyle(document.querySelector('.dock')).display === 'none' && Math.round(r.width) === 288 && r.height > 300; })()`));
  check("panel is live (not busy/inert)", await tab.evaluate(`document.getElementById('kip-menu').getAttribute('aria-busy') === 'false' && !document.getElementById('km-body').hasAttribute('inert')`));
  check("selects match state at load", (await tab.evaluate(INVARIANT)).length === 0, JSON.stringify(await tab.evaluate(INVARIANT)));

  const parity = await tab.evaluate(`(${parityInPage.toString()})()`);
  console.log(`\n[3] parity: ${parity.pairs} dock-step vs menu-step comparisons`);
  check("no handler errors during parity run", parity.errors.length === 0, parity.errors.join("; "));
  check("dock and menu agree on every step (state, status, labels)", parity.mismatches.length === 0,
    parity.mismatches.slice(0, 6).map((x) => `${x.key} [${x.route}] ${x.diff.slice(0, 3).join(" | ")}`).join("\n        "));
  const rows = [];
  for (const [key, lap] of Object.entries(parity.laps)) {
    const menu = parity.menuOptions[key] ?? [];
    const dockSet = new Set(lap.seq); const menuSet = new Set(menu);
    const missing = [...dockSet].filter((v) => !menuSet.has(v));
    const extra = [...menuSet].filter((v) => !dockSet.has(v));
    check(`${key}: dock cycle closes`, lap.closed, lap.seq.join(","));
    check(`${key}: every dock option reachable from the menu (${dockSet.size})`, missing.length === 0, `missing ${missing.join(",")}`);
    check(`${key}: menu offers nothing the dock cannot`, extra.length === 0, `extra ${extra.join(",")}`);
    rows.push([key, dockSet.size, menuSet.size]);
  }
  check("file loader accepts the same types as the dock", parity.fileAccept[0] === parity.fileAccept[1], parity.fileAccept.join(" vs "));
  check("selects match state after the parity run", (await tab.evaluate(INVARIANT)).length === 0);

  // Parity table for the PR: every dock element and the menu control that replaced it.
  console.log("\n  dock element -> menu control (options)");
  const counts = Object.fromEntries(rows.map(([k, , n]) => [k.replace(/\[.*/, ""), n]));
  for (const [dock, ctl] of Object.entries(DOCK_PARITY)) console.log(`    ${dock.padEnd(16)} -> ${ctl.padEnd(11)} ${counts[ctl] ?? ""}`);
  const everyControl = await tab.evaluate(`[...window.kipMenu.controls.keys()]`);
  check("DOCK_PARITY only names real menu controls", Object.values(DOCK_PARITY).every((c) => everyControl.includes(c)));
  check("every dock element in the page is covered by DOCK_PARITY", await tab.evaluate(`(${JSON.stringify(Object.keys(DOCK_PARITY))}).length > 0 && [...document.querySelectorAll('.dock [id]')].every(e => (${JSON.stringify(Object.keys(DOCK_PARITY))}).includes(e.id))`));

  // ---- 4. two-way sync -------------------------------------------------------------------
  console.log("\n[4] two-way sync");
  await tab.evaluate(`window.kipMenu.ctx.act.applyPreset('clean')`);
  await tab.evaluate(`document.getElementById('btn-preset').click()`); // clean -> boy (Leo Explorer)
  check("dock preset click shows in the menu (preset, hair, hat)", await tab.waitFor(`${val("preset")} === 'boy' && ${val("hair")} === 'short_swept' && ${val("hat")} === 'ranger'`, 15000));
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

  // ---- 5. shortcuts ----------------------------------------------------------------------
  console.log("\n[5] keyboard shortcuts");
  await tab.evaluate(`window.kipMenu.ctx.act.applyPreset('clean'); document.getElementById('km-speed').focus();`);
  await tab.key("e"); await tab.key("h"); await tab.key("b");
  const whileFocused = await tab.evaluate(`({ explode: window.kipMenu.ctx.loco.explodeTarget, clean: document.body.classList.contains('clean-ui'), mode: window.kipMenu.ctx.loco.buildMode, focus: document.activeElement.id })`);
  check("E, H, B ignored while a select is focused", whileFocused.explode === 0 && !whileFocused.clean && whileFocused.mode === 'assembled' && whileFocused.focus === 'km-speed', JSON.stringify(whileFocused));
  await tab.evaluate(`document.activeElement.blur()`);
  await tab.key("e");
  check("E toggles explode once focus is back on the scene", await tab.evaluate(`window.kipMenu.ctx.loco.explodeTarget === 1`));
  await tab.key("e");
  await tab.key("h");
  check("H hides the panel and releases the camera offset", await tab.waitFor(`document.body.classList.contains('clean-ui') && getComputedStyle(document.getElementById('kip-menu')).display === 'none' && !(window.kipMenu.ctx.camera.view && window.kipMenu.ctx.camera.view.enabled)`, 15000));
  await tab.key("h");
  check("H brings it back and re-centres Kip", await tab.waitFor(`!document.body.classList.contains('clean-ui') && window.kipMenu.ctx.camera.view && window.kipMenu.ctx.camera.view.enabled && Math.round(window.kipMenu.ctx.camera.view.offsetX) === -151`, 15000));
  await tab.evaluate(`document.getElementById('km-hair').focus && 0`);
  check("selects keep keyboard focus after a keyboard change", await tab.evaluate(`(() => { const s = document.getElementById('km-edition'); s.focus(); s.value = 'snap'; s.dispatchEvent(new Event('change', { bubbles: true })); const kept = document.activeElement === s; s.value = 'pro'; s.dispatchEvent(new Event('change', { bubbles: true })); return kept; })()`));

  // ---- 6. layout -------------------------------------------------------------------------
  console.log("\n[6] layout and screenshots");
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

  // ---- 7. load paths ---------------------------------------------------------------------
  console.log("\n[7] URL params, #toy= and SDK loads leave every select on the active value");
  {
    // hair must be hat-ready: choosing a hat on sculpted-top hair swaps it to short_swept (app behaviour, see setCrownMode)
    const q = "?menu=side&preset=boy&hair=bob&hat=cowboy&haircol=cobalt&vehicle=truck&insert=flat&clip=walk";
    const { tab: t, ready: r } = await loadPage(chrome, `${server.base}/kip/Kip-Demo.html${q}`);
    check("URL params: loads", r, t.exceptions[0]);
    check("URL params: hair/hat/tone/vehicle/insert selects show them", await t.waitFor(`${val("hair")} === 'bob' && ${val("hat")} === 'cowboy' && ${val("hairColor")} === 'cobalt' && ${val("vehicle")} === 'truck' && ${val("faceInsert")} === 'flat'`, 20000));
    check("URL params: preset still reads Leo Explorer id after overrides at load", await t.waitFor(`${val("preset")} === 'boy'`, 10000));
    check("URL params: every select equals its state", (await t.evaluate(INVARIANT)).length === 0, JSON.stringify(await t.evaluate(INVARIANT)));
    t.close();
  }
  {
    const hash = toyHash({ format: "toyventor.toy/1", name: "Menu Test", col: { c1: "#ff6b4a", c2: "#2e6fdb" }, parts: ["veh_car_x", "pack_jetpack", "tool_wrench", "eyes_pair"], stats: { speed: 1, spin: 0 }, prints: true });
    const { tab: t, ready: r } = await loadPage(chrome, `${server.base}/kip/Kip-Demo.html?menu=side${hash}`);
    check("#toy=: loads", r, t.exceptions[0]);
    check("#toy=: vehicle, back, prop, hat, ears selects show the contract", await t.waitFor(`${val("vehicle")} === 'car' && ${val("back")} === 'jetpack' && ${val("prop")} === 'wrench' && ${val("hat")} === 'ears' && ${val("ears")} === 'comm'`, 20000));
    check("#toy=: every select equals its state", (await t.evaluate(INVARIANT)).length === 0);
    t.close();
  }
  {
    const { tab: t, ready: r } = await loadPage(chrome, `${server.base}/kip/Kip-Demo.html?menu=side&sdk=hat`);
    check("SDK hat: loads", r, t.exceptions[0]);
    check("SDK hat: Hat select shows 'Wizard hat (SDK)' (not the first option)", await t.waitFor(`(() => { const s = window.kipMenu.fields.get('hat').select; return s.value === 'wizardHat' && s.selectedOptions[0].textContent === 'Wizard hat (SDK)'; })()`, 20000));
    check("SDK hat: every select equals its state", (await t.evaluate(INVARIANT)).length === 0);
    t.close();
  }
  {
    const { tab: t, ready: r } = await loadPage(chrome, `${server.base}/kip/Kip-Demo.html?menu=side&clean=1`);
    check("?clean=1: loads with the whole UI hidden", r && await t.evaluate(`getComputedStyle(document.getElementById('kip-menu')).display === 'none' && getComputedStyle(document.querySelector('.dock')).display === 'none' && !(window.kipMenu.ctx.camera.view && window.kipMenu.ctx.camera.view.enabled)`), t.exceptions[0]);
    t.close();
  }
  console.log(`\nscreenshots: ${SHOTS}`);
} finally {
  chrome.close();
  server.close();
  finish();
}
