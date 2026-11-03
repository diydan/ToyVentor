// Baked Mixamo clips (docs/specs/dance-party-spec.md 3.1, phase 2): what ships is joint data, never the raw Mixamo file.
//
// scripts/mixamo-bake.mjs turns a downloaded Mixamo FBX into a small JSON: the 14 Kip joints' rotations and the hips position at 30 fps, already
// retargeted (kip-mixamo-retarget.js), with the wrists capped and the feet planted (kip-clips.js). The Kip bench reads that JSON back into a
// THREE.AnimationClip with `bakedToClip`. This module is the shared, pure half: the same code runs in Node and in the page.
//
//   removeHipsDrift   SOURCE clip: take the hips' slow travel out (a linear ramp, then optionally everything slower than `highpassSeconds`),
//                     so a clip that walks 1.5 m while dancing, or wanders 2 m, loops in place. Done BEFORE retargeting because the
//                     retargeter clamps the hips' travel, which would hide a drift instead of removing it.
//   trimClip          SOURCE clip: keep the window [start, end] seconds (a long clip with one good stretch).
//   clipToBaked       a retargeted Kip clip -> the JSON object that ships.
//   bakedToClip       that JSON object -> a THREE.AnimationClip the bench's mixer plays.
//
// Pure: takes THREE as the first argument, no DOM, no network, no page state.

export const BAKED_VERSION = 1;
export const BAKED_FPS = 30;
export const BAKED_JOINTS = Object.freeze([
  'Hips', 'Head',
  'LeftArm', 'LeftForeArm', 'LeftHand',
  'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot',
  'RightUpLeg', 'RightLeg', 'RightFoot',
]);

const isHipsPos = (t) => /Hips\.position$/.test(t.name);

/** Times of a track, as a plain array. */
const timesOf = (track) => Array.from(track.times);

/**
 * Take the slow travel out of the hips' x and z. Mutates and returns `clip`.
 *  1. a linear ramp from the first key to the last is subtracted, so the clip ends where it started (a one-way drift);
 *  2. if `highpassSeconds` is given, a circular moving average of that length is subtracted too, which keeps the rhythmic sway (faster than
 *     that length) and drops a slow wander (a swing dance that drifts 2 m sideways). The clip is treated as a loop for this.
 * Height (y) is never touched. Returns what was removed, in the source's units, for the report.
 */
export function removeHipsDrift(THREE, clip, { highpassSeconds = 0 } = {}) {
  const report = { ramp: 0, wander: 0 };
  for (const track of clip.tracks) {
    if (!isHipsPos(track)) continue;
    const times = timesOf(track);
    const n = times.length;
    if (n < 3) continue;
    const v = track.values;
    const T = times[n - 1] - times[0];
    for (const axis of [0, 2]) {
      const dx = v[(n - 1) * 3 + axis] - v[axis];
      report.ramp = Math.max(report.ramp, Math.abs(dx));
      for (let i = 0; i < n; i++) v[i * 3 + axis] -= (dx * (times[i] - times[0])) / T;
    }
    if (highpassSeconds > 0) {
      const dt = T / (n - 1);
      const half = Math.max(1, Math.round(highpassSeconds / dt / 2));
      for (const axis of [0, 2]) {
        const src = new Float32Array(n);
        for (let i = 0; i < n; i++) src[i] = v[i * 3 + axis];
        for (let i = 0; i < n; i++) {
          let sum = 0;
          for (let k = -half; k <= half; k++) sum += src[(((i + k) % (n - 1)) + (n - 1)) % (n - 1)]; // the last key repeats the first: wrap over n - 1
          const mean = sum / (2 * half + 1);
          report.wander = Math.max(report.wander, Math.abs(mean - src[0]));
          v[i * 3 + axis] = src[i] - mean;
        }
      }
    }
  }
  return report;
}

/** Keep seconds [start, end] of a source clip, re-timed to start at 0. */
export function trimClip(THREE, clip, start, end, fps = BAKED_FPS) {
  return THREE.AnimationUtils.subclip(clip, clip.name, Math.round(start * fps), Math.round(end * fps), fps);
}

/**
 * Make a retargeted Kip clip loop: over the last `seconds`, ease every joint (and the hips position) back to the first frame, so the last frame
 * IS the first. For a clip cut out of a longer one, which ends in a different pose than it starts. Mutates and returns `clip`.
 */
export function closeLoop(THREE, clip, seconds = 0.4) {
  const q0 = new THREE.Quaternion(), q1 = new THREE.Quaternion();
  for (const track of clip.tracks) {
    const isQ = track.name.endsWith('.quaternion');
    const size = isQ ? 4 : 3;
    const n = track.times.length;
    const T = track.times[n - 1];
    const v = track.values;
    if (isQ) q0.fromArray(v, 0);
    for (let i = 0; i < n; i++) {
      const w0 = (track.times[i] - (T - seconds)) / seconds;
      if (w0 <= 0) continue;
      const w = w0 * w0 * (3 - 2 * w0); // smoothstep: 0 where the window opens, 1 on the last frame
      if (isQ) {
        q1.fromArray(v, i * 4);
        if (q0.dot(q1) < 0) { q1.x = -q1.x; q1.y = -q1.y; q1.z = -q1.z; q1.w = -q1.w; }
        q1.slerp(q0, w).normalize().toArray(v, i * 4);
      } else {
        for (let k = 0; k < size; k++) v[i * size + k] += (v[k] - v[i * size + k]) * w;
      }
    }
  }
  return clip;
}

const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

/**
 * A retargeted Kip clip (the 14 `kip_<Joint>.quaternion` tracks and `kip_Hips.position`, uniform 30 fps) to the JSON that ships.
 * meta: { id, label, group, source, beats, planted } -- `planted` says the feet were planted (false for a jump or a cheer); `bpm` is derived (60 x beats / duration), so the two can never disagree.
 */
export function clipToBaked(THREE, clip, meta) {
  const hips = clip.tracks.find((t) => t.name === 'kip_Hips.position');
  if (!hips) throw new Error('clipToBaked: no kip_Hips.position track');
  const n = hips.times.length;
  const out = {
    v: BAKED_VERSION,
    id: meta.id,
    label: meta.label,
    group: meta.group,
    source: meta.source,
    planted: meta.planted !== false,
    fps: BAKED_FPS,
    frames: n,
    dur: round(clip.duration, 4),
    hips: Array.from(hips.values, (x) => round(x, 3)),
    q: {},
  };
  if (meta.beats) { out.beats = meta.beats; out.bpm = round((60 * meta.beats) / clip.duration, 2); }
  for (const j of BAKED_JOINTS) {
    const t = clip.tracks.find((x) => x.name === `kip_${j}.quaternion`);
    if (!t || t.times.length !== n) throw new Error(`clipToBaked: joint ${j} missing or not on the hips' timeline`);
    out.q[j] = Array.from(t.values, (x) => round(x, 5));
  }
  return out;
}

/** The JSON back into a clip. Frames are evenly spaced, so the times are rebuilt from the duration. */
export function bakedToClip(THREE, baked) {
  if (!baked || baked.v !== BAKED_VERSION) throw new Error('bakedToClip: not a version 1 baked clip');
  const n = baked.frames;
  const times = new Float32Array(n);
  for (let i = 0; i < n; i++) times[i] = (i / (n - 1)) * baked.dur;
  const tracks = [new THREE.VectorKeyframeTrack('kip_Hips.position', times, Float32Array.from(baked.hips))];
  for (const j of BAKED_JOINTS) tracks.push(new THREE.QuaternionKeyframeTrack(`kip_${j}.quaternion`, times, Float32Array.from(baked.q[j])));
  return new THREE.AnimationClip(baked.id, baked.dur, tracks);
}

/**
 * Checks a baked clip as read from disk, before it is trusted: right version and shape, finite numbers, unit quaternions, a loop that closes
 * (when `loop`), nothing outside Kip's hip range. Returns a list of problems (empty = fine).
 */
export function checkBaked(baked, { loop = false } = {}) {
  const bad = [];
  if (!baked || baked.v !== BAKED_VERSION) return ['not a version 1 baked clip'];
  const n = baked.frames;
  if (!Number.isInteger(n) || n < 3) return ['too few frames'];
  if (!(baked.dur > 0) || Math.abs(baked.dur * baked.fps - (n - 1)) > 1.01) bad.push(`duration ${baked.dur} s does not match ${n} frames at ${baked.fps} fps`);
  if (!Array.isArray(baked.hips) || baked.hips.length !== n * 3 || baked.hips.some((x) => !Number.isFinite(x))) bad.push('hips track is not finite numbers, 3 per frame');
  for (const j of BAKED_JOINTS) {
    const q = baked.q?.[j];
    if (!Array.isArray(q) || q.length !== n * 4 || q.some((x) => !Number.isFinite(x))) { bad.push(`${j}: not finite numbers, 4 per frame`); continue; }
    for (let i = 0; i < n; i++) {
      const len = Math.hypot(q[i * 4], q[i * 4 + 1], q[i * 4 + 2], q[i * 4 + 3]);
      if (Math.abs(len - 1) > 0.01) { bad.push(`${j}: frame ${i} is not a unit quaternion (${len.toFixed(3)})`); break; }
    }
    if (loop) {
      const a = q.slice(0, 4), b = q.slice(-4);
      const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
      const deg = (2 * Math.acos(Math.min(1, d)) * 180) / Math.PI;
      if (deg > 2) bad.push(`${j}: the loop does not close (${deg.toFixed(1)} degrees between the last frame and the first)`);
    }
  }
  if (Array.isArray(baked.hips)) {
    for (let i = 0; i < n; i++) {
      const [x, y, z] = [baked.hips[i * 3], baked.hips[i * 3 + 1], baked.hips[i * 3 + 2]];
      if (Math.abs(x) > 60 || Math.abs(z) > 60 || y < 20 || y > 110) { bad.push(`hips frame ${i} is outside Kip's range (${x}, ${y}, ${z} mm)`); break; }
    }
  }
  if (baked.beats !== undefined) {
    if (!Number.isInteger(baked.beats) || baked.beats < 1) bad.push('beats must be a whole number');
    else if (Math.abs((baked.dur * baked.bpm) / 60 - baked.beats) > 0.01) bad.push(`${baked.dur} s at ${baked.bpm} bpm is not ${baked.beats} beats`);
  }
  return bad;
}
