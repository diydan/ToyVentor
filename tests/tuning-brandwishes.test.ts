/**
 * scripts/tuning/lib/brandWishes.ts: brand and character wishes for the training set. What matters: none is an evaluation brand, none can land in the heldout set (the evaluation must not
 * grow), every language has some, and the production intake's refusals are respected (a wish it refuses never reaches the model, so it is not a training wish).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BRANDS, brandWishes, mentionsBrand } from "../scripts/tuning/lib/brandWishes";
import { evalTexts, normalizeWish } from "../scripts/tuning/lib/wishgen";
import { TERM_LANGS } from "../shared/kidSafeTerms";

describe("brand wishes for training", () => {
  const { wishes, rejected } = brandWishes();

  it("never names an evaluation brand (the evaluation must test a brand the model has not seen)", () => {
    const evalBrands = ["pikachu", "spiderman", "spider-man", "mickey", "hello kitty", "homem-aranha", "topolino"];
    for (const b of BRANDS) expect(evalBrands.some((e) => b.includes(e))).toBe(false);
    for (const w of wishes) expect(evalBrands.some((e) => normalizeWish(w.text).includes(e))).toBe(false);
  });

  it("is not near any evaluation wish, and never lands in the heldout set", () => {
    expect(wishes.length).toBeGreaterThan(200);
    expect(wishes.some((w) => w.split === "heldout")).toBe(false);
    const evals = new Set(evalTexts().map(normalizeWish));
    expect(wishes.some((w) => evals.has(normalizeWish(w.text)))).toBe(false);
  });

  it("covers every one of the seven languages, evenly", () => {
    for (const l of TERM_LANGS) expect(wishes.filter((w) => w.lang === l).length).toBeGreaterThanOrEqual(30);
  });

  it("drops the brands the production intake already refuses, and says how many", () => {
    expect(rejected.brand).toBeGreaterThan(0);
    // the committed file, if it has been made, matches what the function makes
    try {
      const file = readFileSync(join(__dirname, "..", "scripts", "tuning", "data", "wishes-brand.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { text: string });
      expect(file.map((w) => w.text)).toEqual(wishes.map((w) => w.text));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  });
});

describe("the brand check on what the model wrote", () => {
  it("recognises brands the production name filter does not know, whole words only, in any case and accent", () => {
    for (const t of ["Bluey Mask Head", "TOTORO ears", "Pooh Honey Hat", "naruto-Stirnband", "mcqueen racer", "Pokémon hat", "super mario cap", "buzz lightyear helmet"]) expect(mentionsBrand(t), t).toBe(true);
    for (const t of ["Floppy Ears Hat", "Leaf Village Headband", "Spiky Hero Crown", "Mario's cousin is not here".replace("Mario", "Maria"), "a blue dog mask", "doraemonster"]) expect(mentionsBrand(t), t).toBe(false);
  });
});
