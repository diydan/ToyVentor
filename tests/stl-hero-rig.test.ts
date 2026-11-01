import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stockCol, stockSel } from "../src/features/game/world/runtime/catalog";
import {
  MAX_STL_CACHE,
  buildToy,
  clearStlRigCache,
  getStlRigCacheStats,
  loadCachedStl,
  resolveStlHeroRecipe,
  upgradeRigWithStl,
  type RigSel,
} from "../src/features/game/world/runtime/playerRig";

const ROOT = process.cwd();

function diskFetcher(url: string): Promise<ArrayBuffer | null> {
  const clean = url.split("?")[0] ?? url;
  const full = resolve(ROOT, "public", clean.replace(/^\//, ""));
  if (!existsSync(full)) return Promise.resolve(null);
  const buf = readFileSync(full);
  return Promise.resolve(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  );
}

function makeTinyBinaryStl(zTop = 10): ArrayBuffer {
  const buf = new ArrayBuffer(84 + 50);
  const view = new DataView(buf);
  view.setUint32(80, 1, true);
  // normal (0,0,1)
  view.setFloat32(84 + 8, 1, true);
  // v0 (0,0,zTop), v1 (10,0,0), v2 (0,10,0)
  view.setFloat32(84 + 20, zTop, true);
  view.setFloat32(84 + 24, 10, true);
  view.setFloat32(84 + 40, 10, true);
  return buf;
}

describe("Unit 4 — live STL hero rig loader + bounded LRU cache", () => {
  afterEach(() => {
    clearStlRigCache();
  });

  it("every STL referenced across character and all 10 vehicle recipes exists on disk under public/", () => {
    const sel = stockSel();
    const charVariants: Array<{ sel: RigSel; toyId?: string }> = [
      { sel: { ...sel.character } as unknown as RigSel, toyId: "seed-kip" },
      {
        sel: {
          ...sel.character,
          base: "block",
          hat: "cap",
          back: "backpack",
          prop: "robot.arms.tools",
        } as unknown as RigSel,
      },
      {
        sel: {
          ...sel.character,
          base: "vinyl",
          ears: "bear",
          hat: "wizard",
          back: "wings",
        } as unknown as RigSel,
      },
      {
        sel: {
          ...sel.character,
          base: "robot.head.visor",
          hat: "robot.top.gearcrown",
          back: "jetpack",
          prop: "robot.arms.claws",
        } as unknown as RigSel,
      },
    ];
    for (const v of charVariants) {
      const recipe = resolveStlHeroRecipe("character", v.sel, v.toyId);
      expect(recipe.parts.length).toBeGreaterThan(5);
      for (const part of recipe.parts) {
        const diskPath = resolve(ROOT, "public", part.url.replace(/^\//, ""));
        expect(existsSync(diskPath), `missing STL: ${part.url}`).toBe(true);
      }
    }

    const vehicleIds = [
      "seed-car",
      "seed-truck",
      "seed-scooter",
      "seed-motorbike",
      "seed-tractor",
      "seed-aeroplane",
      "seed-catamaran",
      "seed-helicopter",
      "seed-shuttle",
      "seed-mech",
    ];
    for (const id of vehicleIds) {
      const recipe = resolveStlHeroRecipe(
        "vehicle",
        sel.vehicle as unknown as RigSel,
        id,
      );
      expect(recipe.heroId).toBe(id);
      for (const part of recipe.parts) {
        const diskPath = resolve(ROOT, "public", part.url.replace(/^\//, ""));
        expect(existsSync(diskPath), `missing STL for ${id}: ${part.url}`).toBe(
          true,
        );
      }
    }
  });

  it("upgrades Kip and W10 vehicles in-place from real disk STLs while preserving animation handles", async () => {
    const sel = stockSel();
    const col = stockCol();

    const kipRig = buildToy(
      "character",
      {
        ...sel.character,
        hat: "cap",
        back: "jetpack",
        prop: "robot.arms.tools",
      } as unknown as RigSel,
      col,
    );
    const okKip = await upgradeRigWithStl(kipRig, {
      type: "character",
      sel: {
        ...sel.character,
        hat: "cap",
        back: "jetpack",
        prop: "robot.arms.tools",
      } as unknown as RigSel,
      col,
      toyId: "seed-kip",
      fetcher: diskFetcher,
    });
    expect(okKip).toBe(true);
    expect(kipRig.stlMode).toBe("stl");
    expect(kipRig.arms).toHaveLength(2);
    expect(kipRig.feet).toHaveLength(2);
    expect(kipRig.head).toBeDefined();
    expect(kipRig.flames?.length).toBe(2);

    const shuttleRig = buildToy(
      "vehicle",
      sel.vehicle as unknown as RigSel,
      col,
    );
    const okShuttle = await upgradeRigWithStl(shuttleRig, {
      type: "vehicle",
      sel: sel.vehicle as unknown as RigSel,
      col,
      toyId: "seed-shuttle",
      fetcher: diskFetcher,
    });
    expect(okShuttle).toBe(true);
    expect(shuttleRig.stlMode).toBe("stl");
    expect(shuttleRig.stlHeroId).toBe("seed-shuttle");
    expect(shuttleRig.wheels.length).toBe(3);
    expect(shuttleRig.flames?.length).toBe(2);

    const heliRig = buildToy("vehicle", sel.vehicle as unknown as RigSel, col);
    const okHeli = await upgradeRigWithStl(heliRig, {
      type: "vehicle",
      sel: sel.vehicle as unknown as RigSel,
      col,
      toyId: "seed-helicopter",
      fetcher: diskFetcher,
    });
    expect(okHeli).toBe(true);
    expect(heliRig.spinners?.length).toBe(1);
    expect(heliRig.hover).toBe(true);

    const mechRig = buildToy("vehicle", sel.vehicle as unknown as RigSel, col);
    const okMech = await upgradeRigWithStl(mechRig, {
      type: "vehicle",
      sel: sel.vehicle as unknown as RigSel,
      col,
      toyId: "seed-mech",
      fetcher: diskFetcher,
    });
    expect(okMech).toBe(true);
    expect(mechRig.stlMode).toBe("stl");
    expect(mechRig.stlHeroId).toBe("seed-mech");
    expect(mechRig.wheels).toHaveLength(4);
  });

  it("enforces bounded LRU geometry cache and disposes evicted geometries", async () => {
    const firstGeo = await loadCachedStl("/test/part-0.stl", 34, async () =>
      makeTinyBinaryStl(5),
    );
    expect(firstGeo).not.toBeNull();
    expect(firstGeo!.userData.stlCached).toBe(true);
    const disposeSpy = vi.spyOn(firstGeo!, "dispose");

    for (let i = 1; i <= MAX_STL_CACHE; i++) {
      await loadCachedStl(`/test/part-${i}.stl`, 34, async () =>
        makeTinyBinaryStl(5 + i),
      );
    }

    const stats = getStlRigCacheStats();
    expect(stats.size).toBe(MAX_STL_CACHE);
    expect(stats.evictions).toBe(1);
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps synchronous procedural rig intact when STL fetch fails or returns SPA HTML, or when token is cancelled", async () => {
    const sel = stockSel();
    const col = stockCol();
    const rig = buildToy("vehicle", sel.vehicle as unknown as RigSel, col);
    const initialWheelCount = rig.wheels.length;

    const htmlBuf = new TextEncoder().encode("<!doctype html><html></html>")
      .buffer;
    const okHtml = await upgradeRigWithStl(rig, {
      type: "vehicle",
      sel: sel.vehicle as unknown as RigSel,
      col,
      toyId: "seed-car",
      fetcher: async () => htmlBuf,
    });
    expect(okHtml).toBe(false);
    expect(rig.stlMode).toBe("procedural");
    expect(rig.wheels.length).toBe(initialWheelCount);

    const token = { cancelled: true };
    const okCancelled = await upgradeRigWithStl(rig, {
      type: "vehicle",
      sel: sel.vehicle as unknown as RigSel,
      col,
      toyId: "seed-car",
      token,
      fetcher: diskFetcher,
    });
    expect(okCancelled).toBe(false);
    expect(rig.stlMode).toBe("procedural");
  });
});
