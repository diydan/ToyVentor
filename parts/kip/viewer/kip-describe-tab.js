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
import { createWorkshop, THINK_LINES, DRAW_LINES, LOAD_LINES } from './kip-workshop-wait.js';   // the waiting state: belt, bricks, parts pile
import { createVoiceInput } from './kip-describe-voice.js';   // the microphone: say what to build (works when the app's /api/transcribe says it can listen; otherwise shown inert, saying why)
import { createThemeSong } from './kip-theme-song.js';   // a name and a sung theme song for the build, started with it (the card stays hidden when the route is off)

const STORE_KEY = 'kipDescribeEndpoint';
const IDEAS_SHOWN = 4;   // example buttons shown before "More ideas"

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
.kdb-panel { --kdb-ink: #1b2238; --kdb-bg: #fff; --kdb-soft: #eef1f7; --kdb-line: #c9cfdc; --kdb-muted: #566079; --kdb-field: #fff; --kdb-btn: #fff; --kdb-ring: #d9441f;
  --kdb-accent: #ff6b4a; --kdb-accent-hover: #ff8567; --kdb-on-accent: #1b2238; --kdb-btn-hover: #eef1f7;
  position: fixed; right: 16px; top: 64px; z-index: 41; width: min(360px, calc(100vw - 32px)); max-height: calc(100vh - 64px - 72px); overflow: auto; box-sizing: border-box;
  padding: 0 16px 16px; border-radius: 16px; background: var(--kdb-bg); color: var(--kdb-ink); font: 14px/1.4 system-ui, sans-serif; box-shadow: 0 10px 34px rgba(27,34,56,.22); }
.kdb-toggle:hover, .kdb-toggle:focus-visible { background: #2b3556; color: #fff; }   /* the host's own button:hover paints #fff, which is white text on white */
.kdb-toggle:active { background: #0f1426; color: #fff; }
.kdb-toggle:focus-visible, .kdb-panel button:focus-visible, .kdb-panel textarea:focus-visible, .kdb-panel input:focus-visible, .kdb-panel select:focus-visible, .kdb-panel summary:focus-visible, .kdb-panel li:focus-visible { outline: 3px solid var(--kdb-ring, #ff6b4a); outline-offset: 2px; }
.kdb-panel[hidden] { display: none; }
/* Something shown only after a build (the slider, the controls, the words-in picker) carries the hidden attribute: a display rule of its own must never beat it. */
.kdb-panel [hidden] { display: none !important; }
/* Room for a host's own chrome: the panel starts below a top bar and leaves the toggle visible; on a narrow screen the toggle rises above a bottom strip
   and the open panel becomes a bottom sheet that stops short of both that strip and a host's bottom-left button (it scrolls inside; its own Close
   button, and Escape, dismiss it). */
@media (max-width: 900px) { .kdb-toggle { bottom: 52px; } }
@media (max-width: 640px) { .kdb-panel { top: auto; bottom: 96px; left: 16px; right: 16px; width: auto; max-height: min(72vh, calc(100vh - 286px)); } }
/* the host's "hide UI" key (H) adds this class to the container (or any ancestor of it) */
.clean-ui .kdb-toggle, .clean-ui .kdb-panel { display: none !important; }
/* the title row stays put while the rest scrolls, so Close is always in reach on a small screen */
.kdb-panel h2.kdb-head { position: sticky; top: 0; z-index: 2; margin: 0 -16px; padding: 14px 16px 4px; background: var(--kdb-bg); font-size: 17px; display: flex; justify-content: space-between; align-items: center; }
.kdb-sub { margin: 0 0 12px; color: var(--kdb-muted); font-size: 13px; }
.kdb-label { display: block; margin: 0 0 4px; font-weight: 600; font-size: 13px; }
.kdb-inputrow { display: block; }
.kdb-panel textarea { display: block; width: 100%; box-sizing: border-box; resize: vertical; min-height: 64px; padding: 9px 11px; border: 1px solid var(--kdb-line); border-radius: 12px; background: var(--kdb-field); color: var(--kdb-ink); font: inherit; }
.kdb-panel button { font: 600 13px/1 system-ui, sans-serif; border: 1px solid var(--kdb-line); background: var(--kdb-btn); color: var(--kdb-ink); border-radius: 999px; padding: 8px 12px; cursor: pointer; }
.kdb-panel button:hover:not(:disabled) { background: var(--kdb-btn-hover); border-color: var(--kdb-muted); color: var(--kdb-ink); }
.kdb-panel button.kdb-go:hover:not(:disabled), .kdb-panel button.kdb-play:hover:not(:disabled), .kdb-panel button.kdb-mic-on:hover:not(:disabled) { background: var(--kdb-accent-hover); border-color: var(--kdb-accent-hover); color: var(--kdb-on-accent); }
.kdb-panel button.kdb-more:hover:not(:disabled) { background: none; border: 0; color: var(--kdb-ink); }
.kdb-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 8px; }
.kdb-panel button.kdb-go { flex: 1 1 140px; min-height: 44px; margin: 0; background: var(--kdb-accent); border-color: var(--kdb-accent); color: var(--kdb-on-accent); font-size: 15px; }
.kdb-panel button[disabled] { opacity: .55; cursor: progress; }
/* the microphone: a pill with words, so nobody has to guess what a bare 🎤 does */
.kdb-panel button.kdb-mic { flex: none; position: relative; overflow: hidden; display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 44px; min-width: 10.5rem; padding: 0 16px; font-size: 14px; white-space: nowrap; }
.kdb-panel button.kdb-mic[hidden] { display: none; }
.kdb-panel button.kdb-mic-on { background: var(--kdb-accent); border-color: var(--kdb-accent); color: var(--kdb-on-accent); animation: kdb-pulse 1s ease-in-out infinite; }
/* while it listens, a line under the pill runs out over exactly the time the recording may last (--kdb-cap is set from the controller's limit) */
.kdb-panel button.kdb-mic-on::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: var(--kdb-on-accent); transform-origin: left; animation: kdb-cap var(--kdb-cap, 8s) linear forwards; }
.kdb-panel button.kdb-mic-off, .kdb-panel button.kdb-mic-off:hover:not(:disabled) { opacity: .65; border-style: dashed; cursor: not-allowed; background: var(--kdb-btn); border-color: var(--kdb-line); }
@keyframes kdb-nudge { from { box-shadow: 0 0 0 3px var(--kdb-accent); } to { box-shadow: 0 0 0 3px transparent; } } .kdb-voicehint.kdb-nudge { animation: kdb-nudge .8s ease-out; }
@media (prefers-reduced-motion: reduce) { .kdb-voicehint.kdb-nudge { animation: none; } }
.kdb-voicehint { margin: 8px 0 0; padding: 8px 10px; border-radius: 10px; background: var(--kdb-soft); font-size: 13px; }
@keyframes kdb-pulse { 50% { box-shadow: 0 0 0 8px rgba(255, 107, 74, .28); } }
@keyframes kdb-cap { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@media (prefers-reduced-motion: reduce) { .kdb-panel button.kdb-mic-on { animation: none; } .kdb-panel button.kdb-mic-on::after { display: none; } }
.kdb-status { margin: 10px 0 2px; min-height: 1.4em; }
.kdb-try { margin-top: 12px; }
.kdb-h3, .kdb-try-t { margin: 0 0 6px; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--kdb-muted); }
.kdb-examples { display: flex; flex-wrap: wrap; gap: 6px; }
.kdb-examples button { font-weight: 500; padding: 6px 10px; white-space: normal; text-align: left; }
.kdb-panel button.kdb-more { margin-top: 6px; padding: 4px 2px; border: 0; background: none; color: var(--kdb-muted); text-decoration: underline; font-size: 12px; }
/* A host's global "button { transition: all ...; white-space: nowrap }" (Kip-Demo has one) must not leak in: it would slide the toggle whenever its position changes. */
.kdb-toggle, .kdb-panel, .kdb-panel * { transition: none; }
.kdb-badge { display: inline-block; margin: 10px 0 0; padding: 3px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; }
.kdb-badge.ok { background: #d9f3e8; color: #0d6b48; } .kdb-badge.warn { background: #ffe9c2; color: #8a5200; }
.kdb-build { margin: 10px 0 0; padding: 10px; border-radius: 12px; background: var(--kdb-soft); }
.kdb-controls { display: flex; gap: 6px; } .kdb-controls button { flex: 1 1 0; min-height: 38px; padding: 8px 4px; }
.kdb-panel button.kdb-play { flex-grow: 1.6; background: var(--kdb-accent); border-color: var(--kdb-accent); color: var(--kdb-on-accent); }
.kdb-bar { height: 6px; margin-top: 10px; border-radius: 3px; background: var(--kdb-line); overflow: hidden; } .kdb-bar > i { display: block; height: 100%; width: 0; background: var(--kdb-accent); }
.kdb-progress { margin: 6px 0 0; font-size: 13px; min-height: 1.3em; }
.kdb-slider { display: block; margin: 12px 0 0; font-weight: 600; } .kdb-slider input { display: block; width: 100%; margin: 6px 0 2px; accent-color: var(--kdb-accent); }
.kdb-slider.locked { opacity: .5; }
.kdb-slider-ends { display: flex; justify-content: space-between; font-size: 12px; font-weight: 500; color: var(--kdb-muted); }
.kdb-stepsbox { margin-top: 12px; }
.kdb-steps { margin: 0; padding-left: 24px; } .kdb-steps li { padding: 4px 6px; border-radius: 8px; cursor: pointer; } .kdb-steps li::marker { color: var(--kdb-muted); font-weight: 600; }
.kdb-steps li:hover, .kdb-steps li.on { background: var(--kdb-soft); } .kdb-steps li.on { font-weight: 600; }
.kdb-sw { display: inline-block; width: 10px; height: 10px; margin-right: 7px; border-radius: 3px; box-shadow: inset 0 0 0 1px rgba(0,0,0,.2); }
.kdb-caption { margin: 8px 0 0; min-height: 1.3em; font-weight: 700; font-size: 15px; } .kdb-caption:empty { margin: 0; min-height: 0; }
.kdb-lang { display: flex; align-items: center; gap: 8px; margin: 10px 0 0; font-weight: 600; } .kdb-lang select { font: inherit; padding: 4px 6px; border-radius: 8px; background: var(--kdb-field); color: var(--kdb-ink); border: 1px solid var(--kdb-line); }
.kdb-panel details { margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--kdb-line); font-size: 13px; } .kdb-panel details summary { cursor: pointer; font-weight: 600; color: var(--kdb-muted); }
.kdb-panel details input { width: 100%; box-sizing: border-box; margin: 6px 0; padding: 7px 9px; border: 1px solid var(--kdb-line); border-radius: 8px; background: var(--kdb-field); color: var(--kdb-ink); font: inherit; }
.kdb-panel details p { margin: 8px 0 0; } .kdb-panel details .kdb-voicenote { font-weight: 600; }
.kdb-panel code { background: var(--kdb-soft); padding: 1px 5px; border-radius: 5px; font-size: 12px; word-break: break-all; }
@media (prefers-color-scheme: dark) {
  .kdb-panel { --kdb-ink: #f4efe6; --kdb-bg: #1b2238; --kdb-soft: #26304a; --kdb-line: #3b4560; --kdb-muted: #a9b2c8; --kdb-field: #121829; --kdb-btn: #26304a; --kdb-btn-hover: #34406a; --kdb-ring: #ff8a6e; }
  .kdb-badge.ok { background: #12382b; color: #8fe0bd; } .kdb-badge.warn { background: #44330f; color: #f2c46d; }
}
@media (prefers-reduced-motion: reduce) { .kdb-panel, .kdb-toggle { transition: none; } }
`;

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
  themeUrl = '/api/theme-song',   // the app's own route (a name and a sung theme song, worker/themeSong.ts); '' turns the card off; a server where it is off just hides the card
  themeOptions = {},   // createThemeSong overrides (a test shortens the poll)
  transcribeUrl = '/api/transcribe',   // the app's own route (a child's voice to words, worker/transcribe.ts); '' turns the microphone off; a server where it is off just hides the button
  voiceOptions = {},   // createVoiceInput overrides (a test shortens the limits)
  voiceLabel = 'Say it',   // the words on the microphone pill. Neutral in the app; the standalone Kip demo page passes the name of the speech model it is demonstrating
}) {
  if (!document.getElementById('kdb-style')) document.head.append(el('style', { id: 'kdb-style' }, CSS));
  let book = null, parts = null, view = null, loading = null, busy = false, last = null, isOpen = false;
  // the build player: progress p runs from 0 (nothing seated) to n (finished), one unit per step; `target` is where a playing build stops
  let n = 0, p = 0, target = 0, playing = false, raf = 0, lastFrame = 0;
  let camSaved = null;   // the host camera (position and orbit target) from when the panel opened
  let voiceAudio = null, voiceDownUntil = 0, voiceSeq = 0, spokenStep = -1;   // the part voice: current clip, back-off after a failure, newest-tap-wins counter, last step spoken while playing

  const text = el('textarea', { id: 'kdb-text', maxlength: '300', rows: '3', placeholder: 'For example: a race car, or Kip with a cowboy hat' });
  const go = el('button', { class: 'kdb-go', type: 'button' }, 'Build it');
  const examples = el('div', { class: 'kdb-examples', role: 'group', 'aria-label': 'Examples' });
  const moreBtn = el('button', { class: 'kdb-more', type: 'button', 'aria-expanded': 'false', hidden: '' }, 'More ideas');
  const tryBox = el('div', { class: 'kdb-try' }, el('p', { class: 'kdb-try-t' }, 'Try an idea'), examples, moreBtn);
  const status = el('p', { class: 'kdb-status', role: 'status', 'aria-live': 'polite' }, 'Say what you would like to build.');
  const workshop = createWorkshop({ doc: document, onLabel: (msg) => { status.textContent = msg; } });
  const badge = el('span', { class: 'kdb-badge', hidden: '' });
  const theme = themeUrl ? createThemeSong({ url: themeUrl, fetchImpl, ...themeOptions }) : null;
  // The words the child said land in the text box to be SEEN and changed: the tab never builds from a voice by itself. The button is a labelled pill ("Say it" by default) that is
  // always there once the panel has asked the route: when the route cannot listen it is inert and says why, so it is never a mystery where the microphone went.
  const voice = transcribeUrl ? createVoiceInput({ url: transcribeUrl, fetchImpl, currentText: () => text.value, onText: (words) => { text.value = words.slice(0, 300); text.focus(); }, onStatus: (msg) => { if (!voiceHint.hidden && msg === voice?.whyOff()) nudge(voiceHint); else status.textContent = msg; }, label: voiceLabel, showWhenOff: true,
    onState: (st) => { voiceHint.hidden = st !== 'off'; if (st === 'off') voiceHint.textContent = `${voice.whyOff()}${voice.offReason === 'unreachable' ? ' (Open the app\'s own address from npm run dev, or run npm run kip:serve -- --api <that address>.)' : ''}`; }, ...voiceOptions }) : null;
  const voiceHint = el('p', { class: 'kdb-voicehint', role: 'status', hidden: '' });   // why the microphone pill is inert, shown for as long as it is (not only when it is pressed)
  /** A press on the inert pill must visibly DO something, without saying the same sentence twice: flash the reason that is already on screen. */
  const nudge = (node) => { node.classList.remove('kdb-nudge'); void node.offsetWidth; node.classList.add('kdb-nudge'); };
  const inputRow = el('div', { class: 'kdb-inputrow' }, text);
  const actions = el('div', { class: 'kdb-actions' }, ...(voice ? [voice.node] : []), go);
  const playBtn = el('button', { class: 'kdb-play', type: 'button' }, 'Play build');
  const backBtn = el('button', { type: 'button', 'aria-label': 'Back one step' }, 'Back');
  const nextBtn = el('button', { type: 'button', 'aria-label': 'Next step' }, 'Next');
  const replayBtn = el('button', { type: 'button' }, 'Replay');
  const barFill = el('i', {});
  const bar = el('div', { class: 'kdb-bar', 'aria-hidden': 'true' }, barFill);   // how far the build has got: the same number as the words under it
  const progress = el('p', { class: 'kdb-progress', role: 'status', 'aria-live': 'polite' }, '');
  const buildBox = el('div', { class: 'kdb-build', role: 'group', 'aria-label': 'Build animation', hidden: '' },
    el('div', { class: 'kdb-controls' }, backBtn, playBtn, nextBtn, replayBtn), bar, progress);
  const slider = el('input', { type: 'range', min: '0', max: '100', value: '0', 'aria-label': 'Exploded view' });
  const sliderBox = el('label', { class: 'kdb-slider', hidden: '' }, 'Exploded view', slider, el('span', { class: 'kdb-slider-ends', 'aria-hidden': 'true' }, el('span', {}, 'Together'), el('span', {}, 'Apart')));
  const list = el('ol', { class: 'kdb-steps', 'aria-label': 'Build steps' });
  const stepsBox = el('div', { class: 'kdb-stepsbox', hidden: '' }, el('p', { class: 'kdb-h3' }, 'Parts, in building order'), list);
  const langSel = el('select', { id: 'kdb-lang', 'aria-label': 'Language for part names' }, ...LANGS.map(([c, name]) => el('option', { value: c }, name)));
  langSel.value = lang.get();
  const langBox = el('label', { class: 'kdb-lang', hidden: '' }, 'Words in', langSel);
  const caption = el('p', { class: 'kdb-caption', role: 'status', 'aria-live': 'polite' }, '');
  const epInput = el('input', { type: 'url', id: 'kdb-endpoint', placeholder: 'http://127.0.0.1:8788/describe', value: endpoint || store.get(), 'aria-label': 'Model endpoint address' });
  const epNote = el('p', {}, '');
  const test = el('button', { type: 'button' }, 'Test connection');
  const voiceNote = el('p', { class: 'kdb-voicenote' }, '');
  const settings = el('details', {}, el('summary', {}, 'Settings: model endpoint (optional)'), epInput, test, epNote,
    el('p', {}, 'With no address, the app asks its own server, which asks Muse to pick the sample build that fits your words (in any language). If that is not available the page matches your words to the sample builds itself. To let a language model design a NEW build instead, start the local endpoint with ', el('code', {}, 'node parts/kip/viewer/tools/describe-endpoint.mjs'),
      ' and paste the address it prints. The page never holds a key: the server and the endpoint read it from your own .dev.vars.'),
    el('p', {}, 'What is sent: with an address, your description and the list of part names go only to that address. With no address, your description (phone numbers and emails removed first) goes to the app\'s server and on to Muse, to pick a build. When theme songs are switched on, the same description also goes to the app\'s server to write a name and a song, and the finished words go to a song service that sings them (nothing else about you does). Songs you make are kept in this browser only. Nothing else is stored except that address, and only for this browser tab.'),
    el('p', {}, `Voice: the microphone is not asked for until you press ${voiceLabel}. Then a recording of up to 8 seconds goes to the app\'s server and on to a speech-to-text model to be turned into words, and is dropped as soon as the words are back. The words land in the box for you to read and change; nothing is built until you press Build it.`),
    voiceNote);
  const close = el('button', { type: 'button', 'aria-label': 'Close' }, 'Close');
  const panel = el('section', { class: 'kdb-panel', 'aria-label': 'Describe and build', hidden: '' }, el('h2', { class: 'kdb-head' }, 'Describe & build', close),
    el('p', { class: 'kdb-sub' }, 'Type it or say it, and Muse finds parts that fit together.'),
    el('label', { class: 'kdb-label', for: 'kdb-text' }, 'What should we build?'), inputRow, actions, voiceHint, status, workshop.node, badge, ...(theme ? [theme.node] : []), buildBox, sliderBox, stepsBox, caption, langBox, tryBox, settings);
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
        // The book can hold many more builds than make sensible example buttons: the ones marked `featured` are shown, every build can still be matched and built.
        const featured = book.recipes.filter((r) => r.featured);
        const ideas = featured.length ? featured : book.recipes;
        ideas.forEach((r, i) => {
          // the first few are shown; the rest wait behind "More ideas" (they stay in the page either way, so a script can still press any of them)
          examples.append(el('button', { type: 'button', title: r.title, ...(i >= IDEAS_SHOWN ? { hidden: '', 'data-more': '' } : {}), onclick: () => { text.value = r.description; build(); } }, r.description));
        });
        moreBtn.hidden = ideas.length <= IDEAS_SHOWN;
        workshop.stop({ finished: true });
        say('Say what you would like to build.');
      } catch (e) { workshop.stop(); throw e; }
    })().catch((e) => { loading = null; throw e; });
    await loading;
  }

  function renderSteps(result) {
    list.replaceChildren(...result.steps.map((s, i) => {
      const host = s.mate ? ` on the ${label(result.steps.find((x) => x.id === s.mate.host)?.part).toLowerCase()}` : ' (the base)';
      const sw = el('span', { class: 'kdb-sw', 'aria-hidden': 'true' });
      sw.style.background = partColour(parts, s.part);   // the colour the 3D view draws this part in
      return el('li', { tabindex: '0', onmouseenter: () => view.highlight(i), onmouseleave: () => view.highlight(null), onfocus: () => view.highlight(i), onblur: () => view.highlight(null),
        onclick: () => sayPart(i), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sayPart(i); } } },
        sw, `${label(s.part)}${host}`);
    }));
    syncChrome();
  }
  /** The step list and the language picker mean something only while there is a build to show. */
  function syncChrome() {
    const has = list.children.length > 0;
    stepsBox.hidden = !has;
    langBox.hidden = !has;
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
    progress.textContent = p <= 0 ? (reduced() ? `Ready: press Play build to watch all ${n} parts go together.` : `Ready: all ${n} parts are in a pile. Press Play build to watch them go together.`)
      : p >= n ? `Built: all ${n} parts are seated.` : `Step ${cur + 1} of ${n}: ${stepName(cur)}`;
    barFill.style.width = n > 0 ? `${Math.max(0, Math.min(1, p / n)) * 100}%` : '0%';
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

  /**
   * A new request is pending, so the last build's badge, progress line, controls, slider and caption describe something else ("Built: all 10 parts are
   * seated" while the next build is still being found): hide them. The drawing stays, so the stage never goes blank; the next answer brings it all back. If
   * the request fails outright the status line says so and the controls stay hidden until the next build.
   */
  function hideStale() {
    stop(); stopVoice();
    badge.hidden = true; buildBox.hidden = true; sliderBox.hidden = true; caption.textContent = '';
  }

  async function build() {
    if (busy) return;
    const q = text.value.trim();
    if (!q) { say('Type what you would like to build first.'); text.focus(); return; }
    busy = true; go.disabled = true;
    voice?.cancel();   // a recording in progress is thrown away: the child pressed Build
    theme?.start(q).catch(() => { /* a song that cannot start never stops the build */ });   // the name and the song start WITH the build, not after it
    try {
      hideStale();
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
        view.clear(); list.replaceChildren(); syncChrome(); sliderBox.hidden = true; buildBox.hidden = true; n = 0; p = 0;
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
      view.frame(camera, controls, { pile: !reduced() });
      workshop.stop({ finished: true });
      say(`${result.title}. ${result.note}${result.clarifyingQuestion ? ` Question: ${result.clarifyingQuestion}` : ''}`);
    } catch (e) {
      workshop.stop();
      say(`Sorry, that did not work: ${e.message}`);
    } finally {
      busy = false; go.disabled = false;
    }
  }

  /** Settings > what the microphone is doing, for whoever is wondering why the pill is (or is not) live. */
  function noteVoice() {
    if (!voice) { voiceNote.textContent = 'Voice input is not part of this page.'; return; }
    voiceNote.textContent = voice.available ? `Voice input is on (${voiceLabel}): this server can turn your voice into words.`
      : voice.offReason === 'browser' ? `Voice input is off (${voiceLabel}): this browser cannot record sound.`
      : voice.offReason === 'unreachable' ? `Voice input is off (${voiceLabel}): the page could not reach the app\'s server (/api/transcribe), for example on a plain file server.`
      : `Voice input is off (${voiceLabel}): the server says voice input is not switched on (TRANSCRIBE_BACKEND=hosted in .dev.vars turns it on for the demo).`;
  }

  function open() {
    // The tab re-aims the host's camera at the drawing; remember where it was so closing puts the host's own scene back in view.
    camSaved = { pos: camera.position.clone(), target: controls?.target?.clone() };
    isOpen = true; panel.hidden = false; toggle.setAttribute('aria-expanded', 'true');
    if (view) { view.group.visible = true; if (view.plan) view.frame(camera, controls, { pile: !reduced() }); }
    setCharacterVisible(false);
    theme?.warm().catch(() => { /* waking the song model is best effort */ });   // a build is likely coming, and so is its song: wake our own model now
    ready().catch((e) => say(`Could not load the part list: ${e.message}`));
    voice?.probe().then(noteVoice, () => { /* the pill stays hidden: the box still works */ });   // one free GET; the pill works only if the route says it can listen, and says why when it cannot
    text.focus();
  }
  function closePanel() {
    if (playing) { stop(); labels(); }
    stopVoice(); theme?.silence(); voice?.cancel();
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
  moreBtn.addEventListener('click', () => {
    const open = moreBtn.getAttribute('aria-expanded') !== 'true';
    moreBtn.setAttribute('aria-expanded', String(open));
    moreBtn.textContent = open ? 'Fewer ideas' : 'More ideas';
    for (const b of examples.querySelectorAll('[data-more]')) b.hidden = !open;
  });
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
    get theme() { return theme; },
    get voice() { return voice; },
    get progress() { return p; },
    get playing() { return playing; },
    ready,
    /** Unmount: hand the camera and the character back, stop the player, remove the toggle and panel (the shared <style> stays). */
    dispose() {
      stopVoice(); workshop.stop(); theme?.dispose(); voice?.dispose();
      if (isOpen) closePanel(); else stop();
      view?.dispose?.();
      toggle.remove(); panel.remove();
    },
  };
}
