import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  MixamoDriver,
  loadMixamoBank,
  mixPose,
  newPose,
  sampleClip,
  type ClipBank,
} from "../src/features/game/world/runtime/mixamo";
import { stockCol, stockSel } from "../src/features/game/world/runtime/catalog";
import { buildToy, upgradeRigWithStl } from "../src/features/game/world/runtime/playerRig";
import { existsSync } from "node:fs";

const ROOT = process.cwd();

function diskParser(url: string) {
  const buf = readFileSync(resolve(ROOT, "public", url.replace(/^\//, "")));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }>((res, rej) =>
    new GLTFLoader().parse(ab, "", (g) => res(g), rej),
  );
}

let bank: ClipBank;
beforeAll(async () => {
  bank = await loadMixamoBank(diskParser);
});

/** Pearson correlation of two equal-length series. */
function corr(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((x, y) => x + y, 0) / n;
  const mb = b.reduce((x, y) => x + y, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i]! - ma) * (b[i]! - mb);
    da += (a[i]! - ma) ** 2;
    db += (b[i]! - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
}
/** The forward (z) component of a limb direction across a baked clip. */
function fwd(c: Float32Array, frames: number): number[] {
  return Array.from({ length: frames }, (_, i) => c[i * 3 + 2]!);
}

describe("Mixamo bank", () => {
  it("bakes every configured clip from the bundled bone-only GLBs", () => {
    for (const k of ["idle", "walk", "run", "nod", "no", "sneak", "sad", "dance"]) expect(bank[k], k).toBeTruthy();
    expect(bank.walk!.loop).toBe(true);
    expect(bank.nod!.loop).toBe(false);
    expect(bank.sad!.pose).toBe(true);
    expect(bank.dance!.duration).toBeLessThanOrEqual(4.4 + 1e-6);
  });

  it("stores unit limb directions", () => {
    const w = bank.walk!;
    for (let i = 0; i < w.frames; i++) {
      for (const arr of [w.armL, w.armR, w.legL, w.legR]) {
        expect(Math.hypot(arr[i * 3]!, arr[i * 3 + 1]!, arr[i * 3 + 2]!)).toBeCloseTo(1, 4);
      }
    }
  });

  it("swings arms and legs in anti-phase while walking (a real gait, not a pose)", () => {
    const w = bank.walk!;
    expect(corr(fwd(w.legL, w.frames), fwd(w.legR, w.frames))).toBeLessThan(-0.8);
    expect(corr(fwd(w.armL, w.frames), fwd(w.armR, w.frames))).toBeLessThan(-0.8);
    // Contralateral swing: the left arm moves with the right leg.
    expect(corr(fwd(w.armL, w.frames), fwd(w.legR, w.frames))).toBeGreaterThan(0.5);
    const range = Math.max(...fwd(w.legL, w.frames)) - Math.min(...fwd(w.legL, w.frames));
    expect(range).toBeGreaterThan(0.4);
  });

  it("keeps legs pointing down and arms hanging at idle", () => {
    const p = newPose();
    sampleClip(bank.idle!, 0.3, p);
    expect(p.legL.y).toBeLessThan(-0.9);
    expect(p.legR.y).toBeLessThan(-0.9);
    expect(p.armL.y).toBeLessThan(-0.6);
    expect(p.armR.y).toBeLessThan(-0.6);
  });

  it("bakes the sad and sneak poses from their expression key, not the reference stance", () => {
    // Mixamo's two-key pose clips start on the idle stance; sampling key 0 once made both poses identical to idle.
    const idle = newPose(), sad = newPose(), sneak = newPose();
    sampleClip(bank.idle!, 0, idle);
    sampleClip(bank.sad!, 0, sad);
    sampleClip(bank.sneak!, 0, sneak);
    const deg = (q: THREE.Quaternion) => (2 * Math.acos(Math.min(1, Math.abs(q.w))) * 180) / Math.PI;
    const between = (a: THREE.Quaternion, b: THREE.Quaternion) => deg(a.clone().invert().multiply(b));
    expect(between(idle.head, sad.head)).toBeGreaterThan(30); // head drops
    expect(between(idle.body, sad.body)).toBeGreaterThan(10); // shoulders slump
    expect(sneak.armL.z - idle.armL.z).toBeGreaterThan(0.25); // arms come forward to creep
    expect(sneak.armR.z - idle.armR.z).toBeGreaterThan(0.25);
    expect(between(idle.body, sneak.body)).toBeGreaterThan(8); // leans in
    // Rigid legs cannot crouch: a held pose never moves the hips, so it cannot sink or slide the feet.
    for (const p of [sad, sneak]) expect(p.hips.length()).toBe(0);
  });

  it("never pushes the hips below the floor and loops seamlessly", () => {
    for (const c of [bank.walk!, bank.run!, bank.idle!]) {
      let min = Infinity;
      for (let i = 0; i < c.frames; i++) min = Math.min(min, c.hips[i * 3 + 1]!);
      expect(min).toBeGreaterThanOrEqual(-1e-6);
    }
    const a = newPose(), b = newPose();
    sampleClip(bank.walk!, 0, a);
    sampleClip(bank.walk!, bank.walk!.duration, b);
    expect(a.legL.distanceTo(b.legL)).toBeLessThan(0.05);
    expect(a.armR.distanceTo(b.armR)).toBeLessThan(0.05);
  });

  it("head shake and nod move the head, and stay unit-quaternions", () => {
    const yawRange = (c: ClipBank[string]) => {
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < c.frames; i++) {
        const q = new THREE.Quaternion().fromArray(c.head, i * 4);
        const e = new THREE.Euler().setFromQuaternion(q, "YXZ");
        lo = Math.min(lo, e.y); hi = Math.max(hi, e.y);
        expect(q.length()).toBeCloseTo(1, 4);
      }
      return hi - lo;
    };
    expect(yawRange(bank.no!)).toBeGreaterThan(0.3);
  });

  it("mixPose is a convex blend", () => {
    const a = newPose(), b = newPose();
    sampleClip(bank.idle!, 0, a);
    sampleClip(bank.walk!, 0.2, b);
    const c = newPose();
    sampleClip(bank.idle!, 0, c);
    mixPose(c, b, 0);
    expect(c.legL.distanceTo(a.legL)).toBeLessThan(1e-6);
    mixPose(c, b, 1);
    expect(c.legL.distanceTo(b.legL)).toBeLessThan(1e-5);
  });
});

describe("MixamoDriver on the Kip character rig", () => {
  it("is not applicable to vehicles and robots", () => {
    const d = new MixamoDriver(bank);
    expect(d.canDrive(buildToy("vehicle", stockSel().vehicle as never, stockCol()))).toBe(false);
  });

  it("maps CAD-frame directions onto the stage-aligned arm holders", () => {
    // Build a minimal rig by hand: two stage-aligned arm holders and a head, as the STL rig does.
    const rig = buildToy("character", stockSel().character as never, stockCol());
    rig.arms.length = 0;
    const armL = new THREE.Group(), armR = new THREE.Group();
    rig.arms.push(armL, armR);
    rig.head = new THREE.Group();
    const d = new MixamoDriver(bank);
    expect(d.canDrive(rig)).toBe(true);
    // A walking clip must swing the left arm forward while the right goes back, in stage +X / -X.
    const fwdVec = (o: THREE.Object3D) => new THREE.Vector3(0, -1, 0).applyQuaternion(o.quaternion).x;
    let maxL = -Infinity, minL = Infinity, anti = 0, n = 0;
    for (let i = 0; i < 120; i++) {
      d.update(rig, 1 / 60, 2.4);
      if (i < 30) continue; // let the idle -> walk blend settle
      const l = fwdVec(armL), r = fwdVec(armR);
      maxL = Math.max(maxL, l); minL = Math.min(minL, l);
      anti += l * r < 0 ? 1 : 0; n++;
    }
    expect(maxL - minL).toBeGreaterThan(0.25); // real swing in stage X
    expect(anti / n).toBeGreaterThan(0.6); // opposite sides most of the time
  });

  it("stands still at idle and moves when walking (arms barely swing at speed 0)", () => {
    const rig = buildToy("character", stockSel().character as never, stockCol());
    rig.arms.length = 0;
    const armL = new THREE.Group(), armR = new THREE.Group();
    rig.arms.push(armL, armR);
    rig.head = new THREE.Group();
    const d = new MixamoDriver(bank);
    const swing = (speed: number) => {
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < 180; i++) {
        d.update(rig, 1 / 60, speed);
        const x = new THREE.Vector3(0, -1, 0).applyQuaternion(armL.quaternion).x;
        lo = Math.min(lo, x); hi = Math.max(hi, x);
      }
      return hi - lo;
    };
    const idle = swing(0);
    const walk = swing(2.4);
    expect(walk).toBeGreaterThan(idle * 3);
  });

  it("plays a one-shot dance and releases it", () => {
    const rig = buildToy("character", stockSel().character as never, stockCol());
    rig.arms.length = 0;
    rig.arms.push(new THREE.Group(), new THREE.Group());
    rig.head = new THREE.Group();
    const d = new MixamoDriver(bank);
    expect(d.trigger("dance")).toBe(true);
    d.update(rig, 0.5, 0);
    expect(d.busyAction).toBe("dance");
    for (let i = 0; i < 400; i++) d.update(rig, 1 / 60, 0);
    expect(d.busyAction).toBeNull();
  });

  it("drives the real STL Kip rig: hip pivots exist and the legs swing from the hip", async () => {
    const full = (u: string) => resolve(ROOT, "public", u.replace(/^\//, "").split("?")[0]!);
    const fetcher = (u: string) => {
      const f = full(u);
      if (!existsSync(f)) return Promise.resolve(null);
      const b = readFileSync(f);
      return Promise.resolve(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
    };
    {
      const sel = stockSel().character as never;
      const col = stockCol();
      const rig = buildToy("character", sel, col);
      const tok = { cancelled: false };
      await upgradeRigWithStl(rig, { type: "character", sel, col, toyId: "kip", token: tok, fetcher } as never);
      expect(rig.feet.length).toBe(2);
      const hip = rig.feet[0]!.userData.hip as THREE.Object3D | undefined;
      expect(hip).toBeTruthy();
      expect(hip!.position.y).toBeCloseTo(61.5 * 0.0185, 4);
      const d = new MixamoDriver(bank);
      expect(d.canDrive(rig)).toBe(true);
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < 180; i++) {
        d.update(rig, 1 / 60, 2.4);
        const x = new THREE.Vector3(0, -1, 0).applyQuaternion(hip!.quaternion).x;
        lo = Math.min(lo, x); hi = Math.max(hi, x);
      }
      expect(hi - lo).toBeGreaterThan(0.3);
    }
  });
});
