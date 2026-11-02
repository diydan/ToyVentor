#!/usr/bin/env tsx
/**
 * Forge eval harness (docs/specs/forge-ai-spec.md, "Eval harness").
 *
 * Sends each prompt in tests/forge/prompts.json to a proposer (a model, or a stub for plumbing
 * tests), submits the Recipe v1 it returns to the forge-optimizer daemon, and reports:
 * first-attempt and final pass rates, model calls per prompt, job latency p50/p95, failures per
 * gate id, how often the daemon's L1/L3 clamp would have changed the recipe, and tokens.
 * A run with --max-calls 1 is the "single shot" mode; the default allows the spec's 4 calls
 * (propose plus up to 3 repairs). The daemon always applies L1, so "no legalizer" cannot be
 * measured directly; `recipesTouchedByLegalizer` reports what the clamp changed instead.
 *
 * Usage:
 *   npm run forge:optimizer                      # in another terminal (default http://127.0.0.1:8791)
 *   npx tsx scripts/forge-eval.ts --proposer stub --slots crown --limit 6
 *   MODEL_API_KEY=... npx tsx scripts/forge-eval.ts --proposer spark --out report.json
 *
 * The Spark proposer reads its key only from MODEL_API_KEY or META_MODEL_API_KEY in the
 * environment, and calls the Responses API the way worker/muse.ts does. It is off unless asked.
 * The prompt text here is v0, written for the baseline; expect to iterate on it.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildFeedback,
  extractJsonObject,
  gateKeysOf,
  legalizeLoft,
  summarize,
  type AttemptRecord,
  type DaemonJob,
  type FeedbackItem,
  type LoftChange,
  type PromptResult,
} from "./lib/forgeEvalCore";

const ROOT = resolve(import.meta.dirname, "..");

interface PromptCase {
  id: string;
  slot: string;
  text: string;
}

interface ProposeResult {
  recipe: unknown | null;
  tokensIn?: number;
  tokensOut?: number;
}

interface Proposer {
  name: string;
  propose(p: PromptCase): Promise<ProposeResult>;
  repair(p: PromptCase, prev: unknown, feedback: FeedbackItem[]): Promise<ProposeResult>;
}

interface Opts {
  proposer: "stub" | "spark";
  daemon: string;
  prompts: string;
  slots: string[] | null;
  limit: number | null;
  maxCalls: number;
  out: string | null;
  resume: boolean;
  promptVersion: "v0" | "v1" | "v2";
  jobTimeoutMs: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseArgs(argv: string[]): Opts {
  const o: Opts = {
    proposer: "stub",
    daemon: process.env.FORGE_OPTIMIZER_URL?.trim() || "http://127.0.0.1:8791",
    prompts: resolve(ROOT, "tests/forge/prompts.json"),
    slots: null,
    limit: null,
    maxCalls: 4,
    out: null,
    resume: false,
    promptVersion: "v1",
    jobTimeoutMs: 240_000,
  };
  const args = argv.filter((a) => a !== "--");
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = () => {
      const v = args[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    switch (a) {
      case "--proposer": {
        const v = next();
        if (v !== "stub" && v !== "spark") throw new Error("--proposer must be stub or spark");
        o.proposer = v;
        break;
      }
      case "--daemon":
        o.daemon = next().replace(/\/+$/, "");
        break;
      case "--prompts":
        o.prompts = resolve(next());
        break;
      case "--slots":
        o.slots = next().split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "--limit":
        o.limit = Math.max(1, Number.parseInt(next(), 10) || 1);
        break;
      case "--max-calls":
        o.maxCalls = Math.max(1, Math.min(4, Number.parseInt(next(), 10) || 1));
        break;
      case "--out":
        o.out = resolve(next());
        break;
      case "--resume":
        o.resume = true;
        break;
      case "--prompt": {
        const v = next();
        if (v !== "v0" && v !== "v1" && v !== "v2") throw new Error("--prompt must be v0, v1 or v2");
        o.promptVersion = v;
        break;
      }
      case "--job-timeout-s":
        o.jobTimeoutMs = Math.max(5, Number.parseInt(next(), 10) || 240) * 1000;
        break;
      default:
        throw new Error(`unknown argument: ${a}`);
    }
  }
  return o;
}

// ---------------------------------------------------------------- daemon client

const TERMINAL = new Set(["print_ready", "digital_only", "failed"]);

interface JobOutcome {
  compileError: boolean;
  status: string;
  job: DaemonJob | null;
}

function authHeaders(): Record<string, string> {
  const token = process.env.FORGE_OPTIMIZER_TOKEN?.trim();
  return {
    "content-type": "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function submitToDaemon(base: string, recipe: unknown, timeoutMs: number): Promise<JobOutcome> {
  let retries = 0;
  for (;;) {
    const res = await fetch(`${base}/v1/jobs`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ recipe }),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 429 && retries < 6) {
      retries++;
      await sleep((Number(res.headers.get("retry-after")) || 5) * 1000);
      continue;
    }
    if (res.status === 422) return { compileError: true, status: "invalid", job: null };
    if (res.status !== 202 && res.status !== 200) {
      return { compileError: false, status: `http_${res.status}`, job: null };
    }
    const first = (await res.json()) as { job_id?: string } & DaemonJob;
    if (!first.job_id) return { compileError: false, status: "no_job_id", job: null };
    const t0 = Date.now();
    let job: DaemonJob = first;
    while (!TERMINAL.has(job.status)) {
      if (Date.now() - t0 > timeoutMs) return { compileError: false, status: "timeout", job };
      await sleep(300);
      const poll = await fetch(`${base}/v1/jobs/${first.job_id}`, {
        headers: authHeaders(),
        signal: AbortSignal.timeout(30_000),
      });
      if (!poll.ok) return { compileError: false, status: `http_${poll.status}`, job };
      job = (await poll.json()) as DaemonJob;
    }
    return { compileError: false, status: job.status, job };
  }
}

// ---------------------------------------------------------------- proposers

/** Deterministic pseudo-random in [0, 1) from a string seed and an index. */
function unit(seed: string, k: number): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const x = Math.sin((h >>> 0) * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function stubRecipe(p: PromptCase, slotOverride?: string): unknown {
  const slot = slotOverride ?? p.slot;
  const base = {
    v: 1,
    id: `stub_${p.id}`,
    name: `Stub ${p.id}`,
    stat: "Glow",
    behavior: "Plumbing test recipe, not model output",
    slot,
  };
  if (slot === "hand") {
    const outer = 12 + unit(p.id, 1) * 14;
    return {
      ...base,
      shape: { kind: "star2d", points: 3 + Math.floor(unit(p.id, 2) * 6), outer_r_mm: outer, inner_r_mm: outer * 0.5 },
    };
  }
  const w = 18 + unit(p.id, 3) * 30;
  const d = w * (0.5 + unit(p.id, 4) * 0.4);
  const h = 12 + unit(p.id, 5) * 14;
  const flare = unit(p.id, 6) < 0.3 ? 1.5 : 1.05;
  return {
    ...base,
    shape: {
      kind: "loft",
      slices: [
        { z: 0, w, d, r: 4 },
        { z: h * 0.35, w: w * flare, d: d * flare, r: 5 },
        { z: h * 0.75, w: w * 0.5, d: d * 0.5, r: 4 },
        { z: h, w: w * 0.2, d: d * 0.2, r: 2.5 },
      ],
    },
  };
}

function scaleSlices(recipe: unknown, f: number): unknown {
  if (!isRecord(recipe) || !isRecord(recipe.shape) || !Array.isArray(recipe.shape.slices)) return recipe;
  const slices = recipe.shape.slices.map((s: unknown) =>
    isRecord(s)
      ? {
          ...s,
          w: typeof s.w === "number" ? s.w * f : s.w,
          d: typeof s.d === "number" ? s.d * f : s.d,
          r: typeof s.r === "number" ? s.r * f : s.r,
        }
      : s,
  );
  return { ...recipe, shape: { ...recipe.shape, slices } };
}

function stubProposer(): Proposer {
  return {
    name: "stub",
    async propose(p) {
      return { recipe: stubRecipe(p) };
    },
    async repair(p, prev, feedback) {
      if (feedback.some((f) => f.gate === "compile" || f.gate === "parse_error")) {
        return { recipe: stubRecipe(p, "crown") };
      }
      // Plumbing only: shrink everything so a marginal size usually moves out of the band.
      return { recipe: scaleSlices(prev, feedback.some((f) => f.gate === "small_part_marginal") ? 0.8 : 0.9) };
    },
  };
}

const SAFETY =
  "You help a young child (ages 4 to 10) build a pretend toy. Keep it kind and safe. Never mention brands, trademarks or real-world products. Never include real names or personal details.";

const RECIPE_PROMPT_V0 = `${SAFETY}

You design ONE small printable accessory for a child's snap-together toy character or vehicle. Answer with a single JSON object (a "Recipe v1") and nothing else.

Recipe v1 fields:
- "v": 1
- "id": lowercase letters, digits and underscores
- "name": 2 to 4 friendly words
- "stat": one of "Speed", "Spin", "Torque", "Glow"
- "behavior": one short sentence
- "slot": one of crown (hat on a head), head, back, hand, front, rollbar, spoiler, hood, roof, exhaust. Use the slot you are given.
- "shape": for every slot except hand, {"kind":"loft","slices":[...]} with 3 to 12 slices from bottom to top. Each slice: {"z": height in mm (first slice z=0), "w": width mm, "d": depth mm, "r": corner radius mm, optional "x","y": offsets}. Widths and depths are between 3.6 and 90 mm. For slot hand use {"kind":"star2d","points":3-12,"outer_r_mm":10-28,"inner_r_mm":5-20} or {"kind":"profile2d","points":[[x,z],...3 to 64 points]}.
- "features": optional list of at most 6: {"op":"knob","radius_mm":1.8-6} or {"op":"brim","width_mm":16-42,"depth_mm":12-32,"thickness_mm":1.6-4}.

Printing rules (the checker rejects breaking them):
- No overhangs: going up, each slice may be at most 0.78 x its height step wider than the slice below, per side. Shrinking is always fine.
- Size: the smallest cylinder that can hold the whole part must be under 29.5 mm across, or over 36 mm across. Sizes from 31.75 to 34.9 mm are rejected.
- No brand or trademark words anywhere.

Example for slot crown:
{"v":1,"id":"wizard_hat","name":"Starlight Wizard Hat","stat":"Glow","behavior":"Tall hat that clicks onto the crown studs","slot":"crown","shape":{"kind":"loft","slices":[{"z":0,"w":23.4,"d":11.4,"r":4.6},{"z":7.5,"w":27.5,"d":17,"r":6.2,"y":-1.8},{"z":17,"w":11,"d":11,"r":4.5,"y":-0.5},{"z":23.5,"w":5.6,"d":5.6,"r":2.4,"y":1.2}]}}`;

/**
 * v1 adds the per-slot facts v0 left out. The first Spark baseline (v0) failed every head because
 * `character_head` puts the crown studs at z = height_mm (30.5) and the prompt never said so, and
 * because heads started wider than the 24.6 x 12.1 collar. Footprints are from the slot table in
 * public/kip/LLM_PART_PROMPT.md and VEHICLE_SLOTS in parts/kip/sdk/kip_partspec_sdk.py.
 * The hand paragraph is a hypothesis from the baseline failures (the daemon centres the shape's
 * bounding box on the grip, so a pole at the edge of a flag does not touch the grip neck).
 */
const SLOT_FACTS_V1 = `Slot facts (z = 0 is the bottom of your shape, sizes in mm):
- crown: sits on a head's crown studs. Slice 0 should be about 23.8 wide x 11.6 deep.
- head: sits on a neck collar 24.6 wide x 12.1 deep. Slice 0 should be about 24.6 x 12.1, then grow gradually. The head is 30.5 tall: your LAST slice must be at z = 30.5, or set "height_mm" (24 to 38) inside "shape" and end at that z. Crown studs are added on top automatically, so do not model them. Do not model eyes, mouths or noses; the front stays smooth.
- back: sits on a backpack plate 24.6 x 24.6. Slice 0 should be about that size.
- front, rollbar, spoiler: sit on a socket pad 23.8 wide x 11.6 deep. Slice 0 should be about that size.
- exhaust: sits on a socket pad 11.6 wide x 23.8 deep. Slice 0 should be about that size.
- hood, roof: sit on a socket pad 23.8 x 23.8. Slice 0 should be about that size.
- hand: a flat 2D shape on a stick that a toy hand holds. For stars and flowers use star2d (points 3 to 12, outer_r_mm 12 to 28, inner_r_mm about half of outer_r_mm). For anything else use profile2d: points [x, z] with z from 0 up, 18 to 40 tall. The shape is centred on the grip automatically, so its handle must run up the middle of the shape's width, starting at z = 0, and everything must be one connected piece. Do not put a stick at the edge of the shape (a flag pole on the left edge fails). Avoid parts thinner than 3 mm.`;

function outputTextOf(body: unknown): string {
  if (!isRecord(body)) return "";
  if (typeof body.output_text === "string") return body.output_text;
  let text = "";
  for (const item of Array.isArray(body.output) ? body.output : []) {
    if (!isRecord(item)) continue;
    for (const part of Array.isArray(item.content) ? item.content : []) {
      if (isRecord(part) && typeof part.text === "string") text += part.text;
    }
  }
  return text;
}

/**
 * v2 documents the feature ops the daemon gained after the first taste check (ears, horns, spikes,
 * and a brim that survives). In the v1 run Spark left "features" empty for 18 of 22 crowns and heads,
 * even for "a pirate hat with a wide brim", and Dan rated 19 of those parts 1.47 out of 5 on average:
 * hats were tapered blocks and every head was the same box. The v2 text also tells it to keep the body
 * simple and put the character in the features.
 */
const FEATURES_V2 = `- "features": optional list of at most 6 from these ops. A body shape alone is a plain block, so use them whenever the request names a part like a brim, ears, horns or points:
  - {"op":"brim","width_mm":16-42,"depth_mm":12-32,"thickness_mm":1.6-4}: a flat brim around the bottom (pirate, sun, cowboy or top hat). Keep the slices narrow and let the brim make the width.
  - {"op":"ears","style":"round"|"pointy"|"tall","width_mm":5-16,"height_mm":0-26,"tilt_deg":0-35}: a mirrored pair of flat ears on the upper corners of a head or crown. Bear = round, cat = pointy, bunny = tall.
  - {"op":"horns","length_mm":8-30,"base_mm":3-9,"curl":0-1}: a mirrored pair of curved horns on the sides of a crown or head.
  - {"op":"spikes","count":2-7,"height_mm":3-16,"base_mm":2.5-7,"center_boost_mm":0-6}: a row of points along the top of a crown or back piece (crown points, feathers).
  - {"op":"knob","radius_mm":1.8-6}: a ball on top (bobble, pompom, tassel).
Put the character in the features and keep the body simple. Give different requests different body shapes: a chef hat is wider at the top, a beanie is rounded, a top hat is a straight tube, a cone hat tapers to a point.`;

const FEATURES_V0_LINE = `- "features": optional list of at most 6: {"op":"knob","radius_mm":1.8-6} or {"op":"brim","width_mm":16-42,"depth_mm":12-32,"thickness_mm":1.6-4}.`;

function systemPromptFor(version: "v0" | "v1" | "v2"): string {
  if (version === "v0") return RECIPE_PROMPT_V0;
  if (version === "v1") return `${RECIPE_PROMPT_V0}\n\n${SLOT_FACTS_V1}`;
  if (!RECIPE_PROMPT_V0.includes(FEATURES_V0_LINE)) throw new Error("v2 prompt: the v0 features line moved");
  return `${RECIPE_PROMPT_V0.replace(FEATURES_V0_LINE, FEATURES_V2)}\n\n${SLOT_FACTS_V1}`;
}

function sparkProposer(version: "v0" | "v1" | "v2"): Proposer {
  const system = systemPromptFor(version);
  const key = process.env.MODEL_API_KEY ?? process.env.META_MODEL_API_KEY;
  if (!key) throw new Error("--proposer spark needs MODEL_API_KEY or META_MODEL_API_KEY in the environment");
  const base = (process.env.META_MODEL_API_URL ?? "https://api.meta.ai/v1").replace(/\/+$/, "").replace(/\/responses$/, "");
  const configured = process.env.MUSE_SPARK_MODEL?.trim();
  const model = configured && /^muse-spark/i.test(configured) ? configured : "muse-spark-1.3";

  async function call(input: string): Promise<ProposeResult> {
    const attempt = (withEffort: boolean) =>
      fetch(`${base}/responses`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ model, input, ...(withEffort ? { reasoning: { effort: "low" } } : {}) }),
        signal: AbortSignal.timeout(90_000),
      });
    let res = await attempt(true);
    if (res.status === 400) res = await attempt(false);
    if (!res.ok) throw new Error(`model returned ${res.status}`);
    const body = (await res.json()) as unknown;
    const usage = isRecord(body) && isRecord(body.usage) ? body.usage : {};
    return {
      recipe: extractJsonObject(outputTextOf(body)),
      tokensIn: typeof usage.input_tokens === "number" ? usage.input_tokens : undefined,
      tokensOut: typeof usage.output_tokens === "number" ? usage.output_tokens : undefined,
    };
  }

  const wish = (p: PromptCase) => `Child's wish: "${p.text}"\nSlot: ${p.slot}`;
  return {
    name: version === "v0" ? `spark:${model}` : `spark:${model}:${version}`,
    propose: (p) => call(`${system}\n\n${wish(p)}\nAnswer with the JSON object only.`),
    repair: (p, prev, feedback) =>
      call(
        `${system}\n\n${wish(p)}\n\nYour previous recipe:\n${JSON.stringify(prev)}\n\nProblems the checker found:\n${feedback
          .map((f) => `- ${f.gate}${f.measured !== undefined ? ` (measured ${f.measured})` : ""}${f.limit ? ` (limit ${f.limit})` : ""}: ${f.hint}`)
          .join("\n")}\n\nReturn a corrected recipe as one JSON object only.`,
      ),
  };
}

// ---------------------------------------------------------------- run

function legalizerChangesFor(recipe: unknown): LoftChange[] {
  if (!isRecord(recipe) || !isRecord(recipe.shape)) return [];
  const kind = recipe.shape.kind;
  if (kind === "star2d" || kind === "profile2d" || recipe.slot === "hand") return [];
  const res = legalizeLoft(recipe.shape.slices);
  // The daemon accepts a few things the mirror does not (numeric strings); report nothing then.
  return res.ok ? res.changes : [];
}

async function runPrompt(p: PromptCase, proposer: Proposer, o: Opts): Promise<PromptResult> {
  const attempts: AttemptRecord[] = [];
  let prevRecipe: unknown = null;
  let feedback: FeedbackItem[] = [];
  let prevKey = "";
  const t0 = Date.now();
  for (let call = 1; call <= o.maxCalls; call++) {
    const tCall = Date.now();
    let prop: ProposeResult;
    try {
      prop = call === 1 ? await proposer.propose(p) : await proposer.repair(p, prevRecipe, feedback);
    } catch (e) {
      attempts.push({
        recipe: null,
        parseOk: false,
        compileError: false,
        status: "proposer_error",
        gates: ["proposer_error"],
        validationMs: null,
        wallMs: Date.now() - tCall,
        legalizerChanges: [],
      });
      process.stderr.write(`  ${p.id}: proposer error: ${(e as Error).message}\n`);
      break; // do not burn more calls on an API failure
    }
    if (prop.recipe === null) {
      attempts.push({
        recipe: null,
        parseOk: false,
        compileError: false,
        status: "parse_error",
        gates: ["parse_error"],
        validationMs: null,
        wallMs: Date.now() - tCall,
        legalizerChanges: [],
        tokensIn: prop.tokensIn,
        tokensOut: prop.tokensOut,
      });
      feedback = [{ gate: "parse_error", hint: "Return exactly one JSON object and nothing else." }];
      continue;
    }
    let outcome: JobOutcome;
    try {
      outcome = await submitToDaemon(o.daemon, prop.recipe, o.jobTimeoutMs);
    } catch (e) {
      // A daemon that vanishes mid-run is a result, not a crash; do not spend more model calls.
      process.stderr.write(`  ${p.id}: daemon error: ${(e as Error).message}\n`);
      outcome = { compileError: false, status: "daemon_error", job: null };
    }
    const gates = gateKeysOf(outcome.status, outcome.job, outcome.compileError);
    const attempt: AttemptRecord = {
      recipe: prop.recipe,
      parseOk: true,
      compileError: outcome.compileError,
      status: outcome.status,
      gates,
      validationMs: outcome.job?.elapsed_ms ?? null,
      wallMs: Date.now() - tCall,
      legalizerChanges: legalizerChangesFor(prop.recipe),
      tokensIn: prop.tokensIn,
      tokensOut: prop.tokensOut,
      jobId: outcome.job?.job_id,
      glbArtifact: outcome.job?.glb_artifact ?? null,
      stlArtifact: outcome.job?.stl_artifact ?? null,
      l2: outcome.job?.legalizer?.l2 ?? null,
    };
    attempts.push(attempt);
    if (gates.length === 0 && outcome.status === "print_ready") break;
    if (outcome.status === "daemon_error") break;
    feedback = buildFeedback(outcome.status, outcome.job, outcome.compileError);
    // Spec: stop when the same gate fails twice on the same recipe (no progress).
    const key = `${JSON.stringify(prop.recipe)}|${gates.join(",")}`;
    if (key === prevKey) break;
    prevKey = key;
    prevRecipe = prop.recipe;
  }
  const passIdx = attempts.findIndex((a) => a.status === "print_ready" && a.gates.length === 0);
  return {
    id: p.id,
    slot: p.slot,
    text: p.text,
    attempts,
    passedFirst: passIdx === 0,
    passedFinal: passIdx >= 0,
    calls: attempts.length,
    totalMs: Date.now() - t0,
    rating: null,
  };
}

function pct(x: number): string {
  return `${(x * 100).toFixed(0)}%`;
}

function secs(ms: number | null): string {
  return ms === null ? "-" : `${(ms / 1000).toFixed(1)}s`;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const file = JSON.parse(readFileSync(o.prompts, "utf8")) as { prompts: PromptCase[] };
  let prompts = file.prompts;
  if (o.slots) prompts = prompts.filter((p) => o.slots!.includes(p.slot));
  if (o.limit) prompts = prompts.slice(0, o.limit);
  if (prompts.length === 0) throw new Error("no prompts selected");

  const proposer = o.proposer === "spark" ? sparkProposer(o.promptVersion) : stubProposer();
  try {
    const h = await fetch(`${o.daemon}/health`, { signal: AbortSignal.timeout(5000) });
    if (!h.ok) throw new Error(`health returned ${h.status}`);
  } catch (e) {
    process.stderr.write(`Cannot reach the forge optimizer at ${o.daemon} (${(e as Error).message}).\nStart it with: npm run forge:optimizer\n`);
    process.exit(2);
  }

  if (proposer.name === "stub") {
    process.stdout.write("STUB PROPOSER: these numbers test the plumbing and the gates, not any model.\n");
  }
  process.stdout.write(`Running ${prompts.length} prompts, up to ${o.maxCalls} model call(s) each, proposer ${proposer.name}\n`);
  let startedAt = new Date().toISOString();
  let results: PromptResult[] = [];
  if (o.resume && o.out && existsSync(o.out)) {
    const prior = JSON.parse(readFileSync(o.out, "utf8")) as {
      meta?: { startedAt?: string; proposer?: string };
      results?: PromptResult[];
    };
    if (prior.meta?.proposer !== proposer.name) {
      throw new Error(`--resume: ${o.out} was made with ${prior.meta?.proposer}, not ${proposer.name}`);
    }
    results = prior.results ?? [];
    startedAt = prior.meta?.startedAt ?? startedAt;
    process.stdout.write(`Resuming: ${results.length} prompts already done in ${o.out}\n`);
  }
  const done = new Set(results.map((r) => r.id));
  // The report is rewritten after every prompt, so a killed run keeps what it finished.
  const writeReport = (complete: boolean) => {
    if (!o.out) return;
    writeFileSync(
      o.out,
      JSON.stringify(
        {
          meta: { proposer: proposer.name, daemon: o.daemon, prompts: o.prompts, startedAt, maxCalls: o.maxCalls, promptVersion: o.proposer === "spark" ? o.promptVersion : "stub", complete, selected: prompts.length },
          summary: summarize(results),
          results,
        },
        null,
        2,
      ),
    );
  };
  for (const p of prompts) {
    if (done.has(p.id)) continue;
    const r = await runPrompt(p, proposer, o);
    results.push(r);
    writeReport(false);
    const last = r.attempts[r.attempts.length - 1];
    process.stdout.write(
      `${p.id.padEnd(4)} ${p.slot.padEnd(8)} calls=${r.calls} ${r.passedFinal ? (r.passedFirst ? "PASS" : "PASS after repair") : `FAIL ${(last?.gates ?? []).join(",")}`} ${secs(r.totalMs)}\n`,
    );
  }

  const s = summarize(results);
  process.stdout.write(
    [
      "",
      `prompts                 ${s.prompts}`,
      `first-attempt pass      ${s.firstAttemptPass} (${pct(s.firstAttemptPassRate)})`,
      `final pass              ${s.finalPass} (${pct(s.finalPassRate)})`,
      `mean model calls/prompt ${s.meanCalls.toFixed(2)}`,
      `job latency p50 / p95   ${secs(s.jobMsP50)} / ${secs(s.jobMsP95)}`,
      `validation p50 / p95    ${secs(s.validationMsP50)} / ${secs(s.validationMsP95)}`,
      `recipes the clamp changed (first attempt) ${s.recipesTouchedByLegalizer} ${JSON.stringify(s.legalizerChangesByKind)}`,
      `L2 (small-parts rescale)  tried ${s.l2Tried}, applied ${s.l2Applied}, time p50 / p95 ${secs(s.l2MsP50)} / ${secs(s.l2MsP95)}`,
      `failures by gate (all attempts)  ${JSON.stringify(s.failuresByGate)}`,
      `failures by gate (first attempt) ${JSON.stringify(s.firstAttemptFailuresByGate)}`,
      `tokens in / out         ${s.tokensIn} / ${s.tokensOut}`,
      `by slot                 ${JSON.stringify(s.bySlot)}`,
      "",
    ].join("\n"),
  );

  writeReport(true);
  if (o.out) process.stdout.write(`Wrote ${o.out}\n`);
}

main().catch((e) => {
  process.stderr.write(`${(e as Error).stack ?? e}\n`);
  process.exit(1);
});
