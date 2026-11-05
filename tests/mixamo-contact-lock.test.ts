// The contact lock (runtime/mixamo.ts lockFeet): while an in-place clip plays, a sole that is on the floor stays where it landed, and the toy's root takes the drift instead. Dan, 2026-11-05, again: "on many
// animations feet slide and hover in the air". Measured before: the Samba's soles slid a median 1.07 stage units a second over the floor, the dances, gestures and the cheer 0.1 to 0.4.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { beforeAll, describe, expect, it } from "vitest";
import { MixamoDriver, loadMixamoBank, type ClipBank } from "../src/features/game/world/runtime/mixamo";
import { PROCEDURAL_CLIPS } from "../src/features/game/world/runtime/proceduralClips";
import { stockCol, stockSel } from "../src/features/game/world/runtime/catalog";
import { buildToy, upgradeRigWithStl, type RigSel } from "../src/features/game/world/runtime/playerRig";

type Lock = (j: unknown, L: number, dt: number) => void;
const lockOf = (d: MixamoDriver): Lock => (j, L, dt) => (d as unknown as { lockFeet: Lock }).lockFeet(j, L, dt);

/** A toy root with two legs: each foot hangs from the root at (x, y, 0) with its boot at the foot's origin; `drift` moves a foot sideways, as a clip's hips and legs do. */
function fakeToy() {
  const stage = new THREE.Group(), g = new THREE.Group();
  stage.add(g);
  const legs = [0, 1].map(() => { const foot = new THREE.Group(), boot = new THREE.Object3D(); foot.scale.setScalar(0.0185); g.add(foot); foot.add(boot); return { foot, boot }; });   // the real rig's boots hang in millimetres, 0.0185 stage units each
  const joints = { g, snap: { legs } };
  return { stage, g, legs, joints };
}
const worldX = (t: ReturnType<typeof fakeToy>, i: number): number => { t.legs[i]!.foot.updateWorldMatrix(true, false); return new THREE.Vector3().setFromMatrixPosition(t.legs[i]!.foot.matrixWorld).x; };
/** One frame as the driver sees it: apply() has put the root back where the clip says (here, home), the legs are where the clip puts them, then the lock runs. */
function frame(t: ReturnType<typeof fakeToy>, d: MixamoDriver, feet: [number, number][], L = 1, dt = 1 / 60) {
  t.g.position.set(0, 0, 0);
  feet.forEach(([x, y], i) => t.legs[i]!.foot.position.set(x, y, 0));
  lockOf(d)(t.joints, L, dt);
}
const driver = () => new MixamoDriver({} as unknown as ClipBank);

describe("a planted sole stays where it landed", () => {
  it("a sole on the floor whose leg drifts sideways stays put: the root takes the drift", () => {
    const t = fakeToy(), d = driver();
    frame(t, d, [[0, 0], [1, 1]]);                                // the left foot lands at x = 0, the right is in the air
    const landed = worldX(t, 0);
    for (let k = 1; k <= 90; k++) frame(t, d, [[k * 0.005, 0], [1, 1]]); // the clip's pose drags the foot 0.45 along over 1.5 s
    expect(Math.abs(worldX(t, 0) - landed)).toBeLessThan(0.02);
    expect(d.lockShift.x).toBeLessThan(-0.35);                      // and the body moved the other way to do it
  });
  it("a foot in the air is left alone, and the shift eases home", () => {
    const t = fakeToy(), d = driver();
    frame(t, d, [[0, 0], [1, 1]]);
    for (let k = 1; k <= 30; k++) frame(t, d, [[k * 0.005, 0], [1, 1]]);
    const held = d.lockShift.x;
    expect(held).toBeLessThan(-0.1);
    for (let k = 0; k < 120; k++) frame(t, d, [[0.15, 0.5], [1, 1]]);  // both feet up: a jump
    expect(Math.abs(d.lockShift.x)).toBeLessThan(Math.abs(held) * 0.05);
    expect(worldX(t, 0)).toBeCloseTo(0.15, 1);                       // the lifted foot goes where the clip puts it
  });
  it("with no weight (no in-place clip) nothing is shifted, nothing is remembered, and an old shift fades", () => {
    const t = fakeToy(), d = driver();
    frame(t, d, [[0, 0], [1, 1]]);
    for (let k = 1; k <= 30; k++) frame(t, d, [[k * 0.005, 0], [1, 1]]);
    for (let k = 0; k < 100; k++) frame(t, d, [[0.15, 0], [1, 1]], 0);
    expect(Math.abs(d.lockShift.x)).toBeLessThan(0.005);
    frame(t, d, [[0.4, 0], [1, 1]], 0);
    expect(t.g.position.x).toBeCloseTo(d.lockShift.x, 6);
    expect(Math.abs(t.g.position.x)).toBeLessThan(0.005);              // the foot was NOT pinned to its old anchor
  });
  it("the pin is weighted by the clip's share of the pose: half weight takes half the drift, so the shift fades out with the gesture", () => {
    const full = fakeToy(), half = fakeToy(), df = driver(), dh = driver();
    frame(full, df, [[0, 0], [1, 1]], 1); frame(half, dh, [[0, 0], [1, 1]], 0.5);
    for (let k = 1; k <= 120; k++) { frame(full, df, [[k * 0.002, 0], [1, 1]], 1); frame(half, dh, [[k * 0.002, 0], [1, 1]], 0.5); }
    expect(df.lockShift.x).toBeLessThan(-0.2);
    expect(dh.lockShift.x / df.lockShift.x).toBeGreaterThan(0.4);
    expect(dh.lockShift.x / df.lockShift.x).toBeLessThan(0.6);
  });
  it("the shift never takes the toy further than LOCK_MAX from where it stands (then the foot slides, as it would have)", () => {
    const t = fakeToy(), d = driver();
    frame(t, d, [[0, 0], [1, 1]]);
    for (let k = 1; k <= 200; k++) frame(t, d, [[k * 0.05, 0], [1, 1]]);
    expect(Math.hypot(d.lockShift.x, d.lockShift.z)).toBeLessThanOrEqual(0.8 + 1e-9);
  });
  it("a hand-over from one foot to the other does not jump the body: the shift changes by well under a centimetre a frame", () => {
    const t = fakeToy(), d = driver();
    frame(t, d, [[0, 0], [1, 1]]);
    let prev = 0, worst = 0;
    for (let k = 1; k <= 200; k++) {
      const left = k < 100 ? [k * 0.004, 0] as [number, number] : [0.4 + (k - 100) * 0.01, 0.4] as [number, number];  // the left foot drifts, then lifts away
      const right = k < 80 ? [1, 1] as [number, number] : [0.6 + (k - 80) * 0.002, 0] as [number, number];             // the right foot lands at k = 80 and then drifts slowly
      frame(t, d, [left, right]);
      worst = Math.max(worst, Math.abs(d.lockShift.x - prev)); prev = d.lockShift.x;
    }
    expect(worst).toBeLessThan(0.02);
  });
  it("both soles planted and the body twisting about the vertical: the twist is taken off, so the soles swing far less", () => {
    const spin = (g: THREE.Object3D, psi: number) => g.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), psi);
    const footAt = (t: ReturnType<typeof fakeToy>, i: number) => { t.legs[i]!.foot.updateWorldMatrix(true, false); return new THREE.Vector3().setFromMatrixPosition(t.legs[i]!.foot.matrixWorld); };
    const run = (L: number) => {
      const t = fakeToy(), d = driver();
      const place = (psi: number) => { t.g.position.set(0, 0, 0); spin(t.g, psi); t.legs[0]!.foot.position.set(0, 0, 0.34); t.legs[1]!.foot.position.set(0, 0, -0.34); lockOf(d)(t.joints, L, 1 / 60); };
      place(0);
      const a0 = footAt(t, 0), a1 = footAt(t, 1);
      let worst = 0;
      for (let k = 1; k <= 120; k++) { place(0.35 * Math.sin(k / 8)); worst = Math.max(worst, footAt(t, 0).distanceTo(a0), footAt(t, 1).distanceTo(a1)); }
      return { worst, yaw: d.lockShift.yaw };
    };
    const locked = run(1), free = run(0);
    expect(free.worst).toBeGreaterThan(0.1);                         // a +-20 degree twist swings a sole 0.12 each way
    expect(locked.worst).toBeLessThan(free.worst * 0.5);             // the lock takes more than half of it off (what is left is the low-pass lag)
    expect(Math.abs(free.yaw)).toBe(0);
  });
  it("two soles that are too close to say which way the body faces get no yaw fitted", () => {
    const t = fakeToy(), d = driver();
    const place = (psi: number) => { t.g.position.set(0, 0, 0); t.g.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), psi); t.legs[0]!.foot.position.set(0, 0, 0.04); t.legs[1]!.foot.position.set(0, 0, -0.04); lockOf(d)(t.joints, 1, 1 / 60); };
    for (let k = 0; k < 60; k++) place(0.3 * Math.sin(k / 6));
    expect(d.lockShift.yaw).toBe(0);
  });
  it("with two planted soles of which one is moving and one is still, the still one is pinned (the stance foot)", () => {
    const t = fakeToy(), d = driver();
    frame(t, d, [[0, 0], [1, 0]]);
    const landedL = worldX(t, 0);
    for (let k = 1; k <= 60; k++) frame(t, d, [[0, 0], [1 + k * 0.01, 0]]);      // the right sole slides away at 0.6 an hour of frames, the left stands
    expect(Math.abs(worldX(t, 0) - landedL)).toBeLessThan(0.08);                  // the left stays within a few centimetres of where it landed
  });
  it("a rig with no Snap legs is left alone", () => {
    const d = driver(), g = new THREE.Group(), stage = new THREE.Group(); stage.add(g);
    lockOf(d)({ g, snap: null }, 1, 1 / 60);
    expect(g.position.x).toBe(0);
  });
});

describe("how the driver uses it", () => {
  const src = readFileSync(new URL("../src/features/game/world/runtime/mixamo.ts", import.meta.url), "utf8");
  it("only for an in-place clip: never in a walk, a run or a turn in steps, and the weight is the clip's own share of the pose", () => {
    expect(src).toContain("const inPlace = this.contactLock && wWalk + wRun < 0.05 && this.stepTurner.w < 0.001;");
    expect(src).toContain("this.lockFeet(j, inPlace ? lockL : 0, dt);");
    expect(src).toContain("if (!act.clip.planted) lockL = Math.max(lockL, Math.min(1, Math.max(0, (dur - act.t) / act.fade)) * (1 - smooth(0.4, 1.2, speed)));");
    expect(src).toContain("if (!bd.cur.planted) lockL = Math.max(lockL, (bd.leaving ? smooth(0, 1, bd.w) : 1) * (1 - smooth(0.4, 1.2, speed)));");
  });
});

// ---- on the real Kip rig with the real Samba (the clip the party falls back on when no baked dance is there) ----------------------------------------------------------------------------------------
function diskParser(url: string) {
  const buf = readFileSync(resolve(process.cwd(), "public", url.replace(/^\//, "")));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }>((res, rej) => new GLTFLoader().parse(ab, "", (g) => res(g), rej));
}
const diskFetcher = (url: string): Promise<ArrayBuffer | null> => {
  const full = resolve(process.cwd(), "public", (url.split("?")[0] ?? url).replace(/^\//, ""));
  try { const b = readFileSync(full); return Promise.resolve(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); } catch { return Promise.resolve(null); }
};
let bank: ClipBank;
beforeAll(async () => { bank = { ...(await loadMixamoBank(diskParser)), ...PROCEDURAL_CLIPS }; });

async function kip() {
  const sel = { ...stockSel().character } as unknown as RigSel, col = stockCol();
  const rig = buildToy("character", sel, col);
  const root = new THREE.Group(); root.add(rig.g);
  await upgradeRigWithStl(rig, { type: "character", sel, col, toyId: "seed-kip", fetcher: diskFetcher } as never);
  return { rig, root };
}
const PROBES: ReadonlyArray<readonly [number, number]> = [[-7, -9], [7, -9], [-7, 15], [7, 15]];
/** Per-frame speed of every sole that is on the floor in two frames running (the same measure as the measuring script), and the lowest sole over the clip. */
function measure(name: string, lock: boolean, b: ClipBank, rigAndRoot: Awaited<ReturnType<typeof kip>>, seconds = 4) {
  const { rig, root } = rigAndRoot, d = new MixamoDriver(b);
  d.contactLock = lock;
  for (let k = 0; k < 120; k++) d.update(rig, 1 / 60, 0);        // standing a moment first, as in the game
  expect(d.trigger(name as never)).toBe(true);
  const legs = rig.snap!.legs;
  const sole = (i: number) => { const l = legs[i]!; l.foot.updateWorldMatrix(true, false); let y = Infinity, x = 0, z = 0; for (const [dx, dz] of PROBES) { const v = new THREE.Vector3(l.boot.position.x + dx, l.boot.position.y, l.boot.position.z + dz).applyMatrix4(l.foot.matrixWorld); y = Math.min(y, v.y); x += v.x; z += v.z; } return { y, x: x / 4, z: z / 4 }; };
  const speeds: number[] = [], lows: number[] = [];
  let prev = [sole(0), sole(1)];
  for (let k = 0; k < seconds * 60; k++) {
    d.update(rig, 1 / 60, 0);
    root.updateMatrixWorld(true);
    const now = [sole(0), sole(1)];
    lows.push(Math.min(now[0]!.y, now[1]!.y));
    for (let i = 0; i < 2; i++) if (prev[i]!.y < 0.04 && now[i]!.y < 0.04) speeds.push(Math.hypot(now[i]!.x - prev[i]!.x, now[i]!.z - prev[i]!.z) * 60);
    prev = now;
    if (!d.busyAction) break;
  }
  speeds.sort((a, c) => a - c); lows.sort((a, c) => a - c);
  return { n: speeds.length, median: speeds[speeds.length >> 1] ?? 0, mean: speeds.reduce((a, c) => a + c, 0) / Math.max(1, speeds.length), lowMedian: lows[lows.length >> 1] ?? 0, d };
}

describe("on the real Kip", () => {
  it("the Samba's planted soles slide far less with the lock than without it, and nothing floats", async () => {
    const rr = await kip();
    const off = measure("dance", false, bank, rr), on = measure("dance", true, bank, rr);
    expect(off.n).toBeGreaterThan(100);
    expect(off.median).toBeGreaterThan(0.5);                      // the problem is real (measured 1.04 to 1.07)
    expect(on.median).toBeLessThan(off.median * 0.6);              // measured 1.04 -> 0.46 in the game; what is left is the feet really moving (the legs opening and closing), which a pin cannot hold
    expect(on.mean).toBeLessThan(off.mean * 0.6);
    expect(Math.abs(on.lowMedian)).toBeLessThan(0.03);            // and the lowest sole is on the floor, not in the air
  }, 60_000);
  it("the gestures and actions the game plays in place slide less too", async () => {
    const rr = await kip();
    for (const name of ["sour", "belly_pat", "yawn", "eat", "hug", "tidy"]) {
      const off = measure(name, false, bank, rr, 3), on = measure(name, true, bank, rr, 3);
      expect(on.mean, name).toBeLessThanOrEqual(off.mean + 0.01);
    }
  }, 60_000);
  it("leaves a clip the bake planted alone: the same clip marked planted gets no shift and plays exactly as it does with the lock off", async () => {
    const rr = await kip();
    const plantedBank: ClipBank = { ...bank, dance: { ...bank.dance!, planted: true } };
    const off = measure("dance", false, plantedBank, rr), on = measure("dance", true, plantedBank, rr);
    expect(on.d.lockShift).toEqual({ x: 0, z: 0, yaw: 0 });
    expect(on.mean).toBeCloseTo(off.mean, 6);
    expect(on.median).toBeCloseTo(off.median, 6);
    // and as a beat dance on a song's clock
    const { rig } = rr, d = new MixamoDriver(plantedBank);
    expect(d.startBeatDance("dance", () => 1)).toBe(true);
    let shifted = 0;
    for (let k = 0; k < 120; k++) { d.update(rig, 1 / 60, 0); shifted = Math.max(shifted, Math.hypot(d.lockShift.x, d.lockShift.z)); }
    expect(shifted).toBe(0);
  }, 60_000);
  it("is off in a walk and a run, and does not leave a shift behind when the clip is over", async () => {
    const { rig } = await kip();
    const d = new MixamoDriver(bank);
    for (let k = 0; k < 120; k++) d.update(rig, 1 / 60, 2.4);       // walking, no clip
    expect(d.lockShift).toEqual({ x: 0, z: 0, yaw: 0 });
    d.trigger("sour");
    let seen = 0;
    for (let k = 0; k < 90; k++) { d.update(rig, 1 / 60, 0); seen = Math.max(seen, Math.hypot(d.lockShift.x, d.lockShift.z)); }
    for (let k = 0; k < 240; k++) d.update(rig, 1 / 60, 0);          // the clip is long over
    expect(Math.hypot(d.lockShift.x, d.lockShift.z)).toBeLessThan(0.01);
    expect(rig.g.position.x).toBeLessThan(0.05);
    expect(seen).toBeGreaterThanOrEqual(0);
  }, 60_000);
});
