#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Browser test of the Describe & build tab inside the REAL page, Kip-Demo.html, in headless Chrome: the things the development harness cannot show,
// namely sharing the screen with the side menu, the print and selfie controls and the version pill, hiding and restoring Kip and the camera, and the
// host's own single-key shortcuts (E explode, H hide the UI, B build) staying quiet while you type. No key, no model: the tab uses its sample builds.
//   node parts/kip/viewer/tools/e2e_describe_host.mjs      Env: E2E_CHROME, E2E_SHOTS (screenshot dir), E2E_SLOW (multiplies the long waits). Exits 1 on failure.
// Serves public/ with the viewer sources overlaid, like the other Kip suites (scripts/lib/kip-e2e.mjs). Do not run it at the same time as another
// headless-Chrome suite on a loaded machine: the software GPU starves.
import os from 'node:os';
import path from 'node:path';
import { createChecks, launchChrome, startServer } from '../../../../scripts/lib/kip-e2e.mjs';

const SHOTS = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), 'kip-describe-host-shots');
const SLOW = Number(process.env.E2E_SLOW ?? 1);
const { check, finish } = createChecks('describe tab in Kip-Demo e2e');
const server = await startServer();
const chrome = await launchChrome({ width: 1440, height: 900 });
let code = 0;
try {
  const page = await chrome.open(`${server.base}/kip/Kip-Demo.html`);
  const ev = (expr) => page.evaluate(expr);
  const D = 'window.kipDescribe';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // fixed or sticky boxes of the host that overlap the box of `sel` (big full-screen layers and canvases are not "controls")
  const overlaps = (sel) => ev(`(() => {
    const mine = document.querySelector(${JSON.stringify(sel)}); const r = mine.getBoundingClientRect(); const out = [];
    for (const el of document.querySelectorAll('body *')) {
      if (el === mine || mine.contains(el) || el.contains(mine) || el.closest('.kdb-panel, .kdb-toggle')) continue;
      if (['CANVAS', 'SCRIPT', 'STYLE'].includes(el.tagName)) continue;
      const cs = getComputedStyle(el);
      if (!['fixed', 'sticky'].includes(cs.position) || cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
      const b = el.getBoundingClientRect();
      if (b.width < 2 || b.height < 2 || b.width * b.height > 0.4 * innerWidth * innerHeight) continue;
      const ox = Math.min(r.right, b.right) - Math.max(r.left, b.left), oy = Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top);
      if (ox > 1 && oy > 1) out.push((el.id ? '#' + el.id : el.tagName.toLowerCase()) + '.' + String(el.className).split(' ')[0] + ' ' + Math.round(ox) + 'x' + Math.round(oy));
    }
    return out; })()`);
  const cam = () => ev('(() => { const c = window.kipMenu.ctx.camera; return [c.position.x, c.position.y, c.position.z]; })()');
  const kipVisible = () => ev('window.kipRig().kip.mover.visible');

  console.log('\n[1] the page loads with the tab in it');
  check('the demo is ready', await page.waitFor('window.__KIP_READY__ === true', 420000 * SLOW, 1000), 'page never became ready');
  check('the tab is mounted: a toggle button and a hidden panel', await ev("!!document.querySelector('.kdb-toggle') && document.querySelector('.kdb-panel').hidden && !!window.kipDescribe"));
  check('the toggle does not sit on top of any host control at 1440 x 900', (await overlaps('.kdb-toggle')).length === 0, JSON.stringify(await overlaps('.kdb-toggle')));
  check('the host menu is still there and Kip is visible', await ev("!!document.querySelector('#kip-menu')") && (await kipVisible()) === true);
  await page.shot(path.join(SHOTS, 'host-closed.png'));
  const camBefore = await cam();

  console.log('\n[2] open, build, hide Kip');
  await ev("document.querySelector('.kdb-toggle').click()");
  check('opening shows the panel and hides Kip', !(await ev("document.querySelector('.kdb-panel').hidden")) && (await kipVisible()) === false);
  check('the open panel starts below the host\'s top bar and covers no host control', (await overlaps('.kdb-panel')).length === 0, JSON.stringify(await overlaps('.kdb-panel')));
  check('the sample descriptions load', await page.waitFor("document.querySelectorAll('.kdb-examples button').length === 10", 120000 * SLOW));
  await ev("[...document.querySelectorAll('.kdb-examples button')].find((b) => b.textContent === 'a race car').click()");
  check('"a race car" draws its 10 parts in the host scene', await page.waitFor(`${D}.view && ${D}.view.meshes.length === 10`, 300000 * SLOW, 500));
  check('the drawing group is in the host scene and visible, and Kip is still hidden', await ev(`${D}.view.group.visible && !!${D}.view.group.parent && ${D}.view.group.parent.isScene === true`) && (await kipVisible()) === false);
  const camDuring = await cam();
  check('the camera was re-aimed at the drawing', Math.hypot(...camDuring.map((v, i) => v - camBefore[i])) > 1, JSON.stringify([camBefore, camDuring]));
  await page.shot(path.join(SHOTS, 'host-open-built.png'));

  console.log('\n[3] the host shortcuts stay quiet while typing');
  const hostState = () => ev("({ explode: window.kipMenu.ctx.loco.explodeTarget, clean: document.body.classList.contains('clean-ui'), mode: window.kipMenu.ctx.loco.buildMode })");
  const s0 = await hostState();
  await ev("document.querySelector('#kdb-text').focus(); document.querySelector('#kdb-text').value = ''");
  for (const k of ['e', 'h', 'b']) await page.key(k, `Key${k.toUpperCase()}`);
  const s1 = await hostState();
  check('typing "e", "h", "b" in the box types, and explode, hide-UI and build do not fire', (await ev("document.querySelector('#kdb-text').value")) === 'ehb' && JSON.stringify(s0) === JSON.stringify(s1), JSON.stringify([s0, s1]));
  await ev('document.activeElement.blur()');
  await page.key('e', 'KeyE');
  await sleep(300);
  check('(control) the same "e" outside the panel DOES toggle explode, so the test can tell', (await hostState()).explode >= 0.5);
  await page.key('e', 'KeyE');
  await sleep(300);
  check('(control) and a second "e" puts it back', (await hostState()).explode < 0.5);

  console.log('\n[4] play the build in the host');
  await ev("document.querySelector('#kdb-text').value = ''");
  await ev(`${D}.setBuildProgress(0)`);
  await ev("[...document.querySelectorAll('.kdb-build button')].find((b) => b.textContent === 'Play build').click()");
  check('Play build runs to the end inside the host', await page.waitFor(`!${D}.playing && ${D}.progress === 10`, 600000 * SLOW, 500), `progress ${await ev(`${D}.progress`)}`);
  check('and ends with every part opaque and exactly at its pose', await ev(`(() => { const v = ${D}.view, r = ${D}.last; return v.steps.every((s, i) => { const p = r.poses[s.id], m = v.meshes[i]; return m.visible && m.material.opacity === 1 && Math.hypot(m.position.x - p.x, m.position.y - p.y, m.position.z - p.z) < 1e-9; }); })()`));

  console.log('\n[5] close: Kip and the camera come back');
  await ev("document.querySelector('#kdb-text').focus()");
  await page.key('Escape', 'Escape');
  check('Escape closes the panel and hides the drawing', await ev("document.querySelector('.kdb-panel').hidden") && !(await ev(`${D}.view.group.visible`)));
  check('Kip is visible again', (await kipVisible()) === true);
  const camAfter = await cam();
  check('the camera is exactly where it was before the panel opened', Math.hypot(...camAfter.map((v, i) => v - camBefore[i])) < 1e-6, JSON.stringify([camBefore, camAfter]));
  await ev("document.querySelector('.kdb-toggle').click()");
  check('reopening shows the same drawing again, re-aimed, with Kip hidden', (await ev(`${D}.view.group.visible`)) && (await ev(`${D}.view.meshes.length`)) === 10 && (await kipVisible()) === false && Math.hypot(...(await cam()).map((v, i) => v - camDuring[i])) < 5);
  await ev("document.querySelector('.kdb-toggle').click()");
  check('and closing again restores Kip and the camera again', (await kipVisible()) === true && Math.hypot(...(await cam()).map((v, i) => v - camBefore[i])) < 1e-6);

  console.log('\n[6] the rest of the host still works, and the page is clean');
  const hat = await ev("(() => { const m = window.kipMenu; m.sync(); return m.ctx.loco.hat; })()");
  await ev("window.kipMenu.ctx.act.setCategory('human'); window.kipMenu.sync();");
  check('the host menu still drives Kip after the tab has been used', (await ev('window.kipMenu.ctx.loco.category')) === 'human' && hat !== undefined);
  const missingDescribe = [...server.missing].filter((u) => u.includes('describe'));
  check('no describe STL was missing, and no stand-in was served for one', missingDescribe.length === 0, missingDescribe.join(', '));
  check('no page errors were thrown', page.exceptions.length === 0, page.exceptions.join(' | '));
  const origins = new Set(page.requests.map((r) => { try { return new URL(r.url).origin; } catch { return r.url.slice(0, 5); } }));
  // 'null' is the origin of about:blank / data: / blob: URLs, which are not network requests to anywhere
  check('the page only talked to its own server (the tab made no outside request)', [...origins].every((o) => o === server.base || o === 'null' || o.startsWith('data:') || o.startsWith('blob:')), [...origins].join(', '));
  const hide = () => ev("document.body.classList.contains('clean-ui')");
  await page.key('h', 'KeyH');
  await sleep(300);
  check('the host\'s "hide UI" key (H) hides the tab\'s toggle too, so clean screenshots stay clean', (await hide()) && (await ev("getComputedStyle(document.querySelector('.kdb-toggle')).display")) === 'none');
  await page.key('h', 'KeyH');
  await sleep(300);
  check('and pressing it again brings the toggle back', !(await hide()) && (await ev("getComputedStyle(document.querySelector('.kdb-toggle')).display")) !== 'none');

  console.log('\n[7] smaller screens');
  await page.resize(800, 800, false);
  await sleep(500);
  check('at 800 px wide the closed toggle is clear of the host\'s controls', (await overlaps('.kdb-toggle')).length === 0, JSON.stringify(await overlaps('.kdb-toggle')));
  await page.resize(390, 800, true);
  await sleep(600);
  check('at 390 px the closed toggle is clear of the host\'s controls (the version pill included)', (await overlaps('.kdb-toggle')).length === 0, JSON.stringify(await overlaps('.kdb-toggle')));
  await page.shot(path.join(SHOTS, 'host-narrow-closed.png'));
  await ev("document.querySelector('.kdb-toggle').click()");
  await sleep(400);
  const narrow = await ev("(() => { const p = document.querySelector('.kdb-panel').getBoundingClientRect(), c = [...document.querySelectorAll('.kdb-panel button')].find((b) => b.textContent === 'Close').getBoundingClientRect(); return { w: document.documentElement.scrollWidth, panel: p.width, left: p.left, right: p.right, top: p.top, bottom: p.bottom, closeIn: c.left >= 0 && c.right <= innerWidth && c.top >= 0 && c.bottom <= innerHeight, vis: !document.querySelector('.kdb-panel').hidden }; })()");
  check('at 390 px the open panel is a bottom sheet that fits with a 16 px gutter, with its Close button on screen', narrow.vis && narrow.w <= 390 && narrow.left >= 15.5 && narrow.right <= 374.5 && narrow.bottom <= 800 && narrow.closeIn, JSON.stringify(narrow));
  check('and the sheet covers no host control at 390 px (top bar, version strip and the Customize button all stay clear)', (await overlaps('.kdb-panel')).length === 0, JSON.stringify(await overlaps('.kdb-panel')));
  check('the toggle stays visible below the sheet, so it can be closed from there too', await ev("(() => { const t = document.querySelector('.kdb-toggle').getBoundingClientRect(), p = document.querySelector('.kdb-panel').getBoundingClientRect(); return t.top >= p.bottom - 0.5 && t.bottom <= innerHeight; })()"));
  await page.shot(path.join(SHOTS, 'host-narrow-open.png'));
  await ev("[...document.querySelectorAll('.kdb-panel button')].find((b) => b.textContent === 'Close').click()");
  check('the Close button closes it and Kip comes back', (await ev("document.querySelector('.kdb-panel').hidden")) && (await kipVisible()) === true);
  await page.resize(1440, 900, false);
  await sleep(500);
  await ev("document.querySelector('.kdb-toggle').click()");
  await sleep(300);
  check('back at 1440 the open panel starts below the host\'s top bar and covers no host control', (await overlaps('.kdb-panel')).length === 0, JSON.stringify(await overlaps('.kdb-panel')));
  await page.shot(path.join(SHOTS, 'host-open-after-fix.png'));
  await ev("document.querySelector('.kdb-toggle').click()");
  console.log(`\n  screenshots: ${SHOTS}`);
} catch (e) {
  console.log(`  FAIL unexpected error: ${e.stack ?? e}`);
  code = 1;
} finally {
  finish();
  chrome.close();
  server.close();
  process.exit(process.exitCode || code);
}
