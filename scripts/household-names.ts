// Names for the household library, in the game's seven languages: asks the Muse model (direct HTTP to the Meta Responses API, with the key this script
// loads itself; NEVER through the Cloudflare AI binding) for the six non-English spoken nouns of every household item, validates every answer with the
// same rules the tests use, and merges them into src/lib/householdNames.json without ever overwriting a name a native speaker approved.
//
//   npx tsx scripts/household-names.ts --sample            # ask for 10 chosen items only, print a table, write NOTHING (add --write to keep them)
//   npx tsx scripts/household-names.ts --sample --write    # keep those 10
//   npx tsx scripts/household-names.ts                     # ask for every missing name, write the file
//   npx tsx scripts/household-names.ts --dry-run           # say what it would ask; no key is read, nothing is called or written
//   npx tsx scripts/household-names.ts --seed              # offline: add the English name of any new catalog item; no key, no calls
//   options: --only id,id   --redo id,id (ask again for names that exist and are not approved)   --langs es,fr   --batch 10   --budget 16
//            --model muse-spark-1.3   --stub canned.json (read canned answers instead of calling out; for tests)
//
// The key comes from MODEL_API_KEY / META_MODEL_API_KEY in the environment or in .dev.vars, as scripts/kip-gen-faces.ts does, and is never printed:
// failures print a status code, never a response body. A hard call budget stops the run; HTTP 401, 403 and 429 stop it at once (no retry storm).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LANGUAGES, type LangCode } from "../src/lib/propNames";
import { NAME_LANGS, type NameEntry, type NamesFile } from "../src/lib/householdNames";
import { expectedPending, validateName, validateNamesFile } from "../src/lib/householdNamesCheck";
import { apiUrl, firstJsonObject, outputTextOf } from "../worker/muse";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const NAMES_PATH = join(ROOT, "src/lib/householdNames.json");
export const CATALOG_PATH = join(ROOT, "public/kip/household/catalog.json");
export const DEFAULT_MODEL = "muse-spark-1.3";
export const DEFAULT_BUDGET = 16; // 61 items is 7 calls of 10; room for a retry of each, and a few 400 re-sends
export const DEFAULT_BATCH = 10;
export const TARGET_LANGS: readonly LangCode[] = NAME_LANGS.filter((l) => l !== "en");

/** The ten the sample asks for: a cognate (banana), the cup-or-mug question, an English name edited from its label (soda can), two-word items (wooden spoon,
 *  toy brick), a puzzle piece (a child says "puzzle"), a plural by nature twice (playing cards, scissors), a compound-word language's trap (toothbrush), and the toy tool. */
export const SAMPLE_IDS: readonly string[] = ["banana", "mug", "soda_can", "wooden_spoon", "jigsaw", "toy_brick", "playing_cards", "scissors", "toothbrush", "support_tool"];

/** English names edited from the catalog's label (label lower-cased otherwise), with why. */
export const EN_EDITS: Record<string, [string, string]> = {
  soda_can: ["soda can", "a lone 'can' reads as the verb when spoken"],
};
/** What an item is, for the model, where the label and the words are not enough. */
const DESCRIBE: Record<string, string> = {
  support_tool: "a chunky, rounded toy tool for small children, a general play tool that stands in for any tool job (do NOT name one particular tool such as a hammer, saw or wrench: the name must mean 'toy tool')",
  jigsaw: "one jigsaw puzzle piece, standing for a jigsaw puzzle",
  playing_cards: "a deck of playing cards",
  soda_can: "a drinks can, such as a soda can",
};

export interface CatalogRow { id: string; label: string; words: string[]; group: string }

export function loadCatalogRows(path = CATALOG_PATH): CatalogRow[] {
  const doc = JSON.parse(readFileSync(path, "utf8")) as { items: CatalogRow[]; support?: CatalogRow[] };
  return [...doc.items, ...(doc.support ?? [])].map((r) => ({ id: r.id, label: r.label, words: r.words, group: r.group }));
}

export function readNames(path = NAMES_PATH): NamesFile {
  return JSON.parse(readFileSync(path, "utf8")) as NamesFile;
}

/** The file as text: ids in the given order, languages in the picker's order, one entry per line, so a diff shows exactly what changed. */
export function serializeNames(file: NamesFile, order: readonly string[]): string {
  const ids = [...order.filter((id) => id in file.names), ...Object.keys(file.names).filter((id) => !order.includes(id))];
  const q = (s: string) => JSON.stringify(s);
  const lines: string[] = ["{", `  "version": ${file.version},`, `  "pending": [${file.pending.map(q).join(", ")}],`, '  "names": {'];
  ids.forEach((id, i) => {
    lines.push(`    ${q(id)}: {`);
    const langs = NAME_LANGS.filter((l) => file.names[id]![l]);
    langs.forEach((l, j) => {
      const e = file.names[id]![l]!;
      lines.push(`      ${q(l)}: { "w": ${q(e.w)}, "source": ${q(e.source)}, "review": ${q(e.review)} }${j < langs.length - 1 ? "," : ""}`);
    });
    lines.push(`    }${i < ids.length - 1 ? "," : ""}`);
  });
  lines.push("  }", "}", "");
  return lines.join("\n");
}

export function writeNames(file: NamesFile, order: readonly string[], path = NAMES_PATH): void {
  writeFileSync(path, serializeNames(file, order));
}

const cloneFile = (f: NamesFile): NamesFile => JSON.parse(JSON.stringify(f)) as NamesFile;

/** Add the English name (the catalog label lower-cased, or its edit) of every catalog item that has none; fix `pending`. Never touches an existing entry. */
export function seedEnglish(file: NamesFile, rows: readonly CatalogRow[]): { file: NamesFile; added: string[] } {
  const next = cloneFile(file);
  const added: string[] = [];
  for (const r of rows) {
    next.names[r.id] ??= {};
    if (next.names[r.id]!.en) continue;
    const edit = EN_EDITS[r.id];
    next.names[r.id]!.en = { w: edit ? edit[0] : r.label.toLowerCase(), source: edit ? `edited:${edit[1]}` : "catalog", review: "unreviewed" };
    added.push(r.id);
  }
  next.pending = expectedPending(next, rows.map((r) => r.id));
  return { file: next, added };
}

// ---- the call ---------------------------------------------------------------------------------------------------------------------------

/** Stops a run: the call budget, or an HTTP status that says "no" (401, 403, 429). */
export class Stop extends Error {}
export class Budget {
  calls = 0;
  constructor(readonly max: number) {}
  spend(what: string): void {
    if (this.calls >= this.max) throw new Stop(`call budget (${this.max}) reached before ${what}`);
    this.calls++;
  }
}
export interface MuseDeps {
  fetchImpl: typeof fetch;
  key: string;
  model: string;
  budget: Budget;
  /** Overrides META_MODEL_API_URL (tests). */
  baseUrl?: string;
}

/** One direct call to the Meta Responses API, the shape worker/muse.ts uses: low reasoning effort first, again without it on a 400. Returns the model's text. */
export async function callMuse(prompt: string, deps: MuseDeps): Promise<string> {
  const url = apiUrl({ META_MODEL_API_URL: deps.baseUrl ?? process.env.META_MODEL_API_URL }, "/responses");
  const attempt = async (withEffort: boolean): Promise<Response> => {
    deps.budget.spend("a Muse call");
    return deps.fetchImpl(url, {
      method: "POST",
      headers: { authorization: `Bearer ${deps.key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: deps.model, input: prompt, ...(withEffort ? { reasoning: { effort: "low" } } : {}) }),
      signal: AbortSignal.timeout(90_000),
    });
  };
  let res = await attempt(true);
  if (res.status === 400) res = await attempt(false); // an older model does not know the reasoning parameter
  if (res.status === 401 || res.status === 403 || res.status === 429) throw new Stop(`Muse answered HTTP ${res.status}: stopping, not retrying`);
  if (!res.ok) throw new Error(`Muse answered HTTP ${res.status}`);
  return outputTextOf(await res.json());
}

// ---- the prompt and the answer ---------------------------------------------------------------------------------------------------------

const VARIETY: Record<LangCode, string> = Object.fromEntries(
  LANGUAGES.map((l) => [l.code, `${l.code} = ${l.label}, as spoken in the region of ${l.bcp47}`]),
) as Record<LangCode, string>;

export interface AskItem { id: string; en: string; also: string[]; what?: string; langs: LangCode[]; redo?: Array<{ lang: LangCode; why: string }> }

export function buildPrompt(items: readonly AskItem[]): string {
  const langs = [...new Set(items.flatMap((i) => i.langs))];
  const lines = items.map((i) => {
    const bits = [`- ${i.id}: English "${i.en}"`];
    if (i.also.length) bits.push(`also called: ${i.also.join(", ")}`);
    if (i.what) bits.push(`this is ${i.what}`);
    bits.push(`give: ${i.langs.join(", ")}`);
    for (const r of i.redo ?? []) bits.push(`your earlier ${r.lang} answer was rejected (${r.why}): give a different, correct one`);
    return bits.join(" | ");
  });
  return [
    "You are naming everyday household objects for a young child's toy game (ages 2 to 10). For each object below, give the word a young child in that country",
    "would naturally use for it, in each requested language. The English name only identifies the object.",
    "",
    "Rules for every word:",
    "- The bare noun only: no article (not 'la cuchara', not 'the spoon'), no colour, no description. An object whose usual name has two or three words keeps them.",
    "- Singular, unless the object is plural by nature (scissors, pliers, playing cards): then the usual plural.",
    "- The ordinary everyday word a child hears at home, not a technical or formal one, and not a word-for-word translation when the language has a more natural word.",
    "- Letters only (accents allowed): no digits, punctuation other than a hyphen or an apostrophe inside a word, quotes or emoji. One to three words.",
    "- All lower case, except German nouns, which keep their capital letter.",
    "- No brand names or trademarks.",
    "- Different objects get different words within one language.",
    "",
    `Languages: ${langs.map((l) => VARIETY[l]).join("; ")}.`,
    "",
    "Objects:",
    ...lines,
    "",
    'Reply with ONLY one JSON object, no code fence and no commentary, shaped exactly like {"items": {"<id>": {"<language code>": "<word>"}}}',
    "using the ids above and, for each id, only the language codes listed after 'give:'.",
  ].join("\n");
}

export interface Parsed { ok: Map<string, Partial<Record<LangCode, string>>>; bad: Array<{ id: string; lang: LangCode; why: string }> }

/** Read a model reply for the asked (id, language) pairs. A pair is bad when missing, not a string, or breaking a name rule. Extra ids and languages are ignored. */
export function parseReply(text: string, asked: ReadonlyArray<{ id: string; langs: readonly LangCode[] }>): Parsed {
  const obj = firstJsonObject(text) as Record<string, unknown> | null;
  const items = (obj && typeof obj === "object" && obj.items && typeof obj.items === "object" ? obj.items : obj) as Record<string, unknown> | null;
  const ok: Parsed["ok"] = new Map();
  const bad: Parsed["bad"] = [];
  for (const a of asked) {
    const got = items && typeof items === "object" ? (items[a.id] as Record<string, unknown> | undefined) : undefined;
    for (const lang of a.langs) {
      const raw = got && typeof got === "object" ? got[lang] : undefined;
      if (typeof raw !== "string") {
        bad.push({ id: a.id, lang, why: "no answer" });
        continue;
      }
      const w = raw.trim().normalize("NFC");
      const problems = validateName(lang, w);
      if (problems.length) bad.push({ id: a.id, lang, why: problems.join("; ") });
      else (ok.get(a.id) ?? ok.set(a.id, {}).get(a.id)!)[lang] = w;
    }
  }
  return { ok, bad };
}

/** A fetch that answers from canned JSON ({ "<id>": { "<lang>": "<word>" } }) instead of the network: for `--stub` and the tests. */
export function makeStubFetch(canned: Record<string, Partial<Record<LangCode, string>>>, log: Array<{ prompt: string }> = []): typeof fetch {
  return (async (_url: unknown, init?: { body?: string }) => {
    const prompt = (JSON.parse(String(init?.body ?? "{}")) as { input?: string }).input ?? "";
    log.push({ prompt });
    const ids = [...prompt.matchAll(/^- ([a-z][a-z0-9_]*): /gm)].map((m) => m[1]!);
    const items: Record<string, unknown> = {};
    for (const id of ids) if (canned[id]) items[id] = canned[id];
    return new Response(JSON.stringify({ output_text: JSON.stringify({ items }) }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

// ---- the run ----------------------------------------------------------------------------------------------------------------------------

export interface RunOptions {
  rows: readonly CatalogRow[];
  file: NamesFile;
  only?: readonly string[];
  redo?: readonly string[];
  langs?: readonly LangCode[];
  batch?: number;
  deps: MuseDeps;
  today: string;
}
export interface RunResult {
  file: NamesFile;
  added: Array<{ id: string; lang: LangCode; w: string }>;
  failed: Array<{ id: string; lang: LangCode; why: string }>;
  skippedApproved: Array<{ id: string; lang: LangCode }>;
  kept: number;
  stopped: string | null;
}

/** The (id, language) pairs a run would ask for. An existing name is kept unless the id is in `redo`; an approved one is never asked again. */
export function planAsk(file: NamesFile, rows: readonly CatalogRow[], o: Pick<RunOptions, "only" | "redo" | "langs">): { ask: Array<{ id: string; langs: LangCode[] }>; skippedApproved: Array<{ id: string; lang: LangCode }>; kept: number } {
  const langs = o.langs ?? TARGET_LANGS;
  const ask: Array<{ id: string; langs: LangCode[] }> = [];
  const skippedApproved: Array<{ id: string; lang: LangCode }> = [];
  let kept = 0;
  for (const r of rows) {
    if (o.only && !o.only.includes(r.id)) continue;
    const need: LangCode[] = [];
    for (const lang of langs) {
      const e = file.names[r.id]?.[lang];
      if (e && e.review === "approved") {
        skippedApproved.push({ id: r.id, lang });
        if (e) kept++;
      } else if (e && !o.redo?.includes(r.id)) kept++;
      else need.push(lang);
    }
    if (need.length) ask.push({ id: r.id, langs: need });
  }
  return { ask, skippedApproved, kept };
}

const norm = (w: string) => w.toLowerCase().normalize("NFC");

export async function runNames(o: RunOptions): Promise<RunResult> {
  const next = cloneFile(o.file);
  const { ask, skippedApproved, kept } = planAsk(next, o.rows, o);
  const rowOf = new Map(o.rows.map((r) => [r.id, r] as const));
  const added: RunResult["added"] = [];
  const failed: RunResult["failed"] = [];
  const size = o.batch ?? DEFAULT_BATCH;
  // a noun already taken by another item in the same language (existing, or accepted earlier in this run) cannot be taken again
  const taken = new Map<string, string>();
  for (const [id, byLang] of Object.entries(next.names)) for (const [l, e] of Object.entries(byLang)) if (e) taken.set(`${l}|${norm(e.w)}`, id);
  const source = `muse:${o.deps.model}:${o.today}`;
  let stopped: string | null = null;

  const toAsk = (a: { id: string; langs: LangCode[] }, redo?: AskItem["redo"]): AskItem => {
    const r = rowOf.get(a.id)!;
    const en = next.names[a.id]?.en?.w ?? r.label.toLowerCase();
    return { id: a.id, en, also: r.words.filter((w) => w !== en), what: DESCRIBE[a.id], langs: a.langs, redo };
  };
  const accept = (id: string, lang: LangCode, w: string): string | null => {
    const owner = taken.get(`${lang}|${norm(w)}`);
    if (owner && owner !== id) return `already names ${owner}`;
    next.names[id] ??= {};
    const old = next.names[id]![lang];
    if (old) taken.delete(`${lang}|${norm(old.w)}`);
    next.names[id]![lang] = { w, source, review: "unreviewed" } as NameEntry;
    taken.set(`${lang}|${norm(w)}`, id);
    added.push({ id, lang, w });
    return null;
  };

  try {
    for (let i = 0; i < ask.length; i += size) {
      const batch = ask.slice(i, i + size);
      const text = await callMuse(buildPrompt(batch.map((a) => toAsk(a))), o.deps).catch((e) => {
        if (e instanceof Stop) throw e;
        return "";
      });
      const first = parseReply(text, batch);
      const bad: Array<{ id: string; lang: LangCode; why: string }> = [];
      for (const [id, byLang] of first.ok) for (const [lang, w] of Object.entries(byLang)) {
        const why = accept(id, lang as LangCode, w!);
        if (why) bad.push({ id, lang: lang as LangCode, why });
      }
      bad.push(...first.bad);
      if (!bad.length) continue;
      // reject and ask once more, naming what was wrong
      const again = [...new Set(bad.map((b) => b.id))].map((id) => {
        const mine = bad.filter((b) => b.id === id);
        return toAsk({ id, langs: mine.map((b) => b.lang) }, mine.map((b) => ({ lang: b.lang, why: b.why })));
      });
      const text2 = await callMuse(buildPrompt(again), o.deps).catch((e) => {
        if (e instanceof Stop) throw e;
        return "";
      });
      const second = parseReply(text2, again);
      for (const b of second.bad) failed.push(b);
      for (const [id, byLang] of second.ok) for (const [lang, w] of Object.entries(byLang)) {
        const why = accept(id, lang as LangCode, w!);
        if (why) failed.push({ id, lang: lang as LangCode, why });
      }
    }
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
    stopped = e.message;
  }
  // anything asked for and still without a name after a stop is reported, not silently dropped
  for (const a of ask) for (const lang of a.langs) {
    if (!next.names[a.id]?.[lang] && !failed.some((f) => f.id === a.id && f.lang === lang)) failed.push({ id: a.id, lang, why: stopped ? "not asked: the run stopped" : "no answer" });
  }
  next.pending = expectedPending(next, o.rows.map((r) => r.id));
  return { file: next, added, failed, skippedApproved, kept, stopped };
}

// ---- the key and the command line --------------------------------------------------------------------------------------------------------

/** The Meta key: the environment first, then .dev.vars. Never printed. */
export function loadKey(env: Record<string, string | undefined>, readFile: (path: string) => string = (p) => readFileSync(p, "utf8")): string {
  for (const name of ["MODEL_API_KEY", "META_MODEL_API_KEY"]) if (env[name]?.trim()) return env[name]!.trim();
  const text = readFile(join(ROOT, ".dev.vars"));
  for (const name of ["MODEL_API_KEY", "META_MODEL_API_KEY"]) {
    const m = new RegExp(`^${name}=(.+)$`, "m").exec(text);
    if (m && m[1]!.trim()) return m[1]!.trim().replace(/^["']|["']$/g, "");
  }
  throw new Error("no MODEL_API_KEY found in the environment or .dev.vars");
}

export function formatTable(rows: readonly CatalogRow[], file: NamesFile, ids: readonly string[]): string {
  const cell = (id: string, l: LangCode) => file.names[id]?.[l]?.w ?? "(none)";
  const widths = NAME_LANGS.map((l) => Math.max(l.length, ...ids.map((id) => cell(id, l).length)));
  const idw = Math.max(2, ...ids.map((i) => i.length));
  const line = (parts: string[]) => `| ${parts.join(" | ")} |`;
  const out = [line(["id".padEnd(idw), ...NAME_LANGS.map((l, i) => l.padEnd(widths[i]!))]), line(["-".repeat(idw), ...widths.map((w) => "-".repeat(w))])];
  for (const id of ids) if (rows.some((r) => r.id === id)) out.push(line([id.padEnd(idw), ...NAME_LANGS.map((l, i) => cell(id, l).padEnd(widths[i]!))]));
  return out.join("\n");
}

export interface Io {
  log: (s: string) => void;
  err: (s: string) => void;
  env: Record<string, string | undefined>;
  readFile?: (path: string) => string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  namesPath?: string;
  catalogPath?: string;
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
const list = (v: string | undefined) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined);

/** 0 done, 1 some names could not be made, 2 stopped (a budget, an HTTP no) or a bad command line. */
export async function main(args: string[], io: Io): Promise<number> {
  const rows = loadCatalogRows(io.catalogPath);
  const order = rows.map((r) => r.id);
  const namesPath = io.namesPath ?? NAMES_PATH;
  const dry = args.includes("--dry-run");
  const sample = args.includes("--sample");
  let file = readNames(namesPath);

  const seeded = seedEnglish(file, rows);
  const save = (f: NamesFile) => writeNames(f, order, namesPath);
  if (args.includes("--seed")) {
    if (!dry) save(seeded.file);
    io.log(`${seeded.added.length} English name(s) added${dry ? " (dry run: nothing written)" : ""}`);
    return 0;
  }
  file = seeded.file; // an item without an English name cannot be asked about

  const only = sample ? SAMPLE_IDS : list(flag(args, "--only"));
  const redo = list(flag(args, "--redo"));
  const langs = (list(flag(args, "--langs")) as LangCode[] | undefined) ?? TARGET_LANGS;
  for (const id of [...(only ?? []), ...(redo ?? [])]) if (!order.includes(id)) { io.err(`unknown item ${id}`); return 2; }
  for (const l of langs) if (!TARGET_LANGS.includes(l)) { io.err(`language ${l} is not one of ${TARGET_LANGS.join(", ")}`); return 2; }
  const batch = Math.max(1, Number(flag(args, "--batch")) || DEFAULT_BATCH);
  const budget = new Budget(Math.max(1, Number(flag(args, "--budget")) || DEFAULT_BUDGET));
  const model = flag(args, "--model") ?? io.env.MUSE_SPARK_MODEL ?? DEFAULT_MODEL;
  if (!/^muse-spark/i.test(model)) { io.err(`model ${model} is not a Muse model`); return 2; }

  const plan = planAsk(file, rows, { only, redo, langs });
  const batches = Math.ceil(plan.ask.length / batch);
  io.log(`${plan.ask.length} item(s) to ask for in ${batches} call(s) (+ at most ${batches} retry), ${plan.kept} name(s) kept, ${plan.skippedApproved.length} approved name(s) never overwritten`);
  if (dry) {
    for (const a of plan.ask) io.log(`  would ask ${a.id}: ${a.langs.join(", ")}`);
    return 0;
  }
  if (!plan.ask.length) {
    io.log("nothing to ask for");
    if (sample) io.log(formatTable(rows, file, SAMPLE_IDS));
    return 0;
  }

  const stubPath = flag(args, "--stub");
  let fetchImpl = io.fetchImpl ?? fetch;
  let key = "stub-key";
  if (stubPath) fetchImpl = makeStubFetch(JSON.parse(readFileSync(stubPath, "utf8")));
  else {
    try {
      key = loadKey(io.env, io.readFile);
    } catch (e) {
      io.err((e as Error).message);
      return 2;
    }
  }
  const today = (io.now?.() ?? new Date()).toISOString().slice(0, 10);
  const result = await runNames({ rows, file, only, redo, langs, batch, deps: { fetchImpl, key, model, budget }, today });

  io.log(`${result.added.length} name(s) made with ${budget.calls} call(s)`);
  for (const f of result.failed) io.err(`  could not make ${f.id}/${f.lang}: ${f.why}`);
  if (result.stopped) io.err(`stopped: ${result.stopped}`);
  if (sample) io.log(formatTable(rows, result.file, SAMPLE_IDS));
  const problems = validateNamesFile(result.file);
  for (const p of problems) io.err(`  problem in the file: ${p}`);
  const writes = sample ? args.includes("--write") : true;
  if (writes && !problems.length) {
    save(result.file);
    io.log(`wrote ${namesPath}`);
  } else if (sample && !args.includes("--write")) io.log("sample only: nothing written (add --write to keep these names)");
  else if (problems.length) io.err("not written: the file would break its own rules");
  return result.stopped ? 2 : result.failed.length || problems.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), { log: (s) => console.log(s), err: (s) => console.error(s), env: process.env }).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`failed: ${(e as Error).message}`);
      process.exit(2);
    },
  );
}
