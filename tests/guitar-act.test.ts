// The guitar ACT (toyRoomActs.ts `strumVisit`) with the child playing it: every tap on the stage while Kip holds the guitar is a stroke of the song; the act is kept alive by taps; the strum arm is
// driven from a clock the taps move; the Mixamo "Guitar Playing" clip is used when it is loaded and the hand-authored `strum` clip when it is not; the hands come down before the guitar goes.
// Dan, 2026-11-05: "can we improve the guitar interaction?", then "we have the Mixamo guitar animations we can use, right?".
import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import { GUITAR_CLIP, forgetGuitarClip, loadGuitarClip } from "../src/features/game/world/runtime/guitarClip";
import { LAP_STROKES, MAX_PLAY_S, MIN_TAP_GAP_S, PROCEDURAL_ARM, PROGRESSION, RESOLVE_AFTER_S, RIFF_S, TAP_HOLD_S, STROKES_PER_CHORD, autoRiff, chordFreqs, type Stroke } from "../src/features/game/world/runtime/guitarPlay";
import type { PropInst } from "../src/features/game/world/runtime/propReactions";
import { DOG_EARS, PLAY_STAND, STRUM_KICK, STRUM_LINGER_S, createActs } from "../src/features/game/world/runtime/toyRoomActs";
import type { VisitPhase } from "../src/features/game/world/runtime/visitRoutine";

const inst = (type: string, px: number, pz = -2.4): PropInst => ({ type, base: { px, pz }, size: new THREE.Vector3(1.6, 2, 1.6) } as unknown as PropInst);
const guitar = inst("guitar", 18, -2.4);

/** A baked joint file the way scripts/mixamo-bake.mjs writes one: 14 identity joints, a bobbing hips, `beats` beats in one second. */
function jointFile(id = "music_guitar", beats = 2) {
  const frames = 31, names = ["Hips", "Head", "LeftArm", "LeftForeArm", "LeftHand", "RightArm", "RightForeArm", "RightHand", "LeftUpLeg", "LeftLeg", "LeftFoot", "RightUpLeg", "RightLeg", "RightFoot"];
  const q: Record<string, number[]> = {};
  for (const n of names) q[n] = Array.from({ length: frames }, () => [0, 0, 0, 1]).flat();
  const hips = Array.from({ length: frames }, (_, i) => [0, 60 + 2 * Math.cos((i / (frames - 1)) * Math.PI * 2 * beats * 2), 0]).flat();
  return { v: 1, id, label: "Guitar Strum", group: "music", source: "test", planted: true, fps: 30, frames, dur: 1, hips, q, beats, bpm: 120 };
}
const fetchOf = (body: unknown, ok = true) => (async () => ({ ok, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) })) as unknown as typeof fetch;

/** The world the act runs in, with the guitar's optional parts switchable: the strum sink, the arm driver, the camera turn, the held guitar. */
function game(opts: { arm?: "both" | "procedural" | "refuse" | "none"; dog?: PropInst | null; muteStrum?: boolean; turn?: boolean } = {}) {
  const root = new THREE.Group();
  const pos = { x: 12, y: 0, z: 0.4 };
  const log: string[] = [];
  const strokes: Stroke[] = [];
  const tones: number[] = [];
  const cues: Array<[PropInst, string]> = [];
  const held = new THREE.Group();
  held.scale.setScalar(0.72);
  const armCalls: Array<{ clip: string; time: () => number }> = [];
  let armStopped = 0;
  const turns: boolean[] = [];
  const mode = opts.arm ?? "both";
  const found: string[] = [];
  const w: Record<string, unknown> = {
    position: () => ({ ...pos }), targetX: () => null, walkTo: (x: number) => { log.push(`walkTo:${+x.toFixed(2)}`); },
    stopWalk: () => {}, face: (d: number) => log.push(`face:${d}`),
    root: () => root, eater: () => "character", allowed: () => true,
    clip: (a: string) => { log.push(`clip:${a}`); return true; },
    setPosition: () => {}, tone: (f: number) => { tones.push(f); },
    phase: (p: VisitPhase) => { log.push(`phase:${p}`); },
    hold: (i: string) => log.push(`hold:${i}`), release: () => log.push("release"),
    found: (k: string) => found.push(k),
    mouth: () => ({ x: 0, y: 0, z: 0 }), bubbles: { blow: () => {} },
    fx: {
      squish: () => {}, strike: () => 262, kickBall: () => true, flutter: () => {}, say: () => {},
      setVisible: (_i: PropInst, v: boolean) => log.push(`visible:${v}`),
      cue: (i: PropInst, n: string) => { cues.push([i, n]); },
      nearby: () => (opts.dog ? [opts.dog] : []),
    },
    heldMesh: () => held,
  };
  if (!opts.muteStrum) w.strum = (s: Stroke) => { strokes.push(s); };
  if (mode !== "none") {
    w.guitarArm = {
      has: (c: string) => (mode === "procedural" ? c === "strum" : c === "strum" || c === GUITAR_CLIP),
      start: (clip: string, time: () => number) => { if (mode === "refuse") return false; armCalls.push({ clip, time }); return true; },
      stop: () => { armStopped++; },
    };
    if (opts.turn !== false) w.faceCamera = (on: boolean) => { turns.push(on); };
  }
  const acts = createActs(w as never);
  const run = (seconds: number, dt = 1 / 30) => { for (let t = 0; t < seconds - 1e-9; t += dt) acts.update(dt); };
  const startAtStand = () => { acts.tap(guitar); pos.x = 18 - PLAY_STAND; run(0.1); };
  const tap = () => acts.consume();
  /** Run frame by frame until the act is over (at most `max` seconds). */
  const runUntilIdle = (max = 120) => { for (let t = 0; t < max && acts.busy; t += 1 / 30) acts.update(1 / 30); };
  return { runUntilIdle, acts, log, strokes, tones, cues, held, armCalls, turns, found, run, startAtStand, tap, root, pos, get armStopped() { return armStopped; } };
}

afterEach(() => forgetGuitarClip());

describe("a tap while Kip plays is a stroke", () => {
  it("the tap is swallowed (it must not also walk Kip or tap a prop) and plays the next stroke of the song at once", () => {
    const g = game();
    g.startAtStand();
    g.run(1);
    const before = g.strokes.length;                                      // (the riff has played a few by now)
    expect(g.tap()).toBe(true);
    expect(g.strokes).toHaveLength(before + 1);
    const s = g.strokes.at(-1)!;
    expect(s.index).toBe(0);
    expect(s.chord).toBe("C");
    expect(s.dir).toBe("down");
  });
  it("the first tap takes over: the riff plays no more, and the child's own strokes follow the progression, alternating down and up, four on each chord", () => {
    const g = game();
    g.startAtStand();
    g.run(0.7);
    g.tap();
    const mine: Stroke[] = [g.strokes.at(-1)!];
    const riffSoFar = g.strokes.length;
    for (let i = 1; i < LAP_STROKES + 4; i++) { g.run(0.3); g.tap(); mine.push(g.strokes.at(-1)!); }
    expect(g.strokes.length).toBe(riffSoFar + mine.length - 1 + 0);       // nothing but the child's strokes since the first tap (the riff's stroke before it was counted in riffSoFar)
    mine.forEach((s, i) => {
      expect(s.index).toBe(i);
      expect(s.dir).toBe(i % 2 === 0 ? "down" : "up");
      expect(s.chord).toBe(PROGRESSION[Math.floor(i / STROKES_PER_CHORD) % PROGRESSION.length]);
    });
  });
  it("without taps the riff plays through and the act ends at RIFF_S as it always did", () => {
    const g = game();
    g.startAtStand();
    g.run(RIFF_S + 0.5);
    expect(g.acts.busy).toBe(false);
    expect(g.strokes).toHaveLength(autoRiff().length);
    expect(g.strokes.every((s) => s.index === -1)).toBe(true);
    expect(g.log.slice(-2)).toEqual(["release", "visible:true"]);
  });
  it("every tap keeps the act going TAP_HOLD_S more: still playing just before, over just after (and a long song just goes on)", () => {
    const g = game();
    g.startAtStand();
    let t = 0.1;
    for (let i = 0; i < 12; i++) { g.run(1); t += 1; g.tap(); }          // twelve seconds of one tap a second, well past the riff's 4.4 s
    expect(g.acts.busy).toBe(true);
    g.run(TAP_HOLD_S - 0.15);
    expect(g.acts.busy).toBe(true);
    g.run(0.3);
    expect(g.acts.busy).toBe(false);
    expect(t).toBeGreaterThan(RIFF_S);
  });
  it("a single early tap ends the act TAP_HOLD_S later even though that is before the riff would have ended", () => {
    const g = game();
    g.startAtStand();
    g.run(0.6);
    g.tap();
    g.run(TAP_HOLD_S + 0.2);
    expect(g.acts.busy).toBe(false);
  });
  it("never goes on past MAX_PLAY_S, however long the child taps", () => {
    const g = game();
    g.startAtStand();
    for (let i = 0; i < 200 && g.acts.busy; i++) { g.run(1); g.tap(); }
    g.run(1);
    expect(g.acts.busy).toBe(false);
  });
  it("a bounce (two taps in one frame) is one stroke", () => {
    const g = game();
    g.startAtStand();
    g.run(0.7);
    g.tap();
    const n = g.strokes.length;
    expect(g.tap()).toBe(true);                                          // still swallowed
    expect(g.strokes).toHaveLength(n);
    g.run(MIN_TAP_GAP_S + 0.05);
    g.tap();
    expect(g.strokes).toHaveLength(n + 1);
  });
  it("a tap while Kip is still walking to the guitar drops the visit as before (the tap is the player's own), and strums nothing", () => {
    const g = game();
    g.acts.tap(guitar);
    expect(g.acts.phase).toBe("walking");
    expect(g.tap()).toBe(false);
    expect(g.acts.busy).toBe(false);
    expect(g.strokes).toHaveLength(0);
  });
  it("a tap with no guitar act is not consumed", () => {
    const g = game();
    expect(g.tap()).toBe(false);
  });
  it("without a `strum` sink in the world the strings are soft tones, one per string", () => {
    const g = game({ muteStrum: true });
    g.startAtStand();
    g.run(0.7);
    g.tones.length = 0;
    g.tap();
    expect(g.tones).toEqual(chordFreqs("C"));
  });
  it("each stroke floats a note up from the guitar, and never more than a crowd of them", () => {
    const g = game();
    g.startAtStand();
    g.run(0.6);
    for (let i = 0; i < 80; i++) { g.run(0.1); g.tap(); }
    expect(g.acts.noteCount).toBeGreaterThan(3);
    expect(g.acts.noteCount).toBeLessThanOrEqual(28);
  });
  it("closes with a soft C a little after the last tap, once, and never when the child only tapped once", () => {
    const g = game();
    g.startAtStand();
    g.run(0.6);
    for (let i = 0; i < 4; i++) { g.tap(); g.run(0.3); }
    const played = g.strokes.length;
    g.run(RESOLVE_AFTER_S - 0.3 - 0.1);
    expect(g.strokes).toHaveLength(played);
    g.run(0.3);
    expect(g.strokes).toHaveLength(played + 1);
    const closing = g.strokes.at(-1)!;
    expect(closing.chord).toBe("C");
    expect(closing.dir).toBe("down");
    expect(closing.vel).toBeLessThan(0.8);
    g.run(TAP_HOLD_S);
    expect(g.strokes).toHaveLength(played + 1);
    const one = game();
    one.startAtStand();
    one.run(0.6);
    one.tap();
    const n = one.strokes.length;
    one.run(TAP_HOLD_S + 0.5);
    expect(one.strokes).toHaveLength(n);
  });
  it("found('guitar') is still reported once, at the start (the tool belt's Toys row)", () => {
    const g = game();
    g.startAtStand();
    expect(g.found).toEqual(["guitar"]);
  });
});

describe("the toy belt plays the same act in place", () => {
  it("toy('guitar') starts it where Kip stands, with no stand to hide, and the taps play it", () => {
    const g = game();
    expect(g.acts.toy("guitar")).toBe(true);
    g.run(0.8);
    expect(g.acts.phase).toBe("acting");
    expect(g.log.some((l) => l.startsWith("visible:"))).toBe(false);
    expect(g.tap()).toBe(true);
    expect(g.strokes.at(-1)!.index).toBe(0);
    g.runUntilIdle();
    g.run(STRUM_LINGER_S + 0.1);
    expect(g.acts.busy).toBe(false);
    expect(g.log).toContain("release");
  });
});

describe("the guitar's kick", () => {
  it("swells a little on every stroke and is back to its size a moment later, and exactly at its size when the act is over", () => {
    const g = game();
    g.startAtStand();
    g.run(0.6);
    g.tap();
    g.run(1 / 30);
    expect(g.held.scale.x).toBeGreaterThan(0.72);
    expect(g.held.scale.x).toBeLessThanOrEqual(0.72 * (1 + STRUM_KICK) + 1e-9);
    g.run(0.3);
    expect(g.held.scale.x).toBeCloseTo(0.72, 9);
    g.tap();
    g.run(1 / 30);
    expect(g.held.scale.x).toBeGreaterThan(0.72);
    g.run(TAP_HOLD_S + 0.5);
    expect(g.held.scale.x).toBeCloseTo(0.72, 9);
  });
});

describe("the dog joins in", () => {
  it("hops on the last stroke of a whole lap of the song and woofs when it comes home, if it is near", () => {
    const dog = inst("dog", 14);
    const g = game({ dog });
    g.startAtStand();
    g.run(0.6);
    for (let i = 0; i < LAP_STROKES; i++) { g.tap(); g.run(0.3); }
    expect(g.cues).toEqual([[dog, "happy"]]);
    g.tap();
    g.run(RESOLVE_AFTER_S + 0.1);
    expect(g.cues.at(-1)).toEqual([dog, "bark"]);
  });
  it("hears nothing from far away, and nothing without a dog", () => {
    const far = game({ dog: inst("dog", 18 - PLAY_STAND + DOG_EARS + 3) });
    far.startAtStand();
    far.run(0.6);
    for (let i = 0; i < LAP_STROKES; i++) { far.tap(); far.run(0.3); }
    expect(far.cues).toEqual([]);
    const none = game();
    none.startAtStand();
    none.run(0.6);
    for (let i = 0; i < LAP_STROKES; i++) { none.tap(); none.run(0.3); }
    expect(none.cues).toEqual([]);
  });
});

describe("the strum arm", () => {
  it("is posed from a clock the strokes move: the hand-authored clip, in profile, when there is no Mixamo guitar", () => {
    const g = game({ arm: "procedural" });
    g.startAtStand();
    expect(g.armCalls).toHaveLength(1);
    expect(g.armCalls[0]!.clip).toBe("strum");
    expect(g.log).toContain("hold:guitar");
    expect(g.log).not.toContain("clip:strum");                           // (the canned clip is only the fallback)
    expect(g.turns).toEqual([]);                                         // he stays in profile
    const t0 = g.armCalls[0]!.time();
    expect(t0).toBe(PROCEDURAL_ARM.ready);
    g.run(0.6);
    expect(g.armCalls[0]!.time()).toBeGreaterThan(t0);                   // the riff's strokes have moved it
  });
  it("a child's tap swings the arm to the next extreme within a few frames", () => {
    const g = game({ arm: "procedural" });
    g.startAtStand();
    g.run(0.3);                                                          // (the act is a few frames old: before the riff's first stroke at 0.5 s)
    g.tap();                                                             // the first tap takes over before the riff plays anything
    const t = () => g.armCalls[0]!.time();
    const t1 = t();
    g.run(0.1);
    expect(t()).toBeCloseTo(PROCEDURAL_ARM.keyTime(0), 6);               // arrived at the first down pose
    expect(t()).toBeGreaterThan(t1);
    g.run(0.5);
    g.tap();
    g.run(0.1);
    expect(t()).toBeCloseTo(PROCEDURAL_ARM.keyTime(1), 6);               // and then the up pose
  });
  it("falls back to the canned clip when the world cannot drive the arm (reduced motion, no rig): hold the profile guitar, play `strum`, never turn", () => {
    const g = game({ arm: "refuse" });
    g.startAtStand();
    expect(g.log).toContain("hold:guitar");
    expect(g.log).toContain("clip:strum");
    expect(g.turns).toEqual([]);
    expect(g.tap()).toBe(true);                                          // the taps still play the strings
    g.run(TAP_HOLD_S + 0.2);
    expect(g.log.slice(-2)).toEqual(["release", "visible:true"]);        // and nothing lingers (there was no arm to bring down)
  });
  it("falls back to the canned clip in a world with no arm driver at all", () => {
    const g = game({ arm: "none" });
    g.startAtStand();
    expect(g.log.filter((l) => !l.startsWith("phase:")).slice(1)).toEqual(["face:1", "visible:false", "hold:guitar", "clip:strum"]);
    expect(g.tap()).toBe(true);
  });

  describe("with the Mixamo clip loaded", () => {
    async function withClip() {
      const bank: Record<string, unknown> = {};
      const r = await loadGuitarClip({ fetchImpl: fetchOf(jointFile()), addClips: (c) => Object.assign(bank, c) });
      expect(r.loaded).toBe(true);
      return bank;
    }
    it("Kip turns to face the camera, holds the guitar across his chest and plays the Mixamo clip", async () => {
      await withClip();
      const g = game();
      g.startAtStand();
      expect(g.armCalls[0]!.clip).toBe(GUITAR_CLIP);
      expect(g.log).toContain("hold:guitarFront");
      expect(g.log).not.toContain("hold:guitar");
      expect(g.log).not.toContain("clip:strum");
      expect(g.turns).toEqual([true]);
    });
    it("a tap moves the Mixamo clip's clock to its next stroke (a key every beat / 4 of the clip's one second, the clip repeating after its 8 keys)", async () => {
      await withClip();
      const g = game();
      g.startAtStand();
      g.run(0.3);
      g.tap();
      g.run(0.2);
      const time = g.armCalls[0]!.time;
      const first = time();
      g.run(0.5);
      g.tap();
      g.run(0.2);
      expect(time()).toBeGreaterThan(first);
      expect(time() - first).toBeCloseTo(0.125, 6);                      // beats = 2: 8 keys in a second
    });
    it("turns back (to face +x) when the act is over", async () => {
      await withClip();
      const g = game();
      g.startAtStand();
      g.run(RIFF_S + 0.5);
      expect(g.acts.busy).toBe(false);
      expect(g.turns).toEqual([true, false]);
    });
    it("cut short (a world change) he turns back and the guitar is gone at once", async () => {
      await withClip();
      const g = game();
      g.startAtStand();
      g.run(1);
      g.acts.reset();
      expect(g.turns).toEqual([true, false]);
      expect(g.log.slice(-2)).toEqual(["release", "visible:true"]);
      expect(g.armStopped).toBe(1);
    });
    it("is not used when the driver refuses it: the profile guitar and the canned clip, no turn", async () => {
      await withClip();
      const g = game({ arm: "refuse" });
      g.startAtStand();
      expect(g.log).toContain("hold:guitar");
      expect(g.log).toContain("clip:strum");
      expect(g.turns).toEqual([]);
    });
    it("is not used when the world cannot turn Kip to the camera: the hand-authored clip, in profile", async () => {
      await withClip();
      const g = game({ turn: false });
      g.startAtStand();
      expect(g.armCalls[0]!.clip).toBe("strum");
      expect(g.log).toContain("hold:guitar");
      expect(g.log).not.toContain("hold:guitarFront");
    });
  });

  it("without the Mixamo file the act plays the hand-authored clip (the bank-without-clip case): a missing, refused or broken file changes nothing", async () => {
    for (const f of [fetchOf("nope", false), fetchOf("{ not json"), fetchOf({ v: 1 }), fetchOf(jointFile("something_else")), (async () => { throw new Error("offline"); }) as unknown as typeof fetch]) {
      const added: string[] = [];
      const r = await loadGuitarClip({ fetchImpl: f, addClips: (c) => added.push(...Object.keys(c)) });
      expect(r.loaded).toBe(false);
      expect(added).toEqual([]);
    }
    const g = game({ arm: "procedural" });
    g.startAtStand();
    expect(g.armCalls[0]!.clip).toBe("strum");
    expect(g.log).toContain("hold:guitar");
  });
});

describe("his hands come down before the guitar goes", () => {
  it("while the arm is driven the guitar stays in his hands for STRUM_LINGER_S after the act ends, then is put away (and the stand's guitar comes back)", () => {
    const g = game({ arm: "procedural" });
    g.startAtStand();
    g.runUntilIdle();
    expect(g.acts.busy).toBe(false);
    expect(g.armStopped).toBe(1);
    expect(g.log).not.toContain("release");
    expect(g.log).not.toContain("visible:true");
    g.run(STRUM_LINGER_S - 0.1);
    expect(g.log).not.toContain("release");
    g.run(0.2);
    expect(g.log.slice(-2)).toEqual(["release", "visible:true"]);
  });
  it("a new guitar act starting in that moment settles the old one first (the guitar is put away, then picked up again)", () => {
    const g = game({ arm: "procedural" });
    g.startAtStand();
    g.runUntilIdle();
    g.acts.tap(guitar);
    const tail = g.log.slice(-4);
    expect(tail.slice(0, 2)).toEqual(["release", "visible:true"]);
  });
  it("another act that has taken something into his hands in that moment keeps it: the lingering guitar's release is skipped", () => {
    const g = game({ arm: "procedural" });
    g.startAtStand();
    g.runUntilIdle();
    const books = inst("books", 12 + 1.4);
    g.acts.tap(books);                                                   // he is at x = 18 - PLAY_STAND: the books are close; he walks over
    g.pos.x = books.base.px - 1.4;
    g.run(0.12);                                                         // and starts reading (hold book) inside the guitar's linger
    expect(g.log).toContain("hold:book");
    g.run(STRUM_LINGER_S);
    const after = g.log.slice(g.log.lastIndexOf("hold:book") + 1);
    expect(after).not.toContain("release");                              // the book is not taken out of his hands
    expect(g.log.slice(g.log.indexOf("hold:book")).includes("visible:true")).toBe(true);        // but the stand still gets its guitar back
  });
});
