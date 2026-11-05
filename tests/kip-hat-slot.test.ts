// A hat on the Snap Kip is drawn (kid bench, 2026-11-05). The placeholder rig hangs the hat slot on its own head group, and the STL upgrade takes that group out of the scene, so a hat added to the slot was
// never drawn: wizard, crown, cap, hard hat and ranger hat were all invisible on the stock Kip until the loader put the slot straight on the rig.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { stockCol, stockSel } from "../src/features/game/world/runtime/catalog";
import { buildToy, upgradeRigWithStl, type RigSel } from "../src/features/game/world/runtime/playerRig";

function diskFetcher(url: string): Promise<ArrayBuffer | null> {
  const full = resolve(process.cwd(), "public", (url.split("?")[0] ?? url).replace(/^\//, ""));
  if (!existsSync(full)) return Promise.resolve(null);
  const buf = readFileSync(full);
  return Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}
async function rigWith(over: Record<string, string>) {
  const sel = { ...stockSel().character, ...over } as unknown as RigSel;
  const col = stockCol();
  const rig = buildToy("character", sel, col);
  const root = new THREE.Group(); root.add(rig.g); // what the game does: P.model.add(rig.g)
  expect(await upgradeRigWithStl(rig, { type: "character", sel, col, toyId: "seed-kip", fetcher: diskFetcher })).toBe(true);
  root.updateMatrixWorld(true);
  const hats: THREE.Object3D[] = [];
  root.traverse((o) => { if (o.userData.hatCad) hats.push(o); });
  return { rig, root, hats };
}
const isUnder = (o: THREE.Object3D, ancestor: THREE.Object3D): boolean => { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === ancestor) return true; return false; };

describe("hats on the Snap Kip", () => {
  for (const hat of ["wizard", "crown", "cap", "propcap", "flower"]) {
    it(`${hat}: the hat is in the drawn rig, above the head`, async () => {
      const { rig, root, hats } = await rigWith({ hat });
      expect(hats.length).toBe(1);
      expect(isUnder(hats[0]!, root)).toBe(true);
      expect(isUnder(rig.slots.hat!, rig.g)).toBe(true);
      const box = new THREE.Box3().setFromObject(hats[0]!);
      expect(box.max.y).toBeGreaterThan(2.3); // the head's crown is at about 2.4 stage units
      expect(box.min.y).toBeGreaterThan(1.9); // and it sits on the head rather than hanging from the ceiling
      expect(box.max.y).toBeLessThan(3.6);
    });
  }
  it("no hat, no hat part", async () => {
    const { hats } = await rigWith({ hat: "none" });
    expect(hats.length).toBe(0);
  });
  it("a hat on a hat-ready wig sits above the wig's studs, not inside it", async () => {
    const bare = await rigWith({ hat: "cap", hair: "none" });
    const wig = await rigWith({ hat: "cap", hair: "bob" });
    const top = (r: { hats: THREE.Object3D[] }) => new THREE.Box3().setFromObject(r.hats[0]!).min.y;
    expect(top(wig)).toBeGreaterThan(top(bare) - 1e-6);
  });
});
