// Tree kinds and the orchard: the data must agree with the fruit table, with the tree the Garden has today (read from world.ts and propReactions.ts so a drift fails here),
// and a row of trees must be mixed.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FRUIT } from "../src/features/game/world/runtime/propReactions";
import { CROWN_BLOBS, PALM_FRUIT_OFFSETS, SLOT_DIRS, TREE_KINDS, bushKind, kindById, kindFits, kindFor, kindsFor, orchardKind, palmFronds, palmFruitOffsets, palmKind, slotDirs, treeShape } from "../src/features/game/world/runtime/treeKinds";

const RUNTIME = path.join(__dirname, "..", "src/features/game/world/runtime");

describe("TREE_KINDS", () => {
  it("has unique ids and every kind bears a real, tappable fruit", () => {
    expect(new Set(TREE_KINDS.map((k) => k.id)).size).toBe(TREE_KINDS.length);
    for (const k of TREE_KINDS) {
      const f = FRUIT[k.fruit];
      expect(f, `${k.id}: fruit ${k.fruit} is not in the FRUIT table`).toBeTruthy();
      expect(f.noun, `${k.id}: ${k.fruit} has no noun, so a tap on it says nothing`).toBeTruthy();
    }
  });

  it("a kind is named for the fruit it bears (a pear tree bears pears)", () => {
    for (const id of ["apple", "pear", "orange", "cherry", "plum", "lemon", "banana", "coconut", "strawberry", "blueberry"]) {
      expect(kindById(id)?.fruit, id).toBe(id);
    }
  });

  it("has sane slot counts, colours and trunks", () => {
    for (const k of TREE_KINDS) {
      expect(Number.isInteger(k.slots) && k.slots >= 1 && k.slots <= SLOT_DIRS.length, `${k.id} slots`).toBe(true);
      expect(k.leaf, `${k.id} leaf`).toMatch(/^#[0-9a-f]{6}$/i);
      if (k.blossom !== null) expect(k.blossom, `${k.id} blossom`).toMatch(/^#[0-9a-f]{6}$/i);
      if (k.crown === "bush") expect(k.trunk).toBe(0); else expect(k.trunk).toBeGreaterThanOrEqual(2.5);
      expect(k.worlds.length, `${k.id} grows nowhere`).toBeGreaterThan(0);
    }
  });

  it("palms are Beach-only and every Beach tree is a palm", () => {
    TREE_KINDS.filter((k) => k.crown === "palm").forEach((k) => expect(k.worlds).toEqual(["beach"]));
    kindsFor("beach").forEach((k) => expect(k.crown).toBe("palm"));
  });
});

describe("the tree the Garden has today is still the first kind", () => {
  // The apple tree exactly as tree() in world.ts drew it before there were kinds (the golden values; if one of these changes, the Garden's trees changed).
  const GOLDEN_BLOBS = [[0, 4.1, 0, 1.45, 1], [-.95, 3.5, .3, 1.0, 2], [.95, 3.6, -.2, 1.05, 3], [.2, 4.85, .1, .95, 4], [-.4, 4.3, .9, .85, 5], [.6, 3.9, .85, .8, 6]];
  const GOLDEN_BLOSSOMS = [[.7, 4.4, 1.25, "#ff9db0"], [-1.2, 3.9, .85, "#ffd24d"], [.3, 3.5, 1.55, "#ff9db0"], [-.3, 4.7, 1.2, "#ffd24d"]];
  const apple = TREE_KINDS[0]!;
  const world = readFileSync(path.join(RUNTIME, "world.ts"), "utf8");
  const reactions = readFileSync(path.join(RUNTIME, "propReactions.ts"), "utf8");

  it("is the apple tree: round crown, three apples, the plain leaf texture", () => {
    expect(apple.id).toBe("apple");
    expect(apple.crown).toBe("round");
    expect(apple.slots).toBe(3);
    expect(apple.leaf).toBe("#ffffff");
  });

  it("treeShape('apple') is exactly the old tree: the same six blobs, four blossoms, trunk 3.7 and no leaf tint", () => {
    const sh = treeShape(apple)!;
    expect(sh.blobs).toEqual(GOLDEN_BLOBS);
    expect(sh.blossoms).toEqual(GOLDEN_BLOSSOMS);
    expect(sh.trunk).toBe(3.7);
    expect(sh.leafTint).toBeNull();
    expect(CROWN_BLOBS.round).toEqual(GOLDEN_BLOBS);
  });

  it("world.ts draws every tree from treeShape (no second copy of the numbers) and the orchard picks its kind", () => {
    const at = world.indexOf("function tree(");
    const src = world.slice(at, at + 1800);
    expect(src).toContain("treeShape(");
    expect(src).toContain("sh.blobs.forEach");
    expect(src).toContain("sh.blossoms.forEach");
    expect(src).toContain("u*sh.trunk");
    expect(src).toContain("g.userData.treeKind");
    expect(src).not.toContain("[0,4.1,0,1.45,1]");
    // A tree left of the playable lane (x < 3) is the plain apple tree and takes no turn in the orchard, so the first tree a child meets is the apple tree they know.
    expect(world).toContain("tree:function(x,z){return tree(x,z,x<3?undefined:orchardKind(R.theme||id,treeN++))}");
  });

  it("propReactions hangs fruit where treeKinds says (the first three slots are where the apples always hung)", () => {
    expect(reactions).toContain("slotDirs(inst.fruitSlots)");
    expect(reactions).not.toContain("APPLE_DIRS");
    expect(SLOT_DIRS.slice(0, 3)).toEqual([[-38, -8], [12, -24], [50, -6]]);
  });
});

describe("treeShape", () => {
  const blobKinds = TREE_KINDS.filter((k) => k.crown === "round" || k.crown === "tall" || k.crown === "wide");

  it("is null for palms and bushes (they have their own builders) and a real shape for the rest", () => {
    for (const k of TREE_KINDS) expect(treeShape(k) === null, k.id).toBe(k.crown === "palm" || k.crown === "bush");
    expect(blobKinds.length).toBeGreaterThanOrEqual(6);
  });

  it("each kind's shape uses its own trunk and crown, and only the apple tree keeps the plain leaf", () => {
    for (const k of blobKinds) {
      const sh = treeShape(k)!;
      expect(sh.trunk, k.id).toBe(k.trunk);
      expect(sh.blobs, k.id).toBe(CROWN_BLOBS[k.crown as "round" | "tall" | "wide"]);
      expect(sh.leafTint === null, k.id).toBe(k.id === "apple");
      if (k.id !== "apple") expect(sh.leafTint, k.id).toBe(k.leaf);
    }
  });

  it("every blossom sits on the crown's surface (on one of its blobs) and faces the camera", () => {
    for (const k of blobKinds) {
      const sh = treeShape(k)!;
      expect(sh.blossoms.length, k.id).toBe(4);
      for (const [x, y, z, col] of sh.blossoms) {
        expect(col, `${k.id} blossom colour`).toMatch(/^#[0-9a-f]{6}$/i);
        const onBlob = sh.blobs.some(([bx, by, bz, r]) => Math.abs(Math.hypot(x - bx, y - by, z - bz) - r) < 0.45 * r);
        expect(onBlob, `${k.id} blossom at ${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)} is not on the crown`).toBe(true);
        expect(z, `${k.id} blossom faces away`).toBeGreaterThan(0.2);
      }
    }
  });

  it("blossoms alternate the kind's own colour with a yellow one, like the apple tree's pink and yellow", () => {
    for (const k of blobKinds.filter((t) => t.id !== "apple")) {
      expect(treeShape(k)!.blossoms.map((b) => b[3]), k.id).toEqual([k.blossom, "#ffd24d", k.blossom, "#ffd24d"]);
    }
  });

  it("the kinds' blossoms differ (pear white, cherry pink, plum lilac): trees are told apart by more than their fruit", () => {
    const first = (id: string) => treeShape(kindById(id)!)!.blossoms[0]![3];
    expect(new Set(["apple", "pear", "cherry", "plum"].map(first)).size).toBe(4);
  });
});

describe("crowns", () => {
  it("every blob crown sits on its trunk: the top of the trunk is inside the crown, and no blob dips into the ground", () => {
    for (const k of TREE_KINDS.filter((t) => t.crown === "round" || t.crown === "tall" || t.crown === "wide")) {
      const blobs = CROWN_BLOBS[k.crown as "round" | "tall" | "wide"];
      expect(blobs.some(([x, y, z, r]) => Math.hypot(x, y - k.trunk, z) <= r * 1.05), `${k.id}: the trunk top is outside every blob`).toBe(true);
      blobs.forEach(([, y, , r]) => expect(y - r, `${k.id} blob in the ground`).toBeGreaterThan(1.5));
    }
  });

  it("the three crown shapes really differ", () => {
    const sig = (c: "round" | "tall" | "wide") => JSON.stringify(CROWN_BLOBS[c]);
    expect(new Set([sig("round"), sig("tall"), sig("wide")]).size).toBe(3);
    const width = (c: "round" | "tall" | "wide") => Math.max(...CROWN_BLOBS[c].map(([x, , , r]) => Math.abs(x) + r));
    const top = (c: "round" | "tall" | "wide") => Math.max(...CROWN_BLOBS[c].map(([, y, , r]) => y + r));
    expect(width("wide")).toBeGreaterThan(width("round"));
    expect(top("tall")).toBeGreaterThan(top("wide"));
  });
});

describe("slotDirs", () => {
  it("gives n directions, clamped to what exists", () => {
    expect(slotDirs(3)).toHaveLength(3);
    expect(slotDirs(2)).toEqual(SLOT_DIRS.slice(0, 2));
    expect(slotDirs(99)).toHaveLength(SLOT_DIRS.length);
    expect(slotDirs(-1)).toHaveLength(0);
  });
  it("hangs every slot in the lower half of the crown (negative elevation)", () => {
    SLOT_DIRS.forEach(([, el]) => expect(el).toBeLessThan(0));
  });
});

describe("kindFor and its three wrappers", () => {
  it("is deterministic and starts with what each world already has: the apple tree, the coconut palm, the strawberry bush", () => {
    expect(orchardKind("garden", 0)?.id).toBe("apple");
    expect(palmKind("beach", 0)?.id).toBe("coconut");
    expect(bushKind("garden", 0)?.id).toBe("strawberry");
    expect(orchardKind("garden", 5)).toBe(orchardKind("garden", 5));
  });

  it("mixes a row: no two neighbours match, and the Garden grows at least four kinds of tree", () => {
    for (const [w, type] of [["garden", "tree"], ["beach", "palm"], ["sky", "tree"], ["garden", "bushes"]] as const) {
      const row = Array.from({ length: 20 }, (_, i) => kindFor(w, type, i)!.id);
      for (let i = 1; i < row.length; i++) expect(row[i], `${w} ${type} ${i}`).not.toBe(row[i - 1]);
    }
    expect(new Set(Array.from({ length: 8 }, (_, i) => orchardKind("garden", i)!.id)).size).toBeGreaterThanOrEqual(4);
  });

  it("each prop type gets only kinds that fit it: trees blob crowns, palms palms, bushes bushes", () => {
    for (let i = 0; i < 12; i++) {
      expect(["round", "tall", "wide"]).toContain(orchardKind("garden", i)!.crown);
      expect(bushKind("garden", i)!.crown).toBe("bush");
      expect(palmKind("beach", i)!.crown).toBe("palm");
    }
    expect(bushKind("garden", 1)!.id).not.toBe(bushKind("garden", 0)!.id);
  });

  it("returns undefined where nothing of that type grows, and tolerates odd indices", () => {
    expect(orchardKind("junk", 0)).toBeUndefined();
    expect(bushKind("beach", 0)).toBeUndefined();
    expect(orchardKind("beach", 0)).toBeUndefined();            // the Beach has palms, not trees
    expect(palmKind("garden", 0)).toBeUndefined();
    expect(kindFor("garden", "lamp", 0)).toBeUndefined();
    expect(orchardKind("garden", -3)?.id).toBe("apple");
    expect(orchardKind("garden", 2.9)).toBe(orchardKind("garden", 2));
    expect(orchardKind("garden", Number.NaN)?.id).toBe("apple");
  });
});

describe("kindFits", () => {
  it("a kind only fits the prop whose crown it has", () => {
    expect(kindFits("tree", kindById("pear")!)).toBe(true);
    expect(kindFits("tree", kindById("coconut")!)).toBe(false);
    expect(kindFits("palm", kindById("banana")!)).toBe(true);
    expect(kindFits("palm", kindById("apple")!)).toBe(false);
    expect(kindFits("bushes", kindById("blueberry")!)).toBe(true);
    expect(kindFits("bushes", kindById("pear")!)).toBe(false);
    expect(kindFits("lamp", kindById("apple")!)).toBe(false);
    for (const k of TREE_KINDS) expect(["tree", "palm", "bushes"].filter((t) => kindFits(t, k)), k.id).toHaveLength(1);   // every kind fits exactly one prop
  });
});

describe("world.ts draws palms and bushes by kind", () => {
  const world = readFileSync(path.join(RUNTIME, "world.ts"), "utf8");
  it("the palm and bushes builders take a kind, the prop table picks it, and the palm says where its fruit hang", () => {
    expect(world).toContain("palm:function(x,z){return palm(x,z,x<3?undefined:palmKind(R.theme||id,palmN++))}");
    expect(world).toContain("bushes:function(x,z){return bushes(x,z,bushKind(R.theme||id,bushN++))}");
    const at = world.indexOf("function palm(");
    const src = world.slice(at, at + 2400);
    expect(src).toContain("palmFronds(pk)");
    expect(src).toContain("g.userData.fruitSlots=palmFruitOffsets(pk)");
    expect(src).not.toContain('plastic("#6b4423")');                        // the three decorative coconuts are real fruit now
    expect(world.slice(world.indexOf("function bushes("), world.indexOf("function bushes(") + 600)).toContain("g.userData.treeKind=kind.id");
  });
});

describe("palms", () => {
  it("the fruit hang under the fronds, in front of the trunk, as many as the kind says", () => {
    for (const id of ["coconut", "banana"]) {
      const k = kindById(id)!;
      const offs = palmFruitOffsets(k);
      expect(offs, id).toHaveLength(k.slots);
      for (const [, y, z] of offs) { expect(y, `${id} below the fronds`).toBeLessThan(0); expect(z, `${id} faces the camera`).toBeGreaterThan(0.2); }
    }
    expect(palmFruitOffsets(kindById("coconut")!)).toHaveLength(2);
    expect(palmFruitOffsets(kindById("banana")!)).toHaveLength(3);
    expect(palmFruitOffsets({ ...kindById("banana")!, slots: 99 })).toHaveLength(PALM_FRUIT_OFFSETS.length);   // never more places than there are
  });

  it("the coconut palm keeps the greens it always had, and the banana palm's are lighter", () => {
    expect(palmFronds(kindById("coconut")!)).toEqual(["#249a5c", "#2fae6a"]);
    expect(palmFronds(kindById("banana")!)).not.toEqual(palmFronds(kindById("coconut")!));
  });
});
