import { describe, expect, it } from "vitest";
import {
  COLOR_KEYS, LANGUAGES, NOUN_KEYS, colorKeyFromHex, describeObject, isPropLang, propNoun, propPhrase,
  type ColorKey, type LangCode, type NounKey,
} from "../src/lib/propNames";

const langs = LANGUAGES.map((l) => l.code);

describe("propPhrase: the object and its colour, in the chosen language", () => {
  it("English puts the colour first", () => {
    expect(propPhrase("tree", "green", "en")).toBe("green tree");
    expect(propPhrase("light", "blue", "en")).toBe("blue light");
    expect(propPhrase("blocks", "red", "en")).toBe("red blocks");
    expect(propPhrase("teddy", "brown", "en")).toBe("brown teddy bear");
  });

  it("Spanish, French, Italian and Portuguese put the colour after the noun and agree with its gender", () => {
    expect(propPhrase("tree", "green", "es")).toBe("árbol verde");
    expect(propPhrase("lamp", "blue", "es")).toBe("lámpara azul");
    expect(propPhrase("ball", "red", "es")).toBe("pelota roja"); // feminine
    expect(propPhrase("tree", "red", "es")).toBe("árbol rojo"); // masculine
    expect(propPhrase("lamp", "yellow", "fr")).toBe("lampe jaune");
    expect(propPhrase("light", "blue", "fr")).toBe("lumière bleue"); // feminine
    expect(propPhrase("tree", "blue", "fr")).toBe("arbre bleu"); // masculine
    expect(propPhrase("lamp", "yellow", "it")).toBe("lampada gialla");
    expect(propPhrase("tree", "yellow", "it")).toBe("albero giallo");
    expect(propPhrase("tree", "green", "pt")).toBe("árvore verde");
    expect(propPhrase("ball", "red", "pt")).toBe("bola vermelha");
    expect(propPhrase("drum", "red", "pt")).toBe("tambor vermelho");
  });

  it("plural nouns take plural adjectives", () => {
    expect(propPhrase("blocks", "red", "es")).toBe("bloques rojos");
    expect(propPhrase("cushions", "colorful", "es")).toBe("cojines de colores");
    expect(propPhrase("bushes", "green", "fr")).toBe("buissons verts");
    expect(propPhrase("cushions", "colorful", "fr")).toBe("coussins multicolores");
    expect(propPhrase("cushions", "colorful", "it")).toBe("cuscini colorati");
    expect(propPhrase("cushions", "colorful", "pt")).toBe("almofadas coloridas"); // feminine plural
    expect(propPhrase("blocks", "colorful", "pt")).toBe("blocos coloridos"); // masculine plural
  });

  it("German puts an inflected colour before the noun: masculine, feminine, neuter and plural differ", () => {
    expect(propPhrase("tree", "green", "de")).toBe("grüner Baum");
    expect(propPhrase("lamp", "blue", "de")).toBe("blaue Lampe");
    expect(propPhrase("light", "blue", "de")).toBe("blaues Licht");
    expect(propPhrase("house", "blue", "de")).toBe("blaues Haus");
    expect(propPhrase("bushes", "green", "de")).toBe("grüne Büsche");
    expect(propPhrase("blocks", "colorful", "de")).toBe("bunte Bauklötze");
    expect(propPhrase("ball", "red", "de")).toBe("roter Ball");
    expect(propPhrase("chair", "orange", "de")).toBe("oranger Stuhl");
  });

  it("invariant colours stay put in every form", () => {
    expect(propPhrase("lamp", "orange", "fr")).toBe("lampe orange");
    expect(propPhrase("blocks", "orange", "fr")).toBe("cubes orange");
    expect(propPhrase("chair", "blue", "it")).toBe("sedia blu");
    expect(propPhrase("lamp", "purple", "de")).toBe("lila Lampe");
  });

  it("Turkish puts the colour first and never inflects it for gender or number", () => {
    expect(propPhrase("tree", "green", "tr")).toBe("yeşil ağaç");
    expect(propPhrase("light", "blue", "tr")).toBe("mavi ışık");
    expect(propPhrase("lamp", "yellow", "tr")).toBe("sarı lamba");
    expect(propPhrase("blocks", "red", "tr")).toBe("kırmızı bloklar"); // plural noun, same adjective
    expect(propPhrase("books", "colorful", "tr")).toBe("renkli kitaplar");
    expect(propPhrase("teddy", "brown", "tr")).toBe("kahverengi oyuncak ayı");
    expect(propPhrase("chair", "orange", "tr")).toBe("turuncu sandalye");
    expect(propPhrase("cloud", "white", "tr")).toBe("beyaz bulut");
  });

  it("covers every noun x colour x language with a clean, non-empty phrase", () => {
    for (const lang of langs) {
      for (const noun of NOUN_KEYS) {
        expect(propNoun(noun as NounKey, lang as LangCode).length, `${lang}/${noun} noun`).toBeGreaterThan(1);
        for (const color of COLOR_KEYS) {
          const p = propPhrase(noun as NounKey, color as ColorKey, lang as LangCode);
          expect(p, `${lang}/${noun}/${color}`).toMatch(/^\S.*\S$/);
          expect(p).not.toMatch(/undefined|null|NaN|\s{2,}/);
        }
      }
    }
  });
});

describe("colorKeyFromHex: kid colour words for generated objects", () => {
  it("names the game's own palette", () => {
    expect(colorKeyFromHex("#2fae7e")).toBe("green");
    expect(colorKeyFromHex("#ff5a4d")).toBe("red");
    expect(colorKeyFromHex("#52b7ff")).toBe("blue");
    expect(colorKeyFromHex("#ffd24d")).toBe("yellow");
    expect(colorKeyFromHex("#a78bff")).toBe("purple");
    expect(colorKeyFromHex("#ff9d5c")).toBe("orange");
    expect(colorKeyFromHex("#c98d5a")).toBe("brown");
    expect(colorKeyFromHex("#ffffff")).toBe("white");
    expect(colorKeyFromHex("#10163a")).toBe("black");
    expect(colorKeyFromHex("#262d40")).toBe("black"); // the exploded view's wheels: dark navy reads as black
    expect(colorKeyFromHex("#8a8f96")).toBe("gray");
    expect(colorKeyFromHex("#ff9db0")).toBe("pink");
  });
  it("never throws on garbage", () => {
    expect(colorKeyFromHex("")).toBe("gray");
    expect(colorKeyFromHex("not a colour")).toBe("gray");
  });
});

describe("describeObject: named objects, generated or not", () => {
  it("builds the phrase in the chosen language when the generator picked a noun key", () => {
    expect(describeObject({ noun: "tree", color: "green" }, "es")).toEqual({ text: "árbol verde", lang: "es" });
    expect(describeObject({ noun: "lamp", color: "#ffd24d" }, "fr")).toEqual({ text: "lampe jaune", lang: "fr" });
  });
  it("says just the noun when there is no colour", () => {
    expect(describeObject({ noun: "tree" }, "de")).toEqual({ text: "Baum", lang: "de" });
  });
  it("falls back to English for free text, never a half-translated phrase", () => {
    expect(describeObject({ label: "Spoiler", color: "#ff5a4d" }, "es")).toEqual({ text: "red spoiler", lang: "en" });
    expect(describeObject({ label: "Dragon Wing" }, "fr")).toEqual({ text: "dragon wing", lang: "en" });
  });
  it("says nothing when off or when there is nothing to name", () => {
    expect(describeObject({ noun: "tree", color: "green" }, "off")).toBeNull();
    expect(describeObject({}, "en")).toBeNull();
    expect(describeObject({ label: "  " }, "en")).toBeNull();
  });
});

describe("language validation", () => {
  it("accepts the seven languages and off, nothing else", () => {
    for (const l of [...langs, "off"]) expect(isPropLang(l)).toBe(true);
    for (const bad of ["EN", "ja", "", null, undefined, 3]) expect(isPropLang(bad)).toBe(false);
  });
});
