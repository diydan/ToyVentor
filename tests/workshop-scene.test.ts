// The new-player workshop dressing (runtime/workshopScene.ts): a floor, a back wall, a pegboard, a workbench and a blueprint of Kip on the wall. Pure three.js, no GL: built and measured in node.
import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import { BLUEPRINT_BLUE, WORKSHOP, buildWorkshop, disposeWorkshop, drawBlueprint } from "../src/features/game/world/runtime/workshopScene";

const meshes = (g: THREE.Object3D): THREE.Mesh[] => { const out: THREE.Mesh[] = []; g.traverse((o) => { if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh); }); return out; };
const named = (g: THREE.Object3D, n: string): THREE.Mesh[] => meshes(g).filter((m) => m.name === n);
const materialsOf = (g: THREE.Object3D): Set<THREE.Material> => new Set(meshes(g).flatMap((m) => (Array.isArray(m.material) ? m.material : [m.material])));
const g0 = globalThis as unknown as { document?: unknown };

afterEach(() => { delete g0.document; });

/** A canvas that records what is drawn on it (node has no document). */
function fakeDocument(): { calls: Array<[string, unknown[]]>; doc: unknown } {
  const calls: Array<[string, unknown[]]> = [];
  const ctx = new Proxy({}, { get: (_t, p) => (p === "measureText" ? (s: string) => ({ width: s.length * 12 }) : (...a: unknown[]) => { calls.push([String(p), a]); }), set: () => true });
  return { calls, doc: { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) } };
}

describe("buildWorkshop", () => {
  const g = buildWorkshop({ x: 10, z: 1 });
  it("is a workshop group with a good number of parts, centred on x, and marked", () => {
    expect(g.userData.workshop).toBe(true);
    expect(meshes(g).length).toBeGreaterThanOrEqual(20);
    const box = new THREE.Box3().setFromObject(g);
    expect(Math.abs((box.min.x + box.max.x) / 2 - 10)).toBeLessThan(1);
    expect(box.max.x - box.min.x).toBeGreaterThan(13.5);
  });
  it("has a floor of planks below the benchtop, a back wall behind everything and a bench with legs and props", () => {
    const floor = named(g, "floor");
    expect(floor.length).toBeGreaterThanOrEqual(10);
    const top = named(g, "benchtop")[0]!;
    const topY = new THREE.Box3().setFromObject(top).max.y;
    expect(topY).toBeCloseTo(WORKSHOP.benchTop, 5);
    for (const f of floor) expect(f.position.y).toBeLessThan(topY);
    for (const f of floor) { const m = f.material as THREE.MeshStandardMaterial; expect(m.polygonOffset).toBe(true); expect(f.position.y).toBeCloseTo(0.02, 5); }
    expect(named(g, "benchleg")).toHaveLength(4);
    for (const n of ["mug", "screwdriver", "hammer", "wrench", "saw", "pegboard", "blueprint", "wall"]) expect(named(g, n).length, n).toBeGreaterThanOrEqual(1);
  });
  it("puts nothing in front of the stage (z beyond z + 2.2) and the wall's front face at z - 4.6", () => {
    const box = new THREE.Box3().setFromObject(g);
    expect(box.max.z).toBeLessThanOrEqual(1 + 2.2);
    const wall = new THREE.Box3().setFromObject(named(g, "wall")[0]!);
    expect(wall.max.z).toBeCloseTo(1 - WORKSHOP.wallZ, 5);
  });
  it("floor, wall, pegboard and poster cast no shadow; everything receives one", () => {
    for (const n of ["floor", "wall", "pegboard", "blueprint"]) for (const m of named(g, n)) expect(m.castShadow, n).toBe(false);
    for (const m of meshes(g)) expect(m.receiveShadow).toBe(true);
  });
  it("says where the bench, the poster and the floor are, so the caller can place the pile and aim the camera", () => {
    expect(g.userData.bench).toMatchObject({ x: 10 + WORKSHOP.benchDX, z: 1 + WORKSHOP.benchDZ, topY: 1 });
    expect(g.userData.poster).toMatchObject({ x: 10 + WORKSHOP.posterDX, y: 2.6, z: 1 - 4.55, w: 4.2, h: 3 });
    expect(g.userData.floor).toMatchObject({ z0: -4, z1: 3 });
    const poster = new THREE.Box3().setFromObject(named(g, "blueprint")[0]!);
    expect(poster.max.z).toBeCloseTo(1 - 4.55, 5);
    expect(poster.max.y - poster.min.y).toBeCloseTo(3, 5);
  });
  it("two workshops share no material and no geometry", () => {
    const a = buildWorkshop({ x: 0, z: 0 }), b = buildWorkshop({ x: 0, z: 0 });
    const ma = materialsOf(a);
    for (const m of materialsOf(b)) expect(ma.has(m)).toBe(false);
    const ga = new Set(meshes(a).map((m) => m.geometry));
    for (const m of meshes(b)) expect(ga.has(m.geometry)).toBe(false);
  });
  it("uses the accent colour for the bench trim, and ignores a colour that is not a hex", () => {
    const a = buildWorkshop({ x: 0, z: 0, accent: "#52b7ff" });
    expect((named(a, "benchtrim")[0]!.material as THREE.MeshStandardMaterial).color.getHexString()).toBe("52b7ff");
    const b = buildWorkshop({ x: 0, z: 0, accent: "blue" });
    expect((named(b, "benchtrim")[0]!.material as THREE.MeshStandardMaterial).color.getHexString()).toBe("ffd24d");
  });
  it("never throws on bad input", () => {
    expect(() => buildWorkshop({ x: Number.NaN, z: Infinity })).not.toThrow();
    expect(buildWorkshop({ x: Number.NaN, z: Infinity }).userData.workshop).toBe(true);
  });
});

describe("the blueprint poster", () => {
  it("without a document is a flat blueprint-blue plane, and the group is still built", () => {
    delete g0.document;
    const g = buildWorkshop({ x: 0, z: 0 });
    const poster = named(g, "blueprint")[0]!;
    const m = poster.material as THREE.MeshBasicMaterial;
    expect(m.map).toBeNull();
    expect(m.color.getHexString()).toBe(BLUEPRINT_BLUE.slice(1));
    expect(g.userData.poster.drawn).toBe(false);
  });
  it("with a canvas is drawn and textured; the drawing has the grid, the title block saying KIP and the five labels", () => {
    const { calls, doc } = fakeDocument();
    g0.document = doc;
    const g = buildWorkshop({ x: 0, z: 0 });
    const m = named(g, "blueprint")[0]!.material as THREE.MeshBasicMaterial;
    expect(m.map).not.toBeNull();
    expect(g.userData.poster.drawn).toBe(true);
    const texts = calls.filter(([n]) => n === "fillText").map(([, a]) => String(a[0]));
    for (const t of ["KIP", "HEAD", "TORSO", "ARMS", "LEGS", "SHOES"]) expect(texts, t).toContain(t);
    expect(calls.filter(([n]) => n === "lineTo").length).toBeGreaterThan(60); // the 32 px grid, both ways
  });
  it("a canvas with no 2D context falls back to the flat poster instead of throwing", () => {
    g0.document = { createElement: () => ({ width: 0, height: 0, getContext: () => null }) };
    const g = buildWorkshop({ x: 0, z: 0 });
    expect(g.userData.poster.drawn).toBe(false);
  });
  it("a document that throws falls back too", () => {
    g0.document = { createElement: () => { throw new Error("no canvas"); } };
    expect(() => buildWorkshop({ x: 0, z: 0 })).not.toThrow();
  });
  it("drawBlueprint paints the title block in the accent colour", () => {
    const { calls, doc } = fakeDocument();
    void doc;
    const ctx = new Proxy({}, { get: (_t, p) => (p === "measureText" ? (s: string) => ({ width: s.length }) : (...a: unknown[]) => { calls.push([String(p), a]); }), set: (_t, p, v) => { calls.push([`set:${String(p)}`, [v]]); return true; } }) as unknown as CanvasRenderingContext2D;
    drawBlueprint(ctx, 1024, 768, "#52b7ff");
    expect(calls.some(([n, a]) => n === "set:fillStyle" && a[0] === "#52b7ff")).toBe(true);
  });
});

describe("disposeWorkshop", () => {
  it("removes it from its parent and disposes every geometry, material and texture once", () => {
    const { doc } = fakeDocument();
    g0.document = doc;
    const parent = new THREE.Group();
    const g = buildWorkshop({ x: 0, z: 0 });
    parent.add(g);
    const log: string[] = [];
    for (const geo of new Set(meshes(g).map((m) => m.geometry))) geo.addEventListener("dispose", () => log.push("g"));
    for (const mm of materialsOf(g)) { mm.addEventListener("dispose", () => log.push("m")); (mm as THREE.MeshBasicMaterial).map?.addEventListener("dispose", () => log.push("t")); }
    const geoCount = new Set(meshes(g).map((m) => m.geometry)).size, matCount = materialsOf(g).size;
    disposeWorkshop(g);
    expect(parent.children).not.toContain(g);
    expect(g.parent).toBeNull();
    expect(log.filter((x) => x === "g")).toHaveLength(geoCount);
    expect(log.filter((x) => x === "m")).toHaveLength(matCount);
    expect(log.filter((x) => x === "t")).toHaveLength(1);
  });
  it("does not throw on a group that is already disposed, one with no parent, or nothing at all", () => {
    const g = buildWorkshop({ x: 0, z: 0 });
    expect(() => { disposeWorkshop(g); disposeWorkshop(g); }).not.toThrow();
    expect(() => disposeWorkshop(undefined as unknown as THREE.Group)).not.toThrow();
  });
});
