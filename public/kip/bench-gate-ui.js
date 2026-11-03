// bench-gate-ui.js: the question a grown-up answers before a file leaves a bench (docs/specs/workshop-print-gate-spec.md, draft 1, phase 2: the dialog).
//
// A PROTOTYPE, NOT WIRED: nothing imports this file yet. It is the `ui` that bench-gate.js `createDownloadGate({ cloud, ui })` takes. Two parts:
//   - `gateCopy`, `denialMessage`, `COPY`: pure (the words), unit-tested, one object a translator can replace (decision 6 of the spec).
//   - `createGateModal({ root })`: the dialog. It uses the selfie gate's wording ("Grown-up check", "What is 14 × 6?", "Type the grown-up PIN.") and its calm status
//     sentences (describeStatus), and stays open between tries so a wrong answer does not flicker.
//
// Behaviour: Enter or Check answers; Escape, Cancel or `close()` settles the question with null; every key typed inside is kept inside (a bench's own shortcuts, WASD
// and Space, must not fire while a grown-up types). Focus goes to the answer field, is kept in the dialog (Tab wraps), and returns to where it was when the dialog closes.
// The dialog is `position: fixed` and covers the page, so the game's Workshop overlay sees it as an open layer and its own Escape rule leaves the key to this dialog.

import { describeStatus } from './kip-selfie-cloud.js';

export const COPY = Object.freeze({
  title: 'Grown-up check',
  intro: (what) => `A grown-up needs to say yes before we make ${what}.`,
  whats: Object.freeze({
    pack: 'a print pack',
    'project-3mf': 'a print project',
    '3mf': 'a plate file',
    'stl-zip': 'the part files',
    'stickers-pdf': 'a sticker sheet',
    'stencils-stl': 'the stencils',
    sheet: 'a print sheet',
    sticker: 'a sticker',
    'photo-plate': 'a plate from your photo',
  }),
  fallbackWhat: 'a file',
  mathQuestion: (a, b) => `What is ${a} × ${b}?`,
  pinQuestion: 'Type the grown-up PIN.',
  wrong: 'That is not it. Try again.',
  triesLeft: (n) => `${n} ${n === 1 ? 'try' : 'tries'} left.`,
  notANumber: 'Type a number.',
  check: 'Check',
  checking: 'Checking…',
  cancel: 'Cancel',
  answerLabel: 'Grown-up answer',
  denied: 'That was not right. Ask a grown-up to help.',
  cooldown: (seconds) => `Too many tries. Please wait ${seconds} seconds.`,
});

/**
 * The words for one question. `ctx` is what bench-gate.js hands to `ui.prompt`: { kind, mode, a, b, error }.
 * @returns {{ title: string, intro: string, question: string, error: string, inputType: string, inputMode: string, check: string, cancel: string, answerLabel: string }}
 */
export function gateCopy(ctx, copy = COPY) {
  const what = copy.whats[ctx.kind] ?? copy.fallbackWhat;
  const pin = ctx.mode === 'pin';
  let error = '';
  if (ctx.error) {
    error = copy.wrong;
    const n = ctx.error.attemptsRemaining;
    if (typeof n === 'number' && n > 0) error += ` ${copy.triesLeft(n)}`;
  }
  return {
    title: copy.title,
    intro: copy.intro(what),
    question: pin ? copy.pinQuestion : copy.mathQuestion(ctx.a, ctx.b),
    error,
    inputType: pin ? 'password' : 'text',
    inputMode: 'numeric',
    check: copy.check,
    cancel: copy.cancel,
    answerLabel: copy.answerLabel,
  };
}

/**
 * The sentence a bench shows when `ask` did NOT grant, or '' when there is nothing to say (the grown-up cancelled).
 * @param {{ ok: boolean, reason?: string, status?: string, retryAfterSeconds?: number }} result
 */
export function denialMessage(result, copy = COPY) {
  if (!result || result.ok) return '';
  switch (result.reason) {
    case 'cancelled': return '';
    case 'cooldown': return copy.cooldown(Math.max(1, Math.round(result.retryAfterSeconds ?? 60)));
    case 'unavailable': return describeStatus(result.status ?? 'unavailable');
    default: return copy.denied;
  }
}

const STYLE_ID = 'bgate-style';
const CSS = `
/* Doubled class: the Workshop shell forces \`position: absolute\` on whatever sits in its stage, and a host's own rules must not turn this into something smaller than the page. */
.bgate.bgate { position: fixed; inset: 0; z-index: 2147483000; display: grid; place-items: center; padding: 16px; background: rgba(16, 47, 92, 0.62);
  font: 400 16px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1b2238; }
.bgate *, .bgate *::before, .bgate *::after { box-sizing: border-box; }
.bgate .bgate-card { width: min(380px, 100%); background: #fff; border-radius: 18px; padding: 20px 20px 18px; box-shadow: 0 18px 48px rgba(0, 0, 0, 0.35); }
/* Longhand font properties on purpose: \`font: ... inherit\` is not valid CSS (the family cannot be a CSS-wide keyword inside the shorthand) and the whole rule would be dropped. */
.bgate .bgate-card h3 { margin: 0 0 6px; font-family: inherit; font-size: 18px; font-weight: 800; line-height: 1.25; letter-spacing: -0.01em; }
.bgate .bgate-card p { margin: 0 0 10px; font-family: inherit; font-size: 14px; font-weight: 500; line-height: 1.4; color: #5d657c; }
.bgate .bgate-card .bgate-q { margin: 0 0 8px; font-size: 17px; font-weight: 750; line-height: 1.3; color: #1b2238; }
.bgate .bgate-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.bgate .bgate-input { flex: 1 1 120px; min-width: 0; font-family: inherit; font-size: 20px; font-weight: 650; line-height: 1.2; padding: 8px 12px; border: 2px solid rgba(27, 34, 56, 0.2); border-radius: 12px; background: #fff; color: #1b2238; }
.bgate .bgate-input:focus-visible, .bgate .bgate-btn:focus-visible { outline: 3px solid #2e6fdb; outline-offset: 2px; }
.bgate .bgate-btn { font-family: inherit; font-size: 15px; font-weight: 750; line-height: 1; padding: 11px 16px; min-height: 44px; border-radius: 12px; border: 2px solid rgba(27, 34, 56, 0.18); background: #fff; color: #1b2238; cursor: pointer; }
.bgate .bgate-btn.bgate-go { background: #ff6b4a; border-color: #ff6b4a; color: #fff; }
.bgate .bgate-btn:disabled { opacity: 0.55; cursor: default; }
.bgate .bgate-err { margin: 8px 0 0; font-family: inherit; font-size: 14px; font-weight: 650; line-height: 1.35; color: #b4321a; }
.bgate .bgate-err[hidden] { display: none; }
`;

/**
 * @param {{ root: HTMLElement, doc?: Document, copy?: object }} opts `root`: where the dialog goes (inside the overlay that should treat it as an open layer).
 * @returns {{ prompt(ctx: object): Promise<{ answer: number } | { pin: string } | null>, close(): void, isOpen(): boolean }}
 */
export function createGateModal({ root, doc = root.ownerDocument, copy = COPY }) {
  let el = null; // { wrap, card, title, intro, question, input, error, go, cancel }
  let settle = null; // resolves the open prompt
  let returnFocus = null;

  function ensureStyle() {
    if (doc.getElementById(STYLE_ID)) return;
    const s = doc.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    doc.head.append(s);
  }

  function build() {
    ensureStyle();
    const h = (tag, props = {}, ...kids) => {
      const n = doc.createElement(tag);
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else n.setAttribute(k, v === true ? '' : v);
      }
      n.append(...kids);
      return n;
    };
    const title = h('h3', { id: 'bgate-title' });
    const intro = h('p', { id: 'bgate-intro' });
    const question = h('p', { class: 'bgate-q', id: 'bgate-q' });
    const input = h('input', { class: 'bgate-input', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-describedby': 'bgate-q bgate-err' });
    const go = h('button', { type: 'button', class: 'bgate-btn bgate-go' });
    const cancel = h('button', { type: 'button', class: 'bgate-btn' });
    const error = h('p', { class: 'bgate-err', id: 'bgate-err', role: 'alert', hidden: true });
    const card = h('div', { class: 'bgate-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'bgate-title', 'aria-describedby': 'bgate-intro' },
      title, intro, question, h('div', { class: 'bgate-row' }, input, go, cancel), error);
    const wrap = h('div', { class: 'bgate' }, card);
    el = { wrap, card, title, intro, question, input, error, go, cancel };

    // Everything typed in here stays in here: a bench's own keys (WASD, Space, E, H...) must not fire while someone types an answer.
    wrap.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); finish(null); return; }
      if (e.key === 'Enter' && e.target === input) { e.preventDefault(); submit(); return; }
      if (e.key === 'Tab') { // keep focus inside the dialog
        const stops = [input, go, cancel].filter((n) => !n.disabled);
        const first = stops[0], last = stops[stops.length - 1];
        if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    for (const type of ['keyup', 'keypress']) wrap.addEventListener(type, (e) => e.stopPropagation());
    input.addEventListener('input', () => { go.disabled = input.value.trim() === ''; });
    go.addEventListener('click', submit);
    cancel.addEventListener('click', () => finish(null));
    root.append(wrap);
  }

  let mode = 'math';
  function submit() {
    if (!el || el.go.disabled) return;
    const v = el.input.value.trim();
    if (!v) return;
    if (mode === 'pin') return busyThen({ pin: v });
    const n = Number(v);
    if (!Number.isFinite(n)) {
      el.error.textContent = copy.notANumber;
      el.error.hidden = false;
      el.input.focus();
      return;
    }
    busyThen({ answer: n });
  }
  function busyThen(value) {
    el.go.disabled = true;
    el.go.textContent = copy.checking;
    el.input.disabled = true;
    const done = settle;
    settle = null;
    done?.(value);
  }
  function finish(value) {
    const done = settle;
    settle = null;
    done?.(value);
  }

  function fill(ctx) {
    const t = gateCopy(ctx, copy);
    mode = ctx.mode === 'pin' ? 'pin' : 'math';
    el.title.textContent = t.title;
    el.intro.textContent = t.intro;
    el.question.textContent = t.question;
    el.input.type = t.inputType;
    el.input.setAttribute('inputmode', t.inputMode);
    el.input.setAttribute('aria-label', t.answerLabel);
    el.input.disabled = false;
    el.input.value = '';
    el.go.textContent = t.check;
    el.go.disabled = true;
    el.cancel.textContent = t.cancel;
    el.error.textContent = t.error;
    el.error.hidden = !t.error;
  }

  return {
    prompt(ctx) {
      if (!el) {
        returnFocus = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : null;
        build();
      }
      fill(ctx);
      el.input.focus();
      return new Promise((resolve) => { settle = resolve; });
    },
    /** Remove the dialog; a question still open is settled with null (Cancel). Safe to call when nothing is open. */
    close() {
      finish(null);
      if (el) {
        el.wrap.remove();
        el = null;
        const back = returnFocus;
        returnFocus = null;
        try { back?.focus?.({ preventScroll: true }); } catch { /* the element is gone */ }
      }
    },
    isOpen: () => el !== null,
  };
}
