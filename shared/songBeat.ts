/**
 * The song clock for the dance party (docs/specs/dance-party-spec.md, 3.3, 4.4, 5.1): a beat map for one song, and everything that reads it.
 *
 * AI songs have no guaranteed tempo, so tempo is MEASURED, never trusted (4.4). The ingest (a script for the starter library, the Worker for
 * live songs) turns the beat times it found into a map with `makeBeatMap`; the dance, the glow and the tap judge only ever read that map.
 *
 *   parseBeatMap / makeBeatMap   a stored map, checked field by field; beat times to a map, with the tempo measured from them.
 *   beatAt                       a song time (seconds) to the beat it is in: fractional position, phase, bar, beat in bar.
 *   clipTime                     the time inside a dance clip for a song time. It follows the song's REAL beats, not `rate * t`, so
 *                                the dance cannot drift from the sound however the song's tempo wanders (gate: no drift over 60 s).
 *   tempoRate / pickDance        the rate a clip must play at to fit a song (0.8 to 1.25, outside that pick another clip).
 *   beatPulse                    a 0 to 1 flash for lights and headphone cups, 1 on the beat and gone before the next.
 *   judgeTap / scoreTaps         a tap time to the nearest beat (80 ms counts), one tap per beat, output latency removed.
 *   beatPlayFor                  what a child of an age band is asked to do with the beat (5.1).
 *
 * The caller owns the clock: song time is `AudioContext.currentTime - startedAt` (4.4), never frames. Times here are seconds from the start of
 * the audio file; the first beat is the first downbeat. Pure: no DOM, no audio, no storage, no imports.
 */

export const BEATS_PER_BAR = 4;
/** Slower or faster than this is not a song a dance can follow. */
export const MIN_BPM = 40;
export const MAX_BPM = 220;
/** About 18 minutes at the top tempo: a bound, so a corrupt map cannot be a megabyte. */
export const MAX_BEATS = 4000;
/** A dance is never played more than a quarter off its natural speed (3.3). */
export const TEMPO_RATE_MIN = 0.8;
export const TEMPO_RATE_MAX = 1.25;
/** A tap within this many milliseconds of a beat counts (phase 3 gate). */
export const TAP_WINDOW_MS = 80;
/** The stored `bpm` may differ from the one measured off the beats by this much (rounding), and no more. */
export const BPM_TOLERANCE = 0.02;
/** An interval outside this band around the median is a missed or an invented beat, not music. */
export const INTERVAL_BAND = [0.6, 1.6] as const;

export interface BeatMap {
  /** Measured off `beats`, never the tempo that was asked for. */
  bpm: number;
  /** Seconds from the start of the audio, strictly rising. `beats[0]` is a downbeat. */
  beats: number[];
  /** Whole bars of four beats. */
  bars: number;
}

export type BeatMapProblem =
  | "not_object"
  | "bad_beats"
  | "too_few_beats"
  | "too_many_beats"
  | "bad_beat_time"
  | "not_ascending"
  | "irregular"
  | "bad_bpm"
  | "bpm_not_measured"
  | "bad_bars";

export type BeatMapResult = { ok: true; map: BeatMap } | { ok: false; reason: BeatMapProblem };

/** `xs[i]` where the index is known to be in range (the callers bound it); the project forbids an unchecked index otherwise. */
function at(xs: readonly number[], i: number): number {
  return xs[i] as number;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? at(s, m) : (at(s, m - 1) + at(s, m)) / 2;
}

/** 60 / the median gap between beats. `null` with fewer than two beats or no positive gap. */
export function measureBpm(beats: readonly number[]): number | null {
  if (beats.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < beats.length; i++) gaps.push(at(beats, i) - at(beats, i - 1));
  const m = median(gaps);
  return m > 0 && Number.isFinite(m) ? 60 / m : null;
}

function checkBeats(beats: unknown): { ok: true; beats: number[] } | { ok: false; reason: BeatMapProblem } {
  if (!Array.isArray(beats)) return { ok: false, reason: "bad_beats" };
  if (beats.length < BEATS_PER_BAR) return { ok: false, reason: "too_few_beats" };
  if (beats.length > MAX_BEATS) return { ok: false, reason: "too_many_beats" };
  for (const b of beats) if (typeof b !== "number" || !Number.isFinite(b) || b < 0) return { ok: false, reason: "bad_beat_time" };
  for (let i = 1; i < beats.length; i++) if (!(beats[i] > beats[i - 1])) return { ok: false, reason: "not_ascending" };
  const bpm = measureBpm(beats as number[]);
  if (bpm === null || bpm < MIN_BPM || bpm > MAX_BPM) return { ok: false, reason: "bad_bpm" };
  const mid = 60 / bpm;
  for (let i = 1; i < beats.length; i++) {
    const gap = beats[i] - beats[i - 1];
    if (gap < mid * INTERVAL_BAND[0] || gap > mid * INTERVAL_BAND[1]) return { ok: false, reason: "irregular" };
  }
  return { ok: true, beats: [...(beats as number[])] };
}

/** Beat times found by the analysis to a map. The tempo is whatever the beats say. */
export function makeBeatMap(beats: unknown): BeatMapResult {
  const c = checkBeats(beats);
  if (!c.ok) return c;
  const bpm = measureBpm(c.beats) as number;
  return { ok: true, map: { bpm, beats: c.beats, bars: Math.floor(c.beats.length / BEATS_PER_BAR) } };
}

/** A map as it was stored, checked: `bpm` must be what the beats measure (within rounding) and `bars` what they hold. */
export function parseBeatMap(raw: unknown): BeatMapResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, reason: "not_object" };
  const r = raw as Record<string, unknown>;
  const made = makeBeatMap(r.beats);
  if (!made.ok) return made;
  if (typeof r.bpm !== "number" || !Number.isFinite(r.bpm)) return { ok: false, reason: "bad_bpm" };
  if (Math.abs(r.bpm - made.map.bpm) > made.map.bpm * BPM_TOLERANCE) return { ok: false, reason: "bpm_not_measured" };
  if (r.bars !== made.map.bars) return { ok: false, reason: "bad_bars" };
  return { ok: true, map: { bpm: r.bpm, beats: made.map.beats, bars: made.map.bars } };
}

// ---- where the song is -----------------------------------------------------------------------------------------------------

export interface BeatPlace {
  /** Beats since `beats[0]`, fractional; negative before the first beat. Continuous and rising with `t`. */
  position: number;
  /** floor(position): the beat just passed. */
  index: number;
  /** 0 on the beat, rising to just under 1 at the next. */
  phase: number;
  bar: number;
  /** 0 to 3, 0 is the downbeat. */
  beatInBar: number;
}

/** Index i with beats[i] <= t < beats[i+1], clamped to [0, n-2] (so the edge intervals extend outward). */
function intervalIndex(beats: readonly number[], t: number): number {
  let lo = 0;
  let hi = beats.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (at(beats, mid) <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * The song's own beats place the time, so a tempo that wanders is followed exactly. Before the first beat and after the last, the
 * nearest interval is extended, so a tail of glow or a count-in is defined and the position never jumps.
 */
export function beatAt(map: BeatMap, t: number): BeatPlace {
  const b = map.beats;
  const i = intervalIndex(b, t);
  const position = i + (t - at(b, i)) / (at(b, i + 1) - at(b, i));
  const index = Math.floor(position);
  const mod = ((index % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR;
  return { position, index, phase: position - index, bar: Math.floor(index / BEATS_PER_BAR), beatInBar: mod };
}

export interface DanceClip {
  id: string;
  /** The tempo the clip was authored at (a Mixamo clip has none in its file: someone counts it once). */
  bpm: number;
  /** Whole beats in one loop of the clip. */
  beats: number;
}

/**
 * The time (seconds, 0 to one loop) inside `clip` for song time `t`. The clip plays at its authored speed against BEATS, not seconds: the song
 * position in beats is wrapped to the clip's loop, then converted at the clip's own bpm. Every song beat is therefore the same point of the
 * clip every loop, for any tempo, and the clip never drifts against the sound.
 */
export function clipTime(map: BeatMap, t: number, clip: Pick<DanceClip, "bpm" | "beats">): number {
  const { position } = beatAt(map, t);
  const wrapped = ((position % clip.beats) + clip.beats) % clip.beats;
  return wrapped * (60 / clip.bpm);
}

// ---- tempo ------------------------------------------------------------------------------------------------------------------

/** How fast a clip must play to fit a song, and whether that is inside the quarter-either-way limit (3.3). */
export function tempoRate(songBpm: number, clipBpm: number): { rate: number; inRange: boolean } {
  if (!(songBpm > 0) || !(clipBpm > 0) || !Number.isFinite(songBpm) || !Number.isFinite(clipBpm)) return { rate: NaN, inRange: false };
  const rate = songBpm / clipBpm;
  return { rate, inRange: rate >= TEMPO_RATE_MIN && rate <= TEMPO_RATE_MAX };
}

/**
 * The dance a song picks: among clips whose rate is in range, the nearest to natural speed first, then by id, so the answer is the same
 * every time. `variant` steps down that list (a second Kip, the next song), wrapping. `null` when no clip fits: the caller plays no dance,
 * it does not stretch one.
 */
export function pickDance(songBpm: number, clips: readonly Pick<DanceClip, "id" | "bpm">[], variant = 0): { id: string; rate: number } | null {
  const fit = clips
    .map((c) => ({ id: c.id, ...tempoRate(songBpm, c.bpm) }))
    .filter((c) => c.inRange)
    .sort((a, b) => Math.abs(Math.log(a.rate)) - Math.abs(Math.log(b.rate)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (!fit.length) return null;
  const v = Number.isInteger(variant) && variant >= 0 ? variant : 0;
  const c = fit[v % fit.length];
  return c ? { id: c.id, rate: c.rate } : null;
}

// ---- glow -------------------------------------------------------------------------------------------------------------------

/** 1 on the beat, falling to 0 by `decay` of the way to the next, 0 after. Eased, so it reads as a flash and not a blink. */
export function beatPulse(phase: number, decay = 0.4): number {
  if (!(phase >= 0) || !(decay > 0)) return 0;
  const p = phase % 1;
  return p < decay ? (1 - p / decay) ** 2 : 0;
}

// ---- taps -------------------------------------------------------------------------------------------------------------------

export interface TapJudgement {
  hit: boolean;
  /** Index into `map.beats` of the nearest beat. */
  beatIndex: number;
  /** Tap minus beat, ms: positive is late. Output latency already removed. */
  errorMs: number;
}

export interface TapOptions {
  windowMs?: number;
  /** How long the sound takes to reach the child's ear after the clock says it played (`AudioContext.outputLatency`). The child taps
   * on what they HEAR, so this is taken off the tap time. */
  latencyMs?: number;
}

/** The nearest beat to a time, by index. */
function nearestBeat(beats: readonly number[], t: number): number {
  const i = intervalIndex(beats, t);
  return t - at(beats, i) <= at(beats, i + 1) - t ? i : i + 1;
}

export function judgeTap(map: BeatMap, tapTime: number, opts: TapOptions = {}): TapJudgement {
  const windowMs = opts.windowMs ?? TAP_WINDOW_MS;
  const t = tapTime - (opts.latencyMs ?? 0) / 1000;
  const i = nearestBeat(map.beats, t);
  const errorMs = (t - at(map.beats, i)) * 1000;
  return { hit: Math.abs(errorMs) <= windowMs, beatIndex: i, errorMs };
}

export interface TapScore {
  /** Taps that counted, in time order. A beat counts once, so a double tap is one hit. */
  hits: (TapJudgement & { tap: number })[];
  /** Taps that did not count: off the beat, or on a beat already hit. */
  strays: number[];
  /** Mean absolute error of the hits, ms; 0 with none. */
  meanAbsErrorMs: number;
}

/** A whole run of taps. When two taps are near one beat, the nearer one is the hit. */
export function scoreTaps(map: BeatMap, taps: readonly number[], opts: TapOptions = {}): TapScore {
  const best = new Map<number, TapJudgement & { tap: number }>();
  const strays: number[] = [];
  for (const tap of [...taps].sort((a, b) => a - b)) {
    const j = judgeTap(map, tap, opts);
    if (!j.hit) {
      strays.push(tap);
      continue;
    }
    const prev = best.get(j.beatIndex);
    if (!prev) best.set(j.beatIndex, { ...j, tap });
    else if (Math.abs(j.errorMs) < Math.abs(prev.errorMs)) {
      strays.push(prev.tap);
      best.set(j.beatIndex, { ...j, tap });
    } else strays.push(tap);
  }
  const hits = [...best.values()].sort((a, b) => a.tap - b.tap);
  const meanAbsErrorMs = hits.length ? hits.reduce((s, h) => s + Math.abs(h.errorMs), 0) / hits.length : 0;
  return { hits, strays: strays.sort((a, b) => a - b), meanAbsErrorMs };
}

// ---- age bands --------------------------------------------------------------------------------------------------------------

export type BeatPlayMode = "free" | "on_beat" | "copy" | "compose";

export interface BeatPlay {
  mode: BeatPlayMode;
  /** Whether a tap is judged at all. In `free` there are no wrong taps. */
  judged: boolean;
  /** Steps in the pattern to copy or compose (0 when there is none). */
  steps: number;
}

const BEAT_PLAY: readonly BeatPlay[] = [
  { mode: "free", judged: false, steps: 0 }, // 2 to 3: tap anywhere, Kip dances
  { mode: "free", judged: false, steps: 0 }, // 3 to 4
  { mode: "on_beat", judged: true, steps: 0 }, // 5 to 6: tap on the beat for a flash
  { mode: "copy", judged: true, steps: 4 }, // 7 to 9: copy a 4-step pattern
  { mode: "compose", judged: true, steps: 8 }, // 10 to 12: compose an 8-step loop
  { mode: "compose", judged: true, steps: 8 }, // 13+
];

/**
 * What a child of band `band` (src/lib/age.ts, 0 to 5) does with the beat (5.1). `undefined` or `null` (no band chosen yet) is the
 * youngest; anything else that is not a band is read the same way, so a corrupt value never asks more of a child than a chosen one would.
 */
export function beatPlayFor(band: unknown): BeatPlay {
  const ok = typeof band === "number" && Number.isInteger(band) && band >= 0 && band < BEAT_PLAY.length;
  return { ...(BEAT_PLAY[ok ? (band as number) : 0] as BeatPlay) };
}
