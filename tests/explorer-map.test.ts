import { describe, expect, it } from "vitest";
import { buildMapCards, MAP_STOPS } from "../src/lib/mapCards";
import {
  buildExplorerGraph,
  explorerNeighbor,
  frontierSeedCode,
  type ExplorerGraph,
} from "../src/lib/explorerMap";
import {
  emptyProgression,
  markExplorerVisited,
  mergeProgression,
  normalizeProgression,
  resetProgression,
  type ProgressionState,
} from "../src/lib/progression";
import {
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
