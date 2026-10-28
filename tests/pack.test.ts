import { describe, expect, it } from "vitest";
import baseSetJson from "../sets/base.json";
import { dailyPack, hashSeed } from "../shared/pack";
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

  it("hash is stable", () => {
    expect(hashSeed("2026-10-28")).toBe(hashSeed("2026-10-28"));
    expect(hashSeed("2026-10-28")).not.toBe(hashSeed("2026-10-29"));
  });
});
