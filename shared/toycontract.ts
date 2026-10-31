// The toy contract is the hand-off between the app and ToyVentor World.
// The app knows the kid's toy and the parts they placed on it; the game
// knows its own part table and slot layout. This file is the one place
// that maps one to the other, so neither side has to know about the other.
//
// Wire format: "toyventor.toy/1", JSON, base64url encoded into the hash
// of the game page (#toy=...). It travels in the URL only: no server call,
// nothing stored, and no personal data on this path.
//
// Mapping rule: the game gives every slot a stat (speed, spin, glow,
// torque). Each app part carries one stat too, so a placed part maps to
// the game slot that carries the same stat for that toy type. Two parts
// with the same stat compete for one slot and the stronger one wins.
// This keeps the kid's build visible in the game without pretending the
// two part libraries are the same.
import type { Placement } from "./build";
import type { Part, StatName } from "./part";
import type { Toy, ToyKind } from "./toy";

export const TOY_CONTRACT_FORMAT = "toyventor.toy/1";

/** Toy types the game can show. */
export type ToyType = "character" | "robot" | "vehicle";

/** Where the game page lives. Same origin as the app, so Create mode in
 *  the game can reach the Worker's /api/muse/spark route. */
export const WORLD_PATH = "/";
/** Legacy iframe world path; worker 302-redirects it to `/` (hash preserved). */
export const LEGACY_WORLD_PATH = "/world/ToyVentor-World.html";

/** Standalone 3D Modular Rig Demo for Kip (Pro 8+ & Snap 4–8, Mixamo locomotion,
 *  Exploded View, and Tabletop Part-Pile-to-Build animation). */
export const KIP_DEMO_PATH = "/kip/Kip-Demo.html";

export interface ToyContract {
  format: typeof TOY_CONTRACT_FORMAT;
  /** The kid's toy id, so the game can tell two toys apart. */
  id: string;
  /** The kid's toy name, shown on the game's title screen. */
  name: string;
  type: ToyType;
  /** Game part keys, e.g. "vehicle.rear.spoiler". */
  parts: string[];
  /** Main paint, accent paint, and skin tone (character only). Each is a
   *  #rrggbb color, or "" to leave the game's current paint untouched. */
  col: { c1: string; c2: string; skin: string };
  /** Totals for the kid's build, kept for the game's own reading. */
  stats: Partial<Record<StatName, number>>;
}

/** The game slot that carries each stat, per toy type. */
const STAT_PART: Record<ToyType, Record<StatName, string>> = {
  character: {
    speed: "character.back.jetpack",
    spin: "character.tail.curly",
    glow: "character.eyes.big",
    torque: "character.base.block",
  },
  robot: {
    speed: "robot.legs.walkers",
    spin: "robot.head.cams",
    glow: "robot.top.bulb",
    torque: "robot.torso.box",
  },
  vehicle: {
    speed: "vehicle.rear.spoiler",
    spin: "vehicle.wheels.small",
    glow: "vehicle.front.lightbar",
    torque: "vehicle.chassis.truck",
  },
};

const TYPES: ToyType[] = ["character", "robot", "vehicle"];
const STATS: StatName[] = ["speed", "spin", "torque", "glow"];
const HEX = /^#[0-9a-f]{6}$/i;

/** A scanned car becomes a vehicle; figures and everyday objects resolve onto
 *  the unified Kip Character rig (`robot` remains valid on the wire). */
export function toyTypeForKind(kind: ToyKind): ToyType {
  if (kind === "car") return "vehicle";
  return "character";
}

/** Game part key for one stat on one toy type. */
export function gamePartForStat(type: ToyType, stat: StatName): string {
  return STAT_PART[type][stat];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isHexOrEmpty(v: unknown): v is string {
  return typeof v === "string" && (v === "" || HEX.test(v));
}

/** Returns human-readable errors; empty array means the contract is valid. */
export function validateToyContract(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ["contract is not an object"];
  if (value.format !== TOY_CONTRACT_FORMAT)
    errors.push(`format must be ${TOY_CONTRACT_FORMAT}`);
  if (typeof value.id !== "string" || !value.id) errors.push("id must be a non-empty string");
  if (typeof value.name !== "string" || !value.name)
    errors.push("name must be a non-empty string");
  if (!TYPES.includes(value.type as ToyType))
    errors.push(`type must be one of ${TYPES.join(", ")}`);
  if (!Array.isArray(value.parts)) {
    errors.push("parts must be an array");
  } else {
    for (const part of value.parts) {
      if (typeof part !== "string" || !/^(character|robot|vehicle)\.[a-z]+\.[a-z]+$/.test(part))
        errors.push(`part key looks wrong: ${String(part)}`);
    }
  }
  if (!isRecord(value.col)) {
    errors.push("col must be an object");
  } else {
    if (!isHexOrEmpty(value.col.c1)) errors.push("col.c1 must be a #rrggbb color or empty");
    if (!isHexOrEmpty(value.col.c2)) errors.push("col.c2 must be a #rrggbb color or empty");
    if (!isHexOrEmpty(value.col.skin)) errors.push("col.skin must be a #rrggbb color or empty");
  }
  if (value.stats !== undefined) {
    if (!isRecord(value.stats)) errors.push("stats must be an object");
    else {
      for (const [key, total] of Object.entries(value.stats)) {
        if (!STATS.includes(key as StatName)) errors.push(`unknown stat: ${key}`);
        if (typeof total !== "number" || !Number.isFinite(total))
          errors.push(`stat ${key} must be a number`);
      }
    }
  }
  return errors;
}

/** base64url, so the contract survives a URL hash untouched. */
export function encodeToyContract(contract: ToyContract): string {
  const bytes = new TextEncoder().encode(JSON.stringify(contract));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Returns null for anything that is not a valid contract. */
export function decodeToyContract(text: string): ToyContract | null {
  try {
    const padded = text.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (validateToyContract(parsed).length > 0) return null;
    return parsed as ToyContract;
  } catch {
    return null;
  }
}

/** The game URL that opens ToyVentor World with this toy. */
export function toyWorldUrl(contract: ToyContract, base = ""): string {
  return `${base}${WORLD_PATH}#toy=${encodeToyContract(contract)}`;
}

/** Read a `#toy=` contract from a hash string (app boot / share links). */
export function decodeToyContractFromHash(hash: string): ToyContract | null {
  try {
    const raw = hash.replace(/^#/, "");
    const match = raw.match(/(?:^|&)toy=([^&]+)/);
    if (!match?.[1]) return null;
    return decodeToyContract(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

/** The viewer URL that opens Kip's 3D Modular Rig Demo with an optional toy build contract. */
export function kipDemoUrl(contract?: ToyContract | null, base = ""): string {
  if (!contract) return `${base}${KIP_DEMO_PATH}`;
  return `${base}${KIP_DEMO_PATH}#toy=${encodeToyContract(contract)}`;
}

/** Build the contract for a kid's toy and the parts they placed on it.
 *  `colorOf` is the app's part color lookup (a renderer concern, so the
 *  caller passes it in and this file stays free of render imports). */
export function toyContractFromBuild(
  toy: Toy,
  placements: Placement[],
  partsById: Map<string, Part>,
  colorOf: (part: Part) => string,
): ToyContract {
  const type = toyTypeForKind(toy.kind);
  const best = new Map<string, { key: string; value: number }>();
  const stats: Partial<Record<StatName, number>> = {};
  let main = "";
  let accent = "";

  for (const placement of placements) {
    const part = partsById.get(placement.partId);
    if (!part) continue;
    stats[part.stat.name] = (stats[part.stat.name] ?? 0) + part.stat.value;
    const color = colorOf(part);
    if (!part.printable && part.skin) {
      // A skin part is paint, not a slot: it becomes the main color.
      main = color;
      continue;
    }
    const key = gamePartForStat(type, part.stat.name);
    const current = best.get(key);
    if (!current || part.stat.value > current.value) best.set(key, { key, value: part.stat.value });
    if (!main) main = color;
    else if (!accent) accent = color;
  }

  return {
    format: TOY_CONTRACT_FORMAT,
    id: toy.id,
    name: toy.name,
    type,
    parts: [...best.values()].map((entry) => entry.key),
    // Unset colors stay "": the app never picks a skin tone, and a build
    // with no paint must not repaint the toy the kid set up in the game.
    col: { c1: main, c2: accent, skin: "" },
    stats,
  };
}
