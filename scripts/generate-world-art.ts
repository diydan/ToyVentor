// The showcase worlds for generated worlds (docs/specs/generated-worlds-spec.md section 0): wish -> Muse Spark brief -> Muse Image far day, far night and mid strip, OFFLINE, with the same shared code the Worker uses
// (shared/worldBrief.ts: the brief prompt, the validator, the image templates). Raw outputs are the ART OF RECORD (the service takes no seed: a picture cannot be regenerated, only replaced): they are written to
// docs/mockups/generated-backdrops/looks/<id>/ with the verbatim prompts, the validated brief and the call numbers in looks/manifest.json. EVERY ARTIFACT THAT ALREADY EXISTS IS SKIPPED: a second run never spends
// again on it. `python3 scripts/make-backdrops.py looks` then bakes them into the game's own assets (runtime/assets/looks/).
//
//   npx tsx scripts/generate-world-art.ts --list                  the wishes and which pieces exist
//   npx tsx scripts/generate-world-art.ts candy-forest pirate-room  only these (an outdoor world is 1 text call + 3 image calls, an indoor one 1 text call)
//   npx tsx scripts/generate-world-art.ts --all                   every wish that is not complete yet
//   npx tsx scripts/generate-world-art.ts --force-art candy-forest  paint the three images again (new calls); --force-brief rewrites the brief too
//
// The key and base URL come from .dev.vars (never printed).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SAFETY, firstJsonObject, kidSafeText, scrubContactDetails } from "../worker/muse";
import { outputTextOf } from "../worker/modelBackend";
import { BASES, IMAGE_SIZE, MAX_WISH_CHARS, briefPrompt, farPrompt, midPrompt, parseBrief, type Base, type WorldBrief } from "../shared/worldBrief";
import { SHOWCASE } from "./lib/world-showcase";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "docs", "mockups", "generated-backdrops", "looks");
const MANIFEST = path.join(DIR, "manifest.json");

const vars = Object.fromEntries(readFileSync(path.join(ROOT, ".dev.vars"), "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]));
const key = vars.MODEL_API_KEY || vars.META_MODEL_API_KEY;
const base = (vars.META_MODEL_API_URL || "").replace(/\/+$/, "");

interface Manifest { [id: string]: { wish: string; base: string; at?: string; spark?: { prompt: string; ms: number; usage: unknown }; brief?: WorldBrief; images?: Record<string, { prompt: string; file: string; bytes: number; ms: number; usage: unknown; at: string }> } }
const readManifest = (): Manifest => { try { return JSON.parse(readFileSync(MANIFEST, "utf8")); } catch { return {}; } };
const writeManifest = (m: Manifest) => { mkdirSync(DIR, { recursive: true }); writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + "\n"); };
const dirOf = (id: string) => path.join(DIR, id);
const briefFile = (id: string) => path.join(dirOf(id), "brief.json");
const imgFile = (id: string, piece: string, ext = "webp") => path.join(dirOf(id), `${piece}.${ext}`);
const haveImg = (id: string, piece: string) => existsSync(imgFile(id, piece)) || existsSync(imgFile(id, piece, "png"));
const PIECES = ["far-day", "far-night", "mid"] as const;

let sparkCalls = 0, imageCalls = 0;

async function post(urlPath: string, body: unknown, timeoutMs: number): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}${urlPath}`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json };
}

/** The brief: the Worker's own prompt, the same safety prefix and contact scrub, the same validator with the child-safe check. Retries ONCE when the answer is not a valid brief (a different answer; the service has no seed). */
async function makeBrief(id: string, wish: string, theme: Base): Promise<{ brief: WorldBrief; prompt: string; ms: number; usage: unknown }> {
  const prompt = `${SAFETY}\n\n${scrubContactDetails(briefPrompt(wish.slice(0, MAX_WISH_CHARS), theme))}`;
  const childSaid = wish.toLowerCase().replace(/\s+/g, " ").trim();
  let last = "no answer";
  for (let attempt = 0; attempt < 2; attempt++) {
    const t0 = Date.now();
    sparkCalls++;
    const r = await post("/responses", { model: "muse-spark-1.3", input: prompt, reasoning: { effort: "low" } }, 90_000);
    if (r.status !== 200) { last = `HTTP ${r.status}`; continue; }
    const parsed = parseBrief(firstJsonObject(outputTextOf(r.json)), { base: theme, safe: (s) => kidSafeText(s, childSaid) });
    if (parsed.ok) return { brief: parsed.brief, prompt, ms: Date.now() - t0, usage: r.json?.usage ?? null };
    last = `refused: ${parsed.reason}`;
  }
  throw new Error(`${id}: no valid brief (${last})`);
}

async function paint(id: string, piece: (typeof PIECES)[number], prompt: string): Promise<{ file: string; bytes: number; ms: number; usage: unknown; at: string }> {
  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const t0 = Date.now();
    imageCalls++;
    try {
      const r = await post("/images/generations", { model: "muse-image-1.0", prompt, n: 1, size: IMAGE_SIZE, response_format: "b64_json" }, 150_000);
      const b64 = r.json?.data?.[0]?.b64_json;
      if (r.status === 200 && b64) {
        const bytes = Buffer.from(b64, "base64");
        const ext = bytes.subarray(0, 4).toString("latin1") === "\x89PNG" ? "png" : "webp";
        mkdirSync(dirOf(id), { recursive: true });
        const file = imgFile(id, piece, ext);
        writeFileSync(file, bytes);
        return { file: path.relative(DIR, file), bytes: bytes.length, ms: Date.now() - t0, usage: r.json?.usage ?? null, at: new Date().toISOString() };
      }
      lastErr = `HTTP ${r.status} ${JSON.stringify(r.json)?.slice(0, 120)}`;
    } catch (e) { lastErr = String(e).slice(0, 120); }
    await new Promise((res) => setTimeout(res, 15_000));                                   // (a 500 from the service is usually transient)
  }
  throw new Error(`${id}/${piece}: ${lastErr}`);
}

async function generate(id: string, force: { art: boolean; brief: boolean }): Promise<void> {
  const job = SHOWCASE.find((j) => j.id === id);
  if (!job) throw new Error(`unknown wish id ${id}`);
  const m = readManifest();
  const entry = (m[id] ??= { wish: job.wish, base: job.base });
  mkdirSync(dirOf(id), { recursive: true });
  let brief: WorldBrief | null = null;
  if (existsSync(briefFile(id)) && !force.brief) brief = JSON.parse(readFileSync(briefFile(id), "utf8")) as WorldBrief;
  else {
    const b = await makeBrief(id, job.wish, job.base);
    brief = b.brief;
    writeFileSync(briefFile(id), JSON.stringify(brief, null, 2) + "\n");
    entry.spark = { prompt: b.prompt, ms: b.ms, usage: b.usage };
    entry.brief = brief;
    entry.at = new Date().toISOString();
    writeManifest(m);
    console.log(`briefed  ${id}: "${brief.name}" (${brief.kind}) ${b.ms} ms`);
  }
  if (brief.kind === "indoor") { console.log(`indoor   ${id}: no painted layers`); return; }
  const todo = PIECES.filter((p) => force.art || !haveImg(id, p));
  if (!todo.length) { console.log(`complete ${id}: all three images exist`); return; }
  const promptOf = (p: (typeof PIECES)[number]) => (p === "far-day" ? farPrompt(brief!.far, "day") : p === "far-night" ? farPrompt(brief!.far, "night") : midPrompt(brief!.mid));
  const done = await Promise.allSettled(todo.map((p) => paint(id, p, promptOf(p)).then((r) => ({ p, r }))));
  entry.images ??= {};
  for (const d of done) {
    if (d.status === "fulfilled") { entry.images[d.value.p] = { prompt: promptOf(d.value.p), ...d.value.r }; console.log(`painted  ${id}/${d.value.p}: ${d.value.r.bytes} bytes, ${d.value.r.ms} ms`); }
    else console.log(`FAILED   ${d.reason}`);
  }
  writeManifest(m);
}

async function main() {
  const args = process.argv.slice(2);
  const list = args.includes("--list");
  const force = { art: args.includes("--force-art"), brief: args.includes("--force-brief") };
  const ids = args.includes("--all") ? SHOWCASE.map((j) => j.id) : args.filter((a) => !a.startsWith("--"));
  if (list || !ids.length) {
    const m = readManifest();
    for (const j of SHOWCASE) {
      const have = [existsSync(briefFile(j.id)) ? "brief" : "-", ...PIECES.map((p) => (haveImg(j.id, p) ? p : "-"))].join(" ");
      console.log(`${j.id.padEnd(16)} ${j.base.padEnd(7)} ${have.padEnd(32)} "${j.wish}"${m[j.id]?.brief ? `  -> ${m[j.id]!.brief!.name}` : ""}`);
    }
    if (!list) console.log("\ngive wish ids or --all to generate (each outdoor world is 1 text call + 3 image calls)");
    return;
  }
  if (!key || !base) throw new Error("no key or base URL in .dev.vars");
  if (!(BASES as readonly string[]).length) throw new Error("no bases");
  for (const id of ids) {
    try { await generate(id, force); } catch (e) { console.log(`FAILED   ${String(e).slice(0, 200)}`); }
  }
  console.log(`\n${sparkCalls} text call(s), ${imageCalls} image call(s) made`);
}

main().catch((e) => { console.error(String(e).slice(0, 300)); process.exit(1); });
