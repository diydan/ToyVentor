// The world-side half of drag-to-feed, run against a REAL prop fx, a REAL three.js camera and real boxes: a child's finger path in client pixels in, fruit and toy reactions out.
import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FULL_AFTER, FULL_FOR_S } from "../src/features/game/world/runtime/fruitAppetite";
import { BITE_SECONDS, CARRY_MIN_Y, TOY_MARGIN_PX, createFeedHook, inRect, mouthOf, toyScreenRect, type FeedWorld, type ToyFx } from "../src/features/game/world/runtime/feedingHook";
import { REACTION_SECONDS } from "../src/features/game/world/runtime/fruitFeeding";
import { FRUIT, createPropFx } from "../src/features/game/world/runtime/propReactions";
import { PROP_LANG_KEY } from "../src/lib/propSpeech";
import { resetVoiceBackoff } from "../src/lib/propVoice";

beforeEach(() => {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, String(v)), removeItem: (k: string) => void map.delete(k), clear: () => map.clear(), key: () => null, length: 0 });
  localStorage.setItem(PROP_LANG_KEY, "en");
  resetVoiceBackoff();
});

const CANVAS = { left: 0, top: 0, width: 800, height: 400 };

function game(opts: { eater?: "character" | "robot" | "vehicle"; clips?: boolean; allowed?: boolean; kind?: "lemon" | "pear" | "snow" } = {}) {
  const root = new THREE.Group();
  const toast = vi.fn();
  const camera = new THREE.PerspectiveCamera(36, 2, 0.1, 200);
  camera.position.set(5, 2, 10);
  camera.lookAt(5, 2, 0);
  camera.updateMatrixWorld(true);
  const canvas = { getBoundingClientRect: () => CANVAS, setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() } as unknown as HTMLElement;
  const fx = createPropFx({ root: () => root, camera: () => camera, canvas, toast, boostWindmill: () => {}, reduced: () => false, canSpeak: () => false });
  const tree = new THREE.Group();
  tree.position.set(5, 0, 0);
  const trunk = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 2), new THREE.MeshStandardMaterial());
  trunk.position.y = 2;
  tree.add(trunk);
  root.add(tree);
  const inst = fx.register("tree", [tree])!;
  tree.updateMatrixWorld(true);

  const s = { eater: opts.eater ?? "character", clips: opts.clips ?? true, allowed: opts.allowed ?? true };
  const toyBox = new THREE.Box3(new THREE.Vector3(7.2, 0, -0.5), new THREE.Vector3(9, 2.2, 0.5));
  const ray = new THREE.Raycaster();
  const calls: string[] = [];
  const toy: ToyFx = {
    clip: (a) => { calls.push(`clip:${a}`); return s.clips; },
    hop: (h, sec) => calls.push(`hop:${h}:${sec}`),
    wobble: () => calls.push("wobble"),
    tone: (f) => calls.push(`tone:${f}`),
    spark: () => calls.push("spark"),
  };
  // The trees here only grow apples, so a test that needs another fruit relabels what the finger picked (the world's own tap would see the same kind from the mesh).
  const facade: FeedWorld["fx"] = {
    pickFruit: (r) => { const ref = fx.pickFruit(r); if (ref && opts.kind) ref.kind = opts.kind; return ref; },
    tapFruitRef: (r) => fx.tapFruitRef(r), liftFruit: (r) => fx.liftFruit(r), carryFruit: (r, p) => fx.carryFruit(r, p), dropFruit: (r) => fx.dropFruit(r), eatFruit: (r, to, secs) => fx.eatFruit(r, to, secs),
  };
  const world: FeedWorld = {
    fx: facade, canvas, camera: () => camera,
    rayAt: (x, y) => { ray.setFromCamera(new THREE.Vector2(((x - CANVAS.left) / CANVAS.width) * 2 - 1, -(((y - CANVAS.top) / CANVAS.height) * 2 - 1)), camera); return ray; },
    eater: () => s.eater,
    toyBox: () => toyBox,
    carryZ: () => 1,
    allowed: () => s.allowed,
    toy,
  };
  const hook = createFeedHook(world);
  const px = (p: THREE.Vector3) => { const v = p.clone().project(camera); return { x: CANVAS.left + (v.x * 0.5 + 0.5) * CANVAS.width, y: CANVAS.top + (-v.y * 0.5 + 0.5) * CANVAS.height }; };
  const ev = (x: number, y: number, id = 1) => ({ clientX: x, clientY: y, pointerId: id }) as PointerEvent;
  /** The apple at slot i, on screen. */
  const appleAt = (i = 1) => px(inst.slots[i]!.mesh!.getWorldPosition(new THREE.Vector3()));
  const toyCentre = () => px(new THREE.Vector3(8.1, 1.1, 0));
  /** A whole finger path from (a) to (b): press, three moves, release. */
  const drag = (a: { x: number; y: number }, b: { x: number; y: number }, id = 1) => {
    expect(hook.down(ev(a.x, a.y, id))).toBe(true);
    for (const k of [0.3, 0.6, 1]) hook.move(ev(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, id));
    hook.up(ev(b.x, b.y, id));
  };
  let now = 0;
  const frames = (seconds: number, dt = 1 / 60) => { for (let t = 0; t < seconds - 1e-9; t += dt) { now += dt; fx.update(dt, now); hook.update(dt); } };
  const hangingCount = () => inst.slots.filter((sl) => sl.mesh).length;
  return { fx, hook, world, s, toast, inst, calls, appleAt, toyCentre, px, ev, drag, frames, hangingCount, camera, canvas, toyBox };
}

describe("toyScreenRect, inRect and mouthOf", () => {
  const camera = new THREE.PerspectiveCamera(36, 2, 0.1, 200);
  camera.position.set(0, 1, 10);
  camera.lookAt(0, 1, 0);
  camera.updateMatrixWorld(true);
  const box = new THREE.Box3(new THREE.Vector3(-1, 0, -0.5), new THREE.Vector3(1, 2, 0.5));

  it("covers the toy on screen, around the middle of the canvas, and grows by the margin", () => {
    const tight = toyScreenRect(box, camera, CANVAS, 0)!;
    const wide = toyScreenRect(box, camera, CANVAS, TOY_MARGIN_PX)!;
    expect(inRect(tight, 400, 200)).toBe(true);
    expect(tight.x1 - tight.x0).toBeGreaterThan(20);
    expect(wide.x0).toBeCloseTo(tight.x0 - TOY_MARGIN_PX, 6);
    expect(wide.y1).toBeCloseTo(tight.y1 + TOY_MARGIN_PX, 6);
  });
  it("is false well away from the toy and for no rect", () => {
    const r = toyScreenRect(box, camera, CANVAS, 0);
    expect(inRect(r, 5, 5)).toBe(false);
    expect(inRect(r, 795, 395)).toBe(false);
    expect(inRect(null, 400, 200)).toBe(false);
  });
  it("is null when the box is behind the camera", () => {
    const behind = new THREE.Box3(new THREE.Vector3(-1, 0, 12), new THREE.Vector3(1, 2, 13));
    expect(toyScreenRect(behind, camera, CANVAS)).toBeNull();
  });
  it("the mouth is at the middle of the toy, near the top, on its front face", () => {
    const m = mouthOf(box);
    expect(m.x).toBe(0);
    expect(m.y).toBeCloseTo(1.6, 6);
    expect(m.z).toBe(0.5);
  });
});

describe("a press, with no movement, is a tap", () => {
  it("says the apple's name and plucks it: exactly what a tap did before drag-to-feed, now on release", () => {
    const g = game();
    const a = g.appleAt();
    expect(g.hook.down(g.ev(a.x, a.y))).toBe(true);
    expect(g.toast).not.toHaveBeenCalled();                     // not on press: a drag must not also speak
    expect(g.hangingCount()).toBe(3);
    g.hook.up(g.ev(a.x, a.y));
    expect(g.toast).toHaveBeenCalledWith("Red apple");
    expect(g.hangingCount()).toBe(2);
    expect(g.hook.state).toBe("idle");
  });

  it("a press that misses every fruit is not the hook's (the caller walks the toy or shakes the tree)", () => {
    const g = game();
    expect(g.hook.down(g.ev(20, 20))).toBe(false);
    expect(g.hook.state).toBe("idle");
  });

  it("nothing starts while the world says a feed is not allowed", () => {
    const g = game({ allowed: false });
    const a = g.appleAt();
    expect(g.hook.down(g.ev(a.x, a.y))).toBe(false);
  });

  it("captures the pointer on a fruit press and lets go on release", () => {
    const g = game();
    const a = g.appleAt();
    g.hook.down(g.ev(a.x, a.y, 7));
    expect((g.canvas.setPointerCapture as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(7);
    g.hook.up(g.ev(a.x, a.y, 7));
    expect((g.canvas.releasePointerCapture as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(7);
  });
});

describe("carrying", () => {
  it("lifts the apple off the tree under the finger, in front of the toy, and never into the ground", () => {
    const g = game();
    const a = g.appleAt();
    g.hook.down(g.ev(a.x, a.y));
    g.hook.move(g.ev(a.x + 30, a.y + 5));
    expect(g.hangingCount()).toBe(2);
    expect(g.fx.fallerCount()).toBe(1);
    const carried = g.fx.fallers[0]!;
    expect(carried.state).toBe(3);
    expect(carried.mesh.position.z).toBeCloseTo(1, 4);           // on the carry plane
    const here = g.px(carried.mesh.position);
    expect(Math.hypot(here.x - (a.x + 30), here.y - (a.y + 5))).toBeLessThan(1.5);   // under the finger (to the pixel)
    g.hook.move(g.ev(a.x + 30, 399));                            // dragged to the very bottom of the screen
    expect(carried.mesh.position.y).toBeGreaterThanOrEqual(CARRY_MIN_Y - 1e-9);
  });

  it("a fruit let go away from the toy falls and rests; nothing is eaten and no reaction plays", () => {
    const g = game();
    const a = g.appleAt();
    g.drag(a, { x: a.x - 60, y: a.y + 40 });
    expect(g.fx.fallers[0]!.state).toBe(0);
    g.frames(1.5);
    expect(g.fx.fallers[0]!.state).toBe(1);
    expect(g.calls).toEqual([]);
  });
});

describe("feeding a character", () => {
  it("a fruit released over the toy flies to its mouth and is gone, and the toy plays `eat`", () => {
    const g = game();
    g.drag(g.appleAt(), g.toyCentre());
    expect(g.fx.fallers[0]!.state).toBe(4);
    expect(g.calls).toEqual(["clip:eat"]);                       // the clip starts as the fruit starts to fly
    g.frames(BITE_SECONDS + 0.1);
    expect(g.fx.fallerCount()).toBe(0);
    expect(g.hangingCount()).toBe(2);                            // it really came off the tree
  });

  it("dropping onto the margin around the toy still counts (a child's drop is not precise)", () => {
    const g = game();
    const r = toyScreenRect(g.toyBox, g.camera, CANVAS, 0)!;
    g.drag(g.appleAt(), { x: r.x1 + TOY_MARGIN_PX * 0.5, y: (r.y0 + r.y1) / 2 });
    expect(g.calls).toEqual(["clip:eat"]);
    const g2 = game();
    g2.drag(g2.appleAt(), { x: r.x1 + TOY_MARGIN_PX * 2, y: (r.y0 + r.y1) / 2 });
    expect(g2.calls).toEqual([]);
  });

  it("with no clip to play (reduced motion), it hops happily instead", () => {
    const g = game({ clips: false });
    g.drag(g.appleAt(), g.toyCentre());
    expect(g.calls[0]).toBe("clip:eat");
    expect(g.calls.some((c) => c.startsWith("hop:"))).toBe(true);
  });

  it("the third fruit in a row fills it: eat, then a belly pat after the eat clip has finished; then it refuses and pats", () => {
    const g = game();
    for (let i = 0; i < FULL_AFTER; i++) {
      for (const sl of g.inst.slots) if (!sl.mesh) sl.regrowAt = 0.001;
      g.frames(1);                                               // regrow (the grow animation is 0.6 s)
      g.drag(g.appleAt(), g.toyCentre());
      g.frames(i < FULL_AFTER - 1 ? 3 : 0.5);
    }
    const eats = g.calls.filter((c) => c === "clip:eat");
    expect(eats).toHaveLength(FULL_AFTER);
    expect(g.calls.filter((c) => c === "clip:belly_pat")).toHaveLength(0);         // not yet: the third eat is still playing
    g.frames(REACTION_SECONDS.eat + 0.5);
    expect(g.calls.filter((c) => c === "clip:belly_pat")).toHaveLength(1);
    // the toy is full: another fruit is refused. It falls back to the ground and the toy pats its belly.
    for (const sl of g.inst.slots) if (!sl.mesh) sl.regrowAt = 0.001;
    g.frames(1);
    g.drag(g.appleAt(), g.toyCentre());
    expect(g.fx.fallers.some((f) => f.state === 0 || f.state === 1)).toBe(true);
    g.frames(0.1);
    expect(g.calls.filter((c) => c === "clip:belly_pat")).toHaveLength(2);
    expect(g.calls.filter((c) => c === "clip:eat")).toHaveLength(FULL_AFTER);        // no new bite
    // and after a little while it is hungry again
    g.frames(FULL_FOR_S + 1);
    for (const sl of g.inst.slots) if (!sl.mesh) sl.regrowAt = 0.001;
    g.frames(1);
    g.drag(g.appleAt(), g.toyCentre());
    expect(g.calls.filter((c) => c === "clip:eat")).toHaveLength(FULL_AFTER + 1);
  });

  it("a lemon makes it pull a sour face, and is still eaten", () => {
    const g = game({ kind: "lemon" });
    g.drag(g.appleAt(), g.toyCentre());
    expect(g.calls).toEqual(["clip:sour"]);
    g.frames(BITE_SECONDS + 0.1);
    expect(g.fx.fallerCount()).toBe(0);
  });

  it("something that is not food is refused: it falls back down and the toy does not eat", () => {
    const g = game({ kind: "snow" });
    g.drag(g.appleAt(), g.toyCentre());
    expect(g.calls).not.toContain("clip:eat");
    expect(g.fx.fallers[0]!.state).toBe(0);
  });
});

describe("other toys", () => {
  it("a robot crunches: three crunch sounds, three small hops and a spark", () => {
    const g = game({ eater: "robot" });
    g.drag(g.appleAt(), g.toyCentre());
    g.frames(0.6);
    expect(g.calls.filter((c) => c === "spark")).toHaveLength(1);
    expect(g.calls.filter((c) => c.startsWith("hop:"))).toHaveLength(3);
    expect(g.calls.filter((c) => c.startsWith("tone:"))).toHaveLength(3);
    expect(g.calls).not.toContain("clip:eat");
    expect(g.fx.fallerCount()).toBe(0);                          // eaten
  });

  it("a robot that is full pats its belly with hops and a sound, not with a character's clip", () => {
    const g = game({ eater: "robot" });
    for (let i = 0; i < FULL_AFTER; i++) {
      for (const sl of g.inst.slots) if (!sl.mesh) sl.regrowAt = 0.001;
      g.frames(1);
      g.drag(g.appleAt(), g.toyCentre());
      g.frames(1);
    }
    g.frames(3);                                                 // the belly pat after the third crunch
    expect(g.calls.filter((c) => c.startsWith("clip:"))).toEqual([]);
    expect(g.calls.filter((c) => c === "spark")).toHaveLength(FULL_AFTER);
    expect(g.calls.filter((c) => c.startsWith("hop:0.16"))).toHaveLength(2);
  });

  it("a vehicle declines: it shakes and honks, and the fruit is not eaten, it falls to the ground", () => {
    const g = game({ eater: "vehicle" });
    g.drag(g.appleAt(), g.toyCentre());
    expect(g.calls).toContain("wobble");
    expect(g.calls.filter((c) => c.startsWith("tone:"))).toHaveLength(2);
    expect(g.fx.fallers[0]!.state).toBe(0);                      // dropped, not eaten
    g.frames(1.5);
    expect(g.fx.fallers[0]!.state).toBe(1);
    expect(g.fx.fallerCount()).toBe(1);
  });
});

describe("interruptions", () => {
  it("cancel while carrying drops the fruit where it is; nothing is eaten", () => {
    const g = game();
    const a = g.appleAt();
    g.hook.down(g.ev(a.x, a.y));
    g.hook.move(g.ev(g.toyCentre().x, g.toyCentre().y));
    g.hook.cancel();
    expect(g.fx.fallers[0]!.state).toBe(0);
    expect(g.calls).toEqual([]);
  });

  it("reset forgets the gesture, the fullness and anything scheduled", () => {
    const g = game({ eater: "robot" });
    g.drag(g.appleAt(), g.toyCentre());                          // the robot's second and third crunch are scheduled
    g.hook.reset();
    const before = g.calls.length;
    g.frames(1);
    expect(g.calls.length).toBe(before);
    expect(g.hook.state).toBe("idle");
    expect(g.hook.appetite.isFull).toBe(false);
  });

  it("a second finger during a drag is ignored", () => {
    const g = game();
    const a = g.appleAt();
    g.hook.down(g.ev(a.x, a.y, 1));
    expect(g.hook.down(g.ev(a.x, a.y, 2))).toBe(false);
    expect(g.hook.move(g.ev(a.x + 40, a.y, 2))).toBe(false);
    expect(g.hook.up(g.ev(a.x + 40, a.y, 2))).toBe(false);
    expect(g.hook.state).toBe("pressed");
  });
});
