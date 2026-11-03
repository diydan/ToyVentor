import { afterEach, beforeEach, describe, expect, it } from "vitest";
import baseSetJson from "../sets/base.json";
import type { Placement } from "../shared/build";
import { buildSignature, characterFromBuild } from "../shared/reveal";
import type { ToySet } from "../shared/part";
import type { Toy } from "../shared/toy";
import { loadReveals, revealForBuild, revealsForToy, saveReveal } from "../src/state/reveals";

// Day 8 goal check: "plays once, then saves". The overlay plays the entrance theme only when GameCanvas opens it with
// first:true, and GameCanvas decides that with `!revealForBuild(toy.id, signature)`; the overlay then calls saveReveal on
// mount. These tests pin the persistence half of that contract (the audio and the React wiring are not covered here).

const KEY = "toyforge:reveals:v1";
const byId = new Map((baseSetJson as ToySet).parts.map((p) => [p.id, p]));
const toy: Toy = {
  id: "seed-car", name: "Seed Car", kind: "car", sizeClass: "small",
  lengthMm: 110, widthMm: 55, attachPoints: [{ id: "roof", label: "Roof" }], source: "seed",
};
const buildA: Placement[] = [
  { instanceId: "1", partId: "racer-spoiler", xMm: 0, yMm: 0, rotation: 0 },
  { instanceId: "2", partId: "glow-capsule", xMm: 25, yMm: 0, rotation: 0 },
];
const buildB: Placement[] = buildA.map((p) => (p.instanceId === "2" ? { ...p, xMm: 37.5 } : p));
const cardFor = (t: Toy, b: Placement[]) => characterFromBuild(t, b, byId, "2026-11-02");

function makeMemoryStorage(options?: { throwOnSet?: boolean; throwOnGet?: boolean }) {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => {
      if (options?.throwOnGet) throw new Error("SecurityError");
      return map.has(k) ? map.get(k)! : null;
    },
    setItem: (k: string, v: string) => {
      if (options?.throwOnSet) throw new Error("QuotaExceededError");
      map.set(k, String(v));
    },
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  };
}

const g = globalThis as unknown as { localStorage?: unknown };
const original = g.localStorage;
const install = (s: unknown) => { Object.defineProperty(globalThis, "localStorage", { value: s, configurable: true, writable: true }); };
beforeEach(() => install(makeMemoryStorage()));
afterEach(() => install(original));

describe("Reveal plays once, then saves", () => {
  it("a build with no saved card is a first Reveal; saving it makes the next open not a first Reveal", () => {
    const card = cardFor(toy, buildA);
    expect(revealForBuild(toy.id, card.signature)).toBeUndefined(); // GameCanvas: first:true -> theme plays
    expect(saveReveal(card)).toBe(true); // overlay saves on mount
    expect(revealForBuild(toy.id, card.signature)?.id).toBe(card.id); // GameCanvas: card exists -> no replay
    expect(saveReveal(card)).toBe(false); // opening it again never re-saves
    expect(loadReveals()).toHaveLength(1);
  });

  it("an identical rebuild in a different placement order is the same character", () => {
    const reordered = [...buildA].reverse().map((p) => ({ ...p, instanceId: `r${p.instanceId}` }));
    saveReveal(cardFor(toy, buildA));
    expect(revealForBuild(toy.id, buildSignature(reordered))).toBeDefined();
  });

  it("rebuilding differently is a new character that gets its own first Reveal", () => {
    saveReveal(cardFor(toy, buildA));
    const b = cardFor(toy, buildB);
    expect(revealForBuild(toy.id, b.signature)).toBeUndefined();
    expect(saveReveal(b)).toBe(true);
    expect(revealsForToy(toy.id)).toHaveLength(2);
  });

  it("the same build on a different toy is a different character", () => {
    const other: Toy = { ...toy, id: "other-car", name: "Other Car" };
    saveReveal(cardFor(toy, buildA));
    expect(revealForBuild(other.id, buildSignature(buildA))).toBeUndefined();
    expect(saveReveal(cardFor(other, buildA))).toBe(true);
    expect(revealsForToy(toy.id)).toHaveLength(1);
    expect(revealsForToy(other.id)).toHaveLength(1);
  });

  it("survives a reload: saved cards come back from storage", () => {
    saveReveal(cardFor(toy, buildA));
    const raw = (globalThis.localStorage as ReturnType<typeof makeMemoryStorage>).getItem(KEY);
    install(makeMemoryStorage()); // a fresh page with the same storage contents
    (globalThis.localStorage as ReturnType<typeof makeMemoryStorage>).setItem(KEY, raw as string);
    expect(revealForBuild(toy.id, buildSignature(buildA))?.title).toMatch(/Seed Car$/);
  });
});

describe("Reveal storage failures never throw", () => {
  it("corrupt JSON or a non-array value reads as no cards", () => {
    const s = makeMemoryStorage(); install(s);
    s.setItem(KEY, "{not json");
    expect(loadReveals()).toEqual([]);
    s.setItem(KEY, JSON.stringify({ not: "an array" }));
    expect(loadReveals()).toEqual([]);
    expect(saveReveal(cardFor(toy, buildA))).toBe(true); // recovers: the bad value is replaced
    expect(loadReveals()).toHaveLength(1);
  });

  it("storage that refuses writes still shows the card this session (known: it will replay on every open)", () => {
    install(makeMemoryStorage({ throwOnSet: true }));
    const card = cardFor(toy, buildA);
    expect(saveReveal(card)).toBe(true);
    expect(saveReveal(card)).toBe(true); // nothing persisted, so each open looks like a first Reveal
    expect(loadReveals()).toEqual([]);
  });

  it("storage that refuses reads (private mode) reads as empty and does not throw", () => {
    install(makeMemoryStorage({ throwOnGet: true }));
    expect(loadReveals()).toEqual([]);
    expect(revealForBuild(toy.id, "anything")).toBeUndefined();
    expect(() => saveReveal(cardFor(toy, buildA))).not.toThrow();
  });
});
