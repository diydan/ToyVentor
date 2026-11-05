// The toy guitar's sound (runtime/guitarSound.ts): the Karplus-Strong string measured as numbers (its pitch, its ring, its mellowing), and the playing of it through a recording fake of the Web Audio
// graph (mute, the audio waking only after a tap, one buffer per pitch, a cap on voices). Nothing here can be heard: the pure part is checked against what a plucked string must do.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ksPluck, seeded, t60For } from "../src/features/game/world/runtime/guitarSound";
import { chordFreqs, makeStroke } from "../src/features/game/world/runtime/guitarPlay";

const SR = 48000;

/** The fundamental by autocorrelation (the first strong peak), parabolically refined, from `from` seconds in. */
function f0(x: Float32Array, sr: number, from = 0.05, n = 8192): number {
  const s = Math.round(from * sr), lo = Math.round(sr / 700), hi = Math.round(sr / 60), ac: number[] = [];
  for (let lag = lo; lag <= hi; lag++) { let c = 0; for (let i = 0; i < n; i++) c += x[s + i]! * x[s + i + lag]!; ac[lag] = c; }
  let mx = -Infinity;
  for (let lag = lo; lag <= hi; lag++) mx = Math.max(mx, ac[lag]!);
  for (let lag = lo + 1; lag < hi; lag++) {
    if (ac[lag]! > ac[lag - 1]! && ac[lag]! >= ac[lag + 1]! && ac[lag]! > 0.6 * mx) {
      const a = ac[lag - 1]!, b = ac[lag]!, c = ac[lag + 1]!;
      return sr / (lag + (0.5 * (a - c)) / (a - 2 * b + c));
    }
  }
  return 0;
}
const rms = (x: Float32Array, sr: number, a: number, b: number) => { let s = 0; const i0 = Math.round(a * sr), i1 = Math.round(b * sr); for (let i = i0; i < i1; i++) s += x[i]! * x[i]!; return Math.sqrt(s / (i1 - i0)); };
/** First-difference energy over energy: a cheap measure of how much high end there is. */
const brightness = (x: Float32Array, sr: number, a: number, b: number) => { let e = 0, d = 0; for (let i = Math.round(a * sr); i < Math.round(b * sr); i++) { e += x[i]! * x[i]!; const q = x[i]! - x[i - 1]!; d += q * q; } return Math.sqrt(d / e); };

describe("the plucked string", () => {
  const NOTES = [82.41, 110, 164.81, 196, 261.63, 329.63, 392, 523.25];
  it("rings at the pitch asked for, within 0.3 %, at both common sample rates (all the strings of all four chords)", () => {
    for (const sr of [44100, 48000]) for (const f of NOTES) {
      const x = ksPluck(f, sr);
      const m = f0(x, sr);
      expect(Math.abs(m / f - 1), `${f} Hz at ${sr}`).toBeLessThan(0.003);
    }
    for (const f of ["C", "G", "Am", "F"].flatMap((c) => chordFreqs(c as "C"))) {
      expect(Math.abs(f0(ksPluck(f, SR), SR) / f - 1), `${f.toFixed(1)} Hz`).toBeLessThan(0.003);
    }
  });
  it("starts at full scale, never clips, is silent at its last sample and has no stray values", () => {
    for (const f of NOTES) {
      const x = ksPluck(f, SR);
      let peak = 0;
      for (const v of x) { expect(Number.isFinite(v)).toBe(true); peak = Math.max(peak, Math.abs(v)); }
      expect(peak, `${f}`).toBeLessThanOrEqual(1 + 1e-6);
      expect(peak, `${f}`).toBeGreaterThan(0.5);
      expect(Math.abs(x[x.length - 1]!)).toBe(0);
    }
    expect(ksPluck(220, SR)).toHaveLength(Math.round(1.5 * SR));
    expect(ksPluck(220, SR, { seconds: 0.5 })).toHaveLength(SR / 2);
  });
  it("rings out and dies: every note is at least 18 dB down after half a second and silent enough by a second; the low strings sing longer than the high ones", () => {
    const db = (x: Float32Array, t: number) => 20 * Math.log10(rms(x, SR, t, t + 0.1) / rms(x, SR, 0, 0.1));
    const ring: number[] = [];
    for (const f of [82.41, 196, 329.63, 523.25]) {
      const x = ksPluck(f, SR);
      expect(db(x, 0.5), `${f} at 0.5 s`).toBeLessThan(-12);
      expect(db(x, 1.0), `${f} at 1 s`).toBeLessThan(-20);
      expect(db(x, 0.2), `${f} at 0.2 s`).toBeLessThan(0);
      ring.push(db(x, 0.5));
    }
    expect(ring[0]!).toBeGreaterThan(ring[3]!);                                       // low note falls less than the high one
    expect(t60For(82.41)).toBeGreaterThan(t60For(523.25));
    expect(t60For(1)).toBeLessThanOrEqual(3.4 * 1.1 + 1e-9);                          // the clamps
    expect(t60For(1e6)).toBeGreaterThanOrEqual(3.4 * 0.6 - 1e-9);
  });
  it("mellows as it rings (the high end dies first), which is what makes it a string and not a beep", () => {
    for (const f of [110, 196, 329.63]) {
      const x = ksPluck(f, SR);
      expect(brightness(x, SR, 0.5, 0.6), `${f}`).toBeLessThan(brightness(x, SR, 0.02, 0.1) * 0.7);
    }
  });
  it("is not a sine: it has real harmonics (a sine's first-difference ratio is 2 pi f / sr)", () => {
    const f = 196, x = ksPluck(f, SR);
    const sineRatio = (2 * Math.PI * f) / SR;
    expect(brightness(x, SR, 0.02, 0.1)).toBeGreaterThan(sineRatio * 3);
  });
  it("a harder pluck is brighter, and where the pick lands changes the sound", () => {
    const soft = ksPluck(196, SR, { bright: 0.1, rng: seeded(5) }), hard = ksPluck(196, SR, { bright: 0.95, rng: seeded(5) });
    expect(brightness(hard, SR, 0.01, 0.06)).toBeGreaterThan(brightness(soft, SR, 0.01, 0.06));
    const near = ksPluck(196, SR, { pos: 0.1, rng: seeded(5) }), mid = ksPluck(196, SR, { pos: 0.45, rng: seeded(5) });
    expect(near).not.toEqual(mid);
    expect(Math.abs(f0(near, SR) / 196 - 1)).toBeLessThan(0.003);                    // the pick's place never changes the pitch
  });
  it("is deterministic for a pitch (seeded noise) and different for different seeds", () => {
    expect(ksPluck(196, SR, { seconds: 0.3 })).toEqual(ksPluck(196, SR, { seconds: 0.3 }));
    expect(ksPluck(196, SR, { seconds: 0.3, rng: seeded(1) })).not.toEqual(ksPluck(196, SR, { seconds: 0.3, rng: seeded(2) }));
    const r = seeded(9);
    for (let i = 0; i < 1000; i++) { const v = r(); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });
  it("has no DC offset (a thump on every pluck would be heard)", () => {
    const x = ksPluck(110, SR, { seconds: 0.6 });
    let mean = 0;
    for (const v of x) mean += v;
    expect(Math.abs(mean / x.length)).toBeLessThan(0.02);
  });
  it("bad numbers give silence of the length asked, never NaN or a hang", () => {
    for (const [f, sr] of [[0, SR], [-5, SR], [Number.NaN, SR], [220, 0], [220, Number.NaN], [SR, SR]] as const) {
      const x = ksPluck(f, sr, { seconds: 0.1 });
      expect(x.every((v) => v === 0), `${f},${sr}`).toBe(true);
    }
  });
  it("is cheap: a whole chord's strings are made in a few milliseconds", () => {
    const t0 = performance.now();
    for (const f of chordFreqs("G")) ksPluck(f, SR);
    expect(performance.now() - t0).toBeLessThan(150);                                // (about 1 ms each on a laptop; very loose so a slow CI does not flake)
  });
});

/* ---------- through a recording fake of the audio graph ---------- */

/** A node that accepts any call, read or write. */
function node(): any {
  const f: any = new Proxy(function () {}, { get: (_t, p) => (p === "then" ? undefined : p === Symbol.toPrimitive ? () => 0 : f), apply: () => f, set: () => true });
  return f;
}
interface Started { when: number; rate: number; gain: number; buffer: { length: number } }
class FakeCtx {
  static last: FakeCtx | null = null;
  state = "running"; currentTime = 2; sampleRate = SR; destination = node();
  buffersMade = 0; sources: Array<{ onended: (() => void) | null }> = []; started: Started[] = []; gains: Array<{ gain: { value: number } }> = [];
  constructor() { FakeCtx.last = this; }
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
  createOscillator = () => node();
  createBiquadFilter = () => ({ type: "", frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, gain: { value: 0 }, Q: { value: 0 }, connect: () => {} });
  createConvolver = () => node();
  createBuffer = (_ch: number, length: number) => { this.buffersMade++; return { length, getChannelData: () => new Float32Array(length) }; };
  createGain = () => { const g = { gain: { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} }, connect: () => {}, disconnect: () => {} } as any; this.gains.push(g); return g; };
  createBufferSource = () => {
    const self = this;
    const s: any = { buffer: null as null | { length: number }, playbackRate: { value: 1 }, onended: null as null | (() => void), connect: () => {}, start(when: number) { self.started.push({ when, rate: s.playbackRate.value, gain: self.gains.at(-1)!.gain.value, buffer: s.buffer! }); } };
    this.sources.push(s);
    return s;
  };
}

async function freshGuitar() {
  vi.resetModules();
  const audio = await import("../src/features/game/world/runtime/audio");
  const guitar = await import("../src/features/game/world/runtime/guitarSound");
  return { audio, guitar };
}
beforeEach(() => { FakeCtx.last = null; vi.stubGlobal("window", { AudioContext: FakeCtx }); vi.stubGlobal("navigator", {}); });
afterEach(() => vi.unstubAllGlobals());

describe("playing the strings", () => {
  it("makes no sound and builds nothing before a tap has woken the audio", async () => {
    const { guitar } = await freshGuitar();
    guitar.pluck(196, 0, 1);
    guitar.playStroke(makeStroke(0, "C", "down"));
    expect(FakeCtx.last).toBeNull();
  });
  it("plucks a string: one buffer source started `delay` seconds from now, at the weight asked", async () => {
    const { audio, guitar } = await freshGuitar();
    audio.noteGesture();
    guitar.pluck(196, 0.025, 0.8);
    const c = FakeCtx.last!;
    expect(c.started).toHaveLength(1);
    expect(c.started[0]!.when).toBeCloseTo(2.025, 9);
    expect(c.started[0]!.gain).toBeCloseTo(guitar.PLUCK_GAIN * Math.pow(0.8, 1.4), 9);
    expect(c.started[0]!.buffer.length).toBe(Math.round(1.5 * SR));
    expect(Math.abs(c.started[0]!.rate - 1)).toBeLessThanOrEqual(0.004 + 1e-12);   // the pitch is nudged a hair each time
  });
  it("makes each pitch's samples once and reuses them", async () => {
    const { audio, guitar } = await freshGuitar();
    audio.noteGesture();
    const before = FakeCtx.last!.buffersMade;                                       // (the music bus's reverb takes a couple)
    for (let i = 0; i < 5; i++) guitar.pluck(196, 0, 1);
    guitar.pluck(220, 0, 1);
    expect(FakeCtx.last!.buffersMade - before).toBe(2);
    expect(FakeCtx.last!.started).toHaveLength(6);
  });
  it("a stroke is its strings in order (one source each, the delays as the stroke says) plus the thump of the body", async () => {
    const { audio, guitar } = await freshGuitar();
    audio.noteGesture();
    const s = makeStroke(0, "G", "down");
    guitar.playStroke(s);
    const c = FakeCtx.last!;
    const strings = () => c.started.filter((st) => st.buffer.length === Math.round(1.5 * SR));      // (the pick's whisper of noise is a source too, a short one)
    expect(strings()).toHaveLength(6);
    strings().forEach((st, i) => expect(st.when).toBeCloseTo(2 + s.notes[i]!.delay, 9));
    expect(c.started.length).toBe(7);                                                                 // six strings and the pick
    const up = makeStroke(1, "G", "up");
    guitar.playStroke(up);
    expect(strings()).toHaveLength(6 + 4);
  });
  it("is silent while the master mute is on, and comes back when it is off", async () => {
    const { audio, guitar } = await freshGuitar();
    audio.noteGesture();
    expect(audio.toggleSound()).toBe(false);                                        // muted
    guitar.pluck(196, 0, 1);
    guitar.playStroke(makeStroke(0, "C", "down"));
    expect(FakeCtx.last!.started).toHaveLength(0);
    expect(audio.toggleSound()).toBe(true);
    guitar.pluck(196, 0, 1);
    expect(FakeCtx.last!.started).toHaveLength(1);
  });
  it("never plays a note at zero weight or a nonsense pitch", async () => {
    const { audio, guitar } = await freshGuitar();
    audio.noteGesture();
    guitar.pluck(196, 0, 0);
    guitar.pluck(196, 0, -1);
    guitar.pluck(0, 0, 1);
    guitar.pluck(Number.NaN, 0, 1);
    expect(FakeCtx.last!.started).toHaveLength(0);
  });
  it("holds at most MAX_VOICES notes at once (a drumming child gets a flurry, not a hundred nodes) and takes a place back when a note ends", async () => {
    const { audio, guitar } = await freshGuitar();
    audio.noteGesture();
    for (let i = 0; i < guitar.MAX_VOICES + 20; i++) guitar.pluck(196, 0, 1);
    const c = FakeCtx.last!;
    expect(c.started).toHaveLength(guitar.MAX_VOICES);
    c.sources[0]!.onended!();
    guitar.pluck(196, 0, 1);
    expect(c.started).toHaveLength(guitar.MAX_VOICES + 1);
    guitar.pluck(196, 0, 1);
    expect(c.started).toHaveLength(guitar.MAX_VOICES + 1);
  });
  it("a note's loudness rises with its weight (a soft stroke is quieter than a hard one)", async () => {
    const { audio, guitar } = await freshGuitar();
    audio.noteGesture();
    guitar.pluck(196, 0, 0.3);
    guitar.pluck(196, 0, 1);
    const [soft, hard] = FakeCtx.last!.started;
    expect(soft!.gain).toBeLessThan(hard!.gain);
    expect(hard!.gain).toBeCloseTo(guitar.PLUCK_GAIN, 9);
  });
  it("priming the strings makes the notes in the background without playing anything", async () => {
    vi.useFakeTimers();
    try {
      const { audio, guitar } = await freshGuitar();
      audio.noteGesture();
      guitar.primeGuitar();
      guitar.primeGuitar();                                                         // safe twice
      await vi.runAllTimersAsync();
      expect(FakeCtx.last!.started).toHaveLength(0);
      const before = FakeCtx.last!.buffersMade;
      guitar.pluck(chordFreqs("C")[0]!, 0, 1);
      expect(FakeCtx.last!.buffersMade - before).toBe(1);                           // (only the AudioBuffer: the samples were already made)
    } finally { vi.useRealTimers(); }
  });
});
