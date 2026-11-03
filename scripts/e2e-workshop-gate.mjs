#!/usr/bin/env node
// The grown-up question in front of the Workshop's exports (docs/specs/workshop-print-gate-spec.md, phase 2): headless Chrome, the REAL shell, bench, print view,
// gate core and dialog. Only the app's parent-gate API (/api/parent/gate) is a stub, so a right and a wrong answer, a lapsed proof and an unreachable gate can be told apart.
// A spy on <a download>.click() records what would have been delivered, so "nothing leaves" is something that can be seen.
//
// What it proves, with the shell mounted `downloads: 'gated'`:
//   - the Print group is there, and so are the exits that are not behind the print view (the photo "Print it", which has its own grown-up check before anything is made,
//     and the selfie sticker, which asks through the shell's gate); "Open on its own page" (no gate on the standalone page) stays hidden;
//   - asking for a file opens the dialog, and nothing is delivered while it is open;
//   - a wrong answer keeps the dialog open and delivers nothing; the right one delivers the file, exactly once;
//   - while the proof lives the next export asks nothing; once it has lapsed the question comes back;
//   - Cancel (and Escape) delivers nothing and says so; a second click while the question is open does not deliver twice;
//   - the selfie sticker asks the same question before it saves a picture of a face, shares the proof (one answer covers it and the next export), and Cancel saves nothing;
//   - closing the shell while a question is open removes the dialog and delivers nothing;
//   - an unreachable gate fails closed (nothing delivered, no dialog left behind);
//   - control: mounted `downloads: true` the same export is delivered at once with no question (the standalone behaviour is unchanged).
// Run: E2E_GPU=metal node scripts/e2e-workshop-gate.mjs   (E2E_VIEWER=<dir> serves a copy of the viewer files instead of parts/kip/viewer)
import { createChecks, launchChrome, startServer } from "./lib/kip-e2e.mjs";
import { menu } from "./lib/menu-drive.mjs";

const { check, finish } = createChecks("workshop gate e2e");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PROOF_MS = 120000; // a proof that outlives the whole run: a lapse is made on purpose (`lapse`), not waited for, so the test does not depend on how long an export takes
let gateReachable = true;

const server = await startServer();
server.mock("POST", "/api/parent/gate", ({ json }) => {
  if (!gateReachable) return { status: 503, json: { error: "down" } };
  if (json?.action === "challenge") return { json: { mode: "math", a: 12, b: 7, challengeToken: "tok" } };
  if (Number(json?.answer) === 84) return { json: { ok: true, proofToken: "proof", expiresAt: Date.now() + PROOF_MS } };
  return { status: 403, json: { error: "wrong", attemptsRemaining: 3 } };
});
const gateCalls = () => server.apiCalls.filter((c) => c.path === "/api/parent/gate");
const chrome = await launchChrome();

/** A fresh page with the shell mounted in the given mode; resolves when the Kip bench is ready. */
async function shell(mode) {
  const t = await chrome.open(`${server.base}/kip/kip-manifest.json`, { width: 900, height: 700 });
  await t.evaluate(`(() => {
    document.body.innerHTML = '<div id="ws" style="position:fixed;inset:0"></div>';
    window.__dl = [];
    const real = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__dl.push(this.download); return; } return real.call(this); };
    return true;
  })()`);
  await t.evaluate(`import('/kip/workshop.js?v=10.0').then((m) => { window.w = m.mountWorkshop(document.getElementById('ws'), { urlSync: false, downloads: ${JSON.stringify(mode)} }); return true; })`);
  check(`${mode}: the Kip bench loads`, await t.waitFor(`window.w?.handles('kip')?.__KIP_READY__ === true`, 240000));
  return t;
}
const dl = (t) => t.evaluate(`window.__dl.length`);
const dialog = (t) => t.evaluate(`(() => { const d = document.querySelector('.bgate'); return d ? { q: d.querySelector('.bgate-q')?.textContent, err: d.querySelector('.bgate-err')?.hidden === false ? d.querySelector('.bgate-err').textContent : '', modal: d.querySelector('[role=dialog]')?.getAttribute('aria-modal') } : null; })()`);
const answer = (t, v) => t.evaluate(`(() => { const i = document.querySelector('.bgate-input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(String(v))}); i.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('.bgate-go').click(); return true; })()`);
const view = "window.w.sharedPrint().view";
/** The proof lapses (as it does after the server's 2 or 5 minutes): the shell's one cloud client forgets it. */
const lapse = (t) => t.evaluate(`(window.w.sharedCloud().clearProof(), window.w.sharedGate().hasProof() === false)`);
const exportErr = (t) => t.evaluate(`${view}.summary().exportError`);

try {
  // ============ gated ============
  console.log("gated");
  {
    const t = await shell("gated");
    const exits = await t.evaluate(`({ plateView: !!document.getElementById('km-plateView'), photo: document.getElementById('btn-print-photo')?.hidden ?? 'missing', sticker: document.getElementById('sf-sticker')?.hidden ?? 'missing',
      pop: document.querySelector('.ws-pop')?.hidden, gate: !!window.w.sharedGate() })`);
    check("gated: the Print group is in the menu", exits.plateView === true, JSON.stringify(exits));
    check("gated: the photo \"Print it\" and the selfie sticker are offered (each is gated), and \"Open on its own page\" stays hidden", exits.photo === false && exits.sticker === false && exits.pop === true, JSON.stringify(exits));
    check("gated: the shell has a download gate", exits.gate === true);

    await t.evaluate(menu.toggle("plateView", true));
    check("gated: the plate view opens and finishes planning", await t.waitFor(`${view}.isOn() === true && !${view}.isBusy() && ${view}.summary().parts > 0`, 240000));
    check("gated: before any export, no question was asked of the gate", gateCalls().length === 0);

    // asking for a file -> the dialog; nothing delivered
    void t.evaluate(`${view}.download('3mf'); 0`);
    check("gated: asking for a plate file opens the grown-up dialog with a question", await t.waitFor(`!!document.querySelector('.bgate-q')`, 20000));
    let d = await dialog(t);
    check("gated: it is a modal dialog asking \"What is 12 × 7?\"", d?.modal === "true" && /12 × 7/.test(d?.q ?? ""), JSON.stringify(d));
    check("gated: nothing has been delivered while the question is open", (await dl(t)) === 0 && (await t.evaluate(`${view}.gatePending()`)) === true);

    // wrong answer
    await answer(t, 5);
    check("gated: a wrong answer keeps the dialog open with a calm message and delivers nothing", await t.waitFor(`document.querySelector('.bgate-err')?.hidden === false`, 15000)
      && /not it/i.test((await dialog(t))?.err ?? "") && (await dl(t)) === 0);

    // right answer
    await answer(t, 84);
    check("gated: the right answer closes the dialog and delivers the file, exactly once", await t.waitFor(`window.__dl.length >= 1 && !document.querySelector('.bgate')`, 60000));
    await sleep(600);
    const first = await t.evaluate(`window.__dl.slice()`);
    check("gated: exactly one file, and it is a plate file", first.length === 1 && /\.3mf$/.test(first[0]), JSON.stringify(first));
    check("gated: the print view is no longer waiting and shows no error", (await t.evaluate(`${view}.gatePending()`)) === false && (await exportErr(t)) === null);

    // live proof: no question
    const callsBefore = gateCalls().length;
    await t.evaluate(`${view}.download('3mf'); 0`);
    check("gated: while the proof lives the next export asks nothing and is delivered", await t.waitFor(`window.__dl.length >= 2`, 60000) && !(await dialog(t)) && gateCalls().length === callsBefore);

    // lapsed proof: the question comes back; double click -> one dialog, one delivery
    check("gated: (the proof is made to lapse)", await lapse(t));
    void t.evaluate(`${view}.download('3mf'); ${view}.download('3mf'); 0`);
    check("gated: once the proof has lapsed the question comes back", await t.waitFor(`!!document.querySelector('.bgate-q')`, 20000));
    check("gated: a second click while the question is open does not open a second dialog", (await t.evaluate(`document.querySelectorAll('.bgate').length`)) === 1);
    await answer(t, 84);
    await t.waitFor(`window.__dl.length >= 3`, 60000);
    await sleep(1200);
    check("gated: answering once delivers once (not once per click)", (await dl(t)) === 3, String(await dl(t)));

    // cancel
    check("gated: (the proof is made to lapse again)", await lapse(t));
    const beforeCancel = await dl(t);
    void t.evaluate(`${view}.download('3mf'); 0`);
    check("gated: (lapsed again) the question comes back", await t.waitFor(`!!document.querySelector('.bgate-q')`, 20000));
    await t.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await t.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    check("gated: Escape closes the dialog, delivers nothing, and the view says a grown-up did not approve", await t.waitFor(`!document.querySelector('.bgate')`, 10000)
      && (await dl(t)) === beforeCancel && /did not approve/.test((await exportErr(t)) ?? ""), String(await exportErr(t)));

    // the selfie sticker: a picture of a face, behind the same question and the same proof
    await t.evaluate(`window.w.sharedCloud().clearProof(); 0`);
    const faceLoaded = await t.evaluate(`(async () => { const s = window.w.handles('kip').kipSelfie; s.open(); for (const id of s.samples()) { if (await s.promptFace(id)) return true; } return false; })()`);
    check("selfie: a sample face loads into the panel", faceLoaded === true && (await t.evaluate(`window.w.handles('kip').kipSelfie.state.step`)) === "adjust");
    const stickerBefore = await dl(t);
    void t.evaluate(`document.getElementById('sf-sticker').click(); 0`);
    check("selfie: \"Save as sticker\" opens the grown-up question and saves nothing yet", await t.waitFor(`!!document.querySelector('.bgate-q')`, 20000) && (await dl(t)) === stickerBefore);
    await t.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await t.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    check("selfie: Cancel saves nothing and the panel says a grown-up has to say yes", await t.waitFor(`!document.querySelector('.bgate')`, 10000) && (await dl(t)) === stickerBefore
      && /grown-up has to say yes/.test(await t.evaluate(`document.getElementById('sf-error').textContent`)));
    void t.evaluate(`document.getElementById('sf-sticker').click(); 0`);
    await t.waitFor(`!!document.querySelector('.bgate-q')`, 20000);
    await answer(t, 84);
    check("selfie: the right answer saves the sticker (a PNG and an SVG) and clears the message", await t.waitFor(`window.__dl.length >= ${stickerBefore + 2}`, 60000)
      && (await t.evaluate(`window.__dl.slice(${stickerBefore}).sort().join()`)) === "kip-face-sticker.png,kip-face-sticker.svg" && (await t.evaluate(`document.getElementById('sf-error').hidden`)) === true);
    const stickerCalls = gateCalls().length;
    await t.evaluate(`document.getElementById('sf-sticker').click(); 0`);
    check("selfie: the proof is shared: the next sticker (and the next plate export) ask nothing", await t.waitFor(`window.__dl.length >= ${stickerBefore + 4}`, 60000) && !(await dialog(t)) && gateCalls().length === stickerCalls);
    await t.evaluate(`window.w.handles('kip').kipSelfie.close(); 0`);

    // closing the shell mid-question
    const beforeShellClose = await dl(t);
    void t.evaluate(`window.w.sharedCloud().clearProof(); ${view}.download('3mf'); 0`);
    check("gated: (again) a question is open", await t.waitFor(`!!document.querySelector('.bgate-q')`, 20000));
    await t.evaluate(`window.w.destroy(); 0`);
    await sleep(500);
    check("gated: closing the shell while a question is open removes the dialog and delivers nothing", !(await dialog(t)) && (await dl(t)) === beforeShellClose);
    check("gated: nothing threw", t.exceptions.length === 0, JSON.stringify(t.exceptions).slice(0, 300));
    t.close();
  }

  // ============ gated, gate unreachable ============
  console.log("gated, gate unreachable");
  {
    const t = await shell("gated");
    await t.evaluate(menu.toggle("plateView", true));
    await t.waitFor(`${view}.isOn() === true && !${view}.isBusy() && ${view}.summary().parts > 0`, 240000);
    gateReachable = false;
    void t.evaluate(`${view}.download('3mf'); 0`);
    check("unreachable: the export is refused, no file is delivered and no dialog is left open", await t.waitFor(`${view}.gatePending() === false && ${view}.summary().exportError !== null`, 30000)
      && (await dl(t)) === 0 && !(await dialog(t)));
    gateReachable = true;
    t.close();
  }

  // ============ control: not gated ============
  console.log("control: downloads true");
  {
    const t = await shell(true);
    await t.evaluate(menu.toggle("plateView", true));
    await t.waitFor(`${view}.isOn() === true && !${view}.isBusy() && ${view}.summary().parts > 0`, 240000);
    const calls = gateCalls().length;
    void t.evaluate(`${view}.download('3mf'); 0`);
    check("control: mounted with downloads true, the same export is delivered at once with no question", await t.waitFor(`window.__dl.length === 1`, 60000) && !(await dialog(t)) && gateCalls().length === calls
      && (await t.evaluate(`window.w.sharedGate()`)) === null);
    t.close();
  }
} finally {
  chrome.close();
  server.close();
  finish();
}
