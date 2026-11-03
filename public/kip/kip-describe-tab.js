// Describe & build: the tab. A self-contained floating panel plus its own toggle button, so a host page needs only one call:
//
//   const describeTab = mountDescribe({ THREE, STLLoader, mergeVertices, toCreasedNormals, scene, camera, controls,
//                                       setCharacterVisible: (on) => { ... } });
//
// Type what you want, press Build, and the recipe is drawn assembled; the slider spreads it into an exploded view. While the panel is open the host's
// own character is hidden (setCharacterVisible) so the two never share the scene. The panel never holds a key: a model, if any, sits behind the
// endpoint address the user pastes in Settings (tools/describe-endpoint.mjs); without one the page answers from its sample builds.
// See kip-describe-contract.md.
import { describe, loadRecipeBook } from './kip-describe.js';
import { loadPartsData } from './kip-describe-validate.js';
import { createDescribeView, partColour } from './kip-describe-view.js';

const STORE_KEY = 'kipDescribeEndpoint';

// "Say what it is": the same setting and the same voice as the game's props. This page is served from the app's own origin, so the
// language picked in the game's menu is read from the same localStorage key, and the picker below writes it back.
const LANG_KEY = 'toyforge:prop-lang:v1';
const LANGS = [['en', 'English'], ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch'], ['it', 'Italiano'], ['pt', 'Português'], ['tr', 'Türkçe'], ['off', 'Off']];
const lang = {
  get() { try { const v = globalThis.localStorage?.getItem(LANG_KEY); return LANGS.some(([c]) => c === v) ? v : 'en'; } catch { return 'en'; } },
  set(v) { try { globalThis.localStorage?.setItem(LANG_KEY, v); } catch { /* storage blocked: the choice holds for this session only */ } },
};
const SOURCE_LABEL = { model: 'Built by the model', 'recipe-book': 'A sample build', closest: 'Nearest sample build' };

const CSS = `
.kdb-toggle { position: fixed; right: 16px; bottom: 16px; z-index: 40; border: 0; border-radius: 999px; padding: 10px 16px; font: 600 14px/1 system-ui, sans-serif;
  background: #1b2238; color: #fff; cursor: pointer; box-shadow: 0 6px 18px rgba(27,34,56,.28); }
.kdb-toggle:focus-visible, .kdb-panel button:focus-visible, .kdb-panel textarea:focus-visible, .kdb-panel input:focus-visible { outline: 3px solid #ff6b4a; outline-offset: 2px; }
.kdb-panel { position: fixed; right: 16px; top: 64px; z-index: 41; width: min(340px, calc(100vw - 32px)); max-height: calc(100vh - 64px - 72px); overflow: auto; box-sizing: border-box;
  padding: 14px 16px 16px; border-radius: 16px; background: rgba(255,255,255,.94); color: #1b2238; font: 14px/1.4 system-ui, sans-serif;
  backdrop-filter: blur(10px); box-shadow: 0 10px 34px rgba(27,34,56,.22); }
.kdb-panel[hidden] { display: none; }
/* Room for a host's own chrome: the panel starts below a top bar and leaves the toggle visible; on a narrow screen the toggle rises above a bottom strip
   and the open panel becomes a bottom sheet that stops short of both that strip and a host's bottom-left button (it scrolls inside; its own Close
   button, and Escape, dismiss it). */
@media (max-width: 900px) { .kdb-toggle { bottom: 52px; } }
@media (max-width: 640px) { .kdb-panel { top: auto; bottom: 96px; left: 16px; right: 16px; width: auto; max-height: min(72vh, calc(100vh - 286px)); } }
/* the host's "hide UI" key (H) adds this class to the container (or any ancestor of it) */
.clean-ui .kdb-toggle, .clean-ui .kdb-panel { display: none !important; }
.kdb-panel h2 { margin: 0 0 8px; font-size: 16px; display: flex; justify-content: space-between; align-items: center; }
.kdb-panel textarea { width: 100%; box-sizing: border-box; resize: vertical; min-height: 54px; padding: 8px 10px; border: 1px solid #c9cfdc; border-radius: 10px; font: inherit; }
.kdb-panel button { font: 600 13px/1 system-ui, sans-serif; border: 1px solid #c9cfdc; background: #fff; color: #1b2238; border-radius: 999px; padding: 8px 12px; cursor: pointer; }
.kdb-panel button.kdb-go { background: #ff6b4a; border-color: #ff6b4a; color: #fff; margin-top: 8px; }
.kdb-panel button[disabled] { opacity: .55; cursor: progress; }
.kdb-examples { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.kdb-examples button { font-weight: 500; padding: 5px 9px; white-space: normal; text-align: left; }
/* A host's global "button { transition: all ...; white-space: nowrap }" (Kip-Demo has one) must not leak in: it would slide the toggle whenever its position changes. */
.kdb-toggle, .kdb-panel, .kdb-panel * { transition: none; }
.kdb-status { margin: 10px 0 4px; min-height: 1.4em; }
.kdb-badge { display: inline-block; margin: 2px 0 6px; padding: 3px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; }
.kdb-badge.ok { background: #d9f3e8; color: #0d6b48; } .kdb-badge.warn { background: #ffe9c2; color: #8a5200; }
.kdb-build { margin: 8px 0 2px; } .kdb-controls { display: flex; flex-wrap: wrap; gap: 6px; } .kdb-progress { margin: 6px 0 0; font-size: 13px; min-height: 1.3em; }
.kdb-slider { display: block; margin: 10px 0 6px; font-weight: 600; } .kdb-slider input { width: 100%; margin-top: 4px; }
.kdb-slider.locked { opacity: .5; }
.kdb-lang { display: flex; align-items: center; gap: 8px; margin: 10px 0 0; font-weight: 600; } .kdb-lang select { font: inherit; padding: 4px 6px; border-radius: 8px; }
.kdb-caption { margin: 6px 0 0; min-height: 1.3em; font-weight: 700; }
.kdb-steps { margin: 6px 0 0; padding-left: 22px; } .kdb-steps li { padding: 2px 4px; border-radius: 6px; cursor: pointer; }
.kdb-steps li:hover, .kdb-steps li.on { background: #eef1f7; }
.kdb-panel details { margin-top: 10px; font-size: 13px; } .kdb-panel details input { width: 100%; box-sizing: border-box; margin: 6px 0; padding: 7px 9px; border: 1px solid #c9cfdc; border-radius: 8px; font: inherit; }
.kdb-panel code { background: #eef1f7; padding: 1px 5px; border-radius: 5px; font-size: 12px; word-break: break-all; }
@media (prefers-color-scheme: dark) {
  .kdb-panel { background: rgba(27,34,56,.94); color: #f4efe6; } .kdb-panel textarea, .kdb-panel details input { background: #121829; color: #f4efe6; border-color: #3b4560; }
  .kdb-panel button { background: #26304a; color: #f4efe6; border-color: #3b4560; } .kdb-panel button.kdb-go { background: #ff6b4a; border-color: #ff6b4a; color: #fff; }
  .kdb-steps li:hover, .kdb-steps li.on { background: #26304a; } .kdb-panel code { background: #26304a; }
}
@media (prefers-reduced-motion: reduce) { .kdb-panel, .kdb-toggle { transition: none; } }
/* the waiting state: a little workshop (conveyor belt, bricks that come and go, a parts pile that fills) */
.kdb-workshop { position: relative; height: 86px; margin: 10px 0 2px; border-radius: 12px; overflow: hidden; background: linear-gradient(#f3f5fa, #e1e6f0); box-shadow: inset 0 0 0 1px #c9cfdc; transition: opacity .35s; }
.kdb-workshop[hidden] { display: none; }
.kdb-workshop.kdb-done { opacity: 0; }
.kdb-lane { position: absolute; left: 0; right: 112px; bottom: 26px; height: 24px; }
.kdb-brick { position: absolute; bottom: 0; left: -64px; line-height: 0; animation: kdb-ride var(--d, 4s) linear forwards; transition: transform .22s, opacity .22s; }
.kdb-brick .kdb-bi { display: block; line-height: 0; }
.kdb-brick.kdb-poof { transform: translateY(-14px) scale(.2); opacity: 0; }
.kdb-brick.kdb-drop .kdb-bi { animation: kdb-fall .42s ease-in forwards; }
.kdb-brick.kdb-static { animation: none; }
@keyframes kdb-ride { from { transform: translateX(0); } to { transform: translateX(var(--run, 230px)); } }
@keyframes kdb-fall { to { transform: translate(24px, 44px) rotate(48deg); opacity: 0; } }
.kdb-belt { position: absolute; left: 0; right: 100px; bottom: 8px; height: 18px; border-radius: 9px; background: repeating-linear-gradient(90deg, #3b4560 0 12px, #4a5575 12px 24px); box-shadow: inset 0 -3px 0 rgba(0,0,0,.28), 0 2px 0 #1b2238; animation: kdb-belt .5s linear infinite; }
.kdb-done .kdb-belt { animation-play-state: paused; }
@keyframes kdb-belt { to { background-position-x: 24px; } }
.kdb-pile { position: absolute; right: 8px; bottom: 6px; width: 92px; height: 66px; }
.kdb-pb { position: absolute; line-height: 0; opacity: 0; transform: scale(.3); transition: opacity .18s, transform .3s cubic-bezier(.3, 1.7, .5, 1); }
.kdb-pb.on { opacity: 1; transform: none; }
@media (prefers-color-scheme: dark) { .kdb-workshop { background: linear-gradient(#26304a, #1b2238); box-shadow: inset 0 0 0 1px #3b4560; } }
@media (prefers-reduced-motion: reduce) { .kdb-belt, .kdb-brick, .kdb-brick .kdb-bi { animation: none !important; } .kdb-pb, .kdb-workshop { transition: none; } }
`;

// ---- the waiting state -----------------------------------------------------------------------------------------------------
// The model takes a few seconds (4 to 10 with Muse) and nothing tells us how far along it is, so this is honest about being a pastime, not a progress
// report: a conveyor belt carries random common bricks that appear, sometimes pop away, and drop into a parts pile; the pile fills on a gentle curve
// that holds the last two bricks back until the real answer arrives; the words change every few seconds. Nothing shows if the answer is quick. With
// reduced motion the belt is still and the bricks sit on it; the pile still counts up. It never touches the 3D scene.
const BRICK_COLOURS = ['#FF5A4D', '#52B7FF', '#FFD24D', '#2FAE7E', '#FF9D5C', '#A78BFF', '#F4EFE6'];
const THINK_LINES = [[0, 'Looking through the parts bin…'], [3, 'Sorting the bricks…'], [6, 'Finding parts that fit…'], [10, 'Still looking, thank you for waiting…']];
const DRAW_LINES = [[0, 'Laying out the parts…'], [6, 'Almost there…']];
const LOAD_LINES = [[0, 'Loading the part list…']];
const PILE_SPOTS = [[0, 0], [1, 0], [2, 0], [3, 0], [0.5, 1], [1.5, 1], [2.5, 1], [1, 2], [2, 2], [1.5, 3]];   // a pyramid: (column, row), bottom row first
const PILE_HELD_BACK = 2;                                                                                           // bricks the curve never reaches before the answer

/** A little brick (studs 1 to 4) or a wheel (studs 0), as inline SVG. Static strings only: nothing the user typed ever gets near innerHTML. */
const brickSvg = (studs, colour, scale = 1) => {
  if (studs === 0) return `<svg viewBox="0 0 20 20" width="${20 * scale}" height="${20 * scale}" aria-hidden="true"><circle cx="10" cy="10" r="9.5" fill="#262D40"/><circle cx="10" cy="10" r="4.6" fill="${colour}"/><circle cx="10" cy="10" r="1.6" fill="#262D40"/></svg>`;
  const w = studs * 11, bumps = Array.from({ length: studs }, (_, i) => `<rect x="${i * 11 + 2.5}" y="0" width="6" height="4" rx="2" fill="${colour}"/>`).join('');
  return `<svg viewBox="0 0 ${w} 16" width="${w * scale}" height="${16 * scale}" aria-hidden="true">${bumps}<rect x="0" y="3" width="${w}" height="13" rx="2.5" fill="${colour}"/><rect x="0" y="3" width="${w}" height="4" rx="2.5" fill="#fff" opacity=".3"/><rect x="0" y="12" width="${w}" height="4" rx="2.5" fill="#000" opacity=".17"/></svg>`;
};
const pick = (list) => list[Math.floor(Math.random() * list.length)];

function createWorkshop({ onLabel = () => {} } = {}) {
  const reducedMotion = () => Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const node = el('div', { class: 'kdb-workshop', 'aria-hidden': 'true', hidden: '' });
  const lane = el('div', { class: 'kdb-lane' });
  const belt = el('div', { class: 'kdb-belt' });
  const pile = el('div', { class: 'kdb-pile' });
  const pbs = PILE_SPOTS.map(([c, r], i) => {
    const b = el('span', { class: 'kdb-pb' });
    b.innerHTML = brickSvg(2, BRICK_COLOURS[i % BRICK_COLOURS.length], 0.9);
    b.style.left = `${c * 21}px`; b.style.bottom = `${r * 14}px`;
    pile.append(b);
    return b;
  });
  node.append(lane, belt, pile);
  let timers = [], t0 = 0, lines = THINK_LINES, line = -1, active = false, hideTimer = 0;
  const later = (fn, ms) => { const id = setTimeout(fn, ms); timers.push(id); return id; };
  const setPile = (n) => pbs.forEach((b, i) => b.classList.toggle('on', i < n));

  function spawn() {
    if (!active || lane.children.length >= 6) return;
    const studs = pick([0, 1, 2, 2, 3, 4]), colour = pick(BRICK_COLOURS), dur = 3000 + Math.random() * 1700;
    const outer = el('span', { class: 'kdb-brick' }), inner = el('span', { class: 'kdb-bi' });
    inner.innerHTML = brickSvg(studs, colour, 1);
    outer.append(inner);
    outer.style.setProperty('--d', `${dur}ms`);
    outer.addEventListener('animationend', (e) => {
      if (e.target !== outer) return;
      outer.classList.add('kdb-drop');
      setTimeout(() => outer.remove(), 450);
    });
    lane.append(outer);
    if (Math.random() < 0.35) later(() => { outer.classList.add('kdb-poof'); setTimeout(() => outer.remove(), 260); }, dur * (0.25 + Math.random() * 0.4));   // some bricks come and go mid-belt
  }
  function loop() { if (!active) return; spawn(); later(loop, 450 + Math.random() * 650); }
  function tick() {
    if (!active) return;
    const secs = (performance.now() - t0) / 1000;
    const want = [...lines].reverse().findIndex(([at]) => secs >= at);
    const i = want < 0 ? 0 : lines.length - 1 - want;
    if (i !== line) { line = i; onLabel(lines[i][1]); }
    setPile(Math.min(PILE_SPOTS.length - PILE_HELD_BACK, Math.floor(PILE_SPOTS.length * (1 - Math.exp(-secs / 5.5)))));
    later(tick, 250);
  }
  function clear() { timers.forEach(clearTimeout); timers = []; clearTimeout(hideTimer); lane.replaceChildren(); }

  return {
    node,
    /** Begin waiting. `delayMs`: stay invisible this long so a quick answer never flashes it. The label starts at once. */
    start({ lines: l = THINK_LINES, delayMs = 350 } = {}) {
      clear(); active = true; lines = l; line = -1; t0 = performance.now();
      node.classList.remove('kdb-done'); setPile(0);
      tick();
      later(() => {
        if (!active) return;
        node.hidden = false;
        node.style.setProperty('--run', `${lane.clientWidth + 64}px`);
        if (reducedMotion()) { [0.12, 0.42, 0.72].forEach((f, i) => { const o = el('span', { class: 'kdb-brick kdb-static' }); o.innerHTML = brickSvg([2, 4, 0][i], BRICK_COLOURS[i * 2], 1); o.style.left = `${f * lane.clientWidth}px`; lane.append(o); }); }
        else loop();
      }, delayMs);
    },
    /** Switch the wording (and restart its clock) without resetting the pile, e.g. from thinking to drawing. */
    setLines(l) { lines = l; line = -1; t0 = performance.now(); },
    /** Stop waiting. With `finished` the pile completes and the strip fades out; otherwise it just goes. */
    stop({ finished = false } = {}) {
      active = false; timers.forEach(clearTimeout); timers = [];
      if (!node.hidden && finished) {
        setPile(PILE_SPOTS.length); node.classList.add('kdb-done');
        hideTimer = setTimeout(() => { node.hidden = true; lane.replaceChildren(); node.classList.remove('kdb-done'); }, 450);
      } else { node.hidden = true; lane.replaceChildren(); }
    },
    get visible() { return !node.hidden; },
  };
}

const store = {
  get() { try { return globalThis.sessionStorage?.getItem(STORE_KEY) ?? ''; } catch { return ''; } },
  set(v) { try { globalThis.sessionStorage?.setItem(STORE_KEY, v); } catch { /* storage blocked: the field simply forgets */ } },
};

const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v); }
  n.append(...kids);
  return n;
};

export function mountDescribe({
  THREE, STLLoader, mergeVertices, toCreasedNormals, scene, camera, controls,
  setCharacterVisible = () => {}, container = document.body, endpoint = '',
  recipeUrl = '/kip/kip-describe-recipes.json', partsUrl = '/kip/kip-describe-parts.json', stlBase = '/kip/partspec/describe/', fetchImpl = globalThis.fetch,
  stepMs = 1100,   // how long each step of a playing build takes
  voiceUrl = '/api/voice',   // the game's "say what it is" route; absent (a plain static server) means captions only
  defaultEndpoint = '/api/describe',   // the app's own route (Muse picks a checked build); used when the Settings address is empty; '' turns it off
}) {
  if (!document.getElementById('kdb-style')) document.head.append(el('style', { id: 'kdb-style' }, CSS));
  let book = null, parts = null, view = null, loading = null, busy = false, last = null, isOpen = false;
  // the build player: progress p runs from 0 (nothing seated) to n (finished), one unit per step; `target` is where a playing build stops
  let n = 0, p = 0, target = 0, playing = false, raf = 0, lastFrame = 0;
  let camSaved = null;   // the host camera (position and orbit target) from when the panel opened
  let voiceAudio = null, voiceDownUntil = 0, voiceSeq = 0, spokenStep = -1;   // the part voice: current clip, back-off after a failure, newest-tap-wins counter, last step spoken while playing

  const text = el('textarea', { id: 'kdb-text', maxlength: '300', rows: '2', placeholder: 'For example: a race car, or Kip with a cowboy hat' });
  const go = el('button', { class: 'kdb-go', type: 'button' }, 'Build it');
  const examples = el('div', { class: 'kdb-examples', role: 'group', 'aria-label': 'Examples' });
  const status = el('p', { class: 'kdb-status', role: 'status', 'aria-live': 'polite' }, 'Say what you would like to build.');
  const workshop = createWorkshop({ onLabel: (msg) => { status.textContent = msg; } });
  const badge = el('span', { class: 'kdb-badge', hidden: '' });
  const playBtn = el('button', { type: 'button' }, 'Play build');
  const backBtn = el('button', { type: 'button', 'aria-label': 'Back one step' }, 'Back');
  const nextBtn = el('button', { type: 'button', 'aria-label': 'Next step' }, 'Next');
  const replayBtn = el('button', { type: 'button' }, 'Replay');
  const progress = el('p', { class: 'kdb-progress', role: 'status', 'aria-live': 'polite' }, '');
  const buildBox = el('div', { class: 'kdb-build', role: 'group', 'aria-label': 'Build animation', hidden: '' },
    el('div', { class: 'kdb-controls' }, backBtn, playBtn, nextBtn, replayBtn), progress);
  const slider = el('input', { type: 'range', min: '0', max: '100', value: '0', 'aria-label': 'Exploded view' });
  const sliderBox = el('label', { class: 'kdb-slider', hidden: '' }, 'Exploded view', slider);
  const list = el('ol', { class: 'kdb-steps', 'aria-label': 'Build steps' });
  const langSel = el('select', { id: 'kdb-lang', 'aria-label': 'Language for part names' }, ...LANGS.map(([c, name]) => el('option', { value: c }, name)));
  langSel.value = lang.get();
  const langBox = el('label', { class: 'kdb-lang' }, 'Words in', langSel);
  const caption = el('p', { class: 'kdb-caption', role: 'status', 'aria-live': 'polite' }, '');
  const epInput = el('input', { type: 'url', id: 'kdb-endpoint', placeholder: 'http://127.0.0.1:8788/describe', value: endpoint || store.get(), 'aria-label': 'Model endpoint address' });
  const epNote = el('p', {}, '');
  const test = el('button', { type: 'button' }, 'Test connection');
  const settings = el('details', {}, el('summary', {}, 'Settings: model endpoint (optional)'), epInput, test, epNote,
    el('p', {}, 'With no address, the app asks its own server, which asks Muse to pick the sample build that fits your words (in any language). If that is not available the page matches your words to the sample builds itself. To let a language model design a NEW build instead, start the local endpoint with ', el('code', {}, 'node parts/kip/viewer/tools/describe-endpoint.mjs'),
      ' and paste the address it prints. The page never holds a key: the server and the endpoint read it from your own .dev.vars.'),
    el('p', {}, 'What is sent: with an address, your description and the list of part names go only to that address. With no address, your description (phone numbers and emails removed first) goes to the app\'s server and on to Muse, only to pick a build. Nothing is stored except that address, and only for this browser tab.'));
  const close = el('button', { type: 'button', 'aria-label': 'Close' }, 'Close');
  const panel = el('section', { class: 'kdb-panel', 'aria-label': 'Describe and build', hidden: '' }, el('h2', {}, 'Describe & build', close),
    el('label', { for: 'kdb-text' }, 'What should we build?'), text, examples, go, status, workshop.node, badge, buildBox, sliderBox, langBox, list, caption, settings);
  const toggle = el('button', { class: 'kdb-toggle', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'kdb-panel' }, 'Describe & build');
  panel.id = 'kdb-panel';
  container.append(toggle, panel);
  // typing here must not trigger the host's single-key shortcuts
  for (const type of ['keydown', 'keyup', 'keypress']) panel.addEventListener(type, (e) => e.stopPropagation());

  const label = (part) => parts?.parts?.[part]?.label ?? part;
  const say = (msg) => { status.textContent = msg; };

  // ---- say the part ("blue car chassis", "rueda deportiva negra") ---------------------------------------------------------
  function stopVoice() { if (voiceAudio) { try { voiceAudio.pause(); } catch { /* already stopped */ } voiceAudio = null; } }
  /** Caption + spoken name of step i, in the chosen language, in the colour the view draws it. Falls back to the English label. */
  async function sayPart(i) {
    const part = last?.steps?.[i]?.part;
    const l = lang.get();
    stopVoice();
    const seq = ++voiceSeq;                                             // a newer tap always wins
    if (!part || !parts) return;
    if (l === 'off') { caption.textContent = ''; return; }
    if (Date.now() < voiceDownUntil) { caption.textContent = label(part); return; }   // the voice route failed a moment ago: just the caption
    try {
      const q = new URLSearchParams({ lang: l, p: part, hex: partColour(parts, part).slice(1) });
      const res = await fetchImpl(`${voiceUrl}?${q}`);
      if (!res.ok) throw new Error(String(res.status));
      const spoken = decodeURIComponent(res.headers.get('x-voice-text') ?? '');
      const blob = await res.blob();
      if (seq !== voiceSeq) return;
      caption.textContent = spoken || label(part);
      const url = URL.createObjectURL(blob);
      voiceAudio = new Audio(url);
      voiceAudio.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true });
      voiceAudio.play().catch(() => { /* the browser blocked autoplay: the caption is there */ });
    } catch {
      voiceDownUntil = Date.now() + 60000;
      if (seq === voiceSeq) caption.textContent = label(part);
    }
  }

  async function ready() {
    if (book && parts && view) return;
    loading ??= (async () => {
      workshop.start({ lines: LOAD_LINES, delayMs: 500 });
      try {
        [book, parts] = await Promise.all([loadRecipeBook(recipeUrl, fetchImpl), loadPartsData(partsUrl, fetchImpl)]);
        view = createDescribeView({ THREE, STLLoader, mergeVertices, toCreasedNormals, partsData: parts, base: stlBase });
        view.group.visible = isOpen;
        scene.add(view.group);
        for (const r of book.recipes) {
          examples.append(el('button', { type: 'button', title: r.title, onclick: () => { text.value = r.description; build(); } }, r.description));
        }
        workshop.stop({ finished: true });
        say('Say what you would like to build.');
      } catch (e) { workshop.stop(); throw e; }
    })().catch((e) => { loading = null; throw e; });
    await loading;
  }

  function renderSteps(result) {
    list.replaceChildren(...result.steps.map((s, i) => {
      const host = s.mate ? ` on the ${label(result.steps.find((x) => x.id === s.mate.host)?.part).toLowerCase()}` : ' (the base)';
      return el('li', { tabindex: '0', onmouseenter: () => view.highlight(i), onmouseleave: () => view.highlight(null), onfocus: () => view.highlight(i), onblur: () => view.highlight(null),
        onclick: () => sayPart(i), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sayPart(i); } } },
        `${label(s.part)}${host}`);
    }));
  }

  // ---- the build player -------------------------------------------------------------------------------------------------
  const reduced = () => Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const stepName = (i) => list.children[i]?.textContent ?? '';

  /** Words and enabled/disabled state for progress p; does not move any part. */
  function labels() {
    const cur = p <= 0 ? -1 : Math.min(n, Math.ceil(p - 1e-9)) - 1;      // the step whose slot we are in
    [...list.children].forEach((li, i) => li.classList.toggle('on', i === cur && p < n));
    view?.highlight(p > 0 && p < n ? cur : null);
    if (playing && cur >= 0 && cur !== spokenStep) { spokenStep = cur; sayPart(cur); }   // say each part as its turn begins
    if (!playing) spokenStep = -1;
    progress.textContent = p <= 0 ? `Ready: press Play build to watch all ${n} parts go together.`
      : p >= n ? `Built: all ${n} parts are seated.` : `Step ${cur + 1} of ${n}: ${stepName(cur)}`;
    backBtn.disabled = p <= 0;
    nextBtn.disabled = p >= n;
    playBtn.textContent = playing ? 'Pause' : (p > 0 && p < n ? 'Resume' : 'Play build');
    slider.disabled = p < n || playing;                                     // the exploded view is for a finished build
    sliderBox.classList.toggle('locked', slider.disabled);
  }
  function showBuild() { view.setBuild(p, { motion: !reduced() }); labels(); }
  function stop() { playing = false; cancelAnimationFrame(raf); }
  function frame(now) {
    if (!playing) return;
    p = Math.min(target, p + Math.min(now - lastFrame, 100) / stepMs);       // a slow frame never skips a step
    lastFrame = now;
    if (p >= target) playing = false;
    showBuild();
    if (playing) raf = requestAnimationFrame(frame);
  }
  function playTo(to) {
    stop();
    target = Math.min(n, to);
    if (p >= target) { showBuild(); return; }
    playing = true; lastFrame = performance.now();
    showBuild();
    raf = requestAnimationFrame(frame);
  }
  const ready_ = () => Boolean(view?.plan) && n > 0;
  function play() { if (!ready_()) return; if (playing) { stop(); showBuild(); return; } if (p >= n) p = 0; slider.value = '0'; playTo(n); }
  function stepForward() { if (!ready_()) return; slider.value = '0'; playTo(Math.floor(p + 1e-9) + 1); }
  function stepBack() { if (!ready_()) return; stop(); p = Math.max(0, Math.ceil(p - 1e-9) - 1); slider.value = '0'; showBuild(); }
  function replay() { if (!ready_()) return; stop(); p = 0; slider.value = '0'; playTo(n); }

  async function build() {
    if (busy) return;
    const q = text.value.trim();
    if (!q) { say('Type what you would like to build first.'); text.focus(); return; }
    busy = true; go.disabled = true;
    try {
      await ready();
      workshop.start({ lines: THINK_LINES });   // the little workshop: bricks on a belt, a pile that fills (see createWorkshop)
      const ep = epInput.value.trim();
      store.set(ep);
      const useDefault = !ep && Boolean(defaultEndpoint);               // no address typed: try the app's own route, and fall back quietly if it is not there
      const result = await describe(q, { endpoint: ep || defaultEndpoint || undefined, quiet: useDefault, book, parts });
      last = result;
      badge.hidden = false;
      badge.className = `kdb-badge ${result.validated ? 'ok' : 'warn'}`;
      const sourceLabel = result.source === 'model' && useDefault ? 'Picked by Muse from the checked builds' : (SOURCE_LABEL[result.source] ?? result.source);
      badge.textContent = `${sourceLabel} · ${result.validated ? 'checked: every part fits' : 'not checked for fit'}`;
      stop();
      if (!result.poses) {
        view.clear(); list.replaceChildren(); sliderBox.hidden = true; buildBox.hidden = true; n = 0; p = 0;
        workshop.stop();
        say(`${result.note} It has no checked positions, so it is not drawn.`);
        return;
      }
      workshop.setLines(DRAW_LINES);
      await view.show(result);
      renderSteps(result);
      spokenStep = -1; caption.textContent = '';
      slider.value = '0';
      sliderBox.hidden = false;
      n = result.steps.length; p = n; target = n;                           // a new recipe is shown finished; Play build replays it from nothing
      buildBox.hidden = false;
      labels();
      view.frame(camera, controls);
      workshop.stop({ finished: true });
      say(`${result.title}. ${result.note}${result.clarifyingQuestion ? ` Question: ${result.clarifyingQuestion}` : ''}`);
    } catch (e) {
      workshop.stop();
      say(`Sorry, that did not work: ${e.message}`);
    } finally {
      busy = false; go.disabled = false;
    }
  }

  function open() {
    // The tab re-aims the host's camera at the drawing; remember where it was so closing puts the host's own scene back in view.
    camSaved = { pos: camera.position.clone(), target: controls?.target?.clone() };
    isOpen = true; panel.hidden = false; toggle.setAttribute('aria-expanded', 'true');
    if (view) { view.group.visible = true; if (view.plan) view.frame(camera, controls); }
    setCharacterVisible(false);
    ready().catch((e) => say(`Could not load the part list: ${e.message}`));
    text.focus();
  }
  function closePanel() {
    if (playing) { stop(); labels(); }
    stopVoice();
    isOpen = false; panel.hidden = true; toggle.setAttribute('aria-expanded', 'false');
    if (view) view.group.visible = false;
    if (camSaved) {
      camera.position.copy(camSaved.pos);
      if (camSaved.target) controls.target.copy(camSaved.target);
      controls?.update?.();
      camSaved = null;
    }
    setCharacterVisible(true);
    toggle.focus();
  }

  toggle.addEventListener('click', () => (isOpen ? closePanel() : open()));
  close.addEventListener('click', closePanel);
  go.addEventListener('click', build);
  text.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); build(); } });
  slider.addEventListener('input', () => { if (!ready_() || playing || p < n) return; view.setExplode(Number(slider.value) / 100); });
  playBtn.addEventListener('click', play);
  nextBtn.addEventListener('click', stepForward);
  backBtn.addEventListener('click', stepBack);
  replayBtn.addEventListener('click', replay);
  langSel.addEventListener('change', () => { lang.set(langSel.value); stopVoice(); if (langSel.value === 'off') caption.textContent = ''; else if (last?.steps?.length) sayPart(0); });   // choosing a language says the first part, as the preview
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePanel(); });
  test.addEventListener('click', async () => {
    const ep = epInput.value.trim();
    if (!ep) { epNote.textContent = 'No address: the sample builds will be used.'; return; }
    try {
      const h = await (await fetchImpl(ep.replace(/\/describe\/?$/, '/health'))).json();
      epNote.textContent = `Connected. Fit checker: ${h.validator ?? 'unknown'}.`;
    } catch { epNote.textContent = 'Could not reach that address.'; }
  });

  return {
    open, close: closePanel, build,
    get view() { return view; },
    get last() { return last; },
    get isOpen() { return isOpen; },
    setText(v) { text.value = v; },
    setExplode(t) { stop(); p = n; slider.value = String(Math.round(t * 100)); view?.setExplode(t); labels(); },
    /** Jump the build to progress x (0 to the number of steps) without playing; for tests and deep links. */
    setBuildProgress(x) { if (!ready_()) return; stop(); p = Math.min(n, Math.max(0, x)); slider.value = '0'; showBuild(); },
    play, pause() { if (playing) { stop(); labels(); } }, stepForward, stepBack, replay,
    sayPart,
    get language() { return lang.get(); },
    get caption() { return caption.textContent; },
    get progress() { return p; },
    get playing() { return playing; },
    ready,
    /** Unmount: hand the camera and the character back, stop the player, remove the toggle and panel (the shared <style> stays). */
    dispose() {
      stopVoice(); workshop.stop();
      if (isOpen) closePanel(); else stop();
      view?.dispose?.();
      toggle.remove(); panel.remove();
    },
  };
}
