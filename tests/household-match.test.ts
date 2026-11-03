// Matching a word and a scan to a household library item (shared/householdMatch.ts; docs/specs/household-library-spec.md).
//
// Everything is read from the catalog the build wrote (public/kip/household/catalog.json): nothing here assumes how many items there are or which
// are built, so it holds as the library grows. The property checks are functions of a matcher, and they are also run on matchers broken on
// purpose (fuzzy, containing, offering an unbuilt item, trusting any outline): each must be caught, or the check proves nothing.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  glbUrl,
  goodOutline,
  HARMLESS_WARNINGS,
  HOUSEHOLD_CATALOG_URL,
  bandLimit,
  matchWord,
  MIN_FIDELITY,
  normalizeWord,
  offerFor,
  offerSentence,
  parseHouseholdCatalog,
  type HouseholdCatalog,
  type HouseholdItem,
  type HouseholdOffer,
  type PhotoEvidence,
  type WordMatch,
} from "../shared/householdMatch";

const ROOT = join(__dirname, "..");
const CATALOG_PATH = join(ROOT, "public/kip/household/catalog.json");
const rawCatalog: unknown = JSON.parse(readFileSync(CATALOG_PATH, "utf8"));
const parsed = parseHouseholdCatalog(rawCatalog);
if (!parsed.ok) throw new Error(`the committed household catalog does not parse: ${parsed.message}`);
const catalog: HouseholdCatalog = parsed.catalog;

/** A small catalog written out by hand, for the cases the real one does not contain (an ambiguous word, an unbuilt item). */
function row(id: string, label: string, words: string[], built = true, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, label, words, tags: [], propMm: 90, built, glb: built ? `${id}.glb` : null, ...extra };
}
function tiny(rows: Record<string, unknown>[], rest: Record<string, unknown> = {}): HouseholdCatalog {
  const r = parseHouseholdCatalog({ items: rows, ...rest });
  if (!r.ok) throw new Error(r.message);
  return r.catalog;
}
const SMALL = tiny([
  row("fork", "Fork", ["fork"]),
  row("drinking_glass", "Drinking glass", ["glass", "drinking glass"]),
  row("paintbrush", "Paintbrush", ["paintbrush", "paint brush", "brush"]),
  row("plate", "Plate", ["plate", "dish"]),
  row("scissors", "Scissors", ["scissors"]),
  row("orange", "Orange", ["orange"]),
  row("yo_yo", "Yo-yo", ["yo-yo", "yoyo"]),
  row("ladle", "Ladle", ["ladle"], false), // listed, not built
  row("twin_a", "Twin A", ["twin"]), // the same word on two items: ambiguous
  row("twin_b", "Twin B", ["twin"]),
]);

/** Items with an age limit, written out: a ball for everyone, a blunt tool from band 2, a sharp-looking one from band 3. */
const AGED = tiny([
  row("ball", "Ball", ["ball"], true, { minBand: 0 }),
  row("plain", "Plain", ["plain"]), // says nothing: band 0
  row("hammer", "Hammer", ["hammer"], true, { minBand: 2, tags: ["garage", "tool"] }),
  row("fork", "Fork", ["fork"], true, { minBand: 3, tags: ["sharp-looking"] }),
  row("saw", "Saw", ["saw"], true, { minBand: 5 }),
  row("ladle", "Ladle", ["ladle"], false, { minBand: 0 }),
]);
const GOOD: PhotoEvidence = { kind: "outline", fidelity: 0.97, warnings: [] };

// ---- property checks, as functions of a matcher ----------------------------------------------------------------------------

type Matcher = (cat: HouseholdCatalog, word: string) => WordMatch;
type Offerer = (cat: HouseholdCatalog, word: string, photo: PhotoEvidence | null, ageBand?: unknown) => HouseholdOffer;

const lastTokenPlurals = (w: string): string[] => [`${w}s`, `${w}es`];

/** Every listed word of a built item finds that item; of an unbuilt one, nothing. */
function everyWordFindsItsItem(cat: HouseholdCatalog, match: Matcher): string[] {
  const bad: string[] = [];
  for (const item of cat.items) {
    for (const w of item.words) {
      if ((cat.wordIndex.get(normalizeWord(w))?.length ?? 0) > 1) continue; // an ambiguous word finds nothing, by design
      const m = match(cat, w);
      if (item.built && !(m.ok && m.item.id === item.id)) bad.push(`${w}: expected ${item.id}`);
      if (!item.built && m.ok) bad.push(`${w}: found ${m.item.id}, which is not built`);
    }
  }
  return bad;
}

/** Words that are one step from a listed word find nothing (unless the step lands on another listed word). None of these can read as a plural. */
function nearWordsFindNothing(cat: HouseholdCatalog, match: Matcher): string[] {
  const bad: string[] = [];
  for (const item of cat.items) {
    for (const w of item.words) {
      const near = [`${w}x`, `x${w}`, `${w} ${w}`, `big ${w}`, `${w} toy`, `${w}q`, w.length > 3 ? `${w.slice(0, -1)}q` : "", w.length > 3 ? `${w.slice(1)}` : ""].filter(Boolean);
      for (const n of near) {
        if (cat.wordIndex.has(normalizeWord(n))) continue; // it happens to be a listed word of its own
        if (/s$/.test(normalizeWord(n))) continue; // a plural reading is the plural check's business
        const m = match(cat, n);
        if (m.ok) bad.push(`"${n}" (near "${w}") found ${m.item.id}`);
      }
    }
  }
  return bad;
}

/** The plain plural of a listed word never names a second item: it finds nothing, that word's own item, or (when it is itself listed) its own item. */
function pluralsNeverNameAnotherItem(cat: HouseholdCatalog, match: Matcher): string[] {
  const bad: string[] = [];
  for (const item of cat.items) {
    for (const w of item.words) {
      for (const p of lastTokenPlurals(w)) {
        const m = match(cat, p);
        if (!m.ok) continue;
        const listed = cat.wordIndex.get(normalizeWord(p));
        if (listed) {
          if (listed.length !== 1 || m.item.id !== listed[0]) bad.push(`"${p}" is listed for ${listed.join("/")} but found ${m.item.id}`);
        } else if (m.item.id !== item.id) bad.push(`"${p}" (plural of "${w}", ${item.id}) found ${m.item.id}`);
      }
    }
  }
  return bad;
}

/** Whatever the word and the scan, an unbuilt item is never offered, and an offer carries the item the word names. */
function offersAreSound(cat: HouseholdCatalog, offer: Offerer): string[] {
  const bad: string[] = [];
  const evidences: (PhotoEvidence | null)[] = [null, { kind: "failed" }, GOOD, { kind: "outline", fidelity: 0.5, warnings: ["LOW_FIDELITY"] }, { kind: "outline", fidelity: 0.99, warnings: ["SPLIT_OBJECT"] }];
  for (const item of cat.items) {
    for (const w of item.words) {
      if ((cat.wordIndex.get(normalizeWord(w))?.length ?? 0) > 1) continue; // an ambiguous word finds nothing, by design
      for (const e of evidences) {
        const o = offer(cat, w, e);
        if (o.offer !== "none") {
          if (!o.item.built) bad.push(`${w}: offered ${o.item.id}, which is not built`);
          if (o.item.id !== item.id) bad.push(`${w}: offered ${o.item.id} for ${item.id}'s word`);
        }
        if (e === null && o.offer !== "none") bad.push(`${w}: offered with no scan`);
        if (e !== null && e.kind === "outline" && e.fidelity < MIN_FIDELITY && o.offer === "alongside") bad.push(`${w}: offered beside a poor outline`);
        if (e !== null && e.kind === "outline" && e.warnings.includes("SPLIT_OBJECT") && o.offer === "alongside") bad.push(`${w}: offered beside a split object`);
        if (item.built && e !== null && o.offer === "none") bad.push(`${w}: a built item's word was refused`);
      }
    }
  }
  return bad;
}

/** For every band: nothing is offered that the band has not reached, and nothing that the band has reached is refused for its age. */
function offersRespectAge(cat: HouseholdCatalog, offer: Offerer): string[] {
  const bad: string[] = [];
  for (const item of cat.items.filter((i) => i.built)) {
    const w = item.words.find((x) => (cat.wordIndex.get(x) ?? []).length === 1);
    if (!w) continue;
    for (let band = 0; band <= 5; band++) {
      for (const e of [GOOD, { kind: "failed" } as PhotoEvidence]) {
        const o = offer(cat, w, e, band);
        if (o.offer !== "none" && o.item.minBand > band) bad.push(`${item.id} offered at band ${band}, below its minimum ${item.minBand}`);
        if (o.offer === "none" && band >= item.minBand) bad.push(`${item.id} refused at band ${band}, which reaches its minimum ${item.minBand}`);
      }
    }
  }
  return bad;
}

const realMatch: Matcher = matchWord;
const realOffer: Offerer = offerFor;

// ---- the catalog -----------------------------------------------------------------------------------------------------------

describe("the catalog the matcher reads", () => {
  it("the committed catalog parses, and its built items are the ones with a game file next to it", () => {
    expect(catalog.items.length).toBeGreaterThan(0);
    const built = catalog.items.filter((i) => i.built);
    expect(built.length).toBeGreaterThan(0);
    for (const item of catalog.items) {
      const file = join(ROOT, "public/kip/household", `${item.id}.glb`);
      expect(existsSync(file), `${item.id}: built=${item.built} but the file ${existsSync(file) ? "exists" : "is missing"}`).toBe(item.built);
      if (item.built) {
        expect(readFileSync(file).subarray(0, 4).toString("latin1"), `${item.id} is a GLB`).toBe("glTF");
        expect(glbUrl(item)).toBe(`/kip/household/${item.id}.glb`);
      } else {
        expect(glbUrl(item)).toBeNull();
      }
    }
  });

  it("every word names exactly one item (the build's own rule, read again here)", () => {
    for (const [w, ids] of catalog.wordIndex) expect(ids, `"${w}" is on ${ids.join(", ")}`).toHaveLength(1);
    expect(HOUSEHOLD_CATALOG_URL).toBe("/kip/household/catalog.json");
  });

  const good = (): { items: Record<string, unknown>[] } => ({ items: [row("a_thing", "A thing", ["thing"])] });
  const broken: [string, (d: { items: Record<string, unknown>[] }) => unknown][] = [
    ["not an object", () => 7],
    ["an array", () => []],
    ["items missing", () => ({})],
    ["items not a list", () => ({ items: "x" })],
    ["an item that is not an object", (d) => ({ items: [...d.items, 3] })],
    ["a repeated id", (d) => ({ items: [...d.items, ...d.items] })],
    ["a bad id", (d) => ({ items: [{ ...d.items[0], id: "Bad Id" }] })],
    ["a number for an id", (d) => ({ items: [{ ...d.items[0], id: 5 }] })],
    ["a bad id on an item that is not built", (d) => ({ items: [{ ...d.items[0], id: "Bad Id", built: false, glb: null }] })],
    ["an id that is a path, with a file name to match (the game file's address is built from it)", (d) => ({ items: [{ ...d.items[0], id: "../evil", glb: "../evil.glb" }] })],
    ["an id with a slash, with a file name to match", (d) => ({ items: [{ ...d.items[0], id: "a/b", glb: "a/b.glb" }] })],
    ["an empty label", (d) => ({ items: [{ ...d.items[0], label: "  " }] })],
    ["no words", (d) => ({ items: [{ ...d.items[0], words: [] }] })],
    ["a word that is not text", (d) => ({ items: [{ ...d.items[0], words: ["ok", 4] }] })],
    ["a word that is only punctuation", (d) => ({ items: [{ ...d.items[0], words: ["!!"] }] })],
    ["a word that is too long", (d) => ({ items: [{ ...d.items[0], words: ["x".repeat(61)] }] })],
    ["tags not a list", (d) => ({ items: [{ ...d.items[0], tags: "garage" }] })],
    ["a minimum band below 0", (d) => ({ items: [{ ...d.items[0], minBand: -1 }] })],
    ["a minimum band above 5", (d) => ({ items: [{ ...d.items[0], minBand: 6 }] })],
    ["a minimum band that is a fraction", (d) => ({ items: [{ ...d.items[0], minBand: 1.5 }] })],
    ["a minimum band that is text", (d) => ({ items: [{ ...d.items[0], minBand: "2" }] })],
    ["a minimum band that is NaN", (d) => ({ items: [{ ...d.items[0], minBand: Number.NaN }] })],
    ["a minimum band that is null", (d) => ({ items: [{ ...d.items[0], minBand: null }] })],
    ["a simple flag that is not a boolean", (d) => ({ items: [{ ...d.items[0], simple: "yes" }] })],
    ["a size that is not a list", (d) => ({ items: [{ ...d.items[0], bboxMm: 90 }] })],
    ["a size of two numbers", (d) => ({ items: [{ ...d.items[0], bboxMm: [90, 90] }] })],
    ["a size with a zero", (d) => ({ items: [{ ...d.items[0], bboxMm: [90, 0, 90] }] })],
    ["a size with a negative", (d) => ({ items: [{ ...d.items[0], bboxMm: [90, 90, -3] }] })],
    ["a size with text in it", (d) => ({ items: [{ ...d.items[0], bboxMm: [90, "90", 90] }] })],
    ["a size with NaN in it", (d) => ({ items: [{ ...d.items[0], bboxMm: [90, Number.NaN, 90] }] })],
    ["a size over a metre", (d) => ({ items: [{ ...d.items[0], bboxMm: [1001, 90, 90] }] })],
    ["a size that is zero", (d) => ({ items: [{ ...d.items[0], propMm: 0 }] })],
    ["a size that is not a number", (d) => ({ items: [{ ...d.items[0], propMm: "90" }] })],
    ["a size that is infinite", (d) => ({ items: [{ ...d.items[0], propMm: Infinity }] })],
    ["built that is not a boolean", (d) => ({ items: [{ ...d.items[0], built: "yes" }] })],
    ["built with no file", (d) => ({ items: [{ ...d.items[0], glb: null }] })],
    ["built with another item's file", (d) => ({ items: [{ ...d.items[0], glb: "other.glb" }] })],
  ];
  it("the good copy parses (so every refusal below is the one change)", () => {
    expect(parseHouseholdCatalog(good()).ok).toBe(true);
  });
  it.each(broken)("a catalog with %s is refused whole", (_name, make) => {
    const r = parseHouseholdCatalog(make(good()));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message.length).toBeGreaterThan(5);
  });
});

// ---- a word ----------------------------------------------------------------------------------------------------------------

describe("normalizeWord", () => {
  it.each([
    ["Spoon", "spoon"],
    ["  SPOON  ", "spoon"],
    ["wooden   spoon", "wooden spoon"],
    ["spoon!", "spoon"],
    ["spoon?!", "spoon"],
    ["a spoon", "spoon"],
    ["An Orange", "orange"],
    ["the spoon", "spoon"],
    ["yo-yo", "yo-yo"],
    ["yo–yo", "yo-yo"],
    ["-spoon-", "spoon"],
    ["s.poon", "s poon"],
    ["spoon\ttoy\n", "spoon toy"],
    ["ＳＰＯＯＮ", "spoon"],
    ["a", "a"], // a lone article is a word, not an article
    ["", ""],
    ["   ", ""],
    ["!!!", ""],
  ])("%j -> %j", (input, out) => {
    expect(normalizeWord(input)).toBe(out);
  });
  it("is not fooled by something that is not a string", () => {
    expect(normalizeWord(undefined as unknown as string)).toBe("");
    expect(normalizeWord(5 as unknown as string)).toBe("");
  });
});

describe("matchWord on the real catalog", () => {
  it("every listed word finds its item when built, and nothing when not", () => {
    expect(everyWordFindsItsItem(catalog, realMatch)).toEqual([]);
  });

  it("the case, the spacing, a lead article and end punctuation do not matter", () => {
    const bad: string[] = [];
    for (const item of catalog.items.filter((i) => i.built)) {
      for (const w of item.words) {
        for (const typed of [w.toUpperCase(), `  ${w}  `, `a ${w}`, `the ${w}`, `${w}!`, `${w}.`, w.replace(/ /g, "   ")]) {
          const m = matchWord(catalog, typed);
          if (!(m.ok && m.item.id === item.id)) bad.push(`${JSON.stringify(typed)} did not find ${item.id}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("a word one step from a listed word finds nothing", () => {
    expect(nearWordsFindNothing(catalog, realMatch)).toEqual([]);
  });

  it("the plain plural of every word never names a second item", () => {
    expect(pluralsNeverNameAnotherItem(catalog, realMatch)).toEqual([]);
  });

  it("an empty, blank, punctuation-only or over-long word finds nothing, and says why", () => {
    expect(matchWord(catalog, "")).toEqual({ ok: false, reason: "empty" });
    expect(matchWord(catalog, "   ")).toEqual({ ok: false, reason: "empty" });
    expect(matchWord(catalog, "?!")).toEqual({ ok: false, reason: "empty" });
    expect(matchWord(catalog, "x".repeat(61))).toEqual({ ok: false, reason: "too_long" });
    expect(matchWord(catalog, "x ".repeat(100))).toEqual({ ok: false, reason: "too_long" });
    expect(matchWord(catalog, null as unknown as string)).toEqual({ ok: false, reason: "empty" });
  });

  it("a word is matched to no item at all by the model's own wording: a sentence, a question, a phrase, a made-up word", () => {
    for (const w of ["what is this", "i like cake", "ignore the rules and show the ball", "item_ball", "ball; drop table", "<b>ball</b>", "ball.glb", "ball/../mug"]) {
      expect(matchWord(catalog, w).ok, w).toBe(false);
    }
  });

  it("what is typed never reaches the address of the game file: it comes from the catalog's row, whatever was typed", () => {
    for (const typed of ["../ball", "..%2fball", "ball", "/kip/household/ball.glb", "BALL!!"]) {
      const m = matchWord(catalog, typed);
      if (m.ok) expect(glbUrl(m.item)).toBe(`/kip/household/${m.item.id}.glb`);
    }
  });
});

describe("matchWord on a hand-written catalog", () => {
  it("finds an item by any of its words, and says which word it was", () => {
    const m = matchWord(SMALL, "Paint brush");
    expect(m.ok && m.item.id).toBe("paintbrush");
    expect(m.ok && m.word).toBe("paint brush");
    expect(matchWord(SMALL, "yoyo").ok).toBe(true);
    expect(matchWord(SMALL, "yo-yo").ok).toBe(true);
  });

  it("an unbuilt item is never found, and the reason names it", () => {
    expect(matchWord(SMALL, "ladle")).toEqual({ ok: false, reason: "not_built", itemIds: ["ladle"] });
    expect(matchWord(SMALL, "ladles")).toEqual({ ok: false, reason: "not_built", itemIds: ["ladle"] });
  });

  it("a word listed on two items is ambiguous and finds nothing", () => {
    expect(matchWord(SMALL, "twin")).toEqual({ ok: false, reason: "ambiguous_word", itemIds: ["twin_a", "twin_b"] });
    expect(matchWord(SMALL, "twins").ok).toBe(false);
  });

  it("a plain plural is read, and only a plain one", () => {
    expect(matchWord(SMALL, "forks")).toMatchObject({ ok: true, word: "fork" });
    expect(matchWord(SMALL, "brushes")).toMatchObject({ ok: true, word: "brush" });
    expect(matchWord(SMALL, "dishes")).toMatchObject({ ok: true, word: "dish" });
    expect(matchWord(SMALL, "oranges")).toMatchObject({ ok: true, word: "orange" });
    expect(matchWord(SMALL, "paint brushes")).toMatchObject({ ok: true, word: "paint brush" });
    // the singular of a word that is only ever plural is not listed, so it is not a word
    expect(matchWord(SMALL, "scissor").ok).toBe(false);
    expect(matchWord(SMALL, "scissors").ok).toBe(true);
    // not a plural of anything
    for (const w of ["fo", "forkss", "forksy", "forkes", "plat", "platees"]) expect(matchWord(SMALL, w).ok, w).toBe(false);
  });

  it("the plural of glass is another object: glasses finds nothing", () => {
    expect(matchWord(SMALL, "glass").ok).toBe(true);
    expect(matchWord(SMALL, "glasses")).toEqual({ ok: false, reason: "no_word_match" });
    expect(matchWord(SMALL, "drinking glasses").ok).toBe(true); // "drinking glass" plus es, not the spectacles' word
  });

  it("a word ending in ss is not a plural of the word without its last s", () => {
    const cat = tiny([row("cros", "Cros", ["cros"]), row("glas", "Glas", ["glas"])]);
    expect(matchWord(cat, "cross").ok).toBe(false);
    expect(matchWord(cat, "glass").ok).toBe(false);
    expect(matchWord(cat, "cros").ok).toBe(true);
    expect(matchWord(cat, "cros").ok && matchWord(cat, "cross").ok).toBe(false);
  });

  it("an exact word wins over a plural reading", () => {
    const cat = tiny([row("a_bus", "Bus", ["buss"]), row("a_bu", "Bu", ["bu"])]);
    expect(matchWord(cat, "buss")).toMatchObject({ ok: true });
    expect((matchWord(cat, "buss") as { item: HouseholdItem }).item.id).toBe("a_bus");
  });

  it("two readings that reach two items find nothing", () => {
    const cat = tiny([row("box_a", "Box A", ["box"]), row("boxe_b", "Boxe B", ["boxe"])]);
    expect(matchWord(cat, "boxes")).toMatchObject({ ok: false, reason: "ambiguous_word" });
  });
});

// ---- a scan ----------------------------------------------------------------------------------------------------------------

describe("goodOutline", () => {
  const out = (fidelity: number, warnings: string[] = []): Extract<PhotoEvidence, { kind: "outline" }> => ({ kind: "outline", fidelity, warnings });
  it("the spec's threshold is 0.95", () => {
    expect(MIN_FIDELITY).toBe(0.95);
  });
  it.each([
    [0.95, true],
    [0.951, true],
    [1, true],
    [0.949, false],
    [0.9, false],
    [0, false],
    [-1, false],
    [1.01, false],
    [Number.NaN, false],
    [Number.POSITIVE_INFINITY, false],
  ])("fidelity %s -> %s", (f, ok) => {
    expect(goodOutline(out(f))).toBe(ok);
  });
  it("a fidelity that is not a number is not good", () => {
    expect(goodOutline({ kind: "outline", fidelity: "0.99" as unknown as number, warnings: [] })).toBe(false);
    expect(goodOutline({ kind: "outline", fidelity: undefined as unknown as number, warnings: [] })).toBe(false);
  });
  it.each(["SPLIT_OBJECT", "LARGE_HOLES_FILLED", "THIN_PARTS_REMOVED", "LOW_FIDELITY", "A_CODE_ADDED_LATER", ""])("the warning %j says the outline may be wrong", (w) => {
    expect(goodOutline(out(0.99, [w]))).toBe(false);
    expect(goodOutline(out(0.99, ["NOT_SYMMETRIC", w]))).toBe(false);
  });
  it.each(["POINT_BUDGET_NOT_MET", "NOT_SYMMETRIC", "GATE_REWROTE_OUTLINE"])("the warning %s does not", (w) => {
    expect(HARMLESS_WARNINGS.has(w)).toBe(true);
    expect(goodOutline(out(0.99, [w]))).toBe(true);
  });
  it("the harmless set is exactly those three: widening it is a decision, not an accident", () => {
    expect([...HARMLESS_WARNINGS].sort()).toEqual(["GATE_REWROTE_OUTLINE", "NOT_SYMMETRIC", "POINT_BUDGET_NOT_MET"]);
  });
});

// ---- the offer -------------------------------------------------------------------------------------------------------------

describe("offerFor", () => {
  const spoonCat = tiny([row("wooden_spoon", "Wooden spoon", ["spoon", "wooden spoon"]), row("scissors", "Scissors", ["scissors"]), row("orange", "Orange", ["orange"]), row("ladle", "Ladle", ["ladle"], false)]);

  it("a word and a good outline: the 3D item is offered beside the photo plate", () => {
    const o = offerFor(spoonCat, "spoon", GOOD);
    expect(o).toMatchObject({ offer: "alongside", word: "spoon" });
    expect(o.offer === "alongside" && o.item.id).toBe("wooden_spoon");
    expect(offerSentence(o)).toBe("This looks like a spoon. Want the 3D wooden spoon too?");
  });

  it("harmless warnings do not stop the offer; the others turn it into an offer of the item alone", () => {
    expect(offerFor(spoonCat, "spoon", { kind: "outline", fidelity: 0.96, warnings: ["NOT_SYMMETRIC", "POINT_BUDGET_NOT_MET"] }).offer).toBe("alongside");
    for (const w of ["SPLIT_OBJECT", "LARGE_HOLES_FILLED", "THIN_PARTS_REMOVED", "LOW_FIDELITY"]) {
      const o = offerFor(spoonCat, "spoon", { kind: "outline", fidelity: 0.99, warnings: [w] });
      expect(o, w).toMatchObject({ offer: "alone", why: "poor_outline" });
    }
    expect(offerFor(spoonCat, "spoon", { kind: "outline", fidelity: 0.9499, warnings: [] })).toMatchObject({ offer: "alone", why: "poor_outline" });
  });

  it("a photo that could not be traced, with the right word: the 3D item on its own", () => {
    const o = offerFor(spoonCat, "scissors", { kind: "failed" });
    expect(o).toMatchObject({ offer: "alone", why: "no_outline" });
    expect(offerSentence(o)).toBe("I could not trace your photo, but here is the 3D scissors.");
  });

  it("a poorly traced photo says so, and still offers the item", () => {
    const o = offerFor(spoonCat, "orange", { kind: "outline", fidelity: 0.8, warnings: ["LOW_FIDELITY"] });
    expect(offerSentence(o)).toBe("The outline of your photo is not very clear, but here is the 3D orange.");
  });

  it("no scan, an unknown word, or an unbuilt item: nothing is offered, with the reason", () => {
    expect(offerFor(spoonCat, "spoon", null)).toEqual({ offer: "none", reason: "no_scan" });
    expect(offerFor(spoonCat, "banana", GOOD)).toEqual({ offer: "none", reason: "no_word_match" });
    expect(offerFor(spoonCat, "banana", { kind: "failed" })).toEqual({ offer: "none", reason: "no_word_match" });
    expect(offerFor(spoonCat, "ladle", GOOD)).toMatchObject({ offer: "none", reason: "not_built" });
    expect(offerFor(spoonCat, "", GOOD)).toEqual({ offer: "none", reason: "empty" });
    expect(offerSentence({ offer: "none", reason: "no_scan" })).toBe("");
  });

  it("the sentence names the item with the right article", () => {
    expect(offerSentence(offerFor(spoonCat, "an orange", GOOD))).toBe("This looks like an orange. Want the 3D orange too?");
    expect(offerSentence(offerFor(spoonCat, "scissors", GOOD))).toBe("This looks like scissors. Want the 3D scissors too?");
    expect(offerSentence(offerFor(spoonCat, "wooden spoon", GOOD))).toBe("This looks like a wooden spoon. Want the 3D wooden spoon too?");
  });

  it("on the real catalog: only built items are offered, only for their own words, never without a scan, never beside a poor outline", () => {
    expect(offersAreSound(catalog, realOffer)).toEqual([]);
  });

  it("every built item can be reached by a word and offered beside a good outline, and its game file is where the offer says", () => {
    for (const item of catalog.items.filter((i) => i.built)) {
      const via = item.words.find((w) => offerFor(catalog, w, GOOD).offer === "alongside");
      expect(via, `${item.id} has no word that reaches it`).toBeDefined();
      const o = offerFor(catalog, via!, GOOD);
      expect(o.offer === "alongside" && glbUrl(o.item)).toBe(`/kip/household/${item.id}.glb`);
      expect(offerSentence(o)).toMatch(/^This looks like (an? )?[a-z -]+\. Want the 3D [a-z -]+ too\?$/);
    }
  });

  it("an offer is a plain value: it carries nothing that applies itself", () => {
    const o = offerFor(spoonCat, "spoon", GOOD);
    expect(Object.keys(o).sort()).toEqual(["item", "offer", "word"]);
    for (const v of Object.values(o)) expect(typeof v).not.toBe("function");
  });
});

// ---- age -------------------------------------------------------------------------------------------------------------------

describe("the item's front size (what the photo's colours are laid to match)", () => {
  it("is the catalog's size across by up (x and z, not the depth), or null when the row has none", () => {
    const cat = tiny([row("a_mug", "Mug", ["mug"], true, { bboxMm: [90, 38, 65] }), row("a_cup", "Cup", ["cup"])]);
    expect(cat.items[0]!.frontMm).toEqual([90, 65]);
    expect(cat.items[1]!.frontMm).toBeNull();
  });
  it("every built row of the real catalog has one, matching its own bboxMm", () => {
    const rows = (rawCatalog as { items: { id: string; built: boolean; bboxMm?: number[] }[] }).items;
    for (const item of catalog.items.filter((i) => i.built)) {
      const r = rows.find((x) => x.id === item.id)!;
      expect(item.frontMm, item.id).toEqual([r.bboxMm![0], r.bboxMm![2]]);
    }
  });
});

describe("the age band", () => {
  it("is read from each catalog row: a row that says nothing is for every band, and the flags default", () => {
    const item = (id: string) => AGED.items.find((i) => i.id === id)!;
    expect(item("plain")).toMatchObject({ minBand: 0, simple: false });
    expect(item("hammer").minBand).toBe(2);
    expect(item("fork").minBand).toBe(3);
    const withSimple = tiny([row("a_cup", "Cup", ["cup"], true, { minBand: 1, simple: true })]);
    expect(withSimple.items[0]).toMatchObject({ minBand: 1, simple: true });
  });

  it("an item is found only from its minimum band up, for every band", () => {
    for (const [word, min] of [["ball", 0], ["plain", 0], ["hammer", 2], ["fork", 3], ["saw", 5]] as const) {
      for (let band = 0; band <= 5; band++) {
        const m = matchWord(AGED, word, band);
        if (band >= min) expect(m.ok, `${word} at band ${band}`).toBe(true);
        else expect(m, `${word} at band ${band}`).toEqual({ ok: false, reason: "above_age_band", itemIds: [word] });
      }
    }
  });

  it("no band, or a band not chosen yet (null), is no limit", () => {
    for (const w of ["hammer", "fork", "saw"]) {
      expect(matchWord(AGED, w).ok, w).toBe(true);
      expect(matchWord(AGED, w, undefined).ok, w).toBe(true);
      expect(matchWord(AGED, w, null).ok, w).toBe(true);
    }
  });

  it("something that is not a band is read as the strictest band, never as no limit", () => {
    for (const bad of [Number.NaN, -1, 6, 99, 1.5, "3", "", false, true, {}, [], Number.POSITIVE_INFINITY]) {
      expect(matchWord(AGED, "hammer", bad).ok, JSON.stringify(bad)).toBe(false);
      expect(matchWord(AGED, "fork", bad).ok, JSON.stringify(bad)).toBe(false);
      expect(matchWord(AGED, "ball", bad).ok, `a band-0 item is still found: ${JSON.stringify(bad)}`).toBe(true);
    }
    expect(bandLimit(undefined)).toBeUndefined();
    expect(bandLimit(null)).toBeUndefined();
    expect(bandLimit(0)).toBe(0);
    expect(bandLimit(5)).toBe(5);
    expect(bandLimit(Number.NaN)).toBe(0);
  });

  it("a plural is held back the same way, and an unbuilt item says not built before age", () => {
    expect(matchWord(AGED, "forks", 1)).toMatchObject({ ok: false, reason: "above_age_band" });
    expect(matchWord(AGED, "forks", 3)).toMatchObject({ ok: true, word: "fork" });
    expect(matchWord(AGED, "ladle", 0)).toMatchObject({ ok: false, reason: "not_built" });
  });

  it("an item held back by age is not offered, whatever the scan found, and the answer is 'none' (which leaves the photo plate as it was)", () => {
    const evidences: PhotoEvidence[] = [GOOD, { kind: "failed" }, { kind: "outline", fidelity: 0.5, warnings: ["LOW_FIDELITY"] }];
    for (const e of evidences) {
      expect(offerFor(AGED, "fork", e, 2)).toEqual({ offer: "none", reason: "above_age_band" });
      expect(offerFor(AGED, "hammer", e, 1)).toEqual({ offer: "none", reason: "above_age_band" });
      expect(offerFor(AGED, "fork", e, 3).offer).not.toBe("none");
      expect(offerFor(AGED, "ball", e, 0).offer).not.toBe("none");
    }
    expect(offerSentence(offerFor(AGED, "fork", GOOD, 2))).toBe("");
    // the sentence for an allowed band is unchanged
    expect(offerSentence(offerFor(AGED, "fork", GOOD, 3))).toBe("This looks like a fork. Want the 3D fork too?");
  });

  it("on the real catalog, for every built item and every band: offered exactly when the band reaches the item's own minimum", () => {
    const bad: string[] = [];
    for (const item of catalog.items.filter((i) => i.built)) {
      const w = item.words.find((x) => (catalog.wordIndex.get(x) ?? []).length === 1)!;
      for (let band = 0; band <= 5; band++) {
        const o = offerFor(catalog, w, GOOD, band);
        const should = band >= item.minBand;
        if (should && !(o.offer === "alongside" && o.item.id === item.id)) bad.push(`${item.id} at band ${band}: expected an offer, got ${JSON.stringify(o).slice(0, 60)}`);
        if (!should && !(o.offer === "none" && o.reason === "above_age_band")) bad.push(`${item.id} at band ${band}: expected a hold-back`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("the library's own rule holds in the data: every sharp-looking item starts at band 3 or later, and every tool and garage item at band 2 or later (once the catalog carries minBand)", () => {
    const carries = catalog.items.some((i) => i.minBand > 0);
    if (!carries) return; // the catalog has not been given its bands yet: nothing to read
    const bad = catalog.items.filter((i) => (i.tags.includes("sharp-looking") && i.minBand < 3) || ((i.tags.includes("tool") || i.tags.includes("garage")) && i.minBand < 2)).map((i) => `${i.id}: ${i.minBand}`);
    expect(bad).toEqual([]);
  });

  it("a top-level support list is not part of the library: nothing in it is matched or offered", () => {
    const cat = tiny([row("plain", "Plain", ["plain"])], { support: [row("support_tool", "Support tool", [], true, { minBand: 0 }), row("sneaky", "Sneaky", ["sneaky"])] });
    expect(cat.items.map((i) => i.id)).toEqual(["plain"]);
    expect(cat.wordIndex.has("sneaky")).toBe(false);
    expect(matchWord(cat, "sneaky").ok).toBe(false);
    expect(matchWord(cat, "support tool").ok).toBe(false);
    expect(matchWord(cat, "support_tool").ok).toBe(false);
  });

  it("the real catalog's support list, when there is one, is kept out of the word index", () => {
    const raw = rawCatalog as { items: { id: string }[]; support?: { id: string; words?: string[] }[] };
    for (const s of raw.support ?? []) {
      expect(catalog.items.some((i) => i.id === s.id), `${s.id} is in items`).toBe(false);
      for (const w of s.words ?? []) expect(catalog.wordIndex.has(normalizeWord(w))).toBe(false);
    }
  });
});

// ---- the checks can fail ---------------------------------------------------------------------------------------------------

describe("the property checks catch a matcher that is broken", () => {
  const fuzzy: Matcher = (cat, w) => {
    const real = matchWord(cat, w);
    if (real.ok) return real;
    // a spelling repair: drop the last letter, or the first, and try again
    for (const t of [w.slice(0, -1), w.slice(1)]) {
      const m = matchWord(cat, t);
      if (m.ok) return m;
    }
    return real;
  };
  const containing: Matcher = (cat, w) => {
    const real = matchWord(cat, w);
    if (real.ok) return real;
    for (const token of normalizeWord(w).split(" ")) {
      const m = matchWord(cat, token);
      if (m.ok) return m;
    }
    return real;
  };
  const anyPlural: Matcher = (cat, w) => {
    const real = matchWord(cat, w);
    if (real.ok) return real;
    // strips any trailing s or es, and blindly takes the first item reached (no ambiguity check, no "another thing" list)
    for (const t of [w.replace(/es$/, ""), w.replace(/s$/, "")]) {
      const ids = cat.wordIndex.get(normalizeWord(t));
      const item = ids && cat.items.find((i) => i.id === ids[0]);
      if (item) return { ok: true, item, word: normalizeWord(t) };
    }
    return real;
  };
  const ignoresBuilt: Matcher = (cat, w) => {
    const ids = cat.wordIndex.get(normalizeWord(w));
    const item = ids && cat.items.find((i) => i.id === ids[0]);
    return item ? { ok: true, item, word: normalizeWord(w) } : { ok: false, reason: "no_word_match" };
  };
  const lastOnly: Matcher = (cat, w) => {
    // matches only the first word of each item
    const word = normalizeWord(w);
    const item = cat.items.find((i) => i.built && i.words[0] === word);
    return item ? { ok: true, item, word } : { ok: false, reason: "no_word_match" };
  };

  it("a fuzzy matcher is caught by the near-word check", () => {
    expect(nearWordsFindNothing(catalog, fuzzy).length).toBeGreaterThan(0);
  });
  it("a matcher that finds a word anywhere in the text is caught by the near-word check", () => {
    expect(nearWordsFindNothing(catalog, containing).length).toBeGreaterThan(0);
  });
  it("a plural rule with no care (first item reached, no list of other objects) is caught on a catalog that shows it", () => {
    const bad = pluralsNeverNameAnotherItem(SMALL, anyPlural);
    expect(bad.length).toBeGreaterThan(0);
    expect(matchWord(SMALL, "glasses").ok).toBe(false); // the real one holds the line
    expect(pluralsNeverNameAnotherItem(SMALL, realMatch)).toEqual([]);
  });
  it("a matcher that ignores whether an item is built is caught", () => {
    expect(everyWordFindsItsItem(SMALL, ignoresBuilt).length).toBeGreaterThan(0);
    expect(everyWordFindsItsItem(SMALL, realMatch)).toEqual([]);
  });
  it("a matcher that finds only each item's first word is caught", () => {
    expect(everyWordFindsItsItem(catalog, lastOnly).length).toBeGreaterThan(0);
  });

  const offerWithoutScan: Offerer = (cat, w) => {
    const m = matchWord(cat, w);
    return m.ok ? { offer: "alongside", item: m.item, word: m.word } : { offer: "none", reason: "no_word_match" };
  };
  const trustsAnyOutline: Offerer = (cat, w, photo) => {
    if (!photo) return { offer: "none", reason: "no_scan" };
    const m = matchWord(cat, w);
    if (!m.ok) return { offer: "none", reason: m.reason };
    return { offer: "alongside", item: m.item, word: m.word };
  };
  const offersUnbuilt: Offerer = (cat, w, photo) => {
    if (!photo) return { offer: "none", reason: "no_scan" };
    const ids = cat.wordIndex.get(normalizeWord(w));
    const item = ids && cat.items.find((i) => i.id === ids[0]);
    return item ? { offer: "alongside", item, word: normalizeWord(w) } : { offer: "none", reason: "no_word_match" };
  };
  it("an offer made with no scan is caught", () => {
    expect(offersAreSound(catalog, offerWithoutScan).length).toBeGreaterThan(0);
  });
  it("an offer beside any outline is caught", () => {
    expect(offersAreSound(catalog, trustsAnyOutline).length).toBeGreaterThan(0);
  });
  const ignoresAge: Offerer = (cat, w, photo) => offerFor(cat, w, photo); // drops the band
  const offByOne: Offerer = (cat, w, photo, band) => offerFor(cat, w, photo, typeof band === "number" ? Math.min(5, band + 1) : band);
  const refusesTheReachedBand: Offerer = (cat, w, photo, band) => (typeof band === "number" ? offerFor(cat, w, photo, band - 1) : offerFor(cat, w, photo, band));
  it("an offer that ignores the child's age is caught", () => {
    expect(offersRespectAge(AGED, ignoresAge).length).toBeGreaterThan(0);
    expect(offersRespectAge(AGED, realOffer)).toEqual([]);
    expect(offersRespectAge(catalog, realOffer)).toEqual([]);
  });
  it("an offer that is one band too generous, or one band too strict, is caught", () => {
    expect(offersRespectAge(AGED, offByOne).length).toBeGreaterThan(0);
    expect(offersRespectAge(AGED, refusesTheReachedBand).length).toBeGreaterThan(0);
  });
  it("an offer of an unbuilt item is caught (on a catalog that has one)", () => {
    expect(offersAreSound(SMALL, offersUnbuilt).length).toBeGreaterThan(0);
    expect(offersAreSound(SMALL, realOffer)).toEqual([]);
  });
});

describe("the module keeps its own promises", () => {
  const src = readFileSync(join(ROOT, "shared/householdMatch.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  it("it is pure: no DOM, no network, no clock, no storage, no randomness, no imports", () => {
    expect(src).not.toMatch(/\bwindow\b|\bdocument\b|\bfetch\(|localStorage|sessionStorage|indexedDB|Date\.now|new Date|Math\.random|setTimeout|setInterval|\bprocess\./);
    expect(src).not.toMatch(/^import\s/m);
  });
  it("it never names an item itself: no item id is spelled out in it", () => {
    for (const item of catalog.items) expect(src, item.id).not.toContain(`"${item.id}"`);
  });
});
