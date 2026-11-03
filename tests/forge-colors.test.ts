import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COLOR_KEYS, colorKeyFromHex } from "../src/lib/propNames";
import { DEFAULT_FORGE_COLOR, FORGE_COLORS, forgeColorHex, isForgeColorKey } from "../shared/forgeColors";
import { voiceUrl } from "../shared/forgeMakeFlow";
import { parseVoiceKey } from "../worker/voice";

describe("the colours a child can give a part", () => {
  it("each hex is a valid colour that the app itself calls by the word on the swatch (so the picture and the voice agree)", () => {
    for (const c of FORGE_COLORS) {
      expect(c.hex, c.key).toMatch(/^#[0-9a-f]{6}$/i);
      expect(colorKeyFromHex(c.hex), `${c.key} ${c.hex}`).toBe(c.key);
    }
  });

  it("uses the app's own colour words, once each, and leaves out 'colorful' (it is not one colour)", () => {
    const keys = FORGE_COLORS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(COLOR_KEYS as readonly string[]).toContain(k);
    expect(keys).not.toContain("colorful" as never);
    expect(keys).toHaveLength(COLOR_KEYS.length - 1);
  });

  it("every swatch word is accepted by the Worker's voice route as the colour of a signed name", () => {
    const signed = { w: "wizard hat", g: "m" as const, sig: "A".repeat(43) };
    for (const c of FORGE_COLORS) {
      const key = parseVoiceKey(new URL(`http://x${voiceUrl("en", signed, c.key)}`));
      expect(key, c.key).toMatchObject({ lang: "en", color: c.key });
    }
  });

  it("falls back to the default for an unknown word, and the default is a swatch", () => {
    expect(forgeColorHex("nonsense")).toBe(forgeColorHex(DEFAULT_FORGE_COLOR));
    expect(isForgeColorKey(DEFAULT_FORGE_COLOR)).toBe(true);
    expect(isForgeColorKey("colorful")).toBe(false);
    expect(isForgeColorKey(42)).toBe(false);
  });

  it("stays pure and out of the way of the browser bundle's size: no imports, no DOM", () => {
    const src = readFileSync(join(__dirname, "..", "shared/forgeColors.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/\b(document|window|fetch|localStorage|Date\.now|Math\.random)\b/);
    expect(src.match(/^[ \t]*import\s.*$/gm) ?? []).toEqual([]);
  });
});
