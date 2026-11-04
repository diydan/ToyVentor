// Build-up toys (runtime/buildUp.ts): the sandcastle and the snowman, built one stage per tap and brought down by the last.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  COLLAPSE_S, HEAP_HOLD_S, PIECE_GAP_S, POP_DROP, POP_S, SANDCASTLE_NOTES, SANDCASTLE_STAGES, SNOWMAN_NOTES, SNOWMAN_STAGES,
  buildUpSandcastle, buildUpSnowman, createBuildUp, makeBuildUp, popPose,
} from "../src/features/game/world/runtime/buildUp";

const SFX = { added: "soft", crash: "crumble" } as const;
const run = (b: { update(dt: number): void }, secs: number) => { for (let t = 0; t < secs; t += 1 / 60) b.update(1 / 60); };
const visibleStages = (b: ReturnType<typeof createBuildUp>, stageOf: readonly number[]) => [...new Set(stageOf.filter((_, i) => b.poses[i]!.visible))].sort();

describe("popPose", () => {
  it("starts at nothing, high above, and ends at full size in place", () => {
    expect(popPose(0)).toEqual({ scale: 0, dy: POP_DROP });
    const end = popPose(POP_S);
    expect(end.scale).toBeCloseTo(1, 6);
    expect(end.dy).toBeCloseTo(0, 6);
    expect(popPose(-1)).toEqual({ scale: 0, dy: POP_DROP });
    expect(popPose(Number.NaN)).toEqual({ scale: 0, dy: POP_DROP });
  });
  it("overshoots a little on the way (a bounce) and never goes negative", () => {
    let max = 0;
    for (let a = 0; a <= POP_S; a += POP_S / 100) { const p = popPose(a); max = Math.max(max, p.scale); expect(p.scale).toBeGreaterThanOrEqual(0); expect(p.dy).toBeGreaterThanOrEqual(0); }
    expect(max).toBeGreaterThan(1.02);
    expect(max).toBeLessThan(1.3);
  });
});

describe("createBuildUp (the sandcastle's stages)", () => {
  it("starts with only the first stage standing", () => {
    const b = createBuildUp(SANDCASTLE_STAGES, SANDCASTLE_NOTES, SFX);
    expect(b.stages).toBe(4);
    expect(b.step).toBe(0);
    expect(visibleStages(b, SANDCASTLE_STAGES)).toEqual([0]);
  });
  it("each tap adds the next stage, its pieces one after another, and a rising note", () => {
    const b = createBuildUp(SANDCASTLE_STAGES, SANDCASTLE_NOTES, SFX);
    const notes: number[] = [];
    for (let s = 1; s <= 3; s++) {
      const r = b.tap();
      expect(r.kind).toBe("added");
      if (r.kind === "added") { expect(r.layers).toBe(s + 1); expect(r.sfx).toBe("soft"); expect(r.landsIn).toBeGreaterThan(0); expect(r.landsIn).toBeLessThanOrEqual(0.35); notes.push(r.note); }
      if (s === 1) {
        // right after the tap only the first piece of the stage has started; the others wait their turn
        b.update(PIECE_GAP_S * 1.5);
        const shown = SANDCASTLE_STAGES.map((st, i) => (st === 1 && b.poses[i]!.visible ? i : -1)).filter((i) => i >= 0);
        expect(shown.length).toBeGreaterThan(0);
        expect(shown.length).toBeLessThan(8);
      }
      run(b, POP_S + 1);
    }
    expect(notes).toEqual([...SANDCASTLE_NOTES]);
    expect(visibleStages(b, SANDCASTLE_STAGES)).toEqual([0, 1, 2, 3]);
    for (const p of b.poses) { expect(p.scale).toBe(1); expect(p.dy).toBe(0); expect(p.tilt).toBe(0); expect(p.squash).toBe(1); }
  });
  it("the tap on the last stage brings it down, and it is busy until the heap has rested; then it starts again from the first stage", () => {
    const b = createBuildUp(SNOWMAN_STAGES, SNOWMAN_NOTES, { added: "soft", crash: "poof" });
    for (let i = 0; i < 3; i++) { b.tap(); run(b, POP_S + 1); }
    const r = b.tap();
    expect(r).toEqual({ kind: "crash", sfx: "poof" });
    expect(b.phase).toBe("crashing");
    expect(b.tap()).toEqual({ kind: "busy" });
    run(b, COLLAPSE_S + 0.05);
    expect(b.phase).toBe("resting");
    expect(b.tap()).toEqual({ kind: "busy" });
    expect(visibleStages(b, SNOWMAN_STAGES)).toEqual([0]);                          // only the heap is left
    run(b, HEAP_HOLD_S + 0.1);
    expect(b.phase).toBe("standing");
    expect(b.step).toBe(0);
    expect(b.tap().kind).toBe("added");                                              // and it can be built again
  });
  it("while it comes down the upper pieces shrink, drop and lean away, the top first; the base squashes and comes back", () => {
    const b = createBuildUp(SANDCASTLE_STAGES, SANDCASTLE_NOTES, SFX);
    for (let i = 0; i < 3; i++) { b.tap(); run(b, POP_S + 1); }
    b.tap();
    run(b, 0.3);
    const top = SANDCASTLE_STAGES.indexOf(3), low = SANDCASTLE_STAGES.indexOf(1);
    expect(b.poses[top]!.scale).toBeLessThan(b.poses[low]!.scale);                  // the flag goes before the towers
    expect(b.poses[top]!.dy).toBeLessThan(0);
    expect(Math.abs(b.poses[top]!.tilt)).toBeGreaterThan(0);
    expect(b.poses[0]!.squash).toBeLessThan(1);
    run(b, COLLAPSE_S);
    expect(b.poses[0]!.squash).toBeGreaterThan(0.99);
  });
  it("a missing or bad time step does not break or skip it", () => {
    const b = createBuildUp(SANDCASTLE_STAGES, SANDCASTLE_NOTES, SFX);
    b.tap();
    b.update(Number.NaN); b.update(-1); b.update(Infinity);
    expect(b.poses.every((p) => Number.isFinite(p.scale) && Number.isFinite(p.dy))).toBe(true);
    b.update(5);                                                                     // a tab left in the background: counts as at most a tenth of a second, so the piece is still popping in
    const p = b.poses[SANDCASTLE_STAGES.indexOf(1)]!;
    expect(p.scale).toBeLessThan(0.99);
    expect(p.dy).toBeGreaterThan(0);
  });
  it("stage tables describe the builders in world.ts: 18 sandcastle pieces and 14 snowman pieces, each stage non-empty and in order", () => {
    expect(SANDCASTLE_STAGES).toHaveLength(18);
    expect(SNOWMAN_STAGES).toHaveLength(14);
    for (const t of [SANDCASTLE_STAGES, SNOWMAN_STAGES]) {
      expect([...t]).toEqual([...t].sort((a, b) => a - b));
      expect(new Set(t).size).toBe(Math.max(...t) + 1);
    }
  });
});

function sandGroup(): THREE.Group {
  const g = new THREE.Group();
  g.position.set(5, 0, 1);
  // a tall tower (bottom at 0.25) and a cone on it, standing on a base: the shapes the real castle has
  for (let i = 0; i < SANDCASTLE_STAGES.length; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.8, 0.4), new THREE.MeshBasicMaterial());
    m.position.set((i % 5) * 0.5 - 1, 0.4 + (i === 0 ? 0 : 0.25), 0);
    g.add(m);
  }
  return g;
}
const bottomOf = (g: THREE.Group, i: number) => { g.updateMatrixWorld(true); return new THREE.Box3().setFromObject(g.children[i]!).min.y; };

describe("makeBuildUp (the meshes)", () => {
  it("drives the group's children: only the first stage shows, and the group gets the tap and tick hooks the prop reactions use", () => {
    const g = buildUpSandcastle(sandGroup());
    expect(typeof g.userData.stack).toBe("function");
    expect(typeof g.userData.tick).toBe("function");
    SANDCASTLE_STAGES.forEach((s, i) => expect(g.children[i]!.visible, `piece ${i}`).toBe(s === 0));
    const r = g.userData.stack();
    expect(r.kind).toBe("added");
    g.userData.tick(0, 1 / 60);
    expect(g.children.some((c, i) => SANDCASTLE_STAGES[i] === 1 && c.visible)).toBe(true);
    SANDCASTLE_STAGES.forEach((s, i) => { if (s > 1) expect(g.children[i]!.visible).toBe(false); });
  });
  it("a piece grows from where it stands: its bottom stays on the ground while it pops, and it ends exactly as drawn", () => {
    const g = sandGroup();
    const drawn = g.children.map((c) => ({ p: c.position.clone(), s: c.scale.clone() }));
    const i = SANDCASTLE_STAGES.indexOf(1);
    const bottom0 = bottomOf(g, i);
    makeBuildUp(g, SANDCASTLE_STAGES, SANDCASTLE_NOTES, SFX);
    g.userData.stack();
    for (let t = 0; t < POP_S + 0.3; t += 1 / 60) {
      g.userData.tick(t, 1 / 60);
      const c = g.children[i]!;
      if (!c.visible) continue;
      const age = t + 1 / 60;
      const p = popPose(age);
      expect(bottomOf(g, i) - bottom0, `t=${t.toFixed(2)}`).toBeCloseTo(p.dy, 5);   // lowered only by how far it is still falling, never sunk into the ground or floating on its middle
    }
    g.userData.tick(0, 1);
    expect(g.children[i]!.position.toArray().map((v) => +v.toFixed(6))).toEqual(drawn[i]!.p.toArray().map((v) => +v.toFixed(6)));
    expect(g.children[i]!.scale.toArray()).toEqual(drawn[i]!.s.toArray());
  });
  it("after a full build and the fall it is back to the first stage with every piece at its drawn size", () => {
    const g = sandGroup();
    const drawn = g.children.map((c) => c.scale.toArray());
    makeBuildUp(g, SANDCASTLE_STAGES, SANDCASTLE_NOTES, SFX);
    for (let i = 0; i < 4; i++) { g.userData.stack(); for (let t = 0; t < 1; t += 1 / 60) g.userData.tick(t, 1 / 60); }
    for (let t = 0; t < COLLAPSE_S + HEAP_HOLD_S + 0.3; t += 1 / 60) g.userData.tick(t, 1 / 60);
    expect(g.userData.build.step).toBe(0);
    g.children.forEach((c, i) => { expect(c.visible).toBe(SANDCASTLE_STAGES[i] === 0); expect(c.scale.toArray().map((v: number) => +v.toFixed(5))).toEqual(drawn[i]!.map((v) => +v.toFixed(5))); expect(c.rotation.z).toBe(0); });
  });
  it("a group with a different number of pieces than the stages describe is left exactly as drawn, with no hooks (a builder changed: no half-built toy)", () => {
    const g = new THREE.Group();
    for (let i = 0; i < 5; i++) g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
    const same = buildUpSnowman(g);
    expect(same).toBe(g);
    expect(g.userData.stack).toBeUndefined();
    expect(g.userData.tick).toBeUndefined();
    expect(g.children.every((c) => c.visible)).toBe(true);
  });
});
