import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { boardForToy, canPlace, type Placement } from "../shared/build";
import { allPass, runChecks } from "../shared/checks";
import type { Part } from "../shared/part";
import { buildSignature } from "../shared/reveal";
import { toyContractFromBuild } from "../shared/toycontract";
import {
  equipPartOnBuild,
  printablePartsForWorld,
  slotStatForWorldSlot,
  unequipPartFromBuild,
} from "../shared/world-parts";
import { BUILD_STORAGE_PREFIX, buildStorageKey } from "../src/lib/builds";
import { allParts, partsById } from "../src/lib/catalog";
import { seedCar, seedFigure, seedKip } from "../src/features/scan/scan";

function collectTsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTsxFiles(full));
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

describe("world-parts fit bridge & slot-equip synthesis", () => {
  it("preserves the singular build storage prefix (toyforge:build:v1:)", () => {
    expect(BUILD_STORAGE_PREFIX).toBe("toyforge:build:v1:");
    expect(buildStorageKey("seed-kip")).toBe("toyforge:build:v1:seed-kip");
  });

  it("filters printable catalog parts strictly by stlFile + allPass(runChecks)", () => {
    for (const toy of [seedCar, seedFigure, seedKip]) {
      const fitting = printablePartsForWorld(toy, allParts);
      expect(fitting.length).toBeGreaterThan(0);
      for (const part of fitting) {
        expect(part.printable).toBe(true);
        expect(Boolean(part.stlFile)).toBe(true);
        expect(allPass(runChecks(part, toy))).toBe(true);
      }
    }
  });

  it("surfaces new expansion set parts automatically with zero code changes", () => {
    const expansionFit: Part = {
      id: "exp-solar-fin",
      name: "Solar Fin",
      line: "snap",
      mount: "stud",
      sizeClass: seedCar.sizeClass,
      grid: { units: [2, 1], profile: "tu_12.5" },
      footprintMm: [25, 12.5],
      stat: { name: "speed", value: 4 },
      printable: true,
      orientation: "flat",
      supportFree: true,
      stlFile: "solar_fin.stl",
    };
    const expansionTooBig: Part = {
      ...expansionFit,
      id: "exp-giant-wing",
      name: "Giant Wing",
      footprintMm: [300, 300],
    };

    const result = printablePartsForWorld(seedCar, [
      ...allParts,
      expansionFit,
      expansionTooBig,
    ]);
    expect(result.some((p) => p.id === "exp-solar-fin")).toBe(true);
    expect(result.some((p) => p.id === "exp-giant-wing")).toBe(false);
  });

  it("prioritizes parts matching the active World customizer slot and honors line filter", () => {
    expect(slotStatForWorldSlot("vehicle", "rear")).toBe("speed");
    expect(slotStatForWorldSlot("character", "back")).toBe("speed");
    expect(slotStatForWorldSlot("character", "eyes")).toBe("glow");

    const rearParts = printablePartsForWorld(seedCar, allParts, {
      slot: "rear",
      toyType: "vehicle",
    });
    const firstNonSpeed = rearParts.findIndex((p) => p.stat.name !== "speed");
    if (firstNonSpeed !== -1) {
      for (let i = firstNonSpeed; i < rearParts.length; i++) {
        expect(rearParts[i]!.stat.name).not.toBe("speed");
      }
    }

    const proOnly = printablePartsForWorld(seedKip, allParts, { line: "pro" });
    expect(proOnly.every((p) => p.line === "pro")).toBe(true);
  });

  it("synthesizes canonical board placements and replaces rather than duplicates on same-slot re-equip", () => {
    const fitting = printablePartsForWorld(seedKip, allParts);
    const speedParts = fitting.filter((p) => p.stat.name === "speed");
    expect(speedParts.length).toBeGreaterThanOrEqual(2);

    const first = equipPartOnBuild(seedKip, speedParts[0]!, [], partsById);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.replaced).toBe(false);
    expect(first.placements).toHaveLength(1);
    expect(first.placement.instanceId).toBe("slot:speed");

    // Re-equipping another speed part replaces slot:speed cleanly
    const second = equipPartOnBuild(
      seedKip,
      speedParts[1]!,
      first.placements,
      partsById,
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.replaced).toBe(true);
    expect(second.placements).toHaveLength(1);
    expect(second.placement.partId).toBe(speedParts[1]!.id);

    // Equipping a different stat bucket coexists without board overlap
    const otherStatPart = fitting.find((p) => p.stat.name !== "speed");
    if (otherStatPart) {
      const third = equipPartOnBuild(
        seedKip,
        otherStatPart,
        second.placements,
        partsById,
      );
      expect(third.ok).toBe(true);
      if (third.ok) {
        expect(third.placements).toHaveLength(2);
        const board = boardForToy(seedKip);
        for (const placed of third.placements) {
          const part = partsById.get(placed.partId)!;
          expect(
            canPlace(
              part,
              placed.xMm,
              placed.yMm,
              placed.rotation,
              third.placements,
              partsById,
              board,
              placed.instanceId,
            ).ok,
          ).toBe(true);
        }
        const contract = toyContractFromBuild(
          seedKip,
          third.placements,
          partsById,
          () => "#52b7ff",
        );
        expect(contract.parts.length).toBeGreaterThanOrEqual(2);
        expect(buildSignature(third.placements)).toBeTruthy();

        const afterUnequip = unequipPartFromBuild(
          otherStatPart.id,
          third.placements,
        );
        expect(afterUnequip).toHaveLength(1);
      }
    }
  });

  it("rejects size-mismatched parts without mutating placements", () => {
    const mismatch = allParts.find((p) => p.sizeClass !== seedCar.sizeClass);
    expect(mismatch).toBeDefined();
    const initial: Placement[] = [];
    const res = equipPartOnBuild(seedCar, mismatch!, initial, partsById);
    expect(res).toEqual({ ok: false, reason: "checks-failed" });
    expect(initial).toHaveLength(0);
  });

  it("keeps all TSX UI components free of forbidden em dashes", () => {
    const files = collectTsxFiles(join(process.cwd(), "src"));
    const offenders: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, idx) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
        if (line.includes("\u2014")) {
          offenders.push(`${file}:${idx + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
