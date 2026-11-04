// Cheaper shadows (Dan, 2026-11-04: "any obvious performance wins for animated scenes?", then "do all 3"). Measured on the Garden at phone size, per frame:
// the sun's shadow pass draws every caster a second time, and Kip's 13 STL parts are 126k of the scene's 358k triangles (about 35 percent of what a frame draws, shadow
// pass included), most of it for a soft blob on the ground; 488 of 513 meshes were casters, many of them pebbles and seeds a few shadow-map texels wide.
//
//   lightenShadow(mesh)  a big rigid STL part stops casting itself; a coarse copy of the same part (vertex clustering, about 4 to 8 percent of the triangles) casts for it.
//                        The copy is a child of the part at the identity transform, so it moves with the rig; it draws nothing in the colour pass (no colour, no depth).
//   trimTinyCasters(root) a mesh whose world radius is under about a shadow-map texel's worth stops casting.
//
// What it does NOT do: the flex limbs (their geometry is bent every frame by snapFlex.ts, a static copy would not bend) and anything the player can see up close
// (the visible mesh is never touched, only its shadow). The shadow is soft (PCF, radius 3) and 36 texels to a world unit, which is why a coarse copy reads the same.
import * as THREE from "three";

/** A part with fewer triangles than this keeps casting itself: the copy would save little. */
export const PROXY_MIN_TRIS = 3000;
/** Cells along the part's longest side. 28 keeps a head, a torso or a hand recognisable and lands near 4 to 8 percent of the triangles. */
export const PROXY_GRID = 28;
/** A mesh smaller than this (world radius, in world units) casts no shadow: at 1024 texels over a 28 unit frustum that is about 4 texels across. */
export const TINY_CASTER_RADIUS = 0.12;

export interface Clustered {
  positions: Float32Array;
  indices: Uint32Array;
}

/**
 * Vertex clustering on a triangle soup (indexed or not): every vertex falls in a cell of side `cell` on a grid anchored at `origin`; the vertices of one cell become one
 * vertex at their average; a triangle whose corners land in fewer than three different cells is dropped. Winding is kept. Pure, deterministic, O(n).
 */
export function clusterTriangles(
  pos: ArrayLike<number>,
  index: ArrayLike<number> | null,
  cell: number,
  origin: readonly [number, number, number] = [0, 0, 0],
): Clustered {
  const count = index ? index.length : Math.floor(pos.length / 3);
  const ids = new Map<string, number>();
  const sums: number[] = [];
  const counts: number[] = [];
  const out: number[] = [];
  const corner = new Array<number>(3);
  const inv = 1 / cell;
  for (let t = 0; t + 2 < count; t += 3) {
    for (let k = 0; k < 3; k++) {
      const v = index ? (index[t + k] as number) : t + k;
      const x = pos[v * 3] as number, y = pos[v * 3 + 1] as number, z = pos[v * 3 + 2] as number;
      const key = `${Math.floor((x - origin[0]) * inv)},${Math.floor((y - origin[1]) * inv)},${Math.floor((z - origin[2]) * inv)}`;
      let id = ids.get(key);
      if (id === undefined) { id = counts.length; ids.set(key, id); sums.push(0, 0, 0); counts.push(0); }
      const b = id * 3;
      sums[b] = (sums[b] ?? 0) + x; sums[b + 1] = (sums[b + 1] ?? 0) + y; sums[b + 2] = (sums[b + 2] ?? 0) + z; counts[id] = (counts[id] ?? 0) + 1;
      corner[k] = id;
    }
    if (corner[0] !== corner[1] && corner[1] !== corner[2] && corner[0] !== corner[2]) out.push(corner[0]!, corner[1]!, corner[2]!);
  }
  // Only the vertices a surviving triangle uses are kept.
  const remap = new Map<number, number>();
  const positions: number[] = [];
  const indices = new Uint32Array(out.length);
  for (let i = 0; i < out.length; i++) {
    const id = out[i]!;
    let n = remap.get(id);
    if (n === undefined) {
      n = remap.size; remap.set(id, n);
      const c = counts[id]!;
      positions.push(sums[id * 3]! / c, sums[id * 3 + 1]! / c, sums[id * 3 + 2]! / c);
    }
    indices[i] = n;
  }
  return { positions: new Float32Array(positions), indices };
}

const triangleCount = (g: THREE.BufferGeometry): number => (g.index ? g.index.count : g.attributes.position?.count ?? 0) / 3;

const lowCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry | null>();
/** The coarse copy of a geometry (cached per source geometry: the STL loader shares one geometry between rebuilds), or null when it would not be smaller. */
export function lowGeometry(geo: THREE.BufferGeometry): THREE.BufferGeometry | null {
  if (lowCache.has(geo)) return lowCache.get(geo) ?? null;
  let low: THREE.BufferGeometry | null = null;
  const attr = geo.attributes.position;
  if (attr && triangleCount(geo) >= PROXY_MIN_TRIS) {
    geo.computeBoundingBox();
    const b = geo.boundingBox!;
    const cell = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z) / PROXY_GRID;
    if (cell > 0) {
      const c = clusterTriangles(attr.array, geo.index ? geo.index.array : null, cell, [b.min.x, b.min.y, b.min.z]);
      if (c.indices.length >= 12 && c.indices.length / 3 < triangleCount(geo) * 0.5) {
        low = new THREE.BufferGeometry();
        low.setAttribute("position", new THREE.BufferAttribute(c.positions, 3));
        low.setIndex(new THREE.BufferAttribute(c.indices, 1));
        low.computeBoundingSphere();
        low.userData.stlCached = true; // the rig's slot clean-up must not dispose a geometry the next rebuild reuses
      }
    }
  }
  lowCache.set(geo, low);
  return low;
}

let proxyMat: THREE.MeshBasicMaterial | null = null;
/** Draws nothing (no colour, no depth) in the colour pass; the shadow pass uses its own depth material and still draws it. Double sided so a thin part leaves no hole. */
function proxyMaterial(): THREE.MeshBasicMaterial {
  return (proxyMat ??= new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false, side: THREE.DoubleSide }));
}

/** The mesh a part's shadow was handed to, if it was (for tests and the debug view). */
export const shadowProxyOf = (mesh: THREE.Object3D): THREE.Mesh | null =>
  (mesh.children.find((c) => c.userData.shadowProxy) as THREE.Mesh | undefined) ?? null;

/** A big rigid part casts through a coarse copy instead of itself. Returns the same mesh. Safe to call on any mesh; a small one, one that does not cast, or one already done is left alone. */
export function lightenShadow<M extends THREE.Mesh>(mesh: M): M {
  if (!mesh.castShadow || shadowProxyOf(mesh)) return mesh;
  const low = lowGeometry(mesh.geometry);
  if (!low) return mesh;
  const proxy = new THREE.Mesh(low, proxyMaterial());
  proxy.castShadow = true;
  proxy.receiveShadow = false;
  proxy.userData.shadowProxy = true;
  proxy.userData.noPick = true;
  proxy.raycast = () => {}; // a tap must still land on the real part
  mesh.castShadow = false;
  mesh.add(proxy);
  return mesh;
}

const _scale = new THREE.Vector3();
/**
 * Meshes under TINY_CASTER_RADIUS (world units, scale included) stop casting. Call once after a world is built, with `root` the world and `skip` the player (whose small
 * parts are part of Kip's shadow). Returns how many were switched off. Nothing visible changes except a few texels of shadow under pebbles, seeds and sparkles.
 */
export function trimTinyCasters(root: THREE.Object3D, skip?: THREE.Object3D | null, minRadius: number = TINY_CASTER_RADIUS): number {
  let off = 0;
  root.updateMatrixWorld(true);
  const visit = (o: THREE.Object3D): void => {
    if (o === skip) return;
    const m = o as THREE.Mesh;
    if (m.isMesh && m.castShadow && !o.userData.shadowProxy) {
      const g = m.geometry;
      if (!g.boundingSphere) g.computeBoundingSphere();
      const r = (g.boundingSphere?.radius ?? 0) * Math.max(...m.getWorldScale(_scale).toArray().map(Math.abs));
      if (r < minRadius) { m.castShadow = false; off++; }
    }
    for (const c of o.children) visit(c);
  };
  visit(root);
  return off;
}
