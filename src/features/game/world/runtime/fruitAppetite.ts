// What a toy does when a fruit is offered to it (docs/specs/playful-interactions-spec.md section 4): the rules, with no rendering in them.
//
// A character eats, a robot crunches, a vehicle politely declines (and the fruit is dropped, not lost). After a few fruits in a short time the toy is FULL:
// it pats its belly and refuses more for a little while, so feeding has a rhythm and cannot be spammed. Nothing here can hurt, punish or make the toy
// "hungry": a refused fruit simply stays a fruit.
//
// The caller (the drag handler in world.ts, once it is hooked up) asks `offer(kind, eater)` when a fruit is released over the toy and plays the
// reaction it gets back: for a character the clips in proceduralClips.ts (`eat`, `sour`, `belly_pat`), for a robot and a vehicle simple transforms.
import { FRUIT, type FruitKind } from "./propReactions";

export type EaterKind = "character" | "robot" | "vehicle";
/** `eat`, `sour` and `belly_pat` are clips; `crunch` (a robot's chew with a spark) and `decline` (a vehicle's honk and shake) are transforms. */
export type Reaction = "eat" | "sour" | "crunch" | "decline" | "belly_pat";

export interface Verdict {
  /** True when the toy took the fruit (it is eaten); false when the fruit goes back to the ground. */
  fed: boolean;
  /** What the toy does now. */
  reaction: Reaction;
  /** After a short pause, what it does next: the belly pat after the fruit that filled it. */
  after?: Reaction;
  /** The toy is full now (this fruit filled it, or it was already full and refused). */
  full: boolean;
}

/** Fruits within this many seconds count towards being full, how many fill the toy, and how long it then refuses. */
export const FULL_WINDOW_S = 20;
export const FULL_AFTER = 3;
export const FULL_FOR_S = 8;

export function createAppetite(now: () => number) {
  let recent: number[] = [];
  let fullUntil = 0;
  return {
    /** A fruit is offered to a toy. Anything without a name (snow, rain) is not food. */
    offer(kind: FruitKind, eater: EaterKind): Verdict {
      const t = now();
      if (!FRUIT[kind]?.noun) return { fed: false, reaction: eater === "vehicle" ? "decline" : "belly_pat", full: false };
      if (t < fullUntil) return { fed: false, reaction: "belly_pat", full: true };
      if (eater === "vehicle") return { fed: false, reaction: "decline", full: false };
      recent = recent.filter((x) => t - x < FULL_WINDOW_S);
      recent.push(t);
      const reaction: Reaction = eater === "robot" ? "crunch" : kind === "lemon" ? "sour" : "eat";
      if (recent.length >= FULL_AFTER) {
        recent = [];
        fullUntil = t + FULL_FOR_S;
        return { fed: true, reaction, after: "belly_pat", full: true };
      }
      return { fed: true, reaction, full: false };
    },
    /** True while the toy is refusing because it is full. */
    get isFull() { return now() < fullUntil; },
    /** Forget everything (a world change, a new toy). */
    reset() { recent = []; fullUntil = 0; },
  };
}
