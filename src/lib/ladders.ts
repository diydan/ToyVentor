// Learning ladders for the level carousel (carousel-modes-ladders-spec §10).
// Data mirrors the playtest mockup's runtime/ladders.ts (itself generated
// from the engine TRACKS); each rung additionally carries its ToyForge
// progression mission id and tier (§10.2). "Done" for a rung is
// missionStars[`${missionId}:t${tier}`] >= 1 in progression:v1.
import type { Tier } from "./progression";

export interface Rung {
  title: string;
  /** Engine age text, e.g. "5 to 6" (see age.ts bandOf). */
  age: string;
  /** Progression mission id this rung scores through (§10.2). */
  missionId: string;
  tier: Tier;
}

export interface Ladder {
  id: string;
  label: string;
  /** A world theme, used to pick the card scene colour. */
  theme: string;
  rungs: Rung[];
}

const r = (title: string, age: string, missionId: string, tier: Tier = 1): Rung => ({
  title,
  age,
  missionId,
  tier,
});

export const LADDERS: Ladder[] = [
  {
    id: "little",
    label: "Little ones",
    theme: "garden",
    rungs: [
      r("Pop the bubbles", "2 to 3", "little.pop"),
      r("Animal friends", "2 to 3", "little.animals"),
      r("Pack the car", "2 to 3", "little.pack"),
      r("Peekaboo", "2 to 3", "little.peek"),
      r("Go, car, go!", "2 to 3", "little.gogo"),
      r("Tidy one thing", "2 to 3", "little.tidy"),
    ],
  },
  {
    id: "early",
    label: "Early learning",
    theme: "sky",
    rungs: [
      r("Colors", "3 to 4", "early.colors"),
      r("Numbers", "3 to 4", "early.numbers"),
      r("Words", "3 to 4", "early.words"),
      r("Phrases", "3 to 4", "early.phrases"),
    ],
  },
  {
    id: "daily",
    label: "Daily life",
    theme: "room",
    rungs: [
      r("Wash hands", "3 to 4", "daily.wash"),
      r("Brush teeth", "3 to 4", "daily.brush"),
      r("Get dressed", "3 to 4", "daily.dress"),
      r("Clean up toys", "3 to 4", "daily.toys"),
      r("Tidy the room", "5 to 6", "daily.tidy"),
      r("Help cook", "4 to 6", "daily.cook"),
      r("Family meal", "3 to 4", "daily.meal"),
      r("Clean up after meals", "3 to 4", "daily.clean"),
    ],
  },
  {
    id: "bridges",
    label: "Bridges",
    theme: "beach",
    rungs: [
      r("One plank", "3 to 4", "lab1.bridge", 1),
      r("Measure the gap", "5 to 6", "lab1.measure", 1),
      r("Triangles", "7 to 9", "lab1.bridge", 2),
      r("Budget bridge", "10 to 12", "lab1.balance", 1),
      r("Lightest truss", "13+", "lab1.bridge", 3),
    ],
  },
  {
    id: "gears",
    label: "Gears",
    theme: "junk",
    rungs: [
      r("Turn the crank", "3 to 4", "lab2.lift", 1),
      r("Big gear, small gear", "5 to 6", "lab2.lift", 2),
      r("Gear lift", "7 to 9", "lab2.lift", 3),
      r("Exact ratio", "10 to 12", "gears.ratio", 1),
      r("Gearbox", "13+", "gears.gearbox", 1),
    ],
  },
  {
    id: "circuits",
    label: "Circuits",
    theme: "snow",
    rungs: [
      r("Tap to light", "3 to 4", "lab4.circuit", 1),
      r("Metal or not", "5 to 6", "lab4.circuit", 2),
      r("Close the loop", "7 to 9", "lab4.circuit", 3),
      // Tiers of lab4.circuit are exhausted by the rungs above; series vs
      // parallel is its own task, so it gets its own Tier-1 id.
      r("Series or parallel", "10 to 12", "circuits.series", 1),
      r("Sensor logic", "13+", "lab2.logic", 1),
    ],
  },
  {
    id: "code",
    label: "Code",
    theme: "sky",
    rungs: [
      r("Tap the arrows", "3 to 4", "lab5.code", 1),
      r("Sequence cards", "5 to 6", "lab5.pattern", 1),
      r("Loops", "7 to 9", "lab5.code", 2),
      r("If-then rules", "10 to 12", "lab5.pattern", 2),
      r("Text code", "13+", "lab5.code", 3),
    ],
  },
];

export const ladderById = (id: string): Ladder | undefined =>
  LADDERS.find((l) => l.id === id);

/** Progression key a rung's stars live under, e.g. "lab1.bridge:t2". */
export const rungKey = (rung: Rung): string => `${rung.missionId}:t${rung.tier}`;
