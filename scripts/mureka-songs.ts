#!/usr/bin/env tsx
// Make the dance party's starter songs with the Mureka API (docs/specs/dance-party-spec.md 4.3, docs/specs/mureka-api-reference.md).
//
//   npx tsx scripts/mureka-songs.ts balance
//   npx tsx scripts/mureka-songs.ts make --mood bouncy --tempo medium --instruments xylophone --n 2 --model mureka-9 --yes
//   npx tsx scripts/mureka-songs.ts status <task_id>
//
// WHAT IT DOES. `make` builds the prompt from the CLOSED song cards only (shared/songCards.ts: a mood, a tempo, up to two instruments; instrumental, no
// vocals, no names: no free text can reach the provider), asks for `n` songs, polls the task until it finishes, and saves each song's audio to
// .local/songs/raw/ (git-ignored: the files are long, the repo never holds them) with a record of the request, the prompt, the model and the balance
// before and after, which is how the REAL price per song is learned. Mureka's download links last 30 days, so the bytes are saved, not the link.
//
// MONEY. Billing is per song (`n` songs bill `n`). `make` will not spend without `--yes`, and it refuses more than MAX_N songs in one call.
// KEY. MUREKA_API_KEY is read from the environment or from .dev.vars (git-ignored) and is sent only as the Authorization header to api.mureka.ai.
// It is never printed, logged or written anywhere.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { INSTRUMENTS, MOODS, TEMPOS, buildSongRequest } from "../shared/songCards";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAW = path.join(root, ".local/songs/raw");
const BASE = "https://api.mureka.ai";
const MAX_N = 3; // the API's own maximum per call
const POLL_MS = 6000;
const TIMEOUT_MS = 25 * 60 * 1000;
const TERMINAL = new Set(["succeeded", "failed", "timeouted", "cancelled"]);

function loadKey(): string {
  if (process.env.MUREKA_API_KEY) return process.env.MUREKA_API_KEY.trim();
  const file = path.join(root, ".dev.vars");
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const m = /^\s*MUREKA_API_KEY\s*=\s*(.*?)\s*$/.exec(line);
      if (m && m[1]) return m[1].replace(/^['"]|['"]$/g, "");
    }
  }
  throw new Error("MUREKA_API_KEY is not set (environment or .dev.vars)");
}

const KEY = loadKey();

async function api(method: "GET" | "POST", pathname: string, body?: unknown): Promise<any> {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  if (!res.ok) {
    const msg = json?.error?.message ?? text.slice(0, 200);
    throw new Error(`${method} ${pathname}: HTTP ${res.status}: ${msg}${json?.trace_id ? ` (trace ${json.trace_id})` : ""}`);
  }
  return json;
}

const dollars = (cents: number) => `$${(cents / 100).toFixed(4)}`;

async function billing() {
  const b = await api("GET", "/v1/account/billing");
  return { balance: Number(b.balance), spent: Number(b.total_spending), recharged: Number(b.total_recharge), concurrency: b.concurrent_request_limit };
}

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

async function cmdBalance() {
  const b = await billing();
  console.log(`balance ${dollars(b.balance)}  (recharged ${dollars(b.recharged)}, spent ${dollars(b.spent)})  concurrent songs allowed: ${b.concurrency}`);
}

async function cmdMake() {
  const mood = arg("mood");
  const tempo = arg("tempo");
  const instruments = (arg("instruments", "") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const n = Number(arg("n", "1"));
  const model = arg("model", "mureka-9")!;
  const r = buildSongRequest({ mood, tempo, instruments });
  if (!r.ok) throw new Error(`not a song card (${r.reason}); moods: ${MOODS.join(", ")}; tempos: ${TEMPOS.join(", ")}; instruments: ${INSTRUMENTS.join(", ")}`);
  if (!Number.isInteger(n) || n < 1 || n > MAX_N) throw new Error(`--n must be 1 to ${MAX_N}`);
  console.log(`prompt: ${r.prompt}`);
  console.log(`model ${model}, ${n} song${n > 1 ? "s" : ""}, asked-for tempo ${r.bpm} bpm (the API has no tempo control: the real tempo is measured later)`);
  if (!process.argv.includes("--yes")) {
    console.log(`DRY RUN: nothing sent. Billing is per song (${n} here). Add --yes to spend.`);
    return;
  }
  const before = await billing();
  const task = await api("POST", "/v1/instrumental/generate", { model, n, prompt: r.prompt });
  console.log(`task ${task.id} ${task.status}`);
  const t0 = Date.now();
  let last = task;
  let seen = task.status;
  while (!TERMINAL.has(last.status)) {
    if (Date.now() - t0 > TIMEOUT_MS) throw new Error(`task ${task.id} still ${last.status} after ${Math.round(TIMEOUT_MS / 60000)} minutes; check it with: status ${task.id}`);
    await new Promise((res) => setTimeout(res, POLL_MS));
    last = await api("GET", `/v1/instrumental/query/${task.id}`);
    if (last.status !== seen) { seen = last.status; console.log(`  ${Math.round((Date.now() - t0) / 1000)} s: ${last.status}`); }
  }
  if (last.status !== "succeeded") throw new Error(`task ${task.id} ${last.status}${last.failed_reason ? `: ${last.failed_reason}` : ""}`);
  fs.mkdirSync(RAW, { recursive: true });
  const saved: { index: number; id: string; durationMs: number; file: string; bytes: number }[] = [];
  // numbered by position: the API leaves `index` out of the first song (0), so `c.index` cannot name a file
  for (const [i, c] of (last.choices ?? []).entries()) {
    const res = await fetch(c.url);
    if (!res.ok) throw new Error(`download of song ${i} failed: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const file = `${task.id}_${i}.mp3`;
    fs.writeFileSync(path.join(RAW, file), buf);
    saved.push({ index: i, id: c.id, durationMs: c.duration, file, bytes: buf.length });
  }
  const after = await billing();
  const record = {
    task: task.id, model: last.model ?? model, created_at: last.created_at, finished_at: last.finished_at,
    request: { mood: r.request.mood, tempo: r.request.tempo, instruments: r.request.instruments, askedBpm: r.bpm }, prompt: r.prompt, n,
    songs: saved, balanceBeforeCents: before.balance, balanceAfterCents: after.balance, costCents: before.balance - after.balance,
    madeAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(RAW, `${task.id}.json`), JSON.stringify(record, null, 1) + "\n");
  console.log(`done in ${Math.round((Date.now() - t0) / 1000)} s: ${saved.map((s) => `${s.file} (${(s.durationMs / 1000).toFixed(0)} s, ${(s.bytes / 1e6).toFixed(1)} MB)`).join(", ")}`);
  console.log(`cost ${dollars(record.costCents)} for ${saved.length} song(s) = ${dollars(record.costCents / Math.max(1, saved.length))} each; balance now ${dollars(after.balance)}`);
}

async function cmdStatus() {
  const id = process.argv[3];
  if (!id) throw new Error("usage: status <task_id>");
  const t = await api("GET", `/v1/instrumental/query/${id}`);
  console.log(`${t.id}: ${t.status}${t.failed_reason ? ` (${t.failed_reason})` : ""}, ${(t.choices ?? []).length} song(s)`);
}

const cmd = process.argv[2];
try {
  if (cmd === "balance") await cmdBalance();
  else if (cmd === "make") await cmdMake();
  else if (cmd === "status") await cmdStatus();
  else console.log("usage: balance | make --mood M --tempo T [--instruments a,b] [--n 1..3] [--model mureka-9] [--yes] | status <task_id>");
} catch (e) {
  console.error(`error: ${(e as Error).message}`);
  process.exit(1);
}
