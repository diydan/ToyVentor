// Hair and the smooth cover on the game's Kip (runtime/kipLook.ts `resolveKipTop`, kipCover.ts; Dan, 2026-11-04: "default kip should have hat or hair, we should use the smooth cover if not hair or
// hat, or hide the studs"). The hair table must not drift from the Kip demo's, every wig must exist on disk, and the rule for what a head wears must hold.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
// @ts-expect-error untyped JS module
import * as wardrobeMod from "../parts/kip/viewer/kip-vehicles-wardrobe.js";
import { stockCol, stockSel } from "../src/features/game/world/runtime/catalog";
import {
  KIP_DEFAULT_HAIR_HEX,
  KIP_DEFAULT_HAIR_ID,
  KIP_HAIRSTYLES,
  KIP_HAIR_COLORS,
  kipHairStyle,
  kipHairUrl,
  resolveKipTop,
} from "../src/features/game/world/runtime/kipLook";
import { buildToy, resolveStlHeroRecipe, upgradeRigWithStl, type RigSel } from "../src/features/game/world/runtime/playerRig";
import { KID_CROWN_Y, KIP_WIG_LIFT_MM } from "../src/features/game/world/runtime/kipLook";
import { plastic } from "../src/features/game/world/runtime/worldScene";

const keys = (r: { parts: { key: string }[] }) => r.parts.map((p) => p.key);

describe("the hair table is the demo's", () => {
  it("has the demo's nineteen hairstyles, with the same fit numbers", () => {
    const demo = (wardrobeMod.HAIR_OPTIONS as { id: string; label: string; hatReady: boolean; topH: number; seatY: number }[]).filter((h) => h.id !== "off");
    expect(KIP_HAIRSTYLES.length).toBe(19);
    expect(KIP_HAIRSTYLES.map((h) => h.id)).toEqual(demo.map((h) => h.id));
    for (const h of KIP_HAIRSTYLES) {
      const d = demo.find((x) => x.id === h.id)!;
      expect({ hatReady: h.hatReady, topH: h.topH, seatY: h.seatY }).toEqual({ hatReady: d.hatReady, topH: d.topH, seatY: d.seatY });
    }
  });
  it("has the demo's six hair tones, the stock one first", () => {
    expect(KIP_HAIR_COLORS.map((c) => [c.id, c.hex.toLowerCase()])).toEqual((wardrobeMod.HAIR_COLORS as { id: string; hex: string }[]).map((c) => [c.id, c.hex.toLowerCase()]));
    expect(KIP_DEFAULT_HAIR_HEX).toBe("#6e412a");
  });
  it("every wig file exists under public/kip/partspec", () => {
    for (const h of KIP_HAIRSTYLES) expect(existsSync(resolve(__dirname, "..", "public", kipHairUrl(h.id).replace(/^\//, ""))), h.id).toBe(true);
  });
});

describe("what the top of a human head wears", () => {
  it("the stock Kip wears the Swept wig (hat-ready), not two bare studs", () => {
    expect(KIP_DEFAULT_HAIR_ID).toBe("short_swept");
    const top = resolveKipTop(stockSel().character);
    expect(top.kind).toBe("hair");
    expect(top.hair?.id).toBe("short_swept");
    expect(top.hair?.hatReady).toBe(true);
  });
  it("a hat comes first and a character that never chose hair gets none under it (so a saved toy with a hat looks as before)", () => {
    expect(resolveKipTop({ hat: "wizard" })).toEqual({ kind: "hat", hair: null });
  });
  it("a hat sits on a hat-ready wig, and drops a sculpted-top one", () => {
    expect(resolveKipTop({ hat: "cap", hair: "bob" })).toEqual({ kind: "hat", hair: kipHairStyle("bob") });
    expect(resolveKipTop({ hat: "cap", hair: "mohawk" })).toEqual({ kind: "hat", hair: null });
  });
  it("hair: none is a choice and gives the smooth cover; so does an unknown style", () => {
    expect(resolveKipTop({ hat: "none", hair: "none" })).toEqual({ kind: "cover", hair: null });
    expect(resolveKipTop({ hair: "wizard-beard" })).toEqual({ kind: "cover", hair: null });
  });
  it("any of the nineteen styles is worn when chosen", () => {
    for (const h of KIP_HAIRSTYLES) expect(resolveKipTop({ hat: "none", hair: h.id })).toEqual({ kind: "hair", hair: h });
  });
});

describe("the rig recipe", () => {
  const sel = (over: Record<string, string>) => ({ ...stockSel().character, ...over }) as unknown as RigSel;
  it("the stock Kip loads the wig and the wig's orange studs", () => {
    expect(keys(resolveStlHeroRecipe("character", sel({}), "kip"))).toEqual(expect.arrayContaining(["hair", "crownBuds"]));
  });
  it("a sculpted wig has no stud overlay; a bare head loads neither (the cover is built, not loaded)", () => {
    const wig = keys(resolveStlHeroRecipe("character", sel({ hair: "mohawk" }), "kip"));
    expect(wig).toContain("hair");
    expect(wig).not.toContain("crownBuds");
    const bare = keys(resolveStlHeroRecipe("character", sel({ hair: "none" }), "kip"));
    expect(bare).not.toContain("hair");
    expect(bare).not.toContain("crownBuds");
  });
  it("a hat on a hat-ready wig loads both; the other heads never get hair", () => {
    const k = keys(resolveStlHeroRecipe("character", sel({ hat: "cap", hair: "bob" }), "kip"));
    expect(keys(resolveStlHeroRecipe("character", sel({ hat: "cap" }), "kip"))).not.toContain("hair");
    expect(k).toEqual(expect.arrayContaining(["hat", "hair"]));
    expect(keys(resolveStlHeroRecipe("character", sel({ base: "creature" }), "kip"))).not.toContain("hair");
  });
});

function diskFetcher(url: string): Promise<ArrayBuffer | null> {
  const full = resolve(process.cwd(), "public", (url.split("?")[0] ?? url).replace(/^\//, ""));
  if (!existsSync(full)) return Promise.resolve(null);
  const buf = readFileSync(full);
  return Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}
async function build(over: Record<string, string>, colOver: Record<string, string> = {}) {
  const sel = { ...stockSel().character, ...over } as unknown as RigSel;
  const col = { ...stockCol(), ...colOver };
  const rig = buildToy("character", sel, col);
  expect(await upgradeRigWithStl(rig, { type: "character", sel, col, toyId: "seed-kip", fetcher: diskFetcher })).toBe(true);
  const found: Record<string, THREE.Mesh> = {};
  rig.head!.traverse((o: THREE.Object3D) => {
    for (const k of ["kipHair", "kipCover", "kipBuds"]) if (o.userData[k]) found[k] = o as THREE.Mesh;
  });
  return { rig, found, col };
}
const bbox = (m: THREE.Mesh) => { m.geometry.computeBoundingBox(); return m.geometry.boundingBox!; };

describe("the built rig", () => {
  it("the stock Kip wears the chestnut Swept wig seated like the demo's, with orange studs on its top and no cover", async () => {
    const { found, col } = await build({});
    expect(found.kipCover).toBeUndefined();
    const wig = found.kipHair!;
    expect(wig).toBeDefined();
    expect((wig.material as THREE.MeshStandardMaterial).color.getHexString()).toBe(plastic(KIP_DEFAULT_HAIR_HEX).color.getHexString());
    expect(wig.position.y).toBeCloseTo(KID_CROWN_Y - 16.5 + KIP_WIG_LIFT_MM, 9);
    expect(found.kipBuds!.position.y).toBeCloseTo(KID_CROWN_Y + 4.8 + KIP_WIG_LIFT_MM, 9);
    expect(col.skin).toBeTruthy();
  });
  it("a chosen hair tone paints the wig", async () => {
    const { found } = await build({}, { hair: "#d9468f" });
    expect((found.kipHair!.material as THREE.MeshStandardMaterial).color.getHexString()).toBe(plastic("#d9468f").color.getHexString());
  });
  it("a bare head wears the smooth cover in the skin colour over the studs, and shows no orange studs", async () => {
    const { found, col } = await build({ hair: "none" });
    expect(found.kipHair).toBeUndefined();
    expect(found.kipBuds).toBeUndefined();
    const cover = found.kipCover!;
    expect(cover).toBeDefined();
    expect((cover.material as THREE.MeshStandardMaterial).color.getHexString()).toBe(plastic(col.skin!).color.getHexString());
    const b = bbox(cover);
    expect(b.max.z - b.min.z).toBeGreaterThanOrEqual(8); // higher than the 2.84 mm studs
    expect(cover.position.y).toBeLessThan(KID_CROWN_Y);
  });
  it("a hat-ready wig under a hat is kept and the hat is lifted by the wig's studs; the cover is not built under a hat", async () => {
    const withWig = await build({ hat: "cap", hair: "bob" });
    expect(withWig.found.kipHair).toBeDefined();
    expect(withWig.found.kipCover).toBeUndefined();
    const bare = await build({ hat: "cap" });
    expect(bare.found.kipHair).toBeUndefined();
    expect(bare.found.kipCover).toBeUndefined();
    const hatY = (rig: { slots: Record<string, THREE.Object3D | undefined> }) => { let y = NaN; rig.slots.hat?.traverse((o) => { if (o.userData.hatCad) y = o.position.y; }); return y; };
    expect(Number.isNaN(hatY(withWig.rig as never))).toBe(false);
    expect(hatY(withWig.rig as never)).toBeGreaterThan(hatY(bare.rig as never));
  });
});
