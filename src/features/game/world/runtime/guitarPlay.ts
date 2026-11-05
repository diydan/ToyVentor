// How the toy guitar is PLAYED (Dan, 2026-11-05: "can we improve the guitar interaction?"): the pure rules, with no audio, no three.js and no world in them, so every one of them is a unit test.
//
// Before, tapping the guitar ran a fixed 4.4 s riff the child could not touch. Now the riff is only the invitation: while Kip holds the guitar EVERY TAP on the stage is a strum. A tap plays the next
// stroke of a friendly progression (C, G, Am, F: four strokes on each chord, a down stroke then an up stroke), keeps the song going for TAP_HOLD_S more, and the strum arm swings to meet it. No tap
// for a while ends it as before, with one soft closing C so the song always ends at home.
//
//   chords, `strokeFor`      which notes a stroke plays, with the per-string spread of a real strum and the down stroke's weight against the up stroke's
//   `autoRiff`               the invitation riff (a down/up folk pattern on C then G) that plays until the first tap
//   `createSession`          the tap rules: bounce filter, keeping the act alive (capped), when to resolve
//   `createArmSweep`         the strum arm's clock: every stroke sweeps the clip's pose to the next extreme, so the hand hits the strings when the child taps
//
// guitarSound.ts makes the sound, toyRoomActs.ts runs the act.

/* ---------- chords ---------- */

/** Equal-tempered frequency of a MIDI note (69 = A4 = 440 Hz). */
export const midiHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

export type ChordName = "C" | "G" | "Am" | "F";
/** Open-position voicings in a guitar's standard tuning (E2 A2 D3 G3 B3 E4), lowest string first, as MIDI notes; null = the string is not played. */
export const CHORDS: Readonly<Record<ChordName, ReadonlyArray<number | null>>> = {
  C: [null, 48, 52, 55, 60, 64],        // x32010
  G: [43, 47, 50, 55, 59, 67],          // 320003
  Am: [null, 45, 52, 57, 60, 64],       // x02210
  F: [41, 48, 53, 57, 60, 65],          // 133211
};
/** I, V, vi, IV: the progression of a thousand friendly songs. Whatever a child taps, it sounds like a song. */
export const PROGRESSION: readonly ChordName[] = ["C", "G", "Am", "F"];
/** Strokes on each chord before the progression moves on (a down, an up, a down, an up). */
export const STROKES_PER_CHORD = 4;
export const LAP_STROKES = PROGRESSION.length * STROKES_PER_CHORD;

/** The frequencies a chord's played strings have, lowest first. */
export const chordFreqs = (c: ChordName): number[] => CHORDS[c].filter((m): m is number => m !== null).map(midiHz);

/* ---------- strokes ---------- */

export type StrokeDir = "down" | "up";
export interface StringNote {
  freq: number;
  /** Seconds after the stroke's start: the strings are hit one after another, not all at once. */
  delay: number;
  /** 0 to 1: how hard this string is hit. */
  vel: number;
}
export interface Stroke {
  /** Which stroke of the tapped song this is (0 for the first). The closing chord and the riff's strokes carry the next free index, `-1` for the riff. */
  index: number;
  chord: ChordName;
  dir: StrokeDir;
  /** The first stroke of a chord: a little louder. */
  accent: boolean;
  /** The last stroke of a whole lap of the progression (the dog joins in on it). */
  lapEnd: boolean;
  /** The stroke's overall weight, 0 to 1 (a down stroke is heavier than an up one). */
  vel: number;
  notes: StringNote[];
}

/** The time a down stroke takes to cross all the strings, and an up stroke (faster, and lighter): 20 to 30 ms, as a real hand does it. */
export const SPREAD_DOWN_S = 0.026;
export const SPREAD_UP_S = 0.018;
/** An up stroke only brushes the top strings, and softer. */
export const UP_STRINGS = 4;
export const UP_GAIN = 0.62;
export const ACCENT_GAIN = 1.12;
/** Taps closer than this are one tap bouncing (the second is ignored, though still swallowed). */
export const MIN_TAP_GAP_S = 0.08;
/** Fast tapping is played softer, so a drumming child gets a flurry, not a wall of sound: full weight from this gap up, and TAP_FAST_GAIN at (or under) TAP_FAST_S. */
export const TAP_SLOW_S = 0.4;
export const TAP_FAST_S = 0.12;
export const TAP_FAST_GAIN = 0.72;

/** How hard a stroke is played given the time since the last tap (Infinity: the first). */
export function tapGain(gapS: number): number {
  if (!(gapS < TAP_SLOW_S)) return 1;
  if (!(gapS > TAP_FAST_S)) return TAP_FAST_GAIN;
  return TAP_FAST_GAIN + (1 - TAP_FAST_GAIN) * ((gapS - TAP_FAST_S) / (TAP_SLOW_S - TAP_FAST_S));
}

export interface StrokeOpts {
  /** Seconds since the previous tap (the stroke is played softer when it is fast). Absent: full weight. */
  gapS?: number;
  /** 0..1 random numbers for a little human unevenness. Absent: none (tests). */
  rng?: () => number;
  accent?: boolean;
  lapEnd?: boolean;
  /** A slower, softer strum (the closing chord). */
  gentle?: boolean;
}

/** The notes of one stroke of a chord. A down stroke crosses every played string low to high; an up stroke brushes the top UP_STRINGS from high to low. */
export function strokeNotes(chord: ChordName, dir: StrokeDir, vel: number, opts: StrokeOpts = {}): StringNote[] {
  const all = chordFreqs(chord);
  const strings = dir === "down" ? all : all.slice(-UP_STRINGS).reverse();
  const spread = (dir === "down" ? SPREAD_DOWN_S : SPREAD_UP_S) * (opts.gentle ? 1.8 : 1);
  const n = strings.length;
  const rng = opts.rng;
  return strings.map((freq, i) => {
    // the heavy strings ring a little louder on the way down, the bright ones on the way back up
    const along = n > 1 ? i / (n - 1) : 0;
    const weight = dir === "down" ? 1 - 0.18 * along : 0.92 - 0.17 * along;
    const jitterV = rng ? 1 + (rng() - 0.5) * 0.12 : 1;
    const jitterT = rng ? (rng() - 0.5) * 0.003 : 0;
    return { freq, delay: Math.max(0, (n > 1 ? along * spread : 0) + (i > 0 ? jitterT : 0)), vel: Math.min(1, vel * weight * jitterV) };
  });
}

/** One stroke of the progression. */
export function makeStroke(index: number, chord: ChordName, dir: StrokeDir, opts: StrokeOpts = {}): Stroke {
  const gap = opts.gapS ?? Infinity;
  const base = (dir === "down" ? 1 : UP_GAIN) * (opts.accent ? ACCENT_GAIN : 1) * tapGain(gap) * (opts.gentle ? 0.7 : 1);
  const vel = Math.min(1, base);
  return { index, chord, dir, accent: !!opts.accent, lapEnd: !!opts.lapEnd, vel, notes: strokeNotes(chord, dir, vel, opts) };
}

/** The `index`th stroke of a tapped song (0, 1, 2, ...): alternate down and up, STROKES_PER_CHORD on each chord, the progression round and round. */
export function strokeFor(index: number, opts: StrokeOpts = {}): Stroke {
  const i = Math.max(0, Math.floor(index));
  const chord = PROGRESSION[Math.floor(i / STROKES_PER_CHORD) % PROGRESSION.length]!;
  const dir: StrokeDir = i % 2 === 0 ? "down" : "up";
  return makeStroke(i, chord, dir, { accent: i % STROKES_PER_CHORD === 0, lapEnd: i % LAP_STROKES === LAP_STROKES - 1, ...opts });
}

/** The chord the song comes to rest on. */
export const HOME: ChordName = "C";
/** The closing strum: a soft, slow down stroke on the home chord. */
export const resolveStroke = (index: number, opts: StrokeOpts = {}): Stroke => makeStroke(index, HOME, "down", { gentle: true, accent: true, lapEnd: true, ...opts });

/* ---------- the invitation riff ---------- */

export interface AutoStroke { at: number; chord: ChordName; dir: StrokeDir; accent: boolean }
/** The riff plays from this long into the act (the arm has come up), on a step of AUTO_STEP_S: eight steps to a bar. */
export const AUTO_START_S = 0.5;
export const AUTO_STEP_S = 0.24;
/** The classic folk strum of a bar: down, down-up, up-down-up, on steps 0 2 3 5 6 7 of eight. */
export const AUTO_PATTERN: ReadonlyArray<{ step: number; dir: StrokeDir }> = [
  { step: 0, dir: "down" }, { step: 2, dir: "down" }, { step: 3, dir: "up" }, { step: 5, dir: "up" }, { step: 6, dir: "down" }, { step: 7, dir: "up" },
];
/** Two bars: C then G. */
export const AUTO_CHORDS: readonly ChordName[] = ["C", "G"];

/** The riff that plays until the child takes over (12 strokes in about 3.6 s). */
export function autoRiff(): AutoStroke[] {
  const out: AutoStroke[] = [];
  AUTO_CHORDS.forEach((chord, bar) => {
    for (const p of AUTO_PATTERN) out.push({ at: AUTO_START_S + (bar * 8 + p.step) * AUTO_STEP_S, chord, dir: p.dir, accent: p.step === 0 });
  });
  return out;
}

/* ---------- taps ---------- */

/** How long each tap keeps the song going (seconds after it), and the longest the act may ever run. */
export const TAP_HOLD_S = 2.5;
export const MAX_PLAY_S = 90;
/** After this long without a tap (and at least RESOLVE_MIN_STROKES played) the closing chord comes. */
export const RESOLVE_AFTER_S = 1.25;
export const RESOLVE_MIN_STROKES = 3;
/** The length of the act before anyone taps: the riff. */
export const RIFF_S = 4.4;

export interface Session {
  /** The child has taken over (the riff stops). */
  readonly taken: boolean;
  /** How many strokes the child has played. */
  readonly strokes: number;
  /** When the act ends (seconds into it): RIFF_S until a tap, then TAP_HOLD_S after the last tap, never more than MAX_PLAY_S. */
  readonly endAt: number;
  /** A tap at time `t`: the stroke it plays, or null for a bounce (too soon after the last). */
  tap(t: number): Stroke | null;
  /** The closing chord, once, when it is due at time `t` (the child has gone quiet after playing a little); null otherwise. Tapping again re-arms it. */
  resolveDue(t: number): Stroke | null;
}

export function createSession(rng?: () => number): Session {
  let taken = false, strokes = 0, lastTap = -Infinity, endAt = RIFF_S, resolved = false;
  return {
    get taken() { return taken; },
    get strokes() { return strokes; },
    get endAt() { return endAt; },
    tap(t: number): Stroke | null {
      if (!Number.isFinite(t)) return null;
      if (taken && t - lastTap < MIN_TAP_GAP_S) return null;
      const stroke = strokeFor(strokes, { gapS: t - lastTap, rng });
      taken = true;
      strokes++;
      lastTap = t;
      endAt = Math.min(MAX_PLAY_S, t + TAP_HOLD_S);
      resolved = false;
      return stroke;
    },
    resolveDue(t: number): Stroke | null {
      if (!taken || resolved || strokes < RESOLVE_MIN_STROKES || !(t - lastTap >= RESOLVE_AFTER_S - 1e-9) || t >= endAt) return null;
      resolved = true;
      return resolveStroke(strokes, { rng });
    },
  };
}

/* ---------- the strum arm ---------- */

/**
 * The arm's pose as a function of a clip's time: the strum arm swings between two extremes, key 0 a DOWN stroke, key 1 an UP stroke, key 2 down again, and so on (even keys down). `keyTime(i)` is
 * the clip's time at key `i` (i >= 0), `ready` the time of the pose the arm waits in before the first stroke (the key just before key 0, an up one), and `period` the number of keys after which the
 * clip repeats exactly (an even number: key `period` is key 0).
 */
export interface ArmClipSpec {
  keyTime(i: number): number;
  ready: number;
  period: number;
}
/** How fast the arm sweeps, in keys per second: a stroke (one key) is a 70 ms swing. */
export const SWEEP_KEYS_PER_S = 14;

export interface ArmSweep {
  /** An (unheard or heard) stroke: the arm sweeps to the next extreme of this direction (through one extra swing the other way if it is not the next key). */
  stroke(dir: StrokeDir): void;
  /** Advance by `dt` seconds; the clip time to pose the arm at. */
  update(dt: number): number;
  /** The clip time now, without advancing. */
  time(): number;
  /** The key the arm is at (fractional while it moves) and the key it is heading for. */
  readonly at: number;
  readonly goal: number;
  /** True while it is still moving. */
  readonly moving: boolean;
}

export function createArmSweep(spec: ArmClipSpec): ArmSweep {
  let cur = -1, goal = -1;                    // key -1 is the ready pose, an UP one
  const timeAt = (k: number): number => {
    if (k <= -1) return spec.ready;
    if (k < 0) return spec.ready + (spec.keyTime(0) - spec.ready) * (k + 1);
    const m = ((k % spec.period) + spec.period) % spec.period;
    const i = Math.floor(m), f = m - i;
    const a = spec.keyTime(i);
    return f < 1e-9 ? a : a + (spec.keyTime(i + 1) - a) * f;       // (keyTime(period) is the clip's key 0 again: it must continue the same pose)
  };
  return {
    stroke(dir: StrokeDir) {
      const wantEven = dir === "down";
      let g = goal + 1;
      if ((((g % 2) + 2) % 2 === 0) !== wantEven) g += 1;           // a down stroke lands on an even key: one more swing (a ghost stroke) when the next key is the wrong way
      goal = g;
      // keep the numbers small: the clip repeats every `period` keys
      if (cur >= spec.period * 2 && goal >= spec.period * 2) { cur -= spec.period; goal -= spec.period; }
    },
    update(dt: number) {
      if (cur < goal) cur = Math.min(goal, cur + SWEEP_KEYS_PER_S * Math.max(0, dt));
      return timeAt(cur);
    },
    time() { return timeAt(cur); },
    get at() { return cur; },
    get goal() { return goal; },
    get moving() { return cur < goal - 1e-9; },
  };
}

/** Pose Kip at the guitar with the Mixamo "Guitar Playing" clip when it is loaded (it is local only: see guitarClip.ts) and fall back to the hand-authored `strum` clip when it is not. */
export const PREFER_MIXAMO_GUITAR = true;

/** The hand-authored `strum` clip's keys (proceduralClips.ts): ready at 0.2 s, then a stroke every 0.28 s from 0.48 s, the 12 keys after key 0 repeating exactly (key 12 is a down stroke like key 0). */
export const PROCEDURAL_ARM: ArmClipSpec = { ready: 0.2, period: 12, keyTime: (i) => 0.48 + 0.28 * i };
