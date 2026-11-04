// Cheaper shadows: a coarse copy casts for a big rigid part, tiny meshes stop casting, foliage keeps fewer segments (runtime/shadowProxy.ts, worldScene.ts `foliageSegs`).
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { FOLIAGE_DETAIL, foliageSegs } from "../src/features/game/world/runtime/worldScene";
import {
  PROXY_MIN_TRIS, TINY_CASTER_RADIUS, clusterTriangles, lightenShadow, lowGeometry, shadowProxyOf, trimTinyCasters,
} from "../src/features/game/world/runtime/shadowProxy";

const soup = (r: number, w: number, h: number): THREE.BufferGeometry => new THREE.SphereGeometry(r, w, h).toNonIndexed();
const tris = (g: THREE.BufferGeometry): number => (g.index ? g.index.count : g.attributes.position!.count) / 3;
// A real STL part is ten to thirty thousand triangles of fine detail; a sphere has to be dense to stand in for one (a 6k sphere is already coarser than the grid, and correctly gets no copy).
const DENSE = [200, 150] as const;
const bigPart = (): THREE.Mesh => { const m = new THREE.Mesh(soup(20, ...DENSE), new THREE.MeshStandardMaterial()); m.castShadow = true; return m; };

describe("clusterTriangles", () => {
  const g = soup(10, 160, 120);
  const c = clusterTriangles(g.attributes.position!.array, null, 20 / 20, [-10, -10, -10]);

  it("keeps a small share of the triangles and nothing degenerate", () => {
    expect(c.indices.length / 3).toBeLessThan(tris(g) * 0.15);
    expect(c.indices.length / 3).toBeGreaterThan(500); // still a recognisable ball, not a lump
    for (let i = 0; i < c.indices.length; i += 3) {
      const a = c.indices[i]!, b = c.indices[i + 1]!, d = c.indices[i + 2]!;
      expect(a !== b && b !== d && a !== d).toBe(true);
    }
  });
  it("only uses vertices that exist, and every vertex is a real number inside the part's box (a cell wide)", () => {
    const n = c.positions.length / 3;
    for (const i of c.indices) expect(i).toBeLessThan(n);
    for (const v of c.positions) { expect(Number.isFinite(v)).toBe(true); expect(Math.abs(v)).toBeLessThanOrEqual(10.001); }
  });
  it("keeps the winding: every kept triangle still faces outwards on a sphere", () => {
    let outward = 0, total = 0;
    const P = (i: number) => new THREE.Vector3(c.positions[i * 3], c.positions[i * 3 + 1], c.positions[i * 3 + 2]);
    for (let i = 0; i < c.indices.length; i += 3) {
      const a = P(c.indices[i]!), b = P(c.indices[i + 1]!), d = P(c.indices[i + 2]!);
      const n = new THREE.Vector3().crossVectors(b.clone().sub(a), d.clone().sub(a));
      const mid = a.clone().add(b).add(d);
      total++; if (n.dot(mid) > 0) outward++;
    }
    expect(outward / total).toBeGreaterThan(0.95);
  });
  it("is deterministic, and an indexed mesh gives the same result as its triangle soup", () => {
    const again = clusterTriangles(g.attributes.position!.array, null, 1, [-10, -10, -10]);
    expect(Array.from(again.indices)).toEqual(Array.from(c.indices));
    const indexed = new THREE.SphereGeometry(10, 160, 120);
    const viaIndex = clusterTriangles(indexed.attributes.position!.array, indexed.index!.array, 1, [-10, -10, -10]);
    expect(viaIndex.indices.length).toBe(c.indices.length);
  });
  it("a cell as large as the part collapses everything (nothing is invented)", () => {
    expect(clusterTriangles(g.attributes.position!.array, null, 100, [-10, -10, -10]).indices.length).toBe(0);
  });
});

describe("lowGeometry", () => {
  it("leaves a small part alone and remembers the answer", () => {
    const small = soup(1, 16, 12);
    expect(tris(small)).toBeLessThan(PROXY_MIN_TRIS);
    expect(lowGeometry(small)).toBeNull();
    expect(lowGeometry(small)).toBeNull();
  });
  it("makes one coarse copy per source geometry (the loader shares geometries between rebuilds) and marks it cached so a slot clean-up does not dispose it", () => {
    const geo = soup(20, ...DENSE);
    const low = lowGeometry(geo)!;
    expect(low).not.toBeNull();
    expect(tris(low)).toBeLessThan(tris(geo) * 0.15);
    expect(lowGeometry(geo)).toBe(low);
    expect(low.userData.stlCached).toBe(true);
    expect(low.boundingSphere).not.toBeNull();
  });
});

describe("lightenShadow", () => {
  it("hands a big part's shadow to an invisible coarse copy that moves with it", () => {
    const m = bigPart();
    m.rotation.x = -Math.PI / 2;
    lightenShadow(m);
    const p = shadowProxyOf(m)!;
    expect(m.castShadow).toBe(false);
    expect(p.castShadow).toBe(true);
    expect(p.receiveShadow).toBe(false);
    expect(p.parent).toBe(m);
    expect(p.position.toArray()).toEqual([0, 0, 0]);
    expect(p.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    expect(p.scale.toArray()).toEqual([1, 1, 1]);
  });
  it("draws nothing in the colour pass and is never what a tap lands on", () => {
    const m = lightenShadow(bigPart());
    const p = shadowProxyOf(m)!;
    const mat = p.material as THREE.MeshBasicMaterial;
    expect([mat.colorWrite, mat.depthWrite, mat.depthTest]).toEqual([false, false, false]);
    expect(p.userData.noPick).toBe(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, 50), new THREE.Vector3(0, 0, -1));
    const hits: THREE.Intersection[] = [];
    p.raycast(ray, hits);
    expect(hits).toEqual([]);
  });
  it("is idempotent and leaves a small part, a non-caster and a mesh with no coarse copy alone", () => {
    const m = lightenShadow(bigPart()); lightenShadow(m);
    expect(m.children.filter((c) => c.userData.shadowProxy)).toHaveLength(1);
    const small = new THREE.Mesh(soup(1, 16, 12), new THREE.MeshBasicMaterial()); small.castShadow = true;
    lightenShadow(small);
    expect(small.castShadow).toBe(true);
    expect(shadowProxyOf(small)).toBeNull();
    const quiet = bigPart(); quiet.castShadow = false;
    lightenShadow(quiet);
    expect(shadowProxyOf(quiet)).toBeNull();
  });
  it("shares one proxy material and one coarse geometry between parts built from the same STL", () => {
    const geo = soup(20, ...DENSE);
    const mk = () => { const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial()); m.castShadow = true; return lightenShadow(m); };
    const a = shadowProxyOf(mk())!, b = shadowProxyOf(mk())!;
    expect(a.geometry).toBe(b.geometry);
    expect(a.material).toBe(b.material);
  });
});

describe("trimTinyCasters", () => {
  const mesh = (r: number, scale = 1): THREE.Mesh => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), new THREE.MeshBasicMaterial()); m.castShadow = true; m.scale.setScalar(scale); return m; };
  it("switches off what is smaller than a few shadow-map texels, counting scale and parent transforms", () => {
    const root = new THREE.Group();
    const pebble = mesh(0.05), rock = mesh(0.5), grown = mesh(0.05, 6);
    const holder = new THREE.Group(); holder.scale.setScalar(0.1); const bigInShrunk = mesh(0.5); holder.add(bigInShrunk);
    root.add(pebble, rock, grown, holder);
    expect(trimTinyCasters(root)).toBe(2);
    expect([pebble.castShadow, rock.castShadow, grown.castShadow, bigInShrunk.castShadow]).toEqual([false, true, true, false]);
  });
  it("leaves the skipped subtree (the player) and shadow proxies alone", () => {
    const root = new THREE.Group(), player = new THREE.Group();
    const stud = mesh(0.02); player.add(stud);
    const proxyHolder = lightenShadow(bigPart()); root.add(player, proxyHolder);
    const proxy = shadowProxyOf(proxyHolder)!;
    proxy.scale.setScalar(0.001); // even a proxy that looks small in world units keeps casting
    trimTinyCasters(root, player);
    expect(stud.castShadow).toBe(true);
    expect(proxy.castShadow).toBe(true);
  });
  it("the threshold is a decision, not an accident", () => {
    expect(TINY_CASTER_RADIUS).toBeGreaterThan(0.05);
    expect(TINY_CASTER_RADIUS).toBeLessThan(0.25);
  });
});

describe("foliageSegs", () => {
  it("keeps about 70 percent of the segments and never goes below 6", () => {
    expect(FOLIAGE_DETAIL).toBe(0.7);
    expect(foliageSegs(24)).toBe(17);
    expect(foliageSegs(18)).toBe(13);
    expect(foliageSegs(28)).toBe(20);
    expect(foliageSegs(6)).toBe(6);
    expect(foliageSegs(4)).toBe(6);
  });
  it("a bush sphere is about half the triangles it was", () => {
    const was = new THREE.SphereGeometry(1, 24, 18), now = new THREE.SphereGeometry(1, foliageSegs(24), foliageSegs(18));
    expect(tris(now) / tris(was)).toBeLessThan(0.55);
  });
});
