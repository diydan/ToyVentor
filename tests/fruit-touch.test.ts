// A fruit is hard to hit with a fingertip: on a phone held sideways (390 px tall) a hanging apple is 30 px across and a bush berry 20 px, and a fingertip is 44 px and up (measured in the real game with the
// landscape camera, 2026-11-04). `pickFruit` finds the fruit under the ray exactly as before; when there is none it now takes the fruit the ray passes close to, close meaning "the fruit counts as 56 px
// across" (`touchRadius`). Real three.js objects and `createPropFx`, no renderer, like prop-fruit-carry.test.ts. Rays start at the CAMERA, as a real press does (the size of the reach depends on how far
// the fruit is from where the ray starts).
import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FRUIT, FRUIT_TOUCH_PX, createPropFx, touchRadius, type PropFxDeps } from "../src/features/game/world/runtime/propReactions";
import { PROP_LANG_KEY } from "../src/lib/propSpeech";
import { resetVoiceBackoff } from "../src/lib/propVoice";

beforeEach(() => {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, String(v)), removeItem: (k: string) => void map.delete(k), clear: () => map.clear() });
  localStorage.setItem(PROP_LANG_KEY, "en");
  resetVoiceBackoff();
});

const FOV = 36, VIEW_H = 400;
/** An orchard seen by a camera about 9 units from the apples, on a canvas `viewH` px tall (null: a canvas with no height, as the other prop tests' stub; NOT undefined, a default parameter would swallow it). */
function orchard(viewH: number | null = VIEW_H) {
  const world = new THREE.Group();
  const camera = new THREE.PerspectiveCamera(FOV, 2, 0.1, 200);
  camera.position.set(5, 2, 10);
  camera.lookAt(5, 2, 0);
  camera.updateMatrixWorld(true);
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 400 }), ...(viewH === null ? {} : { clientHeight: viewH }) } as unknown as HTMLElement;
  const deps: PropFxDeps = { root: () => world, camera: () => camera, canvas, toast: () => {}, boostWindmill: () => {}, reduced: () => false, canSpeak: () => false };
  const fx = createPropFx(deps);
  const g = new THREE.Group();
  g.position.set(5, 0, 0);
  const trunk = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 2), new THREE.MeshStandardMaterial());
  trunk.position.y = 2;
  g.add(trunk);
  world.add(g);
  const inst = fx.register("tree", [g])!;
  g.updateMatrixWorld(true);
  return { fx, inst, camera };
}
type Orchard = ReturnType<typeof orchard>;
const centre = (m: THREE.Object3D) => m.getWorldPosition(new THREE.Vector3());
/** A ray from the camera through a point `down` world units below the middle of a fruit (a press under it: the other apples hang higher and to the sides, so nothing else is near). */
const pressBelow = (c: Orchard, m: THREE.Object3D, down: number) => {
  const target = centre(m).add(new THREE.Vector3(0, -down, 0));
  return new THREE.Raycaster(c.camera.position.clone(), target.sub(c.camera.position).normalize());
};
const distance = (c: Orchard, m: THREE.Object3D) => c.camera.position.distanceTo(centre(m));
const unitsPerPx = (d: number, viewH = VIEW_H) => (2 * Math.tan((FOV * Math.PI) / 360) * d) / viewH;
const apple = (c: Orchard) => c.inst.slots[1]!.mesh!;

describe("touchRadius: how big a fruit counts as", () => {
  it("is the real radius when that is already finger-sized, and grows with distance, so a far fruit is no harder to hit than a near one", () => {
    expect(touchRadius(5, 10, FOV, VIEW_H)).toBe(5);
    const near = touchRadius(0.24, 4, FOV, VIEW_H), far = touchRadius(0.24, 20, FOV, VIEW_H);
    expect(far).toBeGreaterThan(near);
    expect(far / unitsPerPx(20)).toBeCloseTo(FRUIT_TOUCH_PX / 2, 5);          // (always 56 px across on the screen)
  });
  it("is exactly the radius that makes the fruit 56 px across: an apple 10 units away on a 400 px screen is 30 px across, so it counts 1.9x as big", () => {
    const real = FRUIT.apple.r;
    expect((2 * real) / unitsPerPx(10)).toBeCloseTo(29.6, 0);                 // what the real game measured: 30 px
    expect(touchRadius(real, 10, FOV, VIEW_H)).toBeCloseTo((FRUIT_TOUCH_PX / 2) * unitsPerPx(10), 10);
    expect(touchRadius(real, 10, FOV, VIEW_H) / real).toBeCloseTo(56 / 29.6, 1);
  });
  it("a smaller screen or a wider view makes the fruit count bigger in the world (fewer pixels per unit)", () => {
    expect(touchRadius(0.24, 10, FOV, 300)).toBeGreaterThan(touchRadius(0.24, 10, FOV, 400));
    expect(touchRadius(0.24, 10, 60, VIEW_H)).toBeGreaterThan(touchRadius(0.24, 10, 36, VIEW_H));
  });
  it("a bad number gives back the real radius (no NaN, no zero, no negative reach)", () => {
    const bad: Array<[number, number, number, number]> = [[0.24, 0, FOV, VIEW_H], [0.24, -3, FOV, VIEW_H], [0.24, 10, 0, VIEW_H], [0.24, 10, FOV, 0], [0.24, NaN, FOV, VIEW_H], [0, 10, FOV, VIEW_H]];
    for (const [r, d, f, h] of bad) expect(touchRadius(r, d, f, h)).toBe(r);
  });
  it("a berry (0.17) and an apple (0.24) both come out 56 px across: the reach does not depend on the fruit's own size", () => {
    expect(touchRadius(0.17, 10, FOV, VIEW_H)).toBeCloseTo(touchRadius(0.24, 10, FOV, VIEW_H), 10);
  });
});

describe("pickFruit with a fingertip", () => {
  it("a press right on the apple still finds it (an exact hit is untouched)", () => {
    const c = orchard();
    expect(c.fx.pickFruit(pressBelow(c, apple(c), 0))?.mesh).toBe(apple(c));
  });
  it("a press a little under the apple, where the apple itself is missed, finds it: 20 px below the middle of a 30 px apple", () => {
    const c = orchard();
    const down = 20 * unitsPerPx(distance(c, apple(c)));
    expect(down).toBeGreaterThan(FRUIT.apple.r * 1.05);                          // (a true miss: outside the real apple)
    expect(c.fx.pickFruit(pressBelow(c, apple(c), down))?.mesh).toBe(apple(c));
  });
  it("a press well away from every apple finds nothing: 40 px below is outside the 28 px reach", () => {
    const c = orchard();
    const down = 40 * unitsPerPx(distance(c, apple(c)));
    expect(c.fx.pickFruit(pressBelow(c, apple(c), down))).toBeNull();
  });
  it("the reach ends where touchRadius says: just inside finds it, just outside does not", () => {
    const c = orchard();
    const tol = touchRadius(FRUIT.apple.r, distance(c, apple(c)), FOV, VIEW_H);
    expect(c.fx.pickFruit(pressBelow(c, apple(c), tol * 0.95))?.mesh).toBe(apple(c));
    expect(c.fx.pickFruit(pressBelow(c, apple(c), tol * 1.06))).toBeNull();
  });
  it("a canvas with no height (the other prop tests' stub) keeps the old exact behaviour: the same press under the apple finds nothing", () => {
    const c = orchard(null);
    const down = 20 * unitsPerPx(distance(c, apple(c)));
    expect(c.fx.pickFruit(pressBelow(c, apple(c), down))).toBeNull();
    expect(c.fx.pickFruit(pressBelow(c, apple(c), 0))?.mesh).toBe(apple(c));
  });
  it("a fruit behind the finger's ray is not taken, even one right behind the ray's start (the ray points away from it)", () => {
    const c = orchard();
    const away = new THREE.Raycaster(c.camera.position.clone(), new THREE.Vector3(0, 0, 1));
    expect(c.fx.pickFruit(away)).toBeNull();
    const p = centre(apple(c));
    const justBehind = new THREE.Raycaster(p.clone().add(new THREE.Vector3(0, 0, 0.1)), new THREE.Vector3(0, 0, 1));       // starts 0.1 in front of the apple and points away
    expect(justBehind.ray.distanceToPoint(p)).toBeLessThan(FRUIT.apple.r);                                              // (the apple is "close" to the ray's start, so only the behind check refuses it)
    expect(c.fx.pickFruit(justBehind)).toBeNull();
  });
  it("a fallen fruit resting on the ground is found by a press under it too", () => {
    const c = orchard();
    c.fx.activate(c.inst);
    for (let i = 0, t = 0; i < 120; i++) { t += 1 / 60; c.fx.update(1 / 60, t); }
    const fallen = c.fx.fallers[0]!;
    const reach = touchRadius(FRUIT.apple.r, distance(c, fallen.mesh), FOV, VIEW_H);
    const down = 0.8 * reach;
    expect(down).toBeGreaterThan(FRUIT.apple.r * 1.1);                                // (a true miss of the apple itself: only the fingertip reach can find it)
    expect(c.fx.pickFruit(pressBelow(c, fallen.mesh, down))?.mesh).toBe(fallen.mesh);
    expect(c.fx.pickFruit(pressBelow(c, fallen.mesh, 1.3 * reach))).toBeNull();
  });
  it("when two fruit are both in reach, the one the press is nearer to wins", () => {
    const c = orchard(100);                                                      // a tiny 100 px screen: every pixel is 4x as many world units, so the reach spans two apples
    const a = c.inst.slots[0]!.mesh!, b = c.inst.slots[1]!.mesh!;
    const target = centre(a).lerp(centre(b), 0.25);                              // a quarter of the way from a to b
    const ray = new THREE.Raycaster(c.camera.position.clone(), target.sub(c.camera.position).normalize());
    const missA = ray.ray.distanceToPoint(centre(a)), missB = ray.ray.distanceToPoint(centre(b));
    const reach = touchRadius(FRUIT.apple.r, distance(c, a), FOV, 100);
    expect(Math.max(missA, missB)).toBeLessThan(reach);                          // (both really are in reach)
    expect(missA).toBeLessThan(missB);
    expect(c.fx.pickFruit(ray)?.mesh).toBe(a);
    const ray2 = new THREE.Raycaster(c.camera.position.clone(), centre(a).lerp(centre(b), 0.75).sub(c.camera.position).normalize());
    expect(c.fx.pickFruit(ray2)?.mesh).toBe(b);
  });
});
