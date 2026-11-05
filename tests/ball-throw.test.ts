// The ball throw (Dan, 2026-11-04: Mixamo "pickup and Throw Object"): Kip walks to the small ball in the Toy Room, bends, picks it up, straightens, winds up and throws it overarm, and the dog fetches it
// (src/features/game/world/runtime/playthings.ts `throwVisit`, smallBall.ts, ballKick.ts, propReactions.ts `kickBall`). The big ball is nearly as wide as Kip's chest, so it stays a kicked ball; this is a
// hand-sized one. The rules are functions of the visit so each can be run on a version that is wrong on purpose and must fail.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { BALL_BOUNDS, BALL_R, SMALL_BALL_R, ballRadius, kick, stepBall } from "../src/features/game/world/runtime/ballKick";
import { THROW_PICK_S, THROW_RELEASE_S, THROW_ROOM, THROW_S, THROW_STAND, THROW_VX, THROW_VY, createPlaythings, stepZ } from "../src/features/game/world/runtime/playthings";
import { PROP_SPECS, createPropFx } from "../src/features/game/world/runtime/propReactions";
import { buildSmallBall, buildSmallBallMesh } from "../src/features/game/world/runtime/smallBall";
import { HELD } from "../src/features/game/world/runtime/heldItems";
import { ACT_FOR_PROP, type ActsWorld } from "../src/features/game/world/runtime/toyRoomActs";
import { ACTION_FILES } from "../src/features/game/world/runtime/gameActions";
import { jointClipToGame, parseJointClip } from "../src/features/game/world/runtime/bakedDance";
import type { PropInst } from "../src/features/game/world/runtime/propReactions";
import type { Visit } from "../src/features/game/world/runtime/visitRoutine";

const root = join(__dirname, "..");
const HAVE_BAKED = existsSync(join(root, "public/kip/mixamo/baked/index.json"));
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const clipFile = HAVE_BAKED ? JSON.parse(read("public/kip/mixamo/baked/act_pickthrow.json")) : null;

// ---- the ball's physics -------------------------------------------------------------------------------------------------------

describe("a ball that starts in the air", () => {
  it("is set off from the height of a hand (a kick starts on the floor), and a height that is not a height is the floor", () => {
    expect(kick(5, 3, 1.4).h).toBe(0);
    expect(kick(5, 3, 1.4, 2).h).toBe(2);
    for (const bad of [-1, NaN, Infinity * 0, -0.3]) expect(kick(5, 3, 1.4, bad).h, String(bad)).toBe(0);
  });
  it("falls from there, bounces, rolls and comes to rest on the floor, further along, within the floor's limits", () => {
    let s = kick(30, THROW_VX, THROW_VY, 2);
    let peak = s.h, bounced = false, prev = s.h;
    for (let i = 0; i < 60 * 12 && !s.resting; i++) {
      s = stepBall(s, 1 / 60, BALL_BOUNDS[0], BALL_BOUNDS[1], SMALL_BALL_R);
      if (s.h > prev + 1e-9 && s.t > 0.3) bounced = true;
      prev = s.h; peak = Math.max(peak, s.h);
    }
    expect(bounced).toBe(true);
    expect(s.resting).toBe(true);
    expect(s.h).toBe(0);
    expect(s.x).toBeGreaterThan(33);
    expect(s.x).toBeLessThanOrEqual(BALL_BOUNDS[1]);
    expect(peak).toBeGreaterThanOrEqual(2);                    // never higher than it started plus the little it was thrown up
  });
  it("turns as it rolls by the distance over ITS radius: the small ball turns more than the big one for the same roll", () => {
    const roll = (r: number) => { let s = { x: 10, h: 0, vx: 2, vy: 0, spin: 0, t: 0, resting: false }; for (let i = 0; i < 30; i++) s = stepBall(s, 1 / 60, 0, 40, r); return { dx: s.x - 10, spin: Math.abs(s.spin) }; };
    const big = roll(BALL_R), small = roll(SMALL_BALL_R);
    expect(big.spin).toBeCloseTo(big.dx / BALL_R, 6);
    expect(small.spin).toBeCloseTo(small.dx / SMALL_BALL_R, 6);
    expect(small.spin / small.dx).toBeCloseTo(BALL_R / SMALL_BALL_R * (big.spin / big.dx), 4);
    expect(ballRadius("smallball")).toBe(SMALL_BALL_R);
    expect(ballRadius("ball")).toBe(BALL_R);
    expect(ballRadius("anything else")).toBe(BALL_R);
  });
});

// ---- the prop ---------------------------------------------------------------------------------------------------------------------

function propFx() {
  const world = new THREE.Group();
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 400 }) } as unknown as HTMLElement;
  const fx = createPropFx({ root: () => world, camera: () => new THREE.PerspectiveCamera(36, 2, 0.1, 200), canvas, toast: () => {}, boostWindmill: () => {}, reduced: () => false, canSpeak: () => false });
  return { fx, world };
}

describe("the small ball as a prop", () => {
  it("is a red ball by name (no new word to say in six languages), rests on the floor and is small enough for a hand", () => {
    expect(PROP_SPECS.smallball.noun).toBe("ball");
    expect(PROP_SPECS.smallball.color).toBe("red");
    const g = buildSmallBall(30, -2);
    g.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(g);
    expect(box.min.y).toBeCloseTo(0, 2);
    expect(box.max.y - box.min.y).toBeCloseTo(2 * SMALL_BALL_R, 1);
    expect(box.max.x - box.min.x).toBeLessThan(BALL_R);        // a hand's width, not a chest's
  });
  it("in the real prop effects it can be thrown from a hand: it starts where the hand is and that high, falls, rolls and stops; a lamp cannot be thrown", () => {
    const { fx, world } = propFx();
    const ball = buildSmallBall(30, -2);
    world.add(ball);
    const inst = fx.register("smallball", [ball])!;
    expect(inst).toBeTruthy();
    expect(inst.pivot).not.toBeNull();
    expect(inst.pivot!.position.y).toBeCloseTo(SMALL_BALL_R, 6);                  // it turns about its own middle, which is its radius up
    expect(fx.kickBall(inst, THROW_VX, THROW_VY, { x: 31.2, h: 1.9 })).toBe(true);
    expect(inst.base.px).toBe(31.2);
    expect(inst.kick!.h).toBeCloseTo(1.9, 6);
    let maxX = inst.base.px;
    for (let i = 0; i < 60 * 12 && inst.kick; i++) { fx.update(1 / 60, i / 60); maxX = Math.max(maxX, inst.base.px); }
    expect(inst.kick).toBeNull();
    expect(inst.base.px).toBeGreaterThan(33);
    const lamp = fx.register("lamp", [new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))])!;
    expect(fx.kickBall(lamp, 3, 1)).toBe(false);
  });
  it("a kick still starts on the floor (no `from`)", () => {
    const { fx, world } = propFx();
    const ball = buildSmallBall(30, -2);
    world.add(ball);
    const inst = fx.register("smallball", [ball])!;
    fx.kickBall(inst, 3, 2);
    expect(inst.kick!.h).toBe(0);
    expect(inst.base.px).toBe(30);
  });
  it("the held one is the same toy at the small size: centred on its own middle, a ball's radius across, in the right fist", () => {
    expect(HELD.smallball.parent).toBe("armR");
    const m = buildSmallBallMesh();
    m.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(m);
    const c = box.getCenter(new THREE.Vector3());
    expect(c.length()).toBeLessThan(0.02);
    expect((box.max.x - box.min.x) / 2).toBeCloseTo(SMALL_BALL_R, 1);
  });
});

// ---- the visit ----------------------------------------------------------------------------------------------------------------------

type Mod = (v: Visit) => Visit;
interface Scenario { log: string[]; kicks: Array<{ vx: number; vy: number; from?: { x: number; h: number } }>; follow: number[]; visible: boolean; holding: boolean; zs: number[]; fetches: number; heldReads: number }
const FIST = { x: 31.4, y: 2.2 };

function scenario(opts: { x?: number; dog?: boolean; withHand?: boolean; mod?: Mod; cutAt?: number } = {}): Scenario & { visit: Visit } {
  const log: string[] = [];
  const kicks: Scenario["kicks"] = [];
  const follow: number[] = [];
  const zs: number[] = [];
  const st = { visible: true, holding: false, fetches: 0, heldReads: 0 };
  const pos = { x: 0, y: 0, z: 0.4 };
  const w = {
    root: () => new THREE.Group(), eater: () => "character", allowed: () => true,
    position: () => ({ ...pos }), targetX: () => null, walkTo: () => {}, stopWalk: () => {}, face: () => {},
    clip: (a: string) => { log.push(`clip:${a}`); return true; },
    hold: (i: string) => { log.push(`hold:${i}`); st.holding = true; },
    release: () => { log.push("release"); st.holding = false; },
    heldAt: opts.withHand === false ? undefined : () => { st.heldReads++; log.push("heldAt"); return st.holding ? { ...FIST } : null; },
    mouth: () => ({ x: 0, y: 0, z: 0 }), bubbles: { blow: () => {} },
    setPosition: (x: number, y: number, z: number) => { pos.x = x; pos.y = y; pos.z = z; zs.push(z); },
    tone: () => {}, phase: () => {},
    fetch: opts.dog === false ? undefined : () => { st.fetches++; log.push("fetch"); return true; },
    fx: {
      squish: () => {}, strike: () => null, flutter: () => {}, say: () => {}, cue: () => {}, nearby: () => [],
      setVisible: (_i: unknown, v: boolean) => { st.visible = v; log.push(`visible:${v}`); },
      kickBall: (_i: unknown, vx: number, vy: number, from?: { x: number; h: number }) => { kicks.push({ vx, vy, from }); log.push("kick"); return true; },
    },
  } as unknown as ActsWorld;
  const things = createPlaythings(w, { heart: () => {}, note: () => {}, flake: () => {}, follow: (_i: unknown, d: number) => follow.push(d) });
  const holder = new THREE.Group();
  const x = opts.x ?? 29.6;
  const inst = { type: "smallball", base: { px: x, py: 0, pz: -2.8 }, size: new THREE.Vector3(0.5, 0.5, 0.5), kick: null, holder } as unknown as PropInst;
  let v = things.visitFor("throw", inst)!;
  if (opts.mod) v = opts.mod(v);
  const end = opts.cutAt === undefined ? v.seconds : opts.cutAt;
  v.begin();
  const cues = v.cues ?? [];
  let cue = 0;
  for (let t = 0; t <= end + 1e-9; t += 1 / 60) {
    v.tick?.(t);
    while (cue < cues.length && cues[cue]!.at <= t) { cues[cue]!.fn(); cue++; }
  }
  v.end(opts.cutAt === undefined);
  return { log, kicks, follow, visible: st.visible, holding: st.holding, zs, fetches: st.fetches, heldReads: st.heldReads, visit: v };
}

/** The rules of a whole throw, as a function of a modified visit. Returns what is wrong. */
function failures(mod?: Mod): string[] {
  const bad = new Set<string>();
  const r = scenario({ mod });
  const i = (s: string) => r.log.indexOf(s);
  const last = (s: string) => r.log.lastIndexOf(s);
  if (r.log[0] !== "clip:throw") bad.add("the throw clip starts the visit");
  if (!(i("visible:false") >= 0 && i("hold:smallball") > i("visible:false"))) bad.add("the ball is hidden and then in his hand");
  if (!(i("kick") > i("hold:smallball"))) bad.add("it is thrown after it is picked up");
  if (!(last("release") < i("kick") && last("release") > i("hold:smallball"))) bad.add("he lets go of it, then it flies");
  if (!(r.log.indexOf("visible:true") > i("hold:smallball") && r.log.indexOf("visible:true") < i("kick"))) bad.add("the thrown ball is shown again just before it flies");
  const k = r.kicks[0];
  if (r.kicks.length !== 1) bad.add("thrown once");
  if (k) {
    if (k.vx !== THROW_VX || k.vy !== THROW_VY) bad.add("the throw's speed");
    if (!k.from || Math.abs(k.from.x - FIST.x) > 1e-9 || Math.abs(k.from.h - (FIST.y - SMALL_BALL_R)) > 1e-9) bad.add("it leaves from where the hand is, and from that high");
  }
  if (r.fetches !== 1 || i("fetch") < i("kick")) bad.add("the dog is sent once, after the ball is thrown");
  if (!r.visible) bad.add("the ball is there at the end");
  if (r.holding) bad.add("nothing is in his hand at the end");
  if (r.follow.length !== 0) bad.add("with a dog, Kip does not trot after it himself");
  return [...bad];
}

describe.skipIf(!HAVE_BAKED)("the throw visit", () => {
  const v = scenario().visit;
  it("stands Kip a hand's reach from the ball so his fist is on it at the bottom of the bend, facing the way it will go, and lasts as long as the clip", () => {
    expect(v.standX).toBeCloseTo(29.6 - THROW_STAND, 9);
    expect(v.face).toBe(1);
    expect(v.seconds).toBe(THROW_S);
    expect(Math.abs(THROW_S - clipFile.dur)).toBeLessThan(0.05);              // the visit ends when the baked clip does
    expect(ACTION_FILES.throw).toBe("act_pickthrow");
  });
  it("picks the ball up while he is bent over it and lets go of it at the top of the throw, both inside the clip and in that order", () => {
    expect(v.cues!.map((c) => c.at)).toEqual([THROW_PICK_S, THROW_RELEASE_S]);
    expect(THROW_PICK_S).toBeLessThan(THROW_RELEASE_S);
    expect(THROW_RELEASE_S).toBeLessThan(THROW_S - 0.5);                       // and the throw has time to follow through
  });
  it("the cues are tied to what the clip does: the right arm points down at the floor when he picks it up and is up over his shoulder when he lets go", () => {
    const c = jointClipToGame(parseJointClip(clipFile)!, "throw", { joints: true });
    const armR = (t: number) => { const f = Math.round(t / c.duration * (c.frames - 1)); return { x: c.armR[f * 3]!, y: c.armR[f * 3 + 1]!, z: c.armR[f * 3 + 2]! }; };
    expect(armR(THROW_PICK_S).y).toBeLessThan(-0.55);                          // reaching down
    expect(armR(THROW_RELEASE_S).y).toBeGreaterThan(0.2);                      // up and over
    expect(armR(THROW_RELEASE_S).z).toBeGreaterThan(0.3);                      // and forward
    expect(armR(THROW_PICK_S - 0.8).y).toBeGreaterThan(armR(THROW_PICK_S).y - 1e-9 - 1);   // (it was not already down for the whole of the first second: the bend takes time)
  });
  it("plays out in order: the clip, the ball out of sight and into his hand, then out of his hand and away from the hand's own height, and the dog sent after it", () => {
    expect(failures()).toEqual([]);
  });
  it("is caught when it throws before it picks up, has no clip, never picks the ball up, or never throws it", () => {
    const edit = (f: (cues: Array<{ at: number; fn: () => void }>, v: Visit) => void): Mod => (v) => { const cues = (v.cues ?? []).map((c) => ({ ...c })); f(cues, v); return { ...v, cues }; };
    expect(failures(edit((cues) => { const f = cues[1]!.fn; cues[1]!.fn = () => { f(); }; cues.reverse(); })).length).toBeGreaterThan(0);   // the throw before the pick-up
    expect(failures((v) => ({ ...v, begin: () => {} })).length).toBeGreaterThan(0);                                              // no clip
    expect(failures(edit((cues) => { cues.splice(0, 1); })).length).toBeGreaterThan(0);                                          // never picks it up
    expect(failures(edit((cues) => { cues.splice(1, 1); })).length).toBeGreaterThan(0);                                          // never throws
  });
  it("lets go of the ball from where the hand is, and falls back to a throw from head height when the world cannot say where the hand is", () => {
    const k = scenario().kicks[0]!;
    expect(k.from).toEqual({ x: FIST.x, h: FIST.y - SMALL_BALL_R });
    const blind = scenario({ withHand: false });
    expect(blind.kicks[0]!.from!.h).toBeGreaterThan(1.5);
    expect(blind.kicks[0]!.from!.x).toBeCloseTo(29.6 - THROW_STAND + 0.9, 9);
  });
  it("without a dog Kip trots after the ball himself, as he does after a kick", () => {
    const r = scenario({ dog: false });
    expect(r.fetches).toBe(0);
    expect(r.follow).toEqual([1]);
  });
  it("cut short before he picks it up (a tap, a walk): the ball is where it was and visible, nothing is held, nothing thrown", () => {
    const r = scenario({ cutAt: THROW_PICK_S - 0.3 });
    expect(r.visible).toBe(true);
    expect(r.holding).toBe(false);
    expect(r.kicks).toEqual([]);
    expect(r.follow).toEqual([]);
  });
  it("cut short with the ball in his hand: it is put back (let go of, shown again where it lay), nothing thrown, and Kip does not go after a ball that was never thrown", () => {
    const r = scenario({ cutAt: (THROW_PICK_S + THROW_RELEASE_S) / 2 });
    expect(r.visible).toBe(true);
    expect(r.holding).toBe(false);
    expect(r.log).toContain("release");
    expect(r.kicks).toEqual([]);
    expect(r.follow).toEqual([]);
    expect(r.fetches).toBe(0);
  });
  it("throws to the right, where the room is, unless the wall is too close, and always stands inside the floor's limits", () => {
    for (const x of [2.1, 15, 29.6, 40, 42.5]) {
      const r = scenario({ x });
      const stand = r.visit.standX;
      expect(stand, `x=${x}`).toBeGreaterThanOrEqual(BALL_BOUNDS[0]);
      expect(stand, `x=${x}`).toBeLessThanOrEqual(BALL_BOUNDS[1]);
      expect(r.kicks[0]!.vx, `x=${x}`).toBe((r.visit.face as number) * THROW_VX);
    }
    expect(scenario({ x: 15 }).visit.face).toBe(1);
    expect(scenario({ x: 43 - THROW_ROOM + 1 }).visit.face).toBe(-1);          // too near the right wall for a throw to the right
  });
  it("is done at the ball's own depth: Kip steps into the scene for it and back out to where he was, even when cut short", () => {
    const r = scenario();
    expect(Math.min(...r.zs)).toBeCloseTo(-2.8, 6);                           // there at the middle of it
    expect(r.zs[0]).toBeGreaterThan(0.3 - 0.4);                               // it begins where he was (z 0.4)
    expect(r.zs[r.zs.length - 1]).toBeCloseTo(0.4, 6);                        // and ends there again
    expect(stepZ(THROW_S / 2, THROW_S, 0.4, -2.8)).toBeCloseTo(-2.8, 6);
    const cut = scenario({ cutAt: 1.0 });
    expect(cut.zs[cut.zs.length - 1]).toBeCloseTo(0.4, 6);
  });
});

// ---- the places it plugs into -------------------------------------------------------------------------------------------------------

describe.skipIf(!HAVE_BAKED)("what plugs the throw into the game", () => {
  it("a tap on the small ball starts the throw; the Toy Room has one, near the teddy and clear of the toy box; the catalog names it", () => {
    expect(ACT_FOR_PROP.smallball).toBe("throw");
    const cat = read("src/features/game/world/runtime/catalog.ts");
    expect(cat).toContain('smallball:{z:-2,n:"Small ball"}');
    expect(cat).toContain('{"type":"teddy","x":26},{"type":"smallball","x":29.6},{"type":"toybox","x":32.6,"z":-2},');
  });
  it("the world builds it, holds it in the fist, says where the held thing is, and plays the throw clip by name", () => {
    const w = read("src/features/game/world/runtime/world.ts");
    expect(w).toContain("smallball:function(x,z){return add(buildSmallBall(x,z))},");
    expect(w).toContain('import { buildSmallBall } from "./smallBall";');
    expect(w).toContain('|"sit_eat"|"swing"|"throw"){return mixGo(a as MixAction,');
    expect(w).toContain("heldAt:function(){var m=HELD.mesh;if(!m)return null;var v=new T.Vector3();m.updateWorldMatrix(true,false);m.getWorldPosition(v);return{x:v.x,y:v.y}},");
  });
  it("the throw clip is baked, listed in the index and loaded through the same checked loader as the kick, sad and sneak", () => {
    const index = JSON.parse(read("public/kip/mixamo/baked/index.json")).clips as Array<{ id: string; dur: number; group: string }>;
    const entry = index.find((c) => c.id === "act_pickthrow")!;
    expect(entry.group).toBe("act");
    expect(entry.dur).toBeCloseTo(clipFile.dur, 3);
    expect(read("src/features/game/world/runtime/idleBehavior.ts")).toContain('act_pickthrow: "act"');
    expect(read("scripts/mixamo-clips.json")).toContain('"id": "act_pickthrow"');
  });
});
