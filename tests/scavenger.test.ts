import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  SCAVENGER_QUESTS,
  SCAVENGER_REWARD_GLB,
  scavengerHint,
  scavengerMissText,
  scavengerVerdict,
  scavengerVerdictFromNames,
  type ScavengerQuest,
} from "../src/lib/scavenger";

const quest = (concept: string) => SCAVENGER_QUESTS.find((q) => q.concept === concept) as ScavengerQuest;

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

  describe("the verdict from the helper's names (the camera)", () => {
    it("finds a wheel in what a home would call one", () => {
      expect(scavengerVerdictFromNames(quest("wheel"), ["toy car"])).toMatchObject({ found: true, matchedNoun: "toy car", name: "toy car" });
      expect(scavengerVerdictFromNames(quest("wheel"), ["old bicycle wheel"])).toMatchObject({ found: true, matchedNoun: "wheel", name: "old bicycle wheel" });
      expect(scavengerVerdictFromNames(quest("wheel"), ["bike wheel"]).found).toBe(true);
    });

    it("finds a lever and a gear too", () => {
      for (const n of ["door handle", "faucet", "light switch", "scissors"]) expect(scavengerVerdictFromNames(quest("lever"), [n]).found, n).toBe(true);
      for (const n of ["clock", "gear", "cog"]) expect(scavengerVerdictFromNames(quest("gear"), [n]).found, n).toBe(true);
    });

    it("the second or third name can verify it, in order", () => {
      expect(scavengerVerdictFromNames(quest("gear"), ["table", "clock", "cup"])).toMatchObject({ found: true, matchedNoun: "clock", name: "clock" });
    });

    it("a name outside the quest's closed list never verifies it, even a near one", () => {
      expect(scavengerVerdictFromNames(quest("wheel"), ["cup", "spoon"]).found).toBe(false);
      expect(scavengerVerdictFromNames(quest("wheel"), ["wheelbarrow"]).found).toBe(false); // whole words only
      expect(scavengerVerdictFromNames(quest("lever"), ["toy car"]).found).toBe(false); // another quest's word
      expect(scavengerVerdictFromNames(quest("gear"), []).found).toBe(false);
    });

    it("odd text from a misbehaving server is only ever compared, never shown", () => {
      expect(scavengerVerdictFromNames(quest("wheel"), ["<b>wheel</b>"]).name).toBe("b wheel b"); // cleaned to letters and spaces
      expect(scavengerVerdictFromNames(quest("wheel"), [undefined as unknown as string, "", "   "]).found).toBe(false);
    });
  });

  it("every part reward is a real model that ships, and only gear and wheel have one", () => {
    expect(Object.keys(SCAVENGER_REWARD_GLB).sort()).toEqual(["gear", "wheel"]);
    for (const r of Object.values(SCAVENGER_REWARD_GLB)) expect(existsSync(resolve(__dirname, `../public/parts-glb/${r!.glb}`)), r!.glb).toBe(true);
  });

  it("the camera copy is warm: it never says wrong, and says what it saw", () => {
    for (const q of SCAVENGER_QUESTS) {
      expect(scavengerHint(q).length).toBeGreaterThan(20);
      expect(scavengerMissText(q, "cup")).toMatch(/I can see a cup/);
      expect(scavengerMissText(q, null)).not.toMatch(/I can see/);
      expect(`${scavengerHint(q)} ${scavengerMissText(q, "cup")}`).not.toMatch(/wrong|fail|bad|incorrect/i);
    }
  });
});
