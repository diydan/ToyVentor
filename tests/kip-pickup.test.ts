import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// The viewer modules are plain browser JS with no declaration files.
// @ts-expect-error untyped JS module
import * as pickup from "../parts/kip/viewer/kip-pickup.js";
// @ts-expect-error untyped JS module
import * as moment from "../parts/kip/viewer/kip-moment-song.js";
// @ts-expect-error untyped JS module
import * as wardrobe from "../parts/kip/viewer/kip-vehicles-wardrobe.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const { workshopPropForWord, coverFit, toBox, boundsOf, easeInOut, flightAt, colourWord, CHIPS } = pickup as any;
const { songSentence } = moment as any;
const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8");

// The camera pick-up (parts/kip/viewer/kip-pickup.js) and the moment song (kip-moment-song.js): the pure parts. The live camera, the cut-out and its flight are checked in a real browser
// by scripts/e2e-kip-pickup.mjs (a real Chrome fake camera, the real bench page, a stood-in /api/scan).

describe("which words name one of the bench's own hand props", () => {
  it("maps the words a child says to the prop ids the bench has", () => {
    const ids = new Set((wardrobe as any).WORKSHOP_PROPS.map((p: any) => p.id));
    for (const [word, id] of [["guitar", "guitar"], ["Ukulele", "guitar"], ["a guitar", "guitar"], ["the trumpet", "trumpet"], ["frying pan", "frying_pan"], ["pan", "frying_pan"], ["frying pans", "frying_pan"], ["broom", "broom"], ["  Magnifying   Glass ", "magnifier"], ["maracas", "maracas"], ["hoover", "vacuum"]] as const) {
      expect(workshopPropForWord(word), word).toBe(id);
      expect(ids.has(id), `${id} is a real bench prop`).toBe(true);
    }
  });

  it("every id it can answer is a prop the bench really has (a renamed prop fails here, not in front of a child)", () => {
    const ids = new Set((wardrobe as any).WORKSHOP_PROPS.map((p: any) => p.id));
    const source = read("parts/kip/viewer/kip-pickup.js");
    const block = source.slice(source.indexOf("const WORKSHOP_WORDS"), source.indexOf("const WORD_TO_PROP"));
    const keys = [...block.matchAll(/^\s{2}([a-z_]+):\s*\[/gm)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThanOrEqual(15);
    for (const k of keys) expect(ids.has(k), k).toBe(true);
  });

  it("leaves words that belong to the household library alone, and refuses nonsense", () => {
    for (const w of ["spoon", "brush", "roller", "cup", "banana", "zebra", "", "   ", "guitar".repeat(20)]) expect(workshopPropForWord(w), w).toBeNull();
    for (const v of [null, undefined, 3, {}]) expect(workshopPropForWord(v), String(v)).toBeNull();
  });

  it("the chips are all words that something can hold: a bench prop or an ordinary word the library may match", () => {
    expect(CHIPS.length).toBeGreaterThanOrEqual(4);
    for (const c of CHIPS) expect(c.word).toMatch(/^[a-z ]{2,20}$/);
    expect(CHIPS.map((c: any) => c.word)).toEqual(expect.arrayContaining(["spoon", "guitar"]));
  });
});

describe("the geometry that lays the cut-out over the frozen frame", () => {
  it("coverFit places a picture the way object-fit: cover does", () => {
    // a wide 640 x 480 frame in a tall 390 x 844 box: scaled by the height (844/480), centred sideways
    const f = coverFit(640, 480, 390, 844);
    expect(f.s).toBeCloseTo(844 / 480, 6);
    expect(f.oy).toBeCloseTo(0, 6);
    expect(f.ox).toBeCloseTo((390 - 640 * f.s) / 2, 6);
    // a tall picture in a wide box is scaled by the width and centred up and down
    const g = coverFit(288, 512, 900, 600);
    expect(g.s).toBeCloseTo(900 / 288, 6);
    expect(g.ox).toBeCloseTo(0, 6);
    expect(g.oy).toBeCloseTo((600 - 512 * g.s) / 2, 6);
    // the picture always covers the box
    for (const [w, h, bw, bh] of [[640, 480, 390, 844], [288, 512, 900, 600], [100, 100, 100, 100], [1280, 720, 390, 844]] as const) {
      const c = coverFit(w, h, bw, bh);
      expect(w * c.s).toBeGreaterThanOrEqual(bw - 1e-6);
      expect(h * c.s).toBeGreaterThanOrEqual(bh - 1e-6);
      expect(c.ox).toBeLessThanOrEqual(1e-6);
      expect(c.oy).toBeLessThanOrEqual(1e-6);
    }
  });

  it("toBox and boundsOf carry points into the box and measure them", () => {
    const fit = { s: 2, ox: -10, oy: 5 };
    expect(toBox([[0, 0], [10, 20]], fit)).toEqual([[-10, 5], [10, 45]]);
    expect(boundsOf([[1, 2], [5, 9], [3, 4]])).toEqual({ x: 1, y: 2, w: 4, h: 7 });
    expect(boundsOf([[1, 2], [5, 9]], 3)).toEqual({ x: -2, y: -1, w: 10, h: 13 });
  });

  it("the flight starts where it began, ends at the hand, hops up in the middle, and stays inside the clamp", () => {
    const from = { x: 100, y: 400 };
    const to = { x: 40, y: 300 };
    expect(flightAt(from, to, 0)).toEqual({ x: 100, y: 400 });
    const end = flightAt(from, to, 1);
    expect(end.x).toBeCloseTo(40, 6);
    expect(end.y).toBeCloseTo(300, 6);
    const mid = flightAt(from, to, 0.5, 60);
    expect(mid.y).toBeLessThan((from.y + to.y) / 2 - 50); // the hop
    expect(flightAt(from, to, -3)).toEqual(flightAt(from, to, 0));
    expect(flightAt(from, to, 9).x).toBeCloseTo(40, 6);
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBeCloseTo(1, 9);
    expect(easeInOut(0.25)).toBeLessThan(0.25);
    expect(easeInOut(0.75)).toBeGreaterThan(0.75);
  });
});

describe("colour words for the song", () => {
  it("names a small closed set of colours", () => {
    const seen = new Set<string>();
    for (let r = 0; r < 256; r += 51) for (let g = 0; g < 256; g += 51) for (let b = 0; b < 256; b += 51) seen.add(colourWord(r, g, b));
    for (const w of seen) expect(["white", "silver", "grey", "black", "dark", "red", "brown", "orange", "yellow", "green", "teal", "blue", "purple", "pink"], w).toContain(w);
    expect(colourWord(255, 0, 0)).toBe("red");
    expect(colourWord(0, 200, 0)).toBe("green");
    expect(colourWord(30, 70, 222)).toBe("blue");
    expect(colourWord(250, 250, 250)).toBe("white");
    expect(colourWord(170, 176, 186)).toBe("silver");
    expect(colourWord(120, 120, 120)).toBe("grey");
  });
});

describe("the moment song's sentence", () => {
  it("is built from the object, up to two colour words, and what Kip does with it", () => {
    expect(songSentence({ word: "guitar", label: "guitar", kind: "workshop", id: "guitar", colours: ["brown", "yellow"] })).toBe("A song about a brown and yellow guitar. Kip strums it and sings along.");
    expect(songSentence({ word: "spoon", label: "Wooden spoon", kind: "library", id: "wooden_spoon", colours: ["silver"] })).toBe("A song about a silver wooden spoon. Kip cooks with it in the kitchen.");
    expect(songSentence({ word: "frying pan", label: "frying pan", kind: "workshop", id: "frying_pan", colours: [] })).toBe("A song about a frying pan. Kip cooks pancakes with it in the kitchen.");
    expect(songSentence({ word: "broom", label: "broom", kind: "workshop", id: "broom", colours: ["orange"] })).toMatch(/an orange broom\. Kip sweeps up/);
  });

  it("takes only colour words from the closed list, and cleans the name", () => {
    const s = songSentence({ word: "x", label: "<b>guitar</b>{}\n\"ignore this\"", kind: "workshop", id: "guitar", colours: ["red", "knife", "<script>", "blue", "green"] });
    expect(s).not.toMatch(/[<>{}"\n]/);
    expect(s).toContain("red and blue");
    expect(s).not.toContain("knife");
    expect(s).not.toContain("script");
  });

  it("never passes 300 characters (the route's limit) and never throws on rubbish", () => {
    expect(songSentence({ word: "a".repeat(500), label: "b".repeat(500), kind: "library", id: "x", colours: [] }).length).toBeLessThanOrEqual(300);
    for (const bad of [undefined, null, {}, { label: 7 }, { colours: "red" }]) expect(typeof songSentence(bad as any)).toBe("string");
    expect(songSentence({})).toMatch(/^A song about a thing\./);
  });
});

describe("the pick-up in the Kip page and the build", () => {
  const bench = read("parts/kip/viewer/kip-bench.js");
  const build = read("scripts/build-kip.ts");
  const menuSrc = read("parts/kip/viewer/kip-menu.js");

  it("the build copies both new modules, and every module they import is copied or bundled", () => {
    expect(build).toContain("viewer/kip-pickup.js");
    expect(build).toContain("viewer/kip-moment-song.js");
    for (const file of ["parts/kip/viewer/kip-pickup.js", "parts/kip/viewer/kip-moment-song.js"]) {
      for (const m of read(file).matchAll(/from\s+['"]\.\/([\w.-]+\.js)(?:\?[^'"]*)?['"]/g)) expect(build, `${m[1]} imported by ${file}`).toContain(`viewer/${m[1]}`);
    }
  });

  it("the bench loads them on first use and never with a static import (a bench without the files still loads)", () => {
    expect(bench).not.toMatch(/^import[^;]*kip-pickup/m);
    expect(bench).not.toMatch(/^import[^;]*kip-moment-song/m);
    expect(bench).toContain("import('/kip/kip-pickup.js?v=10.0')");
    expect(bench).toContain("import('/kip/kip-moment-song.js?v=10.0')");
    expect(bench).toContain("openPickUp,");
  });

  it("the Tools menu offers Pick it up only when the page can do it", () => {
    // inside the Tools group, before the Photo entry, guarded by the page's own hook
    const tools = menuSrc.slice(menuSrc.indexOf("id: 'tools'"), menuSrc.indexOf("const print = ctx.print"));
    expect(tools).toContain("...(act.openPickUp ? [{ kind: 'action', id: 'pickup'");
    expect(tools).toContain("run: () => act.openPickUp()");
    expect(tools.indexOf("id: 'pickup'")).toBeLessThan(tools.indexOf("id: 'photo'"));
    // and the bench puts the hook on the act object it hands the menu
    expect(bench).toMatch(/openForgeMake,\s+openPickUp,/);
  });

  it("the camera view keeps the print panel's privacy rules: no storage, no listener on window or document", () => {
    const src = read("parts/kip/viewer/kip-pickup.js");
    expect(src).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
    expect(src).not.toMatch(/(window|document|win)\.addEventListener/);
    expect(src).toMatch(/playsinline/);
    expect(src).toContain("stopCamera();"); // the stream ends the moment the shutter is pressed
  });
});
