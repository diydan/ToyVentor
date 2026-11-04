// The dance party IN THE GAME (docs/specs/dance-party-spec.md 5.1; the Kip bench has had one since phase 3). The character dances ON the beat of a song while it plays.
//
// This is the glue; the decisions are the same pure, tested functions the bench uses (shared/songParty.ts): `parseSongIndex` checks the song like any starter song,
// `planParty` says whether a dance fits its tempo (a quarter either way, never stretched), `songBeatMap` is the song's beat grid and `clipTime` is where in the dance
// a moment of the song falls, counted in BEATS so the dance cannot drift from the sound. Everything here reads ONE clock, the audio clock.
//
// WHAT DANCES. Every dance that fits the song's tempo (a quarter either way, never stretched): the built-in Samba and the baked Mixamo dances (runtime/gameDances.ts), taking turns
// every 16 beats on the bar line with a short cross-fade (the Dance MIX), the one nearest its natural speed first. A tempo that only one dance fits is that one dance; a tempo
// none fits is the song alone. Each dance is shifted by where its weight lands, so the dancer drops ON the beat (the Samba's was counted from its real clip, the others measured from
// theirs by runtime/bakedDance.ts `beatHit`).
//
// WHAT THE SONG IS. A child's own theme song, already measured and cut to whole bars that loop on the beat grid (shared/themeParty.ts), as a library-shaped index entry and the
// WAV bytes of the cut. The party loops it until it is stopped or `GAME_PARTY_SECONDS` pass.
//
// DEPENDENCIES ARE INJECTED (`GamePartyHost`), so the party is tested without a browser: the audio context, the character's dance, and the world's own music.
import { MIX_CHOICE, beatAt, clipTime, danceForMix, parseSongIndex, planParty, songBeatMap, type BeatMap, type LibrarySong } from "../../../../../shared/songParty";
import { SAMBA, type GameDance } from "./gameDances";
import type { BeatSource } from "./mixamo";

/** The built-in Samba, as a list (kept for the tests that count it). The party's own list comes from the host. */
export const GAME_DANCES: readonly GameDance[] = [SAMBA];
/** Seconds into the Samba clip where the hips are lowest on average: the weight drops here, and this is what lands on the song's beat. */
export const SAMBA_HIT_S = SAMBA.hit;
/** The party ends by itself after this long (a few loops of a song). */
export const GAME_PARTY_SECONDS = 150;
/** How loud the song is against the game's other sound (its own music is ducked to nothing while the party plays). */
export const GAME_PARTY_GAIN = 0.7;
/** A short delay so the first beat is scheduled, not started late. */
const START_DELAY_S = 0.12;

/** What the party needs from the game. */
export interface GamePartyHost {
  /** The game's audio context (created and resumed by a tap), or null before there is one. */
  ctx(): AudioContext | null;
  /** Read the list of dances once (the index). Optional: a host with only the Samba needs nothing. */
  prepare?(): Promise<void>;
  /** Every dance the character knows now, loaded or not (the Samba is always loaded). */
  dances(): readonly GameDance[];
  /** Load these dances into the character's bank; resolves the ids that are playable now. A failed one is left out. */
  ensureDances(ids: readonly string[]): Promise<string[]>;
  /** Start the character's dance: every frame `source` says which dance and how far into it. False when it cannot dance (reduced motion, no rig): the party is then music only. */
  startDance(source: BeatSource): boolean;
  stopDance(): void;
  /** Fade the world's own music out (`true`) and back (`false`). */
  duckMusic(on: boolean): void;
  /** Called once when a party that was on ends, for any reason ("stopped", "time", "error"): the page shows "party's over". */
  onEnd?: (reason: string) => void;
  setTimeout?: (fn: () => void, ms: number) => number;
  clearTimeout?: (id: number) => void;
  perfNow?: () => number;
}

export interface PartySong {
  /** A library-shaped index entry (shared/themeParty.ts `themeIndexEntry`); it is checked here with `parseSongIndex`. */
  entry: unknown;
  /** The cut, as WAV bytes (`cutToWav`). */
  wav: ArrayBuffer;
}

export type PartyStart =
  | { ok: true; dancing: boolean; title: string; bpm: number; bufferSeconds: number }
  | { ok: false; reason: string };

export interface PartyState {
  on: boolean;
  title: string;
  bpm: number;
  /** True when the character is dancing (a dance fits the tempo and the character can dance). */
  dancing: boolean;
  /** Why the party ended: "stopped", "time", "error", or "" while it runs / has not run. */
  ended: string;
  /** Song time in seconds (the audio clock minus the start), 0 when off. */
  songTime: number;
}

export interface GameParty {
  start(song: PartySong): Promise<PartyStart>;
  stop(reason?: string): void;
  state(): PartyState;
}

export function createGameParty(host: GamePartyHost): GameParty {
  const st = { on: false, starting: false, title: "", bpm: 0, dancing: false, ended: "" };
  let ctx: AudioContext | null = null;
  let source: AudioBufferSourceNode | null = null;
  let gain: GainNode | null = null;
  let startedAt = 0;
  let timer: number | null = null;
  const perf = host.perfNow ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  const setT = host.setTimeout ?? ((fn: () => void, ms: number) => globalThis.setTimeout(fn, ms) as unknown as number);
  const clearT = host.clearTimeout ?? ((id: number) => globalThis.clearTimeout(id));

  /** Song time that is being HEARD, seconds: where the browser reports the output position it is that moved on to now, else the audio clock less the output latency. */
  function songTime(): number {
    if (!ctx) return 0;
    const c = ctx as AudioContext & { getOutputTimestamp?: () => { contextTime?: number; performanceTime?: number } };
    const ts = typeof c.getOutputTimestamp === "function" ? c.getOutputTimestamp() : null;
    if (ts && typeof ts.performanceTime === "number" && ts.performanceTime > 0 && typeof ts.contextTime === "number" && Number.isFinite(ts.contextTime)) {
      return ts.contextTime + (perf() - ts.performanceTime) / 1000 - startedAt;
    }
    const latency = Number.isFinite(c.outputLatency) ? c.outputLatency : Number.isFinite(c.baseLatency) ? c.baseLatency : 0;
    return c.currentTime - startedAt - latency;
  }

  function finish(reason: string): void {
    const wasOn = st.on || st.starting;
    st.on = false;
    st.starting = false;
    st.ended = reason;
    if (timer !== null) { clearT(timer); timer = null; }
    if (source) {
      try {
        if (gain && ctx) gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.04); // a short fade, so a stop does not click
        source.stop((ctx?.currentTime ?? 0) + 0.2);
      } catch { /* already stopped */ }
      const s = source, g = gain;
      setT(() => { try { s.disconnect(); g?.disconnect(); } catch { /* gone */ } }, 300);
    }
    source = null;
    gain = null;
    if (wasOn) {
      host.stopDance();
      host.duckMusic(false);
    }
    st.dancing = false;
    if (wasOn) host.onEnd?.(reason);
  }

  return {
    async start(song: PartySong): Promise<PartyStart> {
      if (st.on || st.starting) return { ok: false, reason: "a party is already on" };
      const parsed = parseSongIndex({ v: 1, songs: [song.entry] });
      const lib: LibrarySong | undefined = parsed.songs[0];
      if (!lib) return { ok: false, reason: `not a song a party can follow (${parsed.skipped[0] ?? "unknown"})` };
      const c = host.ctx();
      if (!c) return { ok: false, reason: "no audio yet: a tap is needed first" };
      st.starting = true;
      st.ended = "";
      try {
        const buffer = await c.decodeAudioData(song.wav.slice(0)); // a copy: decoding takes the bytes it is given
        if (!st.starting) return { ok: false, reason: "stopped before it began" };
        ctx = c;
        const map: BeatMap = songBeatMap(lib, GAME_PARTY_SECONDS + 10);
        // which dances fit this tempo: plan with every dance the index offers, load those, then plan again with what actually loaded
        try { await host.prepare?.(); } catch { /* the Samba alone */ }
        if (!st.starting) return { ok: false, reason: "stopped before it began" };
        const first = planParty(lib.bpm, host.dances(), 0, MIX_CHOICE);
        const wanted = first.mix ? first.mix.list.map((x) => x.clip.id) : first.dance ? [first.dance.clip.id] : [];
        let loadedIds: string[] = [];
        try { loadedIds = await host.ensureDances(wanted); } catch { /* none loaded: the plan below falls back to what is already there */ }
        if (!st.starting) return { ok: false, reason: "stopped before it began" };
        const playable = new Map(host.dances().filter((d) => d.loaded || loadedIds.includes(d.id)).map((d) => [d.id, d]));
        const plan = planParty(lib.bpm, [...playable.values()], 0, MIX_CHOICE);
        const list = plan.mix ? plan.mix.list : plan.dance ? [plan.dance] : [];
        const src = c.createBufferSource();
        const g = c.createGain();
        g.gain.value = GAME_PARTY_GAIN;
        src.buffer = buffer;
        src.loop = true;
        src.loopStart = 0;
        src.loopEnd = Math.min(buffer.duration, lib.dur);
        src.connect(g);
        g.connect(c.destination);
        startedAt = c.currentTime + START_DELAY_S;
        src.start(startedAt);
        source = src;
        gain = g;
        host.duckMusic(true);
        let dancing = false;
        if (list.length) {
          const every = plan.mix?.every ?? 0;
          dancing = host.startDance(() => {
            const t = songTime();
            const pick = plan.mix ? danceForMix(list, beatAt(map, t).position, every) : list[0]!;
            const dance = playable.get(pick.clip.id);
            const dur = pick.clip.beats * (60 / pick.clip.bpm);
            return { name: pick.clip.id, time: (clipTime(map, t, pick.clip) + (dance?.hit ?? 0)) % dur };
          });
        }
        st.on = true;
        st.starting = false;
        st.title = lib.title;
        st.bpm = lib.bpm;
        st.dancing = dancing;
        timer = setT(() => finish("time"), GAME_PARTY_SECONDS * 1000);
        return { ok: true, dancing, title: lib.title, bpm: lib.bpm, bufferSeconds: buffer.duration };
      } catch (err) {
        finish("error");
        return { ok: false, reason: `the song could not be played (${String(err && (err as Error).message ? (err as Error).message : err).slice(0, 90)})` };
      }
    },
    stop(reason = "stopped") {
      if (st.on || st.starting) finish(reason);
    },
    state: () => ({ on: st.on, title: st.title, bpm: st.bpm, dancing: st.dancing, ended: st.ended, songTime: st.on ? songTime() : 0 }),
  };
}
