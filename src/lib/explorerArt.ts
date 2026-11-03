// Geometry for the overworld look of the explorer map (explorer-map-spec,
// "Overworld presentation"). Pure and deterministic: the same graph always
// gives the same coastline, winding roads, and scenery, so the map never
// reshuffles between opens. No React and no DOM in here, so it unit-tests.
import { fnv1a, type ExplorerGraph } from "./explorerMap";

export interface Pt {
  x: number;
  y: number;
}

/** World pixels per grid unit. */
export const UNIT = 120;
/** Ocean kept around the outermost node, in grid units. */
export const MARGIN = 2.4;

export interface WorldFrame {
  width: number;
  height: number;
  at: (n: { x: number; y: number }) => Pt;
}

export function worldFrame(bounds: ExplorerGraph["bounds"]): WorldFrame {
  return {
    width: (bounds.maxX - bounds.minX + MARGIN * 2) * UNIT,
    height: (bounds.maxY - bounds.minY + MARGIN * 2) * UNIT,
    at: (n) => ({
      x: (n.x - bounds.minX + MARGIN) * UNIT,
      y: (n.y - bounds.minY + MARGIN) * UNIT,
    }),
  };
}

export interface RoadCurve {
  /** SVG path data, drawn from a to b. */
  d: string;
  /** Samples along the curve from a to b, a first, b last (9 points). */
  points: Pt[];
}

/**
 * A road that winds a little. The bend depends only on the two node ids
 * (not their order), so a road drawn a-to-b and the hop b-to-a agree.
 */
export function roadCurve(a: Pt, b: Pt, idA: string, idB: string): RoadCurve {
  const flip = idA > idB;
  const p = flip ? b : a;
  const q = flip ? a : b;
  const lo = flip ? idB : idA;
  const hi = flip ? idA : idB;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const len = Math.hypot(dx, dy) || 1;
  const bend = ((fnv1a(`${lo}|${hi}`) % 2001) / 1000 - 1) * 0.15 * len;
  const c = {
    x: (p.x + q.x) / 2 + (-dy / len) * bend,
    y: (p.y + q.y) / 2 + (dx / len) * bend,
  };
  const at = (t: number): Pt => ({
    x: (1 - t) * (1 - t) * p.x + 2 * (1 - t) * t * c.x + t * t * q.x,
    y: (1 - t) * (1 - t) * p.y + 2 * (1 - t) * t * c.y + t * t * q.y,
  });
  const samples = Array.from({ length: 9 }, (_, i) => at(i / 8));
  const points = flip ? samples.reverse() : samples;
  const start = points[0]!;
  const end = points[8]!;
  // A quadratic keeps its control point when reversed, so `d` runs a to b.
  return {
    d: `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} Q ${c.x.toFixed(1)} ${c.y.toFixed(1)} ${end.x.toFixed(1)} ${end.y.toFixed(1)}`,
    points,
  };
}

export type DecorKind =
  | "tree"
  | "pine"
  | "palm"
  | "hill"
  | "rock"
  | "flower"
  | "peak"
  | "puff"
  | "junk"
  | "block";

export interface Decor {
  kind: DecorKind;
  x: number;
  y: number;
  /** 0.8 to 1.25 */
  s: number;
}

/** Scenery per world theme, in the order the picker walks it. */
const DECOR_BY_THEME: Record<string, readonly DecorKind[]> = {
  garden: ["tree", "tree", "hill", "flower", "flower", "tree"],
  beach: ["palm", "palm", "rock", "flower"],
  junk: ["junk", "rock", "junk", "rock"],
  snow: ["pine", "pine", "peak", "rock"],
  sky: ["puff", "puff", "tree", "flower"],
  room: ["block", "block", "flower", "hill"],
};

/** Keep scenery this far (px) from any node centre and from any road sample. */
export const DECOR_NODE_CLEAR = 0.62 * UNIT;
export const DECOR_ROAD_CLEAR = 0.36 * UNIT;

export interface ArtNode extends Pt {
  id: string;
  theme: string;
}

/** A plain bucket grid, so "what is near here" stays cheap on a big map. */
class Grid<T extends Pt> {
  private cells = new Map<string, T[]>();
  constructor(private size: number) {}
  private key(cx: number, cy: number): string {
    return `${cx},${cy}`;
  }
  add(p: T): void {
    const k = this.key(Math.floor(p.x / this.size), Math.floor(p.y / this.size));
    (this.cells.get(k) ?? this.cells.set(k, []).get(k)!).push(p);
  }
  /** Everything in the buckets that overlap the square of radius r around x,y. */
  near(x: number, y: number, r: number): T[] {
    const out: T[] = [];
    const x0 = Math.floor((x - r) / this.size);
    const x1 = Math.floor((x + r) / this.size);
    const y0 = Math.floor((y - r) / this.size);
    const y1 = Math.floor((y + r) / this.size);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const cell = this.cells.get(this.key(cx, cy));
        if (cell) out.push(...cell);
      }
    }
    return out;
  }
}

/**
 * Scenery on the land around the nodes and roads, never on a node or a
 * road. A jittered grid, thinned so no two pieces crowd, nearest node's
 * theme picks the kind. Sorted back to front (by y) for painter's order.
 */
export function scatterDecor(
  nodes: readonly ArtNode[],
  roads: ReadonlyArray<readonly Pt[]>,
  frame: Pick<WorldFrame, "width" | "height">,
): Decor[] {
  const STEP = 0.5 * UNIT;
  const LAND_NODE = 1.0 * UNIT;
  const LAND_ROAD = 0.6 * UNIT;
  const SPACING = 0.42 * UNIT;
  // The nearest node that can matter is within a road's reach of a land point.
  const NODE_REACH = 3 * UNIT;
  const nodeGrid = new Grid<ArtNode>(UNIT);
  for (const n of nodes) nodeGrid.add(n);
  const roadGrid = new Grid<Pt>(0.5 * UNIT);
  for (const r of roads) for (const p of r) roadGrid.add(p);
  const placed = new Grid<Decor>(SPACING);
  const out: Decor[] = [];
  for (let gy = STEP / 2; gy < frame.height; gy += STEP) {
    for (let gx = STEP / 2; gx < frame.width; gx += STEP) {
      const h = fnv1a(`${Math.round(gx)},${Math.round(gy)}`);
      const x = gx + ((h % 61) - 30) * 0.7;
      const y = gy + (((h >>> 8) % 61) - 30) * 0.7;
      let nearest: ArtNode | null = null;
      let nd = Infinity;
      for (const n of nodeGrid.near(x, y, NODE_REACH)) {
        const d = Math.hypot(n.x - x, n.y - y);
        if (d < nd) {
          nd = d;
          nearest = n;
        }
      }
      if (!nearest || nd < DECOR_NODE_CLEAR) continue;
      let rd = Infinity;
      for (const r of roadGrid.near(x, y, LAND_ROAD)) {
        rd = Math.min(rd, Math.hypot(r.x - x, r.y - y));
      }
      if (rd < DECOR_ROAD_CLEAR) continue;
      if (nd > LAND_NODE && rd > LAND_ROAD) continue;
      if (placed.near(x, y, SPACING).some((o) => Math.hypot(o.x - x, o.y - y) < SPACING)) continue;
      const pool = DECOR_BY_THEME[nearest.theme] ?? DECOR_BY_THEME.garden!;
      const item: Decor = {
        kind: pool[(h >>> 16) % pool.length]!,
        x,
        y,
        s: 0.8 + ((h >>> 4) % 46) / 100,
      };
      out.push(item);
      placed.add(item);
    }
  }
  return out.sort((a, b) => a.y - b.y);
}

/** Soft cloud puffs that make up the fog bank, spread over the whole map. */
export interface Puff {
  x: number;
  y: number;
  r: number;
}

/** Most puffs the cloud bank draws; a bigger world gets bigger puffs, not more. */
export const FOG_PUFF_BUDGET = 1200;

export function fogPuffs(frame: Pick<WorldFrame, "width" | "height">): Puff[] {
  const base = 0.9 * UNIT;
  const area = (frame.width + base * 2) * (frame.height + base * 2);
  const STEP = Math.max(base, Math.sqrt(area / FOG_PUFF_BUDGET));
  const scale = STEP / base;
  const out: Puff[] = [];
  for (let gy = -STEP / 2; gy < frame.height + STEP; gy += STEP) {
    for (let gx = -STEP / 2; gx < frame.width + STEP; gx += STEP) {
      const h = fnv1a(`puff:${Math.round(gx)},${Math.round(gy)}`);
      out.push({
        x: gx + ((h % 71) - 35) * scale,
        y: gy + (((h >>> 8) % 71) - 35) * scale,
        r: (34 + ((h >>> 16) % 30)) * scale,
      });
    }
  }
  return out;
}
