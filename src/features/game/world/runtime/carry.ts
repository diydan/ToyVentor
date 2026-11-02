// level/2 primitive: carry (play-design-spec §The interaction primitives, Plan step 2).
//
// Pure core: parameter validation, the drop/tap state machine, and a solver. No scene code — the runtime
// binds params to world objects (dragItem/dropZone, tap-then-tap) and renders the events. An obstacle in
// level/2 is a blocker a carry clears (drag the food to the cow; the suitcase that only fits the trunk),
// so Feature 3 v2 needs no separate obstacle verb (SAM spec Q8).
//
// Rules carried from play-design: a press that never moves is a tap (tap item, tap target = same as a
// drag); a wrong drop bounces the item home and counts a miss, never a punishment; success = every
// carryable item (one with at least one target) placed on an accepted target, one item per target.

export interface CarryItemDef {
  id: string;
  /** Targets this item accepts. Empty = a distractor that never places (the rock beside the grass). */
  targetIds: string[];
}

export interface CarryTargetDef {
  id: string;
  /** Lane position (level x units). */
  x: number;
}

export interface CarryParams {
  items: CarryItemDef[];
  targets: CarryTargetDef[];
  /** Snap distance in lane units for the runtime's drop feel; state logic itself is exact-id based. */
  snapRadius?: number;
  orderMatters?: boolean;
}

export type CarryEvent = "touched" | "progress" | "wrong" | "done";

export interface CarryState {
  placed: Record<string, string>; // itemId -> targetId
  held: string | null; // tap-then-tap: the item currently picked up
  misses: number;
  done: boolean;
}

const carryable = (p: CarryParams) => p.items.filter((i) => i.targetIds.length > 0);

export function validateCarry(p: CarryParams): string[] {
  const errors: string[] = [];
  const targetIds = new Set(p.targets.map((t) => t.id));
  if (targetIds.size !== p.targets.length) errors.push("duplicate target id");
  const itemIds = new Set(p.items.map((i) => i.id));
  if (itemIds.size !== p.items.length) errors.push("duplicate item id");
  if (carryable(p).length === 0) errors.push("no carryable items (every item needs at least one target, or the level cannot finish)");
  for (const item of p.items) {
    for (const t of item.targetIds) if (!targetIds.has(t)) errors.push(`item "${item.id}" names unknown target "${t}"`);
  }
  return errors;
}

export function createCarryState(_p: CarryParams): CarryState {
  return { placed: {}, held: null, misses: 0, done: false };
}

function isDone(p: CarryParams, placed: Record<string, string>): boolean {
  return carryable(p).every((i) => placed[i.id] != null);
}

export function applyDrop(
  state: CarryState,
  p: CarryParams,
  itemId: string,
  targetId: string,
): { state: CarryState; event: CarryEvent } {
  if (state.done) return { state, event: "touched" };
  const item = p.items.find((i) => i.id === itemId);
  const occupied = Object.values(state.placed).includes(targetId);
  const ok = !!item && item.targetIds.includes(targetId) && !occupied && state.placed[itemId] == null;
  if (!ok) return { state: { ...state, held: null, misses: state.misses + 1 }, event: "wrong" };
  const placed = { ...state.placed, [itemId]: targetId };
  const done = isDone(p, placed);
  return { state: { ...state, placed, held: null, done }, event: done ? "done" : "progress" };
}

export type CarryTapRef = { kind: "item"; id: string } | { kind: "target"; id: string };

/** Tap-then-tap, the no-drag path: tap an item to hold it, tap a target to drop it there. */
export function applyTap(
  state: CarryState,
  p: CarryParams,
  ref: CarryTapRef,
): { state: CarryState; event: CarryEvent } {
  if (state.done) return { state, event: "touched" };
  if (ref.kind === "item") {
    if (state.placed[ref.id] != null) return { state, event: "touched" };
    return { state: { ...state, held: state.held === ref.id ? null : ref.id }, event: "touched" };
  }
  if (!state.held) return { state, event: "touched" };
  return applyDrop(state, p, state.held, ref.id);
}

export interface CarryStep {
  itemId: string;
  targetId: string;
}

/**
 * A correct play, or null when no assignment places every carryable item (one per target).
 * Deterministic: items in listed order, first free accepted target, with backtracking.
 */
export function solveCarry(p: CarryParams): CarryStep[] | null {
  if (validateCarry(p).length) return null;
  const items = carryable(p);
  const used = new Set<string>();
  const plan: CarryStep[] = [];
  const go = (i: number): boolean => {
    if (i >= items.length) return true;
    for (const t of items[i]!.targetIds) {
      if (used.has(t)) continue;
      used.add(t);
      plan.push({ itemId: items[i]!.id, targetId: t });
      if (go(i + 1)) return true;
      plan.pop();
      used.delete(t);
    }
    return false;
  };
  return go(0) ? plan : null;
}
