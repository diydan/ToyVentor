// Live STL hero rig loader + bounded LRU geometry cache (5A Unit 4).
//
// Keeps synchronous procedural rigs in playerRig.ts as instant/offline fallback,
// then upgrades the live stage hero in-place once real STLs from /kip/stls/ and
// /kip/partspec/ resolve. Cached BufferGeometries carry userData.stlCached=true
// so routine rig swaps never dispose shared geometry; clearStlRigCache() frees
// them when the stage unmounts.
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import {
  mergeVertices,
  toCreasedNormals,
} from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { RigColors, RigSel, ToyRig } from "./playerRig";
import { FACEPLATE_HOLDER, KID_CROWN_Y, KIP_BOOT_HEX, KIP_DEFAULT_HAIR_HEX, KIP_WIG_LIFT_MM, kipBodyColors, kipHairUrl, resolveKipTop, type KipTop } from "./kipLook";
import { coverMesh } from "./kipCover";
import { buildFaceDecalGeometry, kipFaceMaterial } from "./kipFacePlate";
import { lightenShadow } from "./shadowProxy";
import { NECK_FOOT_MM, SNAP_ARM_FLEX, SNAP_CUFF_Q, SNAP_LEG_FLEX, makeFlexLimb, makeHandFollow, type SnapArmHandles, type SnapLegHandles, type SnapRigHandles } from "./snapFlex";
import {
  GLASS,
  glowMat,
  linearize,
  M,
  matte,
  metal,
  paintMat,
  plastic,
  T,
} from "./worldScene";

export const MAX_STL_CACHE = 48;
export const KIP_MM_SCALE = 0.0185;
/** Hip height of the Kip figure in mm: where the legs pivot for skeletal animation. */
/** Where the fist is, in the arm holder's frame at rest (units; measured on the Snap hand's mesh, 2026-11-04): 0.125 forward of the arm's line, 0.85 down it, and 0.03 toward the body (mirrored for the other hand). */
export const FIST_IN_HOLDER = { x: 0.125, y: -0.845, z: 0.031 } as const;
export const KIP_HIP_MM = 61.5;
export const VEH_MM_SCALE = 0.0235;

export type StlFetcher = (url: string) => Promise<ArrayBuffer | null>;

export interface StlUpgradeToken {
  cancelled: boolean;
}

export interface StlHeroPartSpec {
  key: string;
  url: string;
  creaseDeg: number;
  required: boolean;
}

export interface StlHeroRecipe {
  heroId: string;
  archetype: "character" | "vehicle";
  parts: StlHeroPartSpec[];
}

export interface UpgradeRigOptions {
  type: string;
  sel: RigSel;
  col: RigColors;
  toyId?: string | null;
  token?: StlUpgradeToken;
  fetcher?: StlFetcher;
  onReady?: (heroId: string) => void;
  onFallback?: () => void;
}

const stlLoader = new STLLoader();
const lruCache = new Map<string, THREE.BufferGeometry>();
const inflight = new Map<string, Promise<THREE.BufferGeometry | null>>();
let activeCustomFetcher: StlFetcher | null = null;
let cacheEvictions = 0;

export function setStlRigFetcherForTest(fn: StlFetcher | null): void {
  activeCustomFetcher = fn;
}

export function getStlRigCacheStats(): {
  size: number;
  maxSize: number;
  evictions: number;
  keys: string[];
} {
  return {
    size: lruCache.size,
    maxSize: MAX_STL_CACHE,
    evictions: cacheEvictions,
    keys: Array.from(lruCache.keys()),
  };
}

export function clearStlRigCache(): void {
  for (const geo of lruCache.values()) {
    try {
      geo.dispose();
    } catch {
      // ignore disposal errors on torn-down WebGL contexts
    }
  }
  lruCache.clear();
  inflight.clear();
  cacheEvictions = 0;
}

function cacheKey(url: string, creaseDeg: number): string {
  return `${url}#${creaseDeg}`;
}

function touchCache(key: string, geo: THREE.BufferGeometry): void {
  if (lruCache.has(key)) {
    lruCache.delete(key);
  }
  lruCache.set(key, geo);
  while (lruCache.size > MAX_STL_CACHE) {
    const oldestKey = lruCache.keys().next().value;
    if (oldestKey === undefined) break;
    const evicted = lruCache.get(oldestKey);
    lruCache.delete(oldestKey);
    cacheEvictions++;
    if (evicted) {
      try {
        evicted.dispose();
      } catch {
        // ignore
      }
    }
  }
}

function isLikelyHtmlFallback(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 84) return true;
  const head = new Uint8Array(buf, 0, Math.min(32, buf.byteLength));
  let ascii = "";
  for (let i = 0; i < head.length; i++) {
    ascii += String.fromCharCode(head[i] ?? 0);
  }
  const trimmed = ascii.trimStart().toLowerCase();
  return trimmed.startsWith("<!doctype") || trimmed.startsWith("<html");
}

async function defaultFetchStl(url: string): Promise<ArrayBuffer | null> {
  if (typeof fetch !== "function") return null;
  let resolvedUrl = url;
  if (url.startsWith("/")) {
    if (
      typeof window === "undefined" ||
      !window.location ||
      !window.location.origin ||
      window.location.origin === "null"
    ) {
      return null;
    }
    // Skip unmocked localhost:3000 jsdom default origin unless a real server/port is running
    if (
      typeof navigator !== "undefined" &&
      /jsdom/i.test(navigator.userAgent || "")
    ) {
      return null;
    }
    resolvedUrl = `${window.location.origin}${url}`;
  }
  try {
    const res = await fetch(resolvedUrl);
    if (!res.ok) return null;
    const ct = (res.headers?.get?.("content-type") ?? "").toLowerCase();
    if (ct.includes("text/html")) return null;
    const buf = await res.arrayBuffer();
    if (isLikelyHtmlFallback(buf)) return null;
    return buf;
  } catch {
    return null;
  }
}

export function parseStlGeometry(
  buf: ArrayBuffer,
  creaseDeg = 34,
): THREE.BufferGeometry | null {
  if (isLikelyHtmlFallback(buf)) return null;
  try {
    const raw = stlLoader.parse(buf);
    const vertCount = raw.attributes.position?.count ?? 0;
    // Fine-tessellated print STLs (> 9k verts) already carry smooth sub-mm CAD
    // facet normals; running string-hashed mergeVertices + toCreasedNormals on
    // 130k+ vertices stalls the main thread for seconds. Only crease-smooth
    // coarse low-poly meshes.
    if (creaseDeg > 0 && vertCount > 0 && vertCount <= 9000) {
      raw.deleteAttribute("normal");
      const merged = mergeVertices(raw, 1e-4);
      merged.computeVertexNormals();
      const out = toCreasedNormals(merged, THREE.MathUtils.degToRad(creaseDeg));
      if (out !== merged) merged.dispose();
      raw.dispose();
      out.userData.stlCached = true;
      return out;
    }
    if (!raw.attributes.normal) {
      raw.computeVertexNormals();
    }
    raw.userData.stlCached = true;
    return raw;
  } catch {
    return null;
  }
}

export async function loadCachedStl(
  url: string,
  creaseDeg = 34,
  fetcher?: StlFetcher,
): Promise<THREE.BufferGeometry | null> {
  const key = cacheKey(url, creaseDeg);
  const existing = lruCache.get(key);
  if (existing) {
    touchCache(key, existing);
    return existing;
  }
  const pending = inflight.get(key);
  if (pending) return pending;

  const loaderFn = fetcher ?? activeCustomFetcher ?? defaultFetchStl;
  const task = (async (): Promise<THREE.BufferGeometry | null> => {
    try {
      const buf = await loaderFn(url);
      if (!buf) return null;
      const geo = parseStlGeometry(buf, creaseDeg);
      if (!geo) return null;
      touchCache(key, geo);
      return geo;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, task);
  return task;
}

function scadMesh(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
): THREE.Mesh {
  const m = new T.Mesh(geo, mat);
  m.rotation.x = -Math.PI / 2;
  m.castShadow = true;
  m.receiveShadow = true;
  return lightenShadow(m);
}

/**
 * The Snap joint turrets (the bench's `addSnapTurretMesh`: a big one at each shoulder and hip, a small one at each wrist and ankle) are NOT worn: the ball joints below cover every joint they were
 * there to close, and a turret is 6,650 triangles (the eight: 53,000, 15 percent of the whole scene and a quarter of Kip, plus eight draw calls and 666 KB of STL on first load) that no pose
 * and no side shows (measured 2026-11-05: the same pose rendered with and without them, shrug, cheer, kick, thinking and wave, from the front, the side and three quarters, differs by no more than
 * two renders of the same thing a moment apart). The print kit still has them (`snap_turret*.stl`); the game's Kip does not.
 */
/**
 * A ball joint where a limb meets the body or the next part (Dan, 2026-11-04, after the turrets: "some feet and hands and shoulders just hang, we want them connected by the ball joint for
 * aesthetics"): a sphere of the limb's own colour centred on the joint's pivot, so whatever the limb does the two parts stay joined by a ball and nothing shows a gap. Radii (mm) are
 * measured against the limb ends: the sleeve's top is 6.2 across its radius and its cuff 10.1; the trouser leg's top 7 and its hem 12.
 */
export const BALL_JOINT_MM = { shoulder: 8, hip: 7.5, wrist: 9, ankle: 8.5 } as const;
export type BallJointKind = keyof typeof BALL_JOINT_MM;
/** A ball is 16 by 12 segments (it was 22 by 16): 360 triangles, a round silhouette at the size it is drawn (a few pixels across on a phone). */
export const BALL_SEGMENTS = { w: 16, h: 12 } as const;
function ballJoint(mat: THREE.Material, kind: BallJointKind): THREE.Mesh {
  const m = new T.Mesh(new T.SphereGeometry(BALL_JOINT_MM[kind], BALL_SEGMENTS.w, BALL_SEGMENTS.h), mat);
  m.castShadow = false;   // 8 more draws in the shadow pass for a ball a few millimetres wide, whose shadow the limbs' own proxies already cast
  m.receiveShadow = true;
  m.userData.ballJoint = kind;
  return m;
}
/**
 * Reconstruct assembly-frame Y-up pose from a flex-skin STL exported in `[180, 0, 0]`
 * show-face-down print orientation (`z_print = thicknessMm - z_assy`, `y_print = -y_assy`).
 */
function scadInvertedMesh(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  thicknessMm = 4.4,
): THREE.Group {
  const g = new T.Group();
  const m = new T.Mesh(geo, mat);
  m.rotation.x = Math.PI / 2;
  m.position.y = thicknessMm;
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(lightenShadow(m));
  return g;
}

function disposeSlotChildren(slot: THREE.Group): void {
  while (slot.children.length > 0) {
    const child = slot.children[0]!;
    slot.remove(child);
    child.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry && !mesh.geometry.userData?.stlCached) {
        mesh.geometry.dispose();
      }
    });
  }
}

function resolveCharacterHeadSpec(sel: RigSel): {
  mode: "creature" | "human" | "critter" | "robot";
  headUrl: string;
  faceUrl?: string;
} {
  const base = String(sel.base || "creature");
  if (base.startsWith("robot.head.")) {
    const rk = base.replace("robot.head.", "");
    return {
      mode: "robot",
      headUrl:
        rk === "cams" || rk === "dome"
          ? "/kip/partspec/toyventor_robot_head_scout_S.stl"
          : "/kip/partspec/toyventor_robot_head_visor_S.stl",
    };
  }
  if (base === "block") {
    return {
      mode: "human",
      headUrl: "/kip/partspec/toyventor_char_head_kid_S.stl",
      faceUrl: "/kip/partspec/toyventor_char_faceplate_P.stl",
    };
  }
  if (base === "vinyl") {
    const ears = String(sel.ears || "");
    const url =
      ears === "bear"
        ? "/kip/partspec/toyventor_char_head_bear_S.stl"
        : ears === "cat"
          ? "/kip/partspec/toyventor_char_head_cat_S.stl"
          : "/kip/partspec/toyventor_char_head_fox_S.stl";
    return { mode: "critter", headUrl: url };
  }
  const ears = String(sel.ears || "");
  const creatureUrl =
    ears === "horns"
      ? "/kip/partspec/toyventor_char_head_dragon_S.stl"
      : ears === "antennae"
        ? "/kip/partspec/toyventor_char_head_alien_S.stl"
        : "/kip/partspec/toyventor_char_head_imp_S.stl";
  return { mode: "creature", headUrl: creatureUrl };
}

function resolveCharacterHatUrl(hatId: string): string | null {
  if (!hatId || hatId === "none") return null;
  if (hatId === "cap") return "/kip/partspec/toyventor_hat_ballcap_S.stl";
  if (hatId === "crown" || hatId === "robot.top.gearcrown") {
    return "/kip/partspec/toyventor_crown_buds_2x1.stl";
  }
  if (hatId === "wizard") return "/kip/partspec/toyventor_hat_tophat_S.stl";
  if (hatId === "propcap" || hatId === "robot.top.siren") {
    return "/kip/partspec/toyventor_hat_hardhat_S.stl";
  }
  if (hatId === "flower") return "/kip/partspec/toyventor_hat_ranger_S.stl";
  if (hatId.startsWith("robot.top.")) {
    return "/kip/partspec/toyventor_wobble_hat_S.stl";
  }
  return null;
}

/** What the top of a human head wears (kipLook.ts `resolveKipTop`): a hat, else hair, else the smooth cover. A hat id the game has no model for counts as no hat, as it always did. */
function characterTop(sel: RigSel): KipTop {
  return resolveKipTop({ hat: resolveCharacterHatUrl(sel.hat) ? sel.hat : "none", hair: sel.hair });
}

function resolveCharacterBackUrl(backId: string): string | null {
  if (!backId || backId === "none" || backId === "cape") return null;
  if (backId === "wings") return "/kip/partspec/toyventor_cloud_wings_S.stl";
  if (backId === "jetpack" || backId === "robot.torso.jet") {
    return "/kip/partspec/toyventor_robot_back_jetpack_S.stl";
  }
  return "/kip/partspec/toyventor_pack_explorer_S.stl";
}

function resolveCharacterPropUrl(propId: string): string | null {
  if (!propId || propId === "none") return null;
  if (propId === "robot.arms.tools") {
    return "/kip/partspec/toyventor_prop_wrench_P.stl";
  }
  if (propId === "robot.arms.claws") {
    return "/kip/partspec/toyventor_prop_hammer_P.stl";
  }
  if (propId === "robot.arms.magnets") {
    return "/kip/partspec/toyventor_prop_magnifier_P.stl";
  }
  if (propId === "robot.arms.hands") {
    return "/kip/partspec/toyventor_prop_star_shield_P.stl";
  }
  return "/kip/partspec/toyventor_prop_flag_P.stl";
}

export function resolveStlHeroRecipe(
  type: string,
  sel: RigSel,
  toyId?: string | null,
): StlHeroRecipe {
  if (type !== "vehicle") {
    const headSpec = resolveCharacterHeadSpec(sel);
    const parts: StlHeroPartSpec[] = [
      // The Snap torso, as the bench's Snap figure has it (kip-rig.js `torso_snap`): a plain egg with no sockets. The Pro torso (`torso.stl`) has the sockets for the Pro pegs at the shoulders and
      // hips, which with the Snap limbs were just open holes (Dan, 2026-11-04: "still not ankles, wrists or shoulder joints? just a gap/void?").
      { key: "torso", url: "/kip/stls/snap_torso.stl", creaseDeg: 38, required: true },
      { key: "neckTurret", url: "/kip/stls/neck_turret_2x1.stl", creaseDeg: 38, required: true },
      { key: "snapArm", url: "/kip/stls/snap_arm.stl", creaseDeg: 38, required: true },
      { key: "handL", url: "/kip/stls/hand_l.stl", creaseDeg: 38, required: true },
      { key: "handR", url: "/kip/stls/hand_r.stl", creaseDeg: 38, required: true },
      { key: "snapLeg", url: "/kip/stls/snap_leg.stl", creaseDeg: 38, required: true },
      { key: "boot", url: "/kip/stls/boot.stl", creaseDeg: 38, required: true },
      { key: "headMain", url: headSpec.headUrl, creaseDeg: 36, required: true },
    ];
    if (headSpec.faceUrl) {
      parts.push({
        key: "faceplate",
        url: headSpec.faceUrl,
        creaseDeg: 24,
        required: false,
      });
    }
    const hatUrl = resolveCharacterHatUrl(sel.hat);
    if (hatUrl) {
      parts.push({ key: "hat", url: hatUrl, creaseDeg: 34, required: false });
    }
    if (headSpec.mode === "human") {
      // The top of a human head wears a hat, else hair, else the smooth cover (Dan, 2026-11-04: the bare orange studs looked odd). A hat-ready wig under a hat is kept; a wig on its own gets the
      // demo's orange stud overlay when it is hat-ready (the wig's own studs are hair-coloured).
      const top = characterTop(sel);
      if (top.hair) parts.push({ key: "hair", url: kipHairUrl(top.hair.id), creaseDeg: 34, required: false });
      if (top.kind === "hair" && top.hair.hatReady) {
        parts.push({ key: "crownBuds", url: "/kip/partspec/toyventor_crown_buds_2x1.stl", creaseDeg: 34, required: false });
      }
    }
    if (sel.ears === "horns") {
      parts.push({
        key: "ears",
        url: "/kip/partspec/toyventor_bumper_horns_S.stl",
        creaseDeg: 34,
        required: false,
      });
    } else if (sel.ears && sel.ears !== "none") {
      parts.push({
        key: "ears",
        url: "/kip/partspec/toyventor_pointy_ears_S.stl",
        creaseDeg: 34,
        required: false,
      });
    }
    const backUrl = resolveCharacterBackUrl(sel.back);
    if (backUrl) {
      parts.push({ key: "back", url: backUrl, creaseDeg: 34, required: false });
    }
    if (sel.tail && sel.tail !== "none") {
      parts.push({
        key: "tail",
        url: "/kip/partspec/toyventor_waddle_tail_s_S.stl",
        creaseDeg: 34,
        required: false,
      });
    }
    const propUrl = resolveCharacterPropUrl(sel.prop);
    if (propUrl) {
      parts.push({ key: "prop", url: propUrl, creaseDeg: 34, required: false });
    }
    return {
      heroId: toyId || `kip-${headSpec.mode}`,
      archetype: "character",
      parts,
    };
  }

  const id = toyId || (sel.chassis === "truck" ? "seed-truck" : "seed-car");
  if (id === "seed-scooter" || id === "seed-motorbike") {
    const isMoto = id === "seed-motorbike";
    return {
      heroId: id,
      archetype: "vehicle",
      parts: [
        { key: "frame", url: "/kip/partspec/toyventor_veh_scooter_frame_S.stl", creaseDeg: 34, required: true },
        { key: "fork", url: "/kip/partspec/toyventor_veh_handlebar_fork_P.stl", creaseDeg: 34, required: true },
        {
          key: "cover",
          url: isMoto
            ? "/kip/partspec/toyventor_veh_moto_cowling_S.stl"
            : "/kip/partspec/toyventor_veh_scooter_fairing_S.stl",
          creaseDeg: 32,
          required: true,
        },
        { key: "wheel", url: "/kip/partspec/toyventor_veh_wheel_moto_P.stl", creaseDeg: 30, required: true },
        { key: "rim", url: "/kip/partspec/toyventor_veh_wheel_moto_rim.stl", creaseDeg: 32, required: false },
        { key: "exhaust", url: "/kip/partspec/toyventor_racer_twin_exhaust_S.stl", creaseDeg: 34, required: false },
      ],
    };
  }

  if (id === "seed-tractor") {
    return {
      heroId: id,
      archetype: "vehicle",
      parts: [
        { key: "keel", url: "/kip/partspec/toyventor_kit_keel_base_S.stl", creaseDeg: 34, required: true },
        { key: "cab", url: "/kip/partspec/toyventor_kit_windscreen_S.stl", creaseDeg: 32, required: true },
        { key: "scoop", url: "/kip/partspec/toyventor_kit_scoop_blade_S.stl", creaseDeg: 34, required: true },
        { key: "tub", url: "/kip/partspec/toyventor_kit_tilting_tub_S.stl", creaseDeg: 34, required: true },
        { key: "wheelFront", url: "/kip/partspec/toyventor_kit_wheel_med_P.stl", creaseDeg: 30, required: true },
        { key: "wheelRear", url: "/kip/partspec/toyventor_kit_wheel_giant_P.stl", creaseDeg: 30, required: true },
      ],
    };
  }

  if (id === "seed-aeroplane") {
    return {
      heroId: id,
      archetype: "vehicle",
      parts: [
        { key: "keel", url: "/kip/partspec/toyventor_kit_keel_base_S.stl", creaseDeg: 34, required: true },
        { key: "cowl", url: "/kip/partspec/toyventor_skin_aero_cowl_S.stl", creaseDeg: 32, required: true },
        { key: "canopy", url: "/kip/partspec/toyventor_skin_windscreen_S.stl", creaseDeg: 32, required: true },
        { key: "wing", url: "/kip/partspec/toyventor_kit_foil_wing_S.stl", creaseDeg: 32, required: true },
        { key: "prop", url: "/kip/partspec/toyventor_kit_rotor_blade_P.stl", creaseDeg: 32, required: true },
        { key: "wheel", url: "/kip/partspec/toyventor_kit_wheel_med_P.stl", creaseDeg: 30, required: true },
      ],
    };
  }

  if (id === "seed-catamaran") {
    return {
      heroId: id,
      archetype: "vehicle",
      parts: [
        { key: "keel", url: "/kip/partspec/toyventor_kit_keel_base_S.stl", creaseDeg: 34, required: true },
        { key: "pontoon", url: "/kip/partspec/toyventor_kit_skid_runner_S.stl", creaseDeg: 34, required: true },
        { key: "prow", url: "/kip/partspec/toyventor_kit_aero_wedge_S.stl", creaseDeg: 32, required: true },
        { key: "bridge", url: "/kip/partspec/toyventor_kit_windscreen_S.stl", creaseDeg: 32, required: true },
        { key: "sail", url: "/kip/partspec/toyventor_kit_foil_wing_S.stl", creaseDeg: 32, required: false },
      ],
    };
  }

  if (id === "seed-helicopter") {
    return {
      heroId: id,
      archetype: "vehicle",
      parts: [
        { key: "keel", url: "/kip/partspec/toyventor_kit_keel_base_S.stl", creaseDeg: 34, required: true },
        { key: "cowl", url: "/kip/partspec/toyventor_skin_aero_cowl_S.stl", creaseDeg: 32, required: true },
        { key: "canopy", url: "/kip/partspec/toyventor_kit_windscreen_S.stl", creaseDeg: 32, required: true },
        { key: "skid", url: "/kip/partspec/toyventor_kit_skid_runner_S.stl", creaseDeg: 34, required: true },
        { key: "mast", url: "/kip/partspec/toyventor_kit_turntable_S.stl", creaseDeg: 34, required: true },
        { key: "rotor", url: "/kip/partspec/toyventor_kit_rotor_blade_P.stl", creaseDeg: 32, required: true },
        { key: "boom", url: "/kip/partspec/toyventor_kit_clevis_spine_S.stl", creaseDeg: 34, required: false },
      ],
    };
  }

  if (id === "seed-shuttle") {
    return {
      heroId: id,
      archetype: "vehicle",
      parts: [
        { key: "keel", url: "/kip/partspec/toyventor_kit_keel_base_S.stl", creaseDeg: 34, required: true },
        { key: "nose", url: "/kip/partspec/toyventor_kit_aero_wedge_S.stl", creaseDeg: 32, required: true },
        { key: "shroud", url: "/kip/partspec/toyventor_skin_cargo_shroud_S.stl", creaseDeg: 32, required: true },
        { key: "canopy", url: "/kip/partspec/toyventor_skin_windscreen_S.stl", creaseDeg: 32, required: true },
        { key: "wing", url: "/kip/partspec/toyventor_kit_foil_wing_S.stl", creaseDeg: 32, required: true },
        { key: "booster", url: "/kip/partspec/toyventor_kit_booster_pod_S.stl", creaseDeg: 34, required: true },
        { key: "wheel", url: "/kip/partspec/toyventor_kit_wheel_med_P.stl", creaseDeg: 30, required: false },
      ],
    };
  }

  if (id === "seed-mech") {
    return {
      heroId: id,
      archetype: "vehicle",
      parts: [
        { key: "keel", url: "/kip/partspec/toyventor_kit_keel_base_S.stl", creaseDeg: 34, required: true },
        { key: "driveTray", url: "/kip/partspec/toyventor_mech_drive_tray_S.stl", creaseDeg: 34, required: true },
        { key: "brainTray", url: "/kip/partspec/toyventor_mech_brain_tray_S.stl", creaseDeg: 34, required: true },
        { key: "servoMount", url: "/kip/partspec/toyventor_mech_servo_mount_S.stl", creaseDeg: 34, required: true },
        { key: "sillDuct", url: "/kip/partspec/toyventor_mech_sill_duct_S.stl", creaseDeg: 34, required: false },
        { key: "head", url: "/kip/partspec/toyventor_robot_head_visor_S.stl", creaseDeg: 32, required: true },
        { key: "claw", url: "/kip/partspec/toyventor_kit_scoop_blade_S.stl", creaseDeg: 34, required: true },
        { key: "wheel", url: "/kip/partspec/toyventor_kit_wheel_giant_P.stl", creaseDeg: 30, required: true },
      ],
    };
  }

  const isTruck = id === "seed-truck" || sel.chassis === "truck";
  const parts: StlHeroPartSpec[] = [
    {
      key: "chassis",
      url: isTruck
        ? "/kip/partspec/toyventor_veh_truck_chassis_S.stl"
        : "/kip/partspec/toyventor_veh_car_chassis_S.stl",
      creaseDeg: 34,
      required: true,
    },
    { key: "hood", url: "/kip/partspec/toyventor_veh_car_hood_cover_S.stl", creaseDeg: 32, required: true },
    { key: "cab", url: "/kip/partspec/toyventor_veh_cab_roof_cover_S.stl", creaseDeg: 32, required: true },
    {
      key: "wheel",
      url: isTruck
        ? "/kip/partspec/toyventor_veh_wheel_offroad_P.stl"
        : "/kip/partspec/toyventor_veh_wheel_sport_P.stl",
      creaseDeg: 30,
      required: true,
    },
    {
      key: "rim",
      url: isTruck
        ? "/kip/partspec/toyventor_veh_wheel_offroad_rim.stl"
        : "/kip/partspec/toyventor_veh_wheel_sport_rim.stl",
      creaseDeg: 32,
      required: false,
    },
  ];
  if (isTruck) {
    parts.push(
      { key: "bed", url: "/kip/partspec/toyventor_veh_truck_bed_cover_S.stl", creaseDeg: 34, required: false },
      { key: "rack", url: "/kip/partspec/toyventor_racer_roof_rack_S.stl", creaseDeg: 34, required: false },
    );
  } else {
    parts.push(
      { key: "bull", url: "/kip/partspec/toyventor_racer_bull_bar_S.stl", creaseDeg: 34, required: false },
      { key: "spoiler", url: "/kip/partspec/toyventor_racer_spoiler_S.stl", creaseDeg: 34, required: false },
      { key: "light", url: "/kip/partspec/toyventor_racer_light_bar_S.stl", creaseDeg: 34, required: false },
    );
  }
  return {
    heroId: isTruck ? "seed-truck" : "seed-car",
    archetype: "vehicle",
    parts,
  };
}

/**
 * Create a stage-aligned wheel group (+X forward, +Y up, +Z right) so world.ts's
 * `w.rotation.z -= P.speed * dt / r` spins the real STL wheel around its axle.
 */
function makeStageWheel(
  tireGeo: THREE.BufferGeometry,
  rimGeo: THREE.BufferGeometry | null | undefined,
  widthMm: number,
  radiusMm: number,
  xForwardMm: number,
  yUpMm: number,
  zRightMm: number,
  tireMat: THREE.Material,
  rimMat: THREE.Material,
): THREE.Group {
  const spinGrp = new T.Group();
  spinGrp.position.set(
    xForwardMm * VEH_MM_SCALE,
    yUpMm * VEH_MM_SCALE,
    zRightMm * VEH_MM_SCALE,
  );
  spinGrp.userData.r = Math.max(0.18, radiusMm * VEH_MM_SCALE);

  const scaled = new T.Group();
  scaled.scale.setScalar(VEH_MM_SCALE);
  const flip = zRightMm >= 0 ? 1 : -1;
  const orient = new T.Group();
  if (flip < 0) orient.rotation.y = Math.PI;

  const tire = new T.Mesh(tireGeo, tireMat);
  tire.castShadow = true;
  tire.receiveShadow = true;
  tire.position.z = -widthMm * 0.5;
  orient.add(tire);

  if (rimGeo) {
    const rim = new T.Mesh(rimGeo, rimMat);
    rim.castShadow = true;
    rim.receiveShadow = true;
    rim.position.z = -widthMm * 0.5;
    rim.scale.set(1.004, 1.004, 1.005);
    orient.add(rim);
  }

  scaled.add(orient);
  spinGrp.add(scaled);
  return spinGrp;
}

function applyCharacterStlRig(
  rig: ToyRig,
  geos: Record<string, THREE.BufferGeometry>,
  sel: RigSel,
  col: RigColors,
): void {
  for (const slot of Object.values(rig.slots)) {
    disposeSlotChildren(slot);
  }
  rig.wheels.length = 0;
  rig.legs.length = 0;
  rig.arms.length = 0;
  rig.feet.length = 0;
  rig.eyes.length = 0;
  rig.wings.length = 0;
  rig.spinners = [];
  rig.flames = [];
  rig.brows = [];
  rig.cape = undefined;
  rig.tail = undefined;

  const shellMat = plastic("#f4efe6", { roughness: 0.48, clearcoat: 0.25 });
  const c1Mat = paintMat(col.c1);
  const c2Mat = paintMat(col.c2);
  const skinMat = plastic(col.skin || "#f2b98c", { roughness: 0.55, clearcoat: 0.12 });
  const sparkMat = plastic("#ff6b4a", { roughness: 0.34, clearcoat: 0.42 });

  // The human Kip (the Figure Pal head, the game's stock toy) is dressed the way the Kip demo dresses him (kipLook.ts): bare skin on the arms (short sleeves), hands and neck, the shirt
  // on the torso, the pants on the legs. The other heads keep the old cream arms and hands.
  const headSpec = resolveCharacterHeadSpec(sel);
  const human = headSpec.mode === "human";
  const body = kipBodyColors(col);
  const limbMat = human ? plastic(body.arms, { roughness: 0.55, clearcoat: 0.12 }) : shellMat;
  const neckMat = human ? plastic(body.neck, { roughness: 0.55, clearcoat: 0.12 }) : sparkMat;
  // the boots: the shared orange spark material unless the child chose another colour ("Dress your Kip", col.boots)
  const bootMat = human && body.boots !== KIP_BOOT_HEX ? plastic(body.boots, { roughness: 0.34, clearcoat: 0.42 }) : sparkMat;

  const baseSlot = rig.slots.base ?? new T.Group();
  // Stage forward is +X; CAD forward is +Z -> rotate +PI/2 on Y, scaled to stage units.
  const kipFrame = new T.Group();
  kipFrame.rotation.y = Math.PI / 2;
  kipFrame.scale.setScalar(KIP_MM_SCALE);
  baseSlot.add(kipFrame);

  const torsoGrp = new T.Group();
  torsoGrp.add(scadMesh(geos.torso!, c1Mat));
  kipFrame.add(torsoGrp);
  rig.body = torsoGrp;
  rig.mixHipY = KIP_HIP_MM * KIP_MM_SCALE;

  // Articulated arms in stage-aligned holders so world.ts walk swing (rotation.z) swings forward/back along +X!
  const snapArms: SnapArmHandles[] = [];
  const snapLegs: SnapLegHandles[] = [];
  const grips: THREE.Object3D[] = [];
  for (const side of [1, -1] as const) {
    const swingHolder = new T.Group();
    swingHolder.position.set(0, 95 * KIP_MM_SCALE, -side * 18.2 * KIP_MM_SCALE);
    baseSlot.add(swingHolder);

    const armCad = new T.Group();
    armCad.rotation.y = Math.PI / 2;
    armCad.scale.setScalar(KIP_MM_SCALE);
    // The Snap fake rigging (runtime/snapFlex.ts, ported from the Kip bench): the one-piece sleeve bends at the elbow when a clip says so, and the hand rides the end of the
    // bent sleeve. At rest nothing is bent, so this is the rigid arm it always was. The flex mesh carries its own upright pose and placement (no rotation, no offset here).
    const flexArm = makeFlexLimb(geos.snapArm!, SNAP_ARM_FLEX.offsetY, SNAP_ARM_FLEX.midY, SNAP_ARM_FLEX.midZ, SNAP_ARM_FLEX.band);
    const armMesh = new T.Mesh(flexArm.geometry, limbMat);
    armMesh.castShadow = true;
    armMesh.receiveShadow = true;
    armCad.add(armMesh);

    const foreJoint = new T.Group(); // the bent sleeve's end
    foreJoint.position.set(0, -35.0, 3.8);
    foreJoint.quaternion.copy(SNAP_CUFF_Q);
    armCad.add(foreJoint);
    { const wb = ballJoint(limbMat, "wrist"); wb.position.y = -1.5; foreJoint.add(wb); }      // the ball the hand turns on, just past the sleeve's end (so it shows in the cuff)
    const handJoint = new T.Group();
    handJoint.position.set(0, -0.5, 0);
    foreJoint.add(handJoint);
    const handRest = new T.Group();
    handRest.rotation.y = -side * (Math.PI / 2);
    handJoint.add(handRest);
    const handWrap = new T.Group();
    handWrap.position.y = -0.8;
    handWrap.rotation.z = Math.PI;
    handWrap.add(scadMesh(side === 1 ? geos.handL! : geos.handR!, limbMat));
    handRest.add(handWrap);
    // Between the holder and the sleeve: nothing at rest. When a clip bends the elbow the holder goes with the hand (so what Kip holds goes with it) and this undoes that for the sleeve.
    const handCounter = new T.Group();
    handCounter.add(armCad);
    swingHolder.add(handCounter);
    snapArms.push({ flex: flexArm, fore: foreJoint, hand: handJoint, follow: makeHandFollow(swingHolder, handCounter, handJoint) });
    rig.arms.push(swingHolder);
    // The grip: where a fist closes on a handle, a child of the hand (so it goes wherever the hand does, bent wrist and all), turned and scaled to match the arm holder's own frame
    // (y down the arm, +x forward, world units), which is the frame every held item's numbers are written in (heldItems.ts). Dan, 2026-11-04: "holding props is often in the wrong orientation":
    // the items used to hang off the arm holder 0.4 to 0.5 units down the arm, which is the middle of the sleeve now that the arm is a one-piece Snap sleeve (the fist is 0.85 down).
    swingHolder.updateMatrixWorld(true);
    const grip = new T.Group();
    const handInHolder = new T.Matrix4().copy(swingHolder.matrixWorld).invert().multiply(handJoint.matrixWorld);
    new T.Matrix4().copy(handInHolder).invert().multiply(new T.Matrix4().makeTranslation(FIST_IN_HOLDER.x, FIST_IN_HOLDER.y, side === 1 ? FIST_IN_HOLDER.z : -FIST_IN_HOLDER.z)).decompose(grip.position, grip.quaternion, grip.scale);
    grip.userData.grip = true;
    handJoint.add(grip);
    grips.push(grip);
  }
  rig.grips = grips;
  // The shoulder and hip balls, fixed to the body: the sleeve and the trouser leg turn about them. In the body's own CAD frame (mm, floor at 0): the shoulder pivot is 17.2 out and 33.5 above the hips
  // (the ball 1 mm further out, where the sleeve's top is), the hip 10.8 out at the hips' own height.
  for (const side of [1, -1] as const) {
    const sb = ballJoint(limbMat, "shoulder");
    sb.position.set(side * 18.2, KIP_HIP_MM + 33.5, 0);
    kipFrame.add(sb);
    const hb = ballJoint(c2Mat, "hip");
    hb.position.set(side * 10.8, KIP_HIP_MM, 0);
    kipFrame.add(hb);
  }

  // Articulated legs + sneaker boots wired to rig.feet for vertical walk step
  const bootsSlot = rig.slots.boots ?? baseSlot;
  for (const side of [1, -1] as const) {
    const footHolder = new T.Group();
    footHolder.position.set(0, 0, -side * 10.8 * KIP_MM_SCALE);
    bootsSlot.add(footHolder);

    // The leg hangs from a hip pivot (61.5 mm up) nested in footHolder, so the Mixamo driver can swing it from the
    // hip while the legacy walk still lifts footHolder. At rest the pivot is identity and nothing moves.
    const hipHolder = new T.Group();
    hipHolder.position.y = KIP_HIP_MM * KIP_MM_SCALE;
    footHolder.add(hipHolder);
    footHolder.userData.hip = hipHolder;
    const legCad = new T.Group();
    legCad.rotation.y = Math.PI / 2;
    legCad.scale.setScalar(KIP_MM_SCALE);
    legCad.position.y = -KIP_HIP_MM * KIP_MM_SCALE;

    // The Snap fake rigging again (runtime/snapFlex.ts): `hipCad` is the bench's upLeg frame (the hip pivot), the one-piece trouser leg bends at the knee, and the foot rides the end
    // of the bent leg. At rest nothing is bent: the boot sits where it always did, on the floor under the hip (hip-relative (0, -61.5, 2)).
    const hipCad = new T.Group();
    hipCad.position.y = KIP_HIP_MM;
    legCad.add(hipCad);
    const flexLeg = makeFlexLimb(geos.snapLeg!, SNAP_LEG_FLEX.offsetY, SNAP_LEG_FLEX.midY, SNAP_LEG_FLEX.midZ, SNAP_LEG_FLEX.band);
    const legMesh = new T.Mesh(flexLeg.geometry, c2Mat);
    legMesh.castShadow = true;
    legMesh.receiveShadow = true;
    hipCad.add(legMesh);

    const lowerJoint = new T.Group(); // the bent leg's end
    lowerJoint.position.set(0, -39.2, 0);
    hipCad.add(lowerJoint);
    lowerJoint.add(ballJoint(limbMat, "ankle"));      // the ball the boot turns on, at the leg's end (a bare ankle between the trouser and the boot)
    const footJoint = new T.Group();
    footJoint.position.set(0, -0.4, -1.5);
    lowerJoint.add(footJoint);
    const bootMesh = scadMesh(geos.boot!, bootMat);
    bootMesh.position.set(0, -KIP_HIP_MM + 39.6, 2.0 + 1.5); // = (0, -21.9, 3.5): puts the boot's origin at (0, -61.5, 2) from the hip at rest
    footJoint.add(bootMesh);
    snapLegs.push({ flex: flexLeg, lower: lowerJoint, foot: footJoint, boot: bootMesh });

    hipHolder.add(legCad);
    rig.feet.push(footHolder);
  }
  // the handles the Mixamo driver poses the Snap limbs with (left first, as rig.arms and rig.feet)
  rig.snap = { arms: [snapArms[0]!, snapArms[1]!], legs: [snapLegs[0]!, snapLegs[1]!] } satisfies SnapRigHandles;
  if (sel.boots === "robot.legs.hover") {
    rig.hover = true;
  }

  // Head assembly
  const headPivot = new T.Group();
  headPivot.position.set(0, 108.0, 0);
  kipFrame.add(headPivot);
  rig.head = headPivot;
  // The head turns about the foot of its neck (snapFlex.ts `hingeHead`), where the neck turret meets the torso's collar, not about its own base.
  headPivot.userData.rest = headPivot.position.clone();
  headPivot.userData.hinge = new T.Vector3(0, -NECK_FOOT_MM, 0);

  if (geos.neckTurret) {
    const ntMesh = scadMesh(geos.neckTurret, neckMat);
    ntMesh.position.y = -NECK_FOOT_MM;
    headPivot.add(ntMesh);
  }

  const crownHeightMm = 32.0;
  const headMat =
    headSpec.mode === "human"
      ? skinMat
      : headSpec.mode === "robot"
        ? metal("#dce3ee")
        : c1Mat;
  headPivot.add(scadMesh(geos.headMain!, headMat));
  if (geos.faceplate) {
    // The inset plate, seated and drawn the way the Kip demo does it (kipLook.ts: its holder position, the plate turned half a turn, the face on a plane that hugs the plate).
    // Before 2026-11-04 it sat at a fixed (0, 14.3, 10.2), about 1 mm low and 1.6 mm proud of the pocket, and had no face at all.
    const fpHolder = new T.Group();
    fpHolder.position.set(0, FACEPLATE_HOLDER.y, FACEPLATE_HOLDER.z);
    const fpOrient = new T.Group();
    fpOrient.rotation.y = Math.PI;
    fpOrient.add(scadMesh(geos.faceplate, skinMat));
    fpHolder.add(fpOrient);
    const faceMat = kipFaceMaterial();
    if (faceMat) {
      const decal = new T.Mesh(buildFaceDecalGeometry(geos.faceplate), faceMat);
      decal.renderOrder = 2;
      decal.userData.kipFace = true;
      fpHolder.add(decal);
    }
    headPivot.add(fpHolder);
  }

  // What the top of the human head wears (kipLook.ts `resolveKipTop`).
  const top = human ? characterTop(sel) : null;
  if (top && top.hair && geos.hair) {
    // The demo seats a wig with its hem at `seatY` from the head's stud plane (kip-bench.js: hairAnchor.position.y = headCrownY, each wig at its HAIR_OPTIONS seatY).
    const hairMat = plastic(col.hair || KIP_DEFAULT_HAIR_HEX, { roughness: 0.42, clearcoat: 0.22 });
    const wig = scadMesh(geos.hair, hairMat);
    wig.position.y = KID_CROWN_Y + top.hair.seatY + KIP_WIG_LIFT_MM; // lifted with the plate's seat: see KIP_WIG_LIFT_MM
    wig.userData.kipHair = true;
    headPivot.add(wig);
  }
  if (top && top.kind === "cover") {
    // No hat and no hair: the forge's smooth cover in the skin colour, over the head's two studs (kipCover.ts), sunk 0.25 mm into the head's top so no seam shows.
    const c = coverMesh();
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.BufferAttribute(c.positions, 3));
    geo.setIndex(new T.BufferAttribute(c.indices, 1));
    geo.computeVertexNormals();
    const cover = scadMesh(geo, skinMat);
    cover.position.y = KID_CROWN_Y - 0.25;
    cover.userData.kipCover = true;
    headPivot.add(cover);
  }

  // The two orange crown studs on a hat-ready wig (kip-vehicles-wardrobe.js `hairCrownBuds`: spark colour, a hair larger than the wig's own studs, `topH` above the stud plane)
  if (geos.crownBuds && human && top && top.kind === "hair" && top.hair.hatReady) {
    // The overlay is only 0.6 % larger than the head's own studs (0.03 mm out), which the game's depth buffer cannot tell apart: the skin studs won and the orange never showed.
    // A polygon offset pulls the overlay toward the camera so the orange wins, the way it does in the demo.
    const budsMat = sparkMat.clone();
    budsMat.polygonOffset = true;
    budsMat.polygonOffsetFactor = -2;
    budsMat.polygonOffsetUnits = -2;
    const buds = scadMesh(geos.crownBuds, budsMat);
    buds.scale.set(1.006, 1.01, 1.006);
    buds.position.y = KID_CROWN_Y + top.hair.topH + KIP_WIG_LIFT_MM;   // on the wig's studs (the demo sets hairCrownBuds.position.y = topH above the head's stud plane)
    buds.userData.kipBuds = true;
    headPivot.add(buds);
  }

  // Hat / Crown
  const hatSlot = rig.slots.hat ?? new T.Group();
  // The slot made by the placeholder rig hangs on the placeholder's head group, which disposeSlotChildren(base) has just taken out of the scene: a hat added there is never drawn (measured 2026-11-05:
  // wizard, crown, cap, hard hat and ranger hat all invisible on the Snap Kip). The hat is placed in rig.g's own coordinates below, so it belongs directly on rig.g.
  let hatUp: THREE.Object3D | null = hatSlot.parent;
  while (hatUp && hatUp !== rig.g) hatUp = hatUp.parent;
  if (!hatUp) rig.g.add(hatSlot);
  if (geos.hat) {
    const hatCad = new T.Group();
    hatCad.rotation.y = Math.PI / 2;
    hatCad.userData.hatCad = true;
    hatCad.scale.setScalar(KIP_MM_SCALE);
    // on a hat-ready wig the hat stacks on the wig's studs (kip-bench.js: crownAnchor.position.y = headCrownY + topH)
    const hatLift = top && top.kind === "hat" && top.hair ? top.hair.topH + KIP_WIG_LIFT_MM : 0;
    hatCad.position.set(0, (108.0 + crownHeightMm - 9.5 + hatLift) * KIP_MM_SCALE, 0);
    hatCad.add(scadMesh(geos.hat, sel.hat === "crown" ? metal("#ffd24d") : sparkMat));
    hatSlot.add(hatCad);
    rig.slots.extra = hatSlot;
  }

  // Ears / Horns
  if (geos.ears) {
    const earGrp = new T.Group();
    earGrp.position.set(0, crownHeightMm, 0);
    earGrp.add(scadMesh(geos.ears, c2Mat));
    headPivot.add(earGrp);
  }

  // Backpacks / Wings / Jetpack
  const backSlot = rig.slots.back ?? new T.Group();
  if (geos.back) {
    const backCad = new T.Group();
    backCad.rotation.y = Math.PI / 2;
    backCad.scale.setScalar(KIP_MM_SCALE);
    backCad.position.set(-14 * KIP_MM_SCALE, 78 * KIP_MM_SCALE, 0);
    const backMesh = scadMesh(geos.back, sel.back === "wings" ? plastic("#eef6ff") : c2Mat);
    backCad.add(backMesh);
    backSlot.add(backCad);
    if (sel.back === "jetpack" || sel.back === "robot.torso.jet") {
      for (const zOff of [0.16, -0.16]) {
        const flame = M(
          new T.ConeGeometry(0.08, 0.34, 12),
          glowMat("#ff9d5c", 2.2),
          -0.32,
          1.05,
          zOff,
        );
        flame.rotation.x = Math.PI;
        flame.castShadow = false;
        backSlot.add(flame);
        rig.flames.push(flame);
      }
    }
  }

  // Tail
  const tailSlot = rig.slots.tail ?? new T.Group();
  if (geos.tail) {
    const tailCad = new T.Group();
    tailCad.rotation.y = Math.PI / 2;
    tailCad.scale.setScalar(KIP_MM_SCALE);
    tailCad.position.set(-14 * KIP_MM_SCALE, 56 * KIP_MM_SCALE, 0);
    tailCad.add(scadMesh(geos.tail, c1Mat));
    tailSlot.add(tailCad);
    rig.tail = tailCad;
  }

  // Handheld Prop on right/front arm
  const propSlot = rig.slots.prop ?? new T.Group();
  if (geos.prop) {
    const mount = rig.arms[0] ?? propSlot;
    const propCad = new T.Group();
    propCad.position.set(0.24, -0.58, 0);
    propCad.scale.setScalar(KIP_MM_SCALE);
    const pm = scadMesh(geos.prop, sparkMat);
    pm.rotation.z = Math.PI / 4;
    propCad.add(pm);
    mount.add(propCad);
  }

  rig.h = 2.85;
  rig.w = 1.95;
}

function applyVehicleStlRig(
  rig: ToyRig,
  heroId: string,
  geos: Record<string, THREE.BufferGeometry>,
  col: RigColors,
): void {
  for (const slot of Object.values(rig.slots)) {
    disposeSlotChildren(slot);
  }
  rig.wheels.length = 0;
  rig.spinners = [];
  rig.flames = [];
  rig.flame = undefined;
  rig.hover = false;

  const chassisSlot = rig.slots.chassis ?? new T.Group();
  const wheelsSlot = rig.slots.wheels ?? new T.Group();
  const shellSlot = rig.slots.shell ?? new T.Group();
  const frontSlot = rig.slots.front ?? new T.Group();
  const rearSlot = rig.slots.rear ?? new T.Group();

  const c1Mat = paintMat(col.c1);
  const c2Mat = paintMat(col.c2);
  const shellCream = plastic("#f4efe6", { roughness: 0.42, clearcoat: 0.35 });
  const tireMat = matte("#1d2233");
  const alloyMat = metal("#e6ecf7");
  const goldMat = metal("#ffd24d");
  const slateMat = plastic("#2b3454", { roughness: 0.45 });

  // CAD vehicle frame (+Z forward in CAD -> +X forward on stage via rotation.y = +PI/2)
  const makeCadFrame = (slot: THREE.Group): THREE.Group => {
    const f = new T.Group();
    f.rotation.y = Math.PI / 2;
    f.scale.setScalar(VEH_MM_SCALE);
    slot.add(f);
    return f;
  };

  const bodyCad = makeCadFrame(chassisSlot);
  const shellCad = makeCadFrame(shellSlot);
  const frontCad = makeCadFrame(frontSlot);
  const rearCad = makeCadFrame(rearSlot);

  if (heroId === "seed-scooter" || heroId === "seed-motorbike") {
    const bikeY = 11.75;
    const frame = scadMesh(geos.frame!, c1Mat);
    frame.position.y = bikeY;
    bodyCad.add(frame);

    const cover = scadMesh(geos.cover!, heroId === "seed-motorbike" ? c2Mat : shellCream);
    cover.position.set(
      0,
      bikeY + (heroId === "seed-motorbike" ? 12.0 : 29.0),
      heroId === "seed-motorbike" ? 0 : 37.5,
    );
    shellCad.add(cover);

    const fork = new T.Mesh(geos.fork!, slateMat);
    fork.rotation.x = Math.PI / 2;
    fork.position.set(0, bikeY + 14.0, 20.0);
    frontCad.add(fork);

    if (geos.exhaust && heroId === "seed-motorbike") {
      const ex = scadMesh(geos.exhaust, alloyMat);
      ex.position.set(0, bikeY + 14.0, -44.0);
      rearCad.add(ex);
    }

    for (const xMm of [37.5, -37.5]) {
      const w = makeStageWheel(geos.wheel!, geos.rim, 12.0, 18.0, xMm, 18.0, 0, tireMat, alloyMat);
      wheelsSlot.add(w);
      rig.wheels.push(w);
    }
    rig.wr = 18.0 * VEH_MM_SCALE;
    rig.h = 1.9;
    rig.w = 2.7;
    return;
  }

  if (heroId === "seed-tractor") {
    const baseY = 18.0;
    const keel = scadMesh(geos.keel!, c1Mat);
    keel.position.y = baseY;
    bodyCad.add(keel);

    const cab = scadMesh(geos.cab!, GLASS);
    cab.position.set(0, baseY + 15.0, -6.0);
    shellCad.add(cab);

    const scoop = scadMesh(geos.scoop!, goldMat);
    scoop.position.set(0, baseY + 4.0, 56.0);
    frontCad.add(scoop);

    const tub = scadMesh(geos.tub!, c2Mat);
    tub.position.set(0, baseY + 14.0, -42.0);
    rearCad.add(tub);

    for (const side of [28.0, -28.0]) {
      const wf = makeStageWheel(geos.wheelFront!, null, 12.3, 18.0, 38.0, 18.0, side, tireMat, goldMat);
      const wr = makeStageWheel(geos.wheelRear!, null, 12.3, 25.0, -36.0, 25.0, side, tireMat, goldMat);
      wheelsSlot.add(wf, wr);
      rig.wheels.push(wf, wr);
    }
    rig.wr = 22.0 * VEH_MM_SCALE;
    rig.h = 2.1;
    rig.w = 3.5;
    return;
  }

  if (heroId === "seed-aeroplane") {
    const baseY = 20.0;
    const keel = scadMesh(geos.keel!, c1Mat);
    keel.position.y = baseY;
    bodyCad.add(keel);

    const cowl = scadInvertedMesh(geos.cowl!, c2Mat);
    cowl.position.set(0, baseY + 14.0, 28.0);
    shellCad.add(cowl);

    const canopy = scadInvertedMesh(geos.canopy!, GLASS);
    canopy.position.set(0, baseY + 18.0, -4.0);
    shellCad.add(canopy);

    for (const xWing of [-36.0, 36.0]) {
      const w = scadMesh(geos.wing!, shellCream);
      w.position.set(xWing, baseY + 12.0, 6.0);
      shellCad.add(w);
    }

    // Nose propeller spinning around stage X axis
    const propHolder = new T.Group();
    propHolder.position.set(66.0 * VEH_MM_SCALE, (baseY + 8.0) * VEH_MM_SCALE, 0);
    propHolder.userData = { ax: "x", sp: 16 };
    const propMesh = new T.Mesh(geos.prop!, goldMat);
    propMesh.scale.setScalar(VEH_MM_SCALE);
    propMesh.rotation.y = Math.PI / 2;
    propHolder.add(propMesh);
    frontSlot.add(propHolder);
    rig.spinners.push(propHolder);

    for (const side of [24.0, -24.0]) {
      const wl = makeStageWheel(geos.wheel!, null, 12.3, 18.0, 18.0, 18.0, side, tireMat, alloyMat);
      wheelsSlot.add(wl);
      rig.wheels.push(wl);
    }
    rig.wr = 18.0 * VEH_MM_SCALE;
    rig.h = 2.0;
    rig.w = 3.6;
    return;
  }

  if (heroId === "seed-catamaran") {
    const deckY = 18.0;
    for (const hullX of [-24.0, 24.0]) {
      const pontoon = scadMesh(geos.pontoon!, shellCream);
      pontoon.position.set(hullX, 0, 0);
      bodyCad.add(pontoon);

      const prow = scadMesh(geos.prow!, c1Mat);
      prow.position.set(hullX, 6.0, 42.0);
      frontCad.add(prow);
    }
    const keel = scadMesh(geos.keel!, c2Mat);
    keel.position.set(0, deckY, 0);
    bodyCad.add(keel);

    const bridge = scadMesh(geos.bridge!, GLASS);
    bridge.position.set(0, deckY + 14.0, 10.0);
    shellCad.add(bridge);

    if (geos.sail) {
      const sail = scadMesh(geos.sail, c1Mat);
      sail.rotation.z = Math.PI / 2;
      sail.position.set(0, deckY + 36.0, -10.0);
      rearCad.add(sail);
    }
    rig.wr = 0.3;
    rig.h = 2.3;
    rig.w = 3.5;
    return;
  }

  if (heroId === "seed-helicopter") {
    const skidsY = 18.0;
    for (const sx of [-20.0, 20.0]) {
      const skid = scadMesh(geos.skid!, slateMat);
      skid.position.set(sx, 0, 0);
      bodyCad.add(skid);
    }
    const keel = scadMesh(geos.keel!, c1Mat);
    keel.position.set(0, skidsY, 4.0);
    bodyCad.add(keel);

    const canopy = scadMesh(geos.canopy!, GLASS);
    canopy.position.set(0, skidsY + 14.0, 26.0);
    shellCad.add(canopy);

    const cowl = scadInvertedMesh(geos.cowl!, c2Mat);
    cowl.position.set(0, skidsY + 15.0, -8.0);
    shellCad.add(cowl);

    const mast = scadMesh(geos.mast!, alloyMat);
    mast.position.set(0, skidsY + 20.0, 4.0);
    shellCad.add(mast);

    if (geos.boom) {
      const boom = scadMesh(geos.boom, c1Mat);
      boom.position.set(0, skidsY + 8.0, -48.0);
      rearCad.add(boom);
    }

    const rotorHolder = new T.Group();
    rotorHolder.position.set(4.0 * VEH_MM_SCALE, (skidsY + 32.0) * VEH_MM_SCALE, 0);
    rotorHolder.userData = { ax: "y", sp: 14 };
    for (const ang of [0, Math.PI / 2]) {
      const blade = scadMesh(geos.rotor!, goldMat);
      blade.scale.setScalar(VEH_MM_SCALE * 1.25);
      blade.rotation.y = ang;
      rotorHolder.add(blade);
    }
    shellSlot.add(rotorHolder);
    rig.spinners.push(rotorHolder);
    rig.hover = true;
    rig.wr = 0.3;
    rig.h = 2.3;
    rig.w = 3.6;
    return;
  }

  if (heroId === "seed-shuttle") {
    const baseY = 18.0;
    const keel = scadMesh(geos.keel!, shellCream);
    keel.position.set(0, baseY, 0);
    bodyCad.add(keel);

    const nose = scadMesh(geos.nose!, slateMat);
    nose.position.set(0, baseY + 6.0, 52.0);
    frontCad.add(nose);

    const shroud = scadInvertedMesh(geos.shroud!, shellCream);
    shroud.position.set(0, baseY + 15.0, -4.0);
    shellCad.add(shroud);

    const canopy = scadInvertedMesh(geos.canopy!, GLASS);
    canopy.position.set(0, baseY + 18.0, 26.0);
    shellCad.add(canopy);

    for (const wx of [-34.0, 34.0]) {
      const wing = scadMesh(geos.wing!, c1Mat);
      wing.position.set(wx, baseY + 4.0, -8.0);
      bodyCad.add(wing);
    }

    for (const bx of [-16.0, 16.0]) {
      const pod = scadMesh(geos.booster!, c2Mat);
      pod.position.set(bx, baseY + 6.0, -46.0);
      rearCad.add(pod);

      const fl = M(
        new T.ConeGeometry(0.14, 0.48, 12),
        glowMat("#ff9d5c", 2.4),
        -76.0 * VEH_MM_SCALE,
        (baseY + 16.0) * VEH_MM_SCALE,
        -bx * VEH_MM_SCALE,
      );
      fl.rotation.z = Math.PI / 2;
      fl.castShadow = false;
      rearSlot.add(fl);
      rig.flames.push(fl);
    }

    if (geos.wheel) {
      for (const [fx, sz] of [
        [34.0, 0],
        [-28.0, 22.0],
        [-28.0, -22.0],
      ] as [number, number][]) {
        const w = makeStageWheel(geos.wheel, null, 12.3, 18.0, fx, 18.0, sz, tireMat, alloyMat);
        wheelsSlot.add(w);
        rig.wheels.push(w);
      }
    }
    rig.wr = 18.0 * VEH_MM_SCALE;
    rig.h = 2.2;
    rig.w = 3.8;
    return;
  }

  if (heroId === "seed-mech") {
    const baseY = 25.0;
    const keel = scadMesh(geos.keel!, slateMat);
    keel.position.set(0, baseY, 0);
    bodyCad.add(keel);

    if (geos.sillDuct) {
      const sill = scadMesh(geos.sillDuct, shellCream);
      sill.position.set(0, baseY + 12.5, 6.25);
      shellCad.add(sill);
    }

    const servoMount = scadMesh(geos.servoMount!, goldMat);
    servoMount.position.set(0, baseY + 12.5, 37.5);
    frontCad.add(servoMount);

    const driveTray = scadMesh(geos.driveTray!, c2Mat);
    driveTray.position.set(0, baseY + 12.5, -37.5);
    rearCad.add(driveTray);

    const brainTray = scadMesh(geos.brainTray!, goldMat);
    brainTray.position.set(0, baseY + 47.5, -37.5);
    shellCad.add(brainTray);

    const head = scadMesh(geos.head!, c1Mat);
    head.scale.setScalar(1.25);
    head.position.set(0, baseY + 24.0, 6.0);
    shellCad.add(head);

    const claw = scadMesh(geos.claw!, goldMat);
    claw.position.set(0, baseY + 8.0, 56.0);
    frontCad.add(claw);

    for (const [fx, sz] of [
      [34.0, 28.0],
      [34.0, -28.0],
      [-34.0, 28.0],
      [-34.0, -28.0],
    ] as [number, number][]) {
      const w = makeStageWheel(geos.wheel!, null, 12.3, 25.0, fx, 25.0, sz, tireMat, goldMat);
      wheelsSlot.add(w);
      rig.wheels.push(w);
    }
    rig.wr = 25.0 * VEH_MM_SCALE;
    rig.h = 2.6;
    rig.w = 3.6;
    return;
  }

  // Default: V2 Roadster Car (seed-car) or Hauler Truck (seed-truck)
  const isTruck = heroId === "seed-truck";
  const bodyY = isTruck ? 15.75 : 11.75;
  const wheelR = isTruck ? 22.0 : 18.0;
  const wheelW = isTruck ? 14.0 : 13.5;
  const rearZ = isTruck ? -53.125 : -43.75;

  const chassis = scadMesh(geos.chassis!, c1Mat);
  chassis.position.y = bodyY;
  bodyCad.add(chassis);

  const hood = scadMesh(geos.hood!, shellCream);
  hood.position.set(0, bodyY + (isTruck ? 18.0 : 17.5), 37.5);
  shellCad.add(hood);

  const cab = scadMesh(geos.cab!, c2Mat);
  cab.position.set(0, bodyY + (isTruck ? 26.0 : 22.5), -18.75);
  shellCad.add(cab);

  if (isTruck) {
    if (geos.bed) {
      const bed = scadMesh(geos.bed, goldMat);
      bed.position.set(0, bodyY + 15.0, -56.25);
      rearCad.add(bed);
    }
    if (geos.rack) {
      const rack = scadMesh(geos.rack, c1Mat);
      rack.position.set(0, bodyY + 34.5, -18.75);
      shellCad.add(rack);
    }
  } else {
    if (geos.bull) {
      const bull = scadMesh(geos.bull, goldMat);
      bull.position.set(0, bodyY + 15.5, 56.25);
      frontCad.add(bull);
    }
    if (geos.light) {
      const light = scadMesh(geos.light, goldMat);
      light.position.set(0, bodyY + 31.0, -18.75);
      shellCad.add(light);
    }
    if (geos.spoiler) {
      const sp = scadMesh(geos.spoiler, c2Mat);
      sp.position.set(0, bodyY + 19.0, -31.25);
      rearCad.add(sp);
    }
  }

  for (const xMm of [43.75, rearZ]) {
    for (const zSide of [24.4, -24.4]) {
      const w = makeStageWheel(
        geos.wheel!,
        geos.rim,
        wheelW,
        wheelR,
        xMm,
        wheelR,
        zSide,
        tireMat,
        isTruck ? goldMat : alloyMat,
      );
      wheelsSlot.add(w);
      rig.wheels.push(w);
    }
  }
  rig.wr = wheelR * VEH_MM_SCALE;
  rig.h = isTruck ? 2.1 : 1.85;
  rig.w = isTruck ? 3.5 : 3.2;
}

export async function upgradeRigWithStl(
  rig: ToyRig,
  opts: UpgradeRigOptions,
): Promise<boolean> {
  const recipe = resolveStlHeroRecipe(opts.type, opts.sel, opts.toyId);
  const loadedEntries = await Promise.all(
    recipe.parts.map(async (part) => {
      const geo = await loadCachedStl(part.url, part.creaseDeg, opts.fetcher);
      return [part.key, geo, part.required] as const;
    }),
  );

  if (opts.token?.cancelled) {
    return false;
  }

  const geos: Record<string, THREE.BufferGeometry> = {};
  for (const [k, geo, required] of loadedEntries) {
    if (!geo && required) {
      rig.stlMode = "procedural";
      opts.onFallback?.();
      return false;
    }
    if (geo) geos[k] = geo;
  }

  if (recipe.archetype === "character") {
    applyCharacterStlRig(rig, geos, opts.sel, opts.col);
  } else {
    applyVehicleStlRig(rig, recipe.heroId, geos, opts.col);
  }

  linearize(rig.g);
  rig.stlMode = "stl";
  rig.stlHeroId = recipe.heroId;
  opts.onReady?.(recipe.heroId);
  return true;
}
