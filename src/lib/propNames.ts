// What the game says when a kid taps an object: "green tree", "arbre vert", "grüner Baum".
// Pure data + one phrase builder, no DOM. Every object has a NOUN from a small controlled vocabulary and a COLOR from a
// small controlled palette, so the phrase is built (not translated) and the adjective agrees with the noun (gender and
// number): "árbol verde" but "lámpara azul", "bloques rojos" but "almohadas rojas", "grüner Baum" but "blaue Lampe".
//
// Anything generated (Muse recipes, Forge parts, Describe & Build) names itself by picking a noun key and a colour key
// from here; free text it cannot map falls back to English (see describeObject), never to a half-translated phrase.

export type LangCode = "en" | "es" | "fr" | "de" | "it" | "pt" | "tr";
export type PropLang = LangCode | "off";

export interface LanguageInfo {
  code: LangCode;
  /** The language's own name, shown in the picker. */
  label: string;
  /** BCP-47 tag handed to speech synthesis. */
  bcp47: string;
}

export const LANGUAGES: readonly LanguageInfo[] = [
  { code: "en", label: "English", bcp47: "en-US" },
  { code: "es", label: "Español", bcp47: "es-ES" },
  { code: "fr", label: "Français", bcp47: "fr-FR" },
  { code: "de", label: "Deutsch", bcp47: "de-DE" },
  { code: "it", label: "Italiano", bcp47: "it-IT" },
  { code: "pt", label: "Português", bcp47: "pt-BR" },
  { code: "tr", label: "Türkçe", bcp47: "tr-TR" },
];

export const COLOR_KEYS = ["red", "orange", "yellow", "green", "blue", "purple", "pink", "brown", "white", "black", "gray", "colorful"] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];

type Gender = "m" | "f" | "n";
export interface Noun {
  w: string;
  g: Gender;
  /** The noun is a plural in this language ("blocks", "Bücher"), so the adjective takes its plural form. */
  pl?: boolean;
}

/** The controlled vocabulary: every scene prop the game can build. Generated objects pick from this list too. */
export const NOUN_KEYS = [
  "light", "lamp", "house", "tree", "bushes", "cloud", "island", "tire", "drum", "shed", "crane", "windmill", "palm", "umbrella",
  "sandcastle", "pine", "snowman", "igloo", "blocks", "books", "chair", "plant", "teddy", "ball", "cushions", "bed", "guitar", "bubbles", "dog", "xylophone",
  // Fruit (docs/specs/playful-interactions-spec.md section 3): what a tapped apple says ("red apple"). A fruit is a prop now.
  "apple", "pear", "orange", "lemon", "cherries", "banana", "plum", "strawberry", "blueberries", "coconut", "pumpkin",
] as const;
export type NounKey = (typeof NOUN_KEYS)[number];

const m = (w: string): Noun => ({ w, g: "m" });
const f = (w: string): Noun => ({ w, g: "f" });
const n = (w: string): Noun => ({ w, g: "n" });
const mp = (w: string): Noun => ({ w, g: "m", pl: true });
const fp = (w: string): Noun => ({ w, g: "f", pl: true });
const np = (w: string): Noun => ({ w, g: "n", pl: true });

const NOUNS: Record<LangCode, Record<NounKey, Noun>> = {
  en: {
    light: m("light"), lamp: m("lamp"), house: m("house"), tree: m("tree"), bushes: mp("bushes"), cloud: m("cloud"), island: m("island"),
    tire: m("tire"), drum: m("drum"), shed: m("shed"), crane: m("crane"), windmill: m("windmill"), palm: m("palm tree"), umbrella: m("umbrella"),
    sandcastle: m("sandcastle"), pine: m("pine tree"), snowman: m("snowman"), igloo: m("igloo"), blocks: mp("blocks"), books: mp("books"),
    chair: m("chair"), plant: m("plant"), teddy: m("teddy bear"), ball: m("ball"), cushions: mp("cushions"), bed: m("bed"), guitar: m("guitar"), bubbles: mp("bubbles"), dog: m("dog"), xylophone: m("xylophone"),
    apple: m("apple"), pear: m("pear"), orange: m("orange"), lemon: m("lemon"), cherries: mp("cherries"), banana: m("banana"), plum: m("plum"),
    strawberry: m("strawberry"), blueberries: mp("blueberries"), coconut: m("coconut"), pumpkin: m("pumpkin"),
  },
  es: {
    light: f("luz"), lamp: f("lámpara"), house: f("casa"), tree: m("árbol"), bushes: mp("arbustos"), cloud: f("nube"), island: f("isla"),
    tire: m("neumático"), drum: m("tambor"), shed: m("cobertizo"), crane: f("grúa"), windmill: m("molino"), palm: f("palmera"), umbrella: f("sombrilla"),
    sandcastle: m("castillo de arena"), pine: m("pino"), snowman: m("muñeco de nieve"), igloo: m("iglú"), blocks: mp("bloques"), books: mp("libros"),
    chair: f("silla"), plant: f("planta"), teddy: m("osito de peluche"), ball: f("pelota"), cushions: mp("cojines"), bed: f("cama"), guitar: f("guitarra"), bubbles: fp("burbujas"), dog: m("perro"), xylophone: m("xilófono"),
    apple: f("manzana"), pear: f("pera"), orange: f("naranja"), lemon: m("limón"), cherries: fp("cerezas"), banana: m("plátano"), plum: f("ciruela"),
    strawberry: f("fresa"), blueberries: mp("arándanos"), coconut: m("coco"), pumpkin: f("calabaza"),
  },
  fr: {
    light: f("lumière"), lamp: f("lampe"), house: f("maison"), tree: m("arbre"), bushes: mp("buissons"), cloud: m("nuage"), island: f("île"),
    tire: m("pneu"), drum: m("tambour"), shed: f("cabane"), crane: f("grue"), windmill: m("moulin"), palm: m("palmier"), umbrella: m("parasol"),
    sandcastle: m("château de sable"), pine: m("sapin"), snowman: m("bonhomme de neige"), igloo: m("igloo"), blocks: mp("cubes"), books: mp("livres"),
    chair: f("chaise"), plant: f("plante"), teddy: m("nounours"), ball: m("ballon"), cushions: mp("coussins"), bed: m("lit"), guitar: f("guitare"), bubbles: fp("bulles"), dog: m("chien"), xylophone: m("xylophone"),
    apple: f("pomme"), pear: f("poire"), orange: f("orange"), lemon: m("citron"), cherries: fp("cerises"), banana: f("banane"), plum: f("prune"),
    strawberry: f("fraise"), blueberries: fp("myrtilles"), coconut: f("noix de coco"), pumpkin: f("citrouille"),
  },
  de: {
    light: n("Licht"), lamp: f("Lampe"), house: n("Haus"), tree: m("Baum"), bushes: np("Büsche"), cloud: f("Wolke"), island: f("Insel"),
    tire: m("Reifen"), drum: f("Trommel"), shed: m("Schuppen"), crane: m("Kran"), windmill: f("Windmühle"), palm: f("Palme"), umbrella: m("Sonnenschirm"),
    sandcastle: f("Sandburg"), pine: f("Tanne"), snowman: m("Schneemann"), igloo: m("Iglu"), blocks: np("Bauklötze"), books: np("Bücher"),
    chair: m("Stuhl"), plant: f("Pflanze"), teddy: m("Teddybär"), ball: m("Ball"), cushions: np("Kissen"), bed: n("Bett"), guitar: f("Gitarre"), bubbles: np("Seifenblasen"), dog: m("Hund"), xylophone: n("Xylophon"),
    apple: m("Apfel"), pear: f("Birne"), orange: f("Orange"), lemon: f("Zitrone"), cherries: np("Kirschen"), banana: f("Banane"), plum: f("Pflaume"),
    strawberry: f("Erdbeere"), blueberries: np("Blaubeeren"), coconut: f("Kokosnuss"), pumpkin: m("Kürbis"),
  },
  it: {
    light: f("luce"), lamp: f("lampada"), house: f("casa"), tree: m("albero"), bushes: mp("cespugli"), cloud: f("nuvola"), island: f("isola"),
    tire: f("gomma"), drum: m("tamburo"), shed: m("capanno"), crane: f("gru"), windmill: m("mulino"), palm: f("palma"), umbrella: m("ombrellone"),
    sandcastle: m("castello di sabbia"), pine: m("pino"), snowman: m("pupazzo di neve"), igloo: m("igloo"), blocks: mp("blocchi"), books: mp("libri"),
    chair: f("sedia"), plant: f("pianta"), teddy: m("orsacchiotto"), ball: f("palla"), cushions: mp("cuscini"), bed: m("letto"), guitar: f("chitarra"), bubbles: fp("bolle di sapone"), dog: m("cane"), xylophone: m("xilofono"),
    apple: f("mela"), pear: f("pera"), orange: f("arancia"), lemon: m("limone"), cherries: fp("ciliegie"), banana: f("banana"), plum: f("prugna"),
    strawberry: f("fragola"), blueberries: mp("mirtilli"), coconut: f("noce di cocco"), pumpkin: f("zucca"),
  },
  pt: {
    light: f("luz"), lamp: f("luminária"), house: f("casa"), tree: f("árvore"), bushes: mp("arbustos"), cloud: f("nuvem"), island: f("ilha"),
    tire: m("pneu"), drum: m("tambor"), shed: m("galpão"), crane: m("guindaste"), windmill: m("moinho"), palm: f("palmeira"), umbrella: m("guarda-sol"),
    sandcastle: m("castelo de areia"), pine: m("pinheiro"), snowman: m("boneco de neve"), igloo: m("iglu"), blocks: mp("blocos"), books: mp("livros"),
    chair: f("cadeira"), plant: f("planta"), teddy: m("ursinho de pelúcia"), ball: f("bola"), cushions: fp("almofadas"), bed: f("cama"), guitar: m("violão"), bubbles: fp("bolhas de sabão"), dog: m("cachorro"), xylophone: m("xilofone"),
    apple: f("maçã"), pear: f("pera"), orange: f("laranja"), lemon: m("limão"), cherries: fp("cerejas"), banana: f("banana"), plum: f("ameixa"),
    strawberry: m("morango"), blueberries: mp("mirtilos"), coconut: m("coco"), pumpkin: f("abóbora"),
  },
  tr: {
    light: m("ışık"), lamp: m("lamba"), house: m("ev"), tree: m("ağaç"), bushes: mp("çalılar"), cloud: m("bulut"), island: m("ada"),
    tire: m("lastik"), drum: m("davul"), shed: m("kulübe"), crane: m("vinç"), windmill: m("yel değirmeni"), palm: m("palmiye"), umbrella: m("şemsiye"),
    sandcastle: m("kumdan kale"), pine: m("çam ağacı"), snowman: m("kardan adam"), igloo: m("iglu"), blocks: mp("bloklar"), books: mp("kitaplar"),
    chair: m("sandalye"), plant: m("bitki"), teddy: m("oyuncak ayı"), ball: m("top"), cushions: mp("yastıklar"), bed: m("yatak"), guitar: m("gitar"), bubbles: mp("baloncuklar"), dog: m("köpek"), xylophone: m("ksilofon"),
    apple: m("elma"), pear: m("armut"), orange: m("portakal"), lemon: m("limon"), cherries: mp("kirazlar"), banana: m("muz"), plum: m("erik"),
    strawberry: m("çilek"), blueberries: mp("yaban mersinleri"), coconut: m("hindistan cevizi"), pumpkin: m("balkabağı"),
  },
};

// Adjective forms. en: one word. es/fr/it/pt: [masc, fem, masc-plural, fem-plural], placed AFTER the noun. de: [masc, fem, neut, plural]
// (strong declension, nominative, no article: "grüner Baum", "grüne Lampe", "grünes Haus", "grüne Büsche"), placed BEFORE the noun.
type Forms = readonly [string, string, string, string];
const same = (w: string): Forms => [w, w, w, w];
const COLORS: Record<LangCode, Record<ColorKey, string | Forms>> = {
  en: { red: "red", orange: "orange", yellow: "yellow", green: "green", blue: "blue", purple: "purple", pink: "pink", brown: "brown", white: "white", black: "black", gray: "gray", colorful: "colorful" },
  es: {
    red: ["rojo", "roja", "rojos", "rojas"], orange: ["naranja", "naranja", "naranjas", "naranjas"], yellow: ["amarillo", "amarilla", "amarillos", "amarillas"],
    green: ["verde", "verde", "verdes", "verdes"], blue: ["azul", "azul", "azules", "azules"], purple: ["morado", "morada", "morados", "moradas"],
    pink: ["rosa", "rosa", "rosas", "rosas"], brown: ["marrón", "marrón", "marrones", "marrones"], white: ["blanco", "blanca", "blancos", "blancas"],
    black: ["negro", "negra", "negros", "negras"], gray: ["gris", "gris", "grises", "grises"], colorful: same("de colores"),
  },
  fr: {
    red: ["rouge", "rouge", "rouges", "rouges"], orange: same("orange"), yellow: ["jaune", "jaune", "jaunes", "jaunes"],
    green: ["vert", "verte", "verts", "vertes"], blue: ["bleu", "bleue", "bleus", "bleues"], purple: ["violet", "violette", "violets", "violettes"],
    pink: ["rose", "rose", "roses", "roses"], brown: same("marron"), white: ["blanc", "blanche", "blancs", "blanches"],
    black: ["noir", "noire", "noirs", "noires"], gray: ["gris", "grise", "gris", "grises"], colorful: ["multicolore", "multicolore", "multicolores", "multicolores"],
  },
  de: {
    red: ["roter", "rote", "rotes", "rote"], orange: ["oranger", "orange", "oranges", "orange"], yellow: ["gelber", "gelbe", "gelbes", "gelbe"],
    green: ["grüner", "grüne", "grünes", "grüne"], blue: ["blauer", "blaue", "blaues", "blaue"], purple: same("lila"), pink: same("rosa"),
    brown: ["brauner", "braune", "braunes", "braune"], white: ["weißer", "weiße", "weißes", "weiße"], black: ["schwarzer", "schwarze", "schwarzes", "schwarze"],
    gray: ["grauer", "graue", "graues", "graue"], colorful: ["bunter", "bunte", "buntes", "bunte"],
  },
  it: {
    red: ["rosso", "rossa", "rossi", "rosse"], orange: same("arancione"), yellow: ["giallo", "gialla", "gialli", "gialle"],
    green: ["verde", "verde", "verdi", "verdi"], blue: same("blu"), purple: same("viola"), pink: same("rosa"),
    brown: ["marrone", "marrone", "marroni", "marroni"], white: ["bianco", "bianca", "bianchi", "bianche"], black: ["nero", "nera", "neri", "nere"],
    gray: ["grigio", "grigia", "grigi", "grigie"], colorful: ["colorato", "colorata", "colorati", "colorate"],
  },
  pt: {
    red: ["vermelho", "vermelha", "vermelhos", "vermelhas"], orange: ["laranja", "laranja", "laranjas", "laranjas"], yellow: ["amarelo", "amarela", "amarelos", "amarelas"],
    green: ["verde", "verde", "verdes", "verdes"], blue: ["azul", "azul", "azuis", "azuis"], purple: ["roxo", "roxa", "roxos", "roxas"], pink: same("rosa"),
    brown: ["marrom", "marrom", "marrons", "marrons"], white: ["branco", "branca", "brancos", "brancas"], black: ["preto", "preta", "pretos", "pretas"],
    gray: ["cinza", "cinza", "cinzas", "cinzas"], colorful: ["colorido", "colorida", "coloridos", "coloridas"],
  },
  tr: {
    red: "kırmızı", orange: "turuncu", yellow: "sarı", green: "yeşil", blue: "mavi", purple: "mor", pink: "pembe", brown: "kahverengi",
    white: "beyaz", black: "siyah", gray: "gri", colorful: "renkli",
  },
};

export function isLangCode(v: unknown): v is LangCode {
  return typeof v === "string" && LANGUAGES.some((l) => l.code === v);
}
export function isPropLang(v: unknown): v is PropLang {
  return v === "off" || isLangCode(v);
}
export function languageInfo(code: LangCode): LanguageInfo {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0]!;
}

function adjective(lang: LangCode, color: ColorKey, noun: Noun): string {
  const entry = COLORS[lang][color];
  if (typeof entry === "string") return entry;
  if (lang === "de") return noun.pl ? entry[3] : noun.g === "m" ? entry[0] : noun.g === "f" ? entry[1] : entry[2];
  return noun.pl ? (noun.g === "f" ? entry[3] : entry[2]) : noun.g === "f" ? entry[1] : entry[0];
}

/** Any noun (a prop, or a part from partNames.ts) with an optional colour, in word order and agreement for the language. */
export function nounPhrase(nn: Noun, color: ColorKey | null, lang: LangCode): string {
  if (!color) return nn.w;
  const adj = adjective(lang, color, nn);
  return lang === "en" || lang === "de" || lang === "tr" ? `${adj} ${nn.w}` : `${nn.w} ${adj}`;
}

/** "green tree" / "árbol verde" / "grüner Baum": the object and its colour, in the chosen language. */
export function propPhrase(noun: NounKey, color: ColorKey, lang: LangCode): string {
  return nounPhrase(NOUNS[lang][noun], color, lang);
}

/** The bare noun in a language ("tree", "árbol"), for places that show a name without a colour. */
export function propNoun(noun: NounKey, lang: LangCode): string {
  return NOUNS[lang][noun].w;
}

/**
 * Map a hex colour (#rrggbb) to the nearest kid colour word. Greys are judged by saturation and lightness; everything else
 * by hue. Brown is dark orange, pink is light red/magenta.
 */
export function colorKeyFromHex(hex: string): ColorKey {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "gray";
  const v = parseInt(m[1]!, 16);
  const r = ((v >> 16) & 255) / 255, g = ((v >> 8) & 255) / 255, b = (v & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (l > 0.9) return "white";
  if (l < 0.22) return "black"; // very dark navy reads as black to a kid (the exploded view's wheels are #262D40)
  if (s < 0.18) return l < 0.25 ? "black" : l > 0.78 ? "white" : "gray";
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  if (h < 15 || h >= 345) return l > 0.7 ? "pink" : "red";
  if (h < 40) return l < 0.45 || (s < 0.6 && l < 0.65) ? "brown" : "orange";
  if (h < 70) return l < 0.35 ? "brown" : "yellow";
  if (h < 170) return "green";
  if (h < 250) return "blue";
  if (h < 290) return "purple";
  return l > 0.6 ? "pink" : "purple";
}

export interface DescribableObject {
  /** A noun from the controlled vocabulary, when the generator could pick one. */
  noun?: NounKey;
  /** Free text the generator wrote ("Spoiler", "dragon wing"); used only when no noun key was given. */
  label?: string;
  color?: ColorKey | `#${string}`;
}

export interface Described {
  text: string;
  /** The language the text is actually in. A free-text label cannot be translated, so it comes back as "en". */
  lang: LangCode;
}

/**
 * Name any object, including generated ones. With a noun key the phrase is built in the chosen language. With only free text
 * the whole phrase falls back to English (an honest "green spoiler" beats a wrong "verde spoiler"). Returns null when there is
 * nothing to say.
 */
export function describeObject(obj: DescribableObject, lang: PropLang): Described | null {
  if (lang === "off") return null;
  const color: ColorKey | null = !obj.color ? null : obj.color.startsWith("#") ? colorKeyFromHex(obj.color) : (obj.color as ColorKey);
  if (obj.noun) {
    return { text: color ? propPhrase(obj.noun, color, lang) : propNoun(obj.noun, lang), lang };
  }
  const label = obj.label?.trim();
  if (!label) return null;
  const word = label.toLowerCase();
  return { text: color ? `${COLORS.en[color] as string} ${word}` : word, lang: "en" };
}
