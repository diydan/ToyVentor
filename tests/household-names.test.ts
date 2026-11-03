// The household names (src/lib/householdNames.json, docs/specs/household-library-spec.md): the words the voice speaks for the 60 library items and the toy
// support tool. English comes from the catalog's label, the other six languages from the Muse model (scripts/household-names.ts); these tests keep the
// file closed over the catalog, every name bare (no article, no colour), and notice an item added to the catalog without a name.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  HOUSEHOLD_IDS, HOUSEHOLD_NAMES, NAME_LANGS, householdName, householdSpeech, householdTextHash, isHouseholdId, spelledInOtherLanguage, type NamesFile,
} from "../src/lib/householdNames";
import { expectedPending, missingNames, validateName, validateNamesFile } from "../src/lib/householdNamesCheck";
import { handleVoice, parseVoiceKey, voiceText } from "../worker/voice";

const root = new URL("..", import.meta.url).pathname;
const catalog = JSON.parse(readFileSync(join(root, "public/kip/household/catalog.json"), "utf8")) as { items: Array<{ id: string; label: string }>; support: Array<{ id: string; label: string }> };
const CATALOG_IDS = [...catalog.items, ...catalog.support].map((r) => r.id);

const entry = (w: string) => ({ w, source: "test", review: "unreviewed" as const });
const fileOf = (names: NamesFile["names"], pending: NamesFile["pending"] = []): NamesFile => ({ version: 1, pending, names });

describe("household names cover the whole catalog", () => {
  it("names exactly the catalog's 60 items and the toy support tool, in catalog order", () => {
    expect(catalog.items).toHaveLength(60);
    expect(catalog.support.map((r) => r.id)).toEqual(["support_tool"]);
    expect([...HOUSEHOLD_IDS]).toEqual(CATALOG_IDS);
  });
  it("English is the catalog's label, lower-cased, unless the entry says it was edited and why", () => {
    for (const r of [...catalog.items, ...catalog.support]) {
      const e = HOUSEHOLD_NAMES.names[r.id]!.en!;
      expect(e, r.id).toBeDefined();
      if (e.source.startsWith("edited:")) expect(e.source.length, `${r.id} edit has no reason`).toBeGreaterThan("edited:".length + 4);
      else {
        expect(e.source, r.id).toBe("catalog");
        expect(e.w, r.id).toBe(r.label.toLowerCase());
      }
    }
    expect(HOUSEHOLD_NAMES.names.soda_can!.en!.w).toBe("soda can"); // the one edit: a lone "can" reads as the verb
  });
  it("every language is either complete or listed as pending: an item added to the catalog without a name is caught", () => {
    expect(missingNames(HOUSEHOLD_NAMES, CATALOG_IDS).filter((m) => m.lang === "en")).toEqual([]);
    expect(HOUSEHOLD_NAMES.pending).toEqual(expectedPending(HOUSEHOLD_NAMES, CATALOG_IDS));
    for (const lang of NAME_LANGS.filter((l) => l !== "en" && !HOUSEHOLD_NAMES.pending.includes(l))) {
      expect(missingNames(HOUSEHOLD_NAMES, CATALOG_IDS).filter((m) => m.lang === lang), `${lang} is not pending but has gaps`).toEqual([]);
    }
  });
  it("the pending check notices a new item, and a stale pending list", () => {
    const complete: NamesFile = fileOf({ ball: Object.fromEntries(NAME_LANGS.map((l) => [l, entry("x" + l)])) as NamesFile["names"][string] });
    expect(expectedPending(complete, ["ball"])).toEqual([]);
    expect(expectedPending(complete, ["ball", "mug"])).toEqual(NAME_LANGS.filter((l) => l !== "en")); // "mug" has no name in any language
    expect(missingNames(complete, ["ball", "mug"]).map((m) => m.id)).toEqual(Array(NAME_LANGS.length).fill("mug"));
    const onlyEnglish = fileOf({ ball: { en: entry("ball") } }, ["es", "fr", "de", "it", "pt", "tr"]);
    expect(expectedPending(onlyEnglish, ["ball"])).toEqual(["es", "fr", "de", "it", "pt", "tr"]);
  });
  it("the committed file passes every rule", () => {
    expect(validateNamesFile(HOUSEHOLD_NAMES)).toEqual([]);
  });
});

describe("what a name may be", () => {
  const bad: Array<[string, string, string, RegExp]> = [
    ["an article", "es", "la cuchara", /starts with an article/],
    ["an elided article", "fr", "l'orange", /starts with an article/],
    ["an English article", "en", "the spoon", /starts with an article/],
    ["a German article", "de", "Der Löffel", /starts with an article/],
    ["a Portuguese article", "pt", "o garfo", /starts with an article/],
    ["a Turkish 'bir'", "tr", "bir kaşık", /starts with an article/],
    ["a colour beside the noun", "en", "red mug", /names a colour \(red\)/],
    ["a Spanish colour after the noun", "es", "taza roja", /names a colour \(roja\)/],
    ["a German colour before the noun", "de", "blaue Tasse", /names a colour/],
    ["more than three words", "en", "big old wooden spoon", /one to three words/],
    ["a digit", "en", "mug2", /one to three words/],
    ["punctuation", "en", "mug!", /one to three words/],
    ["a trailing space", "en", "mug ", /one to three words|untrimmed/],
    ["a capital", "es", "Taza", /lower case/],
    ["shouting German", "de", "TASSE", /shouting/],
    ["a brand", "en", "frisbee", /brand name/],
    ["another brand", "it", "scotch", /brand name/],
    ["a kid-unsafe word", "en", "knife", /not kid-safe/],
    ["empty", "en", "", /characters/],
    ["too long", "en", "a".repeat(41), /characters/],
    ["emoji", "en", "mug 🙂", /one to three words/],
  ];
  it.each(bad)("refuses %s", (_name, lang, w, expected) => {
    expect(validateName(lang as never, w).join("; ")).toMatch(expected);
  });
  it("accepts good bare nouns, including a colour word that IS the noun, German capitals, accents and Turkish letters", () => {
    for (const [lang, w] of [
      ["en", "orange"], ["en", "yo-yo"], ["en", "wooden spoon"], ["en", "pliers"], ["es", "naranja"], ["es", "cuchara de madera"], ["fr", "cuillère"],
      ["fr", "ananas"], ["de", "Löffel"], ["de", "Holzlöffel"], ["it", "cucchiaio"], ["pt", "colher de pau"], ["tr", "kaşık"], ["tr", "ışık"],
    ] as const) expect(validateName(lang, w), `${lang} ${w}`).toEqual([]);
  });
  it("is not fooled by an article-like word that is not first, or a noun that merely starts like one", () => {
    expect(validateName("es", "taza la")).toEqual([]); // 'la' is only an article at the start of a name
    expect(validateName("es", "caja de lápices")).toEqual([]); // 'de' is not a colour (it comes from "de colores")
    expect(validateName("en", "apple")).toEqual([]); // starts with a
    expect(validateName("it", "lampada")).toEqual([]); // starts with l
  });
  it("catches two items sharing a noun in one language (the voice and the review sheet could not tell them apart), but not across languages", () => {
    const dup = fileOf({ ball: { en: entry("ball"), es: entry("pelota") }, marble: { en: entry("marble"), es: entry("Pelota".toLowerCase()) } });
    expect(validateNamesFile(dup).join("\n")).toMatch(/es: "pelota" names both ball and marble/);
    const across = fileOf({ ball: { en: entry("ball"), pt: entry("bola") }, banana: { en: entry("banana"), pt: entry("banana") }, plantain: { en: entry("plantain"), es: entry("banana") } });
    expect(validateNamesFile(across)).toEqual([]);
  });
  it("catches a malformed file", () => {
    expect(validateNamesFile({ version: 2 as never, pending: ["en" as never], names: {} }).join("\n")).toMatch(/version 2 is not 1[\s\S]*pending must list/);
    expect(validateNamesFile(fileOf({ Ball: { en: entry("ball") } })).join("\n")).toMatch(/bad id Ball/);
    expect(validateNamesFile(fileOf({ ball: { xx: entry("ball") } as never })).join("\n")).toMatch(/unknown language/);
    expect(validateNamesFile(fileOf({ ball: { en: { w: "ball", source: "", review: "unreviewed" } } })).join("\n")).toMatch(/no source/);
    expect(validateNamesFile(fileOf({ ball: { en: { w: "ball", source: "x", review: "maybe" as never } } })).join("\n")).toMatch(/review maybe/);
    expect(validateNamesFile(fileOf({ ball: { en: { w: 5 as never, source: "x", review: "unreviewed" } } })).join("\n")).toMatch(/not a string/);
  });
});

describe("looking a name up", () => {
  const demo = fileOf({ spoon: { en: entry("spoon"), es: entry("cuchara") }, bare: { en: entry("bare") } }, ["fr", "de", "it", "pt", "tr"]);
  it("returns the name in a language, or null when that language has none yet", () => {
    expect(householdName("spoon", "es", demo)).toBe("cuchara");
    expect(householdName("spoon", "fr", demo)).toBeNull();
    expect(householdName("nope", "en", demo)).toBeNull();
  });
  it("speaks the chosen language, else the English name in English (never a guessed translation)", () => {
    expect(householdSpeech("spoon", "es", demo)).toEqual({ text: "cuchara", lang: "es" });
    expect(householdSpeech("spoon", "fr", demo)).toEqual({ text: "spoon", lang: "en" });
    expect(householdSpeech("bare", "tr", demo)).toEqual({ text: "bare", lang: "en" });
    expect(householdSpeech("nope", "en", demo)).toBeNull();
    expect(householdSpeech("ball", "en")).toEqual({ text: "ball", lang: "en" }); // the real file
  });
  it("knows its ids and refuses anything that is not one, including object-prototype names", () => {
    expect(isHouseholdId("wooden_spoon")).toBe(true);
    expect(isHouseholdId("support_tool")).toBe(true);
    for (const bad of ["", "spoon ", "constructor", "__proto__", "toString", "hasOwnProperty", "WOODEN_SPOON", null, undefined, 7, {}]) expect(isHouseholdId(bad), String(bad)).toBe(false);
    expect(householdName("constructor", "en")).toBeNull();
    expect(householdName("__proto__", "en")).toBeNull();
  });
  it("fingerprints a text: stable, 8 hex digits, different for a changed word, the same for the same word in a different Unicode form", () => {
    expect(householdTextHash("cuchara")).toMatch(/^[0-9a-f]{8}$/);
    expect(householdTextHash("cuchara")).toBe(householdTextHash("cuchara"));
    expect(householdTextHash("cuchara")).not.toBe(householdTextHash("cucharas"));
    expect(householdTextHash("kaşık")).not.toBe(householdTextHash("kasik"));
    expect(householdTextHash("cuillère")).toBe(householdTextHash("cuillère".normalize("NFD").normalize("NFC")));
    expect(householdTextHash("")).toBe("811c9dc5"); // FNV-1a's offset basis: pins the algorithm
    expect(householdTextHash("a")).toBe("e40c292c"); // and a known FNV-1a value
  });
});

describe("the voice route speaks exactly the names the file has", () => {
  it("every (item, language) pair with a name parses to a key whose text is that name, and every pair without one is a 404, never a model call", async () => {
    let calls = 0;
    const env = { AI: { run: async () => { calls++; throw new Error("must not be called for a missing name"); } } };
    for (const id of HOUSEHOLD_IDS) for (const lang of NAME_LANGS) {
      const url = new URL(`https://x/api/voice?lang=${lang}&h=${id}`);
      const key = parseVoiceKey(url);
      expect(key, `${lang}/${id}`).not.toBeNull();
      const name = householdName(id, lang);
      if (name) expect(voiceText(key!), `${lang}/${id}`).toBe(name);
      else expect((await handleVoice(new Request(url), env)).status, `${lang}/${id} has no name`).toBe(404);
    }
    expect(calls).toBe(0);
  });
});

describe("the native-review sheet (docs/review/spoken-names.md)", () => {
  it("has an up-to-date household section: regenerate with `npx tsx scripts/spoken-names-sheet.ts` after changing src/lib/householdNames.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "spoken-names-"));
    try {
      const fresh = join(dir, "sheet.md");
      execFileSync("npx", ["tsx", "scripts/spoken-names-sheet.ts"], { cwd: root, env: { ...process.env, SPOKEN_NAMES_OUT: fresh }, encoding: "utf8", timeout: 120_000 });
      const section = (t: string) => t.slice(t.indexOf("## Household names"));
      const committed = readFileSync(join(root, "docs/review/spoken-names.md"), "utf8");
      expect(committed).toContain("## Household names");
      expect(section(committed)).toBe(section(readFileSync(fresh, "utf8")));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
  it("states the state of the names truthfully: how many exist, how many are unreviewed, and which languages have none yet", () => {
    const committed = readFileSync(join(root, "docs/review/spoken-names.md"), "utf8");
    const pairs = HOUSEHOLD_IDS.flatMap((id) => NAME_LANGS.filter((l) => HOUSEHOLD_NAMES.names[id]![l]).map((l) => HOUSEHOLD_NAMES.names[id]![l]!));
    const unreviewed = pairs.filter((p) => p.review === "unreviewed").length;
    expect(committed).toContain(`${HOUSEHOLD_IDS.length} items x ${NAME_LANGS.length} languages = ${HOUSEHOLD_IDS.length * NAME_LANGS.length} names; ${pairs.length} exist, ${unreviewed} unreviewed, ${pairs.length - unreviewed} approved.`);
    for (const l of HOUSEHOLD_NAMES.pending) if (!HOUSEHOLD_IDS.some((id) => HOUSEHOLD_NAMES.names[id]![l])) expect(committed).toMatch(new RegExp(`No names yet in:[^\\n]*`));
  });
});

describe("nouns spelled the same in another language (the clip voice might use the wrong accent, so the device voice says them)", () => {
  const spellings = (file: NamesFile) => {
    const by = new Map<string, Set<string>>();
    for (const entry of Object.values(file.names)) for (const [lang, e] of Object.entries(entry)) {
      const k = e!.w.normalize("NFC").toLowerCase();
      by.set(k, (by.get(k) ?? new Set()).add(lang));
    }
    return by;
  };

  it("compares spellings ignoring case, and only across languages: the same word twice in one language is not a collision", () => {
    const f = fileOf({ a: { en: entry("ball"), de: entry("Ball"), es: entry("pelota") }, b: { es: entry("pelota") } }); // pelota twice, both Spanish
    expect(spelledInOtherLanguage("ball", "en", f)).toBe(true);
    expect(spelledInOtherLanguage("Ball", "de", f)).toBe(true);
    expect(spelledInOtherLanguage("pelota", "es", f)).toBe(false);
    expect(spelledInOtherLanguage("nothing here", "en", f)).toBe(false);
  });

  it("finds exactly the texts the review sheet lists, in the real file: 22 spellings, 49 (item, language) pairs, none of them in a single language", () => {
    const by = spellings(HOUSEHOLD_NAMES);
    const colliding = [...by].filter(([, langs]) => langs.size > 1);
    expect(colliding.length).toBe(22);
    let pairs = 0;
    for (const [id, entry] of Object.entries(HOUSEHOLD_NAMES.names)) for (const lang of Object.keys(entry) as (typeof NAME_LANGS)[number][]) {
      const expected = by.get(HOUSEHOLD_NAMES.names[id]![lang]!.w.normalize("NFC").toLowerCase())!.size > 1;
      expect(spelledInOtherLanguage(HOUSEHOLD_NAMES.names[id]![lang]!.w, lang), `${lang}/${id}`).toBe(expected);
      if (expected) pairs++;
    }
    expect(pairs).toBe(49);
    const sheet = readFileSync(join(root, "docs/review/spoken-names.md"), "utf8");
    for (const [text] of colliding) expect(sheet, `the sheet lists ${text}`).toContain(`\`${text}\``);
    for (const [id, lang] of [["banana", "en"], ["banana", "it"], ["banana", "pt"], ["ball", "de"], ["flask", "es"], ["soda_can", "pt"]] as const)
      expect(spelledInOtherLanguage(householdName(id, lang)!, lang), `${lang}/${id}`).toBe(true);
    for (const [id, lang] of [["banana", "tr"], ["wooden_spoon", "en"], ["soap", "pt"], ["jigsaw", "es"]] as const)
      expect(spelledInOtherLanguage(householdName(id, lang)!, lang), `${lang}/${id}`).toBe(false);
  });
});
