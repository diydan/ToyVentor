/**
 * The practice beat: a small synthesized backing loop for the dance party (docs/specs/dance-party-spec.md 4.3, "Offline and failure": the party can
 * still make a backing loop with no network and no song files). It stands in for the starter library and the live song maker until real songs
 * exist, and it is what the party falls back to whenever a song cannot be had.
 *
 * This file is only the PATTERN, as data: which voice sounds on which beat of a 4-bar loop (16 beats). The browser half (parts/kip/viewer/
 * kip-party-audio.js) turns it into sound with Web Audio. Keeping the pattern as plain data is what lets a test check that every drum lands on a
 * beat of the grid the dance and the tap judge read, which is the whole point: the sound, the dance and the glow share ONE clock.
 *
 * One loop per mood card (shared/songCards.ts). Instrumental, no samples, no files.
 *
 * Pure: no DOM, no audio, no clock.
 */
import type { Mood } from "./songCards";

export type Voice = "kick" | "snare" | "hat" | "bass" | "lead";

export interface SynthEvent {
  /** Beats from the start of the loop, 0 to under `LOOP_BEATS`. 0.5 is an eighth note later. */
  beat: number;
  voice: Voice;
  /** MIDI note for a pitched voice (bass, lead); drums have none. */
  midi?: number;
  /** Length in beats. */
  dur: number;
  /** 0 to 1, how hard it is played. */
  vel: number;
}

export const BEATS_PER_BAR_SYNTH = 4;
export const LOOP_BARS = 4;
export const LOOP_BEATS = BEATS_PER_BAR_SYNTH * LOOP_BARS;

/** A pitched voice's lowest and highest MIDI note: kept inside what a toy speaker plays without fuss. */
export const MIN_MIDI = 36;
export const MAX_MIDI = 96;

interface MoodSynth {
  /** MIDI note of the key's root (the bass sits an octave or two below it). */
  root: number;
  /** Scale degrees as semitones above the root: a pentatonic, so any note sounds right over any chord. */
  scale: readonly number[];
  /** Bass root per bar, in semitones above the key's root. */
  chords: readonly number[];
  /** Beats of each bar (0 to 3) a kick falls on. */
  kick: readonly number[];
  /** Beats of each bar a snare (or clap) falls on. */
  snare: readonly number[];
  /** Hat spacing in beats: 0.5 eighths, 1 quarters, 0 none. */
  hat: 0 | 0.5 | 1;
  /** Eighths later than straight by this many beats on the off-beat (0 straight, 1/6 a shuffle). */
  swing: number;
  /** Lead notes per bar as [beat in bar, scale index, length in beats]. Index counts up the scale and wraps into the next octave. */
  lead: readonly (readonly [number, number, number])[];
  /** Lead octaves above the root (0 or 1). */
  leadOctave: number;
  /** How loud the whole loop is meant to be, 0 to 1 (a lullaby is quieter than a march). */
  level: number;
}

const MAJOR_PENT = [0, 2, 4, 7, 9] as const;
const MINOR_PENT = [0, 3, 5, 7, 10] as const;
const LYDIAN_PENT = [0, 2, 4, 6, 9] as const;

export const MOOD_SYNTH: Readonly<Record<Mood, MoodSynth>> = {
  bouncy: {
    root: 60, scale: MAJOR_PENT, chords: [0, 5, 7, 5], kick: [0, 1, 2, 3], snare: [1, 3], hat: 0.5, swing: 0,
    lead: [[0, 2, 0.5], [0.5, 3, 0.5], [1, 4, 0.5], [2, 3, 0.5], [2.5, 2, 0.5], [3, 1, 1]], leadOctave: 1, level: 0.9,
  },
  sleepy: {
    root: 57, scale: MINOR_PENT, chords: [0, 5, 3, 7], kick: [0], snare: [], hat: 0, swing: 0,
    lead: [[0, 2, 2], [2, 4, 2]], leadOctave: 1, level: 0.55,
  },
  silly: {
    root: 62, scale: MAJOR_PENT, chords: [0, 7, 5, 0], kick: [0, 2], snare: [1, 3], hat: 1, swing: 0,
    lead: [[0, 4, 0.5], [0.5, 0, 0.5], [1, 3, 0.5], [1.5, 1, 0.5], [2, 4, 1], [3, 2, 0.5], [3.5, 0, 0.5]], leadOctave: 1, level: 0.85,
  },
  space: {
    root: 55, scale: LYDIAN_PENT, chords: [0, 2, 7, 5], kick: [0, 2], snare: [], hat: 1, swing: 0,
    lead: [[0, 1, 1], [1, 3, 1], [2, 4, 1], [3, 2, 1]], leadOctave: 1, level: 0.7,
  },
  kitchen: {
    root: 60, scale: MAJOR_PENT, chords: [0, 4, 7, 4], kick: [0, 2], snare: [1, 3], hat: 0.5, swing: 1 / 6,
    lead: [[0, 0, 0.5], [1, 2, 0.5], [1.5, 3, 0.5], [2, 4, 0.5], [3, 3, 0.5]], leadOctave: 1, level: 0.85,
  },
  cleanup: {
    root: 65, scale: MAJOR_PENT, chords: [0, 7, 0, 7], kick: [0, 1, 2, 3], snare: [1, 3], hat: 0.5, swing: 0,
    lead: [[0, 0, 1], [1, 2, 1], [2, 4, 1], [3, 2, 1]], leadOctave: 0, level: 1,
  },
};

const clampMidi = (m: number) => Math.min(MAX_MIDI, Math.max(MIN_MIDI, m));

function scaleNote(m: MoodSynth, index: number): number {
  const n = m.scale.length;
  const oct = Math.floor(index / n);
  return m.root + m.scale[((index % n) + n) % n]! + 12 * oct;
}

/** The 16-beat loop for a mood: drums, a bass note on every beat, and a short lead line each bar. Deterministic. */
export function loopEvents(mood: Mood): SynthEvent[] {
  const m = MOOD_SYNTH[mood];
  const ev: SynthEvent[] = [];
  const off = (beatInBar: number) => (beatInBar % 1 === 0.5 ? m.swing : 0); // only an off-beat eighth is pushed late
  for (let bar = 0; bar < LOOP_BARS; bar++) {
    const b0 = bar * BEATS_PER_BAR_SYNTH;
    for (const k of m.kick) ev.push({ beat: b0 + k, voice: "kick", dur: 0.5, vel: 1 * m.level });
    for (const s of m.snare) ev.push({ beat: b0 + s, voice: "snare", dur: 0.5, vel: 0.8 * m.level });
    if (m.hat > 0) for (let h = 0; h < BEATS_PER_BAR_SYNTH; h += m.hat) ev.push({ beat: b0 + h + off(h), voice: "hat", dur: 0.25, vel: (h % 1 === 0 ? 0.5 : 0.35) * m.level });
    const root = m.root - 24 + m.chords[bar]!; // two octaves under the key
    // a bass note on every beat, the last one of the bar stepping up to the fifth so the line walks instead of droning; the lullaby (no hats) holds
    // one note on beats 0 and 2 instead
    const held = m.hat === 0;
    for (let beat = 0; beat < BEATS_PER_BAR_SYNTH; beat += held ? 2 : 1) {
      const fifth = !held && beat === BEATS_PER_BAR_SYNTH - 1 ? 7 : 0;
      ev.push({ beat: b0 + beat, voice: "bass", midi: clampMidi(root + fifth), dur: held ? 1.9 : 0.9, vel: 0.7 * m.level });
    }
    for (const [at, idx, len] of m.lead) {
      ev.push({ beat: b0 + at + off(at), voice: "lead", midi: clampMidi(scaleNote(m, idx) + 12 * m.leadOctave), dur: len, vel: 0.55 * m.level });
    }
  }
  return ev.sort((a, b) => a.beat - b.beat || a.voice.localeCompare(b.voice));
}

/** Equal-tempered frequency of a MIDI note (A4 = 69 = 440 Hz). */
export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}
