/**
 * Finding the beat of a song from its audio (docs/specs/dance-party-spec.md 4.4: "tempo is measured, not trusted"). Mureka has no tempo control, so every
 * starter song's real tempo, beat times and downbeat come from here, at ingest time, in a script on the owner's machine.
 *
 *   onsetEnvelope   audio -> how sharply the sound changes, 86 times a second, plus the same for the low drums only (the kick).
 *   estimateTempo   the envelope's repeat rate, by autocorrelation, with a mild preference for a dancing pace; also says if half or double time is as good.
 *   trackBeats      a dynamic-programming beat tracker (Ellis 2007): beats that sit on onsets and keep the tempo, through a tempo that wanders.
 *   findDownbeat    which of every four beats is the "1": the one the kick lands on hardest.
 *   fitGrid         how well the beats lie on one steady tempo (the error in milliseconds): a song that does not is rejected, not forced.
 *   analyzeSong     all of the above, from mono samples.
 *   pickExcerpt     a whole number of bars, starting on a downbeat, from the steadiest, loudest stretch away from the intro and the ending.
 *
 * The result feeds shared/songBeat.ts `makeBeatMap`, which checks it again. Nothing here is trusted on its own: the party can play a click on every
 * detected beat so a person can hear whether it is right.
 *
 * Pure: no DOM, no files, no clock. Samples in, numbers out.
 */

export const HOP = 256;
export const NFFT = 1024;
/** Search range for the beat tempo. The dances cover 64 to 170 bpm (a test in tests/kip-baked-clips.test.ts). */
export const MIN_BPM = 60;
export const MAX_BPM = 180;

// ---- FFT ---------------------------------------------------------------------------------------------------------------------------

function makeFft(n: number) {
  const levels = Math.log2(n);
  if (!Number.isInteger(levels)) throw new Error("fft size must be a power of two");
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < levels; b++) r |= ((i >> b) & 1) << (levels - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / n); sin[i] = -Math.sin((2 * Math.PI * i) / n); }
  return (re: Float64Array, im: Float64Array) => {
    for (let i = 0; i < n; i++) {
      const j = rev[i]!;
      if (j > i) { const tr = re[i]!; re[i] = re[j]!; re[j] = tr; const ti = im[i]!; im[i] = im[j]!; im[j] = ti; }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const l = j + half;
          const tr = re[l]! * cos[k]! - im[l]! * sin[k]!;
          const ti = re[l]! * sin[k]! + im[l]! * cos[k]!;
          re[l] = re[j]! - tr; im[l] = im[j]! - ti;
          re[j] = re[j]! + tr; im[j] = im[j]! + ti;
        }
      }
    }
  };
}

// ---- onset envelope ------------------------------------------------------------------------------------------------------------------

export interface Onsets {
  /** Onset strength per frame, normalised to unit standard deviation. */
  env: Float64Array;
  /** The same, from bands below 200 Hz only: where the kick drum is. */
  low: Float64Array;
  fps: number;
  /** Seconds from the start of the audio to the middle of frame 0's window (add `frame / fps`). */
  t0: number;
  /** RMS loudness of each frame (for choosing a loud stretch). */
  rms: Float64Array;
}

const BANDS = 32;

export function onsetEnvelope(x: Float32Array | Float64Array, sr: number): Onsets {
  const frames = Math.max(0, Math.floor((x.length - NFFT) / HOP) + 1);
  const fft = makeFft(NFFT);
  const win = new Float64Array(NFFT);
  for (let i = 0; i < NFFT; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (NFFT - 1));
  // log-spaced bands from 30 Hz up to 8 kHz (or the Nyquist)
  const top = Math.min(8000, sr / 2 - 1);
  const edges: number[] = [];
  for (let b = 0; b <= BANDS; b++) edges.push(Math.round(((30 * (top / 30) ** (b / BANDS)) * NFFT) / sr));
  for (let b = 1; b <= BANDS; b++) if (edges[b]! <= edges[b - 1]!) edges[b] = edges[b - 1]! + 1;
  const lowBands = edges.findIndex((e) => (e * sr) / NFFT > 200); // bands whose upper edge is under 200 Hz
  const nLow = lowBands < 0 ? BANDS : Math.max(1, lowBands);

  const E = Array.from({ length: BANDS }, () => new Float64Array(frames));
  const rms = new Float64Array(frames);
  const re = new Float64Array(NFFT);
  const im = new Float64Array(NFFT);
  for (let t = 0; t < frames; t++) {
    let sum = 0;
    for (let i = 0; i < NFFT; i++) { const v = x[t * HOP + i]!; re[i] = v * win[i]!; im[i] = 0; sum += v * v; }
    rms[t] = Math.sqrt(sum / NFFT);
    fft(re, im);
    for (let b = 0; b < BANDS; b++) {
      let e = 0;
      const lo = edges[b]!, hi = Math.max(edges[b + 1]!, lo + 1);
      for (let k = lo; k < hi; k++) e += re[k]! * re[k]! + im[k]! * im[k]!;
      E[b]![t] = e / (hi - lo);
    }
  }
  // level-independent: each band's log energy relative to its own average
  const L = E.map((band) => {
    let mean = 0;
    for (let t = 0; t < frames; t++) mean += band[t]!;
    mean = mean / Math.max(1, frames) + 1e-12;
    const out = new Float64Array(frames);
    for (let t = 0; t < frames; t++) out[t] = Math.log1p((20 * band[t]!) / mean);
    return out;
  });
  const env = new Float64Array(frames);
  const low = new Float64Array(frames);
  for (let t = 2; t < frames; t++) {
    let all = 0, lw = 0;
    for (let b = 0; b < BANDS; b++) {
      const d = Math.max(0, L[b]![t]! - Math.max(L[b]![t - 1]!, L[b]![t - 2]!)); // against the louder of the last two frames: ripple is not an onset
      all += d;
      if (b < nLow) lw += d;
    }
    env[t] = all;
    low[t] = lw;
  }
  return { env: normalise(highpass(env)), low: normalise(highpass(low)), fps: sr / HOP, t0: NFFT / 2 / sr, rms };
}

/** Subtract a half-second moving average (what is steady is not an onset) and drop what is left below zero. */
function highpass(v: Float64Array): Float64Array {
  const n = v.length;
  const w = 43; // about half a second at 86 fps
  const out = new Float64Array(n);
  let sum = 0;
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) { sum += v[i]!; pre[i + 1] = sum; }
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - w), b = Math.min(n, i + w + 1);
    out[i] = Math.max(0, v[i]! - (pre[b]! - pre[a]!) / (b - a));
  }
  return out;
}

function normalise(v: Float64Array): Float64Array {
  let mean = 0;
  for (const x of v) mean += x;
  mean /= Math.max(1, v.length);
  let varr = 0;
  for (const x of v) varr += (x - mean) ** 2;
  const sd = Math.sqrt(varr / Math.max(1, v.length)) || 1;
  return v.map((x) => x / sd) as Float64Array;
}

// ---- tempo ---------------------------------------------------------------------------------------------------------------------------

export interface TempoEstimate {
  bpm: number;
  /** Autocorrelation at the chosen beat period relative to its best alternative in range: above 1 means a clear winner. */
  strength: number;
  /** The tempo at half or double the answer when it scores nearly as well (the beat could be felt either way), else null. */
  alternate: number | null;
  /** The best few tempos with their scores, strongest first. */
  candidates: { bpm: number; score: number }[];
}

/** Autocorrelation of an envelope at whole-frame lags 1..maxLag, normalised so lag 0 is 1. */
function autocorr(env: Float64Array, maxLag: number): Float64Array {
  const n = env.length;
  const r = new Float64Array(maxLag + 1);
  let mean = 0;
  for (const v of env) mean += v;
  mean /= Math.max(1, n);
  let r0 = 0;
  for (let i = 0; i < n; i++) r0 += (env[i]! - mean) ** 2;
  for (let lag = 0; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += (env[i]! - mean) * (env[i + lag]! - mean);
    r[lag] = s / (r0 || 1);
  }
  return r;
}

export function estimateTempo(env: Float64Array, fps: number, { minBpm = MIN_BPM, maxBpm = MAX_BPM, prior = 115 } = {}): TempoEstimate {
  const maxLag = Math.ceil((fps * 60 * 4) / minBpm) + 2;
  const r = autocorr(env, maxLag);
  const at = (lag: number) => { // linear interpolation between whole-frame lags
    if (lag < 1 || lag >= maxLag) return 0;
    const i = Math.floor(lag), f = lag - i;
    return r[i]! * (1 - f) + r[i + 1]! * f;
  };
  const scored: { bpm: number; score: number }[] = [];
  for (let bpm = minBpm; bpm <= maxBpm; bpm += 0.25) {
    const L = (fps * 60) / bpm;
    // the beat period, and its multiples (a bar is 4 beats, 2 bars is 8): a real tempo repeats at all of them
    const comb = at(L) + 0.5 * at(2 * L) + 0.25 * at(4 * L);
    const octaves = Math.log2(bpm / prior);
    scored.push({ bpm, score: comb * Math.exp(-0.5 * (octaves / 0.9) ** 2) }); // a mild preference for a dancing pace
  }
  // the highest local maxima, at least 8 % apart
  const peaks = scored.filter((s, i) => i > 0 && i < scored.length - 1 && s.score >= scored[i - 1]!.score && s.score > scored[i + 1]!.score).sort((a, b) => b.score - a.score);
  const picked: { bpm: number; score: number }[] = [];
  for (const p of peaks) if (picked.every((q) => Math.abs(Math.log(p.bpm / q.bpm)) > 0.08)) picked.push(p);
  const best = picked[0] ?? { bpm: prior, score: 0 };
  const runner = picked[1]?.score ?? 0;
  const double = picked.find((p) => Math.abs(Math.log(p.bpm / (best.bpm * 2))) < 0.04 || Math.abs(Math.log(p.bpm / (best.bpm / 2))) < 0.04);
  const alternate = double && double.score > 0.8 * best.score ? double.bpm : null;
  return { bpm: best.bpm, strength: runner > 0 ? best.score / runner : best.score > 0 ? 10 : 0, alternate, candidates: picked.slice(0, 4) };
}

// ---- beats ---------------------------------------------------------------------------------------------------------------------------

/**
 * Beat frames for an envelope at a tempo: the chain of onsets that scores best under "land on an onset" and "keep the tempo" (the penalty grows with
 * the log-ratio of the gap to the period, squared). `tightness` is how hard the tempo is held; a song whose tempo wanders needs a lower number.
 */
export function trackBeats(env: Float64Array, fps: number, bpm: number, tightness = 100): number[] {
  const n = env.length;
  const P = (fps * 60) / bpm;
  const lo = Math.max(1, Math.round(P / 2));
  const hi = Math.max(lo + 1, Math.round(P * 2));
  const C = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  for (let t = 0; t < n; t++) {
    let best = 0, bj = -1;
    for (let tau = lo; tau <= hi; tau++) {
      const j = t - tau;
      if (j < 0) break;
      const cand = C[j]! - tightness * Math.log(tau / P) ** 2;
      if (cand > best) { best = cand; bj = j; }
    }
    C[t] = env[t]! + best;
    back[t] = bj;
  }
  // end on the best score in the last two periods, then walk back
  let end = Math.max(0, n - 1 - Math.round(2 * P));
  for (let t = end; t < n; t++) if (C[t]! > C[end]!) end = t;
  const beats: number[] = [];
  for (let t = end; t >= 0; t = back[t]!) { beats.push(t); if (back[t]! < 0) break; }
  return beats.reverse();
}

/** Which of every four beats carries the kick hardest: the index (0 to 3) of the first beat that is a downbeat, and how much stronger it is than the runner-up. */
export function findDownbeat(beatFrames: number[], low: Float64Array): { first: number; margin: number } {
  const sums = [0, 0, 0, 0];
  const counts = [0, 0, 0, 0];
  beatFrames.forEach((f, i) => {
    let m = 0;
    for (let d = -2; d <= 2; d++) m = Math.max(m, low[Math.min(low.length - 1, Math.max(0, f + d))]!);
    sums[i % 4]! += m;
    counts[i % 4]!++;
  });
  const mean = sums.map((s, k) => s / Math.max(1, counts[k]!));
  const order = [0, 1, 2, 3].sort((a, b) => mean[b]! - mean[a]!);
  return { first: order[0]!, margin: mean[order[1]!]! > 0 ? mean[order[0]!]! / mean[order[1]!]! : 10 };
}

export interface Grid {
  /** Time of beat 0 on the fitted grid, seconds. */
  t0: number;
  /** Seconds per beat. */
  interval: number;
  bpm: number;
  /** How far the detected beats sit from the grid, milliseconds. */
  rmsMs: number;
  maxMs: number;
}

/** The one steady tempo that the beats lie nearest (least squares), and how far they stray from it. */
export function fitGrid(beats: readonly number[]): Grid {
  const n = beats.length;
  if (n < 2) return { t0: beats[0] ?? 0, interval: 0.5, bpm: 120, rmsMs: Infinity, maxMs: Infinity };
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sx += i; sy += beats[i]!; sxx += i * i; sxy += i * beats[i]!; }
  const interval = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const t0 = (sy - interval * sx) / n;
  let se = 0, mx = 0;
  for (let i = 0; i < n; i++) { const e = beats[i]! - (t0 + i * interval); se += e * e; mx = Math.max(mx, Math.abs(e)); }
  return { t0, interval, bpm: 60 / interval, rmsMs: Math.sqrt(se / n) * 1000, maxMs: mx * 1000 };
}

// ---- the whole song ---------------------------------------------------------------------------------------------------------------------

export interface Analysis {
  bpm: number;
  /** Beat times in seconds, first to last. */
  beats: number[];
  /** Index into `beats` of the first downbeat (0 to 3). */
  downbeat: number;
  /** How clearly the kick marks the "1" (1 is no better than a guess). */
  downbeatMargin: number;
  tempo: TempoEstimate;
  grid: Grid;
  fps: number;
  onsets: Onsets;
}

/**
 * `hintBpm` (the tempo that was ASKED for) only breaks a tie between octaves: a lullaby asked at 90 that the audio supports as 83 or as 165 is read as 83. It
 * is never a tempo of its own and never moves one the audio makes clear; the tempo that is returned is measured from the audio.
 */
export function analyzeSong(x: Float32Array | Float64Array, sr: number, opts: { tightness?: number; hintBpm?: number } = {}): Analysis {
  const onsets = onsetEnvelope(x, sr);
  const tempo = estimateTempo(onsets.env, onsets.fps);
  // two readings the audio supports equally (half time and double time): take the one nearer what was asked for. A tempo the audio makes clear is never moved.
  let beatBpm = tempo.bpm;
  if (opts.hintBpm && tempo.alternate && Math.abs(Math.log(tempo.alternate / opts.hintBpm)) < Math.abs(Math.log(tempo.bpm / opts.hintBpm))) beatBpm = tempo.alternate;
  const frames = trackBeats(onsets.env, onsets.fps, beatBpm, opts.tightness ?? 100);
  const down = findDownbeat(frames, onsets.low);
  const beats = frames.map((f) => onsets.t0 + f / onsets.fps);
  const grid = fitGrid(beats);
  return { bpm: grid.bpm, beats, downbeat: down.first, downbeatMargin: down.margin, tempo, grid, fps: onsets.fps, onsets };
}

// ---- the excerpt ---------------------------------------------------------------------------------------------------------------------

export interface Excerpt {
  /** Index into `beats` of the first beat of the excerpt (a downbeat). */
  startBeat: number;
  bars: number;
  /** Seconds in the source where the excerpt starts and ends (on beats). */
  start: number;
  end: number;
  score: number;
}

/**
 * A whole number of bars from a downbeat to a downbeat, about `targetSeconds` long, from the steadiest and loudest stretch: not in the first `skipStart`
 * seconds (an intro is not the dance) nor in the last `skipEnd` (an ending, and the audio watermark Mureka appends to the end of a file). Returns null if
 * the song is too short for that.
 */
export function pickExcerpt(a: Analysis, duration: number, { targetSeconds = 64, skipStart = 8, skipEnd = 20 } = {}): Excerpt | null {
  const iv = a.grid.interval;
  const bars = Math.max(4, Math.round(targetSeconds / (4 * iv)));
  const spanBeats = bars * 4;
  let best: Excerpt | null = null;
  const { rms, fps, t0 } = a.onsets;
  for (let s = a.downbeat; s + spanBeats < a.beats.length; s += 4) {
    const start = a.beats[s]!, end = a.beats[s + spanBeats]!;
    if (start < skipStart || end > duration - skipEnd) continue;
    // loudness and steadiness of the bars in it
    const barRms: number[] = [];
    for (let b = 0; b < bars; b++) {
      const f0 = Math.round(((a.beats[s + b * 4]! - t0) * fps)), f1 = Math.round(((a.beats[s + b * 4 + 4]! - t0) * fps));
      let sum = 0;
      for (let f = Math.max(0, f0); f < Math.min(rms.length, f1); f++) sum += rms[f]!;
      barRms.push(sum / Math.max(1, f1 - f0));
    }
    const mean = barRms.reduce((x, y) => x + y, 0) / barRms.length;
    const sd = Math.sqrt(barRms.reduce((x, y) => x + (y - mean) ** 2, 0) / barRms.length);
    // how well these beats keep one tempo
    const seg = fitGrid(a.beats.slice(s, s + spanBeats + 1));
    const score = mean * (1 - Math.min(1, sd / (mean || 1))) / (1 + seg.rmsMs / 20);
    if (!best || score > best.score) best = { startBeat: s, bars, start, end, score };
  }
  return best;
}
