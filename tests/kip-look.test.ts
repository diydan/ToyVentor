// The default Kip, dressed the way the Kip demo dresses him (runtime/kipLook.ts; Dan, 2026-11-04: "the default kip is weird, use the kip skin colors, add shirts and pants and a face from the
// kip demo, the new ones have inset face plates"). The copies must not drift from the demo's files: its tables, its body colours, the plate outline, the seat, and the face art call by call.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error untyped JS module
import * as wardrobeMod from "../parts/kip/viewer/kip-vehicles-wardrobe.js";
// @ts-expect-error untyped JS module
import * as shapeMod from "../parts/kip/viewer/kip-faceplate-shape.js";
// @ts-expect-error untyped JS module
import * as sdkMod from "../parts/kip/viewer/kip-forge-sdk.js";
import { SKINS, stockCol, stockSel } from "../src/features/game/world/runtime/catalog";
import {
  FACEPLATE_HOLDER,
  FACEPLATE_SEAT_MM,
  FACE_DECAL,
  FACE_STEM_MM,
  KID_CROWN_Y,
  KIP_BOOT_HEX,
  KIP_DEFAULT_CHARACTER,
  KIP_DEFAULT_COL,
  KIP_PANTS,
  KIP_SHIRT,
  KIP_SKIN_TONES,
  OLD_STOCK_CHARACTER,
  OLD_STOCK_COL,
  PLATE_HALF_WIDTH,
  drawKipFace,
  kipBodyColors,
  migrateOldStockKip,
  plateHalfWidth,
} from "../src/features/game/world/runtime/kipLook";
import { buildFaceDecalGeometry } from "../src/features/game/world/runtime/kipFacePlate";
import { buildToy, clearStlRigCache, resolveStlHeroRecipe, upgradeRigWithStl, type RigSel } from "../src/features/game/world/runtime/playerRig";
import { paintMat, plastic } from "../src/features/game/world/runtime/worldScene";

/* eslint-disable @typescript-eslint/no-explicit-any */
const W = wardrobeMod as any;
const S = shapeMod as any;
const SDK = sdkMod as any;
const ROOT = process.cwd();
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

function diskFetcher(url: string): Promise<ArrayBuffer | null> {
  const clean = url.split("?")[0] ?? url;
  const full = resolve(ROOT, "public", clean.replace(/^\//, ""));
  if (!existsSync(full)) return Promise.resolve(null);
  const buf = readFileSync(full);
  return Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

describe("the colours are the demo's", () => {
  it("the skin tones are the demo's five, in order, and the Create screen paints with them", () => {
    expect(KIP_SKIN_TONES.map((t) => ({ ...t }))).toEqual(W.SKIN_TONES);
    expect(SKINS).toEqual(W.SKIN_TONES.map((t: { hex: string }) => t.hex.toLowerCase()));
  });

  it("the shirt and the pants he wears are the demo's Spark Bolt Tee and Cuffed Jeans, to the last field", () => {
    expect({ ...KIP_SHIRT }).toEqual(W.SHIRT_OPTIONS.find((s: { id: string }) => s.id === "spark_tee"));
    expect({ ...KIP_PANTS }).toEqual(W.PANTS_OPTIONS.find((p: { id: string }) => p.id === "jeans"));
  });

  it("each part is painted the way the demo paints it (resolveBodyColors): shirt on the torso, bare arms and hands in a short-sleeved tee, pants on the legs, the pants' shoes", () => {
    const demo = W.resolveBodyColors({ head: "kid", skinId: "warm_peach", shirtId: "spark_tee", pantsId: "jeans" });
    const mine = kipBodyColors(KIP_DEFAULT_COL);
    const up = (c: string) => c.toUpperCase();
    expect(up(mine.torso)).toBe(demo.chestHex);
    expect(up(mine.arms)).toBe(demo.forearmHex);
    expect(up(mine.hands)).toBe(demo.bodySkinHex);
    expect(up(mine.neck)).toBe(demo.neckHex);
    expect(up(mine.head)).toBe(demo.headSkinHex);
    expect(up(mine.legs)).toBe(demo.thighHex);
    expect(up(mine.legs)).toBe(demo.shinHex);
    expect(up(mine.boots)).toBe(demo.activeShoeHex);
    expect(KIP_BOOT_HEX).toBe(KIP_PANTS.shoeHex.toLowerCase());
  });

  it("a child's own colours move the shirt and the pants and the skin, and the skin is never left blank", () => {
    expect(kipBodyColors({ c1: "#112233", c2: "#445566", skin: "#8a5035" })).toMatchObject({ torso: "#112233", legs: "#445566", arms: "#8a5035", hands: "#8a5035", neck: "#8a5035", head: "#8a5035" });
    expect(kipBodyColors({ c1: "#112233", c2: "#445566" }).arms).toBe(KIP_DEFAULT_COL.skin);
  });
});

describe("the stock toy", () => {
  it("is the human Figure Pal in the demo's colours: no horns, no tail, nothing on the head", () => {
    expect(stockSel().character).toEqual({ ...KIP_DEFAULT_CHARACTER });
    expect(stockCol()).toEqual({ ...KIP_DEFAULT_COL });
    expect(stockSel().character.base).toBe("block");
    expect(stockSel().character.ears).toBe("none");
    expect(stockSel().character.tail).toBe("none");
  });

  it("each call returns fresh objects (the game mutates what it is given)", () => {
    const a = stockSel();
    a.character.hat = "cap";
    expect(stockSel().character.hat).toBe("none");
    const c = stockCol();
    c.c1 = "#000000";
    expect(stockCol().c1).toBe(KIP_DEFAULT_COL.c1);
  });

  it("the Create screen can paint his skin (it only offers skin for the human base) and the game no longer hard-codes the old gold for the seed Kip", () => {
    const world = read("src/features/game/world/runtime/world.ts");
    expect(world).toContain('cur().base==="block"');
    expect(world).not.toContain('c.id==="seed-kip"?{c1:"#ffd24d"');
    expect(world).toContain("if(!sameToy)S.col=stockCol();");
  });
});

describe("a saved game that still has the old gold dragon is moved to the new Kip", () => {
  const oldState = () => ({ type: "character", sel: { character: { ...OLD_STOCK_CHARACTER }, vehicle: { chassis: "car" } }, col: { ...OLD_STOCK_COL }, found: { a: true } }) as any;

  it("moves the untouched old stock Kip, keeps the rest of the state, and says it changed", () => {
    const s = oldState();
    expect(migrateOldStockKip(s)).toBe(true);
    expect(s.sel.character).toEqual({ ...KIP_DEFAULT_CHARACTER });
    expect(s.col).toEqual({ ...KIP_DEFAULT_COL });
    expect(s.sel.vehicle).toEqual({ chassis: "car" });
    expect(s.found).toEqual({ a: true });
  });

  it("does it once: the new Kip is left alone", () => {
    const s = oldState();
    migrateOldStockKip(s);
    expect(migrateOldStockKip(s)).toBe(false);
  });

  it("leaves a Kip the child made their own: any one changed part, or any one changed colour", () => {
    for (const patch of [{ hat: "cap" }, { ears: "bear" }, { base: "vinyl" }, { tail: "none" }, { back: "wings" }]) {
      const s = oldState();
      Object.assign(s.sel.character, patch);
      expect(migrateOldStockKip(s), JSON.stringify(patch)).toBe(false);
      expect(s.sel.character).toMatchObject(patch);
      expect(s.col).toEqual({ ...OLD_STOCK_COL });
    }
    for (const patch of [{ c1: "#ff5a4d" }, { c2: "#5af0b0" }, { skin: "#a8673f" }]) {
      const s = oldState();
      Object.assign(s.col, patch);
      expect(migrateOldStockKip(s), JSON.stringify(patch)).toBe(false);
    }
  });

  it("ignores a vehicle, a robot and a state with nothing in it, and never throws", () => {
    expect(migrateOldStockKip({ type: "vehicle", sel: { character: { ...OLD_STOCK_CHARACTER } }, col: { ...OLD_STOCK_COL } } as any)).toBe(false);
    expect(migrateOldStockKip({} as any)).toBe(false);
    expect(migrateOldStockKip({ type: "character", sel: null, col: null } as any)).toBe(false);
    expect(migrateOldStockKip(null as any)).toBe(false);
  });

  it("is run when the game loads its save, and is the only place the old look is named", () => {
    const world = read("src/features/game/world/runtime/world.ts");
    expect(world).toContain('Object.assign(S,d);migrateOldStockKip(S)');
    expect(world).toContain('import { migrateOldStockKip } from "./kipLook";');
  });
});

describe("the plate sits where the demo seats it", () => {
  it("holder position and decal plane are the demo's numbers, read from its source", () => {
    const wardrobe = read("parts/kip/viewer/kip-vehicles-wardrobe.js");
    expect(FACE_STEM_MM).toBe(W.FACE_STEM_MM);
    expect({ ...FACEPLATE_SEAT_MM }).toEqual(S.FACEPLATE_SEAT_MM);
    // faceplateHolder.position.set(0, 17.1875 - 2.50 + raise, FACE_STEM_MM - sink)
    expect(wardrobe).toContain("faceplateHolder.position.set(0, 17.1875 - 2.50 + FACEPLATE_SEAT_MM.raise, FACE_STEM_MM - FACEPLATE_SEAT_MM.sink)");
    expect(FACEPLATE_HOLDER.y).toBeCloseTo(17.1875 - 2.5 + S.FACEPLATE_SEAT_MM.raise, 9);
    expect(FACEPLATE_HOLDER.z).toBeCloseTo(W.FACE_STEM_MM - S.FACEPLATE_SEAT_MM.sink, 9);
    // buildConformalFaceplateDecalGeo(insertGeo, width = 23.6, height = 10.1, centerY = 5.25), a 56 x 28 plane, +0.22 above the plate, 2.65 - x^2 * 0.002 where a ray misses
    expect(wardrobe).toContain("function buildConformalFaceplateDecalGeo(insertGeo, width = 23.6, height = 10.1, centerY = 5.25)");
    expect(wardrobe).toContain("new THREE.PlaneGeometry(width, height, 56, 28)");
    expect(wardrobe).toContain("pos.setZ(i, hitZ + 0.22)");
    expect(wardrobe).toContain("hitZ = 2.65 - (vx * vx) * 0.002");
    expect(FACE_DECAL).toMatchObject({ width: 23.6, height: 10.1, centerY: 5.25, segX: 56, segY: 28, lift: 0.22, fallbackZ: 2.65, fallbackK: 0.002 });
  });

  it("the crown studs sit at the kid head's stud plane, the demo's number", () => {
    expect(KID_CROWN_Y).toBe(W.WARDROBE_HEADS.find((h: { id: string }) => h.id === "kid").crownY);
    expect(read("parts/kip/viewer/kip-bench.js")).toContain("kip.exp.altCrownBuds.position.y = headCrownY;");
    expect(read("parts/kip/viewer/kip-vehicles-wardrobe.js")).toContain("altCrownBuds.scale.set(1.006, 1.01, 1.006)");
  });

  it("the head sits at the demo's headLocal height (108 mm), so the plate numbers mean the same thing in the game", () => {
    const rig = read("parts/kip/viewer/kip-rig.js");
    expect(rig).toContain("head.position.set(0, 45.3, 0)");
    expect(rig).toContain("headLocal.position.y = 1.2");
    expect(106.8 + 1.2).toBe(108.0); // hips 61.5 + 45.3 + 1.2 = 108.0, the game's headPivot
    expect(read("src/features/game/world/runtime/stlRigLoader.ts")).toContain("headPivot.position.set(0, 108.0, 0)");
  });

  it("the outline table that clips the face to the plate is the demo's, and so is its interpolation", () => {
    expect(PLATE_HALF_WIDTH.map((r) => [...r])).toEqual(S.PLATE_HALF_WIDTH);
    for (let zb = -0.5; zb <= 13.5; zb += 0.137) expect(plateHalfWidth(zb)).toBeCloseTo(S.plateHalfWidth(zb), 9);
  });
});

// A context that records every call and every property set, so two drawings can be compared one by one.
function recorder(): { ctx: any; log: unknown[][] } {
  const log: unknown[][] = [];
  const ctx: any = new Proxy({}, {
    get(_t, prop: string) {
      if (prop === "__log") return log;
      return (...args: unknown[]) => {
        log.push([prop, ...args.map((a) => (a && typeof a === "object" ? "<obj>" : a))]);
        if (prop === "createRadialGradient") return { addColorStop: (...a: unknown[]) => log.push(["addColorStop", ...a]) };
        return undefined;
      };
    },
    set(_t, prop: string, value: unknown) {
      log.push(["=" + prop, value && typeof value === "object" ? "<obj>" : value]);   // (a gradient is a fresh object each time)
      return true;
    },
  });
  return { ctx, log };
}

describe("the face is the demo's face", () => {
  it("draws exactly what the demo draws for 'spark', the kid head, the sculpted plate, for the plate: every call and every setting, in order", () => {
    const demo = recorder();
    const prev = (globalThis as any).document;
    (globalThis as any).document = { createElement: () => ({ width: 0, height: 0, getContext: () => demo.ctx }) };
    try {
      SDK.createDecalExpressionCanvas("spark", "kid", "sculpted", { onPlate: true });
    } finally {
      (globalThis as any).document = prev;
    }
    const mine = recorder();
    drawKipFace(mine.ctx);
    expect(mine.log.length).toBeGreaterThan(100);
    expect(mine.log).toEqual(demo.log);
  });

  it("is not blank: it draws two eyes, two brows, two blushes and a smile, and clips to the plate", () => {
    const r = recorder();
    drawKipFace(r.ctx);
    const names = r.log.map((l) => l[0]);
    expect(names.filter((n) => n === "createRadialGradient")).toHaveLength(2);
    expect(names.filter((n) => n === "ellipse").length).toBeGreaterThanOrEqual(2 + 2 * 6);
    expect(names).toContain("quadraticCurveTo");
    expect(r.log.some((l) => l[0] === "=globalCompositeOperation" && l[1] === "destination-in")).toBe(true);
  });
});

describe("the face lies on the plate", () => {
  it("every vertex of the 56 x 28 plane takes the real plate's height plus a hair, so the art follows the plate's curve", () => {
    const buf = readFileSync(resolve(ROOT, "public/kip/partspec/toyventor_char_faceplate_P.stl"));
    const plate = new STLLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const g = buildFaceDecalGeometry(plate);
    const pos = g.attributes.position!;
    expect(pos.count).toBe((56 + 1) * (28 + 1));
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      min = Math.min(min, pos.getZ(i));
      max = Math.max(max, pos.getZ(i));
    }
    // a flat sheet would have one z; the plate is domed and has a nose, so the plane bends, and every point is in front of the plate's back (> 0.2) and not floating metres away
    expect(max - min).toBeGreaterThan(0.5);
    expect(min).toBeGreaterThan(0.3);
    expect(max).toBeLessThan(10);
    g.computeBoundingBox();
    expect(g.boundingBox!.max.x).toBeCloseTo(11.8, 1);   // half of 23.6 mm
  });
});

describe("the rig wears it", () => {
  afterEach(() => clearStlRigCache());

  it("the stock recipe is the kid head with the sculpted plate and the orange crown buds, and every file is on disk", () => {
    const recipe = resolveStlHeroRecipe("character", { ...stockSel().character } as unknown as RigSel, "seed-kip");
    const keys = recipe.parts.map((p) => p.key);
    expect(keys).toContain("faceplate");
    expect(keys).toContain("crownBuds");
    expect(recipe.parts.find((p) => p.key === "headMain")!.url).toContain("char_head_kid");
    expect(recipe.parts.find((p) => p.key === "faceplate")!.url).toContain("char_faceplate_P");
    expect(keys).not.toContain("ears");
    expect(keys).not.toContain("tail");
    for (const p of recipe.parts) expect(existsSync(resolve(ROOT, "public", p.url.replace(/^\//, ""))), p.url).toBe(true);
  });

  it("a hat sits on the studs, so the buds step aside; a creature head keeps its own look", () => {
    const withHat = resolveStlHeroRecipe("character", { ...stockSel().character, hat: "cap" } as unknown as RigSel, "seed-kip");
    expect(withHat.parts.map((p) => p.key)).not.toContain("crownBuds");
    const dragon = resolveStlHeroRecipe("character", { ...OLD_STOCK_CHARACTER } as unknown as RigSel, "seed-kip");
    expect(dragon.parts.map((p) => p.key)).not.toContain("crownBuds");
    expect(dragon.parts.map((p) => p.key)).not.toContain("faceplate");
  });

  it("builds from the real STLs: bare skin arms and hands, the shirt on the torso, the pants on the legs, the plate seated like the demo's", async () => {
    const sel = stockSel().character as unknown as RigSel;
    const col = stockCol();
    const rig = buildToy("character", sel, col);
    expect(await upgradeRigWithStl(rig, { type: "character", sel, col, toyId: "seed-kip", fetcher: diskFetcher })).toBe(true);
    expect(rig.stlMode).toBe("stl");
    const colours = (root: THREE.Object3D): string[] => {
      const out = new Set<string>();
      root.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (m && (o as THREE.Mesh).isMesh && m.color) out.add(m.color.getHexString());
      });
      return [...out];
    };
    const skin = plastic(col.skin).color.getHexString();
    for (const arm of rig.arms) expect(colours(arm), "an arm and its hand are skin").toEqual([skin]);
    expect(colours(rig.body!), "the torso is the shirt").toEqual([paintMat(col.c1).color.getHexString()]);
    for (const foot of rig.feet) expect(colours(foot).sort(), "the legs are the pants and the boots the demo's boot colour").toEqual([paintMat(col.c2).color.getHexString(), plastic(KIP_BOOT_HEX).color.getHexString(), plastic("#ff6b4a").color.getHexString()].filter((v, i, a2) => a2.indexOf(v) === i).sort());
    // the plate: found by its place in the head, seated at the demo's holder position and turned half a turn
    let holder: THREE.Object3D | null = null;
    rig.head!.traverse((o: THREE.Object3D) => {
      if (Math.abs(o.position.y - FACEPLATE_HOLDER.y) < 1e-9 && Math.abs(o.position.z - FACEPLATE_HOLDER.z) < 1e-9) holder = o;
    });
    expect(holder, "the plate holder is at the demo's seat").not.toBeNull();
    expect((holder as unknown as THREE.Object3D).children[0]!.rotation.y).toBeCloseTo(Math.PI, 9);
    // the two orange crown studs: in the head, on the stud plane, in the spark colour, and pulled toward the camera so the orange beats the head's own studs
    let buds: THREE.Mesh | null = null;
    rig.head!.traverse((o: THREE.Object3D) => { if (o.userData.kipBuds) buds = o as THREE.Mesh; });
    expect(buds, "the crown buds are on the head").not.toBeNull();
    const bm = (buds as unknown as THREE.Mesh).material as THREE.MeshPhysicalMaterial;
    expect(bm.color.getHexString()).toBe(plastic(KIP_BOOT_HEX).color.getHexString());
    expect(bm.polygonOffset).toBe(true);
    expect((buds as unknown as THREE.Mesh).position.y).toBe(KID_CROWN_Y);
    // no canvas in a unit test: the plate is plain skin (the face is added in a browser)
    expect(typeof document).toBe("undefined");
    expect((holder as unknown as THREE.Object3D).children).toHaveLength(1);
  });

  it("the other heads are unchanged: a creature keeps cream arms and hands", async () => {
    const sel = { ...OLD_STOCK_CHARACTER } as unknown as RigSel;
    const col = { ...OLD_STOCK_COL };
    const rig = buildToy("character", sel, col);
    expect(await upgradeRigWithStl(rig, { type: "character", sel, col, toyId: "seed-kip", fetcher: diskFetcher })).toBe(true);
    const cream = plastic("#f4efe6", { roughness: 0.48, clearcoat: 0.25 }).color.getHexString();
    const found = new Set<string>();
    rig.arms[0]!.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && (o as THREE.Mesh).isMesh && m.color) found.add(m.color.getHexString());
    });
    expect([...found]).toEqual([cream]);
  });
});
