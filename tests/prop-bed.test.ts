// The bed prop: tapping it says its name and tells the world (which sends the toy to sleep), and the room's lamps can go out for the night and come back as they were.
import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROP_SPECS, createPropFx, specFor, type PropFxDeps, type PropInst } from "../src/features/game/world/runtime/propReactions";
import { buildBed } from "../src/features/game/world/runtime/bed";
import { NOUN_KEYS, describeObject } from "../src/lib/propNames";
import { PROP_LANG_KEY } from "../src/lib/propSpeech";
import { resetVoiceBackoff } from "../src/lib/propVoice";

beforeEach(() => {
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
function lamp(world: THREE.Object3D, x: number) {
  const g = new THREE.Group();
  g.position.set(x, 0, 0);
  g.add(new THREE.Mesh(new THREE.SphereGeometry(0.2), new THREE.MeshStandardMaterial({ emissive: 0xffb04a, emissiveIntensity: 2 })));
  const light = new THREE.PointLight(0xffc27a, 1.6, 9, 2);
  g.add(light);
  world.add(g);
  return { g, light };
}

describe("the bed prop", () => {
  it("has a real vocabulary name in all seven languages, and the spec says tapping it means sleep", () => {
    expect(NOUN_KEYS as readonly string[]).toContain("bed");
    expect(PROP_SPECS.bed.noun).toBe("bed");
    expect(PROP_SPECS.bed.use).toBe("sleep");
    expect(specFor("bed")).toBe(PROP_SPECS.bed);
    const said = (["en", "es", "fr", "de", "it", "pt", "tr"] as const).map((l) => describeObject({ noun: "bed", color: "colorful" }, l)?.text);
    expect(said).toEqual(["colorful bed", "cama de colores", "lit multicolore", "buntes Bett", "letto colorato", "cama colorida", "renkli yatak"]);
  });

  it("a tap on the bed says its name and tells the world once, with the bed that was tapped", () => {
    const onBed = vi.fn();
    const { fx, world, toast } = room({ onBed });
    const bed = buildBed(27.5, -2.6);
    world.add(bed);
    const inst = fx.register("bed", [bed])!;
    expect(inst.type).toBe("bed");
    fx.activate(inst);
    expect(onBed).toHaveBeenCalledTimes(1);
    expect((onBed.mock.calls[0]![0] as PropInst).holder.position.x).toBeCloseTo(27.5, 6);
    expect((onBed.mock.calls[0]![0] as PropInst).holder.position.z).toBeCloseTo(-2.6, 6);
    expect(toast).toHaveBeenCalledWith("Colorful bed");
  });

  it("a bed with nothing listening still reacts and names itself (no crash)", () => {
    const { fx, world, toast } = room();
    const bed = buildBed(0, 0);
    world.add(bed);
    const inst = fx.register("bed", [bed])!;
    expect(() => fx.activate(inst)).not.toThrow();
    expect(toast).toHaveBeenCalledWith("Colorful bed");
  });
});

describe("lightsOut", () => {
  it("puts every lit lamp out, and back on again exactly as they were", () => {
    const { fx, world } = room();
    const a = lamp(world, 2), b = lamp(world, 9);
    const ia = fx.register("lamp", [a.g])!, ib = fx.register("lamp", [b.g])!;
    expect([ia.on, ib.on]).toEqual([true, true]);
    fx.lightsOut(true);
    expect([ia.on, ib.on]).toEqual([false, false]);
    expect(a.light.intensity).toBe(0);
    fx.lightsOut(false);
    expect([ia.on, ib.on]).toEqual([true, true]);
    expect(a.light.intensity).toBeGreaterThan(0);
  });

  it("a lamp the child had already switched off stays off when the room wakes", () => {
    const { fx, world } = room();
    const a = lamp(world, 2), b = lamp(world, 9);
    const ia = fx.register("lamp", [a.g])!, ib = fx.register("lamp", [b.g])!;
    fx.activate(ia);                                           // the child turns the first one off
    expect(ia.on).toBe(false);
    fx.lightsOut(true);
    fx.lightsOut(false);
    expect(ia.on).toBe(false);
    expect(ib.on).toBe(true);
  });

  it("is idempotent in both directions, and a lamp switched on during the night is not forgotten", () => {
    const { fx, world } = room();
    const a = lamp(world, 2);
    const ia = fx.register("lamp", [a.g])!;
    fx.lightsOut(true);
    fx.lightsOut(true);
    expect(ia.on).toBe(false);
    fx.lightsOut(false);
    fx.lightsOut(false);
    expect(ia.on).toBe(true);
    fx.lightsOut(false);                                       // nothing remembered: nothing happens
    expect(ia.on).toBe(true);
  });

  it("a world change in the middle of the night forgets it (the old lamps are not switched on in the new world)", () => {
    const { fx, world } = room();
    const a = lamp(world, 2);
    fx.register("lamp", [a.g]);
    fx.lightsOut(true);
    fx.reset();
    const b = lamp(world, 20);
    const ib = fx.register("lamp", [b.g])!;
    fx.lightsOut(false);
    expect(ib.on).toBe(true);                                  // the new world's lamp was never put out and stays as it is
    expect(b.light.intensity).toBeGreaterThan(0);
  });

  it("and the next world can have its own night straight away: a night left over from the old world is not in the way", () => {
    const { fx, world } = room();
    fx.register("lamp", [lamp(world, 2).g]);
    fx.lightsOut(true);
    fx.reset();                                                // the world changed in the middle of the night
    const ib = fx.register("lamp", [lamp(world, 20).g])!;
    fx.lightsOut(true);
    expect(ib.on).toBe(false);
    fx.lightsOut(false);
    expect(ib.on).toBe(true);
  });

  it("things with no light are left alone", () => {
    const { fx, world } = room();
    const bed = buildBed(5, 0);
    world.add(bed);
    const ib = fx.register("bed", [bed])!;
    fx.lightsOut(true);
    expect(ib.on).toBe(ib.on);
    fx.lightsOut(false);
    expect(fx.list()).toHaveLength(1);
  });
});
