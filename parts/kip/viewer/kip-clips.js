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

// ---------------------------------------------------------------------------------------------------------------------------------
// Planted feet. The legs are children of Hips, so any hips lean, twist or drop drags the feet along the floor (the "sliding feet"). A clip that
// opts in (`plant: true`) has its legs re-solved every frame so both ankles stay on the rest stance and the soles stay level, whatever the hips do.
// Rig numbers measured in the page (mm): hip joints at +-10.8 from Hips, thigh 25.6, shin vector (0,-26,-1.5). Two-bone IK: the knee angle from the
// law of cosines, the thigh turned to point hip -> ankle with the knee hinge held on the world X axis, the ankle turned to the stance's foot attitude.
// ---------------------------------------------------------------------------------------------------------------------------------
export const LEG_RIG = Object.freeze({ hipX: 10.8, thigh: 25.6, shin: Object.freeze([0, -26, -1.5]) });
/** The relaxed stance every prop clip starts from (degrees); `rest()` writes exactly these. */
export const REST_LEGS = Object.freeze({
  L: Object.freeze({ side: 1, up: [2, 3, 3], knee: 0, foot: [0, 0, -3], names: ['LeftUpLeg', 'LeftLeg', 'LeftFoot'] }),
  R: Object.freeze({ side: -1, up: [2, -3, -3], knee: 0, foot: [0, 0, 3], names: ['RightUpLeg', 'RightLeg', 'RightFoot'] }),
});
const D2R = Math.PI / 180;
const eulerQ = (THREE, a) => new THREE.Quaternion().setFromEuler(new THREE.Euler(a[0] * D2R, a[1] * D2R, a[2] * D2R, 'ZYX'));

/** Forward kinematics of one leg under a hips pose: hip, knee and ankle positions and the foot attitude (world). */
export function legFK(THREE, hipsEuler, hipsPos, leg) {
  const qh = eulerQ(THREE, hipsEuler);
  const hip = new THREE.Vector3(leg.side * LEG_RIG.hipX, 0, 0).applyQuaternion(qh).add(new THREE.Vector3(hipsPos[0], hipsPos[1], hipsPos[2]));
  const qu = qh.clone().multiply(eulerQ(THREE, leg.up));
  const knee = new THREE.Vector3(0, -LEG_RIG.thigh, 0).applyQuaternion(qu).add(hip);
  const qs = qu.clone().multiply(eulerQ(THREE, [leg.knee, 0, 0]));
  const ankle = new THREE.Vector3(...LEG_RIG.shin).applyQuaternion(qs).add(knee);
  const qf = qs.clone().multiply(eulerQ(THREE, leg.foot));
  return { hip, knee, ankle, qf };
}

const stanceCache = new WeakMap();
function stance(THREE) {
  if (!stanceCache.has(THREE)) {
    const out = {};
    for (const k of ['L', 'R']) out[k] = legFK(THREE, [0, 0, 0], [0, HIP_Y, 0], REST_LEGS[k]);
    stanceCache.set(THREE, out);
  }
  return stanceCache.get(THREE);
}

/** Solve one leg so its ankle sits on `target.ankle` with the foot attitude `target.qf`. Returns degrees for UpLeg, Leg (knee) and Foot. */
export function solveLeg(THREE, hipsEuler, hipsPos, leg, target) {
  return solveLegQ(THREE, eulerQ(THREE, hipsEuler), hipsPos, leg, target);
}

/** Same as `solveLeg` with the hips attitude as a quaternion (what a baked clip stores). */
export function solveLegQ(THREE, qh, hipsPos, leg, target) {
  const hip = new THREE.Vector3(leg.side * LEG_RIG.hipX, 0, 0).applyQuaternion(qh).add(new THREE.Vector3(hipsPos[0], hipsPos[1], hipsPos[2]));
  const u = target.ankle.clone().sub(hip);
  const [, sy, sz] = LEG_RIG.shin;
  const t = LEG_RIG.thigh, sl = Math.hypot(sy, sz);
  const dMax = t + sl - 1e-3, dMin = Math.abs(t - sl) + 1e-3;
  const d = Math.min(dMax, Math.max(dMin, u.length()));
  // |thigh + Rx(k) shin|^2 = d^2, with thigh = (0,-t,0) and shin = (0,sy,sz): t*(sy*cos k - sz*sin k)*(-2) ... solved by bisection on k in [0, 150 deg]
  const f = (k) => t * t + sl * sl + 2 * t * (-(sy * Math.cos(k) - sz * Math.sin(k))) - d * d;
  let lo = 0, hi = 150 * D2R;
  if (f(lo) <= 0) hi = lo; else { for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (f(m) > 0) lo = m; else hi = m; } }
  const k = (lo + hi) / 2;
  const w = new THREE.Vector3(0, -t, 0).add(new THREE.Vector3(0, sy * Math.cos(k) - sz * Math.sin(k), sy * Math.sin(k) + sz * Math.cos(k)));
  const e1 = w.clone().normalize();
  const e2 = new THREE.Vector3(1, 0, 0);
  const e3 = new THREE.Vector3().crossVectors(e1, e2);
  const f1 = u.clone().normalize();
  const f2 = new THREE.Vector3(1, 0, 0).sub(f1.clone().multiplyScalar(f1.x)).normalize();   // knee hinge on world X
  const f3 = new THREE.Vector3().crossVectors(f1, f2);
  const E = new THREE.Matrix4().makeBasis(e1, e2, e3), F = new THREE.Matrix4().makeBasis(f1, f2, f3);
  const qThigh = new THREE.Quaternion().setFromRotationMatrix(F.multiply(E.transpose()));
  const toDeg = (q) => { const e = new THREE.Euler().setFromQuaternion(q, 'ZYX'); return [e.x / D2R, e.y / D2R, e.z / D2R]; };
  const up = toDeg(qh.clone().invert().multiply(qThigh));
  const qShin = qThigh.clone().multiply(eulerQ(THREE, [k / D2R, 0, 0]));
  const foot = toDeg(qShin.clone().invert().multiply(target.qf));
  return { up, knee: k / D2R, foot, reach: u.length() <= dMax };
}

/** Re-solve both legs for the hips pose of this frame (called by buildKipClip for a clip with `plant`). */
function plantLegs(THREE, hipsEuler, hipsPos, setQ, lift = [0, 0]) {
  const st = stance(THREE);
  for (const [i, key] of ['L', 'R'].entries()) {
    const leg = REST_LEGS[key];
    // A clip may lift a foot (`setQ('LiftFeet', leftMm, rightMm, 0)`): straight up from its stance spot, so a stepping dance has real knee lifts and still no sliding.
    const target = lift[i] ? { ankle: st[key].ankle.clone().add(new THREE.Vector3(0, lift[i], 0)), qf: st[key].qf } : st[key];
    const sol = solveLeg(THREE, hipsEuler, hipsPos, leg, target);
    setQ(leg.names[0], ...sol.up);
    setQ(leg.names[1], sol.knee, 0, 0);
    setQ(leg.names[2], ...sol.foot);
  }
}

/**
 * Plant the feet of a BAKED clip (a retargeted Mixamo dance): same format as `buildKipClip` output, `kip_<Joint>.quaternion` tracks plus `kip_Hips.position`, all on one set of times.
 * Mocap is authored for another skeleton: on Kip's rigid legs the feet skate (Samba: a foot on the floor travels 29 to 41 mm). This reins the hips in so the feet CAN stay put, then
 * re-solves both legs with the same solver the procedural clips use:
 *   - hips sideways and fore-aft travel is scaled by `xzScale` about its mean (Samba's hips wander +-25 mm, the legs reach 51 mm);
 *   - the vertical bob is shifted down so its top is standing height (the leg cannot stretch past it; it would lift the foot);
 *   - a foot is lifted straight up by how much it is raised above the other foot in the ORIGINAL legs (a step or a knee lift), minus `deadzone`, at most `maxLift` mm.
 * Mutates and returns the clip. Not for clips whose feet should travel (a walk): those stay as baked.
 */
export function plantBakedClip(THREE, clip, { xzScale = 0.3, maxLift = 14, deadzone = 2 } = {}) {
  const trk = (n) => clip.tracks.find((t) => t.name === n);
  const hipsPos = trk('kip_Hips.position'), hipsQ = trk('kip_Hips.quaternion');
  if (!hipsPos || !hipsQ) return clip;
  const n = hipsQ.times.length;
  const legTracks = {};
  for (const k of ['L', 'R']) legTracks[k] = REST_LEGS[k].names.map((nm) => trk(`kip_${nm}.quaternion`));
  if (Object.values(legTracks).some((a) => a.some((t) => !t))) return clip;
  const Q = (t, i) => new THREE.Quaternion(t.values[i * 4], t.values[i * 4 + 1], t.values[i * 4 + 2], t.values[i * 4 + 3]);
  const st = stance(THREE);
  // 1. the original ankles (before any change), for the lifts
  const raw = [];
  for (let i = 0; i < n; i++) {
    const qh = Q(hipsQ, i), p = new THREE.Vector3(hipsPos.values[i * 3], hipsPos.values[i * 3 + 1], hipsPos.values[i * 3 + 2]);
    const row = {};
    for (const k of ['L', 'R']) {
      const qu = qh.clone().multiply(Q(legTracks[k][0], i)), qk = qu.clone().multiply(Q(legTracks[k][1], i));
      const hip = new THREE.Vector3(REST_LEGS[k].side * LEG_RIG.hipX, 0, 0).applyQuaternion(qh).add(p);
      const knee = new THREE.Vector3(0, -LEG_RIG.thigh, 0).applyQuaternion(qu).add(hip);
      row[k] = new THREE.Vector3(...LEG_RIG.shin).applyQuaternion(qk).add(knee).y;
    }
    raw.push(row);
  }
  // 2. the hips, reined in
  let mx = 0, mz = 0, top = -Infinity;
  for (let i = 0; i < n; i++) { mx += hipsPos.values[i * 3] / n; mz += hipsPos.values[i * 3 + 2] / n; top = Math.max(top, hipsPos.values[i * 3 + 1]); }
  const dy = Math.max(0, top - HIP_Y);
  for (let i = 0; i < n; i++) {
    hipsPos.values[i * 3] = mx + (hipsPos.values[i * 3] - mx) * xzScale;
    hipsPos.values[i * 3 + 1] -= dy;
    hipsPos.values[i * 3 + 2] = mz + (hipsPos.values[i * 3 + 2] - mz) * xzScale;
  }
  // 3. the legs, solved
  const prev = {};
  for (let i = 0; i < n; i++) {
    const qh = Q(hipsQ, i), p = [hipsPos.values[i * 3], hipsPos.values[i * 3 + 1], hipsPos.values[i * 3 + 2]];
    const base = Math.min(raw[i].L, raw[i].R);
    for (const k of ['L', 'R']) {
      const lift = Math.min(maxLift, Math.max(0, raw[i][k] - base - deadzone));
      const target = lift ? { ankle: st[k].ankle.clone().add(new THREE.Vector3(0, lift, 0)), qf: st[k].qf } : st[k];
      const sol = solveLegQ(THREE, qh, p, REST_LEGS[k], target);
      const quats = [eulerQ(THREE, sol.up), eulerQ(THREE, [sol.knee, 0, 0]), eulerQ(THREE, sol.foot)];
      for (let j = 0; j < 3; j++) {
        const q = quats[j], buf = legTracks[k][j].values, key = `${k}${j}`;
        const pq = prev[key];
        if (pq && pq.dot(q) < 0) { q.x = -q.x; q.y = -q.y; q.z = -q.z; q.w = -q.w; }       // the near hemisphere: no long-way-round slerp
        prev[key] = q;
        buf[i * 4] = q.x; buf[i * 4 + 1] = q.y; buf[i * 4 + 2] = q.z; buf[i * 4 + 3] = q.w;
      }
    }
  }
  return clip;
}

/**
 * Natural hands for a BAKED clip (a retargeted Mixamo dance). The retarget copies the source hand, and on Kip's arm that can bend the wrist 60 degrees or more (Samba: 59) and
 * twist the forearm until the thumb points down. Each hand's local attitude is split into a twist about the forearm and a swing (the wrist bend); the bend is capped at `maxBend`
 * degrees and the twist at `maxTwist`, the rest is kept. Mutates and returns the clip.
 */
export function limitHands(THREE, clip, { maxBend = 35, maxTwist = 100 } = {}) {
  const D = Math.PI / 180;
  for (const nm of ['LeftHand', 'RightHand']) {
    const t = clip.tracks.find((x) => x.name === `kip_${nm}.quaternion`);
    if (!t) continue;
    const q = new THREE.Quaternion(), tw = new THREE.Quaternion(), sw = new THREE.Quaternion(), id = new THREE.Quaternion();
    let prev = null;
    for (let i = 0; i < t.values.length / 4; i++) {
      q.set(t.values[i * 4], t.values[i * 4 + 1], t.values[i * 4 + 2], t.values[i * 4 + 3]);
      const l = Math.hypot(q.y, q.w);
      if (l < 1e-6) tw.set(0, 0, 0, 1); else tw.set(0, q.y / l, 0, q.w / l);
      sw.copy(q).multiply(tw.clone().invert());
      if (sw.w < 0) { sw.x = -sw.x; sw.y = -sw.y; sw.z = -sw.z; sw.w = -sw.w; }
      const bend = 2 * Math.acos(Math.min(1, sw.w)) / D;
      if (bend > maxBend) sw.copy(id).slerp(sw, maxBend / bend);
      let twist = 2 * Math.atan2(tw.y, tw.w) / D;
      if (twist > 180) twist -= 360; else if (twist < -180) twist += 360;
      twist = Math.max(-maxTwist, Math.min(maxTwist, twist));
      tw.set(0, Math.sin(twist * D / 2), 0, Math.cos(twist * D / 2));
      q.copy(sw).multiply(tw);
      if (prev && prev.dot(q) < 0) { q.x = -q.x; q.y = -q.y; q.z = -q.z; q.w = -q.w; }
      prev = prev ? prev.copy(q) : q.clone();
      t.values[i * 4] = q.x; t.values[i * 4 + 1] = q.y; t.values[i * 4 + 2] = q.z; t.values[i * 4 + 3] = q.w;
    }
  }
  return clip;
}

/**
 * Build a looping clip. `poseFn(ph, setQ, t)` is called once per frame with the phase (0 to 2*PI, both ends included so the loop closes),
 * a `setQ(joint, rx, ry, rz)` setter, and the time in seconds; it returns the hips position [x, y, z] in mm.
 */
export function buildKipClip(THREE, name, dur, poseFn, { plant = false } = {}) {
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
    const hipsE = [0, 0, 0];
    const lift = [0, 0];
    const setQ = (nm, rx, ry, rz) => {
      if (nm === 'LiftFeet') { lift[0] = rx; lift[1] = ry; return; }      // not a joint: how far each foot is lifted this frame (mm), used by the leg solver
      if (nm === 'Hips') { hipsE[0] = rx; hipsE[1] = ry; hipsE[2] = rz; }
      q.setFromEuler(e.set(d2r(rx), d2r(ry), d2r(rz), 'ZYX'));
      const b = bufs[nm];
      if (i > 0 && b[(i - 1) * 4] * q.x + b[(i - 1) * 4 + 1] * q.y + b[(i - 1) * 4 + 2] * q.z + b[(i - 1) * 4 + 3] * q.w < 0) {
        q.x = -q.x; q.y = -q.y; q.z = -q.z; q.w = -q.w; // same rotation, nearer hemisphere: no long-way-round slerp
      }
      b[i * 4] = q.x; b[i * 4 + 1] = q.y; b[i * 4 + 2] = q.z; b[i * 4 + 3] = q.w;
    };
    const hp = poseFn(ph, setQ, t);
    if (plant) plantLegs(THREE, hipsE, hp, setQ, lift);
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
    for (const k of ['L', 'R']) { const l = REST_LEGS[k]; setQ(l.names[0], ...l.up); setQ(l.names[1], l.knee, 0, 0); setQ(l.names[2], ...l.foot); }
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
    id: 'dance_boogie', label: 'Boogie', dur: 8, bpm: 120, beats: 16,
    pose(ph, setQ) {
      const b = ph * 16;                  // 16 beats at 120 bpm
      const sway = S(b * 0.5);            // side to side every two beats
      const bounce = Math.abs(S(b));      // down on every beat
      setQ('Hips', 2 + bounce * 3, sway * 14, sway * 6);
      setQ('Head', -2 + bounce * 2, -sway * 10, -sway * 5);
      setQ('LeftArm', -30 + C(b * 0.5) * 36, 8, 22 + S(b * 0.5 + 1) * 10); setQ('LeftForeArm', -40 - bounce * 24, 0, 0); setQ('LeftHand', 0, 0, -6);
      setQ('RightArm', -30 - C(b * 0.5) * 36, -8, -22 + S(b * 0.5 + 1) * 10); setQ('RightForeArm', -40 - bounce * 24, 0, 0); setQ('RightHand', 0, 0, 6);
      // the legs are solved from the hips (feet planted), with a knee lift on the side the weight is leaving: 8 mm straight up, nothing slides
      setQ('LiftFeet', 8 * Math.max(0, S(b * 0.5)), 8 * Math.max(0, -S(b * 0.5)), 0);
      return [sway * 3, HIP_Y - 3 + (1 - bounce) * 3, 0];
    },
  },
  {
    id: 'dance_robot', label: 'Robot dance', dur: 8, bpm: 120, beats: 16, // eight one-second slots = two beats a slot
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
      return [0, HIP_Y - dip * 5, 0];                  // both feet planted, the hips dip: the knees bend by themselves
    },
  },
  {
    id: 'dance_disco', label: 'Disco point', dur: 6, bpm: 120, beats: 12,
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
      setQ('LiftFeet', 6 * dn, 6 * up, 0);               // the knee comes up on the side opposite the pointing arm
      return [side * 2.5, HIP_Y - 1 + bob * 2, 0];
    },
  },
  {
    // The slow dance: a lullaby pace the 120 bpm dances cannot follow (rate 0.8 to 1.25 puts them at 96 to 150; this one covers 64 to 100).
    id: 'dance_sway', label: 'Slow sway', dur: 6, bpm: 80, beats: 8,
    pose(ph, setQ) {
      const b = ph * 8;                               // 8 beats at 80 bpm: two slow rocks
      const sway = S(b * 0.25);                       // one rock, side to side, every four beats
      const swing = C(b * 0.25);                      // a quarter of a rock behind: the arms float on it
      const give = (1 - C(b * 0.5)) * 0.5;            // 0 to 1 every second beat: the knees give a little
      setQ('Hips', 1 + give * 1.5, sway * 6, sway * 4);
      setQ('Head', -1, -sway * 8, -sway * 6);         // looks the other way, tilts into the rock
      // arms hang soft and swing a little against each other, elbows bent, hands at rest
      setQ('LeftArm', -10 + swing * 10, 4, 18 + sway * 6); setQ('LeftForeArm', -26 - give * 8, 0, 0); setQ('LeftHand', 0, 0, -6);
      setQ('RightArm', -10 - swing * 10, -4, -18 + sway * 6); setQ('RightForeArm', -26 - give * 8, 0, 0); setQ('RightHand', 0, 0, 6);
      // the hips rock toward +x (the character's left), so the right foot is the free one then: it comes up 4 mm, straight up, nothing slides
      setQ('LiftFeet', 4 * Math.max(0, -sway), 4 * Math.max(0, sway), 0);
      return [sway * 2.5, HIP_Y - give * 2, 0];
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
  // Upright vacuum: the wand leans about 36 degrees and the hinged floor head lies flat on the floor; the shoulder and elbow swing against each other
  // (15 and 18 degrees) so the hand slides back and forth while the head stays within 3 mm of the floor (solved and measured on the real prop mesh).
  { id: 'prop_upright_vacuum', prop: 'upright_vacuum', label: 'Vacuum (upright)', dur: 2.4,
    pose(ph, setQ) { const s = S(ph);
      work(setQ, { arm: [-40 + s * 15, -6, -8], fore: [-50 - s * 18, 0, 0], hand: [45, 15, -180], hips: [10, 0, 0], head: [12, 0, 0], crouch: 0.3 });
      return [0, HIP_Y - 2, 0]; } },
  // Spatula and frying pan: the hand turns the prop so its head points forward along the forearm with the blade (or pan) level and the raised
  // side up (the egg, the rim); the forearm then lifts, which tips the head up in a flick.
  { id: 'prop_spatula', prop: 'spatula', label: 'Flip (spatula)', dur: 1.6,
    pose(ph, setQ) { const k = Math.pow(0.5 - 0.5 * C(ph), 2); // slide under low, then a quick flick up
      work(setQ, { arm: [-40 - k * 24, -6, -8], fore: [-60 - k * 30, 0, 0], hand: [-75, -105, 15], hips: [4, 0, 0], head: [10 + k * 4, 0, 0] });
      return [0, HIP_Y - 1, 0]; } },
  { id: 'prop_frying_pan', prop: 'frying_pan', label: 'Toss (frying pan)', dur: 1.6,
    pose(ph, setQ) { const k = Math.pow(0.5 - 0.5 * C(ph), 2);
      work(setQ, { arm: [-40 - k * 24, -6, -8], fore: [-60 - k * 30, 0, 0], hand: [-75, -105, 15], hips: [4, 0, 0], head: [10 + k * 4, 0, 0] });
      return [0, HIP_Y - 1, 0]; } },
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


// ---------------------------------------------------------------------------------------------------------------------------------
// Natural hands. The prop is rigidly attached to the hand (the shaft runs through the fist, across the finger axis), so where the prop points
// fixes how the hand is turned. The formulas in `props` below decide WHERE the prop goes (the motion); the arm angles that are actually played
// come from this table, which was solved so the prop reaches the same place with a natural hand: wrist bend 17 degrees or less, thumb not
// pointing down. `flip` mounts a head-up prop end for end (the wardrobe's `flip: true`), because the shaft's far end otherwise sits on the thumb
// side and a head-up prop would need the thumb pointing down. How it was made: scripts/kip-retarget/README.md.
// ---------------------------------------------------------------------------------------------------------------------------------
// GENERATED by the arm retargeter (scripts/kip-retarget/, see the note above PROP_ARMS). Do not edit by hand.
// Per prop clip: `flip` (mount the prop end for end, so a head-up prop gets a thumb-up hand), then 36 samples per loop of the right arm
// [rx, ry, rz], the elbow rx and the hand [rx, ry, rz], in degrees (the same Euler order as every other joint).
const PROP_ARMS = {
  prop_broom: { flip: false,
    arm: [[-28.5,38.7,-50.2],[-30.9,41.6,-50.1],[-33.6,44.3,-50.1],[-36.3,46.8,-50.1],[-38.8,48.9,-50.1],[-40.4,50.2,-49.2],[-40,50.2,-46.1],[-39.5,50.2,-43.6],[-39.1,50.2,-42],[-39,50.1,-41.3],[-39.1,50.1,-41.7],[-39.6,50.1,-43],[-40.2,50.1,-45.2],[-41,50,-48.4],[-40.2,48.9,-50.1],[-37.9,46.8,-50.1],[-35.1,44.3,-50.1],[-32.2,41.6,-50.1],[-29.2,38.8,-50.2],[-26.3,35.9,-50.3],[-23.7,33,-50.3],[-21.2,30.2,-50.4],[-19.1,27.6,-50.4],[-17.4,25.4,-50.5],[-16,23.6,-50.5],[-15,22.2,-50.6],[-14.4,21.4,-50.6],[-14.2,21.1,-50.6],[-14.3,21.3,-50.6],[-14.9,22.1,-50.5],[-15.8,23.4,-50.5],[-17,25.2,-50.4],[-18.7,27.5,-50.4],[-20.6,30,-50.3],[-22.8,32.8,-50.2],[-25.3,35.8,-50.2]],
    fore: [-52.3,-49,-44.9,-40.5,-36.3,-32.2,-28.5,-25.9,-24.4,-23.7,-24,-25.1,-27.2,-30.2,-33.7,-37.8,-42.4,-46.9,-51.2,-55.1,-58.6,-61.6,-64.1,-66,-67.5,-68.5,-69.1,-69.3,-69.2,-68.8,-68,-66.7,-65,-62.9,-60.1,-56.9],
    hand: [[-20,-62.1,30],[-20.8,-61,30],[-21.8,-60,30],[-22.9,-59.2,30],[-23.8,-58.4,29.8],[-23.7,-57.5,29.2],[-22.2,-55.3,27.5],[-21,-53.4,26.2],[-20.4,-52.2,25.4],[-20.2,-51.7,25.1],[-20.3,-51.9,25.3],[-20.8,-53,25.9],[-21.7,-54.7,27],[-23.4,-57.1,28.8],[-24.1,-58.6,30],[-23,-59.3,30.1],[-21.9,-60.2,30.1],[-20.9,-61.1,30.1],[-20,-62.1,30],[-19.1,-63.1,30],[-17.9,-63.9,29.4],[-16.6,-64.7,28.8],[-15.3,-65.3,28],[-14,-65.8,27.1],[-12.9,-66.2,26.3],[-12,-66.5,25.7],[-11.3,-66.6,25.2],[-11,-66.7,24.9],[-11,-66.6,24.9],[-11.3,-66.5,25.1],[-12,-66.2,25.6],[-13,-65.8,26.3],[-14.2,-65.3,27.1],[-15.6,-64.6,28],[-17.1,-63.8,28.8],[-18.5,-62.9,29.5]] },
  prop_mop: { flip: false,
    arm: [[-34.6,36.5,-50],[-36.8,38.1,-50.1],[-39.2,39.7,-50.2],[-41.4,41.3,-50.2],[-43.3,42.7,-50.2],[-44.9,44,-50.2],[-46.3,45,-50.2],[-47.2,45.7,-50.1],[-47.8,46.2,-50.1],[-48.1,46.3,-50.1],[-48,46.2,-50.1],[-47.5,45.7,-50.1],[-46.6,45,-50.2],[-45.4,44,-50.2],[-43.9,42.7,-50.2],[-42,41.3,-50.2],[-40,39.7,-50.2],[-37.6,38.2,-50.1],[-35,36.5,-50],[-32.3,34.7,-49.6],[-29.5,32.4,-48.7],[-27,30.2,-47.8],[-24.7,28.2,-47.1],[-22.8,26.5,-46.6],[-21.3,25.1,-46.1],[-20.2,24,-45.8],[-19.6,23.3,-45.7],[-19.3,23.1,-45.6],[-19.5,23.3,-45.6],[-20,23.9,-45.8],[-21,24.9,-46],[-22.4,26.3,-46.4],[-24.2,28,-46.9],[-26.3,30,-47.5],[-28.8,32.1,-48.3],[-31.5,34.4,-49.3]],
    fore: [-45.8,-43.8,-41.4,-39.6,-38.1,-36.7,-35.6,-34.7,-34.2,-33.9,-34,-34.3,-35,-36,-37.2,-38.7,-40.3,-42.7,-45.2,-47.3,-48.9,-50.1,-51.2,-52,-52.7,-53.2,-53.5,-53.6,-53.6,-53.3,-52.9,-52.3,-51.5,-50.6,-49.4,-48],
    hand: [[-24.2,-58.8,30.3],[-24.2,-58.3,30.1],[-24.1,-57.9,29.9],[-23.4,-56.9,29.2],[-22.7,-56,28.5],[-22.2,-55.2,27.9],[-21.8,-54.5,27.4],[-21.5,-54,27],[-21.3,-53.7,26.8],[-21.2,-53.6,26.8],[-21.3,-53.7,26.8],[-21.5,-54,27],[-21.8,-54.5,27.4],[-22.2,-55.2,27.9],[-22.7,-56.1,28.5],[-23.3,-57,29.2],[-24.1,-57.9,30],[-24.2,-58.4,30.2],[-24.2,-58.8,30.3],[-24.1,-59.2,30.4],[-23.8,-59.4,30.4],[-23.5,-59.6,30.4],[-23.2,-59.8,30.4],[-22.9,-60,30.4],[-22.8,-60.1,30.4],[-22.6,-60.2,30.4],[-22.6,-60.2,30.4],[-22.5,-60.2,30.4],[-22.6,-60.2,30.4],[-22.6,-60.1,30.4],[-22.7,-60,30.4],[-22.9,-59.9,30.4],[-23.1,-59.7,30.3],[-23.3,-59.5,30.3],[-23.6,-59.3,30.3],[-24,-59.1,30.3]] },
  prop_scrub_brush: { flip: false,
    arm: [[-37.1,25.4,-50.1],[-35.3,29.5,-50.1],[-34.7,33.7,-50],[-35,37,-49.9],[-35.5,38.8,-49.4],[-36.1,39.1,-49.7],[-36.1,37.4,-50],[-35.6,33.7,-50.1],[-35.9,29.4,-50.1],[-37.3,25.4,-50.1],[-39.8,22.3,-50.1],[-42.6,20.4,-50.1],[-45.1,19.4,-50],[-46.4,19.1,-50],[-46.5,19.1,-50],[-45.3,19.5,-50.1],[-43.1,20.4,-50.1],[-40.2,22.3,-50.1],[-37.3,25.4,-50.1],[-35.3,29.5,-50.1],[-34.7,33.7,-50],[-35,37,-49.9],[-35.5,38.8,-49.4],[-36.1,39.1,-49.7],[-36.1,37.4,-50],[-35.6,33.7,-50.1],[-35.9,29.4,-50.1],[-37.3,25.4,-50.1],[-39.8,22.3,-50.1],[-42.6,20.4,-50.1],[-45.1,19.4,-50],[-46.4,19.1,-50],[-46.5,19.1,-50],[-45.3,19.5,-50.1],[-43.1,20.4,-50.1],[-40.2,22.3,-50.1]],
    fore: [-59.4,-57,-52.9,-48.3,-44.9,-44.1,-46.3,-51.1,-56,-59,-59.7,-58.7,-57,-55.8,-55.6,-56.4,-57.9,-59.2,-59.2,-57,-52.9,-48.3,-44.9,-44.1,-46.3,-51.1,-56,-59,-59.7,-58.7,-57,-55.8,-55.6,-56.4,-57.9,-59.2],
    hand: [[-16.7,-40.1,19.3],[-17.9,-42,19.7],[-19.9,-43.9,19.5],[-21.5,-45.6,18.7],[-22.2,-46.5,17.9],[-22.5,-46.9,17.9],[-21.9,-46.1,18.6],[-20.2,-44.3,19.5],[-18.1,-42.3,19.7],[-16.8,-40.2,19.3],[-16.6,-38,18.2],[-17.2,-35.9,16.5],[-17.9,-34.3,14.3],[-18.1,-33.7,12.9],[-18.1,-33.7,12.9],[-17.8,-34.5,14.4],[-17.2,-35.9,16.5],[-16.5,-37.9,18.2],[-16.6,-40,19.3],[-17.9,-42,19.7],[-19.9,-43.9,19.5],[-21.5,-45.6,18.7],[-22.2,-46.5,17.9],[-22.5,-46.9,17.9],[-21.9,-46.1,18.6],[-20.2,-44.3,19.5],[-18.1,-42.3,19.7],[-16.8,-40.2,19.3],[-16.6,-38,18.2],[-17.2,-35.9,16.5],[-17.9,-34.3,14.3],[-18.1,-33.7,12.9],[-18.1,-33.7,12.9],[-17.8,-34.5,14.4],[-17.2,-35.9,16.5],[-16.5,-37.9,18.2]] },
  prop_vacuum: { flip: false,
    arm: [[-31.1,19.1,-50.1],[-33,21.2,-50.1],[-35.1,23.3,-50.1],[-36.9,25.3,-50.1],[-38.6,27.2,-50.1],[-40,28.7,-50.1],[-41.2,30,-50.1],[-42,31,-50.1],[-42.5,31.6,-50.1],[-42.7,31.8,-50.1],[-42.6,31.6,-50.1],[-42.1,31,-50.1],[-41.3,30.1,-50.1],[-40.2,28.8,-50.1],[-38.9,27.2,-50.1],[-37.2,25.4,-50.1],[-35.4,23.4,-50.1],[-33.4,21.3,-50.1],[-31.2,19.1,-50.1],[-29.1,16.9,-50.1],[-26.9,14.8,-50.1],[-24.9,12.8,-50.1],[-23.1,10.9,-50.1],[-21.4,9.3,-50.1],[-20.1,8,-50.1],[-19.1,7,-50.1],[-18.5,6.4,-50.1],[-18.2,6.1,-50.1],[-18.4,6.3,-50.1],[-19,6.9,-50.1],[-19.9,7.9,-50.1],[-21.2,9.2,-50.1],[-22.8,10.8,-50.1],[-24.6,12.7,-50.1],[-26.6,14.7,-50.1],[-28.7,16.8,-50.1]],
    fore: [-62,-62.2,-62.3,-62.4,-62.5,-62.6,-62.7,-62.7,-62.7,-62.7,-62.7,-62.6,-62.5,-62.4,-62.3,-62.2,-62.1,-61.9,-61.8,-61.7,-61.7,-61.6,-61.6,-61.6,-61.6,-61.6,-61.6,-61.6,-61.7,-61.7,-61.8,-61.8,-61.9,-61.9,-62,-62.1],
    hand: [[-15.2,-42.9,20.8],[-14.6,-42.4,20.7],[-14,-41.8,20.5],[-13.3,-41.2,20.3],[-12.7,-40.6,20],[-12.1,-40,19.9],[-11.6,-39.5,19.7],[-11.3,-39.1,19.6],[-11,-38.9,19.5],[-10.9,-38.8,19.4],[-11,-38.9,19.5],[-11.2,-39.1,19.5],[-11.5,-39.4,19.6],[-11.9,-39.8,19.8],[-12.5,-40.4,20],[-13.1,-41,20.2],[-13.8,-41.6,20.4],[-14.4,-42.2,20.6],[-15.1,-42.9,20.8],[-15.6,-43.4,21],[-16.2,-43.9,21.1],[-16.6,-44.3,21.3],[-17,-44.6,21.3],[-17.2,-44.9,21.4],[-17.4,-45.1,21.5],[-17.6,-45.2,21.5],[-17.6,-45.3,21.5],[-17.7,-45.3,21.5],[-17.6,-45.3,21.5],[-17.6,-45.2,21.5],[-17.5,-45.1,21.5],[-17.3,-45,21.4],[-17.1,-44.7,21.4],[-16.7,-44.4,21.3],[-16.3,-44,21.2],[-15.8,-43.6,21]] },
  prop_upright_vacuum: { flip: false,
    arm: [[-20.9,-10.5,-0.2],[-20.1,-10.6,-0.3],[-19,-10.6,-0.4],[-17.9,-10.6,-0.6],[-16.8,-10.7,-0.7],[-15.8,-10.7,-0.9],[-14.9,-10.7,-1],[-14.2,-10.7,-1.1],[-13.7,-10.7,-1.1],[-13.5,-10.7,-1.2],[-13.6,-10.7,-1.2],[-14,-10.7,-1.2],[-14.6,-10.6,-1.1],[-15.4,-10.6,-1],[-16.4,-10.5,-0.9],[-17.5,-10.5,-0.8],[-18.6,-10.5,-0.6],[-19.7,-10.4,-0.5],[-20.7,-10.4,-0.3],[-21.6,-10.5,-0.2],[-22.3,-10.5,0],[-22.8,-10.6,0.1],[-23.2,-10.6,0.2],[-23.4,-10.7,0.2],[-23.5,-10.8,0.3],[-23.6,-10.8,0.4],[-23.6,-10.9,0.4],[-23.6,-10.9,0.4],[-23.6,-10.9,0.4],[-23.6,-10.9,0.4],[-23.6,-10.8,0.3],[-23.5,-10.8,0.3],[-23.3,-10.7,0.3],[-23,-10.7,0.2],[-22.5,-10.6,0.1],[-21.9,-10.6,0]],
    fore: [-89.3,-90.2,-91.4,-92.6,-93.9,-95.1,-96.1,-96.9,-97.4,-97.6,-97.5,-97.1,-96.4,-95.4,-94.3,-93.1,-91.8,-90.6,-89.5,-88.6,-87.8,-87.3,-86.9,-86.7,-86.7,-86.7,-86.7,-86.7,-86.7,-86.7,-86.6,-86.7,-86.8,-87.1,-87.6,-88.2],
    hand: [[-15.4,-5.4,1.5],[-15.4,-5.5,1.6],[-15.4,-5.6,1.6],[-15.4,-5.7,1.7],[-15.4,-5.9,1.7],[-15.4,-6,1.7],[-15.4,-6.2,1.8],[-15.4,-6.3,1.8],[-15.4,-6.4,1.8],[-15.4,-6.4,1.8],[-15.4,-6.4,1.8],[-15.4,-6.3,1.7],[-15.4,-6.2,1.7],[-15.4,-6.1,1.6],[-15.4,-6,1.6],[-15.4,-5.8,1.5],[-15.4,-5.7,1.5],[-15.4,-5.6,1.4],[-15.4,-5.5,1.4],[-15.4,-5.4,1.4],[-15.3,-5.3,1.4],[-15.3,-5.3,1.4],[-15.3,-5.3,1.4],[-15.3,-5.3,1.4],[-15.3,-5.3,1.4],[-15.3,-5.4,1.4],[-15.3,-5.4,1.5],[-15.3,-5.4,1.5],[-15.3,-5.4,1.5],[-15.3,-5.4,1.5],[-15.3,-5.4,1.5],[-15.3,-5.3,1.5],[-15.3,-5.3,1.5],[-15.3,-5.3,1.5],[-15.3,-5.3,1.5],[-15.4,-5.3,1.5]] },
  prop_spatula: { flip: true,
    arm: [[-54.8,-24.2,6.7],[-54.8,-24.2,6.7],[-54.9,-24.2,6.7],[-54.9,-24.2,6.7],[-55.1,-24.1,6.7],[-55.5,-23.9,6.7],[-56.2,-23.5,6.8],[-57.1,-23.1,6.8],[-58.5,-22.5,6.8],[-60.1,-21.7,6.9],[-62.1,-20.9,7],[-64.4,-20.1,7],[-66.9,-19.3,7.1],[-69.5,-18.6,7.3],[-72,-18,7.4],[-74.2,-17.5,7.5],[-75.9,-17.2,7.5],[-77,-17.1,7.5],[-77.4,-17.1,7.5],[-77.1,-17.3,7.4],[-76,-17.5,7.3],[-74.4,-17.9,7.3],[-72.2,-18.4,7.2],[-69.8,-18.9,7.1],[-67.2,-19.6,7],[-64.6,-20.3,6.9],[-62.2,-21.1,6.9],[-60.2,-21.8,6.8],[-58.5,-22.5,6.8],[-57.1,-23.1,6.8],[-56.2,-23.6,6.7],[-55.6,-23.9,6.7],[-55.2,-24.1,6.7],[-55,-24.2,6.7],[-54.9,-24.2,6.7],[-54.9,-24.2,6.7]],
    fore: [-49.1,-49.1,-49.1,-49.2,-49.5,-50.2,-51.2,-52.8,-55,-57.7,-61,-64.6,-68.4,-72,-75.1,-77.5,-78.7,-79,-78.7,-77.9,-76.6,-74.8,-72.4,-69.5,-66.4,-63,-59.8,-56.8,-54.2,-52.2,-50.6,-49.6,-49,-48.6,-48.5,-48.5],
    hand: [[-8.1,91.8,-24],[-8.1,91.8,-24],[-8.1,91.8,-24.1],[-8.1,91.8,-24.1],[-8.2,91.7,-24.1],[-8.2,91.5,-24.1],[-8.2,91.3,-24.2],[-8.3,90.9,-24.2],[-8.3,90.4,-24.3],[-8.3,89.8,-24.2],[-8.2,89.2,-24.1],[-7.8,88.5,-23.7],[-7.1,87.6,-23],[-5.9,86.7,-21.9],[-4.1,85.6,-20.1],[-1.5,84.1,-17.6],[2,82,-14.1],[6,79.6,-10.1],[9.5,77.8,-6.6],[12,77.1,-4.2],[13.6,77.5,-2.5],[14.7,78.6,-1.3],[15.5,80.1,-0.5],[16.2,81.9,0.3],[16.8,83.6,0.9],[17.3,85.2,1.3],[17.6,86.7,1.7],[17.9,88,1.9],[18,89,2.1],[18,89.9,2.1],[17.9,90.5,2],[17.8,90.9,1.9],[17.7,91.2,1.7],[17.5,91.3,1.6],[17.3,91.3,1.4],[17.1,91.4,1.2]] },
  prop_frying_pan: { flip: true,
    arm: [[-54.8,-24.2,6.7],[-54.8,-24.2,6.7],[-54.9,-24.2,6.7],[-54.9,-24.2,6.7],[-55.1,-24.1,6.7],[-55.5,-23.9,6.7],[-56.2,-23.5,6.8],[-57.1,-23.1,6.8],[-58.5,-22.5,6.8],[-60.1,-21.7,6.9],[-62.1,-20.9,7],[-64.4,-20.1,7],[-66.9,-19.3,7.1],[-69.5,-18.6,7.3],[-72,-18,7.4],[-74.2,-17.5,7.5],[-75.9,-17.2,7.5],[-77,-17.1,7.5],[-77.4,-17.1,7.5],[-77.1,-17.3,7.4],[-76,-17.5,7.3],[-74.4,-17.9,7.3],[-72.2,-18.4,7.2],[-69.8,-18.9,7.1],[-67.2,-19.6,7],[-64.6,-20.3,6.9],[-62.2,-21.1,6.9],[-60.2,-21.8,6.8],[-58.5,-22.5,6.8],[-57.1,-23.1,6.8],[-56.2,-23.6,6.7],[-55.6,-23.9,6.7],[-55.2,-24.1,6.7],[-55,-24.2,6.7],[-54.9,-24.2,6.7],[-54.9,-24.2,6.7]],
    fore: [-49.1,-49.1,-49.1,-49.2,-49.5,-50.2,-51.2,-52.8,-55,-57.7,-61,-64.6,-68.4,-72,-75.1,-77.5,-78.7,-79,-78.7,-77.9,-76.6,-74.8,-72.4,-69.5,-66.4,-63,-59.8,-56.8,-54.2,-52.2,-50.6,-49.6,-49,-48.6,-48.5,-48.5],
    hand: [[-8.2,91.8,-24.1],[-8.2,91.8,-24.1],[-8.2,91.8,-24.1],[-8.2,91.8,-24.1],[-8.2,91.7,-24.1],[-8.2,91.5,-24.1],[-8.3,91.3,-24.2],[-8.3,90.9,-24.2],[-8.4,90.4,-24.3],[-8.3,89.8,-24.3],[-8.2,89.2,-24.1],[-7.8,88.5,-23.7],[-7.1,87.6,-23],[-5.9,86.7,-21.9],[-4.1,85.6,-20.2],[-1.6,84.1,-17.6],[2,82.1,-14.1],[6,79.6,-10.1],[9.5,77.8,-6.7],[12,77.1,-4.2],[13.6,77.5,-2.5],[14.7,78.6,-1.3],[15.5,80.1,-0.5],[16.2,81.9,0.3],[16.8,83.6,0.9],[17.3,85.2,1.3],[17.6,86.7,1.7],[17.8,88,1.9],[18,89,2.1],[18,89.9,2.1],[17.9,90.5,2],[17.8,90.9,1.9],[17.6,91.2,1.7],[17.5,91.3,1.6],[17.3,91.3,1.4],[17.1,91.4,1.2]] },
  prop_paint_roller: { flip: true,
    arm: [[-88.5,-15.9,-50],[-91,-18.7,-50],[-93.6,-21.5,-50],[-96.1,-24.1,-49.9],[-98.4,-26.5,-49.8],[-100.4,-28.7,-49.7],[-102.1,-30.4,-49.6],[-103.3,-31.7,-49.5],[-104.2,-32.5,-49.5],[-104.6,-32.8,-49.5],[-104.4,-32.5,-49.6],[-103.9,-31.7,-49.7],[-102.9,-30.4,-49.8],[-101.5,-28.7,-50],[-99.7,-26.5,-50],[-97.7,-24.1,-50],[-95.3,-21.4,-50],[-92.8,-18.6,-50],[-90.1,-15.8,-49.9],[-87.4,-13,-49.8],[-84.7,-10.4,-49.6],[-82.2,-7.9,-49.3],[-79.8,-5.8,-49],[-77.7,-3.9,-48.8],[-76,-2.4,-48.5],[-74.6,-1.3,-48.3],[-73.7,-0.6,-48.2],[-73.3,-0.4,-48.2],[-73.3,-0.6,-48.2],[-73.8,-1.3,-48.4],[-74.8,-2.4,-48.6],[-76.3,-4,-48.8],[-78.1,-5.9,-49.1],[-80.2,-8.1,-49.4],[-82.7,-10.5,-49.6],[-85.3,-13.2,-49.8]],
    fore: [-8.1,-8.6,-8.9,-9.1,-9.1,-9,-8.9,-8.7,-8.5,-8.2,-7.9,-7.5,-7.2,-6.8,-6.4,-6.1,-5.7,-5.4,-5.1,-4.8,-4.6,-4.4,-4.3,-4.3,-4.4,-4.5,-4.8,-5.1,-5.6,-6,-6.5,-7,-7.5,-8,-8.4,-8.7],
    hand: [[-7,-44.7,3.9],[-6.3,-45.3,4],[-5.6,-46,3.9],[-4.9,-46.7,3.7],[-4.4,-47.4,3.5],[-3.9,-48.1,3.3],[-3.6,-48.7,3.2],[-3.3,-49.2,3.1],[-3.2,-49.5,3],[-3.2,-49.6,2.9],[-3.4,-49.6,2.9],[-3.7,-49.3,3],[-4.1,-48.9,3],[-4.6,-48.4,3.2],[-5.2,-47.6,3.3],[-5.9,-46.8,3.5],[-6.7,-46,3.8],[-7.6,-45.2,4],[-8.4,-44.6,4.3],[-9.3,-44,4.6],[-10.2,-43.4,5],[-11,-43,5.3],[-11.8,-42.6,5.6],[-12.4,-42.3,5.9],[-12.9,-42.1,6.2],[-13.3,-41.9,6.4],[-13.4,-41.8,6.6],[-13.4,-41.8,6.7],[-13.2,-41.8,6.8],[-12.9,-41.9,6.7],[-12.3,-42.1,6.6],[-11.7,-42.3,6.4],[-10.9,-42.6,6.2],[-10,-43,5.9],[-9.1,-43.5,5.6],[-8.2,-44,5.2]] },
  prop_hammer: { flip: false,
    arm: [[-41.3,11.4,-50.2],[-41.3,11.4,-50.2],[-41.3,11.4,-50.2],[-41.6,11.1,-50.2],[-42.2,10.4,-50.2],[-43.4,9,-50.2],[-45.5,6.6,-50.2],[-48.7,3.3,-50.2],[-53.2,-1.3,-50.2],[-59,-6.9,-50.2],[-65.9,-13.7,-50.2],[-73.6,-21.6,-50.2],[-81.5,-30.8,-50.1],[-88.9,-41.2,-50.1],[-97.3,-50.2,-46.5],[-112.1,-50.3,-32.8],[-123.9,-50.2,-23.1],[-125.4,-50.2,-20],[-125.5,-50.2,-19.1],[-125.4,-50.2,-19.8],[-124.8,-50.1,-22.3],[-115.3,-50.1,-30.5],[-102.5,-47.5,-40.8],[-90.1,-41.7,-50],[-82.2,-31.4,-50.2],[-74.3,-22,-50.2],[-66.6,-13.9,-50.2],[-59.7,-7.1,-50.2],[-53.8,-1.3,-50.2],[-49.2,3.2,-50.2],[-45.8,6.6,-50.2],[-43.6,8.9,-50.2],[-42.3,10.4,-50.2],[-41.6,11.1,-50.2],[-41.3,11.4,-50.2],[-41.3,11.4,-50.2]],
    fore: [-63.3,-63.3,-63.3,-63.4,-63.5,-63.7,-64.1,-64.7,-65.5,-66.5,-67.7,-69,-70.5,-71.9,-73.7,-76.5,-78.1,-83.1,-85,-83.5,-78.1,-75.2,-72.8,-70.6,-69.2,-67.8,-66.6,-65.5,-64.7,-64.1,-63.7,-63.5,-63.4,-63.3,-63.3,-63.3],
    hand: [[-4.9,-46,18.3],[-4.9,-46,18.3],[-4.9,-46,18.3],[-4.9,-45.9,18.3],[-4.8,-45.6,18.3],[-4.7,-45.1,18.2],[-4.6,-44.3,18],[-4.5,-43.2,17.9],[-4.6,-41.9,17.9],[-5.1,-40.7,18],[-6.1,-39.8,18.4],[-7.9,-39.6,19],[-10.6,-40.1,19.7],[-14.3,-41.6,20.4],[-16.7,-41.6,20],[-13.9,-36.7,18.7],[-12,-34.3,18.3],[-13.3,-30.9,16.9],[-13.8,-29.4,16.1],[-13.1,-30.7,16.9],[-11.3,-34.6,18.5],[-12.1,-37.6,19.3],[-13.2,-40.2,20],[-14,-42.3,20.7],[-11,-41.3,20.1],[-8.2,-40.4,19.2],[-6.2,-40.3,18.5],[-5,-40.9,18],[-4.4,-42,17.8],[-4.2,-43.2,17.8],[-4.3,-44.2,17.9],[-4.5,-45.1,18],[-4.7,-45.6,18.2],[-4.8,-45.9,18.3],[-4.8,-46,18.3],[-4.9,-46,18.3]] },
  prop_screwdriver: { flip: false,
    arm: [[-3.4,23.9,6.3],[-6.3,23.5,6.3],[-8.7,22.3,6.3],[-10.2,20.6,6.3],[-10.9,19.4,6.3],[-10.9,19.1,6.3],[-10.4,19.9,6.3],[-9.1,21.5,6.3],[-6.9,23.1,6.3],[-3.8,23.7,6.3],[-0.5,23,6.2],[2.2,21.1,6.1],[3.8,18.8,6.1],[4.5,17.2,6],[4.5,16.7,6],[4,17.6,6.1],[2.7,19.6,6.2],[0.3,21.8,6.2],[-3,23.3,6.3],[-6.2,23.3,6.3],[-8.7,22.2,6.3],[-10.2,20.6,6.3],[-10.9,19.4,6.3],[-10.9,19.1,6.3],[-10.4,19.9,6.3],[-9.1,21.5,6.3],[-6.9,23.1,6.3],[-3.8,23.7,6.3],[-0.5,23,6.2],[2.2,21.1,6.1],[3.8,18.8,6.1],[4.5,17.2,6],[4.5,16.7,6],[4,17.6,6.1],[2.7,19.6,6.2],[0.3,21.8,6.2]],
    fore: [-136.8,-136.7,-136.7,-136.8,-137,-137,-136.9,-136.7,-136.7,-136.7,-137,-137.4,-137.9,-138.1,-138.1,-138,-137.6,-137.2,-136.9,-136.7,-136.7,-136.8,-137,-137,-136.9,-136.7,-136.7,-136.7,-137,-137.4,-137.9,-138.1,-138.1,-138,-137.6,-137.2],
    hand: [[-12,16.9,-13.6],[-10,16.4,-14.7],[-7.9,15.3,-15.3],[-6.3,13.7,-15.4],[-5.4,12.4,-15.4],[-5.2,11.9,-15.4],[-5.8,12.6,-15.4],[-7.1,14.1,-15.3],[-9.2,15.7,-14.9],[-11.6,16.6,-13.8],[-13.7,16.5,-11.8],[-15,15.6,-9.1],[-15.5,14.3,-6.6],[-15.6,13,-4.9],[-15.6,12.5,-4.6],[-15.5,12.8,-5.6],[-15.1,13.8,-7.8],[-14.1,15.1,-10.6],[-12.3,16.1,-13.1],[-10.1,16.1,-14.6],[-7.9,15.2,-15.3],[-6.3,13.6,-15.4],[-5.4,12.4,-15.4],[-5.2,11.9,-15.4],[-5.8,12.6,-15.4],[-7.1,14.1,-15.3],[-9.2,15.7,-14.9],[-11.6,16.6,-13.8],[-13.7,16.5,-11.8],[-15,15.6,-9.1],[-15.5,14.3,-6.6],[-15.6,13,-4.9],[-15.6,12.5,-4.6],[-15.5,12.8,-5.6],[-15.1,13.8,-7.8],[-14.1,15.1,-10.6]] },
  prop_wrench: { flip: false,
    arm: [[-51.6,-3.2,-34],[-51.6,-3.2,-34.5],[-51.6,-3.3,-35.9],[-51.5,-3.4,-38.5],[-51.4,-3.5,-42.1],[-51.3,-3.6,-46.7],[-51.1,-3.8,-50],[-50.8,-3.9,-50.1],[-50.5,-4,-50.1],[-50,-4,-50.2],[-49.3,-3.8,-50.2],[-48,-3.5,-50.3],[-46.3,-3.2,-50.3],[-44.9,-2.8,-50.3],[-44.8,-2.7,-50.3],[-44.8,-2.6,-50.3],[-44.8,-2.6,-50.3],[-44.8,-2.6,-50.3],[-44.8,-2.6,-50.3],[-44.8,-2.6,-50.3],[-44.8,-2.6,-50.3],[-44.8,-2.6,-50.3],[-44.8,-2.6,-50.3],[-44.8,-2.6,-50.3],[-46.1,-2.7,-50.2],[-48,-3,-50.2],[-49.4,-3.4,-50.1],[-50.3,-3.6,-50.1],[-50.8,-3.7,-50.1],[-51.1,-3.7,-50.1],[-51.3,-3.6,-50],[-51.5,-3.7,-48.9],[-51.7,-3.7,-45.7],[-51.8,-3.6,-42.1],[-51.8,-3.5,-38.7],[-51.7,-3.4,-36.3]],
    fore: [-84.1,-84,-83.6,-82.9,-82,-80.8,-79.6,-78.5,-77.8,-77.6,-77.9,-78.5,-79.5,-80.3,-80.6,-80.7,-80.7,-80.7,-80.7,-80.7,-80.7,-80.7,-80.7,-80.7,-80.3,-79.5,-78.7,-78.2,-78.2,-78.7,-79.6,-80.7,-81.8,-82.7,-83.5,-83.9],
    hand: [[-20.8,-42.3,14.3],[-20.7,-42.1,14.3],[-20.5,-41.5,14.3],[-20.2,-40.6,14.2],[-19.8,-39.8,14.3],[-19.5,-39,14.5],[-18.4,-37.3,15.5],[-15.3,-33.7,16.9],[-10.8,-30.2,17.4],[-5.2,-26.9,16.8],[0.9,-23.4,14.8],[6.3,-19.5,11.9],[10.3,-15.2,8.9],[12.2,-12,7.2],[12.4,-11.5,6.9],[12.4,-11.5,6.9],[12.5,-11.5,6.9],[12.5,-11.5,6.9],[12.5,-11.5,6.9],[12.5,-11.5,6.9],[12.5,-11.5,6.9],[12.5,-11.5,6.9],[12.5,-11.5,6.9],[12.4,-11.5,6.9],[11.2,-14.2,8],[8,-18.4,10.6],[2.8,-22.4,13.8],[-3.5,-25.9,16.3],[-9.6,-29.3,17.3],[-14.6,-32.8,17],[-18.1,-36.6,15.6],[-19.9,-39.9,14.2],[-20.5,-41.7,13.5],[-20.8,-42.7,13.3],[-21,-43.1,13.5],[-21,-43.1,13.8]] },
  prop_guitar: { flip: false,
    arm: [[-28.4,8.2,-50],[-28.3,10.1,-50],[-28.4,11.8,-50.1],[-28.6,13.2,-50.1],[-28.7,13.9,-50.1],[-28.9,13.9,-50.1],[-29.1,13.1,-50.1],[-29.2,11.8,-50.1],[-29.1,10,-50],[-28.8,8.2,-50],[-28.5,6.4,-50],[-28.3,5,-50],[-28.1,3.9,-50],[-28,3.3,-49.7],[-27.8,3.3,-49.5],[-27.7,4,-49.9],[-27.6,5.2,-50],[-27.6,6.6,-50],[-27.9,8.3,-50],[-28.2,10.1,-50],[-28.4,11.8,-50.1],[-28.6,13.2,-50.1],[-28.7,13.9,-50.1],[-28.9,13.9,-50.1],[-29.1,13.1,-50.1],[-29.2,11.8,-50.1],[-29.1,10,-50],[-28.8,8.2,-50],[-28.5,6.4,-50],[-28.3,5,-50],[-28.1,3.9,-50],[-28,3.3,-49.7],[-27.8,3.3,-49.5],[-27.7,4,-49.9],[-27.6,5.2,-50],[-27.6,6.6,-50]],
    fore: [-74.1,-70.4,-67,-64.6,-63.3,-63.1,-64.1,-66.1,-69.3,-73.5,-78,-82.3,-85.7,-87.6,-87.8,-86.3,-83.2,-79.1,-74.7,-70.5,-67,-64.6,-63.3,-63.1,-64.1,-66.1,-69.3,-73.5,-78,-82.3,-85.7,-87.6,-87.8,-86.3,-83.2,-79.1],
    hand: [[-15.5,-33.4,16.6],[-13.2,-34.1,17.9],[-10.6,-34.9,18.5],[-8.3,-35.6,18.4],[-6.9,-36,18.1],[-6.7,-36.1,18],[-7.9,-35.7,18.3],[-10.2,-35,18.5],[-12.9,-34.3,18.1],[-15.3,-33.6,16.7],[-17,-33.1,14.7],[-17.8,-32.8,12.4],[-18,-32.5,10.6],[-18,-32.2,9.7],[-17.9,-32,9.6],[-17.9,-32.3,10.2],[-17.8,-32.5,11.7],[-17.1,-32.8,14.1],[-15.6,-33.3,16.4],[-13.3,-34,17.9],[-10.6,-34.9,18.5],[-8.3,-35.6,18.4],[-6.9,-36,18.1],[-6.7,-36.1,18],[-7.9,-35.7,18.3],[-10.2,-35,18.5],[-12.9,-34.3,18.1],[-15.3,-33.6,16.7],[-17,-33.1,14.7],[-17.8,-32.8,12.4],[-18,-32.5,10.6],[-18,-32.2,9.7],[-17.9,-32,9.6],[-17.9,-32.3,10.2],[-17.8,-32.5,11.7],[-17.1,-32.8,14.1]] },
  prop_trumpet: { flip: false,
    arm: [[-9.1,-9.6,-50.2],[-8.5,-8.3,-50.2],[-7.9,-7,-50.2],[-7.3,-5.9,-50.1],[-6.7,-5,-50.1],[-6.2,-4.3,-50.1],[-5.7,-4,-50.2],[-5.2,-3.9,-50.2],[-4.8,-4.1,-50.2],[-4.5,-4.5,-50.2],[-4.4,-5.1,-50.2],[-4.4,-5.7,-50.2],[-4.5,-6.3,-50.2],[-4.9,-7,-50.2],[-5.4,-7.6,-50.2],[-6.1,-8.1,-50.2],[-6.9,-8.6,-50.2],[-7.9,-9.1,-50.2],[-8.9,-9.5,-50.2],[-9.9,-10,-50.2],[-10.9,-10.4,-50.2],[-11.8,-10.9,-50.2],[-12.6,-11.5,-50.2],[-13.2,-12.1,-50.2],[-13.7,-12.8,-50.2],[-13.9,-13.5,-50.2],[-14,-14.1,-50.2],[-13.9,-14.6,-50.2],[-13.7,-14.9,-50.2],[-13.3,-15,-50.2],[-12.8,-14.9,-50.2],[-12.3,-14.6,-50.2],[-11.6,-14,-50.2],[-11,-13.2,-50.2],[-10.4,-12.1,-50.2],[-9.7,-10.9,-50.2]],
    fore: [-120.7,-119.3,-117.9,-116.9,-116.3,-116.2,-116.7,-117.6,-118.9,-120.4,-121.9,-123.3,-124.3,-124.9,-124.9,-124.5,-123.6,-122.3,-120.8,-119.4,-118.1,-117.1,-116.6,-116.6,-117.1,-118,-119.3,-120.8,-122.2,-123.6,-124.6,-125.1,-125.1,-124.6,-123.6,-122.3],
    hand: [[-8.7,-13.1,14.6],[-8.9,-14,14.6],[-9.3,-14.9,14.6],[-9.6,-15.7,14.6],[-9.9,-16.1,14.6],[-10,-16.3,14.5],[-10,-16.2,14.5],[-9.9,-15.7,14.5],[-9.7,-15.1,14.4],[-9.5,-14.3,14.4],[-9.2,-13.4,14.4],[-8.9,-12.6,14.3],[-8.6,-11.9,14.3],[-8.5,-11.4,14.3],[-8.4,-11.3,14.4],[-8.4,-11.4,14.4],[-8.4,-11.7,14.4],[-8.6,-12.3,14.5],[-8.7,-12.9,14.5],[-8.8,-13.6,14.6],[-8.9,-14.2,14.6],[-9,-14.6,14.7],[-9,-14.8,14.7],[-8.9,-14.8,14.8],[-8.8,-14.5,14.8],[-8.6,-14,14.7],[-8.3,-13.3,14.7],[-8.1,-12.6,14.7],[-7.9,-11.8,14.7],[-7.7,-11.2,14.6],[-7.5,-10.7,14.6],[-7.5,-10.4,14.6],[-7.5,-10.5,14.6],[-7.6,-10.8,14.6],[-7.9,-11.4,14.6],[-8.2,-12.2,14.6]] },
  prop_maracas: { flip: false,
    arm: [[-46.7,-10.3,-50.1],[-45.3,-8.4,-50.2],[-44.9,-7.1,-50.2],[-45.2,-7,-50.2],[-46.9,-9.1,-50.1],[-47.5,-11.1,-50.1],[-48.1,-12.8,-50.1],[-47.7,-12.9,-50.1],[-47,-12.2,-50.1],[-46.1,-10.5,-50.2],[-45.3,-8.4,-50.2],[-44.9,-7.1,-50.2],[-45.2,-7,-50.2],[-46.9,-9.1,-50.1],[-47.5,-11.1,-50.1],[-48.1,-12.8,-50.1],[-47.7,-12.9,-50.1],[-47,-12.2,-50.1],[-46.1,-10.5,-50.2],[-45.3,-8.4,-50.2],[-44.9,-7.1,-50.2],[-45.2,-7,-50.2],[-46.9,-9.1,-50.1],[-47.5,-11.1,-50.1],[-48.1,-12.8,-50.1],[-47.7,-12.9,-50.1],[-47,-12.2,-50.1],[-46.1,-10.5,-50.2],[-45.3,-8.4,-50.2],[-44.9,-7.1,-50.2],[-45.2,-7,-50.2],[-46.9,-9.1,-50.1],[-47.5,-11.1,-50.1],[-48.1,-12.8,-50.1],[-47.7,-12.9,-50.1],[-47,-12.2,-50.1]],
    fore: [-92.5,-86.4,-83.5,-83.3,-88.8,-95.8,-103.9,-104.3,-100.4,-93,-86.5,-83.5,-83.3,-88.8,-95.8,-103.9,-104.3,-100.4,-93,-86.5,-83.5,-83.3,-88.8,-95.8,-103.9,-104.3,-100.4,-93,-86.5,-83.5,-83.3,-88.8,-95.8,-103.9,-104.3,-100.4],
    hand: [[-8.1,-21.3,16.1],[-1.4,-19,15.5],[2.8,-17.3,14.1],[3.3,-17.1,13.9],[-3.7,-19.7,15.9],[-10.5,-22.2,15.6],[-15,-25.2,13.3],[-15.3,-25.5,13.1],[-13.7,-24.2,14.3],[-8.6,-21.6,16.1],[-1.5,-19,15.5],[2.8,-17.3,14.1],[3.3,-17.1,13.9],[-3.7,-19.7,15.9],[-10.5,-22.2,15.6],[-15,-25.2,13.3],[-15.3,-25.5,13.1],[-13.7,-24.2,14.3],[-8.6,-21.6,16.1],[-1.5,-19,15.5],[2.8,-17.3,14.1],[3.3,-17.1,13.9],[-3.7,-19.7,15.9],[-10.5,-22.2,15.6],[-15,-25.2,13.3],[-15.3,-25.5,13.1],[-13.7,-24.2,14.3],[-8.6,-21.6,16.1],[-1.5,-19,15.5],[2.8,-17.3,14.1],[3.3,-17.1,13.9],[-3.7,-19.7,15.9],[-10.5,-22.2,15.6],[-15,-25.2,13.3],[-15.3,-25.5,13.1],[-13.7,-24.2,14.3]] },
  prop_flag: { flip: true,
    arm: [[-48,-24.8,-0.8],[-47.2,-20.5,-0.3],[-46.3,-16.2,0.2],[-45.4,-12.1,0.8],[-44.5,-8.5,1.3],[-43.6,-5.4,1.8],[-42.8,-2.8,2.2],[-42.2,-0.9,2.4],[-41.8,0.2,2.6],[-41.7,0.7,2.6],[-41.8,0.3,2.5],[-42.1,-0.8,2.3],[-42.6,-2.7,2],[-43.3,-5.2,1.6],[-44.2,-8.3,1.1],[-45.1,-11.9,0.6],[-46,-15.9,0],[-46.9,-20.2,-0.5],[-47.7,-24.7,-1],[-48.4,-29.1,-1.5],[-49.1,-33.5,-2],[-49.6,-37.7,-2.4],[-50,-41.4,-2.7],[-50.3,-44.6,-3],[-50.5,-47.3,-3.2],[-50.7,-49.2,-3.4],[-50.3,-50.1,-4],[-49.4,-50.1,-5.2],[-49.2,-50,-5.5],[-49.1,-48.9,-5.5],[-49,-47,-5.4],[-48.9,-44.4,-5.2],[-48.7,-41.1,-4.9],[-48.4,-37.4,-4.5],[-48.1,-33.3,-4.1],[-47.6,-28.9,-3.6]],
    fore: [-54.6,-54.5,-54.4,-54.4,-54.4,-54.4,-54.4,-54.5,-54.6,-54.6,-54.6,-54.7,-54.7,-54.8,-54.8,-54.8,-54.9,-54.9,-54.9,-54.8,-54.8,-54.8,-54.8,-54.7,-54.7,-54.7,-54.7,-54.7,-54.7,-54.7,-54.6,-54.6,-54.6,-54.6,-54.5,-54.5],
    hand: [[1.3,10.2,13],[1.4,11.1,13.6],[1.6,11.8,14.1],[1.8,12.6,14.6],[2,13.2,15],[2.1,13.8,15.3],[2.2,14.2,15.4],[2.3,14.4,15.4],[2.3,14.5,15.4],[2.4,14.5,15.4],[2.4,14.4,15.4],[2.4,14.2,15.3],[2.3,13.9,15.1],[2.2,13.5,14.8],[2.1,13,14.4],[1.9,12.3,14],[1.8,11.6,13.6],[1.6,10.8,13.1],[1.4,10,12.6],[1.2,9.2,12.1],[1,8.4,11.6],[0.8,7.6,11.2],[0.7,6.9,10.8],[0.5,6.4,10.5],[0.4,5.9,10.3],[0.4,5.6,10.2],[0.2,4.9,9.3],[0,4.1,8.3],[0,4.2,8.9],[0.1,4.4,9.4],[0.2,4.6,9.7],[0.2,5,10.1],[0.3,5.6,10.4],[0.4,6.2,10.8],[0.6,6.9,11.3],[0.7,7.6,11.7]] },
  prop_magnifier: { flip: true,
    arm: [[-56,-16.3,5.8],[-55.8,-14.7,6],[-55.4,-13.1,6],[-55.1,-11.6,6],[-54.9,-10.2,6],[-54.6,-9,6],[-54.4,-8,6],[-54.2,-7.3,6],[-54.1,-6.9,6],[-54.1,-6.7,6],[-54.1,-6.8,6],[-54.1,-7.3,5.9],[-54.3,-7.9,5.8],[-54.4,-8.8,5.7],[-54.6,-10,5.5],[-54.8,-11.3,5.3],[-55.1,-12.7,5.1],[-55.3,-14.3,4.9],[-55.6,-15.9,4.7],[-55.8,-17.5,4.4],[-56.1,-19.1,4.2],[-56.2,-20.5,4],[-56.4,-21.9,3.8],[-56.6,-23,3.7],[-56.7,-24,3.6],[-56.8,-24.6,3.5],[-56.8,-25.1,3.4],[-56.8,-25.2,3.4],[-56.8,-25.1,3.4],[-56.8,-24.7,3.4],[-56.7,-24,3.5],[-56.6,-23,3.6],[-56.5,-21.9,3.8],[-56.4,-20.6,3.9],[-56.2,-19.1,4.1],[-56,-17.6,4.4]],
    fore: [-34,-34,-33.9,-33.9,-33.9,-33.9,-33.9,-33.9,-33.9,-33.9,-34,-34,-34.1,-34.1,-34.1,-34.2,-34.2,-34.2,-34.2,-34.2,-34.2,-34.2,-34.2,-34.2,-34.2,-34.1,-34.1,-34.1,-34.1,-34,-34,-34,-34,-34,-33.9,-33.9],
    hand: [[0.8,11.8,10.2],[0.8,12,10.3],[0.8,12.1,10.4],[0.8,12.2,10.5],[0.8,12.3,10.5],[0.8,12.3,10.5],[0.8,12.3,10.5],[0.8,12.3,10.5],[0.8,12.3,10.5],[0.9,12.3,10.4],[0.9,12.3,10.4],[0.9,12.2,10.3],[0.9,12.1,10.3],[0.8,11.9,10.2],[0.8,11.7,10.1],[0.8,11.5,10],[0.8,11.2,9.9],[0.7,10.9,9.7],[0.7,10.6,9.6],[0.6,10.3,9.5],[0.6,10,9.4],[0.5,9.8,9.3],[0.5,9.5,9.2],[0.4,9.3,9.2],[0.4,9.1,9.1],[0.4,9,9.1],[0.3,8.9,9.1],[0.3,8.9,9.1],[0.3,8.9,9.1],[0.3,9,9.2],[0.3,9.1,9.3],[0.3,9.3,9.3],[0.4,9.5,9.4],[0.4,9.7,9.5],[0.4,10,9.7],[0.5,10.3,9.8]] },
};

const TRACK_N = 36;
const TRACKS = Object.fromEntries(Object.entries(PROP_ARMS).map(([id, t]) => [id, {
  arm: [0, 1, 2].map((k) => t.arm.map((r) => r[k])), fore: t.fore, hand: [0, 1, 2].map((k) => t.hand.map((r) => r[k])),
}]));
/** Which clips mount their prop end for end: the wardrobe reads this through `flip: true` on the prop row (a test keeps them equal). */
export const FLIPPED_PROP_CLIPS = Object.freeze(Object.entries(PROP_ARMS).filter(([, t]) => t.flip).map(([id]) => id));
function catmull(p0, p1, p2, p3, t) { return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t); }
function sampleLoop(arr, u) {
  const n = arr.length, i = Math.floor(u), f = u - i;
  const g = (k) => arr[(((i + k) % n) + n) % n];
  return catmull(g(-1), g(0), g(1), g(2), f);
}
function applyArmTrack(id, ph, setQ) {
  const T = TRACKS[id], u = (ph / (Math.PI * 2)) * TRACK_N;
  setQ('RightArm', sampleLoop(T.arm[0], u), sampleLoop(T.arm[1], u), sampleLoop(T.arm[2], u));
  setQ('RightForeArm', sampleLoop(T.fore, u), 0, 0);
  setQ('RightHand', sampleLoop(T.hand[0], u), sampleLoop(T.hand[1], u), sampleLoop(T.hand[2], u));
}

function describe(group, list, { plant = false } = {}) {
  return list.map((c) => Object.freeze({ id: c.id, label: c.label, group, dur: c.dur, ...(c.bpm ? { bpm: c.bpm, beats: c.beats } : {}), ...(c.prop ? { prop: c.prop } : {}), ...(plant ? { plant: true } : {}), pose: TRACKS[c.id] ? (ph, setQ, t) => { const hp = c.pose(ph, setQ, t); applyArmTrack(c.id, ph, setQ); return hp; } : c.pose }));
}

/** Every clip this module adds, in menu order: reactions, dances, prop clips. */
export const KIP_CLIPS = Object.freeze([...describe('reaction', reactions, { plant: true }), ...describe('dance', dances, { plant: true }), ...describe('prop', props, { plant: true })]);

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
  return buildKipClip(THREE, entry.id, entry.dur, entry.pose, { plant: Boolean(entry.plant) });
}
