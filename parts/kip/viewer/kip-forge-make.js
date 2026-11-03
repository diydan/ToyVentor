// Text to part: the panel (docs/specs/forge-ai-spec.md, F1 "Describe it": "a screen that calls it").
//
// A child says what they want ("a wizard hat", "a robot head"), the parts maker makes it, and Kip can wear it. A grown-up only has to say yes to SAVE
// the file for printing: making and looking are free (Dan, 2026-11-03), printing keeps the grown-up check.
//
// This file is only buttons and pictures. Everything that can go wrong is decided, with one calm sentence, in shared/forgeMakeFlow.ts (bundled by
// scripts/build-kip.ts into kip-forge-make-core.js) and tested there. The Worker (worker/forgeMake.ts) does the filtering, the model call and the checks.
//
// Rules (checked by tests/forge-make-wiring.test.ts and scripts/e2e-kip-forge-make.mjs):
//   - Nothing is sent until "Make it" is pressed. The words go to /api/forge/make and nowhere else.
//   - The words, the part, the grown-up proof and the file live in this closure and in memory only: no cookies, no storage writes. The only storage
//     access is a READ of the app's anonymous device id and the chosen language (the keys the selfie helper and the prop voice already read).
//   - All DOM and CSS sit inside the root it is given; no listener on window or document; timers and object URLs are let go by dispose().
//   - Every message is a sentence from the flow module or written here; a server's words and raw codes are never shown. Text is set with
//     textContent, never as HTML.
//   - "Wear it" hands the page the first look (a GLB) and the slot; the page puts it on Kip and says whether it worked. Without `onWear` there is no button.

import * as flow from './kip-forge-make-core.js?v=10.0';
import { createParentGate, gateMessage } from './kip-photo-print-core.js?v=10.0'; // the same specifier the photo panel uses, so the browser loads it once
import { createWorkshop } from './kip-workshop-wait.js'; // the waiting state: belt, bricks, parts pile, driven by the real stages below

/** The app's anonymous device id lives under this key (src/lib/sync.ts); the same one kip-selfie-cloud.js and the photo panel read. */
export const DEVICE_KEY = 'toyforge:device:v1';
/** The language the prop voice speaks in (src/lib/propSpeech.ts PROP_LANG_KEY). Read only. */
export const LANG_KEY = 'toyforge:prop-lang:v1';
export const MAX_TEXT = 120;
export const IDEAS = ['a wizard hat', 'a robot head', 'a hat with bunny ears', 'a pirate hat', 'a cat head', 'a grumpy troll head'];

const CSS = `
.kfm-back{position:fixed;inset:0;background:rgba(27,34,56,.34);backdrop-filter:blur(6px);display:none;align-items:center;justify-content:center;z-index:45;padding:18px}
.kfm-back.open{display:flex}
.kfm-card{background:#fbf9f5;border:1px solid rgba(27,34,56,.15);border-radius:20px;box-shadow:0 22px 56px rgba(27,34,56,.24);width:min(560px,96vw);max-height:90vh;overflow-y:auto;padding:18px 20px;display:flex;flex-direction:column;gap:12px;color:#1b2238;font:14px/1.4 system-ui,sans-serif}
.kfm-card *{box-sizing:border-box}
.kfm-head{display:flex;justify-content:space-between;align-items:center;gap:10px}
.kfm-head h2{font-size:16px;font-weight:800;letter-spacing:-.01em;margin:0}
.kfm-sub{font-size:12.5px;color:#5d657c;line-height:1.45;margin:0}
.kfm-note{font-size:11.5px;color:#7b8298;margin:0}
.kfm-card button{font:inherit;font-weight:700;border:1px solid rgba(27,34,56,.2);background:#fff;color:#1b2238;border-radius:10px;padding:8px 13px;cursor:pointer}
.kfm-card button:disabled{opacity:.5;cursor:default}
.kfm-card button.kfm-go{background:#7c4dff;border-color:#7c4dff;color:#fff}
.kfm-card button.kfm-ok{background:#1fa97c;border-color:#1fa97c;color:#fff}
.kfm-card input[type=text]{font:inherit;width:100%;padding:9px 11px;border:1px solid rgba(27,34,56,.25);border-radius:10px;background:#fff}
.kfm-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.kfm-chips button{font-size:12.5px;padding:5px 10px;border-radius:999px;font-weight:600}
.kfm-slot label{display:inline-flex;gap:5px;align-items:center;font-weight:600;font-size:13px;margin-right:12px}
.kfm-status,.kfm-q{font-size:13px;font-weight:700;min-height:1.4em}
.kfm-status.bad{color:#b3261e}
.kfm-name{font-size:18px;font-weight:800;margin:0}
.kfm-sayname{font-size:13px;color:#5d657c;margin:0}
.kfm-links{display:flex;flex-wrap:wrap;gap:8px}
.kfm-links a{font-size:12.5px;font-weight:700;color:#fff;background:#1fa97c;padding:6px 11px;border-radius:9px;text-decoration:none}
.kfm-wearnote.bad{color:#b3261e}
.kfm-card [hidden]{display:none!important}
`;

function el(doc, tag, props = {}, ...kids) {
  const n = doc.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (v === true) n.setAttribute(k, '');
    else if (v !== false && v != null) n.setAttribute(k, String(v));
  }
  for (const kid of kids) if (kid) n.append(kid);
  return n;
}

function defaultDeviceId() {
  try { return localStorage.getItem(DEVICE_KEY); } catch { return null; }
}
function defaultLang() {
  try { return localStorage.getItem(LANG_KEY) || 'en'; } catch { return 'en'; }
}

const slug = (name) => String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'my-part';

/**
 * The panel. `root` is the element it lives in (the bench root); nothing is added anywhere else.
 * `onWear({ slot, glbBase64, name })` puts the part on Kip and says whether it worked (`{ ok: boolean }`); slot is `crown` or `head`.
 * `lang` is the language code to speak the part's name in (a function, read each time the speaker is pressed); default: the prop voice's language.
 * `downloads: false` (a hosted bench that hands no file out) leaves out "Save for printing".
 * @param {{ downloads?: boolean, root: Element, fetch?: (url: string, init?: RequestInit) => Promise<Response>, deviceId?: () => string | null, lang?: () => string, onWear?: (part: { slot: 'crown' | 'head', glbBase64: string, name: string }) => Promise<{ ok: boolean }> | { ok: boolean } }} options
 */
export function createForgeMake({ root, fetch: fetchFn, deviceId = defaultDeviceId, lang = defaultLang, onWear, downloads = true } = {}) {
  if (!root) throw new Error('createForgeMake needs a root element');
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const doFetch = fetchFn ?? ((url, init) => fetch(url, init));
  const gate = createParentGate({ fetch: doFetch, deviceId });

  const state = {
    step: 'ask', // ask | working | done | gate
    text: '',
    busy: false,
    message: '',
    bad: false,
    firstLook: null, // { slot, glbBase64, name } as soon as the first look arrives
    result: null, // the flow's MakeResult
    worn: false,
  };

  let built = null;
  let urls = [];
  let gateWaiter = null; // { resolve } while the grown-up question is on screen
  let gateBack = 'done';
  let audio = null;
  let disposed = false;

  const forgetUrls = () => { for (const u of urls) URL.revokeObjectURL(u); urls = []; };
  const workshop = createWorkshop({ doc, onLabel: (text) => say(text) });
  const blobUrl = (data, type) => { const u = URL.createObjectURL(new Blob([data], { type })); urls.push(u); return u; };

  function build() {
    if (built) return built;
    const $ = {};
    $.back = el(doc, 'div', { class: 'kfm-back', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Make a part from your words', tabindex: '-1' });
    const card = el(doc, 'div', { class: 'kfm-card' });
    $.back.append(el(doc, 'style', { text: CSS }), card);

    $.close = el(doc, 'button', { type: 'button', text: '✕ Close' });
    card.append(el(doc, 'div', { class: 'kfm-head' }, el(doc, 'h2', { text: '✨ Make a part from words' }), $.close));
    card.append(el(doc, 'p', { class: 'kfm-sub', text: 'Say what you would like, like a hat or a head, and we make it for Kip. A grown-up only has to say yes when you save it for printing.' }));

    // ask
    $.ask = el(doc, 'div', { class: 'kfm-ask', style: 'display:flex;flex-direction:column;gap:12px' });
    $.text = el(doc, 'input', { type: 'text', maxlength: String(MAX_TEXT), placeholder: 'a wizard hat, a robot head…', 'aria-label': 'What shall we make?' });
    $.chips = el(doc, 'div', { class: 'kfm-row kfm-chips' });
    for (const idea of IDEAS) $.chips.append(el(doc, 'button', { type: 'button', text: idea, 'data-idea': idea }));
    $.slot = el(doc, 'div', { class: 'kfm-slot', role: 'radiogroup', 'aria-label': 'What kind of part' });
    for (const [value, label, on] of [['crown', 'A hat', false], ['head', 'A head', false], ['', 'Surprise me', true]]) {
      $.slot.append(el(doc, 'label', {}, el(doc, 'input', { type: 'radio', name: 'kfm-slot', value, checked: on }), doc.createTextNode(label)));
    }
    $.make = el(doc, 'button', { type: 'button', class: 'kfm-go', text: '✨ Make it' });
    $.ask.append(
      el(doc, 'div', { class: 'kfm-row' }, $.text),
      $.chips,
      el(doc, 'div', { class: 'kfm-row' }, $.slot),
      el(doc, 'div', { class: 'kfm-row' }, $.make),
      el(doc, 'p', { class: 'kfm-note', text: 'Your words are sent to our online helper to make the part. Our server does not keep them.' }),
    );

    // working
    $.work = el(doc, 'div', { class: 'kfm-work', style: 'display:flex;flex-direction:column;gap:8px' });
    $.firstName = el(doc, 'p', { class: 'kfm-name', hidden: true });
    $.wearNow = el(doc, 'button', { type: 'button', class: 'kfm-ok', text: '👀 Put it on Kip now', hidden: true });
    $.work.append(el(doc, 'p', { class: 'kfm-sub', text: 'This can take a minute. You can leave this open.' }), workshop.node, $.firstName, el(doc, 'div', { class: 'kfm-row' }, $.wearNow));

    // grown-up question (only to save the file for printing)
    $.gate = el(doc, 'div', { class: 'kfm-gate', style: 'display:flex;flex-direction:column;gap:10px' });
    $.gateQ = el(doc, 'div', { class: 'kfm-q' });
    $.gateIn = el(doc, 'input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', 'aria-label': 'The grown-up answer' });
    $.gateGo = el(doc, 'button', { type: 'button', class: 'kfm-go', text: 'Check' });
    $.gateNo = el(doc, 'button', { type: 'button', text: 'Cancel' });
    $.gate.append(
      el(doc, 'p', { class: 'kfm-sub', text: 'A grown-up needs to say yes before the file for printing is saved.' }),
      $.gateQ,
      el(doc, 'div', { class: 'kfm-row' }, $.gateIn, $.gateGo, $.gateNo),
    );

    // done
    $.done = el(doc, 'div', { class: 'kfm-done', style: 'display:flex;flex-direction:column;gap:10px' });
    $.name = el(doc, 'p', { class: 'kfm-name' });
    $.sayName = el(doc, 'p', { class: 'kfm-sayname', hidden: true });
    $.speak = el(doc, 'button', { type: 'button', text: '🔊 Say it', hidden: true });
    $.summary = el(doc, 'div', { class: 'kfm-sub' });
    $.wear = el(doc, 'button', { type: 'button', class: 'kfm-ok', text: '👒 Wear it' });
    $.save = el(doc, 'button', { type: 'button', text: '🖨️ Save for printing (.stl)' });
    $.again = el(doc, 'button', { type: 'button', class: 'kfm-go', text: '✨ Make another' });
    $.links = el(doc, 'div', { class: 'kfm-links' });
    $.done.append($.name, el(doc, 'div', { class: 'kfm-row' }, $.sayName, $.speak), $.summary, el(doc, 'div', { class: 'kfm-row' }, $.wear, $.save, $.again), $.links);

    $.wearNote = el(doc, 'div', { class: 'kfm-wearnote kfm-q', role: 'status', 'aria-live': 'polite' });
    $.status = el(doc, 'div', { class: 'kfm-status', role: 'status', 'aria-live': 'polite' });
    card.append($.ask, $.work, $.gate, $.done, $.wearNote, $.status);

    $.close.addEventListener('click', () => api.close());
    $.back.addEventListener('keydown', (e) => { if (e.key === 'Escape') api.close(); e.stopPropagation(); }); // keys typed here are not the bench's shortcuts
    $.chips.addEventListener('click', (e) => {
      const idea = e.target?.getAttribute?.('data-idea');
      if (idea) { $.text.value = idea; $.text.focus(); }
    });
    $.text.addEventListener('keydown', (e) => { if (e.key === 'Enter') start(); });
    $.make.addEventListener('click', start);
    $.wearNow.addEventListener('click', () => wear(state.firstLook));
    $.wear.addEventListener('click', () => wear(state.result ? { slot: state.result.recipe.slot === 'head' ? 'head' : 'crown', glbBase64: state.result.glbBase64, name: state.result.name } : null));
    $.save.addEventListener('click', saveFile);
    $.speak.addEventListener('click', speak);
    $.again.addEventListener('click', () => { state.result = null; state.firstLook = null; state.worn = false; $.wearNote.textContent = ''; $.links.replaceChildren(); forgetUrls(); say(''); show('ask'); $.text.focus(); });
    $.gateGo.addEventListener('click', submitGate);
    $.gateIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitGate(); });
    $.gateNo.addEventListener('click', () => gateWaiter?.resolve(false));

    root.append($.back);
    built = $;
    return $;
  }

  function say(text, bad = false) {
    state.message = text;
    state.bad = bad;
    if (!built) return;
    built.status.textContent = text;
    built.status.classList.toggle('bad', Boolean(bad));
  }

  function show(step) {
    state.step = step;
    if (!built) return;
    for (const [name, node] of [['ask', built.ask], ['working', built.work], ['gate', built.gate], ['done', built.done]]) node.style.display = name === step ? 'flex' : 'none';
  }

  function selectedSlot() {
    const picked = built.slot.querySelector('input:checked');
    return picked && picked.value ? picked.value : undefined;
  }

  /** The flow's real stages to the strip. The words are the panel's own; the rest countdown is the strip's (one tick a second, cancelled by the next stage). */
  function onProgress(e) {
    if (disposed) return;
    const $ = built;
    if (e.stage === 'proposing') workshop.setStage('asking', { call: e.call, label: e.call > 1 ? `Trying again… (try ${e.call})` : 'Looking through the parts bin…' });
    else if (e.stage === 'preview') {
      state.firstLook = { slot: e.slot, glbBase64: e.glbBase64, name: e.name };
      $.firstName.textContent = e.name;
      $.firstName.hidden = false;
      $.wearNow.hidden = !onWear || !e.glbBase64;
      workshop.setStage('preview', { call: e.call, label: 'Here is your first look. Checking it can print…' });
    } else if (e.stage === 'checking') workshop.setStage('checking', { call: e.call, label: e.call > 1 ? `Checking it can print… (try ${e.call})` : 'Checking it can print…' });
    else if (e.stage === 'fixing') workshop.setStage('repair', { call: e.call, label: 'Fixing a thin bit…' });
    else if (e.stage === 'asking_again') workshop.setStage('asking', { label: 'The grown-up check ran out. Asking again…' });
    else if (e.stage === 'waiting') workshop.setStage('rest', { seconds: e.seconds, label: (left) => `A short rest. Trying again in ${left} s…` });
  }

  async function start() {
    if (state.busy || disposed) return;
    const $ = built;
    const text = $.text.value.trim();
    if (!text) { say('Say what you would like to make.', true); return; }
    state.busy = true;
    state.text = text;
    state.firstLook = null;
    state.result = null;
    state.worn = false;
    $.wearNote.textContent = '';
    $.firstName.hidden = true;
    $.wearNow.hidden = true;
    $.links.replaceChildren();
    forgetUrls();
    say('');
    show('working');
    workshop.start({ staged: true, delayMs: 300 });
    const slot = selectedSlot();
    const r = await flow.makeFromText({ text, ...(slot ? { slot } : {}), gate, fetch: doFetch, onProgress, renewGate: () => askGate() });
    state.busy = false;
    if (disposed) return;
    workshop.stop({ finished: Boolean(r.ok) });
    if (!r.ok) { show('ask'); say(r.message, true); return; }
    state.result = r;
    finish(r);
  }

  function finish(r) {
    const $ = built;
    $.name.textContent = r.name;
    const lg = lang();
    const spoken = r.names?.[lg] ?? r.names?.en ?? null;
    $.sayName.hidden = !spoken;
    $.speak.hidden = !spoken;
    $.sayName.textContent = spoken ? `${spoken.w}` : '';
    $.wear.hidden = !onWear || !r.glbBase64;
    $.save.hidden = !r.printable || !downloads;
    $.summary.textContent = r.printable
      ? 'It passed the printer check. You can wear it on Kip now, and save it for printing.'
      : 'It looks fine on screen, but it cannot be printed yet. You can still wear it on Kip, or make another one.';
    show('done');
    say(r.printable ? 'Your part is ready!' : 'Here is your part.');
  }

  async function wear(part) {
    if (!onWear || !part || !part.glbBase64) return;
    const $ = built;
    $.wear.disabled = $.wearNow.disabled = true;
    let r;
    try { r = await onWear({ slot: part.slot, glbBase64: part.glbBase64, name: part.name }); } catch { r = { ok: false }; }
    if (disposed) return;
    $.wear.disabled = $.wearNow.disabled = false;
    state.worn = Boolean(r && r.ok);
    $.wearNote.textContent = state.worn ? 'Kip is wearing it! Close this to have a look.' : 'Kip could not wear that one. Try again.';
    $.wearNote.classList.toggle('bad', !state.worn);
  }

  function speak() {
    const r = state.result;
    if (!r || !r.names) return;
    const lg = lang();
    const useLg = r.names[lg] ? lg : 'en';
    const n = r.names[useLg];
    if (!n) return;
    try {
      audio = new win.Audio(flow.voiceUrl(useLg, n));
      audio.play().catch(() => { /* no clip: the caption stays */ });
    } catch { /* no audio here: the caption stays */ }
  }

  /** Put the grown-up question on screen and wait for a right answer (true) or Cancel (false). Used only to save the file for printing. */
  function askGate() {
    return new Promise(async (resolve) => {
      const $ = built;
      const before = state.step === 'gate' ? gateBack : state.step;
      gateBack = before;
      gateWaiter = { resolve: (ok) => { gateWaiter = null; show(before); resolve(ok); } };
      show('gate');
      $.gateIn.value = '';
      $.gateQ.textContent = 'Asking…';
      $.gateGo.disabled = true;
      const c = await gate.challenge();
      if (disposed) return;
      if (c.status !== 'ok') { $.gateQ.textContent = gateMessage(c); return; }
      state.gateChallenge = c;
      $.gateQ.textContent = c.mode === 'pin' ? 'Grown-up: type the PIN.' : `Grown-up: what is ${c.a} × ${c.b}?`;
      $.gateIn.type = c.mode === 'pin' ? 'password' : 'text';
      $.gateGo.disabled = false;
      $.gateIn.focus();
    });
  }

  async function submitGate() {
    const c = state.gateChallenge;
    if (!c || !gateWaiter) return;
    const $ = built;
    $.gateGo.disabled = true;
    const v = await gate.verify(c.mode === 'pin' ? { pin: $.gateIn.value } : { challengeToken: c.challengeToken, answer: $.gateIn.value });
    if (disposed) return;
    if (v.status === 'ok') { say(''); gateWaiter.resolve(true); return; }
    say(gateMessage(v), true);
    $.gateIn.value = '';
    const again = await gate.challenge(); // a wrong answer burns the question: ask for a fresh one
    if (disposed) return;
    if (again.status === 'ok') {
      state.gateChallenge = again;
      $.gateQ.textContent = again.mode === 'pin' ? 'Grown-up: type the PIN.' : `Grown-up: what is ${again.a} × ${again.b}?`;
      $.gateGo.disabled = false;
    } else $.gateQ.textContent = gateMessage(again);
  }

  /** Save the printable STL: the one step that needs the grown-up check. */
  async function saveFile() {
    const r = state.result;
    if (!r || !r.stlArtifact || state.busy) return;
    const $ = built;
    state.busy = true;
    try {
      if (!gate.hasProof() && !(await askGate())) { say('Not saved. Ask a grown-up when you want to print it.'); return; }
      say('Getting your file…');
      const get = () => doFetch(flow.artifactUrl(r.stlArtifact), { headers: gate.headers() });
      let res = await get();
      if (res.status === 401) { gate.clearProof(); if (await askGate()) res = await get(); else { say('Not saved. Ask a grown-up when you want to print it.'); return; } }
      if (!res.ok) { say('The file could not be saved. Please try again in a minute.', true); return; }
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (disposed) return;
      const a = el(doc, 'a', { href: blobUrl(bytes, 'model/stl'), download: `${slug(r.name)}.stl`, text: `⬇ ${slug(r.name)}.stl` });
      $.links.replaceChildren(a);
      say('Your file is ready to save.');
    } catch {
      if (!disposed) say('The file could not be saved. Please try again in a minute.', true);
    } finally {
      state.busy = false;
    }
  }

  const api = {
    /** Show the panel. */
    open() {
      if (disposed) return;
      const $ = build();
      if (state.step === 'gate' || (!state.busy && !state.result)) show('ask');
      else show(state.step);
      $.back.classList.add('open');
      $.back.focus();
    },
    /** Hide it. A part being made carries on; what was made stays until "Make another" or dispose(). */
    close() {
      if (!built) return;
      built.back.classList.remove('open');
    },
    isOpen: () => Boolean(built && built.back.classList.contains('open')),
    /** A copy of the panel's state, for tests: the step and the message, and whether a first look and a result are held. */
    get state() {
      return { step: state.step, message: state.message, bad: state.bad, busy: state.busy, hasFirstLook: Boolean(state.firstLook), hasResult: Boolean(state.result), printable: Boolean(state.result && state.result.printable), worn: state.worn, hasProof: gate.hasProof() };
    },
    /** Let go of everything: timers, object URLs, the audio, the proof, the words and the DOM. Safe to call twice. */
    dispose() {
      if (disposed) return;
      disposed = true;
      workshop.stop();
      forgetUrls();
      gateWaiter?.resolve(false);
      gate.clearProof();
      try { audio?.pause(); } catch { /* nothing playing */ }
      audio = null;
      state.text = '';
      state.firstLook = null;
      state.result = null;
      if (built) { built.back.remove(); built = null; }
    },
  };
  return api;
}
