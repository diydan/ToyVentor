/**
 * shapeModelText (worker/forgeMake.ts): every piece of model text a child can read or hear goes through it, and it says WHY a piece was changed: "brand" and "unsafe" are the filters doing safety work,
 * "echo" is a name that is fine but copies the child's words (the app then speaks the English name). The same function scores stored answers (scripts/tuning/rescore.ts), so the two cannot drift.
 */
import { describe, expect, it } from "vitest";
import { shapeModelText } from "../worker/forgeMake";

const NAMES = {
  en: { w: "wizard hat", g: "m" }, es: { w: "sombrero de mago", g: "m" }, fr: { w: "chapeau de magicien", g: "m" }, de: { w: "Zauberhut", g: "m" },
  it: { w: "cappello da mago", g: "m" }, pt: { w: "chapéu de mago", g: "m" }, tr: { w: "büyücü şapkası", g: "m" },
};

describe("shapeModelText: what is changed, and why", () => {
  it("clean text passes untouched, all seven names kept", () => {
    const r = shapeModelText("Starlight Wizard Hat", "Tall hat that clicks on", NAMES, "a wizard hat");
    expect(r).toMatchObject({ name: "Starlight Wizard Hat", behavior: "Tall hat that clicks on", nameVerdict: "ok", behaviorVerdict: "ok" });
    expect(Object.keys(r.names)).toHaveLength(7);
    expect(r.dropped).toEqual([]);
  });
  it("a name that just copies a short wish is an ECHO, not a safety fire; the part is renamed and the app will speak the English name", () => {
    const r = shapeModelText("Ninja Hat", "A hat", NAMES, "ninja hat");
    expect(r.nameVerdict).toBe("echo");
    expect(r.name).toBe("My Creation");
    const r2 = shapeModelText("Ninja Shadow Hat", "A hat", { ...NAMES, en: { w: "Ninja Hat", g: "m" } }, "ninja hat");
    expect(r2.nameVerdict).toBe("ok"); // the recipe's own name is fine, so it stands in for the English one and all seven names stay
    expect(Object.keys(r2.names)).toHaveLength(7);
  });
  it("a brand in the name, the line or a language's name is a BRAND verdict: the name becomes My Creation, the line is replaced, and only that language is dropped", () => {
    const r = shapeModelText("Cocomelon Star Hat", "Sings like Baby Shark", { ...NAMES, fr: { w: "chapeau Bluey", g: "m" } }, "a cocomelon hat");
    expect(r).toMatchObject({ name: "My Creation", nameVerdict: "brand", behavior: "Made from your idea", behaviorVerdict: "brand" });
    expect(r.dropped).toContainEqual({ lang: "fr", reason: "brand" });
    expect(r.names.fr).toBeUndefined();
    expect(r.names.de).toBeDefined();
  });
  it("an unsafe word is an UNSAFE verdict, and it is not mistaken for an echo", () => {
    const r = shapeModelText("Knife Wizard Hat", "A hat", { ...NAMES, es: { w: "cuchillo", g: "m" } }, "a wizard hat");
    expect(r.nameVerdict).toBe("unsafe");
    expect(r.dropped).toContainEqual({ lang: "es", reason: "unsafe" });
  });
  it("a language whose name only copies the wish is dropped as ECHO, the rest stay", () => {
    const r = shapeModelText("Cozy Wool Knit Hat", "A hat", { ...NAMES, es: { w: "gorro de lana", g: "m" } }, "gorro de lana");
    expect(r.dropped).toContainEqual({ lang: "es", reason: "echo" });
    expect(r.dropped.filter((d) => d.reason === "brand" || d.reason === "unsafe")).toEqual([]);
    expect(Object.keys(r.names)).toHaveLength(6);
  });
  it("with no good English name nothing is kept, whatever the reason", () => {
    const r = shapeModelText("Starlight Hat", "A hat", { ...NAMES, en: { w: "Cocomelon", g: "m" } }, "a hat");
    expect(r.names).toEqual({});
  });
});
