import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { ALL_CLEAN, CLEAN_BUTTON, CLEAN_Q, MESS_PROMPT_LINES, OH_NO } from "../src/features/game/world/runtime/messLines";
import { createMess, type MessWorld } from "../src/features/game/world/runtime/mess";
import {
  BOX_STAND, BOX_STAND_Z, BOX_TILT, CUP_LIE, DUMP_PROMPT_AT_S, DUMP_TIP_AT_S, IN_BOX, IN_PILE, MOP_END_S, MOP_STAND, MOP_STROKES, PILE_TOYS, PUDDLE_DX, PUDDLE_DZ, SPILL_PROMPT_AT_S, SPILL_STAND,
  SPILL_STAND_Z, SPILL_TIP_AT_S, TIDY_START_S, TUMBLE_DONE_S, homeAt, strokeEndsAt,
} from "../src/features/game/world/runtime/messModel";
import { buildCupTable, buildToyBox } from "../src/features/game/world/runtime/messScene";
import type { PropInst } from "../src/features/game/world/runtime/propReactions";
import { createActs } from "../src/features/game/world/runtime/toyRoomActs";
import { SCENE_PROMPTS, promptIdForText } from "../src/lib/scenePrompts";

// ---- a minimal DOM: enough for the Clean card ------------------------------------------------------------------------------------
class FakeEl {
  tag: string; children: FakeEl[] = []; attrs: Record<string, string> = {}; style: { cssText: string; display?: string } = { cssText: "" };
  hidden = false; textContent = ""; type = ""; parent: FakeEl | null = null; listeners: Record<string, Array<() => void>> = {};
  constructor(tag: string) { this.tag = tag; }
  get isConnected(): boolean { return this.parent !== null; }
  get ownerDocument() { return { createElement: (t: string) => new FakeEl(t) }; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  append(...kids: FakeEl[]) { for (const k of kids) { k.parent = this; this.children.push(k); } }
  appendChild(k: FakeEl) { this.append(k); return k; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; }
  addEventListener(t: string, fn: () => void) { (this.listeners[t] ??= []).push(fn); }
  click() { for (const f of this.listeners.click ?? []) f(); }
  find(tag: string): FakeEl | undefined { return this.children.find((c) => c.tag === tag); }
}

// ---- the world: the real Toy Room acts and the real mess, with a fake toy and fake sounds -------------------------------------------
function instOf(type: string, holder: THREE.Group): PropInst {
  return { type, holder, base: { px: holder.position.x, pz: holder.position.z }, size: new THREE.Vector3(1.6, 1.2, 1.6) } as unknown as PropInst;
}
function game(opts: { reduced?: boolean; eater?: "character" | "robot" | "vehicle"; host?: boolean; start?: { x: number; y: number; z: number } } = {}) {
  const root = new THREE.Group();
  const stage = new FakeEl("div");
  const log: string[] = [], toasts: string[] = [], says: string[] = [], tones: number[] = [];
  const s = { pos: { ...(opts.start ?? { x: 5, y: 0, z: 0.4 }) }, target: null as { x: number; z: number } | null, reduced: opts.reduced ?? false, canRun: true };
  let mess: ReturnType<typeof createMess>;
  const acts = createActs({
    position: () => ({ ...s.pos }), targetX: () => (s.target ? s.target.x : null),
    walkTo: (x: number, z: number) => { s.target = { x, z }; log.push(`walkTo:${+x.toFixed(2)},${+z.toFixed(2)}`); },
    stopWalk: () => { s.target = null; log.push("stopWalk"); },
    face: (d: 1 | -1) => log.push(`face:${d}`),
    root: () => root, eater: () => opts.eater ?? "character", allowed: () => s.canRun,
    clip: (a: string) => { log.push(`clip:${a}`); return true; }, setPosition: () => {}, tone: () => {}, phase: () => {},
    hold: () => {}, release: () => {}, mouth: () => ({ x: 0, y: 1.8, z: 0 }), bubbles: { blow: () => {} },
    fx: { squish: () => {}, strike: () => null, kickBall: () => false, flutter: () => {}, say: () => {}, setVisible: () => {}, cue: () => {}, nearby: () => [] },
    mess: { visitFor: (k: "spill" | "dump", i: PropInst) => mess.visitFor(k, i) },
  } as never);
  const world: MessWorld = {
    root: () => root, host: () => (opts.host === false ? null : (stage as unknown as HTMLElement)), reduced: () => s.reduced,
    say: (t) => { says.push(t); log.push(`say:${t}`); }, toast: (t) => { toasts.push(t); log.push(`toast:${t}`); },
    tone: (f) => { tones.push(f); }, clip: (a) => { log.push(`clip:${a}`); return true; },
    hold: (i) => log.push(`hold:${i}`), release: () => log.push("release"),
    run: (v) => acts.run(v),
  };
  mess = createMess(world);
  const step = (dt: number) => { acts.update(dt); mess.update(dt); };
  const run = (seconds: number, dt = 1 / 30) => { for (let t = 0; t < seconds - 1e-9; t += dt) step(dt); };
  /** Kip walks to where it was sent, instantly. */
  const arrive = () => { if (s.target) { s.pos.x = s.target.x; s.pos.z = s.target.z; s.target = null; } };
  const cupT = buildCupTable(29.5, -2), box = buildToyBox(13, -2);
  root.add(cupT, box);
  const cup = instOf("cup", cupT), toybox = instOf("toybox", box);
  const card = () => stage.find("div");
  const button = () => card()?.find("button");
  return { acts, mess, s, log, toasts, says, tones, root, run, step, arrive, cupT, box, cup, toybox, stage, card, button };
}
type G = ReturnType<typeof game>;
const cupRot = (g: G) => (g.cupT.userData.cup as THREE.Object3D).rotation.x;
const boxRot = (g: G) => (g.box.userData.boxPivot as THREE.Object3D).rotation.x;
const toyAt = (g: G, i: number) => (g.box.userData.toys as THREE.Object3D[])[i]!;
const near = (a: number, b: number, e = 1e-6) => Math.abs(a - b) < e;

/** Spill the cup all the way to the question. */
function spillToQuestion(g: G) {
  expect(g.acts.tap(g.cup)).toBe(true);
  g.arrive();
  g.run(SPILL_PROMPT_AT_S + 0.4);
}
function dumpToQuestion(g: G) {
  expect(g.acts.tap(g.toybox)).toBe(true);
  g.arrive();
  g.run(DUMP_PROMPT_AT_S + 0.4);
}

describe("the lines are in the closed list the voice reads from", () => {
  it("every line Kip says in a mess has a clip id in src/lib/scenePrompts.json, matched on its exact text", () => {
    for (const l of MESS_PROMPT_LINES) {
      expect(promptIdForText(l), l).not.toBeNull();
      expect(SCENE_PROMPTS.filter((p) => p.text === l)).toHaveLength(1);
    }
  });
});

describe("tapping the juice cup", () => {
  it("sends Kip to the left of the table, at the front of the lane, and nothing spills until Kip is there", () => {
    const g = game();
    expect(g.acts.tap(g.cup)).toBe(true);
    expect(g.log).toEqual([`walkTo:${+(29.5 - SPILL_STAND).toFixed(2)},${SPILL_STAND_Z}`]);
    g.run(2);                                                                  // Kip has not arrived (the fake toy only moves when told)
    expect(cupRot(g)).toBe(0);
    expect(g.mess.phase).toBe("idle");
    expect(g.mess.puddleSize).toBe(0);
    expect(g.log.some((l) => l.startsWith("clip:"))).toBe(false);
  });
  it("waits for Kip to be at the right DEPTH too, not only the right x", () => {
    const g = game();
    g.acts.tap(g.cup);
    g.s.pos.x = 29.5 - SPILL_STAND;                                            // right x, still at z 0.4
    g.run(0.5);
    expect(g.mess.phase).toBe("idle");
    g.s.pos.z = SPILL_STAND_Z;
    g.run(0.1);
    expect(g.mess.phase).toBe("making");
  });
  it("on arrival Kip faces the cup and reaches for it; the cup is upright until the tip cue", () => {
    const g = game();
    g.acts.tap(g.cup);
    g.arrive();
    g.run(SPILL_TIP_AT_S - 0.1);
    expect(g.log.slice(1, 3)).toEqual(["face:1", "clip:oops"]);
    expect(g.mess.phase).toBe("making");
    expect(cupRot(g)).toBe(0);
    expect(g.says).toEqual([]);
  });
  it("then the cup tips onto its side towards the camera, a puddle spreads in front of the table, and Kip says 'Oh no, oh no!' (voice and text) once", () => {
    const g = game();
    g.acts.tap(g.cup);
    g.arrive();
    g.run(SPILL_TIP_AT_S + 0.2);
    expect(cupRot(g)).toBeGreaterThan(0);
    g.run(2);
    expect(near(cupRot(g), CUP_LIE)).toBe(true);
    expect(near(g.mess.puddleSize, 1, 1e-3)).toBe(true);
    expect(g.says.filter((t) => t === OH_NO)).toHaveLength(1);
    expect(g.toasts.filter((t) => t === OH_NO)).toHaveLength(1);
    expect(g.cupT.userData.stream.visible).toBe(false);                        // the stream has run dry
    expect(g.cupT.userData.juice.visible).toBe(false);                         // and the cup is empty
  });
  it("puts the puddle in front of the table, in Kip's lane, where the mop can reach it", () => {
    const g = game();
    spillToQuestion(g);
    const p = g.root.children.find((c) => c !== g.cupT && c !== g.box)!;
    expect(near(p.position.x, 29.5 + PUDDLE_DX)).toBe(true);
    expect(near(p.position.z, -2 + PUDDLE_DZ)).toBe(true);
    expect(p.position.z).toBeGreaterThan(-1.2);
    expect(p.position.z).toBeLessThan(1.2);
  });
  it("asks 'Clean?' once the mess has settled: a card with a Clean button, the question said once, and the toy waiting", () => {
    const g = game();
    g.acts.tap(g.cup);
    g.arrive();
    g.run(SPILL_PROMPT_AT_S - 0.2);
    expect(g.mess.phase).toBe("making");
    expect(g.card()).toBeUndefined();
    g.run(0.4);
    expect(g.mess.phase).toBe("messy");
    expect(g.mess.promptVisible).toBe(true);
    expect(g.card()!.hidden).toBe(false);
    expect(g.card()!.attrs.role).toBe("group");
    expect(g.card()!.children.map((c) => c.textContent)).toEqual([CLEAN_Q, `\u{1F9FD} ${CLEAN_BUTTON}`]);
    expect(g.button()!.attrs["aria-label"]).toBe(CLEAN_BUTTON);
    expect(g.says.filter((t) => t === CLEAN_Q)).toHaveLength(1);
    g.run(5);
    expect(g.says.filter((t) => t === CLEAN_Q)).toHaveLength(1);              // it waits quietly: no nagging, no timer
    expect(g.mess.phase).toBe("messy");
  });
  it("nothing else can be spilled while there is a mess (one mess at a time), and the prop is not asked twice", () => {
    const g = game();
    spillToQuestion(g);
    expect(g.acts.tap(g.cup)).toBe(false);
    expect(g.acts.tap(g.toybox)).toBe(false);
    expect(g.mess.visitFor("spill", g.cup)).toBeNull();
  });
});

describe("pressing Clean after the spill", () => {
  it("sends Kip to the puddle with a mop: the card goes when Kip starts, the mop is in the hands, the puddle gets smaller with each of six strokes", () => {
    const g = game();
    spillToQuestion(g);
    g.arrive();
    g.log.length = 0;
    g.button()!.click();
    expect(g.log[0]).toBe(`walkTo:${+(29.5 + PUDDLE_DX - MOP_STAND).toFixed(2)},${+(-2 + PUDDLE_DZ).toFixed(2)}`);
    expect(g.card()!.hidden).toBe(false);                                      // still there while Kip walks: a dropped walk must not lose the button
    g.arrive();
    g.run(0.1);
    expect(g.card()!.hidden).toBe(true);
    expect(g.mess.phase).toBe("cleaning");
    expect(g.log).toContain("hold:mop");
    expect(g.log).toContain("clip:mop");
    let last = g.mess.puddleSize;
    const sizes: number[] = [];
    for (let i = 0; i < MOP_STROKES; i++) {
      g.run(strokeEndsAt(i) - 0.1 + 0.02 - (i === 0 ? 0.1 : 0));
      sizes.push(g.mess.puddleSize);
    }
    for (const v of sizes) { expect(v).toBeLessThanOrEqual(last + 1e-9); last = v; }
    expect(sizes[0]!).toBeGreaterThan(sizes.at(-1)! + 0.5);
  });
  it("the puddle is gone and the cup is standing again when the mopping is done; Kip cheers, says 'All clean! Hooray!', and puts the mop away", () => {
    const g = game();
    spillToQuestion(g);
    g.arrive();
    g.button()!.click();
    g.arrive();
    g.run(MOP_END_S + 4);
    expect(g.mess.puddleSize).toBe(0);
    expect(cupRot(g)).toBe(0);
    expect(g.cupT.userData.juice.visible).toBe(true);
    expect(g.mess.phase).toBe("idle");
    expect(g.mess.promptVisible).toBe(false);
    expect(g.says.filter((t) => t === ALL_CLEAN)).toHaveLength(1);
    expect(g.toasts.filter((t) => t === ALL_CLEAN)).toHaveLength(1);
    expect(g.log).toContain("clip:cheer");
    expect(g.log.lastIndexOf("release")).toBeGreaterThan(g.log.indexOf("hold:mop"));
    expect(g.log.indexOf("release")).toBeLessThan(g.log.indexOf("clip:cheer"));  // the mop is put away before the cheer
  });
  it("can be spilled and cleaned again, any number of times", () => {
    const g = game();
    for (let round = 0; round < 3; round++) {
      g.acts.tap(g.cup);
      g.arrive();
      g.run(SPILL_PROMPT_AT_S + 0.4);
      expect(g.mess.phase, `round ${round}`).toBe("messy");
      g.arrive();
      g.button()!.click();
      g.arrive();
      g.run(MOP_END_S + 4);
      expect(g.mess.phase, `round ${round}`).toBe("idle");
      expect(g.mess.puddleSize).toBe(0);
    }
    expect(g.says.filter((t) => t === OH_NO)).toHaveLength(3);
  });
  it("two presses of the button start one cleaning, not two", () => {
    const g = game();
    spillToQuestion(g);
    g.arrive();
    g.log.length = 0;
    g.button()!.click();
    g.button()!.click();
    expect(g.log.filter((l) => l.startsWith("walkTo"))).toHaveLength(1);
  });
  it("a Clean press while Kip is busy does nothing and the card stays; sending Kip elsewhere on the way keeps the button", () => {
    const g = game();
    spillToQuestion(g);
    g.s.canRun = false;
    expect(g.mess.clean()).toBe(false);
    expect(g.card()!.hidden).toBe(false);
    g.s.canRun = true;
    g.arrive();
    expect(g.mess.clean()).toBe(true);
    expect(g.acts.consume()).toBe(false);                                       // a tap elsewhere while Kip walks to the puddle drops the visit (and is the player's own tap)
    expect(g.mess.phase).toBe("messy");
    expect(g.card()!.hidden).toBe(false);
    expect(g.mess.clean()).toBe(true);                                          // and the button still works
  });
  it("only a character cleans: a vehicle or a robot is not sent", () => {
    const g = game({ eater: "vehicle" });
    expect(g.acts.tap(g.cup)).toBe(false);
    expect(g.mess.phase).toBe("idle");
  });
});

describe("tapping the toy box", () => {
  it("sends Kip to the left of the box; nothing tips until Kip is there; then the box leans and the toys tumble out one after another", () => {
    const g = game();
    expect(g.acts.tap(g.toybox)).toBe(true);
    expect(g.log).toEqual([`walkTo:${+(13 - BOX_STAND).toFixed(2)},${BOX_STAND_Z}`]);
    g.run(1);
    expect(boxRot(g)).toBe(0);
    expect(g.mess.toysOut).toBe(0);
    g.arrive();
    g.run(DUMP_TIP_AT_S + 0.3);
    expect(g.mess.toysOut).toBe(PILE_TOYS);
    expect(boxRot(g)).toBeGreaterThan(0);
    expect(toyAt(g, 0).position.distanceTo(new THREE.Vector3(IN_BOX[0]!.x, IN_BOX[0]!.y, IN_BOX[0]!.z))).toBeGreaterThan(0.05);   // the first toy is on its way
    expect(toyAt(g, 5).position.y).toBeCloseTo(IN_BOX[5]!.y, 6);                                                                  // the last has not left yet
  });
  it("ends with every toy in the heap in front of the box and the box leaning; 'Oh no, oh no!', then 'Clean?'", () => {
    const g = game();
    dumpToQuestion(g);
    for (let i = 0; i < PILE_TOYS; i++) {
      const t = toyAt(g, i);
      expect(near(t.position.x, IN_PILE[i]!.x) && near(t.position.y, IN_PILE[i]!.y) && near(t.position.z, IN_PILE[i]!.z), `toy ${i}`).toBe(true);
    }
    expect(near(boxRot(g), BOX_TILT)).toBe(true);
    expect(g.says).toEqual([OH_NO, CLEAN_Q]);
    expect(g.toasts).toEqual([OH_NO]);
    expect(g.mess.phase).toBe("messy");
    expect(g.mess.promptVisible).toBe(true);
    expect(TUMBLE_DONE_S + DUMP_TIP_AT_S).toBeLessThan(DUMP_PROMPT_AT_S + 0.2);
  });
});

describe("pressing Clean after the toys are out", () => {
  it("the box rights itself and the toys fly back one by one, each counted ('1 toy home!' ... 'All 6 toys home!') with a rising note", () => {
    const g = game();
    dumpToQuestion(g);
    g.arrive();
    g.button()!.click();
    g.arrive();
    g.run(0.1);
    expect(g.mess.phase).toBe("cleaning");
    expect(g.card()!.hidden).toBe(true);
    expect(g.log).toContain("clip:tidy");
    g.toasts.length = 0;
    g.tones.length = 0;
    g.run(homeAt(PILE_TOYS - 1) + 0.2);
    expect(g.toasts).toEqual(["1 toy home!", "2 toys home!", "3 toys home!", "4 toys home!", "5 toys home!", "All 6 toys home!"]);
    expect(g.tones.slice(0, 6)).toEqual([523, 587, 659, 784, 880, 1047]);
  });
  it("when it is over every toy is back in the box, the box is upright, Kip cheers and says 'All clean! Hooray!', and the room is ready for another mess", () => {
    const g = game();
    dumpToQuestion(g);
    g.arrive();
    g.button()!.click();
    g.arrive();
    g.run(8);
    for (let i = 0; i < PILE_TOYS; i++) expect(near(toyAt(g, i).position.y, IN_BOX[i]!.y) && near(toyAt(g, i).position.x, IN_BOX[i]!.x), `toy ${i}`).toBe(true);
    expect(boxRot(g)).toBe(0);
    expect(g.mess.phase).toBe("idle");
    expect(g.mess.toysOut).toBe(0);
    expect(g.log).toContain("clip:cheer");
    expect(g.says.filter((t) => t === ALL_CLEAN)).toHaveLength(1);
    expect(g.acts.tap(g.toybox)).toBe(true);                                    // the same box can be tipped again
  });
  it("the box is upright before the first toy leaves the floor, so they fly into an upright box", () => {
    const g = game();
    dumpToQuestion(g);
    g.arrive();
    g.button()!.click();
    g.arrive();
    g.run(TIDY_START_S);
    expect(boxRot(g)).toBeLessThan(1e-3);
    expect(toyAt(g, 0).position.y).toBeLessThan(IN_PILE[0]!.y + 0.05);          // the first toy is still on the floor: the box is upright by the time it leaves it
  });
});

describe("a cleaning cut short puts things right and can be finished", () => {
  it("a tidy-up cut short leaves the toys that got home in the box, puts the others back on the floor, asks again, and the next Clean takes only those", () => {
    const g = game();
    dumpToQuestion(g);
    g.arrive();
    g.button()!.click();
    g.arrive();
    g.run(homeAt(2) + 0.1);                                                      // three toys are home
    g.toasts.length = 0;
    g.acts.reset();                                                              // a new toy, say: the visit is cut short
    expect(g.mess.phase).toBe("messy");
    expect(g.mess.toysOut).toBe(3);
    expect(g.mess.promptVisible).toBe(true);
    for (let i = 0; i < 3; i++) expect(near(toyAt(g, i).position.y, IN_BOX[i]!.y), `toy ${i} home`).toBe(true);
    for (let i = 3; i < PILE_TOYS; i++) expect(near(toyAt(g, i).position.y, IN_PILE[i]!.y), `toy ${i} back on the floor`).toBe(true);
    g.arrive();
    g.button()!.click();
    g.arrive();
    g.run(8);
    expect(g.toasts).toEqual(["4 toys home!", "5 toys home!", "All 6 toys home!"]);   // the count carries on from three
    expect(g.mess.phase).toBe("idle");
  });
  it("a mopping cut short leaves what is left of the puddle and asks again; the next mopping starts from there and finishes", () => {
    const g = game();
    spillToQuestion(g);
    g.arrive();
    g.button()!.click();
    g.arrive();
    g.run(strokeEndsAt(2) + 0.05);                                               // three strokes in
    g.acts.reset();
    expect(g.mess.phase).toBe("messy");
    expect(g.mess.puddleSize).toBeGreaterThan(0.3);
    expect(g.mess.puddleSize).toBeLessThan(0.7);
    expect(g.mess.promptVisible).toBe(true);
    expect(g.log.at(-1) === "release" || g.log.includes("release")).toBe(true);
    g.arrive();
    g.button()!.click();
    g.arrive();
    g.run(MOP_END_S + 4);
    expect(g.mess.puddleSize).toBe(0);
    expect(g.mess.phase).toBe("idle");
  });
  it("the world resets the mess BEFORE the acts: a mopping or a tidy-up that is then cut short must not bring the card or the mess back", () => {
    for (const make of [spillToQuestion, dumpToQuestion]) {
      const g = game();
      make(g);
      g.arrive();
      g.button()!.click();
      g.arrive();
      g.run(1.2);                                                                // cleaning is under way
      g.mess.reset();                                                            // the world's order: the mess first ...
      g.acts.reset();                                                            // ... then the acts, which cut the visit short
      expect(g.mess.phase).toBe("idle");
      expect(g.mess.promptVisible).toBe(false);
      expect(g.card()).toBeUndefined();
      expect(g.mess.puddleSize).toBe(0);
      expect(g.mess.toysOut).toBe(0);
      expect(g.mess.clean()).toBe(false);
    }
  });
  it("a spill cut short BEFORE the cup tips is nothing; cut short after it, the mess is there and the question is asked", () => {
    const a = game();
    a.acts.tap(a.cup);
    a.arrive();
    a.run(SPILL_TIP_AT_S - 0.15);
    a.acts.reset();
    expect(a.mess.phase).toBe("idle");
    expect(cupRot(a)).toBe(0);
    const b = game();
    b.acts.tap(b.cup);
    b.arrive();
    b.run(SPILL_TIP_AT_S + 0.15);
    b.acts.reset();
    expect(b.mess.phase).toBe("messy");
    expect(b.mess.promptVisible).toBe(true);
    b.run(3);
    expect(near(cupRot(b), CUP_LIE)).toBe(true);                                 // the spill carries on by itself
    expect(near(b.mess.puddleSize, 1, 1e-3)).toBe(true);
  });
  it("reset (a world change) clears everything: no puddle, no card, nothing left to clean, and a new mess can start", () => {
    const g = game();
    spillToQuestion(g);
    g.acts.reset();
    g.mess.reset();
    expect(g.mess.phase).toBe("idle");
    expect(g.mess.puddleSize).toBe(0);
    expect(g.mess.promptVisible).toBe(false);
    expect(g.card()).toBeUndefined();
    expect(g.mess.clean()).toBe(false);
    expect(g.mess.visitFor("spill", g.cup)).not.toBeNull();
  });
});

describe("less motion and no sound", () => {
  it("reduced motion: the spill appears finished at the tip cue, the puddle goes in six steps, the toys change places without flying", () => {
    const g = game({ reduced: true });
    g.acts.tap(g.cup);
    g.arrive();
    g.run(SPILL_TIP_AT_S + 0.1);
    expect(near(cupRot(g), CUP_LIE)).toBe(true);
    expect(near(g.mess.puddleSize, 1, 1e-6)).toBe(true);
    g.run(SPILL_PROMPT_AT_S);
    g.arrive();
    g.button()!.click();
    g.arrive();
    const seen = new Set<number>();
    for (let t = 0; t < MOP_END_S + 0.3; t += 1 / 30) { g.step(1 / 30); seen.add(+g.mess.puddleSize.toFixed(4)); }
    expect([...seen].filter((v) => v > 0).length).toBeLessThanOrEqual(MOP_STROKES);   // only the six whole-stroke sizes (and nothing in between)
    expect(g.mess.puddleSize).toBe(0);
    const h = game({ reduced: true });
    h.acts.tap(h.toybox);
    h.arrive();
    h.run(DUMP_TIP_AT_S + 0.05);
    for (let i = 0; i < PILE_TOYS; i++) expect(near(toyAt(h, i).position.y, IN_PILE[i]!.y), `toy ${i}`).toBe(true);
    h.run(DUMP_PROMPT_AT_S);
    h.arrive();
    h.button()!.click();
    h.arrive();
    h.run(8);
    expect(h.mess.phase).toBe("idle");
    for (let i = 0; i < PILE_TOYS; i++) expect(near(toyAt(h, i).position.y, IN_BOX[i]!.y), `toy ${i} home`).toBe(true);
  });
  it("every spoken line is also shown as text: 'Oh no, oh no!' and 'All clean! Hooray!' as a toast, 'Clean?' on the card itself", () => {
    const g = game();
    spillToQuestion(g);
    g.arrive();
    g.button()!.click();
    g.arrive();
    g.run(MOP_END_S + 4);
    expect(g.toasts).toContain(OH_NO);
    expect(g.toasts).toContain(ALL_CLEAN);
    expect(g.card()!.children[0]!.textContent).toBe(CLEAN_Q);
    for (const said of g.says) expect([OH_NO, CLEAN_Q, ALL_CLEAN]).toContain(said);
  });
  it("a world with no stage element shows no card and does not break (the mess still happens)", () => {
    const g = game({ host: false });
    spillToQuestion(g);
    expect(g.mess.phase).toBe("messy");
    expect(g.mess.promptVisible).toBe(false);
    expect(g.mess.clean()).toBe(true);                                          // and it can still be cleaned (by code)
  });
});

describe("props that are not ours", () => {
  it("a prop without the cup's parts, or the box's, starts nothing", () => {
    const g = game();
    const bare = instOf("cup", new THREE.Group());
    expect(g.mess.visitFor("spill", bare)).toBeNull();
    expect(g.mess.visitFor("dump", bare)).toBeNull();
    expect(g.acts.tap(bare)).toBe(false);
  });
});
