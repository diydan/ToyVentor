// Drag to feed, the prop side: pick a fruit WITHOUT acting on it, lift it out of the physics, carry it, drop it or let a toy eat it
// (docs/specs/playful-interactions-spec.md section 4). Real three.js objects, no renderer, like prop-reactions.test.ts.
import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CARRY_SCALE, FRUIT, FRUIT_REST_SECONDS, createPropFx, type FruitRef, type PropFxDeps } from "../src/features/game/world/runtime/propReactions";
import { PROP_LANG_KEY } from "../src/lib/propSpeech";
import { resetVoiceBackoff } from "../src/lib/propVoice";

beforeEach(() => {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, String(v)), removeItem: (k: string) => void map.delete(k), clear: () => map.clear(), key: () => null, length: 0 });
  localStorage.setItem(PROP_LANG_KEY, "en");
  resetVoiceBackoff();
});

function orchard(over: Partial<PropFxDeps> = {}) {
  const world = new THREE.Group();
  const toast = vi.fn();
  const camera = new THREE.PerspectiveCamera(36, 2, 0.1, 200);
  camera.position.set(5, 2, 10);
  camera.lookAt(5, 2, 0);
  camera.updateMatrixWorld(true);
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 400 }) } as unknown as HTMLElement;
  const fx = createPropFx({ root: () => world, camera: () => camera, canvas, toast, boostWindmill: () => {}, reduced: () => false, canSpeak: () => false, ...over });
  const g = new THREE.Group();
  g.position.set(5, 0, 0);
  const trunk = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 2), new THREE.MeshStandardMaterial());
  trunk.position.y = 2;
  g.add(trunk);
  world.add(g);
  const inst = fx.register("tree", [g])!;
  g.updateMatrixWorld(true);
  return { fx, world, toast, inst, g };
}
const run = (fx: ReturnType<typeof createPropFx>, seconds: number, from = 0, dt = 1 / 60) => {
  let t = from;
  for (let i = 0; i < Math.round(seconds / dt); i++) { t += dt; fx.update(dt, t); }
  return t;
};
/** A ray from the camera's side straight at a point. */
const rayAtPoint = (p: THREE.Vector3) => new THREE.Raycaster(new THREE.Vector3(p.x, p.y, p.z + 8), new THREE.Vector3(0, 0, -1));
const rayAt = (m: THREE.Object3D) => rayAtPoint(m.getWorldPosition(new THREE.Vector3()));
const hanging = (inst: ReturnType<typeof orchard>["inst"]) => inst.slots.filter((s) => s.mesh).length;

/** Pick the first hanging apple. */
function pickApple(c: ReturnType<typeof orchard>): FruitRef {
  const ref = c.fx.pickFruit(rayAt(c.inst.slots[1]!.mesh!));
  expect(ref).not.toBeNull();
  return ref!;
}

describe("pickFruit: finding a fruit without acting on it", () => {
  it("finds a hanging apple and changes nothing: no speech, no pluck, nothing falls", () => {
    const c = orchard();
    const ref = pickApple(c);
    expect(ref.kind).toBe("apple");
    expect(ref.mesh).toBe(c.inst.slots[1]!.mesh);
    expect(c.toast).not.toHaveBeenCalled();
    expect(hanging(c.inst)).toBe(3);
    expect(c.fx.fallerCount()).toBe(0);
  });

  it("finds nothing on the tree away from the apples, and nothing when there is nothing", () => {
    const c = orchard();
    expect(c.fx.pickFruit(rayAtPoint(new THREE.Vector3(5, 0.3, 0)))).toBeNull();     // the foot of the trunk
    expect(createPropFx({ root: () => new THREE.Group(), camera: () => new THREE.PerspectiveCamera(), canvas: {} as HTMLElement, toast: () => {}, boostWindmill: () => {}, reduced: () => false }).pickFruit(new THREE.Raycaster())).toBeNull();
  });

  it("finds a fallen fruit resting on the ground", () => {
    const c = orchard();
    c.fx.activate(c.inst);
    run(c.fx, 2);
    const fallen = c.fx.fallers[0]!;
    expect(c.fx.pickFruit(rayAt(fallen.mesh))?.mesh).toBe(fallen.mesh);
  });

  it("tapFruitRef says the name and plucks it, exactly like tapping it did", () => {
    const c = orchard();
    c.fx.tapFruitRef(pickApple(c));
    expect(c.toast).toHaveBeenCalledWith("Red apple");
    expect(hanging(c.inst)).toBe(2);
  });
});

describe("liftFruit and carryFruit", () => {
  it("plucks a hanging apple into a carried one: the slot regrows, the ref now points at the loose mesh, and it is drawn bigger", () => {
    const c = orchard();
    const ref = pickApple(c);
    const hungMesh = ref.mesh;
    expect(c.fx.liftFruit(ref)).toBe(true);
    expect(hanging(c.inst)).toBe(2);
    expect(c.inst.slots[1]!.regrowAt).toBeGreaterThan(0);
    expect(c.fx.fallerCount()).toBe(1);
    expect(ref.mesh).not.toBe(hungMesh);
    expect(ref.mesh).toBe(c.fx.fallers[0]!.mesh);
    expect(c.fx.fallers[0]!.state).toBe(3);
    expect(ref.mesh.scale.x).toBeCloseTo(CARRY_SCALE, 6);
  });

  it("holds a fallen fruit in place of its rest: it does not fall, rest or tidy away however long it is carried", () => {
    const c = orchard();
    c.fx.activate(c.inst);
    run(c.fx, 2);
    const fallen = c.fx.fallers[0]!;
    const ref = c.fx.pickFruit(rayAt(fallen.mesh))!;
    expect(c.fx.liftFruit(ref)).toBe(true);
    expect(fallen.state).toBe(3);
    const at = new THREE.Vector3(3, 2.5, 1.2);
    c.fx.carryFruit(ref, at);
    run(c.fx, FRUIT_REST_SECONDS + 10, 2);                   // far longer than a rest
    expect(c.fx.fallerCount()).toBe(1);                      // the other fallen apple was tidied away; the carried one was not
    expect(c.fx.fallers[0]).toBe(fallen);
    expect(fallen.state).toBe(3);
    expect(fallen.mesh.position.toArray()).toEqual(at.toArray());
    expect(fallen.mesh.parent).not.toBeNull();
  });

  it("lifting a hanging apple takes THAT apple even while other fruit already lies on the ground", () => {
    const c = orchard();
    c.fx.activate(c.inst);                                   // two fall and rest
    run(c.fx, 2);
    const resting = c.fx.fallers.slice();
    expect(resting).toHaveLength(2);
    const slot = c.inst.slots.find((sl) => sl.mesh)!;
    const ref = c.fx.pickFruit(rayAt(slot.mesh!))!;
    expect(c.fx.liftFruit(ref)).toBe(true);
    expect(c.fx.fallerCount()).toBe(3);
    const carried = c.fx.fallers.find((f) => f.mesh === ref.mesh)!;
    expect(carried.state).toBe(3);
    expect(resting.includes(carried)).toBe(false);
    resting.forEach((f) => expect(f.state).toBe(1));         // the others are untouched
  });

  it("carryFruit follows the finger", () => {
    const c = orchard();
    const ref = pickApple(c);
    c.fx.liftFruit(ref);
    for (const p of [new THREE.Vector3(1, 1, 1), new THREE.Vector3(7, 3, 0.5)]) {
      c.fx.carryFruit(ref, p);
      expect(ref.mesh.position.toArray()).toEqual(p.toArray());
    }
  });

  it("a carried fruit is not pickable or tappable again (no second grab, no revived tap-hop)", () => {
    const c = orchard();
    const ref = pickApple(c);
    c.fx.liftFruit(ref);
    c.fx.carryFruit(ref, new THREE.Vector3(9, 2, 1.5));      // clear of the tree, so a ray at it meets nothing else
    c.toast.mockClear();
    expect(c.fx.pickFruit(rayAt(ref.mesh))).toBeNull();
    expect(c.fx.tap(rayAt(ref.mesh))).toBe(false);
    expect(c.toast).not.toHaveBeenCalled();
    expect(c.fx.fallers[0]!.state).toBe(3);
  });

  it("lifting a fruit that is no longer anywhere (the world was reset since the press) fails safely", () => {
    const c = orchard();
    const ref = pickApple(c);
    c.fx.reset();
    expect(c.fx.liftFruit(ref)).toBe(false);
    expect(c.fx.fallerCount()).toBe(0);
  });

  it("a fruit being carried is never evicted by the loose-fruit cap", () => {
    const c = orchard();
    const ref = pickApple(c);
    c.fx.liftFruit(ref);
    const carried = ref.mesh;
    for (let i = 0; i < 90; i++) { for (const s of c.inst.slots) if (!s.mesh) s.regrowAt = 1; run(c.fx, 0.2, i * 0.2); c.fx.activate(c.inst); }
    expect(c.fx.fallerCount()).toBeLessThanOrEqual(48);
    expect(c.fx.fallers.some((f) => f.mesh === carried && f.state === 3)).toBe(true);
    expect(carried.parent).not.toBeNull();
  });

  it("a stretched fruit keeps its stretch when lifted and when dropped (a pear is tall)", () => {
    const old = FRUIT.apple.sy;
    FRUIT.apple.sy = 1.3;
    try {
      const c = orchard();
      const ref = pickApple(c);
      expect(ref.mesh.scale.y).toBeCloseTo(1.3, 6);
      c.fx.liftFruit(ref);
      expect(ref.mesh.scale.y).toBeCloseTo(CARRY_SCALE * 1.3, 6);
      expect(ref.mesh.scale.x).toBeCloseTo(CARRY_SCALE, 6);
      c.fx.dropFruit(ref);
      expect(ref.mesh.scale.y).toBeCloseTo(1.3, 6);
      expect(ref.mesh.scale.x).toBeCloseTo(1, 6);
    } finally { FRUIT.apple.sy = old; }
  });
});

describe("dropFruit", () => {
  it("lets it fall from where it was let go, land, rest and be tidied like any other", () => {
    const c = orchard();
    const ref = pickApple(c);
    c.fx.liftFruit(ref);
    c.fx.carryFruit(ref, new THREE.Vector3(2, 3, 1));
    c.fx.dropFruit(ref);
    const f = c.fx.fallers[0]!;
    expect(f.state).toBe(0);
    expect(ref.mesh.scale.x).toBeCloseTo(1, 6);
    run(c.fx, 1.5);
    expect(f.state).toBe(1);
    expect(ref.mesh.position.y).toBeCloseTo(FRUIT.apple.r, 6);
    expect(ref.mesh.position.x).toBeCloseTo(2, 6);                       // straight down: no drift
    expect(ref.mesh.position.z).toBeCloseTo(1, 6);
    run(c.fx, FRUIT_REST_SECONDS + 1, 1.5);
    expect(c.fx.fallerCount()).toBe(0);                                  // then it is tidied
  });

  it("bounces once on landing, like a dropped apple, before it rests", () => {
    const c = orchard();
    const ref = pickApple(c);
    c.fx.liftFruit(ref);
    c.fx.carryFruit(ref, new THREE.Vector3(2, 3, 1));
    c.fx.dropFruit(ref);
    const ground = FRUIT.apple.r;
    let t = 0, landed = false, rebound = 0;
    for (let i = 0; i < 120; i++) {
      t += 1 / 60; c.fx.update(1 / 60, t);
      const y = ref.mesh.position.y;
      if (y <= ground + 1e-6) landed = true; else if (landed) rebound = Math.max(rebound, y - ground);
    }
    expect(landed).toBe(true);
    expect(rebound).toBeGreaterThan(0.01);
  });

  it("does nothing to a fruit that is not being carried", () => {
    const c = orchard();
    c.fx.activate(c.inst);
    run(c.fx, 2);
    const f = c.fx.fallers[0]!;
    const before = f.state;
    c.fx.dropFruit({ mesh: f.mesh, kind: "apple" });
    expect(f.state).toBe(before);
  });
});

describe("a fruit's own stretch survives the other things that resize it", () => {
  it("a tap-hop and the shrink-away at the end of its rest keep a pear's height", () => {
    const old = FRUIT.apple.sy;
    FRUIT.apple.sy = 1.3;
    try {
      const c = orchard();
      c.fx.activate(c.inst);
      run(c.fx, 2);
      const f = c.fx.fallers[0]!;
      expect(f.mesh.scale.y / f.mesh.scale.x).toBeCloseTo(1.3, 6);
      c.fx.tapFruitRef({ mesh: f.mesh, kind: "apple" });                  // the hop
      expect(f.mesh.scale.y / f.mesh.scale.x).toBeCloseTo(1.3, 6);
      run(c.fx, 1.5, 2);
      f.t = f.rest + 0.01;                                                // rest is over: it starts to shrink
      run(c.fx, 0.1, 3.5);
      expect(f.state).toBe(2);
      expect(f.mesh.scale.x).toBeLessThan(1);
      expect(f.mesh.scale.y / f.mesh.scale.x).toBeCloseTo(1.3, 6);
    } finally { FRUIT.apple.sy = old; }
  });
});

describe("eatFruit", () => {
  it("flies the carried fruit to the mouth, shrinking, and removes it; it is gone, not dropped", () => {
    const c = orchard();
    const ref = pickApple(c);
    c.fx.liftFruit(ref);
    c.fx.carryFruit(ref, new THREE.Vector3(1, 1, 1));
    const mouth = new THREE.Vector3(4, 3, 0.5);
    expect(c.fx.eatFruit(ref, mouth, 0.4)).toBe(true);
    const f = c.fx.fallers[0]!;
    expect(f.state).toBe(4);
    const t1 = run(c.fx, 0.2);
    expect(ref.mesh.position.distanceTo(mouth)).toBeLessThan(new THREE.Vector3(1, 1, 1).distanceTo(mouth));   // on its way
    expect(ref.mesh.position.distanceTo(mouth)).toBeGreaterThan(0.01);                                         // not there yet
    expect(ref.mesh.scale.x).toBeLessThan(CARRY_SCALE);
    expect(ref.mesh.scale.x).toBeGreaterThan(0.2);
    run(c.fx, 0.4, t1);
    expect(c.fx.fallerCount()).toBe(0);
    expect(ref.mesh.parent).toBeNull();
  });

  it("only a carried fruit can be eaten, and only once", () => {
    const c = orchard();
    const ref = pickApple(c);
    expect(c.fx.eatFruit(ref, new THREE.Vector3(), 0.3)).toBe(false);    // still hanging
    c.fx.liftFruit(ref);
    expect(c.fx.eatFruit(ref, new THREE.Vector3(), 0.3)).toBe(true);
    expect(c.fx.eatFruit(ref, new THREE.Vector3(), 0.3)).toBe(false);    // already going
  });

  it("a fruit on its way to the mouth cannot be picked or tapped back to life", () => {
    const c = orchard();
    const ref = pickApple(c);
    c.fx.liftFruit(ref);
    c.fx.carryFruit(ref, new THREE.Vector3(9, 2, 1.5));
    c.fx.eatFruit(ref, new THREE.Vector3(9, 3, 0.5), 0.5);
    run(c.fx, 0.1);
    expect(c.fx.pickFruit(rayAt(ref.mesh))).toBeNull();
    expect(c.fx.tap(rayAt(ref.mesh))).toBe(false);
    expect(c.fx.fallers[0]!.state).toBe(4);
  });

  it("reset removes a carried or eaten fruit like any other", () => {
    const c = orchard();
    const ref = pickApple(c);
    c.fx.liftFruit(ref);
    c.fx.reset();
    expect(c.fx.fallerCount()).toBe(0);
    expect(ref.mesh.parent).toBeNull();
  });
});
