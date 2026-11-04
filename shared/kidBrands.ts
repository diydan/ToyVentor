// The longer brand list for what the MODEL says (a part's name, its text, its names in seven languages). Dan, 2026-11-04 night: on 42 wishes naming brands that were in no list the base wrote the
// brand into the name on 17, and our tuned model on 10, and nothing caught them. The older, short list (KID_BRAND_BASE_RE in worker/forgeMake.ts) is kept as it was: the blind evaluation set was built
// from brands that were in neither list at that time (scripts/tuning/lib/blindSet.ts), and that record must not move.
//
// Rules for an entry (each pinned in tests/kid-brands.test.ts):
//  - It is DISTINCTIVE: a name of a show, a character, a toy line, a game or a company that is not also an ordinary word or a common first name in the seven languages. No "frozen", "sonic" alone, "elsa",
//    "anna", "peach", "woody", "stitch", "flash", "joker", "toad", "bumblebee", "robin": a false positive only swaps a name for "My Creation", but the list must not eat words a child really uses.
//  - It is written for TEXT THAT HAS BEEN FOLDED (lower case, accents and ß removed, ’ made '): see checkBrand below. Spaces in an entry match any whitespace; `-?` and ` ?` make a hyphen or a space optional.
//  - It matches whole words only.
//  - NOT "elmo": it is the word for a helmet in Italian, Spanish and Portuguese (found by the blind set's own wishes: "un elmo vichingo"), so the Sesame Street character is left to "sesame street" and the model's own habits. Cross-language homographs are the limit of any brand list.
// It is a floor, not a census: a brand nobody listed still gets through, and the intake does not refuse brand wishes on purpose (the child still gets a part, with a name of the model's own).
// Extend it as the owner of the brand rule decides; a native-speaker read of the local entries is still to do.
import { foldText } from "./kidSafeNormalize";

const DISNEY_PIXAR = ["donald duck", "tigger", "eeyore", "winnie the pooh", "winnie-?the-?pooh", "pooh bear", "bambi", "dumbo", "simba", "mufasa", "pumbaa", "moana", "mirabel", "toy story", "buzz lightyear", "lightning mcqueen", "wall-?e", "baymax", "tinker ?bell", "mulan", "monsters,? inc", "finding nemo", "the incredibles", "dreamworks", "lucasfilm", "disney ?land", "disney ?world"];
const MARVEL_DC = ["spider ?man", "bat ?man", "super ?man", "iron ?man", "avengers", "captain america", "hulk", "deadpool", "thanos", "miles morales", "guardians of the galaxy", "groot", "ant-?man", "doctor strange", "harley quinn", "catwoman", "aquaman", "justice league", "teen titans", "batgirl", "supergirl", "x-?men", "fantastic four"];
const STAR_WARS = ["yoda", "baby yoda", "grogu", "mandalorian", "chewbacca", "stormtrooper", "boba fett", "r2-?d2", "c-?3po", "bb-?8", "millennium falcon", "death star", "obi-?wan", "skywalker", "jedi knight"];
const NINTENDO_POKEMON = ["super ?mario", "mario ?kart", "mario bros", "luigi", "yoshi", "bowser", "princess peach", "kirby", "zelda", "pikmin", "animal crossing", "splatoon", "donkey kong", "metroid", "smash bros", "pokeball", "poke ?ball", "eevee", "charizard", "bulbasaur", "squirtle", "jigglypuff", "mewtwo", "snorlax", "pocket monsters", "digimon", "yu-?gi-?oh", "tamagotchi"];
const ANIME_SANRIO = ["dragon ?ball", "goku", "vegeta", "naruto", "sasuke", "luffy", "sailor moon", "doraemon", "totoro", "ponyo", "spirited away", "studio ghibli", "astro ?boy", "my melody", "kuromi", "cinnamoroll", "pompompurin", "pochacco", "badtz-?maru", "keroppi", "gudetama", "rilakkuma", "sumikko", "san-?x"];
const GAMES = ["sonic the hedgehog", "among us", "fall guys", "enderman", "pac-?man", "tetris", "angry birds", "plants vs\\.? zombies", "candy crush", "subway surfers", "temple run", "clash of clans", "clash royale", "brawl stars", "genshin", "overwatch", "mortal kombat", "street fighter", "call of duty", "grand theft auto", "five nights at freddy'?s", "fnaf", "poppy playtime", "huggy wuggy", "kissy missy", "mario kart", "geometry dash", "stumble guys", "pubg", "valorant", "league of legends"];
const TOYS = ["duplo", "playmobil", "nerf", "play-?doh", "fisher-?price", "hasbro", "mattel", "tonka", "bratz", "l\\.?o\\.?l\\.? surprise", "polly pocket", "my little pony", "rainbow dash", "twilight sparkle", "care bears?", "cabbage patch", "squishmallows?", "labubu", "funko", "beyblade", "furby", "thomas the tank engine", "thomas (and|&) friends", "gabby'?s dollhouse", "cocomelon", "coco melon", "blippi", "ms\\.? rachel", "mr\\.? ?beast", "bluey", "george pig", "ben (and|&) holly", "octonauts", "bob the builder", "fireman sam", "postman pat", "noddy", "teletubbies", "tinky winky", "laa-?laa", "in the night garden", "iggle piggle", "sesame street", "cookie monster", "oscar the grouch", "kermit", "miss piggy", "muppets?", "barney (and|&) friends", "paddington", "gruffalo", "peter rabbit", "miffy", "moomin", "moomins", "pippi (long|lang)stocking", "tintin", "asterix", "obelix", "smurfs?", "winx", "geronimo stilton", "captain underpants", "wimpy kid", "baby ?shark", "pinkfong", "gundam", "gunpla", "pusheen"];
const ANIMATION_TV = ["shrek", "minions?", "despicable me", "kung fu panda", "how to train your dragon", "spongebob", "sponge ?bob", "patrick star", "squidward", "dora the explorer", "ben ?10", "teenage mutant ninja turtles", "tmnt", "power rangers", "megatron", "he-?man", "she-?ra", "thundercats", "scooby-?doo", "tom (and|&) jerry", "looney tunes", "bugs bunny", "daffy duck", "tweety", "porky pig", "garfield", "snoopy", "charlie brown", "pink panther", "popeye", "flintstones", "the jetsons", "simpsons", "homer simpson", "bart simpson", "peppa", "cartoon network", "netflix", "youtube", "tiktok", "coca-?cola", "pepsi", "mcdonald'?s", "nike", "adidas", "lego"];
const LOCAL = ["benjamin bl(u|ue)mchen", "biene maja", "kapt'?n blaub(a|ae)r", "babar the elephant", "babar l'?elephant", "sandm(a|ae)nnchen", "pumuckl", "bibi blocksberg", "bibi und tina", "lucky luke", "barbapapa", "titeuf", "oui-?oui", "turma da monica", "cebolinha", "el chavo", "micky maus", "mickey maus", "pepee", "rafadan tayfa", "keloglan", "bob esponja", "bob l'?eponge", "patrulla canina", "pat'?patrouille", "fix und foxi", "asterix und obelix", "die sendung mit der maus", "peppa wutz", "peppa pig", "paw patrol", "winnie l'?ourson", "winnie puuh"];

export const KID_BRAND_MORE_FRAGMENTS: readonly string[] = [...DISNEY_PIXAR, ...MARVEL_DC, ...STAR_WARS, ...NINTENDO_POKEMON, ...ANIME_SANRIO, ...GAMES, ...TOYS, ...ANIMATION_TV, ...LOCAL];

/** An entry's `-?` and ` ?` both mean "a space, or nothing"; a plain space means one or more whitespace. (Hyphens in the TEXT are turned into spaces first, so "Baby-Shark" and "baby shark" are the same.) */
const toSource = (f: string): string => f.replace(/-\?/g, " ?").replace(/ \?/g, "\\s*").replace(/ /g, "\\s+");
const MORE_RE = new RegExp(`(?<![a-z0-9])(?:${KID_BRAND_MORE_FRAGMENTS.map(toSource).join("|")})(?![a-z0-9])`, "i");

/** The text the longer list is tested on: folded (lower case, no accents), curly apostrophes straightened, dots and underscores between letters kept out of the way. */
const foldForBrands = (t: string): string => foldText(t.replace(/[\u2018\u2019\u02bc]/g, "'")).replace(/[_-]/g, " ");

/** Does this text carry a brand from the LONGER list? (The short list is tested separately by the caller.) */
export function matchesMoreBrands(text: string): boolean {
  return typeof text === "string" && text.length > 0 && MORE_RE.test(foldForBrands(text));
}

/** The first brand found, for a test or a reviewer (never log it with a child's words). */
export function firstMoreBrand(text: string): string | null {
  const m = MORE_RE.exec(foldForBrands(text));
  return m ? m[0] : null;
}
