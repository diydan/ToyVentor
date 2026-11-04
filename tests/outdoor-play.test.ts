// The outdoor things to play with (runtime/outdoorProps.ts, playClips.ts, playthings.ts, craneDrop.ts): the props, the clips, what Kip does with each and the crane's crate.
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROP_LANG_KEY } from "../src/lib/propSpeech";
import { resetVoiceBackoff } from "../src/lib/propVoice";
import { NOUN_KEYS, LANGUAGES, describeObject } from "../src/lib/propNames";
import { createPropFx, PROP_SPECS, PROP_TYPES } from "../src/features/game/world/runtime/propReactions";
import {
  ANGEL_PAD_R, FLOWER_X, NIBBLE_S, PUFF_TOP, SANDWICH_COUNT, SEAT_THICK, SWING_ROPE, SWING_TOP, bunnyPose, buildAngelPatch, buildBunny, buildCrateMesh, buildFlowerBed, buildPicnic,
  buildPuffCloud, buildPumpkinPatch, buildSwing, flowerSize, seatPoint, swingAngle, PUMPKIN_SLOTS,
} from "../src/features/game/world/runtime/outdoorProps";
import {
  ANGEL_S, BITES_S, OFFER_S, OFFER_TAKE_S, PICK_S, PLAY_ACTIONS, PLAY_CLIPS, POUR_S, SIT_EAT_S, SMELL_S, SWING_S,
} from "../src/features/game/world/runtime/playClips";
import { BOUQUET_S, DEEPEST_Z, FRONT_OF_PROP, GROW_FROM_S, GROW_TO_S, HOP_S, PATH_Z, RIDE_S, SIT_DROP, STEP_S, TIRE_PUSH_S, TIRE_VX, WATER_S, createPlaythings, growthAt, lane, ridePath, stepZ } from "../src/features/game/world/runtime/playthings";
import { CRATE_REST_S, CRATE_SHRINK_S, JIB_DX, JIB_Y, LAND_Z, MAX_CRATES, attachCraneDrop, fallTime, startCrate, stepCrate } from "../src/features/game/world/runtime/craneDrop";
import { readFileSync } from "node:fs";
import { BLOCK_CHEER_AT, MAX_LAYERS, START_LAYERS, buildBlockTower } from "../src/features/game/world/runtime/blockTower";
import { buildUpSandcastle } from "../src/features/game/world/runtime/buildUp";
import { FRUIT } from "../src/features/game/world/runtime/propReactions";
import { kindById, kindFits, kindsFor, orchardKind } from "../src/features/game/world/runtime/treeKinds";
import { createAppetite } from "../src/features/game/world/runtime/fruitAppetite";
import { LEVELS } from "../src/features/game/world/runtime/catalog";
import { ACT_FOR_PROP, type ActsWorld } from "../src/features/game/world/runtime/toyRoomActs";
import { HELD } from "../src/features/game/world/runtime/heldItems";
import type { PropInst } from "../src/features/game/world/runtime/propReactions";

beforeEach(() => {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, String(v)), removeItem: (k: string) => void map.delete(k), clear: () => map.clear(), key: () => null, length: 0 });
  localStorage.setItem(PROP_LANG_KEY, "en");
  resetVoiceBackoff();
});
afterEach(() => vi.unstubAllGlobals());

const NEW_TYPES = ["puffcloud", "angelpatch", "flowerbed", "bunny", "picnic", "swing", "pumpkins", "basket"] as const;

describe("the new props are registered and named", () => {
  it("every new prop type has a spec with a noun, and every noun is spoken in all seven languages", () => {
    for (const t of NEW_TYPES) {
      expect(PROP_TYPES, t).toContain(t);
      const spec = PROP_SPECS[t];
      expect(spec.noun, t).not.toBeNull();
      for (const l of LANGUAGES) expect(describeObject({ noun: spec.noun!, color: spec.color }, l.code)!.text.length, `${t} in ${l.code}`).toBeGreaterThan(2);
    }
    for (const k of ["snowangel", "flowers", "bunny", "picnic", "swing", "basket", "appletree", "peartree", "bananapalm", "blueberrybush"]) expect(NOUN_KEYS).toContain(k);
  });
  it("what a tap on each starts: the cloud is bounced on, the tire pushed, the patch gets an angel, the bed is watered, the bunny fed, the picnic eaten and the swing ridden", () => {
    expect(ACT_FOR_PROP).toMatchObject({ puffcloud: "jump", tire: "roll", angelpatch: "angel", flowerbed: "water", bunny: "feed", picnic: "picnic", swing: "ride" });
  });
  it("the crane and the tire are built up on top of the old specs: the crane drops crates ('stack'), the tire still names itself", () => {
    expect(PROP_SPECS.cranebg.use).toBe("stack");
    expect(PROP_SPECS.tire.noun).toBe("tire");
  });
});

describe("the props", () => {
  it("the puffy cloud tells the bounce where to land, and is low enough to jump onto", () => {
    const g = buildPuffCloud(5, -1.4);
    expect(g.userData.topY).toBe(PUFF_TOP);
    expect(PUFF_TOP).toBeGreaterThan(0.6);
    expect(PUFF_TOP).toBeLessThan(1.3);
    const top = new THREE.Box3().setFromObject(g).max.y;
    expect(top).toBeGreaterThan(PUFF_TOP * 0.8);
    expect(top).toBeLessThan(PUFF_TOP * 1.4);
  });
  it("the snow angel patch shows no angel until told to, and the angel grows to full size and shows", () => {
    const g = buildAngelPatch(33, -1.2);
    const im = g.userData.imprint as THREE.Object3D;
    expect(im.visible).toBe(false);
    g.userData.setImprint(0.5);
    expect(im.visible).toBe(true);
    const half = im.scale.x;
    g.userData.setImprint(1);
    expect(im.scale.x).toBeGreaterThan(half);
    g.userData.setImprint(0);
    expect(im.visible).toBe(false);
    g.userData.setImprint(7);                                                      // out of range is a full angel, not a bigger one
    expect(im.scale.x).toBeCloseTo(g.userData.setImprint(1) ?? im.scale.x, 6);
    const box = new THREE.Box3().setFromObject(im);
    expect(Math.max(box.max.x - box.min.x, box.max.z - box.min.z)).toBeLessThan(ANGEL_PAD_R * 2);       // the angel fits on the pad
  });
  it("flowers grow from a bud on a short stem to an open flower on a tall one, and never past either end", () => {
    const a = flowerSize(0), b = flowerSize(1);
    expect(b.stem).toBeGreaterThan(a.stem * 2);
    expect(b.head).toBeGreaterThan(a.head);
    expect(flowerSize(-3)).toEqual(a);
    expect(flowerSize(9)).toEqual(b);
    const bed = buildFlowerBed(10, -1.2);
    const stems = (k: number) => { bed.userData.setGrowth(k); return bed.children.filter((c) => (c as THREE.Mesh).geometry?.type === "CylinderGeometry" && (c as THREE.Mesh).scale.y > 0.2).map((c) => c.scale.y); };
    expect(bed.userData.growth()).toBe(0);                                         // a bed starts as buds
    expect(Math.max(...stems(1))).toBeCloseTo(1, 5);
    expect(bed.userData.growth()).toBe(1);
    bed.userData.setGrowth(0);
    expect(bed.userData.growth()).toBe(0);
    expect(Math.max(...stems(0))).toBeLessThan(0.3);
    expect(bed.userData.flowerX).toEqual([...FLOWER_X]);
    expect((bed.userData.can as THREE.Object3D).visible).toBe(true);
  });
  it("the flower bed's tap box covers the open flowers even while they are only buds", () => {
    const { fx, world } = setup();
    const bed = buildFlowerBed(10, -1.2);
    world.add(bed);
    const inst = fx.register("flowerbed", [bed])!;
    expect(inst.size.y).toBeGreaterThan(1.4);                                      // as tall as a grown flower (a flat bed would be about 0.7)
  });
  it("the bunny breathes, flicks its ears now and then, bobs its head while it nibbles for NIBBLE_S, and hops", () => {
    expect(bunnyPose(0, -1, -1)).toMatchObject({ headDip: 0, hop: 0 });
    expect(bunnyPose(0, 0.07, -1).headDip).toBeGreaterThan(0);
    expect(bunnyPose(0, NIBBLE_S + 0.1, -1).headDip).toBe(0);
    expect(bunnyPose(0, -1, 0.25).hop).toBeGreaterThan(0.2);
    expect(bunnyPose(0, -1, 0.6).hop).toBe(0);
    const swell = [0, 0.65, 1.3, 1.9].map((t) => bunnyPose(t, -1, -1).breathe);
    expect(new Set(swell.map((v) => v.toFixed(3))).size).toBeGreaterThan(1);
  });
  it("the bunny does what it is cued (the world's cue is { name, at }): a nibble dips the head, a hop lifts it", () => {
    const b = buildBunny(18, -1.4);
    const head = b.children[1]!;
    const y0 = head.position.y;
    b.userData.tick(1, 0.016);
    expect(head.position.y).toBe(y0);
    b.userData.cue = { name: "nibble", at: 1 };
    b.userData.tick(1.07, 0.016);
    expect(head.position.y).toBeLessThan(y0);
    b.userData.cue = { name: "hop", at: 3 };
    b.userData.tick(3.25, 0.016);
    expect(b.position.y).toBeGreaterThan(0.2);
    b.userData.tick(4, 0.016);
    expect(b.position.y).toBe(0);
  });
  it("the picnic has three sandwiches and can show fewer", () => {
    const p = buildPicnic(24.5, -1.2);
    expect(p.userData.food).toHaveLength(SANDWICH_COUNT);
    p.userData.setFood(1);
    expect((p.userData.food as THREE.Object3D[]).map((f) => f.visible)).toEqual([true, false, false]);
    p.userData.setFood(SANDWICH_COUNT);
    expect((p.userData.food as THREE.Object3D[]).every((f) => f.visible)).toBe(true);
  });
  it("the swing: the seat's top is SEAT_THICK above where it hangs, swings out along an arc, and the ride builds up, swings both ways and ends still", () => {
    expect(seatPoint(0).dx).toBeCloseTo(0, 6);
    expect(seatPoint(0).y).toBeCloseTo(SWING_TOP - SWING_ROPE - SEAT_THICK / 2 + SEAT_THICK / 2, 6);
    expect(seatPoint(0.5).dx).toBeGreaterThan(0.9);
    expect(seatPoint(0.5).y).toBeGreaterThan(seatPoint(0).y);                      // swinging out lifts the seat
    expect(seatPoint(-0.5).dx).toBeCloseTo(-seatPoint(0.5).dx, 6);
    const total = 4;
    expect(swingAngle(0, total)).toBe(0);
    expect(swingAngle(total, total)).toBe(0);
    expect(swingAngle(-1, total)).toBe(0);
    const samples = Array.from({ length: 200 }, (_, i) => swingAngle((i / 200) * total, total));
    expect(Math.max(...samples)).toBeGreaterThan(0.3);
    expect(Math.min(...samples)).toBeLessThan(-0.3);
    expect(Math.max(...samples.map(Math.abs))).toBeLessThanOrEqual(0.62 + 1e-9);
    expect(Math.abs(swingAngle(0.3, total))).toBeLessThan(Math.abs(swingAngle(2.1, total)) + 0.3);      // it starts gently
    const s = buildSwing(30, -1.2);
    s.userData.setAngle(0.4);
    expect(s.userData.angle()).toBe(0.4);
    expect((s.userData.pivot as THREE.Object3D).rotation.z).toBeCloseTo(0.4, 6);   // a positive angle swings the seat toward +x (see "the swing hangs where it swings")
    s.userData.riding = true;
    s.userData.tick(5, 0.016);                                                     // while ridden the idle sway does not fight the ride
    expect((s.userData.pivot as THREE.Object3D).rotation.z).toBeCloseTo(0.4, 6);
  });
  it("the crate mesh is a CRATE-sized box", () => {
    const box = new THREE.Box3().setFromObject(buildCrateMesh());
    expect(box.max.y - box.min.y).toBeGreaterThan(0.85);
    expect(box.max.y - box.min.y).toBeLessThan(1.1);
  });
});

describe("the clips", () => {
  const frames = (name: string) => PLAY_CLIPS[name]!;
  it("every play action has a clip, baked at 30 fps for exactly its length", () => {
    expect(Object.keys(PLAY_CLIPS).sort()).toEqual([...PLAY_ACTIONS].sort());
    const lengths: Record<string, number> = { angel: ANGEL_S, pour: POUR_S, pick: PICK_S, smell: SMELL_S, offer: OFFER_S, sit_eat: SIT_EAT_S, swing: SWING_S };
    for (const a of PLAY_ACTIONS) {
      const c = frames(a);
      expect(c.duration, a).toBeCloseTo(lengths[a]!, 6);
      expect(c.frames, a).toBe(Math.round(lengths[a]! * 30) + 1);
      expect(c.loop, a).toBe(false);
    }
  });
  it("each clip begins and ends at (about) rest, so it blends in and out cleanly (the angel is lying at both ends and the smell begins with the hand up)", () => {
    for (const a of PLAY_ACTIONS) {
      const c = frames(a);
      const last = (c.frames - 1) * 4;
      if (a === "angel") { expect(c.body[3]!, "angel start lying").toBeLessThan(0.8); expect(c.body[last + 3]!, "angel end lying").toBeLessThan(0.8); continue; }      // (the angel is lying at both ends, like the sleep clip: the driver fades it in and out)
      expect(Math.abs(c.body[3]! - 1), `${a} start`).toBeLessThan(0.01);
      expect(Math.abs(c.body[last + 3]! - 1), `${a} end`).toBeLessThan(0.01);
    }
  });
  it("the angel lies on its back and sweeps its arms up over its head and back down, three times", () => {
    const c = frames("angel");
    const arm = (f: number) => [c.armL[f * 3]!, c.armL[f * 3 + 1]!, c.armL[f * 3 + 2]!];
    const ys = Array.from({ length: c.frames }, (_, f) => arm(f)[1]!);
    let ups = 0;
    for (let f = 1; f < ys.length - 1; f++) if (ys[f]! > 0.5 && ys[f]! >= ys[f - 1]! && ys[f]! > ys[f + 1]!) ups++;
    expect(ups).toBe(3);
    expect(c.body[0]!).toBeLessThan(-0.6);                                          // lying: a big turn about x from frame 0
  });
  it("the sit clips lower the hips and put the legs out in front", () => {
    for (const a of ["sit_eat", "swing"] as const) {
      const c = frames(a);
      const mid = Math.round(c.frames * (a === "swing" ? 0.3 : 0.4));
      expect(c.hips[mid * 3 + 1]!, a).toBeLessThan(-0.2);
      expect(c.legL[mid * 3 + 2]!, a).toBeGreaterThan(0.4);
    }
  });
  it("the bites land at the times the visit cues them, one hand-to-mouth each", () => {
    const c = frames("sit_eat");
    for (const t of BITES_S) {
      const f = Math.round(t * 30);
      expect(c.armR[f * 3 + 1]!, `at ${t}`).toBeGreaterThan(0.2);                    // the right hand is up near the mouth
    }
  });
});

describe("the paths", () => {
  it("the flowers are closed until the water falls, then open over a second and a half, and stay open", () => {
    expect(growthAt(0)).toBe(0);
    expect(growthAt(GROW_FROM_S)).toBe(0);
    expect(growthAt((GROW_FROM_S + GROW_TO_S) / 2)).toBeCloseTo(0.5, 6);
    expect(growthAt(GROW_TO_S)).toBe(1);
    expect(growthAt(99)).toBe(1);
    expect(GROW_TO_S).toBeLessThan(WATER_S);                                        // fully open before the visit is over
  });
  it("the toy is asked to stand only where it can walk (the world clamps depth to +-1.2)", () => {
    expect(PATH_Z).toBe(1.2);
    expect(lane(-2)).toBe(-1.2);
    expect(lane(3)).toBe(1.2);
    expect(lane(0.4)).toBe(0.4);
  });
  it("the swing ride: standing at the start, hops up onto the seat, rides along the arc at the swing's own depth, hops down and ends standing", () => {
    const stand = { x: 28.6, z: -1.2 }, swing = { x: 29.9, z: -2.0 };
    const angle = (t: number) => swingAngle(t, RIDE_S - 2 * HOP_S);
    const at = (t: number) => ridePath(t, stand, swing, angle);
    expect(at(0)).toMatchObject({ x: stand.x, y: 0, z: stand.z });
    expect(at(RIDE_S).y).toBeCloseTo(0, 9);
    expect(at(RIDE_S)).toMatchObject({ x: stand.x, z: stand.z });
    expect(at(RIDE_S + 5)).toMatchObject({ x: stand.x, y: 0 });
    const hopMid = at(HOP_S / 2);
    expect(hopMid.y).toBeGreaterThan(0.7);                                          // up in the air on the way
    const seat0 = seatPoint(0);
    const sat = at(HOP_S + 0.0001);
    expect(sat.x).toBeCloseTo(swing.x + seat0.dx, 2);
    expect(sat.y).toBeCloseTo(seat0.y - SIT_DROP, 2);                               // (the first moment on the seat: the swing hangs straight)
    expect(sat.z).toBeCloseTo(swing.z, 2);
    let maxAngle = 0, minY = 99;
    for (let t = HOP_S + 0.01; t < RIDE_S - HOP_S - 0.01; t += 0.05) {
      const p = at(t);
      maxAngle = Math.max(maxAngle, Math.abs(p.angle));
      minY = Math.min(minY, p.y);
      expect(p.z).toBeCloseTo(swing.z, 6);
      const s = seatPoint(p.angle);
      // Kip's origin hangs SIT_DROP below the seat's top along the seat's own down, which tilts with the swing: the seat's top is always where it says
      expect(p.x + SIT_DROP * -Math.sin(p.angle)).toBeCloseTo(swing.x + s.dx, 6);
      expect(p.y + SIT_DROP * Math.cos(p.angle)).toBeCloseTo(s.y, 6);              // always on the seat
    }
    expect(maxAngle).toBeGreaterThan(0.3);
    expect(minY).toBeGreaterThan(0.2);                                              // never through the ground
    // the path is continuous: no jump of more than a unit between frames anywhere
    let prev = at(0);
    for (let t = 1 / 60; t <= RIDE_S; t += 1 / 60) { const p = at(t); expect(Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z), `t=${t.toFixed(2)}`).toBeLessThan(0.45); prev = p; }
  });
});

describe("the crane's crate", () => {
  it("falls from the jib in fallTime, bounces a couple of times, lies for a few seconds, shrinks away and is done", () => {
    let c = startCrate();
    let t = 0, landedAt = -1, restAt = -1, doneAt = -1;
    while (t < 12 && !c.done) {
      c = stepCrate(c, 1 / 60); t += 1 / 60;
      if (landedAt < 0 && c.bounces >= 1) landedAt = t;
      if (restAt < 0 && c.resting) restAt = t;
      if (c.done) doneAt = t;
      expect(c.y).toBeGreaterThanOrEqual(0.45 - 1e-9);                               // never through the floor
    }
    expect(landedAt).toBeCloseTo(fallTime(), 1);
    expect(c.bounces).toBeGreaterThanOrEqual(1);
    expect(restAt).toBeGreaterThan(landedAt);
    expect(restAt - landedAt).toBeLessThan(1.5);                                     // it settles quickly
    expect(doneAt - restAt).toBeGreaterThan(CRATE_REST_S);
    expect(doneAt - restAt).toBeLessThan(CRATE_REST_S + CRATE_SHRINK_S + 0.2);
  });
  it("a long frame, a negative or a bad time step cannot skip the floor or break it", () => {
    let c = startCrate();
    c = stepCrate(c, Number.NaN); c = stepCrate(c, -1); c = stepCrate(c, Infinity);
    expect(Number.isFinite(c.y)).toBe(true);
    for (let i = 0; i < 400; i++) c = stepCrate(c, 5);                                // a tab left in the background
    expect(c.y).toBeGreaterThanOrEqual(0.45 - 1e-9);
  });
  it("the crane group gets stack() and tick(): a tap drops a crate into the world at the jib, at most MAX_CRATES at once, each gone when its time is up", () => {
    const root = new THREE.Group();
    const crane = new THREE.Group();
    crane.position.set(42, 0, -14);
    root.add(crane);
    attachCraneDrop(crane);
    const r = crane.userData.stack();
    expect(r).toMatchObject({ kind: "added", sfx: "clank" });
    expect(r.landsIn).toBeCloseTo(fallTime(), 6);
    const crate = root.children[1]!;
    expect(crate.position.x).toBeCloseTo(42 + JIB_DX, 6);
    expect(crate.position.y).toBeCloseTo(JIB_Y, 6);
    expect(crate.position.z).toBeCloseTo(LAND_Z, 6);
    expect(crate.userData.noPick).toBe(true);                                        // a tap goes through it to the world
    for (let i = 0; i < 30; i++) crane.userData.tick(0, 1 / 60);                     // half a second
    expect(crate.position.y).toBeLessThan(JIB_Y - 2);
    for (let i = 0; i < 6; i++) crane.userData.stack();
    expect((crane.userData.crates as unknown[]).length).toBe(MAX_CRATES);
    expect(root.children.length).toBe(1 + MAX_CRATES);                               // the oldest was taken out of the world
    for (let i = 0; i < 400; i++) crane.userData.tick(0, 0.05);
    expect((crane.userData.crates as unknown[]).length).toBe(0);
    expect(root.children.length).toBe(1);
  });
  it("a crane with no world to drop into does nothing", () => {
    const crane = attachCraneDrop(new THREE.Group());
    expect(crane.userData.stack()).toEqual({ kind: "busy" });
  });
});

// ---- what Kip does ----------------------------------------------------------------------------------------------------------

function setup() {
  const world = new THREE.Group();
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 400 }) } as unknown as HTMLElement;
  const fx = createPropFx({ root: () => world, camera: () => new THREE.PerspectiveCamera(36, 2, 0.1, 200), canvas, toast: () => {}, boostWindmill: () => {}, reduced: () => false, canSpeak: () => false });
  return { fx, world };
}
function fake() {
  const log: string[] = [];
  const root = new THREE.Group();
  const kicks: Array<{ vx: number; vy: number }> = [];
  const cues: string[] = [];
  const pos = { x: 0, y: 0, z: 0 };
  const w = {
    root: () => root, eater: () => "character", allowed: () => true,
    position: () => ({ ...pos }), targetX: () => null, walkTo: () => {}, stopWalk: () => {}, face: () => {},
    clip: (a: string) => { log.push(`clip:${a}`); return true; },
    hold: (i: string) => log.push(`hold:${i}`), release: () => log.push("release"),
    mouth: () => ({ x: 0, y: 0, z: 0 }), bubbles: { blow: () => {} }, setPosition: (x: number, y: number, z: number) => { pos.x = x; pos.y = y; pos.z = z; log.push(`pos:${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}`); },
    tone: () => {}, phase: () => {},
    fx: { squish: () => {}, strike: () => null, kickBall: (_i: unknown, vx: number, vy: number) => { kicks.push({ vx, vy }); return true; }, flutter: () => {}, say: () => {}, setVisible: () => {}, cue: (_i: unknown, n: string) => cues.push(n), nearby: () => [] },
  } as unknown as ActsWorld;
  const glyphs: string[] = [];
  const follow: Array<[unknown, number]> = [];
  const h = { heart: () => glyphs.push("heart"), note: () => glyphs.push("note"), flake: () => glyphs.push("flake"), follow: (i: unknown, d: number) => follow.push([i, d]) };
  const things = createPlaythings(w, h);
  return { things, log, kicks, cues, glyphs, follow, root, pos };
}
const instOf = (type: string, x: number, z: number, holder: THREE.Group = new THREE.Group()): PropInst => {
  holder.position.set(x, 0, z);
  return { type, base: { px: x, py: 0, pz: z }, size: new THREE.Vector3(2, 1, 1), kick: null, holder } as unknown as PropInst;
};
const run = (v: ReturnType<ReturnType<typeof fake>["things"]["visitFor"]>, upTo: number) => {
  v!.begin();
  let cue = 0;
  const cues = v!.cues ?? [];
  for (let t = 0; t <= upTo + 1e-9; t += 1 / 60) {
    v!.tick?.(t);
    while (cue < cues.length && cues[cue]!.at <= t) { cues[cue]!.fn(); cue++; }
  }
};

describe("the tire", () => {
  it("Kip stands to the left of it, pushes with the shove clip and at the push the tire is sent rolling to the right, then Kip follows it", () => {
    const f = fake();
    const tire = instOf("tire", 11, -1.9);
    const v = f.things.visitFor("roll", tire)!;
    expect(v.standX).toBeCloseTo(11 - 1.6, 6);
    expect(v.face).toBe(1);
    run(v, v.seconds);
    expect(f.log).toContain("clip:shove");
    expect(f.kicks).toEqual([{ vx: TIRE_VX, vy: 0 }]);
    expect(v.cues![0]!.at).toBe(TIRE_PUSH_S);
    v.end(true);
    expect(f.follow).toEqual([[tire, 1]]);
  });
  it("Kip always stands inside the floor's limits (a tire at the left wall is pushed from its right), and a tire already rolling is not pushed again", () => {
    const f = fake();
    for (const x of [1.2, 11, 42.5]) {
      const v = f.things.visitFor("roll", instOf("tire", x, -1.9))!;
      expect(v.standX, `x=${x}`).toBeGreaterThanOrEqual(0.9);
      expect(v.standX, `x=${x}`).toBeLessThanOrEqual(43.1);
    }
    expect(f.things.visitFor("roll", instOf("tire", 1.2, -1.9))!.face).toBe(-1);
    const moving = instOf("tire", 11, -1.9);
    (moving as { kick: unknown }).kick = { x: 11 };
    expect(f.things.visitFor("roll", moving)).toBeNull();
  });
  it("a push that did not roll (the tire could not be kicked) does not send Kip after it", () => {
    const f = fake();
    const v = f.things.visitFor("roll", instOf("tire", 11, 0))!;
    (v as unknown as { cues: Array<{ at: number; fn: () => void }> }).cues[0]!.fn = () => {};
    v.begin(); v.end(true);
    expect(f.follow).toEqual([]);
  });
  it("in the real prop effects a tire can be kicked and rolls like a ball: it turns about its own centre and its sideways turn straightens", () => {
    const { fx, world } = setup();
    const tire = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.22, 8, 16), new THREE.MeshBasicMaterial());
    tire.position.set(11, 0.72, -1.9);
    tire.rotation.y = 0.4;
    world.add(tire);
    const inst = fx.register("tire", [tire])!;
    expect(inst.pivot).not.toBeNull();
    expect(fx.kickBall(inst, 4.4, 0)).toBe(true);
    for (let i = 0; i < 20; i++) fx.update(1 / 60, i / 60);
    expect(inst.base.px).toBeGreaterThan(11.5);
    expect(inst.pivot!.rotation.z).toBeLessThan(-0.2);                               // turning forward
    expect(Math.abs(inst.pivot!.children[0]!.rotation.y)).toBeLessThan(0.05);        // straightened
    for (let i = 20; i < 600; i++) fx.update(1 / 60, i / 60);
    expect(inst.kick).toBeNull();                                                     // it stops
    expect(inst.base.px).toBeGreaterThan(13);
    expect(inst.base.px).toBeLessThan(18);
    const other = fx.register("lamp", [new THREE.Group()]);
    expect(other && fx.kickBall(other, 3, 0)).toBe(false);                            // nothing else rolls
  });
});

describe("the snow angel", () => {
  it("Kip walks onto the patch, lies down with the angel clip, snowflakes fall on each sweep, and the angel stays in the snow after", () => {
    const f = fake();
    const patch = buildAngelPatch(33.4, -1.2);
    const inst = instOf("angelpatch", 33.4, -1.2, patch);
    const v = f.things.visitFor("angel", inst)!;
    expect(v.standX).toBe(33.4);
    expect(v.standZ).toBe(-1.2);
    run(v, v.seconds);
    expect(f.log).toContain("clip:angel");
    expect(f.glyphs.filter((g) => g === "flake").length).toBe(9);                     // three flakes on each of three sweeps
    expect((patch.userData.imprint as THREE.Object3D).visible).toBe(true);
    v.end(true);
    expect((patch.userData.imprint as THREE.Object3D).scale.x).toBeGreaterThan(1);
  });
  it("a cut-short angel leaves clean snow", () => {
    const f = fake();
    const patch = buildAngelPatch(33.4, -1.2);
    const v = f.things.visitFor("angel", instOf("angelpatch", 33.4, -1.2, patch))!;
    v.begin();
    v.tick!(1.0);
    v.end(false);
    expect((patch.userData.imprint as THREE.Object3D).visible).toBe(false);
  });
});

describe("the flower bed", () => {
  const bed = () => { const g = buildFlowerBed(10, -1.2); return { g, inst: instOf("flowerbed", 10, -1.2, g) }; };
  it("a bed of buds is watered: the can leaves the ground into Kip's hand, water falls, the flowers open, hearts float up, the can goes back", () => {
    const f = fake();
    const { g, inst } = bed();
    const v = f.things.visitFor("water", inst)!;
    expect(v.standX).toBe(10 - 2.1);
    expect(v.seconds).toBe(WATER_S);
    v.begin();
    expect((g.userData.can as THREE.Object3D).visible).toBe(false);
    const cues = v.cues!;
    let cue = 0, sawWater = 0;
    for (let t = 0; t <= v.seconds; t += 1 / 60) {
      v.tick!(t);
      while (cue < cues.length && cues[cue]!.at <= t) { cues[cue]!.fn(); cue++; }
      f.things.update(1 / 60);
      sawWater = Math.max(sawWater, f.things.dropCount);
    }
    expect(f.log).toEqual(expect.arrayContaining(["clip:pour", "hold:can", "release"]));
    expect(sawWater).toBeGreaterThan(5);
    expect(g.userData.growth()).toBe(1);
    expect(f.glyphs.filter((x) => x === "heart")).toHaveLength(3);
    expect((g.userData.can as THREE.Object3D).visible).toBe(true);
    v.end(true);
    expect(g.userData.growth()).toBe(1);
  });
  it("a bed in full flower is picked next time: the bouquet is held and smelled and the bed goes back to buds", () => {
    const f = fake();
    const { g, inst } = bed();
    g.userData.setGrowth(1);
    const v = f.things.visitFor("water", inst)!;
    expect(v.seconds).toBe(BOUQUET_S);
    expect(v.standX).toBe(10 - 1.5);
    run(v, v.seconds);
    expect(f.log).toEqual(expect.arrayContaining(["clip:pick", "hold:bouquet", "clip:smell"]));
    expect(g.userData.growth()).toBe(0);
    v.end(true);
    expect(f.log[f.log.length - 1]).toBe("release");
    expect(f.glyphs).toContain("heart");
  });
  it("a watering cut short puts the can back and leaves the bed as buds; the drops are cleared by reset", () => {
    const f = fake();
    const { g, inst } = bed();
    const v = f.things.visitFor("water", inst)!;
    v.begin();
    for (let t = 0; t < 1.6; t += 1 / 60) { v.tick!(t); f.things.update(1 / 60); }
    expect(f.things.dropCount).toBeGreaterThan(0);
    v.end(false);
    expect(g.userData.growth()).toBe(0);
    expect((g.userData.can as THREE.Object3D).visible).toBe(true);
    f.things.reset();
    expect(f.things.dropCount).toBe(0);
  });
});

describe("the bunny and the picnic", () => {
  it("Kip offers the bunny a carrot: it is held out, taken at OFFER_TAKE_S, the bunny nibbles, then hops and hearts rise", () => {
    const f = fake();
    const v = f.things.visitFor("feed", instOf("bunny", 18.3, -1.4))!;
    expect(v.seconds).toBe(OFFER_S);
    expect(v.standZ).toBe(-1.2);                                                      // clamped to where the toy can walk
    run(v, v.seconds);
    expect(f.log).toEqual(expect.arrayContaining(["clip:offer", "hold:carrot", "release"]));
    expect(f.cues).toEqual(["hop", "nibble", "hop"]);
    expect(v.cues!.find((c) => c.at === OFFER_TAKE_S)).toBeDefined();
    expect(f.glyphs.filter((g) => g === "heart").length).toBe(2);
  });
  it("Kip sits on the blanket and eats: one sandwich off the plate, three bites, the sandwich gone at the end, then the plate is full again", () => {
    const f = fake();
    const p = buildPicnic(24.5, -1.2);
    const v = f.things.visitFor("picnic", instOf("picnic", 24.5, -1.2, p))!;
    expect(v.seconds).toBe(SIT_EAT_S);
    v.begin();
    const cues = v.cues!;
    let cue = 0;
    for (let t = 0; t <= v.seconds; t += 1 / 60) { while (cue < cues.length && cues[cue]!.at <= t) { cues[cue]!.fn(); cue++; } }
    expect(f.log).toEqual(expect.arrayContaining(["clip:sit_eat", "hold:sandwich", "release"]));
    expect((p.userData.food as THREE.Object3D[]).filter((x) => x.visible)).toHaveLength(SANDWICH_COUNT - 1);
    v.end(true);
    expect((p.userData.food as THREE.Object3D[]).every((x) => x.visible)).toBe(true);
    expect(BITES_S.length).toBe(3);
  });
});

describe("the swing ride (the visit)", () => {
  it("walks to the lane beside the swing, then Kip is moved along the seat, the swing turns with it, and at the end Kip is standing and the swing still", () => {
    const f = fake();
    const s = buildSwing(29.9, -2);
    const v = f.things.visitFor("ride", instOf("swing", 29.9, -2, s))!;
    expect(v.standZ).toBe(-1.2);                                                      // the lane, not the swing's own depth
    expect(v.seconds).toBe(RIDE_S);
    v.begin();
    expect(s.userData.riding).toBe(true);
    let sawAngle = 0;
    for (let t = 0; t <= v.seconds; t += 1 / 60) { v.tick!(t); sawAngle = Math.max(sawAngle, Math.abs(s.userData.angle())); }
    expect(sawAngle).toBeGreaterThan(0.3);
    v.end(true);
    expect(s.userData.riding).toBe(false);
    expect(s.userData.angle()).toBe(0);
    expect(f.log[f.log.length - 1]).toMatch(/^pos:28\.60,0\.00,-1\.20$/);
    expect(f.log).toContain("clip:swing");
  });
});

describe("what Kip can hold now", () => {
  it("the can, the carrot, the bouquet and the sandwich are in the held-items table and each builds a real mesh", () => {
    for (const k of ["can", "carrot", "bouquet", "sandwich"] as const) {
      expect(HELD[k].parent, k).toBe("armR");
      const g = HELD[k].build();
      expect(g.children.length, k).toBeGreaterThan(1);
    }
  });
});

describe("trees, palms and bushes are named for what grows on them", () => {
  const name = (type: "tree" | "palm" | "bushes", kind: string | undefined, lang = "en") => {
    localStorage.setItem(PROP_LANG_KEY, lang);
    const toast = vi.fn();
    const world = new THREE.Group();
    const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 400 }) } as unknown as HTMLElement;
    const fx = createPropFx({ root: () => world, camera: () => new THREE.PerspectiveCamera(36, 2, 0.1, 200), canvas, toast, boostWindmill: () => {}, reduced: () => false, canSpeak: () => false });
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 3, 1), new THREE.MeshBasicMaterial()));
    if (kind) g.userData.treeKind = kind;
    world.add(g);
    const inst = fx.register(type, [g])!;
    fx.activate(inst);
    return { said: toast.mock.calls[0]?.[0] as string | undefined, inst };
  };
  it("a tree of a kind says its kind: apple tree, pear tree, orange tree, cherry tree, plum tree, lemon tree", () => {
    for (const [k, said] of [["apple", "Green apple tree"], ["pear", "Green pear tree"], ["orange", "Green orange tree"], ["cherry", "Green cherry tree"], ["plum", "Green plum tree"], ["lemon", "Green lemon tree"]] as const) expect(name("tree", k).said, k).toBe(said);
  });
  it("palms and bushes too, and a tree with no kind (or a kind that does not fit it) is still just a tree", () => {
    expect(name("palm", "coconut").said).toBe("Green coconut palm");
    expect(name("palm", "banana").said).toBe("Green banana palm");
    expect(name("bushes", "strawberry").said).toBe("Green strawberry bush");
    expect(name("bushes", "blueberry").said).toBe("Green blueberry bush");
    expect(name("tree", undefined).said).toBe("Green tree");
    expect(name("tree", "banana").said).toBe("Green tree");                         // a palm kind on a tree prop is ignored, as for the fruit
    expect(name("tree", "nonsense").said).toBe("Green tree");
  });
  it("in the other languages the colour agrees with the new noun", () => {
    expect(name("tree", "pear", "es").said).toBe("Peral verde");
    expect(name("tree", "pear", "fr").said).toBe("Poirier vert");
    expect(name("tree", "pear", "de").said).toBe("Grüner Birnbaum");
    expect(name("palm", "coconut", "pt").said).toBe("Coqueiro verde");
    expect(name("bushes", "blueberry", "it").said).toBe("Cespuglio di mirtilli verde");
    expect(name("tree", "apple", "tr").said).toBe("Yeşil elma ağacı");
  });
  it("the instance carries the noun, and only trees of a kind differ from their spec", () => {
    expect(name("tree", "pear").inst.noun).toBe("peartree");
    expect(name("tree", undefined).inst.noun).toBe("tree");
  });
});

describe("what a tap on a build-up prop tells the world (so Kip can cheer and startle)", () => {
  function towerGame() {
    const events: Array<{ type: string; kind: string; layers?: number; sfx?: string }> = [];
    const world = new THREE.Group();
    const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 400 }) } as unknown as HTMLElement;
    const fx = createPropFx({ root: () => world, camera: () => new THREE.PerspectiveCamera(36, 2, 0.1, 200), canvas, toast: () => {}, boostWindmill: () => {}, reduced: () => false, canSpeak: () => false,
      onStack: (inst, r) => events.push({ type: inst.type, kind: r.kind, layers: (r as { layers?: number }).layers, sfx: (r as { sfx?: string }).sfx }) });
    return { fx, world, events };
  }
  it("each block added reports its layer count, and the crash reports a crash", () => {
    const { fx, world, events } = towerGame();
    const tower = buildBlockTower(9.5, -3.5, () => new THREE.MeshBasicMaterial());
    world.add(tower);
    const inst = fx.register("blocks", [tower])!;
    for (let i = 0; i < MAX_LAYERS - START_LAYERS; i++) { fx.activate(inst); fx.update(0.5, i); }
    expect(events.map((e) => e.layers)).toEqual([3, 4, 5, 6, 7]);
    expect(events.every((e) => e.type === "blocks" && e.kind === "added" && e.sfx === undefined)).toBe(true);
    fx.activate(inst);
    expect(events[events.length - 1]).toMatchObject({ type: "blocks", kind: "crash" });
    fx.activate(inst);                                                            // while it is falling
    expect(events[events.length - 1]).toMatchObject({ kind: "busy" });
  });
  it("the sandcastle reports with its own sound so the world can tell it from a block tower", () => {
    const { fx, world, events } = towerGame();
    const g = new THREE.Group();
    for (let i = 0; i < 18; i++) g.add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.8, 0.4), new THREE.MeshBasicMaterial()));
    world.add(buildUpSandcastle(g));
    const inst = fx.register("sandcastle", [g])!;
    fx.activate(inst);
    expect(events[0]).toMatchObject({ type: "sandcastle", kind: "added", sfx: "soft" });
  });
  it("in the world, Kip cheers from BLOCK_CHEER_AT layers up and startles at the crash, but only for blocks and only for a free character", () => {
    const world = readFileSync(new URL("../src/features/game/world/runtime/world.ts", import.meta.url), "utf8");
    expect(BLOCK_CHEER_AT).toBe(5);
    expect(world).toContain('onStack:function(inst: any,r: any){if(S.type!=="character"||paused||P.busy||ACTS.busy||inst.type!=="blocks")return;if(r.kind==="crash")mixGo("sour");else if(r.kind==="added"&&(r.layers||0)>=BLOCK_CHEER_AT)mixGo("cheer")}');
    expect(world).toContain("import { BLOCK_CHEER_AT, buildBlockTower }");
  });
});

describe("a colour variant: the green apple", () => {
  it("is a tree kind that bears green apples, named like any apple tree, and the apple's own colour word is green", () => {
    const k = kindById("greenapple")!;
    expect(k.fruit).toBe("greenapple");
    expect(kindFits("tree", k)).toBe(true);
    expect(FRUIT.greenapple).toMatchObject({ noun: "apple", say: "green" });
    expect(FRUIT.apple).toMatchObject({ noun: "apple", say: "red" });
    expect(FRUIT.greenapple.color).not.toBe(FRUIT.apple.color);
  });
  it("the Garden's first four orchard trees are what they always were; the fifth tree (new) bears green apples", () => {
    expect([0, 1, 2, 3, 4].map((i) => orchardKind("garden", i)!.id)).toEqual(["apple", "pear", "orange", "cherry", "greenapple"]);
    const garden = LEVELS.find((l) => l.id === "garden")!;
    const trees = garden.props.filter((p) => p.type === "tree" && p.x >= 3);                       // (the tree left of the lane takes no turn)
    expect(trees.map((t) => t.x)).toEqual([9.5, 16, 26.5, 40.5, 36.8]);
  });
  it("tapping a green apple says 'Green apple' and a green apple tree says 'Green apple tree'", () => {
    const toast = vi.fn();
    const world = new THREE.Group();
    const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 400 }) } as unknown as HTMLElement;
    const fx = createPropFx({ root: () => world, camera: () => new THREE.PerspectiveCamera(36, 2, 0.1, 200), canvas, toast, boostWindmill: () => {}, reduced: () => false, canSpeak: () => false });
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 3, 1), new THREE.MeshBasicMaterial()));
    g.userData.treeKind = "greenapple";
    world.add(g);
    const inst = fx.register("tree", [g])!;
    expect(inst.fruit).toBe("greenapple");
    expect(inst.fruitSlots).toBe(3);
    fx.activate(inst);
    expect(toast.mock.calls[0]![0]).toBe("Green apple tree");
    const slot = inst.slots.find((sl) => sl.mesh)!;
    const ref = { mesh: slot.mesh!, kind: "greenapple" as const };
    fx.tapFruitRef(ref);
    expect(toast.mock.calls[toast.mock.calls.length - 1]![0]).toBe("Green apple");
  });
});

describe("the pumpkin patch", () => {
  it("grows three pumpkins at its own places on the ground, and a tap on a pumpkin says 'Orange pumpkin'", () => {
    const toast = vi.fn();
    const world = new THREE.Group();
    const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 400 }) } as unknown as HTMLElement;
    const fx = createPropFx({ root: () => world, camera: () => new THREE.PerspectiveCamera(36, 2, 0.1, 200), canvas, toast, boostWindmill: () => {}, reduced: () => false, canSpeak: () => false });
    const patch = buildPumpkinPatch(35.4, -1.4);
    world.add(patch);
    const inst = fx.register("pumpkins", [patch])!;
    expect(inst.fruit).toBe("pumpkin");
    expect(inst.slots).toHaveLength(3);
    inst.slots.forEach((sl, i) => { expect(sl.mesh, `slot ${i}`).not.toBeNull(); expect(sl.local.toArray()).toEqual([...PUMPKIN_SLOTS[i]!]); });
    expect(PUMPKIN_SLOTS.every((p) => p[1] > 0.2 && p[1] < 0.4)).toBe(true);                       // resting on the ground: a squat pumpkin's centre
    fx.tapFruitRef({ mesh: inst.slots[0]!.mesh!, kind: "pumpkin" });
    expect(toast.mock.calls[0]![0]).toBe("Orange pumpkin");
    fx.activate(inst);
    expect(toast.mock.calls[toast.mock.calls.length - 1]![0]).toBe("Orange pumpkin");              // the patch is a pumpkin too
  });
  it("never turns up in a row of bushes (it grows in no world), and a bush prop cannot take its kind by accident", () => {
    expect(kindsFor("garden").some((k) => k.id === "pumpkin")).toBe(false);
    expect(kindFits("pumpkins", kindById("pumpkin")!)).toBe(true);
  });
  it("a toy groans at a pumpkin: too big to eat, never counts towards being full, and the next apple is eaten as usual", () => {
    let t = 0;
    const a = createAppetite(() => t);
    for (const eater of ["character", "robot", "vehicle"] as const) {
      const v = a.offer("pumpkin", eater);
      expect(v, eater).toEqual({ fed: false, reaction: "heavy", full: false });
    }
    for (let i = 0; i < 5; i++) { t += 1; a.offer("pumpkin", "character"); }
    expect(a.isFull).toBe(false);
    expect(a.offer("apple", "character")).toMatchObject({ fed: true, reaction: "eat", full: false });
  });
});

describe("the props stand behind the lane, so Kip steps back into the scene for them", () => {
  it("stepZ: where it began, then eased in over STEP_S, held, and eased back out for the last STEP_S (never past either end)", () => {
    const f = (t: number) => stepZ(t, 3, -1.2, -2.5);
    expect(f(0)).toBe(-1.2);
    expect(f(-1)).toBe(-1.2);
    expect(f(STEP_S)).toBeCloseTo(-2.5, 9);
    expect(f(1.5)).toBe(-2.5);
    expect(f(3 - STEP_S)).toBeCloseTo(-2.5, 9);
    expect(f(3)).toBeCloseTo(-1.2, 9);
    expect(f(99)).toBeCloseTo(-1.2, 9);
    for (let t = 0; t <= 3; t += 0.02) { const z = f(t); expect(z).toBeLessThanOrEqual(-1.2 + 1e-9); expect(z).toBeGreaterThanOrEqual(-2.5 - 1e-9); }
    expect(f(STEP_S / 2)).toBeLessThan(-1.2);                                            // already on its way
    expect(f(STEP_S / 2)).toBeGreaterThan(-2.5);
  });
  const props = () => ({
    tire: instOf("tire", 11, -2.8), bed: instOf("flowerbed", 10, -2.8, buildFlowerBed(10, -2.8)), bunny: instOf("bunny", 18.3, -2.8),
    picnic: instOf("picnic", 24.5, -2.8, buildPicnic(24.5, -2.8)), pad: instOf("angelpatch", 33.4, -2.8, buildAngelPatch(33.4, -2.8)),
  });
  const zWhile = (f: ReturnType<typeof fake>, v: NonNullable<ReturnType<ReturnType<typeof fake>["things"]["visitFor"]>>, t: number) => { v.tick!(t); return f.pos.z; };
  it("a hand job (the can, the carrot, the push) is done in front of the prop; sitting and lying are done ON it", () => {
    const cases: Array<[string, "roll" | "angel" | "water" | "feed" | "picnic", number]> = [
      ["tire", "roll", -2.6], ["bed", "water", -2.8 + FRONT_OF_PROP], ["bunny", "feed", -2.8 + FRONT_OF_PROP], ["picnic", "picnic", -2.8], ["pad", "angel", -2.8],
    ];
    for (const [name, kind, want] of cases) {
      const f = fake();
      f.pos.z = -1.2;                                                                    // Kip has walked to the lane's edge
      const inst = (props() as unknown as Record<string, PropInst>)[name]!;
      const v = f.things.visitFor(kind, inst)!;
      v.begin();
      expect(zWhile(f, v, v.seconds / 2), name).toBeCloseTo(want, 6);
      expect(zWhile(f, v, 0.05), name).toBeLessThan(-1.2 + 1e-9);
      v.end(true);
      expect(f.pos.z, `${name} steps back out`).toBe(-1.2);
    }
  });
  it("a cut-short visit still puts Kip back where it began, and a prop absurdly far back is not walked into past DEEPEST_Z", () => {
    const f = fake();
    f.pos.z = -1.2;
    const v = f.things.visitFor("feed", instOf("bunny", 18.3, -9))!;
    v.begin();
    expect(zWhile(f, v, v.seconds / 2)).toBeCloseTo(DEEPEST_Z, 9);
    v.end(false);
    expect(f.pos.z).toBe(-1.2);
  });
  it("it keeps the visit's own places: the toy still walks to the lane's edge first, and the swing (which carries Kip itself) is not wrapped", () => {
    const f = fake();
    expect(f.things.visitFor("feed", instOf("bunny", 18.3, -2.8))!.standZ).toBe(-1.2);
    const s = buildSwing(29.9, -2.8);
    const v = f.things.visitFor("ride", instOf("swing", 29.9, -2.8, s))!;
    f.pos.z = -1.2;
    v.begin();
    v.tick!(0.01);
    expect(f.pos.z).toBeCloseTo(-1.2, 1);                                                // the ride's own path (still at the stand point this early), not a depth step
  });
});

describe("the lane is clear: props are set back when the world is built", () => {
  const world = readFileSync(new URL("../src/features/game/world/runtime/world.ts", import.meta.url), "utf8");
  it("every prop's depth goes through clearLane, which pushes anything nearer than CLEAR_Z back to it and leaves the rest alone", () => {
    expect(world).toContain("const CLEAR_Z=-2.8;");
    expect(world).toContain("function clearLane(z: number){return z>CLEAR_Z?CLEAR_Z:z}");
    expect(world).toContain("f(p[1],clearLane(p[2]),p[3]);");
  });
  it("CLEAR_Z is behind the walkable lane (clampPathZ is +-1.2) with room for a prop's own depth", () => {
    expect(world).toContain("function clampPathZ(z: number){return Math.max(-1.2,Math.min(1.2,z))}");
    expect(-2.8).toBeLessThan(-PATH_Z - 1);
  });
});

describe("the swing hangs where it swings (Dan, 2026-11-04: \"swing is not aligned with the actual swing\")", () => {
  /** The rules, as a function of how the swing is built, so a broken one can be run through them. Returns what is wrong. */
  function failures(make: (x: number, z: number) => THREE.Group): string[] {
    const bad = new Set<string>();
    const at = { x: 30, z: -1.2 };
    const seatOf = (g: THREE.Group) => (g.userData.pivot as THREE.Object3D).children.filter((c) => (c as THREE.Mesh).isMesh).map((m) => new THREE.Box3().setFromObject(m)).sort((a, b) => (b.max.z - b.min.z) - (a.max.z - a.min.z))[0]!;
    // 1. the seat is where the ride says it is, for every angle: in the plane the swing moves in (x, y), at the arc's point
    for (const a of [0, 0.2, 0.62, -0.2, -0.62]) {
      const g = make(at.x, at.z);
      g.userData.setAngle(a);
      g.updateMatrixWorld(true);
      const seat = seatOf(g);
      const cx = (seat.min.x + seat.max.x) / 2;
      // a rotated box's bounding box is wider than the box: the seat's centre line is the middle of its box, exact for the centre
      const want = seatPoint(a);
      if (Math.abs(cx - (at.x + want.dx + SEAT_THICK / 2 * Math.sin(a))) > 0.05) bad.add("the seat swings to the side the ride (and Kip) go to");
      if (Math.abs(((seat.min.z + seat.max.z) / 2) - at.z) > 1e-6) bad.add("it swings in a plane: the seat stays at the swing's depth");
    }
    // 2. it hangs from a bar along z, the ropes are side by side in depth, and the seat is long across the swing's path
    const g0 = make(at.x, at.z); g0.updateMatrixWorld(true);
    const meshes: Array<{ b: THREE.Box3; size: THREE.Vector3 }> = [];
    g0.traverse((o) => { if ((o as THREE.Mesh).isMesh) { const b = new THREE.Box3().setFromObject(o); meshes.push({ b, size: b.getSize(new THREE.Vector3()) }); } });
    const bar = meshes.filter((m) => m.size.z > 2 && m.size.y < 0.4 && m.size.x < 0.4);
    if (bar.length !== 1) bad.add("one bar, along z (into the scene), at the top");
    const ropes = meshes.filter((m) => m.size.y > SWING_ROPE * 0.9 && m.size.x < 0.1 && m.size.z < 0.1);
    if (ropes.length !== 2 || Math.abs(ropes[0]!.b.min.x - ropes[1]!.b.min.x) > 1e-6 || Math.abs(ropes[0]!.b.min.z - ropes[1]!.b.min.z) < 0.5) bad.add("two ropes, side by side in depth, one behind the other along the path");
    const seat0 = seatOf(g0), seatSize = seat0.getSize(new THREE.Vector3());
    if (!(seatSize.z > seatSize.x * 1.5)) bad.add("the seat is long in depth and short along the path, so Kip sits facing along it");
    return [...bad];
  }
  it("the seat is where the ride says it is at every angle, the bar and ropes run into the scene, and the seat is long in depth", () => {
    expect(failures(buildSwing)).toEqual([]);
  });
  it("is caught when the swing turns the wrong way, or hangs from a bar along the path (the old one)", () => {
    const flipped = (x: number, z: number) => { const g = buildSwing(x, z); const orig = g.userData.setAngle as (a: number) => void; g.userData.setAngle = (a: number) => orig(-a); return g; };   // the old sign
    const quarterTurn = (x: number, z: number) => { const g = buildSwing(x, z); const inner = new THREE.Group(); while (g.children.length) inner.add(g.children[0]!); inner.rotation.y = Math.PI / 2; g.add(inner); return g; };           // a bar along x
    expect(failures(flipped).length).toBeGreaterThan(0);
    expect(failures(quarterTurn).length).toBeGreaterThan(0);
  });
  it("Kip sits on the seat and rolls with it: his origin hangs below the seat along the ropes' own down, and his roll is the ropes' angle, whatever the angle", () => {
    const stand = { x: 28.6, z: -1.2 }, swing = { x: 29.9, z: -2.0 };
    for (const a of [0.5, -0.5, 0.62, -0.3]) {
      const p = ridePath(HOP_S + 1, stand, swing, () => a);
      expect(p.angle).toBe(a);                                                                        // the roll is the ropes' angle
      const g = buildSwing(swing.x, swing.z); g.userData.setAngle(a); g.updateMatrixWorld(true);
      const seat = (g.userData.pivot as THREE.Object3D).children.find((c) => (c as THREE.Mesh).isMesh && c.position.y < -SWING_ROPE)!;
      const top = new THREE.Vector3(0, SEAT_THICK / 2, 0); seat.localToWorld(top);                     // the middle of the seat's top, where the prop really is
      const down = new THREE.Vector3(Math.sin(a), -Math.cos(a), 0).multiplyScalar(SIT_DROP);          // Kip's origin, SIT_DROP below it along the tilted down
      expect(p.x).toBeCloseTo(top.x + down.x, 6);
      expect(p.y).toBeCloseTo(top.y + down.y, 6);
    }
  });
  it("the legs pump with the swing: out at the forward end of each swing, tucked at the back end (one pump per swing, not two)", () => {
    const total = RIDE_S - 2 * HOP_S;
    const angle = (t: number) => swingAngle(t - HOP_S, total);        // ride time t
    const c = PLAY_CLIPS.swing!;
    // the legs pump with the KNEES: the thighs stay forward, and the shins fold back and down at the back end (a bend of 1.4) and are straight (0.1) at the forward end; `legZ` reads that as how straight the leg is
    const legZ = (t: number) => 1 - (c.bends!.kneeL[Math.round(Math.min(c.duration, Math.max(0, t)) / c.duration * (c.frames - 1))]! / 1.4) * 0.6;
    const peaks: number[] = [], troughs: number[] = [];
    for (let t = HOP_S + 0.3; t < RIDE_S - HOP_S - 0.2; t += 0.01) {
      const a = angle(t), l = angle(t - 0.01), r = angle(t + 0.01);
      if (a > l && a >= r && a > 0.15) peaks.push(t);
      if (a < l && a <= r && a < -0.15) troughs.push(t);
    }
    expect(peaks.length).toBeGreaterThanOrEqual(2);
    expect(troughs.length).toBeGreaterThanOrEqual(2);
    for (const t of peaks) expect(legZ(t), `legs out at the forward end, t=${t.toFixed(2)}`).toBeGreaterThan(0.85);
    for (const t of troughs) expect(legZ(t), `legs tucked at the back end, t=${t.toFixed(2)}`).toBeLessThan(0.75);
    // one pump per swing: the legs change from out to tucked no more than once between a peak and the next trough
    let flips = 0, prev = legZ(HOP_S + 0.9) > 0.8;
    for (let t = HOP_S + 0.9; t < RIDE_S - HOP_S - 0.3; t += 0.02) { const now = legZ(t) > 0.8; if (now !== prev) flips++; prev = now; }
    expect(flips).toBeLessThanOrEqual(peaks.length + troughs.length);
  });
});
