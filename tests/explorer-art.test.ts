import { describe, expect, it } from "vitest";
import { buildMapCards } from "../src/lib/mapCards";
import {
  buildExplorerGraph,
  defaultMapView,
  FRONTIER_BRANCHES,
  FRONTIER_MAX_DEPTH,
  explorerRoute,
  TRAIL_DEFAULT_FROM_BAND,
  type ExplorerGraph,
} from "../src/lib/explorerMap";
import {
  DECOR_NODE_CLEAR,
  DECOR_ROAD_CLEAR,
  fogPuffs,
  roadCurve,
  scatterDecor,
  UNIT,
  worldFrame,
} from "../src/lib/explorerArt";
import { emptyProgression } from "../src/lib/progression";

const graphFor = (ageBand: number | null): ExplorerGraph =>
  buildExplorerGraph({
    cards: buildMapCards({
      ageBand,
      prog: emptyProgression(),
      found: new Set<string>(),
      missionsDone: new Set<string>(),
    }),
  });

const BANDS: Array<number | null> = [null, 0, 1, 2, 3, 4, 5];

/** Nodes and sampled road points in world px, the way the component draws. */
function worldOf(g: ExplorerGraph) {
  const frame = worldFrame(g.bounds);
  const pos = new Map(g.nodes.map((n) => [n.id, frame.at(n)]));
  const nodes = g.nodes.map((n) => ({ id: n.id, theme: n.theme, ...pos.get(n.id)! }));
  const roads = g.edges.map((e) => ({
    a: e.a,
    b: e.b,
    curve: roadCurve(pos.get(e.a)!, pos.get(e.b)!, e.a, e.b),
  }));
  return { frame, nodes, roads };
}

describe("default map view by age", () => {
  it("carousel for 2-6 and an unset age, trail map from the 7-9 band up", () => {
    expect(TRAIL_DEFAULT_FROM_BAND).toBe(3);
    for (const band of [null, undefined, 0, 1, 2]) {
      expect(defaultMapView(band), String(band)).toBe("cards");
    }
    for (const band of [3, 4, 5]) {
      expect(defaultMapView(band), String(band)).toBe("trail");
    }
  });
});

describe("explorerRoute", () => {
  it("walks the roads, ends included, and is empty-safe", () => {
    const g = graphFor(1);
    expect(explorerRoute(g, "room", "lab1")).toEqual(["room", "garden", "lab1"]);
    expect(explorerRoute(g, "garden", "garden")).toEqual(["garden"]);
    expect(explorerRoute(g, "room", "nope")).toBeNull();
    expect(explorerRoute(g, "nope", "room")).toBeNull();
  });

  it("every place can be reached from home in every age band", () => {
    for (const band of BANDS) {
      const g = graphFor(band);
      for (const n of g.nodes) {
        const route = explorerRoute(g, "room", n.id);
        expect(route, `band ${band}: room to ${n.id}`).not.toBeNull();
        // A route is a chain of real roads.
        for (let i = 1; i < route!.length; i++) {
          const a = route![i - 1]!;
          const b = route![i]!;
          expect(
            g.edges.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a)),
            `band ${band}: ${a}-${b} is a road`,
          ).toBe(true);
        }
      }
    }
  });
});

describe("winding roads", () => {
  const A = { x: 100, y: 100 };
  const B = { x: 400, y: 340 };

  it("run from a to b, the same curve in both directions", () => {
    const fwd = roadCurve(A, B, "alpha", "beta");
    const back = roadCurve(B, A, "beta", "alpha");
    expect(fwd.points[0]).toEqual(A);
    expect(fwd.points[8]).toEqual(B);
    expect(fwd.d.startsWith(`M ${A.x.toFixed(1)} ${A.y.toFixed(1)}`)).toBe(true);
    expect(back.points[0]).toEqual(B);
    expect([...back.points].reverse()).toEqual(fwd.points);
  });

  it("bend gently: never far from the straight line", () => {
    const len = Math.hypot(B.x - A.x, B.y - A.y);
    for (const id of ["a", "bb", "ccc", "dddd", "room|lab6"]) {
      for (const p of roadCurve(A, B, id, "z").points) {
        const dist = Math.abs((B.x - A.x) * (A.y - p.y) - (A.x - p.x) * (B.y - A.y)) / len;
        expect(dist, id).toBeLessThanOrEqual(0.09 * len);
      }
    }
  });

  it("no winding road runs under a node it does not join, in any age band", () => {
    const CLEAR = 0.3 * UNIT; // a node disc is ~0.27 UNIT wide; keep a gap
    for (const band of BANDS) {
      const { nodes, roads } = worldOf(graphFor(band));
      for (const r of roads) {
        for (const n of nodes) {
          if (n.id === r.a || n.id === r.b) continue;
          for (const p of r.curve.points) {
            expect(
              Math.hypot(p.x - n.x, p.y - n.y),
              `band ${band}: ${r.a}-${r.b} passes ${n.id}`,
            ).toBeGreaterThanOrEqual(CLEAR);
          }
        }
      }
    }
  });
});

describe("winding roads with every secret exit open and every branch grown", () => {
  it("still never run under a node they skip, in any age band", () => {
    const CLEAR = 0.3 * UNIT;
    const walked = new Set(FRONTIER_BRANCHES.map((b) => `frontier:${b.from}:${FRONTIER_MAX_DEPTH}`));
    for (const band of BANDS) {
      const g = buildExplorerGraph({
        cards: buildMapCards({ ageBand: band, prog: emptyProgression(), found: new Set(), missionsDone: new Set() }),
        visited: walked,
        openAll: true,
      });
      const { nodes, roads } = worldOf(g);
      for (const r of roads) {
        for (const n of nodes) {
          if (n.id === r.a || n.id === r.b) continue;
          for (const p of r.curve.points) {
            expect(Math.hypot(p.x - n.x, p.y - n.y), `band ${band}: ${r.a}-${r.b} passes ${n.id}`).toBeGreaterThanOrEqual(CLEAR);
          }
        }
      }
    }
  });
});

describe("scenery", () => {
  it("is deterministic and plentiful on the open map", () => {
    const { frame, nodes, roads } = worldOf(graphFor(3));
    const pts = roads.map((r) => r.curve.points);
    const a = scatterDecor(nodes, pts, frame);
    const b = scatterDecor(nodes, pts, frame);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThanOrEqual(40);
    // Back to front.
    for (let i = 1; i < a.length; i++) expect(a[i]!.y).toBeGreaterThanOrEqual(a[i - 1]!.y);
  });

  it("never sits on a node or a road, in any age band", () => {
    for (const band of BANDS) {
      const { frame, nodes, roads } = worldOf(graphFor(band));
      const pts = roads.map((r) => r.curve.points);
      for (const d of scatterDecor(nodes, pts, frame)) {
        for (const n of nodes) {
          expect(Math.hypot(d.x - n.x, d.y - n.y), `band ${band}: ${d.kind} on ${n.id}`).toBeGreaterThanOrEqual(DECOR_NODE_CLEAR - 0.001);
        }
        for (const p of pts.flat()) {
          expect(Math.hypot(d.x - p.x, d.y - p.y), `band ${band}: ${d.kind} on a road`).toBeGreaterThanOrEqual(DECOR_ROAD_CLEAR - 0.001);
        }
        expect(d.s).toBeGreaterThanOrEqual(0.8);
        expect(d.s).toBeLessThanOrEqual(1.26);
      }
    }
  });

  it("the fog bank covers the whole map, deterministically", () => {
    const { frame } = worldOf(graphFor(1));
    const puffs = fogPuffs(frame);
    expect(puffs).toEqual(fogPuffs(frame));
    expect(Math.min(...puffs.map((p) => p.x))).toBeLessThan(0);
    expect(Math.max(...puffs.map((p) => p.x))).toBeGreaterThan(frame.width);
    expect(Math.max(...puffs.map((p) => p.y))).toBeGreaterThan(frame.height);
  });
});
