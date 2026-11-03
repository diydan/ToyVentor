// Writes docs/review/spoken-names.md: everything the game says aloud ("green tree", "árbol verde", "blaue Lampe", the Describe & Build
// part names) laid out for a NATIVE SPEAKER to check, plus two things a native speaker cannot see by reading: the phrases that are
// spelled the same in two languages (the voice picks its language from the text alone, so "casa verde" may come out Spanish, Italian
// or Portuguese) and the doubts I have about specific words, then the household items' names (src/lib/householdNames.json). Regenerate after any change to
// src/lib/propNames.ts, partNames.ts or householdNames.json:
//   npx tsx scripts/spoken-names-sheet.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { COLOR_KEYS, LANGUAGES, NOUN_KEYS, colorKeyFromHex, propNoun, propPhrase, type ColorKey, type LangCode } from "../src/lib/propNames";
import { PROP_SPECS } from "../src/features/game/world/runtime/propReactions";
import { PART_IDS, partPhrase } from "../src/lib/partNames";
import { HOUSEHOLD_IDS, HOUSEHOLD_NAMES, NAME_LANGS } from "../src/lib/householdNames";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = process.env.SPOKEN_NAMES_OUT ?? join(root, "docs", "review", "spoken-names.md"); // the override is for tests/household-names.test.ts
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
w("_Generated by `scripts/spoken-names-sheet.ts` from `src/lib/propNames.ts`, `src/lib/partNames.ts` and `src/lib/householdNames.json`. Do not edit by hand; edit the vocabulary and regenerate._");
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
// What the game ACTUALLY speaks (the same list scripts/prewarm-voice.ts warms): every scene prop in its own colour, the light in every colour, and every
// Describe & Build part in the colour the exploded view draws it. This is the real exposure; the all-combinations count above it is an upper bound.
const partsJson = JSON.parse(readFileSync(join(root, "parts/kip/viewer/kip-describe-parts.json"), "utf8")) as { parts: Record<string, { category: string }> };
const viewSrc = readFileSync(join(root, "parts/kip/viewer/kip-describe-view.js"), "utf8");
const palette = /const CATEGORY_COLOURS = \{([\s\S]*?)\};/.exec(viewSrc)?.[1] ?? "";
const drawnColour = (cat: string): ColorKey | null => { const hex = new RegExp(`${cat}:\\s*\\[\\s*'(#[0-9a-fA-F]{6})'`).exec(palette)?.[1]; return hex ? colorKeyFromHex(hex) : null; };
const spokenCombos = new Map<string, { noun: (typeof NOUN_KEYS)[number]; color: ColorKey }>();
for (const sp of Object.values(PROP_SPECS) as Array<{ noun?: (typeof NOUN_KEYS)[number]; color: ColorKey }>) if (sp.noun) spokenCombos.set(`${sp.noun}|${sp.color}`, { noun: sp.noun, color: sp.color });
for (const c of COLOR_KEYS) spokenCombos.set(`light|${c}`, { noun: "light", color: c });
const spoken: Phrase[] = [];
for (const lang of langs) {
  for (const c of spokenCombos.values()) spoken.push({ text: propPhrase(c.noun, c.color, lang), lang, what: `${c.noun}/${c.color}` });
  for (const id of PART_IDS) spoken.push({ text: partPhrase(id, drawnColour(partsJson.parts[id]!.category), lang)!, lang, what: id });
}
const spokenByText = new Map<string, Phrase[]>();
for (const p of spoken) spokenByText.set(p.text.toLowerCase(), [...(spokenByText.get(p.text.toLowerCase()) ?? []), p]);
const spokenShared = [...spokenByText.entries()].filter(([, ps]) => new Set(ps.map((p) => p.lang)).size > 1);

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
w("The text-to-speech model is given only the words and decides the language itself (probed 2026-11-03: it has no language setting, and an");
w("instruction written into the text is read aloud, not obeyed). A phrase spelled identically in two languages has no signal: `luz azul` is valid");
w("Spanish and Portuguese. The voice may answer in the other language or accent.");
w();
w(`**What the game speaks today:** ${spoken.length / langs.length} phrases in ${langs.length} languages = ${spoken.length} clips. **${spokenShared.length} texts** are spelled the same in two languages:`);
w();
for (const [text, ps] of spokenShared) w(`- \`${text}\`: ${[...new Set(ps.map((p) => label(p.lang)))].join(" + ")} (${[...new Set(ps.map((p) => p.what))].join(", ")})`);
w();
w("**Please listen to these and tell us which language and accent you hear.** If one is wrong, the fix is to speak that phrase with the device voice and");
w("its explicit language tag, which cannot mis-detect. Free-form Forge names (spec: forge-ai-spec.md) are the larger risk: a short word such as `taco`");
w("reads the same in several languages.");
w();
w("For comparison, over every noun and part in every colour (an upper bound; the game never says most of these):");
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

// ---------- household items ----------
const hn = HOUSEHOLD_NAMES.names;
const nameOf = (id: string, l: LangCode) => hn[id]?.[l];
const present = HOUSEHOLD_IDS.flatMap((id) => NAME_LANGS.filter((l) => nameOf(id, l)).map((l) => ({ id, l, e: nameOf(id, l)! })));
const unreviewed = present.filter((p) => p.e.review === "unreviewed").length;
const emptyLangs = langs.filter((l) => !HOUSEHOLD_IDS.some((id) => nameOf(id, l)));
const partialLangs = langs.filter((l) => HOUSEHOLD_IDS.some((id) => nameOf(id, l)) && HOUSEHOLD_IDS.some((id) => !nameOf(id, l)));

w("## Household names: the library's 60 items and the toy tool");
w();
w("When a weekend asks a child to find an item (a spoon, a hammer) and a right answer says its name aloud, the game speaks the **bare noun**: no article, no");
w("colour, so there is no gender or number to agree. English comes from the library's label; the other six languages are made by the Muse model and **none is");
w("approved until a native speaker says so**. Each name carries a review state in `src/lib/householdNames.json` (`unreviewed` or `approved`); an approved name is");
w("never overwritten by a new Muse run.");
w();
w(`**State:** ${HOUSEHOLD_IDS.length} items x ${NAME_LANGS.length} languages = ${HOUSEHOLD_IDS.length * NAME_LANGS.length} names; ${present.length} exist, ${unreviewed} unreviewed, ${present.length - unreviewed} approved.`);
if (emptyLangs.length) w(`No names yet in: ${emptyLangs.map(label).join(", ")} (the Muse run has not been done: \`npx tsx scripts/household-names.ts --sample\`).`);
if (partialLangs.length) w(`Names missing for some items in: ${partialLangs.map(label).join(", ")} (those items speak the English name, in English, until they are made).`);
w();
w("**How to review (about 10 minutes per language):** read each noun aloud. Is it the word a child there uses for this object (a mug, a jigsaw piece, a toy brick)?");
w("Is it singular, or the usual plural for an object that is plural by nature (scissors, pliers, playing cards)? Reply with the corrected word next to the old one.");
w();
const hByText = new Map<string, Array<{ id: string; l: LangCode }>>();
for (const p of present) {
  const k = p.e.w.toLowerCase();
  hByText.set(k, [...(hByText.get(k) ?? []), { id: p.id, l: p.l }]);
}
const hShared = [...hByText.entries()].filter(([, ps]) => new Set(ps.map((p) => p.l)).size > 1);
w("### Household nouns spelled the same in more than one language");
w();
w("The voice is told only the word and picks the language itself (see the section above), so a noun spelled the same in two languages may be spoken with the other");
w("language's accent. The game's device-voice fallback always carries an explicit language tag, which cannot mis-detect.");
w();
if (hShared.length === 0) w("None yet" + (emptyLangs.length ? ` (${emptyLangs.length} language(s) have no names, so this is not the final count)` : "") + ".");
else {
  w(`**${hShared.length} texts** are spelled the same in two or more languages. **Please listen to these and tell us which language and accent you hear:**`);
  w();
  for (const [text, ps] of hShared) w(`- \`${text}\`: ${[...new Set(ps.map((p) => label(p.l)))].join(" + ")} (${[...new Set(ps.map((p) => p.id))].join(", ")})`);
}
w();
for (const lang of langs) {
  w(`### Household names: ${label(lang)} (\`${lang}\`)`);
  w();
  const have = HOUSEHOLD_IDS.filter((id) => nameOf(id, lang));
  if (!have.length) {
    w("_No names yet in this language._");
    w();
    continue;
  }
  w("| Item | English | Name | Review | OK? |");
  w("|---|---|---|---|---|");
  for (const id of HOUSEHOLD_IDS) {
    const e = nameOf(id, lang);
    w(`| ${id} | ${nameOf(id, "en")?.w ?? ""} | ${e ? e.w : "_none yet_"} | ${e ? e.review : ""} | |`);
  }
  w();
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, lines.join("\n") + "\n");
console.log(`wrote ${out} (${lines.length} lines, ${all.length} phrases, ${shared.length} spelled the same in 2+ languages)`);
