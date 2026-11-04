// A generated Toy Room always has a bed (runtime/levelKit.ts step 6): the one a glow spot hides under, or a bed prop in a clear stretch of the lane.
import { describe, expect, it } from "vitest";
import { BED_CANDIDATES, BED_MARGINS, BED_ROOM_PROP, composeLevel } from "../src/features/game/world/runtime/levelKit";
import { PROPS } from "../src/features/game/world/runtime/catalog";

const rooms = Array.from({ length: 400 }, (_, i) => composeLevel({ seed: 1000 + i * 7919, theme: "room" }));

describe("a generated Toy Room has a bed", () => {
  it("every room has one: a bed prop, or a glow spot that hides under the bed (which the world builds as the real bed)", () => {
    const missing = rooms.filter((l) => !l.props.some((p) => p.type === "bed") && !l.spots.some((s) => s.hide === "bed"));
    expect(missing.map((l) => l.seed)).toEqual([]);
  });
  it("most rooms need the extra prop (the glow spot is not in every one), and it is only added when the spot's bed is missing", () => {
    const withProp = rooms.filter((l) => l.props.some((p) => p.type === "bed"));
    expect(withProp.length).toBeGreaterThan(40);
    expect(withProp.length).toBeLessThan(rooms.length);
    for (const l of withProp) expect(l.spots.some((s) => s.hide === "bed"), l.seed).toBe(false);
    expect(rooms.every((l) => l.props.filter((p) => p.type === "bed").length <= 1)).toBe(true);
  });
  it("the bed stands clear of every hiding spot, station and lane prop, and inside the world", () => {
    for (const l of rooms) {
      const bed = l.props.find((p) => p.type === "bed");
      if (!bed) continue;
      expect(BED_CANDIDATES, l.seed).toContain(bed.x);                           // a half unit between 3 and 44
      for (const s of l.spots) expect(Math.abs(s.x - bed.x), `${l.seed} spot`).toBeGreaterThanOrEqual(BED_MARGINS[BED_MARGINS.length - 1]![0]);     // never closer than the last margin to a hiding spot
      let tight = 0;
      for (const p of l.props) {
        if (p === bed) continue;
        const z = p.z ?? PROPS[p.type]?.z ?? 0;
        if (z > -3 && Math.abs(p.x - bed.x) < BED_ROOM_PROP) tight++;
      }
      if (tight === 0) {                                                                // a bed that got the roomy margins keeps them
        for (const s of l.spots) expect(Math.abs(s.x - bed.x), `${l.seed} spot`).toBeGreaterThanOrEqual(BED_MARGINS[0]![0] - 0.7);
      }
      expect(bed.x).toBeGreaterThanOrEqual(0);
      expect(bed.x).toBeLessThanOrEqual(45);
    }
  });
  it("other themes get no bed, and a room built round photographed props is left as the photo shows it", () => {
    for (const theme of ["garden", "sky", "junk", "beach", "snow"]) for (let i = 0; i < 40; i++) expect(composeLevel({ seed: 77 + i, theme }).props.some((p) => p.type === "bed"), theme).toBe(false);
    const pinned = composeLevel({ seed: 5, theme: "room", pinnedProps: [{ type: "teddy", x: 10 }, { type: "ball", x: 20 }] });
    expect(pinned.props.some((p) => p.type === "bed")).toBe(false);
  });
  it("the same seed gives the same level (the bed draws nothing from the random stream)", () => {
    for (let i = 0; i < 30; i++) {
      const a = composeLevel({ seed: 9000 + i, theme: "room" }), b = composeLevel({ seed: 9000 + i, theme: "room" });
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      const noBed = { ...a, props: a.props.filter((p) => p.type !== "bed") };
      expect(noBed.spots).toEqual(a.spots);                                       // spots and stations are what they always were
      expect(noBed.missions).toEqual(a.missions);
    }
  });
});
