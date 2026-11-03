// SPDX-License-Identifier: Apache-2.0
// The little workshop: the waiting state shared by the Describe & build tab and the photo "Print it" panel (and the Forge screen when it exists).
//
// A wait of several seconds must not look frozen, and it must not lie about progress. So the strip is honest decoration plus real signals: a belt
// carries random common bricks that appear, sometimes pop away, and drop into a parts pile; the words say what is happening; and the pile never
// fills before the real answer (the last PILE_HELD_BACK bricks are held back for it). Nothing shows if the answer is quick (delayMs). With reduced
// motion the belt is still and three bricks sit on it. It never touches a 3D scene, holds no listener on window or document, and everything it
// starts (timers, bricks) is let go by stop().
//
// Two ways to drive it:
//   timed   start({ lines, delayMs })   nothing tells us how far along the work is (one model call): the words change on a clock and the pile fills on
//                                       a gentle curve. setLines(...) switches the wording, e.g. from thinking to drawing.
//   staged  start({ staged: true })     the work reports real stages (a job's status, a gate try): setStage(name, detail) sets the words, moves the
//                                       pile to the count of FINISHED stages (never backwards), and shows what the stage is: a scan light while it
//                                       checks, a brick popping out and a fresh one riding in on a repair, a paused belt and a real countdown on a rest.
//
//   const ws = createWorkshop({ doc, onLabel: (text) => { statusLine.textContent = text; } });   // put ws.node in the page
//   ws.start({ staged: true });  ws.setStage('checking', { call: 1 });  ws.setStage('rest', { seconds: 8 });  ws.stop({ finished: true });
//
// Stage names (aliases cover a Forge job's own statuses, spec docs/specs/forge-ai-spec.md "Naming and the waiting state"):
//   asking (queued, proposing, asking_again) · preview (preview_ready) · checking (validating, optimizing; `call` n > 1 is a retry) ·
//   repair (repairing) · fetching (fetching_plate) · rest (waiting; `seconds` counts down on its own). An unknown name is ignored.
// `detail.label` replaces the default words: a string, or for a rest a function of the seconds left.

const BRICK_COLOURS = ['#FF5A4D', '#52B7FF', '#FFD24D', '#2FAE7E', '#FF9D5C', '#A78BFF', '#F4EFE6'];
export const THINK_LINES = [[0, 'Looking through the parts bin…'], [3, 'Sorting the bricks…'], [6, 'Finding parts that fit…'], [10, 'Still looking, thank you for waiting…']];
export const DRAW_LINES = [[0, 'Laying out the parts…'], [6, 'Almost there…']];
export const LOAD_LINES = [[0, 'Loading the part list…']];
const PILE_SPOTS = [[0, 0], [1, 0], [2, 0], [3, 0], [0.5, 1], [1.5, 1], [2.5, 1], [1, 2], [2, 2], [1.5, 3]];   // a pyramid: (column, row), bottom row first
export const PILE_SIZE = PILE_SPOTS.length;
export const PILE_HELD_BACK = 2;                                                                                 // bricks nothing but the real answer can place
const MAX_ON_BELT = 6;

/** What each real stage means: how many pile bricks its completion is worth (`floor`), and how it looks. */
export const STAGES = {
  asking: { floor: 1, label: () => 'Looking through the parts bin…' },
  preview: { floor: 4, label: () => 'Here is your first look. Checking it can print…' },
  checking: { floor: 5, scan: true, label: ({ call }) => (call > 1 ? `Checking it can print… (try ${call})` : 'Checking it can print…') },
  repair: { floor: 5, scan: true, pop: true, label: () => 'Fixing a thin bit…' },
  fetching: { floor: 7, label: () => 'Getting your file…' },
  rest: { floor: 0, rest: true, label: ({ left }) => `A short rest. Trying again in ${left} s…` },
};
const ALIASES = {
  queued: 'asking', proposing: 'asking', asking_again: 'asking', preview_ready: 'preview', validating: 'checking', optimizing: 'checking',
  repairing: 'repair', waiting: 'rest', fetching_plate: 'fetching',
};
/** A stage name (or alias) to its canonical name, or null. Own keys only: "constructor" and "__proto__" are not stages. */
export const resolveStage = (name) => (typeof name !== 'string' ? null : Object.hasOwn(STAGES, name) ? name : Object.hasOwn(ALIASES, name) ? ALIASES[name] : null);

/** Timed mode: bricks on the pile after `secs` seconds. A gentle curve that never reaches the last PILE_HELD_BACK bricks. */
export const timedPile = (secs) => Math.min(PILE_SIZE - PILE_HELD_BACK, Math.floor(PILE_SIZE * (1 - Math.exp(-Math.max(0, secs) / 5.5))));
/** Staged mode: bricks for `floor` finished stages, plus one that creeps in once the current stage has run 5 s. Capped like the timed curve. */
export const stagedPile = (floor, secsInStage) => Math.min(PILE_SIZE - PILE_HELD_BACK, Math.max(0, floor) + (secsInStage >= 5 ? 1 : 0));

// Every rule starts with .kww-workshop (and the root is div.kww-workshop) so a host's own "panel *" rules, e.g. "transition: none", lose on specificity.
const CSS = `
div.kww-workshop { position: relative; height: 86px; margin: 10px 0 2px; border-radius: 12px; overflow: hidden; background: linear-gradient(#f3f5fa, #e1e6f0); box-shadow: inset 0 0 0 1px #c9cfdc; transition: opacity .35s; }
div.kww-workshop[hidden] { display: none; }
div.kww-workshop.kww-done { opacity: 0; }
.kww-workshop .kww-lane { position: absolute; left: 0; right: 112px; bottom: 26px; height: 24px; }
.kww-workshop .kww-brick { position: absolute; bottom: 0; left: -64px; line-height: 0; animation: kww-ride var(--d, 4s) linear forwards; transition: transform .22s, opacity .22s; }
.kww-workshop .kww-brick .kww-bi { display: block; line-height: 0; }
.kww-workshop .kww-brick.kww-poof { transform: translateY(-14px) scale(.2); opacity: 0; }
.kww-workshop .kww-brick.kww-drop .kww-bi { animation: kww-fall .42s ease-in forwards; }
.kww-workshop .kww-brick.kww-static { animation: none; }
@keyframes kww-ride { from { transform: translateX(0); } to { transform: translateX(var(--run, 230px)); } }
@keyframes kww-fall { to { transform: translate(24px, 44px) rotate(48deg); opacity: 0; } }
.kww-workshop .kww-belt { position: absolute; left: 0; right: 100px; bottom: 8px; height: 18px; border-radius: 9px; background: repeating-linear-gradient(90deg, #3b4560 0 12px, #4a5575 12px 24px); box-shadow: inset 0 -3px 0 rgba(0,0,0,.28), 0 2px 0 #1b2238; animation: kww-belt .5s linear infinite; }
.kww-workshop.kww-done .kww-belt, .kww-workshop.kww-rest .kww-belt, .kww-workshop.kww-rest .kww-brick, .kww-workshop.kww-rest .kww-brick .kww-bi { animation-play-state: paused; }
@keyframes kww-belt { to { background-position-x: 24px; } }
.kww-workshop .kww-pile { position: absolute; right: 8px; bottom: 6px; width: 92px; height: 66px; }
.kww-workshop .kww-pb { position: absolute; line-height: 0; opacity: 0; transform: scale(.3); transition: opacity .18s, transform .3s cubic-bezier(.3, 1.7, .5, 1); }
.kww-workshop .kww-pb.on { opacity: 1; transform: none; }
.kww-workshop.kww-scan::after { content: ''; position: absolute; top: 0; bottom: 0; left: -48px; width: 48px; pointer-events: none; background: linear-gradient(90deg, transparent, rgba(255,255,255,.6), transparent); animation: kww-scan 1.8s linear infinite; }
@keyframes kww-scan { to { left: 100%; } }
@media (prefers-color-scheme: dark) { div.kww-workshop { background: linear-gradient(#26304a, #1b2238); box-shadow: inset 0 0 0 1px #3b4560; } }
@media (prefers-reduced-motion: reduce) { .kww-workshop .kww-belt, .kww-workshop .kww-brick, .kww-workshop .kww-brick .kww-bi { animation: none !important; } .kww-workshop .kww-pb, div.kww-workshop { transition: none; } .kww-workshop.kww-scan::after { display: none; } }
`;

/** A little brick (studs 1 to 4) or a wheel (studs 0), as inline SVG. Static strings only: nothing a user typed ever gets near innerHTML. */
const brickSvg = (studs, colour, scale = 1) => {
  if (studs === 0) return `<svg viewBox="0 0 20 20" width="${20 * scale}" height="${20 * scale}" aria-hidden="true"><circle cx="10" cy="10" r="9.5" fill="#262D40"/><circle cx="10" cy="10" r="4.6" fill="${colour}"/><circle cx="10" cy="10" r="1.6" fill="#262D40"/></svg>`;
  const w = studs * 11, bumps = Array.from({ length: studs }, (_, i) => `<rect x="${i * 11 + 2.5}" y="0" width="6" height="4" rx="2" fill="${colour}"/>`).join('');
  return `<svg viewBox="0 0 ${w} 16" width="${w * scale}" height="${16 * scale}" aria-hidden="true">${bumps}<rect x="0" y="3" width="${w}" height="13" rx="2.5" fill="${colour}"/><rect x="0" y="3" width="${w}" height="4" rx="2.5" fill="#fff" opacity=".3"/><rect x="0" y="12" width="${w}" height="4" rx="2.5" fill="#000" opacity=".17"/></svg>`;
};
const pick = (list) => list[Math.floor(Math.random() * list.length)];

/**
 * @param {{ doc?: Document, onLabel?: (text: string) => void }} [options]  `doc` builds the elements (default: the page's document); `onLabel` receives every
 *   wording change, for the host's own status line (the strip itself is aria-hidden: the host's status line is what a screen reader hears).
 */
export function createWorkshop({ doc = globalThis.document, onLabel = () => {} } = {}) {
  const el = (tag, attrs = {}) => { const n = doc.createElement(tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
  const reducedMotion = () => Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const node = el('div', { class: 'kww-workshop', 'aria-hidden': 'true', hidden: '' });
  const style = el('style');
  style.textContent = CSS;
  const lane = el('div', { class: 'kww-lane' });
  const belt = el('div', { class: 'kww-belt' });
  const pile = el('div', { class: 'kww-pile' });
  const pbs = PILE_SPOTS.map(([c, r], i) => {
    const b = el('span', { class: 'kww-pb' });
    b.innerHTML = brickSvg(2, BRICK_COLOURS[i % BRICK_COLOURS.length], 0.9);
    b.style.left = `${c * 21}px`; b.style.bottom = `${r * 14}px`;
    pile.append(b);
    return b;
  });
  node.append(style, lane, belt, pile);

  let timers = [], active = false, hideTimer = 0, mode = 'timed';
  let t0 = 0, lines = THINK_LINES, line = -1;                       // timed mode
  let stage = null, stageT0 = 0, floorNow = 0, token = 0;           // staged mode
  const later = (fn, ms) => { const id = setTimeout(fn, ms); timers.push(id); return id; };
  const setPile = (n) => pbs.forEach((b, i) => b.classList.toggle('on', i < n));

  function spawn() {
    if (!active || lane.children.length >= MAX_ON_BELT) return;
    const studs = pick([0, 1, 2, 2, 3, 4]), colour = pick(BRICK_COLOURS), dur = 3000 + Math.random() * 1700;
    const outer = el('span', { class: 'kww-brick' }), inner = el('span', { class: 'kww-bi' });
    inner.innerHTML = brickSvg(studs, colour, 1);
    outer.append(inner);
    outer.style.setProperty('--d', `${dur}ms`);
    outer.addEventListener('animationend', (e) => {
      if (e.target !== outer) return;
      outer.classList.add('kww-drop');
      setTimeout(() => outer.remove(), 450);
    });
    lane.append(outer);
    if (Math.random() < 0.35) later(() => { outer.classList.add('kww-poof'); setTimeout(() => outer.remove(), 260); }, dur * (0.25 + Math.random() * 0.4));   // some bricks come and go mid-belt
  }
  function loop() { if (!active) return; if (stage !== 'rest') spawn(); later(loop, 450 + Math.random() * 650); }
  /** A brick that did not fit pops out of the line and a fresh one rides in: what a repair looks like. */
  function popOne() {
    const b = [...lane.children].find((c) => !c.classList.contains('kww-poof') && !c.classList.contains('kww-static'));
    if (b) { b.classList.add('kww-poof'); setTimeout(() => b.remove(), 260); }
    later(spawn, 300);
  }
  function tick() {
    if (!active) return;
    const secs = (performance.now() - (mode === 'timed' ? t0 : stageT0)) / 1000;
    if (mode === 'timed') {
      const want = [...lines].reverse().findIndex(([at]) => secs >= at);
      const i = want < 0 ? 0 : lines.length - 1 - want;
      if (i !== line) { line = i; onLabel(lines[i][1]); }
      setPile(timedPile((performance.now() - t0) / 1000));
    } else setPile(stagedPile(floorNow, secs));
    later(tick, 250);
  }
  function clear() { timers.forEach(clearTimeout); timers = []; clearTimeout(hideTimer); lane.replaceChildren(); }
  function reveal(delayMs) {
    later(() => {
      if (!active) return;
      node.hidden = false;
      node.style.setProperty('--run', `${lane.clientWidth + 64}px`);
      if (reducedMotion()) { [0.12, 0.42, 0.72].forEach((f, i) => { const o = el('span', { class: 'kww-brick kww-static' }); o.innerHTML = brickSvg([2, 4, 0][i], BRICK_COLOURS[i * 2], 1); o.style.left = `${f * lane.clientWidth}px`; lane.append(o); }); }
      else loop();
    }, delayMs);
  }

  return {
    node,
    /** Begin waiting. `delayMs`: stay invisible this long so a quick answer never flashes it (the first label is not delayed). `staged`: see the top. */
    start({ lines: l = THINK_LINES, delayMs = 350, staged = false } = {}) {
      clear(); active = true; mode = staged ? 'staged' : 'timed'; lines = l; line = -1; t0 = performance.now();
      stage = null; stageT0 = t0; floorNow = 0; token++;
      node.classList.remove('kww-done', 'kww-scan', 'kww-rest'); setPile(0);
      tick();
      reveal(delayMs);
    },
    /** Timed mode: switch the wording (and restart its clock) without resetting the pile, e.g. from thinking to drawing. */
    setLines(l) { lines = l; line = -1; t0 = performance.now(); },
    /** Staged mode: the work reached `name` (see the top for the names). Ignored when not waiting or when the name is unknown. */
    setStage(name, detail = {}) {
      const key = resolveStage(name);
      if (!key || !active || mode !== 'staged') return;
      const def = STAGES[key];
      const mine = ++token;
      const call = Number.isFinite(detail.call) && detail.call >= 1 ? Math.floor(detail.call) : 1;
      const retry = key === 'checking' && call > 1;
      stage = key; stageT0 = performance.now();
      node.classList.toggle('kww-scan', Boolean(def.scan));
      node.classList.toggle('kww-rest', Boolean(def.rest));
      floorNow = Math.max(floorNow, Math.min(def.floor + (key === 'checking' ? call - 1 : 0), PILE_SIZE - PILE_HELD_BACK));
      setPile(stagedPile(floorNow, 0));
      if (def.pop || retry) popOne();
      const words = (left) => (typeof detail.label === 'function' ? detail.label(left) : typeof detail.label === 'string' ? detail.label : def.label({ call, left }));
      if (!def.rest) { onLabel(words(0)); return; }
      let left = Number.isFinite(detail.seconds) ? Math.max(0, Math.round(detail.seconds)) : 0;   // a real countdown, one tick a second
      const step = () => { if (!active || token !== mine) return; onLabel(words(left)); if (left > 0) later(() => { left -= 1; step(); }, 1000); };
      step();
    },
    /** Stop waiting. With `finished` the pile completes and the strip fades out; otherwise it just goes. */
    stop({ finished = false } = {}) {
      active = false; stage = null; token++; timers.forEach(clearTimeout); timers = [];
      node.classList.remove('kww-scan', 'kww-rest');
      if (!node.hidden && finished) {
        setPile(PILE_SIZE); node.classList.add('kww-done');
        hideTimer = setTimeout(() => { node.hidden = true; lane.replaceChildren(); node.classList.remove('kww-done'); }, 450);
      } else { node.hidden = true; lane.replaceChildren(); }
    },
    get visible() { return !node.hidden; },
  };
}
