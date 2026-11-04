#!/usr/bin/env node
// What Kip picked up with the camera, on the GAME's Kip (src/features/game/world/runtime/pickupHeld.ts; scope C of docs/product/close-out-checklist.md row 3): headless Chrome on the
// machine's GPU, the real game on a phone-sized window, served by its own `vite dev` on a port of its own. The bench's event "tv:kip-picked-up" is dispatched from the page with a real PNG
// cut-out drawn in the page (a spoon with a red R on it, so a mirrored card would show); the bench itself is checked by scripts/e2e-kip-pickup.mjs.
//
// What it proves: the cut-out shows as a card in Kip's right hand, upright and facing the camera whichever way Kip faces (the R reads the right way round) and while he walks; the game's own
// guitar is held for a guitar; an act takes Kip's hands and gives them back; a world switch and a rebuilt rig keep it; put it away by the chip or by tapping Kip (and a tap elsewhere does not),
// leaving no mesh, texture or geometry behind; an event that arrives while the Workshop overlay is open (the world paused) is on Kip when it closes; a pick-up without a cut-out is a plain
// sticker; bad events do nothing and nothing throws.
// Run: E2E_GPU=metal node scripts/e2e-game-pickup.mjs     Overrides: E2E_PORT (default 5461), E2E_NO_SERVER=1 (use a server already on that port), E2E_SHOTS.
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { createChecks, launchChrome } from "./lib/kip-e2e.mjs";

process.env.E2E_GPU ??= "metal";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PORT = Number(process.env.E2E_PORT ?? 5461);
const BASE = `http://localhost:${PORT}`;
const SHOTS = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), "game-pickup-shots");
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { check, finish } = createChecks("game pick-up e2e");

const dev = process.env.E2E_NO_SERVER === "1" ? null : spawn("node", [path.join(ROOT, "node_modules/vite/bin/vite.js"), "--port", String(PORT), "--strictPort"], { cwd: ROOT, stdio: "ignore" });
let chrome;
let t;
try {
  for (let i = 0; i < 240; i++) {
    try { if ((await fetch(`${BASE}/`)).ok) break; } catch { /* not up yet */ }
    await sleep(500);
  }
  chrome = await launchChrome();
  t = await chrome.open("about:blank", { width: 390, height: 844, mobile: true });
  await t.send("Network.enable");
  await t.send("Page.navigate", { url: `${BASE}/?title=0` });
  const ev = (expr) => t.evaluate(expr);
  const shot = (name) => t.shot(path.join(SHOTS, name));
  const hold = async (key, code, vk, ms) => {
    await t.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk, text: key });
    await sleep(ms);
    await t.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk });
  };

  check("the game loads, with the pick-up holder on its dev handle and a character rig with two arms", await t.waitFor(`!!document.querySelector('.tv-dock-right') && !!window.__tvWorld && !!window.__tvWorld.pick && !!window.__tvWorld.P.rig && window.__tvWorld.P.rig.arms && window.__tvWorld.P.rig.arms.length === 2`, 180000), "no game");
  await ev(`(() => {
    const W = window.__tvWorld, D = window.__tvDebug;
    const c = document.createElement('canvas'); c.width = 120; c.height = 300;
    const x = c.getContext('2d');
    x.fillStyle = '#b9c2cf'; x.beginPath(); x.ellipse(60, 72, 54, 68, 0, 0, Math.PI * 2); x.fill();   // the bowl
    x.fillRect(51, 130, 18, 168);                                                                      // the handle
    x.fillStyle = '#c0392b'; x.font = 'bold 70px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('R', 60, 74);   // asymmetric: a mirror shows
    window.__cut = { dataUrl: c.toDataURL('image/png'), w: 120, h: 300 };
    const send = (detail) => window.dispatchEvent(new CustomEvent('tv:kip-picked-up', { detail }));
    window.__pk = {
      send,
      spoon: (extra = {}) => send({ word: 'spoon', kind: 'library', id: 'wooden_spoon', label: 'Wooden spoon', coloured: true, colours: ['silver'], cutout: window.__cut, named: false, ...extra }),
      guitar: () => send({ word: 'guitar', kind: 'workshop', id: 'guitar', label: 'guitar', coloured: false, colours: ['brown'], cutout: window.__cut, named: false }),
      trumpet: () => send({ word: 'trumpet', kind: 'workshop', id: 'trumpet', label: 'trumpet', coloured: false, colours: [], cutout: window.__cut, named: true }),
      arm: () => W.P.rig.arms[1],
      names: () => { const out = []; D.scene.traverse((o) => { if (/^pickup-/.test(o.name)) out.push(o.name); }); return out; },
      mem: () => { const m = D.renderer.info.memory; return { tex: m.textures, geo: m.geometries }; },
      uprightW: () => { const g = W.pick.cardGroup; if (!g) return null; return Math.abs(g.getWorldQuaternion(g.quaternion.clone()).w); }, // 1 = upright and facing the camera
      kipOnScreen: () => { const v = W.P.root.position.clone(); v.y += 1.1; v.project(D.camera); const r = document.querySelector('.tv-host canvas').getBoundingClientRect(); return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height }; },
      state: () => W.pick.state,
    };
  })()`);
  const state = () => ev("window.__pk.state()");
  const onKip = () => ev("window.__pk.state().onKip");
  const mem = () => ev("window.__pk.mem()");
  await sleep(1500); // let the world draw a few frames
  check("control: nothing is held and no pick-up object is in the scene", (await onKip()) === false && (await ev("window.__pk.names().length")) === 0);

  // ---- a household item: the cut-out as a card ----
  await ev("window.__pk.spoon()");
  check("the spoon event puts a card on Kip (the cut-out loads, then it is on the arm)", await t.waitFor("window.__pk.state().onKip", 15000), JSON.stringify(await state()));
  const s1 = await state();
  check("it is a card (no game mesh for a household item), named for what it is", s1.wanted?.card === true && s1.wanted.item === null && s1.wanted.kind === "library" && s1.wanted.label === "Wooden spoon", JSON.stringify(s1));
  check("the card is on the right arm and holds exactly one plane", await ev("(() => { const g = window.__tvWorld.pick.cardGroup; return !!g && g.parent === window.__pk.arm() && g.children.length === 1 && g.children[0].name === 'pickup-card' && g.children[0].isMesh; })()"));
  check("it is upright and faces the camera (world-aligned) facing right", (await ev("window.__pk.uprightW()")) > 0.995, String(await ev("window.__pk.uprightW()")));
  check("the put-away chip shows, with the right words", (await ev("(() => { const b = document.querySelector('.tv-pickup-chip'); return !!b && !b.hidden && b.textContent.includes('Put the wooden spoon away') && b.getAttribute('aria-label') === 'Put the wooden spoon away'; })()")));
  await sleep(500);
  await shot("1-spoon-facing-right.png");

  await ev("(() => { const P = window.__tvWorld.P; P.face = P.tface = Math.PI; })()");
  await sleep(700);
  check("facing left the card is still upright and facing the camera (never mirrored)", (await ev("window.__pk.uprightW()")) > 0.995 && (await onKip()), String(await ev("window.__pk.uprightW()")));
  await shot("2-spoon-facing-left.png");
  await ev("(() => { const P = window.__tvWorld.P; P.face = P.tface = 0; })()");

  // ---- walking ----
  const x0 = await ev("window.__tvWorld.P.pos.x");
  await hold("d", "KeyD", 68, 700);
  const x1 = await ev("window.__tvWorld.P.pos.x");
  check("walking moves Kip and the card stays in his hand, still upright", x1 !== x0 && (await onKip()) && (await ev("window.__tvWorld.pick.cardGroup.parent === window.__pk.arm()")) && (await ev("window.__pk.uprightW()")) > 0.995, `${x0} -> ${x1}`);
  await shot("3-after-walking.png");

  // ---- an act takes Kip's hands, and gives them back ----
  await ev("(() => { const W = window.__tvWorld; W.held.hold('book', W.P.model, W.P.rig.arms[1], W.P.rig.arms[0]); })()");
  check("an act that holds the book takes the hands: the card steps aside (still wanted), the book is on Kip", !(await onKip()) && (await ev("window.__tvWorld.held.item === 'book'")) && (await state()).wanted?.id === "wooden_spoon" && (await ev("window.__pk.names().length")) === 0);
  await ev("window.__tvWorld.held.release()");
  check("when the act lets go the card is back in his hand", (await onKip()) && (await ev("window.__tvWorld.held.item === null")) && (await ev("window.__tvWorld.pick.cardGroup.parent === window.__pk.arm()")));

  // ---- a world switch, and a rebuilt rig ----
  await ev(`window.__tvWorld.handle.go('room')`);
  check("a world switch keeps it (the Toy Room)", await t.waitFor(`window.__tvWorld.handle.getWorld() === 'room' && window.__pk.state().onKip && window.__tvWorld.pick.cardGroup.parent === window.__pk.arm()`, 20000), JSON.stringify(await state()));
  await sleep(600);
  await shot("4-in-the-toy-room.png");
  const armBefore = await ev("window.__pk.arm().uuid");
  await ev("window.__tvWorld.handle.setToy(null)"); // the toy is rebuilt: a new rig, new arms
  check("a rebuilt rig gets the card on its new arm", await t.waitFor(`window.__pk.arm().uuid !== ${JSON.stringify(armBefore)} && window.__pk.state().onKip && window.__tvWorld.pick.cardGroup.parent === window.__pk.arm()`, 20000), JSON.stringify(await state()));
  await ev(`window.__tvWorld.handle.go('garden')`);
  await t.waitFor(`window.__tvWorld.handle.getWorld() === 'garden'`, 20000);

  // ---- the game's own guitar, and nothing left of the card ----
  await ev("window.__pk.guitar()");
  check("a guitar is the game's own guitar mesh, on the body, and the spoon card is gone", await t.waitFor("window.__pk.state().wanted && window.__pk.state().wanted.item === 'guitar' && window.__pk.state().onKip", 15000) && (await ev("window.__pk.names().length")) === 0 && (await ev("window.__tvWorld.pick.cardGroup === null")), JSON.stringify(await state()));
  await sleep(500);
  await shot("5-guitar.png");
  // ---- put it away: the chip, and the books (each step is measured against the step before it, in the same world with the same rig) ----
  const A = await mem(); // the guitar is held: the steady state
  await ev("window.__pk.spoon()");
  await t.waitFor("window.__pk.state().onKip && window.__pk.state().wanted.card === true", 15000);
  await sleep(500);
  const B = await mem();
  check("a card costs exactly one texture and one plane (the guitar's meshes were never GPU-held beyond the scene)", B.tex - A.tex === 1 && B.geo - A.geo === 1, JSON.stringify({ A, B }));
  await ev("window.__pk.trumpet()"); // no game mesh: a card replaces the card
  check("a trumpet has no twin in the game, so it is a card", await t.waitFor("window.__pk.state().onKip && window.__pk.state().wanted.card === true && window.__pk.state().wanted.id === 'trumpet'", 15000) && (await state()).wanted.item === null);
  await sleep(500);
  const C = await mem();
  check("a card that replaces a card frees the old one's texture and plane (no leak: same counts as one card)", C.tex === B.tex && C.geo === B.geo, JSON.stringify({ B, C }));
  await shot("6-trumpet-card.png");
  await ev("document.querySelector('.tv-pickup-chip').click()");
  check("pressing the chip puts it away: nothing wanted, nothing on Kip, no pick-up object, chip hidden", !(await onKip()) && (await state()).wanted === null && (await ev("window.__pk.names().length")) === 0 && (await ev("document.querySelector('.tv-pickup-chip').hidden")));
  await sleep(400);
  const D = await mem();
  check("putting the card away freed its texture and its plane (the counts are back to the guitar's)", D.tex === A.tex && D.geo === A.geo, JSON.stringify({ A, C, D }));

  // ---- put it away: a tap on Kip (and a tap elsewhere does nothing) ----
  await ev("window.__pk.spoon()");
  await t.waitFor("window.__pk.state().onKip", 15000);
  await ev("window.__tvWorld.P.target = null");
  await sleep(300);
  const far = await ev("(() => { const k = window.__pk.kipOnScreen(); return { x: k.x < innerWidth / 2 ? innerWidth - 40 : 40, y: k.y }; })()");
  await t.click(far.x, far.y);
  await sleep(250);
  check("a tap on the ground away from Kip does not put it away (he just walks)", await onKip());
  await t.waitFor("window.__tvWorld.P.target === null || window.__tvWorld.P.target === undefined", 15000);
  await sleep(600);
  const kip = await ev("window.__pk.kipOnScreen()");
  await t.click(kip.x, kip.y);
  check("a tap on Kip puts it away", await t.waitFor("window.__pk.state().wanted === null", 5000) && !(await onKip()) && (await ev("window.__pk.names().length")) === 0, JSON.stringify(await state()));

  // ---- an event while the Workshop overlay is open ----
  await ev(`[...document.querySelectorAll('.tv-dock-right button')].find((x) => x.textContent.trim() === 'Workshop').click(); 0`);
  check("the Workshop opens over the world", await t.waitFor(`!!document.querySelector('[role=dialog][aria-label=Workshop] .ws-root .kip-bench')`, 300000));
  await sleep(1500);
  await ev("window.__pk.spoon()");
  check("an event that arrives while the world is paused is held at once", await t.waitFor("window.__pk.state().onKip", 15000), JSON.stringify(await state()));
  await shot("7-overlay-open.png");
  await ev(`[...document.querySelectorAll('[role=dialog][aria-label=Workshop] button')].find((b) => /Close/.test(b.textContent)).click(); 0`);
  check("closing the Workshop returns to the world with the card in Kip's hand", await t.waitFor(`!document.querySelector('[role=dialog][aria-label=Workshop]') && window.__pk.state().onKip && window.__tvWorld.pick.cardGroup.parent === window.__pk.arm()`, 20000));
  await sleep(800);
  await shot("8-overlay-closed.png");
  check("it is still upright after the overlay", (await ev("window.__pk.uprightW()")) > 0.995);

  // ---- no cut-out: a plain sticker with the word ----
  await ev("window.__tvWorld.pick.putAway()");
  await sleep(300);
  const E = await mem();
  await ev("window.__pk.spoon({ cutout: null })");
  check("a pick-up with no cut-out is a plain sticker card, not nothing", await t.waitFor("window.__pk.state().onKip && window.__pk.state().wanted.card === true", 15000));
  await sleep(500);
  const F = await mem();
  await shot("9-sticker.png");

  // ---- bad events ----
  const before = JSON.stringify(await state());
  for (const bad of [null, "x", 7, {}, { kind: "workshop", id: "../x", label: "x" }, { kind: "bogus", id: "a", label: "x" }, { kind: "library", id: "wooden_spoon", label: "" }]) await ev(`window.__pk.send(${JSON.stringify(bad)})`);
  await sleep(300);
  check("events that are not ours change nothing", JSON.stringify(await state()) === before);
  await ev("window.__tvWorld.pick.putAway()");
  await sleep(400);
  const G = await mem();
  check("after the last put-away nothing is left in the scene and the counts are what they were before the sticker", (await ev("window.__pk.names().length")) === 0 && G.tex === E.tex && G.geo === E.geo, JSON.stringify({ E, F, G }));
  check("the page threw no exceptions", t.exceptions.length === 0, t.exceptions.join(" | ").slice(0, 400));
} finally {
  try { t?.close(); } catch { /* gone */ }
  chrome?.close();
  if (dev) dev.kill("SIGTERM");
}
finish();
console.log(`screenshots: ${SHOTS}`);
