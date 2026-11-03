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
  /** Frontier chain length per branch (default 2). */
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

/** Generated frontier nodes + their roads, winding off each branch end. */
function frontierNodes(
  authored: ReadonlyMap<string, ExplorerNode>,
  depthWanted: number,
): { nodes: ExplorerNode[]; edges: Array<readonly [string, string]> } {
  const depth = Math.max(0, Math.floor(depthWanted));
  const occupied = new Set([...authored.values()].map((n) => `${n.x},${n.y}`));
  const nodes: ExplorerNode[] = [];
  const edges: Array<readonly [string, string]> = [];
  for (const branch of FRONTIER_BRANCHES) {
    const leaf = authored.get(branch.from);
    if (!leaf) continue;
    let prevId = leaf.id;
    let x = leaf.x;
    let y = leaf.y;
    let dirAt = octantIndex(branch.dir);
    for (let d = 1; d <= depth; d++) {
      const id = `frontier:${branch.from}:${d}`;
      // First step heads straight out; later steps may bend one octant.
      const bend = d === 1 ? 0 : (fnv1a(id) % 3) - 1;
      let placed = false;
      for (const turn of [bend, 0, 1, -1, 2, -2]) {
        const at = (dirAt + turn + OCTANTS.length * 2) % OCTANTS.length;
        const step = OCTANTS[at]!;
        const nx = x + step[0];
        const ny = y + step[1];
        if (occupied.has(`${nx},${ny}`)) continue;
        occupied.add(`${nx},${ny}`);
        dirAt = at;
        x = nx;
        y = ny;
        placed = true;
        break;
      }
      if (!placed) break;
      nodes.push({
        id,
        kind: "frontier",
        label: "New path",
        theme: leaf.theme,
        x,
        y,
        done: 0,
        total: 0,
        complete: false,
        suggested: false,
        fog: "clouded",
        locked: false,
        seedCode: frontierSeedCode(id),
      });
      edges.push([prevId, id]);
      prevId = id;
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
  const frontier = frontierNodes(authored, input.frontierDepth ?? 2);
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
