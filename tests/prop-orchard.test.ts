// The orchard: a tree built as a given kind grows and drops ITS fruit (a pear tree pears, a lemon tree lemons), and an ordinary tree still grows apples.
// Real three.js objects and the real prop fx, no renderer. The kind comes from `userData.treeKind` on the tree's group, which `tree()` in world.ts sets.
import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FRUIT, createPropFx } from "../src/features/game/world/runtime/propReactions";
import { TREE_KINDS } from "../src/features/game/world/runtime/treeKinds";
import { PROP_LANG_KEY } from "../src/lib/propSpeech";
import { resetVoiceBackoff } from "../src/lib/propVoice";

beforeEach(() => {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, String(v)), removeItem: (k: string) => void map.delete(k), clear: () => map.clear(), key: () => null, length: 0 });
  localStorage.setItem(PROP_LANG_KEY, "en");
  resetVoiceBackoff();
});

function garden(treeKind?: string, type = "tree") {
  const world = new THREE.Group();
  const toast = vi.fn();
  const camera = new THREE.PerspectiveCamera(36, 2, 0.1, 200);
  camera.position.set(5, 2, 10);
  camera.lookAt(5, 2, 0);
  camera.updateMatrixWorld(true);
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 400 }) } as unknown as HTMLElement;
  const fx = createPropFx({ root: () => world, camera: () => camera, canvas, toast, boostWindmill: () => {}, reduced: () => false, canSpeak: () => false });
  const g = new THREE.Group();
  g.position.set(5, 0, 0);
  const trunk = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 2), new THREE.MeshStandardMaterial());
  trunk.position.y = 2;
  g.add(trunk);
  if (treeKind !== undefined) g.userData.treeKind = treeKind;
  world.add(g);
  const inst = fx.register(type, [g])!;
  g.updateMatrixWorld(true);
  return { fx, world, toast, inst, g };
}
const run = (fx: ReturnType<typeof createPropFx>, seconds: number, from = 0, dt = 1 / 60) => {
  let t = from;
  for (let i = 0; i < Math.round(seconds / dt); i++) { t += dt; fx.update(dt, t); }
  return t;
};
const rayAt = (m: THREE.Object3D) => { const p = m.getWorldPosition(new THREE.Vector3()); return new THREE.Raycaster(new THREE.Vector3(p.x, p.y, p.z + 8), new THREE.Vector3(0, 0, -1)); };
const BLOB_KINDS = TREE_KINDS.filter((k) => k.crown === "round" || k.crown === "tall" || k.crown === "wide");

describe("every orchard tree grows its own fruit", () => {
  for (const k of BLOB_KINDS) {
    it(`${k.id}: ${k.slots} ${k.fruit} hang on the crown, and nothing else`, () => {
      const { inst } = garden(k.id);
      expect(inst.fruit).toBe(k.fruit);
      expect(inst.slots).toHaveLength(k.slots);
      for (const s of inst.slots) {
        expect(s.mesh!.userData.fruitKind).toBe(k.fruit);
        expect(s.mesh!.parent).toBe(inst.holder);
      }
    });

    it(`${k.id}: a shake drops two of its ${k.fruit}, and they grow back as ${k.fruit}`, () => {
      const { fx, inst } = garden(k.id);
      fx.activate(inst);
      expect(fx.fallerCount()).toBe(2);
      for (const f of fx.fallers) { expect(f.kind).toBe(k.fruit); expect(f.mesh.userData.fruitKind).toBe(k.fruit); }
      run(fx, 16);
      expect(fx.fallerCount()).toBe(0);                                   // tidied away
      expect(inst.slots.every((s) => s.mesh && s.mesh.userData.fruitKind === k.fruit)).toBe(true);
      expect(inst.slots.every((s) => s.mesh!.scale.x === 1)).toBe(true);
    });
  }

  it("the fruit hangs in the same places for every kind (the first three are where the apples always hung)", () => {
    const apple = garden("apple").inst.slots.map((s) => s.local.toArray().map((v) => +v.toFixed(2)));
    const apple2 = garden().inst.slots.map((s) => s.local.toArray().map((v) => +v.toFixed(2)));
    expect(apple).toEqual(apple2);
    expect(apple2).toHaveLength(3);
  });
});

describe("the kind decides the slots and where the fruit sits", () => {
  it("the number of fruit follows the kind, on the prop that kind belongs to", () => {
    for (const [kind, type, n] of [["apple", "tree", 3], ["coconut", "palm", 2], ["banana", "palm", 3], ["strawberry", "bushes", 4], ["blueberry", "bushes", 4]] as const) {
      expect(garden(kind, type).inst.slots, `${kind} on ${type}`).toHaveLength(n);
    }
  });

  it("a bigger fruit sits a little further out of the leaves than a smaller one (half of it outside)", () => {
    const apple = garden("apple").inst.slots[1]!.local, cherry = garden("cherry").inst.slots[1]!.local;
    expect(apple.z - cherry.z).toBeCloseTo((FRUIT.apple.r - FRUIT.cherry.r) * 0.5 * 0.89, 2);
  });
});

describe("palms and bushes grow their kind's fruit too", () => {
  it("a coconut palm hangs two coconuts, a banana palm three bananas, a strawberry bush four strawberries", () => {
    for (const [kind, type, fruit, n] of [["coconut", "palm", "coconut", 2], ["banana", "palm", "banana", 3], ["strawberry", "bushes", "strawberry", 4], ["blueberry", "bushes", "blueberry", 4]] as const) {
      const { inst } = garden(kind, type);
      expect(inst.fruit, kind).toBe(fruit);
      expect(inst.slots.every((s) => s.mesh!.userData.fruitKind === fruit), kind).toBe(true);
      expect(inst.slots.length, kind).toBe(n);
    }
  });

  it("a shake drops two of that fruit as real loose fruit (not the old anonymous burst), and they grow back", () => {
    for (const [kind, type, fruit] of [["coconut", "palm", "coconut"], ["strawberry", "bushes", "strawberry"]] as const) {
      const { fx, inst } = garden(kind, type);
      fx.activate(inst);
      expect(fx.fallers.map((f) => f.kind), kind).toEqual([fruit, fruit]);
      expect(inst.slots.filter((s) => s.mesh).length, `${kind}: two came off the plant`).toBe(inst.slots.length - 2);
      run(fx, 16);
      expect(inst.slots.every((s) => s.mesh && s.mesh.userData.fruitKind === fruit), kind).toBe(true);
    }
  });

  it("with no kind they behave as before: a palm still bursts coconuts and a bush berries, and hang nothing", () => {
    const palm = garden(undefined, "palm");
    expect(palm.inst.slots).toHaveLength(0);
    palm.fx.activate(palm.inst);
    expect(palm.fx.fallers.every((f) => f.kind === "coconut")).toBe(true);
    expect(palm.fx.fallerCount()).toBe(2);
    const bush = garden(undefined, "bushes");
    expect(bush.inst.slots).toHaveLength(0);
    bush.fx.activate(bush.inst);
    expect(bush.fx.fallers.every((f) => f.kind === "berry")).toBe(true);
    expect(bush.fx.fallerCount()).toBe(4);
  });

  it("a builder that says where its fruit hang (userData.fruitSlots) gets them exactly there, and only as many as the kind has", () => {
    const world = new THREE.Group();
    const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 400 }) } as unknown as HTMLElement;
    const fx = createPropFx({ root: () => world, camera: () => new THREE.PerspectiveCamera(), canvas, toast: () => {}, boostWindmill: () => {}, reduced: () => false, canSpeak: () => false });
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 4, 1), new THREE.MeshStandardMaterial()));
    g.userData.treeKind = "coconut";
    g.userData.fruitSlots = [[0.3, 3.7, 0.34], [-0.28, 3.67, 0.36], [0.02, 3.6, 0.42]];       // three places, the kind has two
    world.add(g);
    const inst = fx.register("palm", [g])!;
    expect(inst.slots).toHaveLength(2);
    expect(inst.slots.map((s) => s.local.toArray().map((v) => +v.toFixed(5)))).toEqual([[0.3, 3.7, 0.34], [-0.28, 3.67, 0.36]]);
    expect(inst.slots[0]!.mesh!.position.toArray().map((v) => +v.toFixed(5))).toEqual([0.3, 3.7, 0.34]);
  });
});

describe("what a tap says", () => {
  it("a hanging pear says 'Green pear', a lemon 'Yellow lemon', cherries 'Red cherries'", () => {
    for (const [kind, said] of [["pear", "Green pear"], ["lemon", "Yellow lemon"], ["cherry", "Red cherries"]] as const) {
      const c = garden(kind);
      const ref = c.fx.pickFruit(rayAt(c.inst.slots[1]!.mesh!));
      expect(ref?.kind).toBe(kind);
      c.fx.tapFruitRef(ref!);
      expect(c.toast).toHaveBeenCalledWith(said);
    }
  });

  it("the pear keeps its height: hanging, carried and dropped", () => {
    const c = garden("pear");
    const m = c.inst.slots[0]!.mesh!;
    expect(m.scale.y / m.scale.x).toBeCloseTo(FRUIT.pear.sy!, 6);
    const ref = c.fx.pickFruit(rayAt(m))!;
    c.fx.liftFruit(ref);
    expect(ref.mesh.scale.y / ref.mesh.scale.x).toBeCloseTo(FRUIT.pear.sy!, 6);
    c.fx.dropFruit(ref);
    expect(ref.mesh.scale.y / ref.mesh.scale.x).toBeCloseTo(FRUIT.pear.sy!, 6);
  });
});

describe("everything else is as it was", () => {
  it("a tree with no kind, or one the orchard does not know, grows three apples", () => {
    for (const k of [undefined, "no-such-tree", "", "coconut", "strawberry"]) {      // the last two are real kinds, but not tree kinds
      const { inst } = garden(k);
      expect(inst.fruit, String(k)).toBe("apple");
      expect(inst.slots, String(k)).toHaveLength(3);
      expect(inst.slots.every((s) => s.mesh!.userData.fruitKind === "apple")).toBe(true);
    }
  });

  it("only a tree prop hangs fruit: a kind on a bush or a lamp is ignored", () => {
    for (const type of ["bushes", "lamp", "cushions"]) {
      const { inst } = garden("pear", type);
      expect(inst.slots, type).toHaveLength(0);
      expect(inst.fruit, type).toBe("apple");
    }
  });

  it("two trees of different kinds do not share fruit", () => {
    const world = new THREE.Group();
    const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 400 }) } as unknown as HTMLElement;
    const fx = createPropFx({ root: () => world, camera: () => new THREE.PerspectiveCamera(), canvas, toast: () => {}, boostWindmill: () => {}, reduced: () => false, canSpeak: () => false });
    const make = (x: number, kind: string) => {
      const g = new THREE.Group();
      g.position.set(x, 0, 0);
      g.add(new THREE.Mesh(new THREE.BoxGeometry(2, 4, 2), new THREE.MeshStandardMaterial()));
      g.userData.treeKind = kind;
      world.add(g);
      return fx.register("tree", [g])!;
    };
    const a = make(3, "pear"), b = make(12, "lemon");
    fx.activate(a);
    fx.activate(b);
    expect(fx.fallers.map((f) => f.kind).sort()).toEqual(["lemon", "lemon", "pear", "pear"]);
  });
});
