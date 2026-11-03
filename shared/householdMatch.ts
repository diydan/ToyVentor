/**
 * Matching a child's word, and what a photo scan found, to an item of the household library
 * (docs/specs/household-library-spec.md, "Matching a word or a photo to an item").
 *
 * The match is a closed list, deterministic and never silent. The model never names an item; only the child's own word does, and only
 * through the catalog's word lists. The result is an OFFER (the child says yes), never an applied choice.
 *
 *   parseHouseholdCatalog   `public/kip/household/catalog.json` as the build wrote it, checked field by field. Everything below is
 *                           derived from it: nothing here knows how many items there are or which are built.
 *   normalizeWord           case, spacing, punctuation, and a leading "a", "an" or "the". Nothing else.
 *   matchWord               a word to one built item, or a reason why not.
 *   goodOutline             a scan's outline is trustworthy enough to say "this is that object" (fidelity and warnings).
 *   offerFor                the word and what the photo scan found: offer the 3D item beside the photo plate, on its own, or not at all.
 *   offerSentence           the one calm sentence the child reads.
 *
 * A word matches when it is in the word list of EXACTLY ONE item and that item is built. A near word finds nothing: no spelling repair,
 * no containment ("big spoon"), no synonyms. The one allowance is a plain plural ("forks"), and only where it cannot name a second item
 * (`matchWord` returns nothing when two candidate readings reach two items) or another object altogether (`PLURAL_IS_ANOTHER_THING`).
 *
 * AGE. `ageBand` (0 to 5, the app's six bands, src/lib/age.ts) limits what is offered: an item whose `minBand` (read from the catalog row, never from a
 * list here) is above the child's band is never offered, and the result is `none` with the reason `above_age_band`. That leaves the flat photo plate
 * exactly as it was: the offer is only ever an extra. `undefined` or `null` (no band chosen yet) is no limit; anything else that is not a band (a
 * negative, a fraction, 6, NaN, text) is read as the strictest band, 0, because a corrupt value must not open more than a chosen one would.
 *
 * Pure: no DOM, no network, no clock, no storage. Imports nothing.
 */

// ---- the catalog ---------------------------------------------------------------------------------------------------------

export interface HouseholdItem {
  id: string;
  /** Name for a child ("Wooden spoon"). */
  label: string;
  /** The words that find it, normalised. */
  words: string[];
  tags: string[];
  /** Longest side at prop scale, mm. */
  propMm: number;
  /** The youngest age band (0 to 5) that is offered this item; 0 when the catalog row does not say. */
  minBand: number;
  /** A simplified version of the item for the youngest bands (the catalog's flag; nothing here depends on it yet). */
  simple: boolean;
  /** The size of the item's front, mm, across by up (the catalog's `bboxMm` x and z), or null when the row has none: the photo's colours are laid to match. */
  frontMm: [number, number] | null;
  /** True when the game asset exists: only a built item is ever offered. */
  built: boolean;
  /** The GLB's file name inside the household folder (`<id>.glb`), for a built item. */
  glb: string | null;
}

export interface HouseholdCatalog {
  items: readonly HouseholdItem[];
  /** Normalised word -> ids of the items that list it. More than one id means the word is ambiguous and finds nothing. */
  wordIndex: ReadonlyMap<string, readonly string[]>;
}

export type CatalogResult = { ok: true; catalog: HouseholdCatalog } | { ok: false; message: string };

export const HOUSEHOLD_FOLDER = "/kip/household";
/** Where the build writes the catalog, as the viewer sees it. */
export const HOUSEHOLD_CATALOG_URL = `${HOUSEHOLD_FOLDER}/catalog.json`;
/** The longest word a child may type (the scan route's own limit). */
export const MAX_WORD_LENGTH = 60;

const ID_RE = /^[a-z][a-z0-9_]{0,40}$/;
/** The highest age band index (src/lib/age.ts has six bands, 0 to 5). */
export const MAX_BAND = 5;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

const ARTICLES: ReadonlySet<string> = new Set(["a", "an", "the"]);

/**
 * A typed word in the form the word lists use: lower case, one space between words, letters, digits and hyphens only (any other mark
 * becomes a space, so "s.poon" does not turn into "spoon"), a leading "a", "an" or "the" dropped. Empty when nothing is left.
 */
export function normalizeWord(input: string): string {
  if (typeof input !== "string") return "";
  const cleaned = input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‐-―]/g, "-")
    .replace(/[^\p{L}\p{N}-]+/gu, " ")
    .replace(/(^|\s)-+|-+(?=\s|$)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  const parts = cleaned.split(" ").filter(Boolean);
  if (parts.length > 1 && ARTICLES.has(parts[0]!)) parts.shift();
  return parts.join(" ");
}

/** Read the build's `catalog.json` field by field. A catalog that is wrong in any way is refused whole: nothing is offered from half of one. */
export function parseHouseholdCatalog(raw: unknown): CatalogResult {
  if (!isRecord(raw) || !Array.isArray(raw.items)) return { ok: false, message: "the household catalog has no item list" };
  const items: HouseholdItem[] = [];
  const seen = new Set<string>();
  for (const [i, r] of raw.items.entries()) {
    if (!isRecord(r)) return { ok: false, message: `item ${i} is not an object` };
    const { id, label, words, tags, propMm, built, glb, minBand, simple, bboxMm } = r;
    if (typeof id !== "string" || !ID_RE.test(id)) return { ok: false, message: `item ${i} has no usable id` };
    if (seen.has(id)) return { ok: false, message: `${id} is listed twice` };
    seen.add(id);
    if (typeof label !== "string" || !label.trim() || label.length > 60) return { ok: false, message: `${id} has no usable label` };
    if (!isStringArray(words) || words.length === 0) return { ok: false, message: `${id} has no words` };
    if (!isStringArray(tags)) return { ok: false, message: `${id} has no tag list` };
    if (typeof propMm !== "number" || !Number.isFinite(propMm) || propMm <= 0 || propMm > 200) return { ok: false, message: `${id} has no usable size` };
    if (typeof built !== "boolean") return { ok: false, message: `${id} does not say whether it is built` };
    if (built && glb !== `${id}.glb`) return { ok: false, message: `${id} is built but its file is not ${id}.glb` };
    if (minBand !== undefined && !(typeof minBand === "number" && Number.isInteger(minBand) && minBand >= 0 && minBand <= MAX_BAND)) return { ok: false, message: `${id} has a minimum age band that is not 0 to ${MAX_BAND}` };
    if (simple !== undefined && typeof simple !== "boolean") return { ok: false, message: `${id} has a simple flag that is not true or false` };
    if (bboxMm !== undefined && !(Array.isArray(bboxMm) && bboxMm.length === 3 && bboxMm.every((v) => typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 1000))) return { ok: false, message: `${id} has a size that is not three positive numbers` };
    const norm = words.map(normalizeWord);
    if (norm.some((w) => !w || w.length > MAX_WORD_LENGTH)) return { ok: false, message: `${id} lists a word that is empty or too long` };
    items.push({ id, label: label.trim(), words: [...new Set(norm)], tags: [...tags], propMm, minBand: (minBand as number | undefined) ?? 0, simple: (simple as boolean | undefined) ?? false, frontMm: Array.isArray(bboxMm) ? [bboxMm[0] as number, bboxMm[2] as number] : null, built, glb: built ? (glb as string) : null });
  }
  const index = new Map<string, string[]>();
  for (const item of items) {
    for (const w of item.words) {
      const ids = index.get(w);
      if (!ids) index.set(w, [item.id]);
      else if (!ids.includes(item.id)) ids.push(item.id);
    }
  }
  return { ok: true, catalog: { items, wordIndex: index } };
}

// ---- a word ---------------------------------------------------------------------------------------------------------------

/**
 * Plurals that name a different object from the item's own word, so reading them as a plural would be wrong. "Glasses" are spectacles
 * (left out of the library), not drinking glasses.
 */
export const PLURAL_IS_ANOTHER_THING: ReadonlySet<string> = new Set(["glasses"]);

export type WordNone = "empty" | "too_long" | "no_word_match" | "ambiguous_word" | "not_built" | "above_age_band";
export type WordMatch = { ok: true; item: HouseholdItem; word: string } | { ok: false; reason: WordNone; itemIds?: string[] };

/** The singular readings of a plural last word: "forks" -> fork, "brushes" -> brush, "dishes" -> dish. A "ss" ending is not a plural. */
function singularReadings(word: string): string[] {
  const at = word.lastIndexOf(" ") + 1;
  const head = word.slice(0, at);
  const last = word.slice(at);
  const out: string[] = [];
  if (last.endsWith("s") && !last.endsWith("ss") && last.length > 2) out.push(head + last.slice(0, -1));
  if (/(s|x|z|ch|sh)es$/.test(last)) out.push(head + last.slice(0, -2));
  return out;
}

/** The band limit as a number, or `undefined` for no limit. Not a band at all (NaN, 7, -1, 2.5, text) is the strictest band, 0. */
export function bandLimit(ageBand: unknown): number | undefined {
  if (ageBand === undefined || ageBand === null) return undefined;
  return typeof ageBand === "number" && Number.isInteger(ageBand) && ageBand >= 0 && ageBand <= MAX_BAND ? ageBand : 0;
}

/**
 * The item a typed word names, if exactly one built item lists it. An exact word wins; only when the word is not listed is a plural read,
 * and only if its readings reach one item. With an `ageBand`, an item for older children is not found (`above_age_band`).
 */
export function matchWord(catalog: HouseholdCatalog, input: string, ageBand?: unknown): WordMatch {
  const raw = typeof input === "string" ? input.trim() : "";
  if (raw.length > MAX_WORD_LENGTH * 2) return { ok: false, reason: "too_long" };
  const word = normalizeWord(raw);
  if (!word) return { ok: false, reason: "empty" };
  if (word.length > MAX_WORD_LENGTH) return { ok: false, reason: "too_long" };

  let listed = word;
  let ids = catalog.wordIndex.get(word);
  if (!ids) {
    if (PLURAL_IS_ANOTHER_THING.has(word)) return { ok: false, reason: "no_word_match" };
    const reached = new Map<string, string>(); // item id -> the reading that reached it
    let ambiguous = false;
    for (const reading of singularReadings(word)) {
      const found = catalog.wordIndex.get(reading);
      if (!found) continue;
      if (found.length > 1) ambiguous = true;
      for (const id of found) if (!reached.has(id)) reached.set(id, reading);
    }
    if (reached.size === 0) return { ok: false, reason: "no_word_match" };
    if (ambiguous || reached.size > 1) return { ok: false, reason: "ambiguous_word", itemIds: [...reached.keys()] };
    const [only] = [...reached];
    ids = [only![0]];
    listed = only![1];
  }
  if (ids.length !== 1) return { ok: false, reason: "ambiguous_word", itemIds: [...ids] };
  const item = catalog.items.find((i) => i.id === ids![0]);
  if (!item) return { ok: false, reason: "no_word_match" };
  if (!item.built) return { ok: false, reason: "not_built", itemIds: [item.id] };
  const limit = bandLimit(ageBand);
  if (limit !== undefined && item.minBand > limit) return { ok: false, reason: "above_age_band", itemIds: [item.id] };
  return { ok: true, item, word: listed };
}

// ---- a scan ---------------------------------------------------------------------------------------------------------------

/** An outline below this overlap with its own mask is not trusted to be the object (the spec's number). */
export const MIN_FIDELITY = 0.95;

/**
 * Warnings a scan may carry and still be trusted: they say the edge is blocky or that a symmetry step did not apply, not that the shape may
 * be the wrong one. Any other code, known or not, is read as "the outline may be wrong" (SPLIT_OBJECT, LARGE_HOLES_FILLED,
 * THIN_PARTS_REMOVED, LOW_FIDELITY, and whatever is added later).
 */
export const HARMLESS_WARNINGS: ReadonlySet<string> = new Set(["POINT_BUDGET_NOT_MET", "NOT_SYMMETRIC", "GATE_REWROTE_OUTLINE"]);

/** What the photo scan gave back, as far as matching cares. */
export type PhotoEvidence =
  /** An outline came back. */
  | { kind: "outline"; fidelity: number; warnings: readonly string[] }
  /** The photo could not be traced (no object found, or no usable outline). */
  | { kind: "failed" };

/** One object, traced well: fidelity at least `MIN_FIDELITY` (and a real number no bigger than 1), and no warning that says it may be wrong. */
export function goodOutline(e: Extract<PhotoEvidence, { kind: "outline" }>): boolean {
  if (typeof e.fidelity !== "number" || !Number.isFinite(e.fidelity) || e.fidelity < MIN_FIDELITY || e.fidelity > 1) return false;
  return e.warnings.every((w) => HARMLESS_WARNINGS.has(w));
}

export type OfferNone = WordNone | "no_scan" | "scan_not_run";

export type HouseholdOffer =
  | { offer: "none"; reason: OfferNone }
  /** The word and a good outline agree: offer the 3D item beside the photo plate. */
  | { offer: "alongside"; item: HouseholdItem; word: string }
  /** The word is right but the photo is not trusted (`no_outline`: it could not be traced; `poor_outline`: it was traced badly): offer the 3D item on its own. */
  | { offer: "alone"; item: HouseholdItem; word: string; why: "no_outline" | "poor_outline" };

/**
 * Offer a 3D item for a word and what the photo scan found. `null` evidence means no photo was scanned: nothing is offered. An item held back for
 * the child's `ageBand` is not offered either; either way the answer is `none`, which leaves the photo plate as it was.
 */
export function offerFor(catalog: HouseholdCatalog, word: string, photo: PhotoEvidence | null, ageBand?: unknown): HouseholdOffer {
  if (!photo) return { offer: "none", reason: "no_scan" };
  const m = matchWord(catalog, word, ageBand);
  if (!m.ok) return { offer: "none", reason: m.reason };
  if (photo.kind === "failed") return { offer: "alone", item: m.item, word: m.word, why: "no_outline" };
  if (goodOutline(photo)) return { offer: "alongside", item: m.item, word: m.word };
  return { offer: "alone", item: m.item, word: m.word, why: "poor_outline" };
}

// ---- what the child reads --------------------------------------------------------------------------------------------------

/** "a spoon", "an orange", and no article for a word that is only ever plural ("scissors"). */
export function withArticle(word: string): string {
  if (word.endsWith("s") && !word.endsWith("ss")) return word;
  return `${/^[aeiou]/.test(word) ? "an" : "a"} ${word}`;
}

/** The sentence for an offer, from the item's label and the word it matched; empty for no offer. */
export function offerSentence(o: HouseholdOffer): string {
  if (o.offer === "none") return "";
  const label = o.item.label.toLowerCase();
  if (o.offer === "alongside") return `This looks like ${withArticle(o.word)}. Want the 3D ${label} too?`;
  if (o.why === "no_outline") return `I could not trace your photo, but here is the 3D ${label}.`;
  return `The outline of your photo is not very clear, but here is the 3D ${label}.`;
}

/** Where a built item's game asset is served from. */
export function glbUrl(item: Pick<HouseholdItem, "glb">): string | null {
  return item.glb ? `${HOUSEHOLD_FOLDER}/${item.glb}` : null;
}
