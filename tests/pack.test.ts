import { describe, expect, it } from "vitest";
import baseSetJson from "../sets/base.json";
import {
  RARITY_PIPS,
  dailyPack,
  hashSeed,
  rarityForPart,
  sortPackForReveal,
} from "../shared/pack";
import type { ToySet } from "../shared/part";

const parts = (baseSetJson as ToySet).parts;

describe("dailyPack", () => {
  it("is deterministic per date and guarantees a printable first pick", () => {
    const a = dailyPack(parts, "2026-10-28");
    const b = dailyPack(parts, "2026-10-28");
    expect(a.map((p) => p.id)).toEqual(b.map((p) => p.id));
    expect(a).toHaveLength(3);
    expect(a[0]?.printable).toBe(true);
    expect(new Set(a.map((p) => p.id)).size).toBe(3);
  });

  it("varies across days", () => {
    const ids = new Set(
      ["2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"].map((d) =>
        dailyPack(parts, d).map((p) => p.id).join(","),
      ),
    );
    expect(ids.size).toBeGreaterThan(1);
  });

  it("derives display-only rarity from stat value", () => {
    expect(rarityForPart({ stat: { name: "speed", value: 1 } })).toBe("common");
    expect(rarityForPart({ stat: { name: "torque", value: 2 } })).toBe("uncommon");
    expect(rarityForPart({ stat: { name: "glow", value: 3 } })).toBe("rare");
  });

  it("sorts reveal cards from lowest rarity to highest while keeping tie order", () => {
    const sample = [
      { id: "r", stat: { name: "glow" as const, value: 3 } },
      { id: "c1", stat: { name: "spin" as const, value: 1 } },
      { id: "u", stat: { name: "speed" as const, value: 2 } },
      { id: "c2", stat: { name: "glow" as const, value: 1 } },
    ];
    expect(sortPackForReveal(sample).map((p) => p.id)).toEqual(["c1", "c2", "u", "r"]);

    // Every day's 3-card reveal ends on its highest-rarity pull.
    for (const date of ["2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"]) {
      const sorted = sortPackForReveal(dailyPack(parts, date));
      const ranks = sorted.map((p) => RARITY_PIPS[rarityForPart(p)]);
      expect(ranks[0]).toBeLessThanOrEqual(ranks[1]!);
      expect(ranks[1]).toBeLessThanOrEqual(ranks[2]!);
    }
  });

  it("hash is stable", () => {
    expect(hashSeed("2026-10-28")).toBe(hashSeed("2026-10-28"));
    expect(hashSeed("2026-10-28")).not.toBe(hashSeed("2026-10-29"));
  });
});
