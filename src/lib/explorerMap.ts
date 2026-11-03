// Explorer trail map: a branching, old-school overworld graph beside the
// Map carousel (explorer-map-spec). Pure derivation from the same MapCard
// list the carousel uses, so progress, pips, and the suggested place can
// never disagree between the two views. Authored districts are fixed;
// seeded frontier nodes are generated off branch ends. Gentle fog only
// changes how a node is drawn: travel is never locked.
import type { CardKind, MapCard } from "./mapCards";

export type ExplorerFog = "revealed" | "next" | "clouded";
export type ExplorerKind = CardKind | "frontier";

export interface ExplorerNode {
  id: string;
  kind: ExplorerKind;
  label: string;
  theme: string;
  /** Grid units: x east, y south. The component scales them. */
  x: number;
  y: number;
  done: number;
  total: number;
  complete: boolean;
  suggested: boolean;
  fog: ExplorerFog;
  /** Always false: gentle fog never gates travel. */
  locked: false;
  /** The carousel card this node was derived from (absent for frontier). */
  card?: MapCard;
  /** Frontier only: level-kit seed code to hand to playSeed. */
  seedCode?: string;
  /** District (world id) whose structured area holds this node, if any. */
  district?: string;
}

export interface ExplorerEdge {
  a: string;
  b: string;
  fog: ExplorerFog;
}

export interface ExplorerDistrict {
  id: string;
  label: string;
  theme: string;
  memberIds: string[];
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  fog: ExplorerFog;
}

export interface ExplorerGraph {
  nodes: ExplorerNode[];
  edges: ExplorerEdge[];
  districts: ExplorerDistrict[];
  suggestedId: string | null;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface ExplorerInput {
  cards: MapCard[];
  /** Node ids walked to on the trail map (progression explorerVisited). */
  visited?: ReadonlySet<string>;
  /** World the child is standing in now (revealed, guide anchor). */
  currentId?: string | null;
  /** Demo/sandbox: the whole map in colour. */
  openAll?: boolean;
  /** Generated paths kept ahead of the furthest one walked on each branch
   *  (default FRONTIER_AHEAD). A branch grows as the child walks it. */
  frontierDepth?: number;
}

/** Authored layout. Home (Toy Room) sits at the centre; worlds ring it. */
export const EXPLORER_POS: Record<string, [number, number]> = {
  room: [0, 0],
  garden: [-3, 1],
  beach: [0, 3],
  junk: [3, 1],
  snow: [3, -2],
  sky: [0, -3],
  lab1: [-4, 1],
  lab2: [4, 2],
  lab3: [1, 4],
  lab4: [4, -3],
  lab5: [1, -4],
  lab6: [1, -1],
  // little/daily sit inside the ring, clear of the garden-beach and
  // beach-junk roads (a road must never run under a node it skips).
  little: [-1, 1],
  early: [-2, -1],
  daily: [1, 1],
  bridges: [-5, 0],
  gears: [5, 3],
  circuits: [5, -4],
  code: [2, -5],
  ask: [-1, -2],
};

/** Authored roads: the town ring, home spokes, lab doors, ladder trails. */
export const EXPLORER_EDGES: ReadonlyArray<readonly [string, string]> = [
  // Town ring (catalog TOWN_RING order: room-garden-beach-junk-snow-sky).
  ["room", "garden"],
  ["garden", "beach"],
  ["beach", "junk"],
  ["junk", "snow"],
  ["snow", "sky"],
  ["sky", "room"],
  // Home spokes.
  ["room", "beach"],
  ["room", "junk"],
  // Labs are buildings inside their district.
  ["garden", "lab1"],
  ["junk", "lab2"],
  ["beach", "lab3"],
  ["snow", "lab4"],
  ["sky", "lab5"],
  ["room", "lab6"],
  // Learning ladders trail off their lab or home.
  ["lab1", "bridges"],
  ["lab2", "gears"],
  ["lab4", "circuits"],
  ["lab5", "code"],
  ["room", "little"],
  ["room", "early"],
  ["room", "daily"],
  ["daily", "beach"],
  ["little", "garden"],
  ["early", "sky"],
  ["room", "ask"],
];

/** Structured areas: each world district holds its lab and ladder trail. */
export const EXPLORER_DISTRICTS: ReadonlyArray<{
  id: string;
  memberIds: readonly string[];
}> = [
  { id: "room", memberIds: ["room", "lab6", "little", "early", "daily"] },
  { id: "garden", memberIds: ["garden", "lab1", "bridges"] },
  { id: "beach", memberIds: ["beach", "lab3"] },
  { id: "junk", memberIds: ["junk", "lab2", "gears"] },
  { id: "snow", memberIds: ["snow", "lab4", "circuits"] },
  { id: "sky", memberIds: ["sky", "lab5", "code"] },
];

/**
 * Frontier branches grow off authored branch ends, heading outward.
 * Direction is an octant [dx, dy] with y south. A branch is generated
 * only when its leaf is on the map (age-suited ladders, always-on labs).
 */
export const FRONTIER_BRANCHES: ReadonlyArray<{
  from: string;
  dir: readonly [number, number];
}> = [
  { from: "bridges", dir: [-1, 0] },
  { from: "early", dir: [-1, -1] },
  { from: "code", dir: [0, -1] },
  { from: "circuits", dir: [1, 0] },
  { from: "gears", dir: [0, 1] },
  { from: "lab3", dir: [0, 1] },
];

const OCTANTS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

export type MapView = "cards" | "trail";

/** The trail map is the default view from this age band up. Bands are 2-3,
 *  3-4, 5-6, 7-9, 10-12, 13+ and cannot split at 8, so 7-9 (band 3) counts
 *  as "8 plus". Younger players, and an unset age, open the carousel. */
export const TRAIL_DEFAULT_FROM_BAND = 3;

/** Which Map view opens first. Either is one tap away from the other. */
export function defaultMapView(ageBand: number | null | undefined): MapView {
  return typeof ageBand === "number" && ageBand >= TRAIL_DEFAULT_FROM_BAND
    ? "trail"
    : "cards";
}

export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Seed code for a frontier node id. Same base-36 shape the level kit's
 * seedToCode makes, so playSeed(code) composes this exact level.
 */
export function frontierSeedCode(nodeId: string): string {
  const seed = (fnv1a(nodeId) % 0xffffff) + 1;
  return seed.toString(36).toUpperCase().padStart(4, "0");
}

function octantIndex(dir: readonly [number, number]): number {
  const at = OCTANTS.findIndex((o) => o[0] === dir[0] && o[1] === dir[1]);
  return at >= 0 ? at : 0;
}

/** A branch never grows past this many generated paths (6 branches, 72
 *  levels in all). Not a design limit: a safety valve on the size of the
 *  world the browser has to draw. Measured smooth to 20 on a desktop; kept
 *  at 12 until it has been tried on a real phone. */
export const FRONTIER_MAX_DEPTH = 12;
/** Generated paths kept ahead of the furthest one the child has walked. */
export const FRONTIER_AHEAD = 2;

const FRONTIER_ID = /^frontier:([^:]+):(\d+)$/;

/** Furthest generated path walked to on each branch (absent = none). */
function walkedDepths(visited: ReadonlySet<string>): Map<string, number> {
  const out = new Map<string, number>();
  for (const id of visited) {
    const m = FRONTIER_ID.exec(id);
    if (!m) continue;
    const d = Number(m[2]);
    if (d > (out.get(m[1]!) ?? 0)) out.set(m[1]!, d);
  }
  return out;
}

interface Cell {
  x: number;
  y: number;
}

const cross = (o: Cell, a: Cell, b: Cell): number =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Do two segments properly cross? (Touching at a shared end does not count.) */
function segmentsCross(a: Cell, b: Cell, c: Cell, d: Cell): boolean {
  const d1 = cross(a, b, c);
  const d2 = cross(a, b, d);
  const d3 = cross(c, d, a);
  const d4 = cross(c, d, b);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function distToSegment(p: Cell, a: Cell, b: Cell): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2));
  return Math.hypot(a.x + t * vx - p.x, a.y + t * vy - p.y);
}

/** How close (grid units) a new path may sit to a place or road it skips. */
const FRONTIER_CLEAR = 0.7;

interface Placed {
  id: string;
  x: number;
  y: number;
  prevId: string;
}

/**
 * Every branch's full chain, laid out once, a layer at a time in a fixed
 * branch order. Because layer d only looks at layers before it (and at
 * earlier branches in the same layer), a path's position never depends on
 * how far any branch has been walked: nodes that exist never move when
 * another branch grows. A step may bend one octant either side of the
 * branch's own heading, so chains wind but keep heading outward; a step
 * that would cross a road, land on a place, or crowd one ends the chain.
 */
function frontierLayout(authored: ReadonlyMap<string, ExplorerNode>): Map<string, Placed[]> {
  const places: Array<Cell & { id: string }> = [...authored.values()].map((n) => ({ id: n.id, x: n.x, y: n.y }));
  const roads: Array<{ a: string; b: string; p: Cell; q: Cell }> = [];
  for (const [a, b] of EXPLORER_EDGES) {
    const na = authored.get(a);
    const nb = authored.get(b);
    if (na && nb) roads.push({ a, b, p: na, q: nb });
  }
  const live = FRONTIER_BRANCHES.filter((br) => authored.has(br.from));
  const chains = new Map<string, Placed[]>(live.map((br) => [br.from, []]));
  const head = new Map<string, Cell & { id: string }>(
    live.map((br) => {
      const leaf = authored.get(br.from)!;
      return [br.from, { id: leaf.id, x: leaf.x, y: leaf.y }];
    }),
  );
  const fits = (from: Cell & { id: string }, to: Cell): boolean => {
    for (const pl of places) {
      if (Math.hypot(pl.x - to.x, pl.y - to.y) < FRONTIER_CLEAR) return false;
      if (pl.id !== from.id && distToSegment(pl, from, to) < FRONTIER_CLEAR) return false;
    }
    for (const r of roads) {
      if (segmentsCross(from, to, r.p, r.q)) return false;
      if (r.a !== from.id && r.b !== from.id && distToSegment(to, r.p, r.q) < FRONTIER_CLEAR) {
        return false;
      }
    }
    return true;
  };
  for (let d = 1; d <= FRONTIER_MAX_DEPTH; d++) {
    for (const br of live) {
      const chain = chains.get(br.from)!;
      if (chain.length < d - 1) continue; // this chain already ended
      const from = head.get(br.from)!;
      const id = `frontier:${br.from}:${d}`;
      const base = octantIndex(br.dir);
      const bend = d === 1 ? 0 : (fnv1a(id) % 3) - 1;
      for (const turn of new Set([bend, 0, 1, -1])) {
        const step = OCTANTS[(base + turn + OCTANTS.length) % OCTANTS.length]!;
        const to = { x: from.x + step[0], y: from.y + step[1] };
        if (!fits(from, to)) continue;
        places.push({ id, ...to });
        roads.push({ a: from.id, b: id, p: from, q: to });
        chain.push({ id, ...to, prevId: from.id });
        head.set(br.from, { id, ...to });
        break;
      }
    }
  }
  return chains;
}

/** Generated frontier nodes + their roads, as far as each branch has been walked. */
function frontierNodes(
  authored: ReadonlyMap<string, ExplorerNode>,
  ahead: number,
  visited: ReadonlySet<string>,
): { nodes: ExplorerNode[]; edges: Array<readonly [string, string]> } {
  const extra = Math.max(0, Math.floor(ahead));
  const walked = walkedDepths(visited);
  const layout = frontierLayout(authored);
  const nodes: ExplorerNode[] = [];
  const edges: Array<readonly [string, string]> = [];
  for (const br of FRONTIER_BRANCHES) {
    const leaf = authored.get(br.from);
    const chain = layout.get(br.from);
    if (!leaf || !chain) continue;
    const depth = Math.min(FRONTIER_MAX_DEPTH, (walked.get(br.from) ?? 0) + extra);
    for (const p of chain.slice(0, depth)) {
      nodes.push({
        id: p.id,
        kind: "frontier",
        label: "New path",
        theme: leaf.theme,
        x: p.x,
        y: p.y,
        done: 0,
        total: 0,
        complete: false,
        suggested: false,
        fog: "clouded",
        locked: false,
        seedCode: frontierSeedCode(p.id),
      });
      edges.push([p.prevId, p.id]);
    }
  }
  return { nodes, edges };
}

const districtOf = (id: string): string | undefined =>
  EXPLORER_DISTRICTS.find((d) => d.memberIds.includes(id))?.id;

/**
 * The trail map for this player. Revealed: home, the current world, any
 * place with progress, and any walked-to node. Next: one road away from
 * revealed (plus the suggested card, so the guide is never under cloud).
 * Everything else is clouded but still tappable.
 */
export function buildExplorerGraph(input: ExplorerInput): ExplorerGraph {
  const visited = input.visited ?? new Set<string>();
  const authored = new Map<string, ExplorerNode>();
  for (const card of input.cards) {
    const pos = EXPLORER_POS[card.id];
    if (!pos) continue;
    authored.set(card.id, {
      id: card.id,
      kind: card.kind,
      label: card.label,
      theme: card.theme,
      x: pos[0],
      y: pos[1],
      done: card.done,
      total: card.total,
      complete: card.complete,
      suggested: card.suggested,
      fog: "clouded",
      locked: false,
      card,
      district: districtOf(card.id),
    });
  }
  const frontier = frontierNodes(authored, input.frontierDepth ?? FRONTIER_AHEAD, visited);
  const nodes = [...authored.values(), ...frontier.nodes];
  const byNodeId = new Map(nodes.map((n) => [n.id, n]));
  const roadPairs = [...EXPLORER_EDGES, ...frontier.edges].filter(
    ([a, b]) => byNodeId.has(a) && byNodeId.has(b),
  );

  const revealed = new Set<string>();
  for (const n of nodes) {
    if (
      input.openAll ||
      n.id === "room" ||
      n.id === input.currentId ||
      visited.has(n.id) ||
      n.done > 0
    ) {
      revealed.add(n.id);
    }
  }
  const next = new Set<string>();
  for (const [a, b] of roadPairs) {
    if (revealed.has(a) && !revealed.has(b)) next.add(b);
    if (revealed.has(b) && !revealed.has(a)) next.add(a);
  }
  const suggestedId = input.cards.find((c) => c.suggested)?.id ?? null;
  if (suggestedId && byNodeId.has(suggestedId) && !revealed.has(suggestedId)) {
    next.add(suggestedId);
  }
  for (const n of nodes) {
    n.fog = revealed.has(n.id) ? "revealed" : next.has(n.id) ? "next" : "clouded";
  }

  const edges: ExplorerEdge[] = roadPairs.map(([a, b]) => {
    const fa = byNodeId.get(a)!.fog;
    const fb = byNodeId.get(b)!.fog;
    const fog: ExplorerFog =
      fa === "revealed" && fb === "revealed"
        ? "revealed"
        : fa === "clouded" || fb === "clouded"
          ? "clouded"
          : "next";
    // A road out of a revealed node reads as the next stretch to walk.
    const walked: ExplorerFog =
      fog === "clouded" && (fa === "revealed" || fb === "revealed")
        ? "next"
        : fog;
    return { a, b, fog: walked };
  });

  const districts: ExplorerDistrict[] = [];
  for (const def of EXPLORER_DISTRICTS) {
    const members = def.memberIds
      .map((id) => byNodeId.get(id))
      .filter((n): n is ExplorerNode => n !== undefined);
    const world = byNodeId.get(def.id);
    if (!world || members.length === 0) continue;
    const xs = members.map((n) => n.x);
    const ys = members.map((n) => n.y);
    districts.push({
      id: def.id,
      label: world.label,
      theme: world.theme,
      memberIds: members.map((n) => n.id),
      cx: (Math.min(...xs) + Math.max(...xs)) / 2,
      cy: (Math.min(...ys) + Math.max(...ys)) / 2,
      rx: Math.max(0.85, (Math.max(...xs) - Math.min(...xs)) / 2 + 0.55),
      ry: Math.max(0.85, (Math.max(...ys) - Math.min(...ys)) / 2 + 0.55),
      fog: world.fog,
    });
  }

  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  return {
    nodes,
    edges,
    districts,
    suggestedId,
    bounds: {
      minX: Math.min(...xs, 0),
      minY: Math.min(...ys, 0),
      maxX: Math.max(...xs, 0),
      maxY: Math.max(...ys, 0),
    },
  };
}

/**
 * Shortest walk between two nodes along the roads (fog is drawing only, so
 * every road counts). Node ids from `from` to `to` inclusive, or null when
 * either is missing or they are not connected. Used to hop the guide along
 * the map instead of teleporting it.
 */
export function explorerRoute(
  graph: ExplorerGraph,
  from: string,
  to: string,
): string[] | null {
  const ids = new Set(graph.nodes.map((n) => n.id));
  if (!ids.has(from) || !ids.has(to)) return null;
  if (from === to) return [from];
  const next = new Map<string, string[]>();
  for (const e of graph.edges) {
    (next.get(e.a) ?? next.set(e.a, []).get(e.a)!).push(e.b);
    (next.get(e.b) ?? next.set(e.b, []).get(e.b)!).push(e.a);
  }
  const prev = new Map<string, string>([[from, from]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i]!;
    for (const n of next.get(at) ?? []) {
      if (prev.has(n)) continue;
      prev.set(n, at);
      if (n === to) {
        const path = [to];
        for (let c = to; c !== from; ) {
          c = prev.get(c)!;
          path.push(c);
        }
        return path.reverse();
      }
      queue.push(n);
    }
  }
  return null;
}

/**
 * What the child has already seen on the map, so only what is new animates
 * when it opens again. A place seen as a silhouette is its plain id; a place
 * seen in full colour also gets `id#`. Stored as `explorerSeen` in progression.
 */
export function seenEntries(graph: ExplorerGraph): string[] {
  const out: string[] = [];
  for (const n of graph.nodes) {
    if (n.fog === "clouded") continue;
    out.push(n.id);
    if (n.fog === "revealed") out.push(`${n.id}#`);
  }
  return out;
}

export type RoadDraw = "from-start" | "from-end" | "fade";

export interface ExplorerReveal {
  /** Places that were hidden and are now on the map. */
  appear: ReadonlySet<string>;
  /** Places that were a silhouette and are now in full colour. */
  clear: ReadonlySet<string>;
  /** Roads to draw in, keyed `lo|hi` (ids sorted), and how. */
  roads: ReadonlyMap<string, RoadDraw>;
  isEmpty: boolean;
}

const EMPTY_REVEAL: ExplorerReveal = {
  appear: new Set(),
  clear: new Set(),
  roads: new Map(),
  isEmpty: true,
};

export const roadKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * What is new since the child last looked. With no record at all (a first
 * open, or an existing player before this was tracked) nothing is new: the
 * map just records what is there, rather than replaying all of it.
 */
export function newlyShown(
  graph: ExplorerGraph,
  seen: ReadonlySet<string> | null | undefined,
): ExplorerReveal {
  if (!seen) return EMPTY_REVEAL;
  const appear = new Set<string>();
  const clear = new Set<string>();
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  for (const n of graph.nodes) {
    if (n.fog === "clouded") continue;
    if (!seen.has(n.id) && !seen.has(`${n.id}#`)) appear.add(n.id);
    else if (n.fog === "revealed" && !seen.has(`${n.id}#`)) clear.add(n.id);
  }
  const roads = new Map<string, RoadDraw>();
  for (const e of graph.edges) {
    if (e.fog === "clouded") continue;
    const [lo, hi] = e.a < e.b ? [e.a, e.b] : [e.b, e.a];
    if (!byId.has(lo) || !byId.has(hi)) continue;
    if (e.fog === "revealed") {
      const loSeen = seen.has(`${lo}#`);
      const hiSeen = seen.has(`${hi}#`);
      if (loSeen && hiSeen) continue;
      roads.set(roadKey(lo, hi), hiSeen && !loSeen ? "from-end" : "from-start");
    } else if (appear.has(lo) || appear.has(hi)) {
      roads.set(roadKey(lo, hi), "fade");
    }
  }
  const isEmpty = appear.size === 0 && clear.size === 0 && roads.size === 0;
  return { appear, clear, roads, isEmpty };
}

export type ExplorerDirection = "up" | "down" | "left" | "right";

const DIR_VECTOR: Record<ExplorerDirection, readonly [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

/** Best road out of a node in a compass direction (arrow-key travel). */
export function explorerNeighbor(
  graph: ExplorerGraph,
  nodeId: string,
  dir: ExplorerDirection,
): string | null {
  const from = graph.nodes.find((n) => n.id === nodeId);
  if (!from) return null;
  const [dx, dy] = DIR_VECTOR[dir];
  let best: string | null = null;
  let bestScore = 0.35; // must genuinely head that way, not sideways
  for (const e of graph.edges) {
    const otherId = e.a === nodeId ? e.b : e.b === nodeId ? e.a : null;
    if (!otherId) continue;
    const to = graph.nodes.find((n) => n.id === otherId)!;
    const vx = to.x - from.x;
    const vy = to.y - from.y;
    const len = Math.hypot(vx, vy) || 1;
    const score = (vx * dx + vy * dy) / len - len * 0.01;
    if (score > bestScore) {
      bestScore = score;
      best = otherId;
    }
  }
  return best;
}
