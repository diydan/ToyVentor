#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Browser test of the shared waiting state (kip-workshop-wait.js) in headless Chrome, on tools/workshop-wait-harness.html: the STAGED mode that the photo "Print it"
// panel (and later the Forge screen) drives with real stages: what each stage shows, that the pile only moves forward and never fills before the answer, the
// real rest countdown, that nothing keeps running or comes back to life after stop(), unknown stage names, reduced motion (CSS and script), no global side
// effects. The timed mode (Describe & build) is covered by e2e_describe.mjs section [5c]. Pure DOM: no GPU, fast.
//   node parts/kip/viewer/tools/e2e_workshop_wait.mjs      Env: E2E_CHROME (binary), E2E_SHOTS (screenshot dir). Exits 1 on any failure.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChecks, launchChrome } from '../../../../scripts/lib/kip-e2e.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VIEWER = path.join(HERE, '..');
const SHOTS = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), 'kip-workshop-wait-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const { check, finish } = createChecks('workshop wait e2e');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript' };

const web = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = p.startsWith('/kip/tools/') ? path.join(VIEWER, 'tools', p.slice('/kip/tools/'.length)) : p.startsWith('/kip/') && !p.slice(5).includes('/') ? path.join(VIEWER, p.slice(5)) : '';
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => web.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${web.address().port}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = await launchChrome({ width: 420, height: 400 });
let code = 0;
try {
  const page = await chrome.open(`${base}/kip/tools/workshop-wait-harness.html`);
  const ev = (expr) => page.evaluate(expr);
  await page.waitFor('window.__ready === true', 15000);
  const pile = () => ev("document.querySelectorAll('.kww-pb.on').length");
  const label = () => ev("document.getElementById('label').textContent");
  const bricks = () => ev("document.querySelectorAll('.kww-brick').length");
  const hidden = () => ev('window.__ws.visible === false');

  console.log('\n[1] it appears only after a moment, and it is contained');
  check('nothing on the page before it starts', await hidden());
  check('it added no style to the page head (its CSS travels inside its own element) and no listener is needed', (await ev("document.head.querySelectorAll('style').length")) === 0 && (await ev("!!document.querySelector('.kww-workshop style')")));
  await ev("window.__ws.start({ staged: true, delayMs: 400 })");
  check('still hidden right after start (a quick answer would never flash it)', await hidden());
  check('then it appears', await page.waitFor('window.__ws.visible === true', 3000));
  check('the decoration is hidden from a screen reader; the status line is where the words live', await ev("document.querySelector('.kww-workshop').getAttribute('aria-hidden') === 'true' && document.getElementById('label').getAttribute('role') === 'status'"));
  check('bricks ride the belt', await page.waitFor("document.querySelectorAll('.kww-brick').length >= 1", 3000));

  console.log('\n[2] stages: words, pile and what each looks like');
  const seen = [];
  const note = async () => { seen.push(await pile()); };
  await ev("window.__ws.setStage('asking')");
  check('asking: the default words, and one brick on the pile', (await label()) === 'Looking through the parts bin…' && (await pile()) === 1, `${await label()} / ${await pile()}`);
  await note();
  await ev("window.__ws.setStage('proposing')");
  check('a Forge job status works as an alias (proposing = asking)', (await label()) === 'Looking through the parts bin…');
  await ev("window.__ws.setStage('preview_ready')");
  check('preview: the pile jumps to four at once and says it is a first look', (await pile()) === 4 && (await label()).startsWith('Here is your first look'), `${await label()} / ${await pile()}`);
  await note();
  await ev("window.__ws.setStage('checking', { call: 1 })");
  check('checking: a scan light is on, five on the pile', (await ev("document.querySelector('.kww-workshop').classList.contains('kww-scan')")) && (await pile()) === 5 && (await label()) === 'Checking it can print…');
  await note();
  await page.shot(path.join(SHOTS, 'checking.png'));
  await page.waitFor("document.querySelectorAll('.kww-brick').length >= 2", 6000);
  const popped = await ev("(() => { window.__ws.setStage('checking', { call: 2, label: 'Checking with the printer… (try 2)' }); return document.querySelectorAll('.kww-poof').length; })()");
  check('a retry pops a brick out of the line and the host\'s own words are used, with the next pile brick', popped >= 1 && (await label()) === 'Checking with the printer… (try 2)' && (await pile()) === 6, `${popped} / ${await label()} / ${await pile()}`);
  await note();
  check('a fresh brick rides in after the one that popped', await page.waitFor("document.querySelectorAll('.kww-brick:not(.kww-poof)').length >= 1", 3000));
  await ev("window.__ws.setStage('repairing')");
  check('repair (a Forge status): its own words, no step back on the pile', (await label()) === 'Fixing a thin bit…' && (await pile()) >= 6);
  await note();

  console.log('\n[3] a rest: paused belt, a real countdown, nothing new on the belt');
  await ev("window.__ws.setStage('waiting', { seconds: 3, label: (left) => 'rest ' + left })");
  const before = await bricks();
  check('rest: the words start at the real seconds and the strip is marked as resting', (await label()) === 'rest 3' && (await ev("document.querySelector('.kww-workshop').classList.contains('kww-rest')")));
  check('the belt is paused while it rests', (await ev("getComputedStyle(document.querySelector('.kww-belt')).animationPlayState")) === 'paused');
  check('the scan light is off while it rests', !(await ev("document.querySelector('.kww-workshop').classList.contains('kww-scan')")));
  await sleep(3600);
  const labels = await ev('window.__labels');
  const restWords = labels.filter((l) => /^rest \d$/.test(l));
  check('the countdown ticked down once a second to zero, in order', JSON.stringify(restWords) === JSON.stringify(['rest 3', 'rest 2', 'rest 1', 'rest 0']), JSON.stringify(restWords));
  check('no new bricks were put on the belt during the rest', (await bricks()) <= before, `${before} -> ${await bricks()}`);
  check('the pile did not move during the rest', (await pile()) === seen[seen.length - 1]);
  await ev("window.__ws.setStage('rest', { seconds: 5, label: (left) => 'second rest ' + left })");
  await ev("window.__ws.setStage('checking', { call: 3 })");
  const count = (await ev('window.__labels')).length;
  await sleep(1400);
  check('leaving a rest cancels its countdown (nothing says "second rest" afterwards)', (await ev('window.__labels')).length === count && !(await ev('window.__labels')).some((l, i, a) => i >= count && /second rest/.test(l)));
  check('the rest marker and the paused belt are gone again', !(await ev("document.querySelector('.kww-workshop').classList.contains('kww-rest')")) && (await ev("getComputedStyle(document.querySelector('.kww-belt')).animationPlayState")) === 'running');
  await note();

  console.log('\n[4] the pile only moves forward and never fills before the answer');
  await ev("window.__ws.setStage('fetching_plate')");
  await note();
  check('fetching: seven on the pile', (await pile()) === 7, String(await pile()));
  await sleep(5600);
  check('after a long stage it creeps one more brick but never past eight (two are held back)', (await pile()) === 8, String(await pile()));
  check('across every stage the pile never went backwards', seen.every((n, i) => i === 0 || n >= seen[i - 1]), JSON.stringify(seen));
  check('and never reached ten before the answer', (await pile()) <= 8 && Math.max(...seen) <= 8);
  check('no more than six bricks on the belt at once', (await bricks()) <= 6);

  console.log('\n[5] unknown names and odd input are ignored');
  const labelNow = await label();
  const countNow = (await ev('window.__labels')).length;
  await ev("for (const n of ['constructor', '__proto__', 'toString', 42, null, undefined, '', 'nope']) window.__ws.setStage(n)");
  check('nothing changed and nothing threw', (await label()) === labelNow && (await ev('window.__labels')).length === countNow && page.exceptions.length === 0, page.exceptions.join(' | '));
  await ev("window.__ws.setStage('checking', { call: -5 }); window.__ws.setStage('checking', { call: 'x' }); window.__ws.setStage('rest', { seconds: 'x' })");
  check('a bad call number or seconds falls back to the plain stage and does not throw', page.exceptions.length === 0 && (await pile()) <= 8);

  console.log('\n[6] stop(): done means finished, and nothing comes back');
  await ev("window.__ws.stop({ finished: true })");
  check('finishing fills the whole pile', (await pile()) === 10, String(await pile()));
  check('then the strip goes away, with no bricks left', await page.waitFor("window.__ws.visible === false && document.querySelectorAll('.kww-brick').length === 0", 3000));
  const afterStop = (await ev('window.__labels')).length;
  await ev("window.__ws.setStage('checking', { call: 1 }); window.__ws.setStage('rest', { seconds: 3 })");
  await sleep(1500);
  check('a late stage report after stop() does not bring it back and says nothing', (await hidden()) && (await ev('window.__labels')).length === afterStop);
  check('nothing keeps running behind it: no bricks, no new words', (await bricks()) === 0);
  await ev("window.__ws.start({ staged: true, delayMs: 0 })");
  check('it can wait again, and starts from an empty pile', (await pile()) === 0);
  await ev("window.__ws.stop()");
  check('stop() without finished removes it at once and leaves the pile as it was', await hidden());

  console.log('\n[7] timed mode is separate: stage reports are ignored there');
  await ev("window.__ws.start({ delayMs: 0 })");
  const timedLabel = await label();
  await ev("window.__ws.setStage('preview')");
  check('in timed mode the words come from the clock and setStage changes nothing', timedLabel === 'Looking through the parts bin…' && (await label()) === timedLabel && (await pile()) <= 1);
  await ev("window.__ws.stop()");

  console.log('\n[8] reduced motion (CSS and script)');
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await ev("window.matchMedia = (q) => ({ matches: /reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })");
  await ev("window.__ws.start({ staged: true, delayMs: 0 })");
  check('three still bricks and no moving ones', await page.waitFor("document.querySelectorAll('.kww-brick.kww-static').length === 3 && document.querySelectorAll('.kww-brick:not(.kww-static)').length === 0", 3000));
  await ev("window.__ws.setStage('checking', { call: 1 })");
  check('the belt and the scan light do not animate', (await ev("getComputedStyle(document.querySelector('.kww-belt')).animationName")) === 'none' && (await ev("getComputedStyle(document.querySelector('.kww-workshop'), '::after').display")) === 'none');
  check('the pile still counts, and nothing new rides the belt', (await pile()) === 5 && (await ev("document.querySelectorAll('.kww-brick:not(.kww-static)').length")) === 0);
  await page.shot(path.join(SHOTS, 'reduced-motion.png'));
  await ev("window.__ws.stop()");

  check('no page errors were thrown', page.exceptions.length === 0, page.exceptions.join(' | '));
  console.log(`\n  screenshots: ${SHOTS}`);
} catch (e) {
  console.log(`  FAIL unexpected error: ${e.stack ?? e}`);
  code = 1;
} finally {
  finish();
  chrome.close(); web.close();
  process.exit(process.exitCode || code);
}
