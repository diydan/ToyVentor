/**
 * The theme song's words, checked (docs/specs/dance-party-spec.md 4.2, relaxed for theme songs by Dan, 2026-11-03: "lyrics too").
 *
 * The text model writes a creation's NAME and a short song as JSON: a mood, a tempo, up to two instruments (the closed cards in songCards.ts), a verse
 * and a chorus. It never writes the Mureka `lyrics` string itself. This module takes that reply as untrusted data, checks every field, and BUILDS the
 * lyrics string from the checked lines, so the section markers are ours and the shape is fixed: `[Verse]`, `[Chorus]`, `[Chorus]`.
 *
 * What is checked (each has a test in tests/song-lyrics.test.ts), and why it can only reject, never repair:
 *  - the name: 1 to 5 words, letters only, no digits or symbols, not a brand, not on the unsafe list, and not the child's own words handed back;
 *  - every line: 2 to 8 words, letters and the apostrophe, comma, full stop, question mark, exclamation mark and hyphen only, no digits (a number is
 *    where a phone number hides), no link or contact shape, not on the unsafe, insult or brand list;
 *  - capitals: a capital letter after the first word of a line is a name (a person, a place, a product). The creation's own name is the one allowed;
 *  - the song: 3 to 6 lines in the verse and in the chorus, at least one chorus line says the creation's name, 600 characters at most in all;
 *  - the cards: an unknown mood or tempo becomes the neutral one (bouncy, medium) and unknown instruments are dropped, as the rest of the product does.
 * Anything else is `ok: false` with a reason, and the caller makes no paid call. A check the caller owns (the Worker's kid-safe text filter, which
 * lives in worker/muse.ts and cannot be imported here) comes in as `extraSafe`.
 *
 * Pure: no network, no clock.
 */
import { MAX_INSTRUMENTS, MOODS, TEMPOS, INSTRUMENTS, buildSongRequest, vocalPromptFor, type SongRequest } from "./songCards";

export const MAX_NAME_WORDS = 5;
export const MAX_NAME_CHARS = 40;
export const MIN_SECTION_LINES = 3;
export const MAX_SECTION_LINES = 6;
export const MIN_LINE_WORDS = 2;
export const MAX_LINE_WORDS = 8;
export const MAX_LINE_CHARS = 64;
export const MAX_LYRICS_CHARS = 600;

/** Harm, fear, insults, rude words and grown-up things. Whole words, any case. A short list on purpose: the model is asked for kind words; this is the net. */
const UNSAFE = new RegExp(
  "\\b(?:" +
    [
      "kill", "kills", "killed", "killing", "die", "dies", "died", "dying", "dead", "death", "murder", "blood", "bloody", "gun", "guns", "shoot", "shot", "knife", "knives",
      "bomb", "bombs", "stab", "fight", "fights", "hurt", "hurts", "punch", "hit", "hits", "war", "weapon", "weapons", "ghost", "ghosts", "scary", "scared", "terrify",
      "hate", "hates", "stupid", "idiot", "dumb", "ugly", "fat", "loser", "shut", "sexy", "naked", "kiss", "drunk", "beer", "wine", "vodka", "smoke", "smoking", "drug", "drugs",
      "damn", "hell", "crap", "sucks", "suck", "wtf", "fuck", "shit", "bitch", "ass", "god", "jesus", "allah",
    ].join("|") +
    ")\\b",
  "i",
);

/** Brands, characters and makes. Substring, any case: a brand glued into a longer word is still the brand. */
const BRANDS = /lego|disney|pixar|marvel|nintendo|pokemon|pok[eé]mon|minecraft|roblox|barbie|hot ?wheels|paw ?patrol|bluey|peppa|frozen|mickey|spider-?man|batman|superman|mario|sonic|toyota|honda|ford|tesla|ferrari|lamborghini|porsche|nike|adidas|google|youtube|tiktok|netflix|amazon|coca|pepsi|mcdonald|santa|elsa|thomas the|ninja turtle|transformers|star ?wars|harry potter/i;

const LINKISH = /https?:|www\.|\.com\b|\.net\b|\.org\b|@/i;
const LINE_CHARS = /^[A-Za-z][A-Za-z' ,.?!-]*$/;
const NAME_CHARS = /^[A-Za-z][A-Za-z' -]*$/;

const words = (s: string): string[] => s.split(/\s+/).filter(Boolean);
const squish = (s: string): string => s.toLowerCase().replace(/[^a-z' ]+/g, " ").replace(/\s+/g, " ").trim();
const asText = (v: unknown): string => (typeof v === "string" ? v.replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim() : "");

export interface ThemeSong {
  /** The creation's name, 1 to 5 words. */
  name: string;
  /** What Mureka's `lyrics` field is sent, built here from the checked lines. */
  lyrics: string;
  /** The checked lines, in order (verse, then chorus), for showing the words on screen. */
  verse: string[];
  chorus: string[];
  request: SongRequest;
  /** The fixed style text sent as Mureka's `prompt`. */
  prompt: string;
}
export type ThemeSongResult = { ok: true; song: ThemeSong } | { ok: false; reason: string };

export interface ThemeContext {
  /** What the child said, already lower-cased and squished; the name and the lines may not hand it back. */
  childSaid?: string;
  /** The caller's own safe-text check (it returns false for anything it will not allow); run on the name and on every line. */
  extraSafe?: (text: string) => boolean;
}

const bad = (reason: string): ThemeSongResult => ({ ok: false, reason });

/** Four or more words in a row copied from what the child said (the same rule the other kid-facing routes use). */
function echoes(text: string, childSaid: string): boolean {
  if (childSaid.length < 8) return false;
  const t = squish(text);
  if (t.includes(childSaid)) return true;
  const w = childSaid.split(" ");
  for (let i = 0; i + 4 <= w.length; i++) if (t.includes(w.slice(i, i + 4).join(" "))) return true;
  return false;
}

function checkName(raw: unknown, ctx: ThemeContext): { ok: true; name: string } | { ok: false; reason: string } {
  const name = asText(raw);
  if (!name) return { ok: false, reason: "no_name" };
  if (name.length > MAX_NAME_CHARS || words(name).length > MAX_NAME_WORDS) return { ok: false, reason: "name_too_long" };
  if (!NAME_CHARS.test(name)) return { ok: false, reason: "name_characters" };
  if (UNSAFE.test(name) || BRANDS.test(name) || LINKISH.test(name)) return { ok: false, reason: "name_unsafe" };
  if (ctx.extraSafe && !ctx.extraSafe(name)) return { ok: false, reason: "name_unsafe" };
  if (ctx.childSaid && echoes(name, ctx.childSaid)) return { ok: false, reason: "name_echoes_child" };
  return { ok: true, name };
}

function checkLines(raw: unknown, section: string, name: string, ctx: ThemeContext): { ok: true; lines: string[] } | { ok: false; reason: string } {
  if (!Array.isArray(raw)) return { ok: false, reason: `${section}_missing` };
  const lines = raw.map(asText);
  if (lines.length < MIN_SECTION_LINES || lines.length > MAX_SECTION_LINES) return { ok: false, reason: `${section}_length` };
  const nameWords = new Set(words(name).map((w) => w.toLowerCase()));
  for (const line of lines) {
    const w = words(line);
    if (w.length < MIN_LINE_WORDS || w.length > MAX_LINE_WORDS || line.length > MAX_LINE_CHARS) return { ok: false, reason: `${section}_line_size` };
    if (!LINE_CHARS.test(line)) return { ok: false, reason: `${section}_characters` };
    if (UNSAFE.test(line) || BRANDS.test(line) || LINKISH.test(line)) return { ok: false, reason: `${section}_unsafe` };
    if (ctx.extraSafe && !ctx.extraSafe(line)) return { ok: false, reason: `${section}_unsafe` };
    if (ctx.childSaid && echoes(line, ctx.childSaid)) return { ok: false, reason: `${section}_echoes_child` };
    // a capital after the first word is a name of something: only the creation's own name may have one ("I" is the one pronoun)
    for (const token of w.slice(1)) {
      const bare = token.replace(/^[^A-Za-z]+|[^A-Za-z']+$/g, "");
      if (/^[A-Z]/.test(bare) && !/^I(?:'[a-z]+)?$/.test(bare) && !/^Kip(?:'s)?$/.test(bare) && !nameWords.has(bare.toLowerCase())) return { ok: false, reason: `${section}_capital` };
    }
  }
  return { ok: true, lines };
}

/** The mood and tempo cards from a model reply: the closed lists, with the neutral card for anything else. */
function cards(reply: Record<string, unknown>): SongRequest {
  const mood = (MOODS as readonly string[]).includes(reply.mood as string) ? (reply.mood as string) : "bouncy";
  const tempo = (TEMPOS as readonly string[]).includes(reply.tempo as string) ? (reply.tempo as string) : "medium";
  const instruments = Array.isArray(reply.instruments) ? reply.instruments.filter((i): i is string => (INSTRUMENTS as readonly string[]).includes(i as string)) : [];
  const r = buildSongRequest({ mood, tempo, instruments: instruments.slice(0, MAX_INSTRUMENTS) });
  // buildSongRequest cannot refuse here (mood and tempo are from the lists above); the fallback only keeps the types honest
  return r.ok ? r.request : { mood: "bouncy", tempo: "medium", instruments: [] };
}

/** A model's JSON reply (already parsed) to a checked theme song, or the first reason it cannot be one. */
export function parseThemeReply(reply: unknown, ctx: ThemeContext = {}): ThemeSongResult {
  if (typeof reply !== "object" || reply === null || Array.isArray(reply)) return bad("not_object");
  const r = reply as Record<string, unknown>;
  const n = checkName(r.name, ctx);
  if (!n.ok) return bad(n.reason);
  const verse = checkLines(r.verse, "verse", n.name, ctx);
  if (!verse.ok) return bad(verse.reason);
  const chorus = checkLines(r.chorus, "chorus", n.name, ctx);
  if (!chorus.ok) return bad(chorus.reason);
  // the point of a THEME song: the chorus sings the creation's name
  const nameKey = squish(n.name);
  if (!chorus.lines.some((l) => squish(l).includes(nameKey))) return bad("chorus_lacks_name");
  const lyrics = `[Verse]\n${verse.lines.join("\n")}\n\n[Chorus]\n${chorus.lines.join("\n")}\n\n[Chorus]\n${chorus.lines.join("\n")}`;
  if (lyrics.length > MAX_LYRICS_CHARS * 1.5) return bad("too_long"); // the chorus is sung twice, so the cap is on the lines (600) and the built string may be a half longer
  if (verse.lines.join("").length + chorus.lines.join("").length > MAX_LYRICS_CHARS) return bad("too_long");
  const request = cards(r);
  return { ok: true, song: { name: n.name, lyrics, verse: verse.lines, chorus: chorus.lines, request, prompt: vocalPromptFor(request) } };
}
