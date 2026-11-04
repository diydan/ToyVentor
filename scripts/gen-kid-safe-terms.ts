/**
 * Builds shared/kidSafeTermsSevere.ts from the open "List of Dirty, Naughty, Obscene, and Otherwise Bad Words" (LDNOOBW, CC BY 4.0,
 * github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words). Run it with the folder that holds the downloaded files (en es fr de it pt tr):
 *
 *   npx tsx scripts/gen-kid-safe-terms.ts <folder>            # check only: prints what it keeps and every harmless wish it would refuse
 *   npx tsx scripts/gen-kid-safe-terms.ts <folder> --write    # also writes shared/kidSafeTermsSevere.ts (refuses to write while a harmless wish is refused)
 *
 * What it does to the raw lists, and why (2026-11-04):
 *  - Single words shorter than 4 letters are dropped ("con" is rude in French and "with" in Spanish and Italian; "am" is rude in Turkish and "I am" in English; "ass", "tit").
 *    Phrases are kept: they are specific.
 *  - EXCEPT removes words that are harmless for a child here, per language, found by running the lists over tests/fixtures/kid-wishes.json and by reading them.
 *  - Every entry is normalised the way the matcher normalises text (shared/kidSafeNormalize.ts), so the data file is already in matching form.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { compileEntries, foldText, turkishText } from "../shared/kidSafeNormalize";

const LANGS = ["en", "es", "fr", "de", "it", "pt", "tr"] as const;
type Lang = (typeof LANGS)[number];

/**
 * Harmless for a child, or too ambiguous across languages, in spite of being on the raw list. Each needs a reason. Obscenities and slurs are NEVER exceptions: a children's
 * product refuses them (on the output side too), so "arsch", "cazzo" and the like stay on the list. Keys are in matching form (folded; Turkish keeps its letters).
 */
const EXCEPT: Record<Lang, Record<string, string>> = {
  en: {
    butt: "bottom; mild, everyday", cock: "rooster; cockatoo", cocks: "roosters", dick: "a name", poof: "the magic sound in 'a hat that goes poof' (the UK slur is not worth refusing a wizard hat)",
    negro: "the colour black in Spanish and Portuguese (checked in every language: a wish's language is not known)",
    // reviewed 2026-11-04: everyday words and phrases a child can plausibly type
    nipple: "a baby bottle's teat", nipples: "a baby bottle's teat", panties: "a child's word for underwear, mild", escort: "a knight's escort", domination: "'world domination': a cartoon villain",
    twinkie: "a snack cake", bareback: "a horse rider", snatch: "'snatch the treasure': pirates", snowballing: "snowballs", cornhole: "a lawn game", shrimping: "fishing for shrimp",
    undressing: "undressing a doll", hardcore: "a hardcore gamer", "hard core": "a hard core of fans", "big black": "a big black hat", "tied up": "tied up with a ribbon", "ball kicking": "football",
    "jelly donut": "a food", "blue waffle": "a food", "tight white": "a tight white hat", "tongue in a": "a fragment", "girl on": "'a girl on a unicorn'", "girl on top": "'a girl on top of a hill'",
    "goo girl": "a slime character", "huge fat": "'a huge fat cat'", "taste my": "'taste my cooking'", "violet wand": "a wizard's wand", "baby juice": "a baby's juice", "baby batter": "a baby's cake mix",
  },
  es: {
    concha: "seashell (vulgar only in some regions)", caca: "poop: a child's word, not an obscenity", pedo: "fart: a child's word", asno: "donkey", trio: "a trio of anything",
    martillo: "hammer", heroina: "a female hero",
  },
  fr: {
    bite: "also the English word 'bite'", caca: "poop: a child's word", pipi: "pee: a child's word", folle: "mad (feminine): 'une idee folle'", gerbe: "a bouquet, a sheaf",
    meuf: "slang for a woman; not an obscenity", suce: "a pacifier (Quebec)", bitte: "German 'please' (the wish's language is not known)", baiser: "a kiss", bourre: "stuffed with sweets",
    bourree: "stuffed; also a dance", chatte: "a she-cat", pedale: "a pedal", tanche: "a tench (fish)", gueule: "an animal's muzzle: 'la gueule du dragon'", ramoner: "to sweep a chimney",
    turlute: "a Quebec folk tune", negro: "the colour black in Spanish and Portuguese", trique: "an old word for a club",
  },
  de: {
    mist: "rubbish; everyday", mopse: "pugs (the dog)", popel: "a booger: a child's word", ische: "slang for a girl, mild", mufti: "a title", lummel: "a rascal: 'kleiner Lummel'",
    nippel: "also a technical fitting", rosette: "an ornament", fratze: "a grimace or a mask", bratze: "slang for a paw", schabracke: "a horse's saddle cloth", kacken: "a child's word",
    pinkeln: "a child's word", bimbo: "also a bakery brand's bear in Spanish-speaking countries; mild", bonze: "a bigwig; mild",
  },
  it: {
    palle: "balls (the toy)", balle: "balls, bales", biga: "a two-horse chariot", casci: "helmets (a typo of 'caschi'), a verb form", pesce: "fish", monta: "mounts, assembles", montare: "to assemble",
    battere: "to beat; a common verb", tirare: "to pull, to throw", sbattere: "to slam; a common verb", pompa: "a pump", porco: "a pig", porca: "a sow", vacca: "a cow", sega: "a saw", pipi: "pee: a child's word",
    cacca: "poop: a child's word", pisello: "a pea", palloso: "boring: mild", regina: "a queen", quaglia: "a quail", spagnola: "Spanish (feminine)", cozza: "a mussel", fava: "a broad bean",
    pistolotto: "a long speech", "nave scuola": "a training ship",
  },
  pt: {
    pinto: "a chick, and a surname", corno: "a horn in Italian (a unicorn's horn)", burro: "a donkey", veado: "a deer", comer: "to eat (Portuguese and Spanish)", mama: "mom in Spanish",
    saco: "a bag", gozar: "to enjoy", aranha: "a spider", bumbum: "bottom: a child's word", camisinha: "a little shirt", chupar: "to suck a sweet", peidar: "a child's word",
    "frango assado": "roast chicken", grelho: "a sprout", torneira: "a tap", sacanagem: "mischief", "passar um cheque": "to write a cheque",
    heroina: "a female hero", heterosexual: "an identity term", homosexual: "an identity term", bissexual: "an identity term", "homem gay": "an identity term", lesbica: "an identity term", homoerotico: "an identity term",
  },
  tr: {},
};
const HAND_ADD: Record<Lang, string[]> = { en: [], es: [], fr: [], de: [], it: [], pt: [], tr: [] };

const norm = (lang: Lang) => (lang === "tr" ? turkishText : foldText);
const letters = (s: string) => (s.match(/\p{L}/gu) ?? []).length;

function build(folder: string): Record<Lang, string[]> {
  const out = {} as Record<Lang, string[]>;
  for (const lang of LANGS) {
    const raw = readFileSync(`${folder}/${lang}`, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const kept = new Set<string>();
    const exceptions = new Set(Object.keys(EXCEPT[lang]).map((k) => norm(lang)(k)));
    for (const entry of raw) {
      const n = norm(lang)(entry);
      if (!n) continue;
      const single = !n.includes(" ");
      if (single && letters(n) < 4) continue; // the dangerous short ones
      if (exceptions.has(n)) continue;
      kept.add(n);
    }
    for (const h of HAND_ADD[lang]) kept.add(norm(lang)(h));
    out[lang] = [...kept].sort();
  }
  return out;
}

const folder = process.argv[2];
if (!folder) throw new Error("usage: gen-kid-safe-terms.ts <folder with en es fr de it pt tr> [--write]");
const lists = build(folder);
const wishes = JSON.parse(readFileSync(new URL("../tests/fixtures/kid-wishes.json", import.meta.url), "utf8")) as Record<string, string[] | string>;

let refused = 0;
for (const lang of LANGS) {
  const re = compileEntries(lists[lang], norm(lang));
  const hits: string[] = [];
  for (const [wl, arr] of Object.entries(wishes)) {
    if (!Array.isArray(arr)) continue;
    for (const w of arr) {
      const m = re?.exec(norm(lang)(w));
      if (m) hits.push(`${wl}: "${w}" -> ${lang} entry "${m[0]}"`);
    }
  }
  refused += hits.length;
  console.log(`${lang}: ${lists[lang].length} entries kept (${readFileSync(`${folder}/${lang}`, "utf8").split(/\r?\n/).filter((l) => l.trim()).length} on the raw list)${hits.length ? `\n   REFUSES HARMLESS WISHES:\n   ${hits.join("\n   ")}` : ""}`);
}
console.log(refused === 0 ? "\nNo harmless wish in the fixture is refused." : `\n${refused} harmless wish(es) would be refused: add an exception (with a reason) and run again.`);

if (process.argv.includes("--write")) {
  if (refused > 0) throw new Error("not writing: a harmless wish is refused");
  const body = LANGS.map((l) => `  ${l}: [\n${lists[l].map((t) => `    ${JSON.stringify(t)},`).join("\n")}\n  ],`).join("\n");
  writeFileSync(
    new URL("../shared/kidSafeTermsSevere.ts", import.meta.url),
    `/**
 * GENERATED by scripts/gen-kid-safe-terms.ts on 2026-11-04. Do not edit by hand: change the generator's exceptions and run it again.
 *
 * Derived from the "List of Dirty, Naughty, Obscene, and Otherwise Bad Words" (LDNOOBW), CC BY 4.0, with changes (short single words removed, exceptions applied,
 * entries normalised): https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words . Licence: https://creativecommons.org/licenses/by/4.0/
 *
 * REVIEW STATE: none of the non-English lists has been read by a native speaker. See shared/kidSafeTerms.ts.
 */
export const SEVERE_TERMS = {
${body}
} as const;
`,
  );
  console.log("written shared/kidSafeTermsSevere.ts");
}
