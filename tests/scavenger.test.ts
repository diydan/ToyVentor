import { describe, expect, it } from "vitest";
import { SCAVENGER_QUESTS, scavengerVerdict, type ScavengerQuest } from "../src/lib/scavenger";

describe("S1 scavenger core (SAM spec §7.1)", () => {
  it("ships the launch concept quests with closed noun sets", () => {
    const concepts = SCAVENGER_QUESTS.map((q) => q.concept).sort();
    expect(concepts).toEqual(["gear", "lever", "wheel"]);
    for (const q of SCAVENGER_QUESTS) expect(q.nouns.length).toBeGreaterThan(0);
  });

  it("found only when a target noun was actually counted", () => {
    const lever = SCAVENGER_QUESTS.find((q) => q.concept === "lever") as ScavengerQuest;
    expect(scavengerVerdict(lever, { "door handle": 1 })).toMatchObject({ found: true, matchedNoun: "door handle" });
    expect(scavengerVerdict(lever, { "door handle": 0, cup: 3 }).found).toBe(false);
    expect(scavengerVerdict(lever, {}).found).toBe(false);
  });

  it("ignores nouns outside the quest set and negative counts", () => {
    const wheel = SCAVENGER_QUESTS.find((q) => q.concept === "wheel") as ScavengerQuest;
    expect(scavengerVerdict(wheel, { banana: 9 }).found).toBe(false);
    expect(scavengerVerdict(wheel, { wheel: -1 }).found).toBe(false);
    expect(scavengerVerdict(wheel, { wheel: 2 }).found).toBe(true);
  });
});
