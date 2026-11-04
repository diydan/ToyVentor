// The fruit basket (runtime/basket.ts): it takes fruit let go over it, counts them, fills at six and starts again.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { BASKET_MAX, COUNT_NOTES, EMPTY_S, ENTER_S, FULL_HOLD_S, basketSpot, buildBasket, createBasketCount, enterPose } from "../src/features/game/world/runtime/basket";

const fruit = (sy = 1) => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6), new THREE.MeshBasicMaterial()); m.scale.set(1.2, 1.2 * sy, 1.2); return m; };
const run = (g: THREE.Group, secs: number) => { for (let t = 0; t < secs; t += 1 / 60) g.userData.tick(t, 1 / 60); };

describe("where the fruit sit", () => {
  it("six different places, all inside the basket's width and peeking over its rim, the back row a little higher", () => {
    const spots = Array.from({ length: BASKET_MAX }, (_, i) => basketSpot(i));
    expect(new Set(spots.map((s) => s.join(","))).size).toBe(BASKET_MAX);
    for (const [x, y, z] of spots) { expect(Math.abs(x)).toBeLessThan(0.75); expect(y).toBeGreaterThan(0.45); expect(y).toBeLessThan(0.7); expect(Math.abs(z)).toBeLessThan(0.45); }
    expect(basketSpot(4)[1]).toBeGreaterThan(basketSpot(1)[1]);
    expect(basketSpot(-3)).toEqual(basketSpot(0));                                   // out of range is the nearest place, never off the basket
    expect(basketSpot(99)).toEqual(basketSpot(BASKET_MAX - 1));
  });
  it("a fruit drops in from where it was and settles at its place, smaller than it was carried", () => {
    const from = [3, 2, 1] as const, to = basketSpot(2);
    expect(enterPose(0, from, to)).toMatchObject({ x: 3, y: 2, z: 1 });
    const end = enterPose(ENTER_S, from, to);
    [end.x, end.y, end.z].forEach((v, i) => expect(v).toBeCloseTo(to[i]!, 9));
    expect(end.scale).toBeCloseTo(0.8, 6);
    expect(enterPose(99, from, to)).toEqual(end);
    expect(enterPose(-1, from, to)).toMatchObject({ x: 3, y: 2, z: 1 });
    expect(enterPose(ENTER_S / 2, from, to).y).toBeGreaterThan(Math.min(from[1], to[1]));       // a little hop on the way
  });
});

describe("the count", () => {
  it("takes fruit up to the maximum, is full, shows off, empties and starts from nothing again", () => {
    const c = createBasketCount();
    for (let i = 1; i <= BASKET_MAX; i++) { expect(c.add(), `fruit ${i}`).toBe(true); expect(c.count).toBe(i); }
    expect(c.phase).toBe("full");
    expect(c.add()).toBe(false);
    const advance = (secs: number) => { for (let t = 0; t < secs - 1e-9; t += 0.05) c.update(0.05); };       // (a step counts for at most 0.1 s)
    advance(FULL_HOLD_S - 0.1);
    expect(c.phase).toBe("full");
    advance(0.2);
    expect(c.phase).toBe("emptying");
    expect(c.add()).toBe(false);                                                    // not while the fruit are going
    advance(EMPTY_S / 2);
    expect(c.emptied).toBeGreaterThan(0.2);
    expect(c.emptied).toBeLessThan(0.8);
    for (let i = 0; i < 10; i++) c.update(0.1);
    expect(c.phase).toBe("filling");
    expect(c.count).toBe(0);
    expect(c.add()).toBe(true);
  });
  it("a bad time step changes nothing", () => {
    const c = createBasketCount(2);
    c.add(); c.add();
    c.update(Number.NaN); c.update(-5);
    expect(c.phase).toBe("full");
    c.update(Infinity);
    expect(c.phase).toBe("full");                                                   // an enormous step counts as at most a tenth of a second
  });
});

describe("the basket prop", () => {
  it("stashing a fruit moves it into the basket, keeps its own shape, counts it and says which note it made", () => {
    const root = new THREE.Group();
    const b = buildBasket(16.6, -1.2);
    root.add(b);
    const f = fruit(1.3);                                                           // a tall fruit, a pear
    root.add(f);
    f.position.set(16.9, 1.4, -0.4);
    root.updateMatrixWorld(true);
    expect(b.userData.stash(f, "pear")).toBe(true);
    expect(f.parent).toBe(b);
    expect(b.userData.count()).toBe(1);
    expect(b.userData.lastNote).toBe(COUNT_NOTES[0]);
    expect(f.position.x).toBeCloseTo(16.9 - 16.6, 6);                              // it kept its place in the world, now relative to the basket
    run(b, ENTER_S + 0.1);
    expect(f.position.toArray().map((v) => +v.toFixed(5))).toEqual(basketSpot(0).map((v) => +v.toFixed(5)));
    expect(f.scale.y / f.scale.x).toBeCloseTo(1.3, 6);                              // still tall
    expect(f.scale.x).toBeCloseTo(0.8, 5);
  });
  it("six fill it (the notes climb), the seventh is not taken, then it empties itself and takes fruit again", () => {
    const root = new THREE.Group();
    const b = buildBasket(0, 0);
    root.add(b);
    const notes: number[] = [];
    for (let i = 0; i < BASKET_MAX; i++) { const f = fruit(); root.add(f); expect(b.userData.stash(f, "apple"), `fruit ${i}`).toBe(true); notes.push(b.userData.lastNote); run(b, 0.1); }
    expect(notes).toEqual([...COUNT_NOTES]);
    const extra = fruit(); root.add(extra);
    expect(b.userData.stash(extra, "apple")).toBe(false);
    expect(extra.parent).toBe(root);                                                // it is still the caller's to drop
    run(b, FULL_HOLD_S + EMPTY_S + 0.3);
    expect(b.userData.count()).toBe(0);
    expect(b.userData.held).toHaveLength(0);
    expect(b.children.filter((c) => (c as THREE.Mesh).geometry?.type === "SphereGeometry")).toHaveLength(0);       // the fruit are gone from the scene
    const again = fruit(); root.add(again);
    expect(b.userData.stash(again, "apple")).toBe(true);
  });
  it("the number's sprite is hidden until there is a fruit and cannot be picked", () => {
    const b = buildBasket(0, 0);
    const sprite = b.children.find((c) => (c as THREE.Sprite).isSprite) as THREE.Sprite;
    expect(sprite.visible).toBe(false);
    expect(sprite.userData.noPick).toBe(true);
    const f = fruit(); new THREE.Group().add(f);
    b.userData.stash(f, "apple");
    expect(sprite.visible).toBe(true);
  });
});
