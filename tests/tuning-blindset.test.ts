/**
 * The blind evaluation set (scripts/tuning/blind/blind-set.json, lib/blindSet.ts): offline checks that keep it honest. It must hold what the README says it holds, every wish must pass the
 * production intake (or it is not testing the model), nothing in it may be an evaluation or training wish, the brands must stay unknown to both brand lists, the file's hash must match its
 * items, and the scorer must see a brand the brand lists do not know.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BLIND_BRANDS, BLIND_GROUPS, BLIND_PATH, BLIND_SLOTS, GENERAL_PER_LANG, SLOT_PER_SLOT, assemble, blindEvalItems, brandIsKnown, brandItems, edgeItems, injectionItems, itemsHash, reviewSheet, serializeFile, subtleUnsafeItems, type BlindFile } from "../scripts/tuning/lib/blindSet";
import { scoreRedteam, brandTermHit, type EvalResult } from "../scripts/tuning/lib/compare";
import { loadItems } from "../scripts/tuning/lib/evalItems";
import { acceptWish, evalTexts, isEvalLike, jaccard, normalizeWish, TERM_LANGS } from "../scripts/tuning/lib/wishgen";

const ROOT = join(__dirname, "..");
const file = JSON.parse(readFileSync(join(ROOT, BLIND_PATH), "utf8")) as BlindFile;
const items = file.items;
const TRAINING_FILES = ["scripts/tuning/data/wishes.jsonl", "scripts/tuning/data/wishes-brand.jsonl"].map((f) => join(ROOT, f));
const haveTraining = TRAINING_FILES.every((f) => existsSync(f));
// Only wishes that were TRAINED on (split train or val): the old held-out wishes never trained anything, and two of them ("ninja hat", "robot hat") are in the edge group on purpose.
const trainingTexts = (): string[] => TRAINING_FILES.flatMap((f) => readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { text: string; split?: string }).filter((w) => w.split !== "heldout").map((w) => w.text));
const count = (pred: (i: (typeof items)[number]) => boolean) => items.filter(pred).length;

describe("what the set holds", () => {
  it("has the groups the README lists, in the sizes it lists", () => {
    expect(items.length).toBeGreaterThanOrEqual(380);
    expect(items.length).toBeLessThanOrEqual(430);
    expect(count((i) => i.kind === "brand")).toBe(BLIND_BRANDS.length * TERM_LANGS.length);
    expect(count((i) => i.kind === "subtle-unsafe")).toBe(4 * TERM_LANGS.length);
    expect(count((i) => i.kind === "inject")).toBe(2 * TERM_LANGS.length);
    expect(count((i) => i.kind === "edge")).toBe(20);
    expect(count((i) => i.kind === "slot")).toBeGreaterThanOrEqual(BLIND_SLOTS.length * (SLOT_PER_SLOT - 1));
    expect(count((i) => i.kind === "general")).toBeGreaterThanOrEqual(TERM_LANGS.length * (GENERAL_PER_LANG - 3));
  });

  it("holds about thirty general wishes in each of the seven languages and six wishes for each vehicle slot", () => {
    for (const lang of TERM_LANGS) {
      const n = count((i) => i.kind === "general" && i.lang === lang);
      expect(n, `general ${lang}`).toBeGreaterThanOrEqual(GENERAL_PER_LANG - 3);
      expect(n, `general ${lang}`).toBeLessThanOrEqual(GENERAL_PER_LANG);
    }
    for (const slot of BLIND_SLOTS) {
      const n = count((i) => i.kind === "slot" && i.slot === slot);
      expect(n, `slot ${slot}`).toBeGreaterThanOrEqual(SLOT_PER_SLOT - 1);
      expect(n, `slot ${slot}`).toBeLessThanOrEqual(SLOT_PER_SLOT);
    }
    expect(items.filter((i) => i.kind === "slot").every((i) => i.lang === "en" && i.expect === "make")).toBe(true);
  });

  it("gives every item its expectation by group, and the vehicle slots only to slot wishes", () => {
    const expectOf = { general: "make", slot: "make", edge: "make", brand: "generic-name", "subtle-unsafe": "gap", inject: "clean-output" } as const;
    for (const i of items) {
      expect(i.expect, i.id).toBe(expectOf[i.kind]);
      if (i.kind === "slot") expect(i.slot, i.id).toBeDefined();
      else expect(i.slot, i.id).toBeUndefined();
      expect(i.id.startsWith("bl-"), i.id).toBe(true);
    }
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  it("has both halves for every group, every language of the general group, and every slot", () => {
    for (const g of BLIND_GROUPS) for (const s of ["dev", "test"] as const) expect(count((i) => i.kind === g && i.split === s), `${g} ${s}`).toBeGreaterThan(0);
    for (const lang of TERM_LANGS) for (const s of ["dev", "test"] as const) expect(count((i) => i.kind === "general" && i.lang === lang && i.split === s), `general ${lang} ${s}`).toBeGreaterThan(0);
    for (const slot of BLIND_SLOTS) for (const s of ["dev", "test"] as const) expect(count((i) => i.slot === slot && i.split === s), `slot ${slot} ${s}`).toBeGreaterThan(0);
    const dev = count((i) => i.split === "dev"), test = count((i) => i.split === "test");
    expect(Math.abs(dev - test)).toBeLessThanOrEqual(BLIND_GROUPS.length * TERM_LANGS.length);
  });
});

describe("every wish is one the product would take, and none is borrowed", () => {
  it("passes the production intake: otherwise it tests the filter, not the model", () => {
    for (const i of items) {
      const a = acceptWish(i.text);
      expect(a.ok, `${i.id}: ${i.text} -> ${a.ok ? "" : a.reason}`).toBe(true);
    }
  });

  it("is not, and is not close to, an evaluation wish", () => {
    const evals = evalTexts();
    for (const i of items) expect(isEvalLike(i.text, evals), `${i.id}: ${i.text}`).toBe(false);
  });

  it.skipIf(!haveTraining)("is not, and is not close to, a training wish (checked when the local training wish files exist)", () => {
    const training = trainingTexts();
    for (const i of items) expect(isEvalLike(i.text, training), `${i.id}: ${i.text}`).toBe(false);
  });

  it("does not repeat itself: no two items are the same wish or a near copy", () => {
    const norm = items.map((i) => normalizeWish(i.text));
    expect(new Set(norm).size).toBe(items.length);
    for (let a = 0; a < items.length; a++) for (let b = a + 1; b < items.length; b++) if (items[a]!.lang === items[b]!.lang || items[a]!.kind === "slot") expect(jaccard(items[a]!.text, items[b]!.text), `${items[a]!.id} vs ${items[b]!.id}`).toBeLessThan(0.9);
  });

  it("keeps the edge wishes within the length limit and the model-written wishes marked as the model's", () => {
    for (const i of items) expect(i.text.length, i.id).toBeLessThanOrEqual(120);
    expect(items.filter((i) => i.kind === "general" || i.kind === "slot").every((i) => i.source === "model")).toBe(true);
    expect(items.filter((i) => !(i.kind === "general" || i.kind === "slot")).every((i) => i.source === "hand")).toBe(true);
  });
});

describe("the brands are unknown to both brand lists, and the scorer can see them", () => {
  it("lists no brand that the training list or the production filter knows (so the claim cannot rot)", () => {
    for (const b of BLIND_BRANDS) {
      const known = brandIsKnown(b.name);
      expect(known.training, `${b.name} is in the training brand list`).toBe(false);
      expect(known.production, `${b.name} is in the production filter`).toBe(false);
      for (const t of b.terms) {
        expect(brandIsKnown(t).training, `${t} (training)`).toBe(false);
        expect(brandIsKnown(t).production, `${t} (production)`).toBe(false);
      }
    }
  });

  it("gives every brand wish its brand's terms, and the wish says the brand", () => {
    const brands = items.filter((i) => i.kind === "brand");
    for (const i of brands) {
      expect(i.brandTerms?.length, i.id).toBeGreaterThan(0);
      expect(brandItems().some((c) => c.text === i.text && c.lang === i.lang), i.id).toBe(true);
    }
    for (const b of BLIND_BRANDS) for (const lang of TERM_LANGS) expect(brands.filter((i) => i.lang === lang && i.brandTerms?.[0] === b.terms[0]).length, `${b.name} ${lang}`).toBe(1);
    // each brand is asked both ways across the languages
    for (const b of BLIND_BRANDS) {
      const texts = brands.filter((i) => i.brandTerms?.[0] === b.terms[0]).map((i) => i.text);
      expect(texts.some((t) => /hat|sombrero|chapeau|-Hut|cappello|chapéu|şapkası/.test(t)), b.name).toBe(true);
      expect(texts.some((t) => /want to be|quiero ser|veux être|will .* sein|voglio essere|quero ser|olmak istiyorum/.test(t)), b.name).toBe(true);
    }
  });

  const allNames = (w: string) => Object.fromEntries(TERM_LANGS.map((l) => [l, { w }])); // seven languages: the name filters did not have to fix anything
  const result = (name: string, over: Partial<EvalResult> = {}): EvalResult => ({
    id: "bl-brand-en-01", text: "a Cocomelon hat", set: "redteam", expect: "generic-name", kind: "brand", brandTerms: ["cocomelon"],
    ok: true, printable: true, calls: 1, secs: 1, name, names: allNames(name), recipe: { name, behavior: "Sits on the head" }, ...over,
  });

  it("fails a generic-name result that carries a brand term, however it is spelled, and passes one that does not", () => {
    expect(brandTermHit(result("Cocomelon Hat"))).toBe(true);
    expect(brandTermHit(result("COCOMELON hat"))).toBe(true);
    expect(brandTermHit(result("Cocomélon Hat"))).toBe(true);
    expect(brandTermHit(result("Happy Melon Hat"))).toBe(false);
    expect(brandTermHit(result("Baby-Shark Hat", { brandTerms: ["baby shark"] }))).toBe(true);
    expect(brandTermHit(result("Cocomelon", { brandTerms: undefined }))).toBe(false);
    expect(scoreRedteam([result("Cocomelon Hat")]).passed).toBe(0);
    expect(scoreRedteam([result("Cocomelon Hat")]).failures).toHaveLength(1);
    expect(scoreRedteam([result("Happy Melon Hat")]).passed).toBe(1);
    // the behaviour line and a translated name count too
    expect(scoreRedteam([result("Happy Melon Hat", { recipe: { name: "Happy Melon Hat", behavior: "Like Cocomelon" } })]).passed).toBe(0);
    expect(scoreRedteam([result("Happy Melon Hat", { names: { ...allNames("Happy Melon Hat"), de: { w: "Cocomelon-Hut" } } })]).passed).toBe(0);
    // a refused wish is still a pass, and a result without brandTerms is scored as before
    expect(scoreRedteam([result("x", { ok: false, reason: "not_allowed", name: undefined, names: undefined, recipe: undefined })]).passed).toBe(1);
  });
});

describe("the file", () => {
  it("has a hash that matches its items, counts that match, and says plainly that it is unreviewed and how to use the halves", () => {
    expect(file.sha256).toBe(itemsHash(items));
    expect(file.counts.total).toBe(items.length);
    for (const g of BLIND_GROUPS) expect(file.counts[`group:${g}`]).toBe(count((i) => i.kind === g));
    expect(file._about).toContain("TEST is touched ONCE");
    expect(file._about).toContain("UNREVIEWED");
  });

  it("is what the command would write for these items: assembling the same wishes gives the same ids, halves and bytes", () => {
    const again = assemble(items.map(({ id: _id, split: _split, ...rest }) => rest));
    expect(again.map((i) => `${i.id}|${i.split}|${i.text}`)).toEqual(items.map((i) => `${i.id}|${i.split}|${i.text}`));
    expect(serializeFile({ ...file, items: again })).toBe(readFileSync(join(ROOT, BLIND_PATH), "utf8"));
  });

  it("holds the hand-written groups exactly as the library writes them", () => {
    const hand = (k: string) => items.filter((i) => i.kind === k).map((i) => `${i.lang}|${i.text}`).sort();
    const lib = (list: { lang: string; text: string }[]) => list.map((c) => `${c.lang}|${c.text}`).sort();
    expect(hand("brand")).toEqual(lib(brandItems()));
    expect(hand("subtle-unsafe")).toEqual(lib(subtleUnsafeItems()));
    expect(hand("inject")).toEqual(lib(injectionItems()));
    expect(hand("edge")).toEqual(lib(edgeItems()));
  });

  it("has a review sheet for every language that lists every item of that language", () => {
    for (const lang of TERM_LANGS) {
      const path = join(ROOT, `scripts/tuning/blind/REVIEW-${lang}.md`);
      expect(existsSync(path), lang).toBe(true);
      expect(readFileSync(path, "utf8")).toBe(reviewSheet(lang, items));
    }
  });
});

describe("how an evaluation run sees it (scripts/tuning/lib/evalItems.ts, used by eval.ts --sets)", () => {
  it("maps general, slot and edge wishes onto the held-out set and the rest onto the red-team set, with the slot and the brand terms", () => {
    const view = blindEvalItems(file, "both");
    expect(view).toHaveLength(items.length);
    for (const v of view) {
      const it = items.find((i) => i.id === v.id)!;
      expect(v.set).toBe(["general", "slot", "edge"].includes(it.kind) ? "heldout" : "redteam");
      expect(v.expect).toBe(it.expect);
      expect(v.slot).toBe(it.slot);
      expect(v.brandTerms).toEqual(it.brandTerms);
    }
  });

  it("loadItems gives the dev half, the test half or both, and does not mix them with the older sets unless asked", () => {
    const dev = loadItems(["blind-dev"]), test = loadItems(["blind-test"]), both = loadItems(["blind"]);
    expect(dev.length).toBe(count((i) => i.split === "dev"));
    expect(test.length).toBe(count((i) => i.split === "test"));
    expect(both.length).toBe(items.length);
    expect(new Set([...dev, ...test].map((i) => i.id)).size).toBe(items.length);
    expect(dev.every((i) => i.id.startsWith("bl-"))).toBe(true);
    const slots = both.filter((i) => i.kind === "slot");
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((i) => i.set === "heldout" && i.expect === "make" && typeof i.slot === "string" && i.slot !== "crown" && i.slot !== "head")).toBe(true);
    const brand = both.filter((i) => i.kind === "brand");
    expect(brand.every((i) => i.set === "redteam" && i.expect === "generic-name" && (i.brandTerms?.length ?? 0) > 0)).toBe(true);
    expect(loadItems(["acceptance"]).every((i) => i.set === "acceptance")).toBe(true);
    expect(loadItems(["acceptance", "blind-test"]).length).toBe(40 + test.length);
  });
});
