// The new-player setup, phase 0 (src/lib/newPlayer.ts): names, the closed favourite lists, who needs a grown-up, the profile on the device, the song idea, the intro, the confetti.
import { describe, expect, it } from "vitest";
import {
  FAVOURITE_ANIMALS, FAVOURITE_COLOURS, FAVOURITE_FRUITS, NAME_MAX, PROFILE_KEY, buildProfile, cleanName, clearProfile, confetti, grownUpQuestion, introSlides, meetKipSlides, readProfile, saveProfile,
  HAIR_CHOICES, HAIR_COLOUR_CHOICES, HAT_CHOICES, PANTS_COLOURS, SKIN_CHOICES, TAIL_CHOICES, cleanKipConfig, defaultKipConfig,
  songIdea, stepsFor, type Draft, type Store,
} from "../src/lib/newPlayer";
import { PAINTS } from "../src/features/game/world/runtime/catalog";
import { ACT_FOR_PROP } from "../src/features/game/world/runtime/toyRoomActs";
import { readFileSync } from "node:fs";

const mem = (): Store & { data: Record<string, string> } => {
  const data: Record<string, string> = {};
  return { data, getItem: (k) => (k in data ? data[k]! : null), setItem: (k, v) => { data[k] = v; }, removeItem: (k) => { delete data[k]; } };
};
const draft = (over: Partial<Draft> = {}): Draft => ({ under13: true, kidName: "Mia", parentName: "Sam", favourites: { colour: "blue", fruit: "apple", animal: "elephant" }, songConsent: true, ...over });

describe("names", () => {
  it("accepts a first name or nickname in any language, with a space, hyphen or apostrophe between letters", () => {
    for (const n of ["Mia", "Zoë", "Åsa", "Jean-Luc", "O'Neil", "Mary Ann", "Chloé", "李雷", "Ömer"]) expect(cleanName(n), n).toEqual({ ok: true, name: n });
  });
  it("trims and collapses spaces", () => { expect(cleanName("  Mary   Ann ")).toEqual({ ok: true, name: "Mary Ann" }); });
  it("refuses what could carry contact details, a link or a number: digits, @, :, /, symbols, emoji", () => {
    for (const n of ["Mia2", "mia@x.com", "http://x", "a/b", "Mia!", "Mia 😀", "555-1234", "-Mia", "Mia-", "Mia--Lee", "'"]) expect(cleanName(n), n).toEqual({ ok: false, problem: "characters" });
  });
  it("says empty and too long", () => {
    for (const n of ["", "   ", undefined, null, 5]) expect(cleanName(n), String(n)).toEqual({ ok: false, problem: "empty" });
    expect(cleanName("a".repeat(NAME_MAX))).toMatchObject({ ok: true });
    expect(cleanName("a".repeat(NAME_MAX + 1))).toEqual({ ok: false, problem: "too-long" });
  });
});

describe("the closed lists", () => {
  it("have unique ids and labels and an icon each", () => {
    for (const list of [FAVOURITE_COLOURS, FAVOURITE_FRUITS, FAVOURITE_ANIMALS]) {
      expect(new Set(list.map((c) => c.id)).size).toBe(list.length);
      expect(new Set(list.map((c) => c.label)).size).toBe(list.length);
      for (const c of list) expect(c.icon.length).toBeGreaterThan(0);
    }
    expect(FAVOURITE_COLOURS.length).toBeGreaterThanOrEqual(6);
  });
  it("the colours start with the game's own paint swatches, in order, so the shirt takes exactly that colour", () => {
    expect(FAVOURITE_COLOURS.slice(0, PAINTS.length).map((c) => c.hex)).toEqual([...PAINTS]);
    for (const c of FAVOURITE_COLOURS) expect(c.hex).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("who needs a grown-up", () => {
  it("under 13 goes through the grown-up check and names the parent; 13 and over skips only the check", () => {
    expect(stepsFor(true)).toEqual(["who", "grownup", "names", "favourites", "dress", "song", "build", "intro"]);
    expect(stepsFor(false)).toEqual(["who", "names", "favourites", "dress", "song", "build", "intro"]);
  });
  it("the grown-up question is a small multiplication with the right answer, and survives a bad random draw", () => {
    for (const r of [0, 0.5, 0.999999, Number.NaN, 7, -3]) { const q = grownUpQuestion(() => r); expect(q.answer).toBe(q.a * q.b); expect(q.a).toBeGreaterThanOrEqual(6); expect(q.a).toBeLessThanOrEqual(9); }
  });
});

describe("the profile", () => {
  it("is built from a good draft and holds nothing else", () => {
    const r = buildProfile(draft(), "2026-11-04T22:00:00.000Z");
    expect(r).toEqual({ ok: true, profile: { version: 1, kidName: "Mia", parentName: "Sam", under13: true, favourites: { colour: "blue", fruit: "apple", animal: "elephant" }, songConsent: true, createdAt: "2026-11-04T22:00:00.000Z" } });
  });
  it("an under-13 setup needs the parent's name; a 13-and-over setup does not", () => {
    expect(buildProfile(draft({ parentName: "" }), "")).toEqual({ ok: false, problem: "parent name: empty" });
    expect(buildProfile(draft({ under13: false, parentName: "" }), "")).toMatchObject({ ok: true, profile: { parentName: "", under13: false } });
  });
  it("names the first thing that is wrong", () => {
    expect(buildProfile(draft({ kidName: "M1a" }), "")).toEqual({ ok: false, problem: "kid name: characters" });
    expect(buildProfile(draft({ favourites: { fruit: "apple", animal: "dog" } }), "")).toEqual({ ok: false, problem: "favourite colour" });
    expect(buildProfile(draft({ favourites: { colour: "blue", fruit: "kale", animal: "dog" } }), "")).toEqual({ ok: false, problem: "favourite fruit" });
    expect(buildProfile(draft({ favourites: { colour: "blue", fruit: "apple", animal: "ogre" } }), "")).toEqual({ ok: false, problem: "favourite animal" });
  });
  it("consent is only ever an explicit true", () => {
    expect(buildProfile(draft({ songConsent: "yes" as unknown as boolean }), "")).toMatchObject({ profile: { songConsent: false } });
  });
  it("saves, reads back, and forgets; a missing, hand-edited or old value reads as no profile", () => {
    const s = mem();
    expect(readProfile(s)).toBeNull();
    const p = (buildProfile(draft(), "t") as { profile: ReturnType<typeof readProfile> & object }).profile;
    expect(saveProfile(s, p)).toBe(true);
    expect(readProfile(s)).toEqual(p);
    s.data[PROFILE_KEY] = JSON.stringify({ ...p, kidName: "x@y.com" }); expect(readProfile(s)).toBeNull();
    s.data[PROFILE_KEY] = JSON.stringify({ ...p, version: 0 }); expect(readProfile(s)).toBeNull();
    s.data[PROFILE_KEY] = "{not json"; expect(readProfile(s)).toBeNull();
    saveProfile(s, p); clearProfile(s); expect(readProfile(s)).toBeNull();
    expect(saveProfile(null, p)).toBe(false);
    expect(readProfile(null)).toBeNull();
  });
});

describe("the song idea", () => {
  const profile = (consent: boolean) => (buildProfile(draft({ songConsent: consent }), "t") as { profile: Parameters<typeof songIdea>[0] }).profile;
  it("is one sentence made only from the first name and three picks from the lists", () => {
    expect(songIdea(profile(true))).toBe("a happy welcome song for Mia, who loves the colour blue, apple and elephants, and has just built a Kip to play with");
  });
  it("is null without the grown-up's yes, and the parent's name never appears in it", () => {
    expect(songIdea(profile(false))).toBeNull();
    expect(songIdea(profile(true))).not.toContain("Sam");
  });
});

describe("the intro", () => {
  const slides = introSlides("Mia");
  it("names the child, says the three tiers, the weekend challenge, STEM, printing and kits, each with the file it comes from", () => {
    expect(slides.map((s) => s.id)).toEqual(["welcome", "benefits", "tiers", "weekly", "stem", "real"]);
    expect(slides[0]!.title).toContain("Mia");
    const text = (id: string) => slides.find((s) => s.id === id)!.lines.join(" ");
    expect(text("tiers")).toMatch(/Starter.*Tinker.*Engineer/);
    expect(text("weekly")).toMatch(/Friday, Saturday and Sunday/);
    expect(text("stem")).toMatch(/Sprout.*Tinker.*Master/);
    expect(text("real")).toMatch(/3D printer/);
    for (const s of slides) { expect(s.source.length).toBeGreaterThan(0); expect(s.title.length).toBeGreaterThan(0); expect(s.lines.length).toBeGreaterThan(0); }
  });
  it("makes no claim the repo does not make: no standards alignment, no price, no subscription that exists", () => {
    const all = slides.flatMap((s) => [s.title, ...s.lines]).join(" ");
    expect(all).not.toMatch(/NGSS|standards|aligned|Common Core|\$|£|€|per month|subscribe now|buy/i);
    expect(slides.find((s) => s.id === "real")!.lines.join(" ")).toMatch(/coming soon/i);
  });
});

describe("confetti", () => {
  it("is the same every time for a seed, bounded, and only in the game's colours", () => {
    expect(confetti(40)).toEqual(confetti(40));
    expect(confetti(40)).not.toEqual(confetti(40, 8));
    expect(confetti(1000)).toHaveLength(120);
    expect(confetti(-5)).toEqual([]);
    const hexes = new Set(FAVOURITE_COLOURS.map((c) => c.hex));
    for (const p of confetti(60)) { expect(hexes.has(p.colour)).toBe(true); expect(p.left).toBeGreaterThanOrEqual(0); expect(p.left).toBeLessThanOrEqual(100); expect(p.duration).toBeGreaterThan(2); }
  });
});

describe("the meet-Kip cards say only what the Toy Room does", () => {
  const cards = meetKipSlides();
  const catalog = readFileSync(new URL("../src/features/game/world/runtime/catalog.ts", import.meta.url), "utf8");
  it("are walk, props and jobs, each with its source", () => {
    expect(cards.map((c) => c.id)).toEqual(["walk", "props", "jobs"]);
    for (const c of cards) { expect(c.source.length).toBeGreaterThan(0); expect(c.lines.join(" ").split(/\s+/).length).toBeLessThan(40); }
  });
  it("every prop the card names is in the Toy Room and does what the card says when tapped", () => {
    const text = cards.find((c) => c.id === "props")!.lines.join(" ");
    const claims: Array<[string, string, RegExp]> = [["xylophone", "mallet", /xylophone.*mallet/], ["teddy", "hug", /teddy to hug/], ["ball", "kick", /ball to kick/], ["bubbles", "blow", /bubbles to blow/], ["dog", "pet", /dog to pet/]];
    for (const [prop, act, words] of claims) {
      expect(text, prop).toMatch(words);
      expect(ACT_FOR_PROP[prop], prop).toBe(act);
      expect(catalog, prop).toContain(`{"type":"${prop}","x":`); // in the Toy Room's level
    }
  });
  it("the xylophone really is the first prop beside Kip's start (x 3.8, Kip starts at x 2)", () => {
    expect(catalog).toContain('"props":[{"type":"xylophone","x":3.8}');
  });
  it("the jobs card matches the two levels: a cleaning cart and a hob in the room, and no timer or failure in either", () => {
    expect(catalog).toContain('{"type":"cleancart","x":8}');
    expect(catalog).toContain('{"type":"hob","x":10}');
    expect(cards.find((c) => c.id === "jobs")!.lines.join(" ")).toMatch(/clean up a mess, or cook pancakes.*No timer and no losing/s);
  });
});

describe("dress your Kip", () => {
  it("offers only what the rig draws: the demo's 19 hairstyles (plus none) and 6 hair tones, 5 skin tones, the hats and tails the character rig has models for, and NO shoe colour", () => {
    expect(HAIR_CHOICES).toHaveLength(20);
    expect(HAIR_CHOICES[0]).toMatchObject({ id: "none" });
    expect(HAIR_COLOUR_CHOICES).toHaveLength(6);
    expect(SKIN_CHOICES).toHaveLength(5);
    expect(HAT_CHOICES.map((h) => h.id)).toEqual(["none", "wizard", "crown", "propcap", "cap", "flower"]);
    expect(TAIL_CHOICES.map((t) => t.id)).toEqual(["none", "curly", "fox", "dragon", "puff"]);
    const rig = readFileSync(new URL("../src/features/game/world/runtime/stlRigLoader.ts", import.meta.url), "utf8");
    const catalog = readFileSync(new URL("../src/features/game/world/runtime/catalog.ts", import.meta.url), "utf8");
    for (const h of HAT_CHOICES.filter((x) => x.id !== "none")) expect(rig, h.id).toMatch(new RegExp(`["']${h.id}["']`)); // every hat has a model
    for (const t of TAIL_CHOICES.filter((x) => x.id !== "none")) expect(catalog, t.id).toContain(`["character","tail","${t.id}"`); // every tail is a part
    expect(Object.keys(defaultKipConfig())).not.toContain("shoes");
    for (const list of [PANTS_COLOURS, SKIN_CHOICES, HAIR_COLOUR_CHOICES]) for (const c of list) expect(c.hex).toMatch(/^#[0-9a-f]{6}$/);
    for (const list of [HAIR_CHOICES, HAT_CHOICES, TAIL_CHOICES, PANTS_COLOURS, SKIN_CHOICES, HAIR_COLOUR_CHOICES]) expect(new Set(list.map((c) => c.id)).size).toBe(list.length);
  });
  it("starts as the stock Kip (the demo's skin and jeans and the chestnut Swept hair) in the favourite colour, and stays valid (with no colour given the shirt is the first swatch)", () => {
    expect(defaultKipConfig("#52B7FF")).toEqual({ shirt: "#52b7ff", pants: "#2b4c85", skin: "#f3ba95", hair: "short_swept", hairColour: "#6e412a", hat: "none", tail: "none" });
    expect(cleanKipConfig(defaultKipConfig("#52b7ff"))).toEqual(defaultKipConfig("#52b7ff"));
    expect(cleanKipConfig(defaultKipConfig())).not.toBeNull();
  });
  it("refuses anything that is not from the lists: another colour, an unknown hair, hat or tail, a missing field, not an object", () => {
    const ok = defaultKipConfig("#52b7ff");
    for (const bad of [{ ...ok, shirt: "#123456" }, { ...ok, pants: "red" }, { ...ok, skin: "#ffffff" }, { ...ok, hairColour: "#000000" }, { ...ok, hair: "mullet" }, { ...ok, hat: "tophat9" }, { ...ok, tail: "<b>" }, { ...ok, shirt: undefined }, null, "x", 5, []]) expect(cleanKipConfig(bad)).toBeNull();
    expect(cleanKipConfig({ ...ok, hair: "none", hat: "crown", tail: "dragon" })).toMatchObject({ hair: "none", hat: "crown", tail: "dragon" });
  });
});

