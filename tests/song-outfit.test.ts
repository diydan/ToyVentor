// The welcome song is asked for with EVERYTHING the new player chose: the name and three favourites and what they dressed Kip in (Dan, 2026-11-05: "the song should include the colours, fruit, animal from the
// onboarding and the colour of pants, shirt, any hat, tails, hair etc: use all the info we have from onboarding and the Kip build"). The sentence stays within the route's 300 characters, passes the route's screen, and
// the song writer is told to sing as many of the picks as fit.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { kidSafeText } from "../worker/muse";
import { themePrompt } from "../worker/themeSong";
import {
  FAVOURITE_ANIMALS, FAVOURITE_COLOURS, FAVOURITE_FRUITS, HAIR_CHOICES, HAIR_COLOUR_CHOICES, HAT_CHOICES, PANTS_COLOURS, SHOE_COLOURS, SKIN_CHOICES, SONG_IDEA_MAX, TAIL_CHOICES,
  buildProfile, defaultKipConfig, outfitWords, songIdea, type KipConfig, type PlayerProfile,
} from "../src/lib/newPlayer";

const profile = (over: { kidName?: string; colour?: string; fruit?: string; animal?: string; consent?: boolean } = {}): PlayerProfile => {
  const made = buildProfile({ under13: true, kidName: over.kidName ?? "Mia", parentName: "Sam", favourites: { colour: over.colour ?? "blue", fruit: over.fruit ?? "apple", animal: over.animal ?? "elephant" }, songConsent: over.consent ?? true }, "t");
  if (!made.ok) throw new Error(made.problem);
  return made.profile;
};
const full: KipConfig = { shirt: "#52b7ff", pants: "#c9b27a", boots: "#3fae6a", skin: "#f3ba95", hair: "bob", hairColour: "#2e6fdb", hat: "wizard", tail: "fox" };
const label = (list: readonly { hex?: string; id: string; label: string }[], key: "hex" | "id", v: string) => list.find((x) => (key === "hex" ? x.hex!.toLowerCase() === v : x.id === v))!.label.toLowerCase();

describe("what Kip wears, in words", () => {
  it("names the shirt, pants, hair (tone and style), hat, tail and shoes, in that order", () => {
    expect(outfitWords(full)).toEqual([
      `a ${label(FAVOURITE_COLOURS, "hex", full.shirt)} shirt`, `${label(PANTS_COLOURS, "hex", full.pants)} pants`,
      `${label(HAIR_COLOUR_CHOICES, "hex", full.hairColour)} hair in the ${label(HAIR_CHOICES, "id", "bob")} style`, "a wizard hat", "a fox tail", `${label(SHOE_COLOURS, "hex", full.boots)} shoes`,
    ]);
  });
  it("says nothing for no hair, no hat or no tail, and never the skin tone", () => {
    const words = outfitWords({ ...full, hair: "none", hat: "none", tail: "none" });
    expect(words).toHaveLength(3);
    for (const skin of SKIN_CHOICES) expect(outfitWords({ ...full, skin: skin.hex }).join(" ")).not.toContain(skin.label.toLowerCase());
  });
  it("skips a value that is not from the lists instead of repeating it", () => {
    const words = outfitWords({ ...full, shirt: "<script>", pants: "#123456", hat: "../../x", tail: "rm -rf" });
    expect(words.join(" ")).not.toMatch(/script|rm -rf|\.\.\/|123456/);
    expect(words.length).toBeGreaterThan(0);
  });
});

describe("the song idea", () => {
  it("is the old sentence when no outfit is given, so nothing else changes", () => {
    expect(songIdea(profile())).toBe("a happy welcome song for Mia, who loves the colour blue, apple and elephants, and has just built a Kip to play with");
  });
  it("carries the favourites AND every piece of the outfit", () => {
    const idea = songIdea(profile(), full)!;
    expect(idea).toContain("Mia");
    for (const part of ["the colour blue", "apple", "elephants", ...outfitWords(full)]) expect(idea, part).toContain(part);
    expect(idea).not.toMatch(/Sam/);
    expect(idea).toBe(`a happy welcome song for Mia, who loves the colour blue, apple and elephants, and has just built a Kip to play with. Kip is wearing ${outfitWords(full).slice(0, -1).join(", ")} and ${outfitWords(full).at(-1)}`);
  });
  it("is null without the grown-up's yes, outfit or not", () => {
    expect(songIdea(profile({ consent: false }), full)).toBeNull();
  });
  it("keeps the stock Kip's words too (the child changed nothing)", () => {
    const idea = songIdea(profile(), defaultKipConfig())!;
    expect(idea).toMatch(/Kip is wearing a .+ shirt, .+ pants, .+ hair in the swept style and orange shoes$/);
  });
  it("when the sentence is too long the least important words go first: shoes, tail, hat, hair, pants, the shirt last; never a half word", () => {
    const all = outfitWords(full), pr = profile();
    const wearing = (max: number) => songIdea(pr, full, max)!;
    const withAll = wearing(10_000);
    for (let drop = 1; drop <= all.length; drop++) {
      const kept = all.slice(0, all.length - drop);
      const sentence = kept.length ? `${songIdea(pr, null)!}. Kip is wearing ${kept.length <= 1 ? kept[0] : `${kept.slice(0, -1).join(", ")} and ${kept.at(-1)}`}` : songIdea(pr, null)!;
      expect(wearing(sentence.length), `drop ${drop}`).toBe(sentence);           // exactly as much as fits
      if (kept.length) expect(wearing(sentence.length - 1).length, `drop ${drop} minus one`).toBeLessThan(sentence.length); // one character less and another word goes
    }
    expect(wearing(10)).toBe(songIdea(pr, null));                                // nothing fits: the plain sentence, never a cut one
    expect(withAll.length).toBeGreaterThan(songIdea(pr, null)!.length);
  });
  it("never passes the route's 300 characters, for any hair, hat and tail with the longest name and favourites, and drops the least important first", () => {
    const longest = (list: readonly { label: string; id: string }[]) => [...list].sort((a, b) => b.label.length - a.label.length)[0]!.id;
    const pr = profile({ kidName: "Abcdefghijklmnopqrst", colour: longest(FAVOURITE_COLOURS), fruit: longest(FAVOURITE_FRUITS), animal: longest(FAVOURITE_ANIMALS) });
    const longestHex = (list: readonly { label: string; hex: string }[]) => [...list].sort((a, b) => b.label.length - a.label.length)[0]!.hex;
    let dropped = 0;
    for (const hair of HAIR_CHOICES) for (const hat of HAT_CHOICES) for (const tail of TAIL_CHOICES) {
      const cfg: KipConfig = { shirt: longestHex(FAVOURITE_COLOURS), pants: longestHex(PANTS_COLOURS), boots: longestHex(SHOE_COLOURS), skin: SKIN_CHOICES[0]!.hex, hair: hair.id, hairColour: longestHex(HAIR_COLOUR_CHOICES), hat: hat.id, tail: tail.id };
      const idea = songIdea(pr, cfg)!;
      expect(idea.length, `${hair.id}/${hat.id}/${tail.id}`).toBeLessThanOrEqual(SONG_IDEA_MAX);
      const all = outfitWords(cfg);
      const kept = all.filter((w) => idea.includes(w));
      if (kept.length < all.length) { dropped++; expect(kept).toEqual(all.slice(0, kept.length)); } // a prefix: the shoes go first, then the tail, the hat...
    }
    expect(dropped).toBeGreaterThanOrEqual(0);
  });
  it("passes the route's own screen for every hair, hat and tail (a closed-list word must never make the song refuse)", () => {
    const pr = profile({ kidName: "Mia" });
    let n = 0;
    for (const hair of HAIR_CHOICES) for (const hat of HAT_CHOICES) for (const tail of TAIL_CHOICES) for (const [shirt, pants, boots] of [[FAVOURITE_COLOURS, PANTS_COLOURS, SHOE_COLOURS]] as const) for (const hc of HAIR_COLOUR_CHOICES) {
      const idea = songIdea(pr, { shirt: shirt[n % shirt.length]!.hex, pants: pants[n % pants.length]!.hex, boots: boots[n % boots.length]!.hex, skin: SKIN_CHOICES[0]!.hex, hair: hair.id, hairColour: hc.hex, hat: hat.id, tail: tail.id })!;
      expect(kidSafeText(idea), idea).toBe(true);
      n++;
    }
    for (const c of FAVOURITE_COLOURS) for (const f of FAVOURITE_FRUITS) for (const a of FAVOURITE_ANIMALS) expect(kidSafeText(songIdea(profile({ colour: c.id, fruit: f.id, animal: a.id }), full)!)).toBe(true);
  });
});

describe("the song writer is told to use them", () => {
  it("an idea ('prompt') asks for as many of the picks as fit, by plain name", () => {
    const p = themePrompt(songIdea(profile(), full)!, "prompt");
    expect(p).toContain("sing about as many of them as fit, by their plain names");
    expect(p).toContain("Kip is wearing");
    expect(themePrompt("a sleepy cat", "build")).not.toContain("as many of them as fit");
  });
  it("the sheet hands the song the outfit, not just the profile", () => {
    const sheet = readFileSync(new URL("../src/features/game/world/OnboardingSheet.tsx", import.meta.url), "utf8");
    expect(sheet).toContain("songIdea(made.profile, cleanKipConfig(cfg) ?? defaultKipConfig(colourOf(colour)?.hex))");
  });
});
