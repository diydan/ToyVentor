import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error a plain browser module (no types): the rig numbers this converter copies are checked against it below
import { HIP_Y as VIEWER_HIP_Y, LEG_RIG as VIEWER_LEG_RIG } from "../parts/kip/viewer/kip-clips.js";
import { KIP_HIP_Y, KIP_JOINTS, KIP_LEG, MIN_HIT_CONSISTENCY, beatHit, jointClipToGame, parseJointClip, type JointClip } from "../src/features/game/world/runtime/bakedDance";
import { SAMBA, createDanceLibrary, parseDanceIndex } from "../src/features/game/world/runtime/gameDances";
import { MixamoDriver, loadMixamoBank, newPose, sampleClip, type BakedClip, type ClipBank } from "../src/features/game/world/runtime/mixamo";
import { stockCol, stockSel } from "../src/features/game/world/runtime/catalog";
import { buildToy } from "../src/features/game/world/runtime/playerRig";

const ROOT = process.cwd();
const BAKED = join(ROOT, "public/kip/mixamo/baked");
const read = (id: string) => JSON.parse(readFileSync(join(BAKED, `${id}.json`), "utf8")) as Record<string, any>;

describe("the rig numbers are the bench's", () => {
  it("match parts/kip/viewer/kip-clips.js, so a change there fails here instead of quietly bending every dance", () => {
    expect(KIP_HIP_Y).toBe(VIEWER_HIP_Y);
    expect(KIP_LEG.hipX).toBe(VIEWER_LEG_RIG.hipX);
    expect(KIP_LEG.thigh).toBe(VIEWER_LEG_RIG.thigh);
    expect([...KIP_LEG.shin]).toEqual([...VIEWER_LEG_RIG.shin]);
  });
});

// ---- a hand-made joint clip, so the forward kinematics can be checked against numbers worked out by hand ----------------------------------------------
function jointJson(over: { hips?: number[]; q?: Partial<Record<string, number[]>>; frames?: number } = {}): Record<string, unknown> {
  const frames = over.frames ?? 3;
  const ident = (n: number) => Array.from({ length: n }, (_, i) => (i % 4 === 3 ? 1 : 0));
  const q: Record<string, number[]> = {};
  for (const j of KIP_JOINTS) q[j] = over.q?.[j] ?? ident(frames * 4);
  return { v: 1, id: "dance_test", label: "Test", group: "dance", source: "x", planted: true, fps: 30, frames, dur: (frames - 1) / 30, hips: over.hips ?? Array.from({ length: frames * 3 }, (_, i) => (i % 3 === 1 ? 61.5 : 0)), q, beats: 2, bpm: 60 };
}
const rotZ = (deg: number) => { const h = (deg * Math.PI) / 360; return [0, 0, Math.sin(h), Math.cos(h)]; };
const rotY = (deg: number) => { const h = (deg * Math.PI) / 360; return [0, Math.sin(h), 0, Math.cos(h)]; };
const repeat = (q: number[], frames = 3) => Array.from({ length: frames }, () => q).flat();
const convert = (json: Record<string, unknown>) => jointClipToGame(parseJointClip(json)!, "t");
const v3 = (a: Float32Array, i = 0) => [a[i * 3]!, a[i * 3 + 1]!, a[i * 3 + 2]!];

describe("forward kinematics: limb directions, body, head and hips", () => {
  it("a rig at rest has its arms straight down, its legs nearly straight down, and no body, head or hips motion", () => {
    const g = convert(jointJson());
    for (const a of [g.armL, g.armR]) expect(v3(a)).toEqual([0, -1, 0].map((x) => expect.closeTo(x, 6)));
    for (const l of [g.legL, g.legR]) { expect(l[1]).toBeLessThan(-0.99); expect(l[2]).toBeCloseTo(-1.5 / Math.hypot(25.6 + 26, 1.5), 4); } // the shin's own 1.5 mm lean
    expect(Array.from(g.body.slice(0, 4))).toEqual([0, 0, 0, 1]);
    expect(Array.from(g.head.slice(0, 4))).toEqual([0, 0, 0, 1]);
    expect(v3(g.hips)).toEqual([0, 0, 0]);
  });
  it("lifting the left arm 90 degrees to the side points it along +X (the figure's left), with the forearm following", () => {
    const g = convert(jointJson({ q: { LeftArm: repeat(rotZ(90)) } }));
    expect(v3(g.armL)).toEqual([1, 0, 0].map((x) => expect.closeTo(x, 5)));
    expect(v3(g.armR)).toEqual([0, -1, 0].map((x) => expect.closeTo(x, 5)));
    // a bent elbow: forearm turned a further 90 degrees about Z points the hand up-and-out halfway between the two segments
    const bent = convert(jointJson({ q: { LeftArm: repeat(rotZ(90)), LeftForeArm: repeat(rotZ(90)) } }));
    expect(v3(bent.armL)[0]).toBeCloseTo(Math.SQRT1_2, 5);
    expect(v3(bent.armL)[1]).toBeCloseTo(Math.SQRT1_2, 5);
  });
  it("the body's rotation carries the limbs with it: turning the whole body 90 degrees about Z swings BOTH arms out to +X", () => {
    const g = convert(jointJson({ q: { Hips: repeat(rotZ(90)) } }));
    expect(v3(g.armL)).toEqual([1, 0, 0].map((x) => expect.closeTo(x, 5)));
    expect(v3(g.armR)).toEqual([1, 0, 0].map((x) => expect.closeTo(x, 5)));
    expect(Array.from(g.body.slice(0, 4))).toEqual(rotZ(90).map((x) => expect.closeTo(x, 5)));
    // and the head is the body's turn composed with its own
    const both = convert(jointJson({ q: { Hips: repeat(rotY(30)), Head: repeat(rotY(20)) } }));
    const want = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (50 * Math.PI) / 180);
    expect(Array.from(both.head.slice(0, 4))).toEqual([want.x, want.y, want.z, want.w].map((x) => expect.closeTo(x, 5)));
  });
  it("a leg swung forward 90 degrees about X points its ankle forward-and-down, by the real thigh and shin lengths", () => {
    const h = Math.PI / 4;
    const g = convert(jointJson({ q: { LeftUpLeg: repeat([Math.sin(-h), 0, 0, Math.cos(-h)]) } })); // -90 about X turns (0,-1,0) to (0,0,-1)... see the vector below
    const knee = new THREE.Vector3(0, -25.6, 0).applyAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    const ankle = new THREE.Vector3(0, -26, -1.5).applyAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2).add(knee).normalize();
    expect(v3(g.legL)).toEqual([ankle.x, ankle.y, ankle.z].map((x) => expect.closeTo(x, 5)));
  });
  it("hips: x and z are measured from where the clip began, y from its lowest point, all in hip-heights; a standing pose never goes below zero", () => {
    const hips = [10, 60, 5, 12, 50, 8, 14, 61.5, 11];
    const g = convert(jointJson({ hips }));
    expect(v3(g.hips, 0)).toEqual([0, expect.closeTo((60 - 50) / 61.5, 6), 0]);
    expect(v3(g.hips, 1)).toEqual([expect.closeTo(2 / 61.5, 6), 0, expect.closeTo(3 / 61.5, 6)]);
    expect(v3(g.hips, 2)).toEqual([expect.closeTo(4 / 61.5, 6), expect.closeTo(11.5 / 61.5, 6), expect.closeTo(6 / 61.5, 6)]);
  });
  it("sets the clip's shape: its name, its length, looping, and not a held pose", () => {
    const g = convert(jointJson({ frames: 5 }));
    expect(g).toMatchObject({ name: "t", frames: 5, loop: true, pose: false });
    expect(g.duration).toBeCloseTo(4 / 30, 6);
  });
});

describe("a file that is not exactly what the bake wrote is refused", () => {
  const bad = (mut: (j: any) => void) => { const j: any = jointJson(); mut(j); return parseJointClip(j); };
  it("takes a good one", () => expect(parseJointClip(jointJson())).not.toBeNull());
  it("refuses: not an object, a wrong version, a bad id or group, a missing joint, a short array, NaN, infinity", () => {
    for (const x of [null, [], "x", 3, undefined]) expect(parseJointClip(x)).toBeNull();
    expect(bad((j) => { j.v = 2; })).toBeNull();
    expect(bad((j) => { j.id = "../x"; })).toBeNull();
    expect(bad((j) => { j.id = "Has Caps"; })).toBeNull();
    expect(bad((j) => { j.group = 5; })).toBeNull();
    expect(bad((j) => { delete j.q.LeftFoot; })).toBeNull();
    expect(bad((j) => { j.q.Head = j.q.Head.slice(1); })).toBeNull();
    expect(bad((j) => { j.hips = j.hips.slice(0, 5); })).toBeNull();
    expect(bad((j) => { j.hips[2] = NaN; })).toBeNull();
    expect(bad((j) => { j.hips[2] = Infinity; })).toBeNull();
    expect(bad((j) => { j.q.Hips[0] = "0"; })).toBeNull();
  });
  it("refuses frame counts and lengths that do not agree, and sizes that are not a dance", () => {
    expect(bad((j) => { j.frames = 1; })).toBeNull();
    expect(bad((j) => { j.frames = 5000; })).toBeNull();
    expect(bad((j) => { j.fps = 0; })).toBeNull();
    expect(bad((j) => { j.dur = 1; })).toBeNull();           // 3 frames at 30 fps are 0.067 s, not 1 s
    expect(bad((j) => { j.dur = 0; })).toBeNull();
    expect(bad((j) => { j.dur = 61; })).toBeNull();
  });
  it("refuses a rotation that is not one (a zero or a huge quaternion would blow the pose up)", () => {
    expect(bad((j) => { j.q.LeftArm = Array(12).fill(0); })).toBeNull();
    expect(bad((j) => { j.q.LeftArm = Array(12).fill(5); })).toBeNull();
  });
  it("keeps the tempo and beats only when they are real numbers", () => {
    const c = parseJointClip(jointJson())!;
    expect(c).toMatchObject({ bpm: 60, beats: 2 });
    const j: any = jointJson(); j.bpm = -3; j.beats = 1.5;
    expect(parseJointClip(j)).toMatchObject({ id: "dance_test" });
    expect(parseJointClip(j)!.bpm).toBeUndefined();
    expect(parseJointClip(j)!.beats).toBeUndefined();
  });
});

describe("the real baked dances", () => {
  const ids = ["dance_silly", "dance_hiphop", "dance_swing"];
  for (const id of ids) {
    it(`${id}: parses, converts, and every channel is a sane number`, () => {
      const joint = parseJointClip(read(id))!;
      expect(joint).not.toBeNull();
      const g = jointClipToGame(joint, id);
      for (const arr of [g.hips, g.body, g.head, g.armL, g.armR, g.legL, g.legR]) for (const v of arr) expect(Number.isFinite(v)).toBe(true);
      for (let i = 0; i < g.frames; i++) {
        for (const l of [g.armL, g.armR, g.legL, g.legR]) expect(Math.hypot(l[i * 3]!, l[i * 3 + 1]!, l[i * 3 + 2]!)).toBeCloseTo(1, 4);
        expect(Math.hypot(g.body[i * 4]!, g.body[i * 4 + 1]!, g.body[i * 4 + 2]!, g.body[i * 4 + 3]!)).toBeCloseTo(1, 4);
        expect(g.hips[i * 3 + 1]!).toBeGreaterThanOrEqual(0);
        expect(g.legL[i * 3 + 1]!).toBeLessThan(-0.4); // a planted dance: the feet stay below the hips
        expect(g.legR[i * 3 + 1]!).toBeLessThan(-0.4);
      }
      expect(g.hips[0]).toBe(0);
      expect(g.hips[2]).toBe(0);
    });
    it(`${id}: the arms really dance: they go well above and below the shoulder over the loop`, () => {
      const g = jointClipToGame(parseJointClip(read(id))!, id);
      const ys = Array.from({ length: g.frames }, (_, i) => Math.max(g.armL[i * 3 + 1]!, g.armR[i * 3 + 1]!));
      expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.5);
    });
    it(`${id}: it loops: the last frame is next to the first, not a jump`, () => {
      const g = jointClipToGame(parseJointClip(read(id))!, id);
      const a = newPose(), b = newPose();
      sampleClip(g, 0, a); sampleClip(g, g.duration - 1e-6, b);
      expect(a.armL.distanceTo(b.armL)).toBeLessThan(0.35);
      expect(a.legL.distanceTo(b.legL)).toBeLessThan(0.2);
    });
  }
});

describe("where a dance's weight lands (beatHit)", () => {
  const synthetic = (lowAt: number, beats = 4, dur = 2, frames = 121, noise = 0): Pick<BakedClip, "hips" | "frames" | "duration"> => {
    const beat = dur / beats;
    const hips = new Float32Array(frames * 3);
    let seed = 3;
    for (let i = 0; i < frames; i++) {
      const t = (i / (frames - 1)) * dur;
      const ph = (((t - lowAt) % beat) + beat) % beat / beat;
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      hips[i * 3 + 1] = 0.1 * (1 - Math.cos(2 * Math.PI * ph)) / 2 + noise * (seed / 0x7fffffff);
    }
    return { hips, frames, duration: dur };
  };
  it("finds the phase of a steady bounce, wherever in the beat it falls", () => {
    for (const low of [0.05, 0.2, 0.33, 0.45]) expect(beatHit(synthetic(low), 4).offset).toBeCloseTo(low, 1);
    expect(beatHit(synthetic(0.2), 4).consistency).toBeGreaterThan(0.9);
  });
  it("leaves a dance alone (offset 0) when its hips keep no steady beat, or do not move at all", () => {
    const flat = { hips: new Float32Array(30 * 3), frames: 30, duration: 2 };
    expect(beatHit(flat, 4)).toEqual({ offset: 0, consistency: 0, lows: 0 });
    const noisy = synthetic(0.2, 4, 2, 121, 0.5);
    const h = beatHit(noisy, 4);
    expect(h.consistency).toBeLessThan(MIN_HIT_CONSISTENCY + 0.3);
    if (h.consistency < MIN_HIT_CONSISTENCY) expect(h.offset).toBe(0);
    expect(beatHit({ hips: new Float32Array(9), frames: 3, duration: 1 }, 4).lows).toBe(0);
    expect(beatHit(synthetic(0.2), 0).offset).toBe(0);
  });
  it("on the real dances: Hip Hop and Silly keep a steady beat in their hips, and Swing does not (so it is not shifted)", () => {
    const hit = (id: string) => { const r = read(id); return beatHit(jointClipToGame(parseJointClip(r)!, id), r.beats); };
    expect(hit("dance_hiphop")).toMatchObject({ lows: 8 });
    expect(hit("dance_hiphop").consistency).toBeGreaterThan(0.95);
    expect(hit("dance_hiphop").offset).toBeCloseTo(0.279, 2);
    expect(hit("dance_silly").consistency).toBeGreaterThan(0.85);
    expect(hit("dance_silly").offset).toBeCloseTo(0.423, 2);
    expect(hit("dance_swing").consistency).toBeLessThan(MIN_HIT_CONSISTENCY);
    expect(hit("dance_swing").offset).toBe(0);
  });
});

describe("the index of dances", () => {
  it("offers exactly the dances with a counted tempo, in the file's order, and never the Samba's own id", () => {
    const list = parseDanceIndex(JSON.parse(readFileSync(join(BAKED, "index.json"), "utf8")));
    expect(list.map((d) => d.id)).toEqual(["dance_silly", "dance_hiphop", "dance_swing"]);
    expect(list.map((d) => [d.bpm, d.beats])).toEqual([[125.22, 8], [101.41, 8], [137.8, 48]]);
    expect(list.every((d) => d.group === "dance" && !d.loaded && d.hit === 0)).toBe(true);
  });
  it("leaves out a clip with no tempo, a move or a reaction, a tempo outside 40 to 220, a fractional or huge beat count, a bad or repeated id", () => {
    const clip = (o: Record<string, unknown>) => ({ id: "dance_x", group: "dance", bpm: 100, beats: 8, label: "X", ...o });
    const list = parseDanceIndex({ v: 1, clips: [clip({}), clip({ id: "dance_a", bpm: undefined }), clip({ id: "dance_b", group: "move" }), clip({ id: "dance_c", bpm: 30 }), clip({ id: "dance_d", bpm: 300 }), clip({ id: "dance_e", beats: 1.5 }),
      clip({ id: "dance_f", beats: 401 }), clip({ id: "../x" }), clip({ id: "Dance G" }), clip({ id: "dance_x" }), clip({ id: "dance" }), clip({ id: "dance_h", bpm: "100" }), null, "x", 4] });
    expect(list.map((d) => d.id)).toEqual(["dance_x"]);
  });
  it("is empty for anything that is not a version 1 clip list, and a label is capped and never empty", () => {
    for (const bad of [null, [], "x", { v: 2, clips: [] }, { v: 1 }, { v: 1, clips: "x" }]) expect(parseDanceIndex(bad)).toEqual([]);
    const l = parseDanceIndex({ v: 1, clips: [{ id: "dance_a", group: "dance", bpm: 100, beats: 8, label: "L".repeat(200) }, { id: "dance_b", group: "dance", bpm: 100, beats: 8 }] });
    expect(l[0]!.label.length).toBe(40);
    expect(l[1]!.label).toBe("dance_b");
  });
});

describe("the dance library", () => {
  const fileFetch = (over: Record<string, string | null> = {}, log: string[] = []) => (async (input: string) => {
    const url = String(input);
    log.push(url);
    const name = url.split("/").pop()!;
    if (name in over) { const v = over[name]; return v === null ? new Response("nope", { status: 404 }) : new Response(v, { status: 200 }); }
    return new Response(readFileSync(join(BAKED, name)), { status: 200 });
  }) as unknown as typeof fetch;
  const lib = (over: Record<string, string | null> = {}) => { const bank: Record<string, BakedClip> = {}; const log: string[] = []; return { bank, log, lib: createDanceLibrary({ fetchImpl: fileFetch(over, log), addClips: (c) => Object.assign(bank, c) }) }; };

  it("starts with the Samba alone, reads the index once, and then knows the other three", async () => {
    const { lib: l, log } = lib();
    expect(l.list().map((d) => d.id)).toEqual(["dance"]);
    await l.prepare(); await l.prepare();
    expect(l.list().map((d) => d.id)).toEqual(["dance", "dance_silly", "dance_hiphop", "dance_swing"]);
    expect(log.filter((u) => u.endsWith("index.json"))).toHaveLength(1);
    expect(l.list()[0]).toMatchObject({ ...SAMBA, loaded: true });
  });
  it("loads a dance on demand: the clip goes into the bank under its id, its weight-landing point is measured, and it is not fetched twice", async () => {
    const { lib: l, bank, log } = lib();
    expect(await l.ensure(["dance_hiphop"])).toEqual(["dance_hiphop"]);
    expect(Object.keys(bank)).toEqual(["dance_hiphop"]);
    expect(bank.dance_hiphop).toMatchObject({ name: "dance_hiphop", loop: true });
    expect(l.list().find((d) => d.id === "dance_hiphop")).toMatchObject({ loaded: true, hit: expect.closeTo(0.279, 2) });
    await l.ensure(["dance_hiphop", "dance_hiphop"]);
    expect(log.filter((u) => u.endsWith("dance_hiphop.json"))).toHaveLength(1);
  });
  it("two parties asking at once share one fetch", async () => {
    const { lib: l, log } = lib();
    await Promise.all([l.ensure(["dance_silly"]), l.ensure(["dance_silly"])]);
    expect(log.filter((u) => u.endsWith("dance_silly.json"))).toHaveLength(1);
  });
  it("resolves the ids that are playable, in the order asked; the Samba is always there; an unknown id is left out", async () => {
    const { lib: l } = lib();
    expect(await l.ensure(["dance_swing", "dance", "nope", "dance_silly"])).toEqual(["dance_swing", "dance", "dance_silly"]);
  });
  it("leaves out a dance whose file is missing, is not JSON, is the wrong dance, has another tempo or beat count, or is too big; the others still load", async () => {
    const good = JSON.parse(readFileSync(join(BAKED, "dance_silly.json"), "utf8"));
    const cases: Record<string, string | null> = {
      "dance_hiphop.json": null,
      "dance_swing.json": "{not json",
    };
    const a = lib(cases);
    expect(await a.lib.ensure(["dance_silly", "dance_hiphop", "dance_swing"])).toEqual(["dance_silly"]);
    expect(await lib({ "dance_silly.json": JSON.stringify({ ...good, id: "dance_hiphop" }) }).lib.ensure(["dance_silly"])).toEqual([]);       // the wrong dance in the file
    expect(await lib({ "dance_silly.json": JSON.stringify({ ...good, bpm: 90 }) }).lib.ensure(["dance_silly"])).toEqual([]);               // another tempo than the index
    expect(await lib({ "dance_silly.json": JSON.stringify({ ...good, beats: 16 }) }).lib.ensure(["dance_silly"])).toEqual([]);
    expect(await lib({ "dance_silly.json": JSON.stringify({ ...good, group: "move" }) }).lib.ensure(["dance_silly"])).toEqual([]);
    expect(await lib({ "dance_silly.json": " ".repeat(1_000_000) }).lib.ensure(["dance_silly"])).toEqual([]);                               // not the size of a dance
    expect(await lib({ "dance_silly.json": JSON.stringify({ ...good, hips: good.hips.slice(1) }) }).lib.ensure(["dance_silly"])).toEqual([]);
  });
  it("a failed index leaves only the Samba, and a failed fetch is not remembered as loaded", async () => {
    const x = lib({ "index.json": null });
    expect(await x.lib.ensure(["dance_silly"])).toEqual([]);
    expect(x.lib.list().map((d) => d.id)).toEqual(["dance"]);
    const throwing = createDanceLibrary({ fetchImpl: (async () => { throw new Error("offline"); }) as unknown as typeof fetch, addClips: () => {} });
    expect(await throwing.ensure(["dance_silly", "dance"])).toEqual(["dance"]);
  });
});

// ---- the driver: a dance from a source that changes clip ----------------------------------------------------------------------------------------------
describe("the driver switches dances without a jump", () => {
  let bank: ClipBank;
  beforeAll(async () => {
    const parse = (url: string) => {
      const buf = readFileSync(resolve(ROOT, "public", url.replace(/^\//, "")));
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      return new Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }>((res, rej) => new GLTFLoader().parse(ab, "", (g) => res(g), rej));
    };
    bank = await loadMixamoBank(parse);
    for (const id of ["dance_silly", "dance_hiphop"]) bank[id] = jointClipToGame(parseJointClip(read(id))!, id);
  });
  const rigOf = () => {
    const rig = buildToy("character", stockSel().character as never, stockCol());
    rig.arms.length = 0;
    rig.arms.push(new THREE.Group(), new THREE.Group());
    rig.head = new THREE.Group();
    return rig;
  };
  const armDir = (rig: ReturnType<typeof rigOf>) => new THREE.Vector3(0, -1, 0).applyQuaternion(rig.arms[0]!.quaternion);

  it("reports `dance` whichever clip it is on, and the clip's own name through beatClip", () => {
    const d = new MixamoDriver(bank);
    let name = "dance_silly";
    expect(d.startBeatSource(() => ({ name, time: 0.5 }))).toBe(true);
    expect(d.busyAction).toBe("dance");
    expect(d.beatClip).toBe("dance_silly");
    d.update(rigOf(), 1 / 30, 0);
    name = "dance_hiphop";
    d.update(rigOf(), 1 / 30, 0);
    expect(d.beatClip).toBe("dance_hiphop");
    expect(d.busyAction).toBe("dance");
  });
  it("refuses a source whose first clip is not in the bank or is a held pose", () => {
    const d = new MixamoDriver(bank);
    expect(d.startBeatSource(() => ({ name: "dance_nope", time: 0 }))).toBe(false);
    expect(d.startBeatSource(() => ({ name: "sad", time: 0 }))).toBe(false);
    expect(d.startBeatSource(() => null)).toBe(false);
    expect(d.beatDancing).toBe(false);
  });
  it("melts from the old dance into the new over a third of a second: the first frame after the switch is still the OLD pose, the last is the new one", () => {
    const rig = rigOf();
    const d = new MixamoDriver(bank);
    let cur = { name: "dance_silly", time: 1.0 };
    d.startBeatSource(() => cur);
    for (let i = 0; i < 40; i++) d.update(rig, 1 / 30, 0); // eased in
    const before = armDir(rig).clone();
    cur = { name: "dance_hiphop", time: 2.5 };
    d.update(rig, 1 / 60, 0);
    const firstFrame = armDir(rig).clone();
    expect(firstFrame.distanceTo(before)).toBeLessThan(0.2);           // no jump on the frame of the switch
    for (let i = 0; i < 30; i++) d.update(rig, 1 / 30, 0);
    const settled = armDir(rig).clone();
    const direct = new MixamoDriver(bank);
    const rig2 = rigOf();
    direct.startBeatSource(() => ({ name: "dance_hiphop", time: 2.5 }));
    for (let i = 0; i < 40; i++) direct.update(rig2, 1 / 30, 0);
    expect(settled.distanceTo(armDir(rig2))).toBeLessThan(0.02);       // once settled it IS the new dance, as if it had been on it all along
  });
  it("addClips puts a clip in the bank after the driver was made", () => {
    const d = new MixamoDriver({ ...bank });
    expect(d.hasClip("dance_extra")).toBe(false);
    d.addClips({ dance_extra: bank.dance_silly! });
    expect(d.hasClip("dance_extra")).toBe(true);
    expect(d.startBeatSource(() => ({ name: "dance_extra", time: 0 }))).toBe(true);
  });
});
