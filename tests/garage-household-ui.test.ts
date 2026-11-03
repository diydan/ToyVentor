// The household weekends as drawn (src/features/game/world/HouseholdWeekend.tsx and the Garage sheet): static markup of the real components with the real
// library pictures. What a tap does is covered by the browser run (scripts/e2e-trail.mjs, the garage-household scenarios) and the rules by
// tests/garage-household.test.ts; this checks what is on the screen in each state.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { garageStatus, type GarageStatus } from "../src/lib/garage";
import { householdDropFor, type HouseholdItem } from "../src/lib/garageHousehold";
import {
  HOUSEHOLD_ITEMS,
  HOUSEHOLD_SUPPORT,
  householdDropForWeekend,
  loadHouseholdPictures,
  slim,
  type HouseholdPictures,
} from "../src/lib/garageHouseholdData";
import { GarageSheet } from "../src/features/game/world/GarageSheet";
import { firstShapeTarget, HouseholdConfirm, householdItemIds, ItemPicture, labelOf } from "../src/features/game/world/HouseholdWeekend";

const ROOT = resolve(__dirname, "..");
const ITEMS = (JSON.parse(readFileSync(join(ROOT, "public/kip/household/catalog.json"), "utf8")) as { items: HouseholdItem[] }).items;
const PICTURES = (JSON.parse(readFileSync(join(ROOT, "public/kip/household/pictures.json"), "utf8")) as { items: HouseholdPictures }).items;

const FIRST_FRIDAY = "2026-11-06";
const HOUSE_SAT = "2026-11-14"; // a Saturday of the first household weekend (an orange)
const BUILD_SAT = "2026-11-07";
const TOOLS_FRIDAY = (() => {
  for (let w = 0; w < 80; w++) {
    const key = new Date(Date.UTC(2026, 10, 13) + w * 7 * 86_400_000).toISOString().slice(0, 10);
    if (householdDropFor(key, ITEMS)?.id === "household-tools") return key;
  }
  throw new Error("no tool weekend");
})();

const statusFor = (dayKey: string, over: Record<string, unknown> = {}): GarageStatus =>
  garageStatus({ dayKey, ageBand: 3, done: [], householdDrop: (k) => householdDropFor(k, ITEMS), ...over });
const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el);
const sheet = (status: GarageStatus, props: Record<string, unknown> = {}) =>
  html(createElement(GarageSheet, { status, onStart: () => {}, onFreeBuild: () => {}, onClose: () => {}, ...props }));
const household = { pictures: PICTURES, ageBand: 3, onSkipFinished: () => "ok" };

describe("the library as the Garage loads it", () => {
  it("bundles the catalog: the 60 items and the toy support tool, with just the fields the Garage reads", () => {
    expect(HOUSEHOLD_ITEMS).toHaveLength(ITEMS.length);
    expect(HOUSEHOLD_ITEMS.map((i) => i.id)).toEqual(ITEMS.map((i) => i.id));
    expect(HOUSEHOLD_SUPPORT.map((i) => i.id)).toEqual(["support_tool"]);
    for (const i of HOUSEHOLD_ITEMS) {
      expect(Object.keys(i).sort(), i.id).toEqual(["built", "confusableWith", "group", "id", "label", "minBand", "simple", "tags"]);
      expect(i.built, i.id).toBe(true);
    }
    expect(HOUSEHOLD_ITEMS.find((i) => i.id === "fork")!.minBand).toBe(3);
  });

  it("reads a catalog row as just the fields the rules use, and keeps an item that is not built as not built", () => {
    const row = { id: "x", label: "X", tags: ["garage"], minBand: 2, simple: false, group: "tools", confusableWith: ["y"], built: false, bytes: 123, zones: [] };
    expect(slim(row as never)).toEqual({ id: "x", label: "X", tags: ["garage"], minBand: 2, simple: false, group: "tools", confusableWith: ["y"], built: false });
    expect(slim({ ...row, confusableWith: undefined, built: true } as never).confusableWith).toEqual([]);
  });

  it("gives the household drop for a weekend once, so the Garage sees the same object every render, and nothing on a Build Day", () => {
    const a = householdDropForWeekend("2026-11-13");
    expect(a).not.toBeNull();
    expect(householdDropForWeekend("2026-11-13")).toBe(a);
    expect(a!.id).toBe("household-orange");
    expect(householdDropForWeekend("2026-11-06")).toBeNull();
    expect(householdDropForWeekend("2026-11-06")).toBeNull();
  });

  it("loads the pictures once, for every item and the toy tool", async () => {
    const first = loadHouseholdPictures();
    expect(loadHouseholdPictures()).toBe(first);
    const pics = await first;
    expect(Object.keys(pics).sort()).toEqual([...ITEMS.map((i) => i.id), "support_tool"].sort());
    expect(pics.orange!.zones.length).toBeGreaterThan(0);
  });
});

describe("pictures", () => {
  it("draws the silhouette in one dark colour from the three-quarter outline, and the colours from the front zones with an outline on top", () => {
    const orange = PICTURES.orange!;
    const sil = html(createElement(ItemPicture, { picture: orange, view: "silhouette", label: "An orange" }));
    expect(sil).toContain(`d="${orange.threeQuarter}"`);
    expect(sil).not.toContain(orange.zones[0]!.hex);
    expect(sil).toContain('aria-label="An orange"');
    const col = html(createElement(ItemPicture, { picture: orange, view: "colour" }));
    for (const z of orange.zones) expect(col, z.zone).toContain(`fill="${z.hex}"`);
    expect(col).toContain(`d="${orange.front}"`);
    expect(col).toContain('aria-hidden="true"'); // no label: decoration
    expect(col).not.toContain(`d="${orange.threeQuarter}"`);
  });

  it("draws an empty frame, not a crash, while the pictures are still loading", () => {
    expect(html(createElement(ItemPicture, { picture: undefined, view: "colour" }))).toContain("tv-house-pic-empty");
  });

  it("names every item the library has (the label the sheet and the screen reader use)", () => {
    for (const i of ITEMS) expect(labelOf(i.id), i.id).toBe(i.label);
    expect(labelOf("support_tool")).toBe("Toy tool");
    expect(labelOf("unknown_thing")).toBe("unknown_thing");
  });
});

describe("what a weekend asks about", () => {
  it("is the weekend's item for an item weekend, the toy tool for the youngest tool weekend, and the tools for the older ones", () => {
    expect(householdItemIds(statusFor(HOUSE_SAT))).toEqual(["orange"]);
    expect(householdItemIds(statusFor(TOOLS_FRIDAY, { ageBand: 0 }))).toEqual(["support_tool"]);
    expect(householdItemIds(statusFor(TOOLS_FRIDAY, { ageBand: 2 })).sort()).toEqual(["bucket", "flashlight", "hammer", "pliers", "tape_measure"]);
    expect(householdItemIds(statusFor(TOOLS_FRIDAY, { ageBand: 4 }))).toHaveLength(6);
    expect(householdItemIds(statusFor(BUILD_SAT))).toEqual([]); // a build weekend asks about no item
  });

  it("opens the shape game on the item (one item), or on one of the tools (a seeded pick), never on something else", () => {
    expect(firstShapeTarget(statusFor(HOUSE_SAT))).toBe("orange");
    expect(firstShapeTarget(statusFor(TOOLS_FRIDAY, { ageBand: 0 }))).toBe("support_tool");
    const tools = householdItemIds(statusFor(TOOLS_FRIDAY, { ageBand: 4 }));
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) seen.add(firstShapeTarget(statusFor(TOOLS_FRIDAY, { ageBand: 4 }), () => i / 40));
    for (const id of seen) expect(tools).toContain(id);
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("the Garage sheet on a household weekend", () => {
  it("shows the find-it card: the item's name and picture, no Start button, and the way to skip", () => {
    const out = sheet(statusFor(HOUSE_SAT), { household });
    expect(out).toContain("Find an orange");
    expect(out).toContain("Find it at home");
    expect(out).toContain("New this weekend");
    expect(out).toContain('data-testid="household-pictures"');
    expect(out).toContain(PICTURES.orange!.zones[0]!.hex);
    expect(out).not.toContain("tv-garage-start");
    expect(out).toContain("tv-house-skip");
    expect(out).toContain("Who’s that shape?");
    expect(out).toContain("Free build"); // the Garage itself stays open
    expect(out).toContain("A grown-up says “We found it”");
  });

  it("offers no way to skip when the game's data is not passed in", () => {
    expect(sheet(statusFor(HOUSE_SAT))).not.toContain("tv-house-skip");
  });

  it("drops the brief once the weekend is done (it still says how to play), and shows it while it is open", () => {
    expect(sheet(statusFor(HOUSE_SAT), { household })).toContain("tv-garage-brief");
    expect(sheet(statusFor(HOUSE_SAT, { done: ["2026-11-13"], found: ["2026-11-13"] }), { household })).not.toContain("tv-garage-brief");
    expect(sheet(statusFor(HOUSE_SAT, { done: ["2026-11-13"], found: [] }), { household })).not.toContain("tv-garage-brief");
    expect(sheet(statusFor(BUILD_SAT, { done: [FIRST_FRIDAY] }), { household })).toContain("tv-garage-brief"); // a build weekend keeps its brief
  });

  it("says a found weekend was found and a skipped one was played, and offers neither a replay nor a second skip", () => {
    const found = sheet(statusFor(HOUSE_SAT, { done: ["2026-11-13"], found: ["2026-11-13"] }), { household });
    expect(found).toContain("Done this weekend");
    expect(found).toContain("You found it");
    expect(found).not.toContain("tv-house-skip");
    expect(found).not.toContain("tv-garage-start");
    const skipped = sheet(statusFor(HOUSE_SAT, { done: ["2026-11-13"], found: [] }), { household });
    expect(skipped).toContain("You played");
    expect(skipped).toContain("gold star");
    expect(skipped).not.toContain("tv-house-skip");
  });

  it("never offers “Build it for real” on a household weekend", () => {
    const out = sheet(statusFor(HOUSE_SAT, { done: ["2026-11-13"], found: ["2026-11-13"] }), { household, realLifeOn: true, buildRealUrl: "https://example.test/build" });
    expect(out).not.toContain("Build it for real");
  });

  it("shows a tool weekend with one picture for the youngest (the toy tool) and the named tools for the others", () => {
    const young = sheet(statusFor(TOOLS_FRIDAY, { ageBand: 0 }), { household: { ...household, ageBand: 0 } });
    expect(young).toContain("Tool time!");
    expect(young).toContain("Toy tool");
    expect((young.match(/<figure/g) ?? []).length).toBe(1);
    const older = sheet(statusFor(TOOLS_FRIDAY, { ageBand: 4 }), { household: { ...household, ageBand: 4 } });
    expect(older).toContain("Find three tools");
    expect((older.match(/<figure/g) ?? []).length).toBe(6);
  });

  it("is the same build card as ever on a Build Day: Start, no pictures, no skip", () => {
    const out = sheet(statusFor(BUILD_SAT), { household });
    expect(out).toContain("tv-garage-start");
    expect(out).toContain("Build something new");
    expect(out).not.toContain("household-pictures");
    expect(out).not.toContain("tv-house-skip");
  });

  it("keeps drops switched off as it was", () => {
    expect(sheet(statusFor(HOUSE_SAT, { dropEnabled: false }), { household })).toContain("New drops are off");
  });
});

describe("the grown-up's “We found it”", () => {
  const confirm = (status: GarageStatus, over: Record<string, unknown> = {}) =>
    html(createElement(HouseholdConfirm, { status, pictures: PICTURES, realLifeOn: true, onConfirm: () => "ok", ...over }));

  it("names what was asked, shows its picture, and says what finding and skipping pay", () => {
    const out = confirm(statusFor(HOUSE_SAT));
    expect(out).toContain("Find an orange");
    expect(out).toContain(PICTURES.orange!.zones[0]!.hex);
    expect(out).toContain("We found it");
    expect(out).toContain("+40 XP and play time");
    expect(out).toContain("+40 XP and no play time");
    expect(out).not.toContain("We built it");
    expect(out).not.toContain("disabled");
  });

  it("asks the grown-up of the youngest to show a real tool (the toy tool is only the picture), and the older ones to find several", () => {
    expect(confirm(statusFor(TOOLS_FRIDAY, { ageBand: 0 }))).toContain("Show your child a real tool");
    expect(confirm(statusFor(TOOLS_FRIDAY, { ageBand: 3 }))).toContain("Find 2 different ones");
    expect(confirm(statusFor(TOOLS_FRIDAY, { ageBand: 4 }))).toContain("Find 3 different ones");
  });

  it("is off once the weekend is finished: found, or finished by playing", () => {
    const found = confirm(statusFor(HOUSE_SAT, { done: ["2026-11-13"], found: ["2026-11-13"] }));
    expect(found).toContain("Found it ★");
    expect(found).toContain("disabled");
    const skipped = confirm(statusFor(HOUSE_SAT, { done: ["2026-11-13"], found: [] }));
    expect(skipped).toContain("Done by playing");
    expect(skipped).toContain("disabled");
  });

  it("is off, with the reason, when the real-life leg is switched off, and still lets the child skip", () => {
    const out = confirm(statusFor(HOUSE_SAT), { realLifeOn: false });
    expect(out).toContain("disabled");
    expect(out).toContain("Real-life tasks are off");
    expect(out).toContain("Who&#x27;s that shape?");
  });
});

describe("the roof reads the stored skips", () => {
  it("passes garageSkipped to the trophy count, so a hollow star is a stored skip and not a guess from the Build Day rule", () => {
    const src = readFileSync(join(ROOT, "src/features/game/world/GameCanvas.tsx"), "utf8");
    expect(src).toContain("garageTrophyCounts(progression.garageDone, progression.garageFound, progression.garageSkipped)");
  });
});

