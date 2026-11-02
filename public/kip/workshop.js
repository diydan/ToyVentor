// ToyVentor Workshop shell: one page that hosts the Kip bench and the Truck bench (and later others) behind a tab bar.
//
// Stage 1 of docs/specs/workshop-spec.md. A bench is a whole page that already works on its own (Kip-Demo.html, Truck-Mockup.html); the shell
// embeds ONE at a time in an iframe and swaps it when you pick another tab. That keeps the two pages byte-for-byte untouched (other sessions own
// them), keeps their globals, CSS and WebGL contexts apart (a hidden bench is unloaded, not kept alive), and gives the game a clean boundary to
// mount later: `mountWorkshop(el, { urlSync: false })` needs no globals and does not touch the host's URL or title.
//
// Everything that is a decision about the URL lives in three pure functions (exported, unit-tested in tests/workshop.test.ts):
//   parseWorkshopSearch  ?bench=truck&driver=snap  ->  { id: 'truck', forward: 'driver=snap' }   (every other query param goes to the bench)
//   benchSrc             bench + forward params    ->  the iframe URL
//   workshopSearch       bench id                  ->  '?bench=<id>'
// Forwarded params apply only to the load that came from the URL (a deep link, or Back to one); picking a tab always opens that bench clean, because
// params like `vehicle=truck` mean something only to the bench they were written for.

export const DEFAULT_BENCHES = Object.freeze([
  Object.freeze({ id: 'kip', label: 'Kip', src: '/kip/Kip-Demo.html', note: 'Characters and vehicles, print view, selfie, describe and build' }),
  Object.freeze({ id: 'truck', label: 'Truck', src: '/kip/Truck-Mockup.html', note: 'Mechanical dump truck, Snap to Mech' }),
]);

/** Which bench a location asks for, and the query params that belong to the bench. Unknown or missing ids fall back to the first bench. */
export function parseWorkshopSearch(search, benches = DEFAULT_BENCHES) {
  const params = new URLSearchParams(search);
  const want = params.get('bench');
  const bench = benches.find((b) => b.id === want) ?? benches[0];
  params.delete('bench');
  return { id: bench.id, known: bench.id === want, forward: params.toString() };
}

/** The iframe URL for a bench, with the forwarded params (if any) appended. */
export function benchSrc(bench, forward = '') {
  if (!forward) return bench.src;
  return bench.src + (bench.src.includes('?') ? '&' : '?') + forward;
}

/** The shell's own query string for a bench. */
export function workshopSearch(id) {
  return `?bench=${encodeURIComponent(id)}`;
}

const STYLE_ID = 'ws-style';
const CSS = `
.ws-root { display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; background: #ece5d6; color: #1b2238;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
.ws-root *, .ws-root *::before, .ws-root *::after { box-sizing: border-box; }
.ws-bar { flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; padding: 5px 12px; min-height: 44px;
  background: #fbf8f1; border-bottom: 1px solid rgba(27, 34, 56, 0.12); }
.ws-brand { font-size: 14px; font-weight: 800; letter-spacing: -0.01em; }
.ws-tabs { display: flex; gap: 4px; }
.ws-tab { font: inherit; font-size: 13px; font-weight: 750; color: #5d657c; background: transparent; border: 0; border-radius: 999px;
  padding: 7px 14px; min-height: 34px; cursor: pointer; }
.ws-tab:hover { background: rgba(27, 34, 56, 0.06); color: #1b2238; }
.ws-tab[aria-selected="true"] { background: #1b2238; color: #fff; }
.ws-tab:focus-visible, .ws-pop:focus-visible { outline: 2px solid #2e6fdb; outline-offset: 2px; }
.ws-note { flex: 1 1 200px; min-width: 0; font-size: 12px; font-weight: 600; color: #5d657c; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ws-pop { font-size: 12px; font-weight: 700; color: #1b2238; text-decoration: none; padding: 5px 10px; border-radius: 999px;
  border: 1px solid rgba(27, 34, 56, 0.18); white-space: nowrap; }
.ws-pop:hover { background: #fff; }
.ws-stage { position: relative; flex: 1 1 auto; min-height: 0; background: radial-gradient(circle at 50% 38%, #f5f0e6 0%, #e4dccd 68%, #d2c7b5 100%); }
.ws-frame { display: block; position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: transparent; }
.ws-loading { position: absolute; inset: 0; display: grid; place-items: center; font-size: 13px; font-weight: 700; color: #5d657c; pointer-events: none; }
@media (max-width: 700px) { .ws-note { display: none; } .ws-bar { padding: 4px 8px; } }
`;

function ensureStyle(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const el = doc.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  doc.head.appendChild(el);
}

/**
 * Mount the shell into `root` (an element with a size: the shell fills it).
 * opts: { benches = DEFAULT_BENCHES, urlSync = true }
 *   urlSync  true: the shell owns ?bench= in the address bar (push on tab pick, Back works) and sets document.title.
 *            false: it touches neither (for a host such as the game that owns the URL).
 * Returns { select(id, { push = true, forward = '' }), current(), frame(), benches, destroy() }.
 */
export function mountWorkshop(root, opts = {}) {
  const benches = opts.benches ?? DEFAULT_BENCHES;
  const urlSync = opts.urlSync !== false;
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  ensureStyle(doc);

  root.classList.add('ws-root');
  root.innerHTML = '';
  const bar = doc.createElement('header');
  bar.className = 'ws-bar';
  const brand = doc.createElement('span');
  brand.className = 'ws-brand';
  brand.textContent = 'Workshop';
  const tabs = doc.createElement('div');
  tabs.className = 'ws-tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Benches');
  const note = doc.createElement('span');
  note.className = 'ws-note';
  const pop = doc.createElement('a');
  pop.className = 'ws-pop';
  pop.target = '_blank';
  pop.rel = 'noopener';
  pop.textContent = 'Open on its own page';
  bar.append(brand, tabs, note, pop);
  const stage = doc.createElement('main');
  stage.className = 'ws-stage';
  stage.setAttribute('role', 'tabpanel');
  root.append(bar, stage);

  const tabEls = new Map();
  for (const b of benches) {
    const t = doc.createElement('button');
    t.type = 'button';
    t.className = 'ws-tab';
    t.id = `ws-tab-${b.id}`;
    t.dataset.bench = b.id;
    t.setAttribute('role', 'tab');
    t.textContent = b.label;
    t.addEventListener('click', () => select(b.id));
    tabs.appendChild(t);
    tabEls.set(b.id, t);
  }

  let currentId = null;
  let frameEl = null;
  let loadingEl = null;

  function paintTabs() {
    const bench = benches.find((b) => b.id === currentId);
    for (const [id, t] of tabEls) {
      const on = id === currentId;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    }
    stage.setAttribute('aria-labelledby', `ws-tab-${currentId}`);
    note.textContent = bench.note ?? '';
    pop.href = frameEl ? frameEl.getAttribute('src') : bench.src;
    if (urlSync) doc.title = `Workshop · ${bench.label}`;
  }

  function dropFrame() {
    if (!frameEl) return;
    // Pointing the frame at nothing before removing it lets the browser release the bench's WebGL context right away.
    try { frameEl.src = 'about:blank'; } catch { /* already detached */ }
    frameEl.remove();
    frameEl = null;
    if (loadingEl) { loadingEl.remove(); loadingEl = null; }
  }

  /** The bench page navigated itself (its own "back to Kip" link): keep the tab bar and address bar honest, without reloading anything. */
  function follow() {
    let loc;
    try { loc = frameEl.contentWindow.location; } catch { return; } // cross-origin: nothing to learn
    const hit = benches.find((b) => new URL(b.src, win.location.href).pathname === loc.pathname);
    if (!hit || hit.id === currentId) return;
    currentId = hit.id;
    paintTabs();
    pop.href = loc.href;
    if (urlSync) win.history.replaceState({ ws: hit.id }, '', workshopSearch(hit.id));
  }

  function onFrameLoad(ev) {
    if (ev.currentTarget !== frameEl) return; // a frame we already dropped
    if (loadingEl) { loadingEl.remove(); loadingEl = null; }
    follow();
    // The benches use single-key shortcuts on their own window, which only hear keys while the frame has focus.
    try { frameEl.contentWindow.focus(); } catch { /* nothing to focus */ }
  }

  function select(id, { push = true, forward = '' } = {}) {
    const bench = benches.find((b) => b.id === id);
    if (!bench) throw new Error(`workshop: no bench "${id}"`);
    if (id === currentId && frameEl) {
      try { frameEl.contentWindow.focus(); } catch { /* ignore */ }
      return;
    }
    dropFrame();
    currentId = id;
    // A fresh iframe element on purpose: its first navigation replaces rather than adds a history entry, so the browser's Back button
    // steps between shell states and never into a bench's private history.
    frameEl = doc.createElement('iframe');
    frameEl.className = 'ws-frame';
    frameEl.title = `${bench.label} bench`;
    frameEl.setAttribute('allow', 'camera; fullscreen; clipboard-write');
    frameEl.setAttribute('allowfullscreen', '');
    frameEl.addEventListener('load', onFrameLoad);
    // src before insertion: an iframe inserted without one fires a load event for its empty page, which would clear the loading note too soon.
    frameEl.src = benchSrc(bench, forward);
    loadingEl = doc.createElement('div');
    loadingEl.className = 'ws-loading';
    loadingEl.textContent = `Loading ${bench.label}…`;
    stage.append(frameEl, loadingEl);
    paintTabs();
    // push:false is the first load or a Back/Forward step: the address bar already says what it should.
    if (urlSync && push) win.history.pushState({ ws: id }, '', workshopSearch(id));
  }

  // Tab keys: arrows move focus (a bench is heavy to load, so moving does not switch), Enter or Space on a tab picks it.
  tabs.addEventListener('keydown', (ev) => {
    const order = benches.map((b) => b.id);
    const at = order.indexOf(doc.activeElement?.dataset?.bench);
    if (at < 0) return;
    const to = ev.key === 'ArrowRight' ? (at + 1) % order.length
      : ev.key === 'ArrowLeft' ? (at + order.length - 1) % order.length
      : ev.key === 'Home' ? 0 : ev.key === 'End' ? order.length - 1 : -1;
    if (to < 0) return;
    ev.preventDefault();
    const target = tabEls.get(order[to]);
    for (const t of tabEls.values()) t.tabIndex = t === target ? 0 : -1;
    target.focus();
  });

  const onPop = () => {
    const want = parseWorkshopSearch(win.location.search, benches);
    if (want.id !== currentId) select(want.id, { push: false, forward: want.forward });
  };
  if (urlSync) win.addEventListener('popstate', onPop);

  // First load: whatever the address bar asks for. An unknown ?bench= is rewritten to the bench actually shown.
  const first = urlSync ? parseWorkshopSearch(win.location.search, benches) : { id: benches[0].id, known: true, forward: '' };
  select(first.id, { push: false, forward: first.forward });
  if (urlSync && !first.known && new URLSearchParams(win.location.search).has('bench')) {
    win.history.replaceState({ ws: first.id }, '', workshopSearch(first.id));
  }

  return {
    benches,
    select,
    current: () => currentId,
    frame: () => frameEl,
    destroy() {
      win.removeEventListener('popstate', onPop);
      dropFrame();
      root.innerHTML = '';
      root.classList.remove('ws-root');
    },
  };
}
