// Mixamo locomotion and gesture clips for the in-game Character (Kip).
//
// The bundled `public/kip/mixamo/*.glb` files are bone-only (meshes and textures stripped, see THIRD_PARTY.md).
// We bake every clip ONCE into compact per-frame data, then drive Kip's rigid parts from it:
//   - each limb is one rigid segment, so only the shoulder-to-hand / hip-to-ankle DIRECTION matters (no twist),
//   - the body and head use the bone's rotation relative to its bind pose,
//   - hips motion becomes a small bob / sway on the whole rig.
// Everything is expressed in the "CAD" frame Kip's STL rig is authored in: +Y up, +Z forward, +X the figure's left.
// Stage coordinates (forward +X, left -Z) are one quarter-turn away; see toStage().
//
// Baking is pure (an Object3D + clips in, typed arrays out) so it runs in vitest without a browser.
import * as THREE from "three";
import type { ToyRig } from "./playerRig";
import { FLEX_ASSEMBLED, followHand, newSnapArmSolution, newSnapLegSolution, releaseHand, resetSnapRig, solveSnapArm, solveSnapLeg, type SnapRigHandles } from "./snapFlex";

const FPS = 30;
const DOWN = new THREE.Vector3(0, -1, 0);
/** CAD frame -> stage frame: kipFrame.rotation.y = +PI/2 in stlRigLoader. */
const CAD_TO_STAGE = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
const STAGE_TO_CAD = CAD_TO_STAGE.clone().invert();

export interface BakedClip {
  name: string;
  duration: number;
  loop: boolean;
  /** A one-frame pose (Mixamo "pose" clips are ~0.07 s): held, never advanced. */
  pose: boolean;
  frames: number;
  /** Per-frame hips offset in hip-heights: x left, y up (>= 0), z forward. frames * 3 */
  hips: Float32Array;
  /** Per-frame body (hips + spine) orientation delta from bind. frames * 4 */
  body: Float32Array;
  /** Per-frame head orientation delta from bind. frames * 4 */
  head: Float32Array;
  /** Per-frame unit limb directions (shoulder->hand, hip->ankle). frames * 3 each */
  armL: Float32Array;
  armR: Float32Array;
  legL: Float32Array;
  legR: Float32Array;
  /**
   * The Kip bench's own joint rotations, when the clip was made from its baked JSON (runtime/bakedDance.ts). With them the Snap rig's elbows, knees, wrists and ankles bend exactly as in the
   * bench (runtime/snapFlex.ts); a clip without them (the Xbot's idle and walk) keeps driving the rigid limbs by direction, as it always did.
   */
  joints?: ClipJoints;
  /** The bake planted the feet (the stance foot stays put in the rig): the driver may stand the lowest sole on the floor while this clip plays. */
  planted?: boolean;
}
/** Per-frame joint rotations (x, y, z, w; frames * 4 each), local, in the CAD frame: Hips > shoulder > elbow > wrist, Hips > hip > knee > ankle; and the hips' position in rig mm (frames * 3, absolute: standing is about (0, 61.5, 0)). */
export interface ClipJoints {
  shoulderL: Float32Array; shoulderR: Float32Array; elbowL: Float32Array; elbowR: Float32Array; wristL: Float32Array; wristR: Float32Array;
  hipL: Float32Array; hipR: Float32Array; kneeL: Float32Array; kneeR: Float32Array; ankleL: Float32Array; ankleR: Float32Array;
  hipsMm: Float32Array;
}
export const CLIP_JOINT_KEYS = ["shoulderL", "shoulderR", "elbowL", "elbowR", "wristL", "wristR", "hipL", "hipR", "kneeL", "kneeR", "ankleL", "ankleR"] as const;
export type ClipJointKey = (typeof CLIP_JOINT_KEYS)[number];
export type ClipBank = Record<string, BakedClip>;

export interface Pose {
  hips: THREE.Vector3;
  body: THREE.Quaternion;
  head: THREE.Quaternion;
  armL: THREE.Vector3;
  armR: THREE.Vector3;
  legL: THREE.Vector3;
  legR: THREE.Vector3;
  /** 0 to 1: how much of this pose is the bench's exact joint rotations (`j`) rather than limb directions. 0 for a clip without them; blends with the clips mixed in. */
  jw: number;
  /** 0 to 1: how much the lowest sole is stood on the floor (a planted clip). */
  gw: number;
  j: PoseJoints;
}
export type PoseJoints = Record<ClipJointKey, THREE.Quaternion> & { hipsMm: THREE.Vector3 };
function newPoseJoints(): PoseJoints {
  const j = { hipsMm: new THREE.Vector3(0, 61.5, 0) } as PoseJoints;
  for (const k of CLIP_JOINT_KEYS) j[k] = new THREE.Quaternion();
  return j;
}
export function newPose(): Pose {
  return {
    jw: 0, gw: 0, j: newPoseJoints(),
    hips: new THREE.Vector3(),
    body: new THREE.Quaternion(),
    head: new THREE.Quaternion(),
    armL: new THREE.Vector3(0, -1, 0),
    armR: new THREE.Vector3(0, -1, 0),
    legL: new THREE.Vector3(0, -1, 0),
    legR: new THREE.Vector3(0, -1, 0),
  };
}

/* ---------- baking ---------- */

const WANTED = [
  "Hips", "Spine", "Spine1", "Spine2", "Head",
  "LeftArm", "LeftHand", "RightArm", "RightHand",
  "LeftUpLeg", "LeftFoot", "RightUpLeg", "RightFoot",
] as const;
type BoneName = (typeof WANTED)[number];

function findBones(root: THREE.Object3D): Partial<Record<BoneName, THREE.Object3D>> {
  const map: Partial<Record<BoneName, THREE.Object3D>> = {};
  root.traverse((o) => {
    if (!o.name) return;
    const clean = o.name.replace(/^.*mixamorig\d*:?/i, "").toLowerCase();
    for (const w of WANTED) if (clean === w.toLowerCase() && !map[w]) map[w] = o;
  });
  return map;
}

export interface BakeOptions {
  /** Clip name in the bank. */
  name: string;
  /** Loop the clip (locomotion, idle) or play it once (gestures). */
  loop: boolean;
  /** Cap long clips (the 18 s samba) to their first N seconds. */
  maxSeconds?: number;
}

/**
 * Sample one Mixamo clip on its skeleton and keep only what Kip needs. Returns null when the skeleton has no hips.
 * The root must already be at its bind pose (a freshly parsed bone-only GLB is).
 */
export function bakeClip(root: THREE.Object3D, clip: THREE.AnimationClip, opts: BakeOptions): BakedClip | null {
  root.updateMatrixWorld(true);
  const bones = findBones(root);
  const need: BoneName[] = ["Hips", "Head", "LeftArm", "LeftHand", "RightArm", "RightHand", "LeftUpLeg", "LeftFoot", "RightUpLeg", "RightFoot"];
  for (const n of need) if (!bones[n]) return null;
  const spineKey: BoneName = bones.Spine2 ? "Spine2" : bones.Spine1 ? "Spine1" : "Spine";

  const bindInv = new Map<BoneName, THREE.Quaternion>();
  for (const n of [...need, spineKey]) bindInv.set(n, bones[n]!.getWorldQuaternion(new THREE.Quaternion()).invert());
  const hipHeight = Math.max(1e-3, bones.Hips!.getWorldPosition(new THREE.Vector3()).y);

  const isPose = clip.duration < 0.2;
  const duration = isPose ? 1 : Math.min(clip.duration, opts.maxSeconds ?? clip.duration);
  const frames = isPose ? 1 : Math.max(2, Math.round(duration * FPS) + 1);
  const out: BakedClip = {
    name: opts.name, duration, loop: isPose ? false : opts.loop, pose: isPose, frames,
    hips: new Float32Array(frames * 3), body: new Float32Array(frames * 4), head: new Float32Array(frames * 4),
    armL: new Float32Array(frames * 3), armR: new Float32Array(frames * 3),
    legL: new Float32Array(frames * 3), legR: new Float32Array(frames * 3),
  };

  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();

  const qa = new THREE.Quaternion();
  const qb = new THREE.Quaternion();
  const pa = new THREE.Vector3();
  const pb = new THREE.Vector3();
  const delta = (n: BoneName, into: THREE.Quaternion) =>
    into.copy(bones[n]!.getWorldQuaternion(qa)).multiply(bindInv.get(n)!);
  const dir = (from: BoneName, to: BoneName, o: Float32Array, i: number) => {
    bones[from]!.getWorldPosition(pa);
    bones[to]!.getWorldPosition(pb);
    pb.sub(pa).normalize();
    o[i * 3] = pb.x; o[i * 3 + 1] = pb.y; o[i * 3 + 2] = pb.z;
  };

  const hipsAt0 = new THREE.Vector3();
  const body = new THREE.Quaternion();
  const spine = new THREE.Quaternion();
  const head = new THREE.Quaternion();
  const tmp = new THREE.Vector3();
  let minY = Infinity;
  for (let i = 0; i < frames; i++) {
    // A Mixamo "pose" clip is two keys: key 0 is the reference stance and the last key is the expression (the slouch, the crouch).
    mixer.setTime(isPose ? clip.duration : (i / (frames - 1)) * duration);
    root.updateMatrixWorld(true);
    bones.Hips!.getWorldPosition(tmp);
    if (i === 0) hipsAt0.copy(tmp);
    out.hips[i * 3] = (tmp.x - hipsAt0.x) / hipHeight;
    out.hips[i * 3 + 1] = (tmp.y - hipsAt0.y) / hipHeight;
    out.hips[i * 3 + 2] = (tmp.z - hipsAt0.z) / hipHeight;
    minY = Math.min(minY, out.hips[i * 3 + 1]!);
    delta("Hips", body);
    delta(spineKey, spine);
    body.slerp(spine, 0.5).normalize();
    out.body.set([body.x, body.y, body.z, body.w], i * 4);
    delta("Head", head);
    out.head.set([head.x, head.y, head.z, head.w], i * 4);
    dir("LeftArm", "LeftHand", out.armL, i);
    dir("RightArm", "RightHand", out.armR, i);
    dir("LeftUpLeg", "LeftFoot", out.legL, i);
    dir("RightUpLeg", "RightFoot", out.legR, i);
  }
  // Hips only ever lift Kip (never push the feet through the floor), and a looped clip returns to its start.
  // A held pose leaves the hips alone: Kip's legs are rigid, so a crouch would sink the feet, and a shift would only slide him.
  // It contributes torso, head and arms.
  for (let i = 0; i < frames; i++) out.hips[i * 3 + 1] = out.hips[i * 3 + 1]! - minY;
  if (out.loop && frames > 2) {
    out.hips[0] = out.hips[(frames - 1) * 3]!;
    out.hips[1] = out.hips[(frames - 1) * 3 + 1]!;
    out.hips[2] = out.hips[(frames - 1) * 3 + 2]!;
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(root);
  return out;
}

/** Which source file and clip names feed which game action. Add a clip here and it is baked at load. */
export interface ClipSource { url: string; clips: Array<{ clip: string; as: string; loop: boolean; maxSeconds?: number }> }
export const MIXAMO_SOURCES: ClipSource[] = [
  {
    url: "/kip/mixamo/Xbot.glb",
    clips: [
      { clip: "idle", as: "idle", loop: true },
      { clip: "walk", as: "walk", loop: true },
      { clip: "run", as: "run", loop: true },
      { clip: "agree", as: "nod", loop: false },
      { clip: "headShake", as: "no", loop: false },
      { clip: "sneak_pose", as: "sneak", loop: false },
      { clip: "sad_pose", as: "sad", loop: false },
    ],
  },
  { url: "/kip/mixamo/Michelle.glb", clips: [{ clip: "SambaDance", as: "dance", loop: true, maxSeconds: 4.4 }] },
];

export type SceneParser = (url: string) => Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }>;

async function browserParser(url: string) {
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  return new GLTFLoader().loadAsync(url);
}

/** Bake every configured clip. Missing files or clips are skipped; the caller falls back to the procedural walk. */
export async function loadMixamoBank(parse: SceneParser = browserParser, sources: ClipSource[] = MIXAMO_SOURCES): Promise<ClipBank> {
  const bank: ClipBank = {};
  await Promise.all(
    sources.map(async (src) => {
      let gltf: { scene: THREE.Object3D; animations: THREE.AnimationClip[] };
      try {
        gltf = await parse(src.url);
      } catch {
        return;
      }
      for (const c of src.clips) {
        const clip = gltf.animations.find((a) => a.name === c.clip);
        if (!clip) continue;
        const baked = bakeClip(gltf.scene, clip, { name: c.as, loop: c.loop, ...(c.maxSeconds != null ? { maxSeconds: c.maxSeconds } : {}) });
        if (baked) bank[c.as] = baked;
      }
    }),
  );
  return bank;
}

/* ---------- sampling and blending ---------- */

const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _va = new THREE.Vector3();
const _vb = new THREE.Vector3();

function sampleVec(a: Float32Array, i0: number, i1: number, f: number, out: THREE.Vector3, normalize: boolean): void {
  _va.fromArray(a, i0 * 3);
  _vb.fromArray(a, i1 * 3);
  out.copy(_va).lerp(_vb, f);
  if (normalize) out.normalize();
}
function sampleQuat(a: Float32Array, i0: number, i1: number, f: number, out: THREE.Quaternion): void {
  _qa.fromArray(a, i0 * 4);
  _qb.fromArray(a, i1 * 4);
  out.copy(_qa).slerp(_qb, f);
}

/** Pose of a clip at `time` seconds (wrapped for loops, clamped for one-shots). */
export function sampleClip(c: BakedClip, time: number, out: Pose): void {
  let i0 = 0, i1 = 0, f = 0;
  if (!c.pose && c.frames > 1) {
    const t = c.loop ? ((time % c.duration) + c.duration) % c.duration : Math.max(0, Math.min(c.duration, time));
    const x = (t / c.duration) * (c.frames - 1);
    i0 = Math.min(c.frames - 1, Math.floor(x));
    i1 = Math.min(c.frames - 1, i0 + 1);
    f = x - i0;
  }
  sampleVec(c.hips, i0, i1, f, out.hips, false);
  sampleQuat(c.body, i0, i1, f, out.body);
  sampleQuat(c.head, i0, i1, f, out.head);
  sampleVec(c.armL, i0, i1, f, out.armL, true);
  sampleVec(c.armR, i0, i1, f, out.armR, true);
  sampleVec(c.legL, i0, i1, f, out.legL, true);
  sampleVec(c.legR, i0, i1, f, out.legR, true);
  const J = c.joints;
  if (J) {
    for (const k of CLIP_JOINT_KEYS) sampleQuat(J[k], i0, i1, f, out.j[k]);
    sampleVec(J.hipsMm, i0, i1, f, out.j.hipsMm, false);
    out.jw = 1;
    out.gw = c.planted ? 1 : 0;
  } else {
    out.jw = 0;
    out.gw = 0;
  }
}

/** into = lerp(into, other, w) per channel. */
export function mixPose(into: Pose, other: Pose, w: number): void {
  if (w <= 0) return;
  into.hips.lerp(other.hips, w);
  into.body.slerp(other.body, w);
  into.head.slerp(other.head, w);
  into.armL.lerp(other.armL, w).normalize();
  into.armR.lerp(other.armR, w).normalize();
  into.legL.lerp(other.legL, w).normalize();
  into.legR.lerp(other.legR, w).normalize();
  // the exact joint rotations, where either side has them: each side counts in proportion to how much of its own pose is exact
  const ow = other.jw, iw = into.jw;
  if (ow > 0 || iw > 0) {
    const a = w * ow, b = (1 - w) * iw;
    const t = a + b > 1e-9 ? a / (a + b) : 0;
    if (iw <= 0) { for (const k of CLIP_JOINT_KEYS) into.j[k].copy(other.j[k]); into.j.hipsMm.copy(other.j.hipsMm); }
    else if (t > 0) { for (const k of CLIP_JOINT_KEYS) into.j[k].slerp(other.j[k], t); into.j.hipsMm.lerp(other.j.hipsMm, t); }
    into.gw += (other.gw - into.gw) * w;
    into.jw = iw + (ow - iw) * w;
  }
}

/* ---------- driving the rig ---------- */

/** The baked Mixamo gestures, then the hand-authored ones (runtime/proceduralClips.ts: eat, sour, belly_pat, yawn, and sleep, which is a HELD pose). */
export type MixAction = "dance" | "nod" | "no" | "sneak" | "sad" | "eat" | "sour" | "belly_pat" | "yawn" | "sleep" | "hug" | "kick" | "cheer" | "read" | "strum" | "blow" | "pet" | "mallet" | "oops" | "mop" | "tidy" | "jump" | "shove";

interface Joints {
  g: THREE.Object3D;
  head: THREE.Object3D | null;
  arms: [THREE.Object3D, THREE.Object3D] | null;
  hips: [THREE.Object3D, THREE.Object3D] | null;
  /** Hip height in stage units, for scaling the hips bob. */
  hipY: number;
  /** The Snap Kip's bendable limbs (runtime/snapFlex.ts), when this rig has them. */
  snap: SnapRigHandles | null;
}
/** Kip's standing hip height in rig mm (stlRigLoader's KIP_HIP_MM: tests/snap-flex-rig.test.ts keeps the two equal). Stage units per rig mm = hipY / this. */
export const KIP_HIP_REST_MM = 61.5;
/** Points on the sole of the boot (mm, from the boot's origin: across, then along), for standing the lowest one on the floor. */
const SOLE_PROBES: ReadonlyArray<readonly [number, number]> = [[-7, -9], [7, -9], [-7, 15], [7, 15]];

/** Find the joints a rig exposes. The STL Kip rig tags its leg pivots with `userData.hip`; procedural rigs just have fewer. */
export function jointsOf(rig: ToyRig): Joints | null {
  if (rig.type !== "character") return null;
  const arms = rig.arms.length >= 2 ? ([rig.arms[0]!, rig.arms[1]!] as [THREE.Object3D, THREE.Object3D]) : null;
  const h0 = rig.feet[0]?.userData?.hip as THREE.Object3D | undefined;
  const h1 = rig.feet[1]?.userData?.hip as THREE.Object3D | undefined;
  const hips = h0 && h1 ? ([h0, h1] as [THREE.Object3D, THREE.Object3D]) : null;
  const head = (rig.head as THREE.Object3D | undefined) ?? null;
  if (!arms && !hips && !head) return null;
  return { g: rig.g, head, arms, hips, hipY: (rig.mixHipY as number | undefined) ?? 1.14, snap: (rig.snap as SnapRigHandles | undefined) ?? null };
}

/** Secondary head motion the engine still owns: a glance when something is hidden nearby, and the start/stop lean spring. */
export interface DriverExtras { headYaw: number; headPitch: number }
const NO_EXTRAS: DriverExtras = { headYaw: 0, headPitch: 0 };
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_X = new THREE.Vector3(1, 0, 0);

const ACTION_FADE = 0.28;
/** The in-game dance party: the dance eases in over half a second and out over 0.4 s. */
const BEAT_FADE_IN = 0.5;
const BEAT_FADE_OUT = 0.4;
/** Changing from one dance to the next at a bar line: the old pose is held and melts into the new dance over this long. */
const BEAT_CROSSFADE = 0.3;

/** What a beat dance asks for each frame: which clip (by bank name) and how far into it, in seconds. `null` holds the last pose (nothing to say yet). */
export type BeatSource = () => { name: string; time: number } | null;
/** A held pose (sleep) eases in slowly and wakes a little faster. */
const HOLD_FADE_IN = 0.8;
const HOLD_FADE_OUT = 0.6;
const ACTION_ENV = (t: number, dur: number, fade = ACTION_FADE): number => Math.max(0, Math.min(1, Math.min(t / fade, (dur - t) / fade)));
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface DriverTuning {
  /** Stage speed at which the walk clip plays at its natural rate. */
  walkRefSpeed: number;
  /** Speeds between which walk cross-fades into run. */
  runFrom: number;
  runTo: number;
  /** Exaggerate hips bob / sway (Kip's legs are short, a toy sways more than a person). */
  hipsGain: number;
  /** How much of the clip's body lean and twist reaches Kip. */
  bodyGain: number;
  /** Strength of a held pose (sad, sneak). Mixamo poses are staged for a full-size person; on a big-headed toy at full strength the sad slump reads as a bow. */
  poseGain: number;
}
export const DEFAULT_TUNING: DriverTuning = { walkRefSpeed: 2.4, runFrom: 2.9, runTo: 3.5, hipsGain: 2.2, bodyGain: 0.7, poseGain: 0.6 };

export class MixamoDriver {
  private j: Joints | null = null;
  private rig: ToyRig | null = null;
  private sig0: unknown;
  private sig1: unknown;
  private sig2: unknown;
  private extras: DriverExtras = NO_EXTRAS;
  private tIdle = 0;
  private tWalk = 0;
  private tRun = 0;
  private action: { clip: BakedClip; t: number; lift: number; fade: number; rate: number; until: number } | null = null;
  /** A pose that stays until releaseHold(): w eases 0 to 1 while it is held and back to 0 while it is leaving. */
  private held: { clip: BakedClip; t: number; w: number; leaving: boolean } | null = null;
  /** A dance locked to a SONG clock (the dance party): sampled at whatever time `time()` answers each frame, not at a clock of its own, so it cannot drift from the sound. */
  private beat: { source: BeatSource; label?: string; w: number; leaving: boolean; cur: BakedClip | null; curTime: number; prev: { clip: BakedClip; time: number; xf: number } | null } | null = null;
  private readonly p = newPose();
  private readonly a = newPose();
  private readonly b = newPose();
  private readonly q = new THREE.Quaternion();
  private readonly q2 = new THREE.Quaternion();
  private readonly qe = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  // the Snap rig's joint mode (applyJoints)
  private snapOn = false;
  private readonly sa = newSnapArmSolution();
  private readonly sl = newSnapLegSolution();
  private readonly q3 = new THREE.Quaternion();
  private readonly qw = new THREE.Quaternion();
  private readonly qx = new THREE.Quaternion();
  private readonly v2 = new THREE.Vector3();
  private readonly inv = new THREE.Matrix4();

  constructor(private readonly bank: ClipBank, private readonly tuning: DriverTuning = DEFAULT_TUNING) {}

  /** True when this rig can be driven and the idle + walk clips are present. */
  canDrive(rig: ToyRig): boolean {
    return !!this.bank.idle && !!this.bank.walk && jointsOf(rig) !== null;
  }

  /**
   * Start a one-shot gesture. Returns false if the clip is not in the bank. `lift` scales how much of the clip's own hips lift (a jump's height) it uses: 1 all of it, 0 none, for when the game
   * moves the toy up and down itself (the cushions) and the clip is only for the pose; `fade` is how fast it eases in and out (a jump wants a sudden take-off: the default is slower);
   * `rate` plays it faster or slower (0.5 to 2; the clip's length and every moment in it scale with it). `until` ends it that many seconds in (of the clip's own time), easing out over `fade`: for a
   * long clip of which only the start is wanted (a push), played as authored, never cut or joined.
   */
  trigger(name: MixAction, opts: { lift?: number; fade?: number; rate?: number; until?: number } = {}): boolean {
    const clip = this.bank[name];
    if (!clip) return false;
    const lift = typeof opts.lift === "number" && Number.isFinite(opts.lift) ? Math.max(0, Math.min(1, opts.lift)) : 1;
    const fade = typeof opts.fade === "number" && Number.isFinite(opts.fade) && opts.fade > 0.001 ? Math.min(ACTION_FADE, opts.fade) : ACTION_FADE;
    const rate = typeof opts.rate === "number" && Number.isFinite(opts.rate) ? Math.max(0.5, Math.min(2, opts.rate)) : 1;
    const until = typeof opts.until === "number" && Number.isFinite(opts.until) && opts.until > 0.1 ? opts.until : Infinity;
    this.action = { clip, t: 0, lift, fade, rate, until };
    return true;
  }

  /** The name of the gesture or beat dance in progress. A beat dance reports itself as `dance` whichever clip it is on (unless its starter gave it a `label`: the character's own idle waves and dances say `idle`, so nothing mistakes them for a party), so the camera push and the face-the-camera turn that a celebration gets apply to a party too. */
  get busyAction(): string | null { return this.beat && !this.beat.leaving ? (this.beat.label ?? "dance") : this.action ? this.action.clip.name : null; }

  /** Add clips to the bank after the driver was made (the dance party loads its dances on demand). A name already in the bank is replaced. */
  addClips(clips: Record<string, BakedClip>): void { Object.assign(this.bank, clips); }
  /** Is this clip in the bank? */
  hasClip(name: string): boolean { return !!this.bank[name]; }

  /**
   * Start a dance that follows a song's clock: every frame `source` says which clip and how far into it (in seconds, looped by the clip); a change of clip is a short cross-fade.
   * It eases in over half a second, replaces a one-shot in progress, and walking pulls the toy out of it (the song goes on). Returns false if the source's first clip is not in the bank or is a one-frame pose.
   */
  startBeatSource(source: BeatSource, label?: string): boolean {
    const first = source();
    const clip = first ? this.bank[first.name] : undefined;
    if (!first || !clip || clip.pose) return false;
    this.beat = { source, label, w: this.beat && !this.beat.leaving ? this.beat.w : 0, leaving: false, cur: clip, curTime: first.time, prev: null };
    this.action = null;
    return true;
  }
  /** One clip on a song's clock: `time()` is the seconds into the clip. The same as `startBeatSource` with a source that never changes clip. */
  startBeatDance(name: MixAction | string, time: () => number): boolean {
    return this.startBeatSource(() => ({ name, time: time() }));
  }
  /** Ease the beat dance out; the rig is back to idle when it has gone. Safe to call when none is on. */
  stopBeatDance(): void { if (this.beat) this.beat.leaving = true; }
  /** True while a beat dance is on (and not being eased out). */
  get beatDancing(): boolean { return !!this.beat && !this.beat.leaving; }
  /** The bank name of the clip the beat dance is on now, or null. */
  get beatClip(): string | null { return this.beat && !this.beat.leaving && this.beat.cur ? this.beat.cur.name : null; }
  /** The source of the beat dance in progress (and not being eased out), or null: so whoever started one can tell that it is still theirs and not another's (the party's) that replaced it. */
  get beatSourceFn(): BeatSource | null { return this.beat && !this.beat.leaving ? this.beat.source : null; }

  /**
   * Take a pose and keep it (looping) until releaseHold(): the toy lies down and sleeps until it is woken. Eases in, replaces any one-shot, and (unlike
   * a one-shot) is not cancelled by walking, because a sleeping toy is not walking. Returns false if the clip is not in the bank.
   */
  holdAction(name: MixAction): boolean {
    const clip = this.bank[name];
    if (!clip) return false;
    this.held = { clip, t: 0, w: this.held && !this.held.leaving ? this.held.w : 0, leaving: false };
    this.action = null;
    return true;
  }
  /** Ease the held pose out. The rig is back to idle when it has gone. Safe to call when nothing is held. */
  releaseHold(): void { if (this.held) this.held.leaving = true; }
  /** Name of the pose being held (and not yet released), or null. */
  get holding(): string | null { return this.held && !this.held.leaving ? this.held.clip.name : null; }

  /**
   * Advance the clocks, blend idle / walk / run by speed, layer any one-shot on top and write the result onto the rig.
   * `moveAmount` is the 0..1 walking intensity the legacy code used (P.speed / 2.5, clamped).
   */
  update(rig: ToyRig, dt: number, speed: number, extras: DriverExtras = NO_EXTRAS): void {
    // The STL upgrade swaps the limbs inside the same rig object, so re-find the joints when their identity changes.
    if (this.rig !== rig || this.sig0 !== rig.head || this.sig1 !== rig.arms[0] || this.sig2 !== rig.feet[0]) {
      this.rig = rig; this.sig0 = rig.head; this.sig1 = rig.arms[0]; this.sig2 = rig.feet[0];
      this.j = jointsOf(rig);
    }
    const j = this.j;
    if (!j) return;
    this.extras = extras;
    const { bank, tuning: tn } = this;
    const wRun = bank.run ? smooth(tn.runFrom, tn.runTo, speed) : 0;
    const wWalk = smooth(0.08, 0.7, speed) * (1 - wRun);
    const wIdle = Math.max(0, 1 - wWalk - wRun);

    this.tIdle += dt;
    this.tWalk += dt * Math.max(0.5, Math.min(1.6, speed / tn.walkRefSpeed));
    this.tRun += dt * Math.max(0.8, Math.min(1.25, speed / 3.4));

    // idle * wIdle + walk * wWalk + run * wRun, built as two sequential lerps (the weights sum to 1).
    const p = this.p;
    sampleClip(bank.idle!, this.tIdle, p);
    if (wWalk > 0.001) { sampleClip(bank.walk!, this.tWalk, this.a); mixPose(p, this.a, wWalk / Math.max(1e-6, wIdle + wWalk)); }
    if (wRun > 0.001 && bank.run) { sampleClip(bank.run, this.tRun, this.a); mixPose(p, this.a, wRun); }

    const act = this.action;
    if (act) {
      act.t += dt * act.rate;
      const dur = Math.min(act.clip.pose ? 1.4 : act.clip.duration, act.until);
      // Walking cancels gestures fast; a one-shot stands still.
      const w = ACTION_ENV(act.t, dur, act.fade) * (act.clip.pose ? tn.poseGain : 1) * (1 - smooth(0.4, 1.2, speed));
      sampleClip(act.clip, act.t, this.a);
      if (act.lift !== 1) {
        this.a.hips.y *= act.lift; this.a.hips.x *= act.lift; this.a.hips.z *= act.lift;
        // a clip with the bench's joint data carries the hips' own height too (mm, standing at KIP_HIP_REST_MM): scale how far it rises or crouches from standing, by the same share
        if (this.a.jw > 0) this.a.j.hipsMm.y = KIP_HIP_REST_MM + (this.a.j.hipsMm.y - KIP_HIP_REST_MM) * act.lift;
      }
      mixPose(p, this.a, w);
      if (act.t >= dur) this.action = null;
    }
    const h = this.held;
    if (h) {
      h.t += dt;
      h.w = Math.max(0, Math.min(1, h.w + (h.leaving ? -dt / HOLD_FADE_OUT : dt / HOLD_FADE_IN)));
      sampleClip(h.clip, h.t, this.a);
      mixPose(p, this.a, smooth(0, 1, h.w));
      if (h.leaving && h.w <= 0) this.held = null;
    }
    const bd = this.beat;
    if (bd) {
      bd.w = Math.max(0, Math.min(1, bd.w + (bd.leaving ? -dt / BEAT_FADE_OUT : dt / BEAT_FADE_IN)));
      const want = bd.leaving ? null : bd.source();
      if (want && Number.isFinite(want.time)) {
        const clip = bank[want.name];
        if (clip && !clip.pose) {
          if (clip !== bd.cur && bd.cur) bd.prev = { clip: bd.cur, time: bd.curTime, xf: 0 }; // a new dance: the old pose melts into it
          bd.cur = clip;
          bd.curTime = want.time;
        }
      }
      if (bd.cur) {
        sampleClip(bd.cur, bd.curTime, this.a);
        if (bd.prev) {
          bd.prev.xf = Math.min(1, bd.prev.xf + dt / BEAT_CROSSFADE);
          sampleClip(bd.prev.clip, bd.prev.time, this.b);
          mixPose(this.b, this.a, smooth(0, 1, bd.prev.xf)); // from the old pose to the new
          if (bd.prev.xf >= 1) bd.prev = null;
          mixPose(p, this.b, smooth(0, 1, bd.w) * (1 - smooth(0.4, 1.2, speed)));
        } else {
          mixPose(p, this.a, smooth(0, 1, bd.w) * (1 - smooth(0.4, 1.2, speed)));
        }
      }
      if (bd.leaving && bd.w <= 0) this.beat = null;
    }
    this.apply(j, p);
    this.applyJoints(j, p);
  }

  /** Release the rig back to its rest pose (called when the driver is swapped out). */
  release(): void {
    const j = this.j;
    if (!j) return;
    j.g.position.set(0, 0, 0);
    j.g.quaternion.identity();
    j.head?.quaternion.identity();
    j.arms?.forEach((o) => o.quaternion.identity());
    j.hips?.forEach((o) => o.quaternion.identity());
    if (j.snap) resetSnapRig(j.snap);
    this.snapOn = false;
    this.held = null;
    this.beat = null;
    this.j = null;
    this.rig = null;
  }

  private apply(j: Joints, p: Pose): void {
    const t = this.tuning;
    // Body: a fraction of the clip's lean / twist, expressed in stage axes on the whole rig.
    this.q.identity().slerp(p.body, t.bodyGain);
    this.q2.copy(CAD_TO_STAGE).multiply(this.q).multiply(STAGE_TO_CAD);
    j.g.quaternion.copy(this.q2);
    // Hips: x left -> stage -z, z forward -> stage +x.
    const amp = j.hipY * t.hipsGain;
    j.g.position.set(p.hips.z * amp, p.hips.y * amp, -p.hips.x * amp);
    // Head: whatever the body rotation did not already deliver, so the head follows the clip's absolute aim.
    if (j.head) {
      this.q2.copy(this.q).invert().multiply(p.head);
      j.head.quaternion.identity().slerp(this.q2, 0.85);
      if (this.extras.headYaw !== 0) j.head.quaternion.premultiply(this.qe.setFromAxisAngle(AXIS_Y, this.extras.headYaw));
      if (this.extras.headPitch !== 0) j.head.quaternion.premultiply(this.qe.setFromAxisAngle(AXIS_X, this.extras.headPitch));
    }
    // Limbs: rest direction is straight down in the holder's own (stage) frame.
    if (j.arms) {
      j.arms[0].quaternion.setFromUnitVectors(DOWN, this.toStageDir(p.armL));
      j.arms[1].quaternion.setFromUnitVectors(DOWN, this.toStageDir(p.armR));
    }
    if (j.hips) {
      j.hips[0].quaternion.setFromUnitVectors(DOWN, this.toStageDir(p.legL));
      j.hips[1].quaternion.setFromUnitVectors(DOWN, this.toStageDir(p.legR));
    }
  }

  /**
   * The Snap rig's fake rigging, in joint mode (runtime/snapFlex.ts). `apply` has already posed the whole rig from the limb DIRECTIONS; where the pose also carries the bench's exact joint
   * rotations (`p.jw` > 0, a baked dance or gesture) this puts those on top, by that weight: the body turns about the HIPS (not about the feet) and lowers with them, the head and the shoulders
   * and hips take the exact rotations, the one-piece sleeves bend at the elbow and the knee, the hands and the boots ride the bent ends, and a planted clip has its lowest sole put on the floor.
   * With no joint data (`jw` 0) and the limbs already at rest it does nothing at all, so the Xbot clips drive the figure exactly as before.
   */
  private applyJoints(j: Joints, p: Pose): void {
    const sn = j.snap;
    if (!sn || !j.arms || !j.hips) return;
    const jw0 = Math.max(0, Math.min(1, p.jw));
    if (jw0 < 0.001 && !this.snapOn) return;
    const on = jw0 >= 0.001;
    this.snapOn = on;
    const jw = on ? jw0 : 0; // the frame the pose has faded out: put the limbs back at EXACTLY rest, not at a thousandth of the bend
    const t = this.tuning;
    const S = j.hipY / KIP_HIP_REST_MM; // stage units per rig mm
    if (on) {
      // the body: the clip's whole rotation (its own tuning, not a toy's exaggeration), about the hips
      this.q.identity().slerp(p.body, t.bodyGain + (1 - t.bodyGain) * jw);
      this.q2.copy(CAD_TO_STAGE).multiply(this.q).multiply(STAGE_TO_CAD);
      j.g.quaternion.copy(this.q2);
      // where the hips are, in stage units, from where they stand (0, 61.5, 0), plus what keeps the hip joint still while the body turns about it
      this.v.set(p.j.hipsMm.x, p.j.hipsMm.y - KIP_HIP_REST_MM, p.j.hipsMm.z).multiplyScalar(S).applyQuaternion(CAD_TO_STAGE);
      this.v2.set(0, j.hipY, 0);
      this.v.add(this.v2).sub(this.v2.applyQuaternion(this.q2));
      j.g.position.lerp(this.v, jw);
      // the head, local to the hips
      if (j.head) {
        this.qw.copy(p.body).invert().multiply(p.head);
        if (this.extras.headYaw !== 0) this.qw.premultiply(this.qe.setFromAxisAngle(AXIS_Y, this.extras.headYaw));
        if (this.extras.headPitch !== 0) this.qw.premultiply(this.qe.setFromAxisAngle(AXIS_X, this.extras.headPitch));
        j.head.quaternion.slerp(this.qw, jw);
      }
    }
    // the limbs: elbows, wrists, knees and ankles ease in with the exact pose; at jw 0 these are all identity and the flex is 0, which is the rigid limb at rest
    const flex = FLEX_ASSEMBLED * jw;
    const armKeys = [["shoulderL", "elbowL", "wristL"], ["shoulderR", "elbowR", "wristR"]] as const;
    const legKeys = [["hipL", "kneeL", "ankleL"], ["hipR", "kneeR", "ankleR"]] as const;
    for (let i = 0; i < 2; i++) {
      const a = armKeys[i]!;
      this.q3.identity().slerp(p.j[a[1]], jw);
      this.qw.identity().slerp(p.j[a[2]], jw);
      solveSnapArm(p.j[a[0]], this.q3, this.qw, flex, this.sa);
      if (on) j.arms[i]!.quaternion.slerp(this.qx.copy(CAD_TO_STAGE).multiply(this.sa.shoulder).multiply(STAGE_TO_CAD), jw);
      const h = sn.arms[i]!;
      h.flex.deform(this.sa.flex);
      h.fore.position.copy(this.sa.cuffPos);
      h.fore.quaternion.copy(this.sa.cuffQ);
      h.hand.position.copy(this.sa.handPos);
      h.hand.quaternion.copy(this.sa.handQ);
      // what Kip holds goes with the bent hand (the holder moves, the sleeve is held where it is); on the faded-out frame the holder is exactly home
      if (on) followHand(h, j.arms[i]!.quaternion);
      else releaseHand(h);
      const l = legKeys[i]!;
      this.q3.identity().slerp(p.j[l[1]], jw);
      this.qw.identity().slerp(p.j[l[2]], jw);
      solveSnapLeg(p.j[l[0]], this.q3, this.qw, flex, this.sl);
      if (on) j.hips[i]!.quaternion.slerp(this.qx.copy(CAD_TO_STAGE).multiply(this.sl.hip).multiply(STAGE_TO_CAD), jw);
      const g = sn.legs[i]!;
      g.flex.deform(this.sl.flex);
      g.lower.position.copy(this.sl.anklePos);
      g.lower.quaternion.copy(this.sl.ankleQ);
      g.foot.position.copy(this.sl.footPos);
      g.foot.quaternion.copy(this.sl.footQ);
    }
    if (on && p.gw * jw > 0.001) this.ground(j, sn, p.gw * jw);
  }

  /** Stand the lowest sole on the floor (the floor is y = 0 in the frame the rig hangs in), by `w`. The bench's own grounder does this for every planted clip. */
  private ground(j: Joints, sn: SnapRigHandles, w: number): void {
    const parent = j.g.parent;
    if (!parent) return;
    parent.updateWorldMatrix(true, false);
    this.inv.copy(parent.matrixWorld).invert();
    let lowest = Infinity;
    for (const leg of sn.legs) {
      leg.foot.updateWorldMatrix(true, false);
      for (const [dx, dz] of SOLE_PROBES) {
        this.v.set(leg.boot.position.x + dx, leg.boot.position.y, leg.boot.position.z + dz).applyMatrix4(leg.foot.matrixWorld).applyMatrix4(this.inv);
        if (this.v.y < lowest) lowest = this.v.y;
      }
    }
    if (Number.isFinite(lowest)) j.g.position.y -= lowest * w;
  }

  private toStageDir(d: THREE.Vector3): THREE.Vector3 {
    return this.v.copy(d).applyQuaternion(CAD_TO_STAGE);
  }
}
