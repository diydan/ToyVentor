#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Browser test of the Describe & build tab (kip-describe-tab.js) in headless Chrome, on the development harness page: build from an example, the exploded
// slider, step highlighting, close and reopen, keyboard isolation, empty input, a mock model endpoint (validated, refused, unchecked, failing), the
// settings box, privacy of the requests, the narrow layout. No key and no real model: the endpoint is a mock on loopback.
//   node parts/kip/viewer/tools/e2e_describe.mjs        Env: E2E_CHROME (binary), E2E_SHOTS (screenshot dir), E2E_PUBLIC_ONLY=1 (see below). Exits 1 on any failure.
// Needs public/kip/partspec/describe/*.stl (tools/export_describe_stls.py). Slow under load: Chrome renders with a software GPU.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChecks, launchChrome } from '../../../../scripts/lib/kip-e2e.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VIEWER = path.join(HERE, '..');
const PUBLIC = path.join(VIEWER, '..', '..', '..', 'public');
const SHOTS = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), 'kip-describe-shots');
// E2E_PUBLIC_ONLY=1 serves /kip/<file> from public/kip only (no overlay of the sources): proves the mirrored copies work by themselves.
const PUBLIC_ONLY = process.env.E2E_PUBLIC_ONLY === '1';
const doc = JSON.parse(fs.readFileSync(path.join(VIEWER, 'kip-describe-recipes.json'), 'utf8'));
const skate = doc.recipes.find((r) => r.id === 'skateboard');
const { check, finish } = createChecks('describe tab e2e');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.stl': 'model/stl', '.css': 'text/css' };

// static server: /kip/tools/<f> and /kip/<f> from the viewer folder, everything else from public/
const voice = { seen: [], fail: false };
const transcribe = { enabled: true, probes: 0, posts: [], status: 200, body: { text: 'a pink skateboard' } };   // stand-in for the app's /api/transcribe (a child's voice to words); it never runs a model
const describeStub = { seen: [], fail: false, id: 'skateboard', delayMs: 0 };   // stand-in for the app's /api/describe (Muse picks a checked build); never calls a model
const tinyWav = (() => { const n = 2400, b = Buffer.alloc(44 + n * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(24000, 24); b.writeUInt32LE(48000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40); return b; })();
const web = http.createServer((req, res) => {
  if (new URL(req.url, 'http://x').pathname === '/api/transcribe') {
    if (req.method === 'GET') { transcribe.probes++; res.writeHead(transcribe.enabled ? 200 : 404, { 'content-type': 'application/json' }); res.end(JSON.stringify(transcribe.enabled ? { ok: true, route: 'transcribe', contract: 1, enabled: true } : { error: 'not found' })); return; }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      // for a WAV also keep the format the page made (mono / rate / bits from the fmt chunk) and its length, so the check can say it is the format every speech model behind the route takes
      const wav = body.length > 44 && body.subarray(0, 4).toString() === 'RIFF' ? { channels: body.readUInt16LE(22), rate: body.readUInt32LE(24), bits: body.readUInt16LE(34), seconds: +(body.readUInt32LE(40) / body.readUInt32LE(28)).toFixed(2) } : null;
      transcribe.posts.push({ type: req.headers['content-type'], bytes: body.length, head: [...body.subarray(0, 4)], wav });
      res.writeHead(transcribe.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(transcribe.body));
    });
    return;
  }
  if (new URL(req.url, 'http://x').pathname === '/api/describe') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      try { describeStub.seen.push(JSON.parse(raw || '{}')); } catch { describeStub.seen.push({ bad: raw }); }
      const answer = () => {
        if (describeStub.fail) { res.writeHead(503, { 'content-type': 'application/json' }); res.end('{"error":"muse is not configured"}'); return; }
        const r = doc.recipes.find((x) => x.id === describeStub.id);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ contract: 1, title: r.title, note: `Muse picked "${r.title}", a checked build. Hello!`, validated: true, steps: r.steps, poses: r.reference.poses }));
      };
      setTimeout(answer, describeStub.delayMs);   // Muse takes seconds; the waiting state is what the child sees meanwhile
    });
    return;
  }
  if (new URL(req.url, 'http://x').pathname === '/api/voice') {   // stand-in for the app's voice route: records the request, never calls a model
    voice.seen.push(req.url);
    if (voice.fail) { res.writeHead(503); res.end('voice unavailable'); return; }
    res.writeHead(200, { 'content-type': 'audio/wav', 'x-voice-text': encodeURIComponent(`spoken:${new URL(req.url, 'http://x').searchParams.get('lang')}:${new URL(req.url, 'http://x').searchParams.get('p')}`) });
    res.end(tinyWav);
    return;
  }
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const cands = [];
  if (p.startsWith('/kip/tools/')) cands.push(path.join(VIEWER, 'tools', p.slice('/kip/tools/'.length)));
  if (p.startsWith('/kip/') && !p.slice(5).includes('/') && !PUBLIC_ONLY) cands.push(path.join(VIEWER, p.slice(5)));
  cands.push(path.join(PUBLIC, p));
  const file = cands.find((f) => fs.existsSync(f) && fs.statSync(f).isFile());
  if (!file) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => web.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${web.address().port}`;

// mock model endpoint (with CORS, since it is another origin)
const mock = { status: 200, body: {}, seen: [] };
const api = http.createServer(async (req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'content-type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, contract: 1, validator: 'ready' })); return; }
  let raw = ''; for await (const c of req) raw += c;
  mock.seen.push({ headers: req.headers, body: JSON.parse(raw || '{}') });
  res.writeHead(mock.status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(mock.body));
});
await new Promise((r) => api.listen(0, '127.0.0.1', r));
const apiBase = `http://127.0.0.1:${api.address().port}`;

const chrome = await launchChrome({ width: 1280, height: 860 });
let code = 0;
try {
  const page = await chrome.open(`${base}/kip/tools/describe-harness.html?stepMs=300`);   // a fast build keeps the player tests short
  const ev = (expr) => page.evaluate(expr);
  const click = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).click()`);
  const status = () => ev("document.querySelector('.kdb-status').textContent");
  const meshes = () => ev('window.__describe.view ? window.__describe.view.meshes.length : 0');

  console.log('\n[1] opens and builds from an example');
  check('the page and the tab load', await page.waitFor('window.__describeReady === true', 120000));
  check('the panel is open and its toggle button exists', await ev("!document.querySelector('.kdb-panel').hidden && !!document.querySelector('.kdb-toggle')"));
  check('opening hid the host character', (await ev('window.__characterCalls')).at(-1) === false);
  check('ten sample descriptions appear as buttons once the data is loaded', await page.waitFor("document.querySelectorAll('.kdb-examples button').length === 10", 60000));
  await ev("[...document.querySelectorAll('.kdb-examples button')].find((b) => b.textContent === 'a race car').click()");
  check('building "a race car" draws its 10 parts', await page.waitFor('window.__describe.view.meshes.length === 10', 180000), `meshes: ${await meshes()}`);
  check('the textbox now holds the sample text', (await ev("document.querySelector('#kdb-text').value")) === 'a race car');
  check('the status names the build', (await status()).includes('Roadster'), await status());
  const badge = await ev("document.querySelector('.kdb-badge').textContent");
  check('the badge says it is a sample build checked for fit', badge.includes('sample build') && badge.includes('checked: every part fits') && (await ev("document.querySelector('.kdb-badge').classList.contains('ok')")), badge);
  check('the step list has one entry per step, named in plain words', (await ev("[...document.querySelectorAll('.kdb-steps li')].map((l) => l.textContent)")).join('|').startsWith('Car chassis (the base)|Hood cover on the car chassis'));
  check('the slider appears and starts at assembled', await ev("!document.querySelector('.kdb-slider').hidden && document.querySelector('.kdb-slider input').value === '0'"));
  await page.shot(path.join(SHOTS, 'race-car-assembled.png'));

  console.log('\n[2] the exploded view slider');
  const drift = (t) => ev(`(() => { const v = window.__describe.view, r = window.__describe.last, m = v.meshes; let worst = 0;
    r.steps.forEach((s, i) => { const p = r.poses[s.id], o = v.plan.offsets[s.id]; const want = [p.x + ${t} * o[0], p.y + ${t} * o[1], p.z + ${t} * o[2]];
      ['x', 'y', 'z'].forEach((k, j) => { worst = Math.max(worst, Math.abs(m[i].position[k] - want[j])); }); }); return worst; })()`);
  const setSlider = (v) => ev(`(() => { const s = document.querySelector('.kdb-slider input'); s.value = '${v}'; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  check('at 0 every part sits exactly at its pose', (await drift(0)) < 1e-9);
  await setSlider(50);
  check('at 50 every part is exactly halfway', (await drift(0.5)) < 1e-9);
  await setSlider(100);
  check('at 100 every part is at full spread', (await drift(1)) < 1e-9);
  const moved = await ev("(() => { const v = window.__describe.view; return v.steps.filter((s, i) => { const p = window.__describe.last.poses[s.id]; return Math.hypot(v.meshes[i].position.x - p.x, v.meshes[i].position.y - p.y, v.meshes[i].position.z - p.z) > 1; }).length; })()");
  check('at full spread nine of the ten parts have left their place (only the chassis stays)', moved === 9, `${moved}`);
  await page.shot(path.join(SHOTS, 'race-car-exploded.png'));
  await setSlider(0);
  check('back at 0 the build is whole again', (await drift(0)) < 1e-9);

  console.log('\n[3] step highlight');
  const glow = () => ev('window.__describe.view.meshes.map((m) => m.material.emissive.getHex())');
  await ev("document.querySelectorAll('.kdb-steps li')[5].dispatchEvent(new MouseEvent('mouseenter'))");
  const g = await glow();
  check('hovering step 6 lights only that wheel (the other sport wheels stay dark)', g[5] !== 0 && g.filter((x) => x !== 0).length === 1, JSON.stringify(g));
  await ev("document.querySelectorAll('.kdb-steps li')[5].dispatchEvent(new MouseEvent('mouseleave'))");
  check('leaving clears the highlight', (await glow()).every((x) => x === 0));


  console.log('\n[3a] say the part (the game\'s "say what it is", for parts)');
  const caption = () => ev("document.querySelector('.kdb-caption').textContent");
  const stepLis = "document.querySelectorAll('.kdb-steps li')";
  await ev("localStorage.removeItem('toyforge:prop-lang:v1')");
  check('the language picker is there with eight choices, English first and Turkish among them', await ev("(() => { const o = [...document.querySelectorAll('#kdb-lang option')].map((x) => x.value + ':' + x.textContent); return o.length === 8 && o[0] === 'en:English' && o.includes('tr:Türkçe') && o.at(-1) === 'off:Off'; })()"));
  voice.seen.length = 0;
  await ev(`${stepLis}[5].click()`);
  check('tapping step 6 (a sport wheel) asks for that part, in English, in the colour the view draws it', await page.waitFor('true', 100) && await (async () => { for (let i = 0; i < 40 && !voice.seen.length; i++) await new Promise((r) => setTimeout(r, 100)); return voice.seen.length === 1 && voice.seen[0] === '/api/voice?lang=en&p=veh_wheel_sport&hex=262D40'; })(), JSON.stringify(voice.seen));
  check('the caption shows the text the voice route spoke', await page.waitFor("document.querySelector('.kdb-caption').textContent === 'spoken:en:veh_wheel_sport'", 5000), await caption());
  voice.seen.length = 0;
  await ev("(() => { const s = document.querySelector('#kdb-lang'); s.value = 'es'; s.dispatchEvent(new Event('change', { bubbles: true })); })()");
  check('choosing Español is saved and says the first part, in Spanish', await page.waitFor("localStorage.getItem('toyforge:prop-lang:v1') === 'es'", 3000) && await (async () => { for (let i = 0; i < 40 && !voice.seen.length; i++) await new Promise((r) => setTimeout(r, 100)); return voice.seen[0]?.startsWith('/api/voice?lang=es&p=veh_car_chassis'); })(), JSON.stringify(voice.seen));
  voice.seen.length = 0;
  await ev(`${stepLis}[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
  check('pressing Enter on a step says it too (keyboard), now in Spanish', await (async () => { for (let i = 0; i < 40 && !voice.seen.length; i++) await new Promise((r) => setTimeout(r, 100)); return voice.seen.length === 1 && voice.seen[0].startsWith('/api/voice?lang=es&p='); })(), JSON.stringify(voice.seen));
  voice.seen.length = 0;
  await ev("(() => { const s = document.querySelector('#kdb-lang'); s.value = 'off'; s.dispatchEvent(new Event('change', { bubbles: true })); })()");
  await ev(`${stepLis}[5].click()`);
  await new Promise((r) => setTimeout(r, 600));
  check('Off says nothing and asks for nothing, and clears the caption', voice.seen.length === 0 && (await caption()) === '', JSON.stringify(voice.seen));
  await ev("(() => { const s = document.querySelector('#kdb-lang'); s.value = 'en'; s.dispatchEvent(new Event('change', { bubbles: true })); })()");
  voice.fail = true; voice.seen.length = 0;
  await ev(`${stepLis}[5].click()`);
  check('if the voice route is down the caption falls back to the English part name (and the tab keeps working)', await page.waitFor("document.querySelector('.kdb-caption').textContent === 'Sport wheel'", 5000), await caption());
  voice.seen.length = 0;
  await ev(`${stepLis}[6].click()`);
  await new Promise((r) => setTimeout(r, 500));
  check('and it does not hammer a failing route: the next tap makes no request for a minute', voice.seen.length === 0, JSON.stringify(voice.seen));
  voice.fail = false;
  await ev("localStorage.removeItem('toyforge:prop-lang:v1')");

  console.log('\n[3b] the build player');
  const D = 'window.__describe';
  // With the pile (kip-describe-view.js pilePlan) no part is ever hidden while a build plays: an unbuilt part lies in the pile, at pose + its pile offset. So "shown" below means
  // BUILT: out of the pile, whether it is being carried or already seated.
  const IN_PILE = `((v, r, m, i) => { const s = v.steps[i].id, o = v.pile.offsets[s], p = r.poses[s]; return m.visible && Math.hypot(m.position.x - (p.x + o[0]), m.position.y - (p.y + o[1]), m.position.z - (p.z + o[2])) < 1e-9; })`;
  const visibleCount = () => ev(`(() => { const v = ${D}.view, r = ${D}.last, inPile = ${IN_PILE}; return v.meshes.filter((m, i) => m.visible && !inPile(v, r, m, i)).length; })()`);
  // The player advances by at most a third of a step per rendered frame (so a slow frame never skips a step), which on a machine whose software GPU is
  // starved takes minutes; these waits are generous on purpose. E2E_SLOW multiplies them again.
  const SLOW = Number(process.env.E2E_SLOW ?? 1);
  const idle = () => page.waitFor(`!${D}.playing`, 300000 * SLOW, 100);
  // sample the page every 25 ms until the build stops (or ms pass): visible parts, parts in motion, progress, slider lock, highlighted list entries
  const sample = (ms = 300000 * SLOW) => ev(`new Promise((res) => { const t0 = performance.now(), out = [], inPile = ${IN_PILE}; const tick = () => { const v = ${D}.view, r = ${D}.last;
    const moving = v.meshes.filter((m, i) => { if (!m.visible || inPile(v, r, m, i)) return false; const p = r.poses[v.steps[i].id]; return m.material.opacity < 1 || Math.hypot(m.position.x - p.x, m.position.y - p.y, m.position.z - p.z) > 1e-6; }).length;
    out.push({ vis: v.meshes.filter((m, i) => m.visible && !inPile(v, r, m, i)).length, moving, prog: ${D}.progress, playing: ${D}.playing, locked: document.querySelector('.kdb-slider input').disabled, on: document.querySelectorAll('.kdb-steps li.on').length });
    if (!${D}.playing || performance.now() - t0 > ${ms}) res(out); else setTimeout(tick, 25); }; tick(); })`);
  const label = () => ev("document.querySelector('.kdb-progress').textContent");
  const btn = (name) => `[...document.querySelectorAll('.kdb-build button')].find((b) => b.textContent === ${JSON.stringify(name)})`;
  const press = (name) => ev(`${btn(name)}.click()`);
  const atPose = () => ev(`(() => { const v = ${D}.view, r = ${D}.last; return v.steps.every((s, i) => { const p = r.poses[s.id], m = v.meshes[i]; return m.visible && m.material.opacity === 1 && Math.hypot(m.position.x - p.x, m.position.y - p.y, m.position.z - p.z) < 1e-9; }); })()`);

  check('a finished recipe says so and offers Play build', (await label()).startsWith('Built: all 10 parts are seated') && (await ev(`${btn('Play build')} !== undefined`)) && (await ev(`${btn('Next')}.disabled`)) && !(await ev(`${btn('Back')}.disabled`)));
  await press('Play build');
  const run = await sample();
  const vis = run.map((s) => s.vis);
  check('Play build shows the parts one after another in order, ending with all 10', vis.every((v, i) => i === 0 || v >= vis[i - 1]) && vis.at(-1) === 10 && vis[0] <= 2, `${vis[0]} .. ${vis.at(-1)} over ${run.length} samples`);
  check('only one part is ever in motion (one part seats per step)', Math.max(...run.map((s) => s.moving)) <= 1, `${Math.max(...run.map((s) => s.moving))}`);
  check('the exploded slider is locked while it plays and the current step is highlighted in the list', run.filter((s) => s.playing).every((s) => s.locked) && run.some((s) => s.on === 1) && run.every((s) => s.on <= 1));
  check('it ends fully assembled: every part opaque and exactly at its pose', (await idle()) && (await atPose()));
  check('the slider is free again and the label says it is built', !(await ev("document.querySelector('.kdb-slider input').disabled")) && (await label()).startsWith('Built:'));

  await press('Play build');                                       // pressing Play on a finished build starts it over
  await page.waitFor(`${D}.progress >= 2.3 && ${D}.progress < 9`, 300000 * SLOW, 20);
  await press('Pause');
  const frozen = await ev(`${D}.progress`);
  await new Promise((r) => setTimeout(r, 400));
  check('Pause stops it where it is, and the button now offers Resume', !(await ev(`${D}.playing`)) && (await ev(`${D}.progress`)) === frozen && (await ev(`${btn('Resume')} !== undefined`)), `${frozen}`);
  check('the label names the step in progress', /^Step \d of 10: /.test(await label()), await label());
  check('the slider stays locked while a build is part-way', await ev("document.querySelector('.kdb-slider input').disabled"));
  await press('Resume');
  check('Resume finishes the build', (await idle()) && (await atPose()) && (await visibleCount()) === 10);

  await press('Back');
  check('Back removes the last part and stops there', (await visibleCount()) === 9 && (await ev(`${D}.progress`)) === 9 && !(await ev(`${D}.playing`)));
  await press('Back');
  check('Back again removes another', (await visibleCount()) === 8 && (await label()) === 'Step 8 of 10: ' + (await ev("document.querySelectorAll('.kdb-steps li')[7].textContent")));
  await press('Next');
  check('Next brings back exactly one part, playing it in', (await idle()) && (await visibleCount()) === 9 && (await ev(`${D}.progress`)) === 9);
  await press('Next');
  check('and the next one finishes the build', (await idle()) && (await visibleCount()) === 10 && (await atPose()));
  await ev(`${D}.setBuildProgress(0)`);
  check('at the very start nothing is built (every part is in the pile), Back is off, and the label invites Play', (await visibleCount()) === 0 && (await ev(`${btn('Back')}.disabled`)) && (await label()).startsWith('Ready:') && /in a pile/.test(await label()), await label());
  await press('Replay');
  const again = await sample();
  check('Replay starts from nothing and builds all the way again', again[0].vis <= 2 && again.at(-1).vis === 10 && (await atPose()));

  // an exploded view first, then Play: the build takes over cleanly and ends assembled
  await setSlider(100);
  await press('Play build');
  check('Play from an exploded view restarts the build with the slider back at 0', (await ev("document.querySelector('.kdb-slider input').value")) === '0' && (await idle()) && (await atPose()));
  // reduced motion: parts appear in place, never in flight
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await ev(`${D}.setBuildProgress(2.2)`);   // early in step 3's slot: still fading in and well out from its seat
  const still = await ev(`(() => { const v = ${D}.view, r = ${D}.last, i = 2, p = r.poses[v.steps[i].id], m = v.meshes[i]; return { vis: m.visible, off: Math.hypot(m.position.x - p.x, m.position.y - p.y, m.position.z - p.z), a: m.material.opacity }; })()`);
  check('with reduced motion the newest part appears seated, with no travel and no fade', still.vis && still.off < 1e-9 && still.a === 1, JSON.stringify(still));
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await ev(`${D}.setBuildProgress(2.2)`);   // early in step 3's slot: still fading in and well out from its seat
  const flying = await ev(`(() => { const v = ${D}.view, r = ${D}.last, i = 2, p = r.poses[v.steps[i].id], m = v.meshes[i]; return { vis: m.visible, off: Math.hypot(m.position.x - p.x, m.position.y - p.y, m.position.z - p.z), a: m.material.opacity }; })()`);
  check('without it the same moment finds that part still being carried in, opaque and out of the pile', flying.vis && flying.off > 1 && flying.a === 1 && !(await ev(`(() => { const v = ${D}.view; return (${IN_PILE})(v, ${D}.last, v.meshes[2], 2); })()`)), JSON.stringify(flying));
  await page.shot(path.join(SHOTS, 'race-car-mid-build.png'));

  console.log('\n[3c] the pile: every part starts lying beside the model and is carried to its seat');
  // what is drawn, in CAD coordinates (the harness measures the real meshes), against what the plan says
  const boxes = () => ev('window.__describeBoxes()');
  const overlaps = (a, b, gap = 0) => [0, 1, 2].every((k) => a[k] < b[3 + k] + gap && b[k] < a[3 + k] + gap);
  await ev(`${D}.setBuildProgress(10)`);
  const assembled = await boxes();
  const model = assembled.reduce((h, b) => [0, 1, 2, 3, 4, 5].map((k) => (k < 3 ? Math.min(h[k], b[k]) : Math.max(h[k], b[k]))));
  await ev(`${D}.setBuildProgress(0)`);
  const pileBoxes = await boxes();
  const gap = await ev(`${D}.view.pile.region !== null ? 10 : 0`);
  check('at progress 0 every one of the 10 parts sits at its place in the pile (pose + pile offset, to 1e-9)', (await ev(`(() => { const v = ${D}.view, r = ${D}.last, inPile = ${IN_PILE}; return v.meshes.every((m, i) => inPile(v, r, m, i)); })()`)) && pileBoxes.length === 10);
  check('none is hidden, none is at its seat, and the build count is zero', (await ev(`${D}.view.meshes.every((m) => m.visible)`)) && (await visibleCount()) === 0 && !(await atPose()));
  const lowestAssembled = Math.min(...assembled.map((b) => b[2]));
  check('the drawn parts lie ON the ground: each one\'s lowest point is the model\'s lowest point, never below it', pileBoxes.every((b) => Math.abs(b[2] - lowestAssembled) < 1e-3), JSON.stringify(pileBoxes.map((b) => +(b[2] - lowestAssembled).toFixed(4))));
  check('the pile is beside the model: no drawn pile part is within 10 mm of any part of the assembled model, the base included', pileBoxes.every((p) => assembled.every((a) => !overlaps(p, a, gap - 0.01))), '');
  check('and the pile parts are 10 mm apart from one another', pileBoxes.every((a, i) => pileBoxes.every((b, j) => i === j || !overlaps(a, b, gap - 0.01))), '');
  const region = await ev(`${D}.view.pile.region`);
  check('the pile\'s near edge is one gap from the model\'s far edge, and the pile is centred across the model', Math.abs(region[0] - (model[3] + gap)) < 1e-6 && Math.abs((region[1] + region[4]) / 2 - (model[1] + model[4]) / 2) < 1e-6, JSON.stringify({ region, model }));
  const ndc = await ev(`(() => { const r = ${D}.view.pile.region, pts = []; for (const x of [r[0], r[3]]) for (const y of [r[1], r[4]]) for (const z of [r[2], r[5]]) pts.push(window.__describeNdc([x, y, z])); return pts; })()`);
  check('the whole pile is in the picture: all eight corners of the pile project inside the screen', ndc.every(([x, y, z]) => Math.abs(x) <= 1 && Math.abs(y) <= 1 && z < 1), JSON.stringify(ndc.map((p) => p.map((v) => +v.toFixed(2)))));
  const modelNdc = await ev(`(() => { const r = ${JSON.stringify(model)}, pts = []; for (const x of [r[0], r[3]]) for (const y of [r[1], r[4]]) for (const z of [r[2], r[5]]) pts.push(window.__describeNdc([x, y, z])); return pts; })()`);
  check('and so is the finished model beside it: all eight corners of the assembled model project inside the screen too', modelNdc.every(([x, y, z]) => Math.abs(x) <= 1 && Math.abs(y) <= 1 && z < 1), JSON.stringify(modelNdc.map((p) => p.map((v) => +v.toFixed(2)))));
  await page.shot(path.join(SHOTS, 'race-car-pile.png'));

  // part-way through step 4 (progress 3.4): parts 1 to 3 seated, part 4 in the air between the pile and its seat, parts 5 to 10 still in the pile
  await ev(`${D}.setBuildProgress(3.4)`);
  const midFlight = await ev(`(() => { const v = ${D}.view, r = ${D}.last; return v.steps.map((st, i) => { const m = v.meshes[i], p = r.poses[st.id], o = v.pile.offsets[st.id];
    const fromPose = Math.hypot(m.position.x - p.x, m.position.y - p.y, m.position.z - p.z), fromPile = Math.hypot(m.position.x - (p.x + o[0]), m.position.y - (p.y + o[1]), m.position.z - (p.z + o[2]));
    return fromPose < 1e-9 ? 'seated' : fromPile < 1e-9 ? 'pile' : 'air'; }); })()`);
  check('part-way through step 4 exactly that part is in the air: 3 seated, 1 in flight, 6 still in the pile', midFlight.filter((x) => x === 'seated').length === 3 && midFlight.filter((x) => x === 'air').length === 1 && midFlight[3] === 'air' && midFlight.filter((x) => x === 'pile').length === 6, midFlight.join());
  await page.shot(path.join(SHOTS, 'race-car-pile-flight.png'));
  // The carried part is clear of every seated part and every part still lying in the pile, all the way until the last slide into its seat (that slide starts against the parts it
  // plugs into, so it is allowed to touch them: the plan proves it separately). Measured on the drawn meshes, 7 moments in each of the 10 slots.
  const carried = await ev(`(() => { const v = ${D}.view, n = v.steps.length, bad = [], ease = (f) => 1 - (1 - f) ** 3; let checked = 0;
    const hit = (a, b) => [0, 1, 2].every((c) => a[c] < b[3 + c] - 1e-4 && b[c] < a[3 + c] - 1e-4);
    for (let k = 0; k < n; k++) {
      const route = v.pile.routes[v.steps[k].id], len = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const total = route.slice(1).reduce((t, q, j) => t + len(route[j], q), 0), lastLeg = route.length > 1 ? len(route.at(-2), route.at(-1)) : 0, slideFrom = 1 - lastLeg / total;
      for (const f of [0.05, 0.12, 0.2, 0.3, 0.4, 0.5, 0.6]) {
        const u = ease(f / 0.75);
        if (u >= slideFrom - 1e-3) continue;
        ${D}.setBuildProgress(k + f);
        const bs = window.__describeBoxes(); checked++;
        bs.forEach((b, i) => { if (i !== k && hit(bs[k], b)) bad.push(k + '@' + f + ' vs ' + i); });
      }
    }
    return { bad, checked };
  })()`);
  check('the carried part is clear of every seated part and every part in the pile until its last slide in (drawn meshes)', carried.bad.length === 0 && carried.checked >= 40, JSON.stringify(carried).slice(0, 300));

  // every step: seated before, one in flight, the rest in the pile, over the whole build
  const sweep = await ev(`(() => { const v = ${D}.view, r = ${D}.last, n = v.steps.length, bad = [], inPile = ${IN_PILE};
    const state = (m, i) => { const st = v.steps[i].id, p = r.poses[st]; return Math.hypot(m.position.x - p.x, m.position.y - p.y, m.position.z - p.z) < 1e-9 ? 'seated' : inPile(v, r, m, i) ? 'pile' : 'air'; };
    for (let k = 0; k < n; k++) for (const f of [0.1, 0.35, 0.6]) { ${D}.setBuildProgress(k + f); v.meshes.forEach((m, i) => { const want = i < k ? 'seated' : i === k ? 'air' : 'pile'; const got = state(m, i); if (got !== want) bad.push(k + ':' + i + ' ' + got + ' not ' + want); }); }
    ${D}.setBuildProgress(n); v.meshes.forEach((m, i) => { if (state(m, i) !== 'seated') bad.push('end:' + i); });
    return bad; })()`);
  check('across all 10 steps (3 moments each) the parts are always: earlier ones seated, the current one in the air, later ones in the pile', sweep.length === 0, sweep.slice(0, 4).join(' | '));
  check('at progress 10 every part is at its pose, to 1e-9, opaque and shown', (await atPose()) && (await ev(`${D}.view.meshes.every((m) => m.visible && m.material.opacity === 1)`)));
  const finalBoxes = await boxes();
  check('and the finished model is exactly where it was before the pile existed (the drawn boxes equal the assembled ones)', finalBoxes.every((b, i) => b.every((v, k) => Math.abs(v - assembled[i][k]) < 1e-6)));
  await ev(`${D}.setExplode(1)`);
  const exploded = await boxes();
  check('the exploded view still spreads the parts (unchanged by the pile): the drawn boxes are no longer the assembled ones', exploded.some((b, i) => b.some((v, k) => Math.abs(v - assembled[i][k]) > 1)));
  await ev(`${D}.setExplode(0)`);
  // reduced motion has no pile: parts appear in place, one after another, exactly as before
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await ev(`${D}.setBuildProgress(0)`);
  check('with reduced motion nothing lies in a pile: at progress 0 no part is shown at all, and the label says nothing of a pile', (await ev(`${D}.view.meshes.every((m) => !m.visible)`)) && !/pile/.test(await label()), await label());
  await ev(`${D}.setBuildProgress(4)`);
  check('and parts appear seated one after another (4 shown, 6 hidden)', (await ev(`${D}.view.meshes.filter((m) => m.visible).length`)) === 4);
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await ev(`${D}.setBuildProgress(10)`);
  await ev(`${D}.play()`);
  await page.waitFor(`${D}.playing`, 30000 * SLOW, 20);
  await ev("document.querySelector('#kdb-text').focus()");
  await page.key('Escape', 'Escape');
  check('closing the panel mid-play stops the build', !(await ev(`${D}.playing`)) && (await ev("document.querySelector('.kdb-panel').hidden")));
  await click('.kdb-toggle');
  await ev(`${D}.setBuildProgress(10)`);
  check('after all that the build is whole and the recipe is as it was', (await visibleCount()) === 10 && (await atPose()) && (await ev(`${D}.last.title`)) === 'Roadster');

  console.log('\n[4] keyboard, empty input, close and reopen');
  await ev("window.__leaked = []; window.addEventListener('keydown', (e) => window.__leaked.push(e.key)); document.querySelector('#kdb-text').focus(); document.querySelector('#kdb-text').value = '';");
  await page.key('e', 'KeyE'); await page.key('h', 'KeyH');
  check('typing in the box types, and the host never sees the keys', (await ev("document.querySelector('#kdb-text').value")) === 'eh' && (await ev('window.__leaked')).length === 0, JSON.stringify(await ev('window.__leaked')));
  await ev("document.activeElement.blur()");
  await page.key('e', 'KeyE');
  check('(control) the same key outside the panel does reach the page', (await ev('window.__leaked')).includes('e'));
  await ev("document.querySelector('#kdb-text').value = ''");
  await click('.kdb-go');
  await page.waitFor("document.querySelector('.kdb-status').textContent.includes('Type what')", 10000);
  check('an empty box asks for a description and changes nothing', (await status()).includes('Type what you would like') && (await meshes()) === 10);
  await ev("document.querySelector('#kdb-text').focus()");
  await page.key('Escape', 'Escape');
  check('Escape closes the panel, hides the drawing and gives the character back', (await ev("document.querySelector('.kdb-panel').hidden")) && !(await ev('window.__describe.view.group.visible')) && (await ev('window.__characterCalls')).at(-1) === true);
  check('the toggle reports it is closed', (await ev("document.querySelector('.kdb-toggle').getAttribute('aria-expanded')")) === 'false');
  await click('.kdb-toggle');
  check('the toggle reopens it, shows the drawing again and hides the character', !(await ev("document.querySelector('.kdb-panel').hidden")) && (await ev('window.__describe.view.group.visible')) && (await ev('window.__characterCalls')).at(-1) === false && (await meshes()) === 10);

  console.log('\n[5] a model endpoint (mock)');
  await ev(`(() => { const i = document.querySelector('#kdb-endpoint'); i.value = ${JSON.stringify(`${apiBase}/describe`)}; })()`);
  const ask = async (text) => { await ev(`document.querySelector('#kdb-text').value = ${JSON.stringify(text)}`); await click('.kdb-go'); await page.waitFor("!document.querySelector('.kdb-go').disabled", 180000); };
  mock.body = { steps: skate.steps, title: 'My board', note: 'Four wheels.', validated: true, poses: skate.reference.poses };
  await ask('a skateboard');
  const sent = mock.seen.at(-1);
  check('the page asked the endpoint with the contract and no credentials', sent.body.contract === 1 && sent.body.description === 'a skateboard' && sent.body.allowedIds.length === 30 && !sent.headers.authorization && !JSON.stringify(sent.body).toLowerCase().includes('key'));
  check('a validated model recipe is drawn (7 parts) and labelled as the model\'s', (await meshes()) === 7 && (await ev("document.querySelector('.kdb-badge').textContent")).includes('Built by the model') && (await ev("document.querySelector('.kdb-badge').classList.contains('ok')")));
  check('the address is remembered for the session only', (await ev("sessionStorage.getItem('kipDescribeEndpoint')")) === `${apiBase}/describe` && (await ev("localStorage.length")) === 0);
  mock.body = { error: 'no wheels for that' };
  await ask('a skateboard');
  check('a refusal falls back to the sample build and quotes the model', (await status()).includes('The model said: "no wheels for that"') && (await ev('window.__describe.last.source')) === 'recipe-book' && (await meshes()) === 7);
  mock.body = { steps: skate.steps, title: 'Unchecked' };
  await ask('a skateboard');
  check('an unchecked recipe is NOT drawn, and the page says so', (await meshes()) === 0 && (await status()).includes('not drawn') && (await ev("document.querySelector('.kdb-badge').classList.contains('warn')")) && (await ev("document.querySelectorAll('.kdb-steps li').length")) === 0 && (await ev("document.querySelector('.kdb-slider').hidden")));
  mock.status = 500; mock.body = {};
  await ask('a motor scooter');
  check('a failing endpoint falls back to the sample build and says why', (await status()).includes('answered 500') && (await meshes()) === 6, `${await status()} / ${await meshes()}`);
  mock.status = 200;
  await click('details summary');
  await ev("[...document.querySelectorAll('.kdb-panel button')].find((b) => b.textContent === 'Test connection').click()");
  check('Test connection reports the checker state', await page.waitFor("document.querySelector('.kdb-panel details p').textContent.includes('Fit checker: ready')", 20000), await ev("document.querySelector('.kdb-panel details p').textContent"));
  await page.shot(path.join(SHOTS, 'scooter-sample.png'));


  console.log('\n[5b] the app\'s own route: Muse picks a checked build (default on in the app, off in this harness unless ?de=)');
  const page2 = await chrome.open(`${base}/kip/tools/describe-harness.html?stepMs=300&de=/api/describe`);
  const ev2 = (expr) => page2.evaluate(expr);
  check('a second tab loads with the built-in route set', await page2.waitFor('window.__describeReady === true', 120000));
  describeStub.seen.length = 0;
  await ev2("document.querySelector('#kdb-text').value = 'quiero un monopatín'; document.querySelector('.kdb-go').click()");
  check('building draws the build Muse picked (the skateboard: 7 parts)', await page2.waitFor('window.__describe.view && window.__describe.view.meshes.length === 7', 180000), `meshes: ${await ev2('window.__describe.view ? window.__describe.view.meshes.length : 0')}`);
  check('it asked the app route with the child\'s own words (Spanish) and the allowed parts, and nothing else', describeStub.seen.length === 1 && describeStub.seen[0].description === 'quiero un monopatín' && Array.isArray(describeStub.seen[0].allowedIds) && describeStub.seen[0].allowedIds.length === 30 && Object.keys(describeStub.seen[0]).sort().join() === 'allowedIds,contract,description', JSON.stringify(describeStub.seen[0]).slice(0, 140));
  const badge2 = await ev2("document.querySelector('.kdb-badge').textContent");
  check('the badge says Muse picked it from the checked builds (honest: it did not invent it)', badge2 === 'Picked by Muse from the checked builds · checked: every part fits', badge2);
  check('the note carries Muse\'s line', (await ev2("document.querySelector('.kdb-status').textContent")).includes('Muse picked "Skateboard"'), await ev2("document.querySelector('.kdb-status').textContent"));
  describeStub.fail = true; describeStub.seen.length = 0;
  await ev2("document.querySelector('#kdb-text').value = 'a race car'; document.querySelector('.kdb-go').click()");
  check('with the route unavailable the sample build still arrives (10 parts)', await page2.waitFor('window.__describe.view.meshes.length === 10', 180000), `meshes: ${await ev2('window.__describe.view.meshes.length')}`);
  const st2 = await ev2("document.querySelector('.kdb-status').textContent");
  check('and the child is told nothing technical: no "endpoint", no "model said", no "could not be used"', !/endpoint|model said|could not be used|answered 503/i.test(st2) && st2.includes('Roadster'), st2);
  check('the badge falls back to the plain sample-build label', (await ev2("document.querySelector('.kdb-badge').textContent")).startsWith('A sample build'), await ev2("document.querySelector('.kdb-badge').textContent"));
  describeStub.fail = false;
  await ev2("document.querySelector('.kdb-panel details').open = true; document.querySelector('#kdb-endpoint').value = 'http://127.0.0.1:1/describe'; document.querySelector('#kdb-text').value = 'a race car'; document.querySelector('.kdb-go').click()");
  await page2.waitFor("document.querySelector('.kdb-status').textContent.length > 0 && !document.querySelector('.kdb-go').disabled", 60000);
  describeStub.seen.length = 0;
  check('a typed address wins: with one set, the built-in route is not asked', await page2.waitFor("document.querySelector('.kdb-go').disabled === false", 20000) && describeStub.seen.length === 0, JSON.stringify(describeStub.seen));


  console.log('\n[5c] the waiting state: a little workshop (belt, bricks that come and go, a parts pile)');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await ev2("document.querySelector('#kdb-endpoint').value = ''");
  describeStub.fail = false; describeStub.id = 'race-car'; describeStub.delayMs = 12000; describeStub.seen.length = 0;   // 12 s: the answer must arrive well after the mid-wait sample below, even on a loaded machine
  await ev2("document.querySelector('#kdb-text').value = 'a race car'; document.querySelector('.kdb-go').click()");
  check('right away the words are the first line', (await ev2("document.querySelector('.kdb-status').textContent")) === 'Looking through the parts bin…');
  check('after a moment the workshop appears', await page2.waitFor("!document.querySelector('.kww-workshop').hidden", 3000));
  check('bricks ride the belt', await page2.waitFor("document.querySelectorAll('.kww-brick').length >= 1", 3000));
  // Both checks read the SAME moment and insist the answer has not arrived yet (the strip is still showing), so a slow run fails loudly instead of misreporting.
  await page2.waitFor("document.querySelector('.kdb-status').textContent !== 'Looking through the parts bin…' && document.querySelectorAll('.kww-pb.on').length >= 3", 5000);
  const mid = JSON.parse(await ev2("JSON.stringify({ text: document.querySelector('.kdb-status').textContent, on: document.querySelectorAll('.kww-pb.on').length, waiting: !document.querySelector('.kww-workshop').hidden })"));
  check('a few seconds in, the wording moves on and the pile has started to fill', mid.waiting && mid.text !== 'Looking through the parts bin…' && /…$/.test(mid.text) && mid.on >= 3, JSON.stringify(mid));
  check('while waiting the pile is never full (the last two bricks are held for the real answer)', mid.waiting && mid.on <= 8, JSON.stringify(mid));
  check('it is purely decorative to a screen reader (hidden), while the status line keeps the words', await ev2("document.querySelector('.kww-workshop').getAttribute('aria-hidden') === 'true' && document.querySelector('.kdb-status').getAttribute('role') === 'status'"));
  await page2.shot(path.join(SHOTS, 'workshop-waiting.png'));   // after the samples: a slow software-GPU screenshot cannot decide a check
  check('no more than six bricks are ever on the belt at once', (await ev2("document.querySelectorAll('.kww-brick').length")) <= 6);
  check('the answer arrives, the build is drawn (10 parts) and the strip goes away', await page2.waitFor("window.__describe.view.meshes.length === 10 && document.querySelector('.kww-workshop').hidden === true", 180000));
  check('the status line then tells the result, not a waiting line', (await ev2("document.querySelector('.kdb-status').textContent")).includes('Roadster'), await ev2("document.querySelector('.kdb-status').textContent"));
  check('and nothing keeps running behind it: no bricks left on the belt', (await ev2("document.querySelectorAll('.kww-brick').length")) === 0);
  // reduced motion: the belt is still and the bricks sit on it (the pile still counts up)
  await ev2("window.matchMedia = (q) => ({ matches: /reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })");
  describeStub.id = 'skateboard'; describeStub.delayMs = 2500;
  await ev2("document.querySelector('#kdb-text').value = 'a skateboard'; document.querySelector('.kdb-go').click()");
  check('with reduced motion the workshop shows three still bricks and nothing moves', await page2.waitFor("!document.querySelector('.kww-workshop').hidden && document.querySelectorAll('.kww-brick.kww-static').length === 3 && document.querySelectorAll('.kww-brick:not(.kww-static)').length === 0", 5000));
  await sleep(1200);
  check('the pile still counts up with reduced motion, and no moving bricks appear', await page2.waitFor("document.querySelectorAll('.kww-pb.on').length >= 1 && document.querySelectorAll('.kww-brick:not(.kww-static)').length === 0", 4000));
  await page2.waitFor("window.__describe.view.meshes.length === 7 && document.querySelector('.kww-workshop').hidden === true", 180000);

  console.log('\n[5d] while the next build is pending, nothing from the last one is still claimed');
  describeStub.id = 'race-car'; describeStub.delayMs = 3000;
  const had = JSON.parse(await ev2("JSON.stringify({ badge: !document.querySelector('.kdb-badge').hidden, build: !document.querySelector('.kdb-build').hidden, slider: !document.querySelector('.kdb-slider').hidden, progress: document.querySelector('.kdb-progress').textContent })"));
  check('guard: the skateboard just built shows its badge, controls and "Built: all 7 parts"', had.badge && had.build && had.slider && /^Built: all 7 parts/.test(had.progress), JSON.stringify(had));
  // click, then ONE synchronous look: the hiding happens in the click handler itself, so this cannot race the 3 s answer
  const pending = JSON.parse(await ev2("(() => { document.querySelector('#kdb-text').value = 'a race car'; document.querySelector('.kdb-go').click(); return JSON.stringify({ badge: !document.querySelector('.kdb-badge').hidden, build: !document.querySelector('.kdb-build').hidden, slider: !document.querySelector('.kdb-slider').hidden, caption: document.querySelector('.kdb-caption').textContent, meshes: window.__describe.view.meshes.length, busy: document.querySelector('.kdb-go').disabled }); })()"));
  check('the old badge, the controls, the slider and any caption are hidden while it waits', !pending.badge && !pending.build && !pending.slider && pending.caption === '' && pending.busy, JSON.stringify(pending));
  check('the old drawing stays, so the stage is not blank', pending.meshes === 7, JSON.stringify(pending));
  check('the new answer brings the badge and the controls back for the NEW build', await page2.waitFor("window.__describe.view.meshes.length === 10 && !document.querySelector('.kdb-badge').hidden && !document.querySelector('.kdb-build').hidden && !document.querySelector('.kdb-slider').hidden && /^Built: all 10 parts/.test(document.querySelector('.kdb-progress').textContent)", 180000));
  describeStub.delayMs = 0;

  console.log('\n[6] privacy, errors, narrow layout');
  const origins = new Set(page.requests.map((r) => { try { return new URL(r.url).origin; } catch { return r.url.slice(0, 5); } }));
  check('the page talked only to its own server and the endpoint it was given', [...origins].every((o) => o === base || o === apiBase), [...origins].join(', '));
  check('no page errors were thrown', page.exceptions.length === 0, page.exceptions.join(' | '));
  await page.resize(390, 800, true);
  await new Promise((r) => setTimeout(r, 400));
  const narrow = await ev("({ w: document.documentElement.scrollWidth, panel: document.querySelector('.kdb-panel').getBoundingClientRect().width, toggle: document.querySelector('.kdb-toggle').getBoundingClientRect().right })");
  check('at 390 px wide: no sideways scroll, the panel fits with a gutter', narrow.w <= 390 && narrow.panel <= 358.5 && narrow.toggle <= 390, JSON.stringify(narrow));
  await page.shot(path.join(SHOTS, 'narrow.png'));

  console.log('\n[7] the microphone: say what to build (Chrome\'s fake microphone, a stand-in /api/transcribe, no model)');
  const mic = await chrome.open(`${base}/kip/tools/describe-harness.html?stepMs=300&transcribe=/api/transcribe&de=/api/describe`);
  const mev = (expr) => mic.evaluate(expr);
  await mic.waitFor('window.__describeReady === true', 180000);
  // watch the microphone from before anything is pressed: every request for it, and every track of every stream it gave
  await mev(`(() => { window.__gum = { calls: 0, streams: [], deny: false }; const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => { window.__gum.calls++; if (window.__gum.deny) throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); const s = await real(c); window.__gum.streams.push(s); return s; }; })()`);
  const gum = () => mev('({ calls: window.__gum.calls, live: window.__gum.streams.flatMap((s) => s.getTracks()).filter((t) => t.readyState === "live").length, total: window.__gum.streams.flatMap((s) => s.getTracks()).length })');
  const micBtn = '.kdb-mic';
  const micStatus = () => mev("document.querySelector('.kdb-status').textContent");
  const micState = () => mev(`document.querySelector('${micBtn}').getAttribute('aria-pressed') === 'true' ? 'listening' : document.querySelector('${micBtn}').disabled ? 'thinking' : 'idle'`);
  const rect = () => mev(`(() => { const r = document.querySelector('${micBtn}').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, left: r.left, right: r.right, top: r.top, bottom: r.bottom }; })()`);
  const boxText = () => mev("document.querySelector('#kdb-text').value");
  const nap = (ms) => new Promise((r) => setTimeout(r, ms));
  const settled = (n) => mic.waitFor(`document.querySelector('${micBtn}') && !document.querySelector('${micBtn}').disabled && document.querySelector('${micBtn}').getAttribute('aria-pressed') === 'false'`, 20000, 100).then(() => transcribe.posts.length >= n || nap(300).then(() => transcribe.posts.length >= n));
  const describeCalls = () => describeStub.seen.length;

  check('the panel opened and asked the route once, for free', transcribe.probes >= 1 && transcribe.posts.length === 0, `${transcribe.probes} probes, ${transcribe.posts.length} posts`);
  check('the 🎤 button is there, labelled, and sits beside the text box on the right', await mic.waitFor(`!document.querySelector('${micBtn}').hidden`, 10000) && (await mev(`document.querySelector('${micBtn}').getAttribute('aria-label')`)) === 'Say what to build'
    && await mev(`(() => { const m = document.querySelector('${micBtn}').getBoundingClientRect(), t = document.querySelector('#kdb-text').getBoundingClientRect(); return m.left >= t.right - 1 && m.top >= t.top - 1 && m.top <= t.bottom; })()`));
  const r0 = await rect();
  check('it is a real touch target: round, at least 44 px each way', r0.w >= 44 && r0.h >= 44 && Math.abs(r0.w - r0.h) < 1, JSON.stringify(r0));
  check('NOTHING was recorded and the microphone was not even asked for before a press', (await gum()).calls === 0 && transcribe.posts.length === 0);
  await mic.shot(path.join(SHOTS, 'microphone-idle.png'));

  // a TAP: start, speak for a second and a half, tap again
  const buildsBefore = describeCalls();
  await mic.click(r0.x, r0.y);
  check('a tap starts listening: the microphone was asked for once, the button says Stop and the status invites speech', await mic.waitFor(`document.querySelector('${micBtn}').getAttribute('aria-pressed') === 'true'`, 15000, 50) && (await gum()).calls === 1 && (await mev(`document.querySelector('${micBtn}').getAttribute('aria-label')`)) === 'Stop listening' && /Listening/.test(await micStatus()), await micStatus());
  check('while listening the microphone is live and nothing has been sent', (await gum()).live >= 1 && transcribe.posts.length === 0);
  await mic.shot(path.join(SHOTS, 'microphone-listening.png'));
  await nap(1500);
  await mic.click(r0.x, r0.y);
  check('the second tap sends exactly one recording', await settled(1) && transcribe.posts.length === 1, JSON.stringify(transcribe.posts));
  const clip = transcribe.posts[0];
  check('it is a real recording sent as a WAV: audio/wav, the file\'s own first bytes (RIFF), mono 16-bit PCM at 16 kHz (what Meta\'s endpoint and our own model both take), made in the page from Chrome\'s recording', clip.type === 'audio/wav' && clip.bytes > 1500 && clip.head.join() === '82,73,70,70' && clip.wav && clip.wav.channels === 1 && clip.wav.rate === 16000 && clip.wav.bits === 16 && clip.wav.seconds > 0.3 && clip.wav.seconds <= 10, JSON.stringify(clip));
  check('the words are in the text box for the child to see and change', (await boxText()) === 'a pink skateboard', await boxText());
  check('and the status says what it heard and tells the child to press Build it', /I heard: "a pink skateboard"/.test(await micStatus()) && /Build it/.test(await micStatus()), await micStatus());
  check('it did NOT build: no request to /api/describe was made, and the box has focus for editing', describeCalls() === buildsBefore && (await mev("document.activeElement && document.activeElement.id")) === 'kdb-text');
  check('every microphone track was stopped (none live) and the button is back to idle', (await gum()).live === 0 && (await micState()) === 'idle', JSON.stringify(await gum()));
  await mic.shot(path.join(SHOTS, 'microphone-heard.png'));

  // the child may edit and then press Build it: only then does anything build
  await mev("document.querySelector('.kdb-go').click()");
  check('only the child\'s own press of Build it builds: now one /api/describe request is made, with the words in the box', await mic.waitFor(`window.__describe.view && window.__describe.view.meshes.length > 0`, 180000) && describeCalls() === buildsBefore + 1 && JSON.stringify(describeStub.seen.at(-1)).includes('a pink skateboard'), JSON.stringify(describeStub.seen.at(-1)));

  // HOLD: press, hold for a second, let go
  const holdBefore = transcribe.posts.length;
  await mic.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r0.x, y: r0.y });
  await mic.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r0.x, y: r0.y, button: 'left', clickCount: 1 });
  check('a press starts listening', await mic.waitFor(`document.querySelector('${micBtn}').getAttribute('aria-pressed') === 'true'`, 15000, 50));
  await nap(1300);
  await mic.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r0.x, y: r0.y, button: 'left', clickCount: 1 });
  check('letting go of a held press stops it and sends the recording (hold to talk)', await settled(holdBefore + 1) && transcribe.posts.length === holdBefore + 1 && (await gum()).live === 0, `${transcribe.posts.length - holdBefore} sent`);

  // the 8 second limit (the harness shortens nothing: this is the real limit)
  const capBefore = transcribe.posts.length;
  await mic.click(r0.x, r0.y);
  await mic.waitFor(`document.querySelector('${micBtn}').getAttribute('aria-pressed') === 'true'`, 15000, 50);
  const t0 = Date.now();
  check('left alone it stops by itself after 8 seconds and sends what it has', await mic.waitFor(`document.querySelector('${micBtn}').getAttribute('aria-pressed') === 'false'`, 20000, 100) && Date.now() - t0 >= 7500 && Date.now() - t0 < 12000 && await settled(capBefore + 1), `${Date.now() - t0} ms, ${transcribe.posts.length - capBefore} sent`);

  // a slip of the finger: tap and tap again at once
  const slipBefore = transcribe.posts.length;
  await mic.click(r0.x, r0.y);
  await mic.waitFor(`document.querySelector('${micBtn}').getAttribute('aria-pressed') === 'true'`, 15000, 50);
  await mic.click(r0.x, r0.y);
  await nap(600);
  check('two taps in a blink (a slip of the finger) send nothing, say so kindly and free the microphone', transcribe.posts.length === slipBefore && /short/.test(await micStatus()) && (await gum()).live === 0 && (await micState()) === 'idle', await micStatus());

  // the child types while it listens: their words are kept
  await mev("document.querySelector('#kdb-text').value = ''");
  await mic.click(r0.x, r0.y);
  await mic.waitFor(`document.querySelector('${micBtn}').getAttribute('aria-pressed') === 'true'`, 15000, 50);
  await mev("document.querySelector('#kdb-text').value = 'a green truck'");
  await nap(1200);
  const typedBefore = transcribe.posts.length;
  await mic.click(r0.x, r0.y);
  await settled(typedBefore + 1);
  check('if the child types while it listens, what they typed is kept and the status says what it heard', (await boxText()) === 'a green truck' && /I heard: "a pink skateboard"/.test(await micStatus()) && /left your words/.test(await micStatus()), `${await boxText()} | ${await micStatus()}`);

  // words the route withheld
  transcribe.body = { text: '', note: 'I could not use that. Try saying it a different way!' };
  await mev("document.querySelector('#kdb-text').value = ''");
  await mic.click(r0.x, r0.y);
  await mic.waitFor(`document.querySelector('${micBtn}').getAttribute('aria-pressed') === 'true'`, 15000, 50);
  await nap(1200);
  const withheldBefore = transcribe.posts.length;
  await mic.click(r0.x, r0.y);
  await settled(withheldBefore + 1);
  check('words the route withheld show its kind note and leave the box empty', (await boxText()) === '' && /different way/.test(await micStatus()), `${await boxText()} | ${await micStatus()}`);
  transcribe.body = { text: 'a pink skateboard' };

  // an upload that fails
  transcribe.status = 502;
  await mic.click(r0.x, r0.y);
  await mic.waitFor(`document.querySelector('${micBtn}').getAttribute('aria-pressed') === 'true'`, 15000, 50);
  await nap(1200);
  const failBefore = transcribe.posts.length;
  await mic.click(r0.x, r0.y);
  await settled(failBefore + 1);
  check('a failed upload says so kindly, leaves the box alone, frees the microphone and is ready to try again', /could not hear/.test(await micStatus()) && (await gum()).live === 0 && (await micState()) === 'idle', await micStatus());
  transcribe.status = 200;

  // permission refused
  await mev('window.__gum.deny = true');
  const callsBefore = (await gum()).calls, postsBefore = transcribe.posts.length;
  await mic.click(r0.x, r0.y);
  await nap(500);
  check('a refused microphone says so kindly, sends nothing and is ready to try again', /grown-up/.test(await micStatus()) && transcribe.posts.length === postsBefore && (await gum()).calls === callsBefore + 1 && (await micState()) === 'idle', await micStatus());
  await mev('window.__gum.deny = false');

  // keyboard: focus the button and press Enter
  await mev(`document.querySelector('${micBtn}').focus()`);
  for (const type of ['keyDown', 'keyUp']) await mic.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, ...(type === 'keyDown' ? { text: '\r' } : {}) });   // a real Enter (the helper sends no text for named keys, and a button's click comes from the keypress)
  check('the keyboard works: Enter on the focused button starts listening', await mic.waitFor(`document.querySelector('${micBtn}').getAttribute('aria-pressed') === 'true'`, 15000, 50));
  // closing the panel mid-recording throws it away
  const closeBefore = transcribe.posts.length;
  await mic.key('Escape', 'Escape');
  await nap(600);
  check('closing the panel while listening sends nothing and frees the microphone', transcribe.posts.length === closeBefore && (await gum()).live === 0 && await mev("document.querySelector('.kdb-panel').hidden"), JSON.stringify(await gum()));
  check('the voice left nothing behind in this browser: no storage keys mention audio, voice or the words', await mev("[...Object.keys(localStorage), ...Object.keys(sessionStorage)].every((k) => !/audio|voice|record|transcri|speech/i.test(k)) && ![...Object.keys(localStorage), ...Object.keys(sessionStorage)].some((k) => /pink skateboard/.test(localStorage.getItem(k) || sessionStorage.getItem(k) || ''))"));
  check('and the page talked only to its own server for all of it', await mev(`true`) && [...new Set(mic.requests.map((r) => { try { return new URL(r.url).origin; } catch { return r.url.slice(0, 5); } }))].every((o) => o === base || o.startsWith('data') || o.startsWith('blob')), [...new Set(mic.requests.map((r) => r.url.slice(0, 40)))].slice(0, 5).join(', '));
  check('no page errors in the microphone page', mic.exceptions.length === 0, mic.exceptions.join(' | '));

  // the route off: the button is not there at all
  transcribe.enabled = false;
  const off = await chrome.open(`${base}/kip/tools/describe-harness.html?stepMs=300&transcribe=/api/transcribe`);
  await off.waitFor('window.__describeReady === true', 180000);
  await nap(800);
  check('with the route off the button is hidden, the microphone is never asked for, and the box works as it always did', await off.evaluate(`document.querySelector('.kdb-mic').hidden`) && await off.evaluate(`!document.querySelector('.kdb-mic').offsetParent`) && (await off.evaluate(`document.querySelector('#kdb-text') !== null`)));
  // and the harness without the parameter has no probe and no button behaviour at all
  const probesNow = transcribe.probes;
  const plain = await chrome.open(`${base}/kip/tools/describe-harness.html?stepMs=300`);
  await plain.waitFor('window.__describeReady === true', 180000);
  await nap(500);
  check('a page that does not set the route never asks (no button element, no probe)', transcribe.probes === probesNow && (await plain.evaluate(`document.querySelector('.kdb-mic') === null`)));
  transcribe.enabled = true;

  console.log(`\n  screenshots: ${SHOTS}`);
} catch (e) {
  console.log(`  FAIL unexpected error: ${e.stack ?? e}`);
  code = 1;
} finally {
  finish();
  chrome.close(); web.close(); api.close();
  process.exit(process.exitCode || code);
}
