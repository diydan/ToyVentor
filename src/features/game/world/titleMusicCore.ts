// The title page's music (Dan, 2026-11-04 night): "have temporary default music until the custom theme song lands" and "once the custom theme song lands show a proper karaoke text to match
// the lyrics". Pure logic plus one small controller; the React side is TitleMusic.tsx.
//
//   until the player's own theme song exists   a starter song loops (`DEFAULT_TITLE_TRACK`: the Bounce Along xylophone tune the Kip party already ships, already cut to loop on its beat)
//   once it lands                              the title crossfades to THAT song and the karaoke shows its words in time with the singing
//
// WHICH SONG. The newest kept song made for the new player's own theme (`kind: "prompt"`, themeSongFlow.ts): level and Build songs are not the title's.
// WHAT PLAYS. The song's own file comes through the app's relay (the provider's host sends no CORS headers, and the route answers only the device that made it). Mureka appends about
// 5 s of watermark audio, so the title loops the song from its start to `duration - WATERMARK_TAIL_S` (shared/themeParty.ts), the same cut-off the dance party uses.
// WHEN IT MAY START. A browser lets sound begin only after a tap, so nothing plays until `arm()` (the page calls it on the first tap, key or click). A speaker button mutes it, and the choice is kept.
// KARAOKE. Only from the provider's own timed lines (`KeptSong.lines`), never paced by guesswork: a song with none shows its name and nothing else.
import { lyricsForCut, type CutLine } from "../../../../shared/songKaraoke";
import { WATERMARK_TAIL_S } from "../../../../shared/themeParty";
import type { KeptSong } from "./themeSongFlow";

/** The temporary title music: a starter song from public/kip/songs (instrumental, cut to loop on its beat grid). */
export const DEFAULT_TITLE_TRACK = { id: "bouncy_a", title: "Bounce Along", url: "/kip/songs/bouncy_a.mp3" } as const;
export const TITLE_VOLUME = 0.5;
export const FADE_IN_S = 0.9;
export const FADE_OUT_S = 0.45;
export const CROSSFADE_S = 1.2;
/** A song shorter than this once the watermark is cut off is not looped for the title (the default keeps playing). */
export const MIN_LOOP_S = 8;
export const MUTE_KEY = "toyventor:title-music-muted:v1";

/**
 * The song the title should play: the newest kept song made for the new player's own theme (`kind: "prompt"`). Songs kept before the kind was recorded have none; when there is no tagged
 * song, the newest of those is used (a theme song made while the setup was being tried out is still the player's own). End-of-level and Build songs are never the title's.
 * Null when there is nothing (the default music plays).
 */
export function pickTitleSong(kept: readonly KeptSong[]): KeptSong | null {
  const ok = (s: KeptSong) => /^\d{6,24}$/.test(s.task);
  return kept.find((s) => s.kind === "prompt" && ok(s)) ?? kept.find((s) => s.kind === undefined && ok(s)) ?? null;
}

/**
 * The watermark's start is never nearer the end than this (measured on the first real theme song, 2026-11-05: the song body ended 4.8 s before the end of the file, the rest was the
 * provider's appended watermark). `WATERMARK_TAIL_S` (5.5 s) is the cautious figure the dance party cuts with.
 */
export const WATERMARK_MIN_TAIL_S = 4.6;

/**
 * Seconds of the song the title loops (everything before the watermark), or 0 when the song is too short to loop or its length is not known. Without timed lines it is the cautious
 * `duration - WATERMARK_TAIL_S`. With them the loop ends just inside the end of the last sung line when that is between the cautious figure and the earliest the watermark can start, so the
 * last words are not chopped: on the real song (65.19 s, last line ends 60.52 s) that is 60.42 s, where the cautious figure would end it at 59.69 s, in the middle of the last line.
 */
export function loopSecondsFor(duration: number, lines?: readonly { e: number }[]): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  const cautious = duration - WATERMARK_TAIL_S;
  if (cautious < MIN_LOOP_S) return 0;
  if (!lines || !lines.length) return cautious;
  const lastEnd = Math.max(...lines.map((l) => l.e)) / 1000;
  if (!Number.isFinite(lastEnd)) return cautious;
  return Math.min(duration - WATERMARK_MIN_TAIL_S, Math.max(cautious, lastEnd - 0.1));
}

/** The song's timed lines on the loop the title plays (seconds from the start). Empty when the provider gave no times. */
export function karaokeFor(song: Pick<KeptSong, "lines">, loopSeconds: number): CutLine[] {
  return song.lines && song.lines.length && loopSeconds > 0 ? lyricsForCut(song.lines, 0, loopSeconds) : [];
}

export interface MuteStorage { getItem(k: string): string | null; setItem(k: string, v: string): void }
export const readMuted = (s: MuteStorage | null | undefined): boolean => { try { return s?.getItem(MUTE_KEY) === "1"; } catch { return false; } };
export const writeMuted = (s: MuteStorage | null | undefined, muted: boolean): void => { try { s?.setItem(MUTE_KEY, muted ? "1" : "0"); } catch { /* blocked: this visit only */ } };

// ---- the controller ---------------------------------------------------------------------------------------------------------------------------------------------------

/** The slice of an HTMLAudioElement the controller uses (so a test can pass a fake). */
export interface AudioLike {
  src: string;
  volume: number;
  loop: boolean;
  currentTime: number;
  duration: number;
  paused: boolean;
  /** Starts fetching the file (iOS ignores `preload`, so a blob song may never report its length until this is called). */
  load?(): void;
  play(): Promise<void> | void;
  pause(): void;
  addEventListener(type: "loadedmetadata" | "error", fn: () => void, opts?: { once?: boolean }): void;
}

export interface TitleTrack {
  kind: "default" | "custom";
  title: string;
  /** The timed lines on the loop (custom songs with times only). */
  karaoke: CutLine[];
  /** Seconds of the loop (custom songs only). */
  loop: number;
}

export interface TitleMusicState {
  /** A tap has happened, so sound may start. */
  armed: boolean;
  muted: boolean;
  held: boolean;
  /** Sound is coming out right now. */
  playing: boolean;
  /** The track that is (or would be) playing. */
  track: TitleTrack;
}

export interface TitleMusicDeps {
  makeAudio(src: string): AudioLike;
  /** The finished song's audio through the app's relay, or null when it cannot be had (offline, not this device's, the route is off). */
  fetchSongAudio(task: string): Promise<Blob | null>;
  objectUrl(blob: Blob): string;
  revokeUrl(url: string): void;
  storage?: MuteStorage | null;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (id: unknown) => void;
}

export interface TitleMusic {
  /** A tap, key press or click happened: sound may start. Safe to call many times. */
  arm(): void;
  /** The newest song made for the player's own theme, or null. Asking again for the same song does nothing. */
  setSong(song: KeptSong | null): void;
  /** True while something else has the sound (the new-player setup, a dance party): the music waits and carries on after. */
  setHold(held: boolean): void;
  setMuted(muted: boolean): void;
  state(): TitleMusicState;
  /** Seconds into the custom song (0 for the default track): the karaoke reads it. */
  playhead(): number;
  /** Called whenever the state changes (a song landed, play started, mute). Returns a way to stop listening. */
  onChange(fn: () => void): () => void;
  /** Fade out and let everything go. */
  stop(): void;
}

const TICK_MS = 50;

export function createTitleMusic(deps: TitleMusicDeps): TitleMusic {
  const setTimer = deps.setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms));
  const clearTimer = deps.clearInterval ?? ((id) => globalThis.clearInterval(id as ReturnType<typeof setInterval>));

  interface Voice { audio: AudioLike; track: TitleTrack; url?: string; gain: number; target: number; rate: number }
  let armed = false;
  let held = false;
  let muted = readMuted(deps.storage);
  let stopped = false;
  let want: string | null = null;            // the task of the song we are fetching or have
  let defaultVoice: Voice | null = null;
  let customVoice: Voice | null = null;
  let timer: unknown = null;
  const listeners = new Set<() => void>();
  const defaultTrack: TitleTrack = { kind: "default", title: DEFAULT_TITLE_TRACK.title, karaoke: [], loop: 0 };

  const emit = () => { for (const fn of [...listeners]) fn(); };
  const desired = () => armed && !muted && !held && !stopped;
  /** The voice that should be heard: the custom song once it has loaded, else the default. */
  const lead = (): Voice | null => customVoice ?? defaultVoice;

  function ensureTimer(): void {
    if (timer !== null) return;
    timer = setTimer(tick, TICK_MS);
  }
  function maybeStopTimer(): void {
    const busy = [defaultVoice, customVoice].some((v) => v && (v.gain !== v.target || (v.track.kind === "custom" && !v.audio.paused)));
    if (!busy && timer !== null) { clearTimer(timer); timer = null; }
  }

  function apply(v: Voice): void { v.audio.volume = Math.max(0, Math.min(1, v.gain)); }

  function tick(): void {
    const dt = TICK_MS / 1000;
    for (const v of [defaultVoice, customVoice]) {
      if (!v) continue;
      if (v.gain !== v.target) {
        const step = (TITLE_VOLUME / Math.max(0.05, v.rate)) * dt;
        v.gain = v.gain < v.target ? Math.min(v.target, v.gain + step) : Math.max(v.target, v.gain - step);
        apply(v);
      }
      // a custom song loops itself before the watermark
      if (v.track.kind === "custom" && v.track.loop > 0 && !v.audio.paused && v.audio.currentTime >= v.track.loop - 0.03) v.audio.currentTime = 0;
      // a voice that has faded to nothing stops making sound
      if (v.gain === 0 && v.target === 0 && !v.audio.paused) v.audio.pause();
    }
    // the default music is let go once the custom song is the one being heard
    if (defaultVoice && customVoice && defaultVoice.gain === 0 && defaultVoice.target === 0) { defaultVoice.audio.pause(); defaultVoice = null; }
    maybeStopTimer();
  }

  function fadeTo(v: Voice | null, target: number, seconds: number): void {
    if (!v) return;
    v.target = target;
    v.rate = seconds;
    if (v.gain === target) apply(v);
    ensureTimer();
  }

  function startVoice(v: Voice, seconds: number): void {
    const p = v.audio.play();
    if (p && typeof (p as Promise<void>).catch === "function") (p as Promise<void>).catch(() => { armed = false; v.audio.pause(); emit(); }); // the browser refused: wait for the next tap
    fadeTo(v, TITLE_VOLUME, seconds);
  }

  function sync(): void {
    if (stopped) return;
    const heard = lead();
    const quiet = [defaultVoice, customVoice].filter((v): v is Voice => !!v && v !== heard);
    if (desired()) {
      if (!defaultVoice && !customVoice) {
        const a = deps.makeAudio(DEFAULT_TITLE_TRACK.url);
        a.loop = true;
        a.volume = 0;
        defaultVoice = { audio: a, track: defaultTrack, gain: 0, target: 0, rate: FADE_IN_S };
      }
      const now = lead()!;
      if (now.audio.paused) { now.gain = Math.min(now.gain, 0); startVoice(now, FADE_IN_S); } else fadeTo(now, TITLE_VOLUME, FADE_IN_S);
      for (const v of quiet) fadeTo(v, 0, CROSSFADE_S);
    } else {
      for (const v of [defaultVoice, customVoice]) fadeTo(v, 0, FADE_OUT_S);
    }
    emit();
  }

  async function loadCustom(song: KeptSong): Promise<void> {
    let blob: Blob | null = null;
    try { blob = await deps.fetchSongAudio(song.task); } catch { blob = null; }
    if (stopped || want !== song.task) return;
    if (!blob) return; // the default keeps playing: the song may come through another time
    const url = deps.objectUrl(blob);
    const audio = deps.makeAudio(url);
    audio.loop = false;
    audio.volume = 0;
    const ready = () => {
      if (stopped || want !== song.task) { deps.revokeUrl(url); return; }
      const loop = loopSecondsFor(audio.duration, song.lines);
      if (loop <= 0) { deps.revokeUrl(url); return; } // too short to loop, or not a song: the default keeps playing
      customVoice = { audio, url, gain: 0, target: 0, rate: CROSSFADE_S, track: { kind: "custom", title: song.name, karaoke: karaokeFor(song, loop), loop } };
      sync();
    };
    if (Number.isFinite(audio.duration) && audio.duration > 0) ready();
    else {
      audio.addEventListener("loadedmetadata", ready, { once: true });
      audio.addEventListener("error", () => deps.revokeUrl(url), { once: true });
      audio.load?.();
    }
  }

  return {
    arm() { if (armed || stopped) return; armed = true; sync(); },
    setSong(song) {
      if (stopped) return;
      const task = song ? song.task : null;
      if (task === want) return;
      want = task;
      if (customVoice) { // a different song (or none): the old custom voice goes
        const old = customVoice;
        customVoice = null;
        fadeTo(old, 0, CROSSFADE_S);
        if (old.url) { const u = old.url; const stopOld = () => { old.audio.pause(); deps.revokeUrl(u); }; setTimeout(stopOld, CROSSFADE_S * 1000 + 200); }
      }
      if (song) void loadCustom(song);
      sync();
    },
    setHold(h) { if (held === h) return; held = h; sync(); },
    setMuted(m) { if (muted === m) return; muted = m; writeMuted(deps.storage, m); sync(); },
    state() {
      const v = lead();
      return { armed, muted, held, playing: !!v && !v.audio.paused && v.target > 0, track: v ? v.track : defaultTrack };
    },
    playhead() { return customVoice && !customVoice.audio.paused ? customVoice.audio.currentTime : 0; },
    onChange(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    stop() {
      if (stopped) return;
      stopped = true;
      const voices = [defaultVoice, customVoice].filter((v): v is Voice => !!v);
      for (const v of voices) fadeTo(v, 0, FADE_OUT_S);
      setTimeout(() => {
        for (const v of voices) { v.audio.pause(); if (v.url) deps.revokeUrl(v.url); }
        if (timer !== null) { clearTimer(timer); timer = null; }
      }, FADE_OUT_S * 1000 + 150);
      listeners.clear();
    },
  };
}
