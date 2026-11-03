/**
 * What a child can ask the song maker for (docs/specs/dance-party-spec.md, 4.2): cards, never words.
 *
 * A mood, a tempo, up to two instruments. Each is an id from a closed list below; the prompt for the provider is a fixed template filled
 * ONLY from that list's own text, so nothing a child or a client sends can reach it. No free text, no child data, no name of a song or an
 * artist, instrumental only (v1). Unknown instruments are dropped, as the generation rules everywhere in this product do; an unknown mood or
 * tempo is refused, because the card is not a card.
 *
 * The prompt wording is a first draft for the provider Dan chooses to try: the structure (closed ids, fixed text) is the rule, the sentences
 * are not, and the provider's accepted prompt format is unverified (4.1).
 *
 * Pure: no imports, no network.
 */

export const MOODS = ["bouncy", "sleepy", "silly", "space", "kitchen", "cleanup"] as const;
export type Mood = (typeof MOODS)[number];

export const TEMPOS = ["slow", "medium", "fast"] as const;
export type Tempo = (typeof TEMPOS)[number];

export const INSTRUMENTS = ["drums", "piano", "guitar", "trumpet", "maracas", "bells", "xylophone", "synth"] as const;
export type Instrument = (typeof INSTRUMENTS)[number];

export const MAX_INSTRUMENTS = 2;

/**
 * The tempo each card asks for. The song's real tempo is measured afterwards (shared/songBeat.ts) and wins; these are what is asked, picked
 * to sit inside the 0.8 to 1.25 rate of the 120 bpm dances (96 to 150) for the middle and fast cards, and to give the slow card a lullaby pace.
 */
export const TEMPO_BPM: Readonly<Record<Tempo, number>> = { slow: 90, medium: 110, fast: 128 };

const MOOD_TEXT: Readonly<Record<Mood, string>> = {
  bouncy: "bouncy and playful",
  sleepy: "soft, gentle and sleepy, like a lullaby",
  silly: "silly and goofy, like a cartoon",
  space: "dreamy space adventure with twinkly sounds",
  kitchen: "cheerful kitchen groove with a light swing",
  cleanup: "upbeat tidy-up march with a steady driving beat",
};

const TEMPO_TEXT: Readonly<Record<Tempo, string>> = { slow: "slow", medium: "medium pace", fast: "fast and lively" };

const INSTRUMENT_TEXT: Readonly<Record<Instrument, string>> = {
  drums: "drums",
  piano: "piano",
  guitar: "acoustic guitar",
  trumpet: "trumpet",
  maracas: "maracas",
  bells: "bells",
  xylophone: "xylophone",
  synth: "soft synth",
};

export interface SongRequest {
  mood: Mood;
  tempo: Tempo;
  /** 0 to 2, from the list, no repeats, in the order given. */
  instruments: Instrument[];
}

export type SongRequestResult =
  | { ok: true; request: SongRequest; prompt: string; bpm: number }
  | { ok: false; reason: "not_object" | "bad_mood" | "bad_tempo" };

function oneOf<T extends string>(list: readonly T[], v: unknown): T | null {
  return typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null;
}

/** The text sent to the provider, built from a checked request and nothing else. */
export function promptFor(req: SongRequest): string {
  const inst = req.instruments.map((i) => INSTRUMENT_TEXT[i]);
  const feature = inst.length ? `featuring ${inst.join(" and ")}` : "with a friendly mix of instruments";
  return (
    `A ${MOOD_TEXT[req.mood]} children's tune, ${TEMPO_TEXT[req.tempo]}, about ${TEMPO_BPM[req.tempo]} BPM, ${feature}. ` +
    `Instrumental only: no vocals, no lyrics, no spoken words.`
  );
}

/**
 * The style text for a SUNG song (a theme song with lyrics): the same closed cards, a fixed template, and the one thing the instrumental prompt forbids, vocals.
 * The words themselves never go in here: they are the `lyrics` field, which shared/songLyrics.ts builds and checks line by line.
 */
export function vocalPromptFor(req: SongRequest): string {
  const inst = req.instruments.map((i) => INSTRUMENT_TEXT[i]);
  const feature = inst.length ? `featuring ${inst.join(" and ")}` : "with a friendly mix of instruments";
  return (
    `A ${MOOD_TEXT[req.mood]} children's theme song, ${TEMPO_TEXT[req.tempo]}, about ${TEMPO_BPM[req.tempo]} BPM, ${feature}. ` +
    `A warm, clear, cheerful singer with a simple melody that is easy to sing along to.`
  );
}

/** A card pick, as the client sent it, to a request the Worker can send. */
export function buildSongRequest(raw: unknown): SongRequestResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, reason: "not_object" };
  const r = raw as Record<string, unknown>;
  const mood = oneOf(MOODS, r.mood);
  if (!mood) return { ok: false, reason: "bad_mood" };
  const tempo = oneOf(TEMPOS, r.tempo);
  if (!tempo) return { ok: false, reason: "bad_tempo" };
  const instruments: Instrument[] = [];
  if (Array.isArray(r.instruments)) {
    for (const v of r.instruments) {
      const i = oneOf(INSTRUMENTS, v);
      if (i && !instruments.includes(i)) instruments.push(i);
      if (instruments.length === MAX_INSTRUMENTS) break;
    }
  }
  const request: SongRequest = { mood, tempo, instruments };
  return { ok: true, request, prompt: promptFor(request), bpm: TEMPO_BPM[tempo] };
}
