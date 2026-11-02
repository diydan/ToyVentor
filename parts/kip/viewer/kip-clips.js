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
// The page keeps the lowest foot on the floor, so hip height cannot lift Kip off the ground: there is no jump clip (Space already hops).
// How the poses were checked: tests/kip-clips.test.ts for the numbers, and contact sheets (six frames per clip, 3/4 and front cameras) made
// with window.kipClips.scrub(id, t) from the real page, because a prop's long axis lies sideways across the hand and only a render shows it.

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
      const open = 1 - Math.pow(0.5 + 0.5 * C(ph * 2), 2); // 0 = hands together, 1 = hands apart; two claps a cycle
      setQ('Hips', 0, 0, 0);
      setQ('Head', -2, 0, 0);
      setQ('LeftArm', -52, -16 + 22 * open, 0); setQ('LeftForeArm', -72, -10 + 14 * open, 0); setQ('LeftHand', 0, 0, 0);
      setQ('RightArm', -52, 16 - 22 * open, 0); setQ('RightForeArm', -72, 10 - 14 * open, 0); setQ('RightHand', 0, 0, 0);
      rest(setQ, { left: false });
      return [0, HIP_Y + (1 - open) * 0.8, 0];
    },
  },
  {
    id: 'think', label: 'Think', dur: 3.0,
    pose(ph, setQ) {
      setQ('Hips', 0, S(ph) * 4, 2);
      setQ('Head', 8 + S(ph * 2) * 5, -10 + S(ph) * 16, 9 + S(ph) * 6);
      setQ('RightArm', -34 + S(ph * 3) * 3, -26, -8); setQ('RightForeArm', -118 + S(ph * 3) * 7, -6, 0); setQ('RightHand', S(ph * 3) * 10, 0, 0); // a tapping wrist
      setQ('LeftArm', -50, -40, 4); setQ('LeftForeArm', -72, -34, 0); setQ('LeftHand', 0, 0, 0); // across the body, under the right elbow
      rest(setQ, { left: false });
      return [0, HIP_Y, 0];
    },
  },
  {
    id: 'flex', label: 'Flex', dur: 1.6,
    pose(ph, setQ) {
      const pump = S(ph * 2);   // two flexes a cycle
      const k = 0.5 + 0.5 * pump;
      setQ('Hips', -2, S(ph) * 5, 0);
      setQ('Head', -6, S(ph) * 8, S(ph) * 3);
      setQ('LeftArm', -6, 0, 96 + k * 4); setQ('LeftForeArm', 0, 94, 78 + k * 30); setQ('LeftHand', 0, 0, 0);
      setQ('RightArm', -6, 0, -96 - k * 4); setQ('RightForeArm', 0, -94, -78 - k * 30); setQ('RightHand', 0, 0, 0);
      setQ('LeftUpLeg', -2, 2, 12); setQ('LeftLeg', 4, 0, 0); setQ('LeftFoot', 0, 0, -9);
      setQ('RightUpLeg', -2, -2, -12); setQ('RightLeg', 4, 0, 0); setQ('RightFoot', 0, 0, 9);
      return [0, HIP_Y - 1 + k * 1.2, 0];
    },
  },
  {
    id: 'bow', label: 'Bow', dur: 2.6,
    pose(ph, setQ) {
      const b = hold(ph, 0.35);
      setQ('Hips', 28 * b, 0, 0);
      setQ('Head', 8 * b, 0, 0);
      setQ('LeftArm', -6 + 10 * b, 4, 12 - 6 * b); setQ('LeftForeArm', -14 - 30 * b, 6, 0); setQ('LeftHand', 0, 0, 0);
      setQ('RightArm', -6 + 10 * b, -4, -12 + 6 * b); setQ('RightForeArm', -14 - 30 * b, -6, 0); setQ('RightHand', 0, 0, 0);
      rest(setQ, { left: false, legs: false });
      // The legs hang from the hips joint, so pitching the hips pitches them too: counter-rotate the thighs and the bow folds at the waist.
      setQ('LeftUpLeg', 2 - 28 * b, 3, 3); setQ('LeftLeg', 0, 0, 0); setQ('LeftFoot', 0, 0, -3);
      setQ('RightUpLeg', 2 - 28 * b, -3, -3); setQ('RightLeg', 0, 0, 0); setQ('RightFoot', 0, 0, 3);
      return [0, HIP_Y - 1 * b, -2 * b];
    },
  },
  {
    id: 'salute', label: 'Salute', dur: 2.6,
    pose(ph, setQ) {
      const a = hold(ph, 0.5);
      setQ('Hips', 0, -4 * a, 0);
      setQ('Head', -3 * a, 6 * a, 0);
      setQ('RightArm', -6 - 14 * a, 0, -12 - 100 * a); setQ('RightForeArm', -10 * a, -94 * a, -20 - 112 * a); setQ('RightHand', 0, 0, -4 * a);
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
function work(setQ, { arm, fore, hand, hips = [0, 0, 0], head = [0, 0, 0], left = null, crouch = 0 }) {
  setQ('Hips', ...hips);
  setQ('Head', ...head);
  setQ('RightArm', ...arm); setQ('RightForeArm', ...fore); setQ('RightHand', ...hand);
  if (left) { setQ('LeftArm', ...left.arm); setQ('LeftForeArm', ...left.fore); setQ('LeftHand', ...(left.hand ?? [0, 0, 0])); }
  rest(setQ, { left: !left, legs: crouch === 0 });
  if (crouch > 0) { // knees and hips bent so a hand-held tool can reach the floor; the foot stays flat (the chain's angles sum to zero)
    setQ('LeftUpLeg', -2 - 24 * crouch, 3, 3); setQ('LeftLeg', 30 * crouch, 0, 0); setQ('LeftFoot', -6 * crouch, 0, -3);
    setQ('RightUpLeg', -2 - 24 * crouch, -3, -3); setQ('RightLeg', 30 * crouch, 0, 0); setQ('RightFoot', -6 * crouch, 0, 3);
  }
}

// What the hand angles do to a prop (the prop hangs off a node under the hand with a fixed 90 degree twist about the arm, so its long axis is the
// hand's forward direction): hand rx pitches it (0 = across the forearm, +90 = along the forearm beyond the hand), hand ry swings it about the
// arm (90 = sideways, 180 = turned end for end, which puts a working end that points down up instead), hand rz only rolls it. The Euler order is
// ZYX, so rx is applied first and ry then turns the pitched prop about its own length: that is how a screwdriver rolls.
const props = [
  { id: 'prop_broom', prop: 'broom', label: 'Sweep (broom)', dur: 2.0,
    pose(ph, setQ) { const s = S(ph);
      work(setQ, { arm: [-30 + s * 6, -4 + s * 16, -8], fore: [-24, 0, 0], hand: [0, 0, 84], hips: [16, s * 7, 0], head: [14, -s * 5, 0], crouch: 0.55 });
      return [0, HIP_Y - 4, 0]; } },
  { id: 'prop_mop', prop: 'mop', label: 'Mop', dur: 2.4,
    pose(ph, setQ) { const s = S(ph);
      work(setQ, { arm: [-34, -6 + s * 18, -8], fore: [-28, 0, 0], hand: [0, 0, 84], hips: [18, s * 9, 0], head: [16, -s * 6, 0], crouch: 0.55 });
      return [0, HIP_Y - 4, 0]; } },
  { id: 'prop_scrub_brush', prop: 'scrub_brush', label: 'Scrub (brush)', dur: 1.0,
    pose(ph, setQ) { const s = S(ph * 2);
      work(setQ, { arm: [-40 + s * 12, -2, -8], fore: [-44 + s * 6, 0, 0], hand: [0, 0, 86], hips: [20, 0, 0], head: [20, 0, 0], crouch: 0.7 });
      return [0, HIP_Y - 6, 0]; } },
  { id: 'prop_vacuum', prop: 'vacuum', label: 'Vacuum', dur: 2.4,
    pose(ph, setQ) { const s = S(ph);
      work(setQ, { arm: [-38, -10 + s * 20, -8], fore: [-42, 0, 0], hand: [0, 0, 70], hips: [10, s * 8, 0], head: [10, -s * 6, 0], crouch: 0.3 });
      return [0, HIP_Y - 2, 0]; } },
  { id: 'prop_paint_roller', prop: 'paint_roller', label: 'Paint (roller)', dur: 2.0,
    pose(ph, setQ) { const s = S(ph);
      work(setQ, { arm: [-96 - s * 26, -4, -6], fore: [-14 + s * 6, 0, 0], hand: [0, 180, 0], hips: [0, 0, 0], head: [-12 - s * 5, 0, 0] });
      return [0, HIP_Y, 0]; } },
  { id: 'prop_hammer', prop: 'hammer', label: 'Hammer', dur: 1.2,
    pose(ph, setQ) { const k = Math.pow(0.5 - 0.5 * C(ph), 2); // slow wind-up overhead, quick strike down
      work(setQ, { arm: [-60 - k * 90, -6, -8], fore: [-24 - k * 36, 0, 0], hand: [0, 0, 84], hips: [8 + k * 8, 0, 0], head: [10, 0, 0] });
      return [0, HIP_Y - k * 1.5, 0]; } },
  { id: 'prop_screwdriver', prop: 'screwdriver', label: 'Screw (driver)', dur: 1.6,
    pose(ph, setQ) { const s = S(ph * 2);
      work(setQ, { arm: [-44, -6, -8], fore: [-46, 0, 0], hand: [90, s * 80, 0], hips: [0, 0, 0], head: [10, 0, 0] });
      return [0, HIP_Y - 1, 0]; } },
  { id: 'prop_wrench', prop: 'wrench', label: 'Tighten (wrench)', dur: 1.8,
    pose(ph, setQ) { const s = hold(ph, 0.2);
      work(setQ, { arm: [-62, -6, -8], fore: [-66, 0, 0], hand: [-35 + s * 70, 0, 70], hips: [8, 0, 0], head: [12, 0, 0] });
      return [0, HIP_Y - 1, 0]; } },
  { id: 'prop_guitar', prop: 'guitar', label: 'Strum (guitar)', dur: 1.2,
    pose(ph, setQ) { const s = S(ph * 2);
      work(setQ, { arm: [-34, -14, -8], fore: [-68 + s * 14, 0, 0], hand: [s * 12, 0, 56], hips: [0, 8 + S(ph) * 5, S(ph) * 3], head: [8 + s * 8, -12, 0], left: { arm: [-58, 12, 8], fore: [-58, 8, 0] } });
      return [0, HIP_Y + Math.abs(s) * 0.6, 0]; } },
  { id: 'prop_trumpet', prop: 'trumpet', label: 'Trumpet', dur: 2.0,
    pose(ph, setQ) { const s = S(ph * 2); const p = S(ph);
      work(setQ, { arm: [-30 + p * 7, -26, -6], fore: [-116 + s * 5, 0, 0], hand: [0, 0, 80], hips: [-4 + p * 3, 0, p * 4], head: [-8 + p * 9, p * 6, 0] });
      return [0, HIP_Y + Math.abs(s) * 0.5, 0]; } },
  { id: 'prop_maracas', prop: 'maracas', label: 'Shake (maracas)', dur: 0.8,
    pose(ph, setQ) { const s = S(ph * 4);
      work(setQ, { arm: [-60, -10, -14], fore: [-84 + s * 14, 0, 0], hand: [s * 18, 0, 70], hips: [0, s * 4, 0], head: [0, 0, s * 4], left: { arm: [-50, 12, 12], fore: [-60 - s * 14, 0, 0] } });
      return [0, HIP_Y + Math.abs(s) * 1.2, 0]; } },
  { id: 'prop_flag', prop: 'flag', label: 'Wave (flag)', dur: 2.0,
    pose(ph, setQ) { const s = S(ph);
      work(setQ, { arm: [-42, -14 + s * 28, -14], fore: [-56, 0, 0], hand: [0, 180, 0], hips: [0, s * 4, 0], head: [-6, 6, 4] });
      return [0, HIP_Y + Math.abs(s) * 1.4, 0]; } },
  { id: 'prop_magnifier', prop: 'magnifier', label: 'Inspect (magnifier)', dur: 3.0,
    pose(ph, setQ) { const s = S(ph);
      work(setQ, { arm: [-52, -6 + s * 10, -6], fore: [-36, 0, 0], hand: [0, 180, 0], hips: [10, s * 6, 0], head: [8 + s * 3, -s * 8, 0] });
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
