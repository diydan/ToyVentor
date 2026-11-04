// The mini karaoke of a theme song (Dan, 2026-11-04: "the player needs stop and play and ideally a mini karaoke"). Pure, so the Worker, the game and the tests share it.
//
// WHERE THE TIMES COME FROM. Mureka's finished song carries `lyrics_sections[].lines[]`, each line with `start`/`end` in milliseconds on the SONG's own timeline and a `words`
// list with a start for every word. They are real (measured on a finished song), not guessed: the line that lights up is the line being sung. A song with none (or an old kept
// song saved before this existed) simply has no karaoke, and the card shows "The words" as before: we never pace lyrics by guesswork, because a child would sing the wrong line.
//
// WHAT THE PARTY PLAYS. Not the whole song: a cut of whole bars (shared/themeParty.ts `ThemeCut`, `startSec` + `lengthSec`) that LOOPS. So the lines are first moved onto the cut
// (`lyricsForCut`: seconds from the cut's start, lines outside it dropped), and then looked up by the position inside the loop (`karaokeAt`).

/** One lyric line as the Worker sends it and the browser keeps it: milliseconds on the song's own timeline. `w` is the start of each word of `t` (split on spaces), when the provider gave them. */
export interface LyricLine {
  s: number;
  e: number;
  t: string;
  w?: number[];
}

/** A line on the cut: seconds from the cut's start, and its words with their own starts. */
export interface CutLine {
  at: number;
  end: number;
  text: string;
  words: { t: string; at: number }[];
}

const MAX_LINES = 80;
const MAX_LINE_CHARS = 120;
const MAX_MS = 30 * 60_000;
/** A line lights up this long before it is sung (singing starts a hair after the word's mark, and eyes need a moment). */
export const KARAOKE_LEAD_S = 0.15;
/** A line stays lit this long after its last word, unless the next line begins first. */
export const KARAOKE_HOLD_S = 0.9;
/** The next line is shown ahead of time only when it starts within this many seconds. */
export const KARAOKE_PEEK_S = 7;

const clean = (v: unknown): string => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_LINE_CHARS) : "");
const ms = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_MS ? Math.round(v) : null);
const wordsOf = (t: string): string[] => t.split(" ").filter(Boolean);

/** Check one compact line (the shape the Worker sends and the browser keeps). Null when it is not one. */
function cleanLine(raw: unknown): LyricLine | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { s?: unknown; e?: unknown; t?: unknown; w?: unknown };
  const s = ms(r.s);
  const e = ms(r.e);
  const t = clean(r.t);
  if (s === null || e === null || !t || e < s) return null;
  const line: LyricLine = { s, e, t };
  if (Array.isArray(r.w)) {
    const w = r.w.map(ms);
    if (w.length === wordsOf(t).length && w.every((x): x is number => x !== null)) line.w = w;
  }
  return line;
}

/** Sort, drop what overlaps nothing sensible, and cap. */
function finalize(lines: LyricLine[]): LyricLine[] {
  return lines.sort((a, b) => a.s - b.s).slice(0, MAX_LINES);
}

/** The compact lines from a list the browser or the Worker already holds (`{s, e, t, w?}`). Anything else is dropped; never throws. */
export function cleanLines(raw: unknown): LyricLine[] {
  if (!Array.isArray(raw)) return [];
  const out: LyricLine[] = [];
  for (const r of raw) { const l = cleanLine(r); if (l) out.push(l); }
  return finalize(out);
}

/** The compact lines from Mureka's `lyrics_sections` (sections of `{lines: [{start, end, text, words: [{start, text}]}]}`). Never throws: a shape it does not know is no lines. */
export function parseLyricSections(sections: unknown): LyricLine[] {
  if (!Array.isArray(sections)) return [];
  const out: LyricLine[] = [];
  for (const sec of sections) {
    const lines = sec && typeof sec === "object" ? (sec as { lines?: unknown }).lines : null;
    if (!Array.isArray(lines)) continue;
    for (const ln of lines) {
      if (!ln || typeof ln !== "object") continue;
      const r = ln as { start?: unknown; end?: unknown; text?: unknown; words?: unknown };
      const text = clean(r.text);
      const words = Array.isArray(r.words) ? r.words.map((w) => (w && typeof w === "object" ? ms((w as { start?: unknown }).start) : null)) : [];
      const l = cleanLine({ s: r.start, e: r.end, t: text, w: words });
      if (l) out.push(l);
    }
  }
  return finalize(out);
}

/**
 * Move the lines onto the cut the party loops: seconds from the cut's start, only the part of a line that is inside it, every word placed. A line without word marks gets its words
 * spread evenly over the line. A line that ends before the cut starts, or begins after it ends, is not heard and is dropped.
 */
export function lyricsForCut(lines: readonly LyricLine[], startSec: number, lengthSec: number): CutLine[] {
  if (!(lengthSec > 0) || !Number.isFinite(startSec)) return [];
  const out: CutLine[] = [];
  for (const l of lines) {
    const s = l.s / 1000 - startSec;
    const e = l.e / 1000 - startSec;
    if (e <= 0 || s >= lengthSec) continue;
    const at = Math.max(0, s);
    const end = Math.min(lengthSec, Math.max(e, at + 0.5));
    const ws = wordsOf(l.t);
    const marks = l.w ?? ws.map((_, i) => l.s / 1000 + ((l.e - l.s) / 1000) * (i / Math.max(1, ws.length)));
    const words = ws.map((t, i) => ({ t, at: Math.max(at, (l.w ? l.w[i]! / 1000 : (marks[i] as number)) - startSec) }));
    out.push({ at, end, text: ws.join(" "), words });
  }
  return out.sort((a, b) => a.at - b.at);
}

export interface KaraokeView {
  /** The line being sung now, or -1 in a gap between lines. */
  index: number;
  /** The line being sung now, or null in a gap. */
  line: CutLine | null;
  /** How many of its words are lit (the ones whose time has come). */
  lit: number;
  /** The line before this one (or the last one sung), for a dim line above. Null at the very start. */
  prev: CutLine | null;
  /** The line coming up: while one is sung it is the following one; in a gap, the next to be sung when it is close. After the last line it is the first (the loop comes round). */
  next: CutLine | null;
}

/** What to show `pos` seconds into the loop of `loopSeconds`. A position past the loop wraps round (the party loops), a negative one reads as the start. */
export function karaokeAt(lines: readonly CutLine[], pos: number, loopSeconds: number): KaraokeView {
  const none: KaraokeView = { index: -1, line: null, lit: 0, prev: null, next: null };
  if (!lines.length) return none;
  let p = Number.isFinite(pos) ? pos : 0;
  if (loopSeconds > 0) p = ((p % loopSeconds) + loopSeconds) % loopSeconds;
  else if (p < 0) p = 0;
  // the last line whose time has come
  let started = -1;
  for (let i = 0; i < lines.length; i++) if (lines[i]!.at - KARAOKE_LEAD_S <= p) started = i;
  const nextAfter = (i: number): CutLine | null => {
    if (i + 1 < lines.length) return lines[i + 1]!;
    return lines.length > 1 || i < 0 ? lines[0]! : null; // after the last line the loop comes round to the first
  };
  if (started < 0) {
    const first = lines[0]!;
    // before the first line: nothing is sung, the first line is the one coming (shown only when close, or when the loop is about to come round to it)
    const away = first.at - p;
    return { ...none, next: away <= KARAOKE_PEEK_S ? first : null };
  }
  const cur = lines[started]!;
  const singing = p < cur.end + KARAOKE_HOLD_S;
  const upcoming = nextAfter(started);
  const prev = started > 0 ? lines[started - 1]! : null;
  if (!singing) {
    const away = upcoming ? (upcoming.at > cur.at ? upcoming.at - p : upcoming.at + loopSeconds - p) : Infinity;
    return { index: -1, line: null, lit: 0, prev: cur, next: away <= KARAOKE_PEEK_S ? upcoming : null };
  }
  let lit = 0;
  for (const w of cur.words) if (w.at - 0.05 <= p) lit++;
  return { index: started, line: cur, lit, prev, next: upcoming };
}
