import { describe, expect, it } from "vitest";
import {
  ANALYSIS_RATE, MAX_GRID_RMS_MS, MIN_BARS, PREROLL_S, WATERMARK_TAIL_S,
  analyseTheme, cutToWav, planThemeCut, themeIndexEntry, themeSongId, toAnalysisMono,
} from "../shared/themeParty";
import { parseSongIndex } from "../shared/songParty";

// A synthetic "song": a kick on every beat (louder on the 1 of each bar) plus a hi-hat on the off-beats, then a loud unsteady burst in the last 5 s like a watermark.
const SR = 22050;
function song(bpm: number, seconds: number, { watermark = true, sr = SR } = {}): Float32Array[] {
  const n = Math.round(seconds * sr);
  const x = new Float32Array(n);
  const iv = 60 / bpm;
  const first = 0.54;
  for (let k = 0; first + k * iv < seconds - (watermark ? 5 : 0); k++) {
    const t0 = Math.round((first + k * iv) * sr);
    const amp = k % 4 === 0 ? 0.9 : 0.5;
    for (let i = 0; i < 0.12 * sr && t0 + i < n; i++) x[t0 + i]! += amp * Math.sin((2 * Math.PI * (70 + 40 * Math.exp(-i / (0.02 * sr))) * i) / sr) * Math.exp(-i / (0.04 * sr));
    const h0 = Math.round((first + k * iv + iv / 2) * sr);
    for (let i = 0; i < 0.02 * sr && h0 + i < n; i++) x[h0 + i]! += 0.15 * Math.sin(i * 1.9) * Math.exp(-i / (0.005 * sr));
  }
  if (watermark) {
    let seed = 7;
    for (let i = Math.round((seconds - 5) * sr); i < n; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; x[i] = x[i]! + 0.5 * ((seed / 0x7fffffff) * 2 - 1) * (0.5 + 0.5 * Math.sin(i / 900)); }
  }
  return [x];
}

describe("toAnalysisMono", () => {
  it("averages the channels and resamples to 22.05 kHz", () => {
    const l = new Float32Array(44100).fill(0.5);
    const r = new Float32Array(44100).fill(-0.1);
    const m = toAnalysisMono([l, r], 44100);
    expect(m.length).toBe(22050);
    expect(m[100]).toBeCloseTo(0.2, 5);
  });
  it("passes 22.05 kHz mono through unchanged and answers an empty song with nothing", () => {
    const x = new Float32Array([0.1, 0.2, 0.3]);
    expect(Array.from(toAnalysisMono([x], ANALYSIS_RATE))).toEqual(Array.from(x).map((v) => Math.fround(v)));
    expect(toAnalysisMono([], 44100).length).toBe(0);
    expect(toAnalysisMono([new Float32Array(0)], 44100).length).toBe(0);
  });
});

describe("analyseTheme: a measured, planned cut", () => {
  const ch = song(106, 50);
  const r = analyseTheme(ch, SR);
  it("finds the tempo and a whole number of bars that ends before the watermark", () => {
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { cut } = r;
    expect(cut.bpm).toBeGreaterThan(105);
    expect(cut.bpm).toBeLessThan(107);
    expect(cut.beats).toBe(cut.bars * 4);
    expect(cut.bars).toBeGreaterThanOrEqual(15);
    expect(cut.startSec + cut.lengthSec).toBeLessThanOrEqual(50 - WATERMARK_TAIL_S + 0.2);
    expect(cut.lengthSec).toBeCloseTo(cut.bars * 4 * cut.interval, 9);
    expect(cut.gridRmsMs).toBeLessThan(MAX_GRID_RMS_MS);
  });
  it("starts the cut a hair before the first beat, so its attack is not clipped", () => {
    if (!r.ok) throw new Error("expected ok");
    expect(r.cut.offset).toBeCloseTo(PREROLL_S, 3);
  });
  it("makes an index entry the party's own checker accepts, with the AI label and a my_ id", () => {
    if (!r.ok) throw new Error("expected ok");
    const entry = themeIndexEntry({ task: "170010186285057", name: "Stompy Big Buddy", mood: "bouncy" }, r.cut, 1_600_000);
    const parsed = parseSongIndex({ v: 1, songs: [entry] });
    expect(parsed.skipped).toEqual([]);
    expect(parsed.songs).toHaveLength(1);
    expect(parsed.songs[0]).toMatchObject({ id: "my_170010186285057", title: "Stompy Big Buddy", mood: "bouncy", ai: true, bars: r.cut.bars });
  });
  it("works from a 44.1 kHz file too", () => {
    const stereo = song(106, 50, { sr: 44100 });
    const both = analyseTheme([stereo[0]!, stereo[0]!], 44100);
    expect(both.ok).toBe(true);
    if (both.ok) expect(Math.abs(both.cut.bpm - 106)).toBeLessThan(1);
  });
  it("refuses a song that is too short to dance to", () => {
    expect(analyseTheme(song(106, 8), SR)).toEqual({ ok: false, reason: "too_short" });
  });
});

describe("planThemeCut: the rules, on crafted beats", () => {
  const beatsAt = (n: number, iv: number, t0 = 0.5, jitter = 0) => Array.from({ length: n }, (_, i) => t0 + i * iv + (i % 2 ? jitter : -jitter));
  it("leaves the watermark off: the last whole bar ends at or before duration minus the tail", () => {
    const beats = beatsAt(100, 0.5);
    const r = planThemeCut({ beats, downbeat: 0, downbeatMargin: 2 }, 40);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.cut.startSec + r.cut.lengthSec).toBeLessThanOrEqual(40 - WATERMARK_TAIL_S + PREROLL_S + 1e-6);
  });
  it("starts at the first 1 the analyzer found, not at beat 0", () => {
    const beats = beatsAt(100, 0.5);
    const a = planThemeCut({ beats, downbeat: 0, downbeatMargin: 2 }, 40);
    const b = planThemeCut({ beats, downbeat: 2, downbeatMargin: 2 }, 40);
    if (!a.ok || !b.ok) throw new Error("expected ok");
    expect(b.cut.startSec - a.cut.startSec).toBeCloseTo(1, 6);
  });
  it("refuses unsteady beats, a tempo no dance follows, too few beats and too little before the watermark", () => {
    expect(planThemeCut({ beats: beatsAt(60, 0.5, 0.5, 0.06), downbeat: 0, downbeatMargin: 2 }, 40)).toEqual({ ok: false, reason: "beats_not_steady" });
    expect(planThemeCut({ beats: beatsAt(100, 0.3), downbeat: 0, downbeatMargin: 2 }, 40)).toEqual({ ok: false, reason: "tempo_out_of_range" });
    expect(planThemeCut({ beats: beatsAt(100, 1.2), downbeat: 0, downbeatMargin: 2 }, 100)).toEqual({ ok: false, reason: "tempo_out_of_range" });
    expect(planThemeCut({ beats: beatsAt(10, 0.5), downbeat: 0, downbeatMargin: 2 }, 40)).toEqual({ ok: false, reason: "too_few_beats" });
    expect(planThemeCut({ beats: beatsAt(100, 0.5), downbeat: 0, downbeatMargin: 2 }, 12).ok).toBe(false);
    expect(MIN_BARS).toBeGreaterThanOrEqual(4);
  });
});

describe("cutToWav", () => {
  const sr = 8000;
  const l = Float32Array.from({ length: sr * 2 }, (_, i) => (i % 100) / 200);
  const r = Float32Array.from({ length: sr * 2 }, () => -0.25);
  const wav = cutToWav([l, r], sr, { startSec: 0.5, lengthSec: 1 });
  const v = new DataView(wav);
  const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  it("is a 16-bit PCM stereo WAV of exactly the cut's length", () => {
    expect([tag(0), tag(8), tag(12), tag(36)]).toEqual(["RIFF", "WAVE", "fmt ", "data"]);
    expect(v.getUint16(20, true)).toBe(1);
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(sr);
    expect(v.getUint16(34, true)).toBe(16);
    expect(wav.byteLength).toBe(44 + sr * 1 * 2 * 2);
    expect(v.getUint32(40, true)).toBe(sr * 4);
  });
  it("copies the right samples (the cut starts 0.5 s in) and fades both ends so a loop's seam does not click", () => {
    const mid = 44 + 2000 * 4; // well past the 10 ms fade
    expect(v.getInt16(mid + 2, true)).toBeCloseTo(-0.25 * 32768, -1);
    const srcIndex = Math.round(0.5 * sr) + 2000;
    expect(v.getInt16(mid, true) / 32768).toBeCloseTo(l[srcIndex]!, 3);
    expect(Math.abs(v.getInt16(44, true))).toBeLessThan(0.1 * 32768);
    expect(Math.abs(v.getInt16(wav.byteLength - 4, true))).toBeLessThan(0.1 * 32768);
  });
  it("is mono when the song is mono, and never reads past the end of the source", () => {
    const m = cutToWav([l], sr, { startSec: 1.5, lengthSec: 5 });
    expect(new DataView(m).getUint16(22, true)).toBe(1);
    expect(m.byteLength).toBe(44 + sr * 0.5 * 2);
  });
});

describe("ids", () => {
  it("a task becomes a my_ id of digits only, short enough for the index's own pattern", () => {
    expect(themeSongId("170010186285057")).toBe("my_170010186285057");
    expect(themeSongId("../../x1")).toBe("my_1");
    expect(themeSongId("9".repeat(80))).toHaveLength(3 + 30);
  });
});
