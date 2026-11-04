/**
 * Wishes for the tuned recipe writer: where they come from, what they must pass, and which set each belongs to. Pure except for reading the evaluation files.
 *
 * Rules (each is tested in tests/tuning-wishgen.test.ts):
 *  1. A wish is accepted only if the PRODUCTION intake would accept it: contact details scrubbed, 1 to 120 characters, no unsafe term in any of the seven languages
 *     (shared/kidSafeTerms.ts), no brand word. A training set must never contain a wish the product would refuse.
 *  2. Every wish belongs to exactly one of train, val and heldout, decided by a hash of its normalised text and a seed, so the split is the same on every machine and every run.
 *  3. A wish equal to, or close to (word overlap of 0.8 or more), anything in the evaluation sets is kept OUT of training and out of the other sets too. Evaluation wishes are
 *     tests/forge/prompts.json, tests/forge/head-variety-prompts.json, tests/fixtures/forge-acceptance-wishes.json and tests/fixtures/forge-redteam.json.
 *  4. English seeds are made by a seeded generator (no model). The other six languages are written by OUR OWN model (base Glimmer, never the hosted API: see sample.ts) from a prompt
 *     built here, so grammar and idiom are the model's, and then pass rule 1 like everything else.
 */
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { foldText } from "../../../shared/kidSafeNormalize";
import { findUnsafeTerm, TERM_LANGS, type TermLang } from "../../../shared/kidSafeTerms";
import { MAKE_MAX_TEXT_CHARS, type MakeSlot } from "../../../shared/forgeMakeLimits";
import { checkForgeRecipeBrandSafety, type ForgeRecipeV1 } from "../../../shared/forgeOptimizer";
import { KID_BRAND_RE } from "../../../worker/forgeMake";
import { kidSafeText, scrubContactDetails } from "../../../worker/muse";
const HERE = fileURLToPath(new URL(".", import.meta.url));

export const WISH_SEED = "tune-v1";
export const SPLIT_SHARES = { heldout: 0.1, val: 0.05 } as const; // the rest is train
export type Split = "train" | "val" | "heldout";
export const NEAR_DUPLICATE = 0.8;

export interface Wish {
  text: string;
  lang: TermLang;
  /** What the panel would send: a slot chosen by the child, or none ("any"). */
  slot?: MakeSlot;
  split: Split;
  source: "seed" | "model";
}

export const LANG_NAMES: Record<TermLang, string> = { en: "English", es: "Spanish", fr: "French", de: "German", it: "Italian", pt: "Portuguese", tr: "Turkish" };

// ---- normalising, comparing -------------------------------------------------------------------------------------------------------------------------------------------

/** Lower-case, accents folded, punctuation gone, one space between words: the form wishes are compared and hashed in. */
export function normalizeWish(text: string): string {
  return foldText(text).replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}
const tokens = (text: string): Set<string> => new Set(normalizeWish(text).split(" ").filter(Boolean));
export function jaccard(a: string, b: string): number {
  const x = tokens(a);
  const y = tokens(b);
  if (x.size === 0 && y.size === 0) return 1;
  let inter = 0;
  for (const t of x) if (y.has(t)) inter++;
  return inter / (x.size + y.size - inter);
}

// ---- intake -----------------------------------------------------------------------------------------------------------------------------------------------------------

export type WishRejection = "empty" | "too_long" | "unsafe" | "brand" | "not_a_wish";

/** The production intake (worker/forgeMake.ts parseRequest, cleanWish) applied to a candidate wish. Returns the cleaned text. */
export function acceptWish(raw: string): { ok: true; text: string } | { ok: false; reason: WishRejection } {
  const text = scrubContactDetails(String(raw ?? ""))
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, "")
    .trim();
  if (text.length < 1) return { ok: false, reason: "empty" };
  if (text.length > MAKE_MAX_TEXT_CHARS) return { ok: false, reason: "too_long" };
  if (!/\p{L}{3,}/u.test(text) || text.includes("[email removed]") || text.includes("[number removed]")) return { ok: false, reason: "not_a_wish" };
  if (!kidSafeText(text) || findUnsafeTerm(text) !== null) return { ok: false, reason: "unsafe" };
  if (KID_BRAND_RE.test(text) || checkForgeRecipeBrandSafety({ name: text, slot: "crown", shape: { slices: [] } } as unknown as ForgeRecipeV1)) return { ok: false, reason: "brand" };
  return { ok: true, text };
}

// ---- splits and leakage -----------------------------------------------------------------------------------------------------------------------------------------------

export function splitOf(text: string, seed = WISH_SEED): Split {
  const h = createHash("sha256").update(`${seed}|${normalizeWish(text)}`).digest();
  const u = h.readUInt32BE(0) / 0x1_0000_0000;
  if (u < SPLIT_SHARES.heldout) return "heldout";
  if (u < SPLIT_SHARES.heldout + SPLIT_SHARES.val) return "val";
  return "train";
}

const read = (rel: string): unknown => JSON.parse(readFileSync(join(HERE, "..", "..", "..", rel), "utf8"));
const listOf = (d: unknown): { text?: string }[] => (Array.isArray(d) ? d : ((d as { prompts?: unknown[] }).prompts as { text?: string }[]) ?? []);

/** Every wish that is evaluation data and so must never be trained on. */
export function evalTexts(): string[] {
  const out: string[] = [];
  for (const f of ["tests/forge/prompts.json", "tests/forge/head-variety-prompts.json"]) for (const p of listOf(read(f))) if (p.text) out.push(p.text);
  for (const w of (read("tests/fixtures/forge-acceptance-wishes.json") as { wishes: { text: string }[] }).wishes) out.push(w.text);
  for (const c of (read("tests/fixtures/forge-redteam.json") as { cases: { text: string }[] }).cases) out.push(c.text);
  return out;
}

export function isEvalLike(text: string, evals: readonly string[], threshold = NEAR_DUPLICATE): boolean {
  const n = normalizeWish(text);
  return evals.some((e) => normalizeWish(e) === n || jaccard(text, e) >= threshold);
}

/** Drops near-duplicates inside a list (keeping the first of each), by word overlap. */
export function dedupeWishes<T extends { text: string }>(list: readonly T[], threshold = 0.9): T[] {
  const kept: T[] = [];
  const seen = new Set<string>();
  for (const w of list) {
    const n = normalizeWish(w.text);
    if (seen.has(n)) continue;
    if (kept.some((k) => jaccard(k.text, w.text) >= threshold)) continue;
    seen.add(n);
    kept.push(w);
  }
  return kept;
}

/** Accepts, deduplicates, removes everything that looks like evaluation data, and assigns the split. */
export function finalizeWishes(
  candidates: readonly { text: string; lang: TermLang; slot?: MakeSlot; source: Wish["source"] }[],
  opts: { seed?: string; evals?: readonly string[] } = {},
): { wishes: Wish[]; rejected: Record<string, number> } {
  const evals = opts.evals ?? evalTexts();
  const rejected: Record<string, number> = {};
  const bump = (k: string) => (rejected[k] = (rejected[k] ?? 0) + 1);
  const accepted: { text: string; lang: TermLang; slot?: MakeSlot; source: Wish["source"] }[] = [];
  for (const c of candidates) {
    const a = acceptWish(c.text);
    if (!a.ok) { bump(a.reason); continue; }
    if (isEvalLike(a.text, evals)) { bump("eval_like"); continue; }
    accepted.push({ ...c, text: a.text });
  }
  const unique = dedupeWishes(accepted);
  rejected.duplicate = accepted.length - unique.length;
  return { wishes: unique.map((w) => ({ ...w, split: splitOf(w.text, opts.seed) })), rejected };
}

// ---- English seeds (no model) -----------------------------------------------------------------------------------------------------------------------------------------

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HATS = ["wizard", "pirate", "cowboy", "chef", "party", "viking", "top", "witch", "sun", "rain", "flower", "mushroom", "knight", "explorer", "firefighter", "astronaut", "ninja", "clown", "jester", "farmer", "fairy", "elf", "king", "queen", "princess", "baker", "gardener", "scientist", "sailor", "detective", "snow", "birthday", "garden", "space", "robot", "dragon", "unicorn", "rainbow", "pumpkin", "bunny"];
const ANIMALS = ["dragon", "bunny", "fox", "dinosaur", "robot", "owl", "pig", "monkey", "cat", "dog", "bear", "lion", "tiger", "panda", "penguin", "frog", "elephant", "unicorn", "alien", "astronaut", "pumpkin", "mouse", "duck", "koala", "giraffe", "zebra", "hippo", "turtle", "snowman", "wizard", "pirate", "knight", "mermaid", "fairy", "elf", "friendly monster", "teddy bear", "chicken", "sheep", "cow", "horse", "wolf", "bee", "butterfly"];
const MODS = ["red", "blue", "green", "yellow", "purple", "pink", "orange", "white", "rainbow", "golden", "silver", "big", "small", "tiny", "tall", "round", "pointy", "fluffy", "shiny", "wobbly", "funny", "cute", "happy", "sleepy", "sparkly", "cozy"];
const HAT_FEATS = ["with stars", "with a pom pom", "with a feather", "with a bell on top", "with a bow", "with flowers", "with wings", "with a ribbon", "with little ears", "with a big brim", "with a tall point", "with spots", "with stripes", "with a star on top"];
const HEAD_FEATS = ["with big ears", "with round glasses", "with a big smile", "with little horns", "with a bow tie", "with freckles", "with a long snout", "with a fluffy mane", "with tiny wings", "with a pointy nose", "with big round eyes", "with floppy ears"];

const pick = <T,>(r: () => number, a: readonly T[]): T => a[Math.floor(r() * a.length)]!;
const an = (w: string) => (/^[aeiou]/i.test(w) ? "an" : "a");

export function seedWishes(count: number, seed = 20261104): { text: string; lang: TermLang; slot?: MakeSlot; source: "seed" }[] {
  const r = mulberry32(seed);
  const out: { text: string; lang: TermLang; slot?: MakeSlot; source: "seed" }[] = [];
  const slotFor = (s: MakeSlot): MakeSlot | undefined => (r() < 0.6 ? s : undefined);
  for (let i = 0; out.length < count * 3 && i < count * 12; i++) {
    const k = r();
    if (k < 0.45) {
      const t = pick(r, HATS), m = pick(r, MODS), f = pick(r, HAT_FEATS);
      const forms = [`${an(t)} ${t} hat`, `${an(m)} ${m} ${t} hat`, `${an(t)} ${t} hat ${f}`, `${an(m)} ${m} ${t} hat ${f}`, `I want ${an(t)} ${t} hat`, `can you make me ${an(m)} ${m} ${t} hat`, `${t} hat`];
      out.push({ text: pick(r, forms), lang: "en", slot: slotFor("crown"), source: "seed" });
    } else if (k < 0.9) {
      const a = pick(r, ANIMALS), m = pick(r, MODS), f = pick(r, HEAD_FEATS);
      const forms = [`${an(a)} ${a} head`, `${an(m)} ${m} ${a} head`, `${an(a)} ${a} head ${f}`, `${an(m)} ${m} ${a} head ${f}`, `I want to be ${an(a)} ${a}`, `make me ${an(a)} ${a}`];
      out.push({ text: pick(r, forms), lang: "en", slot: slotFor("head"), source: "seed" });
    } else {
      out.push({ text: pick(r, ["something cool", "something funny", "a surprise", "make me something fun", "something for my birthday", "something for my dog", "a thing for my teddy", "something sparkly", "something silly", "something for a party", "a hat", "a head", "something round", "something big"]), lang: "en", source: "seed" });
    }
  }
  return dedupeWishes(out).slice(0, count);
}

// ---- the other six languages, written by our own model -----------------------------------------------------------------------------------------------------------------

export type WishCategory = "hat" | "head" | "any";

/** The prompt that asks our own model for new wishes in one language. Seeds are quoted as data. */
export function expansionPrompt(args: { lang: TermLang; category: WishCategory; seeds: readonly string[]; count: number }): string {
  const what = args.category === "hat" ? "a hat or something worn on top of the head" : args.category === "head" ? "an animal or character head to put on a toy" : "a hat or a head for a toy, or something vague like a child says";
  const seeds = args.seeds.slice(0, 8).map((s) => `- "${s.replace(/"/g, "'").replace(/\s+/g, " ").trim().slice(0, 80)}"`).join("\n");
  return `You help build a test set of short things a child aged 4 to 10 might ask a toy-making app for.
Write ${args.count} NEW wishes in ${LANG_NAMES[args.lang]}, each for ${what}. Each is under 12 words, in the words a child would really use (simple, sometimes silly, sometimes vague), all different from each other.
Nothing rude, violent or frightening, no brands or characters from films, games or shows, no real people's names, no phone numbers or addresses.
Examples of the style (in English; write yours in ${LANG_NAMES[args.lang]}, do not translate these):
${seeds}
Answer with ONE JSON array of ${args.count} strings and nothing else.`;
}

/** Pulls the wishes out of a model's answer: a JSON array of strings if there is one, else one wish per non-empty line (bullets and numbers removed). */
export function parseWishList(answer: string): string[] {
  const m = /\[[\s\S]*\]/.exec(answer);
  if (m) {
    try {
      const arr: unknown = JSON.parse(m[0]);
      if (Array.isArray(arr)) return arr.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean);
    } catch {
      // fall through to lines
    }
  }
  return answer
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter((l) => l && !/^[\[\]{}`]+$/.test(l) && l.length <= MAKE_MAX_TEXT_CHARS);
}

export { TERM_LANGS };
