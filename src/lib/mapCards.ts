// Map carousel card model (carousel-modes-ladders-spec §7). Pure
// derivation: Learn cards from learn.ts, Explore cards from the stop
// list below, which mirrors runtime/catalog.ts LEVELS (5 hidden spots
// per world, lab missions per lab) and is pinned to it by test, so the
// catalog stays the source of truth without a runtime->lib import.
import { learnStates, type LadderState } from "./learn";
import type { ProgressionState } from "./progression";

export type CardKind = "ask" | "learn" | "world" | "lab";

export interface Pip {
  /** Part slot for world pips (e.g. "hat"), "check" elsewhere. */
  icon: string;
  done: boolean;
  /** Outline until found, so the child sees what is still hidden. */
  silhouette: boolean;
}

export interface MapCard {
  id: string;
  kind: CardKind;
  label: string;
  theme: string;
  ladder?: LadderState;
  pips: Pip[];
  done: number;
  total: number;
  complete: boolean;
  /** The one card the child's toy points at. */
  suggested: boolean;
}

export interface MapStop {
  id: string;
  label: string;
  kind: "world" | "lab";
  theme: string;
  /** World: hidden part keys. Lab: mission ids ("lab1.bridge"). */
  goals: string[];
}

export const MAP_STOPS: MapStop[] = [
  { id: "garden", label: "Garden", kind: "world", theme: "garden", goals: ["character.hat.flower", "character.ears.antennae", "character.back.cape", "vehicle.front.lightbar", "vehicle.shell.bubble"] },
  { id: "sky", label: "Sky Meadow", kind: "world", theme: "sky", goals: ["character.back.wings", "vehicle.chassis.buggy", "character.eyes.sparkle", "robot.head.cams", "robot.top.gearcrown"] },
  { id: "junk", label: "Junkyard", kind: "world", theme: "junk", goals: ["robot.legs.wheels", "robot.torso.barrel", "robot.arms.tools", "vehicle.wheels.tread", "vehicle.rear.hook"] },
  { id: "beach", label: "Beach", kind: "world", theme: "beach", goals: ["robot.top.radar", "character.hat.cap", "vehicle.rear.booster", "robot.arms.propellers", "character.tail.puff"] },
  { id: "snow", label: "Snow Peak", kind: "world", theme: "snow", goals: ["character.ears.bear", "robot.torso.core", "vehicle.front.plow", "robot.legs.springs", "character.eyes.sleepy"] },
  { id: "room", label: "Toy Room", kind: "world", theme: "room", goals: ["robot.head.tv", "character.back.jetpack", "vehicle.shell.open", "robot.top.bulb", "character.hat.crown"] },
  { id: "lab1", label: "Lab 1: Bridges", kind: "lab", theme: "garden", goals: ["lab1.bridge", "lab1.measure", "lab1.balance"] },
  { id: "lab2", label: "Lab 2: Machines", kind: "lab", theme: "junk", goals: ["lab2.logic", "lab2.lift"] },
  { id: "lab3", label: "Lab 3: Water", kind: "lab", theme: "beach", goals: ["lab3.raft"] },
  { id: "lab4", label: "Lab 4: Levers and Lights", kind: "lab", theme: "snow", goals: ["lab4.lever", "lab4.circuit"] },
  { id: "lab5", label: "Lab 5: Code and Patterns", kind: "lab", theme: "sky", goals: ["lab5.code", "lab5.pattern"] },
  { id: "lab6", label: "Lab 6: Clean-up", kind: "lab", theme: "room", goals: ["lab6.clean"] },
];

/** Scene glyph + accent per stop id (mockup mapStyle, ToyForge tokens). */
export const STOP_GLYPH: Record<string, string> = {
  little: "◉",
  early: "Aa",
  daily: "⌂",
  bridges: "⌢",
  gears: "⚙",
  circuits: "◐",
  code: "{}",
  garden: "✿",
  sky: "☁",
  junk: "⚒",
  beach: "☀",
  snow: "❄",
  room: "▦",
  lab1: "⌢",
  lab2: "⚙",
  lab3: "≋",
  lab4: "◐",
  lab5: "{}",
  lab6: "✦",
  ask: "?",
};

export const THEME_COLOR: Record<string, string> = {
  garden: "#5af0b0",
  sky: "#9bd4ff",
  junk: "#ff9d5c",
  beach: "#52b7ff",
  snow: "#bfcaf5",
  room: "#a78bff",
};

export const KIND_WORD: Record<CardKind, string> = {
  ask: "Grown-up",
  learn: "Learn",
  world: "World",
  lab: "Lab",
};

/** A part goal key is "character.hat.flower": the middle word is the slot. */
const slotIcon = (goal: string): string => goal.split(".")[1] ?? "part";

export interface MapCardsInput {
  ageBand: number | null;
  prog: Pick<ProgressionState, "missionStars" | "sandboxUnlockAll">;
  /** Hidden parts found (engine facade snapshot keys). */
  found: ReadonlySet<string>;
  /** Missions done, "lab1.bridge" keys (engine facade snapshot). */
  missionsDone: ReadonlySet<string>;
}

/**
 * The carousel cards in order: [ask?] -> age-suited Learn ladders ->
 * worlds -> labs. Suggestion: ask first, else first incomplete Learn,
 * else first incomplete card.
 */
export function buildMapCards(input: MapCardsInput): MapCard[] {
  const learn = learnStates(input.ageBand, input.prog);
  const cards: MapCard[] = [];
  if (input.ageBand === null && learn.length === 0) {
    cards.push({
      id: "ask",
      kind: "ask",
      label: "Who's playing?",
      theme: "sky",
      pips: [],
      done: 0,
      total: 0,
      complete: false,
      suggested: false,
    });
  }
  for (const s of learn) {
    cards.push({
      id: s.ladder.id,
      kind: "learn",
      label: s.ladder.label,
      theme: s.ladder.theme,
      ladder: s,
      pips: s.shown.map((r) => ({ icon: "check", done: r.done, silhouette: false })),
      done: s.done,
      total: s.total,
      complete: s.complete,
      suggested: false,
    });
  }
  for (const stop of MAP_STOPS) {
    const source = stop.kind === "world" ? input.found : input.missionsDone;
    const goals = stop.goals.map((g) => source.has(g));
    const done = goals.filter(Boolean).length;
    cards.push({
      id: stop.id,
      kind: stop.kind,
      label: stop.label,
      theme: stop.theme,
      pips: stop.goals.map((g, i) => ({
        icon: stop.kind === "world" ? slotIcon(g) : "check",
        done: goals[i] === true,
        silhouette: stop.kind === "world",
      })),
      done,
      total: stop.goals.length,
      complete: stop.goals.length > 0 && done >= stop.goals.length,
      suggested: false,
    });
  }
  const pick =
    cards.find((c) => c.kind === "ask") ??
    cards.find((c) => c.kind === "learn" && !c.complete) ??
    cards.find((c) => !c.complete);
  if (pick) pick.suggested = true;
  return cards;
}
