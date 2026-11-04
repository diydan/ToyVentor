/**
 * Brand and character wishes for the training set: the thing a child asks for most ("a Batman mask") and the thing the first pilots handled worst (they wrote the brand into the part's
 * NAME about twice as often as the base model, so the name filter had to swap in "My Creation"; docs/specs/forge-ai-spec.md, Tuning readiness, first results).
 *
 * The base model answers such a wish well under the production prompt (a brand-free look-alike with a friendly name); a training set made of ordinary wishes has no example of it. These wishes
 * go through the same sampling and the same safe-by-construction filters as every other wish, so an example is kept only if NOTHING the model wrote carries a brand word. A wish the
 * production intake already refuses (KID_BRAND_RE) is dropped here too: the model never sees it in production, so there is nothing to learn from it.
 *
 * NEVER the evaluation brands: pikachu, spiderman and mickey mouse are in tests/fixtures/forge-redteam.json, and hello kitty in the acceptance set. They are left out on purpose, and
 * finalize's near-duplicate check against the evaluation wishes would drop a copy anyway. A brand that is not in the training data is exactly what the evaluation must test.
 *
 * Pure: no model call, no clock.
 */
import { finalizeWishes, type Wish } from "./wishgen";
import type { TermLang } from "../../../shared/kidSafeTerms";
import { foldText } from "../../../shared/kidSafeNormalize";

/** Characters and brands a child might name, none of them an evaluation brand. Names are the same in every language, as a child would say them. */
export const BRANDS = [
  "batman", "superman", "iron man", "hulk", "captain america", "thor", "mario", "luigi", "sonic", "kirby", "pac-man", "minecraft creeper", "pokemon", "charizard", "eevee", "bulbasaur",
  "snoopy", "winnie the pooh", "tigger", "elsa", "olaf", "moana", "buzz lightyear", "woody", "nemo", "simba", "stitch", "peppa pig", "bluey", "paw patrol", "spongebob", "patrick star",
  "dora", "shrek", "minions", "barbie", "lego", "harry potter", "darth vader", "yoda", "stormtrooper", "goku", "naruto", "totoro", "doraemon", "thomas the tank engine",
  "lightning mcqueen", "sailor moon", "donald duck", "bugs bunny", "scooby doo", "tom and jerry", "angry birds", "among us",
] as const;

/** The words that name each brand above (the whole name and the distinctive part of it), for the one job of recognising them in text the model wrote. Whole-word, accents and case ignored.
 *  WHY THIS EXISTS: the production name filter (KID_BRAND_RE) knows a few brands. The base model writes the others straight into a part's name ("Bluey Mask Head", "Totoro Ears Hood"), and a
 *  dataset that kept those answers would teach a tuned model to do the same. The dataset builder rejects any example whose text mentions one of these. */
export const BRAND_WORDS: readonly string[] = [
  "batman", "superman", "iron man", "ironman", "hulk", "captain america", "thor", "mario", "luigi", "sonic", "kirby", "pac-man", "pacman", "minecraft", "creeper", "pokemon", "charizard", "eevee",
  "bulbasaur", "snoopy", "winnie", "pooh", "tigger", "elsa", "olaf", "moana", "buzz lightyear", "lightyear", "woody", "nemo", "simba", "stitch", "peppa", "bluey", "paw patrol", "spongebob",
  "patrick star", "dora", "shrek", "minion", "minions", "barbie", "lego", "harry potter", "hogwarts", "darth vader", "vader", "yoda", "stormtrooper", "goku", "naruto", "totoro", "doraemon",
  "thomas the tank", "mcqueen", "sailor moon", "donald duck", "bugs bunny", "scooby", "tom and jerry", "angry birds", "among us", "disney", "pixar", "marvel", "nintendo", "pikachu", "spiderman",
  "spider-man", "mickey", "minnie", "hello kitty",
];
const BRAND_RE = new RegExp(`(?<![\\p{L}\\p{N}])(?:${[...new Set(BRAND_WORDS)].map((w) => foldText(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+")).join("|")})(?![\\p{L}\\p{N}])`, "u");

/** Does this text name one of the brands? */
export const mentionsBrand = (text: string): boolean => BRAND_RE.test(foldText(text));

const TEMPLATES: Record<TermLang, readonly string[]> = {
  en: ["a {b} hat", "a {b} mask", "a {b} head", "{b} ears"],
  es: ["un sombrero de {b}", "una máscara de {b}", "una cabeza de {b}", "orejas de {b}"],
  fr: ["un chapeau {b}", "un masque de {b}", "une tête de {b}", "des oreilles de {b}"],
  de: ["ein {b}-Hut", "eine {b}-Maske", "ein {b}-Kopf", "{b}-Ohren"],
  it: ["un cappello di {b}", "una maschera di {b}", "una testa di {b}", "orecchie di {b}"],
  pt: ["um chapéu do {b}", "uma máscara do {b}", "uma cabeça do {b}", "orelhas do {b}"],
  tr: ["{b} şapkası", "{b} maskesi", "{b} kafası", "{b} kulakları"],
};

/** Every brand in every template of every language, through the production intake and the evaluation-overlap check. Never heldout: the heldout set is the evaluation and must not grow. */
export function brandWishes(o: { evals?: readonly string[]; perLang?: number } = {}): { wishes: Wish[]; rejected: Record<string, number> } {
  const perLang = o.perLang ?? 60;
  const candidates: { text: string; lang: TermLang; source: "seed" }[] = [];
  for (const lang of Object.keys(TEMPLATES) as TermLang[]) {
    const all = BRANDS.flatMap((b, i) => TEMPLATES[lang].map((t, j) => ({ key: (i * 7 + j * 3 + 1) % 97, text: t.replace("{b}", b) })));
    // a fixed, spread-out choice of perLang wishes per language (not the first perLang, which would be one brand's four templates in a row)
    all.sort((a, b) => a.key - b.key || a.text.localeCompare(b.text));
    for (const w of all.slice(0, perLang)) candidates.push({ text: w.text, lang, source: "seed" });
  }
  const { wishes, rejected } = finalizeWishes(candidates, o.evals ? { evals: o.evals } : {});
  return { wishes: wishes.map((w) => ({ ...w, split: w.split === "val" ? "val" : "train" })), rejected };
}
