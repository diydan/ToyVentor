// Hand-built Kip animation clips: reactions, short dances, and one clip per handheld prop.
//
// Pure data and maths, no page state: every maker takes THREE and returns an AnimationClip, exactly like the vehicle clips in
// kip-vehicles-wardrobe.js. The page registers them (see "Kip clips" in Kip-Demo.html); tests/kip-clips.test.ts checks them numerically.
// Why hand-built and not Mixamo: the shipped Mixamo clips are the three.js sample set (Idle, Walk, Run, Agree, Shake, Samba), the retargeter
// can only drive the 14 joints below, and a prop clip has to put the prop where the prop is, which no captured clip knows about.
//
// Pose conventions (degrees, Euler order ZYX, so X is applied first), read off the existing clips and checked in the contact sheet:
//   - every limb rests pointing DOWN; the head and hips rest pointing UP; the character faces +Z and its left side is +X;
//   - rx: negative swings a hanging limb FORWARD (arms reach, thighs rise); positive tips the hips and head forward;
//   - rz: positive swings a hanging limb out toward the character's left (+X), negative toward its right;
//   - ry turns a forward-pointing limb sideways (positive toward +X) and twists a hanging one about its own length.
// Knees (LeftLeg, RightLeg) only ever use rx >= 0: the existing clips span 0 to 92 and a knee does not bend backwards.
// Every clip is a seamless loop (a function of the phase `ph` over one full turn) so it can play under the page's looping mixer.

export const KIP_CLIP_JOINTS = Object.freeze([
  'Hips', 'Head',
  'LeftArm', 'LeftForeArm', 'LeftHand',
  'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot',
  'RightUpLeg', 'RightLeg', 'RightFoot',
]);

/** Standing hip height in mm (the same 61.5 every existing clip and the retargeter use). */
export const HIP_Y = 61.5;
const FPS = 30;

/**
 * Build a looping clip. `poseFn(ph, setQ, t)` is called once per frame with the phase (0 to 2*PI, both ends included so the loop closes),
 * a `setQ(joint, rx, ry, rz)` setter, and the time in seconds; it returns the hips position [x, y, z] in mm.
 */
export function buildKipClip(THREE, name, dur, poseFn) {
  const steps = Math.max(2, Math.round(dur * FPS) + 1);
  const times = new Float32Array(steps);
  const d2r = THREE.MathUtils.degToRad;
  const e = new THREE.Euler();
  const q = new THREE.Quaternion();
  const bufs = Object.fromEntries(KIP_CLIP_JOINTS.map((n) => [n, new Float32Array(steps * 4)]));
  const pBuf = new Float32Array(steps * 3);
  for (let i = 0; i < steps; i++) {
    const t = (i / (steps - 1)) * dur;
    const ph = (i / (steps - 1)) * Math.PI * 2;
    times[i] = t;
    const setQ = (nm, rx, ry, rz) => {
      q.setFromEuler(e.set(d2r(rx), d2r(ry), d2r(rz), 'ZYX'));
      const b = bufs[nm];
      if (i > 0 && b[(i - 1) * 4] * q.x + b[(i - 1) * 4 + 1] * q.y + b[(i - 1) * 4 + 2] * q.z + b[(i - 1) * 4 + 3] * q.w < 0) {
        q.x = -q.x; q.y = -q.y; q.z = -q.z; q.w = -q.w; // same rotation, nearer hemisphere: no long-way-round slerp
      }
      b[i * 4] = q.x; b[i * 4 + 1] = q.y; b[i * 4 + 2] = q.z; b[i * 4 + 3] = q.w;
    };
    const hp = poseFn(ph, setQ, t);
    pBuf[i * 3] = hp[0]; pBuf[i * 3 + 1] = hp[1]; pBuf[i * 3 + 2] = hp[2];
  }
  const tracks = [new THREE.VectorKeyframeTrack('kip_Hips.position', times, pBuf)];
  for (const n of KIP_CLIP_JOINTS) tracks.push(new THREE.QuaternionKeyframeTrack(`kip_${n}.quaternion`, times, bufs[n]));
  return new THREE.AnimationClip(name, dur, tracks);
}

const S = Math.sin;
const C = Math.cos;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
/** 0 to 1 and back once per cycle with a flat top: a held pose (a bow, a salute) with soft entry and exit. */
const hold = (ph, flat = 0.5) => clamp01((0.5 - 0.5 * C(ph)) / (1 - flat));
/** Step through `arr` once per cycle, holding each value and snapping to the next over the last `snap` of its slot (robot moves). */
function steps(ph, arr, snap = 0.3) {
  const n = arr.length;
  const u = (ph / (Math.PI * 2)) * n;
  const i = Math.floor(u) % n;
  const f = u - Math.floor(u);
  return arr[i] + (arr[(i + 1) % n] - arr[i]) * smooth((f - (1 - snap)) / snap);
}

/** The relaxed left arm and both legs every prop clip starts from. Spread into a pose with `rest(setQ)`. */
function rest(setQ, { left = true, legs = true } = {}) {
  if (left) {
    setQ('LeftArm', -8, 6, 14); setQ('LeftForeArm', -14, 8, 4); setQ('LeftHand', 0, 0, -6);
  }
  if (legs) {
    setQ('LeftUpLeg', 2, 3, 3); setQ('LeftLeg', 0, 0, 0); setQ('LeftFoot', 0, 0, -3);
    setQ('RightUpLeg', 2, -3, -3); setQ('RightLeg', 0, 0, 0); setQ('RightFoot', 0, 0, 3);
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Reactions (1 to 3 s loops)
// ---------------------------------------------------------------------------------------------------------------------------------
const reactions = [
  {
    id: 'cheer', label: 'Cheer', dur: 1.6,
    pose(ph, setQ) {
      const pump = S(ph * 2);
      setQ('Hips', -2, S(ph * 2) * 4, 0);
      setQ('Head', -12, S(ph * 2) * 5, S(ph * 2) * 4);
      setQ('LeftArm', -6, 0, 152 + pump * 10); setQ('LeftForeArm', 0, 0, 8 - pump * 8); setQ('LeftHand', 0, 0, 0);
      setQ('RightArm', -6, 0, -152 - pump * 10); setQ('RightForeArm', 0, 0, -8 + pump * 8); setQ('RightHand', 0, 0, 0);
      const crouch = Math.abs(S(ph * 2));
      setQ('LeftUpLeg', -6 - crouch * 14, 2, 6); setQ('LeftLeg', 4 + crouch * 26, 0, 0); setQ('LeftFoot', 2 - crouch * 8, 0, -4);
      setQ('RightUpLeg', -6 - crouch * 14, -2, -6); setQ('RightLeg', 4 + crouch * 26, 0, 0); setQ('RightFoot', 2 - crouch * 8, 0, 4);
      return [0, HIP_Y - 1.5 + (1 - crouch) * 3.5, 0];
    },
  },
  {
    id: 'clap', label: 'Clap', dur: 1.2,
    pose(ph, setQ) {
      const close = Math.pow(0.5 + 0.5 * C(ph * 2), 2); // 1 = hands together, two claps per cycle
      const spread = 16 - close * 16;
      setQ('Hips', 0, 0, 0);
      setQ('Head', -2, 0, 0);
      setQ('LeftArm', -52, -24 + spread * 0.4, 0); setQ('LeftForeArm', -72, -12 - spread * 0.6, 0); setQ('LeftHand', 0, 0, 0);
      setQ('RightArm', -52, 24 - spread * 0.4, 0); setQ('RightForeArm', -72, 12 + spread * 0.6, 0); setQ('RightHand', 0, 0, 0);
      rest(setQ, { left: false });
      return [0, HIP_Y + close * 0.8, 0];
    },
  },
  {
    id: 'think', label: 'Think', dur: 3.0,
    pose(ph, setQ) {
      setQ('Hips', 0, S(ph) * 4, 2);
      setQ('Head', 8 + S(ph * 2) * 5, -10 + S(ph) * 16, 9 + S(ph) * 6);
      setQ('RightArm', -34 + S(ph * 3) * 3, -26, -8); setQ('RightForeArm', -118 + S(ph * 3) * 7, -6, 0); setQ('RightHand', S(ph * 3) * 10, 0, 0); // a tapping wrist
      setQ('LeftArm', -48, 22, 6); setQ('LeftForeArm', -62, 18, 0); setQ('LeftHand', 0, 0, 0); // supports the elbow
      rest(setQ, { left: false });
      return [0, HIP_Y, 0];
    },
  },
  {
    id: 'jump', label: 'Jump', dur: 1.4,
    pose(ph, setQ) {
      const air = Math.max(0, S(ph));           // 0 to 1 hump over the first half: in the air
      const squat = Math.max(0, -S(ph));        // 0 to 1 hump over the second half: crouch before and after the leap
      setQ('Hips', 6 * squat, 0, 0);
      setQ('Head', -6 * squat - 4 * air, 0, 0);
      setQ('LeftArm', -20 - squat * 36 + air * 150, 4, 16 + air * 34); setQ('LeftForeArm', -10, 0, 0); setQ('LeftHand', 0, 0, 0);
      setQ('RightArm', -20 - squat * 36 + air * 150, -4, -16 - air * 34); setQ('RightForeArm', -10, 0, 0); setQ('RightHand', 0, 0, 0);
      setQ('LeftUpLeg', -8 - squat * 54 + air * 8, 2, 4); setQ('LeftLeg', 6 + squat * 78 - air * 4, 0, 0); setQ('LeftFoot', 2 - squat * 14 + air * 22, 0, -3);
      setQ('RightUpLeg', -8 - squat * 54 + air * 8, -2, -4); setQ('RightLeg', 6 + squat * 78 - air * 4, 0, 0); setQ('RightFoot', 2 - squat * 14 + air * 22, 0, 3);
      return [0, HIP_Y - squat * 12 + air * 22, 0];
    },
  },
  {
    id: 'bow', label: 'Bow', dur: 2.6,
    pose(ph, setQ) {
      const b = hold(ph, 0.35);
      setQ('Hips', 44 * b, 0, 0);
      setQ('Head', 8 * b, 0, 0);
      setQ('LeftArm', -6 + 10 * b, 4, 12 - 6 * b); setQ('LeftForeArm', -14 - 30 * b, 6, 0); setQ('LeftHand', 0, 0, 0);
      setQ('RightArm', -6 + 10 * b, -4, -12 + 6 * b); setQ('RightForeArm', -14 - 30 * b, -6, 0); setQ('RightHand', 0, 0, 0);
      rest(setQ, { left: false });
      return [0, HIP_Y - 3 * b, -3 * b];
    },
  },
  {
    id: 'salute', label: 'Salute', dur: 2.6,
    pose(ph, setQ) {
      const a = hold(ph, 0.5);
      setQ('Hips', 0, -4 * a, 0);
      setQ('Head', -3 * a, 6 * a, 0);
      setQ('RightArm', -6 - 14 * a, 0, -12 - 92 * a); setQ('RightForeArm', -10 * a, -94 * a, -20 - 96 * a); setQ('RightHand', 0, 0, -4 * a);
      setQ('LeftArm', -6, 6, 12); setQ('LeftForeArm', -12, 8, 4); setQ('LeftHand', 0, 0, -6);
      rest(setQ, { left: false });
      return [0, HIP_Y, 0];
    },
  },
];

// ---------------------------------------------------------------------------------------------------------------------------------
// Dances (6 to 8 s loops, whole beats per loop so they close)
// ---------------------------------------------------------------------------------------------------------------------------------
const dances = [
  {
    id: 'dance_boogie', label: 'Boogie', dur: 8,
    pose(ph, setQ) {
      const b = ph * 16;                  // 16 beats at 120 bpm
      const sway = S(b * 0.5);            // side to side every two beats
      const bounce = Math.abs(S(b));      // down on every beat
      setQ('Hips', 2 + bounce * 3, sway * 14, sway * 6);
      setQ('Head', -2 + bounce * 2, -sway * 10, -sway * 5);
      setQ('LeftArm', -30 + C(b * 0.5) * 36, 8, 22 + S(b * 0.5 + 1) * 10); setQ('LeftForeArm', -40 - bounce * 24, 0, 0); setQ('LeftHand', 0, 0, -6);
      setQ('RightArm', -30 - C(b * 0.5) * 36, -8, -22 + S(b * 0.5 + 1) * 10); setQ('RightForeArm', -40 - bounce * 24, 0, 0); setQ('RightHand', 0, 0, 6);
      setQ('LeftUpLeg', -4 - Math.max(0, S(b * 0.5)) * 26, 2, 5 + Math.max(0, -S(b * 0.5)) * 6); setQ('LeftLeg', 6 + Math.max(0, S(b * 0.5)) * 30 + bounce * 10, 0, 0); setQ('LeftFoot', 0, 0, -3);
      setQ('RightUpLeg', -4 - Math.max(0, -S(b * 0.5)) * 26, -2, -5 - Math.max(0, S(b * 0.5)) * 6); setQ('RightLeg', 6 + Math.max(0, -S(b * 0.5)) * 30 + bounce * 10, 0, 0); setQ('RightFoot', 0, 0, 3);
      return [sway * 3, HIP_Y - 3 + (1 - bounce) * 3, 0];
    },
  },
  {
    id: 'dance_robot', label: 'Robot dance', dur: 8,
    pose(ph, setQ) {
      // Eight one-second slots: hold, then snap. Right angles only, the way a toy robot would.
      const aL = steps(ph, [-90, -90, -10, -90, -10, -90, -90, -10]);   // left upper arm, forward swing
      const aR = steps(ph, [-10, -90, -90, -10, -90, -10, -90, -90]);   // right upper arm
      const fL = steps(ph, [-90, 0, -90, 0, -90, 0, -90, 0]);           // elbows
      const fR = steps(ph, [0, -90, 0, -90, 0, -90, 0, -90]);
      const turn = steps(ph, [0, 0, 28, 28, 0, 0, -28, -28], 0.25);
      const dip = steps(ph, [0, 1, 0, 1, 0, 1, 0, 1], 0.25);
      setQ('Hips', 0, turn, 0);
      setQ('Head', 0, -turn * 0.6, steps(ph, [0, 8, 0, -8, 0, 8, 0, -8], 0.25));
      setQ('LeftArm', aL, 0, 14); setQ('LeftForeArm', fL, 0, 0); setQ('LeftHand', 0, 0, 0);
      setQ('RightArm', aR, 0, -14); setQ('RightForeArm', fR, 0, 0); setQ('RightHand', 0, 0, 0);
      setQ('LeftUpLeg', -4 - dip * 22, 0, 4); setQ('LeftLeg', 4 + dip * 40, 0, 0); setQ('LeftFoot', 0, 0, -3);
      setQ('RightUpLeg', -4 - dip * 22, 0, -4); setQ('RightLeg', 4 + dip * 40, 0, 0); setQ('RightFoot', 0, 0, 3);
      return [0, HIP_Y - dip * 5, 0];
    },
  },
  {
    id: 'dance_disco', label: 'Disco point', dur: 6,
    pose(ph, setQ) {
      const b = ph * 12;                          // 12 beats at 120 bpm
      const up = steps(ph, [1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0], 0.7);   // left arm points up
      const dn = steps(ph, [0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1], 0.7);   // right arm points up
      const side = up - dn;
      const bob = Math.abs(S(b));
      setQ('Hips', 0, -side * 8, side * 7);
      setQ('Head', -4, side * 10, side * 6);
      setQ('LeftArm', -4, 0, 14 + up * 128); setQ('LeftForeArm', 0, 0, up * 4); setQ('LeftHand', 0, 0, 0);
      setQ('RightArm', -4, 0, -14 - dn * 128); setQ('RightForeArm', 0, 0, -dn * 4); setQ('RightHand', 0, 0, 0);
      setQ('LeftUpLeg', -2 - dn * 18, 0, 4 + dn * 10); setQ('LeftLeg', 3 + dn * 22, 0, 0); setQ('LeftFoot', 0, 0, -3);
      setQ('RightUpLeg', -2 - up * 18, 0, -4 - up * 10); setQ('RightLeg', 3 + up * 22, 0, 0); setQ('RightFoot', 0, 0, 3);
      return [side * 2.5, HIP_Y - 1 + bob * 2, 0];
    },
  },
];

// ---------------------------------------------------------------------------------------------------------------------------------
// Prop clips: the right hand carries the prop (makeHandheldProp: its long axis lies sideways across the hand), the left arm stays out of
// the way. The poses below are what the contact sheet showed reads as the job; see docs/specs/kip-clips-notes.md for how they were checked.
// ---------------------------------------------------------------------------------------------------------------------------------
function work(setQ, { arm, fore, hand, hips = [0, 0, 0], head = [0, 0, 0], left = null }) {
  setQ('Hips', ...hips);
  setQ('Head', ...head);
  setQ('RightArm', ...arm); setQ('RightForeArm', ...fore); setQ('RightHand', ...hand);
  if (left) { setQ('LeftArm', ...left.arm); setQ('LeftForeArm', ...left.fore); setQ('LeftHand', ...(left.hand ?? [0, 0, 0])); }
  rest(setQ, { left: !left });
}

const props = [
  { id: 'prop_broom', prop: 'broom', label: 'Sweep (broom)', dur: 2.0,
    pose(ph, setQ) { const s = S(ph);
      work(setQ, { arm: [-44 + s * 8, -10 + s * 16, -10], fore: [-40, 0, 0], hand: [0, 90, 0], hips: [8, s * 10, 0], head: [10, -s * 6, 0] });
      return [0, HIP_Y - 1, 0]; } },
  { id: 'prop_mop', prop: 'mop', label: 'Mop', dur: 2.4,
    pose(ph, setQ) { const s = S(ph);
      work(setQ, { arm: [-42, -12 + s * 20, -10], fore: [-44, 0, 0], hand: [0, 90, 0], hips: [10, s * 12, 0], head: [12, -s * 8, 0] });
      return [0, HIP_Y - 1, 0]; } },
  { id: 'prop_scrub_brush', prop: 'scrub_brush', label: 'Scrub (brush)', dur: 1.0,
    pose(ph, setQ) { const s = S(ph * 2);
      work(setQ, { arm: [-58, -6, -8], fore: [-70 + s * 18, 0, 0], hand: [0, 0, 80], hips: [14, 0, 0], head: [16, 0, 0] });
      return [0, HIP_Y - 2, 0]; } },
  { id: 'prop_vacuum', prop: 'vacuum', label: 'Vacuum', dur: 2.4,
    pose(ph, setQ) { const s = S(ph);
      work(setQ, { arm: [-50, -16 + s * 22, -8], fore: [-40, 0, 0], hand: [0, 90, 0], hips: [6, s * 8, 0], head: [8, -s * 6, 0] });
      return [0, HIP_Y - 0.5, 0]; } },
  { id: 'prop_paint_roller', prop: 'paint_roller', label: 'Paint (roller)', dur: 2.0,
    pose(ph, setQ) { const s = S(ph);
      work(setQ, { arm: [-60 - s * 40, -6, -6], fore: [-46 + s * 10, 0, 0], hand: [0, 90, 0], hips: [0, 0, 0], head: [-10 - s * 6, 0, 0] });
      return [0, HIP_Y, 0]; } },
  { id: 'prop_hammer', prop: 'hammer', label: 'Hammer', dur: 1.2,
    pose(ph, setQ) { const k = Math.pow(0.5 - 0.5 * C(ph), 2); // slow wind-up, quick strike
      work(setQ, { arm: [-70 - k * 70, -8, -8], fore: [-30 - k * 40, 0, 0], hand: [0, 90, 0], hips: [6 + k * 6, 0, 0], head: [10, 0, 0] });
      return [0, HIP_Y - k * 1.5, 0]; } },
  { id: 'prop_screwdriver', prop: 'screwdriver', label: 'Screw (driver)', dur: 1.6,
    pose(ph, setQ) { const s = S(ph * 2);
      work(setQ, { arm: [-62, -8, -8], fore: [-74, 0, 0], hand: [0, 90 + s * 6, s * 40], hips: [8, 0, 0], head: [14, 0, 0] });
      return [0, HIP_Y - 1, 0]; } },
  { id: 'prop_wrench', prop: 'wrench', label: 'Tighten (wrench)', dur: 1.8,
    pose(ph, setQ) { const s = hold(ph, 0.2);
      work(setQ, { arm: [-62, -6, -8], fore: [-66, 0, 0], hand: [0, 0, 20 + s * 70], hips: [8, 0, 0], head: [12, 0, 0] });
      return [0, HIP_Y - 1, 0]; } },
  { id: 'prop_guitar', prop: 'guitar', label: 'Strum (guitar)', dur: 1.2,
    pose(ph, setQ) { const s = S(ph * 2);
      work(setQ, { arm: [-36 + s * 5, -18, -10], fore: [-76 + s * 17, 0, 0], hand: [s * 14, 0, 70], hips: [0, 8 + S(ph) * 5, S(ph) * 3], head: [8 + s * 8, -12, 0], left: { arm: [-46, 26, 10], fore: [-52, 20, 0] } });
      return [0, HIP_Y + Math.abs(s) * 0.6, 0]; } },
  { id: 'prop_trumpet', prop: 'trumpet', label: 'Trumpet', dur: 2.0,
    pose(ph, setQ) { const s = S(ph * 2);
      const p = S(ph);
      work(setQ, { arm: [-30 + p * 7, -26, -6], fore: [-116 + s * 5, 0, 0], hand: [0, 0, 80], hips: [-4 + p * 3, 0, p * 4], head: [-8 + p * 9, p * 6, 0] });
      return [0, HIP_Y + Math.abs(s) * 0.5, 0]; } },
  { id: 'prop_maracas', prop: 'maracas', label: 'Shake (maracas)', dur: 0.8,
    pose(ph, setQ) { const s = S(ph * 4);
      work(setQ, { arm: [-60, -10, -14], fore: [-84 + s * 14, 0, 0], hand: [s * 18, 0, 70], hips: [0, s * 4, 0], head: [0, 0, s * 4], left: { arm: [-50, 12, 12], fore: [-60 - s * 14, 0, 0] } });
      return [0, HIP_Y + Math.abs(s) * 1.2, 0]; } },
  { id: 'prop_flag', prop: 'flag', label: 'Wave (flag)', dur: 2.0,
    pose(ph, setQ) { const s = S(ph);
      work(setQ, { arm: [-18, 0, -86 + s * 8], fore: [-24, -90, -52 + s * 12], hand: [0, 0, 0], hips: [0, s * 3, 2], head: [-6, 6, 6] });
      return [0, HIP_Y + Math.abs(s) * 1.4, 0]; } },
  { id: 'prop_magnifier', prop: 'magnifier', label: 'Inspect (magnifier)', dur: 3.0,
    pose(ph, setQ) { const s = S(ph);
      work(setQ, { arm: [-66 + s * 6, -10 + s * 10, -6], fore: [-34, 0, 0], hand: [0, 0, 60], hips: [10, s * 6, 0], head: [14 + s * 4, -s * 8, 0] });
      return [0, HIP_Y - 1.2, 0]; } },
  { id: 'prop_shield', prop: 'shield', label: 'Block (shield)', dur: 1.4,
    pose(ph, setQ) { const k = Math.pow(0.5 - 0.5 * C(ph * 2), 2);
      work(setQ, { arm: [-56 - k * 10, 12, -4], fore: [-68, -10, 0], hand: [0, 0, 0], hips: [0, -10 - k * 6, 0], head: [2, 10, 0] });
      return [0, HIP_Y - 1 - k * 1.2, 0]; } },
  { id: 'prop_shaft', prop: 'shaft', label: 'Spin (spinner)', dur: 1.5,
    pose(ph, setQ) { const s = S(ph);
      work(setQ, { arm: [-52, -10, -10], fore: [-44, 0, 0], hand: [0, 90, s * 24], hips: [4, s * 6, 0], head: [6, 0, 0] });
      return [0, HIP_Y, 0]; } },
];

function describe(group, list) {
  return list.map((c) => Object.freeze({ id: c.id, label: c.label, group, dur: c.dur, ...(c.prop ? { prop: c.prop } : {}), pose: c.pose }));
}

/** Every clip this module adds, in menu order: reactions, dances, prop clips. */
export const KIP_CLIPS = Object.freeze([...describe('reaction', reactions), ...describe('dance', dances), ...describe('prop', props)]);

/** prop id (a PROP_OPTIONS id) -> clip id. The page plays the clip when the prop is equipped on foot, as it does for the skateboard. */
export const PROP_CLIPS = Object.freeze(Object.fromEntries(KIP_CLIPS.filter((c) => c.prop).map((c) => [c.prop, c.id])));

export function clipForProp(propId) {
  return PROP_CLIPS[propId] ?? null;
}

/** True for the id of any prop clip (the page uses it to leave a prop clip when the prop is put away). */
export function isPropClip(clipId) {
  return Object.values(PROP_CLIPS).includes(clipId);
}

/** Build the AnimationClip for one entry of KIP_CLIPS. */
export function makeKipClip(THREE, entry) {
  return buildKipClip(THREE, entry.id, entry.dur, entry.pose);
}
