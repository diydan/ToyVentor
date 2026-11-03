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
