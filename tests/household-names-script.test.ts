// scripts/household-names.ts, with NO network and NO real key: a stub fetch plays the Meta Responses API. The real call is run by Dan
// (`npx tsx scripts/household-names.ts --sample`); these tests pin what it asks, what it accepts, what it will never overwrite, when it stops, and that the key
// is used for the call but never printed.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  Budget, CATALOG_PATH, NAMES_PATH, SAMPLE_IDS, Stop, TARGET_LANGS, buildPrompt, callMuse, formatTable, loadCatalogRows, loadKey, main, makeStubFetch, parseReply, planAsk,
  readNames, runNames, seedEnglish, serializeNames, type AskItem, type CatalogRow,
} from "../scripts/household-names";
import { validateNamesFile } from "../src/lib/householdNamesCheck";
import type { NamesFile } from "../src/lib/householdNames";

const KEY = "FAKE-KEY-9d7c1e2b-NOT-REAL";
const TODAY = "2026-11-03";
const rows: CatalogRow[] = [
  { id: "ball", label: "Ball", words: ["ball", "football"], group: "toys" },
  { id: "marble", label: "Marble", words: ["marble"], group: "toys" },
  { id: "mug", label: "Mug", words: ["mug", "cup"], group: "kitchen" },
];
const entry = (w: string, review: "unreviewed" | "approved" = "unreviewed") => ({ w, source: "test", review });
const english = (): NamesFile => ({ version: 1, pending: [...TARGET_LANGS], names: { ball: { en: entry("ball") }, marble: { en: entry("marble") }, mug: { en: entry("mug") } } });
const CANNED = {
  ball: { es: "pelota", fr: "ballon", de: "Ball", it: "palla", pt: "bola", tr: "top" },
  marble: { es: "canica", fr: "bille", de: "Murmel", it: "biglia", pt: "bolinha de gude", tr: "misket" },
  mug: { es: "taza", fr: "tasse", de: "Tasse", it: "tazza", pt: "caneca", tr: "kupa" },
};
const deps = (fetchImpl: typeof fetch, budget = 8) => ({ fetchImpl, key: KEY, model: "muse-spark-1.3", budget: new Budget(budget) });
const respond = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
const text = (items: unknown) => respond({ output_text: JSON.stringify({ items }) });

describe("the prompt", () => {
  const item: AskItem = { id: "wooden_spoon", en: "wooden spoon", also: ["spoon", "ladle"], langs: ["es", "de"] };
  it("names every object by id with its English name, what it is also called, and only the languages asked for", () => {
    const p = buildPrompt([item, { id: "support_tool", en: "toy tool", also: [], what: "a chunky toy mallet with a gear", langs: ["es"] }]);
    expect(p).toContain('- wooden_spoon: English "wooden spoon" | also called: spoon, ladle | give: es, de');
    expect(p).toContain("- support_tool: English \"toy tool\" | this is a chunky toy mallet with a gear | give: es");
    expect(p).toContain("es = Español"); // the regional variety comes from the language table
    expect(p).toContain("de = Deutsch");
    expect(p).not.toContain("fr = ");
  });
  it("asks for the bare noun a child uses, strict JSON, no article, no colour, no brand", () => {
    const p = buildPrompt([item]);
    for (const needle of ["bare noun only", "no article", "no colour", "No brand names", "young child", "German nouns", "ONLY one JSON object", "no code fence", "plural by nature", "Different objects get different words"]) expect(p, needle).toContain(needle);
  });
  it("says what was wrong when it asks again", () => {
    const p = buildPrompt([{ ...item, redo: [{ lang: "es", why: "starts with an article (la)" }] }]);
    expect(p).toContain("your earlier es answer was rejected (starts with an article (la))");
  });
});

describe("reading a reply", () => {
  const asked = [{ id: "ball", langs: ["es", "fr"] as const }];
  it("accepts good answers, in a code fence or bare, under items or at the top", () => {
    for (const reply of ['{"items":{"ball":{"es":"pelota","fr":"ballon"}}}', '```json\n{"items":{"ball":{"es":"pelota","fr":"ballon"}}}\n```', '{"ball":{"es":"pelota","fr":"ballon"}}']) {
      const r = parseReply(reply, asked);
      expect(r.bad, reply).toEqual([]);
      expect(r.ok.get("ball")).toEqual({ es: "pelota", fr: "ballon" });
    }
  });
  it("trims and normalises, and ignores ids and languages that were not asked", () => {
    const r = parseReply('{"items":{"ball":{"es":"  pelota ","fr":"ballon","de":"Ball"},"extra":{"es":"x"}}}', asked);
    expect(r.ok.get("ball")).toEqual({ es: "pelota", fr: "ballon" });
    expect(r.ok.has("extra")).toBe(false);
  });
  it("marks a missing answer, a non-string and a rule-breaker as bad with the reason", () => {
    const r = parseReply('{"items":{"ball":{"es":"la pelota","fr":7}}}', asked);
    expect(r.bad).toEqual([{ id: "ball", lang: "es", why: expect.stringContaining("starts with an article") }, { id: "ball", lang: "fr", why: "no answer" }]);
    expect(parseReply("sorry, I cannot help", asked).bad).toHaveLength(2);
    expect(parseReply("", asked).bad).toHaveLength(2);
    expect(parseReply('{"items":{"ball":"pelota"}}', asked).bad).toHaveLength(2);
  });
});

describe("the call to Muse (direct HTTP, the shape worker/muse.ts uses)", () => {
  it("posts to the Responses API with the key as a Bearer token, low reasoning effort and the model", async () => {
    const f = vi.fn(async () => respond({ output_text: "hello" }));
    expect(await callMuse("hi", { ...deps(f as unknown as typeof fetch), baseUrl: "https://example.test/v1" })).toBe("hello");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://example.test/v1/responses");
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(String(init.body))).toEqual({ model: "muse-spark-1.3", input: "hi", reasoning: { effort: "low" } });
  });
  it("tries again without the reasoning parameter on a 400, and both attempts count against the budget", async () => {
    const f = vi.fn().mockResolvedValueOnce(respond({}, 400)).mockResolvedValueOnce(respond({ output_text: "ok" }));
    const d = deps(f as unknown as typeof fetch);
    expect(await callMuse("hi", d)).toBe("ok");
    expect(JSON.parse(String((f.mock.calls[1] as unknown as [string, RequestInit])[1].body))).toEqual({ model: "muse-spark-1.3", input: "hi" });
    expect(d.budget.calls).toBe(2);
  });
  it("reads the text out of output[].content[] too", async () => {
    const f = vi.fn(async () => respond({ output: [{ content: [{ text: "a" }, { text: "b" }] }] }));
    expect(await callMuse("hi", deps(f as unknown as typeof fetch))).toBe("ab");
  });
  it("stops at once on 401, 403 and 429, and says only the status, never the response body", async () => {
    for (const status of [401, 403, 429]) {
      const f = vi.fn(async () => respond({ error: `bad key ${KEY}` }, status));
      const err = await callMuse("hi", deps(f as unknown as typeof fetch)).catch((e) => e);
      expect(err).toBeInstanceOf(Stop);
      expect(String(err.message)).toContain(`HTTP ${status}`);
      expect(String(err.message)).not.toContain(KEY);
    }
  });
  it("refuses to spend past the budget", async () => {
    const f = vi.fn(async () => respond({ output_text: "x" }));
    const d = deps(f as unknown as typeof fetch, 1);
    await callMuse("a", d);
    await expect(callMuse("b", d)).rejects.toBeInstanceOf(Stop);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("a run", () => {
  it("asks for every missing name in batches, and writes what it gets with where it came from, unreviewed", async () => {
    const log: Array<{ prompt: string }> = [];
    const r = await runNames({ rows, file: english(), batch: 2, deps: deps(makeStubFetch(CANNED, log)), today: TODAY });
    expect(log).toHaveLength(2); // 3 items in batches of 2
    expect(log[0]!.prompt).toContain("- ball:");
    expect(log[0]!.prompt).toContain("- marble:");
    expect(log[0]!.prompt).not.toContain("- mug:");
    expect(r.failed).toEqual([]);
    expect(r.added).toHaveLength(18);
    expect(r.file.names.ball!.es).toEqual({ w: "pelota", source: "muse:muse-spark-1.3:2026-11-03", review: "unreviewed" });
    expect(r.file.pending).toEqual([]); // every language is now complete
    expect(validateNamesFile(r.file)).toEqual([]);
    expect(r.file.names.ball!.en).toEqual(entry("ball")); // English was not touched
  });
  it("does not ask for a name it already has, and keeps it", async () => {
    const file = english();
    file.names.ball!.es = entry("balón");
    const log: Array<{ prompt: string }> = [];
    const r = await runNames({ rows, file, deps: deps(makeStubFetch(CANNED, log)), today: TODAY });
    expect(log[0]!.prompt).toContain("give: fr, de, it, pt, tr"); // ball: Spanish is not asked again
    expect(log[0]!.prompt).not.toMatch(/- ball:.*give: es/);
    expect(r.file.names.ball!.es!.w).toBe("balón");
    expect(r.kept).toBe(1);
  });
  it("asks again only with --redo, and then replaces an unreviewed name", async () => {
    const file = english();
    file.names.ball!.es = entry("balón");
    const r = await runNames({ rows, file, only: ["ball"], redo: ["ball"], langs: ["es"], deps: deps(makeStubFetch(CANNED)), today: TODAY });
    expect(r.file.names.ball!.es!.w).toBe("pelota");
  });
  it("NEVER overwrites an approved name, even with --redo, and does not ask for it", async () => {
    const file = english();
    file.names.ball!.es = entry("balón", "approved");
    const log: Array<{ prompt: string }> = [];
    const r = await runNames({ rows, file, only: ["ball"], redo: ["ball"], langs: ["es", "fr"], deps: deps(makeStubFetch(CANNED, log)), today: TODAY });
    expect(r.file.names.ball!.es).toEqual(entry("balón", "approved"));
    expect(r.skippedApproved).toEqual([{ id: "ball", lang: "es" }]);
    expect(log[0]!.prompt).toContain("give: fr"); // only French was asked
    expect(log[0]!.prompt).not.toContain("give: es");
  });
  it("rejects a bad answer and asks once more, naming what was wrong; a good second answer is kept", async () => {
    const log: Array<{ prompt: string }> = [];
    const answers = [{ ball: { ...CANNED.ball, es: "la pelota" } }, { ball: { es: "pelota" } }];
    let call = 0;
    const f = (async (_u: unknown, init?: { body?: string }) => {
      log.push({ prompt: (JSON.parse(String(init?.body)) as { input: string }).input });
      return text(answers[call++]);
    }) as unknown as typeof fetch;
    const r = await runNames({ rows: [rows[0]!], file: english(), deps: deps(f), today: TODAY });
    expect(call).toBe(2);
    expect(log[1]!.prompt).toContain("your earlier es answer was rejected (starts with an article");
    expect(log[1]!.prompt).toContain("give: es"); // only the failing language
    expect(r.file.names.ball!.es!.w).toBe("pelota");
    expect(r.failed).toEqual([]);
  });
  it("asks only ONCE more: a second bad answer is reported as failed and nothing is written for it", async () => {
    let call = 0;
    const f = (async () => {
      call++;
      return text({ ball: { ...CANNED.ball, es: "la pelota" } });
    }) as unknown as typeof fetch;
    const r = await runNames({ rows: [rows[0]!], file: english(), deps: deps(f), today: TODAY });
    expect(call).toBe(2);
    expect(r.failed).toEqual([{ id: "ball", lang: "es", why: expect.stringContaining("starts with an article") }]);
    expect(r.file.names.ball!.es).toBeUndefined();
    expect(r.file.pending).toEqual(["es"]); // the rest were made
  });
  it("will not give two items the same noun in one language: the second is rejected and re-asked", async () => {
    let call = 0;
    const f = (async () => {
      call++;
      return call === 1 ? text({ ball: CANNED.ball, marble: { ...CANNED.marble, es: "pelota" } }) : text({ marble: { es: "canica" } });
    }) as unknown as typeof fetch;
    const r = await runNames({ rows: rows.slice(0, 2), file: english(), deps: deps(f), today: TODAY });
    expect(r.file.names.ball!.es!.w).toBe("pelota");
    expect(r.file.names.marble!.es!.w).toBe("canica");
    expect(validateNamesFile(r.file)).toEqual([]);
  });
  it("stops at the budget and says which names it did not get", async () => {
    const r = await runNames({ rows, file: english(), batch: 1, deps: deps(makeStubFetch(CANNED), 2), today: TODAY });
    expect(r.stopped).toMatch(/budget \(2\)/);
    expect(r.file.names.ball!.es).toBeDefined(); // the first two calls landed
    expect(r.file.names.mug!.es).toBeUndefined();
    expect(r.failed.some((f) => f.id === "mug" && /run stopped/.test(f.why))).toBe(true);
    expect(r.file.pending).toContain("es");
  });
  it("stops dead on a 429 and keeps what it had", async () => {
    let call = 0;
    const f = (async () => (++call === 1 ? text({ ball: CANNED.ball }) : respond({}, 429))) as unknown as typeof fetch;
    const r = await runNames({ rows, file: english(), batch: 1, deps: deps(f), today: TODAY });
    expect(call).toBe(2);
    expect(r.stopped).toMatch(/HTTP 429/);
    expect(r.file.names.ball!.es!.w).toBe("pelota");
    expect(r.file.names.marble!.es).toBeUndefined();
  });
  it("treats a failed call as a failed batch, not a crash", async () => {
    const f = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const r = await runNames({ rows: [rows[0]!], file: english(), deps: deps(f), today: TODAY });
    expect(r.failed).toHaveLength(6);
    expect(r.stopped).toBeNull();
  });
});

describe("planning, seeding and writing the file", () => {
  it("plans exactly the pairs that are missing, minus approved ones", () => {
    const file = english();
    file.names.ball!.es = entry("pelota");
    file.names.mug!.fr = entry("tasse", "approved");
    const p = planAsk(file, rows, {});
    expect(p.ask.find((a) => a.id === "ball")!.langs).toEqual(["fr", "de", "it", "pt", "tr"]);
    expect(p.ask.find((a) => a.id === "mug")!.langs).toEqual(["es", "de", "it", "pt", "tr"]);
    expect(p.skippedApproved).toEqual([{ id: "mug", lang: "fr" }]);
    expect(p.kept).toBe(2);
    expect(planAsk(file, rows, { only: ["marble"] }).ask.map((a) => a.id)).toEqual(["marble"]);
  });
  it("seeds English from the label, never touches an entry that exists, and keeps pending right", () => {
    const empty: NamesFile = { version: 1, pending: [], names: { ball: { en: entry("football") } } };
    const s = seedEnglish(empty, rows);
    expect(s.added).toEqual(["marble", "mug"]);
    expect(s.file.names.ball!.en!.w).toBe("football");
    expect(s.file.names.mug!.en).toEqual({ w: "mug", source: "catalog", review: "unreviewed" });
    expect(s.file.pending).toEqual([...TARGET_LANGS]);
    expect(seedEnglish(s.file, [...rows, { id: "soda_can", label: "Can", words: [], group: "kitchen" }]).file.names.soda_can!.en).toEqual({ w: "soda can", source: expect.stringMatching(/^edited:/), review: "unreviewed" });
  });
  it("writes the file in a fixed order that reads back identically, so a diff shows only what changed", () => {
    const f = english();
    f.names.mug!.es = entry("taza");
    const order = ["mug", "ball", "marble"];
    const out = serializeNames(f, order);
    expect(JSON.parse(out)).toEqual(f);
    expect(Object.keys(JSON.parse(out).names)).toEqual(order);
    expect(serializeNames(JSON.parse(out) as NamesFile, order)).toBe(out);
    expect(out.endsWith("}\n")).toBe(true);
  });
  it("the committed file is exactly what the writer produces for the catalog", () => {
    const real = readNames();
    const order = loadCatalogRows().map((r) => r.id);
    expect(serializeNames(real, order)).toBe(readFileSync(NAMES_PATH, "utf8"));
  });
});

describe("the command line", () => {
  const dir = mkdtempSync(join(tmpdir(), "household-names-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const fresh = () => {
    const names = join(dir, `names-${Math.random().toString(36).slice(2)}.json`);
    // the command-line tests start from an English-only file made from the real one, so they hold whatever state the real names file is in
    const real = readNames();
    const order = loadCatalogRows().map((r) => r.id);
    const englishOnly: NamesFile = { version: real.version, pending: [...TARGET_LANGS], names: Object.fromEntries(order.map((id) => [id, { en: real.names[id]!.en }])) };
    writeFileSync(names, serializeNames(englishOnly, order));
    const out: string[] = [];
    return { names, out, io: (extra: Record<string, unknown> = {}) => ({ log: (s: string) => out.push(s), err: (s: string) => out.push(s), env: { MODEL_API_KEY: KEY }, namesPath: names, ...extra }) };
  };
  // words that pass the rules: distinct, lower case (German capitalised), no digits
  const good = Object.fromEntries(SAMPLE_IDS.map((id, i) => {
    const w = (suffix: string) => `${"abcdefghij"[i]!.repeat(3)}${suffix}`;
    return [id, { es: w("es"), fr: w("fr"), de: w("de").replace(/^./, (c) => c.toUpperCase()), it: w("it"), pt: w("pt"), tr: w("tr") }];
  }));

  it("--dry-run says what it would ask, reads no key, calls nothing, writes nothing", async () => {
    const t = fresh();
    const fetchImpl = vi.fn();
    const readFile = vi.fn(() => { throw new Error("must not read"); });
    const before = readFileSync(t.names, "utf8");
    const code = await main(["--dry-run"], t.io({ env: {}, fetchImpl, readFile }));
    expect(code).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
    expect(readFileSync(t.names, "utf8")).toBe(before);
    expect(t.out.join("\n")).toMatch(/61 item\(s\) to ask for in 7 call\(s\)/);
  });
  it("--sample asks for the ten chosen items only, prints a table, and writes NOTHING without --write", async () => {
    const t = fresh();
    const log: Array<{ prompt: string }> = [];
    const before = readFileSync(t.names, "utf8");
    const code = await main(["--sample"], t.io({ fetchImpl: makeStubFetch(good, log) }));
    expect(code).toBe(0);
    expect(log).toHaveLength(1); // ten items, one call
    const asked = [...log[0]!.prompt.matchAll(/^- ([a-z_]+): /gm)].map((m) => m[1]);
    expect(asked).toEqual([...SAMPLE_IDS].sort((a, b) => loadCatalogRows().findIndex((r) => r.id === a) - loadCatalogRows().findIndex((r) => r.id === b)));
    expect(readFileSync(t.names, "utf8")).toBe(before);
    const o = t.out.join("\n");
    expect(o).toContain("| id");
    expect(o).toContain("banana");
    expect(o).toContain("sample only: nothing written");
  });
  it("--sample --write keeps those ten and nothing else", async () => {
    const t = fresh();
    const code = await main(["--sample", "--write"], t.io({ fetchImpl: makeStubFetch(good) }));
    expect(code).toBe(0);
    const after = readNames(t.names);
    const made = Object.entries(after.names).filter(([, v]) => v.es).map(([id]) => id).sort();
    expect(made).toEqual([...SAMPLE_IDS].sort());
    expect(after.pending).toEqual([...TARGET_LANGS]); // 51 items still lack names
    expect(validateNamesFile(after)).toEqual([]);
    expect(after.names.banana!.de!.w).toBe(good.banana!.de);
  });
  it("--seed adds English only, offline, with no key and no call", async () => {
    const t = fresh();
    writeFileSync(t.names, JSON.stringify({ version: 1, pending: [], names: {} }));
    const fetchImpl = vi.fn();
    const readFile = vi.fn();
    expect(await main(["--seed"], t.io({ env: {}, fetchImpl, readFile }))).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
    expect(Object.keys(readNames(t.names).names)).toHaveLength(61);
  });
  it("uses the key for the call and NEVER prints it, not on success, not on failure", async () => {
    const t = fresh();
    const seen: string[] = [];
    const spy = (async (_u: unknown, init?: RequestInit) => {
      seen.push((init?.headers as Record<string, string>).authorization!);
      return respond({ error: `echo ${KEY} ${(init?.headers as Record<string, string>).authorization}` }, 401);
    }) as unknown as typeof fetch;
    const code = await main(["--sample"], t.io({ fetchImpl: spy }));
    expect(code).toBe(2);
    expect(seen).toEqual([`Bearer ${KEY}`]); // it was used
    expect(t.out.join("\n")).not.toContain(KEY);
    expect(t.out.join("\n")).toMatch(/HTTP 401/);
    const ok = fresh();
    await main(["--sample"], ok.io({ fetchImpl: makeStubFetch(good) }));
    expect(ok.out.join("\n")).not.toContain(KEY);
    expect(readFileSync(ok.names, "utf8")).not.toContain(KEY);
  });
  it("loads the key from the environment first and reads .dev.vars only when the environment has none, and never quotes the file", () => {
    const readFile = vi.fn(() => 'OTHER=1\nMODEL_API_KEY="from-the-file-123"\n');
    expect(loadKey({ MODEL_API_KEY: " from-env " }, readFile)).toBe("from-env");
    expect(readFile).not.toHaveBeenCalled();
    expect(loadKey({}, readFile)).toBe("from-the-file-123");
    expect(loadKey({ META_MODEL_API_KEY: "alt" }, readFile)).toBe("alt");
    const err = (() => { try { loadKey({}, () => "SOMETHING_ELSE=secret-value-999\n"); } catch (e) { return String((e as Error).message); } return ""; })();
    expect(err).toMatch(/no MODEL_API_KEY/);
    expect(err).not.toContain("secret-value-999");
  });
  it("refuses a model that is not a Muse model, an unknown item or language, without calling", async () => {
    for (const args of [["--model", "gpt-5"], ["--only", "dragon"], ["--langs", "xx"], ["--redo", "nope"]]) {
      const t = fresh();
      const fetchImpl = vi.fn();
      expect(await main(args, t.io({ fetchImpl })), args.join(" ")).toBe(2);
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });
  it("reports 1 and writes nothing when a name cannot be made, and 2 when the budget stops it", async () => {
    const t = fresh();
    const bad = (async () => text({ banana: { es: "la banana" } })) as unknown as typeof fetch;
    expect(await main(["--only", "banana", "--langs", "es"], t.io({ fetchImpl: bad }))).toBe(1);
    expect(readNames(t.names).names.banana!.es).toBeUndefined();
    const s = fresh();
    expect(await main(["--budget", "1", "--batch", "5"], s.io({ fetchImpl: makeStubFetch({}) }))).toBe(2);
    expect(s.out.join("\n")).toMatch(/budget \(1\)/);
  });
  it("formats a table with a column per language and (none) where there is no name yet", () => {
    const t = formatTable(rows, { version: 1, pending: [], names: { ball: { en: entry("ball"), es: entry("pelota") } } }, ["ball"]);
    expect(t).toContain("| id");
    expect(t).toContain("pelota");
    expect(t).toContain("(none)");
    expect(t.split("\n")).toHaveLength(3);
  });
  it("the sample is exactly the ten chosen items: a cognate, the cup-or-mug word, an edited English name, two-word items, a puzzle piece, two plurals, a compound-word trap and the toy tool", () => {
    expect([...SAMPLE_IDS]).toEqual(["banana", "mug", "soda_can", "wooden_spoon", "jigsaw", "toy_brick", "playing_cards", "scissors", "toothbrush", "support_tool"]);
  });
  it("the real catalog loads with the 60 items and the support tool", () => {
    const r = loadCatalogRows(CATALOG_PATH);
    expect(r).toHaveLength(61);
    expect(r.at(-1)!.id).toBe("support_tool");
    expect(SAMPLE_IDS.every((id) => r.some((x) => x.id === id))).toBe(true);
    expect(new Set(SAMPLE_IDS.map((id) => r.find((x) => x.id === id)!.group)).size).toBeGreaterThanOrEqual(6);
  });
});
