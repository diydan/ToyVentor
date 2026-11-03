// The dance party's song clock (shared/songBeat.ts; docs/specs/dance-party-spec.md 3.3, 4.4, 5.1).
//
// The drift check and the tap-window check are functions of the implementation, and they are also run on versions broken on purpose
// (a clock that plays by seconds, a window that is too wide): each must be caught, or the check proves nothing.
import { describe, expect, it } from "vitest";
import {
  BEATS_PER_BAR,
  MAX_BEATS,
  TAP_WINDOW_MS,
  beatAt,
  beatPlayFor,
  beatPulse,
  clipTime,
  judgeTap,
  makeBeatMap,
  measureBpm,
  parseBeatMap,
  pickDance,
  scoreTaps,
  tempoRate,
  type BeatMap,
} from "../shared/songBeat";

/** A steady grid: `n` beats at `bpm`, the first at `start`. */
function steady(bpm: number, n: number, start = 0.5): number[] {
  return Array.from({ length: n }, (_, i) => start + (i * 60) / bpm);
}

/** A song whose tempo wanders by +-6 % on a 25 s cycle, as an AI song's does. Returns 60+ seconds of beats. */
function wandering(baseBpm: number, seconds = 62): number[] {
  const beats = [0.4];
  let t = 0.4;
  while (t < seconds) {
    const bpm = baseBpm * (1 + 0.06 * Math.sin((2 * Math.PI * t) / 25));
    t += 60 / bpm;
    beats.push(t);
  }
  return beats;
}

function mapOf(beats: number[]): BeatMap {
  const r = makeBeatMap(beats);
  if (!r.ok) throw new Error(`fixture is not a beat map: ${r.reason}`);
  return r.map;
}

describe("beat maps: tempo is measured, never trusted", () => {
  it("measures the tempo off the beats, whatever was asked for", () => {
    const m = mapOf(steady(100, 120));
    expect(m.bpm).toBeCloseTo(100, 6);
    expect(m.bars).toBe(30);
    expect(measureBpm([0, 0.5])).toBeCloseTo(120, 9);
    expect(measureBpm([1])).toBeNull();
    expect(measureBpm([])).toBeNull();
  });

  it("rejects what cannot be a beat grid", () => {
    const ok = steady(110, 32);
    expect(makeBeatMap(ok).ok).toBe(true);
    const reason = (x: unknown) => {
      const r = makeBeatMap(x);
      return r.ok ? "ok" : r.reason;
    };
    expect(reason(undefined)).toBe("bad_beats");
    expect(reason("1,2,3,4")).toBe("bad_beats");
    expect(reason([0, 0.5, 1])).toBe("too_few_beats");
    expect(reason(new Array(MAX_BEATS + 1).fill(0).map((_, i) => i * 0.5))).toBe("too_many_beats");
    expect(reason([0, 0.5, "1", 1.5, 2])).toBe("bad_beat_time");
    expect(reason([0, 0.5, NaN, 1.5, 2])).toBe("bad_beat_time");
    expect(reason([-0.1, 0.4, 0.9, 1.4, 1.9])).toBe("bad_beat_time");
    expect(reason([0, 0.5, 0.4, 1.5, 2])).toBe("not_ascending");
    expect(reason([0, 0.5, 0.5, 1.5, 2])).toBe("not_ascending");
    // a missed beat (one gap doubled) and an invented one (a gap halved) are not music
    const missed = ok.filter((_, i) => i !== 10);
    expect(reason(missed)).toBe("irregular");
    const invented = [...ok.slice(0, 10), ok[10]! - 0.27, ...ok.slice(10)];
    expect(reason(invented)).toBe("irregular");
    // too slow or too fast for a dance
    expect(reason(steady(30, 16))).toBe("bad_bpm");
    expect(reason(steady(300, 16))).toBe("bad_bpm");
  });

  it("accepts a song whose tempo wanders", () => {
    const m = mapOf(wandering(110));
    expect(m.bpm).toBeGreaterThan(100);
    expect(m.bpm).toBeLessThan(120);
  });

  it("checks a stored map: the bpm must be what the beats measure, the bars what they hold", () => {
    const beats = steady(104.6, 64);
    const good = { bpm: 105, beats, bars: 16 }; // rounded to a whole number: fine
    expect(parseBeatMap(good).ok).toBe(true);
    const reason = (x: unknown) => {
      const r = parseBeatMap(x);
      return r.ok ? "ok" : r.reason;
    };
    expect(reason({ ...good, bpm: 128 })).toBe("bpm_not_measured"); // the tempo that was ASKED FOR, not the one in the audio
    expect(reason({ ...good, bpm: "105" })).toBe("bad_bpm");
    expect(reason({ ...good, bpm: NaN })).toBe("bad_bpm");
    expect(reason({ ...good, bars: 15 })).toBe("bad_bars");
    expect(reason({ ...good, bars: undefined })).toBe("bad_bars");
    expect(reason(null)).toBe("not_object");
    expect(reason([])).toBe("not_object");
    expect(reason({ ...good, beats: [] })).toBe("too_few_beats");
  });

  it("copies the beats, so a caller's array cannot change a map", () => {
    const beats = steady(110, 16);
    const m = mapOf(beats);
    beats[3] = 99;
    expect(m.beats[3]).not.toBe(99);
  });
});

describe("where the song is", () => {
  const m = mapOf(steady(120, 40, 1)); // a beat every half second from t = 1 s

  it("places a time on its beat", () => {
    const on = beatAt(m, 1);
    expect(on).toMatchObject({ index: 0, bar: 0, beatInBar: 0 });
    expect(on.phase).toBeCloseTo(0, 9);
    const mid = beatAt(m, 1.25);
    expect(mid.index).toBe(0);
    expect(mid.phase).toBeCloseTo(0.5, 9);
    expect(mid.position).toBeCloseTo(0.5, 9);
    const b = beatAt(m, 1 + 0.5 * 6.2); // beat 6 and a fifth
    expect(b).toMatchObject({ index: 6, bar: 1, beatInBar: 2 });
    expect(b.phase).toBeCloseTo(0.2, 9);
  });

  it("is defined and continuous before the first beat and after the last", () => {
    const before = beatAt(m, 0.5); // one beat early
    expect(before.position).toBeCloseTo(-1, 9);
    expect(before).toMatchObject({ index: -1, bar: -1, beatInBar: 3 });
    const after = beatAt(m, 1 + 0.5 * 39 + 0.25);
    expect(after.position).toBeCloseTo(39.5, 9);
    // rising with time everywhere, never jumping
    let last = beatAt(m, 0).position;
    for (let t = 0.013; t < 25; t += 0.013) {
      const p = beatAt(m, t).position;
      expect(p).toBeGreaterThan(last);
      expect(p - last).toBeLessThan(0.05); // 13 ms at 120 bpm is 0.026 of a beat: no jump at either end or at any beat
      last = p;
    }
  });

  it("follows the song's own beats where the tempo moves", () => {
    const wm = mapOf(wandering(110));
    for (let k = 0; k < wm.beats.length; k++) expect(beatAt(wm, wm.beats[k]!).position).toBeCloseTo(k, 9);
  });
});

describe("the dance follows the song, not the stopwatch (gate: no drift over 60 s)", () => {
  const clip = { bpm: 120, beats: 16 }; // the procedural boogie: a 16-beat loop authored at 120 bpm

  /** The clip time of every beat of a 60 s song must be that beat's own place in the loop, for any clock. Returns the worst error, seconds. */
  function worstDrift(map: BeatMap, clock: (map: BeatMap, t: number) => number): number {
    let worst = 0;
    for (let k = 0; k < map.beats.length; k++) {
      if (map.beats[k]! > 60) break;
      const want = (k % clip.beats) * (60 / clip.bpm);
      const got = clock(map, map.beats[k]!);
      // compare on the loop, so 0 and one loop are the same point
      const loop = clip.beats * (60 / clip.bpm);
      const e = Math.abs(((got - want + loop / 2) % loop + loop) % loop - loop / 2);
      worst = Math.max(worst, e);
    }
    return worst;
  }

  const bySong = (map: BeatMap, t: number) => clipTime(map, t, clip);
  /** The easy clock: song time times a constant rate. Right for a metronome, wrong the moment the tempo moves. */
  const byStopwatch = (map: BeatMap, t: number) => {
    const rate = map.bpm / clip.bpm;
    const loop = clip.beats * (60 / clip.bpm);
    return (((t - map.beats[0]!) * rate) % loop + loop) % loop;
  };

  it("keeps every beat on the same point of the clip, for a steady song and a wandering one", () => {
    expect(worstDrift(mapOf(steady(110, 200)), bySong)).toBeLessThan(1e-9);
    expect(worstDrift(mapOf(wandering(110)), bySong)).toBeLessThan(1e-9);
    expect(worstDrift(mapOf(wandering(96)), bySong)).toBeLessThan(1e-9);
  });

  it("fails the same check when the clock is the stopwatch (so the check can fail)", () => {
    expect(worstDrift(mapOf(steady(110, 200)), byStopwatch)).toBeLessThan(1e-6); // a metronome is fine either way
    expect(worstDrift(mapOf(wandering(110)), byStopwatch)).toBeGreaterThan(0.08); // more than the 80 ms tap window off the beat
  });

  it("stays inside one loop and wraps", () => {
    const m = mapOf(steady(120, 100, 0));
    const loop = 16 * 0.5;
    for (let t = -3; t < 40; t += 0.37) {
      const c = clipTime(m, t, clip);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThan(loop);
    }
    expect(clipTime(m, 8, clip)).toBeCloseTo(0, 9); // 16 beats later: back at the start
  });

  it("plays a clip faster or slower to fit, by changing only how far a beat moves it", () => {
    const fast = mapOf(steady(132, 100, 0)); // 10 % faster than the clip's 120: one beat is still 0.5 s of clip
    expect(clipTime(fast, 60 / 132, clip)).toBeCloseTo(0.5, 9);
    expect(clipTime(fast, 3 * (60 / 132), clip)).toBeCloseTo(1.5, 9);
  });
});

describe("tempo: a dance is never more than a quarter off its natural speed", () => {
  it("gives the rate and whether it is in range, both ends included", () => {
    expect(tempoRate(120, 120)).toEqual({ rate: 1, inRange: true });
    expect(tempoRate(96, 120).inRange).toBe(true); // 0.8
    expect(tempoRate(150, 120).inRange).toBe(true); // 1.25
    expect(tempoRate(95.9, 120).inRange).toBe(false);
    expect(tempoRate(150.1, 120).inRange).toBe(false);
    expect(tempoRate(110, 120).rate).toBeCloseTo(0.9167, 4);
  });

  it("refuses numbers that are not tempos", () => {
    for (const bad of [0, -5, NaN, Infinity]) {
      expect(tempoRate(bad, 120).inRange).toBe(false);
      expect(tempoRate(120, bad).inRange).toBe(false);
    }
  });

  const clips = [
    { id: "dance_boogie", bpm: 120 },
    { id: "dance_disco", bpm: 120 },
    { id: "samba", bpm: 100 },
    { id: "slow_sway", bpm: 80 },
  ];

  it("picks the clip nearest its natural speed, the same one every time, and none when nothing fits", () => {
    expect(pickDance(100, clips)).toEqual({ id: "samba", rate: 1 });
    expect(pickDance(128, clips)?.id).toBe("dance_boogie"); // ties on rate go to the lower id
    expect(pickDance(128, clips)).toEqual(pickDance(128, clips));
    expect(pickDance(80, clips)?.id).toBe("slow_sway");
    expect(pickDance(200, clips)).toBeNull();
    expect(pickDance(40, clips)).toBeNull();
    expect(pickDance(110, [])).toBeNull();
  });

  it("never returns a clip outside the range, for any song tempo", () => {
    for (let bpm = 40; bpm <= 220; bpm += 1) {
      const p = pickDance(bpm, clips);
      if (p) {
        expect(p.rate).toBeGreaterThanOrEqual(0.8 - 1e-12);
        expect(p.rate).toBeLessThanOrEqual(1.25 + 1e-12);
      } else {
        for (const c of clips) expect(tempoRate(bpm, c.bpm).inRange).toBe(false);
      }
    }
  });

  it("steps down the fitting clips for a second Kip, and wraps", () => {
    const ids = [0, 1, 2, 3].map((v) => pickDance(105, clips, v)?.id);
    expect(ids[0]).toBe("samba"); // 105 / 100 is the nearest to natural
    expect(new Set(ids).size).toBe(3); // three fit, the fourth is the first again (80 -> 1.31 is out of range)
    expect(ids[3]).toBe(ids[0]);
    expect(pickDance(105, clips, -1)).toEqual(pickDance(105, clips, 0)); // a bad variant is the first
    expect(pickDance(105, clips, 1.5)).toEqual(pickDance(105, clips, 0));
  });
});

describe("glow", () => {
  it("is full on the beat, gone before the next, and falls smoothly", () => {
    expect(beatPulse(0)).toBe(1);
    expect(beatPulse(0.4)).toBe(0);
    expect(beatPulse(0.99)).toBe(0);
    let last = 1;
    for (let p = 0; p < 0.4; p += 0.01) {
      const v = beatPulse(p);
      expect(v).toBeLessThanOrEqual(last);
      expect(v).toBeGreaterThanOrEqual(0);
      last = v;
    }
  });

  it("reads nonsense as dark", () => {
    for (const bad of [-0.1, NaN, undefined as unknown as number]) expect(beatPulse(bad)).toBe(0);
    expect(beatPulse(0.5, 0)).toBe(0);
    expect(beatPulse(1.1)).toBeCloseTo(beatPulse(0.1), 9); // a phase that wrapped
  });
});

describe("taps", () => {
  const m = mapOf(steady(120, 64, 2)); // beats at 2.0, 2.5, 3.0 ...

  /** The window check as a function of the judge, so it can be run on a broken one. Returns the failures. */
  function windowFailures(judge: (map: BeatMap, t: number) => { hit: boolean }): string[] {
    const bad: string[] = [];
    if (!judge(m, 3.0).hit) bad.push("exact tap must hit");
    if (!judge(m, 3.0 + 0.079).hit) bad.push("79 ms late must hit");
    if (!judge(m, 3.0 - 0.079).hit) bad.push("79 ms early must hit");
    if (judge(m, 3.0 + 0.081).hit) bad.push("81 ms late must miss");
    if (judge(m, 3.0 - 0.081).hit) bad.push("81 ms early must miss");
    if (judge(m, 3.25).hit) bad.push("halfway between beats must miss");
    return bad;
  }

  it("counts a tap within 80 ms of a beat, early or late, and no further", () => {
    expect(TAP_WINDOW_MS).toBe(80);
    expect(windowFailures((map, t) => judgeTap(map, t))).toEqual([]);
  });

  it("fails the same check when the window is wrong (so the check can fail)", () => {
    expect(windowFailures((map, t) => judgeTap(map, t, { windowMs: 120 })).length).toBeGreaterThan(0);
    expect(windowFailures((map, t) => judgeTap(map, t, { windowMs: 40 })).length).toBeGreaterThan(0);
  });

  it("reports the nearest beat and a signed error, positive when late", () => {
    const late = judgeTap(m, 3.04);
    expect(late.beatIndex).toBe(2);
    expect(late.errorMs).toBeCloseTo(40, 6);
    const early = judgeTap(m, 3.46);
    expect(early.beatIndex).toBe(3);
    expect(early.errorMs).toBeCloseTo(-40, 6);
  });

  it("takes the output latency off the tap: the child taps on what they HEAR", () => {
    // the sound of beat 2 reaches the ear 120 ms after the clock says it played; a child tapping on it taps at 3.12
    expect(judgeTap(m, 3.12).hit).toBe(false);
    const j = judgeTap(m, 3.12, { latencyMs: 120 });
    expect(j.hit).toBe(true);
    expect(j.errorMs).toBeCloseTo(0, 6);
  });

  it("judges taps outside the song against the nearest end beat", () => {
    expect(judgeTap(m, 1.0).hit).toBe(false);
    expect(judgeTap(m, 1.97).beatIndex).toBe(0);
    expect(judgeTap(m, 1.97).hit).toBe(true);
    expect(judgeTap(m, 2 + 0.5 * 63 + 0.03).beatIndex).toBe(63);
    expect(judgeTap(m, 500).hit).toBe(false);
  });

  it("scores a run: one hit per beat, the nearer tap wins, the rest are strays", () => {
    const taps = [2.01, 2.03, 2.5, 2.9, 3.52, 3.25, 3.99];
    const s = scoreTaps(m, taps);
    // 2.01 and 2.03 are both on beat 0: 2.01 is nearer. 3.25 is between beats. 2.9 is 100 ms from 3.0: out.
    expect(s.hits.map((h) => h.beatIndex)).toEqual([0, 1, 3, 4]);
    expect(s.hits.map((h) => h.tap)).toEqual([2.01, 2.5, 3.52, 3.99]);
    expect(s.strays).toEqual([2.03, 2.9, 3.25]);
    expect(s.meanAbsErrorMs).toBeCloseTo((10 + 0 + 20 + 10) / 4, 6);
    expect(s.hits.length + s.strays.length).toBe(taps.length); // every tap is one or the other
  });

  it("does not depend on the order the taps arrive in", () => {
    const taps = [3.52, 2.01, 3.25, 2.5, 2.03];
    expect(scoreTaps(m, taps)).toEqual(scoreTaps(m, [...taps].reverse()));
  });

  it("a child tapping every beat, a little off, hits every one", () => {
    const taps = m.beats.slice(0, 40).map((b, i) => b + (((i * 37) % 120) - 60) / 1000); // -60 to +59 ms
    const s = scoreTaps(m, taps);
    expect(s.hits).toHaveLength(40);
    expect(s.strays).toHaveLength(0);
  });

  it("no taps is an empty score", () => {
    expect(scoreTaps(m, [])).toEqual({ hits: [], strays: [], meanAbsErrorMs: 0 });
  });
});

describe("what each age band does with the beat (5.1)", () => {
  it("follows the spec table", () => {
    expect(beatPlayFor(0)).toEqual({ mode: "free", judged: false, steps: 0 });
    expect(beatPlayFor(1)).toEqual({ mode: "free", judged: false, steps: 0 });
    expect(beatPlayFor(2)).toEqual({ mode: "on_beat", judged: true, steps: 0 });
    expect(beatPlayFor(3)).toEqual({ mode: "copy", judged: true, steps: 4 });
    expect(beatPlayFor(4)).toEqual({ mode: "compose", judged: true, steps: 8 });
    expect(beatPlayFor(5)).toEqual({ mode: "compose", judged: true, steps: 8 });
  });

  it("the youngest bands have no wrong taps, and a copy pattern fits one bar", () => {
    for (const band of [0, 1]) expect(beatPlayFor(band).judged).toBe(false);
    expect(beatPlayFor(3).steps).toBe(BEATS_PER_BAR);
    expect(beatPlayFor(4).steps).toBe(2 * BEATS_PER_BAR);
  });

  it("reads a band that is not one as the youngest, never as an older one", () => {
    for (const bad of [undefined, null, -1, 6, 2.5, NaN, "3", Infinity, {}]) expect(beatPlayFor(bad)).toEqual(beatPlayFor(0));
  });

  it("hands back a copy, so a caller cannot change the table", () => {
    const p = beatPlayFor(3);
    p.steps = 99;
    expect(beatPlayFor(3).steps).toBe(4);
  });
});
