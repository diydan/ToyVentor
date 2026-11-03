import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { READY_MADE_IDS, nearestReadyMade } from "../shared/forgeFallback";

const wardrobe = readFileSync(join(__dirname, "..", "parts/kip/viewer/kip-vehicles-wardrobe.js"), "utf8");

describe("the ready-made part nearest to a wish", () => {
  it("answers with ids and labels the bench really has (a drift check against its own lists)", () => {
    const hatBlock = wardrobe.slice(wardrobe.indexOf("export const HAT_OPTIONS"), wardrobe.indexOf("export const CROWN_OPTIONS"));
    const headBlock = wardrobe.slice(wardrobe.indexOf("export const WARDROBE_HEADS"), wardrobe.indexOf("export function headsInCategory"));
    for (const id of READY_MADE_IDS.hat) expect(hatBlock, `hat ${id}`).toContain(`id: '${id}'`);
    for (const id of READY_MADE_IDS.head) expect(headBlock, `head ${id}`).toContain(`id: '${id}'`);
    for (const kind of ["hat", "head"] as const) {
      for (const id of READY_MADE_IDS[kind]) {
        const r = nearestReadyMade(kind === "hat" ? `${id} hat` : `${id} head`, kind === "hat" ? "crown" : "head");
        const block = kind === "hat" ? hatBlock : headBlock;
        expect(block).toContain(`label: '${r.label}'`); // the label it shows is the bench's own
      }
    }
  });

  it("picks the nearest hat from the child's words", () => {
    expect(nearestReadyMade("a pirate hat")).toMatchObject({ kind: "hat", id: "pirate", exact: true });
    expect(nearestReadyMade("a hat for a cowboy", "crown")).toMatchObject({ kind: "hat", id: "cowboy" });
    expect(nearestReadyMade("a fancy magic hat")).toMatchObject({ kind: "hat", id: "tophat" });
    expect(nearestReadyMade("Mickey Mouse ears")).toMatchObject({ kind: "hat", id: "ears" });
    expect(nearestReadyMade("a unicorn")).toMatchObject({ kind: "hat", id: "horns" });
    expect(nearestReadyMade("A PIRATE'S HAT!!")).toMatchObject({ id: "pirate" }); // case and punctuation do not matter
    expect(nearestReadyMade("pirates")).toMatchObject({ id: "pirate" }); // a plural
  });

  it("picks the nearest head from the child's words", () => {
    expect(nearestReadyMade("a dragon head")).toMatchObject({ kind: "head", id: "dragon", exact: true });
    expect(nearestReadyMade("a robot head")).toMatchObject({ kind: "head", id: "robot" });
    expect(nearestReadyMade("my dog's face")).toMatchObject({ kind: "head", id: "fox" });
    expect(nearestReadyMade("a panda", "head")).toMatchObject({ kind: "head", id: "bear" });
    expect(nearestReadyMade("a grumpy troll")).toMatchObject({ kind: "head", id: "imp" }); // no word "head", but a head word wins
  });

  it("honours the child's choice of a hat or a head, and decides from the wish when there is none", () => {
    expect(nearestReadyMade("a dragon", "crown")).toMatchObject({ kind: "hat", id: "horns" }); // a dragon hat: horns
    expect(nearestReadyMade("a dragon", "head")).toMatchObject({ kind: "head", id: "dragon" });
    expect(nearestReadyMade("a cat head", "crown").kind).toBe("hat"); // they asked for a hat
    expect(nearestReadyMade("something cool").kind).toBe("hat"); // nothing says head: a hat
  });

  it("never answers nothing: a wish with no word in common gets a friendly default and says so", () => {
    expect(nearestReadyMade("zzz qqq")).toMatchObject({ kind: "hat", id: "hat", exact: false });
    expect(nearestReadyMade("zzz qqq", "head")).toMatchObject({ kind: "head", id: "kid", exact: false });
    expect(nearestReadyMade("")).toMatchObject({ exact: false });
    expect(nearestReadyMade("   ")).toMatchObject({ exact: false });
    expect(nearestReadyMade("😀😀")).toMatchObject({ exact: false });
    expect(nearestReadyMade("a".repeat(5000))).toMatchObject({ exact: false }); // no pathological input
  });

  it("is in the browser bundle, which carries no other module's text", () => {
    const flow = readFileSync(join(__dirname, "..", "shared/forgeMakeFlow.ts"), "utf8");
    expect(flow).toContain('export { nearestReadyMade, type ReadyMade } from "./forgeFallback"');
    const src = readFileSync(join(__dirname, "..", "shared/forgeFallback.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/\b(document|window|fetch|localStorage|Date\.now|Math\.random|performance\.now)\b/);
    expect(src.match(/^[ \t]*import\s.*$/gm)).toEqual(['import type { MakeSlot } from "./forgeMakeLimits";']);
  });
});
