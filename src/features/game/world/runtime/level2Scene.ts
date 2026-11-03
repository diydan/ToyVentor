// Scene binding for level/2 carry recipes (carousel §11, C3).
//
// Pure session logic: which tap means what, what the toy says (the
// toast twin of every prompt — speech arrives separately), and how an
// arrival resolves through the carry core. world.ts owns meshes,
// walking, sound and panel; this module owns decisions, so the rules
// are unit-testable without a scene.
//
// Tap-then-tap is the only gesture here (mandatory for bands 0–1,
// §11.1): tap an item to pick it up, tap a target to put it down.
import {
  applyDrop,
  applyTap,
  type CarryParams,
  type CarryState,
  createCarryState,
} from "./carry";
import { LEVEL2_RECIPES } from "./level2Recipes";
import type { Level2Recipe } from "./level2";

/** The world-first recipe for a rung, if one exists yet. */
export function recipeForRung(missionId: string): Level2Recipe | undefined {
  return LEVEL2_RECIPES.find((r) => r.id === missionId);
}

export interface SceneCarrySession {
  missionId: string;
  params: CarryParams;
  state: CarryState;
  /** Where the toy is walking to, and what happens on arrival. */
  pending: { x: number; itemId: string } | { x: number; targetId: string } | null;
}

/** Start scene play for a rung, or null when it has no recipe yet. */
export function startSceneCarry(missionId: string): SceneCarrySession | null {
  const recipe = recipeForRung(missionId);
  if (!recipe || recipe.interaction.primitive !== "carry") return null;
  return {
    missionId,
    params: recipe.interaction.params,
    state: createCarryState(recipe.interaction.params),
    pending: null,
  };
}

const labelOf = (
  list: Array<{ id: string; label?: string }>,
  id: string,
): string => list.find((e) => e.id === id)?.label ?? id;

export type SceneTap =
  | { action: "goto"; x: number; say: string }
  | { action: "hint"; say: string };

/** Tap an item: pick it up on arrival (or put it back down). */
export function tapSceneItem(
  session: SceneCarrySession,
  itemId: string,
  x: number,
): SceneTap {
  const label = labelOf(session.params.items, itemId).toLowerCase();
  if (session.state.placed[itemId] != null) {
    return { action: "hint", say: `The ${label} is already home.` };
  }
  if (session.state.held === itemId) {
    session.pending = null;
    session.state = applyTap(session.state, session.params, { kind: "item", id: itemId }).state;
    return { action: "hint", say: `Put down the ${label}. Tap it again to pick it up.` };
  }
  session.pending = { x, itemId };
  return { action: "goto", x, say: `Go get the ${label}.` };
}

/** Tap a target: carry what is held there on arrival. */
export function tapSceneTarget(
  session: SceneCarrySession,
  targetId: string,
  x: number,
): SceneTap {
  const label = labelOf(session.params.targets, targetId).toLowerCase();
  if (!session.state.held) {
    return { action: "hint", say: `Tap something to carry to the ${label} first.` };
  }
  session.pending = { x, targetId };
  return { action: "goto", x, say: `Carry it to the ${label}.` };
}

export type SceneArrival =
  | { event: "picked"; say: string; itemId: string }
  | { event: "placed"; say: string; itemId: string; targetId: string }
  | { event: "wrong"; say: string; hint: string }
  | { event: "done"; say: string; itemId: string; targetId: string };

/**
 * The toy reached the pending spot. Applies the pickup/drop through
 * the carry core; wrong drops bounce home with a miss, exactly like
 * the panel path, so scene and panel can never disagree.
 */
export function arriveScene(session: SceneCarrySession): SceneArrival | null {
  const pending = session.pending;
  session.pending = null;
  if (!pending) return null;
  if ("itemId" in pending) {
    const { state } = applyTap(session.state, session.params, {
      kind: "item",
      id: pending.itemId,
    });
    session.state = state;
    const label = labelOf(session.params.items, pending.itemId).toLowerCase();
    if (state.held !== pending.itemId) return null;
    return {
      event: "picked",
      say: `Holding the ${label} — where does it go?`,
      itemId: pending.itemId,
    };
  }
  const held = session.state.held;
  if (!held) return null;
  const before = session.state.misses;
  const { state, event } = applyDrop(session.state, session.params, held, pending.targetId);
  session.state = state;
  const itemLabel = labelOf(session.params.items, held).toLowerCase();
  const targetLabel = labelOf(session.params.targets, pending.targetId).toLowerCase();
  if (event === "done") {
    return {
      event: "done",
      say: `The ${itemLabel} fits in the ${targetLabel}. All packed!`,
      itemId: held,
      targetId: pending.targetId,
    };
  }
  if (event === "wrong" || state.misses !== before) {
    return {
      event: "wrong",
      say: `That does not fit.`,
      hint: `The ${itemLabel} fits somewhere else — try another spot.`,
    };
  }
  return {
    event: "placed",
    say: `The ${itemLabel} fits in the ${targetLabel}.`,
    itemId: held,
    targetId: pending.targetId,
  };
}

/**
 * Item marker x positions: a row left of every recipe's targets
 * (pack targets start at 30, tidy at 14), clear of the lane edge.
 */
export function itemMarkerX(index: number): number {
  return 4 + index * 3;
}

// ---- Visit sessions: walk-to spots in order (Pop, Animals, Peek, Go) ----
//
// The four non-carry Little-ones rungs are ordered spot visits, not
// pick-one panels: tap a spot, the toy walks there, arrival resolves.
// Wrong-order arrivals miss exactly like wrong panel picks (world.ts
// calls mFailNote), and finishing wins the rung outright — the same
// contract as scene carry, so scene and panel can never disagree.

export type VisitEffect = "hide" | "hop" | "reveal" | "green";

export interface VisitSpot {
  id: string;
  label: string;
  x: number;
  /** Toast when tapped: the prompt twin. */
  tap: string;
  /** Toast on the expected arrival. */
  arrive: string;
  /** Shown when this spot is expected but another was tapped. */
  hint: string;
  /** What world.ts does to the marker on the expected arrival. */
  effect: VisitEffect;
}

export interface VisitRecipe {
  missionId: string;
  intro: string;
  /** Toast twin for an out-of-order arrival; never the word "wrong". */
  oops: string;
  spots: VisitSpot[];
}

const VISIT_RECIPES: VisitRecipe[] = [
  {
    missionId: "little.pop",
    intro: "2 bubbles to pop. Tap the biggest one.",
    oops: "That one stays floating.",
    spots: [
      { id: "big", label: "BIG bubble", x: 6, tap: "Go pop the BIG bubble.", arrive: "POP! The big bubble is gone.", hint: "Pop the biggest bubble first.", effect: "hide" },
      { id: "tiny", label: "tiny bubble", x: 10, tap: "Go pop the tiny bubble.", arrive: "Pop! Every bubble is popped.", hint: "One little bubble is still floating.", effect: "hide" },
    ],
  },
  {
    missionId: "little.animals",
    intro: "3 animal friends. Tap one to say hello.",
    oops: "That animal is shy.",
    spots: [
      { id: "cow", label: "Cow", x: 6, tap: "Go say hello to the cow.", arrive: "Moo! Hello, cow.", hint: "Moo comes from the farm animal with patches.", effect: "hop" },
      { id: "bird", label: "Bird", x: 10, tap: "Go say hello to the bird.", arrive: "Tweet! Hello, bird.", hint: "Wings help this animal fly.", effect: "hop" },
      { id: "frog", label: "Frog", x: 14, tap: "Go say hello to the frog.", arrive: "Ribbit! Hello, frog.", hint: "Hop, hop! This animal jumps with big legs.", effect: "hop" },
    ],
  },
  {
    missionId: "little.peek",
    intro: "Someone is hiding. Tap the bush to peek.",
    oops: "Nobody is hiding there.",
    spots: [
      { id: "bush", label: "Bush", x: 8, tap: "Go peek behind the bush.", arrive: "Bunny ears! Someone is hiding.", hint: "Two long ears are poking out at the top.", effect: "reveal" },
      { id: "bunny", label: "Bunny", x: 12, tap: "Peekaboo! Tap the bunny.", arrive: "Peekaboo! Here is the bunny.", hint: "Peekaboo means: now you see me!", effect: "hop" },
    ],
  },
  {
    missionId: "little.gogo",
    intro: "Tap the road dots to drive. Green means go!",
    oops: "Honk honk! Drive to the next dot.",
    spots: [
      { id: "dot1", label: "Road dot 1", x: 20, tap: "The light is green. Tap the road to GO!", arrive: "Go! The little car rolls forward.", hint: "Green means go!", effect: "green" },
      { id: "dot2", label: "Road dot 2", x: 26, tap: "Keep driving. Tap the next dot.", arrive: "Stop and wait — a duck is crossing! The duck crossed. Go!", hint: "Cars wait and let the duck cross safely.", effect: "green" },
      { id: "dot3", label: "Road dot 3", x: 32, tap: "Almost there. Tap the last dot.", arrive: "You drove safely. Beep beep!", hint: "One more dot to go.", effect: "green" },
    ],
  },
];

/** The world-first visit recipe for a rung, if one exists yet. */
export function visitForRung(missionId: string): VisitRecipe | undefined {
  return VISIT_RECIPES.find((r) => r.missionId === missionId);
}

export interface SceneVisitSession {
  missionId: string;
  recipe: VisitRecipe;
  /** Index of the next expected spot. */
  at: number;
  pending: { x: number; spotId: string } | null;
  done: boolean;
}

/** Start visit play for a rung, or null when it has no recipe yet. */
export function startSceneVisit(missionId: string): SceneVisitSession | null {
  const recipe = visitForRung(missionId);
  if (!recipe) return null;
  return { missionId, recipe, at: 0, pending: null, done: false };
}

/** Tap a spot: completed spots hint, everything else walks. */
export function tapSceneSpot(
  session: SceneVisitSession,
  spotId: string,
  x: number,
): SceneTap {
  const idx = session.recipe.spots.findIndex((s) => s.id === spotId);
  if (idx < 0 || session.done) return { action: "hint", say: "All done!" };
  if (idx < session.at) {
    return { action: "hint", say: `Already done there.` };
  }
  session.pending = { x, spotId };
  return { action: "goto", x, say: session.recipe.spots[idx]!.tap };
}

export type VisitArrival =
  | { event: "advanced"; say: string; spotId: string; effect: VisitEffect }
  | { event: "wrong"; say: string; hint: string }
  | { event: "done"; say: string; spotId: string; effect: VisitEffect };

/** The toy reached the pending spot. Expected spots advance; the rest miss. */
export function arriveSceneVisit(session: SceneVisitSession): VisitArrival | null {
  const pending = session.pending;
  session.pending = null;
  if (!pending || session.done) return null;
  const next = session.recipe.spots[session.at];
  if (!next) return null;
  if (pending.spotId !== next.id) {
    return { event: "wrong", say: session.recipe.oops, hint: next.hint };
  }
  session.at++;
  const last = session.at >= session.recipe.spots.length;
  if (last) session.done = true;
  return {
    event: last ? "done" : "advanced",
    say: next.arrive,
    spotId: next.id,
    effect: next.effect,
  };
}
