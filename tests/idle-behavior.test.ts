// What the game's character does on its own (src/features/game/world/runtime/idleBehavior.ts; Dan, 2026-11-04: "idle waves and random dances if nothing is going on"): what it chooses, how long it
// plays for, the files it loads (the real baked ones, through a fake fetch), and the controller that starts and stops it. The rules are functions of an implementation so each can be run on a
// version that is wrong on purpose and must fail. The behaviour in the real game is scripts/e2e-game-idle.mjs.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DANCE_FROM_TICK,
  IDLE_FILES,
  IDLE_GAP_SECONDS,
  IDLE_IDS,
  IDLE_ODDS,
  IDLE_SECONDS,
  SAMBA_CLIP,
  IDLE_LABEL,
  chooseIdle,
  createGestureLibrary,
  createIdle,
  idleGapSeconds,
  playSeconds,
  type IdleChoice,
  type IdleMix,
} from "../src/features/game/world/runtime/idleBehavior";
import type { BakedClip, BeatSource } from "../src/features/game/world/runtime/mixamo";

const root = join(__dirname, "..");
const baked = (id: string) => readFileSync(join(root, "public/kip/mixamo/baked", `${id}.json`), "utf8");
const seeded = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

/** What is in the bank when everything has loaded: each clip's real length from its file, and the Samba. */
const ALL = new Map<string, number>([[SAMBA_CLIP, 4.4], ...IDLE_IDS.map((id) => [id, JSON.parse(baked(id)).dur as number] as const)]);

describe("how long a behaviour plays for", () => {
  it("is whole loops of the clip, between the time asked for and the cap, for every clip we ship (a fidget is played once, whole: see below)", () => {
    for (const [id, dur] of ALL) {
      if (IDLE_FILES.fidget.includes(id)) continue;
      const kind = IDLE_FILES.wave.includes(id) ? "wave" : IDLE_FILES.clap.includes(id) ? "clap" : "dance";
      const s = playSeconds(kind, dur);
      expect(s, id).toBeGreaterThanOrEqual(Math.min(IDLE_SECONDS[kind], dur));
      const cap = kind === "dance" ? IDLE_SECONDS.danceCap : IDLE_SECONDS[kind];
      // a clip at least as long as the cap is cut at it; a shorter one plays whole loops, which overshoots the time asked for by less than one loop
      if (dur >= cap) expect(s, id).toBe(cap);
      else { expect(s, id).toBeLessThan(IDLE_SECONDS[kind] + dur + 1e-9); expect(Math.abs(s / dur - Math.round(s / dur)), id).toBeLessThan(1e-9); }
    }
  });
  it("cuts a clip longer than the cap at the cap (the 21 second swing is nine seconds of it), and survives a length that is not a number", () => {
    expect(playSeconds("dance", 20.9)).toBe(IDLE_SECONDS.danceCap);
    for (const bad of [0, -1, NaN, Infinity]) expect(playSeconds("dance", bad)).toBe(IDLE_SECONDS.dance);
  });
  /** The rules for a fidget (a shrug, a yawn, a look around, thinking, being bored, an arm stretch), as a function of the play time, so a broken one can be run through them. */
  function fidgetFailures(play: (kind: "fidget", dur: number) => number): string[] {
    const bad = new Set<string>();
    for (const id of IDLE_FILES.fidget) {
      const dur = ALL.get(id)!;
      const s = play("fidget", dur);
      if (Math.abs(s - dur) > 1e-9) bad.add("a fidget is played once, whole: not looped, not cut short");
      if (s > IDLE_SECONDS.fidgetCap + 1e-9) bad.add("and never past the cap");
    }
    if (Math.abs(play("fidget", 2.0) - 2.0) > 1e-9) bad.add("a short fidget is not repeated to fill time");
    if (play("fidget", 30) !== IDLE_SECONDS.fidgetCap) bad.add("one longer than the cap is cut at it");
    for (const nan of [0, -1, NaN, Infinity]) { const s = play("fidget", nan); if (!(s > 0) || !Number.isFinite(s)) bad.add("a length that is not a number still gives a real time"); }
    return [...bad];
  }
  it("plays a fidget once, whole, up to the cap (the 10.7 s Bored included), and survives a length that is not a number", () => {
    expect(Math.max(...IDLE_FILES.fidget.map((id) => ALL.get(id)!))).toBeLessThanOrEqual(IDLE_SECONDS.fidgetCap); // none of ours is cut
    expect(fidgetFailures(playSeconds)).toEqual([]);
  });
  it("is caught when a fidget is looped like a wave, cut like a dance, or given no guard", () => {
    expect(fidgetFailures((_k, dur) => Math.ceil(IDLE_SECONDS.fidget / dur) * dur).length).toBeGreaterThan(0);              // whole loops to fill the time
    expect(fidgetFailures((_k, dur) => Math.min(dur, 4)).length).toBeGreaterThan(0);                                         // cut at a few seconds
    expect(fidgetFailures((_k, dur) => dur).length).toBeGreaterThan(0);                                                      // no cap, no guard
  });
});

describe("how long he stands still before an idle tick", () => {
  /** The rules, as a function of the gap, so a broken one can be run through them. Dan: "idle animations can be min 30 to 60 seconds or even minutes". */
  function failures(gap: (rng: () => number, chain: number) => number): string[] {
    const bad = new Set<string>();
    const rng = seeded(11);
    const first: number[] = [], later: number[] = [];
    for (let i = 0; i < 3000; i++) { first.push(gap(rng, 0)); later.push(gap(rng, 1 + (i % 5))); }
    if (Math.min(...first) < 30) bad.add("the first tick of a spell is never sooner than 30 s");
    if (Math.max(...first) > 60) bad.add("and never later than 60 s");
    if (Math.min(...later) < 45) bad.add("later ticks are never sooner than 45 s");
    if (Math.max(...later) > 120) bad.add("and never later than two minutes");
    const spread = (a: number[]) => Math.max(...a) - Math.min(...a);
    if (spread(first) < 20 || spread(later) < 50) bad.add("it is drawn each time: not the same wait over and over");
    if (!(first.reduce((a, b) => a + b) / first.length < later.reduce((a, b) => a + b) / later.length)) bad.add("the first wait is the shorter one");
    // the draw's two ends, and a draw that is out of range
    if (gap(() => 0, 0) !== 30 || gap(() => 0, 1) !== 45) bad.add("the shortest wait is exactly the lower bound");
    if (!(gap(() => 0.999999, 0) <= 60) || !(gap(() => 0.999999, 3) <= 120)) bad.add("the longest wait stays inside the upper bound");
    const inRange = (v: number, lo: number, hi: number) => v >= lo && v <= hi;
    if (!inRange(gap(() => 2, 0), 30, 60) || !inRange(gap(() => -1, 0), 30, 60) || !inRange(gap(() => NaN, 0), 30, 60)) bad.add("a draw outside 0 to 1, or not a number, cannot take it out of range");
    return [...bad];
  }
  it("is 30 to 60 s before the first tick and 45 to 120 s before each one after it, drawn each time", () => {
    expect(failures(idleGapSeconds)).toEqual([]);
    expect(IDLE_GAP_SECONDS.first[0]).toBeGreaterThanOrEqual(30);
  });
  it("is caught when the wait is the old 6.5 s, a fixed number, too long, or the same for every tick", () => {
    expect(failures(() => 6.5).length).toBeGreaterThan(0);
    expect(failures(() => 45).length).toBeGreaterThan(0);
    expect(failures((rng, chain) => 30 + rng() * 400 + chain).length).toBeGreaterThan(0);
    expect(failures((rng) => 30 + rng() * 30).length).toBeGreaterThan(0); // the first tick's wait for all of them: later ticks come too soon
    expect(failures((rng, chain) => (chain <= 0 ? 10 + rng() * 50 : 45 + rng() * 75)).length).toBeGreaterThan(0); // a first tick that can come after 10 s
    expect(failures((rng, chain) => { const d = rng(); return chain <= 0 ? 30 + d * 30 : 45 + d * 75; }).length).toBeGreaterThan(0); // no guard: NaN and out-of-range draws get through
  });
});

describe("what to do on an idle tick", () => {
  /** The rules, as a function of the chooser, so a broken one can be run through them. Returns what is wrong. */
  function failures(choose: (rng: () => number, chain: number, have: ReadonlyMap<string, number>) => IdleChoice | null): string[] {
    const bad = new Set<string>();
    const draws = (chain: number, have: ReadonlyMap<string, number>, n = 4000) => { const rng = seeded(7 + chain); const out: (IdleChoice | null)[] = []; for (let i = 0; i < n; i++) out.push(choose(rng, chain, have)); return out; };
    for (let chain = 0; chain < DANCE_FROM_TICK; chain++) if (draws(chain, ALL).some((c) => c?.kind === "dance")) bad.add("no dance before the tick it is offered from");
    const later = draws(DANCE_FROM_TICK, ALL);
    const share = (k: string) => later.filter((c) => c?.kind === k).length / later.length;
    if (Math.abs(share("dance") - IDLE_ODDS.dance) > 0.04) bad.add("a dance about as often as the odds say");
    if (Math.abs(share("wave") - IDLE_ODDS.wave) > 0.04) bad.add("a wave about as often as the odds say");
    if (Math.abs(share("clap") - IDLE_ODDS.clap) > 0.03) bad.add("a clap about as often as the odds say");
    if (Math.abs(share("fidget") - IDLE_ODDS.fidget) > 0.04) bad.add("a fidget about as often as the odds say");
    if (Math.abs(later.filter((c) => c === null).length / later.length - (1 - IDLE_ODDS.dance - IDLE_ODDS.wave - IDLE_ODDS.clap - IDLE_ODDS.fidget)) > 0.04) bad.add("the rest is left to the old gestures");
    // a fidget is quiet: it is offered from the very first tick, unlike a dance
    if (!draws(0, ALL).some((c) => c?.kind === "fidget")) bad.add("a fidget can come on the first tick");
    // only clips that are loaded
    const onlyWave = new Map([["react_wave", 0.53]]);
    for (const c of draws(5, onlyWave)) if (c && (c.clip !== "react_wave")) { bad.add("only a clip that is in the bank"); break; }
    if (draws(5, new Map()).some((c) => c !== null)) bad.add("nothing at all when nothing is loaded");
    // every dance is offered (variety), and each pick is a clip of its own kind
    const dances = new Set(later.filter((c) => c?.kind === "dance").map((c) => c!.clip));
    if (dances.size < 5) bad.add("every dance gets a turn");
    if (new Set(later.filter((c) => c?.kind === "fidget").map((c) => c!.clip)).size < IDLE_FILES.fidget.length) bad.add("every fidget gets a turn");
    for (const c of later) if (c && !(c.kind === "dance" ? [SAMBA_CLIP, ...IDLE_FILES.dance] : IDLE_FILES[c.kind]).includes(c.clip)) { bad.add("a pick belongs to its kind"); break; }
    for (const c of later) if (c && !(c.seconds > 0)) { bad.add("a positive time"); break; }
    return [...bad];
  }

  it("follows the rules: no dance before the second tick, the odds (wave, clap, dance, fidget), only loaded clips, every dance and every fidget gets a turn", () => {
    expect(failures(chooseIdle)).toEqual([]);
  });

  it("fails them on a chooser that dances at once, one that ignores what is loaded, and one that always picks the same dance (so the check can fail)", () => {
    const eager: typeof chooseIdle = (rng, _chain, have) => chooseIdle(rng, 99, have);
    const blind: typeof chooseIdle = (rng, chain) => chooseIdle(rng, chain, ALL);
    const samePick: typeof chooseIdle = (rng, chain, have) => { const c = chooseIdle(rng, chain, have); return c && c.kind === "dance" ? { ...c, clip: SAMBA_CLIP } : c; };
    expect(failures(eager).length).toBeGreaterThan(0);
    expect(failures(blind).length).toBeGreaterThan(0);
    expect(failures(samePick).length).toBeGreaterThan(0);
    const noFidgets: typeof chooseIdle = (rng, chain, have) => { const c = chooseIdle(rng, chain, have); return c && c.kind === "fidget" ? null : c; };
    const oneFidget: typeof chooseIdle = (rng, chain, have) => { const c = chooseIdle(rng, chain, have); return c && c.kind === "fidget" ? { ...c, clip: "mood_shrug", seconds: have.get("mood_shrug") ?? 2 } : c; };
    expect(failures(noFidgets).length).toBeGreaterThan(0);  // never fidgets
    expect(failures(oneFidget).length).toBeGreaterThan(0);  // always the same one
  });
});

describe("the files", () => {
  const fetchOf = (overrides: Record<string, string | number> = {}): typeof fetch => (async (url: string) => {
    const id = /\/([a-z0-9_]+)\.json$/.exec(String(url))![1]!;
    const o = overrides[id];
    if (typeof o === "number") return { ok: false, status: o, text: async () => "" } as unknown as Response;
    return { ok: true, status: 200, text: async () => (typeof o === "string" ? o : baked(id)) } as unknown as Response;
  }) as unknown as typeof fetch;

  it("loads every idle clip from the real baked files, with the bench's joint rotations and the planted flag, and reports their lengths", async () => {
    const bank: Record<string, BakedClip> = {};
    const lib = createGestureLibrary({ fetchImpl: fetchOf(), addClips: (c) => Object.assign(bank, c) });
    const ok = await lib.ensure();
    expect(ok.sort()).toEqual([...IDLE_IDS].sort());
    for (const id of IDLE_IDS) {
      expect(bank[id]!.joints, id).toBeTruthy();
      expect(bank[id]!.frames, id).toBeGreaterThan(5);
      expect(lib.durations().get(id), id).toBeCloseTo(bank[id]!.duration, 6);
    }
    expect(bank.dance_hiphop!.planted).toBe(true);
    expect(bank.react_wave!.joints!.elbowL.length).toBe(bank.react_wave!.frames * 4);
  });

  it("leaves out a file that is missing, one that is not JSON, one that is a different clip from its name, and one that is too big, and still loads the rest", async () => {
    const bank: Record<string, BakedClip> = {};
    const lib = createGestureLibrary({
      fetchImpl: fetchOf({ react_wave: 404, react_clap: "<html>not json", dance_silly: baked("dance_hiphop"), dance_swing: "x".repeat(900_001) }),
      addClips: (c) => Object.assign(bank, c),
    });
    const ok = await lib.ensure();
    expect(ok).not.toContain("react_wave");
    expect(ok).not.toContain("react_clap");
    expect(ok).not.toContain("dance_silly"); // dance_hiphop's bytes under dance_silly's name
    expect(ok).not.toContain("dance_swing");
    const rest = IDLE_IDS.filter((id) => !["react_wave", "react_clap", "dance_silly", "dance_swing"].includes(id)).sort();
    expect(rest).toContain("dance_locking"); expect(rest).toContain("mood_shrug"); expect(rest).toContain("move_arms");
    expect(ok.sort()).toEqual(rest);
    expect(Object.keys(bank).sort()).toEqual(rest);
  });
  it("takes the fidgets from their real files (the arm stretch from the movement break's `move` group, the others `react`), and refuses one whose file says a different group", async () => {
    const asGroup = (id: string, group: string) => JSON.stringify({ ...JSON.parse(baked(id)), group });
    const bank: Record<string, BakedClip> = {};
    const lib = createGestureLibrary({ fetchImpl: fetchOf({ mood_shrug: asGroup("mood_shrug", "dance"), move_arms: asGroup("move_arms", "react"), mood_yawn: baked("mood_shrug") }), addClips: (c) => Object.assign(bank, c) });
    const ok = await lib.ensure(IDLE_FILES.fidget);
    expect(ok.sort()).toEqual(["mood_bored", "mood_look", "mood_thinking"]); // shrug (said it was a dance), arm stretch (said it was react) and yawn (shrug's bytes) refused
    const all = createGestureLibrary({ fetchImpl: fetchOf(), addClips: () => {} });
    expect((await all.ensure(IDLE_FILES.fidget)).sort()).toEqual([...IDLE_FILES.fidget].sort());
  });

  it("will not fetch a name it does not know, and fetches a clip once however often it is asked for", async () => {
    let calls = 0;
    const f = ((url: string) => { calls++; return fetchOf()(url); }) as unknown as typeof fetch;
    const lib = createGestureLibrary({ fetchImpl: f, addClips: () => {} });
    expect(await lib.ensure(["../../etc/passwd", "act_push", "NOPE"])).toEqual([]);
    expect(calls).toBe(0);
    await Promise.all([lib.ensure(["react_wave"]), lib.ensure(["react_wave"]), lib.ensure(["react_wave"])]);
    await lib.ensure(["react_wave"]);
    expect(calls).toBe(1);
  });
});

/** A driver that is just enough of one: it remembers the beat source it was given and says what is busy. */
function fakeMix() {
  let source: BeatSource | null = null;
  let leaving = false;
  let label: string | undefined;
  const calls: string[] = [];
  const mix: IdleMix & { give(s: BeatSource | null): void; calls: string[] } = {
    startBeatSource(s, l) { source = s; label = l; leaving = false; calls.push("start"); return s() !== null; },
    stopBeatDance() { if (source) { leaving = true; calls.push("stop"); } },
    get busyAction() { return source && !leaving ? (label ?? "dance") : null; },
    get beatSourceFn() { return source && !leaving ? source : null; },
    give(s) { source = s; label = undefined; leaving = false; },
    calls,
  };
  return mix;
}
function controller(over: Partial<{ ok: boolean; rng: () => number; have: Map<string, number> }> = {}) {
  const mix = fakeMix();
  let now = 100, ok = over.ok ?? true, begins = 0;
  const idle = createIdle({ mix: () => mix, ok: () => ok, begin: () => { begins++; }, rng: over.rng ?? (() => 0.1), now: () => now, durations: () => over.have ?? ALL });
  return { idle, mix, tick: (s: number) => { now += s; idle.update(); }, setOk: (v: boolean) => { ok = v; }, get begins() { return begins; }, get now() { return now; } };
}

describe("the controller", () => {
  it("starts what it chose as a beat source on a clock of its own, calls begin, and ends it when its time is up", () => {
    const c = controller({ rng: () => 0.1 }); // 0.1 is inside the dance slice at the third tick
    expect(c.idle.tryStart(2)).toBe(true);
    expect(c.begins).toBe(1);
    expect(c.idle.active).toBe(true);
    const src = c.mix.beatSourceFn!;
    const t0 = src()!.time; expect(t0).toBeCloseTo(0, 6);
    c.tick(3);
    expect(src()!.time).toBeCloseTo(3, 6); // it runs from its own start, not from the world's clock
    c.tick(IDLE_SECONDS.danceCap + 1);
    expect(c.mix.calls).toContain("stop");
    expect(c.idle.active).toBe(false);
  });
  it("plays a fidget once, whole, from its own start (it can come on the first tick), and ends when the clip does: a shrug is two seconds, not nine", () => {
    // at the first tick the slices are wave .24, clap .34, fidget .54: 0.45 is a fidget, and the pick (second draw) is the shrug when it is the one the draw lands on
    const picks: number[] = [0.45, (IDLE_FILES.fidget.indexOf("mood_shrug") + 0.5) / IDLE_FILES.fidget.length];
    let i = 0;
    const c = controller({ rng: () => picks[i++ % 2]! });
    expect(c.idle.tryStart(0)).toBe(true);
    expect(c.idle.clip).toBe("mood_shrug");
    c.tick(1.5);
    expect(c.idle.active).toBe(true);
    c.tick(0.6); // 2.1 s in: the 2.0 s clip is over
    expect(c.mix.calls).toContain("stop");
    expect(c.idle.active).toBe(false);
  });
  it("says it is idle, not a dance, while it plays (so nothing mistakes an idle wave for a party), and the title's show too", () => {
    const c = controller();
    expect(c.idle.tryStart(2)).toBe(true);
    expect(c.mix.busyAction).toBe(IDLE_LABEL);
    expect(IDLE_LABEL).not.toBe("dance");
    c.idle.cancel(); c.tick(1);
    const show = controller();
    show.idle.startShow();
    expect(show.mix.busyAction).toBe(IDLE_LABEL);
  });
  it("does not start while anything else is dancing, while the character is not free, or while it is already doing something", () => {
    const busy = controller(); busy.mix.give(() => ({ name: "dance", time: 0 }));
    expect(busy.idle.tryStart(2)).toBe(false);
    const notFree = controller({ ok: false });
    expect(notFree.idle.tryStart(2)).toBe(false);
    const twice = controller(); expect(twice.idle.tryStart(2)).toBe(true); expect(twice.idle.tryStart(2)).toBe(false);
    expect(controller({ have: new Map() }).idle.tryStart(2)).toBe(false); // nothing loaded: leave it to the old gestures
  });
  it("ends at once when the character is no longer free (a walk, a tap, a mission)", () => {
    const c = controller();
    expect(c.idle.tryStart(2)).toBe(true);
    c.setOk(false);
    c.tick(0.1);
    expect(c.mix.calls).toContain("stop");
    expect(c.idle.active).toBe(false);
  });
  it("NEVER stops a dance that is not its own: when the party takes over, it lets go without touching the party's dance", () => {
    const c = controller();
    expect(c.idle.tryStart(2)).toBe(true);
    c.mix.give(() => ({ name: "dance_hiphop", time: 0 })); // the party replaced the beat source
    c.mix.calls.length = 0;
    c.tick(IDLE_SECONDS.danceCap + 5); // well past its time
    expect(c.mix.calls).toEqual([]);   // no stop
    expect(c.idle.active).toBe(false);
    expect(c.mix.busyAction).toBe("dance"); // the party's dance goes on
    c.idle.cancel();
    expect(c.mix.calls).toEqual([]);
  });
  it("cancel() ends its own behaviour", () => {
    const c = controller();
    c.idle.tryStart(2);
    c.idle.cancel();
    expect(c.mix.calls).toContain("stop");
    expect(c.idle.active).toBe(false);
  });
});

describe("the title screen's show", () => {
  it("plays a dance, then another, never the same twice running, and does not turn the character (no begin)", () => {
    const c = controller({ rng: seeded(3) });
    expect(c.idle.startShow()).toBe(true);
    expect(c.begins).toBe(0);
    expect(c.idle.showing).toBe(true);
    const src = c.mix.beatSourceFn!;
    const seen: string[] = [src()!.name];
    for (let i = 0; i < 40; i++) { c.tick(3); const n = src()!.name; if (n !== seen[seen.length - 1]) seen.push(n); }
    expect(seen.length).toBeGreaterThan(4);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1]);
    expect(new Set(seen).size).toBeGreaterThan(3); // variety
    expect(c.idle.showing).toBe(true); // it runs on until it is stopped
  });
  it("starts with the Samba (always there) when nothing else has loaded yet, and picks up the others as they load", () => {
    const have = new Map<string, number>([[SAMBA_CLIP, 4.4]]);
    const c = controller({ rng: seeded(9), have });
    c.idle.startShow();
    const src = c.mix.beatSourceFn!;
    expect(src()!.name).toBe(SAMBA_CLIP);
    have.set("dance_hiphop", 4.7); have.set("dance_silly", 3.8);
    const names = new Set<string>();
    for (let i = 0; i < 30; i++) { c.tick(3); names.add(src()!.name); }
    expect(names.has("dance_hiphop") || names.has("dance_silly")).toBe(true);
  });
  it("stopShow() ends it, and leaves the party's dance alone if the party has taken over", () => {
    const a = controller(); a.idle.startShow(); a.idle.stopShow();
    expect(a.mix.calls).toContain("stop"); expect(a.idle.showing).toBe(false);
    const b = controller(); b.idle.startShow(); b.mix.give(() => ({ name: "dance_swing", time: 0 })); b.mix.calls.length = 0;
    b.idle.stopShow();
    expect(b.mix.calls).toEqual([]); expect(b.mix.busyAction).toBe("dance");
  });
  it("will not start over another dance, and will not start with nothing to play", () => {
    const busy = controller(); busy.mix.give(() => ({ name: "dance", time: 0 }));
    expect(busy.idle.startShow()).toBe(false);
    expect(controller({ have: new Map() }).idle.startShow()).toBe(false);
  });
});
