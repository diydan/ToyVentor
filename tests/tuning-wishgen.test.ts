/**
 * scripts/tuning/lib/wishgen.ts: the wishes a tuned recipe writer would be trained on. The properties that matter are the ones that keep a training set honest: nothing the product
 * would refuse, nothing that is evaluation data, a split that never changes, and no wish in two sets.
 */
import { describe, expect, it } from "vitest";
import { NEAR_DUPLICATE, acceptWish, dedupeWishes, evalTexts, expansionPrompt, finalizeWishes, isEvalLike, jaccard, normalizeWish, parseWishList, seedWishes, splitOf } from "../scripts/tuning/lib/wishgen";
import { findUnsafeTerm } from "../shared/kidSafeTerms";

describe("intake: only wishes the product would accept", () => {
  it("accepts ordinary wishes in all seven languages", () => {
    for (const t of ["a wizard hat", "un sombrero de mago", "un chapeau de magicien", "ein Zauberhut", "un cappello da mago", "um chapéu de mágico", "büyücü şapkası", "a scary monster head"]) expect(acceptWish(t), t).toEqual({ ok: true, text: t });
  });

  it("refuses an unsafe term in any language, a brand word, an empty or oversized wish, and text that is not a wish", () => {
    expect(acceptWish("un sombrero con un cuchillo")).toMatchObject({ ok: false, reason: "unsafe" });
    expect(acceptWish("ein Hut mit Messer")).toMatchObject({ ok: false, reason: "unsafe" });
    expect(acceptWish("kanlı bir şapka")).toMatchObject({ ok: false, reason: "unsafe" });
    expect(acceptWish("a lego hat")).toMatchObject({ ok: false, reason: "brand" });
    expect(acceptWish("a pikachu hat")).toMatchObject({ ok: false, reason: "brand" });
    expect(acceptWish("   ")).toMatchObject({ ok: false, reason: "empty" });
    expect(acceptWish("a".repeat(121))).toMatchObject({ ok: false, reason: "too_long" });
    expect(acceptWish("12 34")).toMatchObject({ ok: false, reason: "not_a_wish" });
    expect(acceptWish("call 555-123-4567")).toMatchObject({ ok: false });
  });

  it("strips the JSON a model wrapped a wish in: brackets, quotes and commas", () => {
    for (const raw of ['["un chapeau rose"]', '"un chapeau rose",', '[ "un chapeau rose" ]', "{un chapeau rose}", '“un chapeau rose”']) expect(acceptWish(raw), raw).toEqual({ ok: true, text: "un chapeau rose" });
  });

  it("scrubs contact details the way the route does and strips quotes a model put around a wish", () => {
    expect(acceptWish('"a pirate hat"')).toEqual({ ok: true, text: "a pirate hat" });
    expect(acceptWish("a hat, email bob@example.com")).toMatchObject({ ok: false, reason: "not_a_wish" });
  });
});

describe("splits", () => {
  const sample = seedWishes(400);
  it("are stable: the same wish gets the same split every time, and a different seed moves them", () => {
    for (const w of sample.slice(0, 50)) expect(splitOf(w.text)).toBe(splitOf(w.text));
    const moved = sample.filter((w) => splitOf(w.text) !== splitOf(w.text, "another-seed")).length;
    expect(moved).toBeGreaterThan(20);
  });

  it("ignore case, accents and punctuation, so a respelt wish cannot land in another set", () => {
    expect(splitOf("A Wizard Hat!")).toBe(splitOf("a wizard hat"));
    expect(splitOf("Un sombrero de MAGO")).toBe(splitOf("un sómbrero de mago."));
  });

  it("come out at about 10% heldout, 5% val and the rest train", () => {
    const n = { train: 0, val: 0, heldout: 0 };
    for (let i = 0; i < 4000; i++) n[splitOf(`wish number ${i}`)]++;
    expect(n.heldout / 4000).toBeGreaterThan(0.08);
    expect(n.heldout / 4000).toBeLessThan(0.12);
    expect(n.val / 4000).toBeGreaterThan(0.035);
    expect(n.val / 4000).toBeLessThan(0.065);
    expect(n.train / 4000).toBeGreaterThan(0.8);
  });
});

describe("evaluation wishes never reach training", () => {
  const evals = evalTexts();
  it("the evaluation set is the 60 prompts, the 13 variety prompts, the 40 acceptance wishes and the red-team cases", () => {
    expect(evals.length).toBeGreaterThanOrEqual(60 + 13 + 40 + 70);
  });

  it("an exact match, a respelling and a near duplicate are all kept out; an unrelated wish is not", () => {
    expect(isEvalLike("a wizard hat", evals)).toBe(true);
    expect(isEvalLike("A WIZARD HAT!!", evals)).toBe(true);
    expect(isEvalLike("a tall wizard hat with little stars", evals)).toBe(true);
    expect(isEvalLike("a tall wizard hat with little stars please", evals)).toBe(true);
    expect(isEvalLike("a sparkly seahorse head", evals)).toBe(false);
    expect(jaccard("a wizard hat", "a wizard hat with stars")).toBeLessThan(NEAR_DUPLICATE);
  });

  it("finalizeWishes removes eval-like wishes, counts them, and what is left is in exactly one set", () => {
    const cands = [{ text: "a wizard hat", lang: "en" as const, source: "seed" as const }, { text: "a sparkly seahorse head", lang: "en" as const, source: "seed" as const }, { text: "a hat with a knife", lang: "en" as const, source: "seed" as const }];
    const { wishes, rejected } = finalizeWishes(cands);
    expect(wishes.map((w) => w.text)).toEqual(["a sparkly seahorse head"]);
    expect(rejected.eval_like).toBe(1);
    expect(rejected.unsafe).toBe(1);
  });

  it("a generated set of 600 seeds has no eval wish in it, none the intake refuses, and no wish in two splits", () => {
    const { wishes } = finalizeWishes(seedWishes(600));
    expect(wishes.length).toBeGreaterThan(250);
    for (const w of wishes) {
      expect(isEvalLike(w.text, evals), w.text).toBe(false);
      expect(acceptWish(w.text).ok, w.text).toBe(true);
      expect(findUnsafeTerm(w.text), w.text).toBeNull();
    }
    const bySplit = new Map<string, string>();
    for (const w of wishes) {
      const key = normalizeWish(w.text);
      expect(bySplit.has(key) && bySplit.get(key) !== w.split, w.text).toBe(false);
      bySplit.set(key, w.split);
    }
    expect(new Set(wishes.map((w) => w.split))).toEqual(new Set(["train", "val", "heldout"]));
  });
});

describe("the English seeds", () => {
  it("are deterministic for a seed, different for another, varied, and mix explicit slots with none", () => {
    expect(seedWishes(100)).toEqual(seedWishes(100));
    expect(seedWishes(100, 1)).not.toEqual(seedWishes(100, 2));
    const s = seedWishes(300);
    expect(new Set(s.map((w) => normalizeWish(w.text))).size).toBe(s.length);
    expect(s.some((w) => w.slot === "crown")).toBe(true);
    expect(s.some((w) => w.slot === "head")).toBe(true);
    expect(s.some((w) => w.slot === undefined)).toBe(true);
    for (const w of s) expect(w.lang).toBe("en");
  });

  it("dedupe drops respellings and near duplicates but keeps different wishes", () => {
    expect(dedupeWishes([{ text: "a wizard hat" }, { text: "A wizard hat!" }, { text: "a pirate hat" }]).map((w) => w.text)).toEqual(["a wizard hat", "a pirate hat"]);
  });
});

describe("the expansion prompt for the other six languages", () => {
  it("names the language, asks for a JSON array of the right size, and quotes the seeds as data", () => {
    const p = expansionPrompt({ lang: "tr", category: "head", seeds: ['a fox head', 'a "quoted" thing'], count: 25 });
    expect(p).toContain("Turkish");
    expect(p).toContain("25 NEW wishes");
    expect(p).toContain("JSON array of 25 strings");
    expect(p).toContain('- "a fox head"');
    expect(p).toContain("- \"a 'quoted' thing\"");
    expect(p).toContain("no brands");
  });

  it("parseWishList reads a JSON array, a fenced one, and bullet or numbered lines, and ignores anything else", () => {
    expect(parseWishList('["un sombrero rojo", "una cabeza de zorro"]')).toEqual(["un sombrero rojo", "una cabeza de zorro"]);
    expect(parseWishList('Here you go:\n```json\n["a", "b c"]\n```')).toEqual(["a", "b c"]);
    expect(parseWishList("1. un sombrero rojo\n2) una cabeza de zorro\n- un gato\n")).toEqual(["un sombrero rojo", "una cabeza de zorro", "un gato"]);
    expect(parseWishList("")).toEqual([]);
    // the shapes a model really produced on 2026-11-04: one tiny array per line, one quoted string per line, trailing commas
    expect(parseWishList('["un chapeau de clown"]\n["un koala avec une feuille"]')).toEqual(["un chapeau de clown", "un koala avec une feuille"]);
    expect(parseWishList('"une tête de cochon",\n"un chapeau rose"')).toEqual(["une tête de cochon", "un chapeau rose"]);
    expect(parseWishList('["a", "b"]\n["c"]').sort()).toEqual(["a", "b", "c"].sort());
    expect(parseWishList('["ok", 5, null, {"a":1}]')).toEqual(["ok"]);
  });
});
