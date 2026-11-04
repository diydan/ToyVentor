// The new-player setup (Dan, 2026-11-04): "create user account, parents must set up for anyone under 13", and the onboarding he wrote: the kid's name and the parent's name, the kid's
// favourite colour, fruit and animal, then create the character (a pile of bricks, as in the Kip demo workshop), then an intro with confetti and the theme song made for the first user,
// a quick word about the app (benefits, the three tiers, the weekly challenge, STEM, DIY 3D printing or monthly kits).
// Spec: docs/specs/accounts-and-new-user-spec.md. This file is PHASE 0, the part built before the 2026-11-04 6 PM ET freeze: everything stays ON THE DEVICE. No login, no server storage of a name.
// The only thing that leaves the device is the theme song request, and only after a grown-up taps the consent button (the child's first name and three favourites go into the song idea, which
// reaches the text model and the song maker: a disclosure the compliance owner must look at, see the spec).
//
// Pure: no React, no DOM. Storage is injected (the page passes `localStorage`).

import { KIP_HAIRSTYLES, KIP_HAIR_COLORS, KIP_SKIN_TONES } from "../features/game/world/runtime/kipLook";

export const PROFILE_KEY = "toyventor:profile:v1";
export const PROFILE_VERSION = 1;

export interface Choice { id: string; label: string; icon: string }
export interface ColourChoice extends Choice { hex: string }

/** The colours a child can love. The first six are the game's own paint swatches (runtime/catalog.ts PAINTS), so the shirt can be painted with exactly that colour. */
export const FAVOURITE_COLOURS: readonly ColourChoice[] = [
  { id: "red", label: "Red", icon: "🔴", hex: "#ff5a4d" },
  { id: "orange", label: "Orange", icon: "🟠", hex: "#ff9d5c" },
  { id: "yellow", label: "Yellow", icon: "🟡", hex: "#ffd24d" },
  { id: "green", label: "Green", icon: "🟢", hex: "#5af0b0" },
  { id: "blue", label: "Blue", icon: "🔵", hex: "#52b7ff" },
  { id: "purple", label: "Purple", icon: "🟣", hex: "#a78bff" },
  { id: "pink", label: "Pink", icon: "🩷", hex: "#ff8fc7" },
];
/** Fruit and animals are pick-from-a-list, never typed: nothing a child writes reaches a model except the first name (screened by the song route). */
export const FAVOURITE_FRUITS: readonly Choice[] = [
  { id: "apple", label: "Apple", icon: "🍎" },
  { id: "banana", label: "Banana", icon: "🍌" },
  { id: "strawberry", label: "Strawberry", icon: "🍓" },
  { id: "orange", label: "Orange", icon: "🍊" },
  { id: "grapes", label: "Grapes", icon: "🍇" },
  { id: "watermelon", label: "Watermelon", icon: "🍉" },
  { id: "pear", label: "Pear", icon: "🍐" },
  { id: "cherries", label: "Cherries", icon: "🍒" },
];
export const FAVOURITE_ANIMALS: readonly Choice[] = [
  { id: "dog", label: "Dog", icon: "🐶" },
  { id: "cat", label: "Cat", icon: "🐱" },
  { id: "bunny", label: "Bunny", icon: "🐰" },
  { id: "elephant", label: "Elephant", icon: "🐘" },
  { id: "lion", label: "Lion", icon: "🦁" },
  { id: "dinosaur", label: "Dinosaur", icon: "🦖" },
  { id: "dolphin", label: "Dolphin", icon: "🐬" },
  { id: "penguin", label: "Penguin", icon: "🐧" },
];

export interface Favourites { colour: string; fruit: string; animal: string }
export interface PlayerProfile {
  version: typeof PROFILE_VERSION;
  kidName: string;
  parentName: string;
  /** True: a grown-up did this setup and said so (the player is under 13). False: the player says they are 13 or older. */
  under13: boolean;
  favourites: Favourites;
  /** A grown-up said the first name and the favourites may go into one song request. Never inferred. */
  songConsent: boolean;
  createdAt: string;
}

// ---- the questions -------------------------------------------------------------------------------------------------------------------------------------------------------------

export type NameProblem = "empty" | "too-long" | "characters";
export type NameResult = { ok: true; name: string } | { ok: false; problem: NameProblem };
export const NAME_MAX = 20;
export const NAME_PROBLEM_TEXT: Readonly<Record<NameProblem, string>> = {
  empty: "Type a name to go on.",
  "too-long": `Use ${NAME_MAX} letters or fewer.`,
  characters: "Letters only, please: no numbers, links or symbols.",
};

/**
 * A first name or a nickname: letters (any language), and single spaces, hyphens or apostrophes between them; 1 to 20 characters. Digits, "@", ":", "/" and the rest are refused, which is
 * also what keeps an email, a phone number or a link out of a song request. The song route screens the words again.
 */
export function cleanName(raw: unknown): NameResult {
  const text = typeof raw === "string" ? raw.normalize("NFC").replace(/\s+/g, " ").trim() : "";
  if (!text) return { ok: false, problem: "empty" };
  if ([...text].length > NAME_MAX) return { ok: false, problem: "too-long" };
  if (!/^\p{L}+(?:[ '’-]\p{L}+)*$/u.test(text)) return { ok: false, problem: "characters" };
  return { ok: true, name: text };
}

/** Whoever is under 13 is set up by a grown-up: the grown-up check and the parent's name come first. 13 and over may set up for themselves (the same screens). */
export const ADULT_AGE = 13;
export const needsGrownUp = (under13: boolean): boolean => under13;

export type StepId = "who" | "grownup" | "names" | "favourites" | "dress" | "song" | "build" | "intro";
/** The screens in order. A player 13 or over skips only the grown-up check. The song's yes comes BEFORE the build so the grown-up answers it while still holding the device; the song itself is only asked for when the intro begins, so the wait is the tour. */
export function stepsFor(under13: boolean): readonly StepId[] {
  return under13 ? ["who", "grownup", "names", "favourites", "dress", "song", "build", "intro"] : ["who", "names", "favourites", "dress", "song", "build", "intro"];
}

/** The grown-up check: one small multiplication, drawn fresh. It is an age screen and nothing more (the COPPA spec: a math question is not consent; the consent is the button on the song screen). */
export function grownUpQuestion(rng: () => number = Math.random): { a: number; b: number; answer: number } {
  const pick = (lo: number, hi: number) => {
    const r = rng();
    return lo + Math.floor((Number.isFinite(r) ? Math.min(0.999999, Math.max(0, r)) : 0.5) * (hi - lo + 1));
  };
  const a = pick(6, 9), b = pick(6, 9);
  return { a, b, answer: a * b };
}

// ---- dressing Kip ---------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * "Dress your Kip" (Dan, 2026-11-04: "use a similar UI as the onboarding for the initial Kip configure: hair, pants colours, shirt colour, shoes colour, hair/hat, tail"). Every choice is a tile from a closed list, and
 * every list is what the game's rig really draws: the shirt (paint zone c1), the pants (c2) and the skin tone (skin), the demo's nineteen hairstyles and six hair tones (runtime/kipLook.ts), and the hats and tails the
 * character rig has models for (runtime/catalog.ts, runtime/stlRigLoader.ts resolveCharacterHatUrl). SHOES have no colour in the rig (the boots are the demo's orange), so there is no shoe row.
 */
export interface KipConfig { shirt: string; pants: string; skin: string; hair: string; hairColour: string; hat: string; tail: string }

export const PANTS_COLOURS: readonly ColourChoice[] = [
  { id: "navy", label: "Navy", icon: "🔵", hex: "#2b4c85" },
  { id: "denim", label: "Light blue", icon: "🔷", hex: "#5b86c9" },
  { id: "black", label: "Black", icon: "⚫", hex: "#2a2a33" },
  { id: "khaki", label: "Khaki", icon: "🟤", hex: "#c9b27a" },
  { id: "red", label: "Red", icon: "🔴", hex: "#e4573d" },
  { id: "green", label: "Green", icon: "🟢", hex: "#3fae6a" },
  { id: "purple", label: "Purple", icon: "🟣", hex: "#7a5cc7" },
];
export const SKIN_CHOICES: readonly ColourChoice[] = KIP_SKIN_TONES.map((t) => ({ id: t.id, label: t.label, icon: "🙂", hex: t.hex.toLowerCase() }));
export const HAIR_CHOICES: readonly Choice[] = [{ id: "none", label: "No hair", icon: "🚫" }, ...KIP_HAIRSTYLES.map((h) => ({ id: h.id, label: h.label, icon: "💇" }))];
export const HAIR_COLOUR_CHOICES: readonly ColourChoice[] = KIP_HAIR_COLORS.map((c) => ({ id: c.id, label: c.label, icon: "🎨", hex: c.hex.toLowerCase() }));
export const HAT_CHOICES: readonly Choice[] = [
  { id: "none", label: "No hat", icon: "🚫" }, { id: "wizard", label: "Wizard hat", icon: "🧙" }, { id: "crown", label: "Crown", icon: "👑" },
  { id: "propcap", label: "Hard hat", icon: "👷" }, { id: "cap", label: "Cap", icon: "🧢" }, { id: "flower", label: "Ranger hat", icon: "🤠" },
];
export const TAIL_CHOICES: readonly Choice[] = [
  { id: "none", label: "No tail", icon: "🚫" }, { id: "curly", label: "Curly tail", icon: "🌀" }, { id: "fox", label: "Fox tail", icon: "🦊" },
  { id: "dragon", label: "Dragon tail", icon: "🐉" }, { id: "puff", label: "Puff tail", icon: "☁️" },
];

/** The Kip a new player starts from: the stock look (the demo's skin, jeans and chestnut Swept hair), with the shirt in `shirtHex` (the favourite colour). */
export function defaultKipConfig(shirtHex: string = FAVOURITE_COLOURS[0]!.hex): KipConfig {
  return { shirt: shirtHex.toLowerCase(), pants: "#2b4c85", skin: "#f3ba95", hair: "short_swept", hairColour: "#6e412a", hat: "none", tail: "none" };
}

const HEX = /^#[0-9a-f]{6}$/i;
/** A config only ever holds values from the lists above (a hand-edited or old value is refused, never trusted). */
export function cleanKipConfig(raw: unknown): KipConfig | null {
  const c = raw as Partial<Record<keyof KipConfig, unknown>> | null;
  if (!c || typeof c !== "object") return null;
  const hex = (v: unknown, from: readonly ColourChoice[]): string | null => (typeof v === "string" && HEX.test(v) && from.some((x) => x.hex.toLowerCase() === v.toLowerCase()) ? v.toLowerCase() : null);
  const id = (v: unknown, from: readonly Choice[]): string | null => (typeof v === "string" && from.some((x) => x.id === v) ? v : null);
  const shirt = hex(c.shirt, FAVOURITE_COLOURS), pants = hex(c.pants, PANTS_COLOURS), skin = hex(c.skin, SKIN_CHOICES), hairColour = hex(c.hairColour, HAIR_COLOUR_CHOICES);
  const hair = id(c.hair, HAIR_CHOICES), hat = id(c.hat, HAT_CHOICES), tail = id(c.tail, TAIL_CHOICES);
  return shirt && pants && skin && hairColour && hair && hat && tail ? { shirt, pants, skin, hair, hairColour, hat, tail } : null;
}

// ---- the profile ---------------------------------------------------------------------------------------------------------------------------------------------------------------

export const colourOf = (id: string): ColourChoice | undefined => FAVOURITE_COLOURS.find((c) => c.id === id);
export const fruitOf = (id: string): Choice | undefined => FAVOURITE_FRUITS.find((c) => c.id === id);
export const animalOf = (id: string): Choice | undefined => FAVOURITE_ANIMALS.find((c) => c.id === id);

export interface Draft {
  under13: boolean;
  kidName: string;
  parentName: string;
  favourites: Partial<Favourites>;
  songConsent: boolean;
}

/** The whole profile, or the first thing that is wrong with the draft (so the screen can say it). */
export function buildProfile(draft: Draft, nowIso: string): { ok: true; profile: PlayerProfile } | { ok: false; problem: string } {
  const kid = cleanName(draft.kidName);
  if (!kid.ok) return { ok: false, problem: `kid name: ${kid.problem}` };
  const parent = cleanName(draft.parentName);
  if (!parent.ok && draft.under13) return { ok: false, problem: `parent name: ${parent.problem}` };
  const f = draft.favourites;
  if (!f.colour || !colourOf(f.colour)) return { ok: false, problem: "favourite colour" };
  if (!f.fruit || !fruitOf(f.fruit)) return { ok: false, problem: "favourite fruit" };
  if (!f.animal || !animalOf(f.animal)) return { ok: false, problem: "favourite animal" };
  return {
    ok: true,
    profile: {
      version: PROFILE_VERSION,
      kidName: kid.name,
      parentName: parent.ok ? parent.name : "",
      under13: draft.under13,
      favourites: { colour: f.colour, fruit: f.fruit, animal: f.animal },
      songConsent: draft.songConsent === true,
      createdAt: nowIso,
    },
  };
}

export interface Store { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

/** The saved profile, or null when there is none or it does not pass the same rules (a hand-edited or old value is ignored, never trusted). */
export function readProfile(store: Store | null): PlayerProfile | null {
  try {
    const raw = store?.getItem(PROFILE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<PlayerProfile>;
    if (!v || v.version !== PROFILE_VERSION) return null;
    const built = buildProfile(
      { under13: v.under13 === true, kidName: String(v.kidName ?? ""), parentName: String(v.parentName ?? ""), favourites: v.favourites ?? {}, songConsent: v.songConsent === true },
      typeof v.createdAt === "string" ? v.createdAt : "",
    );
    return built.ok ? built.profile : null;
  } catch {
    return null;
  }
}
export function saveProfile(store: Store | null, profile: PlayerProfile): boolean {
  try {
    store?.setItem(PROFILE_KEY, JSON.stringify(profile));
    return !!store;
  } catch {
    return false;
  }
}
/** The grown-up's "forget this player": the profile goes, nothing else is touched. */
export function clearProfile(store: Store | null): void {
  try { store?.removeItem(PROFILE_KEY); } catch { /* nothing to forget */ }
}

// ---- the theme song ------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * The one sentence a song is asked for ("prompt" kind of /api/theme-song: the route screens it before any model sees it). Only a first name and three picks from closed lists; null when the
 * profile did not say yes to the song.
 */
export function songIdea(p: PlayerProfile): string | null {
  if (!p.songConsent) return null;
  const colour = colourOf(p.favourites.colour)?.label.toLowerCase();
  const fruit = fruitOf(p.favourites.fruit)?.label.toLowerCase();
  const animal = animalOf(p.favourites.animal)?.label.toLowerCase();
  if (!colour || !fruit || !animal) return null;
  return `a happy welcome song for ${p.kidName}, who loves the colour ${colour}, ${fruit} and ${animal}s, and has just built a Kip to play with`;
}

// ---- the intro -----------------------------------------------------------------------------------------------------------------------------------------------------------------

export interface IntroSlide { id: string; icon: string; title: string; lines: readonly string[]; source: string }

/**
 * The quick word about the app. Every claim is one the repo already makes, and `source` says where; what is not built or not decided says so on the slide.
 *   tiers: docs/specs/app-continuation-spec.md (Tier 1 Starter, Tier 2 Tinker, Tier 3 Engineer; two stars open the next)
 *   weekly: docs/specs/garage-weekend-spec.md (a new Garage drop every Friday, Saturday and Sunday, counts toward STEM minutes)
 *   STEM: docs/product/spec.md (11 STEM Concept Badges, Sprout / Tinker / Master, shown to the grown-up; lab missions: bridge, measure, balance, lever, logic, lift, raft, circuit, code, pattern, clean).
 *         There is NO standards mapping (NGSS or any other) anywhere in the repo, so no slide claims one.
 *   real things: docs/product/submission-vision.md (physical toys, kits and printed or ordered upgrades carry the business) and the Kip print workflow (print at home). Monthly kits are Dan's
 *         2026-11-04 idea: nothing is built, priced or decided, so that slide says "coming" and collects nothing.
 */
export function introSlides(name: string): readonly IntroSlide[] {
  return [
    {
      id: "welcome", icon: "🎉", title: `Welcome, ${name}!`,
      lines: ["ToyVentor is a toy game you build, play and then make real.", "Your Kip is ready, and so is your very own song."],
      source: "docs/product/submission-vision.md",
    },
    {
      id: "benefits", icon: "🧠", title: "Play that teaches",
      lines: ["Build toys part by part, solve little missions, and learn by doing.", "No losing, no chat with strangers, and the grown-up decides the play time."],
      source: "docs/specs/toyventor-town-vision.md (Gentle by design: no losing, no strangers, no chat); docs/specs/parent-time-gate.md",
    },
    {
      id: "tiers", icon: "⭐", title: "Three steps to grow",
      lines: ["Starter, Tinker, then Engineer.", "Earn two stars in a mission to open the next step."],
      source: "docs/specs/app-continuation-spec.md",
    },
    {
      id: "weekly", icon: "🔧", title: "A new challenge every weekend",
      lines: ["The Garage has a new build every Friday, Saturday and Sunday.", "Finishing it earns STEM minutes."],
      source: "docs/specs/garage-weekend-spec.md",
    },
    {
      id: "stem", icon: "🔬", title: "Real STEM skills",
      lines: ["Measure, balance, levers, circuits, patterns and code.", "Eleven concept badges grow from Sprout to Tinker to Master, and the grown-up sees them."],
      source: "docs/product/spec.md (11 STEM Concept Badges)",
    },
    {
      id: "real", icon: "🖨️", title: "Then make it real",
      lines: ["Print your toy at home on a 3D printer, DIY.", "Monthly kits are coming soon: ask a grown-up to watch this space."],
      source: "docs/product/submission-vision.md; kits: not built, not priced (accounts-and-new-user-spec open question)",
    },
  ];
}

/**
 * The "meet Kip" cards, shown in the Toy Room after Kip is built (Dan, 2026-11-04: "introduce Kip and some of the props and how they can use them"). Every line is something the game does today:
 *   walking: tap the floor and Kip walks there (the world's pointer walk; `P.target`)
 *   props: runtime/toyRoomActs.ts `ACT_FOR_PROP` (xylophone: mallet, teddy: hug, ball: kick, bubbles: blow, dog: pet) and the Toy Room's prop list in runtime/catalog.ts (the xylophone is the first prop, 1.8 units
 *          from where Kip starts; the others are farther along)
 *   jobs: runtime/clean.ts and cook.ts (the cleaning cart and the hob start the cleaning and cooking levels, which have no timer, no score and no failure state)
 */
export function meetKipSlides(): readonly IntroSlide[] {
  return [
    { id: "walk", icon: "👆", title: "Tap to walk", lines: ["Tap the floor and Kip walks there.", "Walk to the right to explore the whole Toy Room."], source: "world pointer walk (runtime/world.ts)" },
    { id: "props", icon: "🎹", title: "Tap a prop", lines: ["Tap the xylophone next to Kip and he plays it with a mallet.", "Farther along: a teddy to hug, a ball to kick, bubbles to blow and a dog to pet."], source: "runtime/toyRoomActs.ts ACT_FOR_PROP; runtime/catalog.ts (the Toy Room)" },
    { id: "jobs", icon: "🧹", title: "Little jobs", lines: ["The cleaning cart and the hob start short games: clean up a mess, or cook pancakes.", "No timer and no losing, just helping."], source: "runtime/clean.ts, runtime/cook.ts" },
  ];
}

/** Confetti pieces for the intro: deterministic from a seed so a test can pin it, and cheap (one DOM node each, CSS only). */
export interface ConfettiPiece { left: number; delay: number; duration: number; size: number; colour: string; spin: number; drift: number }
export function confetti(count: number, seed = 7): ConfettiPiece[] {
  let s = seed >>> 0 || 1;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0x100000000; };
  const palette = FAVOURITE_COLOURS.map((c) => c.hex);
  return Array.from({ length: Math.max(0, Math.min(120, Math.floor(count))) }, () => ({
    left: Math.round(rnd() * 100),
    delay: +(rnd() * 1.6).toFixed(2),
    duration: +(2.6 + rnd() * 2.2).toFixed(2),
    size: 6 + Math.floor(rnd() * 8),
    colour: palette[Math.floor(rnd() * palette.length)]!,
    spin: Math.floor(rnd() * 720) - 360,
    drift: Math.floor(rnd() * 60) - 30,
  }));
}
