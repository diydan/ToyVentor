/**
 * The sampler's logic, apart from the network: who may be sampled, what a record holds, how a run is planned and resumed, and the one guard that matters most.
 *
 * THE GUARD (requireOwnModel): training data may only come from our own model. The Meta Model API terms (section 10.1 ix) bar using hosted Spark's outputs to train, fine-tune or
 * distill a model that competes with Meta's or to build training sets from them; base Glimmer is Apache 2.0 and its usage policy is silent on training on outputs. So a sampling run
 * refuses to start unless the text backend is "self" and uses the base prompt, and every record says which model wrote it.
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { MakeSlot } from "../../../shared/forgeMakeLimits";
import type { TermLang } from "../../../shared/kidSafeTerms";
import { normalizeWish, type Split, type Wish } from "./wishgen";

export interface SampleSource {
  /** "self" = our own model; "stub" = canned recipes with no model, for showing the format only. */
  backend: "self" | "stub";
  model: string;
  promptStyle: "base" | "tuned";
  runId: string;
  at: string;
}

export interface SampleRecord {
  id: string;
  wish: string;
  lang: TermLang;
  slot?: MakeSlot;
  split: Split;
  sampleIndex: number;
  ok: boolean;
  /** Why it failed (a MakeFailureReason), when it did. */
  reason?: string;
  printable?: boolean;
  calls?: number;
  secs?: number;
  recipe?: unknown;
  names?: Record<string, { w: string; g: string; pl?: boolean }>;
  name?: string;
  source: SampleSource;
}

export function sampleId(wish: string, index: number): string {
  return `${createHash("sha256").update(normalizeWish(wish)).digest("hex").slice(0, 10)}-${index}`;
}

export class SamplingRefused extends Error {}

/** Refuses a run that would put hosted Spark's, or a tuned model's, outputs into a training set. */
export function requireOwnModel(args: { mode: string; promptStyle: string; stub: boolean }): void {
  if (args.stub) return;
  if (args.mode !== "self") {
    throw new SamplingRefused(
      `The text backend is "${args.mode}", not "self". Training data may only come from our own model: the Meta Model API terms (section 10.1 ix) bar using the hosted models' outputs to train or distill, ` +
        "and a hosted call is not what the tuned model must learn from. Set SELF_TEXT_URL, SELF_TEXT_MODEL and SELF_TEXT_KEY (scripts/modal/glimmer_server.py) and run again.",
    );
  }
  if (args.promptStyle !== "base") {
    throw new SamplingRefused('Sampling uses the base model and the base prompt. Outputs of a tuned model are not a source for the next tune; use --prompt base (the default).');
  }
}

export interface PlanOptions {
  /** Count a failed record as not done, so a resumed run tries it again (the old record stays in the file; the dataset builder keeps the success). */
  retryFailed?: boolean;
  perWish: number;
  maxCalls: number;
  /** Which splits may be sampled. heldout is never in the list unless the caller asks for it by name, and the CLI does not. */
  splits: readonly Split[];
  existing: readonly SampleRecord[];
}

export interface Task { wish: Wish; index: number }

/** What is still to do: every (wish, index) below `perWish` that has no record yet, in the allowed splits, cut at `maxCalls`. */
export function planSampling(wishes: readonly Wish[], o: PlanOptions): { todo: Task[]; alreadyDone: number; cutByMaxCalls: number } {
  const done = new Set(o.existing.filter((r) => r.ok || !o.retryFailed).map((r) => r.id));
  const todo: Task[] = [];
  let alreadyDone = 0;
  for (const w of wishes) {
    if (!o.splits.includes(w.split)) continue;
    for (let i = 0; i < o.perWish; i++) {
      if (done.has(sampleId(w.text, i))) alreadyDone++;
      else todo.push({ wish: w, index: i });
    }
  }
  const cut = Math.max(0, todo.length - o.maxCalls);
  return { todo: todo.slice(0, o.maxCalls), alreadyDone, cutByMaxCalls: cut };
}

/** A fixed pseudo-random order, so that a run cut at --max-calls samples every language and every kind of wish instead of the first ones in the file. Same seed, same order. */
export function orderForSampling<T extends { text: string }>(wishes: readonly T[], seed = "sample-order-v1"): T[] {
  const key = (w: T) => createHash("sha256").update(`${seed}|${normalizeWish(w.text)}`).digest("hex");
  return [...wishes].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

export type CallFn = (task: Task) => Promise<Omit<SampleRecord, "id" | "wish" | "lang" | "slot" | "split" | "sampleIndex" | "source">>;

/** Runs the tasks with `concurrency` in flight; a thrown error becomes a failed record, never a crashed run. Records are handed over as they finish, so a run can be stopped and resumed. */
export async function runSampling(todo: readonly Task[], call: CallFn, o: { concurrency: number; source: SampleSource; onRecord: (r: SampleRecord) => void }): Promise<void> {
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= todo.length) return;
      const t = todo[i]!;
      let body: Awaited<ReturnType<CallFn>>;
      try {
        body = await call(t);
      } catch (e) {
        body = { ok: false, reason: `error:${String((e as Error)?.message ?? e).slice(0, 80)}` };
      }
      o.onRecord({ id: sampleId(t.wish.text, t.index), wish: t.wish.text, lang: t.wish.lang, ...(t.wish.slot ? { slot: t.wish.slot } : {}), split: t.wish.split, sampleIndex: t.index, source: o.source, ...body });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, o.concurrency) }, worker));
}

// ---- files ------------------------------------------------------------------------------------------------------------------------------------------------------------

export function readJsonl<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l) as T);
}

export function appendJsonl(file: string, row: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(row)}\n`);
}

/**
 * An honest estimate for the console, from the three 40-wish runs of 2026-11-04: with two requests in flight on one L40S a wish costs about 13 s of that container's time (13.3 s in run 2,
 * 16.6 s in run 3), and the container costs $1.95 an hour at list price. A container holds two slots, so concurrency 4 means two containers: the same GPU-hours and cost, half the wait.
 * (An earlier figure of 6 s a call came from solo call times and understated the cost by about half.) An estimate, not a quote.
 */
export function estimateCost(calls: number, concurrency: number): { minutes: number; dollars: number } {
  const containers = Math.max(1, Math.ceil(concurrency / 2));
  const containerSeconds = calls * 13;
  return { minutes: Math.round(containerSeconds / containers / 60), dollars: Math.round((containerSeconds / 3600) * 1.95 * 100) / 100 };
}
