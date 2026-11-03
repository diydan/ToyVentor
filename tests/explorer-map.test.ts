import { describe, expect, it } from "vitest";
import { buildMapCards, MAP_STOPS } from "../src/lib/mapCards";
import {
  buildExplorerGraph,
  explorerNeighbor,
  explorerRoute,
  FRONTIER_AHEAD,
  FRONTIER_BRANCHES,
  FRONTIER_MAX_DEPTH,
  frontierSeedCode,
  frontierTier,
  maxTierForAge,
  secretId,
  SECRET_EXITS,
  TIER_2_FROM_DEPTH,
  TIER_3_FROM_DEPTH,
  TIER_WORD,
  newlyShown,
  roadKey,
  seenEntries,
  type ExplorerGraph,
} from "../src/lib/explorerMap";
import {
  emptyProgression,
  markExplorerSeen,
  markExplorerVisited,
  mergeProgression,
  normalizeProgression,
  resetProgression,
  type ProgressionState,
} from "../src/lib/progression";
import {
  checkLevel,
  codeToSeed,
  composeLevel,
} from "../src/features/game/world/runtime/levelKit";

const prog = (over: Partial<ProgressionState> = {}): ProgressionState => ({
  ...emptyProgression(),
  ...over,
});

const cards = (
  over: Partial<Parameters<typeof buildMapCards>[0]> = {},
) =>
  buildMapCards({
    ageBand: 1,
    prog: prog(),
    found: new Set<string>(),
    missionsDone: new Set<string>(),
    // Every map here has the Garage, as in the game.
    garage: { weekend: false, done: false },
    ...over,
  });

const byId = (g: ExplorerGraph, id: string) => g.nodes.find((n) => n.id === id);

describe("explorer graph skeleton", () => {
  it("places every world, lab, and suited ladder once, with no shared spots", () => {
    const g = buildExplorerGraph({ cards: cards() });
    for (const stop of MAP_STOPS) {
      expect(byId(g, stop.id), stop.id).toBeDefined();
    }
    for (const id of ["little", "early", "daily", "bridges", "gears", "circuits", "code"]) {
      expect(byId(g, id), id).toBeDefined();
    }
    const spots = g.nodes.map((n) => `${n.x},${n.y}`);
    expect(new Set(spots).size).toBe(spots.length);
    expect(new Set(g.nodes.map((n) => n.id)).size).toBe(g.nodes.length);
  });

  it("every edge joins real nodes and roads span at least six compass directions", () => {
    const g = buildExplorerGraph({ cards: cards() });
    const octants = new Set<string>();
    for (const e of g.edges) {
      const a = byId(g, e.a)!;
      const b = byId(g, e.b)!;
      expect(a, e.a).toBeDefined();
      expect(b, e.b).toBeDefined();
      octants.add(`${Math.sign(b.x - a.x)},${Math.sign(b.y - a.y)}`);
    }
    expect(octants.size).toBeGreaterThanOrEqual(6);
    // The town ring is in the skeleton: room joins garden and sky.
    const joins = (x: string, y: string) =>
      g.edges.some((e) => (e.a === x && e.b === y) || (e.a === y && e.b === x));
    expect(joins("room", "garden")).toBe(true);
    expect(joins("garden", "beach")).toBe(true);
    expect(joins("beach", "junk")).toBe(true);
    expect(joins("junk", "snow")).toBe(true);
    expect(joins("snow", "sky")).toBe(true);
    expect(joins("sky", "room")).toBe(true);
  });

  it("no road runs under a node it does not join, in any age band", () => {
    // Node discs are ~0.34 grid units wide; a road closer than that to a
    // skipped node reads as passing through it (and implies a false road).
    const CLEAR = 0.45;
    for (const ageBand of [null, 0, 1, 2, 3, 4, 5]) {
      const g = buildExplorerGraph({ cards: cards({ ageBand }) });
      for (const e of g.edges) {
        const a = byId(g, e.a)!;
        const b = byId(g, e.b)!;
        const vx = b.x - a.x;
        const vy = b.y - a.y;
        for (const n of g.nodes) {
          if (n.id === a.id || n.id === b.id) continue;
          const t = Math.max(
            0,
            Math.min(1, ((n.x - a.x) * vx + (n.y - a.y) * vy) / (vx * vx + vy * vy)),
          );
          const d = Math.hypot(a.x + t * vx - n.x, a.y + t * vy - n.y);
          expect(
            d,
            `band ${ageBand}: ${e.a}-${e.b} passes ${n.id}`,
          ).toBeGreaterThanOrEqual(CLEAR);
        }
      }
    }
  });

  it("has one structured district area per world, holding its lab", () => {
    const g = buildExplorerGraph({ cards: cards() });
    expect(g.districts.map((d) => d.id).sort()).toEqual(
      ["beach", "garden", "junk", "room", "sky", "snow"].sort(),
    );
    const garden = g.districts.find((d) => d.id === "garden")!;
    expect(garden.memberIds).toContain("garden");
    expect(garden.memberIds).toContain("lab1");
    expect(garden.rx).toBeGreaterThan(0);
    expect(garden.ry).toBeGreaterThan(0);
  });
});

describe("gentle fog", () => {
  it("fresh player: home in colour, neighbours silhouettes, far places clouded", () => {
    const g = buildExplorerGraph({ cards: cards() });
    expect(byId(g, "room")!.fog).toBe("revealed");
    for (const id of ["garden", "sky", "beach", "junk", "lab6", "little", "early", "daily"]) {
      expect(byId(g, id)!.fog, id).toBe("next");
    }
    expect(byId(g, "lab1")!.fog).toBe("clouded");
    expect(byId(g, "bridges")!.fog).toBe("clouded");
    expect(byId(g, "snow")!.fog).toBe("clouded");
  });

  it("fog never locks travel: clouded nodes stay tappable", () => {
    const g = buildExplorerGraph({ cards: cards() });
    for (const n of g.nodes) expect(n.locked, n.id).toBe(false);
    expect(byId(g, "snow")!.fog).toBe("clouded");
    expect(byId(g, "snow")!.locked).toBe(false);
  });

  it("progress and visits reveal a node and silhouette its neighbours", () => {
    const gardenGoals = MAP_STOPS.find((s) => s.id === "garden")!.goals;
    const g = buildExplorerGraph({
      cards: cards({ found: new Set(gardenGoals) }),
    });
    expect(byId(g, "garden")!.fog).toBe("revealed");
    expect(byId(g, "garden")!.complete).toBe(true);
    expect(byId(g, "lab1")!.fog).toBe("next");

    const visited = buildExplorerGraph({
      cards: cards(),
      visited: new Set(["snow"]),
    });
    expect(byId(visited, "snow")!.fog).toBe("revealed");
    expect(byId(visited, "lab4")!.fog).toBe("next");
  });

  it("sandbox open-all reveals the whole map", () => {
    const g = buildExplorerGraph({ cards: cards(), openAll: true });
    expect(g.nodes.every((n) => n.fog === "revealed")).toBe(true);
  });
});

describe("generated frontier", () => {
  it("grows seeded nodes off branch ends, deterministically", () => {
    const a = buildExplorerGraph({ cards: cards() });
    const b = buildExplorerGraph({ cards: cards() });
    const fa = a.nodes.filter((n) => n.kind === "frontier");
    expect(fa.length).toBeGreaterThanOrEqual(8);
    expect(fa.map((n) => [n.id, n.x, n.y, n.seedCode])).toEqual(
      b.nodes.filter((n) => n.kind === "frontier").map((n) => [n.id, n.x, n.y, n.seedCode]),
    );
    for (const n of fa) {
      expect(n.seedCode, n.id).toBe(frontierSeedCode(n.id));
      // The seed code must round-trip through the real level kit.
      expect(composeLevel({ seed: codeToSeed(n.seedCode!) }).seed).toBe(n.seedCode);
      // Frontier play forces the branch theme, so a Beach path is a Beach level.
      const themed = composeLevel({ seed: codeToSeed(n.seedCode!), theme: n.theme });
      expect(themed.theme, n.id).toBe(n.theme);
      expect(themed.seed, n.id).toBe(n.seedCode);
    }
  });

  it("frontier chain opens one hop at a time as you explore", () => {
    const fresh = buildExplorerGraph({ cards: cards() });
    const first = fresh.nodes.find((n) => n.id === "frontier:lab3:1")!;
    const second = fresh.nodes.find((n) => n.id === "frontier:lab3:2")!;
    expect(first.fog).toBe("clouded"); // lab3 itself is still clouded
    expect(second.fog).toBe("clouded");

    const labDone = buildExplorerGraph({
      cards: cards({ missionsDone: new Set(["lab3.raft"]) }),
    });
    expect(byId(labDone, "frontier:lab3:1")!.fog).toBe("next");
    expect(byId(labDone, "frontier:lab3:2")!.fog).toBe("clouded");

    const walked = buildExplorerGraph({
      cards: cards({ missionsDone: new Set(["lab3.raft"]) }),
      visited: new Set(["frontier:lab3:1"]),
    });
    expect(byId(walked, "frontier:lab3:1")!.fog).toBe("revealed");
    expect(byId(walked, "frontier:lab3:2")!.fog).toBe("next");
  });
});

describe("directional travel", () => {
  it("arrow directions follow roads from home", () => {
    const g = buildExplorerGraph({ cards: cards() });
    expect(explorerNeighbor(g, "room", "up")).toBe("sky");
    expect(explorerNeighbor(g, "room", "down")).toBe("beach");
    expect(explorerNeighbor(g, "room", "left")).toBe("garden");
    expect(explorerNeighbor(g, "room", "right")).toBe("junk");
    expect(explorerNeighbor(g, "room", "up")).not.toBe("room");
    expect(explorerNeighbor(g, "nope", "up")).toBeNull();
  });
});

describe("explorer visited in progression", () => {
  it("marks, dedupes, normalizes, merges by union, and resets clean", () => {
    const once = markExplorerVisited(prog(), "frontier:lab3:1");
    expect(once.changed).toBe(true);
    expect(once.next.explorerVisited).toEqual(["frontier:lab3:1"]);
    const twice = markExplorerVisited(once.next, "frontier:lab3:1");
    expect(twice.changed).toBe(false);
    expect(markExplorerVisited(prog(), "bad id!").changed).toBe(false);

    expect(
      normalizeProgression({
        explorerVisited: ["garden", "garden", "bad id!", "frontier:lab3:1", 7],
      }).explorerVisited,
    ).toEqual(["garden", "frontier:lab3:1"]);

    const merged = mergeProgression(
      prog({ explorerVisited: ["garden"] }),
      prog({ explorerVisited: ["sky", "garden"] }),
    );
    expect([...(merged.explorerVisited ?? [])].sort()).toEqual(["garden", "sky"]);

    expect(
      resetProgression(prog({ explorerVisited: ["garden"] })).explorerVisited,
    ).toBeUndefined();
  });
});

const deepWalk = (): Set<string> =>
  new Set(FRONTIER_BRANCHES.map((b) => `frontier:${b.from}:${FRONTIER_MAX_DEPTH}`));

const frontierOf = (g: ExplorerGraph, from: string) =>
  g.nodes.filter((n) => n.id.startsWith(`frontier:${from}:`));

describe("a growing frontier", () => {
  it("keeps a couple of paths ahead of the furthest one walked, per branch", () => {
    expect(FRONTIER_AHEAD).toBe(2);
    const fresh = buildExplorerGraph({ cards: cards() });
    expect(frontierOf(fresh, "lab3")).toHaveLength(2);

    const one = buildExplorerGraph({ cards: cards(), visited: new Set(["frontier:lab3:1"]) });
    expect(frontierOf(one, "lab3").map((n) => n.id)).toEqual([
      "frontier:lab3:1",
      "frontier:lab3:2",
      "frontier:lab3:3",
    ]);
    // Other branches are untouched.
    expect(frontierOf(one, "gears")).toHaveLength(2);

    // Walking straight to a deeper path (clouds do not lock) grows past it.
    const jump = buildExplorerGraph({ cards: cards(), visited: new Set(["frontier:lab3:5"]) });
    expect(frontierOf(jump, "lab3")).toHaveLength(7);
  });

  it("never grows past the cap, and ids stay in order with no gaps", () => {
    const g = buildExplorerGraph({ cards: cards({ ageBand: null }), visited: deepWalk() });
    for (const br of FRONTIER_BRANCHES) {
      const chain = frontierOf(g, br.from);
      expect(chain.length, br.from).toBeLessThanOrEqual(FRONTIER_MAX_DEPTH);
      chain.forEach((n, i) => expect(n.id).toBe(`frontier:${br.from}:${i + 1}`));
    }
    expect(frontierOf(g, "lab3").length).toBeGreaterThan(8);
  });

  it("a place that exists never moves when any branch grows", () => {
    const base = buildExplorerGraph({ cards: cards() });
    const where = (g: ExplorerGraph) => new Map(g.nodes.map((n) => [n.id, `${n.x},${n.y}`]));
    const before = where(base);
    for (const visited of [
      new Set(["frontier:lab3:2"]),
      new Set(["frontier:bridges:2", "frontier:code:2"]),
      deepWalk(),
    ]) {
      const after = where(buildExplorerGraph({ cards: cards(), visited }));
      for (const [id, at] of before) expect(after.get(id), id).toBe(at);
    }
  });

  it("every chain, at full depth, in every age band: no crossings, no overlaps", () => {
    for (const ageBand of [null, 0, 1, 2, 3, 4, 5]) {
      const g = buildExplorerGraph({ cards: cards({ ageBand }), visited: deepWalk() });
      const by = new Map(g.nodes.map((n) => [n.id, n]));
      // One place per spot, one id each.
      const spots = g.nodes.map((n) => `${n.x},${n.y}`);
      expect(new Set(spots).size, `band ${ageBand} spots`).toBe(spots.length);
      // No two roads properly cross, and none runs close to a place it skips.
      const segs = g.edges.map((e) => ({ a: by.get(e.a)!, b: by.get(e.b)! }));
      const orient = (o: { x: number; y: number }, p: { x: number; y: number }, q: { x: number; y: number }) =>
        (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
      for (let i = 0; i < segs.length; i++) {
        for (let j = i + 1; j < segs.length; j++) {
          const A = segs[i]!;
          const B = segs[j]!;
          const shared = [A.a.id, A.b.id].some((id) => id === B.a.id || id === B.b.id);
          if (shared) continue;
          const crosses =
            orient(A.a, A.b, B.a) * orient(A.a, A.b, B.b) < 0 &&
            orient(B.a, B.b, A.a) * orient(B.a, B.b, A.b) < 0;
          expect(crosses, `band ${ageBand}: ${A.a.id}-${A.b.id} crosses ${B.a.id}-${B.b.id}`).toBe(false);
        }
      }
      for (const sg of segs) {
        const vx = sg.b.x - sg.a.x;
        const vy = sg.b.y - sg.a.y;
        for (const n of g.nodes) {
          if (n.id === sg.a.id || n.id === sg.b.id) continue;
          const t = Math.max(0, Math.min(1, ((n.x - sg.a.x) * vx + (n.y - sg.a.y) * vy) / (vx * vx + vy * vy)));
          const d = Math.hypot(sg.a.x + t * vx - n.x, sg.a.y + t * vy - n.y);
          expect(d, `band ${ageBand}: ${sg.a.id}-${sg.b.id} under ${n.id}`).toBeGreaterThanOrEqual(0.6);
        }
      }
    }
  });

  it("every generated path has its own seed, and each plays through the level kit", () => {
    const g = buildExplorerGraph({ cards: cards({ ageBand: null }), visited: deepWalk() });
    const frontier = g.nodes.filter((n) => n.kind === "frontier");
    expect(new Set(frontier.map((n) => n.seedCode)).size).toBe(frontier.length);
    for (const n of frontier) {
      expect(composeLevel({ seed: codeToSeed(n.seedCode!), theme: n.theme }).seed, n.id).toBe(n.seedCode);
    }
  });
});

describe("what is new on the map", () => {
  const g0 = () => buildExplorerGraph({ cards: cards({ ageBand: 3 }) });
  const withVisit = (...ids: string[]) =>
    buildExplorerGraph({ cards: cards({ ageBand: 3 }), visited: new Set(ids) });

  it("nothing is new without a record, or when nothing changed", () => {
    expect(newlyShown(g0(), null).isEmpty).toBe(true);
    expect(newlyShown(g0(), undefined).isEmpty).toBe(true);
    expect(newlyShown(g0(), new Set(seenEntries(g0()))).isEmpty).toBe(true);
  });

  it("a place walked to clears, its neighbours appear, its roads draw in", () => {
    const seen = new Set(seenEntries(g0()));
    const after = withVisit("beach");
    const reveal = newlyShown(after, seen);
    expect(reveal.isEmpty).toBe(false);
    // Beach was a silhouette, now it is in colour.
    expect(reveal.clear.has("beach")).toBe(true);
    // Its lab was hidden under cloud and now shows.
    expect(reveal.appear.has("lab3")).toBe(true);
    // The road from home to the beach is solid now, drawn out from home. The
    // road runs beach to room (ids sorted), so home is its end.
    expect(reveal.roads.get(roadKey("room", "beach"))).toBe("from-end");
    // The road from the beach to the lab is dotted: it fades in.
    expect(reveal.roads.get(roadKey("beach", "lab3"))).toBe("fade");
    // Home and a far world are not new.
    expect(reveal.appear.has("room")).toBe(false);
    expect(reveal.clear.has("room")).toBe(false);
    expect(reveal.appear.has("snow")).toBe(false);
  });

  it("a road draws out from the end that was already in colour", () => {
    // Walk to the lab after the beach: the beach-lab road is drawn out from the beach.
    const seen = new Set(seenEntries(withVisit("beach")));
    const reveal = newlyShown(withVisit("beach", "lab3"), seen);
    // beach < lab3, beach was seen in colour: draw from the start (the beach).
    expect(reveal.roads.get(roadKey("beach", "lab3"))).toBe("from-start");
    // From the other side: seen only lab3's end in colour, draw from the end.
    const seenLab = new Set(["lab3", "lab3#", "beach"]);
    expect(newlyShown(withVisit("beach", "lab3"), seenLab).roads.get(roadKey("beach", "lab3"))).toBe("from-end");
  });

  it("walking a generated path makes the next ones appear", () => {
    const seen = new Set(seenEntries(withVisit("beach", "lab3", "frontier:lab3:1")));
    const reveal = newlyShown(withVisit("beach", "lab3", "frontier:lab3:1", "frontier:lab3:2"), seen);
    expect(reveal.clear.has("frontier:lab3:2")).toBe(true);
    // Walking path 2 grows the branch: path 3 is the new silhouette, path 4 stays under cloud.
    expect(reveal.appear.has("frontier:lab3:3")).toBe(true);
    expect(reveal.appear.has("frontier:lab3:4")).toBe(false);
    expect(reveal.roads.get(roadKey("frontier:lab3:1", "frontier:lab3:2"))).toBe("from-start");
  });
});

describe("explorer seen in progression", () => {
  it("records what was shown, only ever adds, validates, merges by union, resets clean", () => {
    const first = markExplorerSeen(prog(), ["room", "room#", "garden"]);
    expect(first.changed).toBe(true);
    expect(first.next.explorerSeen).toEqual(["room", "room#", "garden"]);
    // Same entries again change nothing; new ones are added, none removed.
    expect(markExplorerSeen(first.next, ["garden", "room"]).changed).toBe(false);
    const more = markExplorerSeen(first.next, ["garden#", "frontier:lab3:1"]);
    expect(more.changed).toBe(true);
    expect(more.next.explorerSeen).toEqual(["room", "room#", "garden", "garden#", "frontier:lab3:1"]);
    expect(markExplorerSeen(prog(), []).changed).toBe(false);
    expect(markExplorerSeen(prog(), ["bad id!", "x#y"]).changed).toBe(false);

    expect(
      normalizeProgression({
        explorerSeen: ["garden", "garden", "garden#", "bad id!", "frontier:lab3:2#", 7, "##"],
      }).explorerSeen,
    ).toEqual(["garden", "garden#", "frontier:lab3:2#"]);

    const merged = mergeProgression(
      prog({ explorerSeen: ["garden"] }),
      prog({ explorerSeen: ["sky#", "garden"] }),
    );
    expect([...(merged.explorerSeen ?? [])].sort()).toEqual(["garden", "sky#"]);

    expect(
      resetProgression(prog({ explorerSeen: ["garden"] })).explorerSeen,
    ).toBeUndefined();
  });

  it("the entries the map writes are exactly the entries the map accepts", () => {
    const g = buildExplorerGraph({ cards: cards({ ageBand: null }), visited: deepWalk() });
    const entries = seenEntries(g);
    expect(markExplorerSeen(prog(), entries).next.explorerSeen).toEqual(entries);
  });
});

/** Problems with a graph's geometry: shared spots, crossing roads, a road under a place it skips. */
function geometryProblems(g: ExplorerGraph): string[] {
  const out: string[] = [];
  const by = new Map(g.nodes.map((n) => [n.id, n]));
  const spots = g.nodes.map((n) => `${n.x},${n.y}`);
  if (new Set(spots).size !== spots.length) out.push("two places share a spot");
  const segs = g.edges.map((e) => ({ a: by.get(e.a)!, b: by.get(e.b)! }));
  const orient = (o: { x: number; y: number }, p: { x: number; y: number }, q: { x: number; y: number }) =>
    (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const A = segs[i]!;
      const B = segs[j]!;
      if ([A.a.id, A.b.id].some((id) => id === B.a.id || id === B.b.id)) continue;
      if (orient(A.a, A.b, B.a) * orient(A.a, A.b, B.b) < 0 && orient(B.a, B.b, A.a) * orient(B.a, B.b, A.b) < 0) {
        out.push(`${A.a.id}-${A.b.id} crosses ${B.a.id}-${B.b.id}`);
      }
    }
  }
  for (const sg of segs) {
    const vx = sg.b.x - sg.a.x;
    const vy = sg.b.y - sg.a.y;
    for (const n of g.nodes) {
      if (n.id === sg.a.id || n.id === sg.b.id) continue;
      const t = Math.max(0, Math.min(1, ((n.x - sg.a.x) * vx + (n.y - sg.a.y) * vy) / (vx * vx + vy * vy)));
      if (Math.hypot(sg.a.x + t * vx - n.x, sg.a.y + t * vy - n.y) < 0.6) out.push(`${sg.a.id}-${sg.b.id} under ${n.id}`);
    }
  }
  return out;
}

describe("difficulty by depth", () => {
  it("easy for the first few paths, tricky from the 4th, hard from the 8th", () => {
    expect([TIER_2_FROM_DEPTH, TIER_3_FROM_DEPTH]).toEqual([4, 8]);
    const at = (d: number) => frontierTier(d, 4);
    expect([1, 2, 3].map(at)).toEqual([1, 1, 1]);
    expect([4, 5, 6, 7].map(at)).toEqual([2, 2, 2, 2]);
    expect([8, 9, 12].map(at)).toEqual([3, 3, 3]);
    expect(TIER_WORD).toEqual({ 1: "Easy", 2: "Tricky", 3: "Hard" });
  });

  it("age caps it: the youngest never see more than Easy, an unset age no more than Tricky", () => {
    expect([0, 1, 2, 3, 4, 5].map((b) => maxTierForAge(b))).toEqual([1, 1, 2, 3, 3, 3]);
    expect(maxTierForAge(null)).toBe(2);
    expect(maxTierForAge(undefined)).toBe(2);
    for (const d of [1, 5, 12]) {
      expect(frontierTier(d, 0)).toBe(1);
      expect(frontierTier(d, 1)).toBe(1);
      expect(frontierTier(d, null)).toBeLessThanOrEqual(2);
    }
    expect(frontierTier(12, 2)).toBe(2);
  });

  it("every generated path in the graph carries its depth and the matching tier", () => {
    for (const ageBand of [null, 1, 3]) {
      const g = buildExplorerGraph({ cards: cards({ ageBand }), visited: deepWalk(), ageBand });
      const frontier = g.nodes.filter((n) => n.kind === "frontier");
      expect(frontier.length).toBeGreaterThan(0);
      for (const n of frontier) {
        const d = Number(n.id.split(":")[2]);
        expect(n.depth, n.id).toBe(d);
        expect(n.tier, n.id).toBe(frontierTier(d, ageBand));
      }
    }
    // The first paths are tier 1 whatever the age: existing seeds play as they always did.
    const g = buildExplorerGraph({ cards: cards({ ageBand: 3 }), ageBand: 3 });
    expect(g.nodes.filter((n) => n.kind === "frontier").every((n) => n.tier === 1)).toBe(true);
  });

  it("a tiered path plays through the level kit at that tier, and still passes its checks", () => {
    const g = buildExplorerGraph({ cards: cards({ ageBand: 3 }), visited: deepWalk(), ageBand: 3 });
    for (const n of g.nodes.filter((x) => x.kind === "frontier" && (x.tier ?? 1) > 1)) {
      const l = composeLevel({ seed: codeToSeed(n.seedCode!), theme: n.theme, tier: n.tier });
      expect(checkLevel(l).filter((c) => !c.ok), n.id).toEqual([]);
      for (const m of l.missions ?? []) expect(m.tier).toBe(n.tier);
    }
  });
});

describe("secret exits", () => {
  const gardenGoals = () => MAP_STOPS.find((s) => s.id === "garden")!.goals;
  const worldDone = (...ids: string[]) =>
    new Set(ids.flatMap((id) => MAP_STOPS.find((s) => s.id === id)!.goals));
  const secrets = (g: ExplorerGraph) => g.nodes.filter((n) => n.kind === "secret").map((n) => n.id).sort();

  it("none show until a world's hidden parts are all found", () => {
    expect(secrets(buildExplorerGraph({ cards: cards({ ageBand: 3 }) }))).toEqual([]);
    // Most of the garden found is not enough.
    const some = new Set(gardenGoals().slice(0, gardenGoals().length - 1));
    expect(secrets(buildExplorerGraph({ cards: cards({ ageBand: 3, found: some }) }))).toEqual([]);
  });

  it("the one world that is complete opens its own exit and no other", () => {
    const g = buildExplorerGraph({ cards: cards({ ageBand: 3, found: worldDone("garden") }), ageBand: 3 });
    expect(secrets(g)).toEqual([secretId("garden")]);
    const exit = byId(g, secretId("garden"))!;
    expect(exit.kind).toBe("secret");
    expect(exit.theme).toBe(byId(g, "garden")!.theme);
    // Joined to its world by a road, shown as a silhouette until walked to.
    expect(g.edges.some((e) => [e.a, e.b].sort().join() === [ "garden", exit.id ].sort().join())).toBe(true);
    expect(exit.fog).toBe("next");
    // The hardest level this age is offered, in a dusk mood.
    expect(exit.tier).toBe(3);
    expect(exit.mood).toBe("dusk");
    expect(maxTierForAge(0)).toBe(1);
    expect(buildExplorerGraph({ cards: cards({ ageBand: 1, found: worldDone("garden") }), ageBand: 1 }).nodes.find((n) => n.kind === "secret")!.tier).toBe(1);

    const two = buildExplorerGraph({ cards: cards({ ageBand: 3, found: worldDone("garden", "snow") }) });
    expect(secrets(two)).toEqual([secretId("garden"), secretId("snow")].sort());
  });

  it("walking to one reveals and completes it; sandbox shows all five", () => {
    const walked = buildExplorerGraph({
      cards: cards({ ageBand: 3, found: worldDone("garden") }),
      visited: new Set([secretId("garden")]),
    });
    const exit = byId(walked, secretId("garden"))!;
    expect(exit.fog).toBe("revealed");
    expect(exit.complete).toBe(true);
    expect(exit.done).toBe(1);
    const all = buildExplorerGraph({ cards: cards({ ageBand: 3 }), openAll: true });
    expect(secrets(all)).toEqual(SECRET_EXITS.map((x) => secretId(x.from)).sort());
    expect(all.nodes.every((n) => n.fog === "revealed")).toBe(true);
  });

  it("each plays a bonus level through the level kit, with its own seed", () => {
    const all = buildExplorerGraph({ cards: cards({ ageBand: 3 }), openAll: true, ageBand: 3 });
    const ex = all.nodes.filter((n) => n.kind === "secret");
    expect(new Set(ex.map((n) => n.seedCode)).size).toBe(ex.length);
    for (const n of ex) {
      expect(n.seedCode).toBe(frontierSeedCode(n.id));
      const l = composeLevel({ seed: codeToSeed(n.seedCode!), theme: n.theme, mood: n.mood, tier: n.tier });
      expect(l.theme).toBe(n.theme);
      expect(l.mood).toBe("dusk");
      expect(checkLevel(l).filter((c) => !c.ok), n.id).toEqual([]);
    }
  });

  it("their space is reserved even while locked: nothing moves when one opens", () => {
    const where = (g: ExplorerGraph) =>
      new Map(g.nodes.filter((n) => n.kind === "frontier").map((n) => [n.id, `${n.x},${n.y}`]));
    const locked = buildExplorerGraph({ cards: cards({ ageBand: 3 }), visited: deepWalk() });
    const open = buildExplorerGraph({ cards: cards({ ageBand: 3 }), visited: deepWalk(), openAll: true });
    for (const [id, at] of where(locked)) expect(where(open).get(id), id).toBe(at);
    // And no generated path sits on any secret exit's spot.
    const taken = new Set(locked.nodes.map((n) => `${n.x},${n.y}`));
    for (const sx of SECRET_EXITS) expect(taken.has(`${sx.pos[0]},${sx.pos[1]}`), sx.from).toBe(false);
  });

  it("with every exit open and every branch walked to the end: clean geometry, any age", () => {
    for (const ageBand of [null, 0, 1, 2, 3, 4, 5]) {
      const g = buildExplorerGraph({ cards: cards({ ageBand }), visited: deepWalk(), openAll: true, ageBand });
      expect(g.nodes.filter((n) => n.kind === "secret").length, `band ${ageBand}`).toBe(5);
      expect(geometryProblems(g), `band ${ageBand}`).toEqual([]);
    }
  });

  it("an exit that opens is new on the map: it appears and its road draws from the world", () => {
    const before = buildExplorerGraph({ cards: cards({ ageBand: 3 }) });
    const after = buildExplorerGraph({ cards: cards({ ageBand: 3, found: worldDone("beach") }) });
    const reveal = newlyShown(after, new Set(seenEntries(before)));
    expect(reveal.appear.has(secretId("beach"))).toBe(true);
    expect(reveal.roads.get(roadKey("beach", secretId("beach")))).toBeDefined();
  });
});

describe("the Garage on the trail map", () => {
  it("is always on the map and always in colour, like home, in every age band", () => {
    for (const ageBand of [null, 0, 1, 2, 3, 4, 5]) {
      const g = buildExplorerGraph({ cards: cards({ ageBand }) });
      const garage = byId(g, "garage");
      expect(garage, `band ${ageBand}`).toBeDefined();
      expect(garage!.kind).toBe("garage");
      expect(garage!.fog).toBe("revealed");
      expect(garage!.label).toBe("Garage");
      // It is joined to the rest of the map by a road, and the toy can hop there.
      expect(g.edges.some((e) => [e.a, e.b].includes("garage")), `band ${ageBand}`).toBe(true);
      expect(explorerRoute(g, "room", "garage"), `band ${ageBand}`).not.toBeNull();
    }
  });

  it("carries the weekend flag from its card, and is the suggested place until it is done", () => {
    const quiet = buildExplorerGraph({ cards: cards({ garage: { weekend: false, done: false } }) });
    expect(byId(quiet, "garage")!.card?.badge).toBeUndefined();
    expect(byId(quiet, "garage")!.suggested).toBe(false);

    const hot = buildExplorerGraph({ cards: cards({ garage: { weekend: true, done: false } }) });
    expect(byId(hot, "garage")!.card?.badge).toBe("new");
    expect(byId(hot, "garage")!.suggested).toBe(true);
    expect(hot.suggestedId).toBe("garage");

    const done = buildExplorerGraph({ cards: cards({ garage: { weekend: true, done: true } }) });
    expect(byId(done, "garage")!.card?.badge).toBeUndefined();
    expect(byId(done, "garage")!.complete).toBe(true);
    expect(byId(done, "garage")!.suggested).toBe(false);
  });

  it("is absent when the game gives no Garage (so old callers are unchanged)", () => {
    const g = buildExplorerGraph({
      cards: buildMapCards({ ageBand: 1, prog: prog(), found: new Set<string>(), missionsDone: new Set<string>() }),
    });
    expect(byId(g, "garage")).toBeUndefined();
  });

  it("with it, every branch grown and every exit open, the geometry is still clean in every age band", () => {
    for (const ageBand of [null, 0, 1, 2, 3, 4, 5]) {
      const g = buildExplorerGraph({ cards: cards({ ageBand }), visited: deepWalk(), openAll: true, ageBand });
      expect(geometryProblems(g), `band ${ageBand}`).toEqual([]);
    }
  });

  it("does not move any generated path, nor any other place", () => {
    const withGarage = buildExplorerGraph({ cards: cards({ ageBand: 3 }), visited: deepWalk() });
    const without = buildExplorerGraph({
      cards: buildMapCards({ ageBand: 3, prog: prog(), found: new Set<string>(), missionsDone: new Set<string>() }),
      visited: deepWalk(),
    });
    const at = (g: ExplorerGraph) => new Map(g.nodes.map((n) => [n.id, `${n.x},${n.y}`]));
    const a = at(withGarage);
    for (const [id, pos] of at(without)) expect(a.get(id), id).toBe(pos);
    expect(a.size).toBe(at(without).size + 1);
  });
});
