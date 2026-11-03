// The starter library as shipped (public/kip/songs/, written by scripts/song-ingest.ts from songs made by scripts/mureka-songs.ts).
// What is checked here is what could rot silently: a file missing or changed, a tempo no dance can follow, a song whose prompt did not come from the closed cards,
// a beat grid that is not steady, a raw (long) file that slipped into the repo.
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error untyped JS module
import * as clipsMod from "../parts/kip/viewer/kip-clips.js";
import { fittingClips, parseSongIndex, songBeatMap, songInterval, type PartyClip } from "../shared/songParty";
import { MOODS, buildSongRequest } from "../shared/songCards";

/* eslint-disable @typescript-eslint/no-explicit-any */
const { KIP_CLIPS } = clipsMod as any;
const root = join(__dirname, "..");
const dir = join(root, "public/kip/songs");
const raw = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
const parsed = parseSongIndex(raw);

/** Every clip with a tempo that the party can be given: the procedural dances and what the Mixamo intake shipped. */
function partyClips(): PartyClip[] {
  const out: PartyClip[] = KIP_CLIPS.filter((c: any) => c.group === "dance" && c.bpm).map((c: any) => ({ id: c.id, bpm: c.bpm, beats: c.beats, group: "dance" }));
  const baked = JSON.parse(readFileSync(join(root, "public/kip/mixamo/baked/index.json"), "utf8"));
  for (const c of baked.clips) if (["dance", "move", "music"].includes(c.group) && c.beats) out.push({ id: c.id, bpm: c.bpm, beats: c.beats, group: c.group });
  return out;
}

describe("the starter library", () => {
  it("passes its own validator with nothing skipped, and has a song for every mood card", () => {
    expect(parsed.skipped).toEqual([]);
    expect(parsed.songs.length).toBe(raw.songs.length);
    expect(parsed.songs.length).toBeGreaterThanOrEqual(10);
    for (const mood of MOODS) expect(parsed.songs.filter((s) => s.mood === mood).length, `no song for ${mood}`).toBeGreaterThanOrEqual(1);
    expect(new Set(parsed.songs.map((s) => s.title)).size).toBe(parsed.songs.length);
  });

  it("has a file for every entry and an entry for every file, each the size it says, small, and really an MP3 file with its gapless header", () => {
    const files = readdirSync(dir).filter((f) => f !== "index.json").sort();
    expect(files).toEqual(parsed.songs.map((s) => s.file).sort());
    let total = 0;
    for (const s of parsed.songs) {
      const buf = readFileSync(join(dir, s.file));
      expect(buf.length, `${s.file}: size differs from the index`).toBe(s.bytes);
      expect(buf.length, `${s.file} is big`).toBeLessThan(1_000_000);
      // MP3 is what ships: every browser decodes it, including the open-source Chromium builds that leave AAC out (a song would fail with "Unable to decode audio data")
      expect(s.file, `${s.file}: ship MP3, not AAC`).toMatch(/\.mp3$/);
      const mp3 = buf.subarray(0, 3).toString("latin1") === "ID3" || (buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0);
      expect(mp3, `${s.file} does not start like an MP3 file`).toBe(true);
      expect(buf.includes(Buffer.from("Xing")) || buf.includes(Buffer.from("Info")), `${s.file} has no LAME/Xing header (the encoder delay would not be trimmed)`).toBe(true);
      total += buf.length;
    }
    expect(total, "the library is over 10 MB").toBeLessThan(10_000_000);
  });

  it("every song's tempo has at least one dance that fits it, so no song plays with the lights only", () => {
    const clips = partyClips();
    for (const s of parsed.songs) {
      const fit = fittingClips(60 / songInterval(s), clips).filter((f) => f.clip.group === "dance");
      expect(fit.length, `${s.id} at ${s.bpm} bpm has no dance`).toBeGreaterThanOrEqual(1);
    }
  });

  it("the tempo the audio was MEASURED at is the tempo of the card it was asked for, or its half or double (the measurement picked the right octave)", () => {
    for (const s of raw.songs) {
      const r = Math.log(s.bpm / s.asked.bpm);
      expect(Math.abs(r), `${s.id}: asked ${s.asked.bpm}, measured ${s.bpm}`).toBeLessThan(0.25);
    }
  });

  it("every song came from the closed cards: its prompt is exactly the one the cards make, instrumental, and the model and date are recorded", () => {
    for (const s of raw.songs) {
      const r = buildSongRequest({ mood: s.mood, tempo: s.asked.tempo, instruments: s.asked.instruments });
      expect(r.ok, s.id).toBe(true);
      if (r.ok) expect(s.source.prompt, `${s.id}: prompt is not the cards' prompt`).toBe(r.prompt);
      expect(s.source.prompt).toContain("Instrumental only");
      expect(s.source.model).toBe("mureka-9");
      expect(Number.isNaN(Date.parse(s.source.madeAt))).toBe(false);
      expect(s.source.task).toMatch(/^\d+$/);
      expect(s.ai).toBe(true);
    }
  });

  it("every excerpt sits on a steady beat grid (the ingest refuses a song whose beats wander), and the grid reproduces the loop exactly", () => {
    for (const s of raw.songs) {
      expect(s.analysis.gridRmsMs, `${s.id} rms`).toBeLessThanOrEqual(30);
      expect(s.analysis.gridMaxMs, `${s.id} max`).toBeLessThanOrEqual(90);
      const m = songBeatMap(s, 600);
      expect(m.beats[s.beats]! - m.beats[0]!, s.id).toBeCloseTo(s.dur, 6);
      expect(m.bpm).toBeCloseTo(s.bpm, 0);
    }
  });

  it("starts on a downbeat a moment after the file begins, and ends a whole number of bars later", () => {
    for (const s of parsed.songs) {
      expect(s.offset).toBeGreaterThan(0);
      expect(s.offset).toBeLessThan(0.1);
      expect(s.beats % 4).toBe(0);
      expect(s.dur).toBeGreaterThan(30);
      expect(s.dur).toBeLessThan(100);
    }
  });

  it("the per-song corrections file is valid: only known songs, shifts of 0 to 3 beats", () => {
    const o = JSON.parse(readFileSync(join(root, "scripts/song-overrides.json"), "utf8"));
    const known = new Set(raw.songs.map((s: any) => s.id));
    for (const [id, v] of Object.entries<any>(o)) {
      if (id.startsWith("_")) continue;
      expect(known.has(id), `${id} is not a song in the library`).toBe(true);
      expect([0, 1, 2, 3]).toContain(v.shift ?? 0);
    }
  });

  it("the long raw files are not in the repo: .local/ is ignored and no raw Mureka file is tracked", () => {
    const tracked = execSync("git ls-files", { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\n");
    expect(tracked.filter((f) => f.startsWith(".local/"))).toEqual([]);
    // the only song audio in the repo is the excerpts the index lists: a long raw file, or one not in the index, fails here
    const shipped = new Set(parsed.songs.map((s) => `public/kip/songs/${s.file}`));
    const stray = tracked.filter((f) => /\.(mp3|wav|flac|m4a|ogg)$/i.test(f) && /song/i.test(f) && !shipped.has(f));
    expect(stray, "audio with 'song' in its path that is not in the library index").toEqual([]);
    expect(() => execSync("git check-ignore -q .local/songs/raw/x.mp3", { cwd: root })).not.toThrow();
    expect(existsSync(join(root, ".dev.vars")) ? statSync(join(root, ".dev.vars")).isFile() : true).toBe(true);
    expect(() => execSync("git check-ignore -q .dev.vars", { cwd: root })).not.toThrow(); // the key's file is never committed
  });
});
