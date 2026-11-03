// Finding a song's beat from its audio (shared/songAnalyze.ts; docs/specs/dance-party-spec.md 4.4). Tested on synthetic drum tracks, where the right answer
// is known: a kick on every beat (louder on the "1"), a snare on 2 and 4, hats on the eighths, a bass note under it.
//
// The tempo and downbeat checks are functions of the analyzer and are also run on analyzers broken on purpose (one that always says 120, one that always
// calls the first beat the "1"): each must be caught, or the check proves nothing.
import { describe, expect, it } from "vitest";
import { analyzeSong, estimateTempo, findDownbeat, fitGrid, onsetEnvelope, pickExcerpt, trackBeats, type Analysis } from "../shared/songAnalyze";

const SR = 22050;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

interface Opts { bpm: number; seconds: number; offset?: number; jitterMs?: number; driftPct?: number; bars?: boolean; seed?: number; startPos?: number }

/** A drum track and the true beat times (seconds) with each beat's position in its bar (0 to 3). */
function drums({ bpm, seconds, offset = 0.31, jitterMs = 0, driftPct = 0, bars = true, seed = 1, startPos = 0 }: Opts) {
  const rand = rng(seed);
  const x = new Float32Array(Math.floor(seconds * SR));
  const truth: { t: number; pos: number }[] = [];
  let t = offset, k = startPos; // startPos: the track begins part-way through a bar, as a cut-out of a song does
  while (t < seconds - 0.3) {
    const inst = 60 / (bpm * (1 + (driftPct / 100) * Math.sin((2 * Math.PI * t) / 20))); // the beat length wobbles by +-driftPct on a 20 s cycle
    const pos = k % 4;
    const when = t + ((rand() - 0.5) * 2 * jitterMs) / 1000;
    truth.push({ t: when, pos });
    const at = Math.floor(when * SR);
    const kickAmp = bars && pos === 0 ? 1.0 : 0.55;
    for (let i = 0; i < 0.12 * SR && at + i < x.length; i++) x[at + i]! += kickAmp * Math.sin(2 * Math.PI * 58 * (i / SR)) * Math.exp(-i / (0.035 * SR));
    if (pos === 1 || pos === 3) for (let i = 0; i < 0.09 * SR && at + i < x.length; i++) x[at + i]! += 0.35 * (rand() * 2 - 1) * Math.exp(-i / (0.03 * SR));
    for (const h of [0, 0.5]) { // hats on the eighths
      const ha = Math.floor((when + h * inst) * SR);
      for (let i = 0; i < 0.03 * SR && ha + i < x.length; i++) x[ha + i]! += 0.1 * (rand() * 2 - 1) * Math.exp(-i / (0.008 * SR));
    }
    for (let i = 0; i < inst * SR && at + i < x.length; i++) x[at + i]! += 0.12 * Math.sin(2 * Math.PI * 110 * (i / SR)) * (pos % 2 === 0 ? 1 : 0.7); // a bass tone under the beat
    t += inst;
    k++;
  }
  return { x, truth };
}

/** How many true beats have a detected beat within `tolMs`. */
function matched(a: { beats: number[] }, truth: { t: number }[], tolMs: number): number {
  let ok = 0;
  for (const tr of truth) if (a.beats.some((b) => Math.abs(b - tr.t) * 1000 <= tolMs)) ok++;
  return ok / truth.length;
}

describe("beat analysis on drum tracks with a known answer", () => {
  const tempos = [75, 90, 100, 110, 120, 128, 140, 160];

  /** The tempo check as a function of the analyzer, so it can be run on a broken one. Returns the failures. */
  function tempoFailures(analyze: (x: Float32Array) => { bpm: number }): string[] {
    const bad: string[] = [];
    for (const bpm of tempos) {
      const { x } = drums({ bpm, seconds: 32, seed: bpm });
      const got = analyze(x).bpm;
      if (Math.abs(got - bpm) / bpm > 0.015) bad.push(`${bpm} bpm read as ${got.toFixed(1)}`);
    }
    return bad;
  }

  it("reads the tempo to within 1.5 % at every tempo from 75 to 160", () => {
    expect(tempoFailures((x) => analyzeSong(x, SR))).toEqual([]);
  });

  it("fails the same check on an analyzer that always says 120 (so the check can fail)", () => {
    expect(tempoFailures(() => ({ bpm: 120 })).length).toBeGreaterThan(4);
  });

  it("puts beats within 30 ms of the true ones, for nearly every beat", () => {
    for (const bpm of [80, 105, 128, 150]) {
      const { x, truth } = drums({ bpm, seconds: 36, seed: 7 + bpm });
      const a = analyzeSong(x, SR);
      expect(matched(a, truth, 30), `${bpm} bpm`).toBeGreaterThan(0.93);
    }
  });

  it("finds the downbeat: the kick that is harder than the others is the 1", () => {
    const check = (downbeat: (a: Analysis) => number) => {
      const bad: string[] = [];
      for (const [bpm, offset, startPos] of [[100, 0.31, 0], [100, 0.62, 2], [128, 0.2, 1], [90, 0.5, 3], [110, 0.05, 2]] as const) {
        const { x, truth } = drums({ bpm, seconds: 40, offset, startPos, seed: Math.round(bpm + offset * 100) });
        const a = analyzeSong(x, SR);
        const first = a.beats[downbeat(a)]!;
        const near = truth.reduce((best, tr) => (Math.abs(tr.t - first) < Math.abs(best.t - first) ? tr : best), truth[0]!);
        if (near.pos !== 0 || Math.abs(near.t - first) > 0.04) bad.push(`${bpm} bpm offset ${offset} starting at position ${startPos}: first downbeat at ${first.toFixed(2)} s is position ${near.pos}`);
      }
      return bad;
    };
    expect(check((a) => a.downbeat)).toEqual([]);
    expect(check(() => 0).length).toBeGreaterThan(0); // always calling the first beat the 1 gets some wrong
  });

  it("follows a tempo that wanders by 3 %, and a human wobble of 12 ms", () => {
    const wander = drums({ bpm: 110, seconds: 48, driftPct: 3, seed: 21 });
    expect(matched(analyzeSong(wander.x, SR, { tightness: 40 }), wander.truth, 50)).toBeGreaterThan(0.85);
    const wobble = drums({ bpm: 110, seconds: 40, jitterMs: 12, seed: 22 });
    expect(matched(analyzeSong(wobble.x, SR), wobble.truth, 45)).toBeGreaterThan(0.9);
  });

  it("measures how steady the beats are: a quantised track fits one grid, a wandering one does not", () => {
    const steady = analyzeSong(drums({ bpm: 120, seconds: 40, seed: 31 }).x, SR);
    expect(steady.grid.rmsMs).toBeLessThan(15);
    expect(steady.grid.bpm).toBeCloseTo(120, 0);
    const loose = analyzeSong(drums({ bpm: 110, seconds: 48, driftPct: 6, seed: 32 }).x, SR, { tightness: 30 });
    expect(loose.grid.rmsMs).toBeGreaterThan(steady.grid.rmsMs * 2);
  });
});

describe("the asked-for tempo only breaks octave ties", () => {
  it("never invents a tempo: whatever was asked, the answer is the audio's tempo or its half or double", () => {
    const { x } = drums({ bpm: 128, seconds: 32, seed: 61 });
    for (const hint of [60, 90, 128, 170]) {
      const bpm = analyzeSong(x, SR, { hintBpm: hint }).bpm;
      const near = [64, 128, 256].some((t) => Math.abs(bpm - t) / t < 0.03);
      expect(near, `asked ${hint}, read ${bpm.toFixed(1)}`).toBe(true);
    }
    expect(analyzeSong(x, SR, { hintBpm: 128 }).bpm).toBeGreaterThan(125);
    expect(analyzeSong(x, SR).bpm).toBeGreaterThan(125);
  });

  it("settles half time against double time toward what was asked", () => {
    const { x } = drums({ bpm: 80, seconds: 36, seed: 62 });
    const slow = analyzeSong(x, SR, { hintBpm: 80 });
    expect(slow.bpm).toBeGreaterThan(77);
    expect(slow.bpm).toBeLessThan(83);
  });
});

describe("the pieces", () => {
  it("fitGrid: exact beats fit exactly, one displaced beat shows, and a single beat is not a grid", () => {
    const exact = Array.from({ length: 40 }, (_, i) => 1 + i * 0.5);
    const g = fitGrid(exact);
    expect(g.rmsMs).toBeLessThan(1e-6);
    expect(g.bpm).toBeCloseTo(120, 9);
    expect(g.t0).toBeCloseTo(1, 9);
    const bent = [...exact];
    bent[20] = bent[20]! + 0.06;
    expect(fitGrid(bent).maxMs).toBeGreaterThan(50);
    expect(fitGrid([1]).rmsMs).toBe(Infinity);
  });

  it("estimateTempo prefers a dancing pace but reports the other octave when it is as good", () => {
    const { x } = drums({ bpm: 100, seconds: 30, seed: 41 });
    const t = estimateTempo(onsetEnvelope(x, SR).env, SR / 256);
    expect(t.bpm).toBeGreaterThan(97);
    expect(t.bpm).toBeLessThan(103);
    expect(t.candidates.length).toBeGreaterThan(0);
    expect(t.strength).toBeGreaterThan(1);
  });

  it("trackBeats keeps to the tempo it is given: beats are one period apart, within a tenth", () => {
    const { x } = drums({ bpm: 120, seconds: 30, seed: 42 });
    const o = onsetEnvelope(x, SR);
    const frames = trackBeats(o.env, o.fps, 120);
    expect(frames.length).toBeGreaterThan(40);
    const P = o.fps * 0.5;
    for (let i = 1; i < frames.length; i++) expect(Math.abs((frames[i]! - frames[i - 1]!) / P - 1)).toBeLessThan(0.1);
  });

  it("findDownbeat picks the phase the kick is hardest on, and says how sure it is", () => {
    const low = new Float64Array(400);
    const beats = Array.from({ length: 32 }, (_, i) => 10 + i * 10);
    beats.forEach((f, i) => { low[f] = i % 4 === 2 ? 5 : 1; }); // the hard kick is on the third of the first four
    const d = findDownbeat(beats, low);
    expect(d.first).toBe(2);
    expect(d.margin).toBeGreaterThan(3);
  });

  it("an envelope of silence or of a very short clip does not break anything", () => {
    expect(onsetEnvelope(new Float32Array(100), SR).env.length).toBe(0);
    const quiet = analyzeSong(new Float32Array(SR * 5), SR);
    expect(Number.isFinite(quiet.bpm)).toBe(true);
  });
});

describe("choosing the excerpt", () => {
  const a = analyzeSong(drums({ bpm: 110, seconds: 100, seed: 51 }).x, SR);

  it("takes a whole number of bars, from a downbeat, away from the intro and the ending, about 64 s long", () => {
    const e = pickExcerpt(a, 100)!;
    expect(e).not.toBeNull();
    expect((e.startBeat - a.downbeat) % 4).toBe(0);
    expect(e.start).toBeGreaterThanOrEqual(8);
    expect(e.end).toBeLessThanOrEqual(80);
    expect(e.end - e.start).toBeGreaterThan(58);
    expect(e.end - e.start).toBeLessThan(70);
    expect(a.beats[e.startBeat + e.bars * 4]).toBe(e.end);
  });

  it("returns nothing for a song too short to have an excerpt, and honours the margins it is given", () => {
    const short = analyzeSong(drums({ bpm: 110, seconds: 30, seed: 52 }).x, SR);
    expect(pickExcerpt(short, 30)).toBeNull();
    const e = pickExcerpt(a, 100, { targetSeconds: 30, skipStart: 40, skipEnd: 5 })!;
    expect(e.start).toBeGreaterThanOrEqual(40);
    expect(e.end).toBeLessThanOrEqual(95);
  });
});
