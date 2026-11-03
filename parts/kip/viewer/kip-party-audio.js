// Party audio: plays the practice beat (the pattern in shared/songSynth.ts) with Web Audio, scheduled on the AudioContext clock.
// docs/specs/dance-party-spec.md 4.3 ("Offline and failure": the party can make a backing loop with no network and no song files) and 4.4
// ("Playback uses AudioContext.currentTime as the clock so dance, glow and taps stay aligned with the sound, not with frames").
//
// Every sound is scheduled AHEAD on the audio clock at startedAt + beat x 60 / bpm, so the sound is exactly on the grid the dance and the tap judge
// read (shared/songParty.ts `practiceBeatMap`). The page asks `songTime()` for "where the song is" and everything else follows from that.
//
//   const audio = createPartyAudio({ AudioContextClass, loopEvents, midiToHz });
//   await audio.start({ mood: 'bouncy', bpm: 105 });     // the practice beat, from a tap or click (browsers only allow sound after one)
//   await audio.startSong({ data, offset, interval, loopSeconds });  // a starter-library song (an ArrayBuffer of an MP3), looped on its beat grid
//   audio.setClick(true);                                 // a tick on every beat, a higher one on the 1: to HEAR whether the beat map is right
//   audio.songTime()                                      // seconds of song time that are being HEARD now (output latency removed)
//   audio.stop();
//
// The pattern and the note maths are passed in (they are TypeScript in shared/ and come through the bundled kip-party-core.js), so this file imports
// nothing and a test can drive it with a fake AudioContext. Volume: the party sets its own gain, low, with a hard ceiling. The ceiling here is a
// placeholder: the numeric safe-listening limit has not been checked against a children's reference (dance-party-spec.md 4.5, open item).
//
// No DOM beyond the AudioContext it is given; no network; no storage.

export const PARTY_GAIN_DEFAULT = 0.2;
export const PARTY_GAIN_MAX = 0.35;
/** How far ahead of the audio clock events are handed to the audio thread, and how often the scheduler looks. */
export const LOOKAHEAD_S = 0.15;
export const TICK_MS = 25;
/** A little time between "start" and the first downbeat, so the first beat is never scheduled in the past. */
export const START_DELAY_S = 0.12;

// the lead voice's waveform per mood: a lullaby is soft, a march is bright
const LEAD_WAVE = { bouncy: 'square', sleepy: 'sine', silly: 'sawtooth', space: 'triangle', kitchen: 'square', cleanup: 'square' };

/** What a file's first bytes say it is, for the message when a browser will not decode it: so "Unable to decode audio data" says what it was given. */
export function describeBytes(buf) {
  const n = buf ? buf.byteLength : 0;
  const u = new Uint8Array(buf || 0, 0, Math.min(12, n));
  const ascii = Array.from(u, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
  let kind = 'not an audio file this page knows';
  if (n === 0) kind = 'an empty file';
  else if (ascii.startsWith('<')) kind = 'a web page, not audio';
  else if (ascii.slice(4, 8) === 'ftyp') kind = 'an MP4/AAC audio file';
  else if (ascii.startsWith('ID3') || (u[0] === 0xff && (u[1] & 0xe0) === 0xe0)) kind = 'an MP3 file';
  return `${n} bytes, ${kind}`;
}

const clampGain = (g) => Math.min(PARTY_GAIN_MAX, Math.max(0, Number.isFinite(g) ? g : PARTY_GAIN_DEFAULT));

export function createPartyAudio({ AudioContextClass, loopEvents, midiToHz, gain = PARTY_GAIN_DEFAULT, schedule = (fn, ms) => setInterval(fn, ms), unschedule = (id) => clearInterval(id) }) {
  let ctx = null;
  let master = null;
  let noise = null;
  let timer = null;
  let running = false;
  let startedAt = 0;
  let bpm = 0;
  let mood = 'bouncy';
  let mode = 'synth'; // 'synth' (the practice beat) or 'song' (a library file)
  let song = null;    // the playing BufferSource, in song mode
  let grid = { offset: 0, interval: 0.5 }; // where the beats fall in song time: beat k at offset + k x interval
  let clickOn = false;
  let clickIdx = 0;
  let events = [];
  let loopBeats = 16;
  let idx = 0;       // next event of the loop to schedule
  let loops = 0;     // whole loops already scheduled
  let level = clampGain(gain);

  function makeNoise(c) {
    const len = Math.floor(c.sampleRate * 0.5);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // ---- voices: each makes its own nodes at `when` and lets them go -------------------------------------------------------------------------
  function env(g, when, peak, attack, hold, release) {
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(peak, when + attack);
    g.gain.setValueAtTime(peak, when + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, when + attack + hold + release);
  }
  function noiseHit(when, vel, hp, peak, len) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.setValueAtTime(hp, when);
    const g = ctx.createGain();
    env(g, when, peak * vel, 0.002, 0, len);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(when);
    src.stop(when + len + 0.05);
  }
  function tone(when, type, hz, vel, peak, attack, hold, release, lowpass) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(hz, when);
    const g = ctx.createGain();
    env(g, when, peak * vel, attack, hold, release);
    let tail = o;
    if (lowpass) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(lowpass, when);
      o.connect(f);
      tail = f;
    }
    tail.connect(g); g.connect(master);
    o.start(when);
    o.stop(when + attack + hold + release + 0.05);
    return o;
  }
  function play(e, when, secPerBeat) {
    switch (e.voice) {
      case 'kick': {
        const o = tone(when, 'sine', 150, e.vel, 1, 0.002, 0.04, 0.22);
        o.frequency.exponentialRampToValueAtTime(45, when + 0.12);
        break;
      }
      case 'snare':
        noiseHit(when, e.vel, 1500, 0.55, 0.16);
        tone(when, 'triangle', 190, e.vel, 0.3, 0.002, 0.01, 0.1);
        break;
      case 'hat':
        noiseHit(when, e.vel, 7000, 0.3, 0.05);
        break;
      case 'bass':
        tone(when, 'triangle', midiToHz(e.midi), e.vel, 0.7, 0.01, Math.max(0.02, e.dur * secPerBeat - 0.08), 0.06, 700);
        break;
      case 'lead':
        tone(when, LEAD_WAVE[mood] || 'triangle', midiToHz(e.midi), e.vel, 0.32, 0.01, Math.max(0.02, e.dur * secPerBeat - 0.06), 0.05, 2600);
        break;
      default:
        break;
    }
  }

  /** A short tick for the beat check: higher on the 1. Its own level, so it can be heard over a song. */
  function clickAt(when, accent) {
    tone(when, 'sine', accent ? 1760 : 1175, 1, 0.5, 0.001, 0.004, 0.035);
  }
  function tickClicks(horizon) {
    for (let guard = 0; guard < 100; guard++) {
      const when = startedAt + grid.offset + clickIdx * grid.interval;
      if (when > horizon) break;
      if (when >= ctx.currentTime - 0.01) clickAt(Math.max(when, ctx.currentTime), clickIdx % 4 === 0);
      clickIdx++;
    }
  }

  /** Hand every event that falls before `ctx.currentTime + LOOKAHEAD_S` to the audio thread. Called by a timer; tests call it by hand. */
  function tick() {
    if (!running) return;
    const horizon = ctx.currentTime + LOOKAHEAD_S;
    if (clickOn) tickClicks(horizon);
    if (mode !== 'synth') return; // a song is one buffer, started once; only the clicks are scheduled
    const secPerBeat = 60 / bpm;
    for (let guard = 0; guard < 400; guard++) {
      const e = events[idx];
      const when = startedAt + (loops * loopBeats + e.beat) * secPerBeat;
      if (when > horizon) break;
      if (when >= ctx.currentTime - 0.01) play(e, Math.max(when, ctx.currentTime), secPerBeat);
      idx++;
      if (idx >= events.length) { idx = 0; loops++; }
    }
  }

  /** A fresh context, resumed, with the master gain and compressor. Shared by the practice beat and a song. */
  async function open() {
    if (!ctx) ctx = new AudioContextClass(); // already made by unlock(), when the tap that started the party made it
    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') await ctx.resume();
    const comp = ctx.createDynamicsCompressor();
    master = ctx.createGain();
    master.gain.setValueAtTime(level, ctx.currentTime);
    master.connect(comp);
    comp.connect(ctx.destination);
  }

  return {
    /** Start the loop. Resolves with { startedAt }: the audio-clock time at which song time 0 (beat 0) sounds. Must follow a tap or click. */
    async start({ mood: m = 'bouncy', bpm: tempo }) {
      if (running) this.stop();
      if (!(tempo > 0)) throw new Error(`createPartyAudio.start: ${tempo} is not a tempo`);
      await open();
      mode = 'synth';
      song = null;
      mood = m;
      bpm = tempo;
      grid = { offset: 0, interval: 60 / tempo };
      clickIdx = 0;
      events = loopEvents(m);
      loopBeats = 16;
      idx = 0;
      loops = 0;
      noise = makeNoise(ctx);
      startedAt = ctx.currentTime + START_DELAY_S;
      running = true;
      tick();
      timer = schedule(tick, TICK_MS);
      return { startedAt };
    },
    /**
     * Make the audio context NOW and ask it to run. Call it synchronously inside the tap that starts the party, BEFORE anything is fetched: Safari (and
     * iOS above all) only lets sound start from the gesture itself, and a song's file has to be fetched first, so a context made after that wait stays
     * suspended and the song never plays. Safe to call twice; `start` and `startSong` use the context it made.
     */
    unlock() {
      if (ctx) return;
      ctx = new AudioContextClass();
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
        try { Promise.resolve(ctx.resume()).catch(() => {}); } catch { /* the real resume is awaited in open() */ }
      }
    },
    /**
     * Play a starter-library song: `data` is the file's bytes (an ArrayBuffer; decoding takes it), `offset` and `interval` are where its beats fall (the first
     * beat at `offset`, one every `interval` seconds, the file cut on that grid), `loopSeconds` the exact loop length. It loops until stopped.
     * Resolves with { startedAt, bufferSeconds }: song time 0 is the start of the file.
     */
    async startSong({ data, offset = 0, interval, loopSeconds }) {
      if (running) this.stop();
      if (!(interval > 0)) { this.stop(); throw new Error(`createPartyAudio.startSong: ${interval} is not a beat length`); }
      await open();
      let buffer;
      try {
        buffer = await ctx.decodeAudioData(data.slice(0)); // a copy: decoding takes the bytes it is given, and a failure should still be able to say what they were
      } catch (err) {
        const c = ctx; ctx = null; master = null;
        try { c.close(); } catch { /* already closed */ }
        throw new Error(`the song could not be decoded (${describeBytes(data)}): ${err && err.message ? err.message : err}`);
      }
      mode = 'song';
      grid = { offset, interval };
      clickIdx = 0;
      bpm = 60 / interval;
      song = ctx.createBufferSource();
      song.buffer = buffer;
      song.loop = true;
      song.loopStart = 0;
      song.loopEnd = Number.isFinite(loopSeconds) && loopSeconds > 0 ? Math.min(buffer.duration, loopSeconds) : buffer.duration;
      song.connect(master);
      startedAt = ctx.currentTime + START_DELAY_S;
      song.start(startedAt);
      running = true;
      tick();
      timer = schedule(tick, TICK_MS);
      return { startedAt, bufferSeconds: buffer.duration };
    },
    /** The beat check: a tick on every beat (higher on the 1), on top of whatever is playing. */
    setClick(on) {
      clickOn = Boolean(on);
      if (clickOn && ctx && running) clickIdx = Math.max(0, Math.ceil((ctx.currentTime - startedAt - grid.offset) / grid.interval));
    },
    isClick: () => clickOn,
    stop() {
      if (!running && !ctx) return;
      running = false;
      if (timer !== null) { unschedule(timer); timer = null; }
      try {
        if (master) master.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.03); // a short fade, so a stop does not click
        const c = ctx;
        setTimeout(() => { try { c.close(); } catch { /* already closed */ } }, 150);
      } catch { /* the context is gone; nothing to fade */ }
      try { if (song) song.stop(); } catch { /* not started, or already stopped */ }
      song = null;
      ctx = null; master = null; noise = null;
    },
    /**
     * Song time that is being HEARD, seconds. Where the browser reports the output position (`getOutputTimestamp`: the sample the speaker is playing, with
     * its performance-clock time) the answer is that position moved on to `perfMs` (a `performance.now()` value, or an input event's `timeStamp`), which
     * times a tap from when the finger landed, not from when the handler ran. Otherwise it is the audio clock minus the start minus the output latency.
     * 0 before the context exists.
     */
    songTime(perfMs) {
      if (!ctx) return 0;
      if (typeof ctx.getOutputTimestamp === 'function') {
        const ts = ctx.getOutputTimestamp();
        if (ts && ts.performanceTime > 0 && Number.isFinite(ts.contextTime)) {
          const ahead = Number.isFinite(perfMs) ? (perfMs - ts.performanceTime) / 1000 : 0;
          return ts.contextTime + ahead - startedAt;
        }
      }
      const latency = Number.isFinite(ctx.outputLatency) ? ctx.outputLatency : (Number.isFinite(ctx.baseLatency) ? ctx.baseLatency : 0);
      return ctx.currentTime - startedAt - latency;
    },
    /** The output latency in milliseconds (for taps: the child taps on what they hear). */
    latencyMs() {
      if (!ctx) return 0;
      const l = Number.isFinite(ctx.outputLatency) ? ctx.outputLatency : (Number.isFinite(ctx.baseLatency) ? ctx.baseLatency : 0);
      return l * 1000;
    },
    setGain(g) {
      level = clampGain(g);
      if (master && ctx) master.gain.setTargetAtTime(level, ctx.currentTime, 0.02);
    },
    getGain: () => level,
    isRunning: () => running,
    tick,
    get startedAt() { return startedAt; },
  };
}
