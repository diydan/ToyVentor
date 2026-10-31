import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { runChecks } from "../shared/checks";
import type { Part } from "../shared/part";
import { toyFromScanInput, validateToy, type Toy } from "../shared/toy";
import { toyContractFromBuild, validateToyContract } from "../shared/toycontract";
import baseSet from "../sets/base.json";
import racerSet from "../sets/racer-garage.json";
import { colorOf } from "../src/features/builder/engine/render";
import { ToyMiniIcon } from "../src/features/game/world/ToyMiniIcon";
import {
  seedCar,
  seedFigure,
  seedKip,
  seedMotorbike,
  seedScooter,
  seedTruck,
} from "../src/features/scan/scan";
import {
  emptyProgression,
  grandfatherToyIds,
  RANKS,
  resetProgression,
} from "../src/lib/progression";
import {
  resolveToyMiniIcon,
  seedVariantForToy,
  type SeedIconVariant,
} from "../src/lib/toyIcon";
import {
  canonicalToyName,
  mergePhase2Roster,
  mergePhase4Roster,
  normalizeSavedToyIdentity,
} from "../src/lib/toyRoster";
import {
  findVehicleAuditByIdOrAlias,
  formatLockedVehicleGuidance,
  readyPhase4Vehicles,
  resolvePhase4VehicleRoster,
  VEHICLE_READINESS_AUDIT,
} from "../src/lib/vehicleReadiness";

const ROOT = resolve(__dirname, "..");

function makeMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}

describe("Phase 4 per-vehicle readiness audit (§5.1)", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      value: makeMemoryStorage(),
      configurable: true,
      writable: true,
    });
  });

  it("audits all 9 Rank 2-6 vehicles in exact catalog order and excludes Star Scout", () => {
    const rankVehicles = RANKS.flatMap((r) =>
      r.vehicles.map((name) => ({ rank: r.rank, title: r.title, xp: r.xp, name })),
    );
    expect(rankVehicles).toHaveLength(9);
    expect(VEHICLE_READINESS_AUDIT).toHaveLength(rankVehicles.length);

    VEHICLE_READINESS_AUDIT.forEach((entry, index) => {
      const expected = rankVehicles[index]!;
      expect(entry.name).toBe(expected.name);
      expect(entry.rank).toBe(expected.rank);
      expect(entry.rankTitle).toBe(expected.title);
      expect(entry.xpThreshold).toBe(expected.xp);
      expect(entry.id).not.toBe("seed-figure");
      expect(entry.name).not.toBe("Star Scout");
      expect(entry.raritySource).toContain("shared/pack.ts");
      expect(entry.saveBehavior).toContain(`toyforge:build:v1:${entry.id}`);
      expect(entry.saveBehavior).toContain("toyventor.toy/1");
    });

    expect(findVehicleAuditByIdOrAlias("seed-figure")).toBeUndefined();
    expect(findVehicleAuditByIdOrAlias("Star Scout")).toBeUndefined();
  });

  it("verifies live PartSpec manifests, STL files, shipped lab missions, builder checks, and contracts for ready: true vehicles", () => {
    const kipManifest = JSON.parse(
      readFileSync(resolve(ROOT, "public/kip/kip-partspec-manifest.json"), "utf8"),
    ) as {
      parts: Array<{ id: string; design_status: string; file: string }>;
      assemblies: Array<{ id?: string; name?: string; ok: boolean }>;
    };
    const manifestParts = new Map(kipManifest.parts.map((p) => [p.id, p]));
    const manifestAssemblies = new Map(
      kipManifest.assemblies.map((a) => [a.id ?? a.name ?? "", a]),
    );

    const worldSrc = readFileSync(
      resolve(ROOT, "src/features/game/world/runtime/world.ts"),
      "utf8",
    );

    const allAppParts = [
      ...(baseSet.parts as unknown as Part[]),
      ...(racerSet.parts as unknown as Part[]),
    ];
    const appPartsById = new Map(allAppParts.map((p) => [p.id, p]));

    const ready = readyPhase4Vehicles();
    expect(ready.map((e) => e.id)).toEqual([
      "seed-truck",
      "seed-scooter",
      "seed-motorbike",
    ]);

    for (const entry of ready) {
      expect(entry.ready).toBe(true);
      expect(entry.seedToy).not.toBeNull();
      const toy = entry.seedToy!;
      expect(validateToy(toy)).toEqual([]);
      expect(toy.name).toBe(entry.name);
      expect(toy.id).toBe(entry.id);

      // Every PartSpec v2 part is verified and has its STL in public/kip/partspec/
      expect(entry.partSpecIds.length).toBeGreaterThan(0);
      for (const psId of entry.partSpecIds) {
        const meta = manifestParts.get(psId);
        expect(meta, `missing ${psId} in kip-partspec-manifest`).toBeDefined();
        expect(meta!.design_status).toBe("verified");
        expect(
          existsSync(resolve(ROOT, "public/kip/partspec", meta!.file)),
          `missing STL ${meta!.file}`,
        ).toBe(true);
      }

      // Conforming assembly is verified ok
      expect(entry.verifiedAssemblyId).toBeTruthy();
      expect(manifestAssemblies.get(entry.verifiedAssemblyId!)?.ok).toBe(true);

      // Every cited app catalog part exists and passes all 4 builder checks on the vehicle
      expect(entry.appCatalogPartIds.length).toBeGreaterThan(0);
      for (const appId of entry.appCatalogPartIds) {
        const part = appPartsById.get(appId);
        expect(part, `missing app catalog part ${appId}`).toBeDefined();
        const checks = runChecks(part!, toy);
        expect(
          checks.every((c) => c.pass),
          `${appId} failed checks on ${toy.id}: ${JSON.stringify(checks)}`,
        ).toBe(true);
      }

      // Every cited STEM mission exists in shipped world.ts levels
      for (const missionKey of entry.recommendedMissions) {
        const [worldId, missionType] = missionKey.split(".");
        expect(worldSrc).toContain(`"id":"${worldId}"`);
        expect(worldSrc).toContain(`"type":"${missionType}"`);
      }

      // Flattened ToyContract round-trips cleanly
      const firstPart = appPartsById.get(entry.appCatalogPartIds[0]!)!;
      const contract = toyContractFromBuild(
        toy,
        [{ instanceId: "p1", partId: firstPart.id, xMm: 0, yMm: 0, rotation: 0 }],
        appPartsById,
        colorOf,
      );
      expect(contract.type).toBe("vehicle");
      expect(validateToyContract(contract)).toEqual([]);
    }
  });

  it("holds back unverified Wave 10 and Stage 4 vehicles with explicit blockers so no card wires to a placeholder", () => {
    const heldBack = VEHICLE_READINESS_AUDIT.filter((e) => !e.ready);
    expect(heldBack.map((e) => e.id)).toEqual([
      "seed-tractor",
      "seed-aeroplane",
      "seed-catamaran",
      "seed-helicopter",
      "seed-shuttle",
      "seed-mech",
    ]);

    for (const entry of heldBack) {
      expect(entry.gates.partVerified).toBe(false);
      expect(entry.seedToy).toBeNull();
      expect(entry.blocker && entry.blocker.length > 20).toBe(true);
    }

    // Even at max Rank 6 XP or Sandbox Unlock All, unverified geometry never leaks
    const maxProg = {
      ...emptyProgression(),
      totalXp: 5_000,
      sandboxUnlockAll: true,
    };
    const split = resolvePhase4VehicleRoster(maxProg);
    expect(split.unlockedVehicles.map((t) => t.id)).toEqual([
      "seed-truck",
      "seed-scooter",
      "seed-motorbike",
    ]);
    expect(split.lockedVehicles).toEqual([]);
  });
});

describe("Phase 4 name alignment (§5.2) & crisp SVG thumbnails", () => {
  it("collapses all starter and Phase 4 content aliases onto canonical IDs without duplicate rows", () => {
    const aliasPairs: Array<[string, string, string]> = [
      ["Roadster Racer", "seed-car", "Red Racer"],
      ["Race Car", "seed-car", "Red Racer"],
      ["Formula / GT Race Car", "seed-car", "Red Racer"],
      ["Kip (Modular Hero)", "seed-kip", "Kip"],
      ["Dump / Tow Truck", "seed-truck", "Hauler Truck"],
      ["Step-Through Motor Scooter", "seed-scooter", "Motor Scooter"],
      ["2-in-1 Sport Motorbike", "seed-motorbike", "Sport Motorbike"],
      ["Motorbike & Cargo Trike", "seed-motorbike", "Sport Motorbike"],
      ["Farm / Loader Tractor", "seed-tractor", "Loader Tractor & Trailer"],
      ["Modular Trailer", "seed-tractor", "Loader Tractor & Trailer"],
      ["Prop / Jet Aeroplane", "seed-aeroplane", "Prop Aeroplane"],
      ["Catamaran / Speedboat", "seed-catamaran", "Catamaran Boat"],
      ["Twin-Blade Rescue Helicopter", "seed-helicopter", "Rescue Helicopter"],
      ["Space Shuttle Orbiter", "seed-shuttle", "Space Shuttle"],
      ["Bolt Mech", "seed-mech", "Bolt Power Mech"],
    ];

    for (const [aliasName, expectedId, expectedCanonicalName] of aliasPairs) {
      const aliasedSeed: Toy = { ...seedCar, id: "legacy-seed", name: aliasName };
      expect(canonicalToyName(aliasedSeed)).toBe(expectedCanonicalName);
      const normalized = normalizeSavedToyIdentity(aliasedSeed);
      expect(normalized.id).toBe(expectedId);
      expect(normalized.name).toBe(expectedCanonicalName);
    }

    // Kid-scanned uploads with playful names stay distinct user uploads (never swallowed as seeds)
    const kidScan = toyFromScanInput({
      id: "scan-kids-plane",
      name: "Aeroplane",
      kind: "other",
      lengthMm: 95,
      widthMm: 50,
      source: "scan",
    });
    expect(normalizeSavedToyIdentity(kidScan).id).toBe("scan-kids-plane");

    const phase2Merged = mergePhase2Roster(
      [
        { ...seedCar, name: "Roadster Racer" },
        { ...seedTruck, name: "Dump / Tow Truck" },
        kidScan,
      ],
      {},
    );
    expect(phase2Merged.map((t) => t.id)).toEqual([
      "seed-kip",
      "seed-car",
      "scan-kids-plane",
    ]);
  });

  it("renders distinct, valid 24x24 vector SVG silhouettes for all 12 canonical seed variants", () => {
    const sampleToys: Array<[SeedIconVariant, Toy]> = [
      ["kip", seedKip],
      ["car", seedCar],
      ["figure", seedFigure],
      ["truck", seedTruck],
      ["scooter", seedScooter],
      ["motorbike", seedMotorbike],
      ["tractor", { ...seedCar, id: "seed-tractor", name: "Loader Tractor & Trailer" }],
      ["aeroplane", { ...seedCar, id: "seed-aeroplane", name: "Prop Aeroplane" }],
      ["catamaran", { ...seedCar, id: "seed-catamaran", name: "Catamaran Boat" }],
      ["helicopter", { ...seedCar, id: "seed-helicopter", name: "Rescue Helicopter" }],
      ["shuttle", { ...seedCar, id: "seed-shuttle", name: "Space Shuttle" }],
      ["mech", { ...seedCar, id: "seed-mech", name: "Bolt Power Mech" }],
    ];

    const seenSvgMarkup = new Set<string>();
    for (const [expectedVariant, toy] of sampleToys) {
      expect(seedVariantForToy(toy)).toBe(expectedVariant);
      expect(resolveToyMiniIcon(toy, { skipMuse: true })).toEqual({
        kind: "svg",
        variant: expectedVariant,
      });

      const miniHtml = renderToStaticMarkup(
        createElement(ToyMiniIcon, {
          toy,
          accentColor: "#ff5a4d",
          size: "mini",
        }),
      );
      const tileHtml = renderToStaticMarkup(
        createElement(ToyMiniIcon, {
          toy,
          accentColor: "#ff5a4d",
          size: "tile",
        }),
      );
      expect(miniHtml).toContain('viewBox="0 0 24 24"');
      expect(miniHtml).toContain('width="20"');
      expect(tileHtml).toContain('width="44"');
      seenSvgMarkup.add(tileHtml);
    }
    // Every single canonical toy/vehicle has its own unique silhouette!
    expect(seenSvgMarkup.size).toBe(12);
  });
});

describe("Phase 4 locked-card guidance & grandfathering (§5.3)", () => {
  it("formats single-line em-dash-free unlock guidance naming XP, lab, and vehicle", () => {
    for (const entry of VEHICLE_READINESS_AUDIT) {
      const zeroLine = formatLockedVehicleGuidance(entry, 0);
      expect(zeroLine).not.toContain("\n");
      expect(zeroLine).not.toContain("\u2014");
      expect(zeroLine).toContain("XP");
      expect(zeroLine).toContain(entry.recommendedLabLabel);
      expect(zeroLine).toContain(entry.name);

      const midLine = formatLockedVehicleGuidance(entry, 160);
      expect(midLine).not.toContain("\n");
      expect(midLine).not.toContain("\u2014");
      expect(midLine).toContain("more XP");
      expect(midLine).toContain(`Rank ${entry.rank}`);
      expect(midLine).toContain(entry.recommendedLabLabel);
      expect(midLine).toContain(entry.name);
    }
  });

  it("unlocks ready vehicles by Maker Rank XP and preserves grandfathered access across Reset XP", () => {
    // Fresh 0 XP: Kip + Red Racer enabled; 3 verified V2 vehicles locked
    const fresh = mergePhase4Roster([], emptyProgression());
    expect(fresh.enabledToys.map((t) => t.id)).toEqual(["seed-kip", "seed-car"]);
    expect(fresh.lockedVehicles.map((l) => l.entry.id)).toEqual([
      "seed-truck",
      "seed-scooter",
      "seed-motorbike",
    ]);

    // Rank 2 (250 XP): Hauler Truck + Motor Scooter unlock; Sport Motorbike stays locked with 350 more XP copy
    const rank2 = mergePhase4Roster([], { ...emptyProgression(), totalXp: 250 });
    expect(rank2.enabledToys.map((t) => t.id)).toEqual([
      "seed-kip",
      "seed-car",
      "seed-truck",
      "seed-scooter",
    ]);
    expect(rank2.lockedVehicles).toHaveLength(1);
    expect(rank2.lockedVehicles[0]!.entry.id).toBe("seed-motorbike");
    expect(rank2.lockedVehicles[0]!.guidance).toBe(
      "Earn 350 more XP (600 XP, Rank 3) in Lab 2: Machines to unlock Sport Motorbike.",
    );

    // Grandfathering + Reset XP survival: existing build on seed-motorbike and unlockedIds on seed-figure
    const withGrandfathered = grandfatherToyIds(
      { ...emptyProgression(), totalXp: 700 },
      ["seed-figure", "seed-truck"],
    ).next;
    const afterReset = resetProgression(withGrandfathered, 1_700_000_000_000);
    expect(afterReset.totalXp).toBe(0);

    const postResetRoster = mergePhase4Roster([], afterReset, {
      hasSavedBuildForToy: (id) => id === "seed-motorbike",
    });
    expect(postResetRoster.enabledToys.map((t) => t.id)).toEqual([
      "seed-kip",
      "seed-car",
      "seed-figure",
      "seed-truck",
      "seed-motorbike",
    ]);
    expect(postResetRoster.lockedVehicles.map((l) => l.entry.id)).toEqual([
      "seed-scooter",
    ]);
  });
});
