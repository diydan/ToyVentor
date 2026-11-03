// Drag-to-feed: the gesture (docs/specs/playful-interactions-spec.md section 4; Dan chose DRAG over tap on 2026-11-03).
//
// One finger, one fruit. Press on a fruit and it is "pressed": nothing has happened yet. Release without moving much and it was a TAP (the fruit says its
// name). Move more than a few pixels and it becomes a CARRY: the fruit leaves the ground and follows the finger. Release over the toy and the toy is FED;
// release anywhere else and the fruit is DROPPED where it was let go. A second finger is ignored while the first is down; a cancelled touch or Escape (`cancel`)
// while carrying drops the fruit where it was, and cancelling a merely pressed fruit does nothing.
//
// This module knows nothing about three.js, the camera or the DOM: the world supplies hit-testing and placement as callbacks, so the whole gesture
// is testable in node, and the hook in world.ts's pointer handling is small. The tap fires on RELEASE, not on press, so a drag never also speaks the name.
export interface DragHooks<F> {
  /** The fruit under this screen position, or null. Must not act on it. */
  pick(x: number, y: number): F | null;
  /** Is this screen position over the toy? A generous target: the whole figure plus a margin. */
  overToy(x: number, y: number): boolean;
  /** The fruit was pressed and released without moving: say its name and react. */
  tap(fruit: F): void;
  /** The carry begins: lift the fruit out of the ground physics. Called once per carry. */
  pickUp(fruit: F): void;
  /** The finger moved while carrying: show the fruit at this position. */
  carry(fruit: F, x: number, y: number): void;
  /** The finger entered (true) or left (false) the toy while carrying, so the toy can lean in or look away. Called only on a change. */
  hover(over: boolean, fruit: F): void;
  /** Released over the toy. */
  feed(fruit: F): void;
  /** Released elsewhere, or the carry was cancelled: let the fruit fall from here (the position is the last one the finger was at). */
  drop(fruit: F, x: number, y: number): void;
}

export type DragState = "idle" | "pressed" | "carrying";

/** How far the finger must travel (in CSS pixels) before a press becomes a carry. Small enough for a child's drag to start at once, big enough that a shaky tap is still a tap. */
export const DRAG_THRESHOLD_PX = 8;

export function createFruitDrag<F>(hooks: DragHooks<F>, opts: { thresholdPx?: number } = {}) {
  const threshold = opts.thresholdPx ?? DRAG_THRESHOLD_PX;
  let state: DragState = "idle";
  let fruit: F | null = null;
  let owner: number | string | null = null;     // the pointer that started it: any other is ignored
  let x0 = 0, y0 = 0, lastX = 0, lastY = 0;
  let over = false;

  const reset = () => { state = "idle"; fruit = null; owner = null; over = false; };

  return {
    get state(): DragState { return state; },
    /**
     * A pointer went down. Returns true when it landed on a fruit: the gesture is now this module's, and the caller must NOT also walk the toy or shake the
     * tree. Returns false (and does nothing) when it missed, or when a gesture is already under way.
     */
    down(x: number, y: number, id: number | string = 0): boolean {
      if (state !== "idle") return false;
      const hit = hooks.pick(x, y);
      if (hit === null) return false;
      state = "pressed"; fruit = hit; owner = id; x0 = lastX = x; y0 = lastY = y;
      return true;
    },
    /** A pointer moved. Returns true when this module is using the move (so the caller can skip its own). */
    move(x: number, y: number, id: number | string = 0): boolean {
      if (state === "idle" || id !== owner || fruit === null) return false;
      lastX = x; lastY = y;
      if (state === "pressed") {
        if (Math.hypot(x - x0, y - y0) <= threshold) return true;
        state = "carrying";
        hooks.pickUp(fruit);
      }
      hooks.carry(fruit, x, y);
      const now = hooks.overToy(x, y);
      if (now !== over) { over = now; hooks.hover(over, fruit); }
      return true;
    },
    /** A pointer was released. */
    up(x: number, y: number, id: number | string = 0): boolean {
      if (state === "idle" || id !== owner || fruit === null) return false;
      const f = fruit, was = state, wasOver = over;
      reset();
      if (was === "pressed") { hooks.tap(f); return true; }
      if (wasOver) hooks.hover(false, f);        // let the toy settle before it is fed or the fruit drops
      if (hooks.overToy(x, y)) hooks.feed(f);
      else hooks.drop(f, x, y);
      return true;
    },
    /** The gesture was interrupted (a cancelled touch, Escape, the page lost focus, a second finger). A carried fruit is dropped where it was; a pressed one is forgotten. */
    cancel(): void {
      if (state === "idle" || fruit === null) return;
      const f = fruit, was = state, wasOver = over;
      reset();
      if (was === "carrying") { if (wasOver) hooks.hover(false, f); hooks.drop(f, lastX, lastY); }
    },
  };
}
