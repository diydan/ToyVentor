import { describe, expect, it } from "vitest";
import { PROPS } from "../src/features/game/world/runtime/catalog";
import { checkLevel } from "../src/features/game/world/runtime/levelKit";
import {
  PHOTO_NOUN_TO_PROP,
  composeRoomPhotoLevel,
  photoSegmentsToPinnedProps,
  type PhotoSegment,
} from "../src/features/game/world/runtime/roomPhoto";

const seg = (noun: string, cx: number, w = 0.12, h = 0.3): PhotoSegment => ({
  noun,
  box: { x1: cx - w / 2, y1: 1 - h, x2: cx + w / 2, y2: 1 },
});

describe("Feature 3: photo segments -> pinned room level", () => {
  it("maps known nouns through the closed table, in photo (left-to-right) order", () => {
    const { pinned, mapped, dropped } = photoSegmentsToPinnedProps([
      seg("teddy bear", 0.8),
      seg("book", 0.15),
      seg("pillow", 0.5),
    ]);
    expect(pinned.map((p) => p.type)).toEqual(["books", "cushions", "teddy"]);
    expect(pinned.map((p) => p.x)).toEqual([...pinned.map((p) => p.x)].sort((a, b) => a - b));
    for (const p of pinned) {
      expect(p.x).toBeGreaterThanOrEqual(2);
      expect(p.x).toBeLessThanOrEqual(43);
      expect(PROPS[p.type], p.type).toBeTruthy();
    }
    expect(mapped).toBe(3);
    expect(dropped).toEqual([]);
    for (const t of Object.values(PHOTO_NOUN_TO_PROP)) expect(PROPS[t], t).toBeTruthy();
  });

  it("unknown nouns fall back to a shape class; degenerate boxes drop", () => {
    const { pinned, mapped, dropped } = photoSegmentsToPinnedProps([
      seg("mystery orb", 0.3, 0.15, 0.15), // round-ish -> ball shape class
      { noun: "ghost", box: { x1: 0.5, y1: 0.5, x2: 0.5, y2: 0.5 } }, // zero area -> dropped
    ]);
    expect(pinned.map((p) => p.type)).toEqual(["ball"]);
    expect(mapped).toBe(0); // shape-class fallback does not count as a direct map
    expect(dropped).toEqual(["ghost"]);
  });

  it("composes a playable room level around the photo props (gates pass, order kept)", () => {
    const segments = [seg("chair", 0.12), seg("book", 0.38), seg("plant", 0.62), seg("ball", 0.86)];
    for (let seed = 1; seed <= 100; seed++) {
      const r = composeRoomPhotoLevel({ seed, segments });
      expect(checkLevel(r.level).every((c) => c.ok), `seed ${seed}`).toBe(true);
      expect(r.level.theme).toBe("room");
      if (!r.fallback) {
        const xs = r.pinned.map((p) => r.level.props.findIndex((q) => q.type === p.type && q.x === p.x));
        expect(xs.every((i) => i >= 0), `seed ${seed}`).toBe(true);
      }
    }
  });

  it("saves no photo data: the artifact is level JSON only", () => {
    const r = composeRoomPhotoLevel({ seed: 3, segments: [seg("teddy", 0.5)] });
    const json = JSON.stringify(r.level);
    expect(json).not.toContain("data:");
    expect(json).not.toContain("photo");
    expect(r.level.format).toBe("toyventor.level/1");
  });

  it("is deterministic for the same seed and segments", () => {
    const segments = [seg("lamp", 0.2), seg("box", 0.7)];
    expect(JSON.stringify(composeRoomPhotoLevel({ seed: 11, segments }))).toBe(
      JSON.stringify(composeRoomPhotoLevel({ seed: 11, segments })),
    );
  });
});
