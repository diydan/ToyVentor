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
  it("the hat rides the HEAD: it nods, turns and moves with the head in a dance (Dan, 2026-11-05: the hat does not stay on the head when dancing)", async () => {
    for (const hat of ["wizard", "crown", "cap", "propcap", "flower"]) {
      const { rig, root, hats } = await rigWith({ hat });
      expect(isUnder(hats[0]!, rig.head!), `${hat} is under the head`).toBe(true);
      const centre = () => { root.updateMatrixWorld(true); return new THREE.Box3().setFromObject(hats[0]!).getCenter(new THREE.Vector3()); };
      const rest = centre();
      rig.head!.position.z += 27;                                   // the head bobs forward 27 mm (the head's frame is in millimetres, turned a quarter: its +z is the stage's +x): the hat goes with it
      const moved = centre();
      expect(moved.x - rest.x, `${hat} follows a bob`).toBeCloseTo(27 * 0.0185, 3);
      rig.head!.position.z -= 27;
      rig.head!.rotation.z = 0.6;                                   // the head nods about its own origin: the hat, which is above that origin, swings with it
      const nodded = centre();
      expect(nodded.distanceTo(rest), `${hat} follows a nod`).toBeGreaterThan(0.1);
      expect(nodded.y).toBeLessThan(rest.y);                        // and comes down a little, as a hat on a tilted head does
    }
  });
  it("the hat stays on the head's own frame: turning the head turns the hat about the same axis as the hair", async () => {
    const { rig, root, hats } = await rigWith({ hat: "wizard", hair: "short_swept" });
    let wig: THREE.Object3D | null = null; root.traverse((o) => { if (o.userData.kipHair) wig = o; });
    expect(wig).not.toBeNull();
    const rel = (a: THREE.Object3D, b: THREE.Object3D) => { root.updateMatrixWorld(true); return new THREE.Vector3().setFromMatrixPosition(b.matrixWorld).sub(new THREE.Vector3().setFromMatrixPosition(a.matrixWorld)); };
    const gapAtRest = rel(wig!, hats[0]!).length();
    rig.head!.rotation.y = 1.0; rig.head!.rotation.z = 0.4; rig.head!.position.set(0.3, 0.1, 0.2);
    expect(rel(wig!, hats[0]!).length()).toBeCloseTo(gapAtRest, 4);  // the hat keeps its distance from the wig whatever the head does
  });
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
