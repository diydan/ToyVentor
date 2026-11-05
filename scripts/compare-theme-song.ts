#!/usr/bin/env tsx
// Puts the two theme-song eval runs side by side so a person can read the lyrics (scripts/eval-theme-song.ts saves them under .local/eval/).
//
//   npx tsx scripts/compare-theme-song.ts            # newest spark and glimmer files
//   npx tsx scripts/compare-theme-song.ts --blind    # models called A and B in a fixed shuffled order per wish, key at the end
//
// Writes .local/eval/theme-song-compare[-blind]-<date>.md (git-ignored). Numbers here are the gate's (does the checked song pass) and the clock; whether the words are
// GOOD is for a reader. These outputs are for judging only: hosted-model outputs must never become training data (Meta Model API terms 10.1).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, ".local/eval");
const blind = process.argv.includes("--blind");

interface Song { name: string; mood: string; tempo: string; instruments: string[]; verse: string[]; chorus: string[] }
interface Row { kind: string; text: string; ok: boolean; attempts: number; seconds: number; reason?: string; screened?: boolean; adversarial: boolean; song?: Song }
interface Run { which: string; at: string; repeat: number; coldSeconds: number | null; rows: Row[] }

function newest(which: string): Run {
  const files = fs.readdirSync(dir).filter((f) => f.startsWith(`theme-song-${which}-`) && f.endsWith(".json")).sort();
  if (!files.length) { console.error(`no theme-song-${which}-*.json in .local/eval: run scripts/eval-theme-song.ts ${which} first`); process.exit(1); }
  return JSON.parse(fs.readFileSync(path.join(dir, files[files.length - 1]!), "utf8")) as Run;
}
const spark = newest("spark");
const glimmer = newest("glimmer");

const q = (xs: number[], p: number) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]!; };
function stats(run: Run) {
  const real = run.rows.filter((r) => !r.screened);
  const ok = real.filter((r) => r.ok);
  const secs = ok.map((r) => r.seconds);
  const reasons: Record<string, number> = {};
  for (const r of real.filter((x) => !x.ok)) reasons[r.reason ?? "?"] = (reasons[r.reason ?? "?"] ?? 0) + 1;
  return { n: real.length, ok: ok.length, first: ok.filter((r) => r.attempts === 1).length, median: q(secs, 0.5), p95: q(secs, 0.95), reasons };
}
const sS = stats(spark), sG = stats(glimmer);
const line = (label: string, s: ReturnType<typeof stats>) => `| ${label} | ${s.ok}/${s.n} | ${s.first}/${s.n} | ${s.median.toFixed(1)} s | ${s.p95.toFixed(1)} s | ${Object.keys(s.reasons).length ? JSON.stringify(s.reasons) : "none"} |`;

// a fixed per-wish coin so the A/B order does not depend on which model is "better"
const flip = (text: string) => { let h = 0; for (const c of text) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 2 === 0; };
const show = (r: Row | undefined) => {
  if (!r) return "_not run_";
  if (!r.ok || !r.song) return `**no checked song** (${r.reason ?? "no answer"}, ${r.attempts} call${r.attempts === 1 ? "" : "s"}, ${r.seconds.toFixed(1)} s)`;
  const s = r.song;
  return [`**${s.name}** · ${s.mood}, ${s.tempo}${s.instruments.length ? `, ${s.instruments.join(" + ")}` : ""} · ${r.seconds.toFixed(1)} s, ${r.attempts} call${r.attempts === 1 ? "" : "s"}`, "", ...s.verse.map((l) => `> ${l}`), ">", ...s.chorus.map((l) => `> ${l}`)].join("\n");
};

const out: string[] = [];
out.push(`# Theme songs: hosted Spark vs our own Glimmer${blind ? " (blind)" : ""}`, "");
out.push(`Same prompt, same two tries inside the 28 s budget, same lyrics gate (the real \`writeSong\` path). No song was ordered from Mureka. Spark run ${spark.at}, Glimmer run ${glimmer.at}${glimmer.coldSeconds !== null ? ` (cold start ${glimmer.coldSeconds.toFixed(0)} s, reported apart from the table)` : ""}.`, "");
out.push("| model | checked songs | first call alone | median | p95 | refusals by reason |", "|---|---|---|---|---|---|", line("Spark (hosted)", sS), line("Glimmer (ours)", sG), "");
out.push("The gate decides whether a song is allowed; it does not say whether the words are good. Read the pairs below.", "");

const wishes = [...new Map(spark.rows.filter((r) => !r.screened && !r.adversarial).map((r) => [`${r.kind}|${r.text}`, r])).values()];
const key: string[] = [];
let i = 0;
for (const w of wishes) {
  i += 1;
  const a = spark.rows.find((r) => r.kind === w.kind && r.text === w.text);
  const b = glimmer.rows.find((r) => r.kind === w.kind && r.text === w.text);
  out.push(`## ${i}. ${w.text} _(${w.kind})_`, "");
  if (blind) {
    const sparkFirst = flip(w.text);
    out.push("**A**", "", show(sparkFirst ? a : b), "", "**B**", "", show(sparkFirst ? b : a), "");
    key.push(`${i}. A = ${sparkFirst ? "Spark" : "Glimmer"}, B = ${sparkFirst ? "Glimmer" : "Spark"}`);
  } else {
    out.push("**Spark**", "", show(a), "", "**Glimmer**", "", show(b), "");
  }
}
if (blind) out.push("---", "", "## Key (look only after choosing)", "", ...key.map((k) => `- ${k}`), "");

const file = path.join(dir, `theme-song-compare${blind ? "-blind" : ""}-${new Date().toISOString().slice(0, 10)}.md`);
fs.writeFileSync(file, out.join("\n"));
console.log(out.slice(0, 9).join("\n"));
console.log(`\nsaved ${path.relative(root, file)}`);
