#!/usr/bin/env node
// The grown-up question dialog (docs/specs/workshop-print-gate-spec.md, phase 2) in real headless Chrome. It wires the REAL core (bench-gate.js) to the REAL dialog
// (bench-gate-ui.js) with a scripted stand-in for the parent-gate client, and drives it with real key events. Nothing here is wired into a bench yet.
//
// What it proves: the dialog is a modal dialog covering the page; a wrong answer keeps the same dialog open and says so; a right answer closes it and the download is
// granted; Escape and Cancel cancel; a PIN is typed into a password field; a non-number is refused without asking the gate; Tab stays inside; keys typed inside never reach
// the page (a bench's WASD and Space must not fire while a grown-up types); focus returns to where it was; an unreachable gate shows no dialog; nothing throws.
// Run: node scripts/e2e-bench-gate-ui.mjs     Exits nonzero on any failing check. E2E_GPU=metal for the machine's GPU (the Yard page it borrows draws a 3D scene).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createChecks, launchChrome, startServer } from "./lib/kip-e2e.mjs";

const SHOTS = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), "bench-gate-shots");
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { check, finish } = createChecks("bench gate dialog e2e");

const server = await startServer();
const chrome = await launchChrome();
const SETUP = `(async () => {
  const { createDownloadGate } = await import('/kip/bench-gate.js');
  const { createGateModal } = await import('/kip/bench-gate-ui.js');
  const state = { proof: false, mode: 'math', status: 'ok', verifies: [] };
  window.__state = state;
  const cloud = {
    hasProof: () => state.proof,
    challenge: async () => (state.status === 'ok' ? { status: 'ok', mode: state.mode, a: 14, b: 6, challengeToken: 't', cooldownUntil: null } : { status: state.status }),
    verify: async (b) => {
      state.verifies.push(b);
      const ok = state.mode === 'pin' ? b.pin === '1234' : b.answer === 84;
      if (ok) { state.proof = true; return { status: 'ok' }; }
      return { status: 'wrong', attemptsRemaining: 5 - state.verifies.length };
    },
  };
  const ui = createGateModal({ root: document.body });
  window.__ui = ui;
  window.__gate = createDownloadGate({ cloud, ui });
  window.__keys = 0;
  window.addEventListener('keydown', () => { window.__keys++; });
  window.__opener = document.getElementById('btn-push');
  return true;
})()`;
const reset = (t, patch = {}) => t.evaluate(`Object.assign(window.__state, { proof: false, mode: 'math', status: 'ok', verifies: [] }, ${JSON.stringify(patch)}); window.__keys = 0; window.__opener.focus(); 0`);
const dlg = `.bgate [role=dialog]`;
const type = (t, text) => t.send("Input.insertText", { text });
const press = async (t, key, code, vk) => { await t.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk }); await t.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk }); await sleep(120); };
const ENTER = ["Enter", "Enter", 13], ESC = ["Escape", "Escape", 27], TAB = ["Tab", "Tab", 9];

try {
  const t = await chrome.open(`${server.base}/kip/Yard-Bench.html`, { width: 1000, height: 700 });
  check("a page to borrow the viewer's origin loads", await t.waitFor("window.__YARD_READY__ === true", 240000), "the Yard bench never got ready");
  check("the core and the dialog load as modules and are wired together", await t.evaluate(SETUP) === true);

  // ---- A. opening (from a focused control, as a click on a download button would leave it) ----
  await t.evaluate(`window.__opener.focus(); window.__p = window.__gate.ask('pack'); 0`);
  check("asking opens a modal dialog", await t.waitFor(`!!document.querySelector('${dlg}')`, 10000));
  const A = await t.evaluate(`(() => { const d = document.querySelector('${dlg}'), w = document.querySelector('.bgate'), r = w.getBoundingClientRect(), i = d.querySelector('input');
    return { modal: d.getAttribute('aria-modal'), label: document.getElementById(d.getAttribute('aria-labelledby'))?.textContent, intro: document.getElementById(d.getAttribute('aria-describedby'))?.textContent,
      q: d.querySelector('.bgate-q').textContent, full: Math.abs(r.width - innerWidth) < 1 && Math.abs(r.height - innerHeight) < 1, pos: getComputedStyle(w).position,
      focused: document.activeElement === i, type: i.type, mode: i.getAttribute('inputmode'), goDisabled: d.querySelector('.bgate-go').disabled, err: d.querySelector('.bgate-err').hidden }; })()`);
  check("it is labelled 'Grown-up check', says what is being made, and asks the sum", A.modal === "true" && A.label === "Grown-up check" && A.intro === "A grown-up needs to say yes before we make a print pack." && A.q === "What is 14 × 6?", JSON.stringify(A));
  check("it covers the page, the answer field has focus, takes numbers, and Check waits for an answer", A.full && A.pos === "fixed" && A.focused && A.type === "text" && A.mode === "numeric" && A.goDisabled && A.err, JSON.stringify(A));
  const C = await t.evaluate(`(() => { const q = (s) => document.querySelector('${dlg} ' + s), cs = (e) => getComputedStyle(e);
    return { h3: [cs(q('h3')).fontSize, cs(q('h3')).fontWeight], p: cs(q('p')).fontSize, q: cs(q('.bgate-q')).fontSize, input: cs(q('input')).fontSize, btn: cs(q('.bgate-go')).fontSize, btnH: Math.round(q('.bgate-go').getBoundingClientRect().height) }; })()`);
  check("the dialog's own text styles are really applied (an invalid CSS rule would leave browser defaults): title 18px/800, text 14px, question 17px, answer 20px, buttons 15px and 44px tall", C.h3[0] === "18px" && C.h3[1] === "800" && C.p === "14px" && C.q === "17px" && C.input === "20px" && C.btn === "15px" && C.btnH >= 44, JSON.stringify(C));
  await t.shot(path.join(SHOTS, "gate-question.png"));

  // ---- B. a wrong answer keeps the same dialog open ----
  await t.evaluate(`document.querySelector('${dlg}').dataset.mark = 'first'; 0`);
  await type(t, "12");
  check("typing an answer enables Check", await t.evaluate(`!document.querySelector('${dlg} .bgate-go').disabled`));
  await press(t, ...ENTER);
  check("Enter with a wrong answer: the gate was asked once, and the SAME dialog stays open, saying so and counting the tries", await t.waitFor(`document.querySelector('${dlg}')?.dataset.mark === 'first' && !document.querySelector('${dlg} .bgate-err').hidden`, 10000)
    && await t.evaluate(`window.__state.verifies.length === 1 && document.querySelector('${dlg} .bgate-err').textContent === 'That is not it. Try again. 4 tries left.'`));
  check("the field is cleared and focused for another go", await t.evaluate(`document.querySelector('${dlg} input').value === '' && document.activeElement === document.querySelector('${dlg} input') && !document.querySelector('${dlg} input').disabled`));
  await t.shot(path.join(SHOTS, "gate-wrong.png"));

  // ---- C. keys typed inside never reach the page ----
  await type(t, "w");
  await press(t, "w", "KeyW", 87);
  check("keys typed in the dialog do not reach the page (a bench's own WASD and Space would otherwise fire)", await t.evaluate(`window.__keys === 0`), String(await t.evaluate(`window.__keys`)));

  // ---- D. not a number: refused without asking the gate ----
  await t.evaluate(`document.querySelector('${dlg} input').value = ''; 0`);
  await type(t, "abc");
  await press(t, ...ENTER);
  check("a non-number is refused with 'Type a number.' and the gate is not asked", await t.evaluate(`document.querySelector('${dlg} .bgate-err').textContent === 'Type a number.' && window.__state.verifies.length === 1`));

  // ---- E. the right answer ----
  await t.evaluate(`document.querySelector('${dlg} input').value = ''; 0`);
  await type(t, "84");
  await t.evaluate(`document.querySelector('${dlg} .bgate-go').click(); 0`);
  const granted = await t.evaluate(`window.__p.then((r) => JSON.stringify(r))`);
  check("the right answer grants the download", granted === '{"ok":true}', granted);
  check("the dialog is gone and focus is back on the control that opened it", await t.waitFor(`!document.querySelector('.bgate') && document.activeElement === window.__opener`, 10000));
  check("a second download inside the proof is not quizzed", await t.evaluate(`window.__gate.ask('3mf').then((r) => r.ok === true && !document.querySelector('.bgate'))`));

  // ---- F. Escape and Cancel ----
  await reset(t);
  await t.evaluate(`window.__p = window.__gate.ask('pack'); 0`);
  await t.waitFor(`!!document.querySelector('${dlg}')`, 10000);
  await press(t, ...ESC);
  check("Escape cancels: the download is not granted, nobody was asked, the dialog is gone", await t.evaluate(`window.__p.then((r) => r.ok === false && r.reason === 'cancelled' && window.__state.verifies.length === 0 && !document.querySelector('.bgate'))`));
  await reset(t);
  await t.evaluate(`window.__p = window.__gate.ask('pack'); 0`);
  await t.waitFor(`!!document.querySelector('${dlg}')`, 10000);
  await t.evaluate(`document.querySelector('${dlg} .bgate-btn:not(.bgate-go)').click(); 0`);
  check("Cancel cancels", await t.evaluate(`window.__p.then((r) => r.ok === false && r.reason === 'cancelled' && !document.querySelector('.bgate'))`));

  // ---- G. the PIN ----
  await reset(t, { mode: "pin" });
  await t.evaluate(`window.__p = window.__gate.ask('stickers-pdf'); 0`);
  await t.waitFor(`!!document.querySelector('${dlg}')`, 10000);
  const G = await t.evaluate(`({ type: document.querySelector('${dlg} input').type, q: document.querySelector('${dlg} .bgate-q').textContent, intro: document.querySelector('${dlg} p').textContent })`);
  check("a PIN is asked for in a password field, with no sum, and names the sticker sheet", G.type === "password" && G.q === "Type the grown-up PIN." && /a sticker sheet/.test(G.intro), JSON.stringify(G));
  await type(t, "1234");
  await press(t, ...ENTER);
  check("the right PIN grants it, and the client got a PIN, not an answer", await t.evaluate(`window.__p.then((r) => r.ok === true && window.__state.verifies[0].pin === '1234' && window.__state.verifies[0].answer === undefined)`));

  // ---- H. Tab stays inside ----
  await reset(t);
  await t.evaluate(`window.__p = window.__gate.ask('pack'); 0`);
  await t.waitFor(`!!document.querySelector('${dlg}')`, 10000);
  const inside = () => t.evaluate(`!!document.activeElement?.closest('.bgate')`);
  let stayed = true;
  for (let i = 0; i < 4; i++) { await press(t, ...TAB); stayed = stayed && await inside(); }
  check("Tab four times: focus never leaves the dialog", stayed);

  // ---- I. cancelled from outside (the shell is being destroyed) ----
  await t.evaluate(`window.__gate.cancel(); 0`);
  check("cancel() from outside closes an open question as Cancel", await t.evaluate(`window.__p.then((r) => r.ok === false && r.reason === 'cancelled' && !document.querySelector('.bgate') && !window.__gate.isPending())`));

  // ---- J. an unreachable gate ----
  await reset(t, { status: "offline" });
  const down = await t.evaluate(`window.__gate.ask('pack').then((r) => JSON.stringify({ r, dialog: !!document.querySelector('.bgate') }))`);
  check("an unreachable gate shows no dialog and denies (fail closed)", JSON.parse(down).r.ok === false && JSON.parse(down).r.reason === "unavailable" && JSON.parse(down).dialog === false, down);

  // ---- K. the phone ----
  const p = await chrome.open(`${server.base}/kip/Yard-Bench.html`, { width: 390, height: 844, mobile: true });
  await p.waitFor("window.__YARD_READY__ === true", 240000);
  await p.evaluate(SETUP);
  await p.evaluate(`window.__p = window.__gate.ask('project-3mf'); 0`);
  await p.waitFor(`!!document.querySelector('${dlg}')`, 10000);
  const M = await p.evaluate(`(() => { const c = document.querySelector('${dlg}').getBoundingClientRect(); return { w: Math.round(c.width), fits: c.left >= 0 && c.right <= innerWidth, scrollX: document.documentElement.scrollWidth > innerWidth, tap: Math.min(...[...document.querySelectorAll('${dlg} button')].map((b) => b.getBoundingClientRect().height)) }; })()`);
  check("on a phone the card fits the screen, the page does not scroll sideways, and every button is 44 px or taller", M.fits && !M.scrollX && M.tap >= 44, JSON.stringify(M));
  await p.shot(path.join(SHOTS, "gate-phone.png"));
  check("no uncaught exception on either page", t.exceptions.length === 0 && p.exceptions.length === 0, [...t.exceptions, ...p.exceptions].slice(0, 2).join(" | "));
  p.close();
  t.close();
} catch (err) {
  check("e2e ran to the end", false, String(err?.stack ?? err));
} finally {
  chrome.close();
  server.close();
  console.log(`screenshots: ${SHOTS}`);
  finish();
}
