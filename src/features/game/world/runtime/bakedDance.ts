// The baked Mixamo dances for the GAME's character (docs/specs/dance-party-spec.md 3.1c and 5.1; Dan, 2026-11-03: "dance variety").
//
// public/kip/mixamo/baked/*.json holds each dance as joint rotations for the Kip BENCH's 14-joint rig (scripts/mixamo-bake.mjs: retargeted, closed into a loop, feet planted).
// The game's character is driven differently (runtime/mixamo.ts): one rigid segment per limb, so a clip is per-frame world limb DIRECTIONS (shoulder to hand, hip to ankle),
// a body and a head rotation, and a hips offset in hip-heights. This module turns the first into the second by forward kinematics on the same rig numbers, in the same CAD
// frame (+Y up, +Z forward, +X the figure's left), so one baked file feeds both and nothing is baked twice. It is pure: JSON in, a `BakedClip` out.
//
//   parseJointClip   check an untrusted JSON file field by field (a file that is not exactly what the bake wrote is refused, never guessed at)
//   jointClipToGame  forward kinematics: limb directions, body, head, hips
//   beatHit          where in a beat the dancer's weight lands (the hips' lowest points), so it can be put ON the song's beat
//
// What is approximated, on purpose: the bench's arms have two segments, the game's one. The hand direction is taken with the upper arm and forearm of EQUAL length (the
// rig's arm lengths are not constants anywhere); the legs use the real numbers (LEG_RIG). Both are direction-only, so the error is a few degrees of reach, not a pose.
import * as THREE from "three";
import type { BakedClip } from "./mixamo";

/** The bench rig's numbers, copied from parts/kip/viewer/kip-clips.js (tests/baked-dance.test.ts fails if they drift). */
export const KIP_HIP_Y = 61.5;
export const KIP_LEG = { hipX: 10.8, thigh: 25.6, shin: [0, -26, -1.5] as const };

export const KIP_JOINTS = ["Hips", "Head", "LeftArm", "LeftForeArm", "LeftHand", "RightArm", "RightForeArm", "RightHand", "LeftUpLeg", "LeftLeg", "LeftFoot", "RightUpLeg", "RightLeg", "RightFoot"] as const;
export type KipJoint = (typeof KIP_JOINTS)[number];

const MAX_FRAMES = 1500;
const ID = /^[a-z0-9_]{1,40}$/;

/** A baked joint file (scripts/mixamo-bake.mjs), checked. */
export interface JointClip {
  id: string;
  group: string;
  fps: number;
  frames: number;
  dur: number;
  /** Hips position per frame, rig units: frames x 3. */
  hips: Float32Array;
  /** Local joint rotations per frame (x, y, z, w): frames x 4 each. */
  q: Record<KipJoint, Float32Array>;
  loop: boolean;
  bpm?: number;
  beats?: number;
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** The file as the bake wrote it, or null. Every number is finite, every array the length the frame count says, and a rotation that is not a rotation is refused. */
export function parseJointClip(raw: unknown): JointClip | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 || typeof r.id !== "string" || !ID.test(r.id) || typeof r.group !== "string") return null;
  if (!finite(r.fps) || r.fps < 1 || r.fps > 120 || !Number.isInteger(r.frames) || (r.frames as number) < 2 || (r.frames as number) > MAX_FRAMES || !finite(r.dur) || r.dur <= 0 || r.dur > 60) return null;
  const frames = r.frames as number;
  // the frames run evenly from 0 to dur (the driver samples them that way): the numbers must agree
  if (Math.abs((frames - 1) / r.fps - r.dur) > 0.05) return null;
  const nums = (a: unknown, n: number): Float32Array | null => {
    if (!Array.isArray(a) || a.length !== n) return null;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) { const v = a[i]; if (!finite(v)) return null; out[i] = v; }
    return out;
  };
  const hips = nums(r.hips, frames * 3);
  if (!hips) return null;
  const qr = r.q;
  if (typeof qr !== "object" || qr === null) return null;
  const q = {} as Record<KipJoint, Float32Array>;
  for (const j of KIP_JOINTS) {
    const a = nums((qr as Record<string, unknown>)[j], frames * 4);
    if (!a) return null;
    for (let i = 0; i < frames; i++) { const n = Math.hypot(a[i * 4]!, a[i * 4 + 1]!, a[i * 4 + 2]!, a[i * 4 + 3]!); if (n < 0.9 || n > 1.1) return null; }
    q[j] = a;
  }
  const out: JointClip = { id: r.id, group: r.group, fps: r.fps, frames, dur: r.dur, hips, q, loop: true };
  if (finite(r.bpm) && r.bpm > 0) out.bpm = r.bpm;
  if (Number.isInteger(r.beats) && (r.beats as number) > 0) out.beats = r.beats as number;
  return out;
}

const _q = new THREE.Quaternion();
const _qh = new THREE.Quaternion();
const _qu = new THREE.Quaternion();
const _qf = new THREE.Quaternion();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);
const readQ = (arr: Float32Array, i: number, out: THREE.Quaternion) => out.set(arr[i * 4]!, arr[i * 4 + 1]!, arr[i * 4 + 2]!, arr[i * 4 + 3]!).normalize();

/** Forward kinematics of a whole clip into the game's per-frame channels. `name` is the bank name it will be played under. */
export function jointClipToGame(c: JointClip, name: string): BakedClip {
  const n = c.frames;
  const out: BakedClip = {
    name, duration: c.dur, loop: true, pose: false, frames: n,
    hips: new Float32Array(n * 3), body: new Float32Array(n * 4), head: new Float32Array(n * 4),
    armL: new Float32Array(n * 3), armR: new Float32Array(n * 3), legL: new Float32Array(n * 3), legR: new Float32Array(n * 3),
  };
  const x0 = c.hips[0]!, z0 = c.hips[2]!;
  let minY = Infinity;
  for (let i = 0; i < n; i++) minY = Math.min(minY, c.hips[i * 3 + 1]!);
  const arm = (shoulder: Float32Array, fore: Float32Array, into: Float32Array, i: number) => {
    readQ(shoulder, i, _qu).premultiply(_qh); // upper arm, world
    readQ(fore, i, _qf).premultiply(_qu);     // forearm, world
    _a.copy(DOWN).applyQuaternion(_qu);       // shoulder to elbow (unit length)
    _b.copy(DOWN).applyQuaternion(_qf);       // elbow to hand (the same length: see the header)
    _a.add(_b).normalize();
    into[i * 3] = _a.x; into[i * 3 + 1] = _a.y; into[i * 3 + 2] = _a.z;
  };
  const leg = (up: Float32Array, knee: Float32Array, into: Float32Array, i: number) => {
    readQ(up, i, _qu).premultiply(_qh);
    readQ(knee, i, _qf).premultiply(_qu);
    _a.set(0, -KIP_LEG.thigh, 0).applyQuaternion(_qu);                                // hip to knee
    _b.set(KIP_LEG.shin[0], KIP_LEG.shin[1], KIP_LEG.shin[2]).applyQuaternion(_qf);   // knee to ankle
    _a.add(_b).normalize();
    into[i * 3] = _a.x; into[i * 3 + 1] = _a.y; into[i * 3 + 2] = _a.z;
  };
  for (let i = 0; i < n; i++) {
    readQ(c.q.Hips, i, _qh);
    out.body.set([_qh.x, _qh.y, _qh.z, _qh.w], i * 4);
    readQ(c.q.Head, i, _q).premultiply(_qh);
    out.head.set([_q.x, _q.y, _q.z, _q.w], i * 4);
    arm(c.q.LeftArm, c.q.LeftForeArm, out.armL, i);
    arm(c.q.RightArm, c.q.RightForeArm, out.armR, i);
    leg(c.q.LeftUpLeg, c.q.LeftLeg, out.legL, i);
    leg(c.q.RightUpLeg, c.q.RightLeg, out.legR, i);
    // hips, as the game's own bake has it: x and z from where the clip began, y from its lowest point (the toy only ever lifts, never sinks its rigid legs), in hip-heights
    out.hips[i * 3] = (c.hips[i * 3]! - x0) / KIP_HIP_Y;
    out.hips[i * 3 + 1] = (c.hips[i * 3 + 1]! - minY) / KIP_HIP_Y;
    out.hips[i * 3 + 2] = (c.hips[i * 3 + 2]! - z0) / KIP_HIP_Y;
  }
  return out;
}

export interface BeatHit {
  /** Seconds into the clip at which the weight lands, averaged round a beat (0 to one beat). */
  offset: number;
  /** 0 to 1: how consistently the lowest points sit at that phase. Under `MIN_HIT_CONSISTENCY` the hips are not a good beat marker and the offset is 0. */
  consistency: number;
  /** How many lowest points were found. */
  lows: number;
}
export const MIN_HIT_CONSISTENCY = 0.35;

/**
 * Where in a beat the dance's weight lands, from the lowest points of the hips: the circular mean of each low point's position within a beat, `beats` beats to the loop. A dance whose hips
 * do not keep a steady phase (consistency under MIN_HIT_CONSISTENCY) is not shifted at all.
 */
export function beatHit(clip: Pick<BakedClip, "hips" | "frames" | "duration">, beats: number): BeatHit {
  const n = clip.frames;
  const beat = clip.duration / beats;
  if (!(beats > 0) || !Number.isFinite(beat) || !(beat > 0) || n < 8) return { offset: 0, consistency: 0, lows: 0 };
  const ys = Array.from({ length: n }, (_, i) => clip.hips[i * 3 + 1]!);
  const lo = Math.min(...ys), hi = Math.max(...ys);
  if (hi - lo < 1e-4) return { offset: 0, consistency: 0, lows: 0 };
  const mid = (lo + hi) / 2;
  let sx = 0, sy = 0, lows = 0;
  for (let i = 0; i < n; i++) {
    const a = ys[(i - 1 + n) % n]!, b = ys[i]!, d = ys[(i + 1) % n]!;
    if (b < a && b <= d && b < mid) {
      const t = (i / (n - 1)) * clip.duration;
      const ph = ((t % beat) / beat) * 2 * Math.PI;
      sx += Math.cos(ph); sy += Math.sin(ph); lows++;
    }
  }
  if (!lows) return { offset: 0, consistency: 0, lows: 0 };
  const consistency = Math.hypot(sx, sy) / lows;
  if (consistency < MIN_HIT_CONSISTENCY) return { offset: 0, consistency, lows };
  const ang = Math.atan2(sy, sx);
  return { offset: (((ang / (2 * Math.PI)) % 1) + 1) % 1 * beat, consistency, lows };
}
