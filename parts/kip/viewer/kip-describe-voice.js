// The microphone button of Describe & build: say what to build instead of typing it.
//
//   const voice = createVoiceInput({ onText: (words) => { box.value = words; }, onStatus: (line) => say(line) });
//   row.append(voice.node);            // a round 🎤 button, hidden until the route says it can listen
//
// WHAT IT DOES. One free GET asks the app's own route (worker/transcribe.ts, POST/GET /api/transcribe) whether voice input is on; only an `enabled: true` shows the button. A static
// server, a Worker with no speech model of ours behind it, or any error leaves it hidden and the tab exactly as it was. Nothing is recorded, and the microphone is not even asked
// for, until the child presses the button. A press starts listening (the browser asks permission the first time); a tap stops it, or letting go of a press held for more than a
// moment stops it, or 8 seconds pass. The recording is kept in memory only, converted in the page to a 16 kHz mono WAV (the one format every speech model behind the route takes: a Worker
// cannot decode the webm or mp4 a browser records), sent once to the app's own route, and dropped. The words that come back go into the text box for the
// child to SEE and change: nothing is built until the child presses Build it.
//
// LABEL AND "OFF". By default the button is a round icon that is hidden unless the route can listen (nothing changes for a page whose server cannot). A host that wants the feature to be
// FOUND passes `label` (e.g. "Muse transcribe": the button becomes a pill with words) and `showWhenOff: true` (the pill is shown even when the route is off or unreachable, in an inert
// "off" state: pressing it says why in plain words instead of recording anything). The route's gates are never bypassed: an off route stays off, the pill only explains it.
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

// ---- the recording as a 16 kHz mono 16-bit WAV ------------------------------------------------------------------------------------------------------------------------------------
export const WAV_RATE = 16000;
const MAX_WAV_SAMPLES = WAV_RATE * 10;   // the route refuses more than 10 seconds (worker/transcribe.ts MAX_WAV_SECONDS)

/** Average any number of channels into one. A mono recording comes back as it is. */
export function mixToMono(channels) {
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0].length);
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i] += ch[i] / channels.length;
  return out;
}
/** Linear resampling, for a browser whose decoder did not already give the rate asked for. */
export function resample(samples, fromRate, toRate) {
  if (fromRate === toRate) return samples;
  const n = Math.max(1, Math.round(samples.length * toRate / fromRate));
  const out = new Float32Array(n);
  const step = fromRate / toRate;
  for (let i = 0; i < n; i++) {
    const at = i * step, lo = Math.floor(at), hi = Math.min(lo + 1, samples.length - 1);
    out[i] = samples[lo] + (samples[hi] - samples[lo]) * (at - lo);
  }
  return out;
}
/** Float samples in [-1, 1] as a RIFF/WAVE file: one channel, 16-bit integer PCM. */
export function encodeWav(samples, rate = WAV_RATE) {
  const dataBytes = samples.length * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const v = new DataView(bytes.buffer);
  const tag = (at, str) => { for (let i = 0; i < str.length; i++) v.setUint8(at + i, str.charCodeAt(i)); };
  tag(0, 'RIFF'); v.setUint32(4, 36 + dataBytes, true); tag(8, 'WAVE'); tag(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  tag(36, 'data'); v.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, x < 0 ? Math.round(x * 32768) : Math.round(x * 32767), true);
  }
  return bytes;
}
/**
 * Decode what the browser recorded (webm, mp4, ogg: whatever MediaRecorder made) and return it as a 16 kHz mono WAV Blob. Throws when this browser has no decoder or cannot read it:
 * the caller then sends the original, which the route accepts only when its speech model is our own. `OfflineAudioContextClass` is injected for tests.
 */
export async function recordingToWav(blob, { OfflineAudioContextClass = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext } = {}) {
  if (!OfflineAudioContextClass) throw new Error('no audio decoder');
  const ctx = new OfflineAudioContextClass(1, 1, WAV_RATE);       // decodeAudioData resamples to the context's rate
  const data = await blob.arrayBuffer();
  const decoded = await new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(data, resolve, reject);        // older Safari answers by callback only, newer browsers by both
    if (p && typeof p.then === 'function') p.then(resolve, reject);
  });
  const channels = [];
  for (let i = 0; i < decoded.numberOfChannels; i++) channels.push(decoded.getChannelData(i));
  const mono = resample(mixToMono(channels), decoded.sampleRate, WAV_RATE);
  return new Blob([encodeWav(mono.subarray(0, MAX_WAV_SAMPLES))], { type: 'audio/wav' });
}

/** What the child is told, in words a small child can read. */
export const SAY = {
  listening: 'Listening… say it, then tap again.',
  thinking: 'Thinking about what you said…',
  heard: (words, action = 'Build it') => `I heard: "${words}". Press ${action}, or change the words.`,
  heardKept: (words) => `I heard: "${words}". I left your words as they are.`,
  denied: 'I cannot hear you yet. Ask a grown-up to let this page use the microphone, or type it.',
  noMic: 'I cannot find a microphone. Type it instead!',
  tooShort: 'That was very short. Press the button and say it again.',
  failed: 'I could not hear that. Try again, or type it.',
  busy: 'One moment, then try again.',
  unsupported: 'This browser cannot listen. Type it instead!',
  off: () => 'Voice input is switched off on this server. Type it instead!',
  noServer: () => "Voice input needs the app's server, and this page cannot reach it. Type it instead!",
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
  maxMs = MAX_MS, holdMs = HOLD_MS, minMs = MIN_MS, now = () => Date.now(), toWav = recordingToWav,
  setTimeout: later = (fn, ms) => globalThis.setTimeout(fn, ms), clearTimeout: cancelLater = (id) => globalThis.clearTimeout(id),
  onText = () => {}, onStatus = () => {}, onState = () => {}, currentText = () => '',
  label = '', showWhenOff = false, actionWord = 'Build it', what = 'what to build',   // what: what the child is asked to say, in the button's accessible name   // actionWord: the button the child presses next ("Make" in Create a world), named in the "I heard" line
} = {}) {
  const idleName = label ? `${label}: say ${what}` : `Say ${what}`;
  const node = make(doc, 'button', { type: 'button', class: 'kdb-mic', 'aria-label': idleName, 'aria-pressed': 'false', title: idleName, hidden: '' }, label ? `🎤 ${label}` : '🎤');
  node.style?.setProperty?.('--kdb-cap', `${maxMs}ms`);   // the listening bar in the page's CSS runs for exactly as long as the recording may
  let state = 'hidden';            // hidden | off (shown but inert: the route cannot listen, see showWhenOff) | idle | asking | listening | thinking
  let run = 0;                     // bumps whenever a recording is cancelled or finished: an answer from an older one is dropped
  let available = null, offReason = '';   // offReason: off (the route says it is not switched on) | unreachable (no answer from it) | browser (this browser cannot record) | ''
  let stream = null, recorder = null, chunks = [], startedAt = 0, timer = 0, pressedAt = 0, released = false, textAtStart = '', mime = '';

  const setState = (s) => {
    state = s;
    node.setAttribute('aria-pressed', String(s === 'listening'));
    node.setAttribute('aria-label', s === 'listening' ? 'Stop listening' : idleName);
    node.setAttribute('aria-disabled', String(s === 'off'));   // inert, but still pressable: a press explains why (a truly disabled button would stay silent)
    node.classList.toggle('kdb-mic-on', s === 'listening');
    node.classList.toggle('kdb-mic-off', s === 'off');
    node.disabled = s === 'thinking';
    node.textContent = s === 'listening' ? (label ? '⏹ Stop' : '⏹') : s === 'thinking' ? (label ? '… Transcribing' : '…') : (label ? `🎤 ${label}` : '🎤');
    onState(s);
  };
  /** Why the pill is inert, in words a child can read. */
  const offMessage = () => (offReason === 'browser' ? SAY.unsupported : offReason === 'unreachable' ? SAY.noServer() : SAY.off());
  const stopTracks = () => { try { stream?.getTracks().forEach((t) => t.stop()); } catch { /* already stopped */ } stream = null; };
  const clearTimer = () => { if (timer) { cancelLater(timer); timer = 0; } };

  /** One free GET: is voice input on? Remembered. Shows the button only when it is. */
  async function probe() {
    if (available === null) {
      offReason = '';
      try {
        const res = await fetchImpl(url);
        available = res.ok && (await res.json())?.enabled === true;
        if (!available) offReason = res.ok ? 'off' : 'unreachable';
      } catch { available = false; offReason = 'unreachable'; }
      if (available && (!MediaRecorderClass || !getUserMedia)) { available = false; offReason = 'browser'; }   // a browser that cannot record shows no working button
    }
    if (available && (state === 'hidden' || state === 'off')) { node.hidden = false; setState('idle'); }
    else if (!available && showWhenOff && state === 'hidden') { node.hidden = false; setState('off'); }
    return available;
  }
  /** The route cannot listen (it said so, or stopped answering). By default the button goes away; with showWhenOff it stays, inert, and says why when pressed. */
  const hide = (why = 'off') => {
    available = false; offReason = why;
    if (showWhenOff) { node.hidden = false; setState('off'); } else { node.hidden = true; setState('hidden'); }
  };

  async function upload(recorded, mine) {
    let blob = recorded;
    let type = ALLOWED.has(baseType(recorded.type)) ? baseType(recorded.type) : baseType(mime);
    try { blob = await toWav(recorded); type = 'audio/wav'; } catch { /* no decoder here: send what was recorded (the route takes it only for our own speech model, and answers 415 otherwise) */ }
    if (mine !== run) return;       // cancelled while it was being converted: nothing is sent
    const abort = typeof AbortController === 'function' ? new AbortController() : null;
    const stop = abort ? later(() => abort.abort(), UPLOAD_TIMEOUT_MS) : 0;
    try {
      const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': type }, body: blob, ...(abort ? { signal: abort.signal } : {}) });
      if (mine !== run) return;
      if (res.status === 503) { hide(); onStatus(showWhenOff ? offMessage() : SAY.unsupported); return; }
      if (res.status === 429) { setState('idle'); onStatus(SAY.busy); return; }
      if (!res.ok) throw new Error(String(res.status));
      const body = await res.json();
      if (mine !== run) return;
      const words = typeof body?.text === 'string' ? body.text.trim() : '';
      setState('idle');
      if (!words) { onStatus(typeof body?.note === 'string' && body.note ? body.note : SAY.failed); return; }
      if (currentText() !== textAtStart) { onStatus(SAY.heardKept(words)); return; }   // the child typed meanwhile: do not overwrite it
      onText(words);
      onStatus(SAY.heard(words, actionWord));
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
    if (state !== 'hidden' && state !== 'off') setState('idle');
  }

  // a press: start (or, while listening, stop); letting go of a press held past `holdMs` stops it. The keyboard toggles through click (detail 0).
  node.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    pressedAt = now(); released = false;
    if (state === 'off') { pressedAt = 0; onStatus(offMessage()); return; }
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
    if (state === 'off') { onStatus(offMessage()); return; }
    if (state === 'idle') { released = false; void start(); } else if (state === 'listening') stop();
  });

  return {
    node, probe, start, stop, cancel,
    dispose() { cancel(); node.remove?.(); },
    get state() { return state; },
    get available() { return available; },
    get offReason() { return offReason; },
    /** The plain words for why the pill is inert (the same ones a press says). */
    whyOff: () => offMessage(),
  };
}
