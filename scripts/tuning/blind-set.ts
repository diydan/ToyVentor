/**
 * Write the blind evaluation set (see scripts/tuning/lib/blindSet.ts for what it is and scripts/tuning/blind/README.md for how to use it).
 *
 *   npx tsx scripts/tuning/blind-set.ts                 # curated groups are rebuilt; the model-written wishes are REUSED if the file has them, else the model is asked
 *   npx tsx scripts/tuning/blind-set.ts --no-model      # never call the model (fails if the file has no model-written wishes to reuse)
 *   npx tsx scripts/tuning/blind-set.ts --force-model   # ask the model again and REPLACE the model-written wishes (changes the frozen set: only before anything is judged on it)
 *       [--url https://<workspace>--toyventor-glimmer.us-east.modal.run/v1 --model muse-glimmer-30B] [--max-calls 45]
 *
 * The model is OUR OWN base Glimmer (never the hosted API: lib/sampling.ts requireOwnModel refuses it), asked one call at a time. Everything else is deterministic. Writes
 * scripts/tuning/blind/blind-set.json and one REVIEW-<lang>.md per language for a native reader.
 */
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { askText, resolveBackend } from "../../worker/modelBackend";
import { parseArgs, num, str } from "./args";
import { buildEnv, readDevVars } from "./lib/inprocessWorker";
import { readJsonl, requireOwnModel, SamplingRefused } from "./lib/sampling";
import { TERM_LANGS, evalTexts, parseWishList } from "./lib/wishgen";
import {
  BLIND_PATH, BLIND_SLOTS, GENERAL_ANGLES, GENERAL_PER_LANG, SLOT_PER_SLOT, assemble, brandItems, buildFile, chooseModelWishes, edgeItems, generalPrompt, injectionItems, reviewSheet, serializeFile,
  slotPrompt, subtleUnsafeItems, type BlindFile, type BlindItem, type Candidate, type Rejection,
} from "./lib/blindSet";
const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(HERE, "..", "..");

const zero = (): Record<Rejection, number> => ({ unsafe: 0, brand: 0, empty: 0, too_long: 0, not_a_wish: 0, eval_like: 0, training_like: 0, duplicate: 0, surplus: 0 });

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const out = join(ROOT, BLIND_PATH);
  const existing: BlindFile | null = existsSync(out) ? (JSON.parse(readFileSync(out, "utf8")) as BlindFile) : null;
  const reusable = (existing?.items ?? []).filter((i) => i.source === "model");
  const force = flags["force-model"] === true;
  const noModel = flags["no-model"] === true;
  if (force && noModel) throw new Error("--force-model and --no-model contradict each other");
  const useModel = force || (!noModel && reusable.length === 0);
  if (noModel && reusable.length === 0) throw new Error(`--no-model, but ${BLIND_PATH} has no model-written wishes to reuse: run once without it`);

  const evals = evalTexts();
  const training = [join(HERE, "data", "wishes.jsonl"), join(HERE, "data", "wishes-brand.jsonl")].flatMap((f) => readJsonl<{ text: string }>(f).map((w) => w.text));
  console.log(`checking against ${evals.length} evaluation wishes and ${training.length} training wishes${training.length === 0 ? " (NO training wish file found: the training check is skipped)" : ""}`);

  let model: BlindItem[] = reusable;
  const rejected = zero();
  if (useModel) {
    const vars = readDevVars();
    const url = str(flags, "url") ?? process.env.SELF_TEXT_URL ?? vars.SELF_TEXT_URL ?? "";
    const modelName = str(flags, "model") ?? process.env.SELF_TEXT_MODEL ?? vars.SELF_TEXT_MODEL ?? "muse-glimmer-30B";
    const env = buildEnv({ url, model: modelName, key: process.env.SELF_TEXT_KEY ?? vars.SELF_TEXT_KEY, api: "chat" });
    const backend = resolveBackend(env, "text");
    requireOwnModel({ mode: url ? backend.mode : "off", promptStyle: "base", stub: false });
    if (!url) throw new SamplingRefused("no model URL: pass --url or set SELF_TEXT_URL.");
    await fetch(`${new URL(url).origin}/health`, { signal: AbortSignal.timeout(170_000) }).catch(() => undefined);
    const maxCalls = num(flags, "max-calls", 45);
    let calls = 0;
    const ask = async (prompt: string, label: string): Promise<string[]> => {
      if (calls >= maxCalls) { console.error(`  ${label}: call budget (${maxCalls}) used up, skipped`); return []; }
      calls++;
      const r = await askText(backend, prompt, { timeoutMs: 150_000 });
      if (!r.ok) { console.error(`  call ${calls} ${label}: no answer (${r.status ?? "timeout"})`); return []; }
      const list = parseWishList(r.text);
      console.log(`  call ${calls}/${maxCalls} ${label}: ${list.length} wishes`);
      return list;
    };
    const fresh: BlindItem[] = [];
    const taken: string[] = [...brandItems(), ...subtleUnsafeItems(), ...injectionItems(), ...edgeItems()].map((c) => c.text);
    for (const lang of TERM_LANGS) {
      const cands: Candidate[] = [];
      const pick = () => chooseModelWishes(cands, { count: GENERAL_PER_LANG, evals, training, taken, seedKey: `general|${lang}` });
      // three calls (twenty wishes each) for every language, then up to two more angles while it is short of thirty
      for (let a = 0; a < GENERAL_ANGLES.length; a++) {
        if (a >= 3 && pick().kept.length >= GENERAL_PER_LANG) break;
        for (const text of await ask(generalPrompt({ lang, angle: GENERAL_ANGLES[a]!, count: 20 }), `${lang} angle ${a + 1}`)) cands.push({ text, angle: a });
      }
      const r = pick();
      for (const k of Object.keys(r.rejected) as Rejection[]) rejected[k] += r.rejected[k];
      console.log(`  ${lang}: kept ${r.kept.length} of ${cands.length} written`);
      for (const text of r.kept) { fresh.push({ id: "", lang, text, expect: "make", kind: "general", split: "dev", source: "model" }); taken.push(text); }
    }
    for (const slot of BLIND_SLOTS) {
      const cands: Candidate[] = (await ask(slotPrompt({ slot, count: 14 }), `slot ${slot}`)).map((text) => ({ text, angle: 0 }));
      let r = chooseModelWishes(cands, { count: SLOT_PER_SLOT, evals, training, taken, seedKey: `slot|${slot}` });
      if (r.kept.length < SLOT_PER_SLOT) {
        for (const text of await ask(slotPrompt({ slot, count: 14 }), `slot ${slot} (second call)`)) cands.push({ text, angle: 1 });
        r = chooseModelWishes(cands, { count: SLOT_PER_SLOT, evals, training, taken, seedKey: `slot|${slot}` });
      }
      for (const k of Object.keys(r.rejected) as Rejection[]) rejected[k] += r.rejected[k];
      console.log(`  slot ${slot}: kept ${r.kept.length} of ${cands.length} written`);
      for (const text of r.kept) { fresh.push({ id: "", lang: "en", text, expect: "make", kind: "slot", slot, split: "dev", source: "model" }); taken.push(text); }
    }
    console.log(`model calls: ${calls}; rejected: ${JSON.stringify(rejected)}`);
    model = fresh;
  } else {
    console.log(`reusing ${reusable.length} model-written wishes from ${BLIND_PATH} (no model call)`);
  }

  const parts = [
    ...model.map(({ id: _id, split: _split, ...rest }) => rest),
    ...brandItems(), ...subtleUnsafeItems(), ...injectionItems(), ...edgeItems(),
  ];
  const items = assemble(parts);
  const file = buildFile(items);
  mkdirSync(join(ROOT, "scripts/tuning/blind"), { recursive: true });
  writeFileSync(out, serializeFile(file));
  for (const lang of TERM_LANGS) writeFileSync(join(ROOT, `scripts/tuning/blind/REVIEW-${lang}.md`), reviewSheet(lang, items));
  console.log(`wrote ${items.length} items to ${BLIND_PATH}  sha256 ${file.sha256}\n${JSON.stringify(file.counts)}`);
  if (existing && existing.sha256 !== file.sha256) console.log(`NOTE: the hash changed (was ${existing.sha256}).`);
}

main().catch((e) => {
  console.error(e instanceof SamplingRefused ? `REFUSED: ${e.message}` : `error: ${(e as Error).message}`);
  process.exit(e instanceof SamplingRefused ? 2 : 1);
});
