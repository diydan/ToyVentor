/**
 * The dance party's brain (docs/specs/dance-party-spec.md 5.1): given a song's tempo and a clock, what Kip dances, how far into the dance it is,
 * how bright the beat flash is, and what a child's tap did. Everything the Kip bench's party mode decides lives here, as pure functions, so it is
 * tested without a browser; the bench only reads `partyFrame` once a frame and calls `registerTap` on a tap.
 *
 *   planParty        pick the dance a song's tempo fits (shared/songBeat.ts `pickDance`: a quarter either way, never stretched), or none.
 *   practiceBeatMap  the beat grid of the synthesized practice beat (shared/songSynth.ts): exact by construction, because the sound is scheduled on it.
 *   partyFrame       one frame: the dance's clip time (locked to the song's BEATS, so it cannot drift), the glow pulse, the count 1 2 3 4.
 *   newTapRun / registerTap / tapSummary
 *                    what a tap does by age band (`beatPlayFor`): bands 0 and 1 any tap is a hit (no wrong taps); from band 2 a tap within
 *                    80 ms of a beat is a hit, once per beat. Bands 3 to 5 are asked to copy and compose patterns (5.1); that is not built, so
 *                    they play the band 2 game for now.
 *
 * Pure: no DOM, no audio, no clock. Times are seconds of SONG time (the audio clock minus the song's start), supplied by the caller.
 */
import {
  MAX_BEATS,
  TAP_WINDOW_MS,
  beatAt,
  beatPlayFor,
  beatPulse,
  clipTime,
  judgeTap,
  makeBeatMap,
  pickDance,
  type BeatMap,
  type BeatPlace,
  type DanceClip,
} from "./songBeat";

export interface PartyPlan {
  songBpm: number;
  /** The dance the tempo fits, or `null`: then the party is lights only, it never stretches a dance (3.3). */
  dance: { clip: DanceClip; rate: number } | null;
}

/**
 * `dances` are the clips that carry a tempo (kip-clips.js dances and the baked Mixamo ones). `variant` steps down the fitting list, for a second
 * Kip or the next song. A clip without a positive `bpm` and a whole `beats` is never picked.
 */
export function planParty(songBpm: number, dances: readonly DanceClip[], variant = 0): PartyPlan {
  const usable = dances.filter((d) => d.bpm > 0 && Number.isInteger(d.beats) && d.beats > 0);
  const pick = pickDance(songBpm, usable, variant);
  const clip = pick ? usable.find((d) => d.id === pick.id) : undefined;
  return { songBpm, dance: pick && clip ? { clip, rate: pick.rate } : null };
}

/**
 * The beat grid of a synthesized song that starts at song time 0 with a downbeat and holds `bpm` exactly, `seconds` long (the practice beat plays
 * until then and stops). Because the audio is scheduled on this very grid, there is no measurement to trust.
 */
export function practiceBeatMap(bpm: number, seconds = 600): BeatMap {
  const interval = 60 / bpm;
  const n = Math.min(MAX_BEATS, Math.max(8, Math.floor(seconds / interval)));
  const r = makeBeatMap(Array.from({ length: n }, (_, i) => i * interval));
  if (!r.ok) throw new Error(`practiceBeatMap: ${bpm} bpm is not a tempo a party can follow (${r.reason})`);
  return r.map;
}

export interface PartyFrame {
  place: BeatPlace;
  /** 1 to 4: the beat of the bar, for the count on the screen. */
  count: 1 | 2 | 3 | 4;
  downbeat: boolean;
  /** 0 to 1: the flash for the lights and the headphone cups, 1 on the beat. */
  pulse: number;
  /** The clip to play, or `null` (lights only). */
  danceId: string | null;
  /** Seconds into that clip for this frame. Follows the song's beats, not a stopwatch. */
  danceTime: number | null;
}

export function partyFrame(plan: PartyPlan, map: BeatMap, t: number): PartyFrame {
  const place = beatAt(map, t);
  const count = (place.beatInBar + 1) as 1 | 2 | 3 | 4;
  return {
    place,
    count,
    downbeat: place.beatInBar === 0,
    pulse: beatPulse(place.phase),
    danceId: plan.dance ? plan.dance.clip.id : null,
    danceTime: plan.dance ? clipTime(map, t, plan.dance.clip) : null,
  };
}

// ---- taps -------------------------------------------------------------------------------------------------------------------

export interface TapRun {
  band: number;
  /** `free`: any tap counts. `on_beat`: a tap near a beat counts, once per beat. */
  mode: "free" | "on_beat";
  taps: number;
  hits: number;
  /** Beats already hit, so one beat counts once. */
  claimed: Set<number>;
  /** Signed error of each hit, ms (positive late). Empty in `free`. */
  errors: number[];
}

export type TapOutcome =
  | { kind: "free" }
  | { kind: "hit"; errorMs: number; beatIndex: number }
  | { kind: "miss"; errorMs: number }
  | { kind: "repeat"; beatIndex: number };

export function newTapRun(band: unknown): TapRun {
  const play = beatPlayFor(band);
  return { band: typeof band === "number" ? band : 0, mode: play.judged ? "on_beat" : "free", taps: 0, hits: 0, claimed: new Set(), errors: [] };
}

/** Whether a tap earns the flash: every tap in `free`, only a hit otherwise. A miss or a repeat is silent: no wrong-tap feedback for a child. */
export const tapFlashes = (o: TapOutcome): boolean => o.kind === "free" || o.kind === "hit";

export function registerTap(run: TapRun, map: BeatMap, songTime: number, opts: { latencyMs?: number; windowMs?: number } = {}): TapOutcome {
  run.taps++;
  if (run.mode === "free") {
    run.hits++;
    return { kind: "free" };
  }
  const j = judgeTap(map, songTime, { windowMs: opts.windowMs ?? TAP_WINDOW_MS, latencyMs: opts.latencyMs ?? 0 });
  if (!j.hit) return { kind: "miss", errorMs: j.errorMs };
  if (run.claimed.has(j.beatIndex)) return { kind: "repeat", beatIndex: j.beatIndex };
  run.claimed.add(j.beatIndex);
  run.hits++;
  run.errors.push(j.errorMs);
  return { kind: "hit", errorMs: j.errorMs, beatIndex: j.beatIndex };
}

export function tapSummary(run: TapRun): { taps: number; hits: number; meanAbsErrorMs: number } {
  const e = run.errors;
  return { taps: run.taps, hits: run.hits, meanAbsErrorMs: e.length ? e.reduce((s, x) => s + Math.abs(x), 0) / e.length : 0 };
}

// The browser bundle (public/kip/kip-party-core.js, built from this file) carries these too, so the page imports ONE module.
export {
  BEATS_PER_BAR,
  MAX_BPM,
  MIN_BPM,
  TAP_WINDOW_MS,
  TEMPO_RATE_MAX,
  TEMPO_RATE_MIN,
  beatAt,
  beatPlayFor,
  beatPulse,
  clipTime,
  judgeTap,
  pickDance,
  tempoRate,
} from "./songBeat";
export type { BeatMap, BeatPlace, DanceClip } from "./songBeat";
export { INSTRUMENTS, MOODS, TEMPOS, TEMPO_BPM, buildSongRequest, promptFor } from "./songCards";
export type { Mood, Tempo } from "./songCards";
export { LOOP_BEATS, MOOD_SYNTH, loopEvents, midiToHz } from "./songSynth";
export type { SynthEvent, Voice } from "./songSynth";
