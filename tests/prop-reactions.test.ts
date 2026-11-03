import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COLOR_KEYS, NOUN_KEYS } from "../src/lib/propNames";
import { PROP_LANG_KEY } from "../src/lib/propSpeech";
import { resetVoiceBackoff } from "../src/lib/propVoice";
import { FALLBACK_SPEC, PROP_SPECS, PROP_TYPES, createPropFx, specFor, type PropFxDeps } from "../src/features/game/world/runtime/propReactions";

const root = new URL("..", import.meta.url).pathname;

// ---- the registry guard from carousel spec 11.7 ----------------------------------------------------------------------------
describe("prop reaction registry (spec 11.7: no dead props)", () => {
  const world = readFileSync(join(root, "src/features/game/world/runtime/world.ts"), "utf8");
  // The table's type annotation contains "=>", so anchor on the ">={" that opens the object literal.
  const table = /var propBuilders[\s\S]*?>=\{([\s\S]*?)\};/.exec(world)?.[1] ?? "";
  const builderKeys = [...table.matchAll(/(?:^|[{,])([a-z]+):/g)].map((m) => m[1]!);

  it("finds the propBuilders table in world.ts (so this guard cannot silently pass on a parse failure)", () => {
    expect(builderKeys.length).toBeGreaterThanOrEqual(25);
    expect(builderKeys).toContain("tree");
    expect(builderKeys).toContain("lamp");
  });
  it("every prop builder has a reaction entry; add a prop and this fails until you give it idle/poke/use", () => {
    const missing = builderKeys.filter((k) => !(k in PROP_SPECS));
    expect(missing, `prop builders with no PROP_SPECS entry: ${missing.join(", ")}`).toEqual([]);
  });
  it("and no spec is left behind for a builder that no longer exists", () => {
    const stale = PROP_TYPES.filter((t) => !builderKeys.includes(t));
    expect(stale).toEqual([]);
    expect(Object.keys(PROP_SPECS).sort()).toEqual([...PROP_TYPES].sort());
  });
  it("every spec names itself with a real vocabulary noun and colour (so all six languages can say it)", () => {
    for (const t of PROP_TYPES) {
      const s = PROP_SPECS[t];
      expect(NOUN_KEYS as readonly string[], t).toContain(s.noun);
      expect(COLOR_KEYS as readonly string[], t).toContain(s.color);
    }
  });
  it("every prop type the level data uses is a built-in prop", () => {
    const kit = readFileSync(join(root, "src/features/game/world/runtime/levelKit.ts"), "utf8");
    const used = new Set([...kit.matchAll(/\{ type: "([a-z]+)", dx/g)].map((m) => m[1]!));
    expect(used.size).toBeGreaterThan(8);
    for (const u of used) expect(PROP_TYPES as readonly string[], `levelKit uses unknown prop "${u}"`).toContain(u);
  });
  it("an unknown prop type falls back to a generic wiggle, never to nothing", () => {
    expect(specFor("hovercraft")).toBe(FALLBACK_SPEC);
    expect(FALLBACK_SPEC.noun).toBeNull();
    expect(FALLBACK_SPEC.poke).toBe("wiggle");
  });
});

// ---- behaviour, with real three.js objects and no renderer -------------------------------------------------------------------
function memoryStorage() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, String(v)), removeItem: (k: string) => void map.delete(k), clear: () => map.clear(), key: () => null, length: 0 };
}
let storage = memoryStorage();
const setLang = (l: string) => storage.setItem(PROP_LANG_KEY, l);

function setup(over: Partial<PropFxDeps> = {}) {
  const world = new THREE.Group();
  const toast = vi.fn();
  const boostWindmill = vi.fn();
  const camera = new THREE.PerspectiveCamera(36, 2, 0.1, 200);
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 400 }) } as unknown as HTMLElement;
  const fx = createPropFx({ root: () => world, camera: () => camera, canvas, toast, boostWindmill, reduced: () => false, canSpeak: () => false, ...over });
  return { fx, world, toast, boostWindmill, camera };
}
const run = (fx: ReturnType<typeof createPropFx>, seconds: number, from = 0, dt = 1 / 60) => {
  let t = from;
  for (let i = 0; i < Math.round(seconds / dt); i++) { t += dt; fx.update(dt, t); }
  return t;
};
const box = (w: number, h: number, d: number, y: number, mat?: THREE.Material) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat ?? new THREE.MeshStandardMaterial());
  m.position.y = y;
  return m;
};
function litProp(world: THREE.Object3D, x: number, shared: THREE.MeshStandardMaterial) {
  const g = new THREE.Group();
  g.position.set(x, 0, 0);
  g.add(new THREE.Mesh(new THREE.SphereGeometry(0.2), shared));
  const light = new THREE.PointLight(0xffc27a, 1.6, 9, 2);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({}));
  g.add(light, glow);
  world.add(g);
  return { g, light, glow };
}

beforeEach(() => { storage = memoryStorage(); vi.stubGlobal("localStorage", storage); resetVoiceBackoff(); });
afterEach(() => vi.unstubAllGlobals());

describe("lights switch on and off (lamp, lantern, cottage window)", () => {
  it("a tap turns a lit prop off and the next tap turns it back on", () => {
    const { fx, world } = setup();
    const { g, light, glow } = litProp(world, 5, new THREE.MeshStandardMaterial({ emissive: 0xffb04a, emissiveIntensity: 2.2 }));
    const inst = fx.register("lamp", [g])!;
    expect(inst.on).toBe(true);
    fx.activate(inst);
    expect(inst.on).toBe(false);
    expect(light.intensity).toBe(0);
    expect(glow.visible).toBe(false);
    fx.activate(inst);
    expect(inst.on).toBe(true);
    expect(light.intensity).toBe(1.6);
    expect(glow.visible).toBe(true);
  });
  it("comes back exactly as bright as it was, even if the world rescaled its light after it was placed", () => {
    const { fx, world } = setup();
    const { g, light } = litProp(world, 5, new THREE.MeshStandardMaterial({ emissive: 0xffb04a, emissiveIntensity: 2.2 }));
    const inst = fx.register("lantern", [g])!;
    light.intensity = 6.05; // the world's own lighting pass rescaled it after registration
    ((g.children[0] as unknown as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity = 3.1;
    fx.activate(inst);
    expect(light.intensity).toBe(0);
    fx.activate(inst);
    expect(light.intensity).toBe(6.05);
    expect(((g.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity).toBe(3.1);
  });
  it("switches THIS lamp off, not every lamp that happens to share a cached glow material", () => {
    const { fx, world } = setup();
    const shared = new THREE.MeshStandardMaterial({ emissive: 0xffb04a, emissiveIntensity: 2.2 });
    const a = litProp(world, 5, shared), b = litProp(world, 12, shared);
    const ia = fx.register("lamp", [a.g])!, ib = fx.register("lamp", [b.g])!;
    fx.activate(ia);
    const bulbA = a.g.children[0] as THREE.Mesh, bulbB = b.g.children[0] as THREE.Mesh;
    expect((bulbA.material as THREE.MeshStandardMaterial).emissiveIntensity).toBeLessThan(0.3);
    expect((bulbB.material as THREE.MeshStandardMaterial).emissiveIntensity).toBe(2.2);
    expect(shared.emissiveIntensity).toBe(2.2); // the cached material itself is never touched
    expect(ib.on).toBe(true);
    expect(b.light.intensity).toBe(1.6);
  });
  it("registration does not fiddle with props that have no light behaviour", () => {
    const { fx, world } = setup();
    const shared = new THREE.MeshStandardMaterial({ emissive: 0xffb04a, emissiveIntensity: 2.2 });
    const t = new THREE.Group(); t.add(new THREE.Mesh(new THREE.SphereGeometry(0.2), shared)); world.add(t);
    fx.register("tree", [t]);
    expect((t.children[0] as THREE.Mesh).material).toBe(shared);
  });
});

describe("trees drop fruit (shake -> apples fall -> they grow back)", () => {
  function tree() {
    const { fx, world } = setup();
    const g = new THREE.Group();
    g.position.set(14, 0, -2.4);
    g.add(box(2, 5, 2, 2.5));
    world.add(g);
    const inst = fx.register("tree", [g])!;
    return { fx, world, g, inst };
  }
  it("shows three apples hanging so a kid can see it is shakeable", () => {
    const { inst } = tree();
    expect(inst.slots).toHaveLength(3);
    expect(inst.slots.every((s) => s.mesh && s.mesh.parent === inst.holder)).toBe(true);
  });
  it("a tap drops two of them, which fall to the ground and settle", () => {
    const { fx, inst, world } = tree();
    fx.activate(inst);
    expect(inst.slots.filter((s) => s.mesh).length).toBe(1);
    expect(fx.fallerCount()).toBe(2);
    const falling = world.children.filter((c) => (c as THREE.Mesh).isMesh);
    expect(falling).toHaveLength(2);
    run(fx, 1.4);
    for (const f of falling) expect(f.position.y).toBeLessThan(0.4);
  });
  it("another tap drops the last apple; an empty tree just shakes", () => {
    const { fx, inst } = tree();
    fx.activate(inst);
    fx.activate(inst);
    expect(inst.slots.filter((s) => s.mesh).length).toBe(0);
    expect(fx.fallerCount()).toBe(3);
    fx.activate(inst);
    expect(fx.fallerCount()).toBe(3); // nothing more to drop
  });
  it("fallen fruit tidies itself away, and the tree grows its apples back", () => {
    const { fx, inst } = tree();
    fx.activate(inst);
    run(fx, 16);
    expect(fx.fallerCount()).toBe(0);
    expect(inst.slots.every((s) => s.mesh)).toBe(true);
    expect(inst.slots.every((s) => s.mesh!.scale.x === 1)).toBe(true);
  });
  it("never lets loose fruit pile up without limit", () => {
    const { fx, inst } = tree();
    for (let i = 0; i < 80; i++) { for (const s of inst.slots) if (!s.mesh) s.regrowAt = 1; run(fx, 0.2, i * 0.2); fx.activate(inst); }
    expect(fx.fallerCount()).toBeLessThanOrEqual(48);
  });
});

describe("the other reactions", () => {
  const simple = (type: string, kids: THREE.Object3D[], size = 1) => {
    const ctx = setup();
    const g = new THREE.Group();
    g.position.set(8, 0, 0);
    kids.forEach((k) => g.add(k));
    ctx.world.add(g);
    return { ...ctx, g, inst: ctx.fx.register(type, [g])!, size };
  };
  it("a tap starts the reaction on the very next frame (well inside 100 ms)", () => {
    const { fx, g, inst } = simple("teddy", [box(1, 1, 1, 0.5)]);
    fx.activate(inst);
    fx.update(1 / 60, 0.016);
    expect(g.scale.y).not.toBe(1);
  });
  it("blocks: the top block topples off and is stacked back afterwards", () => {
    const kids = [box(0.9, 0.9, 0.9, 0.45), box(0.9, 0.9, 0.9, 0.45), box(0.9, 0.9, 0.9, 1.35)];
    const { fx, inst } = simple("blocks", kids);
    const top = kids[2]!, home = top.position.clone();
    fx.activate(inst);
    run(fx, 0.7);
    expect(Math.abs(top.position.x - home.x)).toBeGreaterThan(0.5);
    expect(Math.abs(top.rotation.z)).toBeGreaterThan(0.5);
    run(fx, 2.2, 0.7);
    expect(top.position.distanceTo(home)).toBeLessThan(1e-6);
    expect(top.rotation.z).toBeCloseTo(0, 6);
  });
  it("ball: rolls out about its own centre and comes back", () => {
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.55), new THREE.MeshStandardMaterial());
    sphere.position.y = 0.55;
    const { fx, g, inst } = simple("ball", [sphere]);
    expect(inst.pivot).not.toBeNull();
    fx.activate(inst);
    run(fx, 0.85);
    expect(Math.abs(g.position.x - 8)).toBeGreaterThan(1);
    expect(Math.abs(inst.pivot!.rotation.z)).toBeGreaterThan(1);
    run(fx, 1.2, 0.85);
    expect(g.position.x).toBeCloseTo(8, 6);
    expect(inst.pivot!.rotation.z).toBe(0);
  });
  it("plant: leaves pop up and settle at their own size", () => {
    const leaf = () => new THREE.Mesh(new THREE.SphereGeometry(0.4), new THREE.MeshStandardMaterial());
    const kids = [box(0.8, 0.6, 0.8, 0.3), box(0.9, 0.1, 0.9, 0.62), leaf(), leaf()];
    kids[2]!.position.y = 1.15; kids[3]!.position.y = 1.3;
    const { fx, inst } = simple("plant", kids);
    fx.activate(inst);
    run(fx, 0.15);
    expect(kids[2]!.scale.x).toBeLessThan(0.8);
    run(fx, 1.1, 0.15);
    expect(kids[2]!.scale.x).toBe(1);
    expect(kids[2]!.position.y).toBe(1.15);
  });
  it("cloud: rains", () => {
    const { fx, inst } = simple("cloud", [box(3, 1.5, 1.5, 0.8)]);
    fx.activate(inst);
    run(fx, 0.5);
    expect(fx.fallerCount()).toBeGreaterThan(3);
    run(fx, 3, 0.5);
    expect(fx.fallerCount()).toBe(0);
  });
  it("windmill: spins the blades up through the world's own hook", () => {
    const { fx, inst, boostWindmill } = simple("windmill", [box(1, 4, 1, 2)]);
    fx.activate(inst);
    expect(boostWindmill).toHaveBeenCalledTimes(1);
  });
  it("pine, palm and bushes shower snow, coconuts and berries", () => {
    for (const [type, n] of [["pine", 3], ["palm", 2], ["bushes", 4]] as const) {
      const { fx, inst } = simple(type, [box(2, 4, 2, 2)]);
      fx.activate(inst);
      expect(fx.fallerCount(), type).toBe(n);
    }
  });
  it("every built-in prop type can be registered and tapped without throwing, and ends in its rest pose", () => {
    for (const type of PROP_TYPES) {
      const { fx, g, inst } = simple(type, [box(1, 1, 1, 0.5), box(1, 1, 1, 1.5), box(1, 1, 1, 2.5)]);
      const rest = { x: g.position.x, y: g.position.y, z: g.position.z };
      expect(() => { fx.activate(inst); run(fx, 3.2); }).not.toThrow();
      expect(g.position.x, type).toBeCloseTo(rest.x, 3);
      expect(g.position.y, type).toBeLessThan(rest.y + 0.15); // idle bob is the most any prop settles away from rest
      expect(g.scale.x, type).toBeCloseTo(1, 3);
    }
  });
  it("calm idle motion is small, and reduced-motion makes reactions gentler but never removes them", () => {
    const peak = (reduced: boolean) => {
      const c = setup({ reduced: () => reduced });
      const h = new THREE.Group(); h.position.set(3, 0, 0); h.add(box(2, 5, 2, 2.5)); c.world.add(h);
      const i2 = c.fx.register("tree", [h])!;
      c.fx.activate(i2);
      let max = 0, t = 0;
      for (let i = 0; i < 30; i++) { t += 1 / 60; c.fx.update(1 / 60, t); max = Math.max(max, Math.abs(h.rotation.z)); }
      return max;
    };
    const full = peak(false), soft = peak(true);
    expect(soft).toBeGreaterThan(0);
    expect(soft).toBeLessThan(full * 0.6);
  });
});

describe("tapping: picking and naming", () => {
  function scene(lang?: string) {
    if (lang) setLang(lang);
    const ctx = setup();
    ctx.camera.position.set(5, 2, 10);
    ctx.camera.lookAt(5, 2, 0);
    ctx.camera.updateMatrixWorld(true);
    const g = new THREE.Group();
    g.position.set(5, 0, 0);
    g.add(box(2, 4, 2, 2));
    ctx.world.add(g);
    const inst = ctx.fx.register("tree", [g])!;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(0, 0), ctx.camera);
    g.updateMatrixWorld(true);
    return { ...ctx, g, inst, ray };
  }
  it("a ray through a prop reacts and says its name; a ray through empty sky does nothing", () => {
    const { fx, ray, toast, camera } = scene();
    expect(fx.tap(ray)).toBe(true);
    expect(toast).toHaveBeenCalledWith("Green tree");
    const miss = new THREE.Raycaster();
    miss.setFromCamera(new THREE.Vector2(0.95, 0.95), camera);
    expect(fx.tap(miss)).toBe(false);
  });
  it("glow sprites and loose fruit never steal a tap", () => {
    const { fx, g, ray } = scene();
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({}));
    sprite.position.set(0, 2, 3); sprite.scale.set(6, 6, 1);
    g.add(sprite); g.updateMatrixWorld(true);
    expect(fx.tap(ray)).toBe(true);
  });
  it("says the object and colour in the chosen language", () => {
    for (const [lang, said] of [["en", "Green tree"], ["es", "Árbol verde"], ["fr", "Arbre vert"], ["de", "Grüner Baum"], ["it", "Albero verde"], ["pt", "Árvore verde"]] as const) {
      const { fx, ray, toast } = scene(lang);
      fx.tap(ray);
      expect(toast, lang).toHaveBeenCalledWith(said);
    }
  });
  it("says nothing at all when the setting is Off", () => {
    const { fx, ray, toast } = scene("off");
    expect(fx.tap(ray)).toBe(true); // it still reacts
    expect(toast).not.toHaveBeenCalled();
  });
  it("defaults to English when nothing was ever chosen, or the saved value is junk", () => {
    const a = scene(); a.fx.tap(a.ray); expect(a.toast).toHaveBeenCalledWith("Green tree");
    const b = scene("klingon"); b.fx.tap(b.ray); expect(b.toast).toHaveBeenCalledWith("Green tree");
  });
  it("a lantern with its own light colour is named by that colour; the default lantern is a blue light", () => {
    const mk = (arg?: string) => {
      const c = setup(); const g = new THREE.Group(); g.add(box(0.2, 2, 0.2, 1)); c.world.add(g);
      const inst = c.fx.register("lantern", [g], arg)!; return { c, inst };
    };
    const d = mk(); expect(d.c.fx.nameOf(d.inst)?.text).toBe("blue light");
    const p = mk("#ff9db0"); expect(p.c.fx.nameOf(p.inst)?.text).toBe("pink light");
    setLang("fr"); const f = mk("#ff9db0"); expect(f.c.fx.nameOf(f.inst)?.text).toBe("lumière rose");
  });
  it("an unknown (e.g. generated) prop is still tappable and named, in English", () => {
    setLang("es");
    const c = setup(); const g = new THREE.Group(); g.add(box(1, 1, 1, 0.5)); c.world.add(g);
    const inst = c.fx.register("hovercraft", [g])!;
    expect(inst.known).toBe(false);
    expect(c.fx.nameOf(inst)).toEqual({ text: "gray hovercraft", lang: "en" });
    c.fx.activate(inst);
    expect(c.toast).toHaveBeenCalledWith("Gray hovercraft");
  });
  it("two quick taps on the same prop say the word once, not twice", () => {
    const { fx, inst, toast } = scene();
    fx.activate(inst); fx.activate(inst);
    expect(toast).toHaveBeenCalledTimes(1);
  });
});

describe("generous tap targets (a fingertip, not a pixel-perfect cursor)", () => {
  function pole() {
    const ctx = setup();
    ctx.camera.position.set(5, 2, 10); ctx.camera.lookAt(5, 2, 0); ctx.camera.updateMatrixWorld(true);
    const g = new THREE.Group(); g.position.set(5, 0, 0);
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 4, 8), new THREE.MeshStandardMaterial()));
    g.children[0]!.position.y = 2;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({})); glow.scale.set(4, 4, 1); glow.position.y = 3.2; g.add(glow);
    ctx.world.add(g);
    const inst = ctx.fx.register("lamp", [g])!;
    g.updateMatrixWorld(true);
    const rayAt = (ndcX: number, ndcY: number) => { const r = new THREE.Raycaster(); r.setFromCamera(new THREE.Vector2(ndcX, ndcY), ctx.camera); return r; };
    return { ...ctx, g, inst, rayAt };
  }
  it("a tap beside a hair-thin pole still counts, a tap well away does not", () => {
    const { fx, rayAt } = pole();
    expect(fx.tap(rayAt(0.03, 0))).toBe(true); // a few pixels off the pole: a thumb
    expect(fx.tap(rayAt(0.6, 0))).toBe(false); // clearly somewhere else
  });
  it("the hit box is invisible (never drawn, never casts a shadow)", () => {
    const { inst } = pole();
    expect(inst.proxy).not.toBeNull();
    expect(inst.proxy!.visible).toBe(false);
    expect(inst.proxy!.castShadow).toBe(false);
  });
  it("a prop's size comes from its meshes, so a big glow sprite does not bloat it", () => {
    const { inst } = pole();
    expect(inst.size.x).toBeLessThan(0.5);
    expect(inst.size.y).toBeGreaterThan(3.5);
  });
  it("the hit box is never treated as one of the prop's animated parts", () => {
    const { inst } = pole();
    expect([...inst.kids.keys()]).not.toContain(inst.proxy);
  });
});

describe("speaking the name", () => {
  class FakeAudio {
    static made: FakeAudio[] = [];
    src: string; paused = false;
    constructor(src: string) { this.src = src; FakeAudio.made.push(this); }
    addEventListener() {}
    play() { return Promise.resolve(); }
    pause() { this.paused = true; }
  }
  beforeEach(() => { FakeAudio.made = []; vi.stubGlobal("Audio", FakeAudio); });
  const tree = (lang: string, canSpeak: boolean) => {
    setLang(lang);
    const c = setup({ canSpeak: () => canSpeak });
    const g = new THREE.Group(); g.add(box(2, 4, 2, 2)); c.world.add(g);
    return { ...c, inst: c.fx.register("tree", [g])! };
  };
  it("plays the Gemini clip for exactly this language, object and colour", () => {
    const { fx, inst } = tree("es", true);
    fx.activate(inst);
    expect(FakeAudio.made.at(-1)!.src).toBe("/api/voice?lang=es&n=tree&c=green");
  });
  it("stays silent (caption only) when sound is muted", () => {
    const { fx, inst, toast } = tree("en", false);
    fx.activate(inst);
    expect(FakeAudio.made.filter((a) => a.src.includes("n=tree") && !a.src.includes("priority"))).toHaveLength(0);
    expect(toast).toHaveBeenCalledWith("Green tree");
  });
  it("a free-text (generated) name has no clip, only the device voice", () => {
    setLang("es");
    const c = setup({ canSpeak: () => true });
    const g = new THREE.Group(); g.add(box(1, 1, 1, 0.5)); c.world.add(g);
    FakeAudio.made = [];
    c.fx.activate(c.fx.register("hovercraft", [g])!);
    expect(FakeAudio.made).toHaveLength(0);
  });
});

describe("worlds reset cleanly", () => {
  it("reset forgets every prop and removes loose fruit", () => {
    const { fx, world } = setup();
    const g = new THREE.Group(); g.add(box(2, 5, 2, 2.5)); world.add(g);
    const inst = fx.register("tree", [g])!;
    fx.activate(inst);
    expect(fx.fallerCount()).toBe(2);
    fx.reset();
    expect(fx.list()).toHaveLength(0);
    expect(fx.fallerCount()).toBe(0);
    expect(world.children.filter((c) => (c as THREE.Mesh).isMesh)).toHaveLength(0);
  });
});
