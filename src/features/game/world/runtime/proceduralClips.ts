// Hand-authored clips for the in-game Character (Kip): eat, sour, belly_pat, yawn, sleep, hug, kick and cheer.
//
// The world's character has only the five baked Mixamo actions (dance, nod, no, sneak, sad), so nothing in the game could eat or sleep
// (docs/specs/playful-interactions-spec.md). Mixamo needs an Adobe login, so these are written by hand, as keyframes, and BAKED INTO THE SAME
// FORMAT the Mixamo clips use (`BakedClip`: per-frame hips offset, body and head orientation, four unit limb directions). The existing
// MixamoDriver then plays them like any other clip: same blending, same joints, no new rendering path.
//
// Frame (the one mixamo.ts documents): the CAD frame Kip's rig is authored in, +Y up, +Z forward, +X the figure's LEFT. A limb is one unit
// vector, shoulder to hand or hip to ankle, rest = straight down (0, -1, 0). Body and head are Euler angles in radians about X (pitch:
// positive tips the front DOWN), Y (turn) and Z (roll). Hips are a small offset in hip-heights (x left, y up, z forward).
//
// The driver applies only `bodyGain` (0.7) of a clip's body rotation, so a pose that must read as a true 90 degrees is authored at
// 90 / 0.7 and its head follows the body's applied share; `gainFor` does that sum so the numbers here stay in real degrees.
import * as THREE from "three";
import { DEFAULT_TUNING, type BakedClip, type ClipBank } from "./mixamo";

const FPS = 30;
type V3 = readonly [number, number, number];

/** One keyframe. A channel left out keeps its previous value (the first key starts from the rest pose). */
export interface Key {
  t: number;
  hips?: V3;
  body?: V3;
  head?: V3;
  armL?: V3;
  armR?: V3;
  legL?: V3;
  legR?: V3;
}

const REST = {
  hips: [0, 0, 0] as V3, body: [0, 0, 0] as V3, head: [0, 0, 0] as V3,
  armL: [0, -1, 0] as V3, armR: [0, -1, 0] as V3, legL: [0, -1, 0] as V3, legR: [0, -1, 0] as V3,
};
type Channel = keyof typeof REST;
const CHANNELS = Object.keys(REST) as Channel[];

const smooth = (x: number) => x * x * (3 - 2 * x);
const quatOf = (e: V3, gain = 1): THREE.Quaternion => new THREE.Quaternion().setFromEuler(new THREE.Euler(e[0] * gain, e[1] * gain, e[2] * gain, "XYZ"));
const unit = (v: V3): V3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

/** The body rotation to bake so that, after the driver's `bodyGain`, the body ends up rotated by `applied` (radians about one axis). */
export const gainFor = (applied: number) => applied / DEFAULT_TUNING.bodyGain;

/**
 * Bake keyframes to a BakedClip at 30 fps. Between keys the motion eases (smoothstep). `body` is baked as authored: author it with `gainFor` where the
 * true angle matters. `head` is the head's ABSOLUTE aim, like Mixamo's: pass `followBody: true` to add the share of the body rotation the driver will
 * actually apply, so the head stays on the shoulders (a lying figure keeps its head on the pillow instead of looking at the ceiling).
 */
export function bake(name: string, duration: number, loop: boolean, keys: Key[], opts: { followBody?: boolean } = {}): BakedClip {
  const ks = [...keys].sort((a, b) => a.t - b.t);
  if (!ks.length || ks[0]!.t > 0) ks.unshift({ t: 0 });
  // Resolve every channel on every key: an omitted channel carries the previous key's value.
  const full = ks.map((k) => ({ t: k.t })) as Array<{ t: number } & Record<Channel, V3>>;
  CHANNELS.forEach((c) => {
    let cur = REST[c];
    ks.forEach((k, i) => { if (k[c]) cur = k[c]!; full[i]![c] = cur; });
  });
  const frames = Math.max(2, Math.round(duration * FPS) + 1);
  const hips = new Float32Array(frames * 3), body = new Float32Array(frames * 4), head = new Float32Array(frames * 4);
  const limbs = { armL: new Float32Array(frames * 3), armR: new Float32Array(frames * 3), legL: new Float32Array(frames * 3), legR: new Float32Array(frames * 3) };
  const lerp3 = (a: V3, b: V3, f: number): V3 => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  for (let i = 0; i < frames; i++) {
    const t = Math.min(duration, (i / (frames - 1)) * duration);
    let s = 0;
    while (s < full.length - 2 && t >= full[s + 1]!.t) s++;
    const a = full[s]!, b = full[Math.min(s + 1, full.length - 1)]!;
    const span = b.t - a.t;
    const f = span > 1e-9 ? smooth(Math.max(0, Math.min(1, (t - a.t) / span))) : 1;
    const at = (c: Channel) => lerp3(a[c], b[c], f);
    hips.set(at("hips"), i * 3);
    const bq = quatOf(at("body"));
    body.set([bq.x, bq.y, bq.z, bq.w], i * 4);
    const hq = quatOf(at("head"));
    if (opts.followBody) hq.premultiply(new THREE.Quaternion().identity().slerp(bq, DEFAULT_TUNING.bodyGain));
    head.set([hq.x, hq.y, hq.z, hq.w], i * 4);
    for (const c of ["armL", "armR", "legL", "legR"] as const) limbs[c].set(unit(at(c)), i * 3);
  }
  return { name, duration, loop, pose: false, frames, hips, body, head, ...limbs };
}

const PI = Math.PI;
// The figure's right hand (-X) comes up to the mouth: forward, up and a little inward.
const HAND_TO_MOUTH: V3 = [-0.2, 0.5, 0.85];
const HAND_DOWN: V3 = [-0.12, -0.95, 0.15];
// Lying down tips the figure about its FEET, so the body would stretch away behind them. Moving the hips forward by about half a body length
// (in hip-heights) puts the middle of the lying body where the standing figure was, which is what a bed needs.
const LIE_FORWARD = 0.5;

/** The moment in the `kick` clip when the foot meets the ball (seconds): the ball is launched on this cue. */
export const KICK_CONTACT_S = 0.42;
/** The first, deeper squeeze of the `hug` clip (seconds): a heart floats up on this cue. */
export const HUG_SQUEEZE_S = 0.8;

/** Authored in real angles. Each is the whole motion, ending back at rest so it can blend out cleanly. */
export const PROCEDURAL_CLIPS: ClipBank = {
  // One bite: hand to mouth, three chews (the head bobs), a swallow, then a little happy hop. 1.7 s.
  eat: bake("eat", 1.7, false, [
    { t: 0 },
    { t: 0.35, armR: HAND_TO_MOUTH, head: [0.12, 0, 0], body: [0.06, 0, 0] },
    { t: 0.5, head: [0.3, 0, 0] }, { t: 0.65, head: [0.1, 0, 0] },
    { t: 0.8, head: [0.3, 0, 0] }, { t: 0.95, head: [0.1, 0, 0] },
    { t: 1.1, head: [0.3, 0, 0] }, { t: 1.25, head: [-0.12, 0, 0], armR: HAND_DOWN, body: [0, 0, 0] },
    { t: 1.4, hips: [0, 0.1, 0], head: [-0.05, 0, 0], armL: [0.45, -0.5, 0.1], armR: [-0.45, -0.5, 0.1] },
    { t: 1.7, hips: [0, 0, 0], head: [0, 0, 0], armL: REST.armL, armR: REST.armR },
  ]),
  // A lemon: the head pulls back, the shoulders shiver, both hands fly up for a moment. 1.1 s.
  sour: bake("sour", 1.1, false, [
    { t: 0 },
    { t: 0.18, head: [-0.28, 0, 0], body: [-0.08, 0, 0.06], armL: [0.55, 0.15, 0.2], armR: [-0.55, 0.15, 0.2] },
    { t: 0.32, body: [-0.08, 0, -0.06] }, { t: 0.46, body: [-0.08, 0, 0.06] }, { t: 0.6, body: [-0.08, 0, -0.06] },
    { t: 1.1, head: [0, 0, 0], body: [0, 0, 0], armL: REST.armL, armR: REST.armR },
  ]),
  // Full: both hands pat the belly twice and the head tips back with a happy sigh. 1.6 s.
  belly_pat: bake("belly_pat", 1.6, false, [
    { t: 0 },
    { t: 0.3, armL: [0.25, -0.55, 0.8], armR: [-0.25, -0.55, 0.8], head: [-0.15, 0, 0], body: [-0.1, 0, 0] },
    { t: 0.5, armL: [0.25, -0.5, 0.85], armR: [-0.25, -0.5, 0.85] }, { t: 0.7, armL: [0.25, -0.6, 0.75], armR: [-0.25, -0.6, 0.75] },
    { t: 0.9, armL: [0.25, -0.5, 0.85], armR: [-0.25, -0.5, 0.85] }, { t: 1.1, armL: [0.25, -0.6, 0.75], armR: [-0.25, -0.6, 0.75] },
    { t: 1.6, armL: REST.armL, armR: REST.armR, head: [0, 0, 0], body: [0, 0, 0] },
  ]),
  // A big yawn: head back, arms stretch up and out, a settle. 1.8 s.
  yawn: bake("yawn", 1.8, false, [
    { t: 0 },
    { t: 0.55, head: [-0.4, 0, 0], body: [-0.1, 0, 0], armL: [0.55, 0.7, 0.1], armR: [-0.55, 0.7, 0.1], hips: [0, 0.04, 0] },
    { t: 1.1, head: [-0.4, 0, 0] },
    { t: 1.8, head: [0, 0, 0], body: [0, 0, 0], armL: REST.armL, armR: REST.armR, hips: [0, 0, 0] },
  ]),
  // Hug a teddy: arms open forward, close in on it with a squeeze (the body leans in, the head tips down), ease off, squeeze again, let go. 2 s. The first squeeze is at HUG_SQUEEZE_S.
  hug: bake("hug", 2.0, false, [
    { t: 0 },
    { t: 0.35, armL: [0.55, -0.15, 0.8], armR: [-0.55, -0.15, 0.8], body: [0.1, 0, 0], head: [0.1, 0, 0] },
    { t: HUG_SQUEEZE_S, armL: [0.12, -0.3, 0.95], armR: [-0.12, -0.3, 0.95], body: [0.2, 0, 0], head: [0.25, 0, 0] },
    { t: 1.1, armL: [0.28, -0.3, 0.9], armR: [-0.28, -0.3, 0.9], body: [0.14, 0, 0], head: [0.18, 0, 0] },
    { t: 1.3, armL: [0.1, -0.3, 0.96], armR: [-0.1, -0.3, 0.96], body: [0.2, 0, 0], head: [0.25, 0, 0] },
    { t: 1.7, armL: [0.5, -0.4, 0.6], armR: [-0.5, -0.4, 0.6], body: [0.05, 0, 0], head: [0.05, 0, 0] },
    { t: 2.0, armL: REST.armL, armR: REST.armR, body: [0, 0, 0], head: [0, 0, 0] },
  ]),
  // Kick a ball with the figure's right leg (-X): the leg winds back, swings through to the front at KICK_CONTACT_S, follows through and comes back; the body leans back, the arms counter-swing, a small hop. 1 s.
  kick: bake("kick", 1.0, false, [
    { t: 0 },
    { t: 0.2, legR: [0.0, -0.75, -0.6], armL: [0.3, -0.6, 0.6], armR: [-0.3, -0.6, -0.5], body: [0.08, 0, 0] },
    { t: KICK_CONTACT_S, legR: [-0.05, -0.2, 0.97], armL: [0.3, -0.7, -0.4], armR: [-0.3, -0.5, 0.7], body: [-0.12, 0, 0], hips: [0, 0.04, 0] },
    { t: 0.55, legR: [0.0, 0.05, 1.0], hips: [0, 0.05, 0.02] },
    { t: 1.0, legR: REST.legR, armL: REST.armL, armR: REST.armR, body: [0, 0, 0], hips: [0, 0, 0] },
  ]),
  // A cheer for the top of a jump: both arms up and out, the head up, a little hop, then down again. 1.3 s.
  cheer: bake("cheer", 1.3, false, [
    { t: 0 },
    { t: 0.25, armL: [0.35, 0.9, 0.2], armR: [-0.35, 0.9, 0.2], head: [-0.15, 0, 0], hips: [0, 0.06, 0] },
    { t: 0.55, armL: [0.45, 0.85, 0.15], armR: [-0.45, 0.85, 0.15] },
    { t: 0.85, armL: [0.3, 0.92, 0.2], armR: [-0.3, 0.92, 0.2], hips: [0, 0.04, 0] },
    { t: 1.3, armL: REST.armL, armR: REST.armR, head: [0, 0, 0], hips: [0, 0, 0] },
  ]),
  // Asleep on its back, held until released: a true 90 degrees (after the driver's body gain), arms and legs along the body, head on the pillow,
  // a slow breath (the chest rises) and a slight head roll. The hips lift the body clear of the surface it lies on. 4 s, loops.
  sleep: bake("sleep", 4, true, [
    { t: 0, body: [-gainFor(PI / 2), 0, 0], head: [0, 0, 0.05], hips: [0, 0.13, LIE_FORWARD], armL: [0.12, -1, 0.04], armR: [-0.12, -1, 0.04], legL: [0.04, -1, 0], legR: [-0.04, -1, 0] },
    { t: 2, head: [0, 0, -0.05], hips: [0, 0.15, LIE_FORWARD] },
    { t: 4, head: [0, 0, 0.05], hips: [0, 0.13, LIE_FORWARD] },
  ], { followBody: true }),
};

/** The names, for the driver's action type and for tests. */
export const PROCEDURAL_ACTIONS = Object.keys(PROCEDURAL_CLIPS) as Array<"eat" | "sour" | "belly_pat" | "yawn" | "sleep" | "hug" | "kick" | "cheer">;
