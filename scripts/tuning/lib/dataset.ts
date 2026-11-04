/**
 * Samples in, a training set out: the filters, the format, the split files, the leakage check and the manifest (the dataset's datasheet).
 *
 * "Safe by construction" is the point of this file: a record is kept only if its wish passed the production intake (wishgen.ts) AND its answer passed the same output checks the
 * product applies to a model (the recipe allowlist, the unsafe-term lists in seven languages, the brand list, no generic fallback name, all seven names present) AND the part
 * passed the print gates. A model trained on such records has never seen a brand word, an unsafe word or a refused wish in an answer.
 *
 * Training format: one example per record, messages = [system line, short prompt (shared/forgeTunePrompt.ts), answer], the answer being the JSON the product reads:
 * {"recipe": ..., "names": {en: {w, g}, ... tr: {w, g}}}. The prompt is rendered by the same function the Worker uses to serve the tuned model, so training and serving match.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { buildTunePrompt, TUNE_PROMPT_VERSION, TUNE_SYSTEM_LINE } from "../../../shared/forgeTunePrompt";
import { findUnsafeTerm, TERM_LANGS } from "../../../shared/kidSafeTerms";
import { KID_BRAND_RE } from "../../../worker/forgeMake";
import { sanitizeRecipe } from "../../../worker/forgeOptimizer";
import type { SampleRecord } from "./sampling";
import { evalTexts, isEvalLike, type Wish } from "./wishgen";

export type Role = "system" | "user" | "assistant";
export interface Message { role: Role; content: string }

export interface SftRecord {
  id: string;
  split: "train" | "val";
  messages: Message[];
  meta: { wish: string; lang: string; slot?: string; recipeHash: string; promptVersion: string; backend: string; model: string; runId: string };
}
/** A heldout wish with the prompt a tuned model would be given (system line and short prompt), so the trainer's generation check never has to rebuild prompt text in another language. */
export interface HeldoutRecord { id: string; wish: string; lang: string; slot?: string; messages: Message[] }

export type Rejection =
  | "failed" | "not_printable" | "wrong_source" | "bad_recipe" | "generic_name" | "names_incomplete"
  | "unsafe_output" | "brand_output" | "too_long" | "duplicate_recipe" | "heldout_sample" | "eval_like_wish";

/** A rough token count (characters over three) the training length check uses; the real tokenizer is only available on the GPU. */
export const MAX_EXAMPLE_TOKENS = 900;
const estimateTokens = (messages: Message[]) => Math.ceil(messages.reduce((n, m) => n + m.content.length, 0) / 3);

const NAME_KEYS = ["w", "g", "pl"] as const;
type Names = Record<string, { w: string; g: string; pl?: boolean }>;

/** The names in the shape the model is asked for: every language, in a fixed order, only the fields the model writes (never a signature). */
export function cleanNames(names: SampleRecord["names"]): Names | null {
  if (!names) return null;
  const out: Names = {};
  for (const l of TERM_LANGS) {
    const n = names[l];
    if (!n || typeof n.w !== "string" || !n.w.trim() || typeof n.g !== "string") return null;
    out[l] = { w: n.w, g: n.g, ...(n.pl ? { pl: true } : {}) };
  }
  return out;
}

/** What the model must write: the recipe and the names, as compact JSON. */
export function answerJson(recipe: unknown, names: Names): string {
  return JSON.stringify({ recipe, names });
}

/** The shape of a recipe apart from its words, so two samples that differ only in their name count as the same part. */
export function recipeHash(recipe: unknown): string {
  const r = { ...(recipe as Record<string, unknown>) };
  delete r.id; delete r.name; delete r.behavior; delete r.stat;
  return createHash("sha256").update(JSON.stringify(r)).digest("hex").slice(0, 12);
}

function textsOf(recipe: Record<string, unknown>, names: Names): string[] {
  return [String(recipe.name ?? ""), String(recipe.behavior ?? ""), ...Object.values(names).map((n) => n.w)];
}

export function sampleToRecord(s: SampleRecord, o: { allowStub?: boolean } = {}): { ok: true; record: SftRecord } | { ok: false; reason: Rejection } {
  if (s.split === "heldout") return { ok: false, reason: "heldout_sample" };
  if (!s.ok || !s.recipe) return { ok: false, reason: "failed" };
  if (!s.printable) return { ok: false, reason: "not_printable" };
  if (s.source.backend !== "self" && !(s.source.backend === "stub" && o.allowStub)) return { ok: false, reason: "wrong_source" };
  if (s.source.promptStyle !== "base") return { ok: false, reason: "wrong_source" };
  const clean = sanitizeRecipe(s.recipe);
  if (!clean.ok) return { ok: false, reason: "bad_recipe" };
  const recipe = clean.recipe as unknown as Record<string, unknown>;
  const names = cleanNames(s.names);
  if (!names) return { ok: false, reason: "names_incomplete" };
  if (recipe.name === "My Creation" || s.name === "My Creation") return { ok: false, reason: "generic_name" };
  for (const t of textsOf(recipe, names)) {
    if (findUnsafeTerm(t) !== null) return { ok: false, reason: "unsafe_output" };
    if (KID_BRAND_RE.test(t)) return { ok: false, reason: "brand_output" };
  }
  const messages: Message[] = [
    { role: "system", content: TUNE_SYSTEM_LINE },
    { role: "user", content: buildTunePrompt({ text: s.wish, ...(s.slot ? { slot: s.slot } : {}) }) },
    { role: "assistant", content: answerJson(recipe, names) },
  ];
  if (estimateTokens(messages) > MAX_EXAMPLE_TOKENS) return { ok: false, reason: "too_long" };
  return {
    ok: true,
    record: {
      id: s.id,
      split: s.split === "val" ? "val" : "train",
      messages,
      meta: { wish: s.wish, lang: s.lang, ...(s.slot ? { slot: s.slot } : {}), recipeHash: recipeHash(recipe), promptVersion: TUNE_PROMPT_VERSION, backend: s.source.backend, model: s.source.model, runId: s.source.runId },
    },
  };
}

export interface BuildOptions {
  /** At most this many distinct parts per wish, so a wish that is easy to satisfy does not dominate. */
  perWishMax?: number;
  allowStub?: boolean;
  evals?: readonly string[];
}

export interface Built {
  train: SftRecord[];
  val: SftRecord[];
  heldout: HeldoutRecord[];
  rejected: Partial<Record<Rejection, number>>;
  leaks: string[];
}

export function buildDataset(samples: readonly SampleRecord[], wishes: readonly Wish[], o: BuildOptions = {}): Built {
  const perWishMax = o.perWishMax ?? 2;
  const evals = o.evals ?? evalTexts();
  const rejected: Built["rejected"] = {};
  const bump = (r: Rejection) => (rejected[r] = (rejected[r] ?? 0) + 1);
  const kept = new Map<string, Set<string>>();
  const train: SftRecord[] = [];
  const val: SftRecord[] = [];
  for (const s of samples) {
    if (isEvalLike(s.wish, evals)) { bump("eval_like_wish"); continue; }
    const r = sampleToRecord(s, { allowStub: o.allowStub });
    if (!r.ok) { bump(r.reason); continue; }
    const seen = kept.get(s.wish) ?? new Set<string>();
    if (seen.has(r.record.meta.recipeHash) || seen.size >= perWishMax) { bump("duplicate_recipe"); continue; }
    seen.add(r.record.meta.recipeHash);
    kept.set(s.wish, seen);
    (r.record.split === "val" ? val : train).push(r.record);
  }
  const heldout: HeldoutRecord[] = wishes.filter((w) => w.split === "heldout").map((w, i) => ({
    id: `h${String(i + 1).padStart(4, "0")}`,
    wish: w.text,
    lang: w.lang,
    ...(w.slot ? { slot: w.slot } : {}),
    messages: [{ role: "system", content: TUNE_SYSTEM_LINE }, { role: "user", content: buildTunePrompt({ text: w.text, ...(w.slot ? { slot: w.slot } : {}) }) }],
  }));
  const leaks = [...train, ...val].filter((r) => isEvalLike(r.meta.wish, evals) || heldout.some((h) => h.wish === r.meta.wish)).map((r) => r.meta.wish);
  return { train, val, heldout, rejected, leaks: [...new Set(leaks)] };
}

// ---- datasheet --------------------------------------------------------------------------------------------------------------------------------------------------------

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const toJsonl = (rows: readonly unknown[]) => rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "");

export function stats(b: Built) {
  const all = [...b.train, ...b.val];
  const count = <T,>(xs: T[], key: (x: T) => string) => xs.reduce<Record<string, number>>((m, x) => ((m[key(x)] = (m[key(x)] ?? 0) + 1), m), {});
  const ops = count(all.flatMap((r) => { try { const a = JSON.parse(r.messages[2]!.content) as { recipe: { features?: { op?: string }[] } }; return (a.recipe.features ?? []).map((f) => f.op ?? "?"); } catch { return []; } }), (x) => x);
  return {
    examples: all.length,
    perSplit: { train: b.train.length, val: b.val.length, heldout: b.heldout.length },
    perLanguage: count(all, (r) => r.meta.lang),
    perSlot: count(all, (r) => r.meta.slot ?? "any"),
    distinctWishes: new Set(all.map((r) => r.meta.wish)).size,
    distinctParts: new Set(all.map((r) => r.meta.recipeHash)).size,
    featureOps: ops,
    approxTokens: { max: Math.max(0, ...all.map((r) => estimateTokens(r.messages))), mean: all.length ? Math.round(all.reduce((n, r) => n + estimateTokens(r.messages), 0) / all.length) : 0 },
  };
}

export interface Manifest {
  schema: 1;
  createdAt: string;
  /** "self" when every record came from our own model, "stub" when any is canned: a stub manifest must never be trained on. */
  source: "self" | "stub";
  tunePromptVersion: string;
  systemLine: string;
  files: Record<string, { sha256: string; records: number }>;
  counts: ReturnType<typeof stats>;
  rejected: Built["rejected"];
  models: { backend: string; model: string; runIds: string[] }[];
  leaks: string[];
  filters: string[];
  licence: string[];
  notes: string[];
}

export function buildManifest(b: Built, files: Record<string, string>, now = new Date()): Manifest {
  const used = new Map<string, { backend: string; model: string; runIds: Set<string> }>();
  for (const r of [...b.train, ...b.val]) {
    const k = `${r.meta.backend}|${r.meta.model}`;
    const e = used.get(k) ?? { backend: r.meta.backend, model: r.meta.model, runIds: new Set<string>() };
    e.runIds.add(r.meta.runId);
    used.set(k, e);
  }
  const hasStub = [...used.values()].some((u) => u.backend === "stub");
  return {
    schema: 1,
    createdAt: now.toISOString(),
    source: hasStub ? "stub" : "self",
    tunePromptVersion: TUNE_PROMPT_VERSION,
    systemLine: TUNE_SYSTEM_LINE,
    files: Object.fromEntries(Object.entries(files).map(([name, content]) => [name, { sha256: sha256(content), records: content.split("\n").filter(Boolean).length }])),
    counts: stats(b),
    rejected: b.rejected,
    models: [...used.values()].map((u) => ({ backend: u.backend, model: u.model, runIds: [...u.runIds].sort() })),
    leaks: b.leaks,
    filters: [
      "the wish passed the production intake (scrubbed, length, unsafe terms in seven languages, brands)",
      "the wish is not evaluation data and not near it (word overlap under 0.8)",
      "the part passed the print gates (printable)",
      "the recipe passed the production allowlist (sanitizeRecipe)",
      "no unsafe term, no brand word and no generic fallback name in any text the model wrote, in any language",
      "all seven names present",
      "at most N distinct parts per wish",
      "short enough to train on",
    ],
    licence: [
      "Answers were written by our own model, base Muse Glimmer 30B (Apache 2.0; its usage policy does not mention training on outputs).",
      "No output of the hosted Meta Model API is in this set: the Model API terms (section 10.1 ix) bar using it to train models that compete with Meta's. sample.ts refuses to run against it.",
      "The unsafe-term lists derived from LDNOOBW (CC BY 4.0) filtered this set; no list entry is training text.",
      "Wishes are our own seeds and wishes written by our own model. No child's wish is in it: no child's text has ever been stored.",
    ],
    notes: [
      "Heldout wishes are listed in heldout.jsonl for evaluation and have no answers here.",
      "Failure-to-fix (repair) pairs are NOT included; see docs/specs/forge-ai-spec.md, Tuning readiness.",
    ],
  };
}

export function readManifest(file: string): Manifest {
  return JSON.parse(readFileSync(file, "utf8")) as Manifest;
}
