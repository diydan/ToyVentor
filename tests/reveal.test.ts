import { describe, expect, it } from "vitest";
import baseSetJson from "../sets/base.json";
import type { Placement } from "../shared/build";
import { buildSignature, characterFromBuild, themeNotes } from "../shared/reveal";
import type { ToySet } from "../shared/part";
import type { Toy } from "../shared/toy";

const byId = new Map((baseSetJson as ToySet).parts.map((p) => [p.id, p]));
const toy: Toy = {
  id: "seed-car", name: "Seed Car", kind: "car", sizeClass: "small",
  lengthMm: 110, widthMm: 55,
  attachPoints: [{ id: "roof", label: "Roof" }], source: "seed",
};
const build: Placement[] = [
  { instanceId: "1", partId: "racer-spoiler", xMm: 0, yMm: 0, rotation: 0 },
  { instanceId: "2", partId: "glow-capsule", xMm: 25, yMm: 0, rotation: 0 },
];

describe("buildSignature", () => {
  it("ignores placement order and instance ids", () => {
    const reordered = [...build].reverse().map((p) => ({ ...p, instanceId: "x" }));
    expect(buildSignature(reordered)).toBe(buildSignature(build));
  });
  it("changes when a part moves", () => {
    const moved = build.map((p) => (p.instanceId === "2" ? { ...p, xMm: 37.5 } : p));
    expect(buildSignature(moved)).not.toBe(buildSignature(build));
  });
});

describe("characterFromBuild", () => {
  it("is deterministic and led by the strongest stat", () => {
    const a = characterFromBuild(toy, build, byId, "2026-10-28");
    const b = characterFromBuild(toy, build, byId, "2026-10-28");
    expect(a).toEqual(b);
    expect(a.leadStat).toBe("glow"); // glow-capsule glow +3 beats spoiler speed +2
    expect(a.title).toMatch(/Seed Car$/);
    expect(a.partNames).toEqual(["Spoiler", "Glow Capsule"]);
  });
});

describe("themeNotes", () => {
  it("gives 16 in-scale notes, same build same theme", () => {
    const sig = buildSignature(build);
    const notes = themeNotes(sig);
    expect(notes).toHaveLength(16);
    expect(themeNotes(sig)).toEqual(notes);
    const scale = new Set([261.63, 293.66, 329.63, 392, 440, 523.25, 587.33]);
    expect(notes.every((n) => scale.has(n))).toBe(true);
    expect(themeNotes("another-build")).not.toEqual(notes);
  });
});
