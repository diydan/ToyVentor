import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { beforeAll, describe, expect, it } from "vitest";
import { GAME_DANCES, GAME_PARTY_SECONDS, SAMBA_HIT_S, createGameParty, type GamePartyHost } from "../src/features/game/world/runtime/gameParty";
import { SAMBA, type GameDance } from "../src/features/game/world/runtime/gameDances";
import type { BeatSource } from "../src/features/game/world/runtime/mixamo";
import { MixamoDriver, loadMixamoBank, type ClipBank } from "../src/features/game/world/runtime/mixamo";
import { stockCol, stockSel } from "../src/features/game/world/runtime/catalog";
import { buildToy } from "../src/features/game/world/runtime/playerRig";

const ROOT = process.cwd();
function diskParser(url: string) {
  const buf = readFileSync(resolve(ROOT, "public", url.replace(/^\//, "")));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }>((res, rej) => new GLTFLoader().parse(ab, "", (g) => res(g), rej));
}
let bank: ClipBank;
beforeAll(async () => { bank = await loadMixamoBank(diskParser); });

describe("the Samba, counted (the numbers the party dances to)", () => {
  const dance = GAME_DANCES[0]!;
  it("is eight beats in its loop at the counted tempo, and that is the clip's whole length", () => {
    expect(dance).toMatchObject({ id: "dance", beats: 8, group: "dance" });
    expect(bank.dance!.duration).toBeCloseTo(dance.beats * (60 / dance.bpm), 1);
  });
  it("bounces its hips once per beat: eight lowest points in the loop, about a beat apart", () => {
    const c = bank.dance!;
    const fps = c.frames / c.duration;
    const hy = Array.from({ length: c.frames }, (_, i) => c.hips[i * 3 + 1]!);
    const lows: number[] = [];
    for (let i = 0; i < c.frames; i++) {
      const a = hy[(i - 1 + c.frames) % c.frames]!, b = hy[i]!, d = hy[(i + 1) % c.frames]!;
      if (b < a && b <= d && b < (Math.max(...hy) + Math.min(...hy)) / 2) lows.push(i / fps);
    }
    expect(lows.length).toBeGreaterThanOrEqual(8);
    expect(lows.length).toBeLessThanOrEqual(9);
  });
  it("is lowest, on average, where the party puts the beat (SAMBA_HIT_S, within a tenth of a beat)", () => {
    const c = bank.dance!;
    const beat = 60 / GAME_DANCES[0]!.bpm;
    const fps = c.frames / c.duration;
    const hy = Array.from({ length: c.frames }, (_, i) => c.hips[i * 3 + 1]!);
    const phases: number[] = [];
    for (let i = 1; i < c.frames - 1; i++) {
      if (hy[i]! < hy[i - 1]! && hy[i]! <= hy[i + 1]! && hy[i]! < (Math.max(...hy) + Math.min(...hy)) / 2) phases.push((i / fps) % beat);
    }
    const mean = phases.reduce((x, y) => x + y, 0) / phases.length;
    expect(Math.abs(mean - SAMBA_HIT_S)).toBeLessThan(0.1 * beat);
  });
});

describe("MixamoDriver beat dance (follows a song's clock)", () => {
  const rigOf = () => {
    const rig = buildToy("character", stockSel().character as never, stockCol());
    rig.arms.length = 0;
    rig.arms.push(new THREE.Group(), new THREE.Group());
    rig.head = new THREE.Group();
    return rig;
  };
  const armDir = (rig: ReturnType<typeof rigOf>) => new THREE.Vector3(0, -1, 0).applyQuaternion(rig.arms[0]!.quaternion);

  it("starts, reports itself as the dance (so the camera push and the face-the-camera turn apply), and refuses a one-frame pose", () => {
    const d = new MixamoDriver(bank);
    expect(d.startBeatDance("sad", () => 0)).toBe(false);
    expect(d.beatDancing).toBe(false);
    expect(d.startBeatDance("dance", () => 0)).toBe(true);
    expect(d.beatDancing).toBe(true);
    expect(d.busyAction).toBe("dance");
  });
  it("samples the clip at the time it is told, every frame: the same time is the same pose, another time is another", () => {
    const rig = rigOf();
    const d = new MixamoDriver(bank);
    let t = 0.3;
    d.startBeatDance("dance", () => t);
    for (let i = 0; i < 40; i++) d.update(rig, 1 / 30, 0); // eased in
    const a = armDir(rig).clone();
    d.update(rig, 1 / 60, 0);
    expect(armDir(rig).distanceTo(a)).toBeLessThan(1e-6);
    t = 1.6;
    d.update(rig, 1 / 60, 0);
    expect(armDir(rig).distanceTo(a)).toBeGreaterThan(0.05);
  });
  it("is the same pose one whole clip later: it loops, it does not run out", () => {
    const rig = rigOf();
    const d = new MixamoDriver(bank);
    let t = 0.7;
    d.startBeatDance("dance", () => t);
    for (let i = 0; i < 40; i++) d.update(rig, 1 / 30, 0);
    const a = armDir(rig).clone();
    t = 0.7 + bank.dance!.duration;
    d.update(rig, 1 / 60, 0);
    expect(armDir(rig).distanceTo(a)).toBeLessThan(0.02);
  });
  it("eases out when stopped, and the toy is idle again afterwards; it ignores a clock that is not a number", () => {
    const rig = rigOf();
    const d = new MixamoDriver(bank);
    d.startBeatDance("dance", () => NaN);
    for (let i = 0; i < 20; i++) d.update(rig, 1 / 30, 0);
    expect(d.busyAction).toBe("dance");
    d.stopBeatDance();
    expect(d.beatDancing).toBe(false);
    expect(d.busyAction).toBeNull();
    for (let i = 0; i < 30; i++) d.update(rig, 1 / 30, 0);
    d.stopBeatDance(); // safe twice, and when nothing is on
    expect(armDir(rig).y).toBeLessThan(-0.9); // arms hanging again
  });
  it("walking pulls the toy out of the dance (the song goes on), and a one-shot gesture replaces nothing it owns", () => {
    const rig = rigOf();
    const d = new MixamoDriver(bank);
    let t = 0.6;
    d.startBeatDance("dance", () => t);
    for (let i = 0; i < 40; i++) d.update(rig, 1 / 30, 0);
    const standing = armDir(rig).clone();
    const d2 = new MixamoDriver(bank);
    const rig2 = rigOf();
    d2.startBeatDance("dance", () => t);
    for (let i = 0; i < 40; i++) d2.update(rig2, 1 / 30, 3);
    expect(armDir(rig2).distanceTo(standing)).toBeGreaterThan(0.05);
  });
});

// ---- the party, on fakes ------------------------------------------------------------------------------------------------------------------------
const SONG_BPM = 106.2917;
const ENTRY = { id: "my_170010186285057", title: "Stompy Big Buddy", mood: "bouncy", file: "my_170010186285057.mp3", bytes: 1_579_093, dur: 60 * 76 / SONG_BPM, bpm: SONG_BPM, beats: 76, bars: 19, offset: 0.02, loop: true, ai: true };

const HIPHOP: GameDance = { id: "dance_hiphop", bpm: 101.41, beats: 8, group: "dance", label: "Hip Hop", hit: 0.279, loaded: false };
const SILLY: GameDance = { id: "dance_silly", bpm: 125.22, beats: 8, group: "dance", label: "Silly Dance", hit: 0.423, loaded: false };
const SWING: GameDance = { id: "dance_swing", bpm: 137.8, beats: 48, group: "dance", label: "Swing", hit: 0, loaded: false };

function fakes(over: Partial<GamePartyHost> & { decode?: () => Promise<unknown>; noCtx?: boolean; known?: GameDance[]; failLoad?: string[] } = {}) {
  const log: string[] = [];
  const asked: string[][] = [];
  const timers: Array<{ fn: () => void; ms: number; id: number }> = [];
  const source = { buffer: null as unknown, loop: false, loopStart: 0, loopEnd: 0, startedAt: -1, offset: -1, starts: 0, stopped: false, connect: () => {}, disconnect: () => {}, start(at: number, offset?: number) { source.startedAt = at; source.offset = offset ?? 0; source.starts++; source.stopped = false; }, stop() { source.stopped = true; } };
  const gain = { gain: { value: 0, setTargetAtTime: () => {} }, connect: () => {}, disconnect: () => {} };
  const ctx = { currentTime: 5, baseLatency: 0, outputLatency: 0, destination: {}, decodeAudioData: over.decode ?? (async () => ({ duration: ENTRY.dur })), createBufferSource: () => source, createGain: () => gain };
  const known: GameDance[] = (over.known ?? [SAMBA]).map((d) => ({ ...d }));
  let src: BeatSource | null = null;
  const host: GamePartyHost = {
    ctx: () => (over.noCtx ? null : (ctx as unknown as AudioContext)),
    prepare: async () => { log.push("prepare"); },
    dances: () => known,
    ensureDances: async (ids) => {
      asked.push([...ids]);
      const ok = ids.filter((id) => known.some((d) => d.id === id) && !(over.failLoad ?? []).includes(id));
      for (const d of known) if (ok.includes(d.id)) d.loaded = true;
      return ok;
    },
    startDance: (s) => { src = s; log.push("startDance"); return true; },
    stopDance: () => { log.push("stopDance"); },
    duckMusic: (on) => { log.push(on ? "duck" : "unduck"); },
    setTimeout: (fn, ms) => { timers.push({ fn, ms, id: timers.length + 1 }); return timers.length; },
    clearTimeout: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    perfNow: () => 0,
    ...over,
  };
  /** The song clock is the audio clock: set `currentTime` to song time `t` and ask what the dance is told. */
  const at = (t: number) => { ctx.currentTime = source.startedAt + t; return src!(); };
  return { host, log, asked, timers, source, ctx, at, time: () => src!()!.time, name: () => src!()!.name };
}
const song = (entry: unknown = ENTRY) => ({ entry, wav: new ArrayBuffer(16) });

describe("the game party", () => {
  it("starts a valid song: music ducked, the song looped on its own length, the character dancing", async () => {
    const f = fakes();
    const party = createGameParty(f.host);
    const r = await party.start(song());
    expect(r).toMatchObject({ ok: true, dancing: true, title: "Stompy Big Buddy" });
    expect(f.log).toEqual(["prepare", "duck", "startDance"]);
    expect(f.source.loop).toBe(true);
    expect(f.source.loopEnd).toBeCloseTo(ENTRY.dur, 6);
    expect(f.source.startedAt).toBeGreaterThan(5);
    expect(party.state()).toMatchObject({ on: true, dancing: true, ended: "" });
  });
  it("locks the dance to the song's BEATS: the same point of the dance on every 8th beat, one beat's worth further on each beat between", async () => {
    const f = fakes();
    await createGameParty(f.host).start(song());
    const interval = 60 / SONG_BPM;
    const startedAt = f.source.startedAt;
    const at = (beat: number) => { f.ctx.currentTime = startedAt + ENTRY.offset + beat * interval; return f.time(); };
    const dur = GAME_DANCES[0]!.beats * (60 / GAME_DANCES[0]!.bpm);
    expect(at(0)).toBeCloseTo(SAMBA_HIT_S, 6);
    expect(at(8)).toBeCloseTo(at(0), 6);
    expect(at(8 * 5)).toBeCloseTo(at(0), 6); // no drift over many loops of the dance
    expect(at(3)).toBeCloseTo((SAMBA_HIT_S + 3 * (60 / GAME_DANCES[0]!.bpm)) % dur, 6);
    expect(at(1) - at(0)).toBeCloseTo(60 / GAME_DANCES[0]!.bpm, 6);
  });
  it("the dance speed follows the SONG: a faster song moves through the dance faster", async () => {
    const f = fakes();
    await createGameParty(f.host).start(song({ ...ENTRY, bpm: 120, dur: (60 * 76) / 120 }));
    const startedAt = f.source.startedAt;
    f.ctx.currentTime = startedAt + 0.02;
    const t0 = f.time();
    f.ctx.currentTime = startedAt + 0.02 + 1; // one second later: 2 beats at 120 bpm
    const t1 = f.time();
    expect(t1 - t0).toBeCloseTo(2 * (60 / GAME_DANCES[0]!.bpm), 6);
  });
  it("a tempo no dance fits is music only: the song plays, the character does not dance, and it says so", async () => {
    const f = fakes();
    const r = await createGameParty(f.host).start(song({ ...ENTRY, bpm: 160, dur: (60 * 76) / 160 }));
    expect(r).toMatchObject({ ok: true, dancing: false });
    expect(f.log).toEqual(["prepare", "duck"]);
  });
  it("is music only when the character cannot dance (reduced motion, no rig)", async () => {
    const f = fakes({ startDance: () => false });
    const r = await createGameParty(f.host).start(song());
    expect(r).toMatchObject({ ok: true, dancing: false });
  });
  it("refuses a song that is not one a party can follow, before any audio is made", async () => {
    const f = fakes();
    for (const bad of [{ ...ENTRY, ai: false }, { ...ENTRY, bpm: 30 }, { ...ENTRY, file: "../x.mp3" }, { ...ENTRY, beats: 77, bars: 19.25 }, null, "x"]) {
      const r = await createGameParty(f.host).start(song(bad));
      expect(r.ok).toBe(false);
    }
    expect(f.log).toEqual([]);
  });
  it("refuses with no audio yet (a tap is needed first), and a decode failure leaves the game as it was", async () => {
    const a = fakes({ noCtx: true });
    expect(await createGameParty(a.host).start(song())).toMatchObject({ ok: false });
    const b = fakes({ decode: async () => { throw new Error("EncodingError"); } });
    const party = createGameParty(b.host);
    const r = await party.start(song());
    expect(r).toMatchObject({ ok: false });
    expect((r as { reason: string }).reason).toMatch(/could not be played/);
    expect(party.state().on).toBe(false);
    expect(b.log.at(-1)).toBe("unduck");
    expect(b.log).not.toContain("startDance");
  });
  it("one party at a time", async () => {
    const f = fakes();
    const party = createGameParty(f.host);
    await party.start(song());
    expect(await party.start(song())).toMatchObject({ ok: false });
  });
  it("stop ends it: the song fades and stops, the dance is released, the world's music comes back, and it can be stopped twice", async () => {
    const f = fakes();
    const party = createGameParty(f.host);
    await party.start(song());
    party.stop();
    expect(f.source.stopped).toBe(true);
    expect(f.log).toEqual(["prepare", "duck", "startDance", "stopDance", "unduck"]);
    expect(party.state()).toMatchObject({ on: false, ended: "stopped", dancing: false });
    party.stop();
    expect(f.log).toHaveLength(5);
  });
  it("ends by itself after its time", async () => {
    const f = fakes();
    const party = createGameParty(f.host);
    await party.start(song());
    const t = f.timers.find((x) => x.ms === GAME_PARTY_SECONDS * 1000);
    expect(t).toBeTruthy();
    t!.fn();
    expect(party.state()).toMatchObject({ on: false, ended: "time" });
    expect(f.log.at(-1)).toBe("unduck");
  });
  it("tells the page once when a party that was on ends, with the reason, and not for a party that never began", async () => {
    const ends: string[] = [];
    const f = fakes({ onEnd: (r) => ends.push(r) });
    const party = createGameParty(f.host);
    party.stop(); // nothing on
    await party.start(song());
    party.stop();
    party.stop();
    expect(ends).toEqual(["stopped"]);
    const bad = fakes({ onEnd: (r) => ends.push(r), decode: async () => { throw new Error("x"); } });
    await createGameParty(bad.host).start(song());
    expect(ends).toEqual(["stopped", "error"]);
  });
  it("can start again after it has ended", async () => {
    const f = fakes();
    const party = createGameParty(f.host);
    await party.start(song());
    party.stop();
    expect(await party.start(song())).toMatchObject({ ok: true });
  });
});

// ---- dance variety: the mix of every dance that fits the song's tempo -------------------------------------------------------------------------------------
describe("pause and play (the dock's transport)", () => {
  /** A party with a clock the test moves: `clock` is the page clock in ms, `ctx.currentTime` the audio clock in seconds. */
  async function running() {
    const clock = { ms: 0 };
    const f = fakes({ perfNow: () => clock.ms });
    const ends: string[] = [];
    const party = createGameParty({ ...f.host, onEnd: (r) => ends.push(r) });
    await party.start(song());
    const t0 = f.source.startedAt; // song time 0 sounds here on the audio clock
    return { f, party, clock, ends, t0 };
  }
  it("pause holds the song where it was: the sound stops, the dancer stands still, the song time stops counting, the world's music stays ducked", async () => {
    const { f, party, t0 } = await running();
    f.ctx.currentTime = t0 + 3;
    expect(party.pause()).toBe(true);
    expect(f.source.stopped).toBe(true);
    expect(f.log).toEqual(["prepare", "duck", "startDance", "stopDance"]);
    expect(party.state()).toMatchObject({ on: true, paused: true });
    expect(party.state().songTime).toBeCloseTo(3, 6);
    f.ctx.currentTime = t0 + 90; // a long wait: the song time does not move
    expect(party.state().songTime).toBeCloseTo(3, 6);
    expect(party.state().loopSeconds).toBeCloseTo(ENTRY.dur, 6);
  });
  it("play carries on from the same spot of the song: it starts at the held offset and the song time continues from it", async () => {
    const { f, party } = await running();
    f.ctx.currentTime = f.source.startedAt + 3;
    party.pause();
    f.ctx.currentTime = 100;
    expect(party.resume()).toBe(true);
    expect(f.source.stopped).toBe(false);
    expect(f.source.offset).toBeCloseTo(3, 6);
    expect(f.source.startedAt).toBeCloseTo(100.12, 6);
    expect(f.log.filter((x) => x === "startDance")).toHaveLength(2); // the dance is handed back the same clock
    expect(party.state()).toMatchObject({ on: true, paused: false });
    f.ctx.currentTime = 100.12 + 1; // one second after the sound began
    expect(party.state().songTime).toBeCloseTo(4, 6);
  });
  it("a pause after the song has looped resumes at the right place in the loop, and the song time keeps counting across loops", async () => {
    const { f, party, t0 } = await running();
    f.ctx.currentTime = t0 + ENTRY.dur * 2 + 2; // two loops and two seconds in
    party.pause();
    f.ctx.currentTime = 500;
    party.resume();
    expect(f.source.offset).toBeCloseTo(2, 5);
    f.ctx.currentTime = 500.12;
    expect(party.state().songTime).toBeCloseTo(ENTRY.dur * 2 + 2, 5);
  });
  it("the party's time limit holds while paused: what is left carries on after play", async () => {
    const { f, party, clock, t0 } = await running();
    clock.ms = 40_000;
    f.ctx.currentTime = t0 + 40;
    party.pause();
    expect(f.timers.find((x) => x.ms === GAME_PARTY_SECONDS * 1000)).toBeUndefined(); // the limit's timer is gone
    clock.ms = 400_000; // the child wandered off for a while
    party.resume();
    expect(f.timers.some((x) => x.ms === GAME_PARTY_SECONDS * 1000 - 40_000)).toBe(true);
  });
  it("stop works while paused: it ends the party once, un-ducks the music, and there is nothing left to play", async () => {
    const { f, party, ends } = await running();
    party.pause();
    party.stop();
    expect(ends).toEqual(["stopped"]);
    expect(f.log.at(-1)).toBe("unduck");
    expect(party.state()).toMatchObject({ on: false, paused: false, ended: "stopped", loopSeconds: 0 });
    expect(party.resume()).toBe(false);
  });
  it("says no when there is nothing to pause, or nothing paused", async () => {
    const f = fakes();
    const party = createGameParty(f.host);
    expect(party.pause()).toBe(false);
    expect(party.resume()).toBe(false);
    await party.start(song());
    expect(party.resume()).toBe(false); // playing, not paused
    expect(party.pause()).toBe(true);
    expect(party.pause()).toBe(false); // already paused
  });
  it("a music-only party (no dance fits) pauses and plays too, without asking the character to stop or start", async () => {
    const f = fakes();
    const party = createGameParty(f.host);
    await party.start(song({ ...ENTRY, bpm: 160, dur: (60 * 76) / 160 })); // a tempo no dance fits
    f.log.length = 0;
    party.pause();
    party.resume();
    expect(f.log).toEqual([]);
    expect(party.state().paused).toBe(false);
  });
});

describe("the dance mix", () => {
  const ALL = [SAMBA, HIPHOP, SILLY, SWING];
  it("asks for every dance that fits the tempo, the one nearest its natural speed first, and starts on that one", async () => {
    const f = fakes({ known: ALL });
    await createGameParty(f.host).start(song()); // 106.29 bpm: Samba (109) is nearest, then Hip Hop (101) and Silly (125); Swing (138) is 30% fast and does not fit
    expect(f.asked).toEqual([["dance", "dance_hiphop", "dance_silly"]]);
    f.at(0.02);
    expect(f.name()).toBe("dance");
    expect(f.ctx.currentTime).toBeGreaterThan(5);
  });
  it("takes turns every 16 beats, on the bar line: Samba, Hip Hop, Silly, then round again; never one dance twice in a row", async () => {
    const f = fakes({ known: ALL });
    await createGameParty(f.host).start(song());
    const iv = 60 / SONG_BPM;
    const nameAt = (beat: number) => f.at(ENTRY.offset + (beat + 0.01) * iv)!.name;
    const seq = [0, 8, 15.9, 16, 24, 31.9, 32, 40, 47.9, 48, 64].map(nameAt);
    expect(seq).toEqual(["dance", "dance", "dance", "dance_hiphop", "dance_hiphop", "dance_hiphop", "dance_silly", "dance_silly", "dance_silly", "dance", "dance_hiphop"]);
  });
  it("shifts each dance by where ITS weight lands, and locks it to the song's beats at its own authored tempo", async () => {
    const f = fakes({ known: ALL });
    await createGameParty(f.host).start(song());
    const iv = 60 / SONG_BPM;
    // 16 beats in: Hip Hop, 8 beats to its loop, authored at 101.41 bpm
    const e = 0.001;                                           // just past the bar line (a float is not exactly on it)
    const x = f.at(ENTRY.offset + (16 + e) * iv)!;
    expect(x.name).toBe("dance_hiphop");
    expect(x.time).toBeCloseTo(0.279 + e * (60 / HIPHOP.bpm), 3); // beat 0 of the dance: its hit offset
    const y = f.at(ENTRY.offset + (19 + e) * iv)!;            // three beats later
    expect(y.time).toBeCloseTo((0.279 + (3 + e) * (60 / HIPHOP.bpm)) % (8 * (60 / HIPHOP.bpm)), 3);
    const z = f.at(ENTRY.offset + (32 + e) * iv)!;            // Silly
    expect(z.name).toBe("dance_silly");
    expect(z.time).toBeCloseTo(0.423 + e * (60 / SILLY.bpm), 3);
  });
  it("a dance that fails to load is left out of the mix, and the party goes on with the rest", async () => {
    const f = fakes({ known: ALL, failLoad: ["dance_hiphop"] });
    await createGameParty(f.host).start(song());
    const iv = 60 / SONG_BPM;
    const names = [0, 16, 32, 48].map((b) => f.at(ENTRY.offset + (b + 0.01) * iv)!.name);
    expect(names).toEqual(["dance", "dance_silly", "dance", "dance_silly"]);
  });
  it("with none of the others loadable the Samba dances alone, and nothing is mixed", async () => {
    const f = fakes({ known: ALL, failLoad: ["dance_hiphop", "dance_silly"] });
    const r = await createGameParty(f.host).start(song());
    expect(r).toMatchObject({ ok: true, dancing: true });
    const iv = 60 / SONG_BPM;
    expect([0, 16, 32].map((b) => f.at(ENTRY.offset + (b + 0.01) * iv)!.name)).toEqual(["dance", "dance", "dance"]);
  });
  it("a faster song picks the dances that fit IT: at 130 bpm Hip Hop is out (28% fast), and the nearest natural speed leads: Silly, then Swing, then the Samba", async () => {
    const f = fakes({ known: ALL });
    await createGameParty(f.host).start(song({ ...ENTRY, bpm: 130, dur: (60 * 76) / 130 }));
    expect(f.asked[0]).toEqual(["dance_silly", "dance_swing", "dance"]); // 125, 138, 109 against 130
    expect(f.at(0.02)!.name).toBe("dance_silly");
  });
  it("a tempo only one dance fits is that one dance, with no mix", async () => {
    const f = fakes({ known: ALL });
    await createGameParty(f.host).start(song({ ...ENTRY, bpm: 160, dur: (60 * 76) / 160 }));
    expect(f.asked[0]).toEqual(["dance_swing"]); // 160 / 137.8 = 1.16: only Swing is within a quarter
    const iv = 60 / 160;
    expect([0, 16, 32].map((b) => f.at(ENTRY.offset + (b + 0.01) * iv)!.name)).toEqual(["dance_swing", "dance_swing", "dance_swing"]);
  });
  it("the index failing to load, or loading nothing, leaves the Samba: a party never depends on the extras", async () => {
    const f = fakes({ known: [SAMBA], prepare: async () => { throw new Error("offline"); } });
    expect(await createGameParty(f.host).start(song())).toMatchObject({ ok: true, dancing: true });
    expect(f.at(0.02)!.name).toBe("dance");
  });
  it("a party stopped while its dances load starts nothing", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const f = fakes({ known: ALL, prepare: async () => { await gate; } });
    const party = createGameParty(f.host);
    const started = party.start(song());
    party.stop("stopped");
    release();
    expect(await started).toMatchObject({ ok: false });
    expect(f.log).not.toContain("startDance");
    expect(f.source.startedAt).toBe(-1);
  });
});
