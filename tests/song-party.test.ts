// The dance party's brain and the practice beat's pattern (shared/songParty.ts, shared/songSynth.ts; docs/specs/dance-party-spec.md 4.3, 5.1).
//
// The tap game and the dance-follows-the-clock checks are functions of an implementation, and are also run on versions broken on purpose (a
// stopwatch clock, a tap game that lets a beat count twice, a planner that stretches a dance): each must be caught, or the check proves nothing.
import { describe, expect, it } from "vitest";
import { MAX_BEATS, beatAt, clipTime, type BeatMap, type DanceClip } from "../shared/songBeat";
import { MOODS, TEMPOS, TEMPO_BPM } from "../shared/songCards";
import { MIX_BEATS, MIX_CHOICE, danceForMix, fittingClips, mixList, newTapRun, partyFrame, planParty, practiceBeatMap, registerTap, tapFlashes, tapSummary, type PartyClip } from "../shared/songParty";
import { LOOP_BEATS, MAX_MIDI, MIN_MIDI, MOOD_SYNTH, loopEvents, midiToHz } from "../shared/songSynth";

const DANCES: DanceClip[] = [
  { id: "dance_sway", bpm: 80, beats: 8 },
  { id: "dance_boogie", bpm: 120, beats: 16 },
  { id: "dance_silly", bpm: 125.22, beats: 8 },
  { id: "dance_swing", bpm: 137.8, beats: 48 },
];

// ---- the practice beat's pattern ----------------------------------------------------------------------------------------------------------

describe("the practice beat: a pattern as data, on the same grid the dance reads", () => {
  it("has a loop for every mood card, 16 beats long, deterministic", () => {
    expect(LOOP_BEATS).toBe(16);
    for (const mood of MOODS) {
      const a = loopEvents(mood);
      expect(a.length, mood).toBeGreaterThan(10);
      expect(loopEvents(mood), mood).toEqual(a);
    }
    expect(Object.keys(MOOD_SYNTH).sort()).toEqual([...MOODS].sort());
  });

  it("every event is inside the loop, in time order, and a drum lands on the grid (a straight beat or an eighth, or a shuffled eighth)", () => {
    for (const mood of MOODS) {
      const ev = loopEvents(mood);
      const swing = MOOD_SYNTH[mood].swing;
      let last = -1;
      for (const e of ev) {
        expect(e.beat, mood).toBeGreaterThanOrEqual(0);
        expect(e.beat, mood).toBeLessThan(LOOP_BEATS);
        expect(e.beat, mood).toBeGreaterThanOrEqual(last);
        last = e.beat;
        expect(e.dur, `${mood} ${e.voice}`).toBeGreaterThan(0);
        expect(e.vel, `${mood} ${e.voice}`).toBeGreaterThan(0);
        expect(e.vel, `${mood} ${e.voice}`).toBeLessThanOrEqual(1);
        if (e.voice === "kick" || e.voice === "snare") expect(Number.isInteger(e.beat), `${mood} ${e.voice} at ${e.beat}`).toBe(true);
        const frac = e.beat % 1;
        const allowed = [0, 0.5, 0.5 + swing].map((x) => Math.round(x * 1e6) / 1e6);
        expect(allowed, `${mood} ${e.voice} at beat ${e.beat}`).toContain(Math.round(frac * 1e6) / 1e6);
      }
    }
  });

  it("every mood has a kick on the downbeat of every bar, so the count 1 2 3 4 has something under it", () => {
    for (const mood of MOODS) {
      const kicks = loopEvents(mood).filter((e) => e.voice === "kick").map((e) => e.beat);
      for (const bar of [0, 4, 8, 12]) expect(kicks, `${mood} bar at ${bar}`).toContain(bar);
    }
  });

  it("pitched voices stay in a range a toy speaker plays, and every pitched event carries a note", () => {
    for (const mood of MOODS) {
      for (const e of loopEvents(mood)) {
        if (e.voice === "bass" || e.voice === "lead") {
          expect(e.midi, `${mood} ${e.voice}`).toBeDefined();
          expect(e.midi!, `${mood} ${e.voice}`).toBeGreaterThanOrEqual(MIN_MIDI);
          expect(e.midi!, `${mood} ${e.voice}`).toBeLessThanOrEqual(MAX_MIDI);
        } else expect(e.midi, `${mood} ${e.voice}`).toBeUndefined();
      }
    }
    expect(midiToHz(69)).toBeCloseTo(440, 9);
    expect(midiToHz(57)).toBeCloseTo(220, 9);
  });

  it("the moods sound different from each other (a lullaby is not a march)", () => {
    const sig = (m: (typeof MOODS)[number]) => JSON.stringify(loopEvents(m));
    expect(new Set(MOODS.map(sig)).size).toBe(MOODS.length);
    const kicks = (m: (typeof MOODS)[number]) => loopEvents(m).filter((e) => e.voice === "kick").length;
    expect(kicks("sleepy")).toBeLessThan(kicks("cleanup"));
    const loud = (m: (typeof MOODS)[number]) => Math.max(...loopEvents(m).map((e) => e.vel));
    expect(loud("sleepy")).toBeLessThan(loud("cleanup"));
  });
});

// ---- the plan and the frame ---------------------------------------------------------------------------------------------------------------

describe("planning a party from a tempo", () => {
  it("every tempo card gets a dance, from the real tempos the dances carry", () => {
    for (const t of TEMPOS) expect(planParty(TEMPO_BPM[t], DANCES).dance, t).not.toBeNull();
    expect(planParty(TEMPO_BPM.slow, DANCES).dance!.clip.id).toBe("dance_sway");
  });

  it("never stretches a dance: a song no clip fits is lights only", () => {
    expect(planParty(200, DANCES).dance).toBeNull();
    expect(planParty(45, DANCES).dance).toBeNull();
    for (let bpm = 40; bpm <= 220; bpm++) {
      const d = planParty(bpm, DANCES).dance;
      if (d) {
        expect(d.rate).toBeGreaterThanOrEqual(0.8 - 1e-12);
        expect(d.rate).toBeLessThanOrEqual(1.25 + 1e-12);
      }
    }
  });

  it("ignores a clip with no tempo, and steps to the next dance for a second Kip", () => {
    const withBare = [...DANCES, { id: "dance_chicken", bpm: 0, beats: 0 } as DanceClip, { id: "dance_x", bpm: 100, beats: 2.5 } as DanceClip];
    for (let bpm = 64; bpm <= 170; bpm++) expect(["dance_chicken", "dance_x"]).not.toContain(planParty(bpm, withBare).dance?.clip.id);
    const a = planParty(125, DANCES, 0).dance!.clip.id;
    const b = planParty(125, DANCES, 1).dance!.clip.id;
    expect(a).not.toBe(b);
  });
});

// ---- choosing a move ----------------------------------------------------------------------------------------------------------------

describe("the Dance picker: choosing a move instead of letting the tempo pick", () => {
  const CLIPS: PartyClip[] = [
    { id: "dance_sway", bpm: 80, beats: 8, group: "dance" },
    { id: "dance_boogie", bpm: 120, beats: 16, group: "dance" },
    { id: "dance_silly", bpm: 125.22, beats: 8, group: "dance" },
    { id: "move_jacks", bpm: 112.5, beats: 2, group: "move" }, // a movement-break move: never picked by the tempo, only chosen
    { id: "music_guitar", bpm: 100.7, beats: 8, group: "music" },
    { id: "dance_chicken", bpm: 0, beats: 0, group: "dance" }, // no tempo: never offered
  ];

  it("lists every clip a tempo fits, nearest its natural speed first, and none outside a quarter either way", () => {
    const fit = fittingClips(110, CLIPS);
    expect(fit.map((f) => f.clip.id)).toEqual(["move_jacks", "dance_boogie", "music_guitar", "dance_silly"]); // rates 0.98, 0.92, 1.09, 0.88
    for (const f of fit) {
      expect(f.rate).toBeGreaterThanOrEqual(0.8 - 1e-12);
      expect(f.rate).toBeLessThanOrEqual(1.25 + 1e-12);
    }
    expect(fittingClips(110, CLIPS).some((f) => f.clip.id === "dance_chicken")).toBe(false);
    expect(fittingClips(200, CLIPS)).toEqual([]);
    expect(fittingClips(85, CLIPS).map((f) => f.clip.id)).toEqual(["dance_sway", "music_guitar"]); // the jacks would have to run at 0.76 of their speed
  });

  /** The picker's rules as a function of the planner, so it can be run on a broken one. Returns the failures. */
  function pickerFailures(plan: typeof planParty): string[] {
    const bad: string[] = [];
    const id = (p: ReturnType<typeof planParty>) => p.dance?.clip.id ?? null;
    if (id(plan(110, CLIPS, 0, "dance_silly")) !== "dance_silly") bad.push("a chosen clip that fits must be played");
    const p1 = plan(110, CLIPS, 0, "dance_silly");
    if (!p1.chosen || p1.fellBack) bad.push("a chosen clip must say it was chosen");
    if (id(plan(110, CLIPS, 0, "move_jacks")) !== "move_jacks") bad.push("a movement-break move can be chosen");
    if (id(plan(110, CLIPS, 0, "music_guitar")) !== "music_guitar") bad.push("the guitar strum can be chosen");
    const unfit = plan(85, CLIPS, 0, "dance_silly"); // 85 / 125 = 0.68: too slow for this dance
    if (id(unfit) === "dance_silly") bad.push("a clip that does not fit the tempo must NOT be stretched to it");
    if (!unfit.fellBack || unfit.chosen) bad.push("an unfit choice must fall back and say so");
    if (id(unfit) !== "dance_sway") bad.push(`the fallback is the tempo's own pick, got ${id(unfit)}`);
    for (const bpm of [64, 80, 90, 100, 110, 120, 128, 140]) {
      const auto = plan(bpm, CLIPS);
      const kind = CLIPS.find((c) => c.id === auto.dance?.clip.id)?.group; // the clip's real group, not whatever the planner under test says
      if (auto.dance && kind !== "dance") bad.push(`the tempo picked a ${kind} at ${bpm} bpm; only dances are picked automatically`);
      if (auto.chosen) bad.push("an automatic pick is not a chosen one");
    }
    if (id(plan(110, CLIPS, 0, "nonsense")) === "nonsense") bad.push("an id that is not a clip is never played");
    if (id(plan(110, CLIPS, 0, "dance_chicken")) === "dance_chicken") bad.push("a clip with no tempo is never played");
    return bad;
  }

  it("follows the picker's rules: choose what fits, never stretch, never pick a move automatically", () => {
    expect(pickerFailures(planParty)).toEqual([]);
  });

  it("fails the same rules on a planner that stretches a chosen clip to any tempo (so the check can fail)", () => {
    const stretcher: typeof planParty = (bpm, clips, variant, choose) => {
      const hit = choose ? clips.find((c) => c.id === choose && c.bpm > 0) : undefined;
      return hit ? { songBpm: bpm, dance: { clip: hit, rate: bpm / hit.bpm }, chosen: true, fellBack: false, mix: null } : planParty(bpm, clips, variant, choose);
    };
    expect(pickerFailures(stretcher).length).toBeGreaterThan(0);
  });

  it("fails the same rules on a planner that lets the tempo pick a movement-break move", () => {
    const greedy: typeof planParty = (bpm, clips, variant, choose) => planParty(bpm, clips.map((c) => ({ ...c, group: "dance" })), variant, choose);
    expect(pickerFailures(greedy).length).toBeGreaterThan(0);
  });

  it("choosing nothing is exactly what the tempo picks, and the plan is the same shape as before", () => {
    for (let bpm = 64; bpm <= 150; bpm++) {
      expect(planParty(bpm, CLIPS, 0, null)).toEqual(planParty(bpm, CLIPS));
      expect(planParty(bpm, CLIPS, 0, undefined)).toEqual(planParty(bpm, CLIPS));
    }
    expect(planParty(110, CLIPS).fellBack).toBe(false);
  });

  it("a chosen move is held on the beat the same way (its tempo is its beats per loop)", () => {
    const plan = planParty(112.5, CLIPS, 0, "move_jacks");
    const map = practiceBeatMap(112.5);
    const iv = 60 / 112.5;
    for (let k = 0; k < 12; k++) {
      const f = partyFrame(plan, map, k * iv);
      expect(f.danceId).toBe("move_jacks");
      expect(f.danceTime!).toBeCloseTo((k % 2) * iv, 9); // 2 beats per jack
    }
  });
});

describe("the practice beat map", () => {
  it("holds the tempo exactly, starts on a downbeat at 0, and is long enough for a party", () => {
    for (const bpm of [80, 105, 128, 160]) {
      const m = practiceBeatMap(bpm);
      expect(m.bpm).toBeCloseTo(bpm, 6);
      expect(m.beats[0]).toBe(0);
      expect(m.beats[1]! - m.beats[0]!).toBeCloseTo(60 / bpm, 12);
      expect(m.beats[m.beats.length - 1]!).toBeGreaterThan(bpm >= 100 ? 590 : 590 * (bpm / 120)); // about ten minutes, bounded by MAX_BEATS
      expect(m.beats.length).toBeLessThanOrEqual(MAX_BEATS);
    }
  });

  it("refuses a tempo a party cannot follow", () => {
    expect(() => practiceBeatMap(20)).toThrow();
    expect(() => practiceBeatMap(400)).toThrow();
  });
});

describe("a frame of the party", () => {
  const map = practiceBeatMap(125.22);
  const plan = planParty(125.22, DANCES);

  /** The no-drift check as a function of the clock, so it can be run on a broken one. Returns the worst error, seconds, over 60 s of frames. */
  function worstDrift(danceTime: (t: number) => number): number {
    const clip = plan.dance!.clip;
    const loop = clip.beats * (60 / clip.bpm);
    let worst = 0;
    for (let k = 0; k < 60 * 2; k++) {
      const t = (k * 60) / 125.22; // every beat of the first 60 s
      if (t > 60) break;
      const want = (k % clip.beats) * (60 / clip.bpm);
      const e = Math.abs(((danceTime(t) - want + loop / 2) % loop + loop) % loop - loop / 2);
      worst = Math.max(worst, e);
    }
    return worst;
  }

  it("keeps the dance on the beat for 60 s: every song beat is the same point of the clip", () => {
    expect(worstDrift((t) => partyFrame(plan, map, t).danceTime!)).toBeLessThan(1e-9);
  });

  it("fails the same check on a stopwatch that is a hair off the song's tempo (so the check can fail)", () => {
    const clip = plan.dance!.clip;
    const loop = clip.beats * (60 / clip.bpm);
    const stopwatch = (t: number) => (t * 1.002) % loop; // a clock 0.2 % fast: 120 ms off after a minute
    expect(worstDrift(stopwatch)).toBeGreaterThan(0.08);
  });

  it("counts 1 2 3 4, flashes on the beat and is dark before the next", () => {
    const iv = 60 / 125.22;
    for (let k = 0; k < 8; k++) {
      const f = partyFrame(plan, map, k * iv);
      expect(f.count).toBe(((k % 4) + 1) as 1 | 2 | 3 | 4);
      expect(f.downbeat).toBe(k % 4 === 0);
      expect(f.pulse).toBe(1);
      expect(partyFrame(plan, map, k * iv + 0.9 * iv).pulse).toBe(0);
    }
  });

  it("a lights-only party has a pulse and a count but no dance", () => {
    const fast = planParty(200, DANCES);
    const f = partyFrame(fast, practiceBeatMap(160), 1.234);
    expect(f.danceId).toBeNull();
    expect(f.danceTime).toBeNull();
    expect(f.count).toBeGreaterThanOrEqual(1);
  });

  it("is defined before the song starts (a count-in) and never goes negative inside a clip", () => {
    for (const t of [-2, -0.5, 0, 0.001]) {
      const f = partyFrame(plan, map, t);
      expect(f.danceTime!).toBeGreaterThanOrEqual(0);
      expect(f.danceTime!).toBeLessThan(plan.dance!.clip.beats * (60 / plan.dance!.clip.bpm));
      expect(f.count).toBeGreaterThanOrEqual(1);
      expect(f.count).toBeLessThanOrEqual(4);
    }
  });
});

// ---- taps ---------------------------------------------------------------------------------------------------------------------------------

describe("tapping the beat, by age band", () => {
  const map: BeatMap = practiceBeatMap(120); // a beat every 0.5 s from 0

  it("bands 0 and 1: any tap is a hit and flashes, there are no wrong taps", () => {
    for (const band of [0, 1]) {
      const run = newTapRun(band);
      for (const t of [0.01, 0.13, 0.25, 0.33, 0.49]) {
        const o = registerTap(run, map, t);
        expect(o.kind).toBe("free");
        expect(tapFlashes(o)).toBe(true);
      }
      expect(tapSummary(run)).toEqual({ taps: 5, hits: 5, meanAbsErrorMs: 0 });
    }
  });

  /** The tap game as a function of an implementation, so it can be run on a broken one. Returns the failures. */
  function gameFailures(register: typeof registerTap): string[] {
    const bad: string[] = [];
    const run = newTapRun(2);
    const a = register(run, map, 2.0);
    if (a.kind !== "hit") bad.push("a tap on the beat must hit");
    const b = register(run, map, 2.02);
    if (b.kind !== "repeat") bad.push("a second tap on the same beat must not count again");
    if (register(run, map, 2.25).kind !== "miss") bad.push("a tap between beats must miss");
    if (register(run, map, 2.5 + 0.079).kind !== "hit") bad.push("79 ms late must hit");
    if (register(run, map, 3.0 + 0.081).kind !== "miss") bad.push("81 ms late must miss");
    const s = tapSummary(run);
    if (s.hits !== 2) bad.push(`two beats were hit, the run says ${s.hits}`);
    if (s.taps !== 5) bad.push(`five taps were made, the run says ${s.taps}`);
    return bad;
  }

  it("from band 2: a tap within 80 ms of a beat is a hit, once per beat, and only a hit flashes", () => {
    expect(gameFailures(registerTap)).toEqual([]);
    const run = newTapRun(2);
    expect(tapFlashes(registerTap(run, map, 4.0))).toBe(true);
    expect(tapFlashes(registerTap(run, map, 4.01))).toBe(false); // a repeat is silent
    expect(tapFlashes(registerTap(run, map, 4.25))).toBe(false); // a miss is silent
  });

  it("fails the same check on a game that lets a beat count twice (so the check can fail)", () => {
    const lax: typeof registerTap = (run, m, t, o) => { run.claimed.clear(); return registerTap(run, m, t, o); };
    expect(gameFailures(lax).length).toBeGreaterThan(0);
  });

  it("bands 3 to 5 play the on-beat game for now (copy and compose are not built), and a corrupt band is the youngest", () => {
    for (const band of [3, 4, 5]) expect(newTapRun(band).mode).toBe("on_beat");
    for (const bad of [undefined, null, -1, 6, 2.5, "3", NaN]) expect(newTapRun(bad).mode, String(bad)).toBe("free");
  });

  it("takes output latency off a tap: the child taps on what they hear", () => {
    const run = newTapRun(2);
    expect(registerTap(run, map, 2.12).kind).toBe("miss");
    expect(registerTap(newTapRun(2), map, 2.12, { latencyMs: 120 }).kind).toBe("hit");
  });

  it("measures the mean error of the hits it counted", () => {
    const run = newTapRun(2);
    registerTap(run, map, 1.0 + 0.02);
    registerTap(run, map, 1.5 - 0.04);
    registerTap(run, map, 1.75); // a miss, not counted in the error
    const s = tapSummary(run);
    expect(s.hits).toBe(2);
    expect(s.taps).toBe(3);
    expect(s.meanAbsErrorMs).toBeCloseTo(30, 6);
  });

  it("agrees with the clock that placed the dance: the beat a tap hits is the beat the frame says it is on", () => {
    for (let k = 3; k < 20; k++) {
      const t = k * 0.5;
      const o = registerTap(newTapRun(2), map, t + 0.01);
      expect(o.kind === "hit" && o.beatIndex).toBe(k);
      expect(beatAt(map, t).index).toBe(k);
      expect(clipTime(map, t, { bpm: 120, beats: 16 })).toBeCloseTo((k % 16) * 0.5, 9);
    }
  });
});

// ---- the starter library ------------------------------------------------------------------------------------------------------------------

import { MAX_SONG_BYTES, parseSongIndex, songBeatMap, songInterval } from "../shared/songParty";

describe("the starter library's index is checked before anything is played", () => {
  const good = () => ({ id: "bouncy_b", title: "Hop, Skip, Jump", mood: "bouncy", file: "bouncy_b.m4a", bytes: 657392, dur: 63.866, bpm: 108.99, beats: 116, bars: 29, offset: 0.02, ai: true });
  const idx = (songs: unknown[]) => ({ v: 1, songs });

  /** The checks as a function of the parser, so they can be run on a broken one. Returns the failures. */
  function indexFailures(parse: typeof parseSongIndex): string[] {
    const bad: string[] = [];
    const kept = (over: Record<string, unknown>) => parse(idx([{ ...good(), ...over }])).songs.length === 1;
    if (!kept({})) bad.push("a good song must be kept");
    const refuse: [string, Record<string, unknown>][] = [
      ["a path in the file name", { file: "../../etc/passwd.m4a" }],
      ["a file that is not m4a", { file: "bouncy_b.exe" }],
      ["an id with a slash", { id: "a/b" }],
      ["a mood that is not a card", { mood: "scary" }],
      ["a tempo no dance follows", { bpm: 220, dur: (60 * 116) / 220 }],
      ["a length that does not match the tempo", { dur: 90 }],
      ["a loop that is not whole bars", { beats: 115, bars: 28.75 }],
      ["a song not labelled as made by AI", { ai: false }],
      ["a huge file", { bytes: MAX_SONG_BYTES + 1 }],
      ["an offset past the first beat", { offset: 2 }],
    ];
    for (const [why, over] of refuse) if (kept(over)) bad.push(`must refuse ${why}`);
    return bad;
  }

  it("keeps a good song and refuses each thing that cannot be trusted", () => {
    expect(indexFailures(parseSongIndex)).toEqual([]);
  });

  it("fails the same checks on a parser that trusts the index (so the check can fail)", () => {
    const trusting: typeof parseSongIndex = (raw) => ({ songs: ((raw as { songs: unknown[] }).songs ?? []) as never, skipped: [] });
    expect(indexFailures(trusting).length).toBeGreaterThan(5);
  });

  it("leaves a bad song out and names why, keeps the others, refuses a duplicate id, and reads nonsense as an empty library", () => {
    const r = parseSongIndex(idx([good(), { ...good(), id: "bad one" }, { ...good(), file: "zz.m4a" }]));
    expect(r.songs.map((s) => s.id)).toEqual(["bouncy_b"]);
    expect(r.skipped).toHaveLength(2);
    expect(parseSongIndex(idx([good(), good()])).skipped.join()).toContain("duplicate");
    for (const junk of [null, undefined, 5, "x", [], { v: 2, songs: [] }, { v: 1 }, { v: 1, songs: "no" }]) expect(parseSongIndex(junk).songs, String(junk)).toEqual([]);
    expect(parseSongIndex(idx([null, 5, "x", []])).songs).toEqual([]);
  });

  it("keeps only the fields it checked (no extra field rides along into the page)", () => {
    const withExtra = { ...good(), evil: "<script>", source: { prompt: "x" } };
    expect(Object.keys(parseSongIndex(idx([withExtra])).songs[0]!).sort()).toEqual(["ai", "bars", "beats", "bpm", "bytes", "dur", "file", "id", "mood", "offset", "title"]);
  });
});

describe("a library song's beat grid", () => {
  const song = { dur: 63.866, beats: 116, offset: 0.02 };

  it("puts beat k at offset + k x interval, from the exact loop length", () => {
    const m = songBeatMap(song);
    const iv = songInterval(song);
    expect(iv).toBeCloseTo(63.866 / 116, 12);
    for (const k of [0, 1, 57, 115, 116, 117, 500, 1000]) expect(m.beats[k]!).toBeCloseTo(0.02 + k * iv, 9);
  });

  it("is on the beat at every loop of the file: the first beat of loop n is exactly n x the loop length after the first beat of loop 0", () => {
    const m = songBeatMap(song);
    for (let n = 1; n < 9; n++) expect(m.beats[n * song.beats]! - m.beats[0]!).toBeCloseTo(n * song.dur, 7);
  });

  it("covers a ten-minute party, and a dance held to it stays on its beat across loops", () => {
    const m = songBeatMap(song, 600);
    expect(m.beats[m.beats.length - 1]!).toBeGreaterThan(590);
    const plan = planParty(109, DANCES);
    const clip = plan.dance!.clip;
    const loop = clip.beats * (60 / clip.bpm);
    for (let k = 0; k < m.beats.length - 1; k += 37) {
      const f = partyFrame(plan, m, m.beats[k]!);
      expect(f.danceTime!, `beat ${k}`).toBeCloseTo((k % clip.beats) * (60 / clip.bpm), 6);
      expect(f.danceTime!).toBeLessThan(loop);
    }
  });

  it("refuses a loop whose tempo no party can follow (30 bpm: 4 beats in 8 s)", () => {
    expect(() => songBeatMap({ dur: 8, beats: 4, offset: 0 })).toThrow();
  });
});

// ---- the Dance mix ---------------------------------------------------------------------------------------------------------------------

describe("the Dance mix: a new dance every four bars, on the bar line", () => {
  const CLIPS: PartyClip[] = [
    { id: "dance_sway", bpm: 80, beats: 8, group: "dance" },
    { id: "dance_boogie", bpm: 120, beats: 16, group: "dance" },
    { id: "dance_silly", bpm: 125.22, beats: 8, group: "dance" },
    { id: "dance_hiphop", bpm: 101.4, beats: 8, group: "dance" },
    { id: "move_jacks", bpm: 112.5, beats: 2, group: "move" }, // a movement-break move: never in a mix
    { id: "music_guitar", bpm: 100.7, beats: 8, group: "music" }, // nor the strum
  ];

  it("takes turns with the dances that fit, nearest its natural speed first, never a movement-break move or the strum", () => {
    const list = mixList(110, CLIPS);
    expect(list.map((x) => x.clip.id)).toEqual(["dance_hiphop", "dance_boogie", "dance_silly"]); // rates 1.085, 0.917, 0.878: nearest to 1 first
    for (const x of list) expect(["dance", undefined]).toContain(x.clip.group);
    expect(mixList(200, CLIPS)).toEqual([]);
    expect(mixList(85, CLIPS).map((x) => x.clip.id)).toEqual(["dance_sway", "dance_hiphop"]);
  });

  /** The mix's rules as a function of the chooser, so it can be run on a broken one. Returns the failures. */
  function mixFailures(pick: <T>(list: readonly T[], position: number, every?: number) => T): string[] {
    const bad: string[] = [];
    const list = ["a", "b", "c"];
    if (pick(list, 0) !== "a" || pick(list, 15.99) !== "a") bad.push("the first 16 beats are the first dance");
    if (pick(list, 16) !== "b" || pick(list, 31.99) !== "b") bad.push("beats 16 to 32 are the second");
    if (pick(list, 32) !== "c" || pick(list, 48) !== "a") bad.push("the third, then back to the first");
    if (pick(list, -3) !== "a" || pick(list, -0.001) !== "a") bad.push("a count-in is the first dance");
    for (let b = 0; b < 400; b += 0.5) if (pick(list, b) !== pick(list, b)) bad.push("it must be a function of the position");
    for (let block = 0; block < 12; block++) if (pick(list, block * 16) === pick(list, (block + 1) * 16)) { bad.push("a dance must never follow itself"); break; }
    for (let b = 1; b < 16; b++) if (pick(list, 16 + b) !== pick(list, 16)) { bad.push("the dance must hold for the whole block"); break; }
    if (pick(["only"], 123) !== "only") bad.push("one dance is just that dance");
    if (pick(list, NaN) !== "a") bad.push("a position that is not a number is the first dance");
    return bad;
  }

  it("follows the rules: 16 beats each, in order, round the list, held for the whole block, never repeating", () => {
    expect(MIX_BEATS).toBe(16);
    expect(mixFailures(danceForMix)).toEqual([]);
  });

  it("fails the same rules on a mixer that switches every beat and on one that picks at random (so the check can fail)", () => {
    const everyBeat = <T,>(l: readonly T[], p: number) => danceForMix(l, p, 1);
    expect(mixFailures(everyBeat).length).toBeGreaterThan(0);
    let n = 0;
    const random = <T,>(l: readonly T[]) => l[(n++ * 7 + 3) % l.length]!;
    expect(mixFailures(random).length).toBeGreaterThan(0);
  });

  it("a plan that is a mix opens on the dance the tempo would have picked, says it was chosen, and carries its list", () => {
    const mix = planParty(110, CLIPS, 0, MIX_CHOICE);
    const auto = planParty(110, CLIPS);
    expect(mix.dance!.clip.id).toBe(auto.dance!.clip.id);
    expect(mix.chosen).toBe(true);
    expect(mix.fellBack).toBe(false);
    expect(mix.mix!.list.length).toBe(3);
    expect(mix.mix!.every).toBe(MIX_BEATS);
    expect(auto.mix).toBeNull();
  });

  it("with fewer than two dances that fit, a mix is just the tempo's own pick (nothing to take turns with)", () => {
    const one = planParty(128, [{ id: "dance_silly", bpm: 125.22, beats: 8, group: "dance" }, { id: "move_jacks", bpm: 112.5, beats: 2, group: "move" }], 0, MIX_CHOICE);
    expect(one.mix).toBeNull();
    expect(one.dance!.clip.id).toBe("dance_silly");
    expect(planParty(300, CLIPS, 0, MIX_CHOICE).dance).toBeNull();
  });

  it("the frame follows the mix: the dance changes only on a block line, and each one is on the beat (its time is its beat position in its own loop)", () => {
    const plan = planParty(110, CLIPS, 0, MIX_CHOICE);
    const map = practiceBeatMap(110);
    const iv = 60 / 110;
    const order = plan.mix!.list.map((x) => x.clip);
    let last: string | null = null;
    const changes: number[] = [];
    for (let k = 0; k < 16 * 7; k++) {
      const f = partyFrame(plan, map, k * iv);
      const clip = order[Math.floor(k / 16) % order.length]!;
      expect(f.danceId, `beat ${k}`).toBe(clip.id);
      expect(f.danceTime!, `beat ${k}`).toBeCloseTo((k % clip.beats) * (60 / clip.bpm), 6);
      if (f.danceId !== last) { changes.push(k); last = f.danceId; }
    }
    expect(changes).toEqual([0, 16, 32, 48, 64, 80, 96]); // every one on a multiple of 16 beats, which is a bar line
    for (const c of changes) expect(c % 4).toBe(0);
  });

  it("a dance picked by hand, or the tempo's own, is not a mix and never changes", () => {
    for (const choose of [null, "dance_silly", undefined]) {
      const plan = planParty(110, CLIPS, 0, choose);
      const map = practiceBeatMap(110);
      const ids = new Set<string | null>();
      for (let k = 0; k < 120; k += 3) ids.add(partyFrame(plan, map, k * (60 / 110)).danceId);
      expect(ids.size, String(choose)).toBe(1);
    }
  });
});

