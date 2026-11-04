#!/usr/bin/env tsx
// Run the REAL theme-song route (worker/themeSong.ts) against the real text model and the real Mureka, once, and print what happened.
//
//   npx tsx scripts/probe-theme-song.ts "a race car"            DRY RUN: asks the text model only (free of Mureka), prints the name and words
//   npx tsx scripts/probe-theme-song.ts "a race car" --yes      also orders ONE song, polls it, saves the audio, prints the real price
//
// Keys come from the environment or .dev.vars (git-ignored) and are only ever sent as Authorization headers to their own hosts; nothing prints them.
// The audio lands in .local/songs/theme/ (git-ignored). The balance is read before and after, which is how the REAL price per sung song is learned.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleThemeSong, resetThemeSongLimits, themePrompt } from "../worker/themeSong";
import { askText, resolveBackend } from "../worker/modelBackend";
import { firstJsonObject } from "../worker/muse";
import { parseThemeReply } from "../shared/songLyrics";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env: Record<string, string> = {};
const file = path.join(root, ".dev.vars");
if (fs.existsSync(file)) {
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && m[2]) env[m[1]!] = m[2].replace(/^['"]|['"]$/g, "");
  }
}
for (const k of Object.keys(process.env)) if (/^(MODEL_API_KEY|META_MODEL_API_KEY|META_MODEL_API_URL|MUREKA_API_KEY|MUSE_SPARK_MODEL|MODEL_BACKEND|TEXT_BACKEND|SELF_TEXT_[A-Z]+)$/.test(k)) env[k] = process.env[k]!;
env.THEME_SONG = "on";
env.THEME_SONG_QUOTA = "off"; // a local probe: no D1, no device id (the metered path is tested in tests/theme-song-metered.test.ts)

const description = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "a race car";
const spend = process.argv.includes("--yes");
const dollars = (cents: number) => `$${(cents / 100).toFixed(4)}`;

async function balance(): Promise<number | null> {
  if (!env.MUREKA_API_KEY) return null;
  const res = await fetch("https://api.mureka.ai/v1/account/billing", { headers: { authorization: `Bearer ${env.MUREKA_API_KEY}` } });
  return res.ok ? Number(((await res.json()) as { balance: number }).balance) : null;
}

async function main() {
  console.log(`child made: "${description}"   text backend: ${resolveBackend(env, "text").mode}`);
  if (!spend) {
    const backend = resolveBackend(env, "text");
    const t0 = Date.now();
    const asked = await askText(backend, themePrompt(description), { timeoutMs: 30_000 });
    if (!asked.ok) throw new Error(`text model failed (status ${asked.status})`);
    console.log(`text model answered in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    const checked = parseThemeReply(firstJsonObject(asked.text), { childSaid: description.toLowerCase() });
    if (!checked.ok) { console.log(`GATE REFUSED: ${checked.reason}\n${asked.text.slice(0, 600)}`); return; }
    console.log(`name: ${checked.song.name}\ncards: ${JSON.stringify(checked.song.request)}\n\n${checked.song.lyrics}`);
    console.log("\nDRY RUN: no song ordered. Add --yes to order one (about a nickel).");
    return;
  }
  resetThemeSongLimits();
  const before = await balance();
  const t0 = Date.now();
  const res = await handleThemeSong(new Request("https://probe.local/api/theme-song", { method: "POST", headers: { "content-type": "application/json", "CF-Connecting-IP": "127.0.0.1" }, body: JSON.stringify({ description }) }), env);
  const body = (await res.json()) as Record<string, any>;
  console.log(`POST -> ${res.status} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (res.status !== 200) { console.log(JSON.stringify(body)); return; }
  console.log(`name: ${body.name}   mood ${body.mood}, tempo ${body.tempo}, instruments ${JSON.stringify(body.instruments)}\n\n[Verse]\n${body.verse.join("\n")}\n\n[Chorus]\n${body.chorus.join("\n")}\n`);
  if (!body.task) { console.log(`no song ordered: ${body.songError}`); return; }
  console.log(`task ${body.task}, polling every 6 s`);
  const start = Date.now();
  for (;;) {
    if (Date.now() - start > 12 * 60_000) { console.log("gave up after 12 minutes; the task may still finish"); return; }
    await new Promise((r) => setTimeout(r, 6000));
    resetThemeSongLimits();
    const s = (await (await handleThemeSong(new Request(`https://probe.local/api/theme-song?id=${body.task}`, { headers: { "CF-Connecting-IP": "127.0.0.1" } }), env)).json()) as Record<string, any>;
    process.stdout.write(`  ${Math.round((Date.now() - start) / 1000)} s: ${s.status}\n`);
    if (s.status === "failed") return;
    if (s.status === "ready") {
      const audio = await fetch(s.url);
      const buf = Buffer.from(await audio.arrayBuffer());
      const dir = path.join(root, ".local/songs/theme");
      fs.mkdirSync(dir, { recursive: true });
      const out = path.join(dir, `${body.task}.mp3`);
      fs.writeFileSync(out, buf);
      const after = await balance();
      console.log(`READY after ${Math.round((Date.now() - start) / 1000)} s: ${(s.durationMs / 1000).toFixed(0)} s of audio, ${(buf.length / 1e6).toFixed(1)} MB, saved to ${out}`);
      if (before !== null && after !== null) console.log(`cost ${dollars(before - after)} (balance ${dollars(before)} -> ${dollars(after)})`);
      return;
    }
  }
}
main().catch((e) => { console.error(`error: ${(e as Error).message}`); process.exit(1); });
