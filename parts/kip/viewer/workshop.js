// ToyVentor Workshop shell: one page that hosts the Kip bench and the Truck bench (and later others) behind a tab bar.
//
// Stage 4b of docs/specs/workshop-spec.md. No iframes: each bench is a module (kip-bench.js, truck-bench.js) mounted into the shell's stage
// on ONE shared renderer, camera, controls and loop (bench-stage.js). A bench is mounted the first time its tab is picked (a deep link to the
// Truck never loads the Kip) and then stays mounted: picking another tab only switches which bench is active, so a bench keeps its models, its
// state and its camera while you are away. The shell reaches a bench only through the mount function named in DEFAULT_BENCHES and the handle
// that returns; it knows nothing of a bench's inside.
//
// The shell is also what the game mounts: `mountWorkshop(el, { urlSync: false })` needs no globals and does not touch the host's URL or title.
//
// Everything that is a decision about the URL lives in three pure functions (exported, unit-tested in tests/workshop.test.ts; this file has no static
// imports, so Node can load them; the stage, three.js and the benches are loaded with import() when a tab is first picked):
//   parseWorkshopSearch  ?bench=truck&driver=snap  ->  { id: 'truck', forward: 'driver=snap' }   (every other query param goes to the bench)
//   benchSrc             bench + forward params    ->  the bench's own standalone page URL (the "Open on its own page" link)
//   workshopSearch       bench id                  ->  '?bench=<id>'
// Forwarded params apply when a bench is mounted from the URL (a deep link, or Back to one whose params differ from what is mounted); picking a tab
// switches to the bench as it is, because params like `vehicle=truck` mean something only to the bench they were written for.

export const DEFAULT_BENCHES = Object.freeze([
  Object.freeze({ id: 'kip', label: 'Kip', src: '/kip/Kip-Demo.html', module: '/kip/kip-bench.js?v=10.0', mount: 'mountKipBench', note: 'Characters and vehicles, print view, selfie, describe and build' }),
  Object.freeze({ id: 'truck', label: 'Truck', src: '/kip/Truck-Mockup.html', module: '/kip/truck-bench.js', mount: 'mountTruckBench', note: 'Mechanical dump truck: Snap, Motion, Pro' }),
]);

/** Which bench a location asks for, and the query params that belong to the bench. Unknown or missing ids fall back to the first bench. */
export function parseWorkshopSearch(search, benches = DEFAULT_BENCHES) {
  const params = new URLSearchParams(search);
  const want = params.get('bench');
  const bench = benches.find((b) => b.id === want) ?? benches[0];
  params.delete('bench');
  return { id: bench.id, known: bench.id === want, forward: params.toString() };
}

/** A bench's own standalone page URL, with the forwarded params (if any) appended. */
export function benchSrc(bench, forward = '') {
  if (!forward) return bench.src;
  return bench.src + (bench.src.includes('?') ? '&' : '?') + forward;
}

/** The shell's own query string for a bench. */
export function workshopSearch(id) {
  return `?bench=${encodeURIComponent(id)}`;
}

/** The file name a link points at, without folders, query or hash: how a bench's own link to another bench's page is recognised. */
export function linkFile(href) {
  return String(href ?? '').split('#')[0].split('?')[0].split('/').pop() ?? '';
}

const STYLE_ID = 'ws-style';
const CSS = `
.ws-root { display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; background: #102f5c; color: #fff;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
.ws-root *, .ws-root *::before, .ws-root *::after { box-sizing: border-box; }
.ws-bar { flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; padding: 5px 12px; min-height: 44px;
  background: #0c2749; border-bottom: 1px solid rgba(214, 235, 255, 0.22); }
.ws-brand { font-size: 14px; font-weight: 800; letter-spacing: -0.01em; }
.ws-tabs { display: flex; gap: 4px; }
.ws-tab { font: inherit; font-size: 13px; font-weight: 750; color: #b9d3f2; background: transparent; border: 0; border-radius: 999px;
  padding: 7px 14px; min-height: 34px; cursor: pointer; }
.ws-tab:hover { background: rgba(214, 235, 255, 0.12); color: #fff; }
.ws-tab[aria-selected="true"] { background: #d6ebff; color: #0c2749; }
.ws-tab:focus-visible, .ws-pop:focus-visible { outline: 2px solid #d6ebff; outline-offset: 2px; }
.ws-note { flex: 1 1 200px; min-width: 0; font-size: 12px; font-weight: 600; color: #9fc0e8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ws-pop { font-size: 12px; font-weight: 700; color: #fff; text-decoration: none; padding: 5px 10px; border-radius: 999px;
  border: 1px solid rgba(214, 235, 255, 0.4); white-space: nowrap; }
.ws-pop:hover { background: rgba(214, 235, 255, 0.14); }
.ws-stage { position: relative; flex: 1 1 auto; min-height: 0; overflow: hidden; background: radial-gradient(circle at 50% 38%, #2b66b3 0%, #1c4a8c 55%, #102f5c 100%); /* = BLUEPRINT.gradient in bench-look.js: a test keeps them equal (workshop.js has no imports) */ }
.ws-stage > :not(.ws-loading) { position: absolute; inset: 0; }
.ws-loading { position: absolute; inset: 0; z-index: 5; display: grid; place-items: center; font-size: 13px; font-weight: 700; color: #cfe3ff; pointer-events: none; }
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
 * opts: { benches = DEFAULT_BENCHES, urlSync = true, stageModule = '/kip/bench-stage.js', threeModule = '/kip/vendor/three-kip.js', kipSessionModule = '/kip/kip-session.js?v=10.0' }
 *   urlSync  true: the shell owns ?bench= in the address bar (push on tab pick, Back works) and sets document.title.
 *            false: it touches neither (for a host such as the game that owns the URL).
 * Returns { select(id, { push = true, forward }) -> Promise, current(), bench(id), handles(id), stage(), ready(), benches, destroy() }.
 *   bench(id)    the handle the bench's mount function returned ({ root, ready, dispose, ... }), or null before its first visit.
 *   handles(id)  the object the bench published its handles on (what a standalone page would have put on `window`), or null.
 */
export function mountWorkshop(root, opts = {}) {
  const benches = opts.benches ?? DEFAULT_BENCHES;
  const urlSync = opts.urlSync !== false;
  const stageModule = opts.stageModule ?? '/kip/bench-stage.js';
  const threeModule = opts.threeModule ?? '/kip/vendor/three-kip.js';
  const kipSessionModule = opts.kipSessionModule ?? '/kip/kip-session.js?v=10.0';
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
  const stageEl = doc.createElement('main');
  stageEl.className = 'ws-stage';
  stageEl.setAttribute('role', 'tabpanel');
  root.append(bar, stageEl);

  const tabEls = new Map();
  for (const b of benches) {
    const t = doc.createElement('button');
    t.type = 'button';
    t.className = 'ws-tab';
    t.id = `ws-tab-${b.id}`;
    t.dataset.bench = b.id;
    t.setAttribute('role', 'tab');
    t.textContent = b.label;
    t.addEventListener('click', () => { void select(b.id); });
    tabs.appendChild(t);
    tabEls.set(b.id, t);
  }

  let currentId = null;
  let stage = null;
  let sharedKip = null;
  let stagePromise = null;
  let loadingEl = null;
  let destroyed = false;
  let queue = Promise.resolve();
  const mounted = new Map(); // id -> { handle, globals, forward }

  function paintTabs() {
    const bench = benches.find((b) => b.id === currentId);
    for (const [id, t] of tabEls) {
      const on = id === currentId;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    }
    stageEl.setAttribute('aria-labelledby', `ws-tab-${currentId}`);
    note.textContent = bench.note ?? '';
    pop.href = benchSrc(bench, mounted.get(currentId)?.forward ?? '');
    if (urlSync) doc.title = `Workshop · ${bench.label}`;
  }

  function showLoading(text) {
    if (!loadingEl) {
      loadingEl = doc.createElement('div');
      loadingEl.className = 'ws-loading';
      stageEl.append(loadingEl);
    }
    loadingEl.textContent = text;
  }
  function hideLoading() {
    loadingEl?.remove();
    loadingEl = null;
  }

  /** The one stage (renderer, camera, controls, loop) every bench draws on; made the first time a bench is needed. */
  function ensureStage() {
    stagePromise ??= Promise.all([import(stageModule), import(threeModule), import(kipSessionModule)]).then(([
      { createStage },
      { THREE, OrbitControls, STLLoader, mergeVertices, toCreasedNormals },
      { createKipSession },
    ]) => {
      if (!destroyed) {
        stage = createStage({ THREE, OrbitControls, host: stageEl });
        sharedKip = createKipSession({ THREE, STLLoader, mergeVertices, toCreasedNormals });
        sharedKip.acquire('workshop'); // the host keeps the session alive across bench unmount/remount
      }
      return stage;
    });
    return stagePromise;
  }

  function unmount(id) {
    const m = mounted.get(id);
    if (!m) return;
    stage?.remove(id);
    m.handle.dispose();
    mounted.delete(id);
  }

  async function activate(bench, forward) {
    if (destroyed) return;
    await ensureStage();
    if (destroyed) return;
    let m = mounted.get(bench.id);
    // Params in the URL that differ from what is mounted mean "open this bench as the link says"; a plain tab pick (forward undefined) keeps it as it is.
    if (m && forward !== undefined && forward !== m.forward) { unmount(bench.id); m = null; }
    if (!m) {
      if (currentId === bench.id) showLoading(`Loading ${bench.label}…`);
      const mod = await import(bench.module);
      if (destroyed) return;
      const f = forward ?? '';
      const globals = {};
      const handle = mod[bench.mount](stageEl, {
        stage,
        sharedKip,
        globals,
        getSearch: () => (f ? `?${f}` : ''),
        getHash: () => '',
        embedded: true, // inside a shell: the bench hides its own "back to the app" link, as it did in a frame
      });
      m = { handle, globals, forward: f };
      mounted.set(bench.id, m);
      stage.add(bench.id, handle);
      const done = () => { if (currentId === bench.id) hideLoading(); };
      handle.ready.then(done, done);
    }
    if (currentId === bench.id) {
      stage.activate(bench.id);
      stage.start();
      paintTabs();
    }
  }

  /** Make `id` the shown bench. Resolves when it is mounted and active (its own first load may still be running: see bench(id).ready). */
  function select(id, { push = true, forward } = {}) {
    const bench = benches.find((b) => b.id === id);
    if (!bench) throw new Error(`workshop: no bench "${id}"`);
    currentId = id;
    paintTabs();
    // push:false is the first load or a Back/Forward step: the address bar already says what it should.
    if (urlSync && push) win.history.pushState({ ws: id }, '', workshopSearch(id));
    queue = queue.then(() => activate(bench, forward)).catch((err) => {
      console.error(err);
      if (!destroyed && currentId === id) showLoading(`Could not load ${bench.label}. Try again in a minute.`);
    });
    return queue;
  }

  // A bench's own link to another bench's page (the Truck's "Kip Viewer") switches tabs instead of leaving the shell.
  const onStageClick = (ev) => {
    if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    const a = ev.target?.closest?.('a[href]');
    if (!a || (a.target && a.target !== '_self')) return;
    const file = linkFile(a.getAttribute('href'));
    const hit = benches.find((b) => linkFile(b.src) === file);
    if (!hit) return;
    ev.preventDefault();
    void select(hit.id);
  };
  stageEl.addEventListener('click', onStageClick, true);

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
    // Params in the address that differ from what is mounted reopen the bench as the link says; an address without params keeps it as it is.
    if (want.id !== currentId || (want.forward && want.forward !== mounted.get(want.id)?.forward)) void select(want.id, { push: false, forward: want.forward || undefined });
  };
  if (urlSync) win.addEventListener('popstate', onPop);

  // First load: whatever the address bar asks for. An unknown ?bench= is rewritten to the bench actually shown.
  const first = urlSync ? parseWorkshopSearch(win.location.search, benches) : { id: benches[0].id, known: true, forward: '' };
  void select(first.id, { push: false, forward: first.forward });
  if (urlSync && !first.known && new URLSearchParams(win.location.search).has('bench')) {
    win.history.replaceState({ ws: first.id }, '', workshopSearch(first.id));
  }

  return {
    benches,
    select,
    current: () => currentId,
    bench: (id) => mounted.get(id)?.handle ?? null,
    handles: (id) => mounted.get(id)?.globals ?? null,
    stage: () => stage,
    sharedKip: () => sharedKip,
    ready: () => queue,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      win.removeEventListener('popstate', onPop);
      stageEl.removeEventListener('click', onStageClick, true);
      stage?.stop();
      for (const id of [...mounted.keys()]) unmount(id);
      sharedKip?.releaseRef('workshop');
      sharedKip = null;
      stage?.dispose();
      root.innerHTML = '';
      root.classList.remove('ws-root');
    },
  };
}
