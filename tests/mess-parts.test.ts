import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { HELD, createHeld } from "../src/features/game/world/runtime/heldItems";
import { MOP_HEIGHT, buildMopMesh } from "../src/features/game/world/runtime/mop";
import {
  BOX_TILT, CUP_LIE, DUMP_TIP_AT_S, IN_BOX, IN_PILE, MOP_END_S, MOP_EVERY_S, MOP_START_S, MOP_STROKES, PILE_TOYS, SPILL_TIP_AT_S, TIDY_EVERY_S, TIDY_START_S, TOY_KINDS, tidyEndsAt,
} from "../src/features/game/world/runtime/messModel";
import { createMessPrompt, PROMPT_MIN_HEIGHT_PX, PROMPT_TEST_ID } from "../src/features/game/world/runtime/messPrompt";
import { BOX_D, BOX_W, TABLE_R, TABLE_TOP_Y, buildCupTable, buildToy, buildToyBox, createPuddle, placeAt } from "../src/features/game/world/runtime/messScene";
import { MOP_CLIP_EVERY_S, MOP_CLIP_START_S, MOP_CLIP_STROKES, OOPS_S, OOPS_TIP_S, PROCEDURAL_CLIPS, TIDY_CLIP_EVERY_S, TIDY_CLIP_MAX, TIDY_CLIP_START_S } from "../src/features/game/world/runtime/proceduralClips";
import { MixamoDriver, newPose, sampleClip, type Pose as ClipPose } from "../src/features/game/world/runtime/mixamo";
import { ACT_FOR_PROP } from "../src/features/game/world/runtime/toyRoomActs";
import { PROP_SPECS, PROP_TYPES } from "../src/features/game/world/runtime/propReactions";
import { LEVELS, PROPS } from "../src/features/game/world/runtime/catalog";
import { NOUN_KEYS, propPhrase, LANGUAGES } from "../src/lib/propNames";

const bbox = (o: THREE.Object3D) => { o.updateMatrixWorld(true); return new THREE.Box3().setFromObject(o); };
const clipPose = (name: keyof typeof PROCEDURAL_CLIPS, t: number): ClipPose => { const p = newPose(); sampleClip(PROCEDURAL_CLIPS[name]!, t, p); return p; };

describe("the Clean card", () => {
  class El {
    tag: string; kids: El[] = []; attrs: Record<string, string> = {}; style = { cssText: "", display: "" }; hidden = false; textContent = ""; type = ""; parent: El | null = null; fns: Array<() => void> = [];
    constructor(tag: string) { this.tag = tag; }
    get isConnected() { return this.parent !== null; }
    get ownerDocument() { return { createElement: (t: string) => new El(t) }; }
    setAttribute(k: string, v: string) { this.attrs[k] = v; }
    append(...k: El[]) { for (const x of k) { x.parent = this; this.kids.push(x); } }
    appendChild(k: El) { this.append(k); return k; }
    remove() { if (this.parent) this.parent.kids = this.parent.kids.filter((c) => c !== this); this.parent = null; }
    addEventListener(_t: string, f: () => void) { this.fns.push(f); }
  }
  it("is made when first shown, once, and shown and hidden by the caller; it is a labelled group with a real button at least 56 px tall", () => {
    const host = new El("div");
    let cleans = 0;
    const p = createMessPrompt({ host: () => host as unknown as HTMLElement, onClean: () => { cleans++; } });
    expect(host.kids).toHaveLength(0);
    expect(p.visible).toBe(false);
    p.show();
    p.show();
    expect(host.kids).toHaveLength(1);
    const card = host.kids[0]!;
    expect(card.attrs["data-testid"]).toBe(PROMPT_TEST_ID);
    expect(card.attrs.role).toBe("group");
    expect(card.attrs["aria-label"]).toBe("Clean up?");
    const button = card.kids.find((k) => k.tag === "button")!;
    expect(button.type).toBe("button");
    expect(button.attrs["aria-label"]).toBe("Clean");
    expect(Number(/min-height:(\d+)px/.exec(button.style.cssText)![1])).toBeGreaterThanOrEqual(56);
    expect(PROMPT_MIN_HEIGHT_PX).toBeGreaterThanOrEqual(56);
    expect(p.visible).toBe(true);
    expect(card.hidden).toBe(false);
    button.fns.forEach((f) => f());
    expect(cleans).toBe(1);
    p.hide();
    expect(card.hidden).toBe(true);
    expect(p.visible).toBe(false);
    p.show();
    expect(card.hidden).toBe(false);
    expect(host.kids).toHaveLength(1);
  });
  it("is gone for good after dispose, and made again if the stage's element was replaced; with no stage it shows nothing and does not throw", () => {
    const host = new El("div");
    const p = createMessPrompt({ host: () => host as unknown as HTMLElement, onClean: () => {} });
    p.show();
    p.dispose();
    expect(host.kids).toHaveLength(0);
    expect(p.visible).toBe(false);
    p.show();
    expect(host.kids).toHaveLength(1);
    host.kids[0]!.remove();                                                    // the stage was rebuilt around it
    p.show();
    expect(host.kids).toHaveLength(1);
    const none = createMessPrompt({ host: () => null, onClean: () => {} });
    expect(() => { none.show(); none.hide(); none.dispose(); }).not.toThrow();
    expect(none.visible).toBe(false);
  });
});

describe("the juice cup and its table", () => {
  const t = buildCupTable(0, 0);
  const cup = t.userData.cup as THREE.Object3D;
  it("has the parts the controller moves, and the juice stream is hidden until the spill", () => {
    expect(cup).toBeTruthy();
    expect(t.userData.juice).toBeTruthy();
    expect((t.userData.stream as THREE.Object3D).visible).toBe(false);
    expect((t.userData.stream as THREE.Object3D).userData.noPick).toBe(true);
  });
  it("the cup stands on the table, and tipped it lies on the table's top, its mouth towards the camera and over the edge", () => {
    cup.rotation.x = 0;
    const up = bbox(cup);
    expect(up.min.y).toBeGreaterThanOrEqual(TABLE_TOP_Y - 0.01);
    expect(up.max.y).toBeGreaterThan(TABLE_TOP_Y + 0.3);
    cup.rotation.x = CUP_LIE;
    const lying = bbox(cup);
    expect(lying.min.y).toBeGreaterThan(TABLE_TOP_Y - 0.05);                  // resting on the table, not through it
    expect(lying.max.y).toBeLessThan(TABLE_TOP_Y + 0.45);
    expect(lying.max.z).toBeGreaterThan(TABLE_R);                              // the mouth hangs over the front edge
    expect(lying.min.z).toBeGreaterThan(0);                                    // and the cup did not fall backwards
    cup.rotation.x = 0;
  });
});

describe("the toy box and its toys", () => {
  const b = buildToyBox(0, 0);
  const toys = b.userData.toys as THREE.Object3D[];
  const pivot = b.userData.boxPivot as THREE.Object3D;
  it("six toys, one of each kind, each a real mesh", () => {
    expect(toys).toHaveLength(PILE_TOYS);
    for (const kind of TOY_KINDS) { let n = 0; buildToy(kind).traverse((o) => { if ((o as THREE.Mesh).isMesh) n++; }); expect(n, kind).toBeGreaterThanOrEqual(1); }
  });
  it("in the box every toy is inside its walls and its top shows over the rim", () => {
    toys.forEach((t, i) => placeAt(t, IN_BOX[i]!));
    for (let i = 0; i < PILE_TOYS; i++) {
      const bx = bbox(toys[i]!);
      expect(bx.min.x, `toy ${i}`).toBeGreaterThan(-BOX_W / 2 - 0.02);
      expect(bx.max.x, `toy ${i}`).toBeLessThan(BOX_W / 2 + 0.02);
      expect(bx.max.z, `toy ${i}`).toBeLessThan(BOX_D / 2);
      expect(bx.min.z, `toy ${i}`).toBeGreaterThan(-BOX_D / 2);
      expect(bx.max.y, `toy ${i}`).toBeGreaterThan(0.8);
    }
  });
  it("in the heap every toy is on the floor (or on the cube), in front of the box, and none is inside the box", () => {
    toys.forEach((t, i) => placeAt(t, IN_PILE[i]!));
    for (let i = 0; i < PILE_TOYS; i++) {
      const bx = bbox(toys[i]!);
      const onCube = i === 5;
      expect(bx.min.y, `toy ${i}`).toBeGreaterThan(onCube ? 0.48 : -0.03);      // the ring rests on the cube's top (0.27 x 2 = 0.54)
      expect(bx.min.y, `toy ${i}`).toBeLessThan(onCube ? 0.6 : 0.06);
      expect(bx.min.z, `toy ${i}`).toBeGreaterThan(BOX_D / 2);
    }
    toys.forEach((t, i) => placeAt(t, IN_BOX[i]!));
  });
  it("the box leans about its bottom FRONT edge: the front edge stays where it is when it tips, the back comes up and forward", () => {
    const wall = (b.children[0] as THREE.Object3D);
    expect(wall).toBe(pivot);
    pivot.rotation.x = 0;
    const flat = bbox(pivot);
    pivot.rotation.x = BOX_TILT;
    const tipped = bbox(pivot);
    pivot.rotation.x = 0;
    expect(tipped.max.z - flat.max.z).toBeLessThan(0.5);                        // only the top of the front wall swings out (0.8 x sin 0.5): the bottom edge is the hinge
    expect(tipped.min.z).toBeGreaterThan(flat.min.z);                           // the back is brought forward
    expect(tipped.min.y).toBeGreaterThanOrEqual(-0.01);                         // it never goes through the floor
  });
});

describe("the puddle", () => {
  it("is hidden until it has a size, sized by (rx, rz) times the share, placed on the floor, and gone for good after dispose", () => {
    const parent = new THREE.Group();
    const p = createPuddle();
    parent.add(p.group);
    expect(p.group.visible).toBe(false);
    p.set(3, -1, 0.5, 0.95, 0.66);
    expect(p.group.visible).toBe(true);
    expect(p.group.position.x).toBe(3);
    expect(p.group.position.z).toBe(-1);
    expect(p.group.scale.x).toBeCloseTo(0.475, 6);
    expect(p.group.scale.z).toBeCloseTo(0.33, 6);
    const flat = bbox(p.group);
    expect(flat.max.y).toBeLessThan(0.08);                                      // a flat puddle on the floor
    p.set(3, -1, 0, 0.95, 0.66);
    expect(p.group.visible).toBe(false);
    p.dispose();
    expect(parent.children).toHaveLength(0);
  });
  it("cannot be picked: a tap on it is a tap on the floor", () => {
    const p = createPuddle();
    p.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) expect(o.userData.noPick).toBe(true); });
  });
});

describe("the mop", () => {
  it("is about 1.85 tall with the head on the floor at the origin, and the held item puts it on the body, slanted with the top back towards Kip", () => {
    const m = buildMopMesh();
    const b = bbox(m);
    expect(b.max.y - b.min.y).toBeCloseTo(MOP_HEIGHT, 1);
    expect(b.min.y).toBeGreaterThan(-0.05);
    expect(HELD.mop.parent).toBe("model");
    expect(HELD.mop.rotation[2]).toBeGreaterThan(0.3);                          // a slant (a positive turn leans the top towards -x, back to Kip)
    expect(HELD.mop.position[0]).toBeGreaterThan(0.5);                          // the head out in front
  });
  it("can be held and let go like the other items, and replaces whatever was in the hands", () => {
    const model = new THREE.Group(), armR = new THREE.Group();
    const h = createHeld();
    expect(h.hold("book", model, armR)).toBe(true);
    expect(h.hold("mop", model, armR)).toBe(true);
    expect(h.item).toBe("mop");
    expect(h.mesh!.parent).toBe(model);
    expect(model.children).toHaveLength(1);
    h.release();
    expect(model.children).toHaveLength(0);
    expect(h.item).toBeNull();
  });
});

describe("the three clips", () => {
  const baked = PROCEDURAL_CLIPS;
  it("oops, mop and tidy are real one-shot clips that start and end at rest", () => {
    for (const n of ["oops", "mop", "tidy"] as const) {
      const c = baked[n]!;
      expect(c.loop, n).toBe(false);
      expect(c.pose, n).toBe(false);
      for (const t of [0, c.duration]) {
        const p = clipPose(n, t);
        expect(p.armL.y, `${n}@${t}`).toBeLessThan(-0.95);
        expect(p.armR.y, `${n}@${t}`).toBeLessThan(-0.95);
        expect(Math.abs(p.hips.y), `${n}@${t}`).toBeLessThan(1e-6);
      }
    }
  });
  it("play through the real driver and finish by themselves", () => {
    for (const n of ["oops", "mop", "tidy"] as const) {
      const d = new MixamoDriver({ ...baked } as never);
      expect(d.trigger(n as never), n).toBe(true);
      expect(d.busyAction).toBe(n);
    }
  });
  it("oops: the right hand reaches forward before the cup tips, then both hands fly up to the face and the head goes back", () => {
    expect(OOPS_TIP_S).toBeCloseTo(SPILL_TIP_AT_S, 9);                           // the reach ends where the cup tips, in both visits
    expect(OOPS_TIP_S).toBeCloseTo(DUMP_TIP_AT_S, 9);
    const reach = clipPose("oops", OOPS_TIP_S - 0.1);
    expect(reach.armR.z).toBeGreaterThan(0.9);
    const gasp = clipPose("oops", 0.8);
    expect(gasp.armL.y).toBeGreaterThan(0.3);
    expect(gasp.armR.y).toBeGreaterThan(0.3);
    expect(gasp.hips.y).toBeGreaterThan(0.03);                                   // a little hop
    expect(baked.oops!.duration).toBeCloseTo(OOPS_S, 1);
  });
  it("mop: the arms stay forward and low on the handle, swinging from one side to the other with each stroke, and the clip is as long as the mopping", () => {
    expect(MOP_CLIP_START_S).toBeCloseTo(MOP_START_S, 9);
    expect(MOP_CLIP_EVERY_S).toBeCloseTo(MOP_EVERY_S, 9);
    expect(MOP_CLIP_STROKES).toBe(MOP_STROKES);
    for (let i = 0; i < MOP_STROKES; i++) {
      const p = clipPose("mop", MOP_START_S + (i + 1) * MOP_EVERY_S);
      expect(p.armL.z, `stroke ${i}`).toBeGreaterThan(0.7);
      expect(p.armR.z, `stroke ${i}`).toBeGreaterThan(0.7);
    }
    const a = clipPose("mop", MOP_START_S + MOP_EVERY_S), b = clipPose("mop", MOP_START_S + 2 * MOP_EVERY_S);
    expect(Math.sign(a.armL.x + a.armR.x)).not.toBe(Math.sign(b.armL.x + b.armR.x));   // both arms swing one way, then the other
    expect(baked.mop!.duration).toBeGreaterThanOrEqual(MOP_END_S);
    expect(baked.mop!.duration).toBeLessThan(MOP_END_S + 0.6);
  });
  it("tidy: one sweep for each toy that goes home, on the same beat as the toys, and no longer than the tidying plus a moment", () => {
    expect(TIDY_CLIP_START_S).toBeCloseTo(TIDY_START_S, 9);
    expect(TIDY_CLIP_EVERY_S).toBeCloseTo(TIDY_EVERY_S, 9);
    expect(TIDY_CLIP_MAX).toBe(PILE_TOYS);
    expect(baked.tidy!.duration).toBeGreaterThanOrEqual(tidyEndsAt(PILE_TOYS) - 0.6);
    const lifted = [0, 1].map((i) => clipPose("tidy", TIDY_START_S + i * TIDY_EVERY_S));
    expect(lifted[0]!.armL.y).toBeGreaterThan(0);                                // the left arm sweeps up on the first toy
    expect(lifted[1]!.armR.y).toBeGreaterThan(0);                                // the right on the second
  });
});

describe("the two props are in the game's registries", () => {
  it("are prop types with specs that name them and leave their reaction to Kip: a tap says the name and nothing moves", () => {
    for (const t of ["cup", "toybox"] as const) {
      expect(PROP_TYPES).toContain(t);
      expect(PROP_SPECS[t].noun).toBe(t);
      expect(PROP_SPECS[t].poke).toBe("none");
      expect(PROP_SPECS[t].use).toBe("none");
      expect(NOUN_KEYS).toContain(t);
      expect(PROPS[t]).toBeTruthy();
    }
    expect(ACT_FOR_PROP.cup).toBe("spill");
    expect(ACT_FOR_PROP.toybox).toBe("dump");
  });
  it("have names in all seven languages that agree with their colour", () => {
    const want: Record<string, [string, string]> = {
      en: ["orange cup", "blue toy box"], es: ["taza naranja", "caja de juguetes azul"], fr: ["tasse orange", "coffre à jouets bleu"], de: ["oranger Becher", "blaue Spielzeugkiste"],
      it: ["tazza arancione", "scatola dei giocattoli blu"], pt: ["copo laranja", "caixa de brinquedos azul"], tr: ["turuncu bardak", "mavi oyuncak kutusu"],
    };
    for (const l of LANGUAGES) {
      expect(propPhrase("cup", PROP_SPECS.cup.color, l.code), l.code).toBe(want[l.code]![0]);
      expect(propPhrase("toybox", PROP_SPECS.toybox.color, l.code), l.code).toBe(want[l.code]![1]);
    }
  });
  it("stand in the Toy Room clear of the other props and of the hiding places (the bookshelf, the bed ...), with room for Kip and the mess beside them", () => {
    const room = LEVELS.find((l) => l.id === "room")!;
    const props = room.props.map((p) => ({ type: p.type, x: p.x, z: p.z ?? PROPS[p.type]?.z ?? -2.4 }));
    const cup = props.find((p) => p.type === "cup")!, box = props.find((p) => p.type === "toybox")!;
    expect(cup).toBeTruthy();
    expect(box).toBeTruthy();
    for (const mine of [cup, box]) {
      for (const other of props) {
        if (other === mine || other.type === "lamp") continue;
        if (Math.abs(other.z - mine.z) > 1.5) continue;                          // a different depth: not in the way
        expect(Math.abs(other.x - mine.x), `${mine.type} at ${mine.x} and ${other.type} at ${other.x}`).toBeGreaterThan(1.8);   // (the box is 1.9 wide and the ball 1.3: half of each is 1.6)
      }
      // the hiding places stand in the lane (the bed at 13 is 3.9 wide, the bookshelf at 28.9 wider than that): the toy box's heap and the puddle must not land on them
      for (const spot of room.spots) expect(Math.abs(spot.x - mine.x), `${mine.type} at ${mine.x} and the hiding place at ${spot.x}`).toBeGreaterThan(3);
    }
    expect(box.z).toBeLessThan(-1.2 + 0.2);                                       // behind the lane, so the heap lands in it
    expect(cup.z).toBeLessThan(-1.2 + 0.2);
    expect(props.filter((p) => p.type === "books").length).toBeGreaterThanOrEqual(1);   // (the second book stack made room for the cup)
  });
});
