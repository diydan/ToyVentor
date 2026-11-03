import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { BUBBLE_LIFE, BUBBLE_R, BUBBLE_RISE, MAX_BUBBLES, POP_S, bubbleAlive, bubbleScale, createBubbles, spawnBubble, stepBubble } from "../src/features/game/world/runtime/bubbles";

/** A deterministic source of numbers. */
function seq(...vals: number[]) { let i = 0; return () => vals[i++ % vals.length]!; }

describe("spawnBubble", () => {
  it("starts where it was blown, with a size, rise, drift and life inside the stated ranges", () => {
    for (const v of [0, 0.37, 0.99]) {
      const b = spawnBubble({ x: 5, y: 2, z: -1 }, 1, () => v);
      expect([b.x, b.y, b.z, b.x0]).toEqual([5, 2, -1, 5]);
      expect(b.r).toBeGreaterThanOrEqual(BUBBLE_R[0]); expect(b.r).toBeLessThanOrEqual(BUBBLE_R[1]);
      expect(b.rise).toBeGreaterThanOrEqual(BUBBLE_RISE[0]); expect(b.rise).toBeLessThanOrEqual(BUBBLE_RISE[1]);
      expect(b.life).toBeGreaterThanOrEqual(BUBBLE_LIFE[0]); expect(b.life).toBeLessThanOrEqual(BUBBLE_LIFE[1]);
      expect(b.age).toBe(0);
    }
  });
  it("drifts the way it was blown", () => {
    expect(spawnBubble({ x: 0, y: 0, z: 0 }, 1, () => 0.5).drift).toBeGreaterThan(0);
    expect(spawnBubble({ x: 0, y: 0, z: 0 }, -1, () => 0.5).drift).toBeLessThan(0);
  });
  it("different draws make different bubbles", () => {
    const a = spawnBubble({ x: 0, y: 0, z: 0 }, 1, seq(0.1, 0.2, 0.3, 0.4, 0.5)), b = spawnBubble({ x: 0, y: 0, z: 0 }, 1, seq(0.9, 0.8, 0.7, 0.6, 0.5));
    expect(a.r).not.toBe(b.r);
    expect(a.rise).not.toBe(b.rise);
  });
});

describe("stepBubble", () => {
  const b0 = spawnBubble({ x: 5, y: 2, z: -1 }, 1, seq(0.5));
  it("rises at its own speed and ages, without changing the one it was given", () => {
    const copy = { ...b0 };
    const b1 = stepBubble(b0, 1);
    expect(b0).toEqual(copy);
    expect(b1.y).toBeCloseTo(2 + b0.rise, 9);
    expect(b1.age).toBe(1);
    expect(b1.z).toBe(-1);
  });
  it("sways side to side about a slowly drifting centre", () => {
    let b = b0;
    const xs: number[] = [];
    for (let i = 0; i < 300; i++) { b = stepBubble(b, 1 / 60); xs.push(b.x - b.x0); }
    expect(Math.max(...xs)).toBeGreaterThan(0.15);
    expect(Math.min(...xs)).toBeLessThan(-0.15);
    expect(Math.max(...xs.map(Math.abs))).toBeLessThanOrEqual(0.22 + 1e-9);
    expect(b.x0).toBeGreaterThan(5);                          // the centre drifted the way it was blown
  });
  it("ignores a zero, negative or NaN step", () => {
    for (const dt of [0, -1, Number.NaN]) expect(stepBubble(b0, dt)).toEqual(b0);
  });
  it("is alive until its life is over, and swells a little as it ages", () => {
    expect(bubbleAlive(b0)).toBe(true);
    expect(bubbleAlive({ ...b0, age: b0.life })).toBe(false);
    expect(bubbleScale({ ...b0, age: b0.life })).toBeGreaterThan(bubbleScale(b0));
    expect(bubbleScale({ ...b0, age: b0.life * 10 })).toBeCloseTo(b0.r * 1.25, 9);
  });
});

function world() {
  const root = new THREE.Group();
  const tones: number[] = [];
  const bubbles = createBubbles({ root: () => root, tone: (f) => { tones.push(f); }, rng: seq(0.5, 0.3, 0.7, 0.2, 0.9) });
  const run = (s: number) => { for (let t = 0; t < s - 1e-9; t += 1 / 30) bubbles.update(1 / 30); };
  /** A ray from a camera ten units in front of the point, straight at it (sprites need the ray's camera). */
  const rayFrom = (x: number, y: number, z: number) => {
    const cam = new THREE.PerspectiveCamera(36, 2, 0.1, 100);
    cam.position.set(x, y, z + 10);
    cam.lookAt(x, y, z);
    cam.updateMatrixWorld(true);
    const r = new THREE.Raycaster();
    r.setFromCamera(new THREE.Vector2(0, 0), cam);
    return r;
  };
  const rayAt = (sp: THREE.Object3D) => { sp.updateMatrixWorld(true); return rayFrom(sp.position.x, sp.position.y, sp.position.z); };
  return { root, tones, bubbles, run, rayAt, rayFrom };
}

describe("createBubbles", () => {
  it("blows the number asked for into the world, near the mouth, with a soft sound", () => {
    const w = world();
    w.bubbles.blow({ x: 10, y: 2, z: 0 }, 1, 5);
    expect(w.bubbles.count).toBe(5);
    expect(w.root.children).toHaveLength(5);
    for (const c of w.root.children) { expect(Math.abs(c.position.x - 10)).toBeLessThan(0.2); expect(Math.abs(c.position.y - 2)).toBeLessThan(0.15); }
    expect(w.tones).toHaveLength(1);
  });

  it("they rise and sway, and the ones that reach the end of their life pop quietly and leave the world", () => {
    const w = world();
    w.bubbles.blow({ x: 0, y: 1, z: 0 }, 1, 4);
    w.run(1);
    for (const c of w.root.children) expect(c.position.y).toBeGreaterThan(1.4);
    const tones = w.tones.length;
    w.run(8);
    expect(w.root.children).toHaveLength(0);
    expect(w.bubbles.count).toBe(0);
    expect(w.tones.length).toBe(tones);                      // dying of old age makes no sound
  });

  it("a tap that goes through a bubble pops it: a sound, it swells and fades, then it is gone, and the others stay", () => {
    const w = world();
    w.bubbles.blow({ x: 0, y: 1, z: 0 }, 1, 3);
    w.run(0.3);
    const target = w.root.children[1] as THREE.Sprite;
    const sizeBefore = target.scale.x, opacityBefore = target.material.opacity;
    const before = w.tones.length;
    expect(w.bubbles.popAt(w.rayAt(target))).toBe(true);
    expect(w.tones.length).toBe(before + 1);
    expect(w.bubbles.count).toBe(2);                         // already unpoppable
    w.run(POP_S / 2);
    expect(target.scale.x).toBeGreaterThan(sizeBefore);
    expect(target.material.opacity).toBeLessThan(opacityBefore);
    expect(target.material.opacity).toBeGreaterThan(0);
    w.run(POP_S);
    expect(target.parent).toBeNull();
    expect(w.root.children).toHaveLength(2);
  });

  it("a tap that misses every bubble does nothing and is not used", () => {
    const w = world();
    w.bubbles.blow({ x: 0, y: 1, z: 0 }, 1, 3);
    const miss = w.rayFrom(50, 50, 0);
    expect(w.bubbles.popAt(miss)).toBe(false);
    expect(w.bubbles.count).toBe(3);
    expect(createBubbles({ root: () => new THREE.Group(), tone: () => {} }).popAt(miss)).toBe(false);          // nothing blown at all
  });

  it("a bubble already popping cannot be popped again", () => {
    const w = world();
    w.bubbles.blow({ x: 0, y: 1, z: 0 }, 1, 1);
    const sp = w.root.children[0] as THREE.Sprite;
    expect(w.bubbles.popAt(w.rayAt(sp))).toBe(true);
    expect(w.bubbles.popAt(w.rayAt(sp))).toBe(false);
  });

  it("never holds more than MAX_BUBBLES: the oldest make room", () => {
    const w = world();
    for (let i = 0; i < 10; i++) w.bubbles.blow({ x: 0, y: 1, z: 0 }, 1, 8);
    expect(w.bubbles.count).toBeLessThanOrEqual(MAX_BUBBLES);
    expect(w.root.children.length).toBeLessThanOrEqual(MAX_BUBBLES);
  });

  it("reset removes every bubble at once", () => {
    const w = world();
    w.bubbles.blow({ x: 0, y: 1, z: 0 }, 1, 6);
    w.bubbles.reset();
    expect(w.root.children).toHaveLength(0);
    expect(w.bubbles.count).toBe(0);
  });

  it("exposes the poppable sprites (and only those)", () => {
    const w = world();
    w.bubbles.blow({ x: 0, y: 1, z: 0 }, 1, 3);
    expect(w.bubbles.sprites).toHaveLength(3);
    w.bubbles.popAt(w.rayAt(w.root.children[0]!));
    expect(w.bubbles.sprites).toHaveLength(2);
  });
});

void vi;
