import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error viewer JS modules ship without d.ts
import { PILE_GAP, PILE_LIFT, buildFrame, explodePlan, pileFrame, pilePlan, routeLength, routePoint } from "../parts/kip/viewer/kip-describe-view.js";

// The pile in Describe & build: before a build plays, every part lies in a tidy pile on the ground beside the model, and each is carried to its seat when its step comes up.
// The drawing is covered in a real browser by parts/kip/viewer/tools/e2e_describe.mjs; this file holds the arithmetic, on all the real recipes and a few small made-up ones.
const root = process.cwd();
const viewerDir = join(root, "parts/kip/viewer");
const stlDir = join(root, "public/kip/partspec/describe");
type Box = number[];

function binaryStlBox(file: string): Box {
  const buf = readFileSync(file);
  const n = buf.readUInt32LE(80);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < n; t++) for (let v = 0; v < 3; v++) for (let k = 0; k < 3; k++) {
    const x = buf.readFloatLE(84 + t * 50 + 12 + v * 12 + k * 4);
    lo[k] = Math.min(lo[k]!, x); hi[k] = Math.max(hi[k]!, x);
  }
  return [...lo, ...hi];
}
const recipes = JSON.parse(readFileSync(join(viewerDir, "kip-describe-recipes.json"), "utf8"));
const parts = JSON.parse(readFileSync(join(viewerDir, "kip-describe-parts.json"), "utf8"));
const local: Record<string, Box> = {};
for (const p of recipes.allowedParts as Array<{ id: string }>) local[p.id] = binaryStlBox(join(stlDir, `${p.id}.stl`));

// independent of the code under test
const shift = (b: Box, v: number[]): Box => [b[0]! + v[0]!, b[1]! + v[1]!, b[2]! + v[2]!, b[3]! + v[0]!, b[4]! + v[1]!, b[5]! + v[2]!];
const overlap = (a: Box, b: Box, gap = 0) => [0, 1, 2].every((k) => a[k]! < b[3 + k]! + gap && b[k]! < a[3 + k]! + gap);
const hull = (a: Box, b: Box): Box => [0, 1, 2, 3, 4, 5].map((k) => (k < 3 ? Math.min(a[k]!, b[k]!) : Math.max(a[k]!, b[k]!)));

const plans = (recipes.recipes as Array<{ id: string; steps: Array<{ id: string; part: string }>; reference: { poses: Record<string, unknown> } }>).map((r) => {
  const plan = explodePlan(r.steps, r.reference.poses, local, parts);
  return { id: r.id, plan, pile: pilePlan(plan) };
});

describe("the pile, on every real recipe", () => {
  it("covers all 35 recipes", () => {
    expect(plans.length).toBe(35);
  });

  it("is deterministic: the same recipe gives exactly the same pile every time", () => {
    for (const { plan, pile } of plans) expect(pilePlan(plan)).toEqual(pile);
  });

  it("lies on the ground and never below it: every pile box's lowest point is the model's lowest point", () => {
    for (const { id, plan, pile } of plans) {
      const lowest = Math.min(...plan.order.map((s: string) => plan.assembled[s][2]));
      expect(pile.groundZ, id).toBe(lowest);
      for (const s of plan.order) expect(pile.boxes[s][2], `${id}/${s}`).toBeCloseTo(pile.groundZ, 9);
    }
  });

  it("never touches the model: no pile box comes within the gap of any assembled part, the base included", () => {
    for (const { id, plan, pile } of plans) {
      for (const s of plan.order) for (const o of plan.order) {
        expect(overlap(pile.boxes[s], plan.assembled[o], PILE_GAP - 1e-6), `${id}: pile of ${s} vs assembled ${o}`).toBe(false);
      }
      const maxX = Math.max(...plan.order.map((s: string) => plan.assembled[s][3]));
      expect(pile.region[0], id).toBeGreaterThanOrEqual(maxX + PILE_GAP - 1e-6);
    }
  });

  it("keeps every part in the pile at least the gap from every other", () => {
    for (const { id, plan, pile } of plans) {
      for (let i = 0; i < plan.order.length; i++) for (let j = i + 1; j < plan.order.length; j++) {
        expect(overlap(pile.boxes[plan.order[i]], pile.boxes[plan.order[j]], PILE_GAP - 1e-6), `${id}: ${plan.order[i]} vs ${plan.order[j]}`).toBe(false);
      }
    }
  });

  it("keeps each part's shape: the pile box is the assembled box moved, never resized or turned", () => {
    for (const { plan, pile } of plans) {
      for (const s of plan.order) {
        const a = plan.assembled[s], b = pile.boxes[s];
        for (const k of [0, 1, 2]) expect(b[3 + k] - b[k]).toBeCloseTo(a[3 + k] - a[k], 9);
        expect(shift(a, pile.offsets[s])).toEqual(b);
      }
    }
  });

  it("puts the pile beside the model, not far from it: its near edge is exactly one gap from the model and it is centred across it", () => {
    for (const { id, plan, pile } of plans) {
      const maxX = Math.max(...plan.order.map((s: string) => plan.assembled[s][3]));
      const minY = Math.min(...plan.order.map((s: string) => plan.assembled[s][1])), maxY = Math.max(...plan.order.map((s: string) => plan.assembled[s][4]));
      expect(pile.region[0], id).toBeCloseTo(maxX + PILE_GAP, 6);
      expect((pile.region[1] + pile.region[4]) / 2, id).toBeCloseTo((minY + maxY) / 2, 6);
    }
  });

  it("gives every part a route from its place in the pile to its seat: it starts in the pile and ends exactly seated", () => {
    for (const { id, plan, pile } of plans) {
      for (const s of plan.order) {
        const r = pile.routes[s] as number[][];
        expect(r[0], `${id}/${s}`).toEqual(pile.offsets[s]);
        expect(r.at(-1), `${id}/${s}`).toEqual([0, 0, 0]);
        expect(routePoint(r, 0)).toEqual(pile.offsets[s]);
        expect(routePoint(r, 1)).toEqual([0, 0, 0]);
      }
    }
  });

  it("goes only along the axes, and is picked up before it travels: every leg changes one coordinate, the first is straight up", () => {
    for (const { id, plan, pile } of plans) {
      for (const s of plan.order) {
        const r = pile.routes[s] as number[][];
        for (let k = 1; k < r.length; k++) {
          const moved = [0, 1, 2].filter((c) => r[k]![c] !== r[k - 1]![c]);
          expect(moved.length, `${id}/${s} leg ${k}`).toBe(1);
        }
        if (r.length > 2) {
          expect(r[1]![0]).toBe(r[0]![0]);
          expect(r[1]![1]).toBe(r[0]![1]);
          expect(r[1]![2]).toBeGreaterThanOrEqual(r[0]![2]!);
        }
      }
    }
  });

  it("carries every part clear of everything: no leg before the final slide sweeps through a seated part or a part still lying in the pile (330 flights, checked independently)", () => {
    let flights = 0;
    for (const { id, plan, pile } of plans) {
      plan.order.forEach((s: string, i: number) => {
        flights++;
        expect(pile.clear[s], `${id}/${s} flagged clear`).toBe(true);
        const others = plan.order.filter((o: string) => o !== s).map((o: string) => (plan.order.indexOf(o) < i ? plan.assembled[o] : pile.boxes[o]));
        const r = pile.routes[s] as number[][];
        for (let k = 1; k < r.length - 1; k++) {       // the last leg is the plan's own approach slide, proved by approachProblems
          const swept = hull(shift(plan.assembled[s], r[k - 1]!), shift(plan.assembled[s], r[k]!));
          for (const o of others) expect(overlap(swept, o), `${id}/${s} leg ${k}`).toBe(false);
        }
      });
    }
    expect(flights).toBe(330);
  });

  it("is carried above the model: while crossing, a part's lowest point is at least the lift above the model's highest point", () => {
    for (const { id, plan, pile } of plans) {
      const top = Math.max(...plan.order.map((s: string) => plan.assembled[s][5]));
      for (const s of plan.order) {
        const r = pile.routes[s] as number[][];
        if (r.length < 3) continue;
        const crossing = r[1]!; // the top of the lift
        expect(plan.assembled[s][2] + crossing[2]!, `${id}/${s}`).toBeGreaterThanOrEqual(top + PILE_LIFT - 1e-6);
      }
    }
  });
});

describe("routePoint", () => {
  const r = [[0, 0, 0], [0, 0, 10], [30, 0, 10], [30, 0, 0]];
  it("walks by distance: halfway is halfway by length, whatever the legs", () => {
    expect(routeLength(r)).toBe(50);
    expect(routePoint(r, 0.5)).toEqual([15, 0, 10]);
    expect(routePoint(r, 0.2)).toEqual([0, 0, 10]);
    expect(routePoint(r, 0.8)).toEqual([30, 0, 10]);
  });
  it("never leaves the route, and clamps outside 0 to 1", () => {
    expect(routePoint(r, -3)).toEqual([0, 0, 0]);
    expect(routePoint(r, 7)).toEqual([30, 0, 0]);
    expect(routePoint([[5, 5, 5]], 0.4)).toEqual([5, 5, 5]);
  });
  it("returns a copy, so a caller cannot change the route", () => {
    const p = routePoint(r, 0);
    p[0] = 99;
    expect(r[0]![0]).toBe(0);
  });
  it("is continuous: a hundred steps along the route never jump more than the steps' length", () => {
    let last = routePoint(r, 0);
    for (let i = 1; i <= 100; i++) {
      const q = routePoint(r, i / 100);
      expect(Math.hypot(q[0]! - last[0]!, q[1]! - last[1]!, q[2]! - last[2]!)).toBeLessThanOrEqual(50 / 100 + 1e-9);
      last = q;
    }
  });
});

describe("pileFrame", () => {
  it("starts with every part in the pile and ends with every part seated", () => {
    for (const n of [1, 3, 10]) {
      expect(pileFrame(0, n).every((f: { state: string; u: number }) => f.state === "pile" && f.u === 0)).toBe(true);
      expect(pileFrame(n, n).every((f: { state: string; u: number }) => f.state === "seated" && f.u === 1)).toBe(true);
    }
  });
  it("between those has exactly the current step's part in flight, the earlier ones seated and the later ones in the pile", () => {
    const n = 10;
    for (let i = 0; i < n; i++) {
      for (const f of [0.05, 0.3, 0.5, 0.74]) {
        const frames = pileFrame(i + f, n);
        frames.forEach((x: { state: string; u: number }, k: number) => {
          if (k < i) expect(x.state).toBe("seated");
          else if (k === i) { expect(x.state).toBe("flying"); expect(x.u).toBeGreaterThan(0); expect(x.u).toBeLessThan(1); }
          else expect(x.state).toBe("pile");
        });
      }
      // the last quarter of a slot is rest: the part has arrived and sits seated, the next has not started
      const rest = pileFrame(i + 0.9, n);
      expect(rest[i].state).toBe("seated");
      if (i + 1 < n) expect(rest[i + 1].state).toBe("pile");
    }
  });
  it("carries a part further the later it is in its slot, and never backwards", () => {
    let last = 0;
    for (let k = 1; k <= 100; k++) {
      const u = pileFrame(2 + k / 100, 5)[2].u;
      expect(u).toBeGreaterThanOrEqual(last);
      last = u;
    }
    expect(last).toBe(1);
  });
  it("hides nothing, ever (the older buildFrame hides later parts; this one does not)", () => {
    for (const p of [0, 0.5, 3.3, 9.9, 10]) expect(pileFrame(p, 10).every((f: { state: string }) => ["pile", "flying", "seated"].includes(f.state))).toBe(true);
    expect(buildFrame(0, 10).every((f: { visible: boolean }) => !f.visible)).toBe(true); // the older timeline is untouched
  });
});

describe("pilePlan on small made-up plans", () => {
  const plan = (boxes: Record<string, Box>) => ({ order: Object.keys(boxes), assembled: boxes, approach: Object.fromEntries(Object.keys(boxes).map((k) => [k, [0, 0, 30]])) });
  it("works for a single part (the base alone): it just lies beside where it will stand", () => {
    const p = pilePlan(plan({ a: [0, 0, 0, 40, 20, 10] }));
    expect(p.boxes.a[0]).toBeCloseTo(40 + PILE_GAP, 9);
    expect(p.boxes.a[2]).toBe(0);
    expect(p.routes.a.at(-1)).toEqual([0, 0, 0]);
  });
  it("starts a new row when a row is full, in step order, and keeps rows apart by the gap", () => {
    const boxes: Record<string, Box> = {};
    for (let i = 0; i < 9; i++) boxes[`p${i}`] = [i * 100, 0, 0, i * 100 + 30, 30, 10];
    const p = pilePlan(plan(boxes));
    const ys = [...new Set(Object.values(p.boxes).map((b) => (b as Box)[1]!.toFixed(6)))];
    expect(ys.length).toBeGreaterThan(1);
    expect(p.boxes.p0[0]).toBeLessThan(p.boxes.p1[0]);
    for (const a of Object.keys(boxes)) for (const b of Object.keys(boxes)) if (a < b) expect(overlap(p.boxes[a], p.boxes[b], PILE_GAP - 1e-6)).toBe(false);
  });
  it("puts a part that is below the ground line back ON it, whatever height it had", () => {
    const p = pilePlan(plan({ base: [0, 0, -5, 50, 50, 20], top: [10, 10, 20, 40, 40, 35] }));
    expect(p.groundZ).toBe(-5);
    expect(p.boxes.top[2]).toBe(-5);
    expect(p.boxes.base[2]).toBe(-5);
  });
  it("falls back to a flagged route rather than failing when no crossing is clear", () => {
    // a part that must cross a wall of parts taller than any lift would clear is still given a route; `clear` says whether it was proved
    const p = pilePlan(plan({ base: [0, 0, 0, 20, 20, 10], b: [30, 0, 0, 50, 20, 10] }), { lift: 0 });
    for (const id of ["base", "b"]) expect(p.routes[id].length).toBeGreaterThanOrEqual(2);
    expect(typeof p.clear.b).toBe("boolean");
  });
});
