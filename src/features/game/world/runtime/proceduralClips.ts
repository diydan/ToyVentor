// Hand-authored clips for the in-game Character (Kip): eat, sour, belly_pat, yawn, sleep, hug, kick, cheer, read, strum, blow, pet and mallet.
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
const HAND_TO_MOUTH: V3 = [-0.2, 0.5, 0.85];                                  // the wand's hand (`blow`): out in front, the ring ahead of the mouth
/**
 * The right hand at the mouth when EATING: from the shoulder, toward the middle of the face (inward, up, a little forward). The arm is a straight one 0.85 long to the fist and the mouth is only 0.62
 * from the shoulder, so this puts the fist in front of the mouth, level with it (the old direction went outward and far forward: the fist floated half a unit in front of the face, or over the head).
 */
export const HAND_AT_MOUTH: V3 = [0.6, 0.4, 0.45];
const HAND_DOWN: V3 = [-0.12, -0.95, 0.15];
// Lying down tips the figure about its FEET, so the body would stretch away behind them. Moving the hips forward by about half a body length
// (in hip-heights) puts the middle of the lying body where the standing figure was, which is what a bed needs.
const LIE_FORWARD = 0.5;

/** The moment in the `kick` clip when the foot meets the ball (seconds): the ball is launched on this cue. */
export const KICK_CONTACT_S = 0.42;
/** The first, deeper squeeze of the `hug` clip (seconds): a heart floats up on this cue. */
export const HUG_SQUEEZE_S = 0.8;
/** When each page of the `read` clip turns (seconds): the world says a name on each. */
export const READ_PAGES_S: readonly number[] = [0.9, 3.1, 5.3];
/** When each strum of the `strum` clip lands (seconds): a chord on each. */
export const STRUM_EVERY_S = 0.28;
export const STRUM_COUNT = 14;
/** When Kip puffs in the `blow` clip (seconds): a burst of bubbles on each. */
export const BLOW_PUFFS_S: readonly number[] = [0.6, 1.0, 1.4, 1.8];
/** The `mallet` clip: one mallet stroke every MALLET_EVERY_S from MALLET_START_S, MALLET_COUNT of them, the left hand on the even ones and the right on the odd ones. */
export const MALLET_START_S = 0.5;
export const MALLET_EVERY_S = 0.3;
export const MALLET_COUNT = 14;
/** The strokes of the `pet` clip (seconds): the hand lands on the dog's back on each. */
export const PET_STROKES_S: readonly number[] = [0.7, 1.1, 1.5, 1.9];
/** The mess clips (runtime/mess.ts). `oops`: Kip reaches for the cup or the toy box and, at OOPS_TIP_S, it tips over; the gasp, hands up, comes just after. 2.2 s. */
export const OOPS_TIP_S = 0.4;
export const OOPS_S = 2.2;
/** `mop`: the first stroke starts at MOP_CLIP_START_S and there are MOP_CLIP_STROKES of them, one every MOP_CLIP_EVERY_S (messModel.ts MOP_START_S / MOP_STROKES / MOP_EVERY_S say the same; a test checks). */
export const MOP_CLIP_START_S = 0.55;
export const MOP_CLIP_STROKES = 6;
export const MOP_CLIP_EVERY_S = 0.6;
/** `tidy`: a sweeping wave towards the box, one for each toy that goes home (TIDY_CLIP_START_S, then one every TIDY_CLIP_EVERY_S, up to TIDY_CLIP_MAX). 7 s at most. */
export const TIDY_CLIP_START_S = 0.5;
export const TIDY_CLIP_EVERY_S = 0.55;
export const TIDY_CLIP_MAX = 6;

/** Read a book held in both hands: the head down on the page, and at each of READ_PAGES_S the right hand flicks a page over and the head lifts for a moment. 6.6 s. */
const readKeys: Key[] = [
  { t: 0 },
  { t: 0.5, armL: [0.25, -0.45, 0.85], armR: [-0.25, -0.45, 0.85], body: [0.08, 0, 0], head: [0.3, 0, 0] },
];
for (const t of READ_PAGES_S) {
  readKeys.push({ t: t - 0.15, armR: [-0.25, -0.45, 0.85], head: [0.3, 0, 0] });
  readKeys.push({ t, armR: [-0.1, -0.1, 0.99], head: [0.05, 0, 0.04] });
  readKeys.push({ t: t + 0.35, armR: [-0.25, -0.45, 0.85], head: [0.3, 0, 0] });
}
readKeys.push({ t: 6.6, armL: REST.armL, armR: REST.armR, body: [0, 0, 0], head: [0, 0, 0] });

/** Strum a guitar held across the body: the left hand on the neck out front, the right hand brushing the strings in time (one strum each STRUM_EVERY_S), the body swaying and bobbing, the head nodding. 4.4 s. */
const strumKeys: Key[] = [{ t: 0 }, { t: 0.2, armL: [0.2, -0.2, 0.97], armR: [-0.3, -0.35, 0.9], body: [0.04, 0, 0.06], head: [0.12, 0, 0] }];
for (let i = 0; i < STRUM_COUNT; i++) {
  const t = 0.2 + (i + 1) * STRUM_EVERY_S;
  const down = i % 2 === 0;
  strumKeys.push({ t, armR: down ? [-0.3, -0.72, 0.62] : [-0.3, -0.35, 0.9], body: [0.04, 0, down ? -0.06 : 0.06], head: [down ? 0.2 : 0.1, 0, 0], hips: [0, down ? 0.02 : 0, 0] });
}
strumKeys.push({ t: 4.4, armL: REST.armL, armR: REST.armR, body: [0, 0, 0], head: [0, 0, 0], hips: [0, 0, 0] });

/** Play a xylophone with a mallet in each hand: both arms out in front, striking down in turn (the left on the even strokes, the right on the odd ones), the body swaying and the head nodding with the beat. 5.2 s. */
const malletKeys: Key[] = [{ t: 0 }, { t: MALLET_START_S - 0.2, armL: [0.25, -0.35, 0.9], armR: [-0.25, -0.35, 0.9], body: [0.1, 0, 0], head: [0.12, 0, 0] }];
for (let i = 0; i < MALLET_COUNT; i++) {
  const t = MALLET_START_S + i * MALLET_EVERY_S, left = i % 2 === 0;
  malletKeys.push({ t, armL: left ? [0.25, -0.8, 0.55] : [0.25, -0.35, 0.9], armR: left ? [-0.25, -0.35, 0.9] : [-0.25, -0.8, 0.55], body: [0.1, 0, left ? 0.05 : -0.05], head: [left ? 0.2 : 0.12, 0, 0] });
}
malletKeys.push({ t: MALLET_START_S + MALLET_COUNT * MALLET_EVERY_S + 0.3, armL: REST.armL, armR: REST.armR, body: [0, 0, 0], head: [0, 0, 0] });

/** Oops: the right hand reaches for the cup, it tips, and both hands fly up to the face with a gasp (the head back, a little hop), a shake of the shoulders, then they come slowly down. 2.2 s. */
const oopsKeys: Key[] = [
  { t: 0 },
  { t: OOPS_TIP_S - 0.1, armR: [-0.2, 0.0, 0.98], body: [0.1, 0, 0], head: [0.12, 0, 0] },
  { t: OOPS_TIP_S + 0.1, armR: [-0.25, 0.15, 0.95] },
  { t: 0.75, armL: [0.3, 0.6, 0.72], armR: [-0.3, 0.6, 0.72], head: [-0.22, 0, 0], body: [-0.1, 0, 0], hips: [0, 0.07, 0] },
  { t: 0.95, hips: [0, 0.02, 0] },
  { t: 1.15, body: [-0.1, 0, 0.07] }, { t: 1.35, body: [-0.1, 0, -0.07] }, { t: 1.55, body: [-0.1, 0, 0.05] },
  { t: 1.75, armL: [0.35, 0.3, 0.6], armR: [-0.35, 0.3, 0.6], head: [-0.1, 0, 0] },
  { t: OOPS_S, armL: REST.armL, armR: REST.armR, head: [0, 0, 0], body: [0, 0, 0], hips: [0, 0, 0] },
];

/** Mop: both hands on the handle out in front and low, the body leaning in, and a sweep from side to side with each stroke (the body rolls and rocks, the arms swing), then back to rest. */
const mopKeys: Key[] = [
  { t: 0 },
  { t: MOP_CLIP_START_S - 0.2, armL: [0.2, -0.55, 0.8], armR: [-0.2, -0.55, 0.8], body: [0.16, 0, 0], head: [0.15, 0, 0] },
];
for (let i = 0; i < MOP_CLIP_STROKES; i++) {
  const t = MOP_CLIP_START_S + (i + 1) * MOP_CLIP_EVERY_S, right = i % 2 === 0;
  mopKeys.push({ t, armL: right ? [0.35, -0.5, 0.78] : [0.05, -0.5, 0.86], armR: right ? [-0.05, -0.5, 0.86] : [-0.35, -0.5, 0.78], body: [0.16, 0, right ? -0.1 : 0.1], head: [0.15, 0, right ? 0.05 : -0.05], hips: [right ? -0.03 : 0.03, 0, 0] });
}
mopKeys.push({ t: MOP_CLIP_START_S + MOP_CLIP_STROKES * MOP_CLIP_EVERY_S + 0.3, armL: REST.armL, armR: REST.armR, body: [0, 0, 0], head: [0, 0, 0], hips: [0, 0, 0] });

/** Tidy: a sweeping wave of both arms towards the box, once for each toy going home (the left arm and the right in turn), the head nodding along. */
const tidyKeys: Key[] = [{ t: 0 }, { t: TIDY_CLIP_START_S - 0.15, armL: [0.3, -0.5, 0.8], armR: [-0.3, -0.5, 0.8], body: [0.06, 0, 0] }];
for (let i = 0; i < TIDY_CLIP_MAX; i++) {
  const t = TIDY_CLIP_START_S + i * TIDY_CLIP_EVERY_S, left = i % 2 === 0;
  tidyKeys.push({ t, armL: left ? [0.2, 0.2, 0.95] : [0.3, -0.55, 0.78], armR: left ? [-0.3, -0.55, 0.78] : [-0.2, 0.2, 0.95], body: [0.06, 0, left ? 0.05 : -0.05], head: [left ? 0.1 : 0.05, 0, 0] });
}
tidyKeys.push({ t: TIDY_CLIP_START_S + TIDY_CLIP_MAX * TIDY_CLIP_EVERY_S + 0.2, armL: REST.armL, armR: REST.armR, body: [0, 0, 0], head: [0, 0, 0] });

/** Authored in real angles. Each is the whole motion, ending back at rest so it can blend out cleanly. */
export const PROCEDURAL_CLIPS: ClipBank = {
  // One bite: hand to mouth, three chews (the head bobs), a swallow, then a little happy hop. 1.7 s.
  eat: bake("eat", 1.7, false, [
    { t: 0 },
    { t: 0.35, armR: HAND_AT_MOUTH, head: [0.12, 0, 0], body: [0.06, 0, 0] },
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
    // the hands are in front of the belly, level with the hips, one over the other (the arms are straight and 0.85 long, the belly only 0.6 from the shoulders: the nearest the fists can be is
    // just in front of it, so they meet at the middle instead of floating half a unit out to each side)
    { t: 0.3, armL: [-0.48, -0.6, 0.63], armR: [0.48, -0.6, 0.63], head: [-0.15, 0, 0], body: [-0.1, 0, 0] },
    { t: 0.5, armL: [-0.48, -0.55, 0.69], armR: [0.48, -0.55, 0.69] }, { t: 0.7, armL: [-0.48, -0.66, 0.58], armR: [0.48, -0.66, 0.58] },
    { t: 0.9, armL: [-0.48, -0.55, 0.69], armR: [0.48, -0.55, 0.69] }, { t: 1.1, armL: [-0.48, -0.66, 0.58], armR: [0.48, -0.66, 0.58] },
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
  // Read a book aloud, turning a page at each of READ_PAGES_S. 6.6 s.
  read: bake("read", 6.6, false, readKeys),
  // Strum a guitar. 4.4 s.
  strum: bake("strum", 4.4, false, strumKeys),
  // Blow bubbles through a wand: the right hand brings it to the mouth, four puffs (BLOW_PUFFS_S) with the head going back and forward, then the hand lowers. 3.6 s.
  blow: bake("blow", 3.6, false, [
    { t: 0 },
    { t: 0.45, armR: HAND_TO_MOUTH, head: [0.1, 0, 0], body: [0.02, 0, 0] },
    ...BLOW_PUFFS_S.flatMap((t): Key[] => [{ t: t - 0.12, head: [0.18, 0, 0], body: [0.06, 0, 0] }, { t, head: [-0.1, 0, 0], body: [-0.05, 0, 0] }]),
    { t: 2.2, head: [0.05, 0, 0], body: [0, 0, 0] },
    { t: 2.7, armR: HAND_TO_MOUTH },
    { t: 3.6, armR: REST.armR, head: [0, 0, 0], body: [0, 0, 0] },
  ]),
  // Pet a dog: lean forward and crouch a little, the right hand reaching down in front and stroking four times (PET_STROKES_S), the left hand resting on the knee, the head down. 2.6 s.
  pet: bake("pet", 2.6, false, [
    { t: 0 },
    { t: 0.45, armR: [-0.2, -0.55, 0.8], armL: [0.3, -0.75, 0.45], body: [0.3, 0, 0], head: [0.25, 0, 0], hips: [0, -0.1, 0.1] },
    ...PET_STROKES_S.flatMap((t, i): Key[] => [{ t: t - 0.2, armR: [-0.2, -0.7, 0.7] }, { t, armR: [-0.2, -0.5, 0.85], head: [0.25 - (i % 2) * 0.04, 0, 0] }]),
    { t: 2.2, armR: [-0.2, -0.6, 0.78], body: [0.25, 0, 0] },
    { t: 2.6, armR: REST.armR, armL: REST.armL, body: [0, 0, 0], head: [0, 0, 0], hips: [0, 0, 0] },
  ]),
  // Play a xylophone, one mallet stroke at a time. 5.0 s.
  mallet: bake("mallet", MALLET_START_S + MALLET_COUNT * MALLET_EVERY_S + 0.3, false, malletKeys),
  // The Toy Room's mess (runtime/mess.ts): reach for it and gasp when it tips, mop it up, wave the toys back into the box.
  oops: bake("oops", OOPS_S, false, oopsKeys),
  mop: bake("mop", MOP_CLIP_START_S + MOP_CLIP_STROKES * MOP_CLIP_EVERY_S + 0.3, false, mopKeys),
  tidy: bake("tidy", TIDY_CLIP_START_S + TIDY_CLIP_MAX * TIDY_CLIP_EVERY_S + 0.2, false, tidyKeys),
  // Asleep on its back, held until released: a true 90 degrees (after the driver's body gain), arms and legs along the body, head on the pillow,
  // a slow breath (the chest rises) and a slight head roll. The hips lift the body clear of the surface it lies on. 4 s, loops.
  sleep: bake("sleep", 4, true, [
    { t: 0, body: [-gainFor(PI / 2), 0, 0], head: [0, 0, 0.05], hips: [0, 0.13, LIE_FORWARD], armL: [0.12, -1, 0.04], armR: [-0.12, -1, 0.04], legL: [0.04, -1, 0], legR: [-0.04, -1, 0] },
    { t: 2, head: [0, 0, -0.05], hips: [0, 0.15, LIE_FORWARD] },
    { t: 4, head: [0, 0, 0.05], hips: [0, 0.13, LIE_FORWARD] },
  ], { followBody: true }),
};

/** The names, for the driver's action type and for tests. */
export const PROCEDURAL_ACTIONS = Object.keys(PROCEDURAL_CLIPS) as Array<"eat" | "sour" | "belly_pat" | "yawn" | "sleep" | "hug" | "kick" | "cheer" | "read" | "strum" | "blow" | "pet" | "mallet" | "oops" | "mop" | "tidy">;
