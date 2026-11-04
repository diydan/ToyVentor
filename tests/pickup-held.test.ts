import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { ARM_FIST, HELD, createHeld, placeHeldMesh } from "../src/features/game/world/runtime/heldItems";
import { CARD_FIST, CARD_FRONT, CARD_HAND, CARD_LONG, CARD_MAX_LONG, CARD_MIN_SHORT, cardLocalPosition, cardSize, cleanLabel, createPickupHeld, heldItemFor, parsePickup, putAwayLabel } from "../src/features/game/world/runtime/pickupHeld";

// What Kip picked up with the camera, shown on the game's Kip (src/features/game/world/runtime/pickupHeld.ts). The card (a canvas texture) needs a browser: it is checked by
// scripts/e2e-game-pickup.mjs. Everything here runs in node.

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const good = (patch: Record<string, unknown> = {}) => ({ word: "spoon", kind: "library", id: "wooden_spoon", label: "Wooden spoon", coloured: true, colours: ["silver", "brown"], cutout: { dataUrl: PNG, w: 120, h: 300 }, named: false, ...patch });

describe("reading the bench's event", () => {
  it("accepts the three kinds, a checked cut-out, and ignores fields it does not know", () => {
    const p = parsePickup(good());
    expect(p).toEqual({ word: "spoon", kind: "library", id: "wooden_spoon", label: "Wooden spoon", coloured: true, colours: ["silver", "brown"], cutout: { dataUrl: PNG, w: 120, h: 300 } });
    expect(parsePickup(good({ kind: "workshop", id: "guitar", label: "guitar" }))?.kind).toBe("workshop");
    // a card has no id worth keeping: an empty one, or one that is not an id, is fine
    for (const id of ["", "Not An Id!", undefined, 7]) expect(parsePickup(good({ kind: "card", id }))).toMatchObject({ kind: "card", id: "" });
    expect(parsePickup(good({ kind: "card", id: "toy_car" }))?.id).toBe("toy_car");
  });

  it("refuses what is not an event of ours", () => {
    for (const bad of [null, undefined, 3, "x", [], {}, good({ kind: "other" }), good({ kind: "workshop", id: "" }), good({ kind: "library", id: "Has Space" }), good({ id: "../etc" }), good({ label: "", word: "" }), good({ label: 7, word: 7 })]) {
      expect(parsePickup(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("cleans the words and the colours, and drops a cut-out that is not a small PNG", () => {
    expect(parsePickup(good({ label: "<b>Big</b> {spoon}\n\"x\"" }))?.label).toBe("b Big b spoon x");
    expect(cleanLabel("a".repeat(100))).toHaveLength(40);
    expect(cleanLabel("Löffel d'or-3")).toBe("Löffel d'or-3");
    expect(parsePickup(good({ colours: ["red", "NOT", "<x>", 4, "blue", "green"] }))?.colours).toEqual(["red", "blue"]);
    const cut = (c: unknown) => parsePickup(good({ cutout: c }))?.cutout;
    expect(cut({ dataUrl: "http://example.com/x.png", w: 10, h: 10 })).toBeNull();
    expect(cut({ dataUrl: "data:image/jpeg;base64,AAAA", w: 10, h: 10 })).toBeNull();
    expect(cut({ dataUrl: "data:image/png;base64,not base64!", w: 10, h: 10 })).toBeNull();
    expect(cut({ dataUrl: PNG, w: 0, h: 10 })).toBeNull();
    expect(cut({ dataUrl: PNG, w: 10.5, h: 10 })).toBeNull();
    expect(cut({ dataUrl: PNG, w: 10, h: 301 })).toBeNull();
    expect(cut({ dataUrl: `data:image/png;base64,${"A".repeat(700_001)}`, w: 10, h: 10 })).toBeNull();
    expect(cut(null)).toBeNull();
    expect(cut("data:image/png;base64,AAAA")).toBeNull();
    expect(parsePickup(good({ cutout: null }))?.cutout).toBeNull(); // still a pick-up: the game draws a plain sticker with the word
  });
});

describe("which bench props have a twin in the game", () => {
  it("maps the workshop props the game has a mesh for, and only those", () => {
    const twin = (id: string) => heldItemFor({ kind: "workshop", id });
    expect(twin("guitar")).toBe("guitar");
    expect(twin("mop")).toBe("mop");
    expect(twin("vacuum")).toBe("vacuum");
    expect(twin("upright_vacuum")).toBe("vacuum");
    expect(twin("scrub_brush")).toBe("sponge");
    expect(twin("spatula")).toBe("spatula");
    for (const id of ["trumpet", "maracas", "hammer", "screwdriver", "paint_roller", "broom", "frying_pan", "flag", "magnifier", "nonsense", "constructor", "__proto__", "toString"]) expect(twin(id), id).toBeNull();
  });

  it("a household item or a card never has a twin, whatever its id", () => {
    expect(heldItemFor({ kind: "library", id: "guitar" })).toBeNull();
    expect(heldItemFor({ kind: "card", id: "mop" })).toBeNull();
  });

  it("every twin is a mesh the game really has (a renamed held item fails here)", () => {
    for (const id of ["guitar", "mop", "vacuum", "upright_vacuum", "scrub_brush", "spatula"]) {
      const item = heldItemFor({ kind: "workshop", id })!;
      expect(HELD[item], id).toBeDefined();
      expect(typeof HELD[item].build).toBe("function");
    }
  });
});

describe("where the card hangs (two bugs the screenshots found: facing left it sat behind Kip's body, and for one frame it was unturned)", () => {
  // an arm 0.33 either side of the body, turned and tilted and scaled and moved however Kip is: the card must land at the hand's x and y and CARD_FRONT in front of the BODY
  const arm = (yaw: number, tilt: number, scale: number, body: THREE.Vector3) => {
    const model = new THREE.Group();
    model.position.copy(body);
    model.rotation.y = yaw;
    const a = new THREE.Group();
    a.position.set(0.1, 1.8, 0.33); // the right arm, on the camera side at yaw 0 and on the far side at yaw PI
    a.rotation.set(tilt, 0, 0.3);
    a.scale.setScalar(scale);
    model.add(a);
    model.updateMatrixWorld(true);
    return a;
  };
  it("is in front of the body whichever way Kip faces, tilted, scaled or standing anywhere", () => {
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.4, 2.8]) {
      for (const tilt of [0, 0.5, -0.7]) {
        for (const scale of [1, 1.4]) {
          for (const body of [new THREE.Vector3(0, 0, 0), new THREE.Vector3(5, 0, -3)]) {
            const a = arm(yaw, tilt, scale, body);
            const local = cardLocalPosition(a.matrixWorld, body.z, new THREE.Vector3());
            const world = local.clone().applyMatrix4(a.matrixWorld);
            const hand = new THREE.Vector3(...CARD_HAND).applyMatrix4(a.matrixWorld);
            const why = `yaw ${yaw} tilt ${tilt} scale ${scale} body ${body.toArray()}`;
            expect(world.z, why).toBeCloseTo(body.z + CARD_FRONT, 6);
            expect(world.x, why).toBeCloseTo(hand.x, 6);
            expect(world.y, why).toBeCloseTo(hand.y, 6);
          }
        }
      }
    }
  });

  it("a depth taken from the arm would have hidden it inside the body when he faces left (why the rule exists)", () => {
    const a = arm(Math.PI, 0, 1, new THREE.Vector3());
    const armZ = new THREE.Vector3().setFromMatrixPosition(a.matrixWorld).z;
    expect(armZ).toBeLessThan(-0.3); // the right arm is on the far side
    expect(armZ + CARD_FRONT).toBeLessThan(0.33); // so "the arm's depth plus the offset" is inside the body's depth (+- 0.33), not clear of it
    const local = cardLocalPosition(a.matrixWorld, 0, new THREE.Vector3());
    expect(local.clone().applyMatrix4(a.matrixWorld).z).toBeGreaterThan(0.33); // ours is clear of it
  });

  it("an arm with no usable scale does not make NaNs", () => {
    const a = new THREE.Group();
    a.scale.set(1e-9, 1, 1);
    a.updateMatrixWorld(true);
    const p = cardLocalPosition(a.matrixWorld, 0, new THREE.Vector3());
    expect([p.x, p.y, p.z].every(Number.isFinite)).toBe(true);
  });
});

describe("what he picks up with the camera goes in his fist (the grip anchor), not on the middle of his arm", () => {
  /** An arm holder with a grip anchor under it 0.85 down (as the rig has: rig.grips), or a plain holder. */
  function holder(withGrip: boolean) {
    const model = new THREE.Group();
    const arm = new THREE.Group();
    arm.position.set(0.1, 1.8, 0.33);
    arm.rotation.set(0.4, 0, 0.3);
    model.add(arm);
    const grip = new THREE.Group();
    grip.position.set(0.125, -0.845, 0.03);
    grip.userData.grip = true;
    arm.add(grip);
    model.updateMatrixWorld(true);
    return { model, arm, grip, parent: withGrip ? grip : arm };
  }
  it("a card hangs AT the fist when what carries it is the grip, at the old place down the arm when it is a plain arm holder, whatever the arm is doing", () => {
    for (const tilt of [0, 0.6, -0.8]) {
      const h = holder(true);
      h.arm.rotation.x = tilt; h.model.updateMatrixWorld(true);
      const fist = h.grip.getWorldPosition(new THREE.Vector3());
      const local = cardLocalPosition(h.grip.matrixWorld, 0, new THREE.Vector3(), CARD_FIST);
      const world = local.applyMatrix4(h.grip.matrixWorld);
      expect(world.x, `tilt ${tilt}`).toBeCloseTo(fist.x, 6);
      expect(world.y, `tilt ${tilt}`).toBeCloseTo(fist.y, 6);
      expect(world.z, `tilt ${tilt}`).toBeCloseTo(CARD_FRONT, 6);
    }
    const plain = holder(false);
    const old = cardLocalPosition(plain.arm.matrixWorld, 0, new THREE.Vector3());
    const handOld = new THREE.Vector3(...CARD_HAND).applyMatrix4(plain.arm.matrixWorld);
    expect(old.applyMatrix4(plain.arm.matrixWorld).y).toBeCloseTo(handOld.y, 6);
    expect(CARD_FIST).toEqual([0, 0, 0]);
  });
  it("a 3D item he is given sits where the acts' items sit: in the fist for a grip, and the fist's distance down the arm for a plain holder", () => {
    for (const withGrip of [true, false]) {
      const h = holder(withGrip);
      const spec = HELD.sandwich;
      const mesh = spec.build();
      placeHeldMesh(mesh, spec, h.parent);
      const want = withGrip ? [...spec.position] : [spec.position[0] + ARM_FIST[0], spec.position[1] + ARM_FIST[1], spec.position[2] + ARM_FIST[2]];
      expect(mesh.position.toArray(), `grip ${withGrip}`).toEqual(want);
    }
  });
  it("the world gives the pick-up the grips (falling back to the arms), as it does the acts", () => {
    const w = readFileSync(join(__dirname, "..", "src/features/game/world/runtime/world.ts"), "utf8");
    expect(w).toContain("var PICK=createPickupHeld({held:HELD,rig:function(){return P.rig&&P.model?{model:P.model,armR:handOf(1),armL:handOf(0)}:null},");
  });
});

describe("the card's size", () => {
  it("keeps the picture's shape with the long side at CARD_LONG", () => {
    const tall = cardSize(120, 300);
    expect(tall.height).toBeCloseTo(CARD_LONG, 6);
    expect(tall.width / tall.height).toBeCloseTo(120 / 300, 6);
    const wide = cardSize(300, 100);
    expect(wide.width).toBeCloseTo(CARD_LONG, 6);
    expect(wide.height / wide.width).toBeCloseTo(100 / 300, 6);
    const square = cardSize(50, 50);
    expect(square.width).toBeCloseTo(CARD_LONG, 6);
    expect(square.height).toBeCloseTo(CARD_LONG, 6);
  });

  it("a very thin thing grows a little, never past the cap, and never gets a zero or a NaN", () => {
    const sliver = cardSize(4, 300); // 1 : 75: it would need 12 units to be 0.16 wide, so the cap wins
    expect(sliver.height).toBeGreaterThan(CARD_LONG);
    expect(sliver.height).toBeLessThanOrEqual(CARD_MAX_LONG + 1e-9);
    expect(sliver.width / sliver.height).toBeCloseTo(4 / 300, 6); // grown, not stretched
    const thin = cardSize(20, 200); // 1 : 10, like a long spoon: grown just enough to reach the minimum
    expect(thin.width).toBeGreaterThanOrEqual(CARD_MIN_SHORT - 1e-9);
    expect(thin.height).toBeLessThanOrEqual(CARD_MAX_LONG + 1e-9);
    expect(thin.width / thin.height).toBeCloseTo(0.1, 6);
    const spoon = cardSize(120, 300); // 1 : 2.5, the real spoon's cut-out: untouched
    expect(spoon.height).toBeCloseTo(CARD_LONG, 6);
    for (const [w, h] of [[0, 0], [-5, 10], [NaN, 4], [Infinity, 3]] as const) {
      const s = cardSize(w, h);
      expect(Number.isFinite(s.width) && Number.isFinite(s.height) && s.width > 0 && s.height > 0, `${w}x${h}`).toBe(true);
    }
  });

  it("the chip says what will be put away", () => {
    expect(putAwayLabel("Wooden spoon")).toBe("Put the wooden spoon away");
  });
});

// A rig with the pieces the holder needs: a body, two arms, and an arm count that a vehicle does not have.
function rig(withArms = true) {
  const model = new THREE.Group();
  const armR = new THREE.Group();
  const armL = new THREE.Group();
  model.add(armR, armL);
  return withArms ? { model, armR, armL } : { model, armR: null, armL: null };
}
const info = (kind: "workshop" | "library" | "card", id: string, label = "thing") => parsePickup({ word: label, kind, id, label, coloured: false, colours: [], cutout: null })!;

describe("holding the game's own meshes", () => {
  it("the guitar goes on the body like the acts' guitar, and putting it away leaves nothing on Kip", async () => {
    const held = createHeld();
    const r = rig();
    const p = createPickupHeld({ held, rig: () => r });
    expect(await p.pick(info("workshop", "guitar", "guitar"))).toBe(true);
    expect(p.state.onKip).toBe(true);
    expect(r.model.children).toHaveLength(3); // two arms and the guitar
    const spec = HELD.guitar;
    const mesh = r.model.children[2]!;
    expect(mesh.position.toArray()).toEqual([...spec.position]);
    expect(mesh.scale.x).toBeCloseTo(spec.scale, 9);
    expect(held.item).toBeNull(); // the acts' slot stays free
    p.putAway();
    expect(r.model.children).toHaveLength(2);
    expect(p.state).toEqual({ wanted: null, onKip: false, chipShowing: false });
    p.dispose();
  });

  it("a mop goes on the body, a spatula too; a pair would go one in each hand", async () => {
    const held = createHeld();
    const r = rig();
    const p = createPickupHeld({ held, rig: () => r });
    await p.pick(info("workshop", "spatula", "spatula"));
    expect(r.model.children).toHaveLength(3);
    await p.pick(info("workshop", "mop", "mop")); // a new one replaces the old
    expect(r.model.children).toHaveLength(3);
    expect(p.state.wanted?.item).toBe("mop");
    p.dispose();
    expect(r.model.children).toHaveLength(2);
  });

  it("steps aside while an act has Kip's hands and comes back when it lets go", async () => {
    const held = createHeld();
    const r = rig();
    const p = createPickupHeld({ held, rig: () => r });
    await p.pick(info("workshop", "guitar", "guitar"));
    expect(r.model.children).toHaveLength(3);
    held.hold("book", r.model, r.armR, r.armL); // an act reads the book
    expect(held.item).toBe("book");
    expect(r.model.children.filter((c) => c !== r.armR && c !== r.armL)).toHaveLength(1); // only the book is on Kip
    expect(p.state.onKip).toBe(false);
    expect(p.state.wanted).not.toBeNull(); // still wanted
    held.release(); // the act ends
    expect(held.item).toBeNull();
    expect(p.state.onKip).toBe(true);
    expect(r.model.children).toHaveLength(3); // the guitar is back, the book is gone
    held.release(); // safe to call again
    expect(r.model.children).toHaveLength(3);
    p.dispose();
  });

  it("waits while an act holds something and takes the hands when they are free", async () => {
    const held = createHeld();
    const r = rig();
    held.hold("wand", r.model, r.armR, r.armL);
    const p = createPickupHeld({ held, rig: () => r });
    await p.pick(info("workshop", "guitar", "guitar"));
    expect(p.state.onKip).toBe(false);
    expect(p.state.wanted?.item).toBe("guitar");
    held.release();
    expect(p.state.onKip).toBe(true);
    p.dispose();
  });

  it("a vehicle has no arms: the item waits for the character, and tick() puts it on a rebuilt rig", async () => {
    const held = createHeld();
    let r = rig(false);
    const p = createPickupHeld({ held, rig: () => r });
    await p.pick(info("workshop", "mop", "mop"));
    expect(p.state.wanted?.item).toBe("mop");
    expect(p.state.onKip).toBe(false); // not hung on a car's body
    expect(r.model.children).toHaveLength(2);
    r = rig(); // the toy changes to a character
    p.tick();
    expect(p.state.onKip).toBe(true);
    expect(r.model.children).toHaveLength(3);
    // the toy is rebuilt again (a new rig): the old one's mesh is gone with it, tick puts the item on the new one
    const r2 = rig();
    r = r2;
    p.tick();
    expect(r2.model.children).toHaveLength(3);
    p.dispose();
  });

  it("no rig yet is not an error", async () => {
    const p = createPickupHeld({ held: createHeld(), rig: () => null });
    expect(await p.pick(info("workshop", "guitar", "guitar"))).toBe(true);
    expect(p.state.onKip).toBe(false);
    p.tick();
    p.dispose();
  });

  it("an item with no twin and no browser cannot be shown, and says so (the card needs a canvas)", async () => {
    const p = createPickupHeld({ held: createHeld(), rig: () => rig() });
    expect(await p.pick(info("library", "wooden_spoon", "spoon"))).toBe(false);
    p.dispose();
  });

  it("dispose gives the acts' slot back as it found it", async () => {
    const held = createHeld();
    const hold = held.hold;
    const release = held.release;
    const p = createPickupHeld({ held, rig: () => rig() });
    expect(held.hold).not.toBe(hold);
    p.dispose();
    expect(held.hold).toBe(hold);
    expect(held.release).toBe(release);
  });

  it("tapping Kip puts it away; tapping elsewhere does not; nothing held means the tap is not used", async () => {
    const held = createHeld();
    const r = rig();
    const root = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshBasicMaterial());
    root.add(body);
    body.position.set(0, 1, 0);
    root.updateMatrixWorld(true);
    const toasts: string[] = [];
    const p = createPickupHeld({ held, rig: () => r, playerRoot: () => root, toast: (s) => toasts.push(s) });
    const ray = (x: number) => { const rc = new THREE.Raycaster(new THREE.Vector3(x, 1, 5), new THREE.Vector3(0, 0, -1)); return rc; };
    expect(p.tap(ray(0))).toBe(false); // nothing held
    await p.pick(info("workshop", "guitar", "guitar"));
    expect(p.tap(ray(10))).toBe(false); // a tap that misses Kip
    expect(p.state.onKip).toBe(true);
    expect(p.tap(ray(0))).toBe(true);
    expect(p.state.wanted).toBeNull();
    expect(toasts).toEqual(["guitar put away."]);
    p.dispose();
  });
});
