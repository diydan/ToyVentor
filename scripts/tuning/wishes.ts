/**
 * Make the wish files: English seeds from a seeded generator, and with --expand the other six languages written by OUR OWN model.
 *
 *   npx tsx scripts/tuning/wishes.ts [--out scripts/tuning/data/wishes.jsonl] [--count 600] [--seed tune-v1]
 *       [--expand --per-lang 120 --url https://<workspace>--toyventor-glimmer.us-east.modal.run/v1 --model muse-glimmer-30B]
 *       [--reclean]   re-run an existing wishes file through the intake and the splits (no model call); model-written wishes lose any slot
 *
 * Every wish passes the production intake, none is (or is near) an evaluation wish, and each is assigned train, val or heldout by a hash. The expansion talks to the Modal
 * Glimmer server directly and refuses to run against anything else (lib/sampling.ts requireOwnModel). Prints the counts, what was rejected and why, and the split sizes.
 */
import { fileURLToPath } from "node:url";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { askText, resolveBackend } from "../../worker/modelBackend";
import { parseArgs, num, str } from "./args";
import { buildEnv, readDevVars } from "./lib/inprocessWorker";
import { readJsonl, requireOwnModel, SamplingRefused } from "./lib/sampling";
import { expansionPrompt, finalizeWishes, parseWishList, seedWishes, TERM_LANGS, WISH_SEED, type Wish, type WishCategory } from "./lib/wishgen";
const HERE = fileURLToPath(new URL(".", import.meta.url));

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const out = str(flags, "out") ?? join(HERE, "data", "wishes.jsonl");
  const count = num(flags, "count", 600);
  const seed = str(flags, "seed") ?? WISH_SEED;
  const candidates: Parameters<typeof finalizeWishes>[0][number][] = flags.reclean === true ? [] : [...seedWishes(count)];
  if (flags.reclean === true) {
    // repair an existing file without calling the model again: every wish goes through the intake and the splits again, and model-written wishes lose any slot they were given
    for (const w of readJsonl<Wish>(out)) candidates.push({ text: w.text, lang: w.lang, source: w.source, ...(w.source === "seed" && w.slot ? { slot: w.slot } : {}) });
  }

  if (flags.expand === true) {
    const vars = readDevVars();
    const url = str(flags, "url") ?? process.env.SELF_TEXT_URL ?? vars.SELF_TEXT_URL ?? "";
    const model = str(flags, "model") ?? process.env.SELF_TEXT_MODEL ?? vars.SELF_TEXT_MODEL ?? "muse-glimmer-30B";
    const env = buildEnv({ url, model, key: process.env.SELF_TEXT_KEY ?? vars.SELF_TEXT_KEY, api: "chat" });
    const backend = resolveBackend(env, "text");
    requireOwnModel({ mode: url ? backend.mode : "off", promptStyle: "base", stub: false });
    if (!url) throw new SamplingRefused("no model URL: pass --url or set SELF_TEXT_URL.");
    await fetch(`${new URL(url).origin}/health`, { signal: AbortSignal.timeout(170_000) }).catch(() => undefined);
    const perLang = num(flags, "per-lang", 120);
    const perCall = 30;
    const cats: WishCategory[] = ["hat", "head", "any"];
    const seedTexts = seedWishes(60).map((s) => s.text);
    for (const lang of TERM_LANGS.filter((l) => l !== "en")) {
      for (let i = 0; i * perCall < perLang; i++) {
        const category = cats[i % cats.length]!;
        const seeds = seedTexts.slice((i * 8) % 50, (i * 8) % 50 + 8);
        const r = await askText(backend, expansionPrompt({ lang, category, seeds, count: perCall }), { timeoutMs: 90_000 });
        if (!r.ok) { console.error(`  ${lang} #${i + 1}: no answer (${r.status ?? "timeout"})`); continue; }
        // no slot: the category belongs to the PROMPT, and the model does not always write what it was asked (a head wish in a "hat" call); the child's slot choice is "any" unless the wish says
        for (const text of parseWishList(r.text)) candidates.push({ text, lang, source: "model" });
        console.log(`  ${lang} #${i + 1}: ${parseWishList(r.text).length} wishes`);
      }
    }
  }

  const { wishes, rejected } = finalizeWishes(candidates, { seed });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, wishes.map((w) => JSON.stringify(w)).join("\n") + "\n");
  const by = (k: "split" | "lang") => wishes.reduce<Record<string, number>>((m, w) => ((m[w[k]] = (m[w[k]] ?? 0) + 1), m), {});
  console.log(`wrote ${wishes.length} wishes to ${out}\n  by split: ${JSON.stringify(by("split"))}\n  by language: ${JSON.stringify(by("lang"))}\n  rejected: ${JSON.stringify(rejected)}`);
}

main().catch((e) => {
  console.error(e instanceof SamplingRefused ? `REFUSED: ${e.message}` : `error: ${(e as Error).message}`);
  process.exit(e instanceof SamplingRefused ? 2 : 1);
});
