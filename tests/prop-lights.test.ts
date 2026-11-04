// setLights: the lanterns lit at night and dark by day (src/features/game/world/runtime/worldLook.ts). One call switches every light prop; everything else is left alone.
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROP_LANG_KEY } from "../src/lib/propSpeech";
import { resetVoiceBackoff } from "../src/lib/propVoice";
import { createPropFx } from "../src/features/game/world/runtime/propReactions";

beforeEach(() => {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, String(v)), removeItem: (k: string) => void map.delete(k), clear: () => map.clear(), key: () => null, length: 0 });
  localStorage.setItem(PROP_LANG_KEY, "en");
  resetVoiceBackoff();
});
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const world = new THREE.Group();
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 400 }) } as unknown as HTMLElement;
  const fx = createPropFx({ root: () => world, camera: () => new THREE.PerspectiveCamera(36, 2, 0.1, 200), canvas, toast: () => {}, boostWindmill: () => {}, reduced: () => false, canSpeak: () => false });
  return { fx, world };
}
function lantern(world: THREE.Object3D, x: number) {
  const g = new THREE.Group();
  g.position.set(x, 0, 0);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.2), new THREE.MeshStandardMaterial({ emissive: 0xffb04a, emissiveIntensity: 2.2 }));
  const light = new THREE.PointLight(0xffc27a, 1.6, 9, 2);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({}));
  g.add(bulb, light, glow);
  world.add(g);
  return { g, bulb, light, glow };
}
const plain = (world: THREE.Object3D, x: number) => { const g = new THREE.Group(); g.position.set(x, 0, 0); g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial())); world.add(g); return g; };

describe("setLights", () => {
  it("false puts every light prop out (light, glow and bulb) and true lights them all again, exactly as bright as they were", () => {
    const { fx, world } = setup();
    const a = lantern(world, 3), b = lantern(world, 9);
    const ia = fx.register("lantern", [a.g])!, ib = fx.register("lantern", [b.g])!;
    a.light.intensity = 6.05; b.light.intensity = 4.2;                      // the world rescales its lights after props are placed: the brightness to come back to is the one at the moment of switching off
    fx.setLights(false);
    for (const x of [a, b]) { expect(x.light.intensity).toBe(0); expect(x.glow.visible).toBe(false); expect((x.bulb.material as THREE.MeshStandardMaterial).emissiveIntensity).toBeLessThan(0.3); }
    expect(ia.on).toBe(false); expect(ib.on).toBe(false);
    fx.setLights(true);
    expect(a.light.intensity).toBe(6.05); expect(b.light.intensity).toBe(4.2);
    for (const x of [a, b]) { expect(x.glow.visible).toBe(true); expect((x.bulb.material as THREE.MeshStandardMaterial).emissiveIntensity).toBe(2.2); }
    expect(ia.on).toBe(true); expect(ib.on).toBe(true);
  });

  it("is harmless to repeat, and a lantern already in the state asked for is not touched (no brightness read twice)", () => {
    const { fx, world } = setup();
    const a = lantern(world, 3);
    fx.register("lantern", [a.g]);
    fx.setLights(true);
    expect(a.light.intensity).toBe(1.6);
    a.light.intensity = 9;                                                   // the world changed it: lit already, so setLights(true) leaves it
    fx.setLights(true);
    expect(a.light.intensity).toBe(9);
    fx.setLights(false);
    fx.setLights(false);
    expect(a.light.intensity).toBe(0);
    fx.setLights(true);
    expect(a.light.intensity).toBe(9);                                       // the brightness it was switched off at, not a stale one
  });

  it("leaves props that are not lights alone, and does nothing in a room with no props", () => {
    const { fx, world } = setup();
    const p = plain(world, 5);
    const inst = fx.register("blocks", [p])!;
    const before = JSON.stringify(inst.base);
    fx.setLights(false);
    expect(inst.on).toBe(true);                                              // not a light: its "on" is not for setLights to flip
    fx.setLights(true);
    expect(JSON.stringify(inst.base)).toBe(before);
    expect(p.visible).toBe(true);
    expect(inst.on).toBe(true);
    const empty = setup();
    expect(() => { empty.fx.setLights(false); empty.fx.setLights(true); }).not.toThrow();
  });

  it("a child can still tap a lantern: a dark one lights up on a tap and a lit one goes out", () => {
    const { fx, world } = setup();
    const a = lantern(world, 3);
    const inst = fx.register("lantern", [a.g])!;
    fx.setLights(false);
    fx.activate(inst);
    expect(inst.on).toBe(true);
    expect(a.light.intensity).toBe(1.6);
    fx.activate(inst);
    expect(inst.on).toBe(false);
    expect(a.light.intensity).toBe(0);
  });

  it("works on every kind of light prop, the lamp and the cottage window as well as the lantern", () => {
    const { fx, world } = setup();
    const kinds = ["lamp", "lantern", "cottage"] as const;
    const lights = kinds.map((k, i) => { const l = lantern(world, 3 + i * 4); fx.register(k, [l.g]); return l; });
    fx.setLights(false);
    for (const l of lights) expect(l.light.intensity).toBe(0);
    fx.setLights(true);
    for (const l of lights) expect(l.light.intensity).toBeGreaterThan(0);
  });
});
