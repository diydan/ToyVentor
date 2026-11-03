/**
 * A child's own theme song, made ready to dance to (docs/specs/dance-party-spec.md 4.4, the starter library's ingest, scripts/song-ingest.ts, done in the BROWSER).
 *
 * The starter songs are measured and cut by a script on the owner's machine (ffmpeg). A theme song is made while a child plays, so the same three steps run in
 * the page, on the samples the browser decoded:
 *   1. MEASURE   the beat (shared/songAnalyze.ts: tempo, beats, the "1"): about 65 ms for a 50 second song.
 *   2. PLAN      which whole bars to dance to: from the first "1" to the last whole bar that ends before Mureka's audio watermark (it appends about 5 seconds to the
 *                end of a file, docs/specs/mureka-api-reference.md), the grid fitted to just those bars. A song whose beats do not lie on one steady tempo, or whose
 *                tempo no dance can follow, is REJECTED with a reason, not forced (it can still be played, just not danced to).
 *   3. CUT       that stretch into a 16-bit WAV (every browser decodes WAV) with 10 ms fades, starting `PREROLL_S` before the first beat, so the party's engine
 *                (kip-party-audio.js `startSong`) loops it exactly on its grid like a library excerpt.
 * The result is an index entry in the library's own shape, so the party checks it with the same `parseSongIndex` as every starter song.
 *
 * Pure: no DOM, no network, no clock. Samples in, numbers and bytes out.
 */
import { analyzeSong, fitGrid, type Analysis } from "./songAnalyze";
import { MOODS } from "./songCards";

/** The rate the beat is measured at (the rate the whole analyzer was tuned and tested at). */
export const ANALYSIS_RATE = 22050;
/** Mureka appends about 5 s of watermark audio to a file; 0.5 s more for the fade of the song's own ending. The dance and the loop never include it. */
export const WATERMARK_TAIL_S = 5.5;
/** The first beat of the cut sounds this long after the cut starts, so its attack is not clipped (the library uses the same). */
export const PREROLL_S = 0.02;
export const FADE_S = 0.01;
/** A cut shorter than this many bars is not worth a party (the index needs at least 8 s and a whole number of bars). */
export const MIN_BARS = 4;
/** The same limits the starter library is held to (scripts/song-ingest.ts). */
export const MAX_GRID_RMS_MS = 30;
export const MAX_GRID_MAX_MS = 90;
export const MIN_BPM = 64;
export const MAX_BPM = 170;
/** The index's own bound on a song's size and length (shared/songParty.ts), so an entry here always passes `parseSongIndex`. */
const INDEX_MAX_BYTES = 3_000_000;
const INDEX_MAX_DUR = 180;

/** One channel's worth of samples, or several: the browser's `AudioBuffer.getChannelData(i)` arrays. */
export type Channels = ArrayLike<number>[];

/** Mono at the analysis rate: the channels averaged, then resampled (linear, with a box average when going down) to 22.05 kHz. */
export function toAnalysisMono(channels: Channels, sampleRate: number): Float32Array {
  const n = channels[0]?.length ?? 0;
  if (!n || !(sampleRate > 0)) return new Float32Array(0);
  const mono = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) mono[i]! += ch[i]! / channels.length;
  if (Math.abs(sampleRate - ANALYSIS_RATE) < 1) return mono;
  const ratio = sampleRate / ANALYSIS_RATE;
  const outN = Math.floor(n / ratio);
  const out = new Float32Array(outN);
  // a box average over one output sample's span: a cheap low-pass, enough before an onset measurement
  for (let o = 0; o < outN; o++) {
    const a = o * ratio, b = Math.min(n, (o + 1) * ratio);
    let i = Math.floor(a), sum = 0, w = 0;
    for (; i < b; i++) {
      const lo = Math.max(a, i), hi = Math.min(b, i + 1);
      const wt = hi - lo;
      if (wt > 0) { sum += mono[i]! * wt; w += wt; }
    }
    out[o] = w > 0 ? sum / w : 0;
  }
  return out;
}

export interface ThemeCut {
  /** Seconds into the source where the cut starts (`PREROLL_S` before the first beat). */
  startSec: number;
  /** Exact length of the loop: bars x 4 x interval. */
  lengthSec: number;
  bars: number;
  beats: number;
  /** Seconds per beat, from the grid fitted to the cut's own bars. */
  interval: number;
  bpm: number;
  /** When the first beat (a downbeat) sounds inside the cut. */
  offset: number;
  gridRmsMs: number;
  gridMaxMs: number;
  downbeatMargin: number;
  /** Seconds of the source the cut leaves off at the end (the watermark and the ending's fade). */
  tailLeftOffSec: number;
}
export type ThemeCutResult = { ok: true; cut: ThemeCut } | { ok: false; reason: string };

/** Which whole bars to dance to, from an analysis of the whole file. `durationSec` is the file's full length. */
export function planThemeCut(a: Pick<Analysis, "beats" | "downbeat" | "downbeatMargin">, durationSec: number): ThemeCutResult {
  const beats = a.beats;
  if (beats.length < MIN_BARS * 4 + 1) return { ok: false, reason: "too_few_beats" };
  const usableEnd = durationSec - WATERMARK_TAIL_S;
  const startBeat = a.downbeat;
  // the most whole bars from the first "1" whose last beat still falls before the watermark
  let bars = 0;
  while (startBeat + (bars + 1) * 4 < beats.length && beats[startBeat + (bars + 1) * 4]! <= usableEnd) bars++;
  if (bars < MIN_BARS) return { ok: false, reason: "too_short_before_the_watermark" };
  const grid = fitGrid(beats.slice(startBeat, startBeat + bars * 4 + 1));
  if (grid.rmsMs > MAX_GRID_RMS_MS || grid.maxMs > MAX_GRID_MAX_MS) return { ok: false, reason: "beats_not_steady" };
  if (!(grid.bpm >= MIN_BPM && grid.bpm <= MAX_BPM)) return { ok: false, reason: "tempo_out_of_range" };
  const lengthSec = bars * 4 * grid.interval;
  if (lengthSec < 8 || lengthSec > INDEX_MAX_DUR) return { ok: false, reason: "length_out_of_range" };
  const startSec = Math.max(0, grid.t0 - PREROLL_S);
  return {
    ok: true,
    cut: {
      startSec, lengthSec, bars, beats: bars * 4, interval: grid.interval, bpm: grid.bpm, offset: grid.t0 - startSec,
      gridRmsMs: grid.rmsMs, gridMaxMs: grid.maxMs, downbeatMargin: a.downbeatMargin, tailLeftOffSec: Math.max(0, durationSec - (startSec + lengthSec)),
    },
  };
}

/** Measure a decoded song and plan its cut. One call, from the browser's decoded channels. */
export function analyseTheme(channels: Channels, sampleRate: number): ThemeCutResult {
  const mono = toAnalysisMono(channels, sampleRate);
  if (mono.length < ANALYSIS_RATE * 12) return { ok: false, reason: "too_short" };
  const a = analyzeSong(mono, ANALYSIS_RATE);
  return planThemeCut(a, channels[0]!.length / sampleRate);
}

/** The cut as a 16-bit PCM WAV (interleaved, every channel kept, 10 ms fades at both ends so the loop's seam does not click). */
export function cutToWav(channels: Channels, sampleRate: number, cut: Pick<ThemeCut, "startSec" | "lengthSec">): ArrayBuffer {
  const nch = Math.max(1, Math.min(2, channels.length));
  const first = Math.max(0, Math.round(cut.startSec * sampleRate));
  const total = Math.max(0, Math.min((channels[0]?.length ?? 0) - first, Math.round(cut.lengthSec * sampleRate)));
  const dataBytes = total * nch * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + dataBytes, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, nch, true); v.setUint32(24, Math.round(sampleRate), true);
  v.setUint32(28, Math.round(sampleRate) * nch * 2, true); v.setUint16(32, nch * 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, dataBytes, true);
  const fade = Math.max(1, Math.round(FADE_S * sampleRate));
  let o = 44;
  for (let i = 0; i < total; i++) {
    const g = Math.min(1, (i + 1) / fade, (total - i) / fade);
    for (let c = 0; c < nch; c++) {
      const s = Math.max(-1, Math.min(1, (channels[c]![first + i] ?? 0) * g));
      v.setInt16(o, s < 0 ? Math.round(s * 32768) : Math.round(s * 32767), true);
      o += 2;
    }
  }
  return buf;
}

export const themeSongId = (task: string): string => `my_${String(task).replace(/[^0-9]/g, "").slice(0, 30)}`;

export interface KeptTheme {
  task: string;
  name: string;
  mood?: string;
}

/** A library-shaped index entry for a cut song, which `parseSongIndex` checks like any starter song. `mp3Bytes` is the size of the file it was cut from. */
export function themeIndexEntry(kept: KeptTheme, cut: ThemeCut, mp3Bytes: number): Record<string, unknown> {
  const id = themeSongId(kept.task);
  const mood = (MOODS as readonly string[]).includes(kept.mood ?? "") ? kept.mood : "bouncy";
  return {
    id,
    title: String(kept.name).slice(0, 40),
    mood,
    file: `${id}.mp3`, // only a name: the page maps `my_` names to the cut it makes (the WAV below), never to a file of ours
    bytes: Math.max(1, Math.min(INDEX_MAX_BYTES, Math.round(mp3Bytes) || 1)),
    dur: Number(cut.lengthSec.toFixed(4)),
    bpm: Number((60 / cut.interval).toFixed(4)),
    beats: cut.beats,
    bars: cut.bars,
    offset: Number(cut.offset.toFixed(4)),
    loop: true,
    ai: true,
    source: { task: String(kept.task), mine: true },
    analysis: { gridRmsMs: Number(cut.gridRmsMs.toFixed(1)), gridMaxMs: Number(cut.gridMaxMs.toFixed(1)), downbeatMargin: Number(cut.downbeatMargin.toFixed(2)) },
  };
}
