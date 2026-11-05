import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_TUNING,
  MixamoDriver,
  WALK_STOP_TRIM,
  walkStopPhase,
  loadMixamoBank,
  mixPose,
  newPose,
  sampleClip,
  type ClipBank,
} from "../src/features/game/world/runtime/mixamo";
import { stockCol, stockSel } from "../src/features/game/world/runtime/catalog";
import { buildToy, upgradeRigWithStl } from "../src/features/game/world/runtime/playerRig";
import { existsSync } from "node:fs";
import { loadMoves } from "../src/features/game/world/runtime/gameMoves";

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

  it("foot slide: the walk and run cycles keep pace with the REAL ground speed (extras.gait), not the eased speed, and a walking toy's planted foot goes back as fast as the ground", () => {
    const mk = () => {
      const rig = buildToy("character", stockSel().character as never, stockCol());
      rig.arms.length = 0;
      rig.arms.push(new THREE.Group(), new THREE.Group());
      rig.head = new THREE.Group();
      return rig;
    };
    const none = { headYaw: 0, headPitch: 0 };
    // the cycle clocks advance at ground speed / reference speed (the reference speeds are the measured pace of the planted foot at rate 1)
    const clocks = (gait: number, speed: number) => {
      const d = new MixamoDriver(bank);
      const rig = mk();
      const a = d as unknown as { tWalk: number; tRun: number };
      d.update(rig, 1 / 60, speed, { ...none, gait });
      const w0 = a.tWalk, r0 = a.tRun;
      for (let i = 0; i < 60; i++) d.update(rig, 1 / 60, speed, { ...none, gait });
      return { walk: a.tWalk - w0, run: a.tRun - r0 };
    };
    const t = DEFAULT_TUNING;
    expect(t.walkRefSpeed).toBeCloseTo(1.55, 2);
    expect(t.runRefSpeed).toBeCloseTo(3.1, 2);
    expect(clocks(1.55, 0).walk).toBeCloseTo(1.0, 2);              // a second of walking at its reference pace is one second of the cycle, though the eased speed still says 0
    expect(clocks(3.1, 0).run).toBeCloseTo(1.0, 2);                // and the run likewise
    expect(clocks(2.325, 0).walk).toBeCloseTo(1.5, 2);             // half as fast again on the ground, half as fast again on the clock
    // with no gait given (older callers) the eased speed drives it, as before
    const d = new MixamoDriver(bank);
    const rig = mk();
    const a = d as unknown as { wRun: number; wWalk: number };
    d.update(rig, 1 / 60, 3.4);
    expect(a.wRun).toBeGreaterThan(0.9);                           // no ease: the weights are the targets at once
    // with a gait the mix eases in over a few frames instead of popping
    const d2 = new MixamoDriver(bank);
    const b = d2 as unknown as { wRun: number };
    d2.update(mk(), 1 / 60, 0, { ...none, gait: 3.4 });
    expect(b.wRun).toBeGreaterThan(0.05);
    expect(b.wRun).toBeLessThan(0.6);
    for (let i = 0; i < 30; i++) d2.update(mk(), 1 / 60, 0, { ...none, gait: 3.4 });
    expect(b.wRun).toBeGreaterThan(0.99);
  });

  // the baked locomotion clips are Mixamo assets: a checkout without them (public/kip/mixamo/baked) skips these
  describe.skipIf(!existsSync(resolve(ROOT, "public/kip/mixamo/baked/loco_walk.json")))("foot slide at a stop: the walk ends with its feet together, and its stance is as wide as the hips", () => {
    // the real baked locomotion clips (the game adds them to the bank with loadMoves), read from disk
    let loco: ClipBank;
    beforeAll(async () => {
      loco = { ...bank };
      const fetchImpl = (async (u: string) => {
        const f = resolve(ROOT, "public", String(u).replace(/^\//, ""));
        return existsSync(f) ? { ok: true, text: async () => readFileSync(f, "utf8") } : { ok: false, text: async () => "" };
      }) as unknown as typeof fetch;
      await loadMoves({ fetchImpl, addClips: (c) => Object.assign(loco, c) });
    });
    const none = { headYaw: 0, headPitch: 0 };
    const plain = () => {
      const rig = buildToy("character", stockSel().character as never, stockCol());
      rig.arms.length = 0;
      rig.arms.push(new THREE.Group(), new THREE.Group());
      rig.head = new THREE.Group();
      return rig;
    };

    it("walkStopPhase finds the feet-together phase of the real walk clip: a half-cycle value near the measured 0.07 (the knee and foot put the boots 0.032 of a cycle after the legs)", () => {
      expect(loco.walk!.joints).toBeTruthy();                      // the baked loco clip, not the direction-only Xbot one
      const ph = walkStopPhase(loco.walk!);
      expect(ph).toBeGreaterThanOrEqual(0);
      expect(ph).toBeLessThan(0.5);
      expect(ph).toBeGreaterThan(0.05);
      expect(ph).toBeLessThan(0.09);
      expect(WALK_STOP_TRIM).toBeCloseTo(0.032, 3);
    });

    it("a walk to a mark is timed to its feet-together moment: after travelling `stopIn` at the walking pace the clock is on that phase, however far away the mark was when the walk began", () => {
      const walkRef = DEFAULT_TUNING.walkRefSpeed, dur = loco.walk!.duration;
      const want = walkStopPhase(loco.walk!);
      for (const startDist of [1.5, 1.9, 2.3]) {          // the distance the walk still has to go when the run hands over (the run covers 0.4 + 0.68 of its own)
        const d = new MixamoDriver(loco);
        const rig = plain();
        const a = d as unknown as { tWalk: number };
        let left = startDist + 12 * 3.4 / 60;
        // running in (the walk is not the visible gait yet, so its clock is re-timed every frame) ...
        for (let i = 0; i < 12; i++) {
          d.update(rig, 1 / 60, 0, { ...none, gait: 3.4, stopIn: left });
          left -= 3.4 / 60;
        }
        // ... then at the walking pace, when the walk takes over and its clock runs by itself at ground speed / walkRefSpeed
        while (left > 0) {
          d.update(rig, 1 / 60, 0, { ...none, gait: walkRef, stopIn: left });
          left -= walkRef / 60;
        }
        const ph = ((a.tWalk / dur) % 0.5 + 0.5) % 0.5;
        const err = Math.min(Math.abs(ph - want), 0.5 - Math.abs(ph - want));
        expect(err).toBeLessThan(0.04);                             // within 4 % of a cycle (a frame is 1.7 %): under 0.06 of a stage unit on the ground, where the unlocked walk was up to 0.25 of a cycle out
      }
    });

    it("without a mark (stopIn absent) the walk clock is left alone", () => {
      const d = new MixamoDriver(loco);
      const rig = plain();
      const a = d as unknown as { tWalk: number };
      for (let i = 0; i < 30; i++) d.update(rig, 1 / 60, 0, { ...none, gait: 3.4 });
      const t = a.tWalk;
      d.update(rig, 1 / 60, 0, { ...none, gait: 3.4 });
      expect(a.tWalk - t).toBeCloseTo((1 / 60) * Math.min(1.9, 3.4 / DEFAULT_TUNING.walkRefSpeed), 6);
    });

    it("a turn on the spot in steps, on the real STL rig: the stance foot stays put, the other lifts and lands further round, the body crouches a little, and both end at the idle stance facing the new way", async () => {
      const full = (u: string) => resolve(ROOT, "public", u.replace(/^\//, "").split("?")[0]!);
      const fetcher = (u: string) => {
        const f = full(u);
        if (!existsSync(f)) return Promise.resolve(null);
        const b = readFileSync(f);
        return Promise.resolve(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
      };
      const sel = stockSel().character as never;
      const col = stockCol();
      const rig = buildToy("character", sel, col);
      await upgradeRigWithStl(rig, { type: "character", sel, col, toyId: "kip", token: { cancelled: false }, fetcher } as never);
      const legs = (rig as unknown as { snap: { legs: Array<{ foot: THREE.Object3D; boot: THREE.Object3D }> } }).snap.legs;
      const root = new THREE.Group();
      root.add(rig.g);
      const v = new THREE.Vector3();
      const boots = () => legs.map((l) => v.set(l.boot.position.x, l.boot.position.y, l.boot.position.z).applyMatrix4(l.foot.matrixWorld).clone());
      const turn = (to: number, frames: number, stepsOn: boolean) => {
        const d = new MixamoDriver(loco);
        let face = 0;
        const dt = 1 / 60;
        const settle = () => { for (let i = 0; i < 60; i++) { d.update(rig, dt, 0, { ...none, gait: 0 }); } root.rotation.y = 0; root.updateMatrixWorld(true); };
        settle();
        const start = boots();
        let stance = 0, maxLift = 0, minHip = 0, finite = true;
        let prev = start;
        for (let i = 0; i < frames; i++) {
          const y = stepsOn ? d.stepTurnFace(dt, face, to, true) : null;
          face = y !== null ? y : face + Math.atan2(Math.sin(to - face), Math.cos(to - face)) * Math.min(1, dt * 10);
          root.rotation.y = face;
          d.update(rig, dt, 0, { ...none, gait: 0 });
          root.updateMatrixWorld(true);
          const b = boots();
          if (d.stepTurner.stepping) {
            const st = 1 - d.stepTurner.swing;
            stance += Math.hypot(b[st]!.x - prev[st]!.x, b[st]!.z - prev[st]!.z);
            maxLift = Math.max(maxLift, b[d.stepTurner.swing]!.y - start[d.stepTurner.swing]!.y);
          }
          minHip = Math.min(minHip, rig.g.position.y);
          if (b.some((p) => !Number.isFinite(p.x + p.y + p.z))) finite = false;
          prev = b;
        }
        // the boots in the body's frame at the end, against the start
        const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
        const rel = boots().map((p) => p.clone().applyMatrix4(inv));
        return { stance, maxLift, minHip, finite, start, rel, face, active: d.stepTurner.active };
      };
      for (const to of [Math.PI / 2, -Math.PI / 2, Math.PI]) {
        const r = turn(to, 100, true);
        expect(r.finite).toBe(true);
        expect(Math.abs(Math.atan2(Math.sin(r.face - to), Math.cos(r.face - to)))).toBeLessThan(0.03);
        expect(r.active).toBe(false);
        expect(r.stance).toBeLessThan(0.1);                       // the planted foot's path over the whole turn (it was 0.3 to 1.0 with the hop)
        expect(r.maxLift).toBeGreaterThan(0.12);                  // the swing foot really leaves the ground (the hop lifted 0.1)
        expect(r.maxLift).toBeLessThan(0.4);
        expect(r.minHip).toBeGreaterThan(-0.12);                  // a small crouch, not a squat
        expect(r.minHip).toBeLessThan(-0.02);                     // but a crouch: the straight leg cannot reach a foot that stays put while the body turns
        for (let i = 0; i < 2; i++) {                             // back at the idle stance, in the body's frame
          const idleRel = r.start[i]!;                            // the body was at yaw 0 at the start: its frame is the world frame
          expect(r.rel[i]!.distanceTo(idleRel)).toBeLessThan(0.04);
        }
      }
      // without the steps, the same turn drags the planted foot (the thing this replaces)
      const hop = turn(Math.PI / 2, 100, false);
      expect(hop.stance).toBe(0);                                  // (the planner never ran, so nothing was counted as stance)
      // a driver that never asks for steps is not touched by the overlay at all
      const a = turn(0.2, 60, true), b = turn(0.2, 60, false);
      for (let i = 0; i < 2; i++) expect(a.rel[i]!.distanceTo(b.rel[i]!)).toBeLessThan(0.05);
    });

    it("a turn cancelled halfway (a clip starts, a new mark, the facing set outright) leaves the feet finite, apart and level with the ground; the overlay fades out", async () => {
      const full = (u: string) => resolve(ROOT, "public", u.replace(/^\//, "").split("?")[0]!);
      const fetcher = (u: string) => {
        const f = full(u);
        if (!existsSync(f)) return Promise.resolve(null);
        const b = readFileSync(f);
        return Promise.resolve(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
      };
      const sel = stockSel().character as never;
      const col = stockCol();
      const rig = buildToy("character", sel, col);
      await upgradeRigWithStl(rig, { type: "character", sel, col, toyId: "kip", token: { cancelled: false }, fetcher } as never);
      const legs = (rig as unknown as { snap: { legs: Array<{ foot: THREE.Object3D; boot: THREE.Object3D }> } }).snap.legs;
      const root = new THREE.Group();
      root.add(rig.g);
      const v = new THREE.Vector3();
      const boots = () => legs.map((l) => v.set(l.boot.position.x, l.boot.position.y, l.boot.position.z).applyMatrix4(l.foot.matrixWorld).clone());
      for (const cancelAt of [8, 20, 33]) {
        const d = new MixamoDriver(loco);
        let face = 0, tface = Math.PI;
        const dt = 1 / 60;
        let minSep = 9, finite = true;
        for (let i = 0; i < 160; i++) {
          const allowed = i < cancelAt;                              // the toy is stopped from turning in steps (a clip starts, a walk takes over...)
          const y = d.stepTurnFace(dt, face, tface, allowed);
          face = y !== null ? y : face + Math.atan2(Math.sin(tface - face), Math.cos(tface - face)) * Math.min(1, dt * 10);
          root.rotation.y = face;
          d.update(rig, dt, 0, { ...none, gait: 0 });
          root.updateMatrixWorld(true);
          const b = boots();
          if (b.some((p) => !Number.isFinite(p.x + p.y + p.z))) finite = false;
          minSep = Math.min(minSep, Math.hypot(b[0]!.x - b[1]!.x, b[0]!.z - b[1]!.z));
        }
        expect(finite).toBe(true);
        expect(minSep).toBeGreaterThan(0.4);                         // never crossed or together
        expect(d.stepTurner.active).toBe(false);
        expect(d.stepTurner.w).toBe(0);
        const b = boots();
        expect(b[0]!.y).toBeLessThan(0.06);                          // both on the ground again
        expect(b[1]!.y).toBeLessThan(0.06);
        expect(Math.abs(b[0]!.y - b[1]!.y)).toBeLessThan(0.03);
      }
    });

    it("the walking stance is as wide as the idle one: the feet are no longer under the middle line (a gap of 0.3 against the hips' 0.74)", async () => {
      const full = (u: string) => resolve(ROOT, "public", u.replace(/^\//, "").split("?")[0]!);
      const fetcher = (u: string) => {
        const f = full(u);
        if (!existsSync(f)) return Promise.resolve(null);
        const b = readFileSync(f);
        return Promise.resolve(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
      };
      const sel = stockSel().character as never;
      const col = stockCol();
      const rig = buildToy("character", sel, col);
      await upgradeRigWithStl(rig, { type: "character", sel, col, toyId: "kip", token: { cancelled: false }, fetcher } as never);
      const legs = (rig as unknown as { snap: { legs: Array<{ foot: THREE.Object3D; boot: THREE.Object3D }> } }).snap.legs;
      const root = new THREE.Group();
      root.add(rig.g);
      const v = new THREE.Vector3();
      const gap = (gait: number) => {
        const d = new MixamoDriver(loco);
        let sum = 0, n = 0;
        for (let i = 0; i < 360; i++) {
          d.update(rig, 1 / 120, gait, { ...none, gait });
          root.updateMatrixWorld(true);
          if (i < 120) continue;
          const z = legs.map((l) => v.set(l.boot.position.x, l.boot.position.y, l.boot.position.z).applyMatrix4(l.foot.matrixWorld).z);
          sum += Math.abs(z[1]! - z[0]!); n++;
        }
        return sum / n;
      };
      const idle = gap(0), walk = gap(1.55), run = gap(3.4);
      expect(idle).toBeGreaterThan(0.6);
      expect(walk).toBeGreaterThan(idle * 0.8);
      expect(run).toBeGreaterThan(idle * 0.8);
    });
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
