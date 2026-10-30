import { describe, expect, it } from "vitest";
import baseSetJson from "../sets/base.json";
import {
  computeView,
  drawBuild,
  invertBoard,
  project,
} from "../src/features/builder/engine/render";
import type { ToySet } from "../shared/part";

const byId = new Map((baseSetJson as ToySet).parts.map((p) => [p.id, p]));
const board = { lengthMm: 110, widthMm: 55 };

describe("iso projection", () => {
  it("inverts board points at slab and block-top heights", () => {
    const view = computeView(390, 320, board);
    for (const z of [0, 7, 25]) {
      const s = project(view, 32, 16, z);
      const back = invertBoard(view, s.x, s.y, z);
      expect(back.xMm).toBeCloseTo(32, 5);
      expect(back.yMm).toBeCloseTo(16, 5);
    }
  });

  it("fits the whole board inside the canvas", () => {
    const view = computeView(390, 320, board);
    const corners = [
      project(view, 0, 0, 40),
      project(view, 110, 0, 0),
      project(view, 0, 55, 0),
      project(view, 110, 55, 0),
    ];
    for (const c of corners) {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.x).toBeLessThanOrEqual(390);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeLessThanOrEqual(320);
    }
  });
});

describe("drawBuild", () => {
  it("draws slab, grid, and blocks without throwing", () => {
    let fills = 0;
    const ctx = new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === "fill") return () => fills++;
          return () => {};
        },
        set: () => true,
      },
    ) as unknown as CanvasRenderingContext2D;
    const view = computeView(390, 320, board);
    drawBuild(ctx, view, {
      board,
      toyLabel: "Test",
      placements: [
        { instanceId: "a", partId: "racer-spoiler", xMm: 0, yMm: 0, rotation: 0 },
        { instanceId: "b", partId: "beam-str-tu05", xMm: 25, yMm: 12.5, rotation: 90 },
      ],
      partsById: byId,
      selectedId: "a",
      ghost: { instanceId: "a", partId: "racer-spoiler", xMm: 12.5, yMm: 12.5, rotation: 0, valid: false },
    });
    expect(fills).toBeGreaterThan(6); // slab (3) + 2 blocks (3 each)
  });
});
