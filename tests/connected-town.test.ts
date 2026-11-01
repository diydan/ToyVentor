import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import {
  TOWN_RING,
  TOWN_SPARKLE_SPOTS,
  townNeighbors,
  townSparkleProgress,
  vehiclePerkForToy,
  WORLDS,
} from "../src/features/game/world/runtime/catalog";

describe("Connected Town & Vehicle Perks (ToyVentor Town Slice 1)", () => {
  it("connects all 6 town districts in a closed ring and keeps Labs isolated", () => {
    expect(TOWN_RING).toEqual(["room", "garden", "beach", "junk", "snow", "sky"]);

    // Garden connects west to Home Street (Toy Room) and east to Beach ("walk off the end of Garden and you are on the Beach")
    expect(townNeighbors("garden")).toEqual({ west: "room", east: "beach" });
    expect(townNeighbors("room")).toEqual({ west: "sky", east: "garden" });
    expect(townNeighbors("sky")).toEqual({ west: "snow", east: "room" });

    // Every ring district exists in WORLDS and wraps around cleanly in 6 steps
    let cursor = "garden";
    const visited: string[] = [];
    for (let i = 0; i < TOWN_RING.length; i++) {
      expect(WORLDS[cursor]).toBeDefined();
      visited.push(cursor);
      const nb = townNeighbors(cursor);
      expect(nb).not.toBeNull();
      cursor = nb!.east;
    }
    expect(cursor).toBe("garden");
    expect(new Set(visited).size).toBe(6);

    // Labs and custom worlds do not auto-cross into streets
    for (const lab of ["lab1", "lab2", "lab3", "lab4", "lab5", "lab6", "custom"]) {
      expect(townNeighbors(lab)).toBeNull();
    }
  });

  it("maps vehicle builds to physical traversal perks and returns null for characters", () => {
    expect(vehiclePerkForToy("seed-kip", "character")).toBeNull();

    const cruiser = vehiclePerkForToy("seed-car", "vehicle")!;
    expect(cruiser.id).toBe("cruiser");
    expect(cruiser.vmax).toBe(5.2);
    expect(cruiser.waterSkim).toBe(false);

    const catamaran = vehiclePerkForToy("seed-catamaran", "vehicle")!;
    expect(catamaran.id).toBe("water-skim");
    expect(catamaran.waterSkim).toBe(true);
    expect(catamaran.innateStats).toContain("spin");

    const heli = vehiclePerkForToy("seed-helicopter", "vehicle")!;
    const plane = vehiclePerkForToy("seed-aeroplane", "vehicle")!;
    const shuttle = vehiclePerkForToy("seed-shuttle", "vehicle")!;
    expect(heli.airHover).toBe(true);
    expect(plane.airHover).toBe(true);
    expect(shuttle.airHover).toBe(true);
    expect(heli.innateStats).toContain("speed");
    expect(shuttle.innateStats).toEqual(["speed", "glow"]);

    const tractor = vehiclePerkForToy("seed-tractor", "vehicle")!;
    const truck = vehiclePerkForToy("seed-truck", "vehicle")!;
    expect(tractor.unboltRange).toBe(6.0);
    expect(tractor.scrapBonus).toBe(1);
    expect(truck.innateStats).toContain("torque");

    const scooter = vehiclePerkForToy("seed-scooter", "vehicle")!;
    const bike = vehiclePerkForToy("seed-motorbike", "vehicle")!;
    expect(scooter.vmax).toBe(6.5);
    expect(bike.innateStats).toContain("speed");

    const mech = vehiclePerkForToy("seed-mech", "vehicle")!;
    expect(mech.id).toBe("bolt-mech");
    expect(mech.scrapBonus).toBe(1);
    expect(mech.innateStats).toEqual(["torque", "glow"]);
  });

  it("defines calm, non-punitive Town Sparkle spots across all 6 districts without colliding with spots or missions", () => {
    const empty = townSparkleProgress({});
    expect(empty).toEqual({ tidied: 0, total: 12 });

    const partial = townSparkleProgress({ "garden.leaves": 1, "beach.kelp": 1, "room.blocks": 1 });
    expect(partial).toEqual({ tidied: 3, total: 12 });

    for (const dist of TOWN_RING) {
      const spots = TOWN_SPARKLE_SPOTS[dist];
      expect(spots.length).toBe(2);
      const wd = WORLDS[dist]!;
      for (const ts of spots) {
        expect(ts.x).toBeGreaterThan(4);
        expect(ts.x).toBeLessThan(39);
        for (const hs of wd.spots) {
          expect(Math.abs(hs.x - ts.x)).toBeGreaterThan(2.0);
        }
        for (const ms of wd.missions) {
          expect(Math.abs(ms.x - ts.x)).toBeGreaterThan(4.0);
        }
      }
    }
  });

  it("wires signposts, edge street crossings, water-skim bounds, and tidy side quests in world.ts", async () => {
    const text = await fs.readFile(
      new URL("../src/features/game/world/runtime/world.ts", import.meta.url),
      "utf8",
    );
    expect(text).toContain("function streetCross(dir: \"west\" | \"east\")");
    expect(text).toContain("streetSignMesh(.85,\"west\"");
    expect(text).toContain("streetSignMesh(43.85,\"east\"");
    expect(text).toContain("buildTownSparkles(id)");
    expect(text).toContain("skim=!!(pk&&pk.waterSkim)");
    expect(text).toContain("if(m.type===\"bridge\"&&!m.done&&!skim)");
    expect(text).toContain("town:{neighbors:function(){return townNeighbors(S.world)}");
  });
});
