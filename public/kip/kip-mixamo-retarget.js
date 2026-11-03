// Mixamo -> Kip retargeter (moved out of kip-bench.js so a Node tool can run the SAME code the page does: scripts/mixamo-bake.mjs).
//
// World-space retargeter from a Mixamo skeleton (a GLB or an FBX, any scale) to Kip's 14 rigid ball joints: for every frame of the source clip
// it reads each bone's world rotation relative to the bind pose and writes a 30 fps quaternion per Kip joint plus a hips position scaled to Kip's
// 61.5 mm hip height, so hip sway matches leg tilt. Returns a THREE.AnimationClip whose tracks are `kip_<Joint>.quaternion` and
// `kip_Hips.position`, the names the bench's mixer binds to. It does NOT plant the feet or cap the wrists: kip-clips.js `plantBakedClip` and
// `limitHands` do that afterwards.
//
// Pure: takes THREE as the first argument (like kip-clips.js), no DOM, no network, no page state.
//
// opts: { name, tposeClip (a clip that poses the source in a T-pose when its rest pose is not one), inPlace (false keeps forward travel) }

export function findMixamoBones(root) {
  const map = {};
  const wanted = [
    'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
    'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
    'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
    'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
    'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase'
  ];
  root.traverse(obj => {
    if (!obj.name) return;
    const clean = obj.name.replace(/^.*mixamorig\d*:?/i, '');
    for (const w of wanted) {
      if (clean.toLowerCase() === w.toLowerCase() && !map[w]) map[w] = obj;
    }
  });
  return map;
}

export function retargetMixamoClipToKip(THREE, clip, sourceRoot, opts = {}) {
  const DOWN = new THREE.Vector3(0, -1, 0);
  sourceRoot.traverse(o => { if (o.isSkinnedMesh && o.pose) o.pose(); });
  let tposeMixer = null, tposeAct = null;
  if (opts.tposeClip) {
    tposeMixer = new THREE.AnimationMixer(sourceRoot);
    tposeAct = tposeMixer.clipAction(opts.tposeClip);
    tposeAct.setLoop(THREE.LoopOnce, 1);
    tposeAct.clampWhenFinished = true;
    tposeAct.play();
    tposeMixer.setTime(0);
  }
  sourceRoot.updateMatrixWorld(true);

  const bones = findMixamoBones(sourceRoot);
  if (!bones.Hips) {
    if (tposeAct) { tposeAct.stop(); tposeMixer.uncacheRoot(sourceRoot); }
    return null;
  }

  const bindQuatInv = {};
  const bindPos = {};
  for (const [k, b] of Object.entries(bones)) {
    bindQuatInv[k] = b.getWorldQuaternion(new THREE.Quaternion()).invert();
    bindPos[k] = b.getWorldPosition(new THREE.Vector3());
  }
  if (tposeAct) {
    tposeAct.stop();
    tposeMixer.uncacheRoot(sourceRoot);
  }

  function segZeroToBind(a, b) {
    if (!bindPos[a] || !bindPos[b]) return new THREE.Quaternion();
    const dir = bindPos[b].clone().sub(bindPos[a]).normalize();
    if (dir.lengthSq() < 0.5) return new THREE.Quaternion();
    return new THREE.Quaternion().setFromUnitVectors(DOWN, dir);
  }

  const zeroToBind = {
    Hips: new THREE.Quaternion(),
    Head: new THREE.Quaternion(),
    LeftArm: segZeroToBind('LeftArm', 'LeftForeArm'),
    LeftForeArm: segZeroToBind('LeftForeArm', 'LeftHand'),
    RightArm: segZeroToBind('RightArm', 'RightForeArm'),
    RightForeArm: segZeroToBind('RightForeArm', 'RightHand'),
    LeftUpLeg: segZeroToBind('LeftUpLeg', 'LeftLeg'),
    LeftLeg: segZeroToBind('LeftLeg', 'LeftFoot'),
    LeftFoot: new THREE.Quaternion(),
    RightUpLeg: segZeroToBind('RightUpLeg', 'RightLeg'),
    RightLeg: segZeroToBind('RightLeg', 'RightFoot'),
    RightFoot: new THREE.Quaternion(),
  };
  zeroToBind.LeftHand = zeroToBind.LeftForeArm.clone();
  zeroToBind.RightHand = zeroToBind.RightForeArm.clone();

  const kipJointNames = [
    'Hips', 'Head',
    'LeftArm', 'LeftForeArm', 'LeftHand',
    'RightArm', 'RightForeArm', 'RightHand',
    'LeftUpLeg', 'LeftLeg', 'LeftFoot',
    'RightUpLeg', 'RightLeg', 'RightFoot'
  ];

  const isPose = clip.duration < 0.05;
  const duration = isPose ? 1.2 : clip.duration;
  const fps = 30;
  const steps = isPose ? 2 : Math.max(2, Math.round(duration * fps) + 1);
  const times = new Float32Array(steps);

  const qBuffers = {};
  for (const jn of kipJointNames) qBuffers[jn] = new Float32Array(steps * 4);
  const hipsPosBuf = new Float32Array(steps * 3);

  const srcMixer = new THREE.AnimationMixer(sourceRoot);
  const srcAction = srcMixer.clipAction(clip);
  srcAction.setLoop(THREE.LoopOnce, 1);
  srcAction.clampWhenFinished = true;
  srcAction.play();

  srcMixer.setTime(0);
  sourceRoot.updateMatrixWorld(true);
  const clipStartHips = bones.Hips.getWorldPosition(new THREE.Vector3());
  const refHipsY = Math.max(1e-4, bindPos.Hips.y > 0.05 ? bindPos.Hips.y : clipStartHips.y);
  // Exact 1:1 leg-length kinematic scale so hip sway matches leg tilt with zero foot-skate!
  const posScale = 61.5 / refHipsY;

  const tmpQ = new THREE.Quaternion();
  const tmpV = new THREE.Vector3();
  const zAxis = new THREE.Vector3(0, 0, 1);

  function deltaW(name) {
    const b = bones[name];
    if (!b) return new THREE.Quaternion();
    return b.getWorldQuaternion(new THREE.Quaternion()).multiply(bindQuatInv[name]);
  }
  function desiredW(name) {
    return deltaW(name).multiply(zeroToBind[name]);
  }

  for (let i = 0; i < steps; i++) {
    const t = isPose ? 0 : (i / (steps - 1)) * duration;
    times[i] = (i / (steps - 1)) * duration;

    srcMixer.setTime(t);
    sourceRoot.updateMatrixWorld(true);

    const dHips = deltaW('Hips');
    const spineKey = bones.Spine2 ? 'Spine2' : (bones.Spine1 ? 'Spine1' : 'Spine');
    const dSpine = bones[spineKey] ? deltaW(spineKey) : dHips;
    const qHipsW = dHips.clone().slerp(dSpine, 0.48);

    const hp = bones.Hips.getWorldPosition(tmpV);
    const dx = THREE.MathUtils.clamp((hp.x - clipStartHips.x) * posScale, -40, 40);
    const dy = THREE.MathUtils.clamp((hp.y - clipStartHips.y) * posScale, -26, 34);
    const dz = opts.inPlace === false
      ? THREE.MathUtils.clamp((hp.z - clipStartHips.z) * posScale, -45, 45)
      : 0;
    hipsPosBuf[i * 3 + 0] = dx;
    hipsPosBuf[i * 3 + 1] = 61.5 + dy;
    hipsPosBuf[i * 3 + 2] = dz;

    const qHeadW = bones.Head ? deltaW('Head') : (bones.Neck ? deltaW('Neck') : qHipsW.clone());
    const qHeadL = qHipsW.clone().invert().multiply(qHeadW);
    const frameQuats = { Hips: qHipsW, Head: qHeadL };

    for (const side of [1, -1]) {
      const tag = side === 1 ? 'Left' : 'Right';
      let qArmW  = desiredW(`${tag}Arm`);
      let qForeW = desiredW(`${tag}ForeArm`);
      let qHandW = bones[`${tag}Hand`] ? desiredW(`${tag}Hand`) : qForeW.clone();

      const armDir = DOWN.clone().applyQuaternion(qArmW);
      const downness = Math.max(0, -armDir.y);
      const flareRad = side * THREE.MathUtils.degToRad(9.5 * downness);
      const flareAxis = zAxis.clone().applyQuaternion(qHipsW);
      const qFlare = tmpQ.setFromAxisAngle(flareAxis, flareRad);

      qArmW.premultiply(qFlare);
      qForeW.premultiply(qFlare);
      qHandW.premultiply(qFlare);

      frameQuats[`${tag}Arm`]     = qHipsW.clone().invert().multiply(qArmW);
      frameQuats[`${tag}ForeArm`] = qArmW.clone().invert().multiply(qForeW);
      frameQuats[`${tag}Hand`]    = qForeW.clone().invert().multiply(qHandW);
    }

    for (const side of [1, -1]) {
      const tag = side === 1 ? 'Left' : 'Right';
      let qUpW   = desiredW(`${tag}UpLeg`);
      let qLegW  = desiredW(`${tag}Leg`);
      let qFootW = bones[`${tag}Foot`] ? desiredW(`${tag}Foot`) : qLegW.clone();

      const legFlareAxis = zAxis.clone().applyQuaternion(qHipsW);
      const qLegFlare = tmpQ.setFromAxisAngle(legFlareAxis, side * THREE.MathUtils.degToRad(2.5));
      qUpW.premultiply(qLegFlare);
      qLegW.premultiply(qLegFlare);
      qFootW.premultiply(qLegFlare);

      frameQuats[`${tag}UpLeg`] = qHipsW.clone().invert().multiply(qUpW);
      frameQuats[`${tag}Leg`]   = qUpW.clone().invert().multiply(qLegW);
      frameQuats[`${tag}Foot`]  = qLegW.clone().invert().multiply(qFootW);
    }

    for (const jn of kipJointNames) {
      const q = frameQuats[jn].normalize();
      const buf = qBuffers[jn];
      if (i > 0) {
        const dot = buf[(i - 1) * 4] * q.x + buf[(i - 1) * 4 + 1] * q.y + buf[(i - 1) * 4 + 2] * q.z + buf[(i - 1) * 4 + 3] * q.w;
        if (dot < 0) { q.x = -q.x; q.y = -q.y; q.z = -q.z; q.w = -q.w; }
      }
      buf[i * 4 + 0] = q.x;
      buf[i * 4 + 1] = q.y;
      buf[i * 4 + 2] = q.z;
      buf[i * 4 + 3] = q.w;
    }
  }

  srcAction.stop();
  srcMixer.uncacheRoot(sourceRoot);

  const tracks = [new THREE.VectorKeyframeTrack('kip_Hips.position', times, hipsPosBuf)];
  for (const jn of kipJointNames) {
    tracks.push(new THREE.QuaternionKeyframeTrack(`kip_${jn}.quaternion`, times, qBuffers[jn]));
  }
  return new THREE.AnimationClip(opts.name || clip.name, duration, tracks);
}
