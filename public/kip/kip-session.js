// kip-session.js: one loaded Kip rig shared by the Kip and Truck benches (Workshop stage 4b-3).
//
// The session owns the rig geometries, PartSpec base parts, expansion wardrobe and the one rig built from them.
// A host that mounts both benches creates one session and passes it as `env.sharedKip`; a standalone bench creates
// a private session. Only the bench holding the lease may parent `rig.mover`: Kip stand-down captures its pose,
// Truck seating writes its own pose, and Truck stand-down restores the captured Kip pose.
import { createKipRig } from './kip-rig.js?v=10.0';
import {
  KIP_BUILD_VERSION,
  loadExpansionGeos,
  attachExpansionToKipRig,
} from './kip-vehicles-wardrobe.js?v=10.0';

const DRIVER_KEYS = ['edition', 'head', 'hair', 'hat'];

function capturePose(rig) {
  if (!rig?.mover) return null;
  const entries = [];
  rig.mover.traverse((o) => {
    entries.push({
      o,
      position: o.position.clone(),
      quaternion: o.quaternion.clone(),
      scale: o.scale.clone(),
      visible: o.visible,
    });
  });
  return entries;
}

function restorePose(rig, entries) {
  if (!rig?.mover || !entries) return;
  for (const e of entries) {
    e.o.position.copy(e.position);
    e.o.quaternion.copy(e.quaternion);
    e.o.scale.copy(e.scale);
    e.o.visible = e.visible;
  }
  rig.mover.updateMatrixWorld(true);
}

function disposeMaterials(materials, geometries, textures) {
  for (const mat of materials) {
    if (!mat) continue;
    for (const v of Object.values(mat)) if (v?.isTexture) textures.add(v);
  }
  for (const tex of textures) tex.dispose?.();
  for (const mat of materials) mat?.dispose?.();
  for (const geo of geometries) geo?.dispose?.();
}

function disposeBuilt(built) {
  if (!built) return;
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  built.rig?.mover?.removeFromParent?.();
  built.rig?.mover?.traverse?.((o) => {
    if (o.geometry) geometries.add(o.geometry);
    o.skeleton?.dispose?.();
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m) materials.add(m);
  });
  for (const group of [built.geos, built.baseParts, built.expGeos]) {
    for (const geo of Object.values(group || {})) if (geo?.isBufferGeometry) geometries.add(geo);
  }
  for (const mat of Object.values(built.K?.mats || {})) materials.add(mat);
  for (const mat of Object.values(built.rig?.exp?.expMats || {})) materials.add(mat);
  disposeMaterials(materials, geometries, textures);
}

function addRigidSnapMeshes(K, rig, geos) {
  const byId = Object.fromEntries((rig.partSlots || []).map((s) => [s.id, s.grp]));
  const make = (slotId, geo, y, name) => {
    const grp = byId[slotId];
    if (!grp || !geo) return null;
    const mesh = K.scadMesh(geo, K.mats.shell);
    mesh.position.y = y;
    mesh.visible = false;
    mesh.name = name;
    mesh.userData.sharedKipRigidSnap = true;
    grp.add(mesh);
    return mesh;
  };
  return {
    armL: make('snap_arm_l', geos.snap_arm, -34.6, 'shared_rigid_snap_arm_l'),
    armR: make('snap_arm_r', geos.snap_arm, -34.6, 'shared_rigid_snap_arm_r'),
    legL: make('snap_leg_l', geos.snap_leg, -38.6, 'shared_rigid_snap_leg_l'),
    legR: make('snap_leg_r', geos.snap_leg, -38.6, 'shared_rigid_snap_leg_r'),
  };
}

export function createKipSession({
  THREE,
  STLLoader,
  mergeVertices,
  toCreasedNormals,
  createRig = createKipRig,
  loadExpansion = loadExpansionGeos,
  attachExpansion = attachExpansionToKipRig,
} = {}) {
  if (!THREE || !STLLoader || !mergeVertices || !toCreasedNormals) {
    throw new Error('createKipSession requires THREE, STLLoader, mergeVertices and toCreasedNormals');
  }
  const K = createRig({ THREE, STLLoader, mergeVertices, toCreasedNormals, KIP_BUILD_VERSION });
  const owners = new Set();
  const state = { edition: 'pro', head: 'kid', hair: 'off', hat: 'buds', source: null, version: 0 };
  let data = null;
  let loadPromise = null;
  let leaseOwner = null;
  let restSnapshot = null;
  let syncWardrobe = null;
  let printStateFn = null;
  let disposed = false;

  async function load() {
    if (disposed) return null;
    if (data) return data;
    loadPromise ??= (async () => {
      const [{ geos, baseParts }, expGeos] = await Promise.all([
        K.loadGeos(),
        loadExpansion(K.loadSTL),
      ]);
      const rig = K.buildKipRig(geos, baseParts);
      rig.rigidSnapMeshes = addRigidSnapMeshes(K, rig, geos);
      try {
        rig.exp = attachExpansion(THREE, rig, expGeos, baseParts, K.mats, K.scadMesh, rig.createSlot);
      } catch (e) {
        console.warn('Kip wardrobe unavailable:', e);
        rig.exp = null;
      }
      const built = { K, geos, baseParts, expGeos, rig };
      if (disposed) {
        disposeBuilt(built);
        return null;
      }
      data = built;
      restSnapshot = capturePose(rig);
      return data;
    })();
    return loadPromise;
  }

  function acquire(owner) {
    if (!owner) throw new Error('kip session owner is required');
    if (disposed) throw new Error('kip session is disposed');
    owners.add(owner);
    return session;
  }

  function borrow(owner, parent = null) {
    if (!data?.rig || disposed) return null;
    if (leaseOwner && leaseOwner !== owner) return null;
    if (leaseOwner !== owner) {
      leaseOwner = owner;
      if (owner === 'kip') restorePose(data.rig, restSnapshot);
    }
    if (parent && data.rig.mover.parent !== parent) parent.add(data.rig.mover);
    return data.rig;
  }

  function release(owner) {
    if (!data?.rig || leaseOwner !== owner) return false;
    if (owner === 'kip') restSnapshot = capturePose(data.rig);
    data.rig.mover.removeFromParent();
    if (owner === 'truck') restorePose(data.rig, restSnapshot);
    leaseOwner = null;
    return true;
  }

  function setDriverState(patch = {}, source = null) {
    for (const key of DRIVER_KEYS) {
      if (patch[key] !== undefined && patch[key] !== null) state[key] = patch[key];
    }
    if (source) state.source = source;
    state.version++;
    return { ...state };
  }

  function registerSync(fn) {
    syncWardrobe = typeof fn === 'function' ? fn : null;
    return () => { if (syncWardrobe === fn) syncWardrobe = null; };
  }

  function syncDriver() {
    if (!syncWardrobe) return false;
    return syncWardrobe({ ...state }) !== false;
  }

  // The Kip bench's full print state (outfit, skin, colours, face: what `resolveSceneBom` takes), so the Truck prints the driver as the Kip has it dressed
  // (Workshop stage 4c). The session holds only a function: with no Kip bench mounted `printState()` is null and the Truck prints the wardrobe defaults.
  function registerPrintState(fn) {
    printStateFn = typeof fn === 'function' ? fn : null;
    return () => { if (printStateFn === fn) printStateFn = null; };
  }

  function printState() {
    return printStateFn ? printStateFn() : null;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    syncWardrobe = null;
    printStateFn = null;
    leaseOwner = null;
    owners.clear();
    const built = data;
    data = null;
    loadPromise = null;
    restSnapshot = null;
    disposeBuilt(built);
  }

  function releaseRef(owner) {
    if (leaseOwner === owner) release(owner);
    owners.delete(owner);
    if (owners.size === 0) dispose();
  }

  const session = {
    K,
    loadSTL: K.loadSTL,
    scadMesh: K.scadMesh,
    mats: K.mats,
    STL_NAMES: K.STL_NAMES,
    state,
    load,
    acquire,
    borrow,
    release,
    releaseRef,
    setDriverState,
    registerSync,
    syncDriver,
    registerPrintState,
    printState,
    dispose,
    get data() { return data; },
    get rig() { return data?.rig ?? null; },
    get leaseOwner() { return leaseOwner; },
    get owners() { return [...owners]; },
    get disposed() { return disposed; },
  };
  return session;
}
