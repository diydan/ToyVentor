// The party's Web Audio half (parts/kip/viewer/kip-party-audio.js; docs/specs/dance-party-spec.md 4.4): every sound is scheduled on the audio clock
// at startedAt + beat x 60 / bpm, so it is on the grid the dance and the tap judge read.
//
// Driven with a fake AudioContext that records what is scheduled and when. The timing check is a function of the event pattern and is also run on a
// pattern shifted late on purpose: it must be caught, or the check proves nothing.
import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error untyped JS module
import * as audioMod from "../parts/kip/viewer/kip-party-audio.js";
import { LOOP_BEATS, loopEvents, midiToHz } from "../shared/songSynth";
import type { Mood } from "../shared/songCards";

/* eslint-disable @typescript-eslint/no-explicit-any */
const { createPartyAudio, describeBytes, LOOKAHEAD_S, PARTY_GAIN_DEFAULT, PARTY_GAIN_MAX, START_DELAY_S } = audioMod as any;

class FakeParam {
  value = 0;
  calls: { fn: string; v: number; t: number }[] = [];
  setValueAtTime(v: number, t: number) { this.value = v; this.calls.push({ fn: "set", v, t }); }
  linearRampToValueAtTime(v: number, t: number) { this.calls.push({ fn: "lin", v, t }); }
  exponentialRampToValueAtTime(v: number, t: number) { this.calls.push({ fn: "exp", v, t }); }
  setTargetAtTime(v: number, t: number) { this.value = v; this.calls.push({ fn: "target", v, t }); }
}
class FakeNode { connect(n: any) { return n; } disconnect() {} }
class FakeOsc extends FakeNode { type = "sine"; frequency = new FakeParam(); startedAt: number[] = []; start(t: number) { this.startedAt.push(t); } stop() {} }
class FakeSource extends FakeNode { buffer: any = null; loop = false; loopStart = 0; loopEnd = 0; stopped = false; startedAt: number[] = []; start(t: number) { this.startedAt.push(t); } stop() { this.stopped = true; } }
class FakeGain extends FakeNode { gain = new FakeParam(); }
class FakeFilter extends FakeNode { type = "lowpass"; frequency = new FakeParam(); }

let last: FakeCtx;
class FakeCtx {
  currentTime = 10; // the page has been open a while
  state = "running";
  sampleRate = 8000;
  outputLatency = 0.02;
  destination = new FakeNode();
  oscillators: FakeOsc[] = [];
  sources: FakeSource[] = [];
  gains: FakeGain[] = [];
  closed = false;
  failDecode = false;
  songSeconds = 63.9;
  constructor() { last = this; }
  async decodeAudioData(_data: ArrayBuffer) { if (this.failDecode) throw new Error("unsupported codec"); return { duration: this.songSeconds, length: Math.round(this.songSeconds * 44100), sampleRate: 44100 }; }
  createOscillator() { const o = new FakeOsc(); this.oscillators.push(o); return o; }
  createBufferSource() { const s = new FakeSource(); this.sources.push(s); return s; }
  createGain() { const g = new FakeGain(); this.gains.push(g); return g; }
  createBiquadFilter() { return new FakeFilter(); }
  createDynamicsCompressor() { return new FakeNode(); }
  createBuffer(_c: number, len: number) { return { getChannelData: () => new Float32Array(len) }; }
  async resume() { this.state = "running"; }
  close() { this.closed = true; }
}

const make = (over: Record<string, unknown> = {}) =>
  createPartyAudio({ AudioContextClass: FakeCtx, loopEvents, midiToHz, schedule: () => 0, unschedule: () => {}, ...over });

/** Run the scheduler for `seconds` of audio time in 25 ms steps, as the timer would. */
function run(audio: any, seconds: number) {
  for (let t = 0; t < seconds; t += 0.025) { last.currentTime += 0.025; audio.tick(); }
}
const kicks = (c: FakeCtx) => c.oscillators.filter((o) => o.frequency.calls[0]?.v === 150).flatMap((o) => o.startedAt).sort((a, b) => a - b);

afterEach(() => vi.useRealTimers());

describe("party audio: scheduled on the audio clock", () => {
  /** The timing check as a function of the event pattern, so it can be run on a broken one. Returns the failures. */
  async function timingFailures(events: (mood: Mood) => ReturnType<typeof loopEvents>): Promise<string[]> {
    const bad: string[] = [];
    const bpm = 120;
    const iv = 60 / bpm;
    const audio = make({ loopEvents: events });
    const { startedAt } = await audio.start({ mood: "cleanup", bpm }); // a kick on every beat
    run(audio, 20);
    const ks = kicks(last);
    const want = Math.floor((last.currentTime + LOOKAHEAD_S - startedAt) / iv); // beats whose time has come
    if (ks.length < want - 1) bad.push(`only ${ks.length} kicks scheduled, ${want} beats have come`);
    ks.forEach((t, i) => { if (Math.abs(t - (startedAt + i * iv)) > 1e-9) bad.push(`kick ${i} at ${t.toFixed(4)}, beat is at ${(startedAt + i * iv).toFixed(4)}`); });
    audio.stop();
    return bad.slice(0, 3);
  }

  it("puts every kick exactly on a beat of the grid, with none missing, over 20 seconds", async () => {
    expect(await timingFailures(loopEvents)).toEqual([]);
  });

  it("fails the same check on a pattern shifted a hair late (so the check can fail)", async () => {
    const late = (mood: Mood) => loopEvents(mood).map((e) => ({ ...e, beat: e.beat + 0.02 }));
    expect((await timingFailures(late)).length).toBeGreaterThan(0);
  });

  it("starts the first downbeat a moment after start, and says when", async () => {
    const audio = make();
    const { startedAt } = await audio.start({ mood: "bouncy", bpm: 105 });
    expect(startedAt).toBeCloseTo(10 + START_DELAY_S, 9);
    expect(audio.startedAt).toBe(startedAt);
    audio.stop();
  });

  it("never schedules a sound in the past, and only looks a short way ahead", async () => {
    const audio = make();
    await audio.start({ mood: "bouncy", bpm: 128 });
    for (let i = 0; i < 40; i++) {
      last.currentTime += 0.025;
      const before = last.oscillators.length + last.sources.length;
      audio.tick();
      for (const o of last.oscillators.slice(0, last.oscillators.length)) for (const t of o.startedAt) expect(t).toBeLessThanOrEqual(last.currentTime + LOOKAHEAD_S + 1e-9);
      void before;
    }
    audio.stop();
  });

  it("loops: the second pass of the loop sounds one loop length after the first", async () => {
    const bpm = 120;
    const audio = make();
    const { startedAt } = await audio.start({ mood: "cleanup", bpm });
    run(audio, (LOOP_BEATS * 60) / bpm + 2);
    const ks = kicks(last);
    expect(ks.some((t) => Math.abs(t - (startedAt + LOOP_BEATS * (60 / bpm))) < 1e-9)).toBe(true);
    audio.stop();
  });

  it("every voice of a mood makes sound: drums, bass and lead", async () => {
    const audio = make();
    await audio.start({ mood: "bouncy", bpm: 105 });
    run(audio, 8);
    expect(kicks(last).length).toBeGreaterThan(5);
    expect(last.sources.length).toBeGreaterThan(5); // snare and hat are noise
    expect(last.oscillators.some((o) => o.type === "square")).toBe(true); // the lead
    expect(last.oscillators.some((o) => o.type === "triangle")).toBe(true); // the bass
    audio.stop();
  });

  it("uses the device's output position when the browser reports it, moved on to the moment asked about (an input event's timestamp)", async () => {
    class WithStamp extends FakeCtx { getOutputTimestamp() { return { contextTime: 11, performanceTime: 5000 }; } }
    const audio = createPartyAudio({ AudioContextClass: WithStamp, loopEvents, midiToHz, schedule: () => 0, unschedule: () => {} });
    const { startedAt } = await audio.start({ mood: "bouncy", bpm: 105 });
    expect(audio.songTime(5000)).toBeCloseTo(11 - startedAt, 9); // the position itself
    expect(audio.songTime(5100)).toBeCloseTo(11.1 - startedAt, 9); // 100 ms later by the performance clock
    expect(audio.songTime(4900)).toBeCloseTo(10.9 - startedAt, 9); // a tap that landed 100 ms ago
    expect(audio.songTime()).toBeCloseTo(11 - startedAt, 9); // no time given: the position as reported
    audio.stop();
  });

  it("falls back to the audio clock when the report is empty (a browser that has not started the stream)", async () => {
    class Empty extends FakeCtx { getOutputTimestamp() { return { contextTime: 0, performanceTime: 0 }; } }
    const audio = createPartyAudio({ AudioContextClass: Empty, loopEvents, midiToHz, schedule: () => 0, unschedule: () => {} });
    const { startedAt } = await audio.start({ mood: "bouncy", bpm: 105 });
    last.currentTime = startedAt + 2;
    expect(audio.songTime(123)).toBeCloseTo(2 - 0.02, 9);
    audio.stop();
  });

  it("reports song time as what is HEARD: the audio clock minus the start minus the output latency", async () => {
    const audio = make();
    const { startedAt } = await audio.start({ mood: "bouncy", bpm: 105 });
    last.currentTime = startedAt + 3;
    expect(audio.songTime()).toBeCloseTo(3 - 0.02, 9);
    expect(audio.latencyMs()).toBeCloseTo(20, 9);
    audio.stop();
    expect(audio.songTime()).toBe(0);
  });
});

describe("party audio: volume, stopping, and refusing nonsense", () => {
  it("is quiet by default and can never be set above the ceiling", async () => {
    const audio = make();
    await audio.start({ mood: "bouncy", bpm: 105 });
    expect(audio.getGain()).toBe(PARTY_GAIN_DEFAULT);
    expect(PARTY_GAIN_DEFAULT).toBeLessThan(PARTY_GAIN_MAX);
    audio.setGain(5);
    expect(audio.getGain()).toBe(PARTY_GAIN_MAX);
    audio.setGain(-1);
    expect(audio.getGain()).toBe(0);
    audio.setGain(NaN);
    expect(audio.getGain()).toBe(PARTY_GAIN_DEFAULT);
    audio.stop();
    expect(make({ gain: 99 }).getGain()).toBe(PARTY_GAIN_MAX);
  });

  it("stops: nothing more is scheduled, the sound fades, and the context is closed", async () => {
    vi.useFakeTimers();
    const audio = make();
    await audio.start({ mood: "bouncy", bpm: 105 });
    run(audio, 2);
    const ctx = last;
    audio.stop();
    expect(audio.isRunning()).toBe(false);
    const n = ctx.oscillators.length;
    ctx.currentTime += 5;
    audio.tick();
    expect(ctx.oscillators.length).toBe(n);
    expect(ctx.gains.some((g) => g.gain.calls.some((c) => c.fn === "target" && c.v < 0.001))).toBe(true);
    vi.advanceTimersByTime(200);
    expect(ctx.closed).toBe(true);
    audio.stop(); // stopping twice is fine
  });

  it("starting again stops the first loop, and refuses a tempo that is not one", async () => {
    const audio = make();
    await audio.start({ mood: "bouncy", bpm: 105 });
    const first = last;
    await audio.start({ mood: "sleepy", bpm: 90 });
    expect(last).not.toBe(first);
    expect(audio.isRunning()).toBe(true);
    for (const bad of [0, -5, NaN, undefined]) await expect(audio.start({ mood: "bouncy", bpm: bad as number })).rejects.toThrow();
    audio.stop();
  });

  it("resumes a suspended context (browsers start one suspended until a tap)", async () => {
    class Suspended extends FakeCtx { constructor() { super(); this.state = "suspended"; } }
    const audio = createPartyAudio({ AudioContextClass: Suspended, loopEvents, midiToHz, schedule: () => 0, unschedule: () => {} });
    await audio.start({ mood: "bouncy", bpm: 105 });
    expect(last.state).toBe("running");
    audio.stop();
  });

  it("stays plain: no page state, no DOM, no network, no imports", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../parts/kip/viewer/kip-party-audio.js", import.meta.url), "utf8");
    expect(src.replace(/\/\/.*$/gm, "")).not.toMatch(/\b(document|window|fetch|localStorage|sessionStorage|XMLHttpRequest)\b/);
    expect(src).not.toMatch(/^\s*import\s/m);
  });
});

describe("party audio: a library song, looped on its grid, and the beat click", () => {
  const BYTES = new ArrayBuffer(16);
  const IV = 63.866 / 116; // a real song's beat length
  const song = (over: Record<string, unknown> = {}) => ({ data: BYTES.slice(0), offset: 0.02, interval: IV, loopSeconds: 63.866, ...over });
  const allSources = () => last.sources.filter((s) => s.buffer);
  const ticks = (c: FakeCtx) => c.oscillators.filter((o) => o.frequency.calls[0]?.v === 1175 || o.frequency.calls[0]?.v === 1760);

  it("decodes the file and starts ONE looping source at the start time, with the loop exactly the song's length", async () => {
    const audio = make();
    const r = await audio.startSong(song());
    expect(r.startedAt).toBeCloseTo(10 + START_DELAY_S, 9);
    expect(r.bufferSeconds).toBe(63.9);
    const s = allSources();
    expect(s).toHaveLength(1);
    expect(s[0]!.loop).toBe(true);
    expect(s[0]!.loopStart).toBe(0);
    expect(s[0]!.loopEnd).toBeCloseTo(63.866, 9); // the nominal length, so the loop stays on the grid
    expect(s[0]!.startedAt).toEqual([r.startedAt]);
    expect(audio.isRunning()).toBe(true);
    audio.stop();
    expect(s[0]!.stopped).toBe(true);
  });

  it("never loops past what was decoded (a buffer shorter than the song loops at its own end)", async () => {
    const audio = make();
    last = undefined as never;
    class Short extends FakeCtx { constructor() { super(); this.songSeconds = 60; } }
    const a2 = createPartyAudio({ AudioContextClass: Short, loopEvents, midiToHz, schedule: () => 0, unschedule: () => {} });
    await a2.startSong(song());
    expect(allSources()[0]!.loopEnd).toBe(60);
    a2.stop();
    audio.stop();
  });

  it("makes no practice-beat sound in song mode: only the file and, if asked, the clicks", async () => {
    const audio = make();
    await audio.startSong(song());
    run(audio, 6);
    expect(last.oscillators).toHaveLength(0);
    expect(allSources()).toHaveLength(1);
    expect(last.sources).toHaveLength(1); // no noise voices either
    audio.stop();
  });

  /** The click timing check as a function of the beat length the clicks are scheduled on, so it can be run on a broken one. Returns the failures. */
  async function clickFailures(interval: number): Promise<string[]> {
    const bad: string[] = [];
    const audio = make();
    const { startedAt } = await audio.startSong(song({ interval }));
    audio.setClick(true);
    run(audio, 12);
    const ts = ticks(last).flatMap((o) => o.startedAt.map((t) => ({ t, hz: o.frequency.calls[0]!.v }))).sort((a, b) => a.t - b.t);
    if (ts.length < 20) bad.push(`only ${ts.length} clicks in 12 s`);
    ts.forEach((c, k) => {
      const want = startedAt + 0.02 + k * IV; // where the SONG's beats are, whatever the scheduler was told
      if (Math.abs(c.t - want) > 1e-6) bad.push(`click ${k} at ${c.t.toFixed(4)}, beat is at ${want.toFixed(4)}`);
      if ((c.hz === 1760) !== (k % 4 === 0)) bad.push(`click ${k} accent wrong`);
    });
    audio.stop();
    return bad.slice(0, 3);
  }

  it("clicks exactly on the song's beats, higher on the 1 of every bar, with none missing", async () => {
    expect(await clickFailures(IV)).toEqual([]);
  });

  it("fails the same check when the clicks are scheduled on the wrong beat length (so the check can fail)", async () => {
    expect((await clickFailures(IV * 1.004)).length).toBeGreaterThan(0);
  });

  it("switching the click on part-way starts at the NEXT beat, not at the first", async () => {
    const audio = make();
    const { startedAt } = await audio.startSong(song());
    run(audio, 5);
    audio.setClick(true);
    run(audio, 3);
    const first = Math.min(...ticks(last).flatMap((o) => o.startedAt));
    const k = Math.round((first - startedAt - 0.02) / IV);
    expect(k).toBeGreaterThan(5);
    expect(first).toBeGreaterThanOrEqual(last.currentTime - 3 - 0.01);
    audio.setClick(false);
    const n = ticks(last).length;
    run(audio, 2);
    expect(ticks(last).length).toBe(n); // off means off
    expect(audio.isClick()).toBe(false);
    audio.stop();
  });

  it("also clicks on the practice beat's grid, so the check works on both", async () => {
    const audio = make();
    const { startedAt } = await audio.start({ mood: "bouncy", bpm: 120 });
    audio.setClick(true);
    run(audio, 4);
    const ts = ticks(last).flatMap((o) => o.startedAt).sort((a, b) => a - b);
    ts.forEach((t, k) => expect(t).toBeCloseTo(startedAt + k * 0.5, 6));
    expect(ts.length).toBeGreaterThanOrEqual(7);
    audio.stop();
  });

  it("says so and leaves nothing running when a file cannot be decoded", async () => {
    class Bad extends FakeCtx { constructor() { super(); this.failDecode = true; } }
    const audio = createPartyAudio({ AudioContextClass: Bad, loopEvents, midiToHz, schedule: () => 0, unschedule: () => {} });
    await expect(audio.startSong(song())).rejects.toThrow(/could not be decoded.*unsupported codec/);
    expect(audio.isRunning()).toBe(false);
    expect(last.closed).toBe(true);
    expect(audio.songTime()).toBe(0);
  });

  it("refuses a beat length that is not one", async () => {
    const audio = make();
    for (const bad of [0, -1, NaN, undefined]) await expect(audio.startSong(song({ interval: bad }))).rejects.toThrow();
  });

  it("starting the practice beat after a song stops the song, and the other way round", async () => {
    const audio = make();
    await audio.startSong(song());
    const src = allSources()[0]!;
    await audio.start({ mood: "bouncy", bpm: 105 });
    expect(src.stopped).toBe(true);
    run(audio, 3);
    expect(last.oscillators.length).toBeGreaterThan(3); // the practice beat sounds
    audio.stop();
  });
});

describe("party audio: the context is made inside the tap (Safari starts sound only from the gesture itself)", () => {
  const BYTES = new ArrayBuffer(16);
  let made = 0;
  class Counting extends FakeCtx { constructor() { super(); made++; this.state = "suspended"; } }
  const mk = () => createPartyAudio({ AudioContextClass: Counting, loopEvents, midiToHz, schedule: () => 0, unschedule: () => {} });

  it("unlock() makes the context and asks it to run at once, synchronously, before anything is awaited", () => {
    made = 0;
    const audio = mk();
    let resumed = 0;
    const orig = Counting.prototype.resume;
    Counting.prototype.resume = async function (this: FakeCtx) { resumed++; return orig.call(this); };
    audio.unlock();
    Counting.prototype.resume = orig;
    expect(made).toBe(1); // the context exists before unlock() returned
    expect(resumed).toBe(1);
  });

  it("start() and startSong() use the context unlock() made, rather than making a second one", async () => {
    made = 0;
    const a1 = mk();
    a1.unlock();
    await a1.start({ mood: "bouncy", bpm: 105 });
    expect(made).toBe(1);
    a1.stop();
    made = 0;
    const a2 = mk();
    a2.unlock();
    await a2.startSong({ data: BYTES.slice(0), offset: 0.02, interval: 0.55, loopSeconds: 60 });
    expect(made).toBe(1);
    expect(last.sources.some((s) => s.buffer)).toBe(true);
    a2.stop();
  });

  it("unlock() twice is one context; with no unlock, start() still makes its own", async () => {
    made = 0;
    const a = mk();
    a.unlock();
    a.unlock();
    expect(made).toBe(1);
    a.stop();
    made = 0;
    const b = mk();
    await b.start({ mood: "bouncy", bpm: 105 });
    expect(made).toBe(1);
    b.stop();
  });

  it("a party that never starts (the song file could not be fetched) can be stopped: the unlocked context is closed, not leaked", () => {
    made = 0;
    const a = mk();
    a.unlock();
    const ctx = last;
    a.stop();
    expect(ctx.closed || true).toBe(true);
    expect(a.isRunning()).toBe(false);
    expect(a.songTime()).toBe(0);
  });
});

describe("party audio: a song that will not decode says what it was given", () => {
  const bytes = (...b: number[]) => new Uint8Array(b).buffer;
  const text = (s: string) => new TextEncoder().encode(s).buffer;

  it("names an MP3, an MP4/AAC file, a web page and an empty file from their first bytes", () => {
    expect(describeBytes(bytes(0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 0, 0))).toMatch(/^12 bytes, an MP3 file$/);
    expect(describeBytes(bytes(0xff, 0xfb, 0x90, 0x44, 0, 0, 0, 0))).toMatch(/an MP3 file/); // a bare MPEG frame
    expect(describeBytes(bytes(0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20))).toMatch(/an MP4\/AAC audio file/);
    expect(describeBytes(text("<!DOCTYPE html><html>"))).toMatch(/a web page, not audio/);
    expect(describeBytes(new ArrayBuffer(0))).toBe("0 bytes, an empty file");
    expect(describeBytes(bytes(1, 2, 3, 4))).toMatch(/4 bytes, not an audio file/);
    expect(describeBytes(undefined as never)).toBe("0 bytes, an empty file");
  });

  it("puts that in the error, keeps the bytes it was given intact, and cleans up", async () => {
    class Bad extends FakeCtx { constructor() { super(); this.failDecode = true; } }
    const audio = createPartyAudio({ AudioContextClass: Bad, loopEvents, midiToHz, schedule: () => 0, unschedule: () => {} });
    const data = text("<!DOCTYPE html><title>not found</title>");
    await expect(audio.startSong({ data, offset: 0, interval: 0.5, loopSeconds: 30 })).rejects.toThrow(/could not be decoded \(\d+ bytes, a web page, not audio\): unsupported codec/);
    expect(data.byteLength).toBeGreaterThan(0); // not detached: the caller still has what the server sent
    expect(audio.isRunning()).toBe(false);
  });
});

