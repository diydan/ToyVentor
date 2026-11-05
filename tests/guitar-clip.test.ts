// The Mixamo guitar clip as the game loads it (runtime/guitarClip.ts), the link to the animation driver (guitarArm.ts) and the guitar held in two ways (heldItems.ts): a joint-data clip checked and converted
// like the other Mixamo moves, its strokes found from its own beats, and every one of the failure paths (the file is LOCAL ONLY and may be absent from a checkout or a deploy) leaving the game as it was.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jointClipToGame, parseJointClip } from "../src/features/game/world/runtime/bakedDance";
import { GUITAR_CLIP, GUITAR_FILE, armSpecFor, forgetGuitarClip, guitarArmSpec, loadGuitarClip } from "../src/features/game/world/runtime/guitarClip";
import { GUITAR_LABEL, createGuitarArm, type GuitarArmHost } from "../src/features/game/world/runtime/guitarArm";
import { FRONT_TILT, FRONT_YAW, HELD, followHandsMesh, placeHeldMesh } from "../src/features/game/world/runtime/heldItems";
import { HELD_GUITAR_SCALE } from "../src/features/game/world/runtime/guitar";
import { createArmSweep } from "../src/features/game/world/runtime/guitarPlay";
import { CLIP_JOINT_KEYS, type BeatSource } from "../src/features/game/world/runtime/mixamo";

const BAKED = join(process.cwd(), "public/kip/mixamo/baked");
const HAVE_REAL = existsSync(join(BAKED, `${GUITAR_FILE}.json`));
const NAMES = ["Hips", "Head", "LeftArm", "LeftForeArm", "LeftHand", "RightArm", "RightForeArm", "RightHand", "LeftUpLeg", "LeftLeg", "LeftFoot", "RightUpLeg", "RightLeg", "RightFoot"];

function jointFile(over: Record<string, unknown> = {}, beats = 8, dur = 4, fps = 30) {
  const frames = Math.round(dur * fps) + 1;
  const q: Record<string, number[]> = {};
  for (const n of NAMES) q[n] = Array.from({ length: frames }, () => [0, 0, 0, 1]).flat();
  // the hips dip twice a beat, on the beat's start (a low point at every half-beat)
  const hips = Array.from({ length: frames }, (_, i) => [0, 60 + 2 * Math.cos(((i / fps) / (dur / beats)) * Math.PI * 4), 0]).flat();
  return { v: 1, id: GUITAR_FILE, label: "Guitar Strum", group: "music", source: "test", planted: true, fps, frames, dur: (frames - 1) / fps, hips, q, beats, bpm: 100, ...over };
}
const fetchOf = (body: unknown, ok = true) => (async () => ({ ok, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) })) as unknown as typeof fetch;

afterEach(() => forgetGuitarClip());

describe("loading the clip", () => {
  it("fetches music_guitar.json, checks it, converts it to a looping joint clip named `guitar` and puts it in the bank", async () => {
    const bank: Record<string, any> = {};
    let url = "";
    const r = await loadGuitarClip({ fetchImpl: (async (u: string) => { url = u; return { ok: true, text: async () => JSON.stringify(jointFile()) }; }) as unknown as typeof fetch, addClips: (c) => Object.assign(bank, c) });
    expect(url).toBe("/kip/mixamo/baked/music_guitar.json");
    expect(r.loaded).toBe(true);
    expect(r.beatS).toBeCloseTo(0.5, 6);
    expect(Object.keys(bank)).toEqual([GUITAR_CLIP]);
    const c = bank[GUITAR_CLIP];
    expect(c.name).toBe("guitar");
    expect(c.loop).toBe(true);
    expect(c.planted).toBe(true);
    for (const k of CLIP_JOINT_KEYS) expect(c.joints[k]).toBeInstanceOf(Float32Array);        // the Snap rig bends its elbows from these
  });
  it("a custom base folder is used (with or without the trailing slash)", async () => {
    const seen: string[] = [];
    const f = (async (u: string) => { seen.push(u); return { ok: false, text: async () => "" }; }) as unknown as typeof fetch;
    await loadGuitarClip({ fetchImpl: f, addClips: () => {}, base: "/x/y" });
    await loadGuitarClip({ fetchImpl: f, addClips: () => {}, base: "/x/y///" });
    expect(seen).toEqual(["/x/y/music_guitar.json", "/x/y/music_guitar.json"]);
  });
  it("leaves the bank alone when the file is missing, refused, not JSON, the wrong file, oversized, unreadable or the network is down", async () => {
    const huge = "x".repeat(900_001);
    const bad: Array<[string, typeof fetch]> = [
      ["404", fetchOf("nope", false)], ["not json", fetchOf("{ nope")], ["empty object", fetchOf({})], ["wrong id", fetchOf(jointFile({ id: "dance_silly" }))],
      ["a joint missing", fetchOf((() => { const f = jointFile() as any; delete f.q.RightHand; return f; })())], ["frames disagree", fetchOf(jointFile({ frames: 10 }))],
      ["a non-unit rotation", fetchOf((() => { const f = jointFile() as any; f.q.Head[3] = 5; return f; })())],
      ["oversized", fetchOf(huge)], ["offline", (async () => { throw new Error("offline"); }) as unknown as typeof fetch],
    ];
    for (const [why, f] of bad) {
      const addClips = vi.fn();
      const r = await loadGuitarClip({ fetchImpl: f, addClips });
      expect(r.loaded, why).toBe(false);
      expect(addClips, why).not.toHaveBeenCalled();
      expect(guitarArmSpec(), why).toBeNull();
    }
  });
  it("remembers where the strokes are once loaded and forgets them on demand", async () => {
    expect(guitarArmSpec()).toBeNull();
    await loadGuitarClip({ fetchImpl: fetchOf(jointFile()), addClips: () => {} });
    expect(guitarArmSpec()).not.toBeNull();
    forgetGuitarClip();
    expect(guitarArmSpec()).toBeNull();
  });
  it("a clip with no counted beats still loads (it plays) but has no strokes to follow, so the act falls back to the hand-authored clip", async () => {
    const f = jointFile() as any;
    delete f.beats; delete f.bpm;
    const added = vi.fn();
    const r = await loadGuitarClip({ fetchImpl: fetchOf(f), addClips: added });
    expect(r.loaded).toBe(true);
    expect(r.beatS).toBe(0);
    expect(guitarArmSpec()).toBeNull();
  });
});

describe("where the strokes are in the clip", () => {
  it("a key every beat / 4 (two down strokes a beat, a stroke up between each), repeating after beats * 4 keys, the first down stroke where the hips are lowest", () => {
    const j = parseJointClip(jointFile())!;
    const c = jointClipToGame(j, "guitar", { joints: true });
    const spec = armSpecFor(c, 8)!;
    expect(spec.period).toBe(32);
    expect(spec.period % 2).toBe(0);
    const step = c.duration / 32;
    expect(spec.keyTime(1) - spec.keyTime(0)).toBeCloseTo(step, 9);
    expect(spec.keyTime(32) - spec.keyTime(0)).toBeCloseTo(c.duration, 9);          // one lap of the keys is exactly one loop of the clip
    expect(spec.ready).toBeCloseTo(spec.keyTime(0) - step, 9);
    // the hips' dips are every half beat (2 * step); the even keys are on them
    const y = (t: number) => c.hips[Math.round((t / c.duration) * (c.frames - 1)) * 3 + 1]!;
    for (let i = 0; i < 32; i += 2) expect(y(spec.keyTime(i) % c.duration), `key ${i}`).toBeLessThan(y((spec.keyTime(i) + step) % c.duration) + 1e-6);
  });
  it("drives the arm sweep like any other clip: down strokes on even keys, a whole lap of strokes comes back to the same clip time", () => {
    const c = jointClipToGame(parseJointClip(jointFile())!, "guitar", { joints: true });
    const sweep = createArmSweep(armSpecFor(c, 8)!);
    const first = (() => { sweep.stroke("down"); for (let i = 0; i < 20; i++) sweep.update(1 / 60); return sweep.time(); })();
    for (let i = 1; i < 32; i++) { sweep.stroke(i % 2 === 0 ? "down" : "up"); for (let k = 0; k < 20; k++) sweep.update(1 / 60); }
    sweep.stroke("down");
    for (let i = 0; i < 20; i++) sweep.update(1 / 60);
    expect(sweep.time() % c.duration).toBeCloseTo(first % c.duration, 6);
  });
  it("refuses a clip with no counted beats", () => {
    const c = jointClipToGame(parseJointClip(jointFile())!, "guitar");
    expect(armSpecFor(c, 0)).toBeNull();
    expect(armSpecFor(c, 1.5)).toBeNull();
    expect(armSpecFor({ ...c, duration: 0 }, 8)).toBeNull();
  });
  it.skipIf(!HAVE_REAL)("the real Guitar Strum (8 beats, 100.7 bpm): 32 keys of 0.149 s, and the body dips (hips low) on the down strokes", () => {
    const j = parseJointClip(JSON.parse(readFileSync(join(BAKED, `${GUITAR_FILE}.json`), "utf8")))!;
    expect(j.beats).toBe(8);
    const c = jointClipToGame(j, "guitar", { joints: true });
    const spec = armSpecFor(c, 8)!;
    expect(spec.period).toBe(32);
    expect(spec.keyTime(1) - spec.keyTime(0)).toBeCloseTo(c.duration / 32, 9);
    const y = (t: number) => { const u = ((t % c.duration) + c.duration) % c.duration; return c.hips[Math.round((u / c.duration) * (c.frames - 1)) * 3 + 1]!; };
    let lower = 0;
    for (let i = 0; i < 32; i += 2) if (y(spec.keyTime(i)) < y(spec.keyTime(i + 1))) lower++;
    expect(lower).toBeGreaterThanOrEqual(13);                                       // at least 13 of the 16 down strokes land on a dip
  });
});

describe("the link to the driver", () => {
  function host(over: Partial<GuitarArmHost> = {}) {
    const calls: string[] = [];
    let current: BeatSource | null = null;
    const h: GuitarArmHost = {
      has: (n) => n === "guitar" || n === "strum",
      canStart: () => true,
      begin: (s, l) => { current = s; calls.push(`begin:${l}`); return true; },
      owns: (s) => current === s,
      end: () => { calls.push("end"); current = null; },
      ...over,
    };
    return { h, calls, take: () => { current = () => null; } };
  }
  it("starts a beat source labelled `strum` that reads the clip name and the act's clock", () => {
    const { h, calls } = host();
    let seen: BeatSource | null = null;
    const hh: GuitarArmHost = { ...h, begin: (s, l) => { seen = s; return h.begin(s, l); } };
    const arm = createGuitarArm(hh);
    let t = 1.25;
    expect(arm.start("guitar", () => t)).toBe(true);
    expect(calls).toEqual([`begin:${GUITAR_LABEL}`]);
    expect(GUITAR_LABEL).toBe("strum");
    expect(seen!()).toEqual({ name: "guitar", time: 1.25 });
    t = 2;
    expect(seen!()).toEqual({ name: "guitar", time: 2 });
  });
  it("does not start when the character cannot be driven, the clip is not in the bank, or the driver refuses", () => {
    expect(createGuitarArm(host({ canStart: () => false }).h).start("guitar", () => 0)).toBe(false);
    expect(createGuitarArm(host({ has: () => false }).h).start("guitar", () => 0)).toBe(false);
    const refuse = host({ begin: () => false });
    const a = createGuitarArm(refuse.h);
    expect(a.start("guitar", () => 0)).toBe(false);
    a.stop();
    expect(refuse.calls).toEqual([]);
  });
  it("stops only its own beat: a party or an idle dance that took the beat over since is left alone", () => {
    const m = host();
    const arm = createGuitarArm(m.h);
    arm.start("strum", () => 0);
    m.take();
    arm.stop();
    expect(m.calls).toEqual([`begin:${GUITAR_LABEL}`]);
    const m2 = host();
    const arm2 = createGuitarArm(m2.h);
    arm2.start("strum", () => 0);
    arm2.stop();
    arm2.stop();                                                                     // safe twice
    expect(m2.calls).toEqual([`begin:${GUITAR_LABEL}`, "end"]);
    createGuitarArm(host().h).stop();                                                // and when nothing was started
  });
  it("answers `has` from the bank", () => {
    expect(createGuitarArm(host().h).has("guitar")).toBe(true);
    expect(createGuitarArm(host().h).has("dance")).toBe(false);
  });
});

describe("the guitar held two ways", () => {
  const model = new THREE.Group();
  const grips = [new THREE.Group(), new THREE.Group()];                              // left, right
  model.add(...grips);
  it("both are held by the LEFT fist: a point on the neck is moved into it every frame, whatever the arm does", () => {
    for (const item of ["guitar", "guitarFront"] as const) {
      const spec = HELD[item];
      expect(spec.hands!.hand).toBe("left");
      const mesh = new THREE.Group();
      placeHeldMesh(mesh, spec, model);
      model.add(mesh);
      for (const left of [[0.8, 1.5, -0.6], [0.5, 1.1, -0.7], [0.9, 1.7, -0.4]] as const) {
        grips[0]!.position.set(...left);
        grips[1]!.position.set(0.7, 1.4, 0.5);                                        // the right fist is somewhere else entirely: it does not matter
        expect(followHandsMesh(mesh, spec, model, grips)).toBe(true);
        model.updateWorldMatrix(true, true);
        const p = new THREE.Vector3(...spec.hands!.grip).multiplyScalar(spec.scale).applyEuler(mesh.rotation).add(mesh.position);
        // (x and y are the fist's; z stays on the centre line when the spec says so)
        expect(p.x, item).toBeCloseTo(left[0], 6);
        expect(p.y, item).toBeCloseTo(left[1], 6);
        if (spec.hands!.z !== undefined) expect(mesh.position.z, item).toBe(spec.hands!.z);
      }
      model.remove(mesh);
    }
  });
  it("the profile guitar keeps its old turn and size; the chest guitar is the same guitar turned so the neck goes to Kip's left, tipped up, the face to his front and a little to the camera", () => {
    expect(HELD.guitar.rotation).toEqual([0, 0, -1.15]);
    expect(HELD.guitar.scale).toBe(HELD_GUITAR_SCALE);
    expect(HELD.guitarFront.scale).toBe(HELD_GUITAR_SCALE);
    const e = new THREE.Euler(...HELD.guitarFront.rotation);
    const neck = new THREE.Vector3(0, 1, 0).applyEuler(e), face = new THREE.Vector3(0, 0, 1).applyEuler(e);
    expect(neck.z).toBeLessThan(-0.85);                                              // toward his left (-z)
    expect(neck.y).toBeCloseTo(Math.sin(FRONT_TILT), 6);                             // tipped up
    expect(neck.x).toBeGreaterThan(0);                                               // a little forward
    expect(face.x).toBeGreaterThan(0.9);                                             // the face is to his front (+x)...
    expect(face.z).toBeCloseTo(Math.sin(FRONT_YAW), 6);                              // ...and a little toward the camera (+z)
    expect(Math.abs(neck.dot(face))).toBeLessThan(1e-9);                             // still a rotation
  });
});
