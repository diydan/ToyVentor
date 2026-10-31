import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import seedCarJson from "../seed/toys/seed-car.json";
import seedKipJson from "../seed/toys/seed-kip.json";
import { DEFAULT_FIT, FIT_VARIANTS } from "../shared/calibration";
import { isBuiltInToy, type Toy } from "../shared/toy";
import { slotStatForWorldSlot } from "../shared/world-parts";
import { enabledStarterToys } from "../src/features/scan/scan";
import { BUILD_STORAGE_PREFIX } from "../src/lib/builds";
import {
  ACTIVE_TOY_STORAGE_KEY,
  canonicalToyName,
  checkStarScoutGrandfatheredFromStorage,
  FIT_CHOICE_STORAGE_KEY,
  isStarScoutGrandfathered,
  loadActiveToyId,
  loadFitChoice,
  mergePhase2Roster,
  normalizeSavedToyIdentity,
  resolveEnabledBuiltInToys,
  ROBOT_WARDROBE_ALIASES,
  saveActiveToyId,
  saveFitChoice,
} from "../src/lib/toyRoster";

const seedKip = seedKipJson as Toy;
const seedCar = seedCarJson as Toy;

function installMemoryLocalStorage(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial));
  const mockStorage: Storage = {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
  vi.stubGlobal("localStorage", mockStorage);
  return mockStorage;
}

describe("Phase 2 — Enabled-Only Toy Box Roster & Kip Wardrobe", () => {
  beforeEach(() => {
    installMemoryLocalStorage();
  });

  it("makes Kip #1 and Red Racer #2 on a fresh device, excluding Star Scout", () => {
    expect(enabledStarterToys.map((t) => t.id)).toEqual(["seed-kip", "seed-car"]);
    expect(seedKip.name).toBe("Kip");
    expect(seedCar.name).toBe("Red Racer");

    const freshBuiltIns = resolveEnabledBuiltInToys({
      activeToyId: null,
      hasSavedBuild: false,
    });
    expect(freshBuiltIns.map((t) => t.id)).toEqual(["seed-kip", "seed-car"]);

    const merged = mergePhase2Roster([], { activeToyId: null });
    expect(merged.map((t) => t.id)).toEqual(["seed-kip", "seed-car"]);
    expect(merged.filter((t) => !isBuiltInToy(t))).toEqual([]);
  });

  it("grandfathers Star Scout immediately when active or backed by saved state", () => {
    expect(
      isStarScoutGrandfathered({
        activeToyId: "seed-figure",
        hasSavedBuild: false,
      }),
    ).toBe(true);
    expect(
      isStarScoutGrandfathered({
        activeToyId: "seed-kip",
        hasSavedBuild: true,
      }),
    ).toBe(true);
    expect(
      isStarScoutGrandfathered({
        activeToyId: "seed-kip",
        hasSkin: true,
      }),
    ).toBe(true);
    expect(
      isStarScoutGrandfathered({
        activeToyId: "seed-kip",
        hasReveal: true,
      }),
    ).toBe(true);

    expect(checkStarScoutGrandfatheredFromStorage(null, [])).toBe(false);

    installMemoryLocalStorage({
      [`${BUILD_STORAGE_PREFIX}seed-figure`]: JSON.stringify([
        { instanceId: "1", partId: "jetpack", xMm: 0, yMm: 0, rotation: 0 },
      ]),
    });
    expect(checkStarScoutGrandfatheredFromStorage("seed-kip", [])).toBe(true);

    const grandfathered = resolveEnabledBuiltInToys({
      activeToyId: "seed-figure",
    });
    expect(grandfathered.map((t) => t.id)).toEqual([
      "seed-kip",
      "seed-car",
      "seed-figure",
    ]);
  });

  it("collapses retired aliases onto canonical starter identities without duplicates", () => {
    const legacyRoadster: Toy = {
      ...seedCar,
      id: "legacy-roadster",
      name: "Roadster Racer",
      source: "seed",
    };
    const legacyRaceCar: Toy = {
      ...seedCar,
      id: "legacy-race-car",
      name: "Race Car",
      source: "seed",
    };
    const legacyKip: Toy = {
      ...seedKip,
      name: "Kip (Modular Hero)",
    };
    const scannedDino: Toy = {
      id: "scan-dino-1",
      name: "Green Rex",
      kind: "figure",
      sizeClass: "small",
      lengthMm: 110,
      widthMm: 55,
      attachPoints: [],
      source: "scan",
    };

    expect(normalizeSavedToyIdentity(legacyRoadster).id).toBe("seed-car");
    expect(normalizeSavedToyIdentity(legacyRoadster).name).toBe("Red Racer");
    expect(normalizeSavedToyIdentity(legacyRaceCar).id).toBe("seed-car");
    expect(canonicalToyName(legacyKip)).toBe("Kip");

    const merged = mergePhase2Roster(
      [legacyRoadster, legacyRaceCar, legacyKip, scannedDino],
      { activeToyId: "seed-kip" },
    );
    expect(merged.filter(isBuiltInToy).map((t) => t.id)).toEqual([
      "seed-kip",
      "seed-car",
    ]);
    expect(merged.filter((t) => !isBuiltInToy(t)).map((t) => t.id)).toEqual([
      "scan-dino-1",
    ]);
  });

  it("maps all 25 robot.* parts (including all 11 world spots) onto Kip Character slots", () => {
    const worldRuntimeSrc = readFileSync(
      resolve(process.cwd(), "src/features/game/world/runtime/world.ts"),
      "utf8",
    );
    // Extract every `["robot",...]` row from `ROWS` in the runtime
    const robotRowMatches = Array.from(
      worldRuntimeSrc.matchAll(
        /\["robot","(head|top|torso|arms|legs)","([a-z]+)",[^\]]*,"([a-z]*)"\]/g,
      ),
    );
    expect(robotRowMatches).toHaveLength(25);

    const expectedKeys = robotRowMatches.map((m) => `robot.${m[1]}.${m[2]}`);
    const aliasKeys = Object.keys(ROBOT_WARDROBE_ALIASES);
    expect(aliasKeys).toHaveLength(25);
    expect(new Set(aliasKeys)).toEqual(new Set(expectedKeys));

    const validKipSlots = new Set(["base", "hat", "back", "prop", "boots"]);
    for (const m of robotRowMatches) {
      const key = `robot.${m[1]}.${m[2]}`;
      const spotWorld = m[3] || undefined;
      const alias = ROBOT_WARDROBE_ALIASES[key];
      expect(alias).toBeDefined();
      expect(validKipSlots.has(alias!.slot)).toBe(true);
      expect(alias!.spotWorld).toBe(spotWorld);
    }

    const spots = Object.values(ROBOT_WARDROBE_ALIASES).filter((a) => a.spotWorld);
    expect(spots).toHaveLength(11);

    expect(slotStatForWorldSlot("character", "prop")).toBe("spin");
    expect(slotStatForWorldSlot("character", "boots")).toBe("torque");
  });

  it("persists activeToyId and Forge Mount calibration fit choice cleanly", () => {
    const storage = installMemoryLocalStorage();
    expect(loadActiveToyId()).toBeUndefined();
    saveActiveToyId("seed-car");
    expect(storage.getItem(ACTIVE_TOY_STORAGE_KEY)).toBe("seed-car");
    expect(loadActiveToyId()).toBe("seed-car");

    expect(loadFitChoice()).toBe(DEFAULT_FIT);
    for (const variant of FIT_VARIANTS) {
      saveFitChoice(variant.id);
      expect(storage.getItem(FIT_CHOICE_STORAGE_KEY)).toBe(variant.id);
      expect(loadFitChoice()).toBe(variant.id);
    }

    const stlPath = resolve(
      process.cwd(),
      "public/parts-stl/forge-mount-first-print.stl",
    );
    expect(existsSync(stlPath)).toBe(true);
  });

  it("enforces enabled-only Toy Box cards with real SVG/photo thumbnails and §3.3 sections", () => {
    const sheetSrc = readFileSync(
      resolve(process.cwd(), "src/features/game/world/MyToySheet.tsx"),
      "utf8",
    );
    expect(sheetSrc).toContain("<ToyMiniIcon");
    expect(sheetSrc).toContain('size="tile"');
    expect(sheetSrc).not.toContain("glyphForToy");
    expect(sheetSrc).not.toContain("tv-opt-lock");
    expect(sheetSrc).not.toContain("Unlock at Rank");

    // §3.3 Roster inventory sections
    expect(sheetSrc).toContain(">Characters<");
    expect(sheetSrc).toContain(">Vehicles<");
    expect(sheetSrc).toContain(">My Toys<");
    expect(sheetSrc).toContain("Lab Bots");
    expect(sheetSrc).toContain("Lab Kit Printer");
    expect(sheetSrc).toContain("Forge Mount fit");
  });
});
