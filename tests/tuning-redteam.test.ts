/**
 * tests/fixtures/forge-redteam.json: the SEED red-team set, and the offline half of what it can prove. Cases that must be refused at intake are checked here against the real filters;
 * the model-side cases (brand words in names, injection) need a model and are scored by scripts/tuning/eval.ts. Known gaps are asserted to STILL pass the filters, so the day one is
 * closed this test says so and the case moves to `refuse`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TERM_LANGS, findUnsafeTerm } from "../shared/kidSafeTerms";
import { kidSafeText, scrubContactDetails } from "../worker/muse";

interface Case { id: string; lang: string; text: string; expect: "refuse" | "generic-name" | "clean-output" | "gap"; kind: string; note?: string }
const SET = JSON.parse(readFileSync(join(__dirname, "fixtures", "forge-redteam.json"), "utf8")) as { cases: Case[] };
const ACCEPT = JSON.parse(readFileSync(join(__dirname, "fixtures", "forge-acceptance-wishes.json"), "utf8")) as { wishes: { text: string; group: string; expect: string }[] };

describe("the seed red-team set", () => {
  it("covers all seven languages, every kind, and has unique ids", () => {
    expect(new Set(SET.cases.map((c) => c.lang))).toEqual(new Set(TERM_LANGS));
    expect(new Set(SET.cases.map((c) => c.kind))).toEqual(new Set(["unsafe", "brand", "inject", "known-gap"]));
    expect(new Set(SET.cases.map((c) => c.id)).size).toBe(SET.cases.length);
    for (const l of TERM_LANGS) expect(SET.cases.filter((c) => c.lang === l && c.kind === "unsafe").length, l).toBeGreaterThanOrEqual(6);
  });

  it("every unsafe case is refused at intake, in every language (knife, gun, killing, drugs, nudity, blood)", () => {
    const letThrough = SET.cases.filter((c) => c.expect === "refuse" && kidSafeText(c.text)).map((c) => `${c.lang}: ${c.text}`);
    expect(letThrough).toEqual([]);
  });

  it("every refused case is refused by an age-fit word or an obscenity, never by accident of length or digits", () => {
    for (const c of SET.cases.filter((x) => x.expect === "refuse")) expect(findUnsafeTerm(c.text), c.text).not.toBeNull();
  });

  it("the known gaps still pass the filters: that is what makes them gaps, and when one is closed it must move to `refuse`", () => {
    const closed = SET.cases.filter((c) => c.expect === "gap" && !kidSafeText(c.text)).map((c) => `${c.lang}: ${c.text}`);
    expect(closed).toEqual([]);
    expect(SET.cases.filter((c) => c.expect === "gap").length).toBeGreaterThanOrEqual(3);
  });

  it("every brand case names a brand the output filter knows, so a model that repeats it is caught", async () => {
    const { KID_BRAND_RE } = await import("../worker/forgeMake");
    for (const c of SET.cases.filter((x) => x.kind === "brand")) expect(KID_BRAND_RE.test(c.text.normalize("NFD").replace(/\p{M}/gu, "")), c.text).toBe(true);
  });
});

describe("the acceptance wishes kept for evaluation", () => {
  it("are the 40 of the runs, each with an expectation, and the refusals match the live intake", () => {
    expect(ACCEPT.wishes).toHaveLength(40);
    for (const w of ACCEPT.wishes.filter((x) => x.expect === "refuse" && x.group === "intake")) expect(w.text).toContain("lego");
    // the route scrubs contact details first, then checks (worker/forgeMake.ts cleanWish, parseRequest): so does this
    for (const w of ACCEPT.wishes.filter((x) => x.expect === "make")) expect(kidSafeText(scrubContactDetails(w.text)), w.text).toBe(true);
  });
});
