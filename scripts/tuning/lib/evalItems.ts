/**
 * Which wishes an evaluation run asks, by set name: heldout, acceptance, redteam and the blind set (blind-dev, blind-test, blind). Kept out of scripts/tuning/eval.ts, which runs its command
 * when imported, so that a test can read it.
 */
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { MakeSlot } from "../../../shared/forgeMakeLimits";
import { BLIND_PATH, blindEvalItems, type BlindFile } from "./blindSet";
import type { EvalResult, Expect } from "./compare";
import { readJsonl } from "./sampling";
const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const DATA = join(HERE, "..", "data");

export interface Item { id: string; text: string; set: EvalResult["set"]; expect: Expect; slot?: MakeSlot; lang?: string; kind?: string; brandTerms?: string[] }

export function loadItems(sets: string[]): Item[] {
  const items: Item[] = [];
  if (sets.includes("heldout")) for (const h of readJsonl<{ id: string; wish: string; slot?: "crown" | "head"; lang?: string }>(join(DATA, "dataset", "heldout.jsonl"))) items.push({ id: h.id, text: h.wish, set: "heldout", expect: "make", slot: h.slot, lang: h.lang });
  if (sets.includes("acceptance")) {
    const d = JSON.parse(readFileSync(join(ROOT, "tests/fixtures/forge-acceptance-wishes.json"), "utf8")) as { wishes: { text: string; group: string; slot?: "crown" | "head"; expect: Expect }[] };
    d.wishes.forEach((w, i) => items.push({ id: `a${String(i + 1).padStart(2, "0")}`, text: w.text, set: "acceptance", expect: w.expect, slot: w.slot, kind: w.group }));
  }
  if (sets.includes("redteam")) {
    const d = JSON.parse(readFileSync(join(ROOT, "tests/fixtures/forge-redteam.json"), "utf8")) as { cases: { id: string; text: string; lang: string; expect: Expect; kind: string }[] };
    for (const c of d.cases) items.push({ id: c.id, text: c.text, set: "redteam", expect: c.expect, lang: c.lang, kind: c.kind });
  }
  // the blind set (scripts/tuning/blind/README.md): blind-dev to iterate on, blind-test ONCE per candidate, blind for both halves
  for (const which of ["dev", "test"] as const) {
    if (!sets.includes("blind") && !sets.includes(`blind-${which}`)) continue;
    const file = join(ROOT, BLIND_PATH);
    if (!existsSync(file)) throw new Error(`no blind set at ${BLIND_PATH}: run  npx tsx scripts/tuning/blind-set.ts  first`);
    items.push(...blindEvalItems(JSON.parse(readFileSync(file, "utf8")) as BlindFile, which));
  }
  return items;
}
