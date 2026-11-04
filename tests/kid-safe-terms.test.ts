/**
 * shared/kidSafeTerms.ts: the unsafe-term check in seven languages. Three jobs for these tests: nothing a child could harmlessly type is refused (the fixture, in all seven
 * languages, because a wish's language is not known), the words the product refuses are still refused in every language, and the known limits are written down as tests.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileEntries, foldText, turkishText, unleet } from "../shared/kidSafeNormalize";
import { AGE_TERMS, REVIEW_STATE, TERM_COUNTS, TERM_LANGS, containsUnsafeTerm, findUnsafeTerm } from "../shared/kidSafeTerms";
import { SEVERE_TERMS } from "../shared/kidSafeTermsSevere";
import { kidSafeText } from "../worker/muse";

const WISHES = JSON.parse(readFileSync(join(__dirname, "fixtures", "kid-wishes.json"), "utf8")) as Record<string, string | string[]>;
const harmless = TERM_LANGS.flatMap((l) => (Array.isArray(WISHES[l]) ? (WISHES[l] as string[]).map((w) => [l, w] as const) : []));

describe("English: the list the product already used, unchanged", () => {
  // the regex that was in worker/muse.ts until 2026-11-04
  const OLD = /\b(scary|haunt\w*|horror|nightmare\w*|kill\w*|dead|death|blood\w*|gun|guns|knife|knives|weapon\w*|hate\w*|naked|nude|sexy|drug\w*|beer|wine|vodka|cigarette\w*)\b|\bwar\b/i;
  const samples = [
    "a scary monster head", "haunted house hat", "horror hat", "nightmares", "kill the dragon", "killing time", "dead tree", "death star", "blood moon", "bloody hat", "a gun", "two guns",
    "a knife", "knives", "weapons", "a weapon hat", "i hate it", "hateful", "naked mole rat", "nude", "sexy hat", "drugs", "a drug", "beer hat", "wine glass", "vodka", "cigarettes",
    "war hat", "the war", "a wizard hat", "a pirate hat", "a dragon head", "a sword", "warrior helmet", "software", "swarm of bees", "scarecrow", "gunner", "deadline", "knifey", "wines",
    "BLOOD", "Scary", "a hat with a gun", "a hat, no weapons", "warm hat", "award hat", "a deadly hat",
  ];
  it("the English list alone agrees with the old regex on every sample, in both directions", () => {
    const EN = compileEntries(AGE_TERMS.en, foldText)!;
    for (const s of samples) expect({ s, en: EN.test(foldText(s)) }).toEqual({ s, en: OLD.test(s) });
  });
  it("catches every old term that the old regex caught (and only the other six languages may add to it)", () => {
    for (const s of samples.filter((x) => OLD.test(x))) expect(findUnsafeTerm(s, ["age"])?.tier, s).toBe("age");
    for (const s of samples.filter((x) => !OLD.test(x))) {
      const hit = findUnsafeTerm(s, ["age"]);
      expect(hit === null || hit.lang !== "en", `${s} -> ${JSON.stringify(hit)}`).toBe(true);
    }
  });
});

describe("nothing a child could harmlessly type is refused, in any language", () => {
  it(`passes all ${harmless.length} harmless wishes in the fixture (each is checked against all seven languages' lists)`, () => {
    const refused = harmless.map(([l, w]) => ({ l, w, hit: findUnsafeTerm(w) })).filter((r) => r.hit !== null);
    expect(refused).toEqual([]);
  });
  it("covers every language, with the traps in it", () => {
    for (const l of TERM_LANGS) expect((WISHES[l] as string[]).length, l).toBeGreaterThanOrEqual(30);
    const all = harmless.map(([, w]) => w).join(" | ");
    for (const trap of ["negro", "bitte", "mamá", "comer", "regina", "aranha", "gueule", "Scunthorpe", "poof", "sık sık", "ÇAY", "heroína", "cockatoo", "class"]) expect(all.toLowerCase()).toContain(trap.toLowerCase());
  });
  it("is the same through kidSafeText, the function every route calls", () => {
    for (const [, w] of harmless) expect(kidSafeText(w), w).toBe(true);
  });
});

describe("what the product refuses is refused in every language", () => {
  const age: Record<string, string[]> = {
    en: ["a knife", "scary hat", "a gun"],
    es: ["un cuchillo", "una pistola", "da miedo", "una cerveza", "la guerra", "sangre"],
    fr: ["un couteau", "un pistolet", "de la bière", "la guerre", "du sang", "c'est effrayant"],
    de: ["ein Messer", "eine Pistole", "ein Bier", "der Krieg", "Blut", "ganz gruselig"],
    it: ["un coltello", "una pistola", "una birra", "la guerra", "il sangue", "fa paura? spaventoso"],
    pt: ["uma faca", "uma pistola", "uma cerveja", "a guerra", "sangue", "muito assustador"],
    tr: ["bir bıçak", "bir silah", "bira", "savaş", "korkunç bir şapka", "ÖLDÜR"],
  };
  for (const [lang, list] of Object.entries(age)) {
    it(`${lang}: age-fit words`, () => {
      for (const s of list) expect(findUnsafeTerm(s, ["age"]), s).not.toBeNull();
    });
  }
  const severe = ["fuck", "merde", "scheiße", "merda", "mierda", "siktir"];
  it("obscenities in each language", () => {
    for (const s of severe) expect(findUnsafeTerm(s, ["severe"]), s).not.toBeNull();
  });
  it("a harmful word inside a longer harmless wish still refuses it", () => {
    for (const s of ["a wizard hat with a knife", "un sombrero con un cuchillo", "ein Hut mit einem Messer", "bıçaklı bir şapka", "a pirate hat, merde"]) expect(containsUnsafeTerm(s), s).toBe(true);
  });
  it("reports which language and tier, for a reviewer", () => {
    expect(findUnsafeTerm("ein Messer")).toMatchObject({ lang: "de", tier: "age" });
    expect(findUnsafeTerm("bir bıçak")).toMatchObject({ lang: "tr", tier: "age" });
  });
});

describe("how text is compared", () => {
  it("is not fooled by case, accents, full-width letters or invisible characters", () => {
    for (const s of ["CUCHILLO", "Cuchillo", "cuchíllo".replace("í", "i"), "ＫＩＬＬ", "kil​l", "k­ill", "KILL", "bì̈ère"]) {
      expect(findUnsafeTerm(s), s).not.toBeNull();
    }
  });
  it("reads digits and symbols as letters in a second look: k1ll, n4ked, w4r, sh!t", () => {
    for (const s of ["k1ll", "n4ked", "w4r", "sh!t", "$exy"]) expect(findUnsafeTerm(s), s).not.toBeNull();
    expect(unleet("k1ll")).toBe("kill");
    expect(findUnsafeTerm("a 4 star hat")).toBeNull(); // digits that are only digits are not words
  });
  it("uses Unicode-aware word boundaries: \\b does not know ç, ş or é", () => {
    expect(/\bçay\b/.test("bir çay")).toBe(false); // the trap
    expect(compileEntries(["çay"], turkishText)!.test(turkishText("bir çay"))).toBe(true);
    expect(compileEntries(["café"], foldText)!.test(foldText("un café noir"))).toBe(true);
  });
  it("matches whole words, so a harmless word that merely contains a bad one passes (Scunthorpe)", () => {
    for (const s of ["class", "assistant", "Scunthorpe", "cocktail", "classic", "grassland", "bassoon", "passage", "title", "Essex", "button", "document"]) expect(findUnsafeTerm(s), s).toBeNull();
  });
  it("Turkish keeps its letters: sık is not sik, ölü is not olu, and IŞIK reads as ışık", () => {
    expect(turkishText("IŞIK")).toBe("ışık");
    expect(turkishText("İSTANBUL")).toBe("istanbul");
    expect(foldText("İSTANBUL")).toBe("istanbul");
    expect(findUnsafeTerm("sık sık")).toBeNull();
    expect(findUnsafeTerm("SIK SIK")).toBeNull();
    expect(findUnsafeTerm("sıkıntı")).toBeNull();
    expect(findUnsafeTerm("siktir")).not.toBeNull();
    expect(findUnsafeTerm("ölü")).not.toBeNull();
    expect(findUnsafeTerm("olu")).toBeNull();
    expect(findUnsafeTerm("ÖLDÜR")).not.toBeNull();
  });
  it("German ß and umlauts fold the way people type them", () => {
    expect(foldText("Straße")).toBe("strasse");
    expect(findUnsafeTerm("MÖRDER")).not.toBeNull();
    expect(findUnsafeTerm("Moerder")).toBeNull(); // known limit: oe for ö is not folded
  });
});

describe("known limits, written down so nobody assumes more than is there", () => {
  it("letters spaced apart, glued words and other misspellings are not caught", () => {
    expect(findUnsafeTerm("k i l l")).toBeNull();
    expect(findUnsafeTerm("killl")).not.toBeNull(); // 'kill*' takes any letters after it
    expect(findUnsafeTerm("kyll")).toBeNull();
    expect(findUnsafeTerm("a knifehat")).toBeNull();
  });
  it("it catches words, not meaning", () => {
    expect(findUnsafeTerm("a hat that hurts people")).toBeNull();
    expect(findUnsafeTerm("a sword and a shield")).toBeNull(); // 'sword' was never on the English list; a policy decision, not a bug
  });
  it("a language outside the seven is not covered", () => {
    expect(findUnsafeTerm("sebuah pisau")).toBeNull(); // Indonesian for 'a knife'
  });
  it("Turkish typed without its special letters is not caught (the price of not refusing sık)", () => {
    expect(findUnsafeTerm("bicak")).toBeNull();
    expect(findUnsafeTerm("bıçak")).not.toBeNull();
  });
});

describe("the data", () => {
  it("has a list for every language and tier, all non-empty", () => {
    for (const l of TERM_LANGS) {
      expect(TERM_COUNTS[l].age, `${l} age`).toBeGreaterThan(15);
      expect(TERM_COUNTS[l].severe, `${l} severe`).toBeGreaterThan(40);
    }
  });
  it("has no empty entry, and no single word shorter than 4 letters on a severe list (the cross-language collisions)", () => {
    for (const l of TERM_LANGS) {
      for (const e of SEVERE_TERMS[l]) {
        expect(e.trim().length, `${l}:${e}`).toBeGreaterThan(0);
        if (!e.includes(" ")) expect((e.match(/\p{L}/gu) ?? []).length, `${l}:${e}`).toBeGreaterThanOrEqual(4);
      }
      for (const e of AGE_TERMS[l]) expect(e.trim().length, `${l} age:${e}`).toBeGreaterThan(0);
    }
  });
  it("keeps the obscenities and slurs an exception list must never contain", () => {
    const en = new Set(SEVERE_TERMS.en as readonly string[]);
    for (const must of ["fuck", "shit", "bitch", "cunt", "nigger", "faggot", "porn", "rape", "pussy"]) expect(en.has(must), must).toBe(true);
    expect(new Set(SEVERE_TERMS.de as readonly string[]).has("arschloch")).toBe(true);
    expect(new Set(SEVERE_TERMS.it as readonly string[]).has("cazzo")).toBe(true);
  });
  it("names who has read each list; only English age-fit is the team's, and no non-English list has had a native read", () => {
    expect(REVIEW_STATE.en.age).toBe("team");
    for (const l of TERM_LANGS.filter((x) => x !== "en")) expect(REVIEW_STATE[l].age, l).toBe("none");
    for (const l of TERM_LANGS) expect(["team", "author", "none"]).toContain(REVIEW_STATE[l].severe);
  });
  it("carries the attribution its licence requires", () => {
    const src = readFileSync(join(__dirname, "..", "shared", "kidSafeTermsSevere.ts"), "utf8");
    expect(src).toContain("CC BY 4.0");
    expect(src).toContain("LDNOOBW");
    expect(src).toContain("github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words");
  });
});

describe("a text with nothing in it", () => {
  it("is not unsafe", () => {
    for (const s of ["", " ", "\n"]) expect(findUnsafeTerm(s)).toBeNull();
    expect(findUnsafeTerm(undefined as never)).toBeNull();
  });
});
