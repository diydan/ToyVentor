// What the game says when a household item's name is spoken: "spoon", "cuchara", "cuillère", "Löffel", "cucchiaio", "colher", "kaşık".
// The 60 household library items (docs/specs/household-library-spec.md) and the toy support tool each get the BARE noun in the game's seven
// languages: no article, no colour, so there is no gender or number to agree and nothing a native speaker has to rebuild. The words live in
// `householdNames.json` (committed, the source of truth); English comes from the catalog's label, the other six from the Muse model through
// `scripts/household-names.ts`, and each entry carries a review state so a native speaker can sign it off (docs/review/spoken-names.md).
//
// A language the Muse run has not filled yet is listed in `pending`. The voice never half-translates: with no name in the chosen language it
// says the English one, in English (see householdSpeech), the same rule as describeObject in propNames.ts.
import data from "./householdNames.json";
import { LANGUAGES, type LangCode } from "./propNames";

export type ReviewState = "unreviewed" | "approved";
export interface NameEntry {
  /** The spoken noun. */
  w: string;
  /** Where it came from: "catalog" (the English label, lower-cased), "edited:<why>", or "muse:<model>:<date>". */
  source: string;
  review: ReviewState;
}
export interface NamesFile {
  version: 1;
  /** Languages (never English) in which some item has no name yet. Maintained by scripts/household-names.ts; a test keeps it honest. */
  pending: LangCode[];
  names: Record<string, Partial<Record<LangCode, NameEntry>>>;
}

export const HOUSEHOLD_NAMES = data as unknown as NamesFile;
export const NAME_LANGS: readonly LangCode[] = LANGUAGES.map((l) => l.code as LangCode);
export const REVIEW_STATES: readonly ReviewState[] = ["unreviewed", "approved"];

/** The closed set of ids the voice route will speak, in catalog order (the 60 items, then the toy support tool). */
export const HOUSEHOLD_IDS: readonly string[] = Object.keys(HOUSEHOLD_NAMES.names);

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

export function isHouseholdId(id: unknown): id is string {
  return typeof id === "string" && id !== "__proto__" && own(HOUSEHOLD_NAMES.names, id);
}

/** The spoken noun for an item in a language, or null when that language has no name for it yet. */
export function householdName(id: string, lang: LangCode, file: NamesFile = HOUSEHOLD_NAMES): string | null {
  if (typeof id !== "string" || id === "__proto__" || !own(file.names, id)) return null;
  return file.names[id]![lang]?.w ?? null;
}

/**
 * What to say and in which language: the name in the chosen language, else the English one in English (an honest English word beats a guessed
 * translation). Null for an id that is not a household item, or for an item with no English name.
 */
export function householdSpeech(id: string, lang: LangCode, file: NamesFile = HOUSEHOLD_NAMES): { text: string; lang: LangCode } | null {
  const inLang = householdName(id, lang, file);
  if (inLang) return { text: inLang, lang };
  const en = householdName(id, "en", file);
  return en ? { text: en, lang: "en" } : null;
}

/** A spoken noun in the form two spellings are compared in: NFC and lower case, so German "Ball" and English "ball" are the same spelling. */
const spelling = (text: string) => text.normalize("NFC").toLowerCase();

const spellingIndexes = new WeakMap<NamesFile, Map<string, Set<LangCode>>>();
function spellingIndex(file: NamesFile): Map<string, Set<LangCode>> {
  let idx = spellingIndexes.get(file);
  if (!idx) {
    idx = new Map();
    for (const entry of Object.values(file.names))
      for (const [lang, e] of Object.entries(entry) as [LangCode, NameEntry | undefined][]) {
        if (!e) continue;
        const k = spelling(e.w);
        if (!idx.has(k)) idx.set(k, new Set());
        idx.get(k)!.add(lang);
      }
    spellingIndexes.set(file, idx);
  }
  return idx;
}

/**
 * Is this noun spelled the same in another language (for some item)? The clip voice is given only the words and picks the language itself, so such a noun
 * ("banana", "puzzle", "lata") may come out in the wrong accent. The game never asks the clip voice for it: the device voice takes an explicit language
 * tag and cannot mis-pick (householdVoice.ts), and the prewarm skips it (scripts/lib/household-voice-ledger.ts). The list is in docs/review/spoken-names.md.
 */
export function spelledInOtherLanguage(text: string, lang: LangCode, file: NamesFile = HOUSEHOLD_NAMES): boolean {
  const langs = spellingIndex(file).get(spelling(text));
  if (!langs) return false;
  for (const l of langs) if (l !== lang) return true;
  return false;
}

/**
 * A short fingerprint of a spoken text (FNV-1a over its NFC form, 8 hex digits). It is part of the clip's cache key and its URL, so a noun a
 * reviewer changes becomes a NEW clip instead of the old one served for a year, and the ledger uses it to see what changed. Not a secret.
 */
export function householdTextHash(text: string): string {
  let h = 0x811c9dc5;
  for (const ch of text.normalize("NFC")) {
    const c = ch.codePointAt(0)!;
    // feed the code point as UTF-16-independent bytes (up to 4)
    const bytes = c < 0x80 ? [c] : c < 0x800 ? [0xc0 | (c >> 6), 0x80 | (c & 63)] : c < 0x10000 ? [0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)] : [0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)];
    for (const b of bytes) {
      h ^= b;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h.toString(16).padStart(8, "0");
}
