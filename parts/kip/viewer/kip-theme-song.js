// The theme song card (Describe & build, and later the end-of-level card): a name and a sung theme song for what a child just made.
//
//   const theme = createThemeSong({ url: '/api/theme-song' });
//   panel.append(theme.node);
//   theme.start('a giant stomping robot');   // not awaited: it runs beside the build
//
// WHAT HAPPENS. `start` asks the app's own route (worker/themeSong.ts) for a name and checked words. The name and the words show as soon as the
// route answers (seconds). The song itself takes minutes, so the card says so, polls the route, and offers a tune from the starter library of
// the same mood to listen to while it waits (measured 2026-11-03: a short theme song was ready 32 s after it was ordered, so the wait is short). When the song is ready it swaps to it (at once if the stand-in was playing) and the song is kept in
// this browser's "My songs" list (localStorage, per device: the audio link lasts 30 days, copying the audio to our own storage needs an R2 bucket).
//
// QUIET WHEN ABSENT. One cheap GET asks whether the route is on. A static server (no /api), a Worker with THEME_SONG off, or any error means the
// card stays hidden and nothing else is asked: the Describe tab works exactly as it did. Nothing is spent unless the route says it is on.
//
// WHAT IS SENT. Only the description the child typed for the build (phone numbers and emails are removed by the route before any model sees them).
// The words and the name come back from the route; this module sends nothing to any provider itself.
const LIST_KEY = 'tv.themeSongs.v1';
const DEVICE_KEY = 'toyforge:device:v1';   // the same anonymous per-device id the game uses (src/lib/sync.ts): the weekly limit is per device
/** Reasons the route gives that carry a sentence meant for the child; anything else it says is never shown. */
const KIND_REASONS = ['idea_not_allowed', 'week_used', 'songs_off', 'budget_spent', 'in_progress'];

/** The device and the family's clock: what every request to the song route carries. Never throws. */
export function themeHeaders(storage = globalThis.localStorage) {
  let id = '';
  try {
    id = storage?.getItem(DEVICE_KEY) ?? '';
    if (!id && globalThis.crypto?.randomUUID) { id = globalThis.crypto.randomUUID(); storage?.setItem(DEVICE_KEY, id); }
  } catch { /* storage blocked: a session-only id still works for the route */ }
  if (!id) id = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `session-${Date.now()}`;
  let tz = 'UTC';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { /* UTC */ }
  return { 'x-device-id': id, 'x-client-timezone': tz };
}
const MAX_KEPT = 20;
const POLL_MS = 4000;
const MAX_WAIT_MS = 12 * 60 * 1000;
const MAX_POLL_FAILS = 6;

const CSS = `
.kts-card { margin: 10px 0 2px; padding: 10px 12px; border-radius: 12px; background: #f3efff; color: #2a2150; }
.kts-card[hidden] { display: none; }
.kts-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.kts-label { font-size: 12px; font-weight: 700; letter-spacing: .02em; text-transform: uppercase; opacity: .75; }
.kts-ai { font-size: 11px; font-weight: 600; opacity: .7; }
.kts-name { margin: 2px 0 4px; font-size: 17px; font-weight: 800; }
.kts-status { margin: 4px 0 6px; font-size: 13px; min-height: 1.3em; }
.kts-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.kts-lyrics { margin: 8px 0 0; font-size: 13px; } .kts-lyrics summary { cursor: pointer; font-weight: 600; }
.kts-lyrics p { margin: 6px 0 0; white-space: pre-line; }
.kts-lyrics b { display: block; margin-top: 6px; font-size: 11px; text-transform: uppercase; opacity: .7; }
.kts-card button.kts-play { background: #6a4cff; border-color: #6a4cff; color: #fff; }
@media (prefers-color-scheme: dark) { .kts-card { background: #2a2150; color: #f1ecff; } }
`;

const make = (doc, tag, attrs = {}, ...kids) => {
  const n = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v); }
  n.append(...kids);
  return n;
};

/** The songs kept on this device, newest first. Never throws: blocked or damaged storage is an empty list. */
export function readSongs(storage = globalThis.localStorage) {
  try {
    const raw = JSON.parse(storage?.getItem(LIST_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((s) => s && typeof s.name === 'string' && typeof s.url === 'string').slice(0, MAX_KEPT) : [];
  } catch { return []; }
}
function keepSong(storage, song) {
  try {
    const next = [song, ...readSongs(storage).filter((s) => s.task !== song.task)].slice(0, MAX_KEPT);
    storage?.setItem(LIST_KEY, JSON.stringify(next));
  } catch { /* storage blocked: the song still plays this session */ }
}

export function createThemeSong({
  doc = globalThis.document, fetchImpl = globalThis.fetch, url = '/api/theme-song', storage = globalThis.localStorage,
  libraryUrl = '/kip/songs/index.json', libraryBase = '/kip/songs/', makeAudio = (src) => new globalThis.Audio(src),
  pollMs = POLL_MS, maxWaitMs = MAX_WAIT_MS, now = () => Date.now(), onChange = () => {},
  onSong = () => {},   // called with the kept song when it is ready (the Kip bench measures it so Kip can dance to it)
} = {}) {
  if (doc && !doc.getElementById('kts-style')) doc.head.append(make(doc, 'style', { id: 'kts-style' }, CSS));
  const label = make(doc, 'span', { class: 'kts-label' }, 'Theme song');
  const ai = make(doc, 'span', { class: 'kts-ai' }, 'Made by AI');
  const nameEl = make(doc, 'p', { class: 'kts-name' }, '');
  const statusEl = make(doc, 'p', { class: 'kts-status', role: 'status', 'aria-live': 'polite' }, '');
  const standIn = make(doc, 'button', { type: 'button', hidden: '' }, 'Hear a tune while you wait');
  const playBtn = make(doc, 'button', { type: 'button', class: 'kts-play', hidden: '' }, 'Play your song');
  const lyricsP = make(doc, 'p', {}, '');
  const lyrics = make(doc, 'details', { class: 'kts-lyrics', hidden: '' }, make(doc, 'summary', {}, 'The words'), lyricsP);
  const node = make(doc, 'section', { class: 'kts-card', 'aria-label': 'Theme song', hidden: '' }, make(doc, 'div', { class: 'kts-head' }, label, ai), nameEl, statusEl, make(doc, 'div', { class: 'kts-row' }, standIn, playBtn), lyrics);

  let state = 'idle';          // idle | unavailable | writing | making | ready | failed
  let run = 0;                 // bumps on every start/cancel: an answer from an older run is dropped
  let timer = 0, audio = null, audioKind = null, available = null, library = null, current = null, song = null;

  const setState = (s, text) => { state = s; if (text !== undefined) statusEl.textContent = text; onChange(s); };
  const stopAudio = () => { if (audio) { try { audio.pause(); } catch { /* already stopped */ } audio = null; audioKind = null; } standIn.textContent = 'Hear a tune while you wait'; playBtn.textContent = 'Play your song'; };
  const clearTimer = () => { if (timer) { clearTimeout(timer); timer = 0; } };

  let quota = null;       // what this device has left this week, from the last probe (null: unknown or an unmetered route)
  async function isOn(fresh = false) {
    if (available === false) return false;                 // the route said it is off: it stays off for this page, and nothing is asked again
    if (available !== null && !fresh) return available;
    try {
      const res = await fetchImpl(url, { headers: themeHeaders(storage) });
      const body = res.ok ? await res.json() : null;
      available = body?.enabled === true;
      const q = body?.quota;
      quota = available && q && Number.isInteger(q.left) && typeof q.makerOn === 'boolean' ? { left: q.left, makerOn: q.makerOn } : null;
    } catch { available = false; quota = null; }
    return available;
  }
  /** A kind sentence in place of a song (the week is used up, a grown-up switched songs off). The card stays, the build carries on. */
  function showNote(text) {
    node.hidden = false; nameEl.textContent = ''; lyrics.hidden = true; standIn.hidden = true; playBtn.hidden = true;
    setState('failed', text);
  }

  function show(parts) {
    nameEl.textContent = parts.name;
    lyricsP.replaceChildren(make(doc, 'b', {}, 'Verse'), parts.verse.join('\n'), make(doc, 'b', {}, 'Chorus'), parts.chorus.join('\n'));
    lyrics.hidden = false;
    node.hidden = false;
  }

  /** The stand-in: a starter-library tune of the same mood, so the wait has music. Absent (no index, no match) means no button. */
  async function loadStandIn(mood) {
    try {
      library ??= (await (await fetchImpl(libraryUrl)).json())?.songs ?? [];
      const match = library.find((s) => s?.mood === mood && typeof s.file === 'string' && /^[\w.-]+\.mp3$/.test(s.file)) ?? library.find((s) => typeof s?.file === 'string' && /^[\w.-]+\.mp3$/.test(s.file));
      if (match) { current = { ...current, standInSrc: libraryBase + match.file }; if (state === 'making') standIn.hidden = false; }
    } catch { /* no stand-in: the wait is silent */ }
  }

  function play(src, kind) {
    stopAudio();
    audio = makeAudio(src);
    audioKind = kind;
    audio.loop = kind === 'standin';
    audio.volume = kind === 'standin' ? 0.5 : 0.9;
    audio.addEventListener?.('ended', () => { if (audioKind === kind) { audio = null; audioKind = null; (kind === 'song' ? playBtn : standIn).textContent = kind === 'song' ? 'Play your song' : 'Hear a tune while you wait'; } });
    (kind === 'song' ? playBtn : standIn).textContent = kind === 'song' ? 'Stop' : 'Stop the tune';
    return Promise.resolve(audio.play?.()).catch(() => { stopAudio(); });   // blocked autoplay: the button is there to press
  }

  function ready(link, durationMs) {
    clearTimer();
    const wasStandIn = audioKind === 'standin';
    standIn.hidden = true;
    setState('ready', `Your song is ready${durationMs ? ` (${Math.round(durationMs / 1000)} seconds)` : ''}!`);
    song = { name: current.name, verse: current.verse, chorus: current.chorus, mood: current.mood, url: link, task: current.task, madeAt: new Date(now()).toISOString() };
    keepSong(storage, song);
    try { Promise.resolve(onSong(song)).catch(() => {}); } catch { /* a listener that fails never spoils the song */ }
    playBtn.hidden = false; playBtn.dataset.src = link;
    if (wasStandIn) play(link, 'song'); else stopAudio();
  }

  function poll(myRun, startedAt, fails = 0) {
    timer = setTimeout(async () => {
      if (myRun !== run) return;
      let answer = null;
      try {
        const res = await fetchImpl(`${url}?id=${encodeURIComponent(current.task)}`, { headers: themeHeaders(storage) });
        if (res.status === 429) { poll(myRun, startedAt, fails); return; }           // told to slow down: wait one more turn, not a failure
        if (!res.ok) throw new Error(String(res.status));
        answer = await res.json();
      } catch {
        if (myRun !== run) return;
        if (fails + 1 >= MAX_POLL_FAILS) { standIn.hidden = true; setState('failed', 'The song could not be finished this time. The name and the words are still yours.'); return; }
        poll(myRun, startedAt, fails + 1); return;
      }
      if (myRun !== run) return;
      if (answer?.status === 'ready' && typeof answer.url === 'string') { ready(answer.url, answer.durationMs); return; }
      if (answer?.status === 'failed') { standIn.hidden = true; setState('failed', 'The song could not be finished this time. The name and the words are still yours.'); return; }
      if (now() - startedAt > maxWaitMs) { standIn.hidden = true; setState('failed', 'The song is taking too long. The name and the words are still yours.'); return; }
      poll(myRun, startedAt, 0);
    }, pollMs);
  }

  /** Name the creation and start its song. Resolves when the NAME is in (not the song). Never throws; a card that cannot work stays hidden. */
  async function start(description) {
    const myRun = ++run;
    clearTimer(); stopAudio();
    song = null; current = null; node.hidden = true; standIn.hidden = true; playBtn.hidden = true; lyrics.hidden = true;
    const text = String(description ?? '').trim();
    if (!text) { setState('idle'); return false; }
    if (!(await isOn(true)) || myRun !== run) { if (myRun === run) setState('unavailable'); return false; }
    if (quota && quota.makerOn === false) { showNote('Songs are switched off by a grown-up.'); return false; }
    if (quota && quota.left <= 0) { showNote('No new songs until Monday. Dance to the ones you made!'); return false; }
    node.hidden = false; nameEl.textContent = 'Thinking of a name…';
    setState('writing', 'Writing the song…');
    let body;
    try {
      const key = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `tap-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
      const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', ...themeHeaders(storage) }, body: JSON.stringify({ description: text.slice(0, 300), key }) });
      if (!res.ok) {
        let why = '';
        try { const j = await res.json(); if (KIND_REASONS.includes(j?.reason) && typeof j.error === 'string') why = j.error.slice(0, 80); } catch { /* no body */ }
        throw Object.assign(new Error(String(res.status)), { why });
      }
      body = await res.json();
    } catch (err) {
      if (myRun !== run) return false;
      if (err && err.why) { showNote(err.why); return false; }
      node.hidden = true; setState('unavailable'); return false;       // no song this time: the build carries on without a card
    }
    if (myRun !== run) return false;
    if (typeof body?.name !== 'string' || !Array.isArray(body.verse) || !Array.isArray(body.chorus)) { node.hidden = true; setState('unavailable'); return false; }
    current = { name: body.name, verse: body.verse.map(String), chorus: body.chorus.map(String), mood: String(body.mood ?? ''), task: body.task ? String(body.task) : null };
    show(current);
    if (!current.task) { setState('failed', body.songError ? `${body.songError} The name and the words are still yours.` : 'No song this time. The name and the words are still yours.'); return true; }
    setState('making', 'Singing your song. This takes about a minute, so keep building!');
    loadStandIn(current.mood);
    poll(myRun, now());
    return true;
  }

  standIn.addEventListener('click', () => { if (audioKind === 'standin') stopAudio(); else if (current?.standInSrc) play(current.standInSrc, 'standin'); });
  playBtn.addEventListener('click', () => { if (audioKind === 'song') stopAudio(); else if (song) play(song.url, 'song'); });

  return {
    node, start,
    /** Stop everything and hide the card (a new build, or closing the panel's song). */
    /** Stop any sound but keep the card (the panel closed). */
    silence() { stopAudio(); },
    cancel() { run++; clearTimer(); stopAudio(); node.hidden = true; if (state !== 'unavailable') state = 'idle'; },
    dispose() { run++; clearTimer(); stopAudio(); node.remove(); },
    get state() { return state; },
    get name() { return current?.name ?? ''; },
    get song() { return song; },
    list: () => readSongs(storage),
  };
}
