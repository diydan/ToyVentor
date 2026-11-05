// How the toy guitar is played (runtime/guitarPlay.ts, the pure rules): chords, strokes, the invitation riff, the tap rules and the strum arm's clock. Dan, 2026-11-05: "can we improve the guitar interaction?"
import { describe, expect, it } from "vitest";
import {
  ACCENT_GAIN, AUTO_PATTERN, AUTO_START_S, AUTO_STEP_S, CHORDS, HOME, LAP_STROKES, MAX_PLAY_S, MIN_TAP_GAP_S, PROCEDURAL_ARM, PROGRESSION, RESOLVE_AFTER_S, RESOLVE_MIN_STROKES, RIFF_S,
  SPREAD_DOWN_S, SPREAD_UP_S, STROKES_PER_CHORD, SWEEP_KEYS_PER_S, TAP_FAST_GAIN, TAP_FAST_S, TAP_HOLD_S, TAP_SLOW_S, UP_GAIN, UP_STRINGS, autoRiff, chordFreqs, createArmSweep, createSession,
  makeStroke, midiHz, resolveStroke, strokeFor, tapGain, type ChordName,
} from "../src/features/game/world/runtime/guitarPlay";
import { PLAY_S } from "../src/features/game/world/runtime/toyRoomActs";
import { STRUM_EVERY_S } from "../src/features/game/world/runtime/proceduralClips";

describe("chords", () => {
  it("midiHz is equal temperament (A4 = 440, an octave doubles)", () => {
    expect(midiHz(69)).toBeCloseTo(440, 9);
    expect(midiHz(81)).toBeCloseTo(880, 9);
    expect(midiHz(60)).toBeCloseTo(261.6256, 3);
  });
  it("each chord is a real open voicing on a six-string guitar: strings in rising order, inside the guitar's range, the right notes", () => {
    const names = Object.keys(CHORDS) as ChordName[];
    expect(names.sort()).toEqual(["Am", "C", "F", "G"]);
    for (const n of names) {
      const v = CHORDS[n];
      expect(v).toHaveLength(6);
      const played = v.filter((m): m is number => m !== null);
      expect(played.length, n).toBeGreaterThanOrEqual(5);
      for (let i = 1; i < played.length; i++) expect(played[i]!, `${n} string ${i}`).toBeGreaterThan(played[i - 1]!);
      for (const m of played) { expect(m, n).toBeGreaterThanOrEqual(40); expect(m, n).toBeLessThanOrEqual(67); }   // E2 (the low E) to G4 (the G chord's high string)
    }
    // pitch classes: C = C E G, G = G B D, Am = A C E, F = F A C
    const pcs = (n: ChordName) => new Set(CHORDS[n].filter((m): m is number => m !== null).map((m) => m % 12));
    expect([...pcs("C")].sort((a, b) => a - b)).toEqual([0, 4, 7]);
    expect([...pcs("G")].sort((a, b) => a - b)).toEqual([2, 7, 11]);
    expect([...pcs("Am")].sort((a, b) => a - b)).toEqual([0, 4, 9]);
    expect([...pcs("F")].sort((a, b) => a - b)).toEqual([0, 5, 9]);
  });
  it("the progression is C, G, Am, F and it ends where it starts (home is C)", () => {
    expect([...PROGRESSION]).toEqual(["C", "G", "Am", "F"]);
    expect(HOME).toBe("C");
    expect(chordFreqs("C")).toHaveLength(5);
    expect(chordFreqs("G")).toHaveLength(6);
  });
});

describe("strokes", () => {
  it("a down stroke crosses every played string low to high in 20 to 30 ms; the delays only ever increase", () => {
    const s = makeStroke(0, "G", "down");
    expect(s.notes).toHaveLength(6);
    expect(s.notes.map((n) => n.freq)).toEqual(chordFreqs("G"));
    for (let i = 1; i < s.notes.length; i++) expect(s.notes[i]!.delay).toBeGreaterThan(s.notes[i - 1]!.delay);
    expect(s.notes[0]!.delay).toBe(0);
    const span = s.notes.at(-1)!.delay;
    expect(span).toBeCloseTo(SPREAD_DOWN_S, 9);
    expect(span).toBeGreaterThanOrEqual(0.02);
    expect(span).toBeLessThanOrEqual(0.03);
  });
  it("an up stroke brushes only the top strings, high to low, faster and lighter than the down stroke", () => {
    const down = makeStroke(0, "G", "down"), up = makeStroke(1, "G", "up");
    expect(up.notes).toHaveLength(UP_STRINGS);
    expect(up.notes.map((n) => n.freq)).toEqual(chordFreqs("G").slice(-UP_STRINGS).reverse());
    expect(up.notes.at(-1)!.delay).toBeCloseTo(SPREAD_UP_S, 9);
    expect(SPREAD_UP_S).toBeLessThan(SPREAD_DOWN_S);
    expect(up.vel).toBeCloseTo(UP_GAIN, 9);
    expect(up.vel).toBeLessThan(down.vel);
    expect(Math.max(...up.notes.map((n) => n.vel))).toBeLessThan(Math.max(...down.notes.map((n) => n.vel)));
  });
  it("the heavy strings ring louder on the way down (and nothing is ever above 1 or at 0)", () => {
    const s = makeStroke(0, "F", "down", { accent: true });
    expect(s.notes[0]!.vel).toBeGreaterThan(s.notes.at(-1)!.vel);
    for (const n of s.notes) { expect(n.vel).toBeGreaterThan(0); expect(n.vel).toBeLessThanOrEqual(1); }
    expect(s.vel).toBeLessThanOrEqual(1);
  });
  it("the first stroke of a chord is accented (a little louder than the same stroke without)", () => {
    const plain = makeStroke(2, "C", "down", { gapS: 1 });
    const acc = makeStroke(2, "C", "down", { gapS: 1, accent: true });
    expect(acc.accent).toBe(true);
    expect(acc.vel).toBeCloseTo(Math.min(1, plain.vel * ACCENT_GAIN), 9);
    expect(acc.vel).toBeGreaterThanOrEqual(plain.vel);
  });
  it("a little human unevenness only when asked, never enough to reorder the strings or make a note silent", () => {
    const a = makeStroke(0, "C", "down"), b = makeStroke(0, "C", "down");
    expect(a).toEqual(b);                                                              // no rng, no jitter
    let seed = 7;
    const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let k = 0; k < 50; k++) {
      const s = makeStroke(0, "G", "down", { rng });
      for (let i = 1; i < s.notes.length; i++) expect(s.notes[i]!.delay).toBeGreaterThan(s.notes[i - 1]!.delay);
      for (const n of s.notes) { expect(n.vel).toBeGreaterThan(0.5); expect(n.vel).toBeLessThanOrEqual(1); expect(n.delay).toBeGreaterThanOrEqual(0); }
    }
  });
  it("fast tapping is played softer, full weight for a relaxed tap, never silent", () => {
    expect(tapGain(Infinity)).toBe(1);
    expect(tapGain(TAP_SLOW_S)).toBe(1);
    expect(tapGain(TAP_FAST_S)).toBe(TAP_FAST_GAIN);
    expect(tapGain(0)).toBe(TAP_FAST_GAIN);
    for (let g = TAP_FAST_S; g < TAP_SLOW_S; g += 0.02) expect(tapGain(g + 0.02)).toBeGreaterThanOrEqual(tapGain(g));
    expect(strokeFor(0, { gapS: 0.1 }).vel).toBeLessThan(strokeFor(0, { gapS: 1 }).vel);
  });
});

describe("the song a child taps", () => {
  it("alternates down and up, four strokes on each chord, the progression round and round", () => {
    const seq = Array.from({ length: LAP_STROKES * 2 }, (_, i) => strokeFor(i));
    seq.forEach((s, i) => {
      expect(s.dir, `stroke ${i}`).toBe(i % 2 === 0 ? "down" : "up");
      expect(s.chord, `stroke ${i}`).toBe(PROGRESSION[Math.floor(i / STROKES_PER_CHORD) % PROGRESSION.length]);
      expect(s.index).toBe(i);
    });
    expect(STROKES_PER_CHORD).toBe(4);
    expect(LAP_STROKES).toBe(16);
  });
  it("accents the first stroke of each chord and marks the last stroke of each lap (the dog joins in there)", () => {
    for (let i = 0; i < LAP_STROKES * 2; i++) {
      const s = strokeFor(i);
      expect(s.accent, `accent ${i}`).toBe(i % STROKES_PER_CHORD === 0);
      expect(s.lapEnd, `lapEnd ${i}`).toBe(i % LAP_STROKES === LAP_STROKES - 1);
    }
  });
  it("any index is safe (negative, fractional, huge)", () => {
    expect(strokeFor(-3).index).toBe(0);
    expect(strokeFor(2.9).index).toBe(2);
    expect(strokeFor(1e9).chord).toBeTruthy();
  });
  it("the closing strum is a soft, slow down stroke on the home chord", () => {
    const r = resolveStroke(9);
    expect(r.chord).toBe(HOME);
    expect(r.dir).toBe("down");
    expect(r.vel).toBeLessThan(strokeFor(0, { gapS: 1 }).vel);
    expect(r.notes.at(-1)!.delay).toBeGreaterThan(makeStroke(0, HOME, "down").notes.at(-1)!.delay);       // slower than a normal strum
  });
});

describe("the invitation riff", () => {
  const riff = autoRiff();
  it("is two bars, C then G, of the folk pattern down, down-up, up-down-up: 12 strokes", () => {
    expect(riff).toHaveLength(AUTO_PATTERN.length * 2);
    expect(riff.slice(0, 6).every((r) => r.chord === "C")).toBe(true);
    expect(riff.slice(6).every((r) => r.chord === "G")).toBe(true);
    expect(riff.slice(0, 6).map((r) => r.dir)).toEqual(["down", "down", "up", "up", "down", "up"]);
  });
  it("starts after the arm has come up, keeps time on its step, and is over before the act's own end (PLAY_S) with time to ring", () => {
    expect(riff[0]!.at).toBeCloseTo(AUTO_START_S, 9);
    for (let i = 1; i < riff.length; i++) expect(riff[i]!.at).toBeGreaterThan(riff[i - 1]!.at);
    expect(riff[6]!.at - riff[0]!.at).toBeCloseTo(8 * AUTO_STEP_S, 9);                 // the second bar starts a whole bar later
    expect(riff.at(-1)!.at).toBeLessThan(RIFF_S - 0.2);
    expect(PLAY_S).toBe(RIFF_S);                                                        // (the act keeps its old 4.4 s)
  });
  it("accents the downbeat of each bar only", () => {
    expect(riff.filter((r) => r.accent).map((r) => r.at)).toEqual([riff[0]!.at, riff[6]!.at]);
  });
});

describe("taps (the session)", () => {
  it("before anyone taps the act is the riff's length and the riff is still playing", () => {
    const s = createSession();
    expect(s.taken).toBe(false);
    expect(s.endAt).toBe(RIFF_S);
    expect(s.strokes).toBe(0);
  });
  it("the first tap takes over: it plays stroke 0 (a C down stroke) and the act now ends TAP_HOLD_S after it, even if that is before the riff's end", () => {
    const s = createSession();
    const st = s.tap(0.7)!;
    expect(st.index).toBe(0);
    expect(st.chord).toBe("C");
    expect(st.dir).toBe("down");
    expect(s.taken).toBe(true);
    expect(s.endAt).toBeCloseTo(0.7 + TAP_HOLD_S, 9);
    expect(s.endAt).toBeLessThan(RIFF_S);
  });
  it("every tap keeps the song going TAP_HOLD_S more, counted from that tap", () => {
    const s = createSession();
    let t = 1;
    for (let i = 0; i < 10; i++, t += 0.5) { s.tap(t); expect(s.endAt).toBeCloseTo(t + TAP_HOLD_S, 9); }
  });
  it("a bounce (a second tap within MIN_TAP_GAP_S) is ignored and extends nothing", () => {
    const s = createSession();
    s.tap(1);
    expect(s.tap(1 + MIN_TAP_GAP_S - 0.01)).toBeNull();
    expect(s.strokes).toBe(1);
    expect(s.endAt).toBeCloseTo(1 + TAP_HOLD_S, 9);
    expect(s.tap(1 + MIN_TAP_GAP_S + 0.001)).not.toBeNull();
    expect(s.strokes).toBe(2);
  });
  it("never runs past MAX_PLAY_S, however long a child keeps tapping", () => {
    const s = createSession();
    for (let t = 0.5; t < 200; t += 0.5) { s.tap(t); expect(s.endAt).toBeLessThanOrEqual(MAX_PLAY_S); }
    expect(s.endAt).toBe(MAX_PLAY_S);
  });
  it("garbage times are refused", () => {
    const s = createSession();
    expect(s.tap(Number.NaN)).toBeNull();
    expect(s.tap(Infinity)).toBeNull();
    expect(s.strokes).toBe(0);
    expect(s.taken).toBe(false);
  });
  it("a fast second tap is played softer than a slow one", () => {
    const a = createSession(), b = createSession();
    a.tap(1); b.tap(1);
    const fast = a.tap(1.1)!, slow = b.tap(2)!;
    expect(fast.vel).toBeLessThan(slow.vel);
  });
  it("the closing chord comes once when the child has gone quiet after playing a little, never before, never for a single tap", () => {
    const s = createSession();
    for (let i = 0; i < RESOLVE_MIN_STROKES; i++) s.tap(1 + i * 0.4);
    const last = 1 + (RESOLVE_MIN_STROKES - 1) * 0.4;
    expect(s.resolveDue(last + RESOLVE_AFTER_S - 0.01)).toBeNull();
    const r = s.resolveDue(last + RESOLVE_AFTER_S)!;
    expect(r.chord).toBe(HOME);
    expect(s.resolveDue(last + RESOLVE_AFTER_S + 0.1)).toBeNull();                      // once
    expect(s.resolveDue(s.endAt)).toBeNull();
    const one = createSession();
    one.tap(1);
    expect(one.resolveDue(1 + RESOLVE_AFTER_S + 0.1)).toBeNull();                       // a single tap is not a song
    expect(createSession().resolveDue(3)).toBeNull();                                  // and nothing without a tap
  });
  it("tapping again after the closing chord re-arms it", () => {
    const s = createSession();
    for (let i = 0; i < 4; i++) s.tap(1 + i * 0.3);
    expect(s.resolveDue(1 + 0.9 + RESOLVE_AFTER_S)).not.toBeNull();
    s.tap(4);
    expect(s.resolveDue(4 + RESOLVE_AFTER_S + 0.01)).not.toBeNull();
  });
  it("the closing chord is due inside the act's own time (before it ends)", () => {
    expect(RESOLVE_AFTER_S).toBeLessThan(TAP_HOLD_S);
  });
});

describe("the strum arm's clock", () => {
  const dt = 1 / 60;
  const run = (a: ReturnType<typeof createArmSweep>, seconds: number) => { for (let t = 0; t < seconds - 1e-9; t += dt) a.update(dt); };
  it("waits in the ready pose before any stroke", () => {
    const a = createArmSweep(PROCEDURAL_ARM);
    expect(a.time()).toBe(PROCEDURAL_ARM.ready);
    run(a, 1);
    expect(a.time()).toBe(PROCEDURAL_ARM.ready);
    expect(a.moving).toBe(false);
  });
  it("a down stroke from ready sweeps to key 0 (a down pose) and arrives in about 70 ms, then stays until the next", () => {
    const a = createArmSweep(PROCEDURAL_ARM);
    a.stroke("down");
    expect(a.moving).toBe(true);
    run(a, 1.2 / SWEEP_KEYS_PER_S);
    expect(a.moving).toBe(false);
    expect(a.time()).toBeCloseTo(PROCEDURAL_ARM.keyTime(0), 9);
    run(a, 1);
    expect(a.time()).toBeCloseTo(PROCEDURAL_ARM.keyTime(0), 9);
  });
  it("alternating strokes land on alternating keys: downs on even keys, ups on odd ones, one key each", () => {
    const a = createArmSweep(PROCEDURAL_ARM);
    for (let i = 0; i < 20; i++) {
      a.stroke(i % 2 === 0 ? "down" : "up");
      expect(a.goal, `stroke ${i}`).toBe(i);
      expect(((a.goal % 2) + 2) % 2).toBe(i % 2);
      run(a, 0.1);
    }
  });
  it("a stroke the wrong way round goes through one extra (unheard) swing, so the arm still strikes the right way", () => {
    const a = createArmSweep(PROCEDURAL_ARM);
    a.stroke("down");
    run(a, 0.2);
    a.stroke("down");                                                                 // down after a down: up then down
    expect(a.goal).toBe(2);
    a.stroke("up");
    expect(a.goal % 2).toBe(1);
  });
  it("never moves backwards and never jumps more than a frame's sweep (smooth for the eye), through three laps of strokes", () => {
    const a = createArmSweep(PROCEDURAL_ARM);
    let prevAt = a.at, i = 0, wraps = 0;
    for (let t = 0; t < 12; t += dt) {
      if (Math.abs(t - i * 0.33) < dt / 2) { a.stroke(i % 2 === 0 ? "down" : "up"); i++; }
      a.update(dt);
      if (a.at < prevAt - 1e-9) {                                                    // the only way the key number goes down is a wrap by exactly one period (the clip repeats)
        const drop = prevAt - a.at;                                                  // (one period, less the frame's own sweep that came after it)
        expect(drop).toBeLessThanOrEqual(PROCEDURAL_ARM.period + 1e-9);
        expect(drop).toBeGreaterThanOrEqual(PROCEDURAL_ARM.period - SWEEP_KEYS_PER_S * dt - 1e-9);
        prevAt -= PROCEDURAL_ARM.period; wraps++;
      }
      expect(a.at).toBeGreaterThanOrEqual(prevAt);
      expect(a.at - prevAt).toBeLessThanOrEqual(SWEEP_KEYS_PER_S * dt + 1e-9);
      prevAt = a.at;
    }
    expect(i).toBeGreaterThan(30);
    expect(wraps).toBeGreaterThanOrEqual(1);
  });
  it("the clip time always stays inside the clip (the strum clip's strokes), and repeats seamlessly: the same pose one period later", () => {
    const a = createArmSweep(PROCEDURAL_ARM);
    let max = 0;
    for (let i = 0; i < 60; i++) { a.stroke(i % 2 === 0 ? "down" : "up"); run(a, 0.1); max = Math.max(max, a.time()); }
    expect(max).toBeLessThanOrEqual(PROCEDURAL_ARM.keyTime(PROCEDURAL_ARM.period) + 1e-9);
    expect(PROCEDURAL_ARM.keyTime(PROCEDURAL_ARM.period)).toBeLessThan(4.4);
    expect(PROCEDURAL_ARM.period % 2).toBe(0);
  });
  it("is the hand-authored strum clip's own timing (ready at 0.2 s, a stroke every STRUM_EVERY_S from 0.48 s)", () => {
    expect(PROCEDURAL_ARM.ready).toBe(0.2);
    expect(PROCEDURAL_ARM.keyTime(0)).toBeCloseTo(0.2 + STRUM_EVERY_S, 9);
    expect(PROCEDURAL_ARM.keyTime(1) - PROCEDURAL_ARM.keyTime(0)).toBeCloseTo(STRUM_EVERY_S, 9);
  });
});
