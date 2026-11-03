#!/usr/bin/env tsx
// Turn the raw Mureka songs (.local/songs/raw/, written by scripts/mureka-songs.ts) into the party's starter library (docs/specs/dance-party-spec.md 4.3 and 4.4):
//
//   npx tsx scripts/song-ingest.ts            # analyse every raw song, cut and encode (MP3) an excerpt of each, write public/kip/songs/
//   npx tsx scripts/song-ingest.ts --dry      # analyse and report only; write nothing
//   npx tsx scripts/song-ingest.ts --only bouncy_a,space_b
//
// Per song: decode -> measure the beat (shared/songAnalyze.ts: tempo, beats, the "1") -> pick a whole number of bars from the steadiest, loudest stretch,
// away from the intro and from the end of the file (where Mureka appends an audio watermark) -> cut it ON the beat grid so it loops in time -> level it to
// the party's loudness -> encode small (MP3) -> write the file and its entry in index.json. A song whose beats do not sit on one steady tempo, or whose
// tempo no dance can follow, is REJECTED and named, not forced: the measured tempo is the one the party uses, whatever the card asked for.
//
// The raw files are never copied into the repo. What ships is the excerpt, labelled as made by AI, with the prompt, the model and the date it was made.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeSong, fitGrid, pickExcerpt } from "../shared/songAnalyze";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAW = path.join(root, ".local/songs/raw");
const OUT = path.join(root, "public/kip/songs");
const SR = 22050; // the analysis rate
const PREROLL = 0.02; // the first beat of an excerpt sounds this long after it starts, so its attack is not clipped
const TARGET_SECONDS = 64;
// A song is kept when its beats lie on one steady tempo (milliseconds from the grid) and some dance can follow that tempo (64 to 170 bpm, tests/kip-baked-clips.test.ts).
const MAX_GRID_RMS_MS = 30;
const MAX_GRID_MAX_MS = 90;
const MIN_BPM = 64;
const MAX_BPM = 170;
// The party's loudness: music levelled to the usual streaming level, then played at the party's own gain (kip-party-audio.js), so a song sits where the practice beat does.
const LOUDNESS = "loudnorm=I=-14:TP=-1.5:LRA=11";

// Titles are ours, not the provider's. A mood's songs are numbered a, b, c, d in the order they were made (a job's two songs, then the next job's), so adding
// more later never renames the ones already shipped.
const TITLES: Record<string, string[]> = {
  bouncy: ["Bounce Along", "Hop, Skip, Jump", "Trampoline Time", "Puddle Splash"],
  sleepy: ["Moonlight Rock", "Cozy Clouds", "Sleepy Stars", "Blanket Boat"],
  silly: ["Silly Parade", "Goofy Gallop", "Wobbly Walk", "Banana Boogie"],
  space: ["Orbit Dance", "Comet Trail", "Moon Bounce", "Rocket Rumble"],
  kitchen: ["Kitchen Jam", "Pots and Pans", "Spoon Shuffle", "Pancake Parade"],
  cleanup: ["Tidy-Up March", "Sparkle Sweep", "Bubble Brigade", "Dust Bunny Dance"],
};
const MOOD_ORDER = ["bouncy", "sleepy", "silly", "space", "kitchen", "cleanup"];

// scripts/song-overrides.json: { "<song id>": { "shift": 0..3 } } moves a song's bar line later by that many beats. The downbeat (the "1") is the least certain thing
// the analysis finds, and the party's Beat click plays a higher tick on it, so a person can hear when it is wrong and say by how much.
const overrides: Record<string, { shift?: number }> = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "song-overrides.json"), "utf8"));

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const only = args.includes("--only") ? args[args.indexOf("--only") + 1]!.split(",") : null;

function decodeMono(file: string): Float32Array {
  const buf = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-ac", "1", "-ar", String(SR), "-f", "f32le", "pipe:1"], { maxBuffer: 1 << 30 });
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
}

interface Entry {
  id: string; title: string; mood: string; asked: { tempo: string; instruments: string[]; bpm: number };
  file: string; bytes: number; dur: number; bpm: number; beats: number; bars: number; offset: number;
  loop: true; ai: true;
  source: { task: string; model: string; prompt: string; madeAt: string; fullSeconds: number; excerptFrom: number };
  analysis: { gridRmsMs: number; gridMaxMs: number; tempoStrength: number; alternateBpm: number | null; downbeatMargin: number };
}

const rows: string[] = [];
const entries: Entry[] = [];
const rejected: string[] = [];
const records = fs.readdirSync(RAW).filter((f) => /^\d+\.json$/.test(f)).map((f) => JSON.parse(fs.readFileSync(path.join(RAW, f), "utf8"))).sort((p, q) => String(p.madeAt).localeCompare(String(q.madeAt)));
const madeOfMood: Record<string, number> = {};
for (const rec of records) {
  for (const song of rec.songs) {
    const mood: string = rec.request.mood;
    const titles = TITLES[mood] ?? [mood, mood, mood, mood];
    const n = madeOfMood[mood] ?? 0;
    madeOfMood[mood] = n + 1;
    const id = `${mood}_${"abcdefgh"[n]}`;
    if (only && !only.includes(id)) continue;
    const src = path.join(RAW, song.file);
    const x = decodeMono(src);
    const full = x.length / SR;
    const a = analyzeSong(x, SR, { hintBpm: rec.request.askedBpm });
    // a short song gets a shorter excerpt: as long as fits between the intro and the end, down to 8 bars
    let ex = null as ReturnType<typeof pickExcerpt>;
    for (const target of [TARGET_SECONDS, 52, 44, 36, 28]) { ex = pickExcerpt(a, full, { targetSeconds: target }); if (ex) break; }
    let verdict = "ok";
    if (!ex) verdict = "no excerpt (too short or no steady stretch)";
    const shift = overrides[id]?.shift ?? 0;
    if (ex && shift) { // the bar line moves later: the excerpt starts `shift` beats on, and still ends a whole number of bars after it
      if (!Number.isInteger(shift) || shift < 0 || shift > 3 || ex.startBeat + shift + ex.bars * 4 >= a.beats.length) throw new Error(`${id}: shift ${shift} is not usable`);
      ex.startBeat += shift;
      ex.start = a.beats[ex.startBeat]!;
      ex.end = a.beats[ex.startBeat + ex.bars * 4]!;
    }
    const local = ex ? fitGrid(a.beats.slice(ex.startBeat, ex.startBeat + ex.bars * 4 + 1)) : a.grid;
    if (ex && (local.rmsMs > MAX_GRID_RMS_MS || local.maxMs > MAX_GRID_MAX_MS)) verdict = `beats not steady (${local.rmsMs.toFixed(0)} ms rms, ${local.maxMs.toFixed(0)} max)`;
    if (local.bpm < MIN_BPM || local.bpm > MAX_BPM) verdict = `tempo ${local.bpm.toFixed(0)} bpm is outside what the dances follow`;
    rows.push(`${id.padEnd(9)} ${full.toFixed(0).padStart(4)} s  asked ${String(rec.request.askedBpm).padStart(3)}  heard ${a.bpm.toFixed(1).padStart(6)} (excerpt grid ${local.bpm.toFixed(2)}, ${local.rmsMs.toFixed(0)}/${local.maxMs.toFixed(0)} ms)  strength ${a.tempo.strength.toFixed(2)}${a.tempo.alternate ? `  alt ${a.tempo.alternate.toFixed(0)}` : ""}  grid ${a.grid.rmsMs.toFixed(0)}/${a.grid.maxMs.toFixed(0)} ms  downbeat x${a.downbeatMargin.toFixed(1)}  ${ex ? `excerpt ${ex.start.toFixed(1)}-${ex.end.toFixed(1)} s (${ex.bars} bars)` : ""}  -> ${verdict}`);
    if (verdict !== "ok" || !ex) { rejected.push(`${id}: ${verdict}`); continue; }
    if (dry) continue;

    // cut on the fitted grid so the excerpt is exactly `bars x 4` beats long and loops in time
    const interval = local.interval;
    const length = ex.bars * 4 * interval;
    const start = local.t0 - PREROLL;
    fs.mkdirSync(OUT, { recursive: true });
    const outFile = path.join(OUT, `${id}.mp3`);
    execFileSync("ffmpeg", [
      "-v", "error", "-y", "-ss", start.toFixed(5), "-t", length.toFixed(5), "-i", src,
      "-af", `${LOUDNESS},afade=t=in:st=0:d=0.01,afade=t=out:st=${(length - 0.01).toFixed(5)}:d=0.01`,
      // MP3, not AAC: every browser decodes it, including the open-source Chromium builds (embedded browsers, Electron) that leave AAC out, where a song would fail with
      // "Unable to decode audio data". LAME writes its encoder delay into the file's header, which browsers trim, so the excerpt still starts on its grid (checked in Chrome).
      "-ac", "2", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "96k", "-joint_stereo", "1", "-write_id3v2", "0", "-map_metadata", "-1", outFile,
    ]);
    // check what was written: decode it again and measure
    const back = decodeMono(outFile);
    const check = analyzeSong(back, SR);
    const bytes = fs.statSync(outFile).size;
    entries.push({
      id, title: titles[n] ?? `${mood} ${n + 1}`, mood,
      asked: { tempo: rec.request.tempo, instruments: rec.request.instruments, bpm: rec.request.askedBpm },
      // `dur` is the NOMINAL loop length (the bars x 4 beats the file was cut to), NOT the length ffmpeg decodes it to: that includes the encoder's padding (about 18 ms),
      // which is not in the audio a browser plays (it honours the file's edit list), and used as the loop length it drifts the beat grid 18 ms every loop
      file: `${id}.mp3`, bytes, dur: Number(length.toFixed(4)), bpm: Number((60 / interval).toFixed(4)), beats: ex.bars * 4, bars: ex.bars,
      offset: PREROLL, loop: true, ai: true,
      source: { task: rec.task, model: rec.model, prompt: rec.prompt, madeAt: rec.madeAt, fullSeconds: Number(full.toFixed(1)), excerptFrom: Number(start.toFixed(3)) },
      analysis: { gridRmsMs: Number(local.rmsMs.toFixed(1)), gridMaxMs: Number(local.maxMs.toFixed(1)), tempoStrength: Number(a.tempo.strength.toFixed(2)), alternateBpm: a.tempo.alternate, downbeatMargin: Number(a.downbeatMargin.toFixed(2)) },
    });
    console.log(`wrote ${id}.mp3  ${(bytes / 1e6).toFixed(2)} MB, ${(back.length / SR).toFixed(2)} s; decoded again: ${check.bpm.toFixed(2)} bpm`);
  }
}
console.log("\n" + rows.join("\n"));
if (rejected.length) console.log(`\nrejected (${rejected.length}):\n  ${rejected.join("\n  ")}`);
if (!dry && !only) {
  entries.sort((p, q) => MOOD_ORDER.indexOf(p.mood) - MOOD_ORDER.indexOf(q.mood) || p.id.localeCompare(q.id));
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify({ v: 1, songs: entries }, null, 1) + "\n");
  const keep = new Set(entries.map((e) => e.file));
  for (const f of fs.readdirSync(OUT)) if (/\.(mp3|m4a)$/.test(f) && !keep.has(f)) { fs.unlinkSync(path.join(OUT, f)); console.log(`removed the old ${f}`); }
  console.log(`\n${entries.length} songs in public/kip/songs/ (${(entries.reduce((s, e) => s + e.bytes, 0) / 1e6).toFixed(1)} MB)`);
}
