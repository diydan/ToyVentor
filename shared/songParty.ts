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
import { MOODS, type Mood } from "./songCards";
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
  tempoRate,
  type BeatMap,
  type BeatPlace,
  type DanceClip,
} from "./songBeat";

/** A clip the party can play to a song: the tempo it was authored at, and what kind of move it is. */
export interface PartyClip extends DanceClip {
  /** `dance` (picked automatically), or `move` / `music` (a movement-break move, a guitar strum): offered only when a child chooses it. */
  group?: string;
  label?: string;
}

export interface PartyPlan {
  songBpm: number;
  /** The dance the tempo fits, or `null`: then the party is lights only, it never stretches a dance (3.3). */
  dance: { clip: PartyClip; rate: number } | null;
  /** True when this clip was CHOSEN by the child (the Dance picker), false when the tempo picked it. */
  chosen: boolean;
  /** True when a clip was asked for but does not fit this tempo, so the tempo's own pick was used. */
  fellBack: boolean;
  /** The Dance MIX: the dances that fit, in the order they take turns, and how many beats each gets. `null` unless the child chose Mix and at least two dances fit. */
  mix: { list: { clip: PartyClip; rate: number }[]; every: number } | null;
}

/** What the Dance picker's Mix is called in a choice. */
export const MIX_CHOICE = "mix";
/** A new dance every 16 beats: 4 bars, on the bar line. */
export const MIX_BEATS = 16;

const usable = (clips: readonly PartyClip[]) => clips.filter((d) => d.bpm > 0 && Number.isInteger(d.beats) && d.beats > 0);

/**
 * Every clip a tempo fits (a quarter either way, 3.3), nearest its natural speed first, then by id. This is what the Dance picker offers: a move that
 * cannot fit is not on the list, so nothing is ever stretched.
 */
export function fittingClips(songBpm: number, clips: readonly PartyClip[]): { clip: PartyClip; rate: number }[] {
  return usable(clips)
    .map((clip) => ({ clip, ...tempoRate(songBpm, clip.bpm) }))
    .filter((c) => c.inRange)
    .sort((a, b) => Math.abs(Math.log(a.rate)) - Math.abs(Math.log(b.rate)) || (a.clip.id < b.clip.id ? -1 : a.clip.id > b.clip.id ? 1 : 0))
    .map(({ clip, rate }) => ({ clip, rate }));
}

/**
 * The dances a Mix takes turns with: the `dance` clips (never a movement-break move or the strum) that fit the tempo, the one nearest its natural speed first, so a
 * mix always opens on the dance the tempo would have picked on its own.
 */
export function mixList(songBpm: number, clips: readonly PartyClip[]): { clip: PartyClip; rate: number }[] {
  return fittingClips(songBpm, clips.filter((d) => d.group === undefined || d.group === "dance"));
}

/**
 * Which dance a Mix is on at `position` (beats since the first beat of the song, as `beatAt` gives it): the first for the first `every` beats, then the next, round the
 * list and back to the start. A pure function of the position: nothing is remembered, so a restart or a loop of the song cannot lose its place, a dance is never followed
 * by itself (when there are two or more), and the switch always falls on the same beat of the bar. A position before the first beat (a count-in) is the first dance.
 */
export function danceForMix<T>(list: readonly T[], position: number, every = MIX_BEATS): T {
  if (!list.length) throw new Error("danceForMix: nothing to mix");
  const block = Number.isFinite(position) ? Math.max(0, Math.floor(position / every)) : 0;
  return list[block % list.length]!;
}

/**
 * `clips` are everything that carries a tempo (kip-clips.js dances and the baked Mixamo ones: dances, movement-break moves, a guitar strum). With no
 * `choose` the tempo picks, among the `dance` clips only (a clip with no group counts as a dance); `variant` steps down that list, for a second Kip or the
 * next song. With `choose` (a clip id) that clip is played if it fits this tempo, whatever its group; if it does not fit, the tempo's own pick is used and
 * `fellBack` says so. `choose === "mix"` (the picker's Mix) takes turns with every dance that fits, every `MIX_BEATS`, when at least two do; with fewer it is just the
 * tempo's own pick. A clip without a positive `bpm` and a whole `beats` is never picked or offered.
 */
export function planParty(songBpm: number, clips: readonly PartyClip[], variant = 0, choose?: string | null): PartyPlan {
  const fit = fittingClips(songBpm, clips);
  if (choose === MIX_CHOICE) {
    const list = mixList(songBpm, clips);
    if (list.length >= 2) return { songBpm, dance: list[0]!, chosen: true, fellBack: false, mix: { list, every: MIX_BEATS } };
    return { ...planParty(songBpm, clips, variant, null), fellBack: false };
  }
  if (choose) {
    const hit = fit.find((f) => f.clip.id === choose);
    if (hit) return { songBpm, dance: hit, chosen: true, fellBack: false, mix: null };
  }
  const dances = usable(clips).filter((d) => d.group === undefined || d.group === "dance");
  const pick = pickDance(songBpm, dances, variant);
  const clip = pick ? dances.find((d) => d.id === pick.id) : undefined;
  return { songBpm, dance: pick && clip ? { clip, rate: pick.rate } : null, chosen: false, fellBack: Boolean(choose), mix: null };
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
  /** The clip to play, or `null` (lights only). In a Mix it changes every `MIX_BEATS`. */
  danceId: string | null;
  /** Seconds into that clip for this frame. Follows the song's beats, not a stopwatch. */
  danceTime: number | null;
}

export function partyFrame(plan: PartyPlan, map: BeatMap, t: number): PartyFrame {
  const place = beatAt(map, t);
  const count = (place.beatInBar + 1) as 1 | 2 | 3 | 4;
  // a Mix is on whichever dance this beat of the song belongs to; otherwise the one dance of the plan
  const clip = plan.mix ? danceForMix(plan.mix.list, place.position, plan.mix.every).clip : plan.dance ? plan.dance.clip : null;
  return {
    place,
    count,
    downbeat: place.beatInBar === 0,
    pulse: beatPulse(place.phase),
    danceId: clip ? clip.id : null,
    danceTime: clip ? clipTime(map, t, clip) : null,
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

// ---- the starter library -----------------------------------------------------------------------------------------------------------

/**
 * One song of the starter library (public/kip/songs/index.json, written by scripts/song-ingest.ts): an excerpt of a Mureka song, a whole number of bars long,
 * cut ON its beat grid so it loops in time. `offset` is when its first beat (a downbeat) sounds; `dur` is the exact loop length, `beats` x one beat.
 */
export interface LibrarySong {
  id: string;
  title: string;
  mood: Mood;
  file: string;
  bytes: number;
  dur: number;
  bpm: number;
  beats: number;
  bars: number;
  offset: number;
  ai: true;
}

const SONG_ID = /^[a-z0-9_]{1,40}$/;
const SONG_FILE = /^[a-z0-9_]{1,40}\.(mp3|m4a)$/;
/** Songs are small excerpts (about 64 s, under a megabyte): anything bigger is not one of ours. */
export const MAX_SONG_BYTES = 3_000_000;
export const MIN_SONG_BPM = 64;
export const MAX_SONG_BPM = 170;

/**
 * The library index as it came over the network, checked field by field: a song that does not pass is left out and named, never played. Only songs
 * from our own folder with a plain file name, a tempo the dances can follow, a loop that is a whole number of bars at that tempo, and the AI label.
 */
export function parseSongIndex(raw: unknown): { songs: LibrarySong[]; skipped: string[] } {
  const out: LibrarySong[] = [];
  const skipped: string[] = [];
  const list = typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw as { v?: unknown }).v === 1 ? (raw as { songs?: unknown }).songs : null;
  if (!Array.isArray(list)) return { songs: [], skipped: ["the index is not a version 1 song list"] };
  const seen = new Set<string>();
  for (const item of list) {
    const s = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    const id = typeof s.id === "string" ? s.id : "?";
    const bad = (why: string) => { skipped.push(`${id}: ${why}`); };
    const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
    if (typeof s.id !== "string" || !SONG_ID.test(s.id)) { bad("id"); continue; }
    if (seen.has(s.id)) { bad("duplicate id"); continue; }
    if (typeof s.title !== "string" || s.title.length < 1 || s.title.length > 40) { bad("title"); continue; }
    if (typeof s.mood !== "string" || !(MOODS as readonly string[]).includes(s.mood)) { bad("mood"); continue; }
    if (typeof s.file !== "string" || !SONG_FILE.test(s.file)) { bad("file name"); continue; }
    if (!num(s.bytes) || !Number.isInteger(s.bytes) || s.bytes < 1 || s.bytes > MAX_SONG_BYTES) { bad("size"); continue; }
    if (!num(s.dur) || s.dur < 8 || s.dur > 180) { bad("length"); continue; }
    if (!num(s.beats) || !Number.isInteger(s.beats) || s.beats < 8 || s.beats > 400 || s.beats % 4 !== 0) { bad("beats must be a whole number of bars"); continue; }
    if (!num(s.bars) || s.bars * 4 !== s.beats) { bad("bars"); continue; }
    if (!num(s.bpm) || s.bpm < MIN_SONG_BPM || s.bpm > MAX_SONG_BPM) { bad("tempo outside what the dances follow"); continue; }
    if (Math.abs((60 * s.beats) / s.dur - s.bpm) / s.bpm > 0.01) { bad("length does not match the tempo"); continue; }
    if (!num(s.offset) || s.offset < 0 || s.offset >= 0.5) { bad("offset"); continue; }
    if (s.ai !== true) { bad("not labelled as made by AI"); continue; }
    seen.add(s.id);
    out.push({ id: s.id, title: s.title, mood: s.mood as Mood, file: s.file, bytes: s.bytes, dur: s.dur, bpm: s.bpm, beats: s.beats, bars: s.bars, offset: s.offset, ai: true });
  }
  return { songs: out, skipped };
}

/** Seconds from one beat to the next: the exact loop length divided by its beats, so a looping song stays on its grid however long the party runs. */
export const songInterval = (song: Pick<LibrarySong, "dur" | "beats">): number => song.dur / song.beats;

/** The beat grid of a library song looped for `seconds` of party: beat k at `offset + k x interval`, exact because the file is cut on that grid. */
export function songBeatMap(song: Pick<LibrarySong, "dur" | "beats" | "offset">, seconds = 600): BeatMap {
  const iv = songInterval(song);
  const n = Math.min(MAX_BEATS, Math.max(8, Math.floor((seconds - song.offset) / iv)));
  const r = makeBeatMap(Array.from({ length: n }, (_, i) => song.offset + i * iv));
  if (!r.ok) throw new Error(`songBeatMap: not a beat grid a party can follow (${r.reason})`);
  return r.map;
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
