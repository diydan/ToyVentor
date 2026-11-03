import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The ear and horn fitter (scripts/forge_optimizer_daemon.py `_fit_head_pair`) tries placements in order of how little they change the ask. A pair that only
// prints smaller (a monkey's or an elephant's big side ears) used to scan all 308 full-size placements first: 26 CPU-seconds before the first look. The order is now
// the cheapest EAR_FIT_FULL_SCALE_FIRST full-size placements, the smaller sizes, and only then the rest of the full-size ones. The answers are unchanged for all
// 21 heads measured on 2026-11-03 (same notes, same drops); these checks keep the order from drifting back, and keep the cap above every winner measured.
const daemon = readFileSync(join(__dirname, "..", "..", "scripts", "forge_optimizer_daemon.py"), "utf8");

describe("the ear fitter's search order", () => {
  const first = Number(/EAR_FIT_FULL_SCALE_FIRST = (\d+)/.exec(daemon)?.[1]);

  it("tries the cheapest full-size placements first, but not so few that a real winner is pushed behind a shrunk pair", () => {
    expect(Number.isFinite(first)).toBe(true);
    // the costliest full-size winner measured among real heads ranks 61 in the cost order (a hard horn pair moved 4.5 mm down and 12 mm apart);
    // a margin keeps a head slightly different from those on the full-size side
    expect(first).toBeGreaterThanOrEqual(62);
    expect(first).toBeLessThanOrEqual(150); // above this the first group is most of the old scan again
  });

  it("still ends with the rest of the full-size placements, so a head with no answer costs what it did and never loses one", () => {
    expect(daemon).toContain("(1.0, combos[:EAR_FIT_FULL_SCALE_FIRST])");
    expect(daemon).toContain("(1.0, combos[EAR_FIT_FULL_SCALE_FIRST:])");
    const order = [...daemon.matchAll(/\((1\.0|0\.9|0\.8|0\.7), combos\[[^\]]*\]\),/g)].map((m) => m[1]);
    expect(order).toEqual(["1.0", "0.9", "0.8", "0.7", "1.0"]);
  });
});
