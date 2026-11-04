// Parallax image backdrops (docs/specs/parallax-backdrops-spec.md): painted image planes behind the lane instead of a row of sphere "hills".
//
// What the camera really sees. The play camera is pitched down about 20 degrees with a 36 degree field of view, so a plane far behind the lane is only ever
// seen through a THIN horizontal slice: between the screen's top ray and the ray that grazes the ground slab's far edge. Art that is stretched to cover the
// whole lane is stretched 2 to 7 times (the mockup's first version, rejected in review). So each layer is sized from the slice, with ONE uniform scale, and
// placed from its bottom edge so every layer shares the ground line as its base.
//
// The slice is not constant: the camera distance is `clamp(view width / ..., 10, 22)` times a zoom step of 1 to 2.1, so it runs from 10 to about 46 units
// back, differs in portrait and landscape, and the title/showcase view uses an asymmetric view offset. The mockup fixed it at 10. So nothing here assumes a
// camera: every layer is laid out each frame from the live camera's own projection (its top and corner rays are unprojected onto the layer's plane).
//
// Depth without a second render pass: each layer FOLLOWS the camera with a scroll factor f < 1 (`x = laneMid + f * (camX - laneMid)`), so a layer only has
// to be as wide as the window plus (1 - f) of the camera's travel, and one undistorted image covers the lane. Far layers move slower than near ones.
//
// Fallback: the world builds its old sphere hills first and hides them only when every image has loaded. Kill the images (404, offline, a texture the GPU
// refuses) and the world is exactly what it was.
import * as THREE from "three";
import gardenFar from "./assets/garden-far-night.webp?url";
import gardenFarDay from "./assets/garden-far-day.webp?url";
import gardenMid from "./assets/garden-mid.webp?url";
import skyFarDay from "./assets/sky-far-day.webp?url";
import skyFarNight from "./assets/sky-far-night.webp?url";
import skyMid from "./assets/sky-mid.webp?url";
import beachFarDay from "./assets/beach-far-day.webp?url";
import beachFarNight from "./assets/beach-far-night.webp?url";
import beachMid from "./assets/beach-mid.webp?url";
import snowFarDay from "./assets/snow-far-day.webp?url";
import snowFarNight from "./assets/snow-far-night.webp?url";
import snowMid from "./assets/snow-mid.webp?url";
import junkFarDay from "./assets/junk-far-day.webp?url";
import junkFarNight from "./assets/junk-far-night.webp?url";
import junkMid from "./assets/junk-mid.webp?url";

export interface LayerSpec {
  id: "far" | "mid";
  url: string;
  /** World z of the plane (behind the lane props, which stand at z >= -6). */
  z: number;
  /** Scroll factor: 1 = pinned to the camera (no parallax), 0 = fixed in the world. */
  f: number;
  /** Fraction of the visible slice's height the art's whole height fills (the art is placed from its base). */
  fitFrac: number;
  /** Multiplies the art's colours; 0xffffff leaves them as painted. */
  tint: number;
  /** True for a cut-out (RGBA): drawn after the opaque things, writes no depth. The far band is opaque. */
  alpha: boolean;
}
export interface BackdropSpec {
  layers: LayerSpec[];
  /** The playable lane the camera travels along (the camera's x is clamped to it by the game). */
  laneLo: number;
  laneHi: number;
  /** World z of the ground slab's far edge: the ground line every layer sits on. */
  groundEdgeZ: number;
}

// The Garden, as approved on the mockup (Dan, 2026-11-02/03): the moonlit far band behind a hills-and-trees cut-out.
export const GARDEN_BACKDROP: BackdropSpec = {
  laneLo: 3, laneHi: 41, groundEdgeZ: -10,
  layers: [
    { id: "far", url: gardenFar, z: -34, f: 0.85, fitFrac: 1.0, tint: 0xffffff, alpha: false },
    { id: "mid", url: gardenMid, z: -22, f: 0.65, fitFrac: 0.86, tint: 0xbfc8ff, alpha: true },
  ],
};
export type Look = "day" | "night";

/**
 * One backdrop per outdoor world and look (docs/specs/environment-spec.md: two looks, day and night; worldLook.ts says which one a world is in). Every world has its own far band for each look
 * and ONE mid cut-out, lit by the look: left as painted by day, tinted cool by night (the Garden's already was: Dan approved it that way). Sky Meadow's mid is a bank of clouds with two tiny
 * islands, the Beach's dunes with palms and a hut, Snow Peak's hills with pines and an igloo, the Junkyard's piles of tyres, barrels and a crane (art: scripts/gen-backdrops.mjs). The lane, the
 * ground line and the depths are the same everywhere (every world's ground slab is the same), so a world differs only in its pictures and how much of the slice its mid fills.
 */
const worldBackdrop = (far: string, mid: string, midTint: number, midFit: number): BackdropSpec => ({
  laneLo: 3, laneHi: 41, groundEdgeZ: -10,
  layers: [
    { id: "far", url: far, z: -34, f: 0.85, fitFrac: 1.0, tint: 0xffffff, alpha: false },
    { id: "mid", url: mid, z: -22, f: 0.65, fitFrac: midFit, tint: midTint, alpha: true },
  ],
});
const NIGHT_MID = 0x9aa6e0;
export const BACKDROPS: Record<string, Record<Look, BackdropSpec>> = {
  garden: { night: GARDEN_BACKDROP, day: worldBackdrop(gardenFarDay, gardenMid, 0xffffff, 0.86) },
  sky: { day: worldBackdrop(skyFarDay, skyMid, 0xffffff, 0.5), night: worldBackdrop(skyFarNight, skyMid, NIGHT_MID, 0.5) },
  beach: { day: worldBackdrop(beachFarDay, beachMid, 0xffffff, 0.55), night: worldBackdrop(beachFarNight, beachMid, NIGHT_MID, 0.55) },
  snow: { day: worldBackdrop(snowFarDay, snowMid, 0xffffff, 0.55), night: worldBackdrop(snowFarNight, snowMid, NIGHT_MID, 0.55) },
  junk: { day: worldBackdrop(junkFarDay, junkMid, 0xffffff, 0.42), night: worldBackdrop(junkFarNight, junkMid, NIGHT_MID, 0.42) },
};
/** The backdrop of a world (its id or theme) in a look, or null: a world with no entry keeps whatever it has (the Toy Room is a flat wall by design), and so does a world with no look. */
export function backdropFor(theme: string, look: string): BackdropSpec | null {
  if (!Object.prototype.hasOwnProperty.call(BACKDROPS, theme)) return null;                  // (not the Object prototype's "toString" and friends)
  return look === "day" || look === "night" ? BACKDROPS[theme]![look] : null;
}

/** How far a layer's base hides below the ground line, so no hairline gap can show between the layer and the slab in front of it. */
export const TUCK = 0.12;
/** The plane may be this much wider than the window, a margin for the camera's smoothing and the toy's look-ahead. */
const WINDOW_MARGIN = 1.1;

export interface Slice {
  /** Height at which the screen's top ray crosses the plane. */
  top: number;
  /** Height of the ground line on the plane: the ray from the camera over the slab's far edge (y 0 at groundEdgeZ), extended to the plane. */
  ground: number;
  /** The widest span the window covers on the plane (over all four screen corners), and its centre. */
  xMin: number;
  xMax: number;
}

const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
const _o = new THREE.Vector3();
/** Where the camera's ray through the NDC point (nx, ny) crosses the plane z = planeZ, as [x, y]; null when the ray never reaches it. */
function hitPlane(camera: THREE.Camera, nx: number, ny: number, planeZ: number): [number, number] | null {
  camera.getWorldPosition(_o);
  _p.set(nx, ny, 0.5).unproject(camera);
  _d.copy(_p).sub(_o);
  if (_d.z >= -1e-9) return null;
  const t = (planeZ - _o.z) / _d.z;
  return t > 0 ? [_o.x + t * _d.x, _o.y + t * _d.y] : null;
}

/** The slice of the plane z = planeZ the camera can see, from its live projection (so it follows zoom, aspect, pitch and any view offset). */
export function visibleSlice(camera: THREE.Camera, planeZ: number, groundEdgeZ: number): Slice | null {
  camera.updateMatrixWorld();
  const top = hitPlane(camera, 0, 1, planeZ);
  if (!top) return null;
  camera.getWorldPosition(_o);
  const run = _o.z - groundEdgeZ;
  if (run <= 1e-6) return null;
  const ground = _o.y + (0 - _o.y) * ((_o.z - planeZ) / run);
  let xMin = Infinity, xMax = -Infinity;
  for (const [nx, ny] of [[-1, 1], [1, 1], [-1, -1], [1, -1]] as const) {
    const h = hitPlane(camera, nx, ny, planeZ);
    if (h) { xMin = Math.min(xMin, h[0]); xMax = Math.max(xMax, h[0]); }
  }
  if (!Number.isFinite(xMin)) return null;
  return { top: top[1], ground, xMin, xMax };
}

export interface Layout {
  /** World size of the plane, and the height of its centre. */
  width: number;
  height: number;
  centreY: number;
  /** Width of the art itself in world units; the plane is wider when the window needs more (the overflow is mirrored). */
  artWidth: number;
  /** Texture repeat and offset that centre the art and mirror the overflow on both sides (the texture wraps mirrored). */
  repeatX: number;
  offsetX: number;
}

/**
 * Size and place one layer: UNIFORM scale (a world unit per texel on both axes), the art's whole height filling `fitFrac` of the slice above the ground
 * line, its base `TUCK` under that line. `laneSpan` is how far the camera can travel; a layer that follows the camera by f needs (1 - f) of it on top of the
 * window.
 */
export function layoutLayer(slice: Slice, art: { w: number; h: number }, o: { fitFrac: number; f: number; laneSpan: number; tuck?: number }): Layout {
  const tuck = o.tuck ?? TUCK;
  const band = Math.max(slice.top - slice.ground, 0.5);
  const k = (band * o.fitFrac + tuck) / art.h;
  const artWidth = art.w * k;
  const height = art.h * k;
  const needed = (slice.xMax - slice.xMin) * WINDOW_MARGIN + (1 - o.f) * o.laneSpan;
  const width = Math.max(artWidth, needed);
  const repeatX = width / artWidth;
  return { width, height, centreY: slice.ground - tuck + height / 2, artWidth, repeatX, offsetX: (1 - repeatX) / 2 };
}

/** Where a layer's centre sits for a camera at camX: it follows the camera by f around the middle of the lane. */
export const layerX = (f: number, camX: number, laneLo: number, laneHi: number) => (laneLo + laneHi) / 2 + f * (camX - (laneLo + laneHi) / 2);

export interface LoadedArt { texture: THREE.Texture; width: number; height: number }
export type ArtLoader = (url: string) => Promise<LoadedArt>;

/** The browser's loader: a texture and the image's real size. Rejects when the image is missing or undecodable. */
export const loadArt: ArtLoader = (url) => new Promise((resolve, reject) => {
  new THREE.TextureLoader().load(url, (tex) => {
    const img = tex.image as { width: number; height: number } | undefined;
    img && img.width > 0 && img.height > 0 ? resolve({ texture: tex, width: img.width, height: img.height }) : reject(new Error(`backdrop image has no size: ${url}`));
  }, undefined, () => reject(new Error(`backdrop image failed: ${url}`)));
});

/**
 * Loaded images kept for the life of the runtime, keyed by URL. The world is rebuilt on every world change and level change; without this each rebuild
 * would re-decode the art, the old sphere hills would show for a few frames while it loaded, and then the painting would pop in. With it, a rebuild is ready
 * within the same tick (a settled promise runs before the next frame). A failed load is not kept, so the next build tries again.
 */
export type ArtCache = Map<string, Promise<LoadedArt>>;
/** Free everything the cache holds. Call once, when the runtime itself is disposed. */
export function disposeArtCache(cache: ArtCache): void {
  const all = [...cache.values()];
  cache.clear();
  for (const p of all) p.then((a) => a.texture.dispose(), () => {});
}

export interface Backdrop {
  /** True once every image has loaded and the planes are in the scene. */
  readonly ready: boolean;
  /** Lay the layers out for this frame's camera. Cheap (a few unprojections), call it every frame. */
  update(camera: THREE.PerspectiveCamera): void;
  /** Take the planes out of the scene and free their textures, geometry and materials. Safe to call twice, and while loading. */
  dispose(): void;
  readonly layers: ReadonlyArray<{ id: string; mesh: THREE.Mesh }>;
}

/**
 * Build a backdrop under `parent`. Nothing is added until EVERY image has loaded; if any fails, `onFail` runs and nothing is added (the caller keeps its
 * old scenery). `onReady` runs once, when the planes are in (the caller hides the old scenery then).
 */
export function createBackdrop(o: {
  spec: BackdropSpec;
  parent: THREE.Object3D;
  onReady?: () => void;
  onFail?: (err: unknown) => void;
  load?: ArtLoader;
  maxAnisotropy?: number;
  /** Keep loaded images here (shared by every backdrop of one runtime) instead of loading and freeing them per build. */
  cache?: ArtCache;
  /** If given, the planes are laid out for this camera the moment they are ready, before `onReady`, so there is no frame with neither the old scenery nor the new. */
  camera?: THREE.PerspectiveCamera;
}): Backdrop {
  const baseLoad = o.load ?? loadArt;
  const load: ArtLoader = (url) => {
    if (!o.cache) return baseLoad(url);
    let hit = o.cache.get(url);
    if (!hit) {
      hit = baseLoad(url);
      o.cache.set(url, hit);
      hit.catch(() => { if (o.cache!.get(url) === hit) o.cache!.delete(url); });
    }
    return hit;
  };
  const group = new THREE.Group();
  group.name = "backdrop";
  const built: Array<{ spec: LayerSpec; mesh: THREE.Mesh; tex: THREE.Texture; art: { w: number; h: number } }> = [];
  let ready = false, disposed = false;

  // A cached texture outlives this backdrop (the cache frees it); an uncached one is this backdrop's to free.
  const free = () => {
    for (const b of built) { if (!o.cache) b.tex.dispose(); b.mesh.geometry.dispose(); (b.mesh.material as THREE.Material).dispose(); }
  };
  Promise.all(o.spec.layers.map((l) => load(l.url))).then((arts) => {
    if (disposed) { if (!o.cache) for (const a of arts) a.texture.dispose(); return; }
    o.spec.layers.forEach((spec, i) => {
      const { texture, width, height } = arts[i]!;
      if (!texture.userData.backdropReady) {                  // a cached texture is set up once, not re-uploaded on every rebuild
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.MirroredRepeatWrapping;         // a too-narrow strip continues seamlessly instead of stretching
        texture.anisotropy = Math.min(4, o.maxAnisotropy ?? 4);
        texture.needsUpdate = true;
        texture.userData.backdropReady = true;
      }
      const mat = new THREE.MeshBasicMaterial({ map: texture, color: spec.tint, fog: false, transparent: spec.alpha, depthWrite: !spec.alpha, toneMapped: false });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      mesh.name = `backdrop-${spec.id}`;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;                              // scaled and moved every frame; never pop out at an edge
      mesh.raycast = () => {};                                 // a tap never lands on a painting
      mesh.userData.noPick = true;
      mesh.userData.backdrop = spec.id;
      mesh.visible = false;                                    // until the first update lays it out
      group.add(mesh);
      built.push({ spec, mesh, tex: texture, art: { w: width, h: height } });
    });
    o.parent.add(group);
    ready = true;
    if (o.camera) api.update(o.camera);
    o.onReady?.();
  }).catch((err) => { if (!disposed) o.onFail?.(err); });

  const span = o.spec.laneHi - o.spec.laneLo;
  const api: Backdrop = {
    get ready() { return ready; },
    get layers() { return built.map((b) => ({ id: b.spec.id, mesh: b.mesh })); },
    update(camera) {
      if (!ready || disposed) return;
      camera.getWorldPosition(_o);
      const camX = _o.x;
      for (const b of built) {
        const slice = visibleSlice(camera, b.spec.z, o.spec.groundEdgeZ);
        if (!slice) { b.mesh.visible = false; continue; }
        const L = layoutLayer(slice, b.art, { fitFrac: b.spec.fitFrac, f: b.spec.f, laneSpan: span });
        b.mesh.scale.set(L.width, L.height, 1);
        b.mesh.position.set(layerX(b.spec.f, camX, o.spec.laneLo, o.spec.laneHi), L.centreY, b.spec.z);
        b.tex.repeat.x = L.repeatX;
        b.tex.offset.x = L.offsetX;
        b.mesh.visible = true;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (group.parent) group.parent.remove(group);
      free();
    },
  };
  return api;
}
