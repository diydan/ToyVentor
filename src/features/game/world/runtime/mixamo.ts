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
}
export type ClipBank = Record<string, BakedClip>;

export interface Pose {
  hips: THREE.Vector3;
  body: THREE.Quaternion;
  head: THREE.Quaternion;
  armL: THREE.Vector3;
  armR: THREE.Vector3;
  legL: THREE.Vector3;
  legR: THREE.Vector3;
}
export function newPose(): Pose {
  return {
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
}

/* ---------- driving the rig ---------- */

export type MixAction = "dance" | "nod" | "no" | "sneak" | "sad";

interface Joints {
  g: THREE.Object3D;
  head: THREE.Object3D | null;
  arms: [THREE.Object3D, THREE.Object3D] | null;
  hips: [THREE.Object3D, THREE.Object3D] | null;
  /** Hip height in stage units, for scaling the hips bob. */
  hipY: number;
}

/** Find the joints a rig exposes. The STL Kip rig tags its leg pivots with `userData.hip`; procedural rigs just have fewer. */
export function jointsOf(rig: ToyRig): Joints | null {
  if (rig.type !== "character") return null;
  const arms = rig.arms.length >= 2 ? ([rig.arms[0]!, rig.arms[1]!] as [THREE.Object3D, THREE.Object3D]) : null;
  const h0 = rig.feet[0]?.userData?.hip as THREE.Object3D | undefined;
  const h1 = rig.feet[1]?.userData?.hip as THREE.Object3D | undefined;
  const hips = h0 && h1 ? ([h0, h1] as [THREE.Object3D, THREE.Object3D]) : null;
  const head = (rig.head as THREE.Object3D | undefined) ?? null;
  if (!arms && !hips && !head) return null;
  return { g: rig.g, head, arms, hips, hipY: (rig.mixHipY as number | undefined) ?? 1.14 };
}

/** Secondary head motion the engine still owns: a glance when something is hidden nearby, and the start/stop lean spring. */
export interface DriverExtras { headYaw: number; headPitch: number }
const NO_EXTRAS: DriverExtras = { headYaw: 0, headPitch: 0 };
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_X = new THREE.Vector3(1, 0, 0);

const ACTION_FADE = 0.28;
const ACTION_ENV = (t: number, dur: number): number => Math.max(0, Math.min(1, Math.min(t / ACTION_FADE, (dur - t) / ACTION_FADE)));
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
  private action: { clip: BakedClip; t: number } | null = null;
  private readonly p = newPose();
  private readonly a = newPose();
  private readonly q = new THREE.Quaternion();
  private readonly q2 = new THREE.Quaternion();
  private readonly qe = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();

  constructor(private readonly bank: ClipBank, private readonly tuning: DriverTuning = DEFAULT_TUNING) {}

  /** True when this rig can be driven and the idle + walk clips are present. */
  canDrive(rig: ToyRig): boolean {
    return !!this.bank.idle && !!this.bank.walk && jointsOf(rig) !== null;
  }

  /** Start a one-shot gesture. Returns false if the clip is not in the bank. */
  trigger(name: MixAction): boolean {
    const clip = this.bank[name];
    if (!clip) return false;
    this.action = { clip, t: 0 };
    return true;
  }

  get busyAction(): string | null { return this.action ? this.action.clip.name : null; }

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
      act.t += dt;
      const dur = act.clip.pose ? 1.4 : act.clip.duration;
      // Walking cancels gestures fast; a one-shot stands still.
      const w = ACTION_ENV(act.t, dur) * (act.clip.pose ? tn.poseGain : 1) * (1 - smooth(0.4, 1.2, speed));
      sampleClip(act.clip, act.t, this.a);
      mixPose(p, this.a, w);
      if (act.t >= dur) this.action = null;
    }
    this.apply(j, p);
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

  private toStageDir(d: THREE.Vector3): THREE.Vector3 {
    return this.v.copy(d).applyQuaternion(CAD_TO_STAGE);
  }
}
