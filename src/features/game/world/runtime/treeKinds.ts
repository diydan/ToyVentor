// Tree kinds and the orchard (docs/specs/playful-interactions-spec.md section 3, "many fruit and tree types").
//
// `tree()` in world.ts draws a tree of a given kind from `treeShape`: trunk height, crown shape (the lumpy blobs), leaf tint and blossoms; the prop fx (propReactions.ts) reads the kind
// off the tree's group (`userData.treeKind`) to hang, drop and regrow THAT kind's fruit, `slots` of them. `orchardKind(world, i)` picks the kind of the i-th tree in a world so a row of trees
// is mixed and the first is always the apple tree the Garden had before there were kinds. Pure data plus a few pure functions, so the choices (a pear tree really bears pears; the first tree
// stays what it was; blossoms sit on the crown) are tested in node. Palms and bushes are listed here too (the Beach and the berry bushes have their own builders and are NOT wired to kinds yet).
import type { NounKey } from "../../../../lib/propNames";
import type { FruitKind } from "./propReactions";

/** How the crown is built. "round", "tall" and "wide" are lumpy blob crowns (`CROWN_BLOBS`); "palm" is fronds on a bent trunk and "bush" is a low mound; the builder owns those two. */
export type CrownShape = "round" | "tall" | "wide" | "palm" | "bush";

export interface TreeKind {
  id: string;
  crown: CrownShape;
  /** A tint multiplied onto the leaf texture (hex): white leaves the texture as it is, anything else shifts its colour a little (a lime pear tree, a blush cherry tree). */
  leaf: string;
  /** Trunk height in world units (the apple tree's lathe is 3.7). A bush has none. */
  trunk: number;
  /** The fruit it bears, a key of the `FRUIT` table in propReactions.ts. */
  fruit: FruitKind;
  /** How many hang at once (each regrows after it is picked). */
  slots: number;
  /** Blossom colour for the little flower spheres in the crown, or null for none. */
  blossom: string | null;
  /** Worlds where this kind grows. */
  worlds: ReadonlyArray<string>;
}

// The first entry is the tree the Garden has today (same crown, leaf texture colour, trunk and three apples), so adding the others changes nothing that was already there.
export const TREE_KINDS: ReadonlyArray<TreeKind> = [
  { id: "apple", crown: "round", leaf: "#ffffff", trunk: 3.7, fruit: "apple", slots: 3, blossom: "#ff9db0", worlds: ["garden", "sky"] },
  { id: "pear", crown: "tall", leaf: "#e2ff9e", trunk: 3.4, fruit: "pear", slots: 3, blossom: "#fff6ea", worlds: ["garden"] },
  { id: "orange", crown: "round", leaf: "#b8f0c8", trunk: 3.2, fruit: "orange", slots: 3, blossom: "#fff6ea", worlds: ["garden"] },
  { id: "cherry", crown: "wide", leaf: "#ffe2e8", trunk: 3.5, fruit: "cherry", slots: 3, blossom: "#ffb3c8", worlds: ["garden", "sky"] },
  // The same tree with green apples (a colour variant): a lighter leaf, and the fruit says "green apple".
  { id: "greenapple", crown: "round", leaf: "#e6ffb8", trunk: 3.6, fruit: "greenapple", slots: 3, blossom: "#ff9db0", worlds: ["garden"] },
  { id: "plum", crown: "wide", leaf: "#d9c8ff", trunk: 3.3, fruit: "plum", slots: 3, blossom: "#e7c8ff", worlds: ["garden"] },
  { id: "lemon", crown: "round", leaf: "#f6ffb0", trunk: 3.0, fruit: "lemon", slots: 3, blossom: "#fff6ea", worlds: ["garden"] },
  { id: "coconut", crown: "palm", leaf: "#ffffff", trunk: 4.2, fruit: "coconut", slots: 2, blossom: null, worlds: ["beach"] },
  { id: "banana", crown: "palm", leaf: "#e2ff9e", trunk: 3.6, fruit: "banana", slots: 3, blossom: null, worlds: ["beach"] },
  { id: "strawberry", crown: "bush", leaf: "#ffffff", trunk: 0, fruit: "strawberry", slots: 4, blossom: "#fff6ea", worlds: ["garden"] },
  { id: "blueberry", crown: "bush", leaf: "#d8f0ff", trunk: 0, fruit: "blueberry", slots: 4, blossom: "#fff6ea", worlds: ["garden"] },
  // The pumpkin patch (outdoorProps.ts `buildPumpkinPatch`): grows in no world by itself, so a row of bushes never turns into pumpkins; the patch names its own kind.
  { id: "pumpkin", crown: "bush", leaf: "#ffffff", trunk: 0, fruit: "pumpkin", slots: 3, blossom: null, worlds: [] },
];

/** The blobs of a lumpy crown: [x, y, z, radius, seed], relative to the trunk foot. "round" is the apple tree's six blobs exactly as `tree()` in world.ts has them. */
export const CROWN_BLOBS: Readonly<Record<"round" | "tall" | "wide", ReadonlyArray<readonly [number, number, number, number, number]>>> = {
  round: [[0, 4.1, 0, 1.45, 1], [-.95, 3.5, .3, 1.0, 2], [.95, 3.6, -.2, 1.05, 3], [.2, 4.85, .1, .95, 4], [-.4, 4.3, .9, .85, 5], [.6, 3.9, .85, .8, 6]],
  // A narrower, taller crown stacked up the trunk: a pear tree.
  tall: [[0, 4.0, 0, 1.15, 1], [-.5, 3.4, .25, .85, 2], [.55, 3.5, -.15, .9, 3], [.05, 5.0, .05, .95, 4], [-.3, 4.5, .7, .72, 5], [.4, 4.3, .65, .7, 6]],
  // A broad, low, spreading crown: cherry and plum.
  wide: [[0, 3.9, 0, 1.3, 1], [-1.35, 3.5, .3, 1.0, 2], [1.35, 3.55, -.2, 1.05, 3], [.1, 4.55, .1, .95, 4], [-.7, 4.05, .95, .8, 5], [.9, 3.95, .85, .8, 6]],
};

/** The apple tree's own look, exactly as `tree()` in world.ts drew it before there were kinds: the golden values `treeShape("apple")` must keep returning. */
const APPLE_BLOSSOMS: ReadonlyArray<readonly [number, number, number, string]> = [[.7, 4.4, 1.25, "#ff9db0"], [-1.2, 3.9, .85, "#ffd24d"], [.3, 3.5, 1.55, "#ff9db0"], [-.3, 4.7, 1.2, "#ffd24d"]];
/** Directions (unit-ish, +z towards the camera) from a blob's centre to where a blossom sits on it, for the crowns that are not the apple tree's. */
const BLOSSOM_DIRS: ReadonlyArray<readonly [number, number, number]> = [[0.4, 0.3, 0.86], [-0.5, 0.1, 0.86], [0.1, -0.2, 0.97], [-0.2, 0.3, 0.93]];

export interface TreeShape {
  /** Trunk height (the lathe's `u * trunk`). */
  trunk: number;
  /** The crown's lumpy blobs: [x, y, z, radius, seed]. */
  blobs: ReadonlyArray<readonly [number, number, number, number, number]>;
  /** The little flower spheres on the crown's face: [x, y, z, colour]. */
  blossoms: ReadonlyArray<readonly [number, number, number, string]>;
  /** The tint for the leaf texture, or null for the plain texture (the apple tree). */
  leafTint: string | null;
}

/** What `tree()` draws for a blob-crowned kind (round, tall, wide); null for palms and bushes, which have their own builders. The apple tree's shape is exactly what the Garden always had. */
export function treeShape(kind: TreeKind): TreeShape | null {
  if (kind.crown !== "round" && kind.crown !== "tall" && kind.crown !== "wide") return null;
  const blobs = CROWN_BLOBS[kind.crown];
  const isApple = kind.id === "apple";
  const a = kind.blossom ?? "#fff6ea";
  const blossoms = isApple
    ? APPLE_BLOSSOMS
    : BLOSSOM_DIRS.map(([dx, dy, dz], i) => {
        const b = blobs[i]!;
        const n = Math.hypot(dx, dy, dz);
        return [b[0] + (dx / n) * b[3], b[1] + (dy / n) * b[3], b[2] + (dz / n) * b[3], i % 2 ? "#ffd24d" : a] as const;
      });
  return { trunk: kind.trunk, blobs, blossoms, leafTint: kind.leaf.toLowerCase() === "#ffffff" ? null : kind.leaf };
}

/** Where the hanging fruit sit on the crown, as [azimuth, elevation] in degrees from the crown centre (the same convention `propReactions` places apples with). The first three are the apple tree's. */
export const SLOT_DIRS: ReadonlyArray<readonly [number, number]> = [[-38, -8], [12, -24], [50, -6], [-8, -34]];

export function slotDirs(n: number): ReadonlyArray<readonly [number, number]> {
  return SLOT_DIRS.slice(0, Math.max(0, Math.min(SLOT_DIRS.length, Math.floor(n))));
}

export function kindById(id: string): TreeKind | undefined {
  return TREE_KINDS.find((k) => k.id === id);
}

/** The kinds that grow in a world, in table order. */
export function kindsFor(world: string): TreeKind[] {
  return TREE_KINDS.filter((k) => k.worlds.includes(world));
}

/** Which crowns each kind of prop can grow: a `tree` prop the blob crowns, a `palm` the palm crown, a `bushes` prop the bush crown. A kind on the wrong prop is ignored (a pear on a bush is not a thing). */
export const CROWNS_FOR_PROP: Readonly<Record<string, ReadonlyArray<CrownShape>>> = { tree: ["round", "tall", "wide"], palm: ["palm"], bushes: ["bush"], pumpkins: ["bush"] };
export const kindFits = (propType: string, kind: TreeKind): boolean => !!CROWNS_FOR_PROP[propType]?.includes(kind.crown);

/** Where a palm's fruit hang, relative to the top of its trunk where the fronds meet: under the fronds and in front of the trunk, so the camera sees them. The first `slots` of these are used. */
export const PALM_FRUIT_OFFSETS: ReadonlyArray<readonly [number, number, number]> = [[0.3, -0.3, 0.34], [-0.28, -0.33, 0.36], [0.02, -0.4, 0.42]];
export function palmFruitOffsets(kind: TreeKind): ReadonlyArray<readonly [number, number, number]> {
  return PALM_FRUIT_OFFSETS.slice(0, Math.min(kind.slots, PALM_FRUIT_OFFSETS.length));
}
/** The two greens the fronds alternate between. The coconut palm's are the Beach's own, as `palm()` always drew them. */
export function palmFronds(kind: TreeKind): readonly [string, string] {
  return kind.id === "banana" ? ["#6bd36a", "#58c25c"] : ["#249a5c", "#2fae6a"];
}

function pick(kinds: TreeKind[], index: number): TreeKind | undefined {
  if (!kinds.length) return undefined;
  const i = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
  return kinds[i % kinds.length];
}

/**
 * The kind of the i-th prop of a type placed in a world: the world's kinds that fit that prop, in a fixed order, so a row is mixed (two neighbours never match while there are two or more
 * kinds) and the same level always grows the same orchard. Number 0 is the first kind in the table order that grows there (the apple tree in the Garden, the coconut palm on the Beach), so what
 * each world already had stays what it is. A world with none yields undefined (the caller keeps whatever it built before).
 */
export function kindFor(world: string, propType: string, index: number): TreeKind | undefined {
  return pick(kindsFor(world).filter((k) => kindFits(propType, k)), index);
}
/** The i-th TREE in a world (the apple tree first), the i-th PALM (the coconut palm first) and the i-th BUSH (strawberry first). */
export const orchardKind = (world: string, index: number) => kindFor(world, "tree", index);
export const palmKind = (world: string, index: number) => kindFor(world, "palm", index);
export const bushKind = (world: string, index: number) => kindFor(world, "bushes", index);

/** What a tapped tree, palm or bush of this kind is called ("pear tree", "banana palm", "strawberry bush"), as a vocabulary noun in all seven languages. */
export const KIND_NOUN: Readonly<Record<string, NounKey>> = {
  apple: "appletree", greenapple: "appletree", pear: "peartree", orange: "orangetree", cherry: "cherrytree", plum: "plumtree", lemon: "lemontree",
  coconut: "coconutpalm", banana: "bananapalm", strawberry: "strawberrybush", blueberry: "blueberrybush", pumpkin: "pumpkin",
};
export const kindNoun = (k: TreeKind | undefined | null): NounKey | null => (k ? KIND_NOUN[k.id] ?? null : null);
