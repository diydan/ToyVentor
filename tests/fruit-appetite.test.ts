import { describe, expect, it } from "vitest";
import { FULL_AFTER, FULL_FOR_S, FULL_WINDOW_S, createAppetite } from "../src/features/game/world/runtime/fruitAppetite";
import { FRUIT, type FruitKind } from "../src/features/game/world/runtime/propReactions";

// What a toy does with a fruit it is given: the rules behind drag-to-feed (docs/specs/playful-interactions-spec.md section 4).
function clock(start = 1000) { let t = start; return { now: () => t, advance: (s: number) => { t += s; } }; }
// (the pumpkin is named but too big to eat: it has its own test below)
const foods = (Object.keys(FRUIT) as FruitKind[]).filter((k) => FRUIT[k].noun && k !== "pumpkin");

describe("each kind of toy reacts in its own way", () => {
  it("a character eats", () => {
    const c = clock();
    expect(createAppetite(c.now).offer("apple", "character")).toEqual({ fed: true, reaction: "eat", full: false });
  });
  it("a lemon makes a character pull a sour face, and nothing else does", () => {
    for (const k of foods) expect(createAppetite(clock().now).offer(k, "character").reaction, k).toBe(k === "lemon" ? "sour" : "eat");
  });
  it("a robot crunches", () => {
    expect(createAppetite(clock().now).offer("pear", "robot")).toMatchObject({ fed: true, reaction: "crunch" });
  });
  it("a vehicle politely declines: the fruit is not taken, and refusing never counts towards being full", () => {
    const a = createAppetite(clock().now);
    for (let i = 0; i < 6; i++) expect(a.offer("apple", "vehicle")).toEqual({ fed: false, reaction: "decline", full: false });
    expect(a.isFull).toBe(false);
  });
  it("snow and rain are not food, whoever is asked", () => {
    for (const k of ["snow", "rain"] as const) for (const e of ["character", "robot", "vehicle"] as const) expect(createAppetite(clock().now).offer(k, e).fed, `${k}/${e}`).toBe(false);
  });
  it("every named fruit can be eaten by a character and a robot", () => {
    expect(foods.length).toBeGreaterThanOrEqual(11);                       // (eleven with the green apple, the pumpkin left out)
    for (const k of foods) for (const e of ["character", "robot"] as const) expect(createAppetite(clock().now).offer(k, e).fed, `${k}/${e}`).toBe(true);
  });
});

describe("full: a rhythm, not a spam button", () => {
  it("the third fruit within the window is eaten and fills the toy: it pats its belly afterwards", () => {
    const c = clock(), a = createAppetite(c.now);
    expect(a.offer("apple", "character").full).toBe(false);
    c.advance(2);
    expect(a.offer("apple", "character").full).toBe(false);
    c.advance(2);
    const third = a.offer("apple", "character");
    expect(FULL_AFTER).toBe(3);
    expect(third).toEqual({ fed: true, reaction: "eat", after: "belly_pat", full: true });
    expect(a.isFull).toBe(true);
  });
  it("while full it refuses with a belly pat and the fruit stays a fruit; after a while it is hungry again", () => {
    const c = clock(), a = createAppetite(c.now);
    for (let i = 0; i < 3; i++) { a.offer("apple", "character"); c.advance(1); }
    expect(a.offer("pear", "character")).toEqual({ fed: false, reaction: "belly_pat", full: true });
    c.advance(FULL_FOR_S - 2);
    expect(a.offer("pear", "character").fed).toBe(false);    // still full a moment before it passes
    c.advance(2.5);
    expect(a.isFull).toBe(false);
    expect(a.offer("pear", "character")).toEqual({ fed: true, reaction: "eat", full: false });
  });
  it("fruit spaced further apart than the window never fill the toy", () => {
    const c = clock(), a = createAppetite(c.now);
    for (let i = 0; i < 8; i++) { expect(a.offer("apple", "character").full, `fruit ${i}`).toBe(false); c.advance(FULL_WINDOW_S / 2 + 1); }
  });
  it("it is full again only after another three: the count starts over once it has been filled", () => {
    const c = clock(), a = createAppetite(c.now);
    for (let i = 0; i < 3; i++) { a.offer("apple", "robot"); c.advance(1); }
    c.advance(FULL_FOR_S + 1);
    expect(a.offer("apple", "robot").full).toBe(false);
    c.advance(1); expect(a.offer("apple", "robot").full).toBe(false);
    c.advance(1); expect(a.offer("apple", "robot").full).toBe(true);
  });
  it("reset forgets being full (a new world, a new toy)", () => {
    const c = clock(), a = createAppetite(c.now);
    for (let i = 0; i < 3; i++) a.offer("apple", "character");
    expect(a.isFull).toBe(true);
    a.reset();
    expect(a.isFull).toBe(false);
    expect(a.offer("apple", "character").fed).toBe(true);
  });
});

describe("a pumpkin is too big to eat", () => {
  it("every toy groans at it (a 'heavy' reaction), it is never fed, and it never counts towards being full", () => {
    const c = clock(), a = createAppetite(c.now);
    for (const e of ["character", "robot", "vehicle"] as const) expect(a.offer("pumpkin", e)).toEqual({ fed: false, reaction: "heavy", full: false });
    for (let i = 0; i < 6; i++) a.offer("pumpkin", "character");
    expect(a.isFull).toBe(false);
  });
});
