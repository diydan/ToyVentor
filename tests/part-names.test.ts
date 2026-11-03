import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COLOR_KEYS, LANGUAGES, colorKeyFromHex, type ColorKey, type LangCode } from "../src/lib/propNames";
import { PART_IDS, isPartId, partNoun, partPhrase } from "../src/lib/partNames";

const root = new URL("..", import.meta.url).pathname;
const partsJson = JSON.parse(readFileSync(join(root, "parts/kip/viewer/kip-describe-parts.json"), "utf8")) as { parts: Record<string, { category: string; label: string }> };
const langs = LANGUAGES.map((l) => l.code as LangCode);

describe("part names cover everything Describe & Build can show", () => {
  it("has names for exactly the curated parts (add a part to kip-describe-parts.json and this fails until it is named)", () => {
    const curated = Object.keys(partsJson.parts).sort();
    expect(curated.length).toBe(30);
    expect([...PART_IDS].sort()).toEqual(curated);
  });
  it("names every part in every language, and every phrase is clean", () => {
    for (const id of PART_IDS) for (const lang of langs) {
      expect(partNoun(id, lang), `${id}/${lang}`).not.toBeNull();
      for (const color of [null, ...COLOR_KEYS] as Array<ColorKey | null>) {
        const p = partPhrase(id, color, lang)!;
        expect(p, `${id}/${lang}/${color}`).toMatch(/^\S.*\S$/);
        expect(p).not.toMatch(/undefined|null|NaN|\s{2,}|:/);
      }
    }
  });
  it("recognises part ids and refuses anything else", () => {
    expect(isPartId("veh_wheel_sport")).toBe(true);
    for (const bad of ["", "tree", "constructor", "__proto__", "veh_wheel_sport ", null, undefined, 7]) expect(isPartId(bad)).toBe(false);
    expect(partPhrase("nope", "red", "en")).toBeNull();
  });
});

describe("part phrases agree with the noun", () => {
  it("English and Turkish put the colour first", () => {
    expect(partPhrase("veh_wheel_sport", "black", "en")).toBe("black sport wheel");
    expect(partPhrase("hat_cowboy", "yellow", "tr")).toBe("sarı kovboy şapkası");
    expect(partPhrase("racer_spoiler", "red", "tr")).toBe("kırmızı spoyler");
  });
  it("Spanish, French, Italian and Portuguese put it after and agree", () => {
    expect(partPhrase("veh_wheel_sport", "black", "es")).toBe("rueda deportiva negra"); // feminine
    expect(partPhrase("veh_car_chassis", "blue", "es")).toBe("chasis de coche azul");
    expect(partPhrase("racer_spoiler", "red", "it")).toBe("alettone rosso"); // masculine
    expect(partPhrase("veh_wheel_moto", "black", "it")).toBe("ruota della moto nera"); // feminine
    expect(partPhrase("hair_bob", "brown", "fr")).toBe("cheveux marron"); // plural, invariant colour
    expect(partPhrase("char_legs_seated", "white", "pt")).toBe("pernas brancas"); // feminine plural
    expect(partPhrase("hat_tophat", "yellow", "pt")).toBe("cartola amarela"); // the one feminine hat
    expect(partPhrase("robot_arms_grabber", "white", "es")).toBe("brazos blancos"); // masculine plural
  });
  it("German inflects the colour for gender and number", () => {
    expect(partPhrase("hat_cowboy", "yellow", "de")).toBe("gelber Cowboyhut"); // m
    expect(partPhrase("veh_wheel_sport", "black", "de")).toBe("schwarzes Sportrad"); // n
    expect(partPhrase("racer_axle", "black", "de")).toBe("schwarze Rennachse"); // f
    expect(partPhrase("hair_bob", "brown", "de")).toBe("braune Haare"); // plural
    expect(partPhrase("char_head_tall", "white", "de")).toBe("weißer hoher Kopf");
  });
  it("says just the part when no colour is given", () => {
    expect(partPhrase("hat_tophat", null, "de")).toBe("Zylinder");
    expect(partPhrase("racer_spoiler", null, "en")).toBe("spoiler");
  });
});

describe("the colour a kid hears matches the colour the exploded view draws", () => {
  const view = readFileSync(join(root, "parts/kip/viewer/kip-describe-view.js"), "utf8");
  const palette = /const CATEGORY_COLOURS = \{([\s\S]*?)\};/.exec(view)?.[1] ?? "";
  const byCategory = Object.fromEntries([...palette.matchAll(/(\w+):\s*\[([^\]]*)\]/g)].map((m) => [m[1]!, [...m[2]!.matchAll(/#[0-9a-fA-F]{6}/g)].map((h) => h[0])]));
  const expected: Record<string, ColorKey[]> = {
    vehicle: ["blue", "green", "yellow"], wheel: ["black"], addon: ["red"], character: ["white"], hair: ["brown"], hat: ["yellow"],
  };
  it("finds the palette in the view (so this cannot silently pass on a parse failure)", () => {
    expect(Object.keys(byCategory).sort()).toEqual(Object.keys(expected).sort());
  });
  it("names every drawn colour with the colour word a child would use", () => {
    for (const [cat, hexes] of Object.entries(byCategory)) {
      expect(hexes.map((h) => colorKeyFromHex(h)), cat).toEqual(expected[cat]);
    }
  });
  it("every part's category has a palette", () => {
    for (const [id, p] of Object.entries(partsJson.parts)) expect(byCategory[p.category], id).toBeDefined();
  });
});
