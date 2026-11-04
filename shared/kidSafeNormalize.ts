/**
 * How text is made comparable before it is checked against the unsafe-term lists (shared/kidSafeTerms.ts). Pure: no DOM, no clock, no network.
 *
 * Two forms, because one cannot serve seven languages (checked 2026-11-04):
 *  - FOLDED (English, Spanish, French, German, Italian, Portuguese): accents are stripped so "Cuchillo", "cuchillo" and a keyboard with no accents all meet.
 *  - TURKISH: the letters ç ş ğ ı ö ü are KEPT. Stripping them merges "sık" (often) with a vulgar word, and "ölü" (dead) with "olu". Uppercase is lowered with Turkish
 *    rules (I becomes ı, İ becomes i) when the text carries a Turkish letter, so "IŞIK" reads as "ışık". A child who types Turkish without its letters is not caught:
 *    that is the price of not refusing harmless Turkish, and the output side and the model's own training are still behind it.
 *
 * Both forms: Unicode NFKC (full-width and compatibility forms become plain letters), invisible format characters removed, whitespace collapsed.
 * Word boundaries are NOT `\\b`, which only knows ASCII letters (`/\\bçay\\b/` fails on "çay"): the matcher uses Unicode-aware lookarounds.
 */

const INVISIBLE = /[\p{Cf}\u00ad]/gu; // zero-width spaces and joiners, soft hyphen, direction marks: a cheap way to hide a word inside a word
const TURKISH_LETTER = /[çşğıİöüÇŞĞÖÜ]/;

const base = (text: string): string => text.normalize("NFKC").replace(INVISIBLE, "");

/** For every language except Turkish. */
export function foldText(text: string): string {
  return base(text)
    .replace(/İ/g, "i")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ı/g, "i")
    .replace(/ß/g, "ss")
    .replace(/ø/g, "o")
    .replace(/æ/g, "ae")
    .replace(/œ/g, "oe")
    .replace(/ł/g, "l")
    .replace(/\s+/g, " ")
    .trim();
}

/** For Turkish: keeps ç ş ğ ı ö ü. */
export function turkishText(text: string): string {
  const b = base(text);
  let lowered: string;
  try {
    lowered = TURKISH_LETTER.test(b) ? b.toLocaleLowerCase("tr") : b.replace(/İ/g, "i").toLowerCase();
  } catch {
    // a runtime without locale data (checked in Node, still to be confirmed in the Workers runtime): the default rules, with İ and I handled by hand
    lowered = b.replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase();
  }
  return lowered.replace(/\s+/g, " ").trim();
}

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i" };

/** Digits and symbols standing in for letters ("k1ll", "n4ked"). Applied to the folded form only, and only as a second look. */
export function unleet(folded: string): string {
  return folded.replace(/[0134557@$!]/g, (c) => LEET[c] ?? c);
}

/** A list entry becomes a regex source: `*` on the end means "and any letters after" (an inflection), spaces mean any whitespace. */
export function entrySource(entry: string, normalise: (s: string) => string): string {
  const stem = entry.trim().endsWith("*");
  const word = normalise(stem ? entry.trim().slice(0, -1) : entry);
  return word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+") + (stem ? "\\p{L}*" : "");
}

/** A regex that finds any of the entries as WHOLE words (or word starts, for `*` entries), with Unicode-aware boundaries. */
export function compileEntries(entries: readonly string[], normalise: (s: string) => string): RegExp | null {
  if (entries.length === 0) return null;
  const sources = [...new Set(entries.map((e) => entrySource(e, normalise)))].filter((s) => s.length > 0);
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${sources.join("|")})(?![\\p{L}\\p{N}])`, "u");
}
