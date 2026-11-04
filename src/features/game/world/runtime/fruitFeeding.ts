// Drag-to-feed, assembled: the gesture (fruitDrag.ts) and the rules (fruitAppetite.ts) behind ONE small adapter, so the hook in world.ts is only "say how to pick a
// fruit, where the toy is, and how to show things" (docs/specs/playful-interactions-spec.md section 4).
//
// The world supplies an adapter; this decides what a release means. Released over the toy: the appetite is asked, and the fruit is either EATEN (the adapter plays
// the verdict) or REFUSED (a vehicle, a full toy, something that is not food: the fruit goes back to the ground at the toy and the toy reacts). Released anywhere else
// the fruit is just dropped and the appetite is not touched, and a tap never feeds. Nothing here knows about three.js.
import { PROCEDURAL_CLIPS } from "./proceduralClips";
import { createAppetite, type EaterKind, type Reaction, type Verdict } from "./fruitAppetite";
import { createFruitDrag, type DragHooks } from "./fruitDrag";
import type { FruitKind } from "./propReactions";

export interface FeedAdapter<F> {
  /** The fruit under this screen position, or null. Must not act on it. */
  pick(x: number, y: number): F | null;
  /** Which kind of fruit this is (a key of the FRUIT table). */
  kindOf(fruit: F): FruitKind;
  /** What the toy is right now (asked at the moment of the release, because the player can switch toys between drags). */
  eater(): EaterKind;
  /** Seconds, monotonic (the world's clock; tests pass a fake). */
  now(): number;
  /** Is this screen position over the toy? Generous: the whole figure plus a margin. */
  overToy(x: number, y: number): boolean;
  /** A tap (no drag) on a fruit: say its name. */
  tap(fruit: F): void;
  /**
   * Is this fruit lying on the ground close enough to the toy that a plain tap should FEED it (the tap-to-feed fallback for the youngest, who find a drag hard)? Absent: a tap only names the fruit.
   * A fruit still hanging on a tree is never near enough: a tap on it plucks it.
   */
  nearToy?(fruit: F): boolean;
  /** The carry begins: take the fruit out of the ground physics. */
  pickUp(fruit: F): void;
  /** Show the fruit at the finger. */
  carry(fruit: F, x: number, y: number): void;
  /** The finger came over the toy (true) or left it (false): the toy leans in or looks away. */
  lean(over: boolean, fruit: F): void;
  /** The fruit was let go away from the toy, or the carry was cancelled: give it back to the ground physics from here. */
  drop(fruit: F, x: number, y: number): void;
  /** The toy takes it: bring the fruit to the mouth, make it vanish, then play the verdict's reactions (`reactionSteps(verdict)` says when). */
  eat(fruit: F, verdict: Verdict): void;
  /** The toy will not take it: the fruit goes back to the ground at the toy's feet and the toy reacts (a vehicle declines, a full toy pats its belly). */
  refuse(fruit: F, verdict: Verdict): void;
}

/** How long each reaction plays, in seconds: the clips' own lengths, and the two that are transforms (a robot's crunch, a vehicle's decline). */
export const REACTION_SECONDS: Readonly<Record<Reaction, number>> = {
  eat: PROCEDURAL_CLIPS.eat!.duration,
  sour: PROCEDURAL_CLIPS.sour!.duration,
  belly_pat: PROCEDURAL_CLIPS.belly_pat!.duration,
  crunch: 1.0,
  decline: 1.0,
  heavy: 1.0,
};

/** The gap between the end of the first reaction and the belly pat that follows the fruit which filled the toy. */
export const AFTER_GAP_S = 0.25;

/** The verdict as a timeline: what to play and when (seconds after the fruit is eaten, or after the refusal). */
export function reactionSteps(v: Verdict): Array<{ at: number; reaction: Reaction }> {
  const steps = [{ at: 0, reaction: v.reaction }];
  if (v.after) steps.push({ at: REACTION_SECONDS[v.reaction] + AFTER_GAP_S, reaction: v.after });
  return steps;
}

export function createFeeding<F>(a: FeedAdapter<F>, opts: { thresholdPx?: number } = {}) {
  const appetite = createAppetite(a.now);
  const hooks: DragHooks<F> = {
    pick: (x, y) => a.pick(x, y),
    overToy: (x, y) => a.overToy(x, y),
    tap: (f) => {
      a.tap(f);                                                                           // it is named (and hops) either way
      if (!a.nearToy?.(f)) return;
      a.pickUp(f);                                                                        // a tap on a fruit at the toy's feet is a drag of nought pixels: carried, offered, eaten or refused
      const verdict = appetite.offer(a.kindOf(f), a.eater());
      if (verdict.fed) a.eat(f, verdict); else a.refuse(f, verdict);
    },
    pickUp: (f) => a.pickUp(f),
    carry: (f, x, y) => a.carry(f, x, y),
    hover: (over, f) => a.lean(over, f),
    feed: (f) => {
      const verdict = appetite.offer(a.kindOf(f), a.eater());
      if (verdict.fed) a.eat(f, verdict); else a.refuse(f, verdict);
    },
    drop: (f, x, y) => a.drop(f, x, y),
  };
  const drag = createFruitDrag(hooks, opts);
  return {
    /** The gesture: wire these to pointerdown / pointermove / pointerup / pointercancel. `down` and `move` return true when they are using the pointer. */
    drag,
    appetite,
    /** A world change or a new toy: forget the gesture and the fullness. */
    reset() { drag.cancel(); appetite.reset(); },
  };
}
