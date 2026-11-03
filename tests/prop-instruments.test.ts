// The new Toy Room props' own reactions (guitar pluck, bubble pop, dog bark) and the helpers the acts use: cue, nearby, flutter, say, setVisible, and a prop that animates itself each frame.
import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tones: Array<[number, number, number, string]> = [];
vi.mock("../src/features/game/world/runtime/audio", () => ({
  sfx: new Proxy({}, { get: () => () => {} }),
  sound: false,
  tone: (f: number, delay: number, dur: number, type: string) => { tones.push([f, delay, dur, type]); },
}));

import { PROP_SPECS, createPropFx, type PropFxDeps } from "../src/features/game/world/runtime/propReactions";
import { PROP_LANG_KEY } from "../src/lib/propSpeech";
import { resetVoiceBackoff } from "../src/lib/propVoice";

beforeEach(() => {
  tones.length = 0;
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, String(v)), removeItem: (k: string) => void map.delete(k), clear: () => map.clear(), key: () => null, length: 0 });
  localStorage.setItem(PROP_LANG_KEY, "en");
  resetVoiceBackoff();
});

function room(over: Partial<PropFxDeps> = {}) {
  const world = new THREE.Group();
  const toast = vi.fn();
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 400 }) } as unknown as HTMLElement;
  const fx = createPropFx({ root: () => world, camera: () => new THREE.PerspectiveCamera(), canvas, toast, boostWindmill: () => {}, reduced: () => false, canSpeak: () => false, ...over });
  return { fx, world, toast };
}
function prop(c: ReturnType<typeof room>, type: string, x: number, kids = 1) {
  const g = new THREE.Group();
  g.position.set(x, 0, -2);
  for (let i = 0; i < kids; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(1, 0.3, 1), new THREE.MeshStandardMaterial()); m.position.y = 0.3 + i * 0.3; g.add(m); }
  c.world.add(g);
  return c.fx.register(type, [g])!;
}
const run = (fx: ReturnType<typeof createPropFx>, seconds: number, from = 0, dt = 1 / 60) => {
  let t = from;
  for (let i = 0; i < Math.round(seconds / dt); i++) { t += dt; fx.update(dt, t); }
  return t;
};

describe("the props' own reactions", () => {
  it("the specs name the guitar, the bubbles and the dog, in a colour a child would say", () => {
    expect(PROP_SPECS.guitar).toMatchObject({ noun: "guitar", color: "orange", use: "pluck" });
    expect(PROP_SPECS.bubbles).toMatchObject({ noun: "bubbles", color: "blue", use: "pop" });
    expect(PROP_SPECS.dog).toMatchObject({ noun: "dog", color: "brown", use: "bark" });
  });

  it("a tap on the guitar plucks a three-note chord, going up", () => {
    const c = room();
    c.fx.activate(prop(c, "guitar", 5));
    const chord = tones.slice(1);                                        // (every tap first plays the prop's little chirp)
    expect(chord.map((t) => t[0])).toEqual([262, 330, 392]);
    expect(chord[1]![1]).toBeGreaterThan(chord[0]![1]);
    expect(chord.every((t) => t[3] === "triangle")).toBe(true);
    expect(c.toast).toHaveBeenCalledWith("Orange guitar");
  });

  it("a tap on the bubble set pops a bubble", () => {
    const c = room();
    c.fx.activate(prop(c, "bubbles", 5));
    const pop = tones.slice(1);
    expect(pop).toHaveLength(1);
    expect(pop[0]![0]).toBeGreaterThan(700);
    expect(c.toast).toHaveBeenCalledWith("Blue bubbles");
  });

  it("a tap on the dog is two woofs, and tells the dog (so it hops and wags)", () => {
    const c = room();
    const d = prop(c, "dog", 5);
    run(c.fx, 1, 0);
    c.fx.activate(d);
    const woofs = tones.slice(1);
    expect(woofs.map((t) => t[3])).toEqual(["sawtooth", "sawtooth"]);
    expect(woofs[1]![1]).toBeGreaterThan(0.1);
    expect(d.holder.userData.cue).toEqual({ name: "bark", at: expect.closeTo(1, 6) });
    expect(c.toast).toHaveBeenCalledWith("Brown dog");
  });
});

describe("cue and the self-animating prop", () => {
  it("calls the holder's own tick every frame with the clock and the step, and a cue carries the clock it was given at", () => {
    const c = room();
    const d = prop(c, "dog", 5);
    const calls: Array<[number, number]> = [];
    d.holder.userData.tick = (t: number, dt: number) => { calls.push([t, dt]); };
    run(c.fx, 0.5, 2);
    expect(calls.length).toBe(30);
    expect(calls[0]![0]).toBeCloseTo(2 + 1 / 60, 9);
    expect(calls.at(-1)![0]).toBeCloseTo(2.5, 6);
    expect(calls[3]![1]).toBeCloseTo(1 / 60, 9);
    c.fx.cue(d, "pet");
    expect(d.holder.userData.cue).toEqual({ name: "pet", at: expect.closeTo(2.5, 6) });
  });

  it("a prop without a tick is untouched, and a later cue replaces an earlier one", () => {
    const c = room();
    const d = prop(c, "dog", 5);
    expect(() => run(c.fx, 0.2)).not.toThrow();
    c.fx.cue(d, "bark");
    run(c.fx, 1, 0.2);
    c.fx.cue(d, "pet");
    expect(d.holder.userData.cue.name).toBe("pet");
  });
});

describe("nearby", () => {
  it("returns the named props nearest to x, nearest first, up to n", () => {
    const c = room();
    const a = prop(c, "teddy", 10), b = prop(c, "ball", 14), cc = prop(c, "cushions", 20), d = prop(c, "lamp", 3);
    expect(c.fx.nearby(12, 2)).toEqual([a, b]);
    expect(c.fx.nearby(12, 10)).toEqual([a, b, d, cc].sort((p, q) => Math.abs(p.base.px - 12) - Math.abs(q.base.px - 12)));
    expect(c.fx.nearby(21, 1)).toEqual([cc]);
    expect(c.fx.nearby(12, 0)).toEqual([]);
  });
  it("leaves out the types it is told to, and props that have no name", () => {
    const c = room();
    const books = prop(c, "books", 11), teddy = prop(c, "teddy", 15), mystery = prop(c, "hovercraft", 12);
    expect(c.fx.nearby(11, 3, ["books"])).toEqual([teddy]);
    expect(c.fx.nearby(11, 3)).toEqual([books, teddy]);
    expect(mystery.spec.noun).toBeNull();
  });
});

describe("flutter, say, setVisible", () => {
  it("flutter ruffles a book's pages without naming it or sounding anything", () => {
    const c = room();
    const b = prop(c, "books", 5, 4);
    c.toast.mockClear();
    c.fx.flutter(b);
    let moved = 0;
    let t = 0;
    for (let i = 0; i < 40; i++) { t += 1 / 60; c.fx.update(1 / 60, t); moved = Math.max(moved, ...b.holder.children.map((o) => Math.abs(o.rotation.z))); }
    expect(moved).toBeGreaterThan(0.01);
    expect(c.toast).not.toHaveBeenCalled();
  });
  it("say names a prop (caption) like a tap does, but the prop does not react", () => {
    const c = room();
    const t = prop(c, "teddy", 5);
    c.fx.say(t);
    expect(c.toast).toHaveBeenCalledWith("Brown teddy bear");
    run(c.fx, 0.3);
    expect(t.holder.scale.y).toBeCloseTo(1, 9);
    expect(t.taps).toBe(0);
  });
  it("setVisible hides and shows a prop", () => {
    const c = room();
    const g = prop(c, "guitar", 5);
    c.fx.setVisible(g, false);
    expect(g.holder.visible).toBe(false);
    c.fx.setVisible(g, true);
    expect(g.holder.visible).toBe(true);
  });
});
