// Writes docs/review/spoken-names.md: everything the game says aloud ("green tree", "árbol verde", "blaue Lampe", the Describe & Build
// part names) laid out for a NATIVE SPEAKER to check, plus two things a native speaker cannot see by reading: the phrases that are
// spelled the same in two languages (the voice picks its language from the text alone, so "casa verde" may come out Spanish, Italian
// or Portuguese) and the doubts I have about specific words. Regenerate after any change to src/lib/propNames.ts or partNames.ts:
//   npx tsx scripts/spoken-names-sheet.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { COLOR_KEYS, LANGUAGES, NOUN_KEYS, propNoun, propPhrase, type ColorKey, type LangCode } from "../src/lib/propNames";
import { PART_IDS, partPhrase } from "../src/lib/partNames";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "docs", "review", "spoken-names.md");
const langs = LANGUAGES.map((l) => l.code as LangCode);
const label = (c: LangCode) => LANGUAGES.find((l) => l.code === c)!.label;

/** Doubts, written by me (not a native speaker of any of these), most useful first. The reviewer decides; nothing here is a finding of fact. */
const DOUBTS: Record<Exclude<LangCode, "en">, string[]> = {
  es: [
    "`neumático` (tire): Latin America says `llanta` or `goma`. Which Spanish do the kids hear?",
    "`sombrilla` (beach umbrella): Spain says `sombrilla` or `parasol`; parts of Latin America say `quitasol`.",
    "`naranja` and `rosa` as colours: plural `naranjas` / `rosas` vs invariable `naranja` / `rosa` (\"bloques naranja\"). I used the -s plural.",
    "`morado` (purple): `violeta` or `púrpura` elsewhere. `pelota` vs `balón`.",
  ],
  fr: [
    "`cabane` for the shed (`remise`, `abri` are closer to a garden shed; `cabane` is what a child would say).",
    "`nounours` (teddy): good for a child, informal. `ours en peluche` is the plain form.",
    "`cubes` for blocks (`blocs` would also be understood).",
  ],
  de: [
    "`oranger` / `oranges` (declined orange): most writers leave `orange` undeclined (\"ein orange Haus\"); the declined form is accepted but informal. Which should we speak?",
    "`lila` and `rosa` are left undeclined on purpose (\"lila Baum\"), the usual form.",
    "`Tanne` for the pine tree: botanically `Kiefer`; `Tanne` is what a child says (and it is the Christmas tree). Fine if you agree.",
    "`Bauklötze` for blocks, `Rollerrahmen` / `Auto-Chassis` for parts: compound nouns I built, please say if they sound unnatural.",
  ],
  it: [
    "`gomma` (tire): `pneumatico` is the technical word, `gomma` is common but also means rubber and eraser.",
    "`arancione` is shown invariable; the plural `arancioni` also exists (\"cuscini arancioni\").",
    "`ombrellone` (beach umbrella) is right for the beach world; a rain umbrella would be `ombrello`.",
    "`paraurti rinforzato` for the bull bar, `zaino a reazione` for the jetpack: descriptive phrases, no single common word.",
  ],
  pt: [
    "Written for Brazil (`pt-BR`): `luminária`, `marrom`, `caçamba`, `capô`, `aerofólio`. Portugal says `candeeiro`, `castanho`, `caixa de carga`, `capot`. Is Brazil the right choice?",
    "`laranja` / `rosa` plurals: `laranjas` vs invariable `laranja`; `rosa` is left invariable here (\"bolas rosa\").",
    "`galpão` (shed) is a large warehouse-like building; `casinha` or `barracão` may be closer.",
    "`skate` for the skateboard deck, `bagageiro` (roof rack) is the Portugal word; Brazil says `rack de teto`.",
  ],
  tr: [
    "`kaykay` (skateboard) is the child's word; `kaykay tahtası` is the plain one.",
    "`yel değirmeni`, `kumdan kale`, `kardan adam`: expected set phrases. `çam ağacı` for the pine tree.",
    "Part names like `araba şasisi`, `ön koruma` (bull bar), `jet paketi` (jetpack) are my best constructions, please correct freely.",
    "Colours come before the noun and never change (\"yeşil ağaç\"); plural nouns (`bloklar`) take no change either.",
  ],
};

/** Example nouns that show agreement: [column header, noun key]. Gender differs per language, so each language picks its own. */
type Cols = Array<[string, (typeof NOUN_KEYS)[number]]>;
const AGREEMENT: Record<LangCode, Cols> = {
  en: [["tree", "tree"]],
  tr: [["ağaç (tree)", "tree"]],
  es: [["masculine (tree)", "tree"], ["feminine (lamp)", "lamp"], ["masc. plural (blocks)", "blocks"]],
  fr: [["masculine (tree)", "tree"], ["feminine (lamp)", "lamp"], ["masc. plural (blocks)", "blocks"]],
  it: [["masculine (tree)", "tree"], ["feminine (lamp)", "lamp"], ["masc. plural (blocks)", "blocks"]],
  de: [["masculine (tree)", "tree"], ["feminine (lamp)", "lamp"], ["neuter (house)", "house"], ["plural (blocks)", "blocks"]],
  pt: [["masculine (tire)", "tire"], ["feminine (tree)", "tree"], ["masc. plural (blocks)", "blocks"], ["fem. plural (cushions)", "cushions"]],
};

const lines: string[] = [];
const w = (s = "") => lines.push(s);

w("# Spoken names: native-speaker review sheet");
w();
w("_Generated by `scripts/spoken-names-sheet.ts` from `src/lib/propNames.ts` and `src/lib/partNames.ts`. Do not edit by hand; edit the vocabulary and regenerate._");
w();
w("When a child taps a prop in the game, or a part in Describe & Build, the game says its colour and name in the chosen language. The phrases");
w("are **built** from a noun (with gender and number) and a colour word that agrees with it, not machine-translated, so a wrong noun or a");
w("wrong colour form is wrong in every phrase that uses it. That makes a review short: check the nouns, the colour forms, and a few built phrases.");
w();
w("## How to review (about 10 minutes per language)");
w();
w("1. Open the section for your language. Read each **bare noun** aloud: is it the word a child there would use for this toy?");
w("2. Read the **colour forms**: do the masculine, feminine and plural forms agree the way you would say them?");
w("3. Read the **built phrases** (every noun in a plain colour, and in an awkward one): any that sounds wrong or stiff?");
w("4. Answer the numbered **doubts** (they are mine, not facts).");
w("5. Tap a few things in the app with the language chosen, and tell us whether the **voice** is in your language and accent (see \"Same spelling\" below).");
w();
w("Reply with the corrected word next to the old one; that is all we need.");
w();

// ---------- same spelling in several languages ----------
interface Phrase { text: string; lang: LangCode; what: string }
const all: Phrase[] = [];
for (const lang of langs) {
  for (const n of NOUN_KEYS) for (const c of COLOR_KEYS) all.push({ text: propPhrase(n, c, lang), lang, what: `${n}/${c}` });
  for (const id of PART_IDS) for (const c of [null, ...COLOR_KEYS] as Array<ColorKey | null>) all.push({ text: partPhrase(id, c, lang)!, lang, what: `${id}/${c ?? "-"}` });
}
const byText = new Map<string, Phrase[]>();
for (const p of all) {
  const k = p.text.toLowerCase();
  byText.set(k, [...(byText.get(k) ?? []), p]);
}
const shared = [...byText.entries()].filter(([, ps]) => new Set(ps.map((p) => p.lang)).size > 1);
const perLang = new Map<LangCode, number>();
const perLangTotal = new Map<LangCode, number>();
for (const p of all) perLangTotal.set(p.lang, (perLangTotal.get(p.lang) ?? 0) + 1);
for (const [, ps] of shared) for (const l of new Set(ps.map((p) => p.lang))) perLang.set(l, (perLang.get(l) ?? 0) + new Set(ps.filter((p) => p.lang === l).map((p) => p.what)).size);
const pairs = new Map<string, number>();
for (const [, ps] of shared) {
  const ls = [...new Set(ps.map((p) => p.lang))].sort();
  pairs.set(ls.join("+"), (pairs.get(ls.join("+")) ?? 0) + 1);
}

w("## Same spelling in more than one language (the voice may use the wrong one)");
w();
w("The text-to-speech model is given only the words and decides the language itself. A phrase spelled identically in two languages has no");
w("signal: `casa verde` is valid Spanish, Italian and Portuguese; `luz azul` is Spanish and Portuguese. The voice may answer in the other");
w("language or accent. Counts below are over every noun/part in every colour (not all are used by the game at once).");
w();
w("| Language | Phrases | Spelled the same as another language | Share |");
w("|---|---:|---:|---:|");
for (const l of langs) {
  const t = perLangTotal.get(l) ?? 0;
  const s = perLang.get(l) ?? 0;
  w(`| ${label(l)} | ${t} | ${s} | ${Math.round((100 * s) / Math.max(1, t))}% |`);
}
w();
w("Which languages collide (distinct spellings):");
w();
for (const [k, n] of [...pairs.entries()].sort((a, b) => b[1] - a[1])) w(`- ${k.replace(/\+/g, " + ")}: ${n}`);
w();
w("A few examples (first 24):");
w();
for (const [text, ps] of shared.slice(0, 24)) w(`- \`${text}\`: ${[...new Set(ps.map((p) => p.lang))].join(", ")}`);
w();

// ---------- per language ----------
for (const lang of langs) {
  w(`## ${label(lang)} (\`${lang}\`)`);
  w();
  if (lang !== "en") {
    w("**My doubts (please answer):**");
    w();
    DOUBTS[lang].forEach((d, i) => w(`${i + 1}. ${d}`));
    w();
  }
  w("**Colour words** built on example nouns of each gender and on a plural, so the agreement is visible:");
  w();
  const cols = AGREEMENT[lang];
  w(`| Colour | ${cols.map(([h]) => h).join(" | ")} |`);
  w(`|---|${cols.map(() => "---").join("|")}|`);
  for (const c of COLOR_KEYS) w(`| ${c} | ${cols.map(([, k]) => propPhrase(k, c, lang)).join(" | ")} |`);
  w();
  w("**Props** (noun, then a green and an orange phrase to show agreement and the awkward colour):");
  w();
  w("| Key | English | Noun | Green | Orange | OK? |");
  w("|---|---|---|---|---|---|");
  for (const k of NOUN_KEYS) w(`| ${k} | ${propNoun(k, "en")} | ${propNoun(k, lang)} | ${propPhrase(k, "green", lang)} | ${propPhrase(k, "orange", lang)} | |`);
  w();
  w("**Describe & Build parts** (shown in blue):");
  w();
  w("| Part id | English | Blue phrase | OK? |");
  w("|---|---|---|---|");
  for (const id of PART_IDS) w(`| ${id} | ${partPhrase(id, null, "en")} | ${partPhrase(id, "blue", lang)} | |`);
  w();
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, lines.join("\n") + "\n");
console.log(`wrote ${out} (${lines.length} lines, ${all.length} phrases, ${shared.length} spelled the same in 2+ languages)`);
