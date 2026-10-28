// Live Play moods and loop definitions. Pure data + keyword mapping;
// the audio engine that plays these lives in src/features/liveplay/.
// Loops are synth placeholders until Mureka-made stems land (spec:
// loops are made ahead and crossfaded, never generated during play).

export type Mood = "joy" | "suspense" | "danger" | "calm" | "triumph" | "mystery";

export const MOODS: Mood[] = ["joy", "suspense", "danger", "calm", "triumph", "mystery"];

export interface MoodLoop {
  mood: Mood;
  bpm: number;
  wave: OscillatorType;
  /** Semitone offsets from the bass root, one per beat. -1 = rest. */
  melody: number[];
  bassPattern: number[];
  rootHz: number;
}

const C3 = 130.81;
const A2 = 110.0;
const D3 = 146.83;

export const MOOD_LOOPS: Record<Mood, MoodLoop> = {
  joy: {
    mood: "joy", bpm: 132, wave: "triangle", rootHz: C3,
    melody: [12, 16, 19, 24, 19, 16, 12, 16],
    bassPattern: [0, -1, 7, -1, 0, -1, 7, -1],
  },
  suspense: {
    mood: "suspense", bpm: 76, wave: "sine", rootHz: A2,
    melody: [12, -1, 13, -1, 12, -1, 10, -1],
    bassPattern: [0, 0, -1, -1, 1, -1, 0, -1],
  },
  danger: {
    mood: "danger", bpm: 152, wave: "sawtooth", rootHz: A2,
    melody: [12, 12, 18, 12, 12, 18, 17, 13],
    bassPattern: [0, 0, 6, 0, 0, 0, 6, 5],
  },
  calm: {
    mood: "calm", bpm: 64, wave: "sine", rootHz: C3,
    melody: [12, -1, 16, -1, 19, -1, 16, -1],
    bassPattern: [0, -1, -1, -1, 7, -1, -1, -1],
  },
  triumph: {
    mood: "triumph", bpm: 120, wave: "triangle", rootHz: C3,
    melody: [12, 16, 19, 24, 24, 19, 24, 28],
    bassPattern: [0, 7, 12, 7, 0, 7, 12, 7],
  },
  mystery: {
    mood: "mystery", bpm: 84, wave: "sine", rootHz: D3,
    melody: [12, 15, -1, 19, 17, -1, 15, 12],
    bassPattern: [0, -1, 10, -1, 0, -1, 8, -1],
  },
};

export interface KeywordHit {
  mood: Mood;
  /** "play my theme" also asks for the character theme over the loop. */
  playTheme: boolean;
}

/** Map a spoken/typed command to a mood. Exact spec phrases first. */
export function moodForKeyword(text: string): KeywordHit | null {
  const t = text.toLowerCase();
  if (t.includes("play my theme")) return { mood: "triumph", playTheme: true };
  if (t.includes("start adventure")) return { mood: "joy", playTheme: false };
  if (t.includes("danger") || t.includes("attack")) return { mood: "danger", playTheme: false };
  if (t.includes("battle")) return { mood: "danger", playTheme: false };
  if (t.includes("calm") || t.includes("sleep") || t.includes("quiet")) return { mood: "calm", playTheme: false };
  if (t.includes("mystery") || t.includes("spooky") || t.includes("secret")) return { mood: "mystery", playTheme: false };
  if (t.includes("win") || t.includes("triumph") || t.includes("finish") || t.includes("hooray"))
    return { mood: "triumph", playTheme: false };
  if (t.includes("happy") || t.includes("joy") || t.includes("dance")) return { mood: "joy", playTheme: false };
  if (t.includes("careful") || t.includes("edge") || t.includes("suspense")) return { mood: "suspense", playTheme: false };
  for (const mood of MOODS) if (t.includes(mood)) return { mood, playTheme: false };
  return null;
}

export function semitoneHz(rootHz: number, semitones: number): number {
  return rootHz * 2 ** (semitones / 12);
}
