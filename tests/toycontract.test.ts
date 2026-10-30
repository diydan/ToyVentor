import { describe, expect, it } from "vitest";
import baseSetJson from "../sets/base.json";
import type { Placement } from "../shared/build";
import type { Part, ToySet } from "../shared/part";
import type { Toy } from "../shared/toy";
import {
  TOY_CONTRACT_FORMAT,
  decodeToyContract,
  encodeToyContract,
  gamePartForStat,
  toyContractFromBuild,
  toyTypeForKind,
  toyWorldUrl,
  validateToyContract,
} from "../shared/toycontract";

const parts = (baseSetJson as ToySet).parts;
const byId = new Map(parts.map((p) => [p.id, p]));

const colors: Record<string, string> = {
  "racer-spoiler": "#e85d1f",
  "dome-s-2x2": "#2563eb",
  "glow-capsule": "#d97706",
  "skin-racer-red": "#b91c1c",
};
const colorOf = (p: Part) => colors[p.id] ?? "#78716c";

const car: Toy = {
  id: "toy-1",
  name: "Red racer",
  kind: "car",
  sizeClass: "small",
  lengthMm: 110,
  widthMm: 55,
  attachPoints: [{ id: "roof", label: "Roof" }],
  source: "scan",
};

const at = (partId: string, xMm: number, yMm: number): Placement => ({
  instanceId: `${partId}@${xMm},${yMm}`,
  partId,
  xMm,
  yMm,
  rotation: 0,
});

describe("toy contract", () => {
  it("maps a scanned toy to a game toy type", () => {
    expect(toyTypeForKind("car")).toBe("vehicle");
    expect(toyTypeForKind("figure")).toBe("character");
    expect(toyTypeForKind("other")).toBe("robot");
  });

  it("keeps every stat on its own game slot", () => {
    const keys = (["speed", "spin", "glow", "torque"] as const).map((stat) =>
      gamePartForStat("vehicle", stat),
    );
    expect(new Set(keys).size).toBe(4);
    for (const key of keys) expect(key.startsWith("vehicle.")).toBe(true);
  });

  it("turns the kid's build into game parts and colors", () => {
    const contract = toyContractFromBuild(
      car,
      [
        at("racer-spoiler", 0, 0),
        at("glow-capsule", 25, 0),
        at("skin-racer-red", 0, 25),
      ],
      byId,
      colorOf,
    );
    expect(contract.format).toBe(TOY_CONTRACT_FORMAT);
    expect(contract.type).toBe("vehicle");
    expect(contract.parts).toContain("vehicle.rear.spoiler");
    expect(contract.parts).toContain("vehicle.front.lightbar");
    // A skin is paint, not a slot.
    expect(contract.parts).toHaveLength(2);
    expect(contract.col.c1).toBe("#b91c1c");
    expect(contract.stats).toMatchObject({ speed: 3, glow: 3 });
  });

  it("keeps the stronger part when two parts share a stat", () => {
    const contract = toyContractFromBuild(
      car,
      [at("racer-spoiler", 0, 0), at("gear-spur-z20", 25, 0)],
      byId,
      colorOf,
    );
    // Both are speed parts (spoiler +2, Z20 gear +3): stronger one wins the slot.
    expect(contract.parts).toEqual(["vehicle.rear.spoiler"]);
    expect(contract.stats).toMatchObject({ speed: 5 });
  });

  it("puts parts with different stats on different slots", () => {
    const contract = toyContractFromBuild(
      car,
      [at("racer-spoiler", 0, 0), at("spin-capsule", 25, 0)],
      byId,
      colorOf,
    );
    // Spoiler is speed, spin-capsule is spin: two different slots.
    expect(contract.parts).toContain("vehicle.rear.spoiler");
    expect(contract.parts).toContain("vehicle.wheels.small");
  });

  it("survives a round trip through the URL hash", () => {
    const contract = toyContractFromBuild(car, [at("racer-spoiler", 0, 0)], byId, colorOf);
    const url = toyWorldUrl(contract);
    expect(url).toContain("/world/ToyVentor-World.html#toy=");
    const encoded = url.split("#toy=")[1]!;
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    const decoded = decodeToyContract(encoded);
    expect(decoded).toEqual(contract);
    expect(validateToyContract(decoded)).toEqual([]);
  });

  it("sends no paint when the build supplied none, so the game keeps its own", () => {
    const empty = toyContractFromBuild(car, [], byId, colorOf);
    expect(empty.col).toEqual({ c1: "", c2: "", skin: "" });
    expect(validateToyContract(empty)).toEqual([]);
    expect(decodeToyContract(encodeToyContract(empty))).toEqual(empty);
    // One part paints the main color only; the accent stays the game's.
    const one = toyContractFromBuild(car, [at("racer-spoiler", 0, 0)], byId, colorOf);
    expect(one.col.c1).toBe("#e85d1f");
    expect(one.col.c2).toBe("");
    expect(one.col.skin).toBe("");
  });

  it("refuses malformed contracts", () => {
    expect(decodeToyContract("not-base64!!")).toBeNull();
    expect(validateToyContract({ format: "toyventor.toy/2" }).length).toBeGreaterThan(0);
    expect(validateToyContract({ format: TOY_CONTRACT_FORMAT, type: "plane" }).length).toBeGreaterThan(0);
  });
});
