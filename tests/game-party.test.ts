import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { beforeAll, describe, expect, it } from "vitest";
import { GAME_DANCES, GAME_PARTY_SECONDS, SAMBA_HIT_S, createGameParty, type GamePartyHost } from "../src/features/game/world/runtime/gameParty";
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

function fakes(over: Partial<GamePartyHost> & { decode?: () => Promise<unknown>; noCtx?: boolean } = {}) {
  const log: string[] = [];
  const timers: Array<{ fn: () => void; ms: number; id: number }> = [];
  const source = { buffer: null as unknown, loop: false, loopStart: 0, loopEnd: 0, startedAt: -1, stopped: false, connect: () => {}, disconnect: () => {}, start(at: number) { source.startedAt = at; }, stop() { source.stopped = true; } };
  const gain = { gain: { value: 0, setTargetAtTime: () => {} }, connect: () => {}, disconnect: () => {} };
  const ctx = { currentTime: 5, baseLatency: 0, outputLatency: 0, destination: {}, decodeAudioData: over.decode ?? (async () => ({ duration: ENTRY.dur })), createBufferSource: () => source, createGain: () => gain };
  let times: (() => number) | null = null;
  const host: GamePartyHost = {
    ctx: () => (over.noCtx ? null : (ctx as unknown as AudioContext)),
    startDance: (time) => { times = time; log.push("startDance"); return true; },
    stopDance: () => { log.push("stopDance"); },
    duckMusic: (on) => { log.push(on ? "duck" : "unduck"); },
    setTimeout: (fn, ms) => { timers.push({ fn, ms, id: timers.length + 1 }); return timers.length; },
    clearTimeout: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    perfNow: () => 0,
    ...over,
  };
  return { host, log, timers, source, ctx, time: () => times!() };
}
const song = (entry: unknown = ENTRY) => ({ entry, wav: new ArrayBuffer(16) });

describe("the game party", () => {
  it("starts a valid song: music ducked, the song looped on its own length, the character dancing", async () => {
    const f = fakes();
    const party = createGameParty(f.host);
    const r = await party.start(song());
    expect(r).toMatchObject({ ok: true, dancing: true, title: "Stompy Big Buddy" });
    expect(f.log).toEqual(["duck", "startDance"]);
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
    expect(f.log).toEqual(["duck"]);
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
    expect(f.log).toEqual(["duck", "startDance", "stopDance", "unduck"]);
    expect(party.state()).toMatchObject({ on: false, ended: "stopped", dancing: false });
    party.stop();
    expect(f.log).toHaveLength(4);
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
