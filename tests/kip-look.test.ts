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
  KID_FACE_Y,
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
import { BALL_JOINT_MM, FIST_IN_HOLDER, KIP_HIP_MM } from "../src/features/game/world/runtime/stlRigLoader";
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
    // The wardrobe's builder seats the plate at a CREATION default (17.1875), and the bench re-seats it for the head it shows: faceplateHolder.position.set(0, dt.faceY - 2.50 + raise, FACE_STEM_MM - sink),
    // with the kid head's faceY = 12.5. The game's Kip is the kid head, so it is the second number that is on screen (the first was copied by mistake and put the plate 4.69 mm too high: Dan, 2026-11-04,
    // "I'm pretty sure the head or face plate are not aligned").
    expect(wardrobe).toContain("faceplateHolder.position.set(0, 17.1875 - 2.50 + FACEPLATE_SEAT_MM.raise, FACE_STEM_MM - FACEPLATE_SEAT_MM.sink)");
    const bench = read("parts/kip/viewer/kip-bench.js");
    expect(bench).toContain("kip.exp.faceplateHolder.position.set(0, dt.faceY - 2.50 + FACEPLATE_SEAT_MM.raise, FACE_STEM_MM - FACEPLATE_SEAT_MM.sink)");
    const kid = (wardrobeMod as unknown as { WARDROBE_HEADS: Array<{ id: string; faceY: number }> }).WARDROBE_HEADS.find((h) => h.id === "kid")!;
    expect(KID_FACE_Y).toBe(kid.faceY);
    expect(FACEPLATE_HOLDER.y).toBeCloseTo(kid.faceY - 2.5 + S.FACEPLATE_SEAT_MM.raise, 9);
    expect(FACEPLATE_HOLDER.y).toBeCloseTo(10.7, 9);          // not the 15.39 it was
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
        if (o.userData.shadowProxy) return; // the invisible stand-in that casts the part's shadow (runtime/shadowProxy.ts), not something Kip wears
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (m && (o as THREE.Mesh).isMesh && m.color) out.add(m.color.getHexString());
      });
      return [...out];
    };
    const skin = plastic(col.skin).color.getHexString();
    for (const arm of rig.arms) expect(colours(arm), "an arm and its hand are skin").toEqual([skin]);
    expect(colours(rig.body!), "the torso is the shirt").toEqual([paintMat(col.c1).color.getHexString()]);
    // the legs are the pants and the boots the demo's boot colour, and the ball joint at each ankle is bare skin (it shows between the trouser hem and the boot)
    for (const foot of rig.feet) expect(colours(foot).sort(), "the legs are the pants and the boots the demo's boot colour, the ankle ball skin").toEqual([paintMat(col.c2).color.getHexString(), plastic(KIP_BOOT_HEX).color.getHexString(), plastic("#ff6b4a").color.getHexString(), skin].filter((v, i, a2) => a2.indexOf(v) === i).sort());
    // the plate: found by its place in the head, seated at the demo's holder position and turned half a turn
    let holder: THREE.Object3D | null = null;
    rig.head!.traverse((o: THREE.Object3D) => {
      if (Math.abs(o.position.y - FACEPLATE_HOLDER.y) < 1e-9 && Math.abs(o.position.z - FACEPLATE_HOLDER.z) < 1e-9) holder = o;
    });
    expect(holder, "the plate holder is at the demo's seat").not.toBeNull();
    expect((holder as unknown as THREE.Object3D).children[0]!.rotation.y).toBeCloseTo(Math.PI, 9);
    // the two orange crown studs: in the head, in the spark colour, and pulled toward the camera so the orange beats the studs under them. The stock Kip wears the Swept wig now, so they sit
    // on the wig's studs (the demo's hairCrownBuds: `topH` 4.8 mm above the head's stud plane), not on the head's own
    let buds: THREE.Mesh | null = null;
    rig.head!.traverse((o: THREE.Object3D) => { if (o.userData.kipBuds) buds = o as THREE.Mesh; });
    expect(buds, "the crown buds are on the head").not.toBeNull();
    const bm = (buds as unknown as THREE.Mesh).material as THREE.MeshPhysicalMaterial;
    expect(bm.color.getHexString()).toBe(plastic(KIP_BOOT_HEX).color.getHexString());
    expect(bm.polygonOffset).toBe(true);
    expect((buds as unknown as THREE.Mesh).position.y).toBeCloseTo(KID_CROWN_Y + 4.8, 9);
    // no canvas in a unit test: the plate is plain skin (the face is added in a browser)
    expect(typeof document).toBe("undefined");
    expect((holder as unknown as THREE.Object3D).children).toHaveLength(1);
  });

  it("the joints are closed the way the bench closes them: the Snap torso, a big turret at each shoulder and hip, a small one at each wrist and ankle (Dan: \"still not ankles, wrists or shoulder joints? just a gap/void?\")", async () => {
    // the bench's own numbers, read from its source: where each turret goes and which kind
    const benchRig = read("parts/kip/viewer/kip-rig.js");
    for (const line of [
      "shoAnchor.position.set(side * 17.2, 33.5, 0);", "addSnapTurretMesh(snapShoTurret, true, 'x');",
      "hipAnchor.position.set(side * 10.8, 0, 0);", "addSnapTurretMesh(snapHipTurret, true, 'y');",
      "snapWriAnchor.position.set(0, -35.0, 3.8);", "addSnapTurretMesh(snapWriTurret, false, 'y');",
      "snapAnkAnchor.position.set(0, -39.2, 0);", "addSnapTurretMesh(snapAnkTurret, false, 'y');",
      "snapTorsoSlot.add(scadMesh(geos.snap_torso, mats.shell));",
    ]) expect(benchRig, line).toContain(line);
    const sel = stockSel().character as unknown as RigSel;
    const col = stockCol();
    const recipe = resolveStlHeroRecipe("character", { ...sel } as unknown as RigSel, "seed-kip");
    expect(recipe.parts.find((p) => p.key === "torso")!.url).toBe("/kip/stls/snap_torso.stl");   // the Pro torso has open sockets for the Pro pegs: voids with Snap limbs
    expect(recipe.parts.map((p) => p.key)).toEqual(expect.arrayContaining(["snapTurretBig", "snapTurret"]));
    const rig = buildToy("character", sel, col);
    expect(await upgradeRigWithStl(rig, { type: "character", sel, col, toyId: "seed-kip", fetcher: diskFetcher })).toBe(true);
    rig.g.updateMatrixWorld(true);
    const found: Record<string, THREE.Object3D[]> = { shoulder: [], hip: [], wrist: [], ankle: [] };
    rig.g.traverse((o: THREE.Object3D) => { const k = o.userData.snapTurret as string | undefined; if (k) found[k]!.push(o); });
    for (const k of ["shoulder", "hip", "wrist", "ankle"]) expect(found[k], k).toHaveLength(2);
    const snap = rig.snap as { arms: Array<{ fore: THREE.Object3D }>; legs: Array<{ lower: THREE.Object3D }> };
    // the wrist turret rides the end of the bent sleeve and the ankle turret the end of the bent leg (so they go where the elbow and knee put them); the shoulder and hip ones are fixed to the body
    for (let i = 0; i < 2; i++) {
      expect(snap.arms.some((a) => found.wrist![i]!.parent === a.fore), "a wrist turret on a sleeve's end").toBe(true);
      expect(snap.legs.some((l) => found.ankle![i]!.parent === l.lower), "an ankle turret on a leg's end").toBe(true);
    }
    const bodyFrame = found.shoulder![0]!.parent!;
    for (const o of [...found.shoulder!, ...found.hip!]) expect(o.parent, "fixed to the body, not to a limb").toBe(bodyFrame);
    const xs = (list: THREE.Object3D[]) => list.map((o) => +o.position.x.toFixed(3)).sort((a, b) => a - b);
    expect(xs(found.shoulder!)).toEqual([-17.2, 17.2]);
    expect(xs(found.hip!)).toEqual([-10.8, 10.8]);
    for (const o of found.shoulder!) expect(o.position.y).toBeCloseTo(KIP_HIP_MM + 33.5, 6);
    for (const o of found.hip!) expect(o.position.y).toBeCloseTo(KIP_HIP_MM, 6);
    // each is built the way the bench builds it (`addSnapTurretMesh`): the STL's own axis (z, h long: 17.9 for a big one, 14.6 for a small) lowered by half its length, and a shoulder's lying along x
    for (const [kind, list] of Object.entries(found)) for (const o of list) {
      const mesh = o.children[0] as THREE.Mesh;                                     // each turret is a holder (at the joint, turned for a shoulder) around its mesh
      mesh.geometry.computeBoundingBox();
      const h = mesh.geometry.boundingBox!.max.z - mesh.geometry.boundingBox!.min.z;
      expect(h, `${kind} turret length`).toBeCloseTo(kind === "shoulder" || kind === "hip" ? 17.9 : 14.6, 0);
      expect(mesh.position.y, `${kind} lowered by half its length`).toBeCloseTo(-h / 2, 6);
      expect(mesh.rotation.x, `${kind} stood up like every other part`).toBeCloseTo(-Math.PI / 2, 9);
      expect(o.rotation.z, `${kind} axis`).toBeCloseTo(kind === "shoulder" ? Math.PI / 2 : 0, 9);
    }
  });

  it("every joint where a limb meets the body or the next part has a ball joint, so nothing hangs: a ball at each shoulder and hip (fixed to the body), each wrist (on the end of the sleeve) and each ankle (on the end of the leg) (Dan: \"connected by the ball joint for aesthetics\")", async () => {
    const sel = stockSel().character as unknown as RigSel;
    const col = stockCol();
    const rig = buildToy("character", sel, col);
    expect(await upgradeRigWithStl(rig, { type: "character", sel, col, toyId: "seed-kip", fetcher: diskFetcher })).toBe(true);
    rig.g.updateMatrixWorld(true);
    const found: Record<string, THREE.Mesh[]> = { shoulder: [], hip: [], wrist: [], ankle: [] };
    rig.g.traverse((o: THREE.Object3D) => { const k = o.userData.ballJoint as string | undefined; if (k) found[k]!.push(o as THREE.Mesh); });
    for (const k of Object.keys(BALL_JOINT_MM)) expect(found[k], k).toHaveLength(2);
    const snap = rig.snap as { arms: Array<{ fore: THREE.Object3D }>; legs: Array<{ lower: THREE.Object3D }> };
    for (const b of found.wrist!) expect(snap.arms.some((a) => b.parent === a.fore), "a wrist ball turns with the end of the sleeve, the hand about it").toBe(true);
    for (const b of found.ankle!) expect(snap.legs.some((l) => b.parent === l.lower), "an ankle ball is on the end of the leg, the boot about it").toBe(true);
    const frame = found.shoulder![0]!.parent!;
    for (const b of [...found.shoulder!, ...found.hip!]) expect(b.parent, "fixed to the body").toBe(frame);
    // where the bench's joints are (kip-rig.js): shoulders 18.2 out and 33.5 above the hips, hips 10.8 out; and each ball's size fits what it joins (the sleeve's cuff is 10.1 across its radius, the leg's hem 12)
    expect(found.shoulder!.map((b) => +b.position.x.toFixed(2)).sort((a, b) => a - b)).toEqual([-18.2, 18.2]);
    expect(found.hip!.map((b) => +b.position.x.toFixed(2)).sort((a, b) => a - b)).toEqual([-10.8, 10.8]);
    for (const b of found.shoulder!) expect(b.position.y).toBeCloseTo(KIP_HIP_MM + 33.5, 6);
    for (const b of found.hip!) expect(b.position.y).toBeCloseTo(KIP_HIP_MM, 6);
    for (const [k, list] of Object.entries(found)) for (const b of list) {
      const r = (b.geometry as THREE.SphereGeometry).parameters.radius;
      expect(r, k).toBe(BALL_JOINT_MM[k as keyof typeof BALL_JOINT_MM]);
      expect(r, `${k} ball is bigger than the limb end's thinnest part and no bigger than its widest`).toBeGreaterThan(6);
      expect(r, k).toBeLessThanOrEqual(k === "wrist" ? 10.1 : k === "ankle" ? 12 : 9);
    }
  });

  it("each hand has a grip anchor at the fist, turned and scaled to the arm holder's own frame, so what Kip holds is in his hand", async () => {
    const sel = stockSel().character as unknown as RigSel;
    const col = stockCol();
    const rig = buildToy("character", sel, col);
    expect(await upgradeRigWithStl(rig, { type: "character", sel, col, toyId: "seed-kip", fetcher: diskFetcher })).toBe(true);
    const grips = rig.grips as THREE.Object3D[];
    expect(grips).toHaveLength(2);
    rig.g.updateMatrixWorld(true);
    for (let i = 0; i < 2; i++) {
      const holder = rig.arms[i]!, grip = grips[i]!;
      expect(grip.userData.grip).toBe(true);
      expect(grip.parent, "a child of the hand joint, so it goes wherever the hand does").toBe((rig.snap as { arms: Array<{ hand: THREE.Object3D }> }).arms[i]!.hand);
      const inHolder = holder.worldToLocal(grip.getWorldPosition(new THREE.Vector3()));
      expect(inHolder.x).toBeCloseTo(FIST_IN_HOLDER.x, 6);
      expect(inHolder.y).toBeCloseTo(FIST_IN_HOLDER.y, 6);
      expect(inHolder.z).toBeCloseTo(i === 0 ? FIST_IN_HOLDER.z : -FIST_IN_HOLDER.z, 6);
      // at rest the grip's axes are the arm holder's own: y down the arm, +x forward, world units (the frame every held item's numbers are written in)
      const qh = holder.getWorldQuaternion(new THREE.Quaternion()), qg = grip.getWorldQuaternion(new THREE.Quaternion());
      expect(1 - Math.abs(qh.dot(qg))).toBeLessThan(1e-9);
      const sc = grip.getWorldScale(new THREE.Vector3()), sh = holder.getWorldScale(new THREE.Vector3());
      expect(sc.x / sh.x).toBeCloseTo(1, 6);
      // and it really is where the hand's fist is: inside the hand mesh's box (the hand spans 0.65 to 1.04 down the arm)
      expect(inHolder.y).toBeLessThan(-0.65);
      expect(inHolder.y).toBeGreaterThan(-1.04);
    }
  });

  it("the other heads are unchanged: a creature keeps cream arms and hands", async () => {
    const sel = { ...OLD_STOCK_CHARACTER } as unknown as RigSel;
    const col = { ...OLD_STOCK_COL };
    const rig = buildToy("character", sel, col);
    expect(await upgradeRigWithStl(rig, { type: "character", sel, col, toyId: "seed-kip", fetcher: diskFetcher })).toBe(true);
    const cream = plastic("#f4efe6", { roughness: 0.48, clearcoat: 0.25 }).color.getHexString();
    const found = new Set<string>();
    rig.arms[0]!.traverse((o) => {
      if (o.userData.shadowProxy) return; // the invisible shadow stand-in is not a colour Kip wears
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && (o as THREE.Mesh).isMesh && m.color) found.add(m.color.getHexString());
    });
    expect([...found]).toEqual([cream]);
  });
});

// Every character the game can make wears the Snap body: the figure, the vinyl animals (bear, cat, fox), the creatures (imp, dragon, alien) and the robots (visor, scout) differ in head, ears, hat,
// back and tail only (stlRigLoader.ts resolveStlHeroRecipe). Dan, 2026-11-04, after the ball joints: "do" the check on the robot, animal and creature. Looked at on the real game with a shrug, a cheer and
// a kick on all nine (2026-11-04); this keeps it so: a new head that skipped the Snap torso, a joint or a grip would be caught here.
describe("every kind of character has the joints (the body is shared; only the head, ears, hat, back and tail differ)", () => {
  afterEach(() => clearStlRigCache());
  const HEADS: Array<[string, Record<string, string>]> = [
    ["figure", { base: "block" }],
    ["bear", { base: "vinyl", ears: "bear" }], ["cat", { base: "vinyl", ears: "cat" }], ["fox", { base: "vinyl" }],
    ["imp", { base: "creature" }], ["dragon", { base: "creature", ears: "horns" }], ["alien", { base: "creature", ears: "antennae" }],
    ["robot visor", { base: "robot.head.box" }], ["robot scout", { base: "robot.head.dome" }],
  ];
  const BODY_PARTS = ["torso", "neckTurret", "snapTurretBig", "snapTurret", "snapArm", "handL", "handR", "snapLeg", "boot"];
  const selOf = (over: Record<string, string>) => ({ ...stockSel().character, ears: "none", ...over }) as unknown as RigSel;
  const meshOf = (root: THREE.Object3D, geo: THREE.BufferGeometry): THREE.Mesh => { let m: THREE.Mesh | null = null; root.traverse((o) => { if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry === geo) m = o as THREE.Mesh; }); return m!; };
  const colourOf = (o: THREE.Object3D) => ((o as THREE.Mesh).material as THREE.MeshStandardMaterial).color.getHexString();

  it("is the same list of body files for every head, with the Snap torso", () => {
    const keys = HEADS.map(([, over]) => resolveStlHeroRecipe("character", selOf(over), "seed-kip").parts.filter((p) => BODY_PARTS.includes(p.key)).map((p) => `${p.key}=${p.url}`));
    for (const k of keys) expect(k).toEqual(keys[0]);
    expect(keys[0]).toContain("torso=/kip/stls/snap_torso.stl");
    expect(keys[0]).toHaveLength(BODY_PARTS.length);
  });

  for (const [name, over] of HEADS) {
    it(`${name}: a ball and a turret at every shoulder, hip, wrist and ankle, a grip in each hand, the neck hinge, and each ball in its limb's own colour`, async () => {
      const sel = selOf(over), col = stockCol();
      const rig = buildToy("character", sel, col);
      expect(await upgradeRigWithStl(rig, { type: "character", sel, col, toyId: "seed-kip", fetcher: diskFetcher })).toBe(true);
      rig.g.updateMatrixWorld(true);
      const balls: Record<string, THREE.Object3D[]> = { shoulder: [], hip: [], wrist: [], ankle: [] };
      const turrets: Record<string, THREE.Object3D[]> = { shoulder: [], hip: [], wrist: [], ankle: [] };
      rig.g.traverse((o: THREE.Object3D) => {
        if (o.userData.ballJoint) balls[o.userData.ballJoint as string]!.push(o);
        if (o.userData.snapTurret) turrets[o.userData.snapTurret as string]!.push(o);
      });
      for (const k of Object.keys(balls)) { expect(balls[k], `${k} balls`).toHaveLength(2); expect(turrets[k], `${k} turrets`).toHaveLength(2); }
      expect(rig.grips, "a grip in each hand").toHaveLength(2);
      expect(rig.head!.userData.hinge, "the head turns about the neck's foot").toBeTruthy();
      const snap = rig.snap as { arms: Array<{ flex: { geometry: THREE.BufferGeometry }; fore: THREE.Object3D }>; legs: Array<{ flex: { geometry: THREE.BufferGeometry }; lower: THREE.Object3D }> };
      expect(snap.arms).toHaveLength(2);
      expect(snap.legs).toHaveLength(2);
      // each ball is the colour of the limb it joins: the shoulder and wrist the sleeve's, the hip the trousers' (the ankle is the sleeve's, bare, between the hem and the boot)
      const armColour = colourOf(meshOf(rig.g, snap.arms[0]!.flex.geometry));
      const legColour = colourOf(meshOf(rig.g, snap.legs[0]!.flex.geometry));
      for (const b of [...balls.shoulder!, ...balls.wrist!, ...balls.ankle!]) expect(colourOf(b), `${b.userData.ballJoint} ball`).toBe(armColour);
      for (const b of balls.hip!) expect(colourOf(b), "hip ball").toBe(legColour);
      for (const a of snap.arms) expect(balls.wrist!.some((b) => b.parent === a.fore), "a wrist ball on each sleeve's end").toBe(true);
      for (const l of snap.legs) expect(balls.ankle!.some((b) => b.parent === l.lower), "an ankle ball on each leg's end").toBe(true);
    });
  }
});
