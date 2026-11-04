// The kicked ball is on Kip's lane (2026-11-04 night; the dog fork's open item: "the kicked ball lies at z -2.8 while Kip kicks from z 0"). Props stand behind the lane (runtime/hideSpots CLEAR_Z),
// so a tap on the ball asks the world to bring it onto Kip's lane while he walks over, and the contact cue puts it exactly there before it flies.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { PropInst } from "../src/features/game/world/runtime/propReactions";
import { KICK_S, createActs } from "../src/features/game/world/runtime/toyRoomActs";

const ball = (px: number, pz = -2.8) => ({ type: "ball", base: { px, pz }, size: new THREE.Vector3(1.6, 1.6, 1.6) }) as unknown as PropInst;

function game(withPlaceProp = true) {
  const s = { pos: { x: 12, y: 0, z: 0.4 }, target: null as number | null };
  const log: string[] = [];
  const placed: Array<{ x: number; z: number | undefined; snap: boolean | undefined }> = [];
  const kicks: number[] = [];
  const w = {
    position: () => ({ ...s.pos }), targetX: () => s.target,
    walkTo: (x: number, _z: number) => { s.target = x; },
    stopWalk: () => { s.target = null; },
    face: () => {}, root: () => new THREE.Group(), eater: () => "character", allowed: () => true,
    clip: (a: string) => { log.push(`clip:${a}`); return true; },
    setPosition: (x: number, y: number, z: number) => { s.pos = { x, y, z }; },
    tone: () => {}, phase: () => {}, hold: () => {}, release: () => {},
    mouth: () => ({ x: 0, y: 0, z: 0 }), bubbles: { blow: () => {} },
    fx: {
      squish: () => {}, strike: () => 262, kickBall: (_i: unknown, vx: number) => { kicks.push(vx); log.push("kick"); return true; }, flutter: () => {}, say: () => {}, setVisible: () => {}, cue: () => {}, nearby: () => [],
      ...(withPlaceProp ? { placeProp: (_i: unknown, x: number, o?: { z?: number; zSnap?: boolean }) => { placed.push({ x, z: o?.z, snap: o?.zSnap }); } } : {}),
    },
  };
  const acts = createActs(w as never);
  const run = (seconds: number, dt = 1 / 30) => { for (let t = 0; t < seconds - 1e-9; t += dt) { acts.update(dt); if (s.target !== null) { s.pos.x = s.target; s.target = null; } } };
  return { acts, placed, kicks, log, run, s };
}

describe("a kicked ball is on Kip's lane", () => {
  it("a tap asks for the ball to come onto Kip's lane, at its own x, without a snap", () => {
    const g = game();
    const b = ball(20);
    expect(g.acts.tap(b)).toBe(true);
    expect(g.placed).toEqual([{ x: 20, z: 0.4, snap: undefined }]);
  });

  it("at the moment of contact the ball is put exactly on the lane (so it never flies from behind), then kicked", () => {
    const g = game();
    const b = ball(20);
    g.acts.tap(b);
    g.run(KICK_S + 1);
    const snap = g.placed.find((p) => p.snap);
    expect(snap).toEqual({ x: 20, z: 0.4, snap: true });
    expect(g.kicks).toHaveLength(1);
    expect(g.log.indexOf("kick")).toBeGreaterThan(-1);
  });

  it("a world that cannot move props still kicks (the call is optional)", () => {
    const g = game(false);
    g.acts.tap(ball(20));
    g.run(KICK_S + 1);
    expect(g.kicks).toHaveLength(1);
  });

  it("the ball is brought to where Kip stands now, wherever his lane is", () => {
    const g = game();
    g.s.pos.z = -0.7;
    g.acts.tap(ball(30));
    expect(g.placed[0]!.z).toBeCloseTo(-0.7, 9);
  });
});
