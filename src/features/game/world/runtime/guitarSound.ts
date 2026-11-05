// The toy guitar's SOUND (Dan, 2026-11-05: "can we improve the guitar interaction?"). The old strum was triangle-wave beeps; this plucks real (modelled) strings.
//
// `ksPluck` is a Karplus-Strong string: a burst of noise (softened, and with a comb in it for where the pick lands) circulates in a delay line the length of one period, and each trip round it
// loses a little, more of the high end than the low, so the note rings, mellows and dies like a nylon string. It is pure (numbers in, samples out, seeded noise), so a test can measure its pitch and
// its decay. Each pitch is made once and kept (a note is about 60 000 samples, about 1 ms to make), and a stroke is just a handful of buffer sources started a few milliseconds apart, through a
// small shared "body" (a soft low resonance and a rolled-off top) so the notes sound like one instrument. Cheap on a phone: at most MAX_VOICES notes at once, and nothing at all while muted or
// before the first tap has woken the audio.
import { ctx, noise, sound, tone } from "./audio";
import type { Stroke } from "./guitarPlay";
import { chordFreqs, PROGRESSION } from "./guitarPlay";

/** A seeded 0..1 random number generator (mulberry32), so a given pitch always makes the same string. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PluckOpts {
  /** Where along the string the pick lands, as a share of its length (0.1 near the bridge: thin and bright; 0.5 mid-string: round). Default 0.18. */
  pos?: number;
  /** 0 to 1: how hard and bright the pluck is (the noise burst's softening). Default 0.55. */
  bright?: number;
  /** Seconds the note takes to fall 60 dB at the low end of the loop filter. Default by pitch. */
  t60?: number;
  /** How long the buffer is. Default 1.5 s. */
  seconds?: number;
  /** The loop filter's share of the previous sample, 0 to 0.5: 0.5 is the classic two-point average (the strongest damping of the highs), less lets the highs ring on. Default 0.38. */
  damp?: number;
  rng?: () => number;
}

/** How long a string of this pitch rings (seconds to fall 60 dB): the low strings sing on, the high ones are shorter. */
export const t60For = (freq: number): number => 3.4 * Math.min(1.1, Math.max(0.6, Math.pow(110 / freq, 0.25)));

/** A plucked string at `freq` Hz, `sr` samples a second: peak amplitude 1 at the start, silent at the end. */
export function ksPluck(freq: number, sr: number, opts: PluckOpts = {}): Float32Array {
  const seconds = opts.seconds ?? 1.5;
  const len = Math.max(2, Math.round(seconds * sr));
  const out = new Float32Array(len);
  if (!(freq > 20) || !(sr > 8000) || freq > sr / 4) return out;
  const rng = opts.rng ?? seeded(Math.round(freq * 100));
  const period = sr / freq;                                         // samples per trip round the loop
  // the loop is: the delay line (N samples), the loop filter (lp = (1 - b) cur + b prev: b samples of delay at low frequencies) and an all-pass that supplies the fraction, so the pitch is exact
  const b = Math.min(0.5, Math.max(0.05, opts.damp ?? 0.38));
  const D = period - b;
  const N = Math.max(2, Math.floor(D - 0.5));
  const frac = D - N;                                               // in [0.5, 1.5)
  const apA = (1 - frac) / (1 + frac);
  const rho = Math.pow(10, -3 / (freq * (opts.t60 ?? t60For(freq))));      // the loop's gain at DC: the note falls 60 dB in t60 seconds at the bottom of the spectrum
  // the excitation: noise, softened by a one-pole low-pass, the mean taken out, a comb for the pick's place, then scaled to peak 1
  const line = new Float32Array(N);
  const a = 0.25 + 0.7 * Math.min(1, Math.max(0, opts.bright ?? 0.55));
  let y = 0;
  for (let i = 0; i < N; i++) { y += a * (rng() * 2 - 1 - y); line[i] = y; }
  let mean = 0;
  for (let i = 0; i < N; i++) mean += line[i]!;
  mean /= N;
  const shift = Math.max(1, Math.round(N * Math.min(0.5, Math.max(0.05, opts.pos ?? 0.18))));
  const comb = new Float32Array(N);
  for (let i = 0; i < N; i++) comb[i] = line[i]! - mean - (line[(i - shift + N) % N]! - mean);
  let peak = 1e-9;
  for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(comb[i]!));
  for (let i = 0; i < N; i++) line[i] = comb[i]! / peak;
  let ptr = 0, prev = 0, apX = 0, apY = 0;
  for (let i = 0; i < len; i++) {
    const cur = line[ptr]!;
    out[i] = cur;
    const lp = rho * ((1 - b) * cur + b * prev);
    prev = cur;
    const ap = apA * (lp - apY) + apX;
    apX = lp; apY = ap;
    line[ptr] = ap;
    ptr = ptr + 1 === N ? 0 : ptr + 1;
  }
  const fade = Math.min(len, Math.round(0.06 * sr));
  for (let i = 0; i < fade; i++) out[len - 1 - i] = out[len - 1 - i]! * (i / fade);
  return out;
}

/* ---------- playing it ---------- */

/** At most this many notes ring at once (a drumming child gets a flurry, not a hundred nodes). */
export const MAX_VOICES = 30;
/** One note's loudness at full weight. A full down stroke (six strings, 26 ms) peaks about 0.3. */
export const PLUCK_GAIN = 0.1;
/** A note's pitch is nudged by up to this share either way each time it is played, so the same sample is never quite the same twice (cents are ~0.06 %). */
const DETUNE = 0.004;

interface Rig { bus: GainNode; buffers: Map<number, AudioBuffer>; live: number; sr: number }
const rigs = new WeakMap<AudioContext, Rig>();
const waveCache = new Map<string, Float32Array>();                    // pitch + sample rate -> samples (shared by every audio context of that rate)

function rigFor(a: AudioContext): Rig {
  const have = rigs.get(a);
  if (have) return have;
  const bus = a.createGain();
  bus.gain.value = 1;
  // the "body": a soft resonance low down, and the top rolled off so the model's digital edge is gone
  const body = a.createBiquadFilter(); body.type = "peaking"; body.frequency.value = 125; body.gain.value = 4; body.Q.value = 1.1;
  const top = a.createBiquadFilter(); top.type = "lowpass"; top.frequency.value = 5200; top.Q.value = 0.5;
  bus.connect(body); body.connect(top); top.connect(a.destination);
  const rig: Rig = { bus, buffers: new Map(), live: 0, sr: a.sampleRate };
  rigs.set(a, rig);
  return rig;
}

function samplesFor(freq: number, sr: number): Float32Array {
  const key = `${Math.round(freq * 100)}@${sr}`;
  let w = waveCache.get(key);
  if (!w) { w = ksPluck(freq, sr); waveCache.set(key, w); }
  return w;
}

function bufferFor(rig: Rig, a: AudioContext, freq: number): AudioBuffer {
  const k = Math.round(freq * 100);
  let b = rig.buffers.get(k);
  if (!b) {
    const w = samplesFor(freq, rig.sr);
    b = a.createBuffer(1, w.length, rig.sr);
    b.getChannelData(0).set(w);
    rig.buffers.set(k, b);
  }
  return b;
}

/** Pluck one string `delay` seconds from now at weight `vel` (0 to 1). Silent when muted or before the audio is awake. */
export function pluck(freq: number, delay: number, vel: number): void {
  const a = ctx();
  if (!a || !sound || !(vel > 0) || !(freq > 20)) return;
  const rig = rigFor(a);
  if (rig.live >= MAX_VOICES) return;
  const src = a.createBufferSource();
  src.buffer = bufferFor(rig, a, freq);
  src.playbackRate.value = 1 + (Math.random() - 0.5) * 2 * DETUNE;
  const g = a.createGain();
  g.gain.value = PLUCK_GAIN * Math.pow(Math.min(1, vel), 1.4);
  src.connect(g); g.connect(rig.bus);
  rig.live++;
  src.onended = () => { rig.live = Math.max(0, rig.live - 1); try { g.disconnect(); } catch { /* already gone */ } };
  src.start(a.currentTime + Math.max(0, delay));
}

/** A whole stroke: the strings one after another, a soft thump of the body on a down stroke and a whisper of the pick. Respects the master mute (every piece does). */
export function playStroke(s: Stroke): void {
  for (const n of s.notes) pluck(n.freq, n.delay, n.vel);
  if (s.dir === "down") tone(98, 0, 0.14, "sine", 0.05 * s.vel, 58);                  // the body knocks
  noise(0, 0.03, 3800, 2400, 0.03 * s.vel);                                        // the pick brushes the strings
}

let priming: ReturnType<typeof setTimeout> | null = null;
/** Make the strings of the whole progression a few at a time in the background (the first tap must not stall for a dozen ~1 ms jobs). Safe to call again. */
export function primeGuitar(): void {
  const a = ctx();
  if (!a || priming !== null) return;
  const sr = a.sampleRate;
  const todo = [...new Set(PROGRESSION.flatMap((c) => chordFreqs(c)))].filter((f) => !waveCache.has(`${Math.round(f * 100)}@${sr}`));
  const next = () => {
    const f = todo.shift();
    if (f === undefined) { priming = null; return; }
    samplesFor(f, sr);
    priming = setTimeout(next, 0);
  };
  priming = setTimeout(next, 0);
}
