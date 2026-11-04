// The microphone button of Describe & build: say what to build instead of typing it.
//
//   const voice = createVoiceInput({ onText: (words) => { box.value = words; }, onStatus: (line) => say(line) });
//   row.append(voice.node);            // a round 🎤 button, hidden until the route says it can listen
//
// WHAT IT DOES. One free GET asks the app's own route (worker/transcribe.ts, POST/GET /api/transcribe) whether voice input is on; only an `enabled: true` shows the button. A static
// server, a Worker with no speech model of ours behind it, or any error leaves it hidden and the tab exactly as it was. Nothing is recorded, and the microphone is not even asked
// for, until the child presses the button. A press starts listening (the browser asks permission the first time); a tap stops it, or letting go of a press held for more than a
// moment stops it, or 8 seconds pass. The recording is kept in memory only, sent once to the app's own route, and dropped. The words that come back go into the text box for the
// child to SEE and change: nothing is built until the child presses Build it.
//
// WHAT IT NEVER DOES. It never auto-builds, never keeps the audio or the words anywhere (no storage of any kind), never talks to anything but the app's own route, and always
// stops every microphone track when a recording ends, fails, is cancelled or the panel closes.
//
// Everything the browser provides is injected (`getUserMedia`, `MediaRecorderClass`, `fetchImpl`, the clock and timers), so the controller is tested without a browser (tests/describe-voice.test.ts)
// and in a real one with Chrome's fake microphone (parts/kip/viewer/tools/e2e_describe.mjs, section [7]).

export const MAX_MS = 8000;           // a recording stops by itself after this long
export const HOLD_MS = 600;           // a press held this long is "hold to talk": letting go stops it. A shorter press is a tap: it keeps listening until the next tap
export const MIN_MS = 500;            // a recording shorter than this is a slip of the finger, not speech
export const UPLOAD_TIMEOUT_MS = 30000;
const MIMES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];
const ALLOWED = new Set(['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav']);   // what the route accepts (worker/transcribe.ts)

/** The first recording format this browser can make that the route accepts, or '' to let the browser choose. */
export function pickMime(isTypeSupported) {
  for (const m of MIMES) { try { if (isTypeSupported(m)) return m; } catch { /* an odd browser: try the next */ } }
  return '';
}
/** `audio/webm;codecs=opus` -> `audio/webm`. */
export const baseType = (mime) => String(mime || '').split(';')[0].trim().toLowerCase();

/** What the child is told, in words a small child can read. */
export const SAY = {
  listening: 'Listening… say it, then tap again.',
  thinking: 'Thinking about what you said…',
  heard: (words) => `I heard: "${words}". Press Build it, or change the words.`,
  heardKept: (words) => `I heard: "${words}". I left your words as they are.`,
  denied: 'I cannot hear you yet. Ask a grown-up to let this page use the microphone, or type it.',
  noMic: 'I cannot find a microphone. Type it instead!',
  tooShort: 'That was very short. Press the button and say it again.',
  failed: 'I could not hear that. Try again, or type it.',
  busy: 'One moment, then try again.',
  unsupported: 'This browser cannot listen. Type it instead!',
};

const make = (doc, tag, attrs = {}, ...kids) => {
  const n = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'class') n.className = v; else n.setAttribute(k, v); }
  n.append(...kids);
  return n;
};

export function createVoiceInput({
  doc = globalThis.document, fetchImpl = globalThis.fetch, url = '/api/transcribe',
  getUserMedia = (c) => globalThis.navigator.mediaDevices.getUserMedia(c), MediaRecorderClass = globalThis.MediaRecorder,
  maxMs = MAX_MS, holdMs = HOLD_MS, minMs = MIN_MS, now = () => Date.now(),
  setTimeout: later = (fn, ms) => globalThis.setTimeout(fn, ms), clearTimeout: cancelLater = (id) => globalThis.clearTimeout(id),
  onText = () => {}, onStatus = () => {}, onState = () => {}, currentText = () => '',
} = {}) {
  const node = make(doc, 'button', { type: 'button', class: 'kdb-mic', 'aria-label': 'Say what to build', 'aria-pressed': 'false', title: 'Say what to build', hidden: '' }, '🎤');
  let state = 'hidden';            // hidden | idle | asking | listening | thinking
  let run = 0;                     // bumps whenever a recording is cancelled or finished: an answer from an older one is dropped
  let available = null;
  let stream = null, recorder = null, chunks = [], startedAt = 0, timer = 0, pressedAt = 0, released = false, textAtStart = '', mime = '';

  const setState = (s) => {
    state = s;
    node.setAttribute('aria-pressed', String(s === 'listening'));
    node.setAttribute('aria-label', s === 'listening' ? 'Stop listening' : 'Say what to build');
    node.classList.toggle('kdb-mic-on', s === 'listening');
    node.disabled = s === 'thinking';
    node.textContent = s === 'listening' ? '⏹' : s === 'thinking' ? '…' : '🎤';
    onState(s);
  };
  const stopTracks = () => { try { stream?.getTracks().forEach((t) => t.stop()); } catch { /* already stopped */ } stream = null; };
  const clearTimer = () => { if (timer) { cancelLater(timer); timer = 0; } };

  /** One free GET: is voice input on? Remembered. Shows the button only when it is. */
  async function probe() {
    if (available === null) {
      try { const res = await fetchImpl(url); available = res.ok && (await res.json())?.enabled === true; } catch { available = false; }
      if (available && (!MediaRecorderClass || !getUserMedia)) available = false;   // a browser that cannot record shows no button
    }
    if (available && state === 'hidden') { node.hidden = false; setState('idle'); }
    return available;
  }
  const hide = () => { available = false; node.hidden = true; setState('hidden'); };

  async function upload(blob, mine) {
    const type = ALLOWED.has(baseType(blob.type)) ? baseType(blob.type) : baseType(mime);
    const abort = typeof AbortController === 'function' ? new AbortController() : null;
    const stop = abort ? later(() => abort.abort(), UPLOAD_TIMEOUT_MS) : 0;
    try {
      const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': type }, body: blob, ...(abort ? { signal: abort.signal } : {}) });
      if (mine !== run) return;
      if (res.status === 503) { hide(); onStatus(SAY.unsupported); return; }
      if (res.status === 429) { setState('idle'); onStatus(SAY.busy); return; }
      if (!res.ok) throw new Error(String(res.status));
      const body = await res.json();
      if (mine !== run) return;
      const words = typeof body?.text === 'string' ? body.text.trim() : '';
      setState('idle');
      if (!words) { onStatus(typeof body?.note === 'string' && body.note ? body.note : SAY.failed); return; }
      if (currentText() !== textAtStart) { onStatus(SAY.heardKept(words)); return; }   // the child typed meanwhile: do not overwrite it
      onText(words);
      onStatus(SAY.heard(words));
    } catch {
      if (mine === run) { setState('idle'); onStatus(SAY.failed); }
    } finally {
      if (stop) cancelLater(stop);
    }
  }

  /** The recorder has finished: free the microphone, then send what was said (unless it was too short or was cancelled). */
  function finished(mine) {
    clearTimer();
    stopTracks();
    const took = now() - startedAt;
    const parts = chunks; chunks = []; recorder = null;
    if (mine !== run) return;
    const blob = new Blob(parts, { type: mime || (parts[0]?.type ?? '') });
    if (took < minMs || blob.size === 0) { setState('idle'); onStatus(SAY.tooShort); return; }
    setState('thinking');
    onStatus(SAY.thinking);
    void upload(blob, mine);
  }

  async function start() {
    if (state !== 'idle') return false;
    const mine = ++run;
    setState('asking');
    textAtStart = currentText();
    let s;
    try {
      s = await getUserMedia({ audio: true });      // the browser asks the first time; nothing has been recorded yet
    } catch (err) {
      if (mine !== run) return false;
      setState('idle');
      onStatus(err && (err.name === 'NotAllowedError' || err.name === 'SecurityError') ? SAY.denied : err && err.name === 'NotFoundError' ? SAY.noMic : SAY.failed);
      return false;
    }
    if (mine !== run) { try { s.getTracks().forEach((t) => t.stop()); } catch { /* gone */ } return false; }   // cancelled while the browser was asking
    stream = s;
    try {
      mime = pickMime((m) => MediaRecorderClass.isTypeSupported?.(m) ?? false);
      recorder = mime ? new MediaRecorderClass(stream, { mimeType: mime }) : new MediaRecorderClass(stream);
      mime = recorder.mimeType || mime;
      chunks = [];
      recorder.addEventListener('dataavailable', (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); });
      recorder.addEventListener('stop', () => finished(mine));
      recorder.addEventListener('error', () => { if (mine === run) { run++; stopTracks(); clearTimer(); setState('idle'); onStatus(SAY.failed); } });
      recorder.start();
    } catch {
      stopTracks(); setState('idle'); onStatus(SAY.failed); return false;
    }
    startedAt = now();
    setState('listening');
    onStatus(SAY.listening);
    timer = later(() => stop(), maxMs);
    if (released) stop();      // a hold that was let go while the browser was still asking
    return true;
  }

  /** Stop listening and send what was said. The recorder's own `stop` event does the rest (finished). */
  function stop() {
    if (state !== 'listening') return false;
    clearTimer();
    setState('thinking');
    onStatus(SAY.thinking);
    try { recorder.stop(); } catch { run++; stopTracks(); setState('idle'); onStatus(SAY.failed); }
    return true;
  }

  /** Throw the recording away (the panel closed, a new build started): nothing is sent, the microphone is freed. */
  function cancel() {
    run++;
    clearTimer();
    try { if (recorder && recorder.state !== 'inactive') recorder.stop(); } catch { /* already stopped */ }
    recorder = null; chunks = [];
    stopTracks();
    if (state !== 'hidden') setState('idle');
  }

  // a press: start (or, while listening, stop); letting go of a press held past `holdMs` stops it. The keyboard toggles through click (detail 0).
  node.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    pressedAt = now(); released = false;
    if (state === 'idle') void start();
    else if (state === 'listening') { pressedAt = 0; stop(); }
  });
  node.addEventListener('pointerup', () => {
    if (!pressedAt) return;
    const held = now() - pressedAt >= holdMs;
    pressedAt = 0;
    if (!held) return;
    released = true;
    if (state === 'listening') stop();
  });
  node.addEventListener('click', (e) => {
    if (e.detail !== 0) return;
    if (state === 'idle') { released = false; void start(); } else if (state === 'listening') stop();
  });

  return {
    node, probe, start, stop, cancel,
    dispose() { cancel(); node.remove?.(); },
    get state() { return state; },
    get available() { return available; },
  };
}
