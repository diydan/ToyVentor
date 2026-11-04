/**
 * The movement break (docs/specs/dance-party-spec.md 5.2, D6): a 30 to 60 second song plays and Kip does moves a child can STAND UP AND COPY.
 *
 * It is a prompt, not a measurement: no camera, no motion sensing, nothing about the child's movement is read or scored, so nothing in this file takes
 * one. By age band (the same six as `src/lib/age.ts`):
 *
 *   bands 0 and 1   `one`     Kip does ONE simple move the whole break and the beats are counted 1 to 8, over and over.
 *   bands 2 and 3   `copy`    Kip does a 4-move sequence, one move to each two bars, and then the same four again: copy along.
 *   bands 4 and 5   `choose`  Kip does the 4 moves (copy), then the child CHOOSES what he does next, move by move (then Kip shows the four again, and so on).
 *
 * Like the Dance Mix (shared/songParty.ts), which move is playing is a pure function of the song's BEAT position: a step is `BREAK_STEP_BEATS` (8) beats, so
 * the moves change on a bar line, cannot drift from the music, and a late start joins on the move its bar belongs to. A move with a tempo (Jumping Jacks) is
 * held to the beat like a dance (`moveTime`); a stretch has none and runs at its own speed (`moveTime` is null).
 *
 * Pure: no DOM, no audio, no clock.
 */
import { beatAt, beatPulse, clipTime, pickDance, tempoRate, type BeatMap, type BeatPlace } from "./songBeat";

/** Beats one move is held for: two bars. */
export const BREAK_STEP_BEATS = 8;
/** Moves in a sequence, and steps in a round. */
export const BREAK_SEQUENCE = 4;
/** About how long a break lasts (the spec says 30 to 60 s); whole rounds, so the actual length is 30 to 60 s for every tempo a dance can follow. */
export const BREAK_TARGET_SECONDS = 40;
/** At least this many rounds: one to show and one to copy (or to choose in). */
export const BREAK_MIN_ROUNDS = 2;

export type BreakStyle = "one" | "copy" | "choose";

/** How a break plays at an age band. Anything that is not a band 0 to 5 gets the youngest, simplest one. */
export function breakStyleFor(band: unknown): BreakStyle {
  if (typeof band !== "number" || !Number.isInteger(band) || band < 0 || band > 5) return "one";
  return band >= 4 ? "choose" : band >= 2 ? "copy" : "one";
}

/** A clip the break may use: its tempo if it has one (both `bpm` and `beats`), and its group. */
export interface BreakClip {
  id: string;
  bpm?: number | null;
  beats?: number | null;
  group?: string;
}

/** A move of the break. `rate` is how fast it plays against the song when it has a tempo, `null` when it runs at its own speed. */
export interface BreakMove {
  clip: BreakClip;
  rate: number | null;
}

const hasTempo = (c: BreakClip): boolean => typeof c.bpm === "number" && c.bpm > 0 && Number.isFinite(c.bpm) && typeof c.beats === "number" && c.beats > 0 && Number.isFinite(c.beats);

/**
 * The moves a break can use at this tempo, in the order they are shown: every `move` clip (in the order given) that is usable, then the dance the tempo
 * would pick for itself, last. A move with a tempo is usable only when it fits it (never stretched, as for the dances: 3.3); a stretch with no tempo always is.
 */
export function breakPool(songBpm: number, moves: readonly BreakClip[], dances: readonly BreakClip[]): BreakMove[] {
  const pool: BreakMove[] = [];
  for (const m of moves) {
    if (m.group !== undefined && m.group !== "move") continue;
    if (pool.some((p) => p.clip.id === m.id)) continue;
    if (!hasTempo(m)) { pool.push({ clip: m, rate: null }); continue; }
    const r = tempoRate(songBpm, m.bpm as number);
    if (r.inRange) pool.push({ clip: m, rate: r.rate });
  }
  const dancers = dances.filter((d) => (d.group === undefined || d.group === "dance") && hasTempo(d));
  const pick = pickDance(songBpm, dancers.map((d) => ({ id: d.id, bpm: d.bpm as number })));
  const own = pick ? dancers.find((d) => d.id === pick.id) : undefined;
  if (pick && own && !pool.some((p) => p.clip.id === own.id)) pool.push({ clip: own, rate: pick.rate });
  return pool;
}

export interface BreakStep {
  index: number;
  /** 0-based round (four steps). */
  round: number;
  /** 0 to 3, the step's place in its round. */
  slot: number;
  /** `show`: Kip does this move. `choose`: the child's pick (`moveId` is null here, see `resolveBreakMove`). */
  kind: "show" | "choose";
  moveId: string | null;
}

export interface BreakPlan {
  songBpm: number;
  style: BreakStyle;
  pool: BreakMove[];
  /** Empty when there is nothing to do: no move fits this tempo, or the tempo is not a number. */
  steps: BreakStep[];
  stepBeats: number;
  totalBeats: number;
  /** How long the break lasts at this tempo. */
  seconds: number;
}

export function planBreak(songBpm: number, band: unknown, moves: readonly BreakClip[], dances: readonly BreakClip[]): BreakPlan {
  const style = breakStyleFor(band);
  const ok = typeof songBpm === "number" && songBpm > 0 && Number.isFinite(songBpm);
  const pool = ok ? breakPool(songBpm, moves, dances) : [];
  const none: BreakPlan = { songBpm, style, pool, steps: [], stepBeats: BREAK_STEP_BEATS, totalBeats: 0, seconds: 0 };
  if (!ok || !pool.length) return none;
  const beatsPerRound = BREAK_SEQUENCE * BREAK_STEP_BEATS;
  const rounds = Math.max(BREAK_MIN_ROUNDS, Math.round((BREAK_TARGET_SECONDS * songBpm) / 60 / beatsPerRound));
  const sequence = Array.from({ length: BREAK_SEQUENCE }, (_, i) => pool[i % pool.length]!.clip.id);
  const one = pool[0]!.clip.id;
  const steps: BreakStep[] = [];
  for (let round = 0; round < rounds; round++) {
    for (let slot = 0; slot < BREAK_SEQUENCE; slot++) {
      const kind = style === "choose" && round % 2 === 1 ? "choose" : "show";
      steps.push({ index: round * BREAK_SEQUENCE + slot, round, slot, kind, moveId: kind === "choose" ? null : style === "one" ? one : sequence[slot]! });
    }
  }
  const totalBeats = steps.length * BREAK_STEP_BEATS;
  return { songBpm, style, pool, steps, stepBeats: BREAK_STEP_BEATS, totalBeats, seconds: (totalBeats * 60) / songBpm };
}

/**
 * The move a step is on. A `show` step is its own move. A `choose` step is the child's pick for it (`picks[step]`, if it is a move of the pool), else it
 * keeps doing what the step before it did: Kip never stands still waiting, and never does a move that is not in the pool.
 */
export function resolveBreakMove(plan: BreakPlan, picks: readonly (string | null | undefined)[], index: number): string | null {
  if (!plan.steps.length) return null;
  const last = plan.steps.length - 1;
  const i = Number.isFinite(index) ? Math.min(Math.max(0, Math.floor(index)), last) : 0;
  for (let k = i; k >= 0; k--) {
    const s = plan.steps[k]!;
    if (s.kind === "show") return s.moveId;
    const p = picks[k];
    if (p && plan.pool.some((m) => m.clip.id === p)) return p;
  }
  return plan.pool[0]!.clip.id;
}

export interface BreakFrame {
  place: BeatPlace;
  /** 1 to 4, the beat of the bar, and the flash for the lights: the same as the party's. */
  count: 1 | 2 | 3 | 4;
  downbeat: boolean;
  pulse: number;
  /** The step the song is in (clamped to the plan), and how many there are. */
  step: number;
  steps: number;
  round: number;
  slot: number;
  kind: "show" | "choose";
  /** 0 to 7, and the count a child hears and sees: 1 to 8. */
  beatInStep: number;
  count8: number;
  /** The move to play, or null when the plan is empty. */
  moveId: string | null;
  /** True when the move is held to the beat (it has a tempo); false when it runs at its own speed. */
  locked: boolean;
  /** Seconds into the move for this frame when it is held to the beat; null otherwise. */
  moveTime: number | null;
  /** The song has reached the end of the break. */
  done: boolean;
}

/** One frame of the break at song time `t`. `picks` are the child's choices by step (only `choose` steps read them). */
export function breakFrame(plan: BreakPlan, map: BeatMap, t: number, picks: readonly (string | null | undefined)[] = []): BreakFrame {
  const place = beatAt(map, t);
  const pos = place.position;
  const last = plan.steps.length - 1;
  const raw = Number.isFinite(pos) ? Math.floor(pos / plan.stepBeats) : 0;
  const index = Math.max(0, Math.min(raw, Math.max(0, last)));
  const step = plan.steps[index];
  const moveId = step ? resolveBreakMove(plan, picks, index) : null;
  const move = moveId ? plan.pool.find((m) => m.clip.id === moveId) : undefined;
  const locked = Boolean(move && move.rate !== null);
  const beatInStep = ((place.index % plan.stepBeats) + plan.stepBeats) % plan.stepBeats;
  return {
    place,
    count: (place.beatInBar + 1) as 1 | 2 | 3 | 4,
    downbeat: place.beatInBar === 0,
    pulse: beatPulse(place.phase),
    step: index,
    steps: plan.steps.length,
    round: step ? step.round : 0,
    slot: step ? step.slot : 0,
    kind: step ? step.kind : "show",
    beatInStep,
    count8: beatInStep + 1,
    moveId,
    locked,
    moveTime: move && locked ? clipTime(map, t, { bpm: move.clip.bpm as number, beats: move.clip.beats as number }) : null,
    done: plan.steps.length > 0 && Number.isFinite(pos) && pos >= plan.totalBeats,
  };
}
