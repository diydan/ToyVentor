// The rules a household name must meet, and the checks over the whole names file: used by tests/household-names.test.ts and by
// scripts/household-names.ts. Kept apart from householdNames.ts because it borrows the Worker's kid-safety filter (worker/muse.ts), which the game's
// bundle must not carry; the lookup the game and the voice route use is the light file.
import { COLOR_KEYS, propNoun, propPhrase, type LangCode } from "./propNames";
import { kidSafeText } from "../../worker/muse";
import { NAME_LANGS, REVIEW_STATES, type NameEntry, type NamesFile } from "./householdNames";

// ---- the rules a name must meet ------------------------------------------------------------------------------------------------------

/** Articles (and "one/a") a name must not start with, per language: the name is a bare noun. */
const ARTICLES: Record<LangCode, readonly string[]> = {
  en: ["a", "an", "the"],
  es: ["el", "la", "los", "las", "un", "una", "unos", "unas"],
  fr: ["le", "la", "les", "l", "un", "une", "des", "du"],
  de: ["der", "die", "das", "ein", "eine", "einen", "dem", "den"],
  it: ["il", "lo", "la", "i", "gli", "le", "l", "un", "uno", "una"],
  pt: ["o", "a", "os", "as", "um", "uma"],
  tr: ["bir"],
};

/** Product names the library must never speak (the catalog and the part SDK refuse the same kind of word). */
const BRAND = /\b(lego|duplo|playmobil|frisbee|thermos|tupperware|post-?it|sellotape|scotch|velcro|kleenex|biro|tipp-?ex|stanley|pritt|uhu|ikea|nike|adidas|disney|barbie|hot ?wheels|google|apple inc)\b/i;

const WORD = "[\\p{L}][\\p{L}'’-]*";
const SHAPE = new RegExp(`^${WORD}(?: ${WORD}){0,2}$`, "u");
export const MAX_NAME_CHARS = 40;

let colourTokens: Map<LangCode, Set<string>> | null = null;
/** Every colour word the game uses in a language, in every gender and number, found by building phrases (so it follows propNames.ts). */
function coloursOf(lang: LangCode): Set<string> {
  if (!colourTokens) colourTokens = new Map();
  let set = colourTokens.get(lang);
  if (!set) {
    set = new Set();
    for (const noun of ["tree", "lamp", "house", "blocks", "cushions", "tire"] as const) {
      const bare = new Set(propNoun(noun, lang).toLowerCase().split(" "));
      // the plain colours only: "colorful" is a phrase ("de colores") whose little words (de) are not colours
      for (const c of COLOR_KEYS) if (c !== "colorful") for (const t of propPhrase(noun, c, lang).toLowerCase().split(" ")) if (!bare.has(t)) set.add(t);
    }
    colourTokens.set(lang, set);
  }
  return set;
}

/**
 * What is wrong with one spoken name (empty when sound): a bare noun of one to three words in letters, apostrophes and hyphens, lower case (German
 * nouns keep their capital), no article, no colour word beside the noun (a single word may BE a colour word: the orange), no brand, kid-safe.
 */
export function validateName(lang: LangCode, w: unknown): string[] {
  if (typeof w !== "string") return ["not a string"];
  const out: string[] = [];
  if (w.length === 0 || w.length > MAX_NAME_CHARS) return [`${w.length} characters (1 to ${MAX_NAME_CHARS})`];
  if (w !== w.trim() || w !== w.normalize("NFC")) out.push("untrimmed or not NFC");
  if (!SHAPE.test(w)) return [...out, "must be one to three words of letters, apostrophes and hyphens"];
  if (lang === "de") {
    if (w.split(" ").some((word) => word.length > 1 && word === word.toUpperCase() && word !== word.toLowerCase())) out.push("shouting (all capitals)");
  } else if (w !== w.toLowerCase()) out.push("must be lower case");
  const words = w.toLowerCase().split(" ");
  if (ARTICLES[lang].includes(words[0]!.split(/['’]/)[0]!)) out.push(`starts with an article (${words[0]})`);
  if (words.length > 1) {
    const colours = coloursOf(lang);
    const hit = words.find((t) => colours.has(t));
    if (hit) out.push(`names a colour (${hit}): a name is the bare noun`);
  }
  if (BRAND.test(w)) out.push("brand name");
  if (!kidSafeText(w)) out.push("not kid-safe");
  return out;
}

const ID_RE = /^[a-z][a-z0-9_]*$/;
const lowerKey = (w: string) => w.toLowerCase().normalize("NFC");

/** Everything wrong with the file itself (not against the catalog): its shape, each name, and two items sharing a noun in one language. */
export function validateNamesFile(file: NamesFile): string[] {
  const out: string[] = [];
  if (file.version !== 1) out.push(`version ${String(file.version)} is not 1`);
  if (!Array.isArray(file.pending) || file.pending.some((l) => !NAME_LANGS.includes(l) || l === "en")) out.push("pending must list languages other than en");
  if (typeof file.names !== "object" || file.names === null) return [...out, "names is not an object"];
  const owner = new Map<string, string>();
  for (const [id, byLang] of Object.entries(file.names)) {
    if (!ID_RE.test(id)) out.push(`bad id ${id}`);
    for (const [lang, entry] of Object.entries(byLang)) {
      const at = `${id}/${lang}`;
      if (!NAME_LANGS.includes(lang as LangCode)) {
        out.push(`${at}: unknown language`);
        continue;
      }
      if (!entry || typeof entry !== "object") {
        out.push(`${at}: not an entry`);
        continue;
      }
      const e = entry as NameEntry;
      if (typeof e.source !== "string" || e.source.trim() === "") out.push(`${at}: no source`);
      if (!REVIEW_STATES.includes(e.review)) out.push(`${at}: review ${String(e.review)} is not one of ${REVIEW_STATES.join(", ")}`);
      for (const p of validateName(lang as LangCode, e.w)) out.push(`${at} "${String(e.w)}": ${p}`);
      if (typeof e.w === "string") {
        const k = `${lang}|${lowerKey(e.w)}`;
        const other = owner.get(k);
        if (other && other !== id) out.push(`${lang}: "${e.w}" names both ${other} and ${id}`);
        owner.set(k, id);
      }
    }
  }
  return out;
}

/** The (id, language) pairs with no name yet, for the given ids. */
export function missingNames(file: NamesFile, ids: readonly string[]): Array<{ id: string; lang: LangCode }> {
  const out: Array<{ id: string; lang: LangCode }> = [];
  for (const id of ids) for (const lang of NAME_LANGS) if (!file.names[id]?.[lang]) out.push({ id, lang });
  return out;
}

/** The non-English languages in which some of the ids have no name yet, in the picker's order: what `pending` must say. */
export function expectedPending(file: NamesFile, ids: readonly string[]): LangCode[] {
  const lacking = new Set(missingNames(file, ids).map((m) => m.lang));
  return NAME_LANGS.filter((l) => l !== "en" && lacking.has(l));
}
