// The Snap Kip's fake rigging (src/features/game/world/runtime/snapFlex.ts), ported from the Kip bench. The rules are stated once, as functions of an implementation, so the same
// checks can be run on versions that are wrong on purpose and must fail (a rule that cannot fail proves nothing). The end-to-end check, the game's Kip against the bench's Kip in
// real Chrome, is scripts/e2e-game-dance-rig.mjs.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  FLEX_ASSEMBLED,
  SNAP_ARM_FLEX,
  SNAP_ARM_REST_INV_Q,
  SNAP_CUFF_Q,
  SNAP_LEG_FLEX,
  makeFlexLimb,
  newSnapArmSolution,
  newSnapLegSolution,
  solveSnapArm,
  solveSnapLeg,
  type SnapArmSolution,
  type SnapLegSolution,
} from "../src/features/game/world/runtime/snapFlex";
import { parseStlGeometry } from "../src/features/game/world/runtime/stlRigLoader";

const Q = (x: number, y: number, z: number, deg: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(x, y, z).normalize(), THREE.MathUtils.degToRad(deg));
const near = (a: number, b: number, eps = 1e-4) => Math.abs(a - b) <= eps;
const nearV = (a: THREE.Vector3, b: THREE.Vector3, eps = 1e-4) => a.distanceTo(b) <= eps;
const nearQ = (a: THREE.Quaternion, b: THREE.Quaternion, eps = 1e-5) => 1 - Math.abs(a.dot(b)) <= eps;

/** A one-piece limb in print orientation: 10 x 10 mm, 38 mm long along +Z, cut into 38 slices so a bend has vertices to bend. */
function limbBox(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(10, 10, 38, 1, 1, 38);
  g.translate(0, 0, 19);
  return g;
}
/** A geometry that is a single point, placed so that AFTER makeFlexLimb stands it up and offsets it, it sits at `rest` (x, y, z) in the limb's own frame. */
function pointAt(rest: THREE.Vector3, offsetY: number): THREE.BufferGeometry {
  // makeFlexLimb: rotateX(-90 deg) maps (x, y, z) to (x, z, -y), then translates by (0, offsetY, 0). Invert that.
  const v = new THREE.Vector3(rest.x, -rest.z, rest.y - offsetY);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([v.x, v.y, v.z, v.x, v.y, v.z, v.x, v.y, v.z], 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  return g;
}
const posOf = (g: THREE.BufferGeometry, i: number) => new THREE.Vector3().fromBufferAttribute(g.attributes.position as THREE.BufferAttribute, i);
const normOf = (g: THREE.BufferGeometry, i: number) => new THREE.Vector3().fromBufferAttribute(g.attributes.normal as THREE.BufferAttribute, i);

describe("bending a one-piece limb about its mid-point", () => {
  const cfg = SNAP_ARM_FLEX;
  const make = () => makeFlexLimb(limbBox(), cfg.offsetY, cfg.midY, cfg.midZ, cfg.band);

  it("stands the part up and places it: 38 mm of limb hangs from the offset", () => {
    const { geometry } = make();
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox!;
    expect(near(bb.min.y, cfg.offsetY, 1e-3)).toBe(true);
    expect(near(bb.max.y, cfg.offsetY + 38, 1e-3)).toBe(true);
  });

  it("does not touch the source geometry it was made from (the rig shares its cached STLs)", () => {
    const src = limbBox();
    const before = Float32Array.from(src.attributes.position!.array as Float32Array);
    const f = makeFlexLimb(src, cfg.offsetY, cfg.midY, cfg.midZ, cfg.band);
    f.deform(Q(1, 0, 0, 80));
    expect(Array.from(src.attributes.position!.array as Float32Array)).toEqual(Array.from(before));
  });

  /** The rules, as a function of the bend, so a broken bend can be run through them. Returns what is wrong. */
  function bendFailures(deformWith: (f: ReturnType<typeof make>, q: THREE.Quaternion) => void): string[] {
    const bad: string[] = [];
    const f = make();
    const rest = Float32Array.from(f.geometry.attributes.position!.array as Float32Array);
    const restN = Float32Array.from(f.geometry.attributes.normal!.array as Float32Array);
    const q = Q(1, 0, 0, 90);
    deformWith(f, q);
    const pivot = new THREE.Vector3(0, cfg.midY, cfg.midZ);
    const R = new THREE.Matrix4().makeRotationFromQuaternion(q);
    const n = f.geometry.attributes.position!.count;
    for (let i = 0; i < n; i++) {
      const r = new THREE.Vector3(rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2]);
      const p = posOf(f.geometry, i);
      if (r.y > cfg.midY + cfg.band + 1e-3) { if (!nearV(p, r)) { bad.push("above the bend the limb must not move"); break; } }
    }
    for (let i = 0; i < n; i++) {
      const r = new THREE.Vector3(rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2]);
      const p = posOf(f.geometry, i);
      if (r.y < cfg.midY - cfg.band - 1e-3) {
        const want = r.clone().sub(pivot).applyMatrix4(R).add(pivot);
        if (!nearV(p, want, 1e-3)) { bad.push("below the bend the limb turns as a whole about the pivot"); break; }
      }
    }
    for (let i = 0; i < n; i++) { const m = normOf(f.geometry, i).length(); if (!near(m, 1, 2e-3)) { bad.push("normals stay unit length"); break; } }
    // below the zone the normals turn with the surface (a bend that leaves them at rest would light the bent sleeve wrongly)
    for (let i = 0; i < n; i++) {
      const r = new THREE.Vector3(rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2]);
      if (r.y >= cfg.midY - cfg.band - 1e-3) continue;
      const want = new THREE.Vector3(restN[i * 3], restN[i * 3 + 1], restN[i * 3 + 2]).applyQuaternion(q);
      if (normOf(f.geometry, i).distanceTo(want) > 2e-3) { bad.push("normals turn with the surface below the bend"); break; }
    }
    // a smooth zone: moving down the limb the turn only grows, and never jumps
    const centre: { y: number; a: number }[] = [];
    for (let i = 0; i < n; i++) {
      const r = new THREE.Vector3(rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2]);
      if (Math.abs(r.x) < 1e-3 || Math.abs(r.x - 5) > 1e-3) continue; // the +X face edge, one vertex per slice
      if (Math.abs(r.z - -5) > 1e-3 && Math.abs(r.z - 5) > 1e-3) { /* keep every vertex of the column */ }
      const p = posOf(f.geometry, i);
      const a0 = Math.atan2(r.z - cfg.midZ, r.y - cfg.midY), a1 = Math.atan2(p.z - cfg.midZ, p.y - cfg.midY);
      let d = a1 - a0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      centre.push({ y: r.y, a: d });
    }
    centre.sort((p, q2) => q2.y - p.y);
    for (let i = 1; i < centre.length; i++) if (Math.abs(centre[i]!.a) + 1e-6 < Math.abs(centre[i - 1]!.a) - 1e-3 || Math.abs(centre[i]!.a - centre[i - 1]!.a) > 0.5) { bad.push("the turn grows smoothly down the zone"); break; }
    return bad;
  }

  it("follows the rules: still above the bend, turning as a whole below it, smooth between, normals unit length", () => {
    expect(bendFailures((f, q) => f.deform(q))).toEqual([]);
  });

  it("fails the same rules on a bend that moves the top, one that is not smooth (a hard step) and one that forgets the normals (so the check can fail)", () => {
    const hardStep = (f: ReturnType<typeof make>, q: THREE.Quaternion) => {
      f.deform(q);
      const pos = f.geometry.attributes.position as THREE.BufferAttribute;
      const R = new THREE.Matrix4().makeRotationFromQuaternion(q);
      for (let i = 0; i < pos.count; i++) { const p = new THREE.Vector3().fromBufferAttribute(pos, i); if (p.y < cfg.midY - 0.01 && p.y > cfg.midY - 6) { p.sub(new THREE.Vector3(0, cfg.midY, cfg.midZ)).applyMatrix4(R).add(new THREE.Vector3(0, cfg.midY, cfg.midZ)); pos.setXYZ(i, p.x, p.y, p.z); } }
    };
    const movesTop = (f: ReturnType<typeof make>, q: THREE.Quaternion) => { f.deform(q); const pos = f.geometry.attributes.position as THREE.BufferAttribute; pos.setY(0, pos.getY(0) + 3); };
    const noNormals = (f: ReturnType<typeof make>, q: THREE.Quaternion) => { f.deform(q); const nrm = f.geometry.attributes.normal as THREE.BufferAttribute; for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, nrm.getX(i) * 3, nrm.getY(i) * 3, nrm.getZ(i) * 3); };
    expect(bendFailures(movesTop).length).toBeGreaterThan(0);
    expect(bendFailures(hardStep).length).toBeGreaterThan(0);
    expect(bendFailures(noNormals).length).toBeGreaterThan(0);
  });

  it("an identity rotation gives the rest shape back exactly, after a bend, and a rotation and its negative are the same bend", () => {
    const f = make();
    const rest = Float32Array.from(f.geometry.attributes.position!.array as Float32Array);
    const restN = Float32Array.from(f.geometry.attributes.normal!.array as Float32Array);
    f.deform(Q(1, 0.2, 0, 70));
    const bent = Float32Array.from(f.geometry.attributes.position!.array as Float32Array);
    expect(Array.from(bent)).not.toEqual(Array.from(rest));
    const q = Q(0.3, 1, 0.1, 55), nq = new THREE.Quaternion(-q.x, -q.y, -q.z, -q.w);
    f.deform(q); const a = Float32Array.from(f.geometry.attributes.position!.array as Float32Array);
    f.deform(nq); const b = Float32Array.from(f.geometry.attributes.position!.array as Float32Array);
    expect(Array.from(a)).toEqual(Array.from(b));
    f.deform(new THREE.Quaternion());
    expect(Array.from(f.geometry.attributes.position!.array as Float32Array)).toEqual(Array.from(rest));
    expect(Array.from(f.geometry.attributes.normal!.array as Float32Array)).toEqual(Array.from(restN));
  });
});

describe("the arm: where the hand goes when the sleeve bends", () => {
  it("at rest, with nothing bent, the hand is where the rigid arm had it (0, -35, 3.8), tilted 11 degrees, and nothing else turns", () => {
    const s = solveSnapArm(new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion(), 0, newSnapArmSolution());
    expect(nearV(s.cuffPos, new THREE.Vector3(0, -35, 3.8))).toBe(true);
    expect(nearQ(s.cuffQ, SNAP_CUFF_Q)).toBe(true);
    expect(nearV(s.handPos, new THREE.Vector3(0, -0.5, 0))).toBe(true);
    for (const q of [s.shoulder, s.flex, s.handQ]) expect(nearQ(q, new THREE.Quaternion())).toBe(true);
  });

  it("flexing at the assembled factor with no elbow rotation still straightens the sculpted 15 degree bend (the bench does: hands line up with Pro Kip's)", () => {
    const s = solveSnapArm(new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion(), FLEX_ASSEMBLED, newSnapArmSolution());
    const want = new THREE.Quaternion().slerp(SNAP_ARM_REST_INV_Q, FLEX_ASSEMBLED);
    expect(nearQ(s.flex, want)).toBe(true);
  });

  it("a fully flexing sleeve hands the shoulder and the wrist nothing of the elbow; a rigid one hands them 0.55 of it", () => {
    const sh = Q(0, 0, 1, 30), el = Q(1, 0, 0, 100), wr = Q(0, 1, 0, 20);
    const full = solveSnapArm(sh, el, wr, 1, newSnapArmSolution());
    expect(nearQ(full.shoulder, sh)).toBe(true);
    expect(nearQ(full.handQ, wr)).toBe(true);
    const rigid = solveSnapArm(sh, el, wr, 0, newSnapArmSolution());
    const share = new THREE.Quaternion().slerp(el, 0.55);
    expect(nearQ(rigid.shoulder, sh.clone().multiply(share))).toBe(true);
    expect(nearQ(rigid.handQ, wr.clone().premultiply(share))).toBe(true);
  });

  // THE rule that ties the two halves together: the point where the hand is attached must lie ON the bent sleeve, wherever the bend puts it
  const rng = (() => { let s = 12345; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();
  const randomQ = () => new THREE.Quaternion(rng() - 0.5, rng() - 0.5, rng() - 0.5, rng() + 0.2).normalize();
  function cuffOnSleeveFailures(solve: (sh: THREE.Quaternion, el: THREE.Quaternion, wr: THREE.Quaternion, ff: number, out: SnapArmSolution) => SnapArmSolution): string[] {
    const bad: string[] = [];
    for (let k = 0; k < 40; k++) {
      const ff = k % 4 === 0 ? 0 : k % 4 === 1 ? 0.5 : k % 4 === 2 ? FLEX_ASSEMBLED : 1;
      const s = solve(randomQ(), randomQ(), randomQ(), ff, newSnapArmSolution());
      const f = makeFlexLimb(pointAt(new THREE.Vector3(0, -35, 3.8), SNAP_ARM_FLEX.offsetY), SNAP_ARM_FLEX.offsetY, SNAP_ARM_FLEX.midY, SNAP_ARM_FLEX.midZ, SNAP_ARM_FLEX.band);
      f.deform(s.flex);
      if (!nearV(posOf(f.geometry, 0), s.cuffPos, 1e-3)) { bad.push("the hand's attach point is on the bent sleeve"); break; }
    }
    return bad;
  }
  it("puts the hand's attach point exactly on the end of the bent sleeve, for any rotation and any flex", () => {
    expect(cuffOnSleeveFailures(solveSnapArm)).toEqual([]);
  });
  it("fails that rule on a solver that bends about the wrong pivot, and on one that forgets the cuff offset (so the check can fail)", () => {
    const wrongPivot: typeof solveSnapArm = (a, b, c, ff, out) => { const s = solveSnapArm(a, b, c, ff, out); s.cuffPos.z -= 1.2; return s; };
    const noOffset: typeof solveSnapArm = (a, b, c, ff, out) => { const s = solveSnapArm(a, b, c, ff, out); s.cuffPos.set(0, -35, 3.8); return s; };
    expect(cuffOnSleeveFailures(wrongPivot).length).toBeGreaterThan(0);
    expect(cuffOnSleeveFailures(noOffset).length).toBeGreaterThan(0);
  });
});

describe("the leg: where the foot goes when the sleeve bends at the knee", () => {
  it("at rest the foot joint is where the rigid leg had it: (0, -39.2, 0) then (0, -0.4, -1.5)", () => {
    const s = solveSnapLeg(new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion(), 0, newSnapLegSolution());
    expect(nearV(s.anklePos, new THREE.Vector3(0, -39.2, 0))).toBe(true);
    expect(nearV(s.footPos, new THREE.Vector3(0, -0.4, -1.5))).toBe(true);
    for (const q of [s.hip, s.flex, s.ankleQ, s.footQ]) expect(nearQ(q, new THREE.Quaternion())).toBe(true);
  });
  it("a fully flexing sleeve hands the hip and the ankle nothing of the knee; a rigid one hands them 0.35 of it", () => {
    const hp = Q(1, 0, 0, -40), kn = Q(1, 0, 0, 80), an = Q(1, 0, 0, -20);
    const full = solveSnapLeg(hp, kn, an, 1, newSnapLegSolution());
    expect(nearQ(full.hip, hp)).toBe(true);
    expect(nearQ(full.footQ, an)).toBe(true);
    const rigid = solveSnapLeg(hp, kn, an, 0, newSnapLegSolution());
    const share = new THREE.Quaternion().slerp(kn, 0.35);
    expect(nearQ(rigid.hip, hp.clone().multiply(share))).toBe(true);
    expect(nearQ(rigid.footQ, an.clone().premultiply(share))).toBe(true);
  });
  it("puts the ankle exactly on the end of the bent leg sleeve, for any knee and any flex", () => {
    let s = 777; const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const bad: string[] = [];
    for (let k = 0; k < 40; k++) {
      const knee = new THREE.Quaternion(r() - 0.5, r() - 0.5, r() - 0.5, r() + 0.2).normalize();
      const out: SnapLegSolution = solveSnapLeg(new THREE.Quaternion(), knee, new THREE.Quaternion(), k % 2 ? FLEX_ASSEMBLED : 0.5, newSnapLegSolution());
      const f = makeFlexLimb(pointAt(new THREE.Vector3(0, -39.2, 0), SNAP_LEG_FLEX.offsetY), SNAP_LEG_FLEX.offsetY, SNAP_LEG_FLEX.midY, SNAP_LEG_FLEX.midZ, SNAP_LEG_FLEX.band);
      f.deform(out.flex);
      if (!nearV(posOf(f.geometry, 0), out.anklePos, 1e-3)) { bad.push("ankle on the sleeve"); break; }
    }
    expect(bad).toEqual([]);
  });
});


// The bend runs every frame a clip with joints plays, over a triangle soup of about 30,000 vertices a limb (2026-11-05, performance). It is done in three runs (never moves / in the zone / wholly
// below it), the sines and cosines come from a table, a held pose does no work and only the moving part of the buffer is uploaded. The rules are stated against the plain loop it replaced, which
// is kept here as the reference, and run on the real arm and leg.
describe("the bend is the same bend, done cheaply", () => {
  /** The plain loop over every vertex with a sine and a cosine each: what makeFlexLimb was. Works on the soup in its original order. */
  function referenceBend(src: THREE.BufferGeometry, cfg: { offsetY: number; midY: number; midZ: number; band: number }, q: THREE.Quaternion): { pos: Float32Array; nrm: Float32Array } {
    const g = src.index ? src.toNonIndexed() : src.clone();
    g.rotateX(-Math.PI / 2); g.translate(0, cfg.offsetY, 0);
    const pos = Float32Array.from(g.attributes.position!.array as Float32Array), nrm = Float32Array.from(g.attributes.normal!.array as Float32Array);
    const rp = Float32Array.from(pos), rn = Float32Array.from(nrm);
    let { x: qx, y: qy, z: qz, w: qw } = q; if (qw < 0) { qx = -qx; qy = -qy; qz = -qz; qw = -qw; }
    const sinHalf = Math.hypot(qx, qy, qz), ux = qx / sinHalf, uy = qy / sinHalf, uz = qz / sinHalf, theta = 2 * Math.acos(Math.min(1, qw));
    for (let i = 0; i < pos.length / 3; i++) {
      const w = THREE.MathUtils.smoothstep(cfg.midY - rp[i * 3 + 1]!, -cfg.band, cfg.band), i3 = i * 3;
      if (w <= 1e-4) continue;
      const c = Math.cos(w * theta), s = Math.sin(w * theta), omc = 1 - c;
      const vx = rp[i3]!, vy = rp[i3 + 1]! - cfg.midY, vz = rp[i3 + 2]! - cfg.midZ, vDot = ux * vx + uy * vy + uz * vz;
      pos[i3] = vx * c + (uy * vz - uz * vy) * s + ux * vDot * omc; pos[i3 + 1] = cfg.midY + vy * c + (uz * vx - ux * vz) * s + uy * vDot * omc; pos[i3 + 2] = cfg.midZ + vz * c + (ux * vy - uy * vx) * s + uz * vDot * omc;
      const nx = rn[i3]!, ny = rn[i3 + 1]!, nz = rn[i3 + 2]!, nDot = ux * nx + uy * ny + uz * nz;
      nrm[i3] = nx * c + (uy * nz - uz * ny) * s + ux * nDot * omc; nrm[i3 + 1] = ny * c + (uz * nx - ux * nz) * s + uy * nDot * omc; nrm[i3 + 2] = nz * c + (ux * ny - uy * nx) * s + uz * nDot * omc;
    }
    return { pos, nrm };
  }
  const stl = (name: string) => { const b = readFileSync(resolve(process.cwd(), "public/kip/stls", name)); return parseStlGeometry(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))!; };
  const REAL = [["the real sleeve", "snap_arm.stl", SNAP_ARM_FLEX], ["the real trouser leg", "snap_leg.stl", SNAP_LEG_FLEX]] as const;
  const QS = [Q(1, 0, 0, 20), Q(1, 0.2, 0, 70), Q(1, 0, 0.3, 125), Q(0.2, 1, 0.1, 40), Q(1, 0, 0, 5), Q(0, 0, 1, 160), Q(1, 1, 1, 90)];
  /** What is wrong with a version's result against the reference: per vertex through `flexSource` (the new vertex's place in the old order), positions to 0.01 mm and normals to 0.002. */
  function mismatches(src: THREE.BufferGeometry, cfg: { offsetY: number; midY: number; midZ: number; band: number }, apply: (f: ReturnType<typeof makeFlexLimb>, q: THREE.Quaternion) => void): number {
    let bad = 0;
    const f = makeFlexLimb(src, cfg.offsetY, cfg.midY, cfg.midZ, cfg.band);
    const from = f.geometry.userData.flexSource as Uint32Array;
    const pa = f.geometry.attributes.position!.array as Float32Array, na = f.geometry.attributes.normal!.array as Float32Array;
    for (const q of QS) {
      apply(f, q);
      const ref = referenceBend(src, cfg, q);
      for (let i = 0; i < from.length; i++) {
        const o = from[i]! * 3;
        if (Math.hypot(pa[i * 3]! - ref.pos[o]!, pa[i * 3 + 1]! - ref.pos[o + 1]!, pa[i * 3 + 2]! - ref.pos[o + 2]!) > 0.01 || Math.hypot(na[i * 3]! - ref.nrm[o]!, na[i * 3 + 1]! - ref.nrm[o + 1]!, na[i * 3 + 2]! - ref.nrm[o + 2]!) > 0.002) { bad++; break; }
      }
      f.deform(new THREE.Quaternion());
    }
    return bad;
  }
  for (const [label, file, cfg] of REAL) {
    it(`${label}: every vertex ends where the plain loop puts it (to 0.01 mm, normals to 0.002), for seven bends, going back to rest in between`, () => {
      expect(mismatches(stl(file), cfg, (f, q) => f.deform(q))).toBe(0);
    });
    it(`${label}: the same check fails for a bend that leaves the zone's vertices where they were, and for one that turns the zone by the whole rotation`, () => {
      const src = stl(file);
      expect(mismatches(src, cfg, (f, q) => { f.deform(q); const p = f.geometry.attributes.position as THREE.BufferAttribute; for (let i = 0; i < p.count; i += 7) p.setY(i, p.getY(i) + 0.05); })).toBeGreaterThan(0);
      expect(mismatches(src, cfg, (f, q) => { const half = new THREE.Quaternion().identity().slerp(q, 0.5); f.deform(half); })).toBeGreaterThan(0);
    });
  }
  it("the triangles are in three runs: the ones above the zone first (they never move), then the zone, then the ones wholly below it, and the upload covers only the last two", () => {
    const cfg = SNAP_ARM_FLEX;
    const f = makeFlexLimb(stl("snap_arm.stl"), cfg.offsetY, cfg.midY, cfg.midZ, cfg.band);
    f.deform(Q(1, 0, 0, 70));
    const pos = f.geometry.attributes.position as THREE.BufferAttribute;
    const rest = makeFlexLimb(stl("snap_arm.stl"), cfg.offsetY, cfg.midY, cfg.midZ, cfg.band).geometry.attributes.position as THREE.BufferAttribute;   // (an untouched copy, same order)
    const r = pos.updateRanges;
    expect(r).toHaveLength(1);
    const first = r[0]!.start / 3, end = (r[0]!.start + r[0]!.count) / 3;
    expect(first, "the never-moving run is a good share of the sleeve and is left out").toBeGreaterThan(pos.count * 0.2);
    expect(first % 3).toBe(0);
    expect(end).toBe(pos.count);
    let seenZone = false, seenBelow = false;
    for (let t = 0; t < pos.count / 3; t++) {
      const ys = [0, 1, 2].map((k) => rest.getY(t * 3 + k));
      const above = ys.every((y) => y >= cfg.midY + cfg.band - 1e-3), below = ys.every((y) => y <= cfg.midY - cfg.band + 1e-3);
      if (t * 3 < first) expect(above, `triangle ${t} in the first run is above the zone`).toBe(true);
      else if (below) seenBelow = true;
      else { expect(seenBelow, `triangle ${t}: the zone's triangles come before the wholly-below ones`).toBe(false); seenZone = true; }
    }
    expect(seenZone && seenBelow).toBe(true);
    for (let i = 0; i < first * 3; i++) expect((pos.array as Float32Array)[i]).toBe((rest.array as Float32Array)[i]);   // and the first run is exactly at rest
  });
  it("a bend held still does no work: the same rotation again changes no buffer (no new upload), a different one does, and back to rest restores only the moving part", () => {
    const cfg = SNAP_ARM_FLEX;
    const f = makeFlexLimb(stl("snap_arm.stl"), cfg.offsetY, cfg.midY, cfg.midZ, cfg.band);
    const pos = f.geometry.attributes.position as THREE.BufferAttribute, nrm = f.geometry.attributes.normal as THREE.BufferAttribute;
    const q = Q(1, 0.1, 0, 60);
    f.deform(q);
    const v = pos.version, vn = nrm.version;
    f.deform(q.clone());
    expect(pos.version, "same bend: nothing uploaded").toBe(v);
    expect(nrm.version).toBe(vn);
    f.deform(Q(1, 0.1, 0, 61));
    expect(pos.version, "another bend: uploaded").toBeGreaterThan(v);
    const v2 = pos.version;
    f.deform(new THREE.Quaternion());
    expect(pos.version, "back to rest: uploaded once").toBeGreaterThan(v2);
    const v3 = pos.version;
    f.deform(new THREE.Quaternion());
    expect(pos.version, "and at rest again: nothing").toBe(v3);
  });
  it("the real limbs have thirty thousand vertices and the first run is left alone: the work and the upload are about half", () => {
    for (const [, file, cfg] of REAL) {
      const f = makeFlexLimb(stl(file), cfg.offsetY, cfg.midY, cfg.midZ, cfg.band);
      f.deform(Q(1, 0, 0, 50));
      const pos = f.geometry.attributes.position as THREE.BufferAttribute;
      expect(pos.count).toBeGreaterThan(25000);
      const uploaded = pos.updateRanges[0]!.count / 3;
      expect(uploaded / pos.count, `${file}: share of the vertices uploaded`).toBeLessThan(0.8);
      expect(uploaded / pos.count).toBeGreaterThan(0.3);
    }
  });
});
