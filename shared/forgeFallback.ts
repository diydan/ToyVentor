/**
 * The ready-made part nearest to a child's wish, for when the parts maker cannot make theirs (docs/specs/forge-ai-spec.md, "Always end usable": F1 falls back
 * to the nearest ready-made catalog part). A wish that never passes the print check, or a maker that is busy, must still end with something Kip can wear,
 * and the catalog hats and heads are already checked and printable.
 *
 * Pure: no DOM, no network, no clock. A fixed table of words to the bench's own ids (HAT_OPTIONS and WARDROBE_HEADS in parts/kip/viewer/kip-vehicles-wardrobe.js;
 * tests/forge-fallback.test.ts fails if an id here is not there). It never answers "nothing": with no word in common it gives a friendly default and says
 * `exact: false` so the screen can word it as "a ready-made one" and not "the one you asked for".
 */
import type { MakeSlot } from "./forgeMakeLimits";

export interface ReadyMade {
  kind: "hat" | "head";
  /** The id the bench wears: a hat id for `setCrownMode`, a head id for `setHeadMode`. */
  id: string;
  /** What to call it on screen, as the bench calls it. */
  label: string;
  /** Whether a word in the wish named it (false: a friendly default). */
  exact: boolean;
}

type Entry = { id: string; label: string; words: string[] };

/** Hat ids and labels are those of HAT_OPTIONS; words are what a child might say. Longer phrases are matched as phrases. */
const HATS: Entry[] = [
  { id: "pirate", label: "Tricorne Hat", words: ["pirate", "captain", "tricorne", "sailor", "buccaneer"] },
  { id: "cowboy", label: "Cowboy Hat", words: ["cowboy", "cowgirl", "western", "sheriff", "rodeo"] },
  { id: "tophat", label: "Dapper Top Hat", words: ["top hat", "magician", "magic", "wizard", "witch", "dapper", "gentleman", "fancy", "formal", "king", "queen", "crown", "princess", "prince"] },
  { id: "hardhat", label: "Builder Hardhat", words: ["hard hat", "hardhat", "builder", "construction", "helmet", "worker", "miner", "firefighter", "knight", "viking"] },
  { id: "ranger", label: "Explorer Hat", words: ["ranger", "explorer", "safari", "scout", "adventure", "jungle", "banana"] },
  { id: "beanie", label: "Ribbed Beanie", words: ["beanie", "woolly", "winter", "knit", "bobble", "pom", "snow", "cosy", "cozy", "chef"] },
  { id: "ballcap", label: "Sport Ballcap", words: ["cap", "baseball", "sport", "sports", "team"] },
  { id: "headphones", label: "Party Headphones", words: ["headphones", "earphones", "music", "dj", "party", "disco"] },
  { id: "horns", label: "Bumper Horns", words: ["horns", "horn", "devil", "demon", "bull", "unicorn", "dragon", "rhino"] },
  { id: "ears", label: "Pointy Ears", words: ["ears", "bunny", "rabbit", "mouse", "elf", "fairy", "pointy", "cat ears", "kitten"] },
  { id: "hat", label: "Wobble Hat", words: ["wobble", "silly", "funny", "clown", "jester", "wacky", "rocket", "spaceship"] },
  { id: "blank", label: "Blank Cap", words: ["blank", "plain", "simple"] },
];

/** Head ids and labels are those of WARDROBE_HEADS. */
const HEADS: Entry[] = [
  { id: "fox", label: "Fox", words: ["fox", "dog", "puppy", "wolf", "corgi", "fennec", "coyote"] },
  { id: "bear", label: "Bear", words: ["bear", "panda", "koala", "teddy", "gorilla", "monkey", "pig", "owl"] },
  { id: "cat", label: "Whisker Cat", words: ["cat", "kitten", "kitty", "tiger", "lion", "leopard", "bunny", "rabbit"] },
  { id: "dragon", label: "Drake Dragon", words: ["dragon", "dinosaur", "dino", "lizard", "croc", "crocodile", "reptile", "snake"] },
  { id: "alien", label: "Starling Alien", words: ["alien", "space", "ufo", "martian", "astronaut", "star"] },
  { id: "imp", label: "Yeti Imp", words: ["yeti", "imp", "troll", "goblin", "ogre", "monster", "devil", "creature", "ghost"] },
  { id: "robot", label: "Bolt Robot", words: ["robot", "bot", "android", "cyborg", "machine"] },
  { id: "scout", label: "Mecha Scout", words: ["mecha", "scout", "mech", "armor", "armour"] },
  { id: "kid", label: "Soft Youth", words: ["kid", "child", "boy", "person", "human", "face", "man"] },
  { id: "chibi", label: "Sweet Heart", words: ["girl", "heart", "sweet", "princess"] },
];

const tokens = (text: string): string => ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
/** How many of an entry's words the wish contains, as whole words or whole phrases. */
const score = (padded: string, e: Entry): number => e.words.filter((w) => padded.includes(` ${w} `) || padded.includes(` ${w}s `)).length;

function best(padded: string, list: Entry[]): { entry: Entry; score: number } {
  let top = { entry: list[0]!, score: 0 };
  for (const e of list) {
    const s = score(padded, e);
    if (s > top.score) top = { entry: e, score: s };
  }
  return top;
}

/** What a child says that points at a head and not a hat: the word "head", "face", or a creature. */
const HEADISH = /\b(head|face|heads|faces)\b/i;

/**
 * The ready-made part nearest to `text`. `slot` is what the child chose (a hat or a head); left out, the wish decides: the word "head" or a better-matching
 * head word wins, otherwise it is a hat. Never null.
 */
export function nearestReadyMade(text: string, slot?: MakeSlot): ReadyMade {
  const padded = tokens(text);
  const hat = best(padded, HATS);
  const head = best(padded, HEADS);
  const wantHead = slot === "head" ? true : slot === "crown" ? false : HEADISH.test(text) || head.score > hat.score;
  const pick = wantHead ? head : hat;
  if (pick.score > 0) return { kind: wantHead ? "head" : "hat", id: pick.entry.id, label: pick.entry.label, exact: true };
  // nothing in common: a friendly default that is always there
  return wantHead ? { kind: "head", id: "kid", label: "Soft Youth", exact: false } : { kind: "hat", id: "hat", label: "Wobble Hat", exact: false };
}

/** Every id this module can answer with, for the test that checks them against the bench's own lists. */
export const READY_MADE_IDS = { hat: HATS.map((e) => e.id), head: HEADS.map((e) => e.id) } as const;
