import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import {
  BLOCK, BLOCK_COLORS, BLOCK_COUNT, BLOCK_LETTERS, CRASH_MAX_S, DROP_HEIGHT, DROP_LAND_S, MAX_LAYERS, REST_HOLD_S, START_LAYERS, SWAY_S, TOWER_NOTES,
  buildBlockTower, blocksIn, crashBodies, createTower, dropOffset, nervous, restY, separate, slotOf, stepBody, sway,
} from "../src/features/game/world/runtime/blockTower";

const H = BLOCK / 2;
const HP = Math.PI / 2;
const isFlat = (a: number) => Math.abs(a / HP - Math.round(a / HP)) < 1e-6;
const run = (t: ReturnType<typeof createTower>, seconds: number, dt = 1 / 60) => { for (let k = 0; k < seconds / dt; k++) t.update(dt); };
const untilStanding = (t: ReturnType<typeof createTower>, limit = 30) => { let s = 0; while (t.phase !== "standing" && s < limit) { t.update(1 / 60); s += 1 / 60; } return s; };

describe("where the blocks sit", () => {
  it("the pair lies on the floor side by side, and the third is the old pile's top block, exactly where it always was", () => {
    expect(slotOf(0)).toMatchObject({ x: -0.5, y: H, ry: 0.1 });
    expect(slotOf(1)).toMatchObject({ x: 0.5, y: H, z: 0.1, ry: -0.15 });
    expect(slotOf(2)).toEqual({ x: 0, y: 1.35, z: 0, rx: 0, ry: 0.2, rz: 0 });
  });
  it("every layer above is one block higher than the one below, nearly in line (a toy tower leans a little, never enough to fall)", () => {
    for (let i = 2; i < BLOCK_COUNT; i++) {
      const layer = i - 1;
      expect(slotOf(i).y).toBeCloseTo(H + BLOCK * layer, 9);
      expect(Math.abs(slotOf(i).x)).toBeLessThan(0.1);
      const belowX = i === 2 ? (slotOf(0).x + slotOf(1).x) / 2 : slotOf(i - 1).x;                   // the third block spans the pair
      expect(Math.abs(slotOf(i).x - belowX)).toBeLessThan(BLOCK / 2);                                  // each rests on the one below it
    }
    expect(slotOf(BLOCK_COUNT - 1).y).toBeCloseTo(H + BLOCK * (MAX_LAYERS - 1), 9);
  });
  it("blocksIn counts the pair: a tower of n layers is n + 1 blocks", () => {
    expect(blocksIn(START_LAYERS)).toBe(3);
    expect(blocksIn(MAX_LAYERS)).toBe(BLOCK_COUNT);
    expect(BLOCK_LETTERS).toHaveLength(BLOCK_COUNT);
    expect(BLOCK_COLORS).toHaveLength(BLOCK_COUNT);
    expect(new Set(BLOCK_COLORS).size).toBe(BLOCK_COUNT);
  });
  it("the notes climb a scale", () => {
    for (let i = 1; i < TOWER_NOTES.length; i++) expect(TOWER_NOTES[i]!).toBeGreaterThan(TOWER_NOTES[i - 1]!);
    expect(TOWER_NOTES.length).toBeGreaterThanOrEqual(MAX_LAYERS);
  });
});

describe("the drop", () => {
  it("starts well above its place, falls faster and faster, and is down after DROP_LAND_S", () => {
    expect(dropOffset(0)).toBeCloseTo(DROP_HEIGHT, 9);
    let prev = dropOffset(0), prevStep = 0;
    for (let a = 0.02; a < DROP_LAND_S; a += 0.02) { const d = dropOffset(a); expect(d).toBeLessThan(prev); expect(prev - d).toBeGreaterThan(prevStep + 1e-6); prevStep = prev - d; prev = d; }
    expect(dropOffset(DROP_LAND_S)).toBeCloseTo(0, 6);
    expect(DROP_LAND_S).toBeGreaterThan(0.3);
    expect(DROP_LAND_S).toBeLessThan(0.55);
  });
  it("hops up a little after landing and settles flat, and an odd age is harmless", () => {
    expect(Math.max(...Array.from({ length: 40 }, (_, i) => dropOffset(DROP_LAND_S + i * 0.005)))).toBeGreaterThan(0.05);
    expect(Math.max(...Array.from({ length: 40 }, (_, i) => dropOffset(DROP_LAND_S + i * 0.005)))).toBeLessThan(0.15);
    expect(dropOffset(5)).toBe(0);
    expect(dropOffset(Infinity)).toBe(0);
    expect(dropOffset(-1)).toBe(DROP_HEIGHT);
    expect(dropOffset(Number.NaN)).toBe(DROP_HEIGHT);
  });
});

describe("sway and nerves", () => {
  it("nothing before a block lands and nothing once it has settled", () => {
    expect(sway(5, 3, -0.1)).toEqual({ dx: 0, rz: 0 });
    expect(sway(5, 3, SWAY_S)).toEqual({ dx: 0, rz: 0 });
    expect(sway(5, 3, Number.NaN)).toEqual({ dx: 0, rz: 0 });
  });
  it("the top moves more than the middle, the blocks on the floor not at all, and a taller tower more than a short one", () => {
    const peak = (layers: number, y: number) => Math.max(...Array.from({ length: 160 }, (_, i) => Math.abs(sway(layers, y, i * 0.01).dx)));
    const top = (layers: number) => H + BLOCK * (layers - 1);
    expect(peak(6, H)).toBe(0);
    expect(peak(6, 0)).toBe(0);
    expect(peak(6, top(6))).toBeGreaterThan(peak(6, H + BLOCK * 2));
    expect(peak(6, H + BLOCK * 2)).toBeGreaterThan(0);
    expect(peak(6, top(6))).toBeGreaterThan(peak(3, top(3)));
    expect(peak(6, top(6))).toBeGreaterThan(0.1);
    expect(peak(6, top(6))).toBeLessThan(0.45);
  });
  it("dies away", () => {
    const early = Math.max(...Array.from({ length: 30 }, (_, i) => Math.abs(sway(6, 4.95, i * 0.01).dx)));
    const late = Math.max(...Array.from({ length: 30 }, (_, i) => Math.abs(sway(6, 4.95, 1.2 + i * 0.01).dx)));
    expect(late).toBeLessThan(early * 0.2);
  });
  it("tips the other way from the push", () => {
    const s = sway(6, 4.95, 0.1);
    expect(Math.sign(s.rz)).toBe(-Math.sign(s.dx));
  });
  it("a tower of four layers or fewer is still; a taller one creaks, more the taller it is, but gently", () => {
    for (const t of [0, 0.3, 1.1]) expect(nervous(4, 3, t)).toEqual({ dx: 0, rz: 0 });
    const peak = (layers: number) => Math.max(...Array.from({ length: 400 }, (_, i) => Math.abs(nervous(layers, H + BLOCK * (layers - 1), i * 0.02).dx)));
    expect(peak(5)).toBeGreaterThan(0.01);
    expect(peak(7)).toBeGreaterThan(peak(5));
    expect(peak(7)).toBeLessThan(0.15);
  });
});

describe("a block on the floor", () => {
  it("rests half a block up when it lies flat and higher when it is tilted", () => {
    expect(restY(0, 0)).toBeCloseTo(H, 9);
    expect(restY(HP, 0)).toBeCloseTo(H, 9);
    expect(restY(0, HP)).toBeCloseTo(H, 9);
    expect(restY(Math.PI, Math.PI)).toBeCloseTo(H, 9);
    expect(restY(Math.PI / 4, 0)).toBeCloseTo(H * Math.SQRT2, 9);
    expect(restY(0.3, 0.2)).toBeGreaterThan(H);
  });
});

describe("the crash", () => {
  it("every block of a full tower lets go, the top first, and flies the way the tower falls (spread out, the higher the farther)", () => {
    const bodies = crashBodies(MAX_LAYERS, 1, 7);
    expect(bodies).toHaveLength(BLOCK_COUNT);
    for (let i = 3; i < bodies.length; i++) expect(bodies[i]!.delay).toBeLessThanOrEqual(bodies[i - 1]!.delay);
    expect(bodies[BLOCK_COUNT - 1]!.delay).toBeLessThan(bodies[0]!.delay);
    for (const b of bodies) expect(b.vx).toBeGreaterThan(0);
    expect(Math.min(...bodies.slice(4).map((b) => b.vx))).toBeGreaterThan(Math.max(...bodies.slice(0, 2).map((b) => b.vx)) - 1.2);
    for (const b of crashBodies(MAX_LAYERS, -1, 7)) expect(b.vx).toBeLessThan(0);
  });
  it("is the same crash for the same seed and a different one for another", () => {
    expect(crashBodies(6, 1, 3)).toEqual(crashBodies(6, 1, 3));
    expect(crashBodies(6, 1, 3)).not.toEqual(crashBodies(6, 1, 4));
  });
  it("a block waits out its delay, then falls, lands, never goes through the floor and ends flat and still", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const b = crashBodies(MAX_LAYERS, seed % 2 ? 1 : -1, seed)[BLOCK_COUNT - 1]!;
      const y0 = b.y;
      for (let k = 0; k < 4 && b.delay > 0; k++) { stepBody(b, 0.01); }
      let minGap = Infinity;
      for (let k = 0; k < 900 && !b.rest; k++) { stepBody(b, 1 / 120); minGap = Math.min(minGap, b.y - restY(b.rx, b.rz)); }
      expect(b.rest, `seed ${seed}`).toBe(true);
      expect(minGap).toBeGreaterThan(-1e-6);
      expect(b.y).toBeCloseTo(H, 9);
      expect(isFlat(b.rx) && isFlat(b.rz)).toBe(true);
      expect(b.y).toBeLessThan(y0);
      expect(Math.abs(b.x)).toBeLessThanOrEqual(3.2 + 1e-9);
      expect(b.z).toBeGreaterThanOrEqual(-1.1 - 1e-9);
      expect(b.z).toBeLessThanOrEqual(1.7 + 1e-9);
      expect(Object.values(b).every((v) => typeof v !== "number" || Number.isFinite(v))).toBe(true);
    }
  });
  it("a block thrown hard at the edge of the room (either side, front or back) stays inside it and comes back", () => {
    const throwAt = (vx: number, vz: number) => {
      const b = { ...slotOf(1), vx, vy: 2, vz, wx: 0, wy: 0, wz: 0, delay: 0, landed: false, rest: false };
      let far = { x: 0, z: 0 };
      for (let k = 0; k < 600 && !b.rest; k++) { stepBody(b, 1 / 120); far = { x: Math.max(Math.abs(far.x), Math.abs(b.x)) * Math.sign(b.x || 1), z: Math.max(Math.abs(far.z), Math.abs(b.z)) * Math.sign(b.z || 1) }; expect(Math.abs(b.x)).toBeLessThanOrEqual(3.2 + 1e-9); expect(b.z).toBeGreaterThanOrEqual(-1.1 - 1e-9); expect(b.z).toBeLessThanOrEqual(1.7 + 1e-9); }
      return b;
    };
    expect(throwAt(30, 0).vx).toBeLessThanOrEqual(0);                       // bounced back off the right edge
    expect(throwAt(-30, 0).vx).toBeGreaterThanOrEqual(0);
    expect(throwAt(0, 30).vz).toBeLessThanOrEqual(0);                       // off the front
    expect(throwAt(0, -30).vz).toBeGreaterThanOrEqual(0);                   // off the back
  });
  it("a block at rest stays put", () => {
    const b = crashBodies(3, 1, 1)[0]!;
    for (let k = 0; k < 900 && !b.rest; k++) stepBody(b, 1 / 120);
    const before = { ...b };
    stepBody(b, 0.5);
    expect(b).toEqual(before);
  });
  it("two blocks sitting inside each other are pushed apart; a block at rest is not moved, the other one takes all of it", () => {
    const mk = (x: number, z = 0, rest = false) => ({ ...slotOf(0), x, z, y: H, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, delay: 0, landed: true, rest });
    const a = mk(0), b = mk(0.3);
    separate([a, b]);
    expect(Math.abs(a.x - b.x)).toBeGreaterThanOrEqual(BLOCK - 1e-9);
    expect(a.x).toBeLessThan(b.x);
    const r = mk(0, 0, true), f = mk(0.3);
    separate([r, f]);
    expect(r.x).toBe(0);
    expect(f.x).toBeGreaterThanOrEqual(BLOCK - 1e-9);
    const up = { ...mk(0.3), y: H + 3 };
    const c = mk(0);
    separate([c, up]);
    expect(up.x).toBe(0.3);                                                // one flying well above the other is not touching it
  });
});

describe("the tower", () => {
  it("starts as the old pile: two layers, three blocks showing, each in its place, the rest parked out of sight on the pile", () => {
    const t = createTower();
    expect(t.phase).toBe("standing");
    expect(t.layers).toBe(START_LAYERS);
    t.poses.forEach((p, i) => {
      if (i <= START_LAYERS) { expect(p.visible, `block ${i}`).toBe(true); expect(p.x).toBeCloseTo(slotOf(i).x, 9); expect(p.y).toBeCloseTo(slotOf(i).y, 9); }
      else { expect(p.visible, `block ${i}`).toBe(false); expect(p.y).toBeCloseTo(slotOf(START_LAYERS).y, 9); }
    });
  });

  it("each tap adds a layer and says which note it makes, climbing", () => {
    const t = createTower();
    const notes: number[] = [];
    for (let layers = START_LAYERS + 1; layers <= MAX_LAYERS; layers++) {
      const r = t.stack();
      expect(r).toEqual({ kind: "added", layers, note: TOWER_NOTES[layers - 1], landsIn: DROP_LAND_S });
      if (r.kind === "added") notes.push(r.note);
      expect(t.layers).toBe(layers);
      run(t, 1);
    }
    expect(notes).toHaveLength(MAX_LAYERS - START_LAYERS);
    for (let i = 1; i < notes.length; i++) expect(notes[i]!).toBeGreaterThan(notes[i - 1]!);
    expect(t.poses.filter((p) => p.visible)).toHaveLength(BLOCK_COUNT);
  });

  it("the new block appears high above its place, falls, and is in its place once it has landed and hopped", () => {
    const t = createTower();
    t.stack();
    const top = () => t.poses[START_LAYERS + 1]!;
    expect(top().visible).toBe(true);
    expect(top().y - slotOf(START_LAYERS + 1).y).toBeCloseTo(DROP_HEIGHT, 6);
    run(t, DROP_LAND_S * 0.5);
    expect(top().y - slotOf(START_LAYERS + 1).y).toBeGreaterThan(0.5);
    expect(top().y - slotOf(START_LAYERS + 1).y).toBeLessThan(DROP_HEIGHT);
    run(t, 0.8);
    expect(top().y).toBeCloseTo(slotOf(START_LAYERS + 1).y, 6);
  });

  it("the tower wobbles when a block lands (the top moves, the pair on the floor does not) and is dead still again after SWAY_S", () => {
    const t = createTower();
    t.poses.forEach((p, i) => { if (p.visible) expect(p.x, `block ${i}`).toBe(slotOf(i).x); });          // the pile at rest does not move
    t.stack();                                                                                          // three layers: below the height where a tower creaks by itself
    run(t, DROP_LAND_S + 0.02);
    let moved = 0, floorMoved = 0;
    for (let k = 0; k < 40; k++) { t.update(1 / 60); moved = Math.max(moved, Math.abs(t.poses[3]!.x - slotOf(3).x)); floorMoved = Math.max(floorMoved, Math.abs(t.poses[0]!.x - slotOf(0).x), Math.abs(t.poses[1]!.x - slotOf(1).x)); }
    expect(moved).toBeGreaterThan(0.05);
    expect(floorMoved).toBe(0);
    run(t, SWAY_S + 0.5);
    t.poses.forEach((p, i) => { if (p.visible) { expect(p.x, `block ${i}`).toBe(slotOf(i).x); expect(p.rz, `block ${i}`).toBe(0); } });
  });

  it("from five layers up the tower creaks by itself, and a shorter one is still", () => {
    const t = createTower();
    t.stack(); t.stack();
    run(t, 2.5);
    expect(t.layers).toBe(4);
    const still = (i: number) => t.poses[i]!.x === slotOf(i).x;
    for (let k = 0; k < 30; k++) { t.update(1 / 20); expect(still(4)).toBe(true); }
    t.stack();
    run(t, 2.5);
    expect(t.layers).toBe(5);
    let moved = 0;
    for (let k = 0; k < 120; k++) { t.update(1 / 20); moved = Math.max(moved, Math.abs(t.poses[5]!.x - slotOf(5).x)); }
    expect(moved).toBeGreaterThan(0.01);
    expect(moved).toBeLessThan(0.15);
  });

  it("a tap while a block is still falling is allowed and nothing jumps: every block moves smoothly", () => {
    const t = createTower();
    t.stack();
    run(t, 0.2);
    t.stack();
    const last = t.poses.map((p) => p.y);
    for (let k = 0; k < 90; k++) {
      t.update(1 / 60);
      t.poses.forEach((p, i) => { if (p.visible) { expect(Math.abs(p.y - last[i]!), `block ${i} at frame ${k}`).toBeLessThan(0.3); last[i] = p.y; } });
    }
    expect(t.layers).toBe(START_LAYERS + 2);
  });

  it("the tap at the top brings the tower down, and while it falls and is rebuilt a tap does nothing", () => {
    const t = createTower();
    for (let i = START_LAYERS; i < MAX_LAYERS; i++) { t.stack(); run(t, 0.7); }
    expect(t.layers).toBe(MAX_LAYERS);
    expect(t.stack()).toEqual({ kind: "crash" });
    expect(t.phase).toBe("crashing");
    expect(t.stack()).toEqual({ kind: "busy" });
    let s = 0;
    while (t.phase === "crashing" && s < 20) { t.update(1 / 60); s += 1 / 60; }
    expect(t.phase).toBe("rebuilding");
    expect(t.stack()).toEqual({ kind: "busy" });
    expect(t.layers).toBe(MAX_LAYERS);                                      // not a short pile until the blocks are home
  });

  it("the crash settles: every block lies flat on the floor in the room, none inside another, then they fly home to the starting pile", () => {
    const t = createTower();
    for (let i = START_LAYERS; i < MAX_LAYERS; i++) { t.stack(); run(t, 0.7); }
    t.stack();
    let s = 0;
    while (t.phase === "crashing" && s < 20) { t.update(1 / 60); s += 1 / 60; }
    expect(s).toBeLessThan(CRASH_MAX_S + REST_HOLD_S + 0.5);
    expect(s).toBeGreaterThan(1.5);                                         // it is a crash, not a pop
    const ps = t.poses;
    ps.forEach((p, i) => {
      expect(p.visible, `block ${i}`).toBe(true);
      expect(p.y, `block ${i}`).toBeCloseTo(H, 6);
      expect(isFlat(p.rx) && isFlat(p.rz), `block ${i} flat`).toBe(true);
      expect(Math.abs(p.x)).toBeLessThanOrEqual(3.2 + 1e-6);
    });
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) expect(Math.abs(ps[i]!.x - ps[j]!.x) >= BLOCK - 0.02 || Math.abs(ps[i]!.z - ps[j]!.z) >= BLOCK - 0.02, `blocks ${i} and ${j} overlap`).toBe(true);
    const reach = Math.max(...ps.map((p) => Math.abs(p.x)));
    expect(reach).toBeGreaterThan(1.2);                                       // it spread out
    expect(reach).toBeLessThanOrEqual(3.2 + 1e-6);                            // but stays near enough to stay on screen
    expect(Math.max(...ps.map((p) => p.z)) - Math.min(...ps.map((p) => p.z))).toBeGreaterThan(0.8);   // and in depth too
    untilStanding(t);
    expect(t.phase).toBe("standing");
    expect(t.layers).toBe(START_LAYERS);
    t.poses.forEach((p, i) => {
      if (i <= START_LAYERS) { expect(p.visible).toBe(true); expect(p.scale).toBe(1); expect(p.x).toBeCloseTo(slotOf(i).x, 6); expect(p.y).toBeCloseTo(slotOf(i).y, 6); expect(p.z).toBeCloseTo(slotOf(i).z, 6); expect(p.ry).toBeCloseTo(slotOf(i).ry, 6); expect(p.rx).toBeCloseTo(0, 6); }
      else expect(p.visible, `block ${i}`).toBe(false);
    });
    expect(t.stack().kind).toBe("added");                                   // and it can be built again
  });

  it("the mess stays on the floor for REST_HOLD_S after the last block stops, and only then do the blocks fly home", () => {
    const t = createTower();
    while (t.layers < MAX_LAYERS) { t.stack(); run(t, 0.7); }
    t.stack();
    const snapshot = () => t.poses.map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)}`).join("|");
    let still = 0, last = snapshot(), guard = 0;
    while (t.phase === "crashing" && guard++ < 3000) {
      t.update(1 / 60);
      const now = snapshot();
      still = now === last ? still + 1 / 60 : 0;
      last = now;
    }
    expect(t.phase).toBe("rebuilding");
    expect(still).toBeGreaterThan(REST_HOLD_S - 0.1);
    expect(still).toBeLessThan(REST_HOLD_S + 0.1);
  });

  it("a crash that has not settled by crashMaxS is settled for it: every block flat, then the rebuild", () => {
    const t = createTower({ crashMaxS: 0.4 });
    while (t.layers < MAX_LAYERS) { t.stack(); run(t, 0.7); }
    t.stack();
    run(t, 0.4 + 0.05);
    t.poses.forEach((p, i) => { expect(p.y, `block ${i}`).toBeCloseTo(H, 6); expect(isFlat(p.rx) && isFlat(p.rz), `block ${i}`).toBe(true); });
    const s = untilStanding(t);
    expect(s).toBeLessThan(REST_HOLD_S + 2);
    expect(t.layers).toBe(START_LAYERS);
  });

  it("the blocks fly home in an arc, one after another, and the extra ones shrink away", () => {
    const t = createTower();
    for (let i = START_LAYERS; i < MAX_LAYERS; i++) { t.stack(); run(t, 0.7); }
    t.stack();
    while (t.phase === "crashing") t.update(1 / 60);
    const startY = t.poses.map((p) => p.y);
    run(t, 0.5);
    expect(t.phase).toBe("rebuilding");
    expect(Math.max(...t.poses.map((p, i) => p.y - startY[i]!))).toBeGreaterThan(0.3);             // lifted off the floor on the way
    const scales = t.poses.map((p) => p.scale);
    expect(scales.slice(0, START_LAYERS + 1).every((v) => v === 1)).toBe(true);
    run(t, 0.5);
    expect(t.poses.slice(START_LAYERS + 1).some((p) => p.visible && p.scale < 1)).toBe(true);
  });

  it("the next crash falls the other way", () => {
    const t = createTower();
    const crashSide = () => {
      while (t.layers < MAX_LAYERS) { t.stack(); run(t, 0.7); }
      t.stack();
      while (t.phase === "crashing") t.update(1 / 60);
      const mean = t.poses.reduce((a, p) => a + p.x, 0) / t.poses.length;
      untilStanding(t);
      return mean;
    };
    const first = crashSide(), second = crashSide();
    expect(Math.abs(first)).toBeGreaterThan(0.5);
    expect(Math.abs(second)).toBeGreaterThan(0.5);
    expect(Math.sign(first)).not.toBe(Math.sign(second));
  });

  it("a long frame (a tab left in the background) advances the animation by a moment, not all at once; a bad frame time changes nothing", () => {
    const t = createTower();
    t.stack();
    t.update(50);
    expect(t.poses[START_LAYERS + 1]!.y).toBeGreaterThan(slotOf(START_LAYERS + 1).y + 1);          // still falling: it did not skip to the end
    const before = JSON.stringify(t.poses);
    for (const bad of [Number.NaN, Infinity, -Infinity, -3]) { t.update(bad); expect(JSON.stringify(t.poses), String(bad)).toBe(before); }
    run(t, 1);
    expect(t.poses[START_LAYERS + 1]!.y).toBeCloseTo(slotOf(START_LAYERS + 1).y, 6);
  });

  it("a huge frame time (a tab in the background) does not break it", () => {
    const t = createTower();
    t.stack();
    t.update(50);
    expect(t.poses.every((p) => Object.values(p).every((v) => typeof v === "boolean" || Number.isFinite(v)))).toBe(true);
    t.update(-1);
    t.update(Number.NaN);
    expect(t.poses.every((p) => Object.values(p).every((v) => typeof v === "boolean" || Number.isFinite(v)))).toBe(true);
  });
});

describe("the meshes", () => {
  const mat = vi.fn((letter: string, colour: string) => new THREE.MeshBasicMaterial({ name: `${letter}${colour}` }));
  const make = () => buildBlockTower(9.5, -2.4, mat);
  it("eight lettered, coloured blocks in a group at its place; the three of the old pile show", () => {
    mat.mockClear();
    const g = make();
    expect(g.position.toArray()).toEqual([9.5, 0, -2.4]);
    const blocks = g.userData.blocks as THREE.Mesh[];
    expect(blocks).toHaveLength(BLOCK_COUNT);
    expect(g.children).toEqual(blocks);
    expect(mat.mock.calls).toEqual(BLOCK_LETTERS.split("").map((l, i) => [l, BLOCK_COLORS[i]]));
    expect(blocks.filter((b) => b.visible)).toHaveLength(START_LAYERS + 1);
    for (const b of blocks) { expect(b.rotation.order).toBe("YXZ"); expect((b.geometry as THREE.BoxGeometry).parameters.width).toBe(BLOCK); }
  });
  it("its footprint, hidden blocks included, is the pile (so what a tap can hit is the pile)", () => {
    const g = make();
    g.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());
    expect(size.y).toBeLessThan(2);
    expect(size.x).toBeLessThan(2.4);
  });
  it("stack() adds the next block, shows it high up, and tick() brings it down", () => {
    const g = make();
    const blocks = g.userData.blocks as THREE.Mesh[];
    const r = (g.userData.stack as () => { kind: string })();
    expect(r.kind).toBe("added");
    expect(blocks[START_LAYERS + 1]!.visible).toBe(true);
    const y0 = blocks[START_LAYERS + 1]!.position.y;
    (g.userData.tick as (t: number, dt: number) => void)(0, 0.2);
    expect(blocks[START_LAYERS + 1]!.position.y).toBeLessThan(y0);
    for (let k = 0; k < 60; k++) (g.userData.tick as (t: number, dt: number) => void)(k / 60, 1 / 60);
    expect(blocks[START_LAYERS + 1]!.position.y).toBeCloseTo(slotOf(START_LAYERS + 1).y, 6);
  });
  it("a crash moves the meshes and the rebuild puts the pile back", () => {
    const g = make();
    const blocks = g.userData.blocks as THREE.Mesh[];
    const stack = g.userData.stack as () => { kind: string };
    const tick = g.userData.tick as (t: number, dt: number) => void;
    for (let i = START_LAYERS; i < MAX_LAYERS; i++) { stack(); for (let k = 0; k < 42; k++) tick(0, 1 / 60); }
    expect(stack().kind).toBe("crash");
    const tower = g.userData.tower as ReturnType<typeof createTower>;
    for (let k = 0; k < 60 * 20 && tower.phase === "crashing"; k++) tick(0, 1 / 60);
    expect(tower.phase).toBe("rebuilding");
    expect(Math.max(...blocks.map((b) => Math.abs(b.position.x)))).toBeGreaterThan(1.2);
    for (let k = 0; k < 60 * 6; k++) tick(0, 1 / 60);
    expect(blocks.filter((b) => b.visible)).toHaveLength(START_LAYERS + 1);
    blocks.slice(0, START_LAYERS + 1).forEach((b, i) => { expect(b.position.x).toBeCloseTo(slotOf(i).x, 6); expect(b.position.y).toBeCloseTo(slotOf(i).y, 6); expect(b.scale.x).toBeCloseTo(1, 6); });
  });
  it("is the tower the prop fx will find: stack, tick and the tower itself on userData", () => {
    const g = make();
    for (const k of ["stack", "tick", "tower", "blocks"]) expect(g.userData[k], k).toBeDefined();
  });
});
